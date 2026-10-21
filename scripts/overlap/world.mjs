// In-world overlap detector: lets the bot develop an island, then measures what the renderer actually drew.
//   node scripts/overlap/world.mjs [--seeds=7,3] [--bot=2] [--shots=6] [--out=/tmp/overlap] [--base=http://localhost:5173] [--q=low] [--extra=nofit=1]
// Needs a dev server (npx vite --port 5173). One headless browser at a time (SwiftShader is slow and big).
//
// Per seed it reports, ranked:
//   model   - building geometry (and crops) reaching past its own tile footprint at ground level (< 1 tile up)
//   pairs   - geometry of one building inside a neighbour's footprint below the neighbour's top
//   trees   - tree instances whose trunk or crown points are inside a building's box, or whose trunk stands in a road
//   terrain - ground along a footprint's edge above the building's base (walls buried) or below it (floating)
// and writes overlap_<seed>.json plus close-up shots of the worst cases.
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const base = opt('base', 'http://localhost:5173');
const seeds = opt('seeds', '7').split(',').map(Number);
const bot = opt('bot', '2');
const shots = +opt('shots', '6');
const q = opt('q', 'low');
const OUT = opt('out', '/tmp/overlap');
const extra = opt('extra', '');
fs.mkdirSync(OUT, { recursive: true });

function analyse() {
  const a = window.__app, w = a.world, g = a.game, m = g.map, n = m.size;
  const views = w.buildings.views;
  const B = window.__B;
  const LOW = 1.0;
  /** world-space points of every drawn mesh under root (at most ~max), with the instanced crops expanded */
  const pointsOf = (root, max) => {
    const meshes = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o.parent; p && p !== root.parent; p = p.parent) if (!p.visible) return;
      if (o.isLOD) return;
      meshes.push(o);
    });
    let total = 0;
    for (const o of meshes) total += o.geometry.getAttribute('position').count * (o.isInstancedMesh ? o.count : 1);
    const step = Math.max(1, Math.ceil(total / max));
    const out = [];
    for (const o of meshes) {
      const pos = o.geometry.getAttribute('position');
      const e = o.matrixWorld.elements;
      const inst = o.isInstancedMesh ? o.count : 1;
      for (let j = 0; j < inst; j++) {
        let M = e;
        if (o.isInstancedMesh) {
          const ie = o.instanceMatrix.array.slice(j * 16, j * 16 + 16);
          M = mul(e, ie);
        }
        for (let i = (j * 7) % step; i < pos.count; i += step) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          out.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
        }
      }
    }
    return out;
  };
  function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  const info = new Map();
  for (const b of g.buildings.values()) {
    const v = views.get(b.id);
    if (!v) continue;
    info.set(b.id, { b, v, base: v.group.position.y, top: v.group.position.y + v.height });
  }
  const model = [], pairs = new Map(), terrain = [];
  for (const { b, v, base } of info.values()) {
    const pts = pointsOf(v.group, 8000);
    let low = 0, high = 0, side = '';
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      const o = Math.max(b.x - x, x - (b.x + b.w), b.y - z, z - (b.y + b.h));
      if (o > 0) {
        if (y - base < LOW) {
          if (o > low) {
            low = o;
            side = x < b.x ? '-x' : x > b.x + b.w ? '+x' : z < b.y ? '-z' : '+z';
          }
        } else high = Math.max(high, o);
        // inside a neighbour?
        const tx = Math.floor(x), tz = Math.floor(z);
        if (tx < 0 || tz < 0 || tx >= n || tz >= n) continue;
        const id = m.occupied[tz * n + tx];
        if (!id || id === b.id) continue;
        const nb = info.get(id);
        if (!nb || y > nb.top) continue;
        const d = Math.min(x - nb.b.x, nb.b.x + nb.b.w - x, z - nb.b.y, nb.b.y + nb.b.h - z);
        const key = `${b.id}>${id}`;
        const pr = pairs.get(key) ?? { a: b.id, b: id, aDef: b.def, bDef: nb.b.def, depth: 0, n: 0, at: [x, y, z] };
        pr.n++;
        if (d > pr.depth) (pr.depth = d), (pr.at = [x, y, z]);
        pairs.set(key, pr);
      }
    }
    model.push({ id: b.id, def: b.def, rot: b.rot, x: b.x, y: b.y, w: b.w, h: b.h, low, high, side });
    // terrain along the footprint's edge, just inside it and just outside it
    if (B[b.def].water !== 'dock') {
      let buried = 0, floating = 0;
      for (const inset of [0.06, -0.12]) {
        for (let t = 0; t <= 1.0001; t += 0.125) {
          for (const [x, z] of [[b.x + t * b.w, b.y + inset], [b.x + t * b.w, b.y + b.h - inset], [b.x + inset, b.y + t * b.h], [b.x + b.w - inset, b.y + t * b.h]]) {
            const hgt = m.heightAt(x, z);
            if (inset > 0) buried = Math.max(buried, hgt - base), floating = Math.max(floating, base - hgt);
            else buried = Math.max(buried, (hgt - base) * 0.5);
          }
        }
      }
      terrain.push({ id: b.id, def: b.def, buried, floating });
    } else {
      // a dock's deck against the beach it lands on
      const deckY = base + (v.model.userData.deckY ?? 0.35);
      let worst = 0;
      const [fx, fy] = [[0, 1], [-1, 0], [0, -1], [1, 0]][b.rot];
      const cx = b.x + b.w / 2 + fx * (b.w / 2 + 0.25), cz = b.y + b.h / 2 + fy * (b.h / 2 + 0.25);
      worst = m.heightAt(cx, cz) - deckY;
      terrain.push({ id: b.id, def: b.def, buried: Math.max(0, worst), floating: Math.max(0, -worst), dock: true });
    }
  }
  // trees
  const veg = w.veg;
  const trunkMats = new Set([veg.mats.trunkMat, veg.mats.bTrunkMat]);
  const trees = [];
  const cache = new Map();
  let treeCount = 0;
  for (const im of veg.group.children) {
    if (!im.isInstancedMesh) continue;
    const trunk = trunkMats.has(im.material);
    let pts = cache.get(im.geometry.uuid);
    if (!pts) {
      // every distinct vertex (an independent check of the fitting in vegetation.ts, which uses a thinned set)
      const pos = im.geometry.getAttribute('position');
      const seen = new Set();
      pts = [];
      for (let i = 0; i < pos.count; i++) {
        const key = `${Math.round(pos.getX(i) * 200)},${Math.round(pos.getY(i) * 200)},${Math.round(pos.getZ(i) * 200)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      cache.set(im.geometry.uuid, pts);
    }
    im.updateMatrixWorld(true);
    for (let j = 0; j < im.count; j++) {
      if (!trunk) treeCount++;
      const M = mul(im.matrixWorld.elements, im.instanceMatrix.array.slice(j * 16, j * 16 + 16));
      let worst = 0, what = '', bid = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const x0 = pts[i], y0 = pts[i + 1], z0 = pts[i + 2];
        const x = M[0] * x0 + M[4] * y0 + M[8] * z0 + M[12], y = M[1] * x0 + M[5] * y0 + M[9] * z0 + M[13], z = M[2] * x0 + M[6] * y0 + M[10] * z0 + M[14];
        const tx = Math.floor(x), tz = Math.floor(z);
        if (tx < 0 || tz < 0 || tx >= n || tz >= n) continue;
        const k = tz * n + tx;
        const id = m.occupied[k];
        if (id) {
          const nb = info.get(id);
          if (nb && y < nb.top) {
            const d = Math.min(x - nb.b.x, nb.b.x + nb.b.w - x, z - nb.b.y, nb.b.y + nb.b.h - z);
            if (d > worst) (worst = d), (what = (trunk ? 'trunk in ' : 'crown in ') + nb.b.def), (bid = id);
          }
        } else if (trunk && m.path[k] && y < m.heightAt(x, z) + 1.1) {
          if (0.01 > worst) (worst = 0.01), (what = 'trunk in road');
        }
      }
      if (worst > 0) trees.push({ kind: trunk ? 'trunk' : 'crown', what, depth: worst, at: [M[12], M[13], M[14]], bid });
    }
  }
  return {
    buildings: info.size,
    trees: treeCount,
    fitted: veg.fitted,
    model: model.filter((r) => r.low > 0.1 || r.high > 0.25).sort((a, b) => b.low - a.low),
    pairs: [...pairs.values()].filter((p) => p.depth > 0.03).sort((a, b) => b.depth - a.depth),
    treeHits: trees.sort((a, b) => b.depth - a.depth),
    terrain: terrain.filter((t) => t.buried > 0.12 || t.floating > 0.12).sort((a, b) => Math.max(b.buried, b.floating) - Math.max(a.buried, a.floating)),
  };
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const summary = [];
for (const seed of seeds) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`));
  const t0 = Date.now();
  await p.goto(`${base}/?play=1&seed=${seed}&bot=${bot}&q=${q}${extra ? '&' + extra : ''}`, { timeout: 600000 });
  await p.waitForFunction(() => window.__app?.state === 'game' && !document.querySelector('.loading'), null, { timeout: 900000, polling: 1000 });
  await p.evaluate(async () => {
    document.querySelector('.gpu-notice button')?.click();
    const a = window.__app;
    a.game.paused = true;
    a.hud.dismissAdvisor?.();
    window.__B = (await import('/src/sim/data/buildings.ts')).BUILDING;
    window.__render = a.world.render.bind(a.world);
    a.world.render = () => {};
  });
  // a few frames so every view and batch is up to date
  for (let i = 0; i < 3; i++) await p.evaluate(() => window.__render());
  console.log(`seed ${seed}: loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const r = await p.evaluate(`(${analyse.toString()})()`);
  fs.writeFileSync(`${OUT}/overlap_${seed}.json`, JSON.stringify(r, null, 1));
  const f2 = (v) => v.toFixed(2);
  console.log(`seed ${seed}: ${r.buildings} buildings, ${r.trees} trees (fitted: ${r.fitted?.moved ?? "-"} moved, ${r.fitted?.dropped ?? "-"} left out, ${r.fitted?.ms?.toFixed(0) ?? "-"} ms)`);
  console.log(`  model past footprint (ground level > 0.1): ${r.model.filter((x) => x.low > 0.1).length}`);
  for (const x of r.model.slice(0, 12)) console.log(`    ${x.def.padEnd(18)} #${x.id} rot ${x.rot}  low ${f2(x.low)} ${x.side}  high ${f2(x.high)}`);
  console.log(`  building inside a neighbour: ${r.pairs.length}`);
  for (const x of r.pairs.slice(0, 12)) console.log(`    ${x.aDef} #${x.a} -> ${x.bDef} #${x.b}  depth ${f2(x.depth)} (${x.n} pts) at ${x.at.map(f2).join(',')}`);
  const tc = r.treeHits.filter((t) => t.kind === 'crown').length, tt = r.treeHits.filter((t) => t.kind === 'trunk').length;
  console.log(`  trees: ${tc} crowns and ${tt} trunks in buildings/roads`);
  for (const x of r.treeHits.slice(0, 10)) console.log(`    ${x.what.padEnd(28)} depth ${f2(x.depth)} at ${x.at.map(f2).join(',')}`);
  console.log(`  terrain: ${r.terrain.length} footprints buried/floating > 0.12`);
  for (const x of r.terrain.slice(0, 10)) console.log(`    ${x.def.padEnd(18)} #${x.id} buried ${f2(x.buried)} floating ${f2(x.floating)}${x.dock ? ' (dock deck vs beach)' : ''}`);
  summary.push({ seed, model: r.model.filter((x) => x.low > 0.1).length, pairs: r.pairs.length, crowns: tc, trunks: tt, terrain: r.terrain.length });
  // close-ups of the worst cases
  const cases = [
    ...r.pairs.slice(0, shots).map((x) => ({ name: `pair_${x.aDef}_${x.bDef}`, at: x.at })),
    ...r.treeHits.slice(0, Math.ceil(shots / 2)).map((x) => ({ name: `tree_${x.what.replace(/ /g, '_')}`, at: x.at })),
    ...r.model.slice(0, Math.ceil(shots / 2)).map((x) => ({ name: `model_${x.def}`, at: [x.x + x.w / 2, 0, x.y + x.h / 2] })),
  ];
  for (const [i, c] of cases.entries()) {
    await p.evaluate(([x, z]) => {
      const w = window.__app.world;
      w.rig.lookAt(x, z, true);
      w.rig.setDist(9, true);
      for (let k = 0; k < 40; k++) w.rig.update(0.1, innerWidth, innerHeight);
      window.__render();
      window.__render();
    }, [c.at[0], c.at[2]]);
    await p.screenshot({ path: `${OUT}/s${seed}_${String(i).padStart(2, '0')}_${c.name}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('\nsummary', JSON.stringify(summary));
fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
