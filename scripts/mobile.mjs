// Emulated-phone playtest: node scripts/mobile.mjs <outprefix> [w] [h]
// Loads a game on a touch device, taps around the UI and saves screenshots of each step.
import { chromium, devices } from 'playwright';
const [out = 'mobile', w = '844', h = '390'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const logs = [];
p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
await p.goto('http://localhost:5173/?play=1&run=150&q=low');
await p.waitForFunction(() => window.__ready, null, { timeout: 300000 });
await p.waitForTimeout(3000);
const shot = async (n) => { await p.screenshot({ path: `${out}_${n}.png`, timeout: 240000 }); console.log('shot', n); };
p.setDefaultTimeout(240000);
await shot('1_start');
// dismiss advisor if present
const aye = p.locator('.advisor [data-act="advClose"]');
if (await aye.count()) await aye.first().tap().catch(() => {});
// tap on the palace (find its screen position)
const pos = await p.evaluate(() => {
  const a = window.__app, g = a.game;
  const b = [...g.buildings.values()].find((x) => x.def === 'palace');
  const v = new (a.world.rig.camera.position.constructor)(b.x + b.w / 2, g.map.heightAt(b.x + b.w / 2, b.y + b.h / 2) + 1, b.y + b.h / 2);
  v.project(a.world.rig.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
});
await p.touchscreen.tap(pos.x, pos.y);
await p.waitForTimeout(1500);
await shot('2_select');
console.log('selection', await p.evaluate(() => JSON.stringify(window.__app.selection)));
// open the build menu and pick the first affordable card
await p.locator('.tool[data-tool="build"]').tap();
await p.waitForTimeout(800);
await shot('3_build');
await p.locator('.bcard:not(.disabled)').nth(2).tap();
await p.waitForTimeout(500);
await p.touchscreen.tap(+w * 0.6, +h * 0.45);
await p.waitForTimeout(1200);
await shot('4_ghost');
console.log('touchbar visible', await p.locator('.touchbar').isVisible());
// pinch-free pan: swipe
await p.evaluate(() => window.__app.setTool({ kind: 'select' }));
console.log(logs.slice(0, 10).join('\n'));
await b.close();
