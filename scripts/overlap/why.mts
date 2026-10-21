/** npx tsx scripts/overlap/why.mts <model> [margin]: where a model's geometry leaves its footprint (per material, bbox of the parts outside) */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb.ts';
import { BUILDING } from '../../src/sim/data/buildings.ts';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const name = process.argv[2];
const margin = Number(process.argv[3] ?? 0);
const def = BUILDING[name] ? name : name.replace(/_(\d+|lod)$/, '').replace(/_\d+$/, '');
const [W, D] = BUILDING[def].size;
const hw = W / 2 - margin, hd = D / 2 - margin;
const g = await readGlb(join(root, 'public/assets/buildings', name + '.glb'));
const box = new Map<string, number[]>();
for (const m of g.meshes) for (const r of m.mats) for (let i = r.start; i < r.start + r.count; i++) {
  const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
  for (const [side, o] of [['+x', x - hw], ['-x', -hw - x], ['+z', z - hd], ['-z', -hd - z]] as [string, number][]) {
    if (o <= 0) continue;
    const k = `${r.mat} ${side}`;
    const b = box.get(k) ?? [1e9, 1e9, 1e9, -1e9, -1e9, -1e9, 0];
    b[0] = Math.min(b[0], x), b[1] = Math.min(b[1], y), b[2] = Math.min(b[2], z), b[3] = Math.max(b[3], x), b[4] = Math.max(b[4], y), b[5] = Math.max(b[5], z), b[6]++;
    box.set(k, b);
  }
}
console.log(`${name} ${W}x${D} (edges x ±${hw}, z ±${hd})`);
for (const [k, b] of [...box].sort()) console.log(k.padEnd(18), `n=${b[6]}`.padEnd(8), `x ${b[0].toFixed(2)}..${b[3].toFixed(2)}  y ${b[1].toFixed(2)}..${b[4].toFixed(2)}  z ${b[2].toFixed(2)}..${b[5].toFixed(2)}`);
