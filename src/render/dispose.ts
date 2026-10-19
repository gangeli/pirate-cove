import * as THREE from 'three';
import { M } from './kit';
import { props } from './props';
import { isCachedTexture } from './textures';

/**
 * Freeing GPU resources (geometries, materials, textures, render targets) of scene graphs that are thrown away,
 * e.g. the previous game's views when a new game is attached, or a building view that is rebuilt.
 *
 * Long-lived caches (loaded textures, kit materials, prop and building models) register their resources with
 * markShared and are never disposed here. Everything still reachable from `keep` (normally the live scene) is
 * spared too, so a resource that the old and the new graph happen to share survives.
 */
const shared = new WeakSet<object>();

/** never dispose these (cache-owned) */
export function markShared(...xs: (object | null | undefined)[]): void {
  for (const x of xs) if (x) shared.add(x);
}

/** mark every geometry, material and texture under a cached model as shared */
export function markSharedTree(root: THREE.Object3D): void {
  const r = collect([root]);
  for (const s of [r.geometries, r.materials, r.textures]) for (const x of s) shared.add(x);
}

export function isShared(x: object): boolean {
  return shared.has(x);
}

/** caches owned by other modules that we can reach: kit materials (and their canvas textures), prop models */
function markKnownCaches(): void {
  for (const m of Object.values(M())) {
    if (shared.has(m)) continue;
    shared.add(m);
    for (const t of texturesOf(m as THREE.Material)) shared.add(t);
  }
  const src = (props as unknown as { src?: Map<string, THREE.Object3D> }).src;
  if (src) for (const o of src.values()) if (!shared.has(o)) {
    shared.add(o);
    markSharedTree(o);
  }
}

function addTex(v: unknown, out: Set<THREE.Texture>): void {
  if (!v) return;
  if ((v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
  else if (Array.isArray(v)) for (const x of v) addTex(x, out);
}

/** textures a material uses: its own map slots, ShaderMaterial uniforms and (when the renderer is given)
 *  the compiled program's uniforms, which hold textures injected through onBeforeCompile */
export function texturesOf(m: THREE.Material, renderer?: THREE.WebGLRenderer, out = new Set<THREE.Texture>()): Set<THREE.Texture> {
  for (const v of Object.values(m)) addTex(v, out);
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k in u) addTex(u[k]?.value, out);
  if (renderer) {
    const pu = (renderer.properties.get(m) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
    if (pu) for (const k in pu) addTex(pu[k]?.value, out);
  }
  return out;
}

interface Found {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  disposables: Set<{ dispose(): void }>;
}

function collect(roots: (THREE.Object3D | null | undefined)[], renderer?: THREE.WebGLRenderer): Found {
  const f: Found = { geometries: new Set(), materials: new Set(), textures: new Set(), disposables: new Set() };
  const addMat = (m: THREE.Material | THREE.Material[] | null | undefined) => {
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x && !f.materials.has(x)) {
      f.materials.add(x);
      texturesOf(x, renderer, f.textures);
    }
  };
  for (const root of roots) {
    root?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) f.geometries.add(mesh.geometry);
      addMat(mesh.material);
      addMat((o as THREE.Mesh).customDepthMaterial);
      addMat((o as THREE.Mesh).customDistanceMaterial);
      // instanced attributes and skeleton bone textures
      if ((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) f.disposables.add(o as unknown as { dispose(): void });
      const bg = (o as THREE.Scene).background, env = (o as THREE.Scene).environment;
      addTex(bg, f.textures);
      addTex(env, f.textures);
    });
  }
  return f;
}

export interface DisposeStats {
  geometries: number;
  materials: number;
  textures: number;
}

/**
 * Dispose the GPU resources under `roots` that are neither cache-owned (markShared) nor still used under `keep`.
 * Call it after the roots have been removed from the scene (and, for a world rebuild, after the new views were
 * added, passing the scene as `keep`). Pass the renderer so textures injected via onBeforeCompile are found.
 */
export function disposeObject(
  roots: THREE.Object3D | (THREE.Object3D | null | undefined)[],
  opts: { keep?: THREE.Object3D; renderer?: THREE.WebGLRenderer } = {},
): DisposeStats {
  markKnownCaches();
  const list = Array.isArray(roots) ? roots : [roots];
  const f = collect(list, opts.renderer);
  const keep = opts.keep ? collect([opts.keep], opts.renderer) : null;
  const ok = (x: object, k?: Set<object>) => !shared.has(x) && !k?.has(x) && !((x as THREE.Texture).isTexture && isCachedTexture(x as THREE.Texture));
  const st: DisposeStats = { geometries: 0, materials: 0, textures: 0 };
  for (const g of f.geometries) if (ok(g, keep?.geometries)) {
    g.dispose();
    st.geometries++;
  }
  // textures first: properties of a disposed material (holding onBeforeCompile uniforms) are gone afterwards
  for (const t of f.textures) if (ok(t, keep?.textures)) {
    t.dispose();
    st.textures++;
  }
  for (const m of f.materials) if (ok(m, keep?.materials)) {
    m.dispose();
    st.materials++;
  }
  for (const d of f.disposables) if (!keep || !keepHasObject(opts.keep!, d)) d.dispose();
  return st;
}

function keepHasObject(root: THREE.Object3D, o: object): boolean {
  let hit = false;
  root.traverse((x) => {
    if (x === o) hit = true;
  });
  return hit;
}

/** dispose an EffectComposer with its passes and render targets */
export function disposeComposer(c: { passes: { dispose?: () => void }[]; dispose: () => void } | null | undefined): void {
  if (!c) return;
  for (const p of c.passes) p.dispose?.();
  c.dispose();
}
