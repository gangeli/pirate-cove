"""Control, defence and training buildings: stockade, gallows, interrogation chamber, fort, watch tower,
protective cannon, the five schools, observatory and the harbour anchor.

Shared military props live here too (naval guns on truck carriages, shot, palisade logs, chains, racks)."""
import math
from mathutils import Vector, Matrix
from defs import building
from arch import *
from arch import _slope_grid


# ------------------------------------------------------------------------------------------- helpers

def frame_along(k, p, d):
    """push a frame at p whose +y runs along d"""
    q = Vector((0, 1, 0)).rotation_difference(Vector(d).normalized())
    k.stack.append(k.top @ (Matrix.Translation(Vector(p)) @ q.to_matrix().to_4x4()))
    return k


def lathe(k, mat, prof, seg=16, cap0=True, cap1=True, uvscale=1.0, yoff=0.0, bevel=0.0):
    """a turned solid about local y from a profile of (radius, y) pairs, bottom to top"""
    if k.lod:
        seg = max(6, seg // 2)
    verts, faces = [], []
    for (r, y) in prof:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(V(math.cos(a) * r, y + yoff, math.sin(a) * r))
    for j in range(len(prof) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    if cap0:
        faces.append(tuple(range(seg)))
    if cap1:
        n = (len(prof) - 1) * seg
        faces.append(tuple(range(n, n + seg))[::-1])
    k.mesh(mat, verts, faces, uvscale=uvscale, bevel=bevel)


def sphere(k, mat, r, x, y, z, seg=10, rings=6, squash=1.0):
    if k.lod:
        rings = max(3, rings // 2)
    prof = []
    for j in range(rings + 1):
        t = j / rings
        a = -math.pi / 2 + math.pi * t
        prof.append((max(r * 0.05, math.cos(a) * r), math.sin(a) * r * squash))
    k.push(x, y, z)
    lathe(k, mat, prof, seg=seg)
    k.pop()


def chain(k, pts, link=0.022, wire=0.0055, mat='iron'):
    """a chain of round links along a polyline (vanishes in the LOD)"""
    if k.lod:
        return
    n_done = 0
    for a, b in zip(pts[:-1], pts[1:]):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        n = max(1, round(L / (link * 1.55)))
        for i in range(n):
            p = a + (b - a) * ((i + 0.5) / n)
            frame_along(k, p, b - a)
            k.push(0, 0, 0, (n_done % 2) * math.pi / 2)
            k.stack[-1] = k.stack[-1] @ Matrix.Diagonal((0.78, 1.3, 1, 1))
            k.torus(mat, link * 0.6, wire, 0, 0, 0, rx=math.pi / 2, seg=10, rseg=3)
            k.pop().pop()
            n_done += 1


def hang(a, b, sag, n=8):
    """points of a rope or chain hanging between a and b"""
    a, b = Vector(a), Vector(b)
    return [a + (b - a) * (i / n) - Vector((0, sag * math.sin(math.pi * i / n), 0)) for i in range(n + 1)]


def rope_line(k, pts, w=0.014):
    for a, b in zip(pts[:-1], pts[1:]):
        k.beam('rope', a, b, w, round_=True, seg=5)


def stake(k, x, z, h, r, lean=(0.0, 0.0), mat='bark', point=True, sink=0.06):
    """a palisade log: barked trunk, sharpened to a cut point (pale wood showing)"""
    k.push(x, -sink, z, 0, lean[0], lean[1])
    tip = r * 2.4 if point else 0.0
    seg = 8
    k.cyl(mat, r, r * 0.94, h + sink - tip, 0, 0, 0, seg=seg)
    if point:
        k.cyl('wood', r * 0.94, r * 0.12, tip, 0, h + sink - tip, 0, seg=seg, caps=True)
    else:
        k.cyl('planks', r * 0.92, r * 0.92, 0.008, 0, h + sink, 0, seg=seg)
    k.pop()


def palisade(k, a, b, h=1.32, r=0.075, inside=None, bands=(0.32, 0.78), rails=True, skip=None):
    """a run of individually set, sharpened logs, lashed with rope bands outside and pinned to
    split-log ribbands inside"""
    a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
    d = b - a
    L = d.length
    t = d.normalized()
    nrm = Vector((-t.z, 0, t.x))  # left of the run
    if inside is not None and nrm.dot(Vector((inside[0], 0, inside[1])) - a) < 0:
        nrm = -nrm
    n = max(1, round(L / (2 * r * 1.04)))
    tops = []
    for i in range(n):
        p = a + d * ((i + 0.5) / n)
        rr = r * (0.82 + k.r() * 0.32)
        hh = h * (0.93 + k.r() * 0.12)
        tops.append(rr)
        if k.lod and i % 2:
            continue
        stake(k, p.x, p.z, hh, rr * (1.0 if not k.lod else 1.9), lean=((k.r() - 0.5) * 0.03, (k.r() - 0.5) * 0.03), point=True)
    if k.lod:
        # a solid core so the thinned-out logs still read as a closed wall
        frame_along(k, (a + b) / 2 + V(0, h * 0.42, 0), t)
        k.cbox('bark', r * 1.6, L, r * 1.6, 0, 0, 0)
        k.pop()
        return
    # rope bands round the outside, ribbands within, and a lashing turn round every other log
    for yb in bands:
        y = h * yb
        out = -nrm * (r * 0.92)
        k.beam('rope', a + out + V(0, y, 0), b + out + V(0, y - 0.01, 0), 0.018, round_=True, seg=5)
        if rails:
            k.beam('wood', a + nrm * (r + 0.03) + V(0, y - 0.03, 0), b + nrm * (r + 0.03) + V(0, y - 0.03, 0), 0.07, 0.05)
    for i in range(0, n, 2):
        p = a + d * ((i + 0.5) / n)
        for yb in bands:
            k.push(p.x, h * yb - 0.012, p.z)
            k.torus('rope', tops[i] * 0.95 + 0.01, 0.012, 0, 0, 0, seg=8, rseg=3)
            k.torus('rope', tops[i] * 0.95 + 0.01, 0.012, 0, 0.022, 0, seg=8, rseg=3)
            k.pop()


def flame(k, x, y, z, r=0.04, h=0.1):
    """a static flame (the 'fire' material glows)"""
    k.cyl('fire', r, r * 0.15, h, x, y, z, seg=7)
    if not k.lod:
        k.cyl('fire', r * 0.6, r * 0.1, h * 0.7, x + r * 0.5, y, z + r * 0.3, seg=6, rz=-0.3)


def embers(k, x, y, z, r=0.12):
    """a bed of glowing coals with a few low flames"""
    k.cyl('fire', r, r * 0.85, 0.025, x, y, z, seg=10)
    if not k.lod:
        for i in range(5):
            a = i / 5 * math.tau + 0.4
            sphere(k, 'black', r * 0.22, x + math.cos(a) * r * 0.55, y + 0.025, z + math.sin(a) * r * 0.55, seg=6, rings=3, squash=0.6)
        for i in range(3):
            a = i / 3 * math.tau
            flame(k, x + math.cos(a) * r * 0.3, y + 0.02, z + math.sin(a) * r * 0.3, r * 0.3, r * 0.9)


def iron_bands(k, x, z, r, ys):
    for y in ys:
        k.torus('iron', r + 0.004, 0.006, x, y, z, seg=12, rseg=3)


def lean_to(k, w, depth, hi, lo, mat='thatchDark', posts='bark', seed=1.0):
    """palm thatch on rough poles, high against a wall at -z and falling toward +z"""
    _slope_grid(k, mat, -w / 2, w / 2, hi, lo, -depth / 2, depth / 2, 0.06, 0.03, 1.0, seed=seed, fringe=0.1)
    n = max(2, round(w / 0.6))
    for i in range(n + 1):
        x = -w / 2 + 0.06 + i * (w - 0.12) / n
        k.beam(posts, V(x, hi - 0.05, -depth / 2 + 0.02), V(x, lo - 0.05, depth / 2 - 0.05), 0.045, round_=True)
    k.beam(posts, V(-w / 2, lo - 0.07, depth / 2 - 0.1), V(w / 2, lo - 0.07, depth / 2 - 0.1), 0.05, round_=True)
    k.beam(posts, V(-w / 2, hi - 0.07, -depth / 2 + 0.05), V(w / 2, hi - 0.07, -depth / 2 + 0.05), 0.05, round_=True)
    for i in range(n // 2 + 1):
        x = -w / 2 + 0.08 + i * (w - 0.16) / max(1, n // 2)
        k.cyl(posts, 0.032, 0.028, lo - 0.05, x, 0, depth / 2 - 0.1, seg=7)
        k.cyl(posts, 0.032, 0.028, hi - 0.05, x, 0, -depth / 2 + 0.05, seg=7)


def ladder(k, a, b, w=0.26, step=0.16, mat='wood'):
    a, b = Vector(a), Vector(b)
    d = b - a
    side = Vector((1, 0, 0)) if abs(d.normalized().x) < 0.7 else Vector((0, 0, 1))
    side = (side - d.normalized() * side.dot(d.normalized())).normalized()
    for s in (-1, 1):
        k.beam(mat, a + side * s * w / 2, b + side * s * w / 2, 0.04, 0.03)
    n = max(2, int(d.length / step))
    for i in range(1, n):
        p = a + d * (i / n)
        k.beam(mat, p - side * (w / 2 + 0.015), p + side * (w / 2 + 0.015), 0.025, round_=True, seg=5)


def torch_post(k, x, z, h=0.9):
    k.cyl('bark', 0.03, 0.025, h, x, 0, z, seg=6)
    k.cyl('iron', 0.04, 0.03, 0.06, x, h - 0.02, z, seg=7)
    k.cyl('black', 0.035, 0.03, 0.04, x, h + 0.03, z, seg=7)
    flame(k, x, h + 0.06, z, 0.035, 0.1)


# ------------------------------------------------------------------------------------------- ordnance

GUN = [  # (radius, y) of a 6-pounder iron gun, breech (cascabel) at 0
    (0.012, -0.115), (0.03, -0.108), (0.036, -0.095), (0.034, -0.082), (0.02, -0.072), (0.02, -0.055), (0.05, -0.045),
    (0.08, -0.03), (0.098, -0.012), (0.106, 0.0), (0.106, 0.03), (0.1, 0.036), (0.097, 0.3), (0.104, 0.306), (0.104, 0.322),
    (0.092, 0.33), (0.089, 0.5), (0.095, 0.505), (0.095, 0.52), (0.082, 0.528), (0.069, 0.83), (0.075, 0.836), (0.075, 0.848),
    (0.068, 0.856), (0.071, 0.89), (0.082, 0.925), (0.085, 0.94), (0.085, 0.952), (0.044, 0.955), (0.04, 0.9)]


def gun_barrel(k, elev=0.04, trunnions=True, mat='iron'):
    """the barrel in the current frame: trunnion axis on x at the origin, muzzle toward +z"""
    k.push(0, 0, 0, 0, math.pi / 2 - elev)
    lathe(k, mat, GUN, seg=18, cap0=True, cap1=True, yoff=-0.42)
    k.cyl('black', 0.039, 0.039, 0.004, 0, 0.902 - 0.42, 0, seg=10)
    if not k.lod:
        # vent with its lead apron, and the reinforce ring mouldings already in the profile
        k.cbox('iron', 0.06, 0.07, 0.01, 0, 0.05 - 0.42 + 0.04, 0.104, rx=0.0)
        k.cyl('black', 0.006, 0.006, 0.012, 0, 0.06 - 0.42, 0.1, seg=5, rx=math.pi / 2)
    k.pop()
    if trunnions:
        k.beam(mat, V(-0.15, 0, 0), V(0.15, 0, 0), 0.064, round_=True, seg=10)
        k.beam(mat, V(-0.105, 0, 0), V(0.105, 0, 0), 0.1, round_=True, seg=12)


def gun(k, x, z, ry=0.0, y=0.0, elev=0.04, run_out=True, tackle=True, s=1.0):
    """a naval gun on a four-truck carriage: stepped cheeks, axletrees, trucks, bed and quoin,
    capsquares over the trunnions, ring bolts and the breeching rope; muzzle toward local +z"""
    k.push(x, y, z, ry)
    if s != 1.0:
        k.stack[-1] = k.stack[-1] @ Matrix.Scale(s, 4)
    if k.lod:
        for (az, r) in ((0.14, 0.095), (-0.29, 0.085)):
            k.cyl('wood', r, r, 0.42, 0.21, r, az, seg=6, rz=math.pi / 2)
        k.box('wood', 0.28, 0.2, 0.62, 0, 0.12, -0.08)
        k.push(0, 0.337, 0.1, 0, math.pi / 2 - elev)
        k.cyl('iron', 0.104, 0.075, 0.95, 0, -0.43, 0, seg=7)
        k.pop()
        k.pop()
        return
    # axletrees and trucks
    for (az, r) in ((0.14, 0.095), (-0.29, 0.085)):
        k.cbox('wood', 0.42, 0.07, 0.08, 0, r, az)
        for s in (-1, 1):
            k.cyl('wood', r, r, 0.05, s * 0.18 + 0.025, r, az, seg=14, rz=math.pi / 2)
            k.cyl('darkwood', 0.03, 0.03, 0.022, s * 0.2 + 0.011 + s * 0.012, r, az, seg=8, rz=math.pi / 2)
            if not k.lod:
                k.cbox('iron', 0.008, 0.035, 0.008, s * 0.222, r + 0.02, az)
    # stepped cheeks
    steps_ = ((-0.04, 0.25, 0.335), (-0.17, -0.04, 0.29), (-0.29, -0.17, 0.245), (-0.43, -0.29, 0.2))
    for s in (-1, 1):
        for (z0, z1, top) in steps_:
            k.box('wood', 0.05, top - 0.12, z1 - z0 + 0.002, s * 0.115, 0.12, (z0 + z1) / 2, uvscale=1.4)
        if not k.lod:
            # capsquare over the trunnion, ring bolts and eye bolts on the cheek face
            k.cbox('iron', 0.056, 0.018, 0.095, s * 0.115, 0.375, 0.1)
            for zz in (0.06, 0.14):
                k.cyl('iron', 0.009, 0.009, 0.012, s * 0.115, 0.384, zz, seg=6)
            for zz in (0.2, -0.36):
                k.torus('iron', 0.02, 0.005, s * 0.143, 0.2, zz, rx=0, seg=8, rseg=3)
                k.cyl('iron', 0.009, 0.009, 0.012, s * 0.146, 0.2, zz, seg=6, rz=math.pi / 2)
    k.cbox('wood', 0.18, 0.09, 0.06, 0, 0.2, 0.2)  # transom
    k.box('planks', 0.18, 0.03, 0.46, 0, 0.13, -0.17, uvscale=1.4)  # bed
    k.cbox('darkwood', 0.12, 0.05, 0.16, 0, 0.183, -0.28, rx=-0.12)  # quoin
    k.cbox('darkwood', 0.05, 0.03, 0.04, 0, 0.17, -0.37)  # quoin handle
    # barrel
    k.push(0, 0.337, 0.1)
    gun_barrel(k, elev)
    k.pop()
    if tackle and not k.lod:
        # breeching rope from the cheek ring bolts round the cascabel neck
        cz = 0.1 - 0.42 - 0.062
        rope_line(k, [V(-0.143, 0.2, 0.2), V(-0.16, 0.24, 0.0), V(-0.12, 0.3, -0.2), V(-0.03, 0.31, cz), V(0.03, 0.31, cz), V(0.12, 0.3, -0.2), V(0.16, 0.24, 0.0), V(0.143, 0.2, 0.2)], 0.018)
    k.pop()


def shot_pile(k, x, z, n=3, r=0.034, ry=0.0):
    """round shot stacked in a square pyramid on a plank"""
    if k.lod:
        k.cyl('iron', n * r * 1.1, r * 0.3, n * r * 1.5, x, 0, z, seg=4, ry=ry + math.pi / 4)
        return
    k.push(x, 0, z, ry)
    k.box('planksDark', n * 2 * r + 0.04, 0.02, n * 2 * r + 0.04, 0, 0, 0)
    y = 0.02 + r
    for layer in range(n):
        m = n - layer
        for i in range(m):
            for j in range(m):
                sphere(k, 'iron', r, (i - (m - 1) / 2) * 2 * r, y, (j - (m - 1) / 2) * 2 * r, seg=11, rings=7)
        y += r * 1.414
    k.pop()


def powder_keg(k, x, z, s=0.6, y=0.0, ry=0.0, lying=False):
    cask(k, x, z, s, y=y, ry=ry, lying=lying)


def rammer(k, a, b, head='canvas'):
    """a rammer or sponge: a long staff with a wooden head"""
    a, b = Vector(a), Vector(b)
    k.beam('wood', a, b, 0.022, round_=True, seg=6)
    d = (b - a).normalized()
    k.beam(head, b - d * 0.01, b + d * 0.09, 0.07, round_=True, seg=8)


def musket(k, p, d, up=(0, 1, 0)):
    """a flintlock musket from butt p along d (length ~0.75)"""
    p, d = Vector(p), Vector(d).normalized()
    upv = Vector(up)
    upv = (upv - d * upv.dot(d)).normalized()
    k.beam('darkwood', p, p + d * 0.16 + upv * 0.012, 0.03, 0.055)  # butt
    k.beam('darkwood', p + d * 0.16, p + d * 0.62, 0.028, 0.03)  # fore stock
    k.beam('iron', p + d * 0.2 + upv * 0.02, p + d * 0.78 + upv * 0.02, 0.014, round_=True, seg=5)  # barrel
    if not k.lod:
        k.cbox('iron', 0.012, 0.03, 0.04, *(p + d * 0.2 + upv * 0.025))  # lock


def cutlass(k, p, d, side=(1, 0, 0)):
    """a cutlass: hilt at p, blade along d"""
    p, d = Vector(p), Vector(d).normalized()
    sv = Vector(side)
    k.beam('darkwood', p - d * 0.07, p, 0.018, round_=True, seg=5)
    k.beam('brass', p - sv * 0.035, p + sv * 0.035, 0.012, 0.012)
    k.beam('iron', p, p + d * 0.36, 0.006, 0.03)


# ------------------------------------------------------------------------------------------- stockade

@building('stockade')
def stockade(k):
    """the captives' stockade: a palisade of sharpened logs lashed with rope bands, a heavy iron-strapped
    gate, a corner watch platform, thatched lean-to shelters, stocks and a whipping post"""
    E = 2.3  # palisade line
    k.box('dirt', 2 * E - 0.1, 0.012, 2 * E - 0.1, 0, 0, 0, uvscale=0.6)
    k.box('dirt', 1.1, 0.012, 0.5, 0, 0, E + 0.05, uvscale=0.6)
    gate = 0.6
    inside = (0, 0)
    palisade(k, (-E, -E), (E, -E), inside=inside)
    palisade(k, (-E, -E + 0.08), (-E, E), inside=inside)
    palisade(k, (E, -E + 0.08), (E, E), inside=inside)
    palisade(k, (-E + 0.08, E), (-gate - 0.12, E), inside=inside)
    palisade(k, (gate + 0.12, E), (E - 0.08, E), inside=inside)
    # gate posts and lintel
    for s in (-1, 1):
        k.cyl('bark', 0.11, 0.1, 1.82, s * gate, -0.08, E, seg=10)
        k.cyl('planks', 0.1, 0.1, 0.01, s * gate, 1.74, E, seg=10)
        if not k.lod:
            iron_bands(k, s * gate, E, 0.105, (0.5, 1.15))
    k.push(0, 1.6, E)
    k.beam('bark', V(-gate - 0.28, 0, 0), V(gate + 0.28, 0, 0), 0.16, round_=True, seg=9)
    k.pop()
    if not k.lod:
        for s in (-1, 1):
            for j in range(4):
                frame_along(k, V(s * gate, 1.6, E), V(1, 0.35 * (1 if j % 2 else -1), 0))
                k.torus('rope', 0.115, 0.012, 0, 0.0, 0, seg=10, rseg=3)
                k.pop()
    # gate leaves: vertical planks, ledges and brace inside, iron straps and studs outside
    gz = E + 0.0
    for s in (-1, 1):
        lw = gate - 0.09
        k.push(s * (gate - 0.085), 0.04, gz)
        n = 5
        pw = lw / n
        for i in range(n):
            xx = -s * (i + 0.5) * pw
            hh = 1.28 + (k.r() - 0.5) * 0.03
            k.box('planksDark', pw - 0.006, hh, 0.05, xx, 0, 0, uvscale=1.3, grain=1)
        for yy in (0.15, 0.62, 1.08):
            k.box('planksDark', lw - 0.04, 0.09, 0.035, -s * lw / 2, yy, -0.04, uvscale=1.3)
            k.box('iron', lw - 0.02, 0.035, 0.012, -s * lw / 2, yy + 0.03, 0.03)
            if not k.lod:
                for i in range(n):
                    k.cyl('iron', 0.009, 0.007, 0.012, -s * (i + 0.5) * pw, yy + 0.047, 0.036, seg=5, rx=math.pi / 2)
                k.cyl('iron', 0.018, 0.018, 0.08, 0.0, yy + 0.008, 0.0, seg=7)  # hinge pintle
        k.beam('planksDark', V(-s * 0.04, 0.22, -0.045), V(-s * (lw - 0.05), 0.62, -0.045), 0.07, 0.03)
        k.beam('planksDark', V(-s * 0.04, 0.68, -0.045), V(-s * (lw - 0.05), 1.06, -0.045), 0.07, 0.03)
        k.pop()
    # drop bar brackets, a hasp and padlock
    if not k.lod:
        k.cbox('iron', 0.05, 0.1, 0.02, 0, 0.66, gz + 0.045)
        k.cbox('iron', 0.06, 0.07, 0.03, 0.0, 0.58, gz + 0.06)
        k.torus('iron', 0.022, 0.006, 0.0, 0.63, gz + 0.06, rx=math.pi / 2, seg=8, rseg=3)
    for s in (-1, 1):
        lantern(k, s * (gate + 0.11), 1.42, E + 0.05)

    # corner watch platform (back left)
    cx, cz, ph = -1.72, -1.72, 1.2
    k.push(cx, 0, cz)
    for (px, pz) in ((-0.42, -0.42), (0.42, -0.42), (-0.42, 0.42), (0.42, 0.42)):
        k.cyl('bark', 0.055, 0.05, 2.12, px, -0.05, pz, seg=8)
    for s in (-1, 1):
        k.beam('wood', V(-0.47, ph - 0.07, s * 0.42), V(0.47, ph - 0.07, s * 0.42), 0.08, 0.07)
        k.beam('wood', V(s * 0.42, ph - 0.14, -0.47), V(s * 0.42, ph - 0.14, 0.47), 0.08, 0.07)
        # cross bracing below
        k.beam('wood', V(-0.42, 0.15, s * 0.44), V(0.42, ph - 0.2, s * 0.44), 0.05, 0.04)
        k.beam('wood', V(s * 0.44, 0.15, -0.42), V(s * 0.44, ph - 0.25, 0.42), 0.05, 0.04)
    deck(k, 0.96, 0.96, ph + 0.04, 'planks', along='x', joists=False)
    # breastwork of planks on the inner faces (the palisade covers the outer two)
    for (f, L) in (('front', 0.96), ('right', 0.96)):
        k.face(f, 0.96, 0.96)
        for i in range(7):
            x = -L / 2 + (i + 0.5) * L / 7
            k.box('oldplanks', L / 7 - 0.008, 0.4 + (k.r() - 0.5) * 0.03, 0.025, x, ph + 0.04, -0.03, uvscale=1.3, grain=1)
        k.box('wood', L + 0.04, 0.05, 0.06, 0, ph + 0.42, -0.03)
        k.pop()
    for (f, L) in (('back', 0.96), ('left', 0.96)):
        k.face(f, 0.96, 0.96)
        k.box('wood', L + 0.04, 0.05, 0.06, 0, ph + 0.62, -0.03)
        k.box('wood', L + 0.04, 0.04, 0.05, 0, ph + 0.3, -0.03)
        k.pop()
    thatch_cone(k, 0.72, 0.5, y=2.07, mat='thatch')
    k.box('darkwood', 0.98, 0.06, 0.98, 0, 2.02, 0)
    lantern(k, 0.0, 1.95, 0.24)
    k.pop()
    ladder(k, V(cx + 0.15, 0, cz + 0.85), V(cx + 0.15, ph + 0.42, cz + 0.49), w=0.26)

    # thatched lean-to shelters along the back and the right-hand wall
    k.push(0.75, 0, -E + 0.5)
    lean_to(k, 2.4, 0.85, 0.98, 0.66, seed=2.3)
    for i in range(4):
        k.box('thatchDark', 0.42, 0.03, 0.5, -0.85 + i * 0.58, 0, -0.08 + (k.r() - 0.5) * 0.08, ry=(k.r() - 0.5) * 0.3)
    k.box('canvas', 0.36, 0.035, 0.24, -0.25, 0.02, -0.05, ry=0.3)
    k.box('canvasRed', 0.34, 0.03, 0.26, 0.9, 0.02, 0.0, ry=-0.2)
    k.pop()
    k.push(E - 0.5, 0, 0.15, -math.pi / 2)
    lean_to(k, 2.0, 0.85, 0.98, 0.66, seed=5.1)
    for i in range(3):
        k.box('thatchDark', 0.42, 0.03, 0.5, -0.6 + i * 0.6, 0, -0.08, ry=(k.r() - 0.5) * 0.3)
    k.pop()

    # stocks near the gate
    k.push(-1.25, 0, 1.25, 0.25)
    k.box('darkwood', 0.95, 0.07, 0.14, 0, 0, 0)  # sill
    for s in (-1, 1):
        k.box('darkwood', 0.09, 0.62, 0.09, s * 0.42, 0.0, 0)
        k.cyl('darkwood', 0.045, 0.02, 0.05, s * 0.42, 0.62, 0, seg=6)
    k.box('planksDark', 0.86, 0.13, 0.07, 0, 0.12, 0)
    k.box('planksDark', 0.86, 0.13, 0.07, 0, 0.255, 0)
    for xx in (-0.27, -0.12, 0.12, 0.27):
        k.cyl('black', 0.03, 0.03, 0.072, xx, 0.255, -0.036, seg=8, rx=math.pi / 2)
    if not k.lod:
        for s in (-1, 1):
            k.box('iron', 0.03, 0.27, 0.075, s * 0.4, 0.12, 0)
        k.cbox('iron', 0.04, 0.06, 0.02, 0, 0.27, 0.045)
    # a bench behind it
    k.box('oldplanks', 0.9, 0.04, 0.16, 0, 0.2, -0.32, uvscale=1.3)
    for s in (-1, 1):
        k.box('wood', 0.05, 0.2, 0.12, s * 0.38, 0, -0.32)
    k.pop()
    # whipping post with irons
    k.push(0.95, 0, 1.0)
    k.cyl('darkwood', 0.07, 0.065, 1.55, 0, -0.05, 0, seg=9)
    k.cyl('darkwood', 0.065, 0.02, 0.06, 0, 1.5, 0, seg=9)
    k.beam('darkwood', V(-0.22, 1.28, 0), V(0.22, 1.28, 0), 0.07, 0.07)
    for s in (-1, 1):
        k.torus('iron', 0.035, 0.008, s * 0.19, 1.22, 0.0, rx=math.pi / 2, seg=10, rseg=3)
        chain(k, [V(s * 0.19, 1.19, 0.0), V(s * 0.2, 0.92, 0.04)])
        k.torus('iron', 0.04, 0.01, s * 0.2, 0.89, 0.04, rx=0.3, seg=10, rseg=3)
    k.box('dirt', 0.5, 0.016, 0.5, 0, 0, 0, ry=0.4)
    k.pop()
    # cook fire, water butt, buckets and a cart of firewood
    fx, fz = 0.1, -0.1
    for i in range(9):
        a = i / 9 * math.tau
        k.cbox('stone', 0.08, 0.06, 0.07, fx + math.cos(a) * 0.2, 0.03, fz + math.sin(a) * 0.2, ry=a, uvscale=2.0)
    for i in range(4):
        a = i / 4 * math.tau + 0.3
        k.beam('bark', V(fx + math.cos(a) * 0.14, 0.02, fz + math.sin(a) * 0.14), V(fx - math.cos(a) * 0.02, 0.09, fz - math.sin(a) * 0.02), 0.035, round_=True)
    k.cbox('black', 0.24, 0.015, 0.24, fx, 0.008, fz)
    embers(k, fx, 0.012, fz, 0.11)
    k.marker('smoke', fx, 0.14, fz)
    cask(k, 1.75, 1.75, 0.95)
    k.cyl('water', 0.13, 0.13, 0.005, 1.75, 0.33, 1.75, seg=12)
    cask(k, 1.45, 1.85, 0.6, ry=0.4)
    k.cyl('planksDark', 0.07, 0.06, 0.12, -0.35, 0, 1.6, seg=10)
    k.beam('iron', V(-0.42, 0.12, 1.6), V(-0.35, 0.2, 1.6), 0.006, round_=True, seg=4)
    k.beam('iron', V(-0.35, 0.2, 1.6), V(-0.28, 0.12, 1.6), 0.006, round_=True, seg=4)
    for i in range(10):
        k.cyl('bark', 0.04, 0.04, 0.5, -2.0 + (i % 4) * 0.085, 0.04 + (i // 4) * 0.075, 0.55, seg=6, rx=math.pi / 2)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- masonry helpers

def prism(k, mat, pts, x0, x1, uvscale=1.0, bevel=0.0):
    """a convex (z, y) section extruded along x from x0 to x1"""
    n = len(pts)
    verts = [V(x0, y, z) for (z, y) in pts] + [V(x1, y, z) for (z, y) in pts]
    # orient so the section winds counter-clockwise seen from +x
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    order = list(range(n)) if area < 0 else list(range(n))[::-1]
    faces = [tuple(order[::-1]), tuple(n + i for i in order)]
    for a in range(n):
        i, j = order[a], order[(a + 1) % n]
        faces.append((i, j, n + j, n + i))
    k.mesh(mat, verts, faces, uvscale=uvscale, bevel=bevel)


def block_facing(k, rects, mat='stone', rh=0.125, depth=0.035, z=0.0, lmin=0.16, lmax=0.34, jitter=1.0):
    """irregular coursed blocks laid over wall rectangles (x0, x1, y0, y1) in the current face frame"""
    if k.lod:
        return
    for (x0, x1, y0, y1) in rects:
        rows = max(1, round((y1 - y0) / rh))
        hh = (y1 - y0) / rows
        for r in range(rows):
            x = x0 + ((k.r() * 0.5 + 0.25) * lmin if r % 2 else 0)
            first = True
            if r % 2:
                bw = x - x0
                if bw > 0.03:
                    k.box(mat, bw - 0.012, hh - 0.014, depth, x0 + bw / 2, y0 + r * hh + 0.007, z + depth / 2 - 0.01, uvscale=2.0)
            while x < x1 - 0.02:
                bw = min(x1 - x, lmin + k.r() * (lmax - lmin))
                if x1 - (x + bw) < 0.06:
                    bw = x1 - x
                mm = mat if k.r() > 0.04 else ('stone' if mat != 'stone' else 'stoneDark')
                k.box(mm, bw - 0.012, hh - 0.014, depth + k.r() * 0.012 * jitter, x + bw / 2, y0 + r * hh + 0.007, z + depth / 2 - 0.01,
                      ry=(k.r() - 0.5) * 0.02 * jitter, rz=(k.r() - 0.5) * 0.015 * jitter, uvscale=2.0)
                x += bw


def stone_walls(k, w, d, h, ops, t=0.14, mat='stone', core='stoneDark', rh=0.125, lmin=0.16, lmax=0.34):
    """thick coursed-stone walls: a dark mortar core with proud blocks on every face, openings in reveals"""
    solid_walls(k, w, d, h, core, ops, t)
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d)
        mine = [o for o in ops if o.face == f]
        block_facing(k, wall_segments(L, h, mine), mat, rh=rh, lmin=lmin, lmax=lmax)
        k.pop()


# ------------------------------------------------------------------------------------------- gallows

def gibbet_cage(k, x, y, z):
    """a man-shaped iron gibbet cage (hung from its top ring at y) with what is left of its tenant"""
    prof = [(0.07, 0.0), (0.11, 0.12), (0.13, 0.3), (0.15, 0.45), (0.16, 0.56), (0.07, 0.62), (0.085, 0.7), (0.06, 0.77), (0.0, 0.79)]
    top = prof[-1][1]
    k.push(x, y - top - 0.03, z)
    nb = 10
    for i in range(nb):
        a = i / nb * math.tau
        pts = [V(math.cos(a) * r, yy, math.sin(a) * r * 0.75) for (r, yy) in prof]
        for p, q in zip(pts[:-1], pts[1:]):
            k.beam('iron', p, q, 0.012, 0.008)
    for (r, yy) in prof[1:-1:1]:
        k.push(0, 0, 0)
        k.stack[-1] = k.stack[-1] @ Matrix.Diagonal((1, 1, 0.75, 1))
        k.torus('iron', r, 0.007 if not k.lod else 0.013, 0, yy, 0, seg=12, rseg=3)
        k.pop()
    k.box('iron', 0.18, 0.012, 0.13, 0, -0.006, 0)
    k.torus('iron', 0.025, 0.006, 0, top + 0.02, 0, rx=math.pi / 2, seg=8, rseg=3)
    # bones
    if not k.lod:
        sphere(k, 'bone', 0.055, 0.0, 0.69, 0.005, seg=9, rings=6, squash=1.1)
        for s in (-1, 1):
            k.cyl('black', 0.012, 0.012, 0.01, s * 0.02, 0.695, 0.05, seg=5, rx=math.pi / 2)
        k.cyl('bone', 0.012, 0.012, 0.35, 0, 0.27, -0.03, seg=5)
        for i in range(5):
            k.push(0, 0.5 - i * 0.04, 0.0)
            k.stack[-1] = k.stack[-1] @ Matrix.Diagonal((1, 1, 0.7, 1))
            k.torus('bone', 0.08 - i * 0.004, 0.007, 0, 0, 0, seg=10, rseg=3)
            k.pop()
        for s in (-1, 1):
            k.beam('bone', V(s * 0.06, 0.25, 0), V(s * 0.05, 0.02, 0.03), 0.02, round_=True, seg=5)
            k.beam('bone', V(s * 0.11, 0.53, 0), V(s * 0.1, 0.32, 0.04), 0.016, round_=True, seg=5)
        k.box('canvas', 0.17, 0.12, 0.1, 0, 0.22, 0, ry=0.2)  # rags
    k.pop()


@building('gallows')
def gallows(k):
    """the gallows: a planked scaffold with a trapdoor, a heavy beam with two nooses, steps and a rail,
    and an iron gibbet cage swinging from its own post"""
    k.box('dirt', 3.6, 0.012, 2.6, 0, 0, 0, uvscale=0.6)
    cx, cz, W, D, H = -0.25, -0.1, 1.9, 1.4, 0.85
    k.push(cx, 0, cz)
    # posts, girts and the plank skirt
    for x in (-W / 2 + 0.05, 0, W / 2 - 0.05):
        for z in (-D / 2 + 0.05, 0, D / 2 - 0.05):
            k.box('darkwood', 0.1, H - 0.04, 0.1, x, 0, z)
            k.box('stone', 0.16, 0.05, 0.16, x, 0, z, uvscale=2.0)
    for f in ('front', 'back', 'left'):
        L = W if f in ('front', 'back') else D
        k.face(f, W, D)
        n = round(L / 0.12)
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n
            if f == 'front' and abs(x - 0.45) < 0.2:
                continue
            k.box('oldplanks', L / n - 0.007, H - 0.12 - k.r() * 0.03, 0.022, x, 0.02, 0.0, uvscale=1.3, grain=1)
        k.box('darkwood', L + 0.02, 0.07, 0.04, 0, 0.25, 0.022)
        k.pop()
    # a low door into the space beneath (where the drop ends)
    k.push(0.45, 0, D / 2)
    door(k, 0, w=0.36, h=0.62, depth=0.02, mat='planksDark')
    k.pop()
    deck(k, W + 0.1, D + 0.1, H + 0.04, 'planks', along='x', joists=True)
    # the trap: two leaves with a dark frame, strap hinges and the release lever
    tx, tz = 0.0, -0.15
    k.box('darkwood', 0.64, 0.012, 0.06, tx, H + 0.04, tz - 0.29)
    k.box('darkwood', 0.64, 0.012, 0.06, tx, H + 0.04, tz + 0.29)
    for s in (-1, 1):
        k.box('darkwood', 0.06, 0.012, 0.52, tx + s * 0.29, H + 0.04, tz)
        k.box('planksDark', 0.255, 0.014, 0.52, tx + s * 0.13, H + 0.042, tz, uvscale=1.3)
        if not k.lod:
            for zz in (-0.15, 0.15):
                k.box('iron', 0.16, 0.006, 0.03, tx + s * 0.2, H + 0.056, tz + zz)
    k.box('black', 0.008, 0.016, 0.52, tx, H + 0.041, tz)
    k.beam('iron', V(0.48, H + 0.04, tz + 0.3), V(0.55, H + 0.5, tz + 0.25), 0.025, round_=True, seg=6)
    k.cyl('darkwood', 0.03, 0.03, 0.09, 0.55, H + 0.47, tz + 0.25, seg=6, rx=-0.15)
    k.box('iron', 0.1, 0.05, 0.06, 0.48, H + 0.04, tz + 0.3)
    # the gallows frame
    by = 2.28
    for s in (-1, 1):
        k.box('darkwood', 0.12, by, 0.12, s * 0.6, 0, tz, uvscale=1.2)
        k.box('darkwood', 0.12, 0.12, 0.32, s * 0.6, H + 0.04, tz)  # sole on the deck
        k.beam('darkwood', V(s * 0.6, H + 0.04, tz - 0.15), V(s * 0.6, H + 0.45, tz), 0.07, 0.07)
        k.beam('darkwood', V(s * 0.6, H + 0.04, tz + 0.15), V(s * 0.6, H + 0.45, tz), 0.07, 0.07)
        k.beam('darkwood', V(s * 0.6, by - 0.4, tz), V(s * 0.28, by - 0.06, tz), 0.07, 0.07)
    k.box('darkwood', 1.55, 0.14, 0.14, 0, by - 0.02, tz, uvscale=1.2)
    k.box('darkwood', 1.6, 0.03, 0.17, 0, by + 0.12, tz, uvscale=1.2)
    for s in (-1, 1):
        nx = s * 0.2
        k.torus('rope', 0.075, 0.014, nx, by - 0.02 + 0.07, tz, rx=math.pi / 2, seg=10, rseg=4) if not k.lod else None
        k.beam('rope', V(nx, by - 0.02, tz), V(nx + 0.01, 1.82, tz), 0.018, round_=True, seg=5)
        k.cyl('rope', 0.026, 0.026, 0.11, nx + 0.01, 1.71, tz, seg=8)  # the hangman's knot
        k.push(nx + 0.01, 1.6, tz + 0.015, 0.0, math.pi / 2)
        k.stack[-1] = k.stack[-1] @ Matrix.Diagonal((0.62, 1, 1.0, 1))
        k.torus('rope', 0.058, 0.012, 0, 0, 0, seg=12, rseg=4)
        k.pop()
    # rails round three sides, open at the stair head
    ry_ = H + 0.04
    for (a, b) in (((-W / 2, -D / 2), (W / 2, -D / 2)), ((-W / 2, -D / 2), (-W / 2, D / 2)), ((-W / 2, D / 2), (W / 2 - 0.05, D / 2)), ((W / 2, -D / 2), (W / 2, D / 2 - 0.45))):
        A, B = V(a[0], ry_, a[1]), V(b[0], ry_, b[1])
        n = max(1, round((B - A).length / 0.45))
        for i in range(n + 1):
            p = A + (B - A) * (i / n)
            k.box('wood', 0.06, 0.48, 0.06, p.x, ry_, p.z)
        k.beam('wood', A + V(0, 0.48, 0), B + V(0, 0.48, 0), 0.07, 0.05)
        k.beam('wood', A + V(0, 0.24, 0), B + V(0, 0.24, 0), 0.04, 0.035)
    k.pop()
    # stair down toward +x, treads between stringers, with a hand rail
    sx0 = cx + W / 2
    n = 7
    for i in range(n):
        x = sx0 + (i + 0.5) * 0.15
        y = H - (i + 1) * H / (n + 1)
        k.box('planks', 0.17, 0.035, 0.5, x, y, cz + D / 2 - 0.3, uvscale=1.3)
    for s in (-1, 1):
        z = cz + D / 2 - 0.3 + s * 0.27
        k.beam('darkwood', V(sx0 - 0.02, H + 0.0, z), V(sx0 + n * 0.15 + 0.06, 0.0, z), 0.05, 0.12)
    z = cz + D / 2 - 0.3 + 0.3
    k.box('wood', 0.05, 0.5, 0.05, sx0 + n * 0.15, 0, z)
    k.beam('wood', V(sx0 + n * 0.15, 0.48, z), V(sx0 - 0.02, H + 0.52, z), 0.05, 0.045)
    # the gibbet post with its cage
    gx, gz = -1.55, 0.95
    k.cyl('darkwood', 0.07, 0.06, 2.3, gx, -0.05, gz, seg=8)
    k.box('stone', 0.3, 0.08, 0.3, gx, 0, gz, ry=0.3, uvscale=2.0)
    k.box('darkwood', 0.6, 0.08, 0.08, gx + 0.22, 2.12, gz)
    k.beam('darkwood', V(gx, 1.75, gz), V(gx + 0.3, 2.12, gz), 0.06, 0.06)
    k.torus('iron', 0.02, 0.006, gx + 0.44, 2.11, gz, rx=math.pi / 2, seg=8, rseg=3)
    chain(k, [V(gx + 0.44, 2.09, gz), V(gx + 0.44, 1.88, gz)])
    gibbet_cage(k, gx + 0.44, 1.87, gz)
    # a coffin waiting, a crow-picked basket and a ladder
    k.push(1.25, 0, -0.95, 0.15)
    prism(k, 'oldplanks', [(-0.13, 0.0), (0.13, 0.0), (0.16, 0.14), (-0.16, 0.14)], -0.42, 0.42, uvscale=1.3, bevel=0.004)
    k.cbox('oldplanks', 0.86, 0.03, 0.34, 0.03, 0.155, 0.02, ry=0.08, rz=-0.03)
    k.pop()
    sack(k, 1.5, -0.4, 0.8, 0.6)
    k.beam('wood', V(1.05, 0.0, -0.62), V(1.32, 0.9, -0.57), 0.035, round_=True)  # a shovel left for the grave
    k.cbox('iron', 0.1, 0.13, 0.012, 1.04, 0.05, -0.62, rz=-0.29)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- interrogation

def manacles(k, x, y, z, drop=0.3):
    """a ring bolt in the wall with a short chain and an open cuff (wall face at z, facing +z)"""
    k.cyl('iron', 0.018, 0.018, 0.03, x, y, z, seg=6, rx=math.pi / 2)
    k.torus('iron', 0.028, 0.007, x, y - 0.03, z + 0.03, rx=math.pi / 2, seg=8, rseg=3)
    chain(k, [V(x, y - 0.06, z + 0.03), V(x + 0.02, y - drop, z + 0.04)])
    k.torus('iron', 0.035, 0.01, x + 0.02, y - drop - 0.03, z + 0.05, rx=0.4, seg=10, rseg=3)


def brazier(k, x, z, h=0.55):
    """an iron fire basket on a tripod, glowing, with irons heating in it"""
    for i in range(3):
        a = i / 3 * math.tau
        k.beam('iron', V(x + math.cos(a) * 0.17, 0, z + math.sin(a) * 0.17), V(x + math.cos(a) * 0.08, h, z + math.sin(a) * 0.08), 0.022, round_=True, seg=5)
    k.cyl('iron', 0.08, 0.15, 0.14, x, h - 0.02, z, seg=12, caps=False)
    k.cyl('iron', 0.08, 0.08, 0.01, x, h - 0.02, z, seg=12)
    k.cyl('black', 0.13, 0.13, 0.03, x, h + 0.06, z, seg=12)
    embers(k, x, h + 0.09, z, 0.11)
    for a in (0.3, 1.9, 3.8):
        k.beam('iron', V(x + math.cos(a) * 0.05, h + 0.09, z + math.sin(a) * 0.05), V(x + math.cos(a) * 0.4, h + 0.32, z + math.sin(a) * 0.4), 0.012, round_=True, seg=4)
        k.cyl('darkwood', 0.014, 0.014, 0.08, x + math.cos(a) * 0.4, h + 0.32, z + math.sin(a) * 0.4, seg=5)
    k.marker('smoke', x, h + 0.2, z)


@building('interrogation')
def interrogation(k):
    """a squat block house of dark coursed stone: walls a foot thick, slit windows behind bars, an iron-
    studded door, a parapeted roof, chains and cuffs on the walls, a brazier with irons, a standing cage
    and a grated pit"""
    w, d, h = 3.3, 2.3, 1.45
    bx, bz = -0.45, -0.35
    k.box('dirt', 4.5, 0.012, 3.5, 0, 0, 0.0, uvscale=0.6)
    k.push(bx, 0, bz)
    plinth(k, w + 0.1, d + 0.1, 0.12, mat='stoneDark')
    k.push(0, 0.12, 0)
    win = dict(kind='window', w=0.14, h=0.24, y=0.85, shutters=False, bars=True)
    ops = [Op('front', 0.0, 'none', w=0.46, h=0.84), Op('front', -1.05, **win), Op('front', 1.05, **win),
           Op('left', 0.0, **win), Op('right', -0.4, **win), Op('back', -0.8, **win), Op('back', 0.8, **win)]
    stone_walls(k, w, d, h, ops, t=0.16, mat='stoneDark', core='black', rh=0.16, lmin=0.2, lmax=0.45)
    # door: iron studded, in a dressed surround with a heavy lintel
    k.face('front', w, d)
    door(k, 0.0, w=0.46, h=0.84, depth=0.12, mat='planksDark', studs=True)
    k.box('stone', 0.68, 0.16, 0.06, 0, 0.84, 0.0, uvscale=2.0)
    for s in (-1, 1):
        for j in range(5):
            k.box('stone', 0.12 if j % 2 else 0.17, 0.165, 0.05, s * (0.29 + (0.02 if j % 2 else 0.045)), j * 0.168, 0.0, uvscale=2.0)
        manacles(k, s * 0.75, 0.85, 0.035)
    lantern(k, 0.48, 1.12, 0.03)
    k.pop()
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d)
        for s in (-1, 1):
            if f == 'back':
                manacles(k, s * 0.2, 0.8, 0.035, drop=0.25)
        k.pop()
    # string course, flat roof behind a crenellated parapet, spouts
    k.box('stone', w + 0.08, 0.07, d + 0.08, 0, h, 0, uvscale=2.0)
    k.box('stoneDark', w - 0.1, 0.06, d - 0.1, 0, h + 0.02, 0, uvscale=2.0)
    for f in FACES:
        L = w + 0.04 if f in ('front', 'back') else d + 0.04
        k.face(f, w, d)
        k.box('stoneDark', L, 0.18, 0.14, 0, h + 0.07, -0.05, uvscale=2.0)
        n = max(3, round(L / 0.36))
        for i in range(n):
            x = -L / 2 + (i + 0.5) * L / n
            if i % 2 == 0:
                k.box('stoneDark', L / n + (0.0 if 0 < i < n - 1 else 0.02), 0.16, 0.14, x, h + 0.25, -0.05, uvscale=2.0)
                k.box('stone', L / n + 0.02, 0.035, 0.17, x, h + 0.41, -0.05, uvscale=2.0)
        k.box('stone', L + 0.02, 0.035, 0.17, 0, h + 0.25, -0.05, uvscale=2.0)
        # corbels under the parapet
        if not k.lod:
            for i in range(round(L / 0.3)):
                x = -L / 2 + 0.15 + i * (L - 0.3) / max(1, round(L / 0.3) - 1)
                k.box('stone', 0.07, 0.08, 0.05, x, h - 0.06, 0.02, uvscale=2.0)
        if f in ('left', 'right'):
            k.cyl('stone', 0.035, 0.03, 0.22, 0.4, h + 0.09, 0.02, seg=6, rx=math.pi / 2 - 0.2)
        k.pop()
    chimney(k, w / 2 - 0.45, -d / 2 + 0.35, h + 0.05, 0.7, 0.28)
    k.pop()
    k.pop()
    steps(k, bx, bz + d / 2 + 0.12, 0.6, 0.12, 1, 'stoneDark')
    # brazier with irons heating, a quench bucket, a block and a chain rack
    brazier(k, 0.75, 0.75)
    k.cyl('planksDark', 0.1, 0.09, 0.2, 1.1, 0, 0.55, seg=10)
    k.cyl('water', 0.088, 0.088, 0.004, 1.1, 0.185, 0.55, seg=10)
    k.cyl('bark', 0.17, 0.16, 0.32, -1.5, 0, 0.95, seg=12)
    k.cyl('planks', 0.155, 0.155, 0.01, -1.5, 0.32, 0.95, seg=12)
    chain(k, hang(V(-1.62, 0.33, 0.9), V(-1.4, 0.0, 1.15), 0.06, 4))
    # a standing iron cage on a stone base
    k.push(1.72, 0, -0.55)
    k.box('stoneDark', 0.72, 0.1, 0.72, 0, 0, 0, uvscale=2.0)
    k.box('iron', 0.7, 0.03, 0.7, 0, 1.12, 0)
    k.box('darkwood', 0.76, 0.04, 0.76, 0, 1.15, 0)
    for f in FACES:
        k.face(f, 0.66, 0.66)
        for i in range(8):
            x = -0.31 + i * 0.62 / 7
            k.box('iron', 0.016, 1.02, 0.016, x, 0.1, 0)
        for yy in (0.12, 0.6, 1.08):
            k.box('iron', 0.66, 0.025, 0.02, 0, yy, 0.0)
        k.pop()
    k.torus('iron', 0.04, 0.008, 0, 1.22, 0, rx=math.pi / 2, seg=8, rseg=3)
    k.cbox('iron', 0.08, 0.1, 0.04, 0.0, 0.62, 0.35)  # lock
    k.box('thatchDark', 0.5, 0.025, 0.4, 0, 0.1, -0.05, ry=0.2)
    k.pop()
    # a grated pit (oubliette) with a stone kerb
    k.push(1.55, 0, 1.1)
    k.box('black', 0.5, 0.01, 0.5, 0, 0.0, 0)
    for f in FACES:
        k.face(f, 0.5, 0.5)
        k.box('stoneDark', 0.62, 0.08, 0.06, 0, 0, 0.03, uvscale=2.0)
        k.pop()
    for i in range(6):
        k.box('iron', 0.02, 0.02, 0.56, -0.22 + i * 0.088, 0.075, 0)
        k.box('iron', 0.56, 0.02, 0.02, 0, 0.085, -0.22 + i * 0.088)
    k.torus('iron', 0.04, 0.008, 0.2, 0.1, 0.0, seg=8, rseg=3)
    k.pop()
    torch_post(k, bx - 0.55, bz + d / 2 + 0.35, 0.95)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- fort

def rampart(k, L, depth, walk=0.8, par=0.42, pt=0.3, emb=(), gate=None, mat='coral', ends=(True, True)):
    """a coral-stone rampart in a frame whose x runs along the wall and +z faces out: a battered scarp to a
    rounded cordon, a parapet pierced with embrasures, a flagged walk behind it; returns nothing"""
    x0, x1 = -L / 2, L / 2
    sec = [(0.0, 0.0), (-depth, 0.0), (-depth, walk), (-0.09, walk)]
    spans = [(x0, x1)] if gate is None else [(x0, gate[0] - gate[1] / 2), (gate[0] + gate[1] / 2, x1)]
    for (a, b) in spans:
        prism(k, mat, sec, a, b, uvscale=1.4)
    if gate is not None:
        gx, gw, gh = gate
        prism(k, mat, [(0.0, gh), (-depth, gh), (-depth, walk), (-0.09, walk)], gx - gw / 2 - 0.01, gx + gw / 2 + 0.01, uvscale=1.4)
        k.box('black', gw, gh, 0.02, gx, 0, -depth / 2)
        k.box('stoneDark', gw, 0.01, depth, gx, 0, -depth / 2, uvscale=2.0)
    # dressed quoins up the battered corners
    if not k.lod:
        for (xe, sgn, on) in ((x0, 1, ends[0]), (x1, -1, ends[1])):
            if not on:
                continue
            n = round(walk / 0.13)
            for j in range(n):
                yy = j * walk / n
                lw = 0.26 if j % 2 else 0.17
                zc = -0.09 * (yy + walk / n / 2) / walk
                k.cbox('stone', lw, walk / n - 0.012, 0.05, xe + sgn * (lw / 2 - 0.005), yy + walk / n / 2, zc + 0.012, rx=-math.atan2(0.09, walk), uvscale=2.0)
                # and round the return face
                k.cbox('stone', 0.03, walk / n - 0.012, lw - 0.03, xe - sgn * 0.004, yy + walk / n / 2, zc - lw / 2 + 0.03, uvscale=2.0)
    # footing course and the cordon
    k.box('stone', L, 0.1, 0.05, 0, 0, 0.0, uvscale=2.0)
    k.beam('stone', V(x0, walk, -0.07), V(x1, walk, -0.07), 0.1, round_=True, seg=8)
    # parapet between embrasures
    cuts = sorted(emb)
    edges = [x0] + [c for e in cuts for c in (e - 0.18, e + 0.18)] + [x1]
    for i in range(0, len(edges), 2):
        a, b = edges[i], edges[i + 1]
        prism(k, mat, [(-0.09, walk), (-0.09 - pt, walk), (-0.09 - pt, walk + par - 0.06), (-0.11, walk + par)], a, b, uvscale=1.4)
        prism(k, 'stone', [(-0.07, walk + par - 0.01), (-0.11 - pt, walk + par - 0.08), (-0.11 - pt, walk + par - 0.04), (-0.08, walk + par + 0.04)], a, b, uvscale=2.0)
    for e in cuts:
        # sloped sill and cheek stones of the embrasure
        prism(k, 'stone', [(-0.07, walk), (-0.09 - pt, walk), (-0.09 - pt, walk + 0.24), (-0.07, walk + 0.19)], e - 0.18, e + 0.18, uvscale=2.0)
        if not k.lod:
            for s in (-1, 1):
                for j in range(3):
                    k.box('stone', 0.05, 0.11, 0.1 if j % 2 else 0.16, e + s * 0.2, walk + 0.03 + j * 0.12, -0.12 - (0.05 if j % 2 else 0.08), uvscale=2.0)
    # flagged walk and drains
    k.box('stone', L - 0.02, 0.025, depth - pt - 0.1, 0, walk - 0.01, -(pt + 0.09) - (depth - pt - 0.1) / 2, uvscale=1.5)
    if not k.lod:
        for i in range(round(L / 1.6)):
            x = x0 + (i + 0.5) * L / round(L / 1.6)
            if gate and abs(x - gate[0]) < 0.6:
                continue
            k.cyl('stone', 0.03, 0.025, 0.18, x, walk - 0.05, -0.05, seg=6, rx=math.pi / 2 + 0.25)
            k.cyl('black', 0.018, 0.018, 0.01, x, walk - 0.05 + 0.04, 0.12, seg=6, rx=math.pi / 2 + 0.25)


def garita(k, x, y, z, ry=0.0):
    """a Spanish sentry box: corbelled out from the corner, rendered drum, slit windows, stone dome"""
    k.push(x, y, z, ry)
    lathe(k, 'stone', [(0.05, -0.32), (0.12, -0.26), (0.17, -0.16), (0.21, -0.06), (0.24, 0.0), (0.24, 0.04)], seg=16)
    lathe(k, 'plaster', [(0.2, 0.04), (0.2, 0.52)], seg=16, cap0=False, cap1=False)
    lathe(k, 'stone', [(0.235, 0.52), (0.235, 0.57), (0.21, 0.58), (0.19, 0.62), (0.16, 0.7), (0.1, 0.76), (0.04, 0.79), (0.03, 0.84),
                       (0.045, 0.87), (0.03, 0.9), (0.005, 0.93)], seg=16)
    for a in (0.0, 1.3, -1.3, math.pi):
        if abs(a - math.pi) < 0.01:
            # its door faces in
            k.push(0, 0, 0, a)
            k.box('black', 0.16, 0.36, 0.03, 0, 0.06, 0.19)
            k.pop()
            continue
        k.push(0, 0, 0, a)
        k.box('black', 0.035, 0.16, 0.03, 0, 0.26, 0.19)
        k.pop()
    k.pop()


def barrel_vault_house(k, w, d, h, mat='stone'):
    """a bomb-proof powder magazine: thick walls, a stone barrel vault, buttresses, a studded door, vents"""
    stone_walls(k, w, d, h, [Op('front', 0.0, 'none', w=0.36, h=0.62)], t=0.14, mat=mat, core='stoneDark', rh=0.14)
    k.face('front', w, d)
    door(k, 0.0, w=0.36, h=0.62, depth=0.1, mat='planksDark', studs=True)
    k.pop()
    r = w / 2 + 0.06
    n = 12
    pts = [(math.cos(math.pi * i / n) * r, h + math.sin(math.pi * i / n) * r * 0.75) for i in range(n + 1)]
    # the vault runs front to back: a section in (x, y) extruded along z
    verts, faces = [], []
    for zz in (-d / 2 - 0.06, d / 2 + 0.06):
        for (x, y) in pts:
            verts.append(V(x, y, zz))
        for (x, y) in pts[::-1]:
            verts.append(V(x * 0.9, y - 0.05 * (1 if y > h + 0.01 else 0), zz))
    m = len(pts) * 2
    faces.append(tuple(range(m)))
    faces.append(tuple(range(m, 2 * m))[::-1])
    for i in range(m):
        j = (i + 1) % m
        faces.append((i, m + i, m + j, j))
    k.mesh('stone', verts, faces, uvscale=2.0)
    # gable ends filled
    for s in (-1, 1):
        sec = [(x * 0.93, y) for (x, y) in pts]
        k.mesh(mat, [V(x, y, s * (d / 2 + 0.005)) for (x, y) in sec], [tuple(range(len(sec)))[::(1 if s > 0 else -1)]], uvscale=2.0)
    for s in (-1, 1):
        for zz in (-d / 4, d / 4):
            prism(k, mat, [(0.0, 0.0), (0.2, 0.0), (0.06, h * 0.9), (0.0, h * 0.95)], -0.07, 0.07, uvscale=2.0) if False else None
            k.push(s * w / 2, 0, zz, s * math.pi / 2)
            prism(k, mat, [(0.0, 0.0), (0.2, 0.0), (0.05, h * 0.9), (0.0, h * 0.95)], -0.07, 0.07, uvscale=2.0)
            k.pop()
    for s in (-1, 1):
        k.box('black', 0.05, 0.1, 0.03, s * (w / 2 + 0.005), h * 0.6, 0, ry=math.pi / 2)


@building('fort')
def fort(k):
    """a coral-stone fort: battered ramparts with a cordon, a parapet pierced for guns, iron guns on truck
    carriages, Spanish garitas on the corners, a gate with a stone portal, the barracks, a vaulted powder
    magazine and the flagstaff"""
    W, D = 8.7, 5.7
    walk, par = 0.8, 0.42
    db, ds, df = 1.25, 1.1, 1.25
    k.box('dirt', W - 0.4, 0.012, D - 0.4, 0, 0, 0, uvscale=0.5)
    # back (seaward) wall, four guns
    k.face('back', W, D)
    rampart(k, W, db, walk, par, emb=(-2.4, -0.8, 0.8, 2.4))
    for x in (-2.4, -0.8, 0.8, 2.4):
        gun(k, x, -0.68, 0, walk)
    for x in (-1.6, 1.6):
        k.push(0, walk + 0.015, 0)
        shot_pile(k, x, -0.75, 3)
        k.pop()
    k.pop()
    # front wall with the gate and two guns
    k.face('front', W, D)
    rampart(k, W, df, walk, par, emb=(-2.8, 2.8), gate=(0.0, 0.78, 0.68))
    for x in (-2.8, 2.8):
        gun(k, x, -0.68, 0, walk)
    k.pop()
    # side walls, one gun each
    for f in ('left', 'right'):
        k.face(f, W, D)
        rampart(k, D - db - df + 0.2, ds, walk, par, emb=(0.0,), ends=(False, False))
        gun(k, 0.0, -0.68, 0, walk)
        k.push(0, walk + 0.015, 0)
        shot_pile(k, 0.7, -0.75, 3)
        k.pop()
        k.pop()
    # garitas on the four corners
    for sx in (-1, 1):
        for sz in (-1, 1):
            garita(k, sx * (W / 2 - 0.12), walk + par - 0.02, sz * (D / 2 - 0.12), math.atan2(sx, sz))
    # gate: timber leaves, voussoirs and a portal of pilasters and a pediment
    k.face('front', W, D)
    gw, gh = 0.78, 0.68
    for s in (-1, 1):
        k.push(s * gw / 4, 0.0, -0.12)
        n = 4
        for i in range(n):
            k.box('planksDark', gw / 2 / n - 0.006, gh - 0.02, 0.05, -gw / 4 + (i + 0.5) * gw / 2 / n, 0, 0, uvscale=1.3, grain=1)
        for yy in (0.1, 0.32, 0.55):
            k.box('iron', gw / 2 - 0.02, 0.03, 0.012, 0, yy, 0.03)
        k.pop()
    for i in range(9):
        a = math.pi * i / 8
        k.cbox('stone', 0.1, 0.13, 0.06, math.cos(a) * (gw / 2 + 0.06), gh - 0.12 + math.sin(a) * 0.12, 0.02, rz=a - math.pi / 2, uvscale=2.0)
    for s in (-1, 1):
        k.box('stone', 0.16, walk + par + 0.2, 0.08, s * (gw / 2 + 0.2), 0, 0.02, uvscale=2.0)
        k.box('stone', 0.2, 0.08, 0.11, s * (gw / 2 + 0.2), walk + par + 0.2, 0.02, uvscale=2.0)
        k.cyl('stone', 0.05, 0.04, 0.12, s * (gw / 2 + 0.2), walk + par + 0.28, 0.02, seg=8)
        sphere(k, 'iron', 0.045, s * (gw / 2 + 0.2), walk + par + 0.45, 0.02, seg=8, rings=5)
    k.box('stone', gw + 0.56, 0.1, 0.1, 0, walk + par + 0.1, 0.02, uvscale=2.0)
    prism(k, 'stone', [(0.07, 0.0), (-0.03, 0.0), (-0.03, 0.3), (0.07, 0.3)], -0.001, 0.001) if False else None
    k.mesh('stone', [V(-0.42, walk + par + 0.2, 0.06), V(0.42, walk + par + 0.2, 0.06), V(0.0, walk + par + 0.45, 0.06),
                     V(-0.42, walk + par + 0.2, -0.02), V(0.42, walk + par + 0.2, -0.02), V(0.0, walk + par + 0.45, -0.02)],
           [(0, 1, 2), (5, 4, 3), (1, 4, 5, 2), (3, 0, 2, 5), (0, 3, 4, 1)], uvscale=2.0)
    k.box('stoneDark', 0.3, 0.22, 0.02, 0, walk + 0.05, 0.03, uvscale=2.0)  # carved panel
    lantern(k, -gw / 2 - 0.36, 0.85, 0.02)
    k.pop()
    # stairs up to the walls, inside the front wall either side of the gate
    zin = D / 2 - df
    for s in (-1, 1):
        n = 8
        for i in range(n):
            x = s * (0.65 + i * 0.15)
            k.box('stone', 0.15, walk * (i + 1) / n, 0.38, x + s * 0.075, 0, zin - 0.19, uvscale=2.0)
    # barracks against the back wall
    zb = -D / 2 + db
    k.push(-2.0, 0, zb + 0.6)
    plinth(k, 2.1, 1.0, 0.1)
    k.push(0, 0.1, 0)
    plastered(k, 2.0, 0.92, 0.8, 'plasterYellow', [Op('front', -0.45, 'door', h=0.7), Op('front', 0.35, 'window'), Op('left', 0.0, 'window')])
    tile_gable(k, 2.0, 0.92, 0.42, over=0.12, y=0.8, gable='plasterYellow')
    chimney(k, 0.75, -0.25, 0.7, 0.62, 0.22)
    k.pop()
    k.pop()
    k.push(-2.0, 0, zb + 1.3)
    k.box('planks', 0.8, 0.04, 0.14, 0.5, 0.22, 0)
    for xx in (0.2, 0.8):
        k.box('wood', 0.05, 0.22, 0.1, xx, 0, 0)
    rammer(k, V(-0.9, 0.0, -0.1), V(-0.82, 0.95, -0.2))
    rammer(k, V(-0.8, 0.0, -0.1), V(-0.75, 0.95, -0.2), head='darkwood')
    k.pop()
    # powder magazine
    k.push(2.25, 0, zb + 0.62)
    plinth(k, 1.25, 1.0, 0.08, mat='stoneDark')
    k.push(0, 0.08, 0)
    barrel_vault_house(k, 1.1, 0.88, 0.62)
    k.pop()
    k.pop()
    for i, (x, z) in enumerate(((1.45, zb + 1.35), (1.7, zb + 1.45), (1.58, zb + 1.62))):
        cask(k, x, z, 0.62, ry=i)
    cask(k, 3.0, zb + 1.5, 0.62, lying=True, ry=0.4)
    # flagstaff on a stepped stone base, with halyards
    fx, fz = 0.25, zb + 0.75
    k.box('stone', 0.55, 0.1, 0.55, fx, 0, fz, uvscale=2.0)
    k.box('stone', 0.38, 0.1, 0.38, fx, 0.1, fz, uvscale=2.0)
    k.cyl('wood', 0.045, 0.028, 3.2, fx, 0.2, fz, seg=10)
    sphere(k, 'wood', 0.04, fx, 3.42, fz, seg=8, rings=5)
    k.beam('wood', V(fx - 0.3, 2.7, fz), V(fx + 0.3, 2.7, fz), 0.03, round_=True, seg=6)
    k.beam('rope', V(fx + 0.04, 0.35, fz), V(fx + 0.04, 3.36, fz), 0.008, round_=True, seg=4)
    k.beam('rope', V(fx - 0.3, 2.7, fz), V(fx - 0.25, 0.2, fz + 0.2), 0.006, round_=True, seg=4)
    k.beam('rope', V(fx + 0.3, 2.7, fz), V(fx + 0.25, 0.2, fz - 0.2), 0.006, round_=True, seg=4)
    k.cyl('wood', 0.015, 0.015, 0.1, fx + 0.05, 0.6, fz, seg=5, rz=math.pi / 2)
    k.marker('flag', fx, 3.38, fz)
    # shot, a gun cart and a spare carriage in the yard
    shot_pile(k, -0.6, 0.6, 4)
    shot_pile(k, 0.9, 0.7, 3)
    k.push(-2.6, 0, 0.75, 0.6)
    for s in (-1, 1):
        k.cyl('wood', 0.2, 0.2, 0.04, s * 0.25 + 0.02, 0.2, 0, seg=14, rz=math.pi / 2)
    k.box('planks', 0.42, 0.05, 0.8, 0, 0.22, -0.1)
    k.beam('wood', V(-0.12, 0.25, 0.3), V(-0.15, 0.06, 0.85), 0.04)
    k.beam('wood', V(0.12, 0.25, 0.3), V(0.15, 0.06, 0.85), 0.04)
    for i in range(3):
        sphere(k, 'iron', 0.034, -0.1 + i * 0.1, 0.305, -0.2, seg=8, rings=5)
    cask(k, 0.05, -0.35, 0.5, y=0.245)
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- protective cannon

@building('protective_cannon')
def protective_cannon(k):
    """a single gun on a dressed-stone emplacement behind a low curved breastwork, with a shot pyramid,
    a powder keg under a canvas, and a rammer"""
    k.push(0, 0, 0)
    # octagonal platform: a coursed rubble drum capped with dressed slabs
    r = 0.44
    k.cyl('stoneDark', r, r * 0.98, 0.1, 0, 0, 0, seg=8, ry=math.pi / 8)
    if not k.lod:
        for j in range(2):
            for i in range(16):
                a = math.pi * 2 * (i + 0.5 * j) / 16
                k.cbox('stone', 0.155, 0.045, 0.03, math.cos(a) * (r * 0.92 + 0.012), 0.027 + j * 0.05, math.sin(a) * (r * 0.92 + 0.012),
                       ry=-a + math.pi / 2, uvscale=2.0)
        for i in range(4):
            for j in range(4):
                if math.hypot(-0.3 + i * 0.2, -0.3 + j * 0.2) < 0.4:
                    k.box('stone', 0.19, 0.02, 0.19, -0.3 + i * 0.2, 0.1, -0.3 + j * 0.2, ry=(k.r() - 0.5) * 0.03, uvscale=2.0)
    k.cyl('stone', r + 0.01, r + 0.01, 0.018, 0, 0.095, 0, seg=8, ry=math.pi / 8)
    # curved breastwork at the front, open behind
    for i in range(7):
        a = math.pi * 0.2 + i * math.pi * 0.6 / 6
        x, z = math.cos(a) * 0.41, math.sin(a) * 0.41
        if abs(x) < 0.08:
            continue
        k.cbox('stone', 0.14, 0.2, 0.09, x, 0.2, z, ry=-a + math.pi / 2, uvscale=2.0)
        k.cbox('stoneDark', 0.15, 0.03, 0.1, x, 0.315, z, ry=-a + math.pi / 2, uvscale=2.0)
    k.pop()
    gun(k, 0.0, -0.08, 0, 0.11, s=0.8)
    k.push(0, 0.113, 0)
    shot_pile(k, -0.27, -0.24, 2, r=0.03, ry=0.3)
    k.pop()
    cask(k, 0.27, -0.25, 0.45, y=0.113)
    if not k.lod:
        rammer(k, V(-0.36, 0.113, -0.05), V(-0.3, 0.42, 0.3))
    return {'ao': 512}


# ------------------------------------------------------------------------------------------- watch tower

def bell(k, x, y, z, r=0.09):
    """a ship's bell hung at y (top of the crown) with its clapper and lanyard"""
    h = r * 1.25
    prof = [(r * 1.0, -h), (r * 1.02, -h + 0.012), (r * 0.9, -h + 0.03), (r * 0.72, -h * 0.6), (r * 0.62, -h * 0.25), (r * 0.6, -0.02), (r * 0.4, 0.0), (0.01, 0.005)]
    k.push(x, y, z)
    lathe(k, 'brass', prof, seg=16, cap0=False)
    k.cyl('black', r * 0.93, r * 0.93, 0.004, 0, -h + 0.004, 0, seg=14)
    k.box('iron', 0.03, 0.04, 0.03, 0, 0.0, 0)
    k.beam('iron', V(0, -0.01, 0), V(0, -h - 0.02, 0), 0.01, round_=True, seg=5)
    sphere(k, 'iron', 0.016, 0, -h - 0.02, 0, seg=6, rings=4)
    k.beam('rope', V(0, -h - 0.03, 0), V(0.01, -h - 0.45, 0.02), 0.01, round_=True, seg=4)
    k.pop()


@building('watch_tower')
def watch_tower(k):
    """a tall timber lookout: four raked pole legs on stone pads, girts and cross bracing, a planked
    platform with a breastwork, a thatched cap, an alarm bell and a ladder"""
    b, t, ph = 0.7, 0.5, 2.5
    legs = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            a, c = V(sx * b, -0.05, sz * b), V(sx * t, ph + 0.95, sz * t)
            legs.append((sx, sz))
            k.beam('bark', a, c, 0.12, round_=True, seg=9)
            k.cyl('stone', 0.11, 0.1, 0.08, sx * b, 0, sz * b, seg=8)
    def at(sx, sz, y):
        f = (y + 0.05) / (ph + 1.0)
        return V(sx * (b + (t - b) * f), y, sz * (b + (t - b) * f))
    levels = (0.25, 1.15, 2.05)
    for (s1, s2) in (((-1, 1), (1, 1)), ((-1, -1), (1, -1)), ((-1, -1), (-1, 1)), ((1, -1), (1, 1))):
        front = s1[1] == 1 and s2[1] == 1
        for y in levels:
            k.beam('wood', at(*s1, y) + (at(*s1, y) - V(0, y, 0)).normalized() * 0.0, at(*s2, y), 0.07, 0.07)
        if front:
            continue
        for i in range(len(levels) - 1):
            k.beam('wood', at(*s1, levels[i] + 0.05), at(*s2, levels[i + 1] - 0.05), 0.05, 0.04)
            k.beam('wood', at(*s2, levels[i] + 0.05), at(*s1, levels[i + 1] - 0.05), 0.05, 0.04)
    # platform on bearers, cantilevered a little
    for s in (-1, 1):
        k.beam('darkwood', V(-0.72, ph - 0.1, s * 0.5), V(0.72, ph - 0.1, s * 0.5), 0.09, 0.08)
    deck(k, 1.36, 1.36, ph + 0.04, 'planks', along='x', joists=False)
    k.box('darkwood', 1.4, 0.06, 1.4, 0, ph - 0.07, 0)
    for f in FACES:
        k.face(f, 1.36, 1.36)
        n = 10
        for i in range(n):
            x = -0.68 + (i + 0.5) * 1.36 / n
            if f == 'front' and abs(x) < 0.2:
                continue
            k.box('oldplanks', 1.36 / n - 0.008, 0.42 + (k.r() - 0.5) * 0.02, 0.025, x, ph + 0.04, -0.015, uvscale=1.3, grain=1)
        k.box('wood', 1.4, 0.05, 0.08, 0, ph + 0.46, -0.03)
        k.pop()
    # roof posts and cap
    for s in (-1, 1):
        k.box('darkwood', 1.2, 0.08, 0.08, 0, ph + 0.95, s * 0.5)
        k.box('darkwood', 0.08, 0.08, 1.2, s * 0.5, ph + 1.03, 0)
        for s2 in (-1, 1):
            k.beam('wood', at(s, s2, ph + 0.6) + V(0, 0, 0), V(s * 0.25, ph + 0.95, s2 * 0.5), 0.05, 0.05)
    thatch_cone(k, 0.95, 0.7, y=ph + 1.1, mat='thatch')
    k.box('darkwood', 1.1, 0.05, 0.06, 0, ph + 0.93, 0.25)
    bell(k, 0.25, ph + 0.93, 0.25, 0.085)
    lantern(k, -0.3, ph + 0.91, -0.46)
    if not k.lod:
        musket(k, V(-0.55, ph + 0.05, 0.55), V(0.05, 1, -0.06))
        k.cyl('brass', 0.018, 0.024, 0.3, 0.45, ph + 0.5, -0.5, seg=8, rz=math.pi / 2)  # a spyglass on the rail
    # ladder up the front to the gap in the breastwork
    ladder(k, V(0.0, 0.0, 0.84), V(0.0, ph + 0.5, 0.64), w=0.28)
    return {'ao': 512}


# ------------------------------------------------------------------------------------------- anchor

@building('anchor')
def anchor(k):
    """a great admiralty anchor set up on a stone block: shank, curved arms with spade palms, a timber
    stock bound with iron, the ring, and a length of heavy chain"""
    k.box('stoneDark', 0.62, 0.1, 0.5, 0, 0, 0, uvscale=2.0)
    k.box('stone', 0.66, 0.025, 0.54, 0, 0.1, 0, uvscale=2.0)
    base = 0.125
    R, c = 0.36, base + 0.36 + 0.02
    # crown and arms
    sphere(k, 'iron', 0.055, 0, base + 0.03, 0, seg=10, rings=6, squash=0.8)
    n = 7
    pts = []
    for s in (-1, 1):
        prev = None
        vs, fs = [], []
        m = 12
        for i in range(m + 1):
            a = -math.pi / 2 + s * (i / m) * math.radians(78)
            rad = V(math.cos(a), math.sin(a), 0)
            p = V(0, c, 0) + rad * R
            th = 0.08 - 0.04 * (i / m)
            for (u, w_) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                vs.append(p + rad * (u * th / 2) + V(0, 0, w_ * th * 0.42))
            prev = p
        for i in range(m):
            for j in range(4):
                a0, a1 = i * 4 + j, i * 4 + (j + 1) % 4
                f = (a0, a1, a1 + 4, a0 + 4)
                fs.append(f if s > 0 else f[::-1])
        fs.append((3, 2, 1, 0) if s > 0 else (0, 1, 2, 3))
        k.mesh('iron', vs, fs)
        tip = prev
        # palm: a spade-shaped plate on the inner face near the tip
        a1 = -math.pi / 2 + s * math.radians(50)
        a2 = -math.pi / 2 + s * math.radians(78)
        p1 = V(math.cos(a1) * R, c + math.sin(a1) * R, 0)
        tan = (tip - p1).normalized()
        inward = (V(0, c, 0) - (p1 + tip) / 2).normalized()
        zz = V(0, 0, 1)
        pa = p1 + inward * 0.02
        pm = p1 + tan * (tip - p1).length * 0.5 + inward * 0.03
        pb = tip + tan * 0.06 + inward * 0.03
        vs = []
        for off in (-0.012, 0.012):
            o = inward * off
            vs += [pa + o, pm - zz * 0.085 + o, pb + o, pm + zz * 0.085 + o]
        fs = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        if s < 0:
            fs = [f[::-1] for f in fs]
        k.mesh('iron', vs, fs)
        # check the normal points the right way by testing one face; flip if needed
    # shank
    k.beam('iron', V(0, base + 0.02, 0), V(0, 1.08, 0), 0.075, 0.06)
    k.box('iron', 0.09, 0.05, 0.075, 0, 1.06, 0)
    k.torus('iron', 0.085, 0.017, 0, 1.17, 0, rx=math.pi / 2, seg=14, rseg=5)
    # stock: two oak halves, tapering to the ends, iron bound
    for s in (-1, 1):
        L = 0.44
        k.mesh('darkwood', [V(-0.045, 0.94, 0.0), V(0.045, 0.94, 0.0), V(0.045, 1.01, 0.0), V(-0.045, 1.01, 0.0),
                            V(-0.03, 0.955, s * L), V(0.03, 0.955, s * L), V(0.03, 0.995, s * L), V(-0.03, 0.995, s * L)],
               [(0, 3, 2, 1)[::(1 if s > 0 else -1)], (4, 5, 6, 7)[::(1 if s > 0 else -1)], (0, 1, 5, 4)[::(1 if s > 0 else -1)],
                (1, 2, 6, 5)[::(1 if s > 0 else -1)], (2, 3, 7, 6)[::(1 if s > 0 else -1)], (3, 0, 4, 7)[::(1 if s > 0 else -1)]], uvscale=1.3, bevel=0.004)
        for zz in (0.1, 0.25, 0.38):
            k.cbox('iron', 0.1 - zz * 0.07, 0.076 - zz * 0.05, 0.022, 0, 0.975, s * zz)
    # chain from the ring down to a heap on the block
    chain(k, [V(0, 1.12, 0.06), V(0.05, 0.9, 0.13), V(0.14, 0.55, 0.17), V(0.2, 0.25, 0.18), V(0.24, 0.135, 0.12)], link=0.036, wire=0.009)
    chain(k, [V(0.24, 0.135, 0.12), V(0.18, 0.15, 0.0), V(0.24, 0.16, -0.12), V(0.12, 0.17, -0.06), V(0.2, 0.18, 0.08)], link=0.036, wire=0.009)
    rope_coil(k, -0.18, 0.15, 0.08) if False else None
    return {'ao': 512}
