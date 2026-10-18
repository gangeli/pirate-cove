/** Tiny DOM helpers: tagged-template HTML with escaping, and delegated actions. */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** raw html wrapper to skip escaping */
export class Raw {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}
export const raw = (s: string) => new Raw(s);

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.html;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.html : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/** set innerHTML only when it changed (keeps hover/focus state stable) */
export function setHTML(e: HTMLElement, h: Raw | string): void {
  const s = h instanceof Raw ? h.html : h;
  if ((e as any).__h !== s) {
    e.innerHTML = s;
    (e as any).__h = s;
  }
}

export type ActionHandler = (arg: string, ev: MouseEvent, target: HTMLElement) => void;

/** route clicks on [data-act="name:arg"] to handlers */
export function delegate(root: HTMLElement, handlers: Record<string, ActionHandler>, onAny?: () => void): void {
  root.addEventListener('click', (ev) => {
    let t = ev.target as HTMLElement | null;
    while (t && t !== root) {
      const a = t.dataset?.act;
      if (a) {
        const i = a.indexOf(':');
        const name = i < 0 ? a : a.slice(0, i);
        const arg = i < 0 ? '' : a.slice(i + 1);
        const h = handlers[name];
        if (h) {
          ev.stopPropagation();
          if (t.classList.contains('disabled')) return;
          onAny?.();
          h(arg, ev as MouseEvent, t);
        }
        return;
      }
      t = t.parentElement;
    }
  });
}

export function fmt(n: number): string {
  const v = Math.round(n);
  return Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : v.toLocaleString('en-US');
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** coloured meter */
export function bar(v: number, cls = '', label = ''): Raw {
  const w = Math.max(0, Math.min(1, v)) * 100;
  const hue = Math.round(Math.max(0, Math.min(1, v)) * 110);
  return html`<div class="meter ${cls}" title="${label}"><div class="fill" style="width:${w.toFixed(1)}%;background:hsl(${hue},62%,42%)"></div></div>`;
}
