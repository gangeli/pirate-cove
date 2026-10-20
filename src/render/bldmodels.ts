import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assetUrl, loadTex } from './textures';
import { M, sign, flag } from './kit';
import { markSharedTree } from './dispose';
import { gpu } from './backend';

/**
 * Building models made in Blender (scripts/blender/bld). Each GLB names its material slots after the shared
 * materials in kit.ts; those are swapped in (cloned once per model to carry its baked ambient-occlusion map
 * on the second UV set). Marker nodes become the hooks the buildings view already understands:
 * smoke (chimney smoke), sign:TEXT (painted board), flag (pirate flag on a pole).
 */
/**
 * Compact a decoded model's vertex data in place (GPU and JS heap): positions as normalized Int16 (the dequantize
 * scale/offset moves into the mesh transform), normals as Int8, the tiling UVs as half floats where their range
 * allows, the AO UVs as normalized Uint16, indices as Uint16 when they fit. 40 bytes per vertex become ~17.
 */
function quantize(root: THREE.Object3D): void {
  const done = new Map<THREE.BufferGeometry, { c: THREE.Vector3; h: number }>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const g = mesh.geometry;
    let q = done.get(g);
    if (!q) {
      q = { c: new THREE.Vector3(), h: 0 };
      done.set(g, q);
      const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos || !(pos.array instanceof Float32Array)) continue;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      bb.getCenter(q.c);
      const sz = bb.getSize(new THREE.Vector3());
      const h = Math.max(sz.x, sz.y, sz.z) / 2 || 1;
      const pa = pos.array, n = pos.count;
      const pq = new Int16Array(n * 3);
      for (let i = 0; i < n; i++) {
        pq[i * 3] = Math.round(((pa[i * 3] - q.c.x) / h) * 32767);
        pq[i * 3 + 1] = Math.round(((pa[i * 3 + 1] - q.c.y) / h) * 32767);
        pq[i * 3 + 2] = Math.round(((pa[i * 3 + 2] - q.c.z) / h) * 32767);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pq, 3, true));
      q.h = h;
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
      if (nrm && nrm.array instanceof Float32Array) {
        const na = nrm.array, nq = new Int8Array(na.length);
        for (let i = 0; i < na.length; i++) nq[i] = Math.round(Math.max(-1, Math.min(1, na[i])) * 127);
        g.setAttribute('normal', new THREE.BufferAttribute(nq, 3, true));
      }
      const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (uv && uv.array instanceof Float32Array) {
        let m = 0;
        for (const v of uv.array) m = Math.max(m, Math.abs(v));
        // half floats resolve 1/1024 of a repeat below 2 repeats (half a texel of a 1024 map at worst); wider
        // ranges stay full float
        if (m <= 2) {
          const hq = new Uint16Array(uv.array.length);
          for (let i = 0; i < hq.length; i++) hq[i] = THREE.DataUtils.toHalfFloat(uv.array[i]);
          g.setAttribute('uv', new THREE.Float16BufferAttribute(hq, 2));
        }
      }
      const uv1 = g.getAttribute('uv1') as THREE.BufferAttribute | undefined;
      if (uv1 && uv1.array instanceof Float32Array) {
        let lo = Infinity, hi = -Infinity;
        for (const v of uv1.array) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
        if (lo >= 0 && hi <= 1) {
          const uq = new Uint16Array(uv1.array.length);
          for (let i = 0; i < uq.length; i++) uq[i] = Math.round(uv1.array[i] * 65535);
          g.setAttribute('uv1', new THREE.BufferAttribute(uq, 2, true));
        }
      }
      const idx = g.index;
      if (idx && !(idx.array instanceof Uint16Array) && n <= 65535) g.setIndex(new THREE.BufferAttribute(Uint16Array.from(idx.array as ArrayLike<number>), 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    if (!q.h) continue;
    // world = T + R*S*(h*p' + c): fold the offset and scale into the node transform
    mesh.position.add(q.c.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion));
    mesh.scale.multiplyScalar(q.h);
    mesh.updateMatrix();
  }
}

class BuildingModels {
  private src = new Map<string, THREE.Group>();
  private far = new Map<string, THREE.Group>();
  /** camera distance (tiles) beyond which the decimated model is drawn */
  lodDistance = 15;
  loaded = false;

  /** load full-detail models on demand (off on low quality: the far models are used throughout) */
  fullDetail = true;
  private loader: GLTFLoader | null = null;
  private draco: DRACOLoader | null = null;
  private loading = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** bumped whenever a full model arrives, so views can rebuild */
  stamp = 0;
  private names = new Set<string>();

  /** at startup: the light far models of everything, plus the crop plants in full */
  async load(): Promise<void> {
    let names: string[] = [];
    try {
      const r = await fetch(assetUrl('buildings/index.json'));
      if (r.ok) names = await r.json();
    } catch {
      return;
    }
    this.names = new Set(names);
    await Promise.all(names.map(async (name) => {
      try {
        if (name.startsWith('plant_')) return this.loadFull(name);
        const lod = await this.gltf().loadAsync(assetUrl(`buildings/${name}_lod.glb`)).catch(() => null);
        if (lod) this.far.set(name, this.prepare(name + '_lod', lod.scene, new Map()));
        else await this.loadFull(name);
      } catch (e) {
        console.warn('building model failed', name, e);
      }
    }));
    this.loaded = true;
    this.idle();
  }

  /** the glTF loader, with Draco decoder workers spun up on demand */
  private gltf(): GLTFLoader {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.loader) {
      this.draco = new DRACOLoader();
      this.draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
      this.draco.setWorkerLimit(2);
      this.loader = new GLTFLoader();
      this.loader.setDRACOLoader(this.draco);
    }
    return this.loader;
  }

  /** each decoder worker holds its own wasm heap: let them go once nothing has streamed in for a while */
  private idle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.loading.size) return this.idle();
      this.draco?.dispose();
      this.draco = null;
      this.loader = null;
      this.idleTimer = null;
    }, 8000);
  }

  private async loadFull(name: string): Promise<void> {
    if (this.src.has(name) || this.loading.has(name) || !this.names.has(name)) return;
    this.loading.add(name);
    try {
      const gltf = await this.gltf().loadAsync(assetUrl(`buildings/${name}.glb`));
      this.src.set(name, this.prepare(name, gltf.scene, new Map()));
      this.stamp++;
    } catch (e) {
      console.warn('building model failed', name, e);
    } finally {
      this.loading.delete(name);
      if (this.loaded) this.idle();
    }
  }

  /** the model name used for a building def at a level, if any */
  resolve(def: string, level: number): string | null {
    const lv = `${def}_${level}`;
    if (this.src.has(lv) || this.far.has(lv)) return lv;
    return this.src.has(def) || this.far.has(def) ? def : null;
  }

  /** ask for full detail of a building type (the buildings view calls this for buildings near the camera) */
  request(def: string, level: number): void {
    const n = this.resolve(def, level);
    if (n && this.fullDetail && !this.src.has(n)) void this.loadFull(n);
  }

  /** 'F' once the full model is in, 'L' while only the far model is (part of a view's rebuild key) */
  stateOf(def: string, level: number): string {
    const n = this.resolve(def, level);
    return n && this.src.has(n) ? 'F' : 'L';
  }

  private prepare(name: string, root: THREE.Group, mats: Map<string, THREE.Material>, bare = false): THREE.Group {
    const k = M() as unknown as Record<string, THREE.Material>;
    const ao = loadTex(`buildings/${name}_ao.jpg`, false, false);
    ao.channel = 1;
    ao.flipY = false;
    // occlusion is read from the red channel only: keep it as one byte per texel, not four
    ao.format = THREE.RedFormat;
    const matFor = (n: string): THREE.Material => {
      const base = k[n] ?? k.plaster;
      // glowing windows stay shared so night lighting reaches them all
      if (n === 'window' || n === 'black') return base;
      let m = mats.get(n);
      if (!m) {
        m = (base as THREE.MeshStandardMaterial).clone();
        if (!location.search.includes('noao')) (m as THREE.MeshStandardMaterial).aoMap = ao;
        (m as THREE.MeshStandardMaterial).aoMapIntensity = 1;
        // leaves and stalks are single sheets
        (m as THREE.MeshStandardMaterial).side = n === 'leaf' || n === 'crop' ? THREE.DoubleSide : THREE.FrontSide;
        // the baked map holds occlusion and weathering: let it darken sunlit surfaces too, not only ambient
        m.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
          #ifdef USE_AOMAP
            reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.85);
            reflectedLight.directSpecular *= ambientOcclusion;
          #endif`);
        };
        m.customProgramCacheKey = () => 'bldao';
        if (location.search.includes('aodebug')) {
          (m as THREE.MeshStandardMaterial).map = null;
          (m as THREE.MeshStandardMaterial).color.set(0xffffff);
        }
        const hide = new URLSearchParams(location.search).get('hide');
        if (hide && hide.split(',').includes(n)) m.visible = false;
        // WebGPU: the same direct-light AO as a lighting-model override (nodes.ts bakedAOMaterial)
        const g = gpu();
        if (g) m = g.bakedAOMaterial(m as any) as unknown as THREE.Material;
        mats.set(n, m);
      }
      return m;
    };
    if (!name.startsWith('plant_') && !location.search.includes('noquant')) quantize(root);
    const markers: THREE.Object3D[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => matFor(m.name));
        else mesh.material = matFor(mesh.material.name);
      } else {
        // GLTFLoader sanitises node names (drops ':' and '.'); the original survives in userData.name
        const n = (o.userData.name as string | undefined) ?? o.name;
        if (/^(smoke|sign:|flag|glow|hull$|deck$)/.test(n)) {
          o.name = n;
          markers.push(o);
        }
      }
    });
    const out = new THREE.Group();
    out.add(root);
    if (bare) return out;
    const smoke: THREE.Vector3[] = [];
    for (const m of markers) {
      m.name = m.name.replace(/\.\d{3}$/, ''); // blender suffixes duplicate names (smoke.001)
      const p = m.getWorldPosition(new THREE.Vector3());
      if (m.name.startsWith('smoke')) smoke.push(p);
      else if (m.name.startsWith('sign:')) {
        const s = sign(m.name.slice(5).replace(/_/g, ' '));
        s.scale.setScalar(0.5);
        s.position.copy(p).add(new THREE.Vector3(0, -0.1, 0));
        s.rotation.y = Math.PI / 2;
        const back = s.clone();
        back.rotation.y = -Math.PI / 2;
        s.position.x += 0.02;
        back.position.x -= 0.02;
        out.add(s, back);
      } else if (m.name.startsWith('glow')) {
        // glow:WxHxD - a box of embers or furnace mouth that flickers (see BuildingsView)
        const [w, h, d] = (m.name.split(':')[1] ?? '0.3x0.2x0.3').split('x').map(Number);
        // additive and soft, so it reads as heat in a dark mouth rather than an orange block
        const fm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
        const gl = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fm);
        gl.position.copy(p);
        gl.userData.glow = true;
        out.add(gl);
      } else if (m.name === 'hull') out.userData.hull = p;
      else if (m.name === 'deck') out.userData.deckY = p.y;
      else if (m.name.startsWith('flag')) {
        const f = flag(M().flagBlack, 0.01);
        f.position.copy(p);
        out.add(f);
      }
    }
    if (smoke.length) out.userData.smokeList = smoke;
    // building views read these hooks off the model root
    root.userData = {};
    // cache-owned: views clone these (sharing geometry and materials), so disposing a view must not free them
    markSharedTree(out);
    return out;
  }

  private merged = new Map<string, THREE.Mesh | null>();
  /** a model collapsed to one geometry (groups per material), for instancing (crop plants) */
  meshOf(name: string): THREE.Mesh | null {
    if (this.merged.has(name)) return this.merged.get(name)!;
    const s = this.src.get(name);
    let out: THREE.Mesh | null = null;
    if (s) {
      s.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = [];
      const mats: THREE.Material[] = [];
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(k)) g.deleteAttribute(k);
        geos.push(g.index ? g.toNonIndexed() : g);
        mats.push(m.material as THREE.Material);
      });
      const geo = geos.length ? mergeGeometries(geos, true) : null;
      if (geo) {
        out = new THREE.Mesh(geo, mats);
        markSharedTree(out);
      }
    }
    this.merged.set(name, out);
    return out;
  }

  has(name: string): boolean {
    return this.src.has(name) || this.far.has(name);
  }

  get(name: string): THREE.Group | null {
    const s = this.src.get(name);
    const farSrc = this.far.get(name);
    if (!s && !farSrc) return null;
    const base = (s ?? farSrc)!;
    const g = new THREE.Group();
    const force = location.search.match(/[?&]lod=(near|far)/)?.[1];
    if (s && farSrc && force !== 'near') {
      const near = s.clone(true);
      near.userData = {};
      const lod = new THREE.LOD();
      lod.addLevel(near, 0);
      // big buildings stay big on screen for longer: switch by apparent size, not a fixed distance
      const r = (s.userData.radius as number | undefined) ?? (s.userData.radius = new THREE.Box3().setFromObject(s).getBoundingSphere(new THREE.Sphere()).radius);
      lod.addLevel(farSrc.clone(true), force === 'far' ? 0.001 : this.lodDistance * (0.6 + r * 0.55));
      if (force === 'far') near.visible = false;
      g.add(lod);
    } else {
      const only = base.clone(true);
      only.userData = {};
      g.add(only);
    }
    if (base.userData.hull) g.userData.hull = (base.userData.hull as THREE.Vector3).clone();
    if (base.userData.deckY !== undefined) g.userData.deckY = base.userData.deckY;
    const list = base.userData.smokeList as THREE.Vector3[] | undefined;
    if (list?.length) {
      // the buildings view reads one smoke point per object; hang each on its own empty
      for (const p of list) {
        const e = new THREE.Object3D();
        e.userData.smoke = p.clone();
        g.add(e);
      }
    }
    return g;
  }
}

export const bldModels = new BuildingModels();
