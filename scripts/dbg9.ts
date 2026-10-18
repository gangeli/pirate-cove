import { Game } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { BUILDING } from '../src/sim/data/buildings';
const g = new Game({ seed: +(process.argv[2] ?? 2) }, KINGS[15]);
const bot = new Bot(g);
const months = +(process.argv[3] ?? 17);
for (let i = 0; i < 1500 * months; i++) { g.step(); bot.step(); g.events.length = 0; }
const want = (process.argv[4] ?? 'dock,ration_factory,corn_farm,chuck_tent,brewery').split(',');
for (const b of g.buildings.values()) if (want.includes(b.def))
  console.log(b.def, b.id, 'built', b.built.toFixed(2), 'prio', b.priority, 'inv', JSON.stringify(Object.fromEntries(Object.entries(b.inv).map(([k, v]) => [k, Math.round(v!)]))), 'w', b.workers.map((id) => g.people.get(id)?.jobRole + ':' + g.people.get(id)?.task.kind).join(','), 'h', b.haulers.map((id) => { const p = g.people.get(id)!; return p.task.kind + '>' + (p.task.good ?? '') + (p.carrying ? '*' : ''); }).join(','), 'prog', b.progress.toFixed(2), 'staff', b.staff.toFixed(2));
const caps = g.captives();
console.log('captives', caps.length, 'unemployed', caps.filter((c) => !c.job).length, 'F', caps.filter((c) => c.sex === 'F').length);
const jobs: Record<string, number> = {};
for (const c of caps) jobs[(c.jobRole ?? 'none') + '@' + (c.job ? g.buildings.get(c.job)!.def : '')] = (jobs[(c.jobRole ?? 'none') + '@' + (c.job ? g.buildings.get(c.job)!.def : '')] ?? 0) + 1;
console.log(JSON.stringify(jobs));
