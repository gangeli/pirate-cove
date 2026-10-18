import type { App } from './app';
import { el, html, setHTML, delegate, fmt, raw } from './dom';
import { icon } from './icons';
import type { Message } from '../sim/types';
import { audio } from '../audio/audio';
import { listSaves } from './saves';
import { portrait, BARNABY } from './portraits';
import { SKINS, installTheme, type Skin } from './theme';

export class Modal {
  private wrap: HTMLElement;
  private box: HTMLElement;
  open = false;
  pausing = false;
  private queue: (() => void)[] = [];
  private handlers: Record<string, (a: string) => void> = {};

  constructor(private app: App) {
    this.wrap = el('div', 'modal-wrap hidden', app.root);
    this.box = el('div', 'panel modal', this.wrap);
    delegate(this.box, {
      do: (a) => this.handlers[a]?.(a),
      close: () => this.close(),
    }, () => audio.sfx('ui_click'));
  }

  private show(content: ReturnType<typeof html>, handlers: Record<string, (a: string) => void>, pause = true): void {
    if (this.open) {
      this.queue.push(() => this.show(content, handlers, pause));
      return;
    }
    this.open = true;
    this.pausing = pause;
    this.handlers = handlers;
    setHTML(this.box, content);
    this.wrap.classList.remove('hidden');
    audio.sfx('parchment');
  }

  close(): void {
    this.open = false;
    this.pausing = false;
    this.wrap.classList.add('hidden');
    const next = this.queue.shift();
    if (next) setTimeout(next, 150);
  }

  message(m: Message): void {
    const focus = m.focus;
    const lines = m.text.split('\n\n');
    this.show(html`<div class="seal">${icon(m.kind === 'ship' ? 'ship' : m.kind === 'bad' || m.kind === 'alert' ? 'skull' : 'coin', 30)}</div>
      <h2>${m.title}</h2><div class="sub">${m.date}</div>
      <div class="body">${lines[0]}${lines.length > 1 ? html`<hr class="rule"><div style="font-size:14px;color:#4a3018">${lines.slice(1).join('\n\n')}</div>` : ''}</div>
      <div class="row">${focus ? html`<button class="btn" data-act="do:go">Show me</button>` : ''}<button class="btn green" data-act="do:ok">Aye!</button></div>`, {
      ok: () => this.close(),
      go: () => {
        this.close();
        if (focus) this.app.jumpTo(focus.x, focus.y);
      },
    });
    if (m.voice) audio.voice(m.voice);
  }

  confirm(title: string, text: string, yes: () => void): void {
    this.show(html`<h2>${title}</h2><div class="body">${text}</div><div class="row"><button class="btn" data-act="do:no">No</button><button class="btn red" data-act="do:yes">Yes</button></div>`, {
      yes: () => {
        this.close();
        yes();
      },
      no: () => this.close(),
    });
  }

  gameMenu(): void {
    this.show(html`<h2>Captain's Quarters</h2><div class="sub">The game is paused.</div><hr class="rule">
      <div style="display:flex;flex-direction:column;gap:8px;margin:10px 0">
        <button class="btn" data-act="do:resume">Resume</button>
        <button class="btn" data-act="do:save">Save Game</button>
        <button class="btn" data-act="do:load">Load Game</button>
        <button class="btn" data-act="do:settings">Settings</button>
        <button class="btn" data-act="do:help">How to Play</button>
        <button class="btn red" data-act="do:quit">Quit to Main Menu</button>
      </div>`, {
      resume: () => this.close(),
      save: () => {
        this.close();
        this.saveDialog();
      },
      load: () => {
        this.close();
        this.loadDialog();
      },
      settings: () => {
        this.close();
        this.settings();
      },
      help: () => {
        this.close();
        this.help();
      },
      quit: () => {
        this.close();
        this.confirm('Abandon your island?', 'Unsaved progress will be lost (an autosave is kept).', () => this.app.quitToMenu());
      },
    });
  }

  async saveDialog(): Promise<void> {
    const saves = await listSaves();
    const slots = ['slot1', 'slot2', 'slot3', 'slot4'];
    this.show(html`<h2>Save Game</h2><div style="display:flex;flex-direction:column;gap:6px;margin:10px 0">
      ${slots.map((s, i) => {
        const m = saves.find((x) => x.slot === s);
        return html`<button class="btn" data-act="do:${s}">Slot ${i + 1}: ${m ? `${m.king}, ${m.date}` : 'empty'}</button>`;
      })}</div><div class="row"><button class="btn" data-act="do:cancel">Cancel</button></div>`, {
      ...Object.fromEntries(slots.map((s) => [s, async () => {
        this.close();
        await this.app.save(s);
        this.app.hud.flash('Game saved.');
      }])),
      cancel: () => this.close(),
    });
  }

  async loadDialog(fromMenu = false): Promise<void> {
    const saves = await listSaves();
    this.show(html`<h2>Load Game</h2><div style="display:flex;flex-direction:column;gap:6px;margin:10px 0;max-height:50vh;overflow:auto">
      ${saves.length ? saves.map((m) => html`<button class="btn" data-act="do:${m.slot}">${m.slot === 'auto' ? 'Autosave' : m.slot === 'quick' ? 'Quicksave' : m.slot.replace('slot', 'Slot ')}: ${m.king}, ${m.date}<small style="opacity:.7"> (${new Date(m.savedAt).toLocaleString()})</small></button>`) : html`<div class="sub">No saved games yet.</div>`}
      </div><div class="row"><button class="btn" data-act="do:cancel">Cancel</button></div>`, {
      ...Object.fromEntries(saves.map((m) => [m.slot, async () => {
        this.close();
        await this.app.continueGame(m.slot);
      }])),
      cancel: () => this.close(),
    }, !fromMenu);
  }

  settings(): void {
    const a = audio.vol;
    const q = this.app.quality;
    const adv = this.app.hud.advisorMode;
    const slider = (k: keyof typeof a, label: string) => html`<label style="display:grid;grid-template-columns:110px 1fr;align-items:center;gap:8px">${label}<input type="range" min="0" max="1" step="0.05" value="${a[k]}" data-vol="${k}"></label>`;
    this.show(html`<h2>Settings</h2><hr class="rule">
      <h3>Sound</h3>${slider('master', 'Master')}${slider('music', 'Music')}${slider('voice', 'Voices')}${slider('sfx', 'Effects')}${slider('ambient', 'Ambience')}
      <h3>Graphics</h3><div class="row">${(['low', 'medium', 'high'] as const).map((x) => html`<button class="btn small ${q === x ? 'on' : ''}" data-act="do:q_${x}">${x[0].toUpperCase() + x.slice(1)}</button>`)}<span class="sub">(applies after reload)</span></div>
      <h3>Interface</h3><div class="row">${(Object.keys(SKINS) as Skin[]).map((x) => html`<button class="btn small ${document.documentElement.dataset.skin === x ? 'on' : ''}" data-act="do:s_${x}">${SKINS[x]}</button>`)}</div>
      <h3>Advisor</h3><div class="row">${(['full', 'brief', 'off'] as const).map((x) => html`<button class="btn small ${adv === x ? 'on' : ''}" data-act="do:a_${x}">${x === 'full' ? 'Chatty' : x === 'brief' ? 'Brief' : 'Silent'}</button>`)}</div>
      <h3>Camera</h3><label><input type="checkbox" data-edge ${this.app.world.rig.edgeScroll ? 'checked' : ''}> Scroll at the screen edges</label>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn green" data-act="do:done">Done</button></div>`, {
      done: () => this.close(),
      q_low: () => this.setQuality('low'),
      q_medium: () => this.setQuality('medium'),
      q_high: () => this.setQuality('high'),
      a_full: () => this.setAdvisor('full'),
      a_brief: () => this.setAdvisor('brief'),
      a_off: () => this.setAdvisor('off'),
      ...Object.fromEntries((Object.keys(SKINS) as Skin[]).map((x) => [`s_${x}`, () => this.setSkin(x)])),
    });
    for (const inp of this.box.querySelectorAll<HTMLInputElement>('[data-vol]')) {
      inp.oninput = () => {
        (audio.vol as any)[inp.dataset.vol!] = +inp.value;
        audio.applyVolumes();
      };
    }
    const edge = this.box.querySelector<HTMLInputElement>('[data-edge]');
    if (edge) edge.onchange = () => (this.app.world.rig.edgeScroll = edge.checked);
  }

  private setQuality(q: 'low' | 'medium' | 'high'): void {
    this.app.quality = q;
    try {
      localStorage.setItem('bc_quality', q);
    } catch {
      /* ignore */
    }
    this.close();
    this.settings();
  }
  private setSkin(s: Skin): void {
    try {
      localStorage.setItem('bc_skin', s);
    } catch {
      /* ignore */
    }
    installTheme(s);
    this.close();
    this.settings();
  }
  private setAdvisor(m: 'full' | 'brief' | 'off'): void {
    this.app.hud.advisorMode = m;
    try {
      localStorage.setItem('bc_advisor', m);
    } catch {
      /* ignore */
    }
    this.close();
    this.settings();
  }

  help(): void {
    this.show(html`<div style="display:flex;gap:12px;align-items:center">${raw(portrait(BARNABY, 72))}<div><h2>How to Rule</h2><div class="sub">A word from Barnaby</div></div></div><div class="body" style="font-size:15px">
<b>The reverse economy.</b> Your island makes no money by itself. Gold comes from <b>plunder</b>: send ships out on cruises from the Sea Chart (M). When they return, the crew takes its share. Pirates then spend that share in your taverns, dives, brothels and gambling dens, and the fees flow back into your treasury.

<b>Pirates</b> want food, grog, company, gambling, a bed and somewhere to stash their gold. They also like <b>anarchy</b> and feel safer with <b>defense</b>. If most of them are miserable, they will overthrow you.

<b>Captives</b> do all the work. Feed them slop from chuck tents, give them beds and keep them cowed with <b>fear</b> and <b>order</b>, or they'll run for the beach and tell the Great Powers where you are.

<b>Lumber</b> builds everything: keep the timber camp beside thick jungle and the sawmill staffed. <b>Skilled captives</b>, taken in raids or kidnapped, unlock advanced buildings.

<b>Your hoard</b> is your score. Build a Pirate Cave and a share of all income is skimmed into it.

<b>Controls:</b> WASD or arrow keys pan, mouse wheel zooms, Q/E rotate, right-drag pans. B build, R rotate a building, O overlays, X edicts, M sea chart, L island log, F follow the selection, Space pause, 1-4 speed, Backspace cycles through disgruntled pirates, F5 quicksave.</div>
<div class="row"><button class="btn green" data-act="do:ok">Got it</button></div>`, { ok: () => this.close() });
  }

  gameOver(): void {
    const g = this.app.game;
    const o = g.over!;
    const s = o.score;
    const medal = s.medal === 'gold' ? '🥇' : s.medal === 'silver' ? '🥈' : '🥉';
    this.show(html`<div class="gameover"><h2>${o.win ? 'Your Reign Is Complete' : 'Your Reign Has Ended'}</h2>
      <p>${o.reason}</p>
      ${o.win ? html`<div class="medal">${medal}</div><h3>${s.medal[0].toUpperCase() + s.medal.slice(1)} Medal</h3>` : ''}
      <table class="ledger" style="max-width:380px;margin:8px auto">
        <tr><td>Hoard</td><td>${fmt(s.hoard)}</td></tr><tr><td>Pirate happiness</td><td>${fmt(s.happiness)}</td></tr>
        <tr><td>Fleet</td><td>${fmt(s.fleet)}</td></tr><tr><td>Captains</td><td>${fmt(s.captains)}</td></tr><tr><td>Pirates</td><td>${fmt(s.pirates)}</td></tr>
        <tr><td>Bonus objective (${s.bonusKey})</td><td>×3</td></tr><tr><td>Difficulty</td><td>${Math.round(s.difficulty * 100)}%</td></tr>
        <tr><td><b>Final score</b></td><td><b>${fmt(s.total)}</b></td></tr>
      </table></div>
      <div class="row">${o.win ? html`<button class="btn" data-act="do:cont">Keep playing</button>` : ''}<button class="btn green" data-act="do:menu">Main Menu</button></div>`, {
      cont: () => {
        g.over = null;
        g.settings.years = 999;
        this.close();
      },
      menu: () => {
        this.close();
        this.app.quitToMenu();
      },
    });
  }
}
