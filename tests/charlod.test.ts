import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { parseCharLod, lodGeometry, maxPixels } from '../src/render/charlod';
import { InstanceCuller, SHADOW_LAYER, ViewVolumes } from '../src/render/instcull';

const DIR = path.resolve(__dirname, '../public/assets/chars');

/** vertex count of the skinned mesh's first primitive in a GLB */
function glbVertices(file: string): number {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const node = j.nodes.find((n: any) => n.skin !== undefined && n.mesh !== undefined);
  return j.accessors[j.meshes[node.mesh].primitives[0].attributes.POSITION].count;
}

describe('character LOD bakes', () => {
  for (const f of fs.readdirSync(DIR).filter((f: string) => f.endsWith('.glb'))) {
    it(`${f}: a current, valid far model`, () => {
      const bin = path.join(DIR, f.replace(/\.glb$/, '.lod.bin'));
      expect(fs.existsSync(bin)).toBe(true);
      const raw = fs.readFileSync(bin);
      const lod = parseCharLod(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)!;
      expect(lod).not.toBeNull();
      // baked against this very GLB (rerun scripts/assetopt/charlod.mjs if not)
      expect(lod.vertices).toBe(glbVertices(path.join(DIR, f)));
      expect(lod.index.length / 3).toBeLessThan(3000);
      expect(Math.max(...lod.index)).toBeLessThan(lod.vertices);
      // invisible below some 60 px of figure height
      expect(maxPixels(lod, 1.7)).toBeGreaterThan(50);
    });
  }

  it('the far geometry shares the full one\'s attributes', () => {
    const full = new THREE.BufferGeometry();
    full.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    full.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(12), 4));
    const g = lodGeometry(full, { index: new Uint16Array([0, 1, 2]), vertices: 3, err: 0.01 })!;
    expect(g.getAttribute('skinIndex')).toBe(full.getAttribute('skinIndex'));
    expect(lodGeometry(full, { index: new Uint16Array([0, 1, 2]), vertices: 4, err: 0.01 })).toBeNull();
  });
});

describe('instance culling', () => {
  const setup = () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const n = 5;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), n);
    im.castShadow = true;
    const far = new THREE.InstancedMesh(geo, im.material, n);
    // instances along x at 0, 10, 20, 30, 40, each with a colour
    for (let i = 0; i < n; i++) {
      im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 0, 0));
      im.setColorAt(i, new THREE.Color(i / 10, 0, 0));
    }
    const cam = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
    // sees x = -6.8..36.8 at z = 0: the instances at 0..30, not the one at 40
    cam.position.set(15, 0, 60);
    cam.lookAt(15, 0, 0);
    cam.updateMatrixWorld();
    return { im, far, cam, n };
  };

  it('packs only the instances in view, in order, colours and all', () => {
    const { im, cam } = setup();
    const c = new InstanceCuller(im);
    const v = new ViewVolumes();
    v.update(cam, 720, null);
    c.cull(v);
    expect(im.count).toBe(4);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < 4; i++) {
      im.getMatrixAt(i, m);
      expect(p.setFromMatrixPosition(m).x).toBe(i * 10);
      im.getColorAt(i, col);
      expect(col.r).toBeCloseTo(i / 10);
    }
    // turned away: nothing drawn
    cam.lookAt(15, 0, 100);
    cam.updateMatrixWorld();
    v.update(cam, 720, null);
    c.cull(v);
    expect(im.count).toBe(0);
    expect(im.visible).toBe(false);
  });

  it('keeps instances outside the view that the shadow camera sees', () => {
    const { im, cam } = setup();
    const c = new InstanceCuller(im);
    const v = new ViewVolumes();
    const sc = new THREE.OrthographicCamera(-5, 5, 5, -5, 1, 100);
    sc.position.set(40, 50, 0);
    sc.lookAt(40, 0, 0);
    sc.updateMatrixWorld();
    v.update(cam, 720, sc);
    c.cull(v);
    // the view's four in the mesh (no longer casting), the sun's one in the shadow-only twin
    expect(im.count).toBe(4);
    expect(im.castShadow).toBe(false);
    expect(c.made.length).toBe(1);
    const twin = c.made[0];
    expect(twin.count).toBe(1);
    expect(twin.castShadow).toBe(true);
    // (WebGL: hidden outside the shadow-map render, see installShadowTwins)
    expect(twin.visible).toBe(false);
    void SHADOW_LAYER;
    const m = new THREE.Matrix4();
    twin.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(40);
  });

  it('sends instances under the pixel threshold to the far model', () => {
    const { im, far, cam } = setup();
    cam.position.set(0, 0, 3);
    cam.lookAt(0, 0, -100);
    cam.fov = 170;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const c = new InstanceCuller(im, 0, { far, px: 100 });
    const v = new ViewVolumes();
    v.update(cam, 720, null);
    // in this wide view all five are in sight; near ones big on screen, far ones small
    const sees = [0, 10, 20, 30, 40].map((x) => v.inView(x, 0, 0, 0.87));
    c.cull(v);
    const big = [0, 10, 20, 30, 40].filter((x, i) => sees[i] && v.pixels(x, 0, 0, 2 * 0.866) >= 100).length;
    expect(im.count).toBe(big);
    expect(far.count).toBe(sees.filter(Boolean).length - big);
    expect(im.count + far.count).toBeGreaterThan(0);
  });
});
