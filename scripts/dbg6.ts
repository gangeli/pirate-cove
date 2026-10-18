import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
const g = new Game({ seed: 1 }, KINGS[15]);
const bot = new Bot(g);
for (let m = 0; m < 14; m++) {
  for (let i = 0; i < 1500; i++) { g.step(); bot.step(); g.events.length = 0; }
  for (const s of g.ships.values()) console.log(g.date, s.name, s.status, s.mission, 'hull', s.hull.toFixed(2), 'rat', s.rations.toFixed(1), 'crew', s.crew.length, 'cap', s.captain, g.people.get(s.captain)?.task.kind, 'v', s.voyage ? `t=${s.voyage.t.toFixed(0)} out=${s.voyage.out.toFixed(0)} home=${(s.voyage as any).homeAt}` : '-', 'ret', s.returnDock, 'path', s.pathI, s.voyagePath?.length);
}
for (const m of g.messages) if (m.kind !== 'advisor') console.log(m.date, m.title, m.text.slice(0, 120).replace(/\n/g, ' '));
