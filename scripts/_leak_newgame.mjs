import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await p.goto('http://localhost:4180/?play=1&seed=7&q=low');
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
for (let i = 0; i < 6; i++) {
  await p.waitForTimeout(6000);
  await cdp.send('HeapProfiler.collectGarbage');
  console.log(JSON.stringify(await p.evaluate(() => { const w = window.__app.world, m = w.renderer.info.memory; let o = 0; w.scene.traverse(() => o++); return { heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1), geoms: m.geometries, tex: m.textures, progs: w.renderer.info.programs.length, objects: o, buildings: window.__app.game.buildings.size }; })));
  await p.evaluate(async () => { await window.__app.newGame({ seed: 7 }, undefined); });
  await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
}
await b.close();
