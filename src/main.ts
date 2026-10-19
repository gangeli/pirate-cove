import { App } from './ui/app';
import { installTheme } from './ui/theme';
import { pending } from './render/textures';
import { props } from './render/props';
import { Game } from './sim/game';

/** Entry point. URL parameters (for testing): ?play=1 starts a game immediately; ?shot=1 renders a still. */
function registerServiceWorker() {
  // only for real builds: the dev server serves modules that must not be cached
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.warn('service worker', e));
  });
}
registerServiceWorker();

async function boot() {
  installTheme();
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div style="text-align:center"><div class="t">Buccaneer Cove</div><div class="pbar"><div></div></div><div style="margin-top:8px;font-family:var(--body);opacity:.8" class="lt">Hoisting the sails...</div></div>';
  document.body.appendChild(loading);
  const bar = loading.querySelector('.pbar > div') as HTMLElement;
  bar.style.width = '15%';
  const app = new App(canvas, ui);
  if (params.get('q')) app.quality = params.get('q') as any;
  await app.init();
  await props.load();
  bar.style.width = '50%';
  (window as any).__app = app;
  const seed = params.get('seed');
  if (params.get('play') || params.get('shot')) {
    await app.newGame({ seed: seed ? +seed : 7, ...(params.get('adv') ? { advantage: params.get('adv') as any } : {}) }, (await import('./sim/data/kings')).KINGS[2]);
    if (params.get('run')) app.game.run(+params.get('run')!);
  } else await app.showMenu();
  bar.style.width = '85%';
  await Promise.all(pending);
  bar.style.width = '100%';
  const g: Game = app.game;
  if (params.get('focus')) {
    const b = [...g.buildings.values()].find((x) => x.def === params.get('focus'));
    if (b) app.world.rig.lookAt(b.x + b.w / 2, b.y + b.h / 2, true);
  }
  if (params.get('dist')) app.world.rig.setDist(+params.get('dist')!, true);
  if (params.get('yaw')) app.world.rig.yaw = app.world.rig.yawGoal = +params.get('yaw')!;
  if (params.get('cam')) {
    const [x, z, d] = params.get('cam')!.split(',').map(Number);
    app.world.rig.lookAt(x, z, true);
    if (d) app.world.rig.setDist(d, true);
  }
  if (params.get('lineup')) await lineup(app, params);
  if (params.get('nohud')) ui.style.display = 'none';
  setTimeout(() => loading.remove(), 200);
  (window as any).__ready = true;
  if (params.get('shot')) {
    const frames = +(params.get('frames') ?? 3);
    const ui2 = params.get('ui');
    if (ui2 === 'build') app.build.show();
    if (ui2 === 'chart') app.chart.show();
    if (ui2 === 'log') app.log.show();
    if (ui2 === 'edicts') app.edicts.show();
    if (ui2 === 'menu') {
      app.state = 'menu';
      app.hud.show(false);
      await app.menu.show();
    }
    if (ui2 === 'setup') {
      app.state = 'menu';
      app.hud.show(false);
      await app.menu.show();
      (app.menu as any).openSetup();
    }
    if (params.get('sel')) {
      const b = [...g.buildings.values()].find((x) => x.def === params.get('sel'));
      if (b) app.select({ type: 'building', id: b.id });
    }
    for (let i = 0; i < frames; i++) {
      app.frame(performance.now());
      await new Promise((r) => setTimeout(r, 0));
    }
    (window as any).__shotDone = true;
    return;
  }
  const loop = (now: number) => {
    app.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot();

/** Debug: a row of characters near the palace, e.g. ?lineup=pirate:walk,captive_f:idle&t=0.4&dist=4 */
async function lineup(app: App, params: URLSearchParams) {
  const THREE = await import('three');
  const g = app.game;
  g.paused = true;
  const pal = [...g.buildings.values()].find((b) => b.def === 'palace') ?? [...g.buildings.values()][0];
  const items = params.get('lineup')!.split(',').map((s) => s.split(':'));
  // the clearest flat patch of open ground near the palace
  let cx = pal.x + pal.w / 2, cz = pal.y + pal.h + 3, best = -Infinity;
  const m = g.map;
  for (let y = pal.y - 40; y < pal.y + 40; y += 2)
    for (let x = pal.x - 40; x < pal.x + 40; x += 2) {
      let ok = 0, hmin = Infinity, hmax = -Infinity;
      for (let j = -6; j <= 6; j++)
        for (let i = -8; i <= 8; i++) {
          const tx = x + i, ty = y + j;
          if (!m.inBounds(tx, ty) || !m.isWalkable(tx, ty) || !m.isLand(tx, ty) || m.heightAt(tx, ty) < 0.4) { ok -= 5; continue; }
          const k = m.idx(tx, ty);
          if (m.occupied[k] || m.trees[k]) ok -= 2; else ok++;
          const hh = m.heightAt(tx, ty);
          hmin = Math.min(hmin, hh);
          hmax = Math.max(hmax, hh);
        }
      if (hmin === Infinity) continue;
      const sc = ok - (hmax - hmin) * 20 - Math.hypot(x - pal.x, y - pal.y) * 0.3;
      if (sc > best) (best = sc), (cx = x), (cz = y);
    }
  const yaw = +(params.get('yaw') ?? app.world.rig.yaw);
  app.world.rig.yaw = app.world.rig.yawGoal = yaw;
  const t = params.get('t') ? +params.get('t')! : undefined;
  const C = (h: number) => new THREE.Color(h);
  const looks = [
    { skin: C(0xe0ac88), shirt: C(0xe8e0cc), pants: C(0x3a3a4a), hair: C(0x3a2414), beard: true, hat: C(0xa02020), hat2: null, sash: C(0x8a1a1a), boots: C(0x221510), coat: C(0x6a1a14) },
    { skin: C(0xa0663e), shirt: C(0x8a2a20), pants: C(0x5a4a3a), hair: C(0x1a1210), beard: false, hat: null, hat2: C(0x1a140e), sash: C(0xc09030), boots: C(0x221510), coat: C(0x1c2a5a) },
    { skin: C(0xf1c8a8), shirt: C(0xd8ccb0), pants: C(0x6a645a), hair: C(0x8a5a2a), beard: true, hat: null, hat2: null, sash: C(0x6a5a40), boots: C(0x221510), coat: C(0xa81c1c) },
  ];
  const n = items.length;
  const spacing = +(params.get('sp') ?? 1.1);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  app.world.rig.minDist = 1.5;
  app.world.rig.lift = +(params.get('lift') ?? 0.6);
  if (params.get('pitch')) app.world.rig.pitch = +params.get('pitch')!;
  app.world.rig.lookAt(cx, cz, true);
  app.world.rig.setDist(+(params.get('dist') ?? 4), true);
  for (let i = 0; i < 30; i++) app.world.rig.update(0.2, innerWidth, innerHeight);
  const cam = app.world.rig.camera.position;
  const turn = params.get('turn') ? +params.get('turn')! : 0.35;
  app.world.people.debug = items.map(([model, clip], i) => {
    const o = (i - (n - 1) / 2) * spacing;
    const x = cx + right.x * o, z = cz + right.z * o;
    // models face +Z; turn each toward the camera (plus a little three-quarter turn)
    const bone = C(0xc2b28a);
    const look = model === 'skeleton' ? { ...looks[0], skin: bone } : looks[i % looks.length];
    return { model: model as any, clip: clip ?? 'idle', x, z, dir: Math.atan2(cam.x - x, cam.z - z) + turn, look, t: t !== undefined ? t + i * 0.13 : undefined };
  });
}
