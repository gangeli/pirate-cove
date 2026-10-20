// Economy impact of asynchronous path finding: bot games with synchronous paths vs. paths from a simulated
// worker that answers late, as the browser's does at 8x.
//   npx tsx scripts/pathasync.ts [years] [seeds, comma separated] [slow]
// The simulated worker runs the real PathMirror; its answer is held back by a virtual clock: 12.5 ms of
// wall time per sim step (8x speed), 60 Hz frames (messages land between frames), one search at a time
// at `slow` times the time node took for it, plus a millisecond of messaging.
// A bot game is chaotic: one changed decision early on and three years later the treasury is anywhere. So each
// seed is played `reps` times in each mode, run k nudging the game's RNG by k draws at the start; the spread of
// the synchronous runs is the noise the async runs are compared against.
//   npx tsx scripts/pathasync.ts [years] [seeds] [slow] [reps]
import { Game, MONTH } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { KINGS } from '../src/sim/data/kings';
import { PathMirror, type PathRequestMsg, type PathResultMsg } from '../src/sim/path';
import { PathService, type PathPort } from '../src/sim/pathservice';
import { Rng } from '../src/sim/rng';

const years = +(process.argv[2] ?? 3);
const seeds = (process.argv[3] ?? '1,2,5').split(',').map(Number);
const slow = +(process.argv[4] ?? 1);
const reps = +(process.argv[5] ?? 3);
const STEP_MS = 12.5, FRAME_MS = 1000 / 60;

class VirtualWorker implements PathPort {
  mirror = new PathMirror();
  onmessage: ((m: PathResultMsg) => void) | null = null;
  onerror: ((why: string) => void) | null = null;
  now = 0;
  private free = 0;
  private held: [number, PathResultMsg][] = [];
  post(m: PathRequestMsg): void {
    const t = performance.now();
    const r = this.mirror.handle(m);
    const ms = (performance.now() - t) * slow;
    this.free = Math.max(this.free, this.now + 0.5) + ms;
    if (r) this.held.push([this.free + 0.5, r]);
  }
  /** the frame boundary at `now`: deliver what is ready */
  frame(): void {
    const keep: [number, PathResultMsg][] = [];
    const due = this.held.filter((h) => (h[0] <= this.now ? true : (keep.push(h), false)));
    this.held = keep;
    for (const [, m] of due) this.onmessage?.(m);
  }
  close(): void {}
}

interface Out {
  treasury: number; hoard: number; people: number; buildings: number; employed: number; deliveries: number; exported: number; plundered: number;
  lat?: number[]; stats?: any;
}

function play(seed: number, mode: 'sync' | 'async', k: number): Out {
  const g = new Game({ seed, years: years + 1 }, KINGS.find((k) => k.id === 'kidd')!);
  for (let j = 0; j < k; j++) g.rng.next();
  const bot = new Bot(g, { policy: {} });
  let vw: VirtualWorker | null = null;
  if (mode === 'async') {
    vw = new VirtualWorker();
    g.paths = new PathService(g, vw, false);
  }
  const rng = new Rng(seed * 31 + k);
  const carrying = new Map<number, string | undefined>();
  let deliveries = 0;
  const n = Math.round((years * 12 * MONTH) / 0.1);
  let t = 0, nextFrame = rng.next() * FRAME_MS;
  for (let i = 0; i < n && !g.over; i++) {
    if (vw) {
      // frames between the previous step and this one: messages that arrived are handled first
      while (nextFrame <= t) {
        vw.now = nextFrame;
        vw.frame();
        nextFrame += FRAME_MS * (0.9 + 0.2 * rng.next());
      }
      vw.now = t;
    }
    g.step();
    bot.step();
    g.paths?.flush();
    g.events.length = 0;
    t += STEP_MS;
    if (i % 5 === 0)
      for (const q of g.people.values()) {
        if (carrying.get(q.id) && !q.carrying && q.task.kind !== 'dead') deliveries++;
        carrying.set(q.id, q.carrying);
      }
  }
  return {
    treasury: g.treasury, hoard: g.hoard, people: g.people.size, buildings: g.buildings.size,
    employed: g.captives().filter((c) => c.job).length, deliveries,
    exported: Object.values(g.stats.exported).reduce((a: number, b) => a + (b ?? 0), 0), plundered: g.stats.plundered,
    lat: g.paths?.stats.latSteps, stats: g.paths?.stats,
  };
}

const keys = ['treasury', 'hoard', 'people', 'buildings', 'employed', 'deliveries', 'exported', 'plundered'] as const;
const fmt = (o: Out) => keys.map((k) => `${k} ${Math.round(o[k])}`).join('  ');
const allLat: number[] = [];
const runs: Record<'sync' | 'async', Out[]> = { sync: [], async: [] };
const tot: Record<string, number> = {};
for (const seed of seeds)
  for (let k = 0; k < reps; k++)
    for (const mode of ['sync', 'async'] as const) {
      const o = play(seed, mode, k);
      runs[mode].push(o);
      let extra = '';
      if (o.stats) {
        const st = o.stats;
        allLat.push(...st.latSteps);
        for (const f of ['requests', 'async', 'deduped', 'sync', 'syncMissed', 'unreachable', 'cacheHits', 'invalid', 'timeouts', 'fallbacks'] as const) tot[f] = (tot[f] ?? 0) + st[f];
        extra = `   [req ${st.requests} async ${st.async} dedup ${st.deduped} sync ${st.sync} miss ${st.syncMissed} unreach ${st.unreachable} cache ${st.cacheHits} invalid ${st.invalid} timeouts ${st.timeouts} fallbacks ${st.fallbacks}]`;
      }
      console.log(`seed ${seed} k${k} ${mode.padEnd(5)}  ${fmt(o)}${extra}`);
    }
allLat.sort((a, b) => a - b);
const q = (f: number) => allLat[Math.min(allLat.length - 1, Math.floor(f * allLat.length))];
console.log(`latency (sim steps, request to arrival) n=${allLat.length} p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} p99.9 ${q(0.999)} max ${allLat[allLat.length - 1]}`);
console.log('service totals', JSON.stringify(tot));
// per metric: mean and standard deviation of each mode, and the difference in units of its standard error
for (const k of keys) {
  const st = (a: Out[]) => {
    const m = a.reduce((x, o) => x + o[k], 0) / a.length;
    const sd = Math.sqrt(a.reduce((x, o) => x + (o[k] - m) ** 2, 0) / Math.max(1, a.length - 1));
    return [m, sd];
  };
  const [ms, ss] = st(runs.sync), [ma, sa] = st(runs.async);
  const se = Math.sqrt(ss ** 2 / runs.sync.length + sa ** 2 / runs.async.length);
  console.log(`${k.padEnd(10)} sync ${ms.toFixed(0).padStart(7)} ±${ss.toFixed(0).padStart(6)}   async ${ma.toFixed(0).padStart(7)} ±${sa.toFixed(0).padStart(6)}   diff ${(ma - ms).toFixed(0).padStart(6)} (${se ? ((ma - ms) / se).toFixed(2) : '0'} SE)`);
}
