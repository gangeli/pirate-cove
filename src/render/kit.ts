import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadTex } from './textures';

/** Shared PBR materials and parametric architecture pieces. All dimensions in tiles (1 tile ≈ 2 m). */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function texMat(name: string, opts: { color?: number; rough?: number; repeat?: number; normalScale?: number } = {}): THREE.MeshStandardMaterial {
  const key = name + JSON.stringify(opts);
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    map: loadTex(`tex/${name}_d.jpg`, true),
    normalMap: loadTex(`tex/${name}_n.jpg`, false),
    roughness: opts.rough ?? 0.9,
    color: opts.color ?? 0xffffff,
  });
  m.normalScale.setScalar(opts.normalScale ?? 1);
  matCache.set(key, m);
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

let _M: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const stripes = (a: string, b: string) => canvasTex(256, 256, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect(i * 32, 0, 32, 256);
    }
    // grime
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(40,25,10,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  });
  const canvasCloth = canvasTex(256, 256, (g) => {
    g.fillStyle = '#d8c9a3';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      g.fillStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},${40},${Math.random() * 0.08})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1);
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(80,60,30,0.12)';
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 30, 0, 7);
      g.fill();
    }
  });
  const sail = (col: string) => new THREE.MeshStandardMaterial({ map: canvasCloth, color: new THREE.Color(col), roughness: 0.95, side: THREE.DoubleSide });
  return {
    thatch: texMat('thatch', { color: 0xd8c08a, rough: 1, normalScale: 1.4 }),
    thatchDark: texMat('thatch', { color: 0xa08a60, rough: 1, normalScale: 1.4 }),
    planks: texMat('planks', { color: 0xd0b090 }),
    planksDark: texMat('planks', { color: 0x8a6a50 }),
    oldplanks: texMat('oldplanks', { color: 0xe0d0c0 }),
    plaster: texMat('whitewash', { color: 0xffffff, rough: 0.95 }),
    plasterPink: texMat('whitewash', { color: 0xf6c4b4, rough: 0.95 }),
    plasterYellow: texMat('whitewash', { color: 0xf6e0a0, rough: 0.95 }),
    plasterBlue: texMat('blueplaster', { color: 0xffffff, rough: 0.95 }),
    coral: texMat('coral', { color: 0xf0e8dc }),
    bamboo: texMat('bamboo', { color: 0xe8d8b8 }),
    weave: texMat('weave', { color: 0xf0e0c0 }),
    stone: texMat('coral', { color: 0xf4ecdc }),
    stoneDark: texMat('stone', { color: 0x9a9080 }),
    tiles: texMat('tiles', { color: 0xe0a080, rough: 0.8 }),
    bark: texMat('palmbark', { color: 0xb09a80 }),
    dirt: texMat('dirt', { color: 0xc0a080, rough: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.85 }),
    darkwood: new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.85 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a640, roughness: 0.3, metalness: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a40, roughness: 0.35, metalness: 0.9 }),
    canvas: sail('#ffffff'),
    canvasRed: new THREE.MeshStandardMaterial({ map: stripes('#a8322a', '#e8d8b8'), roughness: 0.95, side: THREE.DoubleSide }),
    canvasBlue: new THREE.MeshStandardMaterial({ map: stripes('#2a4a8a', '#e8d8b8'), roughness: 0.95, side: THREE.DoubleSide }),
    canvasGreen: new THREE.MeshStandardMaterial({ map: stripes('#3a6a3a', '#e0d0a8'), roughness: 0.95, side: THREE.DoubleSide }),
    canvasPurple: new THREE.MeshStandardMaterial({ map: stripes('#6a2a6a', '#e8c8d8'), roughness: 0.95, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    window: new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.6, emissive: new THREE.Color(0xff9a40), emissiveIntensity: 0 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.7 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x9a8058, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4a7a2a, roughness: 0.8, side: THREE.DoubleSide }),
    crop: new THREE.MeshStandardMaterial({ color: 0x7a9a3a, roughness: 0.85, side: THREE.DoubleSide }),
    soil: new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2a5a6a, roughness: 0.1, metalness: 0.2 }),
    fire: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9a2a20, roughness: 0.8 }),
    flagBlack: new THREE.MeshStandardMaterial({ map: canvasTex(128, 96, (g) => {
      g.fillStyle = '#111';
      g.fillRect(0, 0, 128, 96);
      g.fillStyle = '#eee';
      g.beginPath(); g.arc(64, 38, 16, 0, 7); g.fill();
      g.fillRect(56, 48, 16, 10);
      g.fillStyle = '#111';
      g.beginPath(); g.arc(58, 36, 4, 0, 7); g.arc(70, 36, 4, 0, 7); g.fill();
      g.strokeStyle = '#eee'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(34, 62); g.lineTo(94, 86); g.moveTo(94, 62); g.lineTo(34, 86); g.stroke();
    }), side: THREE.DoubleSide, roughness: 0.9 }),
  };
}
export function M() {
  return (_M ??= makeMats());
}

// ------------------------------------------------------------------------------------------------- geometry helpers

/** box with world-scaled UVs so textures keep a constant density */
export function boxGeo(w: number, h: number, d: number, texScale = 0.5): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const su = nx > 0.5 ? d : w, sv = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * su * texScale, uv.getY(i) * sv * texScale);
  }
  return g;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, texScale = 0.5): THREE.Mesh {
  return mesh(boxGeo(w, h, d, texScale), mat, x, y + h / 2, z, ry);
}

/** walls as a hollow-looking box, with dark door opening on the front (+z) */
export function walls(w: number, h: number, d: number, mat: THREE.Material, opts: { door?: boolean; windows?: number; doorW?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, d, mat));
  const k = M();
  if (opts.door !== false) {
    const dw = opts.doorW ?? Math.min(0.55, w * 0.3);
    g.add(box(dw, Math.min(h * 0.82, 0.95), 0.06, k.darkwood, 0, 0, d / 2 + 0.01));
    g.add(box(dw + 0.12, 0.08, 0.1, k.wood, 0, Math.min(h * 0.82, 0.95), d / 2 + 0.03));
  }
  const nw = opts.windows ?? Math.floor(w / 1.3);
  for (let i = 0; i < nw; i++) {
    const x = -w / 2 + ((i + 0.5) / nw) * w;
    if (opts.door !== false && Math.abs(x) < 0.45) continue;
    const win = box(0.28, 0.3, 0.05, k.window, x, h * 0.45, d / 2 + 0.01);
    win.userData.window = true;
    g.add(win);
    g.add(box(0.36, 0.05, 0.08, k.wood, x, h * 0.45 - 0.04, d / 2 + 0.03));
    // side windows
    if (i < Math.floor(d / 1.3)) {
      const z = -d / 2 + ((i + 0.5) / Math.max(1, Math.floor(d / 1.3))) * d;
      for (const sx of [-1, 1]) {
        const sw = box(0.05, 0.3, 0.28, k.window, (sx * w) / 2 + sx * 0.01, h * 0.45, z);
        sw.userData.window = true;
        g.add(sw);
      }
    }
  }
  return g;
}

/** gable roof spanning x (ridge along x), overhanging; returns group with roof + gable triangles */
export function gableRoof(w: number, d: number, rise: number, mat: THREE.Material, gableMat: THREE.Material, over = 0.25, y = 0): THREE.Group {
  const g = new THREE.Group();
  const hw = w / 2 + over, hd = d / 2 + over;
  const slope = Math.hypot(hd, rise);
  const thick = 0.12;
  for (const s of [-1, 1]) {
    const geo = boxGeo(hw * 2, thick, slope, 0.6);
    const m = mesh(geo, mat, 0, y + rise / 2, (s * hd) / 2);
    m.rotation.x = s * Math.atan2(rise, hd);
    g.add(m);
  }
  // gable ends
  const tri = new THREE.Shape();
  tri.moveTo(-d / 2, 0);
  tri.lineTo(d / 2, 0);
  tri.lineTo(0, rise * 0.97);
  tri.closePath();
  const tg = new THREE.ShapeGeometry(tri);
  const uv = tg.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  for (const s of [-1, 1]) {
    const m = mesh(tg, gableMat, (s * w) / 2, y, 0, s * Math.PI / 2);
    (m.material as THREE.Material).side = THREE.DoubleSide;
    g.add(m);
  }
  // ridge beam
  g.add(box(hw * 2 + 0.1, 0.1, 0.12, M().wood, 0, y + rise - 0.02, 0));
  return g;
}

/** four-sided hip / pyramid roof */
export function hipRoof(w: number, d: number, rise: number, mat: THREE.Material, over = 0.3, y = 0): THREE.Mesh {
  const hw = w / 2 + over, hd = d / 2 + over;
  const ridge = Math.max(0, hw - hd);
  const pos = [
    // front (+z)
    -hw, 0, hd, hw, 0, hd, ridge, rise, 0, -hw, 0, hd, ridge, rise, 0, -ridge, rise, 0,
    // back
    hw, 0, -hd, -hw, 0, -hd, -ridge, rise, 0, hw, 0, -hd, -ridge, rise, 0, ridge, rise, 0,
    // left
    -hw, 0, -hd, -hw, 0, hd, -ridge, rise, 0,
    // right
    hw, 0, hd, hw, 0, -hd, ridge, rise, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + pos[i + 2]) * 0.6, pos[i + 1] * 1.2 + Math.abs(pos[i + 2]) * 0.6 * (Math.abs(pos[i]) < hw - 0.01 ? 1 : 0));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const m = mesh(geo, mat, 0, y, 0);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}

/** conical thatched roof for round huts */
export function coneRoof(r: number, rise: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const geo = new THREE.ConeGeometry(r, rise, 16, 3, true);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 4, uv.getY(i) * rise * 1.2);
  const m = mesh(geo, mat, 0, y + rise / 2, 0);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  return m;
}

export function post(h: number, r = 0.06, mat: THREE.Material = M().wood, x = 0, z = 0, y = 0): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 6), mat, x, y + h / 2, z);
  return m;
}

/** sloped awning on the front */
export function awning(w: number, depth: number, y: number, z: number, mat: THREE.Material, drop = 0.3): THREE.Group {
  const g = new THREE.Group();
  const len = Math.hypot(depth, drop);
  const geo = new THREE.PlaneGeometry(w, len);
  const m = mesh(geo, mat, 0, y - drop / 2, z + depth / 2);
  m.rotation.x = -Math.PI / 2 + Math.atan2(drop, depth);
  g.add(m);
  // scalloped valance
  g.add(box(w, 0.12, 0.02, mat, 0, y - drop - 0.12, z + depth));
  g.add(post(y - drop, 0.04, M().wood, -w / 2 + 0.05, z + depth - 0.03));
  g.add(post(y - drop, 0.04, M().wood, w / 2 - 0.05, z + depth - 0.03));
  return g;
}

export function fence(len: number, mat: THREE.Material = M().wood): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 0.6));
  for (let i = 0; i <= n; i++) g.add(post(0.45, 0.035, mat, -len / 2 + (i / n) * len, 0));
  g.add(box(len, 0.04, 0.04, mat, 0, 0.32, 0));
  g.add(box(len, 0.04, 0.04, mat, 0, 0.16, 0));
  return g;
}

/** palisade of sharpened logs */
export function palisade(len: number, h = 1.1): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 0.16));
  const k = M();
  const geo = new THREE.CylinderGeometry(0.08, 0.09, h, 6);
  const tip = new THREE.ConeGeometry(0.085, 0.2, 6);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const hh = h * (0.92 + ((i * 7919) % 13) / 100);
    const x = -len / 2 + ((i + 0.5) / n) * len;
    parts.push(geo.clone().scale(1, hh / h, 1).translate(x, hh / 2, 0));
    parts.push(tip.clone().translate(x, hh + 0.1, 0));
  }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.add(mesh(merged, k.bark));
  return g;
}

export function barrelGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI) * 0.04, t * 0.42));
  }
  return new THREE.LatheGeometry(pts, 10);
}

export function crateStack(n: number, seed = 1): THREE.Group {
  const g = new THREE.Group();
  const k = M();
  for (let i = 0; i < n; i++) {
    const s = 0.28 + ((seed * 31 + i * 17) % 7) / 60;
    const x = ((i % 3) - 1) * 0.32, z = Math.floor(i / 3) % 2 * 0.32, y = Math.floor(i / 6) * s;
    g.add(box(s, s, s, k.oldplanks, x, y, z, ((seed + i) % 5) * 0.2, 1.2));
  }
  return g;
}

export function barrels(n: number): THREE.Group {
  const g = new THREE.Group();
  const geo = barrelGeo();
  const k = M();
  for (let i = 0; i < n; i++) {
    const m = mesh(geo, k.planksDark, ((i % 3) - 1) * 0.32, 0, Math.floor(i / 3) * 0.32);
    g.add(m);
    const hoop = mesh(new THREE.TorusGeometry(0.17, 0.012, 4, 12), k.iron, m.position.x, 0.12, m.position.z);
    hoop.rotation.x = Math.PI / 2;
    g.add(hoop);
    const hoop2 = hoop.clone();
    hoop2.position.y = 0.3;
    g.add(hoop2);
  }
  return g;
}

export function logPile(n: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.09, 0.1, 1.6, 7);
  geo.rotateZ(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(Math.sqrt(i * 2));
    const m = mesh(geo, M().bark, ((i * 13) % 5) * 0.05, 0.1 + row * 0.17, (i % 4) * 0.2 - 0.3);
    g.add(m);
  }
  return g;
}

export function lumberStack(n: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(box(1.4, 0.06, 0.18, M().planks, 0, (i >> 2) * 0.065, (i % 4) * 0.2 - 0.3, 0, 2));
  return g;
}

export function cannon(): THREE.Group {
  const g = new THREE.Group();
  const k = M();
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.11, 0.08), new THREE.Vector2(0.095, 0.12), new THREE.Vector2(0.08, 0.7), new THREE.Vector2(0.095, 0.74), new THREE.Vector2(0.06, 0.76), new THREE.Vector2(0.04, 0.72)];
  const barrel = mesh(new THREE.LatheGeometry(pts, 12), k.iron, 0, 0.26, -0.2);
  barrel.rotation.x = Math.PI / 2 - 0.08;
  g.add(barrel);
  g.add(box(0.3, 0.14, 0.6, k.wood, 0, 0.06, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 10), k.wood, sx * 0.17, 0.08, sz * 0.2);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  return g;
}

export function flag(material: THREE.Material, h = 2.2): THREE.Group {
  const g = new THREE.Group();
  g.add(post(h, 0.035, M().wood));
  const f = mesh(new THREE.PlaneGeometry(0.7, 0.48, 8, 1), material, 0.36, h - 0.3, 0);
  f.userData.flag = true;
  g.add(f);
  return g;
}

export function sign(text: string, color = '#e8d8a8'): THREE.Mesh {
  const tex = canvasTex(256, 96, (g) => {
    g.fillStyle = '#5a3a20';
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#2a1a10';
    g.lineWidth = 8;
    g.strokeRect(4, 4, 248, 88);
    g.fillStyle = color;
    g.font = 'bold 40px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 50);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  m.castShadow = true;
  return m;
}

/** stone/dirt platform the building sits on */
export function pad(w: number, d: number, mat: THREE.Material = M().stone, h = 0.12): THREE.Mesh {
  return box(w, h, d, mat, 0, -h * 0.4, 0, 0, 0.8);
}
