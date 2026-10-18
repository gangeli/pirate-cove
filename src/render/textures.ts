import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export const pending: Promise<unknown>[] = [];

export function setMaxAnisotropy(a: number): void {
  maxAniso = a;
}

export function assetUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}assets/${rel}`;
}

export function loadTex(rel: string, srgb: boolean, repeat = true): THREE.Texture {
  const key = rel + srgb;
  const hit = cache.get(key);
  if (hit) return hit;
  let done: (v: unknown) => void;
  pending.push(new Promise((r) => (done = r)));
  const t = loader.load(assetUrl(rel), () => done(0), undefined, () => done(0));
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  cache.set(key, t);
  return t;
}
