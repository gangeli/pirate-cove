import type { App } from './app';
import { el, html, patchHTML, delegate, fmt } from './dom';
import { icon } from './icons';
import { EDICTS, EDICT, EDICT_TABS, type EdictTab } from '../sim/data/edicts';
import { NATIONS, NATION_NAMES, type Nation } from '../sim/data/kings';
import { edictCost } from '../sim/edicts';
import { relationLevel } from '../sim/diplomacy';
import { audio } from '../audio/audio';
import { bookSwitch } from './hud';

export class EdictsPanel {
  private panel: HTMLElement;
  private tab: EdictTab = 'pirate';
  visible = false;
  private lastRefresh = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel big hidden', app.root);
    delegate(this.panel, {
      tab: (t) => {
        this.tab = t as EdictTab;
        this.refresh(true);
      },
      close: () => this.hide(),
      book: (b) => (b === 'log' ? app.log.show() : undefined),
      issue: (arg) => {
        const [id, nation] = arg.split('|');
        const e = EDICT[id];
        if (e.target === 'pirate' || e.target === 'captive' || e.target === 'ship') {
          if (id === 'educate' || id === 'outfit') {
            app.hud.flash('Select a pirate and use the buttons in their panel.');
            return;
          }
          this.hide();
          app.setTool({ kind: 'target', what: e.target, edict: id });
          return;
        }
        this.issue(id, undefined, nation as Nation | undefined);
        this.refresh(true);
      },
      repeal: (arg) => {
        const [id, nation] = arg.split('|');
        app.cmd({ type: 'edict', id, nation: nation as Nation | undefined, repeal: true });
        this.refresh(true);
      },
    }, () => audio.sfx('ui_click'));
  }

  cost(id: string): number {
    return edictCost(this.app.game, id);
  }

  issue(id: string, target?: number, nation?: Nation, arg?: string): void {
    const e = EDICT[id];
    const c = this.cost(id);
    const go = () => {
      if (this.app.cmd({ type: 'edict', id, target, nation, arg })) {
        audio.sfx(id === 'raise_dead' ? 'quill' : 'quill');
        if (c) audio.sfx('coins');
      }
    };
    if (c >= 500 || e.id === 'betray' || e.id === 'free_all' || e.id === 'jolly_roger' || e.id === 'assassinate') {
      this.app.modal.confirm(`${e.name}${nation ? `: ${NATION_NAMES[nation]}` : ''}?`, `${e.desc}${c ? `\n\nCost: ${c} gold.` : ''}`, go);
    } else go();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
  show(): void {
    this.app.closeAll();
    this.visible = true;
    this.panel.classList.remove('hidden');
    this.app.hud.islandBook = 'edicts';
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
    if (!force && (performance.now() - this.lastRefresh < 1200 || this.panel.matches(':hover'))) return;
    this.lastRefresh = performance.now();
    const g = this.app.game;
    const list = EDICTS.filter((e) => e.tab === this.tab);
    const icons: Record<string, string> = { individual: 'pirate', pirate: 'flag', cruise: 'ship', captive: 'chain', diplomacy: 'scroll' };
    const card = (id: string) => {
      const e = EDICT[id];
      if (e.target === 'nation') {
        return html`<article class="ecard ${NATIONS.some((n) => g.ongoing.has(`${id}:${n}`)) ? 'active' : ''}"><h4>${e.name}</h4><p class="d">${e.desc}</p>
          <div class="nations">${NATIONS.map((n) => {
            const av = g.edictAvailability(id, n);
            const active = g.ongoing.has(`${id}:${n}`);
            return html`<div class="nrow"><span class="nm">${NATION_NAMES[n]}</span><span class="chip">${relationLevel(g.nations[n].relation)}</span>
              ${active && e.ongoing ? html`<button class="btn ghost danger small" data-act="repeal:${id}|${n}">Repeal</button>`
                : html`<button class="btn small ${av.ok ? 'primary' : 'ghost disabled'}" data-act="issue:${id}|${n}" ${av.reason ? html`data-tip="${av.reason}"` : ''}>${av.cost ? html`${icon('coin', 13)} ${av.cost}` : 'Issue'}</button>`}</div>`;
          })}</div></article>`;
      }
      const av = g.edictAvailability(id);
      const active = g.ongoing.has(id);
      return html`<article class="ecard ${active ? 'active' : ''} ${!av.ok && !active ? 'unavail' : ''}"><h4>${e.name}${active ? html` <span class="chip ok">In force</span>` : ''}</h4><p class="d">${e.desc}</p>
        ${!av.ok && !active ? html`<div class="why">${icon('info', 14)} ${av.reason}</div>` : ''}
        <div class="efoot"><span class="meta">${av.cost ? html`<span class="chip">${icon('coin', 12)} ${av.cost}</span>` : html`<span class="chip">Free</span>`}${e.ongoing ? html`<span class="chip">Ongoing</span>` : ''}${e.target !== 'none' ? html`<span class="chip">Pick a ${e.target}</span>` : ''}</span>
        ${active ? html`<button class="btn ghost danger small" data-act="repeal:${id}">Repeal</button>` : html`<button class="btn small ${av.ok ? 'primary' : 'ghost disabled'}" data-act="issue:${id}">${e.target !== 'none' ? 'Choose…' : 'Issue'}</button>`}</div></article>`;
    };
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>${bookSwitch('edicts')}
      <header class="sheet-head"><h2>Royal Edicts</h2><div class="sub">Your word is law. Treasury: <b>${fmt(g.treasury)} gold</b></div></header>
      <nav class="tabs book" role="tablist">${(Object.keys(EDICT_TABS) as EdictTab[]).map((t) => html`<button class="t ${t === this.tab ? 'on' : ''}" data-act="tab:${t}" role="tab" aria-selected="${t === this.tab ? 'true' : 'false'}">${icon(icons[t] ?? 'scroll', 15)}${EDICT_TABS[t].replace('International ', '')}</button>`)}</nav>
      <div class="content scroll"><div class="cards-grid">${list.map((e) => card(e.id))}</div></div>`);
  }
}
