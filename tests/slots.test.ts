import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { createPerson } from '../src/sim/people';
import { placeBuilding, findSpot } from '../src/sim/placement';
import { BUILDING } from '../src/sim/data/buildings';
import { closedRows } from '../src/sim/economy';
import type { Building } from '../src/sim/types';

const KIDD = KINGS.find((k) => k.id === 'kidd')!;

/** a Smuggler's Dive (two servers, one cook) at top priority, and plenty of women free to staff it */
function diveGame(): { g: Game; b: Building } {
  const g = new Game({ seed: 3 }, KIDD);
  g.cmd({ type: 'cheat', code: 'freebuild' });
  const pal = g.findBuilding('palace')!;
  const spot = findSpot(g, BUILDING.dive, pal.x, pal.y, 40)!;
  const b = placeBuilding(g, BUILDING.dive, spot, true);
  g.cmd({ type: 'cheat', code: 'freebuild' });
  b.priority = 5;
  for (let i = 0; i < 8; i++) createPerson(g, 'captive', b.door[0], b.door[1], { sex: 'F' });
  return { g, b };
}

const staff = (g: Game, b: Building, job: string) => b.workers.filter((id) => g.people.get(id)?.jobRole === job).length;

describe('closing worker places', () => {
  it('closes the place in the row that was clicked, not the first row with a vacancy', () => {
    const { g, b } = diveGame();
    expect(staff(g, b, 'server') + staff(g, b, 'cook')).toBe(0);
    // close the cook's place (row 1) while both server places (row 0) stand empty
    expect(g.cmd({ type: 'blockSlot', id: b.id, delta: 1, row: 1 }).ok).toBe(true);
    expect(closedRows(g, b)).toEqual([0, 1]);
    g.run(MONTH * 0.5);
    expect(staff(g, b, 'server')).toBe(2);
    expect(staff(g, b, 'cook')).toBe(0);
    // reopen it: the cook is hired
    g.cmd({ type: 'blockSlot', id: b.id, delta: -1, row: 1 });
    expect(closedRows(g, b)).toEqual([0, 0]);
    g.run(MONTH * 0.5);
    expect(staff(g, b, 'cook')).toBe(1);
  });

  it('a row never closes more places than it has, and reopening stops at zero', () => {
    const { g, b } = diveGame();
    g.cmd({ type: 'blockSlot', id: b.id, delta: 5, row: 0 });
    expect(closedRows(g, b)).toEqual([2, 0]);
    g.cmd({ type: 'blockSlot', id: b.id, delta: -9, row: 0 });
    expect(closedRows(g, b)).toEqual([0, 0]);
  });

  it('places closed in the old way are folded into rows exactly as the card showed them', () => {
    const { g, b } = diveGame();
    g.run(MONTH * 0.5);
    expect(staff(g, b, 'server')).toBe(2);
    expect(staff(g, b, 'cook')).toBe(1);
    // an older save: two loose closed places with every place filled close the rightmost of the rows in order
    b.blocked = 2;
    expect(closedRows(g, b)).toEqual([2, 0]);
    g.cmd({ type: 'blockSlot', id: b.id, delta: 1, row: 1 });
    expect(b.blocked).toBe(0);
    expect(b.shut).toEqual([2, 1]);
  });

  it('firing a worker keeps their own place closed', () => {
    const { g, b } = diveGame();
    g.run(MONTH * 0.5);
    const cook = b.workers.find((id) => g.people.get(id)?.jobRole === 'cook')!;
    expect(cook).toBeTruthy();
    g.cmd({ type: 'fire', id: b.id, person: cook });
    expect(closedRows(g, b)).toEqual([0, 1]);
    g.run(MONTH * 0.5);
    expect(staff(g, b, 'cook')).toBe(0);
    expect(staff(g, b, 'server')).toBe(2);
  });
});
