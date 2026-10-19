import type { Game } from './game';
import { SHIPS } from './data/ships';
import { YEAR } from './time';

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

/**
 * Medal cut-offs for the final score of a 20-year reign (difficulty applied). Calibrated from bot games
 * (scripts/tune.ts calibrate): silver is about what a competent reign earns, gold what the best reigns
 * earn; a casual reign is usually bronze.
 */
export const MEDALS = { gold: 25000, silver: 15000 } as const;
/** how the score grows with the length of the reign (the hoard compounds), fitted to bot games */
export const REIGN_GROWTH = 1.6;

/** medal cut-offs for a reign of this many years */
export function medalThresholds(years: number): { gold: number; silver: number } {
  const k = Math.pow(Math.max(1, years) / 20, REIGN_GROWTH);
  const r = (x: number) => Math.round((x * k) / 500) * 500;
  return { gold: r(MEDALS.gold), silver: r(MEDALS.silver) };
}

const SHIP_VALUE = { snow: 300, schooner: 450, sloop: 700, brigantine: 1000, frigate: 1800, galleon: 2200 } as const;

/**
 * Sandbox score: sum of normalised factors, bonus factor weighted triple, times difficulty.
 * Happiness and head-count are averaged over the final year, only crewed, captained ships that have
 * sailed in the final year count, and debts come out of the hoard, so last-minute stunts (a festival on
 * the final day, press-ganging every captive, a harbour full of fresh hulls, spending on credit) do
 * not pay.
 */
export function computeScore(g: Game): ScoreBreakdown {
  const pir = g.pirates();
  const hapNow = pir.length ? pir.reduce((a, p) => a + p.happiness, 0) / pir.length : 0;
  const recent = g.history.slice(-12);
  const hap = recent.length ? (recent.reduce((a, h) => a + h.happiness, 0) + hapNow) / (recent.length + 1) : hapNow;
  const headcount = recent.length ? (recent.reduce((a, h) => a + h.pirates, 0) + pir.length) / (recent.length + 1) : pir.length;
  // a ship counts only if she is captained, crewed, and has put to sea within the last year: a harbour
  // full of hulls launched for the final reckoning is not a fleet
  const seaworthy = [...g.ships.values()].filter((s) => s.captain && g.people.has(s.captain) && s.crew.length >= Math.ceil(SHIPS[s.type].men / 2) && s.sailed !== undefined && g.time - s.sailed < YEAR);
  const parts = {
    // debts are settled out of the hoard at the final reckoning, so spending on credit gains nothing
    hoard: g.hoard + Math.min(0, g.treasury),
    // only contentment above the baseline of a neglected island counts
    happiness: Math.max(0, Math.min(1, (hap - 0.3) / 0.6)) * 8000,
    fleet: seaworthy.reduce((a, s) => a + SHIP_VALUE[s.type], 0),
    captains: seaworthy.length * 800,
    pirates: headcount * 40,
  };
  const bonusKey = g.settings.bonus;
  const subtotal = parts.hoard + parts.happiness + parts.fleet + parts.captains + parts.pirates + (parts as any)[bonusKey] * 2;
  const total = Math.max(0, Math.round(subtotal * g.difficulty));
  const medals = medalThresholds(g.settings.years);
  return {
    ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])) as any,
    bonusKey, subtotal: Math.round(subtotal), difficulty: g.difficulty, total,
    medal: total >= medals.gold ? 'gold' : total >= medals.silver ? 'silver' : 'bronze',
  };
}
