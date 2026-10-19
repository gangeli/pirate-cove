// Parallel bot experiments.
//   npx tsx scripts/tune.ts compare [seeds] [years]        -> skill ladder + exploit policies
//   npx tsx scripts/tune.ts search [iters] [seeds] [years]  -> random/coordinate search over Policy knobs
import { spawn } from 'node:child_process';
import { DEFAULT_POLICY, type Policy } from '../src/sim/bot';
const mode = process.argv[2] ?? 'compare';
const J = +(process.env.J ?? 3);

function run(job: object): Promise<any> {
  return new Promise((res) => {
    const p = spawn('npx', ['tsx', 'scripts/rungame.ts', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      try {
        res(JSON.parse(out.trim().split('\n').pop()!));
      } catch {
        res({ score: 0, win: false, reason: 'crash: ' + out.slice(-200) });
      }
    });
  });
}

async function pool<T>(jobs: (() => Promise<T>)[], n = J): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const k = i++;
      out[k] = await jobs[k]();
    }
  }));
  return out;
}

function summarize(name: string, rs: any[]) {
  const sc = rs.map((r) => r.score);
  const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  const sd = Math.sqrt(sc.reduce((a, b) => a + (b - mean) ** 2, 0) / sc.length);
  const lost = rs.filter((r) => r.win === false).length;
  const medals = { gold: rs.filter((r) => r.win && r.score >= 25000).length, silver: rs.filter((r) => r.win && r.score >= 15000 && r.score < 25000).length };
  const reasons = [...new Set(rs.filter((r) => r.win === false).map((r) => r.reason.slice(0, 40)))];
  console.log(`${name.padEnd(14)} mean ${Math.round(mean).toString().padStart(6)} sd ${Math.round(sd).toString().padStart(5)} lost ${lost}/${rs.length} gold ${medals.gold} silver ${medals.silver} hoard ${Math.round(rs.reduce((a, r) => a + (r.hoard ?? 0), 0) / rs.length)} hap ${(rs.reduce((a, r) => a + (r.hap ?? 0), 0) / rs.length).toFixed(2)} ${reasons.join(' | ')}`);
  return { mean, sd, lost };
}

const SEEDS = (n: number) => Array.from({ length: n }, (_, i) => 101 + i * 7);

if (mode === 'compare') {
  const seeds = SEEDS(+(process.argv[3] ?? 6)), years = +(process.argv[4] ?? 10);
  const extra = process.env.POLICY ? JSON.parse(process.env.POLICY) : null;
  const ladder: [string, Partial<Policy>][] = [
    ['idle', { exploit: 'idle' }],
    ['novice', { cadence: 3, sloppy: 0.4, fear: false, priceBias: -1, entertainment: 0.5, shipAt: 4000, festivalAt: 0, peaceAt: -101 }],
    ['casual', { cadence: 1.5, sloppy: 0.2, entertainment: 0.8 }],
    ['default', {}],
    ...(extra ? [['tuned', extra] as [string, Partial<Policy>]] : []),
    ['x:pressgang', { exploit: 'pressgang' }],
    ['x:gouge', { exploit: 'gouge' }],
    ['x:nofun', { exploit: 'nofun' }],
    ['x:nofleet', { exploit: 'nofleet' }],
    ['x:hoard25', { hoardRate: 0.25 }],
  ];
  const only = process.env.ONLY?.split(',');
  for (const [name, pol] of ladder) {
    if (only && !only.includes(name)) continue;
    const rs = await pool(seeds.map((seed) => () => run({ seed, years, policy: pol })));
    summarize(name, rs);
  }
}

if (mode === 'search') {
  const iters = +(process.argv[3] ?? 20), seeds = SEEDS(+(process.argv[4] ?? 4)), years = +(process.argv[5] ?? 6);
  const space: Record<string, (number | string | boolean)[]> = {
    hoardRate: [0.05, 0.1, 0.15, 0.2, 0.25], priceBias: [-1, 0, 1], entertainment: [0.7, 1, 1.3, 1.7], raid: [0.1, 0.3, 0.5],
    shipAt: [900, 1600, 2500], reserve: [200, 400, 800], festivalAt: [0, 0.4, 0.5], peaceAt: [-30, -55, -80], patron: [false, true],
    spoils: ['auto', 'selfish', 'generous'], lumber: [0, 1, 2, 3], caution: [0, 0.5, 1, 2], bigShipAt: [2500, 3500, 6000],
  };
  const evalP = async (pol: Partial<Policy>) => {
    const rs = await pool(seeds.map((seed) => () => run({ seed, years, policy: pol })));
    const sc = rs.map((r) => (r.win === false ? r.score * 0.3 : r.score));
    return sc.reduce((a, b) => a + b, 0) / sc.length;
  };
  let best: Partial<Policy> = {};
  let bestV = await evalP(best);
  console.log('baseline', Math.round(bestV));
  const keys = Object.keys(space);
  for (let it = 0; it < iters; it++) {
    const k = keys[it % keys.length];
    for (const v of space[k]) {
      if ((best as any)[k] === v || (best[k as keyof Policy] === undefined && (DEFAULT_POLICY as any)[k] === v)) continue;
      const cand = { ...best, [k]: v };
      const val = await evalP(cand);
      console.log(`  ${k}=${v} -> ${Math.round(val)}${val > bestV ? '  *' : ''}`);
      if (val > bestV * 1.02) {
        bestV = val;
        best = cand;
      }
    }
    console.log(`iter ${it} best ${Math.round(bestV)} ${JSON.stringify(best)}`);
  }
}

if (mode === 'starts') {
  const seeds = SEEDS(+(process.argv[3] ?? 6)), years = +(process.argv[4] ?? 10);
  for (const startShip of ['none', 'snow', 'schooner', 'sloop']) {
    const rs = await pool(seeds.map((seed) => () => run({ seed, years, settings: { startShip } })));
    summarize(`start:${startShip}`, rs);
  }
}
