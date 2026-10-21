import * as THREE from 'three';
import { gpu } from './backend';

/**
 * What the frame's render passes can see: the view frustum, plus the sun's shadow frustum (casters outside the view
 * whose shadows fall into it). three culls an InstancedMesh by ONE sphere around all its instances, so a batch that
 * spans the island draws every instance in every pass as soon as any of them is in view; InstanceCuller below keeps
 * only the instances inside these volumes. An instance outside both draws nothing in any pass (main, shadow map, AO
 * pre-pass), so leaving it out gives the same image.
 */
export class ViewVolumes {
  readonly view = new THREE.Frustum();
  readonly shadow = new THREE.Frustum();
  shadowOn = false;
  /** bumped whenever either volume changes (cullers skip work while it stands still) */
  version = 0;
  private readonly m = new THREE.Matrix4();
  private readonly lastView = new THREE.Matrix4();
  private readonly lastShadow = new THREE.Matrix4();
  /** screen height in px and the focal factor (px per unit at distance 1), for screen-size tests */
  private pxPerRad = 1;
  readonly eye = new THREE.Vector3();
  private readonly s = new THREE.Sphere();

  update(cam: THREE.PerspectiveCamera, heightPx: number, shadowCam: THREE.OrthographicCamera | null): void {
    this.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    let changed = !this.m.equals(this.lastView);
    if (changed) {
      this.lastView.copy(this.m);
      this.view.setFromProjectionMatrix(this.m);
    }
    this.eye.setFromMatrixPosition(cam.matrixWorld);
    this.pxPerRad = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const on = !!shadowCam;
    if (on !== this.shadowOn) (this.shadowOn = on), (changed = true);
    if (shadowCam) {
      this.m.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
      if (!this.m.equals(this.lastShadow)) {
        this.lastShadow.copy(this.m);
        this.shadow.setFromProjectionMatrix(this.m);
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  /** re-run every culler on the next frame (after a debug switch) */
  touch(): void {
    this.version++;
  }

  /** a sphere some pass can see */
  sees(x: number, y: number, z: number, r: number): boolean {
    this.s.center.set(x, y, z);
    this.s.radius = r;
    return this.view.intersectsSphere(this.s) || (this.shadowOn && this.shadow.intersectsSphere(this.s));
  }

  /** inside the sun's shadow frustum (false while shadows are off) */
  inShadow(x: number, y: number, z: number, r: number): boolean {
    if (!this.shadowOn) return false;
    this.s.center.set(x, y, z);
    this.s.radius = r;
    return this.shadow.intersectsSphere(this.s);
  }

  /** in the view itself (not just casting a shadow into it) */
  inView(x: number, y: number, z: number, r: number): boolean {
    this.s.center.set(x, y, z);
    this.s.radius = r;
    return this.view.intersectsSphere(this.s);
  }

  /** about how many pixels tall a thing of world height h at (x, y, z) stands on screen */
  pixels(x: number, y: number, z: number, h: number): number {
    const d = Math.max(1e-3, Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z));
    return (h / d) * this.pxPerRad;
  }
}

/** ?nocull=1: every instance drawn (before/after comparisons) */
const NO_CULL = typeof location !== 'undefined' && /[?&]nocull=1/.test(location.search);

/** debug switches (A/B in one page, see World.setCulling): culling off draws every instance in every pass, LOD off
 *  keeps every instance on its full model; the next cull applies them */
export const cullDebug = { cull: true, lod: true };

/**
 * Shadow-only twins (see InstanceCuller) are drawn by the shadow pass alone. WebGPU's shadow pass renders with the
 * sun's camera and its layers, so there they sit on SHADOW_LAYER, which only that camera sees. WebGL's shadow map
 * tests objects against the VIEW camera's layers instead, so there they stay hidden and installShadowTwins() shows
 * them just for the shadow-map render, which runs after the frame's draw lists are made and before they are drawn.
 */
export const SHADOW_LAYER = 1;
const twins = new Set<THREE.InstancedMesh>();

/** WebGL: show the shadow-only twins while (and only while) the renderer draws its shadow maps */
export function installShadowTwins(r: THREE.WebGLRenderer): void {
  const sm = r.shadowMap as THREE.WebGLShadowMap & { render: (...a: unknown[]) => void; __twins?: boolean };
  if (sm.__twins) return;
  sm.__twins = true;
  const render = sm.render;
  sm.render = function (this: unknown, ...a: unknown[]) {
    for (const t of twins) {
      if (!t.parent) twins.delete(t);
      else t.visible = t.count > 0;
    }
    try {
      render.apply(this, a);
    } finally {
      for (const t of twins) t.visible = false;
    }
  };
}

/** a mesh the culler packs instances into, with its own copies of the instanced geometry attributes */
interface Target {
  mesh: THREE.InstancedMesh;
  attrs: { a: THREE.InstancedBufferAttribute; src: Float32Array }[];
  /** instance codes (bits, see cull) that go into this mesh */
  mask: number;
  /** a WebGL shadow-only twin: kept hidden (installShadowTwins shows it) */
  hidden: boolean;
}

/**
 * Per-frame compaction of an InstancedMesh: the instances a pass can see are packed to the front of its
 * per-instance buffers (instance matrices, colours and any instanced geometry attributes, e.g. WebGPU wind data)
 * and `count` is cut to them. Order is kept and an instance left out draws nothing in that pass, so the image is the
 * same; uploads happen only when the set changes.
 *
 * Shadow casters get a twin on SHADOW_LAYER that only the shadow pass draws, holding the instances in the sun's
 * frustum, while the mesh itself stops casting and holds only those in the view: the casters just outside the view
 * whose shadows reach into it (often more than those in it) then cost nothing in the main and AO passes.
 *
 * With `lod`, instances smaller on screen than `lod.px` pixels (their bounding diameter) go to `lod.far` instead,
 * a lighter model that looks the same at that size, built with the same instance layout (and shadow twin).
 */
export class InstanceCuller {
  private readonly n: number;
  private readonly mat: Float32Array;
  private readonly col: Float32Array | null;
  private readonly targets: Target[] = [];
  /** meshes the culler made (shadow twins): the owner removes and disposes them with the rest */
  readonly made: THREE.InstancedMesh[] = [];
  /** world-space sphere per instance: x, y, z, r (r without the pad: the LOD size) */
  private readonly sph: Float32Array;
  private readonly pad: number;
  /** per instance: bit 0 in view (near model), 1 in view (far model), 2 in the sun's frustum (near), 3 (far) */
  private readonly vis: Uint8Array;
  private version = -1;

  /** `pad`: extra radius for the visibility test (wind sway, animation); `casts`: the mesh is a shadow caster (even
   *  if its castShadow is off for now, e.g. trees see-through under the road tool: the twin then takes the switch) */
  constructor(readonly mesh: THREE.InstancedMesh, pad = 0, private readonly lod?: { far: THREE.InstancedMesh; px: number }, casts = mesh.castShadow) {
    const n = (this.n = mesh.count);
    this.pad = pad;
    this.mat = mesh.instanceMatrix.array.slice(0, n * 16) as Float32Array;
    this.col = mesh.instanceColor ? (mesh.instanceColor.array.slice(0, n * 3) as Float32Array) : null;
    const srcAttrs = new Map<string, Float32Array>();
    for (const [k, a] of Object.entries(mesh.geometry.attributes)) {
      const ia = a as THREE.InstancedBufferAttribute;
      if (ia.isInstancedBufferAttribute && ia.array instanceof Float32Array) srcAttrs.set(k, ia.array.slice(0, n * ia.itemSize));
    }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    mesh.updateMatrixWorld();
    // (three's own whole-mesh test keeps working on the full set's bounds)
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    const webgl = !gpu();
    const target = (m: THREE.InstancedMesh, mask: number) => {
      this.targets.push({
        mesh: m,
        mask,
        hidden: webgl && !!m.userData.shadowTwin,
        attrs: [...srcAttrs].flatMap(([k, src]) => {
          const a = m.geometry.attributes[k] as THREE.InstancedBufferAttribute | undefined;
          return a?.isInstancedBufferAttribute ? [{ a, src }] : [];
        }),
      });
    };
    const twin = (m: THREE.InstancedMesh): THREE.InstancedMesh => {
      // its own copy of the geometry when that carries per-instance data, which differs per mesh once packed
      const own = srcAttrs.size > 0;
      const t = new THREE.InstancedMesh(own ? m.geometry.clone() : m.geometry, m.material, n);
      t.userData = { ...m.userData, ownGeometry: own, shadowTwin: true };
      t.customDepthMaterial = m.customDepthMaterial;
      t.customDistanceMaterial = m.customDistanceMaterial;
      t.renderOrder = m.renderOrder;
      if (webgl) twins.add(t);
      else t.layers.set(SHADOW_LAYER);
      t.castShadow = m.castShadow;
      t.receiveShadow = false;
      t.frustumCulled = m.frustumCulled;
      t.boundingSphere = mesh.boundingSphere!.clone();
      t.raycast = () => {};
      t.count = 0;
      t.visible = false;
      if (this.col) t.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      t.matrixAutoUpdate = m.matrixAutoUpdate;
      t.position.copy(m.position);
      t.quaternion.copy(m.quaternion);
      t.scale.copy(m.scale);
      m.parent?.add(t);
      t.updateMatrixWorld();
      m.castShadow = false;
      m.userData.shadow = false;
      this.made.push(t);
      return t;
    };
    if (lod) {
      if (this.col && !lod.far.instanceColor) lod.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      lod.far.count = 0;
      lod.far.visible = false;
      lod.far.boundingSphere = mesh.boundingSphere!.clone();
    }
    if (casts && !NO_CULL) {
      target(mesh, 1);
      target(twin(mesh), 4);
      if (lod) {
        target(lod.far, 2);
        target(twin(lod.far), 8);
      }
    } else {
      // no shadow: the view alone (?nocull: never packed, one mesh for every pass as before)
      target(mesh, 1);
      if (lod) target(lod.far, 2);
    }
    const gs = mesh.geometry.boundingSphere!;
    const mw = mesh.matrixWorld, m = new THREE.Matrix4(), c = new THREE.Vector3();
    this.sph = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      m.fromArray(this.mat, i * 16).premultiply(mw);
      c.copy(gs.center).applyMatrix4(m);
      this.sph.set([c.x, c.y, c.z, gs.radius * m.getMaxScaleOnAxis()], i * 4);
    }
    this.vis = new Uint8Array(n);
  }

  /** pack each pass's visible instances (each into its LOD's mesh) */
  cull(v: ViewVolumes): void {
    if (NO_CULL || v.version === this.version) return;
    const first = this.version === -1;
    this.version = v.version;
    const s = this.sph, vis = this.vis, pad = this.pad, lod = this.lod;
    // (the first call packs every target)
    let changed = first ? 0xff : 0;
    for (let i = 0; i < this.n; i++) {
      const x = s[i * 4], y = s[i * 4 + 1], z = s[i * 4 + 2], r = s[i * 4 + 3];
      const far = !!lod && cullDebug.lod && v.pixels(x, y, z, 2 * r) < lod.px;
      const all = !cullDebug.cull;
      const inView = all || v.inView(x, y, z, r + pad), inSun = all || v.inShadow(x, y, z, r + pad);
      const code = (inView ? (far ? 2 : 1) : 0) | (inSun ? (far ? 8 : 4) : 0);
      if (code !== vis[i]) {
        changed |= code ^ vis[i];
        vis[i] = code;
      }
    }
    for (const { mesh: im, attrs, mask, hidden } of this.targets) {
      if (!(changed & mask)) continue;
      const dm = im.instanceMatrix.array as Float32Array, dc = im.instanceColor?.array as Float32Array | undefined;
      let j = 0;
      for (let i = 0; i < this.n; i++) {
        if (!(vis[i] & mask)) continue;
        dm.set(this.mat.subarray(i * 16, i * 16 + 16), j * 16);
        if (this.col && dc) dc.set(this.col.subarray(i * 3, i * 3 + 3), j * 3);
        for (const { a, src } of attrs) {
          const zz = a.itemSize;
          (a.array as Float32Array).set(src.subarray(i * zz, i * zz + zz), j * zz);
        }
        j++;
      }
      im.count = j;
      im.visible = !hidden && j > 0;
      const up = (a: THREE.BufferAttribute, zz: number) => {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, j) * zz);
        a.needsUpdate = true;
      };
      up(im.instanceMatrix, 16);
      if (im.instanceColor) up(im.instanceColor, 3);
      for (const { a } of attrs) up(a, a.itemSize);
    }
  }
}
