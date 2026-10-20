import { Terrain, type GameMap } from './map';

/** what the path finder reads of a map (a GameMap, or the worker's mirror of one) */
export type PathGrid = Pick<GameMap, 'size' | 'terrain' | 'path' | 'trees' | 'inBounds'>;

/**
 * Per-tile cost class, the whole of what a search reads of a tile: 0 = impassable (blocked, water,
 * mountain), 1 = road, 2 = open ground, 3 = trees. The path worker keeps a mirror of these.
 */
export const CLASS_COST = [Infinity, 1, 2.2, 3.2] as const;

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
  /** nodes expanded by the last search (instrumentation; never read by the sim) */
  lastExpanded = 0;
  /** 4-connected walkable regions (0 = impassable), valid for `compVersion` */
  private comp: Int32Array | null = null;
  private compVersion = -1;
  private walk: Uint8Array | null = null;
  private compQueue: Int32Array | null = null;

  constructor(private map: PathGrid) {
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
    this.store(key, res);
    return res;
  }

  /** cached result for a start/goal pair: a path, null (no path), or undefined (not cached) */
  cached(s: number, goal: number): Int32Array | null | undefined {
    return this.cache.get(s * this.n * this.n + goal);
  }

  /** remember a result computed elsewhere (the path worker) for a start/goal pair */
  store(key: number, res: Int32Array | null): void {
    if (!this.cache.has(key)) {
      this.cacheOrder.push(key);
      if (this.cacheOrder.length > 4000) this.cache.delete(this.cacheOrder.shift()!);
    }
    this.cache.set(key, res);
  }

  /**
   * A search capped at `maxNodes` expansions that caches only a found path: null means "not within the cap"
   * (or unreachable), and is not remembered, so a later uncapped search still runs.
   */
  tryFind(s: number, goal: number, maxNodes: number): Int32Array | null {
    if (s === goal) return new Int32Array(0);
    const key = s * this.n * this.n + goal;
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    const res = this.search(s, goal, maxNodes);
    if (res) this.store(key, res);
    return res;
  }

  /** run a search by tile index, uncached */
  searchIdx(s: number, goal: number, maxNodes = 40000): Int32Array | null {
    return s === goal ? new Int32Array(0) : this.search(s, goal, maxNodes);
  }

  /** cost class of a tile (see CLASS_COST) */
  costClass(i: number): number {
    const c = this.cost(i);
    return c === Infinity ? 0 : c === 1 ? 1 : c === 2.2 ? 2 : 3;
  }

  /**
   * Write every tile's cost class into `out`; with `diff`, return how many changed and list their indices in
   * `diff` (in place of a full rewrite). Same rules as cost(), over the arrays directly.
   */
  classify(out: Uint8Array, diff?: Int32Array): number {
    const NN = this.n * this.n, blk = this.blocked, ter = this.map.terrain, pth = this.map.path, trs = this.map.trees;
    let k = 0;
    for (let i = 0; i < NN; i++) {
      const t = ter[i];
      const c = blk[i] || !(t >= Terrain.Beach && t !== Terrain.Mountain) ? 0 : pth[i] ? 1 : trs[i] ? 3 : 2;
      if (out[i] !== c) {
        out[i] = c;
        if (diff) diff[k++] = i;
      }
    }
    return k;
  }

  /**
   * Run the grid scans a few times so they are compiled before play (a scan's first, interpreted run takes
   * 5-15 ms; once compiled, ~0.1 ms). For the async path service, at game load.
   */
  warm(): void {
    const scratch = new Uint8Array(this.n * this.n);
    for (let k = 0; k < 3; k++) {
      this.comp = null;
      this.labels();
      scratch.fill(255);
      this.classify(scratch);
    }
  }

  /** label 4-connected walkable regions (diagonal steps never connect anything 4-steps cannot: no corner cutting) */
  private labels(): Int32Array {
    if (this.comp && this.compVersion === this.version) return this.comp;
    this.compVersion = this.version;
    const n = this.n, NN = n * n, blk = this.blocked, ter = this.map.terrain;
    // most invalidations (a road, a cleared grove, a field) leave walkability as it was: then so are the regions
    const walk = (this.walk ??= new Uint8Array(NN));
    let same = !!this.comp;
    for (let i = 0; i < NN; i++) {
      const t = ter[i];
      const w = !blk[i] && t >= Terrain.Beach && t !== Terrain.Mountain ? 1 : 0;
      if (walk[i] !== w) (walk[i] = w), (same = false);
    }
    if (same) return this.comp!;
    const comp = (this.comp ??= new Int32Array(NN));
    comp.fill(0);
    const q = (this.compQueue ??= new Int32Array(NN));
    let label = 0;
    for (let i = 0; i < NN; i++) {
      if (!walk[i] || comp[i]) continue;
      label++;
      let h = 0, t = 0;
      q[t++] = i;
      comp[i] = label;
      while (h < t) {
        const c = q[h++];
        const x = c % n;
        if (x + 1 < n && walk[c + 1] && !comp[c + 1]) (comp[c + 1] = label), (q[t++] = c + 1);
        if (x > 0 && walk[c - 1] && !comp[c - 1]) (comp[c - 1] = label), (q[t++] = c - 1);
        if (c + n < NN && walk[c + n] && !comp[c + n]) (comp[c + n] = label), (q[t++] = c + n);
        if (c - n >= 0 && walk[c - n] && !comp[c - n]) (comp[c - n] = label), (q[t++] = c - n);
      }
    }
    return comp;
  }

  /**
   * Would find(s -> goal) return a path? Exact for the default node cap whenever the map has fewer tiles
   * than the cap (every map size does), because the search then only fails when the goal is unreachable.
   * Mirrors the search's rules: the start tile itself may be impassable (it steps off onto any open
   * orthogonal neighbour), and the goal may be impassable (a door: entered from any open neighbour).
   * Reachability is only recomputed when `version` bumps, i.e. after invalidate().
   */
  reachable(s: number, goal: number): boolean {
    if (s === goal) return true;
    const n = this.n, NN = n * n;
    const comp = this.labels();
    const nbrs = (i: number, out: number[]) => {
      const x = i % n;
      out.length = 0;
      if (x + 1 < n) out.push(i + 1);
      if (x > 0) out.push(i - 1);
      if (i + n < NN) out.push(i + n);
      if (i - n >= 0) out.push(i - n);
      return out;
    };
    const from: number[] = [];
    if (comp[s] > 0) from.push(comp[s]);
    else {
      for (const k of nbrs(s, [])) {
        if (k === goal) return true; // one orthogonal step onto the goal is always allowed
        if (comp[k] > 0) from.push(comp[k]);
      }
      if (!from.length) return false;
    }
    if (comp[goal] > 0 && from.includes(comp[goal])) return true;
    for (const k of nbrs(goal, [])) {
      if (k === s) return true;
      if (comp[k] > 0 && from.includes(comp[k])) return true;
    }
    return false;
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
      if (++expanded > maxNodes) {
        this.lastExpanded = expanded;
        return null;
      }
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
    this.lastExpanded = expanded;
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

// ------------------------------------------------------------------------------------- off-thread searching

/** main thread -> path worker */
export type PathRequestMsg =
  /** a fresh grid of cost classes (a new game, or a new PathFinder after loading) */
  | { t: 'init'; n: number; cls: Uint8Array; rev: number }
  /** tiles whose cost class changed: indices and their new classes */
  | { t: 'upd'; idx: Int32Array; cls: Uint8Array; rev: number }
  | { t: 'find'; id: number; s: number; goal: number };

/** path worker -> main thread */
export interface PathResultMsg {
  t: 'res';
  id: number;
  /** grid revision the search ran against (-1: the worker had no grid) */
  rev: number;
  path: Int32Array | null;
  /** search time in the worker, ms */
  ms: number;
  expanded: number;
}

/**
 * The worker's side: a mirror of the main thread's cost grid and an ordinary PathFinder over it. Searches
 * here run exactly the main thread's code on the same cost classes, so a path computed against an up-to-date
 * mirror is the path the main thread would have found. A plain class, so node can drive it without a Worker.
 */
export class PathMirror {
  pf: PathFinder | null = null;
  rev = 0;
  private grid: PathGrid | null = null;

  handle(m: PathRequestMsg): PathResultMsg | null {
    if (m.t === 'init') {
      const n = m.n, NN = n * n;
      this.grid = {
        size: n,
        terrain: new Uint8Array(NN),
        path: new Uint8Array(NN),
        trees: new Uint8Array(NN),
        inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n,
      } as unknown as PathGrid;
      this.pf = new PathFinder(this.grid);
      for (let i = 0; i < NN; i++) this.set(i, m.cls[i]);
      this.rev = m.rev;
      return null;
    }
    if (m.t === 'upd') {
      if (!this.grid) return null;
      for (let k = 0; k < m.idx.length; k++) this.set(m.idx[k], m.cls[k]);
      this.pf!.invalidate();
      this.rev = m.rev;
      return null;
    }
    const pf = this.pf;
    if (!pf) return { t: 'res', id: m.id, rev: -1, path: null, ms: 0, expanded: 0 };
    const t0 = performance.now();
    const n = this.grid!.size;
    pf.lastExpanded = 0;
    const path = pf.find(m.s % n, (m.s / n) | 0, m.goal % n, (m.goal / n) | 0);
    // the cache shares arrays between requests: each result goes over (transferred) as its own copy
    return { t: 'res', id: m.id, rev: this.rev, path: path ? path.slice() : null, ms: performance.now() - t0, expanded: pf.lastExpanded };
  }

  private set(i: number, c: number): void {
    const g = this.grid!;
    g.terrain[i] = c ? Terrain.Grass : Terrain.DeepWater;
    g.path[i] = c === 1 ? 1 : 0;
    g.trees[i] = c === 3 ? 1 : 0;
  }
}
