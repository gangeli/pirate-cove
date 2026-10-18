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

  private buildBase(): void {
    const m = this.app.game.map, n = m.size;
    const c = (this.base ??= document.createElement('canvas'));
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const col: Record<number, [number, number, number]> = {
      [Terrain.DeepWater]: [18, 52, 86], [Terrain.Shallow]: [40, 130, 150], [Terrain.Beach]: [226, 210, 160], [Terrain.Grass]: [110, 160, 70],
      [Terrain.Jungle]: [48, 104, 44], [Terrain.Hill]: [140, 136, 96], [Terrain.Mountain]: [120, 112, 104],
    };
    for (let i = 0; i < n * n; i++) {
      let [r, gg, b] = col[m.terrain[i]];
      if (m.trees[i]) (r *= 0.75), (gg *= 0.8), (b *= 0.7);
      if (m.path[i]) (r = 170), (gg = 140), (b = 100);
      const sh = Math.max(0.7, Math.min(1.25, 1 + (m.height[i] - 2) * 0.03));
      img.data.set([r * sh, gg * sh, b * sh, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    for (const bl of this.app.game.buildings.values()) {
      const def = BUILDING[bl.def];
      g.fillStyle = bl.built < 1 ? '#c8a860' : def.cat === 'entertainment' ? '#d05a40' : def.house ? '#b07a50' : def.cat === 'defense' ? '#6a6a7a' : '#e8e0d0';
      g.fillRect(bl.x, bl.y, bl.w, bl.h);
    }
    this.baseAt = performance.now();
  }

  draw(): void {
    if (this.wrap.classList.contains('hidden')) return;
    this.t++;
    if (!this.base || performance.now() - this.baseAt > 3000) this.buildBase();
    if (this.t % 3) return;
    const app = this.app, g = app.game, n = g.map.size;
    const c = this.canvas, ctx = c.getContext('2d')!;
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
    // people
    for (const p of g.people.values()) {
      if (p.task.kind === 'atsea' || p.task.kind === 'dead') continue;
      ctx.fillStyle = p.kind === 'pirate' ? '#ff4030' : p.kind === 'soldier' ? '#ff00ff' : p.rebel ? '#ff8000' : '#f8f0e0';
      ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.2, 1.2);
    }
    for (const sh of g.ships.values()) {
      if (sh.status === 'atsea') continue;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(sh.vx, sh.vy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const v of g.invaders ?? []) {
      ctx.fillStyle = '#ff2020';
      ctx.beginPath();
      ctx.arc(v.x, v.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // camera view footprint
    const cam = app.world.rig.camera;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x, y), cam);
      const p = new THREE.Vector3();
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
      return hit ? [p.x, p.z] : [app.world.rig.target.x + x * 200, app.world.rig.target.z + y * 200];
    });
    ctx.strokeStyle = '#fff6d0';
    ctx.lineWidth = 1.2 / s * 2;
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
