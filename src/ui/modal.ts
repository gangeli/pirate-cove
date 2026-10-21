import type { App } from './app';
import { recordProfile } from './profiler';
import { el, html, setHTML, delegate, fmt, raw } from './dom';
import { icon } from './icons';
import type { Message } from '../sim/types';
import { audio } from '../audio/audio';
import { listSaves } from './saves';
import { portraitImg } from './portraits';
import { voyageStrip, letterStrip, useThumbs, scoreBars } from './tally';
import { thumbOrQueue } from './thumbs';
import { setBackendPreference } from '../render/backend';

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
    // letters show finished buildings as their thumbnails, swapped in when a thumbnail is first drawn
    useThumbs((id) => thumbOrQueue(app.world, id, (tid, url) => {
      for (const n of document.querySelectorAll<HTMLElement>(`[data-lthumb="${tid}"]`)) {
        if (n instanceof HTMLImageElement) n.src = url;
        else n.outerHTML = `<img class="bthumb" src="${url}" data-lthumb="${tid}" alt="">`;
      }
    }));
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
    const strip = letterStrip(m);
    this.show(html`<div class="seal">${icon(m.kind === 'ship' ? 'ship' : m.kind === 'bad' || m.kind === 'alert' ? 'skull' : 'coin', 30)}</div>
      <h2>${m.title}</h2><div class="sub">${m.date}</div>
      ${m.data?.kind === 'voyage'
        ? html`<div class="body letter-v"><div class="lede">Back from her ${m.data.mission}.</div>${voyageStrip(m.data)}</div>`
        : strip
          ? html`<div class="body letter-v">${strip}<div class="lede after">${lines.join(' ')}</div></div>`
          : html`<div class="body">${lines[0]}${lines.length > 1 ? html`<hr class="rule"><div style="font-size:14px;color:#4a3018">${lines.slice(1).join('\n\n')}</div>` : ''}</div>`}
      <div class="row">${focus ? html`<button class="btn ghost" data-act="do:go">${icon('eye', 15)} Show me</button>` : ''}<button class="btn primary" data-act="do:ok">Aye!</button></div>`, {
      ok: () => this.close(),
      go: () => {
        this.close();
        if (focus) this.app.jumpTo(focus.x, focus.y);
      },
    });
    if (m.voice) audio.voice(m.voice);
  }

  confirm(title: string, text: string, yes: () => void): void {
    this.show(html`<h2>${title}</h2><div class="body">${text}</div><div class="row"><button class="btn ghost" data-act="do:no">Keep it</button><button class="btn danger" data-act="do:yes">Yes, do it</button></div>`, {
      yes: () => {
        this.close();
        yes();
      },
      no: () => this.close(),
    });
  }

  /** ask for a line of text on parchment (instead of the browser's prompt box) */
  prompt(title: string, label: string, value: string, done: (v: string) => void): void {
    const ok = () => {
      const v = this.box.querySelector<HTMLInputElement>('input[data-prompt]')?.value.trim() ?? '';
      this.close();
      if (v) done(v.slice(0, 40));
    };
    this.show(html`<h2>${title}</h2><label class="field-text"><span>${label}</span><input type="text" data-prompt maxlength="40" value="${value}" autocomplete="off"></label>
      <div class="row"><button class="btn ghost" data-act="do:cancel">Cancel</button><button class="btn primary" data-act="do:ok">Done</button></div>`, { ok, cancel: () => this.close() });
    const inp = this.box.querySelector<HTMLInputElement>('input[data-prompt]');
    if (inp) {
      inp.focus();
      inp.select();
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') ok();
        if (e.key === 'Escape') this.close();
      };
    }
  }

  gameMenu(): void {
    this.show(html`<h2>Captain's Quarters</h2><div class="sub center">The island holds its breath while you are here.</div>
      <div class="menu-list">
        <button class="btn primary" data-act="do:resume">${icon('play', 15)} Resume</button>
        <button class="mrow" data-act="do:save">${icon('chest', 18)}<span>Save game<small>Four slots, plus the autosave</small></span></button>
        <button class="mrow" data-act="do:load">${icon('book', 18)}<span>Load game<small>Pick up an earlier reign</small></span></button>
        <button class="mrow" data-act="do:settings">${icon('gear', 18)}<span>Settings<small>Sound, graphics, advisor, camera</small></span></button>
        <button class="mrow" data-act="do:help">${icon('info', 18)}<span>How to play<small>Barnaby explains the island</small></span></button>
        <button class="mrow danger" data-act="do:quit">${icon('skull', 18)}<span>Quit to main menu<small>Unsaved progress is lost; the autosave is kept</small></span></button>
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
    this.show(html`<h2>Save Game</h2><div class="menu-list">
      ${slots.map((s, i) => {
        const m = saves.find((x) => x.slot === s);
        return html`<button class="mrow" data-act="do:${s}">${icon('chest', 18)}<span>Slot ${i + 1}<small>${m ? `${m.king}, ${m.date}` : 'Empty'}</small></span></button>`;
      })}</div><div class="row"><button class="btn ghost" data-act="do:cancel">Cancel</button></div>`, {
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
    this.show(html`<h2>Load Game</h2><div class="menu-list scroll" style="max-height:50vh">
      ${saves.length ? saves.map((m) => html`<button class="mrow" data-act="do:${m.slot}">${icon('book', 18)}<span>${m.slot === 'auto' ? 'Autosave' : m.slot === 'quick' ? 'Quicksave' : m.slot.replace('slot', 'Slot ')}: ${m.king}, ${m.date}<small>Saved ${new Date(m.savedAt).toLocaleString()}</small></span></button>`) : html`<div class="sub">No saved games yet.</div>`}
      </div><div class="row"><button class="btn ghost" data-act="do:cancel">Cancel</button></div>`, {
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
    const slider = (k: keyof typeof a, label: string, ic: string) => html`<label class="slider" data-tip="${label} volume"><span>${icon(ic, 16)} ${label}</span><input type="range" min="0" max="1" step="0.05" value="${a[k]}" data-vol="${k}" aria-label="${label} volume"><output>${Math.round(a[k] * 100)}%</output></label>`;
    const w = this.app.world;
    const rend = `<b>Renderer</b><br>${w.backend === 'webgpu' ? 'WebGPU (experimental)' : 'WebGL'} · ${w.gpu.renderer}${w.gpu.software ? ' (software, no graphics acceleration)' : ''}<br>Resolution ${Math.round(w.pr * 100)}%`;
    const seg = (items: [string, string, string, boolean][], aria: string) => html`<div class="seg full" role="radiogroup" aria-label="${aria}">${items.map(([act, label, tip, on]) => html`<button class="${on ? 'on' : ''}" data-act="do:${act}" role="radio" aria-checked="${on ? 'true' : 'false'}" data-tip="${tip}">${label}</button>`)}</div>`;
    this.show(html`<h2>Settings</h2><div class="body settings">
      <section class="sect"><h4 class="eng">${icon('speaker', 16)} Sound</h4>${slider('master', 'Master', 'speaker')}${slider('music', 'Music', 'bell')}${slider('voice', 'Voices', 'pirate')}${slider('sfx', 'Effects', 'g_cannon')}${slider('ambient', 'Ambience', 'sprout')}</section>
      <section class="sect"><h4 class="eng">${icon('eye', 16)} Graphics <span class="tipi" data-tip="${rend}" tabindex="0" aria-label="Renderer details">${icon('info', 14)}</span></h4>
        ${seg((['low', 'medium', 'high'] as const).map((x) => [`q_${x}`, x[0].toUpperCase() + x.slice(1), `<b>${x[0].toUpperCase() + x.slice(1)} detail</b>`, q === x]), 'Detail')}
        <div class="field-row"><span class="lbl" data-tip="Frame rate">${icon('fast', 15)}</span>${seg([['fps_0', 'Smooth', '<b>Smooth</b><br>The full frame rate', this.app.frameCap === 0], ['fps_30', '30 fps', '<b>Cool</b><br>30 frames a second: a quieter, cooler laptop', this.app.frameCap === 30]], 'Frame rate')}</div>
        <div class="row start set-row">${'gpu' in navigator ? html`<label class="check" data-tip="Experimental. Changing it reloads the game, so save first."><input type="checkbox" data-webgpu ${w.backend === 'webgpu' ? 'checked' : ''}><span>WebGPU</span></label>` : ''}
          <button class="btn nav small" data-act="do:profile" data-tip="<b>Record performance</b><br>Play normally for a minute, then copy the report.">${icon('gear', 14)} Record 60 s</button></div></section>
      <section class="sect"><h4 class="eng">${icon('quill', 16)} Advisor</h4>${seg([['a_full', 'Chatty', 'Barnaby speaks his mind in full.', adv === 'full'], ['a_brief', 'Brief', 'Barnaby keeps it to one line.', adv === 'brief'], ['a_off', 'Silent', 'Barnaby holds his tongue; important news still arrives as notes.', adv === 'off']], 'Advisor')}</section>
      <section class="sect"><h4 class="eng">${icon('compass', 16)} Camera</h4><label class="check" data-tip="Scroll the view when the pointer touches the screen edges"><input type="checkbox" data-edge ${w.rig.edgeScroll ? 'checked' : ''}><span>Edge scrolling</span></label></section></div>
      <div class="row"><button class="btn primary" data-act="do:done">Done</button></div>`, {
      done: () => this.close(),
      profile: () => {
        this.close();
        recordProfile(this.app, 60);
      },
      q_low: () => this.setQuality('low'),
      q_medium: () => this.setQuality('medium'),
      q_high: () => this.setQuality('high'),
      fps_0: () => (this.app.setFrameCap(0), this.close(), this.settings()),
      fps_30: () => (this.app.setFrameCap(30), this.close(), this.settings()),
      a_full: () => this.setAdvisor('full'),
      a_brief: () => this.setAdvisor('brief'),
      a_off: () => this.setAdvisor('off'),
    });
    for (const inp of this.box.querySelectorAll<HTMLInputElement>('[data-vol]')) {
      inp.oninput = () => {
        (audio.vol as any)[inp.dataset.vol!] = +inp.value;
        const o = inp.nextElementSibling;
        if (o) o.textContent = `${Math.round(+inp.value * 100)}%`;
        audio.applyVolumes();
      };
    }
    const edge = this.box.querySelector<HTMLInputElement>('[data-edge]');
    if (edge) edge.onchange = () => (this.app.world.rig.edgeScroll = edge.checked);
    const wgpu = this.box.querySelector<HTMLInputElement>('[data-webgpu]');
    if (wgpu) wgpu.onchange = () => setBackendPreference(wgpu.checked ? 'webgpu' : null);
  }

  private setQuality(q: 'low' | 'medium' | 'high'): void {
    this.app.quality = q;
    try {
      localStorage.setItem('bc_quality', q);
    } catch {
      /* ignore */
    }
    this.app.applyQuality();
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
    this.show(html`<div style="display:flex;gap:12px;align-items:center">${raw(portraitImg('barnaby', 64))}<div><h2>How to Rule</h2><div class="sub">A word from Barnaby</div></div></div><div class="body" style="font-size:15px">
<b>The reverse economy.</b> Your island makes no money by itself. Gold comes from <b>plunder</b>: send ships out on cruises from the Sea Chart (M). When they return, the crew takes its share. Pirates then spend that share in your taverns, dives, brothels and gambling dens, and the fees flow back into your treasury.

<b>Pirates</b> want food, grog, company, gambling, a bed and somewhere to stash their gold. They also like <b>anarchy</b> and feel safer with <b>defense</b>. If most of them are miserable, they will overthrow you.

<b>Captives</b> do all the work. Feed them slop from chuck tents, give them beds and keep them cowed with <b>fear</b> and <b>order</b>, or they'll run for the beach and tell the Great Powers where you are.

<b>Lumber</b> builds everything: keep the timber camp beside thick jungle and the sawmill staffed. <b>Skilled captives</b>, taken in raids or kidnapped, unlock advanced buildings.

<b>Your hoard</b> is your score. Build a Pirate Cave and a share of all income is skimmed into it.

<b>Controls:</b> WASD or arrow keys pan, mouse wheel zooms, Q/E rotate, right-drag pans. B build, R rotate a building, O map views ([ and ] step through the tints), X edicts, M sea chart, L island log, F follow the selection, Space pause, 1-4 speed, Backspace cycles through disgruntled pirates, F5 quicksave.</div>
<div class="row"><button class="btn primary" data-act="do:ok">Got it</button></div>`, { ok: () => this.close() });
  }

  gameOver(): void {
    const g = this.app.game;
    const o = g.over!;
    const s = o.score;
    this.show(html`<div class="gameover"><h2>${o.win ? 'Your Reign Is Complete' : 'Your Reign Has Ended'}</h2>
      <p class="reason">${o.reason}</p>
      ${o.win ? html`<div class="medal-wrap"><div class="medal ${s.medal}" role="img" aria-label="${s.medal} medal"><span>${s.medal[0].toUpperCase() + s.medal.slice(1)}</span></div></div>` : ''}
      <div class="score">${scoreBars(s)}</div></div>
      <div class="row">${o.win ? html`<button class="btn ghost" data-act="do:cont">Keep playing</button>` : ''}<button class="btn primary" data-act="do:menu">Main menu</button></div>`, {
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
