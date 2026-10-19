import * as THREE from 'three';
import { GameMap, Terrain } from '../sim/map';
import { loadTex } from './textures';

/**
 * Splatted PBR terrain. Each vertex carries weights for sand/grass/jungle/rock (aSplat)
 * plus dirt (aDirt) for paths and building pads. Under water the shader adds caustics.
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly geom: THREE.BufferGeometry;
  private splat: Float32Array;
  private dirt: Float32Array;
  readonly uniforms = { uTime: { value: 0 } };
  readonly skirt: THREE.Mesh;

  constructor(private map: GameMap) {
    const n = map.size, s = n + 1;
    const pos = new Float32Array(s * s * 3);
    const uv = new Float32Array(s * s * 2);
    this.splat = new Float32Array(s * s * 4);
    this.dirt = new Float32Array(s * s);
    for (let y = 0; y <= n; y++)
      for (let x = 0; x <= n; x++) {
        const i = y * s + x;
        pos[i * 3] = x;
        pos[i * 3 + 1] = map.vh[i];
        pos[i * 3 + 2] = y;
        uv[i * 2] = x / n;
        uv[i * 2 + 1] = y / n;
      }
    const idx: number[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = y * s + x, b = a + 1, c = a + s, d = c + 1;
        // alternate diagonal for less banding
        if ((x + y) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    const g = (this.geom = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSplat', new THREE.BufferAttribute(this.splat, 4));
    g.setAttribute('aDirt', new THREE.BufferAttribute(this.dirt, 1));
    g.setIndex(idx);
    this.computeSplat(0, 0, n, n);
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, this.makeMaterial());
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';

    // sea floor beyond the map edge so the ocean never looks bottomless
    const sk = new THREE.PlaneGeometry(n * 8, n * 8, 1, 1);
    sk.rotateX(-Math.PI / 2);
    sk.translate(n / 2, -14, n / 2);
    this.skirt = new THREE.Mesh(sk, new THREE.MeshStandardMaterial({ color: 0x0d3a4a, roughness: 1 }));
  }

  /** recompute splat weights in a tile rect (inclusive vertex bounds) */
  computeSplat(x0: number, y0: number, x1: number, y1: number): void {
    const m = this.map, n = m.size, s = n + 1;
    for (let y = Math.max(0, y0); y <= Math.min(n, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(n, x1); x++) {
        let sand = 0, grass = 0, jungle = 0, rock = 0, dirt = 0, c = 0;
        for (let dy = -1; dy <= 0; dy++)
          for (let dx = -1; dx <= 0; dx++) {
            const tx = x + dx, ty = y + dy;
            if (!m.inBounds(tx, ty)) continue;
            const ti = ty * n + tx;
            const t = m.terrain[ti];
            c++;
            if (t <= Terrain.Beach) sand++;
            else if (t === Terrain.Grass) grass++;
            else if (t === Terrain.Jungle) jungle++;
            else rock++;
            if (m.occupied[ti] || m.path[ti]) dirt++;
          }
        const i = y * s + x;
        if (!c) c = 1, sand = 1;
        const h = m.vh[i];
        // altitude/slope driven rock
        this.splat[i * 4] = sand / c;
        this.splat[i * 4 + 1] = grass / c;
        this.splat[i * 4 + 2] = jungle / c;
        this.splat[i * 4 + 3] = rock / c + (h > 6 ? 0.3 : 0);
        this.dirt[i] = dirt / c;
      }
    (this.geom.getAttribute('aSplat') as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.getAttribute('aDirt') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** after the sim flattens ground for a building, sync heights + normals */
  syncHeights(x0: number, y0: number, x1: number, y1: number): void {
    const m = this.map, n = m.size, s = n + 1;
    const pos = this.geom.getAttribute('position') as THREE.BufferAttribute;
    for (let y = Math.max(0, y0); y <= Math.min(n, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(n, x1); x++) pos.setY(y * s + x, m.vh[y * s + x]);
    pos.needsUpdate = true;
    this.geom.computeVertexNormals();
    this.computeSplat(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  }

  private makeMaterial(): THREE.Material {
    const layers = ['sand', 'grass', 'jungle', 'rock', 'dirt', 'wetsand', 'cliff'];
    const d: Record<string, THREE.Texture> = {};
    const nm: Record<string, THREE.Texture> = {};
    for (const l of layers) {
      d[l] = loadTex(`tex/${l}_d.jpg`, true);
      nm[l] = loadTex(`tex/${l}_n.jpg`, false);
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const u = this.uniforms as any;
    for (const l of layers) {
      u[`t_${l}`] = { value: d[l] };
      u[`n_${l}`] = { value: nm[l] };
    }
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aSplat; attribute float aDirt;
varying vec4 vSplat; varying float vDirt; varying vec3 vWPos; varying vec3 vWNorm;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vSplat = aSplat; vDirt = aDirt;
vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      const decl = layers.map((l) => `uniform sampler2D t_${l}; uniform sampler2D n_${l};`).join('\n');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
${decl}
uniform float uTime; uniform sampler2D uRoads; uniform float uMapN; uniform sampler2D uOverlay; uniform float uOverlayOn;
varying vec4 vSplat; varying float vDirt; varying vec3 vWPos; varying vec3 vWNorm;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
// sample texture twice at different scales and rotation to kill tiling
// explicit gradients (the same ones the hardware would take) so layers can be skipped where their weight is 0:
// implicit-derivative lookups are undefined inside such branches
vec4 antiTile(sampler2D t, vec2 uv, vec2 dx, vec2 dy){
  vec4 a = textureGrad(t, uv, dx, dy);
  mat2 R = mat2(0.8,-0.6,0.6,0.8);
  vec2 uv2 = R * uv * 0.37 + 0.13;
  vec4 b = textureGrad(t, uv2, R * dx * 0.37, R * dy * 0.37);
  float m = smoothstep(0.3, 0.7, vnoise(uv * 0.35));
  return mix(a, b, m*0.6);
}
#define AT(t, s) antiTile(t, tuv * (s), tdx * (s), tdy * (s))
float caustic(vec2 p, float t){
  float c = 0.0;
  for(int i=0;i<3;i++){
    vec2 q = p * (1.0 + float(i)*0.6) + vec2(t*0.3*float(i+1), -t*0.2);
    c += abs(sin(q.x*2.1 + sin(q.y*1.7 + t)) * sin(q.y*2.3 + sin(q.x*1.3 - t)));
  }
  return pow(1.0 - c/3.0, 6.0);
}
vec4 gW; // splat weights for normal blending
vec3 gOv = vec3(0.0); // overlay glow`,
        )
        .replace(
          '#include <map_fragment>',
          `
vec2 tuv = vWPos.xz * 0.22;
vec2 tdx = dFdx(tuv), tdy = dFdy(tuv);
float nz = vnoise(vWPos.xz*0.15)*0.6 + vnoise(vWPos.xz*0.6)*0.4;
vec4 w = vSplat;
// break up blends with noise so transitions look natural
w.x *= 0.7 + nz*0.6; w.y *= 0.7 + (1.0-nz)*0.6; w.z *= 0.8 + nz*0.4;
float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
float cliffW = smoothstep(0.35, 0.6, slope);
w.w += cliffW*1.5;
w = max(w, 0.0); w /= max(0.0001, w.x+w.y+w.z+w.w);
float roadV = texture2D(uRoads, vWPos.xz / uMapN).r;
float roadW = smoothstep(0.32, 0.6, roadV + (vnoise(vWPos.xz*2.3)-0.5)*0.25);
float dirtW = max(smoothstep(0.3, 0.95, vDirt + (nz-0.5)*0.5) * 0.75, roadW);
float wet = 1.0 - smoothstep(0.0, 0.45, vWPos.y);
// only layers with weight are sampled (most ground has one or two): same result, far fewer texture reads
vec3 col = vec3(0.0);
if (w.x > 0.0) {
  vec3 sand = AT(t_sand, 0.8).rgb;
  sand = mix(vec3(dot(sand, vec3(0.33))), sand, 0.5) * vec3(1.42,1.26,0.98);
  if (wet > 0.0) sand = mix(sand, AT(t_wetsand, 1.0).rgb * vec3(0.95,0.9,0.8), wet);
  col += sand * w.x;
}
if (w.y > 0.0) {
  vec3 grass = AT(t_grass, 1.0).rgb;
  // push grass toward lush tropical green
  float gl = dot(grass, vec3(0.3,0.59,0.11));
  col += (mix(vec3(gl), grass, 1.25) * vec3(0.62, 0.98, 0.42)) * w.y;
}
if (w.z > 0.0) col += AT(t_jungle, 1.2).rgb * vec3(0.62, 0.78, 0.45) * w.z;
if (w.w > 0.0) {
  vec3 rock = AT(t_rock, 0.6).rgb;
  if (cliffW > 0.0) rock = mix(rock, AT(t_cliff, 0.35).rgb * vec3(0.85,0.8,0.72), cliffW);
  col += rock * w.w;
}
if (dirtW > 0.0) col = mix(col, AT(t_dirt, 0.9).rgb * vec3(1.05,0.92,0.78), dirtW*0.95);
// worn wheel ruts darken the road centre slightly
col *= 1.0 - roadW * smoothstep(0.75, 1.0, roadV) * 0.12;
// underwater tint + caustics
float depth = -vWPos.y;
if (depth > 0.0) {
  float k = clamp(depth/6.0, 0.0, 1.0);
  col = mix(col, col*vec3(0.35,0.75,0.8), smoothstep(0.0,1.0,k));
  col += caustic(vWPos.xz*0.9, uTime*1.2) * vec3(0.55,0.75,0.7) * (1.0-k) * smoothstep(0.0,0.4,depth);
}
gW = w;
if (uOverlayOn > 0.5) {
  // bold, readable overlay: the ground goes grey and dim, the tint goes on nearly opaque and glows a little so
  // shadows and dusk don't swallow it
  vec4 ov = texture2D(uOverlay, vWPos.xz / uMapN);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(vec3(lum * 0.45 + 0.04), ov.rgb, clamp(ov.a * 0.95, 0.0, 1.0));
  gOv = ov.rgb * ov.a * 0.32;
}
diffuseColor.rgb *= col;
`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
  vec3 tn = vec3(0.0);
  if (gW.x > 0.0) tn += (AT(n_sand, 0.8).xyz*2.0-1.0) * gW.x;
  if (gW.y > 0.0) tn += (AT(n_grass, 1.0).xyz*2.0-1.0) * gW.y;
  if (gW.z > 0.0) tn += (AT(n_jungle, 1.2).xyz*2.0-1.0) * gW.z;
  if (gW.w > 0.0) tn += (AT(n_rock, 0.6).xyz*2.0-1.0) * gW.w * 1.4;
  tn = normalize(tn);
  if (dirtW > 0.0) tn = normalize(mix(tn, AT(n_dirt, 0.9).xyz*2.0-1.0, dirtW*0.9));
  tn.xy *= 0.9;
  // world-aligned tangent frame (terrain uv = world xz)
  vec3 Nw = normalize(vWNorm);
  vec3 T = normalize(vec3(1.0,0.0,0.0) - Nw*Nw.x);
  vec3 B = cross(Nw, T);
  vec3 nw = normalize(T*tn.x - B*tn.y + Nw*tn.z);
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gOv;')
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = mix(0.95, 0.55, wet*w.x);`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-v3';
    return mat;
  }
}
