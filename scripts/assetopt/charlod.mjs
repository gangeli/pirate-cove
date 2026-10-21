// Character LOD index buffers: for each crowd model (public/assets/chars/<name>.glb) a simplified triangle list over
// the model's OWN vertices (meshoptimizer's edge-collapse simplifier picks a subset of them), so the far model shares
// every vertex attribute (skinning, region colours, uvs) with the full one and draws with the same material and data.
//   node scripts/assetopt/charlod.mjs        -> public/assets/chars/<name>.lod.bin
// File layout (little endian): u32 magic 'CLOD', u32 vertex count of the source mesh, u32 triangle count,
// f32 rest-pose error (model units), then u16 or u32 indices (u32 when the vertex count needs it).
// Rerun whenever a character GLB changes: the runtime (src/render/charlod.ts) ignores a file whose vertex count no
// longer matches its model.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier as S } from '../../node_modules/meshoptimizer/index.js';

const DIR = path.resolve(import.meta.dirname, '../../public/assets/chars');
/** triangles to aim for, and the largest rest-pose error accepted on the way (fraction of the model's size) */
const TARGET_TRIS = 1500, MAX_ERR = 0.01;

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
  const [out, err] = S.simplify(idx, pos, 3, TARGET_TRIS * 3, MAX_ERR);
  const scale = S.getScale(pos, 3);
  const wide = nv > 65535;
  const head = new ArrayBuffer(16);
  const h = new DataView(head);
  h.setUint32(0, 0x444f4c43, true); // 'CLOD'
  h.setUint32(4, nv, true);
  h.setUint32(8, out.length / 3, true);
  h.setFloat32(12, err * scale, true);
  const body = wide ? new Uint32Array(out) : new Uint16Array(out);
  const name = f.replace(/\.glb$/, '.lod.bin');
  fs.writeFileSync(path.join(DIR, name), Buffer.concat([Buffer.from(head), Buffer.from(body.buffer)]));
  console.log(`${name}: ${idx.length / 3} -> ${out.length / 3} triangles, rest-pose error ${(err * scale * 100).toFixed(2)} cm of ${scale.toFixed(2)} m`);
}
