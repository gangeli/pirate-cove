import type { App } from './app';
import { el, html, setHTML, delegate, fmt, raw, esc, setText, setAttr, setStyle, toggleClass, type Raw } from './dom';
import { undoLabel } from '../sim/undo';
import { icon } from './icons';
import { letterStrip } from './tally';
import { portraitImg, parrotSvg } from './portraits';
import type { Message } from '../sim/types';
import { audio } from '../audio/audio';
import { Minimap } from './minimap';
import { ADVISOR_NAME } from '../sim/advisor';
import { workforce, type Workforce } from '../sim/workforce';
import { workforceTip } from './workforce';

/** the switch at the head of the island's two books: the log and the edicts are one entry on the bar */
export function bookSwitch(cur: 'log' | 'edicts'): Raw {
  const b = (id: 'log' | 'edicts', ic: string, label: string, k: string) =>
    html`<button class="${cur === id ? 'on' : ''}" data-act="book:${id}" role="tab" aria-selected="${cur === id ? 'true' : 'false'}" data-tip="${label} <i>(${k})</i>">${icon(ic, 16)}${label}</button>`;
  return html`<nav class="seg bookswitch" role="tablist" aria-label="Island books">${b('log', 'book', 'Log', 'L')}${b('edicts', 'scroll', 'Edicts', 'X')}</nav>`;
}

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
  private touchHintFor = '';
  /** the element whose tip is showing, and when a tip drawn on opening (`data-tipfn`) was last redrawn */
  private tipFor: HTMLElement | null = null;
  private tipDrawn = 0;
  private showTip: (t: HTMLElement) => void = () => {};
  /** a touch that opened a tap-first tip, so the click that follows it does not also act */
  private tapTipAt = 0;
  /** the workforce figures, worked out once per moment of game time and only while a tip shows them */
  private wf: { t: number; v: Workforce } | null = null;

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
      pirates: () => this.tapTipped() || app.log.open('pirates'),
      captives: () => this.tapTipped() || app.log.open('captives'),
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
      toastRead: (id, _e, t) => {
        const m = this.letters.get(+id);
        t.closest('.toast')?.remove();
        if (m) app.modal.message(m);
      },
      toast: (arg, _e, t) => {
        const [x, y] = arg.split(',').map(Number);
        if (!isNaN(x)) app.jumpTo(x, y);
        t.remove();
      },
    });
    // tooltips
    let tipText = '';
    const showTip = (this.showTip = (t: HTMLElement) => {
      this.tipFor = t;
      tipText = t.dataset.tip!;
      // a tip with figures worked out when it opens (rather than kept up to date on every refresh)
      const fn = t.dataset.tipfn;
      this.tip.innerHTML = (fn && this.tipContent(fn)) || tipText;
      this.tipDrawn = performance.now();
      toggleClass(this.tip, 'parch', !!fn);
      this.tip.classList.remove('hidden');
      const r = t.getBoundingClientRect();
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 4) y = r.bottom + 8;
      x = Math.max(4, Math.min(innerWidth - tw - 4, x));
      // positioned with a transform: no layout pass for the move itself
      this.tip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    });
    document.addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch') return; // touch: tips open on a tap instead (below)
      const t = (ev.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!t) {
        this.tipFor = null;
        return toggleClass(this.tip, 'hidden', true);
      }
      // moving between children of the same tipped element: nothing to do (no re-layout)
      if (t === this.tipFor && t.dataset.tip === tipText && !this.tip.classList.contains('hidden')) return;
      showTip(t);
    });
    // on touch screens there is no hover: tapping something that only explains itself (an icon, a figure, a number,
    // an (i)) shows its tip for a few seconds; buttons keep their own labels and simply act
    let tipTimer = 0;
    document.addEventListener('pointerup', (ev) => {
      if (ev.pointerType !== 'touch') return;
      const target = ev.target as HTMLElement;
      const t = target?.closest?.('[data-tip]') as HTMLElement | null;
      const acts = target?.closest?.('button, a, input, select, label, summary, [data-act]');
      clearTimeout(tipTimer);
      // a tap-first control (the top bar's pirates and captives): the first tap shows its tip, a second one acts
      if (t?.classList.contains('tipfirst')) {
        const open = t === this.tipFor && !this.tip.classList.contains('hidden');
        if (open) {
          this.tipFor = null;
          return toggleClass(this.tip, 'hidden', true);
        }
        this.tapTipAt = performance.now();
      } else if (!t || (acts && !t.classList.contains('tipi'))) {
        this.tipFor = null;
        return toggleClass(this.tip, 'hidden', true);
      }
      showTip(t);
      tipTimer = window.setTimeout(() => toggleClass(this.tip, 'hidden', true), 3500);
    });
  }

  show(on: boolean): void {
    for (const e of [this.top, this.bar, this.ticker, this.clock, this.undoBtn]) e.classList.toggle('hidden', !on);
    if (on) setTimeout(() => this.update(), 0);
    this.minimap.show(on);
    if (!on) {
      this.adv.classList.add('gone');
      this.hint.classList.add('hidden');
      clearTimeout(this.hintTimer);
      this.hintTimer = 0;
    }
    // in play the speaker joins the clock's speed row; on the title screen it goes back to its corner
    const sb = this.app.root.querySelector('.soundbtn');
    if (sb) (on ? this.clock.querySelector('.speedrow')! : this.app.root).appendChild(sb);
  }

  private buildToolbar(): void {
    // four books on the bar, each opening the one place for its kind of work; undo floats beside it
    const tools: [string, string, string, string, string][] = [
      ['build', 'hammer', 'Build', 'B', '<b>Build</b><br>Buildings, roads, clearing and demolition.'],
      ['views', 'eye', 'Views', 'O · M', '<b>Map views</b><br>Tint the ground (order, fear, soil…) or open the sea chart.'],
      ['island', 'book', 'Island', 'L · X', '<b>Island</b><br>The island log and your royal edicts.'],
      ['menu', 'wheel', 'Menu', 'Esc', '<b>Game menu</b><br>Save, load and settings.'],
    ];
    setHTML(this.bar, html`
      ${tools.map(([id, ic, label, k, tip]) => html`<button class="tool" data-act="tool:${id}" data-tool="${id}" data-tip="${tip} <i>(${k})</i>" aria-label="${label}">${icon(ic, 26)}<span class="lbl">${label}</span></button>`)}
`);
    this.undoBtn = el('button', 'undobtn hidden gone', this.app.root);
    this.undoBtn.dataset.act = 'undo';
    setHTML(this.undoBtn, html`<span class="seal">${icon('undo', 22)}</span><span class="cap"><b>Undo</b><span class="what"></span></span>`);
    delegate(this.undoBtn, { undo: () => this.app.undo() }, () => audio.sfx('ui_click'));
    this.undoBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    // the clock: one big face that pauses and resumes (date beneath a "Paused" ribbon), the speeds beside it
    setHTML(this.clock, html`
      <button class="clockface" data-act="pause" aria-label="Pause or resume" data-tip="<b>Pause / resume</b> <i>(Space)</i>">
        <span class="pp">${icon('pause', 20, 'i-pause')}${icon('play', 20, 'i-play')}</span>
        <span class="date"><span class="dv"></span><small class="dl"></small></span>
        <span class="ribbon">Paused</span>
      </button>
      <div class="speedrow">
        <div class="seg speed" role="radiogroup" aria-label="Game speed">${[1, 2, 4, 8].map((v, i) => html`<button class="sp" data-act="speed:${v}" role="radio" aria-checked="false" data-tip="${['Normal speed', 'Fast', 'Faster', 'Fastest'][i]} <i>(${i + 1})</i>">${v}×</button>`)}</div>
      </div>`);
    delegate(this.clock, {
      pause: () => {
        const g = this.app.game;
        g.paused = !g.paused;
        this.updateSpeed();
      },
      speed: (v) => {
        const g = this.app.game;
        g.speed = +v;
        g.paused = false;
        this.updateSpeed();
      },
    }, () => audio.sfx('ui_click'));
    delegate(this.bar, {
      tool: (id) => {
        const a = this.app;
        audio.sfx('ui_click');
        if (id === 'build') {
          if (a.touchMode) a.select(null);
          return a.build.toggle();
        }
        if (id === 'views') return a.overlays.visible || a.chart.visible ? a.closeAll() : a.overlays.show(false);
        if (id === 'island') {
          if (a.log.visible || a.edicts.visible) return a.closeAll();
          return this.islandBook === 'edicts' ? a.edicts.show() : a.log.show();
        }
        if (id === 'menu') return a.modal.gameMenu();
      },
    });
  }

  /** which of the island's two books the Island button opens: the one used last */
  islandBook: 'log' | 'edicts' = 'log';
  private undoBtn!: HTMLElement;

  updateTool(): void {
    const k = this.app.tool.kind;
    for (const t of this.bar.querySelectorAll<HTMLElement>('.tool')) {
      const id = t.dataset.tool!;
      const a = this.app;
      const on = (id === 'build' && (a.build?.visible || k === 'build' || k === 'road' || k === 'clear' || k === 'demolish' || k === 'unroad')) ||
        (id === 'views' && (a.overlays?.visible || a.chart?.visible)) || (id === 'island' && (a.edicts?.visible || a.log?.visible));
      t.classList.toggle('on', !!on);
    }
    const hints: Record<string, string> = {
      road: 'Drag to lay a road. Right-click to stop.',
      clear: 'Drag over trees to clear them. Right-click to stop.',
      demolish: 'Click a building or a road to tear it down. Right-click to stop.',
      build: 'Click to place. R rotates, Shift keeps placing, right-click cancels.',
    };
    const touchHints: Record<string, string> = {
      road: 'Drag along the ground, then tap the tick to lay the road.',
      clear: 'Drag a finger over trees to fell them. Two fingers move the map.',
      demolish: 'Tap a building or a road to tear it down.',
      build: 'Tap the ground to move the building, then confirm.',
    };
    // the build drawer covers the hint's place: the tool's hint waits until the drawer closes
    if (this.app.build?.visible) {
      clearTimeout(this.hintTimer);
      this.hintTimer = 0;
      this.touchHintFor = '';
      this.hint.classList.add('hidden');
      return;
    }
    const h = hints[k];
    if (!h) this.touchHintFor = '';
    // on touch the hint is a short reminder, once per tool; the controls beside the ghost do the explaining after that
    if (h && this.app.touchMode) {
      if (this.touchHintFor !== k) this.flash(touchHints[k] ?? h, 4);
      this.touchHintFor = k;
    } else if (h) this.flash(h, 0);
    else if (this.hintTimer === 0) this.hint.classList.add('hidden');
  }

  updateSpeed(): void {
    const g = this.app.game;
    if (!g) return;
    toggleClass(this.clock, 'paused', g.paused);
    for (const s of this.clock.querySelectorAll<HTMLElement>('.sp')) {
      const on = g.speed === +s.dataset.act!.split(':')[1];
      toggleClass(s, 'on', on);
      setAttr(s, 'aria-checked', on ? 'true' : 'false');
    }
    const face = this.clock.querySelector('.clockface') as HTMLElement;
    setAttr(face, 'aria-label', g.paused ? 'Resume the game' : 'Pause the game');
    setAttr(face, 'data-tip', g.paused ? '<b>Paused</b><br>Tap to resume. <i>(Space)</i>' : `<b>Running at ${g.speed}×</b><br>Tap to pause. <i>(Space)</i>`);
  }

  /**
   * One-time notice when the browser draws the game without graphics acceleration (a software rasteriser):
   * explains why everything crawls and how to turn the GPU back on. Dismissed for good with "Understood".
   */
  gpuNotice(renderer: string): void {
    try {
      if (localStorage.getItem('bc_gpu_notice') === renderer) return;
    } catch {
      /* ignore */
    }
    const p = el('div', 'panel gpu-notice', this.app.root);
    setHTML(p, html`<button class="close" data-act="ok" aria-label="Close">${icon('close', 14)}</button>
      <div class="seal" aria-hidden="true">${icon('wheel', 24)}</div>
      <h2>The Ship Sails Without Her Rigging</h2>
      <p>Your browser is drawing this island <b>without graphics acceleration</b>: every timber and wave is painted by hand on the
      CPU, so the game will crawl. We have struck the lesser sails (lowest graphics) to keep her moving.</p>
      <h4 class="eng">To set it right</h4>
      <ol class="steps"><li><b>Chrome or Edge:</b> <i>Settings &rsaquo; System</i>, turn on <i>&ldquo;Use graphics acceleration when available&rdquo;</i>, then relaunch the browser.</li>
      <li><b>Firefox:</b> <i>Settings &rsaquo; General &rsaquo; Performance</i>, untick &ldquo;Use recommended&rdquo; and tick &ldquo;Use hardware acceleration when available&rdquo;.</li>
      <li>Still crawling? Check <i>chrome://gpu</i>.</li></ol>
      <div class="rend"><span>Renderer reported</span><code>${renderer}</code></div>
      <div class="row"><button class="btn primary" data-act="ok">Understood</button></div>`);
    delegate(p, {
      ok: () => {
        try {
          localStorage.setItem('bc_gpu_notice', renderer);
        } catch {
          /* ignore */
        }
        p.remove();
      },
    });
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

  /** the click after a touch that opened a tap-first tip: swallowed, so the first tap only explains */
  private tapTipped(): boolean {
    const t = this.tapTipAt;
    this.tapTipAt = 0;
    return performance.now() - t < 800;
  }

  /** html for a `data-tipfn` tip, worked out as it opens */
  private tipContent(fn: string): string {
    const [kind, arg] = fn.split(':');
    if (kind !== 'wf' || (arg !== 'pirate' && arg !== 'captive')) return '';
    const g = this.app.game;
    if (this.wf?.t !== g.time) this.wf = { t: g.time, v: workforce(g) };
    return workforceTip(arg, this.wf.v[arg]);
  }

  /** top-bar elements, built once; update() only touches text and attributes that changed */
  private topEls: Record<string, HTMLElement> | null = null;

  private buildTop(): Record<string, HTMLElement> {
    setHTML(this.top, html`
      <div class="res" data-act="gold">${icon('coin', 24)}<div><div class="v" data-k="gold"></div><small>treasury</small></div></div>
      <div class="res" data-tip="<b>Lumber</b><br>Total stored at your sawmills.">${icon('lumber', 24)}<div><div class="v" data-k="lumber"></div><small>lumber</small></div></div>
      <div class="res" data-act="hoard">${icon('chest', 24)}<div><div class="v" data-k="hoard"></div><small>hoard</small></div></div>
      <div class="res tipfirst" data-act="pirates" data-tip="<b>Pirates</b>" data-tipfn="wf:pirate">${icon('pirate', 22)}<div><div class="v" data-k="pirates"></div><small>pirates</small></div></div>
      <div class="res tipfirst" data-act="captives" data-tip="<b>Captives</b>" data-tipfn="wf:captive">${icon('captive', 22)}<div><div class="v" data-k="captives"></div><small>captives</small></div></div>
      <div class="mood" data-act="mood">
        <label>Happiness</label><div class="m hp"><div data-k="hap"></div></div>
        <label>Resignation</label><div class="m rs"><div data-k="res"></div></div>
      </div>`);
    const q = (sel: string) => this.top.querySelector(sel) as HTMLElement;
    const els: Record<string, HTMLElement> = {
      goldRes: q('[data-act="gold"]'), hoardRes: q('[data-act="hoard"]'), mood: q('.mood'),
      dv: this.clock.querySelector('.dv') as HTMLElement, dl: this.clock.querySelector('.dl') as HTMLElement,
      undo: this.undoBtn, undoWhat: this.undoBtn.querySelector('.what') as HTMLElement,
    };
    for (const e of this.top.querySelectorAll<HTMLElement>('[data-k]')) els[e.dataset.k!] = e;
    return els;
  }

  update(): void {
    const g = this.app.game;
    const e = (this.topEls ??= this.buildTop());
    let pirates = 0, hapSum = 0, captives = 0, resSum = 0, resN = 0;
    for (const p of g.people.values()) {
      if (p.task.kind === 'dead') continue;
      if (p.kind === 'pirate') {
        pirates++;
        hapSum += p.happiness;
      } else if (p.kind === 'captive') {
        captives++;
        resSum += p.resignation;
        resN++;
      }
    }
    // same figures as g.avgHappiness() / g.avgResignation(), in one pass over the people
    const hap = pirates ? hapSum / pirates : 0, res = resN ? resSum / resN : 0;
    let inc = 0, exp = 0;
    for (const k in g.finance.lastIncome) inc += g.finance.lastIncome[k];
    for (const k in g.finance.lastExpense) exp += g.finance.lastExpense[k];
    toggleClass(e.goldRes, 'neg', g.treasury < 0);
    setAttr(e.goldRes, 'data-tip', `<b>Treasury</b><br>Last month: +${fmt(inc)} / -${fmt(exp)}`);
    setText(e.gold, fmt(g.treasury));
    setText(e.lumber, fmt(g.lumber()));
    setAttr(e.hoardRes, 'data-tip', `<b>Your Hoard</b><br>${g.buildingCount('cave') ? `${Math.round(g.hoardRate * 100)}% of all income is skimmed into your Pirate Cave. This is your score.` : 'Build a Pirate Cave to start your personal hoard.'}`);
    setText(e.hoard, fmt(g.hoard));
    // an open workforce tip follows the island about once a second while the game runs
    const tf = this.tipFor;
    if (tf?.dataset.tipfn && !this.tip.classList.contains('hidden') && performance.now() - this.tipDrawn > 1000 && this.wf?.t !== g.time) this.showTip(tf);
    setText(e.pirates, String(pirates));
    setText(e.captives, String(captives));
    setAttr(e.mood, 'data-tip', `<b>Pirate Happiness</b> ${Math.round(hap * 100)}%<br><b>Captive Resignation</b> ${Math.round(res * 100)}%`);
    setStyle(e.hap, 'width', `${(hap * 100).toFixed(0)}%`);
    setStyle(e.res, 'width', `${(res * 100).toFixed(0)}%`);
    setText(e.dv, g.date);
    const left = Math.max(0, g.settings.years - g.yearsElapsed);
    setText(e.dl, g.over ? 'reign over' : `${left.toFixed(1)} years left`);
    const ul = undoLabel(g);
    toggleClass(e.undo, 'gone', !ul);
    if (ul) {
      setText(e.undoWhat, ul);
      setAttr(e.undo, 'data-tip', `<b>Undo</b><br>Take back: ${esc(ul)} <i>(${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘Z' : 'Ctrl+Z'})</i>`);
      setAttr(e.undo, 'aria-label', `Undo: ${ul}`);
    }
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

  /** toasts too long to show whole, by id, for "Read on" (pruned with the toasts) */
  private letters = new Map<number, Message>();
  private letterSeq = 0;

  private toast(m: Message): void {
    const t = el('div', `toast ${m.kind}`, this.ticker);
    t.dataset.act = `toast:${m.focus ? `${m.focus.x},${m.focus.y}` : ''}`;
    const ic = m.kind === 'ship' ? 'ship' : m.kind === 'bad' ? 'skull' : m.kind === 'good' ? 'coin' : m.kind === 'alert' ? 'bell' : 'info';
    // a long letter is clipped to a few lines: "Read on" unfolds the whole of it
    const strip = letterStrip(m, false);
    const long = !!strip || m.text.length > 84 || m.text.includes('\n');
    if (long) this.letters.set(++this.letterSeq, m);
    setHTML(t, html`${icon(ic, 22)}<div><b>${m.title}</b>${strip ? html`<div class="vcompact" data-tip="${m.text.split('\n')[0]}">${strip}</div>` : html`<span class="tx">${m.text.split('\n')[0]}</span>`}${long ? html`<button class="readon" data-act="toastRead:${this.letterSeq}">Read on…</button>` : ''}</div>`);
    while (this.ticker.children.length > 5) this.ticker.firstElementChild!.remove();
    setTimeout(() => t.remove(), 12000);
    for (const k of this.letters.keys()) if (k < this.letterSeq - 8) this.letters.delete(k);
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
        <div class="row">${m.focus ? html`<button class="btn ghost small" data-act="advGo:${m.focus.x},${m.focus.y}">${icon('eye', 14)} Show me</button>` : ''}<button class="btn primary small" data-act="advClose">Aye</button></div>
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
