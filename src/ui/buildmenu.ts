import type { App } from './app';
import { el, html, patchHTML, delegate, raw } from './dom';
import { icon } from './icons';
import { BUILDINGS, BUILDING, CATEGORY_NAMES, JOB_NAMES, type Category } from '../sim/data/buildings';
import { thumbOrQueue, THUMB_PLACEHOLDER } from './thumbs';
import { audio } from '../audio/audio';

type Tab = 'tools' | Category;
const CATS: Tab[] = ['tools', 'infrastructure', 'resource', 'production', 'entertainment', 'nautical', 'control', 'education', 'defense', 'accoutrement'];

export class BuildMenu {
  private panel: HTMLElement;
  private cat: Tab = 'tools';
  visible = false;
  private lastRefresh = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel buildmenu hidden', app.root);
    delegate(this.panel, {
      cat: (c) => {
        this.cat = c as Tab;
        this.refresh(true);
      },
      pick: (id) => {
        const def = BUILDING[id];
        if (id === 'road') app.setTool({ kind: 'road' });
        else app.setTool({ kind: 'build', def: id, rot: def.water === 'dock' ? 0 : 0 });
        this.hide();
      },
      tool: (k) => {
        const kind = k as 'road' | 'clear' | 'demolish';
        app.setTool(app.tool.kind === kind ? { kind: 'select' } : { kind });
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
    const k = this.app.tool.kind;
    if (k === 'road' || k === 'clear' || k === 'demolish' || k === 'unroad') this.cat = 'tools';
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

  /** a queued thumbnail is ready: drop it into the open menu without a rebuild */
  private onThumb = (id: string, url: string): void => {
    if (!this.visible) return;
    for (const img of this.panel.querySelectorAll<HTMLImageElement>(`img[data-thumb="${id}"]`)) img.src = url;
  };

  refresh(force = false): void {
    if (!this.visible) return;
    if (!force && (performance.now() - this.lastRefresh < 1000 || this.panel.matches(':hover'))) return;
    this.lastRefresh = performance.now();
    const g = this.app.game;
    // roads live with the tools, not among the buildings
    const list = BUILDINGS.filter((b) => b.cat === this.cat && b.id !== 'palace' && b.id !== 'road');
    const k = this.app.tool.kind;
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>
      <nav class="cats tabs book" role="tablist">${CATS.map((c) => html`<button class="t ${c === this.cat ? 'on' : ''} ${c === 'tools' ? 'tools' : ''}" data-act="cat:${c}" role="tab" aria-selected="${c === this.cat ? 'true' : 'false'}">${c === 'tools' ? html`${icon('hammer', 15)}Tools` : CATEGORY_NAMES[c]}</button>`)}</nav>
      <div class="cards">${this.cat === 'tools' ? TOOLS.map(([id, ic, name, what, tip]) => html`<button class="bcard toolcard ${k === id || (id === 'demolish' && k === 'unroad') ? 'on' : ''}" data-act="tool:${id}" data-tip="${tip}" aria-pressed="${k === id ? 'true' : 'false'}">
          <div class="tic tic-${id}">${icon(ic, 46)}</div><div class="nm">${name}</div><div class="cost">${k === id ? 'In use' : what}</div></button>`) : list.map((d) => {
        const cost = g.costOf(d);
        const miss = g.missingReqs(d);
        const afford = (cost.gold === 0 || g.treasury >= cost.gold) && g.lumber() >= cost.lumber;
        const lock = miss.length ? (miss[0] === 'unique' ? 'Built' : 'Locked') : '';
        const tip = `<b>${d.name}</b><br>${d.desc}${d.workers.length ? `<br><i>Staff: ${d.workers.map((w) => `${w.count} ${JOB_NAMES[w.job]}`).join(', ')}${d.overseer ? ', overseer' : ''}${d.guards ? `, ${d.guards} guards` : ''}</i>` : ''}${d.upkeep ? `<br>Upkeep ${d.upkeep}/month` : ''}${miss.length && miss[0] !== 'unique' ? `<br><span style="color:#ff9070">Requires a skilled ${miss.map((m) => JOB_NAMES[m as keyof typeof JOB_NAMES] ?? m).join(', ')}</span>` : ''}`;
        return html`<button class="bcard ${lock ? 'disabled' : !afford ? 'poor' : ''}" data-act="pick:${d.id}" data-tip="${tip}">
          ${lock ? html`<span class="lock">${lock}</span>` : !afford ? html`<span class="lock poor">${short(cost.gold, g.treasury, cost.lumber, g.lumber())}</span>` : ''}
          <img src="${thumbOrQueue(this.app.world, d.id, this.onThumb) ?? THUMB_PLACEHOLDER}" data-thumb="${d.id}" alt="">
          <div class="nm">${d.name}</div>
          <div class="cost">${cost.gold ? html`<span class="${g.treasury < cost.gold ? 'short' : ''}">${icon('coin', 13)} ${cost.gold}</span>` : ''}${cost.lumber ? html`<span class="${g.lumber() < cost.lumber ? 'short' : ''}">${icon('lumber', 13)} ${cost.lumber}</span>` : ''}${!cost.gold && !cost.lumber ? 'Free' : ''}</div></button>`;
      })}</div>`);
  }
}

/** the first tab of the drawer: the tools that shape the ground rather than build on it */
const TOOLS: ['road' | 'clear' | 'demolish', string, string, string, string][] = [
  ['road', 'road', 'Road', 'Free · drag to lay', '<b>Road</b><br>Drag to lay a road. Most buildings must touch one.'],
  ['clear', 'axe', 'Clear trees', 'Free · drag over trees', '<b>Clear trees</b><br>Drag over the jungle to fell it and make room.'],
  ['demolish', 'bulldoze', 'Demolish', 'Tear down · undoable', '<b>Demolish</b><br>Tear down a building or pull up a road. Undo brings it back. <i>(Del)</i>'],
];

/** the ribbon on a card the treasury can't cover yet: what's missing, not just "no" */
export function short(gold: number, treasury: number, lumber: number, have: number): string {
  const g = gold > 0 ? Math.max(0, gold - treasury) : 0, l = Math.max(0, lumber - have);
  return g && l ? 'Short of gold & lumber' : g ? `Short ${Math.ceil(g)} gold` : `Short ${Math.ceil(l)} lumber`;
}
