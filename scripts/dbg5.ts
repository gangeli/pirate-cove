import { Game } from '../src/sim/game';
import { BUILDING } from '../src/sim/data/buildings';
import { findSpot, canPlace, footprint } from '../src/sim/placement';
import { KINGS } from '../src/sim/data/kings';
const g = new Game({ seed: 1 }, KINGS[15]);
const p = g.findBuilding('palace')!;
for (const def of ['cave', 'ration_factory', 'animal_pit', 'housing_plot']) {
  const d = BUILDING[def];
  const pl = findSpot(g, d, p.door[0], p.door[1], 34);
  console.log(def, pl ? `ok at ${pl.x},${pl.y}` : 'NONE');
  // reasons histogram around palace
  const hist: Record<string, number> = {};
  for (let dy = -20; dy <= 20; dy += 2) for (let dx = -20; dx <= 20; dx += 2) {
    const r = canPlace(g, d, p.door[0] + dx, p.door[1] + dy, 0);
    hist[r.ok ? 'OK' : r.reason!] = (hist[r.ok ? 'OK' : r.reason!] ?? 0) + 1;
  }
  console.log('  ', JSON.stringify(hist));
}
let roads = 0; for (const v of g.map.path) roads += v; console.log('road tiles', roads);
