import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { Rng } from '../src/sim/rng';
import { PathMirror, type PathRequestMsg, type PathResultMsg } from '../src/sim/path';
import { PathService, MAX_WAIT, type PathPort } from '../src/sim/pathservice';

/** an in-process stand-in for the worker: results wait in a queue until deliver() */
class LocalPort implements PathPort {
  mirror = new PathMirror();
  out: PathResultMsg[] = [];
  onmessage: ((m: PathResultMsg) => void) | null = null;
  onerror: ((why: string) => void) | null = null;
  finds = 0;
  post(m: PathRequestMsg): void {
    if (m.t === 'find') this.finds++;
    const r = this.mirror.handle(m);
    if (r) this.out.push(r);
  }
  deliver(): void {
    const o = this.out;
    this.out = [];
    for (const m of o) this.onmessage?.(m);
  }
  close(): void {}
}

/** start/goal pairs over a game's map: building doors (impassable goals), random tiles, blocked starts */
function pairs(g: Game, k: number, seed: number): [number, number][] {
  const n = g.map.size, rng = new Rng(seed);
  const doors = [...g.buildings.values()].map((b) => b.door[1] * n + b.door[0]);
  const land: number[] = [];
  for (let i = 0; i < n * n; i++) if (g.pf.cost(i) !== Infinity) land.push(i);
  const pick = () => {
    const r = rng.next();
    return r < 0.35 ? doors[rng.int(0, doors.length - 1)] : r < 0.9 ? land[rng.int(0, land.length - 1)] : rng.int(0, n * n - 1);
  };
  const out: [number, number][] = [];
  for (let i = 0; i < k; i++) out.push([pick(), pick()]);
  return out;
}

describe('path finding', () => {
  it('region labels agree exactly with the search on reachability', () => {
    for (const seed of [1, 3]) {
      const g = new Game({ seed });
      g.run(MONTH / 2);
      let unreachable = 0;
      for (const [s, goal] of pairs(g, 250, seed)) {
        const found = g.pf.searchIdx(s, goal) !== null;
        expect(g.pf.reachable(s, goal), `seed ${seed} ${s}->${goal}`).toBe(found);
        if (!found) unreachable++;
      }
      expect(unreachable).toBeGreaterThan(0);
    }
  });

  it('the worker mirror finds the same paths as the main thread', () => {
    const g = new Game({ seed: 2 });
    g.run(MONTH / 2);
    const n = g.map.size;
    const cls = new Uint8Array(n * n).fill(255);
    g.pf.classify(cls);
    const m = new PathMirror();
    m.handle({ t: 'init', n, cls, rev: 1 });
    let id = 0;
    for (const [s, goal] of pairs(g, 150, 9)) {
      const a = g.pf.searchIdx(s, goal);
      const b = m.handle({ t: 'find', id: ++id, s, goal })!.path;
      expect(b ? Array.from(b) : null).toEqual(a ? Array.from(a) : null);
    }
  });

  it('async service: dedupes, caches, validates against grid changes, and falls back', () => {
    const g = new Game({ seed: 2 });
    g.run(10);
    const port = new LocalPort();
    const svc = new PathService(g, port, false);
    svc.syncNodes = 0;
    const n = g.map.size;
    // a long trip between two far apart open tiles that are connected
    let a = -1, b = -1;
    const land: number[] = [];
    for (let i = 0; i < n * n; i++) if (g.pf.cost(i) !== Infinity) land.push(i);
    outer: for (const x of land)
      for (let j = land.length - 1; j >= 0; j--) {
        const y = land[j];
        if (Math.abs((x % n) - (y % n)) + Math.abs(((x / n) | 0) - ((y / n) | 0)) > 90 && g.pf.reachable(x, y)) {
          a = x, b = y;
          break outer;
        }
      }
    expect(a).toBeGreaterThanOrEqual(0);
    const h = svc.request(a % n, (a / n) | 0, b % n, (b / n) | 0);
    expect(typeof h).toBe('number');
    const h2 = svc.request(a % n, (a / n) | 0, b % n, (b / n) | 0);
    expect(h2).toBe(h); // deduped
    expect(svc.collect(h as number)).toBe('wait');
    svc.flush();
    port.deliver();
    const p1 = svc.collect(h as number) as Int32Array, p2 = svc.collect(h as number) as Int32Array;
    const want = Array.from(g.pf.searchIdx(a, b)!);
    expect(Array.from(p1)).toEqual(want);
    expect(Array.from(p2)).toEqual(want);
    expect(port.finds).toBe(1);
    // cached now: answered at once
    expect(svc.request(a % n, (a / n) | 0, b % n, (b / n) | 0)).toBeInstanceOf(Int32Array);

    // block a tile of the route while the search is out: the stale path is searched again
    g.pf.invalidate();
    const h3 = svc.request(a % n, (a / n) | 0, b % n, (b / n) | 0) as number;
    svc.flush();
    const mid = want[want.length >> 1];
    g.pf.blocked[mid] = 1;
    g.pf.invalidate();
    port.deliver(); // the stale path arrives, fails validation, goes back to the worker
    expect(svc.stats.invalid).toBe(1);
    expect(svc.collect(h3)).toBe('wait');
    svc.flush();
    port.deliver();
    const p3 = svc.collect(h3) as Int32Array | null;
    const want3 = g.pf.searchIdx(a, b);
    expect(p3 ? Array.from(p3) : null).toEqual(want3 ? Array.from(want3) : null);
    if (p3) expect(Array.from(p3)).not.toContain(mid);

    // a worker that never answers: after MAX_WAIT game seconds the person searches on the main thread
    g.pf.invalidate();
    const h4 = svc.request(a % n, (a / n) | 0, b % n, (b / n) | 0) as number;
    svc.flush();
    port.out.length = 0;
    g.time += MAX_WAIT + 0.1;
    const p4 = svc.collect(h4) as Int32Array | null;
    expect(p4 ? Array.from(p4) : null).toEqual(want3 ? Array.from(want3) : null);
    expect(svc.stats.timeouts).toBe(1);
    expect(svc.collect(12345)).toBe('lost');
  });

  it('a game runs with async paths and keeps everyone working', () => {
    const g = new Game({ seed: 2 });
    const port = new LocalPort();
    g.paths = new PathService(g, port, false);
    g.paths.syncNodes = 0; // every uncached search goes to the "worker"
    const steps = Math.round((MONTH * 2) / 0.1);
    for (let i = 0; i < steps; i++) {
      g.step();
      g.paths.flush();
      if (i % 2) port.deliver(); // results arrive a step or two later
      g.events.length = 0;
    }
    expect(g.paths.stats.async).toBeGreaterThan(0);
    expect(g.paths.stats.results).toBeGreaterThan(0);
    expect(g.captives().filter((c) => c.job).length).toBeGreaterThan(8);
    // a save made while people wait still loads and plays (synchronously)
    const g2 = Game.deserialize(g.serialize());
    g2.run(20);
    expect([...g2.people.values()].every((p) => !p.pathReq || !p.path || p.path.length > 0 || p.task.phase !== 0)).toBe(true);
  });
});
