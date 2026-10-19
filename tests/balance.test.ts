import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { PRESETS } from '../src/sim/presets';
import { computeScore, medalThresholds } from '../src/sim/score';
import { SHIPS, CAPTAIN_COST } from '../src/sim/data/ships';
import { edictCost } from '../src/sim/edicts';
import { createShip } from '../src/sim/people';
import { launchStores } from '../src/sim/sea';

// Balance invariants: cheap checks that guard the fixes found by playtesting with the bot.
// a ruler with no say over captains' fees
const MARY = KINGS.find((k) => k.id === 'mary')!;
const KIDD = KINGS.find((k) => k.id === 'kidd')!;

describe('venues', () => {
  it('a visitor whose errand is interrupted gives up their seat', () => {
    const g = new Game({ seed: 5 }, KIDD);
    const dive = g.findBuilding('dive')!;
    const p = g.pirates()[0];
    // book a seat, then get called away (a chase, a brawl, the ship's bell) before arriving
    dive.customers.push(p.id);
    p.task = { kind: 'visit', bld: dive.id, need: 'drink', phase: 0 };
    p.task = { kind: 'chase', timer: 40, phase: 1 };
    g.run(4);
    expect(dive.customers).not.toContain(p.id);
  });
});

describe('scoring', () => {
  it('debts come out of the hoard', () => {
    const g = new Game({ seed: 6 }, KIDD);
    g.hoard = 1000;
    g.treasury = 400;
    expect(computeScore(g).hoard).toBe(1000);
    g.treasury = -600;
    expect(computeScore(g).hoard).toBe(400);
  });

  it('a hull that never put to sea is not a fleet', () => {
    const g = new Game({ seed: 7 }, KIDD);
    const s = [...g.ships.values()][0];
    expect(s.captain).toBeTruthy();
    expect(computeScore(g).fleet).toBe(0);
    s.sailed = g.time;
    expect(computeScore(g).fleet).toBeGreaterThan(0);
    // a year later, idle in port, she no longer counts
    s.sailed = g.time - MONTH * 13;
    expect(computeScore(g).fleet).toBe(0);
  });
});

describe('treasury', () => {
  it('upkeep and wages an empty treasury cannot pay go unpaid, not into debt', () => {
    const g = new Game({ seed: 11 }, KIDD);
    g.treasury = 5;
    g.run(MONTH * 1.05);
    expect(g.treasury).toBeGreaterThanOrEqual(0);
    expect(g.effects.neglect ?? 0).toBeGreaterThan(0);
  });
});

describe('ships and captains', () => {
  it("a captain's fee follows the class of ship waiting for him", () => {
    const g = new Game({ seed: 8 }, MARY);
    const dock = g.findBuilding('dock')!;
    dock.ship = 0;
    for (const s of [...g.ships.values()]) g.ships.delete(s.id);
    createShip(g, 'snow', dock);
    const snow = edictCost(g, 'recruit_captain');
    createShip(g, 'galleon', null);
    const galleon = edictCost(g, 'recruit_captain');
    expect(snow).toBe(CAPTAIN_COST.snow);
    expect(galleon).toBe(CAPTAIN_COST.galleon);
    expect(snow).toBeLessThan(galleon);
  });

  it('a marooned colony can afford its first snow and her skipper', () => {
    const pr = PRESETS.find((p) => p.id === 'marooned')!;
    const g = new Game({ seed: 9, region: 6, ...pr.settings }, MARY);
    expect(g.treasury).toBeGreaterThan(CAPTAIN_COST.snow + SHIPS.snow.gold + 250 /* a kidnapping */);
  });

  it('a boatyard hull leaves the slip with some guns; a shipyard hull needs a foundry', () => {
    expect(launchStores('snow').cannons).toBeGreaterThan(0);
    expect(launchStores('sloop').cutlasses).toBeGreaterThan(0);
    expect(launchStores('frigate').cannons).toBe(0);
  });
});

describe('recovery', () => {
  it('a revolt that fails to take the palace burns out within a month', () => {
    const g = new Game({ seed: 12 }, KIDD);
    const caps = g.captives().slice(0, 4);
    for (const c of caps) c.rebel = true;
    g.unrest.rebellion = true;
    g.unrest.rebelSince = g.time;
    g.run(MONTH * 1.2);
    expect(g.unrest.rebellion).toBe(false);
    expect(g.captives().some((c) => c.rebel)).toBe(false);
  });

  it('a shipless island with nobody to build a hull is not stuck for good', () => {
    const g = new Game({ seed: 13 }, KIDD);
    for (const s of [...g.ships.values()]) g.ships.delete(s.id);
    for (const b of g.buildings.values()) b.ship = 0;
    for (const p of [...g.people.values()]) if (p.skilled && p.profession === 'shipwright') g.people.delete(p.id);
    expect(g.hasProfession('shipwright')).toBe(false);
    g.run(MONTH * 18);
    expect(g.hasProfession('shipwright')).toBe(true);
  });

  it('raiding parties spare the towns of a power we are at peace with', () => {
    const g = new Game({ seed: 14 }, KIDD);
    g.treasury = 9999;
    for (const n of ['eng', 'fra'] as const) g.cmd({ type: 'edict', id: 'peace', nation: n });
    const s = [...g.ships.values()][0];
    s.rations = 20;
    expect(g.cmd({ type: 'shipOrders', ship: s.id, mission: 'raid' }).ok).toBe(true);
    expect(g.cmd({ type: 'setSail', ship: s.id }).ok).toBe(true);
    for (let i = 0; i < 20 && !s.log.some((e) => /Raided/.test(e.text)); i++) g.run(MONTH * 0.1);
    expect(s.log.find((e) => /Raided/.test(e.text))?.text).toMatch(/Spanish/);
    expect(g.ongoing.has('peace:eng') && g.ongoing.has('peace:fra')).toBe(true);
  });
});

describe('placement', () => {
  it('a building may not wall off a pocket of the island', () => {
    const g = new Game({ seed: 15 }, KIDD);
    g.cmd({ type: 'cheat', code: 'freebuild' });
    const m = g.map, n = m.size;
    const pal = g.findBuilding('palace')!;
    const free = (x: number, y: number) => m.inBounds(x, y) && !m.occupied[m.idx(x, y)] && !m.path[m.idx(x, y)] && g.pf.cost(m.idx(x, y)) !== Infinity;
    let spot: [number, number] | null = null;
    for (let r = 4; r < 50 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++)
        for (let dx = -r; dx <= r && !spot; dx++) {
          const x = pal.door[0] + dx, y = pal.door[1] + dy;
          const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].every(([i, j]) => free(x + i, y + j));
          if (ok && g.pf.find(pal.door[0], pal.door[1], x, y)) spot = [x, y];
        }
    expect(spot).toBeTruthy();
    const [x, y] = spot!;
    const put = (i: number, j: number) => g.cmd({ type: 'build', def: 'orderly_shrubs', x: x + i, y: y + j, rot: 0 });
    expect(put(1, 0).ok).toBe(true);
    expect(put(-1, 0).ok).toBe(true);
    expect(put(0, 1).ok).toBe(true);
    const last = put(0, -1);
    expect(last.ok).toBe(false);
    expect(last.reason).toMatch(/wall off/);
    void n;
  });
});

describe('medals', () => {
  it('cut-offs grow with the length of the reign, silver below gold', () => {
    let prev = 0;
    for (const years of [10, 20, 30]) {
      const m = medalThresholds(years);
      expect(m.silver).toBeLessThan(m.gold);
      expect(m.silver).toBeGreaterThan(prev);
      prev = m.silver;
    }
  });
});

