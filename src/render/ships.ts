import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { ShipType } from '../sim/data/ships';
import type { Ship } from '../sim/types';
import { dockBerth } from '../sim/people';
import type { World } from './world';
import { assetUrl } from './textures';
import { markSharedTree, markShared } from './dispose';
import { M, flag } from './kit';
import { bldModels } from './bldmodels';
import { wind } from './vegetation';
import { gpu } from './backend';
import type { Nation } from '../sim/data/kings';

/**
 * Ships, modelled in the buildings' kit (scripts/blender/bld/ships.py): one model per class, bow toward +x, the
 * waterline at y = 0, a real deck closing the hull. The sails are not in the model: each ship builds its own from
 * the model's sail plan (ship_<name>.json) so they can furl at the dock and set at sea, and a vertex shader billows
 * and flutters them (and the flags and pennants) with the world's clock, which stands still while the game is paused.
 */

/** the model each class sails in */
const MODEL: Record<ShipType, string> = { snow: 'snow', schooner: 'schooner', sloop: 'sloop', brigantine: 'brigantine', frigate: 'frigate', galleon: 'galleon' };
/** target length overall (bowsprit to boom end) in tiles per ship type */
const LENGTH: Record<ShipType, number> = { snow: 7, schooner: 7.5, sloop: 9, brigantine: 10, frigate: 12.5, galleon: 14 };
export const NAV_LENGTH = 9;
/** camera distance (in ship lengths) beyond which the far model is drawn */
const LOD_LENGTHS = 2.6;
/** the direction flags and pennants stream (world, radians about y) */
const WIND_DIR = 0.6;

interface SailDef { kind: 'sq' | 'fa' | 'jib'; c: number[][] }
interface Plan { length: number; height: number; beam: number; deck: number; draft: number; sails: SailDef[]; flags: { p: number[]; kind: string }[] }
interface ShipModel { near: THREE.Object3D | null; far: THREE.Object3D; plan: Plan }

const models = new Map<string, ShipModel>();
const loads = new Map<string, Promise<ShipModel | null>>();

function loadShipModel(k: string): Promise<ShipModel | null> {
  let p = loads.get(k);
  if (!p) {
    p = loadShipModelNow(k).then(
      (m) => (models.set(k, m), m),
      (e) => {
        console.warn('ship model failed', k, e);
        loads.delete(k); // asked for again on a later frame
        return null;
      },
    );
    loads.set(k, p);
  }
  return p;
}

async function loadShipModelNow(k: string): Promise<ShipModel> {
  const name = `ship_${k}`;
  const planP = fetch(assetUrl(`ships/${name}.json`)).then((r) => {
    if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
    return r.json() as Promise<Plan>;
  });
  // low quality draws the far model throughout (as for buildings)
  const [plan, far, near] = await Promise.all([planP, bldModels.loadKit('ships', `${name}_lod`), bldModels.fullDetail ? bldModels.loadKit('ships', name) : Promise.resolve(null)]);
  for (const m of [near, far]) {
    if (!m) continue;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    markSharedTree(m); // cached for the whole session: never freed with a game's views
  }
  return { near, far, plan };
}

/** the loaded model for a ship type, or null (its load is started, and the caller asks again next frame) */
function shipModel(type: ShipType): ShipModel | null {
  const m = models.get(MODEL[type]);
  if (m) return m;
  void loadShipModel(MODEL[type]);
  return null;
}

// ------------------------------------------------------------------------------------------- cloth (sails, flags)

/**
 * The cloth shader: every vertex moves along its normal by aSail.x (its belly) x a slow breathing plus aSail.y (its
 * free play) x a wave running along aSail.z (nodes.ts shipClothMaterial is the WebGPU twin). One program for all
 * the sails, flags and pennants of every ship; shadows are cast by the cloth at rest.
 */
const clothMats = new Map<THREE.Material, THREE.Material>();
function clothMaterial(base: THREE.Material): THREE.Material {
  let m = clothMats.get(base);
  if (m) return m;
  const g = gpu();
  if (g) m = g.shipClothMaterial(base as any, wind.uTime) as unknown as THREE.Material;
  else {
    m = base.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aSail;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float ph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.23;
            float breathe = sin(uTime * 1.3 + ph) * 0.12 + sin(uTime * 2.9 + ph * 1.7) * 0.05;
            transformed += objectNormal * (aSail.x * breathe + aSail.y * sin(uTime * 6.0 - aSail.z + ph));
          }`,
        );
    };
    m.customProgramCacheKey = () => 'shipcloth';
  }
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  markShared(m);
  clothMats.set(base, m);
  return m;
}

let sailBase: THREE.Material | null = null;

/** sailcloth: the kit's canvas colour, sewn from narrow vertical cloths, a little weathered toward the foot */
function sailMaterial(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece4d0';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) {
    const l = Math.random() < 0.5 ? 255 : 120;
    g.fillStyle = `rgba(${l},${l - 10},${l - 30},0.05)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  for (let x = 0; x < 128; x += 32) {
    g.fillStyle = 'rgba(120,100,70,0.35)';
    g.fillRect(x, 0, 1.5, 128);
    g.fillStyle = 'rgba(255,255,245,0.35)';
    g.fillRect(x + 2, 0, 1, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, color: new THREE.Color('#ddd2b8').multiplyScalar(1.12), roughness: 0.95, side: THREE.DoubleSide });
}
let pennantBase: THREE.Material | null = null;

/** sail grid resolution */
const NU = 8, NV = 6;

/**
 * One ship's sails as a single mesh. The rest shape, belly and furled shape of every vertex are kept, and
 * `setFurl` blends between set (0) and furled (1) on the CPU (only while a ship is furling or setting sail).
 */
class Sails {
  readonly mesh: THREE.Mesh;
  private rest: Float32Array;
  private belly: Float32Array;
  private furled: Float32Array;
  /** per vertex: belly depth, free play, wave phase, at full sail */
  private play: Float32Array;
  furl = -1;

  constructor(plan: Plan) {
    const n = plan.sails.length * (NU + 1) * (NV + 1);
    this.rest = new Float32Array(n * 3);
    this.belly = new Float32Array(n * 3);
    this.furled = new Float32Array(n * 3);
    this.play = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const p = new THREE.Vector3(), top = new THREE.Vector3(), bot = new THREE.Vector3(), q = new THREE.Vector3();
    let base = 0;
    for (const s of plan.sails) {
      [A, B, C, D].forEach((v, i) => v.fromArray(s.c[i]));
      // the side it bellies to: square sails forward, fore-and-aft sails to starboard (the wind is on the port side)
      const dir = s.kind === 'sq' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0.15, 0, 1).normalize();
      const width = Math.max(A.distanceTo(B), D.distanceTo(C)), height = Math.max(A.distanceTo(D), B.distanceTo(C));
      const depth = 0.13 * Math.min(width, height) + 0.02 * Math.max(width, height);
      const chord = s.kind === 'sq' ? height : width;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        for (let i = 0; i <= NU; i++) {
          const u = i / NU;
          const k = base + j * (NU + 1) + i;
          top.lerpVectors(A, B, u);
          bot.lerpVectors(D, C, u);
          p.lerpVectors(top, bot, v);
          p.toArray(this.rest, k * 3);
          let f: number, w: number, tr: number;
          if (s.kind === 'sq') {
            // lashed along the yard, held at the clews: deepest low in the middle, the foot free to flog
            f = Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * v * 0.5) ** 0.7 * (1 - 0.3 * v * v);
            w = v ** 1.2 * (0.3 + 0.7 * Math.sin(Math.PI * u));
            tr = v * chord * 2.4;
          } else {
            // laced to mast (luff) and spars or stay: the leech is free
            f = Math.sin(Math.PI * u * 0.9) ** 0.8 * Math.sin(Math.PI * (s.kind === 'jib' ? 0.2 + 0.6 * v : v)) ** 0.8;
            w = u ** 1.3 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, v * 1.1)));
            tr = u * chord * 2.4;
          }
          q.copy(dir).multiplyScalar(f * depth).toArray(this.belly, k * 3);
          this.play[k * 3] = f * depth;
          this.play[k * 3 + 1] = w * (0.012 + 0.008 * Math.min(width, height));
          this.play[k * 3 + 2] = tr;
          uv[k * 2] = u * width * 1.1;
          uv[k * 2 + 1] = v * height * 1.1;
          // furled: rolled up tight along the pinned edge (the yard, the boom or the foot of the stay)
          const r = 0.06 + 0.05 * Math.sin(Math.PI * u);
          const a = v * Math.PI * 2.6;
          if (s.kind === 'sq') {
            q.lerpVectors(A, B, 0.04 + u * 0.92).add(new THREE.Vector3(0.03 + Math.cos(a) * r, -0.08 + Math.sin(a) * r, 0));
          } else if (s.kind === 'fa') {
            q.lerpVectors(D, C, 0.03 + u * 0.94).add(new THREE.Vector3(0, 0.05 + Math.sin(a) * r, Math.cos(a) * r));
          } else {
            q.lerpVectors(D, C, u * 0.25).lerp(D, 0.15).add(new THREE.Vector3(0, 0.04 + Math.sin(a) * r, Math.cos(a) * r));
          }
          q.toArray(this.furled, k * 3);
        }
      }
      // wind each quad so its normal faces the belly side (the shader displaces along the normal)
      const n0 = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
      const flip = n0.dot(dir) < 0;
      for (let j = 0; j < NV; j++)
        for (let i = 0; i < NU; i++) {
          const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 2, d = a + NU + 1;
          if (flip) idx.push(a, d, b, b, d, c);
          else idx.push(a, b, d, b, c, d);
        }
      base += (NU + 1) * (NV + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSail', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    sailBase ??= sailMaterial();
    this.mesh = new THREE.Mesh(g, clothMaterial(sailBase));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'sails';
    this.setFurl(0);
  }

  setFurl(f: number): void {
    f = Math.max(0, Math.min(1, f));
    if (Math.abs(f - this.furl) < 1e-4) return;
    this.furl = f;
    const g = this.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute, ps = pos.array as Float32Array;
    const att = g.getAttribute('aSail') as THREE.BufferAttribute, as = att.array as Float32Array;
    // furling gathers the foot up first, then rolls it in
    const e = f * f * (3 - 2 * f), keep = 1 - e;
    for (let i = 0; i < ps.length; i++) ps[i] = (this.rest[i] + this.belly[i] * keep) * keep + this.furled[i] * e;
    for (let i = 0; i < as.length; i += 3) {
      as[i] = this.play[i] * keep;
      as[i + 1] = this.play[i + 1] * keep * keep;
      as[i + 2] = this.play[i + 2];
    }
    pos.needsUpdate = true;
    att.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** a flag's cloth: the kit flag with free play growing toward the fly, waving in the cloth shader */
function waveFlag(fl: THREE.Group): void {
  fl.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.userData.flag) return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const a = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const fx = pos.getX(i) + 0.35;
      a[i * 3 + 1] = 0.07 * fx;
      a[i * 3 + 2] = fx * 6;
    }
    g.setAttribute('aSail', new THREE.BufferAttribute(a, 3));
    m.material = clothMaterial(m.material as THREE.Material);
    m.castShadow = true;
  });
}

/** a long tapering masthead pennant streaming along local +x from the origin */
function pennant(len: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(len, 0.16, 14, 1);
  g.translate(len / 2, -0.08, 0);
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), t = x / len;
    pos.setY(i, -0.08 + (pos.getY(i) + 0.08) * (1 - 0.85 * t));
    a[i * 3 + 1] = 0.12 * t;
    a[i * 3 + 2] = t * 9;
  }
  g.setAttribute('aSail', new THREE.BufferAttribute(a, 3));
  g.computeVertexNormals();
  pennantBase ??= new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.9, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, clothMaterial(pennantBase));
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------------------------------- wake

let wakeMat: THREE.MeshBasicMaterial | null = null;
/** a foam decal on the water: bow wave, the two arms of the Kelvin wake and the churned trail astern (bow at +x) */
function wakeMaterial(): THREE.MeshBasicMaterial {
  if (wakeMat) return wakeMat;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  const bowX = 512 * 0.78, sternX = 512 * 0.5, cy = 96;
  g.lineCap = 'round';
  // the arms: two lines spreading from the bow, broken into flecks, fading aft
  for (let i = 0; i < 900; i++) {
    const t = Math.random();
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = bowX - t * bowX;
    const y = cy + side * (8 + t * 80) + (Math.random() - 0.5) * (4 + t * 14);
    g.fillStyle = `rgba(255,255,255,${(0.75 * (1 - t) ** 1.3).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, 1.5 + Math.random() * 2.5 * (1 - t * 0.5), 0, 7);
    g.fill();
  }
  // the trail astern: a churned band, widening and fading
  for (let i = 0; i < 1400; i++) {
    const t = Math.random() ** 0.8;
    const x = sternX - t * sternX;
    const y = cy + (Math.random() - 0.5) * (14 + t * 40);
    g.fillStyle = `rgba(255,255,255,${(0.55 * (1 - t) ** 1.5).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, 1 + Math.random() * 3, 0, 7);
    g.fill();
  }
  // bow wave: foam pushed up either side of the stem
  for (let i = 0; i < 500; i++) {
    const a = (Math.random() - 0.5) * 2.4;
    const r = 6 + Math.random() * 16;
    g.fillStyle = `rgba(255,255,255,${(0.5 + Math.random() * 0.4).toFixed(3)})`;
    g.beginPath();
    g.arc(bowX + 6 - Math.abs(Math.sin(a)) * 30 + Math.cos(a) * 6, cy + Math.sin(a) * r * 1.4, 1.5 + Math.random() * 2, 0, 7);
    g.fill();
  }
  // as an alpha map (white foam on clear): bake the flecks' coverage into the green channel, fading every edge
  // so the decal never shows its rectangle
  const img = g.getImageData(0, 0, 512, 192), d = img.data;
  for (let y = 0; y < 192; y++)
    for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4, u = x / 512, v = y / 192;
      const fade = Math.min(1, u / 0.35, (1 - u) / 0.08) * Math.min(1, v / 0.2, (1 - v) / 0.2);
      const a = (d[i + 3] / 255) * Math.max(0, fade) * 255;
      d[i] = d[i + 1] = d[i + 2] = a;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: t, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  markShared(wakeMat);
  return wakeMat;
}

function wake(L: number): THREE.Mesh {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(1.8 * L, 0.7 * L).rotateX(-Math.PI / 2), wakeMaterial().clone());
  // the texture's bow sits 78% along it: put that at the stem
  w.position.set(0.46 * L - (0.78 - 0.5) * 1.8 * L, 0.06, 0);
  w.renderOrder = 2;
  w.name = 'wake';
  w.raycast = () => {};
  w.visible = false;
  return w;
}

// ------------------------------------------------------------------------------------------- the view

export class ShipsView {
  readonly group = new THREE.Group();
  private views = new Map<number, THREE.Object3D>();
  private invaderViews = new Map<number, THREE.Object3D>();
  private t = 0;
  ready: Promise<void>;
  selected = 0;

  /** debug: ?shipshow=sloop,galleon[&shipfurl=1] lines those classes up offshore of the dock, under sail */
  private show: { id: number; type: ShipType; x: number; z: number; head: number; v?: THREE.Object3D }[] = [];

  constructor(private world: World, private game: Game) {
    this.ready = this.load();
    const q = new URLSearchParams(location.search);
    const list = q.get('shipshow');
    const dock = [...game.buildings.values()].find((b) => b.def === 'dock');
    if (list && dock) {
      const [bx, by] = dockBerth(dock);
      const cx = dock.x + dock.w / 2, cy = dock.y + dock.h / 2;
      const sl = Math.hypot(bx - cx, by - cy) || 1;
      const sea = [(bx - cx) / sl, (by - cy) / sl], side = [-sea[1], sea[0]];
      const types = list.split(',') as ShipType[];
      types.forEach((type, i) => {
        const o = (i - (types.length - 1) / 2) * 15;
        const x = bx + sea[0] * 14 + side[0] * o, z = by + sea[1] * 14 + side[1] * o;
        this.show.push({ id: 9000 + i, type, x, z, head: +(q.get('shiphead') ?? 0.5) });
      });
      (window as unknown as { __shipshow: number[][] }).__shipshow = this.show.map((s) => [s.x, s.z]);
      void Promise.all(types.map((t) => loadShipModel(MODEL[t])));
    }
  }

  /** only the models this game's ships (and invaders) use: the rest load when a ship of theirs first appears */
  private async load(): Promise<void> {
    const g = this.game;
    const types = new Set<ShipType>([...g.ships.values()].map((s) => s.type));
    for (const iv of g.invaders ?? []) types.add(iv.soldiers > 6 ? 'galleon' : 'frigate');
    await Promise.all([...new Set([...types].map((t) => MODEL[t]))].map(loadShipModel));
  }

  /** a ship of this type, or null while its model is still loading */
  private instance(type: ShipType, nation?: Nation, rigged = true): THREE.Object3D | null {
    const src = shipModel(type);
    if (!src) return null;
    const g = new THREE.Group();
    const L = LENGTH[type];
    const s = L / src.plan.length;
    const hull = new THREE.Group();
    hull.scale.setScalar(s);
    if (src.near) {
      const lod = new THREE.LOD();
      lod.addLevel(src.near.clone(), 0);
      lod.addLevel(src.far.clone(), L * LOD_LENGTHS);
      hull.add(lod);
    } else hull.add(src.far.clone());
    g.add(hull);
    g.userData.hull = hull;
    if (!rigged) return g;
    const sails = new Sails(src.plan);
    hull.add(sails.mesh);
    g.userData.sails = sails;
    // pirate or national flag atop the mainmast, pennants at the other mastheads
    const flags: THREE.Object3D[] = [];
    for (const f of src.plan.flags) {
      const p = new THREE.Vector3().fromArray(f.p).multiplyScalar(s);
      let o: THREE.Object3D;
      if (f.kind === 'flag') {
        const fl = flag(nation ? nationFlag(nation) : M().flagBlack, 0.01);
        waveFlag(fl);
        fl.scale.setScalar(Math.max(1.1, L / 6.5));
        o = fl;
      } else {
        o = pennant(Math.max(1.2, L / 7));
      }
      o.position.copy(p);
      g.add(o);
      flags.push(o);
    }
    g.userData.flags = flags;
    const wk = wake(L);
    g.add(wk);
    g.userData.wake = wk;
    return g;
  }

  /** wooden frame for a ship under construction: same model, unrigged, clipped by progress (null while the model loads) */
  hullFrame(type: ShipType): THREE.Object3D | null {
    const g = this.instance(type, undefined, false);
    if (!g) return null;
    const src = shipModel(type)!;
    // standing on the keel blocks, not floating at its waterline
    (g.userData.hull as THREE.Object3D).position.y = src.plan.draft * (LENGTH[type] / src.plan.length);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const clipped = new Map<THREE.Material, THREE.Material>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material) => {
        let c = clipped.get(mat);
        if (!c) {
          c = mat.clone();
          c.clippingPlanes = [plane];
          clipped.set(mat, c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    g.userData.clip = plane;
    g.userData.L = LENGTH[type];
    return g;
  }
  setHullProgress(o: THREE.Object3D, p: number): void {
    const plane = o.userData.clip as THREE.Plane;
    const wp = new THREE.Vector3();
    o.getWorldPosition(wp);
    plane.constant = wp.y - 0.2 + p * (o.userData.L as number) * 0.9;
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    if (e.type === 'shipRemoved') {
      const v = this.views.get(e.id);
      if (v) this.drop(v);
      this.views.delete(e.id);
    }
  }

  private drop(v: THREE.Object3D): void {
    this.group.remove(v);
    (v.userData.sails as Sails | undefined)?.dispose();
    const wk = v.userData.wake as THREE.Mesh | undefined;
    if (wk) (wk.geometry.dispose(), (wk.material as THREE.Material).dispose());
  }

  pickShip(ray: THREE.Raycaster): number {
    const hits = ray.intersectObjects([...this.views.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.shipId) o = o.parent;
      if (o) return o.userData.shipId;
    }
    return 0;
  }

  shipPosition(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v && v.visible ? v.position.clone() : null;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    for (const s of g.ships.values()) {
      let v = this.views.get(s.id);
      if (!v) {
        v = this.instance(s.type) ?? undefined;
        if (!v) continue; // model still loading: next frame
        v.userData.shipId = s.id;
        v.traverse((o) => (o.userData.shipId = s.id));
        // a ship first seen at the dock has its sails already furled
        (v.userData.sails as Sails).setFurl(furledFor(s.status) ? 1 : 0);
        this.views.set(s.id, v);
        this.group.add(v);
      }
      v.visible = s.status !== 'atsea' && s.status !== 'lost';
      if (!v.visible) continue;
      const moving = s.status === 'departing' || s.status === 'returning';
      const [tx, tz, th] = this.berthed(s, v, dt);
      this.glide(v, tx, tz, th, moving, dt);
      this.bob(v, s.id);
      this.rig(v, s.id, furledFor(s.status), dt);
    }
    // invaders
    const inv = g.invaders ?? [];
    const live = new Set<number>();
    for (const iv of inv) {
      live.add(iv.id);
      let v = this.invaderViews.get(iv.id);
      if (!v) {
        v = this.instance(iv.soldiers > 6 ? 'galleon' : 'frigate', iv.nat) ?? undefined;
        if (!v) continue;
        this.invaderViews.set(iv.id, v);
        this.group.add(v);
      }
      this.glide(v, iv.x, iv.y, -iv.dir, iv.state === 'approach', dt);
      if (iv.state === 'sunk') {
        v.position.y = -iv.timer * 0.4;
        v.rotation.x = Math.min(0.6, iv.timer * 0.08);
      } else this.bob(v, iv.id);
      this.rig(v, iv.id, iv.state === 'sunk', dt);
    }
    const furlShow = location.search.includes('shipfurl=1');
    for (const sh of this.show) {
      if (!sh.v) {
        sh.v = this.instance(sh.type) ?? undefined;
        if (!sh.v) continue;
        (sh.v.userData.sails as Sails).setFurl(furlShow ? 1 : 0);
        this.group.add(sh.v);
      }
      const v = sh.v;
      this.glide(v, sh.x, sh.z, sh.head, false, dt);
      (v.userData as GlideState).speed = furlShow ? 0 : 2;
      this.bob(v, sh.id);
      this.rig(v, sh.id, furlShow, dt);
    }
    for (const [id, v] of this.invaderViews) if (!live.has(id)) {
      this.drop(v);
      this.invaderViews.delete(id);
    }
  }

  /**
   * Where the view puts a ship: the sim's position, moved so the hull lies in water. At (and near) its berth that is a
   * fitted berth, searched once per dock; underway, a small sideways nudge away from any shore the hull would cross.
   */
  private berthed(s: Ship, v: THREE.Object3D, dt: number): [number, number, number] {
    const u = v.userData as GlideState;
    const L = LENGTH[s.type];
    const dock = s.dock ? this.game.buildings.get(s.dock) : undefined;
    let x = s.vx, z = s.vy, head = -s.vdir;
    if (dock) {
      const [bx, by, bdir] = dockBerth(dock);
      const key = `${dock.id}:${bx},${by}:${s.type}`;
      if (u.berthKey !== key) {
        u.berthKey = key;
        u.berth = this.fitBerth(bx, by, -bdir, L, dock);
      }
      const b = u.berth!;
      const w = 1 - smooth(1, 7, Math.hypot(s.vx - bx, s.vy - by));
      x += (b[0] - bx) * w;
      z += (b[1] - by) * w;
      if (!(s.status === 'departing' || s.status === 'returning')) head = b[2];
      if (w > 0.99) return [x, z, head];
    }
    // underway: lean off the shore if the hull would cross it
    const hd = u.head ?? head;
    const nx = Math.sin(hd), nz = Math.cos(hd); // abeam (local +z)
    let best = 0, bestV = this.aground(x + nx * (u.nudge ?? 0), z + nz * (u.nudge ?? 0), hd, L, null);
    if (bestV > 0) for (const o of [-3, -2, -1.2, -0.6, 0, 0.6, 1.2, 2, 3]) {
      const vio = this.aground(x + nx * o, z + nz * o, hd, L, null) + Math.abs(o) * 0.02;
      if (vio < bestV) (bestV = vio), (best = o);
    } else best = u.nudge ?? 0;
    u.nudge = (u.nudge ?? 0) + (best - (u.nudge ?? 0)) * (1 - Math.exp(-dt * 1.5));
    return [x + nx * u.nudge, z + nz * u.nudge, head];
  }

  /** how far a hull of length L at (x, z, heading) is out of the water (0 = afloat), sampling its outline */
  private aground(x: number, z: number, head: number, L: number, avoid: { x: number; y: number; w: number; h: number } | null): number {
    const m = this.game.map;
    const c = Math.cos(head), sn = Math.sin(head);
    const hl = L * 0.4, hb = L * 0.11, need = -Math.min(0.5, L * 0.035);
    let v = 0;
    for (let i = 0; i <= 6; i++) {
      const lx = -hl + (2 * hl * i) / 6;
      const taper = 1 - (Math.abs(lx) / hl) ** 3 * 0.6;
      for (const lz of [-hb * taper, 0, hb * taper]) {
        const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
        const h = m.heightAt(wx, wz);
        if (h > need) v += h - need + 0.05;
        if (avoid && wx > avoid.x - 0.5 && wx < avoid.x + avoid.w + 0.5 && wz > avoid.y - 0.5 && wz < avoid.y + avoid.h + 0.5) v += 1;
      }
    }
    return v;
  }

  /** the nearest clear berth to the sim's: alongside (either way round) or bow out from the pier head */
  private fitBerth(bx: number, by: number, head: number, L: number, dock: { x: number; y: number; w: number; h: number }): [number, number, number] {
    let best: [number, number, number] = [bx, by, head], bestC = Infinity;
    const m = this.game.map;
    for (const [dh, hc] of [[0, 0], [Math.PI, 0.4], [Math.PI / 2, 2.5], [-Math.PI / 2, 2.5]] as [number, number][]) {
      const h = head + dh, c = Math.cos(h), sn = Math.sin(h);
      for (let dx = -8; dx <= 8; dx += 0.5)
        for (let dz = -8; dz <= 8; dz += 0.5) {
          const d = Math.hypot(dx, dz);
          if (d + hc >= bestC) continue;
          const x = bx + dx, z = by + dz;
          if (this.aground(x, z, h, L, dock) > 0) continue;
          // bow toward the deeper water (seaward), all else equal
          const bow = m.heightAt(x + c * L * 0.4, z - sn * L * 0.4), stern = m.heightAt(x - c * L * 0.4, z + sn * L * 0.4);
          const cost = d + hc + Math.max(-0.5, Math.min(0.5, bow - stern));
          if (cost < bestC) (bestC = cost), (best = [x, z, h]);
        }
    }
    return best;
  }

  /** sails toward their state for this status (furling takes a few seconds), flags streaming down the wind */
  private rig(v: THREE.Object3D, id: number, furled: boolean, dt: number): void {
    const sails = v.userData.sails as Sails | undefined;
    if (sails) {
      const goal = furled ? 1 : 0;
      if (sails.furl !== goal) sails.setFurl(sails.furl + Math.sign(goal - sails.furl) * Math.min(Math.abs(goal - sails.furl), dt * 0.4));
    }
    const wk = v.userData.wake as THREE.Mesh | undefined;
    if (wk) {
      const op = Math.min(0.6, Math.max(0, ((v.userData as GlideState).speed ?? 0) - 0.15) * 0.4);
      (wk.material as THREE.MeshBasicMaterial).opacity = op;
      wk.visible = op > 0.01;
    }
    const flags = v.userData.flags as THREE.Object3D[] | undefined;
    const head = v.rotation.y;
    if (flags) for (let i = 0; i < flags.length; i++) flags[i].rotation.y = WIND_DIR - head + Math.sin(this.t * 0.7 + id + i) * 0.15;
  }

  /**
   * The sim moves ships in 0.1 s steps (further per step at 8x): ease the view toward the sim's position each frame so
   * they glide, and turn the bow smoothly toward the way the ship is actually moving (or the sim's heading at rest).
   * Keeps the ship's speed and rate of turn for the heel, pitch and wake.
   */
  private glide(v: THREE.Object3D, x: number, z: number, restHeading: number, moving: boolean, dt: number): void {
    const u = v.userData as GlideState;
    v.rotation.order = 'YXZ'; // yaw, then heel about the keel (local x), then pitch (local z)
    if (!u.glided || Math.hypot(x - v.position.x, z - v.position.z) > 8) {
      v.position.set(x, 0, z);
      u.head = restHeading;
      u.glided = true;
      u.speed = u.turn = 0;
    } else if (dt > 0) {
      const px = v.position.x, pz = v.position.z, k = 1 - Math.exp(-dt * 5);
      v.position.x += (x - px) * k;
      v.position.z += (z - pz) * k;
      const sp = Math.hypot(v.position.x - px, v.position.z - pz) / dt;
      u.speed = (u.speed ?? 0) + (sp - (u.speed ?? 0)) * (1 - Math.exp(-dt * 2));
      const mx = x - v.position.x, mz = z - v.position.z;
      const want = moving && Math.hypot(mx, mz) > 0.02 ? -Math.atan2(mz, mx) : restHeading;
      let d = want - (u.head ?? want);
      d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
      const step = d * (1 - Math.exp(-dt * 2.5));
      u.head = (u.head ?? want) + step;
      u.turn = (u.turn ?? 0) + (step / dt - (u.turn ?? 0)) * (1 - Math.exp(-dt * 3));
    }
    v.rotation.set(0, u.head ?? restHeading, 0);
  }

  /** riding the swell: heave, roll and pitch, more of them underway, and a heel out of the turn */
  private bob(v: THREE.Object3D, id: number): void {
    const u = v.userData as GlideState;
    const t = this.t + id * 1.7;
    const way = Math.min(1, (u.speed ?? 0) / 2.5);
    v.position.y = Math.sin(t * 1.1) * 0.05;
    const heel = Math.max(-0.12, Math.min(0.12, (u.turn ?? 0) * 0.35 * way));
    v.rotation.x = Math.sin(t * 0.7 + 1) * (0.012 + 0.014 * way) + heel;
    v.rotation.z = Math.sin(t * 0.9) * (0.014 + 0.016 * way) - 0.012 * way; // bow lifts a little as she gathers way
  }
}

interface GlideState { glided?: boolean; head?: number; speed?: number; turn?: number; berthKey?: string; berth?: [number, number, number]; nudge?: number }

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** sails stay furled while a ship lies at the dock (loading, repairing, signing on its crew) */
function furledFor(status: Ship['status']): boolean {
  return status !== 'departing' && status !== 'returning';
}

const flagCache = new Map<Nation, THREE.Material>();
function nationFlag(n: Nation): THREE.Material {
  const hit = flagCache.get(n);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  if (n === 'eng') {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#c8102e';
    g.fillRect(52, 0, 24, 96);
    g.fillRect(0, 36, 128, 24);
  } else if (n === 'fra') {
    g.fillStyle = '#f4f0e0';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#d4af37';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(34 + i * 30, 48 + (i === 1 ? -14 : 8), 9, 0, 7);
      g.fill();
    }
  } else {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.strokeStyle = '#b01c2e';
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(14, 10);
    g.lineTo(114, 86);
    g.moveTo(114, 10);
    g.lineTo(14, 86);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
  flagCache.set(n, m);
  return m;
}
export { NAV_LENGTH as _NAV };
