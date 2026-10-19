import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from './textures';

/**
 * Instanced, GPU-skinned crowds. Each character model's animation clips are baked into a float texture
 * of bone matrices (one row per frame). Every instance reads its animation row(s) and clothing colours
 * from a per-instance data texture, so hundreds of animated people cost one draw call per model.
 */

export const CLIPS = ['idle', 'walk', 'run', 'carry', 'swing', 'farm', 'drink', 'cheer', 'fight', 'die', 'sleep', 'sit', 'dance', 'talk', 'limp', 'swagger', 'march'] as const;
export type ClipName = (typeof CLIPS)[number];
const BAKE_FPS = 30;
/** which hand prop (region id) a clip shows */
const PROP_OF: Record<string, number> = { fight: 11, swing: 12, farm: 13, drink: 14, carry: 15 };
const DATA_W = 9; // texels per instance

interface ClipInfo {
  start: number;
  frames: number;
  duration: number;
  loop: boolean;
}

export interface Look {
  skin: THREE.Color;
  shirt: THREE.Color;
  pants: THREE.Color;
  hair: THREE.Color;
  beard: boolean;
  hat: THREE.Color | null; // bandana / headscarf
  hat2: THREE.Color | null; // tricorn
  sash: THREE.Color;
  boots: THREE.Color;
  coat?: THREE.Color;
}

export class CrowdModel {
  mesh!: THREE.InstancedMesh;
  clips = new Map<string, ClipInfo>();
  private boneTex!: THREE.DataTexture;
  private dataTex!: THREE.DataTexture;
  private data!: Float32Array;
  count = 0;
  readonly cap: number;
  private bones = 0;
  textured = false;

  constructor(cap: number) {
    this.cap = cap;
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    let skinned: THREE.SkinnedMesh | undefined;
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
    });
    if (!skinned) throw new Error('no skinned mesh in ' + url);
    const sk = skinned.skeleton;
    this.bones = sk.bones.length;
    // bake
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const rows: Float32Array[] = [];
    let start = 0;
    const tmp = new THREE.Matrix4();
    const bindInv = skinned.bindMatrixInverse.clone(), bind = skinned.bindMatrix.clone();
    for (const name of CLIPS) {
      const clip = gltf.animations.find((a) => a.name === name);
      if (!clip) continue;
      mixer.stopAllAction();
      const act = mixer.clipAction(clip);
      act.reset().play();
      const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1);
      for (let f = 0; f < frames; f++) {
        mixer.setTime((f / (frames - 1)) * clip.duration * 0.9999);
        gltf.scene.updateMatrixWorld(true);
        sk.update();
        const row = new Float32Array(this.bones * 16);
        for (let b = 0; b < this.bones; b++) {
          tmp.fromArray(sk.boneMatrices, b * 16);
          tmp.premultiply(bindInv).multiply(bind);
          tmp.toArray(row, b * 16);
        }
        rows.push(row);
      }
      this.clips.set(name, { start, frames, duration: clip.duration, loop: name !== 'die' });
      start += frames;
      act.stop();
    }
    const w = this.bones * 4, h = rows.length;
    const buf = new Float32Array(w * h * 4);
    rows.forEach((r, i) => buf.set(r, i * w * 4));
    this.boneTex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.needsUpdate = true;
    this.data = new Float32Array(DATA_W * this.cap * 4);
    this.dataTex = new THREE.DataTexture(this.data as any, DATA_W, this.cap, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.needsUpdate = true;

    const geo = skinned.geometry;
    // the atlas holds linear detail multipliers (x2), not colours
    const map = (skinned.material as THREE.MeshStandardMaterial).map;
    if (map) {
      map.colorSpace = THREE.NoColorSpace;
      map.anisotropy = 4;
      map.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, map, alphaTest: map ? 0.5 : 0, side: map ? THREE.DoubleSide : THREE.FrontSide });
    this.textured = !!map;
    this.inject(mat, false);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.inject(depth, true);
    this.mesh.customDepthMaterial = depth;
  }

  private inject(mat: THREE.Material, depthOnly: boolean): void {
    const boneTex = () => this.boneTex;
    const dataTex = () => this.dataTex;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBones = { value: boneTex() };
      sh.uniforms.uData = { value: dataTex() };
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform highp sampler2D uBones; uniform highp sampler2D uData;
attribute vec4 color; attribute vec4 skinIndex; attribute vec4 skinWeight;
${depthOnly ? '' : 'flat varying vec3 vRC;'}
vec4 idat(int k){ return texelFetch(uData, ivec2(k, gl_InstanceID), 0); }
mat4 boneAt(int b, int row){
  int x = b * 4;
  return mat4(texelFetch(uBones, ivec2(x, row), 0), texelFetch(uBones, ivec2(x + 1, row), 0),
              texelFetch(uBones, ivec2(x + 2, row), 0), texelFetch(uBones, ivec2(x + 3, row), 0));
}
mat4 skinMat(ivec4 j, vec4 w, int row){
  return boneAt(j.x, row) * w.x + boneAt(j.y, row) * w.y + boneAt(j.z, row) * w.z + boneAt(j.w, row) * w.w;
}`,
        )
        .replace(
          '#include <skinbase_vertex>',
          `vec4 anim = idat(0);
ivec4 sj = ivec4(skinIndex);
mat4 sm0 = skinMat(sj, skinWeight, int(anim.x));
mat4 sm1 = skinMat(sj, skinWeight, int(anim.y));
mat4 skinM = sm0 * (1.0 - anim.z) + sm1 * anim.z;
int region = int(floor(color.r * 20.0 + 0.5));
float hide = 0.0;
vec3 rc = vec3(1.0);
if (region == 0) rc = idat(1).rgb;
else if (region == 1) rc = idat(2).rgb;
else if (region == 2) rc = idat(3).rgb;
else if (region == 3) rc = ${this.textured ? 'vec3(0.16, 0.10, 0.065)' : 'vec3(0.13, 0.09, 0.06)'};
else if (region == 4) rc = idat(4).rgb;
else if (region == 5) { vec4 h = idat(5); rc = h.rgb; hide = 1.0 - h.a; }
else if (region == 6) rc = idat(7).rgb;
else if (region == 7) rc = idat(8).rgb;
else if (region == 8) rc = ${this.textured ? 'vec3(1.0)' : 'vec3(0.03)'};
else if (region == 9) { vec4 h = idat(6); rc = h.rgb; hide = 1.0 - h.a; }
else if (region == 10) { vec4 h = idat(4); rc = h.rgb * 0.85; hide = 1.0 - h.a; }
else if (region >= 11) {
  // hand props: only the one belonging to the current clip is shown
  hide = int(anim.w + 0.5) == region ? 0.0 : 1.0;
  rc = region == 11 ? vec3(0.55, 0.56, 0.6) : region == 14 ? vec3(0.2, 0.2, 0.21) : region == 15 ? vec3(0.22, 0.14, 0.065) : vec3(0.16, 0.085, 0.04);
}
${depthOnly ? '' : 'vRC = rc;'}`,
        )
        .replace('#include <skinnormal_vertex>', depthOnly ? '' : 'objectNormal = normalize(mat3(skinM) * objectNormal);')
        .replace('#include <skinning_vertex>', 'transformed = (skinM * vec4(transformed, 1.0)).xyz; if (hide > 0.5) transformed = vec3(0.0, 0.85, 0.0);');
      if (!depthOnly) {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nflat varying vec3 vRC;')
          .replace('#include <map_fragment>', `#include <map_fragment>\n${this.textured ? 'diffuseColor.rgb *= 2.0;' : ''}`)
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vRC;');
      }
    };
    mat.customProgramCacheKey = () => 'crowd' + (depthOnly ? 'd' : 'c') + (this.textured ? 't' : '');
  }

  /** begin a frame */
  reset(): void {
    this.count = 0;
  }

  /** add an instance; t = seconds into the clip */
  add(matrix: THREE.Matrix4, clip: string, t: number, look: Look): void {
    if (this.count >= this.cap) return;
    const c = this.clips.get(clip) ?? this.clips.get('idle')!;
    let u = t / c.duration;
    u = c.loop ? u - Math.floor(u) : Math.min(1, u);
    const f = u * (c.frames - 1);
    const f0 = Math.floor(f), f1 = c.loop ? (f0 + 1) % c.frames : Math.min(c.frames - 1, f0 + 1);
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    const d = this.data, o = i * DATA_W * 4;
    d[o] = c.start + f0;
    d[o + 1] = c.start + f1;
    d[o + 2] = f - f0;
    d[o + 3] = PROP_OF[clip] ?? 0;
    const put = (k: number, col: THREE.Color, a = 1) => {
      d[o + k * 4] = col.r;
      d[o + k * 4 + 1] = col.g;
      d[o + k * 4 + 2] = col.b;
      d[o + k * 4 + 3] = a;
    };
    put(1, look.skin);
    put(2, look.shirt);
    put(3, look.pants);
    put(4, look.hair, look.beard ? 1 : 0);
    put(5, look.hat ?? look.hair, look.hat ? 1 : 0);
    put(6, look.hat2 ?? look.hair, look.hat2 ? 1 : 0);
    put(7, look.sash);
    put(8, look.coat ?? look.shirt);
  }

  commit(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dataTex.needsUpdate = true;
  }
}

export const MODELS = ['pirate', 'pirate_f', 'captive', 'captive_f', 'soldier', 'skeleton'] as const;
export type ModelName = (typeof MODELS)[number];

export async function loadCrowd(cap = 1200): Promise<Partial<Record<ModelName, CrowdModel>>> {
  const out: Partial<Record<ModelName, CrowdModel>> = {};
  await Promise.all(MODELS.map(async (k) => {
    const m = new CrowdModel(cap);
    try {
      await m.load(assetUrl(`chars/${k}.glb`));
      out[k] = m;
    } catch (e) {
      console.warn('crowd model missing', k, e);
    }
  }));
  return out;
}
