import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { ShipType } from '../sim/data/ships';
import type { Ship } from '../sim/types';
import { dockBerth } from '../sim/people';
import { DT } from '../sim/time';
import type { World } from './world';
import { assetUrl } from './textures';
import { markSharedTree, markShared } from './dispose';
import { M, flag } from './kit';
import { bldModels } from './bldmodels';
import { wind } from './vegetation';
import { gpu } from './backend';
import type { Nation } from '../sim/data/kings';

/**
 * Ships, modelled in the buildings' kit (scripts/blender/bld/ships.py): one model per class, bow toward +x, the
 * waterline at y = 0, a real deck closing the hull. The sails are not in the model: each ship builds its own from
 * the model's sail plan (ship_<name>.json) so they can furl at the dock and set at sea, and a vertex shader billows
 * and flutters them (and the flags and pennants) with the world's clock, which stands still while the game is paused.
 */

/** the model each class sails in */
const MODEL: Record<ShipType, string> = { snow: 'snow', schooner: 'schooner', sloop: 'sloop', brigantine: 'brigantine', frigate: 'frigate', galleon: 'galleon' };
/** target length overall (bowsprit to boom end) in tiles per ship type */
const LENGTH: Record<ShipType, number> = { snow: 7, schooner: 7.5, sloop: 9, brigantine: 10, frigate: 12.5, galleon: 14 };
export const NAV_LENGTH = 9;
/** camera distance (in ship lengths) beyond which the far model is drawn */
const LOD_LENGTHS = 2.6;
/** the direction flags and pennants stream (world, radians about y) */
const WIND_DIR = 0.6;

interface SailDef { kind: 'sq' | 'fa' | 'jib' | 'lat'; c: number[][] }
interface Plan { length: number; height: number; beam: number; deck: number; draft: number; sails: SailDef[]; flags: { p: number[]; kind: string }[] }
interface ShipModel { near: THREE.Object3D | null; far: THREE.Object3D; plan: Plan }

const models = new Map<string, ShipModel>();
const loads = new Map<string, Promise<ShipModel | null>>();

function loadShipModel(k: string): Promise<ShipModel | null> {
  let p = loads.get(k);
  if (!p) {
    p = loadShipModelNow(k).then(
      (m) => (models.set(k, m), m),
      (e) => {
        console.warn('ship model failed', k, e);
        loads.delete(k); // asked for again on a later frame
        return null;
      },
    );
    loads.set(k, p);
  }
  return p;
}

async function loadShipModelNow(k: string): Promise<ShipModel> {
  const name = `ship_${k}`;
  const planP = fetch(assetUrl(`ships/${name}.json`)).then((r) => {
    if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
    return r.json() as Promise<Plan>;
  });
  // low quality draws the far model throughout (as for buildings)
  const [plan, far, near] = await Promise.all([planP, bldModels.loadKit('ships', `${name}_lod`), bldModels.fullDetail ? bldModels.loadKit('ships', name) : Promise.resolve(null)]);
  for (const m of [near, far]) {
    if (!m) continue;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    markSharedTree(m); // cached for the whole session: never freed with a game's views
  }
  return { near, far, plan };
}

/** the loaded model for a ship type, or null (its load is started, and the caller asks again next frame) */
function shipModel(type: ShipType): ShipModel | null {
  const m = models.get(MODEL[type]);
  if (m) return m;
  void loadShipModel(MODEL[type]);
  return null;
}

// ------------------------------------------------------------------------------------------- cloth (sails, flags)

/**
 * The cloth shader: every vertex moves along its normal by aSail.x (its belly) x a slow breathing plus aSail.y (its
 * free play) x a wave running along aSail.z (nodes.ts shipClothMaterial is the WebGPU twin). One program for all
 * the sails, flags and pennants of every ship, and one depth twin that casts their shadows as they move (a shadow of
 * the cloth at rest would fall on the billowing sail in blotches).
 */
const CLOTH_GLSL = `#include <begin_vertex>
  {
    float ph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.23;
    float breathe = sin(uTime * 1.3 + ph) * 0.12 + sin(uTime * 2.9 + ph * 1.7) * 0.05;
    transformed += objectNormal * (aSail.x * breathe + aSail.y * sin(uTime * 6.0 - aSail.z + ph));
  }`;
function clothShader(m: THREE.Material, key: string): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aSail;')
      .replace('#include <begin_vertex>', CLOTH_GLSL);
  };
  m.customProgramCacheKey = () => key;
}
const clothMats = new Map<THREE.Material, THREE.Material>();
function clothMaterial(base: THREE.Material): THREE.Material {
  let m = clothMats.get(base);
  if (m) return m;
  const g = gpu();
  if (g) m = g.shipClothMaterial(base as any, wind.uTime) as unknown as THREE.Material;
  else {
    m = base.clone();
    clothShader(m, 'shipcloth');
  }
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  markShared(m);
  clothMats.set(base, m);
  return m;
}
let clothDepthMat: THREE.MeshDepthMaterial | null = null;
/** WebGL: the cloth's shadow caster (the node material's shadow pass takes its positionNode by itself) */
function castCloth(m: THREE.Mesh): void {
  m.castShadow = true;
  if (gpu()) return;
  if (!clothDepthMat) {
    // objectNormal is only declared where the normal chunks run: the depth program skips them, so build it here
    clothDepthMat = new THREE.MeshDepthMaterial(); // as the shadow map's own depth material
    clothDepthMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aSail;')
        .replace('#include <begin_vertex>', CLOTH_GLSL.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec3 objectNormal = vec3(normal);'));
    };
    clothDepthMat.customProgramCacheKey = () => 'shipclothdepth';
    markShared(clothDepthMat);
  }
  m.customDepthMaterial = clothDepthMat;
}

let sailBase: THREE.Material | null = null;

/**
 * sailcloth: the kit's canvas colour in clean, faintly painted strokes, sewn from narrow vertical cloths (the
 * texture tiles across every sail). A vertex colour darkens the canvas as it is rolled up on the yards.
 */
function sailMaterial(): THREE.Material {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe7d3';
  g.fillRect(0, 0, N, N);
  // a soft brushed tone, tiling: low, broad bands at whole periods across the tile (no speckle to shimmer)
  const img = g.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
      const k = 1 + 0.018 * Math.sin(v * 2 + Math.sin(u) * 0.8) + 0.012 * Math.sin(u * 4 + v) + 0.008 * Math.sin(v * 7 - u * 2);
      const i = (y * N + x) * 4;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
    }
  g.putImageData(img, 0, 0);
  // the seams between the cloths: a fine stitched shadow line and the light catching the overlap beside it
  for (let x = 0; x < N; x += 32) {
    g.fillStyle = 'rgba(140,118,84,0.22)';
    g.fillRect(x, 0, 1, N);
    g.fillStyle = 'rgba(255,252,240,0.25)';
    g.fillRect(x + 1, 0, 2, N);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, color: new THREE.Color('#ddd2b8').multiplyScalar(1.12), roughness: 0.95, side: THREE.DoubleSide, vertexColors: true });
}
let pennantBase: THREE.Material | null = null;

/** sail grid resolution */
const NU = 8, NV = 6;

/**
 * One ship's sails as a single mesh. The rest shape, belly and furled shape of every vertex are kept, and
 * `setFurl` blends between set (0) and furled (1) on the CPU (only while a ship is furling or setting sail).
 */
class Sails {
  readonly mesh: THREE.Mesh;
  private rest: Float32Array;
  private belly: Float32Array;
  private furled: Float32Array;
  /** per vertex: belly depth, free play, wave phase, at full sail */
  private play: Float32Array;
  furl = -1;

  constructor(plan: Plan) {
    const n = plan.sails.length * (NU + 1) * (NV + 1);
    this.rest = new Float32Array(n * 3);
    this.belly = new Float32Array(n * 3);
    this.furled = new Float32Array(n * 3);
    this.play = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const p = new THREE.Vector3(), top = new THREE.Vector3(), bot = new THREE.Vector3(), q = new THREE.Vector3();
    let base = 0;
    for (const s of plan.sails) {
      [A, B, C, D].forEach((v, i) => v.fromArray(s.c[i]));
      // the side it bellies to: square sails forward, fore-and-aft sails to starboard (the wind is on the port side)
      const dir = s.kind === 'sq' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0.15, 0, 1).normalize();
      const width = Math.max(A.distanceTo(B), D.distanceTo(C)), height = Math.max(A.distanceTo(D), B.distanceTo(C));
      const depth = 0.13 * Math.min(width, height) + 0.02 * Math.max(width, height);
      const chord = s.kind === 'sq' ? height : width;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        for (let i = 0; i <= NU; i++) {
          const u = i / NU;
          const k = base + j * (NU + 1) + i;
          top.lerpVectors(A, B, u);
          bot.lerpVectors(D, C, u);
          p.lerpVectors(top, bot, v);
          p.toArray(this.rest, k * 3);
          let f: number, w: number, tr: number;
          if (s.kind === 'sq') {
            // lashed along the yard, held at the clews: deepest low in the middle, the foot free to flog
            f = Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * v * 0.5) ** 0.7 * (1 - 0.3 * v * v);
            w = v ** 1.2 * (0.3 + 0.7 * Math.sin(Math.PI * u));
            tr = v * chord * 2.4;
          } else {
            // laced to mast (luff) and spars or stay: the leech is free
            f = Math.sin(Math.PI * u * 0.9) ** 0.8 * Math.sin(Math.PI * (s.kind === 'jib' || s.kind === 'lat' ? 0.2 + 0.6 * v : v)) ** 0.8;
            w = u ** 1.3 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, v * 1.1)));
            tr = u * chord * 2.4;
          }
          q.copy(dir).multiplyScalar(f * depth).toArray(this.belly, k * 3);
          this.play[k * 3] = f * depth;
          this.play[k * 3 + 1] = w * (0.012 + 0.008 * Math.min(width, height));
          this.play[k * 3 + 2] = tr;
          uv[k * 2] = u * width * 1.1;
          uv[k * 2 + 1] = v * height * 1.1;
          // furled: rolled up along the pinned edge (the yard, the boom or the foot of the stay), fattest mid-yard
          const r = 0.05 + 0.06 * Math.sin(Math.PI * u) ** 0.7;
          const a = v * Math.PI * 2.6;
          if (s.kind === 'sq') {
            // on top of the yard (its axis lies 0.07 abaft the sail's head and 0.04 above it), a little forward
            q.lerpVectors(A, B, 0.04 + u * 0.92).add(new THREE.Vector3(-0.04 + Math.cos(a) * r, 0.04 + r * 0.55 + Math.sin(a) * r, 0));
          } else if (s.kind === 'fa') {
            // lashed on top of the boom
            q.lerpVectors(D, C, 0.03 + u * 0.94).add(new THREE.Vector3(0, r * 0.6 + Math.sin(a) * r, Math.cos(a) * r));
          } else if (s.kind === 'lat') {
            // a lateen: furled along its yard (its luff, head A to tack D, runs down the grid), under it
            const rl = 0.05 + 0.06 * Math.sin(Math.PI * v) ** 0.7, al = u * Math.PI * 2.6;
            q.lerpVectors(A, D, 0.03 + v * 0.94).add(new THREE.Vector3(0, -rl * 0.4 + Math.sin(al) * rl, Math.cos(al) * rl));
          } else {
            q.lerpVectors(D, C, u * 0.25).lerp(D, 0.15).add(new THREE.Vector3(0, 0.04 + Math.sin(a) * r, Math.cos(a) * r));
          }
          q.toArray(this.furled, k * 3);
        }
      }
      // wind each quad so its normal faces the belly side (the shader displaces along the normal)
      const n0 = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(D, A));
      const flip = n0.dot(dir) < 0;
      for (let j = 0; j < NV; j++)
        for (let i = 0; i < NU; i++) {
          const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 2, d = a + NU + 1;
          if (flip) idx.push(a, d, b, b, d, c);
          else idx.push(a, b, d, b, c, d);
        }
      base += (NU + 1) * (NV + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSail', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(idx);
    sailBase ??= sailMaterial();
    this.mesh = new THREE.Mesh(g, clothMaterial(sailBase));
    castCloth(this.mesh);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'sails';
    this.setFurl(0);
  }

  setFurl(f: number): void {
    f = Math.max(0, Math.min(1, f));
    if (Math.abs(f - this.furl) < 1e-4) return;
    this.furl = f;
    const g = this.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute, ps = pos.array as Float32Array;
    const att = g.getAttribute('aSail') as THREE.BufferAttribute, as = att.array as Float32Array;
    const col = g.getAttribute('color') as THREE.BufferAttribute, cs = col.array as Float32Array;
    // furling gathers the foot up first, then rolls it in
    const e = f * f * (3 - 2 * f), keep = 1 - e;
    for (let i = 0; i < ps.length; i++) ps[i] = (this.rest[i] + this.belly[i] * keep) * keep + this.furled[i] * e;
    for (let i = 0; i < as.length; i += 3) {
      as[i] = this.play[i] * keep;
      as[i + 1] = this.play[i + 1] * keep * keep;
      as[i + 2] = this.play[i + 2];
    }
    // rolled canvas: the folds shade each other, a little warmer and darker than the cloth spread to the sun
    const cr = 1 - 0.26 * e, cg = 1 - 0.3 * e, cb = 1 - 0.36 * e;
    for (let i = 0; i < cs.length; i += 3) (cs[i] = cr), (cs[i + 1] = cg), (cs[i + 2] = cb);
    pos.needsUpdate = true;
    att.needsUpdate = true;
    col.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** a flag's cloth: the kit flag with free play growing toward the fly, waving in the cloth shader */
function waveFlag(fl: THREE.Group): void {
  fl.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.userData.flag) return;
    const g = m.geometry;
    const pos = g.getAttribute('position');
    const a = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const fx = pos.getX(i) + 0.35;
      a[i * 3 + 1] = 0.07 * fx;
      a[i * 3 + 2] = fx * 6;
    }
    g.setAttribute('aSail', new THREE.BufferAttribute(a, 3));
    m.material = clothMaterial(m.material as THREE.Material);
    castCloth(m);
  });
}

/** a long tapering masthead pennant streaming along local +x from the origin */
function pennant(len: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(len, 0.16, 14, 1);
  g.translate(len / 2, -0.08, 0);
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), t = x / len;
    pos.setY(i, -0.08 + (pos.getY(i) + 0.08) * (1 - 0.85 * t));
    a[i * 3 + 1] = 0.12 * t;
    a[i * 3 + 2] = t * 9;
  }
  g.setAttribute('aSail', new THREE.BufferAttribute(a, 3));
  g.computeVertexNormals();
  pennantBase ??= new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.9, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, clothMaterial(pennantBase));
  castCloth(m);
  return m;
}

// ------------------------------------------------------------------------------------------- wake

/** trail points per wake (newest first), how long a point's foam lasts (s) and the slowest speed that raises any */
const WK = 28, WAKE_LIFE = 6, WAKE_MIN = 0.3;
/**
 * The ribbon's vertices lie this far below sea level and its shader lifts them back onto the swell: the ambient
 * occlusion's normal pass draws the scene without the shaders, and a ribbon level with (or just above) the flat
 * water there shows as dark blotches (z-fighting) and a dark line along its edge. Sunk, the water hides it.
 */
const WAKE_SINK = 1;

let wakeMat: THREE.Material | null = null;
/**
 * The wake's foam (nodes.ts wakeMaterial is the WebGPU twin): the water's own foam noise, thresholded by how much
 * churn and Kelvin arms each point of the ribbon carries, on the same swell as the water so it rides the waves. Not
 * an opaque decal: nothing but scattered foam shows, thinning to nothing at the edges and along the trail.
 */
function wakeMaterial(u: Record<string, THREE.IUniform>): THREE.Material {
  if (wakeMat) return wakeMat;
  const g = gpu();
  wakeMat = g
    ? (g.wakeMaterial(u as any, WAKE_SINK) as unknown as THREE.Material)
    : new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        defines: { WAKE_SINK: WAKE_SINK.toFixed(1) },
        vertexShader: /* glsl */ `
uniform float uTime;
attribute vec3 aWake;
varying vec3 vW; varying vec2 vXZ;
#include <fog_pars_vertex>
vec3 gerstner(vec2 p, vec2 dir, float steep, float wl, float t){
  float k = 6.2831/wl; float c = sqrt(9.8/k); vec2 d = normalize(dir);
  float f = k*(dot(d,p) - c*t); float a = steep/k;
  return vec3(d.x*a*cos(f), a*sin(f), d.y*a*cos(f));
}
void main(){
  vec3 wp = position + vec3(0.0, WAKE_SINK, 0.0); // built in world space, sunk (see Wake)
  vec3 off = gerstner(wp.xz, vec2(1.0,0.3), 0.08, 18.0, uTime) + gerstner(wp.xz, vec2(-0.4,1.0), 0.06, 11.0, uTime) + gerstner(wp.xz, vec2(0.7,-0.8), 0.05, 6.0, uTime);
  wp += off * 0.6 + vec3(0.0, 0.1, 0.0);
  vW = aWake; vXZ = wp.xz;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
        fragmentShader: /* glsl */ `
uniform float uTime; uniform float uNight;
varying vec3 vW; varying vec2 vXZ;
#include <fog_pars_fragment>
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
void main(){
  float ax = abs(vW.x);
  float arms = smoothstep(0.5, 0.8, ax) * (1.0 - smoothstep(0.82, 1.0, ax));
  float churn = 1.0 - smoothstep(0.08, 0.5, ax);
  float cover = clamp(arms * vW.z + churn * vW.y, 0.0, 1.0);
  // the shore foam's noise and drift, a little finer
  vec2 p = vXZ * 3.4 + uTime * 0.3;
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { n += a * vnoise(p); p *= 2.03; a *= 0.5; }
  float lo = 0.66 - cover * 0.3;
  // flecks, over a faint milky streak where the water is stirred up
  float foam = max(smoothstep(lo, lo + 0.22, n) * min(1.0, cover * 2.0), cover * 0.3 * smoothstep(0.25, 0.65, n));
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * mix(1.0, 0.25, uNight), foam * 0.7);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
      });
  if (!g) {
    const m = wakeMat as THREE.ShaderMaterial;
    m.uniforms.uTime = u.uTime;
    m.uniforms.uNight = u.uNight;
  }
  markShared(wakeMat);
  return wakeMat;
}

/**
 * A ship's wake: a ribbon laid along the bow's recent track, so it bends through the ship's turns. Each point keeps
 * the time and speed it was laid at: the foam spreads into the two arms of a Kelvin wake as it ages, the churn
 * starts at the stern, and everything fades with age, with distance astern and with the speed she was making.
 * Three vertices across (the edges and the keel line) so the ribbon follows the swell; rebuilt only while it shows.
 */
class Wake {
  readonly mesh: THREE.Mesh;
  private px = new Float32Array(WK);
  private pz = new Float32Array(WK);
  private pt = new Float32Array(WK);
  private ps = new Float32Array(WK);
  private n = 0;
  private live = false;
  private lastT = -1;
  private lastX = 0;
  private lastZ = 0;

  constructor(private L: number, private halfBeam: number, u: Record<string, THREE.IUniform>) {
    const nv = (WK + 1) * 3; // bow, stern and WK - 1 laid points, three across
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWake', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let j = 0; j < WK; j++)
      for (let k = 0; k < 2; k++) {
        const a = j * 3 + k, b = a + 1, c = a + 4, d = a + 3;
        idx.push(a, d, b, b, d, c);
      }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, wakeMaterial(u));
    this.mesh.name = 'wake';
    this.mesh.renderOrder = 3; // after the water
    this.mesh.frustumCulled = false; // a handful of vertices, rebuilt as she moves
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  /**
   * Lay the trail of a ship whose bow is at (x, z) and stern at (sx, sz), making `speed`; t is the world clock (still
   * while paused). The ribbon runs along the keel from the bow to the stern, then along the stern's track.
   */
  update(x: number, z: number, sx: number, sz: number, speed: number, t: number): void {
    // paused (the clock and the ship stand still): the ribbon too
    if (t === this.lastT && x === this.lastX && z === this.lastZ) return;
    this.lastT = t;
    this.lastX = x;
    this.lastZ = z;
    const L = this.L, seg = L * 0.08;
    const px = this.px, pz = this.pz;
    // a new point every `seg` along the track; points whose foam has gone are dropped off the end
    if ((this.n === 0 && speed > WAKE_MIN) || (this.n > 0 && Math.hypot(sx - px[0], sz - pz[0]) >= seg)) {
      px.copyWithin(1, 0, WK - 1);
      pz.copyWithin(1, 0, WK - 1);
      this.pt.copyWithin(1, 0, WK - 1);
      this.ps.copyWithin(1, 0, WK - 1);
      px[0] = sx;
      pz[0] = sz;
      this.pt[0] = t;
      this.ps[0] = speed;
      this.n = Math.min(WK - 1, this.n + 1);
    }
    while (this.n > 0 && t - this.pt[this.n - 1] > WAKE_LIFE) this.n--;
    if (this.n === 0) {
      if (this.live) (this.mesh.visible = false), (this.live = false);
      return;
    }
    const g = this.mesh.geometry;
    const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const wk = (g.getAttribute('aWake') as THREE.BufferAttribute).array as Float32Array;
    const m = this.n + 2; // the live bow and stern, then the laid points
    let along = 0, any = false, ox = x, oz = z;
    for (let j = 0; j < m; j++) {
      // point j: the bow, the stern, then the laid points astern
      const cx = j === 0 ? x : j === 1 ? sx : px[j - 2], cz = j === 0 ? z : j === 1 ? sz : pz[j - 2];
      along += Math.hypot(cx - ox, cz - oz);
      ox = cx;
      oz = cz;
      // the track's direction here: from the point astern to the point ahead
      const ja = Math.max(0, j - 1), jb = Math.min(m - 1, j + 1);
      let tx = (ja === 0 ? x : ja === 1 ? sx : px[ja - 2]) - (jb === 1 ? sx : px[jb - 2]);
      let tz = (ja === 0 ? z : ja === 1 ? sz : pz[ja - 2]) - (jb === 1 ? sz : pz[jb - 2]);
      const tl = Math.hypot(tx, tz);
      if (tl < 1e-5) (tx = 1), (tz = 0);
      else (tx /= tl), (tz /= tl);
      const age = j < 2 ? 0 : t - this.pt[j - 2], sp = j < 2 ? speed : this.ps[j - 2];
      const life = Math.max(0, 1 - age / WAKE_LIFE) ** 1.5 * Math.min(1, Math.max(0, (sp - WAKE_MIN) / 1.6)) * (1 - smooth(1.2 * L, 2.2 * L, along)) * Math.min(1, (m - 1 - j) / 3);
      // the bow wave: kept low, the arms grow along the hull; the churn starts at the stern
      const arms = life * (0.35 + 0.65 * smooth(0, 0.4 * L, along));
      const churn = life * smooth(0.8 * L, 1.1 * L, along) * 0.9;
      if (arms > 0.01 || churn > 0.01) any = true;
      // the arms spread out at a narrower angle than a real Kelvin wake
      const hw = this.halfBeam * 1.15 + along * 0.2;
      for (let k = 0; k < 3; k++) {
        const s = k - 1, i = (j * 3 + k) * 3;
        pos[i] = cx - tz * hw * s;
        pos[i + 1] = -WAKE_SINK;
        pos[i + 2] = cz + tx * hw * s;
        wk[i] = s;
        wk[i + 1] = churn;
        wk[i + 2] = arms;
      }
    }
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aWake').needsUpdate = true;
    g.setDrawRange(0, (m - 1) * 12);
    this.live = any;
    this.mesh.visible = any;
  }

  /** forget the trail (she is gone from sight, or put somewhere else) */
  reset(): void {
    this.n = 0;
    this.lastT = -1;
    this.live = this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

// ------------------------------------------------------------------------------------------- the view

export class ShipsView {
  readonly group = new THREE.Group();
  private views = new Map<number, THREE.Object3D>();
  private invaderViews = new Map<number, THREE.Object3D>();
  private t = 0;
  ready: Promise<void>;
  selected = 0;

  /** debug: ?shipshow=sloop,galleon[&shipfurl=1] lines those classes up offshore of the dock, under sail */
  private show: { id: number; type: ShipType; x: number; z: number; head: number; v?: THREE.Object3D }[] = [];

  constructor(private world: World, private game: Game) {
    this.ready = this.load();
    const q = new URLSearchParams(location.search);
    const list = q.get('shipshow');
    const dock = [...game.buildings.values()].find((b) => b.def === 'dock');
    if (list && dock) {
      const [bx, by] = dockBerth(dock);
      const cx = dock.x + dock.w / 2, cy = dock.y + dock.h / 2;
      const sl = Math.hypot(bx - cx, by - cy) || 1;
      const sea = [(bx - cx) / sl, (by - cy) / sl], side = [-sea[1], sea[0]];
      const types = list.split(',') as ShipType[];
      types.forEach((type, i) => {
        const o = (i - (types.length - 1) / 2) * 15;
        const x = bx + sea[0] * 14 + side[0] * o, z = by + sea[1] * 14 + side[1] * o;
        this.show.push({ id: 9000 + i, type, x, z, head: +(q.get('shiphead') ?? 0.5) });
      });
      (window as unknown as { __shipshow: number[][] }).__shipshow = this.show.map((s) => [s.x, s.z]);
      void Promise.all(types.map((t) => loadShipModel(MODEL[t])));
    }
  }

  /** only the models this game's ships (and invaders) use: the rest load when a ship of theirs first appears */
  private async load(): Promise<void> {
    const g = this.game;
    const types = new Set<ShipType>([...g.ships.values()].map((s) => s.type));
    for (const iv of g.invaders ?? []) types.add(iv.soldiers > 6 ? 'galleon' : 'frigate');
    await Promise.all([...new Set([...types].map((t) => MODEL[t]))].map(loadShipModel));
  }

  /** a ship of this type, or null while its model is still loading */
  private instance(type: ShipType, nation?: Nation, rigged = true): THREE.Object3D | null {
    const src = shipModel(type);
    if (!src) return null;
    const g = new THREE.Group();
    const L = LENGTH[type];
    const s = L / src.plan.length;
    const hull = new THREE.Group();
    hull.scale.setScalar(s);
    if (src.near) {
      const lod = new THREE.LOD();
      lod.addLevel(src.near.clone(), 0);
      lod.addLevel(src.far.clone(), L * LOD_LENGTHS);
      hull.add(lod);
    } else hull.add(src.far.clone());
    g.add(hull);
    g.userData.hull = hull;
    if (!rigged) return g;
    const sails = new Sails(src.plan);
    hull.add(sails.mesh);
    g.userData.sails = sails;
    // pirate or national flag atop the mainmast, pennants at the other mastheads
    const flags: THREE.Object3D[] = [];
    for (const f of src.plan.flags) {
      const p = new THREE.Vector3().fromArray(f.p).multiplyScalar(s);
      let o: THREE.Object3D;
      if (f.kind === 'flag') {
        const fl = flag(nation ? nationFlag(nation) : M().flagBlack, 0.01);
        waveFlag(fl);
        fl.scale.setScalar(Math.max(1.1, L / 6.5));
        o = fl;
      } else {
        o = pennant(Math.max(1.2, L / 7));
      }
      o.position.copy(p);
      g.add(o);
      flags.push(o);
    }
    g.userData.flags = flags;
    const wk = new Wake(L, src.plan.beam * s * 0.5, this.world.water.uniforms);
    this.group.add(wk.mesh);
    g.userData.wake = wk;
    g.userData.L = L;
    return g;
  }

  /** wooden frame for a ship under construction: same model, unrigged, clipped by progress (null while the model loads) */
  hullFrame(type: ShipType): THREE.Object3D | null {
    const g = this.instance(type, undefined, false);
    if (!g) return null;
    const src = shipModel(type)!;
    // standing on the keel blocks, not floating at its waterline
    (g.userData.hull as THREE.Object3D).position.y = src.plan.draft * (LENGTH[type] / src.plan.length);
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const clipped = new Map<THREE.Material, THREE.Material>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material) => {
        let c = clipped.get(mat);
        if (!c) {
          c = mat.clone();
          c.clippingPlanes = [plane];
          clipped.set(mat, c);
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    g.userData.clip = plane;
    g.userData.L = LENGTH[type];
    return g;
  }
  setHullProgress(o: THREE.Object3D, p: number): void {
    const plane = o.userData.clip as THREE.Plane;
    const wp = new THREE.Vector3();
    o.getWorldPosition(wp);
    plane.constant = wp.y - 0.2 + p * (o.userData.L as number) * 0.9;
  }

  onEvent(e: { type: string; [k: string]: any }): void {
    if (e.type === 'shipRemoved') {
      const v = this.views.get(e.id);
      if (v) this.drop(v);
      this.views.delete(e.id);
    }
  }

  private drop(v: THREE.Object3D): void {
    this.group.remove(v);
    (v.userData.sails as Sails | undefined)?.dispose();
    const wk = v.userData.wake as Wake | undefined;
    if (wk) (this.group.remove(wk.mesh), wk.dispose());
  }

  pickShip(ray: THREE.Raycaster): number {
    const hits = ray.intersectObjects([...this.views.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.shipId) o = o.parent;
      if (o) return o.userData.shipId;
    }
    return 0;
  }

  shipPosition(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v && v.visible ? v.position.clone() : null;
  }

  /** scratch: a ship's pose this frame (x, z, heading about y) */
  private pose = { x: 0, z: 0, h: 0 };
  private frame = 0;

  update(dt: number): void {
    this.t += dt;
    this.frame++;
    const g = this.game;
    for (const s of g.ships.values()) {
      let v = this.views.get(s.id);
      if (!v) {
        v = this.instance(s.type) ?? undefined;
        if (!v) continue; // model still loading: next frame
        v.userData.shipId = s.id;
        v.traverse((o) => (o.userData.shipId = s.id));
        // a ship first seen at the dock has its sails already furled
        (v.userData.sails as Sails).setFurl(furledFor(s.status) ? 1 : 0);
        this.views.set(s.id, v);
        this.group.add(v);
      }
      if (s.status === 'atsea' || s.status === 'lost') {
        if (v.visible) this.hide(v);
        continue;
      }
      v.visible = true;
      const moving = s.status === 'departing' || s.status === 'returning';
      this.simPose(v, s.vx, s.vy, s.vdir);
      v.userData.returning = s.status === 'returning';
      this.berthed(s, v, dt);
      const u = v.userData as GlideState;
      this.glide(v, this.pose.x, this.pose.z, this.pose.h, moving, dt);
      this.bob(v, s.id);
      // coming in, she takes in sail over the last stretch to her berth
      this.rig(v, s.id, furledFor(s.status) || (s.status === 'returning' && (u.dBerth ?? Infinity) < berthEase(LENGTH[s.type]) * 1.4), dt);
    }
    // invaders
    const inv = g.invaders ?? [];
    const live = new Set<number>();
    for (const iv of inv) {
      live.add(iv.id);
      let v = this.invaderViews.get(iv.id);
      if (!v) {
        v = this.instance(iv.soldiers > 6 ? 'galleon' : 'frigate', iv.nat) ?? undefined;
        if (!v) continue;
        this.invaderViews.set(iv.id, v);
        this.group.add(v);
      }
      this.simPose(v, iv.x, iv.y, iv.dir);
      this.glide(v, this.pose.x, this.pose.z, this.pose.h, iv.state === 'approach', dt);
      if (iv.state === 'sunk') {
        v.position.y = -iv.timer * 0.4;
        v.rotation.x = Math.min(0.6, iv.timer * 0.08);
      } else this.bob(v, iv.id);
      this.rig(v, iv.id, iv.state === 'sunk', dt);
    }
    const furlShow = location.search.includes('shipfurl=1'), sailShow = location.search.includes('shipsail=1');
    for (let i = 0; i < this.show.length; i++) {
      const sh = this.show[i];
      if (!sh.v) {
        sh.v = this.instance(sh.type) ?? undefined;
        if (!sh.v) continue;
        (sh.v.userData.sails as Sails).setFurl(furlShow ? 1 : 0);
        this.group.add(sh.v);
      }
      const v = sh.v;
      if (sailShow) {
        // ?shipsail=1: each sails a slow circle about her spot (wake, heel and turn under way)
        const a = this.t * 0.12 + i * 2;
        this.glide(v, sh.x + Math.cos(a) * 18, sh.z + Math.sin(a) * 18, sh.head, true, dt);
      } else this.glide(v, sh.x, sh.z, sh.head, false, dt);
      this.bob(v, sh.id);
      this.rig(v, sh.id, furlShow, dt);
    }
    for (const [id, v] of this.invaderViews) if (!live.has(id)) {
      this.drop(v);
      this.invaderViews.delete(id);
    }
  }

  /** a ship gone out of sight (out to sea): her wake goes with her, and she glides from wherever she reappears */
  private hide(v: THREE.Object3D): void {
    v.visible = false;
    (v.userData.wake as Wake | undefined)?.reset();
    const u = v.userData as GlideState;
    u.glided = false;
    u.ip = undefined;
  }

  /**
   * The sim moves ships in fixed 0.1 s steps (several a frame at 8x). The view draws each where the sim had her one
   * step ago plus the time since, between the last two sim positions it saw, so she moves evenly from frame to frame
   * (easing toward the sim's position instead gives a speed that jumps at every step). Stands still while paused.
   */
  private simPose(v: THREE.Object3D, x: number, y: number, dir: number): void {
    const u = v.userData as GlideState, g = this.game, now = g.time;
    let ip = u.ip;
    if (!ip) {
      ip = u.ip = new Float64Array(8);
      ip[0] = now - DT;
      ip[4] = now;
      ip[1] = ip[5] = x;
      ip[2] = ip[6] = y;
      ip[3] = ip[7] = dir;
    } else if (x !== ip[5] || y !== ip[6] || dir !== ip[7]) {
      if (Math.hypot(x - ip[5], y - ip[6]) > 8) {
        // put somewhere else (back from the sea): no sliding across
        ip[1] = x;
        ip[2] = y;
        ip[3] = dir;
        ip[0] = now - DT;
      } else if (now - ip[4] > DT * 1.5 && (u.ipFrame ?? 0) < this.frame - 1) {
        // under way again after lying still: she was where she lay until a step ago
        ip[1] = ip[5];
        ip[2] = ip[6];
        ip[3] = ip[7];
        ip[0] = now - DT;
      } else ip.copyWithin(0, 4, 8);
      ip[4] = now;
      ip[5] = x;
      ip[6] = y;
      ip[7] = dir;
      u.ipFrame = this.frame;
    }
    const a = Math.max(0, Math.min(1, (now - DT + g.pending - ip[0]) / Math.max(1e-6, ip[4] - ip[0])));
    const dd = Math.atan2(Math.sin(ip[7] - ip[3]), Math.cos(ip[7] - ip[3]));
    this.pose.x = ip[1] + (ip[5] - ip[1]) * a;
    this.pose.z = ip[2] + (ip[6] - ip[2]) * a;
    this.pose.h = -(ip[3] + dd * a);
  }

  /**
   * Where the view puts a ship (this.pose, from simPose): moved so the hull lies in water. At (and near) its berth
   * that is a fitted berth, searched once per dock, eased so she gathers way leaving it and loses it coming in (the
   * sim's ship keeps a steady speed to the very end); underway, a small sideways nudge away from any shore the hull
   * would cross.
   */
  private berthed(s: Ship, v: THREE.Object3D, dt: number): void {
    const u = v.userData as GlideState, p = this.pose;
    const L = LENGTH[s.type];
    const moving = s.status === 'departing' || s.status === 'returning';
    const dockId = s.status === 'returning' ? s.returnDock ?? s.dock : s.dock;
    const dock = dockId ? this.game.buildings.get(dockId) : undefined;
    u.near = 0;
    u.dBerth = Infinity;
    if (dock) {
      const [bx, by, bdir] = dockBerth(dock);
      const key = `${dock.id}:${bx},${by}:${s.type}`;
      if (u.berthKey !== key) {
        u.berthKey = key;
        u.berth = this.fitBerth(bx, by, -bdir, L, dock);
        // she lies either way round (the fitted hull outline is the same both ways): as the sim has her lie, since she
        // leaves the berth on that heading (sailing off bow first) and the sim brings her in to it
        const fh = u.berth[2];
        u.berthHead = Math.cos(fh + bdir) >= 0 ? fh : fh + Math.PI;
        // coming in, she rounds up onto her berth's line from astern, where that water is clear
        const E = berthEase(L), ax = Math.cos(u.berthHead), az = -Math.sin(u.berthHead);
        u.lineIn = [0.35, 0.7, 1, 1.4].every((k) => this.aground(u.berth![0] - ax * E * k, u.berth![1] - az * E * k, u.berthHead!, L, dock) === 0);
      }
      const b = u.berth!;
      let d = Math.hypot(p.x - bx, p.z - by);
      // the sim's ship slows to a crawl over the last of her way in (and gathers way leaving); the view brings that
      // crawl to rest: f(d) = 2d²/S - d³/S² meets the sim's track at S at the sim's speed and stops at the berth
      const E = berthEase(L), S = 2;
      if (d < S && d > 1e-6) {
        const f = (2 * d) / S - (d * d) / (S * S);
        p.x = bx + (p.x - bx) * f;
        p.z = by + (p.z - by) * f;
        d *= f;
      }
      if (s.status === 'returning' && u.lineIn && d < E * 1.4) {
        // bend the last of her track onto the berth's line, so she comes alongside bow first and needn't crab in
        const k = smooth(E * 1.4, E * 0.15, d), ax = Math.cos(u.berthHead!), az = -Math.sin(u.berthHead!);
        p.x += (bx - ax * d - p.x) * k;
        p.z += (by - az * d - p.z) * k;
      }
      u.dBerth = d;
      u.near = 1 - smooth(0, E * 0.8, d);
      const w = 1 - smooth(1, 7, d);
      p.x += (b[0] - bx) * w;
      p.z += (b[1] - by) * w;
      if (!moving) p.h = u.berthHead!;
      if (w > 0.99) return;
    }
    // underway: lean off the shore if the hull would cross it
    const hd = u.head ?? p.h;
    const nx = Math.sin(hd), nz = Math.cos(hd); // abeam (local +z)
    let best = 0, bestV = this.aground(p.x + nx * (u.nudge ?? 0), p.z + nz * (u.nudge ?? 0), hd, L, null);
    if (bestV > 0) for (const o of NUDGES) {
      const vio = this.aground(p.x + nx * o, p.z + nz * o, hd, L, null) + Math.abs(o) * 0.02;
      if (vio < bestV) (bestV = vio), (best = o);
    } else best = u.nudge ?? 0;
    u.nudge = (u.nudge ?? 0) + (best - (u.nudge ?? 0)) * (1 - Math.exp(-dt * 1.5));
    p.x += nx * u.nudge;
    p.z += nz * u.nudge;
  }

  /** how far a hull of length L at (x, z, heading) is out of the water (0 = afloat), sampling its outline */
  private aground(x: number, z: number, head: number, L: number, avoid: { x: number; y: number; w: number; h: number } | null): number {
    const m = this.game.map;
    const c = Math.cos(head), sn = Math.sin(head);
    const hl = L * 0.4, hb = L * 0.11, need = -Math.min(0.5, L * 0.035);
    let v = 0;
    for (let i = 0; i <= 6; i++) {
      const lx = -hl + (2 * hl * i) / 6;
      const taper = 1 - (Math.abs(lx) / hl) ** 3 * 0.6;
      for (let k = -1; k <= 1; k++) {
        const lz = k * hb * taper;
        const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
        const h = m.heightAt(wx, wz);
        if (h > need) v += h - need + 0.05;
        if (avoid && wx > avoid.x - 0.5 && wx < avoid.x + avoid.w + 0.5 && wz > avoid.y - 0.5 && wz < avoid.y + avoid.h + 0.5) v += 1;
      }
    }
    return v;
  }

  /** the nearest clear berth to the sim's: alongside (either way round) or bow out from the pier head */
  private fitBerth(bx: number, by: number, head: number, L: number, dock: { x: number; y: number; w: number; h: number }): [number, number, number] {
    let best: [number, number, number] = [bx, by, head], bestC = Infinity;
    const m = this.game.map;
    // the sim's berth stands well off the pier head: aim close alongside it (the hull outline is kept half a tile
    // clear of the dock's lot), pulling in toward the pier by up to a tile and a half
    const cx = dock.x + dock.w / 2, cz = dock.y + dock.h / 2, sl = Math.hypot(bx - cx, by - cz) || 1;
    const ax = bx - ((bx - cx) / sl) * 1.5, az = by - ((by - cz) / sl) * 1.5;
    for (const [dh, hc] of [[0, 0], [Math.PI, 0.4], [Math.PI / 2, 2.5], [-Math.PI / 2, 2.5]] as [number, number][]) {
      const h = head + dh, c = Math.cos(h), sn = Math.sin(h);
      for (let dx = -8; dx <= 8; dx += 0.5)
        for (let dz = -8; dz <= 8; dz += 0.5) {
          const d = Math.hypot(bx + dx - ax, by + dz - az);
          if (d + hc >= bestC) continue;
          const x = bx + dx, z = by + dz;
          if (this.aground(x, z, h, L, dock) > 0) continue;
          // bow toward the deeper water (seaward), all else equal
          const bow = m.heightAt(x + c * L * 0.4, z - sn * L * 0.4), stern = m.heightAt(x - c * L * 0.4, z + sn * L * 0.4);
          const cost = d + hc + Math.max(-0.5, Math.min(0.5, bow - stern));
          if (cost < bestC) (bestC = cost), (best = [x, z, h]);
        }
    }
    return best;
  }

  /** sails toward their state (furling takes a few seconds), the wake laid behind the bow, flags streaming down the wind */
  private rig(v: THREE.Object3D, id: number, furled: boolean, dt: number): void {
    const sails = v.userData.sails as Sails | undefined;
    if (sails) {
      const goal = furled ? 1 : 0;
      if (sails.furl !== goal) sails.setFurl(sails.furl + Math.sign(goal - sails.furl) * Math.min(Math.abs(goal - sails.furl), dt * 0.4));
    }
    const u = v.userData as GlideState;
    const wk = v.userData.wake as Wake | undefined;
    if (wk) {
      const h = u.head ?? v.rotation.y, c = Math.cos(h), sn = Math.sin(h), L = v.userData.L as number;
      wk.update(v.position.x + c * L * 0.47, v.position.z - sn * L * 0.47, v.position.x - c * L * 0.4, v.position.z + sn * L * 0.4, u.speed ?? 0, this.t);
    }
    const flags = v.userData.flags as THREE.Object3D[] | undefined;
    const head = v.rotation.y;
    if (flags) for (let i = 0; i < flags.length; i++) flags[i].rotation.y = WIND_DIR - head + Math.sin(this.t * 0.7 + id + i) * 0.15;
  }

  /**
   * Put the view at its pose for this frame and turn the bow the way she is actually moving (toward her berth's
   * heading as she comes alongside, the rest heading when still), so she never slides sideways or sails stern first.
   * Keeps her speed and rate of turn for the heel, pitch and wake.
   */
  private glide(v: THREE.Object3D, x: number, z: number, restHeading: number, moving: boolean, dt: number): void {
    const u = v.userData as GlideState;
    v.rotation.order = 'YXZ'; // yaw, then heel about the keel (local x), then pitch (local z)
    if (!u.glided || Math.hypot(x - v.position.x, z - v.position.z) > 8) {
      v.position.set(x, 0, z);
      u.head = restHeading;
      u.glided = true;
      u.speed = u.turn = u.velX = u.velZ = 0;
      (v.userData.wake as Wake | undefined)?.reset();
    } else if (dt > 0) {
      const k = 1 - Math.exp(-dt * 6);
      u.velX = (u.velX ?? 0) + ((x - v.position.x) / dt - (u.velX ?? 0)) * k;
      u.velZ = (u.velZ ?? 0) + ((z - v.position.z) / dt - (u.velZ ?? 0)) * k;
      v.position.x = x;
      v.position.z = z;
      u.speed = Math.hypot(u.velX, u.velZ);
      // near: 1 at the berth, 0 an easing length out. Leaving or coming in she keeps her berth's heading while she
      // barely has way on, and otherwise points where she is going; she swings alongside only in the last of it
      const near = u.near ?? 0, berthing = moving && near > 0 && u.berthHead !== undefined;
      const arriving = berthing && (u.near ?? 0) > 0 && v.userData.returning === true;
      let want = berthing ? u.berthHead! : restHeading;
      if (moving && u.speed > 0.2) {
        want = -Math.atan2(u.velZ, u.velX);
        const close = smooth(0.6, 0.95, near);
        if (arriving && close > 0) want += Math.atan2(Math.sin(u.berthHead! - want), Math.cos(u.berthHead! - want)) * close;
      }
      let d = want - (u.head ?? want);
      d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest way round
      // a ship turns no faster than her way lets her (she pivots slowly when all but stopped)
      const rate = moving ? 0.4 + 1.2 * u.speed : 0.6;
      const step = Math.max(-rate * dt, Math.min(rate * dt, d * (1 - Math.exp(-dt * (moving ? 8 : 1.5)))));
      u.head = (u.head ?? want) + step;
      u.turn = (u.turn ?? 0) + (step / dt - (u.turn ?? 0)) * (1 - Math.exp(-dt * 3));
    }
    v.rotation.set(0, u.head ?? restHeading, 0);
  }

  /** riding the swell: heave, roll and pitch, more of them underway, and a heel out of the turn */
  private bob(v: THREE.Object3D, id: number): void {
    const u = v.userData as GlideState;
    const t = this.t + id * 1.7;
    const way = Math.min(1, (u.speed ?? 0) / 2.5);
    v.position.y = Math.sin(t * 1.1) * 0.05;
    const heel = Math.max(-0.12, Math.min(0.12, (u.turn ?? 0) * 0.35 * way));
    v.rotation.x = Math.sin(t * 0.7 + 1) * (0.012 + 0.014 * way) + heel;
    v.rotation.z = Math.sin(t * 0.9) * (0.014 + 0.016 * way) - 0.012 * way; // bow lifts a little as she gathers way
  }
}

interface GlideState {
  glided?: boolean;
  head?: number;
  speed?: number;
  turn?: number;
  velX?: number;
  velZ?: number;
  berthKey?: string;
  berth?: [number, number, number];
  berthHead?: number;
  /** the water astern of the berth, along its line, is clear to come in on */
  lineIn?: boolean;
  /** 1 at the berth, 0 an easing length or more out */
  near?: number;
  /** distance from the berth (Infinity without one) */
  dBerth?: number;
  nudge?: number;
  /** the last two sim samples [t, x, y, dir] x 2, and the frame the newer arrived */
  ip?: Float64Array;
  ipFrame?: number;
}

/** sideways offsets tried to keep a hull off the shore */
const NUDGES = [-3, -2, -1.2, -0.6, 0, 0.6, 1.2, 2, 3];

/** how far out from the berth a ship gathers or loses way */
function berthEase(L: number): number {
  return Math.max(5, Math.min(8, L * 0.8));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** sails stay furled while a ship lies at the dock (loading, repairing, signing on its crew) */
function furledFor(status: Ship['status']): boolean {
  return status !== 'departing' && status !== 'returning';
}

const flagCache = new Map<Nation, THREE.Material>();
function nationFlag(n: Nation): THREE.Material {
  const hit = flagCache.get(n);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  if (n === 'eng') {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#c8102e';
    g.fillRect(52, 0, 24, 96);
    g.fillRect(0, 36, 128, 24);
  } else if (n === 'fra') {
    g.fillStyle = '#f4f0e0';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#d4af37';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(34 + i * 30, 48 + (i === 1 ? -14 : 8), 9, 0, 7);
      g.fill();
    }
  } else {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 96);
    g.strokeStyle = '#b01c2e';
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(14, 10);
    g.lineTo(114, 86);
    g.moveTo(114, 10);
    g.lineTo(14, 86);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
  flagCache.set(n, m);
  return m;
}
export { NAV_LENGTH as _NAV };
