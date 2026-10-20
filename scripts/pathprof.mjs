// Main-thread path-finding cost during real play in the browser, sync vs async (worker) path finding.
//   node scripts/pathprof.mjs [port] [seconds] [extraQuery]
// e.g. against `npx vite --port 5190 --strictPort`:
//   node scripts/pathprof.mjs 5190 120 paths=sync      (main-thread searches, as before the worker)
//   node scripts/pathprof.mjs 5190 120                 (async: long searches in the worker)
// The game starts after a 1.5-year bot pre-run (seed 7), then plays at 8x with the bot still building, for
// `seconds` of wall time. Every PathFinder method that searches or scans the grid on the main thread is
// timed, per frame. Prints the worst frames' path time, the PathService latency distribution, and economy
// outcomes (treasury, captives employed, haul deliveries). The headless browser renders with SwiftShader, at a
// few frames a minute on a busy machine, so drawing is switched off (RENDER=1 keeps it): what is measured is
// the main thread's sim and path work at a real 60 Hz frame rate.
// STRESS=n additionally sends n idle people a second on a cross-island walk (to an open tile more than 70
// tiles away), the long searches bot games rarely make but sprawling player islands do.
import { chromium } from 'playwright';
const port = +(process.argv[2] ?? 5190);
const secs = +(process.argv[3] ?? 60);
const extra = process.argv[4] ?? '';
const seed = process.env.SEED ?? '7';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => m.type() === 'error' || m.type() === 'warning' ? console.log('console', m.type(), m.text()) : 0);
await p.goto(`http://localhost:${port}/?play=1&bot=1.5&seed=${seed}&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game' && window.__ready, null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(2000);
const t0 = Date.now();
await p.evaluate(async ([render, stress]) => {
  const app = window.__app, g = app.game;
  if (!render) app.world.render = () => {};
  if (stress) {
    const { goTo } = await import('/src/sim/people.ts');
    const n = g.map.size;
    let r = 12345;
    const rnd = (k) => ((r = (r * 1103515245 + 12345) >>> 0) % k);
    setInterval(() => {
      const idle = [...g.people.values()].filter((q) => q.task.phase !== 0 && (q.task.kind === 'idle' || q.task.kind === 'wander' || q.task.kind === 'work'));
      for (let k = 0; k < stress && idle.length; k++) {
        const q = idle.splice(rnd(idle.length), 1)[0];
        for (let tries = 0; tries < 50; tries++) {
          const i = rnd(n * n), x = i % n, y = (i / n) | 0;
          if (g.pf.cost(i) === Infinity || Math.hypot(x - q.x, y - q.y) < 70) continue;
          if (goTo(g, q, x, y, { kind: 'wander' })) break;
        }
      }
    }, 1000);
  }
  const { Bot } = await import('/src/sim/bot.ts');
  const bot = new Bot(g, {});
  // per frame: [person-path searches ms, grid scans ms (region labels, worker diff), road-tool searches ms]
  const W = (window.__pp = { frames: [], cur: [0, 0, 0], searches: [], roadMs: 0, other: 0, scanMax: {}, deliveries: 0, steps: 0, start: { t: g.time, treasury: g.treasury } });
  const proto = Object.getPrototypeOf(g.pf);
  for (const name of ['search', 'labels', 'classify']) {
    const orig = proto[name];
    proto[name] = function (...a) {
      const t = performance.now();
      const r = orig.apply(this, a);
      const ms = performance.now() - t;
      // the road tool's route (placement.ts, a player command) searches with a 60000 cap, always inline
      if (name === 'search' && a[2] === 60000) (W.cur[2] += ms), (W.roadMs += ms);
      else if (name === 'search') W.cur[0] += ms, W.searches.push(ms);
      else (W.cur[1] += ms), (W.other += ms), (W.scanMax[name] = Math.max(W.scanMax[name] ?? 0, ms));
      return r;
    };
  }
  const carrying = new Map();
  const step = g.step.bind(g);
  g.step = () => {
    step();
    bot.step();
    W.steps++;
    for (const q of g.people.values()) {
      if (carrying.get(q.id) && !q.carrying && q.task.kind !== 'dead') W.deliveries++;
      carrying.set(q.id, q.carrying);
    }
  };
  let last = performance.now();
  const tick = (now) => {
    W.frames.push([W.cur[0], W.cur[1], W.cur[2], now - last]);
    W.cur = [0, 0, 0];
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  g.speed = 8;
  // nobody reads the letters: modals (which pause the game) and the software-rendering notice are dismissed
  setInterval(() => {
    if (app.modal.open) app.modal.close();
    document.querySelector('.gpu-notice button')?.click();
    g.paused = false;
  }, 250);
}, [!!process.env.RENDER, +(process.env.STRESS ?? 0)]);
await p.waitForTimeout(secs * 1000);
const r = await p.evaluate(() => {
  const g = window.__app.game, W = window.__pp;
  const fr = W.frames.slice(1);
  const pathMs = fr.map((f) => f[0] + f[1]).sort((a, b) => b - a);
  const searchMs = fr.map((f) => f[0]).sort((a, b) => b - a);
  const scanMs = fr.map((f) => f[1]).sort((a, b) => b - a);
  const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN;
  const s = g.paths?.stats;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const dist = (a) => { const v = sorted(a); return a.length ? { n: a.length, p50: q(v, 0.5), p90: q(v, 0.9), p99: q(v, 0.99), max: v[v.length - 1] } : null; };
  return {
    async: !!g.paths,
    frames: fr.length,
    simYears: (g.time - W.start.t) / 1800,
    steps: W.steps,
    // main-thread path work per frame for people's walks (searches + grid scans), worst ten frames
    worstFramePathMs: pathMs.slice(0, 10).map((x) => +x.toFixed(2)),
    worstFrameSearchMs: searchMs.slice(0, 5).map((x) => +x.toFixed(2)),
    worstFrameScanMs: scanMs.slice(0, 5).map((x) => +x.toFixed(2)),
    roadToolSearchMs: W.roadMs,
    framesPathOver: { '1ms': pathMs.filter((x) => x > 1).length, '2ms': pathMs.filter((x) => x > 2).length, '4ms': pathMs.filter((x) => x > 4).length, '8ms': pathMs.filter((x) => x > 8).length },
    mainSearches: dist(W.searches),
    mainSearchTotalMs: W.searches.reduce((a, b) => a + b, 0),
    scanMs: W.other,
    scanMaxMs: W.scanMax,
    frameMs: dist(fr.map((f) => f[3])),
    economy: { treasury: Math.round(g.treasury), treasuryGain: Math.round(g.treasury - W.start.treasury), people: g.people.size, buildings: g.buildings.size, employed: g.captives().filter((c) => c.job).length, captives: g.captives().length, deliveries: W.deliveries, hoard: Math.round(g.hoard) },
    service: s && {
      requests: s.requests, cacheHits: s.cacheHits, unreachable: s.unreachable, sync: s.sync, syncMissed: s.syncMissed, async: s.async, deduped: s.deduped,
      results: s.results, invalid: s.invalid, timeouts: s.timeouts, fallbacks: s.fallbacks, gridInits: s.gridInits, gridUpdates: s.gridUpdates, tilesSent: s.tilesSent,
      latMs: dist(s.latMs), latSteps: dist(s.latSteps), workerMs: dist(s.workerMs), syncTryMs: dist(s.syncMs), pendingNow: g.paths.pending,
    },
  };
});
console.log(JSON.stringify({ wall: (Date.now() - t0) / 1000, ...r }, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(3) : v), 1));
await b.close();
