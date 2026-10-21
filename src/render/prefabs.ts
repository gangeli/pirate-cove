import * as THREE from 'three';
import { M, box, walls, gableRoof, hipRoof, coneRoof, post, awning, fence, palisade, crateStack, barrels, logPile, lumberStack, cannon, flag, sign, pad, mesh, boxGeo } from './kit';
import { props } from './props';
import { bldModels } from './bldmodels';
import { cropLayout } from './croplayout';

/**
 * Building models. Each prefab is built for rotation 0 with the front facing +z, footprint W (x) by D (z)
 * centred on the origin, ground at y = 0. Units are tiles.
 */
type Prefab = (W: number, D: number, level?: number) => THREE.Group;

function G(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.multiplyScalar(s);
  return o;
}
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** standard cottage: walls + gable roof */
function cottage(w: number, d: number, h: number, wall: THREE.Material, roof: THREE.Material, rise = 0.7, opts: { door?: boolean; windows?: number } = {}): THREE.Group {
  const g = walls(w, h, d, wall, opts);
  g.add(at(gableRoof(w, d, rise, roof, wall, 0.25), 0, h, 0));
  return g;
}
function chimney(x: number, z: number, h: number): THREE.Group {
  const g = G(box(0.28, h, 0.28, M().stone, 0, 0, 0, 0, 1.5), box(0.34, 0.08, 0.34, M().stoneDark, 0, h, 0));
  g.position.set(x, 0, z);
  g.userData.smoke = new THREE.Vector3(x, h + 0.1, z);
  return g;
}
/** a field of instanced plants; bare = plants only (the modelled farm supplies ground, walls and shelter) */
function crops(W: number, D: number, kind: string, bare = false): THREE.Group {
  const g = new THREE.Group();
  const k = M();
  // furrowed soil
  if (!bare) g.add(box(W - 0.15, 0.06, D - 0.15, k.soil, 0, -0.02, 0, 0, 1));
  const r = rand(kind.length * 97 + W * 7);
  const leafGeo = (() => {
    if (kind === 'banana' || kind === 'papaya') {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.7, 5).translate(0, 0.35, 0);
      parts.push(trunk.toNonIndexed());
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.PlaneGeometry(0.22, 0.75).translate(0, 0.35, 0);
        leaf.rotateX(-0.9);
        leaf.rotateY((i / 6) * Math.PI * 2);
        leaf.translate(0, 0.65, 0);
        parts.push(leaf.toNonIndexed());
      }
      return parts;
    }
    if (kind === 'sugarcane' || kind === 'corn') {
      const parts: THREE.BufferGeometry[] = [];
      const hgt = kind === 'corn' ? 0.6 : 0.85;
      for (let i = 0; i < 3; i++) {
        const stalk = new THREE.CylinderGeometry(0.012, 0.018, hgt, 4).translate((i - 1) * 0.06, hgt / 2, 0);
        parts.push(stalk.toNonIndexed());
        for (let j = 0; j < 3; j++) {
          const leaf = new THREE.PlaneGeometry(0.05, 0.35).translate(0, 0.17, 0);
          leaf.rotateX(-0.7);
          leaf.rotateY(j * 2.1 + i);
          leaf.translate((i - 1) * 0.06, hgt * (0.3 + j * 0.22), 0);
          parts.push(leaf.toNonIndexed());
        }
      }
      return parts;
    }
    // tobacco: broad leaves low
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.PlaneGeometry(0.16, 0.3).translate(0, 0.15, 0);
      leaf.rotateX(-1.0 + i * 0.05);
      leaf.rotateY(i * 2.4);
      leaf.translate(0, 0.05 + i * 0.05, 0);
      parts.push(leaf.toNonIndexed());
    }
    return parts;
  })();
  // a modelled plant when there is one; the old paper-leaf plant otherwise
  const plant = bldModels.meshOf('plant_' + kind);
  const merged = plant ? plant.geometry : new THREE.BufferGeometry().copy(mergeAll(leafGeo));
  const col = { corn: 0x86a840, banana: 0x5a9a38, papaya: 0x4a8a30, sugarcane: 0x8aa850, tobacco: 0x6a9a3a }[kind] ?? 0x6a9a3a;
  const mat = plant ? plant.material : new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide });
  const plants = cropLayout(W, D, kind, bare, r);
  const im = new THREE.InstancedMesh(merged, mat, Math.max(1, plants.length));
  let i = 0;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (const pl of plants) {
    q.setFromAxisAngle(up, pl.rot);
    mtx.compose(p.set(pl.x, 0.02, pl.z), q, s.set(pl.sc, pl.sc, pl.sc));
    if (plant) {
      // near-white jitter: some plants a little brighter, yellower or bluer than their neighbours
      const b = 0.82 + r() * 0.3;
      im.setColorAt(i, tint.setRGB(b * (0.95 + r() * 0.12), b, b * (0.82 + r() * 0.2)));
    }
    im.setMatrixAt(i++, mtx);
  }
  im.castShadow = true;
  im.receiveShadow = true;
  im.userData.crops = true;
  g.add(im);
  im.count = i;
  // fence along the back
  if (!bare) g.add(at(fence(W - 0.2), 0, 0, -D / 2 + 0.05));
  return g;
}
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // minimal merge (positions/uv) without importing utils again
  let n = 0;
  for (const p of parts) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position') as THREE.BufferAttribute;
    const ua = p.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pa.count; i++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], (o + i) * 3);
      if (ua) uv.set([ua.getX(i), ua.getY(i)], (o + i) * 2);
    }
    o += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function tent(w: number, d: number, h: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const hw = w / 2, hd = d / 2;
  // two sloping canvas sides + back triangle; front left open
  const pos = [
    -hw, 0, hd, -hw, 0, -hd, 0, h, -hd, -hw, 0, hd, 0, h, -hd, 0, h, hd,
    hw, 0, -hd, hw, 0, hd, 0, h, hd, hw, 0, -hd, 0, h, hd, 0, h, -hd,
    -hw, 0, -hd, hw, 0, -hd, 0, h, -hd,
  ];
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2] * 0.8, pos[i + 1] * 0.8 + Math.abs(pos[i]) * 0.5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  g.add(mesh(geo, mat));
  g.add(post(h, 0.03, M().wood, 0, hd), post(h, 0.03, M().wood, 0, -hd));
  g.add(box(0.04, 0.04, d + 0.1, M().wood, 0, h - 0.02, 0));
  // guy ropes
  for (const s of [-1, 1]) g.add(box(0.015, 0.015, 0.5, M().rope, 0, h * 0.75, s * (hd + 0.2)));
  return g;
}

function people(): THREE.Group {
  return new THREE.Group();
}

// ----------------------------------------------------------------------------------------------- houses by rank
function house(level: number, W: number, D: number): THREE.Group {
  const k = M();
  const g = new THREE.Group();
  switch (level) {
    case 1: {
      // staked-out plot
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(post(0.35, 0.03, k.wood, x * (W / 2 - 0.3), z * (D / 2 - 0.3)));
      g.add(box(W - 0.6, 0.02, 0.02, k.rope, 0, 0.3, D / 2 - 0.3));
      g.add(box(W - 0.6, 0.02, 0.02, k.rope, 0, 0.3, -D / 2 + 0.3));
      g.add(box(0.02, 0.02, D - 0.6, k.rope, W / 2 - 0.3, 0.3, 0));
      g.add(box(0.02, 0.02, D - 0.6, k.rope, -W / 2 + 0.3, 0.3, 0));
      g.add(at(sign('FOR RENT'), 0, 0.5, D / 2 - 0.25));
      g.add(post(0.5, 0.02, k.wood, 0, D / 2 - 0.3));
      break;
    }
    case 2:
      g.add(at(tent(1.4, 1.3, 0.9, k.canvas), 0, 0, 0));
      g.add(at(props.get('firepit', 0.5), 0.6, 0, 0.8));
      break;
    case 3: {
      // lean-to hovel of driftwood and palm thatch
      g.add(box(1.4, 0.7, 0.08, k.oldplanks, 0, 0, -0.5));
      g.add(box(0.08, 0.6, 1.0, k.oldplanks, -0.66, 0, 0));
      const roof = box(1.6, 0.06, 1.3, k.thatchDark, 0, 0.75, 0);
      roof.rotation.x = 0.28;
      g.add(roof, post(0.6, 0.04, k.wood, 0.7, 0.55), post(0.6, 0.04, k.wood, -0.7, 0.55));
      g.add(at(barrels(1), 0.6, 0, -0.1));
      break;
    }
    case 4:
      g.add(cottage(1.5, 1.2, 0.8, k.oldplanks, k.thatchDark, 0.55, { windows: 1 }));
      g.add(at(crateStack(2, 4), 0.95, 0, 0.6));
      break;
    case 5:
      g.add(cottage(1.7, 1.4, 0.9, k.plasterYellow, k.thatch, 0.6));
      g.add(at(props.get('barrel', 0.9), 1.0, 0, 0.7));
      break;
    case 6:
      g.add(cottage(2.0, 1.5, 1.0, k.plasterBlue, k.thatch, 0.7));
      g.add(at(awning(1.2, 0.5, 0.8, 0.75, k.canvasBlue), 0, 0, 0));
      break;
    case 7:
      g.add(cottage(2.1, 1.7, 1.1, k.plaster, k.tiles, 0.75));
      g.add(at(chimney(0.7, -0.4, 2.0), 0, 0, 0));
      g.add(at(fence(2.6), 0, 0, 1.3));
      break;
    case 8: {
      const b = walls(2.2, 1.8, 1.7, k.plasterPink, { windows: 2 });
      b.add(at(hipRoof(2.2, 1.7, 0.7, k.tiles), 0, 1.8, 0));
      g.add(b, at(awning(2.0, 0.5, 1.0, 0.85, k.canvasRed, 0.2), 0, 0, 0), at(chimney(-0.7, -0.4, 2.7), 0, 0, 0));
      break;
    }
    default: {
      const b = walls(2.5, 2.0, 1.9, k.plaster, { windows: 3 });
      b.add(at(hipRoof(2.5, 1.9, 0.8, k.tiles), 0, 2.0, 0));
      // veranda with columns
      b.add(box(2.6, 0.08, 0.6, k.planks, 0, 0.95, 1.25));
      for (let i = 0; i < 4; i++) b.add(post(0.95, 0.06, k.plaster, -1.15 + i * 0.77, 1.5));
      g.add(b, at(flag(k.flagBlack, 3.2), 1.25, 0, 0.9), at(chimney(0.8, -0.5, 3.0), 0, 0, 0));
      for (const x of [-1.2, 1.2]) g.add(at(props.get('shrub', 0.6), x, 0, 1.3));
    }
  }
  return g;
}

// ----------------------------------------------------------------------------------------------- prefab table
const P: Record<string, Prefab> = {
  palace: (W, D, level = 0) => {
    const k = M();
    const g = new THREE.Group();
    g.add(pad(W - 0.2, D - 0.2, k.stone, 0.25));
    const main = walls(5.2, 2.6, 3.0, k.plaster, { windows: 4, doorW: 0.8 });
    main.add(at(hipRoof(5.2, 3.0, 1.2, k.tiles, 0.35), 0, 2.6, 0));
    main.position.set(0, 0.12, -0.6);
    g.add(main);
    // veranda columns and balcony
    g.add(box(5.4, 0.1, 0.9, k.stone, 0, 1.3, 1.35));
    for (let i = 0; i < 6; i++) g.add(post(1.3, 0.09, k.plaster, -2.5 + i, 1.7, 0.1));
    g.add(box(5.4, 0.12, 0.12, k.wood, 0, 1.5, 1.75));
    // wings
    for (const s of [-1, 1]) {
      const wing = walls(1.6, 1.8, 2.4, k.plasterYellow, { door: false, windows: 1 });
      wing.add(at(hipRoof(1.6, 2.4, 0.8, k.tiles), 0, 1.8, 0));
      g.add(at(wing, s * 3.4, 0.12, -0.4));
    }
    // stairs
    for (let i = 0; i < 4; i++) g.add(box(1.4, 0.1, 0.3, k.stone, 0, i * 0.08, 2.4 - i * 0.18));
    // towers at higher levels
    if (level >= 2) for (const s of [-1, 1]) {
      const t = G(box(0.9, 3.6, 0.9, k.stone), at(coneRoof(0.75, 1.1, k.tiles), 0, 3.6, 0));
      g.add(at(t, s * 4.0, 0, -2.2));
    }
    if (level >= 3) g.add(at(G(box(1.2, 1.0, 1.2, k.plaster), at(hipRoof(1.2, 1.2, 0.9, k.tiles), 0, 1.0, 0)), 0, 3.85, -0.6));
    g.add(at(flag(k.flagBlack, 3.6), 2.0, 3.6, -0.6));
    g.add(at(flag(k.flagBlack, 2.5), -4.2, 0, 2.4));
    g.add(at(flag(k.flagBlack, 2.5), 4.2, 0, 2.4));
    for (const x of [-3.2, -1.6, 1.6, 3.2]) g.add(at(props.get('shrub', 0.8), x, 0, 2.5));
    g.add(at(cannon(), -1.2, 0, 2.6, 0.1), at(cannon(), 1.2, 0, 2.6, -0.1));
    return g;
  },
  stockade: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const h = 1.2;
    g.add(at(palisade(W - 0.2, h), 0, 0, -D / 2 + 0.1));
    g.add(at(palisade(W - 0.2, h), -W / 2 + 0.1, 0, 0, Math.PI / 2));
    g.add(at(palisade(W - 0.2, h), W / 2 - 0.1, 0, 0, Math.PI / 2));
    g.add(at(palisade((W - 1.4) / 2, h), -(W + 1.4) / 4 + 0.05, 0, D / 2 - 0.1));
    g.add(at(palisade((W - 1.4) / 2, h), (W + 1.4) / 4 - 0.05, 0, D / 2 - 0.1));
    // gate posts and lintel with skulls
    g.add(post(1.6, 0.1, k.bark, -0.7, D / 2 - 0.1), post(1.6, 0.1, k.bark, 0.7, D / 2 - 0.1), box(1.6, 0.14, 0.14, k.bark, 0, 1.5, D / 2 - 0.1));
    for (const x of [-0.4, 0, 0.4]) g.add(at(props.get('skull', 0.18), x, 1.6, D / 2 - 0.05));
    // lean-to shelters inside
    for (let i = 0; i < 3; i++) {
      const r = box(1.2, 0.05, 0.9, k.thatchDark, -1.4 + i * 1.4, 0.75, -1.6);
      r.rotation.x = 0.35;
      g.add(r, post(0.7, 0.03, k.wood, -1.9 + i * 1.4, -1.25), post(0.7, 0.03, k.wood, -0.9 + i * 1.4, -1.25));
    }
    // corner watch platform
    g.add(at(G(post(1.8, 0.06, k.wood, -0.3, -0.3), post(1.8, 0.06, k.wood, 0.3, -0.3), post(1.8, 0.06, k.wood, -0.3, 0.3), post(1.8, 0.06, k.wood, 0.3, 0.3), box(0.9, 0.08, 0.9, k.planks, 0, 1.8, 0), at(coneRoof(0.7, 0.6, k.thatch), 0, 2.4, 0)), W / 2 - 0.6, 0, -D / 2 + 0.6));
    return g;
  },
  sawmill: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    // open shed with heavy posts
    const sw = 3.6, sd = 2.4;
    for (const x of [-sw / 2, 0, sw / 2]) for (const z of [-sd / 2, sd / 2]) g.add(post(1.3, 0.09, k.bark, x, z));
    g.add(at(gableRoof(sw, sd, 0.9, k.thatch, k.planks, 0.3), 0, 1.3, 0));
    // saw trestle and log on it
    g.add(box(2.2, 0.6, 0.12, k.wood, 0, 0, -0.2), box(2.2, 0.6, 0.12, k.wood, 0, 0, 0.3));
    const log = mesh(new THREE.CylinderGeometry(0.2, 0.22, 2.4, 9).rotateZ(Math.PI / 2), k.bark, 0, 0.82, 0.05);
    g.add(log);
    g.add(box(0.03, 1.1, 0.5, k.iron, 0.3, 0.4, 0.05));
    g.add(at(logPile(10), -W / 2 + 1.0, 0, D / 2 - 0.6));
    g.add(at(lumberStack(16), W / 2 - 1.0, 0, D / 2 - 0.6, Math.PI / 2));
    g.add(at(lumberStack(10), W / 2 - 0.9, 0, -D / 2 + 0.7));
    g.add(at(props.get('barrel', 0.8), -W / 2 + 0.5, 0, -D / 2 + 0.5));
    return g;
  },
  timber_camp: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    g.add(at(cottage(1.6, 1.3, 0.85, k.oldplanks, k.thatchDark, 0.6, { windows: 1 }), -0.6, 0, -0.7));
    g.add(at(logPile(12), 0.9, 0, 0.6, 0.3));
    g.add(at(logPile(6), -0.7, 0, 1.0, -0.2));
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.35, 10), k.bark, 0.4, 0.17, -0.6));
    g.add(at(props.get('axe', 0.5), 0.4, 0.35, -0.6, 0.4));
    return g;
  },
  construction_tent: (W, D) => {
    const k = M();
    return G(tent(1.4, 1.2, 1.0, k.canvas), at(lumberStack(8), 0.55, 0, 0.6, 0.2), at(crateStack(2, 3), -0.6, 0, 0.6), at(props.get('bucket', 0.4), 0.7, 0, -0.6));
  },
  chuck_tent: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    g.add(at(awning(1.7, 1.4, 1.0, -0.7, k.canvasGreen, 0.15), 0, 0, 0));
    g.add(post(1.0, 0.04, k.wood, -0.82, -0.7), post(1.0, 0.04, k.wood, 0.82, -0.7));
    g.add(at(props.get('firepit', 0.55), 0, 0, -0.1));
    // cauldron
    const pot = mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), k.iron, 0, 0.42, -0.1);
    g.add(pot);
    g.add(at(props.get('table', 0.45), 0.5, 0, 0.55, Math.PI / 2));
    g.add(at(barrels(2), -0.6, 0, 0.5));
    g.userData.smoke = new THREE.Vector3(0, 0.6, -0.1);
    return g;
  },
  bunkhouse: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    for (const x of [-0.7, 0.7]) for (const z of [-0.6, 0.6]) g.add(post(0.3, 0.05, k.bark, x, z));
    const hut = cottage(1.7, 1.4, 0.75, k.oldplanks, k.thatch, 0.65, { windows: 1 });
    hut.position.y = 0.3;
    g.add(hut);
    for (let i = 0; i < 3; i++) g.add(box(0.5, 0.05, 0.25, k.planks, 0, i * 0.1, 0.85 + i * 0.12));
    return g;
  },
  housing_plot: (W, D, level = 1) => house(level, W, D),
  cave: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const rock = mesh(new THREE.DodecahedronGeometry(1.4, 1), k.stoneDark, 0, 0.6, -0.3);
    rock.scale.set(1.1, 0.9, 1);
    g.add(rock);
    const rock2 = mesh(new THREE.DodecahedronGeometry(0.8, 1), k.stoneDark, 0.9, 0.4, 0.3);
    g.add(rock2);
    g.add(box(0.7, 0.85, 0.3, k.black, 0, 0, 0.85));
    g.add(post(1.0, 0.06, k.wood, -0.45, 0.95), post(1.0, 0.06, k.wood, 0.45, 0.95), box(1.1, 0.1, 0.12, k.wood, 0, 0.95, 0.95));
    g.add(at(props.get('skull', 0.3), 0, 1.08, 1.0));
    for (const x of [-0.7, 0.7]) {
      const t = post(0.8, 0.03, k.wood, x, 1.1);
      t.userData.torch = new THREE.Vector3(x, 0.85, 1.1);
      g.add(t);
    }
    g.add(at(props.get('chest', 0.4), 0.5, 0, 1.2, -0.5));
    return g;
  },
  black_market: (W, D) => {
    const k = M();
    return G(at(awning(2.4, 1.6, 1.2, -0.9, k.canvasPurple, 0.2), 0, 0, 0), post(1.2, 0.04, k.wood, -1.15, -0.9), post(1.2, 0.04, k.wood, 1.15, -0.9),
      at(crateStack(5, 2), -0.6, 0, -0.3), at(barrels(3), 0.7, 0, -0.4), box(1.6, 0.5, 0.4, k.planksDark, 0, 0, 0.5), at(props.get('chest', 0.35), 0.4, 0.5, 0.5), at(props.get('lantern', 0.25), -0.6, 0.5, 0.5));
  },
  smugglers_cove: (W, D) => {
    const k = M();
    return G(cottage(3.0, 2.0, 1.1, k.oldplanks, k.thatchDark, 0.7), at(barrels(5), -1.2, 0, 1.2), at(crateStack(6, 5), 1.0, 0, 1.2), at(props.get('lantern', 0.3), 0.4, 0.9, 1.05));
  },
  corn_farm: (W, D) => crops(W, D, 'corn'),
  banana_farm: (W, D) => crops(W, D, 'banana'),
  papaya_farm: (W, D) => crops(W, D, 'papaya'),
  sugar_farm: (W, D) => crops(W, D, 'sugarcane'),
  tobacco_farm: (W, D) => crops(W, D, 'tobacco'),
  iron_mine: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const hill = mesh(new THREE.DodecahedronGeometry(1.6, 1), k.stoneDark, -0.4, 0.3, -0.6);
    hill.scale.set(1.3, 0.8, 0.9);
    g.add(hill);
    g.add(box(0.8, 0.9, 0.4, k.black, -0.4, 0, 0.55));
    g.add(post(1.0, 0.07, k.bark, -0.85, 0.7), post(1.0, 0.07, k.bark, 0.05, 0.7), box(1.1, 0.12, 0.14, k.bark, -0.4, 0.98, 0.7));
    // rails & cart
    for (const x of [-0.55, -0.25]) g.add(box(0.04, 0.03, 1.6, k.iron, x, 0, 1.3));
    g.add(box(0.5, 0.3, 0.6, k.planksDark, -0.4, 0.05, 1.5));
    g.add(at(G(mesh(new THREE.DodecahedronGeometry(0.2), k.red), mesh(new THREE.DodecahedronGeometry(0.16), k.stoneDark, 0.15, 0, 0.1)), -0.4, 0.4, 1.5));
    g.add(at(props.get('bucket', 0.4), 1.2, 0, 0.8), at(crateStack(2, 9), 1.3, 0, -0.2));
    return g;
  },
  blast_furnace: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const tower = mesh(new THREE.CylinderGeometry(0.7, 1.0, 2.6, 10), k.stone, -0.8, 1.3, -0.3);
    g.add(tower);
    const glow = mesh(new THREE.BoxGeometry(0.4, 0.4, 0.1), M().fire, -0.8, 0.4, 0.62);
    glow.userData.glow = true;
    g.add(glow);
    g.add(at(chimney(-0.8, -0.3, 3.4), 0, 0, 0));
    g.add(at(cottage(2.0, 1.6, 1.0, k.planksDark, k.thatchDark, 0.6, { windows: 1 }), 1.1, 0, -0.3));
    g.add(at(G(mesh(new THREE.DodecahedronGeometry(0.3), k.red), mesh(new THREE.DodecahedronGeometry(0.25), k.red, 0.3, -0.05, 0.1)), 0.6, 0.15, 1.3));
    g.add(at(lumberStack(4), 1.5, 0, 1.2));
    g.userData.smoke = new THREE.Vector3(-0.8, 3.5, -0.3);
    return g;
  },
  blacksmithy: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    for (const x of [-1.1, 1.1]) for (const z of [-0.9, 0.9]) g.add(post(1.1, 0.07, k.bark, x, z));
    g.add(at(gableRoof(2.3, 1.9, 0.7, k.thatchDark, k.planks, 0.25), 0, 1.1, 0));
    g.add(box(0.9, 0.6, 0.7, k.stone, -0.5, 0, -0.4));
    const glow = mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), M().fire, -0.5, 0.62, -0.4);
    glow.userData.glow = true;
    g.add(glow);
    g.add(at(chimney(-0.5, -0.6, 2.4), 0, 0, 0));
    g.add(box(0.35, 0.3, 0.18, k.iron, 0.5, 0.25, 0.2), box(0.2, 0.25, 0.2, k.wood, 0.5, 0, 0.2));
    g.add(at(barrels(1), 0.9, 0, -0.6));
    g.userData.smoke = new THREE.Vector3(-0.5, 2.5, -0.6);
    return g;
  },
  gunsmithy: (W, D) => G(cottage(2.8, 2.2, 1.2, M().plaster, M().tiles, 0.8), at(crateStack(3, 2), 1.4, 0, 1.4), at(sign('GUNS'), 0, 1.0, 1.13)),
  cannon_foundry: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const hall = walls(4.0, 2.0, 3.0, k.stone, { windows: 3, doorW: 1.0 });
    hall.add(at(gableRoof(4.0, 3.0, 1.0, k.tiles, k.stone, 0.3), 0, 2.0, 0));
    g.add(at(hall, 0, 0, -0.6));
    g.add(at(chimney(1.4, -1.4, 3.8), 0, 0, 0));
    for (let i = 0; i < 3; i++) g.add(at(cannon(), -1.5 + i * 0.9, 0, 1.6, 0.2 * i));
    g.userData.smoke = new THREE.Vector3(1.4, 3.9, -1.4);
    return g;
  },
  brewery: (W, D) => {
    const k = M();
    return G(cottage(2.2, 1.8, 1.2, k.planks, k.thatch, 0.75), at(barrels(4), -0.9, 0, 1.15), at(props.get('barrels', 0.7), 0.9, 0, 1.1), at(sign('BREWERY'), 0, 1.0, 0.93));
  },
  distillery: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const main = walls(4.0, 1.6, 2.6, k.plasterYellow, { windows: 3 });
    main.add(at(hipRoof(4.0, 2.6, 0.9, k.tiles), 0, 1.6, 0));
    g.add(at(main, 0, 0, -0.8));
    for (const x of [-1.2, 0]) {
      const still = mesh(new THREE.SphereGeometry(0.45, 12, 10), k.brass, x, 0.5, 1.2);
      still.scale.y = 1.2;
      g.add(still, mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), k.brass, x + 0.3, 1.0, 1.2));
    }
    g.add(at(barrels(5), 1.6, 0, 1.4), at(chimney(1.4, -1.6, 3.0), 0, 0, 0));
    g.userData.smoke = new THREE.Vector3(1.4, 3.1, -1.6);
    return g;
  },
  cigar_factory: (W, D) => {
    const k = M();
    const g = G(cottage(3.0, 1.6, 1.1, k.plasterPink, k.tiles, 0.7));
    // drying racks with leaves
    for (let i = 0; i < 3; i++) {
      g.add(post(0.9, 0.03, k.wood, -1.3 + i * 1.3, 1.2), post(0.9, 0.03, k.wood, -0.7 + i * 1.3, 1.2));
      g.add(box(0.6, 0.35, 0.02, M().crop, -1.0 + i * 1.3, 0.45, 1.2));
    }
    return g;
  },
  bakery: (W, D) => {
    const k = M();
    const g = G(cottage(2.0, 1.6, 1.0, k.plaster, k.thatch, 0.7), at(sign('BAKERY'), 0, 0.9, 0.83));
    const oven = mesh(new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.stone, 0.6, 0, 1.1);
    g.add(oven, at(chimney(0.6, 1.3, 1.1), 0, 0, 0));
    g.userData.smoke = new THREE.Vector3(0.6, 1.2, 1.3);
    return g;
  },
  // ------------------------------------------------------------------------------------------- entertainment
  dive: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const hut = cottage(2.4, 1.2, 1.0, k.oldplanks, k.thatchDark, 0.6, { windows: 1 });
    g.add(at(hut, 0, 0, -0.3));
    g.add(at(awning(2.4, 0.8, 0.95, 0.3, k.canvasRed, 0.2), 0, 0, 0));
    g.add(at(barrels(2), -1.0, 0, 0.5), at(props.get('roundtable', 0.5), 0.3, 0, 0.6), at(props.get('stool', 0.35), 0.75, 0, 0.6), at(props.get('stool', 0.35), -0.1, 0, 0.65));
    g.add(at(sign('DIVE'), 0, 1.15, 0.3));
    return g;
  },
  wench_hut: (W, D) => {
    const k = M();
    const g = G(cottage(1.4, 1.2, 0.85, k.plasterPink, k.thatch, 0.6, { windows: 1 }));
    const lamp = at(props.get('lantern', 0.25), 0.5, 0.6, 0.65);
    lamp.userData.redLight = true;
    g.add(lamp, post(0.65, 0.02, k.wood, 0.5, 0.65));
    g.add(box(0.5, 0.6, 0.02, M().red, 0, 0.1, 0.62));
    return g;
  },
  animal_pit: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const ring = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.45, 20, 1, true), k.planks, 0, 0.22, 0);
    (ring.material as THREE.Material).side = THREE.DoubleSide;
    g.add(ring, mesh(new THREE.CircleGeometry(0.98, 20).rotateX(-Math.PI / 2), k.dirt, 0, 0.02, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      g.add(at(box(0.8, 0.25, 0.25, k.planks), Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3, -a + Math.PI / 2));
    }
    g.add(at(props.get('chicken', 0.3), 0.2, 0, 0), at(props.get('chicken', 0.3), -0.3, 0, 0.2, 2));
    g.add(at(sign('PIT'), 0, 0.9, 1.35), post(0.8, 0.03, k.wood, 0, 1.36));
    return g;
  },
  eatery: (W, D) => {
    const k = M();
    return G(at(cottage(2.4, 1.2, 1.0, k.plasterYellow, k.tiles, 0.6), 0, 0, -0.3), at(awning(2.4, 0.8, 0.95, 0.3, k.canvasGreen, 0.2), 0, 0, 0),
      at(props.get('table', 0.5), 0, 0, 0.6), at(sign('EATS'), 0, 1.15, 0.3), at(chimney(-0.9, -0.5, 1.9), 0, 0, 0));
  },
  gambling_den: (W, D) => {
    const k = M();
    return G(at(cottage(3.2, 2.0, 1.2, k.planksDark, k.thatchDark, 0.8), 0, 0, -0.2), at(awning(3.0, 0.7, 1.15, 0.8, k.canvasPurple, 0.2), 0, 0, 0),
      at(sign('DICE'), 0, 1.35, 0.82), at(barrels(2), 1.4, 0, 1.2), at(props.get('roundtable', 0.5), -0.9, 0, 1.2));
  },
  brothel: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const b = walls(4.4, 2.2, 2.6, k.plasterPink, { windows: 3, doorW: 0.7 });
    b.add(at(hipRoof(4.4, 2.6, 1.0, k.tiles), 0, 2.2, 0));
    g.add(at(b, 0, 0, -0.4));
    // balcony
    g.add(box(4.2, 0.08, 0.6, k.planks, 0, 1.1, 1.2));
    for (let i = 0; i < 5; i++) g.add(post(1.1, 0.04, k.wood, -2 + i, 1.45));
    g.add(box(4.2, 0.05, 0.04, k.wood, 0, 1.45, 1.48));
    g.add(at(awning(4.2, 0.4, 2.1, 0.9, k.canvasRed, 0.15), 0, 0, 0));
    for (const x of [-1.6, 1.6]) {
      const l = at(props.get('lantern', 0.28), x, 0.85, 0.95);
      l.userData.redLight = true;
      g.add(l);
    }
    g.add(at(sign('SALON', '#f8c8d8'), 0, 1.6, 0.92));
    return g;
  },
  tavern: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const b = walls(2.4, 1.9, 2.0, k.planks, { windows: 2 });
    b.add(at(gableRoof(2.4, 2.0, 0.85, k.thatch, k.planks, 0.3), 0, 1.9, 0));
    g.add(at(b, 0, 0, -0.3));
    g.add(at(barrels(3), -0.9, 0, 1.1), at(props.get('table', 0.45), 0.6, 0, 1.0, Math.PI / 2));
    const s = sign('TAVERN');
    g.add(at(s, 0.9, 1.5, 0.95), at(chimney(-0.8, -0.8, 3.0), 0, 0, 0));
    g.userData.smoke = new THREE.Vector3(-0.8, 3.1, -0.8);
    return g;
  },
  inn: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const b = walls(4.0, 2.4, 2.6, k.plaster, { windows: 3, doorW: 0.7 });
    b.add(at(gableRoof(4.0, 2.6, 1.1, k.tiles, k.plaster, 0.3), 0, 2.4, 0));
    // half timbering
    for (let i = 0; i < 5; i++) b.add(box(0.08, 2.4, 0.04, k.darkwood, -2 + i, 0, 1.31));
    b.add(box(4.0, 0.08, 0.05, k.darkwood, 0, 1.2, 1.31));
    g.add(at(b, 0, 0, -0.4));
    g.add(at(awning(3.6, 0.6, 1.1, 0.9, k.canvasBlue, 0.15), 0, 0, 0), at(sign('THE INN'), 0, 1.5, 0.93), at(chimney(1.4, -1.2, 3.6), 0, 0, 0));
    g.add(at(props.get('table', 0.5), -1.2, 0, 1.4), at(barrels(2), 1.4, 0, 1.4));
    g.userData.smoke = new THREE.Vector3(1.4, 3.7, -1.2);
    return g;
  },
  casino: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const b = walls(4.2, 2.3, 2.6, k.plasterYellow, { windows: 3, doorW: 0.8 });
    b.add(at(hipRoof(4.2, 2.6, 0.8, k.tiles), 0, 2.3, 0));
    g.add(at(b, 0, 0, -0.5));
    for (let i = 0; i < 4; i++) g.add(post(2.0, 0.09, k.plaster, -1.5 + i, 1.15));
    g.add(box(4.2, 0.2, 0.6, k.plaster, 0, 2.0, 1.05));
    g.add(at(sign('CASINO', '#f0d060'), 0, 2.3, 1.36), at(flag(k.flagBlack, 1.6), 1.8, 2.3, -0.5));
    return g;
  },
  courtesan: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(post(1.2, 0.06, k.plaster, x, z));
    g.add(at(hipRoof(2.0, 2.0, 0.8, k.tiles), 0, 1.2, 0));
    g.add(box(2.1, 0.12, 2.1, k.stone, 0, 0, 0));
    g.add(at(awning(1.8, 0.01, 1.15, 1.0, k.canvasBlue, 0.0), 0, 0, 0));
    g.add(box(0.9, 0.25, 0.6, k.red, 0, 0.12, -0.3), at(props.get('shrub', 0.5), 1.2, 0, 1.2), at(props.get('shrub', 0.5), -1.2, 0, 1.2));
    return g;
  },
  // ------------------------------------------------------------------------------------------- nautical
  dock: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    // ramp from beach (front, +z) out to sea (-z)
    const deckY = 0.35;
    g.add(box(1.4, 0.1, D + 0.6, k.planks, 0, deckY - 0.05, -0.3, 0, 1.4));
    g.add(box(W - 0.4, 0.1, 1.2, k.planks, 0, deckY - 0.05, -D / 2 + 0.6, 0, 1.4));
    for (let i = 0; i < 5; i++) for (const x of [-0.65, 0.65]) g.add(post(deckY + 2.5, 0.08, k.bark, x, D / 2 - 0.3 - i * 0.9, -2.5));
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3, -0.5, 0.5]) g.add(post(deckY + 2.5, 0.09, k.bark, x, -D / 2 + 0.15, -2.5), post(deckY + 2.5, 0.09, k.bark, x, -D / 2 + 1.1, -2.5));
    // bollards
    for (const x of [-W / 2 + 0.5, W / 2 - 0.5]) g.add(post(0.25, 0.07, k.iron, x, -D / 2 + 0.25, deckY));
    g.add(at(crateStack(4, 7), -1.4, deckY, -D / 2 + 0.7), at(barrels(3), 1.4, deckY, -D / 2 + 0.6));
    g.add(at(props.get('lantern', 0.25), 0.6, deckY + 0.6, D / 2 - 0.4), post(0.8, 0.03, k.wood, 0.6, D / 2 - 0.4, deckY - 0.2));
    g.userData.deckY = deckY;
    return g;
  },
  ration_factory: (W, D) => {
    const k = M();
    return G(at(cottage(3.0, 2.2, 1.1, k.oldplanks, k.thatch, 0.75), 0, 0, -0.4), at(barrels(6), -1.0, 0, 1.3), at(crateStack(5, 1), 1.0, 0, 1.3), at(sign('RATIONS'), 0, 0.95, 0.73));
  },
  boatyard: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    // slipway down to the sea at the back (-z)
    const slip = box(1.8, 0.1, D + 1.6, k.planksDark, 0, 0, -0.8, 0, 1.2);
    slip.rotation.x = -0.08;
    g.add(slip);
    g.add(at(cottage(1.6, 1.4, 1.0, k.oldplanks, k.thatchDark, 0.6), 1.6, 0, 1.4));
    g.add(at(lumberStack(12), -1.7, 0, 1.6), at(logPile(8), -1.6, 0, 0.2, Math.PI / 2));
    // gantry
    g.add(post(2.4, 0.08, k.bark, -1.1, -1.2), post(2.4, 0.08, k.bark, 1.1, -1.2), box(2.4, 0.12, 0.12, k.bark, 0, 2.35, -1.2));
    g.add(box(0.02, 1.4, 0.02, k.rope, 0, 1.0, -1.2));
    g.userData.hull = new THREE.Vector3(0, 0.1, -0.8);
    return g;
  },
  shipyard: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const slip = box(3.0, 0.12, D + 2.4, k.planksDark, 0, 0, -1.2, 0, 1.2);
    slip.rotation.x = -0.06;
    g.add(slip);
    const shed = walls(3.0, 1.6, 2.0, k.planks, { windows: 2 });
    shed.add(at(gableRoof(3.0, 2.0, 0.8, k.tiles, k.planks), 0, 1.6, 0));
    g.add(at(shed, W / 2 - 1.8, 0, D / 2 - 1.3));
    g.add(at(lumberStack(20), -W / 2 + 1.2, 0, D / 2 - 1.0), at(logPile(14), -W / 2 + 1.4, 0, -0.2, Math.PI / 2));
    for (const z of [-2.2, 0.2]) g.add(post(3.4, 0.1, k.bark, -1.8, z), post(3.4, 0.1, k.bark, 1.8, z), box(3.8, 0.14, 0.14, k.bark, 0, 3.35, z));
    g.add(at(flag(k.flagBlack, 3), W / 2 - 0.5, 0, -D / 2 + 0.5));
    g.userData.hull = new THREE.Vector3(0, 0.15, -1.0);
    return g;
  },
  // ------------------------------------------------------------------------------------------- control
  church: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const nave = walls(3.8, 1.6, 2.0, k.plaster, { windows: 3, doorW: 0.6 });
    nave.add(at(gableRoof(3.8, 2.0, 1.0, k.tiles, k.plaster, 0.2), 0, 1.6, 0));
    g.add(at(nave, -0.6, 0, 0));
    const tower = G(box(1.1, 2.9, 1.1, k.plaster), at(hipRoof(1.1, 1.1, 0.9, k.tiles, 0.15), 0, 2.9, 0), box(0.5, 0.5, 0.05, k.black, 0, 2.2, 0.56));
    g.add(at(tower, 1.9, 0, 0.2));
    // cross
    g.add(box(0.06, 0.55, 0.06, k.darkwood, 1.9, 3.75, 0.2), box(0.32, 0.06, 0.06, k.darkwood, 1.9, 4.08, 0.2));
    g.add(at(props.get('shrub', 0.5), -2.4, 0, 1.0));
    return g;
  },
  apothecary: (W, D) => G(cottage(2.0, 1.6, 1.0, M().plaster, M().tiles, 0.7), at(awning(1.6, 0.6, 0.9, 0.8, M().canvasGreen, 0.2), 0, 0, 0), at(sign('APOTHECARY', '#c8f0c8'), 0, 1.15, 0.82)),
  gallows: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    g.add(box(2.6, 0.7, 1.8, k.planksDark, 0, 0, 0, 0, 1.2));
    for (let i = 0; i < 4; i++) g.add(box(0.8, 0.1, 0.25, k.planks, 1.6, i * 0.17, 0.6 - i * 0.2));
    g.add(post(2.2, 0.08, k.darkwood, -0.7, 0, 0.7), post(2.2, 0.08, k.darkwood, 0.7, 0, 0.7), box(1.7, 0.12, 0.12, k.darkwood, 0, 2.85, 0));
    for (const x of [-0.4, 0.4]) {
      const rope = box(0.02, 0.7, 0.02, k.rope, x, 2.15, 0);
      g.add(rope);
      const loop = mesh(new THREE.TorusGeometry(0.09, 0.015, 4, 10), k.rope, x, 2.07, 0);
      loop.userData.swing = true;
      g.add(loop);
    }
    g.add(at(props.get('skull', 0.2), -1.0, 0.7, 0.6));
    return g;
  },
  interrogation: (W, D) => {
    const k = M();
    const g = G(walls(3.6, 1.8, 2.6, k.stoneDark, { windows: 0, doorW: 0.6 }));
    g.children[0].add(at(hipRoof(3.6, 2.6, 0.6, k.stoneDark, 0.1), 0, 1.8, 0));
    g.add(box(0.6, 0.9, 0.05, k.iron, 0, 0, 1.33));
    for (let i = 0; i < 3; i++) g.add(box(0.2, 0.25, 0.04, k.black, -1.2 + i * 1.2, 1.2, 1.31));
    g.add(at(props.get('skull', 0.22), -0.6, 1.1, 1.36), at(props.get('skull', 0.22), 0.6, 1.1, 1.36));
    const iron = at(G(box(0.5, 0.05, 0.05, k.iron, 0, 1.6, 0), box(0.05, 0.6, 0.05, k.iron, 0, 1.0, 0)), 1.5, 0, 1.6);
    g.add(iron);
    return g;
  },
  hotel: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const b = walls(4.6, 3.2, 3.6, k.plasterBlue, { windows: 4, doorW: 0.8 });
    for (const y of [1.1, 2.2]) b.add(box(4.6, 0.08, 0.08, k.plaster, 0, y, 1.82));
    b.add(at(hipRoof(4.6, 3.6, 1.1, k.tiles), 0, 3.2, 0));
    g.add(at(b, 0, 0, -0.6));
    g.add(at(awning(3.8, 0.8, 1.0, 1.2, k.canvasBlue, 0.15), 0, 0, 0), at(sign('HOTEL'), 0, 1.3, 1.24));
    for (const x of [-2.2, 2.2]) g.add(at(props.get('shrub', 0.7), x, 0, 2.3));
    return g;
  },
  orderly_shrubs: () => G(at(props.get('shrub', 0.6), 0, 0, 0), at(props.get('shrub', 0.4), 0.25, 0, 0.25)),
  orderly_decor: () => {
    const k = M();
    return G(box(0.5, 0.5, 0.5, k.stone), at(G(mesh(new THREE.CapsuleGeometry(0.13, 0.45, 4, 8), k.stone, 0, 0.35, 0), mesh(new THREE.SphereGeometry(0.11, 8, 6), k.stone, 0, 0.75, 0), mesh(new THREE.ConeGeometry(0.16, 0.12, 3), k.stone, 0, 0.88, 0)), 0, 0.5, 0));
  },
  scary_decor: () => {
    const k = M();
    return G(post(1.5, 0.03, k.wood, -0.15, 0), at(props.get('skull', 0.2), -0.15, 1.5, 0), post(1.2, 0.03, k.wood, 0.2, 0.15), at(props.get('skull', 0.18), 0.2, 1.2, 0.15));
  },
  very_scary_decor: () => {
    const k = M();
    const g = G(post(2.0, 0.06, k.darkwood, -0.3, 0), box(0.7, 0.06, 0.06, k.darkwood, 0, 1.97, 0));
    const cage = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 8, 1, true), k.iron, 0.2, 1.45, 0);
    (cage.material as THREE.MeshStandardMaterial).wireframe = false;
    cage.userData.swing = true;
    g.add(cage, box(0.02, 0.25, 0.02, k.iron, 0.2, 1.75, 0), at(props.get('skull', 0.16), 0.2, 1.3, 0));
    return g;
  },
  // ------------------------------------------------------------------------------------------- schools
  school_gunnery: () => G(cottage(3.0, 1.6, 1.1, M().stone, M().tiles, 0.7), at(cannon(), -1.0, 0, 1.2), at(cannon(), 0.2, 0, 1.2), at(sign('GUNNERY'), 0, 0.95, 0.83)),
  school_marksman: () => {
    const k = M();
    const g = G(at(cottage(2.2, 1.4, 1.0, k.planks, k.thatch, 0.6), -0.8, 0, -0.4));
    for (let i = 0; i < 2; i++) {
      const t = mesh(new THREE.CircleGeometry(0.3, 16), new THREE.MeshStandardMaterial({ color: i ? 0xe8e0c0 : 0xb03030 }), 1.6, 0.6, -0.6 + i * 0.9);
      t.rotation.y = -Math.PI / 2;
      g.add(t, post(0.4, 0.03, k.wood, 1.62, -0.6 + i * 0.9));
    }
    return g;
  },
  school_sword: () => {
    const k = M();
    const g = G(at(cottage(2.4, 1.6, 1.0, k.planks, k.thatch, 0.7), 0, 0, -0.9));
    for (let i = 0; i < 3; i++) g.add(post(0.9, 0.05, k.wood, -1.2 + i * 1.2, 1.2), box(0.5, 0.06, 0.06, k.wood, -1.2 + i * 1.2, 0.7, 1.2), mesh(new THREE.SphereGeometry(0.12, 6, 5), k.rope, -1.2 + i * 1.2, 0.95, 1.2));
    return g;
  },
  school_seaman: () => {
    const k = M();
    const g = G(at(cottage(2.2, 1.4, 1.0, k.planks, k.thatch, 0.6), 0, 0, -0.9));
    g.add(post(3.0, 0.07, k.wood, 0.9, 0.9), box(1.4, 0.06, 0.06, k.wood, 0.9, 2.4, 0.9), mesh(new THREE.PlaneGeometry(1.2, 1.0), k.canvas, 0.9, 1.85, 0.95));
    return g;
  },
  school_nav: () => {
    const k = M();
    const g = G(at(cottage(2.6, 1.6, 1.1, k.plaster, k.tiles, 0.7), 0, 0, -0.5));
    const globe = mesh(new THREE.SphereGeometry(0.3, 14, 10), k.brass, 1.2, 0.75, 1.1);
    g.add(globe, post(0.45, 0.03, k.wood, 1.2, 1.1));
    return g;
  },
  // ------------------------------------------------------------------------------------------- defense
  fort: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    const h = 1.6;
    // walls
    const wall = (len: number) => G(box(len, h, 0.6, k.stone, 0, 0, 0, 0, 0.8), ...Array.from({ length: Math.floor(len / 0.6) }, (_, i) => box(0.3, 0.3, 0.6, k.stone, -len / 2 + 0.3 + i * 0.6, h, 0)));
    g.add(at(wall(W - 1.6), 0, 0, -D / 2 + 0.5), at(wall(W - 1.6), 0, 0, D / 2 - 0.5));
    g.add(at(wall(D - 1.6), -W / 2 + 0.5, 0, 0, Math.PI / 2), at(wall(D - 1.6), W / 2 - 0.5, 0, 0, Math.PI / 2));
    // bastions
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const b = mesh(new THREE.CylinderGeometry(0.9, 1.0, h + 0.4, 10), k.stone, sx * (W / 2 - 0.8), (h + 0.4) / 2, sz * (D / 2 - 0.8));
      g.add(b, at(cannon(), sx * (W / 2 - 0.8), h + 0.4, sz * (D / 2 - 0.8), Math.atan2(sx, sz) + Math.PI, 1.3));
    }
    // gate
    g.add(box(1.2, 1.1, 0.7, k.darkwood, 0, 0, D / 2 - 0.5));
    // keep
    const keep = walls(2.6, 2.2, 1.8, k.stone, { windows: 2 });
    keep.add(at(hipRoof(2.6, 1.8, 0.6, k.tiles), 0, 2.2, 0));
    g.add(at(keep, 0, 0, -0.6));
    for (let i = 0; i < 4; i++) g.add(at(cannon(), -2.4 + i * 1.6, h, -D / 2 + 0.5, Math.PI, 1.2));
    g.add(at(flag(k.flagBlack, 3.2), 0, 2.2, -0.6));
    g.add(at(barrels(3), 2.4, 0, 0.8), at(G(mesh(new THREE.SphereGeometry(0.08, 6, 4), k.iron, 0, 0.08, 0), mesh(new THREE.SphereGeometry(0.08, 6, 4), k.iron, 0.16, 0.08, 0), mesh(new THREE.SphereGeometry(0.08, 6, 4), k.iron, 0.08, 0.2, 0)), -2.4, 0, 0.8));
    return g;
  },
  watch_tower: () => {
    const k = M();
    const g = new THREE.Group();
    for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) {
      const p = post(2.8, 0.07, k.bark, x * 0.9, z * 0.9);
      p.rotation.set(z * 0.06, 0, -x * 0.06);
      g.add(p);
    }
    g.add(box(1.5, 0.1, 1.5, k.planks, 0, 2.7, 0), at(coneRoof(1.1, 0.9, k.thatch), 0, 3.6, 0));
    for (const s of [-1, 1]) g.add(box(1.5, 0.35, 0.05, k.planks, 0, 2.8, s * 0.72), box(0.05, 0.35, 1.5, k.planks, s * 0.72, 2.8, 0));
    g.add(post(0.9, 0.03, k.wood, 0.6, 0.6, 2.8));
    // ladder
    g.add(box(0.04, 2.8, 0.04, k.wood, -0.15, 0, 0.85), box(0.04, 2.8, 0.04, k.wood, 0.15, 0, 0.85));
    for (let i = 0; i < 9; i++) g.add(box(0.32, 0.03, 0.03, k.wood, 0, 0.2 + i * 0.3, 0.85));
    return g;
  },
  observatory: () => {
    const k = M();
    return G(mesh(new THREE.CylinderGeometry(0.9, 1.1, 2.6, 12), k.stone, 0, 1.3, 0), mesh(new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.brass, 0, 2.6, 0),
      at(mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.3, 8), k.brass, 0, 0, 0), 0.5, 3.1, 0.4));
  },
  surgery: () => G(cottage(2.0, 1.6, 1.0, M().plaster, M().thatch, 0.7), at(sign('SAWBONES', '#f0b0b0'), 0, 0.9, 0.83), at(props.get('bucket', 0.4), 0.8, 0, 1.0)),
  protective_cannon: () => G(at(cannon(), 0, 0.05, 0, Math.PI, 1.3), box(0.8, 0.08, 0.8, M().stone)),
  anchor: () => {
    const k = M();
    return G(box(0.06, 1.0, 0.06, k.iron, 0, 0.1, 0), box(0.5, 0.05, 0.05, k.iron, 0, 0.9, 0), at(mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 12, Math.PI), k.iron, 0, 0.3, 0), 0, 0, 0), mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 10), k.iron, 0, 1.15, 0));
  },
  anarchy_decor: () => G(flag(M().flagBlack, 2.6), at(props.get('skull', 0.18), 0, 0.2, 0.15)),
  anarchy_shrubs: () => G(at(props.get('bush', 0.8), 0, 0, 0)),
  // ------------------------------------------------------------------------------------------- accoutrements
  carpenter: () => G(cottage(3.0, 1.4, 1.0, M().planks, M().thatch, 0.6), at(lumberStack(6), 1.4, 0, 0.9), at(sign('PEG LEGS'), -0.6, 0.85, 0.73)),
  hat_shop: () => G(cottage(2.2, 1.8, 1.0, M().plasterBlue, M().tiles, 0.7), at(awning(2.0, 0.6, 0.9, 0.9, M().canvasBlue, 0.2), 0, 0, 0), at(sign('HATS'), 0, 1.15, 0.93)),
  aviary: () => {
    const k = M();
    const g = new THREE.Group();
    const cage = mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a7a50, wireframe: true }), -0.4, 0.8, 0);
    g.add(cage, at(coneRoof(1.0, 0.7, k.thatch), -0.4, 1.6, 0), at(cottage(1.0, 1.2, 0.8, k.planks, k.thatch, 0.5, { windows: 0 }), 0.9, 0, 0));
    for (let i = 0; i < 4; i++) g.add(at(props.get('parrot', 0.25), -0.4 + Math.cos(i * 1.6) * 0.4, 0.5 + i * 0.25, Math.sin(i * 1.6) * 0.4, i));
    return g;
  },
  graveyard: (W, D) => {
    const k = M();
    const g = new THREE.Group();
    g.add(at(fence(W - 0.2), 0, 0, -D / 2 + 0.1), at(fence(W - 0.2), 0, 0, D / 2 - 0.1), at(fence(D - 0.2), -W / 2 + 0.1, 0, 0, Math.PI / 2), at(fence(D - 0.2), W / 2 - 0.1, 0, 0, Math.PI / 2));
    const r = rand(7);
    for (let i = 0; i < 6; i++) {
      const x = -W / 2 + 0.5 + (i % 3) * 0.9, z = -0.35 + Math.floor(i / 3) * 0.75;
      if (r() < 0.5) g.add(box(0.3, 0.4, 0.08, k.stone, x, 0, z, (r() - 0.5) * 0.3));
      else g.add(box(0.05, 0.45, 0.05, k.darkwood, x, 0, z), box(0.25, 0.05, 0.05, k.darkwood, x, 0.32, z));
      g.add(box(0.3, 0.06, 0.55, k.dirt, x, 0, z + 0.3));
    }
    return g;
  },
};

const FARM_CROP: Record<string, string> = { corn_farm: 'corn', banana_farm: 'banana', papaya_farm: 'papaya', sugar_farm: 'sugarcane', tobacco_farm: 'tobacco' };

export function buildPrefab(def: string, W: number, D: number, level = 1): THREE.Group {
  // modelled buildings first (per level where a building has levels), procedural otherwise
  const made = bldModels.get(`${def}_${level}`) ?? bldModels.get(def);
  if (made) {
    const crop = FARM_CROP[def];
    if (crop) made.add(crops(W, D, crop, true));
    return made;
  }
  const f = P[def];
  if (f) return f(W, D, level);
  // fallback: generic cottage scaled to footprint
  return G(cottage(Math.min(W - 0.4, 3), Math.min(D - 0.4, 2.4), 1.1, M().plaster, M().thatch, 0.7));
}

/** scaffold poles around a footprint, for construction sites */
export function scaffold(W: number, D: number, h: number): THREE.Group {
  const k = M();
  const g = new THREE.Group();
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) g.add(post(h, 0.035, k.bark, x, z));
  for (let y = 0.6; y < h; y += 0.7) {
    g.add(box(W - 0.3, 0.04, 0.04, k.bark, 0, y, D / 2 - 0.2), box(W - 0.3, 0.04, 0.04, k.bark, 0, y, -D / 2 + 0.2));
    g.add(box(0.04, 0.04, D - 0.3, k.bark, W / 2 - 0.2, y, 0), box(0.04, 0.04, D - 0.3, k.bark, -W / 2 + 0.2, y, 0));
  }
  // timber waiting just inside the lot's front edge (the front can face a neighbour as well as a road)
  const ls = Math.min(1, (W - 0.3) / 1.4);
  g.add(at(lumberStack(8), W >= 3 ? W / 2 - 0.85 : 0, 0, D / 2 - 0.05 - 0.4 * ls, 0, ls));
  return g;
}

export { boxGeo, people };
