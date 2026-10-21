import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Game } from '../sim/game';
import { SHIPS, type ShipType } from '../sim/data/ships';
import type { World } from './world';
import { assetUrl, withKTX2 } from './textures';
import { markSharedTree } from './dispose';
import { M, flag } from './kit';
import type { Nation } from '../sim/data/kings';

const MODEL_FILES: Record<string, string> = { pinnace: 'ship_pinnace', medium: 'ship_medium', large1: 'ship_large1', large2: 'ship_large2' };
/** target hull length in tiles per ship type */
const LENGTH: Record<ShipType, number> = { snow: 7, schooner: 7.5, sloop: 9, brigantine: 10, frigate: 12.5, galleon: 14 };
export const NAV_LENGTH = 9;

/** model forward axis: hulls in the source files are modelled along -X (bow toward -X) */
const BOW = -1;

/**
 * Ship models load on first need, one file each (the pinnace alone is ~20 MB), and stay for the session, shared by
 * every game's ShipsView: `models` holds the loaded ones, `loads` the request per model so each file is fetched once.
 */
const models = new Map<string, THREE.Object3D>();
const loads = new Map<string, Promise<THREE.Object3D | null>>();
let loader: GLTFLoader | null = null;

function loadShipModel(k: string): Promise<THREE.Object3D | null> {
  let p = loads.get(k);
  if (!p) {
    p = loadShipModelNow(k).then(
      (m) => (models.set(k, m), m),
      (e) => {
        console.warn('ship model failed', k, e);
        loads.delete(k); // asked for again on a later frame
        return null;
      },
    );
    loads.set(k, p);
  }
  return p;
}

async function loadShipModelNow(k: string): Promise<THREE.Object3D> {
  loader ??= withKTX2(new GLTFLoader());
  const gltf = await loader.loadAsync(assetUrl(`models/${MODEL_FILES[k]}.glb`));
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
  wrap.add(bilgeFloor(root, len));
  wrap.scale.setScalar(1 / len);
  wrap.userData.height = size.y / len;
  markSharedTree(wrap); // cached for the whole session: never freed with a game's views
  return wrap;
}

/**
 * The models' hulls are open shells: looking down into the waist you saw the sea inside the ship. A dark plank floor
 * just above the waterline, inset within the hull's waterline footprint, closes it (it rides along with the ship).
 */
function bilgeFloor(root: THREE.Object3D, len: number): THREE.Mesh {
  root.updateMatrixWorld(true);
  let hull: THREE.Box3 | null = null;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /hull/i.test(m.name)) (hull ??= new THREE.Box3()).union(new THREE.Box3().setFromObject(m));
  });
  const bb = hull ?? new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const along = size.x >= size.z;
  const L = (along ? size.x : size.z) * 0.78, B = (along ? size.z : size.x) * 0.82;
  const g = new THREE.CircleGeometry(0.5, 40).rotateX(-Math.PI / 2);
  g.scale(along ? L : B, 1, along ? B : L);
  const floor = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.95 }));
  floor.position.set(c.x, 0.012 * len, c.z);
  floor.name = 'bilge_floor';
  floor.receiveShadow = true;
  return floor;
}

/** the loaded model for a ship type, or null (its load is started, and the caller asks again next frame) */
function shipModel(type: ShipType): THREE.Object3D | null {
  const k = SHIPS[type].model;
  const m = models.get(k);
  if (m) return m;
  void loadShipModel(k);
  return null;
}

export class ShipsView {
  readonly group = new THREE.Group();
  private views = new Map<number, THREE.Object3D>();
  private invaderViews = new Map<number, THREE.Object3D>();
  private t = 0;
  ready: Promise<void>;
  selected = 0;

  constructor(private world: World, private game: Game) {
    this.ready = this.load();
  }

  /** only the models this game's ships (and invaders) use: the rest load when a ship of theirs first appears */
  private async load(): Promise<void> {
    const g = this.game;
    const types = new Set<ShipType>([...g.ships.values()].map((s) => s.type));
    for (const iv of g.invaders ?? []) types.add(iv.soldiers > 6 ? 'galleon' : 'frigate');
    await Promise.all([...new Set([...types].map((t) => SHIPS[t].model))].map(loadShipModel));
  }

  /** a ship of this type, or null while its model is still loading */
  private instance(type: ShipType, nation?: Nation): THREE.Object3D | null {
    const src = shipModel(type);
    if (!src) return null;
    const g = new THREE.Group();
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

  /** wooden frame for a ship under construction: same model, clipped by progress (null while the model loads) */
  hullFrame(type: ShipType): THREE.Object3D | null {
    const g = this.instance(type);
    if (!g) return null;
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
    const g = this.game;
    for (const s of g.ships.values()) {
      let v = this.views.get(s.id);
      if (!v) {
        v = this.instance(s.type) ?? undefined;
        if (!v) continue; // model still loading: next frame
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
        v = this.instance(iv.soldiers > 6 ? 'galleon' : 'frigate', iv.nat) ?? undefined;
        if (!v) continue;
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
