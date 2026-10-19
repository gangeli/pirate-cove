import type { Game } from './game';
import { MONTH } from './time';
import { BUILDING, JOB_SEX, SKILLED_ONLY, type Job } from './data/buildings';
import { SHIPS, CAPTAIN_COST, type ShipType } from './data/ships';
import type { Person, Ship } from './types';
import { pirateFactors } from './people';
import { findSpot, buildRoadBetween, footprint, canPlace } from './placement';
import { Terrain } from './map';
import { NATIONS, type Nation } from './data/kings';
import { regionReachable, regionDistance, judgement } from './sea';

/** Strategy knobs. The defaults are a competent human's play; scripts/tune.ts searches over them. */
export interface Policy {
  /** months between economic decisions (a human checking in less often reacts later) */
  cadence: number;
  hoardRate: number;
  /** added to the wealth-based price level (-2..2); prices are clamped to the three levels */
  priceBias: number;
  /** venue counts are multiplied by this */
  entertainment: number;
  /** chance a ready ship raids for captives instead of cruising, when labour is short */
  raid: number;
  /** treasury needed before commissioning another ship */
  shipAt: number;
  /** gold kept back once the essentials are built */
  reserve: number;
  /** build gallows / towers / scary decor when captives get restless */
  fear: boolean;
  /** pirate happiness below which a festival is thrown (if affordable) */
  festivalAt: number;
  /** relation below which peace is announced with a power that knows where we are */
  peaceAt: number;
  /** pursue patronage once at peace and harmonious */
  patron: boolean;
  /** spoils policy: 'auto' adapts to the mood */
  spoils: 'auto' | 'miserly' | 'selfish' | 'generous' | 'bigspender';
  /** how strongly captains avoid distant, patrolled waters (0 bold .. 2 timid) */
  caution: number;
  /** treasury needed before commissioning a frigate or galleon at the shipyard */
  bigShipAt: number;
  /** extra timber camps beyond the minimum (lumber is the early bottleneck) */
  lumber: number;
  /** fraction of decisions skipped at random (sloppiness) */
  sloppy: number;
  /** plan around the labour actually available and the needs actually unmet (else build by rote) */
  plan: boolean;
  /** run a smuggler's cove and export industries */
  trade: boolean;
  /** send small ships to kidnap the craftsmen the island lacks (else only the odd random snatch) */
  kidnap: boolean;
  /** treasury above which a planner skims the maximum into the hoard */
  flushAt: number;
  /** degenerate strategies probed for reward hacking */
  exploit?: 'idle' | 'pressgang' | 'gouge' | 'nofun' | 'nofleet' | 'raidonly' | 'enddump' | 'festspam';
}

export const DEFAULT_POLICY: Policy = {
  cadence: 0.5, hoardRate: 0.15, priceBias: 0, entertainment: 1, raid: 0.3, shipAt: 1600, reserve: 400, fear: true,
  festivalAt: 0.4, peaceAt: -55, patron: false, spoils: 'auto', sloppy: 0, lumber: 0, caution: 0.5, bigShipAt: 3500,
  plan: true, trade: true, kidnap: true, flushAt: 4000,
};

/** The skill ladder used for balance: each rung is a recognisable kind of player. */
export const LADDER: Record<string, Partial<Policy>> = {
  // checks in rarely, builds by rote, never trades, never plans a kidnapping
  novice: { cadence: 3, sloppy: 0.4, fear: false, priceBias: -1, entertainment: 0.5, shipAt: 4000, festivalAt: 0, peaceAt: -101, plan: false, trade: false, kidnap: false },
  // plays sensibly but casually: no export economy and no labour planning
  casual: { cadence: 1.5, sloppy: 0.2, entertainment: 0.8, plan: false, trade: false },
  default: {},
};

/** venues that serve each need, cheapest / lowest rank first */
const VENUES: Record<'feast' | 'drink' | 'company' | 'gamble', string[]> = {
  feast: ['dive', 'eatery', 'inn'],
  drink: ['dive', 'tavern', 'gambling_den', 'casino', 'inn'],
  company: ['wench_hut', 'brothel', 'courtesan'],
  gamble: ['animal_pit', 'gambling_den', 'casino'],
};

/** investments that pay for themselves: a planner spends the reserve on them */
const INVEST = new Set(['smugglers_cove', 'cave', 'brewery']);

/** buildings never held back to save timber for a hull */
const ESSENTIAL = new Set(['timber_camp', 'sawmill', 'chuck_tent', 'corn_farm', 'bunkhouse', 'dock', 'boatyard', 'cave', 'housing_plot', 'construction_tent']);

/** craftsmen worth kidnapping, in the order a good player wants them */
const KIDNAP_ORDER: Job[] = ['trader', 'server', 'cook', 'engineer', 'farmer', 'distiller', 'wench', 'tobacconist', 'gunsmith', 'surgeon'];

/**
 * A scripted player used for automated playtesting and balance. It follows the strategy a competent
 * human would use: food and lumber first, labour for every building it raises, entertainment matched to
 * the needs the pirates actually feel, craftsmen kidnapped to order, an export trade through a smuggler's
 * cove, and bigger ships as the treasury allows.
 */
export class Bot {
  log: string[] = [];
  skips: Record<string, number> = {};
  private skip(k: string): void {
    this.skips[k] = (this.skips[k] ?? 0) + 1;
  }
  private lastMonth = -1;
  private tick = 0;
  readonly p: Policy;
  constructor(private g: Game, private opts: { verbose?: boolean; policy?: Partial<Policy> } = {}) {
    this.p = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) };
  }

  private say(s: string): void {
    this.log.push(`${this.g.date}: ${s}`);
    if (this.opts.verbose) console.log(`  [bot] ${this.g.date}: ${s}`);
  }

  private count(def: string, includeSites = true): number {
    return this.g.buildingCount(def, !includeSites);
  }

  private centre(): [number, number] {
    const p = this.g.findBuilding('palace')!;
    return [p.door[0], p.door[1]];
  }

  /** try to build a def near (cx,cy); extends roads when no spot is found */
  build(def: string, near?: [number, number], pred?: (x: number, y: number) => boolean): boolean {
    const g = this.g;
    const d = BUILDING[def];
    const cost = g.costOf(d);
    // keep a reserve for captains and emergencies once the essentials are up
    let reserve = g.yearsElapsed > 0.5 && cost.gold > 0 && !(this.p.plan && INVEST.has(def)) ? this.p.reserve : 0;
    // a planner never leaves a new hull idle for want of a captain's fee
    if (this.p.plan && cost.gold > 0) reserve = Math.max(reserve, this.captainFee());
    if ((cost.gold > 0 && g.treasury - reserve < cost.gold) || g.lumber() < cost.lumber) return false;
    if (g.missingReqs(d).length) return false;
    if (!ESSENTIAL.has(def) && !(this.p.plan && INVEST.has(def)) && g.lumber() - cost.lumber < this.lumberHold()) {
      this.skip('lumber hold');
      return false;
    }
    const [cx, cy] = near ?? this.centre();
    for (let attempt = 0; attempt < 3; attempt++) {
      const pl = findSpot(g, d, cx, cy, 34, (p) => !pred || pred(p.x, p.y));
      if (pl) {
        const r = g.cmd({ type: 'build', def, x: pl.x, y: pl.y, rot: pl.rot });
        if (r.ok) {
          this.say(`built ${d.name}`);
          this.labourCache = null;
          return true;
        }
      }
      this.extendRoads(cx, cy);
    }
    return false;
  }

  /** lay a road spur from the nearest road tile toward (tx,ty) */
  extendRoads(tx: number, ty: number): void {
    const g = this.g, m = g.map, n = m.size;
    let best = -1, bd = Infinity;
    for (let i = 0; i < n * n; i++) {
      if (!m.path[i]) continue;
      const d = Math.hypot((i % n) - tx, Math.floor(i / n) - ty);
      if (d < bd) (bd = d), (best = i);
    }
    if (best < 0) return;
    const sx = best % n, sy = Math.floor(best / n);
    // pick a direction with open land
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const r = g.rng;
    for (let k = 0; k < 6; k++) {
      const [dx, dy] = r.pick(dirs);
      const len = r.int(8, 16);
      const ex = sx + dx * len, ey = sy + dy * len;
      if (!m.inBounds(ex, ey) || !m.isWalkable(ex, ey) || m.occupied[m.idx(ex, ey)]) continue;
      if (m.terrain[m.idx(ex, ey)] === Terrain.Beach && r.chance(0.6)) continue;
      const before = m.path.reduce((a, b) => a + b, 0);
      buildRoadBetween(g, sx, sy, ex, ey);
      const after = m.path.reduce((a, b) => a + b, 0);
      if (after > before) {
        g.events.push({ type: 'roads' });
        return;
      }
    }
  }

  /** best forest spot near the existing road network */
  private forest(): [number, number] {
    const g = this.g, m = g.map, n = m.size;
    const [cx, cy] = this.centre();
    let best: [number, number] = [cx, cy], bs = -Infinity;
    for (let y = 4; y < n - 4; y += 3)
      for (let x = 4; x < n - 4; x += 3) {
        let t = 0;
        for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) t += m.trees[m.idx(x + i, y + j)];
        const near = [...g.buildings.values()].some((b) => b.def === 'timber_camp' && Math.hypot(b.x - x, b.y - y) < 12);
        const s = t - Math.hypot(x - cx, y - cy) * 1.2 - (near ? 60 : 0);
        if (s > bs) (bs = s), (best = [x, y]);
      }
    return best;
  }

  private fertile(): (x: number, y: number) => boolean {
    return (x, y) => {
      const m = this.g.map;
      let f = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) f += m.fertility[m.idx(x + i, y + j)];
      return f / 6 > 0.3;
    };
  }

  step(): void {
    const g = this.g;
    this.tick++;
    // decisions twice a month; ships every few seconds
    if (this.p.exploit === 'idle') return;
    if (this.tick % 20 === 0 && this.p.exploit !== 'nofleet') this.ships();
    const slot = Math.floor(g.time / (MONTH * this.p.cadence));
    if (slot === this.lastMonth) return;
    this.lastMonth = slot;
    if (this.p.sloppy && g.rng.chance(this.p.sloppy)) return;
    this.labourCache = null;
    this.economy();
    if (this.p.exploit === 'pressgang') {
      for (const c of g.captives()) if (c.kind === 'captive' && !c.skilled) g.cmd({ type: 'edict', id: 'press_gang', target: c.id });
    }
    if (this.p.exploit === 'enddump') this.endDump();
    // the final year: every coin into festivals, to buy the happiness average
    if (this.p.exploit === 'festspam' && g.yearsElapsed > g.settings.years - 1 && g.edictAvailability('festival').ok) g.cmd({ type: 'edict', id: 'festival' });
  }

  // ------------------------------------------------------------------------------------------- labour

  private labourCache: { free: number; freeF: number } | null = null;
  /**
   * Unskilled captives who could take up a new job (and how many are women): the unemployed, plus those
   * idling at a construction tent with nothing to build or at a producer whose store is full, whom the
   * employment pass will move to a new building anyway.
   */
  private labour(): { free: number; freeF: number } {
    if (this.labourCache) return this.labourCache;
    const g = this.g;
    const sites = [...g.buildings.values()].some((b) => b.built < 1);
    const soft = new Set<number>();
    for (const b of g.buildings.values()) {
      if (b.built < 1) continue;
      const d = BUILDING[b.def];
      const out = d.recipe?.out ?? d.gather?.out;
      const full = !!out && !d.captiveService && (b.inv[out] ?? 0) >= (d.storage ?? 30) * 0.95;
      if ((b.def === 'construction_tent' && !sites) || full) soft.add(b.id);
    }
    let free = 0, freeF = 0;
    for (const p of g.people.values()) {
      if (p.kind !== 'captive' || p.rebel || p.skilled || p.task.kind === 'dead' || p.task.kind === 'escape') continue;
      if (p.job && !soft.has(p.job)) continue;
      free++;
      if (p.sex === 'F') freeF++;
    }
    return (this.labourCache = { free, freeF });
  }

  /** can the island staff (most of) a new building of this kind right now? */
  private canStaff(def: string, frac = 0.75): boolean {
    if (!this.p.plan) return true;
    const d = BUILDING[def];
    let need = d.haulers ?? 0, needF = 0;
    for (const s of d.workers) {
      if (SKILLED_ONLY.includes(s.job)) {
        if (!this.g.hasProfession(s.job)) return false;
        continue;
      }
      need += s.count;
      if (JOB_SEX[s.job] === 'F') needF += s.count;
    }
    const { free, freeF } = this.labour();
    return free >= Math.ceil(need * frac) && freeF >= Math.ceil(needF * frac);
  }

  /** a building of this kind already stands idle for want of hands: don't raise another */
  private idleOne(def: string): boolean {
    for (const b of this.g.buildings.values()) if (b.def === def && b.built >= 1 && !b.workers.length && BUILDING[def].workers.length) return true;
    return false;
  }

  /** labour-aware build: only when it can be staffed, and none of its kind stands empty */
  private staffed(def: string, near?: [number, number], pred?: (x: number, y: number) => boolean): boolean {
    if (this.p.plan && (this.idleOne(def) || !this.canStaff(def))) {
      this.skip(`staff:${def}`);
      return false;
    }
    return this.build(def, near, pred);
  }

  /** the island wants more hands than it has */
  private labourShort(): boolean {
    const { free } = this.labour();
    return free < 4;
  }

  // ------------------------------------------------------------------------------------------- economy

  private economy(): void {
    const g = this.g;
    const cap = g.captives().length, pir = g.pirates().length;
    const ashoreP = g.pirates().filter((p) => p.task.kind !== 'atsea');
    const ashore = ashoreP.length;
    // pirates should pay for their fun, but not more than they have
    const wealth = ashore ? ashoreP.reduce((a, p) => a + p.gold, 0) / ashore : 0;
    const level = this.p.exploit === 'gouge' ? 2 : Math.max(0, Math.min(2, (wealth > 120 ? 2 : wealth > 35 ? 1 : 0) + this.p.priceBias));
    for (const b of g.buildings.values()) if (BUILDING[b.def].service && b.price !== level) g.cmd({ type: 'setPrice', id: b.id, price: level });
    // hoard
    if (!this.count('cave') && g.treasury > 400) this.build('cave');
    // a planner skims harder once the treasury is flush: gold left in it at the end is worth nothing
    const rate = this.p.plan && g.treasury > this.p.flushAt ? Math.max(this.p.hoardRate, 0.25) : this.p.hoardRate;
    if (this.count('cave', false) && g.hoardRate !== rate) g.cmd({ type: 'hoardRate', rate });
    // a good player sees to the fleet first: plunder pays for everything else
    if (this.p.plan) this.fleet();
    // lumber
    const timber = this.count('timber_camp');
    // a planner on a thin forest needs more camps for the same timber
    const scarce = this.p.plan && g.lumber() < 30 ? 2 + Math.round((0.5 - g.settings.vegetation) * 6) : 0;
    if ((g.lumber() < 30 || timber < this.p.lumber) && timber < 2 + Math.floor(g.yearsElapsed) + this.p.lumber + Math.max(0, scarce)) {
      if (!this.p.plan || this.canStaff('timber_camp', 0.6) || g.lumber() < 15) this.build('timber_camp', this.forest());
    }
    // one sawmill keeps up with several camps; a planner doesn't staff idle saws
    if (this.count('sawmill') < (this.p.plan ? 1 + Math.floor(timber / 5) : Math.ceil(timber / 2))) this.build('sawmill', this.forest());
    // food
    const kitchens = this.count('brewery') + this.count('ration_factory');
    if (this.count('chuck_tent') < Math.ceil(cap / 26)) this.build('chuck_tent');
    // a captive eats about a corn and a half a month; a farm grows enough for twenty or so
    const hungry = g.captives().filter((c) => c.kind === 'captive' && c.needs.food < 0.2).length;
    const farms = Math.ceil(cap / 13) + Math.floor(kitchens / 2) + (this.p.plan && hungry > cap * 0.1 ? 1 : 0);
    if (this.count('corn_farm') < farms && g.goodTotal('corn') < 60) this.build('corn_farm', undefined, this.fertile());
    if (this.count('bunkhouse') * 5 < cap * 0.6) this.build('bunkhouse');
    // housing
    const homeless = g.pirates().filter((p) => !p.home && !p.captain).length - (this.p.plan && g.lumber() < 20 ? 3 : 0);
    const freePlots = [...g.buildings.values()].filter((b) => b.def === 'housing_plot' && !b.owner).length;
    if (homeless > freePlots) this.build('housing_plot', this.dockSide());
    // entertainment
    if (this.p.plan) this.entertainmentByNeed(ashoreP);
    else this.entertainmentByRote(ashore, pir);
    if (this.count('brewery') < 1 && g.yearsElapsed > 0.2) this.staffed('brewery');
    // ships' supplies
    if (this.count('ration_factory') < 1 + Math.floor(g.ships.size / 3)) {
      // no sea stores means no voyages at all: the first ration factory is built whoever it takes
      if (this.p.plan && !this.count('ration_factory')) this.build('ration_factory');
      else this.staffed('ration_factory');
    }
    if (this.p.plan) {
      // when the fleet is short of stores the kitchens get first pick of the cooks
      const short = g.goodTotal('ration') < 20 && g.ships.size > 0;
      for (const b of g.buildings.values()) if (b.def === 'ration_factory' && b.priority !== (short ? 5 : 4)) g.cmd({ type: 'setPriority', id: b.id, priority: short ? 5 : 4 });
    }
    // the forge arms the fleet: once there is a shipyard (whose hulls come without guns) a planner builds
    // the iron chain whoever it takes, and gives it first pick of the hands
    const forge = this.p.plan && (this.count('shipyard', false) > 0 || g.yearsElapsed > 2);
    const arm = (def: string, near?: [number, number]) => (forge ? this.build(def, near) : this.staffed(def, near));
    if (this.count('iron_mine') < 1 && g.yearsElapsed > 0.5) arm('iron_mine', this.oreSpot());
    if (this.count('iron_mine') && this.count('blast_furnace') < 1) arm('blast_furnace', this.oreSpot());
    if (this.count('blast_furnace') && this.count('blacksmithy') < 1) arm('blacksmithy');
    if (forge) for (const b of g.buildings.values()) if ((b.def === 'iron_mine' || b.def === 'blast_furnace' || b.def === 'blacksmithy' || b.def === 'cannon_foundry') && b.priority !== 4) g.cmd({ type: 'setPriority', id: b.id, priority: 4 });
    if (this.count('blast_furnace') && this.count('gunsmithy') < 1) this.staffed('gunsmithy');
    if (this.count('blast_furnace') && this.count('cannon_foundry') < 1) this.staffed('cannon_foundry');
    // the export trade
    if (this.p.trade) this.trade();
    if (!this.p.plan) this.fleet();
    // captains
    const capless = [...g.ships.values()].some((s) => !s.captain && s.status !== 'atsea');
    const noneSail = ![...g.ships.values()].some((s) => s.captain);
    if (capless && g.treasury > g.edictAvailability('recruit_captain').cost + (noneSail ? 0 : this.p.plan ? 100 : 300) && g.edictAvailability('recruit_captain').ok) {
      g.cmd({ type: 'edict', id: 'recruit_captain' });
      this.say('recruited a captain');
    }
    // fear when captives run
    if (this.p.fear && (g.effects.recentEscapes > 0.8 || g.avgResignation() < 0.4)) {
      if (!this.count('gallows')) this.build('gallows', this.workSide());
      else if (this.count('watch_tower') < 2 + g.yearsElapsed / 2) this.build('watch_tower', this.workSide());
      else if (this.count('very_scary_decor') < 6) this.build('very_scary_decor', this.workSide());
    }
    // church when captives want religion
    if (g.yearsElapsed > 2 && !this.count('church')) this.staffed('church');
    // defence if discovered and hated
    const threat = NATIONS.some((n) => g.nations[n].knows && g.nations[n].relation < -30);
    const invasion = NATIONS.some((n) => g.nations[n].invasion.stage >= 1);
    if ((threat || invasion) && !this.count('fort') && g.treasury > 1100) this.build('fort', this.dockSide());
    if (invasion) for (const n of NATIONS) if (g.nations[n].invasion.stage >= 1 && g.edictAvailability('peace', n).ok && !g.ongoing.has(`peace:${n}`)) g.cmd({ type: 'edict', id: 'peace', nation: n });
    if (threat && this.count('watch_tower') < 3) this.build('watch_tower', this.dockSide());
    if (g.treasury > 2500 && this.count('anarchy_decor') < 4) this.build('anarchy_decor', this.dockSide());
    if (this.p.plan) this.comforts(ashoreP);
    // construction capacity
    const sites = [...g.buildings.values()].filter((b) => b.built < 1).length;
    if (sites > 4 * this.count('construction_tent')) this.build('construction_tent');
    // festival when the mood sours and we're rich
    if (g.avgHappiness() < this.p.festivalAt && g.treasury > 2500 && g.edictAvailability('festival').ok) g.cmd({ type: 'edict', id: 'festival' });
    // ransom wealthy captives with good ransoms
    for (const p of g.people.values()) if (p.kind === 'wealthy' && (p.ransom > 450 || (this.p.plan && g.treasury < 500))) g.cmd({ type: 'edict', id: 'ransom', target: p.id });
    if (this.p.plan) this.ransomSurplus();
    // peace with the most dangerous power. A planner acts before they are hostile, but always leaves one
    // power to prey on (peace with everyone leaves the captains nothing to take) unless it threatens war
    const peaceAt = this.p.plan ? Math.max(this.p.peaceAt, -25) : this.p.peaceAt;
    const prey = this.p.plan ? this.preyNation() : null;
    for (const n of NATIONS) if (g.nations[n].knows && g.nations[n].relation < peaceAt && g.edictAvailability('peace', n).ok && !g.ongoing.has(`peace:${n}`)) {
      if (n === prey && g.nations[n].relation > -60) continue;
      g.cmd({ type: 'edict', id: 'peace', nation: n });
      this.say(`announced peace with ${n}`);
    }
    if (this.p.patron) {
      for (const n of NATIONS) if (g.ongoing.has(`peace:${n}`) && g.edictAvailability('patron', n).ok) {
        g.cmd({ type: 'edict', id: 'patron', nation: n });
        this.say(`became a colony of ${n}`);
        break;
      }
    }
  }

  /**
   * Pirates sleep easier under guns and feel freer under the black flag: a planner reads the mood
   * breakdown and plants cheap decor (lumber only) where the pirates live.
   */
  private comforts(ashoreP: Person[]): void {
    const g = this.g;
    if (ashoreP.length < 8 || g.lumber() < 40) return;
    let def = 0, ana = 0;
    for (const p of ashoreP) {
      const f = pirateFactors(g, p);
      def += f.defense / ashoreP.length;
      ana += f.anarchy / ashoreP.length;
    }
    const homes = this.homeSide();
    if (def < 0.6) {
      if (!this.count('observatory')) this.build('observatory', homes);
      else if (this.count('protective_cannon') < 4 + ashoreP.length / 6) this.build('protective_cannon', homes);
    }
    if (ana < 0.6 && this.count('anarchy_decor') < 4 + ashoreP.length / 8) this.build('anarchy_decor', homes);
  }

  /** the power whose shipping is richest in the waters we know: the one a planner keeps hunting */
  private preyNation(): Nation {
    const g = this.g;
    const t: Record<Nation, number> = { eng: 0, fra: 0, spa: 0 };
    for (const r of g.regions) if (r.knowledge > 0) for (const n of NATIONS) t[n] += r.merchant[n];
    const partner = NATIONS.find((n) => g.ongoing.has(`open_cove:${n}`));
    return [...NATIONS].filter((n) => n !== partner).sort((a, b) => t[b] - t[a])[0];
  }

  /** the middle of the pirates' housing */
  private homeSide(): [number, number] {
    let x = 0, y = 0, n = 0;
    for (const b of this.g.buildings.values()) if (b.def === 'housing_plot') (x += b.x), (y += b.y), n++;
    return n ? [Math.round(x / n), Math.round(y / n)] : this.dockSide();
  }

  /** the old fixed ratios: a venue per so many pirates, whether or not anyone can staff it */
  private entertainmentByRote(ashore: number, pir: number): void {
    const E = this.p.exploit === 'nofun' ? 0 : this.p.entertainment;
    const want = (n: number) => Math.ceil(n * E);
    if (this.count('dive') < want(ashore / 16)) this.build('dive', this.dockSide());
    if (this.count('wench_hut') < want(ashore / 5)) this.build('wench_hut', this.dockSide());
    if (this.count('animal_pit') < want(ashore / 25)) this.build('animal_pit', this.dockSide());
    if (pir > 15 && this.count('tavern') < want(pir / 25)) this.build('tavern', this.dockSide());
    if (pir > 18 && this.count('gambling_den') < want(pir / 30)) this.build('gambling_den', this.dockSide());
    if (pir > 20 && this.count('eatery') < want(pir / 30)) this.build('eatery', this.dockSide());
    if (pir > 25 && this.count('brothel') < want(1)) this.build('brothel', this.dockSide());
    if (pir > 30 && this.count('inn') < want(1) && this.g.treasury > 900) this.build('inn', this.dockSide());
    if (pir > 30 && this.count('casino') < want(1) && this.g.treasury > 900) this.build('casino', this.dockSide());
  }

  /**
   * Find the need the pirates ashore feel most and add a venue for it that they can afford, that suits
   * their rank, and that the island can staff. Seats are budgeted per pirate so the bot does not raise
   * venues nobody visits.
   */
  private entertainmentByNeed(ashoreP: Person[]): void {
    const g = this.g;
    if (this.p.exploit === 'nofun' || !ashoreP.length) return;
    const E = this.p.entertainment;
    const needs = (['feast', 'drink', 'company', 'gamble'] as const).map((n) => [n, ashoreP.reduce((a, p) => a + p.needs[n], 0) / ashoreP.length] as const).sort((a, b) => a[1] - b[1]);
    const rank = ashoreP.reduce((a, p) => a + p.rank, 0) / ashoreP.length;
    // seats already serving each need (capacity-weighted)
    const seats: Record<string, number> = { feast: 0, drink: 0, company: 0, gamble: 0 };
    for (const b of g.buildings.values()) {
      const sv = BUILDING[b.def].service;
      if (!sv) continue;
      for (const n in sv.needs) if (n in seats) seats[n] += sv.capacity * (b.built >= 1 && !b.workers.length ? 0.2 : 1);
    }
    for (const [need, lvl] of needs) {
      // company is served one at a time, so it needs more venues per seat
      const perSeat = need === 'company' ? 3.5 : 5;
      if (lvl > 0.62 && seats[need] * perSeat >= ashoreP.length * 0.6 * E) continue;
      if (seats[need] * perSeat >= ashoreP.length * 1.6 * E) continue;
      for (const def of VENUES[need]) {
        const d = BUILDING[def];
        const [lo, hi] = d.service!.ranks;
        if (rank < lo - 1.5 || rank > hi + 2) continue;
        if (g.missingReqs(d).length) continue;
        const cost = g.costOf(d);
        if (cost.gold > 0 && g.treasury < cost.gold + 600) continue;
        if (this.idleOne(def) || !this.canStaff(def)) continue;
        if (this.build(def, this.dockSide())) return;
      }
    }
  }

  /**
   * Skilled captives the island has no post for are worth more to their families: a planner sells back
   * the spares (keeping one of each trade, and everyone a building needs), more readily when money is short.
   */
  private ransomSurplus(): void {
    const g = this.g;
    const posts: Partial<Record<string, number>> = {};
    for (const b of g.buildings.values()) for (const sl of BUILDING[b.def].workers) posts[sl.job] = (posts[sl.job] ?? 0) + sl.count;
    const byJob = new Map<string, Person[]>();
    for (const p of g.people.values()) if (p.kind === 'captive' && p.skilled && p.task.kind !== 'dead' && !p.rebel) {
      const l = byJob.get(p.profession) ?? [];
      l.push(p);
      byJob.set(p.profession, l);
    }
    const poor = g.treasury < 800;
    for (const [job, list] of byJob) {
      // skilled-only trades fill their posts; common trades (cooks, farmers...) can be done by anyone
      const keep = Math.max(1, SKILLED_ONLY.includes(job as Job) ? posts[job] ?? 0 : poor ? 1 : 2);
      if (list.length <= keep) continue;
      list.sort((a, b) => a.ransom - b.ransom);
      for (const p of list.slice(keep)) if (p.ransom > (poor ? 100 : 250)) g.cmd({ type: 'edict', id: 'ransom', target: p.id });
    }
  }

  // ------------------------------------------------------------------------------------------- trade

  /** cheapest-to-annoy power: the one we're friendliest with, preferring one that already knows us */
  private tradePartner(): Nation {
    const g = this.g;
    return [...NATIONS].sort((a, b) => (g.nations[b].relation + (g.nations[b].knows ? 15 : 0) + (g.ongoing.has(`peace:${b}`) ? 30 : 0))
      - (g.nations[a].relation + (g.nations[a].knows ? 15 : 0) + (g.ongoing.has(`peace:${a}`) ? 30 : 0)))[0];
  }

  private trade(): void {
    const g = this.g;
    if (!g.hasProfession('trader') && !this.count('smugglers_cove')) return;
    if (!this.count('smugglers_cove')) {
      this.build('smugglers_cove', this.dockSide());
      return;
    }
    const cove = g.findBuilding('smugglers_cove');
    if (!cove) return;
    const open = NATIONS.filter((n) => g.ongoing.has(`open_cove:${n}`));
    if (!open.length) {
      const n = this.tradePartner();
      // keep the buyer sweet: a peace promise first, so knowing where we are is no threat
      if (!g.ongoing.has(`peace:${n}`) && g.edictAvailability('peace', n).ok) g.cmd({ type: 'edict', id: 'peace', nation: n });
      if (g.cmd({ type: 'edict', id: 'open_cove', nation: n }).ok) this.say(`opened the smuggler's cove to ${n}`);
    }
    // goods for export: beer from surplus corn, rum and cigars once the craftsmen are here, arms from the forge
    if (this.count('brewery') < 2 && g.yearsElapsed > 0.5) this.staffed('brewery');
    if (g.hasProfession('farmer')) {
      if (g.hasProfession('distiller') && this.count('sugar_farm') < 2 * Math.max(1, this.count('distillery'))) this.staffed('sugar_farm', undefined, this.fertile());
      if (g.hasProfession('tobacconist') && this.count('tobacco_farm') < 2 * Math.max(1, this.count('cigar_factory'))) this.staffed('tobacco_farm', undefined, this.fertile());
    }
    if (this.count('sugar_farm', false) && this.count('distillery') < 1) this.staffed('distillery');
    if (this.count('tobacco_farm', false) && this.count('cigar_factory') < 1) this.staffed('cigar_factory');
    // the forge is the richest trade: a second mine once the foundry runs
    if (this.count('cannon_foundry', false) && this.count('iron_mine') < 2) this.staffed('iron_mine', this.oreSpot());
    if (this.count('iron_mine') >= 2 && this.count('blast_furnace') < 2) this.staffed('blast_furnace', this.oreSpot());
  }

  // ------------------------------------------------------------------------------------------- fleet

  private fleet(): void {
    const g = this.g;
    if (!this.count('boatyard')) this.buildShore('boatyard');
    const docks = this.count('dock');
    const ships = g.ships.size;
    const queued = [...g.buildings.values()].filter((b) => b.building_ship).length;
    if (docks <= ships + queued && g.treasury > 300) this.buildDock();
    const shipyard = g.findBuilding('shipyard');
    const boatyard = g.findBuilding('boatyard');
    const captainless = [...g.ships.values()].filter((x) => !x.captain).length;
    const crewPool = g.pirates().filter((p) => !p.ship && !p.captain).length;
    // no fleet at all: build whatever we can afford, even a humble snow
    const yard = boatyard ?? shipyard;
    if (yard && !yard.building_ship && ships === 0 && docks > queued) {
      const afford = (t: ShipType) => g.treasury > SHIPS[t].gold + this.feeFor(t) + 100 && g.lumber() >= SHIPS[t].lumber;
      const t: ShipType = afford('sloop') ? 'sloop' : afford('schooner') ? 'schooner' : 'snow';
      if (g.cmd({ type: 'commission', yard: yard.id, ship: t }).ok) this.say(`commissioned a ${SHIPS[t].name} to rebuild the fleet`);
    }
    // more ships only when there are hands to crew them and gold for a captain
    const roomForCrew = !this.p.plan || crewPool >= 6;
    // a good player's first priority: a real warship to bring in plunder, the snow being an errand boy
    const warships = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons > 8).length;
    if (this.p.plan && boatyard && !boatyard.building_ship && !warships && !queued && docks > ships && g.treasury > SHIPS.sloop.gold + this.feeFor('sloop') + 250 && g.lumber() >= SHIPS.sloop.lumber) {
      if (g.cmd({ type: 'commission', yard: boatyard.id, ship: 'sloop' }).ok) this.say('commissioned a Sloop');
    }
    // a warship shouldn't run errands: keep a cheap snow for raids and kidnappings
    const smalls = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons <= 8).length;
    if (this.p.plan && boatyard && !boatyard.building_ship && warships && !smalls && !queued && docks > ships && captainless === 0 && g.treasury > this.feeFor('snow') + 400 && g.lumber() >= SHIPS.snow.lumber + 10) {
      if (g.cmd({ type: 'commission', yard: boatyard.id, ship: 'snow' }).ok) this.say('commissioned a Snow for errands');
    }
    if (docks > ships + queued && captainless === 0 && g.treasury > this.p.shipAt && roomForCrew) {
      if (shipyard && !shipyard.building_ship && g.treasury > 500 + this.feeFor('brigantine')) {
        const big: ShipType = g.lumber() >= 150 && crewPool >= 15 ? 'galleon' : 'frigate';
        const want: ShipType = g.treasury > this.p.bigShipAt + this.feeFor(big) ? big : 'brigantine';
        if (SHIPS[want].lumber <= g.lumber() && g.cmd({ type: 'commission', yard: shipyard.id, ship: want }).ok) this.say(`commissioned a ${SHIPS[want].name}`);
      } else if (boatyard && !boatyard.building_ship && (!shipyard || ships < 2)) {
        const want: ShipType = g.treasury > 900 ? 'sloop' : g.treasury > 300 ? 'schooner' : 'snow';
        if (g.cmd({ type: 'commission', yard: boatyard.id, ship: want }).ok) this.say(`commissioned a ${SHIPS[want].name}`);
      }
    }
    if (g.yearsElapsed > (this.p.plan ? 1.5 : 3) && !this.count('shipyard') && g.treasury > this.p.shipAt) this.buildShore('shipyard');
    if (!this.p.plan) return;
    // the yard with a hull on the slip gets the shipwrights
    for (const y of [shipyard, boatyard]) if (y) {
      const pr = y.building_ship ? 5 : 2;
      if (y.priority !== pr) g.cmd({ type: 'setPriority', id: y.id, priority: pr });
    }
    // sea stores for the whole fleet
    const stores = [...g.ships.values()].reduce((a, x) => a + SHIPS[x.type].rations, 0);
    if (this.count('ration_factory') < 1 + Math.floor(stores / 35)) this.staffed('ration_factory');
    // a black market arms warships the foundry can't, at a price
    const unarmed = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons > 8 && x.captain && (x.status === 'docked' || x.status === 'boarding') && x.cannons < SHIPS[x.type].cannons * 0.4);
    if ((unarmed.length || (this.hasWarship() && g.treasury > 2500)) && !this.count('black_market') && g.treasury > 600) this.build('black_market', this.dockSide());
    // a warship with no guns sits in port earning nothing: buy her enough to sail, within a budget
    if (g.findBuilding('black_market')) for (const x of unarmed) {
      const budget = Math.min(g.treasury - this.p.reserve, 400 + SHIPS[x.type].tons * 6);
      if (budget > 200 && g.cmd({ type: 'buyBlackMarket', ship: x.id, budget }).ok) this.say(`armed the ${x.name} at the black market`);
    }
  }

  /** the last months: treasury is worth nothing at the final reckoning, so dump it into hulls and captains */
  private endDump(): void {
    const g = this.g;
    if (g.yearsElapsed < g.settings.years - 0.5) return;
    if (g.treasury > 1500) this.buildDock();
    const yard = g.findBuilding('shipyard') ?? g.findBuilding('boatyard');
    if (yard && !yard.building_ship) g.cmd({ type: 'commission', yard: yard.id, ship: yard.def === 'shipyard' ? 'galleon' : 'sloop' });
    if (g.edictAvailability('recruit_captain').ok) g.cmd({ type: 'edict', id: 'recruit_captain' });
  }

  private dockSide(): [number, number] {
    const d = this.g.findBuilding('dock');
    const [cx, cy] = this.centre();
    if (!d) return [cx, cy];
    return [Math.round((d.door[0] * 2 + cx) / 3), Math.round((d.door[1] * 2 + cy) / 3)];
  }
  private workSide(): [number, number] {
    const st = this.g.findBuilding('stockade');
    return st ? [st.door[0], st.door[1]] : this.centre();
  }
  private oreSpot(): [number, number] {
    const g = this.g, m = g.map, n = m.size;
    const [cx, cy] = this.centre();
    let best: [number, number] = [cx, cy], bs = -Infinity;
    for (let i = 0; i < n * n; i++) {
      if (m.ore[i] < 0.4) continue;
      const s = -Math.hypot((i % n) - cx, Math.floor(i / n) - cy);
      if (s > bs) (bs = s), (best = [i % n, Math.floor(i / n)]);
    }
    return best;
  }

  private buildShore(def: string): boolean {
    const g = this.g;
    const d = BUILDING[def];
    const cost = g.costOf(d);
    if (g.treasury < cost.gold || g.lumber() < cost.lumber || g.missingReqs(d).length) return false;
    const [cx, cy] = this.dockSide();
    for (let k = 0; k < 2; k++) {
      const pl = findSpot(g, d, cx, cy, 45);
      if (pl && g.cmd({ type: 'build', def, x: pl.x, y: pl.y, rot: pl.rot }).ok) {
        this.say(`built ${d.name}`);
        return true;
      }
      this.extendRoads(cx, cy);
    }
    return false;
  }

  private buildDock(): boolean {
    const g = this.g;
    const d = BUILDING.dock;
    if (g.lumber() < d.lumber) return false;
    const [cx, cy] = this.centre();
    const sites = [...g.map.dockSites].sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const tryAt = (s: { x: number; y: number; dir: number }) => {
      const sv = [[0, -1], [1, 0], [0, 1], [-1, 0]][s.dir];
      for (let r = 0; r < 4; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            for (let rot = 0; rot < 4; rot++) {
              const [w, h] = footprint(d, rot);
              const p = canPlace(g, d, s.x + dx - Math.floor(w / 2) + sv[0] * 2, s.y + dy - Math.floor(h / 2) + sv[1] * 2, rot);
              if (p.ok && g.cmd({ type: 'build', def: 'dock', x: p.x, y: p.y, rot }).ok) {
                this.say('built Dock');
                return true;
              }
            }
          }
      return false;
    };
    for (const s of sites.slice(0, 40)) if (tryAt(s)) return true;
    // no berth within reach of a road: run a road down to the nearest open beach and try there
    for (const s of sites.slice(0, 40)) {
      if (g.map.occupied[g.map.idx(s.x, s.y)]) continue;
      const beach = g.pf.nearestWalkable(s.x, s.y, 5);
      if (!beach) continue;
      buildRoadBetween(g, cx, cy, beach[0], beach[1]);
      g.events.push({ type: 'roads' });
      return tryAt(s);
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------- ships

  /** the craftsman the island most needs, if any (and nobody is already out fetching one) */
  private kidnapTarget(): Job | null {
    const g = this.g;
    const enRoute = new Set([...g.ships.values()].filter((s) => s.status !== 'docked' && s.mission === 'kidnap').map((s) => s.kidnapJob));
    const want = (j: Job) => !g.hasProfession(j) && !enRoute.has(j);
    if (!this.p.kidnap) {
      for (const j of ['shipwright', 'server', 'cook', 'engineer'] as Job[]) if (want(j) && (j !== 'engineer' || g.yearsElapsed > 1)) return j;
      return null;
    }
    const pir = g.pirates().length;
    // each craftsman is fetched when the island is ready to put them to work
    const useful: Partial<Record<Job, boolean>> = {
      shipwright: true,
      server: pir > 14,
      cook: pir > 18,
      trader: this.p.trade,
      engineer: g.yearsElapsed > 1 || this.count('iron_mine') > 0,
      farmer: this.p.trade && g.hasProfession('trader'),
      distiller: this.p.trade && g.hasProfession('farmer'),
      wench: pir > 25,
      tobacconist: this.p.trade && g.hasProfession('distiller'),
      gunsmith: g.hasProfession('engineer') && g.yearsElapsed > 2,
      surgeon: g.yearsElapsed > 3,
    };
    // first, hands for skilled-only posts that stand empty in buildings we already have (a shipyard
    // with no shipwright builds nothing)
    const have: Partial<Record<Job, number>> = {};
    for (const p of g.people.values()) if (p.kind === 'captive' && p.skilled && p.task.kind !== 'dead') have[p.profession as Job] = (have[p.profession as Job] ?? 0) + 1;
    for (const j of enRoute) if (j) have[j] = (have[j] ?? 0) + 1;
    const posts: Partial<Record<Job, number>> = {};
    for (const b of g.buildings.values()) for (const sl of BUILDING[b.def].workers) if (SKILLED_ONLY.includes(sl.job)) posts[sl.job] = (posts[sl.job] ?? 0) + (b.def === 'shipyard' ? 1 : Math.min(sl.count, 1));
    for (const j of ['shipwright', 'engineer', 'distiller', 'tobacconist', 'gunsmith'] as Job[]) if ((posts[j] ?? 0) > (have[j] ?? 0)) return j;
    const order: Job[] = ['shipwright', ...KIDNAP_ORDER];
    for (const j of order) if (useful[j] && want(j)) return j;
    return null;
  }

  private ships(): void {
    const g = this.g;
    for (const s of g.ships.values()) {
      if (s.status !== 'docked' || !s.captain) {
        if (s.status === 'docked' && !s.captain) this.skip('no captain');
        if (s.status === 'repairing') this.skip('repairing');
        continue;
      }
      const d = SHIPS[s.type];
      if (s.hull < 0.7) {
        this.skip('hull');
        continue;
      }
      const crewAshore = s.crew.filter((id) => g.people.get(id)?.task.kind !== 'dead').length;
      if (crewAshore < Math.ceil(d.men / 2)) {
        this.skip('crew');
        continue;
      }
      // let them party a little first
      const avgDrink = s.crew.reduce((a, id) => a + (g.people.get(id)?.needs.drink ?? 1), 0) / Math.max(1, s.crew.length);
      if (avgDrink < 0.35 && g.rng.chance(0.7)) {
        this.skip('partying');
        continue;
      }
      const mission = this.p.plan ? this.planMission(s) : this.roteMission(s);
      if (mission === 'stay') {
        this.skip('stay');
        continue;
      }
      if (mission === 'kidnap') g.cmd({ type: 'shipOrders', ship: s.id, mission: 'kidnap', kidnapJob: this.kidnapTarget()! });
      else if (mission === 'raid') g.cmd({ type: 'shipOrders', ship: s.id, mission: 'raid' });
      else if (mission === 'explore') g.cmd({ type: 'shipOrders', ship: s.id, mission: 'explore', region: g.regions.find((r) => r.knowledge === 0 && regionReachable(g, s, r.id).ok)!.id });
      else {
        const best = this.cruiseRegion(s);
        g.cmd({ type: 'shipOrders', ship: s.id, mission: 'cruise', region: best, orders: s.cutlasses >= Math.min(4, d.cutlasses) || s.cannons < 2 ? 'board' : 'pound', spoils: this.p.spoils === 'auto' ? this.autoSpoils() : this.p.spoils });
      }
      const r = g.cmd({ type: 'setSail', ship: s.id });
      if (r.ok) this.say(`${s.name} sails (${s.mission})`);
      else this.skip(r.reason!.replace(/\(.*\)/, '').slice(0, 40));
    }
  }

  /** the crew's share comes back through the venues anyway; keep more only when the treasury is in trouble */
  private autoSpoils(): 'selfish' | 'generous' {
    const g = this.g;
    if (!this.p.plan) return g.avgHappiness() < 0.5 ? 'generous' : 'selfish';
    return g.treasury < 300 && g.avgHappiness() > 0.5 ? 'selfish' : 'generous';
  }

  /** a casual player's choice: the odd kidnapping, raids when captives run low, otherwise cruise */
  private roteMission(s: Ship): 'kidnap' | 'raid' | 'explore' | 'cruise' {
    const g = this.g;
    if (this.p.exploit === 'raidonly') return 'raid';
    if (this.kidnapTarget() && g.treasury > 600 && g.rng.chance(0.25)) return 'kidnap';
    if (g.captives().length < 26 + g.yearsElapsed * 6 && g.rng.chance(this.p.raid)) return 'raid';
    if (g.regions.some((r) => r.knowledge === 0 && regionReachable(g, s, r.id).ok) && g.rng.chance(0.2)) return 'explore';
    return 'cruise';
  }

  /**
   * A good player's choice. Small hulls are the island's errand boys: they raid for hands while labour is
   * short, fetch the craftsmen the island lacks, and chart the seas; they cruise only when idle. Real
   * warships cruise, unless one is the island's only ship and the colony is starved of hands.
   */
  private planMission(s: Ship): 'kidnap' | 'raid' | 'explore' | 'cruise' | 'stay' {
    const g = this.g;
    if (this.p.exploit === 'raidonly') return 'raid';
    const small = SHIPS[s.type].cannons <= 8;
    const errandBoys = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons <= 8 && x.captain).length;
    const { free } = this.labour();
    const capTarget = 30 + g.yearsElapsed * 10;
    const caps = g.captives().length;
    const raidingNow = [...g.ships.values()].filter((x) => x !== s && x.status !== 'docked' && x.mission === 'raid').length;
    // raiding a power that knows where we are and already hates us invites an invasion
    const safe = NATIONS.some((n) => !g.ongoing.has(`peace:${n}`) && (!g.nations[n].knows || g.nations[n].relation > -35));
    const raiding = safe ? raidingNow : 1;
    const target = this.kidnapTarget();
    // the trader comes first when money is short: a smuggler's cove is the cheapest income there is.
    // Other kidnappings cost 250 that the next warship and her captain may need more.
    const bootstrap = target === 'trader' || target === 'shipwright';
    const canKidnap = !!target && g.treasury > 250 + (bootstrap ? 100 : this.savingFor() + (this.hasWarship() ? 0 : 600));
    if (!small) {
      // a warship's place is at sea. She runs errands only when there is no small hull to run them and
      // the island is desperate: no hands at all, or no trader to open a cove
      if (!errandBoys && free < 2 && caps < capTarget && !raiding) return 'raid';
      if (!errandBoys && canKidnap && bootstrap) return 'kidnap';
      if (free < 2 && g.treasury > this.p.flushAt && caps < capTarget && !raiding) return 'raid';
      if (s.cannons < 2 && s.cutlasses < 2) return 'stay';
      return g.regions.some((r) => r.knowledge === 0 && regionReachable(g, s, r.id).ok) && g.rng.chance(0.08) ? 'explore' : 'cruise';
    }
    // small hulls are the island's errand boys: hands while labour is short, craftsmen to order, charts
    if (free < 5 && caps < capTarget && !raiding) return 'raid';
    if (canKidnap) return 'kidnap';
    if (free < 8 && caps < capTarget && !raiding) return 'raid';
    const unexplored = g.regions.some((r) => r.knowledge === 0 && regionReachable(g, s, r.id).ok);
    // she is the island's lifeline until there's a warship, and never risks herself on a cruise till then
    // (nobody sane cruises without guns or blades either)
    const precious = !this.hasWarship() || (s.cannons < 2 && s.cutlasses < 2);
    if (unexplored && (precious || g.rng.chance(0.6))) return 'explore';
    // ...unless the treasury is running dry and she is the only hope of plunder
    const armed = s.cannons >= 2 || s.cutlasses >= 2;
    if (precious && armed && g.treasury < 400 && !this.hasWarship()) return 'cruise';
    if (precious) return caps < capTarget * 1.5 && !raiding ? 'raid' : 'stay';
    return 'cruise';
  }

  /** a captain's fee for a ship of this class, with the king's own discounts */
  private feeFor(t: ShipType): number {
    const kingMod = this.g.edictAvailability('recruit_captain').cost / this.baseFee();
    return Math.round(CAPTAIN_COST[t] * kingMod);
  }
  private baseFee(): number {
    const waiting = [...this.g.ships.values()].filter((s) => !s.captain && s.status !== 'atsea');
    return waiting.length ? Math.max(...waiting.map((s) => CAPTAIN_COST[s.type])) : 1200;
  }

  /** what the captain for the grandest captainless ship will cost (0 if none waits) */
  private captainFee(): number {
    const waiting = [...this.g.ships.values()].some((s) => !s.captain && s.status !== 'atsea');
    return waiting ? this.g.edictAvailability('recruit_captain').cost : 0;
  }

  private hasWarship(): boolean {
    return [...this.g.ships.values()].some((x) => SHIPS[x.type].cannons > 8);
  }

  /** timber held back for the first real warship */
  private lumberHold(): number {
    const g = this.g;
    if (!this.p.plan) return 0;
    const warships = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons > 8).length;
    const queued = [...g.buildings.values()].some((b) => b.building_ship);
    return !warships && !queued ? SHIPS.sloop.lumber : 0;
  }

  /** gold the bot is holding back for the next warship and her captain */
  private savingFor(): number {
    const g = this.g;
    const warships = [...g.ships.values()].filter((x) => SHIPS[x.type].cannons > 8).length;
    if (warships === 0 && (g.findBuilding('boatyard') || g.findBuilding('shipyard'))) return SHIPS.sloop.gold + g.edictAvailability('recruit_captain').cost;
    return this.p.reserve;
  }

  /** best reachable known region by merchant traffic minus navy; seasoned captains on big ships go further */
  private cruiseRegion(s: Ship): number {
    const g = this.g;
    const d = SHIPS[s.type];
    const j = judgement(g.people.get(s.captain));
    let best = g.homeRegion, bs = -Infinity;
    for (const r of g.regions) {
      if (!regionReachable(g, s, r.id).ok) continue;
      const far = Math.min(1, regionDistance(g, g.homeRegion, r.id) / 0.55);
      const merch = NATIONS.reduce((a, n) => a + (g.ongoing.has(`peace:${n}`) ? 0.2 : 1) * r.merchant[n], 0);
      const nav = NATIONS.reduce((a, n) => a + r.naval[n], 0) * (0.35 + 0.9 * far) * (1 + r.heat * 0.3);
      const big = d.cannons >= 12;
      const sc = merch * (0.5 + far * (big ? 2.2 : 0.6)) - nav * (big ? 0.6 : 1.6) + (r.tradeRoute && r.routeFound ? 0.4 : 0) - this.p.caution * far * (1.3 - j) + g.rng.range(0, 0.3);
      if (sc > bs) (bs = sc), (best = r.id);
    }
    return best;
  }
}

