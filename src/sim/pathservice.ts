import type { Game } from './game';
import type { PathFinder, PathRequestMsg, PathResultMsg } from './path';

/**
 * Asynchronous path finding for the browser: long searches run in a Web Worker so they never stall a frame.
 *
 * The sim asks `request()` for a path. Cheap cases are answered at once, on the main thread:
 *  - a cached result;
 *  - a short trip, tried with a small cap on expansions;
 *  - a goal that cannot be reached at all (a lookup in PathFinder's region labels: exact, so goTo() still
 *    fails, and its callers still pick another target, exactly when a synchronous search would).
 * Anything longer gets a handle: the person stands (facing the goal) until `collect()` hands over the path.
 * Identical in-flight requests share one search, and results land in PathFinder's cache.
 *
 * The worker mirrors the map's cost classes (PathFinder.classify): the whole grid once per PathFinder, then
 * only the tiles that changed, sent just before a batch of searches whenever the map changed (or, for tree
 * growth, which no version bump marks, every few game seconds). Arrays go over as transfers (no
 * SharedArrayBuffer: GitHub Pages sends no COOP/COEP headers). A path is checked against the live grid when
 * it arrives; one that a new building or a removed road broke is searched again, once in the worker, then on
 * the main thread. A person who has waited `MAX_WAIT` game seconds (a busy worker at 8x, a synchronous g.run()
 * loop that gives the worker no chance to answer, a dead worker) searches on the main thread instead.
 *
 * Node, tests, bots and screenshots never create one of these: `g.paths` stays undefined and everything is
 * synchronous and deterministic, as before.
 */

/** the transport to a path worker (a Worker, or an in-process stand-in for measuring) */
export interface PathPort {
  post(m: PathRequestMsg, transfer: Transferable[]): void;
  onmessage: ((m: PathResultMsg) => void) | null;
  onerror: ((why: string) => void) | null;
  close(): void;
}

/** octile tiles: trips at most this long are first tried on the main thread */
export const SHORT_DIST = 40;
/**
 * Expansion cap of a main-thread try: about a quarter of a millisecond on a desktop. In bot games ~98% of
 * searches need fewer (median ~25); the rest carry a quarter of all search time and go to the worker.
 */
export const SYNC_NODES = 600;
/** main-thread milliseconds per frame (16 ms window) for capped tries; past it, trips go to the worker */
export const SYNC_BUDGET_MS = 1.5;
/** game seconds a person waits for the worker before searching on the main thread */
export const MAX_WAIT = 3;
/** game seconds a finished result is kept for the people waiting on it */
const KEEP_DONE = 20;

const QUEUED = 0, SENT = 1, DONE = 2;

interface Req {
  id: number;
  key: number;
  s: number;
  goal: number;
  /** PathFinder.version when requested: the result is cached only if it still holds */
  version: number;
  t0: number;
  sim: number;
  waiters: number;
  state: number;
  result: Int32Array | null;
  tries: number;
  doneAt: number;
}

export type PathAnswer = Int32Array | null | number;

/** keep at most this many latency samples */
const MAX_SAMPLES = 50000;

export class PathService {
  readonly stats = {
    requests: 0,
    cacheHits: 0,
    unreachable: 0,
    /** answered by a capped main-thread search */
    sync: 0,
    /** short trips that hit the cap and went to the worker */
    syncMissed: 0,
    async: 0,
    deduped: 0,
    results: 0,
    /** a result that the grid had moved under */
    invalid: 0,
    /** a person gave up waiting and searched on the main thread */
    timeouts: 0,
    /** a result that failed twice and was searched on the main thread */
    fallbacks: 0,
    gridInits: 0,
    gridUpdates: 0,
    tilesSent: 0,
    /** request-to-arrival, ms */
    latMs: [] as number[],
    /** request-to-arrival, sim steps */
    latSteps: [] as number[],
    /** search time in the worker, ms */
    workerMs: [] as number[],
    /** main-thread capped searches, ms */
    syncMs: [] as number[],
  };
  /** the worker failed: everything is searched on the main thread */
  dead = false;
  /** tuning (see the constants of the same names); syncNodes 0 sends every uncached search to the worker */
  shortDist = SHORT_DIST;
  syncNodes = SYNC_NODES;
  syncBudgetMs = SYNC_BUDGET_MS;
  private reqs = new Map<number, Req>();
  private inflight = new Map<number, Req>();
  private queue: Req[] = [];
  private nextId = 1;
  private scheduled = false;
  private pfSent: PathFinder | null = null;
  private shadow = new Uint8Array(0);
  private diffBuf = new Int32Array(0);
  private rev = 0;
  private lastGc = 0;
  private sentVersion = -1;
  private sentAt = 0;
  private budgetT0 = 0;
  private budgetUsed = 0;

  /**
   * `autoFlush`: send queued requests in a microtask (after the frame's sim steps). Without it the owner
   * calls flush() itself, as the node measurement harness does.
   */
  constructor(private g: Game, private port: PathPort, private autoFlush = true) {
    g.pf.warm();
    port.onmessage = (m) => this.onResult(m);
    port.onerror = (why) => {
      console.warn('path worker failed, searching on the main thread:', why);
      this.dead = true;
    };
  }

  /** a path now (Int32Array, or null: unreachable), or a handle to collect() it by later */
  request(sx: number, sy: number, gx: number, gy: number): PathAnswer {
    const g = this.g, pf = g.pf, n = g.map.size;
    this.stats.requests++;
    if (this.dead) return pf.find(sx, sy, gx, gy);
    const s = sy * n + sx, goal = gy * n + gx;
    if (s === goal) return new Int32Array(0);
    const key = s * n * n + goal;
    const c = pf.cached(s, goal);
    if (c !== undefined) {
      this.stats.cacheHits++;
      return c;
    }
    const dx = Math.abs(sx - gx), dy = Math.abs(sy - gy);
    const t0 = performance.now();
    if (t0 - this.budgetT0 > 16) (this.budgetT0 = t0), (this.budgetUsed = 0);
    if (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) <= this.shortDist && this.syncNodes > 0 && this.budgetUsed < this.syncBudgetMs) {
      const r = pf.tryFind(s, goal, this.syncNodes);
      const ms = performance.now() - t0;
      this.budgetUsed += ms;
      this.sample(this.stats.syncMs, ms);
      if (r) {
        this.stats.sync++;
        return r;
      }
      this.stats.syncMissed++;
    }
    // only now the region labels (a grid scan after any change to the map): most trips never get this far
    if (!pf.reachable(s, goal)) {
      this.stats.unreachable++;
      pf.store(key, null);
      return null;
    }
    const f = this.inflight.get(key);
    if (f && f.state !== DONE && f.version === pf.version) {
      f.waiters++;
      this.stats.deduped++;
      return f.id;
    }
    const q: Req = { id: this.nextId++, key, s, goal, version: pf.version, t0: performance.now(), sim: g.time, waiters: 1, state: QUEUED, result: null, tries: 0, doneAt: 0 };
    this.reqs.set(q.id, q);
    this.inflight.set(key, q);
    this.queue.push(q);
    this.stats.async++;
    this.schedule();
    return q.id;
  }

  /** the path for a handle: 'wait' while the worker is on it; 'lost' for a handle this service never issued */
  collect(id: number): Int32Array | null | 'wait' | 'lost' {
    const q = this.reqs.get(id);
    if (!q) return 'lost';
    if (q.state !== DONE) {
      if (!this.dead && this.g.time - q.sim < MAX_WAIT) return 'wait';
      this.stats.timeouts++;
      this.finish(q, this.search(q));
    }
    if (--q.waiters <= 0) this.reqs.delete(id);
    return q.result;
  }

  /** people waiting on the worker right now */
  get pending(): number {
    let k = 0;
    for (const q of this.reqs.values()) if (q.state !== DONE) k++;
    return k;
  }

  /** bring the worker's grid up to date and send it the queued searches */
  flush(): void {
    this.scheduled = false;
    this.gc();
    if (this.dead || !this.queue.length) return;
    const g = this.g, pf = g.pf;
    if (pf !== this.pfSent) {
      // a new game or a freshly loaded one: the whole grid
      const n = g.map.size;
      this.shadow = new Uint8Array(n * n).fill(255);
      pf.classify(this.shadow);
      this.diffBuf = new Int32Array(n * n);
      const cls = this.shadow.slice();
      this.port.post({ t: 'init', n, cls, rev: ++this.rev }, [cls.buffer]);
      this.pfSent = pf;
      this.stats.gridInits++;
    } else if (pf.version !== this.sentVersion || g.time - this.sentAt > 5) {
      // walkability only changes with a version bump (a building, a road, cleared ground); trees growing or
      // felled only change costs, which can wait a few game seconds (an arriving path is checked anyway)
      const k = pf.classify(this.shadow, this.diffBuf);
      if (k) {
        const idx = this.diffBuf.slice(0, k);
        const cls = new Uint8Array(k);
        for (let i = 0; i < k; i++) cls[i] = this.shadow[idx[i]];
        this.port.post({ t: 'upd', idx, cls, rev: ++this.rev }, [idx.buffer, cls.buffer]);
        this.stats.gridUpdates++;
        this.stats.tilesSent += k;
      }
    }
    this.sentVersion = pf.version;
    this.sentAt = g.time;
    for (const q of this.queue) {
      if (q.state !== QUEUED) continue;
      q.state = SENT;
      this.port.post({ t: 'find', id: q.id, s: q.s, goal: q.goal }, []);
    }
    this.queue.length = 0;
  }

  /** stop the worker; anyone still waiting searches on the main thread */
  dispose(): void {
    this.dead = true;
    this.port.onmessage = this.port.onerror = null;
    this.port.close();
    this.queue.length = 0;
    this.inflight.clear();
    this.reqs.clear();
    if (this.g.paths === this) this.g.paths = undefined;
  }

  private onResult(m: PathResultMsg): void {
    const q = this.reqs.get(m.id);
    if (!q || q.state === DONE) return;
    const g = this.g, pf = g.pf;
    this.stats.results++;
    this.sample(this.stats.latMs, performance.now() - q.t0);
    this.sample(this.stats.latSteps, Math.round((g.time - q.sim) * 10));
    this.sample(this.stats.workerMs, m.ms);
    let res = m.path;
    // a path must still be walkable; "unreachable" must still be true (the region labels are the cheap check)
    const ok = m.rev >= 0 && (res ? this.valid(res, q.s, q.goal) : !pf.reachable(q.s, q.goal));
    if (!ok) {
      this.stats.invalid++;
      if (q.tries++ < 1) {
        // again, against the grid as it is now (flush sends the changed tiles first)
        q.state = QUEUED;
        q.version = pf.version;
        this.queue.push(q);
        this.schedule();
        return;
      }
      this.stats.fallbacks++;
      res = this.search(q);
    } else if (pf.version === q.version) pf.store(q.key, res);
    this.finish(q, res);
  }

  /** the main-thread search, cached as usual */
  private search(q: Req): Int32Array | null {
    const n = this.g.map.size;
    return this.g.pf.find(q.s % n, (q.s / n) | 0, q.goal % n, (q.goal / n) | 0);
  }

  private finish(q: Req, res: Int32Array | null): void {
    q.state = DONE;
    q.result = res;
    q.doneAt = this.g.time;
    if (this.inflight.get(q.key) === q) this.inflight.delete(q.key);
  }

  /** every step walkable now, no corner cut (the search's own rules, see PathFinder.search) */
  private valid(path: Int32Array, s: number, goal: number): boolean {
    const pf = this.g.pf, n = this.g.map.size;
    const open = (i: number) => i === goal || pf.cost(i) !== Infinity;
    let prev = s;
    for (let k = 0; k < path.length; k++) {
      const c = path[k];
      const dx = (c % n) - (prev % n), dy = ((c / n) | 0) - ((prev / n) | 0);
      if (dx > 1 || dx < -1 || dy > 1 || dy < -1 || (!dx && !dy)) return false;
      if (!open(c)) return false;
      if (dx && dy && (!open(prev + dx) || !open(c - dx))) return false;
      prev = c;
    }
    return prev === goal;
  }

  private schedule(): void {
    if (this.scheduled || !this.autoFlush) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** forget finished results nobody came for (a person retasked or killed while waiting) */
  private gc(): void {
    const t = this.g.time;
    if (t - this.lastGc < 5 && t >= this.lastGc) return;
    this.lastGc = t;
    for (const [id, q] of this.reqs) {
      if (q.state === DONE ? t - q.doneAt > KEEP_DONE : t - q.sim > KEEP_DONE * 6) {
        this.reqs.delete(id);
        if (this.inflight.get(q.key) === q) this.inflight.delete(q.key);
      }
    }
  }

  private sample(a: number[], v: number): void {
    if (a.length < MAX_SAMPLES) a.push(v);
  }
}

/** a Worker running pathworker.ts, or null where workers are unavailable */
export function spawnPathWorker(): PathPort | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./pathworker.ts', import.meta.url), { type: 'module' });
    const port: PathPort = {
      post: (m, transfer) => w.postMessage(m, transfer),
      onmessage: null,
      onerror: null,
      close: () => w.terminate(),
    };
    w.onmessage = (e: MessageEvent<PathResultMsg>) => port.onmessage?.(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      port.onerror?.(e.message || 'worker error');
    };
    w.onmessageerror = () => port.onerror?.('message error');
    return port;
  } catch {
    return null;
  }
}

/** give a game asynchronous path finding, if a worker can be had; returns whether it now has it */
export function enableAsyncPaths(g: Game): boolean {
  const port = spawnPathWorker();
  if (!port) return false;
  g.paths = new PathService(g, port);
  return true;
}
