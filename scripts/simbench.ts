// Sim benchmark: one bot game, prints steps/sec per year and a determinism fingerprint.
// npx tsx scripts/simbench.ts [seed] [years]
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { createHash } from 'node:crypto';
const seed = +(process.argv[2] ?? 1), years = +(process.argv[3] ?? 6);
const g = new Game({ seed, years: years + 1 }, KINGS.find((k) => k.id === 'kidd')!);
const bot = new Bot(g, { policy: {} });
const perYear = Math.round((12 * MONTH) / 0.1);
const h = createHash('sha1');
let simT = 0, botT = 0;
const t00 = performance.now();
for (let y = 0; y < years && !g.over; y++) {
  let st = 0, bt = 0;
  for (let i = 0; i < perYear && !g.over; i++) {
    const a = performance.now(); g.step(); const b = performance.now(); bot.step(); const c = performance.now();
    st += b - a; bt += c - b;
    g.events.length = 0;
    if (i % 600 === 0) {
      let s = 0; for (const p of g.people.values()) s += p.x * 7 + p.y * 13 + p.happiness;
      h.update(`${g.time.toFixed(1)}|${g.treasury.toFixed(4)}|${g.hoard.toFixed(4)}|${g.people.size}|${g.buildings.size}|${s.toFixed(6)}`);
    }
  }
  simT += st; botT += bt;
  console.log(`y${y + 1} people ${g.people.size} bld ${g.buildings.size} sim ${(perYear / (st / 1000)).toFixed(0)} steps/s (${(st / perYear).toFixed(3)} ms/step) bot ${(bt / perYear).toFixed(3)} ms/step`);
}
console.log(`total ${((performance.now() - t00) / 1000).toFixed(1)}s sim ${(simT / 1000).toFixed(1)}s bot ${(botT / 1000).toFixed(1)}s over=${g.over?.reason ?? '-'} treas ${g.treasury.toFixed(2)} hoard ${g.hoard.toFixed(2)}`);
console.log('fingerprint', h.digest('hex'), JSON.stringify(g.stats));
