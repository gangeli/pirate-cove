import type { Good } from './data/goods';
import type { Job, PirateNeed, CaptiveNeed } from './data/buildings';
import type { Nation, Background, Quality, Flaw } from './data/kings';
import type { ShipType, Mission, Orders, Spoils } from './data/ships';

export type Kind = 'pirate' | 'captive' | 'wealthy' | 'skeleton' | 'soldier';

export type Activity =
  | 'idle' | 'walk' | 'work' | 'haul' | 'build' | 'visit' | 'eat' | 'sleep' | 'pray' | 'stash' | 'school'
  | 'board' | 'atsea' | 'escape' | 'chase' | 'rebel' | 'fight' | 'dead' | 'guard' | 'wander' | 'party' | 'flee';

export interface Skills {
  gunnery: number;
  swordsmanship: number;
  marksmanship: number;
  seamanship: number;
  navigation: number;
}
export interface Traits {
  courage: number;
  leadership: number;
  notoriety: number;
  loyalty: number;
}

export interface Task {
  kind: Activity;
  bld?: number; // target building id
  /** for haul: source building, good, amount carried */
  src?: number;
  good?: Good;
  amount?: number;
  need?: PirateNeed | CaptiveNeed;
  timer?: number;
  /** chase/fight target person */
  target?: number;
  /** walk destination tile */
  tx?: number;
  ty?: number;
  /** phase of multi-step task */
  phase?: number;
}

export interface Person {
  id: number;
  kind: Kind;
  sex: 'M' | 'F';
  name: string;
  nat: Nation;
  age: number;
  x: number;
  y: number;
  /** facing radians, for renderer */
  dir: number;
  path: number[] | null;
  pathI: number;
  /** waiting (with an empty `path`) for this PathService handle (async path finding only) */
  pathReq?: number;
  /** the tile index that request is for */
  pathGoal?: number;
  task: Task;
  /** queued tasks (e.g. walk then act) */
  arrived: number; // game time arrived on island
  // ---- needs (immediate 0..1)
  needs: Record<string, number>;
  /** long term opinion 0..1 */
  opinion: Record<string, number>;
  /** environmental aura levels the person has absorbed */
  env: { order: number; fear: number; awe: number; defense: number };
  // ---- pirate
  gold: number;
  earned: number;
  rank: number;
  skills: Skills;
  traits: Traits;
  weights: Partial<Record<PirateNeed, number>>;
  home: number; // house building id or 0
  ship: number; // ship id or 0
  shoreJob: number; // building id where overseer/guard
  shoreRole?: 'overseer' | 'guard';
  captain?: boolean;
  voyages?: number; // voyages commanded and brought home (captains)
  officer?: boolean;
  stashed: number;
  lastStash: number;
  haunts: Partial<Record<PirateNeed, number>>; // building ids
  mood: 'ok' | 'disgruntled' | 'enraged';
  accessories: { pegleg?: boolean; hat?: boolean; parrot?: boolean };
  happiness: number;
  // ---- captive
  profession: Job | 'none'; // skilled profession or 'none' for unskilled
  skilled: boolean;
  jobSkill: Partial<Record<Job, number>>; // learned levels 0..5
  job: number; // workplace building id
  jobRole?: Job;
  resignation: number;
  ransom: number;
  /** wealthy captive credit */
  credit: number;
  escapeCooldown: number;
  hp: number;
  /** visual: carried good */
  carrying?: Good;
  thoughts: string[];
  /** number keys */
  hotkey?: number;
  // misc flags
  rebel?: boolean;
  dyingTimer?: number;
}

export interface Building {
  id: number;
  def: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number; // 0..3
  door: [number, number];
  /** 0..1 construction progress; 1 = complete */
  built: number;
  condemned?: boolean;
  priority: number; // 1..5 hiring priority
  wage: number; // overseer/guard wage per month
  workers: number[]; // person ids (captives)
  /** closed worker places not tied to a row (older saves, fired overseers and guards): spread over the rows' vacancies in order */
  blocked: number;
  /** closed places in each worker row (index = the row in the building's `workers`), from the right-hand end */
  shut?: number[];
  haulers: number[];
  overseer: number; // person id
  guards: number[];
  /** visiting customers (person ids) incl. reserved */
  customers: number[];
  inv: Partial<Record<Good, number>>;
  progress: number; // production progress 0..1
  /** entertainment settings */
  quality: number; // rank band offset 0..4
  price: number; // 0..2
  name?: string;
  /** house owner */
  owner?: number;
  houseLevel?: number;
  /** dock: ship docked */
  ship?: number;
  /** yard: ship under construction */
  building_ship?: { type: ShipType; progress: number };
  /** income tracking this month and last */
  income: number;
  lastIncome: number;
  /** remaining trees for timber camp */
  hp: number;
  /** effectiveness 0..1 last month (staffing) */
  staff: number;
  /** school students */
  students?: number[];
}

export interface Ship {
  id: number;
  type: ShipType;
  name: string;
  dock: number; // building id, 0 if at sea or anchored
  captain: number; // person id, 0 none
  crew: number[]; // person ids (officers first)
  officers: number[];
  hull: number; // 0..1
  rations: number;
  cutlasses: number;
  muskets: number;
  cannons: number;
  mission: Mission;
  orders: Orders;
  spoils: Spoils;
  region: number;
  status: 'docked' | 'boarding' | 'departing' | 'atsea' | 'returning' | 'repairing' | 'building' | 'lost';
  /** at-sea timeline */
  voyage?: Voyage;
  /** craftsman requested for kidnap */
  kidnapJob?: Job;
  foster?: Nation;
  bell?: number; // time bell rang
  /** visual position when sailing in/out */
  vx: number;
  vy: number;
  vdir: number;
  log: LogEntry[];
  enemyNat?: Nation;
  /** game time of her last departure on a voyage */
  sailed?: number;
}

export interface Voyage {
  t: number; // time since departure
  out: number; // transit time out
  station: number; // planned time on station
  back: number;
  rationRate: number;
  events: VoyageEvent[];
  loot: { gold: number; captives: number; skilled: Job[]; wealthy: number; recruits: number; cannons: number };
  /** exploring: the sea charted and the towns and trade routes found there (for the homecoming letter and voice) */
  charted?: { sea: string; found: string[] };
  lost: boolean;
  sunk: boolean;
  nextEncounter: number;
}
export interface VoyageEvent {
  t: number;
  text: string;
}
export interface LogEntry {
  date: string;
  text: string;
}

export interface Region {
  id: number;
  name: string;
  x: number;
  y: number;
  neighbors: number[];
  merchant: Record<Nation, number>; // 0..1 traffic
  naval: Record<Nation, number>;
  pirates: number;
  settlements: { type: 'farmstead' | 'trade' | 'military'; nat: Nation; name: string; found: boolean; raided: number }[];
  tradeRoute: boolean;
  routeFound: boolean;
  knowledge: number; // 0..5
  heat: number; // recent attacks, raises naval presence
}

export interface NationState {
  relation: number; // -100..100
  knows: boolean; // knows island location
  peace: boolean;
  peaceBroken: number;
  plunderGold: number;
  plunderCaptives: number;
  invasion: {
    stage: 0 | 1 | 2 | 3; timer: number; strength: number;
    /** how the landing went, for the letter that ends it (display only: the sim never reads it back) */
    tally?: { ships: number; soldiers: number; sunk: number; landed: number; piratesDied0: number };
  };
  reserve: number; // naval reserve pool
  atWarWith: Nation[];
}

export interface Message {
  id: number;
  t: number;
  date: string;
  kind: 'info' | 'good' | 'bad' | 'advisor' | 'ship' | 'alert';
  title: string;
  text: string;
  /** voice line key */
  voice?: string;
  focus?: { x: number; y: number };
  modal?: boolean;
  read?: boolean;
  /** what the letter reports, for the UI to draw (never read by the sim) */
  data?: MessageData;
}

/** structured contents of a letter, for the UI to draw as icons: a ship's homecoming, or any other event as a row of facts */
export type MessageData = VoyageData | EventData;

/** everything else that happens, as things the UI can draw: coins, figures, flags, ships, goods */
export type EventData = { kind: 'event'; facts: Fact[] };

/** who a row of figures shows */
export type FolkKind = 'pirate' | 'captive' | 'wealthy' | 'soldier' | 'skeleton' | 'captain' | 'guard';

export type Fact =
  /** gold earned (n > 0) or spent (n < 0) */
  | { t: 'gold'; n: number }
  /** n people: arrived, died, ran off, taken prisoner, freed, rose up, went back to work; a single one may carry a name or a trade */
  | { t: 'folk'; who: FolkKind; n: number; fate?: 'new' | 'dead' | 'gone' | 'taken' | 'freed' | 'rebel' | 'back' | 'hanged'; name?: string; skill?: string }
  /** a Great Power: its relation change, whether it now knows where the island is, its stance toward you or `vs` another Power */
  | { t: 'nation'; nat: Nation; rel?: number; knows?: boolean; stance?: 'war' | 'peace' | 'patron' | 'invade' | 'calm' | 'foe' | 'rumour' | 'fleet'; vs?: Nation }
  /** ships: yours (named) or a Power's; what became of them */
  | { t: 'ship'; n?: number; name?: string; type?: string; nat?: Nation; fate: 'new' | 'sail' | 'home' | 'sunk' | 'lost' | 'fled' | 'enemy'; mission?: string }
  /** a good made (n > 0), used up (n < 0) or wanted (n = 0) */
  | { t: 'good'; good: string; n: number }
  /** the pirates' or captives' mood: a change (d) or the level (v, 0..1) */
  | { t: 'mood'; who: 'pirate' | 'captive'; d?: number; v?: number; need?: string }
  /** an edict put in force or repealed */
  | { t: 'edict'; id: string; on: boolean; nat?: Nation }
  /** a building finished */
  | { t: 'building'; def: string }
  /** hands mustered against hands needed */
  | { t: 'crew'; have: number; need: number }
  /** the final reckoning */
  | { t: 'score'; total: number; medal: string; hoard: number; pirates: number; fleet: number; captains: number; happiness: number; win: boolean };

/** a ship's homecoming */
export type VoyageData = {
  kind: 'voyage';
  /** a voyage of exploration: the sea it charted and what it found there */
  charted?: { sea: string; found: string[] };
  ship: string;
  mission: string;
  gold: number;
  treasury: number;
  captives: number;
  skilled: string[];
  wealthy: number;
  recruits: number;
  cannons: number;
  hull: number;
  log: { date: string; text: string }[];
};

export interface KingState {
  name: string;
  sex: 'M' | 'F';
  nat: Nation;
  bg: Background;
  q: Quality[];
  flaw: Flaw;
  portrait: string;
}

export interface Settings {
  seed: number;
  size: 'small' | 'medium' | 'large';
  mountains: number;
  vegetation: number;
  minerals: number;
  years: number;
  stability: number; // 1..5 (1 easiest)
  advantage: 'botany_bay' | 'standard' | 'shipwreck' | 'skeleton_island' | 'bare_bones';
  bonus: 'hoard' | 'happiness' | 'fleet' | 'captains' | 'pirates';
  region: number;
  startGold: number;
  /** varies the island shape when a seed's coast cannot host the starting dock */
  /** the ship the colony starts with */
  startShip?: 'none' | 'snow' | 'schooner' | 'sloop';
  mapSalt?: number;
}
