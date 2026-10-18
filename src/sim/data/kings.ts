export type Nation = 'eng' | 'fra' | 'spa';
export const NATIONS: Nation[] = ['eng', 'fra', 'spa'];
export const NATION_NAMES: Record<Nation, string> = { eng: 'England', fra: 'France', spa: 'Spain' };
export const NATION_ADJ: Record<Nation, string> = { eng: 'English', fra: 'French', spa: 'Spanish' };

export type Background =
  | 'always_pirate' | 'decayed_gentleman' | 'gambler' | 'master_gunner' | 'once_captain' | 'once_mutineer'
  | 'procurer' | 'shipwright' | 'sugar_planter' | 'tobacco_planter';
export type Quality =
  | 'charismatic' | 'courageous' | 'craftiness' | 'diplomacy' | 'duelist' | 'fun_loving' | 'iron_handed'
  | 'industrious' | 'lucky_cards' | 'notoriety' | 'trilingual' | 'voodoo' | 'inquisitor' | 'religious'
  | 'navigator' | 'seafarer';
export type Flaw =
  | 'greedy' | 'lazy' | 'suicidal' | 'catholic' | 'protestant' | 'tortured_eng' | 'tortured_fra' | 'tortured_spa'
  | 'alcoholic' | 'cowardly' | 'illiterate';

export const BACKGROUNDS: Record<Background, { name: string; desc: string }> = {
  always_pirate: { name: 'Always a Pirate', desc: 'Twice as many recruits on cruises, but captains cost half again as much.' },
  decayed_gentleman: { name: 'Decayed Gentleman', desc: '+33% order, better relations with every Power, and a skilled trader.' },
  gambler: { name: 'Experienced Gambler', desc: 'Gambling dens and casinos cost half and need no upkeep.' },
  master_gunner: { name: 'Master Gunner', desc: 'Starting pirates +2 gunnery. Cheap gunnery school and cannon foundry. An engineer joins you.' },
  once_captain: { name: 'Once a Captain', desc: '+33% order and captains at half price, but fewer recruits.' },
  once_mutineer: { name: 'Once a Mutineer', desc: 'More recruits and more fear, but less order and pricier captains.' },
  procurer: { name: 'Procurer', desc: 'Two skilled wenches and a courtesan. Brothels at half price.' },
  shipwright: { name: 'Shipwright', desc: 'Two shipwrights join you and the shipyard costs half.' },
  sugar_planter: { name: 'Sugar Planter', desc: 'A distiller and a skilled farmer. Distilleries at half price.' },
  tobacco_planter: { name: 'Tobacco Planter', desc: 'A tobacconist and a skilled farmer. Cigar factories at half price.' },
};
export const QUALITIES: Record<Quality, { name: string; desc: string; excludes?: (Quality | Flaw | Background)[] }> = {
  charismatic: { name: 'Charismatic', desc: '+3 leadership for all pirates.' },
  courageous: { name: 'Courageous Leader', desc: '+2 courage for all starting pirates.', excludes: ['cowardly'] },
  craftiness: { name: 'Battle Craftiness', desc: 'Ships are 10% faster in pursuit and flight.' },
  diplomacy: { name: 'Diplomacy', desc: '+19% defense and better relations with every Power.' },
  duelist: { name: 'Expert Duelist', desc: 'Pirates +2 marksmanship.' },
  fun_loving: { name: 'Fun-Loving', desc: '+33% anarchy, -33% order island-wide.', excludes: ['iron_handed'] },
  iron_handed: { name: 'Iron-Handed', desc: '+33% order, -33% anarchy island-wide.', excludes: ['fun_loving'] },
  industrious: { name: 'Industrious', desc: 'Captives work faster.', excludes: ['lazy'] },
  lucky_cards: { name: 'Lucky with Cards', desc: 'Gambling dens and casinos cost half and need no upkeep.', excludes: ['gambler'] },
  notoriety: { name: 'Dreadful Notoriety', desc: '+10% plunder and captains start more notorious.' },
  trilingual: { name: 'Trilingual', desc: 'Much better relations with the two foreign Powers.' },
  voodoo: { name: 'Voodoo Adept', desc: 'Raising the dead costs half.', excludes: ['religious'] },
  inquisitor: { name: 'Inquisitor', desc: '+20% fear island-wide.' },
  religious: { name: 'Religious', desc: 'Churches satisfy captives more.', excludes: ['voodoo'] },
  navigator: { name: 'Expert Navigator', desc: 'Captains rarely get lost.' },
  seafarer: { name: 'Expert Seafarer', desc: '+1 seamanship for all pirates.' },
};
export const FLAWS: Record<Flaw, { name: string; desc: string; excludes?: (Quality | Flaw | Background)[] }> = {
  greedy: { name: 'Greedy', desc: 'Can only divide spoils Selfish or Miserly.' },
  lazy: { name: 'Lazy', desc: 'Captives work slower.', excludes: ['industrious'] },
  suicidal: { name: 'Suicidal Bravery', desc: 'Captains engage recklessly.' },
  catholic: { name: 'Fanatic Catholic', desc: 'Only French and Spanish captives may attend church.' },
  protestant: { name: 'Fanatic Protestant', desc: 'Only English captives may attend church.' },
  tortured_eng: { name: 'Tortured by England', desc: 'England despises you. No peace with England.' },
  tortured_fra: { name: 'Tortured by France', desc: 'France despises you. No peace with France.' },
  tortured_spa: { name: 'Tortured by Spain', desc: 'Spain despises you. No peace with Spain.' },
  alcoholic: { name: 'Alcoholic', desc: 'Pirate festivals and free grog cost more.' },
  cowardly: { name: 'Cowardly', desc: 'Captains are quick to flee.', excludes: ['courageous'] },
  illiterate: { name: 'Illiterate', desc: 'Schools cost half again as much.' },
};

export interface KingDef {
  id: string;
  name: string;
  sex: 'M' | 'F';
  nat: Nation;
  bg: Background;
  q: [Quality, Quality];
  flaw: Flaw;
  bio: string;
}

export const KINGS: KingDef[] = [
  { id: 'bonny', name: 'Anne Bonny', sex: 'F', nat: 'eng', bg: 'always_pirate', q: ['charismatic', 'fun_loving'], flaw: 'illiterate', bio: 'Irish-born firebrand who sailed with Calico Jack and fought harder than his whole crew.' },
  { id: 'bart', name: 'Black Bart', sex: 'M', nat: 'eng', bg: 'once_captain', q: ['charismatic', 'iron_handed'], flaw: 'greedy', bio: 'Took four hundred prizes. Strict rules aboard, but a fortune for all.' },
  { id: 'blackbeard', name: 'Blackbeard', sex: 'M', nat: 'eng', bg: 'shipwright', q: ['courageous', 'notoriety'], flaw: 'suicidal', bio: 'Lit fuses in his beard to terrify his prey. Terrified most of his crew, too.' },
  { id: 'mary', name: 'Bloody Mary', sex: 'F', nat: 'eng', bg: 'gambler', q: ['diplomacy', 'religious'], flaw: 'alcoholic', bio: 'Charming at the card table and in the governor\'s parlour alike.' },
  { id: 'calico', name: 'Calico Jack', sex: 'M', nat: 'eng', bg: 'sugar_planter', q: ['craftiness', 'fun_loving'], flaw: 'cowardly', bio: 'Dashing in calico, quick on the tiller, quicker to run.' },
  { id: 'low', name: 'Ned Low', sex: 'M', nat: 'eng', bg: 'decayed_gentleman', q: ['inquisitor', 'religious'], flaw: 'catholic', bio: 'A cruel and pious man, which is the most dangerous kind.' },
  { id: 'deberry', name: 'Charlotte de Berry', sex: 'F', nat: 'spa', bg: 'once_mutineer', q: ['navigator', 'industrious'], flaw: 'protestant', bio: 'Took her first ship by mutiny and never looked back.' },
  { id: 'lolonnais', name: "François l'Olonnais", sex: 'M', nat: 'fra', bg: 'master_gunner', q: ['inquisitor', 'trilingual'], flaw: 'tortured_eng', bio: 'The scourge of the Spanish Main, who never forgave the English.' },
  { id: 'morgan', name: 'Henry Morgan', sex: 'M', nat: 'eng', bg: 'decayed_gentleman', q: ['notoriety', 'iron_handed'], flaw: 'greedy', bio: 'Sacked Panama, then retired a knight and lieutenant governor.' },
  { id: 'degraff', name: 'Laurens de Graaf', sex: 'M', nat: 'fra', bg: 'always_pirate', q: ['craftiness', 'duelist'], flaw: 'tortured_spa', bio: 'A gunner\'s eye and a duellist\'s hand, with a grudge against Spain.' },
  { id: 'bonnet', name: 'Stede Bonnet', sex: 'M', nat: 'eng', bg: 'gambler', q: ['duelist', 'fun_loving'], flaw: 'lazy', bio: 'The gentleman pirate. Bought his ship, then learned to sail it.' },
  { id: 'read', name: 'Mary Read', sex: 'F', nat: 'eng', bg: 'once_mutineer', q: ['courageous', 'duelist'], flaw: 'suicidal', bio: 'Soldier, sailor, duellist. Fearless to a fault.' },
  { id: 'vanhoorn', name: 'Nikolaas van Hoorn', sex: 'M', nat: 'spa', bg: 'master_gunner', q: ['notoriety', 'lucky_cards'], flaw: 'suicidal', bio: 'Made his fortune in a single raid on Veracruz.' },
  { id: 'brasiliano', name: 'Roche Brasiliano', sex: 'M', nat: 'spa', bg: 'tobacco_planter', q: ['fun_loving', 'inquisitor'], flaw: 'alcoholic', bio: 'Generous when sober, terrible when drunk, which was often.' },
  { id: 'delahaye', name: 'Jacquotte Delahaye', sex: 'F', nat: 'spa', bg: 'procurer', q: ['charismatic', 'voodoo'], flaw: 'tortured_fra', bio: 'Back from the dead, they said, with a crew of hundreds.' },
  { id: 'kidd', name: 'William Kidd', sex: 'M', nat: 'eng', bg: 'once_captain', q: ['notoriety', 'seafarer'], flaw: 'lazy', bio: 'A privateer turned pirate. Somewhere, his treasure is still buried.' },
];
