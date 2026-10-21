import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import type { Fact } from '../src/sim/types';

const KIDD = KINGS.find((k) => k.id === 'kidd')!;

const facts = (g: Game, title: string): Fact[] => {
  const m = [...g.messages].reverse().find((x) => x.title === title);
  expect(m, title).toBeTruthy();
  expect(m!.data?.kind, title).toBe('event');
  return m!.data!.kind === 'event' ? m!.data!.facts : [];
};

describe('letters carry what they report', () => {
  it('edict letters: the edict, its cost and its effects', () => {
    const g = new Game({ seed: 3 }, KIDD);
    g.treasury = 99999;
    expect(g.cmd({ type: 'edict', id: 'curfew' }).ok).toBe(true);
    expect(facts(g, 'Edict Issued')).toEqual([{ t: 'edict', id: 'curfew', on: true, nat: undefined }, { t: 'gold', n: -750 }]);
    expect(g.cmd({ type: 'edict', id: 'festival' }).ok).toBe(true);
    expect(facts(g, 'Pirate Festival!').map((f) => f.t)).toEqual(['gold', 'mood']);
    expect(g.cmd({ type: 'edict', id: 'peace', nation: 'eng' }).ok).toBe(true);
    expect(facts(g, 'Peace Announced')).toContainEqual({ t: 'nation', nat: 'eng', rel: 12, stance: 'peace' });
  });

  it('the game-over letter carries the score', () => {
    const g = new Game({ seed: 3 }, KIDD);
    g.endGame(false, 'Overthrown.');
    const [f] = facts(g, 'Game Over');
    expect(f.t).toBe('score');
    if (f.t === 'score') expect(f.total).toBe(g.over!.score.total);
  });

  it('attaching the facts changes nothing in the simulation', () => {
    // two identical games stay identical whether or not anyone looks at the letters
    const a = new Game({ seed: 11 }, KIDD), b = new Game({ seed: 11 }, KIDD);
    for (let i = 0; i < 30; i++) {
      a.run(MONTH / 10);
      b.run(MONTH / 10);
      // b's letters lose their facts as soon as they are written
      for (const m of b.messages) delete m.data;
    }
    expect(a.messages.some((m) => m.data)).toBe(true);
    expect(a.messages.map((m) => [m.title, m.text])).toEqual(b.messages.map((m) => [m.title, m.text]));
    expect(a.treasury).toBe(b.treasury);
    expect([...a.people.values()].map((p) => [p.x, p.y, p.happiness])).toEqual([...b.people.values()].map((p) => [p.x, p.y, p.happiness]));
  });
});
