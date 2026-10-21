import { Noise2D, Rng } from './rng';

export const enum Terrain {
  DeepWater = 0,
  Shallow = 1,
  Beach = 2,
  Grass = 3,
  Jungle = 4,
  Hill = 5,
  Mountain = 6,
}

export const SEA_LEVEL = 0;

export interface IslandOptions {
  size: number; // tiles per side
  seed: number;
  landFraction?: number; // 0..1 roughly, island size
  mountainousness?: number; // 0..1
  jungle?: number; // 0..1 tree density
}

export class GameMap {
  readonly size: number;
  /** height at tile vertices, (size+1)^2 */
  readonly vh: Float32Array;
  /** per-tile */
  readonly height: Float32Array;
  readonly terrain: Uint8Array;
  readonly trees: Uint8Array; // 0..4 trees on tile
  readonly fertility: Float32Array; // 0..1
  readonly ore: Float32Array; // 0..1 iron richness
  readonly occupied: Int32Array; // building id or 0
  readonly path: Uint8Array; // 1 if dirt path
  readonly seed: number;
  dockSites: { x: number; y: number; dir: number }[] = [];

  constructor(opts: IslandOptions) {
    const n = (this.size = opts.size);
    this.seed = opts.seed;
    this.vh = new Float32Array((n + 1) * (n + 1));
    this.height = new Float32Array(n * n);
    this.terrain = new Uint8Array(n * n);
    this.trees = new Uint8Array(n * n);
    this.fertility = new Float32Array(n * n);
    this.ore = new Float32Array(n * n);
    this.occupied = new Int32Array(n * n);
    this.path = new Uint8Array(n * n);
    generateIsland(this, opts);
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }
  terrainAt(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) return Terrain.DeepWater;
    return this.terrain[this.idx(x, y)];
  }
  isLand(x: number, y: number): boolean {
    const t = this.terrainAt(x, y);
    return t >= Terrain.Beach;
  }
  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrain[this.idx(x, y)];
    return t >= Terrain.Beach && t !== Terrain.Mountain;
  }
  /** bilinear height in world coords where tile (x,y) spans [x,x+1]x[y,y+1] */
  heightAt(wx: number, wy: number): number {
    const n = this.size;
    const x = Math.max(0, Math.min(n - 0.001, wx));
    const y = Math.max(0, Math.min(n - 0.001, wy));
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const s = n + 1;
    const h00 = this.vh[iy * s + ix], h10 = this.vh[iy * s + ix + 1];
    const h01 = this.vh[(iy + 1) * s + ix], h11 = this.vh[(iy + 1) * s + ix + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }
  /** max-min vertex height in a rect (for build slope check) */
  slopeOf(x: number, y: number, w: number, h: number): number {
    const s = this.size + 1;
    let lo = Infinity, hi = -Infinity;
    for (let j = y; j <= y + h; j++)
      for (let i = x; i <= x + w; i++) {
        const v = this.vh[j * s + i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return hi - lo;
  }
  /**
   * Flatten vertices under a footprint to their mean (called when building placed). Vertices for which `keep`
   * says so (corners shared with a building already standing) keep their height and set the level: a new
   * building next to an old one sits at the old one's level, instead of re-levelling their shared edge and
   * leaving the old building's walls buried in a bank or standing over a dip.
   */
  flatten(x: number, y: number, w: number, h: number, keep?: (i: number, j: number) => boolean): number {
    const s = this.size + 1;
    let sum = 0, c = 0, ks = 0, kc = 0;
    for (let j = y; j <= y + h; j++)
      for (let i = x; i <= x + w; i++) {
        const v = this.vh[j * s + i];
        sum += v;
        c++;
        if (keep?.(i, j)) (ks += v), kc++;
      }
    const m = Math.max(kc ? ks / kc : sum / c, 0.15);
    for (let j = y; j <= y + h; j++)
      for (let i = x; i <= x + w; i++) if (!(kc && keep!(i, j))) this.vh[j * s + i] = m;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.height[this.idx(i, j)] = m;
    return m;
  }
  /** distance-to-sea in tiles, computed lazily */
  private _coastDist?: Float32Array;
  coastDist(): Float32Array {
    if (this._coastDist) return this._coastDist;
    const n = this.size;
    const d = new Float32Array(n * n).fill(1e9);
    const q: number[] = [];
    for (let i = 0; i < n * n; i++)
      if (this.terrain[i] <= Terrain.Shallow) {
        d[i] = 0;
        q.push(i);
      }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % n, y = (i / n) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = ny * n + nx;
        if (d[j] > d[i] + 1) {
          d[j] = d[i] + 1;
          q.push(j);
        }
      }
    }
    return (this._coastDist = d);
  }
  landTiles(): number {
    let c = 0;
    for (let i = 0; i < this.terrain.length; i++) if (this.terrain[i] >= Terrain.Beach) c++;
    return c;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function generateIsland(m: GameMap, opts: IslandOptions): void {
  const rng = new Rng(opts.seed);
  const nz = new Noise2D(rng);
  const nz2 = new Noise2D(rng);
  const nz3 = new Noise2D(rng);
  const n = m.size;
  const s = n + 1;
  const land = opts.landFraction ?? 0.55;
  const mtn = opts.mountainousness ?? 0.5;
  // island centre slightly offset, elongated randomly
  const cx = n * (0.5 + rng.range(-0.05, 0.05));
  const cy = n * (0.5 + rng.range(-0.05, 0.05));
  const ang = rng.range(0, Math.PI);
  const elong = rng.range(1.0, 1.5);
  const radius = n * (0.17 + 0.16 * land);
  // a secondary peak for interesting shape
  const px = cx + Math.cos(ang) * radius * 0.35, py = cy + Math.sin(ang) * radius * 0.35;
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      let dx = x - cx, dy = y - cy;
      const rx = dx * Math.cos(ang) + dy * Math.sin(ang);
      const ry = -dx * Math.sin(ang) + dy * Math.cos(ang);
      const d = Math.sqrt((rx / elong) ** 2 + (ry * elong * 0.8) ** 2) / radius;
      const warp = nz.fbm(x * 0.018, y * 0.018, 4) * 0.45;
      let base = 1 - d + warp; // >0 => land-ish
      // coastline detail
      base += nz2.fbm(x * 0.06, y * 0.06, 3) * 0.12;
      // height
      let h: number;
      if (base < 0) {
        h = base * 9; // ocean floor drop
      } else {
        const inland = smoothstep(0, 0.9, base);
        const ridges = 1 - Math.abs(nz3.fbm(x * 0.03, y * 0.03, 4));
        const pd = Math.hypot(x - px, y - py) / radius;
        const peak = Math.max(0, 1 - pd * 1.6) ** 2;
        h = 0.25 + inland * 2.2 + (ridges ** 3) * inland * 5 * mtn + peak * 9 * mtn + nz2.fbm(x * 0.1, y * 0.1, 2) * 0.25 * inland;
      }
      m.vh[y * s + x] = h;
    }
  }
  // per-tile classification
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = m.vh[y * s + x], b = m.vh[y * s + x + 1], c = m.vh[(y + 1) * s + x], d = m.vh[(y + 1) * s + x + 1];
      const h = (a + b + c + d) / 4;
      const slope = Math.max(a, b, c, d) - Math.min(a, b, c, d);
      m.height[i] = h;
      let t: Terrain;
      if (h < -1.2) t = Terrain.DeepWater;
      else if (h < 0.05) t = Terrain.Shallow;
      else if (h < 0.55) t = Terrain.Beach;
      else if (h > 7.5 || slope > 1.6) t = Terrain.Mountain;
      else if (h > 4.2 || slope > 0.9) t = Terrain.Hill;
      else t = Terrain.Grass;
      m.terrain[i] = t;
    }
  }
  // jungle + trees, fertility, ore
  const jungle = opts.jungle ?? 0.5;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = m.terrain[i];
      const wet = nz3.fbm(x * 0.04 + 100, y * 0.04, 3) * 0.5 + 0.5;
      if (t === Terrain.Grass || t === Terrain.Hill) {
        const fert = Math.max(0, Math.min(1, wet * 1.1 - (m.height[i] - 1.5) * 0.06));
        m.fertility[i] = t === Terrain.Grass ? fert : fert * 0.4;
        const forest = wet + (jungle - 0.5) * 0.6;
        if (t === Terrain.Grass && forest > 0.62) {
          m.terrain[i] = Terrain.Jungle;
          m.trees[i] = Math.min(4, 1 + Math.floor((forest - 0.62) * 12 + rng.next() * 1.5));
        } else if (forest > 0.5 && rng.chance(0.25)) {
          m.trees[i] = 1;
        }
      } else if (t === Terrain.Beach) {
        if (rng.chance(0.06)) m.trees[i] = 1; // lone palms
      }
      if (t === Terrain.Hill || t === Terrain.Mountain) {
        const o = nz.fbm(x * 0.08 + 50, y * 0.08 + 50, 3);
        m.ore[i] = Math.max(0, Math.min(1, (o + 0.1) * 1.6));
      }
    }
  }
  // dock sites: beach tiles adjacent to deep enough water, facing outwards
  findDockSites(m);
}

function findDockSites(m: GameMap): void {
  const n = m.size;
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let y = 2; y < n - 2; y++) {
    for (let x = 2; x < n - 2; x++) {
      if (m.terrainAt(x, y) !== Terrain.Beach) continue;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = dirs[d];
        let ok = true;
        for (let k = 1; k <= 4; k++) if (m.isLand(x + dx * k, y + dy * k)) ok = false;
        if (ok && m.terrainAt(x + dx * 5, y + dy * 5) === Terrain.DeepWater) m.dockSites.push({ x, y, dir: d });
      }
    }
  }
}
