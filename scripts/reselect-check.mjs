// Regression check: clicking a ship, building or person always brings up its panel, also after a sheet (sea chart,
// island log, edicts, map views) was opened and closed, after the inspector's x folded the panel away, and after the
// selection was let go and the same thing picked again.
//   node scripts/reselect-check.mjs [base url, default http://localhost:4197/]
// Needs a running build (vite preview) and the playwright chromium (PLAYWRIGHT_BROWSERS_PATH).
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4197/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
p.setDefaultTimeout(600000);
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${base}?play=1&bot=1.5&seed=7&q=low&nowarm=1`, { timeout: 600000 });
await p.waitForFunction(() => window.__ready && window.__app?.game, null, { timeout: 900000, polling: 1000 });
await p.waitForTimeout(3000);
await p.getByText('Understood').click({ timeout: 20000 }).catch(() => {});
for (let i = 0; i < 10 && (await p.evaluate(() => (window.__app.modal.open && window.__app.modal.close(), window.__app.modal.open))); i++) await p.waitForTimeout(400);
await p.evaluate(() => (window.__app.game.paused = true));

const state = () => p.evaluate(() => {
  const a = window.__app;
  return { sel: a.selection, shown: !document.querySelector('.inspector').classList.contains('hidden'), folded: a.inspector.folded };
});
/** screen position of a target, after framing it */
const aim = async (t) => {
  await p.evaluate((t) => {
    const a = window.__app;
    a.world.rig.follow = null;
    const pos = t.type === 'ship' ? a.world.ships.shipPosition(t.id) : t.type === 'person' ? a.world.people.personPosition(t.id) : (() => { const b = a.game.buildings.get(t.id); return { x: b.x + b.w / 2, z: b.y + b.h / 2 }; })();
    a.world.rig.lookAt(pos.x, pos.z);
  }, t);
  await p.waitForTimeout(2500);
  // scan around the target for a screen point the click would give to it (people are picked first, then ships, then
  // buildings, as App.click does), so someone walking past or a thin mast doesn't turn the check into a miss
  return p.evaluate((t) => {
    const a = window.__app;
    const w = a.world;
    const r = a.canvas.getBoundingClientRect();
    const V = w.rig.camera.position.constructor;
    let c;
    if (t.type === 'ship') c = w.ships.shipPosition(t.id);
    else if (t.type === 'person') c = w.people.personPosition(t.id);
    else {
      const b = a.game.buildings.get(t.id);
      c = new V(b.x + b.w / 2, a.game.map.heightAt(b.x + b.w / 2, b.y + b.h / 2), b.y + b.h / 2);
    }
    if (!c) return { x: 0, y: 0, miss: true };
    const picks = (x, y) => {
      const ray = w.ndcRay(x, y);
      const pid = w.people.pickPerson(ray);
      if (pid) return { type: 'person', id: pid };
      const sid = w.ships.pickShip(ray);
      if (sid) return { type: 'ship', id: sid };
      const bid = w.buildings.pickBuilding(ray);
      return bid ? { type: 'building', id: bid } : null;
    };
    const ups = t.type === 'person' ? [0.9, 0.6, 1.3, 0.3] : [1, 2, 0.5, 3, 4];
    for (const up of ups) for (const dx of [0, 0.6, -0.6, 1.2, -1.2]) for (const dz of [0, 0.6, -0.6, 1.2, -1.2]) {
      const v = new V(c.x + (t.type === 'person' ? dx * 0.2 : dx), c.y + up, c.z + (t.type === 'person' ? dz * 0.2 : dz)).project(w.rig.camera);
      const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
      const got = picks(x, y);
      if (got && got.type === t.type && got.id === t.id) return { x, y };
    }
    const v = c.clone().project(w.rig.camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, miss: true };
  }, t);
};
const clickOn = async (t) => {
  const w = await aim(t);
  if (w.miss) console.log('     (no clear point on screen found for it)');
  await p.mouse.click(w.x, w.y);
  await p.waitForTimeout(1500);
  return state();
};
/** the inspector's x (it folds the panel while the quick seals show); false when there is no panel to close */
const fold = () => p.click('.inspector [data-act="close"]', { timeout: 15000 }).then(() => true, () => false);
const sheets = {
  chart: () => p.evaluate(() => window.__app.chart.open(window.__app.selection?.type === 'ship' ? window.__app.selection.id : 0)),
  log: () => p.evaluate(() => window.__app.log.show()),
  edicts: () => p.evaluate(() => window.__app.edicts.show()),
  overlays: () => p.evaluate(() => window.__app.overlays.show(false)),
};

const targets = await p.evaluate(() => {
  const a = window.__app;
  const ship = [...a.game.ships.values()].find((s) => a.world.ships.shipPosition(s.id));
  const pal = a.game.findBuilding('palace');
  const people = [...a.game.people.values()].filter((x) => a.world.people.personPosition(x.id)).slice(0, 8).map((x) => x.id);
  return { ship: ship?.id, building: pal?.id, people };
});
let fails = 0;
const check = (what, st, t) => {
  const ok = st.sel?.type === t.type && st.sel?.id === t.id && st.shown && !st.folded;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${t.type} ${what}`, JSON.stringify(st));
};

const cases = [];
if (targets.ship) cases.push({ type: 'ship', id: targets.ship, sheets: ['chart', 'log', 'edicts', 'overlays'] });
if (targets.building) cases.push({ type: 'building', id: targets.building, sheets: ['chart', 'overlays'] });
// a person who stays put long enough to be clicked (the game is paused; someone indoors or hidden is skipped)
for (const id of targets.people) {
  const st = await clickOn({ type: 'person', id });
  if (st.sel?.type === 'person' && st.sel.id === id) {
    cases.push({ type: 'person', id, sheets: ['log', 'edicts'] });
    break;
  }
}
for (const c of cases) {
  const t = { type: c.type, id: c.id };
  check('first click', await clickOn(t), t);
  for (const sh of c.sheets) {
    await sheets[sh]();
    await p.waitForTimeout(1200);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(1200);
    check(`clicked again after the ${sh}`, await clickOn(t), t);
    // the x folds the panel while the quick seals show: clicking the same thing brings it back
    if (!(await fold())) console.log('     (no panel to close)');
    await p.waitForTimeout(1200);
    check(`clicked again after the x (and the ${sh})`, await clickOn(t), t);
  }
  // fold, let it go, pick it anew
  await fold();
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__app.select(null));
  check('picked anew after fold and deselect', await clickOn(t), t);
}
console.log(fails || !cases.length ? `FAILED (${fails} of the checks, ${cases.length} targets)` : `PASSED (${cases.length} targets)`);
await b.close();
process.exit(fails || !cases.length ? 1 : 0);
