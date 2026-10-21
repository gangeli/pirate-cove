// Measure the stride (ground distance per cycle) of every locomotion clip of the crowd models, the way
// src/render/crowd.ts bakes them: evaluate the clip with three's mixer and track the feet in model space.
// A planted foot slides backward (the clips are in place); its speed times the cycle length is the stride.
// usage: node scripts/stride.mjs [model ...]   (prints JSON)
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function stripTextures(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jlen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jlen)));
  delete json.textures; delete json.images; delete json.samplers;
  json.extensionsRequired = (json.extensionsRequired || []).filter((e) => e !== 'KHR_texture_basisu');
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => e !== 'KHR_texture_basisu');
  for (const m of json.materials || []) {
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  const jsp = new Uint8Array(js.length + pad).fill(0x20); jsp.set(js);
  const rest = buf.subarray(20 + jlen);
  const out = new Uint8Array(20 + jsp.length + rest.length);
  out.set(buf.subarray(0, 12));
  const o = new DataView(out.buffer);
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsp.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jsp, 20); out.set(rest, 20 + jsp.length);
  return out.buffer;
}

const LOCO = ['walk', 'run', 'carry', 'limp', 'swagger', 'march', 'idle'];
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['pirate', 'pirate_f', 'captive', 'captive_f', 'soldier', 'skeleton'];
const out = {};
for (const name of models) {
  const buf = fs.readFileSync(new URL(`../public/assets/chars/${name}.glb`, import.meta.url));
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(stripTextures(new Uint8Array(buf)), '', res, rej));
  let sk;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) sk = o; });
  const bone = (n) => sk.skeleton.bones.find((b) => b.name === n);
  const feet = { L: [bone('LeftToeBase'), bone('LeftFoot')], R: [bone('RightToeBase'), bone('RightFoot')] };
  const mixer = new THREE.AnimationMixer(gltf.scene);
  out[name] = {};
  const v = new THREE.Vector3();
  for (const clipName of LOCO) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    if (!clip) continue;
    mixer.stopAllAction();
    const act = mixer.clipAction(clip);
    act.reset().play();
    const N = Math.round(clip.duration * 120);
    const tr = { L: [], R: [] };
    for (let f = 0; f <= N; f++) {
      mixer.setTime((f / N) * clip.duration * 0.9999);
      gltf.scene.updateMatrixWorld(true);
      for (const s of ['L', 'R']) {
        // contact point: the lower of toe and ankle (heel strike vs toe off)
        const pts = feet[s].map((b) => b.getWorldPosition(v).clone());
        const lo = pts[0].y < pts[1].y ? pts[0] : pts[1];
        tr[s].push({ x: lo.x, y: lo.y, z: lo.z, toe: pts[0], ank: pts[1] });
      }
    }
    // stance: frames within 2.5 cm of the foot's lowest point; slide speed there is the ground speed
    const dtf = clip.duration / N;
    const res = {};
    let speeds = [];
    for (const s of ['L', 'R']) {
      const t = tr[s];
      const ymin = Math.min(...t.map((p) => p.y));
      const stance = t.map((p) => p.y < ymin + 0.025);
      const vz = [];
      for (let i = 1; i < t.length; i++) if (stance[i] && stance[i - 1]) vz.push(-(t[i].z - t[i - 1].z) / dtf);
      vz.sort((a, b) => a - b);
      const med = vz.length ? vz[Math.floor(vz.length / 2)] : 0;
      res[s] = { stanceFrac: +(stance.filter(Boolean).length / t.length).toFixed(2), vMed: +med.toFixed(3), ymin: +ymin.toFixed(3) };
      speeds.push(med);
      // first stance-start frame (heel strike), as a fraction of the cycle
      let hs = -1;
      for (let i = 0; i < t.length; i++) if (stance[i] && !stance[(i - 1 + t.length) % t.length]) { hs = i / N; break; }
      res[s].strike = +hs.toFixed(3);
    }
    // support foot: at each moment the lower foot carries the body; its backward slide is the ground speed
    const sup = [];
    for (let i = 1; i < tr.L.length; i++) {
      const s = tr.L[i].y < tr.R[i].y ? 'L' : 'R';
      const s0 = tr.L[i - 1].y < tr.R[i - 1].y ? 'L' : 'R';
      if (s !== s0) continue;
      sup.push(-(tr[s][i].z - tr[s][i - 1].z) / dtf);
    }
    const mean = sup.reduce((a, b) => a + b, 0) / Math.max(1, sup.length);
    sup.sort((a, b) => a - b);
    res.supMed = +sup[Math.floor(sup.length / 2)].toFixed(3);
    res.supMean = +mean.toFixed(3);
    const v0 = mean;
    const rng = (a) => +(Math.max(...a) - Math.min(...a)).toFixed(3);
    res.yRange = [rng(tr.L.map((p) => p.y)), rng(tr.R.map((p) => p.y))];
    res.zRange = [rng(tr.L.map((p) => p.z)), rng(tr.R.map((p) => p.z))];
    res.xRange = [rng(tr.L.map((p) => p.x)), rng(tr.R.map((p) => p.x))];
    if (process.env.DUMP === clipName) for (let i = 0; i < tr.L.length; i += 6) console.error(i, tr.L[i].y.toFixed(3), tr.L[i].z.toFixed(3), tr.R[i].y.toFixed(3), tr.R[i].z.toFixed(3));
    out[name][clipName] = { duration: +clip.duration.toFixed(3), speed: +v0.toFixed(3), stride: +(v0 * clip.duration).toFixed(3), ...res };
  }
}
console.log(JSON.stringify(out, null, 1));
