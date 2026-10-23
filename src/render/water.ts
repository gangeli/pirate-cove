import * as THREE from 'three';
import { GameMap } from '../sim/map';
import { gpu } from './backend';

/** Tropical ocean: gerstner swell, depth-tinted colour from terrain heightmap, shore foam, sun glints. */
export class Water {
  /** the sea: a grid of tiles (one material) so the tiles out of view drop out of every pass */
  readonly mesh: THREE.Group;
  readonly heightTex: THREE.DataTexture;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private map: GameMap) {
    const n = map.size;
    const s = n + 1;
    // red: ground height; green: 1 where the water is open sea (joined to the map edge), 0 in inland lakes and ponds
    this.heightTex = new THREE.DataTexture(heightAndSea(map.vh, s) as any, s, s, THREE.RGFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    const size = n * 8;
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeight: { value: this.heightTex },
        uMapSize: { value: n },
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
        uSkyTop: { value: new THREE.Color(0.25, 0.5, 0.85) },
        uSkyHorizon: { value: new THREE.Color(0.75, 0.85, 0.95) },
        uShallow: { value: new THREE.Color(0.08, 0.62, 0.6) },
        uDeep: { value: new THREE.Color(0.0, 0.07, 0.17) },
        uNight: { value: 0 },
      },
    ]);
    const g = gpu();
    // WebGPU: the node twin of the shaders below (nodes.ts waterMaterial)
    const mat = g ? (g.waterMaterial(this.uniforms as any, this.heightTex as any) as unknown as THREE.Material) : new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      fog: true,
      depthWrite: true,
      vertexShader: /* glsl */ `
uniform float uTime; uniform sampler2D uHeight; uniform float uMapSize;
varying vec3 vWPos;
#include <fog_pars_vertex>
// 1 on the open sea, 0 on inland lakes (green channel of the height map)
float openSea(vec2 p){
  vec2 uv = (p + 0.5) / (uMapSize + 1.0);
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return 1.0;
  return texture2D(uHeight, uv).g;
}
vec3 gerstner(vec2 p, vec2 dir, float steep, float wl, float t, inout vec3 tan, inout vec3 bin){
  float k = 6.2831/wl; float c = sqrt(9.8/k); vec2 d = normalize(dir);
  float f = k*(dot(d,p) - c*t); float a = steep/k;
  tan += vec3(-d.x*d.x*steep*sin(f), d.x*steep*cos(f), -d.x*d.y*steep*sin(f));
  bin += vec3(-d.x*d.y*steep*sin(f), d.y*steep*cos(f), -d.y*d.y*steep*sin(f));
  return vec3(d.x*a*cos(f), a*sin(f), d.y*a*cos(f));
}
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vec3 tan = vec3(1,0,0), bin = vec3(0,0,1);
  vec3 off = vec3(0);
  off += gerstner(wp.xz, vec2(1.0,0.3), 0.08, 18.0, uTime, tan, bin);
  off += gerstner(wp.xz, vec2(-0.4,1.0), 0.06, 11.0, uTime, tan, bin);
  off += gerstner(wp.xz, vec2(0.7,-0.8), 0.05, 6.0, uTime, tan, bin);
  wp.xyz += off * 0.6 * openSea(wp.xz);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
uniform float uTime; uniform sampler2D uHeight; uniform float uMapSize;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;
uniform vec3 uShallow; uniform vec3 uDeep; uniform float uNight;
varying vec3 vWPos;
#include <fog_pars_fragment>
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
// gradient of fbm, analytic (one pass instead of three finite-difference fbm evaluations)
vec2 fbmGrad(vec2 p){
  vec2 g = vec2(0.0); float a = 0.5, k = 1.0;
  for(int i=0;i<4;i++){
    vec2 ip = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f), du = 6.0*f*(1.0-f);
    float A = hash12(ip), B = hash12(ip+vec2(1,0)), C = hash12(ip+vec2(0,1)), D = hash12(ip+vec2(1,1));
    float e = A - B - C + D;
    g += a * k * du * vec2(B - A + e*u.y, C - A + e*u.x);
    p *= 2.03; k *= 2.03; a *= 0.5;
  }
  return g;
}
float openSea(vec2 p){
  vec2 uv = (p + 0.5) / (uMapSize + 1.0);
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return 1.0;
  return texture2D(uHeight, uv).g;
}
float terrainH(vec2 p){
  vec2 uv = (p + 0.5) / (uMapSize + 1.0);
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return -14.0;
  // the seabed eases down to the open-ocean depth beyond the map over its last tiles, so the edge leaves no seam
  vec2 e = min(p + 0.5, uMapSize + 0.5 - p);
  return mix(-14.0, texture2D(uHeight, uv).r, smoothstep(0.0, 20.0, min(e.x, e.y)));
}
vec3 waveNormal(vec2 p){
  // sum of directional ripples, analytic derivative
  vec2 g = vec2(0.0);
  float t = uTime;
  const int N = 7;
  for (int i=0;i<N;i++){
    float fi = float(i);
    float ang = fi*2.39996 + 0.3;
    vec2 d = vec2(cos(ang), sin(ang));
    float freq = 0.6 * pow(1.45, fi);
    float amp = 0.11 / pow(1.35, fi);
    float ph = dot(d,p)*freq + t*(1.2+fi*0.37);
    g += d * cos(ph) * freq * amp;
  }
  // fine detail noise
  vec2 q = p*1.7 + vec2(t*0.25, t*0.18);
  g += fbmGrad(q) * 0.06;
  return normalize(vec3(-g.x, 1.0, -g.y));
}
void main(){
  float th = terrainH(vWPos.xz);
  float depth = max(0.0, vWPos.y - th);
  // inland lakes and ponds lie still: no swell or whitecaps, a faint ripple and a little lapping at the edge
  float open = openSea(vWPos.xz);
  vec3 N = normalize(mix(normalize(vec3(fbmGrad(vWPos.xz*1.3 + uTime*0.08) * -0.04, 1.0).xzy), waveNormal(vWPos.xz), open));
  vec3 V = normalize(cameraPosition - vWPos);
  // water colour by depth (Beer-Lambert-ish)
  float dk = 1.0 - exp(-depth*0.45);
  vec3 body = mix(uShallow, uDeep, dk);
  // subsurface brightening on wave crests facing sun
  body += uShallow * 0.15 * max(0.0, N.x*uSunDir.x + N.z*uSunDir.z) * (1.0-dk);
  // sky reflection
  vec3 R = reflect(-V, N);
  float hz = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyTop, pow(hz, 0.6));
  float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(body, sky * 0.8, fres*0.7);
  // sun glint
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 600.0) * 2.5 + pow(max(dot(N,H),0.0), 80.0)*0.12;
  col += uSunColor * spec * (1.0 - uNight*0.9);
  // shoreline foam: bands moving toward shore plus noise
  // (each term is zero outside its depth band, so the noise is only evaluated where it shows)
  float foam = 0.0;
  if (depth < 1.4) {
    float shore = 1.0 - smoothstep(0.0, 1.4, depth);
    float bands = sin(depth*7.0 - uTime*2.2 + fbm(vWPos.xz*0.6)*6.0)*0.5+0.5;
    float foamN = fbm(vWPos.xz*2.5 + uTime*0.3);
    // (a lake only laps a little at its edge: a small pond is shallow all over and would turn white)
    foam = shore * smoothstep(0.45, 0.9, bands*0.6 + foamN*0.6) * mix(0.12, 1.0, open);
    foam += (1.0 - smoothstep(0.0, 0.25, depth)) * smoothstep(0.35, 0.6, foamN) * mix(0.2, 1.0, open);
  }
  // open-sea whitecaps
  if (depth > 3.0) foam += smoothstep(0.78, 0.92, fbm(vWPos.xz*0.35 + uTime*0.05)) * 0.25 * smoothstep(3.0, 10.0, depth) * open;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.95,0.97,1.0), foam*0.85);
  col *= mix(1.0, 0.25, uNight);
  float alpha = mix(0.55, 1.0, smoothstep(0.0, 2.5, depth));
  alpha = max(alpha, foam);
  alpha *= smoothstep(0.0, 0.08, depth);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
    });
    mat.userData.textures = [this.heightTex];
    // the same 384 x 384 vertex lattice as one plane over the whole sea, cut into SEA_TILES^2 tiles: a single mesh
    // was drawn whole (290k triangles, in the main and the AO pass) whenever any of it was in view
    this.mesh = new THREE.Group();
    this.mesh.name = 'water';
    const T = SEA_TILES, seg = 384 / T, ts = size / T;
    for (let j = 0; j < T; j++)
      for (let i = 0; i < T; i++) {
        // (positions in world space: both shaders take object space for world space)
        const tile = new THREE.PlaneGeometry(ts, ts, seg, seg);
        tile.rotateX(-Math.PI / 2);
        tile.translate(n / 2 - size / 2 + (i + 0.5) * ts, 0, n / 2 - size / 2 + (j + 0.5) * ts);
        tile.computeBoundingSphere();
        // the swell lifts and shifts vertices by well under 2 tiles
        tile.boundingSphere!.radius += 2;
        const m = new THREE.Mesh(tile, mat);
        m.renderOrder = 2;
        m.name = 'water';
        this.mesh.add(m);
      }
  }

  syncHeights(): void {
    (this.heightTex.image.data as unknown as Uint16Array).set(heightAndSea(this.map.vh, this.map.size + 1));
    this.heightTex.needsUpdate = true;
  }
}

/** the sea plane is cut into this many tiles per side (384 divisible by it) */
const SEA_TILES = typeof location !== 'undefined' && /[?&]nocull=1/.test(location.search) ? 1 : 12;

/** heights (R) and an open-sea mask (G) for the s x s vertex grid: water below sea level reached from the edge */
export function heightAndSea(vh: Float32Array, s: number): Uint16Array {
  const sea = new Uint8Array(s * s);
  const q: number[] = [];
  for (let i = 0; i < s; i++)
    for (const k of [i, (s - 1) * s + i, i * s, i * s + s - 1]) if (vh[k] < 0 && !sea[k]) (sea[k] = 1), q.push(k);
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % s, y = (k - x) / s;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
      const j = ny * s + nx;
      if (!sea[j] && vh[j] < 0) (sea[j] = 1), q.push(j);
    }
  }
  // calm = inland water, grown onto the land around it by more than one cell of the water mesh (its vertices lie
  // n*8/384 tiles apart): a pond smaller than a cell sits between vertices on dry land, and the surface across it
  // would ride those vertices' swell; the rest of the land counts as sea, so the open coast keeps its surf
  const calm = new Uint8Array(s * s);
  for (let k = 0; k < s * s; k++) if (vh[k] < 0 && !sea[k]) calm[k] = 1;
  // (grown in the four directions, it spreads as a diamond: twice the cell covers a vertex diagonally across one)
  const reach = 2 * Math.ceil(((s - 1) * 8) / 384) + 2;
  for (let pass = 0; pass < reach; pass++) {
    const grow: number[] = [];
    for (let k = 0; k < s * s; k++) {
      if (calm[k] || vh[k] < 0) continue;
      const x = k % s, y = (k - x) / s;
      if ((x > 0 && calm[k - 1]) || (x < s - 1 && calm[k + 1]) || (y > 0 && calm[k - s]) || (y < s - 1 && calm[k + s])) grow.push(k);
    }
    for (const k of grow) calm[k] = 1;
  }
  const o = new Uint16Array(s * s * 2), one = THREE.DataUtils.toHalfFloat(1), zero = THREE.DataUtils.toHalfFloat(0);
  for (let k = 0; k < s * s; k++) {
    o[k * 2] = THREE.DataUtils.toHalfFloat(vh[k]);
    o[k * 2 + 1] = calm[k] ? zero : one;
  }
  return o;
}
