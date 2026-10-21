import { describe, expect, it } from 'vitest';
import { anythingNear, fitTree, shapeOf, treeFits, type FitMap, type TreePose } from '../src/render/treefit';

/** a 12x12 flat map with a 2x2 building (top 2.0) on tiles 5..6 and a road along row 9 */
function map(): FitMap & { occupied: Uint16Array; path: Uint8Array } {
  const n = 12;
  const occupied = new Uint16Array(n * n), path = new Uint8Array(n * n);
  for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) occupied[y * n + x] = 1;
  for (let x = 0; x < n; x++) path[9 * n + x] = 1;
  return { size: n, occupied, path, heightAt: () => 0 };
}
const top = (k: number) => (k ? 2.0 : 0);
/** a disc crown of radius r at height h, and a vertical trunk */
function shape(r: number, h: number) {
  const crown: number[] = [], trunk: number[] = [];
  for (let i = 0; i < 16; i++) crown.push(Math.cos(i / 2.546) * r, h, Math.sin(i / 2.546) * r);
  for (let i = 0; i <= 4; i++) trunk.push(0, (h * i) / 4, 0);
  return shapeOf(new Float32Array(crown), new Float32Array(trunk));
}
const compose = (p: TreePose) => [p.sc, 0, 0, 0, 0, p.sc, 0, 0, 0, 0, p.sc, 0, p.x, 0, p.z, 1];

describe('tree fitting', () => {
  it('a low crown next to a building does not fit; one above its roof does', () => {
    const m = map();
    expect(treeFits(shape(1.2, 1.5), compose({ x: 4.5, z: 5.5, yaw: 0, sc: 1 }), m, top)).toBe(false);
    expect(treeFits(shape(1.2, 2.5), compose({ x: 4.5, z: 5.5, yaw: 0, sc: 1 }), m, top)).toBe(true);
  });
  it('trunks stay out of roads below head height', () => {
    const m = map();
    expect(treeFits(shape(0.3, 3), compose({ x: 2.5, z: 9.5, yaw: 0, sc: 1 }), m, top)).toBe(false);
    expect(treeFits(shape(0.3, 3), compose({ x: 2.5, z: 8.5, yaw: 0, sc: 1 }), m, top)).toBe(true);
  });
  it('trees far from anything keep their pose; crowded ones shrink or move; hopeless ones are left out', () => {
    const m = map();
    const far = { x: 1.5, z: 1.5, yaw: 0, sc: 1 };
    expect(anythingNear(m, 1.5, 1.5, 1)).toBe(false);
    expect(fitTree(shape(1, 1.5), far, [1, 1], m, top, compose)).toBe(far);
    const near = { x: 4.5, z: 4.6, yaw: 0, sc: 1 };
    expect(treeFits(shape(1, 1.5), compose(near), m, top)).toBe(false);
    const f = fitTree(shape(1, 1.5), near, [4, 4], m, top, compose, { yaws: 1 });
    expect(f).not.toBeNull();
    expect(f).not.toBe(near);
    expect(treeFits(shape(1, 1.5), compose(f!), m, top)).toBe(true);
    expect(fitTree(shape(3, 1.5), { x: 4.5, z: 4.5, yaw: 0, sc: 1 }, [4, 4], m, top, compose, { yaws: 1 })).toBeNull();
  });
});
