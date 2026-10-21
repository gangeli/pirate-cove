import type { App } from './app';
import { el, html, setHTML, patchHTML, delegate, fmt, raw } from './dom';
import { icon, nationFlag } from './icons';
import { NATIONS, NATION_NAMES, NATION_ADJ, type Nation } from '../sim/data/kings';
import { regionReachable, transitTime } from '../sim/sea';
import { relationLevel } from '../sim/diplomacy';
import { MONTH } from '../sim/time';
import type { Region, Ship } from '../sim/types';
import { audio } from '../audio/audio';

type Poly = [number, number][];
const LAND: Poly[] = [
  // North America & Florida
  [[0, 0], [0.36, 0], [0.4, 0.05], [0.39, 0.1], [0.36, 0.11], [0.33, 0.06], [0.28, 0.035], [0.2, 0.045], [0.12, 0.07], [0.05, 0.13], [0.03, 0.25], [0.05, 0.36], [0, 0.42]],
  // Mexico, Central & South America
  [[0, 0.45], [0.05, 0.4], [0.1, 0.43], [0.18, 0.42], [0.22, 0.37], [0.25, 0.38], [0.26, 0.44], [0.23, 0.5], [0.2, 0.56], [0.19, 0.63], [0.24, 0.66], [0.28, 0.66], [0.31, 0.73], [0.36, 0.86], [0.43, 0.83], [0.47, 0.87], [0.52, 0.81], [0.58, 0.76], [0.65, 0.71], [0.73, 0.74], [0.82, 0.71], [0.9, 0.68], [0.97, 0.7], [1, 0.73], [1, 1], [0, 1]],
  // Cuba
  [[0.26, 0.245], [0.31, 0.215], [0.38, 0.21], [0.45, 0.23], [0.51, 0.255], [0.56, 0.275], [0.555, 0.305], [0.5, 0.3], [0.44, 0.285], [0.38, 0.275], [0.31, 0.27]],
  // Hispaniola
  [[0.585, 0.285], [0.62, 0.265], [0.67, 0.27], [0.715, 0.29], [0.72, 0.325], [0.68, 0.335], [0.64, 0.33], [0.6, 0.32]],
  // Jamaica
  [[0.445, 0.365], [0.475, 0.355], [0.505, 0.365], [0.5, 0.38], [0.465, 0.382]],
  // Puerto Rico
  [[0.735, 0.31], [0.775, 0.305], [0.785, 0.32], [0.745, 0.33]],
];
const ISLETS: [number, number, number][] = [
  [0.46, 0.09, 0.012], [0.49, 0.13, 0.01], [0.53, 0.16, 0.012], [0.57, 0.19, 0.01], [0.5, 0.06, 0.009], [0.55, 0.11, 0.008],
  [0.83, 0.32, 0.008], [0.86, 0.36, 0.009], [0.88, 0.41, 0.01], [0.9, 0.46, 0.009], [0.9, 0.51, 0.01], [0.91, 0.56, 0.008], [0.92, 0.62, 0.012],
  [0.62, 0.64, 0.01], [0.66, 0.645, 0.008], [0.36, 0.33, 0.007], [0.4, 0.34, 0.006], [0.15, 0.36, 0.007],
];
/** the chart is drawn at this aspect (map x and y both run 0..1) */
const ASPECT = 4 / 3;
const PAPER_W = 1600;
const INK = '#3a1a08', BLOOD = '#8a1a10', REACH = '#2c6a36';
/** the title cartouche, on the southern mainland clear of the seas (centre, map units) */
const CARTOUCHE: [number, number] = [0.82, 0.905];
const LEVELS = ['Uncharted', 'Surveyed', 'Charted', 'Familiar seas', 'Like the back of our hand', 'Our own waters'];

type Mode = 'reach' | 'risk' | 'reward';
type Box = { x: number; y: number; w: number; h: number };

export class SeaChart {
  private panel: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private side!: HTMLElement;
  private bar!: HTMLElement;
  private legend!: HTMLElement;
  private bar2!: HTMLElement;
  private legend2!: HTMLElement;
  private tip!: HTMLElement;
  visible = false;
  private region = -1;
  private ship = 0;
  private mode: Mode = 'reach';
  private lastRefresh = 0;
  private paper: HTMLCanvasElement | null = null;
  private fog: CanvasPattern | null = null;
  private hatch: CanvasPattern | null = null;
  /** zoom (1 = whole chart fits) and the map point at the centre of the view */
  private view = { z: 1, cx: 0.5, cy: 0.5 };
  private geo = { cw: 1, ch: 1, mw: 1, mh: 1 };
  private hoverR = -1;
  private tipR = -1;
  private ptrs = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private pinch: { d: number; z: number } | null = null;
  private raf = 0;
  /** the Great Power whose details are unfolded in the side sheet */
  private power: Nation | null = null;

  constructor(private app: App) {
    this.panel = el('div', 'panel big chart hidden', app.root);
    setHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>
      <header class="sheet-head"><h2>Sea Chart of the Caribbee</h2><div class="sub">Choose a ship, then pick a sea to send her there.</div></header>
      <div class="chart-wrap">
        <div class="chart-main">
          <div class="chart-bar"></div>
          <div class="chart-map">
            <canvas aria-label="Sea chart"></canvas>
            <div class="chart-zoom"><button class="mm-btn" data-act="zoom:1" aria-label="Zoom in">${icon('plus', 14)}</button><button class="mm-btn" data-act="zoom:-1" aria-label="Zoom out">${icon('minus', 14)}</button></div>
            <div class="chart-tip hidden"></div>
          </div>
          <div class="chart-legend"></div>
        </div>
        <div class="chart-sidecol"><div class="chart-bar side-copy"></div><div class="chart-legend side-copy"></div><div class="chart-side scroll"></div></div>
      </div>`);
    this.canvas = this.panel.querySelector('canvas')!;
    this.side = this.panel.querySelector('.chart-side') as HTMLElement;
    this.bar = this.panel.querySelector('.chart-bar') as HTMLElement;
    this.legend = this.panel.querySelector('.chart-legend') as HTMLElement;
    // short landscape screens show the view switch and legend at the head of the side sheet instead (CSS picks one)
    this.bar2 = this.panel.querySelector('.chart-bar.side-copy') as HTMLElement;
    this.legend2 = this.panel.querySelector('.chart-legend.side-copy') as HTMLElement;
    this.tip = this.panel.querySelector('.chart-tip') as HTMLElement;
    delegate(this.panel, {
      close: () => this.hide(),
      ship: (id) => {
        this.ship = +id;
        const s = app.game.ships.get(this.ship);
        if (s) this.region = s.region;
        this.refresh(true);
      },
      mode: (m) => {
        this.mode = m as Mode;
        this.refresh(true);
      },
      zoom: (d) => {
        const { cw, ch } = this.geo;
        this.zoomAt(cw / 2, ch / 2, this.view.z * (+d > 0 ? 1.5 : 1 / 1.5));
      },
      region: (id) => this.pickRegion(+id),
      power: (n) => {
        this.power = this.power === n ? null : (n as Nation);
        this.drawSide(true);
      },
    }, () => audio.sfx('ui_click'));
    this.bindMap();
  }

  // ------------------------------------------------------------------------------------------------ pan, zoom, pick
  private bindMap(): void {
    const c = this.canvas;
    // pointer position in the canvas's own CSS pixels (the UI layer may be zoomed on big screens)
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      const k = c.clientWidth ? c.clientWidth / r.width : 1;
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 1) this.drag = { ...p, cx: this.view.cx, cy: this.view.cy, moved: false };
      else if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.view.z };
        if (this.drag) this.drag.moved = true;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (this.ptrs.has(e.pointerId)) {
        this.ptrs.set(e.pointerId, p);
        if (this.pinch && this.ptrs.size >= 2) {
          const [a, b] = [...this.ptrs.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (this.pinch.z * d) / Math.max(1, this.pinch.d));
          return;
        }
        const dr = this.drag;
        if (dr) {
          const dx = p.x - dr.x, dy = p.y - dr.y;
          if (Math.hypot(dx, dy) > 6) (dr.moved = true), this.learnt();
          if (dr.moved && this.view.z > 1.001) {
            this.view.cx = dr.cx - dx / (this.geo.mw * this.view.z);
            this.view.cy = dr.cy - dy / (this.geo.mh * this.view.z);
            this.schedule();
          }
        }
        return;
      }
      if (e.pointerType !== 'mouse') return;
      const h = this.hit(p.x, p.y);
      c.style.cursor = h >= 0 ? 'pointer' : this.view.z > 1 ? 'grab' : 'default';
      if (h !== this.hoverR) {
        this.hoverR = h;
        this.tipR = h;
        this.schedule();
      }
    });
    const up = (e: PointerEvent) => {
      const dr = this.drag;
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) this.pinch = null;
      if (this.ptrs.size === 0) {
        this.drag = null;
        if (dr && !dr.moved && e.type === 'pointerup') {
          const p = local(e);
          const h = this.hit(p.x, p.y);
          if (h >= 0) {
            this.tipR = h;
            this.pickRegion(h);
          }
        }
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.hoverR >= 0) {
        this.hoverR = this.tipR = -1;
        this.schedule();
      }
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, this.view.z * (e.deltaY < 0 ? 1.25 : 1 / 1.25));
    }, { passive: false });
  }

  /** the "scroll to zoom" hint shows until the player has panned or zoomed once (remembered per browser) */
  private used = (() => {
    try {
      return localStorage.getItem('bc.chartUsed') === '1';
    } catch {
      return false;
    }
  })();
  private learnt(): void {
    if (this.used) return;
    this.used = true;
    try {
      localStorage.setItem('bc.chartUsed', '1');
    } catch {
      /* not remembered */
    }
    this.drawBar();
  }

  private zoomAt(sx: number, sy: number, nz: number): void {
    this.learnt();
    const v = this.view, { cw, ch, mw, mh } = this.geo;
    nz = Math.max(1, Math.min(4, nz));
    const mx = v.cx + (sx - cw / 2) / (mw * v.z), my = v.cy + (sy - ch / 2) / (mh * v.z);
    v.z = nz;
    v.cx = mx - (sx - cw / 2) / (mw * nz);
    v.cy = my - (sy - ch / 2) / (mh * nz);
    this.schedule();
  }

  private clampView(): void {
    const v = this.view, { cw, ch, mw, mh } = this.geo;
    const hx = cw / (2 * mw * v.z), hy = ch / (2 * mh * v.z);
    v.cx = hx >= 0.5 ? 0.5 : Math.max(hx, Math.min(1 - hx, v.cx));
    v.cy = hy >= 0.5 ? 0.5 : Math.max(hy, Math.min(1 - hy, v.cy));
  }

  private sx(x: number): number {
    return this.geo.cw / 2 + (x - this.view.cx) * this.geo.mw * this.view.z;
  }
  private sy(y: number): number {
    return this.geo.ch / 2 + (y - this.view.cy) * this.geo.mh * this.view.z;
  }
  private radius(): number {
    return Math.max(12, Math.min(44, 0.04 * this.geo.mw * this.view.z));
  }

  /** the region under a point of the canvas (CSS px), or -1 */
  private hit(px: number, py: number): number {
    let best = -1, bd = Math.max(22, this.radius() * 1.15);
    for (const r of this.app.game.regions) {
      const d = Math.hypot(this.sx(r.x) - px, this.sy(r.y) - py);
      if (d < bd) (bd = d), (best = r.id);
    }
    return best;
  }

  private pickRegion(id: number): void {
    const app = this.app;
    this.region = id;
    audio.sfx('quill');
    const s = this.ship ? app.game.ships.get(this.ship) : undefined;
    if (s && (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing') && s.region !== id) {
      const reach = regionReachable(app.game, s, id);
      if (reach.ok) app.cmd({ type: 'shipOrders', ship: s.id, region: id });
    }
    this.refresh(true);
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.visible) this.draw();
    });
  }

  // ------------------------------------------------------------------------------------------------ show / hide
  open(shipId = 0): void {
    this.show();
    if (shipId) {
      this.ship = shipId;
      const s = this.app.game.ships.get(shipId);
      if (s) this.region = s.region;
      this.refresh(true);
    }
  }
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
  show(): void {
    this.app.closeAll();
    this.visible = true;
    this.panel.classList.remove('hidden');
    const ships = [...this.app.game.ships.values()];
    if (!this.ship || !this.app.game.ships.has(this.ship)) this.ship = (ships.find((s) => s.status === 'docked') ?? ships[0])?.id ?? 0;
    if (this.region < 0) this.region = this.app.game.homeRegion;
    this.view = { z: 1, cx: 0.5, cy: 0.5 };
    this.refresh(true);
    this.app.hud.updateTool();
    audio.sfx('parchment');
  }
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.add('hidden');
    this.app.hud.updateTool();
  }

  risk(r: Region): number {
    return Math.round(Math.min(5, NATIONS.reduce((a, n) => a + r.naval[n], 0) * (1 + r.heat * 0.3) * 2.2 + r.pirates * 2));
  }
  reward(r: Region): number {
    return Math.round(Math.min(5, NATIONS.reduce((a, n) => a + (this.app.game.ongoing.has(`prohibit_${n}`) ? 0 : r.merchant[n]), 0) * 1.5 + (r.tradeRoute ? 1 : 0)));
  }

  refresh(force = false): void {
    if (!this.visible) return;
    if (!force && performance.now() - this.lastRefresh < 1000) return;
    this.lastRefresh = performance.now();
    this.drawBar();
    this.draw();
    this.drawSide(force);
  }

  private selShip(): Ship | undefined {
    return this.ship ? this.app.game.ships.get(this.ship) : undefined;
  }

  // ------------------------------------------------------------------------------------------------ paper
  private makePaper(): HTMLCanvasElement {
    const W = PAPER_W, H = Math.round(PAPER_W / ASPECT);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // sea wash
    const sea = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    sea.addColorStop(0, '#dde6cf');
    sea.addColorStop(1, '#b9c7ad');
    g.fillStyle = sea;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 16000; i++) {
      g.fillStyle = `rgba(${90 + rnd() * 40},${70 + rnd() * 30},40,${rnd() * 0.05})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 4, 1.5);
    }
    // rhumb lines from two compass points
    g.strokeStyle = 'rgba(120,80,40,0.16)';
    g.lineWidth = 1.2;
    for (const [cx, cy] of [[0.68 * W, 0.47 * H], [0.18 * W, 0.2 * H]]) for (let a = 0; a < 32; a++) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos((a / 32) * Math.PI * 2) * W * 1.5, cy + Math.sin((a / 32) * Math.PI * 2) * W * 1.5);
      g.stroke();
    }
    const drawPoly = (p: Poly) => {
      g.beginPath();
      p.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H)));
      g.closePath();
    };
    for (const p of LAND) {
      for (let k = 5; k >= 1; k--) {
        drawPoly(p);
        g.strokeStyle = `rgba(80,105,95,${0.07 * k})`;
        g.lineWidth = k * 6;
        g.stroke();
      }
      drawPoly(p);
      const lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, '#e6d4a4');
      lg.addColorStop(1, '#cfb57e');
      g.fillStyle = lg;
      g.fill();
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 2.4;
      g.stroke();
    }
    for (const [x, y, r] of ISLETS) {
      g.beginPath();
      g.ellipse(x * W, y * H, r * W, r * W * 0.7, 0.5, 0, Math.PI * 2);
      g.fillStyle = '#d8c48e';
      g.fill();
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 1.8;
      g.stroke();
    }
    // hill marks on the southern mainland, kept clear of the title cartouche
    g.strokeStyle = 'rgba(90,60,30,0.5)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = H * (0.82 + rnd() * 0.17);
      if (Math.abs(x / W - CARTOUCHE[0]) < 0.15 && y > H * 0.85) continue;
      g.beginPath();
      g.moveTo(x - 9, y);
      g.lineTo(x, y - 10);
      g.lineTo(x + 9, y);
      g.stroke();
    }
    // compass rose
    const cx = 0.88 * W, cy = 0.15 * H, R = H * 0.085;
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = 'rgba(90,50,20,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, R * 0.62, 0, Math.PI * 2);
    g.stroke();
    for (let a = 0; a < 8; a++) {
      g.rotate(Math.PI / 4);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(R * (a % 2 ? 0.55 : 1), 0);
      g.lineTo(R * 0.12, R * 0.12);
      g.closePath();
      g.fillStyle = a % 2 ? '#8a6a3a' : '#5a2a10';
      g.fill();
    }
    g.fillStyle = '#5a2a10';
    g.font = `${R * 0.42}px "IM Fell English SC", Georgia`;
    g.textAlign = 'center';
    g.fillText('N', 0, -R - 6);
    g.restore();
    // title cartouche on the southern mainland
    const tx = CARTOUCHE[0] * W, ty = CARTOUCHE[1] * H;
    g.fillStyle = 'rgba(240,228,196,0.85)';
    g.strokeStyle = '#5a3a1a';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(tx - W * 0.13, ty - H * 0.04, W * 0.26, H * 0.07, 8);
    g.fill();
    g.stroke();
    g.beginPath();
    g.roundRect(tx - W * 0.13 + 4, ty - H * 0.04 + 4, W * 0.26 - 8, H * 0.07 - 8, 5);
    g.lineWidth = 1;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#4a2a10';
    g.font = `${Math.round(H * 0.03)}px "IM Fell English SC", Georgia`;
    g.fillText('Mare Caribbeum', tx, ty + 1);
    g.font = `italic ${Math.round(H * 0.018)}px "IM Fell English", Georgia`;
    g.fillText('Here be Pyrates', tx, ty + H * 0.022);
    return c;
  }

  private patterns(g: CanvasRenderingContext2D): void {
    if (this.fog && this.hatch) return;
    const mk = (col: string, bg: string | null, step: number) => {
      const p = document.createElement('canvas');
      p.width = p.height = step;
      const x = p.getContext('2d')!;
      if (bg) {
        x.fillStyle = bg;
        x.fillRect(0, 0, step, step);
      }
      x.strokeStyle = col;
      x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(-1, step + 1);
      x.lineTo(step + 1, -1);
      x.moveTo(-1, 1);
      x.lineTo(1, -1);
      x.moveTo(step - 1, step + 1);
      x.lineTo(step + 1, step - 1);
      x.stroke();
      return g.createPattern(p, 'repeat');
    };
    // uncharted: a soft stipple of fog; out of reach: inked diagonal hatching
    const dots = document.createElement('canvas');
    dots.width = dots.height = 6;
    const d = dots.getContext('2d')!;
    d.fillStyle = 'rgba(160,150,125,0.5)';
    d.fillRect(0, 0, 6, 6);
    d.fillStyle = 'rgba(80,65,45,0.55)';
    d.fillRect(1, 1, 1.4, 1.4);
    d.fillRect(4, 4, 1.4, 1.4);
    this.fog = g.createPattern(dots, 'repeat');
    this.hatch = mk('rgba(70,35,15,0.55)', 'rgba(70,40,20,0.12)', 7);
  }

  // ------------------------------------------------------------------------------------------------ the map
  private draw(): void {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const cw = Math.max(200, c.clientWidth), ch = Math.max(150, c.clientHeight);
    // device pixels per CSS pixel of the canvas, including any zoom on the UI layer
    const dpr = Math.min(3, (devicePixelRatio || 1) * (c.clientWidth ? rect.width / c.clientWidth : 1));
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    // cover the frame when that crops only a sliver of open sea; otherwise fit the whole chart
    const cover = Math.max(cw, ch * ASPECT), contain = Math.min(cw, ch * ASPECT);
    const mw = cover / contain < 1.18 ? cover : contain;
    this.geo = { cw, ch, mw, mh: mw / ASPECT };
    this.clampView();
    this.paper ??= this.makePaper();
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.patterns(g);
    g.fillStyle = '#b4c2a8';
    g.fillRect(0, 0, cw, ch);
    const z = this.view.z, { mh } = this.geo;
    g.drawImage(this.paper, this.sx(0), this.sy(0), mw * z, mh * z);
    // neat line
    g.strokeStyle = 'rgba(60,30,10,0.7)';
    g.lineWidth = 1;
    g.strokeRect(this.sx(0) + 3.5, this.sy(0) + 3.5, mw * z - 7, mh * z - 7);

    const game = this.app.game;
    const sel = this.selShip();
    const R = this.radius();
    const small = cw < 520;
    const home = game.regions[game.homeRegion];
    const info = game.regions.map((r) => ({
      r, x: this.sx(r.x), y: this.sy(r.y), known: r.knowledge > 0, home: r.id === game.homeRegion,
      reach: sel ? regionReachable(game, sel, r.id) : null,
      months: sel ? transitTime(game, sel, r.id) / MONTH : 0,
    }));
    // a dashed course from home to the selected ship's destination
    if (sel && sel.region !== game.homeRegion) {
      const d = info[sel.region];
      g.save();
      g.strokeStyle = 'rgba(138,26,16,0.75)';
      g.lineWidth = 2;
      g.setLineDash([7, 5]);
      g.beginPath();
      g.moveTo(this.sx(home.x), this.sy(home.y));
      g.lineTo(d.x, d.y);
      g.stroke();
      g.restore();
    }
    for (const o of info) {
      const { r, x, y, known } = o;
      // danger / plunder wash
      if (this.mode !== 'reach' && known) {
        const v = this.mode === 'risk' ? this.risk(r) : this.reward(r);
        const gr = g.createRadialGradient(x, y, R * 0.2, x, y, R * 1.35);
        const col = this.mode === 'risk' ? '170,30,20' : '30,130,50';
        gr.addColorStop(0, `rgba(${col},${0.12 + v * 0.11})`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, R * 1.35, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.arc(x, y, R, 0, Math.PI * 2);
      if (!known && !o.home) {
        g.fillStyle = this.fog!;
        g.fill();
      } else {
        g.fillStyle = 'rgba(250,244,224,0.32)';
        g.fill();
      }
      const out = sel && o.reach && !o.reach.ok;
      if (out && known) {
        g.fillStyle = this.hatch!;
        g.fill();
      }
      // ring: within reach (solid green), charted (inked dashes), unknown (faint)
      g.lineWidth = 1.5;
      if (sel && o.reach?.ok && this.mode === 'reach') {
        g.strokeStyle = REACH;
        g.lineWidth = 2.5;
      } else g.strokeStyle = known ? 'rgba(70,40,15,0.7)' : 'rgba(70,40,15,0.35)';
      if (!(sel && o.reach?.ok && this.mode === 'reach')) g.setLineDash([4, 4]);
      g.stroke();
      g.setLineDash([]);
      // destination, inspected and hovered regions
      if (sel && sel.region === r.id && !o.home) this.ring(g, x, y, R + 4, BLOOD, 2.5);
      if (r.id === this.region) this.ring(g, x, y, R + (sel && sel.region === r.id ? 9 : 4), '#b8955a', 2);
      if (r.id === this.hoverR) this.ring(g, x, y, R + 1, 'rgba(60,30,10,0.9)', 1.5);
      // known settlements: tiny coloured flags at the rim
      let k = 0;
      for (const st of r.settlements) if (st.found) {
        g.fillStyle = st.type === 'military' ? BLOOD : st.type === 'trade' ? '#8a6a10' : '#3a6a2a';
        const a = -0.6 + k++ * 0.45;
        g.fillRect(x + Math.cos(a) * R - 3, y + Math.sin(a) * R - 3, 6, 6);
      }
    }
    // home: a wax-seal roundel with the jolly roger
    {
      const x = this.sx(home.x), y = this.sy(home.y), s = Math.max(12, R * 0.62);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 4;
      g.shadowOffsetY = 1;
      const gr = g.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
      gr.addColorStop(0, '#b0372a');
      gr.addColorStop(0.6, '#7a1810');
      gr.addColorStop(1, '#4a0a06');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = '#e2c88e';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, s - 2.5, 0, Math.PI * 2);
      g.stroke();
      this.skull(g, x, y, s * 0.62);
    }
    // ships: at their station, or moored at home
    let k = 0;
    for (const s of game.ships.values()) {
      const r = game.regions[s.status === 'atsea' || s.status === 'returning' || s.status === 'departing' ? s.region : game.homeRegion];
      const x = this.sx(r.x) + R * 0.7 + (k % 3) * 11, y = this.sy(r.y) + R * 0.55 + Math.floor(k / 3) * 11;
      k++;
      this.shipGlyph(g, x, y, s.id === this.ship ? BLOOD : '#2a1a0a');
    }
    this.drawLabels(g, info, R, small, sel);
    this.drawTip(info);
  }

  private ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, w: number): void {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
  }

  private skull(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    g.save();
    g.translate(x, y);
    g.strokeStyle = '#f2e2bc';
    g.fillStyle = '#f2e2bc';
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.4, s * 0.16);
    g.beginPath();
    g.moveTo(-s * 0.85, s * 0.85);
    g.lineTo(s * 0.85, -s * 0.05);
    g.moveTo(s * 0.85, s * 0.85);
    g.lineTo(-s * 0.85, -s * 0.05);
    g.stroke();
    g.beginPath();
    g.arc(0, -s * 0.25, s * 0.52, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-s * 0.28, -s * 0.05, s * 0.56, s * 0.42);
    g.fillStyle = '#6a120c';
    g.beginPath();
    g.arc(-s * 0.2, -s * 0.28, s * 0.14, 0, Math.PI * 2);
    g.arc(s * 0.2, -s * 0.28, s * 0.14, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private shipGlyph(g: CanvasRenderingContext2D, x: number, y: number, col: string): void {
    g.fillStyle = col;
    g.strokeStyle = 'rgba(240,228,196,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 7, y);
    g.lineTo(x + 7, y);
    g.lineTo(x + 4, y + 5);
    g.lineTo(x - 4, y + 5);
    g.closePath();
    g.stroke();
    g.fill();
    g.fillRect(x - 0.5, y - 10, 1.5, 10);
    g.beginPath();
    g.moveTo(x + 1, y - 10);
    g.lineTo(x + 7, y - 3);
    g.lineTo(x + 1, y - 2);
    g.fill();
  }

  /** region names (and a second line: months of sailing, or danger/plunder pips), placed so they never overlap */
  private drawLabels(g: CanvasRenderingContext2D, info: { r: Region; x: number; y: number; known: boolean; home: boolean; reach: { ok: boolean } | null; months: number }[], R: number, small: boolean, sel?: Ship): void {
    const f1 = small ? 11.5 : 13.5, f2 = small ? 10.5 : 12;
    // the title cartouche is an obstacle too
    const placed: Box[] = [{ x: this.sx(CARTOUCHE[0] - 0.13), y: this.sy(CARTOUCHE[1] - 0.04), w: 0.26 * this.geo.mw * this.view.z, h: 0.07 * this.geo.mh * this.view.z }];
    const discs = info.map((o) => ({ x: o.x - R, y: o.y - R, w: R * 2, h: R * 2 }));
    const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    // the labels that matter are placed first, so the minor ones are the ones that give way
    const rank = (o: (typeof info)[number]) => (o.home ? 0 : o.r.id === this.region ? 1 : sel && sel.region === o.r.id ? 2 : o.reach?.ok ? 3 : o.known ? 4 : 5);
    const order = [...info].sort((a, b) => rank(a) - rank(b) || a.y - b.y);
    for (const o of order) {
      const name = o.home ? 'Your Cove' : o.r.name;
      let line2 = '';
      if (o.home) line2 = o.r.name;
      else if (this.mode === 'reach' && sel && o.reach?.ok) line2 = `${o.months.toFixed(1)} mo`;
      else if (this.mode !== 'reach' && o.known) {
        const v = this.mode === 'risk' ? this.risk(o.r) : this.reward(o.r);
        line2 = (this.mode === 'risk' ? '●' : '◆').repeat(v) + (this.mode === 'risk' ? '○' : '◇').repeat(5 - v);
      }
      g.font = `${o.home ? '' : o.known ? '' : 'italic '}${o.home ? f1 + 2 : f1}px ${o.home ? '"IM Fell English SC"' : '"IM Fell English"'}, Georgia`;
      const w1 = g.measureText(name).width;
      g.font = `${f2}px "IM Fell English", Georgia`;
      const w2 = line2 ? g.measureText(line2).width : 0;
      const w = Math.max(w1, w2) + 6, h = (line2 ? f1 + f2 + 2 : f1) + 4;
      const off = (o.home ? Math.max(12, R * 0.62) : R) + 3;
      const cands: Box[] = [
        { x: o.x - w / 2, y: o.y - off - h, w, h },
        { x: o.x - w / 2, y: o.y + off, w, h },
        { x: o.x + off, y: o.y - h / 2, w, h },
        { x: o.x - off - w, y: o.y - h / 2, w, h },
        { x: o.x - w / 2 + R, y: o.y - off - h, w, h },
        { x: o.x - w / 2 - R, y: o.y - off - h, w, h },
        { x: o.x - w / 2 + R, y: o.y + off, w, h },
        { x: o.x - w / 2 - R, y: o.y + off, w, h },
      ];
      let best = cands[0], bs = Infinity, bestLov = 0;
      cands.forEach((b, i) => {
        let s = i * 0.5, lov = 0;
        for (const p of placed) lov += inter(b, p);
        s += lov * 10;
        discs.forEach((d, j) => (s += info[j] === o ? 0 : inter(b, d)));
        if (b.x < 2 || b.x + b.w > this.geo.cw - 2 || b.y < 2 || b.y + b.h > this.geo.ch - 2) s += 400;
        if (s < bs) (bs = s), (best = b), (bestLov = lov);
      });
      // no clean spot: minor names give way (they show on hover/tap); home, the inspected sea, the course and seas
      // within reach always get their label
      const important = o.home || o.r.id === this.region || (sel && (sel.region === o.r.id || o.reach?.ok));
      const clipped = best.x < 2 || best.x + best.w > this.geo.cw - 2 || best.y < 2 || best.y + best.h > this.geo.ch - 2;
      if ((bestLov > 4 || clipped) && !important) continue;
      placed.push(best);
      const cx = best.x + best.w / 2;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.lineJoin = 'round';
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(236,226,196,0.9)';
      g.font = `${o.home ? '' : o.known ? '' : 'italic '}${o.home ? f1 + 2 : f1}px ${o.home ? '"IM Fell English SC"' : '"IM Fell English"'}, Georgia`;
      g.fillStyle = o.home ? BLOOD : o.known ? INK : 'rgba(70,50,30,0.75)';
      if (o.r.id === this.region && !o.home) g.font = `bold ${g.font}`;
      g.strokeText(name, cx, best.y + 2);
      g.fillText(name, cx, best.y + 2);
      if (line2) {
        g.font = `${o.home ? 'italic ' : ''}${f2}px "IM Fell English", Georgia`;
        g.fillStyle = o.home ? '#5a3a1a' : this.mode === 'reach' ? REACH : this.mode === 'risk' ? BLOOD : '#7a5a10';
        g.strokeText(line2, cx, best.y + 4 + f1);
        g.fillText(line2, cx, best.y + 4 + f1);
      }
      g.textBaseline = 'alphabetic';
    }
  }

  private drawTip(info: { r: Region; x: number; y: number; known: boolean; home: boolean; reach: { ok: boolean; reason?: string } | null; months: number }[]): void {
    const o = info[this.tipR];
    if (!o) {
      this.tip.classList.add('hidden');
      return;
    }
    const sel = this.selShip();
    const lines = [`<b>${o.home ? 'Your Cove · ' : ''}${o.r.name}</b>`, `<i>${LEVELS[Math.min(5, Math.floor(o.r.knowledge))]}</i>`];
    if (sel && o.reach) lines.push(o.reach.ok ? `${sel.name}: ${o.months.toFixed(1)} months each way` : `<span class="bad">${o.reach.reason}</span>`);
    this.tip.innerHTML = lines.join('<br>');
    this.tip.classList.remove('hidden');
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    const R = this.radius();
    let x = o.x - tw / 2, y = o.y + R + 10;
    if (y + th > this.geo.ch - 4) y = o.y - R - 10 - th;
    x = Math.max(4, Math.min(this.geo.cw - tw - 4, x));
    this.tip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  // ------------------------------------------------------------------------------------------------ controls & side
  private drawBar(): void {
    const sel = this.selShip();
    const modes: [Mode, string, string][] = [['reach', 'Reach', 'compass'], ['risk', 'Danger', 'skull'], ['reward', 'Plunder', 'chest']];
    const bar = html`<div class="seg" role="radiogroup" aria-label="Chart view">${modes.map(([m, n, ic]) => html`<button class="${this.mode === m ? 'on' : ''}" data-act="mode:${m}" role="radio" aria-checked="${this.mode === m ? 'true' : 'false'}">${icon(ic, 15)}${n}</button>`)}</div>
      ${this.used ? '' : html`<span class="how">${this.app.touchMode ? 'Pinch to zoom, drag to pan' : 'Scroll to zoom, drag to pan'}</span>`}`;
    patchHTML(this.bar, bar);
    patchHTML(this.bar2, bar);
    const sw = (inner: string) => raw(`<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">${inner}</svg>`);
    const items = [html`<span>${sw('<circle cx="9" cy="9" r="7" fill="#7a1810" stroke="#e2c88e" stroke-width="1.2"/><circle cx="9" cy="8" r="2.6" fill="#f2e2bc"/>')} Your Cove</span>`];
    if (this.mode === 'reach') {
      if (sel) items.push(html`<span>${sw(`<circle cx="9" cy="9" r="6.5" fill="rgba(250,244,224,.5)" stroke="${REACH}" stroke-width="2.2"/>`)} ${sel.name} can reach</span>`,
        html`<span>${sw('<circle cx="9" cy="9" r="6.5" fill="url(#lgH)" stroke="rgba(70,40,15,.7)" stroke-dasharray="3 3"/><defs><pattern id="lgH" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M-1 5 5 -1" stroke="rgba(70,35,15,.7)"/></pattern></defs>')} Out of reach</span>`);
      items.push(html`<span>${sw('<circle cx="9" cy="9" r="6.5" fill="url(#lgF)" stroke="rgba(70,40,15,.4)" stroke-dasharray="3 3"/><defs><pattern id="lgF" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="rgba(160,150,125,.55)"/><rect x=".6" y=".6" width=".9" height=".9" fill="rgba(80,65,45,.7)"/></pattern></defs>')} Uncharted</span>`);
    } else items.push(html`<span class="scale ${this.mode}"><i></i> ${this.mode === 'risk' ? 'Safer → deadlier' : 'Lean → rich pickings'}</span>`);
    patchHTML(this.legend, html`${items}`);
    patchHTML(this.legend2, html`${items}`);
  }

  private drawSide(force: boolean): void {
    if (!force && this.side.matches(':hover')) return;
    const game = this.app.game;
    const r = game.regions[this.region] ?? game.regions[game.homeRegion];
    const known = r.knowledge > 0;
    const isHome = r.id === game.homeRegion;
    const ships = [...game.ships.values()];
    const sel = this.selShip();
    const statusName = (s: Ship) => ({ docked: 'In port', boarding: 'Boarding', departing: 'Setting sail', atsea: 'At sea', returning: 'Homeward', repairing: 'Repairing', building: 'Being built', lost: 'Lost' } as Record<string, string>)[s.status] ?? s.status;
    const reach = sel ? regionReachable(game, sel, r.id) : null;
    const bound = !!sel && sel.region === r.id;
    // a five-step meter as icons: lit glyphs for the value, faint ones for the rest
    const meter = (ic: string, v: number, cls: string, tip: string) => html`<span class="sea-meter ${cls}" data-tip="${tip}" role="img" aria-label="${tip.replace(/<[^>]+>/g, '')}">${icon(ic, 16)}<span class="pips">${Array.from({ length: 5 }, (_, i) => html`<i class="${i < v ? 'on' : ''}"></i>`)}</span></span>`;
    const risk = known ? this.risk(r) : 0, reward = known ? this.reward(r) : 0;
    const months = sel && reach?.ok ? (transitTime(game, sel, r.id) / MONTH).toFixed(1) : '';
    const level = LEVELS[Math.min(5, Math.floor(r.knowledge))];
    const found = r.settlements.filter((x) => x.found);
    patchHTML(this.side, html`
      <section class="sect sea-card">
        <div class="titled"><h3>${r.name}</h3>${isHome ? html`<span class="home-mark" data-tip="Home waters: your island lies here" aria-label="Home waters">${icon('anchor', 14)}</span>` : ''}${known ? '' : html`<span class="chip">Uncharted</span>`}</div>
        <div class="sea-stats">
          ${known ? html`${meter('skull', risk, 'risk', `<b>Danger ${risk} of 5</b><br>Navies and rival pirates in these waters.`)}${meter('chest', reward, 'reward', `<b>Plunder ${reward} of 5</b><br>Merchant traffic${r.tradeRoute ? ' and a trade route' : ''}.`)}` : ''}
          ${sel && reach ? (reach.ok ? html`<span class="badge" data-tip="${sel.name}: ${months} months' sail each way">${icon('compass', 13)} ${months} mo</span>` : html`<span class="chip bad" data-tip="${reach.reason ?? ''}">${icon('info', 12)} Out of reach</span>`) : ''}
          ${sel && bound ? html`<span class="chip ok bound" data-tip="${sel.name}'s orders take her here">${icon('flag', 12)} ${sel.name} bound here</span>` : ''}
        </div>
        ${sel && reach && !reach.ok ? html`<div class="sea-why">${reach.reason}</div>` : ''}
        ${known ? html`<div class="sea-nations">${NATIONS.map((n) => {
          const m = r.merchant[n], v = r.naval[n];
          const ml = m > 0.6 ? 3 : m > 0.3 ? 2 : m > 0.05 ? 1 : 0, vl = v > 0.5 ? 3 : v > 0.2 ? 2 : v > 0.05 ? 1 : 0;
          const words = `<b>${NATION_ADJ[n]}</b><br>${['No', 'Few', 'Some', 'Busy'][ml]} merchants · ${['no', 'little', 'some', 'strong'][vl]} navy`;
          return html`<span class="nat-pres" data-tip="${words}">${flag(n, 18)}<span class="mini">${icon('coin', 12)}${'▮'.repeat(ml)}<i>${'▮'.repeat(3 - ml)}</i></span><span class="mini navy">${icon('g_cannon', 12)}${'▮'.repeat(vl)}<i>${'▮'.repeat(3 - vl)}</i></span></span>`;
        })}</div>
        <div class="sea-facts">
          <span class="stat" data-tip="<b>${level}</b><br>How well your captains know these waters">${icon('telescope', 14)} ${level}</span>
          <span class="stat" data-tip="${found.length ? found.map((x) => `${x.name} (${NATION_ADJ[x.nat]} ${x.type})`).join('<br>') : 'No settlements known'}">${icon('flag', 14)} ${found.length}</span>
          ${r.routeFound ? html`<span class="stat" data-tip="A trade route runs through here">${icon('ship', 14)} Route</span>` : ''}
        </div>` : html`<div class="sea-why">Explore the neighbouring seas to chart these waters.</div>`}
      </section>
      <section class="sect">
        <h4 class="eng">Your fleet</h4>
        ${ships.length ? html`<div class="pick-list">${ships.map((s) => html`<button class="pick ${s.id === this.ship ? 'on' : ''}" data-act="ship:${s.id}">
          ${icon('ship', 18)}<span class="nm">${s.name}<small>${game.regions[s.region]?.name ?? ''}</small></span><span class="chip ${s.status === 'docked' ? 'ok' : ''}">${statusName(s)}</span></button>`)}</div>`
          : html`<div class="sub">You have no ships yet. Build a Boatyard and a Dock.</div>`}
      </section>
      <section class="sect">
        <h4 class="eng">Great Powers</h4>
        <div class="powers">${NATIONS.map((n) => {
          const st = game.nations[n];
          const lv = relationLevel(st.relation);
          const open = this.power === n;
          return html`<button class="power-chip ${STANCE[lv] ?? ''} ${open ? 'on' : ''}" data-act="power:${n}" aria-expanded="${open ? 'true' : 'false'}" data-tip="<b>${NATION_NAMES[n]}</b>: ${lv}">${flag(n, 20)}<span>${lv}</span>${st.invasion.stage ? html`<b class="warn" aria-label="Invasion">!</b>` : ''}</button>`;
        })}</div>
        ${this.power ? (() => {
          const n = this.power, st = game.nations[n];
          return html`<div class="power-detail"><b>${NATION_NAMES[n]}</b>
            <span class="stat" data-tip="${st.knows ? 'They know where your island is' : 'Your island is a secret to them'}">${icon(st.knows ? 'eye' : 'shield', 14)} ${st.knows ? 'Knows' : 'Secret'}</span>
            <span class="stat" data-tip="Gold you have plundered from ${NATION_NAMES[n]}">${icon('coin', 14)} ${fmt(st.plunderGold)}</span>
            ${st.atWarWith.length ? html`<span class="stat bad" data-tip="At war with ${st.atWarWith.map((x) => NATION_NAMES[x]).join(', ')}">${icon('g_cannon', 14)} ${st.atWarWith.map((x) => html`${flag(x, 14)}`)}</span>` : ''}
            ${st.invasion.stage ? html`<span class="chip bad">Invasion ${['', 'rumoured', 'assembling', 'underway'][st.invasion.stage]}</span>` : ''}</div>`;
        })() : ''}
      </section>`);
  }
}

const STANCE: Record<string, string> = { Hostile: 'bad', Cold: 'warn', Neutral: '', Cordial: 'ok', Harmonious: 'ok' };

const flag = nationFlag;
