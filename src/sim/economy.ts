import type { Game } from './game';
import { BUILDING, SKILLED_ONLY, JOB_SEX, buildWork, type Job, type BuildingDef } from './data/buildings';
import type { Good } from './data/goods';
import { SMUGGLER_PRICE } from './data/goods';
import type { Building, Person, Task } from './types';
import { onBuilt } from './placement';
import { housingPass, goTo } from './people';
import { SHIPS } from './data/ships';
import { NATIONS } from './data/kings';
import { Terrain } from './map';

/** global production speed: def times are "seconds per unit at perfect staffing" divided by this */
export const PROD_SPEED = 5;
/** how much a hauler can carry per trip */
export const HAUL_LOAD = 20;
/** stock a producer keeps back from the smuggler's cove for the island's own use */
const COVE_KEEP = 8;

// ------------------------------------------------------------------------------------------- fertility

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smoothNoise(x: number, y: number, s: number, scale: number): number {
  const fx = x / scale, fy = y / scale;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
const CROP_SEED: Partial<Record<Good, number>> = { corn: 1, banana: 2, papaya: 3, sugarcane: 4, tobacco: 5 };

/** per-crop fertility 0..1 */
export function cropFertility(g: Game, crop: Good, x: number, y: number): number {
  const m = g.map;
  if (!m.inBounds(x, y)) return 0;
  const base = m.fertility[m.idx(x, y)];
  if (crop === 'corn') return Math.min(1, base * 1.15);
  const v = smoothNoise(x, y, (CROP_SEED[crop] ?? 9) + g.settings.seed * 13, 14);
  return Math.max(0, Math.min(1, base * (0.4 + v * 1.2)));
}

// ------------------------------------------------------------------------------------------- goods

export function lumberTotal(g: Game): number {
  let t = 0;
  for (const b of g.buildings.values()) if (b.def === 'sawmill') t += b.inv.lumber ?? 0;
  return Math.floor(t);
}
export function consumeLumber(g: Game, n: number): void {
  for (const b of g.buildings.values()) {
    if (n <= 0) return;
    if (b.def !== 'sawmill') continue;
    const take = Math.min(n, b.inv.lumber ?? 0);
    b.inv.lumber = (b.inv.lumber ?? 0) - take;
    n -= take;
  }
}
export function goodTotal(g: Game, good: Good): number {
  let t = 0;
  for (const b of g.buildings.values()) t += b.inv[good] ?? 0;
  return t;
}
function producesGood(def: BuildingDef, good: Good): boolean {
  return def.recipe?.out === good || def.gather?.out === good;
}
function storageOf(def: BuildingDef): number {
  return def.storage ?? 30;
}

// ------------------------------------------------------------------------------------------- tasks for workers

export function workerTask(g: Game, b: Building, p: Person): Task | null {
  const def = BUILDING[b.def];
  if (b.built < 1) return null;
  // outdoor work positions
  if (def.gather?.from === 'fertility' && def.gather.crop) {
    const tx = b.x + g.rng.int(0, b.w - 1), ty = b.y + g.rng.int(0, b.h - 1);
    return { kind: 'work', bld: b.id, tx, ty, timer: 30 };
  }
  if (def.gather?.from === 'trees') {
    const t = findTree(g, b, 9);
    if (t) return { kind: 'work', bld: b.id, tx: t[0], ty: t[1], timer: 25 };
  }
  return { kind: 'work', bld: b.id, tx: b.door[0], ty: b.door[1], timer: 40 };
}

function findTree(g: Game, b: Building, r: number): [number, number] | null {
  const m = g.map;
  const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
  for (let tries = 0; tries < 30; tries++) {
    const x = cx + g.rng.int(-r, r), y = cy + g.rng.int(-r, r);
    if (m.inBounds(x, y) && m.trees[m.idx(x, y)] && !m.occupied[m.idx(x, y)]) return [x, y];
  }
  return null;
}

/** what a building wants hauled in: [good, wanted] list */
function haulWants(g: Game, b: Building): [Good, number][] {
  const def = BUILDING[b.def];
  const out: [Good, number][] = [];
  if (def.recipe) for (const k in def.recipe.in) {
    const have = b.inv[k as Good] ?? 0;
    if (have < 16) out.push([k as Good, 24 - have]);
  }
  if (def.service) for (const good of def.service.bonus) {
    const have = b.inv[good] ?? 0;
    if (have < 8) out.push([good, 16 - have]);
  }
  if (def.id === 'dock' && (!b.ship || g.ships.get(b.ship)?.status === 'atsea' || g.ships.get(b.ship)?.status === 'departing' || g.ships.get(b.ship)?.status === 'returning')) {
    // between voyages the dock stockpiles a ship's worth of stores, ready for a quick turnaround
    const stock: [Good, number][] = [['ration', 40], ['cutlass', 10], ['musket', 10], ['cannon', 12]];
    for (const [good, cap] of stock) if ((b.inv[good] ?? 0) < cap * 0.6) out.push([good, Math.min(10, cap - (b.inv[good] ?? 0))]);
  }
  if (def.id === 'dock' && b.ship) {
    const s = g.ships.get(b.ship);
    if (s && (s.status === 'docked' || s.status === 'repairing' || s.status === 'boarding')) {
      const d = SHIPS[s.type];
      const want: [Good, number][] = [['ration', d.rations - s.rations], ['cutlass', d.cutlasses - s.cutlasses], ['musket', d.muskets - s.muskets], ['cannon', d.cannons - s.cannons]];
      for (const w of want) if (w[1] > 0) out.push([w[0], Math.min(w[1], w[0] === 'ration' ? 10 : 4)]);
      if (s.status === 'repairing' && s.hull < 1) out.push(['lumber', 5]);
    }
  }
  return out;
}

/** find a source building holding good (prefer producers, nearest) */
function findSource(g: Game, b: Building, good: Good, smuggler = false): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const s of g.buildings.values()) {
    if (s === b || s.built < 1) continue;
    const have = s.inv[good] ?? 0;
    const def = BUILDING[s.def];
    if (!producesGood(def, good)) continue;
    if (have < (smuggler ? COVE_KEEP + 4 : 1)) continue;
    const d = Math.abs(s.door[0] - b.door[0]) + Math.abs(s.door[1] - b.door[1]) - Math.min(have, 20) * 2;
    if (d < bd) (bd = d), (best = s);
  }
  return best;
}

export function haulerTask(g: Game, b: Building, p: Person): Task | null {
  if (b.built < 1) return null;
  const def = BUILDING[b.def];
  let wants = haulWants(g, b);
  if (def.id === 'smugglers_cove') {
    wants = [];
    const open = NATIONS.some((n) => g.ongoing.has(`open_cove:${n}`));
    if (open) for (const k in SMUGGLER_PRICE) wants.push([k as Good, HAUL_LOAD]);
  }
  // rotate which want gets served
  const offs = g.rng.int(0, Math.max(0, wants.length - 1));
  for (let i = 0; i < wants.length; i++) {
    const [good, n] = wants[(i + offs) % wants.length];
    const src = findSource(g, b, good, def.id === 'smugglers_cove');
    if (!src) continue;
    // the smugglers take only the surplus, leaving the island's own taverns and docks their stock
    const surplus = def.id === 'smugglers_cove' ? Math.floor((src.inv[good] ?? 0) - COVE_KEEP) : n;
    return { kind: 'haul', bld: b.id, src: src.id, good, amount: Math.max(1, Math.min(n, surplus, HAUL_LOAD)), tx: src.door[0], ty: src.door[1], timer: 2 };
  }
  // nothing to do: wait at home building
  return { kind: 'work', bld: b.id, tx: b.door[0], ty: b.door[1], timer: 8 };
}

/** called by people.finish for haul tasks; returns true if task continues */
export function haulStep(g: Game, p: Person): boolean {
  const t = p.task;
  const home = g.buildings.get(t.bld!);
  if (!home) {
    p.carrying = undefined;
    return false;
  }
  if (!p.carrying) {
    // at source: pick up
    const src = g.buildings.get(t.src!);
    const good = t.good!;
    if (!src) return false;
    const take = Math.min(t.amount ?? 5, Math.floor(src.inv[good] ?? 0));
    if (take <= 0) return false;
    src.inv[good] = (src.inv[good] ?? 0) - take;
    p.carrying = good;
    if (goTo(g, p, home.door[0], home.door[1], { kind: 'haul', bld: home.id, good, amount: take, timer: 2 })) return true;
    // can't get home: drop it back
    src.inv[good] = (src.inv[good] ?? 0) + take;
    p.carrying = undefined;
    return false;
  }
  // at home: deliver
  const good = p.carrying;
  const amt = t.amount ?? 1;
  p.carrying = undefined;
  const def = BUILDING[home.def];
  if (def.id === 'dock' && home.ship) {
    const s = g.ships.get(home.ship);
    if (s && (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing')) {
      if (good === 'ration') s.rations += amt;
      else if (good === 'cutlass') s.cutlasses += amt;
      else if (good === 'musket') s.muskets += amt;
      else if (good === 'cannon') s.cannons += amt;
      else if (good === 'lumber') s.hull = Math.min(1, s.hull + amt * 0.05);
      return false;
    }
  }
  if (def.id === 'smugglers_cove') {
    const traders = home.workers.length + (home.overseer ? home.workers.length : 0);
    const price = Math.floor((SMUGGLER_PRICE[good] ?? 1) * (1 + traders / 50));
    g.earn(price * amt, 'smuggling');
    home.income += price * amt;
    return false;
  }
  home.inv[good] = (home.inv[good] ?? 0) + amt;
  return false;
}

export function builderTask(g: Game, tent: Building, p: Person): Task | null {
  if (tent.built < 1) return null;
  let best: Building | null = null, bs = -Infinity;
  for (const b of g.buildings.values()) {
    if (b.built >= 1 || b.condemned) continue;
    const d = Math.abs(b.door[0] - tent.door[0]) + Math.abs(b.door[1] - tent.door[1]);
    const score = b.priority * 30 - d;
    if (score > bs) (bs = score), (best = b);
  }
  if (!best) return { kind: 'work', bld: tent.id, tx: tent.door[0], ty: tent.door[1], timer: 10 };
  // stand around the site
  const side = g.rng.int(0, 3);
  let tx = best.x + g.rng.int(0, best.w - 1), ty = best.y + g.rng.int(0, best.h - 1);
  if (side === 0) ty = best.y - 1;
  else if (side === 1) ty = best.y + best.h;
  else if (side === 2) tx = best.x - 1;
  else tx = best.x + best.w;
  const w = g.pf.nearestWalkable(tx, ty, 3) ?? best.door;
  return { kind: 'build', bld: best.id, tx: w[0], ty: w[1], timer: 15 };
}

// ------------------------------------------------------------------------------------------- per tick

export function updateEconomy(g: Game, dt: number): void {
  // employment every 3 seconds
  if (Math.floor(g.time / 3) !== Math.floor((g.time - dt) / 3)) {
    sweepCustomers(g);
    employ(g);
  }
  // present-worker tallies
  const eff = new Map<number, number>();
  const overseer = new Set<number>();
  for (const p of g.people.values()) {
    const t = p.task;
    if (t.phase !== 1 || !t.bld) continue;
    if (t.kind === 'build') {
      const site = g.buildings.get(t.bld);
      if (site && site.built < 1) {
        const e = workEff(g, p, 'builder');
        site.built = Math.min(1, site.built + (dt * e) / buildWork(BUILDING[site.def]));
        if (site.built >= 1) {
          onBuilt(g, site);
          const def = BUILDING[site.def];
          g.msg('info', 'Construction Complete', `The ${def.name} is finished.`, undefined, { x: site.x + site.w / 2, y: site.y + site.h / 2 });
        }
      }
    } else if (t.kind === 'work' && p.kind !== 'pirate') {
      if (p.job === t.bld && p.jobRole !== 'hauler' && p.jobRole !== 'builder') eff.set(t.bld, (eff.get(t.bld) ?? 0) + workEff(g, p, p.jobRole!));
    } else if ((t.kind === 'work' || t.kind === 'guard') && p.kind === 'pirate') overseer.add(t.bld);
  }
  for (const b of g.buildings.values()) {
    if (b.built < 1) continue;
    const def = BUILDING[b.def];
    const slots = def.workers.reduce((a, s) => a + (s.job === 'hauler' ? 0 : s.count), 0);
    if (!slots) continue;
    let e = (eff.get(b.id) ?? 0) / slots;
    if (overseer.has(b.id)) e *= 1.25;
    if (g.ongoing.has('curfew')) e *= 1.1;
    // works whose upkeep went unpaid last month run short of tools, nails and lamp oil
    if (g.effects.neglect) e *= 1 - 0.3 * g.effects.neglect;
    b.staff += (Math.min(1, b.workers.length / slots) - b.staff) * Math.min(1, dt / 30);
    if (e <= 0) continue;
    const cap = storageOf(def);
    if (def.recipe) {
      const r = def.recipe;
      let ok = true;
      for (const k in r.in) if ((b.inv[k as Good] ?? 0) < r.in[k as Good]!) ok = false;
      if (!ok || (b.inv[r.out] ?? 0) >= cap) continue;
      b.progress += (dt * e * PROD_SPEED) / r.time;
      if (b.progress >= 1) {
        b.progress = Math.min(b.progress - 1, 0.99);
        for (const k in r.in) b.inv[k as Good]! -= r.in[k as Good]!;
        b.inv[r.out] = (b.inv[r.out] ?? 0) + 1;
        g.events.push({ type: 'produced', id: b.id, good: r.out });
      }
    } else if (def.gather) {
      const gd = def.gather;
      if ((b.inv[gd.out] ?? 0) >= cap) continue;
      let k = 1;
      if (gd.from === 'fertility' && gd.crop) k = Math.max(0.1, farmFertility(g, b, gd.crop));
      if (gd.from === 'trees') k = Math.min(1, treesNear(g, b, 9) / 50);
      if (gd.from === 'ore') k = Math.max(0.15, oreNear(g, b));
      if (k <= 0.02) continue;
      b.progress += (dt * e * k * PROD_SPEED) / gd.time;
      if (b.progress >= 1) {
        b.progress = Math.min(b.progress - 1, 0.99);
        b.inv[gd.out] = (b.inv[gd.out] ?? 0) + 1;
        g.events.push({ type: 'produced', id: b.id, good: gd.out });
        if (gd.from === 'trees' && g.rng.chance(0.35)) fellTree(g, b);
        if (gd.from === 'none') announceAccessory(g, b, gd.out);
      }
    }
  }
}

function announceAccessory(g: Game, b: Building, good: Good): void {
  const what = good === 'pegleg' ? 'A peg leg has been carved' : good === 'hat' ? 'A splendid hat is ready' : 'A parrot is trained';
  g.msg('good', 'Accoutrement Ready', `${what}. Use the Outfit Pirate edict to bestow it.`, `accessory_${good}`, { x: b.x, y: b.y });
}

function workEff(g: Game, p: Person, job: Job): number {
  if (p.kind === 'skeleton') return 0.7;
  const lv = p.jobSkill[job] ?? 0;
  let e = 0.55 + lv * 0.09;
  if (g.has('industrious')) e *= 1.15;
  if (g.has('lazy')) e *= 0.87;
  // captives learn by doing
  const cap = p.skilled ? 5 : 3;
  p.jobSkill[job] = Math.min(cap, lv + 0.0004);
  return e;
}

export function farmFertility(g: Game, b: Building, crop: Good): number {
  let f = 0;
  for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) f += cropFertility(g, crop, i, j);
  return f / (b.w * b.h);
}
export function treesNear(g: Game, b: Building, r: number): number {
  const m = g.map;
  let t = 0;
  const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
  for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) if (m.inBounds(i, j)) t += m.trees[m.idx(i, j)];
  return t;
}
function oreNear(g: Game, b: Building): number {
  const m = g.map;
  let best = 0;
  for (let j = b.y - 2; j < b.y + b.h + 2; j++) for (let i = b.x - 2; i < b.x + b.w + 2; i++) if (m.inBounds(i, j)) best = Math.max(best, m.ore[m.idx(i, j)]);
  return best;
}
function fellTree(g: Game, b: Building): void {
  const t = findTree(g, b, 9);
  if (!t) return;
  const m = g.map;
  const k = m.idx(t[0], t[1]);
  m.trees[k] = Math.max(0, m.trees[k] - 1);
  if (!m.trees[k] && m.terrain[k] === Terrain.Jungle) m.terrain[k] = Terrain.Grass;
  g.events.push({ type: 'trees', x: t[0], y: t[1], w: 1, h: 1 });
}

/**
 * A visitor whose errand was interrupted (a chase, a brawl, the ship's bell, a call to arms) never reaches
 * the counter to sign out, and would hold the seat forever: venues and bunks would slowly fill with ghosts
 * until nobody could get a drink. Anyone no longer bound for or inside the building gives up their place.
 */
function sweepCustomers(g: Game): void {
  for (const b of g.buildings.values()) {
    if (!b.customers.length) continue;
    b.customers = b.customers.filter((id) => {
      const q = g.people.get(id);
      return !!q && q.task.kind !== 'dead' && q.task.bld === b.id;
    });
  }
}

// ------------------------------------------------------------------------------------------- employment

/** a producer whose store is full has nothing for its workers to do */
function outputFull(b: Building): boolean {
  const def = BUILDING[b.def];
  const out = def.recipe?.out ?? def.gather?.out;
  if (!out || def.captiveService) return false;
  return (b.inv[out] ?? 0) >= storageOf(def) * 0.95;
}

function canDoJob(p: Person, job: Job): boolean {
  if (p.kind === 'skeleton') return job === 'hauler';
  if (p.kind !== 'captive' || p.rebel) return false;
  if (p.skilled) return p.profession === job;
  if (SKILLED_ONLY.includes(job)) return false;
  const sx = JOB_SEX[job];
  return !sx || sx === p.sex;
}

function employ(g: Game): void {
  const sitesAny = [...g.buildings.values()].some((x) => x.built < 1);
  // effective priority: idle builders and producers with full stores yield their workers
  const eff = (b: Building) => b.priority - (outputFull(b) ? 2.5 : 0) - (b.def === 'construction_tent' && !sitesAny ? 3.5 : 0);
  const bl = [...g.buildings.values()].filter((b) => b.built >= 1 && !b.condemned).sort((a, b) => eff(b) - eff(a));
  const free: Person[] = [];
  const freePirates: Person[] = [];
  for (const p of g.people.values()) {
    if (p.task.kind === 'dead' || p.task.kind === 'escape' || p.rebel) continue;
    if ((p.kind === 'captive' || p.kind === 'skeleton') && !p.job) free.push(p);
    if (p.kind === 'pirate' && !p.ship && !p.shoreJob && !p.captain && p.mood === 'ok' && p.task.kind !== 'atsea') freePirates.push(p);
  }
  // women are scarce for the many female-only jobs: keep them free when a man can do the job
  let femaleDemand = 0;
  for (const b of bl) for (const slot of BUILDING[b.def].workers) if (JOB_SEX[slot.job] === 'F') {
    femaleDemand += Math.max(0, slot.count - b.workers.filter((id) => g.people.get(id)?.jobRole === slot.job).length);
  }
  const take = (b: Building, job: Job): Person | null => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const p = free[i];
      if (!canDoJob(p, job)) continue;
      // skilled specialists first
      let d = Math.abs(p.x - b.door[0]) + Math.abs(p.y - b.door[1]) - (p.skilled ? 1000 : 0);
      if (!JOB_SEX[job] && p.sex === 'F' && femaleDemand > 0) d += 500;
      if (d < bd) (bd = d), (best = i);
    }
    if (best < 0) return null;
    const p = free.splice(best, 1)[0];
    if (JOB_SEX[job] === 'F') femaleDemand--;
    return p;
  };
  // take a worker from a building with lower effective priority
  const poach = (b: Building, job: Job): Person | null => {
    const mine = eff(b);
    for (let i = bl.length - 1; i >= 0; i--) {
      const o = bl[i];
      if (o === b || eff(o) >= mine) continue;
      for (const id of o.workers) {
        const q = g.people.get(id);
        if (!q || !canDoJob(q, job)) continue;
        o.workers = o.workers.filter((w) => w !== id);
        q.job = 0;
        q.jobRole = undefined;
        if (q.task.bld === o.id && q.task.kind === 'work') q.task = { kind: 'idle' };
        return q;
      }
    }
    return null;
  };
  for (const b of bl) {
    const def = BUILDING[b.def];
    let blocked = b.blocked;
    for (const slot of def.workers) {
      const isHaul = slot.job === 'hauler';
      const list = isHaul ? b.haulers : b.workers;
      const have = list.filter((id) => g.people.get(id)?.jobRole === slot.job).length;
      let open = slot.count - have;
      while (open > 0) {
        if (blocked > 0) {
          blocked--;
          open--;
          continue;
        }
        let p = take(b, slot.job);
        if (!p) p = poach(b, slot.job);
        if (!p) break;
        p.job = b.id;
        p.jobRole = slot.job;
        list.push(p.id);
        open--;
      }
      // skilled replacement of unskilled
      if (open === 0 && !SKILLED_ONLY.includes(slot.job)) {
        const idx = free.findIndex((p) => p.skilled && p.profession === slot.job);
        if (idx >= 0) {
          const unskilledId = list.find((id) => {
            const q = g.people.get(id);
            return q && !q.skilled && q.jobRole === slot.job;
          });
          if (unskilledId) {
            const q = g.people.get(unskilledId)!;
            list.splice(list.indexOf(unskilledId), 1);
            q.job = 0;
            q.jobRole = undefined;
            const p = free.splice(idx, 1)[0];
            p.job = b.id;
            p.jobRole = slot.job;
            list.push(p.id);
            free.push(q);
          }
        }
      }
    }
    // building-specific haulers
    const nh = def.haulers ?? 0;
    while (b.haulers.filter((id) => g.people.get(id)?.jobRole === 'hauler').length < nh) {
      const p = take(b, 'hauler');
      if (!p) break;
      p.job = b.id;
      p.jobRole = 'hauler';
      b.haulers.push(p.id);
    }
    // overseer and guards (pirates)
    if (def.overseer && !b.overseer && b.wage > 0) {
      const p = freePirates.shift();
      if (p) (b.overseer = p.id), (p.shoreJob = b.id), (p.shoreRole = 'overseer');
    }
    if (def.guards) {
      while (b.guards.length < def.guards && b.wage > 0) {
        const p = freePirates.shift();
        if (!p) break;
        b.guards.push(p.id);
        p.shoreJob = b.id;
        p.shoreRole = 'guard';
      }
    }
  }
}

// ------------------------------------------------------------------------------------------- monthly

export function monthlyEconomy(g: Game): void {
  let upkeep = 0, due = 0;
  const payroll: [Person, number][] = [];
  for (const b of g.buildings.values()) {
    b.lastIncome = b.income;
    b.income = 0;
    if (b.built < 1) continue;
    const def = BUILDING[b.def];
    let u = def.upkeep;
    if ((def.id === 'gambling_den' || def.id === 'casino') && (g.has('gambler') || g.has('lucky_cards'))) u = 0;
    upkeep += u;
    const staffPirates = [b.overseer, ...b.guards].filter(Boolean);
    for (const id of staffPirates) {
      const p = g.people.get(id);
      if (!p) continue;
      payroll.push([p, b.wage]);
      due += b.wage;
    }
  }
  // an empty treasury can't pay: what it can't cover goes unpaid rather than into debt. Unpaid upkeep
  // lets the works run down (see updateEconomy) and unpaid overseers and guards go without
  const bill = upkeep + due;
  const ratio = bill > 0 ? Math.max(0, Math.min(1, g.treasury / bill)) : 1;
  g.effects.neglect = 1 - ratio;
  let wages = 0;
  for (const [p, w] of payroll) {
    const paid = w * ratio;
    p.gold += paid;
    p.earned += paid;
    wages += paid;
  }
  g.spend(upkeep * ratio, 'maintenance');
  g.spend(wages, 'wages');
  housingPass(g);
  assignCrewsMonthly(g);
  // wealthy captives run up their ransom
  for (const p of g.people.values()) if (p.kind === 'wealthy') (p.ransom += Math.floor(p.credit)), (p.credit = 0);
  // trees regrow slowly next to forest
  const m = g.map;
  for (let i = 0; i < 80; i++) {
    const x = g.rng.int(1, m.size - 2), y = g.rng.int(1, m.size - 2);
    const k = m.idx(x, y);
    if (m.occupied[k] || m.path[k] || m.terrain[k] !== Terrain.Grass && m.terrain[k] !== Terrain.Jungle) continue;
    let nb = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) nb += m.trees[m.idx(x + dx, y + dy)] ? 1 : 0;
    if (nb >= 2 && m.trees[k] < 3) {
      m.trees[k]++;
      g.events.push({ type: 'trees', x, y, w: 1, h: 1 });
    }
  }
  // the lumberjacks' clearings grow back fast in the tropics: saplings take root around every timber camp,
  // so a camp on even a thin wood keeps working (slowly) instead of felling its patch bare for good
  for (const b of g.buildings.values()) {
    if (b.def !== 'timber_camp' || b.built < 1) continue;
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1);
    for (let i = 0; i < 8; i++) {
      const x = cx + g.rng.int(-9, 9), y = cy + g.rng.int(-9, 9);
      if (!m.inBounds(x, y)) continue;
      const k = m.idx(x, y);
      if (m.occupied[k] || m.path[k] || (m.terrain[k] !== Terrain.Grass && m.terrain[k] !== Terrain.Jungle) || m.trees[k] >= 3) continue;
      let nb = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.inBounds(x + dx, y + dy)) nb += m.trees[m.idx(x + dx, y + dy)] ? 1 : 0;
      if (nb >= 1 || g.rng.chance(0.25)) {
        m.trees[k]++;
        g.events.push({ type: 'trees', x, y, w: 1, h: 1 });
      }
    }
  }
  // black market prices relax
  for (const k in g.blackMarketMarkup) g.blackMarketMarkup[k as Good] = Math.max(0, (g.blackMarketMarkup[k as Good] ?? 0) - 0.04);
  g.effects.recentEscapes *= 0.6;
  g.effects.recentKills *= 0.6;
  // word of a free pirate haven spreads: would-be buccaneers drift in when the island is merry
  immigration(g);
  // an island with no ship and nobody to build one would be stuck for good: sooner or later a stranded
  // shipwright turns up looking for work
  if (!g.ships.size && !g.hasProfession('shipwright') && g.rng.chance(0.2)) {
    const at = g.findBuilding('dock') ?? g.findBuilding('palace');
    if (at) {
      createPerson(g, 'captive', at.door[0], at.door[1], { skilled: 'shipwright' });
      g.msg('good', 'A Shipwright Washes Up', 'A shipwright, marooned by his own crew, has staggered ashore. He will build you a hull if you give him a boatyard.', undefined, { x: at.door[0], y: at.door[1] });
    }
  }
  // shipwreck advantage: castaways
  if (g.settings.advantage === 'shipwreck' && g.rng.chance(0.25)) castaways(g);
}

import { assignCrews } from './sea';
import { createPerson } from './people';
function assignCrewsMonthly(g: Game): void {
  assignCrews(g);
}
function castaways(g: Game): void {
  const m = g.map;
  for (let t = 0; t < 200; t++) {
    const x = g.rng.int(1, m.size - 2), y = g.rng.int(1, m.size - 2);
    if (m.terrain[m.idx(x, y)] !== Terrain.Beach) continue;
    const n = g.rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const skilled = g.rng.chance(0.25) ? g.rng.pick(['farmer', 'cook', 'server', 'wench', 'trader', 'priest'] as Job[]) : undefined;
      createPerson(g, 'captive', x, y, { skilled });
    }
    g.msg('good', 'Castaways!', `${n} shipwrecked souls have washed up on your beach. Welcome to your new life.`, 'castaways', { x, y });
    return;
  }
}

function immigration(g: Game): void {
  const pir = g.pirates();
  const hap = pir.length ? g.avgHappiness() : 0.6;
  const notoriety = pir.filter((p) => p.captain).reduce((a, p) => a + p.traits.notoriety, 0);
  const cap = 12 + g.buildingCount('housing_plot') * 1.2 + g.ships.size * 6;
  if (pir.length >= cap) return;
  const chance = Math.max(0, hap - 0.35) * 1.4 + Math.min(0.3, notoriety * 0.02) + (pir.length < 6 ? 0.4 : 0);
  if (!g.rng.chance(Math.min(0.9, chance))) return;
  const dock = g.findBuilding('dock') ?? g.findBuilding('palace');
  if (!dock) return;
  const n = g.rng.int(1, pir.length < 6 ? 4 : 2);
  for (let i = 0; i < n; i++) {
    const p = createPerson(g, 'pirate', dock.door[0], dock.door[1]);
    p.earned = g.rng.int(0, 120);
    p.gold = g.rng.int(10, 60);
  }
  g.msg('good', 'New Arrivals', `${n === 1 ? 'A would-be buccaneer has' : `${n} would-be buccaneers have`} come ashore, drawn by tales of your free and merry island.`, undefined, { x: dock.door[0], y: dock.door[1] });
}
