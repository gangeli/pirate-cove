// node scripts/shot.mjs "<query>" out.png [w] [h]   -- renders with ?shot=1 and saves the page
import { chromium } from 'playwright';
const [query = '', out = 'shot.png', w = '1280', h = '720'] = process.argv.slice(2);
const url = `http://localhost:5173/?shot=1&${query}`;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await p.goto(url);
try { await p.waitForFunction(() => window.__shotDone, null, { timeout: 300000, polling: 500 }); } catch (e) { logs.push('timeout waiting for render'); }
await p.screenshot({ path: out, timeout: 480000 });
console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(logs.slice(0, 20).join('\n'));
await b.close();
