import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeGait, measureSlide, type FootTrack } from '../src/render/gait';
import { trimLead, unblendLoop } from '../src/render/clipfix';

/** a synthetic in-place gait: each foot planted (sliding back at stride per cycle) for half the cycle, then swinging forward */
function synthGait(stride: number, n = 41, strike = 0.1): FootTrack[] {
  const foot = (side: 'L' | 'R', off: number): FootTrack => {
    const y = new Float32Array(n), z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = (((i / (n - 1)) - off) % 1 + 1) % 1;
      if (u < 0.5) {
        // stance: from +stride/4 back to -stride/4 over half a cycle
        z[i] = stride / 4 - (u / 0.5) * (stride / 2);
        y[i] = 0.05;
      } else {
        const s = (u - 0.5) / 0.5;
        z[i] = -stride / 4 + s * (stride / 2);
        y[i] = 0.05 + Math.sin(s * Math.PI) * 0.1;
      }
    }
    return { side, y, z };
  };
  return [foot('L', strike + 0.5), foot('R', strike)];
}

describe('gait', () => {
  it('measures the stride of an in-place cycle and the right foot strike', () => {
    const g = analyzeGait(synthGait(1.5));
    expect(g.stride).toBeCloseTo(1.5, 2);
    expect(g.strikeR).toBeCloseTo(0.1, 1);
  });

  it('a body moving at stride per cycle keeps planted feet still; a wrong speed slides', () => {
    const tr = synthGait(1.2, 121);
    const run = (speed: number) => {
      const s = [];
      for (let i = 0; i < 121; i++) {
        const u = i / 120, x = u * speed; // body travels `speed` per cycle along +z
        s.push({ t: u, body: [0, x] as [number, number], ground: 0, pts: tr.map((t) => [0, t.y[i], t.z[i] + x] as [number, number, number]) });
      }
      return measureSlide(s, 0.002);
    };
    expect(run(1.2).slideRatio).toBeLessThan(0.02);
    expect(run(1.8).slideRatio).toBeGreaterThan(0.3);
  });
});

describe('clip repairs', () => {
  it('trimLead starts the keys at zero', () => {
    const c = new THREE.AnimationClip('walk', -1, [new THREE.NumberKeyframeTrack('a.x', [1 / 24, 2 / 24, 3 / 24], [0, 1, 2])]);
    trimLead(c);
    expect(c.tracks[0].times[0]).toBe(0);
    expect(c.duration).toBeCloseTo(2 / 24, 6);
  });

  it('unblendLoop inverts the cross-fade toward the first frame', () => {
    const n = 20, k = 6;
    const orig = Array.from({ length: n }, (_, i) => Math.sin((i / (n - 1)) * Math.PI * 2) + 0.3 * (i / (n - 1)));
    const faded = orig.slice();
    for (let j = 0; j < k; j++) {
      const t = (j + 1) / (k + 1), idx = n - k + j;
      faded[idx] = orig[idx] * (1 - t) + orig[0] * t;
    }
    faded[n - 1] = orig[0];
    const c = new THREE.AnimationClip('walk', -1, [new THREE.NumberKeyframeTrack('a.x', orig.map((_, i) => i), faded)]);
    unblendLoop(c, k);
    const v = c.tracks[0].values;
    for (let i = 0; i < n - 1; i++) expect(v[i]).toBeCloseTo(orig[i], 5);
    expect(v[n - 1]).toBeCloseTo(orig[0], 6);
  });
});

describe('far model region colours', () => {
  it('rotates triangles so the two vertices of the majority region are first and last', async () => {
    const { regionProvoking } = await import('../src/render/crowd');
    const g = new THREE.BufferGeometry();
    // regions 1, 1, 2 / 2, 1, 1 / 3, 4, 3 / 5, 6, 7
    const r = [1, 1, 2, 2, 1, 1, 3, 4, 3, 5, 6, 7];
    g.setAttribute('color', new THREE.Float32BufferAttribute(r.flatMap((x) => [x / 20, 0, 0]), 3));
    g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    regionProvoking(g);
    const I = Array.from(g.getIndex()!.array);
    const reg = (v: number) => r[v];
    for (let t = 0; t < 9; t += 3) expect(reg(I[t])).toBe(reg(I[t + 2]));
    // winding kept: each triangle is a rotation of the original
    const rot = (a: number[], b: number[]) => [0, 1, 2].some((k) => a.every((v, i) => v === b[(i + k) % 3]));
    for (let t = 0; t < 12; t += 3) expect(rot(I.slice(t, t + 3), [t, t + 1, t + 2])).toBe(true);
  });
});
