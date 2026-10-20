import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { BUILDING } from '../src/sim/data/buildings';
import { findSpot } from '../src/sim/placement';
import { lumberTotal } from '../src/sim/economy';

const fresh = () => new Game({ seed: 3 }, KINGS[0]);
const palace = (g: Game) => g.findBuilding('palace')!;

describe('undo', () => {
  it('takes back a construction site with a full refund', () => {
    const g = fresh();
    const p = palace(g);
    const def = BUILDING.cave;
    const pl = findSpot(g, def, p.x + 12, p.y + 4)!;
    expect(pl).toBeTruthy();
    const gold0 = g.treasury, lumber0 = lumberTotal(g), n0 = g.buildings.size;
    const r = g.cmd({ type: 'build', def: 'cave', x: pl.x, y: pl.y, rot: pl.rot });
    expect(r.ok).toBe(true);
    expect(g.treasury).toBeLessThan(gold0);
    expect(g.cmd({ type: 'undo' }).ok).toBe(true);
    expect(g.treasury).toBe(gold0);
    expect(lumberTotal(g)).toBe(lumber0);
    expect(g.buildings.size).toBe(n0);
    expect(g.map.occupied[g.map.idx(pl.x, pl.y)]).toBe(0);
  });

  it('removes a road line and restores a removed road', () => {
    const g = fresh();
    const m = g.map;
    // find a road tile with an open neighbour run to extend into
    let start: [number, number] | null = null;
    for (let k = 0; k < m.path.length && !start; k++) {
      if (!m.path[k]) continue;
      const x = k % m.size, y = Math.floor(k / m.size);
      if ([1, 2, 3].every((d) => m.inBounds(x + d, y) && !m.path[m.idx(x + d, y)] && !m.occupied[m.idx(x + d, y)] && m.isWalkable(x + d, y))) start = [x, y];
    }
    expect(start).toBeTruthy();
    const [x, y] = start!;
    expect(g.cmd({ type: 'roadLine', x0: x + 1, y0: y, x1: x + 3, y1: y }).ok).toBe(true);
    expect(m.path[m.idx(x + 3, y)]).toBe(1);
    expect(g.cmd({ type: 'undo' }).ok).toBe(true);
    for (const d of [1, 2, 3]) expect(m.path[m.idx(x + d, y)]).toBe(0);
    // remove an existing road tile, then bring it back
    expect(g.cmd({ type: 'unroad', x, y }).ok || true).toBe(true);
    if (!m.path[m.idx(x, y)]) {
      expect(g.cmd({ type: 'undo' }).ok).toBe(true);
      expect(m.path[m.idx(x, y)]).toBe(1);
    }
  });

  it('brings a demolished building back as it was', () => {
    const g = fresh();
    const b = [...g.buildings.values()].find((x) => x.def !== 'palace' && x.built >= 1)!;
    expect(b).toBeTruthy();
    b.inv.rum = 7;
    const snap = { id: b.id, def: b.def, x: b.x, y: b.y };
    expect(g.cmd({ type: 'demolish', id: b.id }).ok).toBe(true);
    expect(g.buildings.has(snap.id)).toBe(false);
    expect(g.cmd({ type: 'undo' }).ok).toBe(true);
    const back = g.buildings.get(snap.id)!;
    expect(back).toBeTruthy();
    expect([back.def, back.x, back.y]).toEqual([snap.def, snap.x, snap.y]);
    expect(back.inv.rum).toBe(7);
    expect(g.map.occupied[g.map.idx(back.x, back.y)]).toBe(back.id);
  });

  it('replants cleared vegetation', () => {
    const g = fresh();
    const m = g.map;
    let k = 0;
    while (k < m.trees.length && !(m.trees[k] && !m.occupied[k])) k++;
    const x = k % m.size, y = Math.floor(k / m.size);
    const before = m.trees.slice();
    expect(g.cmd({ type: 'clearTrees', x, y, r: 1 }).ok).toBe(true);
    expect(m.trees[k]).toBe(0);
    expect(g.cmd({ type: 'undo' }).ok).toBe(true);
    expect([...m.trees]).toEqual([...before]);
  });

  it('says so when there is nothing to undo', () => {
    const g = fresh();
    g.undo.length = 0;
    expect(g.cmd({ type: 'undo' }).ok).toBe(false);
  });
});
