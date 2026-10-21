/**
 * Keeping trees out of buildings (pure: used by vegetation.ts, tested in tests/treefit.test.ts).
 *
 * A tree stands on its own tile, but a palm leans up to half a tile and its fronds spread two, and a jungle
 * tree's crown is as wide; next to a building they ran through walls and roofs. Each tree type carries a
 * sparse cloud of points from its own geometry (trunk line and crown); a placement fits when no crown point is
 * inside a building's box (its tiles, up to the top of its model) and no trunk point stands in a building or,
 * below head height, in a road. A tree that does not fit as generated is tried leaning another way, moved
 * within its tile and made smaller, and left out only when nothing fits: crowns may still spread over a roof
 * from above, as real trees do.
 */

export interface FitMap {
  size: number;
  occupied: ArrayLike<number>;
  path: ArrayLike<number>;
  heightAt(x: number, z: number): number;
}

/** world-space top of whatever is built on tile k (0 when nothing is) */
export type TopFn = (k: number) => number;

export interface TreeShape {
  /** model-space crown points, xyz */
  crown: Float32Array;
  /** model-space trunk points, xyz */
  trunk: Float32Array;
  /** horizontal reach of any point from the trunk base, model units */
  reach: number;
  /** keep the crown off roads too (low bushes that people would walk through) */
  lowCrown?: boolean;
}

/** a sparse point set from geometry positions: the distinct vertices (triangle soups repeat them), thinned to ~max */
export function samplePoints(pos: ArrayLike<number>, max: number): Float32Array {
  const seen = new Set<string>();
  const uniq: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${Math.round(pos[i] * 200)},${Math.round(pos[i + 1] * 200)},${Math.round(pos[i + 2] * 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(pos[i], pos[i + 1], pos[i + 2]);
  }
  const n = uniq.length / 3;
  const step = Math.max(1, n / max);
  const out: number[] = [];
  for (let f = 0; f < n; f += step) {
    const i = Math.floor(f);
    out.push(uniq[i * 3], uniq[i * 3 + 1], uniq[i * 3 + 2]);
  }
  return new Float32Array(out);
}

export function shapeOf(crown: Float32Array, trunk: Float32Array, lowCrown = false): TreeShape {
  let reach = 0;
  for (const a of [crown, trunk]) for (let i = 0; i < a.length; i += 3) reach = Math.max(reach, Math.hypot(a[i], a[i + 2]));
  return { crown, trunk, reach, lowCrown };
}

/** head height above the ground: a trunk or bush below it in a road is in people's way */
const HEAD = 1.1;

/**
 * Does a tree with this column-major 4x4 transform (three.js Matrix4.elements) stay clear of buildings and roads?
 * Tiles are unit squares, world x/z = tile column/row.
 */
export function treeFits(shape: TreeShape, e: ArrayLike<number>, map: FitMap, top: TopFn): boolean {
  const n = map.size;
  const test = (pts: Float32Array, trunk: boolean): boolean => {
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const tx = Math.floor(wx), tz = Math.floor(wz);
      if (tx < 0 || tz < 0 || tx >= n || tz >= n) continue;
      const k = tz * n + tx;
      if (map.occupied[k]) {
        const t = top(k);
        if (t > 0 && wy < t + 0.05) return false;
      }
      if ((trunk || shape.lowCrown) && map.path[k] && wy < map.heightAt(wx, wz) + HEAD) return false;
    }
    return true;
  };
  return test(shape.trunk, true) && test(shape.crown, false);
}

/** is anything a tree could run into within r tiles of (x, z)? (most trees are nowhere near the town) */
export function anythingNear(map: FitMap, x: number, z: number, r: number): boolean {
  const n = map.size;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(n - 1, Math.floor(x + r));
  const z0 = Math.max(0, Math.floor(z - r)), z1 = Math.min(n - 1, Math.floor(z + r));
  for (let j = z0; j <= z1; j++)
    for (let i = x0; i <= x1; i++) {
      const k = j * n + i;
      if (map.occupied[k] || map.path[k]) return true;
    }
  return false;
}

/**
 * A fingerprint of what stands within r tiles of (x, z) (0 when nothing does): a tree whose surroundings have the
 * same fingerprint as last time can keep last time's pose (vegetation rebuilds on every road tile laid).
 */
export function nearSignature(map: FitMap, top: TopFn, x: number, z: number, r: number): number {
  const n = map.size;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(n - 1, Math.floor(x + r));
  const z0 = Math.max(0, Math.floor(z - r)), z1 = Math.min(n - 1, Math.floor(z + r));
  let h = 0;
  for (let j = z0; j <= z1; j++)
    for (let i = x0; i <= x1; i++) {
      const k = j * n + i;
      const o = map.occupied[k], p = map.path[k];
      if (!o && !p) continue;
      const v = (o ? o * 31 + Math.round(top(k) * 20) : 0) * 2 + (p ? 1 : 0);
      h = (Math.imul(h ^ (k * 2654435761), 16777619) + v) | 0;
      if (!h) h = 1;
    }
  return h;
}

export interface TreePose {
  x: number;
  z: number;
  yaw: number;
  sc: number;
}

/**
 * The first pose that fits, trying the generated one, then other leanings, other spots in the tile and smaller
 * sizes (in that order of preference); null when none does. `compose` builds the transform for a pose.
 */
export function fitTree(shape: TreeShape, pose: TreePose, tile: [number, number], map: FitMap, top: TopFn, compose: (p: TreePose) => ArrayLike<number>, opts: { yaws?: number; minScale?: number } = {}): TreePose | null {
  if (!anythingNear(map, pose.x, pose.z, shape.reach * pose.sc + 0.6)) return pose;
  if (treeFits(shape, compose(pose), map, top)) return pose;
  const yaws = opts.yaws ?? 6;
  const scales = [1, 0.84, 0.7].filter((s) => s >= (opts.minScale ?? 0.7) - 1e-6);
  const [tx, tz] = tile;
  const spots: [number, number][] = [[pose.x, pose.z], [tx + 0.5, tz + 0.5], [tx + 0.22, tz + 0.22], [tx + 0.78, tz + 0.22], [tx + 0.22, tz + 0.78], [tx + 0.78, tz + 0.78]];
  for (const s of scales)
    for (const [x, z] of spots)
      for (let y = 0; y < yaws; y++) {
        const p = { x, z, yaw: pose.yaw + (y * Math.PI * 2) / yaws, sc: pose.sc * s };
        if (treeFits(shape, compose(p), map, top)) return p;
      }
  return null;
}
