import type { Game } from './game';

export interface ScoreBreakdown {
  hoard: number;
  happiness: number;
  fleet: number;
  captains: number;
  pirates: number;
  bonusKey: string;
  subtotal: number;
  difficulty: number;
  total: number;
  medal: 'gold' | 'silver' | 'bronze';
}

/** Sandbox score: sum of normalised factors, bonus factor weighted triple, times difficulty. */
export function computeScore(g: Game): ScoreBreakdown {
  const pir = g.pirates();
  const hap = pir.length ? pir.reduce((a, p) => a + p.happiness, 0) / pir.length : 0;
  const parts = {
    hoard: g.hoard * 1.0,
    happiness: hap * 8000,
    fleet: [...g.ships.values()].reduce((a, s) => a + ({ snow: 300, schooner: 450, sloop: 700, brigantine: 1000, frigate: 1800, galleon: 2200 }[s.type]), 0),
    captains: pir.filter((p) => p.captain).length * 800,
    pirates: pir.length * 40,
  };
  const bonusKey = g.settings.bonus;
  const subtotal = parts.hoard + parts.happiness + parts.fleet + parts.captains + parts.pirates + (parts as any)[bonusKey] * 2;
  const total = Math.round(subtotal * g.difficulty);
  return {
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])) as any,
    bonusKey, subtotal: Math.round(subtotal), difficulty: g.difficulty, total,
    medal: total >= 25000 ? 'gold' : total >= 15000 ? 'silver' : 'bronze',
  };
}
