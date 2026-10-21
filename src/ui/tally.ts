import { html, raw, fmt, type Raw } from './dom';
import { icon } from './icons';
import { JOB_NAMES } from '../sim/data/buildings';
import type { MessageData } from '../sim/types';

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
function deaths(d: MessageData): number {
  let n = 0;
  for (const e of d.log) {
    const m = /Lost (\d+) m[ae]n/.exec(e.text);
    if (m) n += +m[1];
  }
  return n;
}

export function voyageStrip(d: MessageData, withLog = true): Raw {
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
  if (!d.gold && !d.recruits && !d.captives && !d.skilled.length && !d.wealthy) items.unshift(html`<div class="tally empty"><span class="figs">${icon('ship', 22)}</span><small>Nothing but sunburn</small></div>`);
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
