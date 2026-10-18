import type { App } from './app';
import { el, html, setHTML, delegate } from './dom';
import { icon } from './icons';
import { cropFertility } from '../sim/economy';
import { CLUSTER } from '../sim/aura';
import type { Good } from '../sim/data/goods';
import { audio } from '../audio/audio';

type Kind = 'none' | 'order' | 'fear' | 'defense' | 'awe' | 'corn' | 'banana' | 'papaya' | 'sugarcane' | 'tobacco' | 'ore' | 'happiness';
const LIST: [Kind, string, string][] = [
  ['order', 'Order & Anarchy', 'Blue is orderly (captives like it), red is anarchic (pirates like it).'],
  ['fear', 'Fear', 'Fear keeps captives in line.'],
  ['defense', 'Defense', 'Pirates feel safe in well-defended areas.'],
  ['awe', 'Awe', 'Impressive buildings resign captives to their fate.'],
  ['corn', 'Corn fertility', ''], ['banana', 'Banana fertility', ''], ['papaya', 'Papaya fertility', ''], ['sugarcane', 'Sugarcane fertility', ''], ['tobacco', 'Tobacco fertility', ''],
  ['ore', 'Iron deposits', 'Mines must be built next to dark red patches.'],
];

export class Overlays {
  private panel: HTMLElement;
  visible = false;
  kind: Kind = 'none';
  private t = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel legend hidden', app.root);
    delegate(this.panel, {
      pick: (k) => this.set(k as Kind),
      close: () => this.hide(),
    }, () => audio.sfx('ui_click'));
  }
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
  show(): void {
    this.app.closeAll();
    this.visible = true;
    this.panel.classList.remove('hidden');
    if (this.kind === 'none') this.set('order');
    this.render();
    this.app.hud.updateTool();
  }
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.add('hidden');
    this.set('none');
    this.app.hud.updateTool();
  }
  set(k: Kind): void {
    this.kind = k;
    this.t = 99;
    if (k === 'none') this.app.world.setOverlay(null);
    this.render();
  }
  private render(): void {
    setHTML(this.panel, html`<button class="close" data-act="close">${icon('close', 14)}</button><h3 style="margin-top:0">Overlays</h3>
      ${LIST.map(([k, n, d]) => html`<div class="row" style="cursor:pointer;padding:2px 4px;border-radius:4px;${this.kind === k ? 'background:rgba(200,160,72,0.4)' : ''}" data-act="pick:${k}" data-tip="${d}">${n}</div>`)}
      <div class="grad" style="background:${this.kind === 'order' ? 'linear-gradient(90deg,#d02a1a,#888,#2a6ad0)' : 'linear-gradient(90deg,#333,#e8c040)'}"></div>
      <div class="row" style="justify-content:space-between;font-size:12px"><span>${this.kind === 'order' ? 'Anarchy' : 'Low'}</span><span>${this.kind === 'order' ? 'Order' : 'High'}</span></div>`);
  }

  update(): void {
    if (!this.visible || this.kind === 'none') return;
    this.t += 1 / 60;
    if (this.t < 1) return;
    this.t = 0;
    const g = this.app.game;
    const m = g.map, n = m.size;
    const data = new Uint8Array(n * n * 4);
    const a = g.aura;
    const k = this.kind;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        if (!m.isLand(x, y)) continue;
        let r = 0, gg = 0, b = 0, al = 230;
        if (k === 'order') {
          const v = a.order[Math.floor(y / CLUSTER) * a.cw + Math.floor(x / CLUSTER)] / 100;
          const t = Math.max(-1, Math.min(1, v));
          if (t > 0) (r = 136 - t * 94), (gg = 136 - t * 30), (b = 136 + t * 72);
          else (r = 136 - t * 72), (gg = 136 + t * 94), (b = 136 + t * 110);
          al = 60 + Math.abs(t) * 195;
        } else if (k === 'fear' || k === 'defense' || k === 'awe') {
          const v = Math.min(1, a[k][Math.floor(y / CLUSTER) * a.cw + Math.floor(x / CLUSTER)] / 100);
          const base = k === 'fear' ? [150, 30, 160] : k === 'defense' ? [40, 90, 200] : [230, 190, 40];
          (r = 50 + base[0] * v), (gg = 50 + base[1] * v), (b = 50 + base[2] * v);
          al = 70 + v * 185;
        } else if (k === 'ore') {
          const v = m.ore[y * n + x];
          (r = 60 + 160 * v), (gg = 50), (b = 40);
          al = v > 0.05 ? 90 + v * 160 : 40;
        } else {
          const v = cropFertility(g, k as Good, x, y);
          (r = 120 - v * 90), (gg = 70 + v * 170), (b = 40);
          al = 200;
        }
        data[i] = r;
        data[i + 1] = gg;
        data[i + 2] = b;
        data[i + 3] = al;
      }
    this.app.world.setOverlay(data);
  }
}
