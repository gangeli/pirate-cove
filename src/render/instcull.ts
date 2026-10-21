import * as THREE from 'three';

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

  /** a sphere some pass can see */
  sees(x: number, y: number, z: number, r: number): boolean {
    this.s.center.set(x, y, z);
    this.s.radius = r;
    return this.view.intersectsSphere(this.s) || (this.shadowOn && this.shadow.intersectsSphere(this.s));
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

/** a mesh the culler packs instances into, with its own copies of the instanced geometry attributes */
interface Target {
  mesh: THREE.InstancedMesh;
  attrs: { a: THREE.InstancedBufferAttribute; src: Float32Array }[];
}

/**
 * Per-frame compaction of an InstancedMesh: the instances some pass can see are packed to the front of its
 * per-instance buffers (instance matrices, colours and any instanced geometry attributes, e.g. WebGPU wind data)
 * and `count` is cut to them. Order is kept, so the image is the same; uploads happen only when the set changes.
 * With `lod`, instances smaller on screen than `lod.px` pixels (their bounding diameter) go to `lod.far` instead,
 * a lighter model that looks the same at that size, built with the same instance layout.
 */
export class InstanceCuller {
  private readonly n: number;
  private readonly mat: Float32Array;
  private readonly col: Float32Array | null;
  private readonly targets: Target[];
  /** world-space sphere per instance: x, y, z, r (r without the pad: the LOD size) */
  private readonly sph: Float32Array;
  private readonly pad: number;
  /** per instance: 0 not drawn, 1 near model, 2 far model */
  private readonly vis: Uint8Array;
  private version = -1;

  /** `pad`: extra radius for the visibility test (wind sway, animation) */
  constructor(readonly mesh: THREE.InstancedMesh, pad = 0, private readonly lod?: { far: THREE.InstancedMesh; px: number }) {
    const n = (this.n = mesh.count);
    this.pad = pad;
    this.mat = mesh.instanceMatrix.array.slice(0, n * 16) as Float32Array;
    this.col = mesh.instanceColor ? (mesh.instanceColor.array.slice(0, n * 3) as Float32Array) : null;
    const srcAttrs = new Map<string, Float32Array>();
    for (const [k, a] of Object.entries(mesh.geometry.attributes)) {
      const ia = a as THREE.InstancedBufferAttribute;
      if (ia.isInstancedBufferAttribute && ia.array instanceof Float32Array) srcAttrs.set(k, ia.array.slice(0, n * ia.itemSize));
    }
    const target = (m: THREE.InstancedMesh): Target => ({
      mesh: m,
      attrs: [...srcAttrs].flatMap(([k, src]) => {
        const a = m.geometry.attributes[k] as THREE.InstancedBufferAttribute | undefined;
        return a?.isInstancedBufferAttribute ? [{ a, src }] : [];
      }),
    });
    this.targets = [target(mesh)];
    if (lod) {
      this.targets.push(target(lod.far));
      if (this.col && !lod.far.instanceColor) lod.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      lod.far.count = 0;
      lod.far.visible = false;
      lod.far.boundingSphere = null;
    }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const gs = mesh.geometry.boundingSphere!;
    mesh.updateMatrixWorld();
    const mw = mesh.matrixWorld, m = new THREE.Matrix4(), c = new THREE.Vector3();
    this.sph = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      m.fromArray(this.mat, i * 16).premultiply(mw);
      c.copy(gs.center).applyMatrix4(m);
      this.sph.set([c.x, c.y, c.z, gs.radius * m.getMaxScaleOnAxis()], i * 4);
    }
    this.vis = new Uint8Array(n).fill(1);
    // (three's own whole-mesh test keeps working on the full set's bounds)
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    if (lod) lod.far.boundingSphere = mesh.boundingSphere!.clone();
  }

  /** pack the visible instances (each into its LOD's mesh) */
  cull(v: ViewVolumes): void {
    if (NO_CULL || v.version === this.version) return;
    this.version = v.version;
    const s = this.sph, vis = this.vis, pad = this.pad, lod = this.lod;
    let changed = false;
    for (let i = 0; i < this.n; i++) {
      const x = s[i * 4], y = s[i * 4 + 1], z = s[i * 4 + 2], r = s[i * 4 + 3];
      let on = v.sees(x, y, z, r + pad) ? 1 : 0;
      if (on && lod && v.pixels(x, y, z, 2 * r) < lod.px) on = 2;
      if (on !== vis[i]) (vis[i] = on), (changed = true);
    }
    if (!changed) return;
    for (let t = 0; t < this.targets.length; t++) {
      const { mesh: im, attrs } = this.targets[t];
      const dm = im.instanceMatrix.array as Float32Array, dc = im.instanceColor?.array as Float32Array | undefined;
      let j = 0;
      for (let i = 0; i < this.n; i++) {
        if (vis[i] !== t + 1) continue;
        dm.set(this.mat.subarray(i * 16, i * 16 + 16), j * 16);
        if (this.col && dc) dc.set(this.col.subarray(i * 3, i * 3 + 3), j * 3);
        for (const { a, src } of attrs) {
          const zz = a.itemSize;
          (a.array as Float32Array).set(src.subarray(i * zz, i * zz + zz), j * zz);
        }
        j++;
      }
      im.count = j;
      im.visible = j > 0;
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
