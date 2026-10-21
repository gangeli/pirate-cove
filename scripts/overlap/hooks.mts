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
import { flagFit, flagScore, smokeStart } from '../../src/render/hookfit.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'public/assets/buildings');
const names: string[] = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
let issues = 0, after = 0;
for (const name of names) {
  if (name.startsWith('plant_')) continue;
  const g = await readGlb(join(dir, name + '.glb'));
  const def = BUILDING[name] ? name : name.replace(/_\d+$/, '');
  const [W, D] = BUILDING[def].size;
  const pts = new Float32Array(g.meshes.reduce((n, m) => n + m.pos.length, 0));
  let o = 0;
  for (const m of g.meshes) pts.set(m.pos, o), (o += m.pos.length);
  for (const mk of g.markers) {
    const p = mk.p;
    const at = p.map((v) => v.toFixed(2)).join(',');
    if (mk.name.startsWith('flag')) {
      // as authored (flying +x), and as the game turns it (hookfit.ts)
      const r0 = flagScore(pts, p, [W, D], 1, 0, 1);
      const fit = flagFit(pts, p, [W, D]);
      const r1 = flagScore(pts, p, [W, D], Math.round(Math.cos(fit.ry)), -Math.round(Math.sin(fit.ry)), fit.s);
      if (r0.hits || r0.out > 0.1) {
        issues++;
        if (r1.hits || r1.out > 0.1) after++;
        console.log(`${name.padEnd(20)} flag at ${at}: ${r0.hits} vertices in the cloth, ${r0.out.toFixed(2)} off the lot  ->  turned ${(fit.ry * 180 / Math.PI).toFixed(0)}deg x${fit.s}: ${r1.hits} vertices, ${r1.out.toFixed(2)} off`);
      }
    } else if (mk.name.startsWith('smoke')) {
      let hits = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i] - p[0], y = pts[i + 1] - p[1], z = pts[i + 2] - p[2];
        if (y > 0.05 && y < 1.0 && Math.hypot(x, z) < 0.1 + y * 0.15) hits++;
      }
      if (hits > 8) {
        issues++;
        console.log(`${name.padEnd(20)} smoke at ${at}: ${hits} model vertices right above it  ->  starts at y ${smokeStart(pts, p).toFixed(2)}`);
      }
    }
  }
}
console.log(`${issues} flag/smoke hooks ran into their models as authored; ${after} flags still do after the game turns them (smoke is lifted above its cover)`);
