import type { App } from './app';
import { el, html, patchHTML, delegate, fmt, pct, bar, raw } from './dom';
import { icon } from './icons';
import { RANKS, JOB_NAMES, BUILDING } from '../sim/data/buildings';
import { NATIONS, NATION_NAMES, NATION_ADJ, BACKGROUNDS, QUALITIES, FLAWS } from '../sim/data/kings';
import { SHIPS, MISSION_NAMES } from '../sim/data/ships';
import { voyageStrip } from './tally';
import { computeScore, medalThresholds } from '../sim/score';
import { relationLevel } from '../sim/diplomacy';
import { activityText, shipStatusName } from './inspector';
import { audio } from '../audio/audio';
import { bookSwitch } from './hud';
import { portraitImg } from './portraits';

type Tab = 'overview' | 'finances' | 'satisfaction' | 'pirates' | 'captives' | 'nations' | 'ships' | 'messages';
const TABS: [Tab, string, string][] = [['overview', 'Overview', 'crown'], ['finances', 'Finances', 'coin'], ['satisfaction', 'Morale', 'heart'], ['pirates', 'Pirates', 'pirate'], ['captives', 'Captives', 'captive'], ['nations', 'Powers', 'flag'], ['ships', 'Fleet', 'ship'], ['messages', 'Letters', 'scroll']];

export class IslandLog {
  private panel: HTMLElement;
  private tab: Tab = 'overview';
  visible = false;
  private sort = { key: 'name', dir: 1 };
  private lastRefresh = 0;

  constructor(private app: App) {
    this.panel = el('div', 'panel big hidden', app.root);
    delegate(this.panel, {
      tab: (t) => {
        this.tab = t as Tab;
        this.refresh(true);
      },
      close: () => this.hide(),
      book: (b) => (b === 'edicts' ? app.edicts.show() : undefined),
      sort: (k) => {
        this.sort = { key: k, dir: this.sort.key === k ? -this.sort.dir : 1 };
        this.refresh(true);
      },
      person: (id) => {
        const p = app.game.people.get(+id);
        if (!p) return;
        app.select({ type: 'person', id: p.id });
        if (p.task.kind !== 'atsea') app.jumpTo(p.x, p.y);
        this.hide();
      },
      ship: (id) => {
        app.select({ type: 'ship', id: +id });
        this.hide();
      },
      hoard: (v) => {
        app.cmd({ type: 'hoardRate', rate: +v });
        this.refresh(true);
      },
      msg: (id) => {
        const m = app.game.messages.find((x) => x.id === +id);
        if (m) app.modal.message({ ...m, voice: undefined });
      },
    }, () => audio.sfx('ui_click'));
  }

  open(t: Tab): void {
    this.tab = t;
    this.show();
  }
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }
  show(): void {
    this.app.closeAll();
    this.visible = true;
    this.panel.classList.remove('hidden');
    this.app.hud.islandBook = 'log';
    this.refresh(true);
    this.app.hud.updateTool();
    audio.sfx('parchment');
  }
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.add('hidden');
    this.app.hud.updateTool();
  }

  refresh(force = false): void {
    if (!this.visible) return;
    if (!force && (performance.now() - this.lastRefresh < 2000 || this.panel.matches(':hover'))) return;
    this.lastRefresh = performance.now();
    const body = this[this.tab]();
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>${bookSwitch('log')}
      <header class="sheet-head"><h2>Island Log</h2><div class="sub">${this.app.game.king.name}'s ledgers, rolls and correspondence.</div></header>
      <nav class="tabs book" role="tablist">${TABS.map(([t, n, ic]) => html`<button class="t ${t === this.tab ? 'on' : ''}" data-act="tab:${t}" role="tab" aria-selected="${t === this.tab ? 'true' : 'false'}">${icon(ic, 15)}${n}</button>`)}</nav>
      <div class="content scroll">${body}</div>`);
    for (const c of this.panel.querySelectorAll<HTMLCanvasElement>('canvas[data-graph]')) this.graph(c, c.dataset.graph!);
  }

  private th(k: string, label: string) {
    return html`<th data-act="sort:${k}">${label}${this.sort.key === k ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  }
  private sorted<T>(list: T[], get: (t: T, k: string) => any): T[] {
    const { key, dir } = this.sort;
    return [...list].sort((a, b) => {
      const x = get(a, key), y = get(b, key);
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }

  private overview() {
    const g = this.app.game;
    const s = computeScore(g);
    const k = g.king;
    return html`<div class="cols2">
      <div><div class="king-card">${raw(portraitImg(k.portrait, 110))}
        <div><h3 style="margin-top:0">${k.name}, Pirate ${k.sex === 'F' ? 'Queen' : 'King'}</h3>
        <div style="font-size:14px">${BACKGROUNDS[k.bg].name} · ${k.q.map((q) => QUALITIES[q].name).join(', ')} · <i>${FLAWS[k.flaw].name}</i></div>
        <div class="sub">Reigning since January 1680. ${Math.max(0, g.settings.years - g.yearsElapsed).toFixed(1)} of ${g.settings.years} years remain.</div></div></div>
        <h3>Score so far</h3>
        <table class="ledger"><tr><td>Hoard</td><td>${fmt(s.hoard)}</td></tr><tr><td>Pirate happiness</td><td>${fmt(s.happiness)}</td></tr><tr><td>Fleet</td><td>${fmt(s.fleet)}</td></tr>
        <tr><td>Captains</td><td>${fmt(s.captains)}</td></tr><tr><td>Pirates</td><td>${fmt(s.pirates)}</td></tr><tr><td>Bonus objective: ${s.bonusKey}</td><td>×3</td></tr>
        <tr><td>Difficulty</td><td>${Math.round(s.difficulty * 100)}%</td></tr><tr><td><b>Total</b></td><td><b>${fmt(s.total)}</b> (${s.medal})</td></tr></table>
        <div class="sub">For a ${g.settings.years}-year reign: gold medal at ${fmt(medalThresholds(g.settings.years).gold)} points, silver at ${fmt(medalThresholds(g.settings.years).silver)}.</div></div>
      <div><h3 style="margin-top:0">Your Hoard</h3>
        <div style="font-size:15px">${g.buildingCount('cave') ? html`Skimming <b>${Math.round(g.hoardRate * 100)}%</b> of all income into your cave. The treasury pays for everything else.` : 'Build a Pirate Cave to start your hoard. The hoard is your score.'}</div>
        <div class="field-row"><span class="lbl">Skim</span><div class="seg full" role="radiogroup">${[0, 0.05, 0.1, 0.15, 0.2, 0.25].map((v) => html`<button class="${Math.abs(g.hoardRate - v) < 0.001 ? 'on' : ''}" data-act="hoard:${v}">${Math.round(v * 100)}%</button>`)}</div></div>
        <h3>Treasury & Hoard</h3><canvas data-graph="money" width="460" height="150" style="width:100%;height:150px"></canvas>
        <h3>Happiness & Resignation</h3><canvas data-graph="mood" width="460" height="120" style="width:100%;height:120px"></canvas>
        <h3>Deeds</h3><div class="kv">
        <span>Gold plundered</span><span>${fmt(g.stats.plundered)}</span><span>Souls captured</span><span>${g.stats.captured}</span><span>Recruits</span><span>${g.stats.recruits}</span>
        <span>Ships lost</span><span>${g.stats.shipsSunk}</span><span>Escapes</span><span>${g.stats.escapes} (${g.stats.escapeKills} caught)</span><span>Deaths</span><span>${g.stats.deaths}</span></div></div></div>`;
  }

  private finances() {
    const g = this.app.game;
    const inc = g.finance.lastIncome, exp = g.finance.lastExpense, cur = g.finance.income, cure = g.finance.expense;
    const cats = [...new Set([...Object.keys(inc), ...Object.keys(cur)])];
    const ecats = [...new Set([...Object.keys(exp), ...Object.keys(cure)])];
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    const venues = [...g.buildings.values()].filter((b) => BUILDING[b.def].service).sort((a, b) => b.lastIncome - a.lastIncome).slice(0, 12);
    return html`<div class="cols2"><div>
      <h3 style="margin-top:0">Income</h3><table class="ledger"><tr><th>Source</th><th>Last month</th><th>This month</th></tr>
      ${cats.map((c) => html`<tr><td>${c[0].toUpperCase() + c.slice(1)}</td><td>${fmt(inc[c] ?? 0)}</td><td>${fmt(cur[c] ?? 0)}</td></tr>`)}<tr><td><b>Total</b></td><td><b>${fmt(sum(inc))}</b></td><td><b>${fmt(sum(cur))}</b></td></tr></table>
      <h3>Expenses</h3><table class="ledger"><tr><th>Item</th><th>Last month</th><th>This month</th></tr>
      ${ecats.map((c) => html`<tr><td>${c[0].toUpperCase() + c.slice(1)}</td><td>${fmt(exp[c] ?? 0)}</td><td>${fmt(cure[c] ?? 0)}</td></tr>`)}<tr><td><b>Total</b></td><td><b>${fmt(sum(exp))}</b></td><td><b>${fmt(sum(cure))}</b></td></tr></table></div>
      <div><h3 style="margin-top:0">Best Earning Establishments</h3><table class="ledger"><tr><th>Name</th><th>Type</th><th>Last month</th></tr>
      ${venues.map((b) => html`<tr><td>${b.name ?? ''}</td><td>${BUILDING[b.def].name}</td><td>${fmt(b.lastIncome)}</td></tr>`)}</table>
      <h3>Income vs Expenses</h3><canvas data-graph="flow" width="460" height="160" style="width:100%;height:160px"></canvas></div></div>`;
  }

  private satisfaction() {
    const g = this.app.game;
    const pir = g.pirates().filter((p) => p.task.kind !== 'atsea');
    const avg = (k: string) => (pir.length ? pir.reduce((a, p) => a + (p.opinion[k] ?? 0.5), 0) / pir.length : 0);
    const needs: [string, string][] = [['feast', 'Grub'], ['drink', 'Grog'], ['company', 'Company'], ['gamble', 'Wagers'], ['rest', 'Rest'], ['stash', 'Stash']];
    const unhappy = [...pir].sort((a, b) => a.happiness - b.happiness).slice(0, 12);
    const cap = g.captives().filter((c) => c.kind === 'captive');
    const cavg = (k: string) => (cap.length ? cap.reduce((a, p) => a + (p.opinion[k] ?? 0.5), 0) / cap.length : 0);
    const broke = pir.filter((p) => p.gold < 5).length;
    const homeless = pir.filter((p) => !p.home).length;
    return html`<div class="cols2"><div>
      <h3 style="margin-top:0">Pirates ashore (${pir.length})</h3><div class="meters">${needs.map(([k, n]) => html`<span>${n}</span>${bar(avg(k))}<span>${pct(avg(k))}</span>`)}
      </div><div class="meters total"><span>Happiness</span>${bar(g.avgHappiness())}<span>${pct(g.avgHappiness())}</span></div>
      <div class="sub" style="margin-top:6px">${broke} broke · ${homeless} homeless · ${pir.filter((p) => p.mood !== 'ok').length} disgruntled</div>
      <h3>Least Happy</h3><table class="ledger"><tr><th>Name</th><th>Rank</th><th>Happiness</th><th>Gold</th></tr>
      ${unhappy.map((p) => html`<tr data-act="person:${p.id}" style="cursor:pointer"><td>${p.name}</td><td>${RANKS[p.rank - 1].name}</td><td>${pct(p.happiness)}</td><td>${fmt(p.gold)}</td></tr>`)}</table></div>
      <div><h3 style="margin-top:0">Captives (${cap.length})</h3><div class="meters">
      ${[['food', 'Food'], ['rest', 'Rest'], ['prayer', 'Prayer']].map(([k, n]) => html`<span>${n}</span>${bar(cavg(k))}<span>${pct(cavg(k))}</span>`)}
      </div><div class="meters total"><span>Resignation</span>${bar(g.avgResignation())}<span>${pct(g.avgResignation())}</span></div>
      <div class="sub" style="margin-top:6px">Resigned captives work and stay put. Restless ones run for the beach, and might take others with them.</div>
      <div class="sub">${cap.filter((c) => !c.job).length} unemployed · ${cap.filter((c) => c.skilled).length} skilled</div></div></div>`;
  }

  private pirates() {
    const g = this.app.game;
    const list = this.sorted(g.pirates(), (p, k) => (k === 'name' ? p.name : k === 'rank' ? p.rank : k === 'gold' ? p.gold : k === 'hap' ? p.happiness : k === 'cour' ? p.traits.courage : k === 'lead' ? p.traits.leadership : k === 'not' ? p.traits.notoriety : activityText(this.app, p)));
    return html`<div class="table-wrap"><table class="ledger"><tr>${this.th('name', 'Name')}${this.th('rank', 'Rank')}${this.th('gold', 'Gold')}${this.th('hap', 'Happiness')}${this.th('cour', 'Courage')}${this.th('lead', 'Leadership')}${this.th('not', 'Notoriety')}${this.th('act', 'Doing')}</tr>
      ${list.map((p) => html`<tr data-act="person:${p.id}" style="cursor:pointer"><td>${p.captain ? html`<span class="tag-ic" title="Captain">${icon('anchor', 14)}</span> ` : ''}${p.name}</td><td>${RANKS[p.rank - 1].name}</td><td>${fmt(p.gold)}</td><td>${pct(p.happiness)}${p.mood !== 'ok' ? ' ☹' : ''}</td><td>${p.traits.courage}</td><td>${p.traits.leadership}</td><td>${Math.round(p.traits.notoriety)}</td><td>${activityText(this.app, p)}</td></tr>`)}</table></div>`;
  }

  private captives() {
    const g = this.app.game;
    const list = this.sorted(g.captives(), (p, k) => (k === 'name' ? p.name : k === 'job' ? p.jobRole ?? '' : k === 'res' ? p.resignation : k === 'cour' ? p.traits.courage : k === 'lead' ? p.traits.leadership : k === 'ransom' ? p.ransom : k === 'nat' ? p.nat : p.profession));
    return html`<div class="table-wrap"><table class="ledger"><tr>${this.th('name', 'Name')}${this.th('nat', 'Nation')}${this.th('prof', 'Skill')}${this.th('job', 'Job')}${this.th('res', 'Resignation')}${this.th('cour', 'Courage')}${this.th('lead', 'Leadership')}${this.th('ransom', 'Ransom')}</tr>
      ${list.map((p) => html`<tr data-act="person:${p.id}" style="cursor:pointer"><td>${p.name}</td><td>${NATION_ADJ[p.nat]}</td><td>${p.kind === 'skeleton' ? 'Skeleton' : p.skilled ? JOB_NAMES[p.profession as keyof typeof JOB_NAMES] : '-'}</td><td>${p.jobRole ? JOB_NAMES[p.jobRole] : 'idle'}</td><td>${pct(p.resignation)}</td><td>${p.traits.courage}</td><td>${p.traits.leadership}</td><td>${p.ransom ? fmt(p.ransom) : '-'}</td></tr>`)}
      ${[...g.people.values()].filter((p) => p.kind === 'wealthy').map((p) => html`<tr data-act="person:${p.id}" style="cursor:pointer"><td><span class="tag-ic" title="Wealthy">${icon('coin', 14)}</span> ${p.name}</td><td>${NATION_ADJ[p.nat]}</td><td>Wealthy</td><td>-</td><td>-</td><td>-</td><td>-</td><td>${fmt(p.ransom + p.credit)}</td></tr>`)}</table></div>`;
  }

  private nations() {
    const g = this.app.game;
    return html`<div class="cards-grid">${NATIONS.map((n) => {
      const st = g.nations[n];
      const rel = relationLevel(st.relation);
      const policy = g.ongoing.has(`patron:${n}`) ? 'Patron' : g.ongoing.has(`peace:${n}`) ? 'Promised Peace' : g.ongoing.has(`prohibit_${n}`) ? 'Leave Their Ships Alone' : 'Fair Game';
      return html`<div class="ecard"><h4>${NATION_NAMES[n]}</h4>
        <div class="meters"><span>Relations</span>${bar((st.relation + 100) / 200)}<span>${st.relation > 0 ? "+" : ""}${Math.round(st.relation)}</span></div>
        <div style="font-size:15px"><b>${rel}</b> · Policy: ${policy}</div>
        <div style="font-size:14px">${st.knows ? html`<b style="color:#8a1a10">They know where your island is.</b>` : 'Your island is still a secret.'}</div>
        <div style="font-size:14px">Plundered from them: ${fmt(st.plunderGold)} gold</div>
        <div style="font-size:14px">${st.atWarWith.length ? `At war with ${st.atWarWith.map((x) => NATION_NAMES[x]).join(' and ')}` : 'At peace in Europe'}</div>
        ${st.invasion.stage ? html`<div class="why">Invasion ${['', 'rumoured', 'fleet assembling', 'underway!'][st.invasion.stage]}</div>` : ''}</div>`;
    })}</div>
    <div class="sub" style="margin-top:10px">A Power that hates you and knows where you are will eventually invade. Forts and warships defend the island. Announcing peace improves relations every month, and with harmonious relations a Power can become your patron, which protects you from all invasions.</div>`;
  }

  private ships() {
    const g = this.app.game;
    const list = [...g.ships.values()];
    return html`<div class="table-wrap"><table class="ledger"><tr><th>Ship</th><th>Type</th><th>Captain</th><th>Crew</th><th>Status</th><th>Mission</th><th>Hull</th><th>Cannons</th></tr>
      ${list.map((s) => html`<tr data-act="ship:${s.id}" style="cursor:pointer"><td>${s.name}</td><td>${SHIPS[s.type].name}</td><td>${g.people.get(s.captain)?.name ?? '-'}</td><td data-tip="${s.crew.length} of ${SHIPS[s.type].men + SHIPS[s.type].officers} hands">${icon('pirate', 14)} ${s.crew.length}<span class="dim">/${SHIPS[s.type].men + SHIPS[s.type].officers}</span></td><td><span class="chip ${s.status === 'docked' ? 'ok' : ''}">${shipStatusName(s.status)}</span></td><td>${MISSION_NAMES[s.mission]} <span class="dim">· ${g.regions[s.region].name}</span></td><td data-tip="Hull ${pct(s.hull)}" style="min-width:60px">${bar(s.hull)}</td><td data-tip="${s.cannons} cannons">${icon('g_cannon', 14)} ${s.cannons}</td></tr>`)}</table></div>
      ${!list.length ? html`<div class="sub">No ships. Build a Boatyard (needs a skilled shipwright) and a Dock.</div>` : ''}`;
  }

  private messages() {
    const g = this.app.game;
    return html`<table class="ledger"><tr><th>Date</th><th>Event</th><th></th></tr>${[...g.messages].reverse().slice(0, 120).map((m) => html`<tr data-act="msg:${m.id}" style="cursor:pointer"><td style="white-space:nowrap">${m.date}</td><td><b style="font-family:var(--head);font-weight:normal">${m.title}</b>${m.data?.kind === 'voyage' ? html`<div class="vcompact">${voyageStrip(m.data, false)}</div>` : html`: ${m.text.split('\n')[0].slice(0, 140)}`}</td><td><span class="chip ${m.kind === 'bad' || m.kind === 'alert' ? 'bad' : m.kind === 'good' ? 'ok' : ''}">${m.kind === 'bad' ? 'trouble' : m.kind === 'alert' ? 'alarm' : m.kind}</span></td></tr>`)}</table>`;
  }

  private graph(c: HTMLCanvasElement, kind: string): void {
    const g = this.app.game;
    const h = g.history;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90,60,30,0.3)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    if (h.length < 2) {
      ctx.fillStyle = '#5a4024';
      ctx.font = 'italic 14px "IM Fell English", Georgia';
      ctx.fillText('Not enough history yet...', 12, H / 2);
      return;
    }
    const series: [string, number[], string][] =
      kind === 'money' ? [['Treasury', h.map((x) => x.treasury), '#8a6420'], ['Hoard', h.map((x) => x.hoard), '#a01a10']]
        : kind === 'mood' ? [['Happiness', h.map((x) => x.happiness * 100), '#d07020'], ['Resignation', h.map((x) => x.resignation * 100), '#6a6a80']]
          : [['Income', h.map((x) => x.income), '#3a7a2a'], ['Expenses', h.map((x) => x.expense), '#a01a10']];
    const all = series.flatMap((s) => s[1]);
    const lo = Math.min(0, ...all), hi = Math.max(1, ...all);
    const X = (i: number) => 8 + (i / (h.length - 1)) * (W - 16), Y = (v: number) => H - 14 - ((v - lo) / (hi - lo)) * (H - 28);
    series.forEach(([name, vals, col], si) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      vals.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = '14px "IM Fell English", Georgia';
      ctx.fillText(`${name}: ${fmt(vals[vals.length - 1])}`, 10 + si * 160, 14);
    });
  }
}
