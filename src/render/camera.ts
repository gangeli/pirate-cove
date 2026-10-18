import * as THREE from 'three';

/** RTS camera: orbits a ground target at a fixed pitch; rotates in 90° steps (like the original) or freely. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(80, 0, 80);
  yaw = Math.PI / 4; // radians; 45° = classic iso
  private yawGoal = Math.PI / 4;
  dist = 60;
  private distGoal = 60;
  pitch = 0.92; // radians from horizontal
  minDist = 12;
  maxDist = 170;
  bounds = { min: 0, max: 160 };
  private keys = new Set<string>();
  private dragging: null | { x: number; y: number; t: THREE.Vector3 } = null;
  edgeScroll = true;
  private mouse = { x: -1, y: -1, inside: false };
  follow: (() => THREE.Vector3 | null) | null = null;
  heightAt: (x: number, z: number) => number = () => 0;

  constructor(private dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'q' || e.key === 'Q') this.rotateStep(-1);
      if (e.key === 'e' || e.key === 'E') this.rotateStep(1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distGoal = THREE.MathUtils.clamp(this.distGoal * Math.pow(1.0015, e.deltaY), this.minDist, this.maxDist);
    }, { passive: false });
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.dragging = { x: e.clientX, y: e.clientY, t: this.target.clone() };
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.inside = true;
      if (this.dragging) {
        const k = this.dist / 700;
        const dx = (e.clientX - this.dragging.x) * k, dy = (e.clientY - this.dragging.y) * k;
        const f = this.forward(), r = this.right();
        this.target.copy(this.dragging.t).addScaledVector(r, -dx).addScaledVector(f, dy);
        this.follow = null;
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (this.dragging && (e.button === 1 || e.button === 2)) this.dragging = null;
    });
    dom.addEventListener('pointerleave', () => (this.mouse.inside = false));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  rotateStep(dir: number): void {
    this.yawGoal += (dir * Math.PI) / 2;
  }
  zoom(f: number): void {
    this.distGoal = THREE.MathUtils.clamp(this.distGoal * f, this.minDist, this.maxDist);
  }
  setDist(d: number, instant = false): void {
    this.distGoal = THREE.MathUtils.clamp(d, this.minDist, this.maxDist);
    if (instant) this.dist = this.distGoal;
  }
  lookAt(x: number, z: number, instant = false): void {
    if (instant) this.target.set(x, 0, z);
    else this.panTo = new THREE.Vector3(x, 0, z);
    this.follow = null;
  }
  private panTo: THREE.Vector3 | null = null;

  forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
  /** yaw quadrant 0..3 for UI (rotation of minimap etc.) */
  get quadrant(): number {
    return ((Math.round((this.yawGoal - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4;
  }

  update(dt: number, w: number, h: number): void {
    const sp = this.dist * 1.1 * dt;
    const f = this.forward(), r = this.right();
    let moved = false;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.target.addScaledVector(f, sp), (moved = true);
    if (k.has('s') || k.has('arrowdown')) this.target.addScaledVector(f, -sp), (moved = true);
    if (k.has('a') || k.has('arrowleft')) this.target.addScaledVector(r, -sp), (moved = true);
    if (k.has('d') || k.has('arrowright')) this.target.addScaledVector(r, sp), (moved = true);
    if (k.has('=') || k.has('+')) this.zoom(1 - dt * 1.5);
    if (k.has('-')) this.zoom(1 + dt * 1.5);
    if (this.edgeScroll && this.mouse.inside && !this.dragging && document.hasFocus()) {
      const m = 6;
      if (this.mouse.x <= m) this.target.addScaledVector(r, -sp), (moved = true);
      if (this.mouse.x >= w - m) this.target.addScaledVector(r, sp), (moved = true);
      if (this.mouse.y <= m) this.target.addScaledVector(f, sp), (moved = true);
      if (this.mouse.y >= h - m) this.target.addScaledVector(f, -sp), (moved = true);
    }
    if (moved) (this.follow = null), (this.panTo = null);
    if (this.panTo) {
      this.target.lerp(this.panTo, 1 - Math.exp(-dt * 5));
      if (this.target.distanceTo(this.panTo) < 0.05) this.panTo = null;
    }
    if (this.follow) {
      const p = this.follow();
      if (p) this.target.lerp(new THREE.Vector3(p.x, 0, p.z), 1 - Math.exp(-dt * 6));
      else this.follow = null;
    }
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.min, this.bounds.max);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.min, this.bounds.max);
    this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * 8));
    this.dist += (this.distGoal - this.dist) * (1 - Math.exp(-dt * 10));
    const ground = Math.max(0, this.heightAt(this.target.x, this.target.z));
    this.target.y += (ground - this.target.y) * (1 - Math.exp(-dt * 4));
    // slightly flatter pitch when zoomed in for a nicer view of characters
    const pitch = this.pitch - (1 - THREE.MathUtils.smoothstep(this.dist, this.minDist, 60)) * 0.25;
    const cp = Math.cos(pitch), spc = Math.sin(pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + spc * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
