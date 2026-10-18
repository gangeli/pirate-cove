import type { Game } from './game';
import { MONTH } from './time';
import { NATIONS, NATION_NAMES, NATION_ADJ, type Nation } from './data/kings';
import { Terrain } from './map';
import { createPerson } from './people';
import { patronOf } from './sea';

export type RelationLevel = 'Hostile' | 'Cold' | 'Neutral' | 'Cordial' | 'Harmonious';
export function relationLevel(r: number): RelationLevel {
  if (r < -50) return 'Hostile';
  if (r < -15) return 'Cold';
  if (r < 15) return 'Neutral';
  if (r < 50) return 'Cordial';
  return 'Harmonious';
}

export interface Invader {
  id: number;
  nat: Nation;
  x: number;
  y: number;
  dir: number;
  hp: number;
  soldiers: number;
  tx: number;
  ty: number;
  state: 'approach' | 'landing' | 'leaving' | 'sunk';
  timer: number;
  fireCd: number;
}

declare module './game' {
  interface Game {
    invaders: Invader[];
    cannonballs: { x: number; y: number; z: number; vx: number; vy: number; vz: number; from: 'fort' | 'ship' | 'enemy'; t: number }[];
  }
}

export function piracyAgainst(g: Game, nat: Nation, amount: number): void {
  const st = g.nations[nat];
  if (patronOf(g) && g.nations[patronOf(g)!].atWarWith.includes(nat) && g.ongoing.has(`marque:${nat}`)) return; // legal privateering
  // their enemies don't mind
  const atWar = NATIONS.filter((n) => n !== nat && g.nations[n].atWarWith.includes(nat));
  for (const n of atWar) g.nations[n].relation = Math.min(100, g.nations[n].relation + amount * 0.15);
  st.relation = Math.max(-100, st.relation - amount);
  // without secrecy, attacks may reveal you
  if (!st.knows && g.rng.chance(g.ongoing.has('walk_plank') ? 0.01 : 0.04)) {
    st.knows = true;
    g.msg('alert', 'Discovered!', `Survivors have told ${NATION_NAMES[nat]} where your island lies.`, 'discovered');
  }
}

export function breakPeace(g: Game, nat: Nation): void {
  const st = g.nations[nat];
  g.ongoing.delete(`peace:${nat}`);
  st.relation = Math.max(-100, st.relation - 40);
  st.peaceBroken = g.time;
  g.msg('bad', 'Peace Broken!', `Your captains attacked ${NATION_ADJ[nat]} ships despite your promise of peace. ${NATION_NAMES[nat]} is furious!`, 'peace_broken', undefined, true);
}

export function monthlyDiplomacy(g: Game): void {
  const pat = patronOf(g);
  for (const n of NATIONS) {
    const st = g.nations[n];
    if (g.ongoing.has(`peace:${n}`)) st.relation = Math.min(100, st.relation + 2.5);
    // slow drift toward neutral
    st.relation += (0 - st.relation) * 0.01;
    st.reserve = Math.min(8, st.reserve + 0.1);
    // regional heat cools
    // invasion state machine
    const inv = st.invasion;
    const protectedBy = pat !== null && !g.ongoing.has('jolly_roger');
    if (inv.stage === 0) {
      if (st.knows && !protectedBy && g.time > MONTH * 6) {
        const p = st.relation < -50 ? 0.12 : st.relation < -15 ? 0.03 : 0;
        if (g.rng.chance(p)) {
          inv.stage = 1;
          inv.timer = 2;
          g.msg('alert', 'Rumours of War', `Word from the taverns: ${NATION_NAMES[n]} is talking about putting an end to your little kingdom.`, 'invasion_rumour', undefined, true);
        }
      }
    } else if (inv.stage === 1 || inv.stage === 2) {
      if (st.relation > -15 || protectedBy) {
        inv.stage = 0;
        g.msg('good', 'Crisis Averted', `${NATION_NAMES[n]} has called off its plans against you.`, 'invasion_cancelled');
        continue;
      }
      if (--inv.timer <= 0) {
        if (inv.stage === 1) {
          inv.stage = 2;
          inv.timer = g.rng.int(1, 2);
          g.msg('alert', 'Fleet Assembling!', `A ${NATION_ADJ[n]} invasion fleet is gathering. Build forts and keep your ships in port!`, 'invasion_fleet', undefined, true);
        } else {
          inv.stage = 3;
          inv.strength = Math.round(3 + Math.max(0, -st.relation) / 18 + g.yearsElapsed * 1.2 + st.reserve * 0.5);
          launchInvasion(g, n, inv.strength);
        }
      }
    }
  }
  for (const r of g.regions) r.heat *= 0.85;
  // European wars come and go
  if (g.rng.chance(0.03)) {
    const a = g.rng.pick(NATIONS), b = g.rng.pick(NATIONS.filter((x) => x !== a));
    if (!g.nations[a].atWarWith.includes(b)) {
      g.nations[a].atWarWith.push(b);
      g.nations[b].atWarWith.push(a);
      g.msg('info', 'War in Europe', `${NATION_NAMES[a]} and ${NATION_NAMES[b]} are at war!`, 'war_declared');
    }
  }
  if (g.rng.chance(0.02)) {
    for (const a of NATIONS) if (g.nations[a].atWarWith.length) {
      const b = g.nations[a].atWarWith[0];
      g.nations[a].atWarWith = g.nations[a].atWarWith.filter((x) => x !== b);
      g.nations[b].atWarWith = g.nations[b].atWarWith.filter((x) => x !== a);
      g.msg('info', 'Peace in Europe', `${NATION_NAMES[a]} and ${NATION_NAMES[b]} have signed a peace treaty.`);
      break;
    }
  }
  // patron emergency funding
  if (pat && g.treasury < 100 && g.rng.chance(0.3)) {
    g.earn(600, 'patron');
    g.msg('good', 'Emergency Funding', `Your patron, ${NATION_NAMES[pat]}, sends 600 gold to keep their colony afloat.`, 'patron_gift');
  }
}

function launchInvasion(g: Game, nat: Nation, strength: number): void {
  g.invaders ??= [];
  const palace = g.findBuilding('palace');
  if (!palace) return;
  const m = g.map, n = m.size;
  // find beach landing near the palace
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = 2; y < n - 2; y++)
    for (let x = 2; x < n - 2; x++) {
      if (m.terrain[m.idx(x, y)] !== Terrain.Beach || m.occupied[m.idx(x, y)]) continue;
      const d = Math.hypot(x - palace.door[0], y - palace.door[1]) + g.rng.range(0, 10);
      if (d < bd) (bd = d), (best = [x, y]);
    }
  if (!best) return;
  const ships = Math.max(1, Math.min(6, Math.round(strength / 5)));
  const ang = Math.atan2(best[1] - n / 2, best[0] - n / 2);
  for (let i = 0; i < ships; i++) {
    const a = ang + (i - ships / 2) * 0.15;
    g.invaders.push({
      id: g.nextId++, nat, x: n / 2 + Math.cos(a) * n * 0.75, y: n / 2 + Math.sin(a) * n * 0.75, dir: a + Math.PI, hp: 1,
      soldiers: Math.ceil(strength / ships), tx: best[0], ty: best[1], state: 'approach', timer: 0, fireCd: 3 + i,
    });
  }
  g.msg('alert', 'INVASION!', `${NATION_NAMES[nat]} is invading with ${ships} ships and ${strength} soldiers! All hands to arms!`, 'invasion', { x: best[0], y: best[1] }, true);
  g.events.push({ type: 'invasion', nat });
}

/** per tick: invaders sail in, forts and docked ships fire, troops land */
export function updateInvasion(g: Game, dt: number): void {
  g.invaders ??= [];
  g.cannonballs ??= [];
  // cannonballs
  for (const c of g.cannonballs) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.vz -= 9.8 * dt * 0.6;
    c.t += dt;
  }
  g.cannonballs = g.cannonballs.filter((c) => c.z > -1 && c.t < 6);
  if (!g.invaders.length) return;
  const m = g.map;
  const forts = [...g.buildings.values()].filter((b) => b.built >= 1 && (b.def === 'fort' || b.def === 'watch_tower' || b.def === 'protective_cannon'));
  for (const v of g.invaders) {
    if (v.state === 'sunk') {
      v.timer += dt;
      continue;
    }
    if (v.state === 'approach') {
      const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      v.dir += Math.max(-dt * 0.5, Math.min(dt * 0.5, ((want - v.dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      const ahead = [v.x + Math.cos(v.dir) * 3, v.y + Math.sin(v.dir) * 3];
      const blocked = m.isLand(Math.floor(ahead[0]), Math.floor(ahead[1])) || (m.inBounds(Math.floor(ahead[0]), Math.floor(ahead[1])) && m.height[m.idx(Math.floor(ahead[0]), Math.floor(ahead[1]))] > -0.5);
      if (blocked || d < 4) {
        v.state = 'landing';
        v.timer = 0;
      } else {
        v.x += Math.cos(v.dir) * dt * 2.6;
        v.y += Math.sin(v.dir) * dt * 2.6;
      }
      // enemy shoots at nearest fort or building
      v.fireCd -= dt;
      if (v.fireCd <= 0 && d < 40) {
        v.fireCd = 4 + g.rng.range(0, 2);
        const tgt = forts[0] ?? g.findBuilding('palace');
        if (tgt) fire(g, v.x, v.y, tgt.x + tgt.w / 2, tgt.y + tgt.h / 2, 'enemy');
      }
    } else if (v.state === 'landing') {
      v.timer += dt;
      if (v.soldiers > 0 && v.timer > 1.5) {
        v.timer = 0;
        const shore = g.pf.nearestWalkable(Math.floor(v.x), Math.floor(v.y), 8);
        if (shore) {
          if (!(g as any).callToArms || g.time - (g as any).callToArms > 60) {
            (g as any).callToArms = g.time;
            // every able pirate ashore grabs a cutlass
            for (const p of g.people.values()) if (p.kind === 'pirate' && p.task.kind !== 'atsea' && p.task.kind !== 'dead' && p.mood !== 'disgruntled') {
              p.task = { kind: 'fight', phase: 1, timer: 120 };
            }
            g.msg('alert', 'To Arms!', 'Enemy marines are coming ashore! Every pirate on the island is grabbing a cutlass.', undefined, { x: shore[0], y: shore[1] });
          }
          const s = createPerson(g, 'soldier', shore[0], shore[1], { nat: v.nat, sex: 'M' });
          s.name = `${NATION_ADJ[v.nat]} Marine`;
          s.hp = 1.4;
        }
        v.soldiers--;
      }
      if (v.soldiers <= 0) v.state = 'leaving';
    } else if (v.state === 'leaving') {
      v.x -= Math.cos(v.dir) * dt * 2;
      v.y -= Math.sin(v.dir) * dt * 2;
    }
  }
  // defenders fire
  for (const f of forts) {
    const fc = ((f as any).fireCd ??= 0) - dt;
    (f as any).fireCd = fc;
    if (fc > 0) continue;
    const range = f.def === 'fort' ? 34 : f.def === 'watch_tower' ? 16 : 22;
    const staffed = f.def === 'fort' ? Math.max(0.4, f.guards.length / 4) : f.def === 'watch_tower' ? Math.max(0.3, f.guards.length / 2) : 1;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const t = g.invaders.find((v) => v.state !== 'sunk' && Math.hypot(v.x - cx, v.y - cy) < range);
    if (!t) continue;
    (f as any).fireCd = (f.def === 'fort' ? 2.2 : 4) / staffed;
    fire(g, cx, cy, t.x, t.y, 'fort');
    if (g.rng.chance(f.def === 'fort' ? 0.45 : 0.25)) {
      t.hp -= f.def === 'fort' ? 0.22 : 0.12;
      if (g.rng.chance(0.3)) t.soldiers = Math.max(0, t.soldiers - 1);
      g.events.push({ type: 'shipHit', x: t.x, y: t.y });
    }
  }
  // docked ships join the fight
  for (const s of g.ships.values()) {
    if (s.status !== 'docked' && s.status !== 'repairing') continue;
    const sc = ((s as any).fireCd ??= 0) - dt;
    (s as any).fireCd = sc;
    if (sc > 0 || s.cannons < 1) continue;
    const t = g.invaders.find((v) => v.state !== 'sunk' && Math.hypot(v.x - s.vx, v.y - s.vy) < 26);
    if (!t) continue;
    const crewAshore = s.crew.length;
    (s as any).fireCd = 3.5 / Math.max(0.3, Math.min(1, crewAshore / 6)) / Math.min(2, 0.5 + s.cannons / 12);
    fire(g, s.vx, s.vy, t.x, t.y, 'ship');
    if (g.rng.chance(0.35)) {
      t.hp -= 0.1 + s.cannons * 0.006;
      g.events.push({ type: 'shipHit', x: t.x, y: t.y });
    }
  }
  for (const v of g.invaders) if (v.state !== 'sunk' && v.hp <= 0) {
    v.state = 'sunk';
    v.timer = 0;
    g.events.push({ type: 'shipSunk', x: v.x, y: v.y });
    g.msg('good', 'Enemy Ship Sunk!', `A ${NATION_ADJ[v.nat]} warship goes down with ${v.soldiers} soldiers still aboard!`, 'enemy_sunk', { x: v.x, y: v.y });
  }
  // end of invasion
  const soldiersAlive = [...g.people.values()].some((p) => p.kind === 'soldier' && p.task.kind !== 'dead');
  const shipsActive = g.invaders.some((v) => v.state === 'approach' || v.state === 'landing');
  g.invaders = g.invaders.filter((v) => !(v.state === 'sunk' && v.timer > 20) && !(v.state === 'leaving' && Math.hypot(v.x - m.size / 2, v.y - m.size / 2) > m.size));
  if (!soldiersAlive && !shipsActive) {
    for (const n of NATIONS) if (g.nations[n].invasion.stage === 3) {
      g.nations[n].invasion.stage = 0;
      g.nations[n].reserve = Math.max(0, g.nations[n].reserve - 4);
      g.nations[n].relation = Math.min(100, g.nations[n].relation + 15);
      g.msg('good', 'Invasion Repelled!', `The ${NATION_ADJ[n]} invasion has been thrown back into the sea! Your pirates will sing of this for years.`, 'invasion_repelled', undefined, true);
      for (const p of g.pirates()) p.needs.drink = Math.max(0, p.needs.drink - 0.2); // they need a drink now
    }
  }
}

function fire(g: Game, x: number, y: number, tx: number, ty: number, from: 'fort' | 'ship' | 'enemy'): void {
  const d = Math.hypot(tx - x, ty - y);
  const t = Math.max(0.8, d / 18);
  g.cannonballs.push({ x, y, z: 2, vx: (tx - x) / t, vy: (ty - y) / t, vz: (9.8 * 0.6 * t) / 2 - 2 / t, from, t: 0 });
  g.events.push({ type: 'cannon', x, y, from });
}
