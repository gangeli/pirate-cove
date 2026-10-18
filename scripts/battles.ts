import { Game } from '../src/sim/game';
import { createPerson, createShip, createCaptain } from '../src/sim/people';
import { battle } from '../src/sim/sea';
import { PREY, SHIPS, type ShipType } from '../src/sim/data/ships';
import { KINGS } from '../src/sim/data/kings';
const res: Record<string, Record<string, number>> = {};
const g = new Game({ seed: 100 }, KINGS[15]);
for (const type of ["sloop","frigate"] as ShipType[]) {
  for (const prey of PREY) {
    const key = `${type} vs ${prey.id}`;
    const tally: Record<string, number> = { win: 0, lost: 0, draw: 0, escape: 0, dead: 0 };
    for (let i = 0; i < 25; i++) {
      const s = createShip(g, type, null);
      const d = SHIPS[type];
      s.cannons = d.cannons; s.cutlasses = d.cutlasses; s.muskets = d.muskets; s.rations = d.rations; s.orders = 'board';
      const cap = createCaptain(g, 5, 5); s.captain = cap.id; cap.ship = s.id;
      for (let k = 0; k < d.men + d.officers; k++) { const p = createPerson(g, 'pirate', 5, 5); p.ship = s.id; s.crew.push(p.id); p.task = { kind: 'atsea' }; }
      s.voyage = { t: 0, out: 0, station: 0, back: 0, rationRate: 0, events: [], loot: { gold: 0, captives: 0, skilled: [], wealthy: 0, recruits: 0, cannons: 0 }, lost: false, sunk: false, nextEncounter: 0 };
      const before = s.crew.length;
      battle(g, s, prey, 'spa');
      const log = s.log.map((e) => e.text).join(' ');
      if (!g.ships.has(s.id)) tally.lost++;
      else if (/^(Took|Sank)/.test(s.log.at(-1)?.text ?? '')) tally.win++;
      else if (/kept their distance|slipped away|escaped/.test(log)) tally.escape++;
      else tally.draw++;
      tally.dead += before - (g.ships.has(s.id) ? s.crew.length : 0);
    }
    tally.dead = Math.round(tally.dead / 25 * 10) / 10;
    res[key] = tally;
    console.log(key.padEnd(34), JSON.stringify(tally));
  }
}
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(34), JSON.stringify(v));
