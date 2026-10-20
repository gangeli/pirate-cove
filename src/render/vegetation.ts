import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameMap } from '../sim/map';
import { Terrain } from '../sim/map';
import { loadTex } from './textures';
import { gpu } from './backend';

/** shared wind uniform */
export const wind = { uTime: { value: 0 }, uWind: { value: 1 } };

function hash(x: number, y: number, s = 0): number {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ s * 83492791, 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** paint a palm frond (one side) on a canvas: rachis along x, leaflets either side */
function frondTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 256);
  const mid = 128;
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const x = 18 + t * 480;
    const len = (Math.sin(t * Math.PI) * 0.85 + 0.15) * 112;
    for (const side of [-1, 1]) {
      const ang = side * (0.95 - t * 0.35);
      const ex = x + Math.cos(ang) * len * 0.55 + 18, ey = mid + Math.sin(ang) * len;
      const grad = g.createLinearGradient(x, mid, ex, ey);
      const hue = 88 + (hash(i, side) - 0.5) * 18;
      grad.addColorStop(0, `hsl(${hue}, 55%, 22%)`);
      grad.addColorStop(0.6, `hsl(${hue + 6}, 60%, 34%)`);
      grad.addColorStop(1, `hsl(${hue + 14}, 55%, 44%)`);
      g.strokeStyle = grad;
      g.lineCap = 'round';
      g.lineWidth = 7 - t * 3;
      g.beginPath();
      g.moveTo(x, mid);
      g.quadraticCurveTo(x + (ex - x) * 0.4, mid + (ey - mid) * 0.6 + side * 6, ex, ey);
      g.stroke();
    }
  }
  g.strokeStyle = '#5a5a2a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(500, mid);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** leaf-cluster card texture with alpha for broadleaf jungle trees */
function leafTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const a = hash(i, 1) * Math.PI * 2, r = Math.sqrt(hash(i, 2)) * 100;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const s = 10 + hash(i, 3) * 10;
    const l = 22 + hash(i, 4) * 26;
    g.save();
    g.translate(x, y);
    g.rotate(hash(i, 7) * Math.PI * 2);
    g.fillStyle = `hsl(${92 + hash(i, 5) * 34}, ${48 + hash(i, 6) * 22}%, ${l}%)`;
    g.beginPath();
    g.moveTo(-s, 0);
    g.quadraticCurveTo(0, -s * 0.55, s, 0);
    g.quadraticCurveTo(0, s * 0.55, -s, 0);
    g.fill();
    g.strokeStyle = `hsla(90, 40%, ${l + 15}%, 0.5)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-s, 0);
    g.lineTo(s, 0);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function windify(mat: THREE.Material, stiff = 1): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wpos = instanceMatrix * vec4(position, 1.0);
          float h = max(0.0, position.y);
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * uWind;
          float flutter = sin(uTime * 7.0 + position.x * 3.0 + position.z * 2.0 + ph) * 0.03 * uWind;
          transformed.x += (sway * 0.05 * h * h / ${stiff.toFixed(2)}) + flutter * h;
          transformed.z += (sway * 0.03 * h * h / ${stiff.toFixed(2)});
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'wind' + stiff;
}

function palmGeometry(): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  // curved trunk
  const pts: THREE.Vector3[] = [];
  const H = 5.2;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(Math.sin(t * 1.4) * 0.9 * t, t * H, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 14, 0.16, 7, false);
  // taper
  const p = trunk.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / H;
    const c = curve.getPointAt(Math.min(1, Math.max(0, t)));
    const k = 1.25 - t * 0.45;
    p.setX(i, c.x + (p.getX(i) - c.x) * k);
    p.setZ(i, c.z + (p.getZ(i) - c.z) * k);
  }
  // rings uv for bark
  const uv = trunk.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i));
  trunk.computeVertexNormals();
  const top = curve.getPointAt(1);
  // fronds: arched ribbons
  const frs: THREE.BufferGeometry[] = [];
  const N = 11;
  for (let f = 0; f < N; f++) {
    const ang = (f / N) * Math.PI * 2 + hash(f, 9) * 0.3;
    const len = 2.6 + hash(f, 3) * 0.9;
    const droop = 0.9 + hash(f, 4) * 0.7;
    const seg = 8;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const r = t * len;
      const y = Math.sin(t * Math.PI * 0.55) * 0.9 - t * t * droop * 1.6 + 0.2;
      const w = 0.95 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.9 + 0.05;
      const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
      const px = -Math.sin(ang) * w, pz = Math.cos(ang) * w;
      // slight V-fold: edges lower than the rachis
      pos.push(cx + px, y - 0.18 * w, cz + pz, cx - px, y - 0.18 * w, cz - pz, cx, y, cz);
      uvs.push(t, 1, t, 0, t, 0.5);
      if (i < seg) {
        const a = i * 3, b = (i + 1) * 3;
        idx.push(a, b, a + 2, b, b + 2, a + 2, a + 2, b + 2, a + 1, b + 2, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.translate(top.x, top.y, top.z);
    frs.push(geo);
  }
  // coconuts
  for (let i = 0; i < 4; i++) {
    const s = new THREE.SphereGeometry(0.17, 6, 5);
    const a = i * 1.7;
    s.translate(top.x + Math.cos(a) * 0.22, top.y - 0.15, top.z + Math.sin(a) * 0.22);
    // give them the frond uv region of the rachis colour
    const u = s.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < u.count; k++) u.setXY(k, 0.02, 0.5);
    s.deleteAttribute('normal');
    frs.push(s);
  }
  const fronds = mergeGeometries(frs.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  fronds.computeVertexNormals();
  // bias normals upward for softer canopy shading
  const n = fronds.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i), Math.abs(n.getY(i)) + 0.6, n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return { trunk, fronds };
}

function broadleafGeometry(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.14, 0.3, 3.6, 7, 3);
  trunk.translate(0, 1.8, 0);
  // gnarl the trunk a little
  const tp = trunk.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    tp.setX(i, tp.getX(i) + Math.sin(y * 1.7) * 0.12);
    tp.setZ(i, tp.getZ(i) + Math.cos(y * 1.3) * 0.08);
  }
  trunk.computeVertexNormals();
  const cards: THREE.BufferGeometry[] = [];
  const N = 46;
  const centre = new THREE.Vector3(0, 4.2, 0);
  for (let i = 0; i < N; i++) {
    // points in an ellipsoid shell
    const u = hash(i, 11), v = hash(i, 12);
    const th = u * Math.PI * 2, ph = Math.acos(1 - 2 * v * 0.85);
    const r = 0.75 + hash(i, 13) * 0.35;
    const p = new THREE.Vector3(Math.sin(ph) * Math.cos(th) * 2.0 * r, Math.cos(ph) * 1.25 * r, Math.sin(ph) * Math.sin(th) * 2.0 * r).add(centre);
    const size = 1.5 + hash(i, 14) * 0.7;
    const q = new THREE.PlaneGeometry(size, size);
    q.rotateX(-Math.PI / 2 + (hash(i, 15) - 0.5) * 1.6);
    q.rotateY(hash(i, 16) * Math.PI * 2);
    q.translate(p.x, p.y, p.z);
    // outward normals for soft lighting
    const n = q.getAttribute('normal') as THREE.BufferAttribute;
    const pos = q.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < n.count; k++) {
      const d = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(centre).normalize();
      d.y = d.y * 0.7 + 0.45;
      d.normalize();
      n.setXYZ(k, d.x, d.y, d.z);
    }
    cards.push(q.toNonIndexed());
  }
  const crown = mergeGeometries(cards)!;
  return { trunk, crown };
}

export class Vegetation {
  readonly group = new THREE.Group();
  private geo = { palm: palmGeometry(), broad: broadleafGeometry() };
  private mats: Record<string, THREE.Material> = {};

  constructor(private map: GameMap) {
    const bark = loadTex('tex/palmbark_d.jpg', true);
    const barkN = loadTex('tex/palmbark_n.jpg', false);
    // WebGPU: the node twin of windify (nodes.ts windMaterial), which needs the wind data in each chunk's geometry
    const g = gpu();
    const sway = (m: THREE.Material, stiff: number): THREE.Material => {
      if (!g) return windify(m, stiff), m;
      const n = g.windMaterial(m as any, stiff, wind.uTime, wind.uWind) as unknown as THREE.Material;
      m.dispose();
      return n;
    };
    const trunkMat = sway(new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, roughness: 0.9, color: 0xc8b8a0 }), 2.5);
    const frondMat = sway(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }), 1);
    const leafMat = sway(new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.8, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xffffff }), 3);
    const bTrunkMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: 0x8a7058, roughness: 1 });
    this.mats = { trunkMat, frondMat, leafMat, bTrunkMat };
    this.rebuild();
  }

  /** trees are instanced per CHUNK x CHUNK tile block so off-screen blocks drop out of the main and shadow passes */
  static readonly CHUNK = 40;
  private ghost = false;

  /** see-through trees (road tool): the ground underneath stays readable */
  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    for (const m of Object.values(this.mats)) {
      m.transparent = on;
      m.opacity = on ? 0.3 : 1;
      m.depthWrite = !on;
      // the alpha cut-out runs on opacity x texture alpha: scale it too or the faded leaves would all be cut away
      m.userData.alphaTest ??= m.alphaTest;
      m.alphaTest = on ? m.userData.alphaTest * 0.3 : m.userData.alphaTest;
      m.needsUpdate = true;
    }
    for (const c of this.group.children) c.castShadow = !on && c.userData.shadow !== false;
  }

  rebuild(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.InstancedMesh).dispose?.();
      // WebGPU chunks own a copy of the tree geometry (with their wind data): free it with the chunk
      if (c.userData.ownGeometry) (c as THREE.Mesh).geometry.dispose();
    }
    const m = this.map, n = m.size;
    const C = Vegetation.CHUNK, cn = Math.ceil(n / C);
    const chunks = Array.from({ length: cn * cn }, () => ({ palms: [] as THREE.Matrix4[], broads: [] as THREE.Matrix4[], bushes: [] as THREE.Matrix4[], pi: [] as number[], bi: [] as number[] }));
    let palmN = 0, broadN = 0;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const cnt = m.trees[k];
        if (!cnt) continue;
        const ch = chunks[Math.floor(y / C) * cn + Math.floor(x / C)];
        const t = m.terrain[k];
        const jungle = t === Terrain.Jungle;
        const per = jungle && cnt >= 3 ? 2 : 1;
        for (let i = 0; i < per; i++) {
          const jx = x + 0.2 + hash(x, y, i) * 0.6, jz = y + 0.2 + hash(y, x, i + 7) * 0.6;
          const h = m.heightAt(jx, jz);
          const usePalm = !jungle ? true : hash(x, y, 31 + i) < 0.22;
          const sc = (usePalm ? 0.42 : 0.4) + hash(x, y, 5 + i) * 0.22 + (jungle ? cnt * 0.03 : 0);
          e.set((hash(x, y, 11) - 0.5) * 0.12, hash(x, y, 12 + i) * Math.PI * 2, (hash(x, y, 13) - 0.5) * 0.12);
          q.setFromEuler(e);
          s.set(sc, sc * (0.9 + hash(x, y, 14) * 0.25), sc);
          p.set(jx, h - 0.05, jz);
          const mat = new THREE.Matrix4().compose(p, q, s);
          // the colour variety keeps its old per-tree sequence (index over the whole island)
          if (usePalm) ch.palms.push(mat), ch.pi.push(palmN++);
          else ch.broads.push(mat), ch.bi.push(broadN++);
        }
        if (jungle && hash(x, y, 40) < 0.7) {
          const jx = x + hash(x, y, 41), jz = y + hash(x, y, 42);
          const sc = 0.35 + hash(x, y, 43) * 0.35;
          q.setFromEuler(e.set(0, hash(x, y, 44) * 6.28, 0));
          ch.bushes.push(new THREE.Matrix4().compose(p.set(jx, m.heightAt(jx, jz) - 1.2 * sc, jz), q, s.set(sc, sc * 0.8, sc)));
        }
      }
    const g = gpu();
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = true) => {
      if (!list.length) return null;
      const own = !!g && mat !== this.mats.bTrunkMat;
      const im = new THREE.InstancedMesh(own ? (g!.windGeometry(geo as any, list as any) as unknown as THREE.BufferGeometry) : geo, mat, list.length);
      im.userData.ownGeometry = own;
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.userData.shadow = shadow;
      im.castShadow = shadow && !this.ghost;
      im.receiveShadow = true;
      // wind sway moves crowns by well under a tile; pad the bounds so culling never clips a swaying edge
      im.computeBoundingSphere();
      im.boundingSphere!.radius += 1.5;
      im.frustumCulled = true;
      this.group.add(im);
      return im;
    };
    const col = new THREE.Color();
    for (const ch of chunks) {
      mk(this.geo.palm.trunk, this.mats.trunkMat, ch.palms);
      const fr = mk(this.geo.palm.fronds, this.mats.frondMat, ch.palms);
      mk(this.geo.broad.trunk, this.mats.bTrunkMat, ch.broads);
      const cr = mk(this.geo.broad.crown, this.mats.leafMat, ch.broads);
      // per-instance colour variety for crowns
      if (cr) ch.bi.forEach((g, i) => cr.setColorAt(i, col.setHSL(0.22 + hash(g, 1) * 0.08, 0.35 + hash(g, 2) * 0.3, 0.72 + hash(g, 3) * 0.25)));
      if (fr) ch.pi.forEach((g, i) => fr.setColorAt(i, col.setHSL(0.2 + hash(g, 4) * 0.06, 0.4 + hash(g, 5) * 0.3, 0.75 + hash(g, 6) * 0.25)));
      mk(this.geo.broad.crown, this.mats.leafMat, ch.bushes, false);
    }
  }
}
