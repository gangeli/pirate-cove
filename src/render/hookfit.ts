/**
 * Placing a model's flag and smoke hooks clear of the model itself (pure: used by bldmodels.ts and
 * scripts/overlap/hooks.mts). Points are the model's vertices in its own space, xyz interleaved.
 */

/**
 * Smoke rises from its marker; a hearth under a tent fly, a spit under a roast or a brazier under a pavilion roof
 * would send it straight through the cover. Such smoke starts just above what covers it instead (as if seeping
 * out). Returns the height to start at.
 */
export function smokeStart(pts: ArrayLike<number>, p: [number, number, number]): number {
  let top = -Infinity, n = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const y = pts[i + 1] - p[1];
    if (y > 0.05 && y < 1.2 && Math.hypot(pts[i] - p[0], pts[i + 2] - p[2]) < 0.1 + y * 0.15) (top = Math.max(top, pts[i + 1])), n++;
  }
  return n > 8 ? top + 0.08 : p[1];
}

/** the cloth of kit.ts flag(): 0.7 x 0.48 flying toward +x from the pole, its top just under the marker */
export const FLAG_L = 0.72;

/** model vertices inside a flag flying along (dx, dz) at scale s, plus a penalty for flying off the lot */
export function flagScore(pts: ArrayLike<number>, p: [number, number, number], lot: [number, number] | null, dx: number, dz: number, s: number): { hits: number; out: number } {
  let hits = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] - p[0], y = pts[i + 1] - p[1], z = pts[i + 2] - p[2];
    const along = x * dx + z * dz, across = Math.abs(-x * dz + z * dx);
    if (along > 0.06 && along < FLAG_L * s && y > -0.55 * s && y < -0.03 && across < 0.08) hits++;
  }
  const ex = p[0] + dx * FLAG_L * s, ez = p[2] + dz * FLAG_L * s;
  const out = lot ? Math.max(0, ex - lot[0] / 2, -lot[0] / 2 - ex, ez - lot[1] / 2, -lot[1] / 2 - ez) : 0;
  return { hits, out };
}

/**
 * A flag's cloth flies to one side of its pole. Turn it to the side where it cuts through the least of the model
 * and stays over the lot, smaller on lots too small for it (1x1 decorations). Returns the y rotation and scale.
 */
export function flagFit(pts: ArrayLike<number>, p: [number, number, number], lot: [number, number] | null): { ry: number; s: number } {
  const cost = (dx: number, dz: number, s: number) => {
    const r = flagScore(pts, p, lot, dx, dz, s);
    return r.hits + r.out * 400 + (1 - s) * 30;
  };
  let best = { ry: 0, s: 1, v: cost(1, 0, 1) };
  if (best.v === 0) return best;
  for (const s of [1, 0.8, 0.65])
    for (const [dx, dz, ry] of [[1, 0, 0], [-1, 0, Math.PI], [0, -1, Math.PI / 2], [0, 1, -Math.PI / 2]]) {
      const v = cost(dx, dz, s);
      if (v < best.v) best = { ry, s, v };
    }
  return best;
}
