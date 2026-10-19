import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { PRESETS } from '../src/sim/presets';
import { computeScore } from '../src/sim/score';
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
