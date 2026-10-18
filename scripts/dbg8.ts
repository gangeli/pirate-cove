import { Game } from '../src/sim/game';
import { BUILDING } from '../src/sim/data/buildings';
import { findSpot, canPlace } from '../src/sim/placement';
import { KINGS } from '../src/sim/data/kings';
for (const seed of [1, 2, 3, 4]) {
  const g = new Game({ seed }, KINGS[15]);
  const d = g.findBuilding('dock')!;
  const pl = findSpot(g, BUILDING.boatyard, d.door[0], d.door[1], 45);
  const hist: Record<string, number> = {};
  for (let dy = -25; dy <= 25; dy++) for (let dx = -25; dx <= 25; dx++) for (let r = 0; r < 4; r++) {
    const res = canPlace(g, BUILDING.boatyard, d.door[0] + dx, d.door[1] + dy, r);
    hist[res.ok ? 'OK' : res.reason!] = (hist[res.ok ? 'OK' : res.reason!] ?? 0) + 1;
  }
  console.log(seed, pl ? 'found' : 'NONE', JSON.stringify(hist));
}
