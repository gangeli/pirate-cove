import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { PRESETS, difficultyOf } from '../src/sim/presets';
import { judgement } from '../src/sim/sea';

describe('new game', () => {
  it('sets up a starting island', () => {
    const g = new Game({ seed: 1 });
    const defs = [...g.buildings.values()].map((b) => b.def);
    expect(defs).toContain('palace');
    expect(defs).toContain('stockade');
    expect(defs).toContain('sawmill');
    expect(defs).toContain('dock');
    expect(g.ships.size).toBe(1);
    expect(g.pirates().length).toBeGreaterThan(5);
    expect(g.captives().length).toBeGreaterThan(10);
  });
  it('runs a month without crashing and employs captives', () => {
    const g = new Game({ seed: 2 });
    g.run(MONTH + 1);
    const employed = g.captives().filter((c) => c.job).length;
    expect(employed).toBeGreaterThan(8);
    expect(g.month).toBe(1);
  });
});

describe('starting island', () => {
  it('always has a dock and a ship, whatever the seed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game({ seed });
      expect(g.findBuilding('dock'), `seed ${seed}`).toBeTruthy();
      expect(g.ships.size, `seed ${seed}`).toBe(1);
    }
  });
});

describe('difficulty presets', () => {
  it('every preset starts cleanly, harder presets pay more', () => {
    let prev = 0;
    for (const pr of PRESETS) {
      for (let seed = 1; seed <= 8; seed++) {
        const g = new Game({ seed, region: 6, ...pr.settings });
        expect(g.findBuilding('dock'), `${pr.id} seed ${seed}`).toBeTruthy();
        expect(g.ships.size, `${pr.id} seed ${seed}`).toBe(pr.settings.startShip === 'none' ? 0 : 1);
        expect(g.treasury).toBe(pr.settings.startGold);
      }
      const d = difficultyOf({ seed: 1, region: 6, ...pr.settings });
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
  it('a marooned colony can commission its first hull', () => {
    const g = new Game({ seed: 3, region: 6, ...PRESETS.find((p) => p.id === 'marooned')!.settings });
    expect(g.ships.size).toBe(0);
    expect(g.lumber()).toBeGreaterThanOrEqual(20); // enough timber for a snow once a boatyard stands
  });
});

describe('captains', () => {
  it('judgement grows with voyages and craft', () => {
    const g = new Game({ seed: 2 });
    const cap = g.people.get([...g.ships.values()][0].captain)!;
    cap.skills.seamanship = 2;
    cap.skills.navigation = 2;
    cap.voyages = 0;
    const green = judgement(cap);
    cap.skills.seamanship = 4.6;
    cap.skills.navigation = 4.4;
    cap.voyages = 9;
    expect(green).toBeLessThan(0.2);
    expect(judgement(cap)).toBeGreaterThan(0.9);
  });
});


describe('renaming a ship', () => {
  it('sanitizes and limits the name, and refuses a blank one', () => {
    const g = new Game({ seed: 1 });
    const s = [...g.ships.values()][0];
    expect(g.cmd({ type: 'renameShip', ship: s.id, name: '  Queen\n Anne\'s   <b>Revenge</b> and a very long tail  ' }).ok).toBe(true);
    expect(s.name).toBe('Queen Anne\'s bRevenge/b');
    expect(s.name.length).toBeLessThanOrEqual(24);
    expect(g.cmd({ type: 'renameShip', ship: s.id, name: '   ' }).ok).toBe(false);
    expect(s.name).toBe('Queen Anne\'s bRevenge/b');
  });
});
