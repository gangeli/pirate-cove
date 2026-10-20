import * as THREE from 'three';
import { GameMap } from '../sim/map';
import { gpu } from './backend';

/** Tropical ocean: gerstner swell, depth-tinted colour from terrain heightmap, shore foam, sun glints. */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly heightTex: THREE.DataTexture;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(private map: GameMap) {
    const n = map.size;
    const s = n + 1;
    this.heightTex = new THREE.DataTexture(toHalf(map.vh) as any, s, s, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;
    const size = n * 8;
    const geo = new THREE.PlaneGeometry(size, size, 384, 384);
    geo.rotateX(-Math.PI / 2);
    geo.translate(n / 2, 0, n / 2);
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
uniform float uTime;
varying vec3 vWPos;
#include <fog_pars_vertex>
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
  wp.xyz += off * 0.6;
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
float terrainH(vec2 p){
  vec2 uv = (p + 0.5) / (uMapSize + 1.0);
  if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return -14.0;
  return texture2D(uHeight, uv).r;
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
  vec3 N = waveNormal(vWPos.xz);
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
    foam = shore * smoothstep(0.45, 0.9, bands*0.6 + foamN*0.6);
    foam += (1.0 - smoothstep(0.0, 0.25, depth)) * smoothstep(0.35, 0.6, foamN);
  }
  // open-sea whitecaps
  if (depth > 3.0) foam += smoothstep(0.78, 0.92, fbm(vWPos.xz*0.35 + uTime*0.05)) * 0.25 * smoothstep(3.0, 10.0, depth);
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
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
  }

  syncHeights(): void {
    (this.heightTex.image.data as unknown as Uint16Array).set(toHalf(this.map.vh));
    this.heightTex.needsUpdate = true;
  }
}

function toHalf(a: Float32Array): Uint16Array {
  const o = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = THREE.DataUtils.toHalfFloat(a[i]);
  return o;
}
