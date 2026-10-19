// Memory-leak check in a real browser: samples JS heap, DOM counters (nodes, listeners), three.js
// geometries/textures/programs and scene object counts while the game is exercised. Something that
// grows on every repetition of the same action is a leak.
//   node scripts/leakcheck.mjs [extraQuery]
// Needs the dev server on :5173.
import { chromium } from 'playwright';

const extra = process.argv[2] ?? 'q=low';
const base = process.argv[3] ?? 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
await cdp.send('HeapProfiler.enable');
await p.goto(`${base}?play=1&seed=7&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(5000);

const rows = [];
async function sample(label) {
  await cdp.send('HeapProfiler.collectGarbage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const s = await p.evaluate(() => {
    const w = window.__app.world;
    const info = w.renderer.info;
    let objects = 0, meshes = 0;
    w.scene.traverse((o) => { objects++; if (o.isMesh) meshes++; });
    return {
      heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1),
      geoms: info.memory.geometries, tex: info.memory.textures, progs: info.programs?.length ?? 0,
      objects, meshes, gameT: Math.round(window.__app.game?.time ?? 0),
    };
  });
  const r = { label, ...s, nodes: dom.nodes, listeners: dom.jsEventListeners, docs: dom.documents };
  rows.push(r);
  console.log(JSON.stringify(r));
}
const repeat = async (label, n, fn) => {
  for (let i = 0; i < n; i++) {
    await fn(i);
    await sample(`${label} #${i + 1}`);
  }
};

await sample('start');
// 1. idle play at speed: steady state should be flat apart from the growing colony
await p.keyboard.press('3');
await repeat('play 20s', 3, () => p.waitForTimeout(20000));
await p.keyboard.press('1');

// 2. road tool on/off with cursor sweeps (ghost previews)
await repeat('tools', 4, async (i) => {
  await p.evaluate((kind) => window.__app.setTool(kind === 'build' ? { kind, def: 'tavern', rot: 0 } : { kind }), ['road', 'clear', 'demolish', 'build'][i % 4]);
  for (let k = 0; k < 40; k++) await p.mouse.move(400 + ((k * 23) % 500), 250 + ((k * 37) % 300));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
});

// 3. build menu, edicts, log open/close
await repeat('panels', 4, async () => {
  for (const k of ['b', 'x', 'l']) {
    await p.keyboard.press(k);
    await p.waitForTimeout(700);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
  }
});

// 4. select things (inspector open/close)
await repeat('inspect', 3, async () => {
  for (const [x, y] of [[640, 380], [600, 360], [680, 400], [560, 420]]) {
    await p.mouse.click(x, y);
    await p.waitForTimeout(400);
  }
  await p.keyboard.press('Escape');
});

// 5. camera sweeps (streaming in/out of full-detail building models)
await repeat('camera', 3, async () => {
  for (const k of ['w', 'a', 's', 'd']) {
    await p.keyboard.down(k);
    await p.waitForTimeout(1500);
    await p.keyboard.up(k);
  }
});

// 6. game switches through the app (new game replaces the old one)
await repeat('new game', 3, async (i) => {
  await p.evaluate(async (seed) => { await window.__app.newGame({ seed }, undefined); }, 100 + i).catch((e) => errors.push('newGame: ' + e.message));
  await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
  await p.waitForTimeout(4000);
});

console.log('\n--- growth per repetition (last minus first of each group)');
const groups = new Map();
for (const r of rows) {
  const g = r.label.replace(/ #\d+$/, '');
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(r);
}
for (const [g, rs] of groups) {
  if (rs.length < 2) continue;
  const a = rs[0], z = rs[rs.length - 1], n = rs.length - 1;
  const d = (k) => ((z[k] - a[k]) / n).toFixed(k === 'heapMB' ? 1 : 0);
  console.log(`${g.padEnd(10)} per rep: heap ${d('heapMB')}MB geoms ${d('geoms')} tex ${d('tex')} progs ${d('progs')} objects ${d('objects')} nodes ${d('nodes')} listeners ${d('listeners')}`);
}
if (errors.length) console.log('errors:', errors.slice(0, 8));
await b.close();
