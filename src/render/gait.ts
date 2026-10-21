/**
 * Gait analysis for in-place locomotion clips. The character clips are baked "in place" (scripts/blender/mhlib.py
 * removes the root's forward trend), so a planted foot slides backward under the body at exactly the speed the
 * actor walked. Measuring that slide gives the clip's stride: the ground distance covered per cycle. Played so
 * that phase advances by distance / stride, the planted foot then stays put on the ground.
 *
 * Coordinates: model space, y up, the character faces +z.
 */

/** one foot contact point (ankle or ball of the foot) sampled over a cycle: frames 0..N-1, the last equal to the first */
export interface FootTrack {
  side: 'L' | 'R';
  y: ArrayLike<number>;
  z: ArrayLike<number>;
}

export interface Gait {
  /** ground distance per cycle, model units */
  stride: number;
  /** cycle phase (0..1) at which the right foot strikes the ground: lets phase-aligned clips blend */
  strikeR: number;
  /** fraction of the cycle with a foot planted (diagnostic) */
  contact: number;
}

/** a contact point counts as planted within this height of its lowest point in the cycle */
export const PLANT_EPS = 0.02;

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** is each frame of a track planted (near its own lowest point)? */
export function planted(t: FootTrack, eps = PLANT_EPS): boolean[] {
  let lo = Infinity;
  for (let i = 0; i < t.y.length; i++) lo = Math.min(lo, t.y[i]);
  return Array.from(t.y, (y) => y < lo + eps);
}

/**
 * Stride from the planted feet: the median backward speed (per cycle) of every planted contact point. The median is
 * the speed that minimises the total slide (an L1 fit), robust to the frames where a foot is just landing or leaving.
 */
export function analyzeGait(tracks: FootTrack[]): Gait {
  const sp: number[] = [];
  let contactFrames = 0, frames = 0;
  for (const t of tracks) {
    const n = t.y.length;
    if (n < 3) continue;
    const pl = planted(t);
    const du = 1 / (n - 1);
    for (let i = 1; i < n; i++) if (pl[i] && pl[i - 1]) sp.push(-(t.z[i] - t.z[i - 1]) / du);
  }
  const stride = Math.max(0, median(sp));
  // right foot strike: the first frame the right foot (ankle or ball, whichever is lower) lands after a swing
  const R = tracks.filter((t) => t.side === 'R');
  let strikeR = 0;
  if (R.length) {
    const n = R[0].y.length;
    const low = Array.from({ length: n }, (_, i) => Math.min(...R.map((t) => t.y[i])));
    const lo = Math.min(...low);
    const c = low.map((y) => y < lo + PLANT_EPS);
    frames = n - 1;
    for (let i = 0; i < n - 1; i++) if (c[i]) contactFrames++;
    for (let i = 0; i < n - 1; i++) {
      const prev = c[(i - 1 + n - 1) % (n - 1)];
      if (c[i] && !prev) {
        strikeR = i / (n - 1);
        break;
      }
    }
  }
  return { stride, strikeR, contact: frames ? contactFrames / frames : 0 };
}

/**
 * Foot slide of a played animation, from world-space samples of the contact points over time. A point is planted while
 * it is within `eps` of its lowest height above the ground over the run; while planted it should not move. Returns the mean horizontal slide speed of planted
 * points and the slide as a fraction of the distance the body covered meanwhile.
 */
export function measureSlide(samples: { t: number; body: [number, number]; pts: [number, number, number][]; ground: number }[], eps: number): { slideSpeed: number; slideRatio: number; plantedTime: number } {
  let slide = 0, travel = 0, time = 0;
  const K = samples[0]?.pts.length ?? 0;
  const lo = Array.from({ length: K }, (_, k) => Math.min(...samples.map((s) => s.pts[k][1] - s.ground)));
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    const moved = Math.hypot(b.body[0] - a.body[0], b.body[1] - a.body[1]);
    for (let k = 0; k < b.pts.length; k++) {
      const p = a.pts[k], q = b.pts[k];
      if (p[1] - a.ground > lo[k] + eps || q[1] - b.ground > lo[k] + eps) continue;
      slide += Math.hypot(q[0] - p[0], q[2] - p[2]);
      travel += moved;
      time += dt;
    }
  }
  return { slideSpeed: time ? slide / time : 0, slideRatio: travel ? slide / travel : 0, plantedTime: time };
}
