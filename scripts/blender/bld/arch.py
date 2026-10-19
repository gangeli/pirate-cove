"""Architectural pieces for the building kit (game coordinates: y up, +z front, 1 unit = 1 tile ~ 2 m).

Walls are assembled from segments around their openings so doors and windows sit in real reveals.
Roofs are dense: thatch is a displaced, streaked surface with a ragged fringe; tile roofs are laid tile by tile.
"""
import math
from mathutils import Vector, Matrix, noise
from kit import Kit

FACES = ('front', 'back', 'left', 'right')


def V(x, y, z):
    return Vector((x, y, z))


class Op:
    """an opening in a wall face: x is the centre along the face as seen from outside"""
    def __init__(self, face, x, kind='window', w=None, h=None, y=None, shutters=True, bars=False):
        self.face, self.x, self.kind = face, x, kind
        self.w = w if w is not None else {'window': 0.3, 'door': 0.44, 'double': 0.66, 'arch': 0.6, 'hatch': 0.5}[kind]
        self.h = h if h is not None else {'window': 0.34, 'door': 0.9, 'double': 0.95, 'arch': 0.95, 'hatch': 0.4}[kind]
        self.y = y if y is not None else (0.4 if kind in ('window', 'hatch') else 0.0)
        self.shutters, self.bars = shutters, bars


def face_len(f, w, d, t):
    return w if f in ('front', 'back') else d - 2 * t


def wall_segments(L, h, ops):
    """rectangles (x0, x1, y0, y1) covering a face of length L, height h, minus openings"""
    ops = sorted(ops, key=lambda o: o.x)
    rects = []
    x = -L / 2
    for o in ops:
        a, b = o.x - o.w / 2, o.x + o.w / 2
        if a > x + 1e-4:
            rects.append((x, a, 0, h))
        if o.y > 0.01:
            rects.append((a, b, 0, o.y))
        top = o.y + o.h
        if top < h - 0.01:
            rects.append((a, b, top, h))
        x = b
    if x < L / 2 - 1e-4:
        rects.append((x, L / 2, 0, h))
    return rects


# ------------------------------------------------------------------------------------------- footings

def plinth(k: Kit, w, d, h=0.16, mat='stone', y0=0.0):
    """a rubble-stone footing: a mortar core with irregular coursed stones proud of every face"""
    if k.lod:
        k.box(mat, w + 0.03, h, d + 0.03, 0, y0, 0, uvscale=1.0)
        return
    k.box('stoneDark', w - 0.03, h - 0.01, d - 0.03, 0, y0, 0, uvscale=2.0)
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d)
        rows = max(1, round(h / 0.075))
        rh = h / rows
        for r in range(rows):
            x = -L / 2 + (0.05 if r % 2 else 0)
            while x < L / 2 - 0.03:
                sw = min(L / 2 - x, 0.09 + k.r() * 0.13)
                k.cbox(mat, sw - 0.012, rh - 0.014, 0.05 + k.r() * 0.025, x + sw / 2, y0 + r * rh + rh / 2, -0.012,
                       ry=(k.r() - 0.5) * 0.08, rx=(k.r() - 0.5) * 0.12, rz=(k.r() - 0.5) * 0.08, uvscale=2.0)
                x += sw
        k.pop()
    k.box(mat, w + 0.02, 0.025, d + 0.02, 0, y0 + h - 0.02, 0, uvscale=2.0)


def stilts(k: Kit, w, d, h, n=None):
    nx = n or max(2, round(w / 0.8) + 1)
    nz = max(2, round(d / 0.8) + 1)
    for i in range(nx):
        for j in range(nz):
            x = -w / 2 + 0.06 + (i / (nx - 1)) * (w - 0.12)
            z = -d / 2 + 0.06 + (j / (nz - 1)) * (d - 0.12)
            k.cyl('bark', 0.05, 0.045, h, x, 0, z, seg=8)
            k.cyl('stone', 0.08, 0.07, 0.06, x, 0, z, seg=7, bevel=0)


def deck(k: Kit, w, d, y, mat='planks', along='x', joists=True):
    """a plank floor at height y"""
    if k.lod:
        k.box(mat, w, 0.05, d, 0, y - 0.05, 0, uvscale=1.0, grain=1 if along == 'z' else 0)
        return
    if joists:
        n = max(2, round((d if along == 'x' else w) / 0.5) + 1)
        for i in range(n):
            o = -(d if along == 'x' else w) / 2 + 0.04 + (i / (n - 1)) * ((d if along == 'x' else w) - 0.08)
            if along == 'x':
                k.box('darkwood', w, 0.06, 0.06, 0, y - 0.1, o)
            else:
                k.box('darkwood', 0.06, 0.06, d, o, y - 0.1, 0)
    span = d if along == 'x' else w
    n = round(span / 0.1)
    for i in range(n):
        o = -span / 2 + (i + 0.5) * span / n
        j = (k.r() - 0.5) * 0.05
        if along == 'x':
            k.box(mat, w + j, 0.035, span / n - 0.008, j / 2, y - 0.04, o, uvscale=1.0, grain=0)
        else:
            k.box(mat, span / n - 0.008, 0.035, d + j, o, y - 0.04, j / 2, uvscale=1.0, grain=1)


def steps(k: Kit, x, z, w, rise, n=None, mat='planks'):
    n = n or max(1, round(rise / 0.09))
    for i in range(n):
        k.box(mat, w, rise * (i + 1) / n, 0.13, x, 0, z + (n - 1 - i) * 0.12, uvscale=1.0)


# ------------------------------------------------------------------------------------------- doors & windows

def door(k: Kit, x, w=0.44, h=0.9, y=0.0, depth=0.06, ajar=0.0, mat='planksDark', frame='darkwood', studs=False):
    """a ledged and braced plank door hung on strap hinges, set back in its opening"""
    if k.lod:
        k.box(mat, w, h, 0.03, x, y, -depth, uvscale=1.2, grain=1)
        k.box(frame, w + 0.12, h + 0.06, 0.02, x, y, -depth - 0.03)
        k.box('stoneDark', w + 0.18, 0.05, 0.16 + depth, x, 0, 0.02)
        return
    # dark interior
    k.box('black', w, h, 0.02, x, y, -depth - 0.03)
    # jambs and lintel
    k.box(frame, 0.06, h + 0.05, depth + 0.05, x - w / 2 - 0.02, y, -depth / 2 + 0.01)
    k.box(frame, 0.06, h + 0.05, depth + 0.05, x + w / 2 + 0.02, y, -depth / 2 + 0.01)
    k.box(frame, w + 0.16, 0.08, depth + 0.07, x, y + h, -depth / 2 + 0.015)
    k.push(x - w / 2 + 0.01, y, -depth, -ajar)
    n = max(3, round(w / 0.1))
    pw = (w - 0.02) / n
    for i in range(n):
        k.box(mat, pw - 0.006, h - 0.02 - (k.r() * 0.01), 0.035, (i + 0.5) * pw, 0.01, 0, uvscale=1.2, grain=1)
    for yy in (0.15, h * 0.5, h - 0.2):
        k.box(mat, w - 0.06, 0.07, 0.025, (w - 0.02) / 2, yy, 0.028, uvscale=1.2)
    k.beam(mat, V(0.06, 0.2, 0.03), V(w - 0.08, h * 0.5 - 0.02, 0.03), 0.05, 0.022)
    k.beam(mat, V(0.06, h * 0.5 + 0.07, 0.03), V(w - 0.08, h - 0.22, 0.03), 0.05, 0.022)
    for yy in (0.18, h - 0.17):
        k.box('iron', w * 0.62, 0.028, 0.012, w * 0.31, yy, 0.047)
        k.cyl('iron', 0.012, 0.012, 0.05, 0.0, yy - 0.01, 0.01, seg=6)
    k.torus('iron', 0.028, 0.006, w * 0.84, h * 0.5, 0.06, rx=math.pi / 2, seg=10)
    if studs:
        for i in range(n):
            for yy in (0.3, 0.6):
                k.cyl('iron', 0.008, 0.006, 0.012, (i + 0.5) * pw, h * yy, 0.035, seg=5, rx=math.pi / 2)
    k.pop()
    # stone threshold
    k.box('stoneDark', w + 0.18, 0.05, 0.16 + depth, x, 0, 0.02, uvscale=2.0)


def window(k: Kit, x, y, w=0.3, h=0.34, depth=0.06, shutters=True, bars=False, frame='darkwood', shutter_mat='planks'):
    """a casement window in a reveal: dark glazing (glows at night), frame, mullion and transom, sill,
    and plank shutters thrown open against the wall"""
    if k.lod:
        k.box('window', w, h, 0.01, x, y, -depth - 0.01)
        k.box(frame, w + 0.08, 0.04, 0.08, x, y - 0.04, 0.0)
        if shutters:
            for s in (-1, 1):
                k.box(shutter_mat, w / 2, h, 0.02, x + s * (w * 0.75 + 0.03), y, 0.012, uvscale=1.4, grain=1)
        return
    k.box('window', w, h, 0.01, x, y, -depth - 0.01)
    # frame in the reveal
    for s in (-1, 1):
        k.box(frame, 0.035, h, depth, x + s * (w / 2 - 0.0175), y, -depth / 2)
    k.box(frame, w, 0.035, depth, x, y + h - 0.035, -depth / 2)
    k.box(frame, w, 0.035, depth, x, y, -depth / 2)
    k.box(frame, 0.025, h, 0.03, x, y, -depth + 0.005)
    k.box(frame, w, 0.025, 0.03, x, y + h * 0.55, -depth + 0.005)
    # sill, projecting and sloped
    k.cbox(frame, w + 0.1, 0.04, 0.09, x, y - 0.015, 0.02, rx=0.12)
    if bars:
        for i in range(1, 4):
            k.cyl('iron', 0.008, 0.008, h, x - w / 2 + i * w / 4, y, -0.01, seg=5)
    if shutters:
        for s in (-1, 1):
            k.push(x + s * (w / 2 + 0.01), y, 0.005, s * -1.95)
            n = 3
            pw = (w / 2) / n
            for i in range(n):
                k.box(shutter_mat, pw - 0.005, h - 0.01 - k.r() * 0.01, 0.022, s * (i + 0.5) * pw, 0.005, 0, uvscale=1.4, grain=1)
            for yy in (h * 0.18, h * 0.72):
                k.box(shutter_mat, w / 2 - 0.02, 0.04, 0.014, s * w / 4, yy, 0.017, uvscale=1.4)
            k.box('iron', 0.06, 0.015, 0.01, s * 0.03, h * 0.2, 0.026)
            k.box('iron', 0.06, 0.015, 0.01, s * 0.03, h * 0.75, 0.026)
            k.pop()
        # shutter hold-backs
        for s in (-1, 1):
            k.cyl('iron', 0.006, 0.006, 0.05, x + s * (w + 0.06), y + h * 0.4, 0.0, seg=5, rx=math.pi / 2)


def hatch(k: Kit, x, y, w=0.5, h=0.4, depth=0.05):
    """a serving hatch with a propped flap (taverns, markets)"""
    k.box('black', w, h, 0.02, x, y, -depth - 0.02)
    k.cbox('planks', w + 0.12, 0.05, 0.22, x, y - 0.02, 0.06)  # counter
    k.push(x, y + h, 0.0, 0, -1.1)
    n = round(w / 0.1)
    for i in range(n):
        k.box('planks', w / n - 0.006, 0.02, h, -w / 2 + (i + 0.5) * w / n, 0, h / 2, uvscale=1.4, grain=1)
    k.pop()
    for s in (-1, 1):
        k.beam('wood', V(x + s * w / 2, y, 0.04), V(x + s * w / 2, y + h + 0.15, h * 0.85), 0.03, round_=True)


def opening(k: Kit, o: Op, depth):
    if o.kind == 'door':
        door(k, o.x, o.w, o.h, o.y, depth)
    elif o.kind == 'double':
        door(k, o.x - o.w / 4, o.w / 2, o.h, o.y, depth, ajar=0.4)
        door(k, o.x + o.w / 4, o.w / 2, o.h, o.y, depth)
    elif o.kind == 'window':
        window(k, o.x, o.y, o.w, o.h, depth, o.shutters, o.bars)
    elif o.kind == 'hatch':
        hatch(k, o.x, o.y, o.w, o.h, depth)
    elif o.kind == 'arch':
        arch(k, o.x, o.w, o.h, depth)


def arch(k: Kit, x, w, h, depth):
    """an open round-headed arch with voussoirs (the opening is cut square by the wall; the head is filled)"""
    r = w / 2
    k.box('black', w, h, 0.02, x, 0, -depth - 0.02)
    # spandrel fill above the curve (inside the square cut)
    n = 9
    for i in range(n + 1):
        a = math.pi * i / n
        cx, cy = x + math.cos(a) * (r + 0.04), h - r + math.sin(a) * (r + 0.04)
        k.cbox('stoneDark', 0.08, 0.11, depth + 0.04, cx, cy, -depth / 2, rz=a - math.pi / 2, uvscale=2.0)
    for s in (-1, 1):
        for j in range(round((h - r) / 0.16)):
            k.box('stoneDark', 0.1 if j % 2 else 0.07, 0.15, depth + 0.04, x + s * (r + 0.03), j * 0.16, -depth / 2, uvscale=2.0)


# ------------------------------------------------------------------------------------------- walls

def _faces(k, w, d, t, y0, ops, build_face):
    for f in FACES:
        L = face_len(f, w, d, t)
        k.face(f, w, d).push(0, y0, 0)
        build_face(f, L, [o for o in ops if o.face == f])
        k.pop().pop()


def solid_walls(k: Kit, w, d, h, mat, ops, t=0.08, y0=0.0, uvscale=0.5):
    """walls of a single material built around their openings (render, plaster, stone)"""
    def build(f, L, mine):
        for (x0, x1, a, b) in wall_segments(L, h, mine):
            k.box(mat, x1 - x0, b - a, t, (x0 + x1) / 2, a, -t / 2, uvscale=uvscale, wuv=True, bevel=0.0)
        for o in mine:
            opening(k, o, t * 0.7)
    _faces(k, w, d, t, y0, ops, build)
    # inner floor so nothing shows through doors
    k.box('dirt', w - 2 * t, 0.01, d - 2 * t, 0, y0, 0)


def plastered(k: Kit, w, d, h, render, ops, t=0.09, y0=0.0, quoins='stone', base='stoneDark'):
    """lime-rendered rubble walls with dressed quoins, a scuffed plinth band and stone surrounds"""
    solid_walls(k, w, d, h, render, ops, t, y0)
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d).push(0, y0, 0)
        if quoins and not k.lod:
            q = round(h / 0.15)
            for i in range(q):
                for s in (-1, 1):
                    long_ = (i + (1 if s > 0 else 0)) % 2 == 0
                    qw = 0.2 if long_ else 0.12
                    k.box(quoins, qw, 0.14, 0.02, s * (L / 2 - qw / 2 + 0.008), i * 0.15 + 0.005, 0.005, uvscale=2.0)
        if base:
            k.box(base, L + 0.02, 0.09, 0.02, 0, 0, 0.004, uvscale=2.0)
        for o in [o for o in ops if o.face == f]:
            if o.kind in ('window', 'door', 'double'):
                # dressed surround
                k.box(quoins or 'stone', o.w + 0.16, 0.07, 0.025, o.x, o.y + o.h, 0.01, uvscale=2.0)
                for s in (-1, 1):
                    k.box(quoins or 'stone', 0.06, o.h, 0.02, o.x + s * (o.w / 2 + 0.03), o.y, 0.006, uvscale=2.0)
        k.pop().pop()


def framed(k: Kit, w, d, h, infill, ops, t=0.08, y0=0.0, frame='darkwood'):
    """timber-framed walls: posts, sill and plate, studs, rails and braces over a recessed infill"""
    solid_walls(k, w, d, h, infill, ops, t, y0)
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d).push(0, y0, 0.012)
        mine = [o for o in ops if o.face == f]

        def clear(x0, x1, ya=0, yb=h):
            for o in mine:
                if x1 > o.x - o.w / 2 - 0.05 and x0 < o.x + o.w / 2 + 0.05 and yb > o.y - 0.04 and ya < o.y + o.h + 0.06:
                    return False
            return True
        k.box(frame, L + 0.04, 0.08, 0.06, 0, 0, -0.01)
        k.box(frame, L + 0.06, 0.09, 0.07, 0, h - 0.09, -0.01)
        for s in (-1, 1):
            k.box(frame, 0.09, h, 0.07, s * (L / 2 - 0.035), 0, -0.012)
        n = max(1, round(L / 0.5))
        for i in range(1, n):
            x = -L / 2 + i * L / n
            if clear(x - 0.03, x + 0.03):
                k.box(frame, 0.06, h - 0.16, 0.05, x, 0.08, -0.015)
            else:
                # studs stop at openings: frame the opening instead
                pass
        for o in mine:
            for s in (-1, 1):
                k.box(frame, 0.06, h - 0.16, 0.05, o.x + s * (o.w / 2 + 0.06), 0.08, -0.015)
            if o.kind == 'window':
                k.box(frame, o.w + 0.18, 0.05, 0.05, o.x, o.y - 0.08, -0.015)
            k.box(frame, o.w + 0.18, 0.05, 0.05, o.x, o.y + o.h + 0.06, -0.015)
        # mid rail and braces where the wall is clear
        for i in range(n):
            xa, xb = -L / 2 + i * L / n + 0.04, -L / 2 + (i + 1) * L / n - 0.04
            if clear(xa, xb, h * 0.45, h * 0.55):
                k.box(frame, xb - xa, 0.05, 0.045, (xa + xb) / 2, h * 0.48, -0.016)
        for s in (-1, 1):
            x0, x1 = s * (L / 2 - 0.08), s * (L / 2 - 0.08 - min(0.45, L * 0.22))
            if clear(min(x0, x1), max(x0, x1)):
                k.beam(frame, V(x0, 0.08, -0.016), V(x1, h - 0.1, -0.016), 0.05, 0.04)
        k.pop().pop()


def clapboard(k: Kit, w, d, h, mat, ops, t=0.07, y0=0.0, trim='darkwood'):
    """weatherboarded walls: overlapping horizontal boards with shadow lines, corner boards and trim"""
    def build(f, L, mine):
        for (x0, x1, a, b) in wall_segments(L, h, mine):
            k.box('planks' if k.lod and mat == 'planks' else ('oldplanks' if k.lod else 'planksDark'), x1 - x0, b - a, t - 0.02, (x0 + x1) / 2, a, -t / 2 - 0.01, wuv=k.lod, uvscale=1.2)
        rows = 0 if k.lod else max(3, round(h / 0.1))
        bh = h / max(1, rows)
        for r in range(rows):
            y = r * bh
            cuts = [(-L / 2, L / 2)]
            for o in mine:
                if y + bh <= o.y - 0.005 or y >= o.y + o.h + 0.005:
                    continue
                a, c = o.x - o.w / 2, o.x + o.w / 2
                cuts = [seg for (p, q) in cuts for seg in ([(p, q)] if c <= p or a >= q else [(p, a), (c, q)]) if seg[1] - seg[0] > 0.015]
            for (p, q) in cuts:
                k.cbox(mat, q - p, bh + 0.018, 0.022, (p + q) / 2, y + bh / 2, -0.005, rx=-0.11, uvscale=1.2)
        for s in (-1, 1):
            k.box(trim, 0.08, h, 0.035, s * (L / 2 - 0.02), 0, 0.012)
        k.box(trim, L + 0.06, 0.08, 0.04, 0, h - 0.08, 0.014)
        for o in mine:
            # casings
            for s in (-1, 1):
                k.box(trim, 0.05, o.h + 0.06, 0.03, o.x + s * (o.w / 2 + 0.025), o.y - 0.02, 0.012)
            k.box(trim, o.w + 0.16, 0.06, 0.04, o.x, o.y + o.h + 0.02, 0.014)
            opening(k, o, t * 0.8)
    _faces(k, w, d, t, y0, ops, build)
    k.box('dirt', w - 2 * t, 0.01, d - 2 * t, 0, y0, 0)


def board_batten(k: Kit, w, d, h, mat, ops, t=0.06, y0=0.0):
    """vertical boards with battens over the joints (sheds, shacks)"""
    def build(f, L, mine):
        for (x0, x1, a, b) in wall_segments(L, h, mine):
            k.box(mat if k.lod else 'planksDark', x1 - x0, b - a, t - 0.025, (x0 + x1) / 2, a, -t / 2 - 0.0125, grain=1, uvscale=1.2)
            if k.lod:
                continue
            n = max(1, round((x1 - x0) / 0.13))
            bw = (x1 - x0) / n
            for i in range(n):
                hh = b - a - (k.r() * 0.02 if b >= h - 0.01 else 0)
                k.box(mat, bw - 0.004, hh, 0.02, x0 + (i + 0.5) * bw, a, -0.003, uvscale=1.2, grain=1)
                if i:
                    k.box(mat, 0.03, hh, 0.014, x0 + i * bw, a, 0.012, uvscale=1.2, grain=1)
        for o in mine:
            opening(k, o, t * 0.7)
        k.box('wood', L + 0.04, 0.06, 0.04, 0, h - 0.06, 0.015)
    _faces(k, w, d, t, y0, ops, build)
    k.box('dirt', w - 2 * t, 0.01, d - 2 * t, 0, y0, 0)


def logs(k: Kit, w, d, h, ops, y0=0.0, r=0.06):
    """saddle-notched log walls with the ends running past the corners"""
    rows = round(h / (r * 1.75))
    k.box('planksDark', w - 2 * r, h, d - 2 * r, 0, y0, 0)
    for i in range(rows):
        y = y0 + r + i * r * 1.75
        along_x = i % 2 == 0
        for s in (-1, 1):
            f = ('front' if s > 0 else 'back') if along_x else ('right' if s > 0 else 'left')
            L = (w if along_x else d) + 0.24
            cuts = [(-L / 2, L / 2)]
            for o in [o for o in ops if o.face == f]:
                if y + r < y0 + o.y or y - r > y0 + o.y + o.h:
                    continue
                ox = -o.x if f in ('back', 'left') else o.x
                a, c = ox - o.w / 2, ox + o.w / 2
                cuts = [seg for (p, q) in cuts for seg in ([(p, q)] if c <= p or a >= q else [(p, a), (c, q)]) if seg[1] - seg[0] > 0.03]
            for (p, q) in cuts:
                rr = r * (0.9 + k.r() * 0.15)
                if along_x:
                    k.cyl('bark', rr, rr * 0.95, q - p, p, y, s * (d / 2 - r * 0.5), seg=9, rz=-math.pi / 2)
                else:
                    k.cyl('bark', rr, rr * 0.95, q - p, s * (w / 2 - r * 0.5), y, -p, seg=9, rx=-math.pi / 2, ry=0)
                # sawn end grain
    for f in FACES:
        k.face(f, w, d).push(0, y0, r * 0.4)
        for o in [o for o in ops if o.face == f]:
            opening(k, o, r)
        k.pop().pop()


# ------------------------------------------------------------------------------------------- roofs

def _slope_grid(k, mat, x0, x1, top_y, eave_y, z_top, z_eave, res, amp, streak, seed, fringe=0.12):
    """a displaced, streaked thatch surface between a ridge line and an eave line (+ ragged fringe)"""
    if k.lod:
        res, amp = res * 3, amp * 0.6
    nx = max(2, round((x1 - x0) / res))
    nz = max(2, round(math.hypot(top_y - eave_y, z_eave - z_top) / res))
    verts, faces = [], []
    sl = Vector((0, eave_y - top_y, z_eave - z_top))
    L = sl.length
    nrm = Vector((0, abs(z_eave - z_top), (top_y - eave_y) * (1 if z_eave > z_top else -1))).normalized()
    if z_eave < z_top:
        nrm = Vector((0, abs(z_eave - z_top), -(top_y - eave_y))).normalized()
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            p = Vector((x, top_y, z_top)) + sl * t
            # lumpy bundles + combed streaks running down the slope
            n1 = noise.noise(Vector((x * 3.0, t * L * 3.0, seed)))
            n2 = noise.noise(Vector((x * 38.0, t * L * 2.5, seed + 7)))
            disp = amp * (0.6 * n1 + 0.4 * n2 * streak)
            p = p + nrm * disp
            verts.append(p)
    flip = z_eave > z_top  # keep every face pointing up and out
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            q = (a, a + 1, a + nx + 2, a + nx + 1)
            faces.append(q[::-1] if flip else q)
    k.mesh(mat, verts, faces, uvscale=0.6)
    # ragged fringe hanging at the eave
    fv, ff = [], []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        base = Vector((x, eave_y, z_eave)) + nrm * amp * 0.3
        drop = fringe * (0.75 + 0.5 * abs(noise.noise(Vector((x * 23.0, seed, 3.3)))))
        fv.append(base)
        fv.append(base + Vector((0, -drop, (z_eave - z_top) / max(L, 1e-3) * 0.02)))
    for i in range(nx):
        a = i * 2
        q = (a, a + 2, a + 3, a + 1)
        ff.append(q[::-1] if flip else q)
    k.mesh(mat, fv, ff, uvscale=0.6)
    return nrm


def thatch_gable(k: Kit, w, d, rise, over=0.3, y=0.0, mat='thatch', gable='planksDark', res=0.05, thick=0.16, gable_kind='boards'):
    """a deep thatched gable roof: two displaced slopes with thickness, ragged eave fringe, rolled ridge,
    rafter feet and boarded (or wattle) gables"""
    # the thatch lies on rafters and is thick: its outer surface clears the wall plate by most of that
    y0 = y
    y = y + thick * 0.85
    hd = d / 2 + over
    hw = w / 2 + over * 0.6
    eave_y = y - over * rise / (d / 2)
    for s in (-1, 1):
        nrm = _slope_grid(k, mat, -hw, hw, y + rise + 0.02, eave_y, 0.0, s * hd, res, 0.035, 1.0, seed=s * 3.1, fringe=0.14)
        # underside and the thickness band along the eave and verges
        k.mesh('thatchDark', [V(-hw, y + rise - thick, 0), V(hw, y + rise - thick, 0), V(hw, eave_y - thick * 0.6, s * hd), V(-hw, eave_y - thick * 0.6, s * hd)],
               [(0, 1, 2, 3) if s > 0 else (0, 3, 2, 1)])
        for sx in (-1, 1):
            # verge: a thick rolled edge down each gable
            pts = 10
            for i in range(pts):
                t0, t1 = i / pts, (i + 1) / pts
                a = V(sx * hw, y + rise + (eave_y - y - rise) * t0, s * hd * t0)
                b = V(sx * hw, y + rise + (eave_y - y - rise) * t1, s * hd * t1)
                k.beam(mat, a + V(0, -thick * 0.45, 0), b + V(0, -thick * 0.45, 0), thick * 0.6, round_=True, seg=7)
        # rafter feet
        nr = 0 if k.lod else max(3, round(w / 0.4))
        ang = math.atan2(rise, d / 2)
        for i in range(nr + 1 if nr else 0):
            x = -w / 2 + 0.04 + i * (w - 0.08) / nr
            k.beam('darkwood', V(x, y0 - 0.02, s * (d / 2 - 0.05)), V(x, y0 - 0.02 - over * 0.8 * math.tan(ang), s * (d / 2 + over * 0.75)), 0.05)
    # ridge: a lumpy roll bound with withies
    seg = 1 if k.lod else max(6, round(2 * hw / 0.12))
    for i in range(seg):
        x0 = -hw - 0.03 + i * (2 * hw + 0.06) / seg
        x1 = x0 + (2 * hw + 0.06) / seg
        rr = 0.1 + 0.015 * noise.noise(Vector((x0 * 4, 1.7, 0.2)))
        k.beam(mat, V(x0, y + rise + 0.02, 0), V(x1 + 0.01, y + rise + 0.02, 0), rr * 2, round_=True, seg=9)
    for i in range(round(2 * hw / 0.3)):
        x = -hw + (i + 0.5) * 2 * hw / round(2 * hw / 0.3)
        k.torus('rope', 0.105, 0.008, x, y + rise + 0.02, 0, seg=10)
    gables(k, w, d, rise + thick * 0.85, y0, gable, gable_kind, barge=False)


def gables(k: Kit, w, d, rise, y, mat, kind='boards', barge=True):
    for s in (-1, 1):
        # triangle backing
        k.mesh(mat, [V(s * w / 2, y, -d / 2), V(s * w / 2, y, d / 2), V(s * w / 2, y + rise * 0.97, 0)], [(0, 1, 2) if s > 0 else (0, 2, 1)])
        if k.lod:
            pass
        elif kind == 'boards':
            n = round(d / 0.13)
            for i in range(n):
                z = -d / 2 + (i + 0.5) * d / n
                hh = rise * 0.97 * (1 - abs(z) / (d / 2)) - 0.02
                if hh > 0.04:
                    k.box(mat, 0.02, hh, d / n - 0.008, s * (w / 2 + 0.01), y, z, uvscale=1.2, grain=1)
            # a small louvre vent under the apex
            k.box('black', 0.02, 0.12, 0.16, s * (w / 2 + 0.022), y + rise * 0.45, 0)
            for j in range(3):
                k.cbox('planks', 0.03, 0.025, 0.18, s * (w / 2 + 0.03), y + rise * 0.45 + 0.025 + j * 0.035, 0, rz=s * 0.5)
        elif kind == 'wattle':
            n = round(d / 0.08)
            for i in range(n + 1):
                z = -d / 2 + i * d / n
                hh = rise * 0.97 * (1 - abs(z) / (d / 2))
                if hh > 0.03:
                    k.cyl('wood', 0.012, 0.012, hh, s * (w / 2 + 0.01), y, z, seg=5)
            m = round(rise / 0.05)
            for j in range(m):
                yy = y + j * 0.05 + 0.02
                half = (d / 2) * (1 - (yy - y) / (rise * 0.97)) - 0.02
                if half > 0.03:
                    k.beam('bamboo', V(s * (w / 2 + 0.02), yy, -half), V(s * (w / 2 + 0.02), yy, half), 0.025, round_=True, seg=5)
        # bargeboards
        for sz in ((-1, 1) if barge else ()):
            k.beam('darkwood', V(s * (w / 2 + 0.03), y - 0.02, sz * (d / 2 + 0.05)), V(s * (w / 2 + 0.03), y + rise + 0.02, 0), 0.06, 0.035)


def tile_gable(k: Kit, w, d, rise, over=0.22, y=0.0, gable='plaster', hip=False, tile_len=0.13, tile_w=0.08):
    """a Spanish barrel-tile roof laid course by course: pans and caps overlapping, mortared ridge,
    fascia and exposed rafter feet"""
    hd = d / 2 + over
    hw = w / 2 + over * (0.4 if not hip else 1.0)
    ang = math.atan2(rise, d / 2)
    slope = hd / math.cos(ang)
    eave_y = y - over * math.tan(ang)
    if k.lod:
        for s in (-1, 1):
            top, eave = V(0, y + rise + 0.04, 0), V(0, eave_y + 0.04, s * hd)
            k.mesh('tiles', [V(-hw, top.y, 0), V(hw, top.y, 0), V(hw, eave.y, eave.z), V(-hw, eave.y, eave.z)],
                   [(0, 3, 2, 1) if s > 0 else (0, 1, 2, 3)], uvscale=1.0)
            k.mesh('tiles', [V(-hw, top.y - 0.04, 0), V(hw, top.y - 0.04, 0), V(hw, eave.y - 0.06, eave.z), V(-hw, eave.y - 0.06, eave.z)],
                   [(0, 1, 2, 3) if s > 0 else (0, 3, 2, 1)], uvscale=1.0)
            k.beam('darkwood', V(-hw, eave_y - 0.03, s * (hd - 0.02)), V(hw, eave_y - 0.03, s * (hd - 0.02)), 0.07, 0.04)
        k.beam('terracotta', V(-hw, y + rise + 0.05, 0), V(hw, y + rise + 0.05, 0), 0.12, round_=True)
        if not hip:
            gables(k, w, d, rise, y, gable, 'plain')
        return
    for s in (-1, 1):
        # boarded underlay
        top, eave = V(0, y + rise, 0), V(0, eave_y, s * hd)
        k.mesh('planksDark', [V(-hw, top.y - 0.01, 0), V(hw, top.y - 0.01, 0), V(hw, eave.y - 0.01, eave.z), V(-hw, eave.y - 0.01, eave.z)],
               [(0, 3, 2, 1) if s > 0 else (0, 1, 2, 3)])
        k.mesh('planksDark', [V(-hw, top.y - 0.03, 0), V(hw, top.y - 0.03, 0), V(hw, eave.y - 0.03, eave.z), V(-hw, eave.y - 0.03, eave.z)],
               [(0, 1, 2, 3) if s > 0 else (0, 3, 2, 1)])
        cols = round(2 * hw / tile_w)
        rows = max(2, math.ceil(slope / (tile_len * 0.8)))
        dirv = (eave - top).normalized()
        nrm = Vector((0, math.cos(ang), s * math.sin(ang)))
        for c in range(cols):
            x = -hw + (c + 0.5) * 2 * hw / cols
            cap = c % 2 == 1
            for r in range(rows):
                t0 = min(slope - tile_len, r * tile_len * 0.8)
                p = top + dirv * (t0 + tile_len / 2) + V(x, 0, 0) + nrm * (0.03 if cap else 0.0)
                tl = tile_len * (1.0 + (k.r() - 0.5) * 0.04)
                _barrel_tile(k, p, dirv, nrm, tl, tile_w * (0.55 if cap else 0.6), cap, taper=0.12)
        # fascia and rafter feet
        k.beam('darkwood', V(-hw, eave_y - 0.03, s * (hd - 0.02)), V(hw, eave_y - 0.03, s * (hd - 0.02)), 0.07, 0.04)
        nr = max(3, round(w / 0.35))
        for i in range(nr + 1):
            xx = -w / 2 + 0.04 + i * (w - 0.08) / nr
            k.beam('darkwood', V(xx, y - 0.02, s * (d / 2 - 0.04)), V(xx, eave_y - 0.01, s * (hd - 0.06)), 0.045)
    # mortared ridge with a row of caps
    k.beam('plaster', V(-hw, y + rise + 0.02, 0), V(hw, y + rise + 0.02, 0), 0.14, 0.06)
    n = round(2 * hw / tile_len)
    for i in range(n):
        x = -hw + (i + 0.5) * 2 * hw / n
        _barrel_tile(k, V(x, y + rise + 0.065, 0), Vector((1, 0, 0)), Vector((0, 1, 0)), tile_len * 1.05, 0.075, True, taper=0.1)
    if not hip:
        gables(k, w, d, rise, y, gable, 'plain')
        # tile verges
        for sx in (-1, 1):
            for s in (-1, 1):
                k.beam('tiles', V(sx * hw, y + rise + 0.03, 0), V(sx * hw, eave_y + 0.03, s * hd), 0.08, 0.05)


def _barrel_tile(k, centre, along, up, length, radius, cap, taper=0.1, seg=6):
    """one curved clay tile: a half tube (convex up for caps, down for pans) with thickness"""
    side = along.cross(up).normalized()
    verts, faces = [], []
    th = 0.012
    for e in range(2):
        tt = (e - 0.5) * length
        rr = radius * (1 + (taper if e == 0 else -taper) * 0.5)
        for layer in range(2):
            r = rr - layer * th
            for i in range(seg + 1):
                a = math.pi * i / seg
                o = side * math.cos(a) * r + up * (math.sin(a) * r * (1 if cap else -1) * 0.7)
                verts.append(centre + along * tt + o)
    ring = seg + 1
    def idx(e, layer, i):
        return e * 2 * ring + layer * ring + i
    for i in range(seg):
        # a pan is a mirrored cap, which already flips its faces the right way
        faces.append((idx(0, 0, i), idx(1, 0, i), idx(1, 0, i + 1), idx(0, 0, i + 1)))
        faces.append((idx(0, 1, i), idx(0, 1, i + 1), idx(1, 1, i + 1), idx(1, 1, i)))
    for e in range(2):
        for i in range(seg):
            faces.append((idx(e, 0, i), idx(e, 0, i + 1), idx(e, 1, i + 1), idx(e, 1, i)))
    k.mesh('terracotta', verts, faces, uvscale=1.5)


def shingle_lean(k: Kit, w, depth, hi, lo, z0=0.0, mat='planks', rows=None):
    """a lean-to of overlapping wooden shingles falling toward +z"""
    L = math.hypot(depth, hi - lo)
    ang = math.atan2(hi - lo, depth)
    if k.lod:
        k.cbox(mat, w, 0.05, L + 0.06, 0, (hi + lo) / 2, z0 + depth / 2, rx=ang, uvscale=1.2)
        return
    rows = rows or max(2, round(L / 0.09))
    for r in range(rows):
        t = r / rows
        y = hi - (hi - lo) * t
        z = z0 + depth * t
        n = max(2, round(w / 0.12))
        for i in range(n):
            sw = w / n
            k.cbox(mat, sw - 0.006, 0.018, L / rows * 1.6, -w / 2 + (i + 0.5) * sw + (r % 2) * sw * 0.5 * 0, y - 0.01, z + L / rows * 0.6,
                   rx=ang + 0.05, uvscale=1.5)
    for i in range(max(2, round(w / 0.5)) + 1):
        xx = -w / 2 + 0.04 + i * (w - 0.08) / max(2, round(w / 0.5))
        k.beam('darkwood', V(xx, hi - 0.06, z0), V(xx, lo - 0.06, z0 + depth), 0.05)


def thatch_cone(k: Kit, r, rise, y=0.0, mat='thatch', res=0.06):
    """a conical thatch for round huts: displaced surface with a fringe and a finial"""
    if k.lod:
        res *= 3
    rings = max(4, round(math.hypot(r, rise) / res))
    segs = max(12, round(2 * math.pi * r / res))
    verts, faces = [], []
    for j in range(rings + 1):
        t = j / rings
        for i in range(segs):
            a = 2 * math.pi * i / segs
            rr = r * t
            disp = 0.03 * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, t * 4))) + 0.015 * noise.noise(Vector((a * 9, t * 2, 4.0)))
            verts.append(V(math.cos(a) * (rr + disp), y + rise * (1 - t) + disp * 0.5, math.sin(a) * (rr + disp)))
    for j in range(rings):
        for i in range(segs):
            a = j * segs + i
            b = j * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    k.mesh(mat, verts, faces, uvscale=0.6)
    fv, ff = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        drop = 0.12 + 0.06 * abs(noise.noise(Vector((a * 7, 1.1, 0.5))))
        fv.append(V(math.cos(a) * r, y, math.sin(a) * r))
        fv.append(V(math.cos(a) * r * 1.01, y - drop, math.sin(a) * r * 1.01))
    for i in range(segs):
        a, b = i * 2, ((i + 1) % segs) * 2
        ff.append((a, a + 1, b + 1, b))
    k.mesh(mat, fv, ff, uvscale=0.6)
    k.cyl('thatchDark', 0.09, 0.02, 0.22, 0, y + rise - 0.05, 0, seg=8)
    k.torus('rope', 0.07, 0.01, 0, y + rise + 0.02, 0, seg=10)


# ------------------------------------------------------------------------------------------- dressing

def chimney(k: Kit, x, z, base_y, h, s=0.3):
    """a coursed rubble stack with a dressed cap and a sooty flue (marks smoke)"""
    rows = 1 if k.lod else round(h / 0.09)
    for i in range(rows):
        t = i / rows
        sz = s * (1 - 0.12 * t)
        for (dx, dz, ww, dd) in ((0, 0, sz, sz),):
            if k.lod:
                k.box('stone', s, h, s, x, base_y, z, uvscale=2.0)
            else:
                k.box('stone', ww + (k.r() - 0.5) * 0.025, 0.088, dd + (k.r() - 0.5) * 0.025, x + dx, base_y + i * 0.09, z + dz, ry=(k.r() - 0.5) * 0.05, uvscale=2.0)
    top = base_y + (h if k.lod else rows * 0.09)
    k.box('stoneDark', s * 1.05, 0.05, s * 1.05, x, top, z, uvscale=2.0)
    k.box('black', s * 0.5, 0.012, s * 0.5, x, top + 0.045, z)
    k.marker('smoke', x, top + 0.1, z)


def cask(k: Kit, x, z, s=1.0, y=0.0, ry=0.0, lying=False):
    """an oak cask: bulged staves (as a lathe), heads, four iron hoops"""
    h = 0.36 * s
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(((0.12 + math.sin(t * math.pi) * 0.032) * s, t * h))
    seg = 16
    verts, faces = [], []
    for (r, yy) in pts:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            # stave facets: a slight inset at every stave joint
            rr = r * (0.985 if i % 2 else 1.0)
            verts.append(V(math.cos(a) * rr, yy, math.sin(a) * rr))
    for j in range(len(pts) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    top0 = len(verts)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        verts.append(V(math.cos(a) * pts[-1][0] * 0.93, h - 0.012 * s, math.sin(a) * pts[-1][0] * 0.93))
    faces.append(tuple(range(top0, top0 + seg))[::-1])
    local = Matrix.Translation((x, y + (0.15 * s if lying else 0), z)) @ Matrix.Rotation(ry, 4, 'Y') @ (Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Translation((0, -h / 2, 0)) if lying else Matrix.Identity(4))
    k.mesh('planksDark', verts, faces, uvscale=1.2, local=local)
    for t in (0.1, 0.27, 0.73, 0.9):
        r = (0.12 + math.sin(t * math.pi) * 0.032) * s + 0.004
        k.push()
        k.stack[-1] = k.stack[-1] @ local
        k.torus('iron', r, 0.007 * s, 0, t * h, 0, seg=16, rseg=3)
        k.pop()


def crate(k: Kit, x, y, z, s=0.3, ry=0.0):
    if k.lod:
        k.box('oldplanks', s, s, s, x, y, z, ry=ry, uvscale=1.6)
        return
    k.push(x, y, z, ry)
    k.box('oldplanks', s * 0.92, s * 0.92, s * 0.92, 0, s * 0.04, 0, uvscale=1.6)
    for f in FACES:
        k.face(f, s, s)
        for yy in (0.0, 0.45, 0.9):
            k.box('planks', s, s * 0.1, 0.014, 0, s * yy, 0.004, uvscale=1.6)
        k.beam('planks', V(-s * 0.42, s * 0.1, 0.006), V(s * 0.42, s * 0.86, 0.006), s * 0.09, 0.014)
        k.pop()
    k.pop()


def sack(k: Kit, x, z, s=1.0, ry=0.0):
    verts, faces = [], []
    seg, rings = 10, 6
    for j in range(rings + 1):
        t = j / rings
        r = (0.13 + 0.05 * math.sin(t * math.pi * 0.9) - (0.08 if t > 0.85 else 0)) * s
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr = r * (1 + 0.08 * math.sin(a * 3 + j))
            verts.append(V(math.cos(a) * rr * 1.15, t * 0.32 * s, math.sin(a) * rr * 0.85))
    for j in range(rings):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    faces.append(tuple(range(seg))[::-1])
    local = Matrix.Translation((x, 0, z)) @ Matrix.Rotation(ry, 4, 'Y')
    k.mesh('weave', verts, faces, uvscale=1.5, local=local)


def rope_coil(k: Kit, x, z, r=0.13):
    if k.lod:
        return
    for i in range(3):
        k.torus('rope', r - i * 0.028, 0.015, x, 0.015 + i * 0.024, z, seg=16, rseg=4)


def lantern(k: Kit, x, y, z=0.0):
    """a ship's lantern on a wrought bracket (glass glows at night)"""
    if k.lod:
        k.box('window', 0.07, 0.1, 0.07, x, y - 0.2, z + 0.21)
        return
    k.box('iron', 0.022, 0.022, 0.22, x, y, z + 0.11)
    k.beam('iron', V(x, y - 0.15, z + 0.01), V(x, y, z + 0.18), 0.014)
    k.box('iron', 0.01, 0.05, 0.01, x, y - 0.05, z + 0.21)
    k.cyl('iron', 0.05, 0.02, 0.05, x, y - 0.09, z + 0.21, seg=8)
    k.box('window', 0.07, 0.1, 0.07, x, y - 0.2, z + 0.21)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('iron', 0.008, 0.11, 0.008, x + sx * 0.036, y - 0.205, z + 0.21 + sz * 0.036)
    k.box('iron', 0.08, 0.015, 0.08, x, y - 0.215, z + 0.21)


def hanging_sign(k: Kit, x, y, z, label):
    """a board hung from an iron arm by chains; the painted face is added by the game (marker)"""
    k.box('iron', 0.025, 0.025, 0.5, x, y, z + 0.25)
    k.beam('iron', V(x, y - 0.2, z + 0.01), V(x, y, z + 0.34), 0.016)
    for zz in (0.13, 0.41):
        for i in range(4):
            k.torus('iron', 0.012, 0.003, x, y - 0.02 - i * 0.022, z + zz, rx=(i % 2) * math.pi / 2, seg=6, rseg=3)
    k.box('darkwood', 0.035, 0.2, 0.42, x, y - 0.3, z + 0.27)
    k.marker('sign:' + label, x, y - 0.2, z + 0.27)


def fence(k: Kit, x0, z0, x1, z1, h=0.42, mat='oldplanks'):
    a, b = V(x0, 0, z0), V(x1, 0, z1)
    L = (b - a).length
    n = max(1, round(L / 0.55))
    for i in range(n + 1):
        p = a + (b - a) * (i / n)
        k.cyl('bark', 0.035, 0.03, h + k.r() * 0.04, p.x, 0, p.z, seg=7)
    for yy in (h * 0.35, h * 0.8):
        k.beam(mat, a + V(0, yy, 0), b + V(0, yy, 0), 0.04, 0.025)


def front_porch(k: Kit, w, depth, h, z0, roof='planksDark'):
    """a raised plank porch across the front: deck on joists, posts with knee braces, a rail with
    balusters (open in the middle for the steps) and a shingled lean-to tucked under the eave"""
    k.push(0, 0, z0 + depth / 2)
    deck(k, w, depth, 0.1, 'planks', along='x', joists=True)
    k.pop()
    n = max(2, round(w / 0.7) + 1)
    xs = [-w / 2 + 0.05 + i * (w - 0.1) / (n - 1) for i in range(n)]
    zf = z0 + depth - 0.05
    for x in xs:
        k.box('wood', 0.07, h - 0.1, 0.07, x, 0.1, zf)
        for s in (-1, 1):
            if -w / 2 < x + s * 0.2 < w / 2:
                k.beam('wood', V(x, h - 0.28, zf), V(x + s * 0.18, h - 0.08, zf), 0.04)
    for i in range(n - 1):
        a, b = xs[i], xs[i + 1]
        if a < 0 < b:
            continue  # gap for the steps
        k.box('wood', b - a, 0.04, 0.05, (a + b) / 2, 0.42, zf)
        m = max(2, round((b - a) / 0.1))
        for j in range(1, m):
            k.box('wood', 0.025, 0.3, 0.025, a + (b - a) * j / m, 0.1, zf)
    k.box('darkwood', w + 0.06, 0.08, 0.08, 0, h - 0.08, zf)
    shingle_lean(k, w + 0.16, depth + 0.1, h + 0.16, h - 0.04, z0=z0 - 0.02, mat=roof)
