import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl, withKTX2 } from './textures';
import { gpu } from './backend';
import { analyzeGait, type FootTrack, type Gait } from './gait';

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
/** texels per instance: animation A, 8 colours, (on WebGPU the instance matrix, 4 texels, see nodes.ts crowdMaterial), animation B */
const dataWidth = () => (gpu() ? 14 : 10);
/** the texel holding the second, blended-in animation: (row, next row, frame fraction, blend weight) */
export const animBTexel = () => (gpu() ? 13 : 9);
/** clips whose gait (stride, foot strike) is measured at load: in-place locomotion */
export const GAIT_CLIPS = ['walk', 'run', 'carry', 'limp', 'swagger', 'march'];
/** foot contact points tracked through the bake (ankle and ball of each foot) */
const FEET = [['L', 'LeftFoot'], ['L', 'LeftToeBase'], ['R', 'RightFoot'], ['R', 'RightToeBase']] as const;
/** bones a carrier holds the load with: their pose comes from the carry clip, the rest of the body walks */
const CARRY_ARMS = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand|FingerBase|HandFinger1)$|^[LR]Thumb$/;

interface ClipInfo {
  start: number;
  frames: number;
  duration: number;
  loop: boolean;
  /** measured for locomotion clips */
  gait?: Gait;
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
  /** an InstancedMesh on WebGL; on WebGPU a plain Mesh drawn `count` times (its instance matrices live in the data texture) */
  mesh!: THREE.Mesh & { count: number };
  private inst: THREE.InstancedMesh | null = null;
  private setData: ((t: THREE.DataTexture) => void) | null = null;
  private readonly dataW = dataWidth();
  clips = new Map<string, ClipInfo>();
  private boneTex!: THREE.DataTexture;
  private dataTex!: THREE.DataTexture;
  private data!: Float32Array;
  /** rows in the per-instance data texture: grows in powers of two up to `cap`, so the per-frame upload
   *  is about the size of the crowd rather than the capacity */
  private rows = 0;
  private readonly uData = { value: null as THREE.DataTexture | null };
  private lastCount = 0;
  count = 0;
  readonly cap: number;
  private bones = 0;
  textured = false;
  /** per baked row: the four foot contact points in mesh space (x, y, z each), for gait analysis and slide measurement */
  private feet = new Float32Array(0);

  constructor(cap: number) {
    this.cap = cap;
  }

  async load(url: string): Promise<void> {
    const gltf = await withKTX2(new GLTFLoader()).loadAsync(url);
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
    const feet: number[] = [];
    let start = 0;
    const tmp = new THREE.Matrix4();
    const bindInv = skinned.bindMatrixInverse.clone(), bind = skinned.bindMatrix.clone();
    const footBones = FEET.map(([, n]) => sk.bones.find((b) => b.name === n));
    const fp = new THREE.Vector3();
    const anims = gltf.animations.slice();
    // the carry clip as captured stands still (the actor waited with the load): carriers walk with the walk cycle's
    // legs and body, holding the load in the carry clip's arms. Same stride and timing as the walk, so they blend.
    const walkClip = anims.find((a) => a.name === 'walk'), carryClip = anims.find((a) => a.name === 'carry');
    if (walkClip && carryClip) {
      const arm = (tr: THREE.KeyframeTrack) => CARRY_ARMS.test(tr.name.split('.')[0]);
      const held = carryClip.tracks.filter(arm).map((tr) => {
        // the pose a quarter of the way in, held
        const k = Math.floor(tr.times.length / 4), w = tr.getValueSize();
        const T = tr.constructor as new (n: string, t: number[], v: number[]) => THREE.KeyframeTrack;
        return new T(tr.name, [0], Array.from(tr.values.slice(k * w, k * w + w)));
      });
      const synth = new THREE.AnimationClip('carry', walkClip.duration, [...walkClip.tracks.filter((tr) => !arm(tr)), ...held]);
      anims.splice(anims.indexOf(carryClip), 1, synth);
    }
    for (const name of CLIPS) {
      const clip = anims.find((a) => a.name === name);
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
          tmp.fromArray(sk.boneMatrices!, b * 16);
          tmp.premultiply(bindInv).multiply(bind);
          tmp.toArray(row, b * 16);
        }
        rows.push(row);
        for (const fb of footBones) {
          if (fb) fp.setFromMatrixPosition(fb.matrixWorld).applyMatrix4(bindInv);
          else fp.set(0, 0, 0);
          feet.push(fp.x, fp.y, fp.z);
        }
      }
      const info: ClipInfo = { start, frames, duration: clip.duration, loop: name !== 'die' };
      if (GAIT_CLIPS.includes(name) && footBones.every(Boolean)) {
        const tracks: FootTrack[] = FEET.map(([side], k) => ({
          side,
          y: Array.from({ length: frames }, (_, f) => feet[((start + f) * 4 + k) * 3 + 1]),
          z: Array.from({ length: frames }, (_, f) => feet[((start + f) * 4 + k) * 3 + 2]),
        }));
        info.gait = analyzeGait(tracks);
      }
      this.clips.set(name, info);
      start += frames;
      act.stop();
    }
    this.feet = new Float32Array(feet);
    const w = this.bones * 4, h = rows.length;
    const buf = new Float32Array(w * h * 4);
    rows.forEach((r, i) => buf.set(r, i * w * 4));
    this.boneTex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.needsUpdate = true;
    this.resizeData(Math.min(this.cap, 64));

    const geo = skinned.geometry;
    // the atlas holds linear detail multipliers (x2), not colours
    const map = (skinned.material as THREE.MeshStandardMaterial).map;
    if (map) {
      map.colorSpace = THREE.NoColorSpace;
      map.anisotropy = 4;
      map.needsUpdate = true;
    }
    this.textured = !!map;
    const g = gpu();
    if (g) {
      // WebGPU: skinning, region colours and the instance transform in one node vertex stage (nodes.ts crowdMaterial)
      const c = g.crowdMaterial({ boneTex: this.boneTex as any, dataTex: this.dataTex as any, textured: this.textured, map: map as any });
      this.setData = c.setData as unknown as (t: THREE.DataTexture) => void;
      const mat = c.material as unknown as THREE.Material;
      mat.userData.textures = [this.boneTex];
      this.mesh = Object.assign(new THREE.Mesh(geo, mat), { count: 0 });
    } else {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, map, alphaTest: map ? 0.5 : 0, side: map ? THREE.DoubleSide : THREE.FrontSide });
      this.inject(mat, false);
      this.inst = new THREE.InstancedMesh(geo, mat, this.cap);
      this.inst.count = 0;
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      this.inject(depth, true);
      this.inst.customDepthMaterial = depth;
      this.mesh = this.inst;
    }
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  private inject(mat: THREE.Material, depthOnly: boolean): void {
    const boneTex = () => this.boneTex;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBones = { value: boneTex() };
      sh.uniforms.uData = this.uData; // shared, so a regrown data texture reaches both materials
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
vec4 animB = idat(${animBTexel()});
if (animB.w > 0.001) {
  // a second clip blended in (walk into run, idle into walk): same frame interpolation, then a cross-fade
  mat4 sb = skinMat(sj, skinWeight, int(animB.x)) * (1.0 - animB.z) + skinMat(sj, skinWeight, int(animB.y)) * animB.z;
  skinM = skinM * (1.0 - animB.w) + sb * animB.w;
}
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

  private resizeData(rows: number): void {
    const W = this.dataW;
    const data = new Float32Array(W * rows * 4);
    if (this.data) data.set(this.data.subarray(0, Math.min(this.data.length, data.length)));
    this.data = data;
    this.dataTex?.dispose();
    this.dataTex = new THREE.DataTexture(data as any, W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.dataTex.needsUpdate = true;
    this.uData.value = this.dataTex;
    this.setData?.(this.dataTex);
    this.rows = rows;
  }

  /** begin a frame */
  reset(): void {
    this.count = 0;
  }

  /** add an instance; t = seconds into the clip */
  add(matrix: THREE.Matrix4, clip: string, t: number, look: Look): void {
    const c = this.clips.get(clip) ?? this.clips.get('idle')!;
    this.addPose(matrix, clip, t / c.duration, null, 0, 0, look);
  }

  /** a clip's info (frames, duration, measured gait), falling back to idle */
  clip(name: string): ClipInfo {
    return this.clips.get(name) ?? this.clips.get('idle')!;
  }

  /** rows and fraction of clip `name` at cycle phase u (0..1, wraps for loops) */
  private frameOf(name: string, u: number): [number, number, number] {
    const c = this.clip(name);
    u = c.loop ? u - Math.floor(u) : Math.min(1, Math.max(0, u));
    const f = u * (c.frames - 1);
    const f0 = Math.min(c.frames - 1, Math.floor(f)), f1 = c.loop ? (f0 + 1) % c.frames : Math.min(c.frames - 1, f0 + 1);
    return [c.start + f0, c.start + f1, f - f0];
  }

  /**
   * add an instance posed by clip `a` at cycle phase `ua`, cross-faded with weight `w` toward clip `b` at phase `ub`
   * (b = null or w = 0: clip a alone). The hand prop is the one of whichever clip dominates.
   */
  addPose(matrix: THREE.Matrix4, a: string, ua: number, b: string | null, ub: number, w: number, look: Look): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    if (i >= this.rows) this.resizeData(Math.min(this.cap, this.rows * 2));
    const d = this.data, o = i * this.dataW * 4;
    if (this.inst) matrix.toArray(this.inst.instanceMatrix.array, i * 16);
    else matrix.toArray(d, o + 36);
    const A = this.frameOf(a, ua);
    d[o] = A[0];
    d[o + 1] = A[1];
    d[o + 2] = A[2];
    const ob = o + animBTexel() * 4;
    if (b && w > 0.001) {
      const B = this.frameOf(b, ub);
      d[ob] = B[0];
      d[ob + 1] = B[1];
      d[ob + 2] = B[2];
      d[ob + 3] = Math.min(1, w);
    } else d[ob + 3] = 0;
    d[o + 3] = PROP_OF[b && w > 0.5 ? b : a] ?? 0;
    put(d, o + 4, look.skin, 1);
    put(d, o + 8, look.shirt, 1);
    put(d, o + 12, look.pants, 1);
    put(d, o + 16, look.hair, look.beard ? 1 : 0);
    put(d, o + 20, look.hat ?? look.hair, look.hat ? 1 : 0);
    put(d, o + 24, look.hat2 ?? look.hair, look.hat2 ? 1 : 0);
    put(d, o + 28, look.sash, 1);
    put(d, o + 32, look.coat ?? look.shirt, 1);
  }

  /**
   * world positions of the four foot contact points (L ankle, L ball, R ankle, R ball) of instance i as drawn this
   * frame: the same row blend the vertex shader does, applied to the points (debug: foot slide measurement)
   */
  instanceFeet(i: number, matrix: THREE.Matrix4, out: THREE.Vector3[]): void {
    const d = this.data, o = i * this.dataW * 4, ob = o + animBTexel() * 4;
    const F = this.feet;
    const wb = d[ob + 3];
    for (let k = 0; k < 4; k++) {
      const v = out[k].set(0, 0, 0);
      const acc = (row: number, wt: number) => {
        const j = (row * 4 + k) * 3;
        v.x += F[j] * wt;
        v.y += F[j + 1] * wt;
        v.z += F[j + 2] * wt;
      };
      const wa = wb > 0.001 ? 1 - wb : 1;
      acc(d[o], wa * (1 - d[o + 2]));
      acc(d[o + 1], wa * d[o + 2]);
      if (wb > 0.001) {
        acc(d[ob], wb * (1 - d[ob + 2]));
        acc(d[ob + 1], wb * d[ob + 2]);
      }
      v.applyMatrix4(matrix);
    }
  }

  commit(): void {
    this.mesh.count = this.count;
    // nothing drawn now or last frame: no uploads at all
    if (this.count === 0 && this.lastCount === 0) return;
    this.lastCount = this.count;
    if (this.inst) {
      const im = this.inst.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, Math.max(1, this.count) * 16);
      im.needsUpdate = true;
    }
    this.dataTex.needsUpdate = true;
  }
}

function put(d: Float32Array, o: number, col: THREE.Color, a: number): void {
  d[o] = col.r;
  d[o + 1] = col.g;
  d[o + 2] = col.b;
  d[o + 3] = a;
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
