import * as THREE from 'three';
import { Game, type Command } from '../sim/game';
import { BUILDING, type BuildingDef } from '../sim/data/buildings';
import { canPlace, footprint } from '../sim/placement';
import type { Settings } from '../sim/types';
import type { KingDef } from '../sim/data/kings';
import { World } from '../render/world';
import { buildPrefab } from '../render/prefabs';
import { audio } from '../audio/audio';
import { el } from './dom';
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
  fps = 60;
  private fpsAcc = { t: 0, n: 0 };

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.root = ui;
    this.cursorTip = el('div', 'cursor-tip hidden', document.body);
    try {
      this.quality = (localStorage.getItem('bc_quality') as any) ?? (navigator.hardwareConcurrency <= 4 ? 'medium' : 'high');
    } catch {
      /* ignore */
    }
  }

  qualitySettings() {
    return this.quality === 'low'
      ? { ao: false, bloom: false, shadows: false, pixelRatio: 1 }
      : this.quality === 'medium'
        ? { ao: false, bloom: true, shadows: true, pixelRatio: Math.min(1.25, devicePixelRatio) }
        : { ao: true, bloom: true, shadows: true, pixelRatio: Math.min(2, devicePixelRatio) };
  }

  async init(): Promise<void> {
    this.world = new World(this.canvas, this.qualitySettings());
    this.world.scene.add(this.ghost, this.roadPreview);
    await audio.init();
    this.modal = new Modal(this);
    this.hud = new Hud(this);
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
    this.game = g;
    this.world.attach(g);
    await Promise.all([this.world.ships.ready, this.world.people.ready]);
    (window as any).__game = g;
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
    this.touchPlace?.classList.toggle('hidden', !(t.kind === 'build' && this.touchMode));
  }

  /** true once the player has touched the screen (shows touch affordances) */
  touchMode = false;
  private touchPlace: HTMLElement | null = null;

  private buildTouchBar(): void {
    const bar = el('div', 'touchbar hidden', this.root);
    bar.innerHTML = `<button class="btn green" data-act="place">Place</button><button class="btn" data-act="rot">Rotate</button><button class="btn red" data-act="cancel">Cancel</button>`;
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      const tool = this.tool;
      if (act === 'cancel') return this.setTool({ kind: 'select' });
      if (tool.kind !== 'build') return;
      if (act === 'rot') {
        tool.rot = (tool.rot + 1) % 4;
        this.ghostKey = '';
      }
      if (act === 'place' && this.hover) {
        const def = BUILDING[tool.def];
        const pl = this.placement(def, this.hover, tool.rot);
        if (this.cmd({ type: 'build', def: def.id, x: pl.x, y: pl.y, rot: pl.rot })) {
          audio.sfx('build_place');
          if (!def.decor && def.id !== 'housing_plot') this.setTool({ kind: 'select' });
        }
      }
    });
    this.touchPlace = bar;
  }

  select(s: Selection): void {
    this.selection = s;
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
  }

  jumpTo(x: number, y: number): void {
    this.world.rig.lookAt(x, y);
  }

  // ------------------------------------------------------------------------------------------------- input

  private tileAt(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const p = this.world.pick(ev.clientX, ev.clientY);
    if (!p) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z) };
  }

  private bindInput(): void {
    const c = this.canvas;
    this.buildTouchBar();
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
      this.cursorTip.style.left = `${ev.clientX + 16}px`;
      this.cursorTip.style.top = `${ev.clientY + 14}px`;
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
        // building on touch: a tap moves the ghost; the Place button commits it
        if (this.tool.kind === 'build') {
          this.touchPlace?.classList.remove('hidden');
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
        if (b) {
          const def = BUILDING[b.def];
          this.modal.confirm(`Demolish the ${def.name}?`, 'The building will be torn down and nothing refunded.', () => {
            if (this.cmd({ type: 'demolish', id: b.id })) audio.sfx('demolish');
          });
        }
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
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t > 1) {
      this.fps = this.fpsAcc.n / this.fpsAcc.t;
      this.fpsAcc = { t: 0, n: 0 };
    }
    const g = this.game;
    if (!g) return;
    // the sim gets a bounded slice of each frame, so input and rendering stay responsive at 8x
    if (this.state === 'game' && !this.modal.pausing) g.advance(dt, SIM_BUDGET_MS);
    if (this.state === 'menu') {
      this.menuSpin += dt;
      this.world.rig.yaw = this.world.rig.yawGoal = Math.PI / 4 + this.menuSpin * 0.03;
      g.advance(dt, SIM_BUDGET_MS);
    }
    this.updateGhost();
    this.world.render(dt);
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
  private updateGhost(): void {
    const tool = this.tool;
    const h = this.hover;
    if (this.state !== 'game' || !h) {
      this.ghost.visible = false;
      return;
    }
    if (tool.kind === 'build') {
      const def = BUILDING[tool.def];
      const pl = this.placement(def, h, tool.rot);
      const key = `${def.id}:${pl.rot}`;
      if (key !== this.ghostKey) {
        this.ghostKey = key;
        this.ghost.clear();
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
      // affordability / requirements
      let reason = pl.ok ? '' : pl.reason ?? '';
      const miss = this.game.missingReqs(def);
      const cost = this.game.costOf(def);
      if (!reason && miss.length) reason = miss[0] === 'unique' ? 'Only one allowed.' : `Requires a skilled ${miss.join(', ')}.`;
      if (!reason && cost.gold > 0 && this.game.treasury < cost.gold) reason = 'Not enough gold.';
      if (!reason && this.game.lumber() < cost.lumber) reason = 'Not enough lumber.';
      this.cursorTip.textContent = reason || `${def.name}  ·  ${cost.gold ? cost.gold + ' gold  ' : ''}${cost.lumber ? cost.lumber + ' lumber' : ''}`;
      this.cursorTip.classList.toggle('ok', !reason);
      this.cursorTip.classList.remove('hidden');
    } else if (tool.kind === 'road' || tool.kind === 'unroad' || tool.kind === 'demolish' || tool.kind === 'clear') {
      this.ghost.visible = false;
      this.roadPreview.clear();
      const pts: [number, number][] = [];
      if (tool.kind === 'road' && this.dragStart) {
        let { x, y } = this.dragStart;
        pts.push([x, y]);
        while (x !== h.x) (x += Math.sign(h.x - x)), pts.push([x, y]);
        while (y !== h.y) (y += Math.sign(h.y - y)), pts.push([x, y]);
      } else pts.push([h.x, h.y]);
      const col = tool.kind === 'road' ? 0xe0c070 : 0xff5040;
      const geo = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false });
      for (const [x, y] of pts) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x + 0.5, Math.max(0.05, this.game.map.heightAt(x + 0.5, y + 0.5)) + 0.06, y + 0.5);
        m.renderOrder = 3;
        this.roadPreview.add(m);
      }
      if (tool.kind === 'demolish') {
        const b = this.game.tileBuilding(h.x, h.y);
        this.cursorTip.textContent = b ? `Demolish ${BUILDING[b.def].name}` : 'Demolish';
        this.cursorTip.classList.remove('hidden', 'ok');
      } else this.cursorTip.classList.add('hidden');
    } else {
      this.ghost.visible = false;
      if (tool.kind === 'target') {
        this.cursorTip.textContent = `Click a ${tool.what} (right-click to cancel)`;
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
