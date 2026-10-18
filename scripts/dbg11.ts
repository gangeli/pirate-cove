import { Game } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
const g = new Game({ seed: 1 }, KINGS[15]);
const bot = new Bot(g);
for (let i = 0; i < 1500 * 14; i++) { g.step(); bot.step(); g.events.length = 0; }
const y = g.findBuilding('boatyard')!;
console.log('yard', y.x, y.y, y.w, y.h, 'rot', y.rot, 'door', y.door, 'walk', g.map.isWalkable(...y.door), 'blocked', g.pf.blocked[g.map.idx(...y.door)], 'ship', JSON.stringify(y.building_ship));
const sw = g.people.get(y.workers[0])!;
console.log('sw at', sw.x.toFixed(1), sw.y.toFixed(1), 'task', JSON.stringify(sw.task));
const path = g.pf.find(Math.floor(sw.x), Math.floor(sw.y), y.door[0], y.door[1]);
console.log('path', path ? path.length : null);
const pal = g.findBuilding('palace')!;
console.log('palace->yard', g.pf.find(pal.door[0], pal.door[1], y.door[0], y.door[1])?.length);
const m = g.map, n = m.size;
for (let dy = -2; dy <= 2; dy++) {
  let row = '';
  for (let dx = -3; dx <= 3; dx++) {
    const x = y.door[0] + dx, yy = y.door[1] + dy, k = m.idx(x, yy);
    row += (m.occupied[k] ? 'B' : m.path[k] ? '=' : !m.isWalkable(x, yy) ? '~' : '.') + (g.pf.cost(k) === Infinity ? '!' : ' ');
  }
  console.log(row);
}
// flood fill from palace door
const seen = new Uint8Array(n * n); const q = [m.idx(pal.door[0], pal.door[1])]; seen[q[0]] = 1;
for (let h = 0; h < q.length; h++) { const c = q[h]; for (const d of [1, -1, n, -n]) { const k = c + d; if (!seen[k] && g.pf.cost(k) !== Infinity) { seen[k] = 1; q.push(k); } } }
console.log('reachable tiles', q.length, 'door reachable', !!seen[m.idx(y.door[0], y.door[1])]);
const pth = g.pf.find(pal.door[0], pal.door[1], y.door[0], y.door[1], 200000);
console.log('with big budget', pth?.length);
let onroad = 0;
for (let i = 0; i < n * n; i++) if (m.path[i] && m.occupied[i]) { onroad++; if (onroad < 5) console.log('road under', g.buildings.get(m.occupied[i])?.def, i % n, Math.floor(i / n)); }
console.log('road tiles under buildings', onroad);
for (const b of g.buildings.values()) if (Math.abs(b.x - 106) < 4 && Math.abs(b.y - 50) < 4) console.log('near', b.def, b.x, b.y, b.w, b.h, b.id);
