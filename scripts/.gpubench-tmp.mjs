// scratch (render engineer): synchronous GPU-bound frame timing with readPixels sync; median of 12 frames
import { chromium } from 'playwright';
const extra = process.argv[2] ?? '';
const label = process.argv[3] ?? extra;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:5173/?play=1&bot=1.5&seed=7&${extra}`);
await p.waitForFunction(() => window.__app?.state === 'game', null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(6000);
const r = await p.evaluate(async () => {
  const app = window.__app, w = app.world, r = w.renderer, gl = r.getContext();
  app.game.paused = true;
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < 3; i++) { w.render(1 / 60); sync(); }
  r.info.autoReset = false; r.info.reset();
  w.render(1 / 60); sync();
  const calls = r.info.render.calls, tris = r.info.render.triangles;
  r.info.autoReset = true;
  const ts = [];
  for (let i = 0; i < 12; i++) { const t = performance.now(); w.render(1 / 60); sync(); ts.push(performance.now() - t); await new Promise((r) => setTimeout(r, 0)); }
  ts.sort((a, b) => a - b);
  let casters = 0, meshes = 0;
  w.scene.traverse((o) => { if (o.isMesh && o.visible) { meshes++; if (o.castShadow) casters++; } });
  return { med: +ts[6].toFixed(1), min: +ts[0].toFixed(1), calls, tris, meshes, casters, pr: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], passes: w.composer?.passes?.map((x) => x.constructor.name).join(',') };
});
console.log(JSON.stringify({ label, ...r, errs: errs.slice(0, 2) }));
await b.close();
