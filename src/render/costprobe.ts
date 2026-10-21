import type * as THREE from 'three';
import type { World } from './world';

/**
 * Rendering-cost probe (debug, WebGL): draw calls and triangles per render pass (main, shadow map, AO normal
 * pre-pass, post) and per subsystem (terrain, water, vegetation, people, buildings, ships, effects, sky...), counted
 * exactly by wrapping the renderer's per-draw entry point for a few frames. Also times the CPU side of World.render.
 *   await __app.world.costProbe(10)  ->  { passes: {main: {calls, tris, bySub: {...}}, ...}, cpuMs, frames }
 */
export interface PassCost {
  calls: number;
  tris: number;
  bySub: Record<string, { calls: number; tris: number }>;
}
export interface CostReport {
  frames: number;
  /** mean CPU ms of World.render per frame (scene update + draw submission) */
  cpuMs: number;
  total: { calls: number; tris: number };
  passes: Record<string, PassCost>;
}

export async function probeCost(world: World, frames = 10): Promise<CostReport> {
  const r = world.renderer as THREE.WebGLRenderer & { isWebGPURenderer?: boolean };
  if (r.isWebGPURenderer) throw new Error('costProbe: WebGL only (WebGPU: renderer.info totals)');
  const subs: [string, THREE.Object3D | undefined][] = [
    ['terrain', world.terrain.mesh], ['terrain', world.terrain.skirt], ['water', world.water.mesh], ['vegetation', world.veg.group],
    ['buildings', world.buildings.group], ['people', world.people.group], ['ships', world.ships.group], ['effects', world.effects.group],
    ['overlay', world.overlayGroup],
  ];
  const subOf = (o: THREE.Object3D): string => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) for (const [k, g] of subs) if (g === p) return k;
    return o.name || o.type || 'other';
  };
  const shadowCam = world.sun.shadow.camera;
  const passOf = (camera: THREE.Camera): string => {
    if (camera === shadowCam) return 'shadow';
    const rt = r.getRenderTarget();
    // GTAO's normal/depth pre-pass draws the scene into its own target with an override material
    if (rt && (rt as any).__aoPre) return 'aoPre';
    if (camera === world.rig.camera) return 'main';
    return 'post';
  };
  // tag the AO pre-pass target (it is created by the post chain; found by name of the pass field)
  const comp = (world as any).composer;
  for (const p of comp?.passes ?? []) {
    const nrt = p.gtao?.normalRenderTarget;
    if (nrt) nrt.__aoPre = true;
  }
  const passes: Record<string, PassCost> = {};
  const info = r.info;
  const orig = r.renderBufferDirect;
  const autoReset = info.autoReset;
  info.autoReset = false;
  // (only draws of the probed World.render calls count: not a frame already under way, thumbnails etc.)
  let on = false;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (!on) return orig.call(this, camera, scene, geometry, material, object, group);
    const c0 = info.render.calls, t0 = info.render.triangles;
    orig.call(this, camera, scene, geometry, material, object, group);
    const dc = info.render.calls - c0, dt = info.render.triangles - t0;
    const pk = passOf(camera), sk = subOf(object);
    const p = (passes[pk] ??= { calls: 0, tris: 0, bySub: {} });
    p.calls += dc;
    p.tris += dt;
    const s = (p.bySub[sk] ??= { calls: 0, tris: 0 });
    s.calls += dc;
    s.tris += dt;
  };
  // every frame draws everything (no render-on-demand skip) and the shadow map is redrawn each frame of the probe
  let cpu = 0;
  const origRender = world.render.bind(world);
  try {
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    let n = 0;
    (world as any).render = (dt: number) => {
      world.redraw();
      r.shadowMap.needsUpdate = true;
      const t = performance.now();
      on = true;
      try {
        origRender(dt);
      } finally {
        on = false;
      }
      cpu += performance.now() - t;
      n++;
    };
    while (n < frames) await new Promise<void>((res) => requestAnimationFrame(() => res()));
    frames = n;
  } finally {
    delete (world as any).render;
    r.renderBufferDirect = orig;
    info.autoReset = autoReset;
  }
  const out: CostReport = { frames, cpuMs: Math.round((cpu / frames) * 100) / 100, total: { calls: 0, tris: 0 }, passes: {} };
  for (const [k, p] of Object.entries(passes)) {
    const q: PassCost = { calls: Math.round(p.calls / frames), tris: Math.round(p.tris / frames), bySub: {} };
    for (const [s, v] of Object.entries(p.bySub).sort((a, b) => b[1].tris - a[1].tris)) q.bySub[s] = { calls: Math.round(v.calls / frames), tris: Math.round(v.tris / frames) };
    out.passes[k] = q;
    out.total.calls += q.calls;
    out.total.tris += q.tris;
  }
  return out;
}
