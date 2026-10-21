import { AnimationClip, type KeyframeTrack } from 'three';

/**
 * Load-time repairs of the character clips as exported by scripts/blender (mhlib.py), so locomotion loops play
 * seamlessly. Pure track edits: the GLBs stay as they are.
 */

/**
 * Blender keys a clip from frame 1, so the exported keys start at 1/24 s and three holds the first pose from 0 until
 * then: every loop froze for a frame (feet stuck while the body moves on). Shift the keys to start at 0.
 */
export function trimLead(clip: AnimationClip): void {
  let t0 = Infinity;
  for (const tr of clip.tracks) if (tr.times.length) t0 = Math.min(t0, tr.times[0]);
  if (!(t0 > 0) || !Number.isFinite(t0)) return;
  for (const tr of clip.tracks) for (let i = 0; i < tr.times.length; i++) tr.times[i] -= t0;
  clip.duration -= t0;
}

/**
 * mhlib's _blend_loop closes a loop by cross-fading the last k keys toward the *first frame's* value (a constant), so
 * the limbs decelerate into the seam and a planted foot slips. For loops whose ends already match (the loop finder's
 * pose error is tiny for walk and run) the fade is unnecessary: invert it, restoring the captured motion right up to
 * the last key (which repeats the first). key[n-k+j] = orig * (1 - t) + first * t with t = (j + 1) / (k + 1).
 */
export function unblendLoop(clip: AnimationClip, k = 6): void {
  for (const tr of clip.tracks) {
    const n = tr.times.length, w = tr.getValueSize(), v = tr.values;
    if (n < k + 2) continue;
    // only a track that was faded: its last key repeats its first
    let same = true;
    for (let c = 0; c < w; c++) if (Math.abs(v[(n - 1) * w + c] - v[c]) > 1e-4) same = false;
    if (!same) continue;
    for (let j = 0; j < k - 1; j++) {
      const idx = n - k + j, t = (j + 1) / (k + 1);
      for (let c = 0; c < w; c++) v[idx * w + c] = (v[idx * w + c] - v[c] * t) / (1 - t);
    }
    if (tr.name.endsWith('.quaternion')) {
      for (let i = n - k; i < n - 1; i++) {
        const o = i * w, l = Math.hypot(v[o], v[o + 1], v[o + 2], v[o + 3]) || 1;
        for (let c = 0; c < 4; c++) v[o + c] /= l;
      }
    }
  }
}

/** bones a carrier holds the load with: their pose comes from the carry clip, the rest of the body walks */
const CARRY_ARMS = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand|FingerBase|HandFinger1)$|^[LR]Thumb$/;
/** loops whose captured ends match (mhlib clip_loops.json pose error < 0.01) and so play best unfaded */
const SEAMLESS = ['walk', 'run'];

/**
 * The clips as the crowd bakes them: keys from 0, the walk and run loops unfaded, and a carry clip that walks.
 * The carry clip as captured stands still (the actor waited with the load), so carriers glided; now they walk with
 * the walk cycle's legs and body and hold the load in the carry clip's arms: same stride and timing as the walk.
 */
export function prepareClips(anims: AnimationClip[]): AnimationClip[] {
  const out = anims.map((a) => a.clone());
  for (const a of out) {
    trimLead(a);
    if (SEAMLESS.includes(a.name)) unblendLoop(a);
  }
  const walk = out.find((a) => a.name === 'walk'), carry = out.find((a) => a.name === 'carry');
  if (walk && carry) {
    const arm = (tr: KeyframeTrack) => CARRY_ARMS.test(tr.name.split('.')[0]);
    const held = carry.tracks.filter(arm).map((tr) => {
      // the pose a quarter of the way in, held
      const k = Math.floor(tr.times.length / 4), w = tr.getValueSize();
      const T = tr.constructor as new (n: string, t: number[], v: number[]) => KeyframeTrack;
      return new T(tr.name, [0], Array.from(tr.values.slice(k * w, k * w + w)));
    });
    const synth = new AnimationClip('carry', walk.duration, [...walk.tracks.filter((tr) => !arm(tr)).map((tr) => tr.clone()), ...held]);
    out.splice(out.indexOf(carry), 1, synth);
  }
  return out;
}
