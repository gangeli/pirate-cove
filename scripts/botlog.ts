// One bot game with its decision log and a periodic economy summary.  npx tsx scripts/botlog.ts [seed] [years] [preset] ['<policy json>']
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { PRESETS } from '../src/sim/presets';
import { BUILDING } from '../src/sim/data/buildings';
const seed = +(process.argv[2] ?? 101), years = +(process.argv[3] ?? 6);
const pr = PRESETS.find((p) => p.id === (process.argv[4] ?? 'brethren'))!;
const policy = process.argv[5] ? JSON.parse(process.argv[5]) : {};
const g = new Game({ seed, region: 6, ...pr.settings, years }, KINGS.find((k) => k.id === 'kidd')!);
const bot = new Bot(g, { policy, verbose: !!process.env.VERBOSE });
let next = 0;
const steps = Math.round((years * 12 * MONTH) / 0.1);
const tot: Record<string, number> = {}, totOut: Record<string, number> = {};
let lastM = -1;
const made: Record<string, number> = {};
for (let i = 0; i < steps && !g.over; i++) {
  g.step(); bot.step();
  for (const e of g.events) if (e.type === 'produced') made[e.good] = (made[e.good] ?? 0) + 1;
  g.events.length = 0;
  if (g.monthIndex !== lastM) {
    lastM = g.monthIndex;
    for (const [k, v] of Object.entries(g.finance.lastIncome)) tot[k] = (tot[k] ?? 0) + v;
    for (const [k, v] of Object.entries(g.finance.lastExpense)) totOut[k] = (totOut[k] ?? 0) + v;
  }
  if (g.time >= next) {
    next += MONTH * (+(process.env.EVERY ?? 12));
    const caps = g.captives();
    const idle = caps.filter((c) => !c.job).length;
    const unstaffed = [...g.buildings.values()].filter((b) => b.built >= 1 && BUILDING[b.def].workers.length && !b.workers.length).map((b) => b.def);
    const fin = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => Math.abs(v) > 0.5).map(([k, v]) => `${k}:${Math.round(v)}`).join(',');
    console.log(`y${g.yearsElapsed.toFixed(1)} treas ${Math.round(g.treasury)} hoard ${Math.round(g.hoard)} pir ${g.pirates().length} hap ${g.avgHappiness().toFixed(2)} cap ${caps.length} idle ${idle} skilled ${caps.filter((c) => c.skilled).map((c) => c.profession).join(',')} ships ${[...g.ships.values()].map((s) => `${s.type}/${s.status}/${s.mission}/r${Math.floor(s.rations)}c${s.cannons}${s.captain ? "" : "/nocap"}`).join(' ')} rations ${Math.round(g.goodTotal('ration'))}`);
    console.log(`   cum in {${fin(tot)}} out {${fin(totOut)}}`);
    const jobs: Record<string, number> = {};
    for (const c of caps) if (c.job) { const b = g.buildings.get(c.job); if (b) jobs[b.def] = (jobs[b.def] ?? 0) + 1; }
    console.log(`   lumber ${g.lumber()} corn ${Math.round(g.goodTotal('corn'))} jobs ${Object.entries(jobs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`   made ${Object.entries(made).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`   unstaffed ${unstaffed.join(',')} | open ${[...g.ongoing].join(',')} | rel ${Object.entries(g.nations).map(([n, s]) => `${n}:${Math.round(s.relation)}${s.knows ? '!' : ''}`).join(' ')}`);
  }
}
console.log('end', g.over?.reason ?? 'alive', g.over?.score.total ?? '', 'years', g.yearsElapsed.toFixed(1), 'skips', JSON.stringify(bot.skips));
if (process.env.LOG) console.log(bot.log.join('\n'));
