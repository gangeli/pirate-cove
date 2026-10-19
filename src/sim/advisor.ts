import type { Game } from './game';
import { MONTH } from './time';
import { BUILDING } from './data/buildings';

export const ADVISOR_NAME = 'Barnaby';

interface Tip {
  id: string;
  cooldown: number; // seconds between repeats
  when: (g: Game) => boolean;
  title: string;
  text: (g: Game) => string;
}

const TIPS: Tip[] = [
  { id: 'welcome', cooldown: Infinity, when: (g) => g.time > 2, title: 'Welcome Ashore', text: (g) => `Welcome to your island, ${g.king.sex === 'F' ? 'my Queen' : 'my King'}! Captives do the work, pirates bring the gold. Keep the pirates merry and the captives cowed, and we'll all be rich. Start by sending the ship out on a cruise. I'll keep an eye on the rest.` },
  { id: 'lumber_low', cooldown: MONTH * 3, when: (g) => g.lumber() < 8 && g.time > 30, title: 'Short of Timber', text: () => "Can't shiver me timbers without timber! We're nearly out of lumber. Make sure the timber camp is near thick jungle and the sawmill has workers." },
  { id: 'food_low', cooldown: MONTH * 2, when: (g) => g.captives().filter((c) => c.kind === 'captive' && c.needs.food < 0.2).length > 4, title: 'Hungry Captives', text: () => 'The captives are starving! More corn farms and chuck tents. One tent for every thirty or so mouths.' },
  { id: 'no_captain', cooldown: MONTH * 4, when: (g) => [...g.ships.values()].some((s) => !s.captain && s.status === 'docked') && g.treasury > 1600, title: 'Ship Without a Captain', text: () => "We've a ship sitting idle with no captain! Issue the Recruit Captain edict and some famous rogue will take her out." },
  { id: 'idle_ship', cooldown: MONTH * 3, when: (g) => [...g.ships.values()].some((s) => s.status === 'docked' && s.captain && s.crew.length >= 3 && s.rations > 3) && g.time > MONTH * 1.5, title: 'Idle Ship', text: () => "A ship in harbour makes no gold. Send her out! Pick a region on the sea chart and press Set Sail." },
  { id: 'homeless', cooldown: MONTH * 4, when: (g) => g.pirates().filter((p) => !p.home && !p.captain).length > 4, title: 'Homeless Pirates', text: () => "Plenty o' pirates sleeping in the dirt. Put down some housing plots near the docks. They'll build their own shacks once they've got the coin." },
  { id: 'company', cooldown: MONTH * 4, when: (g) => avgNeed(g, 'company') < 0.3 && g.pirates().length > 6, title: 'Lonely Pirates', text: () => 'The lads are lonely, if you take my meaning. A few more wench huts near the dive would cheer them right up.' },
  { id: 'drink', cooldown: MONTH * 4, when: (g) => avgNeed(g, 'drink') < 0.3 && g.pirates().length > 6, title: 'Thirsty Pirates', text: () => "A thirsty pirate is a dangerous pirate. We need more places to drink! A brewery would make it better still." },
  { id: 'gamble', cooldown: MONTH * 5, when: (g) => avgNeed(g, 'gamble') < 0.25 && g.pirates().length > 6, title: 'Bored Pirates', text: () => 'The crews are bored stiff. An animal pit or gambling den would give them something to wager on.' },
  { id: 'broke', cooldown: MONTH * 5, when: (g) => g.pirates().filter((p) => p.gold < 5 && p.task.kind !== 'atsea').length > g.pirates().length * 0.5 && g.pirates().length > 6, title: 'Broke Pirates', text: () => "Half the lads haven't a coin to their name! They can't spend what they don't have. Send the ships out, or be more generous with the spoils." },
  { id: 'unemployed', cooldown: MONTH * 4, when: (g) => g.captives().filter((c) => !c.job && c.kind === 'captive' && !c.skilled).length > 8, title: 'Idle Captives', text: () => "There's a mob of idle captives loafing about the stockade. Build something for them to do!" },
  { id: 'idle_skilled', cooldown: MONTH * 4, when: (g) => g.captives().some((c) => c.skilled && !c.job && c.task.kind !== 'dead') && g.time > MONTH, title: 'Idle Craftsman', text: (g) => {
    const c = g.captives().find((c) => c.skilled && !c.job)!;
    return `We have a skilled ${c.profession} sitting idle. Build a place for them to work, and we can unlock new buildings too.`;
  } },
  { id: 'no_cave', cooldown: MONTH * 6, when: (g) => g.time > MONTH * 3 && !g.buildingCount('cave', false) && g.treasury > 300, title: 'Your Hoard', text: () => "Don't forget yourself, now! Build a Pirate Cave and a share of every coin will go to your personal hoard. That's what history will remember you by." },
  { id: 'escapes', cooldown: MONTH * 3, when: (g) => g.effects.recentEscapes > 1.5, title: 'Runaways', text: () => "Captives keep running off! More fear and order is what's needed: a gallows, watch towers, or a few skull pikes about the work yards." },
  { id: 'unhappy', cooldown: MONTH * 3, when: (g) => g.avgHappiness() < 0.35 && g.pirates().length > 5, title: 'Black Moods', text: () => "The pirates are grumbling. Look at what they're lacking: food, drink, company, games, a bed, and somewhere to stash their gold. And for pity's sake, not too many rules!" },
  { id: 'debt', cooldown: MONTH * 3, when: (g) => g.treasury < 0 || (g.effects.neglect ?? 0) > 0.05, title: 'The Treasury Is Empty!', text: () => "We can't pay the upkeep or the wages, so the works are running down and the overseers go unpaid. No more building until the ships bring home some plunder, or the smugglers sell something!" },
  { id: 'no_builders', cooldown: MONTH * 2, when: (g) => [...g.buildings.values()].some((b) => b.built < 1 && g.time - (b as any).placedAt > MONTH) && ![...g.buildings.values()].some((b) => b.def === 'construction_tent' && b.workers.length > 0), title: 'Nobody Is Building', text: () => "There's construction waiting and no builders to do it! Make sure a Construction Tent is staffed. Raise its priority, or bring in more captives." },
  { id: 'church', cooldown: MONTH * 8, when: (g) => g.yearsElapsed > 2 && !g.buildingCount('church', false) && g.hasProfession('priest'), title: 'Captives Need Religion', text: () => "The captives have been here a long while and are asking for a church. We have a priest; let him preach." },
  { id: 'notice', cooldown: MONTH * 6, when: (g) => Object.values(g.nations).some((n) => n.knows && n.relation < -40) && !g.buildingCount('fort', false), title: 'Defenses', text: () => "A Great Power knows where we are and hates us. We'd best build defenses, a fort if we can manage it, or make peace before they come calling." },
];

function avgNeed(g: Game, n: string): number {
  const p = g.pirates().filter((p) => p.task.kind !== 'atsea');
  return p.length ? p.reduce((a, b) => a + (b.opinion[n] ?? 0.5), 0) / p.length : 1;
}

export function checkAdvisor(g: Game): void {
  for (const t of TIPS) {
    const last = g.advisorState[t.id];
    if (last !== undefined && (t.cooldown === Infinity || g.time - last < t.cooldown)) continue;
    if (!t.when(g)) continue;
    g.advisorState[t.id] = g.time;
    g.msg('advisor', t.title, t.text(g), `adv_${t.id}`);
    return; // one tip at a time
  }
}
export { BUILDING };
