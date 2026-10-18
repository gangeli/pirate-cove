import type { App } from './app';
import { el, html, setHTML, delegate, fmt, pct, bar, raw } from './dom';
import { icon } from './icons';
import { BUILDING, HOUSE_LEVELS, JOB_NAMES, RANKS, PRICE_LEVELS, type PirateNeed } from '../sim/data/buildings';
import { GOOD_NAMES, type Good } from '../sim/data/goods';
import { SHIPS, SHIP_LIST, MISSION_NAMES, ORDERS_NAMES, SPOILS_NAMES, type ShipType } from '../sim/data/ships';
import { NATION_ADJ, NATION_NAMES, NATIONS } from '../sim/data/kings';
import type { Building, Person, Ship } from '../sim/types';
import { serviceFee, serviceBand, pirateFactors } from '../sim/people';
import { farmFertility, treesNear } from '../sim/economy';
import { portrait, type PortraitSpec } from './portraits';
import { audio } from '../audio/audio';
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
      demolish: () => {
        const b = app.game.buildings.get(this.sel());
        if (!b) return;
        app.modal.confirm(`Demolish the ${BUILDING[b.def].name}?`, 'Nothing will be refunded.', () => {
          app.cmd({ type: 'demolish', id: b.id });
          audio.sfx('demolish');
          app.select(null);
        });
      },
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
    const key = `${s.type}:${s.id}:${this.tab}`;
    if (key !== this.lastKey) {
      if (this.lastKey && !this.lastKey.startsWith(`${s.type}:`)) this.tab = 'overview';
      this.lastKey = key;
    }
    let content;
    if (s.type === 'building') {
      const b = this.app.game.buildings.get(s.id);
      if (!b) return this.app.select(null);
      content = this.building(b);
    } else if (s.type === 'person') {
      const p = this.app.game.people.get(s.id);
      if (!p) return this.app.select(null);
      content = this.person(p);
    } else {
      const sh = this.app.game.ships.get(s.id);
      if (!sh) return this.app.select(null);
      content = this.ship(sh);
    }
    this.panel.classList.remove('hidden');
    setHTML(this.panel, html`<button class="close" data-act="close">${icon('close', 14)}</button>${content}`);
    void force;
  }

  // ------------------------------------------------------------------------------------------------ building
  private building(b: Building) {
    const g = this.app.game;
    const def = BUILDING[b.def];
    const parts = [];
    const title = def.service && b.name ? b.name : def.house && b.houseLevel ? HOUSE_LEVELS[b.houseLevel - 1].name : def.name;
    parts.push(html`<div class="head"><div><h2>${title}</h2><div class="sub">${def.service && b.name ? def.name + ' · ' : ''}${def.desc}</div></div></div>`);
    if (b.built < 1) {
      parts.push(html`<h3>Under Construction</h3><div class="progress"><div style="width:${(b.built * 100).toFixed(0)}%"></div></div>
        <div class="sub">${g.buildingCount('construction_tent') ? 'Builders from the construction tents will finish it.' : 'You need a Construction Tent and builders!'}</div>
        <div class="row" style="margin-top:6px">Priority: ${[1, 2, 3, 4, 5].map((v) => html`<button class="btn small ${b.priority === v ? 'on' : ''}" data-act="prio:${v}">${v}</button>`)}</div>`);
    } else {
      // workers
      const slots = def.workers.filter((w) => w.job !== 'hauler' || def.id === 'dock');
      if (slots.length || def.haulers) {
        parts.push(html`<h3>Workers</h3>`);
        for (const sl of def.workers) {
          const list = sl.job === 'hauler' ? b.haulers.concat(b.workers.filter((id) => g.people.get(id)?.jobRole === 'hauler')) : b.workers.filter((id) => g.people.get(id)?.jobRole === sl.job);
          const uniq = [...new Set(list)];
          parts.push(this.slotRow(JOB_NAMES[sl.job], sl.count, uniq, b));
        }
        if (def.haulers && !def.workers.some((w) => w.job === 'hauler')) parts.push(this.slotRow('Hauler', def.haulers, b.haulers, b));
      }
      if (def.overseer || def.guards) {
        const pir = [b.overseer, ...b.guards].filter(Boolean);
        parts.push(this.slotRow(def.guards ? 'Guards' : 'Overseer', def.guards ?? 1, pir, b, true));
        parts.push(html`<div class="row" style="font-size:14px">Wage: ${[0, 2, 4, 8, 12].map((v) => html`<button class="btn small ${b.wage === v ? 'on' : ''}" data-act="wage:${v}">${v}</button>`)}<span class="sub">gold/month each</span></div>`);
      }
      if (slots.length || def.overseer || def.guards) parts.push(html`<div class="row" style="font-size:14px;margin-top:4px" data-tip="Higher priority buildings are staffed first, taking workers from lower ones.">Priority: ${[1, 2, 3, 4, 5].map((v) => html`<button class="btn small ${b.priority === v ? 'on' : ''}" data-act="prio:${v}">${v}</button>`)}
        <button class="btn small" data-act="block:1" data-tip="Block a worker slot">${icon('minus', 12)}</button><button class="btn small" data-act="block:-1" data-tip="Unblock a slot">${icon('plus', 12)}</button></div>`);
      // production
      if (def.recipe || def.gather) {
        const r = def.recipe;
        const out = r?.out ?? def.gather!.out;
        let extra = '';
        if (def.gather?.crop) extra = `Soil fertility: ${pct(farmFertility(g, b, def.gather.crop))}`;
        if (def.gather?.from === 'trees') extra = `Trees nearby: ${treesNear(g, b, 9)}`;
        parts.push(html`<h3>Production</h3>
          <div class="row" style="font-size:14px">${r ? Object.entries(r.in).map(([k, v]) => html`<span class="chip">${v}× ${GOOD_NAMES[k as Good]}: ${Math.floor(b.inv[k as Good] ?? 0)}</span>`) : ''}
          <b>→</b> <span class="chip">${GOOD_NAMES[out]}: ${Math.floor(b.inv[out] ?? 0)}</span></div>
          <div class="progress" style="margin-top:4px"><div style="width:${(b.progress * 100).toFixed(0)}%"></div></div>
          <div class="sub">${extra}${b.staff < 0.5 ? ' · Short-staffed' : ''}</div>`);
      }
      // service
      if (def.service) {
        const sv = def.service;
        const [lo, hi] = serviceBand(b);
        parts.push(html`<h3>Customers ${b.customers.length}/${sv.capacity} <a data-act="rename" style="font-size:13px;cursor:pointer;text-decoration:underline;font-family:var(--body)">rename</a></h3>
          <div class="slots">${Array.from({ length: sv.capacity }, (_, i) => {
            const id = b.customers[i];
            const p = id ? g.people.get(id) : null;
            const present = p && p.task.phase === 1;
            return html`<div class="slot ${!p ? 'empty' : present ? '' : 'res'}" ${p ? raw(`data-act="goto:${p.id}"`) : ''} data-tip="${p ? p.name : 'Empty'}">${p ? icon('pirate', 20) : ''}</div>`;
          })}</div>
          <div class="kv" style="margin-top:6px"><span>Satisfies</span><span>${Object.keys(sv.needs).map((n) => NEED_NAMES[n]).join(', ')}</span>
          <span>Bonus goods</span><span>${sv.bonus.length ? sv.bonus.map((x) => `${GOOD_NAMES[x]} (${Math.floor(b.inv[x] ?? 0)})`).join(', ') : 'none'}</span>
          <span>Serves ranks</span><span>${lo}–${hi} (${RANKS[lo - 1].name} to ${RANKS[hi - 1].name})</span>
          <span>Fee</span><span>${serviceFee(b)} gold</span><span>Income last month</span><span>${fmt(b.lastIncome)} gold</span></div>
          <div class="row" style="margin-top:4px;font-size:14px">Prices: ${PRICE_LEVELS.map((n, i) => html`<button class="btn small ${b.price === i ? 'on' : ''}" data-act="price:${i}">${n}</button>`)}</div>
          <div class="row" style="margin-top:4px;font-size:14px" data-tip="Narrow the clientele to a band of ranks. Pirates outside the band enjoy it less.">Service: <button class="btn small ${b.quality === 0 ? 'on' : ''}" data-act="quality:0">All</button>${[1, 2, 3].filter((q) => sv.ranks[0] + q + 1 <= sv.ranks[1]).map((q) => html`<button class="btn small ${b.quality === q ? 'on' : ''}" data-act="quality:${q}">${sv.ranks[0] + q - 1}–${sv.ranks[0] + q + 1}</button>`)}</div>`);
      }
      if (def.captiveService) parts.push(html`<div class="kv"><span>${NEED_NAMES[def.captiveService.need]}</span><span>${b.customers.length}/${def.captiveService.capacity} in use</span></div>`);
      if (def.house) {
        const o = b.owner ? g.people.get(b.owner) : null;
        const lv = HOUSE_LEVELS[(b.houseLevel ?? 1) - 1];
        parts.push(html`<div class="kv"><span>Owner</span><span>${o ? html`<a data-act="goto:${o.id}" style="cursor:pointer;text-decoration:underline">${o.name}</a>` : 'Vacant'}</span>
          <span>Dwelling</span><span>${lv.name}</span><span>Rest</span><span>${pct(lv.rest)}</span><span>Stash fee</span><span>${lv.fee} gold</span></div>
          <div class="sub">Plots upgrade themselves when the owner rises in rank and can pay.</div>`);
      }
      if (def.id === 'dock') {
        const s = b.ship ? g.ships.get(b.ship) : null;
        parts.push(html`<h3>Berth</h3><div>${s ? html`<a data-act="gotoS:${s.id}" style="cursor:pointer;text-decoration:underline">${SHIPS[s.type].name} ${s.name}</a> (${s.status === 'atsea' ? 'at sea' : s.status})` : 'Empty: ships need a free dock.'}</div>`);
      }
      if (def.id === 'boatyard' || def.id === 'shipyard') {
        if (b.building_ship) parts.push(html`<h3>Building a ${SHIPS[b.building_ship.type].name}</h3><div class="progress"><div style="width:${(b.building_ship.progress * 100).toFixed(0)}%"></div></div>`);
        else parts.push(html`<h3>Commission a Ship</h3><div class="cards-grid" style="grid-template-columns:repeat(2,1fr);gap:6px">${SHIP_LIST.filter((t) => def.id === 'shipyard' || SHIPS[t].yard === 'boatyard').map((t) => {
          const d = SHIPS[t];
          const ok = g.treasury >= d.gold && g.lumber() >= d.lumber;
          return html`<div class="ecard ${ok ? '' : 'disabled'}" style="cursor:pointer;padding:5px 7px" data-act="commission:${t}" data-tip="Crew ${d.men}+${d.officers}+captain · ${d.cannons} cannons · speed ${d.speed} · ${d.rations} rations">
            <h4 style="font-size:16px">${d.name}</h4><span style="font-size:13px">${d.gold ? html`${icon('coin', 12)} ${d.gold} ` : ''}${icon('lumber', 12)} ${d.lumber}</span></div>`;
        })}</div>`);
      }
      if (def.id === 'graveyard') parts.push(html`<div class="kv"><span>Corpses</span><span>${g.graveyard.length}</span></div><button class="btn small" data-act="raise">Raise the Dead (${this.app.edicts.cost('raise_dead')} gold)</button>`);
      if (def.id === 'smugglers_cove') parts.push(html`<div class="kv">${NATIONS.map((n) => html`<span>${NATION_NAMES[n]}</span><span>${g.ongoing.has(`open_cove:${n}`) ? 'Open for trade' : 'Closed'}</span>`)}</div><div class="sub">Open trade with the Diplomacy edicts.</div>`);
      if (def.auras) parts.push(html`<div class="sub" style="margin-top:6px">Radiates: ${Object.entries(def.auras).map(([k, [s, r]]) => `${k} ${s} (range ${r})`).join(', ')}</div>`);
      if (def.upkeep) parts.push(html`<div class="sub">Upkeep: ${def.upkeep} gold/month</div>`);
    }
    if (def.id !== 'palace') parts.push(html`<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn small red" data-act="demolish">${icon('bulldoze', 14)} Demolish</button></div>`);
    return html`<div class="scroll" style="max-height:calc(100vh - 140px)">${parts}</div>`;
  }

  private slotRow(label: string, count: number, ids: number[], b: Building, pirates = false) {
    const g = this.app.game;
    const blocked = Math.min(b.blocked, Math.max(0, count - ids.length));
    return html`<div class="row" style="margin:2px 0"><span style="width:84px;font-size:14px">${label}</span><div class="slots">${Array.from({ length: count }, (_, i) => {
      const id = ids[i];
      const p = id ? g.people.get(id) : null;
      if (p) return html`<div class="slot" data-act="goto:${p.id}" data-tip="${p.name}${p.skilled ? ' (skilled)' : ''}<br>Shift-click in the world to fire">${icon(pirates ? 'pirate' : 'captive', 20)}</div>`;
      return html`<div class="slot empty ${i >= count - blocked ? 'blocked' : ''}" data-tip="${i >= count - blocked ? 'Blocked' : 'Vacant'}"></div>`;
    })}</div></div>`;
  }

  // ------------------------------------------------------------------------------------------------ person
  private person(p: Person) {
    const g = this.app.game;
    const kindName = p.captain ? 'Captain' : p.kind === 'pirate' ? RANKS[p.rank - 1].name : p.kind === 'captive' ? (p.skilled ? `Skilled ${JOB_NAMES[p.profession as keyof typeof JOB_NAMES]}` : 'Captive') : p.kind === 'wealthy' ? 'Wealthy Captive' : p.kind === 'soldier' ? `${NATION_ADJ[p.nat]} Soldier` : 'Skeleton';
    const tabs = p.kind === 'pirate' ? ['overview', 'happiness', 'skills', 'thoughts'] : p.kind === 'captive' ? ['overview', 'resignation', 'thoughts'] : ['overview'];
    if (!tabs.includes(this.tab)) this.tab = 'overview';
    const parts = [];
    parts.push(html`<div class="head">${raw(portrait(lookSpec(p), 72))}<div><h2 style="font-size:23px">${p.name}</h2><div class="sub">${kindName} · ${NATION_ADJ[p.nat]} · age ${p.age}${p.mood !== 'ok' && p.kind === 'pirate' ? html` · <b style="color:#a01010">${p.mood}</b>` : ''}</div>
      <div style="font-size:14px;margin-top:2px">${activityText(this.app, p)}</div></div></div>`);
    parts.push(html`<div class="tabs">${tabs.map((t) => html`<div class="t ${this.tab === t ? 'on' : ''}" data-act="tab:${t}">${t[0].toUpperCase() + t.slice(1)}</div>`)}</div>`);
    if (this.tab === 'overview') {
      const needs = p.kind === 'pirate' || p.kind === 'wealthy' ? ['feast', 'drink', 'company', 'gamble', 'rest', 'stash'] : p.kind === 'captive' ? ['food', 'rest', 'prayer'] : [];
      parts.push(html`<div class="needs">${needs.map((n) => html`<span>${NEED_NAMES[n]}</span>${bar(p.needs[n])}<span>${pct(p.needs[n])}</span>`)}</div>`);
      const kv: unknown[] = [];
      if (p.kind === 'pirate') {
        kv.push(html`<span>Gold</span><span>${fmt(p.gold)} (stashed ${fmt(p.stashed)})</span><span>Lifetime earnings</span><span>${fmt(p.earned)}</span><span>Happiness</span><span>${pct(p.happiness)}</span>`);
        const ship = p.ship ? g.ships.get(p.ship) : null;
        kv.push(html`<span>Ship</span><span>${ship ? html`<a data-act="gotoS:${ship.id}" style="cursor:pointer;text-decoration:underline">${ship.name}</a>${p.officer ? ' (officer)' : ''}` : 'None'}</span>`);
        const home = p.home ? g.buildings.get(p.home) : null;
        kv.push(html`<span>Home</span><span>${home ? HOUSE_LEVELS[(home.houseLevel ?? 1) - 1].name : 'Homeless'}</span>`);
        if (p.shoreJob) kv.push(html`<span>Shore job</span><span>${p.shoreRole} at the ${BUILDING[g.buildings.get(p.shoreJob)?.def ?? 'palace'].name}</span>`);
      } else if (p.kind === 'captive') {
        const job = p.job ? g.buildings.get(p.job) : null;
        kv.push(html`<span>Job</span><span>${job ? html`<a data-act="gotoB:${job.id}" style="cursor:pointer;text-decoration:underline">${JOB_NAMES[p.jobRole!]} at the ${BUILDING[job.def].name}</a>` : 'Unemployed'}</span><span>Resignation</span><span>${pct(p.resignation)}</span>`);
        if (p.skilled) kv.push(html`<span>Ransom</span><span>${fmt(p.ransom)} gold</span>`);
        kv.push(html`<span>Courage</span><span>${p.traits.courage}</span><span>Leadership</span><span>${p.traits.leadership}</span>`);
      } else if (p.kind === 'wealthy') kv.push(html`<span>Ransom</span><span>${fmt(p.ransom + p.credit)} gold</span>`);
      parts.push(html`<div class="kv" style="margin-top:8px">${kv}</div>`);
    } else if (this.tab === 'happiness') {
      const f = pirateFactors(g, p);
      parts.push(html`<div class="sub">Long-term feelings. Overall happiness is their weighted average.</div><div class="needs" style="margin-top:4px">${Object.entries(f).map(([k, v]) => html`<span>${NEED_NAMES[k] ?? k}</span>${bar(v)}<span>${pct(v)}</span>`)}</div>
        <div class="needs" style="margin-top:6px"><b>Overall</b>${bar(p.happiness, 'big')}<b>${pct(p.happiness)}</b></div>`);
    } else if (this.tab === 'resignation') {
      parts.push(html`<div class="needs">${(['food', 'rest', 'prayer'] as const).map((k) => html`<span>${NEED_NAMES[k]}</span>${bar(p.opinion[k] ?? 0.5)}<span>${pct(p.opinion[k] ?? 0.5)}</span>`)}
        <span>Fear</span>${bar(Math.min(1, p.env.fear))}<span>${pct(Math.min(1, p.env.fear))}</span>
        <span>Order</span>${bar(Math.max(0, Math.min(1, 0.4 + p.env.order)))}<span>${pct(Math.max(0, Math.min(1, 0.4 + p.env.order)))}</span>
        <span>Awe</span>${bar(Math.min(1, 0.15 + p.env.awe))}<span>${pct(Math.min(1, 0.15 + p.env.awe))}</span>
        <b>Overall</b>${bar(p.resignation)}<b>${pct(p.resignation)}</b></div>`);
    } else if (this.tab === 'skills') {
      parts.push(html`<div class="needs">${Object.entries(p.skills).map(([k, v]) => html`<span>${k[0].toUpperCase() + k.slice(1)}</span>${bar(v / 5)}<span>${v.toFixed(1)}</span>`)}</div><hr class="rule">
        <div class="needs">${Object.entries(p.traits).map(([k, v]) => html`<span>${k[0].toUpperCase() + k.slice(1)}</span>${bar(v / 9)}<span>${Math.round(v)}</span>`)}</div>
        <div class="sub">${[p.accessories.pegleg ? 'Peg leg' : '', p.accessories.hat ? 'Fine hat' : '', p.accessories.parrot ? 'Parrot' : ''].filter(Boolean).join(' · ')}</div>`);
    } else if (this.tab === 'thoughts') {
      parts.push(html`${this.thoughts(p).map(([t, bad]) => html`<div class="thought ${bad ? 'bad' : ''}">"${t}"</div>`)}`);
    }
    // actions
    const acts = [];
    acts.push(html`<button class="btn small" data-act="follow">${icon('follow', 14)} Follow</button>`);
    if (p.kind === 'pirate') {
      acts.push(html`<button class="btn small" data-act="edict:donate" data-tip="Give 100 gold">Donate</button>`);
      if (!p.captain) acts.push(html`<button class="btn small red" data-act="edict:assassinate">Assassinate</button>`);
      for (const a of ['pegleg', 'hat', 'parrot'] as const) if (g.goodTotal(a) > 0 && !p.accessories[a]) acts.push(html`<button class="btn small" data-act="edict:outfit|${a}">Give ${a === 'pegleg' ? 'peg leg' : a}</button>`);
      for (const b of g.buildings.values()) {
        const sc = BUILDING[b.def].school;
        if (sc && b.built >= 1) acts.push(html`<button class="btn small" data-act="edict:educate|${sc}">Train ${sc}</button>`);
      }
    }
    if (p.kind === 'captive') {
      if (!p.skilled) acts.push(html`<button class="btn small" data-act="edict:press_gang">Press-gang</button>`);
      if (p.skilled) acts.push(html`<button class="btn small" data-act="edict:ransom">Ransom (${fmt(p.ransom)})</button>`);
      acts.push(html`<button class="btn small" data-act="edict:free_captive">Free</button><button class="btn small red" data-act="edict:assassinate">Kill</button>`);
    }
    if (p.kind === 'wealthy') acts.push(html`<button class="btn small green" data-act="edict:ransom">Ransom (${fmt(p.ransom + p.credit)})</button>`);
    parts.push(html`<div class="row" style="margin-top:8px">${acts}</div>`);
    return html`<div class="scroll" style="max-height:calc(100vh - 140px)">${parts}</div>`;
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
  private ship(s: Ship) {
    const g = this.app.game;
    const d = SHIPS[s.type];
    const cap = g.people.get(s.captain);
    const parts = [];
    const region = g.regions[s.region];
    const statusText = { docked: 'In port', boarding: 'Ringing the bell. Crew coming aboard', departing: 'Setting sail', atsea: 'At sea', returning: 'Returning to port', repairing: 'Under repair', building: 'Being built', lost: 'Lost' }[s.status];
    parts.push(html`<div class="head"><div style="width:72px;height:72px;display:grid;place-items:center;border:1px solid var(--ink);background:#1e2c34;color:#e2c88e;box-shadow:0 0 0 3px rgba(226,210,170,.6),0 0 0 4px var(--ink2)">${icon('ship', 56)}</div>
      <div><h2>${s.name}</h2><div class="sub">${d.name} · ${statusText}</div><div style="font-size:14px">Captain: ${cap ? html`<a data-act="goto:${cap.id}" style="cursor:pointer;text-decoration:underline">${cap.name}</a>` : html`<b style="color:#a01010">none!</b>`}</div></div></div>`);
    const supp = (label: string, have: number, max: number) => html`<span>${label}</span>${bar(have / Math.max(1, max))}<span>${Math.floor(have)}/${max}</span>`;
    const crewAbove = s.crew.filter((id) => g.people.get(id)?.task.kind === 'atsea').length;
    parts.push(html`<div class="needs" style="grid-template-columns:90px 1fr 50px;margin-top:6px">
      ${supp('Crew', s.crew.length, d.men + d.officers)}${supp('Hull', s.hull * 100, 100)}${supp('Rations', s.rations, d.rations)}${supp('Cutlasses', s.cutlasses, d.cutlasses)}${supp('Muskets', s.muskets, d.muskets)}${supp('Cannons', s.cannons, d.cannons)}</div>`);
    if (s.status === 'boarding') parts.push(html`<div class="sub">${crewAbove}/${s.crew.length} hands aboard</div>`);
    if (s.status === 'atsea' && s.voyage) {
      const v = s.voyage;
      const total = v.out + v.back + Math.max(0, (s.rations - v.back * v.rationRate) / Math.max(1e-6, v.rationRate));
      parts.push(html`<h3>Voyage: ${MISSION_NAMES[s.mission]} in the ${region.name}</h3><div class="progress"><div style="width:${Math.min(100, (v.t / Math.max(1, total)) * 100).toFixed(0)}%"></div></div>
        <div class="sub">${v.lost ? 'Lost at sea!' : v.t < v.out ? 'Sailing out' : 'On station'} · loot so far: ${fmt(v.loot.gold)} gold, ${v.loot.captives} captives</div>
        ${s.log.slice(-4).map((e) => html`<div style="font-size:13px">${e.date}: ${e.text}</div>`)}`);
    }
    if (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing') {
      const mission = s.mission;
      parts.push(html`<h3>Orders</h3>
        <div class="row" style="font-size:14px">${(['cruise', 'raid', 'kidnap', 'explore', 'foster_war'] as const).map((m) => html`<button class="btn small ${mission === m ? 'on' : ''}" data-act="mission:${m}" data-tip="${missionTip(m)}">${MISSION_NAMES[m]}</button>`)}</div>`);
      if (mission === 'cruise') {
        parts.push(html`<div class="row" style="font-size:14px;margin-top:4px">Tactics: ${(['board', 'pound', 'harass'] as const).map((o) => html`<button class="btn small ${s.orders === o ? 'on' : ''}" data-act="orders:${o}" data-tip="${ordersTip(o)}">${ORDERS_NAMES[o]}</button>`)}</div>`);
      }
      if (mission === 'cruise' || mission === 'explore' || mission === 'foster_war') {
        const reach = regionReachable(g, s, s.region);
        const months = (transitTime(g, s, s.region) / MONTH).toFixed(1);
        parts.push(html`<div class="row" style="font-size:14px;margin-top:4px">Region: <b>${region.name}</b> <button class="btn small" data-act="chart">${icon('telescope', 14)} Choose on chart</button></div>
          <div class="sub">${reach.ok ? `${months} months' sail each way` : reach.reason}</div>`);
      }
      if (mission === 'kidnap') {
        const jobs = ['shipwright', 'engineer', 'gunsmith', 'distiller', 'tobacconist', 'courtesan', 'surgeon', 'priest', 'trader', 'server', 'cook', 'farmer', 'wench', 'hatter', 'carpenter', 'birdhandler'] as const;
        parts.push(html`<div class="sub">Costs 250 gold. Always succeeds.</div><div class="row" style="font-size:13px">${jobs.map((j) => html`<button class="btn small ${s.kidnapJob === j ? 'on' : ''}" data-act="kidnap:${j}">${JOB_NAMES[j]}</button>`)}</div>`);
      }
      if (mission === 'foster_war') parts.push(html`<div class="row" style="font-size:14px">Provoke: ${NATIONS.map((n) => html`<button class="btn small ${s.foster === n ? 'on' : ''}" data-act="foster:${n}">${NATION_NAMES[n]}</button>`)}</div>`);
      parts.push(html`<div class="row" style="font-size:14px;margin-top:4px">Spoils: ${(['miserly', 'selfish', 'generous', 'bigspender'] as const).map((o) => html`<button class="btn small ${s.spoils === o ? 'on' : ''}" data-act="spoils:${o}">${SPOILS_NAMES[o]}</button>`)}</div>
        <div class="sub">How much of the plunder goes to the treasury. Stingy captains attract fewer recruits.</div>`);
      parts.push(html`<div class="row" style="margin-top:8px">
        <button class="btn green" data-act="sail">${icon('bell', 16)} ${s.status === 'boarding' ? 'Leave now!' : 'Set Sail'}</button>
        ${g.findBuilding('black_market') ? html`<button class="btn small" data-act="bm" data-tip="Buy rations and weapons instantly">Black Market</button>` : ''}
        <button class="btn small" data-act="shipEdict:donate_crew">Donate to crew</button>
        <button class="btn small" data-act="follow">${icon('follow', 14)}</button>
        <button class="btn small red" data-act="scuttle">Scuttle</button></div>`);
      if (s.log.length) parts.push(html`<h3>Last Voyage</h3>${s.log.slice(-5).map((e) => html`<div style="font-size:13px">${e.date}: ${e.text}</div>`)}`);
    }
    return html`<div class="scroll" style="max-height:calc(100vh - 140px)">${parts}</div>`;
  }
}

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
