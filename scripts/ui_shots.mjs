// UI screenshot harness: every panel/state on several devices (desktop, phones, landscape, tablet, 1920), with layout
// checks (off-screen, overlapping HUD pieces, content poking out of panels, small touch targets) that fail loudly.
//   UI_SHOTS_DIR=/tmp/ui_shots node scripts/ui_shots.mjs <round> [--base=http://localhost:5173] [--dev=desk,pix] [--only=hud,b_palace] [--skip=setup]
// Needs a dev server (npx vite). Contact sheets: python3 scripts/ui_contact.py /tmp/ui_shots/round_<n>
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const round = args.find((a) => !a.startsWith('--')) ?? '0';
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const base = opt('base', 'http://localhost:5173');
const only = opt('only', '') ? opt('only', '').split(',') : null;
const skip = opt('skip', '') ? opt('skip', '').split(',') : [];
const OUT = `${process.env.UI_SHOTS_DIR ?? '/tmp/ui_shots'}/round_${round}`;
fs.mkdirSync(OUT, { recursive: true });

const DEV = {
  desk: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  hd: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  pix: { ...devices['Pixel 7'], deviceScaleFactor: 2, bar: 56 },
  iph: { ...devices['iPhone 13'], deviceScaleFactor: 2, bar: 0, defaultBrowserType: undefined },
  land: { ...devices['Pixel 7 landscape'], deviceScaleFactor: 2, bar: 0 },
  // a narrow Android phone (not in the default set): --dev=sm
  sm: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, bar: 56 },
  ipad: { ...devices['iPad Mini'], deviceScaleFactor: 1.5, defaultBrowserType: undefined },
};
const devList = opt('dev', 'desk,pix,iph,land,ipad,hd').split(',');

// ------------------------------------------------------------------------------------------- states
// each runs in the page: (a = window.__app, g = game, h = helpers)
const S = {};
const bld = (def, pick = 'first') => `(() => { const l = [...g.buildings.values()].filter((b) => b.def === '${def}' && ${pick === 'uc' ? 'b.built < 1' : 'b.built >= 1'}); const b = ${pick === 'owned' ? "l.find((b) => b.owner) ?? l[0]" : 'l[0]'}; if (!b) return 'missing'; a.select({ type: 'building', id: b.id }); h.look(b.x + b.w / 2, b.y + b.h / 2); })()`;
const per = (cond) => `(() => { const p = [...g.people.values()].find((p) => p.task.kind !== 'dead' && p.task.kind !== 'atsea' && (${cond})); if (!p) return 'missing'; a.select({ type: 'person', id: p.id }); h.look(p.x, p.y); })()`;
S.hud = `0`;
// the clock running (not paused) at 4x, and an undo seal beside the bar after laying a road
S.hud_run = `a.hud.advisorMode = 'off'; g.speed = 4; g.paused = false; a.hud.updateSpeed(); h.after = () => { g.paused = true; g.speed = 1; a.hud.advisorMode = 'full'; a.hud.updateSpeed(); }`;
S.undo = `(() => { const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); for (let r = 3; r < 20; r++) for (let dx = -r; dx <= r; dx++) for (const dy of [-r, r]) { const x = pal.x + dx, y = pal.y + dy; if (g.cmd({ type: 'road', x, y }).ok) { a.hud.update(); h.look(x, y); h.after = () => { g.cmd({ type: 'undo' }); a.hud.update(); }; return; } } return 'missing'; })()`;
// the "Update ready" toast together with the floating undo seal (they used to sit on top of each other)
S.toast_undo = `await (async () => { const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); let ok = false; for (let r = 3; r < 20 && !ok; r++) for (let dx = -r; dx <= r && !ok; dx++) for (const dy of [-r, r]) { const x = pal.x + dx, y = pal.y + dy; if (g.cmd({ type: 'road', x, y }).ok) { a.hud.update(); h.look(x, y); ok = true; break; } } (await import('/src/ui/install.ts')).debugShowUpdate(); await new Promise((r) => setTimeout(r, 400)); h.after = () => { g.cmd({ type: 'undo' }); a.hud.update(); document.querySelector('.pwa-toast [data-x]')?.click(); }; })()`;
S.b_palace = bld('palace');
S.b_dock = bld('dock');
S.b_farm = bld('corn_farm');
S.b_timber = bld('timber_camp');
S.b_sawmill = bld('sawmill');
S.b_brewery = bld('brewery');
S.b_dive = bld('dive');
S.b_wench = bld('wench_hut');
S.b_house = bld('housing_plot', 'owned');
S.b_bunkhouse = bld('bunkhouse');
S.b_chuck = bld('chuck_tent');
S.b_stockade = bld('stockade');
S.b_boatyard = bld('boatyard');
S.b_cave = bld('cave');
S.b_smuggler = bld('smugglers_cove');
S.b_tower = bld('watch_tower');
S.b_closed = `${bld('sawmill')}; (() => { const b = a.selection && g.buildings.get(a.selection.id); g.cmd({ type: 'blockSlot', id: b.id, delta: 1 }); a.inspector.refresh(true); h.after = () => g.cmd({ type: 'blockSlot', id: b.id, delta: -1 }); })()`;
S.b_folded = `${bld('corn_farm')}; a.inspector.fold(true)`;
S.b_construction = `(() => { const b = [...g.buildings.values()].find((b) => b.built < 1); if (!b) return 'missing'; a.select({ type: 'building', id: b.id }); h.look(b.x, b.y); })()`;
S.p_pirate = per(`p.kind === 'pirate' && !p.captain`);
S.p_pirate_happy = `${per(`p.kind === 'pirate' && !p.captain`)}; h.click('[data-act="tab:happiness"]')`;
S.p_pirate_skills = `${per(`p.kind === 'pirate' && !p.captain`)}; h.click('[data-act="tab:skills"]')`;
S.p_pirate_thoughts = `${per(`p.kind === 'pirate' && !p.captain`)}; h.click('[data-act="tab:thoughts"]')`;
S.p_captain = per(`p.captain`);
S.p_captive = per(`p.kind === 'captive' && !p.skilled`);
S.p_captive_res = `${per(`p.kind === 'captive' && !p.skilled`)}; h.click('[data-act="tab:resignation"]')`;
S.p_skilled = per(`p.kind === 'captive' && p.skilled`);
S.p_soldier = per(`p.kind === 'soldier'`);
S.p_wealthy = per(`p.kind === 'wealthy'`);
S.s_docked = `(() => { const s = g.ships.get(h.dockedShip); if (!s) return 'missing'; s.mission = 'cruise'; a.select({ type: 'ship', id: s.id }); h.look(s.vx, s.vy); })()`;
S.s_help = `${S.s_docked}; a.inspector.help = true; a.inspector.refresh(true); h.after = () => { a.inspector.help = false; }`;
S.s_folded = `${S.s_docked}; a.inspector.fold(true)`;
S.s_raid = `(() => { const s = g.ships.get(h.dockedShip); if (!s) return 'missing'; s.mission = 'raid'; a.select({ type: 'ship', id: s.id }); })()`;
S.s_kidnap = `(() => { const s = g.ships.get(h.dockedShip); if (!s) return 'missing'; s.mission = 'kidnap'; a.select({ type: 'ship', id: s.id }); })()`;
S.s_foster = `(() => { const s = g.ships.get(h.dockedShip); if (!s) return 'missing'; s.mission = 'foster_war'; a.select({ type: 'ship', id: s.id }); })()`;
S.s_atsea = `(() => { const s = [...g.ships.values()].find((s) => s.status === 'atsea'); if (!s) return 'missing'; a.select({ type: 'ship', id: s.id }); })()`;
S.build = `a.build.show(); h.click('[data-act="cat:infrastructure"]')`;
S.build_tools = `a.build.show(); h.click('[data-act="cat:tools"]')`;
S.build_tool_on = `a.setTool({ kind: 'road' }); a.build.show()`;
S.build_ent = `a.build.show(); h.click('[data-act="cat:entertainment"]')`;
// a thin treasury (restored before the next state): unaffordable cards and the placement tag that says so
S.build_poor = `h.poor(); a.build.show(); h.click('[data-act="cat:infrastructure"]')`;
S.place_poor = `(() => { h.poor(); a.setTool({ kind: 'build', def: 'black_market', rot: 0 }); const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); h.hoverTile(pal.x + pal.w + 3, pal.y + 1); })()`;
S.edicts = `a.edicts.show()`;
S.edicts_dip = `a.edicts.show(); h.click('.tabs [data-act^="tab:"]:nth-child(3)')`;
for (const t of ['overview', 'finances', 'satisfaction', 'pirates', 'captives', 'nations', 'ships', 'messages']) S[`log_${t}`] = `a.log.open('${t}')`;
S.chart = `a.chart.open(0)`;
S.chart_ship = `a.chart.open(h.dockedShip)`;
S.chart_danger = `a.chart.open(h.dockedShip); h.click('[data-act="mode:risk"]')`;
S.views = `a.overlays.show(false)`;
S.overlays = `a.overlays.show()`;
S.overlays_fert = `a.overlays.show(); h.click('[data-act="pick:soil"]')`;
S.overlays_crop = `a.overlays.show(); h.click('[data-act="pick:soil"]'); h.click('[data-act="crop:tobacco"]')`;
S.overlays_farm = `(() => { const f = [...g.buildings.values()].find((b) => b.def === 'corn_farm' || b.def === 'sugar_farm'); if (!f) return 'missing'; a.overlays.hide(); a.select({ type: 'building', id: f.id }); a.overlays.show(); h.look(f.x, f.y); })()`;
S.overlays_iron = `a.overlays.show(); h.click('[data-act="pick:ore"]')`;
S.advisor = `await new Promise((r) => setTimeout(r, 600)); a.hud.message({ id: 9e6, kind: 'advisor', title: 'Lumber is running low', text: 'Cap\\'n, our sawmills have barely a plank to their name. Build another timber camp beside thick jungle, or the builders will stand idle.', date: g.date, focus: { x: 60, y: 60 } })`;
S.toasts = `for (const [k, t, x] of [['ship', 'The Sloop returns', 'She brings 340 gold and 6 captives from the Windward Passage.'], ['bad', 'A captive escaped', 'Maria Lopez slipped away at night and will tell the Spanish where we are.'], ['good', 'Tavern opened', 'The Rusty Anchor pours its first grog.'], ['alert', 'Invasion rumoured', 'Word is the English are assembling a fleet at Port Royal, forty sail of the line and two regiments of foot, and mean to hang every one of us.\\n\\nDouble the guard at the stockade and keep the cannon loaded.']]) a.hud.message({ id: Math.random(), kind: k, title: t, text: x, date: g.date })`;
S.toast_read = `${S.toasts}; await new Promise((r) => setTimeout(r, 400)); h.click('.toast .readon')`;
S.gpu = `try { localStorage.removeItem('bc_gpu_notice'); } catch {} document.querySelector('.gpu-notice')?.remove(); a.hud.gpuNotice('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'); h.after = () => document.querySelector('.gpu-notice')?.remove()`;
S.prof_report = `const P = await import('/src/ui/profiler.ts'); P.recordProfile(a, 1); await new Promise((r) => setTimeout(r, 1200)); a.prof?.finish(); await new Promise((r) => setTimeout(r, 300)); h.after = () => document.querySelectorAll('.prof-report,.prof-badge').forEach((e) => e.remove())`;
S.tooltip = `h.hover('[data-tool="views"]')`;
S.menu_game = `a.modal.gameMenu()`;
S.menu_settings = `a.modal.settings()`;
S.menu_help = `a.modal.help()`;
S.menu_confirm = `(() => { const b = [...g.buildings.values()].find((b) => b.def === 'dive'); a.demolishAsk ? a.demolishAsk(b.id) : a.modal.confirm('Demolish the Dive?', 'Nothing will be refunded.', () => {}); })()`;
S.menu_voyage = `a.modal.message({ id: 9e6 + 2, kind: 'ship', title: 'Night Heron Returns', text: 'The Night Heron is back.', date: g.date, focus: { x: 60, y: 60 }, data: { kind: 'voyage', ship: 'Night Heron', mission: 'cruise in the Windward Passage', gold: 821, treasury: 328, captives: 6, skilled: ['gunsmith'], wealthy: 1, recruits: 3, cannons: 0, hull: 0.54, log: [{ date: 'May 1681', text: 'Grappling hooks away! Boarders!' }, { date: 'May 1681', text: 'Took a Spanish Merchant Brig! Plunder: 821 gold, skilled Gunsmith, 3 recruits. Lost 2 men.' }] } })`;
S.menu_message = `a.modal.message({ id: 9e6 + 1, kind: 'ship', title: 'The Snow Returns', text: 'Captain Flint brings the Revenge home from the Windward Passage with 820 gold, 14 captives and 3 recruits.\\n\\nThe crew took 410 gold as their share. 6 hands were lost.', date: g.date, focus: { x: 60, y: 60 } })`;
S.menu_gameover = `(() => { g.over = { win: true, reason: 'Your 20-year reign is complete. The Brethren toast your name.', score: { hoard: 18200, happiness: 3400, fleet: 2400, captains: 900, pirates: 1300, bonusKey: 'captains', difficulty: 1, total: 31200, medal: 'silver' } }; a.modal.gameOver(); })()`;
S.place_build = `(() => { a.setTool({ kind: 'build', def: 'tavern', rot: 0 }); const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); h.hoverTile(pal.x + pal.w + 3, pal.y + 1); })()`;
S.place_road = `(() => { a.setTool({ kind: 'road' }); const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); h.hoverTile(pal.x + pal.w + 3, pal.y + 1); })()`;
S.road_pick = `(() => { const m = g.map; const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); let best = null, bd = 1e9; for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.path[m.idx(x, y)] && !g.tileBuilding(x, y)) { const d = Math.hypot(x - pal.x, y - pal.y); if (d < bd) (bd = d), (best = { x, y }); } if (!best) return 'missing'; a.roadPick = best; h.look(best.x, best.y); })()`;
S.road_pending = `(() => { const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); a.setTool({ kind: 'road' }); const s = { x: pal.x + pal.w + 2, y: pal.y + pal.h + 2 }, e = { x: s.x + 6, y: s.y + 2 }; a.roadPending = { start: s, end: e }; a.hover = e; h.look(e.x, e.y); })()`;
S.tool_clear = `(() => { a.setTool({ kind: 'clear' }); const pal = [...g.buildings.values()].find((b) => b.def === 'palace'); h.hoverTile(pal.x - 4, pal.y - 4); })()`;
S.tool_demolish = `(() => { a.setTool({ kind: 'demolish' }); const b = [...g.buildings.values()].find((b) => b.def === 'dive'); h.hoverTile(b.x, b.y); })()`;
S.menu_rename = `(() => { const b = [...g.buildings.values()].find((b) => b.def === 'dive'); a.select({ type: 'building', id: b.id }); setTimeout(() => document.querySelector('[data-act="rename"]')?.click(), 50); })()`;
S.menu_save = `a.modal.saveDialog()`;
S.menu_load = `a.modal.loadDialog()`;
S.title = `(async () => { a.modal.queue = []; if (a.modal.open) a.modal.close(); a.quitToMenu(); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); if ([...document.querySelectorAll('.menu .item')].some((e) => e.offsetParent)) break; } })()`;
S.credits = `[...document.querySelectorAll('.menu .item')].find((e) => /credits/i.test(e.textContent))?.click()`;
S.setup = `(async () => { document.querySelector('.panel.credits')?.classList.add('hidden'); a.quitToMenu(); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); const it = [...document.querySelectorAll('.menu .item')].find((e) => /new game/i.test(e.textContent) && e.offsetParent); if (it) { it.click(); break; } } })()`;
S.setup_king = `h.click('[data-act="tab:king"]')`;

// ------------------------------------------------------------------------------------------- checks
const CHECK = () => {
  const W = innerWidth;
  const H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || innerHeight;
  const vis = (e) => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.hidden') && !e.closest('.gone');
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const name = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : e.tagName.toLowerCase());
  const errs = [], warns = [];
  const els = {};
  const pick = (k, sel) => { const e = [...document.querySelectorAll(sel)].find(vis); if (e) els[k] = e; };
  pick('topbar', '.topbar'); pick('clock', '.clock'); pick('toolbar', '.toolbar'); pick('minimap', '.minimap'); pick('advisor', '.advisor .bubble');
  pick('advface', '.advisor .face'); pick('sound', '.soundbtn'); pick('touchbar', '.touchbar'); pick('hint', '.hint'); pick('undo', '.undobtn'); pick('toast', '.pwa-toast'); pick('ticker', '.ticker .toast');
  const panels = [...document.querySelectorAll('#ui .panel')].filter(vis).filter((p) => !p.classList.contains('bubble'));
  panels.forEach((p, i) => (els[`panel${i}${name(p)}`] = p));
  const modalOpen = panels.some((p) => p.classList.contains('modal') || p.classList.contains('gpu-notice') || p.classList.contains('prof-report'));
  const bigOpen = panels.some((p) => p.classList.contains('big') || p.classList.contains('setup'));
  // off-screen
  for (const [k, e] of Object.entries(els)) {
    const b = box(e);
    if (b.l < -1 || b.t < -1 || b.r > W + 1 || b.b > H + 1) errs.push(`offscreen ${k} [${b.l | 0},${b.t | 0},${b.r | 0},${b.b | 0}] in ${W}x${H}`);
  }
  // overlaps between HUD pieces and floating panels (full-screen sheets and modals sit on top on purpose)
  const ov = (a, b) => { const A = box(a), B = box(b); const x = Math.min(A.r, B.r) - Math.max(A.l, B.l), y = Math.min(A.b, B.b) - Math.max(A.t, B.t); return x > 1 && y > 1 ? [x | 0, y | 0] : null; };
  const keys = Object.keys(els).filter((k) => k !== 'advface' && !(k === 'minimap' && !els.toast));
  if (!modalOpen && !bigOpen) for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const A = els[keys[i]], B = els[keys[j]];
    if (A.contains(B) || B.contains(A)) continue;
    const o = ov(A, B);
    if (o) errs.push(`overlap ${keys[i]} x ${keys[j]} (${o[0]}x${o[1]})`);
  }
  // content poking out of its panel, unless inside a horizontal scroller
  for (const p of panels) {
    const P = box(p);
    for (const c of p.querySelectorAll('button, .btn, [data-act], .seg, .row, h2, h3, .kv, table, canvas, input, select')) {
      if (!vis(c)) continue;
      let s = c.parentElement, scroller = false;
      while (s && s !== p) { const cs = getComputedStyle(s); if (/(auto|scroll|hidden)/.test(cs.overflowX) && s.scrollWidth > s.clientWidth + 1) { scroller = true; break; } s = s.parentElement; }
      if (scroller) continue;
      const b = box(c);
      if (b.w && (b.l < P.l - 1 || b.r > P.r + 1)) { errs.push(`pokes out ${name(p)} > ${name(c)} "${(c.textContent || '').trim().slice(0, 24)}" [${b.l | 0}..${b.r | 0}] vs [${P.l | 0}..${P.r | 0}]`); break; }
    }
    if (p.scrollWidth > p.clientWidth + 2) warns.push(`hscroll ${name(p)} ${p.scrollWidth}>${p.clientWidth}`);
  }
  // touch targets
  if (matchMedia('(pointer: coarse)').matches) {
    const small = [...document.querySelectorAll('#ui button, #ui .btn, #ui [data-act], #ui .tool')].filter(vis).filter((e) => { const b = box(e); if (!(b.w > 0 && (b.h < 30 || b.w < 30) && !e.closest('table') && e.tagName !== 'TR')) return false; const top = document.elementFromPoint(b.l + b.w / 2, b.t + b.h / 2); return !!top && (e === top || e.contains(top)); });
    if (small.length) warns.push(`${small.length} small touch targets e.g. ${small.slice(0, 4).map((e) => `${name(e)}(${box(e).w | 0}x${box(e).h | 0})`).join(' ')}`);
  }
  const boxes = Object.fromEntries(Object.entries(els).map(([k, e]) => { const b = box(e); return [k, [b.l | 0, b.t | 0, b.r | 0, b.b | 0]]; }));
  return { errs, warns, boxes };
};

// ------------------------------------------------------------------------------------------- run
const summary = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const dk of devList) {
  const d = { ...DEV[dk] };
  const bar = d.bar ?? 0;
  delete d.bar;
  delete d.defaultBrowserType;
  const ctx = await browser.newContext(d);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[${dk}] PAGEERROR ${e.message}`));
  const t0 = Date.now();
  await p.goto(`${base}/?play=1&seed=7&bot=1.5&q=low`, { timeout: 600000 });
  await p.waitForFunction(() => window.__app?.state === 'game' && !document.querySelector('.loading'), null, { timeout: 900000, polling: 1000 });
  await p.evaluate(async (bar) => {
    document.querySelector('.gpu-notice button')?.click();
    if (bar) {
      const set = () => document.documentElement.style.setProperty('--app-h', `${innerHeight - bar}px`);
      set();
      window.addEventListener('resize', () => setTimeout(set, 50));
    }
    const a = window.__app, g = a.game;
    g.paused = true;
    a.hud.advisorMode = 'full';
    a.touchMode = matchMedia('(pointer: coarse)').matches;
    if (a.touchMode) document.body.classList.add('touch');
    // a docked ship with a captain, a soldier and a wealthy captive, for the inspectors
    const P = await import('/src/sim/people.ts');
    const dock = [...g.buildings.values()].find((b) => b.def === 'dock' && !b.ship) ?? [...g.buildings.values()].find((b) => b.def === 'dock');
    if (dock.ship) { const old = g.ships.get(dock.ship); if (old) dock.ship = 0; }
    const s = P.createShip(g, 'sloop', dock);
    const cap = P.createCaptain(g, dock.x, dock.y);
    s.captain = cap.id;
    const pirates = [...g.people.values()].filter((p) => p.kind === 'pirate' && !p.ship && !p.captain).slice(0, 12);
    for (const q of pirates) { s.crew.push(q.id); q.ship = s.id; }
    const pal = [...g.buildings.values()].find((b) => b.def === 'palace');
    P.createPerson(g, 'soldier', pal.x - 2, pal.y + 2, { nat: 'eng' });
    P.createPerson(g, 'wealthy', pal.x - 3, pal.y + 3, { nat: 'spa', wealthy: true });
    window.__h = { dockedShip: s.id };
    window.__B = (await import('/src/sim/data/buildings.ts')).BUILDING;
    // freeze the 3D view (SwiftShader frames take seconds); each shot renders one frame explicitly
    window.__render = a.world.render.bind(a.world);
    a.world.render = () => {};
    a.hud.dismissAdvisor();
  }, bar);
  console.log(`[${dk}] loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const states = Object.keys(S).filter((k) => (!only || only.includes(k)) && !skip.includes(k) && !(k === 'tooltip' && d.hasTouch));
  for (const st of states) {
    const tS = Date.now();
    try {
      const res = await p.evaluate(async ([code, st]) => {
        const a = window.__app, g = a.game;
        const h = Object.assign(window.__h, {
          look: (x, y) => a.world.rig.lookAt(x, y, true),
          click: (sel) => document.querySelector(sel)?.click(),
          hover: (sel) => { const e = document.querySelector(sel); if (e) e.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); },
          hoverTile: (x, y) => { a.hover = { x, y }; a.world.rig.lookAt(x, y, true); },
        });
        h.after?.();
        h.after = null;
        h.poor = () => { const t = g.treasury; g.treasury = 40; h.after = () => (g.treasury = t); };
        if (!/^(setup|title|credits)/.test(st)) {
          a.modal.queue = [];
          g.over = null;
          if (a.modal.open) a.modal.close();
          a.closeAll();
          a.setTool({ kind: 'select' });
          a.select(null);
          a.hud.dismissAdvisor?.();
          document.querySelector('.ticker')?.replaceChildren();
          document.querySelector('.tipbox')?.classList.add('hidden');
        }
        // eslint-disable-next-line no-eval
        const r = await eval(`(async () => { ${/^(await|for)\b/.test(code) || code.includes('; ') ? code : `return ${code}`} })()`);
        // the frozen view never steps the camera: bring it to where the state put it, so UI that projects from it agrees
        { const cv = document.getElementById('view'); a.world.rig.update(0, cv.clientWidth, cv.clientHeight); }
        return r === 'missing' ? 'missing' : 'ok';
      }, [S[st], st]);
      if (res === 'missing') { console.log(`[${dk}] ${st}: (nothing to show)`); continue; }
      await p.waitForTimeout(/^(setup|title|credits)/.test(st) ? 2500 : 500);
      // a fresh selection is framed clear of the inspector on the next frame
      await p.waitForFunction(() => !window.__app.frameSel, null, { timeout: 3000, polling: 100 }).catch(() => {});
      // the software-rendered 3D view is frozen between shots; draw exactly one fresh frame for this state
      await p.evaluate(() => { const rig = window.__app.world.rig; if (rig.panTo) { rig.target.x = rig.panTo.x; rig.target.z = rig.panTo.z; rig.panTo = null; } window.__render?.(0.2); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
      await p.waitForTimeout(150);
      const tA = Date.now();
      const c = await p.evaluate(CHECK);
      const tB = Date.now();
      await p.screenshot({ path: `${OUT}/${dk}_${st}.png`, timeout: 300000 });
      if (process.env.TIMING) console.log(`[${dk}] ${st}: state+settle ${((tA - tS) / 1000).toFixed(1)}s check ${((tB - tA) / 1000).toFixed(1)}s shot ${((Date.now() - tB) / 1000).toFixed(1)}s`);
      for (const e of c.errs) console.log(`[${dk}] FAIL ${st}: ${e}`);
      for (const w of c.warns) console.log(`[${dk}] warn ${st}: ${w}`);
      summary.push({ dev: dk, st, errs: c.errs, warns: c.warns, boxes: c.boxes });
    } catch (e) {
      console.log(`[${dk}] FAIL ${st}: exception ${e.message.split('\n')[0]}`);
      summary.push({ dev: dk, st, errs: [`exception ${e.message}`], warns: [] });
    }
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
const nErr = summary.reduce((a, s) => a + s.errs.length, 0);
console.log(`\n==== round ${round}: ${summary.length} shots, ${nErr} layout errors, ${summary.reduce((a, s) => a + s.warns.length, 0)} warnings ====`);
if (nErr) {
  console.log('LAYOUT CHECK FAILED');
  process.exitCode = 1;
}
