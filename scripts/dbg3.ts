import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
const g = new Game({ seed: 1 });
const bot = new Bot(g);
let lastDeaths = 0;
for (let i = 0; i < 6 * 1500; i++) {
  g.step(); bot.step();
  if (g.stats.deaths !== lastDeaths && g.stats.deaths < 30) {
    for (const e of g.events) if (e.type === 'death') console.log(g.date, 'death', e.cause, g.people.get(e.id)?.kind, g.people.get(e.id)?.name);
    lastDeaths = g.stats.deaths;
  }
  g.events.length = 0;
  if (i % 750 === 0) for (const s of g.ships.values()) console.log(g.date, s.name, s.status, s.mission, 'rations', s.rations.toFixed(1), 'v', s.voyage ? `t=${s.voyage.t.toFixed(0)} out=${s.voyage.out.toFixed(0)} st=${s.voyage.station.toFixed(0)} homeAt=${(s.voyage as any).homeAt}` : '-', 'ret', s.returnDock, 'dock', s.dock, 'crew', s.crew.length);
}
console.log('deaths', g.stats.deaths);
