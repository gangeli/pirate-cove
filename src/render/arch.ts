import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, boxGeo } from './kit';

/**
 * Period architecture for the colony: rubble footings, timber framing, plank and log walls, framed doors,
 * shuttered windows, layered thatch and barrel-tile roofs, porches. Everything is accumulated into a Bld
 * and merged per material, so a building can carry a few thousand triangles at a handful of draw calls.
 * Units are tiles (1 tile ~ 2 m); footprint centred on the origin, front facing +z, ground at y = 0.
 */

export type Face = 'front' | 'back' | 'left' | 'right';

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

export class Bld {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private loose: THREE.Object3D[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  readonly r: () => number;

  constructor(seed = 1) {
    this.r = rng(seed);
  }

  get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }
  /** enter a local frame: translate, then rotate about y */
  push(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): this {
    tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'YXZ'));
    this.stack.push(this.top.clone().multiply(tmpM.compose(tmpV.set(x, y, z), tmpQ, ONE)));
    return this;
  }
  pushM(m: THREE.Matrix4): this {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  /** a frame on one face of a w x d footprint: x runs along the face (left to right seen from outside), z points out */
  face(f: Face, w: number, d: number): this {
    if (f === 'front') return this.push(0, 0, d / 2, 0);
    if (f === 'back') return this.push(0, 0, -d / 2, Math.PI);
    if (f === 'left') return this.push(-w / 2, 0, 0, -Math.PI / 2);
    return this.push(w / 2, 0, 0, Math.PI / 2);
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'YXZ'));
    g.applyMatrix4(this.top.clone().multiply(tmpM.compose(tmpV.set(x, y, z), tmpQ, ONE)));
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
    return this;
  }
  /** box standing on y */
  box(mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, tex = 0.5): this {
    return this.add(boxGeo(w, h, d, tex).translate(0, h / 2, 0), mat, x, y, z, ry, rx, rz);
  }
  /** box centred on (x, y, z) */
  cbox(mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, tex = 0.5): this {
    return this.add(boxGeo(w, h, d, tex), mat, x, y, z, ry, rx, rz);
  }
  /** vertical cylinder standing on y */
  cyl(mat: THREE.Material, r0: number, r1: number, h: number, x = 0, y = 0, z = 0, seg = 8): this {
    return this.add(new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, h / 2, 0), mat, x, y, z);
  }
  /** a square-section timber (or round pole) from a to b in the current frame */
  beam(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, w: number, h = w, round = false): this {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return this;
    const geo = round ? new THREE.CylinderGeometry(w / 2, w / 2, len, 7) : boxGeo(w, len, h, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const g = geo.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, ONE));
    return this.add(g, mat);
  }
  /** an unmerged object (glowing windows, flags, signs) placed in the current frame */
  obj(o: THREE.Object3D, x = 0, y = 0, z = 0, ry = 0): this {
    const w = new THREE.Group();
    w.add(o);
    o.position.add(new THREE.Vector3(x, y, z));
    o.rotation.y += ry;
    w.applyMatrix4(this.top);
    this.loose.push(w);
    return this;
  }

  group(): THREE.Group {
    const g = new THREE.Group();
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    for (const o of this.loose) g.add(o);
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------------------------------------ footings

/** a footing of irregular coral-rubble stones under a w x d floor, h high */
export function plinth(b: Bld, w: number, d: number, h = 0.14, mat: THREE.Material = M().stone): void {
  b.box(mat, w, h * 0.85, d, 0, 0, 0, 0, 0, 0, 0.8);
  for (const f of ['front', 'back', 'left', 'right'] as Face[]) {
    const len = f === 'front' || f === 'back' ? w : d;
    b.face(f, w, d);
    let x = -len / 2;
    for (let row = 0; row < 2; row++) {
      x = -len / 2 + (row ? 0.07 : 0);
      while (x < len / 2 - 0.04) {
        const sw = Math.min(len / 2 - x, 0.1 + b.r() * 0.12);
        const sh = h / 2 - 0.006;
        b.cbox(mat, sw - 0.012, sh, 0.04 + b.r() * 0.02, x + sw / 2, row * (h / 2) + sh / 2, 0.005, 0, (b.r() - 0.5) * 0.15, (b.r() - 0.5) * 0.1, 0.8);
        x += sw;
      }
    }
    b.pop();
  }
}

/** a raised plank floor on short posts (huts on stilts, porches) */
export function deck(b: Bld, w: number, d: number, h: number, mat: THREE.Material = M().planks, along: 'x' | 'z' = 'x'): void {
  const k = M();
  const nx = Math.max(2, Math.round(w / 0.9) + 1), nz = Math.max(2, Math.round(d / 0.9) + 1);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) b.cyl(k.wood, 0.045, 0.04, h - 0.04, -w / 2 + 0.06 + (i / (nx - 1)) * (w - 0.12), 0, -d / 2 + 0.06 + (j / (nz - 1)) * (d - 0.12), 6);
  const n = Math.round((along === 'x' ? d : w) / 0.11);
  for (let i = 0; i < n; i++) {
    const o = -((along === 'x' ? d : w) / 2) + ((i + 0.5) / n) * (along === 'x' ? d : w);
    const jit = (b.r() - 0.5) * 0.04;
    if (along === 'x') b.box(mat, w + jit, 0.035, 0.1, jit / 2, h - 0.035, o, 0, 0, 0, 1.2);
    else b.box(mat, 0.1, 0.035, d + jit, o, h - 0.035, jit / 2, 0, 0, 0, 1.2);
  }
}

// ------------------------------------------------------------------------------------------------ openings

export interface Opening {
  face: Face;
  x: number;
  kind: 'door' | 'window' | 'arch' | 'double';
  w?: number;
  h?: number;
  y?: number;
}

/** a framed plank door with Z bracing and iron strap hinges, in the current face frame */
export function door(b: Bld, x: number, w = 0.42, h = 0.88, y = 0, ajar = 0): void {
  const k = M();
  // dark doorway behind
  b.cbox(k.black, w, h, 0.02, x, y + h / 2, 0.012);
  // jambs and lintel
  b.box(k.darkwood, 0.06, h + 0.04, 0.07, x - w / 2 - 0.03, y, 0.02);
  b.box(k.darkwood, 0.06, h + 0.04, 0.07, x + w / 2 + 0.03, y, 0.02);
  b.box(k.darkwood, w + 0.2, 0.07, 0.08, x, y + h, 0.025);
  // the leaf, hinged on the left
  b.push(x - w / 2, y, 0.03, -ajar);
  const n = Math.max(3, Math.round(w / 0.1));
  for (let i = 0; i < n; i++) b.box(k.planksDark, w / n - 0.006, h - 0.02 - (i % 2) * 0.008, 0.035, (i + 0.5) * (w / n), 0.01, 0, 0, 0, 0, 1.4);
  // ledges and brace on the face
  for (const yy of [0.14, h - 0.18]) b.box(k.planksDark, w - 0.04, 0.06, 0.02, w / 2, yy, 0.026);
  b.beam(k.planksDark, V(0.05, 0.2, 0.028), V(w - 0.05, h - 0.2, 0.028), 0.05, 0.02);
  // strap hinges and ring
  for (const yy of [0.17, h - 0.15]) b.box(k.iron, w * 0.6, 0.025, 0.012, w * 0.3, yy, 0.04);
  b.add(new THREE.TorusGeometry(0.025, 0.005, 4, 8), k.iron, w * 0.82, h * 0.5, 0.045);
  b.pop();
  // threshold step
  b.box(k.stoneDark, w + 0.16, 0.05, 0.14, x, 0, 0.07, 0, 0, 0, 0.8);
}

/** a dark glazed opening that glows at night */
function pane(w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M().window);
  m.userData.window = true;
  return m;
}

/** a window with frame, sill, mullions and a pair of plank shutters thrown open */
export function windowAt(b: Bld, x: number, y: number, w = 0.3, h = 0.34, shutters = true, mat: THREE.Material = M().darkwood): void {
  const k = M();
  b.obj(pane(w, h), x, y + h / 2, 0.006);
  // frame
  b.box(mat, w + 0.08, 0.045, 0.07, x, y - 0.045, 0.02); // sill
  b.box(mat, w + 0.06, 0.04, 0.05, x, y + h, 0.015);
  b.box(mat, 0.035, h, 0.05, x - w / 2 - 0.0175, y, 0.015);
  b.box(mat, 0.035, h, 0.05, x + w / 2 + 0.0175, y, 0.015);
  b.box(mat, 0.022, h, 0.03, x, y, 0.012);
  b.box(mat, w, 0.022, 0.03, x, y + h * 0.5, 0.012);
  if (shutters) {
    for (const s of [-1, 1]) {
      b.push(x + s * (w / 2 + 0.035), y, 0.04, s * -1.9);
      const n = 3;
      for (let i = 0; i < n; i++) b.box(k.planks, w / 2 / n - 0.006, h - 0.01, 0.022, s * ((i + 0.5) * (w / 2 / n)), 0.005, 0, 0, 0, 0, 1.5);
      b.box(k.planks, w / 2 - 0.02, 0.04, 0.012, s * (w / 4), h * 0.25, 0.016);
      b.box(k.planks, w / 2 - 0.02, 0.04, 0.012, s * (w / 4), h * 0.7, 0.016);
      b.pop();
    }
  }
}

function openingsOn(f: Face, ops: Opening[]): Opening[] {
  return ops.filter((o) => o.face === f);
}

// ------------------------------------------------------------------------------------------------ walls

/**
 * Timber-framed walls: an infill core (plaster, wattle or planks) with exposed corner posts, sill and wall
 * plates, intermediate studs and corner braces, and the given doors and windows cut into the faces.
 */
export function framedWalls(b: Bld, w: number, d: number, h: number, infill: THREE.Material, ops: Opening[], frame: THREE.Material = M().darkwood, y0 = 0): void {
  b.box(infill, w - 0.02, h, d - 0.02, 0, y0, 0, 0, 0, 0, 0.5);
  for (const f of ['front', 'back', 'left', 'right'] as Face[]) {
    const len = f === 'front' || f === 'back' ? w : d;
    b.face(f, w, d).push(0, y0, 0);
    const mine = openingsOn(f, ops);
    const blocked = (x: number) => mine.some((o) => Math.abs(o.x - x) < (o.w ?? (o.kind === 'window' ? 0.3 : 0.42)) / 2 + 0.07);
    // sill and wall plate
    b.box(frame, len + 0.06, 0.07, 0.05, 0, 0, 0.012);
    b.box(frame, len + 0.06, 0.08, 0.05, 0, h - 0.08, 0.012);
    // corner posts
    for (const s of [-1, 1]) b.box(frame, 0.08, h, 0.06, s * (len / 2 - 0.02), 0, 0.01);
    // studs every ~0.55, skipping openings
    const n = Math.max(1, Math.round(len / 0.55));
    for (let i = 1; i < n; i++) {
      const x = -len / 2 + (i / n) * len;
      if (!blocked(x)) b.box(frame, 0.055, h - 0.1, 0.04, x, 0.06, 0.008);
    }
    // braces from the corners
    for (const s of [-1, 1]) {
      const x0 = s * (len / 2 - 0.06), x1 = s * (len / 2 - 0.06 - Math.min(0.42, len * 0.22));
      if (!blocked((x0 + x1) / 2)) b.beam(frame, V(x0, 0.07, 0.008), V(x1, h - 0.1, 0.008), 0.045, 0.03);
    }
    // a mid rail where there is wall
    for (let i = 0; i < n; i++) {
      const xa = -len / 2 + (i / n) * len + 0.03, xb = -len / 2 + ((i + 1) / n) * len - 0.03;
      if (!blocked((xa + xb) / 2)) b.box(frame, xb - xa, 0.045, 0.035, (xa + xb) / 2, h * 0.52, 0.006);
    }
    for (const o of mine) {
      if (o.kind === 'door' || o.kind === 'double') door(b, o.x, o.w ?? (o.kind === 'double' ? 0.62 : 0.42), o.h ?? Math.min(0.9, h - 0.1));
      else if (o.kind === 'window') windowAt(b, o.x, o.y ?? h * 0.38, o.w ?? 0.28, o.h ?? 0.32);
      else arch(b, o.x, o.w ?? 0.5, o.h ?? h * 0.8);
    }
    b.pop().pop();
  }
}

/** horizontal clapboard: overlapping boards, each tilted out at the bottom, over a core */
export function clapboardWalls(b: Bld, w: number, d: number, h: number, mat: THREE.Material, ops: Opening[], trim: THREE.Material = M().darkwood, y0 = 0): void {
  b.box(mat, w - 0.03, h, d - 0.03, 0, y0, 0, 0, 0, 0, 0.5);
  for (const f of ['front', 'back', 'left', 'right'] as Face[]) {
    const len = f === 'front' || f === 'back' ? w : d;
    b.face(f, w, d).push(0, y0, 0);
    const mine = openingsOn(f, ops);
    const rows = Math.round(h / 0.105);
    const bh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * bh;
      // split the course around any opening it meets
      let cuts: [number, number][] = [[-len / 2, len / 2]];
      for (const o of mine) {
        const ow = (o.w ?? (o.kind === 'window' ? 0.28 : 0.42)) / 2 + 0.05;
        const oy0 = o.kind === 'window' ? (o.y ?? h * 0.38) - 0.06 : 0;
        const oh = o.kind === 'window' ? (o.h ?? 0.32) + 0.1 : (o.h ?? Math.min(0.9, h - 0.1)) + 0.06;
        if (y + bh < oy0 || y > oy0 + oh) continue;
        cuts = cuts.flatMap(([a, c]) => (o.x + ow <= a || o.x - ow >= c ? [[a, c]] : [[a, o.x - ow], [o.x + ow, c]]).filter(([p, q]) => q - p > 0.02) as [number, number][]);
      }
      for (const [a, c] of cuts) b.box(mat, c - a, bh + 0.012, 0.022, (a + c) / 2, y, 0.012 + 0.008, 0, -0.09, 0, 1.4);
    }
    for (const s of [-1, 1]) b.box(trim, 0.07, h, 0.07, s * (len / 2 - 0.01), 0, 0.01);
    b.box(trim, len + 0.08, 0.07, 0.06, 0, h - 0.07, 0.02);
    for (const o of mine) {
      if (o.kind === 'door' || o.kind === 'double') door(b, o.x, o.w ?? (o.kind === 'double' ? 0.62 : 0.42), o.h ?? Math.min(0.9, h - 0.1));
      else if (o.kind === 'window') windowAt(b, o.x, o.y ?? h * 0.38, o.w ?? 0.28, o.h ?? 0.32);
      else arch(b, o.x, o.w ?? 0.5, o.h ?? h * 0.8);
    }
    b.pop().pop();
  }
}

/** walls of stacked logs, notched at the corners with the ends sticking out */
export function logWalls(b: Bld, w: number, d: number, h: number, ops: Opening[], y0 = 0): void {
  const k = M();
  const r = 0.055;
  const rows = Math.round(h / (r * 1.8));
  b.box(k.planksDark, w - 0.08, h, d - 0.08, 0, y0, 0);
  for (let i = 0; i < rows; i++) {
    const y = y0 + r + i * r * 1.8;
    const alongX = i % 2 === 0;
    for (const s of [-1, 1]) {
      const segs: [number, number][] = [[-(alongX ? w : d) / 2 - 0.12, (alongX ? w : d) / 2 + 0.12]];
      const f: Face = alongX ? (s > 0 ? 'front' : 'back') : s > 0 ? 'right' : 'left';
      let cuts = segs;
      for (const o of openingsOn(f, ops)) {
        const ow = (o.w ?? (o.kind === 'window' ? 0.28 : 0.42)) / 2 + 0.04;
        const oy0 = o.kind === 'window' ? (o.y ?? h * 0.38) - 0.05 : 0;
        const oh = o.kind === 'window' ? (o.h ?? 0.32) + 0.08 : (o.h ?? Math.min(0.9, h - 0.1)) + 0.04;
        if (y - y0 + r < oy0 || y - y0 - r > oy0 + oh) continue;
        // faces are viewed from outside; flip x for back/left so openings line up with the face frame
        const ox = f === 'back' || f === 'left' ? -o.x : o.x;
        cuts = cuts.flatMap(([a, c]) => (ox + ow <= a || ox - ow >= c ? [[a, c]] : [[a, ox - ow], [ox + ow, c]]).filter(([p, q]) => q - p > 0.03) as [number, number][]);
      }
      for (const [a, c] of cuts) {
        const len = c - a, mid = (a + c) / 2;
        const geo = new THREE.CylinderGeometry(r * (0.92 + b.r() * 0.12), r, len, 7).rotateZ(Math.PI / 2);
        if (alongX) b.add(geo, k.bark, mid, y, s * (d / 2 - 0.02));
        else b.add(geo.rotateY(Math.PI / 2), k.bark, s * (w / 2 - 0.02), y, mid);
      }
    }
  }
  for (const f of ['front', 'back', 'left', 'right'] as Face[]) {
    b.face(f, w, d).push(0, y0, 0.04);
    for (const o of openingsOn(f, ops)) {
      if (o.kind === 'door' || o.kind === 'double') door(b, o.x, o.w ?? (o.kind === 'double' ? 0.62 : 0.42), o.h ?? Math.min(0.9, h - 0.1));
      else if (o.kind === 'window') windowAt(b, o.x, o.y ?? h * 0.38, o.w ?? 0.26, o.h ?? 0.28);
    }
    b.pop().pop();
  }
}

/** rendered masonry (coral rag under lime) with dressed quoins at the corners */
export function masonryWalls(b: Bld, w: number, d: number, h: number, render: THREE.Material, ops: Opening[], quoin: THREE.Material = M().stoneDark, y0 = 0): void {
  b.box(render, w, h, d, 0, y0, 0, 0, 0, 0, 0.5);
  for (const f of ['front', 'back', 'left', 'right'] as Face[]) {
    const len = f === 'front' || f === 'back' ? w : d;
    b.face(f, w, d).push(0, y0, 0);
    const q = Math.round(h / 0.16);
    for (let i = 0; i < q; i++) for (const s of [-1, 1]) {
      const long = (i + (s > 0 ? 1 : 0)) % 2 === 0;
      b.box(quoin, long ? 0.2 : 0.12, 0.15, 0.025, s * (len / 2 - (long ? 0.1 : 0.06) + 0.005), i * 0.16 + 0.005, 0.005, 0, 0, 0, 0.8);
    }
    // a band of render scuffed off near the ground shows the rag stone
    b.box(quoin, len - 0.42, 0.1, 0.012, 0, 0, 0.004, 0, 0, 0, 0.8);
    for (const o of openingsOn(f, ops)) {
      if (o.kind === 'door' || o.kind === 'double') {
        const ow = o.w ?? (o.kind === 'double' ? 0.62 : 0.42);
        door(b, o.x, ow, o.h ?? Math.min(0.92, h - 0.15));
        // dressed stone surround
        b.box(quoin, ow + 0.24, 0.1, 0.03, o.x, (o.h ?? Math.min(0.92, h - 0.15)) + 0.04, 0.01);
      } else if (o.kind === 'window') {
        windowAt(b, o.x, o.y ?? h * 0.4, o.w ?? 0.3, o.h ?? 0.36);
        b.box(quoin, (o.w ?? 0.3) + 0.14, 0.06, 0.03, o.x, (o.y ?? h * 0.4) + (o.h ?? 0.36) + 0.05, 0.01);
      } else arch(b, o.x, o.w ?? 0.5, o.h ?? h * 0.8);
    }
    b.pop().pop();
  }
}

/** a round-headed open archway with voussoirs */
export function arch(b: Bld, x: number, w: number, h: number): void {
  const k = M();
  const r = w / 2;
  b.cbox(k.black, w, h - r, 0.02, x, (h - r) / 2, 0.01);
  b.add(new THREE.CircleGeometry(r, 12, 0, Math.PI), k.black, x, h - r, 0.011);
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    b.cbox(k.stoneDark, 0.07, 0.1, 0.05, x + Math.cos(a) * (r + 0.04), h - r + Math.sin(a) * (r + 0.04), 0.02, 0, 0, a - Math.PI / 2, 0.8);
  }
  for (const s of [-1, 1]) b.box(k.stoneDark, 0.08, h - r, 0.05, x + s * (r + 0.04), 0, 0.02, 0, 0, 0, 0.8);
}

// ------------------------------------------------------------------------------------------------ roofs

/**
 * Thick palm/grass thatch over a gable: the slab is built from staggered layers so the eave shows a deep,
 * ragged fringe, with a rolled ridge, exposed rafter feet under the eaves and wattle gables.
 */
export function thatchRoof(b: Bld, w: number, d: number, rise: number, opts: { over?: number; mat?: THREE.Material; gable?: THREE.Material; y?: number; hip?: boolean } = {}): void {
  const k = M();
  const mat = opts.mat ?? k.thatch, over = opts.over ?? 0.28, y = opts.y ?? 0;
  const hd = d / 2 + over;
  const slope = Math.hypot(hd, rise);
  const ang = Math.atan2(rise, hd);
  const layers = 3;
  for (const s of [-1, 1]) {
    // strips along the ridge with ragged eave lengths
    const strips = Math.max(4, Math.round((w + over * 2) / 0.25));
    const sw = (w + over * 2) / strips;
    for (let i = 0; i < strips; i++) {
      const x = -(w / 2 + over) + (i + 0.5) * sw;
      for (let L = 0; L < layers; L++) {
        const len = slope - L * 0.09 + (b.r() - 0.5) * 0.06;
        const t = 0.07;
        b.push(x, y + rise, 0, 0, s * (Math.PI / 2 - ang) * -1 + 0, 0);
        // local: from the ridge (origin) down the slope toward s*z
        b.pop();
        const dz = s * Math.cos(ang), dy = -Math.sin(ang);
        const mid = V(x, y + rise + dy * (len / 2) + L * 0.045 * Math.cos(ang), s * (len / 2) * Math.cos(ang) + -s * L * 0.045 * Math.sin(ang) * 0 + dz * 0);
        b.cbox(mat, sw * 1.04, t, len, mid.x, mid.y, s * (len / 2) * Math.cos(ang) - s * L * 0.02, 0, s * ang, 0, 0.6);
      }
    }
    // rafter feet poking out under the eave
    const nr = Math.max(3, Math.round(w / 0.45));
    for (let i = 0; i <= nr; i++) {
      const x = -w / 2 + (i / nr) * w;
      b.beam(k.darkwood, V(x, y - 0.02, s * (d / 2 - 0.02)), V(x, y - 0.02 - over * Math.tan(ang) * 0.9, s * (d / 2 + over * 0.85)), 0.045);
    }
  }
  // ridge roll
  b.add(new THREE.CylinderGeometry(0.09, 0.09, w + over * 2 + 0.06, 8).rotateZ(Math.PI / 2), opts.mat === k.thatchDark ? k.thatchDark : k.thatch, 0, y + rise + 0.04, 0);
  // ridge pegs
  for (let i = 0; i < Math.round(w / 0.35); i++) {
    const x = -w / 2 + (i + 0.5) * (w / Math.round(w / 0.35));
    b.beam(k.darkwood, V(x, y + rise - 0.04, -0.12), V(x, y + rise + 0.16, 0.12), 0.025);
  }
  if (!opts.hip) gables(b, w, d, rise, opts.gable ?? k.planksDark, y);
}

function gables(b: Bld, w: number, d: number, rise: number, mat: THREE.Material, y: number): void {
  const tri = new THREE.Shape();
  tri.moveTo(-d / 2, 0);
  tri.lineTo(d / 2, 0);
  tri.lineTo(0, rise * 0.96);
  tri.closePath();
  const tg = new THREE.ShapeGeometry(tri);
  const uv = tg.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  for (const s of [-1, 1]) {
    b.add(tg, mat, (s * w) / 2, y, 0, s * Math.PI / 2);
    // vertical boards on the gable
    const n = Math.round(d / 0.14);
    for (let i = 0; i < n; i++) {
      const z = -d / 2 + (i + 0.5) * (d / n);
      const hh = rise * 0.96 * (1 - Math.abs(z) / (d / 2)) - 0.02;
      if (hh > 0.04) b.box(mat, 0.012, hh, d / n - 0.012, s * (w / 2 + 0.008), y, z, 0, 0, 0, 1.4);
    }
  }
}

/** Spanish barrel tiles over a gable or hipped roof, with mortared ridge and a fascia */
export function tileRoof(b: Bld, w: number, d: number, rise: number, opts: { over?: number; y?: number; gable?: THREE.Material; hip?: boolean } = {}): void {
  const k = M();
  const over = opts.over ?? 0.22, y = opts.y ?? 0;
  const hd = d / 2 + over;
  const slope = Math.hypot(hd, rise);
  const ang = Math.atan2(rise, hd);
  const tw = 0.1;
  const tileGeo = (len: number) => new THREE.CylinderGeometry(tw * 0.48, tw * 0.55, len, 6, 1, true, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2 + Math.PI / 2);
  for (const s of [-1, 1]) {
    // underlay
    b.cbox(k.tiles, w + over * 2, 0.04, slope, 0, y + rise / 2 - 0.02, (s * hd) / 2, 0, s * ang, 0, 0.6);
    const n = Math.round((w + over * 2) / tw);
    for (let i = 0; i < n; i++) {
      const x = -(w / 2 + over) + (i + 0.5) * ((w + over * 2) / n);
      const len = slope + (b.r() - 0.5) * 0.02;
      const g = tileGeo(len);
      // the tile course: laid down the slope, alternating channel and cap rows
      const cap = i % 2 === 0;
      b.push(x, y + rise / 2 + (cap ? 0.035 : 0.005), (s * hd) / 2, 0, s * ang, 0);
      b.add(cap ? g : g.clone().rotateZ(Math.PI), k.tiles, 0, cap ? 0 : 0.04, 0);
      b.pop();
    }
    // fascia board
    b.cbox(k.darkwood, w + over * 2, 0.07, 0.035, 0, y - 0.01, s * (hd - 0.01), 0, 0, 0, 0.8);
  }
  b.add(new THREE.CylinderGeometry(0.075, 0.075, w + over * 2, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), k.tiles, 0, y + rise + 0.01, 0);
  if (!opts.hip) gables(b, w, d, rise, opts.gable ?? k.plaster, y);
}

/** a lean-to roof (sheds, porches) sloping toward +z */
export function leanTo(b: Bld, w: number, depth: number, hiY: number, loY: number, mat: THREE.Material, z0 = 0): void {
  const k = M();
  const len = Math.hypot(depth, hiY - loY);
  const ang = Math.atan2(hiY - loY, depth);
  b.cbox(mat, w, 0.07, len, 0, (hiY + loY) / 2, z0 + depth / 2, 0, ang, 0, 0.6);
  const nr = Math.max(2, Math.round(w / 0.5));
  for (let i = 0; i <= nr; i++) b.beam(k.darkwood, V(-w / 2 + 0.05 + (i / nr) * (w - 0.1), hiY - 0.05, z0), V(-w / 2 + 0.05 + (i / nr) * (w - 0.1), loY - 0.05, z0 + depth), 0.04);
}

/** a front porch: deck, posts and a lean-to over it, with a rail */
export function porch(b: Bld, w: number, depth: number, h: number, roof: THREE.Material, z0: number, rail = true): void {
  const k = M();
  b.push(0, 0, z0 + depth / 2);
  deck(b, w, depth, 0.1, k.planks, 'x');
  b.pop();
  const n = Math.max(2, Math.round(w / 0.8) + 1);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.05 + (i / (n - 1)) * (w - 0.1);
    b.cyl(k.wood, 0.035, 0.03, h - 0.12, x, 0.1, z0 + depth - 0.05, 6);
    if (rail && i < n - 1 && Math.abs(x + (w - 0.1) / (n - 1) / 2) > 0.3) {
      const x2 = -w / 2 + 0.05 + ((i + 1) / (n - 1)) * (w - 0.1);
      b.box(k.wood, x2 - x, 0.035, 0.035, (x + x2) / 2, 0.42, z0 + depth - 0.05);
      for (let j = 1; j < 4; j++) b.box(k.wood, 0.02, 0.3, 0.02, x + ((x2 - x) * j) / 4, 0.1, z0 + depth - 0.05);
    }
  }
  b.box(k.wood, w + 0.04, 0.06, 0.06, 0, h - 0.06, z0 + depth - 0.05);
  leanTo(b, w + 0.1, depth + 0.12, h + 0.12, h - 0.06, roof, z0 - 0.02);
}

/** a stone chimney stack of coursed rubble */
export function chimney(b: Bld, x: number, z: number, h: number, base = 0.3): void {
  const k = M();
  const rows = Math.round(h / 0.1);
  for (let i = 0; i < rows; i++) {
    const t = i / rows;
    const sz = base * (1 - t * 0.15);
    b.box(k.stone, sz + (b.r() - 0.5) * 0.02, 0.1, sz + (b.r() - 0.5) * 0.02, x, i * 0.1, z, (b.r() - 0.5) * 0.06, 0, 0, 0.9);
  }
  b.box(k.stoneDark, base * 1.0, 0.06, base * 1.0, x, rows * 0.1, z, 0, 0, 0, 0.8);
  b.box(k.black, base * 0.55, 0.02, base * 0.55, x, rows * 0.1 + 0.05, z);
}

// ------------------------------------------------------------------------------------------------ dressing

/** an oak cask with staves and iron hoops (standing) */
export function cask(b: Bld, x: number, z: number, s = 1, ry = 0, lying = false): void {
  const k = M();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2((0.12 + Math.sin(t * Math.PI) * 0.03) * s, t * 0.34 * s));
  }
  const geo = new THREE.LatheGeometry(pts, 14);
  const lid = new THREE.CircleGeometry(0.12 * s, 14).rotateX(-Math.PI / 2).translate(0, 0.335 * s, 0);
  b.push(x, lying ? 0.14 * s : 0, z, ry, 0, lying ? Math.PI / 2 : 0).push(0, lying ? -0.17 * s : 0, 0);
  b.add(geo, k.planksDark);
  b.add(lid, k.planksDark);
  for (const t of [0.12, 0.3, 0.7, 0.88]) {
    const r = (0.12 + Math.sin(t * Math.PI) * 0.03) * s + 0.004;
    b.add(new THREE.TorusGeometry(r, 0.008 * s, 3, 14).rotateX(Math.PI / 2), k.iron, 0, t * 0.34 * s, 0);
  }
  b.pop().pop();
}

/** a slatted crate */
export function crate(b: Bld, x: number, y: number, z: number, s = 0.3, ry = 0): void {
  const k = M();
  b.push(x, y, z, ry);
  b.box(k.oldplanks, s * 0.94, s * 0.94, s * 0.94, 0, s * 0.03, 0, 0, 0, 0, 1.5);
  for (const f of [-1, 1]) {
    for (const yy of [0.04, 0.5, 0.92]) b.box(k.planks, s, s * 0.1, 0.012, 0, s * yy - s * 0.05, f * s * 0.48);
    b.beam(k.planks, V(-s * 0.45, s * 0.08, f * s * 0.485), V(s * 0.45, s * 0.9, f * s * 0.485), s * 0.1, 0.012);
  }
  b.pop();
}

/** a coil of rope lying on the ground */
export function ropeCoil(b: Bld, x: number, z: number, r = 0.12): void {
  for (let i = 0; i < 3; i++) b.add(new THREE.TorusGeometry(r - i * 0.025, 0.014, 4, 14).rotateX(Math.PI / 2), M().rope, x, 0.014 + i * 0.022, z);
}

/** a fishing net draped over a rail */
export function netOnRail(b: Bld, x: number, z: number, w = 0.8, h = 0.4): void {
  const k = M();
  b.cyl(k.wood, 0.025, 0.025, h + 0.05, x - w / 2, 0, z, 5);
  b.cyl(k.wood, 0.025, 0.025, h + 0.05, x + w / 2, 0, z, 5);
  b.add(new THREE.CylinderGeometry(0.02, 0.02, w + 0.1, 5).rotateZ(Math.PI / 2), k.wood, x, h, z);
  const g = new THREE.PlaneGeometry(w, h * 0.9, 6, 3);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.02 + (p.getY(i) < 0 ? 0.03 : 0));
  g.computeVertexNormals();
  b.add(g, k.rope, x, h * 0.55, z + 0.02);
}

/** a lantern on an iron bracket, glowing at night */
export function lanternBracket(b: Bld, x: number, y: number): void {
  const k = M();
  b.box(k.iron, 0.02, 0.02, 0.2, x, y, 0.1);
  b.box(k.iron, 0.012, 0.06, 0.012, x, y - 0.06, 0.19);
  b.box(k.iron, 0.07, 0.012, 0.07, x, y - 0.075, 0.19);
  b.box(k.iron, 0.075, 0.012, 0.075, x, y - 0.2, 0.19);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.06), M().window);
  glass.userData.window = true;
  b.obj(glass, x, y - 0.14, 0.19);
}

/** a painted board hung from an iron arm by two chains */
export function hangingSign(b: Bld, x: number, y: number, s: THREE.Mesh): void {
  const k = M();
  b.box(k.iron, 0.02, 0.02, 0.5, x, y, 0.25);
  b.beam(k.iron, V(x, y - 0.18, 0.01), V(x, y, 0.32), 0.015);
  for (const zz of [0.12, 0.42]) b.box(k.iron, 0.008, 0.1, 0.008, x, y - 0.1, zz);
  s.scale.setScalar(0.5);
  s.rotation.y = Math.PI / 2;
  const back = s.clone();
  back.rotation.y = -Math.PI / 2;
  b.obj(s, x + 0.012, y - 0.18, 0.27);
  b.obj(back, x - 0.012, y - 0.18, 0.27);
  b.box(k.darkwood, 0.02, 0.17, 0.42, x, y - 0.265, 0.27);
}
