// Expected value of a cruise by ship type and destination.
//   npx tsx scripts/voyage_ev.ts [voyages per cell] [types comma list]
// Each voyage: fresh game, a fully stocked and crewed ship, forced to sail; value what comes home
// against what is lost. Values in gold: captive 50, recruit 70, dead pirate 70, lumber 4/unit.
import { Game, MONTH } from '../src/sim/game';
import { KINGS } from '../src/sim/data/kings';
import { createShip, createPerson, createCaptain } from '../src/sim/people';
import { SHIPS, type ShipType } from '../src/sim/data/ships';
import { regionDistance } from '../src/sim/sea';

const N = +(process.argv[2] ?? 20);
const TYPES = (process.argv[3] ?? 'snow,schooner,sloop,brigantine,frigate,galleon').split(',') as ShipType[];
const V = { skilled: 350, captive: 50, recruit: 70, pirate: 70, lumber: 4, captain: 600 };
// MISSION=raid|kidnap|explore values those coastal errands instead (a kidnapped craftsman counts V.skilled)
const MISSION = (process.env.MISSION ?? 'cruise') as 'cruise' | 'raid' | 'kidnap' | 'explore';
const kidd = KINGS.find((k) => k.id === 'kidd')!;

function voyage(seed: number, type: ShipType, dest: 'home' | 'near' | 'far') {
  const g = new Game({ seed }, kidd);
  for (const r of g.regions) r.knowledge = 3;
  const d = SHIPS[type];
  const dock = g.findBuilding('dock')!;
  // replace the starting ship
  for (const s of [...g.ships.values()]) g.ships.delete(s.id);
  dock.ship = 0;
  const s = createShip(g, type, dock);
  s.rations = d.rations;
  s.cutlasses = d.cutlasses;
  s.muskets = d.muskets;
  s.cannons = d.cannons;
  const cap = createCaptain(g, dock.door[0], dock.door[1]);
  s.captain = cap.id;
  cap.ship = s.id;
  for (const p of g.pirates()) if (p.ship && p.ship !== s.id) p.ship = 0;
  s.crew = [];
  for (let i = 0; i < d.men + d.officers; i++) {
    const p = createPerson(g, 'pirate', dock.door[0], dock.door[1]);
    p.ship = s.id;
    s.crew.push(p.id);
  }
  for (const id of [cap.id, ...s.crew]) g.people.get(id)!.task = { kind: 'atsea', phase: 1 };
  // destination
  const others = g.regions.filter((r) => r.id !== g.homeRegion).map((r) => ({ r, dist: regionDistance(g, g.homeRegion, r.id), rich: Object.values(r.merchant).reduce((a, b) => a + b, 0) + (r.tradeRoute ? 0.8 : 0) }));
  let region = g.homeRegion;
  if (dest === 'near') region = others.filter((o) => o.dist < 0.35).sort((a, b) => b.rich - a.rich)[0]?.r.id ?? g.homeRegion;
  if (dest === 'far') region = others.filter((o) => o.dist >= 0.45).sort((a, b) => b.rich - a.rich)[0]?.r.id ?? g.homeRegion;
  s.region = region;
  s.mission = MISSION;
  if (MISSION === 'kidnap') s.kidnapJob = 'doctor' as any;
  if (MISSION === 'explore') for (const r of g.regions) if (r.id === region) r.knowledge = 0;
  s.orders = 'board';
  s.spoils = 'selfish';
  const crew0 = s.crew.length;
  const pir0 = g.pirates().length;
  const r = g.cmd({ type: 'setSail', ship: s.id, force: true });
  if (!r.ok) return { err: r.reason };
  const t0 = g.time;
  let loot = { gold: 0, captives: 0, recruits: 0, skilled: 0 };
  let lost = false;
  let cause = '';
  while (g.time - t0 < MONTH * 10) {
    if (s.voyage) loot = { gold: s.voyage.loot.gold, captives: s.voyage.loot.captives + s.voyage.loot.wealthy, skilled: s.voyage.loot.skilled.length, recruits: s.voyage.loot.recruits };
    g.run(MONTH / 10);
    if (!g.ships.has(s.id)) {
      lost = true;
      const m = g.messages.filter((x) => /Mutiny|Ship Lost|Lost/.test(x.title)).pop();
      cause = (m?.title ?? '?') + ': ' + (s.log.at(-1)?.text ?? '').slice(0, 50);
      break;
    }
    if (s.status === 'docked') break;
  }
  const months = (g.time - t0) / MONTH;
  const logDead = s.log.reduce((a, e) => a + +(e.text.match(/Lost (\d+) men/)?.[1] ?? 0) + +(e.text.match(/lost (\d+) men/)?.[1] ?? 0), 0);
  const dead = lost ? crew0 + 1 : logDead;
  const shipCost = d.gold + d.lumber * V.lumber;
  const ev = loot.gold * (lost ? 0 : 1) + (lost ? 0 : loot.captives * V.captive + loot.skilled * V.skilled + loot.recruits * V.recruit) - (MISSION === 'kidnap' ? 250 : 0) - dead * V.pirate - (lost ? shipCost + V.captain : 0) - d.rations * 3;
  return { gold: lost ? 0 : loot.gold, captives: lost ? 0 : loot.captives, recruits: lost ? 0 : loot.recruits, dead, lost, months, ev, cause, log: s.log.map((e) => e.text), dist: regionDistance(g, g.homeRegion, region) };
}

for (const type of TYPES) {
  for (const dest of ['home', 'near', 'far'] as const) {
    const rs = [];
    for (let i = 0; i < N; i++) {
      const v = voyage(1000 + i * 13, type, dest);
      if (!('err' in v)) rs.push(v as any);
    }
    const m = (k: string) => rs.reduce((a, r) => a + (+r[k]), 0) / Math.max(1, rs.length);
    const lostRate = rs.filter((r) => r.lost).length / Math.max(1, rs.length);
    const cost = SHIPS[type].gold + SHIPS[type].lumber * V.lumber;
    if (process.env.CAUSES) {
      const c: Record<string, number> = {};
      for (const r of rs) if (r.lost) c[r.cause.replace(/(English|French|Spanish|rival) /g, '')] = (c[r.cause.replace(/(English|French|Spanish|rival) /g, '')] ?? 0) + 1;
      console.log('   causes', JSON.stringify(c));
      if (process.env.LOGS) for (const r of rs.slice(0, 3)) console.log('   log:', r.log.join(' / ').slice(0, 600));
      const all = rs.flatMap((r: any) => r.log as string[]);
      const naval = all.filter((t) => /Naval/.test(t));
      const kinds: Record<string, number> = {};
      for (const t of naval) {
        const k = /kept their distance/.test(t) ? 'ignored' : /slipped away|Fled from/.test(t) ? 'chase-escape' : /cut and ran/.test(t) ? 'fought-fled' : /Traded/.test(t) ? 'draw' : /Defeated/.test(t) ? 'lost' : /Took|Sank/.test(t) ? 'won' : 'other';
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
      console.log('   naval per voyage', (naval.length / rs.length).toFixed(2), JSON.stringify(kinds), 'encounters/voyage', (all.filter((t) => /Sighted|chase|Took|Sank|Traded|Fled|cut and ran|Defeated|struck/.test(t)).length / rs.length).toFixed(1));
    }
    console.log(`${type.padEnd(10)} ${dest.padEnd(4)} n${rs.length} dist ${m('dist').toFixed(2)} months ${m('months').toFixed(1)} gold ${Math.round(m('gold')).toString().padStart(5)} capt ${m('captives').toFixed(1)} recr ${m('recruits').toFixed(1)} dead ${m('dead').toFixed(1)} lost ${(lostRate * 100).toFixed(0).padStart(3)}% | EV ${Math.round(m('ev')).toString().padStart(6)} EV/mo ${Math.round(m('ev') / Math.max(0.1, m('months'))).toString().padStart(5)} | ship ${cost}`);
  }
}
