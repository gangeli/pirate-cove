import { Game, MONTH } from '../src/sim/game';
const g = new Game({ seed: +(process.argv[2] ?? 1) });
const count: Record<string, number> = {};
for (const b of g.buildings.values()) count[b.def] = (count[b.def] ?? 0) + 1;
console.log(JSON.stringify(count), 'ships', g.ships.size, 'pirates', g.pirates().length, 'captives', g.captives().length, 'lumber', g.lumber());
const months = +(process.argv[3] ?? 2);
for (let m = 0; m < months; m++) {
  g.run(MONTH);
  const caps = g.captives();
  const tasks: Record<string, number> = {};
  for (const p of g.people.values()) tasks[p.kind[0] + ':' + p.task.kind] = (tasks[p.kind[0] + ':' + p.task.kind] ?? 0) + 1;
  console.log(g.date, 'gold', Math.round(g.treasury), 'hoard', Math.round(g.hoard), 'lumber', g.lumber(), 'emp', caps.filter((c) => c.job).length + '/' + caps.length,
    'pir', g.pirates().length, 'hap', g.avgHappiness().toFixed(2), 'res', g.avgResignation().toFixed(2), 'food', (caps.reduce((a, c) => a + c.needs.food, 0) / caps.length).toFixed(2), JSON.stringify(tasks));
  console.log('  inv', [...g.buildings.values()].filter((b) => Object.keys(b.inv).length).map((b) => b.def + JSON.stringify(Object.fromEntries(Object.entries(b.inv).map(([k, v]) => [k, Math.round(v!)])))).join(' '));
  const seen = new Map<string, number>();
  for (const msg of g.messages.filter((x) => x.t > g.time - MONTH)) seen.set(msg.title, (seen.get(msg.title) ?? 0) + 1);
  console.log('  MSG', JSON.stringify(Object.fromEntries(seen)));
}
