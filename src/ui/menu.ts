import type { App } from './app';
import { el, html, setHTML, delegate, raw } from './dom';
import { icon } from './icons';
import { KINGS, BACKGROUNDS, QUALITIES, FLAWS, NATION_ADJ, type KingDef, type Background, type Quality, type Flaw } from '../sim/data/kings';
import { portrait, KING_LOOKS } from './portraits';
import type { Settings } from '../sim/types';
import { audio } from '../audio/audio';
import credits from '../credits.json';

const REGION_NAMES = ['Gulf of Mexico', 'Bay of Campeche', 'Yucatán Channel', 'Florida Straits', 'The Bahamas', 'Cayman Deep', 'Windward Passage', 'Tortuga Waters', 'Jamaica Channel', 'Mona Passage', 'Virgin Islands', 'Leeward Islands', 'Windward Islands', 'Spanish Main', 'Curaçao Banks', 'Cartagena Roads', 'Darién Gap', 'Mosquito Coast'];

export class MainMenu {
  private root: HTMLElement;
  private setup: HTMLElement;
  private credits: HTMLElement;
  private s: Partial<Settings> = { size: 'medium', mountains: 0.5, vegetation: 0.5, minerals: 0.5, years: 20, stability: 2, advantage: 'standard', bonus: 'hoard', region: 6, startGold: 2500 };
  private king: KingDef = KINGS[2];
  private custom = false;
  private tab: 'island' | 'conditions' | 'king' = 'island';

  constructor(private app: App) {
    this.root = el('div', 'menu hidden', app.root);
    this.setup = el('div', 'panel setup hidden', app.root);
    this.credits = el('div', 'panel credits hidden', app.root);
    delegate(this.root, {
      new: () => this.openSetup(),
      cont: () => app.continueGame('auto'),
      load: () => app.modal.loadDialog(true),
      settings: () => app.modal.settings(),
      help: () => app.modal.help(),
      credits: () => this.openCredits(),
    }, () => {
      audio.unlock();
      audio.sfx('ui_click');
    });
    delegate(this.setup, {
      close: () => this.setup.classList.add('hidden'),
      tab: (t) => {
        this.tab = t as any;
        this.renderSetup();
      },
      opt: (a) => {
        const [k, v] = a.split('=');
        (this.s as any)[k] = isNaN(+v) ? v : +v;
        this.renderSetup();
      },
      king: (id) => {
        const k = KINGS.find((x) => x.id === id)!;
        this.king = { ...k, q: [...k.q] as [Quality, Quality] };
        this.renderSetup();
      },
      bg: (b) => {
        this.king = { ...this.king, bg: b as Background };
        this.renderSetup();
      },
      q: (a) => {
        const [i, q] = a.split('=');
        const qs = [...this.king.q] as [Quality, Quality];
        qs[+i] = q as Quality;
        if (qs[0] !== qs[1]) this.king = { ...this.king, q: qs };
        this.renderSetup();
      },
      flaw: (f) => {
        this.king = { ...this.king, flaw: f as Flaw };
        this.renderSetup();
      },
      custom: () => {
        this.custom = !this.custom;
        this.renderSetup();
      },
      seed: () => {
        this.s.seed = Math.floor(Math.random() * 1e6);
        this.renderSetup();
      },
      start: () => {
        this.setup.classList.add('hidden');
        const s = { ...this.s, seed: this.s.seed ?? Math.floor(Math.random() * 1e6) };
        app.newGame(s, this.king);
      },
    }, () => audio.sfx('ui_click'));
    delegate(this.credits, { close: () => this.credits.classList.add('hidden') }, () => audio.sfx('ui_click'));
  }

  async show(): Promise<void> {
    const has = await this.app.hasSave('auto');
    setHTML(this.root, html`<div class="titleblock"><div class="title">Buccaneer<br>Cove</div><div class="tag">Rule an island of rogues. Plunder the Caribbean. Die rich.</div>
      <div class="items">
        <button class="item" data-act="new">New Game</button>
        <button class="item ${has ? '' : 'disabled'}" data-act="${has ? 'cont' : ''}">Continue</button>
        <button class="item" data-act="load">Load Game</button>
        <button class="item" data-act="help">How to Play</button>
        <button class="item" data-act="settings">Settings</button>
        <button class="item" data-act="credits">Credits</button>
      </div></div>
      <div class="foot">A tribute to the pirate island builders of old. Click anywhere to enable sound.</div>`);
    this.root.classList.remove('hidden');
  }
  hide(): void {
    this.root.classList.add('hidden');
    this.setup.classList.add('hidden');
    this.credits.classList.add('hidden');
  }

  private openSetup(): void {
    this.s.seed = Math.floor(Math.random() * 1e6);
    this.tab = 'island';
    this.setup.classList.remove('hidden');
    this.renderSetup();
  }

  private difficulty(): number {
    const s = this.s as Settings;
    let d = [0.6, 0.8, 1, 1.2, 1.4][s.stability - 1] ?? 1;
    d *= { botany_bay: 0.7, standard: 1, shipwreck: 0.9, skeleton_island: 0.85, bare_bones: 1.3 }[s.advantage];
    d *= 1 + (0.5 - s.vegetation) * 0.6;
    d *= 1 - ((s.years - 20) / 40) * 0.3;
    return Math.round(d * 100);
  }

  private renderSetup(): void {
    const s = this.s as Settings;
    const field = (label: string, key: keyof Settings, opts: [string | number, string][], hint = '') => html`<div class="field"><label>${label}</label><div class="opts">${opts.map(([v, n]) => html`<span class="o ${String(s[key]) === String(v) ? 'on' : ''}" data-act="opt:${key}=${v}">${n}</span>`)}</div>${hint ? html`<div class="hintx">${hint}</div>` : ''}</div>`;
    let body;
    if (this.tab === 'island') {
      body = html`<div class="grid2">
        ${field('Island size', 'size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
        ${field('Mountains', 'mountains', [[0.2, 'Few'], [0.5, 'Some'], [0.85, 'Many']])}
        ${field('Vegetation', 'vegetation', [[0.25, 'Sparse'], [0.5, 'Normal'], [0.8, 'Lush']], 'Lumber limits everything. Sparse islands are much harder.')}
        ${field('Starting gold', 'startGold', [[1200, '1,200'], [2500, '2,500'], [5000, '5,000']])}
        <div class="field"><label>Island location</label><select data-region>${REGION_NAMES.map((n, i) => html`<option value="${i}" ${s.region === i ? raw('selected') : ''}>${n}</option>`)}</select>
          <div class="hintx">Small ships can only reach seas near home, so location matters.</div></div>
        <div class="field"><label>Map seed</label><div class="row"><span class="chip">${s.seed}</span><button class="btn small" data-act="seed">Reroll</button></div></div></div>`;
    } else if (this.tab === 'conditions') {
      body = html`<div class="grid2">
        ${field('Length of reign', 'years', [[10, '10 years'], [20, '20 years'], [30, '30 years']], 'At normal speed a year lasts about 30 minutes.')}
        ${field('Island stability', 'stability', [[1, '1 (calm)'], [2, '2'], [3, '3'], [4, '4'], [5, '5 (volatile)']], 'How quickly people react to their surroundings. 1-2 is best for beginners.')}
        ${field('Island advantage', 'advantage', [['botany_bay', 'Botany Bay'], ['standard', 'Standard'], ['shipwreck', 'Shipwreck Coast'], ['skeleton_island', 'Skeleton Island'], ['bare_bones', 'Bare Bones']], ({ botany_bay: 'Lots of extra workers and skilled craftsmen.', standard: 'A modest crew and labour force.', shipwreck: 'Castaways wash ashore from time to time.', skeleton_island: 'Ten corpses rest in the graveyard, ready to be raised.', bare_bones: 'Almost no one. A true challenge.' } as any)[s.advantage])}
        ${field('Bonus objective', 'bonus', [['hoard', 'Hoard'], ['happiness', 'Pirate happiness'], ['fleet', 'Fleet size'], ['captains', 'Captains'], ['pirates', 'Pirates']], 'This part of your score counts triple.')}
        </div>`;
    } else {
      const k = this.king;
      const look = KING_LOOKS[k.id] ?? KING_LOOKS.blackbeard;
      body = html`<div class="kings">${KINGS.map((x) => html`<div class="k ${x.id === k.id ? 'on' : ''}" data-act="king:${x.id}">${raw(portrait(KING_LOOKS[x.id], 96))}${x.name}</div>`)}</div>
        <div style="display:flex;gap:16px;margin-top:12px;align-items:flex-start">${raw(portrait(look, 120))}<div style="flex:1">
          <h3 style="margin-top:0">${k.name} <span class="sub">${NATION_ADJ[k.nat]}</span></h3><div style="font-style:italic">${k.bio}</div>
          ${this.custom ? html`<div class="grid2" style="margin-top:6px;gap:6px 12px">
            <div class="field"><label>Background</label><select data-bg>${Object.entries(BACKGROUNDS).map(([id, b]) => html`<option value="${id}" ${k.bg === id ? raw('selected') : ''}>${b.name}</option>`)}</select><div class="hintx">${BACKGROUNDS[k.bg].desc}</div></div>
            <div class="field"><label>Flaw</label><select data-flaw>${Object.entries(FLAWS).map(([id, b]) => html`<option value="${id}" ${k.flaw === id ? raw('selected') : ''}>${b.name}</option>`)}</select><div class="hintx">${FLAWS[k.flaw].desc}</div></div>
            ${[0, 1].map((i) => html`<div class="field"><label>Quality ${i + 1}</label><select data-q="${i}">${Object.entries(QUALITIES).map(([id, b]) => html`<option value="${id}" ${k.q[i] === id ? raw('selected') : ''}>${b.name}</option>`)}</select><div class="hintx">${QUALITIES[k.q[i]].desc}</div></div>`)}
          </div>` : html`<div class="kv" style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:15px;margin-top:6px">
            <b>${BACKGROUNDS[k.bg].name}</b><span>${BACKGROUNDS[k.bg].desc}</span>
            ${k.q.map((q) => html`<b>${QUALITIES[q].name}</b><span>${QUALITIES[q].desc}</span>`)}
            <b style="color:#8a1a10">${FLAWS[k.flaw].name}</b><span>${FLAWS[k.flaw].desc}</span></div>`}
          <button class="btn small" style="margin-top:6px" data-act="custom">${this.custom ? 'Done editing' : 'Edit traits'}</button></div></div>`;
    }
    setHTML(this.setup, html`<button class="close" data-act="close">${icon('close', 14)}</button>
      <h2>A New Reign</h2>
      <div class="tabs big" style="position:static;transform:none;width:auto;height:auto;display:flex"><div class="t ${this.tab === 'island' ? 'on' : ''}" data-act="tab:island">The Island</div><div class="t ${this.tab === 'conditions' ? 'on' : ''}" data-act="tab:conditions">Conditions</div><div class="t ${this.tab === 'king' ? 'on' : ''}" data-act="tab:king">Pirate ${this.king.sex === 'F' ? 'Queen' : 'King'}</div></div>
      <div class="content scroll" style="flex:1;margin:8px 0">${body}</div>
      <div class="row" style="justify-content:space-between"><span class="sub">Difficulty: <b>${this.difficulty()}%</b> (your final score is multiplied by this)</span>
        <div class="row">${this.tab !== 'king' ? html`<button class="btn" data-act="tab:${this.tab === 'island' ? 'conditions' : 'king'}">Next</button>` : ''}<button class="btn green" data-act="start">Begin Your Reign</button></div></div>`);
    const sel = this.setup.querySelector<HTMLSelectElement>('[data-region]');
    if (sel) sel.onchange = () => (this.s.region = +sel.value);
    const bg = this.setup.querySelector<HTMLSelectElement>('[data-bg]');
    if (bg) bg.onchange = () => ((this.king = { ...this.king, bg: bg.value as Background }), this.renderSetup());
    const fl = this.setup.querySelector<HTMLSelectElement>('[data-flaw]');
    if (fl) fl.onchange = () => ((this.king = { ...this.king, flaw: fl.value as Flaw }), this.renderSetup());
    for (const q of this.setup.querySelectorAll<HTMLSelectElement>('[data-q]')) q.onchange = () => {
      const qs = [...this.king.q] as [Quality, Quality];
      qs[+q.dataset.q!] = q.value as Quality;
      if (qs[0] !== qs[1]) this.king = { ...this.king, q: qs };
      this.renderSetup();
    };
  }

  private openCredits(): void {
    const items = (credits as any).thirdParty as { asset: string; kind: string; authors: string[]; source: string; url: string; license: string }[];
    const audioCredits = audio.manifest.credits ?? [];
    setHTML(this.credits, html`<button class="close" data-act="close">${icon('close', 14)}</button>
      <h2>Credits</h2>
      <div class="content scroll list" style="flex:1">
        <h3>Buccaneer Cove</h3>
        <p>Game design, code, procedural art, characters and animation were made for this project, with assets built in Blender.<br>
        A tribute to <i>Tropico 2: Pirate Cove</i> (Frog City Software / PopTop, 2003). Buccaneer Cove is not affiliated with or endorsed by the makers or owners of Tropico.</p>
        <h3>Voices, sound effects & music</h3>
        ${audioCredits.length ? html`<ul>${audioCredits.map((c) => html`<li><b>${c.asset}</b>${c.authors?.length ? ` by ${c.authors.join(', ')}` : ''}: ${c.source}${c.license ? `, ${c.license}` : ''}${c.url ? html` (<a href="${c.url}" target="_blank" rel="noopener">source</a>)` : ''}</li>`)}</ul>` : html`<p>Voices and sound effects were generated with ElevenLabs.</p>`}
        <h3>3D models & textures</h3>
        <p>These assets come from <a href="https://polyhaven.com" target="_blank" rel="noopener">Poly Haven</a> and are released under <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0 1.0</a>. Thanks to their artists:</p>
        <ul>${items.map((c) => html`<li><b>${c.asset}</b> (${c.kind}) by ${c.authors.join(', ')}: <a href="${c.url}" target="_blank" rel="noopener">${c.source}</a>, ${c.license}</li>`)}</ul>
        <h3>Fonts</h3>
        <ul><li><b>Pirata One</b> by Rodolfo Pregliasco: SIL Open Font License 1.1, via Google Fonts</li>
        <li><b>IM Fell English</b> by Igino Marini: SIL Open Font License 1.1, via Google Fonts</li></ul>
        <h3>Software</h3>
        <ul><li><b>three.js</b>: MIT License, © three.js authors</li><li><b>Blender</b> was used to build and process the 3D assets (GPL; it does not cover the output)</li><li><b>Vite</b> & <b>TypeScript</b>: MIT / Apache-2.0</li></ul>
      </div>`);
    this.credits.classList.remove('hidden');
  }
}
