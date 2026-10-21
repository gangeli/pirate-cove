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

/**
 * Per-frame compaction of an InstancedMesh: the instances some pass can see are packed to the front of its
 * per-instance buffers (instance matrices, colours and any instanced geometry attributes, e.g. WebGPU wind data)
 * and `count` is cut to them. Order is kept, so the image is the same; uploads happen only when the set changes.
 */
export class InstanceCuller {
  private readonly n: number;
  private readonly mat: Float32Array;
  private readonly col: Float32Array | null;
  private readonly attrs: { a: THREE.InstancedBufferAttribute; src: Float32Array }[] = [];
  /** world-space sphere per instance: x, y, z, r */
  private readonly sph: Float32Array;
  private readonly vis: Uint8Array;
  private version = -1;
  private visCount = -1;

  /** `pad`: extra radius (wind sway, animation) */
  constructor(readonly mesh: THREE.InstancedMesh, pad = 0) {
    const n = (this.n = mesh.count);
    this.mat = mesh.instanceMatrix.array.slice(0, n * 16) as Float32Array;
    this.col = mesh.instanceColor ? (mesh.instanceColor.array.slice(0, n * 3) as Float32Array) : null;
    for (const a of Object.values(mesh.geometry.attributes)) {
      const ia = a as THREE.InstancedBufferAttribute;
      if (ia.isInstancedBufferAttribute && ia.array instanceof Float32Array) this.attrs.push({ a: ia, src: ia.array.slice(0, n * ia.itemSize) });
    }
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    const gs = mesh.geometry.boundingSphere!;
    mesh.updateMatrixWorld();
    const mw = mesh.matrixWorld, m = new THREE.Matrix4(), c = new THREE.Vector3();
    this.sph = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      m.fromArray(this.mat, i * 16).premultiply(mw);
      c.copy(gs.center).applyMatrix4(m);
      this.sph.set([c.x, c.y, c.z, gs.radius * m.getMaxScaleOnAxis() + pad], i * 4);
    }
    this.vis = new Uint8Array(n).fill(1);
    // (three's own whole-mesh test keeps working on the full set's bounds)
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  }

  /** pack the visible instances; returns how many are drawn */
  cull(v: ViewVolumes): number {
    if (v.version === this.version) return this.visCount;
    this.version = v.version;
    const s = this.sph, vis = this.vis;
    let changed = false, k = 0;
    for (let i = 0; i < this.n; i++) {
      const on = v.sees(s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]) ? 1 : 0;
      if (on !== vis[i]) (vis[i] = on), (changed = true);
      k += on;
    }
    if (!changed && k === this.visCount) return k;
    this.visCount = k;
    const im = this.mesh;
    const dm = im.instanceMatrix.array as Float32Array, dc = im.instanceColor?.array as Float32Array | undefined;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      if (!vis[i]) continue;
      dm.set(this.mat.subarray(i * 16, i * 16 + 16), j * 16);
      if (this.col && dc) dc.set(this.col.subarray(i * 3, i * 3 + 3), j * 3);
      for (const { a, src } of this.attrs) {
        const z = a.itemSize;
        (a.array as Float32Array).set(src.subarray(i * z, i * z + z), j * z);
      }
      j++;
    }
    im.count = k;
    im.visible = k > 0;
    const up = (a: THREE.BufferAttribute, z: number) => {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, k) * z);
      a.needsUpdate = true;
    };
    up(im.instanceMatrix, 16);
    if (im.instanceColor) up(im.instanceColor, 3);
    for (const { a } of this.attrs) up(a, a.itemSize);
    return k;
  }

  /** all instances back (e.g. before the mesh is rebuilt or measured) */
  get total(): number {
    return this.n;
  }
}
