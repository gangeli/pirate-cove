export type ShipType = 'snow' | 'schooner' | 'sloop' | 'brigantine' | 'frigate' | 'galleon';

export interface ShipDef {
  id: ShipType;
  name: string;
  gold: number;
  lumber: number;
  tons: number;
  men: number;
  officers: number;
  speed: number;
  rations: number;
  cutlasses: number;
  muskets: number;
  cannons: number;
  yard: 'boatyard' | 'shipyard';
  /** shipwright-seconds to build */
  work: number;
  model: string;
}

export const SHIPS: Record<ShipType, ShipDef> = {
  snow: { id: 'snow', name: 'Snow', gold: 0, lumber: 20, tons: 90, men: 3, officers: 1, speed: 28, rations: 5, cutlasses: 4, muskets: 4, cannons: 4, yard: 'boatyard', work: 120, model: 'pinnace' },
  schooner: { id: 'schooner', name: 'Schooner', gold: 100, lumber: 30, tons: 90, men: 5, officers: 2, speed: 32, rations: 8, cutlasses: 7, muskets: 7, cannons: 8, yard: 'boatyard', work: 160, model: 'pinnace' },
  sloop: { id: 'sloop', name: 'Sloop', gold: 250, lumber: 50, tons: 100, men: 8, officers: 2, speed: 28, rations: 10, cutlasses: 10, muskets: 10, cannons: 16, yard: 'boatyard', work: 220, model: 'medium' },
  brigantine: { id: 'brigantine', name: 'Brigantine', gold: 500, lumber: 70, tons: 150, men: 8, officers: 2, speed: 26, rations: 30, cutlasses: 10, muskets: 10, cannons: 12, yard: 'shipyard', work: 300, model: 'medium' },
  frigate: { id: 'frigate', name: 'Frigate', gold: 1000, lumber: 125, tons: 360, men: 13, officers: 4, speed: 22, rations: 40, cutlasses: 17, muskets: 17, cannons: 26, yard: 'shipyard', work: 450, model: 'large1' },
  galleon: { id: 'galleon', name: 'Galleon', gold: 1000, lumber: 150, tons: 450, men: 15, officers: 5, speed: 15, rations: 60, cutlasses: 20, muskets: 20, cannons: 40, yard: 'shipyard', work: 520, model: 'large2' },
};
export const SHIP_LIST: ShipType[] = ['snow', 'schooner', 'sloop', 'brigantine', 'frigate', 'galleon'];

export type Mission = 'cruise' | 'raid' | 'kidnap' | 'explore' | 'foster_war';
export type Orders = 'board' | 'pound' | 'harass';
export type Spoils = 'miserly' | 'selfish' | 'generous' | 'bigspender';
export const SPOILS_TREASURY: Record<Spoils, number> = { miserly: 0.8, selfish: 0.6, generous: 0.4, bigspender: 0.2 };
export const SPOILS_NAMES: Record<Spoils, string> = { miserly: 'Miserly', selfish: 'Selfish', generous: 'Generous', bigspender: 'Big Spender' };
export const ORDERS_NAMES: Record<Orders, string> = { board: "Board 'em", pound: "Pound 'em", harass: "Harass 'em" };
export const MISSION_NAMES: Record<Mission, string> = { cruise: 'Cruise', raid: 'Raid Settlement', kidnap: 'Kidnap Craftsman', explore: 'Explore', foster_war: 'Foster a War' };

/** Ships the Great Powers sail. */
export interface PreyDef {
  id: string;
  name: string;
  naval: boolean;
  crew: number;
  cannons: number;
  tons: number;
  speed: number;
  gold: [number, number];
  passengers: number; // chance-weight of wealthy captives
  skilled: number; // chance of skilled captives
}
export const PREY: PreyDef[] = [
  { id: 'fishing_schooner', name: 'Fishing Schooner', naval: false, crew: 6, cannons: 2, tons: 60, speed: 27, gold: [20, 80], passengers: 0, skilled: 0.1 },
  { id: 'brig', name: 'Merchant Brig', naval: false, crew: 10, cannons: 6, tons: 120, speed: 25, gold: [120, 350], passengers: 0.2, skilled: 0.25 },
  { id: 'fluyt', name: 'Fluyt', naval: false, crew: 14, cannons: 8, tons: 250, speed: 20, gold: [300, 800], passengers: 0.35, skilled: 0.35 },
  { id: 'merchant_galleon', name: 'Treasure Galleon', naval: false, crew: 30, cannons: 24, tons: 500, speed: 14, gold: [900, 2600], passengers: 0.6, skilled: 0.4 },
  { id: 'naval_sloop', name: 'Naval Sloop', naval: true, crew: 14, cannons: 14, tons: 110, speed: 29, gold: [40, 160], passengers: 0.05, skilled: 0.45 },
  { id: 'naval_frigate', name: 'Naval Frigate', naval: true, crew: 28, cannons: 30, tons: 380, speed: 23, gold: [100, 400], passengers: 0.1, skilled: 0.5 },
  { id: 'naval_galleon', name: 'Naval Galleon', naval: true, crew: 40, cannons: 44, tons: 480, speed: 16, gold: [300, 900], passengers: 0.15, skilled: 0.5 },
  { id: 'pirate', name: 'Rival Pirate', naval: false, crew: 16, cannons: 12, tons: 120, speed: 28, gold: [100, 600], passengers: 0, skilled: 0.15 },
];
