import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Building } from '../sim/types';
import { BUILDING, PALACE_LEVELS } from '../sim/data/buildings';
import { buildPrefab, scaffold } from './prefabs';
import { bldModels } from './bldmodels';
import type { World } from './world';
import { SHIPS } from '../sim/data/ships';

interface View {
  group: THREE.Group;
  model: THREE.Group;
  scaffold?: THREE.Group;
  key: string;
  clip?: THREE.Plane;
  flags: THREE.Mesh[];
  swings: THREE.Object3D[];
  smoke: THREE.Vector3[];
  glows: THREE.Mesh[];
  hull?: THREE.Object3D;
  height: number;
}

export class BuildingsView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private t = 0;
  selected = 0;
  private selRing: THREE.LineLoop;

  constructor(private world: World, private game: Game) {
    world.renderer.localClippingEnabled = true;
    for (const b of game.buildings.values()) this.make(b);
    this.selRing = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe080, depthTest: false, transparent: true }));
    this.selRing.renderOrder = 10;
    this.selRing.visible = false;
    this.group.add(this.selRing);
  }

  private palaceLevel(): number {
    let lv = 0;
    for (let i = 0; i < PALACE_LEVELS.length; i++) if (this.game.hoard >= PALACE_LEVELS[i].hoard) lv = i;
    return lv;
  }

  private keyOf(b: Building): string {
    let lv = b.houseLevel ?? 0;
    if (b.def === 'palace') {
      lv = 0;
      for (let i = 0; i < PALACE_LEVELS.length; i++) if (this.game.hoard >= PALACE_LEVELS[i].hoard) lv = i;
    }
    return `${b.def}:${lv}:${b.built >= 1 ? 1 : 0}:${bldModels.stateOf(b.def, b.def === 'housing_plot' ? lv : b.def === 'palace' ? lv : 1)}`;
  }

  private make(b: Building): void {
    const old = this.views.get(b.id);
    if (old) this.group.remove(old.group);
    const def = BUILDING[b.def];
    const W = b.rot % 2 ? b.h : b.w, D = b.rot % 2 ? b.w : b.h;
    let level = b.houseLevel ?? 1;
    if (b.def === 'palace') {
      level = 0;
      for (let i = 0; i < PALACE_LEVELS.length; i++) if (this.game.hoard >= PALACE_LEVELS[i].hoard) level = i;
    }
    const model = buildPrefab(b.def, W, D, level);
    const group = new THREE.Group();
    group.add(model);
    const m = this.game.map;
    const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
    const gy = def.water === 'dock' ? 0 : m.height[m.idx(b.x, b.y)];
    group.position.set(cx, gy, cz);
    model.rotation.y = -b.rot * (Math.PI / 2);
    group.userData.buildingId = b.id;
    const v: View = { group, model, key: this.keyOf(b), flags: [], swings: [], smoke: [], glows: [], height: 1 };
    model.traverse((o) => {
      if (o.userData.flag) v.flags.push(o as THREE.Mesh);
      if (o.userData.swing) v.swings.push(o);
      if (o.userData.glow) v.glows.push(o as THREE.Mesh);
      if (o.userData.smoke) v.smoke.push((o.userData.smoke as THREE.Vector3).clone().applyMatrix4(new THREE.Matrix4().makeRotationY(model.rotation.y)));
      o.userData.buildingId = b.id;
    });
    if (model.userData.smoke) v.smoke.push((model.userData.smoke as THREE.Vector3).clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), model.rotation.y));
    const bb = new THREE.Box3().setFromObject(model);
    v.height = Math.max(0.5, bb.max.y);
    if (b.built < 1 && !def.instant) {
      v.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      model.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (!mm.isMesh) return;
        const mats = Array.isArray(mm.material) ? mm.material : [mm.material];
        const cl = mats.map((x) => {
          const c = x.clone();
          c.clippingPlanes = [v.clip!];
          c.clipShadows = true;
          return c;
        });
        mm.material = Array.isArray(mm.material) ? cl : cl[0];
      });
      v.scaffold = scaffold(W, D, v.height + 0.3);
      v.scaffold.rotation.y = model.rotation.y;
      group.add(v.scaffold);
    }
    if (model.userData.hull) (model.userData as any).hullPos = model.userData.hull;
    this.group.add(group);
    this.views.set(b.id, v);
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    const g = this.game;
    if (e.type === 'placed' || e.type === 'built' || e.type === 'houseUp') {
      const b = g.buildings.get(e.id);
      if (b) this.make(b);
    } else if (e.type === 'removed') {
      const v = this.views.get(e.id);
      if (v) this.group.remove(v.group);
      this.views.delete(e.id);
      if (this.selected === e.id) this.select(0);
    }
  }

  select(id: number): void {
    this.selected = id;
    const b = this.game.buildings.get(id);
    if (!b) {
      this.selRing.visible = false;
      return;
    }
    const m = this.game.map;
    const pts: THREE.Vector3[] = [];
    const y = (x: number, z: number) => Math.max(0.05, m.heightAt(x, z)) + 0.08;
    const add = (x: number, z: number) => pts.push(new THREE.Vector3(x, y(x, z), z));
    for (let i = 0; i <= b.w * 2; i++) add(b.x + i / 2, b.y);
    for (let i = 0; i <= b.h * 2; i++) add(b.x + b.w, b.y + i / 2);
    for (let i = b.w * 2; i >= 0; i--) add(b.x + i / 2, b.y + b.h);
    for (let i = b.h * 2; i >= 0; i--) add(b.x, b.y + i / 2);
    this.selRing.geometry.dispose();
    this.selRing.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.selRing.visible = true;
  }

  pickBuilding(ray: THREE.Raycaster): number {
    const hits = ray.intersectObjects(this.group.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.buildingId) o = o.parent;
      if (o) return o.userData.buildingId;
    }
    return 0;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    for (const [id, v] of this.views) {
      const b = g.buildings.get(id);
      if (!b) continue;
      const key = this.keyOf(b);
      if (key !== v.key) {
        this.make(b);
        continue;
      }
      // stream full detail only for buildings close enough to show it
      if (key.endsWith(':L') && v.group.position.distanceToSquared(this.world.rig.camera.position) < 45 * 45) {
        bldModels.request(b.def, b.houseLevel ?? (b.def === 'palace' ? this.palaceLevel() : 1));
      }
      if (v.clip) v.clip.constant = v.group.position.y + 0.02 + v.height * b.built;
      for (const f of v.flags) {
        const p = (f.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
        if (!f.userData.base) f.userData.base = Float32Array.from(p.array as Float32Array);
        const base = f.userData.base as Float32Array;
        for (let i = 0; i < p.count; i++) {
          const x = base[i * 3] + 0.35;
          p.setZ(i, base[i * 3 + 2] + Math.sin(this.t * 6 - x * 6 + id) * 0.07 * x);
        }
        p.needsUpdate = true;
      }
      for (const s of v.swings) s.rotation.z = Math.sin(this.t * 1.3 + id) * 0.08;
      for (const gl of v.glows) {
        const mat = gl.material as THREE.MeshBasicMaterial;
        mat.color.setRGB(1, 0.45 + 0.15 * Math.sin(this.t * 9 + id), 0.15);
      }
      if (b.built >= 1 && v.smoke.length && g.rng && Math.random() < dt * 3) {
        const working = b.workers.length > 0 || BUILDING[b.def].service || BUILDING[b.def].house;
        if (working) for (const s of v.smoke) this.world.effects.smoke(v.group.position.x + s.x, v.group.position.y + s.y, v.group.position.z + s.z);
      }
      // ship under construction on the slipway
      if (b.building_ship && v.model.userData.hullPos) {
        if (!v.hull) {
          v.hull = this.world.ships.hullFrame(b.building_ship.type);
          const hp = v.model.userData.hullPos as THREE.Vector3;
          v.hull.position.copy(hp.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), v.model.rotation.y));
          v.hull.rotation.y = v.model.rotation.y + Math.PI / 2;
          v.group.add(v.hull);
        }
        this.world.ships.setHullProgress(v.hull, b.building_ship.progress);
      } else if (v.hull) {
        v.group.remove(v.hull);
        v.hull = undefined;
      }
    }
    void SHIPS;
  }
}
