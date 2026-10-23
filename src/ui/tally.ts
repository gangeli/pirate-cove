import { html, raw, fmt, type Raw } from './dom';
import { icon, goodIcon, nationFlag } from './icons';
import { JOB_NAMES, BUILDING } from '../sim/data/buildings';
import { GOOD_NAMES } from '../sim/data/goods';
import { NATION_ADJ, NATION_NAMES } from '../sim/data/kings';
import { SHIPS } from '../sim/data/ships';
import { EDICT } from '../sim/data/edicts';
import type { EventData, Fact, FolkKind, Message, VoyageData } from '../sim/types';

/**
 * A voyage's results at a glance: gold as a coin pile sized by the haul (with the treasury's chest share),
 * one figure per recruit, captive or hostage, profession badges for the skilled, crossed-out figures for the
 * dead and a plank for the hull. The ship's log folds away underneath.
 */

/** coins heaped in a pile: more coins for a bigger haul (log scale, 1 to 9) */
function coinPile(gold: number): Raw {
  const n = gold <= 0 ? 0 : Math.max(1, Math.min(9, Math.round(Math.log10(gold + 1) * 3 - 2)));
  // rows of the heap from the bottom: 4, 3, 2 coins
  const spots: [number, number][] = [[6, 30], [16, 30], [26, 30], [36, 30], [11, 24], [21, 24], [31, 24], [16, 18], [26, 18]];
  const discs = spots.slice(0, n).map(([x, y]) => `<ellipse cx="${x + 5}" cy="${y}" rx="6.5" ry="2.6" fill="#e8c768" stroke="#6a4a10"/><path d="M${x - 1.5} ${y}v1.6c0 1.4 2.9 2.6 6.5 2.6s6.5-1.2 6.5-2.6V${y}" fill="#b88a2a" stroke="#6a4a10"/>`).join('');
  return raw(`<svg class="pile" width="52" height="38" viewBox="0 0 52 38" aria-hidden="true">${discs}</svg>`);
}

/** n figures of a kind, up to `cap`, then "+k" */
function figures(ic: string, n: number, cls = '', cap = 10): Raw {
  const shown = Math.min(n, cap);
  return html`<span class="figs ${cls}">${Array.from({ length: shown }, () => icon(ic, 18))}${n > cap ? html`<b>+${n - cap}</b>` : ''}</span>`;
}

/** men lost, read from the ship's log ("... Lost 2 men.") */
function deaths(d: VoyageData): number {
  let n = 0;
  for (const e of d.log) {
    const m = /Lost (\d+) m[ae]n/.exec(e.text);
    if (m) n += +m[1];
  }
  return n;
}

export function voyageStrip(d: VoyageData, withLog = true): Raw {
  const dead = deaths(d);
  const items = [];
  if (d.gold) items.push(html`<div class="tally gold" data-tip="${fmt(d.gold)} gold in all: ${fmt(d.treasury)} to the treasury, ${fmt(d.gold - d.treasury)} shared by the crew">${coinPile(d.gold)}<div><b class="amt">${fmt(d.gold)}</b><small>${icon('chest', 13)} ${fmt(d.treasury)} · ${icon('pirate', 13)} ${fmt(d.gold - d.treasury)}</small></div></div>`);
  if (d.recruits) items.push(html`<div class="tally" data-tip="${d.recruits} new recruits joined the crews">${figures('pirate', d.recruits, 'ok')}<small>Recruits</small></div>`);
  if (d.captives) items.push(html`<div class="tally" data-tip="${d.captives} captives brought back to work the island">${figures('captive', d.captives)}<small>Captives</small></div>`);
  if (d.skilled.length) items.push(html`<div class="tally" data-tip="Skilled captives: ${d.skilled.map((j) => JOB_NAMES[j as keyof typeof JOB_NAMES] ?? j).join(', ')}"><span class="skills">${d.skilled.map((j) => html`<span class="chip ok">${icon('book', 12)} ${JOB_NAMES[j as keyof typeof JOB_NAMES] ?? j}</span>`)}</span><small>Skilled</small></div>`);
  if (d.wealthy) items.push(html`<div class="tally" data-tip="${d.wealthy} wealthy hostages to ransom">${figures('crown', d.wealthy, 'brass')}<small>Hostages</small></div>`);
  if (d.cannons) items.push(html`<div class="tally" data-tip="${d.cannons} cannons taken">${figures('g_cannon', d.cannons)}<small>Cannons</small></div>`);
  if (dead) items.push(html`<div class="tally" data-tip="${dead} men lost at sea">${figures('pirate', dead, 'dead')}<small>Lost</small></div>`);
  const hull = Math.round(d.hull * 100);
  items.push(html`<div class="tally" data-tip="Hull ${hull}%"><span class="hull ${hull < 60 ? 'bad' : ''}"><i style="width:${hull}%"></i></span><small>Hull ${hull}%</small></div>`);
  // a voyage of exploration brings home charts: the sea, and a pin for each town or trade route found there
  if (d.charted) items.unshift(html`<div class="tally" data-tip="Charted the ${d.charted.sea}${d.charted.found.length ? ': ' + d.charted.found.join(', ') : ''}"><span class="figs">${icon('telescope', 22)}${d.charted.found.map(() => icon('flag', 14))}</span><small>${d.charted.sea}${d.charted.found.length ? ` · ${d.charted.found.length} found` : ''}</small></div>`);
  else if (!d.gold && !d.recruits && !d.captives && !d.skilled.length && !d.wealthy) items.unshift(html`<div class="tally empty"><span class="figs">${icon('ship', 22)}</span><small>Nothing but sunburn</small></div>`);
  return html`<div class="tallies">${items}</div>
    ${withLog && d.log.length ? html`<details class="vlog"><summary>${icon('book', 14)} Ship's log <i>(${d.log.length})</i></summary><ol class="log">${d.log.map((e) => html`<li><i>${e.date}</i> ${logIcon(e.text)} ${e.text}</li>`)}</ol></details>` : ''}`;
}

/** a small glyph for a log line, by what happened */
function logIcon(t: string): Raw {
  if (/^(Took|Sank)/.test(t)) return icon('flag', 13);
  if (/cut and ran|Outgunned|lost|sank us/i.test(t)) return icon('skull', 13);
  if (/charted|explor|sighted/i.test(t)) return icon('telescope', 13);
  return icon('ship', 13);
}

// ------------------------------------------------------------------------------------------------ other letters

/** building thumbnails, when the app has a renderer to draw them (set once at start-up) */
let thumbOf: ((def: string) => string | null) | null = null;
export function useThumbs(fn: (def: string) => string | null): void {
  thumbOf = fn;
}
/** a building's thumbnail, if one is drawn yet */
export function buildingThumb(def: string): string | null {
  return thumbOf?.(def) ?? null;
}

const FOLK: Record<FolkKind, [string, string, string]> = {
  // icon, one, many
  pirate: ['pirate', 'Pirate', 'Pirates'], captive: ['captive', 'Captive', 'Captives'], wealthy: ['crown', 'Hostage', 'Hostages'],
  soldier: ['soldier', 'Soldier', 'Soldiers'], skeleton: ['skull', 'Skeleton', 'Skeletons'], captain: ['captain', 'Captain', 'Captains'], guard: ['shield', 'Guard', 'Guards'],
};
const FATE: Record<string, [string, string]> = {
  // figure class, caption
  new: ['ok', 'Arrived'], dead: ['dead', 'Dead'], hanged: ['dead', 'Hanged'], gone: ['gone', 'Gone'], taken: ['gone', 'Captured'],
  freed: ['ok', 'Freed'], rebel: ['bad', 'Rising'], back: ['', 'Back at work'],
};
const STANCE: Record<string, [string, string, string]> = {
  // icon, caption, class
  war: ['g_cannon', 'War', 'bad'], peace: ['scales', 'Peace', 'ok'], patron: ['crown', 'Patron', 'ok'], invade: ['skull', 'Invading', 'bad'],
  calm: ['check', 'Stood down', 'ok'], foe: ['skull', 'Fair game', 'bad'], rumour: ['bell', 'Rumours', 'warn'], fleet: ['ship', 'Fleet', 'bad'],
};
const SHIP_FATE: Record<string, [string, string]> = {
  new: ['ok', 'New ship'], sail: ['', 'Sails'], home: ['ok', 'Homeward'], sunk: ['dead', 'Sunk'], lost: ['gone', 'Lost'], fled: ['gone', 'Fled'], enemy: ['bad', 'Warships'],
};

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(Math.round(n)))}`;

function fact(f: Fact): Raw {
  switch (f.t) {
    case 'gold':
      return f.n >= 0
        ? html`<div class="tally gold" data-tip="${fmt(f.n)} gold to the treasury">${coinPile(f.n)}<div><b class="amt">${fmt(f.n)}</b></div></div>`
        : html`<div class="tally gold spent" data-tip="${fmt(-f.n)} gold paid from the treasury">${coinPile(-f.n)}<div><b class="amt">−${fmt(-f.n)}</b></div></div>`;
    case 'folk': {
      const [ic, one, many] = FOLK[f.who];
      const who = f.n === 1 ? one : many;
      // the caption names who and what befell them ("Soldiers dead"); the figures' style shows it too
      const [cls, fate] = f.fate ? FATE[f.fate] : ['', ''];
      const cap = f.fate === 'new' && f.who === 'pirate' ? (f.n === 1 ? 'Recruit' : 'Recruits') : f.fate ? `${who} ${fate.toLowerCase()}` : who;
      if (f.skill && f.n === 1 && !f.name) {
        const job = JOB_NAMES[f.skill as keyof typeof JOB_NAMES] ?? f.skill;
        return html`<div class="tally" data-tip="A skilled ${job.toLowerCase()}"><span class="skills"><span class="chip ok">${icon('book', 12)} ${job}</span></span><small>Skilled</small></div>`;
      }
      const tip = `${f.n} ${who.toLowerCase()}${f.fate ? `: ${fate.toLowerCase()}` : ''}${f.name ? `<br><b>${f.name}</b>` : ''}`;
      return html`<div class="tally" data-tip="${tip}">${f.fate === 'freed' ? html`<span class="figs ok">${icon('unchain', 18)}${figures(ic, f.n, cls)}</span>` : figures(ic, f.n, cls)}<small>${f.n === 1 && f.name ? html`<span class="nm">${f.name}</span>` : cap}</small></div>`;
    }
    case 'nation': {
      const st = f.stance ? STANCE[f.stance] : null;
      const tip = `<b>${NATION_NAMES[f.nat]}</b>${st ? `: ${st[1]}` : ''}${f.vs ? ` with ${NATION_NAMES[f.vs]}` : ''}${f.rel ? `<br>Relations ${signed(f.rel)}` : ''}${f.knows ? '<br>They know where your island is' : ''}`;
      return html`<div class="tally nat ${st?.[2] ?? ''}" data-tip="${tip}"><span class="flags">${nationFlag(f.nat, 22)}${st ? html`<span class="st">${icon(st[0], 16)}</span>` : ''}${f.vs ? nationFlag(f.vs, 22) : ''}</span>
        <small>${f.rel ? html`<b class="${f.rel > 0 ? 'up' : 'down'}">${f.rel > 0 ? '▲' : '▼'} ${Math.abs(Math.round(f.rel))}</b>` : ''}${f.knows ? html`<span class="knows">${icon('eye', 13)} Knows</span>` : ''}${!f.rel && !f.knows ? (st ? st[1] : NATION_ADJ[f.nat]) : ''}</small></div>`;
    }
    case 'ship': {
      const [cls, cap] = SHIP_FATE[f.fate];
      const n = f.n ?? 1;
      const type = f.type ? SHIPS[f.type as keyof typeof SHIPS]?.name : '';
      const tip = f.name ? `<b>${f.name}</b>${type ? ` (${type})` : ''}<br>${cap}${f.mission ? `: ${f.mission}` : ''}` : `${n} ${f.nat ? `${NATION_ADJ[f.nat]} ` : ''}${n === 1 ? 'ship' : 'ships'}: ${cap.toLowerCase()}`;
      return html`<div class="tally ship" data-tip="${tip}"><span class="figs ${cls}">${f.nat ? nationFlag(f.nat, 14) : ''}${Array.from({ length: Math.min(n, 8) }, () => icon('ship', 26))}</span><small>${f.name ? html`<span class="nm">${f.name}</span>` : n > 1 ? `${n} ${cap}` : cap}</small></div>`;
    }
    case 'good': {
      const name = GOOD_NAMES[f.good as keyof typeof GOOD_NAMES] ?? f.good;
      if (f.n === 0) return html`<div class="tally want" data-tip="Short of ${name.toLowerCase()}"><span class="gwant">${goodIcon(f.good, 26)}</span><small>Need ${name}</small></div>`;
      return html`<div class="tally" data-tip="${name} ${signed(f.n)}"><span class="gq">${goodIcon(f.good, 26)}<b class="${f.n < 0 ? 'down' : ''}">${f.n < 0 ? '−' : '×'}${Math.abs(f.n)}</b></span><small>${name}</small></div>`;
    }
    case 'mood': {
      const ic = f.need === 'drink' ? 'g_rum' : 'heart';
      if (f.v != null) {
        const v = Math.round(f.v * 100);
        return html`<div class="tally" data-tip="${f.who === 'pirate' ? 'Pirate happiness' : 'Captive resignation'} ${v}%"><span class="moodbar ${v < 35 ? 'bad' : v > 60 ? 'ok' : ''}">${icon(ic, 16)}<i><b style="width:${v}%"></b></i></span><small>${f.who === 'pirate' ? 'Happiness' : 'Resignation'} ${v}%</small></div>`;
      }
      const d = Math.round((f.d ?? 0) * 100);
      return html`<div class="tally" data-tip="${f.who === 'pirate' ? 'Pirates' : 'Captives'}: ${f.need === 'drink' ? 'grog' : 'mood'} ${signed(d)}%"><span class="gq mood">${icon(ic, 24)}<b class="${d < 0 ? 'down' : 'up'}">${d < 0 ? '▼' : '▲'}</b></span><small>${f.need === 'drink' ? 'Grog' : 'Mood'} ${signed(d)}%</small></div>`;
    }
    case 'edict': {
      const e = EDICT[f.id];
      const name = e?.name ?? f.id;
      return html`<div class="tally edict ${f.on ? 'on' : 'off'}" data-tip="<b>${name}</b>${f.nat ? ` (${NATION_NAMES[f.nat]})` : ''}<br>${f.on ? 'Now in force' : 'Repealed'}"><span class="seal-ed">${icon('scroll', 22)}${f.nat ? nationFlag(f.nat, 13) : ''}</span><small><span class="nm">${name}</span></small></div>`;
    }
    case 'building': {
      const d = BUILDING[f.def];
      const src = thumbOf?.(f.def);
      return html`<div class="tally bld" data-tip="${d?.name ?? f.def}">${src ? html`<img class="bthumb" src="${src}" data-lthumb="${f.def}" alt="">` : html`<span class="figs" data-lthumb="${f.def}">${icon('hammer', 26)}</span>`}<small><span class="nm">${d?.name ?? f.def}</span></small></div>`;
    }
    case 'crew': {
      const shown = Math.min(f.need, 14);
      return html`<div class="tally" data-tip="${f.have} hands answered the bell; she needs ${f.need}"><span class="figs crew">${Array.from({ length: shown }, (_, i) => icon('pirate', 18, i < f.have ? '' : 'missing'))}</span><small>${f.have} of ${f.need} hands</small></div>`;
    }
    case 'score': {
      const part = (ic: string, n: number, tip: string) => html`<span class="stat" data-tip="${tip}">${icon(ic, 15)} ${fmt(n)}</span>`;
      return html`<div class="tally score">${f.win ? html`<span class="medal-sm ${f.medal}" role="img" aria-label="${f.medal} medal"></span>` : icon('skull', 34)}
        <div><b class="amt">${fmt(f.total)}</b><span class="parts">${part('chest', f.hoard, 'Hoard')}${part('heart', f.happiness, 'Pirate happiness')}${part('ship', f.fleet, 'Fleet')}${part('captain', f.captains, 'Captains')}${part('pirate', f.pirates, 'Pirates')}</span></div></div>`;
    }
  }
}

/** an event letter's facts as a row of tallies */
export function eventStrip(d: EventData): Raw {
  return html`<div class="tallies">${d.facts.map(fact)}</div>`;
}

/** whatever a letter carries, drawn: the voyage results or the event's facts (empty when it has none) */
export function letterStrip(m: Message, withLog = true): Raw | null {
  if (m.data?.kind === 'voyage') return voyageStrip(m.data, withLog);
  if (m.data?.kind === 'event' && m.data.facts.length) return eventStrip(m.data);
  return null;
}

// ------------------------------------------------------------------------------------------------ the score
const SCORE_PARTS: [string, string, string][] = [['hoard', 'chest', 'Hoard'], ['happiness', 'heart', 'Pirate happiness'], ['fleet', 'ship', 'Fleet'], ['captains', 'captain', 'Captains'], ['pirates', 'pirate', 'Pirates']];

/**
 * The score as a stack of bars, one per part (icon, bar sized against the biggest part, number); the bonus
 * objective's part carries a ×3 seal. Then the difficulty and the total.
 */
export function scoreBars(s: { hoard: number; happiness: number; fleet: number; captains: number; pirates: number; bonusKey: string; difficulty: number; total: number }, medalAt?: { gold: number; silver: number }): Raw {
  const val = (k: string) => (s as unknown as Record<string, number>)[k] ?? 0;
  const max = Math.max(1, ...SCORE_PARTS.map(([k]) => val(k) * (k === s.bonusKey ? 3 : 1)));
  const rows = SCORE_PARTS.map(([k, ic, name]) => {
    const v = val(k), bonus = k === s.bonusKey;
    return html`<div class="sbar ${bonus ? 'bonus' : ''}" data-tip="<b>${name}</b>: ${fmt(v)}${bonus ? '<br>Bonus objective: counts three times' : ''}">${icon(ic, 16)}<span class="track"><i style="width:${Math.round((v / max) * 100)}%"></i>${bonus ? html`<i class="x2" style="width:${Math.round(((v * 2) / max) * 100)}%"></i>` : ''}</span><b>${fmt(v)}</b>${bonus ? html`<span class="x3" aria-label="counts three times">×3</span>` : html`<span></span>`}</div>`;
  });
  const goal = medalAt ? html`<span class="goals" data-tip="Medals for this reign: silver at ${fmt(medalAt.silver)}, gold at ${fmt(medalAt.gold)}"><span class="medal-sm silver"></span>${fmt(medalAt.silver)}<span class="medal-sm"></span>${fmt(medalAt.gold)}</span>` : '';
  return html`<div class="sbars">${rows}</div>
    <div class="stotal"><span class="stat" data-tip="Difficulty: the score is multiplied by this">${icon('skull', 14)} ×${(s.difficulty).toFixed(2)}</span><b>${fmt(s.total)}</b>${goal}</div>`;
}
