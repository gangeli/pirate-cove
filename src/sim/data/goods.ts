export type Good =
  | 'wood' | 'lumber' | 'corn' | 'banana' | 'papaya' | 'sugarcane' | 'tobacco' | 'ore' | 'pigiron'
  | 'slop' | 'ration' | 'beer' | 'rum' | 'cigar' | 'pastry' | 'cutlass' | 'musket' | 'cannon'
  | 'pegleg' | 'hat' | 'parrot';

export const GOOD_LIST: Good[] = [
  'wood', 'lumber', 'corn', 'banana', 'papaya', 'sugarcane', 'tobacco', 'ore', 'pigiron',
  'slop', 'ration', 'beer', 'rum', 'cigar', 'pastry', 'cutlass', 'musket', 'cannon', 'pegleg', 'hat', 'parrot',
];

export const GOOD_NAMES: Record<Good, string> = {
  wood: 'Logs', lumber: 'Lumber', corn: 'Corn', banana: 'Bananas', papaya: 'Papayas', sugarcane: 'Sugarcane',
  tobacco: 'Tobacco', ore: 'Iron Ore', pigiron: 'Pig Iron', slop: 'Slop', ration: 'Sea Rations', beer: 'Beer',
  rum: 'Rum', cigar: 'Cigars', pastry: 'Pastries', cutlass: 'Cutlasses', musket: 'Muskets', cannon: 'Cannons',
  pegleg: 'Peg Legs', hat: 'Hats', parrot: 'Parrots',
};

/** Black market purchase base prices / smuggler's cove sale base prices */
export const BLACK_MARKET_PRICE: Partial<Record<Good, number>> = { cannon: 200, musket: 75, cutlass: 50, ration: 8 };
export const SMUGGLER_PRICE: Partial<Record<Good, number>> = {
  cannon: 100, musket: 25, cutlass: 20, rum: 15, cigar: 15, pastry: 10, beer: 5,
};
