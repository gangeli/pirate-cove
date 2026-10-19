// One bot game -> JSON on stdout. npx tsx scripts/rungame.ts '<json {seed, years, policy, settings, king}>'
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { computeScore } from '../src/sim/score';
const a = JSON.parse(process.argv[2] ?? '{}');
const years = a.years ?? 10;
const king = KINGS.find((k) => k.id === (a.king ?? 'kidd'))!;
const g = new Game({ seed: a.seed ?? 1, years, ...(a.settings ?? {}) }, king);
const bot = new Bot(g, { policy: a.policy ?? {} });
const n = Math.round((years * 12 * MONTH) / 0.1) + 20;
for (let i = 0; i < n && !g.over; i++) {
  g.step();
  bot.step();
  g.events.length = 0;
}
const sc = g.over?.score ?? computeScore(g);
console.log(JSON.stringify({
  seed: a.seed, score: sc.total, parts: sc, win: g.over ? g.over.win : null, reason: g.over?.reason ?? 'unfinished', years: +g.yearsElapsed.toFixed(2),
  hoard: Math.round(g.hoard), treasury: Math.round(g.treasury), pirates: g.pirates().length, captives: g.captives().length, ships: g.ships.size,
  hap: +g.avgHappiness().toFixed(3), res: +g.avgResignation().toFixed(3), difficulty: g.difficulty, stats: g.stats,
}));
