// End-to-end playtest in a real browser, driving the UI like a player.
//   node scripts/e2e.mjs [baseUrl] [outDir]
// Title screen -> New Game -> each difficulty preset -> Begin Your Reign; then plays a few minutes of the
// first game through the HUD (speed, build menu, placing a building, edicts, log, inspector). Reports
// timings, console errors and failed requests, and writes screenshots along the way.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '/tmp/e2e';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];
const log = (s) => {
  console.log(s);
  report.push(s);
};

async function page() {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push('console: ' + m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) p.errors.push(`${r.status()} ${r.url()}`); });
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png`, timeout: 300000 });
const gameState = (p) => p.evaluate(() => {
  const a = window.__app;
  const g = a?.game;
  return g ? { state: a.state, t: +g.time.toFixed(1), date: g.date, treasury: Math.round(g.treasury), pirates: g.pirates().length, buildings: g.buildings.size, over: g.over?.reason ?? null, fps: Math.round(a.fps) } : null;
});

// ------------------------------------------------------------------------------------------- new games
const presets = ['calm', 'fair', 'brethren', 'marooned', 'hardtack'];
for (const preset of presets) {
  const p = await page();
  const t0 = Date.now();
  await p.goto(base);
  await p.waitForSelector('.menu .item[data-act="new"]', { timeout: 300000 });
  const tMenu = Date.now() - t0;
  await p.click('.menu .item[data-act="new"]');
  await p.click(`.preset[data-act="preset:${preset}"]`);
  const t1 = Date.now();
  await p.click('.setup [data-act="start"]');
  let s = null;
  let shotLoading = false;
  for (let i = 0; i < 240; i++) {
    s = await gameState(p);
    if (s && s.state === 'game') break;
    if (!shotLoading && Date.now() - t1 > 1500) {
      await shot(p, `start_${preset}_loading`);
      shotLoading = true;
    }
    await p.waitForTimeout(500);
  }
  const tStart = Date.now() - t1;
  await p.waitForTimeout(1500);
  await shot(p, `start_${preset}`);
  log(`[new game ${preset}] menu ${tMenu}ms, start ${tStart}ms, state ${JSON.stringify(s)}${p.errors.length ? '\n   ERRORS: ' + p.errors.slice(0, 6).join('\n   ') : ''}`);
  if (preset !== 'brethren') await p.close();
  else globalThis.play = p;
}

// ------------------------------------------------------------------------------------------- play a while
const p = globalThis.play;
const step = async (name, fn) => {
  try {
    await fn();
    log(`[play] ${name}: ok ${JSON.stringify(await gameState(p))}`);
  } catch (e) {
    log(`[play] ${name}: FAILED ${e.message.split('\n')[0]}`);
  }
};
await step('fast forward', async () => {
  await p.keyboard.press('3');
  await p.waitForTimeout(8000);
});
await step('open build menu (B)', async () => {
  await p.keyboard.press('b');
  await p.waitForTimeout(800);
  await shot(p, 'play_build');
});
await step('pick a tavern and place it', async () => {
  const ok = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[data-act^="pick:"], [data-act^="build:"]')].find((e) => /tavern/i.test(e.getAttribute('data-act') ?? '') || /tavern/i.test(e.textContent ?? ''));
    if (!el) return false;
    el.click();
    return true;
  });
  if (!ok) throw new Error('no tavern button in the build menu');
  await p.waitForTimeout(600);
  // sweep the cursor around the screen centre until a placement is accepted
  const before = (await gameState(p)).buildings;
  for (const [dx, dy] of [[0, 0], [120, 60], [-140, 80], [200, -40], [-60, -120], [260, 140]]) {
    await p.mouse.move(640 + dx, 380 + dy);
    await p.waitForTimeout(250);
    await p.mouse.click(640 + dx, 380 + dy);
    await p.waitForTimeout(400);
    if ((await gameState(p)).buildings > before) break;
  }
  await p.keyboard.press('Escape');
  const after = (await gameState(p)).buildings;
  if (after <= before) throw new Error('could not place it');
  await shot(p, 'play_placed');
});
await step('edicts panel (X)', async () => {
  await p.keyboard.press('x');
  await p.waitForTimeout(800);
  await shot(p, 'play_edicts');
  await p.keyboard.press('Escape');
});
await step('island log (L)', async () => {
  await p.keyboard.press('l');
  await p.waitForTimeout(800);
  await shot(p, 'play_log');
  await p.keyboard.press('Escape');
});
await step('select a pirate', async () => {
  for (const [x, y] of [[640, 380], [600, 360], [680, 400], [560, 420], [720, 330]]) {
    await p.mouse.click(x, y);
    await p.waitForTimeout(300);
  }
  await shot(p, 'play_select');
});
await step('let a few months pass', async () => {
  await p.keyboard.press('Escape');
  await p.keyboard.press('3');
  await p.waitForTimeout(30000);
  await shot(p, 'play_later');
});
log(`[play] errors: ${p.errors.length}${p.errors.length ? '\n   ' + p.errors.slice(0, 10).join('\n   ') : ''}`);
fs.writeFileSync(`${out}/report.txt`, report.join('\n'));
await b.close();
