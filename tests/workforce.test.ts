import { describe, it, expect } from 'vitest';
import { Game } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { createPerson } from '../src/sim/people';
import { placeBuilding, findSpot } from '../src/sim/placement';
import { BUILDING } from '../src/sim/data/buildings';
import { workforce } from '../src/sim/workforce';
import type { Building, Person } from '../src/sim/types';

const KIDD = KINGS.find((k) => k.id === 'kidd')!;

/**
 * A bare island: the palace (four guard posts), a Smuggler's Dive (two servers and a cook, women only, and a
 * hauler), a Gunsmithy (two skilled gunsmiths and a hauler), a corn farm (four farmers, one already at work and one
 * place closed, and an overseer's post) and a second corn farm still being built.
 */
function island() {
  const g = new Game({ seed: 3 }, KIDD);
  g.cmd({ type: 'cheat', code: 'freebuild' });
  g.people.clear();
  g.ships.clear();
  const pal = g.findBuilding('palace')!;
  for (const b of [...g.buildings.values()]) if (b !== pal) g.buildings.delete(b.id);
  pal.guards = [];
  pal.wage = 2;
  pal.priority = 5;
  const put = (def: string, prio: number, instant = true): Building => {
    const spot = findSpot(g, BUILDING[def], pal.x, pal.y, 60)!;
    const b = placeBuilding(g, BUILDING[def], spot, instant);
    b.priority = prio;
    b.wage = 2;
    return b;
  };
  const dive = put('dive', 5);
  const guns = put('gunsmithy', 4);
  const farm = put('corn_farm', 3);
  const site = put('corn_farm', 5, false);
  const [x, y] = pal.door;
  const cap = (sex: 'M' | 'F', skilled?: 'carpenter'): Person => createPerson(g, 'captive', x, y, { sex, skilled });
  const woman = cap('F');
  const farmer = cap('M');
  farmer.job = farm.id;
  farmer.jobRole = 'farmer';
  farm.workers.push(farmer.id);
  cap('M');
  cap('M');
  const carpenter = cap('M', 'carpenter');
  cap('M').rebel = true;
  g.cmd({ type: 'blockSlot', id: farm.id, delta: 1, row: 0 });
  const pir = (): Person => createPerson(g, 'pirate', x, y);
  for (let i = 0; i < 3; i++) pir().mood = 'ok';
  pir().mood = 'disgruntled';
  const captain = pir();
  captain.mood = 'ok';
  captain.captain = true;
  return { g, pal, dive, guns, farm, site, woman, carpenter };
}

describe('workforce', () => {
  it('counts the idle, the open places and the gap for captives', () => {
    const { g, guns, farm, dive, site } = island();
    expect(site.built).toBeLessThan(1);
    const c = workforce(g).captive;
    expect({ total: c.total, employed: c.employed, idle: c.idle, unable: c.unable }).toEqual({ total: 6, employed: 1, idle: 4, unable: 1 });
    // dive 2 + 1 + hauler 1, gunsmithy 2 + hauler 1, farm 4 − 1 at work − 1 closed; nothing at the building site
    expect(c.open).toBe(9);
    // the woman serves, two men haul; the second server and the cook want women, the gunsmiths skilled men,
    // and the farm's two places wait in vain: the carpenter has no trade here
    expect(c.fill).toBe(3);
    expect(c.short).toBe(6);
    expect(c.skilledShort).toBe(2);
    expect(c.spare).toBe(1);
    expect(c.wanting).toEqual([
      { id: dive.id, def: 'dive', missing: 2, n: 1 },
      { id: guns.id, def: 'gunsmithy', missing: 2, n: 1 },
      { id: farm.id, def: 'corn_farm', missing: 2, n: 1 },
    ]);
  });

  it('counts pirates on shore posts, and unpaid posts are not open', () => {
    const { g, pal, farm } = island();
    let p = workforce(g).pirate;
    expect({ total: p.total, employed: p.employed, idle: p.idle, unable: p.unable }).toEqual({ total: 5, employed: 1, idle: 3, unable: 1 });
    // four palace guards and the farm's overseer
    expect(p.open).toBe(5);
    expect({ fill: p.fill, short: p.short, spare: p.spare }).toEqual({ fill: 3, short: 2, spare: 0 });
    // the palace is hired first: three guards and one post short, then the farm's overseer
    expect(p.wanting).toEqual([{ id: pal.id, def: 'palace', missing: 1, n: 1 }, { id: farm.id, def: 'corn_farm', missing: 1, n: 1 }]);
    pal.wage = 0;
    p = workforce(g).pirate;
    expect({ open: p.open, short: p.short, spare: p.spare }).toEqual({ open: 1, short: 0, spare: 2 });
    expect(p.wanting).toEqual([]);
  });

  it('agrees with what the next hiring pass does', () => {
    const { g } = island();
    // moods are worked out afresh as time passes: begin with every pirate willing
    for (const q of g.people.values()) if (q.kind === 'pirate') q.mood = 'ok';
    const before = workforce(g);
    g.run(3.2);
    const after = workforce(g);
    expect(after.captive.employed).toBe(before.captive.employed + before.captive.fill);
    expect(after.captive.open).toBe(before.captive.short);
    expect(after.pirate.open).toBe(before.pirate.short);
  });
});
