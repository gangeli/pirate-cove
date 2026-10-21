/**
 * Flags and chimney smoke vs. the model they hang on.
 *   npx tsx scripts/overlap/hooks.mts
 * A `flag` marker becomes a 0.7 x 0.48 cloth flying toward +x below the marker (src/render/kit.ts flag, placed by
 * bldmodels.ts): any model geometry inside that sheet (beyond the pole) means the flag cuts through the building.
 * A `smoke` marker emits puffs that rise: geometry right above it means smoke coming out from under a roof.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from './glb.ts';
import { BUILDING } from '../../src/sim/data/buildings.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'public/assets/buildings');
const names: string[] = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let issues = 0;
for (const name of names) {
  if (name.startsWith('plant_')) continue;
  const g = await readGlb(join(dir, name + '.glb'));
  const def = BUILDING[name] ? name : name.replace(/_\d+$/, '');
  const [W, D] = BUILDING[def].size;
  for (const mk of g.markers) {
    const [px, py, pz] = mk.p;
    let hits = 0;
    if (mk.name.startsWith('flag')) {
      for (const m of g.meshes) for (let i = 0; i < m.pos.length; i += 3) {
        const x = m.pos[i] - px, y = m.pos[i + 1] - py, z = m.pos[i + 2] - pz;
        if (x > 0.06 && x < 0.72 && y > -0.55 && y < -0.03 && Math.abs(z) < 0.08) hits++;
      }
      const out = Math.max(px + 0.71 - W / 2, 0);
      if (hits || out > 0.1) {
        issues++;
        console.log(`${name.padEnd(20)} flag at ${mk.p.map((v) => v.toFixed(2)).join(',')}: ${hits} model vertices inside the cloth${out > 0.1 ? `, flies ${out.toFixed(2)} past the lot (+x)` : ''}`);
      }
    } else if (mk.name.startsWith('smoke')) {
      for (const m of g.meshes) for (let i = 0; i < m.pos.length; i += 3) {
        const x = m.pos[i] - px, y = m.pos[i + 1] - py, z = m.pos[i + 2] - pz;
        if (y > 0.05 && y < 1.0 && Math.hypot(x, z) < 0.1 + y * 0.15) hits++;
      }
      if (hits > 8) {
        issues++;
        console.log(`${name.padEnd(20)} smoke at ${mk.p.map((v) => v.toFixed(2)).join(',')}: ${hits} model vertices right above it`);
      }
    }
  }
}
console.log(issues ? `${issues} flag/smoke hooks run into their models` : 'all flags and smoke clear');
