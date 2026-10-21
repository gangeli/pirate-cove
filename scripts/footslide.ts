// Foot slide from a walk-test log (feet.json from scripts/walktest.mjs), at planted thresholds of 1 and 2 cm (model).
//   npx tsx scripts/footslide.ts <feet.json> [...]
import fs from 'node:fs';
import { measureSlide } from '../src/render/gait';
for (const f of process.argv.slice(2)) {
  console.log(f);
  for (const w of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const r = [0.01, 0.02].map((e) => measureSlide(w.log, e * 0.68));
    console.log(`  ${w.name.padEnd(9)} ${w.speed.toFixed(2)} t/s  slide ${(r[0].slideRatio * 100).toFixed(1)}% (1cm)  ${(r[1].slideRatio * 100).toFixed(1)}% (2cm)  ${r[1].slideSpeed.toFixed(3)} t/s`);
  }
}
