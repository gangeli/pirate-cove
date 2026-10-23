import type { Game } from './game';
import type { Building, Person } from './types';
import { BUILDING, SKILLED_ONLY, JOB_SEX, type Job } from './data/buildings';
import { canDoJob, closedRows, freeHand, freePirate } from './economy';

/**
 * Who is at work, who stands idle and how many places wait for them: the figures behind the top bar's
 * pirate and captive tips. Read only; it walks the same buildings, places and rules hiring does
 * (`employ()` in economy.ts), so "short" is what the next hiring pass would leave empty.
 */

/** a kind of building with places nobody idle can fill: its places left empty, over `n` buildings (`id` the worst) */
export interface Wanting {
  id: number;
  def: string;
  missing: number;
  n: number;
}

export interface Crew {
  /** alive on the island's books (as the top bar counts them) */
  total: number;
  /** captives: holding a worker place; pirates: crew of a ship, a captain, an overseer or a guard */
  employed: number;
  /** out of work and free to be hired, as hiring sees them */
  idle: number;
  /** neither: rebels, runaways, and pirates too sulky to take a post */
  unable: number;
  /** open places this kind can take: vacant, not closed by the player, in finished buildings */
  open: number;
  /** of those, places the idle would fill */
  fill: number;
  /** open places left empty after that: open − fill */
  short: number;
  /** idle left without a place: idle − fill */
  spare: number;
  /** short places that only a skilled captive of that trade can fill */
  skilledShort: number;
  /** the kinds of building left shortest, worst first (at most three) */
  wanting: Wanting[];
}

export interface Workforce {
  pirate: Crew;
  captive: Crew;
}

const blank = (): Crew => ({ total: 0, employed: 0, idle: 0, unable: 0, open: 0, fill: 0, short: 0, spare: 0, skilledShort: 0, wanting: [] });

/** one open place: a worker row's vacancy, or an overseer's or guard's post */
interface Place {
  b: Building;
  job: Job;
}

export function workforce(g: Game): Workforce {
  const pirate = blank(), captive = blank();
  const freeHands: Person[] = [];
  const freePirates: Person[] = [];
  for (const p of g.people.values()) {
    if (p.task.kind === 'dead') continue;
    if (p.kind === 'captive') {
      captive.total++;
      if (p.job) captive.employed++;
      else if (freeHand(p)) captive.idle++;
      else captive.unable++;
    } else if (p.kind === 'pirate') {
      pirate.total++;
      if (p.ship || p.shoreJob || p.captain || p.task.kind === 'atsea') pirate.employed++;
      else if (freePirate(p)) pirate.idle++;
      else pirate.unable++;
    }
    // skeletons are nobody's count but haul all the same, so they take hauler places before captives do
    if (freeHand(p)) freeHands.push(p);
    if (freePirate(p)) freePirates.push(p);
  }

  // open places, in the order hiring fills them (higher priority first)
  const bl = [...g.buildings.values()].filter((b) => b.built >= 1 && !b.condemned).sort((a, b) => b.priority - a.priority);
  const hands: Place[] = [];
  const posts: Place[] = [];
  for (const b of bl) {
    const def = BUILDING[b.def];
    const closed = closedRows(g, b);
    let haulRows = 0;
    for (const [ri, slot] of def.workers.entries()) {
      const list = slot.job === 'hauler' ? b.haulers : b.workers;
      const have = list.filter((id) => g.people.get(id)?.jobRole === slot.job).length;
      const open = Math.max(0, slot.count - have - closed[ri]);
      if (slot.job === 'hauler') haulRows += open;
      for (let i = 0; i < open; i++) hands.push({ b, job: slot.job });
    }
    // the building's own haulers share its haulers list with any hauler row
    const nh = def.haulers ?? 0;
    const extra = Math.max(0, nh - b.haulers.filter((id) => g.people.get(id)?.jobRole === 'hauler').length - haulRows);
    for (let i = 0; i < extra; i++) hands.push({ b, job: 'hauler' });
    // an unpaid post is one the player has closed: nobody is hired to it
    if (b.wage > 0) {
      if (def.overseer && !b.overseer) posts.push({ b, job: 'overseer' });
      for (let i = b.guards.length; i < (def.guards ?? 0); i++) posts.push({ b, job: 'guard' });
    }
  }

  // captives' places: each to the hand hiring would pick, skilled tradesmen first, skeletons for hauling,
  // and women kept for the posts only they can take
  let femaleDemand = 0;
  for (const pl of hands) if (JOB_SEX[pl.job] === 'F') femaleDemand++;
  const shortBy = new Map<Building, number>();
  const rank = (p: Person, job: Job) => (p.skilled ? 0 : p.kind === 'skeleton' ? 1 : !JOB_SEX[job] && p.sex === 'F' && femaleDemand > 0 ? 3 : 2);
  for (const pl of hands) {
    captive.open++;
    let best = -1, br = Infinity;
    for (let i = 0; i < freeHands.length && br > 0; i++) {
      const p = freeHands[i];
      if (!canDoJob(p, pl.job)) continue;
      const r = rank(p, pl.job);
      if (r < br) (br = r), (best = i);
    }
    if (best < 0) {
      captive.short++;
      if (SKILLED_ONLY.includes(pl.job)) captive.skilledShort++;
      shortBy.set(pl.b, (shortBy.get(pl.b) ?? 0) + 1);
      continue;
    }
    const p = freeHands.splice(best, 1)[0];
    if (JOB_SEX[pl.job] === 'F') femaleDemand--;
    if (p.kind === 'captive') captive.fill++;
  }
  captive.spare = captive.idle - captive.fill;
  captive.wanting = worst(shortBy);

  // pirates' posts: any willing pirate takes any post
  const postShort = new Map<Building, number>();
  pirate.open = posts.length;
  pirate.fill = Math.min(posts.length, freePirates.length);
  pirate.short = posts.length - pirate.fill;
  pirate.spare = pirate.idle - pirate.fill;
  for (const pl of posts.slice(pirate.fill)) postShort.set(pl.b, (postShort.get(pl.b) ?? 0) + 1);
  pirate.wanting = worst(postShort);
  return { pirate, captive };
}

function worst(m: Map<Building, number>): Wanting[] {
  const byDef = new Map<string, Wanting & { most: number }>();
  for (const [b, k] of m) {
    const w = byDef.get(b.def);
    if (!w) byDef.set(b.def, { id: b.id, def: b.def, missing: k, n: 1, most: k });
    else {
      w.missing += k;
      w.n++;
      if (k > w.most) (w.most = k), (w.id = b.id);
    }
  }
  return [...byDef.values()].sort((a, b) => b.missing - a.missing).slice(0, 3).map(({ id, def, missing, n }) => ({ id, def, missing, n }));
}
