// Character LOD index buffers: for each crowd model (public/assets/chars/<name>.glb) simplified triangle lists over the
// model's OWN vertices (meshoptimizer's edge-collapse simplifier picks a subset of them), so a far model shares every
// vertex attribute (skinning, region colours, uvs) with the full one and draws with the same material and data.
//   node scripts/assetopt/charlod.mjs        -> public/assets/chars/<name>.lod.bin
// File layout (little endian), one block per level, finest first (src/render/charlod.ts parseCharLods):
// u32 magic 'CLOD', u32 vertex count of the source mesh, u32 triangle count, f32 error (model units), f32 pixel
// bound, then u16 or u32 indices (u32 when the vertex count needs it), padded to 4 bytes.
// Rerun whenever a character GLB changes: the runtime ignores a file whose vertex count no longer matches its model.
//
// What the far models must keep (A/B measured in the game, figures near vs far in the same idle frame): the crowd
// textures are an atlas (uv seams are split vertices) and every clothing region is its own shell layered over the
// body (coat 1-2 cm over shirt, hair over scalp, eyes in the face), drawn with a flat region colour. The simplifier
// keeps split vertices together (a seam edge collapses only along the seam), never joins two shells, and every
// triangle stays inside one region; what shows is plain surface deviation: shells moving against each other and the
// outline moving, a changed-pixel fraction that grows with the deviation and hardly with the figure's size (outline
// and region boundaries grow with the figure as its area does). 1.3 cm (the first bake): ~25% of figure pixels
// differ; 3 mm: ~4% (a frame of idle animation changes ~4-7%); 2 mm: ~1.3%, single pixels only. Attribute weights
// (normals, uvs, posed positions) made no measurable difference at a given triangle count, so the error bound is
// purely geometric: the worst deviation of the surface over the model's rest pose.
//
// LEVELS: finest first; `err` the deviation bound in metres (model units) or `rel` as a fraction of the model's
// extent, `tris` an optional triangle target, `px` the tallest figure (pixels) the level is drawn at, measured
// (docs/feedback-checklist.md, Rendering cost): the 2 mm level differs from the full model in ~1-1.5% of figure
// pixels at 14-140 px (single pixels; 4-6 px clusters from 60 px, 11+ from 80 px), the 1500-triangle one in ~30% at
// 7-10 px (2-3 pixels per figure: max zoom-out only). Attribute weights (normals, uvs, posed positions) measured no
// better at the same triangle count, so the error is purely positional.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier as S } from '../../node_modules/meshoptimizer/index.js';

const DIR = path.resolve(import.meta.dirname, '../../public/assets/chars');
const LEVELS = [
  { err: 0.002, px: 60 },
  { rel: 0.01, tris: 1500, px: 10 },
];

await S.ready;
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.glb'))) {
  const b = fs.readFileSync(path.join(DIR, f));
  const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bin = b.subarray(20 + jl + 8);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView];
    const c = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], es = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), st = v.byteStride || c * es;
    const o = a.componentType === 5126 ? new Float32Array(a.count * c) : new Uint32Array(a.count * c);
    for (let k = 0; k < a.count; k++)
      for (let q = 0; q < c; q++) {
        const at = off + k * st + q * es;
        o[k * c + q] = a.componentType === 5126 ? dv.getFloat32(at, true) : es === 4 ? dv.getUint32(at, true) : es === 2 ? dv.getUint16(at, true) : dv.getUint8(at);
      }
    return o;
  };
  // the crowd draws the (single) skinned mesh's first primitive
  const node = j.nodes.find((n) => n.skin !== undefined && n.mesh !== undefined);
  if (!node) continue;
  const prim = j.meshes[node.mesh].primitives[0];
  const pos = read(prim.attributes.POSITION), idx = read(prim.indices);
  const nv = pos.length / 3;
  const scale = S.getScale(pos, 3);
  const blocks = [];
  const report = [];
  for (const L of LEVELS) {
    // the error bound is relative to the mesh's extent; a triangle target (optional) stops earlier
    const [out, e] = S.simplify(idx, pos, 3, (L.tris ?? 0) * 3, L.rel ?? L.err / scale);
    blocks.push(block(nv, out, e * scale, L.px));
    report.push(`${out.length / 3} tris, ${(e * scale * 1000).toFixed(1)} mm, <= ${L.px} px, across seams ${crossings(out, idx, nv)}`);
  }
  const name = f.replace(/\.glb$/, '.lod.bin');
  fs.writeFileSync(path.join(DIR, name), Buffer.concat(blocks));
  console.log(`${name}: ${idx.length / 3} -> ${report.join(' | ')}`);
}

function block(nv, out, err, px) {
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x444f4c43, 0); // 'CLOD'
  h.writeUInt32LE(nv, 4);
  h.writeUInt32LE(out.length / 3, 8);
  h.writeFloatLE(err, 12);
  h.writeFloatLE(px, 16);
  const body = Buffer.from((nv > 65535 ? new Uint32Array(out) : new Uint16Array(out)).buffer);
  return Buffer.concat([h, body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
}

/** far triangles whose corners lie on different uv charts of the source (index-connected pieces: the atlas seams
 *  are split vertices), i.e. a collapse across a seam: must be 0 */
function crossings(out, src, nv) {
  const par = new Int32Array(nv).map((_, i) => i);
  const find = (x) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  for (let t = 0; t < src.length; t += 3) {
    const a = find(src[t]);
    par[find(src[t + 1])] = a;
    par[find(src[t + 2])] = find(a);
  }
  let n = 0;
  for (let t = 0; t < out.length; t += 3) if (find(out[t]) !== find(out[t + 1]) || find(out[t]) !== find(out[t + 2])) n++;
  return n;
}
