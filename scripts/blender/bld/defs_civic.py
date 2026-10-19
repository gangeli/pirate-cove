"""Civic, trade and decoration buildings: church, graveyard, apothecary, surgery, hat shop, aviary, animal pit,
black market, pirate cave, smuggler's cove and the 1x1 decor pieces (game coordinates: y up, +z front)."""
from defs import building
from arch import *
import math
from mathutils import Vector, Matrix, Euler, noise

TAU = math.tau


# ------------------------------------------------------------------------------------------- helpers

def _xf(x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0, rz=0.0, sx=1.0, sy=1.0, sz=1.0):
    return (Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()
            @ Matrix.Diagonal((sx, sy, sz, 1.0)))


def lathe(k, mat, prof, x=0, y=0, z=0, seg=12, ry=0, rx=0, rz=0, caps=(True, True), uvscale=1.0, s=1.0):
    """a surface of revolution about local y from (r, y) pairs (bottom to top)"""
    if k.lod:
        seg = max(6, seg // 2)
    verts, faces = [], []
    for (r, yy) in prof:
        for i in range(seg):
            a = TAU * i / seg
            verts.append(V(math.cos(a) * r * s, yy * s, math.sin(a) * r * s))
    n = len(prof)
    for j in range(n - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    if caps[0] and prof[0][0] > 1e-4:
        faces.append(tuple(range(seg)))
    if caps[1] and prof[-1][0] > 1e-4:
        faces.append(tuple(range((n - 1) * seg, n * seg))[::-1])
    k.mesh(mat, verts, faces, uvscale=uvscale, local=_xf(x, y, z, ry, rx, rz))


def blob(k, mat, x, y, z, ex, ey, ez, amp=0.12, freq=2.2, seed=0.0, rings=8, seg=12, ry=0.0, rx=0.0, rz=0.0,
         flat=None, uvscale=1.0, ridge=0.0):
    """a noise-displaced ellipsoid (rocks, shrubs, mounds, heads); flat squashes everything below that local y"""
    if k.lod:
        rings, seg = max(4, rings // 2), max(6, seg // 2)
    verts, faces = [], []
    off = Vector((seed * 1.7, seed * 0.9, seed * 2.3))

    def pt(d):
        n = noise.noise(d * freq + off)
        if ridge:
            n = n * (1 - ridge) + ridge * (0.5 - abs(noise.noise(d * freq * 2.3 + off * 1.3)))
        r = 1 + amp * n
        p = Vector((d.x * ex * r, d.y * ey * r, d.z * ez * r))
        if flat is not None and p.y < flat:
            p.y = flat + (p.y - flat) * 0.12
        return p
    verts.append(pt(Vector((0, -1, 0))))
    for j in range(1, rings):
        ph = -math.pi / 2 + math.pi * j / rings
        for i in range(seg):
            a = TAU * i / seg
            verts.append(pt(Vector((math.cos(ph) * math.cos(a), math.sin(ph), math.cos(ph) * math.sin(a)))))
    verts.append(pt(Vector((0, 1, 0))))
    top = len(verts) - 1
    for i in range(seg):
        faces.append((0, 1 + i, 1 + (i + 1) % seg))
    for j in range(rings - 2):
        for i in range(seg):
            a = 1 + j * seg + i
            b = 1 + j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    base = 1 + (rings - 2) * seg
    for i in range(seg):
        faces.append((top, base + (i + 1) % seg, base + i))
    k.mesh(mat, verts, faces, uvscale=uvscale, local=_xf(x, y, z, ry, rx, rz))


def slab(k, mat, pts, t, x=0, y=0, z=0, ry=0, rx=0, rz=0, bevel=0.0, uvscale=1.0):
    """a polygon (x, y pairs, counter-clockwise seen from +z) extruded t thick about z=0"""
    n = len(pts)
    verts = [V(px, py, t / 2) for (px, py) in pts] + [V(px, py, -t / 2) for (px, py) in pts]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    k.mesh(mat, verts, faces, uvscale=uvscale, bevel=bevel, local=_xf(x, y, z, ry, rx, rz))


def arc_pts(cx, cy, r, a0, a1, n):
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * r, cy + math.sin(a0 + (a1 - a0) * i / n) * r) for i in range(n + 1)]


def limb(k, mat, a, b, r0, r1, seg=7):
    """a tapered round member from a to b (branches, bones, tusks)"""
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-4:
        return
    e = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_euler('YXZ')
    k.cyl(mat, r0, r1, d.length, a.x, a.y, a.z, seg=seg, rx=e.x, ry=e.y, rz=e.z)


def rubble_wall(k, a, b, h=0.32, t=0.15, mat='stone', gaps=(), cope=True, tumble=None):
    """a dry-laid coral-rag wall between two ground points; gaps are (t0, t1) fractions left open"""
    a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
    L = (b - a).length
    ang = math.atan2(-(b - a).z, (b - a).x)
    k.push(a.x, 0, a.z, ang)
    if k.lod:
        segs = [(0.0, 1.0)]
        for (g0, g1) in gaps:
            segs = [s for (p, q) in segs for s in ([(p, q)] if g1 <= p or g0 >= q else [(p, g0), (g1, q)]) if s[1] - s[0] > 0.01]
        for (p, q) in segs:
            k.box(mat, (q - p) * L, h, t, (p + q) / 2 * L, 0, 0, uvscale=2.0)
        k.pop()
        return
    rows = max(2, round(h / 0.085))
    rh = h / rows
    for r in range(rows):
        x = 0.0 if r % 2 == 0 else -0.06
        while x < L - 0.02:
            sw = 0.08 + k.r() * 0.09
            x0, x1 = max(0.0, x), min(L, x + sw)
            mid = (x0 + x1) / 2 / L
            x += sw
            if x1 - x0 < 0.03 or any(g0 < mid < g1 for (g0, g1) in gaps):
                continue
            if tumble and tumble[0] < mid < tumble[1] and r >= rows - 1 - int(k.r() * 2):
                continue  # collapsed section
            k.cbox(mat, x1 - x0 - 0.012, rh - 0.01, t * (0.85 + k.r() * 0.2), (x0 + x1) / 2, r * rh + rh / 2, (k.r() - 0.5) * 0.02,
                   ry=(k.r() - 0.5) * 0.1, rx=(k.r() - 0.5) * 0.1, rz=(k.r() - 0.5) * 0.08, uvscale=2.0)
    if L > 0.1:
        k.box('stoneDark', L - 0.06, h * 0.85, t * 0.5, L / 2, 0, 0, uvscale=2.0)  # mortar core
    if cope:
        n = max(1, round(L / 0.14))
        for i in range(n):
            mid = (i + 0.5) / n
            if any(g0 < mid < g1 for (g0, g1) in gaps) or (tumble and tumble[0] < mid < tumble[1]):
                continue
            k.cbox('stone', L / n - 0.01, 0.05, t + 0.03, mid * L, h + 0.02, 0, rz=(k.r() - 0.5) * 0.06, ry=(k.r() - 0.5) * 0.06, uvscale=2.0)
    k.pop()


def headstone(k, x, z, ry=0.0, lean=0.0, w=0.2, h=0.3, t=0.05, kind='round', mat='stone', tilt=0.0):
    """a carved grave marker sunk into the ground; kinds: round, gable, cross"""
    k.push(x, 0, z, ry, lean, tilt)
    if kind == 'round':
        pts = [(-w / 2, -0.06), (w / 2, -0.06)] + arc_pts(0, h - w / 2, w / 2, 0, math.pi, 4 if k.lod else 10)
        slab(k, mat, pts, t, bevel=0.006, uvscale=2.0)
        if not k.lod:
            k.box('stoneDark', w * 0.12, h * 0.38, 0.008, 0, h * 0.42, t / 2 + 0.002, uvscale=2.0)
            k.box('stoneDark', w * 0.42, w * 0.12, 0.008, 0, h * 0.68, t / 2 + 0.002, uvscale=2.0)
    elif kind == 'gable':
        pts = [(-w / 2, -0.06), (w / 2, -0.06), (w / 2, h - w * 0.3), (0, h), (-w / 2, h - w * 0.3)]
        slab(k, mat, pts, t, bevel=0.006, uvscale=2.0)
        if not k.lod:
            k.box('stoneDark', w * 0.7, h * 0.35, 0.008, 0, h * 0.25, t / 2 + 0.002, uvscale=2.0)
    else:  # cross
        k.box(mat, w * 0.3, h + 0.06, t, 0, -0.06, 0, uvscale=2.0)
        k.box(mat, w, w * 0.28, t, 0, h * 0.62, 0, uvscale=2.0)
        k.box('stoneDark', w * 0.6, 0.05, t + 0.05, 0, -0.01, 0, uvscale=2.0)
    k.pop()


def wood_cross(k, x, z, ry=0.0, lean=0.0, tilt=0.0, h=0.42, mat='darkwood'):
    """two lashed timbers, weathered and crooked"""
    k.push(x, 0, z, ry, lean, tilt)
    k.box(mat, 0.042, h + 0.06, 0.035, 0, -0.06, 0)
    k.box(mat, 0.24, 0.038, 0.03, 0, h * 0.68, 0.03, rz=(k.r() - 0.5) * 0.15)
    if not k.lod:
        for i in range(3):
            k.box('rope', 0.042, 0.008, 0.046, 0, h * 0.68 - 0.012 + i * 0.012, 0.012, rz=0.5 if i % 2 else -0.5)
    k.pop()


def mound(k, x, z, ry=0.0, fresh=False, l=0.42, w=0.24):
    blob(k, 'soil', x, 0.0, z, w / 2, 0.075 if fresh else 0.05, l / 2, amp=0.2, freq=3.0, seed=x * 3 + z,
         rings=6, seg=10, ry=ry, flat=0.0)


def skull(k, x, y, z, s=1.0, ry=0.0, rx=0.0, rz=0.0, jaw=True):
    """a human skull, ~0.12 tall at s=1: cranium, brow, cheekbones, sockets, nasal cavity, teeth, mandible"""
    k.push(x, y, z, ry, rx, rz)
    blob(k, 'bone', 0, 0.072 * s, -0.008 * s, 0.05 * s, 0.052 * s, 0.062 * s, amp=0.04, freq=1.5, seed=x + z, rings=7, seg=12)
    blob(k, 'bone', 0, 0.035 * s, 0.03 * s, 0.038 * s, 0.03 * s, 0.03 * s, amp=0.05, freq=1.5, seed=3 + x, rings=5, seg=10)
    if not k.lod:
        for sx in (-1, 1):
            blob(k, 'black', sx * 0.019 * s, 0.056 * s, 0.047 * s, 0.014 * s, 0.013 * s, 0.01 * s, amp=0.0, rings=4, seg=8)
            k.cbox('bone', 0.03 * s, 0.012 * s, 0.03 * s, sx * 0.034 * s, 0.036 * s, 0.03 * s, ry=sx * 0.5)
        k.cbox('black', 0.012 * s, 0.018 * s, 0.01 * s, 0, 0.034 * s, 0.057 * s, rx=-0.3)
        k.cbox('bone', 0.04 * s, 0.012 * s, 0.012 * s, 0, 0.012 * s, 0.048 * s)
        k.cbox('black', 0.036 * s, 0.002 * s, 0.013 * s, 0, 0.012 * s, 0.048 * s)
    if jaw:
        k.cbox('bone', 0.05 * s, 0.014 * s, 0.04 * s, 0, 0.0, 0.03 * s, rx=0.15)
    k.pop()


def tree_dead(k, x, z, h=1.6, seed=1.0):
    """a gnarled dead tree: a leaning trunk forking into bare, twisting limbs"""
    import random
    rnd = random.Random(seed)

    def grow(p, d, L, r, depth):
        q = p + d * L
        limb(k, 'bark', p, q, r, r * 0.68, seg=7 if depth < 2 else 5)
        if depth >= (2 if k.lod else 3) or r < 0.008:
            return
        for i in range(2 if depth else 3):
            nd = (d + Vector(((rnd.random() - 0.5) * 1.6, 0.25 + rnd.random() * 0.4, (rnd.random() - 0.5) * 1.6))).normalized()
            grow(q, nd, L * (0.55 + rnd.random() * 0.2), r * 0.62, depth + 1)
    blob(k, 'bark', x, 0.0, z, 0.1, 0.06, 0.1, amp=0.3, seed=seed, rings=4, seg=8, flat=0.0)  # root flare
    grow(Vector((x, 0, z)), Vector((0.12, 1, 0.05)).normalized(), h * 0.45, 0.055, 0)


def tuft(k, x, z, s=1.0, mat='leaf', n=7):
    """a clump of rank grass or weeds"""
    if k.lod:
        return
    for i in range(n):
        a = TAU * i / n + k.r()
        L = (0.08 + k.r() * 0.06) * s
        k.mesh(mat, [V(x - 0.006, 0, z), V(x + 0.006, 0, z), V(x + math.cos(a) * L * 0.5, L, z + math.sin(a) * L * 0.5)], [(0, 1, 2), (2, 1, 0)])


def spade(k, x, y, z, ry=0.0, lean=0.35):
    """a sexton's spade standing in the spoil, blade buried"""
    k.push(x, y, z, ry, lean)
    k.box('iron', 0.1, 0.13, 0.012, 0, -0.08, 0)
    k.cyl('wood', 0.013, 0.012, 0.55, 0, 0.04, 0, seg=6)
    k.box('wood', 0.09, 0.02, 0.02, 0, 0.6, 0)
    k.pop()


def coffin(k, x, y, z, ry=0.0, lid_off=0.0, s=1.0):
    """a six-sided pine coffin with its lid"""
    k.push(x, y, z, ry)
    L, W, H = 0.44 * s, 0.17 * s, 0.09 * s
    pts = [(-W * 0.32, -L / 2), (W * 0.32, -L / 2), (W / 2, L * 0.22), (W * 0.36, L / 2), (-W * 0.36, L / 2), (-W / 2, L * 0.22)]
    slab(k, 'planks', pts, H, y=H / 2, rx=-math.pi / 2, bevel=0.004, uvscale=1.5)
    slab(k, 'planksDark', [(px * 1.05, py * 1.03) for (px, py) in pts], 0.018, x=lid_off * 0.3, y=H + 0.009 + lid_off * 0.04, z=lid_off * 0.15,
         rx=-math.pi / 2, rz=0.0, ry=lid_off * 0.4, bevel=0.003, uvscale=1.5)
    k.pop()


def parrot(k, x, y, z, ry=0.0, kind='scarlet', s=1.0, pitch=0.0):
    """a perched parrot (feet at the origin, facing +z): body, head with a hooked beak, folded wings, long tail"""
    body, wing, tail, face = {'scarlet': ('red', 'plasterBlue', 'red', 'bone'), 'blue': ('plasterBlue', 'plasterBlue', 'plasterBlue', 'bone'),
                              'gold': ('plasterYellow', 'plasterBlue', 'plasterBlue', 'bone'), 'green': ('leaf', 'leaf', 'leaf', 'leaf')}[kind]
    if kind == 'gold':
        wing = 'plasterBlue'
    k.push(x, y, z, ry, pitch)
    k.push(0, 0.02 * s, 0, 0, -0.45)
    lathe(k, body, [(0.002, 0.0), (0.022 * s, 0.012 * s), (0.031 * s, 0.045 * s), (0.029 * s, 0.08 * s), (0.02 * s, 0.105 * s), (0.002, 0.115 * s)], seg=9)
    if kind == 'gold':
        lathe(k, 'plasterBlue', [(0.024 * s, 0.07 * s), (0.031 * s, 0.081 * s), (0.021 * s, 0.107 * s), (0.002, 0.117 * s)], z=-0.003 * s, seg=9)
    for sx in (-1, 1):
        blob(k, wing, sx * 0.022 * s, 0.06 * s, -0.01 * s, 0.012 * s, 0.055 * s, 0.026 * s, amp=0.0, rings=5, seg=8, rz=-sx * 0.12, rx=-0.15)
    slab(k, tail, [(-0.016 * s, 0.0), (0.016 * s, 0.0), (0.006 * s, -0.17 * s), (-0.006 * s, -0.17 * s)], 0.006 * s, y=0.012 * s, z=-0.01 * s, rx=0.2)
    k.pop()
    # head
    hy, hz = 0.12 * s, 0.052 * s
    blob(k, body if kind != 'gold' else 'leaf', 0, hy, hz, 0.026 * s, 0.027 * s, 0.03 * s, amp=0.0, rings=6, seg=9)
    if not k.lod:
        for sx in (-1, 1):
            k.cbox(face, 0.004 * s, 0.018 * s, 0.022 * s, sx * 0.023 * s, hy - 0.002 * s, hz + 0.012 * s)
            k.cbox('black', 0.005 * s, 0.006 * s, 0.006 * s, sx * 0.024 * s, hy + 0.004 * s, hz + 0.012 * s)
    k.push(0, hy - 0.006 * s, hz + 0.024 * s, 0, 0.9)
    k.cyl('bone' if kind in ('scarlet', 'gold') else 'black', 0.012 * s, 0.002, 0.03 * s, 0, 0, 0, seg=6)
    k.pop()
    if not k.lod:
        for sx in (-1, 1):
            k.cbox('black', 0.008 * s, 0.006 * s, 0.018 * s, sx * 0.01 * s, 0.003 * s, 0.003 * s)
    k.pop()


def lantern_post(k, x, z, h=1.0, ry=0.0):
    k.push(x, 0, z, ry)
    k.box('darkwood', 0.06, h, 0.06, 0, 0, 0)
    k.box('stoneDark', 0.14, 0.06, 0.14, 0, 0, 0, uvscale=2.0)
    lantern(k, 0, h - 0.02, 0.03)
    k.pop()


# ------------------------------------------------------------------------------------------- graveyard

def _grave_plot(k, x, z, kind, ry=0.0, seed=0.0):
    """a marker at the head (towards -z) and the mound before it"""
    lean = (k.r() - 0.5) * 0.25
    tilt = (k.r() - 0.5) * 0.2
    if kind in ('round', 'gable', 'cross'):
        headstone(k, x, z - 0.2, ry + (k.r() - 0.5) * 0.2, lean, w=0.22 + k.r() * 0.05, h=0.34 + k.r() * 0.1, t=0.06, kind=kind, tilt=tilt)
        mound(k, x, z + 0.03, ry)
    elif kind == 'wood':
        wood_cross(k, x, z - 0.2, ry + (k.r() - 0.5) * 0.3, lean * 1.6, tilt * 2.0, h=0.46 + k.r() * 0.1)
        mound(k, x, z + 0.03, ry, fresh=k.r() > 0.5)
    elif kind == 'oar':
        # a sailor's grave: his oar for a marker, a tarred hat hung on the loom
        k.push(x, 0, z - 0.2, ry + 0.3, lean, tilt + 0.1)
        k.cyl('wood', 0.014, 0.014, 0.62, 0, -0.05, 0, seg=6)
        k.box('wood', 0.07, 0.2, 0.014, 0, 0.42, 0)
        k.pop()
        mound(k, x, z + 0.03, ry, fresh=True)
    elif kind == 'cutlass':
        wood_cross(k, x, z - 0.2, ry, lean, tilt, h=0.36)
        k.push(x + 0.02, 0, z + 0.05, ry, 0.12, 0.08)
        k.box('iron', 0.006, 0.26, 0.028, 0, 0.0, 0)
        k.cbox('brass', 0.08, 0.012, 0.02, 0, 0.26, 0)
        k.cyl('darkwood', 0.009, 0.009, 0.07, 0, 0.266, 0, seg=5)
        k.pop()
        mound(k, x, z + 0.03, ry)


@building('graveyard')
def graveyard(k):
    """Boot Hill: a walled burial ground of coral rag with a gate between piers, rows of headstones and
    crooked timber crosses, a chest tomb, a dead tree, an open grave with the spoil, the sexton's spade and a
    coffin waiting on trestles"""
    W, D = 2.7, 1.66
    hw, hd = W / 2, D / 2
    k.box('dirt', W - 0.1, 0.008, D - 0.1, 0, 0, 0, uvscale=0.8)
    # walls, one corner tumbled
    rubble_wall(k, (-hw, -hd), (hw, -hd), h=0.22, t=0.13, tumble=(0.72, 0.86))
    rubble_wall(k, (hw, -hd), (hw, hd), h=0.22, t=0.13)
    rubble_wall(k, (-hw, hd), (-hw, -hd), h=0.22, t=0.13)
    rubble_wall(k, (hw, hd), (-hw, hd), h=0.22, t=0.13, gaps=[(0.43, 0.57)])
    if not k.lod:
        for i in range(5):
            k.cbox('stone', 0.13, 0.08, 0.12, 0.6 + k.r() * 0.35, 0.04, -hd - 0.12 - k.r() * 0.1, ry=k.r() * 3, rx=k.r() * 0.4, uvscale=2.0)
    # gate piers with ball finials, and a sagging picket gate swung open
    for sx in (-1, 1):
        px = sx * 0.21
        k.box('stone', 0.17, 0.42, 0.18, px, 0, hd, uvscale=2.0)
        k.box('stone', 0.21, 0.04, 0.22, px, 0.42, hd, uvscale=2.0)
        lathe(k, 'stone', [(0.05, 0.46), (0.04, 0.48), (0.06, 0.52), (0.065, 0.56), (0.04, 0.61), (0.005, 0.62)], px, 0, hd, seg=10, uvscale=2.0)
    k.push(0.12, 0.04, hd + 0.02, -1.15)
    for i in range(5):
        k.box('oldplanks', 0.035, 0.34 - abs(i - 2) * 0.02, 0.018, -0.03 - i * 0.045, 0.0, 0.0, uvscale=1.4, grain=1)
    for yy in (0.06, 0.24):
        k.box('oldplanks', 0.23, 0.035, 0.018, -0.12, yy, 0.016)
    k.beam('oldplanks', V(-0.02, 0.07, 0.03), V(-0.21, 0.24, 0.03), 0.03, 0.015)
    k.pop()
    # the plots: two rows, heads to the west wall
    rows = [(-0.48, ['round', 'wood', 'gable', 'tomb', 'wood']), (0.18, ['wood', 'cross', 'open', 'oar', 'cutlass'])]
    xs = [-1.02, -0.55, -0.08, 0.42, 0.95]
    for (z, kinds) in rows:
        for x, kind in zip(xs, kinds):
            x += (k.r() - 0.5) * 0.06
            if kind == 'tomb':
                # a chest tomb for a captain: plinth, panelled body, overhanging ledger stone, skull and crossbones
                k.push(x + 0.05, 0, z - 0.02, 0.04)
                k.box('stoneDark', 0.52, 0.06, 0.32, 0, 0, 0, uvscale=2.0)
                k.box('stone', 0.46, 0.22, 0.26, 0, 0.06, 0, uvscale=2.0, bevel=0.01)
                for sx in (-1, 1):
                    k.box('stone', 0.05, 0.22, 0.28, sx * 0.21, 0.06, 0, uvscale=2.0)
                k.cbox('stone', 0.54, 0.045, 0.34, 0, 0.3, 0, rz=0.02, uvscale=2.0, bevel=0.012)
                if not k.lod:
                    k.box('stoneDark', 0.3, 0.13, 0.01, 0, 0.1, 0.13, uvscale=2.0)
                    skull(k, 0, 0.32, 0.06, 0.65, rx=-0.9, jaw=False)
                    for sx in (-1, 1):
                        limb(k, 'bone', V(sx * 0.07, 0.33, 0.12), V(-sx * 0.07, 0.33, -0.02), 0.009, 0.009, seg=5)
                k.pop()
            elif kind == 'open':
                # an open grave: dark shaft, cut edges, a spoil heap with the spade, planks across, a coffin on trestles
                k.box('black', 0.2, 0.004, 0.4, x, 0.0, z + 0.02)
                for sz in (-1, 1):
                    k.box('soil', 0.26, 0.025, 0.04, x, 0.0, z + 0.02 + sz * 0.22)
                for sx in (-1, 1):
                    k.box('soil', 0.04, 0.025, 0.48, x + sx * 0.12, 0.0, z + 0.02)
                blob(k, 'soil', x + 0.27, 0.0, z, 0.1, 0.12, 0.2, amp=0.25, freq=3, seed=2.0, rings=6, seg=10, flat=0.0)
                spade(k, x + 0.28, 0.1, z + 0.05, 0.3, -0.35)
                k.box('oldplanks', 0.08, 0.02, 0.5, x - 0.07, 0.025, z + 0.02, ry=0.08, uvscale=1.4)
                wood_cross(k, x - 0.02, z - 0.27, -0.05, -0.25, 0.1, h=0.3, mat='oldplanks')
            else:
                _grave_plot(k, x, z, kind)
    # coffin waiting on two trestles on the path
    for xx in (0.05, 0.38):
        for zz in (0.53, 0.65):
            for s in (-1, 1):
                k.beam('wood', V(xx + s * 0.05, 0, zz), V(xx, 0.18, zz), 0.025)
        k.box('wood', 0.04, 0.03, 0.18, xx, 0.17, 0.59)
    coffin(k, 0.22, 0.2, 0.59, ry=math.pi / 2 + 0.05, lid_off=0.25, s=1.0)
    # dead tree in the corner, weeds along the walls
    tree_dead(k, 1.1, -0.6, 1.25, seed=4.0)
    for (x, z) in ((-1.25, -0.75), (-1.2, 0.1), (1.25, 0.6), (0.7, -0.78), (-0.4, -0.77), (1.25, -0.2), (-1.24, 0.72), (0.65, 0.75)):
        tuft(k, x, z, 1.0 + k.r() * 0.5)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- church

def _bell(k, x, y, z, s=1.0):
    """a bronze bell hung from a timber headstock"""
    k.box('darkwood', 0.06 * s, 0.06 * s, 0.22, x, y, z)
    lathe(k, 'brass', [(0.08 * s, y - 0.2 * s), (0.075 * s, y - 0.185 * s), (0.058 * s, y - 0.14 * s), (0.047 * s, y - 0.07 * s),
                       (0.042 * s, y - 0.03 * s), (0.03 * s, y - 0.01 * s), (0.006, y - 0.004 * s)], x, 0, z, seg=14, caps=(False, True))
    if not k.lod:
        lathe(k, 'iron', [(0.005, y - 0.04 * s), (0.04 * s, y - 0.06 * s), (0.07 * s, y - 0.185 * s)], x, 0, z, seg=10, caps=(False, False))
        k.cyl('iron', 0.012 * s, 0.016 * s, 0.03, x, y - 0.22 * s, z, seg=6)
        k.torus('brass', 0.079 * s, 0.006, x, y - 0.18 * s, z, seg=14, rseg=3)


def spandrels(k, mat, cx, yy, r, top, t, z=0.0, n=6):
    """the two fillers between a round arch (springing at yy, radius r) and the square of wall above it"""
    left = [(cx - r, yy)] + arc_pts(cx, yy, r, math.pi, math.pi / 2, n)[1:] + [(cx, top), (cx - r, top)]
    right = arc_pts(cx, yy, r, math.pi / 2, 0.0, n) + [(cx + r, top), (cx, top)]
    slab(k, mat, left, t, z=z)
    slab(k, mat, right, t, z=z)


def _volute(k, x, y, R, sx, t):
    """a concave sweep (with a ball at its foot) buttressing a narrow upper tier"""
    pts = [(x, y), (x + R, y)] + arc_pts(x + R, y + R, R, 1.5 * math.pi, math.pi, 7)[1:]
    if sx < 0:
        pts = [(2 * x - px, py) for (px, py) in pts][::-1]
    slab(k, 'plaster', pts, t)
    lathe(k, 'stone', [(0.03, 0.0), (0.04, 0.02), (0.035, 0.06), (0.004, 0.075)], x + sx * (R + 0.01), y, 0, seg=8)


def _belfry(k, y0, wl, wu):
    """the espadana: a two-tier bell wall rising above the facade gable (frame: facade, x along it, z out)"""
    t = 0.16
    ow, oh = 0.26, 0.4
    r = ow / 2
    yy = y0 + 0.1 + oh
    y1 = yy + r + 0.05
    h1 = y1 - y0 + 0.1
    k.box('plaster', wl, 0.1, t, 0, y0, 0, bevel=0.0)
    for (a, b) in ((-wl / 2, -0.07 - ow), (-0.07, 0.07), (0.07 + ow, wl / 2)):
        k.box('plaster', b - a, y1 - y0 - 0.1, t, (a + b) / 2, y0 + 0.1, 0, bevel=0.0)
    k.box('plaster', wl, y0 + h1 - y1, t, 0, y1, 0, bevel=0.0)
    for cx in (-0.07 - ow / 2, 0.07 + ow / 2):
        spandrels(k, 'plaster', cx, yy, r, y1, t)
        if not k.lod:
            n = 7
            for i in range(n):
                a = math.pi * (i + 0.5) / n
                k.cbox('stone', 0.055, 0.045, t + 0.02, cx + math.cos(a) * (r + 0.022), yy + math.sin(a) * (r + 0.022), 0, rz=a - math.pi / 2, uvscale=2.0)
            for sx in (-1, 1):
                k.box('stone', 0.05, 0.035, t + 0.03, cx + sx * (r + 0.005), yy - 0.035, 0, uvscale=2.0)
            k.box('stone', ow + 0.04, 0.03, t + 0.04, cx, y0 + 0.08, 0, uvscale=2.0)
        _bell(k, cx, yy + r * 0.55, 0, 0.95)
    k.box('stone', wl + 0.08, 0.05, t + 0.06, 0, y0 + h1, 0, uvscale=2.0)
    # upper tier with one opening and concave sweeps either side
    y2 = y0 + h1 + 0.05
    ow2, oh2 = 0.22, 0.24
    r2 = ow2 / 2
    yy2 = y2 + 0.04 + oh2
    top2 = yy2 + r2 + 0.07
    for (a, b) in ((-wu / 2, -r2), (r2, wu / 2)):
        k.box('plaster', b - a, top2 - y2, t, (a + b) / 2, y2, 0, bevel=0.0)
    k.box('plaster', ow2, 0.04, t, 0, y2, 0, bevel=0.0)
    spandrels(k, 'plaster', 0, yy2, r2, top2, t)
    for sx in (-1, 1):
        _volute(k, sx * wu / 2, y2, 0.19, sx, t * 0.85)
    _bell(k, 0, yy2 + r2 * 0.5, 0, 0.7)
    if not k.lod:
        for i in range(5):
            a = math.pi * (i + 0.5) / 5
            k.cbox('stone', 0.05, 0.04, t + 0.02, math.cos(a) * (r2 + 0.02), yy2 + math.sin(a) * (r2 + 0.02), 0, rz=a - math.pi / 2, uvscale=2.0)
    # segmental crest, finial block and a wrought-iron cross
    cw = wu / 2 + 0.03
    slab(k, 'plaster', [(-cw, top2), (cw, top2)] + [(math.cos(a) * cw, top2 + math.sin(a) * 0.13) for a in [i * math.pi / 10 for i in range(1, 10)]], t + 0.02, bevel=0.006)
    k.box('stone', wu + 0.1, 0.04, t + 0.06, 0, top2 - 0.02, 0, uvscale=2.0)
    k.box('stone', 0.08, 0.06, 0.08, 0, top2 + 0.12, 0, uvscale=2.0)
    k.box('iron', 0.025, 0.4, 0.025, 0, top2 + 0.17, 0)
    k.box('iron', 0.18, 0.025, 0.025, 0, top2 + 0.44, 0)
    if not k.lod:
        for p in ((0, top2 + 0.575), (-0.09, top2 + 0.4525), (0.09, top2 + 0.4525)):
            k.cbox('iron', 0.03, 0.03, 0.03, p[0], p[1], 0, rz=math.pi / 4)
        # bell ropes hang down the face
        for cx in (-0.07 - ow / 2, 0.07 + ow / 2):
            k.beam('rope', V(cx, yy - 0.08, 0.0), V(cx * 1.3, y0 - 0.25, t / 2 + 0.04), 0.008, round_=True, seg=4)


def _buttress(k, x, h, y0=0.0, out=0.26, t=0.18):
    """a battered coral-stone buttress against the wall (frame: wall face, z out)"""
    pts = [(0.0, 0.0), (out, 0.0), (out * 0.9, h * 0.62), (out * 0.45, h * 0.92), (0.0, h)]
    slab(k, 'stone', pts, t, x=x, y=y0, z=0, ry=-math.pi / 2, bevel=0.01, uvscale=2.0)
    k.box('stoneDark', t + 0.03, 0.08, out + 0.03, x, y0, out / 2, uvscale=2.0)


def _patches(k, L, h, n, mat='coral'):
    """render fallen away to show the coral rag beneath (frame: wall face, z out)"""
    if k.lod:
        return
    for i in range(n):
        x = (k.r() - 0.5) * (L - 0.3)
        y = 0.1 + k.r() * (h - 0.35)
        w = 0.1 + k.r() * 0.16
        hh = 0.06 + k.r() * 0.1
        pts = [(math.cos(a) * w / 2 * (0.7 + 0.3 * math.sin(a * 3 + i)), math.sin(a) * hh / 2 * (0.7 + 0.3 * math.cos(a * 2 + i))) for a in [TAU * j / 7 for j in range(7)]]
        slab(k, mat, pts, 0.006, x=x, y=y, z=0.002, uvscale=2.5)


@building('church')
def church(k):
    """a colonial mission church of whitewashed coral rag: a buttressed nave under barrel tiles, a stone portal
    with studded doors, an oculus, and an espadana bell wall with three bells and an iron cross; a sacristy with
    the priest's lodging beside it, a walled campo santo, a calvary cross in the forecourt"""
    # ---- the nave: gable end to the road
    xn, zn = -0.35, -0.18
    nw, nd, h, ph = 1.8, 2.3, 1.3, 0.16
    k.push(xn, 0, zn)
    plinth(k, nw + 0.08, nd + 0.08, ph, 'stoneDark')
    k.push(0, ph, 0)
    ops = [Op('front', 0, 'portal', w=0.56, h=0.98)]
    for s in ('left', 'right'):
        for x in (-0.66, 0.0, 0.66):
            ops.append(Op(s, x, 'window', w=0.18, h=0.36, y=0.72, shutters=False, bars=True))
    plastered(k, nw, nd, h, 'plaster', ops, t=0.12, quoins='stone', base='stoneDark')
    for f in ('left', 'right'):
        L = nd
        k.face(f, nw, nd)
        for x in (-1.0, -0.33, 0.33, 1.0):
            _buttress(k, x, h * 0.85 + ph, -ph)
        _patches(k, L, h, 5)
        k.pop()
    k.face('back', nw, nd)
    _patches(k, nw, h, 3)
    k.pop()
    # ---- the roof: barrel tiles, ridge along the nave, tucked behind the facade parapet
    rise = 0.62
    rl = 2.12
    k.push(0, h, -nd / 2 + rl / 2, math.pi / 2)
    tile_gable(k, rl, nw, rise, over=0.22, y=0.0, gable='plaster', tile_len=0.15, tile_w=0.095)
    k.pop()
    # ---- the facade
    k.face('front', nw, nd)
    t = 0.14
    # gable parapet standing proud of the roof, coped
    gpts = [(-nw / 2, h), (nw / 2, h), (nw / 2, h + 0.1), (0.0, h + rise + 0.3), (-nw / 2, h + 0.1)]
    slab(k, 'plaster', gpts, t, z=-t / 2 + 0.01)
    for sx in (-1, 1):
        a, b = V(sx * (nw / 2 + 0.02), h + 0.1, 0.0), V(0.0, h + rise + 0.31, 0.0)
        d = b - a
        k.cbox('stone', d.length + 0.06, 0.05, t + 0.05, (a.x + b.x) / 2, (a.y + b.y) / 2 + 0.02, -0.06, rz=math.atan2(d.y, d.x), uvscale=2.0)
    # corner pilasters and a cornice at the eaves line
    for sx in (-1, 1):
        k.box('stone', 0.18, h + 0.04, 0.05, sx * (nw / 2 - 0.09), 0, 0.02, uvscale=2.0)
        k.box('stone', 0.24, 0.07, 0.08, sx * (nw / 2 - 0.09), h + 0.02, 0.03, uvscale=2.0)
        lathe(k, 'stone', [(0.05, 0.0), (0.06, 0.03), (0.05, 0.05), (0.04, 0.12), (0.055, 0.16), (0.005, 0.2)], sx * (nw / 2 - 0.09), h + 0.08, 0.03, seg=10)
    k.box('stone', nw - 0.36, 0.06, 0.06, 0, h - 0.04, 0.03, uvscale=2.0)
    # the portal: pilasters, entablature, a round head of voussoirs, a niche with a saint above
    pw, phh = 0.56, 0.98
    r = pw / 2
    sp = phh - r
    sp = phh - r - 0.02
    k.box('black', pw, phh, 0.02, 0, 0, -0.115)
    spandrels(k, 'plaster', 0, sp, r, phh, 0.1, z=-0.05)
    # studded double doors with an arched head, the left leaf ajar
    leaf = [(0, 0), (r, 0), (r, sp + r)] + arc_pts(r, sp, r, math.pi / 2, math.pi, 6)[1:]
    for sx in (-1, 1):
        k.push(sx * r, 0, -0.085, 0.45 if sx < 0 else 0.0)
        pts = leaf if sx < 0 else [(-px, py) for (px, py) in leaf][::-1]
        slab(k, 'planksDark', pts, 0.04, uvscale=1.2)
        if not k.lod:
            for i in range(1, 4):
                k.box('darkwood', 0.006, sp, 0.042, -sx * i * r / 4, 0, 0)
            for yy in (0.18, 0.5, sp - 0.04):
                k.box('iron', r * 0.85, 0.022, 0.012, -sx * r / 2, yy, 0.026)
            for yy in (0.3, 0.66):
                for i in range(3):
                    k.cyl('iron', 0.009, 0.007, 0.012, -sx * (0.05 + i * 0.09), yy, 0.02, seg=5, rx=math.pi / 2)
            k.torus('iron', 0.026, 0.006, -sx * (r - 0.05), 0.48, 0.035, rx=math.pi / 2, seg=10)
        k.pop()
    for sx in (-1, 1):
        k.box('stone', 0.09, sp, 0.07, sx * (r + 0.045), 0, 0.02, uvscale=2.0)
        k.box('stone', 0.13, 0.04, 0.09, sx * (r + 0.045), sp, 0.025, uvscale=2.0)
    n = 1 if k.lod else 11
    if k.lod:
        k.box('stone', pw + 0.2, 0.1, 0.07, 0, phh, 0.02, uvscale=2.0)
    else:
        for i in range(n):
            a = math.pi * (i + 0.5) / n
            k.cbox('stone', 0.08 if i != n // 2 else 0.1, 0.1 if i != n // 2 else 0.13, 0.07, math.cos(a) * (r + 0.045), sp + math.sin(a) * (r + 0.045), 0.02, rz=a - math.pi / 2, uvscale=2.0)
    for sx in (-1, 1):
        k.box('stone', 0.07, phh + 0.14, 0.05, sx * (r + 0.16), 0, 0.03, uvscale=2.0)
    k.box('stone', pw + 0.46, 0.06, 0.08, 0, phh + 0.14, 0.035, uvscale=2.0)
    # oculus in the gable
    oy = h + 0.22
    blob(k, 'window', 0, oy, -0.02, 0.11, 0.11, 0.02, amp=0.0, rings=4, seg=14)
    for i in range(1 if k.lod else 12):
        a = TAU * i / 12
        if k.lod:
            k.torus('stone', 0.13, 0.025, 0, oy, 0.01, rx=math.pi / 2, seg=12, rseg=4)
        else:
            k.cbox('stone', 0.07, 0.045, 0.05, math.cos(a) * 0.135, oy + math.sin(a) * 0.135, 0.01, rz=a + math.pi / 2, uvscale=2.0)
    if not k.lod:
        k.box('iron', 0.012, 0.22, 0.01, 0, oy - 0.11, 0.0)
        k.box('iron', 0.22, 0.012, 0.01, 0, oy, 0.0)
    _patches(k, nw - 0.5, h, 3)
    # the espadana on the apex
    _belfry(k, h + rise - 0.12, 0.92, 0.5)
    k.pop()
    k.pop()
    # forecourt steps
    k.pop()
    for i in range(3):
        k.box('stone', 1.1 - i * 0.16, ph * (i + 1) / 3, 0.13, xn, 0, zn + nd / 2 + 0.3 - i * 0.11, uvscale=2.0, bevel=0.01)
    # ---- sacristy and the priest's lodging
    xs, zs = 1.78, -0.62
    sw, sd, sh = 1.7, 1.2, 0.9
    k.push(xs, 0, zs)
    plinth(k, sw + 0.06, sd + 0.06, 0.1, 'stoneDark')
    k.push(0, 0.1, 0)
    plastered(k, sw, sd, sh, 'plasterYellow', [Op('front', -0.35, 'door', h=0.78), Op('front', 0.38, 'window', bars=True), Op('right', 0.0, 'window'), Op('back', 0.2, 'window')], quoins='stone')
    tile_gable(k, sw, sd, 0.45, over=0.18, y=sh, gable='plasterYellow', tile_len=0.14, tile_w=0.09)
    chimney(k, sw / 2 - 0.25, -sd / 2 + 0.25, sh - 0.1, 0.75, 0.22)
    k.pop()
    k.pop()
    steps(k, xs - 0.35, zs + sd / 2 + 0.1, 0.46, 0.1, 1, 'stone')
    # ---- the campo santo to the west
    gx0, gx1 = -2.85, -1.42
    gz0, gz1 = -1.28, 1.25
    rubble_wall(k, (gx0, gz1), (gx0, gz0), h=0.28, t=0.13)
    rubble_wall(k, (gx0, gz0), (gx1 + 0.05, gz0), h=0.28, t=0.13)
    rubble_wall(k, (gx1, gz1), (gx0, gz1), h=0.28, t=0.13, gaps=[(0.0, 0.32)])
    k.box('dirt', gx1 - gx0 - 0.1, 0.006, gz1 - gz0 - 0.1, (gx0 + gx1) / 2, 0, (gz0 + gz1) / 2, uvscale=0.8)
    plots = [(-2.45, -0.75, 'round'), (-1.95, -0.75, 'wood'), (-2.45, 0.05, 'cross'), (-1.95, 0.05, 'gable'), (-2.45, 0.8, 'wood')]
    for (x, z, kind) in plots:
        _grave_plot(k, x, z, kind)
    tuft(k, -2.7, -1.1)
    tuft(k, -1.6, -1.1)
    tuft(k, -2.72, 0.5)
    # calvary in the forecourt: a timber cross on a stepped stone base
    cx, cz = 0.9, 0.95
    k.box('stone', 0.36, 0.08, 0.36, cx, 0, cz, uvscale=2.0, bevel=0.01)
    k.box('stone', 0.24, 0.08, 0.24, cx, 0.08, cz, uvscale=2.0, bevel=0.01)
    k.box('darkwood', 0.06, 0.95, 0.06, cx, 0.16, cz)
    k.box('darkwood', 0.36, 0.055, 0.055, cx, 0.82, cz)
    # bench, flowers and a palm-shaded water jar by the door
    k.box('stone', 0.6, 0.05, 0.16, 1.95, 0.22, 0.32, uvscale=2.0)
    for x in (1.72, 2.18):
        k.box('stone', 0.1, 0.22, 0.13, x, 0, 0.32, uvscale=2.0)
    for (x, z, s) in ((2.55, 0.25, 1.0), (2.6, 0.62, 0.8), (-1.25, 1.1, 0.9)):
        lathe(k, 'terracotta', [(0.06 * s, 0.0), (0.09 * s, 0.1 * s), (0.1 * s, 0.17 * s), (0.08 * s, 0.2 * s), (0.09 * s, 0.22 * s)], x, 0, z, seg=10)
        blob(k, 'leaf', x, 0.25 * s, z, 0.12 * s, 0.1 * s, 0.12 * s, amp=0.3, freq=4, seed=x, rings=6, seg=10)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- shops

def jar(k, x, y, z, kind='albarello', s=1.0, ry=0.0):
    """shop wares: albarello drug jars, glass bottles, flasks, clay pots, tins"""
    if kind == 'albarello':
        prof = [(0.03, 0), (0.034, 0.008), (0.028, 0.02), (0.027, 0.06), (0.033, 0.072), (0.022, 0.082), (0.024, 0.09)]
        lathe(k, 'plaster', [(r * s, yy * s) for (r, yy) in prof], x, y, z, seg=10, uvscale=2.0)
        if not k.lod:
            lathe(k, 'plasterBlue', [(0.0285 * s, 0.03 * s), (0.0285 * s, 0.05 * s)], x, y, z, seg=10, caps=(False, False))
            lathe(k, 'darkwood', [(0.025 * s, 0.09 * s), (0.02 * s, 0.1 * s)], x, y, z, seg=8)
    elif kind in ('bottle', 'green'):
        prof = [(0.022, 0), (0.024, 0.006), (0.024, 0.06), (0.01, 0.08), (0.008, 0.105), (0.01, 0.11)]
        lathe(k, 'window' if kind == 'bottle' else 'leaf', [(r * s, yy * s) for (r, yy) in prof], x, y, z, seg=8)
        if not k.lod:
            lathe(k, 'wood', [(0.007 * s, 0.11 * s), (0.008 * s, 0.122 * s)], x, y, z, seg=6)
    elif kind == 'flask':
        prof = [(0.008, 0), (0.03, 0.01), (0.036, 0.03), (0.03, 0.05), (0.01, 0.065), (0.009, 0.1)]
        lathe(k, 'window', [(r * s, yy * s) for (r, yy) in prof], x, y, z, seg=10)
    elif kind == 'pot':
        prof = [(0.025, 0), (0.038, 0.03), (0.036, 0.06), (0.026, 0.07), (0.03, 0.078)]
        lathe(k, 'terracotta', [(r * s, yy * s) for (r, yy) in prof], x, y, z, seg=10)
    elif kind == 'tin':
        k.cyl('brass', 0.026 * s, 0.026 * s, 0.05 * s, x, y, z, seg=10)
    elif kind == 'book':
        k.box('red' if k.r() > 0.5 else 'darkwood', 0.03 * s, 0.1 * s, 0.075 * s, x, y, z, ry=ry)


def shopfront(k, x, w, h, y, wares, t=0.09, deep=0.34, counter=True, shelves=3, backing='planksDark', shutter='side'):
    """a shop opening (cut by an Op of kind 'shop'): a deep dark interior with stocked shelves seen over a
    plank counter, a top-hung shutter propped open as a canopy (frame: wall face, z out)"""
    k.box('black', w + 0.1, h + 0.06, 0.02, x, y - 0.03, -t - deep - 0.02)
    k.box(backing, w + 0.06, h, 0.02, x, y, -t - deep + 0.005, uvscale=1.3, grain=1)
    for sx in (-1, 1):
        k.box('black', 0.02, h, deep, x + sx * (w / 2 + 0.01), y, -t - deep / 2)
    k.box('black', w, 0.02, deep, x, y + h - 0.02, -t - deep / 2)
    k.box('planksDark', w, 0.02, deep + t, x, y - 0.02, -(t + deep) / 2)
    for i in range(shelves):
        sy = y + 0.03 + i * (h - 0.06) / shelves
        k.box('planks', w - 0.02, 0.018, deep * 0.55, x, sy, -t - deep + deep * 0.28, uvscale=1.4)
        if k.lod:
            continue
        for sx in (-1, 1):
            k.beam('darkwood', V(x + sx * (w / 2 - 0.04), sy - 0.06, -t - deep + 0.02), V(x + sx * (w / 2 - 0.04), sy, -t - deep + 0.12), 0.015)
        px = x - w / 2 + 0.04
        while px < x + w / 2 - 0.04:
            kind = wares[int(k.r() * len(wares))]
            jar(k, px, sy + 0.018, -t - deep + 0.06 + k.r() * 0.08, kind, 0.95 + k.r() * 0.15, k.r())
            px += 0.055 + k.r() * 0.03
    # frame, sill counter on brackets
    for sx in (-1, 1):
        k.box('darkwood', 0.05, h + 0.04, t + 0.03, x + sx * (w / 2 + 0.02), y - 0.02, -t / 2 + 0.01)
    k.box('darkwood', w + 0.14, 0.06, t + 0.04, x, y + h, -t / 2 + 0.015)
    if counter:
        k.box('planks', w + 0.16, 0.045, 0.26, x, y - 0.045, 0.06 - t / 2, uvscale=1.3)
        for sx in (-1, 0, 1):
            k.beam('darkwood', V(x + sx * w * 0.4, y - 0.22, 0.01), V(x + sx * w * 0.4, y - 0.05, 0.15), 0.03)
    if shutter == 'top':
        # hinged at the head and propped out as a little canopy
        k.push(x, y + h + 0.04, 0.03, 0, -0.42)
        n = 1 if k.lod else max(3, round(w / 0.11))
        for i in range(n):
            k.box('planks', w / n - (0.006 if n > 1 else 0), 0.022, h * 0.85, -w / 2 + (i + 0.5) * w / n, 0, 0.0, uvscale=1.4, grain=1)
        if not k.lod:
            for zz in (0.12, h * 0.7):
                k.box('planksDark', w - 0.06, 0.016, 0.05, 0, -0.016, zz)
        k.pop()
        if not k.lod:
            ang = 0.42
            for sx in (-1, 1):
                k.beam('wood', V(x + sx * (w / 2 - 0.04), y + 0.0, 0.16), V(x + sx * (w / 2 - 0.04), y + h + 0.04 + math.sin(ang) * h * 0.8 - 0.03, math.cos(ang) * h * 0.8),
                       0.02, round_=True, seg=5)
    elif shutter == 'side':
        # two leaves folded back flat against the wall
        for sx in (-1, 1):
            k.push(x + sx * (w / 2 + 0.05), y, 0.01)
            n = 1 if k.lod else 3
            for i in range(n):
                k.box('planks', w / 2 / n - 0.005, h - 0.01, 0.022, sx * (i + 0.5) * w / 2 / n, 0.005, 0, uvscale=1.4, grain=1)
            if not k.lod:
                for yy in (h * 0.15, h * 0.75):
                    k.box('planksDark', w / 2 - 0.03, 0.04, 0.012, sx * w / 4, yy, 0.016)
                    k.box('iron', 0.08, 0.014, 0.008, sx * 0.04, yy + 0.012, 0.024)
            k.pop()


def awning(k, x, w, y0, out, drop, mat='canvasGreen', z0=0.02, poles=True):
    """a striped canvas awning on a wall rail, sagging between iron stays, with a scalloped valance and posts"""
    nx = max(2, round(w / (0.25 if k.lod else 0.08)))
    nz = 2 if k.lod else 5
    verts, faces = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            u = i / nx
            sag = 0.03 * math.sin(math.pi * t) * (0.6 + 0.4 * abs(math.sin(u * math.pi * 3)))
            verts.append(V(x - w / 2 + w * u, y0 - drop * t - sag, z0 + out * t))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    k.mesh(mat, verts, faces, uvscale=1.0)
    # scalloped valance
    vv, vf = [], []
    m = max(4, round(w / 0.14))
    yb = y0 - drop
    for i in range(m + 1):
        xx = x - w / 2 + w * i / m
        vv += [V(xx, yb + 0.005, z0 + out + 0.003), V(xx, yb - 0.06, z0 + out + 0.003)]
    for i in range(m):
        a = i * 2
        mid = V(x - w / 2 + w * (i + 0.5) / m, yb - 0.1, z0 + out + 0.003)
        vv.append(mid)
        c = len(vv) - 1
        vf += [(a, a + 1, c, a + 3, a + 2), (a + 2, a + 3, c, a + 1, a)]
    k.mesh(mat, vv, vf, uvscale=1.0)
    k.box('darkwood', w + 0.08, 0.05, 0.05, x, y0 - 0.02, z0)
    if poles:
        for sx in (-1, 1):
            k.cyl('wood', 0.022, 0.02, yb + 0.02, x + sx * (w / 2 - 0.02), 0, z0 + out - 0.02, seg=7)
            if not k.lod:
                k.beam('iron', V(x + sx * (w / 2 - 0.02), y0 - 0.05, z0), V(x + sx * (w / 2 - 0.02), yb, z0 + out - 0.02), 0.012, round_=True, seg=4)
                k.cyl('stoneDark', 0.04, 0.035, 0.03, x + sx * (w / 2 - 0.02), 0, z0 + out - 0.02, seg=7)
    else:
        for sx in (-1, 1):
            k.beam('iron', V(x + sx * (w / 2 - 0.02), y0 - 0.35, z0), V(x + sx * (w / 2 - 0.02), yb, z0 + out - 0.02), 0.014, round_=True, seg=4)


def pot_plant(k, x, z, s=1.0, kind='herb'):
    lathe(k, 'terracotta', [(0.05 * s, 0.0), (0.07 * s, 0.09 * s), (0.08 * s, 0.11 * s), (0.075 * s, 0.12 * s)], x, 0, z, seg=10)
    k.cyl('soil', 0.068 * s, 0.068 * s, 0.005, x, 0.105 * s, z, seg=10)
    if kind == 'herb':
        blob(k, 'leaf', x, 0.15 * s, z, 0.075 * s, 0.07 * s, 0.075 * s, amp=0.35, freq=5, seed=x * 7 + z, rings=6, seg=10)
    else:
        for i in range(6 if not k.lod else 3):
            a = TAU * i / 6 + k.r()
            leaf_blade(k, V(x, 0.11 * s, z), V(math.cos(a) * 0.5, 0.9, math.sin(a) * 0.5), 0.22 * s, 0.05 * s, 0.4)


def leaf_blade(k, base, d, L, wd, droop=0.5, mat='leaf', seg=5):
    """a long tropical leaf: a folded blade along a drooping arc"""
    d = Vector(d).normalized()
    side = d.cross(Vector((0, 1, 0)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    seg = 2 if k.lod else seg
    verts, faces = [], []
    p = Vector(base)
    dd = d.copy()
    for i in range(seg + 1):
        t = i / seg
        ww = wd * math.sin(math.pi * min(0.98, 0.15 + t * 0.85)) if t < 1 else 0.002
        verts += [p + side * ww / 2 - up * ww * 0.15, p, p - side * ww / 2 - up * ww * 0.15]
        p = p + dd * (L / seg)
        dd = (dd + Vector((0, -droop * 1.6 / seg, 0))).normalized()
    for i in range(seg):
        a = i * 3
        faces += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
    k.mesh(mat, verts, faces, uvscale=2.0)


def tricorn(k, x, y, z, s=1.0, ry=0.0, mat='black', trim=True):
    """a cocked felt hat: a round crown and a brim turned up into three sides"""
    seg = 9 if k.lod else 18
    R, cr = 0.1 * s, 0.05 * s
    verts, faces = [], []
    for i in range(seg):
        a = TAU * i / seg
        c3 = math.cos(3 * a)
        rr = R * (0.78 + 0.22 * c3)
        up = 0.055 * s * (1 - c3) / 2
        verts += [V(math.cos(a) * cr, 0.0, math.sin(a) * cr), V(math.cos(a) * rr * 0.9, up * 0.35, math.sin(a) * rr * 0.9),
                  V(math.cos(a) * rr, up + 0.004, math.sin(a) * rr)]
    for i in range(seg):
        a, b = i * 3, ((i + 1) % seg) * 3
        for j in range(2):
            faces.append((a + j, a + j + 1, b + j + 1, b + j))
            faces.append((b + j, b + j + 1, a + j + 1, a + j))
    k.mesh(mat, verts, faces, uvscale=2.0, local=_xf(x, y + 0.006 * s, z, ry))
    lathe(k, mat, [(cr, 0.0), (cr * 1.02, 0.03 * s), (cr * 0.9, 0.05 * s), (cr * 0.5, 0.058 * s), (0.002, 0.06 * s)], x, y, z, seg=10)
    if trim and not k.lod:
        k.cbox('gold', 0.012 * s, 0.012 * s, 0.012 * s, x + math.sin(ry) * 0.0, y + 0.03 * s, z, ry=ry)


def plumed_hat(k, x, y, z, s=1.0, ry=0.0, mat='darkwood', plume='red'):
    """a broad-brimmed cavalier hat with a sweeping plume"""
    lathe(k, mat, [(0.002, 0.0), (0.12 * s, 0.0), (0.125 * s, 0.008 * s), (0.05 * s, 0.01 * s), (0.052 * s, 0.05 * s),
                   (0.045 * s, 0.07 * s), (0.002, 0.075 * s)], x, y, z, seg=16, caps=(False, False))
    lathe(k, mat, [(0.12 * s, 0.0), (0.002, 0.0)], x, y - 0.001, z, seg=16, caps=(False, False))
    if not k.lod:
        lathe(k, 'brass', [(0.053 * s, 0.012 * s), (0.053 * s, 0.022 * s)], x, y, z, seg=12, caps=(False, False))
        leaf_blade(k, V(x + math.cos(ry) * 0.04 * s, y + 0.03 * s, z - math.sin(ry) * 0.04 * s), V(-math.cos(ry), 0.6, math.sin(ry)), 0.17 * s, 0.05 * s, 0.6, mat=plume)


def hat_stand(k, x, y, z, hat='tricorn', ry=0.0, mat='black'):
    """a turned wooden stand with a head block, wearing a hat"""
    lathe(k, 'darkwood', [(0.035, 0.0), (0.03, 0.012), (0.008, 0.02), (0.008, 0.13), (0.004, 0.14)], x, y, z, seg=8)
    blob(k, 'wood', x, y + 0.17, z, 0.045, 0.05, 0.05, amp=0.0, rings=6, seg=10)
    if hat == 'tricorn':
        tricorn(k, x, y + 0.19, z, 1.25, ry, mat)
    else:
        plumed_hat(k, x, y + 0.19, z, 1.1, ry, mat, plume=hat)


# ------------------------------------------------------------------------------------------- apothecary

@building('apothecary')
def apothecary(k):
    """an apothecary's shop of whitewashed rubble under barrel tiles: an open shop counter with shelves of
    drug jars and bottles under a green awning, a copper still and herb-drying racks in the yard"""
    w, d, h = 2.05, 1.4, 1.0
    zc = -0.48
    k.push(0, 0, zc)
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    plastered(k, w, d, h, 'plaster', [Op('front', -0.62, 'door', h=0.82), Op('front', 0.3, 'shop', w=0.95, h=0.5, y=0.38),
                                       Op('left', 0.0, 'window'), Op('right', 0.15, 'window', bars=True), Op('back', 0.0, 'window')])
    k.face('front', w, d)
    shopfront(k, 0.3, 0.95, 0.5, 0.38, ['albarello', 'albarello', 'bottle', 'green', 'flask', 'pot', 'tin'])
    if not k.lod:
        # mortar and pestle and a pair of scales on the counter
        lathe(k, 'brass', [(0.03, 0.0), (0.045, 0.01), (0.05, 0.05), (0.045, 0.055), (0.035, 0.03)], 0.62, 0.36, 0.08, seg=12, caps=(True, False))
        limb(k, 'wood', V(0.62, 0.38, 0.08), V(0.66, 0.5, 0.06), 0.012, 0.009)
        k.box('darkwood', 0.012, 0.16, 0.012, 0.0, 0.36, 0.05)
        k.box('brass', 0.16, 0.008, 0.008, 0.0, 0.52, 0.05)
        for sx in (-1, 1):
            k.beam('brass', V(sx * 0.08, 0.52, 0.05), V(sx * 0.08, 0.45, 0.05), 0.003)
            lathe(k, 'brass', [(0.008, 0.0), (0.035, 0.012)], sx * 0.08, 0.44, 0.05, seg=10, caps=(True, False))
    hanging_sign(k, -1.0, 0.92, 0.0, 'APOTHECARY')
    k.pop()
    tile_gable(k, w, d, 0.55, over=0.2, y=h, gable='plaster')
    chimney(k, -w / 2 + 0.3, -d / 2 + 0.25, h - 0.1, 0.85, 0.24)
    k.pop()
    k.pop()
    steps(k, -0.62, zc + d / 2 + 0.1, 0.5, 0.12, 1, 'stone')
    awning(k, 0.3, 1.25, 1.12, 0.6, 0.26, 'canvasGreen', z0=zc + d / 2 + 0.02)
    # yard: a copper alembic on a brick stove, herb bundles drying on a rack, potted herbs, a bench with crates
    sx0, sz0 = -0.95, 0.85
    k.box('stoneDark', 0.32, 0.26, 0.28, sx0, 0, sz0, uvscale=2.0, bevel=0.01)
    k.box('black', 0.14, 0.1, 0.01, sx0, 0.04, sz0 + 0.14)
    k.box('fire', 0.11, 0.05, 0.01, sx0, 0.045, sz0 + 0.143)
    lathe(k, 'brass', [(0.02, 0.26), (0.1, 0.29), (0.12, 0.36), (0.1, 0.42), (0.05, 0.46), (0.03, 0.52), (0.035, 0.54)], sx0, 0, sz0, seg=14)
    if not k.lod:
        lathe(k, 'brass', [(0.02, 0.0), (0.04, 0.02), (0.042, 0.05), (0.02, 0.06)], sx0 + 0.3, 0.0, sz0 - 0.05, seg=10)
        limb(k, 'brass', V(sx0, 0.53, sz0), V(sx0 + 0.3, 0.3, sz0 - 0.05), 0.012, 0.008)
        k.box('wood', 0.1, 0.24, 0.1, sx0 + 0.3, 0, sz0 - 0.05)
        lathe(k, 'brass', [(0.02, 0.0), (0.045, 0.02), (0.045, 0.1), (0.02, 0.12)], sx0 + 0.3, 0.24, sz0 - 0.05, seg=10)
        jar(k, sx0 + 0.32, 0.36, sz0 - 0.05, 'flask', 1.0)
    k.marker('smoke', sx0, 0.56, sz0)
    # drying rack
    rx0, rz0 = 0.0, 0.0
    k.push(1.18, 0, -0.45, math.pi / 2)
    for sx in (-1, 1):
        k.beam('wood', V(rx0 + sx * 0.3, 0, rz0 - 0.1), V(rx0 + sx * 0.3, 0.75, rz0), 0.035, round_=True)
        k.beam('wood', V(rx0 + sx * 0.3, 0, rz0 + 0.1), V(rx0 + sx * 0.3, 0.75, rz0), 0.035, round_=True)
    k.beam('wood', V(rx0 - 0.36, 0.74, rz0), V(rx0 + 0.36, 0.74, rz0), 0.035, round_=True)
    k.beam('wood', V(rx0 - 0.33, 0.48, rz0), V(rx0 + 0.33, 0.48, rz0), 0.03, round_=True)
    for yy in (0.74, 0.48):
        for i in range(6 if not k.lod else 3):
            bx = rx0 - 0.24 + i * (0.48 / 5 if not k.lod else 0.24)
            k.beam('rope', V(bx, yy, rz0), V(bx, yy - 0.06, rz0), 0.006, round_=True, seg=4)
            blob(k, 'leaf' if i % 2 else 'thatchDark', bx, yy - 0.12, rz0, 0.03, 0.06, 0.03, amp=0.3, freq=6, seed=bx * 9 + yy, rings=5, seg=7, rz=math.pi)
    k.pop()
    for (x, z, kind) in ((0.95, 0.42, 'herb'), (1.15, 0.5, 'spiky'), (-0.35, 0.62, 'herb')):
        pot_plant(k, x, z, 1.0, kind)
    crate(k, -1.15, 0, 0.35, 0.24, 0.3)
    if not k.lod:
        for i in range(4):
            jar(k, -1.22 + i * 0.05, 0.24, 0.33 + (i % 2) * 0.05, 'green', 1.0)
    cask(k, 1.15, -0.0, 0.75)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- surgery

def barber_pole(k, x, z, h=0.95):
    """the barber-surgeon's red and white spiral pole with brass finials"""
    seg, rows = (8, 6) if k.lod else (12, 24)
    r = 0.035
    verts = []
    for j in range(rows + 1):
        for i in range(seg):
            a = TAU * i / seg
            verts.append(V(x + math.cos(a) * r, 0.12 + (h - 0.24) * j / rows, z + math.sin(a) * r))
    red, white = [], []
    for j in range(rows):
        for i in range(seg):
            a, b = j * seg + i, j * seg + (i + 1) % seg
            f = (a, a + seg, b + seg, b)
            ((red if ((i + j) // 3) % 2 else white) if not k.lod else (red if j % 2 else white)).append(f)
    k.mesh('red', verts, red)
    k.mesh('plaster', verts, white)
    k.cyl('darkwood', 0.045, 0.04, 0.12, x, 0, z, seg=10)
    lathe(k, 'brass', [(0.045, 0.0), (0.05, 0.02), (0.035, 0.05), (0.04, 0.08), (0.002, 0.1)], x, h - 0.12, z, seg=10)


@building('surgery')
def surgery(k):
    """the sawbones: a weatherboarded shack under deep thatch, its counter lined with saws, jars of leeches and
    physic; a barber's pole at the door, a strapped operating table under a canvas fly, a bloody bucket, crutches,
    spare peg legs and bandages drying on a line"""
    w, d, h = 1.95, 1.35, 0.92
    zc = -0.5
    k.push(0, 0, zc)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    clapboard(k, w, d, h, 'oldplanks', [Op('front', -0.55, 'door', h=0.8), Op('front', 0.35, 'shop', w=0.8, h=0.46, y=0.38),
                                         Op('left', 0.0, 'window'), Op('back', 0.2, 'window')])
    k.face('front', w, d)
    shopfront(k, 0.35, 0.8, 0.46, 0.38, ['bottle', 'green', 'flask', 'pot', 'albarello', 'bottle'], t=0.07, shelves=2, shutter='top')
    if not k.lod:
        # a bone saw, a jar of leeches and a rolled leather of knives on the counter
        k.cbox('iron', 0.2, 0.05, 0.004, 0.2, 0.37, 0.07, rx=math.pi / 2)
        k.cbox('wood', 0.07, 0.03, 0.02, 0.05, 0.37, 0.07)
        lathe(k, 'window', [(0.03, 0.0), (0.035, 0.03), (0.035, 0.09), (0.03, 0.1)], 0.52, 0.36, 0.06, seg=10)
        k.box('darkwood', 0.14, 0.012, 0.08, 0.68, 0.36, 0.08, ry=0.2)
    hanging_sign(k, -0.95, 0.88, 0.0, 'SAWBONES')
    k.pop()
    thatch_gable(k, w, d, 0.62, over=0.28, y=h, mat='thatch', gable='oldplanks')
    chimney(k, w / 2 + 0.08, -0.15, -0.1, h + 0.95, 0.24)
    k.pop()
    k.pop()
    steps(k, -0.55, zc + d / 2 + 0.1, 0.5, 0.1, 1, 'stone')
    barber_pole(k, -0.88, zc + d / 2 + 0.12, 0.95)
    fx, fz = 0.72, 0.88
    # the table: heavy planks on trestles, leather straps, a stained sheet and the tools
    k.push(fx, 0, fz - 0.02, 0.35)
    k.box('planksDark', 0.78, 0.05, 0.32, 0, 0.36, 0, uvscale=1.3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('darkwood', 0.05, 0.36, 0.05, sx * 0.33, 0, sz * 0.12)
        k.box('darkwood', 0.05, 0.04, 0.3, sx * 0.33, 0.12, 0)
    if not k.lod:
        for xx in (-0.2, 0.18):
            k.box('darkwood', 0.04, 0.054, 0.335, xx, 0.36, 0)
            k.box('iron', 0.03, 0.03, 0.01, xx, 0.38, 0.168)
        k.box('canvas', 0.36, 0.008, 0.26, -0.15, 0.41, 0.0, ry=0.1)
        k.box('red', 0.12, 0.002, 0.1, -0.1, 0.418, 0.03, ry=0.4)
        k.cbox('iron', 0.22, 0.05, 0.004, 0.2, 0.43, 0.06, rx=math.pi / 2, ry=0.3)
        k.cbox('wood', 0.03, 0.08, 0.025, 0.06, 0.43, 0.02, rx=math.pi / 2, ry=0.3)
        k.cyl('iron', 0.006, 0.006, 0.12, 0.25, 0.415, -0.08, seg=5, rz=math.pi / 2)
        k.cyl('darkwood', 0.02, 0.02, 0.06, 0.32, 0.41, -0.08, seg=6)  # rum to dull the pain
        lathe(k, 'window', [(0.02, 0.0), (0.03, 0.02), (0.03, 0.08), (0.01, 0.11), (0.01, 0.14)], 0.3, 0.41, 0.09, seg=8)
    k.pop()
    # bucket of slops, a stool, a crutch and spare peg legs against the wall, bandages on a line
    k.push(fx - 0.62, 0, fz + 0.25)
    lathe(k, 'planksDark', [(0.07, 0.0), (0.085, 0.18), (0.08, 0.17), (0.065, 0.01)], 0, 0, 0, seg=12, caps=(True, False))
    if not k.lod:
        k.cyl('red', 0.075, 0.075, 0.005, 0, 0.14, 0, seg=12)
        for yy in (0.04, 0.14):
            k.torus('iron', 0.072 + yy * 0.08, 0.005, 0, yy, 0, seg=12, rseg=3)
    k.pop()
    k.cyl('wood', 0.1, 0.1, 0.03, fx + 0.45, 0.22, fz - 0.42, seg=10)
    for a in range(3):
        aa = a * TAU / 3
        limb(k, 'wood', V(fx + 0.45 + math.cos(aa) * 0.08, 0, fz - 0.42 + math.sin(aa) * 0.08), V(fx + 0.45 + math.cos(aa) * 0.05, 0.22, fz - 0.42 + math.sin(aa) * 0.05), 0.014, 0.012)
    k.push(0.0, 0, zc + d / 2 + 0.05)
    for i, x in enumerate((-0.08, 0.02)):
        k.push(x, 0, 0.03, 0, -0.2)
        lathe(k, 'wood', [(0.012, 0.0), (0.016, 0.05), (0.03, 0.32), (0.042, 0.4), (0.045, 0.43)], 0, 0, 0, seg=8)
        k.pop()
    k.push(0.15, 0, 0.04, 0, -0.18, 0.05)
    k.beam('wood', V(0, 0, 0), V(0, 0.62, 0), 0.025, round_=True)
    k.beam('wood', V(-0.06, 0.62, 0), V(0.06, 0.62, 0), 0.03, round_=True)
    k.beam('wood', V(0, 0.35, 0), V(0.0, 0.62, 0.0), 0.02)
    k.pop()
    k.pop()
    k.cyl('bark', 0.025, 0.022, 0.8, -1.25, 0, 0.35, seg=6)
    k.cyl('bark', 0.025, 0.022, 0.8, -1.25, 0, 1.2, seg=6)
    k.beam('rope', V(-1.25, 0.77, 0.35), V(-1.25, 0.75, 1.2), 0.008, round_=True, seg=4)
    for i in range(5):
        z = 0.47 + i * 0.15
        k.cbox('canvas', 0.008, 0.22 - (i % 2) * 0.05, 0.06, -1.25, 0.66 - (i % 2) * 0.025, z, rz=0.05 * (i - 2))
        if i in (1, 3) and not k.lod:
            k.cbox('red', 0.01, 0.04, 0.04, -1.25, 0.62, z + 0.005)
    cask(k, -1.15, -0.05, 0.75)
    crate(k, 1.18, 0, -0.1, 0.22, 0.4)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- hat shop

@building('hat_shop')
def hat_shop(k):
    """a milliner's in blue limewash under barrel tiles: hats on head blocks behind the counter under a blue
    striped awning, a display table of tricorns and plumed hats, hat boxes and a felt-steaming kettle"""
    w, d, h = 2.1, 1.4, 1.0
    zc = -0.5
    k.push(0, 0, zc)
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    plastered(k, w, d, h, 'plasterBlue', [Op('front', 0.65, 'door', h=0.82), Op('front', -0.3, 'shop', w=1.0, h=0.52, y=0.36),
                                           Op('left', 0.0, 'window'), Op('right', 0.0, 'window'), Op('back', -0.3, 'window')], quoins='stone')
    k.face('front', w, d)
    shopfront(k, -0.3, 1.0, 0.52, 0.36, ['book'], shelves=1, backing='planksDark')
    if not k.lod:
        # head blocks with hats on the counter and on the shelf
        for i, (x, kind, m) in enumerate(((-0.66, 'tricorn', 'red'), (-0.4, 'bone', 'canvasBlue'), (-0.14, 'tricorn', 'canvas'), (0.1, 'red', 'black'))):
            hat_stand(k, x, 0.36, 0.05, kind, 0.2 * (i - 1.5), m)
        for i in range(4):
            tricorn(k, -0.68 + i * 0.25, 0.62, -0.09 - 0.3, 1.0, 0.3 * i, ('black', 'red', 'darkwood', 'canvas')[i])
    hanging_sign(k, 1.0, 0.92, 0.0, 'HATS')
    k.pop()
    tile_gable(k, w, d, 0.55, over=0.2, y=h, gable='plasterBlue')
    chimney(k, w / 2 - 0.3, -d / 2 + 0.25, h - 0.1, 0.85, 0.24)
    k.pop()
    k.pop()
    steps(k, 0.65, zc + d / 2 + 0.1, 0.5, 0.12, 1, 'stone')
    awning(k, -0.3, 1.3, 1.12, 0.6, 0.26, 'canvasBlue', z0=zc + d / 2 + 0.02)
    # display table in the street
    tx, tz = -0.3, 0.88
    k.box('planks', 0.9, 0.04, 0.34, tx, 0.36, tz, uvscale=1.3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('darkwood', 0.04, 0.36, 0.04, tx + sx * 0.4, 0, tz + sz * 0.13)
    k.box('canvasBlue', 0.94, 0.12, 0.36, tx, 0.28, tz, uvscale=1.0)
    if True:
        tricorn(k, tx - 0.3, 0.4, tz, 1.5, 0.4, 'black')
        plumed_hat(k, tx + 0.02, 0.4, tz + 0.02, 1.4, 1.2, 'red', 'bone')
        hat_stand(k, tx + 0.32, 0.4, tz - 0.04, 'tricorn', -0.3, 'darkwood')
    # hat boxes stacked by the door, a felt-steaming kettle on a brazier and a bench
    for i, (x, z, r, y, m) in enumerate(((0.95, 0.55, 0.13, 0.0, 'canvasRed'), (0.97, 0.56, 0.11, 0.14, 'planks'), (0.95, 0.55, 0.085, 0.26, 'canvasBlue'), (1.15, 0.85, 0.12, 0.0, 'planks'))):
        k.cyl(m, r, r, 0.13, x, y, z, seg=14)
        k.cyl(m if m != 'planks' else 'planksDark', r + 0.008, r + 0.008, 0.035, x, y + 0.11, z, seg=14)
    bx, bz = 1.1, -0.05 + 0.45
    k.push(0.0, 0, 0)
    k.cyl('iron', 0.1, 0.08, 0.04, -1.1, 0.22, 0.6, seg=10)
    for i in range(3):
        a = TAU * i / 3
        limb(k, 'iron', V(-1.1 + math.cos(a) * 0.09, 0, 0.6 + math.sin(a) * 0.09), V(-1.1 + math.cos(a) * 0.07, 0.24, 0.6 + math.sin(a) * 0.07), 0.01, 0.01, seg=4)
    k.cyl('fire', 0.075, 0.07, 0.01, -1.1, 0.26, 0.6, seg=10)
    lathe(k, 'iron', [(0.05, 0.27), (0.08, 0.3), (0.085, 0.36), (0.06, 0.4), (0.03, 0.42), (0.035, 0.44)], -1.1, 0, 0.6, seg=12)
    limb(k, 'iron', V(-1.04, 0.36, 0.6), V(-0.96, 0.43, 0.6), 0.01, 0.006, seg=5)
    k.marker('smoke', -1.1, 0.48, 0.6)
    k.pop()
    k.box('planks', 0.5, 0.04, 0.14, -1.05, 0.24, 0.15, ry=0.1)
    for x in (-1.25, -0.85):
        k.box('wood', 0.05, 0.24, 0.1, x, 0, 0.15 + (x + 1.05) * 0.1)
    for (x, z) in ((1.2, 0.2), ):
        pot_plant(k, x, z, 1.1, 'spiky')
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- aviary

def _cage_face(k, L, h, step=0.075, door=None):
    """bamboo cane bars between sill and plate (frame: x along the face, z out)"""
    if k.lod:
        step = 0.22
    n = max(2, round(L / step))
    for i in range(1, n):
        x = -L / 2 + i * L / n
        if door and door[0] < x < door[1]:
            continue
        k.cyl('bamboo', 0.008, 0.008, h - 0.08, x, 0.06, 0.0, seg=4)
    for yy in ((0.04, h * 0.5, h - 0.03) if not k.lod else (0.04, h - 0.03)):
        k.beam('bamboo', V(-L / 2, yy, 0.012), V(L / 2, yy, 0.012), 0.022, round_=True, seg=6)


@building('aviary')
def aviary(k):
    """a parrot aviary: a bamboo cage with a rope-netted top and a palm-thatched roost at the back, branch
    perches, fruit trays and a water trough, scarlet and blue-and-gold macaws and green amazons; the keeper's
    T-perch, seed sacks and a spare travelling cage outside"""
    cx, cz, cw, cd, ch = -0.32, -0.08, 1.9, 1.35, 1.3
    k.push(cx, 0, cz)
    k.box('sand', cw, 0.015, cd, 0, 0, 0, uvscale=1.0)
    k.box('darkwood', cw + 0.06, 0.06, cd + 0.06, 0, 0, 0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.cyl('bamboo', 0.035, 0.032, ch + 0.05, sx * cw / 2, 0, sz * cd / 2, seg=8)
            k.cyl('stone', 0.06, 0.055, 0.06, sx * cw / 2, 0, sz * cd / 2, seg=8)
    for sx in (-1, 1):
        k.cyl('bamboo', 0.03, 0.028, ch + 0.05, 0.0, 0, sx * cd / 2, seg=8)
    for f in ('front', 'back', 'left', 'right'):
        L = cw if f in ('front', 'back') else cd
        k.face(f, cw, cd)
        _cage_face(k, L, ch, door=(0.25, 0.6) if f == 'front' else None)
        k.pop()
    # door of canes in a frame, latched
    k.push(0.425, 0, cd / 2 + 0.02, 0.0)
    for sx in (-1, 1):
        k.box('bamboo', 0.035, 0.9, 0.035, sx * 0.17, 0.05, 0)
    k.box('bamboo', 0.38, 0.035, 0.035, 0, 0.93, 0)
    for i in range(4):
        k.cyl('bamboo', 0.009, 0.009, 0.85, -0.12 + i * 0.08, 0.07, 0.01, seg=4)
    for yy in (0.1, 0.5, 0.88):
        k.beam('bamboo', V(-0.16, yy, 0.02), V(0.16, yy, 0.02), 0.02, round_=True, seg=5)
    k.box('iron', 0.04, 0.03, 0.02, 0.14, 0.5, 0.035)
    k.pop()
    # netting over the open front of the top, roost thatch at the back
    if not k.lod:
        for i in range(13):
            x = -cw / 2 + i * cw / 12
            k.beam('rope', V(x, ch + 0.03, -0.05), V(x, ch + 0.03, cd / 2), 0.006, round_=True, seg=3)
        for j in range(5):
            z = -0.05 + j * (cd / 2 + 0.05) / 4
            k.beam('rope', V(-cw / 2, ch + 0.035, z), V(cw / 2, ch + 0.035, z), 0.006, round_=True, seg=3)
    from arch import _slope_grid
    _slope_grid(k, 'thatchDark', -cw / 2 - 0.12, cw / 2 + 0.12, ch + 0.3, ch - 0.02, -cd / 2 - 0.15, 0.05, 0.06, 0.03, 1.0, seed=2.3, fringe=0.1)
    for x in (-cw / 2, 0.0, cw / 2):
        k.beam('bamboo', V(x, ch + 0.25, -cd / 2 - 0.05), V(x, ch - 0.02, 0.05), 0.035, round_=True, seg=6)
    k.beam('bamboo', V(-cw / 2 - 0.1, ch, 0.02), V(cw / 2 + 0.1, ch, 0.02), 0.035, round_=True, seg=6)
    k.beam('bamboo', V(-cw / 2 - 0.1, ch + 0.05, -cd / 2), V(cw / 2 + 0.1, ch + 0.05, -cd / 2), 0.03, round_=True, seg=6)
    # roost boxes under the thatch
    for x in (-0.6, -0.2, 0.2):
        k.box('oldplanks', 0.24, 0.18, 0.18, x, ch - 0.38, -cd / 2 + 0.12, uvscale=1.4)
        k.box('black', 0.08, 0.08, 0.01, x, ch - 0.33, -cd / 2 + 0.215)
    k.box('oldplanks', 1.05, 0.03, 0.22, -0.2, ch - 0.41, -cd / 2 + 0.12, uvscale=1.4)
    # perches: a dead branch planted in the middle and cross poles
    tree_dead(k, -0.35, 0.05, 0.75, seed=7.0)
    perches = [(V(-0.85, 0.75, -0.3), V(0.85, 0.72, -0.3)), (V(-0.85, 0.48, 0.25), V(0.2, 0.5, 0.3)), (V(0.1, 0.95, -0.1), V(0.85, 0.98, 0.35))]
    for (a, b) in perches:
        k.beam('wood', a, b, 0.025, round_=True, seg=6)
    # birds on the perches
    birds = [(-0.6, 0.762, -0.3, 0.3, 'scarlet'), (-0.25, 0.755, -0.3, -0.4, 'gold'), (0.45, 0.733, -0.3, 0.2, 'scarlet'), (-0.55, 0.49, 0.26, 0.6, 'green'),
             (-0.1, 0.492, 0.28, 0.1, 'blue'), (0.35, 0.965, 0.0, -0.8, 'gold'), (0.7, 0.98, 0.28, 0.9, 'green'), (-0.62, 0.0, 0.42, 1.2, 'scarlet')]
    for (x, y, z, ry, kind) in birds:
        parrot(k, x, y + 0.012, z, ry, kind, 1.35)
    # a fruit tray on a stump and a water trough
    k.cyl('bark', 0.07, 0.07, 0.25, 0.55, 0, 0.2, seg=8)
    k.cyl('planks', 0.13, 0.12, 0.03, 0.55, 0.25, 0.2, seg=10)
    for i in range(5):
        a = TAU * i / 5
        blob(k, 'plasterYellow' if i % 2 else 'red', 0.55 + math.cos(a) * 0.06, 0.3, 0.2 + math.sin(a) * 0.06, 0.028, 0.025, 0.028, amp=0.1, rings=4, seg=6)
    k.box('planksDark', 0.4, 0.08, 0.12, -0.15, 0, 0.45, uvscale=1.3)
    k.box('water', 0.36, 0.005, 0.08, -0.15, 0.07, 0.45)
    k.pop()
    # outside: the keeper's T-perch with a bird on it, seed sacks, a travelling cage on a crate
    px, pz = 1.05, 0.55
    k.cyl('stoneDark', 0.1, 0.09, 0.05, px, 0, pz, seg=8)
    k.cyl('wood', 0.02, 0.02, 0.85, px, 0.05, pz, seg=6)
    k.beam('wood', V(px - 0.17, 0.9, pz), V(px + 0.17, 0.9, pz), 0.025, round_=True, seg=6)
    k.cyl('planks', 0.05, 0.05, 0.02, px + 0.17, 0.86, pz, seg=8)
    parrot(k, px - 0.05, 0.912, pz, 0.6, 'scarlet', 1.35)
    sack(k, 1.1, -0.1, 0.9)
    sack(k, 1.15, -0.4, 0.8, 1.0)
    crate(k, 1.0, 0, -0.65, 0.26, 0.1)
    k.push(1.0, 0.26, -0.65)
    k.cyl('planks', 0.1, 0.1, 0.02, 0, 0, 0, seg=10)
    if not k.lod:
        for i in range(10):
            a = TAU * i / 10
            k.beam('iron', V(math.cos(a) * 0.09, 0.02, math.sin(a) * 0.09), V(math.cos(a) * 0.02, 0.26, math.sin(a) * 0.02), 0.006, round_=True, seg=3)
        k.torus('iron', 0.025, 0.006, 0, 0.28, 0, rx=math.pi / 2, seg=8, rseg=3)
    parrot(k, 0.0, 0.07, 0.0, 2.0, 'green', 1.0)
    k.beam('wood', V(-0.07, 0.07, 0), V(0.07, 0.07, 0), 0.012, round_=True, seg=5)
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- animal pit

def cockerel(k, x, z, ry=0.0, body='red', s=1.0, crouch=0.0):
    """a fighting cock: deep breast, arched sickle tail, comb and wattles, spurred legs"""
    k.push(x, 0, z, ry)
    for sx in (-1, 1):
        k.cyl('plasterYellow', 0.006 * s, 0.006 * s, 0.07 * s, sx * 0.02 * s, 0, 0.0, seg=4)
    blob(k, body, 0, 0.11 * s - crouch, 0.0, 0.045 * s, 0.05 * s, 0.07 * s, amp=0.05, rings=6, seg=10, rx=-0.3)
    blob(k, body, 0, 0.17 * s - crouch, 0.06 * s, 0.022 * s, 0.03 * s, 0.025 * s, amp=0.0, rings=5, seg=8, rx=0.3 + crouch * 3)
    k.cyl('plasterYellow', 0.008 * s, 0.001, 0.025 * s, 0, 0.18 * s - crouch, 0.08 * s, seg=5, rx=math.pi / 2 + 0.3)
    slab(k, 'red', [(-0.02 * s, 0.0), (0.02 * s, 0.0), (0.015 * s, 0.02 * s), (0.0, 0.028 * s), (-0.015 * s, 0.022 * s)], 0.006 * s, 0, 0.19 * s - crouch, 0.058 * s, ry=math.pi / 2)
    if not k.lod:
        k.cbox('red', 0.008 * s, 0.025 * s, 0.012 * s, 0, 0.15 * s - crouch, 0.08 * s)
        for sx in (-1, 1):
            k.cbox('black', 0.004, 0.006 * s, 0.006 * s, sx * 0.02 * s, 0.18 * s - crouch, 0.07 * s)
    for i, (m, a) in enumerate((('black', 0.9), ('leaf', 0.6), ('black', 0.3), (body, 1.2))):
        leaf_blade(k, V(0, 0.13 * s - crouch, -0.05 * s), V(0, math.sin(a), -math.cos(a)), 0.13 * s, 0.035 * s, 1.0, mat=m, seg=4)
    k.pop()


@building('animal_pit')
def animal_pit(k):
    """a cockpit: a round pit walled with coral rag and lined with boards, a sanded floor where two birds square
    off, ringed by tiered plank benches on trestles; a chalked odds board, wicker cock baskets, lanterns and drink"""
    R = 0.62
    # sanded floor and the lined pit wall
    k.cyl('sand', R, R, 0.02, 0, 0, 0, seg=24)
    n = 12 if k.lod else 40
    for i in range(n):
        a = TAU * (i + 0.5) / n
        k.box('oldplanks', TAU * R / n + 0.005, 0.32 + (k.r() * 0.02 if not k.lod else 0), 0.025, math.cos(a) * R, 0, math.sin(a) * R, ry=math.pi / 2 - a, uvscale=1.4, grain=1)
    m = 10 if k.lod else 30
    for r in range(1 if k.lod else 3):
        for i in range(m):
            a = TAU * (i + 0.5 * (r % 2)) / m
            if k.lod:
                k.box('stone', TAU * (R + 0.09) / m + 0.01, 0.3, 0.16, math.cos(a) * (R + 0.1), 0, math.sin(a) * (R + 0.1), ry=math.pi / 2 - a, uvscale=2.0)
            else:
                k.cbox('stone', TAU * (R + 0.09) / m - 0.012, 0.09, 0.14 + k.r() * 0.03, math.cos(a) * (R + 0.1), 0.05 + r * 0.1, math.sin(a) * (R + 0.1),
                       ry=math.pi / 2 - a + (k.r() - 0.5) * 0.1, rx=(k.r() - 0.5) * 0.1, uvscale=2.0)
    for i in range(1 if k.lod else 24):
        a = TAU * (i + 0.5) / 24
        if k.lod:
            k.torus('planks', R + 0.09, 0.05, 0, 0.32, 0, seg=20, rseg=4)
        else:
            k.cbox('planks', TAU * (R + 0.09) / 24 + 0.01, 0.04, 0.2, math.cos(a) * (R + 0.09), 0.33, math.sin(a) * (R + 0.09), ry=math.pi / 2 - a, uvscale=1.4)
    # the birds, a few loose feathers
    cockerel(k, -0.15, 0.05, 1.3, 'red', 1.6, 0.02)
    cockerel(k, 0.17, -0.02, -1.8, 'darkwood', 1.6, 0.0)
    if not k.lod:
        for i in range(6):
            a = k.r() * TAU
            r = k.r() * 0.4
            k.cbox('red' if i % 2 else 'black', 0.04, 0.003, 0.012, math.cos(a) * r, 0.022, math.sin(a) * r, ry=k.r() * 3)
    # tiered benches, open towards the road
    for (rr, yy) in ((0.98, 0.24), (1.24, 0.44)):
        nseg = 10
        a0, a1 = math.radians(130), math.radians(410)
        for i in range(nseg):
            a = a0 + (a1 - a0) * (i + 0.5) / nseg
            L = (a1 - a0) / nseg * rr - 0.03
            x, z = math.cos(a) * rr, math.sin(a) * rr
            k.push(x, 0, z, math.pi / 2 - a)
            k.box('planks', L, 0.04, 0.17, 0, yy, 0, uvscale=1.3)
            for sx in (-1, 1):
                for sz in (-1, 1):
                    k.box('darkwood', 0.035, yy, 0.035, sx * (L / 2 - 0.05), 0, sz * 0.055)
                k.box('darkwood', 0.03, 0.03, 0.15, sx * (L / 2 - 0.05), yy * 0.4, 0)
            if not k.lod and k.r() > 0.6:
                k.cyl('planksDark', 0.025, 0.03, 0.06, (k.r() - 0.5) * L * 0.7, yy + 0.04, 0.02, seg=8)
            k.pop()
    # the odds board: a slate on a post, chalked
    bx, bz = -0.95, 1.05
    k.box('darkwood', 0.05, 0.95, 0.05, bx, 0, bz)
    k.box('darkwood', 0.42, 0.3, 0.03, bx, 0.62, bz + 0.035, ry=0.4)
    k.box('black', 0.37, 0.25, 0.01, bx + math.sin(0.4) * 0.02, 0.645, bz + 0.05 + math.cos(0.4) * 0.0, ry=0.4)
    if not k.lod:
        for j in range(4):
            for i in range(3):
                k.box('plaster', 0.06 + k.r() * 0.03, 0.01, 0.004, bx - 0.12 + i * 0.12 + math.sin(0.4) * 0.03, 0.68 + j * 0.05, bz + 0.06 - i * 0.05 * math.sin(0.4), ry=0.4)
    # cock baskets: wicker domes on the ground by the entry
    for (x, z, s) in ((0.7, 1.05, 1.0), (0.98, 0.9, 0.85)):
        lathe(k, 'weave', [(0.13 * s, 0.0), (0.135 * s, 0.06 * s), (0.12 * s, 0.14 * s), (0.08 * s, 0.2 * s), (0.02 * s, 0.23 * s)], x, 0, z, seg=12, uvscale=2.5)
        k.torus('wood', 0.025 * s, 0.006, x, 0.245 * s, z, rx=math.pi / 2, seg=8, rseg=3)
    lantern_post(k, -0.5, 1.15, 1.0, ry=math.pi * 0.75)
    lantern_post(k, 0.48, 1.15, 1.0, ry=-math.pi * 0.75)
    cask(k, 1.15, 0.45, 0.8)
    cask(k, -1.18, 0.5, 0.75, lying=True, ry=0.4)
    for i in range(3):
        k.cyl('planksDark', 0.025, 0.03, 0.06, 1.15 + (i - 1) * 0.05, 0.29, 0.45 + (i % 2) * 0.03, seg=8)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- black market

def drape(k, mat, x, z, lumps, ext=0.12, ry=0.0, res=0.045, seed=0.0, lash=True):
    """a tarpaulin thrown over a stack of goods: lumps are (u, v, half-w, half-d, h) blocks it rests on; between and
    beyond them the cloth slumps to the ground in folds"""
    if k.lod:
        res *= 2.5
    u0 = min(l[0] - l[2] for l in lumps) - ext
    u1 = max(l[0] + l[2] for l in lumps) + ext
    v0 = min(l[1] - l[3] for l in lumps) - ext
    v1 = max(l[1] + l[3] for l in lumps) + ext
    nx, nz = max(2, round((u1 - u0) / res)), max(2, round((v1 - v0) / res))
    verts, faces = [], []
    for j in range(nz + 1):
        for i in range(nx + 1):
            u, v = u0 + (u1 - u0) * i / nx, v0 + (v1 - v0) * j / nz
            y = 0.0
            for (cu, cv, hw, hd, hh) in lumps:
                e = max(abs(u - cu) - hw, abs(v - cv) - hd, 0.0) / ext
                y = max(y, hh * (1 - min(1.0, e)) ** 1.6 if e > 0 else hh - 0.01 * (abs(u - cu) / hw) ** 4)
            fold = noise.noise(Vector((u * 7 + seed, v * 7, seed))) * 0.025 + noise.noise(Vector((u * 19, v * 19 + seed, 1.0))) * 0.008
            edge = min(1.0, y / 0.05)
            verts.append(V(u, max(0.004, y + fold * (0.4 + 0.6 * (1 - edge * 0.6)) * edge + 0.006), v))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
    k.mesh(mat, verts, faces, uvscale=1.2, local=_xf(x, 0, z, ry))
    if lash and not k.lod:
        k.push(x, 0, z, ry)
        top = max(l[4] for l in lumps)
        for t in (0.3, 0.7):
            u = u0 + ext + (u1 - u0 - 2 * ext) * t
            hh = max(l[4] for l in lumps if abs(u - l[0]) <= l[2] + 0.02) if any(abs(u - l[0]) <= l[2] + 0.02 for l in lumps) else top
            pts = [V(u, 0.0, v0 + 0.02), V(u, hh * 0.85, v0 + ext * 0.75), V(u, hh + 0.012, v0 + ext + 0.05), V(u, hh + 0.012, v1 - ext - 0.05), V(u, hh * 0.85, v1 - ext * 0.75), V(u, 0.0, v1 - 0.02)]
            for p, q in zip(pts, pts[1:]):
                k.beam('rope', p, q, 0.012, round_=True, seg=4)
        k.pop()


def pistol(k, x, y, z, ry=0.0):
    k.push(x, y, z, ry)
    k.cyl('iron', 0.008, 0.008, 0.16, 0, 0.012, 0.0, seg=5, rx=math.pi / 2)
    k.cbox('darkwood', 0.022, 0.022, 0.12, 0, 0.012, -0.05)
    k.cbox('darkwood', 0.02, 0.022, 0.06, 0, 0.012, -0.12, rx=0.0)
    k.cbox('brass', 0.024, 0.024, 0.02, 0, 0.012, -0.15)
    k.pop()


def cutlass(k, x, y, z, ry=0.0, rx=0.0, rz=0.0):
    k.push(x, y, z, ry, rx, rz)
    slab(k, 'iron', [(-0.012, 0.0), (0.012, 0.0), (0.016, 0.24), (0.0, 0.29), (-0.008, 0.25)], 0.004)
    k.cbox('brass', 0.07, 0.012, 0.012, 0, -0.005, 0)
    k.cyl('darkwood', 0.009, 0.009, 0.07, 0, -0.08, 0, seg=5)
    if not k.lod:
        k.beam('brass', V(0.03, -0.005, 0), V(0.02, -0.08, 0.0), 0.006, round_=True, seg=4)
    k.pop()


def chest(k, x, z, ry=0.0, open_=True, s=1.0, gold=True):
    """an iron-bound sea chest, the lid thrown back on a heap of coin"""
    k.push(x, 0, z, ry)
    W, D, H = 0.34 * s, 0.22 * s, 0.17 * s
    k.box('planksDark', W, H, D, 0, 0, 0, uvscale=1.4)
    for xx in (-W * 0.35, W * 0.35):
        k.box('iron', 0.02 * s, H + 0.004, D + 0.008, xx, 0, 0)
    if open_:
        k.push(0, H, -D / 2, 0, -1.9)
        k.box('planksDark', W, 0.03 * s, D, 0, 0, D / 2, uvscale=1.4)
        for xx in (-W * 0.35, W * 0.35):
            k.box('iron', 0.02 * s, 0.034 * s, D + 0.006, xx, 0, D / 2)
        k.pop()
        if gold:
            blob(k, 'gold', 0, H - 0.01, 0, W * 0.47, 0.05 * s, D * 0.45, amp=0.3, freq=7, seed=x, rings=5, seg=10)
            if not k.lod:
                for i in range(5):
                    k.cyl('gold', 0.014, 0.014, 0.004, (k.r() - 0.5) * W, H + 0.035, (k.r() - 0.5) * D * 0.7, seg=8, rx=k.r() * 0.6)
    else:
        k.cbox('planksDark', W + 0.01, 0.05 * s, D + 0.01, 0, H + 0.02, 0, uvscale=1.4)
        k.box('brass', 0.04 * s, 0.05 * s, 0.01, 0, H - 0.04, D / 2 + 0.003)
    k.pop()


def stall(k, x, z, w, d, mat, hf=1.15, hb=0.95, ry=0.0):
    """four poles and a sloping tarp, falling toward the back, lashed down with guys"""
    k.push(x, 0, z, ry)
    for sx in (-1, 1):
        k.cyl('bark', 0.03, 0.027, hf, sx * w / 2, 0, d / 2, seg=7)
        k.cyl('bark', 0.03, 0.027, hb, sx * w / 2, 0, -d / 2, seg=7)
    for (zz, hh) in ((d / 2, hf), (-d / 2, hb)):
        k.beam('bark', V(-w / 2 - 0.05, hh - 0.02, zz), V(w / 2 + 0.05, hh - 0.02, zz), 0.035, round_=True)
    nx, nz = (3, 2) if k.lod else (10, 6)
    v, f = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            u = i / nx
            v.append(V(-w / 2 - 0.08 + (w + 0.16) * u, hf + 0.01 - (hf - hb) * t - 0.05 * math.sin(math.pi * u) * math.sin(math.pi * t), d / 2 + 0.12 - (d + 0.24) * t))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            f += [(a, a + 1, a + nx + 2, a + nx + 1), (a, a + nx + 1, a + nx + 2, a + 1)]
    k.mesh(mat, v, f, uvscale=1.0)
    # front valance hanging ragged
    k.mesh(mat, [V(-w / 2 - 0.08, hf + 0.01, d / 2 + 0.12), V(w / 2 + 0.08, hf + 0.01, d / 2 + 0.12), V(w / 2 + 0.08, hf - 0.1, d / 2 + 0.13), V(0, hf - 0.07, d / 2 + 0.13), V(-w / 2 - 0.08, hf - 0.12, d / 2 + 0.13)],
           [(0, 4, 3, 2, 1), (1, 2, 3, 4, 0)])
    if not k.lod:
        for sx in (-1, 1):
            k.beam('rope', V(sx * (w / 2 + 0.06), hb, -d / 2 - 0.1), V(sx * (w / 2 + 0.2), 0, -d / 2 - 0.3), 0.007, round_=True, seg=3)
            k.cyl('wood', 0.012, 0.008, 0.06, sx * (w / 2 + 0.2), 0, -d / 2 - 0.3, seg=4)
    k.pop()


@building('black_market')
def black_market(k):
    """a fence of salvaged planks screening a huddle of covered stalls: a weapons table of pistols and cutlasses,
    bolts of stolen silk, tarpaulins lashed over crates and casks of contraband, an open chest of coin, a lantern
    for after dark and the trader's stool with a blunderbuss to hand"""
    # back screen fence of old planks, ship's timbers for posts
    for (a, b) in (((-1.3, -1.2), (1.3, -1.2)), ((-1.3, -1.2), (-1.3, 0.2)), ((1.3, -1.2), (1.3, -0.3))):
        A, B = V(a[0], 0, a[1]), V(b[0], 0, b[1])
        L = (B - A).length
        ang = math.atan2(-(B - A).z, (B - A).x)
        k.push(A.x, 0, A.z, ang)
        n = max(1, round(L / (0.25 if k.lod else 0.11)))
        for i in range(n):
            hh = 0.95 + (k.r() - 0.5) * 0.12
            k.box('oldplanks', L / n - 0.01, hh, 0.025, (i + 0.5) * L / n, 0, 0, ry=(k.r() - 0.5) * 0.05, uvscale=1.3, grain=1)
        for yy in (0.2, 0.75):
            k.box('darkwood', L, 0.06, 0.04, L / 2, yy, -0.03)
        for i in range(round(L / 0.8) + 1):
            k.box('darkwood', 0.08, 1.02, 0.08, i * L / round(L / 0.8), 0, -0.04)
        k.pop()
    # stall 1 (left): the armourer's table under a purple tarp
    stall(k, -0.6, -0.45, 1.2, 0.85, 'canvasPurple')
    tx, tz = -0.6, -0.25
    k.box('planks', 1.0, 0.04, 0.42, tx, 0.38, tz, uvscale=1.3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('darkwood', 0.04, 0.38, 0.04, tx + sx * 0.45, 0, tz + sz * 0.17)
    k.box('canvasRed', 1.02, 0.1, 0.44, tx, 0.31, tz)
    for i in range(4):
        pistol(k, tx - 0.38 + i * 0.12, 0.42, tz + 0.08, 0.2 * (i - 1.5) + math.pi)
    for i in range(3):
        cutlass(k, tx + 0.15 + i * 0.1, 0.43, tz + 0.12, 0.0, -math.pi / 2, 0.15 * i)
    # powder kegs and a rack of muskets behind
    for i in range(4):
        k.beam('darkwood', V(-1.12 + i * 0.1, 0.0, -0.95), V(-1.08 + i * 0.1, 0.9, -1.12), 0.025)
        k.cyl('iron', 0.008, 0.008, 0.35, -1.1 + i * 0.1, 0.58, -1.06, seg=4, rx=-0.2)
    cask(k, -0.15, -0.95, 0.7)
    cask(k, -0.32, -1.0, 0.65)
    # stall 2 (right): bolts of silk, tobacco and spice
    stall(k, 0.7, -0.5, 1.05, 0.8, 'canvas', hf=1.1, hb=0.9)
    k.box('planks', 0.9, 0.04, 0.36, 0.7, 0.36, -0.3, uvscale=1.3)
    for sx in (-1, 1):
        k.box('darkwood', 0.05, 0.36, 0.3, 0.7 + sx * 0.4, 0, -0.3)
    for i, m in enumerate(('canvasRed', 'canvasPurple', 'canvasBlue', 'canvasGreen', 'plasterYellow')):
        k.cyl(m, 0.045, 0.045, 0.4, 0.42 + i * 0.11, 0.445, -0.3, seg=10, rx=math.pi / 2)
    sack(k, 0.5, -0.75, 0.9)
    sack(k, 0.75, -0.8, 0.85, 0.7)
    sack(k, 0.98, -0.75, 0.9, 1.4)
    # the contraband under tarps, lashed
    drape(k, 'canvas', 0.82, 0.6, [(-0.12, -0.05, 0.16, 0.16, 0.52), (0.2, 0.0, 0.14, 0.15, 0.34), (-0.1, 0.2, 0.12, 0.08, 0.22)], 0.16, ry=0.15, seed=1.0)
    crate(k, 1.15, 0, 0.82, 0.22, 0.4)
    drape(k, 'canvasGreen', -0.8, 0.78, [(0.0, 0.0, 0.13, 0.13, 0.36), (0.22, 0.05, 0.1, 0.12, 0.28)], 0.13, ry=-0.2, seed=3.0)
    cask(k, -0.42, 0.85, 0.7, lying=True, ry=0.3)
    crate(k, 1.18, 0, 0.18, 0.26, 0.3)
    crate(k, 1.2, 0.26, 0.2, 0.22, 0.1)
    cask(k, -1.12, 0.35, 0.8)
    cask(k, -1.05, 0.05, 0.75, lying=True, ry=0.2)
    # an open chest of coin in front of the trader's stool, a lantern on a pole
    chest(k, 0.05, 0.55, -0.3, True, 1.0)
    k.cyl('wood', 0.11, 0.11, 0.03, -0.25, 0.27, 0.15, seg=10)
    for i in range(3):
        a = TAU * i / 3
        limb(k, 'wood', V(-0.25 + math.cos(a) * 0.09, 0, 0.15 + math.sin(a) * 0.09), V(-0.25 + math.cos(a) * 0.06, 0.27, 0.15 + math.sin(a) * 0.06), 0.015, 0.012)
    k.push(-0.08, 0.0, 0.3, 0.5, 0, 0.15)
    k.cyl('iron', 0.016, 0.026, 0.35, 0, 0.12, 0, seg=7)
    k.cbox('darkwood', 0.035, 0.18, 0.04, 0, 0.06, 0)
    k.pop()
    lantern_post(k, 0.0, 1.1, 1.1, ry=math.pi)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- rock, palms, boats

def outcrop(k, x, z, ex, ey, ez, seed=0.0, mouth=None, ry=0.0, mat='stoneDark', y0=0.0, amp=0.18, cap='dirt'):
    """a weathered limestone outcrop as a displaced dome; mouth=(w, h, depth) presses a cave mouth into its
    front (+z) whose deep faces are black; flat tops take a skin of earth"""
    rings, seg = (6, 14) if k.lod else (16, 36)
    if mouth:
        rings, seg = (8, 18) if k.lod else (20, 48)
    off = Vector((seed * 1.3, seed * 0.7, seed * 2.1))
    verts, fdeep = [], []
    for j in range(rings + 1):
        ph = (math.pi / 2) * j / rings if j < rings else math.pi / 2
        for i in range(seg if j < rings else 1):
            a = TAU * i / seg
            d = Vector((math.cos(ph) * math.cos(a), math.sin(ph), math.cos(ph) * math.sin(a)))
            n = noise.noise(d * 1.8 + off) * 0.6 + noise.noise(d * 4.5 + off * 2) * 0.3 + (0.5 - abs(noise.noise(d * 3.0 + off * 3))) * 0.35
            r = 1 + amp * n
            p = Vector((d.x * ex * r, d.y * ey * r, d.z * ez * r))
            p.y += 0.03 * math.sin(p.y * 22 + noise.noise(d * 3 + off) * 2) * (1 if j else 0)  # bedding planes
            if j == 0:
                p.y = -0.03
            f = 0.0
            if mouth and p.z > 0:
                mw, mh, md = mouth
                ty = max(0.0, p.y - mh * 0.45) / (mh * 0.55)
                m = (p.x / mw) ** 2 + ty ** 2
                m = m if p.y < mh else 9
                f = max(0.0, min(1.0, (1.25 - m) / 0.6))
                f = f * f * (3 - 2 * f)
                p.z -= md * f
                p.x *= 1 - 0.25 * f
                if j == 0:
                    p.y = -0.03
            verts.append(p)
            fdeep.append(f)
    rock, black, top = [], [], []
    def vi(j, i):
        return j * seg + (i % seg) if j < rings else rings * seg
    for j in range(rings):
        for i in range(seg):
            if j < rings - 1:
                f = (vi(j, i), vi(j, i + 1), vi(j + 1, i + 1), vi(j + 1, i))
            else:
                f = (vi(j, i), vi(j, i + 1), vi(j + 1, 0))
            f = f[::-1]
            deep = all(fdeep[q] > 0.55 for q in f)
            pts = [verts[q] for q in f]
            nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            up = nrm.normalized().y if nrm.length > 1e-9 else 0
            (black if deep else (top if (cap and up > 0.82 and pts[0].y > ey * 0.45) else rock)).append(f)
    L = _xf(x, y0, z, ry)
    k.mesh(mat, verts, rock, uvscale=1.6, local=L)
    if black:
        k.mesh('black', verts, black, local=L)
    if top:
        k.mesh(cap, verts, top, uvscale=1.0, local=L)


def palm(k, x, z, h=1.6, lean=(0.2, 0.0), seed=0.0, fronds=9):
    """a coconut palm: a ringed, curving trunk, a crown of drooping fronds and a bunch of nuts"""
    n = 4 if k.lod else 9
    p = Vector((x, 0, z))
    pts = [p.copy()]
    for i in range(1, n + 1):
        t = i / n
        pts.append(Vector((x + lean[0] * h * t * t, h * t, z + lean[1] * h * t * t)))
    for i in range(n):
        r0 = 0.055 - 0.02 * i / n
        limb(k, 'bark', pts[i], pts[i + 1] + (pts[i + 1] - pts[i]) * 0.03, r0, r0 - 0.004, seg=8 if not k.lod else 5)
    top = pts[-1]
    blob(k, 'bark', top.x, top.y, top.z, 0.06, 0.06, 0.06, amp=0.2, rings=5, seg=8)
    for i in range(fronds):
        a = TAU * i / fronds + seed
        el = 0.35 + 0.35 * ((i * 7) % 3) / 2
        d = V(math.cos(a), el, math.sin(a))
        _frond(k, top + V(0, 0.03, 0), d, 0.75 + 0.15 * math.sin(i * 2.3 + seed), 0.7)
    if not k.lod:
        for i in range(4):
            a = TAU * i / 4 + seed
            blob(k, 'darkwood', top.x + math.cos(a) * 0.06, top.y - 0.06, top.z + math.sin(a) * 0.06, 0.04, 0.045, 0.04, amp=0.05, rings=4, seg=7)


def _frond(k, base, d, L, droop):
    """a palm frond: a curving rachis with leaflets cut along both sides (a ribbon of serrated quads)"""
    d = Vector(d).normalized()
    side = d.cross(Vector((0, 1, 0)))
    side = side.normalized() if side.length > 1e-3 else Vector((1, 0, 0))
    seg = 3 if k.lod else 8
    verts, faces = [], []
    p, dd = Vector(base), d.copy()
    for i in range(seg + 1):
        t = i / seg
        ww = 0.16 * math.sin(math.pi * min(1.0, 0.1 + t * 0.95)) + 0.01
        dn = Vector((0, -1, 0)) * ww * 0.35
        jag = 0 if k.lod else (0.03 if i % 2 else -0.02)
        verts += [p + side * ww + dn + dd * jag, p, p - side * ww + dn + dd * jag]
        p = p + dd * (L / seg)
        dd = (dd + Vector((0, -droop * 2.0 / seg, 0))).normalized()
    for i in range(seg):
        a = i * 3
        faces += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
    k.mesh('leaf', verts, faces, uvscale=2.0)
    k.mesh('leaf', verts, [f[::-1] for f in faces], uvscale=2.0)


def rowboat(k, x, y, z, ry=0.0, L=0.85, B=0.17, D=0.12, oars=True):
    """a clinker-built jolly boat: lofted hull with a raked transom, thwarts, gunwale and a pair of oars"""
    ns, nt = (6, 4) if k.lod else (16, 8)
    def sec(t, scale=1.0, lift=0.0):
        b = B * (math.sqrt(max(0.0, 1 - t * t)) if t > 0 else (1 - 0.55 * t * t)) * scale
        d = D * (1 - 0.35 * t * t) * scale
        sheer = 0.035 * t * t + lift
        return [(b * math.sin(th), sheer - d * math.cos(th)) for th in [-math.pi / 2 + math.pi * q / nt for q in range(nt + 1)]]
    outer, inner = [], []
    for s in range(ns + 1):
        t = -1 + 2 * s / ns
        xx = t * L / 2
        for (u, v) in sec(t):
            outer.append(V(xx, v, u))
        for (u, v) in sec(t, 0.88, 0.006):
            inner.append(V(xx, v, u))
    m = nt + 1
    fo, fi, fg = [], [], []
    for s in range(ns):
        for q in range(nt):
            a = s * m + q
            fo.append((a, a + 1, a + m + 1, a + m))
            fi.append((a + m, a + m + 1, a + 1, a))
    verts = outer + inner
    off = len(outer)
    for s in range(ns):
        for q in (0, nt):
            a, b = s * m + q, (s + 1) * m + q
            fg.append((a, b, off + b, off + a) if q == nt else (a, off + a, off + b, b))
    tr = [q for q in range(m)]
    fg.append(tuple(tr) + tuple(off + q for q in reversed(tr)))
    Lm = _xf(x, y, z, ry)
    k.mesh('planks', verts, fo, uvscale=2.0, local=Lm)
    k.mesh('planksDark', verts, fi + fg, uvscale=2.0, local=Lm)
    k.push(x, y, z, ry)
    if not k.lod:
        for sx in (-1, 1):
            pts = [V(-L / 2 + L * i / 8, 0.035 * ((-1 + 2 * i / 8) ** 2) + 0.008, sx * B * (math.sqrt(max(0, 1 - (-1 + 2 * i / 8) ** 2)) if -1 + 2 * i / 8 > 0 else 1 - 0.55 * (-1 + 2 * i / 8) ** 2)) for i in range(9)]
            for p, q in zip(pts, pts[1:]):
                k.beam('darkwood', p, q, 0.018, 0.012)
    for xx in (-0.22, 0.05, 0.25):
        bb = B * (math.sqrt(max(0, 1 - (2 * xx / L) ** 2)) if xx > 0 else 1 - 0.55 * (2 * xx / L) ** 2) * 0.9
        k.box('planks', 0.06, 0.015, 2 * bb, xx, -0.025, 0, uvscale=1.5)
    if oars:
        for sx in (-1, 1):
            k.push(0.0, 0.02, sx * 0.04, 0.0)
            k.beam('wood', V(-0.35, 0.0, sx * 0.02), V(0.3, 0.005, sx * 0.04), 0.016, round_=True, seg=5)
            k.cbox('wood', 0.16, 0.006, 0.05, -0.38, 0.0, sx * 0.02)
            k.pop()
    k.pop()


# ------------------------------------------------------------------------------------------- pirate cave

def torch(k, x, z, h=0.85):
    """a tarred torch in an iron cresset on a stake"""
    k.cyl('wood', 0.02, 0.016, h, x, 0, z, seg=6)
    k.cyl('iron', 0.035, 0.05, 0.08, x, h - 0.02, z, seg=8, caps=False)
    if not k.lod:
        for i in range(4):
            a = TAU * i / 4
            k.beam('iron', V(x + math.cos(a) * 0.035, h - 0.02, z + math.sin(a) * 0.035), V(x + math.cos(a) * 0.05, h + 0.06, z + math.sin(a) * 0.05), 0.008)
    blob(k, 'soil', x, h + 0.02, z, 0.035, 0.03, 0.035, amp=0.1, rings=4, seg=7)
    lathe(k, 'fire', [(0.035, h + 0.04), (0.04, h + 0.08), (0.025, h + 0.14), (0.008, h + 0.2), (0.002, h + 0.23)], x, 0, z, seg=7)
    k.marker('smoke', x, h + 0.25, z)


@building('cave')
def cave(k):
    """the captain's hoard: a weathered limestone outcrop with a black cave mouth shored with ship's timbers,
    a skull nailed over the lintel, torches either side, casks and a chest of coin at the threshold, a lantern
    inside, vines and a palm clinging to the top"""
    cz = -0.35
    outcrop(k, 0.0, cz, 1.25, 1.35, 0.95, seed=3.0, mouth=(0.38, 0.82, 0.75))
    # flanking boulders
    outcrop(k, 0.95, 0.55, 0.38, 0.4, 0.34, seed=5.0, ry=0.4, cap=None)
    outcrop(k, -0.98, 0.45, 0.32, 0.3, 0.3, seed=8.0, ry=1.2, cap=None)
    outcrop(k, -0.65, 0.9, 0.16, 0.12, 0.14, seed=11.0, cap=None)
    # shoring frame of ship's timbers in the mouth
    fz = cz + 0.64
    for sx in (-1, 1):
        k.box('darkwood', 0.085, 0.82, 0.085, sx * 0.33, 0, fz, rz=sx * 0.06)
    k.box('darkwood', 0.84, 0.09, 0.1, 0, 0.8, fz)
    if not k.lod:
        for sx in (-1, 1):
            k.beam('darkwood', V(sx * 0.3, 0.6, fz), V(sx * 0.15, 0.79, fz), 0.05)
        for x in (-0.3, 0.3):
            k.cyl('iron', 0.008, 0.008, 0.03, x, 0.84, fz + 0.05, seg=4, rx=math.pi / 2)
    skull(k, 0.0, 0.9, fz + 0.01, 1.2, rx=-0.1)
    k.box('iron', 0.02, 0.02, 0.06, 0.0, 0.94, fz + 0.03)
    # a lantern hung inside the mouth, a chest and the hoard glinting in the dark
    k.beam('iron', V(0.0, 0.8, fz - 0.05), V(0.0, 0.68, fz - 0.05), 0.008, round_=True, seg=4)
    k.box('window', 0.07, 0.1, 0.07, 0.0, 0.57, fz - 0.05)
    k.box('iron', 0.09, 0.015, 0.09, 0.0, 0.67, fz - 0.05)
    k.box('iron', 0.09, 0.015, 0.09, 0.0, 0.56, fz - 0.05)
    chest(k, 0.05, fz - 0.05, 0.25, True, 1.0)
    if not k.lod:
        for i in range(8):
            k.cyl('gold', 0.014, 0.014, 0.004, (k.r() - 0.5) * 0.4, 0.002, fz + 0.05 + k.r() * 0.25, seg=8, rx=k.r() * 0.3)
    torch(k, -0.55, fz + 0.15, 0.85)
    torch(k, 0.55, fz + 0.15, 0.85)
    cask(k, -0.42, fz + 0.45, 0.8)
    cask(k, -0.62, fz + 0.62, 0.75, lying=True, ry=0.5)
    cask(k, 0.48, fz + 0.5, 0.75)
    crate(k, 0.66, 0, fz + 0.3, 0.24, 0.3)
    rope_coil(k, 0.25, fz + 0.62, 0.1)
    k.push(-0.25, 0, fz + 0.45, 0.6, 0.0, 0.0)
    limb(k, 'wood', V(0, 0, 0), V(0.0, 0.02, 0.55), 0.014, 0.012)
    k.cbox('iron', 0.24, 0.025, 0.025, 0, 0.015, 0.55, ry=math.pi / 2)
    k.pop()
    # trodden earth before the mouth, vines over the brow, a palm and scrub on top
    k.box('dirt', 1.0, 0.006, 0.8, 0, 0, fz + 0.4, uvscale=0.8)
    if not k.lod:
        for i in range(9):
            x = -0.45 + i * 0.11
            L = 0.15 + 0.2 * abs(math.sin(i * 1.7))
            yb = 1.0 + 0.1 * math.cos(i)
            k.beam('leaf', V(x, yb, fz + 0.12), V(x + 0.02, yb - L, fz + 0.14), 0.012, round_=True, seg=4)
            leaf_blade(k, V(x, yb - L * 0.5, fz + 0.15), V(0.3, -0.5, 1), 0.06, 0.04, 0.2)
    palm(k, 0.45, cz - 0.3, 1.3, lean=(0.25, 0.1), seed=1.0, fronds=8)
    k.push(0, 0, 0)
    for (x, y, z, s) in ((-0.5, 1.15, cz - 0.1, 0.18), (-0.2, 1.3, cz - 0.4, 0.14), (0.75, 0.95, cz + 0.1, 0.13), (-0.85, 0.8, cz - 0.3, 0.15)):
        blob(k, 'leaf', x, y, z, s, s * 0.7, s, amp=0.35, freq=4, seed=x * 5, rings=6, seg=10)
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- smuggler's cove

@building('smugglers_cove')
def smugglers_cove(k):
    """a smugglers' landing: a plank shack tucked under an overhanging limestone bluff beside a hidden creek, a
    jetty on piles with a jolly boat moored alongside, contraband stacked for the night run, nets drying"""
    # the bluff and its overhang
    outcrop(k, -0.75, -1.0, 1.15, 1.55, 0.55, seed=2.0)
    outcrop(k, -0.65, -0.55, 1.1, 0.42, 0.7, seed=6.0, y0=1.05, cap='dirt')
    outcrop(k, 0.55, -1.05, 0.7, 0.9, 0.4, seed=9.0, ry=0.3)
    outcrop(k, -1.5, -0.1, 0.32, 1.05, 0.45, seed=4.0)
    # the creek: water held between rocks and a shingle beach
    wx0, wx1, wz0, wz1 = 0.05, 1.82, -0.55, 1.32
    k.box('sand', 1.95, 0.008, 2.0, 0.85, 0, 0.35, uvscale=0.8)
    k.box('water', wx1 - wx0 - 0.1, 0.006, wz1 - wz0, (wx0 + wx1) / 2 + 0.05, 0.012, (wz0 + wz1) / 2)
    for i in range(14 if not k.lod else 6):
        t = i / (13 if not k.lod else 5)
        zz = wz0 + (wz1 - wz0) * t
        outcrop(k, wx0 + 0.02 + 0.04 * math.sin(i * 2.1), zz, 0.09 + 0.04 * abs(math.sin(i)), 0.06 + 0.03 * abs(math.cos(i * 1.3)), 0.08, seed=i * 1.7, cap=None, amp=0.3)
    # the shack under the overhang
    sx0, sz0 = -0.65, -0.45
    k.push(sx0, 0, sz0)
    plinth(k, 1.25, 0.8, 0.08, 'stoneDark')
    k.push(0, 0.08, 0)
    board_batten(k, 1.2, 0.75, 0.78, 'oldplanks', [Op('front', -0.25, 'door', w=0.38, h=0.68), Op('front', 0.3, 'window', w=0.24, h=0.22, y=0.36), Op('left', 0.0, 'window', w=0.2, h=0.2, y=0.36, shutters=False)])
    shingle_lean(k, 1.36, 0.95, 0.98, 0.76, z0=-0.47, mat='oldplanks')
    k.pop()
    lantern(k, 0.05, 0.8, 0.38)
    k.pop()
    steps(k, sx0 - 0.25, sz0 + 0.48, 0.42, 0.08, 1, 'stone')
    # the jetty
    jz, jy = 0.42, 0.2
    k.push(0.95, 0, jz)
    deck(k, 1.6, 0.42, jy, 'oldplanks', along='z', joists=False)
    for x in (-0.75, -0.25, 0.25, 0.75):
        for zz in (-0.19, 0.19):
            k.cyl('bark', 0.035, 0.032, jy - 0.02, x, 0, zz, seg=7)
    k.box('darkwood', 1.6, 0.05, 0.05, 0, jy - 0.1, -0.19)
    k.box('darkwood', 1.6, 0.05, 0.05, 0, jy - 0.1, 0.19)
    for x in (0.0, 0.7):
        k.cyl('bark', 0.04, 0.035, jy + 0.22, x, 0, 0.23, seg=7)
        k.torus('rope', 0.045, 0.01, x, jy + 0.12, 0.23, seg=10)
    k.box('darkwood', 0.05, 0.6, 0.05, 0.78, jy, -0.17)
    lantern(k, 0.78, jy + 0.58, -0.17)
    k.pop()
    # the boat alongside, painter made fast
    rowboat(k, 1.1, 0.13, jz + 0.42, ry=0.05)
    k.beam('rope', V(0.7 + 0.95 - 0.95, jy + 0.12, jz + 0.25), V(1.45, 0.16, jz + 0.42), 0.008, round_=True, seg=3)
    # contraband on the jetty and the beach
    cask(k, 0.45, jz - 0.05, 0.7, y=jy)
    cask(k, 0.68, jz + 0.02, 0.65, y=jy, lying=True, ry=0.2)
    crate(k, 1.35, jy, jz - 0.05, 0.24, 0.2)
    crate(k, 1.36, jy + 0.24, jz - 0.06, 0.2, 0.5)
    drape(k, 'canvas', 0.25, -0.35 + 0.0, [(0.0, 0.0, 0.16, 0.14, 0.42), (0.26, 0.04, 0.12, 0.12, 0.28)], 0.13, ry=0.2, seed=4.0)
    cask(k, -1.4, 0.45, 0.8)
    cask(k, -1.18, 0.62, 0.75)
    sack(k, -0.95, 0.65, 0.9)
    # nets drying on a frame
    nx = -0.05
    for zz in (0.75, 1.25):
        k.cyl('bark', 0.025, 0.022, 0.7, nx - 0.55, 0, zz, seg=6)
    k.beam('bark', V(nx - 0.55, 0.68, 0.72), V(nx - 0.55, 0.68, 1.28), 0.03, round_=True)
    nv, nf = [], []
    rows, cols = (2, 3) if k.lod else (6, 10)
    for j in range(rows + 1):
        for i in range(cols + 1):
            t, u = j / rows, i / cols
            nv.append(V(nx - 0.55 + 0.02 * math.sin(u * 9), 0.66 - 0.55 * t - 0.06 * math.sin(math.pi * u), 0.75 + 0.5 * u))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            nf += [(a, a + 1, a + cols + 2, a + cols + 1), (a, a + cols + 1, a + cols + 2, a + 1)]
    k.mesh('rope', nv, nf, uvscale=3.0)
    if not k.lod:
        for i in range(5):
            k.cyl('wood', 0.02, 0.02, 0.03, nx - 0.55, 0.12, 0.8 + i * 0.1, seg=6, rz=math.pi / 2)
    palm(k, 1.55, -0.95, 1.5, lean=(-0.15, 0.25), seed=2.0)
    return {'ao': 1024}
