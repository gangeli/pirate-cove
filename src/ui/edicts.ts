import type { App } from './app';
import { el, html, patchHTML, delegate, fmt } from './dom';
import { icon, nationFlag } from './icons';
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
  /** the (i) toggle: show each edict's description under its name */
  private help = false;

  constructor(private app: App) {
    this.panel = el('div', 'panel big hidden', app.root);
    delegate(this.panel, {
      tab: (t) => {
        this.tab = t as EdictTab;
        this.refresh(true);
      },
      close: () => this.hide(),
      help: () => {
        this.help = !this.help;
        this.refresh(true);
      },
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
    const help = this.help;
    // what an edict does, as small engraved chips with an arrow (the words in the tooltip)
    const fx = (id: string) => {
      const f = FX[id] ?? [];
      return f.length ? html`<div class="efx">${f.map(([ic, d, tip]) => html`<span class="fx ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" data-tip="${tip}">${icon(ic, 15)}${d > 0 ? '▲' : d < 0 ? '▼' : ''}</span>`)}</div>` : '';
    };
    const head = (id: string, extra: unknown = '') => {
      const e = EDICT[id];
      return html`<div class="ehead" data-tip="<b>${e.name}</b><br>${e.desc}"><span class="eic">${icon(ED_ICON[id] ?? 'scroll', 26)}</span><h4>${e.name}</h4>${extra}</div>${help ? html`<p class="d">${e.desc}</p>` : ''}`;
    };
    // the action button, styled to what it does: deadly, paid (coin badge), or a free social choice
    const action = (id: string, ok: boolean, cost: number, reason: string | undefined, nation?: Nation) => {
      const e = EDICT[id];
      const arg = nation ? `${id}|${nation}` : id;
      const deadly = DEADLY.has(id);
      const label = e.target === 'pirate' || e.target === 'captive' || e.target === 'ship' ? html`${icon('target', 14)} Choose` : deadly ? html`${icon('skull', 14)} Issue` : 'Issue';
      const cls = !ok ? 'ghost disabled' : deadly ? 'destroy' : cost ? 'coin' : 'tag';
      const poor = !ok && /^Costs /.test(reason ?? '');
      return html`<button class="btn small ${cls}" data-act="issue:${arg}" ${reason ? html`data-tip="${reason}"` : ''}>${label}${cost ? html`<span class="cbadge ${poor ? 'short' : ''}">${icon('coin', 13)}−${fmt(cost)}</span>` : ''}</button>`;
    };
    const repeal = (arg: string) => html`<button class="btn ghost danger small" data-act="repeal:${arg}" data-tip="Repeal this edict">${icon('close', 13)} Repeal</button>`;
    const card = (id: string) => {
      const e = EDICT[id];
      if (e.target === 'nation') {
        return html`<article class="ecard ${NATIONS.some((n) => g.ongoing.has(`${id}:${n}`)) ? 'active' : ''}">${head(id)}${fx(id)}
          <div class="nations">${NATIONS.map((n) => {
            const av = g.edictAvailability(id, n);
            const active = g.ongoing.has(`${id}:${n}`);
            const lv = relationLevel(g.nations[n].relation);
            return html`<div class="nrow ${active ? 'on' : ''}"><span class="nm" data-tip="<b>${NATION_NAMES[n]}</b>: ${lv}">${nationFlag(n, 18)}<span class="rel ${STANCE[lv] ?? ''}">${lv}</span></span>${active ? html`<span class="seal-on" data-tip="In force" aria-label="In force">${icon('check', 14)}</span>` : ''}
              ${active && e.ongoing ? repeal(`${id}|${n}`) : action(id, av.ok, av.cost ?? 0, av.reason, n)}</div>`;
          })}</div></article>`;
      }
      const av = g.edictAvailability(id);
      const active = g.ongoing.has(id);
      return html`<article class="ecard ${active ? 'active' : ''} ${!av.ok && !active ? 'unavail' : ''}">${head(id, active ? html`<span class="seal-on" data-tip="In force" aria-label="In force">${icon('check', 14)}</span>` : e.ongoing ? html`<span class="ongo" data-tip="Stays in force until repealed" aria-label="Ongoing">${icon('rotr', 13)}</span>` : '')}
        ${fx(id)}
        ${!av.ok && !active && !/^Costs /.test(av.reason ?? '') ? html`<div class="why">${icon('info', 14)} ${av.reason}</div>` : ''}
        <div class="efoot">${active ? repeal(id) : action(id, av.ok, av.cost ?? 0, av.reason)}</div></article>`;
    };
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>${bookSwitch('edicts')}
      <header class="sheet-head"><h2>Royal Edicts<button class="icon-link aside help ${help ? 'on' : ''}" data-act="help" aria-pressed="${help ? 'true' : 'false'}" aria-label="${help ? 'Hide' : 'Explain'} the edicts" data-tip="${help ? 'Hide' : 'Explain'} the edicts">${icon('info', 16)}</button></h2>
        <div class="sub treasury" data-tip="Treasury">${icon('chest', 15)} <b>${fmt(g.treasury)}</b></div></header>
      <nav class="tabs book" role="tablist">${(Object.keys(EDICT_TABS) as EdictTab[]).map((t) => html`<button class="t ${t === this.tab ? 'on' : ''}" data-act="tab:${t}" role="tab" aria-selected="${t === this.tab ? 'true' : 'false'}" data-tip="${EDICT_TABS[t]}">${icon(icons[t] ?? 'scroll', 15)}${EDICT_TABS[t].replace('International ', '').replace(' Attention', '').replace(' Policy', '').replace(' Orders', '')}</button>`)}</nav>
      <div class="content scroll"><div class="cards-grid ${help ? '' : 'tight'}">${list.map((e) => card(e.id))}</div></div>`);
  }
}

const STANCE: Record<string, string> = { Hostile: 'bad', Cold: 'warn', Neutral: '', Cordial: 'ok', Harmonious: 'ok' };
const DEADLY = new Set(['assassinate', 'betray', 'executions']);
/** each edict's engraving */
const ED_ICON: Record<string, string> = {
  free_captive: 'unchain', press_gang: 'chain', ransom: 'purse', donate: 'coin', assassinate: 'skull', educate: 'book', outfit: 'g_hat',
  free_beer: 'g_beer', free_rum: 'g_rum', festival: 'flag', rig_against: 'scales', rig_favour: 'scales', curfew: 'bell', loose_lips: 'quill',
  betray: 'skull', donate_crew: 'chest', prohibit_eng: 'shield', prohibit_fra: 'shield', prohibit_spa: 'shield', walk_plank: 'anchor',
  recruit_captain: 'captain', informants: 'eye', free_all: 'unchain', executions: 'skull', patrols: 'shield', raise_dead: 'skull',
  jolly_roger: 'flag', peace: 'scales', open_cove: 'ship', patron: 'crown', marque: 'scroll',
};
/** what each edict does: [icon, up (1) or down (-1) or neither (0), tooltip] */
const FX: Record<string, [string, number, string][]> = {
  free_captive: [['flag', 1, 'Their nation is pleased'], ['eye', 1, 'They may reveal where you are']],
  press_gang: [['pirate', 1, 'One more pirate, a miserable one'], ['captive', -1, 'One captive fewer']],
  ransom: [['coin', 1, 'Their family pays the ransom'], ['captive', -1, 'They go home']],
  donate: [['heart', 1, '100 gold for one pirate to spend on the island']],
  assassinate: [['skull', 0, 'A palace guard settles one troublemaker. The target may win.']],
  educate: [['book', 1, 'One skill improves at a school']],
  outfit: [['g_hat', 1, 'A peg leg, a hat or a parrot: notoriety, leadership or courage']],
  free_beer: [['g_beer', 1, 'Drinking +50% for every pirate ashore']],
  free_rum: [['g_rum', 1, 'Drinking +100% for every pirate ashore']],
  festival: [['g_rum', 1, 'Drinking, feasting and gambling +30%'], ['flag', 1, 'Anarchy rises for a while']],
  rig_against: [['coin', 1, 'More gambling revenue'], ['heart', -1, 'Gamblers are less satisfied']],
  rig_favour: [['heart', 1, 'Happier gamblers'], ['coin', -1, 'The house earns less']],
  curfew: [['scales', 1, 'Much more order'], ['captive', 1, 'Captives work harder'], ['heart', -1, 'Pirates resent it']],
  loose_lips: [['eye', -1, 'Captives are less likely to reveal the island'], ['scales', 1, 'More order'], ['heart', -1, 'Pirates dislike it']],
  betray: [['flag', 1, 'That Power is delighted'], ['pirate', -1, 'Every pirate of that nation is hanged'], ['heart', -1, 'The other crews grow nervous']],
  donate_crew: [['heart', 1, '500 gold shared among one ship\'s crew']],
  prohibit_eng: [['flag', 1, 'Captains leave English ships alone'], ['chest', -1, 'Fewer prizes']],
  prohibit_fra: [['flag', 1, 'Captains leave French ships alone'], ['chest', -1, 'Fewer prizes']],
  prohibit_spa: [['flag', 1, 'Captains leave Spanish ships alone'], ['chest', -1, 'Fewer prizes']],
  walk_plank: [['eye', -1, 'No witnesses: your island stays secret'], ['captive', -1, 'No captives taken'], ['pirate', -1, 'No recruits taken']],
  recruit_captain: [['captain', 1, 'A captain for your grandest ship without one']],
  informants: [['skull', 1, 'Fear rises: captives snitch on each other']],
  free_all: [['flag', 1, 'That Power is grateful'], ['captive', -1, 'Every captive of that nation goes home'], ['eye', 1, 'They may reveal the island']],
  executions: [['skull', 1, 'Fear rises'], ['flag', 1, 'Anarchy rises'], ['captive', -1, 'Captives die at random']],
  patrols: [['scales', 1, 'Order rises'], ['skull', 1, 'Fear rises'], ['heart', -1, 'Pirates grumble']],
  raise_dead: [['skull', 1, 'A dead pirate rises as a tireless hauler']],
  jolly_roger: [['crown', 1, 'Independence from every Power'], ['shield', -1, 'No peace, no patron, no protection']],
  peace: [['flag', 1, 'Relations improve every month'], ['chest', -1, 'Their ships are off limits; break it and pay']],
  open_cove: [['coin', 1, 'Trade surplus goods with them'], ['eye', 1, 'They learn where you are']],
  patron: [['shield', 1, 'No-one dares invade a colony']],
  marque: [['chest', 1, 'Legal privateering against your patron\'s enemy']],
};
