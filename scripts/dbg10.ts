import { Game } from '../src/sim/game';
import { BUILDING } from '../src/sim/data/buildings';
import { KINGS } from '../src/sim/data/kings';
const g = new Game({ seed: 1 }, KINGS[15]);
console.log('shipwright?', g.hasProfession('shipwright'), g.captives().filter((c) => c.skilled).map((c) => c.profession));
console.log('missing', g.missingReqs(BUILDING.boatyard));
