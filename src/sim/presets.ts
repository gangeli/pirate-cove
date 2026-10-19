import type { Settings } from './types';

/**
 * Difficulty presets: each fixes the island (map parameters) and the starting conditions; only the seed
 * varies. The difficulty multiplier is calibrated from bot games (scripts/tune.ts calibrate) so that the
 * same quality of play earns about the same final score whichever preset it is played on.
 */
export interface Preset {
  id: string;
  name: string;
  blurb: string;
  settings: Omit<Settings, 'seed' | 'region'> & { region?: number };
}

export const PRESETS: Preset[] = [
  {
    id: 'calm', name: 'Calm Waters',
    blurb: 'A green, well-timbered island, a full treasury, plenty of hands and a sloop at the quay. For learning the ropes.',
    settings: { size: 'large', mountains: 0.2, vegetation: 0.8, minerals: 0.6, years: 20, stability: 1, advantage: 'botany_bay', bonus: 'hoard', startGold: 5000, startShip: 'sloop' },
  },
  {
    id: 'fair', name: 'Fair Winds',
    blurb: 'A friendly island and a fast schooner. Mistakes are forgiven, eventually.',
    settings: { size: 'medium', mountains: 0.5, vegetation: 0.5, minerals: 0.5, years: 20, stability: 2, advantage: 'standard', bonus: 'hoard', startGold: 2500, startShip: 'schooner' },
  },
  {
    id: 'brethren', name: 'Brethren of the Coast',
    blurb: 'The intended game. A modest crew, a little snow to raid and explore with, and everything else to build.',
    settings: { size: 'medium', mountains: 0.5, vegetation: 0.5, minerals: 0.5, years: 20, stability: 3, advantage: 'standard', bonus: 'hoard', startGold: 2500, startShip: 'snow' },
  },
  {
    id: 'marooned', name: 'Marooned',
    blurb: 'No ship at all. Fell timber, raise a boatyard and build your first hull before anyone will call you a pirate.',
    settings: { size: 'medium', mountains: 0.5, vegetation: 0.5, minerals: 0.5, years: 20, stability: 4, advantage: 'standard', bonus: 'hoard', startGold: 1200, startShip: 'none' },
  },
  {
    id: 'hardtack', name: 'Hard Tack',
    blurb: 'A rocky, thinly wooded island, an empty chest and a restless crew. Every plank counts.',
    settings: { size: 'medium', mountains: 0.85, vegetation: 0.25, minerals: 0.5, years: 20, stability: 4, advantage: 'shipwreck', bonus: 'hoard', startGold: 1200, startShip: 'snow' },
  },
];

/**
 * Score multiplier for a set of conditions; harder conditions pay more. Calibrated from bot games
 * (scripts/tune.ts calibrate, default rung weighted double, novice/casual rungs as a check) so that the
 * same quality of play earns about the same final score on every preset: Calm Waters ~0.45, Fair Winds
 * ~0.70, Brethren 1.00, Marooned ~1.30, Hard Tack ~1.70. The length of the reign is not a difficulty:
 * medal cut-offs scale with it instead (score.ts medalThresholds).
 */
export function difficultyOf(s: Settings): number {
  let d = 1;
  d *= [0.85, 0.9, 1, 1.05, 1.1][s.stability - 1] ?? 1;
  d *= { botany_bay: 0.87, standard: 1, shipwreck: 0.95, skeleton_island: 0.9, bare_bones: 1.3 }[s.advantage];
  // timber is the island's lifeblood: a thin forest hurts far more than a thick one helps
  d *= s.vegetation < 0.5 ? 1 + (0.5 - s.vegetation) * 1.6 : 1 - (s.vegetation - 0.5) * 0.5;
  d *= 1 + (s.mountains - 0.5) * 0.3;
  d *= { 1200: 1.1, 2500: 1, 5000: 0.92 }[s.startGold as 1200 | 2500 | 5000] ?? 1;
  d *= { none: 1.13, snow: 1, schooner: 0.78, sloop: 0.9 }[s.startShip ?? 'snow'];
  d *= { small: 1.1, medium: 1, large: 0.95 }[s.size];
  return Math.round(d * 100) / 100;
}
