import { raw, type Raw } from './dom';

/**
 * Engraved line icons: single-colour strokes in currentColor, with light hatching for shade, so they read as
 * brass inlay on the timber bars and as ink on parchment.
 */
const S = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const T = 'fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" opacity="0.7"';
const F = 'fill="currentColor"';

const P: Record<string, string> = {
  hammer: `<g ${S}><path d="M5.5 20.5l9-9"/><path d="M4 19l1.5 1.5"/><path d="M12 6.5l3-3 6 6-3 3z"/><path d="M15 3.5c-2-1-4.5-.8-6 1l3 2"/></g><g ${T}><path d="M14 6.5l3 3M15.5 5l3 3"/></g>`,
  eye: `<g ${S}><path d="M2.5 12s3.8-6.5 9.5-6.5S21.5 12 21.5 12 17.7 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.3"/></g><circle cx="12" cy="12" r="1.3" ${F}/><g ${T}><path d="M5 8.5l-1.5-2M12 5.5V3M19 8.5l1.5-2"/></g>`,
  scroll: `<g ${S}><path d="M7 4.5h11a2.5 2.5 0 0 1 0 5h-2.5v8.5a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="M5 20.5a2.5 2.5 0 0 1 0-5h2.5V4.5"/><path d="M18 9.5a2.5 2.5 0 0 1-2.5-2.5"/></g><g ${T}><path d="M10 8h3.5M10 10.5h3.5M10 13h3"/></g>`,
  telescope: `<g ${S}><path d="M3.5 13.5l12-6 1.8 3.6-12 6z"/><path d="M17 7l3-1.5 1.5 3-3 1.5"/><path d="M10.5 15.5L7.5 21M11.5 15l3.5 6M11 15.3V21"/><path d="M5.5 12.5l1.8 3.6"/></g>`,
  book: `<g ${S}><path d="M12 6.5c-2-1.5-5-2-8.5-1.5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5z"/><path d="M12 6.5v13"/></g><g ${T}><path d="M6 8.5c1.5-.2 3 0 4 .5M6 11c1.5-.2 3 0 4 .5M6 13.5c1.5-.2 3 0 4 .5M14 9c1-.5 2.5-.7 4-.5M14 11.5c1-.5 2.5-.7 4-.5"/></g>`,
  wheel: `<g ${S}><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4M4.6 4.6l2.8 2.8M16.6 16.6l2.8 2.8M19.4 4.6l-2.8 2.8M7.4 16.6l-2.8 2.8"/></g><g ${F}><circle cx="12" cy="1.8" r="1"/><circle cx="12" cy="22.2" r="1"/><circle cx="1.8" cy="12" r="1"/><circle cx="22.2" cy="12" r="1"/></g>`,
  coin: `<g ${S}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="6.3" stroke-width="0.9"/><path d="M12 8v8M9 9.5l6 5M15 9.5l-6 5" stroke-width="1.3"/></g><g ${T}><path d="M5 9a8 8 0 0 1 3-4M19 15a8 8 0 0 1-3 4"/></g>`,
  lumber: `<g ${S}><circle cx="6" cy="16.5" r="3"/><circle cx="12" cy="16.5" r="3"/><circle cx="9" cy="11.5" r="3"/><path d="M6 13.5h14l1-.5M12 19.5h8.5l.5-.5M9 8.5h11.5l.5.5"/><path d="M21 9v10"/></g><g ${T}><circle cx="6" cy="16.5" r="1.2"/><circle cx="12" cy="16.5" r="1.2"/><circle cx="9" cy="11.5" r="1.2"/></g>`,
  chest: `<g ${S}><path d="M3.5 10.5h17v9h-17z"/><path d="M3.5 10.5V9a8.5 4.5 0 0 1 17 0v1.5"/><path d="M7.5 5.2v14.3M16.5 5.2v14.3"/><path d="M10.5 10.5h3v3.5h-3z"/></g><g ${T}><path d="M4 13h3M4 15.5h3M4 18h3M17 13h3M17 15.5h3M17 18h3"/></g>`,
  skull: `<g ${S}><path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.4 4.3 3 5V19h9v-3.5c1.6-.7 3-2.4 3-5A7.5 7.5 0 0 0 12 3z"/><path d="M10 19v-2M14 19v-2M12 19v-2"/><path d="M11.3 14.5l.7-1.5.7 1.5"/></g><g ${F}><ellipse cx="9" cy="11" rx="1.9" ry="2"/><ellipse cx="15" cy="11" rx="1.9" ry="2"/></g><g ${T}><path d="M3 21l18-2M3 19l18 2"/></g>`,
  pirate: `<g ${S}><circle cx="12" cy="10" r="3.6"/><path d="M5 21c.5-3.8 3.3-6 7-6s6.5 2.2 7 6"/><path d="M5.5 8c2-2.5 4-3.5 6.5-3.5S16.5 5.5 18.5 8c-2-.6-4-.9-6.5-.9S7.5 7.4 5.5 8z"/><path d="M9 9.5l6 2"/></g><circle cx="10.4" cy="10" r="1.1" ${F}/>`,
  captive: `<g ${S}><circle cx="12" cy="8" r="3.6"/><path d="M5.5 19c.5-3.4 3-5.5 6.5-5.5s6 2.1 6.5 5.5"/><circle cx="8.5" cy="20" r="1.8"/><circle cx="15.5" cy="20" r="1.8"/><path d="M10.3 20h3.4"/></g>`,
  ship: `<g ${S}><path d="M3 15.5h18l-2.5 4.5h-13z"/><path d="M12 2.5v13M7.5 5v10.5"/><path d="M12.5 3.5c3 1 5.5 3.5 6 8.5h-6z"/><path d="M8 6c2 .8 3.3 2.5 3.5 5.5H8z"/><path d="M12 2.5l3 1-3 1"/></g><g ${T}><path d="M2 21.5c2 .8 3.5.8 5 0s3-.8 5 0 3.5.8 5 0 3-.8 5 0"/></g>`,
  pause: `<g ${F}><rect x="6.5" y="5" width="3.6" height="14" rx="0.5"/><rect x="13.9" y="5" width="3.6" height="14" rx="0.5"/></g>`,
  play: `<path d="M7.5 5l11 7-11 7z" ${F}/>`,
  fast: `<path d="M3.5 6l8.5 6-8.5 6zM12 6l8.5 6-8.5 6z" ${F}/>`,
  faster: `<path d="M1.5 6.5l7 5.5-7 5.5zM8.5 6.5l7 5.5-7 5.5zM15.5 6.5l7 5.5-7 5.5z" ${F}/>`,
  rotl: `<g ${S} stroke-width="2"><path d="M5 12.5a7 7 0 1 0 2.5-5.4"/><path d="M4 4v4.5h4.5"/></g>`,
  rotr: `<g ${S} stroke-width="2"><path d="M19 12.5a7 7 0 1 1-2.5-5.4"/><path d="M20 4v4.5h-4.5"/></g>`,
  compass: `<g ${S}><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></g><circle cx="12" cy="12" r="1" ${F}/>`,
  shield: `<g ${S}><path d="M12 3l7.5 3v5.5c0 4.8-3.4 8.2-7.5 9.8-4.1-1.6-7.5-5-7.5-9.8V6z"/></g><g ${T}><path d="M12 6v12M8 9.5h8"/></g>`,
  crown: `<g ${S}><path d="M4.5 17.5L3 8l5 4 4-7 4 7 5-4-1.5 9.5z"/><path d="M4.5 20.5h15"/></g><g ${F}><circle cx="12" cy="4.6" r="1"/><circle cx="3" cy="7.6" r="0.9"/><circle cx="21" cy="7.6" r="0.9"/></g>`,
  sprout: `<g ${S}><path d="M12 21v-9.5"/><path d="M12 12.5c0-4-3-6.5-7.5-6.5 0 4.2 3.2 6.5 7.5 6.5z"/><path d="M12 10.5c0-3.8 2.6-6 7-6 0 3.8-2.6 6-7 6z"/><path d="M7 21h10"/></g>`,
  scales: `<g ${S}><path d="M12 3.5v16M8 20.5h8M4.5 7h15"/><path d="M4.5 7L2 13.5h5zM19.5 7L17 13.5h5z"/></g><circle cx="12" cy="3.5" r="1" ${F}/>`,
  pick: `<g ${S}><path d="M5 20.5l8.5-8.5"/><path d="M7.5 5.5c4.5-2.5 10-1.5 12 3-3.5-1.2-6.5-.8-8.5 1z"/></g><g ${T}><path d="M10 6.5l3.5 3.5"/></g>`,
  quill: `<g ${S}><path d="M20.5 3.5C13 4.5 8.5 9.5 6.5 16.5l-1 3 3-1.5c6.5-2.5 11.5-7 12-14.5z"/><path d="M4 21l9.5-10.5"/></g><g ${T}><path d="M10 13.5l3 .5M12 11l3 .3"/></g>`,
  undo: `<g ${S} stroke-width="1.9"><path d="M8.5 5.5L4 10l4.5 4.5"/><path d="M4.5 10h10a5.5 5.5 0 0 1 0 11H11"/></g>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7" ${S} stroke-width="2.4"/>`,
  plus: `<path d="M12 5v14M5 12h14" ${S} stroke-width="2.2"/>`,
  minus: `<path d="M5 12h14" ${S} stroke-width="2.2"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2"/>`,
  road: `<g ${S}><path d="M8.5 2.5L4.5 21.5M15.5 2.5l4 19"/></g><g ${S} stroke-width="1.8"><path d="M12 4v2.5M12 10v3M12 16.5v4"/></g>`,
  bulldoze: `<g ${S}><path d="M4 21l9-9"/><path d="M11 6.5l6.5 6.5"/><path d="M13 4.5l6.5 6.5-2 2L11 6.5z"/><path d="M13 4.5c1-1.5 2.5-2 4-1.5"/></g><g ${T}><path d="M3 9.5l2 1M5.5 6l1 2M2.5 13.5h2.2"/></g>`,
  axe: `<g ${S}><path d="M5 21L15.5 8.5"/><path d="M13 5.5c1.5-2 4.5-3 7-2.5.5 3-.5 6-2.5 7.5L13 5.5z"/><path d="M13 5.5l-1.5 1.5 4.5 4.5 1.5-1.5"/></g><g ${T}><path d="M15.5 6c1-1 2.5-1.6 3.6-1.5M16.5 7.5c1-.8 2-1.2 3-1.1"/></g>`,
  target: `<g ${S}><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></g><circle cx="12" cy="12" r="1.3" ${F}/>`,
  anchor: `<g ${S}><circle cx="12" cy="4.5" r="2"/><path d="M12 6.5V21M8 10h8"/><path d="M4 14c.5 4 3.5 7 8 7s7.5-3 8-7"/><path d="M2.5 15.5L4 13.5l2 1.5M21.5 15.5L20 13.5l-2 1.5"/></g>`,
  bell: `<g ${S}><path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l2 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M12 3.5V5.5"/></g><g ${T}><path d="M8.5 11a3.5 3.5 0 0 1 2-3"/></g>`,
  flag: `<g ${S}><path d="M5 22V2.5"/><path d="M5 3.5c3-1.5 5 1 8 0s4-1 6 0v9c-2-1-3-1-6 0s-5-1.5-8 0"/></g><g ${S} stroke-width="1"><circle cx="12" cy="7.5" r="1.6"/><path d="M10 11l4-1.5M10 9.5l4 1.5"/></g>`,
  gear: `<g ${S}><circle cx="12" cy="12" r="3.3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/><circle cx="12" cy="12" r="6.5"/></g>`,
  follow: `<g ${S}><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6"/></g><circle cx="12" cy="12" r="1.3" ${F}/>`,
  speakerOff: `<g ${S}><path d="M3.5 9.5h3.5l5-4v13l-5-4H3.5z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></g>`,
  speaker: `<g ${S}><path d="M3.5 9.5h3.5l5-4v13l-5-4H3.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></g>`,
  mute: `<g ${S}><path d="M3.5 9.5h3.5l5-4v13l-5-4H3.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></g>`,
  info: `<g ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 10.5V17M10.5 17h3"/></g><circle cx="12" cy="7.3" r="1.1" ${F}/>`,
  heart: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" ${S}/><g ${T}><path d="M7 9.5a2.5 2.5 0 0 1 2-2"/></g>`,
  chain: `<g ${S}><rect x="2.5" y="9" width="9" height="6" rx="3"/><rect x="12.5" y="9" width="9" height="6" rx="3"/><path d="M9 12h6"/></g>`,
};

export function icon(name: string, size = 20, cls = ''): Raw {
  return raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? P.info}</svg>`);
}
