import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { FastAO, ScaledBloom } from './post';
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
  /** shadow map resolution */
  shadowSize: number;
  /** PCF soft (9 taps, bilinear) instead of plain PCF */
  softShadows: boolean;
  /** how often the shadow map is re-rendered while the view stands still (it is always redrawn when the view moves) */
  shadowHz: number;
  /** ambient occlusion (GTAO from the main depth buffer at aoScale of the screen) */
  ao: boolean;
  aoScale: number;
  aoSamples: number;
  /** AO normals reconstructed from the main depth buffer (no second scene render) instead of the normal pass;
   *  cheaper, but foliage comes out ~2% darker than the stock pass, so 'high' keeps the normal pass (?aodepth=1 tries it) */
  aoDepthNormals: boolean;
  bloom: boolean;
  /** bloom blur chain resolution relative to the frame */
  bloomScale: number;
  aa: 'smaa' | 'fxaa' | 'none';
  /** post-processing at all (off: render straight to the canvas, tone mapping in the materials) */
  post: boolean;
  /** upper bound for the device pixel ratio */
  pixelRatio: number;
  /** dynamic resolution: lowest pixel ratio the controller may drop to (= pixelRatio disables it) */
  minPixelRatio: number;
  dynamicRes: boolean;
  /** small props (barrels, crates, stools...) cast shadows too */
  propShadows: boolean;
  /** point lights for cannon muzzle flashes (each costs every lit pixel) */
  flashLights: number;
}

export const QUALITY_DEFAULTS: Quality = {
  shadows: true, shadowSize: 2048, softShadows: false, shadowHz: 30, ao: false, aoScale: 1, aoSamples: 12, aoDepthNormals: false, bloom: true, bloomScale: 0.25,
  aa: 'fxaa', post: true, propShadows: false, pixelRatio: 1, minPixelRatio: 0.7, dynamicRes: true, flashLights: 1,
};

export interface GpuInfo {
  renderer: string;
  vendor: string;
  /** rendering on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render, ...) or the browser flags a major performance caveat */
  software: boolean;
}

/** which GPU the browser gave us; software rasterisers make everything crawl */
function detectGpu(r: THREE.WebGLRenderer): GpuInfo {
  const gl = r.getContext();
  let renderer = '', vendor = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '');
  } catch {
    /* ignore */
  }
  let caveat = false;
  try {
    // browsers refuse this flag when they would fall back to a software rasteriser
    const g2 = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    caveat = !g2;
    g2?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore */
  }
  const soft = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|gdi generic|mesa offscreen/i.test(`${renderer} ${vendor}`);
  return { renderer: renderer || 'unknown', vendor, software: soft || caveat };
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
  readonly gpu: GpuInfo;
  private sky: Sky;
  private composer?: EffectComposer;
  private fxaa?: ShaderPass;
  private pmrem: THREE.PMREMGenerator;
  readonly sunDir = new THREE.Vector3();
  game!: Game;
  quality: Quality;
  /** current (dynamic) pixel ratio */
  pr = 1;
  time = 0;
  /** set by the app while nothing advances (paused, modal open): the view then redraws at a low rate unless something moves */
  idle = false;
  readonly raycaster = new THREE.Raycaster();
  readonly overlayGroup = new THREE.Group();
  private roadTex?: THREE.DataTexture;

  constructor(readonly canvas: HTMLCanvasElement, quality: Partial<Quality> = {}) {
    this.quality = { ...QUALITY_DEFAULTS, ...quality };
    // no preserveDrawingBuffer: it forces a full-frame copy every frame (screenshots go through the compositor)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.gpu = detectGpu(this.renderer);
    this.pr = this.maxPixelRatio();
    this.renderer.setPixelRatio(this.pr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // the shadow map is redrawn on demand (view moved, or at quality.shadowHz), not on every render call
    this.renderer.shadowMap.autoUpdate = false;
    // reading the compile log after every link stalls the thread until the driver finishes each shader in turn;
    // release builds skip it (and so let shaders compile in parallel), ?shadercheck turns it back on
    this.renderer.debug.checkShaderErrors = !import.meta.env.PROD || location.search.includes('shadercheck');
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
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 0.55);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0xa9c8de, 250, 900);
    this.setSun(50, 32);
    this.scene.add(this.overlayGroup);
    this.applyShadowQuality();
    const poke = () => (this.lastInput = performance.now());
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, poke, { passive: true });
  }

  private maxPixelRatio(): number {
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
  }

  /** switch quality live (settings): shadows, post chain and resolution */
  setQuality(q: Partial<Quality>): void {
    this.quality = { ...QUALITY_DEFAULTS, ...q };
    this.pr = this.maxPixelRatio();
    this.applyShadowQuality();
    this.effects?.setFlashLights(this.quality.flashLights);
    // shadow on/off and filter changes alter the shaders
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
    if (this.game) {
      this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
      this.setupComposer();
    }
  }

  private applyShadowQuality(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize || !q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as any).map = null;
    }
    this.shadowRect = null;
    this.renderer.shadowMap.needsUpdate = true;
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
    // the sun hangs still over the map centre; updateShadows() fits its frustum to the view
    const c = m.size / 2, R = m.size * 0.75 + 24;
    this.sun.target.position.set(c, 0, c);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, m.size);
    this.sun.shadow.camera.near = Math.max(1, m.size - R);
    this.sun.shadow.camera.far = m.size + R;
    this.shadowRect = null;
    this.effects.setFlashLights(this.quality.flashLights);
    this.setupComposer();
    const wu = this.water.uniforms;
    (wu.uSunDir.value as THREE.Vector3).copy(this.sunDir);
  }

  /** compile every material in the scene off the main thread (KHR_parallel_shader_compile), so the first
   *  frames of a new game don't stall on shader builds; gives up waiting after `ms` */
  async warmShaders(ms = 8000): Promise<void> {
    try {
      await Promise.race([this.renderer.compileAsync(this.scene, this.rig.camera), new Promise((r) => setTimeout(r, ms))]);
    } catch (e) {
      console.warn('shader warm-up', e);
    }
  }

  private setupComposer(): void {
    disposeComposer(this.composer);
    this.composer = undefined;
    this.fxaa = undefined;
    const q = this.quality;
    if (!q.post) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(size.x * pr), H = Math.floor(size.y * pr);
    // HalfFloat keeps the HDR highlights the bloom picks out; AO reads the main pass's depth texture
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 0, depthTexture: q.ao && q.aoDepthNormals ? new THREE.DepthTexture(W, H) : null });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    if (q.ao) this.composer.addPass(new FastAO(this.scene, this.rig.camera, W, H, q.aoScale, q.aoSamples, 0.85, q.aoScale < 1 ? 8 : 16, q.aoDepthNormals));
    if (q.bloom) this.composer.addPass(new ScaledBloom(new THREE.Vector2(W, H), 0.18, 0.5, 0.92, q.bloomScale));
    this.composer.addPass(new OutputPass());
    if (q.aa === 'smaa') this.composer.addPass(new SMAAPass(W, H));
    else if (q.aa === 'fxaa' && pr < 1.5) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
      this.updateFxaa();
    }
  }

  private updateFxaa(): void {
    if (!this.fxaa) return;
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.fxaa.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }

  resize(w: number, h: number): void {
    const prChanged = this.renderer.getPixelRatio() !== this.pr;
    if (prChanged) this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      if (prChanged) this.composer.setPixelRatio(this.pr);
      this.composer.setSize(w, h);
    }
    this.updateFxaa();
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------------- dynamic resolution
  private dts: number[] = [];
  private resCooldown = 3;
  private refresh = 1000 / 60;
  /** pixel ratio steps we dropped from recently: don't climb straight back into them */
  private resBlock = new Map<number, number>();

  /** lower the pixel ratio when frames run over budget, raise it again when every frame makes vsync */
  private adaptResolution(dt: number): void {
    const q = this.quality;
    if (!q.dynamicRes || q.minPixelRatio >= this.maxPixelRatio() || document.hidden) return;
    const ms = dt * 1000;
    if (ms <= 0 || ms >= 100) return; // stalls (tab switch, loading) say nothing about the GPU
    this.dts.push(ms);
    this.refresh = Math.min(this.refresh * 1.0005, Math.max(4, ms)); // the display's frame interval, slowly forgotten
    this.resCooldown -= dt;
    if (this.dts.length < 24 || this.resCooldown > 0) return;
    const s = [...this.dts].sort((x, y) => x - y);
    this.dts.length = 0;
    const med = s[s.length >> 1], p90 = s[Math.floor(s.length * 0.9)];
    const budget = Math.max(this.refresh * 1.3, 1000 / 55);
    const now = performance.now();
    const max = this.maxPixelRatio(), min = Math.min(max, q.minPixelRatio);
    const key = (v: number) => Math.round(v * 20);
    if (med > budget && this.pr > min) {
      this.resBlock.set(key(this.pr), now + 30000);
      this.pr = Math.max(min, Math.round((this.pr - (med > budget * 1.8 ? 0.2 : 0.1)) * 20) / 20);
      this.resCooldown = 1.2;
    } else if (p90 < this.refresh * 1.15 && this.pr < max) {
      const next = Math.min(max, Math.round((this.pr + 0.05) * 20) / 20);
      if ((this.resBlock.get(key(next)) ?? 0) < now) this.pr = next;
      this.resCooldown = 3;
    } else this.resCooldown = 0.5;
  }

  // ------------------------------------------------------------------------------------------------- shadows
  /** current shadow frustum in light space: x0..x1, y0..y1 */
  private shadowRect: { x0: number; x1: number; y0: number; y1: number } | null = null;
  private shadowAge = 0;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();

  /**
   * Fit the sun's orthographic shadow camera to the part of the ground the view can see. The light sits still
   * (aimed at the map centre), so in its space the view footprint just slides around; the frustum is refitted with
   * some slack only when the footprint leaves it or shrinks a lot (zoom), and snapped to whole texels so shadows
   * don't shimmer. Casters outside the footprint whose shadows fall inside it project into the same light-space
   * rectangle, so nothing is lost. The map is only re-rendered when the frustum changed or at quality.shadowHz.
   */
  private updateShadows(dt: number): void {
    const q = this.quality;
    if (!q.shadows) return;
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.position.copy(this.sun.position);
    sc.lookAt(this.sun.target.position);
    sc.updateMatrixWorld();
    const inv = sc.matrixWorldInverse;
    const gy = this.rig.target.y;
    const maxLen = Math.min(320, this.rig.dist * 3 + 40);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const d = this.tmpD.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
      let t = d.y < -0.02 ? (gy - cam.position.y) / d.y : maxLen;
      t = Math.min(t, maxLen);
      for (const lift of [0, 8]) {
        const p = this.tmpV.copy(cam.position).addScaledVector(d, t);
        p.y += lift;
        p.applyMatrix4(inv);
        x0 = Math.min(x0, p.x), x1 = Math.max(x1, p.x), y0 = Math.min(y0, p.y), y1 = Math.max(y1, p.y);
      }
    }
    const m = 3;
    x0 -= m, x1 += m, y0 -= m, y1 += m;
    const r = this.shadowRect;
    const fits = r && r.x0 <= x0 && r.x1 >= x1 && r.y0 <= y0 && r.y1 >= y1 && (r.x1 - r.x0) < (x1 - x0) * 1.6 && (r.y1 - r.y0) < (y1 - y0) * 1.6;
    let changed = false;
    if (!fits) {
      const N = this.sun.shadow.mapSize.x;
      // grow by 20% of slack, quantise the size so panning at a fixed zoom keeps a constant texel size
      const quant = (v: number) => Math.ceil((v * 1.2) / 8) * 8;
      // never wider than the square the view-centred frustum used to be (2 * ext), so texels are never coarser;
      // an axis that hits that cap is centred on the view target, as that square was
      const cap = 2 * Math.min(120, this.rig.dist * 1.25 + 20);
      const tl = this.tmpV.copy(this.rig.target).applyMatrix4(inv);
      const sw = Math.min(cap, quant(x1 - x0)), sh = Math.min(cap, quant(y1 - y0));
      const tx = sw / N, ty = sh / N;
      const cx = Math.round((sw >= cap ? tl.x : (x0 + x1) / 2) / tx) * tx, cy = Math.round((sh >= cap ? tl.y : (y0 + y1) / 2) / ty) * ty;
      const nr = { x0: cx - sw / 2, x1: cx + sw / 2, y0: cy - sh / 2, y1: cy + sh / 2 };
      if (!r || nr.x0 !== r.x0 || nr.x1 !== r.x1 || nr.y0 !== r.y0 || nr.y1 !== r.y1) {
        this.shadowRect = nr;
        sc.left = nr.x0;
        sc.right = nr.x1;
        sc.bottom = nr.y0;
        sc.top = nr.y1;
        sc.updateProjectionMatrix();
        changed = true;
      }
    }
    this.shadowAge += dt;
    if (changed || this.shadowAge >= 1 / q.shadowHz - 0.002) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowAge = 0;
    }
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
      // the overlay colours are authored like CSS colours (sRGB), so they come out as picked
      this.overlayTex.colorSpace = THREE.SRGBColorSpace;
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

  private lastInput = 0;
  private pendingDt = 0;
  private lastCam = new THREE.Matrix4();

  render(dt: number): void {
    this.adaptResolution(dt);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.floor(w * this.pr) || this.canvas.height !== Math.floor(h * this.pr)) this.resize(w, h);
    this.rig.update(dt, w, h);
    this.consumeEvents();
    this.pendingDt += dt;
    // nothing advancing and nobody touching anything: redraw at ~15 fps (water and flags keep moving, the GPU rests)
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const still = this.lastCam.equals(cam.matrixWorld);
    if (this.idle && still && performance.now() - this.lastInput > 500 && this.pendingDt < 1 / 15) return;
    this.lastCam.copy(cam.matrixWorld);
    dt = Math.min(0.1, this.pendingDt);
    this.pendingDt = 0;
    this.time += dt;
    const t = this.time;
    this.terrain.uniforms.uTime.value = t;
    this.water.uniforms.uTime.value = t;
    wind.uTime.value = t;
    this.buildings.update(dt);
    this.people.update(dt);
    this.ships.update(dt);
    this.effects.update(dt);
    this.updateShadows(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);
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
