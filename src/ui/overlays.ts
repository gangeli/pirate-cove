import type { App } from './app';
import { el, html, setHTML, delegate } from './dom';
import { icon } from './icons';
import { cropFertility } from '../sim/economy';
import { CLUSTER } from '../sim/aura';
import type { Good } from '../sim/data/goods';
import { audio } from '../audio/audio';

type Kind = 'none' | 'order' | 'fear' | 'defense' | 'awe' | 'corn' | 'banana' | 'papaya' | 'sugarcane' | 'tobacco' | 'ore' | 'happiness';
/** [kind, name, short name, icon, what it shows, low end, high end] in three groups */
const GROUPS: [string, [Kind, string, string, string, string, string, string][]][] = [
  ['Rule of the island', [
    ['order', 'Order & Anarchy', 'Order', 'scales', 'Blue is orderly (captives like it), red is anarchic (pirates like it).', 'Anarchy', 'Order'],
    ['fear', 'Fear', 'Fear', 'skull', 'Fear keeps captives in line.', 'None', 'Terror'],
    ['defense', 'Defense', 'Defense', 'shield', 'Pirates feel safe in well-defended areas.', 'Exposed', 'Safe'],
    ['awe', 'Awe', 'Awe', 'crown', 'Impressive buildings resign captives to their fate.', 'None', 'Awed'],
  ]],
  ['Soil for crops', [
    ['corn', 'Corn', 'Corn', 'sprout', 'Where corn grows best. Farms on rich (green) soil yield more.', 'Poor', 'Rich'],
    ['banana', 'Bananas', 'Bananas', 'sprout', 'Where bananas grow best. Farms on rich (green) soil yield more.', 'Poor', 'Rich'],
    ['papaya', 'Papayas', 'Papayas', 'sprout', 'Where papayas grow best. Farms on rich (green) soil yield more.', 'Poor', 'Rich'],
    ['sugarcane', 'Sugarcane', 'Sugar', 'sprout', 'Where sugarcane grows best. Farms on rich (green) soil yield more.', 'Poor', 'Rich'],
    ['tobacco', 'Tobacco', 'Tobacco', 'sprout', 'Where tobacco grows best. Farms on rich (green) soil yield more.', 'Poor', 'Rich'],
  ]],
  ['Under the ground', [
    ['ore', 'Iron deposits', 'Iron', 'pick', 'Mines must be built next to dark red patches.', 'None', 'Rich vein'],
  ]],
];
const ALL = GROUPS.flatMap(([, l]) => l);

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
      pick: (k) => (k === 'none' ? this.hide() : this.set(k as Kind)),
      close: () => this.hide(),
      chart: () => this.app.chart.open(0),
    }, () => audio.sfx('ui_click'));
  }
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
  /** open the map views; `tint` starts on the last overlay (the O key), otherwise the ground stays plain until one is picked */
  show(tint = true): void {
    this.app.closeAll();
    this.visible = true;
    this.panel.classList.remove('hidden');
    if (tint && this.kind === 'none') this.set(this.last);
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
  private last: Kind = 'order';
  set(k: Kind): void {
    this.kind = k;
    if (k !== 'none') this.last = k;
    this.t = 99;
    if (k === 'none') this.app.world.setOverlay(null);
    this.render();
  }
  private render(): void {
    const cur = ALL.find((x) => x[0] === this.kind);
    setHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close overlays">${icon('close', 14)}</button>
      <header class="sheet-head"><h3>Map views</h3><div class="sub">Tint the ground to see what the island hides.</div></header>
      <button class="btn small views-chart" data-act="chart" data-tip="<b>Sea chart</b><br>Send your ships out to plunder. <i>(M)</i>">${icon('telescope', 16)} Sea chart</button>
      <div class="ov-groups"><button class="ov off" data-act="pick:none" aria-label="Turn the overlay off">${icon('close', 14)}<span>Off</span></button>${GROUPS.map(([g, list]) => html`<div class="ov-group"><h4 class="eng">${g}</h4>
        <div class="ov-list" role="radiogroup" aria-label="${g}">${list.map(([k, n, sh, ic]) => html`<button class="ov ${this.kind === k ? 'on' : ''}" data-act="pick:${k}" role="radio" aria-checked="${this.kind === k ? 'true' : 'false'}">
          <i class="sw" style="background:${this.legend(k)}"></i>${icon(ic, 15)}<span class="full">${n}</span><span class="short">${sh}</span></button>`)}</div></div>`)}</div>
      ${cur ? html`<div class="ov-key"><div class="ov-now"><b>${cur[1]}</b> <span>${cur[4]}</span></div>
        <div class="grad" style="background:${this.legend(cur[0])}"></div>
        <div class="ends"><span>${cur[5]}</span><span>${cur[6]}</span></div></div>` : ''}
      <div class="actions"><button class="btn ghost small" data-act="close">${icon('close', 13)} Hide overlay</button></div>`);
  }

  /** legend gradient matching the colours drawn on the ground */
  private legend(k: Kind = this.kind): string {
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
