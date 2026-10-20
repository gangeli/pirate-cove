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
