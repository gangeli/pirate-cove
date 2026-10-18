import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';

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
