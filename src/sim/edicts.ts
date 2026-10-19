import type { Game, CmdResult } from './game';
import { MONTH } from './time';
import { EDICT } from './data/edicts';
import { NATIONS, NATION_NAMES, NATION_ADJ, type Nation } from './data/kings';
import { createPerson, createCaptain, killPerson, releaseAll } from './people';
import { assignCrews, patronOf } from './sea';
import { relationLevel } from './diplomacy';
import { BUILDING, type Job } from './data/buildings';
import { CAPTAIN_COST } from './data/ships';

export interface Availability {
  ok: boolean;
  reason?: string;
  cost: number;
  active: boolean;
}

/** priced for the grandest ship waiting for a captain (she is the one the new hire takes) */
function recruitCost(g: Game): number {
  const waiting = [...g.ships.values()].filter((s) => !s.captain && s.status !== 'atsea' && s.status !== 'lost');
  let c = waiting.length ? Math.max(...waiting.map((s) => CAPTAIN_COST[s.type])) : EDICT.recruit_captain.cost;
  if (g.has('always_pirate')) c *= 1.5;
  if (g.has('once_captain')) c *= 0.5;
  if (g.has('once_mutineer')) c *= 1.25;
  return Math.round(c);
}
function raiseCost(g: Game): number {
  return (g.has('voodoo') ? 50 : 100) + 20 * g.effects.skeletonsRaised;
}

export function edictCost(g: Game, id: string): number {
  const e = EDICT[id];
  if (!e) return 0;
  if (id === 'recruit_captain') return recruitCost(g);
  if (id === 'raise_dead') return raiseCost(g);
  if ((id === 'festival' || id === 'free_beer' || id === 'free_rum') && g.has('alcoholic')) return Math.round(e.cost * 1.3);
  return e.cost;
}

export function edictAvailability(g: Game, id: string, nation?: Nation): Availability {
  const e = EDICT[id];
  const cost = edictCost(g, id);
  const key = nation ? `${id}:${nation}` : id;
  const active = g.ongoing.has(key);
  const res = (ok: boolean, reason?: string): Availability => ({ ok, reason, cost, active });
  if (!e) return res(false, 'Unknown edict');
  if (active) return res(true);
  if (g.treasury < cost) return res(false, `Costs ${cost} gold.`);
  if (e.needs && !g.findBuilding(e.needs)) return res(false, `Requires a ${BUILDING[e.needs].name}.`);
  switch (id) {
    case 'free_beer':
      if (g.goodTotal('beer') < 10) return res(false, 'Needs at least 10 beer in stock.');
      break;
    case 'free_rum':
      if (g.goodTotal('rum') < 10) return res(false, 'Needs at least 10 rum in stock.');
      break;
    case 'rig_against':
      if (g.ongoing.has('rig_favour')) return res(false, 'Gambling is already rigged in their favour.');
      break;
    case 'rig_favour':
      if (g.ongoing.has('rig_against')) return res(false, 'Gambling is already rigged against them.');
      break;
    case 'recruit_captain': {
      const shipless = [...g.ships.values()].filter((s) => !s.captain && s.status !== 'atsea').length;
      const idleCaps = g.pirates().filter((p) => p.captain && !p.ship).length;
      if (shipless <= idleCaps) return res(false, 'Every ship already has a captain.');
      break;
    }
    case 'educate': {
      const schools = [...g.buildings.values()].some((b) => BUILDING[b.def].school && b.built >= 1);
      if (!schools) return res(false, 'Requires a school.');
      break;
    }
    case 'outfit':
      if (!['pegleg', 'hat', 'parrot'].some((x) => g.goodTotal(x as any) > 0)) return res(false, 'No peg legs, hats or parrots in stock.');
      break;
    case 'raise_dead':
      if (!g.graveyard.length) return res(false, 'The graveyard is empty.');
      break;
    case 'peace':
      if (!nation) break;
      if (g.king.flaw === `tortured_${nation}`) return res(false, `${NATION_NAMES[nation]} will never trust you.`);
      if (g.ongoing.has('jolly_roger')) return res(false, 'Repeal the Jolly Roger first.');
      if (g.time - g.nations[nation].peaceBroken < MONTH * 12 && g.nations[nation].peaceBroken) return res(false, 'They will not believe another promise so soon.');
      break;
    case 'patron':
      if (!nation) break;
      if (patronOf(g)) return res(false, 'You already have a patron.');
      if (!g.ongoing.has(`peace:${nation}`)) return res(false, 'Announce peace with them first.');
      if (relationLevel(g.nations[nation].relation) !== 'Harmonious') return res(false, 'Relations must be Harmonious.');
      break;
    case 'marque': {
      const pat = patronOf(g);
      if (!pat) return res(false, 'You need a patron.');
      if (!nation || !g.nations[pat].atWarWith.includes(nation)) return res(false, 'Your patron must be at war with them.');
      break;
    }
    case 'jolly_roger':
      break;
    case 'betray':
      if (!nation || !g.pirates().some((p) => p.nat === nation && !p.captain)) return res(false, 'No pirates of that nation.');
      break;
    case 'free_all':
      if (!nation || !g.captives().some((p) => p.nat === nation && p.kind === 'captive')) return res(false, 'No captives of that nation.');
      break;
  }
  return res(true);
}

export function issueEdict(g: Game, id: string, target?: number, nation?: Nation, arg?: string, repeal?: boolean): CmdResult {
  const e = EDICT[id];
  if (!e) return { ok: false, reason: 'Unknown edict' };
  const key = nation ? `${id}:${nation}` : id;
  if (repeal) {
    if (!g.ongoing.has(key)) return { ok: false, reason: 'Not in force.' };
    g.ongoing.delete(key);
    // withdrawing a peace promise is as good as a declaration of war: they will not trust another soon
    if (id === 'peace' && nation) {
      g.nations[nation].relation = Math.max(-100, g.nations[nation].relation - 15);
      g.nations[nation].peaceBroken = g.time;
    }
    g.aura.dirty = true;
    g.msg('info', 'Edict Repealed', `${e.name}${nation ? ` (${NATION_NAMES[nation]})` : ''} has been repealed.`);
    return { ok: true };
  }
  if (e.ongoing && g.ongoing.has(key)) return { ok: false, reason: 'Already in force.' };
  const av = edictAvailability(g, id, nation);
  if (!av.ok) return { ok: false, reason: av.reason };
  const p = target ? g.people.get(target) : undefined;
  const pay = () => av.cost && g.spend(av.cost, 'edicts');
  switch (id) {
    // ---------------------------------------------------- individual
    case 'free_captive': {
      if (!p || p.kind === 'pirate') return { ok: false, reason: 'Select a captive.' };
      g.nations[p.nat].relation += 2;
      if (!g.nations[p.nat].knows && g.rng.chance(g.ongoing.has('loose_lips') ? 0.1 : 0.35)) {
        g.nations[p.nat].knows = true;
        g.msg('alert', 'Discovered!', `The freed ${NATION_ADJ[p.nat]} captive told everyone where you are.`, 'discovered');
      }
      releaseAll(g, p);
      g.people.delete(p.id);
      g.events.push({ type: 'despawn', id: p.id });
      return { ok: true };
    }
    case 'press_gang': {
      if (!p || p.kind !== 'captive' || p.skilled) return { ok: false, reason: 'Only unskilled captives can be press-ganged.' };
      releaseAll(g, p);
      p.kind = 'pirate';
      p.gold = 0;
      p.earned = 0;
      p.rank = 1;
      p.happiness = 0.3;
      p.needs = { feast: 0.4, drink: 0.2, company: 0.3, gamble: 0.4, rest: 0.5, stash: 0.3 };
      for (const k in p.needs) p.opinion[k] = p.needs[k] * 0.7;
      for (const n of ['feast', 'drink', 'company', 'gamble', 'rest', 'stash'] as const) p.weights[n] = g.rng.range(0.6, 1.4);
      p.skills = { gunnery: g.rng.range(0, 1.5), swordsmanship: g.rng.range(0, 1.5), marksmanship: g.rng.range(0, 1.5), seamanship: g.rng.range(0, 1.5), navigation: g.rng.range(0, 1) };
      p.task = { kind: 'idle' };
      g.events.push({ type: 'respawn', id: p.id });
      assignCrews(g);
      return { ok: true };
    }
    case 'ransom': {
      if (!p || (p.kind !== 'wealthy' && !(p.kind === 'captive' && p.skilled))) return { ok: false, reason: 'Only skilled or wealthy captives fetch a ransom.' };
      const amt = Math.round(p.ransom);
      g.earn(amt, 'ransom');
      g.msg('good', 'Ransom Paid', `${p.name}'s family paid ${amt} gold for their return.`, 'ransom', undefined);
      releaseAll(g, p);
      g.people.delete(p.id);
      g.events.push({ type: 'despawn', id: p.id });
      return { ok: true };
    }
    case 'donate':
      if (!p || p.kind !== 'pirate') return { ok: false, reason: 'Select a pirate.' };
      pay();
      p.gold += 100;
      p.earned += 100;
      return { ok: true };
    case 'assassinate': {
      if (!p || p.captain || p.kind === 'wealthy') return { ok: false, reason: 'Cannot assassinate that person.' };
      const palace = g.findBuilding('palace');
      const guardId = palace?.guards.find((id) => g.people.get(id)?.task.kind !== 'atsea');
      const guard = guardId ? g.people.get(guardId) : undefined;
      if (!guard) return { ok: false, reason: 'You need a palace guard.' };
      pay();
      const gs = guard.skills.swordsmanship + guard.skills.marksmanship + g.rng.range(0, 5);
      const ts = p.kind === 'pirate' ? p.skills.swordsmanship + p.skills.marksmanship + g.rng.range(0, 5) : g.rng.range(0, 4);
      if (gs >= ts) {
        killPerson(g, p, 'assassinated');
        g.msg('info', 'Assassination', `${guard.name} has quietly dealt with ${p.name}.`, 'assassination');
      } else {
        killPerson(g, guard, 'assassination failed');
        g.msg('bad', 'Assassination Failed', `${p.name} got the better of your guard ${guard.name}!`, 'assassination_failed');
      }
      return { ok: true };
    }
    case 'educate': {
      if (!p || p.kind !== 'pirate') return { ok: false, reason: 'Select a pirate.' };
      const skill = (arg ?? 'gunnery') as keyof typeof p.skills;
      const school = [...g.buildings.values()].find((b) => BUILDING[b.def].school === skill && b.built >= 1);
      if (!school) return { ok: false, reason: `No ${skill} school.` };
      pay();
      p.skills[skill] = Math.min(5, p.skills[skill] + g.rng.range(1.5, 2.5));
      for (const k in p.needs) p.needs[k] = Math.max(0, p.needs[k] - 0.6);
      p.task = { kind: 'school', bld: school.id, timer: 40, phase: 1 };
      p.x = school.door[0] + 0.5;
      p.y = school.door[1] + 0.5;
      return { ok: true };
    }
    case 'outfit': {
      if (!p || p.kind !== 'pirate') return { ok: false, reason: 'Select a pirate.' };
      const want = (arg ?? (['pegleg', 'hat', 'parrot'].find((x) => g.goodTotal(x as any) > 0 && !(p.accessories as any)[x]))) as 'pegleg' | 'hat' | 'parrot';
      if (!want || (p.accessories as any)[want]) return { ok: false, reason: 'They already have one.' };
      const src = [...g.buildings.values()].find((b) => (b.inv[want] ?? 0) > 0);
      if (!src) return { ok: false, reason: 'None in stock.' };
      src.inv[want]!--;
      p.accessories[want] = true;
      if (want === 'pegleg') p.traits.notoriety = Math.min(9, p.traits.notoriety + 2);
      if (want === 'hat') p.traits.leadership = Math.min(9, p.traits.leadership + 2);
      if (want === 'parrot') p.traits.courage = Math.min(9, p.traits.courage + 2);
      g.events.push({ type: 'outfit', id: p.id });
      return { ok: true };
    }
    // ---------------------------------------------------- pirate policy
    case 'free_beer':
    case 'free_rum': {
      pay();
      const good = id === 'free_beer' ? 'beer' : 'rum';
      let need = 10;
      for (const b of g.buildings.values()) {
        const t = Math.min(need, b.inv[good] ?? 0);
        b.inv[good] = (b.inv[good] ?? 0) - t;
        need -= t;
      }
      for (const q of g.pirates()) if (q.task.kind !== 'atsea') {
        q.needs.drink = Math.min(1, q.needs.drink + (id === 'free_beer' ? 0.5 : 1));
        q.opinion.drink = Math.min(1, (q.opinion.drink ?? 0.5) + (id === 'free_beer' ? 0.15 : 0.3));
      }
      g.msg('good', id === 'free_beer' ? 'Free Beer!' : 'Free Rum!', 'The pirates raise a toast to their generous king!', 'free_grog');
      g.events.push({ type: 'celebrate' });
      return { ok: true };
    }
    case 'festival':
      pay();
      g.effects.festivalUntil = g.time + MONTH * 0.5;
      for (const q of g.pirates()) if (q.task.kind !== 'atsea') {
        for (const k of ['drink', 'feast', 'gamble'] as const) {
          q.needs[k] = Math.min(1, q.needs[k] + 0.3);
          q.opinion[k] = Math.min(1, (q.opinion[k] ?? 0.5) + 0.12);
        }
      }
      g.aura.dirty = true;
      g.msg('good', 'Pirate Festival!', 'Rum flows, fiddles screech and the bonfires roar. What a party!', 'festival');
      g.events.push({ type: 'celebrate' });
      return { ok: true };
    case 'betray': {
      let n = 0;
      for (const q of g.pirates()) if (q.nat === nation) {
        if (q.task.kind === 'atsea') continue;
        killPerson(g, q, 'betrayed');
        n++;
      }
      g.nations[nation!].relation = Math.min(100, g.nations[nation!].relation + 10 + n * 3);
      g.msg('info', 'Betrayal', `${n} ${NATION_ADJ[nation!]} pirates were handed over to the hangman. ${NATION_NAMES[nation!]} is grateful. The rest of your crews are nervous.`, 'betray');
      for (const q of g.pirates()) q.happiness -= 0.05;
      return { ok: true };
    }
    case 'donate_crew': {
      const s = target ? g.ships.get(target) : undefined;
      if (!s) return { ok: false, reason: 'Select a ship.' };
      pay();
      const members = [s.captain, ...s.crew].map((i) => g.people.get(i)).filter(Boolean);
      for (const q of members) (q!.gold += 500 / members.length), (q!.earned += 500 / members.length);
      return { ok: true };
    }
    case 'recruit_captain': {
      pay();
      const dock = [...g.buildings.values()].find((b) => b.def === 'dock' && b.built >= 1) ?? g.findBuilding('palace')!;
      const c = createCaptain(g, dock.door[0], dock.door[1]);
      assignCrews(g);
      g.msg('good', 'A New Captain', `The infamous ${c.name} has signed on to sail under your flag.`, 'new_captain', { x: c.x, y: c.y });
      return { ok: true };
    }
    // ---------------------------------------------------- captive policy
    case 'free_all': {
      let n = 0;
      for (const q of g.captives()) if (q.nat === nation && q.kind === 'captive') {
        releaseAll(g, q);
        g.people.delete(q.id);
        g.events.push({ type: 'despawn', id: q.id });
        n++;
      }
      g.nations[nation!].relation = Math.min(100, g.nations[nation!].relation + 5 + n * 1.5);
      if (!g.nations[nation!].knows && g.rng.chance(0.6)) g.nations[nation!].knows = true;
      g.msg('info', 'Captives Freed', `${n} ${NATION_ADJ[nation!]} captives sail for home, singing your praises.`, 'free_all');
      return { ok: true };
    }
    case 'raise_dead': {
      pay();
      const corpse = g.graveyard.shift()!;
      const gy = g.findBuilding('graveyard')!;
      const sk = createPerson(g, 'skeleton', gy.door[0], gy.door[1]);
      sk.name = `${corpse.name} (deceased)`;
      sk.nat = corpse.nat;
      g.effects.skeletonsRaised++;
      g.msg('info', 'The Dead Walk', `${corpse.name} claws out of the grave, ready to haul cargo forever.`, 'raise_dead', { x: sk.x, y: sk.y });
      return { ok: true };
    }
    // ---------------------------------------------------- diplomacy
    case 'peace':
      g.ongoing.add(key);
      g.nations[nation!].relation = Math.min(100, g.nations[nation!].relation + 12);
      g.msg('info', 'Peace Announced', `You have promised ${NATION_NAMES[nation!]} that your captains will leave their ships alone.`, 'peace');
      return { ok: true };
    case 'patron':
      g.ongoing.add(key);
      g.nations[nation!].knows = true;
      g.msg('good', 'Patronage', `${NATION_NAMES[nation!]} now protects your island as a colony. No-one will dare invade.`, 'patron');
      return { ok: true };
    case 'jolly_roger':
      g.ongoing.add(key);
      for (const n of NATIONS) {
        g.ongoing.delete(`peace:${n}`);
        g.ongoing.delete(`patron:${n}`);
        g.ongoing.delete(`marque:${n}`);
      }
      g.msg('alert', 'The Jolly Roger Flies!', 'Your island answers to no crown! Every Power is now fair game, and every Power may come for you.', 'jolly_roger');
      g.aura.dirty = true;
      return { ok: true };
    case 'open_cove':
      g.ongoing.add(key);
      if (!g.nations[nation!].knows) {
        g.nations[nation!].knows = true;
        g.msg('alert', 'Location Revealed', `${NATION_ADJ[nation!]} smugglers now know where to find you.`, 'discovered');
      }
      return { ok: true };
  }
  if (e.ongoing) {
    pay();
    g.ongoing.add(key);
    g.aura.dirty = true;
    g.msg('info', 'Edict Issued', `${e.name}${nation ? ` (${NATION_NAMES[nation]})` : ''} is now in force.`, 'edict');
    return { ok: true };
  }
  return { ok: false, reason: 'Not implemented' };
}
export type { Job };
