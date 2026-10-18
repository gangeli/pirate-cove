import type { Game, CmdResult } from './game';
import { MONTH } from './time';
import type { Region, Ship, Person, Building } from './types';
import type { Rng } from './rng';
import { SHIPS, PREY, SPOILS_TREASURY, type ShipType, type PreyDef } from './data/ships';
import { NATIONS, NATION_NAMES, NATION_ADJ, type Nation } from './data/kings';
import { JOB_NAMES, type Job } from './data/buildings';
import { createPerson, createShip, dockBerth, createCaptain, killPerson, releaseAll } from './people';
import { consumeLumber } from './economy';
import { Terrain } from './map';
import { breakPeace, piracyAgainst } from './diplomacy';

// --------------------------------------------------------------------------------------------- regions

const REGION_DEFS: [string, number, number][] = [
  ['Gulf of Mexico', 0.1, 0.28], ['Bay of Campeche', 0.12, 0.47], ['Yucatán Channel', 0.27, 0.36], ['Florida Straits', 0.36, 0.14],
  ['The Bahamas', 0.52, 0.12], ['Cayman Deep', 0.36, 0.36], ['Windward Passage', 0.54, 0.3], ['Tortuga Waters', 0.6, 0.22],
  ['Jamaica Channel', 0.46, 0.45], ['Mona Passage', 0.7, 0.34], ['Virgin Islands', 0.8, 0.3], ['Leeward Islands', 0.9, 0.38],
  ['Windward Islands', 0.92, 0.58], ['Spanish Main', 0.76, 0.66], ['Curaçao Banks', 0.62, 0.6], ['Cartagena Roads', 0.48, 0.72],
  ['Darién Gap', 0.34, 0.8], ['Mosquito Coast', 0.24, 0.58],
];
const SETTLEMENT_NAMES = ['Port Esperanza', 'San Lázaro', 'Fort Royal', 'Saint-Pierre', 'Bridgetown', 'Puerto Bello', 'Santa Clara', 'Kingston Bay', 'Port Dauphin', 'Villa Rica', 'Hope Town', 'Fort Charles', 'Saint-Malo Creek', 'Nombre de Dios', 'Marigot', 'Basse-Terre', 'Spanish Wells', 'Port Morant', 'Gonaïves', 'Cumaná'];

export function makeRegions(r: Rng, home: number): Region[] {
  const regs: Region[] = REGION_DEFS.map(([name, x, y], id) => ({
    id, name, x, y, neighbors: [],
    merchant: { eng: r.range(0, 1), fra: r.range(0, 1), spa: r.range(0, 1) },
    naval: { eng: r.range(0, 0.7), fra: r.range(0, 0.7), spa: r.range(0, 0.7) },
    pirates: r.range(0, 0.4), settlements: [], tradeRoute: r.chance(0.4), routeFound: false, knowledge: 0, heat: 0,
  }));
  // Spain dominates the south and west, England the north-east, France the east
  for (const g of regs) {
    g.merchant.spa *= 0.6 + (1 - g.x) * 0.4 + g.y * 0.6;
    g.merchant.eng *= 0.6 + g.x * 0.6 * (1 - g.y);
    g.merchant.fra *= 0.5 + g.x * 0.6;
    if (g.tradeRoute) for (const n of NATIONS) g.merchant[n] = Math.min(1.3, g.merchant[n] * 1.4);
  }
  for (const a of regs)
    for (const b of regs) if (a !== b && Math.hypot(a.x - b.x, (a.y - b.y) * 1.3) < 0.2) a.neighbors.push(b.id);
  for (const a of regs) if (!a.neighbors.length) {
    const nearest = regs.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
    a.neighbors.push(nearest.id);
    nearest.neighbors.push(a.id);
  }
  let si = 0;
  for (const g of regs) {
    const n = r.int(0, 2);
    for (let i = 0; i < n; i++) {
      const type = r.pick(['farmstead', 'farmstead', 'trade', 'military'] as const);
      const nat = r.pick(NATIONS);
      g.settlements.push({ type, nat, name: SETTLEMENT_NAMES[si++ % SETTLEMENT_NAMES.length], found: false, raided: 0 });
      if (type === 'trade') g.merchant[nat] = Math.min(1.4, g.merchant[nat] + 0.25);
      if (type === 'military') g.naval[nat] = Math.min(1.2, g.naval[nat] + 0.3);
    }
  }
  // home waters are a pirate haven: little naval presence close by
  for (const id of [home, ...regs[home].neighbors]) {
    for (const n of NATIONS) regs[id].naval[n] *= id === home ? 0.3 : 0.6;
    regs[id].pirates *= id === home ? 0.2 : 0.5;
  }
  regs[home].knowledge = 3;
  for (const nb of regs[home].neighbors) regs[nb].knowledge = Math.max(regs[nb].knowledge, 1);
  return regs;
}

export function regionDistance(g: Game, a: number, b: number): number {
  const ra = g.regions[a], rb = g.regions[b];
  return Math.hypot(ra.x - rb.x, (ra.y - rb.y) * 1.3);
}

/** transit time in seconds from home to region */
export function transitTime(g: Game, s: Ship, region: number): number {
  const d = regionDistance(g, g.homeRegion, region);
  const sp = SHIPS[s.type].speed * (g.has('craftiness') ? 1.05 : 1);
  return MONTH * (0.25 + d * 3.2 * (28 / sp));
}
export function rationRate(s: Ship): number {
  return ((s.crew.length + 1) * 0.3) / MONTH;
}
/** can a ship reach a region (cleared/adjacent rule + rations) */
export function regionReachable(g: Game, s: Ship, region: number): { ok: boolean; reason?: string } {
  const r = g.regions[region];
  const known = r.knowledge > 0 || r.neighbors.some((n) => g.regions[n].knowledge > 1) || region === g.homeRegion;
  if (!known) return { ok: false, reason: 'Uncharted waters. Explore neighbouring seas first.' };
  const need = transitTime(g, s, region) * 2 * rationRate(s);
  const cap = SHIPS[s.type].rations;
  if (need > cap) return { ok: false, reason: `Too far: the round trip needs ${Math.ceil(need)} rations, but a ${SHIPS[s.type].name} carries at most ${cap}.` };
  return { ok: true };
}

// --------------------------------------------------------------------------------------------- crews

export function assignCrews(g: Game): void {
  const ships = [...g.ships.values()].filter((s) => s.captain && (s.status === 'docked' || s.status === 'repairing'))
    .sort((a, b) => (g.people.get(b.captain)?.traits.notoriety ?? 0) - (g.people.get(a.captain)?.traits.notoriety ?? 0));
  const pool = g.pirates().filter((p) => !p.ship && !p.captain && p.task.kind !== 'atsea' && p.mood === 'ok');
  // prefer pirates without shore jobs, but ships come first
  pool.sort((a, b) => (a.shoreJob ? 1 : 0) - (b.shoreJob ? 1 : 0));
  for (const s of ships) {
    const d = SHIPS[s.type];
    while (s.crew.length < d.men + d.officers && pool.length) {
      const p = pool.shift()!;
      if (p.shoreJob) {
        const b = g.buildings.get(p.shoreJob);
        if (b) {
          b.guards = b.guards.filter((x) => x !== p.id);
          if (b.overseer === p.id) b.overseer = 0;
        }
        p.shoreJob = 0;
        p.shoreRole = undefined;
      }
      p.ship = s.id;
      s.crew.push(p.id);
    }
    // officers: the best leaders aboard
    const crew = s.crew.map((id) => g.people.get(id)!).filter(Boolean).sort((a, b) => b.traits.leadership - a.traits.leadership);
    s.officers = crew.slice(0, d.officers).map((p) => p.id);
    for (const p of crew) p.officer = s.officers.includes(p.id);
  }
  // captains without ships get one
  for (const cap of g.pirates().filter((p) => p.captain && !p.ship)) {
    const s = [...g.ships.values()].find((x) => !x.captain && x.status !== 'atsea' && x.status !== 'lost');
    if (!s) break;
    s.captain = cap.id;
    cap.ship = s.id;
  }
}

// --------------------------------------------------------------------------------------------- shipbuilding

export function commissionShip(g: Game, yardId: number, type: ShipType): CmdResult {
  const yard = g.buildings.get(yardId);
  if (!yard || (yard.def !== 'boatyard' && yard.def !== 'shipyard') || yard.built < 1) return { ok: false, reason: 'Need a finished boatyard or shipyard.' };
  const d = SHIPS[type];
  if (d.yard === 'shipyard' && yard.def !== 'shipyard') return { ok: false, reason: `A ${d.name} can only be built at a Shipyard.` };
  if (yard.building_ship) return { ok: false, reason: 'The yard is already building a ship.' };
  const docks = [...g.buildings.values()].filter((b) => b.def === 'dock' && b.built >= 1);
  const freeDocks = docks.filter((b) => !b.ship).length;
  const queued = [...g.buildings.values()].filter((b) => b.building_ship).length;
  if (freeDocks - queued <= 0) return { ok: false, reason: 'Every ship needs its own dock. Build another dock first.' };
  if (d.gold > 0 && g.treasury < d.gold) return { ok: false, reason: 'Not enough gold.' };
  if (g.lumber() < d.lumber) return { ok: false, reason: 'Not enough lumber.' };
  g.spend(d.gold, 'shipbuilding');
  consumeLumber(g, d.lumber);
  yard.building_ship = { type, progress: 0 };
  g.events.push({ type: 'yard', id: yard.id });
  return { ok: true };
}

function updateYards(g: Game, dt: number): void {
  for (const y of g.buildings.values()) {
    if (!y.building_ship || y.built < 1) continue;
    let e = 0;
    for (const id of y.workers) {
      const p = g.people.get(id);
      if (p && p.task.kind === 'work' && p.task.bld === y.id && p.task.phase === 1) e += 0.6 + (p.jobSkill.shipwright ?? 0) * 0.08;
    }
    if (!e) continue;
    y.building_ship.progress += (dt * e) / SHIPS[y.building_ship.type].work;
    if (y.building_ship.progress >= 1) {
      const dock = [...g.buildings.values()].filter((b) => b.def === 'dock' && b.built >= 1 && !b.ship)
        .sort((a, b) => Math.hypot(a.x - y.x, a.y - y.y) - Math.hypot(b.x - y.x, b.y - y.y))[0];
      if (!dock) continue; // wait for a free dock
      const s = createShip(g, y.building_ship.type, dock);
      s.rations = 0;
      s.cutlasses = 0;
      s.cannons = 0;
      y.building_ship = undefined;
      g.msg('ship', 'Ship Launched!', `The ${SHIPS[s.type].name} ${s.name} slides down the slipway and ties up at the dock. She needs a captain!`, 'ship_launched', { x: dock.x, y: dock.y });
      assignCrews(g);
    }
  }
}

// --------------------------------------------------------------------------------------------- launching

export function launchShip(g: Game, id: number, force: boolean): CmdResult {
  const s = g.ships.get(id);
  if (!s) return { ok: false, reason: 'No such ship.' };
  if (s.status !== 'docked' && s.status !== 'boarding') return { ok: false, reason: 'The ship is not ready to sail.' };
  if (!s.captain) return { ok: false, reason: 'A ship cannot sail without a captain. Issue the Recruit Captain edict.' };
  const d = SHIPS[s.type];
  const minCrew = Math.ceil(d.men / 2);
  if (s.crew.length < minCrew) return { ok: false, reason: `Not enough hands to man the rigging (need ${minCrew}).` };
  if (s.rations < 1) return { ok: false, reason: 'No sea rations aboard.' };
  {
    const out = s.mission === 'raid' || s.mission === 'kidnap' ? MONTH * 0.8 : transitTime(g, s, s.region);
    const need = out * 2 * rationRate(s) * 1.1;
    if (s.rations < need) return { ok: false, reason: `Not enough rations for the round trip (${Math.ceil(need)} needed, ${Math.floor(s.rations)} aboard).` };
  }
  if (s.mission === 'cruise') {

    if (s.orders === 'pound' && s.cannons < 1) return { ok: false, reason: 'Pounding needs cannons.' };
    if (s.orders === 'harass' && (s.cannons < 1 || s.muskets < 1)) return { ok: false, reason: 'Harassing needs cannons and muskets.' };
    const reach = regionReachable(g, s, s.region);
    if (!reach.ok) return reach;
  }
  if (s.mission === 'explore' || s.mission === 'foster_war') {
    const reach = regionReachable(g, s, s.region);
    if (!reach.ok) return reach;
  }
  if (s.mission === 'kidnap') {
    if (g.treasury < 250) return { ok: false, reason: 'Kidnapping a craftsman costs 250 gold.' };
    if (!s.kidnapJob) return { ok: false, reason: 'Choose which craftsman to kidnap.' };
  }
  if (s.status === 'docked') {
    s.status = 'boarding';
    s.bell = g.time;
    g.events.push({ type: 'bell', ship: s.id });
    if (!force) return { ok: true };
  }
  if (force) depart(g, s, true);
  return { ok: true };
}

function depart(g: Game, s: Ship, force: boolean): void {
  // anyone not aboard is fired from the crew
  const aboard = (id: number) => g.people.get(id)?.task.kind === 'atsea';
  const cap = g.people.get(s.captain);
  if (cap && !aboard(cap.id)) {
    if (force) {
      // the captain always makes it aboard
      cap.task = { kind: 'atsea', phase: 1 };
      g.events.push({ type: 'boarded', id: cap.id, ship: s.id });
    } else return;
  }
  for (const id of [...s.crew]) {
    if (!aboard(id)) {
      const p = g.people.get(id);
      if (p) p.ship = 0;
      s.crew = s.crew.filter((c) => c !== id);
    }
  }
  s.officers = s.officers.filter((o) => s.crew.includes(o));
  // too few hands turned up: the voyage is called off rather than sailing a ghost ship
  const minCrew = Math.ceil(SHIPS[s.type].men / 2);
  if (s.crew.length < minCrew) {
    s.status = 'docked';
    if (cap) cap.task = { kind: 'idle' };
    for (const id of s.crew) {
      const p = g.people.get(id);
      if (p) p.task = { kind: 'idle' };
    }
    g.msg('bad', 'Voyage Called Off', `Only ${s.crew.length} hands answered the ${s.name}'s bell. She needs at least ${minCrew} to sail.`, undefined, { x: s.vx, y: s.vy });
    assignCrews(g);
    return;
  }
  if (s.mission === 'kidnap') g.spend(250, 'kidnapping');
  const out = s.mission === 'raid' || s.mission === 'kidnap' ? MONTH * 0.8 : transitTime(g, s, s.region);
  s.voyage = {
    t: 0, out, station: 0, back: out, rationRate: rationRate(s), events: [],
    loot: { gold: 0, captives: 0, skilled: [], wealthy: 0, recruits: 0, cannons: 0 }, lost: false, sunk: false, nextEncounter: 0,
  };
  s.status = 'departing';
  s.log = [];
  s.voyagePath = seaPath(g, s.vx, s.vy);
  s.pathI = 0;
  g.events.push({ type: 'depart', ship: s.id });
  g.msg('ship', 'Anchors Aweigh', `The ${s.name} sets sail on a ${missionName(s)}.`, 'set_sail');
}

function missionName(s: Ship): string {
  return { cruise: 'cruise', raid: 'raid', kidnap: 'kidnapping mission', explore: 'voyage of exploration', foster_war: 'mission of mischief' }[s.mission];
}

declare module './types' {
  interface Ship {
    voyagePath?: [number, number][];
    pathI?: number;
    returnDock?: number;
  }
}

/** water path from a point to the map edge (for sailing out/in) */
export function seaPath(g: Game, x: number, y: number): [number, number][] {
  const m = g.map, n = m.size;
  const sx = Math.max(0, Math.min(n - 1, Math.floor(x))), sy = Math.max(0, Math.min(n - 1, Math.floor(y)));
  const prev = new Int32Array(n * n).fill(-2);
  const s0 = sy * n + sx;
  prev[s0] = -1;
  const q = [s0];
  const deep = (i: number) => m.terrain[i] <= Terrain.Shallow && m.height[i] < -0.6;
  let end = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const cx = c % n, cy = (c / n) | 0;
    if (cx <= 1 || cy <= 1 || cx >= n - 2 || cy >= n - 2) {
      end = c;
      break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      const k = ny * n + nx;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || prev[k] !== -2) continue;
      if (!deep(k) && h > 0) continue;
      prev[k] = c;
      q.push(k);
    }
  }
  const pts: [number, number][] = [];
  if (end < 0) return [[x, y], [x + 200, y]];
  for (let c = end; c >= 0; c = prev[c]) pts.push([(c % n) + 0.5, ((c / n) | 0) + 0.5]);
  pts.reverse();
  // simplify: keep every 4th point and push the final point off-map
  const simp = pts.filter((_, i) => i % 4 === 0 || i === pts.length - 1);
  const last = simp[simp.length - 1];
  const ex = last[0] <= 2 ? -30 : last[0] >= n - 3 ? n + 30 : last[0];
  const ey = last[1] <= 2 ? -30 : last[1] >= n - 3 ? n + 30 : last[1];
  simp.push([ex, ey]);
  simp[0] = [x, y];
  return simp;
}

// --------------------------------------------------------------------------------------------- per tick

/** a dock's own stores go straight aboard */
function loadDockStores(g: Game, s: Ship): void {
  const dock = g.buildings.get(s.dock);
  const have = dock?.inv.ration ?? 0;
  const room = SHIPS[s.type].rations - s.rations;
  if (dock && have > 0 && room > 0) {
    const t = Math.min(have, room);
    dock.inv.ration = have - t;
    s.rations += t;
  }
}

export function updateShips(g: Game, dt: number): void {
  updateYards(g, dt);
  for (const s of g.ships.values()) {
    switch (s.status) {
      case 'boarding': {
        loadDockStores(g, s);
        const crewAboard = [s.captain, ...s.crew].every((id) => {
          const p = g.people.get(id);
          return !p || p.task.kind === 'atsea' || p.mood === 'disgruntled';
        });
        if (crewAboard || g.time - (s.bell ?? 0) > MONTH * 0.6) depart(g, s, true);
        break;
      }
      case 'departing':
      case 'returning': {
        const path = s.voyagePath!;
        const i = s.pathI ?? 0;
        if (i >= path.length) {
          if (s.status === 'departing') s.status = 'atsea';
          else arriveHome(g, s);
          break;
        }
        const [tx, ty] = path[i];
        const dx = tx - s.vx, dy = ty - s.vy, d = Math.hypot(dx, dy);
        const last = i === path.length - 1;
        const sp = 3.2 * dt * (i < 2 || (s.status === 'returning' && i > path.length - 3) ? 0.6 : 1);
        if (d < sp + (last ? 0.3 : 2.2)) {
          s.pathI = i + 1;
          if (last && s.status === 'returning') {
            s.vx = tx;
            s.vy = ty;
            s.vdir = (s as any).berthDir ?? s.vdir;
          }
        } else {
          const want = Math.atan2(dy, dx);
          let da = want - s.vdir;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          // turn harder when the waypoint is close so we never orbit it
          const turn = d < 5 ? 2.5 : 0.8;
          s.vdir += Math.max(-dt * turn, Math.min(dt * turn, da));
          s.vx += Math.cos(s.vdir) * sp;
          s.vy += Math.sin(s.vdir) * sp;
        }
        break;
      }
      case 'atsea':
        voyageTick(g, s, dt);
        break;
      case 'docked':
        loadDockStores(g, s);
        break;
      case 'repairing': {
        if (s.hull >= 1) {
          s.status = 'docked';
          break;
        }
        if (g.lumber() > 0 && g.rng.chance(dt / 4)) {
          consumeLumber(g, 1);
          s.hull = Math.min(1, s.hull + 0.04);
        }
        break;
      }
    }
  }
  checkHomecoming(g);
  // captured captains come home eventually
  for (const p of g.people.values()) {
    if (p.task.kind === 'atsea' && p.captain && !p.ship && p.task.timer !== undefined) {
      p.task.timer -= dt;
      if (p.task.timer <= 0) {
        const dock = g.findBuilding('dock') ?? g.findBuilding('palace');
        if (dock) {
          p.x = dock.door[0] + 0.5;
          p.y = dock.door[1] + 0.5;
          p.task = { kind: 'idle' };
          g.msg('good', 'Captain Returns', `${p.name} has escaped captivity and returned to the island!`, 'captain_returns', { x: p.x, y: p.y });
          assignCrews(g);
        }
      }
    }
  }
}

function crewOf(g: Game, s: Ship): Person[] {
  return s.crew.map((id) => g.people.get(id)!).filter((p) => p && p.task.kind !== 'dead');
}
function avgSkill(crew: Person[], k: keyof Person['skills']): number {
  return crew.length ? crew.reduce((a, p) => a + p.skills[k], 0) / crew.length : 0;
}

function voyageTick(g: Game, s: Ship, dt: number): void {
  const v = s.voyage!;
  v.t += dt;
  s.rations -= v.rationRate * dt;
  const cap = g.people.get(s.captain);
  const crew = crewOf(g, s);
  // navigation checks every half month in transit
  if (Math.floor(v.t / (MONTH / 2)) !== Math.floor((v.t - dt) / (MONTH / 2))) {
    const nav = Math.max(cap?.skills.navigation ?? 0, ...s.officers.map((id) => g.people.get(id)?.skills.navigation ?? 0));
    if (g.rng.chance(Math.max(0.005, 0.07 - nav * 0.013))) {
      v.lost = true;
      v.back += MONTH * g.rng.range(0.15, 0.5);
      logV(g, s, 'Fog and bad reckoning: we are lost! Rations are running low.');
    }
  }
  if (s.rations <= 0) {
    mutiny(g, s);
    return;
  }
  const phaseOut = v.out;
  // on station
  if (v.t > phaseOut && !v.station) {
    v.station = g.time;
    onStation(g, s);
  }
  if (v.station && v.t > phaseOut) {
    const returnNeed = v.back * v.rationRate * 1.6 + 1 + (v.lost ? MONTH * 0.5 * v.rationRate : 0);
    const done = s.mission !== 'cruise' || s.rations <= returnNeed || s.hull < 0.45 || v.sunk || crew.length < Math.ceil(SHIPS[s.type].men / 3);
    if (s.mission === 'cruise' && !done) {
      v.nextEncounter -= dt;
      if (v.nextEncounter <= 0) {
        const r = g.regions[s.region];
        const traffic = NATIONS.reduce((a, n) => a + (g.ongoing.has(`prohibit_${n}`) ? 0 : r.merchant[n] + r.naval[n] * (1 + r.heat * 0.3)), 0) + r.pirates;
        const sea = (cap?.skills.seamanship ?? 2) / 5;
        const rate = (0.6 + traffic * 0.8) * (1 + r.knowledge * 0.12) * (0.7 + sea * 0.6);
        v.nextEncounter = (MONTH / rate) * g.rng.range(0.5, 1.5);
        if (v.t - phaseOut > MONTH * 0.15) encounter(g, s);
      }
    }
    if (done && !s.returnDock) beginReturn(g, s);
  }
}

function logV(g: Game, s: Ship, text: string): void {
  s.log.push({ date: g.date, text });
}

function onStation(g: Game, s: Ship): void {
  const r = g.regions[s.region];
  const cap = g.people.get(s.captain);
  if (s.mission === 'explore') {
    r.knowledge = Math.min(5, r.knowledge + 2);
    for (const nb of r.neighbors) g.regions[nb].knowledge = Math.max(g.regions[nb].knowledge, 1);
    const found: string[] = [];
    for (const st of r.settlements) if (!st.found) (st.found = true), found.push(`${st.name} (${NATION_ADJ[st.nat]} ${st.type})`);
    if (r.tradeRoute && !r.routeFound) (r.routeFound = true), found.push('a busy trade route');
    logV(g, s, `Charted the ${r.name}.${found.length ? ' Discovered ' + found.join(', ') + '.' : ''}`);
  }
  if (s.mission === 'raid') {
    // choose best known settlement nearby, else farmsteads anywhere near home
    const cands = g.regions.flatMap((reg) => reg.settlements.filter((x) => x.found || reg.id === g.homeRegion || reg.neighbors.includes(g.homeRegion)).map((x) => ({ x, reg })));
    const pick = cands.length ? g.rng.pick(cands) : null;
    const type = pick?.x.type ?? 'farmstead';
    const nat = pick?.x.nat ?? g.rng.pick(NATIONS);
    const caught = { farmstead: [3, 6], trade: [5, 10], military: [8, 15] }[type];
    const crew = crewOf(g, s);
    const party = Math.min(1, (crew.length + 1) / (SHIPS[s.type].men + SHIPS[s.type].officers));
    const n = Math.max(1, Math.round(g.rng.int(caught[0], caught[1]) * (0.4 + 0.6 * party)));
    const deaths = type === 'military' ? g.rng.int(0, 2) : type === 'trade' ? g.rng.int(0, 1) : 0;
    for (let i = 0; i < deaths && crew.length; i++) {
      const victim = crew.splice(g.rng.int(0, crew.length - 1), 1)[0];
      dieAtSea(g, s, victim);
    }
    s.voyage!.loot.captives += n;
    s.enemyNat = nat;
    if (pick) pick.x.raided++;
    piracyAgainst(g, nat, type === 'military' ? 8 : 4);
    logV(g, s, `Raided ${pick ? pick.x.name : 'a farmstead'} (${NATION_ADJ[nat]}). Seized ${n} captives${deaths ? `; lost ${deaths} men` : ''}.`);
  }
  if (s.mission === 'kidnap') {
    const job = s.kidnapJob!;
    s.voyage!.loot.skilled.push(job);
    logV(g, s, `Snatched a ${JOB_NAMES[job]} from a sleepy port town. Nobody saw a thing.`);
  }
  if (s.mission === 'foster_war') {
    const target = s.foster ?? 'spa';
    const others = NATIONS.filter((n) => n !== target);
    const blamed = g.rng.pick(others);
    g.nations[target].relation += 0; // we fly false colours
    if (!g.nations[target].atWarWith.includes(blamed) && g.rng.chance(0.45)) {
      g.nations[target].atWarWith.push(blamed);
      g.nations[blamed].atWarWith.push(target);
      g.msg('info', 'War in Europe!', `${NATION_NAMES[target]} has declared war on ${NATION_NAMES[blamed]}! Your false colours worked a treat.`, 'war_declared');
      logV(g, s, `Flew ${NATION_ADJ[blamed]} colours and fired on ${NATION_ADJ[target]} ships. It's war!`);
    } else logV(g, s, `Flew ${NATION_ADJ[blamed]} colours and fired on ${NATION_ADJ[target]} ships. Tensions are rising.`);
  }
  void cap;
}

function dieAtSea(g: Game, s: Ship, p: Person): void {
  s.crew = s.crew.filter((c) => c !== p.id);
  s.officers = s.officers.filter((c) => c !== p.id);
  p.ship = 0;
  killPerson(g, p, 'at sea');
  g.people.delete(p.id);
}

function beginReturn(g: Game, s: Ship): void {
  // a ship keeps its own berth while away; fall back to any free dock
  let dock = s.dock ? g.buildings.get(s.dock) : undefined;
  if (!dock) dock = [...g.buildings.values()].find((b) => b.def === 'dock' && b.built >= 1 && !b.ship);
  if (!dock) return; // no berth: wait at sea
  s.returnDock = dock.id;
  dock.ship = s.id;
  (s.voyage as any).homeAt = s.voyage!.t + s.voyage!.back;
}

// returning travel: wait homeAt then sail in
function arriveHome(g: Game, s: Ship): void {
  const dock = g.buildings.get(s.returnDock ?? 0);
  s.returnDock = undefined;
  s.status = s.hull < 1 ? 'repairing' : 'docked';
  if (dock) {
    s.dock = dock.id;
    dock.ship = s.id;
  }
  unload(g, s, dock);
}

function mutiny(g: Game, s: Ship): void {
  const cap = g.people.get(s.captain);
  g.msg('bad', 'Mutiny!', `Starving and lost, the crew of the ${s.name} mutinied${cap ? ` and set ${cap.name} adrift` : ''}. The ship and all aboard are lost to you.`, 'mutiny', undefined, true);
  for (const p of crewOf(g, s)) (p.ship = 0), releaseAll(g, p), g.people.delete(p.id);
  if (cap) {
    releaseAll(g, cap);
    g.people.delete(cap.id);
  }
  removeShip(g, s);
}

function removeShip(g: Game, s: Ship): void {
  if (s.returnDock) {
    const d = g.buildings.get(s.returnDock);
    if (d && d.ship === s.id) d.ship = 0;
  }
  const d = g.buildings.get(s.dock);
  if (d && d.ship === s.id) d.ship = 0;
  g.ships.delete(s.id);
  g.events.push({ type: 'shipRemoved', id: s.id });
}

// called every tick from voyageTick when at sea and returnDock reserved
export function checkHomecoming(g: Game): void {
  for (const s of g.ships.values()) {
    if (s.status !== 'atsea' || !s.returnDock) continue;
    const v = s.voyage!;
    if (v.t >= ((v as any).homeAt ?? Infinity)) {
      const dock = g.buildings.get(s.returnDock);
      if (!dock) {
        s.returnDock = undefined;
        continue;
      }
      const [bx, by, bdir] = dockBerth(dock);
      const path = seaPath(g, bx, by).reverse();
      s.vx = path[0][0];
      s.vy = path[0][1];
      s.vdir = Math.atan2(path[1][1] - path[0][1], path[1][0] - path[0][0]);
      path[path.length - 1] = [bx, by];
      s.voyagePath = path;
      s.pathI = 1;
      s.status = 'returning';
      (s as any).berthDir = bdir;
      g.events.push({ type: 'return', ship: s.id });
      g.msg('ship', 'Sail Ho!', `The ${s.name} has been sighted returning to port.`, 'sail_ho', { x: bx, y: by });
    }
  }
}

// --------------------------------------------------------------------------------------------- combat

interface Side {
  crew: number;
  fighting: number;
  cannons: number;
  muskets: number;
  cutlasses: number;
  hull: number; // hit points
  gun: number;
  sword: number;
  musket: number;
  courage: number;
  leadership: number;
  notoriety: number;
  seaman: number;
  speed: number;
}

function encounter(g: Game, s: Ship): void {
  const r = g.regions[s.region];
  // pick nation & type weighted by traffic
  const opts: { nat: Nation | null; naval: boolean; w: number }[] = [];
  for (const n of NATIONS) {
    if (g.ongoing.has(`prohibit_${n}`)) continue;
    const pat = patronOf(g);
    if (pat === n) continue;
    if (g.ongoing.has(`peace:${n}`)) continue; // honour peace unless... (captains obey)
    opts.push({ nat: n, naval: false, w: r.merchant[n] });
    opts.push({ nat: n, naval: true, w: r.naval[n] * (1 + r.heat * 0.4) });
  }
  opts.push({ nat: null, naval: false, w: r.pirates });
  const tot = opts.reduce((a, o) => a + o.w, 0);
  if (tot <= 0) return;
  let x = g.rng.range(0, tot);
  let o = opts[0];
  for (const op of opts) if ((x -= op.w) <= 0) (o = op), (x = Infinity);
  let prey: PreyDef;
  if (o.nat === null) prey = PREY.find((p) => p.id === 'pirate')!;
  else if (o.naval) prey = g.rng.pick(PREY.filter((p) => p.naval).concat(r.settlements.some((st) => st.type === 'military') ? [] : [PREY[4], PREY[4]]));
  else {
    const merch = PREY.filter((p) => !p.naval && p.id !== 'pirate');
    const tradeBoost = r.tradeRoute || r.settlements.some((st) => st.type === 'trade');
    prey = g.rng.chance(tradeBoost ? 0.45 : 0.2) ? g.rng.pick([merch[2], merch[3], merch[2]]) : g.rng.pick([merch[0], merch[1], merch[1]]);
  }
  battle(g, s, prey, o.nat);
}

export function patronOf(g: Game): Nation | null {
  for (const n of NATIONS) if (g.ongoing.has(`patron:${n}`)) return n;
  return null;
}

export function battle(g: Game, s: Ship, prey: PreyDef, nat: Nation | null): void {
  const crew = crewOf(g, s);
  const cap = g.people.get(s.captain);
  const d = SHIPS[s.type];
  const us: Side = {
    crew: crew.length + 1, fighting: crew.length + 1, cannons: s.cannons, muskets: s.muskets, cutlasses: s.cutlasses, hull: d.tons * s.hull,
    gun: avgSkill(crew, 'gunnery'), sword: avgSkill(crew, 'swordsmanship'), musket: avgSkill(crew, 'marksmanship'),
    courage: crew.reduce((a, p) => a + p.traits.courage, 0) / Math.max(1, crew.length), leadership: cap?.traits.leadership ?? 3,
    notoriety: cap?.traits.notoriety ?? 2, seaman: cap?.skills.seamanship ?? 2, speed: d.speed * (g.has('craftiness') ? 1.1 : 1),
  };
  const naval = prey.naval;
  const them: Side = {
    crew: Math.round(prey.crew * g.rng.range(0.8, 1.2)), fighting: 0, cannons: prey.cannons, muskets: Math.round(prey.crew * (naval ? 0.8 : 0.3)),
    cutlasses: prey.crew, hull: prey.tons, gun: naval ? 3 : 1.5, sword: naval ? 3 : 1.5, musket: naval ? 3 : 1.2,
    courage: naval ? 6 : 3.5, leadership: naval ? 6 : 3, notoriety: 1, seaman: naval ? 3 : 2, speed: prey.speed,
  };
  them.fighting = them.crew;
  const natName = nat ? NATION_ADJ[nat] : 'rival';
  const label = `${nat ? natName + ' ' : ''}${prey.name}`;
  // assessment
  const ourStr = us.cannons * 2 + us.crew * 2 + d.tons * 0.05;
  const theirStr = them.cannons * 2 + them.crew * 2 + prey.tons * 0.05;
  let wePursue = (us.courage + (cap?.traits.courage ?? 5)) / 2 + (ourStr / theirStr - 1) * 4 > 3.5;
  if (g.has('suicidal')) wePursue = true;
  if (g.has('cowardly') && ourStr < theirStr * 1.3) wePursue = false;
  if (!naval && prey.id !== 'pirate') wePursue = (wePursue && ourStr > theirStr * 0.75) || ourStr > theirStr * 1.1 || g.has('suicidal');
  const rg = g.regions[s.region];
  const zeal = naval ? 0.3 + Math.min(0.5, rg.heat * 0.12) + us.notoriety * 0.03 : 0.5;
  const theyPursue = (naval || prey.id === 'pirate') && theirStr > ourStr * 0.7 && g.rng.chance(zeal);
  if (!wePursue && !theyPursue) {
    logV(g, s, `Sighted a ${label}; both ships kept their distance.`);
    return;
  }
  if (wePursue !== theyPursue) {
    const chaser = wePursue ? us : them, runner = wePursue ? them : us;
    const roll = chaser.speed * (0.8 + chaser.seaman * 0.08) * g.rng.range(0.7, 1.3) - runner.speed * (0.8 + runner.seaman * 0.08) * g.rng.range(0.7, 1.3);
    if (roll < 0) {
      logV(g, s, wePursue ? `Gave chase to a ${label}, but she slipped away.` : `Fled from a ${label} and escaped.`);
      return;
    }
  }
  // battle rounds
  let boarding = false;
  let usFled = 0, themFled = 0;
  let ourDead = 0, theirDead = 0;
  const startFighting = us.fighting;
  let fled = false;
  const kill = (side: Side, n: number) => {
    n = Math.min(side.fighting, Math.max(0, Math.round(n)));
    side.fighting -= n;
    side.crew -= n;
    return n;
  };
  for (let round = 0; round < 14; round++) {
    if (round === 0 || (!boarding && (s.orders !== 'board'))) {
      // gunnery exchange
      const ourHits = Math.min(us.cannons, us.fighting * 2) * (0.15 + us.gun * 0.05) * g.rng.range(0.6, 1.4);
      const theirHits = Math.min(them.cannons, them.fighting * 2) * (0.15 + them.gun * 0.05) * g.rng.range(0.6, 1.4);
      const harass = s.orders === 'harass' && round > 0;
      if (harass) {
        theirDead += kill(them, ourHits * 0.35 + Math.min(us.muskets, us.fighting) * (0.08 + us.musket * 0.04));
        them.hull -= ourHits * 0.6;
      } else {
        them.hull -= ourHits * 2.2;
        theirDead += kill(them, ourHits * 0.15);
      }
      us.hull -= theirHits * 2.2;
      ourDead += kill(us, theirHits * 0.15 + (naval && round > 0 ? Math.min(them.muskets, them.fighting) * (0.04 + them.musket * 0.02) : 0));
    }
    if (!boarding && s.orders === 'board' && round > 0) {
      // try to come alongside
      if (g.rng.chance(0.35 + us.seaman * 0.1)) {
        boarding = true;
        logV(g, s, 'Grappling hooks away! Boarders!');
      }
    }
    if (boarding) {
      const ourArmed = Math.min(us.fighting, us.cutlasses);
      const ourBlows = ourArmed * (0.25 + us.sword * 0.07) + (us.fighting - ourArmed) * 0.08;
      const theirBlows = them.fighting * (0.2 + them.sword * 0.06) * (naval || prey.id === 'pirate' ? 1 : 0.5);
      theirDead += kill(them, ourBlows * g.rng.range(0.6, 1.3) * 0.5);
      ourDead += kill(us, theirBlows * g.rng.range(0.6, 1.3) * 0.45);
    }
    // morale
    const ourMorale = us.courage + us.leadership * 0.4 - them.notoriety * 0.5;
    const theirMorale = them.courage + them.leadership * 0.4 - us.notoriety * 0.7 + (naval ? 1 : 0);
    const loss = (side: Side, morale: number) => {
      const casualtyShock = 1 - side.crew / Math.max(1, side.crew + (side === us ? ourDead : theirDead));
      const p = Math.max(0, 0.25 + casualtyShock - morale * 0.06);
      const n = Math.round(side.fighting * p * g.rng.range(0.2, 0.6));
      side.fighting -= n;
      return n;
    };
    usFled += loss(us, ourMorale);
    themFled += loss(them, theirMorale);
    if (them.fighting <= 0 || them.hull <= 0 || us.fighting <= 0 || us.hull <= 0) break;
    // a beaten crew tries to break off (only possible before boarders are locked together)
    const losing = us.fighting < startFighting * 0.45 || us.hull < d.tons * 0.35;
    if (losing && !g.has('suicidal') && (!boarding || g.rng.chance(0.3))) {
      const roll = us.speed * (0.8 + us.seaman * 0.1) * g.rng.range(0.7, 1.4) - them.speed * (0.8 + them.seaman * 0.08) * g.rng.range(0.7, 1.3);
      if (roll > -6) {
        fled = true;
        break;
      }
    }
  }
  // apply our casualties to real crew
  const realDead = Math.min(crew.length, ourDead);
  for (let i = 0; i < realDead; i++) dieAtSea(g, s, crew.splice(g.rng.int(0, crew.length - 1), 1)[0]);
  s.hull = Math.max(0, us.hull / d.tons);
  // ammunition use
  s.cannons = Math.max(0, s.cannons - (g.rng.chance(0.3) ? 1 : 0));
  s.muskets = Math.max(0, s.muskets - (s.orders === 'harass' ? g.rng.int(0, 2) : 0));
  s.cutlasses = Math.max(0, s.cutlasses - (boarding ? g.rng.int(0, 2) : 0));
  // skill growth
  for (const p of crew) {
    p.skills.gunnery = Math.min(5, p.skills.gunnery + 0.05);
    if (boarding) p.skills.swordsmanship = Math.min(5, p.skills.swordsmanship + 0.08);
    if (s.orders === 'harass') p.skills.marksmanship = Math.min(5, p.skills.marksmanship + 0.06);
    p.skills.seamanship = Math.min(5, p.skills.seamanship + 0.03);
  }
  const r = g.regions[s.region];
  if (us.hull <= 0 || (us.fighting <= 0 && them.fighting > 0)) {
    // lost the fight
    s.voyage!.sunk = true;
    logV(g, s, `Defeated by a ${label}!`);
    shipLost(g, s, label, nat);
    return;
  }
  if (fled) {
    logV(g, s, `Outgunned by a ${label}, we cut and ran. Lost ${realDead} men.`);
    return;
  }
  if (them.fighting > 0 && them.hull > 0) {
    logV(g, s, `Traded broadsides with a ${label}; both ships broke off. Lost ${realDead} men.`);
    return;
  }
  // victory!
  const sunk = them.hull <= 0;
  let gold = g.rng.int(prey.gold[0], prey.gold[1]);
  if (g.has('notoriety')) gold *= 1.1;
  if (sunk) gold *= 0.35;
  gold = Math.round(gold);
  const survivors = Math.max(0, them.crew);
  const plank = g.ongoing.has('walk_plank');
  const generosity = SPOILS_TREASURY[s.spoils];
  let recruits = 0, captives = 0, wealthy = 0;
  const skilled: Job[] = [];
  if (!plank && !sunk) {
    const recruitRate = (1.25 - generosity) * 0.75 * (g.has('always_pirate') ? 2 : 1) * (g.has('once_captain') ? 0.9 : 1) * (g.has('once_mutineer') ? 1.1 : 1);
    recruits = Math.round(survivors * Math.min(0.85, recruitRate) * g.rng.range(0.6, 1));
    const rest = survivors - recruits;
    captives = Math.round(rest * g.rng.range(0.3, 0.7));
    if (g.rng.chance(prey.passengers)) wealthy = g.rng.int(1, prey.tons > 300 ? 3 : 1);
    const skilledJobs: Job[] = ['farmer', 'cook', 'server', 'wench', 'trader', 'priest', 'surgeon', 'shipwright', 'engineer', 'gunsmith', 'distiller', 'tobacconist', 'carpenter', 'hatter', 'birdhandler', 'courtesan'];
    const nSk = g.rng.chance(prey.skilled) ? g.rng.int(1, 2) : 0;
    for (let i = 0; i < nSk && captives > 0; i++) {
      skilled.push(g.rng.pick(skilledJobs));
      captives--;
    }
  }
  const loot = s.voyage!.loot;
  loot.gold += gold;
  loot.recruits += recruits;
  loot.captives += captives;
  loot.wealthy += wealthy;
  loot.skilled.push(...skilled);
  loot.cannons += sunk ? 0 : Math.min(4, Math.floor(prey.cannons / 6));
  if (cap) cap.traits.notoriety = Math.min(9, cap.traits.notoriety + (naval ? 0.5 : 0.2));
  g.stats.plundered += gold;
  if (nat) {
    g.nations[nat].plunderGold += gold;
    piracyAgainst(g, nat, naval ? 10 : 4);
    if (g.ongoing.has(`peace:${nat}`)) breakPeace(g, nat);
    r.heat += 1;
  }
  logV(g, s, `${sunk ? 'Sank' : 'Took'} a ${label}! Plunder: ${gold} gold${captives ? `, ${captives} captives` : ''}${skilled.length ? `, skilled ${skilled.map((j) => JOB_NAMES[j]).join(', ')}` : ''}${wealthy ? `, ${wealthy} wealthy passenger${wealthy > 1 ? 's' : ''}` : ''}${recruits ? `, ${recruits} recruits` : ''}. Lost ${realDead} men.`);
  r.knowledge = Math.min(5, r.knowledge + 0.25);
}

function shipLost(g: Game, s: Ship, label: string, nat: Nation | null): void {
  const cap = g.people.get(s.captain);
  for (const p of crewOf(g, s)) dieAtSea(g, s, p);
  g.stats.shipsSunk++;
  if (cap) {
    cap.ship = 0;
    cap.task = { kind: 'atsea', phase: 1, timer: MONTH * g.rng.range(3, 6) };
    g.msg('bad', 'Ship Lost!', `The ${s.name} was sunk by a ${label}. All hands lost. Captain ${cap.name} was taken prisoner, but swears to return.`, 'ship_sunk', undefined, true);
  } else g.msg('bad', 'Ship Lost!', `The ${s.name} was sunk by a ${label}.`, 'ship_sunk', undefined, true);
  removeShip(g, s);
  if (nat) g.regions[s.region].heat += 1;
}

// --------------------------------------------------------------------------------------------- homecoming

function unload(g: Game, s: Ship, dock: Building | undefined): void {
  const v = s.voyage;
  if (!v) return;
  const at = dock?.door ?? g.findBuilding('palace')!.door;
  const crew = crewOf(g, s);
  const cap = g.people.get(s.captain);
  // disembark
  for (const p of [cap, ...crew]) {
    if (!p) continue;
    p.task = { kind: 'idle' };
    p.x = at[0] + 0.5 + g.rng.range(-0.4, 0.4);
    p.y = at[1] + 0.5 + g.rng.range(-0.4, 0.4);
    g.events.push({ type: 'disembark', id: p.id });
  }
  const l = v.loot;
  // division of spoils
  const share = SPOILS_TREASURY[s.spoils];
  const treasuryShare = Math.round(l.gold * share);
  const crewShare = l.gold - treasuryShare;
  if (treasuryShare) g.earn(treasuryShare, 'plunder');
  if (crewShare) {
    const pay = (p: Person | undefined, amt: number) => {
      if (!p) return;
      p.gold += Math.round(amt);
      p.earned += Math.round(amt);
    };
    const officers = s.officers.map((id) => g.people.get(id)).filter(Boolean) as Person[];
    const men = crew.filter((p) => !s.officers.includes(p.id));
    pay(cap, crewShare * 0.25);
    for (const o of officers) pay(o, (crewShare * 0.25) / Math.max(1, officers.length));
    for (const m of men) pay(m, (crewShare * 0.5) / Math.max(1, men.length));
    if (!officers.length) pay(cap, crewShare * 0.25);
  }
  s.cannons = Math.min(SHIPS[s.type].cannons, s.cannons + l.cannons);
  const nat = s.enemyNat ?? g.rng.pick(NATIONS);
  for (let i = 0; i < l.captives; i++) createPerson(g, 'captive', at[0], at[1], { nat: g.rng.chance(0.6) ? nat : undefined });
  for (const job of l.skilled) createPerson(g, 'captive', at[0], at[1], { skilled: job });
  for (let i = 0; i < l.wealthy; i++) createPerson(g, 'wealthy', at[0], at[1]);
  for (let i = 0; i < l.recruits; i++) {
    const p = createPerson(g, 'pirate', at[0], at[1]);
    p.gold = g.rng.int(5, 30);
    g.stats.recruits++;
  }
  g.stats.captured += l.captives + l.skilled.length + l.wealthy;
  const parts: string[] = [];
  if (l.gold) parts.push(`${l.gold} gold (${treasuryShare} to the treasury)`);
  if (l.captives) parts.push(`${l.captives} captives`);
  if (l.skilled.length) parts.push(`skilled: ${l.skilled.map((j) => JOB_NAMES[j]).join(', ')}`);
  if (l.wealthy) parts.push(`${l.wealthy} wealthy hostage${l.wealthy > 1 ? 's' : ''}`);
  if (l.recruits) parts.push(`${l.recruits} new recruits`);
  const summary = parts.length ? parts.join(', ') : 'nothing but sunburn';
  g.msg('ship', `${s.name} Returns`, `The ${s.name} is back from her ${missionName(s)}, bringing ${summary}.\n\n${s.log.map((e) => `${e.date}: ${e.text}`).join('\n')}`, l.gold > 500 ? 'big_plunder' : l.gold > 0 || l.captives ? 'ship_returns' : 'ship_returns_empty', dock ? { x: dock.x, y: dock.y } : undefined, true);
  g.events.push({ type: 'plunder', ship: s.id, gold: l.gold });
  s.voyage = undefined;
  s.enemyNat = undefined;
  assignCrews(g);
}

export { createCaptain };
