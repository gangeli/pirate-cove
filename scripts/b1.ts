import { Game } from '../src/sim/game';
import { createPerson, createShip, createCaptain } from '../src/sim/people';
import { battle } from '../src/sim/sea';
import { PREY, SHIPS } from '../src/sim/data/ships';
let t = Date.now();
const g = new Game({ seed: 100 });
console.log('game', Date.now() - t); t = Date.now();
const s = createShip(g, 'sloop', null);
console.log('ship', Date.now() - t); t = Date.now();
const cap = createCaptain(g, 5, 5);
console.log('cap', Date.now() - t); t = Date.now();
for (let k = 0; k < 10; k++) { const p = createPerson(g, 'pirate', 5, 5); p.ship = s.id; s.crew.push(p.id); p.task = { kind: 'atsea' }; }
console.log('crew', Date.now() - t); t = Date.now();
s.captain = cap.id; s.voyage = { t: 0, out: 0, station: 0, back: 0, rationRate: 0, events: [], loot: { gold: 0, captives: 0, skilled: [], wealthy: 0, recruits: 0, cannons: 0 }, lost: false, sunk: false, nextEncounter: 0 };
battle(g, s, PREY[1], 'spa');
console.log('battle', Date.now() - t, s.log);
