import type { App } from './app';
import { el, html, setHTML, delegate, raw } from './dom';
import { icon } from './icons';
import { BUILDINGS, BUILDING, CATEGORY_NAMES, JOB_NAMES, type Category } from '../sim/data/buildings';
import { thumb } from './thumbs';
import { audio } from '../audio/audio';

const CATS: Category[] = ['infrastructure', 'resource', 'production', 'entertainment', 'nautical', 'control', 'education', 'defense', 'accoutrement'];

export class BuildMenu {
  private panel: HTMLElement;
  private cat: Category = 'infrastructure';
  visible = false;
  private lastRefresh = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel buildmenu hidden', app.root);
    delegate(this.panel, {
      cat: (c) => {
        this.cat = c as Category;
        this.refresh(true);
      },
      pick: (id) => {
        const def = BUILDING[id];
        if (id === 'road') app.setTool({ kind: 'road' });
        else app.setTool({ kind: 'build', def: id, rot: def.water === 'dock' ? 0 : 0 });
        this.hide();
      },
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
    this.refresh(true);
    this.app.hud.updateTool();
    audio.sfx('ui_open');
  }
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.add('hidden');
    this.app.hud.updateTool();
  }

  refresh(force = false): void {
    if (!this.visible) return;
    if (!force && (performance.now() - this.lastRefresh < 1000 || this.panel.matches(':hover'))) return;
    this.lastRefresh = performance.now();
    const g = this.app.game;
    const list = BUILDINGS.filter((b) => b.cat === this.cat && b.id !== 'palace');
    setHTML(this.panel, html`<button class="close" data-act="close">${icon('close', 14)}</button>
      <div class="cats">${CATS.map((c) => html`<div class="cat ${c === this.cat ? 'on' : ''}" data-act="cat:${c}">${CATEGORY_NAMES[c]}</div>`)}</div>
      <div class="cards">${list.map((d) => {
        const cost = g.costOf(d);
        const miss = g.missingReqs(d);
        const afford = (cost.gold === 0 || g.treasury >= cost.gold) && g.lumber() >= cost.lumber;
        const lock = miss.length ? (miss[0] === 'unique' ? 'Built' : 'Locked') : '';
        const tip = `<b>${d.name}</b><br>${d.desc}${d.workers.length ? `<br><i>Staff: ${d.workers.map((w) => `${w.count} ${JOB_NAMES[w.job]}`).join(', ')}${d.overseer ? ', overseer' : ''}${d.guards ? `, ${d.guards} guards` : ''}</i>` : ''}${d.upkeep ? `<br>Upkeep ${d.upkeep}/month` : ''}${miss.length && miss[0] !== 'unique' ? `<br><span style="color:#ff9070">Requires a skilled ${miss.map((m) => JOB_NAMES[m as keyof typeof JOB_NAMES] ?? m).join(', ')}</span>` : ''}`;
        return html`<div class="bcard ${lock || !afford ? 'disabled' : ''}" data-act="pick:${d.id}" data-tip="${raw(tip)}">
          ${lock ? html`<span class="lock">${lock}</span>` : ''}
          ${d.id === 'road' ? html`<div style="height:80px;display:grid;place-items:center">${icon('road', 54)}</div>` : html`<img src="${thumb(this.app.world, d.id)}" alt="">`}
          <div class="nm">${d.name}</div>
          <div class="cost">${cost.gold ? html`<span>${icon('coin', 13)} ${cost.gold}</span>` : ''}${cost.lumber ? html`<span>${icon('lumber', 13)} ${cost.lumber}</span>` : ''}${!cost.gold && !cost.lumber ? 'free' : ''}</div></div>`;
      })}</div>`);
  }
}
