// Browser performance benchmark on a mid-game island, driven through the real UI loop.
//   node scripts/perfbench.mjs [extraQuery] [label]
//   e.g. node scripts/perfbench.mjs "q=high"   |   node scripts/perfbench.mjs "q=medium&bot=3"
// Needs the dev server on :5173. Reports frame times, long tasks, main-thread script/layout/style time,
// JS heap and input latency (build panel open on 'b', camera pan on held 'w'). Appends to
// /tmp/perfbench.jsonl so runs can be compared. Note: headless Chromium renders with SwiftShader (on the
// CPU), so absolute frame times are pessimistic; compare runs against each other.
import { chromium } from 'playwright';
import fs from 'node:fs';

const extra = process.argv[2] ?? '';
const label = process.argv[3] ?? extra;
const url = `http://localhost:${process.env.PORT ?? 5173}/?play=1&bot=1.5&seed=7&${extra}`;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable');
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
const loadMs = Date.now() - t0;
await p.waitForTimeout(4000); // let streaming and first rebuilds settle
await p.evaluate(() => {
  window.__perf = { frames: [], long: [] };
  let last = performance.now();
  const tick = (t) => {
    window.__perf.frames.push(t - last);
    last = t;
    window.__perfRaf = requestAnimationFrame(tick);
  };
  window.__perfRaf = requestAnimationFrame(tick);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(e.duration); }).observe({ type: 'longtask', buffered: false });
});
const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await p.waitForTimeout(10000);
const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const perf = await p.evaluate(() => {
  cancelAnimationFrame(window.__perfRaf);
  const f = window.__perf.frames.slice(1).sort((a, b) => a - b);
  const mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
  return { n: f.length, mean, p95: f[Math.floor(f.length * 0.95)] ?? 0, max: f[f.length - 1] ?? 0, long: window.__perf.long.length, longMs: window.__perf.long.reduce((a, b) => a + b, 0), heapMB: (performance.memory?.usedJSHeapSize ?? 0) / 1e6 };
});
// input latency: key 'b' -> build panel visible
const keyLatency = await p.evaluate(async () => {
  const panel = () => document.querySelector('.buildmenu, .build, [class*="build"]');
  const t = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  return await new Promise((res) => {
    const check = () => {
      const el = [...document.querySelectorAll('.panel')].find((e) => !e.classList.contains('hidden') && /build/i.test(e.className + e.textContent.slice(0, 200)));
      if (el || performance.now() - t > 5000) res(performance.now() - t);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
});
await p.keyboard.press('b');
// camera pan: hold 'w', measure time until the camera target moves
const panLatency = await p.evaluate(async () => {
  const rig = window.__app.world.rig;
  const z0 = rig.target.z, x0 = rig.target.x;
  const t = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true }));
  const r = await new Promise((res) => {
    const check = () => {
      if (Math.hypot(rig.target.z - z0, rig.target.x - x0) > 0.05 || performance.now() - t > 5000) res(performance.now() - t);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', bubbles: true }));
  return r;
});
const d = (k) => +(m1[k] - m0[k]).toFixed(3);
const res = {
  label, when: new Date().toISOString(), loadMs, fps: +(1000 / perf.mean).toFixed(1), frameMean: +perf.mean.toFixed(1), frameP95: +perf.p95.toFixed(1), frameMax: +perf.max.toFixed(1),
  longTasks: perf.long, longTaskMs: Math.round(perf.longMs), scriptS: d('ScriptDuration'), layoutS: d('LayoutDuration'), styleS: d('RecalcStyleDuration'), taskS: d('TaskDuration'),
  heapMB: +perf.heapMB.toFixed(0), keyLatencyMs: Math.round(keyLatency), panLatencyMs: Math.round(panLatency), errors: errors.slice(0, 3),
};
console.log(JSON.stringify(res));
fs.appendFileSync('/tmp/perfbench.jsonl', JSON.stringify(res) + '\n');
await b.close();
