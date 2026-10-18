import { App } from './ui/app';
import { installTheme } from './ui/theme';
import { pending } from './render/textures';
import { props } from './render/props';
import { Game } from './sim/game';

/** Entry point. URL parameters (for testing): ?play=1 starts a game immediately; ?shot=1 renders a still. */
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
  if (params.get('yaw')) app.world.rig.yaw = +params.get('yaw')!;
  if (params.get('cam')) {
    const [x, z, d] = params.get('cam')!.split(',').map(Number);
    app.world.rig.lookAt(x, z, true);
    if (d) app.world.rig.setDist(d, true);
  }
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
