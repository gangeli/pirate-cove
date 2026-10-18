import { Game } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
const g = new Game({ seed: 1 }, KINGS[15]);
const bot = new Bot(g);
for (let i = 0; i < 1500 * 14; i++) { g.step(); bot.step(); g.events.length = 0; }
for (const b of g.buildings.values()) if (['dock', 'ration_factory', 'construction_tent', 'wench_hut', 'animal_pit', 'dive', 'timber_camp', 'sawmill'].includes(b.def))
  console.log(b.def, b.id, 'built', b.built.toFixed(2), 'inv', JSON.stringify(b.inv), 'w', b.workers.map((id) => g.people.get(id)?.jobRole + ':' + g.people.get(id)?.task.kind), 'h', b.haulers.map((id) => g.people.get(id)?.task.kind + '>' + g.people.get(id)?.task.good), 'prog', b.progress.toFixed(2));
console.log('unemployed', g.captives().filter((c) => !c.job).length, 'of', g.captives().length);
for (const s of g.ships.values()) console.log('ship', s.status, s.rations, s.crew.length, s.mission);
