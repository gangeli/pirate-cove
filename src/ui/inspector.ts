import type { App } from './app';
import { el, html, patchHTML, delegate, fmt, pct, bar, raw, toggleClass, type ActionHandler } from './dom';
import type { QuickAct } from './quickring';
import { icon, goodIcon } from './icons';
import { BUILDING, HOUSE_LEVELS, JOB_NAMES, RANKS, PRICE_LEVELS, type PirateNeed, type Job } from '../sim/data/buildings';
import { GOOD_NAMES, type Good } from '../sim/data/goods';
import { SHIPS, SHIP_LIST, MISSION_NAMES, SPOILS_TREASURY, PROVISIONS, DOCK_STOCK, type ShipType } from '../sim/data/ships';
import { NATION_ADJ, NATION_NAMES, NATIONS } from '../sim/data/kings';
import type { Building, Person, Ship } from '../sim/types';
import { serviceFee, serviceBand, pirateFactors } from '../sim/people';
import { farmFertility, treesNear, closedRows } from '../sim/economy';
import { portrait, portraitImg, portraitIdFor, type PortraitSpec } from './portraits';
import { audio } from '../audio/audio';
import { thumbOrQueue, THUMB_PLACEHOLDER } from './thumbs';
import { regionReachable, transitTime, rationsNeeded } from '../sim/sea';
import { MONTH } from '../sim/time';
import { EDICT } from '../sim/data/edicts';
import { coinPick, pennants, spoilsBar, goodChip, provisionRow, type ProvCell } from './controls';

const NEED_NAMES: Record<string, string> = { feast: 'Grub', drink: 'Grog', company: 'Company', gamble: 'Wagers', rest: 'Rest', stash: 'Stash', food: 'Food', prayer: 'Prayer', anarchy: 'Freedom', defense: 'Safety' };

/** a ship's status in plain words (never the sim's identifiers) */
export function shipStatusName(st: string): string {
  return ({ docked: 'In port', boarding: 'Boarding', departing: 'Setting sail', atsea: 'At sea', returning: 'Homeward', repairing: 'Repairing', building: 'Being built', lost: 'Lost' } as Record<string, string>)[st] ?? st;
}

export function activityText(app: App, p: Person): string {
  const g = app.game;
  const t = p.task;
  const b = t.bld ? g.buildings.get(t.bld) : undefined;
  // "the Tavern", but a named establishment keeps its own article: "The Powder Keg", not "the The Powder Keg"
  const bn0 = b ? (b.name ?? BUILDING[b.def].name) : '';
  const bn = /^the /i.test(bn0) ? bn0.slice(4) : bn0;
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
  /** the actions behind data-act names, shared with the quick-action seals beside the selection */
  readonly acts: Record<string, ActionHandler>;
  /** inspector folded away (the quick seals and a name tag stay beside the selection); reset whenever something is picked (App.select), even the same thing again */
  folded = false;
  /** the quick seals are showing beside the selection: footer buttons they duplicate are hidden */
  private ringed = false;
  /** the farm whose soil map is tinted on the ground (the sprout toggle), 0 for none */
  private soilFor = 0;
  /** the ship orders explain themselves in a line under each control (the "i" toggle); remembered per browser */
  private help = (() => {
    try {
      return localStorage.getItem('bc.orderHelp') === '1';
    } catch {
      return false;
    }
  })();

  constructor(private app: App) {
    this.panel = el('div', 'panel inspector hidden', app.root);
    this.acts = {
      // the × folds the details away; the seals (with a Details seal to reopen) stay beside the selection while it
      // is in view. Something with no seals (a ship at sea, someone indoors) is let go instead.
      close: () => (this.ringed ? this.fold(true) : app.select(null)),
      tab: (t) => {
        this.tab = t;
        this.refresh(true);
      },
      follow: () => {
        if (app.world.rig.follow) app.world.rig.follow = null;
        else app.follow();
        this.refresh(true);
      },
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
        app.modal.prompt('Name this establishment', `A new sign over the door of the ${BUILDING[b.def].name}:`, b.name ?? '', (name) => {
          app.cmd({ type: 'rename', id: b.id, name });
          this.refresh(true);
        });
      },
      renameShip: () => {
        const s = app.game.ships.get(this.sel());
        if (!s) return;
        app.modal.prompt('Name this ship', `New letters on the stern of the ${SHIPS[s.type].name}:`, s.name, (name) => {
          app.cmd({ type: 'renameShip', ship: s.id, name });
          this.refresh(true);
        });
      },
      help: () => {
        this.help = !this.help;
        try {
          localStorage.setItem('bc.orderHelp', this.help ? '1' : '0');
        } catch {
          /* private window: the toggle just isn't remembered */
        }
        this.refresh(true);
      },
      details: () => this.fold(false),
      soil: () => {
        const b = app.game.buildings.get(this.sel());
        const crop = b && BUILDING[b.def].gather?.crop;
        if (!b || !crop) return;
        this.soilFor = this.soilFor === b.id ? 0 : b.id;
        app.overlays.placementTint(this.soilFor ? 'soil' : null, crop);
        this.refresh(true);
      },
      prioUp: () => {
        const b = app.game.buildings.get(this.sel());
        if (b) this.bcmd({ type: 'setPriority', id: b.id, priority: b.priority >= 5 ? 1 : b.priority + 1 });
      },
    };
    delegate(this.panel, this.acts, () => audio.sfx('ui_click'));
    // staff places: Shift-click (or a long press on touch) closes or reopens them; caught before the plain click
    let held = false;
    let holdTimer = 0;
    this.panel.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (!t) return;
      if (held || e.shiftKey) {
        e.stopPropagation();
        e.preventDefault();
        if (!held) this.closeSlots(t.dataset.slot!);
        held = false;
      }
    }, true);
    this.panel.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      held = false;
      clearTimeout(holdTimer);
      if (!t || e.pointerType === 'mouse') return;
      holdTimer = window.setTimeout(() => {
        held = true;
        navigator.vibrate?.(15);
        this.closeSlots(t.dataset.slot!);
      }, 480);
    });
    const cancelHold = () => clearTimeout(holdTimer);
    this.panel.addEventListener('pointerup', cancelHold);
    this.panel.addEventListener('pointercancel', cancelHold);
    this.panel.addEventListener('pointerleave', cancelHold);
    this.panel.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('[data-slot]')) e.preventDefault();
    });
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
      if (this.soilFor) this.clearSoil();
      this.panel.classList.add('hidden');
      return;
    }
    const key = `${s.type}:${s.id}`;
    const changed = key !== this.lastKey;
    if (this.soilFor && (s.type !== 'building' || s.id !== this.soilFor)) this.clearSoil();
    if (changed) {
      if (this.lastKey && !this.lastKey.startsWith(`${s.type}:`)) this.tab = 'overview';
      this.lastKey = key;
      this.folded = false;
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
    toggleClass(this.panel, 'hidden', this.folded);
    if (this.folded) return;
    patchHTML(this.panel, html`<button class="close" data-act="close" aria-label="Close">${icon('close', 14)}</button>
      <header class="ins-head">${v.head}</header>
      <div class="ins-body scroll">${v.body}</div>
      ${v.foot ? html`<footer class="ins-foot">${v.foot}</footer>` : ''}`);
    if (changed) this.panel.querySelector('.ins-body')?.scrollTo(0, 0);
  }

  /** Follow as a toggle: pressed while the camera rides with the selection */
  private followBtn(cls = '') {
    const on = !!this.app.world.rig.follow;
    return html`<button class="btn nav small ${cls}" data-act="follow" aria-pressed="${on ? 'true' : 'false'}" data-tip="${on ? 'Stop following' : 'Keep the camera on this'}">${icon('follow', 14)} ${on ? 'Following' : 'Follow'}</button>`;
  }

  private clearSoil(): void {
    this.soilFor = 0;
    this.app.overlays.placementTint(null);
  }

  /** fold the inspector away (the seals beside the selection stay), or unfold it */
  fold(on: boolean): void {
    this.folded = on;
    this.refresh(true);
  }

  /** the quick seals are (not) showing: footer buttons they duplicate hide while they are */
  setRinged(on: boolean): void {
    if (on === this.ringed) return;
    this.ringed = on;
    toggleClass(this.panel, 'ringed', on);
  }

  /**
   * The quick actions for the seals beside the selection, its name (for the tag shown while the inspector is folded)
   * and its world box; null when it isn't in the world (a ship at sea, someone indoors).
   */
  quick(): { acts: QuickAct[]; name: string; box: { x: number; y: number; z: number; w: number; d: number; h: number } } | null {
    const s = this.app.selection;
    if (!s) return null;
    const g = this.app.game, w = this.app.world;
    // while the inspector is open it is the place for the details (its × folds it away); folded, a seal reopens it
    const details: QuickAct[] = this.folded ? [{ act: 'details', icon: 'book', label: 'Details', tone: 'brass', tip: 'Open the ledger for this' }] : [];
    if (s.type === 'building') {
      const b = g.buildings.get(s.id);
      if (!b) return null;
      const def = BUILDING[b.def];
      const acts: QuickAct[] = [...details];
      const staffed = def.workers.length > 0 || !!def.overseer || !!def.guards || !!def.haulers;
      if (b.built < 1 || staffed) acts.push({ act: 'prioUp', icon: 'flag', label: `${['Lowest', 'Low', 'Normal', 'High', 'Top'][b.priority - 1] ?? 'Normal'} priority`, tip: 'Raise the priority (wraps round to lowest)' });
      if (def.service && b.built >= 1) acts.push({ act: 'rename', icon: 'quill', label: 'Rename' });
      if (def.id === 'dock' && b.ship && g.ships.get(b.ship)) acts.push({ act: `gotoS:${b.ship}`, icon: 'ship', label: 'Her ship' });
      if (def.id !== 'palace') acts.push({ act: 'demolish', icon: 'bulldoze', label: 'Demolish', tone: 'bad' });
      const title = def.service && b.name ? b.name : def.name;
      const hy = Math.max(0.05, g.map.heightAt(b.x + b.w / 2, b.y + b.h / 2));
      return { acts, name: title, box: { x: b.x + b.w / 2, y: hy, z: b.y + b.h / 2, w: b.w, d: b.h, h: Math.max(1.4, Math.min(b.w, b.h) * 0.9) } };
    }
    if (s.type === 'ship') {
      const sh = g.ships.get(s.id);
      const pos = sh && sh.status !== 'atsea' ? w.ships.shipPosition(s.id) : null;
      if (!sh || !pos) return null;
      const acts: QuickAct[] = [...details];
      // Set sail lives in the inspector's footer; the seal offers it only while the inspector is folded away
      if (this.folded && (sh.status === 'docked' || sh.status === 'boarding' || sh.status === 'repairing')) acts.push({ act: 'sail', icon: 'bell', label: sh.status === 'boarding' ? 'Leave now' : 'Set sail', tone: 'ok' });
      acts.push({ act: 'chart', icon: 'telescope', label: 'Sea chart' }, { act: 'follow', icon: 'follow', label: 'Follow' });
      return { acts, name: sh.name, box: { x: pos.x, y: 0, z: pos.z, w: 6, d: 6, h: 7 } };
    }
    const p = g.people.get(s.id);
    const pos = p ? w.people.personPosition(s.id) : null;
    if (!p || !pos) return null;
    const acts: QuickAct[] = [...details, { act: 'follow', icon: 'follow', label: 'Follow' }];
    if (p.kind === 'pirate') acts.push({ act: 'edict:donate', icon: 'coin', label: 'Give gold', tip: 'Give 100 gold' });
    if (p.kind === 'captive' && !p.skilled) acts.push({ act: 'edict:press_gang', icon: 'pirate', label: 'Press-gang' });
    if ((p.kind === 'captive' && p.skilled) || p.kind === 'wealthy') acts.push({ act: 'edict:ransom', icon: 'coin', label: `Ransom ${fmt(p.kind === 'wealthy' ? p.ransom + p.credit : p.ransom)}`, tone: 'ok' });
    return { acts, name: p.name, box: { x: pos.x, y: Math.max(0.05, g.map.heightAt(pos.x, pos.z)), z: pos.z, w: 0.6, d: 0.6, h: 1.6 } };
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
      <div class="hd"><h2>${title}${def.service && b.built >= 1 ? html` <button class="icon-link" data-act="rename" aria-label="Rename" data-tip="Rename this establishment">${icon('quill', 15)}</button>` : ''}</h2>
        <div class="sub">${def.service && b.name ? def.name + ' · ' : ''}${def.desc}</div>
        ${chips.length ? html`<div class="chips">${chips}</div>` : ''}</div>`;
    if (b.built < 1) {
      body.push(html`<section class="sect"><h4 class="eng">Construction</h4>
        <div class="meters"><span>Built</span>${bar(b.built, 'brass')}<span>${pct(b.built)}</span></div>
        ${g.buildingCount('construction_tent') ? html`<div class="seg-note">Builders from the construction tents will finish it.</div>` : html`<div class="callout bad">${icon('info', 16)}<span>You need a Construction Tent and builders.</span></div>`}
        ${g.undo.some((e) => e.kind === 'build' && e.id === b.id) ? html`<div class="callout info">${icon('undo', 16)}<span>Changed your mind? <b>Undo</b> takes it back with a full refund.</span></div>` : ''}</section>
        <section class="sect"><div class="field-row"><span class="lbl">Priority</span>${pennants('prio', b.priority, PRIO_NAMES, 'Builders go to higher-priority sites first.')}</div></section>`);
    } else {
      // staff
      const slots = def.workers.filter((w) => w.job !== 'hauler' || def.id === 'dock');
      if (slots.length || def.haulers || def.overseer || def.guards) {
        const rows = [];
        this.closedPlaces(b).forEach((r, ri) => rows.push(this.slotRow(JOB_NAMES[r.job] + (r.count > 1 ? 's' : ''), r.count, r.ids, b, false, { row: ri, shut: r.shut })));
        if (def.haulers && !def.workers.some((w) => w.job === 'hauler')) rows.push(this.slotRow(def.haulers > 1 ? 'Haulers' : 'Hauler', def.haulers, b.haulers, b));
        if (def.overseer || def.guards) rows.push(this.slotRow(def.guards ? 'Guards' : 'Overseer', def.guards ?? 1, [b.overseer, ...b.guards].filter(Boolean), b, true));
        body.push(html`<section class="sect"><h4 class="eng">Staff</h4><div class="slotrows">${rows}</div>
          ${def.overseer || def.guards ? html`<div class="field-row"><span class="lbl">Wage</span>${coinPick('wage', b.wage, WAGES, WAGES.map((w) => (w ? `${w}g` : 'Unpaid')), WAGES.map((w) => `<b>${w ? `${w} gold a month` : 'Unpaid'}</b> for each ${def.guards ? 'guard' : 'overseer'}.<br>Pirates take the best-paid posts first.`), `${def.guards ? 'Guard' : 'Overseer'} wage`)}</div>` : ''}
          <div class="field-row"><span class="lbl">Priority</span>${pennants('prio', b.priority, PRIO_NAMES, 'Higher-priority buildings are staffed first, taking workers from lower ones.')}</div></section>`);
      }
      // production: input goods (×cost, stock) → progress → output good (stock, ringed by the progress)
      if (def.recipe || def.gather) {
        const r = def.recipe;
        const out = r?.out ?? def.gather!.out;
        const outN = Math.floor(b.inv[out] ?? 0);
        const ins = r ? Object.entries(r.in).map(([k, v]) => {
          const n = Math.floor(b.inv[k as Good] ?? 0);
          return goodChip(k, GOOD_NAMES[k as Good], n, { need: v, cls: n < v ? 'short' : '', tip: `<b>${GOOD_NAMES[k as Good]}</b><br>${v} make 1 ${GOOD_NAMES[out].toLowerCase()} · ${n} in stock` });
        }) : [];
        const extra = [];
        if (def.gather?.crop) {
          const f = farmFertility(g, b, def.gather.crop);
          const on = this.soilFor === b.id;
          extra.push(html`<button class="toggle soil ${on ? 'on' : ''}" data-act="soil" aria-pressed="${on ? 'true' : 'false'}" data-tip="<b>Soil ${pct(f)}</b><br>How well ${GOOD_NAMES[out].toLowerCase()} grows here. ${on ? 'Hide' : 'Show'} the soil map.">${icon('sprout', 16)} ${pct(f)}</button>`);
        }
        if (def.gather?.from === 'trees') {
          const t = treesNear(g, b, 9);
          extra.push(html`<span class="stat ${t < 6 ? 'bad' : ''}" data-tip="${t} trees within reach">${icon('lumber', 15)} ${t}</span>`);
        }
        body.push(html`<section class="sect"><div class="flow" aria-label="Production">${ins}
            ${r ? html`<span class="arrow" data-tip="Progress ${pct(b.progress)}"><i style="width:${Math.round(b.progress * 100)}%"></i></span>` : ''}
            ${goodChip(out, GOOD_NAMES[out], outN, { cls: 'out', ring: r ? undefined : b.progress, tip: `<b>${GOOD_NAMES[out]}</b><br>${outN} stored here${r ? '' : ` · next batch ${pct(b.progress)}`}` })}
            ${extra.length ? html`<span class="spacer"></span>${extra}` : ''}</div></section>`);
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
            const pid = p ? portraitIdFor(p) : null;
            return p ? html`<button class="slot full ${present ? '' : 'res'}" data-act="goto:${p.id}" aria-label="${p.name}" data-tip="${p.name}${present ? '' : ' (on the way)'}">${pid ? raw(portraitImg(pid, 32, 'face')) : icon('pirate', 18)}</button>` : html`<span class="slot empty"></span>`;
          })}</div>
          <div class="statrow" style="margin-top:8px">${Object.keys(sv.needs).map((n) => html`<span class="chip">${NEED_NAMES[n]}</span>`)}
            ${sv.bonus.map((x) => goodChip(x, GOOD_NAMES[x], Math.floor(b.inv[x] ?? 0), { tip: `<b>${GOOD_NAMES[x]}</b>: an extra for the customers · ${Math.floor(b.inv[x] ?? 0)} in stock` }))}
            <span class="stat" data-tip="<b>Serves</b> ${RANKS[lo - 1].name} to ${RANKS[hi - 1].name}">${icon('pirate', 15)} ${lo}–${hi}</span>
            <span class="stat" data-tip="<b>Fee</b>: ${serviceFee(b)} gold a visit">${icon('coin', 15)} ${serviceFee(b)}</span>
            <span class="stat" data-tip="<b>Last month</b>: ${fmt(b.lastIncome)} gold taken">${icon('chest', 15)} ${fmt(b.lastIncome)}</span></div></section>
          <section class="sect"><h4 class="eng">Running it</h4>
          <div class="field-row"><span class="lbl">Prices</span>${coinPick('price', b.price, PRICE_LEVELS.map((_, i) => i), PRICE_LEVELS.map((n, i) => ['Bargain', 'Middling', "Gouge 'em"][i] ?? n), PRICE_LEVELS.map((n, i) => `<b>${['Bargain', 'Middling', "Gouge 'em"][i] ?? n}</b><br>Dearer visits take more gold from each customer's purse.`), 'Prices')}</div>
          <div class="field-row" data-tip="Narrow the clientele to a band of ranks. Pirates outside the band enjoy it less."><span class="lbl">Clientele</span>${this.seg('quality', b.quality, [[0, 'All'], ...[1, 2, 3].filter((q) => sv.ranks[0] + q + 1 <= sv.ranks[1]).map((q) => [q, `Ranks ${sv.ranks[0] + q - 1}–${sv.ranks[0] + q + 1}`] as [number, string])])}</div></section>`);
      }
      if (def.captiveService) body.push(html`<section class="sect"><div class="kv"><span>${NEED_NAMES[def.captiveService.need]}</span><span>${b.customers.length} of ${def.captiveService.capacity} places in use</span></div></section>`);
      if (def.house) {
        const o = b.owner ? g.people.get(b.owner) : null;
        const lv = HOUSE_LEVELS[(b.houseLevel ?? 1) - 1];
        body.push(html`<section class="sect"><h4 class="eng">Dwelling</h4><div class="statrow"><span class="stat" data-tip="<b>Rest</b> ${pct(lv.rest)}: how well the owner sleeps here">${icon('heart', 15)} ${pct(lv.rest)}</span><span class="stat" data-tip="<b>Stash fee</b>: ${lv.fee} gold">${icon('chest', 15)} ${lv.fee}</span></div><div class="kv"><span>Owner</span><span>${o ? html`<a data-act="goto:${o.id}">${o.name}</a>` : 'Vacant'}</span>
</div>
</section>`);
      }
      if (def.id === 'dock') {
        const s = b.ship ? g.ships.get(b.ship) : null;
        body.push(html`<section class="sect"><h4 class="eng">Berth</h4>${s ? html`<button class="pick" data-act="gotoS:${s.id}">${icon('ship', 18)}<span class="nm">${s.name}<small>${SHIPS[s.type].name}</small></span><span class="chip">${shipStatusName(s.status)}</span></button>` : html`<div class="seg-note">Empty. Every ship needs a free dock.</div>`}</section>`);
        // provisions: her own stores while she is in port, and what the haulers have brought to the pier
        const inPort = !!s && (s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing');
        const rows = [];
        let short: string[] = [];
        if (s && inPort) {
          const cells = this.shipStores(s);
          short = cells.filter((c) => c.short).map((c) => c.name.toLowerCase());
          rows.push(provisionRow(icon('ship', 18), `<b>Aboard the ${s.name}</b><br>Her stores, filled up to what a ${SHIPS[s.type].name.toLowerCase()} carries`, `Aboard the ${s.name}`, cells));
        }
        rows.push(provisionRow(icon('anchor', 18), `<b>On the pier</b><br>${inPort ? 'Haulers bring her stores here and they go straight aboard.' : `Between voyages the haulers stock a ship's worth here, ready for a quick turnaround.`}`, 'On the pier', PROVISIONS.map(([good]) => {
          const have = Math.floor(b.inv[good] ?? 0);
          const name = GOOD_NAMES[good];
          return { good, name, have, cap: inPort ? undefined : DOCK_STOCK[good], tip: `<b>${name}</b><br>${have} on the pier${inPort ? ' · loaded aboard as soon as she has room' : ` · the haulers stock up to ${DOCK_STOCK[good]}`}` };
        })));
        body.push(html`<section class="sect"><h4 class="eng">Provisions${inPort ? html`<span class="aside ${short.length ? 'bad' : ''}">${short.length ? `Short of ${short.join(', ')}` : 'Ready for sea'}</span>` : ''}</h4>${rows}</section>`);
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
      if (def.id === 'graveyard') body.push(html`<section class="sect"><div class="kv"><span>Corpses</span><span>${g.graveyard.length}</span></div><div class="actions"><button class="btn coin small" data-act="raise">${icon('skull', 14)} Raise the dead <span class="cbadge">${icon('coin', 13)}−${fmt(this.app.edicts.cost('raise_dead'))}</span></button></div></section>`);
      if (def.id === 'smugglers_cove') body.push(html`<section class="sect"><h4 class="eng" data-tip="Open trade with the Diplomacy edicts">Trade</h4><div class="kv">${NATIONS.map((n) => html`<span>${NATION_NAMES[n]}</span><span>${g.ongoing.has(`open_cove:${n}`) ? html`<span class="chip ok">Open</span>` : html`<span class="chip">Closed</span>`}</span>`)}</div></section>`);
      // influence: one subdued line of aura icons with their strength and reach; the words in the tooltip
      if (def.auras) body.push(html`<div class="auras" aria-label="Influence">${Object.entries(def.auras).map(([k, [s, r]]) => html`<span class="aura ${s < 0 ? 'neg' : ''}" data-tip="<b>${AURA_NAMES[k] ?? k} ${s > 0 ? '+' : ''}${s}</b> within ${r} tiles<br>${AURA_TIPS[k] ?? ''}">${icon(AURA_ICONS[k] ?? 'info', 15)}<b>${s > 0 ? '+' : ''}${s}</b><i class="reach">${raw('<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.6"/><circle cx="6" cy="6" r="1.1" fill="currentColor"/></svg>')}${r}</i></span>`)}</div>`);
    }
    const foot = def.id !== 'palace' ? html`<span class="spacer"></span><button class="btn destroy small in-ring" data-act="demolish">${icon('bulldoze', 14)} Demolish</button>` : null;
    return { head, body: html`${body}`, foot };
  }

  private seg(act: string, cur: number | string, opts: [number | string, string][], cls = '') {
    return html`<div class="seg ${cls}" role="radiogroup">${opts.map(([v, n]) => html`<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="${act}:${v}" role="radio" aria-checked="${String(cur) === String(v) ? 'true' : 'false'}">${n}</button>`)}</div>`;
  }
  private prioSeg(b: Building) {
    return this.seg('prio', b.priority, [[1, 'Lowest'], [2, 'Low'], [3, 'Normal'], [4, 'High'], [5, 'Top']], 'prio');
  }

  /**
   * A row of staff places: a filled place shows the worker's face (click to inspect them); an open one is a dashed
   * frame; a closed one is barred. In the worker rows (`close` given) Shift-click, or a long press on touch, closes
   * a place and every place to its right, or reopens a closed one and those to its left.
   */
  private slotRow(label: string, count: number, ids: number[], b: Building, pirates = false, close?: { row: number; shut: number }) {
    const g = this.app.game;
    const shut = close ? close.shut : Math.min(b.blocked, Math.max(0, count - ids.length));
    const hint = close ? (this.app.touchMode ? 'Hold to close places' : 'Shift-click to close places') : '';
    return html`<div class="slotrow"><span class="lbl">${label}</span><div class="slots" role="group" aria-label="${label}">${Array.from({ length: count }, (_, i) => {
      const id = ids[i];
      const p = id ? g.people.get(id) : null;
      const sa = close ? html` data-slot="${close.row}:${i}"` : '';
      const bl = i >= count - shut;
      if (p) {
        const pid = portraitIdFor(p);
        const leaving = close && bl;
        return html`<button class="slot full ${leaving ? 'closing' : ''}" data-act="goto:${p.id}"${sa} aria-label="${p.name}${leaving ? ' (place closes when they leave)' : ''}" data-tip="<b>${p.name}</b>${p.skilled ? ' (skilled)' : ''}${leaving ? html`<br>This place closes when they leave.` : ''}${hint ? html`<br><i>${leaving ? (this.app.touchMode ? 'Hold to reopen' : 'Shift-click to reopen') : hint}</i>` : ''}">${pid ? raw(portraitImg(pid, 32, 'face')) : icon(pirates ? 'pirate' : 'captive', 18)}</button>`;
      }
      if (!close) return html`<span class="slot empty ${bl ? 'blocked' : ''}" data-tip="${bl ? 'Closed place' : 'Vacant'}"></span>`;
      return html`<button class="slot empty ${bl ? 'blocked' : ''}"${sa} aria-label="${bl ? 'Closed place' : 'Vacant place'}" aria-pressed="${bl ? 'true' : 'false'}" data-tip="<b>${bl ? 'Closed' : 'Vacant'}</b><br><i>${bl ? (this.app.touchMode ? 'Hold to reopen' : 'Shift-click to reopen') : hint}</i>">${bl ? icon('close', 16) : ''}</button>`;
    })}</div></div>`;
  }

  /** the worker rows and how many places at the right end of each are closed (as the sim hires by them) */
  private closedPlaces(b: Building): { job: Job; count: number; ids: number[]; shut: number }[] {
    const g = this.app.game;
    const shut = closedRows(g, b);
    return BUILDING[b.def].workers.map((sl, ri) => {
      const ids = [...new Set(sl.job === 'hauler' ? b.haulers.concat(b.workers.filter((id) => g.people.get(id)?.jobRole === 'hauler')) : b.workers.filter((id) => g.people.get(id)?.jobRole === sl.job))];
      return { job: sl.job, count: sl.count, ids, shut: shut[ri] };
    });
  }

  /** Shift-click or long press on the place at `row:i`: close it and the places to its right, or reopen it and those to its left */
  private closeSlots(spec: string): void {
    const b = this.app.game.buildings.get(this.sel());
    if (!b) return;
    const [ri, i] = spec.split(':').map(Number);
    const r = this.closedPlaces(b)[ri];
    if (!r) return;
    const want = i >= r.count - r.shut ? r.count - i - 1 : r.count - i;
    const delta = want - r.shut;
    if (!delta) return;
    audio.sfx('quill');
    this.bcmd({ type: 'blockSlot', id: b.id, delta, row: ri });
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
      const stats: unknown[] = [];
      if (p.kind === 'pirate') {
        stats.push(html`<span class="stat" data-tip="<b>Purse</b>: ${fmt(p.gold)} gold to spend">${icon('coin', 15)} ${fmt(p.gold)}</span>`,
          html`<span class="stat" data-tip="<b>Stashed</b>: ${fmt(p.stashed)} gold put away at home">${icon('chest', 15)} ${fmt(p.stashed)}</span>`,
          html`<span class="stat" data-tip="<b>Earned</b>: ${fmt(p.earned)} gold in all (it decides their rank)">${icon('crown', 15)} ${fmt(p.earned)}</span>`,
          html`<span class="stat ${p.happiness < 0.35 ? 'bad' : ''}" data-tip="<b>Happiness</b> ${pct(p.happiness)}">${icon('heart', 15)} ${pct(p.happiness)}</span>`);
        const ship = p.ship ? g.ships.get(p.ship) : null;
        kv.push(html`<span>Ship</span><span>${ship ? html`<a data-act="gotoS:${ship.id}">${ship.name}</a>${p.officer ? ' (officer)' : ''}` : 'None'}</span>`);
        const home = p.home ? g.buildings.get(p.home) : null;
        kv.push(html`<span>Home</span><span>${home ? html`<a data-act="gotoB:${home.id}">${HOUSE_LEVELS[(home.houseLevel ?? 1) - 1].name}</a>` : 'Sleeps rough'}</span>`);
        if (p.shoreJob) kv.push(html`<span>Shore job</span><span>${p.shoreRole} at the ${BUILDING[g.buildings.get(p.shoreJob)?.def ?? 'palace'].name}</span>`);
      } else if (p.kind === 'captive') {
        const job = p.job ? g.buildings.get(p.job) : null;
        kv.push(html`<span>Work</span><span>${job ? html`<a data-act="gotoB:${job.id}">${JOB_NAMES[p.jobRole!]} at the ${BUILDING[job.def].name}</a>` : 'Idle'}</span>`);
        const nine = (n: number) => html`<span class="pips9">${Array.from({ length: 9 }, (_, i) => html`<i class="${i < n ? 'on' : ''}"></i>`)}</span>`;
        stats.push(html`<span class="stat" data-tip="<b>Resignation</b> ${pct(p.resignation)}: how far they have given up on escape">${icon('chain', 15)} ${pct(p.resignation)}</span>`);
        if (p.skilled) stats.push(html`<span class="stat" data-tip="<b>Ransom</b>: ${fmt(p.ransom)} gold">${icon('coin', 15)} ${fmt(p.ransom)}</span>`);
        stats.push(html`<span class="stat" data-tip="<b>Courage</b> ${p.traits.courage} of 9">${icon('skull', 15)} ${nine(p.traits.courage)}</span>`,
          html`<span class="stat" data-tip="<b>Leadership</b> ${p.traits.leadership} of 9">${icon('flag', 15)} ${nine(p.traits.leadership)}</span>`);
      } else if (p.kind === 'wealthy') stats.push(html`<span class="stat" data-tip="<b>Ransom</b>: ${fmt(p.ransom + p.credit)} gold">${icon('coin', 15)} ${fmt(p.ransom + p.credit)}</span>`);
      if (kv.length || stats.length) body.push(html`<section class="sect">${stats.length ? html`<div class="statrow">${stats}</div>` : ''}${kv.length ? html`<div class="kv">${kv}</div>` : ''}</section>`);
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
    const acts = [this.followBtn('in-ring')];
    const deadly = [];
    if (p.kind === 'pirate') {
      acts.push(html`<button class="btn coin small in-ring" data-act="edict:donate" data-tip="Give this pirate 100 gold from the treasury">Give <span class="cbadge">${icon('coin', 13)}100</span></button>`);
      for (const a of ['pegleg', 'hat', 'parrot'] as const) if (g.goodTotal(a) > 0 && !p.accessories[a]) acts.push(html`<button class="btn tag small" data-act="edict:outfit|${a}" data-tip="Give from your stores">${goodIcon(a, 15)} Give ${a === 'pegleg' ? 'peg leg' : a}</button>`);
      for (const b of g.buildings.values()) {
        const sc = BUILDING[b.def].school;
        if (sc && b.built >= 1) acts.push(html`<button class="btn tag small" data-act="edict:educate|${sc}">${icon('book', 14)} Train ${sc}</button>`);
      }
      if (!p.captain) deadly.push(html`<button class="btn destroy small" data-act="edict:assassinate" data-tip="<b>Assassinate</b><br>Send a palace guard to settle this troublemaker. The target may win.">${icon('skull', 14)} Assassinate <span class="cbadge">${icon('coin', 13)}−${fmt(EDICT.assassinate.cost)}</span></button>`);
    }
    if (p.kind === 'captive') {
      if (!p.skilled) acts.push(html`<button class="btn tag small in-ring" data-act="edict:press_gang" data-tip="Make this captive a pirate">${icon('chain', 14)} Press-gang</button>`);
      if (p.skilled) acts.push(html`<button class="btn coin small in-ring" data-act="edict:ransom">Ransom <span class="cbadge gain">${icon('coin', 13)}+${fmt(p.ransom)}</span></button>`);
      acts.push(html`<button class="btn tag small" data-act="edict:free_captive" data-tip="Let this captive go">${icon('unchain', 14)} Set free</button>`);
      deadly.push(html`<button class="btn destroy small" data-act="edict:assassinate" data-tip="<b>Kill</b><br>Send a palace guard to put this captive to death.">${icon('skull', 14)} Kill <span class="cbadge">${icon('coin', 13)}−${fmt(EDICT.assassinate.cost)}</span></button>`);
    }
    if (p.kind === 'wealthy') acts.unshift(html`<button class="btn coin primary small" data-act="edict:ransom">Ransom <span class="cbadge gain">${icon('coin', 13)}+${fmt(p.ransom + p.credit)}</span></button>`);
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
    if (!out.length) out.push(["I've nothing to say to the likes of you.", false]);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ ship
  /**
   * A ship's provisions as cells for provisionRow: each store against what her class carries. In port the rations
   * carry a notch at what Set sail asks for the round trip on her present orders, and a store below what her
   * orders need (rations for the trip, cannons to pound, cannons and muskets to harass) is marked short.
   */
  private shipStores(s: Ship): ProvCell[] {
    const g = this.app.game;
    const d = SHIPS[s.type];
    const inPort = s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing';
    const rations = inPort ? Math.max(1, Math.ceil(rationsNeeded(g, s))) : 0;
    const cruise = inPort && s.mission === 'cruise';
    return PROVISIONS.map(([good, key]) => {
      const have = Math.floor(s[key]);
      const cap = d[key];
      const name = GOOD_NAMES[good];
      const need = good === 'ration' ? rations : cruise && ((good === 'cannon' && s.orders !== 'board') || (good === 'musket' && s.orders === 'harass')) ? 1 : 0;
      const why = good === 'ration' ? `${need} for the round trip` : `her tactics need at least ${need}`;
      return { good, name, have, cap, need: good === 'ration' ? need : undefined, short: need > 0 && s[key] < need, tip: `<b>${name}</b><br>${have} of ${cap} aboard${need ? ` · ${why}` : ''}` };
    });
  }

  private ship(s: Ship): View {
    const g = this.app.game;
    const d = SHIPS[s.type];
    const cap = g.people.get(s.captain);
    const region = g.regions[s.region];
    const statusText = { docked: 'In port', boarding: 'Boarding', departing: 'Setting sail', atsea: 'At sea', returning: 'Homeward bound', repairing: 'Under repair', building: 'Being built', lost: 'Lost' }[s.status];
    const inPort = s.status === 'docked' || s.status === 'boarding' || s.status === 'repairing';
    const help = this.help;
    const head = html`<div class="tile ship">${icon('ship', 46)}</div>
      <div class="hd"><h2><button class="name-edit" data-act="renameShip" data-tip="Rename this ship" aria-label="Rename ${s.name}">${s.name}${icon('quill', 15)}</button></h2>
        <div class="sub">${d.name} · ${d.cannons} guns · crew of ${d.men + d.officers + 1}</div>
        <div class="chips"><span class="chip ${s.status === 'docked' ? 'ok' : s.status === 'repairing' ? 'warn' : ''}">${statusText}</span>${cap ? html`<button class="chip link" data-act="goto:${cap.id}">${icon('pirate', 12)} ${cap.name}</button>` : html`<span class="chip bad">No captain</span>`}</div></div>`;
    const body = [];
    const supp = (label: string, have: number, max: number) => html`<span>${label}</span>${bar(have / Math.max(1, max))}<span>${Math.floor(have)}/${max}</span>`;
    const crewAboard = s.crew.filter((id) => g.people.get(id)?.task.kind === 'atsea').length;
    const stores = html`<section class="sect"><h4 class="eng">Crew & stores</h4><div class="meters two">
      ${supp('Crew', s.crew.length, d.men + d.officers)}${supp('Hull', s.hull * 100, 100)}</div>
      <div class="provs-gap">${provisionRow(icon('ship', 18), `<b>Aboard</b><br>Her stores, filled up to what a ${d.name.toLowerCase()} carries`, 'Stores aboard', this.shipStores(s))}</div>
      ${s.status === 'boarding' ? html`<div class="seg-note">${crewAboard} of ${s.crew.length} hands aboard.</div>` : ''}</section>`;
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
    const pay = EDICT.donate_crew;
    const payBtn = html`<button class="btn coin small" data-act="shipEdict:donate_crew" data-tip="<b>Pay the crew a bonus</b><br>Shares ${fmt(pay.cost)} gold from the treasury among the captain and crew: more to spend ashore, and it counts toward their rank.">Bonus <span class="cbadge">${icon('coin', 13)}−${fmt(pay.cost)}</span></button>`;
    if (inPort) {
      const mission = s.mission;
      const missions: [string, string, string][] = [['cruise', 'Cruise', 'ship'], ['raid', 'Raid', 'flag'], ['kidnap', 'Kidnap', 'chain'], ['explore', 'Explore', 'telescope'], ['foster_war', 'Foster war', 'scroll']];
      const note = (t: string) => (help ? html`<div class="seg-note">${t}</div>` : '');
      const orders = [html`<div class="cards missions" role="radiogroup" aria-label="Mission">${missions.map(([m, n, ic]) => html`<button class="${mission === m ? 'on' : ''}" data-act="mission:${m}" role="radio" aria-checked="${mission === m ? 'true' : 'false'}" data-tip="<b>${n}</b><br>${missionTip(m)}">${icon(ic, 26)}<span>${n}</span></button>`)}</div>
        ${note(missionTip(mission))}`];
      if (mission === 'cruise') {
        const tactics: [string, string, string][] = [['board', 'Board', 'g_cutlass'], ['pound', 'Pound', 'g_cannon'], ['harass', 'Harass', 'g_musket']];
        orders.push(html`<div class="field-row"><span class="lbl">Tactics</span><div class="cards tactics" role="radiogroup" aria-label="Tactics">${tactics.map(([o, n, ic]) => html`<button class="${s.orders === o ? 'on' : ''}" data-act="orders:${o}" role="radio" aria-checked="${s.orders === o ? 'true' : 'false'}" data-tip="<b>${n}</b><br>${ordersTip(o)}">${icon(ic, 20)}<span>${n}</span></button>`)}</div></div>
          ${note(ordersTip(s.orders))}`);
      }
      if (mission === 'cruise' || mission === 'explore' || mission === 'foster_war') {
        const reach = regionReachable(g, s, s.region);
        const months = (transitTime(g, s, s.region) / MONTH).toFixed(1);
        orders.push(html`<div class="field-row"><span class="lbl">Waters</span><button class="dest-btn ${reach.ok ? '' : 'bad'}" data-act="chart" data-tip="Pick the waters on the sea chart">${icon('telescope', 16)}<b>${region.name}</b>${s.region === g.homeRegion ? html`<span class="home-mark" data-tip="Home waters: your island lies here" aria-label="Home waters">${icon('anchor', 14)}</span>` : ''}${reach.ok ? html`<span class="badge" aria-label="${months} months' sail each way">${icon('compass', 13)} ${months} mo</span>` : ''}${icon('chevr', 14)}</button></div>
          ${reach.ok ? '' : html`<div class="callout bad">${icon('info', 16)}<span>${reach.reason}</span></div>`}`);
      }
      if (mission === 'kidnap') {
        const jobs = ['shipwright', 'engineer', 'gunsmith', 'distiller', 'tobacconist', 'courtesan', 'surgeon', 'priest', 'trader', 'server', 'cook', 'farmer', 'wench', 'hatter', 'carpenter', 'birdhandler'] as const;
        orders.push(html`<div class="field-row top"><span class="lbl">Target <span class="badge">${icon('coin', 13)} 250</span></span>${this.seg('kidnap', s.kidnapJob ?? '', jobs.map((j) => [j, JOB_NAMES[j]] as [string, string]), 'wrap')}</div>`);
      }
      if (mission === 'foster_war') orders.push(html`<div class="field-row"><span class="lbl">Provoke</span>${this.seg('foster', s.foster ?? '', NATIONS.map((n) => [n, NATION_NAMES[n]] as [string, string]), 'full')}</div>`);
      body.push(html`<section class="sect"><h4 class="eng">Orders<button class="icon-link aside help ${help ? 'on' : ''}" data-act="help" aria-pressed="${help ? 'true' : 'false'}" aria-label="${help ? 'Hide' : 'Explain'} the orders" data-tip="${help ? 'Hide' : 'Explain'} the orders">${icon('info', 16)}</button></h4>${orders}</section>`);
      const spoils: [string, string, number][] = (['miserly', 'selfish', 'generous', 'bigspender'] as const).map((v) => [v, { miserly: 'Miserly', selfish: 'Selfish', generous: 'Generous', bigspender: 'Big spender' }[v], SPOILS_TREASURY[v]]);
      body.push(html`<section class="sect"><h4 class="eng">Spoils</h4>${spoilsBar('spoils', s.spoils, spoils)}${note('Stingy captains attract fewer recruits.')}</section>`);
      body.push(stores);
      if (s.log.length) body.push(html`<section class="sect"><h4 class="eng">Last voyage</h4><ol class="log">${s.log.slice(-5).map((e) => html`<li><i>${e.date}</i> ${e.text}</li>`)}</ol></section>`);
      foot = html`<button class="btn primary sail" data-act="sail">${icon('bell', 16)} ${s.status === 'boarding' ? 'Leave now' : 'Set sail'}</button>
        ${payBtn}
        ${g.findBuilding('black_market') ? html`<button class="btn coin small" data-act="bm" data-tip="<b>Black market</b><br>Buy rations and weapons for her at once, at a price that climbs with every purchase.">${icon('coin', 14)} Black market</button>` : ''}
        <span class="spacer"></span><button class="btn destroy small" data-act="scuttle" data-tip="Sink her at her moorings">${icon('skull', 14)} Scuttle</button>`;
    } else foot = html`${this.followBtn()}<button class="btn nav small" data-act="chart">${icon('telescope', 14)} Sea chart</button>`;
    return { head, body: html`${body}`, foot };
  }
}

type View = { head: unknown; body: unknown; foot: unknown };
const AURA_NAMES: Record<string, string> = { order: 'Order', anarchy: 'Anarchy', fear: 'Fear', defense: 'Defense', awe: 'Awe' };
const AURA_ICONS: Record<string, string> = { order: 'scales', anarchy: 'flag', fear: 'skull', defense: 'shield', awe: 'crown' };
const AURA_TIPS: Record<string, string> = {
  order: 'Captives nearby resign themselves sooner; pirates nearby feel less free.',
  anarchy: 'Pirates nearby feel free.',
  fear: 'Captives nearby are cowed and resign themselves sooner.',
  defense: 'Pirates nearby feel safe.',
  awe: 'Captives nearby are awed and resign themselves sooner.',
};
const PRIO_NAMES = ['Lowest', 'Low', 'Normal', 'High', 'Top'];
const WAGES = [0, 2, 4, 8, 12];

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
