import { Game } from './sim/game';
import { World } from './render/world';
import { props } from './render/props';
import { pending } from './render/textures';

async function boot() {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = params.get('q');
  const world = new World(canvas, q === 'low' ? { ao: false, bloom: false, shadows: false, pixelRatio: 1 } : {});
  await props.load();
  const game = new Game({ seed: +(params.get('seed') ?? 7) });
  world.attach(game);
  await world.ships.ready;
  await world.people.ready;
  await Promise.all(pending);
  (window as any).__game = game;
  (window as any).__world = world;
  if (params.get('run')) game.run(+params.get('run')!);
  if (params.get('focus')) {
    const b = [...game.buildings.values()].find((x) => x.def === params.get('focus'));
    if (b) world.rig.lookAt(b.x + b.w / 2, b.y + b.h / 2, true);
    world.rig.setDist(+(params.get('dist') ?? 25), true);
    if (params.get('yaw')) world.rig.yaw = +params.get('yaw')!;
  }
  if (params.get('cam')) {
    const [x, z, d, yaw] = params.get('cam')!.split(',').map(Number);
    world.rig.lookAt(x, z, true);
    world.rig.setDist(d, true);
    if (!isNaN(yaw)) world.rig.yaw = yaw;
  }
  if (params.get('shot')) {
    // deterministic capture mode: render a few frames synchronously, then stop
    const frames = +(params.get('frames') ?? 3);
    for (let i = 0; i < frames; i++) {
      game.advance(1 / 30);
      world.render(1 / 30);
      game.events.length = 0;
      await new Promise((r) => setTimeout(r, 0));
    }
    (window as any).__ready = true;
    (window as any).__shotDone = true;
    return;
  }
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.advance(dt);
    world.render(dt);
    game.events.length = 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as any).__ready = true;
}
boot();
