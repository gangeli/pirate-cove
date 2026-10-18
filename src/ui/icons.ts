import { raw, type Raw } from './dom';

const P: Record<string, string> = {
  hammer: '<path d="M14 3l7 7-2 2-2-2-9 9a2.1 2.1 0 0 1-3-3l9-9-2-2z" fill="currentColor"/><path d="M11 3h5l5 5" stroke="currentColor" stroke-width="1.5" fill="none"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  scroll: '<path d="M6 4h11a3 3 0 0 1 0 6h-1v8a3 3 0 0 1-3 3H5a3 3 0 0 1 0-6h1z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9h5M9 13h5" stroke="currentColor" stroke-width="1.6"/>',
  telescope: '<path d="M3 14l14-7 2 4-14 7z" fill="currentColor"/><path d="M19 7l2-1 1 3-2 1M9 15l-3 7M11 14l3 8" stroke="currentColor" stroke-width="2" fill="none"/>',
  book: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z" fill="none" stroke="currentColor" stroke-width="2"/>',
  wheel: '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5M4 4l3.5 3.5M16.5 16.5L20 20M20 4l-3.5 3.5M7.5 16.5L4 20" stroke="currentColor" stroke-width="2"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="#e8b830" stroke="#8a5a10" stroke-width="1.5"/><circle cx="12" cy="12" r="6" fill="none" stroke="#a87418" stroke-width="1.2"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" stroke="#8a5a10" stroke-width="1.3" fill="none"/>',
  lumber: '<rect x="2" y="6" width="20" height="4" rx="1" fill="#b07a40" stroke="#5a3a18"/><rect x="2" y="11" width="20" height="4" rx="1" fill="#c08a50" stroke="#5a3a18"/><rect x="2" y="16" width="20" height="4" rx="1" fill="#a06a30" stroke="#5a3a18"/>',
  chest: '<rect x="3" y="9" width="18" height="11" rx="1" fill="#8a5a28" stroke="#3a2210"/><path d="M3 9a9 5 0 0 1 18 0z" fill="#a06a30" stroke="#3a2210"/><rect x="10" y="11" width="4" height="4" fill="#e8b830" stroke="#6a4a10"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 3 2 5 3 5v3h10v-3c1 0 3-2 3-5a8 8 0 0 0-8-8z" fill="#efe6d0" stroke="#3a3020"/><circle cx="9" cy="11" r="2" fill="#2a2018"/><circle cx="15" cy="11" r="2" fill="#2a2018"/><path d="M11 15h2" stroke="#2a2018" stroke-width="2"/>',
  pirate: '<circle cx="12" cy="9" r="4" fill="currentColor"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7z" fill="currentColor"/><path d="M6 7c2-4 10-4 12 0z" fill="#a02020"/>',
  captive: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7z" fill="currentColor"/><circle cx="8" cy="20" r="2" fill="none" stroke="#666" stroke-width="1.5"/><circle cx="16" cy="20" r="2" fill="none" stroke="#666" stroke-width="1.5"/>',
  ship: '<path d="M3 15h18l-3 5H6z" fill="#6a4020"/><path d="M12 2v13" stroke="#3a2210" stroke-width="1.5"/><path d="M12 3c4 2 6 5 6 10h-6z" fill="#efe6d0"/><path d="M12 5c-3 2-5 4-6 8h6z" fill="#e0d6c0"/>',
  pause: '<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  fast: '<path d="M3 6l9 6-9 6zM12 6l9 6-9 6z" fill="currentColor"/>',
  faster: '<path d="M1 6l7 6-7 6zM8 6l7 6-7 6zM15 6l7 6-7 6z" fill="currentColor"/>',
  rotl: '<path d="M4 12a8 8 0 1 0 3-6.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M3 3v6h6" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  rotr: '<path d="M20 12a8 8 0 1 1-3-6.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="3"/>',
  minus: '<path d="M4 12h16" stroke="currentColor" stroke-width="3"/>',
  close: '<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="3"/>',
  road: '<path d="M8 2L4 22M16 2l4 20" stroke="currentColor" stroke-width="2.5"/><path d="M12 3v3M12 10v4M12 18v3" stroke="currentColor" stroke-width="2"/>',
  bulldoze: '<path d="M3 15h12v4H3zM15 12l5-5 2 2-5 5" fill="currentColor"/><circle cx="6" cy="20" r="1.5" fill="currentColor"/><circle cx="12" cy="20" r="1.5" fill="currentColor"/><path d="M4 15V10h7l2 5" fill="none" stroke="currentColor" stroke-width="2"/>',
  axe: '<path d="M4 20L16 8" stroke="#6a4020" stroke-width="3"/><path d="M13 4c4 0 7 3 7 7l-5-2-3-3z" fill="#9aa0a8" stroke="#3a3a40"/>',
  target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  anchor: '<circle cx="12" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v14M7 11h10M4 15c1 4 4 6 8 6s7-2 8-6" fill="none" stroke="currentColor" stroke-width="2"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z" fill="currentColor"/><circle cx="12" cy="21" r="1.8" fill="currentColor"/>',
  flag: '<path d="M5 22V3" stroke="currentColor" stroke-width="2"/><path d="M5 4h13l-3 4 3 4H5z" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" stroke-width="2.4"/>',
  follow: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" stroke-width="2"/>',
  speaker: '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2"/>',
  mute: '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v7M12 6.5v1" stroke="currentColor" stroke-width="2.4"/>',
  heart: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z" fill="currentColor"/>',
  chain: '<rect x="3" y="9" width="9" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="12" y="9" width="9" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>',
};

export function icon(name: string, size = 20, cls = ''): Raw {
  return raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? P.info}</svg>`);
}
