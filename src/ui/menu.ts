import type { App } from './app';
import { el, html, setHTML, delegate, raw, type Raw } from './dom';
import { icon } from './icons';
import { KINGS, BACKGROUNDS, QUALITIES, FLAWS, NATION_ADJ, type KingDef, type Background, type Quality, type Flaw } from '../sim/data/kings';
import { portraitImg } from './portraits';
import type { Settings } from '../sim/types';
import { PRESETS, difficultyOf } from '../sim/presets';
import { audio } from '../audio/audio';
import credits from '../credits.json';
import { pwaMenuItems } from './install';

const charCreditFiles = import.meta.glob('../charcredits/*.json', { eager: true }) as Record<string, { default: { asset: string; id: string; author: string; license: string; url: string }[] }>;

const REGION_NAMES = ['Gulf of Mexico', 'Bay of Campeche', 'Yucatán Channel', 'Florida Straits', 'The Bahamas', 'Cayman Deep', 'Windward Passage', 'Tortuga Waters', 'Jamaica Channel', 'Mona Passage', 'Virgin Islands', 'Leeward Islands', 'Windward Islands', 'Spanish Main', 'Curaçao Banks', 'Cartagena Roads', 'Darién Gap', 'Mosquito Coast'];

export class MainMenu {
  private root: HTMLElement;
  private setup: HTMLElement;
  private credits: HTMLElement;
  private s: Partial<Settings> = { ...PRESETS[2].settings, region: 6 };
  private king: KingDef = KINGS[2];
  private custom = false;
  private tab: 'preset' | 'island' | 'conditions' | 'king' = 'preset';

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
      preset: (id) => {
        const pr = PRESETS.find((x) => x.id === id)!;
        this.s = { ...this.s, ...pr.settings };
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
      <div class="foot">A tribute to the pirate island builders of old.${audio.muted ? ` ${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} the speaker for sound.` : ''}</div>`);
    pwaMenuItems(this.root.querySelector('.items'));
    this.root.classList.remove('hidden');
  }
  hide(): void {
    this.root.classList.add('hidden');
    this.setup.classList.add('hidden');
    this.credits.classList.add('hidden');
  }

  private openSetup(): void {
    this.s.seed = Math.floor(Math.random() * 1e6);
    this.tab = 'preset';
    this.setup.classList.remove('hidden');
    this.renderSetup();
  }

  private difficulty(): number {
    return Math.round(difficultyOf(this.s as Settings) * 100);
  }

  /** the preset these settings match exactly, if any */
  private presetId(): string | null {
    const s = this.s as any;
    return PRESETS.find((p) => Object.entries(p.settings).every(([k, v]) => k === 'bonus' || s[k] === v))?.id ?? null;
  }

  private renderSetup(): void {
    const s = this.s as Settings;
    // a setting: an engraved label (its explanation in an (i) tip), then the choices; each choice may carry a glyph
    // and its own tip
    type Opt = [string | number, string, Raw?, string?];
    const field = (label: string, ic: string, key: keyof Settings, opts: Opt[], hint = '') => html`<div class="field"><label>${icon(ic, 16)} ${label}${hint ? html` <span class="tipi" data-tip="${hint}" tabindex="0" aria-label="About ${label.toLowerCase()}">${icon('info', 14)}</span>` : ''}</label><div class="opts" role="radiogroup" aria-label="${label}">${opts.map(([v, n, g, tip]) => html`<span class="o ${String(s[key]) === String(v) ? 'on' : ''} ${g ? 'glyph' : ''}" data-act="opt:${key}=${v}" role="radio" aria-checked="${String(s[key]) === String(v) ? 'true' : 'false'}" ${tip ? html`data-tip="${tip}"` : ''}>${g ? html`<span class="g">${g}</span>` : ''}${n}</span>`)}</div></div>`;
    const rep = (ic: string, n: number, size = 13) => html`${Array.from({ length: n }, () => icon(ic, size))}`;
    let body;
    if (this.tab === 'preset') {
      const cur = this.presetId();
      body = html`<div class="presets">${PRESETS.map((p) => html`<div class="preset ${cur === p.id ? 'on' : ''}" data-act="preset:${p.id}" ${cur === p.id ? '' : html`data-tip="${p.blurb}"`}>
          <div class="pname">${p.name}<span class="pdiff" data-tip="Your final score is multiplied by this"><small>score ×</small>${(difficultyOf({ ...this.s, ...p.settings } as Settings)).toFixed(2)}</span></div>
          ${cur === p.id ? html`<div class="pblurb">${p.blurb}</div>` : ''}
          <div class="pskulls" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => icon('skull', 15, i <= PRESETS.indexOf(p) ? 'lit' : ''))}</div></div>`)}
        ${cur ? '' : html`<div class="callout info">${icon('gear', 16)}<span>Custom conditions</span></div>`}</div>`;
    } else if (this.tab === 'island') {
      body = html`<div class="grid2">
        ${field('Island size', 'compass', 'size', [['small', 'Small', icon('compass', 12)], ['medium', 'Medium', icon('compass', 16)], ['large', 'Large', icon('compass', 20)]])}
        ${field('Mountains', 'pick', 'mountains', [[0.2, 'Few', rep('pick', 1)], [0.5, 'Some', rep('pick', 2)], [0.85, 'Many', rep('pick', 3)]])}
        ${field('Vegetation', 'sprout', 'vegetation', [[0.25, 'Sparse', rep('sprout', 1)], [0.5, 'Normal', rep('sprout', 2)], [0.8, 'Lush', rep('sprout', 3)]], 'Lumber limits everything. Sparse islands are much harder.')}
        ${field('Starting gold', 'coin', 'startGold', [[1200, '1,200', rep('coin', 1)], [2500, '2,500', rep('coin', 2)], [5000, '5,000', rep('coin', 3)]])}
        <div class="field"><label>${icon('anchor', 16)} Island location <span class="tipi" data-tip="Small ships can only reach seas near home, so location matters." tabindex="0" aria-label="About the location">${icon('info', 14)}</span></label><select data-region>${REGION_NAMES.map((n, i) => html`<option value="${i}" ${s.region === i ? raw('selected') : ''}>${n}</option>`)}</select></div>
        <div class="field"><label>${icon('wheel', 16)} Map seed</label><div class="row start"><span class="chip">${s.seed}</span><button class="btn nav small" data-act="seed" data-tip="A new island">${icon('rotr', 14)} Reroll</button></div></div></div>`;
    } else if (this.tab === 'conditions') {
      const adv: Record<string, [string, string]> = { botany_bay: ['captive', 'Lots of extra workers and skilled craftsmen.'], standard: ['pirate', 'A modest crew and labour force.'], shipwreck: ['ship', 'Castaways wash ashore from time to time.'], skeleton_island: ['skull', 'Ten corpses rest in the graveyard, ready to be raised.'], bare_bones: ['close', 'Almost no one. A true challenge.'] };
      body = html`<div class="grid2">
        ${field('Length of reign', 'crown', 'years', [[10, '10 yrs'], [20, '20 yrs'], [30, '30 yrs']], 'At normal speed a year lasts about 30 minutes.')}
        ${field('Island stability', 'scales', 'stability', [1, 2, 3, 4, 5].map((n) => [n, String(n), undefined, n === 1 ? 'Calm' : n === 5 ? 'Volatile' : undefined] as Opt), 'How quickly people react to their surroundings: 1 is calm, 5 volatile. 1-2 is best for beginners.')}
        ${field('Island advantage', 'flag', 'advantage', (['botany_bay', 'standard', 'shipwreck', 'skeleton_island', 'bare_bones'] as const).map((k) => [k, ({ botany_bay: 'Botany Bay', standard: 'Standard', shipwreck: 'Shipwreck Coast', skeleton_island: 'Skeleton Island', bare_bones: 'Bare Bones' })[k], icon(adv[k][0], 15), adv[k][1]] as Opt))}
        ${field('Starting ship', 'ship', 'startShip', [['none', 'None', undefined, 'You must build a boatyard and your first hull yourself.'], ['snow', 'Snow', icon('ship', 13), 'Small and fragile: good for raids, kidnappings and exploring, a gamble on a cruise.'], ['schooner', 'Schooner', icon('ship', 16)], ['sloop', 'Sloop', icon('ship', 19)]])}
        ${field('Bonus objective', 'target', 'bonus', [['hoard', 'Hoard', icon('chest', 15)], ['happiness', 'Happiness', icon('heart', 15), 'Pirate happiness'], ['fleet', 'Fleet', icon('ship', 15), 'Fleet size'], ['captains', 'Captains', icon('captain', 15)], ['pirates', 'Pirates', icon('pirate', 15)]], 'This part of your score counts triple.')}
        </div>`;
    } else {
      const k = this.king;
      body = html`<div class="kings">${KINGS.map((x) => html`<div class="k ${x.id === k.id ? 'on' : ''}" data-act="king:${x.id}">${raw(portraitImg(x.id, 96))}${x.name}</div>`)}</div>
        <div class="king-pick">${raw(portraitImg(k.id, 120))}<div style="flex:1;min-width:0">
          <h3 style="margin-top:0">${k.name} <span class="sub">${NATION_ADJ[k.nat]}</span></h3><div class="bio">${k.bio}</div>
          ${this.custom ? html`<div class="grid2" style="margin-top:6px;gap:6px 12px">
            <div class="field"><label>${icon('book', 15)} Background <span class="tipi" data-tip="${BACKGROUNDS[k.bg].desc}" tabindex="0">${icon('info', 14)}</span></label><select data-bg>${Object.entries(BACKGROUNDS).map(([id, b]) => html`<option value="${id}" ${k.bg === id ? raw('selected') : ''}>${b.name}</option>`)}</select></div>
            <div class="field"><label>${icon('skull', 15)} Flaw <span class="tipi" data-tip="${FLAWS[k.flaw].desc}" tabindex="0">${icon('info', 14)}</span></label><select data-flaw>${Object.entries(FLAWS).map(([id, b]) => html`<option value="${id}" ${k.flaw === id ? raw('selected') : ''}>${b.name}</option>`)}</select></div>
            ${[0, 1].map((i) => html`<div class="field"><label>${icon('crown', 15)} Quality ${i + 1} <span class="tipi" data-tip="${QUALITIES[k.q[i]].desc}" tabindex="0">${icon('info', 14)}</span></label><select data-q="${i}">${Object.entries(QUALITIES).map(([id, b]) => html`<option value="${id}" ${k.q[i] === id ? raw('selected') : ''}>${b.name}</option>`)}</select></div>`)}
          </div>` : html`<div class="traits">
            <span class="chip" data-tip="${BACKGROUNDS[k.bg].desc}">${icon('book', 13)} ${BACKGROUNDS[k.bg].name}</span>
            ${k.q.map((q) => html`<span class="chip ok" data-tip="${QUALITIES[q].desc}">${icon('crown', 13)} ${QUALITIES[q].name}</span>`)}
            <span class="chip bad" data-tip="${FLAWS[k.flaw].desc}">${icon('skull', 13)} ${FLAWS[k.flaw].name}</span></div>
            <details class="explain"><summary>${icon('info', 14)} What these mean</summary><div class="kv" style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:14px;margin-top:6px">
            <b>${BACKGROUNDS[k.bg].name}</b><span>${BACKGROUNDS[k.bg].desc}</span>
            ${k.q.map((q) => html`<b>${QUALITIES[q].name}</b><span>${QUALITIES[q].desc}</span>`)}
            <b style="color:#8a1a10">${FLAWS[k.flaw].name}</b><span>${FLAWS[k.flaw].desc}</span></div></details>`}
          <button class="btn nav small" style="margin-top:6px" data-act="custom">${icon(this.custom ? 'check' : 'quill', 14)} ${this.custom ? 'Done' : 'Edit traits'}</button></div></div>`;
    }
    setHTML(this.setup, html`<button class="close" data-act="close">${icon('close', 14)}</button>
      <h2>A New Reign</h2>
      <nav class="tabs book" role="tablist">${([['preset', 'Difficulty', 'skull'], ['island', 'The island', 'compass'], ['conditions', 'Conditions', 'scroll'], ['king', `Pirate ${this.king.sex === 'F' ? 'queen' : 'king'}`, 'crown']] as const).map(([t, n, ic]) => html`<button class="t ${this.tab === t ? 'on' : ''}" data-act="tab:${t}" role="tab" aria-selected="${this.tab === t ? 'true' : 'false'}">${icon(ic, 15)}${n}</button>`)}</nav>
      <div class="content scroll" style="flex:1;margin:8px 0">${body}</div>
      <div class="row" style="justify-content:space-between"><span class="sub diffline" data-tip="Difficulty: your final score is multiplied by this">${icon('skull', 15)} <b>×${(this.difficulty() / 100).toFixed(2)}</b></span>
        <div class="row">${this.tab !== 'king' ? html`<button class="btn ghost" data-act="tab:${this.tab === 'preset' ? 'island' : this.tab === 'island' ? 'conditions' : 'king'}">Next</button>` : ''}<button class="btn primary" data-act="start">Begin your reign</button></div></div>`);
    this.setup.querySelector('.tabs .t.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
        <h3>People</h3>
        <p>Bodies, skins, hair and clothing are <a href="https://static.makehumancommunity.org/assets/assetpacks.html" target="_blank" rel="noopener">MakeHuman community assets</a>, assembled with MPFB. Motion capture from the <a href="http://mocap.cs.cmu.edu/" target="_blank" rel="noopener">CMU Graphics Lab Motion Capture Database</a> (created with funding from NSF EIA-0196217), retargeted for this game. Hats, sashes, beards and the skeletons were modelled for this project.</p>
        <ul>${charCredits().map((c) => html`<li><b>${c.asset}</b> by ${c.author}: ${c.license === 'CC-BY' ? html`<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>` : 'CC0'}</li>`)}</ul>
        <h3>Fonts</h3>
        <ul><li><b>IM Fell English</b>, <b>IM Fell English SC</b> and <b>IM Fell Great Primer SC</b> by Igino Marini: SIL Open Font License 1.1, self-hosted from Google Fonts</li></ul>
        <h3>Software</h3>
        <ul><li><b>three.js</b>: MIT License, © three.js authors</li><li><b>Blender</b> was used to build and process the 3D assets (GPL; it does not cover the output)</li><li><b>Vite</b> & <b>TypeScript</b>: MIT / Apache-2.0</li></ul>
      </div>`);
    this.credits.classList.remove('hidden');
  }
}

function charCredits() {
  const seen = new Map<string, { asset: string; author: string; license: string }>();
  for (const f of Object.values(charCreditFiles)) for (const c of f.default) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()].sort((a, b) => (a.license === b.license ? a.asset.localeCompare(b.asset) : a.license === 'CC-BY' ? -1 : 1));
}
