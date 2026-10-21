/**
 * Farm crops vs. what the modelled farm stands in its field (shelter, water butt, scarecrow) and the field's edge.
 *   npx tsx scripts/overlap/crops.mts
 * Lays the plants out exactly as the game does (src/render/croplayout.ts) and, for each plant, measures the gap
 * between its leaf spread and the nearest farm geometry above the soil (walls excepted: leaves may hang over a
 * dry-stone wall), and whether its leaves pass the footprint's edge.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb.ts';
import { cropLayout, PLANT_R } from '../../src/render/croplayout.ts';
import { BUILDING } from '../../src/sim/data/buildings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FARMS: Record<string, string> = { corn_farm: 'corn', banana_farm: 'banana', papaya_farm: 'papaya', sugar_farm: 'sugarcane', tobacco_farm: 'tobacco' };
let bad = 0;
for (const [def, kind] of Object.entries(FARMS)) {
  const [W, D] = BUILDING[def].size;
  const g = await readGlb(join(root, 'public/assets/buildings', def + '.glb'));
  // obstacles: geometry above the soil, except the field's ground and its boundary walls
  const obs: number[] = [];
  for (const m of g.meshes) for (const r of m.mats) {
    if (['dirt', 'soil', 'stone'].includes(r.mat)) continue;
    for (let i = r.start; i < r.start + r.count; i += 3) if (m.pos[i * 3 + 1] > 0.05) obs.push(m.pos[i * 3], m.pos[i * 3 + 2]);
  }
  let s = 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const plants = cropLayout(W, D, kind, true, rnd);
  let worst = Infinity, edge = -Infinity;
  for (const p of plants) {
    const stem = 0.06 * p.sc, leaves = PLANT_R[kind] * p.sc;
    for (let i = 0; i < obs.length; i += 2) worst = Math.min(worst, Math.hypot(obs[i] - p.x, obs[i + 1] - p.z) - stem);
    edge = Math.max(edge, Math.abs(p.x) + leaves - W / 2, Math.abs(p.z) + leaves - D / 2);
  }
  const ok = worst > 0.12 && edge <= 0.02;
  if (!ok) bad++;
  console.log(`${def.padEnd(14)} ${String(plants.length).padStart(3)} plants  nearest farm prop to a stem ${worst.toFixed(2)}  leaves past the lot edge ${edge.toFixed(2)}  ${ok ? 'ok' : 'OVERLAP'}`);
}
console.log(bad ? `${bad} farms with crops in their props or over the edge` : 'all farms clear');
