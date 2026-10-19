// scratch (render engineer): screenshots of the road tool (see-through trees) and an overlay
import { chromium } from 'playwright';
const [out = 'vis', q = 'high'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`http://localhost:${process.env.PORT ?? 5173}/?shot=1&play=1&bot=1.5&seed=7&frames=3&q=${q}`);
await p.waitForFunction(() => window.__shotDone, null, { timeout: 600000, polling: 500 });
const step = (fn) => p.evaluate(async (src) => {
  const app = window.__app;
  new Function('app', src)(app);
  for (let i = 0; i < 3; i++) { app.world.idle = false; app.frame(performance.now()); await new Promise((r) => setTimeout(r, 0)); }
}, fn);
await step("app.setTool({ kind: 'road' });");
await p.screenshot({ path: `${out}_road.png`, timeout: 600000 });
await step("app.setTool({ kind: 'select' }); app.overlays.show(); app.overlays.update();");
await p.screenshot({ path: `${out}_order.png`, timeout: 600000 });
await step("app.overlays.set('corn'); app.overlays.update();");
await p.screenshot({ path: `${out}_corn.png`, timeout: 600000 });
console.log(errs.slice(0, 3).join('\n'));
await b.close();
