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

/** cheap in-place updates that only touch the DOM when the value really changed */
export function setText(e: HTMLElement, s: string): void {
  if ((e as any).__t !== s) {
    e.textContent = s;
    (e as any).__t = s;
  }
}
export function setAttr(e: HTMLElement, name: string, v: string): void {
  if (e.getAttribute(name) !== v) e.setAttribute(name, v);
}
export function setStyle(e: HTMLElement, prop: 'width' | 'height' | 'left' | 'top' | 'display', v: string): void {
  if (e.style[prop] !== v) e.style[prop] = v;
}
export function toggleClass(e: HTMLElement, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;
/**
 * Like setHTML, but when the markup changed it patches the existing DOM in place instead of replacing it:
 * elements that are still there keep their identity (hover, scroll position, loaded images), and only
 * text and attributes that differ are written. For panels refreshed several times a second where most of
 * the content is unchanged. Don't use it where code keeps listeners on the children or form state matters.
 */
export function patchHTML(e: HTMLElement, h: Raw | string): void {
  const s = h instanceof Raw ? h.html : h;
  if ((e as any).__h === s) return;
  if ((e as any).__h === undefined || !tpl) e.innerHTML = s;
  else {
    tpl.innerHTML = s;
    morphChildren(e, tpl.content);
    tpl.innerHTML = '';
  }
  (e as any).__h = s;
}

function morphChildren(dst: Node, src: Node): void {
  let d = dst.firstChild;
  let n = src.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (!d) dst.appendChild(n);
    else if (d.nodeType === n.nodeType && d.nodeName === n.nodeName) {
      morphNode(d, n);
      d = d.nextSibling;
    } else {
      const old = d;
      d = d.nextSibling;
      dst.replaceChild(n, old);
    }
    n = next;
  }
  while (d) {
    const next = d.nextSibling;
    dst.removeChild(d);
    d = next;
  }
}

function morphNode(d: Node, n: Node): void {
  if (d.nodeType !== 1) {
    if (d.nodeValue !== n.nodeValue) d.nodeValue = n.nodeValue;
    return;
  }
  const de = d as Element, ne = n as Element;
  const na = ne.attributes, da = de.attributes;
  for (let i = 0; i < na.length; i++) {
    const a = na[i];
    if (de.getAttribute(a.name) !== a.value) de.setAttribute(a.name, a.value);
  }
  for (let i = da.length - 1; i >= 0; i--) {
    const a = da[i];
    if (!ne.hasAttribute(a.name)) de.removeAttribute(a.name);
  }
  (de as any).__h = undefined; // a nested setHTML cache no longer describes this element
  (de as any).__t = undefined;
  morphChildren(de, ne);
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
