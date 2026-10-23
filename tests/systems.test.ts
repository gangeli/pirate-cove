import { describe, it, expect } from 'vitest';
import { Game, MONTH } from '../src/sim/game';
import { EDICTS } from '../src/sim/data/edicts';
import { NATIONS } from '../src/sim/data/kings';
import { KINGS } from '../src/sim/data/kings';
import { createPerson } from '../src/sim/people';
import { placeBuilding, findSpot } from '../src/sim/placement';
import { BUILDING } from '../src/sim/data/buildings';
import { relationLevel } from '../src/sim/diplomacy';

const KIDD = KINGS.find((k) => k.id === 'kidd')!;

function game(seed = 3): Game {
  return new Game({ seed }, KIDD);
}

/** state must stay finite and consistent however the player pokes it */
function invariants(g: Game): void {
  expect(Number.isFinite(g.treasury)).toBe(true);
  expect(Number.isFinite(g.hoard)).toBe(true);
  for (const p of g.people.values()) {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.happiness)).toBe(true);
    expect(Number.isFinite(p.resignation)).toBe(true);
    for (const v of Object.values(p.needs)) expect(Number.isFinite(v)).toBe(true);
    if (p.job) expect(g.buildings.has(p.job)).toBe(true);
  }
  for (const b of g.buildings.values()) {
    for (const v of Object.values(b.inv)) expect(v).toBeGreaterThanOrEqual(-1e-6);
    for (const w of b.workers) expect(g.people.has(w)).toBe(true);
  }
  for (const n of NATIONS) expect(Number.isFinite(g.nations[n].relation)).toBe(true);
}

function addBuilding(g: Game, def: string): number {
  g.cmd({ type: 'cheat', code: 'freebuild' });
  const d = BUILDING[def];
  const spot = findSpot(g, d, g.findBuilding('palace')!.x, g.findBuilding('palace')!.y, 40);
  expect(spot, `no spot for ${def}`).toBeTruthy();
  const b = placeBuilding(g, d, spot!, true);
  g.cmd({ type: 'cheat', code: 'freebuild' });
  return b.id;
}

describe('edicts', () => {
  it('every edict is either issuable or gives a reason', () => {
    const g = game();
    g.treasury = 99999;
    for (const e of EDICTS) {
      const av = g.edictAvailability(e.id, e.target === 'nation' ? 'eng' : undefined);
      expect(av.ok || !!av.reason, e.id).toBe(true);
    }
  });

  it('ongoing edicts can be issued, take effect and be repealed', () => {
    const g = game();
    g.treasury = 99999;
    for (const id of ['curfew', 'loose_lips', 'informants', 'executions', 'patrols', 'rig_against', 'prohibit_spa', 'walk_plank']) {
      const r = g.cmd({ type: 'edict', id });
      expect(r.ok, `${id}: ${r.reason}`).toBe(true);
      expect(g.ongoing.has(id)).toBe(true);
    }
    expect(g.cmd({ type: 'edict', id: 'rig_favour' }).ok).toBe(false); // exclusive with rig_against
    g.run(MONTH * 2);
    invariants(g);
    expect(g.cmd({ type: 'edict', id: 'curfew', repeal: true }).ok).toBe(true);
    expect(g.ongoing.has('curfew')).toBe(false);
  });

  it('curfew and patrols raise captive resignation', () => {
    // a restless island, where newcomers feel the island's auras after a month rather than a year
    const base = new Game({ seed: 5, stability: 5 }, KIDD);
    const strict = new Game({ seed: 5, stability: 5 }, KIDD);
    strict.treasury = 99999;
    for (const id of ['curfew', 'patrols', 'informants']) expect(strict.cmd({ type: 'edict', id }).ok).toBe(true);
    base.run(MONTH * 3);
    strict.run(MONTH * 3);
    expect(strict.avgResignation()).toBeGreaterThan(base.avgResignation());
  });

  it('free captive, press gang and ransom act on the target', () => {
    const g = game();
    const cap = g.captives().find((c) => !c.skilled && c.kind === 'captive')!;
    const rel = g.nations[cap.nat].relation;
    expect(g.cmd({ type: 'edict', id: 'free_captive', target: cap.id }).ok).toBe(true);
    expect(g.people.has(cap.id)).toBe(false);
    expect(g.nations[cap.nat].relation).toBeGreaterThan(rel);

    const pg = g.captives().find((c) => !c.skilled && c.kind === 'captive')!;
    expect(g.cmd({ type: 'edict', id: 'press_gang', target: pg.id }).ok).toBe(true);
    expect(g.people.get(pg.id)!.kind).toBe('pirate');

    const d = g.findBuilding('dock')!;
    const rich = createPerson(g, 'wealthy', d.door[0], d.door[1]);
    rich.ransom = 400;
    const t0 = g.treasury;
    expect(g.cmd({ type: 'edict', id: 'ransom', target: rich.id }).ok).toBe(true);
    expect(g.treasury).toBeGreaterThan(t0);
    expect(g.people.has(rich.id)).toBe(false);
    g.run(MONTH);
    invariants(g);
  });

  it('donate, assassinate and festival', () => {
    const g = game();
    g.treasury = 5000;
    const p = g.pirates().find((x) => !x.captain)!;
    const gold = p.gold;
    expect(g.cmd({ type: 'edict', id: 'donate', target: p.id }).ok).toBe(true);
    expect(p.gold).toBe(gold + 100);
    // assassination needs a palace guard on duty
    g.run(MONTH * 0.5);
    const victim = g.pirates().find((x) => !x.captain && x.id !== p.id)!;
    const r = g.cmd({ type: 'edict', id: 'assassinate', target: victim.id });
    if (r.ok) expect(g.stats.deaths).toBeGreaterThan(0);
    else expect(r.reason).toMatch(/guard/);
    expect(g.cmd({ type: 'edict', id: 'festival' }).ok).toBe(true);
    expect(g.effects.festivalUntil).toBeGreaterThan(g.time);
    g.run(MONTH);
    invariants(g);
  });

  it('betray and free-all change relations', () => {
    const g = game();
    const nat = g.pirates().find((x) => !x.captain)!.nat;
    const before = g.nations[nat].relation;
    const n0 = g.pirates().length;
    expect(g.cmd({ type: 'edict', id: 'betray', nation: nat }).ok).toBe(true);
    expect(g.pirates().length).toBeLessThan(n0);
    expect(g.nations[nat].relation).toBeGreaterThan(before);
    const cn = g.captives().find((c) => c.kind === 'captive')!.nat;
    const c0 = g.captives().length;
    expect(g.cmd({ type: 'edict', id: 'free_all', nation: cn }).ok).toBe(true);
    expect(g.captives().length).toBeLessThan(c0);
    g.run(MONTH);
    invariants(g);
  });

  it('raise dead needs a graveyard and a corpse', () => {
    const g = game();
    g.treasury = 5000;
    expect(g.cmd({ type: 'edict', id: 'raise_dead' }).ok).toBe(false);
    addBuilding(g, 'graveyard');
    g.graveyard.push({ name: 'Old Tom', nat: 'eng' });
    expect(g.cmd({ type: 'edict', id: 'raise_dead' }).ok).toBe(true);
    const sk = [...g.people.values()].find((p) => p.kind === 'skeleton');
    expect(sk).toBeTruthy();
    g.run(MONTH);
    invariants(g);
  });

  it('recruit captain only when a ship lacks one', () => {
    const g = game();
    g.treasury = 9999;
    const r = g.cmd({ type: 'edict', id: 'recruit_captain' });
    // the starting sloop already has a captain
    expect(r.ok).toBe(false);
  });
});

describe('diplomacy', () => {
  it('peace improves relations each month until patronage is possible', () => {
    const g = game(7);
    expect(g.cmd({ type: 'edict', id: 'peace', nation: 'fra' }).ok).toBe(true);
    expect(g.cmd({ type: 'edict', id: 'patron', nation: 'fra' }).ok).toBe(false);
    let months = 0;
    while (relationLevel(g.nations.fra.relation) !== 'Harmonious' && months < 60) {
      g.run(MONTH);
      months++;
    }
    expect(relationLevel(g.nations.fra.relation)).toBe('Harmonious');
    const r = g.cmd({ type: 'edict', id: 'patron', nation: 'fra' });
    expect(r.ok, r.reason).toBe(true);
    expect(g.ongoing.has('patron:fra')).toBe(true);
    invariants(g);
  });

  it('the Jolly Roger cancels peace and patronage and needs a fort', () => {
    const g = game(7);
    expect(g.cmd({ type: 'edict', id: 'jolly_roger' }).ok).toBe(false);
    addBuilding(g, 'fort');
    g.cmd({ type: 'edict', id: 'peace', nation: 'eng' });
    expect(g.cmd({ type: 'edict', id: 'jolly_roger' }).ok).toBe(true);
    expect(g.ongoing.has('peace:eng')).toBe(false);
    expect(g.cmd({ type: 'edict', id: 'peace', nation: 'eng' }).ok).toBe(false);
  });

  it('an invasion is fought out without breaking the simulation', () => {
    const g = game(9);
    g.cmd({ type: 'cheat', code: 'britinv' });
    let resolved = false;
    for (let m = 0; m < 6 && !g.over; m++) {
      g.run(MONTH);
      invariants(g);
      if (g.nations.eng.invasion.stage === 0) {
        resolved = true;
        break;
      }
    }
    expect(resolved || !!g.over).toBe(true);
  });
});

describe('unrest', () => {
  it('miserable captives try to escape and can rebel', () => {
    const g = game(11);
    g.cmd({ type: 'cheat', code: 'captives' });
    g.cmd({ type: 'cheat', code: 'captives' });
    for (const c of g.captives()) {
      c.resignation = 0.05;
      c.escapeCooldown = 0;
      c.traits.courage = 9;
    }
    // keep them miserable while the clock runs
    for (let i = 0; i < 40; i++) {
      for (const c of g.captives()) c.resignation = Math.min(c.resignation, 0.1);
      g.run(MONTH / 10);
    }
    expect(g.stats.escapes + g.stats.escapeKills + (g.unrest.rebellion ? 1 : 0) + g.messages.filter((m) => m.title === 'Escape!').length).toBeGreaterThan(0);
    invariants(g);
  });

  it('pirates kept miserable for months overthrow the king', () => {
    const g = game(12);
    for (let i = 0; i < 80 && !g.over; i++) {
      for (const p of g.pirates()) {
        for (const k in p.needs) p.needs[k] = 0;
        for (const k in p.opinion) p.opinion[k] = 0;
        p.happiness = 0;
      }
      g.run(MONTH / 10);
    }
    expect(g.over).toBeTruthy();
    expect(g.over!.win).toBe(false);
  });
});

describe('save / load', () => {
  it('round-trips a game in progress', () => {
    const g = game(13);
    g.treasury = 9999;
    g.cmd({ type: 'edict', id: 'curfew' });
    g.cmd({ type: 'edict', id: 'peace', nation: 'spa' });
    g.run(MONTH * 2);
    const s = g.serialize();
    const h = Game.deserialize(s);
    expect(h.people.size).toBe(g.people.size);
    expect(h.buildings.size).toBe(g.buildings.size);
    expect(h.treasury).toBeCloseTo(g.treasury);
    expect([...h.ongoing].sort()).toEqual([...g.ongoing].sort());
    // both continue identically (determinism)
    g.run(MONTH);
    h.run(MONTH);
    expect(h.treasury).toBeCloseTo(g.treasury, 3);
    expect(h.people.size).toBe(g.people.size);
  });
});

describe('missions', () => {
  function sail(seed: number, orders: Record<string, unknown>) {
    const g = game(seed);
    g.treasury = 9999;
    const s = [...g.ships.values()][0];
    s.rations = 60;
    const r0 = g.cmd({ type: 'shipOrders', ship: s.id, ...(orders as any) });
    expect(r0.ok, r0.reason).toBe(true);
    const r = g.cmd({ type: 'setSail', ship: s.id });
    expect(r.ok, r.reason).toBe(true);
    g.run(MONTH * 0.2); // ring the bell, crew walks aboard
    expect(s.status).not.toBe('boarding');
    let months = 0;
    while (months < 8 && s.status !== 'docked' && g.ships.has(s.id)) {
      g.run(MONTH / 2);
      months += 0.5;
    }
    invariants(g);
    return { g, s, months };
  }

  it('a raid brings home captives', () => {
    const { g, s } = sail(21, { mission: 'raid' });
    const caps = g.captives().length;
    expect(s.log.some((e) => /Raided/.test(e.text))).toBe(true);
    expect(caps).toBeGreaterThan(20);
  });

  it('kidnapping fetches the chosen craftsman', () => {
    const { g, s } = sail(22, { mission: 'kidnap', kidnapJob: 'distiller' });
    expect(s.log.some((e) => /Snatched/.test(e.text))).toBe(true);
    expect(g.captives().some((c) => c.skilled && c.profession === 'distiller')).toBe(true);
  });

  it('exploring charts a region', () => {
    const g0 = game(23);
    const target = g0.regions.find((r) => r.id !== g0.homeRegion && r.neighbors.includes(g0.homeRegion))!;
    const { g } = sail(23, { mission: 'explore', region: target.id });
    expect(g.regions[target.id].knowledge).toBeGreaterThanOrEqual(2);
  });

  it('an explorer comes home with charts, in her own words', () => {
    const g0 = game(23);
    const target = g0.regions.find((r) => r.id !== g0.homeRegion && r.neighbors.includes(g0.homeRegion))!;
    const { g, s } = sail(23, { mission: 'explore', region: target.id });
    const m = [...g.messages].reverse().find((x) => x.title === `${s.name} Returns`)!;
    expect(m).toBeTruthy();
    expect(m.text).toContain('fresh charts');
    expect(m.text).not.toContain('sunburn');
    if (m.data?.kind !== 'voyage') throw new Error('no voyage data');
    expect(m.data.charted?.sea).toBe(target.name);
    // plunder taken on the way still counts for more
    if (!m.data.gold && !m.data.captives) expect(m.voice).toBe(m.data.charted!.found.length ? 'ship_returns_found' : 'ship_returns_explore');
  });

  it('a cruise returns with plunder or a story', () => {
    const g0 = game(24);
    const target = g0.regions.find((r) => r.id === g0.homeRegion)!;
    const { g, s } = sail(24, { mission: 'cruise', region: target.id, orders: 'board' });
    expect(s.log.length).toBeGreaterThan(0);
    expect(g.stats.plundered + g.stats.captured + s.log.length).toBeGreaterThan(0);
  });
});
