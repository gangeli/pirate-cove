/**
 * Building models vs. their own tile footprint.
 *
 *   npx tsx scripts/overlap/footprints.mts [--lod] [--all] [--json out.json] [name...]
 *
 * For every building GLB (public/assets/buildings, plus the far LODs with --lod) this decodes the geometry and
 * measures how far it reaches past the def's footprint (size W x D tiles, centred on the origin, front +z).
 * Each model is placed by BuildingsView rotated about the footprint centre, so the rot-0 frame is the one to
 * check (a rotation turns the footprint and the model together).
 *
 * Reported per model, ranked by the ground-level overhang (what runs into a neighbour's walls):
 *   low   - vertices below 1.0 tiles high: walls, fences, props, steps
 *   high  - vertices above: eaves and roofs, which pass over a neighbour's low parts but meet its eaves
 *   out%  - share of vertices outside the footprint
 *   parts - the materials that stick out furthest (what to fix)
 * A neighbour's model keeps a margin (the convention is ~0.15 inside its edge), so up to 0.1 past the edge is OK.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb.ts';
import { BUILDING } from '../../src/sim/data/buildings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'public/assets/buildings');
const args = process.argv.slice(2);
const lod = args.includes('--lod');
const all = args.includes('--all');
const ji = args.indexOf('--json');
const jsonOut = ji >= 0 ? args[ji + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
const OK = 0.1;
const LOW = 1.0;

const names: string[] = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
export interface Row {
  model: string;
  def: string;
  size: [number, number];
  low: number;
  high: number;
  side: string;
  outPct: number;
  parts: string;
  bbox: [number, number, number, number, number, number];
}
const rows: Row[] = [];
for (const name of names) {
  if (name.startsWith('plant_')) continue;
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  const def = BUILDING[name] ? name : name.replace(/_\d+$/, '');
  const d = BUILDING[def];
  if (!d) {
    console.warn('no def for', name);
    continue;
  }
  const [W, D] = d.size;
  const hw = W / 2, hd = D / 2;
  for (const file of lod ? [name, name + '_lod'] : [name]) {
    let g;
    try {
      g = await readGlb(join(dir, file + '.glb'));
    } catch (e) {
      console.warn('failed', file, (e as Error).message);
      continue;
    }
    let low = -9, high = -9, n = 0, out = 0;
    const side = { '+x': -9, '-x': -9, '+z': -9, '-z': -9 };
    const byMat = new Map<string, number>();
    const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (const m of g.meshes) {
      for (const r of m.mats) {
        for (let i = r.start; i < r.start + r.count; i++) {
          const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
          bb[0] = Math.min(bb[0], x), bb[1] = Math.min(bb[1], y), bb[2] = Math.min(bb[2], z);
          bb[3] = Math.max(bb[3], x), bb[4] = Math.max(bb[4], y), bb[5] = Math.max(bb[5], z);
          n++;
          const o = Math.max(x - hw, -hw - x, z - hd, -hd - z);
          // (signed: a model that stays inside reports how far inside its nearest part is)
          if (y < LOW) low = Math.max(low, o);
          else high = Math.max(high, o);
          if (y < LOW) {
            side['+x'] = Math.max(side['+x'], x - hw), side['-x'] = Math.max(side['-x'], -hw - x);
            side['+z'] = Math.max(side['+z'], z - hd), side['-z'] = Math.max(side['-z'], -hd - z);
          }
          if (o <= 0) continue;
          out++;
          const k = r.mat + (y < LOW ? '' : '^');
          byMat.set(k, Math.max(byMat.get(k) ?? 0, o));
        }
      }
    }
    const parts = [...byMat].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    const sides = Object.entries(side).map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join(' ');
    rows.push({ model: file, def, size: [W, D], low, high, side: sides, outPct: (100 * out) / Math.max(1, n), parts, bbox: bb as Row['bbox'] });
  }
}
rows.sort((a, b) => b.low - a.low || b.high - a.high);
const bad = rows.filter((r) => r.low > OK || r.high > OK * 2);
const show = all ? rows : bad;
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log(pad('model', 22), pad('size', 6), pad('low', 6), pad('high', 6), pad('out%', 6), pad('ground reach by side', 36), 'parts');
for (const r of show) console.log(pad(r.model, 22), pad(r.size.join('x'), 6), pad(r.low.toFixed(2), 6), pad(r.high.toFixed(2), 6), pad(r.outPct.toFixed(1), 6), pad(r.side, 36), r.parts);
console.log(`\n${rows.length} models checked; ${rows.filter((r) => r.low > OK).length} reach past their footprint at ground level by more than ${OK}, ${rows.filter((r) => r.high > OK * 2).length} overhang above by more than ${OK * 2}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
