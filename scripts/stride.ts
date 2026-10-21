// Stride of every locomotion clip of the crowd models, measured the way src/render/crowd.ts does at load: the clips
// prepared by clipfix.ts, baked at 30 fps, feet tracked in mesh space, analysed by gait.ts. Also the clip's own foot
// slide when played at that stride (what the renderer can achieve at best), per clip and with/without the repairs.
//   npx tsx scripts/stride.ts [model ...]
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { analyzeGait, planted, PLANT_EPS, type FootTrack } from '../src/render/gait';
import { prepareClips } from '../src/render/clipfix';

function stripTextures(buf: Uint8Array): ArrayBuffer {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jlen)));
  delete json.textures; delete json.images; delete json.samplers;
  json.extensionsRequired = (json.extensionsRequired || []).filter((e: string) => e !== 'KHR_texture_basisu');
  json.extensionsUsed = (json.extensionsUsed || []).filter((e: string) => e !== 'KHR_texture_basisu');
  for (const m of json.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  const js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  const jsp = new Uint8Array(js.length + pad).fill(0x20); jsp.set(js);
  const rest = buf.subarray(20 + jlen);
  const out = new Uint8Array(20 + jsp.length + rest.length);
  out.set(buf.subarray(0, 12));
  const o = new DataView(out.buffer);
  o.setUint32(8, out.length, true); o.setUint32(12, jsp.length, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(jsp, 20); out.set(rest, 20 + jsp.length);
  return out.buffer;
}

const FEET = [['L', 'LeftFoot'], ['L', 'LeftToeBase'], ['R', 'RightFoot'], ['R', 'RightToeBase']] as const;
const LOCO = ['walk', 'run', 'carry', 'limp', 'swagger', 'march'];
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['pirate', 'pirate_f', 'captive', 'captive_f', 'soldier', 'skeleton'];
const res: Record<string, any> = {};
for (const name of models) {
  const buf = fs.readFileSync(`public/assets/chars/${name}.glb`);
  const gltf: any = await new Promise((ok, no) => new GLTFLoader().parse(stripTextures(new Uint8Array(buf)), '', ok, no));
  let sk: THREE.SkinnedMesh | undefined;
  gltf.scene.traverse((o: any) => { if (o.isSkinnedMesh) sk = o; });
  const bindInv = sk!.bindMatrixInverse;
  const bones = FEET.map(([, n]) => sk!.skeleton.bones.find((b) => b.name === n)!);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  res[name] = {};
  for (const [tag, clips] of [['raw', gltf.animations], ['fixed', prepareClips(gltf.animations)]] as const) {
    for (const cn of LOCO) {
      const clip = (clips as THREE.AnimationClip[]).find((a) => a.name === cn);
      if (!clip) continue;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      const frames = Math.max(2, Math.round(clip.duration * 30) + 1);
      const tracks: FootTrack[] = FEET.map(([side]) => ({ side, y: new Float32Array(frames), z: new Float32Array(frames) }));
      const v = new THREE.Vector3();
      for (let f = 0; f < frames; f++) {
        mixer.setTime((f / (frames - 1)) * clip.duration * 0.9999);
        gltf.scene.updateMatrixWorld(true);
        bones.forEach((b, k) => {
          v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(bindInv);
          (tracks[k].y as Float32Array)[f] = v.y;
          (tracks[k].z as Float32Array)[f] = v.z;
        });
      }
      const gt = analyzeGait(tracks);
      // the clip's own slide at that stride: planted points' world speed over the body's, and its worst moment
      let slide = 0, travel = 0, worst = 0, worstU = 0;
      for (const t of tracks) {
        const pl = planted(t, PLANT_EPS);
        for (let i = 1; i < frames; i++) {
          if (!pl[i] || !pl[i - 1]) continue;
          const du = 1 / (frames - 1);
          const s = Math.abs(t.z[i] - t.z[i - 1] + gt.stride * du);
          slide += s;
          travel += gt.stride * du;
          if (s / (gt.stride * du) > worst) (worst = s / (gt.stride * du)), (worstU = i / (frames - 1));
        }
      }
      if (process.env.PROFILE === `${cn}.${tag}` && name === models[0])
        for (let i = 1; i < frames; i++) {
          const du = 1 / (frames - 1);
          console.log((i / (frames - 1)).toFixed(3), tracks.map((t) => `${t.side} y${t.y[i].toFixed(3)} s${((t.z[i] - t.z[i - 1] + gt.stride * du) / (gt.stride * du)).toFixed(2)}`).join('  '));
        }
      res[name][`${cn}.${tag}`] = { dur: +clip.duration.toFixed(3), stride: +gt.stride.toFixed(3), natSpeed: +(gt.stride / clip.duration).toFixed(3), strikeR: +gt.strikeR.toFixed(3), slide: +(slide / travel).toFixed(3), worst: +worst.toFixed(2), worstU: +worstU.toFixed(2) };
    }
  }
}
for (const m in res) for (const c in res[m]) console.log(m.padEnd(10), c.padEnd(14), JSON.stringify(res[m][c]));
