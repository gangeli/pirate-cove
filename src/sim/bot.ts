import type { Game } from './game';
import { MONTH } from './time';
import { BUILDING } from './data/buildings';
import { SHIPS, type ShipType } from './data/ships';
import { findSpot, buildRoadBetween, footprint, canPlace } from './placement';
import { Terrain } from './map';
import { NATIONS } from './data/kings';
import { regionReachable } from './sea';

/**
 * A scripted player used for automated playtesting and balance. It follows the strategy a competent
 * human would use: food and lumber first, then pirate entertainment, then ships, and fear when needed.
 */
export class Bot {
  log: string[] = [];
  skips: Record<string, number> = {};
  private skip(k: string): void {
    this.skips[k] = (this.skips[k] ?? 0) + 1;
  }
  private lastMonth = -1;
  private tick = 0;
  constructor(private g: Game, private opts: { verbose?: boolean } = {}) {}

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
    const reserve = g.yearsElapsed > 0.5 && cost.gold > 0 ? 400 : 0;
    if ((cost.gold > 0 && g.treasury - reserve < cost.gold) || g.lumber() < cost.lumber) return false;
    if (g.missingReqs(d).length) return false;
    const [cx, cy] = near ?? this.centre();
    for (let attempt = 0; attempt < 3; attempt++) {
      const pl = findSpot(g, d, cx, cy, 34, (p) => !pred || pred(p.x, p.y));
      if (pl) {
        const r = g.cmd({ type: 'build', def, x: pl.x, y: pl.y, rot: pl.rot });
        if (r.ok) {
          this.say(`built ${d.name}`);
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

  private fertile(crop: 'corn' | 'banana' | 'papaya' | 'sugarcane' | 'tobacco' = 'corn'): (x: number, y: number) => boolean {
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
    if (this.tick % 20 === 0) this.ships();
    const half = Math.floor(g.time / (MONTH / 2));
    if (half === this.lastMonth) return;
    this.lastMonth = half;
    this.economy();
  }

  private economy(): void {
    const g = this.g;
    const cap = g.captives().length, pir = g.pirates().length;
    const ashore = g.pirates().filter((p) => p.task.kind !== 'atsea').length;
    // pirates should pay for their fun
    const ashoreP = g.pirates().filter((p) => p.task.kind !== 'atsea');
    const wealth = ashoreP.length ? ashoreP.reduce((a, p) => a + p.gold, 0) / ashoreP.length : 0;
    const level = wealth > 120 ? 2 : wealth > 35 ? 1 : 0;
    for (const b of g.buildings.values()) if (BUILDING[b.def].service && b.price !== level) g.cmd({ type: 'setPrice', id: b.id, price: level });
    // hoard
    if (!this.count('cave') && g.treasury > 400) this.build('cave');
    if (this.count('cave', false) && g.hoardRate !== 0.15) g.cmd({ type: 'hoardRate', rate: 0.15 });
    // lumber
    const timber = this.count('timber_camp');
    if (g.lumber() < 30 && timber < 2 + Math.floor(g.yearsElapsed)) this.build('timber_camp', this.forest());
    if (this.count('sawmill') < Math.ceil(timber / 2)) this.build('sawmill', this.forest());
    // food
    if (this.count('chuck_tent') < Math.ceil(cap / 26)) this.build('chuck_tent');
    if (this.count('corn_farm') < Math.ceil(cap / 16) + Math.floor((this.count('brewery') + this.count('ration_factory')) / 2) && g.goodTotal('corn') < 60) this.build('corn_farm', undefined, this.fertile());
    if (this.count('bunkhouse') * 5 < cap * 0.6) this.build('bunkhouse');
    // housing
    const homeless = g.pirates().filter((p) => !p.home && !p.captain).length;
    const freePlots = [...g.buildings.values()].filter((b) => b.def === 'housing_plot' && !b.owner).length;
    if (homeless > freePlots) this.build('housing_plot', this.dockSide());
    // entertainment (near docks)
    if (this.count('dive') < Math.ceil(ashore / 16)) this.build('dive', this.dockSide());
    if (this.count('wench_hut') < Math.ceil(ashore / 5)) this.build('wench_hut', this.dockSide());
    if (this.count('animal_pit') < Math.ceil(ashore / 25)) this.build('animal_pit', this.dockSide());
    if (pir > 15 && this.count('tavern') < Math.ceil(pir / 25)) this.build('tavern', this.dockSide());
    if (pir > 18 && this.count('gambling_den') < Math.ceil(pir / 30)) this.build('gambling_den', this.dockSide());
    if (pir > 20 && this.count('eatery') < Math.ceil(pir / 30)) this.build('eatery', this.dockSide());
    if (pir > 25 && this.count('brothel') < 1) this.build('brothel', this.dockSide());
    if (pir > 30 && this.count('inn') < 1 && g.treasury > 900) this.build('inn', this.dockSide());
    if (pir > 30 && this.count('casino') < 1 && g.treasury > 900) this.build('casino', this.dockSide());
    if (this.count('brewery') < 1 && g.yearsElapsed > 0.2) this.build('brewery');
    // ships' supplies
    if (this.count('ration_factory') < 1 + Math.floor(g.ships.size / 3)) this.build('ration_factory');
    if (this.count('iron_mine') < 1 && g.yearsElapsed > 0.5) this.build('iron_mine', this.oreSpot());
    if (this.count('iron_mine') && this.count('blast_furnace') < 1) this.build('blast_furnace', this.oreSpot());
    if (this.count('blast_furnace') && this.count('blacksmithy') < 1) this.build('blacksmithy');
    if (this.count('blast_furnace') && this.count('gunsmithy') < 1) this.build('gunsmithy');
    if (this.count('blast_furnace') && this.count('cannon_foundry') < 1) this.build('cannon_foundry');
    // fleet
    if (!this.count('boatyard')) this.buildShore('boatyard');
    const docks = this.count('dock');
    const ships = g.ships.size;
    const queued = [...g.buildings.values()].filter((b) => b.building_ship).length;
    if (docks <= ships + queued && g.treasury > 300) this.buildDock();
    const yard = g.findBuilding('shipyard') ?? g.findBuilding('boatyard');
    const captainless = [...g.ships.values()].filter((x) => !x.captain).length;
    // no fleet at all: build whatever we can afford, even a humble snow
    if (yard && !yard.building_ship && ships === 0 && docks > queued) {
      const t: ShipType = g.treasury > 900 ? 'sloop' : g.treasury > 300 ? 'schooner' : 'snow';
      if (g.cmd({ type: 'commission', yard: yard.id, ship: t }).ok) this.say(`commissioned a ${SHIPS[t].name} to rebuild the fleet`);
    }
    if (yard && !yard.building_ship && docks > ships + queued && captainless === 0 && g.treasury > 1600) {
      const want: ShipType = yard.def === 'shipyard' && g.treasury > 2500 ? 'brigantine' : g.treasury > 900 ? 'sloop' : g.treasury > 300 ? 'schooner' : 'snow';
      if (g.cmd({ type: 'commission', yard: yard.id, ship: want }).ok) this.say(`commissioned a ${SHIPS[want].name}`);
    }
    if (g.yearsElapsed > 3 && !this.count('shipyard') && g.treasury > 1600) this.buildShore('shipyard');
    // captains
    const capless = [...g.ships.values()].some((s) => !s.captain && s.status !== 'atsea');
    if (capless && g.treasury > g.edictAvailability('recruit_captain').cost + 300 && g.edictAvailability('recruit_captain').ok) {
      g.cmd({ type: 'edict', id: 'recruit_captain' });
      this.say('recruited a captain');
    }
    // fear when captives run
    if (g.effects.recentEscapes > 0.8 || g.avgResignation() < 0.4) {
      if (!this.count('gallows')) this.build('gallows', this.workSide());
      else if (this.count('watch_tower') < 2 + g.yearsElapsed / 2) this.build('watch_tower', this.workSide());
      else if (this.count('very_scary_decor') < 6) this.build('very_scary_decor', this.workSide());
    }
    // church when captives want religion
    if (g.yearsElapsed > 2 && !this.count('church')) this.build('church');
    // defence if discovered and hated
    const threat = NATIONS.some((n) => g.nations[n].knows && g.nations[n].relation < -30);
    const invasion = NATIONS.some((n) => g.nations[n].invasion.stage >= 1);
    if ((threat || invasion) && !this.count('fort') && g.treasury > 1100) this.build('fort', this.dockSide());
    if (invasion) for (const n of NATIONS) if (g.nations[n].invasion.stage >= 1 && g.edictAvailability('peace', n).ok && !g.ongoing.has(`peace:${n}`)) g.cmd({ type: 'edict', id: 'peace', nation: n });
    if (threat && this.count('watch_tower') < 3) this.build('watch_tower', this.dockSide());
    if (g.treasury > 2500 && this.count('anarchy_decor') < 4) this.build('anarchy_decor', this.dockSide());
    // construction capacity
    const sites = [...g.buildings.values()].filter((b) => b.built < 1).length;
    if (sites > 4 * this.count('construction_tent')) this.build('construction_tent');
    // festival when the mood sours and we're rich
    if (g.avgHappiness() < 0.4 && g.treasury > 2500 && g.edictAvailability('festival').ok) g.cmd({ type: 'edict', id: 'festival' });
    // ransom wealthy captives with good ransoms
    for (const p of g.people.values()) if (p.kind === 'wealthy' && p.ransom > 450) g.cmd({ type: 'edict', id: 'ransom', target: p.id });
    // peace with the most dangerous power
    for (const n of NATIONS) if (g.nations[n].knows && g.nations[n].relation < -55 && g.edictAvailability('peace', n).ok && !g.ongoing.has(`peace:${n}`)) {
      g.cmd({ type: 'edict', id: 'peace', nation: n });
      this.say(`announced peace with ${n}`);
    }
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
    for (const s of sites.slice(0, 60)) {
      for (let rot = 0; rot < 4; rot++) {
        const [w, h] = footprint(d, rot);
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-2, -1], [-1, -2]]) {
          const p = canPlace(g, d, s.x - Math.floor(w / 2) + ox, s.y - Math.floor(h / 2) + oy, rot);
          if (p.ok && g.cmd({ type: 'build', def: 'dock', x: p.x, y: p.y, rot }).ok) {
            this.say('built Dock');
            return true;
          }
        }
      }
    }
    return false;
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
        if (g.rng.chance(0.01)) this.say(`${s.name} short of crew (${crewAshore}); pirates without ships: ${g.pirates().filter((p) => !p.ship).map((p) => `${p.mood}/${p.shoreJob ? 'job' : '-'}`).join(' ')}`);
        continue;
      }
      // let them party a little first
      const avgDrink = s.crew.reduce((a, id) => a + (g.people.get(id)?.needs.drink ?? 1), 0) / Math.max(1, s.crew.length);
      if (avgDrink < 0.35 && g.rng.chance(0.7)) {
        this.skip('partying');
        continue;
      }
      // choose mission
      const skilledWanted = !g.hasProfession('shipwright') ? 'shipwright' : !g.hasProfession('server') ? 'server' : !g.hasProfession('cook') ? 'cook' : !g.hasProfession('engineer') && g.yearsElapsed > 1 ? 'engineer' : null;
      if (skilledWanted && g.treasury > 600 && g.rng.chance(0.25)) {
        g.cmd({ type: 'shipOrders', ship: s.id, mission: 'kidnap', kidnapJob: skilledWanted as any });
      } else if (g.captives().length < 26 + g.yearsElapsed * 6 && g.rng.chance(0.3)) {
        g.cmd({ type: 'shipOrders', ship: s.id, mission: 'raid' });
      } else {
        // best reachable known region by merchant traffic minus navy
        let best = g.homeRegion, bs = -Infinity;
        for (const r of g.regions) {
          if (!regionReachable(g, s, r.id).ok) continue;
          const merch = NATIONS.reduce((a, n) => a + r.merchant[n], 0);
          const nav = NATIONS.reduce((a, n) => a + r.naval[n], 0) * (1 + r.heat * 0.3);
          const sc = merch - nav * (d.cannons < 12 ? 1.4 : 0.7) + (r.tradeRoute ? 0.3 : 0) + g.rng.range(0, 0.3);
          if (sc > bs) (bs = sc), (best = r.id);
        }
        const unexplored = g.regions.find((r) => r.knowledge === 0 && regionReachable(g, s, r.id).ok);
        if (unexplored && g.rng.chance(0.2)) g.cmd({ type: 'shipOrders', ship: s.id, mission: 'explore', region: unexplored.id });
        else g.cmd({ type: 'shipOrders', ship: s.id, mission: 'cruise', region: best, orders: s.cutlasses >= Math.min(4, d.cutlasses) || s.cannons < 2 ? 'board' : 'pound', spoils: g.avgHappiness() < 0.45 ? 'generous' : 'selfish' });
      }
      const r = g.cmd({ type: 'setSail', ship: s.id });
      if (r.ok) this.say(`${s.name} sails (${s.mission})`);
      else {
        this.skip(r.reason!.replace(/\(.*\)/, '').slice(0, 40));
        if (g.rng.chance(0.05)) this.say(`${s.name} can't sail: ${r.reason}`);
      }
    }
  }
}
