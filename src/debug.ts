import * as THREE from 'three';
import type { App } from './ui/app';

/**
 * Debug views (?lineup=..., ?gallery=...), loaded only when asked for. 'three' is imported statically here:
 * a dynamic import('three') hands out the whole namespace, which stops the bundler tree-shaking three.
 */

/** Debug: a row of characters near the palace, e.g. ?lineup=pirate:walk,captive_f:idle&t=0.4&dist=4 */
export async function lineup(app: App, params: URLSearchParams) {
  const g = app.game;
  g.paused = true;
  const pal = [...g.buildings.values()].find((b) => b.def === 'palace') ?? [...g.buildings.values()][0];
  const items = params.get('lineup')!.split(',').map((s) => s.split(':'));
  const [cx, cz] = flatSpot(app);
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

/** the clearest flat patch of open ground near the palace (debug views) */
function flatSpot(app: App): [number, number] {
  const g = app.game;
  const pal = [...g.buildings.values()].find((b) => b.def === 'palace') ?? [...g.buildings.values()][0];
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
  return [cx, cz];
}

/** debug: ?gallery=def[:level],... lines building prefabs up on open ground */
export async function gallery(app: App, params: URLSearchParams) {
  const { buildPrefab } = await import('./render/prefabs');
  const { BUILDING } = await import('./sim/data/buildings');
  const g = app.game;
  g.paused = true;
  // a studio: hide the island, keep sky and lights, and stand everything on a flat sandy lot
  const [cx, cz] = flatSpot(app);
  for (const c of app.world.scene.children) if (!(c as any).isLight && c !== (app.world as any).sky) c.visible = false;
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8a77e, roughness: 1 }));
  lot.position.set(cx, 0, cz);
  lot.receiveShadow = true;
  app.world.scene.add(lot);
  app.world.rig.heightAt = () => 0;
  const yaw = +(params.get('yaw') ?? app.world.rig.yaw);
  app.world.rig.yaw = app.world.rig.yawGoal = yaw;
  // the row runs along x; the camera orbits it with yaw
  const right = new THREE.Vector3(1, 0, 0);
  const items = params.get('gallery')!.split(',').map((s) => s.split(':'));
  const gap = +(params.get('sp') ?? 0.8);
  const widths = items.map(([d]) => Math.max(...(BUILDING[d]?.size ?? [2, 2])));
  const total = widths.reduce((a, w) => a + w, 0) + gap * (items.length - 1);
  let o = -total / 2;
  items.forEach(([def, lv], i) => {
    const b = BUILDING[def];
    const [W, D] = b?.size ?? [2, 2];
    const model = buildPrefab(def, W, D, lv ? +lv : 1);
    const x = cx + right.x * (o + widths[i] / 2), z = cz + right.z * (o + widths[i] / 2);
    model.position.set(x, 0, z);
    model.rotation.y = +(params.get('rot') ?? 0);
    app.world.scene.add(model);
    o += widths[i] + gap;
  });
  app.world.rig.minDist = 1.5;
  app.world.rig.lift = +(params.get('lift') ?? 0.6);
  if (params.get('pitch')) app.world.rig.pitch = +params.get('pitch')!;
  app.world.rig.lookAt(cx, cz, true);
  app.world.rig.setDist(+(params.get('dist') ?? 8), true);
}

/** walk-test lanes: who walks, and the sim speed factors moveAlong applies to them (sim/people.ts) */
const WALKERS: Record<string, { kind: 'pirate' | 'captive' | 'soldier' | 'skeleton'; sex?: 'M' | 'F'; road?: boolean; task?: string; carrying?: boolean; pegleg?: boolean }> = {
  walk: { kind: 'captive', sex: 'M' },
  road: { kind: 'captive', sex: 'F', road: true },
  carry: { kind: 'captive', sex: 'M', carrying: true },
  pegleg: { kind: 'pirate', sex: 'M', pegleg: true },
  pirate: { kind: 'pirate', sex: 'M', road: true },
  soldier: { kind: 'soldier', sex: 'M' },
  skeleton: { kind: 'skeleton', sex: 'M' },
  escape: { kind: 'captive', sex: 'M', task: 'escape' },
  sprint: { kind: 'pirate', sex: 'F', road: true, task: 'escape' },
  charge: { kind: 'soldier', sex: 'M', road: true, task: 'chase' },
  wait: { kind: 'captive', sex: 'F' },
};

/**
 * Debug: people walking straight lanes near the camera at the sim's speeds, e.g. ?walktest=walk,road,carry,escape&speed=4.
 * They step exactly as the sim moves people (DT steps, moveAlong's speeds) but are not in the sim, so nothing else
 * steers them. `wait` stands on its lane waiting for a path (should stand idle). window.__walktest.report() measures the
 * drawn foot slide; ?legacy=1 draws them the old way, for comparison.
 */
export async function walktest(app: App, params: URLSearchParams) {
  const g = app.game;
  const { createPerson } = await import('./sim/people');
  const { DT } = await import('./sim/time');
  const { measureSlide } = await import('./render/gait');
  const view = app.world.people;
  g.speed = +(params.get('speed') ?? 1);
  view.legacy = params.get('legacy') === '1';
  const names = (params.get('walktest') === '1' ? 'walk,road,carry,soldier,escape,sprint' : params.get('walktest')!).split(',').filter((n) => WALKERS[n]);
  const [cx, cz] = flatSpot(app);
  const yaw = +(params.get('yaw') ?? 0.3);
  app.world.rig.yaw = app.world.rig.yawGoal = yaw;
  // lanes run across the view (the camera's right), stacked away from it
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const len = +(params.get('len') ?? 7), gap = +(params.get('gap') ?? 0.9);
  // ?bounce=1: turn round at the lane ends instead of starting over
  const bounce = params.get('bounce') === '1';
  const walkers = names.map((n, i) => {
    const w = WALKERS[n];
    const o = (i - (names.length - 1) / 2) * gap;
    const p = createPerson(g, w.kind, 0, 0, { sex: w.sex });
    g.people.delete(p.id); // drawn, not simulated
    p.accessories = { pegleg: w.pegleg };
    p.carrying = w.carrying ? 'corn' as any : undefined;
    p.task = { kind: (w.task ?? 'wander') as any, phase: 0 };
    p.path = n === 'wait' ? [] : [0];
    p.pathReq = n === 'wait' ? 1 : 0;
    let sp = w.road ? 1.7 : 1.1;
    if (w.task === 'escape' || w.task === 'chase' || w.task === 'flee') sp *= 1.8;
    if (w.kind === 'soldier' || w.task === 'rebel' || w.task === 'fight') sp *= 1.3;
    if (w.pegleg) sp *= 0.85;
    if (w.carrying) sp *= 0.9;
    const ax = cx + back.x * o - right.x * len / 2, az = cz + back.z * o - right.z * len / 2;
    // staggered starts so they are not all in step
    const s0 = n === 'wait' ? len * 0.3 : ((i * 0.37) % 1) * len;
    p.x = ax + right.x * s0;
    p.y = az + right.z * s0;
    p.dir = Math.atan2(right.z, right.x);
    return { name: n, p, sp, s: s0, fwd: 1, ax, az };
  });
  view.extra = walkers.map((w) => w.p);
  view.footLog = new Map(walkers.map((w) => [w.p.id, []]));
  let stepT = g.time;
  view.beforeFrame = () => {
    // one move per sim step, as updatePeople does
    while (stepT + DT <= g.time + 1e-9) {
      stepT += DT;
      for (const w of walkers) {
        if (w.name === 'wait') continue;
        w.s += w.fwd * w.sp * DT;
        if (bounce) {
          if (w.s > len) (w.s = 2 * len - w.s), (w.fwd = -1);
          if (w.s < 0) (w.s = -w.s), (w.fwd = 1);
        } else if (w.s > len) w.s -= len; // back to the start: straight-line walking only (the jump is not measured)
        w.p.x = w.ax + right.x * w.s;
        w.p.y = w.az + right.z * w.s;
        w.p.dir = Math.atan2(right.z * w.fwd, right.x * w.fwd);
      }
    }
  };
  app.world.rig.minDist = 1.5;
  app.world.rig.lift = +(params.get('lift') ?? 0.5);
  app.world.rig.pitch = +(params.get('pitch') ?? 0.32);
  app.world.rig.lookAt(cx, cz, true);
  app.world.rig.setDist(+(params.get('dist') ?? 7), true);
  for (let i = 0; i < 30; i++) app.world.rig.update(0.2, innerWidth, innerHeight);
  (window as any).__walktest = {
    walkers: walkers.map((w) => ({ name: w.name, id: w.p.id, speed: w.sp })),
    clear: () => view.footLog!.forEach((v) => (v.length = 0)),
    log: (id: number) => view.footLog!.get(id),
    /** foot slide per walker over the frames logged so far: planted = within 2 cm (model) of the point's lowest */
    report: () => walkers.map((w) => {
      const log = view.footLog!.get(w.p.id)!;
      const r = measureSlide(log, 0.02 * view.scale);
      const clips = new Map<string, number>();
      for (const l of log) clips.set(l.clip.replace(/:.*/, ''), (clips.get(l.clip.replace(/:.*/, '')) ?? 0) + 1);
      return { name: w.name, speed: w.sp, frames: log.length, ...r, clips: Object.fromEntries(clips) };
    }),
  };
}
