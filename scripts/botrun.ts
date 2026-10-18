// npx tsx scripts/botrun.ts [seed] [years] [advantage]
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { computeScore } from '../src/sim/score';
const seed = +(process.argv[2] ?? 1), years = +(process.argv[3] ?? 5), adv = (process.argv[4] ?? 'standard') as any;
const g = new Game({ seed, advantage: adv, years: Math.max(years, 10) }, KINGS[+(process.env.KING ?? 15)]);
const bot = new Bot(g, { verbose: !!process.env.V });
const t0 = Date.now();
for (let m = 0; m < years * 12 && !g.over; m++) {
  const n = Math.round(MONTH / 0.1);
  for (let i = 0; i < n && !g.over; i++) {
    g.step();
    bot.step();
    g.events.length = 0;
  }
  if (m % 3 === 2 || g.over) {
    const pir = g.pirates(), cap = g.captives();
    const inc = Object.values(g.finance.lastIncome).reduce((a, b) => a + b, 0), exp = Object.values(g.finance.lastExpense).reduce((a, b) => a + b, 0);
    const venues = [...g.buildings.values()].filter((b) => ['dive', 'wench_hut', 'animal_pit', 'tavern', 'gambling_den', 'brothel'].includes(b.def)).length;
    const opin = (k: string) => (pir.length ? pir.reduce((a, p) => a + (p.opinion[k] ?? 0), 0) / pir.length : 0).toFixed(2);
    console.log(`${g.date.padEnd(15)} gold ${Math.round(g.treasury).toString().padStart(6)} hoard ${Math.round(g.hoard).toString().padStart(6)} lum ${g.lumber().toString().padStart(4)} | pir ${pir.length} (sea ${pir.filter((p) => p.task.kind === 'atsea').length}) cap ${cap.length} ships ${g.ships.size} bld ${g.buildings.size} ven ${venues} | hap ${g.avgHappiness().toFixed(2)} res ${g.avgResignation().toFixed(2)} | inc ${Math.round(inc)} exp ${Math.round(exp)} | f ${opin('feast')} d ${opin('drink')} c ${opin('company')} g ${opin('gamble')} r ${opin('rest')} s ${opin('stash')} | esc ${g.stats.escapes} dead ${g.stats.deaths}`);
  }
}
console.log('bot skips', JSON.stringify(bot.skips));
console.log('income cats', JSON.stringify(g.finance.lastIncome), 'expense', JSON.stringify(g.finance.lastExpense));
console.log('stats', JSON.stringify(g.stats), 'over', g.over?.reason ?? 'no');
console.log('score', JSON.stringify(computeScore(g)));
console.log('nations', JSON.stringify(Object.fromEntries(Object.entries(g.nations).map(([k, v]) => [k, { rel: Math.round(v.relation), knows: v.knows, inv: v.invasion.stage }]))));
console.log(`sim ${years}y in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (process.env.LOG) for (const m of g.messages) if (/Returns|Lost|Mutiny|Sails|Anchors/.test(m.title)) console.log(m.date, '|', m.title, '|', m.text.replace(/\n+/g, ' / ').slice(0, 400));
{
  const all = g.messages.filter((m) => /Returns$/.test(m.title)).map((m) => m.text).join('\n');
  const c = (re: RegExp) => (all.match(re) ?? []).length;
  console.log('voyages', g.messages.filter((m) => m.title === 'Anchors Aweigh').length, 'returns', g.messages.filter((m) => /Returns$/.test(m.title)).length, 'lost', g.messages.filter((m) => m.title === 'Ship Lost!' || m.title === 'Mutiny!').length,
    '| won', c(/: (Took|Sank) a/g), 'fled', c(/cut and ran/g), 'avoided', c(/kept their distance|slipped away|Fled from/g), 'draw', c(/Traded broadsides/g), 'raids', c(/Raided/g), 'kidnaps', c(/Snatched/g), 'explore', c(/Charted/g));
  const golds = [...all.matchAll(/bringing (\d+) gold/g)].map((m) => +m[1]);
  console.log('gold per return', golds.length ? Math.round(golds.reduce((a, b) => a + b, 0) / golds.length) : 0, 'max', Math.max(0, ...golds));
}
