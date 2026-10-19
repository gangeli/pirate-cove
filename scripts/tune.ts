// Parallel bot experiments.
//   npx tsx scripts/tune.ts compare [seeds] [years]        -> skill ladder + exploit policies
//   npx tsx scripts/tune.ts search [iters] [seeds] [years]  -> random/coordinate search over Policy knobs
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { DEFAULT_POLICY, LADDER, type Policy } from '../src/sim/bot';
import { PRESETS } from '../src/sim/presets';
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
  // RAW=<file> keeps every game's result (jsonl) for later analysis
  if (process.env.RAW) for (const r of rs) appendFileSync(process.env.RAW, JSON.stringify({ preset: process.env.PRESET ?? 'custom', name, ...r }) + '\n');
  const sc = rs.map((r) => r.score);
  const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
  const sd = Math.sqrt(sc.reduce((a, b) => a + (b - mean) ** 2, 0) / sc.length);
  const lost = rs.filter((r) => r.win === false).length;
  const medals = { gold: rs.filter((r) => r.win && r.parts?.medal === 'gold').length, silver: rs.filter((r) => r.win && r.parts?.medal === 'silver').length };
  const reasons = [...new Set(rs.filter((r) => r.win === false).map((r) => r.reason.slice(0, 40)))];
  console.log(`${name.padEnd(14)} mean ${Math.round(mean).toString().padStart(6)} sd ${Math.round(sd).toString().padStart(5)} lost ${lost}/${rs.length} gold ${medals.gold} silver ${medals.silver} hoard ${Math.round(rs.reduce((a, r) => a + (r.hoard ?? 0), 0) / rs.length)} hap ${(rs.reduce((a, r) => a + (r.hap ?? 0), 0) / rs.length).toFixed(2)} ${reasons.join(' | ')}`);
  return { mean, sd, lost };
}

// SEED0=<n> starts the seed sequence elsewhere, for more independent games
const SEEDS = (n: number) => Array.from({ length: n }, (_, i) => +(process.env.SEED0 ?? 101) + i * 7);

if (mode === 'compare') {
  const seeds = SEEDS(+(process.argv[3] ?? 6)), years = +(process.argv[4] ?? 10);
  const extra = process.env.POLICY ? JSON.parse(process.env.POLICY) : null;
  // PRESET=<id> plays that preset's island and start (default: the old free-form settings)
  const pr = process.env.PRESET ? PRESETS.find((p) => p.id === process.env.PRESET) : undefined;
  const settings = pr ? { ...pr.settings, years } : undefined;
  const ladder: [string, Partial<Policy>][] = [
    ['idle', { exploit: 'idle' }],
    ...Object.entries(LADDER),
    ...(extra ? [['tuned', extra] as [string, Partial<Policy>]] : []),
    ['x:pressgang', { exploit: 'pressgang' }],
    ['x:gouge', { exploit: 'gouge' }],
    ['x:nofun', { exploit: 'nofun' }],
    ['x:nofleet', { exploit: 'nofleet' }],
    ['x:raidonly', { exploit: 'raidonly' }],
    ['x:enddump', { exploit: 'enddump' }],
    ['x:festspam', { exploit: 'festspam' }],
    ['x:hoard25', { hoardRate: 0.25 }],
    ['x:hoard05', { hoardRate: 0.05 }],
  ];
  const only = process.env.ONLY?.split(',');
  for (const [name, pol] of ladder) {
    if (only && !only.includes(name)) continue;
    const rs = await pool(seeds.map((seed) => () => run({ seed, years, policy: pol, settings })));
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

if (mode === 'calibrate') {
  // play every preset with a skill ladder; the multiplier that equalises the default bot's raw score across
  // presets is the calibrated difficulty (relative to Brethren of the Coast = 100%)
  const { difficultyOf } = await import('../src/sim/presets');
  const seeds = SEEDS(+(process.argv[3] ?? 6)), years = +(process.argv[4] ?? 10);
  const ladder: [string, Partial<Policy>][] = Object.entries(LADDER).filter(([k]) => !process.env.RUNGS || process.env.RUNGS.split(',').includes(k));
  const only = process.env.ONLY?.split(',');
  const raw: Record<string, Record<string, { sub: number; lost: number; score: number }>> = {};
  for (const pr of PRESETS) {
    if (only && !only.includes(pr.id)) continue;
    raw[pr.id] = {};
    for (const [name, pol] of ladder) {
      const settings = { ...pr.settings, years };
      const rs = await pool(seeds.map((seed) => () => run({ seed, years, policy: pol, settings })));
      const sub = rs.reduce((a, r) => a + (r.win === false ? 0 : r.parts?.subtotal ?? 0), 0) / rs.length;
      const lost = rs.filter((r) => r.win === false).length / rs.length;
      raw[pr.id][name] = { sub, lost, score: rs.reduce((a, r) => a + r.score, 0) / rs.length };
      if (process.env.RAW) for (const r of rs) appendFileSync(process.env.RAW, JSON.stringify({ preset: pr.id, name, ...r }) + '\n');
      console.log(`${pr.id.padEnd(9)} ${name.padEnd(8)} raw ${Math.round(sub).toString().padStart(6)} lost ${(lost * 100).toFixed(0).padStart(3)}% score ${Math.round(raw[pr.id][name].score)} ${[...new Set(rs.filter((r) => r.win === false).map((r) => r.reason.slice(0, 30)))].join(' | ')}`);
    }
  }
  const base = raw.brethren?.default?.sub;
  if (base) for (const pr of PRESETS) {
    if (!raw[pr.id]) continue;
    const cur = difficultyOf({ ...pr.settings, seed: 1, region: 6 } as any);
    if (raw[pr.id].default) console.log(`${pr.name.padEnd(22)} current ${Math.round(cur * 100)}%  calibrated ${Math.round((base / Math.max(1, raw[pr.id].default.sub)) * 100)}%`);
  }
}
