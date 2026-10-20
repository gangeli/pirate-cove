import * as THREE from 'three';
import { el, setText, toggleClass } from './dom';
import { icon } from './icons';

export type PlaceAction = 'ok' | 'cancel' | 'rotl' | 'rotr';

/**
 * Placement controls that ride along with the thing being placed: a hanging parchment tag with the name and cost
 * (or why it can't go there) above the ghost, rotate arrows at its sides, and confirm / cancel seals beneath it.
 * The ghost's box is projected to the screen each frame; the DOM is only touched when that projection moves.
 * On a mouse screen only the tag is shown (the ghost follows the pointer, so buttons beside it could not be reached).
 */
export class PlaceControls {
  private root: HTMLElement;
  private tag: HTMLElement;
  private tagText: HTMLElement;
  private rotL: HTMLElement;
  private rotR: HTMLElement;
  private row: HTMLElement;
  private key = '';
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement, onAction: (a: PlaceAction) => void) {
    this.root = el('div', 'placectl hidden', parent);
    this.root.innerHTML = `<div class="pc-tag"><span class="t"></span></div>
      <button class="pc-btn pc-rot" data-pc="rotl" aria-label="Rotate left">${icon('rotl', 20).html}</button>
      <button class="pc-btn pc-rot" data-pc="rotr" aria-label="Rotate right">${icon('rotr', 20).html}</button>
      <div class="pc-row"><button class="pc-btn pc-no" data-pc="cancel" aria-label="Cancel">${icon('close', 20).html}</button><button class="pc-btn pc-ok" data-pc="ok" aria-label="Confirm">${icon('check', 24, 'i-ok').html}${icon('bulldoze', 22, 'i-del').html}</button></div>`;
    this.tag = this.root.querySelector('.pc-tag') as HTMLElement;
    this.tagText = this.root.querySelector('.pc-tag .t') as HTMLElement;
    const [l, r] = this.root.querySelectorAll<HTMLElement>('.pc-rot');
    this.rotL = l;
    this.rotR = r;
    this.row = this.root.querySelector('.pc-row') as HTMLElement;
    this.root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-pc]')?.dataset.pc as PlaceAction | undefined;
      if (a) {
        e.stopPropagation();
        onAction(a);
      }
    });
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hide(): void {
    if (this.key !== 'hidden') {
      this.key = 'hidden';
      this.root.classList.add('hidden');
    }
  }

  /**
   * Show the controls around a world-space box (centre x/z, ground height y, footprint w x d, height h).
   * mode 'build' gets rotate + confirm/cancel, 'road' only confirm/cancel, 'roadsel' (a road picked in the world) a
   * pull-up-the-road button; buttons only on touch screens (or when `touch` is forced for a fixed anchor).
   */
  show(cam: THREE.Camera, view: { w: number; h: number }, box: { x: number; y: number; z: number; w: number; d: number; h: number }, text: string, ok: boolean, mode: 'build' | 'road' | 'roadsel', touch: boolean): void {
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    const W = view.w, H = view.h; // the 3D canvas sits at the top-left of the page
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) for (const dy of [0, 1]) {
      this.v.set(box.x + dx * box.w, box.y + dy * box.h, box.z + dz * box.d).project(cam);
      const sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
      l = Math.min(l, sx);
      r = Math.max(r, sx);
      t = Math.min(t, sy);
      b = Math.max(b, sy);
    }
    const host = this.root.parentElement!;
    const ui = host.getBoundingClientRect();
    // the UI layer may be CSS-zoomed on big screens: work in its own (unzoomed) pixels
    const z = host.offsetWidth ? ui.width / host.offsetWidth : 1;
    l = (l - ui.left) / z;
    r = (r - ui.left) / z;
    t = (t - ui.top) / z;
    b = (b - ui.top) / z;
    const key = `${Math.round(l)},${Math.round(r)},${Math.round(t)},${Math.round(b)}|${text}|${ok}|${mode}|${touch}|${Math.round(ui.width)}x${Math.round(ui.height)}`;
    if (key === this.key) return;
    this.key = key;
    this.root.classList.remove('hidden');
    toggleClass(this.root, 'touch', touch);
    toggleClass(this.root, 'bad', !ok);
    toggleClass(this.root, 'road', mode === 'road');
    toggleClass(this.root, 'roadsel', mode === 'roadsel');
    setText(this.tagText, text);
    const cx = (l + r) / 2, cy = (t + b) / 2;
    // keep clear of the toolbar (and of the screen edges)
    const tb = document.querySelector('.toolbar')?.getBoundingClientRect();
    const uw = ui.width / z, uh = (tb && tb.height ? Math.min(ui.height, tb.top - ui.top) : ui.height) / z;
    const clampX = (x: number, w: number) => Math.max(6, Math.min(uw - w - 6, x));
    const clampY = (y: number, h: number) => Math.max(6, Math.min(uh - h - 6, y));
    // the tag hangs above the ghost (below it when there is no room)
    const tw = this.tag.offsetWidth, th = this.tag.offsetHeight;
    let ty = t - th - 10;
    if (ty < 50) ty = b + (touch ? 64 : 10);
    this.tag.style.transform = `translate(${Math.round(clampX(cx - tw / 2, tw))}px,${Math.round(clampY(ty, th))}px)`;
    if (!touch) return;
    const rs = this.rotL.offsetWidth || 44;
    const gap = 10;
    toggleClass(this.rotL, 'hidden', mode !== 'build');
    toggleClass(this.rotR, 'hidden', mode !== 'build');
    this.rotL.style.transform = `translate(${Math.round(clampX(l - rs - gap, rs))}px,${Math.round(clampY(cy - rs / 2, rs))}px)`;
    this.rotR.style.transform = `translate(${Math.round(clampX(r + gap, rs))}px,${Math.round(clampY(cy - rs / 2, rs))}px)`;
    const rw = this.row.offsetWidth, rh = this.row.offsetHeight;
    this.row.style.transform = `translate(${Math.round(clampX(cx - rw / 2, rw))}px,${Math.round(clampY(b + 10, rh))}px)`;
  }
}
