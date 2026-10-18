import { Game, MONTH } from '../src/sim/game';
const g = new Game({ seed: 1 });
for (let m = 0; m < 6; m++) {
  let ate = 0;
  for (let i = 0; i < 1500; i++) {
    g.step();
    g.events.length = 0;
  }
  const caps = g.captives();
  const bl = [...g.buildings.values()].filter((b) => ['chuck_tent', 'corn_farm'].includes(b.def));
  console.log(g.date, 'cap', caps.length, 'food avg', (caps.reduce((a, c) => a + c.needs.food, 0) / caps.length).toFixed(2), 'hp<1', caps.filter((c) => c.hp < 1).length,
    bl.map((b) => `${b.def}[${JSON.stringify(Object.fromEntries(Object.entries(b.inv).map(([k, v]) => [k, Math.round(v!)])))} prog=${b.progress.toFixed(2)} w=${b.workers.length} h=${b.haulers.length} cust=${b.customers.length}]`).join(' '));
  const eating = caps.filter((c) => c.task.kind === 'eat');
  console.log('   eating', eating.length, 'phases', eating.map((c) => c.task.phase).join(''), 'tasks', JSON.stringify(caps.reduce((a, c) => ((a[c.task.kind] = (a[c.task.kind] ?? 0) + 1), a), {} as any)));
  const chuck = g.findBuilding('chuck_tent')!;
  const hauler = g.people.get(chuck.haulers[0]);
  console.log('   chuck hauler', hauler?.task, 'cook', chuck.workers.map((id) => JSON.stringify(g.people.get(id)?.task)));
}
