import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { heightAndSea } from '../src/render/water';

/** the open-sea mask (G) as the water shader samples it: bilinear over the vertex grid */
function openAt(o: Uint16Array, s: number, x: number, y: number): number {
  const g = (i: number, j: number) => THREE.DataUtils.fromHalfFloat(o[(Math.min(s - 1, Math.max(0, j)) * s + Math.min(s - 1, Math.max(0, i))) * 2 + 1]);
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fy) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
}

describe('calm ponds', () => {
  it('no water-mesh vertex around a one-tile pond rides the swell', () => {
    const n = 144, s = n + 1, vh = new Float32Array(s * s);
    // an island (land inside a ring of sea) with a one-tile pond in the middle of it
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) vh[y * s + x] = Math.hypot(x - n / 2, y - n / 2) < n * 0.4 ? 1 : -3;
    const px = 70, py = 70;
    vh[py * s + px] = -0.5;
    const o = heightAndSea(vh, s);
    // the water plane's vertex lattice (water.ts: size n * 8 over 384 segments, centred on the map)
    const size = n * 8, cell = size / 384, x0 = n / 2 - size / 2;
    for (let k = 0; k <= 384; k++)
      for (let l = 0; l <= 384; l++) {
        const x = x0 + k * cell, y = x0 + l * cell;
        // every vertex of a lattice cell the pond lies in or touches
        if (Math.abs(x - px) <= cell && Math.abs(y - py) <= cell) expect(openAt(o, s, x, y)).toBe(0);
      }
    // and the open sea keeps its swell
    expect(openAt(o, s, 5, 5)).toBe(1);
  });
});
