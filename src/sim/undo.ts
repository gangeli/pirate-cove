import type { Game, CmdResult } from './game';
import type { Building, Ship } from './types';
import { BUILDING } from './data/buildings';
import { Terrain } from './map';
import { removeBuilding } from './placement';
import { markBlocked } from './game';

/**
 * Undo for the player's construction commands (build, roads, road removal, demolish, clearing vegetation).
 * Entries live only for the session (not saved). A building can be taken back with a full refund while it is still a
 * construction site; a demolished building comes back as it was (stock, level, settings) if its ground is still free.
 */
export type UndoEntry =
  | { kind: 'build'; id: number; gold: number; lumber: [number, number][]; roads: number[]; label: string }
  | { kind: 'roads'; tiles: number[]; label: string }
  | { kind: 'unroad'; tiles: number[]; label: string }
  | { kind: 'demolish'; snap: Building; label: string }
  | { kind: 'clear'; tiles: [number, number, number][]; label: string; at?: number };

const MAX = 40;

/** a clearing drag sends one command per tile it crosses: those within this many ms of each other are one undo step */
const CLEAR_MERGE_MS = 1500;

export function pushUndo(g: Game, e: UndoEntry): void {
  const top = g.undo[g.undo.length - 1];
  if (e.kind === 'clear') {
    const now = Date.now();
    if (top?.kind === 'clear' && top.at !== undefined && now - top.at < CLEAR_MERGE_MS) {
      // keep each tile's first saved state (its trees before the drag touched it)
      const seen = new Set(top.tiles.map((t) => t[0]));
      for (const t of e.tiles) if (!seen.has(t[0])) top.tiles.push(t);
      top.at = now;
      return;
    }
    e.at = now;
  }
  g.undo.push(e);
  if (g.undo.length > MAX) g.undo.shift();
}

/** what the next undo would revert, for the UI ("Undo: place Tavern") */
export function undoLabel(g: Game): string | null {
  return g.undo.length ? g.undo[g.undo.length - 1].label : null;
}

export function undoLast(g: Game): CmdResult & { label?: string } {
  const e = g.undo[g.undo.length - 1];
  if (!e) return { ok: false, reason: 'Nothing to undo.' };
  const r = apply(g, e);
  // an entry that can no longer be undone is dropped either way, so the next undo reaches older work
  g.undo.pop();
  return { ...r, label: e.label };
}

function apply(g: Game, e: UndoEntry): CmdResult {
  const m = g.map;
  switch (e.kind) {
    case 'build': {
      const b = g.buildings.get(e.id);
      if (!b) return { ok: false, reason: 'That building is already gone.' };
      if (b.built >= 1) return { ok: false, reason: `The ${BUILDING[b.def].name} is finished; demolish it instead.` };
      removeBuilding(g, b);
      g.treasury += e.gold;
      // take it off this month's building bill; a site placed last month (whose bill was already closed) is booked as a refund
      const fromBill = Math.min(e.gold, g.finance.expense.construction ?? 0);
      if (fromBill) g.finance.expense.construction = (g.finance.expense.construction ?? 0) - fromBill;
      if (e.gold > fromBill) g.finance.income.refund = (g.finance.income.refund ?? 0) + e.gold - fromBill;
      const anyMill = () => [...g.buildings.values()].find((x) => x.def === 'sawmill');
      for (const [sid, n] of e.lumber) {
        const s = g.buildings.get(sid) ?? anyMill();
        if (s) s.inv.lumber = (s.inv.lumber ?? 0) + n;
      }
      clearRoads(g, e.roads);
      return { ok: true };
    }
    case 'roads':
      clearRoads(g, e.tiles);
      return { ok: true };
    case 'unroad': {
      let n = 0;
      for (const k of e.tiles) if (!m.path[k] && !m.occupied[k]) (m.path[k] = 1), n++;
      if (n) roadsChanged(g, e.tiles);
      return n ? { ok: true } : { ok: false, reason: 'Something has been built there since.' };
    }
    case 'demolish': {
      const s = e.snap;
      for (let j = s.y; j < s.y + s.h; j++)
        for (let i = s.x; i < s.x + s.w; i++) {
          const k = m.idx(i, j);
          if (m.occupied[k] || m.path[k]) return { ok: false, reason: `The ground where the ${BUILDING[s.def].name} stood is no longer clear.` };
        }
      const b: Building = { ...s, workers: [], haulers: [], guards: [], customers: [], overseer: 0, owner: undefined, inv: { ...s.inv } };
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) m.occupied[m.idx(i, j)] = b.id;
      if (b.ship) {
        // the ship comes back to this dock only if nothing else claimed her meanwhile (another dock, or a berth she is sailing home to)
        const sh = g.ships.get(b.ship) as (Ship & { returnDock?: number }) | undefined;
        const elsewhere = sh && [...g.buildings.values()].some((x) => x.ship === sh.id);
        if (sh && !sh.dock && !sh.returnDock && !elsewhere) sh.dock = b.id;
        else b.ship = 0;
      }
      g.buildings.set(b.id, b);
      g.buildingsChanged();
      markBlocked(g, b);
      g.pf.invalidate();
      g.aura.dirty = true;
      g.events.push({ type: 'placed', id: b.id });
      if (b.built >= 1) g.events.push({ type: 'built', id: b.id });
      g.events.push({ type: 'terrain', x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
      return { ok: true };
    }
    case 'clear': {
      let n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [k, terrain, trees] of e.tiles) {
        if (m.occupied[k] || m.path[k]) continue;
        m.trees[k] = trees;
        m.terrain[k] = terrain;
        n++;
        const x = k % m.size, y = Math.floor(k / m.size);
        x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y);
      }
      if (!n) return { ok: false, reason: 'Something has been built there since.' };
      g.pf.invalidate();
      g.events.push({ type: 'trees', x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      g.events.push({ type: 'terrain', x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
      return { ok: true };
    }
  }
}

/** remove road tiles, keeping any a building's door still needs */
function clearRoads(g: Game, tiles: number[]): void {
  const m = g.map;
  const doors = new Set<number>();
  for (const b of g.buildings.values()) if (!BUILDING[b.def].noRoad) doors.add(m.idx(b.door[0], b.door[1]));
  let n = 0;
  for (const k of tiles) if (m.path[k] && !doors.has(k)) (m.path[k] = 0), n++;
  if (n) roadsChanged(g, tiles);
}

function roadsChanged(g: Game, tiles: number[]): void {
  const m = g.map;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of tiles) {
    const x = k % m.size, y = Math.floor(k / m.size);
    x0 = Math.min(x0, x), y0 = Math.min(y0, y), x1 = Math.max(x1, x), y1 = Math.max(y1, y);
  }
  g.pf.invalidate();
  g.events.push({ type: 'roads' });
  g.events.push({ type: 'terrain', x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
}

/** tiles still holding jungle/trees in a square, with their terrain and tree density, before they are cleared */
export function treeTiles(g: Game, cx: number, cy: number, r: number): [number, number, number][] {
  const m = g.map, out: [number, number, number][] = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (m.inBounds(x, y) && m.trees[m.idx(x, y)]) out.push([m.idx(x, y), m.terrain[m.idx(x, y)] as Terrain, m.trees[m.idx(x, y)]]);
  return out;
}
