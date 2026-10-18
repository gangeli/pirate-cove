import type { GameMap } from './map';

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
  }

  invalidate(): void {
    this.cache.clear();
    this.cacheOrder.length = 0;
    this.version++;
  }

  cost(i: number): number {
    if (this.blocked[i]) return Infinity;
    const m = this.map;
    const x = i % this.n, y = (i / this.n) | 0;
    if (!m.isWalkable(x, y)) return Infinity;
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
    this.stamp[s] = st;
    this.from[s] = -1;
    push(s);
    let expanded = 0;
    const nb = [1, -1, n, -n, n + 1, n - 1, -n + 1, -n - 1];
    while (hs > 0) {
      const c = pop();
      if (c === goal) break;
      if (this.closed[c] === st) continue;
      this.closed[c] = st;
      if (++expanded > maxNodes) return null;
      const cx = c % n;
      for (let k = 0; k < 8; k++) {
        const ni = c + nb[k];
        if (ni < 0 || ni >= n * n) continue;
        const nx = ni % n;
        if (Math.abs(nx - cx) > 1) continue;
        if (this.closed[ni] === st) continue;
        let cc = ni === goal ? Math.min(this.cost(ni), 2) : this.cost(ni);
        if (cc === Infinity) continue;
        if (k >= 4) {
          // no corner cutting
          const ox = c + (nx - cx), oy = ni - (nx - cx);
          if ((ox !== goal && this.cost(ox) === Infinity) || (oy !== goal && this.cost(oy) === Infinity)) continue;
          cc *= Math.SQRT2;
        }
        const ng = g[c] + cc;
        if (this.stamp[ni] !== st || ng < g[ni]) {
          this.stamp[ni] = st;
          g[ni] = ng;
          f[ni] = ng + h(ni);
          this.from[ni] = c;
          push(ni);
        }
      }
    }
    if (this.stamp[goal] !== st) return null;
    const out: number[] = [];
    for (let c = goal; c !== s; c = this.from[c]) out.push(c);
    out.reverse();
    return Int32Array.from(out);
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
