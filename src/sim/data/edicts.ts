import type { Nation } from './kings';

export type EdictTab = 'individual' | 'pirate' | 'cruise' | 'captive' | 'diplomacy';
export const EDICT_TABS: Record<EdictTab, string> = {
  individual: 'Individual Attention', pirate: 'Pirate Policy', cruise: 'Cruise Orders', captive: 'Captive Policy', diplomacy: 'International Diplomacy',
};

export type Target = 'none' | 'pirate' | 'captive' | 'ship' | 'nation';

export interface EdictDef {
  id: string;
  name: string;
  tab: EdictTab;
  cost: number;
  ongoing?: boolean;
  target: Target;
  needs?: string; // building id requirement
  desc: string;
}

export const EDICTS: EdictDef[] = [
  // individual
  { id: 'free_captive', name: 'Free Captive', tab: 'individual', cost: 0, target: 'captive', desc: 'Release a captive. Their nation is pleased, but they may reveal where you are.' },
  { id: 'press_gang', name: 'Press Gang', tab: 'individual', cost: 0, target: 'captive', desc: 'Force an unskilled captive to become a (miserable) pirate.' },
  { id: 'ransom', name: 'Ransom Captive', tab: 'individual', cost: 0, target: 'captive', desc: 'Sell a skilled or wealthy captive back to their family.' },
  { id: 'donate', name: 'Donate Money', tab: 'individual', cost: 100, target: 'pirate', desc: 'Give a pirate 100 gold to spend on the island.' },
  { id: 'assassinate', name: 'Assassinate', tab: 'individual', cost: 100, target: 'pirate', needs: 'palace', desc: 'Send a palace guard to settle a troublemaker. The target may win.' },
  { id: 'educate', name: 'Educate Pirate', tab: 'individual', cost: 100, target: 'pirate', desc: 'Send a pirate to a school to improve one skill.' },
  { id: 'outfit', name: 'Outfit Pirate', tab: 'individual', cost: 0, target: 'pirate', desc: 'Give a pirate a peg leg, a hat or a parrot.' },
  // pirate policy
  { id: 'free_beer', name: 'Free Beer', tab: 'pirate', cost: 1000, target: 'none', desc: 'Pours beer for every pirate ashore. Drinking +50%.' },
  { id: 'free_rum', name: 'Free Rum', tab: 'pirate', cost: 1500, target: 'none', desc: 'Rum for all! Drinking +100%.' },
  { id: 'festival', name: 'Pirate Festival', tab: 'pirate', cost: 1000, target: 'none', desc: 'A day of carousing: drinking, feasting and gambling +30% and a burst of anarchy.' },
  { id: 'rig_against', name: 'Rig Gambling Against Pirates', tab: 'pirate', cost: 500, ongoing: true, target: 'none', desc: 'More gambling revenue, but less satisfaction.' },
  { id: 'rig_favour', name: 'Rig Gambling in Favour', tab: 'pirate', cost: 500, ongoing: true, target: 'none', desc: 'Happier gamblers, but the house earns less.' },
  { id: 'curfew', name: 'Pirate Curfew', tab: 'pirate', cost: 750, ongoing: true, target: 'none', desc: 'Much more order and captive productivity. Pirates resent it.' },
  { id: 'loose_lips', name: 'Loose Lips Sink Ships', tab: 'pirate', cost: 100, ongoing: true, target: 'none', desc: 'Captives are less likely to reveal your island. More order; pirates dislike it.' },
  { id: 'betray', name: 'Betray Pirates', tab: 'pirate', cost: 0, target: 'nation', desc: 'Hand over every pirate of one nationality to be hanged. That Power is delighted.' },
  { id: 'donate_crew', name: 'Donate Money to Crew', tab: 'pirate', cost: 500, target: 'ship', desc: 'Share 500 gold among one ship\'s crew.' },
  // cruise orders
  { id: 'prohibit_eng', name: 'Prohibit English Victims', tab: 'cruise', cost: 0, ongoing: true, target: 'none', desc: 'Captains leave English ships alone.' },
  { id: 'prohibit_fra', name: 'Prohibit French Victims', tab: 'cruise', cost: 0, ongoing: true, target: 'none', desc: 'Captains leave French ships alone.' },
  { id: 'prohibit_spa', name: 'Prohibit Spanish Victims', tab: 'cruise', cost: 0, ongoing: true, target: 'none', desc: 'Captains leave Spanish ships alone.' },
  { id: 'walk_plank', name: 'Walk the Plank', tab: 'cruise', cost: 0, ongoing: true, target: 'none', desc: 'No witnesses: take no captives or recruits from victims.' },
  { id: 'recruit_captain', name: 'Recruit Captain', tab: 'cruise', cost: 1500, target: 'none', desc: 'Hire a famous captain to command one of your ships.' },
  // captive policy
  { id: 'informants', name: 'Pay for Informants', tab: 'captive', cost: 1000, ongoing: true, target: 'none', desc: 'Captives snitch on each other. Fear rises.' },
  { id: 'free_all', name: 'Free All of Nationality', tab: 'captive', cost: 0, target: 'nation', desc: 'Release every captive of one nation. A grand gesture.' },
  { id: 'executions', name: 'Random Executions', tab: 'captive', cost: 500, ongoing: true, target: 'none', desc: 'Pirates kill captives at whim. Fear and anarchy both rise.' },
  { id: 'patrols', name: 'Pirate Guard Patrols', tab: 'captive', cost: 500, ongoing: true, target: 'none', desc: 'Pirates patrol the roads. Order and fear rise; pirates grumble.' },
  { id: 'raise_dead', name: 'Raise Dead', tab: 'captive', cost: 100, target: 'none', needs: 'graveyard', desc: 'Raise a dead pirate as a tireless skeleton hauler.' },
  // diplomacy
  { id: 'jolly_roger', name: 'Raise the Jolly Roger', tab: 'diplomacy', cost: 0, ongoing: true, target: 'none', needs: 'fort', desc: 'Declare independence from all Powers. No peace, no patron, no protection.' },
  { id: 'peace', name: 'Announce Peace Policy', tab: 'diplomacy', cost: 0, ongoing: true, target: 'nation', desc: 'Promise not to attack a Power\'s ships. Relations improve every month. Break it and pay.' },
  { id: 'open_cove', name: "Open Smuggler's Cove", tab: 'diplomacy', cost: 0, ongoing: true, target: 'nation', needs: 'smugglers_cove', desc: 'Trade surplus goods with a Power. They will learn where you are.' },
  { id: 'patron', name: 'Declare Patron', tab: 'diplomacy', cost: 0, ongoing: true, target: 'nation', desc: 'Become a colony of a Power at peace with you. No-one dares invade.' },
  { id: 'marque', name: 'Letters of Marque', tab: 'diplomacy', cost: 1000, ongoing: true, target: 'nation', desc: 'Legal privateering against your patron\'s enemy.' },
];
export const EDICT: Record<string, EdictDef> = Object.fromEntries(EDICTS.map((e) => [e.id, e]));
export type OngoingKey = string; // e.g. 'curfew' or 'peace:eng'
export function ongoingKey(id: string, nation?: Nation): OngoingKey {
  return nation ? `${id}:${nation}` : id;
}
