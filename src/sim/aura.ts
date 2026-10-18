import type { Game } from './game';
import { BUILDING, HOUSE_LEVELS, PALACE_LEVELS } from './data/buildings';

export const CLUSTER = 4;
export type AuraChannel = 'order' | 'fear' | 'defense' | 'awe';

/**
 * Aura field on 4x4 tile clusters. Order and anarchy share one signed channel.
 * strength(d) = Base * (Range - d + 1) / Range for d <= range (clusters, euclidean). Sources sum.
 */
export class AuraGrid {
  readonly cw: number;
  readonly order: Float32Array;
  readonly fear: Float32Array;
  readonly defense: Float32Array;
  readonly awe: Float32Array;
  dirty = true;

  constructor(size: number) {
    this.cw = Math.ceil(size / CLUSTER);
    const c = this.cw * this.cw;
    this.order = new Float32Array(c);
    this.fear = new Float32Array(c);
    this.defense = new Float32Array(c);
    this.awe = new Float32Array(c);
  }

  at(ch: AuraChannel, x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cw - 1, Math.floor(x / CLUSTER)));
    const cy = Math.max(0, Math.min(this.cw - 1, Math.floor(y / CLUSTER)));
    return this[ch][cy * this.cw + cx];
  }

  recompute(g: Game): void {
    this.order.fill(0);
    this.fear.fill(0);
    this.defense.fill(0);
    this.awe.fill(0);
    const mods = g.auraMods();
    for (const b of g.buildings.values()) {
      if (b.built < 1) continue;
      const def = BUILDING[b.def];
      const cx = (b.x + b.w / 2) / CLUSTER, cy = (b.y + b.h / 2) / CLUSTER;
      let auras: Record<string, [number, number]> = { ...(def.auras as any) };
      if (def.house && b.houseLevel) {
        const hl = HOUSE_LEVELS[b.houseLevel - 1];
        auras = { anarchy: [hl.anarchy[0], hl.anarchy[1]], awe: [hl.awe[0], hl.awe[1]] };
      }
      if (def.id === 'palace') {
        let lv = 0;
        for (let i = 0; i < PALACE_LEVELS.length; i++) if (g.hoard >= PALACE_LEVELS[i].hoard) lv = i;
        const pl = PALACE_LEVELS[lv];
        auras = { order: [pl.order, 3], defense: [pl.defense, 3], awe: [pl.awe, 3] };
      }
      // staffing scales worked buildings' auras a little (empty fort is less scary)
      const staffK = def.guards ? 0.5 + 0.5 * Math.min(1, b.guards.length / def.guards) : 1;
      for (const k in auras) {
        const [base, range] = auras[k];
        let ch: AuraChannel, sign = 1;
        if (k === 'anarchy') (ch = 'order'), (sign = -1);
        else ch = k as AuraChannel;
        const m = k === 'anarchy' ? mods.anarchy : (mods as any)[k] ?? 1;
        this.stamp(ch, cx, cy, base * sign * m * staffK, range);
      }
    }
    this.dirty = false;
  }

  private stamp(ch: AuraChannel, cx: number, cy: number, base: number, range: number): void {
    const arr = this[ch];
    const cw = this.cw;
    const ix = Math.floor(cx), iy = Math.floor(cy);
    for (let y = iy - range; y <= iy + range; y++) {
      if (y < 0 || y >= cw) continue;
      for (let x = ix - range; x <= ix + range; x++) {
        if (x < 0 || x >= cw) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > range + 0.5) continue;
        const dd = Math.max(0, Math.round(d));
        arr[y * cw + x] += (base * (range - dd + 1)) / (range + 1);
      }
    }
  }
}
