"""Core landmarks: the governor's palace (by wealth level), the dock, boat and ship yards, and farms."""
import math
from mathutils import Vector
from defs import building
from arch import *
from arch import _barrel_tile


# ------------------------------------------------------------------------------------------- hipped tile roof

def tile_hip(k, w, d, rise, over=0.25, y=0.0, tile_len=0.13, tile_w=0.08):
    """a hipped roof of barrel tiles (w >= d): four slopes of equal pitch, tiles laid in columns up each
    face and cut at the hips, mortared hips and ridge with cap tiles, fascia and rafter feet.
    Returns the ridge height."""
    Wo, Do = w + 2 * over, d + 2 * over
    ang = math.atan2(rise, d / 2)
    eave_y = y - over * math.tan(ang)
    run = Do / 2
    top_y = eave_y + run * math.tan(ang)
    up = Vector((0, math.sin(ang), -math.cos(ang)))
    nrm = Vector((0, math.cos(ang), math.sin(ang)))
    for f in ('front', 'back', 'right', 'left'):
        L = Wo if f in ('front', 'back') else Do
        ez = Do / 2 if f in ('front', 'back') else Wo / 2
        k.face(f, 0, 0)
        if L > Do + 1e-4:
            poly = [V(-L / 2, eave_y, ez), V(L / 2, eave_y, ez), V((L - Do) / 2, top_y, ez - run), V(-(L - Do) / 2, top_y, ez - run)]
        else:
            poly = [V(-L / 2, eave_y, ez), V(L / 2, eave_y, ez), V(0, top_y, ez - run)]
        n = len(poly)
        k.mesh('planksDark', [p + V(0, -0.012, 0) for p in poly], [tuple(range(n))[::-1], tuple(range(n))])
        if k.lod:
            k.mesh('tiles', [p + V(0, 0.03, 0) for p in poly], [tuple(range(n))], uvscale=1.0)
        else:
            cols = round(L / tile_w)
            for c in range(cols):
                x = -L / 2 + (c + 0.5) * L / cols
                r = max(0.0, min(run, L / 2 - abs(x)))
                sl = r / math.cos(ang)
                if sl < tile_len * 0.5:
                    continue
                cap = c % 2 == 1
                rows = max(1, math.ceil(sl / (tile_len * 0.8)))
                for i in range(rows):
                    t0 = max(0.0, min(sl - tile_len, i * tile_len * 0.8))
                    p = V(x, eave_y, ez) + up * (t0 + tile_len / 2) + nrm * (0.03 if cap else 0.0)
                    _barrel_tile(k, p, up, nrm, tile_len * (1 + (k.r() - 0.5) * 0.04), tile_w * (0.55 if cap else 0.6), cap, taper=0.12)
            nr = max(3, round((L - 2 * over) / 0.35))
            for i in range(nr + 1):
                xx = -L / 2 + over + 0.04 + i * (L - 2 * over - 0.08) / nr
                k.beam('darkwood', V(xx, y - 0.02, ez - over - 0.04), V(xx, eave_y - 0.01, ez - 0.06), 0.045)
        k.beam('darkwood', V(-L / 2, eave_y - 0.03, ez - 0.02), V(L / 2, eave_y - 0.03, ez - 0.02), 0.07, 0.04)
        k.pop()
    # hips and ridge: mortar rolls with cap tiles
    rl = max(0.0, (Wo - Do) / 2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            c = V(sx * Wo / 2, eave_y + 0.04, sz * Do / 2)
            e = V(sx * rl, top_y + 0.04, 0)
            k.beam('plaster', c, e, 0.1, 0.05)
            if not k.lod:
                dv = e - c
                L = dv.length
                ns = max(1, round(L / 0.14))
                for i in range(ns):
                    _barrel_tile(k, c + dv * ((i + 0.5) / ns) + V(0, 0.04, 0), dv.normalized(), Vector((0, 1, 0)), L / ns * 1.05, 0.07, True, taper=0.1)
    if rl > 0:
        k.beam('plaster', V(-rl, top_y + 0.04, 0), V(rl, top_y + 0.04, 0), 0.12, 0.06)
        if not k.lod:
            ns = max(1, round(2 * rl / 0.14))
            for i in range(ns):
                _barrel_tile(k, V(-rl + (i + 0.5) * 2 * rl / ns, top_y + 0.09, 0), Vector((1, 0, 0)), Vector((0, 1, 0)), 2 * rl / ns * 1.05, 0.075, True, taper=0.1)
    return top_y


# ------------------------------------------------------------------------------------------- palace

def balustrade(k, x0, x1, z, y, h=0.32, mat='plaster'):
    """a rail with turned balusters between two points along x"""
    L = x1 - x0
    k.box(mat, L, 0.05, 0.1, (x0 + x1) / 2, y, z)
    k.box(mat, L + 0.02, 0.05, 0.12, (x0 + x1) / 2, y + h - 0.05, z)
    n = max(2, round(L / 0.09))
    for i in range(n):
        x = x0 + (i + 0.5) * L / n
        if k.lod:
            k.box(mat, 0.03, h - 0.1, 0.03, x, y + 0.05, z)
        else:
            k.cyl(mat, 0.018, 0.026, (h - 0.1) * 0.5, x, y + 0.05, z, seg=8)
            k.cyl(mat, 0.026, 0.016, (h - 0.1) * 0.5, x, y + 0.05 + (h - 0.1) * 0.5, z, seg=8)


def cannon_on_carriage(k, x, z, ry=0.0, s=1.0):
    """a naval long gun on a four-wheeled truck carriage"""
    k.push(x, 0, z, ry)
    # carriage cheeks, axles and trucks
    for sx in (-1, 1):
        k.mesh('darkwood', [V(sx * 0.11 * s, 0.06 * s, -0.25 * s), V(sx * 0.11 * s, 0.06 * s, 0.22 * s), V(sx * 0.11 * s, 0.3 * s, 0.18 * s), V(sx * 0.11 * s, 0.24 * s, 0.0), V(sx * 0.11 * s, 0.18 * s, -0.25 * s)],
               [(0, 1, 2, 3, 4), (4, 3, 2, 1, 0)])
        k.box('darkwood', 0.035 * s, 0.24 * s, 0.47 * s, sx * 0.11 * s, 0.06 * s, -0.015 * s)
    for zz in (-0.17, 0.14):
        k.beam('darkwood', V(-0.17 * s, 0.07 * s, zz * s), V(0.17 * s, 0.07 * s, zz * s), 0.05 * s, round_=True)
        for sx in (-1, 1):
            k.cyl('darkwood', 0.07 * s, 0.07 * s, 0.04 * s, sx * 0.15 * s, 0.07 * s, zz * s, seg=12, rz=math.pi / 2)
    k.box('darkwood', 0.2 * s, 0.03 * s, 0.4 * s, 0, 0.1 * s, -0.02 * s)
    # the barrel: a lathe profile with reinforce rings, cascabel and muzzle swell
    prof = [(0.0, -0.33), (0.03, -0.36), (0.05, -0.33), (0.105, -0.3), (0.11, -0.22), (0.1, -0.21), (0.095, 0.05), (0.088, 0.06),
            (0.07, 0.42), (0.082, 0.45), (0.075, 0.48), (0.045, 0.48), (0.045, 0.4)]
    seg = 8 if k.lod else 16
    verts, faces = [], []
    for (r, zz) in prof:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(V(math.cos(a) * r * s, 0.3 * s + math.sin(a) * r * s, zz * s))
    for j in range(len(prof) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    k.mesh('iron', verts, faces, uvscale=1.0)
    k.beam('iron', V(-0.13 * s, 0.3 * s, 0.0), V(0.13 * s, 0.3 * s, 0.0), 0.04 * s, round_=True)  # trunnions
    k.pop()


def shot_pyramid(k, x, z, n=3, r=0.05):
    for layer in range(n):
        m = n - layer
        for i in range(m):
            for j in range(m):
                px = x + (i - (m - 1) / 2) * r * 2
                pz = z + (j - (m - 1) / 2) * r * 2
                py = r + layer * r * 1.42
                if k.lod and layer > 0:
                    continue
                k.cyl('iron', r, r, r * 1.6, px, py - r * 0.8, pz, seg=6) if k.lod else _ball(k, px, py, pz, r)


def _ball(k, x, y, z, r, seg=8, rings=6):
    verts, faces = [], []
    for j in range(rings + 1):
        t = math.pi * j / rings
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(V(x + math.sin(t) * math.cos(a) * r, y + math.cos(t) * r, z + math.sin(t) * math.sin(a) * r))
    for j in range(rings):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    k.mesh('iron', verts, faces)


def frustum(k, mat, x, z, b, t, h):
    """a battered block: square base b, top t, height h (walls lean inward like a bastion)"""
    vs = [V(x - b / 2, 0, z - b / 2), V(x + b / 2, 0, z - b / 2), V(x + b / 2, 0, z + b / 2), V(x - b / 2, 0, z + b / 2),
          V(x - t / 2, h, z - t / 2), V(x + t / 2, h, z - t / 2), V(x + t / 2, h, z + t / 2), V(x - t / 2, h, z + t / 2)]
    k.mesh(mat, vs, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)], uvscale=1.2)


def wall_run(k, a, b, h, t=0.24):
    """a rendered rubble wall between two points with a sloped coping and a scuffed base"""
    d = b - a
    L = d.length
    ry = math.atan2(d.x, d.z)
    mid = (a + b) / 2
    k.push(mid.x, 0, mid.z, ry)
    k.box('stone', t, h, L, 0, 0, 0, uvscale=1.2, wuv=True, bevel=0.0)
    k.cbox('stoneDark', t + 0.06, 0.06, L + 0.02, 0, h + 0.02, 0, uvscale=2.0)
    k.cbox('stoneDark', t * 0.6, 0.05, L, 0, h + 0.07, 0, uvscale=2.0)
    k.box('stoneDark', t + 0.04, 0.12, L, 0, 0, 0, uvscale=2.0)
    k.pop()


def palace(k, level):
    """the Governor's house of a pirate king: a fortified colonial residence that grows with the hoard.
    0: a single-storey rendered stone house with a front arcade, hipped tile roof, two guns and a flag.
    1: a second storey with a balustraded gallery.  2: corner bastion towers and a walled forecourt.
    3: a belvedere tower with a cupola, a grand stair and a gun battery."""
    W, D = 9, 6
    bw, bd = 4.8, 2.6
    h1, h2 = 1.05, 0.95
    zc = -0.7  # main block sits back; the forecourt is in front
    # terrace platform
    k.push(0, 0, zc)
    plinth(k, bw + 1.0, bd + 1.4, 0.24)
    k.push(0, 0.24, 0)
    ops1 = [Op('front', 0.0, 'double', h=0.92)] + [Op('front', x, 'window', h=0.5, y=0.25) for x in (-1.75, -0.9, 0.9, 1.75)] + \
           [Op('left', z, 'window', h=0.5, y=0.25) for z in (-0.6, 0.6)] + [Op('right', z, 'window', h=0.5, y=0.25) for z in (-0.6, 0.6)] + \
           [Op('back', x, 'window', h=0.5, y=0.25, bars=True) for x in (-1.4, 0.0, 1.4)]
    plastered(k, bw, bd, h1, 'plasterYellow', ops1, t=0.12, quoins='stone')
    k.box('stone', bw + 0.08, 0.09, bd + 0.08, 0, h1 - 0.02, 0, uvscale=2.0)  # string course
    top = h1 + 0.07
    if level >= 1:
        ops2 = [Op('front', x, 'door', h=0.75) for x in (-0.9, 0.0, 0.9)] + [Op('front', x, 'window', h=0.5, y=0.2) for x in (-1.75, 1.75)] + \
               [Op('left', z, 'window', h=0.48, y=0.22) for z in (-0.6, 0.6)] + [Op('right', z, 'window', h=0.48, y=0.22) for z in (-0.6, 0.6)] + \
               [Op('back', x, 'window', h=0.48, y=0.22) for x in (-1.4, 0.0, 1.4)]
        k.push(0, top, 0)
        plastered(k, bw, bd, h2, 'plasterYellow', ops2, t=0.11, quoins='stone')
        k.box('stone', bw + 0.1, 0.07, bd + 0.1, 0, h2 - 0.02, 0, uvscale=2.0)  # cornice
        k.pop()
        top += h2 + 0.05
    roof_top = tile_hip(k, bw, bd, 0.85 if level >= 1 else 0.75, over=0.3, y=top, tile_len=0.17, tile_w=0.105)
    for x in (-1.2, 1.2):
        chimney(k, x, -0.35, top - 0.1, roof_top - top + 0.35, 0.28)
    # front arcade (loggia) with a balcony over it
    az = bd / 2 + 0.45
    n = 5
    for i in range(n + 1):
        x = -bw / 2 + 0.25 + i * (bw - 0.5) / n
        k.box('stone', 0.22, 0.08, 0.22, x, 0, az, uvscale=2.0)
        k.box('plasterYellow', 0.18, h1 - 0.12, 0.18, x, 0.08, az, uvscale=0.5)
        k.box('stone', 0.24, 0.06, 0.24, x, h1 - 0.06, az, uvscale=2.0)
    for i in range(n):
        x0 = -bw / 2 + 0.25 + i * (bw - 0.5) / n
        x1 = -bw / 2 + 0.25 + (i + 1) * (bw - 0.5) / n
        span = x1 - x0 - 0.18
        cx = (x0 + x1) / 2
        segs = 6 if k.lod else 12
        for j in range(segs):
            a0, a1 = math.pi * j / segs, math.pi * (j + 1) / segs
            r = span / 2
            p0 = V(cx - math.cos(a0) * r, h1 - 0.3 + math.sin(a0) * r * 0.55, az)
            p1 = V(cx - math.cos(a1) * r, h1 - 0.3 + math.sin(a1) * r * 0.55, az)
            k.beam('plasterYellow', p0, p1, 0.06, 0.16)
        k.box('plasterYellow', x1 - x0, 0.14, 0.18, cx, h1 - 0.14, az)
    k.box('stone', bw - 0.2, 0.06, 0.95, 0, 0.0, bd / 2 + 0.47, uvscale=2.0)  # arcade floor
    k.box('planks', bw - 0.26, 0.05, 0.85, 0, h1, bd / 2 + 0.43, uvscale=1.2)  # balcony floor
    if level >= 1:
        balustrade(k, -bw / 2 + 0.15, bw / 2 - 0.15, az + 0.05, h1 + 0.05)
    # grand steps to the terrace
    for i in range(3):
        k.box('stone', 1.4 - i * 0.12, 0.08 * (3 - i), 0.22, 0, -0.24, bd / 2 + 1.0 + 0.2 * i, uvscale=2.0)
    k.pop()
    # forecourt: gravel, guns, flag
    k.box('dirt', bw + 1.0, 0.01, 1.8, 0, 0, bd / 2 + 1.3)
    k.pop()
    gz = zc + bd / 2 + 1.6
    for x in (-1.3, 1.3):
        cannon_on_carriage(k, x, gz, ry=0.0 if level < 3 else 0.0)
        shot_pyramid(k, x + 0.45, gz - 0.1, 3, 0.045)
    k.cyl('wood', 0.045, 0.03, 3.4 + level * 0.3, 2.9, 0, gz - 0.2, seg=8)
    k.marker('flag', 2.9, 3.4 + level * 0.3, gz - 0.2)
    for x in (-2.9, 2.9):
        cask(k, x, gz + 0.4, 0.9)
    if level >= 2:
        # corner bastions in the Spanish manner: a battered base, a rounded cordon, a parapet with
        # embrasures and a domed sentry box at the salient; curtain walls tie them to the forecourt gate
        for sx in (-1, 1):
            tx, tz = sx * 3.75, zc - 0.2
            frustum(k, 'stone', tx, tz, 1.35, 1.12, 1.45)
            k.beam('stone', V(tx - 0.58, 1.48, tz + 0.58), V(tx + 0.58, 1.48, tz + 0.58), 0.09, round_=True)
            k.beam('stone', V(tx - 0.58, 1.48, tz - 0.58), V(tx + 0.58, 1.48, tz - 0.58), 0.09, round_=True)
            k.beam('stone', V(tx - 0.58, 1.48, tz - 0.58), V(tx - 0.58, 1.48, tz + 0.58), 0.09, round_=True)
            k.beam('stone', V(tx + 0.58, 1.48, tz - 0.58), V(tx + 0.58, 1.48, tz + 0.58), 0.09, round_=True)
            k.box('stoneDark', 1.12, 0.04, 1.12, tx, 1.48, tz, uvscale=2.0)
            # parapet with two embrasures facing out to sea and the approach
            for (a0, a1, zz, along) in ((-0.56, -0.12, 0.52, 'x'), (0.12, 0.56, 0.52, 'x'), (-0.56, -0.12, -0.52, 'x'), (0.12, 0.56, -0.52, 'x')):
                k.box('stone', a1 - a0, 0.3, 0.12, tx + (a0 + a1) / 2, 1.5, tz + zz, uvscale=2.0)
            k.box('stone', 0.12, 0.3, 1.16, tx + sx * 0.52, 1.5, tz, uvscale=2.0)
            k.box('stone', 0.12, 0.3, 1.16, tx - sx * 0.52, 1.5, tz, uvscale=2.0)
            # sentry box (garita) on the outer front corner
            gx, gz = tx + sx * 0.5, tz + 0.5
            k.cyl('stone', 0.13, 0.13, 0.42, gx, 1.5, gz, seg=12)
            k.box('black', 0.08, 0.2, 0.02, gx - sx * 0.04, 1.62, gz + 0.12)
            sv, sf = [], []
            seg, rings = (8, 2) if k.lod else (12, 4)
            for j in range(rings + 1):
                t = j / rings
                r = 0.15 * math.cos(t * math.pi / 2) + 0.005
                for i in range(seg):
                    a = 2 * math.pi * i / seg
                    sv.append(V(gx + math.cos(a) * r, 1.92 + math.sin(t * math.pi / 2) * 0.13, gz + math.sin(a) * r))
            for j in range(rings):
                for i in range(seg):
                    a = j * seg + i
                    b = j * seg + (i + 1) % seg
                    sf.append((a, b, b + seg, a + seg))
            k.mesh('stone', sv, sf, uvscale=2.0)
            k.cyl('stone', 0.03, 0.01, 0.1, gx, 2.05, gz, seg=6)
            k.push(tx, 1.5, tz)
            cannon_on_carriage(k, 0, 0.1, s=0.9)
            k.pop()
            # curtain wall from the bastion to the forecourt corner
            wall_run(k, V(tx, 0, tz + 0.6), V(sx * 3.2, 0, 2.75), 0.85)
        # forecourt wall with a gateway of two piers and finials
        wall_run(k, V(-3.2, 0, 2.75), V(-0.75, 0, 2.75), 0.6)
        wall_run(k, V(0.75, 0, 2.75), V(3.2, 0, 2.75), 0.6)
        for sx in (-1, 1):
            k.box('stone', 0.32, 1.05, 0.32, sx * 0.75, 0, 2.75, uvscale=2.0)
            k.box('stoneDark', 0.38, 0.06, 0.38, sx * 0.75, 1.05, 2.75, uvscale=2.0)
            k.cyl('stone', 0.11, 0.05, 0.12, sx * 0.75, 1.11, 2.75, seg=10)
            if not k.lod:
                _ball(k, sx * 0.75, 1.29, 2.75, 0.07, seg=10, rings=7)
    if level >= 3:
        # belvedere: a square tower over the centre with an open lantern and a tiled cupola
        k.push(0, 0, zc - 0.2)
        by = roof_top - 0.55
        k.box('plasterYellow', 1.0, 0.75, 1.0, 0, by, 0, wuv=True)
        k.box('stone', 1.08, 0.07, 1.08, 0, by + 0.75, 0, uvscale=2.0)
        for (sx, sz) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
            k.box('plasterYellow', 0.14, 0.55, 0.14, sx * 0.43, by + 0.82, sz * 0.43)
        balustrade(k, -0.4, 0.4, 0.45, by + 0.82, 0.25)
        k.box('stone', 1.12, 0.06, 1.12, 0, by + 1.37, 0, uvscale=2.0)
        cv, cf = [], []
        seg, rings = (8, 3) if k.lod else (16, 6)
        for j in range(rings + 1):
            t = j / rings
            r = 0.56 * math.cos(t * math.pi / 2) + 0.02
            for i in range(seg):
                a = 2 * math.pi * i / seg + math.pi / 4
                cv.append(V(math.cos(a) * r, by + 1.43 + math.sin(t * math.pi / 2) * 0.5, math.sin(a) * r))
        for j in range(rings):
            for i in range(seg):
                a = j * seg + i
                b = j * seg + (i + 1) % seg
                cf.append((a, b, b + seg, a + seg))
        k.mesh('terracotta', cv, cf, uvscale=1.5)
        k.cyl('brass', 0.03, 0.01, 0.35, 0, by + 1.93, 0, seg=8)
        k.pop()
        # a battery of guns along the forecourt wall
        for x in (-2.3, 2.3):
            cannon_on_carriage(k, x, 2.4, s=0.95)
    return {'ao': 2048 if level >= 2 else 1024}


for _lv in range(4):
    building(f'palace@{_lv}')(lambda k, _lv=_lv: palace(k, _lv))


# ------------------------------------------------------------------------------------------- nautical

def piling(k, x, z, top, bottom=-2.4, r=0.075):
    k.cyl('bark', r * 1.05, r, top - bottom, x, bottom, z, seg=9)
    if not k.lod:
        k.cyl('planksDark', r * 0.95, r * 0.9, 0.012, x, top, z, seg=9)  # cut top
        # a band of weed and barnacles at the waterline
        k.cyl('leaf', r * 1.12, r * 1.12, 0.12, x, -0.12, z, seg=9)


def bollard(k, x, z, y):
    """an old cannon barrel sunk muzzle-down as a mooring bollard"""
    k.cyl('iron', 0.075, 0.065, 0.24, x, y, z, seg=12)
    k.cyl('iron', 0.085, 0.085, 0.03, x, y + 0.16, z, seg=12)
    k.cyl('iron', 0.05, 0.04, 0.06, x, y + 0.24, z, seg=10)


def capstan(k, x, z, y):
    k.cyl('darkwood', 0.12, 0.1, 0.32, x, y, z, seg=12)
    k.cyl('darkwood', 0.15, 0.15, 0.05, x, y + 0.3, z, seg=12)
    if not k.lod:
        for i in range(4):
            a = i * math.pi / 4
            k.beam('wood', V(x - math.cos(a) * 0.45, y + 0.33, z - math.sin(a) * 0.45), V(x + math.cos(a) * 0.45, y + 0.33, z + math.sin(a) * 0.45), 0.035)


def derrick(k, x, z, y, h=1.6, ry=0.0):
    """a shear-leg cargo derrick with a boom, block and tackle and a load in a net"""
    k.push(x, y, z, ry)
    for sx in (-1, 1):
        k.beam('bark', V(sx * 0.3, 0, 0.15), V(0, h, -0.35), 0.06, round_=True)
    k.beam('bark', V(0, 0, 0.6), V(0, h, -0.35), 0.05, round_=True)  # back stay
    k.beam('rope', V(0, h, -0.35), V(0, h - 0.1, 0.9), 0.012, round_=True, seg=4)
    k.beam('rope', V(0, h, -0.35), V(0, 0.55, -0.55), 0.01, round_=True, seg=4)
    k.box('darkwood', 0.07, 0.12, 0.05, 0, 0.45, -0.55)  # block
    if not k.lod:
        crate(k, 0, 0.12, -0.55, 0.26, 0.4)
        for i in range(4):
            a = i / 4 * math.tau + 0.4
            k.beam('rope', V(math.cos(a) * 0.17, 0.14, -0.55 + math.sin(a) * 0.17), V(0, 0.45, -0.55), 0.008, round_=True, seg=4)
    k.pop()


@building('dock')
def dock(k):
    """the pier: a plank approach from the beach to a T-head on driven bark piles with cross-bracing,
    fender piles on the seaward face, cannon bollards, a capstan, a cargo derrick, ladders and cargo"""
    W, D = 5, 4
    dy = 0.35
    k.marker('deck', 0, dy, 0)
    # approach pier (runs along z, planks across it)
    az0, az1 = D / 2 + 0.35, -D / 2 + 1.3
    aw = 1.3
    k.push(0, 0, (az0 + az1) / 2)
    deck(k, aw, az0 - az1, dy, 'planks', along='x', joists=True)
    k.pop()
    n = round((az0 - az1) / 0.9)
    for i in range(n + 1):
        z = az0 - 0.08 - i * (az0 - az1 - 0.16) / n
        for sx in (-1, 1):
            piling(k, sx * (aw / 2 - 0.05), z, dy + 0.02)
        if i < n and not k.lod:
            z2 = az0 - 0.08 - (i + 1) * (az0 - az1 - 0.16) / n
            for sx in (-1, 1):
                k.beam('bark', V(sx * (aw / 2 - 0.05), dy - 0.15, z), V(sx * (aw / 2 - 0.05), -0.5, z2), 0.05, round_=True)
            k.beam('bark', V(-aw / 2 + 0.05, -0.3, z), V(aw / 2 - 0.05, -0.3, z), 0.05, round_=True)
    # T-head (runs along x, planks along z)
    hz0, hz1 = -D / 2 + 1.3, -D / 2 - 0.25
    hw = W - 0.2
    k.push(0, 0, (hz0 + hz1) / 2)
    deck(k, hw, hz0 - hz1, dy, 'planks', along='z', joists=True)
    k.pop()
    nx = round(hw / 0.85)
    for i in range(nx + 1):
        x = -hw / 2 + 0.06 + i * (hw - 0.12) / nx
        for z in (hz0 - 0.06, hz1 + 0.06, (hz0 + hz1) / 2):
            piling(k, x, z, dy + 0.02)
        if not k.lod and i < nx:
            x2 = -hw / 2 + 0.06 + (i + 1) * (hw - 0.12) / nx
            k.beam('bark', V(x, dy - 0.15, hz1 + 0.06), V(x2, -0.6, hz1 + 0.06), 0.05, round_=True)
    # fender piles proud of the deck along the seaward face, with rope fenders between
    for i in range(7):
        x = -hw / 2 + 0.25 + i * (hw - 0.5) / 6
        piling(k, x, hz1 - 0.05, dy + 0.45, r=0.085)
        if not k.lod and i % 2 == 0:
            k.cyl('rope', 0.06, 0.06, 0.2, x + 0.3, dy - 0.25, hz1 - 0.08, seg=8)
            k.beam('rope', V(x + 0.3, dy - 0.05, hz1 - 0.08), V(x + 0.3, dy + 0.02, hz1 + 0.05), 0.01, round_=True, seg=4)
    # bollards, capstan, derrick and cargo
    for x in (-hw / 2 + 0.35, -0.7, 0.7, hw / 2 - 0.35):
        bollard(k, x, hz1 + 0.22, dy)
    if not k.lod:
        k.beam('rope', V(-0.7, dy + 0.18, hz1 + 0.22), V(-0.9, dy - 0.2, hz1 - 0.5), 0.02, round_=True, seg=5)
        rope_coil(k, -0.95, hz0 - 0.35)
        k.push(0, dy, 0)
        rope_coil(k, 0.4, hz0 - 0.3)
        k.pop()
    capstan(k, 1.4, hz0 - 0.55, dy)
    derrick(k, -1.6, hz0 - 0.55, dy, ry=0.0)
    k.push(0, dy, 0)
    cask(k, 1.95, hz0 - 0.3, 0.85)
    cask(k, 2.1, hz0 - 0.55, 0.85)
    cask(k, 1.98, hz0 - 0.52, 0.8, y=0.3)
    crate(k, -1.0, 0, hz0 - 0.32, 0.3, 0.1)
    crate(k, -0.7, 0, hz0 - 0.3, 0.26, -0.2)
    crate(k, -0.88, 0.3, hz0 - 0.32, 0.24, 0.3)
    sack(k, 0.55, az1 + 0.6)
    sack(k, 0.4, az1 + 0.75, 0.9, 1.0)
    k.pop()
    # ladders down to the water at the head
    for x in (0.25,):
        for sx in (-1, 1):
            k.box('wood', 0.04, dy + 0.6, 0.04, x + sx * 0.14, -0.6, hz1 - 0.03)
        for j in range(7):
            k.box('wood', 0.3, 0.03, 0.03, x, -0.5 + j * 0.15, hz1 - 0.03)
    # lantern posts at the shore end and on the head
    for (x, z) in ((aw / 2 - 0.05, az0 - 0.1), (-hw / 2 + 0.06, hz1 + 0.06)):
        k.cyl('darkwood', 0.04, 0.035, 0.85, x, dy, z, seg=8)
        lantern(k, x, dy + 0.85, z - 0.2)
    return {'ao': 2048}


def slipway(k, w, z0, z1, y0, y1):
    """a timbered launching ramp: ground ways on sleepers, sloping down into the water at -z"""
    L = z0 - z1
    ang = math.atan2(y0 - y1, L)
    n = round(L / 0.35)
    for i in range(n + 1):
        t = i / n
        z = z0 - L * t
        yy = y0 - (y0 - y1) * t
        k.cbox('darkwood', w + 0.2, 0.07, 0.12, 0, yy - 0.05, z, rx=0)
    for sx in (-1, 1):
        k.beam('planksDark', V(sx * w * 0.3, y0, z0), V(sx * w * 0.3, y1, z1), 0.14, 0.08)
    for i in range(round(L / 0.5)):
        z = z0 - 0.2 - i * 0.5
        yy = y0 - (y0 - y1) * ((z0 - z) / L)
        if not k.lod:
            k.box('wood', 0.22, 0.12, 0.16, 0, yy, z)  # keel blocks
    return ang


@building('boatyard')
def boatyard(k):
    """a boatyard for small craft: a slipway into the sea, keel blocks, an open work shed with a loft,
    sawpit, steam box for bending strakes, timber stacked to season, a gantry with block and tackle"""
    W, D = 5, 5
    # (the ways end at the yard's seaward edge, already under water, so they never run under a neighbour's pier)
    slipway(k, 1.6, 1.4, -D / 2 + 0.12, 0.05, -0.42)
    k.marker('hull', 0, 0.1, -0.8)
    # gantry over the slip
    for z in (-1.2, 0.6):
        for sx in (-1, 1):
            k.cyl('bark', 0.07, 0.06, 2.3, sx * 1.15, 0, z, seg=9)
        k.beam('bark', V(-1.3, 2.25, z), V(1.3, 2.25, z), 0.12)
        k.box('darkwood', 0.08, 0.14, 0.06, 0.2, 2.06, z)
        k.beam('rope', V(0.2, 2.06, z), V(0.2, 1.0, z), 0.012, round_=True, seg=4)
    for sx in (-1, 1):
        k.beam('bark', V(sx * 1.15, 2.2, -1.2), V(sx * 1.15, 2.2, 0.6), 0.09)
    # work shed with a loft, at the landward corner
    k.push(1.55, 0, 1.55)
    plinth(k, 1.6, 1.3, 0.08)
    k.push(0, 0.08, 0)
    board_batten(k, 1.5, 1.2, 0.95, 'oldplanks', [Op('front', -0.3, 'double', w=0.6, h=0.82), Op('left', 0.0, 'window', w=0.26, h=0.24, y=0.42)])
    thatch_gable(k, 1.5, 1.2, 0.62, over=0.28, y=0.95, mat='thatchDark', gable='oldplanks', res=0.06)
    k.pop()
    k.pop()
    # timber seasoning under a lean-to on the other side
    k.push(-1.65, 0, 1.4)
    for x in (-0.6, 0.6):
        k.cyl('bark', 0.045, 0.04, 0.95, x, 0, 0.45, seg=8)
    shingle_lean(k, 1.5, 1.0, 1.05, 0.9, z0=-0.5, mat='oldplanks')
    for z in (-0.3, 0.1):
        k.box('bark', 1.2, 0.06, 0.08, 0, 0, z)
    for i in range(18):
        k.box('planks', 1.25, 0.035, 0.12, (k.r() - 0.5) * 0.04, 0.06 + (i // 6) * 0.045, -0.4 + (i % 6) * 0.14, uvscale=1.2)
    k.pop()
    # steam box for bending planks over a fire, and a sawpit with a log over it
    k.push(-1.7, 0, 0.0)
    k.box('planksDark', 0.25, 0.25, 1.2, 0, 0.35, 0, uvscale=1.2)
    for z in (-0.5, 0.5):
        k.box('stone', 0.3, 0.35, 0.18, 0, 0, z, uvscale=2.0)
    k.marker('glow:0.18x0.06x0.5', 0, 0.06, 0)
    k.marker('smoke', 0, 0.62, 0.55)
    k.pop()
    k.push(-1.65, 0, -1.4)
    k.box('black', 0.5, 0.01, 1.2, 0, 0.0, 0)
    for s in (-1, 1):
        k.box('darkwood', 0.08, 0.08, 1.35, s * 0.3, 0, 0)
    k.cyl('bark', 0.15, 0.14, 1.5, 0, 0.23, -0.75, seg=10, rx=math.pi / 2)
    k.cbox('iron', 0.012, 0.75, 0.25, 0.05, 0.25, 0.1)
    k.pop()
    # strakes and ribs waiting by the slip
    if not k.lod:
        for i in range(5):
            a = i * 0.25
            pts = []
            for j in range(7):
                t = j / 6
                pts.append(V(0.9 + 0.08 * i, 0.05 + 0.45 * math.sin(t * math.pi * 0.5), 1.0 - t * 0.6))
            for j in range(6):
                k.beam('wood', pts[j], pts[j + 1], 0.04)
    cask(k, 2.1, -0.6, 0.85)
    rope_coil(k, 1.9, -1.2)
    return {'ao': 2048}


@building('shipyard')
def shipyard(k):
    """a shipyard for great ships: a long slipway with a cradle, a big shear-leg gantry, a covered
    mould loft and workshop under tiles, a mast pond, a ropewalk shed, timber stacks and a flag"""
    W, D = 9, 6
    # (the ways end at the yard's seaward edge, already under water)
    slipway(k, 2.6, 2.0, -D / 2 + 0.12, 0.08, -0.48)
    k.marker('hull', 0, 0.15, -1.0)
    # two gantries
    for z in (-2.0, 0.5):
        for sx in (-1, 1):
            k.cyl('bark', 0.09, 0.075, 3.3, sx * 1.75, 0, z, seg=10)
            k.beam('bark', V(sx * 1.75, 0.0, z + 0.5), V(sx * 1.75, 2.4, z), 0.06, round_=True)
        k.beam('bark', V(-1.95, 3.25, z), V(1.95, 3.25, z), 0.15)
        for x in (-0.6, 0.6):
            k.box('darkwood', 0.1, 0.16, 0.07, x, 3.0, z)
            k.beam('rope', V(x, 3.0, z), V(x, 1.4, z), 0.014, round_=True, seg=4)
    # mould loft and workshop: a long timber-framed hall under tiles
    k.push(2.65, 0, 1.4)
    plinth(k, 3.2, 2.2, 0.12)
    k.push(0, 0.12, 0)
    framed(k, 3.1, 2.1, 1.25, 'plaster', [Op('front', -0.8, 'double', w=0.8, h=1.0), Op('front', 0.6, 'window'), Op('front', 1.15, 'window'), Op('left', 0.0, 'window'), Op('right', -0.4, 'window'), Op('right', 0.4, 'window'), Op('back', -0.8, 'window'), Op('back', 0.8, 'window')])
    tile_gable(k, 3.1, 2.1, 0.8, over=0.22, y=1.25, gable='plaster', tile_len=0.16, tile_w=0.1)
    chimney(k, -1.2, -0.8, 1.15, 1.05, 0.28)
    k.pop()
    k.pop()
    # ropewalk: a long low open shed on the other side with a rope being laid
    k.push(-2.9, 0, 0.6)
    for z in (-1.7, -0.6, 0.6, 1.7):
        for sx in (-1, 1):
            k.cyl('bark', 0.045, 0.04, 0.85, sx * 0.45, 0, z, seg=8)
    k.push(0, 0, 0, math.pi / 2)
    thatch_gable(k, 3.7, 1.0, 0.45, over=0.22, y=0.85, mat='thatchDark', gable='oldplanks', res=0.07)
    k.pop()
    k.beam('rope', V(0, 0.5, -1.8), V(0, 0.48, 1.8), 0.03, round_=True, seg=6)
    k.box('darkwood', 0.35, 0.6, 0.12, 0, 0, -1.85)
    k.box('darkwood', 0.35, 0.6, 0.12, 0, 0, 1.85)
    k.pop()
    # timber stacks and a mast pond with spars floating
    for (x, z) in ((-3.0, -1.8), (3.4, -1.3)):
        for i in range(12):
            k.cyl('bark', 0.1, 0.09, 1.5, x - 0.7, 0.1 + (i // 4) * 0.18, z - 0.3 + (i % 4) * 0.2, seg=9, rz=-math.pi / 2)
    k.push(2.6, 0, -2.0)
    k.box('water', 1.6, 0.02, 0.9, 0, 0.0, 0)
    for sx in (-1, 1):
        k.box('stone', 1.7, 0.1, 0.1, 0, 0, sx * 0.5, uvscale=2.0)
        k.box('stone', 0.1, 0.1, 1.0, sx * 0.85, 0, 0, uvscale=2.0)
    for i in range(3):
        k.cyl('bark', 0.07, 0.06, 1.5, -0.75, 0.04, -0.25 + i * 0.25, seg=9, rz=-math.pi / 2)
    k.pop()
    k.cyl('wood', 0.04, 0.03, 3.0, 4.1, 0, -2.6, seg=8)
    k.marker('flag', 4.1, 3.0, -2.6)
    cask(k, 1.0, 2.5, 0.9)
    cask(k, 1.25, 2.6, 0.85)
    crate(k, -1.0, 0, 2.5, 0.3, 0.2)
    return {'ao': 2048}


# ------------------------------------------------------------------------------------------- farms
# The plants themselves are instanced by the game (src/render/prefabs.ts crops()); the model gives the
# field its ground, boundary and the farmers' shelter in the back-right corner (kept clear of plants).

def furrows(k, W, D):
    rows = round(D * 2.2)
    for r in range(rows):
        z = -D / 2 + 0.25 + r / max(1, rows - 1) * (D - 0.5)
        n = 18 if not k.lod else 4
        verts, faces = [], []
        for i in range(n + 1):
            x = -W / 2 + 0.12 + (W - 0.24) * i / n
            j = 0.01 * math.sin(i * 1.7 + r)
            for (dz, y) in ((-0.17, 0.0), (-0.07, 0.07 + j), (0.0, 0.085 + j), (0.07, 0.07 + j), (0.17, 0.0)):
                verts.append(V(x, y, z + dz))
        for i in range(n):
            for c in range(4):
                a = i * 5 + c
                faces.append((a, a + 1, a + 6, a + 5))
        k.mesh('dirt', verts, faces, uvscale=1.2)
    k.box('soil', W - 0.2, 0.01, D - 0.2, 0, 0, 0, uvscale=1.0)


def dry_wall(k, a, b, h=0.28):
    d = b - a
    L = d.length
    n = max(1, round(L / 0.14))
    ry = math.atan2(d.x, d.z)
    if k.lod:
        k.push((a.x + b.x) / 2, 0, (a.z + b.z) / 2, ry)
        k.box('stone', 0.18, h, L, 0, 0, 0, uvscale=2.0)
        k.pop()
        return
    for row in range(3):
        for i in range(n):
            t = (i + 0.5 + (0.5 if row % 2 else 0)) / n
            if t > 1:
                continue
            p = a + d * t
            k.cbox('stone', 0.15 - row * 0.02, h / 3 - 0.01, 0.13, p.x + (k.r() - 0.5) * 0.02, row * h / 3 + h / 6, p.z + (k.r() - 0.5) * 0.02,
                   ry=ry + math.pi / 2 + (k.r() - 0.5) * 0.25, rx=(k.r() - 0.5) * 0.2, uvscale=2.0)


def field_shelter(k, x, z, kind):
    k.push(x, 0, z)
    for (px, pz) in ((-0.3, -0.25), (0.3, -0.25), (-0.3, 0.25), (0.3, 0.25)):
        k.cyl('bark', 0.03, 0.026, 0.62 if pz > 0 else 0.7, px, 0, pz, seg=7)
    k.push(0, 0, 0, math.pi / 2)
    thatch_gable(k, 0.62, 0.62, 0.32, over=0.12, y=0.62, mat='thatchDark', gable='bark', gable_kind='wattle', res=0.06, thick=0.08)
    k.pop()
    # tools leaning on the shelter: hoe, rake, a basket
    if not k.lod:
        k.beam('wood', V(0.36, 0, 0.3), V(0.3, 0.6, 0.26), 0.022, round_=True)
        k.cbox('iron', 0.1, 0.02, 0.06, 0.37, 0.02, 0.33)
        k.beam('wood', V(0.4, 0, 0.18), V(0.33, 0.6, 0.2), 0.022, round_=True)
    k.cyl('weave', 0.09, 0.11, 0.13, -0.12, 0, 0.05, seg=12)
    if kind == 'tobacco':
        # leaves hung to cure on a rack
        for i in range(5):
            for j in range(4):
                k.cbox('leaf', 0.06, 0.14, 0.01, -0.22 + i * 0.11, 0.42, -0.1 + j * 0.08, ry=0.3 * j, rz=0.1)
        k.beam('wood', V(-0.3, 0.52, -0.1), V(0.3, 0.52, -0.1), 0.02, round_=True)
    elif kind == 'corn':
        # a slatted corn crib on stones
        for sx in (-1, 1):
            k.box('stone', 0.08, 0.08, 0.08, 0.12 * sx, 0, -0.1)
        k.box('planks', 0.34, 0.3, 0.2, 0, 0.08, -0.1, uvscale=1.4)
        k.box('soil', 0.3, 0.02, 0.16, 0, 0.38, -0.1)
    elif kind == 'sugar':
        # a small ox-mill of three upright rollers under a sweep
        for i in range(3):
            k.cyl('darkwood', 0.05, 0.05, 0.25, -0.06 + i * 0.06, 0, -0.1, seg=10)
        k.beam('wood', V(-0.4, 0.3, -0.1), V(0.4, 0.3, -0.1), 0.03, round_=True)
        k.cyl('planksDark', 0.12, 0.12, 0.1, 0.2, 0, 0.12, seg=10)
    else:
        # bunches and baskets of fruit
        for i in range(3):
            k.cyl('weave', 0.08, 0.1, 0.1, 0.12, 0, -0.12 + i * 0.12, seg=10)
            k.cyl('leaf' if kind == 'banana' else 'red', 0.065, 0.05, 0.05, 0.12, 0.1, -0.12 + i * 0.12, seg=8)
    k.pop()


def farm(k, kind):
    W, D = 3, 2
    furrows(k, W, D)
    # the walls run just inside the field's edge (stones ~0.15 across), so a neighbour's walls never meet them
    e = 0.12
    dry_wall(k, V(-W / 2 + e, 0, -D / 2 + e), V(W / 2 - e, 0, -D / 2 + e))
    dry_wall(k, V(-W / 2 + e, 0, -D / 2 + e), V(-W / 2 + e, 0, D / 2 - e))
    dry_wall(k, V(W / 2 - e, 0, -D / 2 + e), V(W / 2 - e, 0, D / 2 - 0.5))
    field_shelter(k, W / 2 - 0.45 - e, -D / 2 + 0.42 + e, kind)
    if kind == 'corn' and not k.lod:
        # a scarecrow in an old coat and a tricorn
        k.cyl('wood', 0.02, 0.02, 0.75, -0.6, 0, 0.0, seg=6)
        k.beam('wood', V(-0.82, 0.55, 0.0), V(-0.38, 0.55, 0.0), 0.02, round_=True)
        k.cbox('canvasRed', 0.26, 0.25, 0.1, -0.6, 0.47, 0.0)
        k.cyl('weave', 0.06, 0.06, 0.09, -0.6, 0.62, 0.0, seg=10)
        k.cyl('black', 0.12, 0.09, 0.03, -0.6, 0.7, 0.0, seg=3)
    k.cyl('planksDark', 0.12, 0.11, 0.24, -W / 2 + 0.25, 0, D / 2 - 0.2, seg=12)  # water butt
    return {'ao': 1024}


for _kind, _def in (('corn', 'corn_farm'), ('banana', 'banana_farm'), ('papaya', 'papaya_farm'), ('sugar', 'sugar_farm'), ('tobacco', 'tobacco_farm')):
    building(_def)(lambda k, _kind=_kind: farm(k, _kind))


# ------------------------------------------------------------------------------------------- crop plants
# single plants, instanced across the fields by the game (with per-plant colour variation)

def leaf(k, base, yaw, length, width, lift=0.9, droop=1.2, mat='leaf', n=7, twist=0.0):
    """an arching, tapered leaf blade with a folded midrib, rising at `lift` rad and drooping by `droop`"""
    if k.lod:
        n = 3
    verts, faces = [], []
    dirh = Vector((math.cos(yaw), 0, math.sin(yaw)))
    side = Vector((-math.sin(yaw), 0, math.cos(yaw)))
    p = Vector(base)
    for i in range(n + 1):
        t = i / n
        ang = lift - droop * t * t
        if i:
            p = p + (dirh * math.cos(ang) + Vector((0, math.sin(ang), 0))) * (length / n)
        w = width * math.sin(math.pi * min(1.0, t * 1.1 + 0.08)) * (1 - 0.3 * t)
        fold = Vector((0, 0.25 * w, 0))
        s = side * math.cos(twist * t) + Vector((0, math.sin(twist * t), 0))
        verts += [p - s * w + fold * 0.0, p + fold * 0.6, p + s * w + fold * 0.0]
    for i in range(n):
        a = i * 3
        faces += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2), (a, a + 1, a + 4, a + 3), (a + 1, a + 2, a + 5, a + 4)]
    k.mesh(mat, verts, faces, uvscale=2.0)


@building('plant_corn')
def plant_corn(k):
    k.cyl('crop', 0.014, 0.008, 0.7, 0, 0, 0, seg=6)
    for i in range(8):
        y = 0.1 + i * 0.075
        leaf(k, (0, y, 0), i * 2.4, 0.32 - i * 0.015, 0.03, lift=0.9, droop=1.6)
    for i in range(6):
        a = i * 1.05
        k.beam('weave', V(0, 0.7, 0), V(math.cos(a) * 0.05, 0.8, math.sin(a) * 0.05), 0.006, round_=True, seg=4)
    for (y, a) in ((0.38, 0.5), (0.3, 3.4)):
        k.push(0, y, 0, a, 0.5)
        k.cyl('weave', 0.022, 0.012, 0.12, 0.02, 0, 0, seg=7)
        k.pop()
    return {'ao': 256, 'ground': False}


@building('plant_sugarcane')
def plant_sugarcane(k):
    for j, (x, z, h) in enumerate(((0, 0, 0.95), (0.05, 0.03, 0.85), (-0.04, 0.04, 0.8), (0.02, -0.05, 0.9))):
        segs = 6
        for s in range(segs):
            k.cyl('crop' if s % 2 else 'bamboo', 0.014, 0.013, h / segs - 0.004, x, s * h / segs, z, seg=6)
        for i in range(4):
            leaf(k, (x, h * (0.6 + i * 0.1), z), j * 1.3 + i * 2.2, 0.38, 0.018, lift=1.1, droop=2.2)
    return {'ao': 256, 'ground': False}


@building('plant_tobacco')
def plant_tobacco(k):
    k.cyl('crop', 0.012, 0.008, 0.55, 0, 0, 0, seg=6)
    for i in range(9):
        y = 0.04 + i * 0.055
        leaf(k, (0, y, 0), i * 2.39, 0.24 - i * 0.017, 0.075 - i * 0.005, lift=0.5, droop=1.0)
    for i in range(7):
        a = i * 0.9
        k.cyl('canvasPurple' if i % 2 else 'red', 0.012, 0.004, 0.04, math.cos(a) * 0.035, 0.55, math.sin(a) * 0.035, seg=5)
    return {'ao': 256, 'ground': False}


@building('plant_banana')
def plant_banana(k):
    k.cyl('bark', 0.05, 0.035, 0.65, 0, 0, 0, seg=9)
    for i in range(7):
        leaf(k, (0, 0.6 + (i % 3) * 0.03, 0), i * 0.9, 0.55, 0.11, lift=1.0, droop=2.0, twist=0.4)
    # a hanging bunch of green bananas on its stalk
    k.beam('crop', V(0, 0.6, 0), V(0.1, 0.45, 0.02), 0.018, round_=True, seg=5)
    for r in range(4):
        for i in range(6):
            a = i / 6 * math.tau + r
            k.push(0.1 + math.cos(a) * 0.035, 0.42 - r * 0.045, 0.02 + math.sin(a) * 0.035, -a, 0.0, 0.5)
            k.cyl('leaf', 0.009, 0.006, 0.07, 0, 0, 0, seg=5)
            k.pop()
    k.cyl('canvasPurple', 0.02, 0.005, 0.06, 0.1, 0.18, 0.02, seg=6)  # the purple bell
    return {'ao': 256, 'ground': False}


@building('plant_papaya')
def plant_papaya(k):
    segs = 8
    for s in range(segs):
        k.cyl('bark', 0.035 - s * 0.002, 0.034 - s * 0.002, 0.11, 0, s * 0.11, 0, seg=8)
    for i in range(9):
        a = i * 2.4
        tip = V(math.cos(a) * 0.32, 0.88 + 0.06 * math.sin(i), math.sin(a) * 0.32)
        k.beam('crop', V(0, 0.86, 0), tip, 0.008, round_=True, seg=4)
        for j in range(5):
            leaf(k, tuple(tip), a + (j - 2) * 0.45, 0.13, 0.04, lift=0.2, droop=0.9, n=4)
    for i in range(7):
        a = i * 0.9
        k.push(math.cos(a) * 0.045, 0.72 - (i % 3) * 0.05, math.sin(a) * 0.045)
        k.cyl('plasterYellow' if i % 3 == 0 else 'leaf', 0.025, 0.02, 0.07, 0, 0, 0, seg=7)
        k.pop()
    return {'ao': 256, 'ground': False}
