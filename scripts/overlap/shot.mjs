// Close-up screenshots of places on a bot-developed island (before/after comparisons for the overlap fixes).
//   node scripts/overlap/shot.mjs --at="59.7,94.8;80.5,107" [--seed=7] [--bot=2] [--dist=9] [--q=low] [--extra=nofit=1] [--out=/tmp/overlap/shots] [--tag=before]
// Each place is shot from the default camera heading; --yaw=1 turns the camera a quarter round first.
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const base = opt('base', 'http://localhost:5173');
const seed = opt('seed', '7');
const OUT = opt('out', '/tmp/overlap/shots');
const tag = opt('tag', 'shot');
const extra = opt('extra', '');
const dist = +opt('dist', '9');
const yaw = +opt('yaw', '0');
const at = opt('at', '').split(';').filter(Boolean).map((s) => s.split(',').map(Number));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`));
await p.goto(`${base}/?play=1&seed=${seed}&bot=${opt('bot', '2')}&q=${opt('q', 'low')}${extra ? '&' + extra : ''}`, { timeout: 600000 });
await p.waitForFunction(() => window.__app?.state === 'game' && !document.querySelector('.loading'), null, { timeout: 900000, polling: 1000 });
await p.evaluate(() => {
  document.querySelector('.gpu-notice button')?.click();
  const a = window.__app;
  a.game.paused = true;
  a.hud.dismissAdvisor?.();
  window.__render = a.world.render.bind(a.world);
  a.world.render = () => {};
  // the HUD would cover the close-ups
  for (const e of document.querySelectorAll('body > *:not(canvas)')) if (!e.querySelector('canvas')) e.style.visibility = 'hidden';
});
for (const [i, [x, z, d]] of at.entries()) {
  await p.evaluate(([x, z, d, yaw]) => {
    const w = window.__app.world;
    for (let k = 0; k < yaw; k++) w.rig.rotateStep(1);
    w.rig.lookAt(x, z, true);
    w.rig.setDist(d, true);
    for (let k = 0; k < 40; k++) w.rig.update(0.1, innerWidth, innerHeight);
    window.__render();
    window.__render();
  }, [x, z, d ?? dist, i === 0 ? yaw : 0]);
  const f = `${OUT}/${tag}_${String(i).padStart(2, '0')}_${x.toFixed(0)}_${z.toFixed(0)}.png`;
  await p.screenshot({ path: f });
  console.log(f);
}
await browser.close();
