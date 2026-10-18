import type { App } from './app';
import { el, html, setHTML, delegate, fmt, raw } from './dom';
import { icon } from './icons';
import { portraitImg, parrotSvg } from './portraits';
import type { Message } from '../sim/types';
import { audio } from '../audio/audio';
import { Minimap } from './minimap';
import { ADVISOR_NAME } from '../sim/advisor';

const PARROT_KEYS = new Set(['sail_ho', 'escape', 'rebellion', 'invasion', 'accessory_parrot']);

export class Hud {
  private top: HTMLElement;
  private bar: HTMLElement;
  private adv: HTMLElement;
  private ticker: HTMLElement;
  private hint: HTMLElement;
  private clock: HTMLElement;
  private tip: HTMLElement;
  minimap: Minimap;
  private advQueue: Message[] = [];
  private advUntil = 0;
  private hintTimer = 0;
  advisorMode: 'full' | 'brief' | 'off' = 'full';

  constructor(private app: App) {
    const ui = app.root;
    this.top = el('div', 'topbar hidden', ui);
    this.bar = el('div', 'toolbar hidden', ui);
    this.adv = el('div', 'advisor gone', ui);
    this.ticker = el('div', 'ticker hidden', ui);
    this.hint = el('div', 'hint hidden', ui);
    this.clock = el('div', 'clock hidden', ui);
    this.tip = el('div', 'tipbox hidden', document.body);
    this.minimap = new Minimap(app, ui);
    try {
      this.advisorMode = (localStorage.getItem('bc_advisor') as any) ?? 'full';
    } catch {
      /* ignore */
    }
    this.buildToolbar();
    delegate(this.top, {
      gold: () => app.log.open('finances'),
      hoard: () => app.log.open('overview'),
      pirates: () => app.log.open('pirates'),
      captives: () => app.log.open('captives'),
      mood: () => app.log.open('satisfaction'),
    });
    delegate(this.adv, {
      advClose: () => this.dismissAdvisor(),
      advGo: (arg) => {
        const [x, y] = arg.split(',').map(Number);
        app.jumpTo(x, y);
      },
    });
    delegate(this.ticker, {
      toast: (arg, _e, t) => {
        const [x, y] = arg.split(',').map(Number);
        if (!isNaN(x)) app.jumpTo(x, y);
        t.remove();
      },
    });
    // tooltips
    document.addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch') return this.tip.classList.add('hidden'); // no hover on touch screens
      const t = (ev.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!t) return this.tip.classList.add('hidden');
      this.tip.innerHTML = t.dataset.tip!;
      this.tip.classList.remove('hidden');
      const r = t.getBoundingClientRect();
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 4) y = r.bottom + 8;
      x = Math.max(4, Math.min(innerWidth - tw - 4, x));
      this.tip.style.left = `${x}px`;
      this.tip.style.top = `${y}px`;
    });
  }

  show(on: boolean): void {
    for (const e of [this.top, this.bar, this.ticker, this.clock]) e.classList.toggle('hidden', !on);
    if (on) setTimeout(() => this.update(), 0);
    this.minimap.show(on);
    if (!on) this.adv.classList.add('gone');
  }

  private buildToolbar(): void {
    const tools: [string, string, string, string][] = [
      ['build', 'hammer', 'B', '<b>Construction</b><br>Build structures for your island.'],
      ['road', 'road', '', '<b>Roads</b><br>Drag to lay a road. Most buildings must touch one.'],
      ['clear', 'axe', '', '<b>Clear Vegetation</b><br>Drag to cut down trees.'],
      ['demolish', 'bulldoze', '', '<b>Demolish</b><br>Tear down a building.'],
      ['overlays', 'eye', 'O', '<b>Overlays</b><br>See order, fear, anarchy, fertility and more.'],
      ['edicts', 'scroll', 'X', '<b>Edicts</b><br>Issue royal decrees.'],
      ['chart', 'telescope', 'M', '<b>Sea Chart</b><br>Send your ships out to plunder.'],
      ['log', 'book', 'L', '<b>Island Log</b><br>Finances, people, nations and more.'],
      ['menu', 'wheel', 'Esc', '<b>Game Menu</b><br>Save, load and settings.'],
    ];
    setHTML(this.bar, html`
      ${tools.map(([id, ic, k, tip]) => html`<div class="tool" data-act="tool:${id}" data-tool="${id}" data-tip="${raw(tip)}">${icon(ic, 26)}${k ? html`<span class="key">${k}</span>` : ''}</div>`)}
`);
    setHTML(this.clock, html`
      <div class="speed">
        <div class="sp" data-act="speed:0" data-tip="Pause (Space)">${icon('pause', 16)}</div>
        <div class="sp" data-act="speed:1" data-tip="Normal speed (1)">${icon('play', 16)}</div>
        <div class="sp" data-act="speed:2" data-tip="Fast (2)">${icon('fast', 16)}</div>
        <div class="sp" data-act="speed:4" data-tip="Faster (3)">${icon('faster', 16)}</div>
        <div class="sp" data-act="speed:8" data-tip="Fastest (4)"><b style="font-family:var(--head)">8×</b></div>
      </div>
      <div class="date" data-tip="Game date"><span class="dv"></span><small class="dl"></small></div>`);
    delegate(this.clock, {
      speed: (v) => {
        const g = this.app.game;
        if (v === '0') g.paused = !g.paused;
        else {
          g.speed = +v;
          g.paused = false;
        }
        this.updateSpeed();
      },
    });
    delegate(this.bar, {
      tool: (id) => {
        const a = this.app;
        audio.sfx('ui_click');
        if (id === 'build') {
          if (a.touchMode) a.select(null);
          return a.build.toggle();
        }
        if (id === 'road') return a.setTool(a.tool.kind === 'road' ? { kind: 'select' } : { kind: 'road' });
        if (id === 'clear') return a.setTool(a.tool.kind === 'clear' ? { kind: 'select' } : { kind: 'clear' });
        if (id === 'demolish') return a.setTool(a.tool.kind === 'demolish' ? { kind: 'select' } : { kind: 'demolish' });
        if (id === 'overlays') return a.overlays.toggle();
        if (id === 'edicts') return a.edicts.toggle();
        if (id === 'chart') return a.chart.toggle();
        if (id === 'log') return a.log.toggle();
        if (id === 'menu') return a.modal.gameMenu();
      },
    });
  }

  updateTool(): void {
    const k = this.app.tool.kind;
    for (const t of this.bar.querySelectorAll<HTMLElement>('.tool')) {
      const id = t.dataset.tool!;
      const on = (id === 'road' && k === 'road') || (id === 'clear' && k === 'clear') || (id === 'demolish' && k === 'demolish') ||
        (id === 'build' && (this.app.build?.visible || k === 'build')) || (id === 'overlays' && this.app.overlays?.visible) ||
        (id === 'edicts' && this.app.edicts?.visible) || (id === 'chart' && this.app.chart?.visible) || (id === 'log' && this.app.log?.visible);
      t.classList.toggle('on', !!on);
    }
    const hints: Record<string, string> = {
      road: 'Drag to lay a road. Right-click to stop.',
      clear: 'Drag over trees to clear them. Right-click to stop.',
      demolish: 'Click a building to demolish it. Right-click to stop.',
      build: 'Click to place. R rotates, Shift keeps placing, right-click cancels.',
    };
    const h = hints[k];
    if (h) this.flash(h, 0);
    else if (this.hintTimer === 0) this.hint.classList.add('hidden');
  }

  updateSpeed(): void {
    const g = this.app.game;
    for (const s of this.clock.querySelectorAll<HTMLElement>('.sp')) {
      const v = +s.dataset.act!.split(':')[1];
      s.classList.toggle('on', v === 0 ? g.paused : !g.paused && g.speed === v);
    }
  }

  flash(text: string, secs = 3): void {
    this.hint.textContent = text;
    this.hint.classList.remove('hidden');
    clearTimeout(this.hintTimer);
    this.hintTimer = 0;
    if (secs > 0) this.hintTimer = window.setTimeout(() => {
      this.hint.classList.add('hidden');
      this.hintTimer = 0;
      this.updateTool();
    }, secs * 1000);
  }

  update(): void {
    const g = this.app.game;
    const pir = g.pirates();
    const cap = g.captives().filter((c) => c.kind !== 'skeleton');
    const hap = g.avgHappiness(), res = g.avgResignation();
    const inc = Object.values(g.finance.lastIncome).reduce((a, b) => a + b, 0), exp = Object.values(g.finance.lastExpense).reduce((a, b) => a + b, 0);
    setHTML(this.top, html`
      <div class="res ${g.treasury < 0 ? 'neg' : ''}" data-act="gold" data-tip="<b>Treasury</b><br>Last month: +${fmt(inc)} / -${fmt(exp)}">${icon('coin', 24)}<div><div class="v">${fmt(g.treasury)}</div><small>treasury</small></div></div>
      <div class="res" data-tip="<b>Lumber</b><br>Total stored at your sawmills.">${icon('lumber', 24)}<div><div class="v">${fmt(g.lumber())}</div><small>lumber</small></div></div>
      <div class="res" data-act="hoard" data-tip="<b>Your Hoard</b><br>${g.buildingCount('cave') ? `${Math.round(g.hoardRate * 100)}% of all income is skimmed into your Pirate Cave. This is your score.` : 'Build a Pirate Cave to start your personal hoard.'}">${icon('chest', 24)}<div><div class="v">${fmt(g.hoard)}</div><small>hoard</small></div></div>
      <div class="res" data-act="pirates" data-tip="<b>Pirates</b><br>${pir.filter((p) => p.task.kind === 'atsea').length} at sea">${icon('pirate', 22)}<div><div class="v">${pir.length}</div><small>pirates</small></div></div>
      <div class="res" data-act="captives" data-tip="<b>Captives</b>">${icon('captive', 22)}<div><div class="v">${cap.length}</div><small>captives</small></div></div>
      <div class="mood" data-act="mood" data-tip="<b>Pirate Happiness</b> ${Math.round(hap * 100)}%<br><b>Captive Resignation</b> ${Math.round(res * 100)}%">
        <label>Happiness</label><div class="m hp"><div style="width:${(hap * 100).toFixed(0)}%"></div></div>
        <label>Resignation</label><div class="m rs"><div style="width:${(res * 100).toFixed(0)}%"></div></div>
      </div>`);
    const dv = this.clock.querySelector('.dv')!, dl = this.clock.querySelector('.dl')!;
    dv.textContent = g.date;
    const left = Math.max(0, g.settings.years - g.yearsElapsed);
    dl.textContent = g.over ? 'reign over' : `${left.toFixed(1)} years left`;
    this.updateSpeed();
    // advisor timeout
    if (this.advUntil && performance.now() > this.advUntil) this.dismissAdvisor();
  }

  /** route sim messages to advisor bubble, toasts or modal dialogs */
  message(m: Message): void {
    if (m.modal) {
      this.app.modal.message(m);
      return;
    }
    if (m.kind === 'advisor') {
      if (this.advisorMode === 'off') return;
      this.advQueue.push(m);
      if (!this.advUntil) this.nextAdvisor();
      return;
    }
    this.toast(m);
    if (m.voice && this.advisorMode !== 'off' && (m.kind === 'alert' || m.kind === 'ship' || m.kind === 'bad' || m.kind === 'good')) audio.voice(m.voice);
  }

  private toast(m: Message): void {
    const t = el('div', `toast ${m.kind}`, this.ticker);
    t.dataset.act = `toast:${m.focus ? `${m.focus.x},${m.focus.y}` : ''}`;
    const ic = m.kind === 'ship' ? 'ship' : m.kind === 'bad' ? 'skull' : m.kind === 'good' ? 'coin' : m.kind === 'alert' ? 'bell' : 'info';
    setHTML(t, html`${icon(ic, 22)}<div><b>${m.title}</b>${m.text.split('\n')[0].slice(0, 110)}</div>`);
    while (this.ticker.children.length > 5) this.ticker.firstElementChild!.remove();
    setTimeout(() => t.remove(), 12000);
  }

  private nextAdvisor(): void {
    const m = this.advQueue.shift();
    if (!m) {
      this.advUntil = 0;
      this.adv.classList.add('gone');
      return;
    }
    const parrot = PARROT_KEYS.has(m.voice ?? '');
    setHTML(this.adv, html`<div class="face">${raw(parrot ? parrotSvg(84) : portraitImg('barnaby', 80))}</div>
      <div class="panel bubble" style="position:relative">
        <div class="who">${parrot ? 'Polly the parrot' : `${ADVISOR_NAME}, your first mate`}</div>
        <h4>${m.title}</h4><p>${this.advisorMode === 'brief' ? m.text.split('. ')[0] + '.' : m.text}</p>
        <div class="row">${m.focus ? html`<button class="btn small" data-act="advGo:${m.focus.x},${m.focus.y}">Show me</button>` : ''}<button class="btn small" data-act="advClose">Aye</button></div>
      </div>`);
    this.adv.classList.remove('gone');
    this.advUntil = performance.now() + Math.max(9000, m.text.length * 70);
    if (m.voice) audio.voice(m.voice);
  }

  dismissAdvisor(): void {
    this.advUntil = 0;
    this.adv.classList.add('gone');
    setTimeout(() => this.nextAdvisor(), 400);
  }

  setSpeaking(s: boolean): void {
    this.adv.classList.toggle('speaking', s);
  }
}
