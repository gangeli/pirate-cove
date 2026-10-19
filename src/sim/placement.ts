import { BUILDING, defaultPriority, type BuildingDef } from './data/buildings';
import { Terrain } from './map';
import type { Game, CmdResult } from './game';
import { markBlocked } from './game';
import type { Building } from './types';
import { createPerson, createCaptain, createShip } from './people';
import { assignCrews } from './sea';
import { SHIPS } from './data/ships';
import { cropFertility } from './economy';
import { ENTERTAINMENT_NAMES } from './names';

export interface Placement {
  ok: boolean;
  reason?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  door?: [number, number];
  autoRoad?: [number, number][];
}

export const FRONT: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export function footprint(def: BuildingDef, rot: number): [number, number] {
  return rot % 2 === 0 ? [def.size[0], def.size[1]] : [def.size[1], def.size[0]];
}

/** tiles just outside the footprint on the given side */
function edgeTiles(x: number, y: number, w: number, h: number, rot: number): [number, number][] {
  const out: [number, number][] = [];
  const [fx, fy] = FRONT[rot];
  if (fy === 1) for (let i = 0; i < w; i++) out.push([x + i, y + h]);
  if (fy === -1) for (let i = 0; i < w; i++) out.push([x + i, y - 1]);
  if (fx === 1) for (let j = 0; j < h; j++) out.push([x + w, y + j]);
  if (fx === -1) for (let j = 0; j < h; j++) out.push([x - 1, y + j]);
  return out;
}

function ring(x: number, y: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < w; i++) out.push([x + i, y - 1], [x + i, y + h]);
  for (let j = 0; j < h; j++) out.push([x - 1, y + j], [x + w, y + j]);
  return out;
}

export function canPlace(g: Game, def: BuildingDef, x: number, y: number, rot: number): Placement {
  const m = g.map;
  const [w, h] = footprint(def, rot);
  const res: Placement = { ok: false, x, y, w, h, rot };
  const fail = (reason: string) => ((res.reason = reason), res);
  if (x < 1 || y < 1 || x + w >= m.size - 1 || y + h >= m.size - 1) return fail('Too close to the edge of the world.');
  let land = 0, water = 0;
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) {
      const k = m.idx(i, j);
      if (m.occupied[k]) return fail('Something is already built there.');
      if (m.path[k] && def.id !== 'road') return fail('Cannot build on a road.');
      const t = m.terrain[k];
      if (t === Terrain.Mountain) return fail('Too mountainous.');
      if (t >= Terrain.Beach) land++;
      else water++;
    }
  if (def.water === 'dock') {
    // landward front row must touch beach; the rest is water; open sea beyond
    const front = edgeTiles(x, y, w, h, rot);
    const landFront = front.filter(([i, j]) => m.isLand(i, j)).length;
    if (landFront < Math.ceil(front.length * 0.6)) return fail('A dock\'s ramp must face a straight beach.');
    if (land > w + h) return fail('A dock must be built out over the water.');
    const back = edgeTiles(x, y, w, h, (rot + 2) % 4);
    for (const [i, j] of back) {
      const [bx, by] = FRONT[(rot + 2) % 4];
      for (let k = 0; k < 4; k++) if (m.isLand(i + bx * k, j + by * k)) return fail('Not enough room for a ship to berth.');
    }
    // road within 8 tiles of ramp
    const cx = front[Math.floor(front.length / 2)];
    const road = autoRoadPath(g, cx[0], cx[1], 9, { x, y, w, h });
    if (!road && !hasAnyRoad(g)) {
      res.ok = true;
      res.door = cx;
      return res;
    }
    if (!road) return fail('A dock must be within 8 tiles of a road.');
    res.autoRoad = road;
    res.door = cx;
    res.ok = true;
    return res;
  }
  let shallowOnly = true;
  if (def.water === 'shore') {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (m.terrain[m.idx(i, j)] === Terrain.DeepWater) shallowOnly = false;
    const front = edgeTiles(x, y, w, h, rot);
    if (front.some(([i, j]) => !m.isLand(i, j))) return fail('The front of a shipyard must be on land.');
    if (!shallowOnly || water > w * h * 0.55) return fail('A shipyard must sit at the water\'s edge, not out at sea.');
  } else if (water > 0) return fail('Must be built on dry land.');
  if (m.slopeOf(x, y, w, h) > (def.size[0] * def.size[1] > 20 ? 2.6 : 1.8)) return fail('The ground is too steep.');
  if (def.water === 'shore') {
    const back = edgeTiles(x, y, w, h, (rot + 2) % 4);
    const wet = back.filter(([i, j]) => !m.isLand(i, j)).length;
    if (wet < Math.ceil(back.length * 0.6)) return fail('A shipyard\'s slipway must face open water.');
  }
  if (def.gather?.from === 'ore') {
    let best = 0;
    for (let j = y - 2; j < y + h + 2; j++) for (let i = x - 2; i < x + w + 2; i++) if (m.inBounds(i, j)) best = Math.max(best, m.ore[m.idx(i, j)]);
    if (best < 0.35) return fail('Mines must be built next to an iron deposit.');
  }
  if (def.gather?.from === 'fertility' && def.gather.crop) {
    let f = 0;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) f += cropFertility(g, def.gather.crop, i, j);
    if (f / (w * h) < 0.15) return fail('This soil is too poor for that crop.');
  }
  if (def.id === 'road' || def.noRoad) {
    res.ok = true;
    res.door = def.id === 'road' ? [x, y] : frontDoor(g, x, y, w, h, rot);
    return res;
  }
  // must touch the road network
  const adj = ring(x, y, w, h).filter(([i, j]) => m.inBounds(i, j) && m.path[m.idx(i, j)]);
  if (!adj.length && def.water === 'shore') {
    const front = edgeTiles(x, y, w, h, rot);
    const fc = front[Math.floor(front.length / 2)];
    const road = autoRoadPath(g, fc[0], fc[1], 9, { x, y, w, h });
    if (!road) return fail('A shipyard must be within 8 tiles of a road.');
    res.autoRoad = road;
    res.door = fc;
    res.ok = true;
    return res;
  }
  if (!adj.length && !g.cheats.freebuild) return fail('Must be next to a road.');
  // door: prefer road tiles on the front side, nearest the centre
  const [fx, fy] = FRONT[rot];
  const cx = x + w / 2 - 0.5, cy = y + h / 2 - 0.5;
  let best: [number, number] | undefined, bs = Infinity;
  for (const t of adj) {
    const dx = t[0] - cx, dy = t[1] - cy;
    const facing = dx * fx + dy * fy;
    const score = -facing * 3 + Math.abs(dx * fy) + Math.abs(dy * fx);
    if (score < bs) (bs = score), (best = t);
  }
  res.door = best ?? frontDoor(g, x, y, w, h, rot);
  res.ok = true;
  return res;
}

function frontDoor(g: Game, x: number, y: number, w: number, h: number, rot: number): [number, number] {
  const e = edgeTiles(x, y, w, h, rot);
  return e[Math.floor(e.length / 2)];
}

function hasAnyRoad(g: Game): boolean {
  for (let i = 0; i < g.map.path.length; i++) if (g.map.path[i]) return true;
  return false;
}

/** BFS from (x,y) to nearest road over buildable land; returns tiles to pave (excluding existing road) */
export function autoRoadPath(g: Game, sx: number, sy: number, maxLen: number, avoid?: { x: number; y: number; w: number; h: number }): [number, number][] | null {
  const m = g.map, n = m.size;
  const prev = new Int32Array(n * n).fill(-2);
  const q = [sy * n + sx];
  prev[q[0]] = -1;
  if (!m.isWalkable(sx, sy)) return null;
  const dist = new Map<number, number>([[q[0], 0]]);
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const d = dist.get(c)!;
    if (m.path[c]) {
      const out: [number, number][] = [];
      for (let k = prev[c]; k >= 0; k = prev[k]) out.push([k % n, (k / n) | 0]);
      return out;
    }
    if (d >= maxLen) continue;
    const cx = c % n, cy = (c / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!m.inBounds(nx, ny)) continue;
      const k = ny * n + nx;
      if (prev[k] !== -2) continue;
      if (!m.isWalkable(nx, ny) || m.occupied[k]) continue;
      if (avoid && nx >= avoid.x && ny >= avoid.y && nx < avoid.x + avoid.w && ny < avoid.y + avoid.h) continue;
      prev[k] = c;
      dist.set(k, d + 1);
      q.push(k);
    }
  }
  return null;
}

/**
 * Would this placement cut part of the island off from the palace? Placing may only take its own tiles
 * out of the walkable area that can reach the palace door, never seal off a pocket behind it (people
 * caught inside one could never get out to eat, drink or work).
 */
export function wouldWallOff(g: Game, def: BuildingDef, pl: Placement): boolean {
  const open = def.water === 'dock' || (def.gather?.from === 'fertility' && !!def.gather.crop);
  if (open || def.id === 'road') return false;
  const palace = g.findBuilding('palace');
  if (!palace) return false;
  const n = g.map.size, pf = g.pf;
  const start = palace.door[1] * n + palace.door[0];
  const reach = (skip: (k: number) => boolean): number => {
    if (pf.cost(start) === Infinity) return 0;
    const seen = new Uint8Array(n * n);
    const q = [start];
    seen[start] = 1;
    let c = 0;
    while (q.length) {
      const k = q.pop()!;
      c++;
      const x = k % n;
      for (const nk of [x + 1 < n ? k + 1 : -1, x > 0 ? k - 1 : -1, k + n, k - n]) {
        if (nk < 0 || nk >= n * n || seen[nk] || skip(nk) || pf.cost(nk) === Infinity) continue;
        seen[nk] = 1;
        q.push(nk);
      }
    }
    return c;
  };
  const inside = (k: number) => {
    const x = k % n, y = (k / n) | 0;
    return x >= pl.x && x < pl.x + pl.w && y >= pl.y && y < pl.y + pl.h;
  };
  let own = 0;
  for (let j = pl.y; j < pl.y + pl.h; j++) for (let i = pl.x; i < pl.x + pl.w; i++) if (pf.cost(j * n + i) !== Infinity) own++;
  const before = reach(() => false);
  const after = reach(inside);
  return before - after > own;
}

export function placeBuilding(g: Game, def: BuildingDef, pl: Placement, instant = false): Building {
  const m = g.map;
  const id = g.nextId++;
  const b: Building = {
    id, def: def.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h, rot: pl.rot, door: pl.door ?? [pl.x, pl.y + pl.h],
    built: def.instant || instant ? 1 : 0, priority: defaultPriority(def), wage: 2, workers: [], blocked: 0, haulers: [], overseer: 0, guards: [],
    customers: [], inv: {}, progress: 0, quality: 0, price: 0, income: 0, lastIncome: 0, hp: 0, staff: 0,
  };
  (b as any).placedAt = g.time;
  if (def.service) b.name = g.rng.pick(ENTERTAINMENT_NAMES);
  if (def.house) b.houseLevel = 1;
  if (def.water !== 'dock') m.flatten(pl.x, pl.y, pl.w, pl.h);
  for (let j = pl.y; j < pl.y + pl.h; j++)
    for (let i = pl.x; i < pl.x + pl.w; i++) {
      const k = m.idx(i, j);
      m.occupied[k] = id;
      m.trees[k] = 0;
      if (m.terrain[k] === Terrain.Jungle) m.terrain[k] = Terrain.Grass;
    }
  if (pl.autoRoad) for (const [x, y] of pl.autoRoad) m.path[m.idx(x, y)] = 1;
  g.buildings.set(id, b);
  g.buildingsChanged();
  markBlocked(g, b);
  g.pf.invalidate();
  // anyone standing where the walls go up steps aside
  for (const p of g.people.values()) {
    if (p.task.kind === 'atsea' || p.task.kind === 'dead') continue;
    const px = Math.floor(p.x), py = Math.floor(p.y);
    if (px < pl.x || px >= pl.x + pl.w || py < pl.y || py >= pl.y + pl.h || !g.pf.blocked[m.idx(px, py)]) continue;
    const w = g.pf.nearestWalkable(px, py, 8);
    if (w) (p.x = w[0] + 0.5), (p.y = w[1] + 0.5), (p.path = null);
  }
  if (b.built >= 1) onBuilt(g, b);
  g.events.push({ type: 'terrain', x: pl.x - 1, y: pl.y - 1, w: pl.w + 2, h: pl.h + 2 });
  if (pl.autoRoad) g.events.push({ type: 'roads' });
  return b;
}

export function onBuilt(g: Game, b: Building): void {
  b.built = 1;
  g.buildingsChanged();
  g.aura.dirty = true;
  const def = BUILDING[b.def];
  if (def.gather?.from === 'trees') b.hp = 1;
  g.events.push({ type: 'built', id: b.id });
  if (def.id === 'dock' && !g.advisorState.firstDockShip && g.month > 0) {
    // a free ship may arrive with the first dock
    g.advisorState.firstDockShip = 1;
    if (![...g.ships.values()].length) {
      const s = createShip(g, 'snow', b);
      g.msg('ship', 'A Ship Arrives!', `A battered snow, the ${s.name}, limps into your new dock. She's yours now.`, 'free_ship', { x: b.x, y: b.y });
    }
  }
}

export function removeBuilding(g: Game, b: Building): void {
  const m = g.map;
  for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) {
    const k = m.idx(i, j);
    m.occupied[k] = 0;
    g.pf.blocked[k] = 0;
  }
  for (const pid of [...b.workers, ...b.haulers, ...b.guards, b.overseer, ...b.customers, b.owner ?? 0]) {
    const p = g.people.get(pid);
    if (!p) continue;
    if (p.job === b.id) (p.job = 0), (p.jobRole = undefined);
    if (p.shoreJob === b.id) (p.shoreJob = 0), (p.shoreRole = undefined);
    if (p.home === b.id) p.home = 0;
    if (p.task.bld === b.id) p.task = { kind: 'idle' };
  }
  if (b.ship) {
    const s = g.ships.get(b.ship);
    if (s) s.dock = 0;
  }
  g.buildings.delete(b.id);
  g.buildingsChanged();
  g.pf.invalidate();
  g.aura.dirty = true;
  g.events.push({ type: 'removed', id: b.id });
  g.events.push({ type: 'terrain', x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
}

export function placeRoad(g: Game, x: number, y: number): CmdResult {
  const m = g.map;
  if (!m.inBounds(x, y)) return { ok: false, reason: 'Out of bounds' };
  const k = m.idx(x, y);
  if (m.path[k]) return { ok: false, reason: 'Already a road.' };
  if (m.occupied[k]) return { ok: false, reason: 'Something is built there.' };
  if (!m.isWalkable(x, y)) return { ok: false, reason: 'Cannot build a road there.' };
  if (hasAnyRoad(g)) {
    let adj = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.inBounds(x + dx, y + dy) && m.path[m.idx(x + dx, y + dy)]) adj = true;
    if (!adj) return { ok: false, reason: 'Roads must connect to the road network.' };
  }
  m.path[k] = 1;
  m.trees[k] = 0;
  if (m.terrain[k] === Terrain.Jungle) m.terrain[k] = Terrain.Grass;
  g.pf.invalidate();
  g.events.push({ type: 'roads' });
  g.events.push({ type: 'terrain', x: x - 1, y: y - 1, w: 3, h: 3 });
  return { ok: true };
}

export function removeRoad(g: Game, x: number, y: number): CmdResult {
  const m = g.map;
  if (!m.inBounds(x, y) || !m.path[m.idx(x, y)]) return { ok: false, reason: 'No road there.' };
  // only dead ends can be removed so the network is never split
  let deg = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.inBounds(x + dx, y + dy) && m.path[m.idx(x + dx, y + dy)]) deg++;
  if (deg > 1) return { ok: false, reason: 'Only the end of a road can be removed.' };
  for (const b of g.buildings.values()) if (b.door[0] === x && b.door[1] === y && !BUILDING[b.def].noRoad) {
    // check another road touches the building
    const alt = ring(b.x, b.y, b.w, b.h).find(([i, j]) => (i !== x || j !== y) && m.inBounds(i, j) && m.path[m.idx(i, j)]);
    if (!alt) return { ok: false, reason: `The ${BUILDING[b.def].name} needs this road.` };
    b.door = alt;
  }
  m.path[m.idx(x, y)] = 0;
  g.pf.invalidate();
  g.events.push({ type: 'roads' });
  g.events.push({ type: 'terrain', x: x - 1, y: y - 1, w: 3, h: 3 });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Starting island layout

/** find a valid spot for def, scanning outward from (cx,cy); returns placement */
export function findSpot(g: Game, def: BuildingDef, cx: number, cy: number, maxR = 40, pred?: (p: Placement) => boolean): Placement | null {
  for (let r = 0; r < maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (let rot = 0; rot < 4; rot++) {
          const [w, h] = footprint(def, rot);
          const p = canPlace(g, def, Math.round(cx + dx - w / 2), Math.round(cy + dy - h / 2), rot);
          if (p.ok && (!pred || pred(p))) return p;
        }
      }
  return null;
}

/** lay a road between two tiles using the pathfinder over open land */
export function buildRoadBetween(g: Game, ax: number, ay: number, bx: number, by: number): boolean {
  const m = g.map, n = m.size;
  const path = g.pf.find(ax, ay, bx, by, 60000);
  if (!path) return false;
  const tiles = [ay * n + ax, ...path];
  for (const k of tiles) {
    if (m.occupied[k]) continue;
    m.path[k] = 1;
    m.trees[k] = 0;
    if (m.terrain[k] === Terrain.Jungle) m.terrain[k] = Terrain.Grass;
  }
  // diagonal steps leave gaps for 4-connectivity; patch them
  for (let i = 1; i < tiles.length; i++) {
    const a = tiles[i - 1], b = tiles[i];
    const axx = a % n, ayy = (a / n) | 0, bxx = b % n, byy = (b / n) | 0;
    if (axx !== bxx && ayy !== byy) {
      const k1 = ayy * n + bxx, k2 = byy * n + axx;
      if (!m.occupied[k1] && m.isWalkable(bxx, ayy)) m.path[k1] = 1;
      else if (!m.occupied[k2]) m.path[k2] = 1;
    }
  }
  g.pf.invalidate();
  return true;
}

export function setupStartingIsland(g: Game): void {
  const m = g.map, n = m.size;
  // choose a dock site facing the open sea, preferring the south-east (toward the default camera)
  const coast = m.coastDist();
  let bestDock: { x: number; y: number; dir: number } | null = null;
  let bestScore = -Infinity;
  const dockDef = BUILDING.dock;
  const centre = n / 2;
  for (const s of m.dockSites) {
    // inland flatness around
    let flat = 0;
    for (let j = -10; j <= 10; j += 2) for (let i = -10; i <= 10; i += 2) {
      const tx = s.x + i, ty = s.y + j;
      if (m.inBounds(tx, ty) && m.terrain[m.idx(tx, ty)] === Terrain.Grass) flat++;
    }
    const score = flat + (s.x + s.y - n) * 0.15 + g.rng.next() * 3;
    if (score > bestScore) (bestScore = score), (bestDock = s);
  }
  const ds = bestDock ?? { x: Math.floor(centre), y: Math.floor(centre), dir: 2 };
  // seaward direction ds.dir: 0 north,1 east,2 south,3 west (from findDockSites order)
  const sea: [number, number] = [[0, -1], [1, 0], [0, 1], [-1, 0]][ds.dir] as [number, number];
  const inland: [number, number] = [-sea[0], -sea[1]];
  // palace: inland from the dock
  const px = ds.x + inland[0] * 16, py = ds.y + inland[1] * 16;
  g.cheats.freebuild = true; // temporarily allow placement without roads
  const palacePl = findSpot(g, BUILDING.palace, px, py, 30, () => true) ?? findSpot(g, BUILDING.palace, centre, centre, 60)!;
  const palace = placeBuilding(g, BUILDING.palace, palacePl, true);
  // road from palace door toward the dock
  const pd = palace.door;
  m.path[m.idx(pd[0], pd[1])] = 1;
  // road down to the beach first, so the dock can connect to it
  const beach = g.pf.nearestWalkable(ds.x, ds.y, 4);
  if (beach) buildRoadBetween(g, pd[0], pd[1], beach[0], beach[1]);
  // find a dock placement: the chosen site first, then every other site by distance from the palace.
  // Place the dock before its access road so the road can never be laid across the dock's own footprint.
  let dock: Building | null = null;
  const sites = [ds, ...m.dockSites.filter((x) => x !== ds).sort((a2, b2) => Math.hypot(a2.x - pd[0], a2.y - pd[1]) - Math.hypot(b2.x - pd[0], b2.y - pd[1]))];
  for (const site of sites.slice(0, 80)) {
    const sv: [number, number] = [[0, -1], [1, 0], [0, 1], [-1, 0]][site.dir] as [number, number];
    let dockPl: Placement | null = null;
    for (let r = 0; r < 6 && !dockPl; r++)
      for (let dy = -r; dy <= r && !dockPl; dy++)
        for (let dx = -r; dx <= r && !dockPl; dx++)
          for (let rot = 0; rot < 4 && !dockPl; rot++) {
            const [w, h] = footprint(dockDef, rot);
            const p = canPlace(g, dockDef, site.x + dx - Math.floor(w / 2) + sv[0] * 2, site.y + dy - Math.floor(h / 2) + sv[1] * 2, rot);
            if (p.ok) dockPl = p;
          }
    if (!dockPl) continue;
    dock = placeBuilding(g, dockDef, dockPl, true);
    buildRoadBetween(g, pd[0], pd[1], dock.door[0], dock.door[1]);
    break;
  }
  // last resort: run a road down to each candidate beach, then try again
  for (const site of dock ? [] : sites.slice(0, 120)) {
    const beach2 = g.pf.nearestWalkable(site.x, site.y, 5);
    if (!beach2) continue;
    buildRoadBetween(g, pd[0], pd[1], beach2[0], beach2[1]);
    const sv: [number, number] = [[0, -1], [1, 0], [0, 1], [-1, 0]][site.dir] as [number, number];
    for (let r = 0; r < 6 && !dock; r++)
      for (let dy = -r; dy <= r && !dock; dy++)
        for (let dx = -r; dx <= r && !dock; dx++)
          for (let rot = 0; rot < 4 && !dock; rot++) {
            const [w, h] = footprint(dockDef, rot);
            const p = canPlace(g, dockDef, site.x + dx - Math.floor(w / 2) + sv[0] * 2, site.y + dy - Math.floor(h / 2) + sv[1] * 2, rot);
            if (p.ok) {
              dock = placeBuilding(g, dockDef, p, true);
              buildRoadBetween(g, pd[0], pd[1], dock.door[0], dock.door[1]);
            }
          }
    if (dock) break;
  }
  g.cheats.freebuild = false;
  // a main street out from the palace in two directions
  const roadTo = (tx: number, ty: number) => {
    const t = g.pf.nearestWalkable(Math.round(tx), Math.round(ty), 10);
    if (t) buildRoadBetween(g, pd[0], pd[1], t[0], t[1]);
  };
  const perp: [number, number] = [inland[1], -inland[0]];
  roadTo(pd[0] + perp[0] * 22, pd[1] + perp[1] * 22);
  roadTo(pd[0] - perp[0] * 22, pd[1] - perp[1] * 22);
  roadTo(pd[0] + inland[0] * 18, pd[1] + inland[1] * 18);
  const near = (def: string, ox: number, oy: number, pred?: (p: Placement) => boolean) => {
    const pl = findSpot(g, BUILDING[def], pd[0] + ox, pd[1] + oy, 40, pred);
    return pl ? placeBuilding(g, BUILDING[def], pl, true) : null;
  };
  // stockade, sawmill near forest, timber camp, corn farm, chuck tent, construction tent, bunkhouse
  near('stockade', perp[0] * 10 + inland[0] * 4, perp[1] * 10 + inland[1] * 4);
  // forest-heavy spot for timber
  let fx = pd[0], fy = pd[1], fbest = -1;
  for (let j = -30; j <= 30; j += 3) for (let i = -30; i <= 30; i += 3) {
    const tx = pd[0] + i, ty = pd[1] + j;
    if (!m.inBounds(tx, ty)) continue;
    let t = 0;
    for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) if (m.inBounds(tx + a, ty + b)) t += m.trees[m.idx(tx + a, ty + b)];
    const sc = t - Math.hypot(i, j) * 0.8;
    if (sc > fbest) (fbest = sc), (fx = tx), (fy = ty);
  }
  roadTo(fx, fy);
  near('timber_camp', fx - pd[0], fy - pd[1]);
  near('sawmill', (fx - pd[0]) * 0.6, (fy - pd[1]) * 0.6);
  near('construction_tent', perp[0] * -6, perp[1] * -6);
  near('chuck_tent', perp[0] * 6 + inland[0] * -2, perp[1] * 6 + inland[1] * -2);
  near('bunkhouse', perp[0] * 7 + inland[0] * 6, perp[1] * 7 + inland[1] * 6);
  near('bunkhouse', perp[0] * 9 + inland[0] * 8, perp[1] * 9 + inland[1] * 8);
  near('corn_farm', -perp[0] * 14 + inland[0] * 6, -perp[1] * 14 + inland[1] * 6, (p) => {
    let f = 0;
    for (let j = p.y; j < p.y + p.h; j++) for (let i = p.x; i < p.x + p.w; i++) f += cropFertility(g, 'corn', i, j);
    return f / (p.w * p.h) > 0.35;
  });
  near('corn_farm', -perp[0] * 18 + inland[0] * 8, -perp[1] * 18 + inland[1] * 8);
  near('housing_plot', sea[0] * 5 + perp[0] * 4, sea[1] * 5 + perp[1] * 4);
  near('housing_plot', sea[0] * 5 + perp[0] * 8, sea[1] * 5 + perp[1] * 8);
  near('housing_plot', sea[0] * 5 - perp[0] * 4, sea[1] * 5 - perp[1] * 4);
  near('dive', sea[0] * 8, sea[1] * 8);
  near('wench_hut', sea[0] * 8 + perp[0] * 5, sea[1] * 8 + perp[1] * 5);
  // starting stock
  const saw = g.findBuilding('sawmill');
  if (saw) saw.inv.lumber = 60;
  for (const b of g.buildings.values()) if (b.def === 'corn_farm') b.inv.corn = 20;
  const chuck = g.findBuilding('chuck_tent');
  if (chuck) (chuck.inv.slop = 30), (chuck.inv.corn = 20);
  // people
  const s = g.settings;
  const nCaptives = { botany_bay: 40, standard: 28, shipwreck: 24, skeleton_island: 22, bare_bones: 14 }[s.advantage];
  const nPirates = { botany_bay: 18, standard: 14, shipwreck: 13, skeleton_island: 13, bare_bones: 9 }[s.advantage];
  const home = palace.door;
  for (let i = 0; i < nCaptives; i++) createPerson(g, 'captive', home[0] + g.rng.int(-3, 3), home[1] + g.rng.int(-3, 3));
  // skilled bonus from background
  const bonus: Record<string, string[]> = {
    decayed_gentleman: ['trader'], master_gunner: ['engineer'], procurer: ['wench', 'wench', 'courtesan'], shipwright: ['shipwright', 'shipwright'],
    sugar_planter: ['distiller', 'farmer'], tobacco_planter: ['tobacconist', 'farmer'],
  };
  const extra = [...(bonus[g.king.bg] ?? [])];
  if (s.advantage === 'botany_bay') extra.push('shipwright', 'server', 'cook');
  if (!extra.includes('shipwright')) extra.push('shipwright');
  for (const job of extra) {
    const p = createPerson(g, 'captive', home[0], home[1], { skilled: job as any });
    void p;
  }
  if (s.advantage === 'skeleton_island') for (let i = 0; i < 10; i++) g.graveyard.push({ name: `Old Bones ${i + 1}`, nat: 'eng' });
  for (let i = 0; i < nPirates; i++) createPerson(g, 'pirate', home[0] + g.rng.int(-4, 4), home[1] + g.rng.int(-4, 4));
  const startShip = g.settings.startShip ?? 'snow';
  if (dock) dock.inv.ration = 30;
  if (dock && startShip !== 'none') {
    const d = SHIPS[startShip];
    const ship = createShip(g, startShip, dock);
    ship.rations = d.rations;
    ship.cannons = d.cannons;
    ship.cutlasses = d.cutlasses;
    ship.muskets = Math.round(d.muskets * 0.6);
    const cap = createCaptain(g, dock.door[0], dock.door[1]);
    ship.captain = cap.id;
    cap.ship = ship.id;
    // muster a crew straight away so the first cruise can sail on day one
    assignCrews(g);
  }
  g.events.push({ type: 'roads' });
}
