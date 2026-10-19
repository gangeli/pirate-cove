// CPU profile of the main thread during play: top self-time functions.
//   node scripts/profile.mjs [extraQuery] [seconds]
import { chromium } from 'playwright';
const extra = process.argv[2] ?? '';
const secs = +(process.argv[3] ?? 12);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
await p.goto(`http://localhost:5173/?play=1&bot=1.5&seed=7&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(3000);
const cdp = await ctx.newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await p.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dts = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + (dts[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`total sampled ${(total / 1e6).toFixed(1)}s over ${secs}s`);
for (const [k, v] of top) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${(v / 1e3).toFixed(0).padStart(6)}ms  ${k}`);
// inclusive time per our source file
const incl = new Map();
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
for (let i = 0; i < profile.samples.length; i++) {
  const seen = new Set();
  let id = profile.samples[i];
  while (id) {
    const n = byId.get(id);
    const f = n.callFrame.url.split('/').pop().split('?')[0];
    if (f && !seen.has(f)) {
      seen.add(f);
      incl.set(f, (incl.get(f) ?? 0) + (dts[i] ?? 0));
    }
    id = parent.get(id);
  }
}
console.log('--- inclusive by file');
for (const [k, v] of [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
await b.close();
