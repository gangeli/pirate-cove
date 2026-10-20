import type { App } from './app';
import { el, html, patchHTML, delegate, fmt, pct, bar, raw } from './dom';
import { icon } from './icons';
import { BUILDING, HOUSE_LEVELS, JOB_NAMES, RANKS, PRICE_LEVELS, type PirateNeed } from '../sim/data/buildings';
import { GOOD_NAMES, type Good } from '../sim/data/goods';
import { SHIPS, SHIP_LIST, MISSION_NAMES, SPOILS_TREASURY, type ShipType } from '../sim/data/ships';
import { NATION_ADJ, NATION_NAMES, NATIONS } from '../sim/data/kings';
import type { Building, Person, Ship } from '../sim/types';
import { serviceFee, serviceBand, pirateFactors } from '../sim/people';
import { farmFertility, treesNear } from '../sim/economy';
import { portrait, portraitImg, portraitIdFor, type PortraitSpec } from './portraits';
import { audio } from '../audio/audio';
import { thumbOrQueue, THUMB_PLACEHOLDER } from './thumbs';
import { regionReachable, transitTime } from '../sim/sea';
import { MONTH } from '../sim/time';

const NEED_NAMES: Record<string, string> = { feast: 'Grub', drink: 'Grog', company: 'Company', gamble: 'Wagers', rest: 'Rest', stash: 'Stash', food: 'Food', prayer: 'Prayer', anarchy: 'Freedom', defense: 'Safety' };

export function activityText(app: App, p: Person): string {
  const g = app.game;
  const t = p.task;
  const b = t.bld ? g.buildings.get(t.bld) : undefined;
  const bn = b ? (b.name ?? BUILDING[b.def].name) : '';
  const walking = t.phase === 0;
  switch (t.kind) {
    case 'work': return walking ? `Heading to work at the ${bn}` : p.kind === 'pirate' ? `Overseeing the ${bn}` : `Working at the ${bn}`;
    case 'guard': return walking ? `Going on guard duty` : `Standing guard at the ${bn}`;
    case 'haul': return p.carrying ? `Hauling ${GOOD_NAMES[p.carrying].toLowerCase()} to the ${bn}` : `Fetching ${t.good ? GOOD_NAMES[t.good].toLowerCase() : 'goods'} for the ${bn}`;
    case 'build': return walking ? `Off to a building site` : `Building the ${bn}`;
    case 'visit': return walking ? `Going to ${bn} for ${NEED_NAMES[t.need ?? '']?.toLowerCase()}` : `Enjoying ${bn}`;
    case 'eat': return walking ? 'Going to eat' : 'Eating slop';
    case 'sleep': return walking ? 'Going to bed' : b ? `Sleeping at the ${bn}` : 'Sleeping in the dirt';
    case 'pray': return walking ? 'Going to church' : 'Praying';
    case 'stash': return walking ? 'Going home to stash gold' : 'Stashing gold';
    case 'board': return 'Answering the ship\'s bell';
    case 'atsea': return 'At sea';
    case 'escape': return 'Running for the beach!';
    case 'chase': return 'Chasing a runaway';
    case 'fight': return 'Fighting!';
    case 'rebel': return p.kind === 'soldier' ? 'Marching on the palace' : 'In open rebellion!';
    case 'party': return 'Carousing';
    case 'wander': return 'Strolling about';
    case 'school': return 'At school';
    case 'dead': return 'Dead';
  }
  return 'Idle';
}

export function lookSpec(p: Person): PortraitSpec {
  const h = (s: number) => {
    let x = Math.imul(p.id * 2654435761 + s * 40503, 0x5bd1e995);
    x ^= x >>> 13;
    return ((Math.imul(x, 0x5bd1e995) ^ (x >>> 15)) >>> 0) / 4294967296;
  };
  const skins = ['#f1c8a8', '#e0ac88', '#c68a62', '#a0663e', '#7a4a2a'];
  const hairs = ['#1a1210', '#3a2414', '#5a3a1e', '#8a5a2a', '#b8884a', '#9a3a1a'];
  const coats = ['#6a2a20', '#2a3a5a', '#4a3a2a', '#3a4a2a', '#5a2a4a', '#2a2a2a'];
  const spec: PortraitSpec = {
    sex: p.sex, skin: skins[Math.floor(h(1) * skins.length)], hair: hairs[Math.floor(h(2) * hairs.length)],
    hairStyle: p.sex === 'F' ? (h(3) < 0.5 ? 'long' : 'curly') : h(3) < 0.2 ? 'bald' : h(3) < 0.6 ? 'short' : 'tied',
    beard: p.sex === 'M' ? (['none', 'stubble', 'full', 'goatee', 'moustache'] as const)[Math.floor(h(4) * 5)] : 'none',
    coat: coats[Math.floor(h(5) * coats.length)], bg: '#3a5a6a', age: p.age > 40 ? 0.7 : 0.2,
  };
  if (p.kind === 'pirate') {
    spec.hat = p.captain || p.accessories.hat ? 'tricorn' : h(6) < 0.6 ? 'bandana' : 'none';
    spec.hatColor = ['#a02020', '#1a1a1a', '#2a4a8a', '#6a1a5a'][Math.floor(h(7) * 4)];
    if (p.captain || p.accessories.hat) spec.hatColor = '#1a1612';
    spec.eyepatch = h(8) < 0.18;
    spec.earring = h(9) < 0.5;
    spec.scar = h(10) < 0.3;
    spec.grin = p.happiness > 0.6;
    spec.bg = p.captain ? '#5a3a1a' : '#4a3a3a';
  } else if (p.kind === 'captive') {
    spec.coat = p.sex === 'F' ? '#a83a30' : '#7a7a74';
    spec.bg = '#4a4a4a';
    spec.hat = p.sex === 'F' && h(12) < 0.4 ? 'scarf' : 'none';
    spec.hatColor = '#e8e0d0';
  } else if (p.kind === 'wealthy') {
    spec.coat = '#4a1a6a';
    spec.hat = p.sex === 'M' ? 'feather' : 'none';
    spec.bg = '#5a4a2a';
  } else if (p.kind === 'soldier') {
    spec.coat = p.nat === 'eng' ? '#a81c1c' : p.nat === 'fra' ? '#1c3a8a' : '#e0d8b0';
    spec.hat = 'tricorn';
  } else if (p.kind === 'skeleton') {
    spec.skin = '#e8e0c8';
    spec.hairStyle = 'bald';
    spec.beard = 'none';
    spec.coat = '#3a3028';
    spec.bg = '#2a2a2a';
  }
  return spec;
}

export class Inspector {
  private panel: HTMLElement;
  private tab = 'overview';
  private lastKey = '';

  constructor(private app: App) {
    this.panel = el('div', 'panel inspector hidden', app.root);
    delegate(this.panel, {
      close: () => app.select(null),
      tab: (t) => {
        this.tab = t;
        this.refresh(true);
      },
      follow: () => app.follow(),
      goto: (id) => {
        const p = app.game.people.get(+id);
        if (p) {
          app.select({ type: 'person', id: p.id });
          app.jumpTo(p.x, p.y);
        }
      },
      gotoB: (id) => {
        const b = app.game.buildings.get(+id);
        if (b) {
          app.select({ type: 'building', id: b.id });
          app.jumpTo(b.x + b.w / 2, b.y + b.h / 2);
        }
      },
      gotoS: (id) => {
        const s = app.game.ships.get(+id);
        if (s) {
          app.select({ type: 'ship', id: s.id });
          if (s.status !== 'atsea') app.jumpTo(s.vx, s.vy);
        }
      },
      prio: (v) => this.bcmd({ type: 'setPriority', id: this.sel(), priority: +v }),
      wage: (v) => this.bcmd({ type: 'setWage', id: this.sel(), wage: +v }),
      price: (v) => this.bcmd({ type: 'setPrice', id: this.sel(), price: +v }),
      quality: (v) => this.bcmd({ type: 'setQuality', id: this.sel(), quality: +v }),
      block: (d) => this.bcmd({ type: 'blockSlot', id: this.sel(), delta: +d }),
      fire: (pid) => this.bcmd({ type: 'fire', id: this.sel(), person: +pid }),
      demolish: () => app.demolishAsk(this.sel()),
      commission: (t) => {
        if (app.cmd({ type: 'commission', yard: this.sel(), ship: t as ShipType })) audio.sfx('build_place');
        this.refresh(true);
      },
      edict: (arg) => {
        const [id, extra] = arg.split('|');
        app.edicts.issue(id, this.sel(), undefined, extra);
        this.refresh(true);
      },
      raise: () => {
        app.edicts.issue('raise_dead');
        this.refresh(true);
      },
      mission: (m) => this.scmd({ mission: m as any }),
      orders: (o) => this.scmd({ orders: o as any }),
      spoils: (s) => this.scmd({ spoils: s as any }),
      kidnap: (j) => this.scmd({ kidnapJob: j as any }),
      foster: (n) => this.scmd({ foster: n as any }),
      chart: () => app.chart.open(this.sel()),
      sail: () => {
        const s = app.game.ships.get(this.sel());
        if (app.cmd({ type: 'setSail', ship: this.sel(), force: s?.status === 'boarding' })) audio.sfx('ship_bell');
        this.refresh(true);
      },
      bm: () => {
        if (app.cmd({ type: 'buyBlackMarket', ship: this.sel() })) audio.sfx('coins');
        this.refresh(true);
      },
      scuttle: () => app.modal.confirm('Scuttle this ship?', 'The ship will be sunk at her moorings. The crew will survive.', () => {
        app.cmd({ type: 'scuttle', ship: this.sel() });
        app.select(null);
      }),
      shipEdict: (id) => {
        app.edicts.issue(id, this.sel());
        this.refresh(true);
      },
      rename: () => {
        const b = app.game.buildings.get(this.sel());
        if (!b) return;
        const name = prompt('Name this establishment:', b.name ?? '');
        if (name) app.cmd({ type: 'rename', id: b.id, name });
        this.refresh(true);
      },
    }, () => audio.sfx('ui_click'));
  }

  private onThumb = (): void => this.refresh(true);

  private sel(): number {
    return this.app.selection?.id ?? 0;
  }
  private bcmd(c: any): void {
    this.app.cmd(c);
    this.refresh(true);
  }
  private scmd(o: any): void {
    this.app.cmd({ type: 'shipOrders', ship: this.sel(), ...o });
    this.refresh(true);
  }

  private lastRefresh = 0;
  refresh(force = false): void {
    // don't rebuild under the cursor too often, or clicks can land on replaced elements
    if (!force && this.panel.matches(':hover') && performance.now() - this.lastRefresh < 1500) return;
    this.lastRefresh = performance.now();
    const s = this.app.selection;
    if (!s) {
      this.panel.classList.add('hidden');
      return;
    }
    const key = `${s.type}:${s.id}`;
    const changed = key !== this.lastKey;
    if (changed) {
      if (this.lastKey && !this.lastKey.startsWith(`${s.type}:`)) this.tab = 'overview';
      this.lastKey = key;
    }
    let v: View;
    if (s.type === 'building') {
      const b = this.app.game.buildings.get(s.id);
      if (!b) return this.app.select(null);
      v = this.building(b);
    } else if (s.type === 'person') {
      const p = this.app.game.people.get(s.id);
      if (!p) return this.app.select(null);
      v = this.person(p);
    } else {
      const sh = this.app.game.ships.get(s.id);
      if (!sh) return this.app.select(null);
      v = this.ship(sh);
    }
    this.panel.classList.remove('hidden');
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>
      <header class="ins-head">${v.head}</header>
      <div class="ins-body scroll">${v.body}</div>
      ${v.foot ? html`<footer class="ins-foot">${v.foot}</footer>` : ''}`);
    if (changed) this.panel.querySelector('.ins-body')?.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------------------------------------ building
  private building(b: Building): View {
    const g = this.app.game;
    const def = BUILDING[b.def];
    const body = [];
    const title = def.service && b.name ? b.name : def.house && b.houseLevel ? HOUSE_LEVELS[b.houseLevel - 1].name : def.name;
    const thumb = thumbOrQueue(this.app.world, def.id, this.onThumb) ?? THUMB_PLACEHOLDER;
    const chips = [];
    const staffed = def.workers.length > 0 || !!def.overseer || !!def.guards;
    if (b.built < 1) chips.push(html`<span class="chip warn">Being built · ${pct(b.built)}</span>`);
    else if (staffed) chips.push(b.staff >= 0.99 ? html`<span class="chip ok">Fully staffed</span>` : b.staff < 0.5 ? html`<span class="chip bad">Short-staffed</span>` : html`<span class="chip">Partly staffed</span>`);
    if (b.built >= 1 && def.upkeep) chips.push(html`<span class="chip">${icon('coin', 12)} ${def.upkeep}/month</span>`);
    const head = html`<div class="tile thumb"><img src="${thumb}" alt=""></div>
      <div class="hd"><h2>${title}${def.service && b.built >= 1 ? html` <button class="icon-link" data-act="rename" aria-label="Rename" data-tip="Rename this establishment">${icon('scroll', 14)}</button>` : ''}</h2>
        <div class="sub">${def.service && b.name ? def.name + ' · ' : ''}${def.desc}</div>
        ${chips.length ? html`<div class="chips">${chips}</div>` : ''}</div>`;
    if (b.built < 1) {
      body.push(html`<section class="sect"><h4 class="eng">Construction</h4>
        <div class="meters"><span>Built</span>${bar(b.built, 'brass')}<span>${pct(b.built)}</span></div>
        ${g.buildingCount('construction_tent') ? html`<div class="seg-note">Builders from the construction tents will finish it.</div>` : html`<div class="callout bad">${icon('info', 16)}<span>You need a Construction Tent and builders.</span></div>`}</section>
        <section class="sect"><h4 class="eng">Priority</h4>${this.prioSeg(b)}<div class="seg-note">Builders go to higher-priority sites first.</div></section>`);
    } else {
      // staff
      const slots = def.workers.filter((w) => w.job !== 'hauler' || def.id === 'dock');
      if (slots.length || def.haulers || def.overseer || def.guards) {
        const rows = [];
        for (const sl of def.workers) {
          const list = sl.job === 'hauler' ? b.haulers.concat(b.workers.filter((id) => g.people.get(id)?.jobRole === 'hauler')) : b.workers.filter((id) => g.people.get(id)?.jobRole === sl.job);
          rows.push(this.slotRow(JOB_NAMES[sl.job] + (sl.count > 1 ? 's' : ''), sl.count, [...new Set(list)], b));
        }
        if (def.haulers && !def.workers.some((w) => w.job === 'hauler')) rows.push(this.slotRow(def.haulers > 1 ? 'Haulers' : 'Hauler', def.haulers, b.haulers, b));
        if (def.overseer || def.guards) rows.push(this.slotRow(def.guards ? 'Guards' : 'Overseer', def.guards ?? 1, [b.overseer, ...b.guards].filter(Boolean), b, true));
        const total = def.workers.reduce((a, w) => a + w.count, 0);
        body.push(html`<section class="sect"><h4 class="eng">Staff</h4><div class="slotrows">${rows}</div>
          ${total ? html`<div class="field-row"><span class="lbl">Open places</span><div class="step"><button data-act="block:1" aria-label="Close a place" data-tip="Close a place: fewer workers here">${icon('minus', 14)}</button><span class="val">${total - Math.min(total, b.blocked)} of ${total}</span><button data-act="block:-1" aria-label="Open a place" data-tip="Open a closed place">${icon('plus', 14)}</button></div></div>` : ''}
          ${def.overseer || def.guards ? html`<div class="field-row"><span class="lbl">${def.guards ? 'Guard wage' : 'Overseer wage'}</span>${this.seg('wage', b.wage, [[0, 'Unpaid'], [2, '2g'], [4, '4g'], [8, '8g'], [12, '12g']])}</div>
            <div class="seg-note">Gold a month for each ${def.guards ? 'guard' : 'overseer'}. Pirates take the best-paid posts first.</div>` : ''}
          <div class="field-row"><span class="lbl">Priority</span>${this.prioSeg(b)}</div>
          <div class="seg-note">Higher-priority buildings are staffed first, taking workers from lower ones.</div></section>`);
      }
      // production
      if (def.recipe || def.gather) {
        const r = def.recipe;
        const out = r?.out ?? def.gather!.out;
        const rows = [html`<span>Progress</span>${bar(b.progress, 'brass')}<span>${pct(b.progress)}</span>`];
        if (def.gather?.crop) {
          const f = farmFertility(g, b, def.gather.crop);
          rows.push(html`<span>Soil</span>${bar(f)}<span>${pct(f)}</span>`);
        }
        body.push(html`<section class="sect"><h4 class="eng">Production</h4>
          <div class="flow">${r ? Object.entries(r.in).map(([k, v]) => html`<span class="good">${v}× ${GOOD_NAMES[k as Good]} <b>${Math.floor(b.inv[k as Good] ?? 0)}</b></span>`) : ''}
            ${r ? html`<span class="arrow">→</span>` : ''}<span class="good out">${GOOD_NAMES[out]} <b>${Math.floor(b.inv[out] ?? 0)}</b></span></div>
          <div class="meters">${rows}</div>
          ${def.gather?.from === 'trees' ? html`<div class="seg-note">${treesNear(g, b, 9)} trees within reach.</div>` : ''}</section>`);
      }
      // service
      if (def.service) {
        const sv = def.service;
        const [lo, hi] = serviceBand(b);
        body.push(html`<section class="sect"><h4 class="eng">Customers <span class="aside">${b.customers.length} of ${sv.capacity}</span></h4>
          <div class="slots">${Array.from({ length: sv.capacity }, (_, i) => {
            const id = b.customers[i];
            const p = id ? g.people.get(id) : null;
            const present = p && p.task.phase === 1;
            return p ? html`<button class="slot ${present ? '' : 'res'}" data-act="goto:${p.id}" data-tip="${p.name}${present ? '' : ' (on the way)'}">${icon('pirate', 18)}</button>` : html`<span class="slot empty"></span>`;
          })}</div>
          <div class="kv" style="margin-top:8px"><span>Satisfies</span><span>${Object.keys(sv.needs).map((n) => NEED_NAMES[n]).join(', ')}</span>
            <span>Extras</span><span>${sv.bonus.length ? sv.bonus.map((x) => `${GOOD_NAMES[x]} (${Math.floor(b.inv[x] ?? 0)})`).join(', ') : 'none'}</span>
            <span>Serves</span><span>${RANKS[lo - 1].name} to ${RANKS[hi - 1].name}</span>
            <span>Fee</span><span>${serviceFee(b)} gold a visit</span><span>Last month</span><span>${fmt(b.lastIncome)} gold</span></div></section>
          <section class="sect"><h4 class="eng">Running it</h4>
          <div class="field-row"><span class="lbl">Prices</span>${this.seg('price', b.price, PRICE_LEVELS.map((n, i) => [i, ['Bargain', 'Middling', "Gouge 'em"][i] ?? n] as [number, string]))}</div>
          <div class="field-row" data-tip="Narrow the clientele to a band of ranks. Pirates outside the band enjoy it less."><span class="lbl">Clientele</span>${this.seg('quality', b.quality, [[0, 'All'], ...[1, 2, 3].filter((q) => sv.ranks[0] + q + 1 <= sv.ranks[1]).map((q) => [q, `Ranks ${sv.ranks[0] + q - 1}–${sv.ranks[0] + q + 1}`] as [number, string])])}</div></section>`);
      }
      if (def.captiveService) body.push(html`<section class="sect"><div class="kv"><span>${NEED_NAMES[def.captiveService.need]}</span><span>${b.customers.length} of ${def.captiveService.capacity} places in use</span></div></section>`);
      if (def.house) {
        const o = b.owner ? g.people.get(b.owner) : null;
        const lv = HOUSE_LEVELS[(b.houseLevel ?? 1) - 1];
        body.push(html`<section class="sect"><h4 class="eng">Dwelling</h4><div class="kv"><span>Owner</span><span>${o ? html`<a data-act="goto:${o.id}">${o.name}</a>` : 'Vacant'}</span>
          <span>Kind</span><span>${lv.name}</span><span>Rest</span><span>${pct(lv.rest)}</span><span>Stash fee</span><span>${lv.fee} gold</span></div>
          <div class="seg-note">Plots grow into finer homes when the owner rises in rank and can pay.</div></section>`);
      }
      if (def.id === 'dock') {
        const s = b.ship ? g.ships.get(b.ship) : null;
        body.push(html`<section class="sect"><h4 class="eng">Berth</h4>${s ? html`<button class="pick" data-act="gotoS:${s.id}">${icon('ship', 18)}<span class="nm">${s.name}<small>${SHIPS[s.type].name}</small></span><span class="chip">${s.status === 'atsea' ? 'At sea' : s.status === 'docked' ? 'In port' : s.status}</span></button>` : html`<div class="seg-note">Empty. Every ship needs a free dock.</div>`}</section>`);
      }
      if (def.id === 'boatyard' || def.id === 'shipyard') {
        if (b.building_ship) body.push(html`<section class="sect"><h4 class="eng">On the slipway</h4><div class="meters"><span>${SHIPS[b.building_ship.type].name}</span>${bar(b.building_ship.progress, 'brass')}<span>${pct(b.building_ship.progress)}</span></div></section>`);
        else body.push(html`<section class="sect"><h4 class="eng">Commission a ship</h4><div class="ship-cards">${SHIP_LIST.filter((t) => def.id === 'shipyard' || SHIPS[t].yard === 'boatyard').map((t) => {
          const d = SHIPS[t];
          const ok = g.treasury >= d.gold && g.lumber() >= d.lumber;
          return html`<button class="ship-card ${ok ? '' : 'disabled'}" data-act="commission:${t}" data-tip="Crew ${d.men}+${d.officers}+captain · ${d.cannons} cannons · speed ${d.speed} · ${d.rations} rations">
            <b>${d.name}</b><span class="cost">${d.gold ? html`${icon('coin', 12)} ${d.gold} ` : ''}${icon('lumber', 12)} ${d.lumber}</span><small>${d.men + d.officers + 1} crew · ${d.cannons} guns</small></button>`;
        })}</div></section>`);
      }
      if (def.id === 'graveyard') body.push(html`<section class="sect"><div class="kv"><span>Corpses</span><span>${g.graveyard.length}</span></div><div class="actions"><button class="btn small" data-act="raise">Raise the dead (${this.app.edicts.cost('raise_dead')} gold)</button></div></section>`);
      if (def.id === 'smugglers_cove') body.push(html`<section class="sect"><h4 class="eng">Trade</h4><div class="kv">${NATIONS.map((n) => html`<span>${NATION_NAMES[n]}</span><span>${g.ongoing.has(`open_cove:${n}`) ? html`<span class="chip ok">Open</span>` : html`<span class="chip">Closed</span>`}</span>`)}</div><div class="seg-note">Open trade with the Diplomacy edicts.</div></section>`);
      if (def.auras) body.push(html`<section class="sect"><h4 class="eng">Influence</h4><div class="auras">${Object.entries(def.auras).map(([k, [s, r]]) => html`<span class="chip">${AURA_NAMES[k] ?? k} ${s > 0 ? '+' : ''}${s} <i>· ${r} tiles</i></span>`)}</div></section>`);
    }
    const foot = def.id !== 'palace' ? html`<span class="spacer"></span><button class="btn ghost danger small" data-act="demolish">${icon('bulldoze', 14)} Demolish</button>` : null;
    return { head, body: html`${body}`, foot };
  }

  private seg(act: string, cur: number | string, opts: [number | string, string][], cls = '') {
    return html`<div class="seg ${cls}" role="radiogroup">${opts.map(([v, n]) => html`<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}:${v}" role="radio" aria-checked="${String(cur) === String(v) ? 'true' : 'false'}">${n}</button>`)}</div>`;
  }
  private prioSeg(b: Building) {
    return this.seg('prio', b.priority, [[1, 'Lowest'], [2, 'Low'], [3, 'Normal'], [4, 'High'], [5, 'Top']], 'prio');
  }

  private slotRow(label: string, count: number, ids: number[], b: Building, pirates = false) {
    const g = this.app.game;
    const blocked = Math.min(b.blocked, Math.max(0, count - ids.length));
    return html`<div class="slotrow"><span class="lbl">${label}</span><div class="slots">${Array.from({ length: count }, (_, i) => {
      const id = ids[i];
      const p = id ? g.people.get(id) : null;
      if (p) return html`<button class="slot" data-act="goto:${p.id}" data-tip="${p.name}${p.skilled ? ' (skilled)' : ''}">${icon(pirates ? 'pirate' : 'captive', 18)}</button>`;
      const bl = i >= count - blocked;
      return html`<span class="slot empty ${bl ? 'blocked' : ''}" data-tip="${bl ? 'Closed place' : 'Vacant'}"></span>`;
    })}</div></div>`;
  }

  // ------------------------------------------------------------------------------------------------ person
  private person(p: Person): View {
    const g = this.app.game;
    const kindName = p.captain ? 'Captain' : p.kind === 'pirate' ? RANKS[p.rank - 1].name : p.kind === 'captive' ? (p.skilled ? `Skilled ${JOB_NAMES[p.profession as keyof typeof JOB_NAMES]}` : 'Captive') : p.kind === 'wealthy' ? 'Wealthy captive' : p.kind === 'soldier' ? `${NATION_ADJ[p.nat]} soldier` : 'Skeleton';
    const tabs = p.kind === 'pirate' ? ['overview', 'happiness', 'skills', 'thoughts'] : p.kind === 'captive' ? ['overview', 'resignation', 'thoughts'] : ['overview'];
    if (!tabs.includes(this.tab)) this.tab = 'overview';
    const chips = [];
    if (p.kind === 'pirate' && p.mood !== 'ok') chips.push(html`<span class="chip bad">${p.mood[0].toUpperCase() + p.mood.slice(1)}</span>`);
    if (p.captain) chips.push(html`<span class="chip home">Captain</span>`);
    if (p.skilled) chips.push(html`<span class="chip ok">Skilled</span>`);
    if (p.kind === 'soldier') chips.push(html`<span class="chip bad">Enemy</span>`);
    const pid = portraitIdFor(p);
    const head = html`<div class="tile">${raw(pid ? portraitImg(pid, 64, 'portrait') : portrait(lookSpec(p), 64))}</div>
      <div class="hd"><h2>${p.name}</h2><div class="sub">${kindName} · ${NATION_ADJ[p.nat]} · age ${p.age}</div>
        <div class="doing">${activityText(this.app, p)}</div>${chips.length ? html`<div class="chips">${chips}</div>` : ''}</div>`;
    const body = [];
    if (tabs.length > 1) body.push(html`<div class="seg full tabs-seg" role="tablist">${tabs.map((t) => html`<button class="${this.tab === t ? 'on' : ''}" data-act="tab:${t}" role="tab" aria-selected="${this.tab === t ? 'true' : 'false'}">${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>`);
    const meter = (label: string, v: number, txt = pct(v)) => html`<span>${label}</span>${bar(v)}<span>${txt}</span>`;
    if (this.tab === 'overview') {
      const needs = p.kind === 'pirate' || p.kind === 'wealthy' ? ['feast', 'drink', 'company', 'gamble', 'rest', 'stash'] : p.kind === 'captive' ? ['food', 'rest', 'prayer'] : [];
      if (needs.length) body.push(html`<section class="sect"><h4 class="eng">Needs</h4><div class="meters">${needs.map((n) => meter(NEED_NAMES[n], p.needs[n]))}</div></section>`);
      const kv: unknown[] = [];
      if (p.kind === 'pirate') {
        kv.push(html`<span>Purse</span><span>${fmt(p.gold)} gold <i class="dim">· ${fmt(p.stashed)} stashed</i></span><span>Earned</span><span>${fmt(p.earned)} gold in all</span><span>Happiness</span><span>${pct(p.happiness)}</span>`);
        const ship = p.ship ? g.ships.get(p.ship) : null;
        kv.push(html`<span>Ship</span><span>${ship ? html`<a data-act="gotoS:${ship.id}">${ship.name}</a>${p.officer ? ' (officer)' : ''}` : 'None'}</span>`);
        const home = p.home ? g.buildings.get(p.home) : null;
        kv.push(html`<span>Home</span><span>${home ? html`<a data-act="gotoB:${home.id}">${HOUSE_LEVELS[(home.houseLevel ?? 1) - 1].name}</a>` : 'Sleeps rough'}</span>`);
        if (p.shoreJob) kv.push(html`<span>Shore job</span><span>${p.shoreRole} at the ${BUILDING[g.buildings.get(p.shoreJob)?.def ?? 'palace'].name}</span>`);
      } else if (p.kind === 'captive') {
        const job = p.job ? g.buildings.get(p.job) : null;
        kv.push(html`<span>Work</span><span>${job ? html`<a data-act="gotoB:${job.id}">${JOB_NAMES[p.jobRole!]} at the ${BUILDING[job.def].name}</a>` : 'Idle'}</span><span>Resignation</span><span>${pct(p.resignation)}</span>`);
        if (p.skilled) kv.push(html`<span>Ransom</span><span>${fmt(p.ransom)} gold</span>`);
        kv.push(html`<span>Courage</span><span>${p.traits.courage} of 9</span><span>Leadership</span><span>${p.traits.leadership} of 9</span>`);
      } else if (p.kind === 'wealthy') kv.push(html`<span>Ransom</span><span>${fmt(p.ransom + p.credit)} gold</span>`);
      if (kv.length) body.push(html`<section class="sect"><h4 class="eng">Particulars</h4><div class="kv">${kv}</div></section>`);
      if (p.kind === 'soldier') body.push(html`<div class="callout bad">${icon('skull', 16)}<span>An enemy soldier. Guards, forts and armed pirates will fight him.</span></div>`);
    } else if (this.tab === 'happiness') {
      const f = pirateFactors(g, p);
      body.push(html`<div class="seg-note">Long-term feelings. Overall happiness is their weighted average.</div>
        <div class="meters" style="margin-top:6px">${Object.entries(f).map(([k, v]) => meter(NEED_NAMES[k] ?? k, v))}</div>
        <div class="meters total">${meter('Overall', p.happiness)}</div>`);
    } else if (this.tab === 'resignation') {
      body.push(html`<div class="meters">${(['food', 'rest', 'prayer'] as const).map((k) => meter(NEED_NAMES[k], p.opinion[k] ?? 0.5))}
        ${meter('Fear', Math.min(1, p.env.fear))}${meter('Order', Math.max(0, Math.min(1, 0.4 + p.env.order)))}${meter('Awe', Math.min(1, 0.15 + p.env.awe))}</div>
        <div class="meters total">${meter('Overall', p.resignation)}</div>`);
    } else if (this.tab === 'skills') {
      body.push(html`<section class="sect"><h4 class="eng">Skills</h4><div class="meters">${Object.entries(p.skills).map(([k, v]) => meter(k[0].toUpperCase() + k.slice(1), v / 5, v.toFixed(1)))}</div></section>
        <section class="sect"><h4 class="eng">Traits</h4><div class="meters">${Object.entries(p.traits).map(([k, v]) => meter(k[0].toUpperCase() + k.slice(1), v / 9, String(Math.round(v))))}</div></section>
        ${p.accessories.pegleg || p.accessories.hat || p.accessories.parrot ? html`<div class="chips">${[p.accessories.pegleg ? 'Peg leg' : '', p.accessories.hat ? 'Fine hat' : '', p.accessories.parrot ? 'Parrot' : ''].filter(Boolean).map((x) => html`<span class="chip">${x}</span>`)}</div>` : ''}`);
    } else if (this.tab === 'thoughts') {
      body.push(html`<div class="thoughts">${this.thoughts(p).map(([t, bad]) => html`<blockquote class="thought ${bad ? 'bad' : ''}">${t}</blockquote>`)}</div>`);
    }
    // actions: ordinary ones first, the deadly ones apart on the right
    const acts = [html`<button class="btn ghost small" data-act="follow">${icon('follow', 14)} Follow</button>`];
    const deadly = [];
    if (p.kind === 'pirate') {
      acts.push(html`<button class="btn ghost small" data-act="edict:donate" data-tip="Give 100 gold">${icon('coin', 14)} Give 100 gold</button>`);
      for (const a of ['pegleg', 'hat', 'parrot'] as const) if (g.goodTotal(a) > 0 && !p.accessories[a]) acts.push(html`<button class="btn ghost small" data-act="edict:outfit|${a}">Give ${a === 'pegleg' ? 'peg leg' : a}</button>`);
      for (const b of g.buildings.values()) {
        const sc = BUILDING[b.def].school;
        if (sc && b.built >= 1) acts.push(html`<button class="btn ghost small" data-act="edict:educate|${sc}">Train ${sc}</button>`);
      }
      if (!p.captain) deadly.push(html`<button class="btn ghost danger small" data-act="edict:assassinate">${icon('skull', 14)} Assassinate</button>`);
    }
    if (p.kind === 'captive') {
      if (!p.skilled) acts.push(html`<button class="btn ghost small" data-act="edict:press_gang">Press-gang</button>`);
      if (p.skilled) acts.push(html`<button class="btn ghost small" data-act="edict:ransom">${icon('coin', 14)} Ransom for ${fmt(p.ransom)}</button>`);
      acts.push(html`<button class="btn ghost small" data-act="edict:free_captive">Set free</button>`);
      deadly.push(html`<button class="btn ghost danger small" data-act="edict:assassinate">${icon('skull', 14)} Kill</button>`);
    }
    if (p.kind === 'wealthy') acts.unshift(html`<button class="btn primary small" data-act="edict:ransom">${icon('coin', 14)} Ransom for ${fmt(p.ransom + p.credit)}</button>`);
    const foot = html`${acts}${deadly.length ? html`<span class="spacer"></span>${deadly}` : ''}`;
    return { head, body: html`${body}`, foot };
  }

  private thoughts(p: Person): [string, boolean][] {
    const out: [string, boolean][] = [];
    const g = this.app.game;
    for (const t of p.thoughts.slice(0, 2)) out.push([t, true]);
    if (p.kind === 'pirate') {
      if (p.gold < 5) out.push(["I haven't a coin to my name.", true]);
      if (!p.home) out.push(['I sleep in the dirt like a dog.', true]);
      if (p.needs.drink < 0.3) out.push(['I could murder a pint of grog.', true]);
      if (p.needs.company < 0.3) out.push(["It's been too long since I've seen a pretty face.", true]);
      if (p.needs.gamble < 0.3) out.push(["I'm bored stiff. Where's the dice?", true]);
      if (p.needs.feast < 0.3) out.push(['My belly is growling.', true]);
      const f = pirateFactors(g, p);
      if (f.anarchy < 0.35) out.push(['Too many rules on this island!', true]);
      if (f.defense < 0.3) out.push(["I don't feel safe here. The navy could come any day.", true]);
      if (p.happiness > 0.65) out.push(['Life is good under our king!', false]);
      if (p.ship) out.push(['Can\'t wait to get back to sea.', false]);
    } else if (p.kind === 'captive') {
      if (p.needs.food < 0.3) out.push(["I'm starving...", true]);
      if (p.needs.rest < 0.3) out.push(["So tired. I can't go on.", true]);
      if (p.resignation < 0.3) out.push(['One day I will be free of this place.', true]);
      if (p.env.fear > 0.6) out.push(['Best not to cross these pirates.', false]);
      if (!p.job) out.push(['Nothing to do but sit in the stockade.', false]);
      if (p.resignation > 0.6) out.push(['It could be worse, I suppose.', false]);
    } else if (p.kind === 'wealthy') out.push(['When will my family pay this outrageous ransom?', true], ['At least the rum is good.', false]);
    if (!out.length) out.push(['...', false]);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ ship
  private ship(s: Ship): View {
    const g = this.app.game;
    const d = SHIPS[s.type];
    const cap = g.people.get(s.captain);
    const region = g.regions[s.region];
    const statusText = { docked: 'In port', boarding: 'Boarding', departing: 'Setting sail', atsea: 'At sea', returning: 'Homeward bound', repairing: 'Under repair', building: 'Being built', lost: 'Lost' }[s.status];
    const head = html`<div class="tile ship">${icon('ship', 46)}</div>
      <div class="hd"><h2>${s.name}</h2><div class="sub">${d.name} · ${d.cannons} guns · crew of ${d.men + d.officers + 1}</div>
        <div class="chips"><span class="chip ${s.status === 'docked' ? 'ok' : s.status === 'repairing' ? 'warn' : ''}">${statusText}</span>${cap ? html`<button class="chip link" data-act="goto:${cap.id}">${icon('pirate', 12)} ${cap.name}</button>` : html`<span class="chip bad">No captain</span>`}</div></div>`;
    const body = [];
    const supp = (label: string, have: number, max: number) => html`<span>${label}</span>${bar(have / Math.max(1, max))}<span>${Math.floor(have)}/${max}</span>`;
    const crewAboard = s.crew.filter((id) => g.people.get(id)?.task.kind === 'atsea').length;
    const stores = html`<section class="sect"><h4 class="eng">Crew & stores</h4><div class="meters two">
      ${supp('Crew', s.crew.length, d.men + d.officers)}${supp('Hull', s.hull * 100, 100)}${supp('Rations', s.rations, d.rations)}${supp('Cutlasses', s.cutlasses, d.cutlasses)}${supp('Muskets', s.muskets, d.muskets)}${supp('Cannons', s.cannons, d.cannons)}</div>
      ${s.status === 'boarding' ? html`<div class="seg-note">${crewAboard} of ${s.crew.length} hands aboard.</div>` : ''}</section>`;
    const inPort = s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing';
    // in port the orders come first (that is what the player is here to set); at sea the stores and the voyage
    if (!inPort) body.push(stores);
    if (s.status === 'atsea' && s.voyage) {
      const v = s.voyage;
      const total = v.out + v.back + Math.max(0, (s.rations - v.back * v.rationRate) / Math.max(1e-6, v.rationRate));
      body.push(html`<section class="sect"><h4 class="eng">Voyage</h4>
        <div class="kv"><span>Mission</span><span>${MISSION_NAMES[s.mission]}</span><span>Waters</span><span>${region.name}</span>
        <span>Plunder</span><span>${fmt(v.loot.gold)} gold, ${v.loot.captives} captives</span></div>
        <div class="meters" style="margin-top:6px"><span>${v.lost ? 'Lost!' : v.t < v.out ? 'Sailing out' : 'On station'}</span>${bar(Math.min(1, v.t / Math.max(1, total)), 'brass')}<span>${pct(Math.min(1, v.t / Math.max(1, total)))}</span></div>
        ${s.log.length ? html`<ol class="log">${s.log.slice(-4).map((e) => html`<li><i>${e.date}</i> ${e.text}</li>`)}</ol>` : ''}</section>`);
    }
    let foot = null;
    if (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing') {
      const mission = s.mission;
      const missions: [string, string, string][] = [['cruise', 'Cruise', 'ship'], ['raid', 'Raid', 'flag'], ['kidnap', 'Kidnap', 'chain'], ['explore', 'Explore', 'telescope'], ['foster_war', 'Foster war', 'scroll']];
      const orders = [html`<div class="seg missions" role="radiogroup" aria-label="Mission">${missions.map(([m, n, ic]) => html`<button class="${mission === m ? 'on' : ''}" data-act="mission:${m}" role="radio" aria-checked="${mission === m ? 'true' : 'false'}">${icon(ic, 16)}${n}</button>`)}</div>
        <div class="seg-note">${missionTip(mission)}</div>`];
      if (mission === 'cruise') orders.push(html`<div class="field-row"><span class="lbl">Tactics</span>${this.seg('orders', s.orders, [['board', 'Board'], ['pound', 'Pound'], ['harass', 'Harass']], 'full')}</div><div class="seg-note">${ordersTip(s.orders)}</div>`);
      if (mission === 'cruise' || mission === 'explore' || mission === 'foster_war') {
        const reach = regionReachable(g, s, s.region);
        const months = (transitTime(g, s, s.region) / MONTH).toFixed(1);
        orders.push(html`<div class="field-row"><span class="lbl">Waters</span><div class="dest"><b>${region.name}</b>${s.region === g.homeRegion ? html` <i class="dim">(home)</i>` : ''}<button class="btn ghost small" data-act="chart">${icon('telescope', 14)} Chart</button></div></div>
          <div class="callout ${reach.ok ? 'ok' : 'bad'}">${icon(reach.ok ? 'compass' : 'info', 16)}<span>${reach.ok ? `${months} months' sail each way.` : reach.reason}</span></div>`);
      }
      if (mission === 'kidnap') {
        const jobs = ['shipwright', 'engineer', 'gunsmith', 'distiller', 'tobacconist', 'courtesan', 'surgeon', 'priest', 'trader', 'server', 'cook', 'farmer', 'wench', 'hatter', 'carpenter', 'birdhandler'] as const;
        orders.push(html`<div class="field-row top"><span class="lbl">Target</span>${this.seg('kidnap', s.kidnapJob ?? '', jobs.map((j) => [j, JOB_NAMES[j]] as [string, string]), 'wrap')}</div><div class="seg-note">Costs 250 gold. Always succeeds.</div>`);
      }
      if (mission === 'foster_war') orders.push(html`<div class="field-row"><span class="lbl">Provoke</span>${this.seg('foster', s.foster ?? '', NATIONS.map((n) => [n, NATION_NAMES[n]] as [string, string]), 'full')}</div>`);
      body.push(html`<section class="sect"><h4 class="eng">Orders</h4>${orders}</section>`);
      body.push(html`<section class="sect"><h4 class="eng">Spoils</h4>${this.seg('spoils', s.spoils, [['miserly', 'Miserly'], ['selfish', 'Selfish'], ['generous', 'Generous'], ['bigspender', 'Big spender']], 'full')}
        <div class="seg-note">The treasury keeps ${Math.round(SPOILS_TREASURY[s.spoils] * 100)}% of the plunder, the crew shares ${Math.round((1 - SPOILS_TREASURY[s.spoils]) * 100)}%. Stingy captains attract fewer recruits.</div></section>`);
      body.push(stores);
      if (s.log.length) body.push(html`<section class="sect"><h4 class="eng">Last voyage</h4><ol class="log">${s.log.slice(-5).map((e) => html`<li><i>${e.date}</i> ${e.text}</li>`)}</ol></section>`);
      foot = html`<button class="btn primary" data-act="sail">${icon('bell', 16)} ${s.status === 'boarding' ? 'Leave now' : 'Set sail'}</button>
        ${g.findBuilding('black_market') ? html`<button class="btn ghost small" data-act="bm" data-tip="Buy rations and weapons instantly">Black market</button>` : ''}
        <button class="btn ghost small" data-act="shipEdict:donate_crew">${icon('coin', 14)} Treat crew</button>
        <button class="btn ghost small icon-only" data-act="follow" aria-label="Follow" data-tip="Follow the ship">${icon('follow', 15)}</button>
        <span class="spacer"></span><button class="btn ghost danger small" data-act="scuttle">Scuttle</button>`;
    } else foot = html`<button class="btn ghost small" data-act="follow">${icon('follow', 14)} Follow</button><button class="btn ghost small" data-act="chart">${icon('telescope', 14)} Sea chart</button>`;
    return { head, body: html`${body}`, foot };
  }
}

type View = { head: unknown; body: unknown; foot: unknown };
const AURA_NAMES: Record<string, string> = { order: 'Order', anarchy: 'Anarchy', fear: 'Fear', defense: 'Defense', awe: 'Awe' };

function missionTip(m: string): string {
  return {
    cruise: 'Hunt ships in a region for gold, captives and recruits. Dangerous.',
    raid: 'Raid a settlement for unskilled captives. The ship always returns.',
    kidnap: 'Snatch one skilled craftsman of your choice (250 gold).',
    explore: 'Chart a region: reveals settlements and trade routes.',
    foster_war: 'Fly false colours and provoke a war between Great Powers.',
  }[m] ?? '';
}
function ordersTip(o: string): string {
  return {
    board: 'Board and fight hand to hand with cutlasses. Most captives and recruits, most dangerous.',
    pound: 'Batter the hull with cannon fire. May sink the prize and its cargo.',
    harass: 'Shoot the rigging and crew with muskets and small guns. Safest, but few survivors to capture.',
  }[o] ?? '';
}
export type { PirateNeed };
