import { GameMap, Terrain } from './map';
import { difficultyOf } from './presets';
import { Rng } from './rng';
import { PathFinder } from './path';
import { AuraGrid } from './aura';
import { BUILDING, type BuildingDef, type Job } from './data/buildings';
import type { Good } from './data/goods';
import { NATIONS, type Nation, KINGS, type KingDef } from './data/kings';
import type { Building, KingState, Message, NationState, Person, Region, Settings, Ship } from './types';
import { canPlace, placeBuilding, removeBuilding, placeRoad, removeRoad, setupStartingIsland, wouldWallOff, type Placement } from './placement';
import { updatePeople, createPerson, killPerson, rebellionMonthly } from './people';
import { updateEconomy, monthlyEconomy, lumberTotal, consumeLumber, goodTotal } from './economy';
import { updateShips, makeRegions, launchShip, commissionShip, assignCrews } from './sea';
import { monthlyDiplomacy, updateInvasion, launchInvasion } from './diplomacy';
import { issueEdict, edictAvailability } from './edicts';
import { computeScore, type ScoreBreakdown } from './score';
import { checkAdvisor } from './advisor';
import type { ShipType, Mission, Orders, Spoils } from './data/ships';

import { MONTH, YEAR, START_YEAR, DT } from './time';
export { MONTH, YEAR, START_YEAR, DT };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type Command =
  | { type: 'build'; def: string; x: number; y: number; rot: number }
  | { type: 'road'; x: number; y: number }
  | { type: 'roadLine'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'unroad'; x: number; y: number }
  | { type: 'demolish'; id: number }
  | { type: 'clearTrees'; x: number; y: number; r: number }
  | { type: 'setPriority'; id: number; priority: number }
  | { type: 'setWage'; id: number; wage: number }
  | { type: 'setPrice'; id: number; price: number }
  | { type: 'setQuality'; id: number; quality: number }
  | { type: 'rename'; id: number; name: string }
  | { type: 'commission'; yard: number; ship: ShipType }
  | { type: 'shipOrders'; ship: number; mission?: Mission; orders?: Orders; spoils?: Spoils; region?: number; kidnapJob?: Job; foster?: Nation }
  | { type: 'setSail'; ship: number; force?: boolean }
  | { type: 'scuttle'; ship: number }
  | { type: 'buyBlackMarket'; ship: number; budget?: number }
  | { type: 'edict'; id: string; target?: number; nation?: Nation; arg?: string; repeal?: boolean }
  | { type: 'hoardRate'; rate: number }
  | { type: 'blockSlot'; id: number; delta: number }
  | { type: 'fire'; id: number; person: number }
  | { type: 'cheat'; code: string };

export interface CmdResult {
  ok: boolean;
  reason?: string;
  id?: number;
}

export class Game {
  settings: Settings;
  map: GameMap;
  rng: Rng;
  pf: PathFinder;
  aura: AuraGrid;
  time = 0;
  month = 0;
  speed = 1;
  paused = false;
  treasury = 0;
  hoard = 0;
  hoardRate = 0.1;
  people = new Map<number, Person>();
  buildings = new Map<number, Building>();
  ships = new Map<number, Ship>();
  regions: Region[] = [];
  nations: Record<Nation, NationState>;
  king: KingState;
  ongoing = new Set<string>();
  messages: Message[] = [];
  nextId = 1;
  /** id of ships' home region (island location) */
  homeRegion = 0;
  over: null | { win: boolean; reason: string; score: ScoreBreakdown } = null;
  /** monthly history for graphs */
  history: { m: number; treasury: number; hoard: number; pirates: number; captives: number; happiness: number; resignation: number; income: number; expense: number }[] = [];
  finance = { income: {} as Record<string, number>, expense: {} as Record<string, number>, lastIncome: {} as Record<string, number>, lastExpense: {} as Record<string, number> };
  stats = { plundered: 0, captured: 0, shipsSunk: 0, escapes: 0, escapeKills: 0, deaths: 0, piratesDied: 0, recruits: 0, exported: {} as Partial<Record<Good, number>> };
  /** coup/rebellion warnings */
  unrest: { coupWarn: number; rebellion: boolean; coupMonths: number; rebelSince?: number } = { coupWarn: 0, rebellion: false, coupMonths: 0 };
  graveyard: { name: string; nat: Nation }[] = [];
  captainPool: string[] = [];
  /** edict temporary effects */
  effects: { festivalUntil: number; skeletonsRaised: number; recentEscapes: number; recentKills: number; patronGift?: number; neglect?: number } = { festivalUntil: 0, skeletonsRaised: 0, recentEscapes: 0, recentKills: 0 };
  blackMarketMarkup: Partial<Record<Good, number>> = {};
  /** listeners for renderer/audio */
  events: { type: string; [k: string]: any }[] = [];
  private acc = 0;
  advisorState: Record<string, number> = {};
  cheats = { freebuild: false };
  difficulty = 1;

  constructor(settings: Partial<Settings> = {}, king: KingDef | KingState = KINGS[2]) {
    this.settings = {
      seed: 12345, size: 'medium', mountains: 0.5, vegetation: 0.5, minerals: 0.5, years: 20, stability: 2,
      advantage: 'standard', bonus: 'hoard', region: 6, startGold: 2500, ...settings,
    };
    const s = this.settings;
    this.rng = new Rng(s.seed * 7919 + 13);
    const size = s.size === 'small' ? 128 : s.size === 'large' ? 192 : 160;
    this.map = new GameMap({ size, seed: s.seed + (s.mapSalt ?? 0) * 1013, landFraction: 0.55, mountainousness: s.mountains, jungle: s.vegetation });
    this.pf = new PathFinder(this.map);
    this.aura = new AuraGrid(size);
    this.king = 'bio' in king
      ? { name: king.name, sex: king.sex, nat: king.nat, bg: king.bg, q: [...king.q], flaw: king.flaw, portrait: king.id }
      : king;
    this.nations = {} as any;
    for (const n of NATIONS) {
      this.nations[n] = { relation: 0, knows: false, peace: false, peaceBroken: 0, plunderGold: 0, plunderCaptives: 0, invasion: { stage: 0, timer: 0, strength: 0 }, reserve: 6, atWarWith: [] };
    }
    this.applyKingRelations();
    this.homeRegion = s.region;
    this.regions = makeRegions(this.rng, this.homeRegion);
    this.treasury = s.startGold;
    this.captainPool = [];
    this.difficulty = this.computeDifficulty();
    setupStartingIsland(this);
    // a rare coastline offers no berth for the starting ship: reshape the island and start again
    if (!this.findBuilding('dock') && (s.mapSalt ?? 0) < 6) {
      Object.assign(this, new Game({ ...settings, mapSalt: (s.mapSalt ?? 0) + 1 }, king));
      return;
    }
    this.aura.recompute(this);
  }

  // ------------------------------------------------------------------ time
  get date(): string {
    const m = Math.floor(this.time / MONTH);
    return `${MONTHS[m % 12]} ${START_YEAR + Math.floor(m / 12)}`;
  }
  get monthIndex(): number {
    return Math.floor(this.time / MONTH);
  }
  get yearsElapsed(): number {
    return this.time / YEAR;
  }

  /** advance by real seconds (applies speed) */
  advance(realDt: number): void {
    if (this.paused || this.over) return;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= DT && steps < 400) {
      this.step();
      this.acc -= DT;
      steps++;
    }
  }

  /** one fixed simulation step */
  step(): void {
    if (this.over) return;
    this.time += DT;
    if (this.aura.dirty) this.aura.recompute(this);
    updateEconomy(this, DT);
    updatePeople(this, DT);
    updateShips(this, DT);
    updateInvasion(this, DT);
    const m = this.monthIndex;
    if (m !== this.month) {
      this.month = m;
      this.onMonth();
    }
    if (Math.floor(this.time / 2) !== Math.floor((this.time - DT) / 2)) checkAdvisor(this);
  }

  /** run headless for a number of game seconds */
  run(seconds: number): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n && !this.over; i++) this.step();
  }

  private onMonth(): void {
    this.finance.lastIncome = this.finance.income;
    this.finance.lastExpense = this.finance.expense;
    this.finance.income = {};
    this.finance.expense = {};
    monthlyEconomy(this);
    monthlyDiplomacy(this);
    rebellionMonthly(this);
    this.aura.dirty = true;
    const pir = this.pirates();
    const cap = this.captives();
    const hap = pir.length ? pir.reduce((a, p) => a + p.happiness, 0) / pir.length : 0.5;
    const res = cap.length ? cap.reduce((a, p) => a + p.resignation, 0) / cap.length : 0.5;
    const inc = Object.values(this.finance.lastIncome).reduce((a, b) => a + b, 0);
    const exp = Object.values(this.finance.lastExpense).reduce((a, b) => a + b, 0);
    this.history.push({ m: this.month, treasury: this.treasury, hoard: this.hoard, pirates: pir.length, captives: cap.length, happiness: hap, resignation: res, income: inc, expense: exp });
    this.checkCoup(pir);
    if (this.yearsElapsed >= this.settings.years && !this.over) {
      this.endGame(true, 'Your reign is complete.');
    }
  }

  private checkCoup(pir: Person[]): void {
    const ashore = pir.filter((p) => p.task.kind !== 'atsea');
    if (ashore.length < 6) return;
    const red = ashore.filter((p) => p.happiness < 0.3).length / ashore.length;
    if (red > 0.5) {
      this.unrest.coupMonths++;
      if (this.unrest.coupMonths === 1) this.msg('alert', 'Mutterings of Mutiny', 'Most of the pirates ashore are in a black mood. If this goes on, they will rise against you!', 'coup_warning1', undefined, true);
      else if (this.unrest.coupMonths === 2) this.msg('alert', 'Coup Brewing!', 'The crews are sharpening their cutlasses and muttering your name. Make them happy, fast, or lose your crown.', 'coup_warning2', undefined, true);
      else if (this.unrest.coupMonths >= 3) this.endGame(false, 'The pirates rose up and overthrew you. Your head now decorates a pike.');
    } else this.unrest.coupMonths = Math.max(0, this.unrest.coupMonths - 1);
  }

  endGame(win: boolean, reason: string): void {
    if (this.over) return;
    this.over = { win, reason, score: computeScore(this) };
    this.events.push({ type: 'gameover', win });
    this.msg(win ? 'good' : 'bad', win ? 'Reign Complete' : 'Game Over', reason, win ? 'victory' : 'defeat', undefined, true);
  }

  // ------------------------------------------------------------------ money
  earn(amount: number, cat: string): void {
    if (amount <= 0) return;
    const skim = this.buildingCount('cave') ? amount * this.hoardRate : 0;
    this.hoard += skim;
    this.treasury += amount - skim;
    this.finance.income[cat] = (this.finance.income[cat] ?? 0) + amount;
  }
  spend(amount: number, cat: string): void {
    this.treasury -= amount;
    this.finance.expense[cat] = (this.finance.expense[cat] ?? 0) + amount;
  }

  // ------------------------------------------------------------------ queries
  pirates(): Person[] {
    const out: Person[] = [];
    for (const p of this.people.values()) if (p.kind === 'pirate' && p.task.kind !== 'dead') out.push(p);
    return out;
  }
  captives(): Person[] {
    const out: Person[] = [];
    for (const p of this.people.values()) if ((p.kind === 'captive' || p.kind === 'skeleton') && p.task.kind !== 'dead') out.push(p);
    return out;
  }
  buildingCount(def: string, completeOnly = true): number {
    let c = 0;
    for (const b of this.buildings.values()) if (b.def === def && (!completeOnly || b.built >= 1)) c++;
    return c;
  }
  findBuilding(def: string): Building | undefined {
    for (const b of this.buildings.values()) if (b.def === def && b.built >= 1) return b;
    return undefined;
  }
  hasProfession(job: Job): boolean {
    for (const p of this.people.values()) if (p.kind === 'captive' && p.skilled && p.profession === job && p.task.kind !== 'dead') return true;
    return false;
  }
  lumber(): number {
    return lumberTotal(this);
  }
  goodTotal(g: Good): number {
    return goodTotal(this, g);
  }
  tileBuilding(x: number, y: number): Building | undefined {
    if (!this.map.inBounds(x, y)) return undefined;
    const id = this.map.occupied[this.map.idx(x, y)];
    return id ? this.buildings.get(id) : undefined;
  }
  avgHappiness(): number {
    const p = this.pirates();
    return p.length ? p.reduce((a, b) => a + b.happiness, 0) / p.length : 0;
  }
  avgResignation(): number {
    const p = this.captives().filter((c) => c.kind === 'captive');
    return p.length ? p.reduce((a, b) => a + b.resignation, 0) / p.length : 0;
  }
  has(q: string): boolean {
    return (this.king.q as string[]).includes(q) || this.king.flaw === q || this.king.bg === q;
  }
  /** island-wide aura multipliers from ruler traits & edicts */
  auraMods(): { order: number; anarchy: number; fear: number; defense: number; awe: number } {
    let order = 1, anarchy = 1, fear = 1, defense = 1;
    if (this.has('fun_loving')) (anarchy *= 1.33), (order *= 0.67);
    if (this.has('iron_handed')) (order *= 1.33), (anarchy *= 0.67);
    if (this.has('decayed_gentleman') || this.has('once_captain')) order *= 1.33;
    if (this.has('once_mutineer')) (fear *= 1.19), (order *= 0.81);
    if (this.has('diplomacy')) defense *= 1.19;
    if (this.has('inquisitor')) fear *= 1.2;
    if (this.ongoing.has('curfew')) order *= 1.6;
    if (this.ongoing.has('loose_lips')) order *= 1.2;
    if (this.ongoing.has('patrols')) (order *= 1.25), (fear *= 1.2);
    if (this.ongoing.has('informants')) fear *= 1.3;
    if (this.ongoing.has('executions')) (fear *= 1.3), (anarchy *= 1.2);
    if (this.time < this.effects.festivalUntil) anarchy *= 1.5;
    return { order, anarchy, fear, defense, awe: 1 };
  }
  costOf(def: BuildingDef): { gold: number; lumber: number } {
    let gold = def.gold, lumber = def.lumber;
    const half = () => ((gold = Math.round(gold / 2)), (lumber = Math.round(lumber / 2)));
    if ((def.id === 'gambling_den' || def.id === 'casino') && (this.has('gambler') || this.has('lucky_cards'))) half();
    if ((def.id === 'school_gunnery' || def.id === 'cannon_foundry') && this.has('master_gunner')) half();
    if (def.id === 'brothel' && this.has('procurer')) half();
    if (def.id === 'shipyard' && this.has('shipwright')) half();
    if (def.id === 'distillery' && this.has('sugar_planter')) half();
    if (def.id === 'cigar_factory' && this.has('tobacco_planter')) half();
    if (def.school && this.has('illiterate')) gold = Math.round(gold * 1.5);
    return { gold, lumber };
  }
  /** returns missing requirements for a building, or [] */
  missingReqs(def: BuildingDef): string[] {
    const out: string[] = [];
    if (this.cheats.freebuild) return out;
    for (const r of def.req ?? []) if (!this.hasProfession(r)) out.push(r);
    if (def.unique && this.buildingCount(def.id, false) > 0) out.push('unique');
    if (def.id === 'hotel' && !this.pirateLike().some((p) => p.kind === 'wealthy')) out.push('wealthy captive');
    return out;
  }
  pirateLike(): Person[] {
    return [...this.people.values()].filter((p) => p.task.kind !== 'dead');
  }

  // ------------------------------------------------------------------ messages
  msg(kind: Message['kind'], title: string, text: string, voice?: string, focus?: { x: number; y: number }, modal = false): Message {
    const m: Message = { id: this.nextId++, t: this.time, date: this.date, kind, title, text, voice, focus, modal };
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.shift();
    this.events.push({ type: 'message', msg: m });
    return m;
  }

  // ------------------------------------------------------------------ commands
  cmd(c: Command): CmdResult {
    if (this.over && c.type !== 'cheat') return { ok: false, reason: 'The game is over.' };
    switch (c.type) {
      case 'build': {
        const def = BUILDING[c.def];
        if (!def) return { ok: false, reason: 'Unknown building' };
        const pl = canPlace(this, def, c.x, c.y, c.rot);
        if (!pl.ok) return { ok: false, reason: pl.reason };
        const miss = this.missingReqs(def);
        if (miss.length) return { ok: false, reason: miss[0] === 'unique' ? 'You may only build one of these.' : `Requires a skilled ${miss.join(', ')}.` };
        const cost = this.costOf(def);
        if (cost.gold > 0 && this.treasury < cost.gold && !this.cheats.freebuild) return { ok: false, reason: 'Not enough gold.' };
        if (this.lumber() < cost.lumber && !this.cheats.freebuild) return { ok: false, reason: 'Not enough lumber.' };
        if (wouldWallOff(this, def, pl as Placement)) return { ok: false, reason: 'That would wall off part of the island.' };
        if (cost.gold) this.spend(cost.gold, 'construction');
        consumeLumber(this, cost.lumber);
        const b = placeBuilding(this, def, pl as Placement);
        this.events.push({ type: 'placed', id: b.id });
        return { ok: true, id: b.id };
      }
      case 'road':
        return placeRoad(this, c.x, c.y);
      case 'roadLine': {
        let x = c.x0, y = c.y0;
        let any = false;
        const pts: [number, number][] = [];
        // L-shaped: horizontal then vertical, like most city builders
        const sx = Math.sign(c.x1 - c.x0), sy = Math.sign(c.y1 - c.y0);
        pts.push([x, y]);
        while (x !== c.x1) (x += sx), pts.push([x, y]);
        while (y !== c.y1) (y += sy), pts.push([x, y]);
        let last: CmdResult = { ok: false, reason: 'Nothing to build' };
        // place in order; allow pieces adjacent to network as we go
        for (let pass = 0; pass < 2; pass++)
          for (const [px, py] of pts) {
            if (this.map.path[this.map.idx(px, py)]) continue;
            const r = placeRoad(this, px, py);
            if (r.ok) any = true;
            else last = r;
          }
        return any ? { ok: true } : last;
      }
      case 'unroad':
        return removeRoad(this, c.x, c.y);
      case 'demolish': {
        const b = this.buildings.get(c.id);
        if (!b) return { ok: false, reason: 'No such building' };
        if (b.def === 'palace') return { ok: false, reason: 'You cannot demolish your own palace!' };
        removeBuilding(this, b);
        return { ok: true };
      }
      case 'clearTrees': {
        let n = 0;
        for (let y = c.y - c.r; y <= c.y + c.r; y++)
          for (let x = c.x - c.r; x <= c.x + c.r; x++)
            if (this.map.inBounds(x, y) && this.map.trees[this.map.idx(x, y)]) {
              this.map.trees[this.map.idx(x, y)] = 0;
              if (this.map.terrain[this.map.idx(x, y)] === Terrain.Jungle) this.map.terrain[this.map.idx(x, y)] = Terrain.Grass;
              n++;
            }
        if (n) {
          this.pf.invalidate();
          this.events.push({ type: 'trees', x: c.x - c.r, y: c.y - c.r, w: c.r * 2 + 1, h: c.r * 2 + 1 });
        }
        return { ok: n > 0, reason: n ? undefined : 'No vegetation there.' };
      }
      case 'setPriority':
      case 'setWage':
      case 'setPrice':
      case 'setQuality':
      case 'rename': {
        const b = this.buildings.get(c.id);
        if (!b) return { ok: false, reason: 'No such building' };
        if (c.type === 'setPriority') b.priority = Math.max(1, Math.min(5, c.priority));
        if (c.type === 'setWage') b.wage = Math.max(0, Math.min(14, c.wage));
        if (c.type === 'setPrice') b.price = Math.max(0, Math.min(2, c.price));
        if (c.type === 'setQuality') b.quality = Math.max(0, Math.min(4, c.quality));
        if (c.type === 'rename') b.name = c.name.slice(0, 32);
        return { ok: true };
      }
      case 'blockSlot': {
        const b = this.buildings.get(c.id);
        if (!b) return { ok: false };
        b.blocked = Math.max(0, b.blocked + c.delta);
        return { ok: true };
      }
      case 'fire': {
        const b = this.buildings.get(c.id);
        const p = this.people.get(c.person);
        if (!b || !p) return { ok: false };
        if (p.job === b.id) {
          b.workers = b.workers.filter((w) => w !== p.id);
          b.haulers = b.haulers.filter((w) => w !== p.id);
          p.job = 0;
          p.jobRole = undefined;
          b.blocked++;
        }
        if (p.shoreJob === b.id) {
          b.guards = b.guards.filter((w) => w !== p.id);
          if (b.overseer === p.id) b.overseer = 0;
          p.shoreJob = 0;
          p.shoreRole = undefined;
          b.blocked++;
        }
        return { ok: true };
      }
      case 'commission':
        return commissionShip(this, c.yard, c.ship);
      case 'shipOrders': {
        const s = this.ships.get(c.ship);
        if (!s) return { ok: false, reason: 'No such ship' };
        if (s.status === 'atsea' || s.status === 'departing' || s.status === 'returning') return { ok: false, reason: 'Ships at sea cannot be re-tasked.' };
        if (c.mission) s.mission = c.mission;
        if (c.orders) s.orders = c.orders;
        if (c.spoils) {
          if (this.has('greedy') && (c.spoils === 'generous' || c.spoils === 'bigspender')) return { ok: false, reason: 'Your greed will not allow it!' };
          s.spoils = c.spoils;
        }
        if (c.region !== undefined) s.region = c.region;
        if (c.kidnapJob) s.kidnapJob = c.kidnapJob;
        if (c.foster) s.foster = c.foster;
        return { ok: true };
      }
      case 'setSail':
        return launchShip(this, c.ship, !!c.force);
      case 'scuttle': {
        const s = this.ships.get(c.ship);
        if (!s || s.status === 'atsea') return { ok: false, reason: 'Cannot scuttle that ship now.' };
        for (const id of s.crew) {
          const p = this.people.get(id);
          if (p) p.ship = 0;
        }
        const cap = this.people.get(s.captain);
        if (cap) cap.ship = 0;
        const d = this.buildings.get(s.dock);
        if (d) d.ship = 0;
        this.ships.delete(s.id);
        this.events.push({ type: 'shipRemoved', id: s.id });
        return { ok: true };
      }
      case 'buyBlackMarket':
        return buyBlackMarket(this, c.ship, c.budget);
      case 'edict':
        return issueEdict(this, c.id, c.target, c.nation, c.arg, c.repeal);
      case 'hoardRate':
        this.hoardRate = Math.max(0, Math.min(0.25, c.rate));
        return { ok: true };
      case 'cheat':
        return this.cheat(c.code);
    }
  }

  edictAvailability(id: string, nation?: Nation) {
    return edictAvailability(this, id, nation);
  }

  private cheat(code: string): CmdResult {
    switch (code) {
      case 'timber': {
        const s = this.findBuilding('sawmill');
        if (s) s.inv.lumber = (s.inv.lumber ?? 0) + 100;
        return { ok: true };
      }
      case 'booty':
        this.treasury += 2000;
        return { ok: true };
      case 'freebuild':
        this.cheats.freebuild = !this.cheats.freebuild;
        return { ok: true };
      case 'winit':
        this.endGame(true, 'Victory by royal decree.');
        return { ok: true };
      case 'loseit':
        this.endGame(false, 'You gave up the crown.');
        return { ok: true };
      case 'britinv':
      case 'frenchinv':
      case 'spaininv': {
        const n: Nation = code === 'britinv' ? 'eng' : code === 'frenchinv' ? 'fra' : 'spa';
        this.nations[n].knows = true;
        this.nations[n].invasion = { stage: 3, timer: 0, strength: 8 };
        launchInvasion(this, n, 8);
        return { ok: true };
      }
      case 'captives': {
        for (let i = 0; i < 10; i++) {
          const d = this.findBuilding('dock') ?? this.findBuilding('palace')!;
          createPerson(this, 'captive', d.door[0], d.door[1]);
        }
        return { ok: true };
      }
    }
    return { ok: false, reason: 'Unknown cheat' };
  }

  private applyKingRelations(): void {
    for (const n of NATIONS) {
      let r = 0;
      if (this.has('decayed_gentleman')) r += 50;
      if (this.has('diplomacy')) r += 10;
      if (this.has('trilingual') && n !== this.king.nat) r += 20;
      if (this.king.flaw === `tortured_${n}`) r -= 50;
      this.nations[n].relation = r;
    }
  }

  computeDifficulty(): number {
    return difficultyOf(this.settings);
  }

  /** stability-based delay before auras affect a newcomer */
  auraDelay(): number {
    return [YEAR * 2, YEAR, MONTH * 4, MONTH * 2, MONTH][this.settings.stability - 1] ?? MONTH * 4;
  }

  // ------------------------------------------------------------------ save/load
  serialize(): string {
    const m = this.map;
    const enc = (a: ArrayBufferView) => {
      const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return JSON.stringify({
      v: 1,
      settings: this.settings, king: this.king, time: this.time, month: this.month, treasury: this.treasury, hoard: this.hoard,
      hoardRate: this.hoardRate, people: [...this.people.values()], buildings: [...this.buildings.values()], ships: [...this.ships.values()],
      regions: this.regions, nations: this.nations, ongoing: [...this.ongoing], messages: this.messages.slice(-50), nextId: this.nextId,
      history: this.history, finance: this.finance, stats: this.stats, unrest: this.unrest, graveyard: this.graveyard, effects: this.effects,
      bm: this.blackMarketMarkup, rng: this.rng.state, advisor: this.advisorState, captainPool: this.captainPool,
      map: { vh: enc(m.vh), height: enc(m.height), terrain: enc(m.terrain), trees: enc(m.trees), occupied: enc(m.occupied), path: enc(m.path), fertility: enc(m.fertility), ore: enc(m.ore) },
    });
  }

  static deserialize(json: string): Game {
    const d = JSON.parse(json);
    const g = new Game(d.settings, d.king);
    const dec = (s: string, arr: ArrayBufferView) => {
      const bin = atob(s);
      const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < u8.length; i++) u8[i] = bin.charCodeAt(i);
    };
    const m = g.map;
    dec(d.map.vh, m.vh); dec(d.map.height, m.height); dec(d.map.terrain, m.terrain); dec(d.map.trees, m.trees);
    dec(d.map.occupied, m.occupied); dec(d.map.path, m.path); dec(d.map.fertility, m.fertility); dec(d.map.ore, m.ore);
    g.time = d.time; g.month = d.month; g.treasury = d.treasury; g.hoard = d.hoard; g.hoardRate = d.hoardRate;
    g.people = new Map(d.people.map((p: Person) => [p.id, p]));
    g.buildings = new Map(d.buildings.map((b: Building) => [b.id, b]));
    g.ships = new Map(d.ships.map((s: Ship) => [s.id, s]));
    g.regions = d.regions; g.nations = d.nations; g.ongoing = new Set(d.ongoing); g.messages = d.messages; g.nextId = d.nextId;
    g.history = d.history; g.finance = d.finance; g.stats = { ...d.stats, exported: d.stats.exported ?? {} }; g.unrest = d.unrest; g.graveyard = d.graveyard; g.effects = d.effects;
    g.blackMarketMarkup = d.bm; g.rng.state = d.rng; g.advisorState = d.advisor; g.captainPool = d.captainPool;
    g.pf = new PathFinder(g.map);
    for (const b of g.buildings.values()) markBlocked(g, b);
    g.aura.dirty = true;
    return g;
  }
}

export function markBlocked(g: Game, b: Building): void {
  const def = BUILDING[b.def];
  const open = def.gather?.from === 'fertility' && !!def.gather.crop; // fields can be walked through
  if (open) return;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (g.map.inBounds(x, y)) g.pf.blocked[g.map.idx(x, y)] = def.water === 'dock' ? 0 : 1;
}

/** buy stores and arms for a ship in port, cheapest needs first, spending at most `budget` (default: everything) */
function buyBlackMarket(g: Game, shipId: number, budget = Infinity): CmdResult {
  const bm = g.findBuilding('black_market');
  if (!bm) return { ok: false, reason: 'You need a Black Market.' };
  const s = g.ships.get(shipId);
  if (!s || s.status === 'atsea') return { ok: false, reason: 'Ship must be in port.' };
  const def = (shipDefs as any)[s.type];
  let cost = 0;
  const trader = bm.workers.length;
  const disc = 1 - Math.min(0.3, trader * 0.08);
  const buy = (good: Good, need: number) => {
    const base = { cannon: 200, musket: 75, cutlass: 50, ration: 8 }[good as 'cannon']!;
    let n = 0;
    while (n < need) {
      const price = Math.round(base * (1 + (g.blackMarketMarkup[good] ?? 0)) * disc);
      if (g.treasury - cost < price || cost + price > budget) break;
      cost += price;
      g.blackMarketMarkup[good] = (g.blackMarketMarkup[good] ?? 0) + 0.05;
      n++;
    }
    return n;
  };
  s.rations += buy('ration', def.rations - s.rations);
  s.cutlasses += buy('cutlass', def.cutlasses - s.cutlasses);
  s.muskets += buy('musket', def.muskets - s.muskets);
  s.cannons += buy('cannon', def.cannons - s.cannons);
  if (!cost) return { ok: false, reason: 'Nothing bought.' };
  g.spend(cost, 'black market');
  return { ok: true };
}
import { SHIPS as shipDefs } from './data/ships';
