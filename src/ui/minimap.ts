import * as THREE from 'three';
import type { App } from './app';
import { el, delegate, html, setHTML } from './dom';
import { icon } from './icons';
import { Terrain } from '../sim/map';
import { BUILDING } from '../sim/data/buildings';

export class Minimap {
  private wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  private baseAt = 0;
  private t = 0;

  constructor(private app: App, ui: HTMLElement) {
    this.wrap = el('div', 'minimap hidden', ui);
    this.canvas = el('canvas', '', this.wrap);
    this.canvas.width = this.canvas.height = 320;
    const btn = (act: string, ic: string, style: string, tip: string) => html`<div class="mm-btn" style="${style}" data-act="${act}" data-tip="${tip}">${icon(ic, 16)}</div>`;
    const b = el('div', '', this.wrap);
    setHTML(b, html`${btn('rot:-1', 'rotl', 'left:-6px;top:4px', 'Rotate left (Q)')}${btn('rot:1', 'rotr', 'right:-6px;top:4px', 'Rotate right (E)')}${btn('zoom:0.8', 'plus', 'right:-6px;bottom:4px', 'Zoom in')}${btn('zoom:1.25', 'minus', 'left:-6px;bottom:4px', 'Zoom out')}`);
    delegate(b, {
      rot: (d) => app.world.rig.rotateStep(+d),
      zoom: (f) => app.world.rig.zoom(+f),
    });
    const jump = (ev: PointerEvent) => {
      const p = this.toWorld(ev);
      if (p) app.world.rig.lookAt(p.x, p.y, ev.type === 'pointermove');
    };
    let down = false;
    this.canvas.addEventListener('pointerdown', (ev) => {
      down = true;
      jump(ev);
    });
    this.canvas.addEventListener('pointermove', (ev) => down && jump(ev));
    window.addEventListener('pointerup', () => (down = false));
  }

  show(on: boolean): void {
    this.wrap.classList.toggle('hidden', !on);
    this.base = null;
  }

  private toWorld(ev: PointerEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const u = (ev.clientX - r.left) / r.width - 0.5, v = (ev.clientY - r.top) / r.height - 0.5;
    const n = this.app.game.map.size;
    const yaw = this.app.world.rig.yaw;
    // inverse of the draw rotation
    const a = -(yaw - Math.PI);
    const x = u * Math.cos(-a) - v * Math.sin(-a), y = u * Math.sin(-a) + v * Math.cos(-a);
    return { x: (x + 0.5) * n, y: (y + 0.5) * n };
  }

  /** the base (terrain + buildings) is redrawn when the map changes, and at most every few seconds */
  private baseDirty = true;
  private lastDraw = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private corners: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  /** sim events that change what the base layer shows */
  onEvent(e: { type: string }): void {
    switch (e.type) {
      case 'terrain': case 'roads': case 'trees': case 'placed': case 'built': case 'removed':
        this.baseDirty = true;
    }
  }

  private buildBase(): void {
    const m = this.app.game.map, n = m.size;
    const c = (this.base ??= document.createElement('canvas'));
    if (c.width !== n) c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const px = img.data;
    for (let i = 0; i < n * n; i++) {
      const col = TERRAIN_RGB[m.terrain[i]];
      let r = col[0], gg = col[1], b = col[2];
      if (m.trees[i]) (r *= 0.75), (gg *= 0.8), (b *= 0.7);
      if (m.path[i]) (r = 170), (gg = 140), (b = 100);
      const sh = Math.max(0.7, Math.min(1.25, 1 + (m.height[i] - 2) * 0.03));
      const o = i * 4;
      px[o] = r * sh;
      px[o + 1] = gg * sh;
      px[o + 2] = b * sh;
      px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (const bl of this.app.game.buildings.values()) {
      const def = BUILDING[bl.def];
      g.fillStyle = bl.built < 1 ? '#c8a860' : def.cat === 'entertainment' ? '#d05a40' : def.house ? '#b07a50' : def.cat === 'defense' ? '#6a6a7a' : '#e8e0d0';
      g.fillRect(bl.x, bl.y, bl.w, bl.h);
    }
    this.baseAt = performance.now();
    this.baseDirty = false;
  }

  draw(): void {
    if (this.wrap.classList.contains('hidden')) return;
    const now = performance.now();
    // ~15 Hz (as before: every third frame at 45-60 fps), but time-based so slow frames don't redraw more often;
    // the base layer only when something was built or cleared
    if (now - this.lastDraw < 66) return;
    this.lastDraw = now;
    this.t++;
    if (!this.base || (this.baseDirty && now - this.baseAt > 500) || now - this.baseAt > 10000) this.buildBase();
    const app = this.app, g = app.game, n = g.map.size;
    const c = this.canvas, ctx = (this.ctx ??= c.getContext('2d')!);
    const W = c.width;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#123448';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-(app.world.rig.yaw - Math.PI));
    const s = W / n;
    ctx.scale(s, s);
    ctx.translate(-n / 2, -n / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base!, 0, 0);
    // people, one fill colour at a time
    for (const [kind, col] of DOT_COLORS) {
      ctx.fillStyle = col;
      for (const p of g.people.values()) {
        if (p.task.kind === 'atsea' || p.task.kind === 'dead') continue;
        const k = p.kind === 'pirate' ? 0 : p.kind === 'soldier' ? 1 : p.rebel ? 2 : 3;
        if (k === kind) ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
      }
    }
    ctx.fillStyle = '#1a1a1a';
    for (const sh of g.ships.values()) {
      if (sh.status === 'atsea') continue;
      ctx.beginPath();
      ctx.arc(sh.vx, sh.vy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff2020';
    for (const v of g.invaders ?? []) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // camera view footprint
    const cam = app.world.rig.camera;
    const cs = this.corners;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 3 ? -1 : 1, y = i < 2 ? -1 : 1;
      this.ray.setFromCamera(this.ndc.set(x, y), cam);
      const hit = this.ray.ray.intersectPlane(this.ground, this.hit);
      cs[i * 2] = hit ? hit.x : app.world.rig.target.x + x * 200;
      cs[i * 2 + 1] = hit ? hit.z : app.world.rig.target.z + y * 200;
    }
    ctx.strokeStyle = '#fff6d0';
    ctx.lineWidth = 1.2 / s * 2;
    ctx.beginPath();
    ctx.moveTo(cs[0], cs[1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(cs[i * 2], cs[i * 2 + 1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.DeepWater]: [18, 52, 86], [Terrain.Shallow]: [40, 130, 150], [Terrain.Beach]: [226, 210, 160], [Terrain.Grass]: [110, 160, 70],
  [Terrain.Jungle]: [48, 104, 44], [Terrain.Hill]: [140, 136, 96], [Terrain.Mountain]: [120, 112, 104],
};
const DOT_COLORS: [number, string][] = [[3, '#f8f0e0'], [2, '#ff8000'], [0, '#ff4030'], [1, '#ff00ff']];
