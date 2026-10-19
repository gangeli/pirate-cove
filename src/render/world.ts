import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Game } from '../sim/game';
import { TerrainMesh } from './terrain';
import { Water } from './water';
import { Vegetation, wind } from './vegetation';
import { CameraRig } from './camera';
import { setMaxAnisotropy } from './textures';
import { BuildingsView } from './buildings';
import { PeopleView } from './people';
import { ShipsView } from './ships';
import { Effects } from './effects';
import { disposeObject, disposeComposer } from './dispose';

export interface Quality {
  shadows: boolean;
  ao: boolean;
  bloom: boolean;
  pixelRatio: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  terrain!: TerrainMesh;
  water!: Water;
  veg!: Vegetation;
  buildings!: BuildingsView;
  people!: PeopleView;
  ships!: ShipsView;
  effects!: Effects;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private sky: Sky;
  private composer!: EffectComposer;
  private bloom?: UnrealBloomPass;
  private ao?: GTAOPass;
  private pmrem: THREE.PMREMGenerator;
  readonly sunDir = new THREE.Vector3();
  game!: Game;
  quality: Quality;
  time = 0;
  readonly raycaster = new THREE.Raycaster();
  readonly overlayGroup = new THREE.Group();
  private roadTex?: THREE.DataTexture;

  constructor(readonly canvas: HTMLCanvasElement, quality: Partial<Quality> = {}) {
    this.quality = { shadows: true, ao: true, bloom: true, pixelRatio: Math.min(window.devicePixelRatio, 2), ...quality };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.rig = new CameraRig(canvas);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    // sky + sun
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3.5;
    su.rayleigh.value = 1.4;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 0.55);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0xa9c8de, 250, 900);
    this.setSun(50, 32);
    this.scene.add(this.overlayGroup);
  }

  /** elevation & azimuth in degrees */
  setSun(elev: number, azim: number): void {
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    // environment from sky for PBR reflections
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) (sky2.material.uniforms as any)[k].value = (this.sky.material.uniforms as any)[k].value;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    const rt = this.pmrem.fromScene(envScene as any, 0.02);
    this.scene.environment = rt.texture;
    (this.scene as any).environmentIntensity = 0.55;
  }

  attach(game: Game): void {
    this.game = game;
    const m = game.map;
    const prev = [this.terrain?.mesh, this.terrain?.skirt, this.water?.mesh, this.veg?.group, this.buildings?.group, this.people?.group, this.ships?.group, this.effects?.group];
    for (const o of prev) if (o) this.scene.remove(o);
    this.terrain = new TerrainMesh(m);
    this.water = new Water(m);
    this.veg = new Vegetation(m);
    this.buildings = new BuildingsView(this, game);
    this.people = new PeopleView(this, game);
    this.ships = new ShipsView(this, game);
    this.effects = new Effects(this, game);
    this.roadTex = undefined; // the new terrain needs it in its own uniforms (the old one is freed below)
    this.updateRoadTex();
    this.overlayTex = undefined;
    this.setOverlay(null);
    this.scene.add(this.terrain.mesh, this.terrain.skirt, this.water.mesh, this.veg.group, this.buildings.group, this.people.group, this.ships.group, this.effects.group);
    // free the previous game's GPU resources (cache-owned and still-used ones are kept; see dispose.ts)
    disposeObject(prev, { keep: this.scene, renderer: this.renderer });
    this.rig.bounds = { min: 4, max: m.size - 4 };
    this.rig.heightAt = (x, z) => m.heightAt(x, z);
    const palace = game.findBuilding('palace');
    if (palace) this.rig.lookAt(palace.x + palace.w / 2, palace.y + palace.h + 4, true);
    this.setupComposer();
    const wu = this.water.uniforms;
    (wu.uSunDir.value as THREE.Vector3).copy(this.sunDir);
  }

  private setupComposer(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    disposeComposer(this.composer);
    const rt = new THREE.WebGLRenderTarget(size.x * this.quality.pixelRatio, size.y * this.quality.pixelRatio, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    if (this.quality.ao) {
      this.ao = new GTAOPass(this.scene, this.rig.camera, size.x, size.y);
      this.ao.blendIntensity = 0.85;
      (this.ao as any).updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 2, scale: 1, samples: 12 });
      this.composer.addPass(this.ao);
    }
    if (this.quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.5, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass(size.x * this.quality.pixelRatio, size.y * this.quality.pixelRatio));
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  updateRoadTex(): void {
    const m = this.game.map, n = m.size;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) data[i] = m.path[i] ? 255 : 0;
    if (!this.roadTex) {
      this.roadTex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
      this.roadTex.magFilter = THREE.LinearFilter;
      this.roadTex.minFilter = THREE.LinearFilter;
      (this.terrain.uniforms as any).uRoads = { value: this.roadTex };
      (this.terrain.uniforms as any).uMapN = { value: n };
    } else (this.roadTex.image.data as Uint8Array).set(data);
    this.roadTex.needsUpdate = true;
  }

  private overlayTex?: THREE.DataTexture;
  /** tile-resolution RGBA overlay tint on the terrain (null to clear) */
  setOverlay(data: Uint8Array | null): void {
    const n = this.game.map.size;
    const u = this.terrain.uniforms as any;
    if (!this.overlayTex || this.overlayTex.image.width !== n) {
      this.overlayTex = new THREE.DataTexture(new Uint8Array(n * n * 4), n, n, THREE.RGBAFormat);
      this.overlayTex.magFilter = THREE.LinearFilter;
      this.overlayTex.minFilter = THREE.LinearFilter;
      u.uOverlay = { value: this.overlayTex };
      u.uOverlayOn = { value: 0 };
    }
    if (data) (this.overlayTex.image.data as Uint8Array).set(data);
    this.overlayTex.needsUpdate = true;
    u.uOverlayOn.value = data ? 1 : 0;
  }

  /** process sim events relevant to visuals */
  private consumeEvents(): void {
    const ev = this.game.events;
    let roads = false, trees = false;
    for (const e of ev) {
      if (e.type === 'roads') roads = true;
      if (e.type === 'trees') trees = true;
      if (e.type === 'terrain') {
        this.terrain.syncHeights(e.x, e.y, e.x + e.w + 1, e.y + e.h + 1);
        this.water.syncHeights();
        trees = true;
      }
      this.buildings.onEvent(e);
      this.people.onEvent(e);
      this.ships.onEvent(e);
      this.effects.onEvent(e);
    }
    if (roads) this.updateRoadTex();
    if (trees) this.veg.rebuild();
    // UI/audio listeners consume the same list; it is cleared by the app after all listeners ran
  }

  render(dt: number): void {
    this.time += dt;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(w * this.quality.pixelRatio) || this.canvas.height !== Math.floor(h * this.quality.pixelRatio)) this.resize(w, h);
    this.rig.update(dt, w, h);
    this.consumeEvents();
    const t = this.time;
    this.terrain.uniforms.uTime.value = t;
    this.water.uniforms.uTime.value = t;
    wind.uTime.value = t;
    this.buildings.update(dt);
    this.people.update(dt);
    this.ships.update(dt);
    this.effects.update(dt);
    // shadow camera follows the view
    const tgt = this.rig.target;
    const ext = Math.min(120, this.rig.dist * 1.25 + 20);
    const sc = this.sun.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 400;
    sc.updateProjectionMatrix();
    // snap to texel grid to avoid shimmering
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    this.sun.target.position.set(snap(tgt.x), 0, snap(tgt.z));
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 200);
    this.composer.render(dt);
  }

  /** world point under a screen position (terrain or water plane) */
  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    if (hit && hit.point.y > -0.2) return hit.point;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : hit?.point ?? null;
  }

  ndcRay(clientX: number, clientY: number): THREE.Raycaster {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    return this.raycaster;
  }
}
