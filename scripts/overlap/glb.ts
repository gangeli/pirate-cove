/**
 * Minimal GLB reader for the overlap tools: node transforms plus Draco-decoded positions, no three.js loaders
 * (they need workers and a DOM). Returns world-space vertex positions per mesh node (game coordinates: y up).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

type Mat = number[]; // column-major 4x4

function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: any): Mat {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

let draco: any = null;
async function dracoModule(): Promise<any> {
  if (draco) return draco;
  const src = readFileSync(join(root, 'public/draco/draco_wasm_wrapper.js'), 'utf8');
  const req = createRequire(import.meta.url);
  // the wrapper is an emscripten module meant for a worker: evaluate it and pull out the factory
  const factory = new Function('require', 'module', 'exports', '__filename', '__dirname', src + '\n;return DracoDecoderModule;')(req, { exports: {} }, {}, '', '');
  const wasmBinary = readFileSync(join(root, 'public/draco/draco_decoder.wasm'));
  draco = await new Promise((res) => factory({ wasmBinary, onModuleLoaded: (m: any) => res(m) }));
  return draco;
}

export interface GlbNode {
  name: string;
  /** world-space positions, xyz interleaved */
  pos: Float32Array;
  /** material name per vertex range (start index, material) */
  mats: { start: number; count: number; mat: string }[];
}
export interface Glb {
  meshes: GlbNode[];
  markers: { name: string; p: [number, number, number] }[];
}

export async function readGlb(file: string): Promise<Glb> {
  const b = readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const binStart = 20 + jl + 8;
  const bin = b.subarray(binStart);
  const D = await dracoModule();
  const out: Glb = { meshes: [], markers: [] };
  const visit = (ni: number, parent: Mat) => {
    const n = j.nodes[ni];
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined) {
      const chunks: Float32Array[] = [];
      const mats: GlbNode['mats'] = [];
      let total = 0;
      for (const prim of j.meshes[n.mesh].primitives) {
        const ext = prim.extensions?.KHR_draco_mesh_compression;
        let p: Float32Array;
        if (ext) {
          const bv = j.bufferViews[ext.bufferView];
          const data = new Int8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
          const dec = new D.Decoder();
          const mesh = new D.Mesh();
          const st = dec.DecodeArrayToMesh(data, data.byteLength, mesh);
          if (!st.ok()) throw new Error('draco: ' + st.error_msg());
          const att = dec.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
          const np = mesh.num_points();
          const arr = new D.DracoFloat32Array();
          dec.GetAttributeFloatForAllPoints(mesh, att, arr);
          p = new Float32Array(np * 3);
          for (let i = 0; i < np * 3; i++) p[i] = arr.GetValue(i);
          D.destroy(arr);
          D.destroy(mesh);
          D.destroy(dec);
        } else {
          const acc = j.accessors[prim.attributes.POSITION];
          const bv = j.bufferViews[acc.bufferView];
          p = new Float32Array(bin.buffer.slice(bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + acc.count * 12));
        }
        const w = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 3) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          w[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          w[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          w[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        mats.push({ start: total / 3, count: w.length / 3, mat: prim.material !== undefined ? j.materials[prim.material].name : '' });
        chunks.push(w);
        total += w.length;
      }
      const pos = new Float32Array(total);
      let o = 0;
      for (const c of chunks) pos.set(c, o), (o += c.length);
      out.meshes.push({ name: n.name ?? '', pos, mats });
    } else out.markers.push({ name: n.name ?? '', p: [m[12], m[13], m[14]] });
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of j.scenes[j.scene ?? 0].nodes) visit(ni, I);
  return out;
}
