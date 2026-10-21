import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Person } from '../sim/types';
import { BUILDING } from '../sim/data/buildings';
import type { World } from './world';
import { DT } from '../sim/time';
import { loadCrowd, type CrowdModel, type Look, type ModelName } from './crowd';

/** Is this person drawn in the world right now (vs inside a building / at sea)? */
export function isVisible(g: Game, p: Person): boolean {
  const t = p.task;
  if (t.kind === 'atsea') return false;
  if (t.phase !== 1) return true;
  if (t.kind === 'visit' || t.kind === 'eat' || t.kind === 'pray' || t.kind === 'stash' || t.kind === 'school') return false;
  if (t.kind === 'sleep') return !t.bld;
  if (t.kind === 'haul') return true;
  if (t.kind === 'work') {
    const b = t.bld ? g.buildings.get(t.bld) : undefined;
    if (!b) return true;
    const def = BUILDING[b.def];
    if (def.gather?.from === 'fertility' && def.gather.crop) return true;
    if (def.gather?.from === 'trees') return true;
    if (p.kind === 'pirate') return true;
    if (def.id === 'construction_tent' || def.id === 'dock' || def.id === 'boatyard' || def.id === 'shipyard') return true;
    return false;
  }
  return true;
}

function hash(n: number, s: number): number {
  let h = Math.imul(n * 2654435761 + s * 40503, 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const C = (hex: number) => new THREE.Color(hex);
const UP = new THREE.Vector3(0, 1, 0);
const SKIN = [0xd8a585, 0xc89070, 0xb07a58, 0x8a5a3c, 0x6a4028, 0x4a2c1c].map(C);
const HAIR = [0x1a1210, 0x3a2414, 0x5a3a1e, 0x8a5a2a, 0xb8884a, 0x9a3a1a, 0x8a8a88].map(C);
const PIRATE_SHIRT = [0xe8e0cc, 0xd8ccb0, 0xf0ece0, 0x8a2a20, 0x2a3a5a, 0x4a3a2a, 0xa8a090].map(C);
const PIRATE_PANTS = [0x2a2a3a, 0x4a3a28, 0x3a3a3a, 0x5a4a3a, 0x6a2a20, 0x2a3a4a].map(C);
const SASH = [0xa02020, 0x6a1a5a, 0x2a5a2a, 0xc09030, 0x1a3a7a, 0x111111].map(C);
const BANDANA = [0xb02020, 0x1a1a1a, 0x2a4a8a, 0xe8e0d0, 0x6a1a5a, 0xa06020].map(C);
const JOB_SHIRT: Record<string, number> = {
  farmer: 0xc8b078, cook: 0xf4f0e8, server: 0xc84040, wench: 0xd060a0, lumberjack: 0x8a3a2a, miner: 0x5a5550, builder: 0xb09060,
  smith: 0x5a4030, priest: 0x1a1a1a, trader: 0x3a5a3a, hauler: 0x9a8a70, shipwright: 0x7a6040, courtesan: 0x8a2a9a, distiller: 0x8a6a3a,
  tobacconist: 0x6a4a2a, gunsmith: 0x4a4a5a, engineer: 0x3a4a6a, surgeon: 0xe8e8e8, hatter: 0x2a3a6a, carpenter: 0xa07a4a, birdhandler: 0x3a8a4a,
};
const SOLDIER_COAT: Record<string, number> = { eng: 0xa81c1c, fra: 0x1c3a8a, spa: 0xe0d8b0 };

// ------------------------------------------------------------------------------------------- locomotion tuning
/** drawn speed (tiles per sim second) above which a person walks rather than stands */
const MOVE_ON = 0.16;
/** sim seconds to cross-fade between standing and walking */
const MOVE_FADE = 0.22;
/** walk-to-run blend, as model-space speed over the walk clip's natural speed: all walk below, all run above */
const RUN_FROM = 1.65, RUN_TO = 2.75;
/** facing: turn rate (1/sim s) toward the way they move */
const TURN = 9;
/** a person's work spot, standing spot or lane is eased in at this speed (tiles per sim second): walked, not slid */
const OFFSET_SPEED = 1.0;
/** the drawn path trails the sim's by this lag (sim s): rounds the corners of tile-to-tile paths (~0.08 tiles at a walk) */
const CORNER_LAG = 0.07;
/** at most this much turn per drawn frame (radians), however fast the game runs: a turn always takes a few frames */
const TURN_STEP = 0.3;
/** keep-right lane offset of walkers (tiles): two people meeting on a path pass shoulder to shoulder */
const LANE = 0.15;
/** people nearer than this (tiles, ~ shoulder width at scale) are nudged apart */
const PERSONAL = 0.3;
/** the nudge rate (tiles per sim second) for someone standing (slow enough to read as shifting weight) and walking */
const NUDGE_STAND = 0.12, NUDGE_WALK = 0.5, NUDGE_MAX = 0.3;
const TAU = Math.PI * 2;
const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU);

/** the renderer's per-person motion state: sim samples to interpolate, and the drawn pose */
interface Mover {
  id: number;
  frame: number;
  /** the two latest sim positions and the sim times they were seen at */
  t0: number; x0: number; y0: number;
  t1: number; x1: number; y1: number;
  /** placement offset (work spot, standing spot, lane), eased; and the separation nudge */
  ox: number; oy: number;
  /** the interpolated sim position followed with CORNER_LAG */
  fx: number; fy: number;
  nx: number; ny: number;
  /** drawn ground position, facing (radians about +y, 0 = +z), gait phase (cycles, R heel strike at 0) */
  rx: number; ry: number;
  yaw: number;
  phase: number;
  /** drawn speed (tiles per sim second, smoothed), walk/stand and walk/run blends */
  spd: number;
  moveW: number;
  runW: number;
  // per frame
  bx: number; by: number; // position before the nudge
  hx: number; hy: number; // heading of the sim motion (unit), 0 when still
  face: number; // facing wanted when standing (NaN: keep)
  fresh: boolean;
  per: Person;
  y: number;
  sc: number;
}

/**
 * Rings under the people of a selected building, by their part in it (the building inspector's legend matches):
 * workers gold, haulers sea-green, overseer and guards red, customers sky blue, residents (houses) green.
 */
export const ROLE_COLORS = { worker: 0xf2c14e, hauler: 0x3fc8a8, overseer: 0xe2483a, customer: 0x6aaaf0, resident: 0x9ad65a } as const;
export type Role = keyof typeof ROLE_COLORS;
const ROLE_COL = Object.fromEntries(Object.entries(ROLE_COLORS).map(([k, v]) => [k, new THREE.Color(v)])) as Record<Role, THREE.Color>;

/** a work spot in world tiles and the way to face there */
type Spot = [number, number, number];

/** trunk position of the tree on tile (x, y), as vegetation.ts places it (its hash, sample 0) */
function trunkAt(x: number, y: number): [number, number] {
  const hv = (a: number, b: number, s: number) => {
    let h = Math.imul(a * 73856093 ^ b * 19349663 ^ s * 83492791, 0x5bd1e995);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  return [x + 0.2 + hv(x, y, 0) * 0.6, y + 0.2 + hv(y, x, 7) * 0.6];
}

export class PeopleView {
  readonly group = new THREE.Group();
  private models: Partial<Record<ModelName, CrowdModel>> | null = null;
  ready: Promise<void>;
  selected = 0;
  private ring: THREE.Mesh;
  private t = 0;
  private looks = new Map<number, Look>();
  /** debug: draw these instead of the simulation's people (?lineup=...) */
  debug: { model: ModelName; clip: string; x: number; z: number; dir: number; look: Look; t?: number }[] | null = null;
  /** debug (?walktest): people not in the sim, drawn as if they were; `beforeFrame` moves them */
  extra: Person[] = [];
  beforeFrame: (() => void) | null = null;
  /** debug: the old drawing (raw sim positions, clips at a fixed rate) for before/after foot-slide measurements */
  legacy = false;
  /** debug: record the drawn foot contact points of these people every frame */
  footLog: Map<number, { t: number; body: [number, number]; pts: [number, number, number][]; ground: number; clip: string }[]> | null = null;
  private movers = new Map<number, Mover>();
  private frameNo = 0;
  private simPrev = -1;
  private spots = new Map<number, { key: string; spots: Spot[] }>();
  private roleRings: THREE.InstancedMesh;
  private roleN = 0;
  /** visual scale of characters (model is ~1.82 m tall; tiles are 2 m) */
  scale = 0.68;

  constructor(private world: World, private game: Game) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe080, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.roleRings = this.makeRoleRings(64);
    this.ready = loadCrowd().then((m) => {
      this.models = m;
      for (const k of Object.values(m)) if (k) this.group.add(k.mesh);
    });
  }

  private makeRoleRings(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.27, 0.35, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.85 }),
      cap,
    );
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.renderOrder = 10;
    m.frustumCulled = false;
    m.count = 0;
    this.group.add(m);
    return m;
  }

  /** what a person is to building b, if anything */
  roleIn(b: { id: number; workers: number[]; haulers: number[]; overseer: number; guards: number[]; customers: number[] }, p: Person): Role | null {
    if (b.workers.includes(p.id)) return 'worker';
    if (b.haulers.includes(p.id)) return 'hauler';
    if (b.overseer === p.id || b.guards.includes(p.id)) return 'overseer';
    if (p.home === b.id) return 'resident';
    if (b.customers.includes(p.id)) return 'customer';
    return null;
  }

  private pushRoleRing(x: number, y: number, z: number, role: Role): void {
    let r = this.roleRings;
    if (this.roleN >= r.instanceMatrix.count) {
      const bigger = this.makeRoleRings(r.instanceMatrix.count * 2);
      (bigger.instanceMatrix.array as Float32Array).set(r.instanceMatrix.array);
      (bigger.instanceColor!.array as Float32Array).set(r.instanceColor!.array);
      this.group.remove(r);
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
      r.dispose();
      this.roleRings = r = bigger;
    }
    this.mtx.makeTranslation(x, y + 0.03, z);
    r.setMatrixAt(this.roleN, this.mtx);
    r.setColorAt(this.roleN, ROLE_COL[role]);
    this.roleN++;
  }

  onEvent(e: { type: string; id?: number }): void {
    if ((e.type === 'respawn' || e.type === 'outfit' || e.type === 'rankup') && e.id) this.looks.delete(e.id);
  }

  lookOf(p: Person): Look {
    let l = this.looks.get(p.id);
    if (l) return l;
    const h = (s: number) => hash(p.id, s);
    const pick = <T,>(a: T[], s: number) => a[Math.floor(h(s) * a.length) % a.length];
    const skinIdx = p.nat === 'spa' ? 1 + Math.floor(h(1) * 4) : Math.floor(h(1) * (p.kind === 'captive' ? 6 : 4));
    l = { skin: SKIN[Math.min(5, skinIdx)].clone(), shirt: C(0xddd), pants: C(0x333), hair: pick(HAIR, 2).clone(), beard: false, hat: null, hat2: null, sash: C(0x6a4a2a), boots: C(0x221510) };
    if (p.kind === 'pirate') {
      l.shirt = pick(PIRATE_SHIRT, 3).clone();
      l.pants = pick(PIRATE_PANTS, 4).clone();
      l.sash = pick(SASH, 5).clone();
      l.beard = p.sex === 'M' && h(6) < 0.6;
      if (h(7) < 0.6) l.hat = pick(BANDANA, 8).clone();
      if (p.captain || p.rank >= 7 || p.accessories.hat) {
        l.hat = null;
        l.hat2 = C(p.captain ? 0x14100c : 0x3a2a1a);
      }
      if (p.captain) {
        l.shirt = C(h(9) < 0.5 ? 0x5a1414 : 0x14224a);
        l.sash = C(0xc09030);
      }
    } else if (p.kind === 'captive') {
      const job = p.skilled ? p.profession : p.jobRole;
      if (p.skilled) {
        l.shirt = C(JOB_SHIRT[p.profession] ?? 0x8a7a5a).offsetHSL(0, 0, (h(10) - 0.5) * 0.1);
        l.pants = pick(PIRATE_PANTS, 11).clone();
      } else if (job && job !== 'hauler' && JOB_SHIRT[job]) {
        l.shirt = C(JOB_SHIRT[job]);
        l.pants = C(0x5a4a3a);
      } else {
        // idle or hauling captives: red (women) / grey (men) shirts
        l.shirt = C(p.sex === 'F' ? 0xa83a30 : 0x8a8a84);
        l.pants = C(p.sex === 'F' ? 0x7a5a4a : 0x6a645a);
      }
      if (p.sex === 'F' && h(12) < 0.4) l.hat = C(0xe8e0d0);
      l.sash = C(0x6a5a40);
      l.beard = p.sex === 'M' && h(13) < 0.35;
    } else if (p.kind === 'wealthy') {
      l.shirt = C(p.sex === 'F' ? 0x6a2a8a : 0x2a1a4a);
      l.pants = C(p.sex === 'F' ? 0x8a3aaa : 0x1a1a2a);
      l.sash = C(0xd4a640);
      if (p.sex === 'M') l.hat2 = C(0x1a1a1a);
    } else if (p.kind === 'soldier') {
      l.shirt = C(SOLDIER_COAT[p.nat] ?? 0xa81c1c);
      l.pants = C(0xe8e4d8);
      l.sash = C(0xe8e4d8);
      l.hat = C(0x111111);
      l.skin = SKIN[Math.floor(h(1) * 3)].clone();
    } else if (p.kind === 'skeleton') {
      // old bone: ivory to tobacco-stained, never chalk white
      const bone = C([0xcdbf9c, 0xc2b28a, 0xb8a67e, 0xd2c6a6][Math.floor(h(2) * 4)]);
      l = { skin: bone, shirt: bone.clone(), pants: bone.clone(), hair: bone.clone(), beard: false, hat: null, hat2: null, sash: C(0x4a4038), boots: bone.clone() };
    }
    this.looks.set(p.id, l);
    return l;
  }

  modelOf(p: Person): ModelName {
    switch (p.kind) {
      case 'pirate':
        return p.sex === 'F' ? 'pirate_f' : 'pirate';
      case 'soldier':
        return 'soldier';
      case 'skeleton':
        return this.models?.skeleton ? 'skeleton' : 'captive';
      case 'wealthy':
        return p.sex === 'F' ? 'captive_f' : 'soldier';
      default:
        return p.sex === 'F' ? 'captive_f' : 'captive';
    }
  }

  /**
   * the clip for what a person does when not walking, and its playback rate. Walking and running are not chosen here:
   * whoever moves on screen walks (or runs) with the feet driven by the ground they cover (see `update`).
   */
  private standClip(p: Person): [string, number] {
    const t = p.task;
    if (t.kind === 'dead') return ['die', 1];
    if (t.phase === 0) return ['idle', 1]; // between steps of a walk: waiting on the path worker, or blocked
    switch (t.kind) {
      case 'chase':
      case 'fight':
        return t.phase === 2 ? ['fight', 1] : ['idle', 1];
      case 'sleep':
        return ['sleep', 1];
      case 'build':
        return ['swing', 1];
      case 'work': {
        const b = t.bld ? this.game.buildings.get(t.bld) : undefined;
        const def = b ? BUILDING[b.def] : undefined;
        if (p.kind === 'pirate') return [hash(p.id, 20) < 0.5 ? 'idle' : 'talk', 1];
        if (def?.gather?.crop) return ['farm', 1];
        if (def?.gather?.from === 'trees') return ['swing', 1];
        if (def?.id === 'dock' || def?.id === 'boatyard' || def?.id === 'shipyard') return ['swing', 0.8];
        return ['idle', 1];
      }
      case 'party': {
        const r = hash(p.id + Math.floor(this.t / 9), 21);
        if (this.game.time < this.game.effects.festivalUntil) return [r < 0.5 ? 'dance' : 'cheer', 1];
        return [r < 0.35 ? 'drink' : r < 0.7 ? 'talk' : r < 0.85 ? 'dance' : 'idle', 1];
      }
      case 'guard':
        return ['idle', 0.8];
      case 'idle':
      case 'wander':
        return [hash(p.id, 22) < 0.3 ? 'talk' : 'idle', 1];
    }
    return ['idle', 1];
  }

  /** the pre-rewrite clip choice (debug ?legacy=1 only: before/after measurements) */
  private legacyClip(p: Person): string {
    const t = p.task;
    if (p.pathReq && p.path?.length === 0) return 'idle';
    if (t.phase === 0) {
      if (t.kind === 'escape' || t.kind === 'flee' || t.kind === 'rebel') return 'run';
      if (p.kind === 'soldier') return 'march';
      if (p.carrying) return 'carry';
      if (p.accessories.pegleg) return 'limp';
      if (p.kind === 'pirate' && hash(p.id, 23) < 0.5) return 'swagger';
      return 'walk';
    }
    if ((t.kind === 'chase' || t.kind === 'fight') && t.phase !== 2) return 'run';
    return this.standClip(p)[0];
  }

  // per-frame scratch (no allocations in update)
  private mtx = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new THREE.Vector3();
  private p3 = new THREE.Vector3();
  private sphere = new THREE.Sphere();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private modelList: CrowdModel[] = [];
  private drawnN = 0;
  private prunedAt = 0;
  private list: Mover[] = [];
  private grid = new Map<number, Mover[]>();
  private gridPool: Mover[][] = [];
  private slotCount = new Map<number, number>();
  private feet = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /** the motion state of a person drawn this frame: picks up the latest sim position, snaps after a gap or a jump */
  private moverOf(per: Person): Mover {
    const g = this.game;
    let m = this.movers.get(per.id);
    if (!m) {
      m = {
        id: per.id, frame: -9, t0: 0, x0: 0, y0: 0, t1: 0, x1: 0, y1: 0, ox: 0, oy: 0, fx: per.x, fy: per.y, nx: 0, ny: 0, rx: 0, ry: 0, yaw: 0, phase: hash(per.id, 30),
        spd: 0, moveW: 0, runW: 0, bx: 0, by: 0, hx: 0, hy: 0, face: NaN, fresh: true, per, y: 0, sc: 1,
      };
      this.movers.set(per.id, m);
    }
    m.per = per;
    m.fresh = m.frame !== this.frameNo - 1; // not drawn last frame: no history to interpolate from
    if (m.fresh) {
      m.t0 = m.t1 = g.time;
      m.x0 = m.x1 = per.x;
      m.y0 = m.y1 = per.y;
      m.ox = m.oy = m.nx = m.ny = 0;
      m.spd = 0;
      m.moveW = per.task.phase === 0 && !(per.pathReq && per.path?.length === 0) ? 1 : 0;
      m.runW = 0;
      m.yaw = Math.PI / 2 - per.dir;
    } else if (g.time > m.t1) {
      m.t0 = m.t1;
      m.x0 = m.x1;
      m.y0 = m.y1;
      m.t1 = g.time;
      m.x1 = per.x;
      m.y1 = per.y;
      // a jump no walk explains (respawned, put ashore, out of a building): no gliding across the map
      if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) > 1 + 5 * (m.t1 - m.t0)) {
        m.x0 = m.x1;
        m.y0 = m.y1;
      }
    } else if (per.x !== m.x1 || per.y !== m.y1) {
      // moved without a sim step (a debug walker, a load): take it as it is
      m.x0 = m.x1 = per.x;
      m.y0 = m.y1 = per.y;
    }
    m.frame = this.frameNo;
    return m;
  }

  /** is a standing spot clear: on walkable land, not inside a building (except the one they farm), not in the sea */
  private clearAt(x: number, y: number, own = 0): boolean {
    const m = this.game.map;
    for (const [ex, ey] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
      const tx = Math.floor(x + ex), ty = Math.floor(y + ey);
      if (!m.inBounds(tx, ty) || !m.isWalkable(tx, ty)) return false;
      const o = m.occupied[m.idx(tx, ty)];
      if (o && o !== own) return false;
    }
    return true;
  }

  /** work spots of a building, spread out in slot order (cached until the building changes) */
  private spotsOf(b: { id: number; def: string; x: number; y: number; w: number; h: number; rot: number; door: [number, number]; built: number }): Spot[] {
    const key = `${b.def}:${b.x}:${b.y}:${b.rot}:${b.door[0]}:${b.door[1]}:${b.built >= 1 ? 1 : 0}`;
    const c = this.spots.get(b.id);
    if (c && c.key === key) return c.spots;
    const def = BUILDING[b.def];
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let cand: Spot[] = [];
    if (def?.gather?.crop) {
      // farms: in the furrows between crop rows (prefabs.ts crops()), never in the field shelter's corner
      const W = b.rot % 2 ? b.h : b.w, D = b.rot % 2 ? b.w : b.h;
      const a = -b.rot * (Math.PI / 2), ca = Math.cos(a), sa = Math.sin(a);
      const rows = Math.round(D * 2.2);
      const cols = Math.max(2, Math.round((W - 0.7) / 0.5) + 1);
      for (let r = 0; r < rows - 1; r++) {
        const z = -D / 2 + 0.25 + ((r + 0.5) / Math.max(1, rows - 1)) * (D - 0.5);
        for (let k = 0; k < cols; k++) {
          const x = -W / 2 + 0.35 + (k / (cols - 1)) * (W - 0.7);
          if (x > W / 2 - 1.05 && z < -D / 2 + 1.05) continue;
          // model space to world: rotation about +y by a (x' = x cos a + z sin a, z' = -x sin a + z cos a)
          const wx = cx + x * ca + z * sa, wy = cy - x * sa + z * ca;
          // face along the row, alternately up and down it
          const fx = ca * (k % 2 ? -1 : 1), fy = -sa * (k % 2 ? -1 : 1);
          if (this.clearAt(wx, wy, b.id)) cand.push([wx, wy, Math.atan2(fx, fy)]);
        }
      }
    } else {
      // at the door: a row along the front, then a second row further out, facing the building
      const [dx, dy] = b.door;
      const nx = dx >= b.x + b.w ? 1 : dx < b.x ? -1 : 0, ny = nx ? 0 : dy >= b.y + b.h ? 1 : dy < b.y ? -1 : 0;
      const tx = -ny, ty = nx;
      for (const out of [0.05, 0.45, 0.85])
        for (const lat of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
          const wx = dx + 0.5 + nx * out + tx * lat, wy = dy + 0.5 + ny * out + ty * lat;
          if (this.clearAt(wx, wy)) cand.push([wx, wy, Math.atan2(cx - wx, cy - wy)]);
        }
    }
    // spread: each next spot is the one farthest from those already taken
    const out: Spot[] = [];
    if (cand.length) {
      let i0 = 0, bd = Infinity;
      for (let i = 0; i < cand.length; i++) {
        const d = def?.gather?.crop ? -Math.hypot(cand[i][0] - cx, cand[i][1] - cy) : Math.hypot(cand[i][0] - b.door[0] - 0.5, cand[i][1] - b.door[1] - 0.5);
        if (d < bd) (bd = d), (i0 = i);
      }
      out.push(cand.splice(i0, 1)[0]);
      while (cand.length) {
        let bi = 0, bv = -1;
        for (let i = 0; i < cand.length; i++) {
          let dmin = Infinity;
          for (const o of out) dmin = Math.min(dmin, Math.hypot(cand[i][0] - o[0], cand[i][1] - o[1]));
          if (dmin > bv + 1e-6) (bv = dmin), (bi = i);
        }
        out.push(cand.splice(bi, 1)[0]);
      }
    }
    this.spots.set(b.id, { key, spots: out });
    return out;
  }

  /**
   * where a person stands relative to their sim position (offset in tiles), and the way to face there:
   * workers spread over their own work spots, lumberjacks beside the trunk, others a little off the tile centre,
   * walkers on the right of their way
   */
  private placement(m: Mover, ix: number, iy: number): [number, number] {
    const per = m.per, t = per.task, g = this.game;
    m.face = NaN;
    if (t.kind === 'dead') return [m.ox, m.oy];
    if (t.phase === 0) {
      // waiting for a path, or blocked: stay where they are
      if (!m.hx && !m.hy) return [m.ox, m.oy];
      const lx = -m.hy * LANE, ly = m.hx * LANE; // the right hand of the heading (x east, y south: right = (-hy, hx))
      return this.clearAt(ix + lx, iy + ly) ? [lx, ly] : [0, 0];
    }
    const b = t.bld ? g.buildings.get(t.bld) : undefined;
    if (t.kind === 'work' && b) {
      const def = BUILDING[b.def];
      if (def?.gather?.from === 'trees') {
        // beside the trunk, on the building's side of it, facing it
        const [qx, qy] = trunkAt(Math.floor(ix), Math.floor(iy));
        let ax = b.x + b.w / 2 - qx, ay = b.y + b.h / 2 - qy;
        const al = Math.hypot(ax, ay) || 1;
        const turn = (this.slotOf(b, per.id) % 3) * 2.1;
        const c = Math.cos(turn), s = Math.sin(turn);
        [ax, ay] = [(ax * c - ay * s) / al, (ax * s + ay * c) / al];
        const wx = qx + ax * 0.34, wy = qy + ay * 0.34;
        m.face = Math.atan2(qx - wx, qy - wy);
        return this.clearAt(wx, wy) ? [wx - ix, wy - iy] : [0, 0];
      }
      const spots = this.spotsOf(b);
      if (spots.length) {
        const sp = spots[this.slotOf(b, per.id) % spots.length];
        if (Math.hypot(sp[0] - ix, sp[1] - iy) < 4) {
          m.face = sp[2];
          return [sp[0] - ix, sp[1] - iy];
        }
      }
      return [0, 0];
    }
    if (t.kind === 'fight' || t.kind === 'chase' || t.kind === 'sleep') return [0, 0];
    // standing about (hauling at a door, guarding, partying, idling): a spot of their own on the tile
    const ang = hash(per.id, 40) * TAU, r = 0.1 + hash(per.id, 41) * 0.22;
    const sx = Math.cos(ang) * r, sy = Math.sin(ang) * r;
    return this.clearAt(ix + sx, iy + sy) ? [sx, sy] : [0, 0];
  }

  /** a worker's slot at their workplace: their place in its worker list, overseer and guards after */
  private slotOf(b: { id: number; workers: number[]; overseer: number; guards: number[] }, id: number): number {
    const i = b.workers.indexOf(id);
    if (i >= 0) return i;
    if (b.overseer === id) return b.workers.length;
    const j = b.guards.indexOf(id);
    if (j >= 0) return b.workers.length + 1 + j;
    const n = this.slotCount.get(b.id) ?? 0;
    this.slotCount.set(b.id, n + 1);
    return b.workers.length + 1 + b.guards.length + n;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    // forget the looks of the dead and departed (soldiers of every invasion, sold captives...)
    if (this.t - this.prunedAt > 30) {
      this.prunedAt = this.t;
      for (const id of this.looks.keys()) if (!g.people.has(id)) this.looks.delete(id);
      for (const id of this.movers.keys()) if (this.movers.get(id)!.frame < this.frameNo - 2) this.movers.delete(id);
      for (const id of this.spots.keys()) if (!g.buildings.has(id)) this.spots.delete(id);
    }
    if (!this.models) return;
    this.beforeFrame?.();
    const ms = this.models;
    if (this.modelList.length === 0) for (const m of Object.values(ms)) if (m) this.modelList.push(m);
    for (const m of this.modelList) m.reset();
    this.drawnN = 0;
    this.frameNo++;
    this.slotCount.clear();
    // render time runs one sim step behind the sim, so every drawn position lies between two known sim positions
    const now = g.time + g.pending;
    let dts = now - this.simPrev;
    if (!(dts >= 0 && dts < 5)) dts = 0;
    this.simPrev = now;
    const tr = now - DT;
    const mtx = this.mtx, q = this.q, s = this.sv, p3 = this.p3;
    const camera = this.world.rig.camera;
    const cam = camera.position;
    // cull people outside the view (with a margin for the shadows they cast just inside it)
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = this.frustum.setFromProjectionMatrix(this.projView);
    const sphere = this.sphere;
    sphere.radius = 2.5;
    let selFound = false;
    const selB = this.world.buildings.selected ? g.buildings.get(this.world.buildings.selected) : undefined;
    this.roleN = 0;
    if (this.debug) {
      for (const d of this.debug) {
        const m = ms[d.model];
        if (!m) continue;
        q.setFromAxisAngle(UP, d.dir);
        const y = g.map.heightAt(d.x, d.z);
        mtx.compose(p3.set(d.x, y, d.z), q, s.set(this.scale, this.scale, this.scale));
        m.add(mtx, d.clip, d.t ?? this.t, d.look);
      }
    }
    // 1. where everyone is: sim positions interpolated between steps, plus their placement offset
    const list = this.list;
    list.length = 0;
    const visit = (per: Person) => {
      if (!isVisible(g, per)) return;
      // distance cull for very far zoom
      if (Math.abs(per.x - cam.x) > 200 || Math.abs(per.y - cam.z) > 200) return;
      sphere.center.set(per.x, g.map.heightAt(per.x, per.y) + 0.6, per.y);
      if (!frustum.intersectsSphere(sphere)) return;
      const m = this.moverOf(per);
      const span = m.t1 - m.t0;
      const a = span > 0 ? Math.min(1, Math.max(0, (tr - m.t0) / span)) : 1;
      const ix = m.x0 + (m.x1 - m.x0) * a, iy = m.y0 + (m.y1 - m.y0) * a;
      if (m.fresh || Math.hypot(ix - m.fx, iy - m.fy) > 1.5) (m.fx = ix), (m.fy = iy);
      else {
        const k = 1 - Math.exp(-dts / CORNER_LAG);
        m.fx += (ix - m.fx) * k;
        m.fy += (iy - m.fy) * k;
      }
      // heading of the sim motion (for lanes)
      const hx = m.x1 - m.x0, hy = m.y1 - m.y0, hl = Math.hypot(hx, hy);
      if (hl > 1e-4) (m.hx = hx / hl), (m.hy = hy / hl);
      else if (per.task.phase !== 0) m.hx = m.hy = 0;
      if (this.legacy) {
        m.bx = per.x;
        m.by = per.y;
      } else {
        const [tx, ty] = this.placement(m, ix, iy);
        if (m.fresh) (m.ox = tx), (m.oy = ty);
        else {
          // eased in at a walking pace (so the feet carry them there), snapped if it is a long way
          const ex = tx - m.ox, ey = ty - m.oy, el = Math.hypot(ex, ey), step = OFFSET_SPEED * dts;
          if (el > 2.5 || el <= step) (m.ox = tx), (m.oy = ty);
          else (m.ox += (ex / el) * step), (m.oy += (ey / el) * step);
        }
        m.bx = m.fx + m.ox;
        m.by = m.fy + m.oy;
      }
      list.push(m);
    };
    if (!this.debug) {
      for (const per of g.people.values()) visit(per);
      for (const per of this.extra) visit(per);
    }
    // 2. personal space: nudge apart people standing or passing in each other
    if (!this.legacy) this.separate(dts);
    // 3. draw: gait phase from the ground covered, facing, the clip blend
    for (const m of list) {
      const per = m.per;
      const px = m.bx + m.nx, py = m.by + m.ny;
      const model = ms[this.modelOf(per)] ?? ms.captive;
      if (!model) continue;
      let y = g.map.heightAt(px, py);
      const tb = per.task.bld ? g.buildings.get(per.task.bld) : undefined;
      if (tb && tb.def === 'dock' && g.map.height[g.map.idx(Math.floor(px), Math.floor(py))] < 0.2) y = Math.max(y, 0.35);
      if (y < -0.3) y = -0.3; // wading
      const sc = this.scale * (per.kind === 'soldier' ? 1.02 : 0.94 + hash(per.id, 31) * 0.12) * (per.sex === 'F' ? 0.95 : 1);
      const dead = per.task.kind === 'dead';
      const [stand, rate] = this.standClip(per);
      let clipA = stand, ua = 0, clipB: string | null = null, ub = 0, w = 0;
      if (this.legacy) {
        const c = this.legacyClip(per);
        clipA = c;
        ua = (dead ? 6 - (per.dyingTimer ?? 0) : this.t * rate + hash(per.id, 30) * 10) / model.clip(c).duration;
        m.yaw = Math.PI / 2 - per.dir;
      } else {
        const d = m.fresh ? 0 : Math.hypot(px - m.rx, py - m.ry);
        if (dts > 0) m.spd += (d / dts - m.spd) * (1 - Math.exp(-dts * 14));
        const moving = !dead && m.spd > MOVE_ON;
        m.moveW = Math.min(1, Math.max(0, m.moveW + (moving ? dts : -dts) / MOVE_FADE));
        // walk or run: by speed in the model's own units against the walk clip's natural pace
        const base = per.carrying ? 'carry' : 'walk';
        const gw = model.clip(base), gr = model.clip('run');
        const sw = gw.gait?.stride || 1.4, sr = gr.gait?.stride || 2.4;
        const vNat = sw / gw.duration;
        const k = (m.spd / sc / vNat - RUN_FROM) / (RUN_TO - RUN_FROM);
        const runT = moving ? Math.min(1, Math.max(0, k)) : m.runW;
        m.runW += (runT - m.runW) * (1 - Math.exp(-dts * 5));
        // the feet: phase advances by the ground covered over the (blended) stride, so a planted foot stays put
        const stride = (sw + (sr - sw) * m.runW) * sc;
        m.phase = (m.phase + d / stride) % 1;
        const uw = m.phase + (gw.gait?.strikeR ?? 0), ur = m.phase + (gr.gait?.strikeR ?? 0);
        // facing: the way they move, else the way the sim (or their work spot) faces them
        let want = NaN;
        if (moving && d > 1e-5) want = Math.atan2(px - m.rx, py - m.ry);
        else if (!Number.isNaN(m.face)) want = m.face;
        else if (per.task.phase !== 0 || m.moveW === 0) want = Math.PI / 2 - per.dir;
        if (m.fresh) m.yaw = Number.isNaN(want) ? Math.PI / 2 - per.dir : want;
        else if (!Number.isNaN(want) && !dead) {
          const turn = wrapAngle(want - m.yaw) * (1 - Math.exp(-dts * TURN));
          m.yaw = wrapAngle(m.yaw + Math.max(-TURN_STEP, Math.min(TURN_STEP, turn)));
        }
        const st = (dead ? 6 - (per.dyingTimer ?? 0) : this.t * rate + hash(per.id, 30) * 10) / model.clip(stand).duration;
        if (m.moveW >= 0.999) {
          clipA = base;
          ua = uw;
          clipB = 'run';
          ub = ur;
          w = m.runW;
        } else {
          ua = st;
          if (m.moveW > 0.001) {
            clipB = m.runW > 0.5 ? 'run' : base;
            ub = m.runW > 0.5 ? ur : uw;
            w = m.moveW;
          }
        }
      }
      m.rx = px;
      m.ry = py;
      m.y = y;
      m.sc = sc;
      q.setFromAxisAngle(UP, m.yaw);
      mtx.compose(p3.set(px, y, py), q, s.set(sc, sc, sc));
      model.addPose(mtx, clipA, ua, clipB, ub, w, this.lookOf(per));
      if (this.footLog?.has(per.id)) {
        model.instanceFeet(model.count - 1, mtx, this.feet);
        this.footLog.get(per.id)!.push({ t: now, body: [px, py], pts: this.feet.map((f) => [f.x, f.y, f.z] as [number, number, number]), ground: y, clip: `${clipA}${clipB ? '/' + clipB + ':' + w.toFixed(2) : ''}` });
      }
      this.pushDrawn(per.id, px, y, py);
      if (selB) {
        const role = this.roleIn(selB, per);
        if (role) this.pushRoleRing(px, y, py, role);
      }
      if (per.id === this.selected) {
        selFound = true;
        this.ring.position.set(px, y + 0.04, py);
      }
    }
    for (const m of this.modelList) m.commit();
    this.ring.visible = selFound;
    const rr = this.roleRings;
    rr.count = this.roleN;
    if (this.roleN) {
      rr.instanceMatrix.needsUpdate = true;
      rr.instanceColor!.needsUpdate = true;
    }
  }

  /**
   * Personal space. People closer than PERSONAL are nudged apart: walkers step to their right of whoever they meet
   * (both do, so they pass), people standing shift a little. The nudge is state that eases toward the push and back to
   * nothing once clear, so crowds settle instead of jittering; it never takes anyone into a building.
   */
  private separate(dts: number): void {
    const grid = this.grid;
    for (const v of grid.values()) (v.length = 0), this.gridPool.push(v);
    grid.clear();
    const cell = (x: number, y: number) => Math.floor(x) * 4096 + Math.floor(y);
    for (const m of this.list) {
      if (m.per.task.kind === 'dead') continue;
      const k = cell(m.bx + m.nx, m.by + m.ny);
      let c = grid.get(k);
      if (!c) grid.set(k, (c = this.gridPool.pop() ?? []));
      c.push(m);
    }
    const R = PERSONAL;
    for (const m of this.list) {
      if (m.per.task.kind === 'dead') continue;
      const x = m.bx + m.nx, y = m.by + m.ny;
      let px = 0, py = 0, near = false;
      const walking = m.moveW > 0.5;
      for (let gx = -1; gx <= 1; gx++)
        for (let gy = -1; gy <= 1; gy++) {
          const c = grid.get(cell(x + gx, y + gy));
          if (!c) continue;
          for (const o of c) {
            if (o === m || o.per.task.kind === 'dead') continue;
            let dx = x - (o.bx + o.nx), dy = y - (o.by + o.ny);
            const d = Math.hypot(dx, dy);
            if (d >= R * 1.25) continue;
            near = true;
            if (d >= R) continue;
            // fighters square up to each other at arm's length: let them be
            if (m.per.task.kind === 'fight' && o.per.task.kind === 'fight') continue;
            if (d < 1e-4) {
              const a = hash(Math.min(m.id, o.id) * 31 + Math.max(m.id, o.id), 42) * TAU * (m.id < o.id ? 1 : -1);
              dx = Math.cos(a);
              dy = Math.sin(a);
            } else (dx /= d), (dy /= d);
            const push = R - d;
            if (walking && (m.hx || m.hy)) {
              // a step to the right of the way they go (plus a little straight back from the other)
              const rx = -m.hy, ry = m.hx;
              const side = dx * rx + dy * ry >= -0.3 ? 1 : -1;
              px += (rx * side * 0.8 + dx * 0.4) * push;
              py += (ry * side * 0.8 + dy * 0.4) * push;
            } else {
              // standing: a walker gets out of the way more than the one standing still
              const share = o.moveW > 0.5 ? 0.25 : 0.5;
              px += dx * push * share;
              py += dy * push * share;
            }
          }
        }
      const rate = (walking ? NUDGE_WALK : NUDGE_STAND) * dts;
      let tx = m.nx + px, ty = m.ny + py;
      if (!near) {
        // clear of everyone: ease back to where they belong
        tx = 0;
        ty = 0;
      }
      const tl = Math.hypot(tx, ty);
      if (tl > NUDGE_MAX) (tx *= NUDGE_MAX / tl), (ty *= NUDGE_MAX / tl);
      const ex = tx - m.nx, ey = ty - m.ny, el = Math.hypot(ex, ey);
      if (el < 1e-6) continue;
      const k = Math.min(1, rate / el);
      const nx = m.nx + ex * k, ny = m.ny + ey * k;
      // never into a wall
      const farm = m.per.task.bld && m.per.task.kind === 'work' ? m.per.task.bld : 0;
      if (this.clearAt(m.bx + nx, m.by + ny, farm) || !this.clearAt(m.bx + m.nx, m.by + m.ny, farm)) (m.nx = nx), (m.ny = ny);
    }
  }

  /** drawn people for picking, as flat arrays reused frame to frame */
  private drawnId = new Int32Array(256);
  private drawnPos = new Float32Array(256 * 3);
  private pushDrawn(id: number, x: number, y: number, z: number): void {
    const i = this.drawnN++;
    if (i >= this.drawnId.length) {
      const ids = new Int32Array(this.drawnId.length * 2), pos = new Float32Array(ids.length * 3);
      ids.set(this.drawnId);
      pos.set(this.drawnPos);
      this.drawnId = ids;
      this.drawnPos = pos;
    }
    this.drawnId[i] = id;
    this.drawnPos[i * 3] = x;
    this.drawnPos[i * 3 + 1] = y;
    this.drawnPos[i * 3 + 2] = z;
  }

  /** nearest drawn person to the pick ray */
  pickPerson(ray: THREE.Raycaster): number {
    let best = 0, bd = 0.45 * 0.45;
    const r = ray.ray;
    const pt = new THREE.Vector3(), c = new THREE.Vector3();
    const P = this.drawnPos;
    for (let i = 0; i < this.drawnN; i++) {
      c.set(P[i * 3], P[i * 3 + 1] + 0.5, P[i * 3 + 2]);
      r.closestPointToPoint(c, pt);
      const dd = pt.distanceToSquared(c);
      if (dd < bd) (bd = dd), (best = this.drawnId[i]);
    }
    return best;
  }

  personPosition(id: number): THREE.Vector3 | null {
    const p = this.game.people.get(id);
    if (!p || !isVisible(this.game, p)) return null;
    // where they are drawn (interpolated, at their work spot), when they were drawn last frame
    const m = this.movers.get(id);
    if (m && m.frame === this.frameNo) return new THREE.Vector3(m.rx, 0, m.ry);
    return new THREE.Vector3(p.x, 0, p.y);
  }
}
