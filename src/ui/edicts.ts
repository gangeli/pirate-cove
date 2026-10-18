import type { App } from './app';
import { el, html, setHTML, delegate } from './dom';
import { icon } from './icons';
import { EDICTS, EDICT, EDICT_TABS, type EdictTab } from '../sim/data/edicts';
import { NATIONS, NATION_NAMES, type Nation } from '../sim/data/kings';
import { edictCost } from '../sim/edicts';
import { relationLevel } from '../sim/diplomacy';
import { audio } from '../audio/audio';

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
    const card = (id: string) => {
      const e = EDICT[id];
      const nationTarget = e.target === 'nation';
      if (nationTarget) {
        return html`<div class="ecard ${NATIONS.some((n) => g.ongoing.has(`${id}:${n}`)) ? 'active' : ''}"><h4>${e.name}</h4><div class="d">${e.desc}</div>
          ${NATIONS.map((n) => {
            const av = g.edictAvailability(id, n);
            const active = g.ongoing.has(`${id}:${n}`);
            return html`<div class="row" style="justify-content:space-between"><span>${NATION_NAMES[n]} <span class="sub">(${relationLevel(g.nations[n].relation)})</span></span>
              ${active && e.ongoing ? html`<button class="btn small red" data-act="repeal:${id}|${n}">Repeal</button>` : html`<button class="btn small ${av.ok ? '' : 'disabled'}" data-act="issue:${id}|${n}" data-tip="${av.reason ?? ''}">${av.cost ? `${av.cost}g` : 'Issue'}</button>`}</div>`;
          })}</div>`;
      }
      const av = g.edictAvailability(id);
      const active = g.ongoing.has(id);
      return html`<div class="ecard ${active ? 'active' : ''}"><h4>${e.name}</h4><div class="d">${e.desc}</div>
        ${!av.ok && !active ? html`<div class="why">${av.reason}</div>` : ''}
        <div class="row" style="justify-content:space-between"><span class="sub">${av.cost ? `${av.cost} gold` : 'free'}${e.ongoing ? ' · ongoing' : ''}${e.target !== 'none' ? ` · choose a ${e.target}` : ''}</span>
        ${active ? html`<button class="btn small red" data-act="repeal:${id}">Repeal</button>` : html`<button class="btn small ${av.ok ? 'green' : 'disabled'}" data-act="issue:${id}">Issue</button>`}</div></div>`;
    };
    setHTML(this.panel, html`<button class="close" data-act="close">${icon('close', 14)}</button>
      <h2>Royal Edicts</h2><div class="sub">Your word is law. Treasury: ${Math.round(g.treasury)} gold</div>
      <div class="tabs">${(Object.keys(EDICT_TABS) as EdictTab[]).map((t) => html`<div class="t ${t === this.tab ? 'on' : ''}" data-act="tab:${t}">${EDICT_TABS[t]}</div>`)}</div>
      <div class="content scroll"><div class="cards-grid">${list.map((e) => card(e.id))}</div></div>`);
  }
}
