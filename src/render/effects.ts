import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { World } from './world';

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: THREE.Color;
  alpha: number;
  additive: boolean;
}

function softTex(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Billboard particle system rendered as a single Points cloud per blend mode. */
class Cloud {
  readonly points: THREE.Points;
  readonly list: Particle[] = [];
  private geo = new THREE.BufferGeometry();
  private cap = 4000;
  constructor(additive: boolean, tex: THREE.Texture) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.cap * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.cap * 4), 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.cap), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  update(dt: number, h: number): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const size = this.geo.getAttribute('size') as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      q.life += dt;
      if (q.life >= q.max) {
        this.list.splice(i, 1);
        continue;
      }
    }
    for (const q of this.list) {
      if (n >= this.cap) break;
      q.p.addScaledVector(q.v, dt);
      q.v.multiplyScalar(1 - dt * 0.6);
      const t = q.life / q.max;
      pos.setXYZ(n, q.p.x, q.p.y, q.p.z);
      const a = q.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      col.setXYZW(n, q.color.r, q.color.g, q.color.b, a);
      size.setX(n, q.size + q.grow * q.life);
      n++;
    }
    this.geo.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.6;
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private normal: Cloud;
  private add: Cloud;
  private balls: THREE.InstancedMesh;
  private flashes: { light: THREE.PointLight; t: number }[] = [];

  constructor(private world: World, private game: Game) {
    const tex = softTex();
    this.normal = new Cloud(false, tex);
    this.add = new Cloud(true, tex);
    this.group.add(this.normal.points, this.add.points);
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.4 }), 200);
    this.balls.count = 0;
    this.balls.frustumCulled = false;
    this.group.add(this.balls);
  }

  emit(cloud: 'normal' | 'add', p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow: number, color: THREE.ColorRepresentation, alpha = 1): void {
    (cloud === 'add' ? this.add : this.normal).list.push({ p: p.clone(), v: v.clone(), life: 0, max: life, size, grow, color: new THREE.Color(color), alpha, additive: cloud === 'add' });
  }

  smoke(x: number, y: number, z: number): void {
    const r = () => (Math.random() - 0.5) * 0.15;
    this.emit('normal', new THREE.Vector3(x + r(), y, z + r()), new THREE.Vector3(0.15 + r(), 0.5 + Math.random() * 0.2, 0.08 + r()), 4 + Math.random() * 2, 0.35, 0.45, 0xb8b0a8, 0.45);
  }

  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, n = 12, speed = 2, size = 0.3, life = 0.8): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.emit('add', new THREE.Vector3(x, y, z), v, life * (0.6 + Math.random() * 0.6), size, size * 0.5, color, 1);
    }
  }

  splash(x: number, z: number): void {
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.2);
      this.emit('normal', new THREE.Vector3(x, 0.1, z), v, 1.0 + Math.random() * 0.5, 0.35, 0.3, 0xeef6ff, 0.85);
    }
  }

  muzzle(x: number, y: number, z: number): void {
    this.burst(x, y, z, 0xffb050, 10, 3, 0.5, 0.25);
    for (let i = 0; i < 8; i++) this.emit('normal', new THREE.Vector3(x, y, z), new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2), 2.5, 0.6, 0.9, 0xd8d0c8, 0.6);
    const light = new THREE.PointLight(0xffa040, 30, 12, 2);
    light.position.set(x, y + 0.5, z);
    this.group.add(light);
    this.flashes.push({ light, t: 0 });
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    const g = this.game;
    switch (e.type) {
      case 'cannon':
        this.muzzle(e.x, e.from === 'fort' ? 2 : 1.5, e.y);
        break;
      case 'shipHit':
        this.burst(e.x, 1.5, e.y, 0xffc070, 16, 3, 0.4, 0.6);
        for (let i = 0; i < 6; i++) this.emit('normal', new THREE.Vector3(e.x, 1.5, e.y), new THREE.Vector3((Math.random() - 0.5), 1 + Math.random(), (Math.random() - 0.5)), 3, 0.8, 0.6, 0x3a3530, 0.7);
        break;
      case 'shipSunk':
        this.splash(e.x, e.y);
        break;
      case 'death': {
        const y = g.map.heightAt(e.x, e.y);
        this.burst(e.x, y + 0.5, e.y, 0xa01010, 8, 1.2, 0.15, 0.5);
        break;
      }
      case 'plunder': {
        const s = g.ships.get(e.ship);
        if (s && e.gold > 0) this.burst(s.vx, 2, s.vy, 0xffd040, 40, 3, 0.25, 1.4);
        break;
      }
      case 'celebrate': {
        for (const p of g.pirates()) if (p.task.kind !== 'atsea' && Math.random() < 0.3) this.burst(p.x, g.map.heightAt(p.x, p.y) + 1.5, p.y, new THREE.Color().setHSL(Math.random(), 0.9, 0.6), 10, 2, 0.2, 1);
        break;
      }
    }
  }

  update(dt: number): void {
    const h = this.world.canvas.clientHeight;
    this.normal.update(dt, h);
    this.add.update(dt, h);
    for (const f of this.flashes) {
      f.t += dt;
      f.light.intensity = Math.max(0, 30 * (1 - f.t / 0.25));
    }
    this.flashes = this.flashes.filter((f) => {
      if (f.t > 0.25) this.group.remove(f.light);
      return f.t <= 0.25;
    });
    // cannonballs from sim
    const balls = this.game.cannonballs ?? [];
    const m = new THREE.Matrix4();
    let n = 0;
    for (const c of balls) {
      if (n >= 200) break;
      m.makeTranslation(c.x, c.z, c.y);
      this.balls.setMatrixAt(n++, m);
      if (c.z < 0.2 && !(c as any).splashed) {
        (c as any).splashed = true;
        if (!this.game.map.isLand(Math.floor(c.x), Math.floor(c.y))) this.splash(c.x, c.y);
        else this.burst(c.x, Math.max(0, this.game.map.heightAt(c.x, c.y)) + 0.3, c.y, 0xffa050, 14, 3, 0.4, 0.5);
      }
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
  }
}
