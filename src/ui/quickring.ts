import * as THREE from 'three';
import { el, html, patchHTML, setText, toggleClass, delegate, type ActionHandler } from './dom';
import { icon } from './icons';

/** one wax seal beside the selection: `act` is an inspector action ("follow", "edict:press_gang", ...) */
export type QuickAct = { act: string; icon: string; label: string; tone?: 'ok' | 'bad' | 'brass' | 'on'; tip?: string };

/**
 * Quick actions that ride beside the selected building, ship or person: a short smile of wax seals under it (over
 * it when the inspector or toolbar is in the way), each with a small inked label, plus a name tag above it while the
 * inspector is folded away. Projected from the object's world box each frame; the DOM is only written when the
 * projection or the actions change. Same vocabulary as the placement seals (placectl.ts).
 */
export class QuickRing {
  readonly root: HTMLElement;
  private row: HTMLElement;
  private tag: HTMLElement;
  private tagText: HTMLElement;
  private key = '';
  private actsKey = '';
  private v = new THREE.Vector3();
  /** last placed band of the seals (UI pixels), for the camera framing */
  visible = false;

  constructor(parent: HTMLElement, handlers: Record<string, ActionHandler>, onAny: () => void) {
    this.root = el('div', 'quickring hidden', parent);
    this.tag = el('div', 'qr-tag', this.root);
    this.tagText = el('span', 't', this.tag);
    this.row = el('div', 'qr-row', this.root);
    delegate(this.root, handlers, onAny);
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hide(): void {
    if (this.key !== 'hidden') {
      this.key = 'hidden';
      this.visible = false;
      this.root.classList.add('hidden');
    }
  }

  /**
   * Show the seals around a world box (centre x/z, ground y, footprint w x d, height h). `name` shows a tag above it
   * (when the inspector is folded away). Avoids the toolbar, the inspector and the screen edges.
   */
  show(cam: THREE.Camera, view: { w: number; h: number }, box: { x: number; y: number; z: number; w: number; d: number; h: number }, acts: QuickAct[], name: string | null, touch: boolean): void {
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity, behind = false;
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) for (const dy of [0, 1]) {
      this.v.set(box.x + dx * box.w, box.y + dy * box.h, box.z + dz * box.d).project(cam);
      if (this.v.z > 1) behind = true;
      const sx = (this.v.x * 0.5 + 0.5) * view.w, sy = (-this.v.y * 0.5 + 0.5) * view.h;
      l = Math.min(l, sx);
      r = Math.max(r, sx);
      t = Math.min(t, sy);
      b = Math.max(b, sy);
    }
    const host = this.root.parentElement!;
    const ui = host.getBoundingClientRect();
    const z = host.offsetWidth ? ui.width / host.offsetWidth : 1;
    l = (l - ui.left) / z;
    r = (r - ui.left) / z;
    t = (t - ui.top) / z;
    b = (b - ui.top) / z;
    const uw = ui.width / z, uh = ui.height / z;
    const cx = (l + r) / 2, cy = (t + b) / 2;
    // off screen (or panned far away): nothing to point at
    if (behind || cx < -20 || cx > uw + 20 || cy < -20 || cy > uh + 20 || !acts.length) return this.hide();
    const rect = (sel: string) => {
      const e = document.querySelector<HTMLElement>(sel);
      if (!e || e.classList.contains('hidden') || !e.offsetParent) return null;
      const q = e.getBoundingClientRect();
      return { l: (q.left - ui.left) / z, r: (q.right - ui.left) / z, t: (q.top - ui.top) / z, b: (q.bottom - ui.top) / z };
    };
    const ins = rect('.panel.inspector');
    const tb = rect('.toolbar');
    const top = rect('.topbar');
    const ak = acts.map((a) => `${a.act}|${a.icon}|${a.label}|${a.tone ?? ''}`).join(',');
    const key = `${Math.round(l)},${Math.round(r)},${Math.round(t)},${Math.round(b)}|${ak}|${name}|${touch}|${ins ? `${Math.round(ins.l)},${Math.round(ins.t)}` : '-'}|${Math.round(uw)}x${Math.round(uh)}`;
    if (key === this.key) return;
    this.key = key;
    this.visible = true;
    this.root.classList.remove('hidden');
    toggleClass(this.root, 'touch', touch);
    if (ak !== this.actsKey) {
      this.actsKey = ak;
      patchHTML(this.row, html`${acts.map((a) => html`<button class="qr-seal ${a.tone ?? ''}" data-act="${a.act}" aria-label="${a.label}" ${a.tip ? html`data-tip="${a.tip}"` : ''}><span class="wax">${icon(a.icon, touch ? 22 : 20)}</span><span class="lbl">${a.label}</span></button>`)}`);
    }
    // the free area: below the top bar, above the toolbar, and off whichever side the inspector takes
    let fl = 6, fr = uw - 6, ft = (top ? top.b : 0) + 6, fb = (tb ? tb.t : uh) - 6;
    if (ins) {
      const sideways = ins.l > uw * 0.35 && ins.t < uh * 0.45; // a side sheet (desktop, landscape) rather than a bottom sheet
      if (sideways) fr = Math.min(fr, ins.l - 6);
      else fb = Math.min(fb, ins.t - 6);
    }
    const rw = this.row.offsetWidth, rh = this.row.offsetHeight;
    // under the object, or over it when there is no room below
    let ry = b + 8;
    const above = ry + rh > fb && t - 8 - rh >= ft;
    if (above) ry = t - 8 - rh;
    ry = Math.max(ft, Math.min(fb - rh, ry));
    // and clear of the minimap when the row would sit beside it (landscape phones)
    const mm = rect('.minimap');
    if (mm && ry + rh > mm.t && ry < mm.b && cx - rw / 2 < mm.r + 22) fl = Math.max(fl, mm.r + 22);
    const rx = Math.max(fl, Math.min(fr - rw, cx - rw / 2));
    toggleClass(this.row, 'above', above);
    this.row.style.transform = `translate(${Math.round(rx)}px,${Math.round(ry)}px)`;
    toggleClass(this.tag, 'hidden', !name);
    if (name) {
      setText(this.tagText, name);
      const tw = this.tag.offsetWidth, th = this.tag.offsetHeight;
      let ty = above ? ry - th - 8 : t - th - 10;
      if (ty < ft) ty = above ? ft : Math.max(ft, ry + rh + 8);
      this.tag.style.transform = `translate(${Math.round(Math.max(fl, Math.min(fr - tw, cx - tw / 2)))}px,${Math.round(ty)}px)`;
    }
  }
}
