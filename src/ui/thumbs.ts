import * as THREE from 'three';
import type { World } from '../render/world';
import { buildPrefab } from '../render/prefabs';
import { disposeObject } from '../render/dispose';
import { BUILDING } from '../sim/data/buildings';

/** Renders building prefabs to small images for the construction menu. */
const cache = new Map<string, string>();
let scene: THREE.Scene | null = null;
let rt: THREE.WebGLRenderTarget | null = null;
const W = 216, H = 160;
const GAMMA = Uint8ClampedArray.from({ length: 256 }, (_, v) => Math.min(255, Math.pow(v / 255, 1 / 2.2) * 255));
/** transparent 1x1 stand-in while a thumbnail is still queued */
export const THUMB_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const queue: string[] = [];
const queued = new Set<string>();
let pumping = false;
/** the thumbnail if it was already rendered, else null (and it is queued: `onReady` fires when it is) */
export function thumbOrQueue(world: World, id: string, onReady: (id: string, url: string) => void): string | null {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!queued.has(id)) {
    queued.add(id);
    queue.push(id);
  }
  listener = onReady;
  if (!pumping) {
    pumping = true;
    const step = () => {
      const next = queue.shift();
      if (!next) {
        pumping = false;
        return;
      }
      queued.delete(next);
      const url = thumb(world, next);
      listener?.(next, url);
      // one render per frame, after the frame, so opening the menu never stalls on thumbnails
      requestAnimationFrame(() => setTimeout(step, 0));
    };
    requestAnimationFrame(() => setTimeout(step, 0));
  }
  return null;
}
let listener: ((id: string, url: string) => void) | null = null;

export function thumb(world: World, id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = world.renderer;
  if (!scene) {
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6b5a3a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(5, 9, 7);
    scene.add(sun);
    scene.environment = world.scene.environment;
    rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  }
  const def = BUILDING[id];
  const [w, d] = def.size;
  const model = buildPrefab(id, w, d, def.house ? 5 : 1);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(w, d) * 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8a878, roughness: 1, transparent: true, opacity: 0.55 }));
  if (def.water === 'dock') (ground.material as THREE.MeshStandardMaterial).color.set(0x3a8aa0);
  const g = new THREE.Group();
  g.add(model, ground);
  scene.add(g);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const rad = Math.max(size.x, size.z, size.y * 1.2) * 0.75 + 0.3;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
  cam.position.set(c.x + rad * 1.9, c.y + rad * 1.6, c.z + rad * 1.9);
  cam.lookAt(c.x, c.y * 0.7, c.z);
  const prevTarget = r.getRenderTarget();
  const prevTM = r.toneMapping;
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0);
  r.clear();
  r.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  r.readRenderTargetPixels(rt!, 0, 0, W, H, px);
  r.setRenderTarget(prevTarget);
  r.toneMapping = prevTM;
  scene.remove(g);
  disposeObject(g, { keep: world.scene, renderer: r });
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  // flip vertically; apply a gentle gamma since the RT is linear
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = ((H - 1 - y) * W + x) * 4, di = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) img.data[di + k] = GAMMA[px[si + k]];
      img.data[di + 3] = px[si + 3];
    }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
