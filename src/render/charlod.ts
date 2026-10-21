import * as THREE from 'three';

/**
 * Character LODs (far models) for the instanced crowds: simplified triangle lists over the full model's own vertices
 * (scripts/assetopt/charlod.mjs bakes them into chars/<name>.lod.bin), so a far geometry shares every attribute of
 * the full one (skinning, region colours, uvs) and draws with the same material, bone texture and instance data:
 * only the index buffer differs. A file holds one or more levels, finest first.
 *
 * When to draw them: the bake records each level's worst deviation over a set of poses (`err`, model units) and the
 * figure height (pixels) below which its A/B-measured image difference stays at the level of a frame of idle
 * animation (`px`, see the script). `maxPixels()` turns `err` into the geometric bound (half a pixel); the crowd uses
 * the smaller of the two.
 *
 * Wired in: CrowdModel (crowd.ts) keeps an instanced mesh per level on `lodGeometry(...)` and PeopleView (people.ts)
 * sends each person to the coarsest level their on-screen height allows (`ViewVolumes.pixels()`, instcull.ts), with a
 * little hysteresis.
 */
export interface CharLod {
  index: Uint16Array | Uint32Array;
  /** vertex count of the mesh the indices were baked against */
  vertices: number;
  /** worst deviation of the simplified surface (rest pose and the bake's sample poses), model units */
  err: number;
  /** figures shorter than this many pixels may use this level (0: no measured bound, use `maxPixels`) */
  px: number;
}

const MAGIC = 0x444f4c43; // 'CLOD'
const HEAD = 20;

/**
 * parse a .lod.bin: one or more blocks, each u32 magic 'CLOD', u32 vertex count, u32 triangle count, f32 error,
 * f32 pixel bound, then the indices (u16, or u32 when the vertex count needs it; padded to 4 bytes). Null if it is
 * not one.
 */
export function parseCharLods(buf: ArrayBuffer): CharLod[] | null {
  const out: CharLod[] = [];
  const h = new DataView(buf);
  let o = 0;
  while (o < buf.byteLength) {
    if (buf.byteLength - o < HEAD || h.getUint32(o, true) !== MAGIC) return null;
    const vertices = h.getUint32(o + 4, true), tris = h.getUint32(o + 8, true);
    const err = h.getFloat32(o + 12, true), px = h.getFloat32(o + 16, true);
    const wide = vertices > 65535, n = tris * 3, bytes = n * (wide ? 4 : 2);
    if (o + HEAD + bytes > buf.byteLength) return null;
    const src = buf.slice(o + HEAD, o + HEAD + bytes);
    out.push({ index: wide ? new Uint32Array(src) : new Uint16Array(src), vertices, err, px });
    o += HEAD + ((bytes + 3) & ~3);
  }
  return out.length ? out : null;
}

/** a .lod.bin holding these levels (the bake's writer; parseCharLods reads it back) */
export function encodeCharLods(levels: CharLod[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const l of levels) {
    const wide = l.vertices > 65535;
    const idx = wide ? Uint32Array.from(l.index) : Uint16Array.from(l.index);
    const body = new Uint8Array((idx.byteLength + 3) & ~3);
    body.set(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength));
    const head = new DataView(new ArrayBuffer(HEAD));
    head.setUint32(0, MAGIC, true);
    head.setUint32(4, l.vertices, true);
    head.setUint32(8, l.index.length / 3, true);
    head.setFloat32(12, l.err, true);
    head.setFloat32(16, l.px, true);
    parts.push(new Uint8Array(head.buffer), body);
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** a far geometry: the full model's attributes (shared, not copied) with a simplified index; null if the bake
 *  doesn't belong to this mesh (the GLB changed since: rerun the bake) */
export function lodGeometry(full: THREE.BufferGeometry, lod: CharLod): THREE.BufferGeometry | null {
  const pos = full.getAttribute('position');
  if (!pos || pos.count !== lod.vertices) return null;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(full.attributes)) g.setAttribute(k, a);
  g.setIndex(new THREE.BufferAttribute(lod.index, 1));
  if (!full.boundingSphere) full.computeBoundingSphere();
  if (!full.boundingBox) full.computeBoundingBox();
  g.boundingSphere = full.boundingSphere!.clone();
  g.boundingBox = full.boundingBox!.clone();
  return g;
}

/** fetch and check chars/<name>.lod.bin for a loaded model: its levels, finest first (empty when missing or stale) */
export async function loadCharLod(url: string, full: THREE.BufferGeometry): Promise<{ geometry: THREE.BufferGeometry; lod: CharLod }[]> {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const lods = parseCharLods(await r.arrayBuffer()) ?? [];
    const out: { geometry: THREE.BufferGeometry; lod: CharLod }[] = [];
    for (const lod of lods) {
      const geometry = lodGeometry(full, lod);
      if (!geometry) return [];
      out.push({ geometry, lod });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The tallest on-screen height (pixels) at which a level's deviation `err` (model units, figure `height` model units
 * tall) stays under `tolPx` pixels.
 */
export function maxPixels(lod: CharLod, height: number, tolPx = 0.5): number {
  return lod.err > 0 ? (tolPx * height) / lod.err : Infinity;
}

/** the tallest height (pixels) a level is drawn at: its measured bound, never past the geometric one */
export function levelPixels(lod: CharLod, height: number): number {
  const geo = maxPixels(lod, height);
  return lod.px > 0 ? Math.min(lod.px, geo) : geo;
}
