import type { Game } from './game';
import { MONTH, YEAR } from './time';
import type { Building, Kind, Person, Ship, Task } from './types';
import { BUILDING, HOUSE_LEVELS, RANKS, SKILLED_ONLY, JOB_SEX, type Job, type PirateNeed } from './data/buildings';
import { NATIONS, type Nation } from './data/kings';
import { personName, CAPTAIN_NAMES, SHIP_NAMES } from './names';
import { SHIPS, type ShipType } from './data/ships';
import { workerTask, haulerTask, builderTask, haulStep } from './economy';
import { Terrain } from './map';

const PIRATE_NEEDS: PirateNeed[] = ['feast', 'drink', 'company', 'gamble', 'rest', 'stash'];
/** per-second decay at normal speed */
const PIRATE_DECAY: Record<PirateNeed, number> = { feast: 1 / 380, drink: 1 / 300, company: 1 / 520, gamble: 1 / 600, rest: 1 / 420, stash: 1 / 900 };
const CAPTIVE_DECAY = { food: 1 / 300, rest: 1 / 280, prayer: 1 / 700 };

export function createPerson(g: Game, kind: Kind, x: number, y: number, opts: { skilled?: Job; sex?: 'M' | 'F'; nat?: Nation; wealthy?: boolean } = {}): Person {
  const r = g.rng;
  let sex: 'M' | 'F' = opts.sex ?? (kind === 'pirate' ? (r.chance(0.1) ? 'F' : 'M') : r.chance(0.5) ? 'F' : 'M');
  if (opts.skilled && JOB_SEX[opts.skilled]) sex = JOB_SEX[opts.skilled]!;
  const nat = opts.nat ?? r.pick(NATIONS);
  const t = () => r.int(1, 9);
  const sk = () => Math.max(0, Math.min(5, r.gauss(kind === 'pirate' ? 2 : 0.5, 1)));
  const p: Person = {
    id: g.nextId++, kind, sex, nat, name: personName(r, nat, sex, kind === 'pirate'), age: r.int(17, 48),
    x: x + 0.5, y: y + 0.5, dir: r.range(0, Math.PI * 2), path: null, pathI: 0, task: { kind: 'idle' }, arrived: g.time,
    needs: kind === 'pirate'
      ? { feast: r.range(0.4, 0.9), drink: r.range(0.3, 0.9), company: r.range(0.3, 0.9), gamble: r.range(0.4, 0.9), rest: r.range(0.5, 1), stash: r.range(0.4, 0.9) }
      : { food: r.range(0.5, 1), rest: r.range(0.5, 1), prayer: 1 },
    opinion: {}, env: { order: 0, fear: 0, awe: 0, defense: 0 },
    gold: kind === 'pirate' ? r.int(20, 80) : 0, earned: 0, rank: 1,
    skills: { gunnery: sk(), swordsmanship: sk(), marksmanship: sk(), seamanship: sk(), navigation: sk() },
    traits: { courage: t(), leadership: t(), notoriety: kind === 'pirate' ? r.int(1, 4) : 1, loyalty: t() },
    weights: {}, home: 0, ship: 0, shoreJob: 0, stashed: 0, lastStash: 0, haunts: {}, mood: 'ok', accessories: {},
    happiness: 0.6, profession: opts.skilled ?? 'none', skilled: !!opts.skilled, jobSkill: {}, job: 0, resignation: 0.5,
    ransom: 0, credit: 0, escapeCooldown: MONTH * 2, hp: 1, thoughts: [],
  };
  for (const k in p.needs) p.opinion[k] = p.needs[k];
  if (kind === 'pirate') {
    for (const n of PIRATE_NEEDS) p.weights[n] = r.range(0.6, 1.4);
    p.earned = r.int(0, 220);
    p.rank = rankFor(p.earned);
    if (g.has('master_gunner')) p.skills.gunnery = Math.min(5, p.skills.gunnery + 2);
    if (g.has('duelist')) p.skills.marksmanship = Math.min(5, p.skills.marksmanship + 2);
    if (g.has('seafarer')) p.skills.seamanship = Math.min(5, p.skills.seamanship + 1);
    if (g.has('charismatic')) p.traits.leadership = Math.min(9, p.traits.leadership + 3);
    if (g.has('courageous') && g.time < 1) p.traits.courage = Math.min(9, p.traits.courage + 2);
  }
  if (kind === 'captive' && opts.skilled) {
    p.jobSkill[opts.skilled] = r.range(3, 5);
    p.ransom = SKILLED_ONLY.includes(opts.skilled) ? r.int(250, 450) : r.int(120, 250);
  }
  if (kind === 'wealthy') {
    p.ransom = r.int(150, 400);
    p.rank = 9;
    for (const n of PIRATE_NEEDS) p.weights[n] = n === 'stash' ? 0 : 1;
    p.needs = { feast: 0.6, drink: 0.6, company: 0.6, gamble: 0.6, rest: 0.7, stash: 1 };
  }
  if (kind === 'skeleton') {
    p.name = 'Skeleton';
    p.needs = { food: 1, rest: 1, prayer: 1 };
  }
  g.people.set(p.id, p);
  g.events.push({ type: 'spawn', id: p.id });
  return p;
}

export function createCaptain(g: Game, x: number, y: number): Person {
  const p = createPerson(g, 'pirate', x, y, { sex: g.rng.chance(0.12) ? 'F' : 'M' });
  const used = new Set([...g.people.values()].filter((q) => q.captain).map((q) => q.name));
  const free = CAPTAIN_NAMES.filter((n) => !used.has(n));
  p.name = free.length ? g.rng.pick(free) : `Captain ${p.name}`;
  p.captain = true;
  p.earned = g.rng.int(600, 1600);
  p.rank = rankFor(p.earned);
  p.gold = g.rng.int(100, 300);
  p.traits.leadership = Math.max(p.traits.leadership, g.rng.int(4, 9));
  p.traits.courage = Math.max(p.traits.courage, g.rng.int(3, 9));
  p.traits.notoriety = g.rng.int(2, 6) + (g.has('notoriety') ? 2 : 0);
  p.traits.loyalty = g.rng.int(3, 9);
  p.skills.seamanship = Math.min(5, 2 + g.rng.range(0, 3));
  p.skills.navigation = Math.min(5, 2 + g.rng.range(0, 3) + (g.has('navigator') ? 1.5 : 0));
  return p;
}

export function createShip(g: Game, type: ShipType, dock: Building | null): Ship {
  const used = new Set([...g.ships.values()].map((s) => s.name));
  const free = SHIP_NAMES.filter((n) => !used.has(n));
  const d = SHIPS[type];
  const s: Ship = {
    id: g.nextId++, type, name: free.length ? g.rng.pick(free) : `Ship ${g.nextId}`, dock: dock?.id ?? 0, captain: 0, crew: [], officers: [],
    hull: 1, rations: Math.floor(d.rations * 0.5), cutlasses: Math.floor(d.cutlasses * 0.5), muskets: 0, cannons: Math.floor(d.cannons * 0.5),
    mission: 'cruise', orders: 'board', spoils: g.has('greedy') ? 'selfish' : 'generous', region: g.homeRegion,
    status: 'docked', vx: 0, vy: 0, vdir: 0, log: [],
  };
  if (dock) {
    dock.ship = s.id;
    const p = dockBerth(dock);
    s.vx = p[0];
    s.vy = p[1];
    s.vdir = p[2];
  }
  g.ships.set(s.id, s);
  g.events.push({ type: 'shipSpawn', id: s.id });
  return s;
}

/** where a ship moors relative to its dock: [x, y, heading] */
export function dockBerth(dock: Building): [number, number, number] {
  const F: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  const [fx, fy] = F[(dock.rot + 2) % 4]; // seaward
  const cx = dock.x + dock.w / 2, cy = dock.y + dock.h / 2;
  const off = (fx ? dock.w : dock.h) / 2 + 2.2;
  // ship lies alongside the end of the pier, parallel to the coast
  const side: [number, number] = [-fy, fx];
  return [cx + fx * off + side[0] * 0.5, cy + fy * off + side[1] * 0.5, Math.atan2(side[1], side[0])];
}

export function rankFor(earned: number): number {
  let r = 1;
  for (const k of RANKS) if (earned >= k.earn) r = k.rank;
  return r;
}

export function killPerson(g: Game, p: Person, cause: string): void {
  if (p.task.kind === 'dead') return;
  releaseAll(g, p);
  p.task = { kind: 'dead' };
  p.dyingTimer = 6;
  p.path = null;
  g.stats.deaths++;
  const k = `${p.kind}:${cause}`;
  (g.stats as any).causes ??= {};
  (g.stats as any).causes[k] = ((g.stats as any).causes[k] ?? 0) + 1;
  if (p.kind === 'pirate') {
    g.stats.piratesDied++;
    if (g.buildingCount('graveyard')) g.graveyard.push({ name: p.name, nat: p.nat });
  }
  g.events.push({ type: 'death', id: p.id, cause, x: p.x, y: p.y });
}

/** detach person from all buildings / ships */
export function releaseAll(g: Game, p: Person): void {
  const b = p.task.bld ? g.buildings.get(p.task.bld) : undefined;
  if (b) b.customers = b.customers.filter((c) => c !== p.id);
  if (p.job) {
    const j = g.buildings.get(p.job);
    if (j) (j.workers = j.workers.filter((w) => w !== p.id)), (j.haulers = j.haulers.filter((w) => w !== p.id));
    p.job = 0;
  }
  if (p.shoreJob) {
    const j = g.buildings.get(p.shoreJob);
    if (j) {
      j.guards = j.guards.filter((w) => w !== p.id);
      if (j.overseer === p.id) j.overseer = 0;
    }
    p.shoreJob = 0;
  }
  if (p.home) {
    const h = g.buildings.get(p.home);
    if (h && h.owner === p.id) h.owner = 0;
    p.home = 0;
  }
  if (p.ship) {
    const s = g.ships.get(p.ship);
    if (s) {
      s.crew = s.crew.filter((c) => c !== p.id);
      s.officers = s.officers.filter((c) => c !== p.id);
      if (s.captain === p.id) s.captain = 0;
    }
    p.ship = 0;
  }
}

// -------------------------------------------------------------------------------------------------- movement

export function tileOf(p: Person): [number, number] {
  return [Math.floor(p.x), Math.floor(p.y)];
}

/** start walking to tile; then perform task. returns false if unreachable */
export function goTo(g: Game, p: Person, tx: number, ty: number, task: Task): boolean {
  const [sx, sy] = tileOf(p);
  let start: [number, number] = [sx, sy];
  if (g.pf.cost(sy * g.map.size + sx) === Infinity) {
    const w = g.pf.nearestWalkable(sx, sy, 6);
    if (w) start = w;
  }
  const path = g.pf.find(start[0], start[1], tx, ty);
  if (!path) return false;
  p.path = Array.from(path);
  p.pathI = 0;
  p.task = { ...task, phase: 0 };
  return true;
}

function moveAlong(g: Game, p: Person, dt: number): boolean {
  if (!p.path || p.pathI >= p.path.length) return true;
  const n = g.map.size;
  const k = p.path[p.pathI];
  const tx = (k % n) + 0.5, ty = Math.floor(k / n) + 0.5;
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  const cur = Math.floor(p.y) * n + Math.floor(p.x);
  let sp = g.map.path[cur] ? 1.7 : g.map.trees[cur] ? 0.75 : 1.1;
  if (p.task.kind === 'escape' || p.task.kind === 'chase' || p.task.kind === 'flee') sp *= 1.8;
  if (p.kind === 'soldier' || p.task.kind === 'rebel' || p.task.kind === 'fight') sp *= 1.3;
  if (p.accessories.pegleg) sp *= 0.85;
  if (p.carrying) sp *= 0.9;
  const step = sp * dt;
  if (d <= step) {
    p.x = tx;
    p.y = ty;
    p.pathI++;
    return p.pathI >= p.path.length;
  }
  p.x += (dx / d) * step;
  p.y += (dy / d) * step;
  p.dir = Math.atan2(dy, dx);
  return false;
}

// -------------------------------------------------------------------------------------------------- main update

export function updatePeople(g: Game, dt: number): void {
  const slowTick = Math.floor(g.time * 2) !== Math.floor((g.time - dt) * 2); // 2 Hz
  for (const p of g.people.values()) {
    if (p.task.kind === 'dead') {
      p.dyingTimer = (p.dyingTimer ?? 0) - dt;
      if (p.dyingTimer <= 0) {
        g.people.delete(p.id);
        g.events.push({ type: 'despawn', id: p.id });
      }
      continue;
    }
    if (p.task.kind === 'atsea') {
      // prisoners of a lost ship (no ship, a timer) make their way home in the end
      if (!p.ship && p.task.timer !== undefined) {
        p.task.timer -= dt;
        if (p.task.timer <= 0) returnFromCaptivity(g, p);
      }
      continue;
    }
    decayNeeds(g, p, dt);
    if ((p.task.kind as string) === 'dead') continue;
    if (slowTick) {
      absorbEnv(g, p, 0.5);
      if (p.kind === 'pirate' || p.kind === 'wealthy') updatePirateMood(g, p, 0.5);
      else if (p.kind === 'captive') updateResignation(g, p, 0.5);
    }
    const t = p.task;
    if (t.phase === 0) {
      if (moveAlong(g, p, dt)) {
        t.phase = 1;
        p.path = null;
        arrive(g, p);
      }
      continue;
    }
    // acting
    if (t.timer !== undefined) {
      t.timer -= dt;
      act(g, p, dt);
      if (t.timer <= 0) finish(g, p);
    } else {
      think(g, p);
    }
  }
}

function decayNeeds(g: Game, p: Person, dt: number): void {
  if (p.kind === 'skeleton' || p.kind === 'soldier') return;
  if (p.kind === 'pirate' || p.kind === 'wealthy') {
    for (const n of PIRATE_NEEDS) p.needs[n] = Math.max(0, p.needs[n] - PIRATE_DECAY[n] * dt * (0.6 + 0.4 * (p.weights[n] ?? 1)));
    for (const n of PIRATE_NEEDS) p.opinion[n] = (p.opinion[n] ?? 0.5) + (p.needs[n] - (p.opinion[n] ?? 0.5)) * Math.min(1, dt / 240);
  } else {
    p.needs.food = Math.max(0, p.needs.food - CAPTIVE_DECAY.food * dt);
    p.needs.rest = Math.max(0, p.needs.rest - CAPTIVE_DECAY.rest * dt);
    if (g.time - p.arrived > YEAR * 2 && g.buildingCount('church')) p.needs.prayer = Math.max(0, p.needs.prayer - CAPTIVE_DECAY.prayer * dt);
    for (const n of ['food', 'rest', 'prayer']) p.opinion[n] = (p.opinion[n] ?? 0.5) + (p.needs[n] - (p.opinion[n] ?? 0.5)) * Math.min(1, dt / 200);
    if (p.needs.food <= 0) {
      p.hp -= dt / 240;
      if (p.hp <= 0) {
        killPerson(g, p, 'starvation');
        g.msg('bad', 'Starvation', `${p.name} has starved to death. Your captives need more slop!`, 'starvation', { x: p.x, y: p.y });
      }
    } else p.hp = Math.min(1, p.hp + dt / 300);
  }
}

function absorbEnv(g: Game, p: Person, dt: number): void {
  if (g.time - p.arrived < g.auraDelay()) return;
  if (p.kind === 'skeleton') return;
  const a = g.aura;
  const rate = Math.min(1, dt / 90);
  const ord = a.at('order', p.x, p.y) / 100;
  p.env.order += (ord - p.env.order) * rate;
  p.env.fear += (a.at('fear', p.x, p.y) / 100 - p.env.fear) * rate;
  p.env.awe += (a.at('awe', p.x, p.y) / 100 - p.env.awe) * rate;
  p.env.defense += (a.at('defense', p.x, p.y) / 100 - p.env.defense) * rate;
}

/** happiness: mean of six opinions (weighted), plus anarchy and defense feelings */
export function pirateFactors(g: Game, p: Person): Record<string, number> {
  const f: Record<string, number> = {};
  for (const n of PIRATE_NEEDS) f[n] = p.opinion[n] ?? 0.5;
  const delayOver = g.time - p.arrived >= g.auraDelay();
  // anarchy: pirates like low order (negative order channel)
  let anarchy = delayOver ? Math.max(0, Math.min(1, 0.5 - p.env.order * 0.9)) : 0.6;
  let defense = delayOver ? Math.max(0, Math.min(1, 0.25 + p.env.defense * 0.9)) : 0.6;
  // policy grievances
  if (g.ongoing.has('curfew')) anarchy -= 0.25;
  if (g.ongoing.has('loose_lips')) anarchy -= 0.1;
  if (g.ongoing.has('patrols')) anarchy -= 0.1;
  for (const n of NATIONS) if (g.ongoing.has(`peace:${n}`) && p.nat !== n) defense -= 0.05;
  for (const n of NATIONS) if (g.nations[n].invasion.stage >= 2) defense -= 0.15;
  f.anarchy = Math.max(0, Math.min(1, anarchy));
  f.defense = Math.max(0, Math.min(1, defense));
  return f;
}

function updatePirateMood(g: Game, p: Person, dt: number): void {
  const f = pirateFactors(g, p);
  let tot = 0, wsum = 0;
  for (const n of PIRATE_NEEDS) {
    const w = p.weights[n] ?? 1;
    tot += f[n] * w;
    wsum += w;
  }
  tot += f.anarchy * 1.2 + f.defense * 1.0;
  wsum += 2.2;
  let h = tot / wsum;
  if (p.kind === 'wealthy') {
    p.happiness = h;
    return;
  }
  if (g.time < g.effects.festivalUntil) h += 0.08;
  p.happiness += (h - p.happiness) * Math.min(1, dt / 20);
  // mood transitions
  if (p.mood === 'ok' && p.happiness < 0.22) {
    p.mood = 'disgruntled';
    p.thoughts.unshift('I have had it with this island!');
  } else if (p.mood === 'disgruntled' && p.happiness > 0.32) p.mood = 'ok';
  if (p.mood === 'disgruntled' && p.happiness < 0.14 && g.rng.chance(dt / (MONTH * 1.5)) && !p.captain) {
    p.mood = 'enraged';
    p.thoughts.unshift('Someone is going to pay for this!');
    p.task = { kind: 'idle' };
  }
  // rank up
  const r = rankFor(p.earned);
  if (r > p.rank) {
    p.rank = r;
    g.events.push({ type: 'rankup', id: p.id });
  }
}

function updateResignation(g: Game, p: Person, dt: number): void {
  const delayOver = g.time - p.arrived >= g.auraDelay();
  const fear = delayOver ? Math.min(1, p.env.fear) : 0.5;
  const order = delayOver ? Math.max(0, Math.min(1, 0.4 + p.env.order)) : 0.5;
  const awe = delayOver ? Math.min(1, 0.15 + p.env.awe) : 0.4;
  const parts = [p.opinion.food ?? 0.5, p.opinion.rest ?? 0.5, fear, order, awe];
  if (g.time - p.arrived > YEAR * 2 && g.buildingCount('church')) parts.push(p.opinion.prayer ?? 0.5);
  let r = parts.reduce((a, b) => a + b, 0) / parts.length;
  if (g.ongoing.has('executions')) r -= 0.03;
  if (g.time < g.effects.festivalUntil) r -= 0.04;
  p.resignation += (r - p.resignation) * Math.min(1, dt / 30);
  p.escapeCooldown -= dt;
  // escape attempt
  if (p.escapeCooldown <= 0 && p.task.kind !== 'escape' && !p.rebel) {
    p.escapeCooldown = 20 + g.rng.range(0, 30);
    const risk = Math.max(0, 0.42 - p.resignation) * (p.traits.courage / 9) * (1 + g.effects.recentEscapes * 0.3) / (1 + g.effects.recentKills * 0.4);
    const stab = [0.3, 0.6, 1, 1.4, 1.8][g.settings.stability - 1] ?? 1;
    if (g.rng.chance(risk * 0.5 * stab)) startEscape(g, p);
  }
}

function startEscape(g: Game, p: Person): void {
  // nearest beach tile
  const m = g.map, n = m.size;
  const [sx, sy] = tileOf(p);
  let best: [number, number] | null = null, bd = Infinity;
  for (let r = 4; r < 60 && !best; r += 4)
    for (let j = -r; j <= r; j += 2)
      for (let i = -r; i <= r; i += 2) {
        const x = sx + i, y = sy + j;
        if (!m.inBounds(x, y) || m.terrain[m.idx(x, y)] !== Terrain.Beach) continue;
        if (g.pf.blocked[y * n + x]) continue;
        const d = Math.hypot(i, j);
        if (d < bd) (bd = d), (best = [x, y]);
      }
  if (!best) return;
  releaseAll(g, p);
  if (!goTo(g, p, best[0], best[1], { kind: 'escape' })) return;
  p.thoughts.unshift("I'm going to make it!");
  g.events.push({ type: 'escape', id: p.id });
  g.msg('alert', 'Escape!', `${p.name} is making a run for the beach!`, 'escape', { x: p.x, y: p.y });
  // rebellion check
  let followers = 0;
  for (const q of g.people.values()) {
    if (q.kind !== 'captive' || q === p || q.rebel || q.task.kind === 'dead') continue;
    if (Math.hypot(q.x - p.x, q.y - p.y) > 10) continue;
    if (q.resignation < 0.3 && q.traits.courage + g.rng.range(0, 4) > 10 - p.traits.leadership * 0.5) followers++;
  }
  if (followers >= 3 && p.traits.leadership >= 6) startRebellion(g, p);
  // guards and overseers give chase
  for (const q of g.people.values()) {
    if (q.kind !== 'pirate' || q.task.kind === 'atsea' || q.task.kind === 'dead') continue;
    const near = Math.hypot(q.x - p.x, q.y - p.y);
    if ((q.shoreRole && near < 40) || near < 6) {
      q.task = { kind: 'chase', target: p.id, timer: 40, phase: 1 };
    }
  }
}

function startRebellion(g: Game, leader: Person): void {
  if (g.unrest.rebellion) return;
  g.unrest.rebellion = true;
  const rebels: Person[] = [];
  for (const q of g.people.values()) {
    if (q.kind !== 'captive' || q.task.kind === 'dead') continue;
    if (Math.hypot(q.x - leader.x, q.y - leader.y) > 14) continue;
    if (q === leader || q.resignation < 0.35) rebels.push(q);
  }
  const palace = g.findBuilding('palace');
  if (!palace) return;
  for (const q of rebels) {
    releaseAll(g, q);
    q.rebel = true;
    goTo(g, q, palace.door[0], palace.door[1], { kind: 'rebel' });
  }
  g.events.push({ type: 'rebellion' });
  g.msg('alert', 'Rebellion!', `${leader.name} has roused ${rebels.length} captives to revolt! They are marching on the palace. If they outnumber your guards, it's all over!`, 'rebellion', { x: leader.x, y: leader.y }, true);
  // all pirates ashore take up arms
  for (const q of g.people.values()) if (q.kind === 'pirate' && q.task.kind !== 'atsea' && q.task.kind !== 'dead') q.task = { kind: 'fight', phase: 1, timer: 60 };
}

// -------------------------------------------------------------------------------------------------- decisions

function think(g: Game, p: Person): void {
  switch (p.kind) {
    case 'captive':
    case 'skeleton':
      return thinkCaptive(g, p);
    case 'pirate':
      return thinkPirate(g, p);
    case 'wealthy':
      return thinkWealthy(g, p);
    case 'soldier':
      return thinkSoldier(g, p);
  }
}

function setIdle(p: Person, secs: number, kind: Task['kind'] = 'idle'): void {
  p.task = { kind, timer: secs, phase: 1 };
}

function nearestBuilding(g: Game, p: Person, pred: (b: Building) => boolean): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.built < 1 || !pred(b)) continue;
    const d = Math.abs(b.door[0] - p.x) + Math.abs(b.door[1] - p.y);
    if (d < bd) (bd = d), (best = b);
  }
  return best;
}

function thinkCaptive(g: Game, p: Person): void {
  if (p.rebel) {
    const palace = g.findBuilding('palace');
    if (palace && !goTo(g, p, palace.door[0], palace.door[1], { kind: 'rebel' })) setIdle(p, 2, 'rebel');
    return;
  }
  const skeleton = p.kind === 'skeleton';
  if (!skeleton) {
    if (p.needs.food < 0.35) {
      const b = nearestBuilding(g, p, (b) => b.def === 'chuck_tent' && (b.inv.slop ?? 0) > 0 && b.customers.length < 7);
      if (b) {
        b.customers.push(p.id);
        if (goTo(g, p, b.door[0], b.door[1], { kind: 'eat', bld: b.id })) return;
        b.customers = b.customers.filter((c) => c !== p.id);
      }
    }
    if (p.needs.rest < 0.3) {
      const b = nearestBuilding(g, p, (b) => (b.def === 'bunkhouse' && b.customers.length < 5)) ?? nearestBuilding(g, p, (b) => b.def === 'stockade' && b.customers.length < 15);
      if (b) {
        b.customers.push(p.id);
        if (goTo(g, p, b.door[0], b.door[1], { kind: 'sleep', bld: b.id })) return;
        b.customers = b.customers.filter((c) => c !== p.id);
      }
      p.task = { kind: 'sleep', timer: 25, phase: 1 }; // sleep in the dirt
      return;
    }
    if (p.needs.prayer < 0.3) {
      const ok = (b: Building) => b.def === 'church' && b.customers.length < 9 && b.workers.length > 0 && churchAllowed(g, p);
      const b = nearestBuilding(g, p, ok);
      if (b) {
        b.customers.push(p.id);
        if (goTo(g, p, b.door[0], b.door[1], { kind: 'pray', bld: b.id })) return;
        b.customers = b.customers.filter((c) => c !== p.id);
      }
    }
  }
  if (p.job) {
    const b = g.buildings.get(p.job);
    if (b) {
      const t = p.jobRole === 'hauler' ? haulerTask(g, b, p) : p.jobRole === 'builder' ? builderTask(g, b, p) : workerTask(g, b, p);
      if (t) {
        if (t.tx !== undefined && t.ty !== undefined) {
          if (goTo(g, p, t.tx, t.ty, t)) return;
        } else {
          p.task = { ...t, phase: 1 };
          return;
        }
      }
    }
  }
  // unemployed: loiter at the stockade
  const st = g.findBuilding('stockade');
  if (st && Math.hypot(st.door[0] - p.x, st.door[1] - p.y) > 4) {
    if (goTo(g, p, st.door[0], st.door[1], { kind: 'wander' })) return;
  }
  setIdle(p, 6 + g.rng.range(0, 6));
}

function churchAllowed(g: Game, p: Person): boolean {
  if (g.king.flaw === 'catholic') return p.nat !== 'eng';
  if (g.king.flaw === 'protestant') return p.nat === 'eng';
  return true;
}

export function serviceFee(b: Building): number {
  const def = BUILDING[b.def];
  if (!def.service) return 0;
  const [lo, hi] = def.service.fee;
  return Math.round(lo + ((hi - lo) * b.price) / 2);
}

/** effective rank band of an entertainment building given its quality setting */
export function serviceBand(b: Building): [number, number] {
  const def = BUILDING[b.def];
  const [lo, hi] = def.service!.ranks;
  // quality 0 = whole band; 1..4 slide a 3-rank window through the band
  if (!b.quality) return [lo, hi];
  const start = Math.min(hi - 2, lo + b.quality - 1);
  return [start, start + 2];
}

function thinkPirate(g: Game, p: Person): void {
  // enraged: attack someone nearby
  if (p.mood === 'enraged') {
    let victim: Person | null = null, vd = Infinity;
    for (const q of g.people.values()) {
      if (q === p || q.task.kind === 'dead' || q.task.kind === 'atsea' || q.kind === 'soldier') continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < vd && d < 25) (vd = d), (victim = q);
    }
    if (victim) {
      p.task = { kind: 'fight', target: victim.id, timer: 30, phase: 1 };
      return;
    }
    p.mood = 'disgruntled';
  }
  // ship bell (disgruntled pirates refuse to sail)
  if (p.ship && p.mood !== 'disgruntled') {
    const s = g.ships.get(p.ship);
    if (s && s.status === 'boarding' && s.dock) {
      const d = g.buildings.get(s.dock);
      if (d && goTo(g, p, d.door[0], d.door[1], { kind: 'board', bld: d.id })) return;
    }
  }
  const disgruntled = p.mood === 'disgruntled';
  // shore job
  if (p.shoreJob && !disgruntled) {
    const b = g.buildings.get(p.shoreJob);
    if (b && b.built >= 1 && g.rng.chance(0.6)) {
      const urgent = PIRATE_NEEDS.some((n) => p.needs[n] < 0.2);
      if (!urgent) {
        const [tx, ty] = p.shoreRole === 'guard' ? guardSpot(g, b) : b.door;
        if (goTo(g, p, tx, ty, { kind: p.shoreRole === 'guard' ? 'guard' : 'work', bld: b.id })) return;
      }
    }
  }
  if (seekNeed(g, p)) return;
  // nothing pressing: wander the streets near entertainment or home
  wander(g, p, 10);
}

function guardSpot(g: Game, b: Building): [number, number] {
  const w = g.pf.nearestWalkable(b.door[0] + g.rng.int(-2, 2), b.door[1] + g.rng.int(-2, 2), 4);
  return w ?? b.door;
}

function wander(g: Game, p: Person, r: number): void {
  const [x, y] = tileOf(p);
  for (let tries = 0; tries < 4; tries++) {
    const tx = x + g.rng.int(-r, r), ty = y + g.rng.int(-r, r);
    if (!g.map.inBounds(tx, ty) || !g.map.path[g.map.idx(tx, ty)]) continue;
    if (goTo(g, p, tx, ty, { kind: 'wander' })) return;
  }
  setIdle(p, 5 + g.rng.range(0, 8), 'party');
}

/** pirates (and wealthy captives) pick their most pressing need and a venue */
function seekNeed(g: Game, p: Person): boolean {
  const order = [...PIRATE_NEEDS].filter((n) => p.kind !== 'wealthy' || n !== 'stash')
    .map((n) => [n, (1 - p.needs[n]) * (p.weights[n] ?? 1)] as const)
    .sort((a, b) => b[1] - a[1]);
  for (const [need, urg] of order) {
    if (urg < 0.3) break;
    if (need === 'rest' || need === 'stash') {
      if (p.kind === 'wealthy') {
        const hotel = nearestBuilding(g, p, (b) => b.def === 'hotel' && b.customers.length < 8);
        if (hotel && goTo(g, p, hotel.door[0], hotel.door[1], { kind: 'sleep', bld: hotel.id, need })) {
          hotel.customers.push(p.id);
          return true;
        }
        continue;
      }
      const home = p.home ? g.buildings.get(p.home) : undefined;
      if (home && home.built >= 1) {
        if (need === 'stash' && p.gold < 5) continue;
        if (goTo(g, p, home.door[0], home.door[1], { kind: need === 'rest' ? 'sleep' : 'stash', bld: home.id, need })) return true;
      }
      if (need === 'rest') {
        // berth aboard a docked ship, else sleep rough
        const s = p.ship ? g.ships.get(p.ship) : undefined;
        const d = s?.dock ? g.buildings.get(s.dock) : undefined;
        if (d && goTo(g, p, d.door[0], d.door[1], { kind: 'sleep', bld: d.id, need })) return true;
        p.task = { kind: 'sleep', timer: 20, phase: 1, need };
        return true;
      }
      continue;
    }
    const venue = pickVenue(g, p, need);
    if (venue) {
      venue.customers.push(p.id);
      if (goTo(g, p, venue.door[0], venue.door[1], { kind: 'visit', bld: venue.id, need })) return true;
      venue.customers = venue.customers.filter((c) => c !== p.id);
    }
  }
  return false;
}

function pickVenue(g: Game, p: Person, need: PirateNeed): Building | null {
  let best: Building | null = null, bs = -Infinity;
  for (const b of g.buildings.values()) {
    if (b.built < 1) continue;
    const def = BUILDING[b.def];
    const sv = def.service;
    if (!sv || !sv.needs[need]) continue;
    if (b.customers.length >= sv.capacity) continue;
    if (!b.workers.length) continue;
    const fee = serviceFee(b);
    if (p.kind === 'pirate' && p.gold < fee) continue;
    const [lo, hi] = serviceBand(b);
    const off = p.rank < lo ? lo - p.rank : p.rank > hi ? p.rank - hi : 0;
    if (off > 3) continue;
    const [a, c] = sv.needs[need]!;
    const exp = (a + c) / 2 * (1 - 0.1 * off);
    const d = Math.abs(b.door[0] - p.x) + Math.abs(b.door[1] - p.y);
    const haunt = p.haunts[need] === b.id ? 0.15 : 0;
    const score = exp + haunt - d * 0.006 - fee * 0.004 * (p.kind === 'pirate' ? 1 : 0);
    if (score > bs) (bs = score), (best = b);
  }
  return best;
}

function thinkWealthy(g: Game, p: Person): void {
  if (seekNeed(g, p)) return;
  wander(g, p, 8);
}

function thinkSoldier(g: Game, p: Person): void {
  // march on the palace, attacking pirates along the way
  const foe = nearestFoe(g, p, 8);
  if (foe) {
    p.task = { kind: 'fight', target: foe.id, timer: 30, phase: 1 };
    return;
  }
  const palace = g.findBuilding('palace');
  if (palace && goTo(g, p, palace.door[0], palace.door[1], { kind: 'rebel' })) return;
  setIdle(p, 2);
}

function nearestFoe(g: Game, p: Person, r: number): Person | null {
  let best: Person | null = null, bd = r;
  const enemyOfSoldier = (q: Person) => q.kind === 'pirate';
  const enemyOfPirate = (q: Person) => q.kind === 'soldier' || q.rebel === true;
  const isFoe = p.kind === 'soldier' || p.rebel ? enemyOfSoldier : enemyOfPirate;
  for (const q of g.people.values()) {
    if (q.task.kind === 'dead' || q.task.kind === 'atsea' || !isFoe(q)) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) (bd = d), (best = q);
  }
  return best;
}

// -------------------------------------------------------------------------------------------------- arrival / action / finish

function arrive(g: Game, p: Person): void {
  const t = p.task;
  const b = t.bld ? g.buildings.get(t.bld) : undefined;
  switch (t.kind) {
    case 'eat':
      t.timer = 8;
      break;
    case 'sleep':
      t.timer = 22;
      break;
    case 'pray':
      t.timer = 14;
      break;
    case 'visit': {
      const def = b ? BUILDING[b.def] : undefined;
      t.timer = def?.service?.duration ?? 12;
      break;
    }
    case 'stash':
      t.timer = 5;
      break;
    case 'work':
    case 'guard':
      t.timer = t.timer ?? 40;
      break;
    case 'haul':
    case 'build':
      t.timer = t.timer ?? 6;
      break;
    case 'board': {
      const s = p.ship ? g.ships.get(p.ship) : undefined;
      if (s && (s.status === 'boarding' || s.status === 'docked')) {
        p.task = { kind: 'atsea', phase: 1 };
        p.x = s.vx;
        p.y = s.vy;
        g.events.push({ type: 'boarded', id: p.id, ship: s.id });
        return;
      }
      t.timer = 0;
      break;
    }
    case 'escape': {
      // reached the beach: gone!
      g.stats.escapes++;
      g.effects.recentEscapes++;
      g.msg('bad', 'Escaped!', `${p.name} slipped away on a drifting log. They may tell their countrymen where you are...`, 'escaped', { x: p.x, y: p.y });
      const leak = g.ongoing.has('loose_lips') ? 0.12 : 0.4;
      if (!g.nations[p.nat].knows && g.rng.chance(leak)) {
        g.nations[p.nat].knows = true;
        g.msg('alert', 'Discovered!', `${p.nat === 'eng' ? 'England' : p.nat === 'fra' ? 'France' : 'Spain'} now knows the location of your island.`, 'discovered');
      }
      releaseAll(g, p);
      g.people.delete(p.id);
      g.events.push({ type: 'despawn', id: p.id });
      return;
    }
    case 'rebel': {
      if (p.kind === 'soldier' || p.rebel) {
        // reached palace door
        const palace = g.findBuilding('palace');
        const guards = palace ? palace.guards.filter((id) => {
          const q = g.people.get(id);
          return q && q.task.kind !== 'dead' && Math.hypot(q.x - p.x, q.y - p.y) < 12;
        }).length : 0;
        const attackers = [...g.people.values()].filter((q) => (q.kind === 'soldier' || q.rebel) && q.task.kind !== 'dead' && palace && Math.hypot(q.x - palace.door[0], q.y - palace.door[1]) < 4).length;
        if (attackers >= 5 && attackers > guards * 2 + 1) {
          g.endGame(false, p.kind === 'soldier' ? 'Enemy soldiers have stormed your palace. You will hang in Port Royal.' : 'The captives have stormed the palace. You are now their prisoner!');
          return;
        }
      }
      t.timer = 2;
      break;
    }
    case 'wander':
      t.timer = 2 + g.rng.range(0, 6);
      break;
    default:
      t.timer = t.timer ?? 3;
  }
}

function act(g: Game, p: Person, dt: number): void {
  const t = p.task;
  if (t.kind === 'chase' || t.kind === 'fight') {
    let target = t.target ? g.people.get(t.target) : undefined;
    if ((!target || target.task.kind === 'dead') && t.kind === 'fight') {
      target = nearestFoe(g, p, p.kind === 'pirate' ? 80 : 15) ?? undefined;
      if (target) t.target = target.id;
    }
    if (!target || target.task.kind === 'dead' || target.task.kind === 'atsea') {
      t.timer = 0;
      return;
    }
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
    p.dir = Math.atan2(dy, dx);
    if (d > 0.9) {
      const sp = (t.kind === 'chase' ? 2.2 : 1.6) * dt;
      const nx = p.x + (dx / d) * sp, ny = p.y + (dy / d) * sp;
      if (g.map.isWalkable(Math.floor(nx), Math.floor(ny))) (p.x = nx), (p.y = ny);
      else (p.x += (dx / d) * sp * 0.5), (p.y += (dy / d) * sp * 0.5);
      return;
    }
    // in melee range
    t.phase = 2;
    if (g.rng.chance(dt / 1.2)) {
      const atk = (p.kind === 'pirate' ? 0.4 + p.skills.swordsmanship * 0.08 : p.kind === 'soldier' ? 0.55 : 0.25);
      const def = target.kind === 'pirate' ? target.skills.swordsmanship * 0.04 : 0;
      if (target.captain && t.kind === 'fight' && p.kind === 'pirate') {
        // captains always win brawls
        killPerson(g, p, 'brawl');
        return;
      }
      if (g.rng.chance(atk - def)) {
        target.hp -= target.kind === 'captive' ? 1 : 0.4;
        g.events.push({ type: 'hit', id: target.id, by: p.id });
        if (target.hp <= 0) {
          killPerson(g, target, t.kind === 'chase' ? 'caught' : 'fight');
          if (t.kind === 'chase') {
            g.effects.recentKills++;
            g.stats.escapeKills++;
          }
          if (p.mood === 'enraged') {
            p.mood = 'ok';
            p.happiness = Math.max(p.happiness, 0.45);
            g.msg('bad', 'Murder!', `${p.name} flew into a rage and killed ${target.name}.`, 'murder', { x: p.x, y: p.y });
          }
          t.timer = 0;
        }
      }
    }
  }
}

function finish(g: Game, p: Person): void {
  const t = p.task;
  if (t.kind === 'haul') {
    if (haulStep(g, p)) return;
    p.task = { kind: 'idle' };
    return;
  }
  const b = t.bld ? g.buildings.get(t.bld) : undefined;
  if (b) b.customers = b.customers.filter((c) => c !== p.id);
  switch (t.kind) {
    case 'eat':
      if (b && (b.inv.slop ?? 0) > 0) {
        b.inv.slop!--;
        p.needs.food = Math.min(1, p.needs.food + 0.82 * (0.6 + 0.4 * b.staff));
      }
      break;
    case 'sleep': {
      let amt = 0.35; // on the ground
      if (b?.def === 'bunkhouse') amt = 0.86;
      else if (b?.def === 'stockade') amt = 0.59;
      else if (b?.def === 'dock') amt = 0.45;
      else if (b?.def === 'hotel') amt = 0.98;
      else if (b && BUILDING[b.def].house) amt = HOUSE_LEVELS[(b.houseLevel ?? 1) - 1].rest || 0.3;
      p.needs.rest = Math.min(1, p.needs.rest + amt);
      if (b?.def === 'hotel' && p.kind === 'wealthy') p.credit += 10;
      break;
    }
    case 'pray':
      p.needs.prayer = Math.min(1, p.needs.prayer + 0.59 * (g.has('religious') ? 1.3 : 1));
      break;
    case 'stash': {
      if (!b) break;
      const lvl = HOUSE_LEVELS[(b.houseLevel ?? 1) - 1];
      const fee = Math.min(p.gold, lvl.fee);
      if (fee) {
        p.gold -= fee;
        g.earn(fee, 'housing');
        b.income += fee;
      }
      const pct = 0.2 + 0.4 * ((p.weights.stash ?? 1) - 0.6);
      const amount = Math.floor(p.gold * pct);
      p.gold -= amount;
      p.stashed += amount;
      p.lastStash = g.time;
      p.needs.stash = Math.min(1, p.needs.stash + lvl.stash * (amount > 0 ? 1 : 0.3) + Math.min(0.3, amount / 200));
      break;
    }
    case 'visit':
      if (b) visitVenue(g, p, b, t.need as PirateNeed);
      break;
    case 'escape':
      break;
    case 'chase':
    case 'fight':
      if (p.mood === 'enraged') p.mood = 'disgruntled';
      break;
  }
  p.task = { kind: 'idle' };
}

function visitVenue(g: Game, p: Person, b: Building, need: PirateNeed): void {
  const def = BUILDING[b.def];
  const sv = def.service!;
  const fee = serviceFee(b);
  if (p.kind === 'pirate') {
    if (p.gold < fee) return;
    p.gold -= fee;
    g.earn(fee, 'entertainment');
  } else if (p.kind === 'wealthy') p.credit += fee * 1.5;
  b.income += fee;
  // staff skill and bonus goods
  let bonus = 0;
  for (const good of sv.bonus) {
    if ((b.inv[good] ?? 0) > 0) {
      b.inv[good]!--;
      bonus = 1;
      break;
    }
  }
  const staffSkill = Math.min(1, b.staff);
  const q = 0.45 * staffSkill + 0.55 * bonus;
  const [lo, hi] = serviceBand(b);
  const off = p.rank < lo ? lo - p.rank : p.rank > hi ? p.rank - hi : 0;
  const rig = def.id === 'gambling_den' || def.id === 'casino' ? (g.ongoing.has('rig_against') ? -0.15 : g.ongoing.has('rig_favour') ? 0.15 : 0) : 0;
  for (const n in sv.needs) {
    const [a, c] = sv.needs[n as PirateNeed]!;
    const amt = (a + (c - a) * q) * Math.max(0.2, 1 - 0.1 * off) + (n === 'gamble' ? rig : 0);
    p.needs[n] = Math.min(1, p.needs[n] + amt);
  }
  if (!p.haunts[need] || g.rng.chance(0.3)) p.haunts[need] = b.id;
}

// -------------------------------------------------------------------------------------------------- monthly housekeeping

/** assign homeless pirates to free housing plots and handle upgrades */
export function housingPass(g: Game): void {
  const homeless = g.pirates().filter((p) => !p.home).sort((a, b) => b.rank - a.rank);
  const free = [...g.buildings.values()].filter((b) => BUILDING[b.def].house && b.built >= 1 && !b.owner);
  for (const p of homeless) {
    const h = free.shift();
    if (!h) break;
    h.owner = p.id;
    p.home = h.id;
    h.houseLevel = 1;
  }
  for (const b of g.buildings.values()) {
    if (!BUILDING[b.def].house || !b.owner) continue;
    const p = g.people.get(b.owner);
    if (!p) {
      b.owner = 0;
      continue;
    }
    const lvl = b.houseLevel ?? 1;
    if (p.rank > lvl) {
      const next = HOUSE_LEVELS[Math.min(p.rank, 9) - 1];
      if (p.gold >= next.cost) {
        p.gold -= next.cost;
        g.earn(next.cost, 'housing');
        b.houseLevel = next.rank;
        g.aura.dirty = true;
        g.events.push({ type: 'houseUp', id: b.id });
      }
    }
  }
}

/** a captured sailor escapes or is exchanged and turns up at the docks */
function returnFromCaptivity(g: Game, p: Person): void {
  const at = g.findBuilding('dock') ?? g.findBuilding('palace');
  if (!at) return;
  p.task = { kind: 'idle' };
  p.x = at.door[0] + 0.5;
  p.y = at.door[1] + 0.5;
  p.needs.rest = Math.min(p.needs.rest, 0.2);
  p.needs.feast = Math.min(p.needs.feast, 0.2);
  g.events.push({ type: 'disembark', id: p.id });
  if (p.captain) g.msg('good', 'Captain Returns', `${p.name} has escaped captivity and is back on the island, looking for a new ship.`, undefined, { x: p.x, y: p.y });
}
