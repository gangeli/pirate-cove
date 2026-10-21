import type { App } from './app';
import { el, html, setHTML, delegate } from './dom';
import { icon } from './icons';
import { cropFertility } from '../sim/economy';
import { CLUSTER } from '../sim/aura';
import type { Good } from '../sim/data/goods';
import { BUILDING } from '../sim/data/buildings';
import { audio } from '../audio/audio';

type Kind = 'none' | 'order' | 'fear' | 'defense' | 'awe' | 'soil' | 'ore';
type Crop = 'corn' | 'banana' | 'papaya' | 'sugarcane' | 'tobacco';
/** [kind, name, short name, icon, what the colours mean, low end, high end]: one tap each, in this order (also the step order) */
const KINDS: [Exclude<Kind, 'none'>, string, string, string, string, string, string][] = [
  ['order', 'Order & anarchy', 'Order', 'scales', 'Blue ground is orderly (captives like it); red is anarchic (pirates like it).', 'Anarchy', 'Order'],
  ['fear', 'Fear', 'Fear', 'skull', 'The brighter the purple, the more fear keeps captives in line.', 'None', 'Terror'],
  ['defense', 'Defense', 'Defense', 'shield', 'Bright blue is well guarded: pirates feel safe there.', 'Exposed', 'Safe'],
  ['awe', 'Awe', 'Awe', 'crown', 'Gold ground is near impressive buildings that resign captives to their fate.', 'None', 'Awed'],
  ['soil', 'Soil', 'Soil', 'sprout', 'Green soil suits the crop best: a farm there yields the most.', 'Poor', 'Rich'],
  ['ore', 'Iron', 'Iron', 'pick', 'Red patches are iron veins: build mines right beside them.', 'None', 'Rich vein'],
];
const CROPS: [Crop, string][] = [['corn', 'Corn'], ['banana', 'Bananas'], ['papaya', 'Papayas'], ['sugarcane', 'Sugar'], ['tobacco', 'Tobacco']];

// overlay palette (sRGB)
const NEUTRAL = [120, 120, 128], ORDER = [30, 110, 255], ANARCHY = [240, 40, 20];
const LOW = [40, 38, 48], FEAR = [190, 40, 235], DEFENSE = [30, 130, 255], AWE = [255, 205, 20], ORE = [235, 40, 20];
const POOR = [215, 45, 25], FAIR = [245, 215, 40], RICH = [40, 215, 50];
const css = (c: number[]) => `rgb(${c.join(',')})`;

export class Overlays {
  private panel: HTMLElement;
  visible = false;
  kind: Kind = 'none';
  crop: Crop = 'corn';
  private last: Exclude<Kind, 'none'> = 'order';
  private t = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel legend hidden', app.root);
    delegate(this.panel, {
      pick: (k) => this.set(k as Kind),
      crop: (c) => {
        this.crop = c as Crop;
        this.set('soil');
      },
      step: (d) => this.step(+d),
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
    // the soil overlay follows the crop of the farm in hand or selected
    const crop = this.farmCrop();
    if (crop) this.crop = crop;
    this.app.closeAll();
    this.tintFor = null;
    // on a phone the sheet takes the inspector's place
    if (this.app.touchMode) this.app.select(null);
    this.visible = true;
    this.panel.classList.remove('hidden');
    if (tint && this.kind === 'none') this.set(crop ? 'soil' : this.last);
    this.render();
    this.app.hud.updateTool();
  }
  /** while a building that draws on the land is placed, its overlay tints the ground without opening the panel
   *  (farms: soil for their crop; mines: iron); null puts the ground back */
  private tintFor: Kind | null = null;
  placementTint(k: 'soil' | 'ore' | null, crop?: string): void {
    if (this.visible) return; // the player has the views panel open: leave their choice alone
    if (k) {
      if (crop && CROPS.some((x) => x[0] === crop)) this.crop = crop as Crop;
      this.tintFor = k;
      this.kind = k;
      this.t = 99;
    } else if (this.tintFor) {
      this.tintFor = null;
      this.kind = 'none';
      this.app.world.setOverlay(null);
    }
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
    if (k !== 'none') this.last = k;
    this.t = 99;
    if (k === 'none') this.app.world.setOverlay(null);
    this.render();
  }
  /** the next or previous overlay (wrapping; from Off, the first or last) */
  step(d: number): void {
    if (!this.visible) return;
    const i = KINDS.findIndex((x) => x[0] === this.kind);
    const n = KINDS.length;
    this.set(KINDS[i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n][0]);
  }
  private farmCrop(): Crop | null {
    const a = this.app;
    const def = a.tool.kind === 'build' ? a.tool.def : a.selection?.type === 'building' ? a.game.buildings.get(a.selection.id)?.def : undefined;
    const c = def ? BUILDING[def]?.gather?.crop : undefined;
    return c && CROPS.some((x) => x[0] === c) ? (c as Crop) : null;
  }
  private render(): void {
    if (!this.visible) return;
    const cur = KINDS.find((x) => x[0] === this.kind);
    const cropName = CROPS.find((c) => c[0] === this.crop)![1];
    setHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close map views">${icon('close', 14)}</button>
      <header class="sheet-head"><h3>Map views</h3></header>
      <button class="btn small views-chart" data-act="chart" data-tip="<b>Sea chart</b><br>Send your ships out to plunder. <i>(M)</i>">${icon('telescope', 16)} Sea chart</button>
      <div class="ov-chips" role="radiogroup" aria-label="Ground tint">
        <button class="ov off ${this.kind === 'none' ? 'on' : ''}" data-act="pick:none" role="radio" aria-checked="${this.kind === 'none' ? 'true' : 'false'}" data-tip="<b>Off</b><br>Plain ground.">${icon('close', 20)}<span class="nm">Off</span><i class="sw"></i></button>
        ${KINDS.map(([k, n, sh, ic]) => html`<button class="ov ov-${k} ${this.kind === k ? 'on' : ''}" data-act="pick:${k}" role="radio" aria-checked="${this.kind === k ? 'true' : 'false'}" data-tip="<b>${n}</b>">${icon(ic, 20)}<span class="nm">${sh}</span><i class="sw" style="background:${this.legend(k)}"></i></button>`)}
      </div>
      ${this.kind === 'soil' ? html`<div class="seg full ov-crops" role="radiogroup" aria-label="Crop">${CROPS.map(([c, n]) => html`<button class="${this.crop === c ? 'on' : ''}" data-act="crop:${c}" role="radio" aria-checked="${this.crop === c ? 'true' : 'false'}">${n}</button>`)}</div>` : ''}
      ${cur ? html`<div class="ov-key">
          <button class="ov-step" data-act="step:-1" aria-label="Previous overlay" data-tip="Previous overlay <i>([)</i>">${icon('chevl', 18)}</button>
          <div class="ov-scale"><div class="grad" style="background:${this.legend(cur[0])}"></div><div class="ends"><span>${cur[5]}</span><b>${cur[0] === 'soil' ? `Soil for ${cropName.toLowerCase()}` : cur[1]}</b><span>${cur[6]}</span></div></div>
          <button class="ov-step" data-act="step:1" aria-label="Next overlay" data-tip="Next overlay <i>(])</i>">${icon('chevr', 18)}</button>
        </div>
        <p class="ov-now">${cur[4]}</p>` : html`<p class="ov-now hint0">Pick a tint to colour the ground: who rules where, what grows, what lies beneath.</p>`}`);
    // where the sheet ends: on wide screens an open inspector below it shortens to fit (see .legend in style.css)
    this.app.root.style.setProperty('--legend-b', `${this.panel.offsetTop + this.panel.offsetHeight}px`);
  }

  /** legend gradient matching the colours drawn on the ground */
  private legend(k: Kind = this.kind): string {
    if (k === 'order') return `linear-gradient(90deg,${css(ANARCHY)},${css(NEUTRAL)},${css(ORDER)})`;
    if (k === 'fear' || k === 'defense' || k === 'awe' || k === 'ore') return `linear-gradient(90deg,${css(LOW)},${css(k === 'fear' ? FEAR : k === 'defense' ? DEFENSE : k === 'awe' ? AWE : ORE)})`;
    return `linear-gradient(90deg,${css(POOR)},${css(FAIR)},${css(RICH)})`;
  }

  update(): void {
    if ((!this.visible && !this.tintFor) || this.kind === 'none') return;
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
          const v = Math.max(0, Math.min(1, cropFertility(g, this.crop as Good, x, y)));
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
