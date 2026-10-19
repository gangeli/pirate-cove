import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { assetUrl, loadTex } from './textures';
import { M, sign, flag } from './kit';

/**
 * Building models made in Blender (scripts/blender/bld). Each GLB names its material slots after the shared
 * materials in kit.ts; those are swapped in (cloned once per model to carry its baked ambient-occlusion map
 * on the second UV set). Marker nodes become the hooks the buildings view already understands:
 * smoke (chimney smoke), sign:TEXT (painted board), flag (pirate flag on a pole).
 */
class BuildingModels {
  private src = new Map<string, THREE.Group>();
  private far = new Map<string, THREE.Group>();
  /** camera distance (tiles) beyond which the decimated model is drawn */
  lodDistance = 15;
  loaded = false;

  async load(): Promise<void> {
    let names: string[] = [];
    try {
      const r = await fetch(assetUrl('buildings/index.json'));
      if (r.ok) names = await r.json();
    } catch {
      return;
    }
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    await Promise.all(names.map(async (name) => {
      try {
        const [gltf, lod] = await Promise.all([
          loader.loadAsync(assetUrl(`buildings/${name}.glb`)),
          loader.loadAsync(assetUrl(`buildings/${name}_lod.glb`)).catch(() => null),
        ]);
        const mats = new Map<string, THREE.Material>();
        this.src.set(name, this.prepare(name, gltf.scene, mats));
        if (lod) this.far.set(name, this.prepare(name + '_lod', lod.scene, new Map(), true));
      } catch (e) {
        console.warn('building model failed', name, e);
      }
    }));
    this.loaded = true;
  }

  private prepare(name: string, root: THREE.Group, mats: Map<string, THREE.Material>, bare = false): THREE.Group {
    const k = M() as unknown as Record<string, THREE.Material>;
    const ao = loadTex(`buildings/${name}_ao.jpg`, false, false);
    ao.channel = 1;
    ao.flipY = false;
    const matFor = (n: string): THREE.Material => {
      const base = k[n] ?? k.plaster;
      // glowing windows stay shared so night lighting reaches them all
      if (n === 'window' || n === 'black') return base;
      let m = mats.get(n);
      if (!m) {
        m = (base as THREE.MeshStandardMaterial).clone();
        if (!location.search.includes('noao')) (m as THREE.MeshStandardMaterial).aoMap = ao;
        (m as THREE.MeshStandardMaterial).aoMapIntensity = 1;
        (m as THREE.MeshStandardMaterial).side = THREE.FrontSide;
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
        mats.set(n, m);
      }
      return m;
    };
    const markers: THREE.Object3D[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => matFor(m.name));
        else mesh.material = matFor(mesh.material.name);
      } else if (/^(smoke|sign:|flag|glow|hull$|deck$)/.test(o.name)) markers.push(o);
    });
    const out = new THREE.Group();
    out.add(root);
    if (bare) return out;
    const smoke: THREE.Vector3[] = [];
    for (const m of markers) {
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
        const gl = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), (M() as any).fire.clone());
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
    return out;
  }

  has(name: string): boolean {
    return this.src.has(name);
  }

  get(name: string): THREE.Group | null {
    const s = this.src.get(name);
    if (!s) return null;
    const near = s.clone(true);
    near.userData = {};
    const farSrc = this.far.get(name);
    const g = new THREE.Group();
    const force = location.search.match(/[?&]lod=(near|far)/)?.[1];
    if (farSrc && force !== 'near') {
      const lod = new THREE.LOD();
      lod.addLevel(near, 0);
      lod.addLevel(farSrc.clone(true), force === 'far' ? 0.001 : this.lodDistance);
      if (force === 'far') near.visible = false;
      g.add(lod);
    } else g.add(near);
    if (s.userData.hull) g.userData.hull = (s.userData.hull as THREE.Vector3).clone();
    if (s.userData.deckY !== undefined) g.userData.deckY = s.userData.deckY;
    const list = s.userData.smokeList as THREE.Vector3[] | undefined;
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
