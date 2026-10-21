"""Entertainment: where pirates spend their plunder (dive, wench hut, eatery, gambling den, brothel, tavern, inn,
casino, courtesan, hotel). Game coordinates: y up, +z front (road side), 1 unit = 1 tile ~ 2 m."""
import math
from mathutils import Vector, Matrix, noise
from defs import building
from arch import *


# ------------------------------------------------------------------------------------------- shared helpers

def quads2(k, mat, verts, faces, uvscale=0.9):
    """a double-sided sheet (canvas, drapes, hammocks)"""
    n = len(verts)
    # the back sheet sits a hair behind the front one so the two never shade each other in the bake
    vn = [Vector() for _ in verts]
    for f in faces:
        p = [Vector(verts[i]) for i in f]
        fn = (p[1] - p[0]).cross(p[-1] - p[0])
        for i in f:
            vn[i] += fn
    back = [Vector(v) - (m.normalized() * 0.006 if m.length > 1e-9 else Vector()) for v, m in zip(verts, vn)]
    k.mesh(mat, list(verts) + back, list(faces) + [tuple(i + n for i in f[::-1]) for f in faces], uvscale=uvscale)


def lathe(k, mat, prof, x=0.0, y=0.0, z=0.0, seg=10, sx=1.0, sz=1.0, local=None, uvscale=1.0, cap=True):
    """a surface of revolution about local y from (radius, height) pairs, capped where the radius is > 0"""
    if k.lod:
        seg = max(6, seg // 2)
    verts, faces = [], []
    for (r, yy) in prof:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(V(math.cos(a) * r * sx, yy, math.sin(a) * r * sz))
    for j in range(len(prof) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    if cap and prof[0][0] > 1e-4:
        faces.append(tuple(range(seg)))
    if cap and prof[-1][0] > 1e-4:
        n = len(prof) - 1
        faces.append(tuple(range(n * seg, n * seg + seg))[::-1])
    M = Matrix.Translation((x, y, z)) @ (local or Matrix.Identity(4))
    k.mesh(mat, verts, faces, uvscale=uvscale, local=M)


def barrel(k, x, z, s=1.0, y=0.0, ry=0.0, lying=False):
    if k.lod:
        if lying:
            k.push(x, y + 0.14 * s, z, ry)
            k.cyl('planksDark', 0.14 * s, 0.14 * s, 0.36 * s, 0.18 * s, 0, 0, seg=8, rz=math.pi / 2)
            k.pop()
        else:
            k.cyl('planksDark', 0.14 * s, 0.14 * s, 0.36 * s, x, y, z, seg=8)
        return
    cask(k, x, z, s, y, ry, lying)
    if lying:
        # the cask is open at its foot: give it a head there too
        k.push(x, y + 0.15 * s, z, ry)
        k.cyl('planksDark', 0.113 * s, 0.113 * s, 0.012, 0.18 * s - 0.006, 0, 0, seg=14, rz=math.pi / 2)
        k.pop()


def stool(k, x, z, h=0.22, r=0.065, y=0.0):
    k.cyl('wood', r, r, 0.03, x, y + h - 0.03, z, seg=10)
    if k.lod:
        k.cyl('wood', 0.02, 0.02, h - 0.03, x, y, z, seg=5)
        return
    for i in range(3):
        a = i / 3 * math.tau + x * 3
        k.beam('wood', V(x + math.cos(a) * r * 1.2, y, z + math.sin(a) * r * 1.2), V(x + math.cos(a) * r * 0.5, y + h - 0.03, z + math.sin(a) * r * 0.5), 0.018, round_=True, seg=5)


def tankard(k, x, y, z, mat='planksDark'):
    if k.lod:
        return
    k.cyl(mat, 0.02, 0.022, 0.05, x, y, z, seg=8)
    k.box('iron', 0.008, 0.03, 0.012, x + 0.026, y + 0.01, z)


def bottle(k, x, y, z, mat='black'):
    if k.lod:
        return
    lathe(k, mat, [(0.018, 0), (0.02, 0.005), (0.02, 0.045), (0.008, 0.06), (0.006, 0.085), (0.007, 0.09)], x, y, z, seg=7)


def barrel_table(k, x, z, top='darkwood', mugs=2, stools=3):
    """an upended cask with a round plank top, mugs, and stools about it"""
    barrel(k, x, z, 0.95)
    k.cyl(top, 0.2, 0.2, 0.03, x, 0.345, z, seg=14)
    for i in range(mugs):
        a = i * 2.3 + x
        tankard(k, x + math.cos(a) * 0.1, 0.375, z + math.sin(a) * 0.1)
    for i in range(stools):
        a = i / stools * math.tau + 0.5 + z
        stool(k, x + math.cos(a) * 0.32, z + math.sin(a) * 0.32)


def bench(k, x, z, L, ry=0.0, h=0.22, mat='planks', y=0.0):
    k.push(x, y, z, ry)
    k.box(mat, L, 0.035, 0.12, 0, h - 0.035, 0, uvscale=1.3)
    for s in (-1, 1):
        k.box('wood', 0.04, h - 0.035, 0.1, s * (L / 2 - 0.08), 0, 0)
    if not k.lod and L > 0.6:
        k.box('wood', L - 0.2, 0.03, 0.025, 0, 0.06, 0)
    k.pop()


def trestle(k, x, z, L, wd=0.32, ry=0.0, h=0.4, top='planks'):
    """a trestle table: a top of three boards on X-legs with a stretcher"""
    k.push(x, 0, z, ry)
    n = 1 if k.lod else 3
    for i in range(n):
        k.box(top, L + (k.r() - 0.5) * 0.02, 0.035, wd / n - (0.006 if n > 1 else 0), 0, h - 0.035, -wd / 2 + (i + 0.5) * wd / n, uvscale=1.3)
    for s in (-1, 1):
        xx = s * (L / 2 - 0.12)
        k.beam('wood', V(xx, 0, -wd / 2 + 0.03), V(xx, h - 0.035, wd / 2 - 0.05), 0.035)
        k.beam('wood', V(xx, 0, wd / 2 - 0.03), V(xx, h - 0.035, -wd / 2 + 0.05), 0.035)
    k.box('wood', L - 0.2, 0.03, 0.03, 0, h * 0.45, 0)
    k.pop()


def awning(k, mat, x0, x1, yb, zb, yf, zf, sag=0.05, valance=0.07, nx=None, nz=6, poles=True, pole_mat='wood', scallop=True):
    """a canvas awning from a back edge (yb, zb) out to a front edge (yf, zf), sagging between its spars,
    with a scalloped valance and front poles guyed to pegs"""
    nx = nx or max(4, round((x1 - x0) / 0.12))
    if k.lod:
        nx, nz = max(2, nx // 3), 2
    verts, faces = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            y = yb + (yf - yb) * t - sag * math.sin(math.pi * t) * (0.6 + 0.4 * math.sin(math.pi * u))
            verts.append(V(x, y, zb + (zf - zb) * t))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
    quads2(k, mat, verts, faces, uvscale=1.0)
    if valance > 0:
        vv, vf = [], []
        m = nx * 2
        for i in range(m + 1):
            x = x0 + (x1 - x0) * i / m
            drop = valance * (0.55 + 0.45 * abs(math.sin(math.pi * i / 2 + math.pi / 2))) if scallop else valance
            vv += [V(x, yf + 0.005, zf + 0.004), V(x, yf - drop, zf + 0.012)]
        for i in range(m):
            a = 2 * i
            vf.append((a, a + 1, a + 3, a + 2))
        quads2(k, mat, vv, vf, uvscale=1.0)
    # spars along both edges
    k.beam(pole_mat, V(x0 - 0.04, yf - 0.012, zf), V(x1 + 0.04, yf - 0.012, zf), 0.028, round_=True)
    if poles:
        for x in (x0 + 0.03, x1 - 0.03):
            k.cyl(pole_mat, 0.025, 0.022, yf, x, 0, zf, seg=7)
            if not k.lod:
                k.beam('rope', V(x, yf - 0.02, zf), V(x + (0.25 if x > (x0 + x1) / 2 else -0.25), 0, zf + 0.22), 0.007, round_=True, seg=4)
                k.cyl('wood', 0.012, 0.008, 0.06, x + (0.25 if x > (x0 + x1) / 2 else -0.25), 0, zf + 0.22, seg=5)


def drape(k, mat, x, ytop, z, w, h, ry=0.0, folds=5, depth=0.025, gather=0.0, side=1):
    """a hanging curtain with vertical folds; gather > 0 ties it back toward one side at 60% height"""
    nx = 2 * folds if not k.lod else 2
    ny = 6 if not k.lod else 1
    k.push(x, ytop, z, ry)
    verts, faces = [], []
    for j in range(ny + 1):
        t = j / ny
        # tie-back: the cloth narrows toward the tie and flares below it
        if gather > 0:
            lo = 1 - gather
            tie = 1 - (1 - lo) * (t / 0.62) if t <= 0.62 else lo + (1 - lo) * 0.45 * (t - 0.62) / 0.38
        else:
            tie = 1.0
        for i in range(nx + 1):
            u = i / nx
            xx = (u - (0.5 if side == 0 else (0 if side > 0 else 1))) * w
            xx = xx * tie
            zz = depth * math.sin(u * folds * math.pi * 2) * (0.6 + 0.4 * t) * (0.5 + 0.5 * tie)
            verts.append(V(xx * (1 if side >= 0 else 1), -h * t, zz))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
    quads2(k, mat, verts, faces, uvscale=1.5)
    k.pop()


def hammock(k, a, b, w=0.17, sag=0.16, mat='canvas'):
    """a sailcloth hammock slung between two points, with spreader bars and rope ends"""
    a, b = Vector(a), Vector(b)
    d = b - a
    side = Vector((0, 1, 0)).cross(d).normalized() * (w / 2)
    n = 10 if not k.lod else 3
    verts, faces = [], []
    t0, t1 = 0.12, 0.88
    for i in range(n + 1):
        t = t0 + (t1 - t0) * i / n
        p = a + d * t - Vector((0, sag * math.sin(math.pi * t), 0))
        cw = 0.35 + 0.65 * math.sin(math.pi * (i / n)) ** 0.5
        verts += [p + side * cw, p - side * cw + Vector((0, -0.015, 0))]
    for i in range(n):
        q = 2 * i
        faces.append((q, q + 2, q + 3, q + 1))
    quads2(k, mat, verts, faces, uvscale=1.6)
    if not k.lod:
        for t in (t0, t1):
            p = a + d * t - Vector((0, sag * math.sin(math.pi * t), 0))
            k.beam('wood', p + side * 0.4, p - side * 0.4, 0.015, round_=True, seg=5)
            end = a if t == t0 else b
            for sd in (0.35, -0.35):
                k.beam('rope', p + side * sd, end, 0.006, round_=True, seg=4)


def string_lights(k, a, b, n=5, sag=0.12, lamp=True):
    """a rope with small lanterns hung along it"""
    a, b = Vector(a), Vector(b)
    pts = []
    m = 8 if not k.lod else 3
    for i in range(m + 1):
        t = i / m
        pts.append(a + (b - a) * t - Vector((0, sag * math.sin(math.pi * t), 0)))
    for p, q in zip(pts, pts[1:]):
        k.beam('rope', p, q, 0.008, round_=True, seg=4)
    if not lamp:
        return
    for i in range(n):
        t = (i + 0.5) / n
        p = a + (b - a) * t - Vector((0, sag * math.sin(math.pi * t), 0))
        small_lantern(k, p.x, p.y, p.z)


def small_lantern(k, x, y, z, s=1.0):
    """a tin lantern hanging from a point (y is the hook)"""
    if k.lod:
        k.box('window', 0.05 * s, 0.07 * s, 0.05 * s, x, y - 0.11 * s, z)
        return
    k.box('iron', 0.004, 0.035 * s, 0.004, x, y - 0.035 * s, z)
    k.cyl('iron', 0.008, 0.035 * s, 0.03 * s, x, y - 0.065 * s, z, seg=6)
    k.box('window', 0.05 * s, 0.07 * s, 0.05 * s, x, y - 0.135 * s, z)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('iron', 0.006, 0.075 * s, 0.006, x + sx * 0.026 * s, y - 0.137 * s, z + sz * 0.026 * s)
    k.box('iron', 0.06 * s, 0.01, 0.06 * s, x, y - 0.145 * s, z)


def lantern_post(k, x, z, h=0.95, ry=0.0, mat='darkwood'):
    """a post with a wrought arm and a ship's lantern"""
    k.box(mat, 0.06, h, 0.06, x, 0, z)
    k.cyl(mat, 0.04, 0.0, 0.05, x, h, z, seg=4)
    k.push(x, 0, z, ry)
    lantern(k, 0, h - 0.06, 0.02)
    k.pop()


def parrot_perch(k, x, z, h=0.75, ry=0.0):
    """a T-perch with a scarlet macaw and a seed cup"""
    k.push(x, 0, z, ry)
    k.cyl('stone', 0.11, 0.12, 0.04, 0, 0, 0, seg=10)
    k.cyl('darkwood', 0.018, 0.016, h, 0, 0.04, 0, seg=7)
    k.beam('darkwood', V(-0.16, h + 0.04, 0), V(0.16, h + 0.04, 0), 0.022, round_=True)
    k.cyl('brass', 0.03, 0.022, 0.03, 0.15, h + 0.05, 0, seg=8)
    # the bird: body, head, beak, folded blue-and-yellow wings and a long tail
    k.push(-0.04, h + 0.055, 0, 0.0, 0.0, 0.25)
    lathe(k, 'red', [(0.0, 0.0), (0.022, 0.015), (0.03, 0.05), (0.027, 0.085), (0.02, 0.105), (0.0, 0.11)], 0, 0, 0, seg=8)
    lathe(k, 'red', [(0.0, 0.0), (0.02, 0.012), (0.022, 0.03), (0.012, 0.045), (0.0, 0.05)], 0.004, 0.1, 0, seg=8)
    k.cbox('bone', 0.022, 0.026, 0.016, 0.026, 0.12, 0, rz=-0.5)
    if not k.lod:
        for s in (-1, 1):
            k.cbox('plasterBlue', 0.02, 0.08, 0.012, -0.008, 0.055, s * 0.026, rz=0.15)
            k.cbox('plasterYellow', 0.014, 0.03, 0.01, -0.004, 0.08, s * 0.031, rz=0.15)
        k.cbox('red', 0.014, 0.17, 0.02, -0.02, -0.07, 0, rz=0.12)
        k.cbox('plasterBlue', 0.01, 0.12, 0.022, -0.026, -0.06, 0, rz=0.12)
    k.pop()
    k.pop()


def balustrade(k, x0, x1, z, y, h=0.3, mat='darkwood', step=0.085, post_mat=None, r=0.012):
    """a rail on turned balusters along x"""
    L = x1 - x0
    if k.lod:
        k.box(mat, L, h - 0.03, 0.03, (x0 + x1) / 2, y, z)
        return
    k.box(mat, L, 0.035, 0.05, (x0 + x1) / 2, y + h - 0.035, z)
    k.box(mat, L, 0.025, 0.04, (x0 + x1) / 2, y + 0.02, z)
    n = max(2, round(L / (step * (3 if k.lod else 1))))
    for i in range(n + 1):
        x = x0 + i * L / n
        if k.lod:
            k.box(post_mat or mat, 0.02, h - 0.05, 0.02, x, y + 0.03, z)
        else:
            lathe(k, post_mat or mat, [(r, 0.0), (r * 1.4, 0.04), (r * 0.8, 0.09), (r * 1.6, h * 0.45), (r * 0.8, h - 0.1), (r, h - 0.05)], x, y + 0.03, z, seg=6, cap=False)


def balustrade_z(k, z0, z1, x, y, h=0.3, mat='darkwood', step=0.085, post_mat=None, r=0.012):
    k.push(x, 0, (z0 + z1) / 2, math.pi / 2)
    balustrade(k, -(z1 - z0) / 2, (z1 - z0) / 2, 0, y, h, mat, step, post_mat, r)
    k.pop()


def win_curtains(k, w, d, ops, y0=0.0, depth=0.063, mat='red', face_w=None):
    """drapes gathered to the sides inside each window reveal (run after the walls, same frame)"""
    if k.lod:
        return
    for o in ops:
        if o.kind != 'window':
            continue
        k.face(o.face, w, d).push(0, y0, 0)
        for s in (-1, 1):
            k.box(mat, 0.05, o.h - 0.05, 0.008, o.x + s * (o.w / 2 - 0.06), o.y + 0.02, -depth + 0.004)
        k.box(mat, o.w - 0.07, 0.05, 0.008, o.x, o.y + o.h - 0.085, -depth + 0.004)
        k.pop().pop()


def potted_palm(k, x, z, s=1.0, pot='terracotta'):
    """a clay pot with a little fan palm"""
    lathe(k, pot, [(0.07 * s, 0), (0.1 * s, 0.03 * s), (0.11 * s, 0.14 * s), (0.125 * s, 0.16 * s), (0.12 * s, 0.18 * s), (0.0, 0.17 * s)], x, 0, z, seg=10)
    k.cyl('soil', 0.105 * s, 0.105 * s, 0.01, x, 0.165 * s, z, seg=10)
    n = 5 if k.lod else 8
    for i in range(n):
        a = i / n * math.tau + x
        frond(k, V(x, 0.17 * s, z), a, (0.3 + 0.06 * (i % 3)) * s, lift=1.1, droop=1.6, wd=0.1 * s)


def frond(k, base, a, L, lift=0.35, droop=0.9, wd=0.22, mat='leaf'):
    """a palm frond: an arching rib with narrow leaflets combed down either side"""
    dirh = Vector((math.cos(a), 0, math.sin(a)))
    side = Vector((-math.sin(a), 0, math.cos(a)))
    n = 4 if k.lod else 9
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append(base + dirh * (L * t) + Vector((0, L * (lift * t - droop * t * t * 0.5), 0)))
    verts, faces = [], []
    for i in range(n):
        t = (i + 0.5) / n
        p0, p1 = pts[i], pts[i + 1]
        lw = wd * math.sin(math.pi * (0.15 + 0.85 * t)) * (1.0 - 0.3 * t)
        for sd in (-1, 1):
            tip = (p0 + p1) / 2 + side * (sd * lw) + dirh * (L / n * 0.8) + Vector((0, -lw * 0.55, 0))
            b = len(verts)
            verts += [p0, p1, tip]
            faces.append((b, b + 1, b + 2))
    quads2(k, mat, verts, faces, uvscale=2.0)
    if not k.lod and L > 0.4:
        for p, q in zip(pts[::3], pts[3::3]):
            k.beam('wood', p, q, 0.014, round_=True, seg=4)


def palm_tree(k, x, z, h=1.5, lean=0.12, la=0.0, n=8, L=0.7):
    """a coconut palm: a gently curved ringed trunk, a crown of drooping fronds and a cluster of nuts"""
    segs = 4 if k.lod else 9
    pts = []
    for i in range(segs + 1):
        t = i / segs
        off = lean * h * t * t
        pts.append(V(x + math.cos(la) * off, h * t, z + math.sin(la) * off))
    for i, (p, q) in enumerate(zip(pts, pts[1:])):
        r = 0.065 - 0.02 * i / segs
        k.beam('bark', p, q + (q - p) * 0.05, r * 2, round_=True, seg=8)
        if not k.lod and i > 0:
            k.torus('bark', r + 0.004, 0.012, p.x, p.y, p.z, seg=10, rseg=3)
    top = pts[-1]
    for i in range(n):
        a = i / n * math.tau + x * 1.7
        frond(k, top + V(0, 0.02, 0), a, L * (0.85 + 0.3 * ((i * 5) % 3) / 2), lift=0.3 + 0.2 * (i % 2), droop=1.0)
    for i in range(4):
        a = i / 4 * math.tau + 0.3
        k.cyl('bark', 0.035, 0.035, 0.07, top.x + math.cos(a) * 0.05, top.y - 0.08, top.z + math.sin(a) * 0.05, seg=6)


def plinth_lo(k, w, d, h=0.14, mat='stone'):
    """a rubble footing like arch.plinth but laid in bigger stones (for long walls, to keep the count sane)"""
    if k.lod:
        k.box(mat, w + 0.03, h, d + 0.03, 0, 0, 0, uvscale=1.0)
        return
    k.box('stoneDark', w - 0.03, h - 0.01, d - 0.03, 0, 0, 0, uvscale=2.0)
    for f in FACES:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d)
        rows = max(1, round(h / 0.08))
        rh = h / rows
        for r in range(rows):
            x = -L / 2 + (0.09 if r % 2 else 0)
            while x < L / 2 - 0.03:
                sw = min(L / 2 - x, 0.17 + k.r() * 0.17)
                k.cbox(mat, sw - 0.014, rh - 0.014, 0.05 + k.r() * 0.025, x + sw / 2, r * rh + rh / 2, -0.012,
                       ry=(k.r() - 0.5) * 0.06, rx=(k.r() - 0.5) * 0.1, rz=(k.r() - 0.5) * 0.06, uvscale=2.0)
                x += sw
        k.pop()
    k.box(mat, w + 0.02, 0.025, d + 0.02, 0, h - 0.02, 0, uvscale=2.0)


def _lod_walls(k, w, d, h, mat, ops, timber=False):
    """the far-LOD stand-in for a walled block: one box with its openings painted on as quads"""
    k.box(mat, w, h, d, 0, 0, 0, uvscale=0.5, wuv=True)
    for o in ops:
        k.face(o.face, w, d)
        m = {'window': 'window', 'door': 'planksDark', 'double': 'planksDark', 'open': 'black', 'hatch': 'black', 'arch': 'black'}.get(o.kind, 'black')
        x0, x1, y0, y1 = o.x - o.w / 2, o.x + o.w / 2, o.y, o.y + o.h
        k.mesh(m, [V(x0, y0, 0.004), V(x1, y0, 0.004), V(x1, y1, 0.004), V(x0, y1, 0.004)], [(0, 1, 2, 3)])
        if o.kind == 'window' and o.shutters:
            for sx in (-1, 1):
                a = o.x + sx * (o.w / 2 + 0.01)
                b = o.x + sx * (o.w + 0.01)
                k.mesh('planks', [V(min(a, b), y0, 0.006), V(max(a, b), y0, 0.006), V(max(a, b), y1, 0.006), V(min(a, b), y1, 0.006)], [(0, 1, 2, 3)])
        k.pop()
    if timber:
        k.box('darkwood', w + 0.02, 0.07, d + 0.02, 0, 0, 0)
        k.box('darkwood', w + 0.02, 0.07, d + 0.02, 0, h - 0.07, 0)


def W_plastered(k, w, d, h, mat, ops, **kw):
    if k.lod:
        return _lod_walls(k, w, d, h, mat, ops)
    plastered(k, w, d, h, mat, ops, **kw)


def W_framed(k, w, d, h, mat, ops, **kw):
    if k.lod:
        return _lod_walls(k, w, d, h, mat, ops, timber=True)
    framed(k, w, d, h, mat, ops, **kw)


def W_clapboard(k, w, d, h, mat, ops, **kw):
    if k.lod:
        return _lod_walls(k, w, d, h, 'oldplanks' if mat != 'planks' else 'planks', ops)
    clapboard(k, w, d, h, mat, ops, **kw)


def W_board_batten(k, w, d, h, mat, ops, **kw):
    if k.lod:
        return _lod_walls(k, w, d, h, mat, ops)
    board_batten(k, w, d, h, mat, ops, **kw)


def sand_drift(k, x, z, rx, rz, h, ry=0.0):
    """a low drift of sand banked against something"""
    seg = 10 if not k.lod else 6
    prof = [(1.0, 0.0), (0.85, 0.35), (0.55, 0.75), (0.0, 1.0)]
    verts, faces = [], []
    for (r, t) in prof:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(V(math.cos(a) * rx * r, t * h - 0.01, math.sin(a) * rz * r))
    for j in range(len(prof) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    k.mesh('sand', verts, faces, uvscale=1.0, local=Matrix.Translation((x, 0, z)) @ Matrix.Rotation(ry, 4, 'Y'))


def cannon_bollard(k, x, z, ry=0.0):
    """an old gun barrel planted muzzle-down as a bollard"""
    lathe(k, 'iron', [(0.045, 0.0), (0.045, 0.15), (0.052, 0.16), (0.052, 0.18), (0.044, 0.19), (0.038, 0.23), (0.022, 0.255), (0.0, 0.26)], x, 0, z, seg=10)


def gun(k, x, z, ry=0.0, carriage=True):
    """a ship's gun on a truck carriage"""
    k.push(x, 0, z, ry)
    if carriage:
        for s in (-1, 1):
            k.box('planksDark', 0.03, 0.12, 0.34, s * 0.07, 0.04, 0)
        k.box('planksDark', 0.17, 0.03, 0.3, 0, 0.06, 0)
        for sz in (-0.12, 0.12):
            k.cyl('darkwood', 0.045, 0.045, 0.2, 0.1, 0.045, sz, seg=8, rz=math.pi / 2)
    rot = Matrix.Rotation(math.pi / 2 - 0.05, 4, 'X')
    lathe(k, 'iron', [(0.0, -0.18), (0.035, -0.17), (0.05, -0.15), (0.05, -0.1), (0.044, 0.05), (0.038, 0.2), (0.042, 0.21), (0.042, 0.23), (0.028, 0.23)], 0, 0.15, 0, seg=10, local=rot, cap=True)
    k.pop()


def flagpole(k, x, z, h, base=0.0):
    k.cyl('wood', 0.03, 0.018, h, x, base, z, seg=7)
    k.cyl('brass', 0.025, 0.025, 0.04, x, base + h, z, seg=7)
    k.marker('flag', x, base + h - 0.02, z)


def coins(k, x, y, z, n=3):
    if k.lod:
        return
    for i in range(n):
        k.cyl('gold', 0.014, 0.014, 0.006 * (2 + i % 3), x + i * 0.03, y, z + (i % 2) * 0.02, seg=8)


def cards(k, x, y, z, n=4):
    if k.lod:
        return
    for i in range(n):
        k.box('bone', 0.03, 0.002, 0.042, x + (i - n / 2) * 0.035, y + i * 0.001, z, ry=(i - n / 2) * 0.25)


def dice(k, x, y, z):
    if k.lod:
        return
    k.box('bone', 0.018, 0.018, 0.018, x, y, z, ry=0.4)
    k.box('bone', 0.018, 0.018, 0.018, x + 0.03, y, z + 0.01, ry=1.1)


def card_table(k, x, z, r=0.24, chairs=4, cloth='red'):
    """a round gaming table: pedestal, a baize-covered top, cards, dice, coin stacks and stools"""
    k.cyl('darkwood', 0.12, 0.05, 0.04, x, 0, z, seg=10)
    k.cyl('darkwood', 0.03, 0.03, 0.36, x, 0.03, z, seg=8)
    k.cyl('darkwood', r, r, 0.03, x, 0.38, z, seg=16)
    k.cyl(cloth, r - 0.03, r - 0.03, 0.006, x, 0.41, z, seg=16)
    cards(k, x - 0.05, 0.416, z + 0.05)
    dice(k, x + 0.06, 0.416, z - 0.04)
    coins(k, x - 0.1, 0.416, z - 0.08)
    coins(k, x + 0.05, 0.416, z + 0.11, 2)
    tankard(k, x + 0.13, 0.416, z + 0.02)
    for i in range(chairs):
        a = i / chairs * math.tau + 0.4
        stool(k, x + math.cos(a) * (r + 0.13), z + math.sin(a) * (r + 0.13), 0.24, 0.07)


def guy(k, a, b):
    if not k.lod:
        k.beam('rope', V(*a), V(*b), 0.007, round_=True, seg=4)


def convex(k, mat, verts, faces, uvscale=1.0):
    """a convex solid: every face is turned to point away from the centroid"""
    c = sum(verts, Vector()) / len(verts)
    out = []
    for f in faces:
        p = [verts[i] for i in f]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        if n.length < 1e-9 and len(p) > 3:
            n = (p[2] - p[0]).cross(p[3] - p[0])
        fc = sum(p, Vector()) / len(p)
        out.append(tuple(f) if n.dot(fc - c) >= 0 else tuple(f)[::-1])
    k.mesh(mat, verts, out, uvscale=uvscale)


def prism(k, mat, poly, y0, y1, uvscale=1.0):
    """a vertical prism over a convex (x, z) polygon"""
    n = len(poly)
    verts = [V(x, y0, z) for (x, z) in poly] + [V(x, y1, z) for (x, z) in poly]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    convex(k, mat, verts, faces, uvscale)


def bay_window(k, x, y0, w, h, proj, roof='planksDark', base='stone', frame='darkwood', curtains=None):
    """a canted bay window in a face frame (z out of the wall): stone apron, glazed lights between
    mullions, a moulded head and a little shingled hood"""
    k.push(x, 0, 0)
    poly = [(-w / 2, -0.02), (-w / 2 + proj, proj), (w / 2 - proj, proj), (w / 2, -0.02)]
    prism(k, base, poly, 0.0, y0, uvscale=2.0)
    big = [(-w / 2 - 0.03, -0.02), (-w / 2 + proj - 0.01, proj + 0.03), (w / 2 - proj + 0.01, proj + 0.03), (w / 2 + 0.03, -0.02)]
    prism(k, frame, big, y0 - 0.03, y0 + 0.01)
    inner = [(-w / 2 + 0.02, -0.02), (-w / 2 + proj, proj - 0.02), (w / 2 - proj, proj - 0.02), (w / 2 - 0.02, -0.02)]
    prism(k, 'window', inner, y0, y0 + h)
    if curtains:
        for sx in (-1, 1):
            k.box(curtains, 0.05, h - 0.04, 0.01, sx * (w / 2 - proj - 0.03), y0 + 0.02, proj - 0.035)
    pts = [V(px, 0, pz) for (px, pz) in poly]
    for p in pts:
        k.box(frame, 0.035, h, 0.035, p.x * 0.985, y0, min(p.z, proj - 0.005))
    for (a, b) in zip(pts, pts[1:]):
        for t in (1 / 3, 2 / 3) if (b - a).length > 0.25 else (0.5,):
            q = a + (b - a) * t
            k.box(frame, 0.022, h, 0.03, q.x, y0, q.z - 0.005)
        k.beam(frame, V(a.x, y0 + h * 0.62, a.z), V(b.x, y0 + h * 0.62, b.z), 0.02, 0.025)
    prism(k, frame, big, y0 + h, y0 + h + 0.06)
    # hood: a hipped lean-to from the head back up to the wall
    hy = y0 + h + 0.06
    hv = [V(-w / 2 - 0.04, hy, -0.02), V(-w / 2 + proj - 0.01, hy, proj + 0.05), V(w / 2 - proj + 0.01, hy, proj + 0.05), V(w / 2 + 0.04, hy, -0.02),
          V(-w / 2 + 0.06, hy + 0.16, -0.02), V(w / 2 - 0.06, hy + 0.16, -0.02)]
    convex(k, roof, hv, [(0, 1, 2, 3), (0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)], uvscale=1.4)
    k.pop()


def window_box(k, x, y, w=0.34, flowers=('red', 'plasterYellow')):
    """a planter on brackets under a window (face frame), with leaves and blooms"""
    k.box('planksDark', w, 0.07, 0.09, x, y - 0.07, 0.06, uvscale=1.3)
    for sx in (-1, 1):
        k.beam('darkwood', V(x + sx * (w / 2 - 0.04), y - 0.17, 0.0), V(x + sx * (w / 2 - 0.04), y - 0.07, 0.09), 0.02)
    n = 3 if k.lod else 7
    for i in range(n):
        xx = x - w / 2 + 0.03 + i * (w - 0.06) / max(1, n - 1)
        k.cbox('leaf', 0.06, 0.05, 0.06, xx, y + 0.0, 0.06 + (i % 2 - 0.5) * 0.02, ry=i)
        if not k.lod:
            k.cbox(flowers[i % len(flowers)], 0.025, 0.025, 0.025, xx + 0.01, y + 0.03, 0.07, ry=i * 0.7)


def ship_bell(k, x, y, z):
    """a ship's bell on a wall bracket (face frame), with its lanyard"""
    k.box('iron', 0.02, 0.02, 0.14, x, y, z + 0.07)
    k.beam('iron', V(x, y - 0.1, z + 0.01), V(x, y, z + 0.1), 0.012)
    lathe(k, 'brass', [(0.0, 0.0), (0.05, 0.0), (0.052, 0.012), (0.04, 0.04), (0.032, 0.08), (0.025, 0.095), (0.0, 0.1)], x, y - 0.11, z + 0.12, seg=10)
    k.beam('rope', V(x, y - 0.11, z + 0.12), V(x, y - 0.25, z + 0.12), 0.008, round_=True, seg=4)


def doorway(k, x, w, h, depth=0.07, frame='darkwood', drape_mat='red'):
    """an open doorway (Op kind 'open') with jambs, lintel, threshold and a curtain tied back (face frame)"""
    for s in (-1, 1):
        k.box(frame, 0.06, h + 0.05, depth + 0.04, x + s * (w / 2 + 0.02), 0, -depth / 2 + 0.01)
    k.box(frame, w + 0.16, 0.08, depth + 0.06, x, h, -depth / 2 + 0.015)
    k.box('stoneDark', w + 0.18, 0.04, 0.12 + depth, x, 0, 0.0, uvscale=2.0)
    if drape_mat:
        drape(k, drape_mat, x - w / 2 + 0.02, h - 0.01, -depth + 0.02, w * 0.55, h - 0.02, folds=4, gather=0.55, side=1)
        drape(k, drape_mat, x + w / 2 - 0.02, h - 0.01, -depth + 0.02, w * 0.3, h - 0.02, folds=2, gather=0.4, side=-1)
        k.box('brass', w, 0.012, 0.012, x, h - 0.012, -depth + 0.02)


def wash_tub(k, x, z, r=0.2):
    """a half-cask tub of water"""
    lathe(k, 'planksDark', [(r * 0.85, 0.0), (r, 0.18), (r, 0.2), (r * 0.9, 0.2), (r * 0.82, 0.03), (0.0, 0.03)], x, 0, z, seg=16, cap=False)
    k.cyl('water', r * 0.92, r * 0.92, 0.005, x, 0.15, z, seg=16)
    for t in (0.04, 0.15):
        k.torus('iron', r * (0.87 + t * 0.7) + 0.005, 0.006, x, t, z, seg=16, rseg=3)


# ------------------------------------------------------------------------------------------- the dive

def _hull(k, x_cut, x_tr, zc, b0, yk, top0, top1, hatch=None, levels=None):
    """the after part of a wrecked ship, hauled up the beach and sunk keel-down in the sand: carvel strakes
    as horizontal bands (with caulked seams), a raked transom, deck, bulwarks and cap rail.
    hatch = (x0, x1, y0, y1) is cut out of the starboard (+z) side. Returns side_z(x, y, s)."""
    L = x_cut - x_tr
    hx = [hatch[0], hatch[1]] if hatch else []
    xs = sorted(set([round(x_cut - L * i / (6 if k.lod else 14), 4) for i in range((6 if k.lod else 14) + 1)] + hx), reverse=True)
    lv = levels or [yk, -0.03, 0.05, 0.13, 0.21, 0.29, 0.37, 0.44, 0.52, 0.6, 0.67, 0.72, 0.76]
    if k.lod:
        lv = [yk, 0.05, 0.25] + ([hatch[2], hatch[3]] if hatch else [0.45, 0.7])

    def prm(x):
        u = (x_cut - x) / L
        b = b0 * (1 - 0.42 * u ** 2.2)
        yt = top0 + (top1 - top0) * max(0.0, (u - 0.45) / 0.55) ** 1.8
        p = 0.5 + 2.6 * u ** 2.5
        return u, b, yt, p

    def side_z(x, y, s):
        u, b, yt, p = prm(x)
        f = min(1.0, max(0.0, (yt - y) / (yt - yk)))
        w = math.sqrt(max(0.0, 1 - f ** (2 / p)))
        tuck = 1 - 0.1 * max(0.0, (0.25 - f) / 0.25)
        return zc + s * b * w * tuck

    rings = []
    for x in xs:
        u, b, yt, p = prm(x)
        ring = []
        # strakes run with the sheer
        sh = lambda y: y + (yt - top0) * min(1.0, max(0.0, y / top0)) ** 1.5
        for y in [yt] + lv[:0:-1]:
            ring.append(V(x, sh(y) if y < yt else y, side_z(x, sh(y) if y < yt else y, -1)))
        ring.append(V(x, yk, zc))
        for y in lv[1:] + [yt]:
            ring.append(V(x, sh(y) if y < yt else y, side_z(x, sh(y) if y < yt else y, 1)))
        # caulked seams: pull the strake edges in a touch
        if not k.lod:
            for j in range(1, len(ring) - 1):
                if j % 2 == 0:
                    ring[j] = ring[j] + V(0, 0, -0.006 if ring[j].z > zc else 0.006)
        rings.append(ring)
    n = len(rings[0])
    nl = len(lv)
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        for j in range(n - 1):
            ym = (rings[i][j].y + rings[i][j + 1].y) / 2
            if hatch and j >= nl and hatch[0] < xm < hatch[1] and hatch[2] < ym < hatch[3]:
                continue
            a, b, c, d = i * n + j, (i + 1) * n + j, (i + 1) * n + j + 1, i * n + j + 1
            faces.append((a, d, c, b))
    k.mesh('planksDark', verts, faces, uvscale=1.3)
    # transom: the last ring closed, raked, carried up as the taffrail
    last = rings[-1]
    u, b, yt, p = prm(xs[-1])
    tv = [v + V(-0.1 * max(0, (v.y - yk)) / (yt - yk), 0, 0) for v in last]
    hb = 0.2
    tv_top = [V(tv[-1].x - 0.02, yt + hb, tv[-1].z - 0.02), V(tv[0].x - 0.02, yt + hb, tv[0].z + 0.02)]
    k.mesh('planks', tv + tv_top, [tuple(range(len(tv) + 2))], uvscale=1.3)
    # link the last ring to the raked transom
    lf = []
    base = 0
    tverts = last + tv
    for j in range(n - 1):
        lf.append((j, j + 1, n + j + 1, n + j))
    k.mesh('planksDark', tverts, lf, uvscale=1.3)
    # deck
    dv, df = [], []
    for i, x in enumerate(xs):
        u, b, yt, p = prm(x)
        dv += [rings[i][0], rings[i][-1]]
    dv[-2] = tv[0]
    dv[-1] = tv[-1]
    for i in range(len(xs) - 1):
        a = 2 * i
        df.append((a, a + 2, a + 3, a + 1))
    k.mesh('planks', dv, df, uvscale=1.2)
    # bulwarks (both faces) with a cap rail, rising toward the stern
    for s in (-1, 1):
        ov, of = [], []
        pts = []
        for i, x in enumerate(xs):
            u, b, yt, p = prm(x)
            e = rings[i][-1] if s > 0 else rings[i][0]
            if i == len(xs) - 1:
                e = tv[-1] if s > 0 else tv[0]
            h = 0.11 + 0.09 * u * u
            pts.append((e, h))
        for i, (e, h) in enumerate(pts):
            ov += [e, e + V(0, h, 0), e + V(0, h, -s * 0.025), e + V(0, 0, -s * 0.025)]
        for i in range(len(pts) - 1):
            a, b = 4 * i, 4 * (i + 1)
            if s > 0:
                of += [(a, a + 1, b + 1, b), (a + 3, b + 3, b + 2, a + 2)]
            else:
                of += [(a, b, b + 1, a + 1), (a + 3, a + 2, b + 2, b + 3)]
        k.mesh('planks', ov, of, uvscale=1.3)
        for (e0, h0), (e1, h1) in zip(pts, pts[1:]):
            k.beam('darkwood', e0 + V(0, h0 + 0.012, -s * 0.012), e1 + V(0, h1 + 0.012, -s * 0.012), 0.05, 0.03)
        # bulwark stanchions inside
        if not k.lod:
            for (e, h) in pts[1:-1]:
                k.box('darkwood', 0.03, h, 0.03, e.x, e.y, e.z - s * 0.04)
    # taffrail cap
    k.beam('darkwood', tv_top[0] + V(0, 0.015, 0), tv_top[1] + V(0, 0.015, 0), 0.05, 0.04)
    # wales: two thick bands following the sheer on each side
    for s in (-1, 1):
        for off in (0.07, 0.36):
            wv, wf = [], []
            for i, x in enumerate(xs):
                u, b, yt, p = prm(x)
                if i == len(xs) - 1:
                    x = x - 0.1 * (yt - off - yk) / (yt - yk)
                y0w = top0 - off
                y0w = y0w + (yt - top0) * (y0w / top0) ** 1.5
                for y in (y0w - 0.045, y0w):
                    z = side_z(xs[i], y, s)
                    wv += [V(x, y, z), V(x, y, z + s * 0.025)]
            for i in range(len(xs) - 1):
                a, b = 4 * i, 4 * (i + 1)
                q = [(a + 1, b + 1, b + 3, a + 3), (a + 3, b + 3, b + 2, a + 2), (a, b, b + 1, a + 1)]
                wf += [f[::-1] if s > 0 else f for f in q]
            k.mesh('darkwood', wv, wf, uvscale=1.3)
    return side_z, xs, prm, tv


@building('dive')
def dive(k):
    """Smuggler's Dive: the stern of a wrecked sloop hauled up the beach and sunk keel-down in the sand, a
    serving hatch cut through its side with a plank bar, an old sail rigged as an awning over barrel tables,
    a galley stovepipe smoking through the deck, and casks racked under a patched fly"""
    x_cut, x_tr, zc, b0 = 0.42, -1.18, -0.36, 0.5
    hatch = (-0.52, 0.26, 0.44, 0.71)
    # the wreck sits with a list to port, a little sunk
    k.push(0, -0.14, zc, 0, -0.07).push(0, 0.11, -zc)
    side_z, xs, prm, tv = _hull(k, x_cut, x_tr, zc, b0, -0.14, 0.8, 1.16, hatch=hatch)
    if not k.lod:
        # boards nailed over a stove-in plank on the port side, and a scupper stain
        for i, (xx, yy, rz) in enumerate(((-0.45, 0.3, 0.06), (-0.43, 0.37, -0.04), (-0.47, 0.44, 0.1), (0.05, 0.5, -0.05), (0.08, 0.57, 0.03))):
            k.cbox('oldplanks', 0.34, 0.06, 0.016, xx, yy, side_z(xx, yy, -1) - 0.01, ry=math.pi, rz=rz, uvscale=1.4)

    # interior behind the hatch: a dark room with shelves of bottles
    k.box('planksDark', hatch[1] - hatch[0] + 0.06, 0.34, 0.03, (hatch[0] + hatch[1]) / 2, 0.42, zc - 0.25, uvscale=1.3)
    k.box('planksDark', hatch[1] - hatch[0] + 0.06, 0.02, 0.76, (hatch[0] + hatch[1]) / 2, 0.42, zc + 0.12)
    k.box('black', hatch[1] - hatch[0] + 0.06, 0.02, 0.76, (hatch[0] + hatch[1]) / 2, 0.74, zc + 0.12)
    for xx in (hatch[0] - 0.02, hatch[1] + 0.02):
        k.box('planksDark', 0.02, 0.34, 0.76, xx, 0.42, zc + 0.12)
    for yy in (0.52, 0.63):
        k.box('planks', hatch[1] - hatch[0], 0.015, 0.08, (hatch[0] + hatch[1]) / 2, yy, zc - 0.2)
        for i in range(7):
            bottle(k, hatch[0] + 0.06 + i * 0.11 + k.r() * 0.03, yy + 0.015, zc - 0.2, 'black' if i % 3 else 'brass')
    # hatch frame, the propped lid and the bar counter on brackets
    zf = side_z((hatch[0] + hatch[1]) / 2, 0.58, 1)
    xm, hw = (hatch[0] + hatch[1]) / 2, (hatch[1] - hatch[0]) / 2
    k.push(xm, 0, zf)
    for xx in (-hw - 0.02, hw + 0.02):
        k.box('darkwood', 0.05, hatch[3] - hatch[2] + 0.06, 0.05, xx, hatch[2] - 0.03, 0.0)
    k.box('darkwood', 2 * hw + 0.1, 0.05, 0.05, 0, hatch[3], 0.0)
    k.cbox('planks', 2 * hw + 0.2, 0.045, 0.26, 0, hatch[2] - 0.0, 0.1, uvscale=1.3)
    k.box('darkwood', 2 * hw + 0.2, 0.03, 0.03, 0, hatch[2] - 0.05, 0.215)
    for xx in (-hw + 0.05, 0, hw - 0.05):
        k.beam('darkwood', V(xx, hatch[2] - 0.2, 0.0), V(xx, hatch[2] - 0.03, 0.2), 0.035)
    k.push(0, hatch[3] + 0.02, 0.01, 0, -1.25)
    n = 7 if not k.lod else 1
    for i in range(n):
        k.box('planksDark', 2 * hw / n - (0.006 if n > 1 else 0), 0.025, hatch[3] - hatch[2] + 0.04, -hw + (i + 0.5) * 2 * hw / n, 0, (hatch[3] - hatch[2]) / 2, uvscale=1.3, grain=1)
    k.box('darkwood', 2 * hw - 0.04, 0.02, 0.05, 0, 0.025, 0.08)
    k.box('darkwood', 2 * hw - 0.04, 0.02, 0.05, 0, 0.025, hatch[3] - hatch[2] - 0.04)
    k.pop()
    for xx in (-hw + 0.04, hw - 0.04):
        k.beam('wood', V(xx, hatch[2] + 0.02, 0.17), V(xx, hatch[3] + 0.2, 0.25), 0.022, round_=True)
    # on the bar: tankards, a bottle, a jug
    for i, xx in enumerate((-0.28, -0.12, 0.05, 0.22)):
        tankard(k, xx, hatch[2] + 0.022, 0.13 + (i % 2) * 0.04)
    bottle(k, 0.31, hatch[2] + 0.022, 0.1)
    lathe(k, 'terracotta', [(0.03, 0), (0.045, 0.03), (0.04, 0.07), (0.015, 0.09), (0.016, 0.11)], -0.36, hatch[2] + 0.022, 0.12, seg=9)
    k.pop()
    # rudder on the sternpost and stern windows in the transom
    u, b, yt, p = prm(x_tr)
    k.push(x_tr - 0.04, 0, zc, -math.pi / 2)
    k.box('darkwood', 0.08, yt - 0.15, 0.06, 0, 0.0, 0.0)
    k.mesh('darkwood', [V(-0.03, 0.0, 0.03), V(-0.03, yt - 0.2, 0.03), V(-0.03, yt - 0.2, 0.1), V(-0.03, 0.0, 0.2), V(0.03, 0.0, 0.03), V(0.03, yt - 0.2, 0.03), V(0.03, yt - 0.2, 0.1), V(0.03, 0.0, 0.2)],
           [(0, 1, 2, 3), (7, 6, 5, 4), (1, 5, 6, 2), (3, 2, 6, 7), (0, 3, 7, 4)], uvscale=1.3)
    if not k.lod:
        for yy in (0.15, 0.4):
            k.box('iron', 0.09, 0.025, 0.2, 0, yy, 0.09)
        k.beam('darkwood', V(0, yt - 0.22, 0.1), V(0, yt - 0.02, 0.18), 0.04)
    k.pop()
    # (the transom leans aft; set the windows into it at its mid height)
    for i, dz in enumerate((-0.2, 0.0, 0.2)):
        yy = yt - 0.12
        xx = x_tr - 0.1 * (yy - (-0.14)) / (yt + 0.14) - 0.012
        k.push(xx, 0, zc + dz, -math.pi / 2, 0.1)
        k.box('window', 0.12, 0.14, 0.01, 0, yy - 0.07, 0.0)
        if not k.lod:
            k.box('darkwood', 0.16, 0.025, 0.03, 0, yy + 0.07, 0.005)
            k.box('darkwood', 0.16, 0.025, 0.03, 0, yy - 0.095, 0.005)
            for sx in (-1, 1):
                k.box('darkwood', 0.022, 0.16, 0.03, sx * 0.07, yy - 0.085, 0.005)
            k.box('darkwood', 0.012, 0.14, 0.012, 0, yy - 0.075, 0.01)
        k.pop()
    xx = x_tr - 0.1 * 0.72 - 0.01
    k.push(xx - 0.01, 0, zc, -math.pi / 2, 0.1)
    k.box('darkwood', 0.62, 0.06, 0.025, 0, yt - 0.33, 0.0)
    k.box('brass', 0.5, 0.025, 0.01, 0, yt - 0.315, 0.012)
    k.pop()
    # stern lantern on the taffrail
    k.cyl('iron', 0.012, 0.012, 0.12, x_tr - 0.12, yt + 0.21, zc, seg=6)
    k.push(x_tr - 0.12, yt + 0.33, zc)
    lathe(k, 'brass', [(0.0, 0.13), (0.02, 0.12), (0.05, 0.085), (0.052, 0.07), (0.042, 0.015), (0.02, 0.0), (0.0, 0.0)], 0, 0, 0, seg=8)
    k.box('window', 0.07, 0.065, 0.07, 0, 0.012, 0, ry=0.4)
    k.pop()
    # the cut-off end closed with a bulkhead of salvage boards and a door
    u0, b_, yt0, p0 = prm(x_cut)
    zs = [zc - b_ + 0.01 + i * (2 * b_ - 0.02) / (5 if k.lod else 11) for i in range((5 if k.lod else 11) + 1)]
    for z0, z1 in zip(zs, zs[1:]):
        zm = (z0 + z1) / 2
        # bottom of the board follows the hull section at the cut
        yb = max(-0.02, -0.14 + (yt0 + 0.14) * (1 - max(0.0, 1 - ((zm - zc) / b_) ** 2) ** (p0 / 2)) - 0.02)
        top = yt0 + 0.11 + k.r() * 0.03
        if abs(zm - (zc + 0.03)) < 0.2:
            k.box('oldplanks', 0.025, top - 0.74, (z1 - z0) - 0.006, x_cut + 0.005, 0.74, zm, grain=1, uvscale=1.3)
            continue
        k.box('oldplanks', 0.025, top - yb, (z1 - z0) - 0.006, x_cut + 0.005, yb, zm, grain=1, uvscale=1.3)
    k.push(x_cut + 0.02, 0, zc + 0.03, math.pi / 2)
    door(k, 0.0, 0.36, 0.7, 0.0, 0.03, ajar=0.5, mat='oldplanks')
    k.pop()
    for zz in (zc - b_ + 0.04, zc + b_ - 0.04):
        k.box('darkwood', 0.06, yt0 + 0.1, 0.06, x_cut + 0.03, 0, zz)
    k.box('darkwood', 0.06, 0.05, 2 * b_, x_cut + 0.03, yt0 + 0.08, zc)
    # galley stovepipe through the deck, and the cut-down mizzen stump
    k.cyl('iron', 0.035, 0.035, 0.5, -0.15, 0.8, zc - 0.15, seg=8)
    k.cyl('iron', 0.06, 0.06, 0.02, -0.15, 0.82, zc - 0.15, seg=8)
    k.cyl('iron', 0.05, 0.04, 0.06, -0.15, 1.3, zc - 0.15, seg=8)
    k.marker('smoke', -0.15, 1.4, zc - 0.15)
    k.cyl('wood', 0.07, 0.065, 0.62, -0.75, 0.9, zc - 0.05, seg=10)
    k.cyl('darkwood', 0.085, 0.085, 0.04, -0.75, 0.9, zc - 0.05, seg=10)
    for i in range(3):
        k.torus('rope', 0.072, 0.008, -0.75, 1.3 + i * 0.03, zc - 0.05, seg=10)
    # the old mainsail rigged as an awning: lashed to a spar on crutches above the rail, out to a pair of oars
    yb_, zb_ = 1.18, zc + b0 - 0.02
    yf_, zf_ = 0.9, 0.78
    for xx in (-1.0, 0.25):
        k.beam('wood', V(xx - 0.05, 0.84, zb_ - 0.02), V(xx, yb_ + 0.02, zb_), 0.03, round_=True)
        k.beam('wood', V(xx + 0.05, 0.84, zb_ - 0.02), V(xx, yb_ + 0.02, zb_), 0.03, round_=True)
    k.beam('bark', V(-1.12, yb_, zb_), V(0.4, yb_, zb_), 0.045, round_=True)
    sp = k.top @ Vector((0, yb_, zb_, 1))
    k.pop().pop()
    yb_, zb_ = sp.y, sp.z
    awning(k, 'canvas', -1.08, 0.36, yb_ - 0.01, zb_, yf_, zf_, sag=0.06, valance=0.0, poles=False)
    for xx in (-1.05, 0.33):
        k.cyl('wood', 0.024, 0.02, yf_ + 0.05, xx, 0, zf_ + 0.01, seg=7)
        k.box('wood', 0.07, 0.2, 0.015, xx, yf_ + 0.02, zf_ + 0.01)  # the oar blades, up
        guy(k, (xx, yf_ - 0.02, zf_), (xx + (-0.22 if xx < 0 else 0.22), 0.0, zf_ + 0.12))
    # barrel tables and seats under the awning
    barrel_table(k, -0.6, 0.48, stools=2)
    barrel_table(k, 0.12, 0.6, stools=2)
    crate(k, -1.08, 0, 0.6, 0.24, 0.3)
    # the grog cask on a cradle by the bar, tapped
    k.push(0.62, 0, 0.22, 0.4)
    for s in (-1, 1):
        k.box('wood', 0.05, 0.12, 0.32, s * 0.12, 0, 0)
    barrel(k, 0.0, 0.0, 1.1, 0.08, math.pi / 2, lying=True)
    if not k.lod:
        k.cyl('brass', 0.012, 0.012, 0.06, 0.0, 0.2, 0.2, seg=6, rx=math.pi / 2)
        k.cyl('wood', 0.04, 0.035, 0.05, 0.0, 0.0, 0.25, seg=8)
    k.pop()
    # rack of casks under a patched fly at the back right
    k.push(0.95, 0, -0.5)
    for s in (-1, 1):
        k.box('darkwood', 0.6, 0.06, 0.06, 0, 0, s * 0.18)
    for i in range(3):
        barrel(k, -0.21 + i * 0.21, 0.0, 0.75, 0.06, 0.0, lying=True)
    for i in range(2):
        barrel(k, -0.105 + i * 0.21, 0.0, 0.75, 0.27, 0.0, lying=True)
    for (xx, zz) in ((-0.36, 0.32), (0.36, 0.32), (-0.36, -0.32), (0.36, -0.32)):
        k.cyl('bark', 0.025, 0.022, 0.75 if zz > 0 else 0.62, xx, 0, zz, seg=6)
    awning(k, 'canvas', -0.42, 0.42, 0.6, -0.36, 0.74, 0.34, sag=0.05, valance=0.0, poles=False, pole_mat='bark')
    k.pop()
    # sign, cannon bollard, nets and flotsam
    k.cyl('darkwood', 0.035, 0.03, 1.2, 1.05, 0, 0.25, seg=7)
    hanging_sign(k, 1.05, 1.08, 0.27, 'DIVE')
    cannon_bollard(k, 1.15, 0.72)
    rope_coil(k, 0.85, 0.7, 0.11)
    barrel(k, 0.75, -0.08, 0.8)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the tavern

@building('tavern')
def tavern(k):
    """a two-storey tavern: a whitewashed rubble ground floor with a canted bay window, a jettied timber-framed
    upper storey under a deep thatch, an end chimney, a hanging sign, the cellar flaps, casks, benches and lanterns"""
    w, d, h1, h2, zb = 2.05, 1.45, 0.95, 0.82, -0.5
    k.push(0, 0, zb)
    plinth(k, w + 0.06, d + 0.06, 0.14)
    k.push(0, 0.14, 0)
    ops1 = [Op('front', -0.35, 'door', h=0.82), Op('front', 0.5, 'window', w=0.5, h=0.46, y=0.33, shutters=False), Op('front', -0.82, 'window', bars=True),
            Op('left', -0.3, 'window'), Op('right', 0.0, 'window'), Op('back', 0.3, 'window'), Op('back', -0.5, 'door', h=0.78)]
    W_plastered(k, w, d, h1, 'plaster', ops1)
    k.face('front', w, d)
    bay_window(k, 0.5, 0.31, 0.62, 0.48, 0.17, curtains='red')
    lantern(k, -0.66, 0.8, 0.02)
    ship_bell(k, -0.02, 0.78, 0.0)
    k.pop()
    # jettied upper storey
    k.push(0, h1, 0.04)
    k.box('darkwood', w + 0.16, 0.07, d + 0.2, 0, -0.035, 0)
    ops2 = [Op('front', -0.62, 'window'), Op('front', 0.0, 'window'), Op('front', 0.62, 'window'), Op('left', 0.25, 'window'), Op('right', -0.25, 'window'),
            Op('back', 0.0, 'window')]
    W_framed(k, w + 0.1, d + 0.1, h2, 'plasterYellow', ops2)
    k.face('front', w + 0.1, d + 0.1)
    for xx in (-0.62, 0.0, 0.62):
        window_box(k, xx, 0.4)
    k.pop()
    thatch_gable(k, w + 0.1, d + 0.1, 0.85, over=0.3, y=h2, mat='thatch', gable='planksDark')
    chimney(k, -(w + 0.1) / 2 - 0.13, -0.1, -0.14, h2 + 1.35, 0.32)
    k.pop()
    # jetty brackets along the front
    for xx in (-0.95, -0.1, 0.95):
        k.beam('darkwood', V(xx, h1 - 0.25, d / 2), V(xx, h1 - 0.03, d / 2 + 0.11), 0.05)
    k.pop()
    zf = zb + d / 2
    # chimney base on the ground
    k.box('stone', 0.4, 0.14, 0.4, -(w + 0.1) / 2 - 0.13, 0, zb - 0.1 + 0.04, uvscale=2.0)
    steps(k, -0.35, zf + 0.1, 0.55, 0.14, 1, 'stone')
    # the sign on a wrought arm at the corner of the upper storey
    hanging_sign(k, 0.92, h1 + 0.14 + 0.3, zf + 0.1, 'TAVERN')
    # cellar flaps: two sloping plank doors on a stone curb
    k.push(-0.82, 0, zf + 0.02)
    prism(k, 'stone', [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.42), (-0.3, 0.42)], 0.0, 0.08, uvscale=2.0)
    for sx in (-1, 1):
        k.push(sx * 0.135, 0.3, 0.0, 0, 0.55)
        for i in range(3):
            k.box('planksDark', 0.085, 0.03, 0.46, sx * (-0.09 + i * 0.09), 0, 0.23, uvscale=1.3, grain=1)
        k.box('iron', 0.22, 0.012, 0.025, 0, 0.03, 0.08)
        k.box('iron', 0.22, 0.012, 0.025, 0, 0.03, 0.38)
        k.pop()
    k.pop()
    # casks: a pyramid of lying casks and a couple upright
    for i in range(3):
        barrel(k, -1.15 + i * 0.0, 0.28 + i * 0.3 - 0.3, 0.8, 0.0, math.pi / 2, lying=True)
    barrel(k, -1.15, 0.13, 0.8, 0.24, math.pi / 2, lying=True)
    barrel(k, -1.15, 0.43, 0.8, 0.24, math.pi / 2, lying=True)
    barrel(k, -0.75, 0.95, 0.9)
    barrel(k, -1.05, 1.05, 0.8)
    # trestle table and benches out front, mugs and a jug, a barrel table
    trestle(k, 0.55, 0.85, 0.9, 0.3)
    bench(k, 0.55, 0.6, 0.85)
    bench(k, 0.55, 1.1, 0.85)
    for xx in (0.25, 0.45, 0.7, 0.88):
        tankard(k, xx, 0.4, 0.82 + (k.r() - 0.5) * 0.1)
    lathe(k, 'terracotta', [(0.03, 0), (0.05, 0.03), (0.045, 0.08), (0.018, 0.1), (0.02, 0.12)], 0.6, 0.4, 0.9, seg=9)
    barrel_table(k, -0.25, 0.95, stools=2)
    lantern_post(k, 1.2, 0.5, 1.0, ry=-math.pi / 2)
    # a hand cart with a cask, and the drayman's barrow
    k.push(1.1, 0, -0.1, 0.3)
    for s in (-1, 1):
        k.cyl('darkwood', 0.17, 0.17, 0.03, s * 0.2, 0.17, 0.0, seg=12 if not k.lod else 6, rz=math.pi / 2)
    k.box('planks', 0.36, 0.03, 0.5, 0, 0.2, 0.05, uvscale=1.3)
    for s in (-1, 1):
        k.beam('darkwood', V(s * 0.15, 0.21, 0.0), V(s * 0.12, 0.05, 0.55), 0.03)
    barrel(k, 0.0, 0.05, 0.75, 0.23, 0.0, lying=True)
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- wench & masseuse

@building('wench_hut')
def wench_hut(k):
    """a little pink-washed cottage under thatch: an open doorway hung with a red curtain, a striped porch awning,
    a red-shaded lantern, a hammock, a wash tub with towels on a line, and the parrot on its perch"""
    w, d, h, zb = 1.25, 0.92, 0.98, -0.3
    k.push(0, 0, zb)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    ops = [Op('front', -0.15, 'open', w=0.42, h=0.78, y=0.0), Op('front', 0.36, 'window', w=0.26), Op('left', 0.0, 'window', w=0.26), Op('back', 0.2, 'window', w=0.26)]
    W_plastered(k, w, d, h, 'plasterPink', [o for o in ops], quoins=None, base='stoneDark')
    win_curtains(k, w, d, ops, 0.0, 0.063, 'red')
    k.face('front', w, d)
    doorway(k, -0.15, 0.42, 0.78, 0.063)
    k.pop()
    k.face('back', w, d)
    window_box(k, 0.2, 0.4, 0.32)
    k.pop()
    # an alcove inside: a bed with red covers glimpsed through the door
    k.box('darkwood', 0.6, 0.18, 0.4, 0.05, 0.0, -0.18)
    k.box('red', 0.58, 0.05, 0.38, 0.05, 0.18, -0.18)
    k.box('canvas', 0.16, 0.05, 0.3, -0.17, 0.22, -0.18)
    thatch_gable(k, w, d, 0.62, over=0.2, y=h, mat='thatch', gable='planksDark')
    k.pop()
    k.pop()
    zf = zb + d / 2
    # porch: a low plank floor and a striped awning on two posts
    k.push(0, 0, zf + 0.25)
    deck(k, w + 0.1, 0.5, 0.1, 'planks', along='x', joists=False)
    k.pop()
    k.box('stone', w + 0.1, 0.06, 0.5, 0, 0.0, zf + 0.25, uvscale=2.0)
    awning(k, 'canvasRed', -w / 2 - 0.02, w / 2 + 0.02, 0.93, zf + 0.17, 0.86, zf + 0.5, sag=0.03, valance=0.06, poles=False)
    for xx in (-w / 2 + 0.02, w / 2 - 0.02):
        k.cyl('darkwood', 0.03, 0.028, 0.78, xx, 0.08, zf + 0.48, seg=8)
        k.beam('darkwood', V(xx, 0.93, zf + 0.0), V(xx, 0.93, zf + 0.2), 0.04)
    # bench and a parrot by the door
    bench(k, 0.33, zf + 0.12, 0.42, h=0.22, y=0.08)
    parrot_perch(k, -0.6, zf + 0.68, 0.72, ry=0.4)
    # the red lantern on its post
    k.cyl('darkwood', 0.03, 0.025, 1.0, 0.75, 0, zf + 0.75, seg=7)
    k.box('iron', 0.02, 0.02, 0.2, 0.75, 0.97, zf + 0.65)
    small_lantern(k, 0.75, 0.97, zf + 0.57, 1.3)
    lathe(k, 'red', [(0.0, 0.03), (0.03, 0.03), (0.06, 0.0), (0.065, -0.012)], 0.75, 0.92, zf + 0.57, seg=10, cap=False)
    # hammock slung from the porch post to a post at the side
    k.cyl('bark', 0.03, 0.028, 0.75, 0.78, 0, -0.55, seg=7)
    hammock(k, (w / 2 - 0.02, 0.68, zf + 0.46), (0.78, 0.68, -0.55), w=0.2, sag=0.2, mat='canvas')
    hm = Vector((w / 2 - 0.02, 0.68, zf + 0.46)).lerp(Vector((0.78, 0.68, -0.55)), 0.5)
    k.box('red', 0.12, 0.04, 0.12, hm.x, 0.68 - 0.2 - 0.02, hm.z, ry=0.2)  # a cushion in it
    # the masseuse's tub, a stool, oils, and towels drying on a line
    wash_tub(k, -0.62, -0.6 + 0.0, 0.17)
    stool(k, -0.3, -0.75, 0.2)
    for i in range(3):
        bottle(k, -0.33 + i * 0.03, 0.2, -0.75 + (i % 2) * 0.03, 'brass' if i == 1 else 'black')
    k.cyl('bark', 0.022, 0.02, 0.8, -0.8, 0, 0.25, seg=6)
    k.cyl('bark', 0.022, 0.02, 0.8, -0.8, 0, -0.75, seg=6)
    k.beam('rope', V(-0.8, 0.77, 0.25), V(-0.8, 0.76, -0.75), 0.007, round_=True, seg=4)
    for i, (zz, m) in enumerate(((0.08, 'canvas'), (-0.18, 'red'), (-0.45, 'canvas'))):
        k.cbox(m, 0.012, 0.24, 0.18, -0.8, 0.65, zz, rz=0.04 * (i - 1))
    potted_palm(k, 0.6, zf + 0.1, 0.85)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the cheap eatery

def grating(k, x, y, z, w, d, mat='darkwood', pitch=0.07):
    """a ship's hatch grating: interlocked battens in a coaming frame (salvage, used as a table top)"""
    k.box(mat, w, 0.04, 0.05, x, y, z - d / 2 + 0.025)
    k.box(mat, w, 0.04, 0.05, x, y, z + d / 2 - 0.025)
    k.box(mat, 0.05, 0.04, d, x - w / 2 + 0.025, y, z)
    k.box(mat, 0.05, 0.04, d, x + w / 2 - 0.025, y, z)
    if k.lod:
        k.box(mat, w - 0.08, 0.025, d - 0.08, x, y + 0.01, z)
        return
    k.box('black', w - 0.08, 0.005, d - 0.08, x, y + 0.005, z)
    n = round((w - 0.1) / pitch)
    for i in range(n + 1):
        k.box(mat, 0.018, 0.035, d - 0.08, x - (w - 0.1) / 2 + i * (w - 0.1) / n, y, z)
    m = round((d - 0.1) / pitch)
    for j in range(m + 1):
        k.box(mat, w - 0.08, 0.02, 0.018, x, y + 0.015, z - (d - 0.1) / 2 + j * (d - 0.1) / m)


def roast_pig(k, x, y, z, L=0.5):
    """a pig on the spit, browned, trussed (axis along x)"""
    rot = Matrix.Rotation(-math.pi / 2, 4, 'Z')
    prof = [(0.0, -L / 2), (0.03, -L / 2 + 0.01), (0.06, -L / 2 + 0.05), (0.1, -L / 2 + 0.13), (0.11, 0.0), (0.1, L / 2 - 0.15), (0.07, L / 2 - 0.08), (0.04, L / 2 - 0.02), (0.015, L / 2 + 0.03), (0.0, L / 2 + 0.04)]
    lathe(k, 'terracotta', prof, x, y, z, seg=12, sx=1.0, sz=0.85, local=rot)
    if not k.lod:
        for s in (-1, 1):
            k.cbox('terracotta', 0.03, 0.1, 0.03, x - L / 2 + 0.1, y - 0.04, z + s * 0.05, rz=-1.2)
            k.cbox('terracotta', 0.03, 0.1, 0.03, x + L / 2 - 0.16, y - 0.04, z + s * 0.05, rz=1.2)
            k.cbox('terracotta', 0.02, 0.04, 0.03, x + L / 2 - 0.02, y + 0.05, z + s * 0.03, rz=0.6)


@building('eatery')
def eatery(k):
    """Cheap Eatery: an open-sided cookhouse under palm thatch with a long table made of a ship's hatch grating,
    and an outdoor kitchen - a pig turning on the spit over the coals, a domed bread oven, a cook's bench"""
    # the pavilion
    px0, px1, pz = -0.42, 1.22, 0.62  # (eaves stop at the lot's side)
    cx = (px0 + px1) / 2
    W, Dp, H = px1 - px0, 2 * pz, 1.04
    k.push(cx, 0, -0.05)
    k.box('stoneDark', W + 0.12, 0.05, Dp + 0.12, 0, 0, 0, uvscale=2.0)
    k.box('dirt', W + 0.06, 0.012, Dp + 0.06, 0, 0.05, 0)
    xs = [-W / 2 + 0.04, 0.0, W / 2 - 0.04]
    for xx in xs:
        for zz in (-pz + 0.04, pz - 0.04):
            k.box('stone', 0.12, 0.08, 0.12, xx, 0.0, zz, uvscale=2.0)
            k.cyl('bark', 0.045, 0.04, H, xx, 0.05, zz, seg=8)
            for s in (-1, 1):
                if -W / 2 < xx + s * 0.2 < W / 2:
                    k.beam('bark', V(xx, H - 0.25, zz), V(xx + s * 0.2, H - 0.03, zz), 0.035, round_=True)
    for zz in (-pz + 0.04, pz - 0.04):
        k.beam('bark', V(-W / 2 - 0.05, H + 0.02, zz), V(W / 2 + 0.05, H + 0.02, zz), 0.07, round_=True)
    for xx in xs:
        k.beam('bark', V(xx, H + 0.05, -pz - 0.02), V(xx, H + 0.05, pz + 0.02), 0.06, round_=True)
    k.push(0, 0, 0, math.pi / 2)
    thatch_gable(k, Dp, W, 0.62, over=0.2, y=H, mat='thatchDark', gable='bamboo', gable_kind='wattle', res=0.06)
    k.pop()
    # a low back screen of boards with a crockery shelf
    k.push(0, 0.05, -pz + 0.04)
    for i in range(round(W / 0.13)):
        xx = -W / 2 + 0.06 + (i + 0.5) * (W - 0.12) / round(W / 0.13)
        k.box('oldplanks', (W - 0.12) / round(W / 0.13) - 0.006, 0.5 + k.r() * 0.03, 0.02, xx, 0, -0.02, uvscale=1.3, grain=1)
    k.box('planks', W - 0.1, 0.025, 0.12, 0, 0.62, 0.02)
    for i in range(10):
        xx = -W / 2 + 0.15 + i * (W - 0.3) / 9
        if i % 3 == 0:
            lathe(k, 'terracotta', [(0.03, 0), (0.045, 0.03), (0.04, 0.08), (0.02, 0.1), (0.022, 0.12)], xx, 0.645, 0.02, seg=9)
        else:
            lathe(k, 'terracotta' if i % 2 else 'bone', [(0.025, 0), (0.06, 0.03), (0.065, 0.04)], xx, 0.645, 0.02, seg=10, cap=False)
    k.pop()
    # the long table (a hatch grating on trestles), benches, bowls and mugs
    grating(k, 0.05, 0.41, 0.0, 1.25, 0.42)
    for s in (-1, 1):
        for zz in (-0.15, 0.15):
            k.beam('wood', V(s * 0.45, 0.05, zz), V(s * 0.45 - zz * 0.3, 0.41, -zz * 0.3), 0.04)
    for zz in (-0.36, 0.36):
        bench(k, 0.05, zz, 1.2, y=0.05)
    for i in range(6):
        xx = -0.45 + i * 0.2
        zz = 0.1 if i % 2 else -0.1
        lathe(k, 'terracotta', [(0.025, 0), (0.05, 0.025), (0.055, 0.035)], xx, 0.45, zz, seg=10, cap=False)
        tankard(k, xx + 0.07, 0.45, -zz * 0.8)
    k.pop()
    # outdoor kitchen: fire pit with the spit
    fx, fz = -0.92, 0.42
    for i in range(11):
        a = i / 11 * math.tau
        k.cbox('stone', 0.09, 0.07, 0.08, fx + math.cos(a) * 0.26, 0.035, fz + math.sin(a) * 0.18, ry=-a, uvscale=2.0)
    k.cyl('black', 0.24, 0.22, 0.02, fx, 0.0, fz, seg=12)
    for i in range(7):
        k.cbox('fire' if i % 2 else 'black', 0.07, 0.03, 0.05, fx - 0.15 + i * 0.05, 0.02, fz + (k.r() - 0.5) * 0.1, ry=k.r() * 3)
    for i in range(5):
        a = i / 5 * math.tau
        k.beam('bark', V(fx + math.cos(a) * 0.18, 0.02, fz + math.sin(a) * 0.1), V(fx - math.cos(a) * 0.04, 0.06, fz - math.sin(a) * 0.02), 0.035, round_=True)
    k.marker('smoke', fx, 0.2, fz)
    for s in (-1, 1):
        xx = fx + s * 0.34
        for t in (-1, 1):
            k.beam('iron', V(xx, 0, fz + t * 0.08), V(xx, 0.36, fz), 0.016, round_=True, seg=5)
        k.beam('iron', V(xx, 0.36, fz), V(xx - s * 0.02, 0.42, fz + 0.03), 0.012, round_=True, seg=4)
    k.beam('iron', V(fx - 0.42, 0.37, fz), V(fx + 0.4, 0.37, fz), 0.012, round_=True, seg=5)
    k.beam('iron', V(fx + 0.4, 0.37, fz), V(fx + 0.4, 0.3, fz + 0.05), 0.012, round_=True, seg=4)
    k.cyl('wood', 0.012, 0.012, 0.06, fx + 0.4, 0.3, fz + 0.05, seg=5, rx=math.pi / 2)
    roast_pig(k, fx, 0.37, fz, 0.48)
    k.cbox('iron', 0.3, 0.025, 0.1, fx, 0.06, fz - 0.15)  # drip pan
    # the domed bread oven with its flue
    ox, oz = -0.95, -0.42
    k.push(ox, 0, oz)
    plinth(k, 0.66, 0.6, 0.26)
    k.pop()
    dome = [(0.28, 0.0), (0.285, 0.06), (0.26, 0.14), (0.21, 0.22), (0.14, 0.28), (0.06, 0.31), (0.0, 0.32)]
    lathe(k, 'plaster', dome, ox, 0.26, oz - 0.02, seg=16, uvscale=1.5)
    k.push(ox, 0.26, oz + 0.25)
    k.box('black', 0.16, 0.13, 0.04, 0, 0.0, 0.0)
    for i in range(7):
        a = math.pi * i / 6
        k.cbox('stoneDark', 0.05, 0.035, 0.07, math.cos(a) * 0.1, 0.12 * 0.7 + math.sin(a) * 0.08, 0.02, rz=a - math.pi / 2, uvscale=2.0)
    k.box('stone', 0.28, 0.03, 0.12, 0, -0.03, 0.08, uvscale=2.0)
    k.pop()
    for i in range(3):
        k.cbox('fire', 0.035, 0.02, 0.02, ox - 0.04 + i * 0.04, 0.275, oz + 0.275, ry=i)
    k.cyl('stoneDark', 0.06, 0.05, 0.28, ox + 0.08, 0.5, oz - 0.12, seg=8)
    k.marker('smoke', ox + 0.08, 0.82, oz - 0.12)
    # peel and firewood
    k.beam('wood', V(ox + 0.4, 0.0, oz + 0.25), V(ox + 0.35, 0.95, oz + 0.05), 0.02, round_=True)
    k.cbox('wood', 0.14, 0.012, 0.16, ox + 0.405, 0.07, oz + 0.27, rx=-0.2)
    for i in range(9):
        r = 0.03 + k.r() * 0.012
        k.cyl('bark', r, r, 0.4, -1.28 + (i % 3) * 0.072 + (0.036 if (i // 3) % 2 else 0), (i // 3) * 0.062, 0.0, seg=6, rx=math.pi / 2)
    # cook's bench with fish, a cleaver, and a water cask
    trestle(k, -0.85, -0.02, 0.5, 0.24, ry=0.0, h=0.4, top='planks')
    if not k.lod:
        for i in range(3):
            lathe(k, 'plasterBlue', [(0.0, -0.08), (0.02, -0.06), (0.03, 0.0), (0.02, 0.05), (0.006, 0.07), (0.025, 0.1)], -0.95 + i * 0.09, 0.42, -0.02, seg=6, sz=0.45, local=Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Rotation(0.3 * i, 4, 'Z'))
        k.cbox('iron', 0.1, 0.004, 0.05, -0.7, 0.405, 0.03, ry=0.4)
    barrel(k, -0.5, -0.6, 0.85)
    sack(k, -0.5, -0.25, 0.8, 0.5)
    # a barrel table at the front and the sign on the corner post
    barrel_table(k, 0.25, 0.66, stools=2)  # (its stools stay on the lot)
    hanging_sign(k, px1 - 0.04, 0.92, 0.57 - 0.05 + 0.0, 'EATS')
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the gambling den

def shingle_gable(k, w, d, h, rise, over=0.22, mat='planksDark', gable='oldplanks'):
    """a wooden-shingle gable roof on walls w x d of height h (current frame), with ridge board and boarded gables"""
    for s in (-1, 1):
        k.push(0, 0, 0, 0 if s > 0 else math.pi)
        L = math.hypot(d / 2 + over, rise + over * rise / (d / 2))
        shingle_lean(k, w + 2 * over * 0.7, d / 2 + over, h + rise, h - over * rise / (d / 2), z0=0.0, mat=mat, rows=max(2, round(L / 0.125)))
        k.pop()
    k.beam('darkwood', V(-w / 2 - over * 0.7, h + rise + 0.02, 0), V(w / 2 + over * 0.7, h + rise + 0.02, 0), 0.08, 0.06)
    gables(k, w, d, rise, h, gable, 'boards', barge=True)


def shutter_opening(k, x, y, w, h, depth=0.06, mat='planks'):
    """a wide unglazed opening (Op kind 'open') with a sill board and two plank shutters swung right back
    against the wall (face frame)"""
    k.cbox('planks', w + 0.1, 0.04, 0.16, x, y - 0.01, 0.03, uvscale=1.3)
    for s in (-1, 1):
        k.box('darkwood', 0.05, h, depth + 0.03, x + s * (w / 2 + 0.02), y, -depth / 2)
    k.box('darkwood', w + 0.12, 0.05, depth + 0.04, x, y + h, -depth / 2)
    for s in (-1, 1):
        x0 = x + s * (w / 2 + 0.06)
        n = 1 if k.lod else 3
        for i in range(n):
            k.box(mat, w / 2 / n - (0.005 if n > 1 else 0), h - 0.01, 0.022, x0 + s * (i + 0.5) * w / 2 / n, y, 0.03, uvscale=1.4, grain=1)
        for yy in (h * 0.15, h * 0.75):
            k.box('darkwood', w / 2 - 0.03, 0.035, 0.012, x0 + s * w / 4, y + yy, 0.046)
            k.box('iron', 0.08, 0.012, 0.008, x0 - s * 0.0, y + yy + 0.01, 0.054)


@building('gambling_den')
def gambling_den(k):
    """Gambling Den: a weatherboarded shack with its shutters propped open, a purple-striped awning over the
    card and dice tables, strings of lanterns, a tally board, casks of beer and the black flag on the gable"""
    w, d, h, zb = 2.9, 1.5, 1.0, -0.48  # (back eaves and the yard clutter stay on the lot)
    k.push(0, 0, zb)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    ops = [Op('front', 0.0, 'double', w=0.62, h=0.86), Op('front', -0.85, 'open', w=0.6, h=0.42, y=0.42), Op('front', 0.85, 'open', w=0.6, h=0.42, y=0.42),
           Op('left', 0.0, 'window', shutters=True), Op('right', 0.2, 'window'), Op('back', -0.6, 'window'), Op('back', 0.7, 'door', h=0.8)]
    W_clapboard(k, w, d, h, 'oldplanks', ops, trim='darkwood')
    k.face('front', w, d)
    for xx in (-0.85, 0.85):
        shutter_opening(k, xx, 0.42, 0.6, 0.42, 0.06)
    k.pop()
    # inside the hatches: a dim room with a lit table and a bottle shelf
    for xx in (-0.85, 0.85):
        k.box('planksDark', 0.7, 0.02, 0.5, xx, 0.4, d / 2 - 0.32)
        k.box('planks', 0.6, 0.02, 0.08, xx, 0.66, -d / 2 + 0.3)
        for i in range(5):
            bottle(k, xx - 0.24 + i * 0.12, 0.68, -d / 2 + 0.3, 'black' if i % 2 else 'brass')
    shingle_gable(k, w, d, h, 0.62, over=0.24)
    flagpole(k, -w / 2 - 0.05, 0.0, 0.75, base=h + 0.5)
    k.pop()
    k.pop()
    zf = zb + d / 2
    # a plank stoop, then the striped awning out to its poles
    k.push(0, 0, zf + 0.12)
    deck(k, w - 0.1, 0.24, 0.1, 'planks', along='x', joists=False)
    k.pop()
    awning(k, 'canvasPurple', -w / 2 + 0.05, w / 2 - 0.05, 1.08, zf + 0.02, 0.9, zf + 0.98, sag=0.05, valance=0.08)
    k.box('darkwood', w, 0.06, 0.06, 0, 1.06, zf + 0.04)
    string_lights(k, (-w / 2 + 0.08, 0.86, zf + 0.99), (w / 2 - 0.08, 0.86, zf + 0.99), n=6, sag=0.08)
    k.push(0, 0, zf)
    lantern(k, -0.45, 0.95, 0.02)
    k.pop()
    # tables: cards to the left, dice to the right, a cask table between
    card_table(k, -0.85, zf + 0.62, 0.24, chairs=3, cloth='red')
    card_table(k, 0.85, zf + 0.62, 0.24, chairs=3, cloth='canvasGreen')
    barrel_table(k, 0.0, zf + 0.82, stools=0)
    if not k.lod:
        lathe(k, 'planksDark', [(0.025, 0), (0.03, 0.06), (0.032, 0.07), (0.0, 0.065)], 0.05, 0.375, zf + 0.82, seg=8, cap=False)
        dice(k, -0.06, 0.375, zf + 0.84)
    # the tally board on an easel and a cask stand by the door
    k.push(-1.6, 0, zf + 0.35, 0.5)
    for s in (-1, 1):
        k.beam('wood', V(s * 0.17, 0, 0.05), V(s * 0.12, 0.85, 0), 0.025)
    k.beam('wood', V(0, 0, -0.25), V(0, 0.82, 0), 0.025)
    k.cbox('black', 0.38, 0.32, 0.02, 0, 0.6, 0.03, rx=-0.08)
    k.box('darkwood', 0.42, 0.03, 0.04, 0, 0.42, 0.04)
    if not k.lod:
        for r in range(4):
            for c in range(3 + r % 2):
                k.cbox('bone', 0.006, 0.05, 0.004, -0.13 + c * 0.03 + (0.12 if r % 2 else 0), 0.7 - r * 0.065, 0.045, rx=-0.08)
            k.cbox('bone', 0.11, 0.005, 0.004, -0.09, 0.7 - r * 0.065, 0.047, rz=0.4)
    k.pop()
    for (xx, zz, s_) in ((1.58, zf + 0.3, 0.85), (1.6, zf - 0.05, 0.85), (1.6, zf + 0.62, 0.8)):
        barrel(k, xx, zz, s_)
    # round the back: a rain butt under the eave, crates and empties
    barrel(k, -1.25, zb - d / 2 - 0.13, 1.0)
    crate(k, 1.05, 0, zb - d / 2 - 0.13, 0.26, 0.2)
    crate(k, 1.35, 0, zb - d / 2 - 0.13, 0.24, -0.3)
    crate(k, 1.2, 0.26, zb - d / 2 - 0.13, 0.22, 0.5)
    for i in range(4):
        bottle(k, 0.0 + i * 0.07, 0.0, zb - d / 2 - 0.08 - (i % 2) * 0.04)
    hanging_sign(k, w / 2 - 0.12, 1.0, zf + 0.04, 'DICE')
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- brothel & salon

def veranda(k, w, depth, y_floor, y_top, z0, n_posts=5, rail=True, roof='planksDark', post='darkwood', upper=True, lean_hi=None, step=0.085):
    """a two-level gallery across a front wall at z0: posts from the ground, a balcony deck at y_floor with a
    turned balustrade, upper posts carrying a shingled lean-to tucked under the main eave"""
    zf = z0 + depth - 0.05
    xs = [-w / 2 + 0.06 + i * (w - 0.12) / (n_posts - 1) for i in range(n_posts)]
    for x in xs:
        k.box('stone', 0.13, 0.08, 0.13, x, 0, zf, uvscale=2.0)
        k.box(post, 0.075, y_floor - 0.08, 0.075, x, 0.08, zf)
        for s in (-1, 1):
            if -w / 2 < x + s * 0.2 < w / 2 and not k.lod:
                k.beam(post, V(x, y_floor - 0.3, zf), V(x + s * 0.2, y_floor - 0.08, zf), 0.045)
    k.box(post, w + 0.06, 0.09, 0.09, 0, y_floor - 0.1, zf)
    k.push(0, 0, z0 + depth / 2)
    deck(k, w, depth, y_floor, 'planks', along='x', joists=False)
    k.pop()
    k.box(post, w, 0.05, 0.04, 0, y_floor - 0.08, z0 + depth - 0.02)
    if rail:
        balustrade(k, -w / 2 + 0.06, w / 2 - 0.06, zf, y_floor, 0.32, post, step)
        for s in (-1, 1):
            balustrade_z(k, z0 + 0.02, zf, s * (w / 2 - 0.04), y_floor, 0.32, post, step)
    if upper:
        for x in xs:
            k.box(post, 0.06, y_top - y_floor, 0.06, x, y_floor, zf)
        k.box(post, w + 0.06, 0.08, 0.08, 0, y_top - 0.08, zf)
        hi = lean_hi if lean_hi is not None else y_top + 0.18
        shingle_lean(k, w + 0.12, depth + 0.12, hi, y_top - 0.02, z0=z0 - 0.02, mat=roof, rows=max(2, round(math.hypot(depth, hi - y_top) / 0.12)))
    return xs, zf


@building('brothel')
def brothel(k):
    """Brothel & Salon: a grand pink-washed two-storey house under Spanish tiles, a full-width gallery with
    French doors hung with red drapes, strings of lanterns, hammocks on the veranda, a parrot, potted palms,
    and the laundry out back"""
    w, d, h1, h2, zb, p_ = 4.3, 1.9, 1.0, 0.92, -0.68, 0.14
    k.push(0, 0, zb)
    plinth_lo(k, w + 0.06, d + 0.06, p_)
    k.push(0, p_, 0)
    ops1 = [Op('front', 0.0, 'double', w=0.7, h=0.88), Op('front', -0.75, 'window', h=0.5, y=0.28), Op('front', 0.75, 'window', h=0.5, y=0.28),
            Op('front', -1.6, 'window', h=0.5, y=0.28), Op('front', 1.6, 'window', h=0.5, y=0.28), Op('left', -0.4, 'window'), Op('left', 0.45, 'window'),
            Op('right', 0.0, 'window'), Op('back', -1.2, 'window'), Op('back', 0.0, 'door', h=0.82), Op('back', 1.2, 'window')]
    W_plastered(k, w, d, h1, 'plasterPink', ops1)
    win_curtains(k, w, d, ops1, 0.0, 0.063, 'red')
    k.box('stone', w + 0.06, 0.08, d + 0.06, 0, h1 - 0.02, 0, uvscale=2.0)  # string course
    k.push(0, h1 + 0.06, 0)
    ops2 = [Op('front', -1.2, 'open', w=0.42, h=0.8, y=0.0), Op('front', 0.0, 'open', w=0.42, h=0.8, y=0.0), Op('front', 1.2, 'open', w=0.42, h=0.8, y=0.0),
            Op('front', -0.6, 'window', h=0.42, y=0.28), Op('front', 0.6, 'window', h=0.42, y=0.28),
            Op('front', -1.8, 'window', h=0.42, y=0.28), Op('front', 1.8, 'window', h=0.42, y=0.28),
            Op('left', 0.0, 'window'), Op('right', -0.45, 'window'), Op('right', 0.45, 'window'), Op('back', -1.0, 'window'), Op('back', 0.0, 'window'), Op('back', 1.0, 'window')]
    W_plastered(k, w, d, h2, 'plasterPink', ops2)
    win_curtains(k, w, d, ops2, 0.0, 0.063, 'red')
    k.face('front', w, d)
    for i, xx in enumerate((-1.2, 0.0, 1.2)):
        doorway(k, xx, 0.42, 0.8, 0.063, drape_mat='red' if i != 1 else 'canvasPurple')
    k.pop()
    # rooms glimpsed through the French doors: a lamp-lit wall and a bed
    k.box('plasterYellow', w - 0.3, h2 - 0.05, 0.02, 0, 0.0, d / 2 - 0.55)
    k.box('darkwood', 0.6, 0.2, 0.3, -1.2, 0.0, d / 2 - 0.4)
    k.box('red', 0.58, 0.05, 0.28, -1.2, 0.2, d / 2 - 0.4)
    tile_gable(k, w, d, 0.82, over=0.24, y=h2, gable='plasterPink', tile_len=0.24, tile_w=0.16)
    chimney(k, -w / 2 + 0.45, -d / 2 + 0.35, h2 - 0.1, 1.05, 0.3)
    k.pop()
    k.pop()
    k.pop()
    zf = zb + d / 2
    # gallery
    y_floor = p_ + h1 + 0.06
    y_top = y_floor + h2 - 0.06
    xs, zr = veranda(k, w + 0.1, 0.62, y_floor, y_top - 0.12, zf, n_posts=6, lean_hi=y_top - 0.06)
    k.box('stone', w + 0.2, 0.06, 0.66, 0, 0, zf + 0.33, uvscale=2.0)
    steps(k, 0, zf + 0.75, 0.9, 0.12, 1, 'stone')
    # lanterns: a string along the rail, red-shaded lanterns hung under the gallery
    string_lights(k, (xs[0], y_floor + 0.5, zr + 0.03), (xs[-1], y_floor + 0.5, zr + 0.03), n=9, sag=0.06)
    for x in (xs[1], xs[-2], xs[2], xs[-3]):
        k.box('iron', 0.012, 0.012, 0.18, x, y_floor - 0.14, zr - 0.1)
        small_lantern(k, x, y_floor - 0.14, zr - 0.18, 1.2)
        lathe(k, 'red', [(0.0, 0.03), (0.03, 0.03), (0.06, 0.0), (0.065, -0.012)], x, y_floor - 0.2, zr - 0.18, seg=10, cap=False)
    # drapes swagged between the gallery posts above the rail
    for a, b in zip(xs, xs[1:]):
        if k.lod:
            break
        sv, sf = [], []
        n = 8
        for i in range(n + 1):
            t = i / n
            x = a + (b - a) * t
            y = y_top - 0.16 - 0.12 * math.sin(math.pi * t)
            sv += [V(x, y_top - 0.15, zr + 0.045), V(x, y, zr + 0.05 + 0.02 * math.sin(math.pi * t))]
        for i in range(n):
            q = 2 * i
            sf.append((q, q + 1, q + 3, q + 2))
        quads2(k, 'red', sv, sf)
    # veranda furniture: a hammock at the left end, chairs and a little table, palms by the steps
    hammock(k, (xs[0], 0.62, zr), (xs[1], 0.62, zr), w=0.2, sag=0.2, mat='canvasRed')
    for xx in (-0.75, 0.75):
        potted_palm(k, xx * 0.72, zf + 0.8, 1.05)
    k.cyl('darkwood', 0.14, 0.14, 0.03, 1.25, 0.36, zf + 0.35, seg=14)
    k.cyl('darkwood', 0.02, 0.02, 0.36, 1.25, 0.06, zf + 0.35, seg=6)
    for s in (-1, 1):
        k.push(1.25 + s * 0.3, 0.06, zf + 0.35, -s * math.pi / 2)
        k.box('darkwood', 0.26, 0.04, 0.24, 0, 0.2, 0)
        k.box('red', 0.24, 0.03, 0.22, 0, 0.24, 0)
        k.box('darkwood', 0.26, 0.3, 0.035, 0, 0.24, -0.11)
        for (ax, az) in ((-0.11, -0.1), (0.11, -0.1), (-0.11, 0.1), (0.11, 0.1)):
            k.box('darkwood', 0.03, 0.2, 0.03, ax, 0, az)
        k.pop()
    bottle(k, 1.22, 0.39, zf + 0.35, 'brass')
    tankard(k, 1.3, 0.39, zf + 0.3, 'brass')
    parrot_perch(k, -1.25, zf + 0.3, 0.68)
    bench(k, -0.7 - 0.35, zf + 0.12, 0.5, y=0.06)
    hanging_sign(k, xs[-1] + 0.0, y_floor - 0.12, zr + 0.02, 'SALON')
    # the side yard: a hammock between two palm trunks
    # (upright, with crowns kept over the lot)
    palm_tree(k, 2.5, -1.4, 1.7, 0.03, 0.4, L=0.43)
    palm_tree(k, 2.5, -0.2, 1.45, 0.04, -0.6, L=0.4)
    hammock(k, (2.5, 0.62, -1.35), (2.5, 0.62, -0.25), w=0.2, sag=0.2, mat='canvas')
    # laundry out back
    for xx in (-1.6, 1.0):
        k.cyl('bark', 0.022, 0.02, 0.85, xx, 0, zb - d / 2 - 0.2, seg=6)
    k.beam('rope', V(-1.6, 0.82, zb - d / 2 - 0.2), V(1.0, 0.81, zb - d / 2 - 0.2), 0.007, round_=True, seg=4)
    for i, m in enumerate(('canvas', 'red', 'canvas', 'canvasRed', 'canvas', 'red', 'canvas')):
        k.cbox(m, 0.22 + 0.05 * (i % 2), 0.24 - 0.04 * (i % 3), 0.01, -1.4 + i * 0.34, 0.68 + 0.02 * (i % 3), zb - d / 2 - 0.2, rz=0.03 * (i - 3))
    wash_tub(k, 1.5, zb - d / 2 - 0.15, 0.18)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the inn

def well(k, x, z, r=0.26):
    """a coursed stone well head with a timber windlass, rope and bucket"""
    n = 7 if k.lod else 14
    for row in range(1 if k.lod else 4):
        for i in range(n):
            a = (i + 0.5 * (row % 2)) / n * math.tau
            if k.lod:
                k.cyl('stone', r + 0.05, r + 0.05, 0.42, x, 0, z, seg=10)
                break
            k.cbox('stone', 2 * math.pi * r / n - 0.01, 0.095, 0.1, x + math.cos(a) * r, 0.05 + row * 0.1, z + math.sin(a) * r, ry=-a + math.pi / 2, uvscale=2.0)
    k.cyl('stoneDark', r + 0.06, r + 0.06, 0.04, x, 0.4, z, seg=16)
    k.cyl('water', r - 0.04, r - 0.04, 0.01, x, 0.25, z, seg=12)
    if not k.lod:
        k.cyl('black', r - 0.05, r - 0.05, 0.005, x, 0.3, z, seg=12)
    for s in (-1, 1):
        k.box('darkwood', 0.06, 0.6, 0.06, x + s * (r + 0.02), 0.42, z)
    k.cyl('wood', 0.04, 0.04, 2 * r + 0.15, x - r - 0.08, 0.86, z, seg=8, rz=-math.pi / 2)
    k.cyl('rope', 0.05, 0.05, 0.14, x - 0.07, 0.86, z, seg=8, rz=-math.pi / 2)
    k.beam('iron', V(x + r + 0.07, 0.86, z), V(x + r + 0.07, 0.76, z + 0.1), 0.015)
    k.beam('rope', V(x, 0.82, z), V(x, 0.6, z), 0.008, round_=True, seg=4)
    lathe(k, 'planksDark', [(0.05, 0), (0.065, 0.1), (0.0, 0.09)], x, 0.5, z, seg=8, cap=False)
    # a little pent roof over the windlass
    for s in (-1, 1):
        k.cbox('planksDark', 2 * r + 0.25, 0.025, 0.24, x, 1.08, z + s * 0.1, rx=s * 0.55, uvscale=1.3)


def hay(k, x, z, rx_, rz_, h):
    """a loose heap of hay"""
    seg = 6 if k.lod else 12
    rings = 3 if k.lod else 5
    verts, faces = [], []
    for j in range(rings + 1):
        t = j / rings
        for i in range(seg):
            a = 2 * math.pi * i / seg
            n = 1 + 0.15 * noise.noise(V(math.cos(a) * 2 + x, t * 3, math.sin(a) * 2 + z))
            verts.append(V(x + math.cos(a) * rx_ * math.cos(t * math.pi / 2) * n, h * math.sin(t * math.pi / 2), z + math.sin(a) * rz_ * math.cos(t * math.pi / 2) * n))
    for j in range(rings):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    k.mesh('thatch', verts, faces, uvscale=1.2)


def bale(k, x, y, z, ry=0.0):
    k.box('thatch', 0.34, 0.16, 0.2, x, y, z, ry=ry, uvscale=1.4)
    if not k.lod:
        k.push(x, y, z, ry)
        for xx in (-0.08, 0.08):
            k.box('rope', 0.012, 0.165, 0.205, xx, -0.002, 0)
        k.pop()


@building('inn')
def inn(k):
    """The Inn: a coaching inn round a galleried courtyard - a two-storey main house (rendered below, timber-
    framed above) under tiles, a lodging wing with its own gallery, a thatched stable with open stalls, a well,
    tables and casks in the yard, and a gateway onto the street hung with the sign"""
    p_ = 0.12
    # ---- main house across the back
    w, d, h1, h2, zc = 4.5, 1.3, 0.95, 0.85, -1.1
    k.push(0, 0, zc)
    plinth_lo(k, w + 0.06, d + 0.06, p_)
    k.push(0, p_, 0)
    ops1 = [Op('front', 0.0, 'double', w=0.66, h=0.85), Op('front', -0.8, 'window'), Op('front', 0.8, 'window'), Op('back', -1.0, 'window', shutters=False),
            Op('back', 1.0, 'window', shutters=False), Op('left', 0.0, 'window', shutters=False), Op('right', 0.0, 'window', shutters=False), Op('front', -1.9, 'window'), Op('front', 1.9, 'window')]
    W_plastered(k, w, d, h1, 'plaster', ops1)
    k.face('front', w, d)
    lantern(k, -0.48, 0.82, 0.02)
    lantern(k, 0.48, 0.82, 0.02)
    k.pop()
    k.push(0, h1, 0)
    k.box('darkwood', w + 0.1, 0.06, d + 0.1, 0, -0.03, 0)
    ops2 = [Op('front', -0.95, 'door', w=0.4, h=0.74), Op('front', -0.4, 'window'), Op('front', 0.4, 'window'), Op('front', 0.95, 'door', w=0.4, h=0.74),
            Op('back', -1.0, 'window', shutters=False), Op('back', 1.0, 'window', shutters=False), Op('left', 0.0, 'window', shutters=False), Op('right', 0.0, 'window', shutters=False),
            Op('front', -1.85, 'window'), Op('front', 1.85, 'window')]
    W_framed(k, w, d, h2, 'plaster', ops2)
    tile_gable(k, w, d, 0.65, over=0.24, y=h2, gable='plaster', tile_len=0.25, tile_w=0.19)
    chimney(k, 1.5, -0.25, h2 - 0.1, 1.0, 0.3)
    chimney(k, -1.5, -0.25, h2 - 0.1, 1.0, 0.3)
    k.pop()
    k.pop()
    k.pop()
    zf = zc + d / 2
    # gallery along the courtyard front of the main house
    yf = p_ + h1 + 0.04
    xs, zr = veranda(k, 2.6, 0.48, yf, p_ + h1 + h2 - 0.14, zf, n_posts=5, lean_hi=p_ + h1 + h2 - 0.06, step=0.12)
    string_lights(k, (xs[0], yf + 0.5, zr + 0.03), (xs[-1], yf + 0.5, zr + 0.03), n=6, sag=0.05)
    # stair up to the gallery at its left end
    for i in range(9):
        k.box('planks', 0.3, 0.035, 0.12, -1.18, 0.1 * (i + 1), zr + 0.12 + (8 - i) * 0.105 - 0.0, uvscale=1.3)
    for s in (-1, 1):
        k.beam('darkwood', V(-1.18 + s * 0.16, 0.0, zr + 0.98), V(-1.18 + s * 0.16, yf, zr + 0.06), 0.04, 0.1)
    k.beam('darkwood', V(-1.02, 0.4, zr + 0.98), V(-1.02, yf + 0.33, zr + 0.06), 0.03)
    k.box('darkwood', 0.04, 0.4, 0.04, -1.02, 0.0, zr + 0.98)
    # ---- lodging wing on the right, gallery facing the yard
    ww, wd, wh1, wh2 = 0.9, 1.8, 0.8, 0.7
    k.push(1.8, 0, 0.32, math.pi / 2)
    plinth_lo(k, wd + 0.06, ww + 0.06, p_)
    k.push(0, p_, 0)
    wops1 = [Op('back', -0.5, 'door', h=0.72), Op('back', 0.1, 'window', shutters=False), Op('back', 0.6, 'window', shutters=False), Op('front', -0.45, 'window', shutters=False), Op('front', 0.45, 'window', shutters=False),
             Op('left', 0.0, 'window', shutters=False)]
    W_plastered(k, wd, ww, wh1, 'plaster', wops1, quoins=None)
    k.box('stone', wd + 0.06, 0.06, ww + 0.06, 0, wh1 - 0.02, 0, uvscale=2.0)
    k.push(0, wh1 + 0.04, 0)
    wops2 = [Op('back', -0.6, 'door', w=0.38, h=0.62), Op('back', 0.0, 'window', h=0.3, y=0.25, shutters=False), Op('back', 0.55, 'door', w=0.38, h=0.62),
             Op('front', -0.45, 'window', h=0.3, y=0.25), Op('front', 0.45, 'window', h=0.3, y=0.25), Op('left', 0.0, 'window', h=0.3, y=0.25, shutters=False)]
    W_plastered(k, wd, ww, wh2, 'plaster', wops2, quoins=None)
    tile_gable(k, wd, ww, 0.42, over=0.18, y=wh2, gable='plaster', tile_len=0.22, tile_w=0.16)
    k.pop()
    k.pop()
    k.pop()
    k.push(1.35, 0, 0.62, -math.pi / 2)
    wy = p_ + wh1 + 0.04
    veranda(k, 1.05, 0.42, wy, p_ + wh1 + wh2 - 0.1, 0.0, n_posts=3, lean_hi=p_ + wh1 + wh2 - 0.04, step=0.12)
    k.pop()
    # ---- the stable on the left: open stalls with half doors, hay, a manger
    sw, sd, sh = 0.9, 1.75, 1.1
    k.push(-1.8, 0, 0.32, math.pi / 2)
    k.box('stoneDark', sd + 0.04, 0.06, sw + 0.04, 0, 0, 0, uvscale=2.0)
    k.push(0, 0.06, 0)
    sops = [Op('front', -0.55, 'open', w=0.46, h=0.78, y=0.0), Op('front', 0.0, 'open', w=0.46, h=0.78, y=0.0), Op('front', 0.55, 'open', w=0.46, h=0.78, y=0.0),
            Op('left', 0.0, 'window', w=0.28, h=0.24, y=0.55, shutters=False)]
    W_board_batten(k, sd, sw, sh, 'oldplanks', sops)
    k.face('front', sd, sw)
    for xx in (-0.55, 0.0, 0.55):
        for s in (-1, 1):
            k.box('darkwood', 0.05, 0.8, 0.07, xx + s * 0.25, 0.0, -0.02)
        k.box('darkwood', 0.56, 0.06, 0.08, xx, 0.78, -0.02)
        # the half door swung open
        k.push(xx - 0.23, 0.02, 0.01, -1.2)
        for i in range(4):
            k.box('planks', 0.105, 0.42, 0.025, 0.06 + i * 0.112, 0.0, 0.0, uvscale=1.3, grain=1)
        k.beam('planks', V(0.05, 0.05, 0.02), V(0.4, 0.37, 0.02), 0.05, 0.02)
        k.pop()
    k.pop()
    # inside: stall partitions, manger and hay
    for xx in (-0.28, 0.28):
        k.box('planksDark', 0.03, 0.55, sw - 0.2, xx, 0.0, 0.0)
    k.box('planksDark', sd - 0.15, 0.25, 0.14, 0, 0.35, -sw / 2 + 0.14)
    for xx in (-0.55, 0.0, 0.55):
        hay(k, xx, -0.18, 0.18, 0.14, 0.12)
    k.box('thatch', sd - 0.2, 0.06, 0.12, 0, 0.6, -sw / 2 + 0.14)
    thatch_gable(k, sd, sw, 0.6, over=0.2, y=sh, mat='thatchDark', gable='oldplanks', res=0.06)
    k.pop()
    k.pop()
    # stable yard: bales, a trough, a saddle on the rail
    for (xx, yy, zz, r) in ((-1.15, 0.0, 1.0, 0.1), (-1.15, 0.0, 0.78, -0.05), (-1.15, 0.16, 0.9, 0.3)):
        bale(k, xx, yy, zz, math.pi / 2 + r)
    k.box('planksDark', 0.16, 0.18, 0.6, -1.17, 0, -0.05, uvscale=1.3)
    k.box('water', 0.12, 0.01, 0.55, -1.17, 0.16, -0.05)
    k.box('darkwood', 0.04, 0.04, 0.6, -1.15, 0.5, 0.42)
    for zz in (0.14, 0.7):
        k.box('darkwood', 0.04, 0.5, 0.04, -1.15, 0, zz)
    k.cbox('red', 0.2, 0.06, 0.28, -1.15, 0.54, 0.42)
    k.cbox('darkwood', 0.22, 0.03, 0.3, -1.15, 0.58, 0.42)
    # ---- the yard: well, a table, casks
    well(k, 0.35, 0.55)
    trestle(k, -0.4, 0.42, 0.8, 0.3)
    bench(k, -0.4, 0.17, 0.75)
    bench(k, -0.4, 0.67, 0.75)
    for xx in (-0.65, -0.45, -0.2):
        tankard(k, xx, 0.4, 0.42 + (k.r() - 0.5) * 0.1)
    for (xx, zz) in ((1.15, 1.0), (1.15, 1.25), (0.92, 1.12)):
        barrel(k, xx, zz, 0.85)
    barrel(k, 1.1, 0.0, 0.8, 0.0, 0.0, lying=True)
    # ---- the street front: rendered walls to a gateway, the sign, lanterns
    gz = 1.5
    for (a, b) in (((-1.35, 1.17), (-1.35, gz)), ((-1.35, gz), (-0.72, gz)), ((0.72, gz), (1.35, gz)), ((1.35, 1.17), (1.35, gz))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        cx, cz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        ry = -math.atan2(b[1] - a[1], b[0] - a[0])
        k.box('plaster', L + 0.12, 0.6, 0.12, cx, 0.0, cz, ry=ry, wuv=True)
        k.box('stone', L + 0.16, 0.05, 0.16, cx, 0.6, cz, ry=ry, uvscale=2.0)
        k.box('stoneDark', L + 0.14, 0.08, 0.14, cx, 0.0, cz, ry=ry, uvscale=2.0)
    for s in (-1, 1):
        k.box('stone', 0.22, 0.98, 0.22, s * 0.72, 0, gz, uvscale=2.0)
        k.box('stone', 0.28, 0.05, 0.28, s * 0.72, 0.98, gz, uvscale=2.0)
        k.box('stoneDark', 0.26, 0.1, 0.26, s * 0.72, 0.0, gz, uvscale=2.0)
        lathe(k, 'stone', [(0.12, 0), (0.0, 0.12)], s * 0.72, 1.03, gz, seg=4)
        k.push(s * 0.72, 0, gz + 0.12)
        lantern(k, 0, 0.82, 0.0) if s > 0 else None
        k.pop()
    hanging_sign(k, -0.72, 0.95, gz - 0.06, 'THE_INN')  # (its arm ends at the lot's front edge)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the casino

def arcade(k, xs, ys, top, z, t=0.16, mat='plaster', impost='stone', seg=10):
    """a rendered arcade: piers centred at xs (pier width pw) carrying round arches springing at ys, walling up
    to top; front face at z + t/2 (current frame)"""
    pw = 0.16
    if k.lod:
        seg = 4
    for a, b in zip(xs, xs[1:]):
        x0, x1 = a + pw / 2, b - pw / 2
        r, c = (x1 - x0) / 2, (x0 + x1) / 2
        arc = [V(c - math.cos(math.pi * i / seg) * r, ys + math.sin(math.pi * i / seg) * r, 0) for i in range(seg + 1)]
        verts, faces = [], []
        for p in arc:
            verts += [V(p.x, p.y, z + t / 2), V(p.x, top, z + t / 2), V(p.x, p.y, z - t / 2), V(p.x, top, z - t / 2)]
        for i in range(seg):
            q, n = 4 * i, 4 * (i + 1)
            faces.append((q, n, n + 1, q + 1))          # front spandrel
            faces.append((q + 2, q + 3, n + 3, n + 2))  # back spandrel
            faces.append((q, q + 2, n + 2, n))          # soffit
        k.mesh(mat, verts, faces, uvscale=0.5)
        # keystone and archivolt
        if not k.lod:
            for i in range(seg + 1):
                ang = math.pi * i / seg
                k.cbox(impost, 0.05 if i != seg // 2 else 0.09, 0.07 if i != seg // 2 else 0.12, 0.02, c - math.cos(ang) * (r + 0.03), ys + math.sin(ang) * (r + 0.03), z + t / 2 + 0.01,
                       rz=ang - math.pi / 2, uvscale=2.0)
    for x in xs:
        k.box(mat, pw, ys, t, x, 0, z, wuv=True)
        k.box(impost, pw + 0.05, 0.05, t + 0.04, x, ys - 0.05, z, uvscale=2.0)
        k.box(impost, pw + 0.06, 0.08, t + 0.05, x, 0, z, uvscale=2.0)
    k.box(impost, xs[-1] - xs[0] + pw + 0.06, 0.06, t + 0.06, (xs[0] + xs[-1]) / 2, top - 0.06, z, uvscale=2.0)


def cupola(k, x, y, z, s=0.5, mat='plaster', roof='terracotta'):
    """a little belvedere on the ridge: a rendered drum with open arches under a pyramid of tiles"""
    k.box(mat, s, 0.28, s, x, y, z, wuv=True)
    k.box('stone', s + 0.06, 0.04, s + 0.06, x, y + 0.28, z, uvscale=2.0)
    k.box('black', s - 0.12, 0.26, s - 0.12, x, y + 0.32, z)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box(mat, 0.07, 0.26, 0.07, x + sx * (s / 2 - 0.035), y + 0.32, z + sz * (s / 2 - 0.035))
    k.box('stone', s + 0.08, 0.04, s + 0.08, x, y + 0.58, z, uvscale=2.0)
    yb = y + 0.62
    hs = s / 2 + 0.07
    pv = [V(x - hs, yb, z - hs), V(x + hs, yb, z - hs), V(x + hs, yb, z + hs), V(x - hs, yb, z + hs), V(x, yb + 0.32, z)]
    convex(k, roof, pv, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 1, 2, 3)], uvscale=2.0)
    if not k.lod:
        for i in range(4):
            a = i * math.pi / 2
            k.beam('terracotta', V(x, yb + 0.33, z), V(x + math.cos(a + math.pi / 4) * hs * 1.41, yb + 0.01, z + math.sin(a + math.pi / 4) * hs * 1.41), 0.04, round_=True, seg=6)
    lathe(k, 'brass', [(0.03, 0), (0.035, 0.03), (0.0, 0.08)], x, yb + 0.31, z, seg=8)
    flagpole(k, x, z, 0.8, base=yb + 0.36)


@building('casino')
def casino(k):
    """Casino: the grandest house in the cove - a two-storey rendered palazzo with an arcaded loggia, a terrace
    over it with a turned balustrade, French doors under striped awnings, a tiled roof with a belvedere flying
    the black flag, guns at the steps and lanterns in every arch"""
    w, d, h1, h2, zb, p_ = 4.2, 1.9, 1.05, 0.95, -0.8, 0.16
    k.push(0, 0, zb)
    plinth_lo(k, w + 0.06, d + 0.06, p_)
    k.push(0, p_, 0)
    ops1 = [Op('front', 0.0, 'double', w=0.7, h=0.9), Op('front', -0.8, 'window', h=0.55, y=0.25, shutters=False), Op('front', 0.8, 'window', h=0.55, y=0.25, shutters=False),
            Op('front', -1.6, 'window', h=0.55, y=0.25, shutters=False), Op('front', 1.6, 'window', h=0.55, y=0.25, shutters=False),
            Op('left', -0.4, 'window'), Op('left', 0.4, 'window'), Op('right', -0.4, 'window'), Op('right', 0.4, 'window'),
            Op('back', -1.2, 'window', shutters=False), Op('back', 0.0, 'door', h=0.85), Op('back', 1.2, 'window', shutters=False)]
    W_plastered(k, w, d, h1, 'plasterYellow', ops1)
    win_curtains(k, w, d, ops1, 0.0, 0.063, 'red')
    k.box('stone', w + 0.08, 0.09, d + 0.08, 0, h1 - 0.02, 0, uvscale=2.0)
    k.push(0, h1 + 0.07, 0)
    fx = (-1.4, 0.0, 1.4)
    ops2 = [Op('front', x, 'open', w=0.44, h=0.74, y=0.0) for x in fx] + [Op('front', -0.7, 'window', h=0.45, y=0.3), Op('front', 0.7, 'window', h=0.45, y=0.3),
            Op('left', 0.0, 'window'), Op('right', 0.0, 'window'), Op('back', -1.2, 'window', shutters=False), Op('back', 0.0, 'window', shutters=False), Op('back', 1.2, 'window', shutters=False)]
    W_plastered(k, w, d, h2, 'plasterYellow', ops2)
    win_curtains(k, w, d, ops2, 0.0, 0.063, 'red')
    k.face('front', w, d)
    for x in fx:
        doorway(k, x, 0.44, 0.74, 0.063, drape_mat='red')
    k.pop()
    # rooms behind the French doors
    k.box('plasterPink', w - 0.3, h2 - 0.05, 0.02, 0, 0.0, d / 2 - 0.5)
    # cornice, roof, chimneys and the belvedere
    k.box('stone', w + 0.1, 0.07, d + 0.1, 0, h2 - 0.07, 0, uvscale=2.0)
    tile_gable(k, w, d, 0.78, over=0.18, y=h2, gable='plasterYellow', tile_len=0.24, tile_w=0.16)
    chimney(k, -w / 2 + 0.35, -0.3, h2 - 0.1, 1.05, 0.3)
    chimney(k, w / 2 - 0.35, -0.3, h2 - 0.1, 1.05, 0.3)
    cupola(k, 0.0, h2 + 0.55, 0.0, 0.5, 'plasterYellow')
    k.pop()
    k.pop()
    k.pop()
    zf = zb + d / 2
    # the loggia: arcade, paved floor, terrace above with a balustrade
    ld = 0.62
    xs = [-w / 2 + 0.08 + i * (w - 0.16) / 5 for i in range(6)]
    top = p_ + h1 + 0.07
    k.box('stone', w + 0.16, p_, ld + 0.08, 0, 0, zf + ld / 2, uvscale=2.0)
    arcade(k, xs, p_ + 0.62, top, zf + ld - 0.08, t=0.16, mat='plasterYellow')
    for x in xs:
        k.box('plasterYellow', 0.12, top - p_, 0.08, x, p_, zf + 0.04)
    for s in (-1, 1):
        k.push(s * (w / 2 + 0.0), 0, zf + ld / 2 - 0.02, s * math.pi / 2)
        arcade(k, [-ld / 2 + 0.06, ld / 2 - 0.1], p_ + 0.62, top, 0.0, t=0.14, mat='plasterYellow')
        k.pop()
    k.box('plasterYellow', w + 0.1, 0.07, ld, 0, top - 0.07, zf + ld / 2)
    k.box('stone', w + 0.16, 0.05, ld + 0.06, 0, top, zf + ld / 2, uvscale=2.0)
    balustrade(k, -w / 2 + 0.06, w / 2 - 0.06, zf + ld - 0.05, top + 0.05, 0.3, 'stone', 0.1, post_mat='plaster', r=0.014)
    for s in (-1, 1):
        balustrade_z(k, zf + 0.05, zf + ld - 0.08, s * (w / 2 - 0.02), top + 0.05, 0.3, 'stone', 0.1, post_mat='plaster', r=0.014)
        for zz in (zf + ld - 0.05,):
            k.box('stone', 0.12, 0.38, 0.12, s * (w / 2 - 0.02), top + 0.03, zz, uvscale=2.0)
            lathe(k, 'terracotta', [(0.04, 0), (0.07, 0.04), (0.08, 0.1), (0.075, 0.12)], s * (w / 2 - 0.02), top + 0.41, zz, seg=10)
            k.cyl('leaf', 0.07, 0.09, 0.08, s * (w / 2 - 0.02), top + 0.5, zz, seg=8)
    # striped awnings over the French doors
    for x in fx:
        awning(k, 'canvasRed', x - 0.32, x + 0.32, top + 0.8, zf + 0.02, top + 0.64, zf + 0.34, sag=0.02, valance=0.06, poles=False, nx=6, nz=3)
        for s in (-1, 1):
            k.beam('iron', V(x + s * 0.3, top + 0.52, zf + 0.01), V(x + s * 0.3, top + 0.64, zf + 0.34), 0.012)
    # lanterns hung in the arches
    for a, b in zip(xs, xs[1:]):
        c = (a + b) / 2
        k.beam('iron', V(c, p_ + 0.62 + 0.3, zf + ld - 0.08), V(c, p_ + 0.62 + 0.2, zf + ld - 0.08), 0.008, round_=True, seg=4)
        small_lantern(k, c, p_ + 0.62 + 0.2, zf + ld - 0.08, 1.2)
    # steps, guns either side, palms, the sign
    steps(k, 0, zf + ld + 0.12, 1.0, p_, 2, 'stone')
    for s in (-1, 1):
        gun(k, s * 1.05, zf + ld + 0.32, ry=0.0)
        for (dx, dy, dz) in ((0.2, 0.035, 0.6), (0.27, 0.035, 0.6), (0.235, 0.09, 0.6)):
            lathe(k, 'iron', [(0.0, -0.035), (0.03, -0.025), (0.035, 0.0), (0.03, 0.025), (0.0, 0.035)], s * (1.05 + dx), dy, zf + ld + dz, seg=8)
        potted_palm(k, s * 1.85, zf + ld + 0.3, 1.2)
        lantern_post(k, s * 0.62, zf + ld + 0.55, 1.0, ry=0.0)
    hanging_sign(k, xs[-1] + 0.05, top - 0.2, zf + ld, 'CASINO')
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- courtesan & spa

def column(k, x, z, h, r=0.06, mat='plaster', base='stone'):
    """a rendered Tuscan column: plinth block, torus base, tapered shaft, capital and abacus"""
    k.box(base, r * 2.8, 0.05, r * 2.8, x, 0, z, uvscale=2.0)
    k.cyl(base, r * 1.3, r * 1.2, 0.04, x, 0.05, z, seg=12)
    k.cyl(mat, r, r * 0.85, h - 0.17, x, 0.09, z, seg=12)
    k.cyl(base, r * 0.95, r * 1.3, 0.05, x, h - 0.1, z, seg=12)
    k.box(base, r * 2.8, 0.05, r * 2.8, x, h - 0.05, z, uvscale=2.0)


def daybed(k, x, z, ry=0.0, cover='red'):
    k.push(x, 0, z, ry)
    k.box('darkwood', 0.62, 0.16, 0.3, 0, 0.04, 0)
    for (ax, az) in ((-0.28, -0.12), (0.28, -0.12), (-0.28, 0.12), (0.28, 0.12)):
        k.cyl('darkwood', 0.018, 0.014, 0.05, ax, 0, az, seg=6)
    k.box('darkwood', 0.04, 0.2, 0.3, -0.31, 0.12, 0)
    k.box(cover, 0.6, 0.05, 0.28, 0, 0.2, 0)
    k.cbox('plasterYellow', 0.12, 0.08, 0.2, -0.22, 0.28, 0, rz=0.4)
    k.cbox('canvasPurple', 0.1, 0.07, 0.16, -0.12, 0.27, 0.04, rz=0.3, ry=0.3)
    k.pop()


@building('courtesan')
def courtesan(k):
    """Courtesan & Spa: a little rendered pavilion on a stone podium - a colonnade hung with drapes before a
    private chamber, a raised marble bath, a daybed with cushions, an incense brazier, palms and a parrot"""
    P = 0.18
    k.push(0, 0, -0.05)
    plinth_lo(k, 2.5, 2.4, P)
    k.pop()
    steps(k, 0, 1.2, 0.9, P, 2, 'stone')
    H = 1.15
    k.push(0, P, 0)
    # the private chamber at the back
    cw, cd, cz = 2.0, 0.72, -0.82
    k.push(0, 0, cz)
    ops = [Op('front', 0.0, 'open', w=0.5, h=0.85, y=0.0), Op('front', -0.62, 'window', h=0.4, y=0.32), Op('front', 0.62, 'window', h=0.4, y=0.32),
           Op('back', 0.0, 'window', shutters=False), Op('left', 0.0, 'window', w=0.24, shutters=False), Op('right', 0.0, 'window', w=0.24, shutters=False)]
    W_plastered(k, cw, cd, H, 'plasterBlue', ops, quoins=None)
    win_curtains(k, cw, cd, ops, 0.0, 0.063, 'red')
    k.face('front', cw, cd)
    doorway(k, 0.0, 0.5, 0.85, 0.063, drape_mat='canvasPurple')
    k.pop()
    k.box('red', 0.8, 0.1, 0.4, 0.0, 0.0, -0.08)  # a bed glimpsed inside
    k.pop()
    # the colonnade
    cols = [(-1.05, 0.98), (-0.38, 0.98), (0.38, 0.98), (1.05, 0.98), (-1.05, 0.28), (1.05, 0.28), (-1.05, -0.45), (1.05, -0.45)]
    for (x, z) in cols:
        column(k, x, z, H)
    # entablature round the top
    k.box('plaster', 2.3, 0.14, 0.14, 0, H, 0.98)
    for s in (-1, 1):
        k.box('plaster', 0.14, 0.14, 2.2, s * 1.05, H, -0.09)
    k.box('plaster', 2.3, 0.14, 0.14, 0, H, -1.12)
    k.box('stone', 2.42, 0.05, 2.46, 0, H + 0.14, -0.08, uvscale=2.0)
    # drapes between the front columns, tied back to each column
    for (a, b) in ((-1.05, -0.38), (-0.38, 0.38), (0.38, 1.05)):
        g = b - a - 0.12
        m = 'canvas'
        drape(k, m, a + 0.06, H - 0.01, 0.94, g * 0.48, H - 0.06, folds=3, gather=0.6, side=1)
        drape(k, m, b - 0.06, H - 0.01, 0.94, g * 0.48, H - 0.06, folds=3, gather=0.6, side=-1)
        k.beam('brass', V(a + 0.07, H - 0.02, 0.94), V(b - 0.07, H - 0.02, 0.94), 0.012, round_=True, seg=5)
    k.box('stoneDark', 2.2, 0.01, 1.4, 0, 0.0, 0.25)
    # raised bath with water and a lion-head spout
    bx, bz = 0.25, 0.42
    for (x0, z0, ww, dd) in ((bx, bz - 0.3, 1.0, 0.1), (bx, bz + 0.3, 1.0, 0.1), (bx - 0.45, bz, 0.1, 0.5), (bx + 0.45, bz, 0.1, 0.5)):
        k.box('stone', ww, 0.2, dd, x0, 0, z0, uvscale=2.0)
        k.box('plaster', ww + 0.04, 0.035, dd + 0.04, x0, 0.2, z0)
    k.box('water', 0.8, 0.16, 0.5, bx, 0.0, bz)
    if not k.lod:
        for i in range(3):
            k.cyl('bone', 0.02, 0.02, 0.006, bx - 0.2 + i * 0.15, 0.16, bz + (i - 1) * 0.08, seg=8)  # petals floating
    k.box('canvas', 0.3, 0.025, 0.2, bx + 0.25, 0.235, bz - 0.3, ry=0.1)  # towel on the rim
    # daybed, an incense brazier, a little table with wine
    daybed(k, -0.72, 0.4, math.pi / 2 + 0.1)
    k.cyl('brass', 0.07, 0.05, 0.03, -0.62, 0.0, 0.85, seg=10)
    k.cyl('brass', 0.015, 0.015, 0.3, -0.62, 0.03, 0.85, seg=6)
    lathe(k, 'brass', [(0.0, 0.0), (0.07, 0.02), (0.08, 0.06), (0.06, 0.07)], -0.62, 0.33, 0.85, seg=10, cap=False)
    k.cyl('fire', 0.05, 0.05, 0.01, -0.62, 0.38, 0.85, seg=8)
    k.marker('smoke', -0.62, 0.45, 0.85)
    k.cyl('darkwood', 0.12, 0.12, 0.025, -0.35, 0.3, -0.05, seg=12)
    k.cyl('darkwood', 0.02, 0.02, 0.3, -0.35, 0.0, -0.05, seg=6)
    bottle(k, -0.38, 0.325, -0.05, 'red')
    for i in range(2):
        lathe(k, 'brass', [(0.012, 0), (0.012, 0.04), (0.03, 0.07), (0.032, 0.09)], -0.3 + i * 0.05, 0.325, -0.02 + i * 0.04, seg=8, cap=False)
    # lanterns hung from the entablature
    for x in (-0.72, 0.72):
        k.beam('iron', V(x, H, 0.9), V(x, H - 0.12, 0.9), 0.008, round_=True, seg=4)
        small_lantern(k, x, H - 0.12, 0.9, 1.2)
    # the roof: tiles on a boarded deck
    k.push(0, 0, -0.08)
    tile_gable(k, 2.24, 2.3, 0.78, over=0.18, y=H + 0.19, gable='plaster', tile_len=0.22, tile_w=0.15)
    for sx in (-1, 1):
        quads2(k, 'plaster', [V(sx * 1.125, H + 0.19, -1.15), V(sx * 1.125, H + 0.19, 1.15), V(sx * 1.125, H + 0.19 + 0.76, 0.0)], [(0, 1, 2)])
    k.pop()
    k.pop()
    # garden: palms in tubs, a parrot on its perch, shrubs at the corners
    potted_palm(k, -0.92, 1.08, 1.0)
    potted_palm(k, 0.92, 1.08, 1.0)
    parrot_perch(k, 1.25, 0.95, 0.72)
    potted_palm(k, -1.1, -1.1, 0.9)
    potted_palm(k, 1.1, -1.1, 0.9)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the hotel

def fountain(k, x, z, r=0.32):
    """a round stone basin with a baluster-stemmed bowl and a jet of water"""
    n = 8 if k.lod else 16
    for i in range(n):
        a = i / n * math.tau
        k.cbox('stone', 2 * math.pi * r / n + 0.01, 0.2, 0.08, x + math.cos(a) * r, 0.1, z + math.sin(a) * r, ry=-a + math.pi / 2, uvscale=2.0)
    k.cyl('stone', r + 0.02, r + 0.02, 0.03, x, 0.2, z, seg=n)
    k.cyl('water', r - 0.03, r - 0.03, 0.16, x, 0.0, z, seg=n)
    lathe(k, 'stone', [(0.07, 0.0), (0.05, 0.08), (0.08, 0.2), (0.04, 0.32), (0.06, 0.36), (0.16, 0.42), (0.17, 0.45), (0.0, 0.46)], x, 0.16, z, seg=12)
    k.cyl('water', 0.14, 0.14, 0.005, x, 0.605, z, seg=12)
    k.cyl('water', 0.012, 0.004, 0.14, x, 0.61, z, seg=6)


@building('hotel')
def hotel(k):
    """Hotel: a large colonial lodging house where rich captives wait out their ransom in comfort - two rendered
    storeys wrapped on three sides by deep galleries under one great tiled roof, louvred doors onto the
    galleries, discreetly barred windows at the back, a walled front garden with a fountain and palms"""
    P = 0.16
    w, d, h1, h2 = 4.4, 2.6, 1.0, 0.95
    g = 0.6
    z0 = -0.9                    # block centre
    zf = z0 + d / 2              # block front face
    gz = zf + g                  # gallery front line
    xo = w / 2 + g               # gallery side line
    zbk = z0 - d / 2
    yu = P + h1 + 0.04           # upper gallery floor
    ytop = P + h1 + h2 + 0.06    # eaves plate
    zc = (zbk + gz) / 2
    k.push(0, 0, zc)
    plinth_lo(k, 2 * xo + 0.08, gz - zbk + 0.08, P)
    k.pop()
    k.push(0, P, z0)
    ops1 = [Op('front', 0.0, 'double', w=0.7, h=0.9)] + [Op('front', x, 'door', w=0.4, h=0.82) for x in (-1.6, 1.6)] + \
           [Op('front', x, 'window', h=0.5, y=0.25) for x in (-0.85, 0.85)] + \
           [Op('left', z, 'window', h=0.5, y=0.25) for z in (-0.6, 0.6)] + [Op('right', z, 'window', h=0.5, y=0.25) for z in (-0.6, 0.6)] + \
           [Op('back', x, 'window', bars=True, shutters=False) for x in (-1.4, 0.0, 1.4)]
    W_plastered(k, w, d, h1, 'plasterBlue', ops1)
    k.box('stone', w + 0.06, 0.07, d + 0.06, 0, h1 - 0.02, 0, uvscale=2.0)
    k.push(0, h1 + 0.05, 0)
    ops2 = [Op('front', x, 'door', w=0.4, h=0.78) for x in (-1.6, -0.55, 0.55, 1.6)] + \
           [Op('left', z, 'door', w=0.4, h=0.78) for z in (-0.6, 0.6)] + [Op('right', z, 'door', w=0.4, h=0.78) for z in (-0.6, 0.6)] + \
           [Op('back', x, 'window', bars=True, shutters=False) for x in (-1.4, 0.0, 1.4)]
    W_plastered(k, w, d, h2, 'plasterBlue', ops2)
    k.pop()
    k.pop()
    # galleries on three sides: posts, an upper deck with a balustrade, braces under the eaves
    fx = [-xo + 0.05 + i * (2 * xo - 0.1) / 6 for i in range(7)]
    sz = [gz - 0.05 - i * (gz - zbk - 0.1) / 4 for i in range(5)]
    posts = [(x, gz - 0.05) for x in fx] + [(s * (xo - 0.05), z) for s in (-1, 1) for z in sz[1:]]
    for (x, z) in posts:
        k.box('stone', 0.14, 0.05, 0.14, x, P, z, uvscale=2.0)
        k.box('darkwood', 0.08, ytop - P, 0.08, x, P, z)
        if not k.lod:
            k.box('darkwood', 0.12, 0.04, 0.12, x, yu - 0.08, z)
    # upper decks (front, and down each side)
    k.box('darkwood', 2 * xo, 0.09, 0.09, 0, yu - 0.12, gz - 0.05)
    k.push(0, 0, zf + g / 2)
    deck(k, 2 * xo - 0.04, g, yu, 'planks', along='x', joists=False)
    k.pop()
    for s in (-1, 1):
        k.box('darkwood', 0.09, 0.09, gz - zbk, s * (xo - 0.05), yu - 0.12, (gz + zbk) / 2)
        k.push(s * (w / 2 + g / 2), 0, (zf + zbk) / 2)
        deck(k, g, d, yu, 'planks', along='z', joists=False)
        k.pop()
    # soffits under the upper decks
    k.box('planksDark', 2 * xo - 0.04, 0.02, g, 0, yu - 0.065, zf + g / 2)
    for s in (-1, 1):
        k.box('planksDark', g, 0.02, d, s * (w / 2 + g / 2), yu - 0.065, z0)
    balustrade(k, -xo + 0.05, xo - 0.05, gz - 0.05, yu, 0.32, 'darkwood', 0.1)
    for s in (-1, 1):
        balustrade_z(k, zbk + 0.05, gz - 0.05, s * (xo - 0.05), yu, 0.32, 'darkwood', 0.1)
    # eaves plate and braces
    k.box('darkwood', 2 * xo + 0.04, 0.09, 0.09, 0, ytop - 0.09, gz - 0.05)
    for s in (-1, 1):
        k.box('darkwood', 0.09, 0.09, gz - zbk, s * (xo - 0.05), ytop - 0.09, (gz + zbk) / 2)
    if not k.lod:
        for (x, z) in posts:
            if abs(z - (gz - 0.05)) < 1e-3:
                for s in (-1, 1):
                    if abs(x + s * 0.2) < xo:
                        k.beam('darkwood', V(x, ytop - 0.32, z), V(x + s * 0.2, ytop - 0.1, z), 0.045)
            else:
                for s in (-1, 1):
                    if zbk < z + s * 0.2 < gz:
                        k.beam('darkwood', V(x, ytop - 0.32, z), V(x, ytop - 0.1, z + s * 0.2), 0.045)
    # one great tiled roof over house and galleries
    k.push(0, 0, zc)
    tile_gable(k, 2 * xo, gz - zbk, 1.0, over=0.22, y=ytop, gable='plasterBlue', tile_len=0.26, tile_w=0.18)
    k.pop()
    for x in (-1.3, 1.3):
        chimney(k, x, z0 - 0.4, ytop - 0.1, 1.25, 0.3)
    # lanterns at the door, the sign on the front gallery post
    k.push(0, P, zf)
    for x in (-0.5, 0.5):
        lantern(k, x, 0.85, 0.02)
    k.pop()
    hanging_sign(k, fx[4], yu - 0.12, gz - 0.02, 'HOTEL')
    steps(k, 0, gz + 0.1, 1.0, P, 2, 'stone')
    # gallery furniture: chairs, a hammock on the upper side gallery, a parrot
    for (x, z, ry) in ((-1.2, zf + 0.3, 0.3), (1.2, zf + 0.3, -0.3), (1.0, zf + 0.32, 0.2)):
        k.push(x, P, z, ry)
        k.box('darkwood', 0.22, 0.04, 0.22, 0, 0.18, 0)
        k.box('weave', 0.2, 0.02, 0.2, 0, 0.22, 0)
        k.box('darkwood', 0.22, 0.28, 0.03, 0, 0.18, -0.1, rx=-0.15)
        for (ax, az) in ((-0.09, -0.09), (0.09, -0.09), (-0.09, 0.09), (0.09, 0.09)):
            k.box('darkwood', 0.025, 0.18, 0.025, ax, 0, az)
        k.pop()
    hammock(k, (xo - 0.05, yu + 0.62, sz[1]), (xo - 0.05, yu + 0.62, sz[2]), w=0.2, sag=0.22, mat='canvasBlue')
    k.push(0, P, 0)
    parrot_perch(k, -1.95, zf + 0.32, 0.68)
    k.pop()
    # the front garden: a low rendered wall with a gateway, a flagged path, a fountain, palms and beds
    yz = 2.62
    for (a, b) in ((-2.7, -0.55), (0.55, 2.7)):
        k.box('plasterBlue', b - a, 0.42, 0.12, (a + b) / 2, 0, yz, wuv=True)
        k.box('stone', b - a + 0.04, 0.05, 0.16, (a + b) / 2, 0.42, yz, uvscale=2.0)
        k.box('stoneDark', b - a + 0.02, 0.07, 0.14, (a + b) / 2, 0, yz, uvscale=2.0)
    for s in (-1, 1):
        k.box('plasterBlue', 0.12, 0.42, yz - gz - 0.1, s * 2.7, 0, (yz + gz) / 2 + 0.05, wuv=True)
        k.box('stone', 0.16, 0.05, yz - gz - 0.06, s * 2.7, 0.42, (yz + gz) / 2 + 0.05, uvscale=2.0)
        k.box('stone', 0.22, 0.75, 0.22, s * 0.55, 0, yz, uvscale=2.0)
        lathe(k, 'terracotta', [(0.05, 0), (0.09, 0.05), (0.1, 0.12), (0.09, 0.14)], s * 0.55, 0.75, yz, seg=10)
        k.cyl('leaf', 0.08, 0.11, 0.1, s * 0.55, 0.86, yz, seg=8)
        palm_tree(k, s * 1.9, 2.05, 1.9, 0.12, math.pi / 2 - s * 0.6)
        # beds edged with stone, planted
        k.box('stoneDark', 1.2, 0.08, 0.5, s * 1.55, 0, 1.55, uvscale=2.0)
        k.box('soil', 1.12, 0.09, 0.42, s * 1.55, 0, 1.55)
        if not k.lod:
            for i in range(6):
                xx = s * (1.05 + i * 0.2)
                zz = 1.55 + (i % 2 - 0.5) * 0.15
                for j in range(6):
                    frond(k, V(xx, 0.09, zz), j / 6 * math.tau + i, 0.16, lift=1.4, droop=2.0, wd=0.05)
                lathe(k, 'red' if i % 2 else 'plasterYellow', [(0.0, 0.0), (0.03, 0.01), (0.035, 0.03), (0.0, 0.04)], xx, 0.2, zz, seg=6)
    for i in range(7):
        zz = gz + 0.35 + i * 0.22
        if not (1.85 < zz < 2.45):
            k.box('stone', 0.6 - (i % 2) * 0.05, 0.02, 0.19, (k.r() - 0.5) * 0.04, 0, zz, ry=(k.r() - 0.5) * 0.06, uvscale=2.0)
    fountain(k, 0.0, 2.15, 0.34)
    # behind: kitchen stores and a woodpile
    for i in range(3):
        barrel(k, 2.2 - i * 0.32, zbk - 0.28, 0.9)
    for i in range(12):
        r = 0.035 + k.r() * 0.01
        k.cyl('bark', r, r, 0.45, -1.8 + (i % 6) * 0.075 + (0.037 if i >= 6 else 0), (i // 6) * 0.065, zbk - 0.3 + 0.22, seg=6, rx=math.pi / 2)
    return {'ao': 1024}
