import { html, raw, type Raw } from './dom';
import { icon, goodIcon } from './icons';

/**
 * Game-native pickers for the inspectors: the value shows as a thing (coins, pennants, a treasure split) rather
 * than a row of words. Each is a radiogroup of buttons with the exact meaning in a tooltip, so keyboard, screen
 * readers and the 4 Hz patchHTML refresh all behave as they did with the plain segmented controls.
 */

/** a stack of `n` coins, drawn as engraved discs (n = 0: an empty purse) */
function coinStack(n: number, max: number): Raw {
  if (n <= 0) return icon('purse', 24);
  const h = 8 + max * 4;
  const discs = Array.from({ length: n }, (_, i) => {
    const y = h - 5 - i * 4;
    return `<ellipse cx="11" cy="${y}" rx="8" ry="3" class="cdisc"/><path d="M3 ${y}v1.4c0 1.6 3.6 3 8 3s8-1.4 8-3V${y}" class="cedge"/>`;
  }).join('');
  return raw(`<svg class="ic coins" width="27" height="${Math.round(h * 27 / 22)}" viewBox="0 0 22 ${h}" aria-hidden="true">${discs}</svg>`);
}

/**
 * Coin stacks of growing height for a money level (wages, prices). `levels` are the values; `labels` the small
 * number under each (e.g. "2g"); `tips` the tooltip per level. Everything up to the chosen stack is lit.
 */
export function coinPick(act: string, cur: number, levels: number[], labels: string[], tips: string[], aria: string): Raw {
  const ci = Math.max(0, levels.indexOf(cur));
  const hasPurse = levels[0] === 0;
  const max = levels.length - (hasPurse ? 1 : 0);
  return html`<div class="vpick coinpick" role="radiogroup" aria-label="${aria}">${levels.map((v, i) => {
    const n = hasPurse ? i : i + 1;
    return html`<button class="${i === ci ? 'on' : ''} ${i <= ci ? 'lit' : ''}" data-act="${act}:${v}" role="radio" aria-checked="${i === ci ? 'true' : 'false'}" aria-label="${labels[i]}" data-tip="${tips[i]}">${coinStack(n, max)}<small>${labels[i]}</small></button>`;
  })}</div>`;
}

/** five pennants on poles of rising height (priority 1-5); the chosen one and those below are hoisted */
export function pennants(act: string, cur: number, names: string[], tip: string): Raw {
  return html`<div class="vpick pennants" role="radiogroup" aria-label="Priority">${names.map((n, i) => {
    const v = i + 1, h = 12 + i * 3.5;
    const svg = `<svg class="ic pennant" width="26" height="35" viewBox="0 0 22 30" aria-hidden="true"><path d="M6 29V${30 - h - 2}" class="pole"/><path d="M6.5 ${30 - h - 1}l12 3.2-12 3.2z" class="flag"/><circle cx="6" cy="${30 - h - 2.5}" r="1.2" class="knob"/></svg>`;
    return html`<button class="${v === cur ? 'on' : ''} ${v <= cur ? 'lit' : ''}" data-act="${act}:${v}" role="radio" aria-checked="${v === cur ? 'true' : 'false'}" aria-label="${n} priority" data-tip="<b>${n} priority</b><br>${tip}">${raw(svg)}</button>`;
  })}<span class="vp-val">${names[cur - 1] ?? ''}</span></div>`;
}

/**
 * The plunder split as one treasure bar: the chest's share against the crew's. The notches under it pick the
 * policy; the bar moves to show the split.
 */
export function spoilsBar(act: string, cur: string, opts: [string, string, number][]): Raw {
  const o = opts.find((x) => x[0] === cur) ?? opts[0];
  const tr = Math.round(o[2] * 100);
  return html`<div class="spoilsbar">
    <div class="split" aria-hidden="true"><span class="tr" style="flex:${tr}">${icon('chest', 14)} ${tr}%</span><span class="cr" style="flex:${100 - tr}">${100 - tr}% ${icon('pirate', 14)}</span></div>
    <div class="vpick notches" role="radiogroup" aria-label="Spoils">${opts.map(([v, n, t]) => html`<button class="${v === cur ? 'on' : ''}" data-act="${act}:${v}" role="radio" aria-checked="${v === cur ? 'true' : 'false'}" data-tip="<b>${n}</b><br>Treasury ${Math.round(t * 100)}% · crew ${100 - Math.round(t * 100)}%. Stingy captains attract fewer recruits.">${n}</button>`)}</div>
  </div>`;
}

/** a good as an icon with a number (its stock), the name only in the tooltip; `need` adds a small ×n badge */
export function goodChip(good: string, name: string, stock: number, opts: { need?: number; tip?: string; cls?: string; ring?: number } = {}): Raw {
  const ring = opts.ring != null ? html`<i class="ring" style="--p:${Math.round(Math.max(0, Math.min(1, opts.ring)) * 100)}%"></i>` : '';
  return html`<span class="gchip ${opts.cls ?? ''}" data-tip="${opts.tip ?? `${name}: ${stock} in store`}" aria-label="${name} ${stock}">${ring}${goodIcon(good, 20)}${opts.need ? html`<sup>×${opts.need}</sup>` : ''}<b>${stock}</b></span>`;
}
