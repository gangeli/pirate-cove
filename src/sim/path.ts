import { Terrain, type GameMap } from './map';

/** Grid A* over walkable tiles; roads are cheaper. Blocked = building footprints (except allowed goal). */
export class PathFinder {
  private n: number;
  private g: Float32Array;
  private f: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private cur = 1;
  private heap: Int32Array;
  private cache = new Map<number, Int32Array | null>();
  private readonly nb: Int32Array;
  private cacheOrder: number[] = [];
  blocked: Uint8Array;
  /** monotonically increasing; bumping clears cache */
  version = 0;

  constructor(private map: GameMap) {
    const n = (this.n = map.size);
    this.g = new Float32Array(n * n);
    this.f = new Float32Array(n * n);
    this.from = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
    this.heap = new Int32Array(n * n * 4);
    this.blocked = new Uint8Array(n * n);
    this.nb = Int32Array.from([1, -1, n, -n, n + 1, n - 1, -n + 1, -n - 1]);
  }

  invalidate(): void {
    this.cache.clear();
    this.cacheOrder.length = 0;
    this.version++;
  }

  cost(i: number): number {
    if (this.blocked[i]) return Infinity;
    const m = this.map;
    // same as m.isWalkable(x, y) for any index on the map (out-of-range indices are not walkable)
    if (!(i >= 0 && i < this.n * this.n)) return Infinity;
    const t = m.terrain[i];
    if (!(t >= Terrain.Beach && t !== Terrain.Mountain)) return Infinity;
    if (m.path[i]) return 1;
    return m.trees[i] ? 3.2 : 2.2;
  }

  /** returns tile indices from start (exclusive) to goal (inclusive), or null */
  find(sx: number, sy: number, gx: number, gy: number, maxNodes = 40000): Int32Array | null {
    const n = this.n;
    const s = sy * n + sx, goal = gy * n + gx;
    if (s === goal) return new Int32Array(0);
    const key = s * n * n + goal;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const res = this.search(s, goal, maxNodes);
    this.cache.set(key, res);
    this.cacheOrder.push(key);
    if (this.cacheOrder.length > 4000) this.cache.delete(this.cacheOrder.shift()!);
    return res;
  }

  private search(s: number, goal: number, maxNodes: number): Int32Array | null {
    const n = this.n;
    const st = ++this.cur;
    const gx = goal % n, gy = (goal / n) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % n) - gx), dy = Math.abs(((i / n) | 0) - gy);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * 1.0;
    };
    let hs = 0;
    const heap = this.heap, f = this.f, g = this.g;
    const push = (i: number) => {
      let k = hs++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t;
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hs];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hs && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hs && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t;
        k = m;
      }
      return top;
    };
    g[s] = 0;
    f[s] = h(s);
    const stamp = this.stamp, closed = this.closed, from = this.from;
    stamp[s] = st;
    from[s] = -1;
    push(s);
    let expanded = 0;
    const NN = n * n;
    // this.cost() inlined over local arrays (same rules; see cost())
    const blk = this.blocked, m = this.map, ter = m.terrain, pth = m.path, trs = m.trees;
    const cost = (i: number): number => {
      if (blk[i]) return Infinity;
      if (!(i >= 0 && i < NN)) return Infinity;
      const t = ter[i];
      if (!(t >= Terrain.Beach && t !== Terrain.Mountain)) return Infinity;
      if (pth[i]) return 1;
      return trs[i] ? 3.2 : 2.2;
    };
    const nb = this.nb;
    while (hs > 0) {
      const c = pop();
      if (c === goal) break;
      if (closed[c] === st) continue;
      closed[c] = st;
      if (++expanded > maxNodes) return null;
      const cx = c % n;
      const gc = g[c];
      for (let k = 0; k < 8; k++) {
        const ni = c + nb[k];
        if (ni < 0 || ni >= NN) continue;
        const nx = ni % n;
        const ddx = nx - cx;
        if (ddx > 1 || ddx < -1) continue;
        if (closed[ni] === st) continue;
        let cc = ni === goal ? Math.min(cost(ni), 2) : cost(ni);
        if (cc === Infinity) continue;
        if (k >= 4) {
          // no corner cutting
          const ox = c + ddx, oy = ni - ddx;
          if ((ox !== goal && cost(ox) === Infinity) || (oy !== goal && cost(oy) === Infinity)) continue;
          cc *= Math.SQRT2;
        }
        const ng = gc + cc;
        if (stamp[ni] !== st || ng < g[ni]) {
          stamp[ni] = st;
          g[ni] = ng;
          f[ni] = ng + h(ni);
          from[ni] = c;
          push(ni);
        }
      }
    }
    if (stamp[goal] !== st) return null;
    let len = 0;
    for (let c = goal; c !== s; c = from[c]) len++;
    const out = new Int32Array(len);
    for (let c = goal, i = len - 1; c !== s; c = from[c]) out[i--] = c;
    return out;
  }

  /** nearest walkable tile to (x,y) by BFS */
  nearestWalkable(x: number, y: number, maxR = 12): [number, number] | null {
    const n = this.n;
    for (let r = 0; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx, ty = y + dy;
          if (!this.map.inBounds(tx, ty)) continue;
          if (this.cost(ty * n + tx) !== Infinity) return [tx, ty];
        }
    return null;
  }
}
