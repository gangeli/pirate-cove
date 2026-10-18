import { Game, MONTH } from '../src/sim/game';
import { BUILDING } from '../src/sim/data/buildings';
const g = new Game({ seed: 1 });
g.run(MONTH * 1.5);
for (const b of g.buildings.values()) {
  const def = BUILDING[b.def];
  const ws = b.workers.map((id) => { const p = g.people.get(id)!; return `${p.jobRole}:${p.task.kind}/${p.task.phase}@${p.task.bld}${p.skilled ? '*' : ''}`; });
  const hs = b.haulers.map((id) => { const p = g.people.get(id)!; return `${p.task.kind}/${p.task.phase}`; });
  console.log(b.id, b.def, 'staff', b.staff.toFixed(2), 'prog', b.progress.toFixed(2), 'W', ws.join(','), 'H', hs.join(','), 'ov', b.overseer, 'gd', b.guards.length, 'cust', b.customers.length);
}
const idle = g.captives().filter((c) => !c.job).map((c) => `${c.sex}${c.skilled ? '*' + c.profession : ''}`);
console.log('unemployed', idle);
