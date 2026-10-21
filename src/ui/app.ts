import * as THREE from 'three';
import { Game, type Command } from '../sim/game';
import { BUILDING, type BuildingDef } from '../sim/data/buildings';
import { canPlace, footprint } from '../sim/placement';
import { enableAsyncPaths } from '../sim/pathservice';
import type { Settings } from '../sim/types';
import type { KingDef } from '../sim/data/kings';
import { World, type Quality } from '../render/world';
import { buildPrefab } from '../render/prefabs';
import { warmThumbPrograms } from './thumbs';
import { disposeObject } from '../render/dispose';
import { audio } from '../audio/audio';
import { el, setText } from './dom';
import { icon } from './icons';
import { Hud } from './hud';
import { Inspector } from './inspector';
import { BuildMenu } from './buildmenu';
import { EdictsPanel } from './edicts';
import { SeaChart } from './chart';
import { IslandLog } from './log';
import { Modal } from './modal';
import { MainMenu } from './menu';
import { Overlays } from './overlays';
import { saveGame, loadGame, hasSave } from './saves';
import { PlaceControls, type PlaceAction } from './placectl';
import { QuickRing } from './quickring';
import { short } from './buildmenu';
import type { Profiler } from './profiler';

/** wall-clock milliseconds per frame the simulation may use before it starts dropping backlog */
const SIM_BUDGET_MS = 8;

export type Tool =
  | { kind: 'select' }
  | { kind: 'build'; def: string; rot: number }
  | { kind: 'road' }
  | { kind: 'unroad' }
  | { kind: 'demolish' }
  | { kind: 'clear' }
  | { kind: 'target'; what: 'pirate' | 'captive' | 'ship'; edict: string; arg?: string };

export type Selection = { type: 'building' | 'person' | 'ship'; id: number } | null;

export class App {
  readonly root: HTMLElement;
  world!: World;
  game!: Game;
  tool: Tool = { kind: 'select' };
  selection: Selection = null;
  hud!: Hud;
  inspector!: Inspector;
  build!: BuildMenu;
  edicts!: EdictsPanel;
  chart!: SeaChart;
  log!: IslandLog;
  modal!: Modal;
  menu!: MainMenu;
  overlays!: Overlays;
  state: 'menu' | 'game' = 'menu';
  private ghost = new THREE.Group();
  private ghostKey = '';
  private hover: { x: number; y: number } | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private roadPreview = new THREE.Group();
  private cursorTip: HTMLElement;
  private last = performance.now();
  private uiTick = 0;
  private uiPhase = false;
  private autosaveAt = 0;
  private menuSpin = 0;
  quality: 'low' | 'medium' | 'high' = 'high';
  /** performance recording in progress (Settings › Record performance) */
  prof?: Profiler;
  fps = 60;
  private fpsAcc = { t: 0, n: 0 };

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.root = ui;
    this.cursorTip = el('div', 'cursor-tip hidden', document.body);
    try {
      this.quality = (localStorage.getItem('bc_quality') as any) ?? defaultQuality();
    } catch {
      /* ignore */
    }
  }

  /**
   * Render settings per tier ('high' also lets dynamic resolution step its pixel ratio down, only while the GPU cannot
   * keep up, so input never waits on slow frames; it climbs back to full as soon as frames make the budget).
   * 'high' draws the same image as ever (4096 soft shadows, full-res GTAO, full bloom, SMAA,
   * device pixel ratio up to 2); its savings are all lossless (see World). 'medium' and 'low' trade looks for speed and
   * let dynamic resolution keep them inside the frame budget (?dynres=0 turns that off).
   */
  qualitySettings(): Partial<Quality> {
    const dyn = !/[?&](dynres=0|shot=1)/.test(location.search);
    if (this.quality === 'low') return { shadows: false, ao: false, bloom: false, post: false, aa: 'none', pixelRatio: 1, minPixelRatio: 0.6, dynamicRes: dyn, flashLights: 0 };
    if (this.quality === 'medium') return { shadows: true, shadowSize: 2048, softShadows: false, shadowHz: 30, ao: false, bloom: true, bloomScale: 0.5, aa: 'fxaa', pixelRatio: 1.25, minPixelRatio: 0.75, dynamicRes: dyn, flashLights: 1 };
    return { shadows: true, shadowSize: 4096, softShadows: true, shadowHz: 1000, ao: true, aoScale: 1, aoSamples: 12, aoDepthNormals: /[?&]aodepth=1/.test(location.search), bloom: true, bloomScale: 1, aa: 'smaa', propShadows: true, pixelRatio: 2, minPixelRatio: 1, dynamicRes: dyn, flashLights: 2 };
  }

  /** switch the graphics tier live (settings) */
  applyQuality(): void {
    this.world.setQuality(this.qualitySettings());
  }

  async init(): Promise<void> {
    // async: picks WebGPU or WebGL and waits for the renderer to initialise (World may swap in a fresh canvas)
    this.world = await World.create(this.canvas, this.qualitySettings());
    this.canvas = this.world.canvas;
    // no graphics acceleration: everything is drawn on the CPU, so drop to the cheapest settings (unless ?q= forces a tier)
    if (this.world.gpu.software && !/[?&]q=/.test(location.search)) {
      this.quality = 'low';
      this.world.setQuality(this.qualitySettings());
    }
    this.world.scene.add(this.ghost, this.roadPreview);
    await audio.init();
    this.modal = new Modal(this);
    this.hud = new Hud(this);
    if (this.world.gpu.software) this.hud.gpuNotice(this.world.gpu.renderer);
    this.inspector = new Inspector(this);
    this.build = new BuildMenu(this);
    this.edicts = new EdictsPanel(this);
    this.chart = new SeaChart(this);
    this.log = new IslandLog(this);
    this.overlays = new Overlays(this);
    this.menu = new MainMenu(this);
    this.soundButton();
    this.bindInput();
    audio.onVoice = (s) => this.hud.setSpeaking(s);
    window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
    window.addEventListener('keydown', () => audio.unlock(), { once: false });
  }

  /** a speaker button in the corner, on the title screen and in play: mutes everything, remembered */
  private soundButton(): void {
    const b = el('button', 'soundbtn', this.root) as HTMLButtonElement;
    const paint = () => {
      b.innerHTML = icon(audio.muted ? 'speakerOff' : 'speaker', 22).html;
      b.title = audio.muted ? 'Sound off (click to turn on)' : 'Sound on (click to mute)';
      b.setAttribute('aria-label', b.title);
      b.classList.toggle('off', audio.muted);
    };
    b.onclick = (e) => {
      e.stopPropagation();
      audio.unlock();
      audio.setMuted(!audio.muted);
      paint();
    };
    b.onpointerdown = (e) => e.stopPropagation();
    paint();
  }

  /** a background game for the title screen */
  async showMenu(): Promise<void> {
    this.state = 'menu';
    const g = new Game({ seed: 4242 });
    await this.attach(g);
    g.run(30);
    this.world.rig.setDist(70, true);
    this.world.rig.edgeScroll = false;
    this.hud.show(false);
    this.menu.show();
    audio.setMood('menu');
  }

  async attach(g: Game): Promise<void> {
    // one path worker per game: the old game's goes (its waiting people would search synchronously)
    if (this.game && this.game !== g) this.game.paths?.dispose();
    this.game = g;
    // long path searches off the main thread; screenshots (and ?paths=sync) keep them deterministic and inline
    if (!g.paths && !/[?&](shot=1|paths=sync)/.test(location.search)) enableAsyncPaths(g);
    this.world.attach(g);
    await Promise.all([this.world.ships.ready, this.world.people.ready]);
    await this.world.warmShaders();
    await this.warmBuildPrograms();
    (window as any).__game = g;
  }

  private buildWarm = false;
  /**
   * Once per session, under the loading card: compile the shaders of every building as built and as the placement
   * ghost, and those of the construction menu's thumbnails. Browsers without parallel shader compilation (Firefox,
   * many phones) otherwise froze for 100-400 ms the first time each kind showed up (opening the build menu, picking
   * a building, its first construction).
   */
  private async warmBuildPrograms(): Promise<void> {
    if (this.buildWarm || /[?&](shot=1|nowarm=1)/.test(location.search)) return;
    this.buildWarm = true;
    const ids = Object.keys(BUILDING).filter((id) => BUILDING[id].cat);
    const w = this.world;
    const g = new THREE.Group();
    for (const id of ids) {
      const def = BUILDING[id];
      const built = buildPrefab(id, def.size[0], def.size[1], 1);
      const ghost = buildPrefab(id, def.size[0], def.size[1], 1);
      ghost.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = (Array.isArray(m.material) ? m.material[0] : m.material).clone();
        const mm = m.material as THREE.MeshStandardMaterial;
        mm.transparent = true;
        mm.opacity = 0.62;
        mm.depthWrite = false;
      });
      g.add(built, ghost);
    }
    g.position.set(0, -500, 0); // compiled, never seen
    w.scene.add(g);
    try {
      await Promise.race([w.renderer.compileAsync(g, w.rig.camera, w.scene), new Promise((r) => setTimeout(r, 8000))]);
    } catch (e) {
      console.warn('building warm-up', e);
    }
    w.scene.remove(g);
    disposeObject(g, { keep: w.scene, renderer: w.renderer });
    await warmThumbPrograms(w, ids);
  }

  /** a full-screen loading card while a game is built, painted before the heavy work starts */
  private async withLoading<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const card = el('div', 'loading', document.body);
    card.innerHTML = `<div style="text-align:center"><div class="t">Buccaneer Cove</div><div class="pbar busy"><div></div></div><div class="lt" style="margin-top:8px;font-family:var(--body);opacity:.85">${label}</div></div>`;
    // let the card paint before the synchronous island generation blocks the thread
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    try {
      return await fn();
    } finally {
      card.classList.add('fade');
      setTimeout(() => card.remove(), 400);
    }
  }

  async newGame(settings: Partial<Settings>, king: KingDef, botYears = 0): Promise<void> {
    if (this.state === 'menu' && !location.search.includes('shot')) return this.withLoading('Charting your island...', () => this.newGameNow(settings, king, botYears));
    return this.newGameNow(settings, king, botYears);
  }

  private async newGameNow(settings: Partial<Settings>, king: KingDef, botYears = 0): Promise<void> {
    const g = new Game(settings, king);
    if (botYears > 0) {
      // debug/screenshots: let the bot play for a while before the world is built
      const { Bot } = await import('../sim/bot');
      const { MONTH } = await import('../sim/game');
      const bot = new Bot(g, {});
      const n = Math.round((botYears * 12 * MONTH) / 0.1);
      for (let i = 0; i < n && !g.over; i++) {
        g.step();
        bot.step();
        g.events.length = 0;
      }
      g.over = null as any;
    }
    await this.attach(g);
    this.startPlaying();
  }

  async continueGame(slot = 'auto'): Promise<boolean> {
    const json = await loadGame(slot);
    if (!json) return false;
    return this.withLoading('Hoisting the sails...', async () => {
      const g = Game.deserialize(json);
      await this.attach(g);
      this.startPlaying();
      return true;
    });
  }

  hasSave(slot = 'auto'): Promise<boolean> {
    return hasSave(slot);
  }

  async save(slot = 'auto'): Promise<void> {
    if (this.state !== 'game' || !this.game || this.game.over) return;
    const g = this.game;
    await saveGame(slot, g.serialize(), { time: g.time, king: g.king.name });
  }

  private startPlaying(): void {
    this.state = 'game';
    this.menu.hide();
    this.hud.show(true);
    this.world.rig.edgeScroll = true;
    this.world.rig.setDist(48, true);
    this.selection = null;
    this.setTool({ kind: 'select' });
    this.autosaveAt = performance.now() + 180000;
    audio.setMood('island');
  }

  quitToMenu(): void {
    this.closeAll();
    this.showMenu();
  }

  cmd(c: Command): boolean {
    const r = this.game.cmd(c);
    this.ghostCheck.key = ''; // the build ghost re-checks placement against the changed island
    if (!r.ok && r.reason) {
      this.hud.flash(r.reason);
      audio.sfx('ui_error');
    }
    return r.ok;
  }

  closeAll(): void {
    this.build.hide();
    this.edicts.hide();
    this.chart.hide();
    this.log.hide();
    this.overlays.hide();
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.ghostKey = '';
    this.ghost.clear();
    this.roadPreview.clear();
    this.cursorTip.classList.add('hidden');
    this.hud.updateTool();
    this.canvas.style.cursor = t.kind === 'select' ? 'default' : 'crosshair';
    // keep the screen clear while building on small screens
    if (t.kind !== 'select' && this.touchMode) this.select(null);
    // on touch screens one finger drags roads / clears trees; otherwise it pans the map
    this.world.rig.touchPan = !(t.kind === 'road' || t.kind === 'clear' || t.kind === 'unroad');
    // see-through trees while laying roads, so the ground (and existing paths) under the canopy stay visible
    this.world.veg?.setGhost(t.kind === 'road' || t.kind === 'unroad');
    this.roadPending = null;
    this.roadPick = null;
    // on touch there is no pointer to follow: a new building starts in the middle of the view, controls beside it
    if (t.kind === 'build' && this.touchMode && this.state === 'game') {
      const r = this.canvas.getBoundingClientRect();
      this.hover = this.tileAt({ clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.45 }) ?? this.hover;
    }
    // phones hide the minimap while placing, so it never sits under the controls beside the ghost
    this.root.classList.toggle('placing', t.kind === 'build' || t.kind === 'road');
  }

  /** true once the player has touched the screen (shows touch affordances) */
  touchMode = false;

  /** placement controls beside the ghost (touch: rotate / confirm / cancel; mouse: just the cost tag) */
  private placeCtl!: PlaceControls;
  /** a road dragged out on a touch screen, waiting for the player to confirm it */
  private roadPending: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;

  /** a road tile picked with the select tool (offers "pull up road" beside it) */
  private roadPick: { x: number; y: number } | null = null;

  private placeAction(a: PlaceAction): void {
    const tool = this.tool;
    audio.sfx('ui_click');
    if (tool.kind === 'select' && this.roadPick) {
      const rp = this.roadPick;
      this.roadPick = null;
      if (a === 'ok' && this.cmd({ type: 'unroad', x: rp.x, y: rp.y })) audio.sfx('demolish');
      return;
    }
    if (tool.kind === 'road' || tool.kind === 'unroad') {
      const rp = this.roadPending;
      this.roadPending = null;
      this.roadPreview.clear();
      if (a === 'ok' && rp && this.cmd({ type: 'roadLine', x0: rp.start.x, y0: rp.start.y, x1: rp.end.x, y1: rp.end.y })) audio.sfx('build_place');
      if (a === 'cancel' && !rp) this.setTool({ kind: 'select' });
      return;
    }
    if (tool.kind !== 'build') return;
    if (a === 'cancel') return this.setTool({ kind: 'select' });
    if (a === 'rotl' || a === 'rotr') {
      tool.rot = (tool.rot + (a === 'rotr' ? 1 : 3)) % 4;
      this.ghostKey = '';
      return;
    }
    if (a === 'ok' && this.hover) {
      const def = BUILDING[tool.def];
      const pl = this.placement(def, this.hover, tool.rot);
      if (this.cmd({ type: 'build', def: def.id, x: pl.x, y: pl.y, rot: pl.rot })) {
        audio.sfx('build_place');
        if (!def.decor && def.id !== 'housing_plot') this.setTool({ kind: 'select' });
      }
    }
  }

  /** quick-action seals beside the selected building, ship or person */
  private ring!: QuickRing;
  /** a new selection waits for the inspector to settle, then the camera frames it clear of the sheets */
  private frameSel = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** where on the ground (at height y) the screen point lands */
  private groundAt(clientX: number, clientY: number, y = 0): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return null;
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.world.rig.camera);
    this.plane.constant = -y;
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p) ? p : null;
  }

  /**
   * The open part of the screen (client pixels): below the top bar, above the toolbar, and beside or above the
   * inspector, with room under the middle for the quick seals. Things the player is looking at belong in there.
   */
  private freeArea(): { l: number; r: number; t: number; b: number } {
    const q = (sel: string) => {
      const e = document.querySelector<HTMLElement>(sel);
      return e && !e.classList.contains('hidden') && e.offsetParent ? e.getBoundingClientRect() : null;
    };
    const cr = this.canvas.getBoundingClientRect();
    const top = q('.topbar'), clock = q('.clock'), tb = q('.toolbar'), ins = q('.panel.inspector'), mm = q('.minimap');
    const a = { l: cr.left, r: cr.right, t: Math.max(top?.bottom ?? 0, clock && clock.left < cr.width * 0.6 ? clock.bottom : 0), b: tb?.top ?? cr.bottom };
    if (ins) {
      if (ins.left > cr.width * 0.35 && ins.top < cr.height * 0.45) a.r = Math.min(a.r, ins.left);
      else a.b = Math.min(a.b, ins.top);
    }
    if (mm && mm.top < cr.height * 0.5) a.l = Math.max(a.l, mm.right + 16);
    return a;
  }

  /** the camera target that puts world point (x, z) at the middle of the free area */
  private framedTarget(x: number, z: number, y = 0): { x: number; z: number } {
    const a = this.freeArea();
    const cr = this.canvas.getBoundingClientRect();
    const sx = (a.l + a.r) / 2, sy = a.t + Math.max(40, (a.b - a.t - 70) * 0.5);
    // the camera only translates when it pans: move its target (where the centre ray meets the target's height) by
    // however far the point at height y under the chosen spot is from (x, z)
    this.world.rig.camera.updateMatrixWorld();
    const c = this.groundAt(cr.left + cr.width / 2, cr.top + cr.height / 2, this.world.rig.target.y), g = this.groundAt(sx, sy, y);
    if (!c || !g) return { x, z };
    return { x: c.x + x - g.x, z: c.z + z - g.z };
  }

  /** after a new selection: if the inspector covers it (or its seals would not fit), pan it into the free area */
  private frameSelection(box: { x: number; y: number; z: number; h: number }): void {
    const a = this.freeArea();
    this.world.rig.camera.updateMatrixWorld();
    const my = box.y + box.h / 2;
    const v = new THREE.Vector3(box.x, my, box.z).project(this.world.rig.camera);
    const cr = this.canvas.getBoundingClientRect();
    const sx = cr.left + (v.x * 0.5 + 0.5) * cr.width, sy = cr.top + (-v.y * 0.5 + 0.5) * cr.height;
    if (sx > a.l + 50 && sx < a.r - 50 && sy > a.t + 60 && sy < a.b - 130) return;
    const t = this.framedTarget(box.x, box.z, my);
    this.world.rig.lookAt(t.x, t.z);
  }

  select(s: Selection): void {
    const fresh = !!s && (s.type !== this.selection?.type || s.id !== this.selection?.id);
    this.selection = s;
    if (fresh) this.frameSel = true;
    this.roadPick = null;
    this.world.buildings.select(s?.type === 'building' ? s.id : 0);
    this.world.people.selected = s?.type === 'person' ? s.id : 0;
    this.inspector.refresh(true);
    if (s) audio.sfx('ui_click');
    if (s?.type === 'person') {
      const p = this.game.people.get(s.id);
      if (p) audio.bark(barkVoice(p));
    }
  }

  follow(): void {
    const s = this.selection;
    if (!s) return;
    const w = this.world;
    w.rig.follow = () => {
      if (s.type === 'person') return w.people.personPosition(s.id);
      if (s.type === 'ship') return w.ships.shipPosition(s.id);
      const b = this.game.buildings.get(s.id);
      return b ? new THREE.Vector3(b.x + b.w / 2, 0, b.y + b.h / 2) : null;
    };
    // keep what is followed in the free area, clear of the inspector
    const f = w.rig.follow;
    const off = this.framedTarget(0, 0);
    w.rig.follow = () => {
      const p = f();
      return p ? p.set(p.x + off.x, p.y, p.z + off.z) : null;
    };
  }

  /** pan to a spot, framing it in the free part of the screen (beside or above an open inspector) */
  jumpTo(x: number, y: number): void {
    const t = this.framedTarget(x, y);
    this.frameSel = false;
    this.world.rig.lookAt(t.x, t.z);
  }

  /** place (or hide) the quick seals beside the selection; frames a fresh selection */
  private updateRing(): void {
    const sheet = this.build.visible || this.edicts.visible || this.chart.visible || this.log.visible;
    const q = this.state === 'game' && this.tool.kind === 'select' && !this.roadPick && !this.modal.open && !sheet ? this.inspector.quick() : null;
    if (!q) {
      this.ring.hide();
      this.inspector.setRinged(false);
      return;
    }
    if (this.frameSel) {
      this.frameSel = false;
      this.frameSelection(q.box);
    }
    this.ring.show(this.world.rig.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight }, q.box, q.acts, this.inspector.folded ? q.name : null, this.touchMode);
    this.inspector.setRinged(this.ring.visible);
  }

  // ------------------------------------------------------------------------------------------------- input

  private tileAt(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const p = this.world.pick(ev.clientX, ev.clientY);
    if (!p) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z) };
  }

  private bindInput(): void {
    const c = this.canvas;
    this.placeCtl = new PlaceControls(this.root, (a) => this.placeAction(a));
    this.ring = new QuickRing(this.root, this.inspector.acts, () => audio.sfx('ui_click'));
    let touches = 0;
    c.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch') {
        touches++;
        if (!this.touchMode) {
          this.touchMode = true;
          document.body.classList.add('touch');
        }
      }
    });
    const lift = (ev: PointerEvent) => {
      if (ev.pointerType === 'touch') touches = Math.max(0, touches - 1);
    };
    c.addEventListener('pointercancel', lift);
    c.addEventListener('pointermove', (ev) => {
      if (this.state !== 'game') return;
      this.hover = this.tileAt(ev);
      this.cursorTip.style.transform = `translate(${ev.clientX + 16}px,${ev.clientY + 14}px)`; // no layout for a move
      if (this.tool.kind === 'clear' && this.dragStart && this.hover) this.cmd({ type: 'clearTrees', x: this.hover.x, y: this.hover.y, r: 1 });
    });
    c.addEventListener('pointerdown', (ev) => {
      if (this.state !== 'game' || ev.button !== 0) return;
      if (ev.pointerType === 'touch' && touches > 1) {
        this.dragStart = null; // second finger: it's a pinch, not a tool drag
        return;
      }
      const t = this.tileAt(ev);
      if (!t) return;
      if (ev.pointerType === 'touch') this.hover = t;
      this.dragStart = t;
      this.roadPending = null; // a new drag replaces a road still waiting for its tick
      if (this.tool.kind === 'clear') this.cmd({ type: 'clearTrees', x: t.x, y: t.y, r: 1 });
    });
    c.addEventListener('pointerup', (ev) => {
      lift(ev);
      if (this.state !== 'game') return;
      if (ev.pointerType === 'touch') {
        const start = this.dragStart;
        this.dragStart = null;
        if (this.world.rig.gesture) return; // that was a pan or pinch
        const t = this.tileAt(ev);
        if (!t) return;
        this.hover = t;
        // building on touch: a tap moves the ghost; the tick beside it commits it
        if (this.tool.kind === 'build') return;
        // a road dragged out on touch waits beside its end for a tick (or a cross)
        if (this.tool.kind === 'road' && start) {
          this.roadPending = { start, end: t };
          return;
        }
        this.click(ev, t, start ?? t);
        return;
      }
      if (ev.button === 2) {
        // right click cancels a tool (drag-pan uses right button too, so only cancel on a short click)
        if (this.tool.kind !== 'select' && !this.panMoved(ev)) this.setTool({ kind: 'select' });
        return;
      }
      if (ev.button !== 0) return;
      const t = this.tileAt(ev);
      const start = this.dragStart;
      this.dragStart = null;
      if (!t) return;
      this.click(ev, t, start ?? t);
    });
    let rdown: { x: number; y: number } | null = null;
    c.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) rdown = { x: ev.clientX, y: ev.clientY };
    });
    this.panMoved = (ev: PointerEvent) => !!rdown && Math.hypot(ev.clientX - rdown.x, ev.clientY - rdown.y) > 6;
    window.addEventListener('keydown', (ev) => this.key(ev));
  }
  private panMoved: (ev: PointerEvent) => boolean = () => false;

  private click(ev: MouseEvent, t: { x: number; y: number }, start: { x: number; y: number }): void {
    const g = this.game;
    const tool = this.tool;
    switch (tool.kind) {
      case 'select': {
        const ray = this.world.ndcRay(ev.clientX, ev.clientY);
        const pid = this.world.people.pickPerson(ray);
        if (pid) return this.select({ type: 'person', id: pid });
        const sid = this.world.ships.pickShip(ray);
        if (sid) return this.select({ type: 'ship', id: sid });
        const bid = this.world.buildings.pickBuilding(ray) || g.tileBuilding(t.x, t.y)?.id || 0;
        if (bid) return this.select({ type: 'building', id: bid });
        this.select(null);
        // a road: offer to pull it up, right there
        this.roadPick = g.map.path[g.map.idx(t.x, t.y)] ? { x: t.x, y: t.y } : null;
        return;
      }
      case 'build': {
        const def = BUILDING[tool.def];
        const pl = this.placement(def, t, tool.rot);
        if (this.cmd({ type: 'build', def: def.id, x: pl.x, y: pl.y, rot: pl.rot })) {
          audio.sfx('build_place');
          if (!ev.shiftKey && !def.decor && def.id !== 'housing_plot') this.setTool({ kind: 'select' });
        }
        return;
      }
      case 'road':
        if (this.cmd({ type: 'roadLine', x0: start.x, y0: start.y, x1: t.x, y1: t.y })) audio.sfx('build_place');
        this.roadPreview.clear();
        return;
      case 'unroad':
        this.cmd({ type: 'unroad', x: t.x, y: t.y });
        return;
      case 'demolish': {
        const b = g.tileBuilding(t.x, t.y);
        if (b) this.demolishAsk(b.id);
        else if (g.map.path[g.map.idx(t.x, t.y)] && this.cmd({ type: 'unroad', x: t.x, y: t.y })) audio.sfx('demolish');
        return;
      }
      case 'target': {
        const ray = this.world.ndcRay(ev.clientX, ev.clientY);
        let id = 0;
        if (tool.what === 'ship') id = this.world.ships.pickShip(ray);
        else {
          id = this.world.people.pickPerson(ray);
          const p = g.people.get(id);
          if (p && tool.what === 'pirate' && p.kind !== 'pirate') id = 0;
          if (p && tool.what === 'captive' && p.kind === 'pirate') id = 0;
        }
        if (id) {
          this.edicts.issue(tool.edict, id, undefined, tool.arg);
          this.setTool({ kind: 'select' });
        }
        return;
      }
    }
  }

  /** placement origin for a building centred on the hovered tile, with dock auto-rotation */
  placement(def: BuildingDef, t: { x: number; y: number }, rot: number): { x: number; y: number; rot: number; ok: boolean; reason?: string } {
    const tryRot = (r: number) => {
      const [w, h] = footprint(def, r);
      const x = t.x - Math.floor((w - 1) / 2), y = t.y - Math.floor((h - 1) / 2);
      return { ...canPlace(this.game, def, x, y, r), x, y, rot: r };
    };
    let p = tryRot(rot);
    if (!p.ok && (def.water || def.id === 'boatyard')) {
      for (let r = 0; r < 4; r++) {
        const q = tryRot(r);
        if (q.ok) return q;
      }
    }
    return p;
  }

  private key(ev: KeyboardEvent): void {
    if (this.state !== 'game') return;
    if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
    const g = this.game;
    const k = ev.key;
    // a dialog has the keyboard: only Escape (which closes it, handled by the modal) gets through
    if (this.modal.open && k !== 'Escape') return;
    if (k === 'Escape') {
      if (this.modal.open) return;
      if (this.tool.kind !== 'select') return this.setTool({ kind: 'select' });
      if (this.build.visible || this.edicts.visible || this.chart.visible || this.log.visible || this.overlays.visible) return this.closeAll();
      if (this.selection) return this.select(null);
      this.modal.gameMenu();
      return;
    }
    if (k === ' ' || k === 'Pause' || k === 'p') {
      g.paused = !g.paused;
      ev.preventDefault();
      this.hud.updateSpeed();
    }
    if (k === 'r' || k === 'R') {
      if (this.tool.kind === 'build') {
        this.tool.rot = (this.tool.rot + (ev.shiftKey ? 3 : 1)) % 4;
        this.ghostKey = '';
      }
    }
    if (k === 'b') this.build.toggle();
    if (k === 'o') this.overlays.toggle();
    if ((k === '[' || k === ']') && this.overlays.visible) this.overlays.step(k === ']' ? 1 : -1);
    if (k === 'x') this.edicts.toggle();
    if (k === 'm' || k === 'Tab') {
      ev.preventDefault();
      this.chart.toggle();
    }
    if (k === 'l') this.log.toggle();
    if (k === 'f') this.follow();
    if (k === '1' || k === '2' || k === '3' || k === '4') {
      g.speed = [1, 2, 4, 8][+k - 1];
      g.paused = false;
      this.hud.updateSpeed();
    }
    if (k === 'Backspace') {
      // cycle disgruntled pirates
      const list = g.pirates().filter((p) => p.mood !== 'ok' && p.task.kind !== 'atsea');
      if (list.length) {
        const cur = this.selection?.type === 'person' ? list.findIndex((p) => p.id === this.selection!.id) : -1;
        const p = list[(cur + 1) % list.length];
        this.select({ type: 'person', id: p.id });
        this.jumpTo(p.x, p.y);
      }
    }
    if ((k === 'z' || k === 'Z') && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
      ev.preventDefault();
      this.undo();
    }
    if (k === 'Delete' && this.selection?.type === 'building') this.demolishAsk(this.selection.id);
    if (k === 'F5' || (k === 's' && ev.ctrlKey)) {
      ev.preventDefault();
      this.save('quick').then(() => this.hud.flash('Game saved.'));
    }
    if (ev.ctrlKey && ev.shiftKey && k.length === 1) this.cheatBuffer(k);
  }

  private cheat = '';
  private cheatBuffer(ch: string): void {
    this.cheat = (this.cheat + ch.toLowerCase()).slice(-12);
    for (const code of ['timber', 'booty', 'freebuild', 'winit', 'loseit', 'britinv', 'frenchinv', 'spaininv', 'captives']) {
      if (this.cheat.endsWith(code)) {
        this.game.cmd({ type: 'cheat', code });
        this.hud.flash(`Cheat: ${code}`);
        this.cheat = '';
      }
    }
  }

  // ------------------------------------------------------------------------------------------------- per frame
  frame(now: number): void {
    const prof = this.prof;
    prof?.begin(now);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t > 1) {
      this.fps = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc = { t: 0, n: 0 };
    }
    const g = this.game;
    if (!g) return prof?.end();
    // the sim gets a bounded slice of each frame, so input and rendering stay responsive at 8x
    if (this.state === 'game' && !this.modal.pausing) g.advance(dt, SIM_BUDGET_MS);
    if (this.state === 'menu') {
      this.menuSpin += dt;
      this.world.rig.yaw = this.world.rig.yawGoal = Math.PI / 4 + this.menuSpin * 0.03;
      g.advance(dt, SIM_BUDGET_MS);
    }
    this.updateGhost();
    this.updateRing();
    prof?.lap('sim');
    // nothing advancing: the world may redraw at a low rate until something moves
    this.world.idle = this.state === 'game' && (g.paused || this.modal.pausing);
    this.world.render(dt);
    prof?.lap('render');
    if (this.state === 'game') {
      this.handleEvents();
      // UI refreshes alternate between frames (HUD + inspector, then the big panels) so no frame does both
      this.uiTick += dt;
      if (this.uiTick > 0.125) {
        this.uiTick = 0;
        this.uiPhase = !this.uiPhase;
        if (this.uiPhase) {
          this.hud.update();
          this.inspector.refresh();
        } else {
          this.build.refresh();
          this.edicts.refresh();
          this.log.refresh();
          this.chart.refresh();
          this.ambience();
        }
      }
      this.hud.minimap.draw();
      this.overlays.update();
      if (now > this.autosaveAt) {
        this.autosaveAt = now + 180000;
        this.save('auto');
      }
    }
    g.events.length = 0;
    if (prof) {
      prof.lap('ui');
      prof.end();
    }
  }

  /** take back the last construction command (Ctrl/Cmd+Z, or the Undo button) */
  undo(): void {
    if (this.state !== 'game') return;
    const r = this.game.cmd({ type: 'undo' }) as { ok: boolean; reason?: string; label?: string };
    this.ghostCheck.key = '';
    if (r.ok) {
      audio.sfx('build_place');
      this.hud.flash(`Undone: ${r.label}`);
    } else this.hud.flash(r.reason ?? 'Nothing to undo.');
  }

  /** confirm, then tear a building down (it can be undone) */
  demolishAsk(id: number): void {
    const b = this.game.buildings.get(id);
    if (!b) return;
    const def = BUILDING[b.def];
    if (b.def === 'palace') return void this.hud.flash('You cannot demolish your own palace!');
    const refundable = b.built < 1 && this.game.undo.some((e) => e.kind === 'build' && e.id === id);
    this.modal.confirm(`Demolish the ${def.name}?`, refundable ? 'It is still a construction site: Undo (Ctrl+Z) instead takes it back with a full refund.' : 'It will be torn down and nothing refunded. Undo (Ctrl+Z) brings it back.', () => {
      if (this.cmd({ type: 'demolish', id })) {
        audio.sfx('demolish');
        if (this.selection?.type === 'building' && this.selection.id === id) this.select(null);
      }
    });
  }

  private handleEvents(): void {
    const g = this.game;
    const tgt = this.world.rig.target;
    const d = (x: number, y: number) => Math.hypot(x - tgt.x, y - tgt.z) * (this.world.rig.dist / 40);
    for (const e of g.events) {
      this.hud.minimap.onEvent(e);
      switch (e.type) {
        case 'message':
          this.hud.message(e.msg);
          break;
        case 'cannon':
          audio.sfx('cannon_fire', d(e.x, e.y), 1, 0.15);
          break;
        case 'shipHit':
          audio.sfx('cannon_impact', d(e.x, e.y));
          break;
        case 'shipSunk':
          audio.sfx('explosion', d(e.x, e.y));
          break;
        case 'bell':
          audio.sfx('ship_bell');
          break;
        case 'built':
          audio.sfx('build_complete', 4);
          break;
        case 'death': {
          const p = g.people.get(e.id);
          audio.sfx(p?.sex === 'F' ? 'scream_f' : 'scream_m', d(e.x, e.y), 0.8, 1);
          break;
        }
        case 'hit':
          audio.sfx('sword_clash', 8, 0.6, 0.3);
          break;
        case 'plunder':
          if (e.gold > 0) audio.sfx('coins');
          break;
        case 'celebrate':
          audio.sfx('cheer_crowd');
          audio.sfx('drums_festival');
          break;
        case 'invasion':
          audio.setMood('tension');
          audio.sfx('horn_alert');
          break;
        case 'rebellion':
          audio.setMood('tension');
          break;
        case 'gameover':
          audio.sting(e.win ? 'victory' : 'defeat');
          this.modal.gameOver();
          break;
      }
    }
    // calm music again after invasions
    const danger = (g.invaders?.length ?? 0) > 0 || g.unrest.rebellion;
    if (!danger) audio.setMood('island');
  }

  private ambience(): void {
    const g = this.game;
    const t = this.world.rig.target;
    const m = g.map;
    const cd = m.coastDist();
    const tx = Math.max(0, Math.min(m.size - 1, Math.floor(t.x))), ty = Math.max(0, Math.min(m.size - 1, Math.floor(t.z)));
    const coast = cd[ty * m.size + tx];
    const zoom = Math.max(0.2, 1 - this.world.rig.dist / 200);
    audio.ambient('waves_loop', Math.max(0.15, 1 - coast / 14) * 0.7 * zoom + 0.1);
    let trees = 0;
    for (let j = -6; j <= 6; j += 2) for (let i = -6; i <= 6; i += 2) if (m.inBounds(tx + i, ty + j)) trees += m.trees[m.idx(tx + i, ty + j)];
    audio.ambient('jungle_loop', Math.min(0.6, trees / 60) * zoom);
    let venues = 0;
    for (const b of g.buildings.values()) if (BUILDING[b.def].service && Math.hypot(b.x - t.x, b.y - t.z) < 14) venues += b.customers.length;
    audio.ambient('tavern_murmur_loop', Math.min(0.6, venues / 12) * zoom);
    let work = 0;
    for (const b of g.buildings.values()) if (b.built < 1 && Math.hypot(b.x - t.x, b.y - t.z) < 14) work++;
    audio.ambient('hammer_loop', Math.min(0.5, work * 0.25) * zoom);
  }

  // ------------------------------------------------------------------------------------------------- ghost
  /** shared preview resources: one tile quad, two materials and a pool of tile meshes (nothing allocated per frame) */
  private previewRes?: { geo: THREE.BufferGeometry; road: THREE.Material; bad: THREE.Material; pool: THREE.Mesh[] };
  private previewKey = '';
  /** placement check + cursor text for the build ghost, redone when the tile/tool/rotation changes (or every 250 ms
   *  for treasury, lumber and sim changes) */
  private ghostCheck = { key: '', at: 0, pl: null as ReturnType<App['placement']> | null, reason: '', text: '', poor: false };

  private previewResources() {
    return (this.previewRes ??= {
      geo: new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
      road: new THREE.MeshBasicMaterial({ color: 0xe0c070, transparent: true, opacity: 0.45, depthWrite: false }),
      bad: new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.45, depthWrite: false }),
      pool: [],
    });
  }

  private updateGhost(): void {
    const tool = this.tool;
    const h = this.hover;
    const hv = h;
    if (this.state === 'game' && tool.kind === 'select' && this.roadPick) {
      this.ghost.visible = false;
      const rp = this.roadPick;
      if (!this.game.map.path[this.game.map.idx(rp.x, rp.y)]) this.roadPick = null;
      else {
        const ex = rp.x + 0.5, ez = rp.y + 0.5;
        // mark the picked tile in red, like the demolish preview
        const pk = `pick:${rp.x},${rp.y}`;
        if (this.previewKey !== pk) {
          this.previewKey = pk;
          const pv = this.previewResources();
          this.roadPreview.clear();
          const m = (pv.pool[0] ??= new THREE.Mesh(pv.geo, pv.bad));
          m.material = pv.bad;
          m.renderOrder = 3;
          m.position.set(ex, Math.max(0.05, this.game.map.heightAt(ex, ez)) + 0.06, ez);
          this.roadPreview.add(m);
        }
        this.placeCtl.show(this.world.rig.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight },
          { x: ex, y: Math.max(0.05, this.game.map.heightAt(ex, ez)), z: ez, w: 1, d: 1, h: 0.3 }, 'Pull up this road?', true, 'roadsel', true);
        return;
      }
    }
    if (this.previewKey.startsWith('pick:') && !this.roadPick) {
      this.previewKey = '';
      this.roadPreview.clear();
    }
    if (this.state !== 'game' || !h) {
      this.ghost.visible = false;
      this.placeCtl?.hide();
      return;
    }
    if (tool.kind === 'build') {
      const def = BUILDING[tool.def];
      const now = performance.now();
      const gc = this.ghostCheck;
      const ck = `${def.id}:${tool.rot}:${h.x},${h.y}`;
      if (ck !== gc.key || now - gc.at > 250 || !gc.pl) {
        gc.key = ck;
        gc.at = now;
        const pl = (gc.pl = this.placement(def, h, tool.rot));
        // affordability / requirements
        let reason = pl.ok ? '' : pl.reason ?? '';
        const miss = this.game.missingReqs(def);
        const cost = this.game.costOf(def);
        if (!reason && miss.length) reason = miss[0] === 'unique' ? 'Only one allowed.' : `Requires a skilled ${miss.join(', ')}.`;
        // can't afford it: the tag says so in the treasurer's words, and looks different from a bad spot
        // (it wins over a bad spot: no spot will do until the money is there; the red footprint still shows the ground)
        gc.poor = !miss.length && ((cost.gold > 0 && this.game.treasury < cost.gold) || this.game.lumber() < cost.lumber);
        if (gc.poor) reason = `${def.name}: ${short(cost.gold, this.game.treasury, cost.lumber, this.game.lumber()).toLowerCase()}`;
        gc.reason = reason;
        gc.text = reason || `${def.name}  ·  ${cost.gold ? cost.gold + ' gold  ' : ''}${cost.lumber ? cost.lumber + ' lumber' : ''}`;
      }
      const pl = gc.pl!;
      const key = `${def.id}:${pl.rot}`;
      if (key !== this.ghostKey) {
        this.ghostKey = key;
        // free the previous ghost (its cloned materials and footprint geometry); cached model parts are kept
        const old = [...this.ghost.children];
        this.ghost.clear();
        if (old.length) disposeObject(old, { keep: this.world.scene, renderer: this.world.renderer });
        const [w, d] = [def.size[0], def.size[1]];
        const model = buildPrefab(def.id, w, d, 1);
        model.rotation.y = -pl.rot * (Math.PI / 2);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = (Array.isArray(m.material) ? m.material[0] : m.material).clone();
            const mm = m.material as THREE.MeshStandardMaterial;
            mm.transparent = true;
            mm.opacity = 0.62;
            mm.depthWrite = false;
            m.castShadow = false;
          }
        });
        this.ghost.add(model);
        const [fw, fh] = footprint(def, pl.rot);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh, fw, fh).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40ff40, transparent: true, opacity: 0.3, depthWrite: false, wireframe: false }));
        plane.name = 'foot';
        plane.renderOrder = 3;
        this.ghost.add(plane);
        const grid = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.PlaneGeometry(fw, fh, fw, fh).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        grid.name = 'grid';
        this.ghost.add(grid);
      }
      const [fw, fh] = footprint(def, pl.rot);
      const cx = pl.x + fw / 2, cz = pl.y + fh / 2;
      const gy = def.water === 'dock' ? 0 : Math.max(0.05, this.game.map.heightAt(cx, cz));
      this.ghost.position.set(cx, gy, cz);
      this.ghost.visible = true;
      const foot = this.ghost.getObjectByName('foot') as THREE.Mesh;
      const grid = this.ghost.getObjectByName('grid')!;
      foot.position.y = grid.position.y = 0.06;
      (foot.material as THREE.MeshBasicMaterial).color.set(pl.ok ? 0x40ff40 : 0xff3030);
      // the name/cost tag hangs from the ghost itself (with rotate / confirm / cancel beside it on touch screens)
      this.cursorTip.classList.add('hidden');
      this.placeCtl.show(this.world.rig.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight },
        { x: cx, y: gy, z: cz, w: fw, d: fh, h: Math.max(1.2, Math.min(fw, fh) * 0.8) }, gc.text, !gc.reason, 'build', this.touchMode, gc.poor);
    } else if (tool.kind === 'road' || tool.kind === 'unroad' || tool.kind === 'demolish' || tool.kind === 'clear') {
      this.ghost.visible = false;
      const rp = tool.kind === 'road' ? this.roadPending : null;
      const ds = tool.kind === 'road' ? (rp?.start ?? this.dragStart) : null;
      const h = rp?.end ?? hv!;
      const pk = `${tool.kind}:${h.x},${h.y}:${ds ? `${ds.x},${ds.y}` : ''}`;
      const pv = this.previewResources();
      // rebuild the tile preview only when the hovered tile or drag changes (or something cleared it)
      if (pk !== this.previewKey || !this.roadPreview.children.length) {
        this.previewKey = pk;
        this.roadPreview.clear();
        const pts: [number, number][] = [];
        if (ds) {
          let { x, y } = ds;
          pts.push([x, y]);
          while (x !== h.x) (x += Math.sign(h.x - x)), pts.push([x, y]);
          while (y !== h.y) (y += Math.sign(h.y - y)), pts.push([x, y]);
        } else pts.push([h.x, h.y]);
        const mat = tool.kind === 'road' ? pv.road : pv.bad;
        pts.forEach(([x, y], i) => {
          let m = pv.pool[i];
          if (!m) {
            m = pv.pool[i] = new THREE.Mesh(pv.geo, mat);
            m.renderOrder = 3;
          }
          m.material = mat;
          m.position.set(x + 0.5, Math.max(0.05, this.game.map.heightAt(x + 0.5, y + 0.5)) + 0.06, y + 0.5);
          this.roadPreview.add(m);
        });
      }
      if (rp) {
        const n = Math.abs(rp.end.x - rp.start.x) + Math.abs(rp.end.y - rp.start.y) + 1;
        const ex = rp.end.x + 0.5, ez = rp.end.y + 0.5;
        this.placeCtl.show(this.world.rig.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight },
          { x: ex, y: Math.max(0.05, this.game.map.heightAt(ex, ez)), z: ez, w: 1, d: 1, h: 0.3 }, `Road · ${n} tile${n > 1 ? 's' : ''}`, true, 'road', true);
      } else this.placeCtl.hide();
      if (tool.kind === 'demolish') {
        const b = this.game.tileBuilding(h.x, h.y);
        setText(this.cursorTip, b ? `Demolish ${BUILDING[b.def].name}` : 'Demolish');
        this.cursorTip.classList.remove('hidden', 'ok');
      } else this.cursorTip.classList.add('hidden');
    } else {
      this.ghost.visible = false;
      this.placeCtl.hide();
      if (tool.kind === 'target') {
        setText(this.cursorTip, `Click a ${tool.what} (right-click to cancel)`);
        this.cursorTip.classList.add('ok');
        this.cursorTip.classList.remove('hidden');
      }
    }
  }
}

function barkVoice(p: { kind: string; sex: string; id: number }): string {
  if (p.kind === 'pirate') return p.sex === 'F' ? 'pirate_f1' : ['pirate_m1', 'pirate_m2', 'pirate_m3'][p.id % 3];
  if (p.kind === 'captive') return p.sex === 'F' ? 'captive_f' : 'captive_m';
  if (p.kind === 'soldier') return 'soldier';
  if (p.kind === 'wealthy') return 'wealthy';
  return 'polly';
}

/**
 * Graphics tier for a first run (a tier chosen in Settings is remembered instead): phones get 'low', tablets and
 * small 4-core machines 'medium', everything else 'high'. Phones are told apart by a coarse primary pointer with no
 * hover, or a mobile/tablet browser; of those, a short screen side under 600 CSS px is a phone, anything larger a tablet.
 */
export function deviceClass(): 'phone' | 'tablet' | 'desktop' {
  const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const touchOnly = mq('(pointer: coarse)') && !mq('(hover: hover)');
  const short = Math.min(screen.width, screen.height);
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS 13+ poses as a Mac
  const mobile = touchOnly || iPadOS || (navigator as any).userAgentData?.mobile === true || /Mobi|iPhone|iPod|iPad|Android|Tablet/i.test(ua);
  if (mobile) return short < 600 ? 'phone' : 'tablet';
  return 'desktop';
}

function defaultQuality(): 'low' | 'medium' | 'high' {
  const d = deviceClass();
  if (d === 'phone') return 'low';
  if (d === 'tablet' || navigator.hardwareConcurrency <= 4) return 'medium';
  return 'high';
}
