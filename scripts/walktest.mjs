// Walk-test harness: loads ?walktest, drives frames at a fixed 60 fps (independent of how slow SwiftShader is),
// measures the drawn foot slide and optionally saves a frame sequence.
//   node scripts/walktest.mjs <outdir> "<query>" [frames=240] [shotEvery=0] [warm=60] [w=960] [h=540]
// e.g. node scripts/walktest.mjs /tmp/wt "play=1&q=low&walktest=walk,road,carry,soldier,escape&speed=4" 300
// then npx tsx scripts/footslide.ts /tmp/wt/feet.json. Add legacy=1 to the query for the old drawing.
// Works without ?walktest too (close-ups: ?closeup=corn_farm&bot=1). Env: BASE (server, default :5173),
// EVAL (an expression evaluated in the page at the end, printed as EVAL {...}).
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out, query, framesS = '240', everyS = '0', warmS = '60', w = '960', h = '540'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
p.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
await p.goto((process.env.BASE ?? 'http://localhost:5173') + '/?shot=1&nohud=1&' + query, { timeout: 600000 });
await p.waitForFunction(() => window.__shotDone, null, { timeout: 900000, polling: 500 });
// the canvas right after a frame is drawn (page.screenshot waits on a compositor frame that shot mode never makes)
const shot = async (path) => {
  const url = await p.evaluate(() => { window.__ft += 1000 / 60; window.__app.frame(window.__ft); return document.querySelector('canvas').toDataURL('image/png'); });
  fs.writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
};
const frame = (n) => p.evaluate((n) => {
  const a = window.__app;
  for (let i = 0; i < n; i++) { window.__ft += 1000 / 60; a.frame(window.__ft); }
}, n);
await p.evaluate(() => { window.__ft = performance.now(); window.__app.last = window.__ft; });
await frame(+warmS);
await p.evaluate(() => window.__walktest?.clear());
const every = +everyS;
for (let i = 0; i < +framesS; i++) {
  if (!(every && i % every === 0)) await frame(1);
  if (every && i % every === 0) await shot(`${out}/f${String(i).padStart(4, '0')}.png`);
}
const rep = await p.evaluate(() => window.__walktest?.report() ?? []);
const logs = await p.evaluate(() => window.__walktest?.walkers.map((w) => ({ ...w, log: window.__walktest.log(w.id) })) ?? []);
if (logs.length) fs.writeFileSync(`${out}/feet.json`, JSON.stringify(logs));
if (process.env.EVAL) console.log('EVAL', JSON.stringify(await p.evaluate(process.env.EVAL)));
console.log(JSON.stringify(rep.map((r) => ({ name: r.name, speed: +r.speed.toFixed(2), slideRatio: +r.slideRatio.toFixed(3), slideSpeed: +r.slideSpeed.toFixed(3), plantedT: +r.plantedTime.toFixed(1), clips: r.clips }))));
if (!every) await shot(`${out}/last.png`);
await b.close();
