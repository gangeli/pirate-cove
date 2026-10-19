import type { Good } from './goods';

export type Job =
  | 'hauler' | 'farmer' | 'builder' | 'miner' | 'lumberjack' | 'smith' | 'priest' | 'trader' | 'cook'
  | 'wench' | 'server' | 'gunsmith' | 'engineer' | 'distiller' | 'tobacconist' | 'courtesan' | 'shipwright'
  | 'birdhandler' | 'surgeon' | 'hatter' | 'carpenter'
  | 'overseer' | 'guard';

/** Skilled captive professions. Some unlock buildings, some are "skilled only" jobs. */
export const SKILLED_ONLY: Job[] = [
  'gunsmith', 'engineer', 'distiller', 'tobacconist', 'courtesan', 'shipwright', 'birdhandler', 'surgeon', 'hatter', 'carpenter',
];
export const JOB_SEX: Partial<Record<Job, 'M' | 'F'>> = {
  miner: 'M', lumberjack: 'M', smith: 'M', priest: 'M', trader: 'M', gunsmith: 'M', engineer: 'M', shipwright: 'M',
  surgeon: 'M', hatter: 'M', cook: 'F', wench: 'F', server: 'F', distiller: 'F', tobacconist: 'F', courtesan: 'F',
  birdhandler: 'F',
};
export const JOB_NAMES: Record<Job, string> = {
  hauler: 'Hauler', farmer: 'Farmer', builder: 'Builder', miner: 'Miner', lumberjack: 'Lumberjack', smith: 'Blacksmith',
  priest: 'Priest', trader: 'Trader', cook: 'Cook', wench: 'Wench', server: 'Server', gunsmith: 'Gunsmith',
  engineer: 'Engineer', distiller: 'Distiller', tobacconist: 'Tobacconist', courtesan: 'Courtesan',
  shipwright: 'Shipwright', birdhandler: 'Bird Handler', surgeon: 'Surgeon', hatter: 'Hatter', carpenter: 'Carpenter',
  overseer: 'Overseer', guard: 'Guard',
};

export type Category =
  | 'infrastructure' | 'resource' | 'production' | 'entertainment' | 'nautical' | 'control' | 'education'
  | 'defense' | 'accoutrement';
export const CATEGORY_NAMES: Record<Category, string> = {
  infrastructure: 'Infrastructure', resource: 'Resources', production: 'Production', entertainment: 'Entertainment',
  nautical: 'Nautical', control: 'Captive Control', education: 'Education', defense: 'Defense', accoutrement: 'Accoutrements',
};

export type PirateNeed = 'feast' | 'drink' | 'company' | 'gamble' | 'rest' | 'stash';
export type CaptiveNeed = 'food' | 'rest' | 'prayer';
export type AuraKind = 'order' | 'anarchy' | 'fear' | 'defense' | 'awe';

export interface WorkerSlot {
  job: Job;
  count: number;
}
export interface ServiceDef {
  capacity: number;
  needs: Partial<Record<PirateNeed, [number, number]>>; // satisfaction low..high (fraction, may exceed 1)
  bonus: Good[];
  ranks: [number, number];
  fee: [number, number];
  duration: number; // seconds of visit
}
export interface BuildingDef {
  id: string;
  name: string;
  cat: Category;
  gold: number;
  lumber: number;
  upkeep: number;
  size: [number, number];
  unique?: boolean;
  instant?: boolean;
  noRoad?: boolean;
  /** skilled captive professions that must be on the island to build */
  req?: Job[];
  workers: WorkerSlot[];
  haulers?: number;
  /** pirates working on land */
  overseer?: boolean;
  guards?: number;
  recipe?: { in: Partial<Record<Good, number>>; out: Good; time: number };
  /** gather from the land instead of an input recipe */
  gather?: { from: 'trees' | 'ore' | 'fertility' | 'none'; out: Good; time: number; crop?: Good };
  service?: ServiceDef;
  /** captive food / rest / prayer */
  captiveService?: { need: CaptiveNeed; capacity: number; amount: number; consumes?: Good; duration: number };
  auras?: Partial<Record<AuraKind, [number, number]>>;
  storage?: number;
  desc: string;
  /** decorative 1x1 */
  decor?: boolean;
  /** rank-based pirate house */
  house?: boolean;
  /** needs to be on water edge */
  water?: 'dock' | 'shore';
  school?: string;
  starting?: boolean;
  /** construction work in builder-seconds */
  work?: number;
  /** default hiring priority 1..5 */
  priority?: number;
}

export function defaultPriority(d: BuildingDef): number {
  if (d.priority) return d.priority;
  if (d.id === 'chuck_tent' || d.gather?.crop === 'corn') return 5;
  if (d.id === 'construction_tent') return 4;
  if (d.cat === 'entertainment') return 4;
  if (d.id === 'timber_camp' || d.id === 'sawmill' || d.id === 'dock' || d.id === 'ration_factory') return 4;
  return 3;
}

const D = (b: BuildingDef) => b;

export const BUILDINGS: BuildingDef[] = [
  // ---------------------------------------------------------------- Infrastructure
  D({ id: 'road', name: 'Road', cat: 'infrastructure', gold: 0, lumber: 0, upkeep: 0, size: [1, 1], instant: true, noRoad: true, workers: [], desc: 'A dirt track. Nearly every building must touch the road network.' }),
  D({ id: 'construction_tent', name: 'Construction Tent', cat: 'infrastructure', gold: 0, lumber: 0, upkeep: 0, size: [2, 2], instant: true, workers: [{ job: 'builder', count: 5 }], overseer: true, desc: 'Builders from this tent raise every structure on the island. Drop one next to big jobs.' }),
  D({ id: 'chuck_tent', name: 'Chuck Tent', cat: 'infrastructure', gold: 0, lumber: 2, upkeep: 2, size: [2, 2], instant: true, workers: [{ job: 'cook', count: 1 }], haulers: 1, recipe: { in: { corn: 2 }, out: 'slop', time: 10 }, captiveService: { need: 'food', capacity: 7, amount: 0.82, consumes: 'slop', duration: 8 }, storage: 20, desc: 'Turns corn into slop and feeds up to seven captives at once. About one per thirty captives.' }),
  D({ id: 'bunkhouse', name: 'Bunkhouse', cat: 'infrastructure', gold: 0, lumber: 2, upkeep: 1, size: [2, 2], workers: [], captiveService: { need: 'rest', capacity: 5, amount: 0.86, duration: 20 }, desc: 'Beds for five captives. Otherwise they sleep in the dirt.' }),
  D({ id: 'housing_plot', name: 'Pirate Housing Plot', cat: 'infrastructure', gold: 0, lumber: 6, upkeep: 0, size: [3, 3], instant: true, house: true, workers: [], desc: 'A plot of land for one pirate. The house upgrades itself as its owner rises in rank, paid from the pirate\'s own purse.' }),
  D({ id: 'palace', name: 'Pirate Palace', cat: 'infrastructure', gold: 0, lumber: 0, upkeep: 0, size: [9, 6], unique: true, starting: true, workers: [], guards: 4, auras: { order: [69, 3], defense: [27, 3], awe: [40, 3] }, desc: 'Your seat of power. Palace guards defend against rebels and carry out assassinations. Grows grander as your hoard grows.' }),
  D({ id: 'cave', name: 'Pirate Cave', cat: 'infrastructure', gold: 150, lumber: 15, upkeep: 5, size: [3, 3], unique: true, workers: [], desc: 'Hides your personal hoard. A share of every coin that enters the treasury is skimmed here. The hoard is your score.' }),
  D({ id: 'black_market', name: 'Black Market', cat: 'infrastructure', gold: 100, lumber: 20, upkeep: 5, size: [3, 3], unique: true, workers: [{ job: 'trader', count: 2 }], overseer: true, auras: { fear: [47, 4] }, desc: 'Buy sea rations and weapons instantly for your ships, at a price that climbs with every purchase.' }),
  D({ id: 'smugglers_cove', name: "Smuggler's Cove", cat: 'infrastructure', gold: 100, lumber: 20, upkeep: 2, size: [4, 3], unique: true, req: ['trader'], workers: [{ job: 'trader', count: 2 }], overseer: true, haulers: 2, desc: 'Sells surplus goods to any Great Power you open it to. Opening it reveals your island to them.' }),
  D({ id: 'timber_camp', name: 'Timber Camp', cat: 'resource', gold: 0, lumber: 0, upkeep: 1, size: [4, 4], instant: true, workers: [{ job: 'lumberjack', count: 3 }], overseer: true, gather: { from: 'trees', out: 'wood', time: 4.5 }, storage: 30, desc: 'Lumberjacks fell the surrounding trees for logs. Place near dense jungle.' }),
  // ---------------------------------------------------------------- Resource
  D({ id: 'corn_farm', name: 'Corn Farm', cat: 'resource', gold: 0, lumber: 3, upkeep: 1, size: [3, 2], workers: [{ job: 'farmer', count: 4 }], overseer: true, gather: { from: 'fertility', out: 'corn', time: 5, crop: 'corn' }, storage: 40, desc: 'Corn feeds slop, sea rations and beer.' }),
  D({ id: 'banana_farm', name: 'Banana Farm', cat: 'resource', gold: 0, lumber: 3, upkeep: 1, size: [3, 2], req: ['farmer'], workers: [{ job: 'farmer', count: 2 }], overseer: true, gather: { from: 'fertility', out: 'banana', time: 10, crop: 'banana' }, storage: 40, desc: 'Bananas sweeten a pirate\'s meal and make pastries.' }),
  D({ id: 'papaya_farm', name: 'Papaya Farm', cat: 'resource', gold: 0, lumber: 3, upkeep: 1, size: [3, 2], req: ['farmer'], workers: [{ job: 'farmer', count: 2 }], overseer: true, gather: { from: 'fertility', out: 'papaya', time: 10, crop: 'papaya' }, storage: 40, desc: 'Papayas for pirate feasts and pastries.' }),
  D({ id: 'sugar_farm', name: 'Sugarcane Farm', cat: 'resource', gold: 0, lumber: 3, upkeep: 1, size: [3, 2], req: ['farmer'], workers: [{ job: 'farmer', count: 4 }], overseer: true, gather: { from: 'fertility', out: 'sugarcane', time: 7, crop: 'sugarcane' }, storage: 40, desc: 'Sugarcane is distilled into rum.' }),
  D({ id: 'tobacco_farm', name: 'Tobacco Farm', cat: 'resource', gold: 0, lumber: 3, upkeep: 1, size: [3, 2], req: ['farmer'], workers: [{ job: 'farmer', count: 4 }], overseer: true, gather: { from: 'fertility', out: 'tobacco', time: 7, crop: 'tobacco' }, storage: 40, desc: 'Tobacco is rolled into cigars.' }),
  D({ id: 'iron_mine', name: 'Iron Mine', cat: 'resource', gold: 0, lumber: 10, upkeep: 1, size: [4, 3], workers: [{ job: 'miner', count: 3 }], overseer: true, gather: { from: 'ore', out: 'ore', time: 10 }, storage: 30, desc: 'Dig iron ore. Must be built next to a mineral deposit on the hills.' }),
  // ---------------------------------------------------------------- Production
  D({ id: 'sawmill', name: 'Sawmill', cat: 'production', gold: 0, lumber: 20, upkeep: 1, size: [6, 4], starting: true, workers: [{ job: 'lumberjack', count: 2 }], overseer: true, haulers: 1, recipe: { in: { wood: 2 }, out: 'lumber', time: 9 }, storage: 250, desc: 'Saws two logs into one plank of lumber. Lumber builds everything.' }),
  D({ id: 'blast_furnace', name: 'Blast Furnace', cat: 'production', gold: 0, lumber: 20, upkeep: 1, size: [5, 4], workers: [{ job: 'smith', count: 3 }], overseer: true, haulers: 1, recipe: { in: { ore: 2 }, out: 'pigiron', time: 9 }, auras: { defense: [39, 2] }, storage: 30, desc: 'Smelts two loads of ore into one of pig iron.' }),
  D({ id: 'blacksmithy', name: 'Blacksmithy', cat: 'production', gold: 0, lumber: 15, upkeep: 1, size: [3, 3], workers: [{ job: 'smith', count: 2 }], haulers: 1, recipe: { in: { pigiron: 2 }, out: 'cutlass', time: 12 }, auras: { defense: [39, 2] }, storage: 30, desc: 'Forges cutlasses for boarding actions.' }),
  D({ id: 'gunsmithy', name: 'Gunsmithy', cat: 'production', gold: 0, lumber: 20, upkeep: 2, size: [4, 4], req: ['gunsmith'], workers: [{ job: 'gunsmith', count: 2 }], haulers: 1, recipe: { in: { pigiron: 2 }, out: 'musket', time: 14 }, auras: { defense: [39, 2] }, storage: 30, desc: 'Skilled gunsmiths make muskets.' }),
  D({ id: 'cannon_foundry', name: 'Cannon Foundry', cat: 'production', gold: 0, lumber: 25, upkeep: 2, size: [6, 5], req: ['engineer'], workers: [{ job: 'engineer', count: 2 }], haulers: 1, recipe: { in: { pigiron: 2, wood: 2 }, out: 'cannon', time: 18 }, auras: { defense: [39, 2] }, storage: 30, desc: 'Engineers cast cannons from pig iron and logs.' }),
  D({ id: 'brewery', name: 'Brewery', cat: 'production', gold: 0, lumber: 10, upkeep: 2, size: [3, 3], workers: [{ job: 'cook', count: 2 }], haulers: 1, recipe: { in: { corn: 2 }, out: 'beer', time: 9 }, storage: 30, desc: 'Brews corn into beer. Beer makes every drink more satisfying.' }),
  D({ id: 'distillery', name: 'Rum Distillery', cat: 'production', gold: 0, lumber: 25, upkeep: 2, size: [6, 5], req: ['distiller'], workers: [{ job: 'distiller', count: 2 }], haulers: 1, recipe: { in: { sugarcane: 2 }, out: 'rum', time: 10 }, storage: 30, desc: 'Distils sugarcane into fine rum.' }),
  D({ id: 'cigar_factory', name: 'Cigar Factory', cat: 'production', gold: 0, lumber: 20, upkeep: 2, size: [4, 3], req: ['tobacconist'], workers: [{ job: 'tobacconist', count: 2 }], haulers: 1, recipe: { in: { tobacco: 2 }, out: 'cigar', time: 10 }, storage: 30, desc: 'Rolls tobacco into cigars for gamblers and gentlemen.' }),
  D({ id: 'bakery', name: 'Bakery', cat: 'production', gold: 0, lumber: 20, upkeep: 2, size: [3, 3], req: ['cook', 'farmer'], workers: [{ job: 'cook', count: 2 }], haulers: 1, recipe: { in: { banana: 1, papaya: 1 }, out: 'pastry', time: 10 }, storage: 30, desc: 'Bakes banana and papaya pastries.' }),
  // ---------------------------------------------------------------- Entertainment
  D({ id: 'dive', name: "Smuggler's Dive", cat: 'entertainment', gold: 0, lumber: 8, upkeep: 1, size: [3, 2], workers: [{ job: 'server', count: 2 }, { job: 'cook', count: 1 }], haulers: 1, service: { capacity: 6, needs: { drink: [0.24, 0.59], feast: [0.24, 0.51] }, bonus: ['beer', 'banana', 'papaya'], ranks: [1, 5], fee: [0, 10], duration: 12 }, auras: { anarchy: [23, 2] }, storage: 20, desc: 'Cheap grub and grog for the lowest ranks.' }),
  D({ id: 'wench_hut', name: 'Wench & Masseuse', cat: 'entertainment', gold: 0, lumber: 2, upkeep: 1, size: [2, 2], workers: [{ job: 'wench', count: 1 }], service: { capacity: 1, needs: { company: [0.47, 0.78] }, bonus: [], ranks: [1, 5], fee: [0, 10], duration: 12 }, auras: { anarchy: [23, 2] }, desc: 'Companionship for one sailor at a time.' }),
  D({ id: 'animal_pit', name: 'Animal Pit', cat: 'entertainment', gold: 0, lumber: 10, upkeep: 1, size: [3, 3], workers: [{ job: 'server', count: 1 }], service: { capacity: 6, needs: { gamble: [0.39, 0.39] }, bonus: [], ranks: [1, 5], fee: [0, 10], duration: 14 }, auras: { anarchy: [23, 2] }, desc: 'Wager on cockfights and crab races.' }),
  D({ id: 'eatery', name: 'Cheap Eatery', cat: 'entertainment', gold: 0, lumber: 10, upkeep: 2, size: [3, 2], req: ['cook'], workers: [{ job: 'server', count: 2 }, { job: 'cook', count: 1 }], haulers: 1, service: { capacity: 6, needs: { drink: [0.16, 0.43], feast: [0.31, 0.75] }, bonus: ['beer', 'pastry'], ranks: [2, 6], fee: [2, 12], duration: 12 }, auras: { anarchy: [34, 3] }, storage: 20, desc: 'A proper meal for a middling pirate.' }),
  D({ id: 'gambling_den', name: 'Gambling Den', cat: 'entertainment', gold: 0, lumber: 15, upkeep: 2, size: [4, 3], workers: [{ job: 'server', count: 1 }], haulers: 1, service: { capacity: 5, needs: { drink: [0.22, 0.55], gamble: [0.39, 0.65] }, bonus: ['beer', 'cigar'], ranks: [3, 7], fee: [2, 12], duration: 14 }, auras: { anarchy: [34, 3] }, storage: 20, desc: 'Dice, cards and drink.' }),
  D({ id: 'brothel', name: 'Brothel & Salon', cat: 'entertainment', gold: 0, lumber: 30, upkeep: 2, size: [6, 4], req: ['wench'], workers: [{ job: 'wench', count: 5 }], haulers: 1, service: { capacity: 5, needs: { company: [0.57, 1.12] }, bonus: ['cigar'], ranks: [3, 7], fee: [5, 20], duration: 14 }, auras: { anarchy: [34, 3] }, storage: 20, desc: 'A grand house of ill repute.' }),
  D({ id: 'tavern', name: 'Tavern', cat: 'entertainment', gold: 0, lumber: 12, upkeep: 2, size: [3, 3], req: ['server'], workers: [{ job: 'server', count: 3 }], haulers: 1, service: { capacity: 9, needs: { drink: [0.31, 0.94] }, bonus: ['rum', 'beer'], ranks: [4, 8], fee: [5, 20], duration: 12 }, auras: { anarchy: [34, 3] }, storage: 20, desc: 'Serious drinking for serious pirates.' }),
  D({ id: 'inn', name: 'Inn', cat: 'entertainment', gold: 350, lumber: 35, upkeep: 5, size: [5, 4], req: ['server', 'cook'], workers: [{ job: 'server', count: 3 }, { job: 'cook', count: 1 }], haulers: 1, service: { capacity: 12, needs: { drink: [0.2, 0.63], feast: [0.39, 0.98], rest: [0.2, 0.2] }, bonus: ['rum', 'pastry'], ranks: [5, 9], fee: [8, 30], duration: 16 }, auras: { anarchy: [46, 4] }, storage: 20, desc: 'Food, drink and a bed for the pirate elite.' }),
  D({ id: 'casino', name: 'Casino', cat: 'entertainment', gold: 300, lumber: 30, upkeep: 5, size: [5, 4], workers: [{ job: 'server', count: 2 }], haulers: 1, service: { capacity: 8, needs: { drink: [0.24, 0.59], gamble: [0.39, 0.69] }, bonus: ['rum', 'cigar'], ranks: [5, 9], fee: [8, 30], duration: 16 }, auras: { anarchy: [46, 4] }, storage: 20, desc: 'High stakes for high-ranking rogues.' }),
  D({ id: 'courtesan', name: 'Courtesan & Spa', cat: 'entertainment', gold: 0, lumber: 8, upkeep: 2, size: [3, 3], req: ['courtesan'], workers: [{ job: 'courtesan', count: 1 }], haulers: 1, service: { capacity: 1, needs: { company: [0.65, 1.35] }, bonus: ['cigar'], ranks: [5, 9], fee: [8, 30], duration: 16 }, auras: { anarchy: [34, 3] }, storage: 10, desc: 'Refined companionship for pirate lords.' }),
  // ---------------------------------------------------------------- Nautical
  D({ id: 'dock', name: 'Dock', cat: 'nautical', gold: 0, lumber: 5, upkeep: 1, size: [5, 4], water: 'dock', workers: [{ job: 'hauler', count: 2 }], overseer: true, auras: { defense: [35, 2] }, storage: 120, desc: 'Berth for one ship. Dock haulers load rations and weapons aboard.' }),
  D({ id: 'ration_factory', name: 'Sea Ration Factory', cat: 'nautical', gold: 0, lumber: 10, upkeep: 2, size: [4, 4], workers: [{ job: 'cook', count: 2 }], overseer: true, haulers: 1, recipe: { in: { corn: 2 }, out: 'ration', time: 7 }, storage: 60, desc: 'Packs corn into hardtack for long voyages.' }),
  D({ id: 'boatyard', name: 'Boatyard', cat: 'nautical', gold: 0, lumber: 10, upkeep: 2, size: [5, 5], unique: true, water: 'shore', req: ['shipwright'], workers: [{ job: 'shipwright', count: 2 }], auras: { defense: [39, 2] }, desc: 'Builds snows, schooners and sloops.' }),
  D({ id: 'shipyard', name: 'Shipyard', cat: 'nautical', gold: 800, lumber: 30, upkeep: 3, size: [9, 6], unique: true, water: 'shore', req: ['shipwright'], workers: [{ job: 'shipwright', count: 3 }], auras: { defense: [39, 2] }, desc: 'Builds every class of ship, up to the mighty galleon.' }),
  // ---------------------------------------------------------------- Captive control
  D({ id: 'stockade', name: 'Stockade', cat: 'control', gold: 500, lumber: 30, upkeep: 1, size: [5, 5], starting: true, workers: [], captiveService: { need: 'rest', capacity: 15, amount: 0.59, duration: 20 }, auras: { order: [59, 2], fear: [69, 5] }, desc: 'Pens idle captives. Fearsome to behold.' }),
  D({ id: 'church', name: 'Church', cat: 'control', gold: 0, lumber: 18, upkeep: 2, size: [6, 3], req: ['priest'], workers: [{ job: 'priest', count: 3 }], captiveService: { need: 'prayer', capacity: 9, amount: 0.59, duration: 14 }, desc: 'Captives who have been here a while long for prayer.' }),
  D({ id: 'apothecary', name: 'Apothecary', cat: 'control', gold: 0, lumber: 12, upkeep: 2, size: [3, 3], unique: true, req: ['surgeon'], workers: [{ job: 'surgeon', count: 2 }], auras: { order: [47, 4] }, desc: 'Keeps captives healthy and orderly.' }),
  D({ id: 'gallows', name: 'Gallows', cat: 'control', gold: 0, lumber: 20, upkeep: 1, size: [4, 3], unique: true, workers: [], auras: { fear: [47, 4] }, desc: 'A grim reminder to would-be runaways.' }),
  D({ id: 'interrogation', name: 'Interrogation Chamber', cat: 'control', gold: 250, lumber: 25, upkeep: 5, size: [5, 4], unique: true, workers: [], overseer: true, auras: { fear: [86, 4] }, desc: 'The most fearsome building on the island.' }),
  D({ id: 'hotel', name: 'Hotel', cat: 'control', gold: 500, lumber: 50, upkeep: 5, size: [6, 6], workers: [], auras: { order: [31, 2] }, desc: 'Lodging for wealthy captives awaiting ransom. They pay on credit.' }),
  D({ id: 'orderly_shrubs', name: 'Orderly Shrubs', cat: 'control', gold: 0, lumber: 5, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { order: [12, 2] }, desc: 'Neatly trimmed hedges.' }),
  D({ id: 'orderly_decor', name: 'Statue of the King', cat: 'control', gold: 0, lumber: 10, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { order: [24, 3] }, desc: 'Your likeness, looking stern.' }),
  D({ id: 'scary_decor', name: 'Skull Pike', cat: 'control', gold: 0, lumber: 5, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { fear: [12, 2] }, desc: 'Heads on pikes. Captives get the message.' }),
  D({ id: 'very_scary_decor', name: 'Hanging Cage', cat: 'control', gold: 0, lumber: 10, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { fear: [24, 3] }, desc: 'A gibbet with a former resident.' }),
  // ---------------------------------------------------------------- Education
  D({ id: 'school_gunnery', name: 'Gunnery School', cat: 'education', gold: 600, lumber: 40, upkeep: 5, size: [6, 3], unique: true, school: 'gunnery', workers: [], auras: { defense: [35, 3] }, desc: 'Teaches pirates to lay a cannon.' }),
  D({ id: 'school_marksman', name: 'Marksmanship School', cat: 'education', gold: 600, lumber: 40, upkeep: 5, size: [5, 3], unique: true, school: 'marksmanship', workers: [], auras: { defense: [35, 3] }, desc: 'Teaches pirates to shoot straight.' }),
  D({ id: 'school_sword', name: 'Swordsmanship School', cat: 'education', gold: 600, lumber: 40, upkeep: 5, size: [5, 4], unique: true, school: 'swordsmanship', workers: [], auras: { defense: [35, 3] }, desc: 'Teaches the cutlass.' }),
  D({ id: 'school_seaman', name: 'Seamanship School', cat: 'education', gold: 600, lumber: 40, upkeep: 5, size: [4, 4], unique: true, school: 'seamanship', workers: [], auras: { defense: [35, 3] }, desc: 'Teaches knots, sails and handling.' }),
  D({ id: 'school_nav', name: 'Navigation School', cat: 'education', gold: 600, lumber: 40, upkeep: 5, size: [5, 4], unique: true, school: 'navigation', workers: [], auras: { defense: [35, 3] }, desc: 'Teaches stars, charts and the compass.' }),
  // ---------------------------------------------------------------- Defense
  D({ id: 'fort', name: 'Fort', cat: 'defense', gold: 1000, lumber: 60, upkeep: 5, size: [9, 6], req: ['engineer'], workers: [], guards: 4, auras: { defense: [59, 4], fear: [47, 4], awe: [47, 4] }, desc: 'Cannon batteries that repel invasions. Required to raise the Jolly Roger.' }),
  D({ id: 'watch_tower', name: 'Watch Tower', cat: 'defense', gold: 0, lumber: 8, upkeep: 2, size: [2, 2], workers: [], guards: 2, auras: { defense: [47, 2], fear: [47, 2] }, desc: 'Guards keep an eye out for runaways and redcoats.' }),
  D({ id: 'observatory', name: 'Observatory', cat: 'defense', gold: 0, lumber: 20, upkeep: 0, size: [3, 3], unique: true, workers: [], auras: { defense: [59, 4] }, desc: 'A spyglass on the hill. Pirates sleep easier.' }),
  D({ id: 'surgery', name: 'Surgery', cat: 'defense', gold: 0, lumber: 12, upkeep: 2, size: [3, 3], unique: true, req: ['surgeon'], workers: [{ job: 'surgeon', count: 2 }], auras: { anarchy: [46, 4] }, desc: 'Sawbones patch up pirates, no questions asked.' }),
  D({ id: 'protective_cannon', name: 'Protective Cannon', cat: 'defense', gold: 0, lumber: 10, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { defense: [24, 3] }, desc: 'A cannon pointed out to sea.' }),
  D({ id: 'anchor', name: 'Safe Harbor Anchor', cat: 'defense', gold: 0, lumber: 5, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { defense: [12, 2] }, desc: 'A rusting anchor. Comforting.' }),
  D({ id: 'anarchy_decor', name: 'Jolly Roger Pole', cat: 'defense', gold: 0, lumber: 10, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { anarchy: [23, 3] }, desc: 'Flies the black flag. Pirates feel free.' }),
  D({ id: 'anarchy_shrubs', name: 'Wild Shrubs', cat: 'defense', gold: 0, lumber: 5, upkeep: 0, size: [1, 1], decor: true, noRoad: true, instant: true, workers: [], auras: { anarchy: [11, 2] }, desc: 'Overgrown and untamed.' }),
  // ---------------------------------------------------------------- Accoutrement
  D({ id: 'carpenter', name: 'Carpenter', cat: 'accoutrement', gold: 100, lumber: 20, upkeep: 5, size: [4, 2], unique: true, req: ['carpenter'], workers: [{ job: 'carpenter', count: 2 }], gather: { from: 'none', out: 'pegleg', time: 120 }, auras: { fear: [59, 4] }, storage: 10, desc: 'Carves peg legs. A pegleg makes a pirate notorious.' }),
  D({ id: 'hat_shop', name: 'Hat Shop', cat: 'accoutrement', gold: 100, lumber: 20, upkeep: 5, size: [3, 3], unique: true, req: ['hatter'], workers: [{ job: 'hatter', count: 2 }], gather: { from: 'none', out: 'hat', time: 120 }, auras: { order: [59, 4] }, storage: 10, desc: 'Fine tricorns. A good hat makes a leader.' }),
  D({ id: 'aviary', name: 'Parrot Aviary', cat: 'accoutrement', gold: 100, lumber: 20, upkeep: 5, size: [3, 2], unique: true, req: ['birdhandler'], workers: [{ job: 'birdhandler', count: 2 }], gather: { from: 'none', out: 'parrot', time: 120 }, auras: { fear: [59, 4], awe: [59, 4] }, storage: 10, desc: 'Trains parrots. A parrot on the shoulder steadies a pirate\'s nerve.' }),
  D({ id: 'graveyard', name: 'Graveyard', cat: 'accoutrement', gold: 0, lumber: 20, upkeep: 2, size: [3, 2], workers: [], auras: { fear: [47, 4] }, desc: 'Dead pirates rest here... until you need them.' }),
];

export const BUILDING: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/** Construction effort in builder-seconds. */
export function buildWork(d: BuildingDef): number {
  if (d.work) return d.work;
  if (d.instant) return 0;
  return 20 + d.size[0] * d.size[1] * 4 + d.lumber * 1.5 + d.gold * 0.05;
}

export const HOUSE_LEVELS = [
  { rank: 1, name: 'Housing Plot', cost: 0, fee: 0, rest: 0.0, stash: 0.0, anarchy: [0, 1], awe: [4, 2] },
  { rank: 2, name: 'Tent', cost: 20, fee: 5, rest: 0.59, stash: 0.39, anarchy: [3, 1], awe: [16, 2] },
  { rank: 3, name: 'Hovel', cost: 40, fee: 10, rest: 0.63, stash: 0.45, anarchy: [7, 1], awe: [24, 3] },
  { rank: 4, name: 'Shack', cost: 60, fee: 20, rest: 0.67, stash: 0.51, anarchy: [11, 1], awe: [29, 3] },
  { rank: 5, name: 'Adobe', cost: 80, fee: 30, rest: 0.71, stash: 0.57, anarchy: [15, 1], awe: [35, 3] },
  { rank: 6, name: 'Dwelling', cost: 100, fee: 40, rest: 0.75, stash: 0.63, anarchy: [19, 1], awe: [41, 3] },
  { rank: 7, name: 'House', cost: 120, fee: 50, rest: 0.78, stash: 0.69, anarchy: [23, 1], awe: [47, 4] },
  { rank: 8, name: 'Estate', cost: 140, fee: 60, rest: 0.82, stash: 0.75, anarchy: [26, 1], awe: [53, 4] },
  { rank: 9, name: 'Mansion', cost: 160, fee: 70, rest: 0.86, stash: 0.8, anarchy: [38, 1], awe: [59, 4] },
] as const;

export const PALACE_LEVELS = [
  { hoard: 0, order: 69, defense: 27, awe: 30 },
  { hoard: 350, order: 73, defense: 39, awe: 40 },
  { hoard: 1250, order: 76, defense: 51, awe: 50 },
  { hoard: 3500, order: 80, defense: 63, awe: 60 },
] as const;

export const RANKS = [
  { rank: 1, name: 'Scurvy Dog', earn: 0 },
  { rank: 2, name: 'Pirate Lad', earn: 75 },
  { rank: 3, name: 'Rogue', earn: 200 },
  { rank: 4, name: 'Buccaneer', earn: 350 },
  { rank: 5, name: 'Pirate', earn: 550 },
  { rank: 6, name: 'Senior Pirate', earn: 800 },
  { rank: 7, name: 'Pirate Champion', earn: 1100 },
  { rank: 8, name: 'Pirate Master', earn: 1500 },
  { rank: 9, name: 'Pirate Lord', earn: 2000 },
] as const;

export const PRICE_LEVELS = ['Bargain Prices', 'Middling', "Gouge 'Em"] as const;
