import { html, fmt, type Raw } from './dom';
import { icon } from './icons';
import { buildingThumb } from './tally';
import { BUILDING } from '../sim/data/buildings';
import type { Crew } from '../sim/workforce';

/**
 * The top bar's pirate and captive tip: one figure per hand (solid at work, lit up idle, faded when they
 * won't work), then one empty place per open post, and the gap between them as a single number.
 * Past fifteen marks each one stands for several (said at the row's end), so the tip stays small and the
 * groups keep their proportions; the exact numbers sit underneath.
 */

const KIND = {
  pirate: { ic: 'pirate', name: 'Pirates', unable: 'sulking', work: 'aboard or posted', post: 'open posts' },
  captive: { ic: 'captive', name: 'Captives', unable: 'rebels, runaways', work: 'at work', post: 'open places' },
} as const;

/** at most this many marks in the row; beyond it each mark stands for several */
const FOLD = 15;

/** `n` marks, or n / per of them (at least one) when each stands for `per` */
function group(n: number, mark: Raw, cls: string, per: number): Raw {
  if (!n) return html``;
  const k = per > 1 ? Math.max(1, Math.round(n / per)) : n;
  return html`<span class="wf-g ${cls}">${Array.from({ length: k }, () => mark)}</span>`;
}

export function workforceTip(kind: 'pirate' | 'captive', c: Crew): string {
  const k = KIND[kind];
  const fig = icon(k.ic, 16);
  const slot = html`<i class="wf-slot"></i>`;
  const all = c.employed + c.idle + c.unable + c.open;
  const per = all > FOLD ? Math.ceil(all / FOLD) : 1;
  const verdict = c.short > 0
    ? html`<div class="wf-v short">${icon('close', 15)}<span>Short by</span><b>${fmt(c.short)}</b>${c.skilledShort ? html`<em>${icon('book', 13)}${fmt(c.skilledShort)} skilled</em>` : ''}</div>`
    : c.open > 0 ? html`<div class="wf-v ok">${icon('check', 15)}<span>Every place filled soon</span></div>` : html``;
  const spare = c.spare > 0 ? html`<div class="wf-v spare">${icon(k.ic, 15)}<span>Spare hands</span><b>${fmt(c.spare)}</b></div>` : html``;
  const want = c.wanting.length
    ? html`<div class="wf-want">${c.wanting.map((w) => {
        const src = buildingThumb(w.def);
        return html`<span class="wf-b">${src ? html`<img src="${src}" alt="">` : icon('hammer', 18)}<span class="nm">${BUILDING[w.def]?.name ?? w.def}${w.n > 1 ? html` <small>×${w.n}</small>` : ''}</span><b>−${w.missing}</b></span>`;
      })}</div>`
    : html``;
  return html`<div class="wf">
    <div class="wf-hd">${icon(k.ic, 20)}<b>${k.name}</b><span class="n">${fmt(c.total)}</span></div>
    <div class="wf-figs" aria-hidden="true">${group(c.employed, fig, 'work', per)}${group(c.idle, fig, 'idle', per)}${group(c.unable, fig, 'unable', per)}${group(c.open, slot, 'open', per)}${per > 1 ? html`<small class="per">each ≈ ${per}</small>` : ''}</div>
    <div class="wf-keys">
      <span class="work">${fig}${fmt(c.employed)} <small>${k.work}</small></span>
      <span class="idle">${fig}${fmt(c.idle)} <small>idle</small></span>
      ${c.unable ? html`<span class="unable">${fig}${fmt(c.unable)} <small>${k.unable}</small></span>` : ''}
      <span class="open">${slot}${fmt(c.open)} <small>${k.post}</small></span>
    </div>
    ${verdict}${spare}${want}
  </div>`.toString();
}
