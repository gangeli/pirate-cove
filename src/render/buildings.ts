import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Building } from '../sim/types';
import { BUILDING, PALACE_LEVELS } from '../sim/data/buildings';
import { buildPrefab, scaffold } from './prefabs';
import { bldModels } from './bldmodels';
import type { World } from './world';
import { SHIPS } from '../sim/data/ships';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { disposeObject, isShared, markShared } from './dispose';
import { wind } from './vegetation';

/**
 * Collapse a building's static meshes into one mesh per material (same look, a fraction of the draw calls and
 * shadow-pass draws). Only meshes whose geometry this building owns are merged (procedural prefab parts and
 * scaffolds); cached model geometry is shared between buildings and stays as it is. Animated or hooked parts
 * (flags, swinging signs, glows, LOD levels) are left alone.
 */
function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; meshes: THREE.Mesh[] }>();
  const skip = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
      if (!p.visible || p.userData.swing || p.userData.flag || p.userData.glow || (p as THREE.LOD).isLOD) return true;
    }
    return false;
  };
  const rel = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material)) return;
    if (isShared(m.geometry) || m.geometry.morphAttributes.position || skip(m)) return;
    rel.multiplyMatrices(inv, m.matrixWorld);
    if (rel.determinant() <= 0) return; // mirrored parts would flip their winding
    const attrs = Object.keys(m.geometry.attributes).sort().join(',');
    const key = `${m.material.uuid}|${attrs}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: m.material, meshes: [] }));
    g.meshes.push(m);
  });
  for (const { mat, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const out = new THREE.Mesh(merged, mat);
    out.castShadow = meshes[0].castShadow;
    out.receiveShadow = meshes[0].receiveShadow;
    out.renderOrder = meshes[0].renderOrder;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    root.add(out);
  }
}

/** flag cloth waving in the vertex shader (it used to rewrite and re-upload every flag's vertices each frame) */
const flagMats = new Map<THREE.Material, THREE.Material>();
function flagMaterial(base: THREE.Material): THREE.Material {
  let m = flagMats.get(base);
  if (!m) {
    m = base.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float fx = position.x + 0.35;
            float ph = modelMatrix[3].x * 1.7 + modelMatrix[3].z * 1.3;
            transformed.z += sin(uTime * 6.0 - fx * 6.0 + ph) * 0.07 * fx;
          }`,
        );
    };
    m.customProgramCacheKey = () => 'flagwave';
    markShared(m);
    flagMats.set(base, m);
  }
  return m;
}

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
    if (old) this.drop(old);
    const def = BUILDING[b.def];
    const W = b.rot % 2 ? b.h : b.w, D = b.rot % 2 ? b.w : b.h;
    let level = b.houseLevel ?? 1;
    if (b.def === 'palace') {
      level = 0;
      for (let i = 0; i < PALACE_LEVELS.length; i++) if (this.game.hoard >= PALACE_LEVELS[i].hoard) level = i;
    }
    const model = buildPrefab(b.def, W, D, level);
    mergeStatic(model);
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
      if (o.userData.flag) {
        const f = o as THREE.Mesh;
        if (!Array.isArray(f.material)) f.material = flagMaterial(f.material);
        v.flags.push(f);
      }
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
      mergeStatic(v.scaffold);
      v.scaffold.rotation.y = model.rotation.y;
      group.add(v.scaffold);
    }
    if (model.userData.hull) (model.userData as any).hullPos = model.userData.hull;
    this.group.add(group);
    this.views.set(b.id, v);
  }

  /** take a view out of the scene and free what only it used */
  private drop(v: View): void {
    this.group.remove(v.group);
    if (v.hull) v.group.remove(v.hull); // the ships view owns hull frames
    disposeObject(v.group, { keep: this.group, renderer: this.world.renderer });
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    const g = this.game;
    if (e.type === 'placed' || e.type === 'built' || e.type === 'houseUp') {
      const b = g.buildings.get(e.id);
      if (b) this.make(b);
    } else if (e.type === 'removed') {
      const v = this.views.get(e.id);
      if (v) this.drop(v);
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
