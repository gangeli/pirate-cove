import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Person } from '../sim/types';
import { BUILDING } from '../sim/data/buildings';
import type { World } from './world';
import { loadCrowd, type CrowdModel, type Look } from './crowd';

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
const SKIN = [0xf1c8a8, 0xe0ac88, 0xc68a62, 0xa0663e, 0x7a4a2a, 0x5a3420].map(C);
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

export class PeopleView {
  readonly group = new THREE.Group();
  private models: Record<'male' | 'female' | 'soldier', CrowdModel> | null = null;
  ready: Promise<void>;
  selected = 0;
  private ring: THREE.Mesh;
  private t = 0;
  private looks = new Map<number, Look>();
  /** per-frame list of drawn people for picking */
  private drawn: { id: number; x: number; y: number; z: number }[] = [];
  /** visual scale of characters (model is ~1.82 m tall; tiles are 2 m) */
  scale = 0.68;

  constructor(private world: World, private game: Game) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe080, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.ready = loadCrowd().then((m) => {
      this.models = m;
      for (const k of Object.values(m)) this.group.add(k.mesh);
    });
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
      const bone = C(0xe8e0c8);
      l = { skin: bone, shirt: bone.clone(), pants: bone.clone(), hair: bone.clone(), beard: false, hat: null, hat2: null, sash: C(0x4a4038), boots: bone.clone() };
    }
    this.looks.set(p.id, l);
    return l;
  }

  /** choose the animation clip and playback speed for what the person is doing */
  private clipFor(p: Person): [string, number] {
    const t = p.task;
    if (t.kind === 'dead') return ['die', 1];
    if (t.phase === 0) {
      if (t.kind === 'escape' || t.kind === 'flee' || t.kind === 'rebel' || p.kind === 'soldier') return ['run', 1];
      if (p.carrying) return ['carry', 1];
      return ['walk', p.accessories.pegleg ? 0.8 : 1];
    }
    switch (t.kind) {
      case 'chase':
      case 'fight':
        return t.phase === 2 ? ['fight', 1] : ['run', 1];
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

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    if (!this.models) return;
    const ms = this.models;
    for (const m of Object.values(ms)) m.reset();
    this.drawn.length = 0;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p3 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const cam = this.world.rig.camera.position;
    let selPos: THREE.Vector3 | null = null;
    for (const per of g.people.values()) {
      if (!isVisible(g, per)) continue;
      // distance cull for very far zoom
      if (Math.abs(per.x - cam.x) > 200 || Math.abs(per.y - cam.z) > 200) continue;
      let y = g.map.heightAt(per.x, per.y);
      const tb = per.task.bld ? g.buildings.get(per.task.bld) : undefined;
      if (tb && tb.def === 'dock' && g.map.height[g.map.idx(Math.floor(per.x), Math.floor(per.y))] < 0.2) y = Math.max(y, 0.35);
      if (y < -0.3) y = -0.3; // wading
      const [clip, speed] = this.clipFor(per);
      const dead = per.task.kind === 'dead';
      const tt = dead ? 6 - (per.dyingTimer ?? 0) : this.t * speed + hash(per.id, 30) * 10;
      q.setFromAxisAngle(up, Math.PI / 2 - per.dir);
      const sc = this.scale * (per.kind === 'soldier' ? 1.02 : 0.94 + hash(per.id, 31) * 0.12) * (per.sex === 'F' ? 0.95 : 1);
      mtx.compose(p3.set(per.x, y, per.y), q, s.set(sc, sc, sc));
      const model = per.kind === 'soldier' ? ms.soldier : per.sex === 'F' ? ms.female : ms.male;
      model.add(mtx, clip, tt, this.lookOf(per));
      this.drawn.push({ id: per.id, x: per.x, y, z: per.y });
      if (per.id === this.selected) selPos = new THREE.Vector3(per.x, y + 0.04, per.y);
    }
    for (const m of Object.values(ms)) m.commit();
    this.ring.visible = !!selPos;
    if (selPos) this.ring.position.copy(selPos);
  }

  /** nearest drawn person to the pick ray */
  pickPerson(ray: THREE.Raycaster): number {
    let best = 0, bd = 0.45 * 0.45;
    const r = ray.ray;
    const pt = new THREE.Vector3(), c = new THREE.Vector3();
    for (const d of this.drawn) {
      c.set(d.x, d.y + 0.5, d.z);
      r.closestPointToPoint(c, pt);
      const dd = pt.distanceToSquared(c);
      if (dd < bd) (bd = dd), (best = d.id);
    }
    return best;
  }

  personPosition(id: number): THREE.Vector3 | null {
    const p = this.game.people.get(id);
    if (!p || !isVisible(this.game, p)) return null;
    return new THREE.Vector3(p.x, 0, p.y);
  }
}
