import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * Shared texture cache. Tiling material maps (tex/*) ship as GPU-compressed KTX2 (Basis: ETC1S colour maps,
 * UASTC normal maps at 512^2), transcoded to whatever the GPU takes (ASTC / ETC2 / BC7 / DXT): 4-8x less video
 * memory than the RGBA8 the JPGs expand to. The JPGs stay as the fallback (no worker/wasm, failed fetch,
 * or ?nocomp). Textures returned here are cache-owned and never disposed with a scene (see dispose.ts).
 */
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const owned = new WeakSet<THREE.Texture>();
let maxAniso = 8;
export const pending: Promise<unknown>[] = [];

/** files that exist as .ktx2 next to the .jpg (see scripts in the asset pipeline) */
const KTX2_DIRS = ['tex/'];
/** identical maps shipped once */
const ALIAS: Record<string, string> = { 'tex/whitewash_n.jpg': 'tex/plaster_n.jpg' };

let ktx: KTX2Loader | null | undefined;
function ktx2(): KTX2Loader | null {
  if (ktx !== undefined) return ktx;
  ktx = null;
  try {
    if (typeof document === 'undefined' || location.search.includes('nocomp')) return null;
    // which compressed formats the GPU takes: ask a throwaway context (same GPU and driver as the renderer's)
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const exts = new Map<string, unknown>();
    const get = (n: string) => {
      if (!exts.has(n)) exts.set(n, gl.getExtension(n));
      return exts.get(n);
    };
    const l = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
    l.setWorkerLimit(2);
    l.detectSupport({ extensions: { has: (n: string) => !!get(n), get } } as unknown as THREE.WebGLRenderer);
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
    ktx = l;
  } catch {
    ktx = null;
  }
  return ktx;
}

export function setMaxAnisotropy(a: number): void {
  maxAniso = a;
}

export function assetUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}assets/${rel}`;
}

/** true for textures owned by this cache (shared between scenes; never dispose them) */
export function isCachedTexture(t: THREE.Texture): boolean {
  return owned.has(t);
}

/** move a transcoded KTX2 texture's data into the texture handed out earlier (callers already hold it) */
function adopt(t: THREE.Texture, c: THREE.CompressedTexture): void {
  const tt = t as THREE.Texture & { isCompressedTexture: boolean };
  const mips = c.mipmaps ?? [];
  tt.isCompressedTexture = true;
  tt.image = c.image;
  tt.mipmaps = mips as THREE.Texture['mipmaps'];
  tt.format = c.format;
  tt.type = c.type;
  tt.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tt.magFilter = THREE.LinearFilter;
  tt.generateMipmaps = false;
  tt.flipY = false; // the files are stored flipped already
  tt.unpackAlignment = 1;
  // after the upload the CPU copy is dead weight (these cache textures are never re-uploaded)
  tt.onUpdate = () => {
    tt.mipmaps = [];
    tt.onUpdate = null as unknown as () => void;
  };
  tt.needsUpdate = true;
}

export function loadTex(rel: string, srgb: boolean, repeat = true): THREE.Texture {
  rel = ALIAS[rel] ?? rel;
  const key = rel + srgb;
  const hit = cache.get(key);
  if (hit) return hit;
  let done: (v: unknown) => void;
  pending.push(new Promise((r) => (done = r)));
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  owned.add(t);
  cache.set(key, t);
  const jpg = () =>
    loader.load(
      assetUrl(rel),
      (tex) => {
        t.image = tex.image;
        t.needsUpdate = true;
        done(0);
      },
      undefined,
      () => done(0),
    );
  const k = KTX2_DIRS.some((d) => rel.startsWith(d)) ? ktx2() : null;
  if (k)
    k.load(
      assetUrl(rel.replace(/\.jpg$/, '.ktx2')),
      (c) => {
        adopt(t, c as THREE.CompressedTexture);
        done(0);
      },
      undefined,
      () => jpg(),
    );
  else jpg();
  return t;
}
