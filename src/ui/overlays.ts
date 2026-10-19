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

// overlay palette (sRGB)
const NEUTRAL = [120, 120, 128], ORDER = [30, 110, 255], ANARCHY = [240, 40, 20];
const LOW = [40, 38, 48], FEAR = [190, 40, 235], DEFENSE = [30, 130, 255], AWE = [255, 205, 20], ORE = [235, 40, 20];
const POOR = [215, 45, 25], FAIR = [245, 215, 40], RICH = [40, 215, 50];
const css = (c: number[]) => `rgb(${c.join(',')})`;

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
      <div class="grad" style="background:${this.legend()}"></div>
      <div class="row" style="justify-content:space-between;font-size:12px"><span>${this.kind === 'order' ? 'Anarchy' : 'Low'}</span><span>${this.kind === 'order' ? 'Order' : 'High'}</span></div>`);
  }

  /** legend gradient matching the colours drawn on the ground */
  private legend(): string {
    const k = this.kind;
    if (k === 'order') return `linear-gradient(90deg,${css(ANARCHY)},${css(NEUTRAL)},${css(ORDER)})`;
    if (k === 'fear' || k === 'defense' || k === 'awe' || k === 'ore') return `linear-gradient(90deg,${css(LOW)},${css(k === 'fear' ? FEAR : k === 'defense' ? DEFENSE : k === 'awe' ? AWE : ORE)})`;
    return `linear-gradient(90deg,${css(POOR)},${css(FAIR)},${css(RICH)})`;
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
        // strong, saturated ramps (the terrain shader greys the ground underneath so these read at a glance)
        const mixc = (c0: readonly number[], c1: readonly number[], t: number) => ((r = c0[0] + (c1[0] - c0[0]) * t), (gg = c0[1] + (c1[1] - c0[1]) * t), (b = c0[2] + (c1[2] - c0[2]) * t));
        if (k === 'order') {
          const v = a.order[Math.floor(y / CLUSTER) * a.cw + Math.floor(x / CLUSTER)] / 100;
          const t = Math.max(-1, Math.min(1, v));
          mixc(NEUTRAL, t > 0 ? ORDER : ANARCHY, Math.min(1, Math.abs(t) * 1.4));
          al = 70 + Math.min(1, Math.abs(t) * 1.4) * 185;
        } else if (k === 'fear' || k === 'defense' || k === 'awe') {
          const v = Math.min(1, a[k][Math.floor(y / CLUSTER) * a.cw + Math.floor(x / CLUSTER)] / 100);
          mixc(LOW, k === 'fear' ? FEAR : k === 'defense' ? DEFENSE : AWE, Math.sqrt(v));
          al = 120 + Math.sqrt(v) * 135;
        } else if (k === 'ore') {
          const v = m.ore[y * n + x];
          mixc(LOW, ORE, Math.min(1, v * 1.3));
          al = v > 0.05 ? 160 + v * 95 : 90;
        } else {
          const v = Math.max(0, Math.min(1, cropFertility(g, k as Good, x, y)));
          if (v < 0.5) mixc(POOR, FAIR, v * 2);
          else mixc(FAIR, RICH, (v - 0.5) * 2);
          al = 215;
        }
        data[i] = r;
        data[i + 1] = gg;
        data[i + 2] = b;
        data[i + 3] = al;
      }
    this.app.world.setOverlay(data);
  }
}
