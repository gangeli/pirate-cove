"""Ships, modelled procedurally in the same kit as the buildings (bevelled timbers, the shared materials, baked AO).

    blender -b -P scripts/blender/bld/ships.py -- [name ...]      (default: every ship in SPECS; FAST=1 quick bakes)

Writes public/assets/ships/ship_<name>.glb (+ _ao.jpg), the far LOD ship_<name>_lod.glb (+ _lod_ao.jpg) and
ship_<name>.json: the sail plan and flag mounts. The sails are not in the GLB: the game builds them from the plan
(src/render/ships.ts) so it can billow, flutter and furl them in the vertex shader.

Model space is the game's: x toward the bow, y up with the waterline at y = 0, z abeam, midships at x = 0, in tiles.
A person is ~0.85 tall, so casks, crates and rails share the buildings' scale.
"""
import sys, os, math, json, time
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
from kit import Kit
from arch import V, cask, crate, rope_coil, lantern

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'public', 'assets', 'ships'))


def ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


class Ship:
    """one hull + rig from a spec; collects the sail plan and flag mounts for the JSON"""

    def __init__(s, k, sp):
        s.k, s.sp = k, sp
        s.L, s.B, s.D = sp['L'], sp['B'], sp['D']
        s.xs, s.xb = -s.L / 2, s.L / 2
        s.yc = sp.get('yc', 0.06)  # the widest level, just above the waterline: tumblehome above, the bilge below
        s.th = 0.06  # bulwark thickness
        s.sails, s.flags = [], []
        q = sp.get('qd')
        s.xq, s.qh = (s.xs + q[0] * s.L, q[1]) if q else (s.xs - 1, 0)
        p = sp.get('poop')
        s.xp, s.ph = (s.xs + p[0] * s.L, p[1]) if p else (s.xs - 1, 0)
        f = sp.get('fc')
        s.xf, s.fh = (s.xs + f[0] * s.L, f[1]) if f else (s.xb + 1, 0)
        s.rtop = max(s.rail(s.xs + 0.01), s.rail(s.xb - 0.01), s.rail(0))

    # ------------------------------------------------------------------ lines
    def t(s, x):
        return (x - s.xs) / s.L

    def plan(s, t, h=0.0):
        """half-breadth at a station; h in 0..1 from the widest level to the top rail (the bow flares as it rises)"""
        tr, mid = s.sp.get('transom', 0.62), s.sp.get('mid', 0.42)
        if t < mid:
            u = (mid - t) / mid
            return s.B * (tr + (1 - tr) * (1 - u * u))
        u = (t - mid) / (1 - mid)
        return s.B * max(0.0, 1 - u ** 2.1) ** (0.62 - 0.3 * h) + 0.015

    def keel(s, t):
        f = s.sp.get('fore', 0.78)
        if t <= f:
            return -s.D
        u = (t - f) / (1 - f)
        return -s.D * math.sqrt(max(0.0, 1 - u * u))

    def sheer(s, x):
        return s.sp['deck'] + s.sp.get('sheer', 0.15) * ((s.t(x) - 0.52) * 2.1) ** 2

    def deck(s, x):
        y = s.sheer(x)
        if x < s.xq:
            y += s.qh
        if x < s.xp:
            y += s.ph
        if x > s.xf:
            y += s.fh
        return y

    def rail(s, x):
        bw = s.sp.get('bw', 0.36)
        r = 0.45
        return (s.sheer(x) + bw + s.qh * ss(s.xq + r, s.xq, x) + s.ph * ss(s.xp + r, s.xp, x) + s.fh * ss(s.xf - r, s.xf, x))

    def hw(s, x, y):
        """outer half-breadth at height y (above the widest level)"""
        t = clamp(s.t(x))
        h = clamp((y - s.yc) / (s.rtop - s.yc))
        return s.plan(t, h) * (1 - s.sp.get('tumble', 0.14) * h * h)

    def slope(s, x, y):
        """d(half-breadth)/dx: to turn things on the side to face out of the hull"""
        e = 0.05
        return (s.hw(x + e, y) - s.hw(x - e, y)) / (2 * e)

    # ------------------------------------------------------------------ shell
    def section(s, x):
        """outer section of the starboard side, rail to keel: [(y, z, bumped)] and the band material of each span"""
        k = s.k
        t = clamp(s.t(x))
        sh = s.sheer(x)
        rail = s.rail(x)
        pts, mats = [], []
        tb = s.sp.get('topband', ('planks', 0.12))
        ys = [(rail, 0), (rail - tb[1], 0)]
        span = [tb[0]]
        for (a, b, m) in s.sp.get('wales', []):  # (offset of bottom, of top from the sheer line, material)
            ya, yb = sh + a, sh + b
            ys += [(yb, 0), (yb, 1), (ya, 1), (ya, 0)]
            span += [s.sp.get('side', 'planks'), m, m, m]
        ys.append((s.yc, 0))
        span.append(s.sp.get('side', 'planks'))
        wb = 0.035
        for (y, bump) in ys:
            pts.append((y, s.hw(x, y) + (wb if bump else 0)))
        # the bilge: a superellipse from the widest level to the keel, finer at the ends, tucked in under the stern
        pm, pe = s.sp.get('pmid', 2.6), s.sp.get('pend', 1.5)
        p = pe + (pm - pe) * math.sin(math.pi * clamp(t * 1.05 - 0.02)) ** 0.5
        kl = s.keel(t)
        W = s.plan(t, 0) * (1 - 0)
        tk = 0.3 + 0.7 * ss(0.0, 0.3, t)
        n = 4 if k.lod else 8
        for j in range(1, n + 1):
            th = (j / n) * math.pi / 2
            zf = math.cos(th) ** (2 / p) if j < n else 0.0
            qf = math.sin(th) ** (2 / p)
            y = s.yc - qf * (s.yc - kl)
            pts.append((y, W * zf * (1 - (1 - tk) * qf)))
            span.append(s.sp.get('bottom', 'planksDark'))
        return pts, span

    def stations(s, n):
        xs = []
        for i in range(n + 1):
            u = i / n
            xs.append(s.xs + s.L * (u if u < 0.6 else 0.6 + (u - 0.6) * (1 - 0.25 * (u - 0.6))))
        xs[-1] = s.xb
        return xs

    def shell(s):
        k = s.k
        xs = s.stations(16 if k.lod else 34)
        secs = [s.section(x) for x in xs]
        spans = secs[0][1]
        npts = len(secs[0][0])
        # group consecutive spans of the same material into one mesh each
        groups = []
        j = 0
        while j < len(spans):
            j1 = j
            while j1 + 1 < len(spans) and spans[j1 + 1] == spans[j]:
                j1 += 1
            groups.append((spans[j], j, j1 + 1))
            j = j1 + 1
        for sz in (1, -1):
            for (mat, j0, j1) in groups:
                verts, faces = [], []
                m = j1 - j0 + 1
                for i, x in enumerate(xs):
                    for jj in range(j0, j1 + 1):
                        y, z = secs[i][0][jj]
                        verts.append(V(x, y, z * sz))
                for i in range(len(xs) - 1):
                    for jj in range(m - 1):
                        a, b, c, d = i * m + jj, i * m + jj + 1, (i + 1) * m + jj + 1, (i + 1) * m + jj
                        faces.append((a, b, c, d) if sz > 0 else (a, d, c, b))
                k.mesh(mat, verts, faces, uvscale=1.1 if 'planks' in mat else 0.6)
        # the transom: a flat stern closing the shell
        pts = secs[0][0]
        ring = [V(xs[0], y, z) for (y, z) in pts] + [V(xs[0], y, -z) for (y, z) in reversed(pts)]
        c = sum(ring, Vector()) / len(ring)
        verts = [c] + ring
        faces = []
        for i in range(len(ring) - 1):
            faces.append((0, i + 2, i + 1))
        k.mesh(s.sp.get('transom_mat', 'planksDark'), verts, faces, uvscale=1.1)
        s._xs = xs

    def interior(s):
        """bulwarks (inner face and rail cap), decks at every level and the bulkheads between them"""
        k, th = s.k, s.th
        e = 0.004
        xs = [x for x in s.stations(16 if k.lod else 34)]
        steps = [x for x in (s.xq, s.xp, s.xf) if s.xs < x < s.xb]
        for x0 in steps:
            xs += [x0 - e, x0 + e]
        xs = sorted(xs)
        xs = [x for x in xs if x < s.xb - 0.05]
        inner = s.sp.get('inner', 'red')
        for sz in (1, -1):
            cap_v, cap_f, in_v, in_f = [], [], [], []
            for i, x in enumerate(xs):
                r = s.rail(x)
                d = s.deck(x) - 0.01
                ro, ri, di = s.hw(x, r), max(0.0, s.hw(x, r) - th), max(0.0, s.hw(x, d) - th)
                cap_v += [V(x, r + 0.035, (ro + 0.02) * sz), V(x, r + 0.035, (ri - 0.02) * sz)]
                in_v += [V(x, r, ri * sz), V(x, d, di * sz)]
            for i in range(len(xs) - 1):
                a, b, c, d = 2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2
                # (winding by side: faces point up / inboard)
                cap_f.append((a, b, c, d) if sz > 0 else (a, d, c, b))
                in_f.append((a, b, c, d) if sz > 0 else (a, d, c, b))
            k.mesh('wood', cap_v, cap_f, uvscale=1.0)
            k.mesh(inner, in_v, in_f, uvscale=0.8)
            # rail cap edges (so the cap reads as a timber from outside)
            ev = [V(x, s.rail(x) + (0.035 if j else 0.0), (s.hw(x, s.rail(x)) + 0.02) * sz) for x in xs for j in (0, 1)]
            ef = [((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) if sz > 0 else (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2)) for i in range(len(xs) - 1)]
            k.mesh('wood', ev, ef, uvscale=1.0)
        # decks: one strip per level between its bulkheads
        bounds = sorted(set([s.xs] + steps + [s.xb]))
        for (xa, xb) in zip(bounds, bounds[1:]):
            dx = [xa + 0.0001] + [x for x in xs if xa + 0.9 * e < x < xb - 0.9 * e] + [min(xb, s.xb - 0.05) - 0.0001]
            dv, df = [], []
            for x in dx:
                y = s.deck(min(max(x, xa + 0.002), xb - 0.002))
                w = max(0.0, s.hw(x, y) - th + 0.01)
                dv += [V(x, y, -w), V(x, y, w)]
            for i in range(len(dx) - 1):
                df.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
            k.mesh('planks', dv, df, uvscale=1.4)
        # bulkheads: the fronts of the quarterdeck and poop, the back of the forecastle
        for (x0, aft) in ((s.xq, True), (s.xp, True), (s.xf, False)):
            if not (s.xs < x0 < s.xb):
                continue
            lo, hi = s.deck(x0 + (0.01 if aft else -0.01)), s.deck(x0 + (-0.01 if aft else 0.01))
            w = s.hw(x0, (lo + hi) / 2) - th
            k.box('planksDark', 0.05, hi - lo + 0.01, 2 * w, x0 + (0.025 if aft else -0.025), lo - 0.005, 0, uvscale=1.2)
            # a rail along the edge of the raised deck
            k.box('wood', 0.07, 0.05, 2 * w, x0 + (0.035 if aft else -0.035), hi + 0.32, 0)
            for zz in [w * (-0.9 + 1.8 * i / 8) for i in range(9)] if not k.lod else []:
                k.cyl('wood', 0.018, 0.015, 0.32, x0 + (0.035 if aft else -0.035), hi, zz, seg=6)
            if aft:
                s.door(x0, lo, w)
        # the taffrail: inside face of the stern
        r0, d0 = s.rail(s.xs), s.deck(s.xs + 0.01)
        w0 = s.hw(s.xs, r0) - th
        k.box(inner, th, r0 - d0, 2 * w0, s.xs + th / 2 + 0.005, d0, 0)

    def door(s, x0, y0, w):
        """a door or two in a bulkhead, opening forward"""
        k = s.k
        for zz in ((-w * 0.45, w * 0.45) if w > 1.2 else (0.0,)):
            k.push(x0 + 0.055, y0, zz, ry=math.pi / 2)
            h = min(0.72, s.qh + s.ph - 0.06) if s.qh > 0.5 else 0
            if h > 0.4:
                k.box('darkwood', 0.46, h + 0.05, 0.02, 0, 0, 0)
                k.box('planksDark', 0.38, h - 0.02, 0.02, 0, 0, 0.012, uvscale=1.4, grain=1)
                if not k.lod:
                    k.cyl('brass', 0.015, 0.015, 0.02, 0.13, h * 0.5, 0.025, seg=6, rx=math.pi / 2)
            k.pop()

    def keelson(s):
        """keel, stem, sternpost and rudder"""
        k = s.k
        pts = []
        n = 10 if k.lod else 22
        for i in range(n + 1):
            t = i / n
            x = s.xs + t * s.L
            pts.append(V(x, s.keel(t) - 0.04, 0))
        for a, b in zip(pts, pts[1:]):
            k.beam('darkwood', a, b, 0.09, 0.12)
        # stem rising from the forefoot to above the rail, curving forward
        top = s.rail(s.xb) + 0.25
        k.beam('darkwood', pts[-1], V(s.xb + 0.04, 0.0, 0), 0.1, 0.12)
        k.beam('darkwood', V(s.xb + 0.04, 0.0, 0), V(s.xb + 0.12, top, 0), 0.1, 0.12)
        # sternpost and rudder
        r = s.rail(s.xs)
        k.beam('darkwood', V(s.xs - 0.02, -s.D - 0.04, 0), V(s.xs - 0.02, s.deck(s.xs), 0), 0.1, 0.1)
        k.push(s.xs - 0.09, -s.D, 0)
        k.box('planksDark', 0.16, s.D + s.deck(s.xs) * 0.6, 0.07, -0.02, 0, 0, uvscale=1.2, grain=1)
        if not k.lod:
            for yy in (0.2, 0.55, 0.9):
                k.box('iron', 0.2, 0.03, 0.08, 0.02, yy * s.D, 0)
        k.pop()
        s.rudder_top = s.deck(s.xs) * 0.6 - 0.0

    # ------------------------------------------------------------------ hull dressing
    def on_side(s, x, y, sz, out=0.0):
        """push a frame on the hull side at (x, y): local z out of the hull, x along it, y up"""
        th = math.atan2(-s.slope(x, y), 1)
        z = (s.hw(x, y) + out) * sz
        return s.k.push(x, y, z, ry=th if sz > 0 else math.pi + th)

    def gunports(s, y, xs, size=0.2, lid='red', gun=True):
        k = s.k
        for x in xs:
            for sz in (1, -1):
                s.on_side(x, y, sz, 0.01)
                k.cbox('black', size, size * 0.9, 0.03, 0, 0, 0)
                if not k.lod:
                    k.cbox('darkwood', size + 0.05, 0.03, 0.035, 0, -size * 0.45 - 0.01, 0.005)
                    k.cbox('darkwood', size + 0.05, 0.03, 0.035, 0, size * 0.45 + 0.01, 0.005)
                k.push(0, size * 0.45, 0.02, rx=-1.05)
                k.box(lid, size + 0.02, size * 0.95, 0.025, 0, 0, 0)
                k.pop()
                if gun:
                    k.cyl('iron', 0.045, 0.035, 0.32, 0, -0.01, -0.08, seg=8 if not k.lod else 5, rx=math.pi / 2)
                k.pop()

    def deck_guns(s, xs):
        """carriage guns on deck, run out through ports in the bulwark"""
        k = s.k
        for x in xs:
            y = s.deck(x)
            for sz in (1, -1):
                w = s.hw(x, y + 0.2) - s.th
                s.on_side(x, y + 0.2, sz, 0.012)
                k.cbox('black', 0.17, 0.15, 0.02, 0, 0, 0)
                k.pop()
                s.on_side(x, y + 0.2, sz, -s.th - 0.012)
                k.cbox('black', 0.17, 0.15, 0.02, 0, 0, 0)
                k.pop()
                k.push(x, y, sz * (w - 0.2), ry=0 if sz > 0 else math.pi)
                if not k.lod:
                    k.box('darkwood', 0.2, 0.1, 0.3, 0, 0, 0)
                    for (wx, wz) in ((-0.09, -0.1), (0.09, -0.1), (-0.09, 0.1), (0.09, 0.1)):
                        k.cyl('darkwood', 0.04, 0.04, 0.025, wx + (0.0125 if wx > 0 else -0.0125), 0.04, wz, seg=8, rz=math.pi / 2)
                k.cyl('iron', 0.05, 0.035, 0.48, 0, 0.17, -0.12, seg=8 if not k.lod else 5, rx=math.pi / 2)
                k.pop()

    def channels(s, x0, n, sz):
        """a channel (ledge) outside the rail to spread the shrouds; returns their chain points"""
        k = s.k
        y = s.rail(x0) - 0.14
        pts = []
        sp = 0.2
        xa = x0 + 0.1
        for i in range(n):
            x = xa - i * sp
            pts.append(V(x, y + 0.02, (s.hw(x, y) + 0.13) * sz))
        s.on_side(x0 - (n - 1) * sp / 2 + 0.1, y, sz, 0.06)
        k.cbox('darkwood', n * sp + 0.15, 0.04, 0.13, 0, 0, 0)
        k.pop()
        if not k.lod:
            for p in pts:
                k.cyl('darkwood', 0.035, 0.035, 0.03, p.x, p.y - 0.005, p.z, seg=8, rx=math.pi / 2)  # deadeyes
                k.beam('iron', p - V(0, 0.02, 0), V(p.x, p.y - 0.3, p.z * 0.97), 0.012)
        return pts

    def stern(s, windows=0, rows=1, gold=False, lanterns=1):
        k = s.k
        x = s.xs - 0.01
        r = s.rail(s.xs)
        w = s.hw(s.xs, r)
        k.push(x, 0, 0, ry=-math.pi / 2)  # local z out of the stern (-x), local x toward starboard... mirrored ok
        if windows:
            for row in range(rows):
                yy = r - 0.42 - row * 0.5
                k.box('darkwood', 2 * w * 0.86, 0.05, 0.05, 0, yy - 0.2, 0.02)  # sill moulding
                k.box('darkwood', 2 * w * 0.86, 0.05, 0.05, 0, yy + 0.22, 0.02)
                for i in range(windows):
                    xx = (i - (windows - 1) / 2) * (2 * w * 0.78 / windows)
                    k.cbox('window', 0.18, 0.26, 0.02, xx, yy + 0.01, 0.01)
                    if not k.lod:
                        k.cbox('darkwood', 0.03, 0.3, 0.04, xx - 0.105, yy + 0.01, 0.02)
                        k.cbox('darkwood', 0.03, 0.3, 0.04, xx + 0.105, yy + 0.01, 0.02)
                        k.cbox('darkwood', 0.2, 0.02, 0.03, xx, yy + 0.01, 0.02)
            if gold:
                k.box('gold', 2 * w * 0.7, 0.035, 0.03, 0, r - 0.08, 0.03)
                if not k.lod:
                    for i in range(5):
                        xx = (i - 2) * w * 0.32
                        k.cbox('gold', 0.06, 0.06, 0.03, xx, r - 0.15, 0.04)
        # name board
        k.cbox('darkwood', min(1.4, w * 1.2), 0.12, 0.03, 0, r - 0.17 - (rows * 0.5 + 0.1 if windows else 0), 0.02)
        k.pop()
        # stern lanterns on the taffrail
        for i in range(lanterns):
            zz = 0 if lanterns == 1 else (i - (lanterns - 1) / 2) * w * 1.1
            k.cyl('iron', 0.015, 0.015, 0.3, s.xs + 0.05, r + 0.03, zz, seg=5)
            k.cyl('iron', 0.08, 0.03, 0.06, s.xs + 0.05, r + 0.55, zz, seg=8)
            k.cbox('window', 0.12, 0.2, 0.12, s.xs + 0.05, r + 0.44, zz)
            k.cyl('iron', 0.08, 0.08, 0.02, s.xs + 0.05, r + 0.33, zz, seg=8)

    def hatch(s, x, w, d):
        k = s.k
        y = s.deck(x)
        k.box('darkwood', d, 0.09, w, x, y, 0)
        k.box('black', d - 0.06, 0.092, w - 0.06, x, y, 0)
        if not k.lod:
            n = max(2, round(w / 0.07))
            for i in range(n):
                k.box('wood', d - 0.05, 0.02, 0.025, x, y + 0.075, -w / 2 + 0.04 + i * (w - 0.08) / (n - 1))
            for i in range(max(2, round(d / 0.12))):
                k.box('wood', 0.025, 0.02, w - 0.05, x - d / 2 + 0.05 + i * (d - 0.1) / max(1, round(d / 0.12) - 1), y + 0.07, 0)

    def wheel(s, x):
        k = s.k
        y = s.deck(x)
        k.box('darkwood', 0.12, 0.42, 0.06, x - 0.06, y, 0)
        k.push(x, y + 0.5, 0, rz=0)
        if not k.lod:
            k.torus('wood', 0.2, 0.018, 0, 0, 0, rx=math.pi / 2, seg=14, rseg=4)
            for i in range(8):
                a = i / 8 * math.tau
                k.beam('wood', V(0.02, 0, 0), V(0.02, math.sin(a) * 0.27, math.cos(a) * 0.27), 0.02, round_=True, seg=4)
        else:
            k.cyl('wood', 0.2, 0.2, 0.03, 0, 0, 0, seg=8, rz=math.pi / 2)
        k.pop()

    def tiller(s):
        k = s.k
        y = s.deck(s.xs + 0.3)
        k.beam('wood', V(s.xs + 0.05, y + 0.25, 0), V(s.xs + 1.0, y + 0.42, 0), 0.05, round_=True)

    def capstan(s, x):
        k = s.k
        y = s.deck(x)
        k.cyl('darkwood', 0.13, 0.11, 0.32, x, y, 0, seg=10)
        k.cyl('wood', 0.17, 0.17, 0.06, x, y + 0.32, 0, seg=10)
        if not k.lod:
            for i in range(4):
                a = i / 4 * math.pi
                k.beam('wood', V(x - math.cos(a) * 0.45, y + 0.36, -math.sin(a) * 0.45), V(x + math.cos(a) * 0.45, y + 0.36, math.sin(a) * 0.45), 0.03)

    def boat(s, x, L, B):
        """the ship's boat, upturned-free, sitting in chocks on deck"""
        k = s.k
        y0 = s.deck(x) + 0.08
        n, m = (6, 3) if k.lod else (12, 5)
        ov, iv = [], []
        for i in range(n + 1):
            u = i / n
            xx = x - L / 2 + u * L
            wb = B / 2 * math.sin(math.pi * (0.12 + 0.88 * u)) ** 0.7
            for j in range(m + 1):
                a = j / m * math.pi
                z = math.cos(a) * wb
                yy = y0 + 0.25 - math.sin(a) * 0.25
                ov.append(V(xx, yy, z))
                iv.append(V(xx, yy + 0.025, z * 0.88))
        f = []
        for i in range(n):
            for j in range(m):
                f.append((i * (m + 1) + j, (i + 1) * (m + 1) + j, (i + 1) * (m + 1) + j + 1, i * (m + 1) + j + 1))
        k.mesh('planks', ov, f, uvscale=1.4)
        k.mesh('planksDark', iv, [tuple(reversed(q)) for q in f], uvscale=1.4)
        # gunwale
        for sz in (1, -1):
            pts = [V(x - L / 2 + i / n * L, y0 + 0.25, sz * B / 2 * math.sin(math.pi * (0.12 + 0.88 * i / n)) ** 0.7) for i in range(n + 1)]
            for a, b in zip(pts, pts[1:]):
                k.beam('wood', a, b, 0.035)
        for xx in (-L * 0.3, L * 0.3):
            k.box('darkwood', 0.08, 0.1, B * 0.7, x + xx, y0 - 0.08, 0)
        if not k.lod:
            for xx in (-L * 0.15, L * 0.2):
                k.box('wood', 0.08, 0.025, B * 0.8, x + xx, y0 + 0.17, 0)
            k.beam('wood', V(x - L * 0.3, y0 + 0.2, 0.1), V(x + L * 0.4, y0 + 0.2, 0.15), 0.03, round_=True, seg=5)

    def clutter(s, items):
        k = s.k
        for (kind, x, z, *rest) in items:
            y = s.deck(x)
            k.push(0, y, 0)
            if kind == 'cask':
                cask(k, x, z, rest[0] if rest else 0.8)
            elif kind == 'crate':
                crate(k, x, 0, z, rest[0] if rest else 0.26, 0.3)
            elif kind == 'coil':
                rope_coil(k, x, z, 0.11)
            elif kind == 'lantern':
                lantern(k, x, 0.6, z)
            k.pop()

    # ------------------------------------------------------------------ rig
    def mast(s, x, tops, r=0.09, rake=0.0):
        """lower mast, topmast, topgallant: tops = heights of each head above the waterline. Returns the heads."""
        k = s.k
        y0 = s.deck(x) - 0.05
        heads = []
        prev = y0
        rr = r
        dx = math.tan(rake)
        P = lambda y: V(x - (y - y0) * dx, y, 0)
        for i, top in enumerate(tops):
            lo = prev if i == 0 else prev - 0.35
            k.cyl('wood', rr, rr * 0.78, top - lo, P(lo).x, lo, 0, seg=10 if not k.lod else 6, rz=rake)
            if i < len(tops) - 1:
                # the top (platform) and cap at the doubling
                pw = 0.55 + r * 2 if i == 0 else 0.3
                k.cbox('darkwood', pw * 0.9, 0.05, pw * 1.3 if i == 0 else pw, P(top).x - 0.08, top - 0.12, 0)
                k.cbox('darkwood', 0.24 * (r / 0.09), 0.08, 0.14 * (r / 0.09), P(top).x + 0.04, top - 0.02, 0)
                if i == 0 and not k.lod:
                    for sz in (-1, 1):
                        k.cyl('wood', 0.016, 0.016, 0.16, P(top).x - 0.08, top - 0.1, sz * pw * 0.62, seg=5)
                    k.box('wood', 0.03, 0.03, pw * 1.3, P(top).x - 0.08 - pw * 0.45, top + 0.06, 0)
            else:
                k.cyl('darkwood', rr * 0.95, rr * 0.95, 0.06, P(top).x, top, 0, seg=8)  # truck
            heads.append(P(top))
            prev = top
            rr *= 0.7
        return heads, P

    def yard(s, x, y, half, r=0.045):
        k = s.k
        k.beam('wood', V(x + 0.09, y, -half), V(x + 0.09, y, half), r * 2, round_=True, seg=8 if not k.lod else 5)
        if not k.lod:
            for sz in (-1, 1):
                k.cyl('darkwood', r * 1.25, r * 1.25, 0.05, x + 0.09, y, sz * half * 0.97, seg=6, rx=math.pi / 2)

    def square(s, x, levels, foot, P):
        """square sails between yards: levels = [(y, half), ...] top to bottom; the lowest sail's foot at `foot`"""
        for i, (y, half) in enumerate(levels):
            s.yard(P(y).x, y, half)
            if i + 1 < len(levels):
                y2, h2 = levels[i + 1]
                fy, fh = y2 + 0.08, h2 * 0.94
            else:
                fy, fh = foot, half * 1.05
            hx = P(y).x + 0.16
            fx = P(fy).x + 0.16
            s.sails.append({'kind': 'sq', 'c': [[hx, y - 0.04, -half * 0.94], [hx, y - 0.04, half * 0.94], [fx, fy, fh], [fx, fy, -fh]]})

    def gaff(s, x, yb, yg, boom, gl, ang, P, sail=True):
        """a gaff sail: boom at yb running aft `boom`, gaff at yg, `gl` long, peaked up by `ang`"""
        k = s.k
        mx_b, mx_g = P(yb).x - 0.1, P(yg).x - 0.1
        pe = V(mx_g - gl * math.cos(ang), yg + gl * math.sin(ang), 0)
        be = V(mx_b - boom, yb + 0.12, 0)
        k.beam('wood', V(mx_b, yb, 0), be, 0.08, round_=True, seg=8 if not k.lod else 5)
        k.beam('wood', V(mx_g, yg, 0), pe, 0.065, round_=True, seg=8 if not k.lod else 5)
        if not k.lod:
            k.beam('rope', pe, V(P(yg + 1.0).x, yg + 1.0, 0), 0.012, round_=True, seg=4)  # peak halyard
            k.beam('rope', be, V(be.x + 0.05, s.deck(be.x) + 0.35 if be.x > s.xs else s.rail(s.xs) + 0.04, 0), 0.012, round_=True, seg=4)  # sheet
        if sail:
            s.sails.append({'kind': 'fa', 'c': [[mx_g - 0.03, yg - 0.05, 0], [pe.x + 0.05, pe.y - 0.06, 0], [be.x + 0.08, be.y + 0.06, 0], [mx_b - 0.03, yb + 0.08, 0]]})

    def shrouds(s, x, head, P, n=3, width=0.13):
        """lower shrouds from the masthead to chains on both sides, with ratlines; returns nothing"""
        k = s.k
        for sz in (-1, 1):
            chains = s.channels(x, n, sz)
            top = V(head.x - 0.05, head.y - 0.18, sz * width)
            for c in chains:
                k.beam('rope', c, top, 0.018, round_=True, seg=4 if not k.lod else 3)
            if not k.lod:
                a, b = chains[0], chains[-1]
                y = a.y + 0.28
                while y < top.y - 0.35:
                    f = (y - a.y) / (top.y - a.y)
                    pa, pb = a.lerp(top, f), b.lerp(top, f)
                    k.beam('rope', pa, pb, 0.01, round_=True, seg=3)
                    y += 0.26

    def topshrouds(s, top_y, head, P, pw):
        k = s.k
        if k.lod:
            return
        for sz in (-1, 1):
            for dx in (0.06, -0.12):
                k.beam('rope', V(P(top_y).x + dx - 0.08, top_y - 0.1, sz * pw * 0.6), V(head.x, head.y - 0.12, sz * 0.05), 0.013, round_=True, seg=3)

    def backstays(s, head, x, sz_list=(-1, 1)):
        k = s.k
        for sz in sz_list:
            xx = x - 0.9
            k.beam('rope', V(head.x, head.y - 0.1, 0), V(xx, s.rail(xx) - 0.05, sz * (s.hw(xx, s.rail(xx)) + 0.1)), 0.016, round_=True, seg=4 if not k.lod else 3)

    def stay(s, a, b, w=0.02):
        s.k.beam('rope', a, b, w, round_=True, seg=4 if not s.k.lod else 3)

    def bowsprit(s, length, ang, boom=0.0):
        """bowsprit (and jib-boom) from inboard of the stem; returns a point function along it"""
        k = s.k
        y0 = s.rail(s.xb - 0.5) - 0.1
        a = V(s.xb - 0.7, y0, 0)
        d = V(math.cos(ang), math.sin(ang), 0)
        b = a + d * length
        k.beam('wood', a, b, 0.14, round_=True, seg=10 if not k.lod else 6)
        k.cyl('darkwood', 0.085, 0.085, 0.06, b.x - 0.03, b.y - 0.03, 0, seg=8, rz=-math.pi / 2 + ang)
        end = b
        if boom:
            c = b + d * boom
            k.beam('wood', b - d * 0.4, c, 0.07, round_=True, seg=8 if not k.lod else 5)
            end = c
        # bobstay down to the stem
        s.stay(end - d * 0.05, V(s.xb + 0.08, 0.15, 0), 0.02)
        s.sprit = lambda u: a + d * (u * ((end - a).length))
        s.sprit_end = end
        return s.sprit

    def jib(s, head, tack, clew_back=0.9, clew_drop=0.0):
        """a triangular headsail on the stay from head to tack; the clew lies aft of the tack"""
        d = (head - tack)
        cl = tack + V(-clew_back, 0.25 + clew_drop, 0) + d * 0.08
        s.sails.append({'kind': 'jib', 'c': [list(head - d.normalized() * 0.12), list(head - d.normalized() * 0.12), list(cl), list(tack + d.normalized() * 0.1)]})

    def flag(s, p, kind='flag'):
        s.flags.append({'p': [round(p.x, 3), round(p.y, 3), round(p.z, 3)], 'kind': kind})


# ============================================================================================ the ships

def dress(sh, x_guns=(), x_ports=(), port_y=None, hatches=(), clutter=(), boat=None, wheel=None, capstan=None):
    if x_ports:
        sh.gunports(port_y, x_ports)
    if x_guns:
        sh.deck_guns(x_guns)
    for (x, w, d) in hatches:
        sh.hatch(x, w, d)
    if boat:
        sh.boat(*boat)
    if wheel is not None:
        sh.wheel(wheel)
    else:
        sh.tiller()
    if capstan is not None:
        sh.capstan(capstan)
    sh.clutter(clutter)


def sloop(k):
    """a Bermuda-style pirate sloop: one tall raked mast with a gaff main, square topsail and two headsails"""
    sh = Ship(k, dict(L=6.9, B=1.22, D=0.7, deck=0.5, sheer=0.16, bw=0.34, qd=(0.18, 0.22), transom=0.6,
                      topband=('red', 0.11), wales=[(-0.06, 0.04, 'darkwood')], inner='red'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=2, lanterns=1)
    mx = sh.xs + 0.6 * sh.L
    (h1, h2), P = sh.mast(mx, [5.0, 7.0], r=0.1, rake=0.05)
    sh.shrouds(mx, h1, P, n=3)
    sh.topshrouds(h1.y, h2, P, 0.66)
    sh.backstays(h2, mx - 0.6)
    sh.gaff(mx, sh.deck(mx) + 1.0, 4.5, 4.7, 3.1, 0.5, P)
    # square topsail set flying above the gaff
    sh.yard(P(h1.y + 0.02).x, h1.y + 0.02, 1.75)
    sh.yard(P(h2.y - 0.3).x, h2.y - 0.3, 1.15)
    sh.sails.append({'kind': 'sq', 'c': [[P(h2.y - 0.3).x + 0.16, h2.y - 0.34, -1.08], [P(h2.y - 0.3).x + 0.16, h2.y - 0.34, 1.08], [P(h1.y).x + 0.16, h1.y + 0.1, 1.64], [P(h1.y).x + 0.16, h1.y + 0.1, -1.64]]})
    spr = sh.bowsprit(2.5, 0.2)
    sh.stay(V(h1.x, h1.y - 0.2, 0), spr(0.45))
    sh.stay(V(h2.x, h2.y - 0.4, 0), spr(0.98))
    sh.jib(V(h1.x + 0.05, h1.y - 0.35, 0), spr(0.45), 1.3)
    sh.jib(V(h2.x + 0.05, h2.y - 0.6, 0), spr(0.97), 1.1, 0.3)
    sh.flag(V(h2.x, h2.y + 0.04, 0))
    dress(sh, x_guns=[-1.6, -0.6, 0.5, 1.5], hatches=[(0.0, 0.6, 0.5), (1.9, 0.45, 0.4)],
          clutter=[('cask', -2.25, -0.55), ('cask', -2.3, -0.22, 0.75), ('coil', 2.3, 0.3), ('crate', -0.95, 0.35), ('coil', -1.2, -0.4)])
    return sh, {'ao': 2048}


def schooner(k):
    """a two-masted schooner: gaff fore and main, a fore topsail, two headsails; low, fast and sharp"""
    sh = Ship(k, dict(L=5.8, B=0.98, D=0.6, deck=0.44, sheer=0.15, bw=0.3, transom=0.55, tumble=0.1,
                      topband=('plasterYellow', 0.08), wales=[(-0.06, 0.03, 'darkwood')], inner='planks', side='planksDark'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=0, lanterns=1)
    fx, mx = sh.xs + 0.66 * sh.L, sh.xs + 0.36 * sh.L
    (f1, f2), Pf = sh.mast(fx, [4.0, 5.6], r=0.08, rake=0.1)
    (m1, m2), Pm = sh.mast(mx, [4.4, 6.0], r=0.085, rake=0.12)
    for (x, h1, h2, P) in ((fx, f1, f2, Pf), (mx, m1, m2, Pm)):
        sh.shrouds(x, h1, P, n=2, width=0.1)
        sh.topshrouds(h1.y, h2, P, 0.5)
    sh.backstays(m2, mx - 0.5)
    sh.gaff(fx, sh.deck(fx) + 0.75, 3.7, 3.7, 2.0, 0.45, Pf)
    sh.gaff(mx, sh.deck(mx) + 0.8, 3.9, 4.0, 2.2, 0.42, Pm)
    sh.yard(Pf(f1.y + 0.05).x, f1.y + 0.05, 1.2)
    sh.yard(Pf(f2.y - 0.25).x, f2.y - 0.25, 0.8)
    sh.sails.append({'kind': 'sq', 'c': [[Pf(f2.y).x + 0.14, f2.y - 0.29, -0.76], [Pf(f2.y).x + 0.14, f2.y - 0.29, 0.76], [Pf(f1.y).x + 0.14, f1.y + 0.12, 1.12], [Pf(f1.y).x + 0.14, f1.y + 0.12, -1.12]]})
    sh.stay(V(m1.x, m1.y - 0.2, 0), V(f1.x, f1.y - 0.25, 0), 0.016)
    spr = sh.bowsprit(2.0, 0.16)
    sh.stay(V(f1.x, f1.y - 0.2, 0), spr(0.45))
    sh.stay(V(f2.x, f2.y - 0.3, 0), spr(0.97))
    sh.jib(V(f1.x + 0.05, f1.y - 0.35, 0), spr(0.45), 1.05)
    sh.jib(V(f2.x + 0.05, f2.y - 0.5, 0), spr(0.96), 0.9, 0.25)
    sh.flag(V(m2.x, m2.y + 0.04, 0))
    sh.flag(V(f2.x, f2.y + 0.04, 0), 'pennant')
    dress(sh, x_guns=[-1.3, -0.2, 1.0], hatches=[(0.35, 0.5, 0.45)],
          clutter=[('cask', -2.0, -0.4, 0.75), ('coil', 1.7, -0.25), ('crate', -0.7, 0.3, 0.24), ('coil', -1.8, 0.32)])
    return sh, {'ao': 2048}


def snow(k):
    """a snow: a small two-masted square-rigger, with a trysail on a mast stepped just abaft the main"""
    sh = Ship(k, dict(L=5.5, B=1.06, D=0.62, deck=0.46, sheer=0.17, bw=0.32, qd=(0.2, 0.2), transom=0.62,
                      topband=('planksDark', 0.1), wales=[(-0.07, 0.03, 'black')], inner='red'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=2, lanterns=1)
    fx, mx = sh.xs + 0.68 * sh.L, sh.xs + 0.4 * sh.L
    (f1, f2), Pf = sh.mast(fx, [3.6, 5.3], r=0.085)
    (m1, m2), Pm = sh.mast(mx, [3.9, 5.7], r=0.09)
    for (x, h1, h2, P, half) in ((fx, f1, f2, Pf, 1.45), (mx, m1, m2, Pm, 1.55)):
        sh.shrouds(x, h1, P, n=3, width=0.11)
        sh.topshrouds(h1.y, h2, P, 0.6)
        sh.square(x, [(h2.y - 0.3, half * 0.66), (h1.y - 0.25, half)], sh.deck(x) + 1.15, P)
    # the snow mast and trysail
    k.cyl('wood', 0.035, 0.03, m1.y - 0.3 - sh.deck(mx - 0.25), mx - 0.25, sh.deck(mx - 0.25), 0, seg=6)
    sh.gaff(mx - 0.22, sh.deck(mx) + 0.85, 3.3, 3.25, 1.4, 0.35, lambda y: V(mx - 0.12, y, 0))
    sh.backstays(m2, mx - 0.5)
    sh.stay(V(m1.x, m1.y - 0.2, 0), V(fx + 0.1, sh.deck(fx) + 0.6, 0), 0.018)
    sh.stay(V(m2.x, m2.y - 0.25, 0), V(f1.x, f1.y - 0.1, 0), 0.014)
    spr = sh.bowsprit(1.7, 0.24)
    sh.stay(V(f1.x, f1.y - 0.2, 0), spr(0.5))
    sh.stay(V(f2.x, f2.y - 0.3, 0), spr(0.97))
    sh.jib(V(f2.x + 0.05, f2.y - 0.5, 0), spr(0.96), 1.0, 0.4)
    sh.flag(V(m2.x, m2.y + 0.04, 0))
    sh.flag(V(f2.x, f2.y + 0.04, 0), 'pennant')
    dress(sh, x_guns=[-1.0, 0.2, 1.2], hatches=[(-0.3, 0.5, 0.5)],
          clutter=[('cask', -1.95, 0.45, 0.75), ('coil', 1.65, 0.25), ('crate', 0.7, -0.3, 0.24)])
    return sh, {'ao': 2048}


def brigantine(k):
    """a brigantine: square-rigged foremast, gaff main with a main topsail, raised quarterdeck and forecastle"""
    sh = Ship(k, dict(L=7.7, B=1.32, D=0.78, deck=0.56, sheer=0.15, bw=0.36, qd=(0.24, 0.32), fc=(0.86, 0.24), transom=0.62,
                      topband=('planksDark', 0.1), wales=[(-0.12, -0.02, 'black'), (0.12, 0.2, 'black')], inner='red'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=3, lanterns=1)
    fx, mx = sh.xs + 0.66 * sh.L, sh.xs + 0.4 * sh.L
    (f1, f2, f3), Pf = sh.mast(fx, [4.4, 6.5, 7.9], r=0.11)
    (m1, m2), Pm = sh.mast(mx, [4.8, 7.6], r=0.11, rake=0.04)
    sh.shrouds(fx, f1, Pf, n=3)
    sh.topshrouds(f1.y, f2, Pf, 0.75)
    sh.shrouds(mx, m1, Pm, n=3)
    sh.topshrouds(m1.y, m2, Pm, 0.75)
    sh.square(fx, [(f3.y - 0.2, 1.0), (f2.y - 0.3, 1.45), (f1.y - 0.25, 2.05)], sh.deck(fx) + 1.25, Pf)
    sh.gaff(mx, sh.deck(mx) + 1.05, 4.3, 4.45, 2.6, 0.42, Pm)
    sh.yard(Pm(m2.y - 0.35).x, m2.y - 0.35, 1.05)
    sh.yard(Pm(m1.y + 0.03).x, m1.y + 0.03, 1.5)
    sh.sails.append({'kind': 'sq', 'c': [[Pm(m2.y).x + 0.16, m2.y - 0.39, -0.99], [Pm(m2.y).x + 0.16, m2.y - 0.39, 0.99], [Pm(m1.y).x + 0.16, m1.y + 0.11, 1.42], [Pm(m1.y).x + 0.16, m1.y + 0.11, -1.42]]})
    sh.backstays(m2, mx - 0.6)
    sh.backstays(f3, fx - 0.3)
    sh.stay(V(m1.x, m1.y - 0.2, 0), V(fx + 0.1, sh.deck(fx) + 0.6, 0), 0.02)
    sh.stay(V(m2.x, m2.y - 0.25, 0), V(f1.x, f1.y - 0.1, 0), 0.015)
    spr = sh.bowsprit(2.0, 0.22, boom=1.0)
    sh.stay(V(f1.x, f1.y - 0.2, 0), spr(0.35))
    sh.stay(V(f2.x, f2.y - 0.3, 0), spr(0.7))
    sh.stay(V(f3.x, f3.y - 0.15, 0), spr(0.99), 0.014)
    sh.jib(V(f1.x + 0.06, f1.y - 0.4, 0), spr(0.35), 1.3)
    sh.jib(V(f2.x + 0.06, f2.y - 0.55, 0), spr(0.7), 1.2, 0.3)
    sh.jib(V(f3.x + 0.05, f3.y - 0.4, 0), spr(0.98), 1.0, 0.75)
    sh.flag(V(m2.x, m2.y + 0.04, 0))
    sh.flag(V(f3.x, f3.y + 0.04, 0), 'pennant')
    dress(sh, x_guns=[-1.4, -0.4, 0.6, 1.6], hatches=[(-0.9, 0.6, 0.55), (1.1, 0.55, 0.5)], wheel=sh.xs + 0.75, capstan=0.15,
          clutter=[('cask', -2.85, 0.5, 0.8), ('cask', -2.85, -0.45, 0.8), ('coil', 2.75, -0.3), ('crate', 0.65, 0.25, 0.26), ('crate', 0.5, -0.25, 0.22), ('coil', -1.5, 0.45)])
    return sh, {'ao': 2048}


def frigate(k):
    """a frigate: full-rigged ship, a row of ports on the gun deck in a yellow band between black wales,
    quarterdeck and forecastle, stern windows, the ship's boat amidships"""
    sh = Ship(k, dict(L=9.6, B=1.55, D=0.95, deck=0.95, sheer=0.16, bw=0.36, qd=(0.3, 0.34), fc=(0.84, 0.3), transom=0.64,
                      topband=('planksDark', 0.1), side='planksDark', bottom='planksDark',
                      wales=[(-0.62, -0.48, 'black'), (-0.48, -0.18, 'plasterYellow'), (-0.18, -0.1, 'black')], inner='red'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=5, rows=1, gold=True, lanterns=3)
    fx, mx, zx = sh.xs + 0.72 * sh.L, sh.xs + 0.5 * sh.L, sh.xs + 0.24 * sh.L
    (f1, f2, f3), Pf = sh.mast(fx, [5.0, 7.4, 9.0], r=0.13)
    (m1, m2, m3), Pm = sh.mast(mx, [5.5, 8.2, 10.2], r=0.14)
    (z1, z2), Pz = sh.mast(zx, [5.0, 7.3], r=0.1)
    for (x, h, P) in ((fx, (f1, f2, f3), Pf), (mx, (m1, m2, m3), Pm), (zx, (z1, z2), Pz)):
        sh.shrouds(x, h[0], P, n=4 if x != zx else 3)
        sh.topshrouds(h[0].y, h[1], P, 0.85)
        sh.backstays(h[-1], x - 0.4)
    sh.square(fx, [(f3.y - 0.25, 1.25), (f2.y - 0.35, 1.85), (f1.y - 0.3, 2.6)], sh.deck(fx) + 1.35, Pf)
    sh.square(mx, [(m3.y - 0.3, 1.4), (m2.y - 0.35, 2.05), (m1.y - 0.3, 2.85)], sh.deck(mx) + 1.4, Pm)
    sh.square(zx, [(z2.y - 0.3, 1.25)], z1.y + 0.15, Pz)
    sh.yard(Pz(z1.y + 0.05).x, z1.y + 0.05, 1.7)
    sh.gaff(zx, sh.deck(zx) + 1.2, 3.0, 4.2, 2.2, 0.4, Pz)
    sh.stay(V(m1.x, m1.y - 0.2, 0), V(fx + 0.1, sh.deck(fx) + 0.6, 0), 0.024)
    sh.stay(V(m2.x, m2.y - 0.25, 0), V(f1.x, f1.y - 0.1, 0), 0.016)
    sh.stay(V(z1.x, z1.y - 0.2, 0), V(mx - 0.1, sh.deck(mx) + 1.2, 0), 0.018)
    sh.stay(V(z2.x, z2.y - 0.2, 0), V(m1.x, m1.y - 0.1, 0), 0.014)
    spr = sh.bowsprit(2.4, 0.24, boom=1.4)
    sh.stay(V(f1.x, f1.y - 0.2, 0), spr(0.3), 0.024)
    sh.stay(V(f2.x, f2.y - 0.3, 0), spr(0.65))
    sh.stay(V(f3.x, f3.y - 0.15, 0), spr(0.99), 0.014)
    sh.jib(V(f1.x + 0.06, f1.y - 0.5, 0), spr(0.3), 1.4)
    sh.jib(V(f2.x + 0.06, f2.y - 0.6, 0), spr(0.65), 1.4, 0.35)
    sh.jib(V(f3.x + 0.05, f3.y - 0.5, 0), spr(0.98), 1.1, 0.9)
    sh.flag(V(m3.x, m3.y + 0.04, 0))
    sh.flag(V(f3.x, f3.y + 0.04, 0), 'pennant')
    sh.flag(V(z2.x, z2.y + 0.04, 0), 'pennant')
    ports = [sh.xs + 1.1 + i * 0.86 for i in range(9)]
    dress(sh, x_ports=ports, port_y=sh.sheer(0) - 0.33 - 0.0, x_guns=[-0.9, 0.6], hatches=[(-0.25, 0.65, 0.6), (1.6, 0.6, 0.55)],
          boat=(0.55, 1.5, 0.62), wheel=sh.xs + 1.5, capstan=-1.25,
          clutter=[('cask', 3.3, 0.45, 0.8), ('cask', 3.3, -0.45, 0.8), ('coil', -2.2, 0.55), ('coil', 2.4, -0.5), ('crate', 2.35, 0.45, 0.26)])
    return sh, {'ao': 2048}


def galleon(k):
    """a Spanish galleon: towering stern castle with a poop, forecastle, two rows of ports, a lateen mizzen,
    a spritsail under the bowsprit, painted red and ochre with gilt on the stern"""
    sh = Ship(k, dict(L=10.8, B=1.85, D=1.05, deck=1.0, sheer=0.22, bw=0.36, qd=(0.38, 0.55), poop=(0.17, 0.5), fc=(0.8, 0.55),
                      transom=0.7, tumble=0.22, topband=('red', 0.14), side='planksDark',
                      wales=[(-0.78, -0.68, 'black'), (-0.68, -0.44, 'plasterYellow'), (-0.44, -0.36, 'black'), (-0.08, 0.0, 'black')], inner='red'))
    sh.shell(); sh.interior(); sh.keelson()
    sh.stern(windows=4, rows=2, gold=True, lanterns=3)
    fx, mx, zx = sh.xs + 0.74 * sh.L, sh.xs + 0.52 * sh.L, sh.xs + 0.27 * sh.L
    (f1, f2), Pf = sh.mast(fx, [6.2, 8.8], r=0.15)
    (m1, m2, m3), Pm = sh.mast(mx, [6.8, 9.6, 11.3], r=0.17)
    (z1,), Pz = sh.mast(zx, [6.6], r=0.11)
    sh.shrouds(fx, f1, Pf, n=4)
    sh.topshrouds(f1.y, f2, Pf, 0.9)
    sh.shrouds(mx, m1, Pm, n=4)
    sh.topshrouds(m1.y, m2, Pm, 0.95)
    sh.shrouds(zx, z1, Pz, n=3)
    for (h, x) in ((f2, fx), (m3, mx)):
        sh.backstays(h, x - 0.4)
    sh.square(fx, [(f2.y - 0.3, 1.75), (f1.y - 0.3, 2.75)], sh.deck(fx) + 1.6, Pf)
    sh.square(mx, [(m3.y - 0.3, 1.25), (m2.y - 0.35, 2.1), (m1.y - 0.3, 3.1)], sh.deck(mx) + 1.5, Pm)
    # lateen mizzen: a long yard slung across the mast, its sail pinned along the yard
    ya, yb = V(zx + 1.8, sh.deck(zx + 1.8) + 1.3, 0), V(zx - 2.9, z1.y + 0.6, 0)
    k.beam('wood', ya, yb, 0.08, round_=True, seg=8 if not k.lod else 5)
    cl = V(zx - 2.2, sh.deck(zx - 2.2) + 1.0, 0)
    sh.sails.append({'kind': 'jib', 'c': [list(yb + V(0.1, -0.08, 0)), list(yb + V(0.1, -0.08, 0)), list(cl), list(ya + V(-0.2, -0.05, 0))]})
    sh.stay(V(m1.x, m1.y - 0.2, 0), V(fx + 0.1, sh.deck(fx) + 0.6, 0), 0.026)
    sh.stay(V(m2.x, m2.y - 0.25, 0), V(f1.x, f1.y - 0.1, 0), 0.016)
    sh.stay(V(z1.x, z1.y - 0.2, 0), V(mx - 0.1, sh.deck(mx) + 1.4, 0), 0.018)
    spr = sh.bowsprit(3.6, 0.38)
    sh.stay(V(f1.x, f1.y - 0.2, 0), spr(0.55), 0.026)
    sh.stay(V(f2.x, f2.y - 0.3, 0), spr(0.99), 0.016)
    # spritsail under the bowsprit
    sp = spr(0.78)
    sh.yard(sp.x - 0.09, sp.y - 0.1, 1.45)
    sh.sails.append({'kind': 'sq', 'c': [[sp.x + 0.06, sp.y - 0.15, -1.36], [sp.x + 0.06, sp.y - 0.15, 1.36], [sp.x + 0.35, sp.y - 1.25, 1.42], [sp.x + 0.35, sp.y - 1.25, -1.42]]})
    sh.flag(V(m3.x, m3.y + 0.04, 0))
    sh.flag(V(f2.x, f2.y + 0.04, 0), 'pennant')
    sh.flag(V(z1.x, z1.y + 0.04, 0), 'pennant')
    s0 = sh.sheer(0)
    ports = [sh.xs + 2.4 + i * 0.85 for i in range(8)]
    sh.gunports(s0 - 0.56, ports, 0.19)
    dress(sh, x_ports=[sh.xs + 1.0 + i * 0.7 for i in range(3)], port_y=sh.deck(sh.xs + 1.5) - 0.3, x_guns=[0.2], hatches=[(-0.6, 0.7, 0.65), (1.4, 0.6, 0.55)],
          boat=(0.6, 1.6, 0.66), wheel=sh.xs + 2.9, capstan=-1.45,
          clutter=[('cask', 3.6, 0.6, 0.85), ('cask', 3.6, -0.6, 0.85), ('coil', -2.0, 0.65), ('crate', 2.25, 0.55, 0.28), ('crate', 2.3, -0.5, 0.26)])
    return sh, {'ao': 2048}


SPECS = {'sloop': sloop, 'schooner': schooner, 'snow': snow, 'brigantine': brigantine, 'frigate': frigate, 'galleon': galleon}


def bounds(k):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for v in k.bm.verts:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i])
            hi[i] = max(hi[i], v.co[i])
    return lo, hi


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv or list(SPECS)
    fast = bool(os.environ.get('FAST'))
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        t0 = time.time()
        k = Kit(seed=abs(hash(name)) % 10007)
        sh, opts = SPECS[name](k)
        lo, hi = bounds(k)
        for sl in sh.sails:
            for c in sl['c']:
                lo.x = min(lo.x, c[0]); hi.x = max(hi.x, c[0]); hi.y = max(hi.y, c[1])
        plan = {
            'length': round(hi.x - lo.x, 3), 'xmin': round(lo.x, 3), 'xmax': round(hi.x, 3), 'height': round(hi.y, 3),
            'beam': round(2 * sh.B, 3), 'deck': round(sh.deck(0), 3), 'draft': sh.D,
            'sails': [{'kind': s_['kind'], 'c': [[round(v, 3) for v in c] for c in s_['c']]} for s_ in sh.sails],
            'flags': sh.flags,
        }
        k.finish('ship_' + name, OUT, ao_size=opts.get('ao', 2048), ao_samples=32 if fast else 96, ao_dist=1.0, ground=False)
        k2 = Kit(seed=abs(hash(name)) % 10007, lod=True)
        SPECS[name](k2)
        k2.finish('ship_' + name + '_lod', OUT, ao_size=512, ao_samples=16, ao_dist=1.0, ground=False)
        json.dump(plan, open(os.path.join(OUT, 'ship_' + name + '.json'), 'w'), separators=(',', ':'))
        print(f'SHIP {name}: {plan["length"]} long, {plan["height"]} high, {len(sh.sails)} sails, {time.time() - t0:.1f}s')


main()
