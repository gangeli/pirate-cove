/**
 * Where a farm's plants stand (pure: shared by the crop instancing in prefabs.ts and scripts/overlap).
 * Plants keep inside the field by their own spread, so broad banana and papaya leaves no longer hang over the
 * field walls into the next lot, and stay clear of what the modelled farm puts in the field (the farmers'
 * shelter in the back-right corner, the water butt, the corn field's scarecrow; scripts/blender/bld/defs_core.py).
 */

/** a plant model's leaf spread at scale 1 (radius from its stem, tiles) */
export const PLANT_R: Record<string, number> = { corn: 0.27, banana: 0.43, papaya: 0.44, sugarcane: 0.33, tobacco: 0.23 };

export interface Plant {
  x: number;
  z: number;
  rot: number;
  sc: number;
}

/** things the modelled farm stands in its field (W x D centred on the origin, front +z): rects and discs */
export function farmKeepOut(W: number, D: number, kind: string): { rects: [number, number, number, number][]; discs: [number, number, number][] } {
  // shelter: centred (W/2 - 0.57, -D/2 + 0.54), roof ~0.43 each way
  const sx = W / 2 - 0.57, sz = -D / 2 + 0.54;
  const rects: [number, number, number, number][] = [[sx - 0.45, sz - 0.45, sx + 0.45, sz + 0.45]];
  const discs: [number, number, number][] = [[-W / 2 + 0.25, D / 2 - 0.2, 0.14]];
  if (kind === 'corn') discs.push([-0.6, 0, 0.24]);
  return { rects, discs };
}

export function cropLayout(W: number, D: number, kind: string, bare: boolean, r: () => number): Plant[] {
  const R = PLANT_R[kind] ?? 0.3;
  const per = kind === 'banana' || kind === 'papaya' ? 3 : 7;
  const rows = Math.round(D * 2.2);
  const cols = Math.round((W * per) / 3);
  // keep each plant's leaves inside the field
  const m = Math.max(0.25, R * 1.12);
  const keep = bare ? farmKeepOut(W, D, kind) : { rects: [], discs: [] };
  const out: Plant[] = [];
  for (let rr = 0; rr < rows; rr++)
    for (let c = 0; c < cols; c++) {
      const x = -W / 2 + m + (c / Math.max(1, cols - 1)) * (W - 2 * m) + (r() - 0.5) * 0.05;
      const z = -D / 2 + m + (rr / Math.max(1, rows - 1)) * (D - 2 * m);
      const rot = r() * 6.28;
      const sc = Math.min(0.8 + r() * 0.4, (m + 0.03) / R);
      const rad = R * sc * 0.7; // leaves may brush a neighbour, stems may not
      if (keep.rects.some(([x0, z0, x1, z1]) => x + rad > x0 && x - rad < x1 && z + rad > z0 && z - rad < z1)) continue;
      if (keep.discs.some(([dx, dz, dr]) => Math.hypot(x - dx, z - dz) < dr + rad)) continue;
      out.push({ x, z, rot, sc });
    }
  return out;
}
