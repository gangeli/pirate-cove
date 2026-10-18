import type { App } from './app';
import { el, html, setHTML, delegate, fmt } from './dom';
import { icon } from './icons';
import { NATIONS, NATION_NAMES, NATION_ADJ } from '../sim/data/kings';
import { SHIPS, MISSION_NAMES } from '../sim/data/ships';
import { regionReachable, transitTime } from '../sim/sea';
import { relationLevel } from '../sim/diplomacy';
import { MONTH } from '../sim/time';
import type { Region } from '../sim/types';
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

export class SeaChart {
  private panel: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private side!: HTMLElement;
  visible = false;
  private region = -1;
  private ship = 0;
  private mode: 'none' | 'risk' | 'reward' = 'none';
  private lastRefresh = 0;
  private paper: HTMLCanvasElement | null = null;

  constructor(private app: App) {
    this.panel = el('div', 'panel big hidden', app.root);
    setHTML(this.panel, html`<button class="close" data-act="close">${icon('close', 14)}</button><h2>Sea Chart of the Caribbee</h2>
      <div class="sub">Pick a ship, then click a region to send her there. Ships can only reach charted seas, or seas next to charted ones.</div>
      <div class="chart-wrap" style="margin-top:8px"><canvas></canvas><div class="chart-side scroll"></div></div>`);
    this.canvas = this.panel.querySelector('canvas')!;
    this.side = this.panel.querySelector('.chart-side') as HTMLElement;
    delegate(this.panel, {
      close: () => this.hide(),
      ship: (id) => {
        this.ship = +id;
        const s = app.game.ships.get(this.ship);
        if (s) this.region = s.region;
        this.refresh(true);
      },
      mode: (m) => {
        this.mode = this.mode === m ? 'none' : (m as any);
        this.refresh(true);
      },
      open: () => {
        if (this.ship) {
          app.select({ type: 'ship', id: this.ship });
          this.hide();
        }
      },
      sail: () => {
        if (this.ship && app.cmd({ type: 'setSail', ship: this.ship })) {
          audio.sfx('ship_bell');
          this.refresh(true);
        }
      },
    }, () => audio.sfx('ui_click'));
    this.canvas.addEventListener('click', (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      let best = -1, bd = 0.06;
      for (const reg of app.game.regions) {
        const d = Math.hypot(reg.x - x, (reg.y - y) * 0.8);
        if (d < bd) (bd = d), (best = reg.id);
      }
      if (best < 0) return;
      this.region = best;
      audio.sfx('quill');
      if (this.ship) {
        const s = app.game.ships.get(this.ship);
        if (s && (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing')) app.cmd({ type: 'shipOrders', ship: s.id, region: best });
      }
      this.refresh(true);
    });
  }

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
    if (!this.ship) this.ship = [...this.app.game.ships.values()].find((s) => s.status === 'docked')?.id ?? 0;
    if (this.region < 0) this.region = this.app.game.homeRegion;
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
    this.draw();
    this.drawSide(force);
  }

  private makePaper(W: number, H: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    // sea wash
    const sea = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
    sea.addColorStop(0, '#d8e4d0');
    sea.addColorStop(1, '#b8c8b0');
    g.fillStyle = sea;
    g.fillRect(0, 0, W, H);
    // paper grain
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},40,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1);
    }
    // rhumb lines from two compass points
    g.strokeStyle = 'rgba(120,80,40,0.18)';
    g.lineWidth = 1;
    for (const [cx, cy] of [[0.68 * W, 0.47 * H], [0.18 * W, 0.2 * H]]) for (let a = 0; a < 32; a++) {
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos((a / 32) * Math.PI * 2) * W * 1.5, cy + Math.sin((a / 32) * Math.PI * 2) * W * 1.5);
      g.stroke();
    }
    // land
    const drawPoly = (p: Poly) => {
      g.beginPath();
      p.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H)));
      g.closePath();
    };
    for (const p of LAND) {
      // coastal shading rings
      for (let k = 4; k >= 1; k--) {
        g.save();
        drawPoly(p);
        g.strokeStyle = `rgba(90,110,100,${0.08 * k})`;
        g.lineWidth = k * 4;
        g.stroke();
        g.restore();
      }
      drawPoly(p);
      const lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, '#e2cf9e');
      lg.addColorStop(1, '#cdb47c');
      g.fillStyle = lg;
      g.fill();
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 1.6;
      g.stroke();
    }
    for (const [x, y, r] of ISLETS) {
      g.beginPath();
      g.ellipse(x * W, y * H, r * W, r * W * 0.7, 0.5, 0, Math.PI * 2);
      g.fillStyle = '#d8c48e';
      g.fill();
      g.strokeStyle = '#5a3a1a';
      g.lineWidth = 1.2;
      g.stroke();
    }
    // hill marks on big land
    g.strokeStyle = 'rgba(90,60,30,0.5)';
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * W, y = H * (0.8 + Math.random() * 0.2);
      g.beginPath();
      g.moveTo(x - 6, y);
      g.lineTo(x, y - 7);
      g.lineTo(x + 6, y);
      g.stroke();
    }
    // compass rose
    const cx = 0.86 * W, cy = 0.17 * H, R = Math.min(W, H) * 0.08;
    g.save();
    g.translate(cx, cy);
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
    g.font = `bold ${R * 0.35}px Georgia`;
    g.textAlign = 'center';
    g.fillText('N', 0, -R - 4);
    g.restore();
    // title cartouche
    g.font = `${Math.round(H * 0.035)}px "Pirata One", Georgia`;
    g.fillStyle = '#4a2a10';
    g.textAlign = 'left';
    g.fillText('Mare Caribbeum', W * 0.04, H * 0.62);
    g.font = `italic ${Math.round(H * 0.022)}px "IM Fell English", Georgia`;
    g.fillText('Here be Pyrates', W * 0.05, H * 0.66);
    return c;
  }

  private draw(): void {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const W = Math.max(400, Math.floor(rect.width)), H = Math.max(300, Math.floor(rect.height));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
      this.paper = null;
    }
    if (!this.paper) this.paper = this.makePaper(W, H);
    const g = c.getContext('2d')!;
    g.drawImage(this.paper, 0, 0);
    const game = this.app.game;
    const sel = this.ship ? game.ships.get(this.ship) : undefined;
    for (const r of game.regions) {
      const x = r.x * W, y = r.y * H;
      const known = r.knowledge > 0;
      const reach = sel ? regionReachable(game, sel, r.id).ok : true;
      // overlay modes
      if (this.mode !== 'none' && known) {
        const v = this.mode === 'risk' ? this.risk(r) : this.reward(r);
        g.beginPath();
        g.arc(x, y, 42, 0, Math.PI * 2);
        g.fillStyle = this.mode === 'risk' ? `rgba(200,30,20,${v * 0.09})` : `rgba(40,160,40,${v * 0.09})`;
        g.fill();
      }
      g.beginPath();
      g.arc(x, y, 34, 0, Math.PI * 2);
      g.setLineDash([5, 5]);
      g.strokeStyle = r.id === this.region ? '#a01a10' : known ? 'rgba(90,50,20,0.55)' : 'rgba(90,50,20,0.25)';
      g.lineWidth = r.id === this.region ? 3 : 1.5;
      g.stroke();
      g.setLineDash([]);
      if (!known) {
        g.fillStyle = 'rgba(120,100,70,0.28)';
        g.fill();
      }
      if (sel && !reach) {
        g.fillStyle = 'rgba(60,30,10,0.15)';
        g.fill();
      }
      g.font = `${r.id === this.region ? 'bold ' : ''}14px "IM Fell English", Georgia`;
      g.textAlign = 'center';
      g.fillStyle = '#3a1a08';
      g.fillText(r.name, x, y - 38);
      if (known) {
        // risk cannons and reward chests
        const rk = this.risk(r), rw = this.reward(r);
        g.font = '12px Georgia';
        g.fillStyle = '#8a1a10';
        g.fillText('●'.repeat(rk) + '○'.repeat(5 - rk), x, y + 46);
        g.fillStyle = '#7a5a10';
        g.fillText('◆'.repeat(rw) + '◇'.repeat(5 - rw), x, y + 58);
      } else {
        g.font = 'italic 13px Georgia';
        g.fillStyle = '#5a4020';
        g.fillText('uncharted', x, y + 50);
      }
      for (const st of r.settlements) if (st.found) {
        g.fillStyle = st.type === 'military' ? '#8a1a10' : st.type === 'trade' ? '#7a5a10' : '#3a6a2a';
        g.fillRect(x + 20, y - 8, 7, 7);
      }
      if (r.routeFound) {
        g.strokeStyle = 'rgba(122,90,16,0.7)';
        g.setLineDash([2, 4]);
        g.beginPath();
        g.moveTo(x - 30, y + 10);
        g.lineTo(x + 30, y - 10);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // home island
    const home = game.regions[game.homeRegion];
    g.font = '30px serif';
    g.textAlign = 'center';
    g.fillText('☠', home.x * W, home.y * H + 10);
    // ships at sea
    let k = 0;
    for (const s of game.ships.values()) {
      const r = game.regions[s.status === 'atsea' || s.status === 'returning' ? s.region : game.homeRegion];
      const x = r.x * W + 18 + (k % 3) * 10, y = r.y * H + 8 + Math.floor(k / 3) * 10;
      k++;
      g.fillStyle = s.id === this.ship ? '#a01a10' : '#2a1a0a';
      g.beginPath();
      g.moveTo(x - 7, y);
      g.lineTo(x + 7, y);
      g.lineTo(x + 4, y + 5);
      g.lineTo(x - 4, y + 5);
      g.closePath();
      g.fill();
      g.fillRect(x - 0.5, y - 10, 1.5, 10);
      g.beginPath();
      g.moveTo(x + 1, y - 10);
      g.lineTo(x + 7, y - 3);
      g.lineTo(x + 1, y - 2);
      g.fill();
    }
  }

  private drawSide(force: boolean): void {
    if (!force && this.side.matches(':hover')) return;
    const game = this.app.game;
    const r = game.regions[this.region] ?? game.regions[game.homeRegion];
    const known = r.knowledge > 0;
    const level = ['Unexplored', 'Well Surveyed', 'Thoroughly Charted', 'Very Familiar Seas', 'Like the Back of Our Hand', 'Claimed as Our Waters'][Math.min(5, Math.floor(r.knowledge))];
    const ships = [...game.ships.values()];
    const sel = this.ship ? game.ships.get(this.ship) : undefined;
    setHTML(this.side, html`
      <div class="row"><button class="btn small ${this.mode === 'risk' ? 'on' : ''}" data-act="mode:risk">Danger</button><button class="btn small ${this.mode === 'reward' ? 'on' : ''}" data-act="mode:reward">Plunder</button></div>
      <h3>${r.name}${r.id === game.homeRegion ? ' (home)' : ''}</h3><div class="sub">${level}</div>
      ${known ? html`<div class="kv inspector" style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:14px;margin-top:4px">
        <span>Danger</span><span style="color:#8a1a10">${'●'.repeat(this.risk(r))}${'○'.repeat(5 - this.risk(r))}</span>
        <span>Plunder</span><span style="color:#7a5a10">${'◆'.repeat(this.reward(r))}${'◇'.repeat(5 - this.reward(r))}</span>
        ${NATIONS.map((n) => html`<span>${NATION_ADJ[n]}</span><span>${r.merchant[n] > 0.6 ? 'busy' : r.merchant[n] > 0.3 ? 'some' : 'few'} merchants, ${r.naval[n] > 0.5 ? 'strong' : r.naval[n] > 0.2 ? 'some' : 'little'} navy</span>`)}
        <span>Settlements</span><span>${r.settlements.filter((s) => s.found).map((s) => `${s.name} (${NATION_ADJ[s.nat]} ${s.type})`).join(', ') || 'none known'}</span>
        <span>Trade route</span><span>${r.routeFound ? 'yes' : 'none known'}</span></div>` : html`<div class="sub">Send a ship to explore these waters.</div>`}
      <hr class="rule"><h3>Your Fleet</h3>
      ${ships.length ? ships.map((s) => html`<div class="row" style="justify-content:space-between;cursor:pointer;padding:2px 4px;border-radius:4px;${s.id === this.ship ? 'background:rgba(200,160,72,0.35)' : ''}" data-act="ship:${s.id}">
        <span>${icon('ship', 16)} ${s.name}</span><span class="sub">${s.status === 'atsea' ? `${MISSION_NAMES[s.mission]}, ${game.regions[s.region].name}` : s.status}</span></div>`) : html`<div class="sub">You have no ships. Build a boatyard!</div>`}
      ${sel ? html`<hr class="rule"><h3>${sel.name}</h3><div style="font-size:14px">${SHIPS[sel.type].name} · ${MISSION_NAMES[sel.mission]} → ${game.regions[sel.region].name}</div>
        <div class="sub">${(() => {
          const re = regionReachable(game, sel, sel.region);
          return re.ok ? `${(transitTime(game, sel, sel.region) / MONTH).toFixed(1)} months each way · rations ${Math.floor(sel.rations)}/${SHIPS[sel.type].rations}` : re.reason;
        })()}</div>
        <div class="row" style="margin-top:6px">${sel.status === 'docked' || sel.status === 'boarding' ? html`<button class="btn green small" data-act="sail">${icon('bell', 14)} Set Sail</button>` : ''}<button class="btn small" data-act="open">Ship details</button></div>` : ''}
      <hr class="rule"><h3>Great Powers</h3>
      ${NATIONS.map((n) => {
        const st = game.nations[n];
        return html`<div style="font-size:14px"><b>${NATION_NAMES[n]}</b>: ${relationLevel(st.relation)}${st.knows ? ' · knows where you are' : ''}${st.atWarWith.length ? ` · at war with ${st.atWarWith.map((x) => NATION_NAMES[x]).join(', ')}` : ''}${st.invasion.stage ? html` · <b style="color:#a01010">invasion ${['', 'rumoured', 'assembling', 'underway'][st.invasion.stage]}!</b>` : ''}<br><span class="sub">plundered ${fmt(st.plunderGold)} gold</span></div>`;
      })}`);
  }
}
