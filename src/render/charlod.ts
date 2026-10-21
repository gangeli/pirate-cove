import * as THREE from 'three';

/**
 * Character LOD (far model) for the instanced crowds: a simplified triangle list over the full model's own vertices
 * (scripts/assetopt/charlod.mjs bakes it into chars/<name>.lod.bin), so the far geometry shares every attribute of
 * the full one (skinning, region colours, uvs) and draws with the same material, bone texture and instance data:
 * only the index buffer differs (~1.5k triangles instead of ~9k).
 *
 * When to draw it: the bake records the simplification's worst rest-pose deviation (`err`, model units). The far
 * model is used while that deviation projects to under half a pixel, i.e. while the figure stands fewer than
 * `maxPixels()` pixels tall: then no edge moves by a visible amount.
 *
 * Not wired in yet: CrowdModel (crowd.ts) would keep a second InstancedMesh on `lodGeometry(...)` and PeopleView
 * (people.ts) would send each person to one or the other by `ViewVolumes.pixels()` (instcull.ts).
 */
export interface CharLod {
  index: Uint16Array | Uint32Array;
  /** vertex count of the mesh the indices were baked against */
  vertices: number;
  /** worst rest-pose deviation of the simplified surface, model units */
  err: number;
}

const MAGIC = 0x444f4c43; // 'CLOD'

/** parse a .lod.bin (null if it is not one) */
export function parseCharLod(buf: ArrayBuffer): CharLod | null {
  if (buf.byteLength < 16) return null;
  const h = new DataView(buf);
  if (h.getUint32(0, true) !== MAGIC) return null;
  const vertices = h.getUint32(4, true), tris = h.getUint32(8, true), err = h.getFloat32(12, true);
  const wide = vertices > 65535;
  const n = tris * 3;
  if (buf.byteLength !== 16 + n * (wide ? 4 : 2)) return null;
  const index = wide ? new Uint32Array(buf, 16, n) : new Uint16Array(buf, 16, n);
  return { index, vertices, err };
}

/** the far geometry: the full model's attributes (shared, not copied) with the simplified index; null if the bake
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

/** fetch and check chars/<name>.lod.bin for a loaded model (null when missing or stale) */
export async function loadCharLod(url: string, full: THREE.BufferGeometry): Promise<{ geometry: THREE.BufferGeometry; lod: CharLod } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const lod = parseCharLod(await r.arrayBuffer());
    const geometry = lod && lodGeometry(full, lod);
    return geometry && lod ? { geometry, lod } : null;
  } catch {
    return null;
  }
}

/**
 * The tallest on-screen height (pixels) at which the far model passes for the full one: its rest-pose deviation
 * `err` (model units, figure `height` model units tall) then stays under `tolPx` pixels.
 */
export function maxPixels(lod: CharLod, height: number, tolPx = 0.5): number {
  return lod.err > 0 ? (tolPx * height) / lod.err : Infinity;
}
