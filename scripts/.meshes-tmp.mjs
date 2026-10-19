import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:${process.env.PORT ?? 5182}/?shot=1&play=1&bot=1.5&seed=7&frames=1&q=${process.argv[2] ?? 'high'}`);
await p.waitForFunction(() => window.__shotDone, null, { timeout: 900000, polling: 1000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__app.world; const out = {};
  for (const [k, g] of Object.entries({ buildings: w.buildings.group, people: w.people.group, ships: w.ships.group, veg: w.veg.group, effects: w.effects.group, ghost: w.scene })) {
    let n = 0, vis = 0, lod = 0;
    g.traverse((o) => { if (o.isMesh) { n++; let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) vis++; } if (o.isLOD) lod++; });
    out[k] = { n, vis, lod };
  }
  // per building view mesh counts
  const per = {};
  for (const c of w.buildings.group.children) { const id = c.userData.buildingId; if (!id) continue; const b = window.__app.game.buildings.get(id); let n = 0; c.traverse((o) => { if (o.isMesh) n++; }); per[b.def] = Math.max(per[b.def] ?? 0, n); }
  out.per = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const det = {};
  for (const c of w.buildings.group.children) { const id = c.userData.buildingId; if (!id) continue; const b = window.__app.game.buildings.get(id); if (det[b.def] || !['wench_hut','brewery','palace','housing_plot'].includes(b.def)) continue; const mats = new Set(), geos = new Set(); const names = []; c.traverse((o) => { if (o.isMesh) { mats.add(o.material.uuid ?? o.material); geos.add(o.geometry.uuid); names.push((o.name || o.parent?.name || '?') + ':' + o.geometry.attributes.position.count); } }); det[b.def] = { mats: mats.size, geos: geos.size, names: names.slice(0, 25) }; }
  out.det = det;
  out.nb = w.buildings.group.children.length;
  return out;
})));
await b.close();
