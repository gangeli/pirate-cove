import type { Rng } from './rng';
import type { Nation } from './data/kings';

const FIRST: Record<Nation, { M: string[]; F: string[] }> = {
  eng: {
    M: ['Jack', 'Tom', 'Will', 'Ned', 'Harry', 'Bart', 'Sam', 'Ben', 'Jem', 'Silas', 'Josiah', 'Nat', 'Abel', 'Caleb', 'Edmund', 'Gideon', 'Hugh', 'Isaac', 'Jonas', 'Kit', 'Luke', 'Matthias', 'Obadiah', 'Percy', 'Roger', 'Simon', 'Walter', 'Zeke', 'George', 'Dick', 'Robin', 'Amos'],
    F: ['Mary', 'Anne', 'Bess', 'Kate', 'Molly', 'Nell', 'Peg', 'Sal', 'Grace', 'Hester', 'Jenny', 'Lizzie', 'Martha', 'Polly', 'Ruth', 'Sukey', 'Tabitha', 'Winnie', 'Agnes', 'Dorothy'],
  },
  fra: {
    M: ['Jean', 'Pierre', 'Louis', 'Jacques', 'Henri', 'François', 'Michel', 'Étienne', 'Gaston', 'Remy', 'Antoine', 'Baptiste', 'Claude', 'Denis', 'Gilles', 'Hugo', 'Luc', 'Mathieu', 'Olivier', 'René'],
    F: ['Marie', 'Jeanne', 'Margot', 'Colette', 'Isabeau', 'Louise', 'Madeleine', 'Nicole', 'Sophie', 'Agathe', 'Blanche', 'Céleste', 'Elise', 'Fleur', 'Odette'],
  },
  spa: {
    M: ['Diego', 'Juan', 'Pedro', 'Miguel', 'Carlos', 'Rodrigo', 'Esteban', 'Alonso', 'Fernando', 'Gaspar', 'Ignacio', 'Lope', 'Mateo', 'Nicolás', 'Pablo', 'Ramón', 'Santiago', 'Tomás', 'Vicente', 'Xavier'],
    F: ['María', 'Isabel', 'Juana', 'Catalina', 'Inés', 'Lucía', 'Beatriz', 'Elena', 'Leonor', 'Marta', 'Paloma', 'Rosa', 'Teresa', 'Ana', 'Constanza'],
  },
};
const LAST: Record<Nation, string[]> = {
  eng: ['Black', 'Flint', 'Hawkins', 'Morgan', 'Teach', 'Rackham', 'Vane', 'Kidd', 'Avery', 'Hornigold', 'Gow', 'Low', 'Smith', 'Cooper', 'Fletcher', 'Turner', 'Barlow', 'Crowe', 'Dunn', 'Grimes', 'Hatch', 'Ives', 'Knox', 'Marsh', 'Pike', 'Quill', 'Rook', 'Shaw', 'Thorne', 'Wick'],
  fra: ['Leclerc', 'Dubois', 'Moreau', 'Laurent', 'Girard', 'Bonnet', 'Fournier', 'Lambert', 'Rousseau', 'Mercier', 'Blanchard', 'Chevalier', 'Duval', 'Faure', 'Gautier', 'Lefèvre', 'Marchand', 'Picard', 'Renard', 'Vidal'],
  spa: ['García', 'Morales', 'Vega', 'Castillo', 'Navarro', 'Ortega', 'Ramos', 'Serrano', 'Torres', 'Delgado', 'Fuentes', 'Herrera', 'Ibarra', 'Lozano', 'Medina', 'Pacheco', 'Quintero', 'Rivas', 'Salazar', 'Valdés'],
};
const NICK = ['One-Eye', 'Peg-Leg', 'Red', 'Mad', 'Black', 'Lucky', 'Salty', 'Bloody', 'Gentleman', 'Long', 'Iron', 'Silver', 'Stinky', 'Dead-Eye', 'Calico', 'Barnacle', 'Bilge', 'Crooked', 'Toothless', 'Squint'];

export function personName(rng: Rng, nat: Nation, sex: 'M' | 'F', pirate: boolean): string {
  const f = rng.pick(FIRST[nat][sex]);
  const l = rng.pick(LAST[nat]);
  if (pirate && rng.chance(0.3)) return `${rng.pick(NICK)} ${f}`;
  return `${f} ${l}`;
}

export const CAPTAIN_NAMES = [
  'Edward England', 'Charles Vane', 'Thomas Tew', 'Henry Every', 'Benjamin Hornigold', 'Sam Bellamy', 'Howell Davis',
  'Christopher Condent', 'Olivier Levasseur', 'Michel de Grammont', 'Jean Lafitte', 'Pierre le Grand', 'Bartholomew Sharp',
  'Edward Teach', 'Paulsgrave Williams', 'John Taylor', 'George Lowther', 'Francis Spriggs', 'Walter Kennedy',
  'Thomas Anstis', 'Richard Worley', 'Diego Grillo', 'Miguel Enríquez', 'Juan Corso', 'Emanuel Wynn', 'Jean Fleury',
];

export const SHIP_NAMES = [
  'Sea Wolf', 'Black Gull', 'Revenge', 'Fancy', 'Ranger', 'Whydah', 'Royal Fortune', 'Adventure', 'Delight', 'Scowrer',
  'Rover', 'Happy Return', 'Bloody Mary', 'Kingfisher', 'Night Heron', 'Salty Kate', 'Gilded Shark', 'Crimson Tide',
  'Dread Albatross', 'Lucky Strike', 'Widow\'s Wail', 'Golden Hind', 'Mermaid\'s Kiss', 'Storm Petrel', 'Black Swan',
  'Cutthroat', 'Devil\'s Due', 'Silver Eel', 'Jolly Wench', 'Grim Reaper',
];

export const ENTERTAINMENT_NAMES = [
  'The Rusty Anchor', 'The Drowned Rat', 'The Salty Dog', 'The Leaky Bucket', 'The Gilded Gull', 'The Bilge & Barrel',
  'The Spotted Parrot', 'The Kraken\'s Arms', 'The Mermaid\'s Tail', 'The Jolly Corsair', 'The Crow\'s Nest', 'The Sunken Crown',
  'The Brass Monkey', 'The One-Eyed Cat', 'The Powder Keg', 'The Wet Whistle', 'The Gallows Rest', 'The Black Cormorant',
];
