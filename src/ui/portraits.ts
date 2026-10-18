/** Parametric illustrated SVG portraits for the advisor, rulers and characters. */

export interface PortraitSpec {
  sex: 'M' | 'F';
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald' | 'tied' | 'curly';
  beard?: 'none' | 'stubble' | 'full' | 'braided' | 'goatee' | 'moustache';
  hat?: 'none' | 'tricorn' | 'bandana' | 'feather' | 'scarf';
  hatColor?: string;
  coat: string;
  shirt?: string;
  eyepatch?: boolean;
  earring?: boolean;
  scar?: boolean;
  bg?: string;
  age?: number; // 0..1 wrinkles
  grin?: boolean;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

let uid = 0;
export function portrait(s: PortraitSpec, size = 96): string {
  const id = `p${uid++}`;
  const skinD = shade(s.skin, 0.78), hairD = shade(s.hair, 0.7), coatD = shade(s.coat, 0.65);
  const bg = s.bg ?? '#3a5a6a';
  const parts: string[] = [];
  parts.push(`<defs>
    <radialGradient id="${id}bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${shade(bg, 1.5)}"/><stop offset="1" stop-color="${shade(bg, 0.6)}"/></radialGradient>
    <radialGradient id="${id}sk" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="${shade(s.skin, 1.08)}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
    <linearGradient id="${id}ct" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.coat}"/><stop offset="1" stop-color="${coatD}"/></linearGradient>
  </defs>`);
  parts.push(`<rect width="100" height="100" fill="url(#${id}bg)"/>`);
  // long hair behind
  if (s.hairStyle === 'long' || s.hairStyle === 'curly') parts.push(`<path d="M27 44 Q24 80 34 92 L66 92 Q76 80 73 44 Z" fill="${hairD}"/>`);
  if (s.hairStyle === 'tied') parts.push(`<path d="M62 50 Q74 62 70 80 Q66 70 60 60Z" fill="${hairD}"/>`);
  // body / coat
  parts.push(`<path d="M12 100 Q14 76 34 70 L66 70 Q86 76 88 100 Z" fill="url(#${id}ct)"/>`);
  parts.push(`<path d="M40 70 L50 88 L60 70 Z" fill="${s.shirt ?? '#ede4cc'}"/>`);
  parts.push(`<path d="M34 70 L46 92 L42 100 M66 70 L54 92 L58 100" stroke="${shade(s.coat, 0.45)}" stroke-width="1.4" fill="none"/>`);
  for (const y of [80, 88, 96]) parts.push(`<circle cx="${43 + (y - 80) * 0.12}" cy="${y}" r="1.4" fill="#d8b040"/>`);
  // neck
  parts.push(`<path d="M43 60 L43 72 Q50 76 57 72 L57 60 Z" fill="${skinD}"/>`);
  // head
  parts.push(`<path d="M33 40 Q33 22 50 21 Q67 22 67 40 L67 50 Q66 56 64 57 Q50 ${s.sex === 'F' ? 72 : 75} 36 57 Q34 56 33 50 Z" fill="url(#${id}sk)" stroke="${shade(s.skin, 0.6)}" stroke-width="0.8"/>`);
  // ears
  parts.push(`<ellipse cx="32.5" cy="45" rx="3" ry="5" fill="${skinD}"/><ellipse cx="67.5" cy="45" rx="3" ry="5" fill="${skinD}"/>`);
  if (s.earring) parts.push(`<circle cx="67.5" cy="51.5" r="2.2" fill="none" stroke="#e0b030" stroke-width="1.3"/>`);
  // eyes
  const eye = (x: number) => `<ellipse cx="${x}" cy="43" rx="3.3" ry="2.2" fill="#f4efe6"/><circle cx="${x + 0.4}" cy="43.2" r="1.6" fill="#2a1a10"/><path d="M${x - 4} 39.5 Q${x} 37.5 ${x + 4} 39.5" stroke="${hairD}" stroke-width="1.8" fill="none"/>`;
  parts.push(eye(43));
  if (s.eyepatch) parts.push(`<path d="M30 36 L70 47" stroke="#111" stroke-width="1.3"/><ellipse cx="57" cy="43.5" rx="5" ry="4" fill="#111"/>`);
  else parts.push(eye(57));
  // nose & mouth
  parts.push(`<path d="M50 44 Q48 51 46.5 53 Q50 55 53.5 53" stroke="${shade(s.skin, 0.62)}" stroke-width="1.2" fill="none"/>`);
  if (s.grin) parts.push(`<path d="M43 59 Q50 65 57 59 Q50 62 43 59 Z" fill="#f2ead8" stroke="#5a2a1a" stroke-width="0.9"/>`);
  else parts.push(`<path d="M44.5 60 Q50 62 55.5 60" stroke="#7a3a2a" stroke-width="1.4" fill="none"/>`);
  if (s.sex === 'F') parts.push(`<path d="M45 60.5 Q50 63.5 55 60.5" stroke="#a03030" stroke-width="2" fill="none"/>`);
  if (s.scar) parts.push(`<path d="M37 47 L42 55" stroke="#8a3a2a" stroke-width="1.2"/>`);
  if ((s.age ?? 0) > 0.5) parts.push(`<path d="M38 50 Q40 52 39 54 M62 50 Q60 52 61 54 M44 34 Q50 33 56 34" stroke="${shade(s.skin, 0.7)}" stroke-width="0.8" fill="none"/>`);
  // beard
  const b = s.beard ?? 'none';
  if (b === 'stubble') parts.push(`<path d="M36 54 Q50 76 64 54 Q60 66 50 68 Q40 66 36 54Z" fill="${hairD}" opacity="0.35"/>`);
  if (b === 'full' || b === 'braided') parts.push(`<path d="M34 50 Q35 70 50 ${b === 'braided' ? 84 : 78} Q65 70 66 50 Q62 58 57 58 Q50 56 43 58 Q38 58 34 50Z" fill="${s.hair}"/><path d="M44 59 Q50 62.5 56 59" stroke="#5a2a1a" stroke-width="1.3" fill="none"/>`);
  if (b === 'braided') parts.push(`<path d="M47 76 L47 90 M53 76 L53 90" stroke="${hairD}" stroke-width="3"/><circle cx="47" cy="90" r="1.6" fill="#c0a040"/><circle cx="53" cy="90" r="1.6" fill="#c0a040"/>`);
  if (b === 'goatee') parts.push(`<path d="M46 62 Q50 72 54 62 Z" fill="${s.hair}"/>`);
  if (b === 'moustache' || b === 'goatee' || b === 'full' || b === 'braided') parts.push(`<path d="M42 57.5 Q46 55 50 57 Q54 55 58 57.5 Q55 60 50 58.5 Q45 60 42 57.5Z" fill="${s.hair}"/>`);
  // hair on top
  if (s.hairStyle !== 'bald') parts.push(`<path d="M32 42 Q30 20 50 18 Q70 20 68 42 Q64 30 50 28 Q36 30 32 42Z" fill="${s.hair}"/>`);
  if (s.hairStyle === 'curly') for (const [x, y] of [[33, 40], [36, 30], [44, 23], [56, 23], [64, 30], [67, 40]]) parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="${s.hair}"/>`);
  // hats
  const hc = s.hatColor ?? '#1a1612';
  if (s.hat === 'tricorn' || s.hat === 'feather') {
    parts.push(`<path d="M18 32 Q50 2 82 32 Q74 28 66 30 Q50 22 34 30 Q26 28 18 32Z" fill="${hc}"/><path d="M30 30 Q50 10 70 30 Q50 26 30 30Z" fill="${shade(hc, 1.35)}"/>`);
    parts.push(`<path d="M18 32 Q50 2 82 32" stroke="#c8a040" stroke-width="1.2" fill="none"/>`);
    if (s.hat === 'feather') parts.push(`<path d="M62 22 Q84 4 90 16 Q78 14 66 26Z" fill="#e8e0d0" stroke="#9a9080" stroke-width="0.7"/>`);
  }
  if (s.hat === 'bandana' || s.hat === 'scarf') {
    parts.push(`<path d="M31 38 Q30 18 50 17 Q70 18 69 38 Q50 30 31 38Z" fill="${hc}"/>`);
    for (const [x, y] of [[40, 26], [50, 23], [60, 27], [45, 32], [56, 32]]) parts.push(`<circle cx="${x}" cy="${y}" r="1.3" fill="#f0e8d8" opacity="0.8"/>`);
    parts.push(`<path d="M68 33 L80 40 L74 43 L69 38Z" fill="${shade(hc, 0.8)}"/>`);
  }
  // frame vignette
  parts.push(`<rect width="100" height="100" fill="none" stroke="#2a1a0a" stroke-width="4"/>`);
  return `<svg class="portrait" width="${size}" height="${size}" viewBox="0 0 100 100">${parts.join('')}</svg>`;
}

export const BARNABY: PortraitSpec = {
  sex: 'M', skin: '#d8a07a', hair: '#cfc8bc', hairStyle: 'tied', beard: 'full', hat: 'bandana', hatColor: '#9a2a20',
  coat: '#4a3a2a', eyepatch: false, earring: true, scar: true, age: 0.8, grin: true, bg: '#4a6a5a',
};

export function parrotSvg(size = 64): string {
  return `<svg class="portrait" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#2a5a4a"/>
  <path d="M30 95 Q28 60 45 40 Q58 28 70 36 Q78 46 70 60 Q64 78 58 95Z" fill="#d02a1a"/>
  <path d="M44 62 Q30 72 34 95 L48 95 Q46 78 52 66Z" fill="#2a5ad0"/>
  <path d="M50 70 Q42 80 44 95 L52 95 Q50 82 56 72Z" fill="#f0c020"/>
  <circle cx="62" cy="42" r="12" fill="#d02a1a"/>
  <ellipse cx="66" cy="40" rx="6" ry="5" fill="#f4f0e8"/><circle cx="67" cy="40" r="2.4" fill="#111"/>
  <path d="M72 44 Q86 44 82 58 Q78 52 72 52Z" fill="#2a2a2a"/><path d="M72 52 Q78 52 79 56 Q74 57 72 54Z" fill="#555"/>
  <path d="M96 0 L96 100" stroke="#5a3a20" stroke-width="6"/><rect width="100" height="100" fill="none" stroke="#2a1a0a" stroke-width="4"/></svg>`;
}

/** portrait specs for the 16 preset rulers */
export const KING_LOOKS: Record<string, PortraitSpec> = {
  bonny: { sex: 'F', skin: '#f0c8a8', hair: '#b8461e', hairStyle: 'curly', hat: 'bandana', hatColor: '#1a3a6a', coat: '#6a2a2a', earring: true, bg: '#5a3a3a' },
  bart: { sex: 'M', skin: '#7a4a2a', hair: '#1a1210', hairStyle: 'short', beard: 'moustache', hat: 'feather', hatColor: '#8a1a1a', coat: '#8a1a1a', earring: true, bg: '#3a2a4a' },
  blackbeard: { sex: 'M', skin: '#d8a882', hair: '#141010', hairStyle: 'long', beard: 'braided', hat: 'tricorn', coat: '#1a1a20', scar: true, bg: '#2a2a3a', grin: true },
  mary: { sex: 'F', skin: '#f2d2b8', hair: '#5a2a14', hairStyle: 'long', hat: 'feather', hatColor: '#2a1a3a', coat: '#4a1a4a', earring: true, bg: '#4a2a3a' },
  calico: { sex: 'M', skin: '#e8b890', hair: '#6a3a1a', hairStyle: 'tied', beard: 'goatee', hat: 'tricorn', hatColor: '#3a2a1a', coat: '#d8c0a0', shirt: '#c84a3a', bg: '#4a5a3a' },
  low: { sex: 'M', skin: '#e0b090', hair: '#2a1a14', hairStyle: 'short', beard: 'stubble', hat: 'tricorn', coat: '#2a2a2a', scar: true, eyepatch: true, bg: '#3a3a3a' },
  deberry: { sex: 'F', skin: '#f0c8a8', hair: '#d8b060', hairStyle: 'long', hat: 'bandana', hatColor: '#2a6a3a', coat: '#2a4a3a', bg: '#3a5a4a' },
  lolonnais: { sex: 'M', skin: '#e0b090', hair: '#3a2410', hairStyle: 'long', beard: 'moustache', hat: 'feather', hatColor: '#1a2a4a', coat: '#1a2a5a', bg: '#2a3a5a' },
  morgan: { sex: 'M', skin: '#e8c0a0', hair: '#4a2a14', hairStyle: 'curly', beard: 'moustache', hat: 'feather', hatColor: '#3a1a10', coat: '#7a1a1a', earring: false, bg: '#5a3a2a', age: 0.5 },
  degraff: { sex: 'M', skin: '#d8a882', hair: '#c89a50', hairStyle: 'tied', beard: 'goatee', hat: 'tricorn', coat: '#2a3a6a', bg: '#3a4a5a' },
  bonnet: { sex: 'M', skin: '#f0d0b8', hair: '#e8e0d0', hairStyle: 'curly', beard: 'none', hat: 'tricorn', hatColor: '#3a2a4a', coat: '#6a4a8a', bg: '#5a4a6a', age: 0.4 },
  read: { sex: 'F', skin: '#e8c0a0', hair: '#2a1a10', hairStyle: 'tied', hat: 'tricorn', coat: '#3a3a2a', scar: true, bg: '#4a4a3a' },
  vanhoorn: { sex: 'M', skin: '#e8c8b0', hair: '#d8c070', hairStyle: 'long', beard: 'full', hat: 'tricorn', coat: '#c0a040', bg: '#5a4a2a' },
  brasiliano: { sex: 'M', skin: '#b07850', hair: '#1a1210', hairStyle: 'curly', beard: 'full', hat: 'bandana', hatColor: '#c08a20', coat: '#5a3a1a', earring: true, grin: true, bg: '#5a3a1a' },
  delahaye: { sex: 'F', skin: '#e8b890', hair: '#a03010', hairStyle: 'curly', hat: 'scarf', hatColor: '#3a1a3a', coat: '#3a1a3a', earring: true, bg: '#3a1a2a' },
  kidd: { sex: 'M', skin: '#e8c0a0', hair: '#5a3a1a', hairStyle: 'long', beard: 'goatee', hat: 'feather', hatColor: '#1a1a1a', coat: '#1a3a2a', bg: '#2a3a2a', age: 0.6 },
};
