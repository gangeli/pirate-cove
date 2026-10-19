// Why are pirates unhappy? One bot game, yearly mood breakdown.  npx tsx scripts/moodlog.ts [seed] [years] [preset]
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { PRESETS } from '../src/sim/presets';
import { pirateFactors } from '../src/sim/people';
const seed = +(process.argv[2] ?? 101), years = +(process.argv[3] ?? 6);
const pr = PRESETS.find((p) => p.id === (process.argv[4] ?? 'brethren'))!;
const g = new Game({ seed, region: 6, ...pr.settings, years }, KINGS.find((k) => k.id === 'kidd')!);
const bot = new Bot(g, {});
let next = 0;
const steps = Math.round((years * 12 * MONTH) / 0.1);
for (let i = 0; i < steps && !g.over; i++) {
  g.step(); bot.step(); g.events.length = 0;
  if (g.time >= next) {
    next += MONTH * 6;
    const pir = g.pirates().filter((p) => p.task.kind !== 'atsea');
    const f: Record<string, number> = {};
    for (const p of pir) for (const [k, v] of Object.entries(pirateFactors(g, p))) f[k] = (f[k] ?? 0) + v / pir.length;
    const hap = pir.reduce((a, p) => a + p.happiness, 0) / Math.max(1, pir.length);
    const gold = pir.reduce((a, p) => a + p.gold, 0) / Math.max(1, pir.length);
    const fun = [...g.buildings.values()].filter((b) => ['dive', 'tavern', 'wench_hut', 'eatery', 'gambling_den', 'brothel', 'inn', 'casino', 'animal_pit', 'chuck_tent', 'bunkhouse'].includes(b.def)).map((b) => b.def[0] + b.def[1]).join('');
    const fin = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => Math.abs(v) > 0.5).map(([k, v]) => `${k}:${Math.round(v)}`).join(',');
    console.log(`   in {${fin(g.finance.lastIncome)}} out {${fin(g.finance.lastExpense)}} ships ${g.ships.size} ${[...g.ships.values()].map((s) => s.type + '/' + s.status + '/' + s.mission).join(' ')} hoard ${Math.round(g.hoard)}`);
    console.log(`y${g.yearsElapsed.toFixed(1)} pir ${g.pirates().length} ashore ${pir.length} hap ${hap.toFixed(2)} red ${(pir.filter((p) => p.happiness < 0.3).length / Math.max(1, pir.length)).toFixed(2)} coup ${g.unrest.coupMonths} gold/p ${gold.toFixed(0)} treas ${Math.round(g.treasury)} | ${Object.entries(f).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ')} | ${fun}`);
  }
}
console.log('end', g.over?.reason ?? 'alive', 'years', g.yearsElapsed.toFixed(1));
