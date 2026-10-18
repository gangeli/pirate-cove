import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Game } from '../sim/game';
import { SHIPS, type ShipType } from '../sim/data/ships';
import type { World } from './world';
import { assetUrl } from './textures';
import { M, flag } from './kit';
import type { Nation } from '../sim/data/kings';

const MODEL_FILES: Record<string, string> = { pinnace: 'ship_pinnace', medium: 'ship_medium', large1: 'ship_large1', large2: 'ship_large2' };
/** target hull length in tiles per ship type */
const LENGTH: Record<ShipType, number> = { snow: 7, schooner: 7.5, sloop: 9, brigantine: 10, frigate: 12.5, galleon: 14 };
export const NAV_LENGTH = 9;

/** model forward axis: hulls in the source files are modelled along -X (bow toward -X) */
const BOW = -1;

export class ShipsView {
  readonly group = new THREE.Group();
  private src = new Map<string, THREE.Object3D>();
  private views = new Map<number, THREE.Object3D>();
  private invaderViews = new Map<number, THREE.Object3D>();
  private t = 0;
  ready: Promise<void>;
  selected = 0;

  constructor(private world: World, private game: Game) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(MODEL_FILES).map(async ([k, f]) => {
      const gltf = await loader.loadAsync(assetUrl(`models/${f}.glb`));
      const root = gltf.scene;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          const mat = m.material as THREE.MeshStandardMaterial;
          if (mat.transparent || mat.alphaMap) {
            mat.alphaTest = 0.5;
            mat.transparent = false;
            mat.side = THREE.DoubleSide;
          }
        }
      });
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3());
      const len = Math.max(size.x, size.z);
      const wrap = new THREE.Group();
      // waterline: about 28% up from the keel
      root.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y - size.y * 0.13, -(bb.min.z + bb.max.z) / 2);
      if (size.z > size.x) root.rotation.y = Math.PI / 2;
      wrap.add(root);
      wrap.scale.setScalar(1 / len);
      wrap.userData.height = size.y / len;
      this.src.set(k, wrap);
    }));
  }

  private instance(type: ShipType, nation?: Nation): THREE.Object3D {
    const d = SHIPS[type];
    const src = this.src.get(d.model);
    const g = new THREE.Group();
    if (!src) return g;
    const inst = src.clone();
    const L = LENGTH[type];
    inst.scale.multiplyScalar(L);
    // bow toward local +x
    inst.rotation.y = BOW < 0 ? Math.PI : 0;
    g.add(inst);
    // pirate or national flag atop the mast
    const h = (src.userData.height as number) * L;
    const fl = flag(nation ? nationFlag(nation) : M().flagBlack, 0.01);
    fl.scale.setScalar(Math.max(1.2, L / 5));
    fl.position.set(0, h * 0.8, 0);
    g.add(fl);
    g.userData.flag = fl;
    return g;
  }

  /** wooden frame for a ship under construction: same model, clipped by progress */
  hullFrame(type: ShipType): THREE.Object3D {
    const g = this.instance(type);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.Material).clone();
      mat.clippingPlanes = [plane];
      m.material = mat;
    });
    g.userData.clip = plane;
    g.userData.L = LENGTH[type];
    return g;
  }
  setHullProgress(o: THREE.Object3D, p: number): void {
    const plane = o.userData.clip as THREE.Plane;
    const wp = new THREE.Vector3();
    o.getWorldPosition(wp);
    plane.constant = wp.y - 1 + p * (o.userData.L as number) * 0.9;
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    if (e.type === 'shipRemoved') {
      const v = this.views.get(e.id);
      if (v) this.group.remove(v);
      this.views.delete(e.id);
    }
  }

  pickShip(ray: THREE.Raycaster): number {
    const hits = ray.intersectObjects([...this.views.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.shipId) o = o.parent;
      if (o) return o.userData.shipId;
    }
    return 0;
  }

  shipPosition(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v && v.visible ? v.position.clone() : null;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.src.size) return;
    const g = this.game;
    for (const s of g.ships.values()) {
      let v = this.views.get(s.id);
      if (!v) {
        v = this.instance(s.type);
        v.userData.shipId = s.id;
        v.traverse((o) => (o.userData.shipId = s.id));
        this.views.set(s.id, v);
        this.group.add(v);
      }
      v.visible = s.status !== 'atsea' && s.status !== 'lost';
      if (!v.visible) continue;
      const moving = s.status === 'departing' || s.status === 'returning';
      v.position.set(s.vx, 0, s.vy);
      v.rotation.set(0, -s.vdir, 0);
      this.bob(v, s.id, moving);
      const fl = v.userData.flag as THREE.Object3D;
      if (fl) fl.rotation.y = Math.sin(this.t * 0.7 + s.id) * 0.3;
    }
    // invaders
    const inv = g.invaders ?? [];
    const live = new Set<number>();
    for (const iv of inv) {
      live.add(iv.id);
      let v = this.invaderViews.get(iv.id);
      if (!v) {
        v = this.instance(iv.soldiers > 6 ? 'galleon' : 'frigate', iv.nat);
        this.invaderViews.set(iv.id, v);
        this.group.add(v);
      }
      v.position.set(iv.x, 0, iv.y);
      v.rotation.set(0, -iv.dir, 0);
      if (iv.state === 'sunk') {
        v.position.y = -iv.timer * 0.4;
        v.rotation.z = Math.min(0.6, iv.timer * 0.08);
      } else this.bob(v, iv.id, iv.state === 'approach');
    }
    for (const [id, v] of this.invaderViews) if (!live.has(id)) {
      this.group.remove(v);
      this.invaderViews.delete(id);
    }
  }

  private bob(v: THREE.Object3D, id: number, moving: boolean): void {
    const t = this.t + id * 1.7;
    v.position.y = Math.sin(t * 1.1) * 0.06;
    v.rotation.x = Math.sin(t * 0.9) * (moving ? 0.035 : 0.02);
    v.rotation.z = Math.sin(t * 0.7 + 1) * (moving ? 0.03 : 0.015);
  }
}

const flagCache = new Map<Nation, THREE.Material>();
function nationFlag(n: Nation): THREE.Material {
  const hit = flagCache.get(n);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  if (n === 'eng') {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#c8102e';
    g.fillRect(52, 0, 24, 96);
    g.fillRect(0, 36, 128, 24);
  } else if (n === 'fra') {
    g.fillStyle = '#f4f0e0';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#d4af37';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(34 + i * 30, 48 + (i === 1 ? -14 : 8), 9, 0, 7);
      g.fill();
    }
  } else {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.strokeStyle = '#b01c2e';
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(14, 10);
    g.lineTo(114, 86);
    g.moveTo(114, 10);
    g.lineTo(14, 86);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
  flagCache.set(n, m);
  return m;
}
export { NAV_LENGTH as _NAV };
