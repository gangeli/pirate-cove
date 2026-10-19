"""Industry: sawmill, iron mine, blast furnace, blacksmithy, gunsmithy, cannon foundry, brewery, distillery,
cigar factory, bakery, ration factory and the carpenter. Game coordinates (y up, +z front, 1 unit = 1 tile)."""
import math
import bmesh
from mathutils import Vector, Matrix, Euler, noise
from defs import building
from arch import *
from arch import _slope_grid

TAU = math.tau


# ------------------------------------------------------------------------------------------- helpers

import arch as _arch


def cask(k, x, z, s=1.0, y=0.0, ry=0.0, lying=False):
    """arch.cask, but a plain coopered drum in the far LOD"""
    if not k.lod:
        return _arch.cask(k, x, z, s, y, ry, lying)
    h = 0.36 * s
    if lying:
        k.push(x, y + 0.15 * s, z, ry)
        k.cyl('planksDark', 0.14 * s, 0.14 * s, h, -h / 2, 0, 0, seg=8, rz=-math.pi / 2)
        k.pop()
    else:
        k.cyl('planksDark', 0.14 * s, 0.13 * s, h, x, y, z, seg=8)


def _local(x=0, y=0, z=0, ry=0, rx=0, rz=0):
    return Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'YXZ').to_matrix().to_4x4()


def lathe(k, mat, prof, x=0, y=0, z=0, seg=16, top=True, bottom=False, rx=0, ry=0, rz=0, uvscale=1.0, sx=1.0, sz=1.0):
    """a surface of revolution about local y from a (radius, height) profile (bottom to top = outward faces)"""
    if k.lod:
        seg = max(6, seg // 2)
        if len(prof) > 5:
            prof = prof[::2] + ([prof[-1]] if (len(prof) - 1) % 2 else [])
    verts, faces = [], []
    for (r, yy) in prof:
        for i in range(seg):
            a = TAU * i / seg
            verts.append(V(math.cos(a) * r * sx, yy, math.sin(a) * r * sz))
    for j in range(len(prof) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            faces.append((a, a + seg, b + seg, b))
    n = len(prof)
    if top and prof[-1][0] > 1e-4:
        faces.append(tuple(range((n - 1) * seg, n * seg))[::-1])
    if bottom and prof[0][0] > 1e-4:
        faces.append(tuple(range(seg)))
    k.mesh(mat, verts, faces, uvscale=uvscale, local=_local(x, y, z, ry, rx, rz))


def prism(k, mat, pts, y0, y1, local=None, uvscale=1.0, bevel=0.0):
    """an extruded outline (points (x, z) in increasing-angle order) from y0 to y1"""
    n = len(pts)
    verts = [V(p[0], y0, p[1]) for p in pts] + [V(p[0], y1, p[1]) for p in pts]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))[::-1]]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, i + n, j + n, j))
    k.mesh(mat, verts, faces, uvscale=uvscale, local=local, bevel=bevel)


def frustum(k, mat, x, y, z, w0, d0, w1, d1, h, ox=0.0, oz=0.0, uvscale=1.0, bottom=True):
    """a tapering block: a w0 x d0 base at (x, y, z) rising h to a w1 x d1 top (offset ox, oz)"""
    vs = [V(x - w0 / 2, y, z - d0 / 2), V(x + w0 / 2, y, z - d0 / 2), V(x + w0 / 2, y, z + d0 / 2), V(x - w0 / 2, y, z + d0 / 2),
          V(x + ox - w1 / 2, y + h, z + oz - d1 / 2), V(x + ox + w1 / 2, y + h, z + oz - d1 / 2), V(x + ox + w1 / 2, y + h, z + oz + d1 / 2), V(x + ox - w1 / 2, y + h, z + oz + d1 / 2)]
    fs = [(4, 5, 1, 0), (5, 6, 2, 1), (6, 7, 3, 2), (7, 4, 0, 3), (7, 6, 5, 4)] + ([(0, 1, 2, 3)] if bottom else [])
    k.mesh(mat, vs, fs, uvscale=uvscale)


def rock(k, mat, x, y, z, sx, sy, sz, seed=0.0, sub=3, rough=0.22, ry=0.0, floor=None, uvscale=1.0):
    """a lumpy boulder: a displaced icosphere (floor clips the underside flat)"""
    t = bmesh.new()
    bmesh.ops.create_icosphere(t, subdivisions=max(1, sub - 2) if k.lod else max(1, sub), radius=1.0)
    t.verts.index_update()
    verts = []
    for v in t.verts:
        p = v.co.copy()
        n1 = noise.noise(p * 1.3 + Vector((seed, seed * 0.7, 3.1)))
        n2 = noise.noise(p * 3.7 + Vector((seed + 5.0, 1.0, 2.0)))
        d = 1 + rough * n1 + rough * 0.45 * n2
        q = V(p.x * sx * d, p.y * sy * d, p.z * sz * d)
        if floor is not None:
            q.y = max(q.y, floor - y)
        verts.append(q)
    faces = [[v.index for v in f.verts] for f in t.faces]
    t.free()
    k.mesh(mat, verts, faces, uvscale=uvscale, local=_local(x, y, z, ry))


def heap(k, mat, x, z, r, h, seed=0.0, rz=None, y=0.0, uvscale=1.2, lumps=0, lumpmat=None, lumpsize=0.05, sq=1.0):
    """a pile of loose stuff (ore, charcoal, spoil, sawdust): a lumpy mound, optionally strewn with lumps"""
    rings = 3 if k.lod else 6
    segs = 9 if k.lod else 18
    rz = r * sq if rz is None else rz

    def hgt(t):
        return h * max(0.0, math.cos(t * math.pi / 2)) ** 1.25

    verts = [V(0, y + h, 0)]
    for j in range(1, rings + 1):
        t = j / rings
        for i in range(segs):
            a = TAU * i / segs
            wob = 1 + 0.16 * noise.noise(Vector((math.cos(a) * 1.7, math.sin(a) * 1.7, seed))) * t
            dy = 0.025 * noise.noise(Vector((math.cos(a) * 5, math.sin(a) * 5, seed + t * 3))) * (1 - t) * h / 0.3
            verts.append(V(math.cos(a) * r * t * wob, y + hgt(t) + dy - (0.01 if j == rings else 0), math.sin(a) * rz * t * wob))
    faces = []
    for i in range(segs):
        faces.append((0, 1 + (i + 1) % segs, 1 + i))
    for j in range(rings - 1):
        for i in range(segs):
            a = 1 + j * segs + i
            b = 1 + j * segs + (i + 1) % segs
            faces.append((a + segs, a, b, b + segs))
    k.mesh(mat, verts, faces, uvscale=uvscale, local=_local(x, 0, z))
    if lumps and not k.lod:
        for i in range(lumps):
            a = k.r() * TAU
            t = math.sqrt(k.r()) * 0.92
            s = lumpsize * (0.6 + k.r() * 0.8)
            rock(k, lumpmat or mat, x + math.cos(a) * r * t, y + hgt(t) + s * 0.25, z + math.sin(a) * rz * t, s, s * 0.75, s * 0.9,
                 seed=seed + i * 1.37, sub=1, rough=0.3, ry=k.r() * 3)


def bush(k, x, y, z, s=1.0, n=20):
    """a tuft of scrub: narrow drooping blades fanning out from a root"""
    if k.lod:
        rock(k, 'leaf', x, y, z, 0.12 * s, 0.07 * s, 0.12 * s, seed=x, sub=1)
        return
    for i in range(n):
        a = TAU * i / n + k.r() * 0.5
        L = (0.14 + k.r() * 0.14) * s
        up = 0.6 + k.r() * 0.9
        dx, dz = math.cos(a), math.sin(a)
        w = 0.011 * s
        base = V(x, y, z)
        mid = base + V(dx * L * 0.5, L * up * 0.7, dz * L * 0.5)
        tip = base + V(dx * L, L * up * 0.5, dz * L)
        px, pz = -dz * w, dx * w
        vs = [base + V(px, 0, pz), base - V(px, 0, pz), mid - V(px, 0, pz), tip, mid + V(px, 0, pz)]
        k.mesh('leaf', vs, [(0, 1, 2, 3, 4), (4, 3, 2, 1, 0)])


def yard(k, w, d, mat='dirt', y=0.006, wob=0.12, seed=1.0):
    """a trodden working yard with a soft, irregular edge"""
    n = 12 if k.lod else 40
    verts = [V(0, y, 0)]
    for i in range(n):
        a = TAU * i / n
        cx, cz = math.cos(a), math.sin(a)
        # a superellipse: nearly rectangular, rounded corners
        ex, ez = (abs(cx) ** 0.35) * (1 if cx >= 0 else -1), (abs(cz) ** 0.35) * (1 if cz >= 0 else -1)
        f = 1 - wob * (0.5 + 0.5 * noise.noise(Vector((cx * 2, cz * 2, seed))))
        verts.append(V(ex * w / 2 * f, y, ez * d / 2 * f))
    faces = [(0, 1 + (i + 1) % n, 1 + i) for i in range(n)]
    k.mesh(mat, verts, faces, uvscale=0.7)


def post(k, x, z, h, s=0.11, mat='wood', pad=True, ry=0.0):
    """a squared timber post on a stone pad"""
    if pad:
        k.box('stoneDark', s + 0.07, 0.06, s + 0.07, x, 0, z, ry=ry + 0.1, uvscale=2.0)
    y0 = 0.05 if pad else 0
    k.box(mat, s, h - y0, s, x, y0, z, ry=ry, grain=1)


def log(k, x, y, z, L, r, ry=0.0, seg=10, mat='bark', end='planks'):
    """a felled trunk lying along local x, centred at (x, y, z) with sawn ends"""
    k.push(x, y, z, ry)
    k.cyl(mat, r, r * 0.93, L, -L / 2, 0, 0, seg=seg, rz=-math.pi / 2)
    if not k.lod:
        k.cyl(end, r * 0.9, r * 0.9, 0.012, -L / 2 - 0.004, 0, 0, seg=seg, rz=math.pi / 2)
        k.cyl(end, r * 0.84, r * 0.84, 0.012, L / 2 - 0.008, 0, 0, seg=seg, rz=-math.pi / 2)
    k.pop()


def board_stack(k, x, z, L, n_w, n_h, bw=0.12, bt=0.035, ry=0.0, mat='planks', bearers=True, stickers=True):
    """sawn boards in courses on bearers, with stickers between courses so they season"""
    k.push(x, 0, z, ry)
    y = 0.0
    if bearers:
        for xx in (-L * 0.38, 0, L * 0.38):
            k.box('darkwood', 0.07, 0.07, n_w * (bw + 0.012) + 0.1, xx, 0, 0)
        y = 0.07
    if k.lod:
        k.box(mat, L, n_h * (bt + 0.012), n_w * (bw + 0.012), 0, y, 0, uvscale=1.3)
        k.pop()
        return
    for j in range(n_h):
        for i in range(n_w):
            zz = -n_w * (bw + 0.012) / 2 + (i + 0.5) * (bw + 0.012)
            jit = (k.r() - 0.5) * 0.06
            k.box(mat, L + jit, bt, bw, jit / 2 + (k.r() - 0.5) * 0.03, y, zz + (k.r() - 0.5) * 0.008, ry=(k.r() - 0.5) * 0.02, uvscale=1.3)
        y += bt
        if stickers and j < n_h - 1:
            for xx in (-L * 0.38, 0, L * 0.38):
                k.box('wood', 0.025, 0.012, n_w * (bw + 0.012), xx, y, 0)
            y += 0.012
    k.pop()


def stone_face(k, L, h, mat='stone', sh=0.12, sw=(0.11, 0.2), alt='coral', y0=0.0, out=0.0):
    """coursed rubble stones on a face of the current frame (x along it, z outward)"""
    if k.lod:
        return
    rows = max(1, round(h / sh))
    rh = h / rows
    for r in range(rows):
        x = -L / 2 + (sw[0] * 0.5 if r % 2 else 0)
        first = True
        while x < L / 2 - 0.02:
            w = min(L / 2 - x, sw[0] + k.r() * sw[1])
            if first and r % 2:
                w = sw[0] * 0.5
            first = False
            m = alt if (alt and k.r() < 0.2) else mat
            hh = rh * (0.7 + k.r() * 0.3)
            k.cbox(m, w - 0.014, hh - 0.012, 0.05 + k.r() * 0.02, x + w / 2, y0 + r * rh + rh / 2 + (k.r() - 0.5) * (rh - hh), out - 0.014,
                   ry=(k.r() - 0.5) * 0.08, rx=(k.r() - 0.5) * 0.12, rz=(k.r() - 0.5) * 0.16, uvscale=2.0)
            if hh < rh * 0.85 and w > 0.1 and k.r() < 0.6:
                # a pinning spall in the bed joint
                k.cbox(mat, w * 0.5, rh - hh - 0.01, 0.04, x + w * (0.3 + k.r() * 0.4) / 1, y0 + r * rh + (rh - hh) / 2 if k.r() < 0.5 else y0 + r * rh + rh - (rh - hh) / 2, out - 0.02, rz=(k.r() - 0.5) * 0.3, uvscale=2.0)
            x += w


def rubble_wall(k, x, z, L, h, t=0.2, ry=0.0, mat='stone', ends=True, cope=True, faces=('front', 'back')):
    """a free-standing coursed rubble wall along local x, with a mortar core and a coping"""
    k.push(x, 0, z, ry)
    k.box('stoneDark' if not k.lod else mat, L - 0.02, h, t - 0.03, 0, 0, 0, uvscale=2.0, wuv=True, bevel=0.0)
    if 'front' in faces:
        k.push(0, 0, t / 2)
        stone_face(k, L, h, mat)
        k.pop()
    if 'back' in faces:
        k.push(0, 0, -t / 2, math.pi)
        stone_face(k, L, h, mat)
        k.pop()
    if ends:
        for s in (-1, 1):
            k.push(s * L / 2, 0, 0, s * math.pi / 2)
            stone_face(k, t, h, mat, sw=(0.07, 0.08))
            k.pop()
    if cope:
        k.box('stoneDark', L + 0.03, 0.05, t + 0.04, 0, h, 0, uvscale=2.0)
    k.pop()


def brick_face(k, L, h, mat='terracotta', bl=0.11, bh=0.05, y0=0.0):
    """English-bond-ish brick courses on a face of the current frame"""
    if k.lod:
        return
    rows = max(1, round(h / bh))
    rh = h / rows
    for r in range(rows):
        x = -L / 2
        off = bl * 0.5 if r % 2 else 0.0
        if off:
            k.cbox(mat, off - 0.008, rh - 0.009, 0.03, x + off / 2, y0 + r * rh + rh / 2, -0.008, uvscale=2.5, bevel=0.0)
            x += off
        while x < L / 2 - 0.01:
            w = min(bl, L / 2 - x)
            k.cbox(mat, w - 0.008, rh - 0.009, 0.03 + k.r() * 0.006, x + w / 2, y0 + r * rh + rh / 2, -0.008,
                   ry=(k.r() - 0.5) * 0.03, uvscale=2.5, bevel=0.0)
            x += w


def brick_block(k, x, z, w, h, d, top='stoneDark', core='stoneDark', faces=FACES):
    """a solid brick mass (hearth, furnace base) with a dressed top"""
    k.push(x, 0, z)
    k.box(core, w - 0.02, h, d - 0.02, 0, 0, 0, uvscale=2.0)
    if k.lod:
        k.box('terracotta', w, h, d, 0, 0, 0, uvscale=2.0)
    for f in faces:
        L = w if f in ('front', 'back') else d
        k.face(f, w, d)
        brick_face(k, L, h)
        k.pop()
    if top:
        k.box(top, w + 0.04, 0.05, d + 0.04, 0, h, 0, uvscale=2.0)
    k.pop()


def open_frame(k, xs, zs, h, s=0.12, mat='wood', plate='darkwood', braces=True, ties=True):
    """a post-and-plate frame: posts at the grid xs x zs, wall plates along x, tie beams along z, knee braces"""
    for x in xs:
        for z in zs:
            post(k, x, z, h, s, mat)
    x0, x1 = min(xs), max(xs)
    z0, z1 = min(zs), max(zs)
    for z in zs:
        k.box(plate, x1 - x0 + 0.24, 0.1, s + 0.02, (x0 + x1) / 2, h - 0.02, z)
    if ties:
        for x in xs:
            k.box(plate, s + 0.02, 0.09, z1 - z0 + 0.2, x, h - 0.1, (z0 + z1) / 2)
    if braces and not k.lod:
        for x in xs:
            for z in zs:
                for sx in (-1, 1):
                    if x0 - 0.01 < x + sx * 0.3 < x1 + 0.01:
                        k.beam(mat, V(x, h - 0.38, z), V(x + sx * 0.3, h - 0.06, z), 0.055)


def shingles(k, w, z0, z1, hi, lo, mat='planksDark', sl=0.2, sw=0.15, rafters=True):
    """riven wooden shingles laid in staggered, slightly ragged courses on a slope from (z0, hi) down to (z1, lo)"""
    dz, dy = z1 - z0, lo - hi
    L = math.hypot(dz, dy)
    ang = math.atan2(-dy, dz)
    if k.lod:
        k.cbox(mat, w, 0.05, L + 0.04, 0, (hi + lo) / 2 + 0.02, (z0 + z1) / 2, rx=ang, uvscale=1.2)
    else:
        k.push(0, hi, z0, 0, ang)   # local z runs down the slope, y is the roof normal
        k.box('planksDark', w - 0.02, 0.012, L, 0, -0.012, L / 2, bevel=0.0, uvscale=1.0)
        gap = sl * 0.45
        rows = max(2, math.ceil((L - sl) / gap) + 1)
        for r in range(rows):
            zz = min(L - sl / 2, sl / 2 + r * gap) if r < rows - 1 else L - sl / 2
            x = -w / 2 + (sw * 0.5 if r % 2 else 0)
            if r % 2:
                k.cbox(mat, sw * 0.5 - 0.008, 0.016, sl, -w / 2 + sw * 0.25, 0.006 + r * 0.0005, zz, rx=-0.05, uvscale=1.4, bevel=0.0)
            while x < w / 2 - 0.02:
                ww = min(w / 2 - x, sw * (0.7 + k.r() * 0.6))
                k.cbox(mat, ww - 0.01, 0.016, sl * (0.93 + k.r() * 0.1), x + ww / 2, 0.006 + r * 0.0005 + k.r() * 0.004, zz + (k.r() - 0.5) * 0.02,
                       rx=-0.05, ry=(k.r() - 0.5) * 0.06, uvscale=1.4, bevel=0.0)
                x += ww
        k.pop()
    if rafters and not k.lod:
        n = max(2, round(w / 0.5))
        for i in range(n + 1):
            xx = -w / 2 + 0.06 + i * (w - 0.12) / n
            k.beam('darkwood', V(xx, hi - 0.05, z0), V(xx, lo - 0.05, z1 - 0.02), 0.055)


def shingle_gable(k, w, d, rise, h, over=0.22, mat='planksDark', gable='planks', gable_kind='boards'):
    """a wooden-shingle gable roof (two lean-tos meeting at a ridge) on a frame of width w (x) and depth d (z)"""
    for s in (-1, 1):
        k.push(0, 0, 0, 0 if s > 0 else math.pi)
        shingles(k, w + 2 * over * 0.7, 0.0, d / 2 + over, h + rise, h - over * rise / (d / 2), mat=mat)
        k.pop()
    k.beam('darkwood', V(-w / 2 - over * 0.7, h + rise + 0.03, 0), V(w / 2 + over * 0.7, h + rise + 0.03, 0), 0.09, 0.07)
    if gable:
        gables(k, w, d, rise, h, gable, gable_kind, barge=True)


def wheel(k, x, y, z, r=0.3, ry=0.0, rx=0.0, spokes=10, t=0.05, tyre=True):
    """a wooden cart/gun-carriage wheel in the local xy plane: hub, spokes, felloes, iron tyre"""
    k.push(x, y, z, ry, rx)
    k.cyl('darkwood', 0.055 * r / 0.3, 0.05 * r / 0.3, t * 2.2, 0, 0, -t * 1.1, seg=10, rx=math.pi / 2)
    n = 6 if k.lod else spokes
    for i in range(n):
        a = TAU * i / n
        k.beam('wood', V(math.cos(a) * 0.04, math.sin(a) * 0.04, 0), V(math.cos(a) * (r - 0.03), math.sin(a) * (r - 0.03), 0), 0.025, 0.018)
    seg = 10 if k.lod else 20
    for i in range(seg):
        a0, a1 = TAU * i / seg, TAU * (i + 1) / seg
        k.beam('wood', V(math.cos(a0) * (r - 0.025), math.sin(a0) * (r - 0.025), 0), V(math.cos(a1) * (r - 0.025), math.sin(a1) * (r - 0.025), 0), 0.045, t)
    if tyre:
        k.torus('iron', r, 0.013, 0, 0, 0, rx=math.pi / 2, seg=seg, rseg=4)
    k.pop()


def horseshoe(k, x, y, z, s=0.05, ry=0.0):
    if k.lod:
        return
    k.push(x, y, z, ry)
    n = 7
    for i in range(n):
        a0 = -0.25 + (math.pi + 0.5) * i / n
        a1 = -0.25 + (math.pi + 0.5) * (i + 1) / n
        k.beam('iron', V(math.cos(a0) * s, math.sin(a0) * s * 1.1, 0), V(math.cos(a1) * s, math.sin(a1) * s * 1.1, 0), 0.016, 0.008)
    k.pop()


def tongs(k, x, y, z, L=0.32, ry=0.0):
    """smith's tongs hanging jaws down"""
    k.push(x, y, z, ry)
    for s in (-1, 1):
        k.beam('iron', V(s * 0.012, 0, 0), V(s * 0.005, -L * 0.75, 0.0), 0.011)
        k.beam('iron', V(s * 0.005, -L * 0.75, 0.0), V(-s * 0.012, -L, 0.0), 0.012)
    k.pop()


def hammer(k, x, y, z, ry=0.0, rx=0.0, L=0.24, head=0.07, sledge=False):
    k.push(x, y, z, ry, rx)
    k.beam('wood', V(0, 0, 0), V(L, 0, 0), 0.018, round_=True, seg=5)
    hw = head * (1.6 if sledge else 1.0)
    k.cbox('iron', 0.032 * (1.5 if sledge else 1), 0.032 * (1.5 if sledge else 1), hw, L, 0, 0)
    k.pop()


def anvil(k, x, z, ry=0.0, y=0.0, s=1.0):
    """a London-pattern anvil: feet, waist, body with a steel face, a horn and a heel with the hardy hole"""
    k.push(x, y, z, ry)
    k.box('iron', 0.2 * s, 0.035 * s, 0.13 * s, 0, 0, 0)
    frustum(k, 'iron', 0, 0.035 * s, 0, 0.18 * s, 0.11 * s, 0.1 * s, 0.07 * s, 0.065 * s, bottom=False)
    k.box('iron', 0.24 * s, 0.07 * s, 0.085 * s, -0.01 * s, 0.1 * s, 0)
    k.box('iron', 0.25 * s, 0.012 * s, 0.088 * s, -0.01 * s, 0.17 * s, 0, bevel=0.002)  # the face
    # horn: a cone running out to a point
    k.cyl('iron', 0.042 * s, 0.006 * s, 0.14 * s, 0.11 * s, 0.14 * s, 0, seg=10, rz=-math.pi / 2)
    k.box('black', 0.018 * s, 0.002, 0.018 * s, -0.1 * s, 0.182 * s, 0)
    k.pop()


def tub(k, x, z, r=0.17, h=0.26, fill='water', y=0.0, hoops=2):
    """a coopered tub: tapered staves, iron hoops and its contents"""
    prof = [(r * 0.88, 0), (r, h), (r - 0.02, h), (r * 0.86 - 0.02, 0.03)]
    lathe(k, 'planksDark', prof, x, y, z, seg=16, top=False, bottom=False, uvscale=1.4)
    k.cyl(fill, r * 0.95 - 0.02, r * 0.95 - 0.02, 0.01, x, y + h * 0.8, z, seg=16)
    for t in ([0.18, 0.8] if hoops == 2 else [0.15, 0.5, 0.85]):
        k.torus('iron', r * (0.88 + 0.12 * t) + 0.004, 0.006, x, y + h * t, z, seg=16, rseg=3)


def bucket(k, x, z, y=0.0, s=1.0):
    tub(k, x, z, 0.075 * s, 0.13 * s, 'water', y)
    if not k.lod:
        k.beam('iron', V(x - 0.075 * s, y + 0.13 * s, z), V(x, y + 0.2 * s, z), 0.006)
        k.beam('iron', V(x, y + 0.2 * s, z), V(x + 0.075 * s, y + 0.13 * s, z), 0.006)


def bar_stack(k, x, z, n=12, L=0.42, ry=0.0, mat='iron'):
    """pig iron or bar stock, crib stacked"""
    k.push(x, 0, z, ry)
    for j in range(3 if not k.lod else 1):
        for i in range(n // 3):
            if j % 2 == 0:
                k.box(mat, L, 0.045, 0.06, 0, j * 0.046, -0.12 + i * 0.075, ry=(k.r() - 0.5) * 0.05)
            else:
                k.box(mat, 0.06, 0.045, L * 0.7, -0.15 + i * 0.1, j * 0.046, 0, ry=(k.r() - 0.5) * 0.05)
    if k.lod:
        k.box(mat, L, 0.14, 0.3, 0, 0, 0)
    k.pop()


def lean_roof_posts(k, w, z_back, z_front, hi, lo, xs, mat='planksDark', s=0.11):
    """front posts and plate for a lean-to falling from z_back (hi) to z_front (lo)"""
    for x in xs:
        post(k, x, z_front - 0.12, lo - 0.08, s)
        if not k.lod:
            for sx in (-1, 1):
                if min(xs) - 0.01 < x + sx * 0.28 < max(xs) + 0.01:
                    k.beam('wood', V(x, lo - 0.42, z_front - 0.12), V(x + sx * 0.28, lo - 0.13, z_front - 0.12), 0.05)
    k.box('darkwood', max(xs) - min(xs) + 0.3, 0.1, s + 0.03, (max(xs) + min(xs)) / 2, lo - 0.17, z_front - 0.12)


# ------------------------------------------------------------------------------------------- blacksmithy

@building('blacksmithy')
def blacksmithy(k):
    """a smithy: an open forge under a shingled lean-to against a rubble back wall, brick hearth with
    glowing coals under a hood and an outside stack, great leather bellows on a rocker, anvil on a stump,
    quench tub, tongs and hammers on a rack, horseshoes, a wheel waiting for its tyre and a rack of cutlasses"""
    W, D = 3.0, 3.0
    yard(k, 2.8, 2.8, seed=3.0)
    zb = -1.0                       # front face of the back wall
    wt = 0.22
    rubble_wall(k, 0, zb - wt / 2, 2.55, 1.5, wt)
    # left cheek wall, stepping down toward the front
    rubble_wall(k, -1.16, -0.55, 0.7, 1.1, 0.2, ry=math.pi / 2, cope=True)
    # lean-to: high on the back wall, falling to the front posts
    hi, lo, zf = 1.48, 1.08, 0.75
    lean_roof_posts(k, 2.5, zb, zf, hi, lo, [-1.1, 0.05, 1.15])
    k.box('darkwood', 2.56, 0.08, 0.1, 0, hi - 0.16, zb + 0.05)  # wall plate corbelled on the back wall
    shingles(k, 2.75, zb - 0.02, zf + 0.12, hi + 0.02, lo - 0.08)

    # --- the hearth: a brick forge with a stone top, a firepot of coals and a hood carrying the flue up the wall
    hx, hz, hw, hd, hh = -0.4, zb + 0.32, 0.86, 0.62, 0.56
    brick_block(k, hx, hz, hw, hh, hd, faces=('front', 'left', 'right'))
    k.box('black', 0.46, 0.012, 0.36, hx, hh + 0.05, hz + 0.02)
    if not k.lod:
        for i in range(26):
            k.cbox('fire' if k.r() < 0.55 else 'black', 0.05 + k.r() * 0.03, 0.025, 0.05 + k.r() * 0.03,
                   hx + (k.r() - 0.5) * 0.36, hh + 0.065, hz + 0.02 + (k.r() - 0.5) * 0.26, ry=k.r() * 3)
        # a tuyere stub from the bellows side
        k.cyl('iron', 0.03, 0.03, 0.2, hx - hw / 2 - 0.02, hh - 0.08, hz, seg=8, rz=-math.pi / 2)
        # a bar heating in the coals and a poker
        k.beam('iron', V(hx + 0.05, hh + 0.08, hz), V(hx + 0.62, hh + 0.13, hz + 0.25), 0.022)
        k.beam('iron', V(hx - 0.2, hh + 0.07, hz + 0.1), V(hx - 0.32, hh + 0.12, hz + 0.45), 0.014)
    k.marker('glow:0.42x0.05x0.32', hx, hh + 0.075, hz + 0.02)
    # hood: a tapering smoke hood of sooty plaster on an iron bearer, into the wall
    hy0, hy1 = 0.98, 1.3
    hdp = hz + 0.3 - zb
    frustum(k, 'plaster', hx, hy0, zb + hdp / 2, 0.88, hdp, 0.4, 0.16, hy1 - hy0, oz=-hdp / 2 + 0.08, uvscale=1.5)
    k.box('iron', 0.94, 0.03, 0.03, hx, hy0 - 0.03, hz + 0.3)
    k.box('black', 0.8, 0.01, 0.4, hx, hy0 - 0.005, (zb + hz + 0.3) / 2)
    # the stack, built outside the back wall and rising clear of the roof
    chimney(k, hx, zb - wt - 0.1, 0.0, 2.6, 0.42)

    # --- great bellows on a cradle beside the hearth, worked by a rocking pole
    bx, bz = -0.98, zb + 0.32
    for zz in (-0.2, 0.22):
        k.box('wood', 0.3, 0.06, 0.06, bx, 0.38, bz + zz)
        for sx in (-1, 1):
            k.box('wood', 0.05, 0.38, 0.05, bx + sx * 0.12, 0, bz + zz)
    bell_pts = []
    for i in range(14):
        a = TAU * i / 14
        r = 0.16 * (1 + 0.85 * max(0.0, -math.cos(a)) ** 1.5)
        bell_pts.append((math.sin(a) * r * 0.9, math.cos(a) * r * 1.3))  # local (x, z): nozzle toward +z
    bell_pts.reverse()  # increasing-angle order so the boards face outward
    # the bellows lie along +x into the hearth: rotate the outline a quarter turn
    loc = _local(bx + 0.08, 0.44, bz, ry=math.pi / 2)
    prism(k, 'planksDark', bell_pts, 0.0, 0.03, local=loc, uvscale=1.3)
    k.push(bx + 0.08, 0.44, bz, math.pi / 2)
    if not k.lod:
        # leather sides, pleated
        for j in range(3):
            y0 = 0.03 + j * 0.045
            sc = 1.0 - 0.05 * (j % 2)
            prism(k, 'soil', [(x * sc * 0.97, z * sc * 0.97) for (x, z) in bell_pts], y0, y0 + 0.045, uvscale=1.0)
    else:
        prism(k, 'soil', [(x * 0.95, z * 0.95) for (x, z) in bell_pts], 0.03, 0.165)
    k.pop()
    prism(k, 'planksDark', bell_pts, 0.165, 0.195, local=_local(bx + 0.08, 0.44, bz, ry=math.pi / 2, rx=0.0), uvscale=1.3)
    # brass-bound nozzle into the tuyere
    k.cyl('brass', 0.028, 0.016, 0.2, bx + 0.32, 0.5, bz, seg=8, rz=-math.pi / 2)
    # the rocker: an upright with a pole pivoting across it, chained to the top board, a handle hanging at the front
    k.box('wood', 0.07, 1.25, 0.07, bx - 0.16, 0, bz + 0.5)
    k.beam('wood', V(bx - 0.2, 1.08, bz - 0.25), V(bx - 0.12, 1.2, bz + 0.9), 0.05, round_=True)
    k.beam('iron', V(bx - 0.16, 1.1, bz - 0.05), V(bx + 0.02, 0.64, bz - 0.05), 0.008, round_=True, seg=4)
    k.beam('rope', V(bx - 0.12, 1.2, bz + 0.88), V(bx - 0.12, 0.8, bz + 0.9), 0.012, round_=True, seg=4)
    k.cyl('wood', 0.018, 0.018, 0.12, bx - 0.12, 0.74, bz + 0.9, seg=6)

    # --- anvil on its stump, hammer resting on the face; quench tub and slack bucket
    ax, az = 0.4, 0.22
    k.cyl('bark', 0.15, 0.17, 0.34, ax, 0, az, seg=12)
    k.cyl('planks', 0.145, 0.145, 0.012, ax, 0.338, az, seg=12)
    for i in range(4 if not k.lod else 0):
        a = TAU * i / 4 + 0.4
        k.box('iron', 0.012, 0.012, 0.06, ax + math.cos(a) * 0.15, 0.3, az + math.sin(a) * 0.15, ry=-a)
    anvil(k, ax, az, ry=0.35, y=0.35, s=1.15)
    if not k.lod:
        hammer(k, ax - 0.1, 0.565, az + 0.06, ry=2.2)
        hammer(k, ax + 0.05, 0.36, az + 0.18, ry=-0.4, L=0.4, sledge=True, rx=0.0)
    tub(k, 0.25, -0.58, 0.2, 0.3)
    bucket(k, 0.62, -0.62)

    # --- tool rack on the back wall: tongs, hammers, a rasp
    k.box('darkwood', 0.95, 0.06, 0.05, 0.62, 1.06, zb + 0.03)
    if not k.lod:
        for i in range(5):
            tongs(k, 0.24 + i * 0.09, 1.04, zb + 0.07, L=0.36 - (i % 2) * 0.06)
        for i in range(3):
            k.cyl('iron', 0.008, 0.008, 0.06, 0.74 + i * 0.12, 1.07, zb + 0.06, seg=5, rx=math.pi / 2)
            k.push(0.74 + i * 0.12, 1.06, zb + 0.08)
            k.beam('wood', V(0, 0, 0), V(0, -0.24, 0), 0.016, round_=True, seg=5)
            k.cbox('iron', 0.07 + i * 0.01, 0.03, 0.03, 0, -0.25, 0)
            k.pop()
    # --- horseshoes nailed over the front post and hung on a peg board
    for i in range(3):
        horseshoe(k, 0.05, 0.62 + i * 0.12, zf - 0.05, 0.045)
    for i in range(4):
        horseshoe(k, 1.15 + 0.065, 0.35 + i * 0.13, zf - 0.12, 0.04, ry=math.pi / 2)
    # --- a cart wheel leaning on the cheek wall awaiting a tyre, iron hoops on the ground
    wheel(k, -1.33, 0.37, -0.5, 0.36, ry=math.pi / 2, rx=0.12, tyre=False)
    # --- charcoal bin and stock
    k.box('oldplanks', 0.04, 0.3, 0.6, 1.14, 0, -0.36)
    k.box('oldplanks', 0.04, 0.22, 0.6, 0.56, 0, -0.36)
    k.box('oldplanks', 0.6, 0.3, 0.04, 0.85, 0, -0.66)
    k.box('oldplanks', 0.6, 0.18, 0.04, 0.85, 0, -0.06)
    heap(k, 'black', 0.85, -0.37, 0.27, 0.3, seed=2.0, lumps=14, lumpsize=0.035, sq=1.05)
    bar_stack(k, 0.82, 0.62, 9, 0.5, ry=0.3)
    # --- a rack of new cutlasses at the front for the buyers
    k.push(-0.45, 0, 0.95, 0.0)
    k.box('darkwood', 0.62, 0.05, 0.06, 0, 0.36, 0)
    for sx in (-1, 1):
        k.box('darkwood', 0.05, 0.36, 0.14, sx * 0.29, 0, 0)
    for i in range(5):
        x = -0.22 + i * 0.11
        k.push(x, 0.0, 0.0, 0, 0.0, (k.r() - 0.5) * 0.08)
        k.mesh('iron', [V(-0.004, 0.03, 0), V(0.016, 0.0, 0), V(0.016, 0.42, 0), V(-0.016, 0.42, 0)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        k.cbox('brass', 0.08, 0.014, 0.03, 0.0, 0.43, 0.0)
        k.cbox('darkwood', 0.022, 0.085, 0.022, 0.0, 0.48, 0.0)
        k.cyl('brass', 0.014, 0.014, 0.02, 0.0, 0.52, 0.0, seg=6)
        if not k.lod:
            k.beam('brass', V(0.04, 0.44, 0), V(0.035, 0.52, 0), 0.008)
        k.pop()
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- more props

def musket(k, x, y, z, ry=0.0, rx=0.0, rz=0.0, L=0.8):
    """a flintlock musket standing on its butt along local +y"""
    k.push(x, y, z, ry, rx, rz)
    k.mesh('darkwood', [V(-0.012, 0, -0.035), V(-0.012, 0, 0.03), V(-0.012, 0.2, 0.012), V(-0.012, 0.2, -0.008),
                        V(0.012, 0, -0.035), V(0.012, 0, 0.03), V(0.012, 0.2, 0.012), V(0.012, 0.2, -0.008)],
           [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], uvscale=1.5)
    k.box('darkwood', 0.022, L * 0.62, 0.022, 0, 0.2, 0.0)
    k.cyl('iron', 0.009, 0.008, L - 0.16, 0, 0.16, 0.012, seg=6)
    if not k.lod:
        k.box('brass', 0.026, 0.008, 0.07, 0, -0.004, -0.002)
        k.box('iron', 0.006, 0.05, 0.022, 0.013, 0.22, 0.004)
        k.box('iron', 0.004, 0.025, 0.012, 0.016, 0.26, 0.016, rx=0.4)
        for t in (0.45, 0.62, 0.78):
            k.box('brass', 0.026, 0.01, 0.03, 0, L * t, 0.006)
        k.beam('wood', V(0, 0.32, -0.015), V(0, L - 0.04, -0.015), 0.008, round_=True, seg=4)
    k.pop()


def cannon_barrel(k, x, y, z, ry=0.0, s=1.0, mat='iron', rz=-math.pi / 2, rx=0.0):
    """a cast gun barrel: cascabel, reinforces, trunnions, muzzle swell and a bore (lies along local +x)"""
    prof = [(0.005, -0.075), (0.026, -0.072), (0.03, -0.058), (0.016, -0.042), (0.055, -0.024), (0.092, -0.004), (0.1, 0.03),
            (0.1, 0.06), (0.091, 0.068), (0.09, 0.3), (0.096, 0.31), (0.096, 0.335), (0.083, 0.345), (0.076, 0.62), (0.082, 0.63),
            (0.082, 0.65), (0.07, 0.66), (0.065, 0.85), (0.076, 0.875), (0.079, 0.915), (0.071, 0.94), (0.042, 0.94), (0.042, 0.84)]
    prof = [(r * s, h * s) for (r, h) in prof]
    k.push(x, y, z, ry)
    lathe(k, mat, prof, 0, 0, 0, seg=16, top=True, rz=rz, rx=rx, uvscale=1.0)
    k.push(0, 0, 0, 0, rx, rz)
    k.cyl(mat, 0.032 * s, 0.032 * s, 0.26 * s, 0, 0.42 * s, -0.13 * s, seg=8, rx=math.pi / 2)
    k.pop()
    k.pop()


def gun_carriage(k, x, z, ry=0.0, s=1.0):
    """a truck carriage: two cheeks, axletrees, four small trucks, and a gun on it"""
    k.push(x, 0, z, ry)
    for sx in (-1, 1):
        k.box('planks', 0.05 * s, 0.26 * s, 0.37 * s, sx * 0.16 * s, 0.07 * s, 0.135 * s, uvscale=1.4)
        k.box('planks', 0.05 * s, 0.17 * s, 0.32 * s, sx * 0.16 * s, 0.07 * s, -0.25 * s, uvscale=1.4)
        k.box('planks', 0.05 * s, 0.26 * s, 0.05 * s, sx * 0.16 * s, 0.07 * s, 0.295 * s)
        k.box('planks', 0.05 * s, 0.1 * s, 0.7 * s, sx * 0.16 * s, 0.07 * s, -0.05 * s)
        for zz in (-0.3, 0.2):
            k.push(sx * 0.21 * s, 0.075 * s, zz * s, math.pi / 2)
            k.cyl('darkwood', 0.075 * s, 0.075 * s, 0.05 * s, 0, 0, -0.025 * s, seg=12, rx=math.pi / 2)
            k.pop()
    for zz in (-0.3, 0.2):
        k.box('darkwood', 0.46 * s, 0.05 * s, 0.07 * s, 0, 0.05 * s, zz * s)
    cannon_barrel(k, 0, 0.34 * s, -0.3 * s, ry=-math.pi / 2, s=s * 0.95)
    k.pop()


def pot_still(k, x, z, s=1.0, y=0.0, arm=(0.6, -0.35, 0.0)):
    """a copper pot still: an onion-bellied pot, a domed helmet and a swan neck dropping into a lyne arm"""
    prof = [(0.2, 0), (0.28, 0.06), (0.31, 0.16), (0.3, 0.28), (0.24, 0.38), (0.13, 0.43), (0.1, 0.47), (0.13, 0.5), (0.16, 0.56),
            (0.15, 0.64), (0.1, 0.69), (0.05, 0.72), (0.04, 0.82)]
    prof = [(r * s, h * s) for (r, h) in prof]
    lathe(k, 'brass', prof, x, y, z, seg=20, top=True, uvscale=1.5)
    if not k.lod:
        for t in (0.06, 0.28):
            k.torus('brass', 0.3 * s * (1.0 if t > 0.1 else 0.93), 0.008 * s, x, y + (t + 0.02) * s, z, seg=20, rseg=3)
        # rivet seam
        for i in range(12):
            a = TAU * i / 12
            k.cyl('brass', 0.009 * s, 0.009 * s, 0.01 * s, x + math.cos(a) * 0.305 * s, y + 0.2 * s, z + math.sin(a) * 0.305 * s, seg=5)
    # swan neck curving over and down into the lyne arm
    p0 = V(x, y + 0.8 * s, z)
    p1 = V(x + arm[0] * 0.25 * s, y + 0.9 * s, z + arm[2] * 0.25 * s)
    p2 = V(x + arm[0] * s, y + (0.8 + arm[1]) * s, z + arm[2] * s)
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t)
    for i in range(8):
        k.beam('brass', pts[i], pts[i + 1], 0.05 * s * (1 - i * 0.06), round_=True, seg=8)
    return p2


def stillage(k, x, z, n=4, rows=2, ry=0.0, s=0.9):
    """casks lying on a timber stillage, a second row nested in the cradle of the first"""
    k.push(x, 0, z, ry)
    L = n * 0.3 * s
    for zz in (-0.1 * s, 0.1 * s):
        k.box('darkwood', L + 0.1, 0.07, 0.06, 0, 0, zz)
    for r in range(rows):
        m = n - r
        for i in range(m):
            xx = -L / 2 + 0.15 * s + (i + r * 0.5) * 0.3 * s
            cask(k, xx, 0.0, s, y=0.05 + r * 0.24 * s, ry=math.pi / 2, lying=True)
    k.pop()


def leaf_bunch(k, x, y, z, n=8, L=0.17, mats=('thatch',), spread=0.5, ry=0.0):
    """tobacco leaves hung by their stems along a lath (local x), drooping both sides"""
    k.push(x, y, z, ry)
    for i in range(n):
        xx = (i - (n - 1) / 2) * 0.055
        m = mats[int(k.r() * len(mats)) % len(mats)]
        for side in (-1, 1):
            ll = L * (0.8 + k.r() * 0.35)
            ww = 0.032 + k.r() * 0.012
            tilt = side * (0.08 + k.r() * 0.12)
            zt = math.sin(tilt) * ll
            vs = [V(xx, 0, 0), V(xx - ww, -ll * 0.4, zt * 0.4 + side * 0.012), V(xx + (k.r() - 0.5) * 0.02, -ll, zt + side * 0.02), V(xx + ww, -ll * 0.4, zt * 0.4 + side * 0.012)]
            k.mesh(m, vs, [(0, 1, 2, 3), (3, 2, 1, 0)], uvscale=3.0)
    k.pop()


def loaf(k, x, y, z, s=1.0, ry=0.0):
    lathe(k, 'planks', [(0.05 * s, 0), (0.055 * s, 0.012 * s), (0.048 * s, 0.03 * s), (0.03 * s, 0.042 * s), (0.001, 0.046 * s)],
          x, y, z, seg=10, top=False, sx=1.4, ry=ry, uvscale=3.0)


def sign_board(k, x, y, z, label):
    """a painted board on posts in the yard, edge on to the street (the game paints the label on both faces)"""
    k.push(x, 0, z)
    for s in (-1, 1):
        k.cyl('bark', 0.025, 0.022, y + 0.12, 0, 0, s * 0.24, seg=6)
    k.box('darkwood', 0.03, 0.22, 0.46, 0, y - 0.11, 0)
    k.pop()
    k.marker('sign:' + label, x, y + 0.1, z)


def awning(k, x0, x1, z0, z1, hi, lo, mat='canvasRed', posts=True, drop=0.09):
    """a sailcloth awning from the wall (z0, hi) out to poles at (z1, lo), sagging between battens, with a scalloped valance"""
    nx = 4 if k.lod else max(6, round((x1 - x0) / 0.08))
    nz = 2 if k.lod else 6
    vs, fs = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            u = i / nx
            sag = 0.035 * math.sin(math.pi * t) * (1 - 0.6 * abs(math.cos(math.pi * u * 3)))
            vs.append(V(x0 + (x1 - x0) * u, hi + (lo - hi) * t - sag, z0 + (z1 - z0) * t))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            fs.append((a, a + nx + 1, a + nx + 2, a + 1))
            fs.append((a, a + 1, a + nx + 2, a + nx + 1))
    k.mesh(mat, vs, fs, uvscale=1.0)
    # valance
    vv, vf = [], []
    for i in range(nx + 1):
        u = i / nx
        d = drop * (0.6 + 0.4 * abs(math.sin(math.pi * u * (x1 - x0) / 0.16)))
        vv += [V(x0 + (x1 - x0) * u, lo, z1), V(x0 + (x1 - x0) * u, lo - d, z1 + 0.005)]
    for i in range(nx):
        a = 2 * i
        vf += [(a, a + 1, a + 3, a + 2), (a, a + 2, a + 3, a + 1)]
    k.mesh(mat, vv, vf, uvscale=1.0)
    if posts:
        for x in (x0 + 0.04, x1 - 0.04):
            k.cyl('wood', 0.025, 0.022, lo + 0.04, x, 0, z1 - 0.02, seg=7)
            if not k.lod:
                k.beam('rope', V(x, lo, z1), V(x + (0.25 if x > (x0 + x1) / 2 else -0.25), 0, z1 + 0.25), 0.008, round_=True, seg=4)
        k.beam('wood', V(x0, lo + 0.01, z1 - 0.02), V(x1, lo + 0.01, z1 - 0.02), 0.03, round_=True)


def workbench(k, x, z, L=1.0, dd=0.32, h=0.42, ry=0.0, vise=True):
    k.push(x, 0, z, ry)
    k.box('planks', L, 0.05, dd, 0, h - 0.05, 0, uvscale=1.3)
    k.box('planks', L - 0.1, 0.03, dd - 0.08, 0, 0.1, 0, uvscale=1.3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('wood', 0.05, h - 0.05, 0.05, sx * (L / 2 - 0.06), 0, sz * (dd / 2 - 0.04))
    if vise and not k.lod:
        k.box('wood', 0.06, 0.12, 0.05, L / 2 - 0.1, h - 0.08, dd / 2 + 0.02)
        k.box('iron', 0.012, 0.012, 0.12, L / 2 - 0.1, h + 0.0, dd / 2 + 0.05)
        k.cyl('wood', 0.008, 0.008, 0.12, L / 2 - 0.16, h - 0.0, dd / 2 + 0.1, seg=5, rz=-math.pi / 2)
    k.pop()


@building('gunsmithy')
def gunsmithy(k):
    """a gunsmith's: a lime-rendered stone shop under barrel tiles with barred windows, a forge flue, a sign
    and lantern; out front a bench under a striped awning with locks and stocks, a rack of muskets, long crates
    of finished arms and powder kegs, and a proof butt riddled with shot"""
    yard(k, 3.6, 3.6, seed=5.0)
    w, d, h = 2.5, 1.65, 1.05
    zc = -0.55
    k.push(0, 0, zc)
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    plastered(k, w, d, h, 'plaster', [Op('front', -0.55, 'door', h=0.86), Op('front', 0.3, 'window', bars=True), Op('front', 0.9, 'window', bars=True),
                                      Op('left', 0.0, 'window', bars=True), Op('right', -0.2, 'window'), Op('back', 0.4, 'window', bars=True)])
    tile_gable(k, w, d, 0.6, over=0.2, y=h, gable='plaster', tile_len=0.18, tile_w=0.12)
    chimney(k, w / 2 - 0.32, -d / 2 + 0.26, h - 0.1, 1.0, 0.28)
    k.pop()
    hanging_sign(k, -1.0, 1.0, d / 2, 'GUNS')
    lantern(k, -0.18, 1.0, d / 2)
    k.pop()
    steps(k, -0.55, zc + d / 2 + 0.1, 0.55, 0.12, 1, 'stone')
    zf = zc + d / 2
    # bench under the awning
    awning(k, 0.0, 1.3, zf, zf + 0.85, 1.02, 0.78, 'canvasRed')
    workbench(k, 0.62, zf + 0.42, 1.0, 0.34)
    if not k.lod:
        k.push(0.62, 0.42, zf + 0.42)
        musket(k, -0.2, 0.025, 0.0, ry=0.0, rz=-math.pi / 2 + 0.0, rx=0.0)
        for i in range(3):
            k.box('iron', 0.05, 0.02, 0.035, 0.12 + i * 0.07, 0.0, -0.08)  # gunlocks laid out
            k.box('iron', 0.015, 0.03, 0.012, 0.12 + i * 0.07, 0.02, -0.08)
        k.box('darkwood', 0.36, 0.03, 0.05, 0.25, 0.0, 0.08)  # an unfinished stock
        hammer(k, -0.35, 0.01, 0.1, ry=0.6, L=0.16, head=0.05)
        k.pop()
        k.box('planks', 0.4, 0.3, 0.03, 0.55, 0.45, zf + 0.04, uvscale=1.3)  # tool board on the wall
        for i in range(5):
            k.box('iron', 0.012, 0.12 + (i % 2) * 0.05, 0.01, 0.4 + i * 0.07, 0.55, zf + 0.06)
    # stool
    k.cyl('wood', 0.09, 0.09, 0.03, 0.55, 0.26, zf + 0.82, seg=10)
    for i in range(3):
        a = TAU * i / 3
        k.beam('wood', V(0.55 + math.cos(a) * 0.1, 0, zf + 0.82 + math.sin(a) * 0.1), V(0.55 + math.cos(a) * 0.05, 0.26, zf + 0.82 + math.sin(a) * 0.05), 0.022)
    # an A-rack of muskets by the door
    k.push(-1.15, 0, zf + 0.7, 0.25)
    for s in (-1, 1):
        k.beam('wood', V(-0.45, 0, s * 0.18), V(-0.45, 0.62, s * 0.03), 0.04)
        k.beam('wood', V(0.45, 0, s * 0.18), V(0.45, 0.62, s * 0.03), 0.04)
        k.box('wood', 0.95, 0.04, 0.05, 0, 0.1, s * 0.15)
    k.beam('wood', V(-0.5, 0.62, 0), V(0.5, 0.62, 0), 0.05)
    for i in range(7):
        s = 1 if i % 2 else -1
        musket(k, -0.36 + i * 0.12, 0.14, s * 0.13, rx=-s * 0.22, ry=math.pi / 2 if s > 0 else -math.pi / 2, L=0.72)
    k.pop()
    # long crates of finished muskets and powder kegs along the right side
    for (x, y, z, ry) in ((1.55, 0, -0.55, 0.05), (1.55, 0, -0.1, -0.03), (1.56, 0.22, -0.32, 0.02)):
        k.push(x, y, z, math.pi / 2 + ry)
        k.box('oldplanks', 0.86, 0.2, 0.28, 0, 0, 0, uvscale=1.4)
        if not k.lod:
            for xx in (-0.38, 0.0, 0.38):
                k.box('planks', 0.05, 0.21, 0.29, xx, 0, 0, uvscale=1.4)
            k.box('black', 0.3, 0.004, 0.08, -0.15, 0.2, 0.0)
        k.pop()
    for (x, z, s) in ((1.45, 0.45, 0.62), (1.62, 0.7, 0.58), (1.35, 0.78, 0.6)):
        cask(k, x, z, s)
    if not k.lod:
        k.box('black', 0.08, 0.002, 0.08, 1.45, 0.62 * 0.36 + 0.001, 0.45)
    # proof butt: a target board on a frame banked with sandbags
    k.push(-1.45, 0, 1.38, 0.5)
    for s in (-1, 1):
        k.box('wood', 0.06, 0.75, 0.06, s * 0.25, 0, 0)
    k.box('oldplanks', 0.6, 0.5, 0.05, 0, 0.2, 0.03, uvscale=1.4)
    k.cyl('bone', 0.17, 0.17, 0.01, 0, 0.45, 0.06, seg=20, rx=math.pi / 2)
    k.cyl('red', 0.11, 0.11, 0.012, 0, 0.45, 0.062, seg=20, rx=math.pi / 2)
    k.cyl('black', 0.045, 0.045, 0.014, 0, 0.45, 0.064, seg=12, rx=math.pi / 2)
    if not k.lod:
        for i in range(9):
            k.cyl('black', 0.008, 0.008, 0.016, (k.r() - 0.5) * 0.4, 0.3 + k.r() * 0.3, 0.07, seg=5, rx=math.pi / 2)
        for i in range(6):
            sack(k, -0.25 + (i % 3) * 0.25, -0.12 - (i // 3) * 0.05, 0.75, ry=k.r() * 3)
    k.pop()
    return {'ao': 1024}


def louvre(k, x, y, z, w=0.32, d=0.32, h=0.26):
    """a ridge louvre: a boarded turret with slatted sides and a little pyramid cap, to let out steam"""
    k.box('darkwood', w, 0.04, d, x, y, z)
    for s in (-1, 1):
        for (px, pz) in ((s * (w / 2 - 0.02), -d / 2 + 0.02), (s * (w / 2 - 0.02), d / 2 - 0.02)):
            k.box('darkwood', 0.035, h, 0.035, x + px, y, z + pz)
    k.box('black', w - 0.05, h - 0.02, d - 0.05, x, y + 0.03, z)
    if not k.lod:
        for i in range(4):
            yy = y + 0.06 + i * 0.05
            for s in (-1, 1):
                k.cbox('planks', w - 0.04, 0.012, 0.05, x, yy, z + s * (d / 2 - 0.01), rx=s * 0.6)
                k.cbox('planks', 0.05, 0.012, d - 0.04, x + s * (w / 2 - 0.01), yy, z, rz=-s * 0.6)
    a = y + h
    hw, hd = w / 2 + 0.06, d / 2 + 0.06
    k.mesh('planksDark', [V(x - hw, a, z - hd), V(x + hw, a, z - hd), V(x + hw, a, z + hd), V(x - hw, a, z + hd), V(x, a + 0.16, z)],
           [(0, 4, 1), (1, 4, 2), (2, 4, 3), (3, 4, 0), (0, 1, 2, 3)], uvscale=1.4)
    k.cyl('wood', 0.015, 0.006, 0.08, x, a + 0.15, z, seg=6)


def copper(k, x, z, y, r=0.25, h=0.24):
    """an open copper kettle sitting in a brick setting"""
    lathe(k, 'brass', [(r * 0.75, -0.02), (r, h * 0.45), (r * 1.02, h), (r * 1.08, h + 0.015), (r * 0.98, h + 0.02), (r * 0.94, h * 0.8)],
          x, y, z, seg=20, top=False, uvscale=1.4)
    k.cyl('soil', r * 0.94, r * 0.94, 0.008, x, y + h * 0.78, z, seg=20)


@building('brewery')
def brewery(k):
    """a brewhouse: a weatherboarded hall with a steam louvre on its thatch, a shingled lean-to sheltering the
    copper on its brick furnace, a mash tun with its oar, a cooler on trestles, casks racked on a stillage,
    sacks of malted corn and a hanging sign"""
    yard(k, 2.8, 2.8, seed=7.0)
    w, d, h = 1.65, 1.2, 0.95
    hx, hz = -0.45, -0.6
    k.push(hx, 0, hz)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    clapboard(k, w, d, h, 'planks', [Op('front', -0.3, 'double', w=0.6, h=0.82), Op('front', 0.48, 'window'), Op('left', 0.0, 'window'),
                                     Op('back', 0.0, 'window')])
    thatch_gable(k, w, d, 0.68, over=0.24, y=h, gable='planks', res=0.08 if k.lod else 0.05)
    louvre(k, 0.0, h + 0.13 + 0.68 - 0.04, 0.0)
    k.pop()
    hanging_sign(k, 0.55, 0.98, d / 2 + 0.02, 'BREWERY')
    k.pop()
    # lean-to on the right sheltering the copper
    k.push(hx + w / 2, 0, -0.42, math.pi / 2)
    shingles(k, 1.1, -0.02, 0.98, 1.0, 0.74)
    k.pop()
    for z in (-0.88, 0.06):
        post(k, 1.25, z, 0.68, 0.09)
    k.box('darkwood', 0.1, 0.08, 1.1, 1.25, 0.62, -0.42)
    # furnace with a copper on it and its own stack behind the lean-to
    fx, fz = 0.85, -0.62
    brick_block(k, fx, fz, 0.66, 0.42, 0.56, faces=('front', 'left', 'right'))
    copper(k, fx, fz, 0.46, 0.25, 0.22)
    k.box('black', 0.18, 0.15, 0.02, fx, 0.08, fz + 0.285)
    k.box('iron', 0.24, 0.025, 0.03, fx, 0.24, fz + 0.29)
    k.marker('glow:0.14x0.1x0.03', fx, 0.14, fz + 0.28)
    chimney(k, fx, -1.12, 0.0, 1.55, 0.26)
    if not k.lod:
        k.box('brass', 0.03, 0.03, 0.32, fx - 0.18, 0.62, fz + 0.12, ry=0.4)  # skimmer handle
    # mash tun with its oar, and a cooler on trestles
    tub(k, 0.45, 0.42, 0.28, 0.42, fill='soil', hoops=3)
    k.beam('wood', V(0.35, 0.3, 0.42), V(0.62, 0.8, 0.3), 0.035, round_=True)
    k.cbox('wood', 0.025, 0.14, 0.07, 0.38, 0.33, 0.42, rz=-0.5)
    k.push(1.0, 0, 0.7, 0.3)
    for s in (-1, 1):
        k.beam('wood', V(s * 0.3, 0, -0.12), V(s * 0.3, 0.3, 0), 0.035)
        k.beam('wood', V(s * 0.3, 0, 0.12), V(s * 0.3, 0.3, 0), 0.035)
    k.box('planksDark', 0.75, 0.08, 0.4, 0, 0.3, 0, uvscale=1.3)
    k.box('soil', 0.7, 0.01, 0.35, 0, 0.36, 0)
    k.pop()
    # casks: racked on a stillage, standing, and one on its side by the door
    stillage(k, -0.65, 0.48, 4, 2, s=0.85)
    cask(k, -1.18, 0.95, 0.85)
    cask(k, 0.0, 1.05, 0.8, lying=True, ry=0.4)
    for (x, z, ry) in ((-0.25, 1.1, 0.3), (-0.5, 1.15, 1.3), (-0.38, 0.95, 2.0)):
        sack(k, x, z, 0.85, ry)
    bucket(k, 0.2, 0.0)
    return {'ao': 1024}


@building('distillery')
def distillery(k):
    """a rum distillery: a rendered still house under barrel tiles, an open still shed with two copper pot
    stills on brick furnaces, swan necks running into worm tubs, a tall stack, molasses vats, bundles of cane
    and casks of rum racked to age"""
    yard(k, 5.6, 4.6, seed=9.0)
    # still house
    w, d, h = 2.3, 1.7, 1.2
    k.push(-1.3, 0, -1.3)
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    plastered(k, w, d, h, 'plasterYellow', [Op('front', -0.3, 'double', h=0.95), Op('front', 0.65, 'window'), Op('left', 0.0, 'window'),
                                             Op('right', -0.3, 'window'), Op('back', -0.4, 'window'), Op('back', 0.5, 'window')])
    tile_gable(k, w, d, 0.62, over=0.2, y=h, gable='plasterYellow', tile_len=0.2, tile_w=0.135)
    k.pop()
    lantern(k, 0.3, 1.05, d / 2)
    k.pop()
    steps(k, -1.6, -1.3 + d / 2 + 0.1, 0.8, 0.12, 1, 'stone')
    # the still shed
    sx0, sx1, sz0, sz1 = 0.15, 2.6, -1.25, 0.75
    k.push((sx0 + sx1) / 2, 0, (sz0 + sz1) / 2)
    open_frame(k, [-(sx1 - sx0) / 2, 0.0, (sx1 - sx0) / 2], [-(sz1 - sz0) / 2, (sz1 - sz0) / 2], 1.35)
    shingle_gable(k, sx1 - sx0, sz1 - sz0, 0.55, 1.35, over=0.22)
    k.pop()
    k.box('stone', sx1 - sx0 - 0.1, 0.05, sz1 - sz0 - 0.1, (sx0 + sx1) / 2, 0, (sz0 + sz1) / 2, uvscale=2.0)  # flagged floor
    for i, x in enumerate((0.75, 1.95)):
        z = -0.45
        brick_block(k, x, z, 0.72, 0.36, 0.72)
        k.box('black', 0.2, 0.16, 0.02, x, 0.06, z + 0.365)
        k.box('iron', 0.26, 0.03, 0.03, x, 0.22, z + 0.37)
        k.marker('glow:0.18x0.13x0.04', x, 0.14, z + 0.355)
        end = pot_still(k, x, z, s=0.9, y=0.41, arm=(0.1, -0.25, 0.85))
        # worm tub: a tall coopered tank of cooling water with the worm's tail and a spout into a receiver
        tub(k, x + 0.08, 0.5, 0.25, 0.62, hoops=3)
        k.beam('brass', end, V(x + 0.08, 0.62, 0.5), 0.04, round_=True)
        k.cyl('brass', 0.012, 0.012, 0.12, x + 0.08, 0.2, 0.76, seg=6, rx=math.pi / 2)
        tub(k, x + 0.08, 0.86, 0.1, 0.14, fill='soil', hoops=2)
    # the stack, beyond the shed's back eave
    chimney(k, 1.38, -1.82, 0.0, 3.0, 0.44)
    # molasses vats and a skimming ladle
    tub(k, -2.3, 0.05, 0.3, 0.45, fill='soil', hoops=3)
    tub(k, -1.65, 0.0, 0.26, 0.42, fill='soil', hoops=3)
    k.beam('wood', V(-1.75, 0.3, 0.0), V(-1.45, 0.75, 0.15), 0.025, round_=True)
    # cane in bundles, bound with withies
    for b in range(5):
        bx, bz = -2.1 + (b % 3) * 0.3 + (0.15 if b >= 3 else 0), 1.35
        by = 0.0 if b < 3 else 0.17
        k.push(bx, by + 0.09, bz, 0.05 * b)
        for i in range(6 if k.lod else 10):
            a = TAU * i / (6 if k.lod else 10)
            r = 0.05 + 0.025 * (i % 2)
            k.beam('bamboo', V(math.cos(a) * r, math.sin(a) * r, -0.6), V(math.cos(a) * r, math.sin(a) * r, 0.6 + (k.r() - 0.5) * 0.1), 0.028, round_=True, seg=5)
        for zz in (-0.35, 0.35):
            k.torus('rope', 0.085, 0.01, 0, 0, zz, rx=math.pi / 2, seg=10)
        k.pop()
    # rum ageing: two stillages and a few standing casks by the road
    stillage(k, -0.95, 0.35, 4, 2, s=0.9, ry=0.0)
    stillage(k, -0.7, 1.25, 3, 2, s=0.9, ry=0.0)
    cask(k, 0.35, 1.4, 0.9)
    cask(k, 0.62, 1.55, 0.9)
    cask(k, 0.5, 1.85, 0.85, lying=True, ry=0.6)
    sign_board(k, 1.4, 0.75, 1.75, 'RUM')
    crate(k, 2.25, 0, 1.4, 0.3, 0.3)
    crate(k, 2.3, 0.3, 1.38, 0.24, 0.8)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- bakery

def faggots(k, x, z, n=5, ry=0.0):
    """bundles of brushwood for firing the oven, tied with withies"""
    k.push(x, 0, z, ry)
    for b in range(n):
        bx = (b % 3 - 1) * 0.2 + (0.1 if b >= 3 else 0)
        by = 0.08 if b < 3 else 0.22
        for i in range(4 if k.lod else 9):
            a = TAU * i / (4 if k.lod else 9) + b
            r = 0.035 + 0.03 * k.r()
            k.beam('bark', V(bx + math.cos(a) * r, by + math.sin(a) * r, -0.32 - k.r() * 0.05), V(bx + math.cos(a) * r * 1.4, by + math.sin(a) * r * 1.4, 0.32 + k.r() * 0.06), 0.022, round_=True, seg=4)
        for zz in (-0.15, 0.15):
            k.torus('rope', 0.07, 0.009, bx, by, zz, rx=math.pi / 2, seg=8)
    k.pop()


@building('bakery')
def bakery(k):
    """a bakehouse: a whitewashed cottage under barrel tiles, and before it a great domed bread oven on a
    rubble base with a brick mouth glowing and a stubby flue; a trestle of fresh loaves and baskets, flour
    sacks, a peel leaning on the oven, brushwood faggots for the firing and a hanging sign"""
    yard(k, 2.8, 2.8, seed=11.0)
    w, d, h = 1.6, 1.15, 0.9
    k.push(-0.5, 0, -0.62)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    plastered(k, w, d, h, 'plaster', [Op('front', -0.2, 'door', h=0.8), Op('front', 0.45, 'window'), Op('left', 0.0, 'window'), Op('back', 0.2, 'window')])
    tile_gable(k, w, d, 0.55, over=0.2, y=h, gable='plaster', tile_len=0.16, tile_w=0.1)
    k.pop()
    hanging_sign(k, 0.15, 0.95, d / 2, 'BAKERY')
    k.pop()
    steps(k, -0.7, -0.62 + d / 2 + 0.1, 0.5, 0.1, 1, 'stone')
    # the oven: rubble base, rendered clay dome, brick mouth
    ox, oz = 0.68, 0.05
    bw = 1.0
    k.box('stoneDark', bw - 0.03, 0.42, bw - 0.03, ox, 0, oz, uvscale=2.0)
    for f in FACES:
        k.push(ox, 0, oz)
        k.face(f, bw, bw)
        stone_face(k, bw, 0.42, 'stone', sh=0.105)
        k.pop()
        k.pop()
    k.box('stoneDark', bw + 0.04, 0.05, bw + 0.04, ox, 0.42, oz, uvscale=2.0)
    dome = [(0.44, 0), (0.45, 0.08), (0.43, 0.18), (0.38, 0.28), (0.3, 0.36), (0.19, 0.42), (0.08, 0.455), (0.001, 0.465)]
    lathe(k, 'plasterYellow', dome, ox, 0.47, oz - 0.04, seg=22, top=False, uvscale=1.2)
    # brick mouth: an arched front built out from the dome
    mz = oz + 0.38
    k.push(ox, 0.47, mz)
    for sx in (-1, 1):
        k.box('terracotta', 0.11, 0.2, 0.16, sx * 0.155, 0, -0.06, uvscale=2.5)
    k.box('terracotta', 0.42, 0.14, 0.16, 0, 0.2, -0.06, uvscale=2.5)
    k.box('terracotta', 0.2, 0.02, 0.16, 0, 0, -0.06, uvscale=2.5)
    k.box('black', 0.2, 0.18, 0.02, 0, 0.02, -0.13)
    k.box('black', 0.2, 0.01, 0.12, 0, 0.19, -0.07)
    if not k.lod:
        for i in range(7):
            a = math.pi * i / 6
            k.cbox('terracotta', 0.05, 0.075, 0.05, math.cos(a) * 0.14, 0.18 + math.sin(a) * 0.1, 0.03, rz=a - math.pi / 2, uvscale=2.5)
    k.box('iron', 0.26, 0.2, 0.012, 0.3, 0.0, 0.05, ry=-1.2)  # the oven door, set aside
    k.pop()
    k.marker('glow:0.17x0.08x0.05', ox, 0.47 + 0.06, mz - 0.08)
    # flue over the mouth
    chimney(k, ox, mz - 0.14, 0.81, 0.5, 0.22)
    # peel leaning on the oven, a rake
    k.beam('wood', V(ox + 0.55, 0, oz + 0.25), V(ox + 0.45, 1.05, oz + 0.05), 0.025, round_=True)
    k.cbox('planks', 0.18, 0.02, 0.2, ox + 0.56, 0.08, oz + 0.27, rx=0.0, rz=1.45)
    k.beam('wood', V(ox + 0.55, 0, oz - 0.15), V(ox + 0.42, 1.0, oz - 0.2), 0.02, round_=True)
    # trestle of loaves under a little awning
    awning(k, -1.25, -0.15, -0.62 + d / 2, 0.75, 0.92, 0.72, 'canvas')
    k.push(-0.7, 0, 0.45)
    k.box('planks', 0.9, 0.04, 0.32, 0, 0.4, 0, uvscale=1.3)
    for sx in (-1, 1):
        k.beam('wood', V(sx * 0.36, 0, -0.12), V(sx * 0.36, 0.4, 0.0), 0.035)
        k.beam('wood', V(sx * 0.36, 0, 0.12), V(sx * 0.36, 0.4, 0.0), 0.035)
    if not k.lod:
        for i in range(9):
            loaf(k, -0.36 + (i % 5) * 0.16 + (0.08 if i >= 5 else 0), 0.44, -0.06 + (0.12 if i >= 5 else 0), 0.9 + k.r() * 0.2, ry=k.r())
    # baskets of rolls
    for (x, z) in ((0.32, 0.0),):
        lathe(k, 'weave', [(0.1, 0), (0.13, 0.08), (0.12, 0.085), (0.1, 0.02)], x, 0.44, z, seg=12, top=False, uvscale=3.0)
        if not k.lod:
            for j in range(4):
                loaf(k, x + (j - 1.5) * 0.04, 0.48, z + (j % 2 - 0.5) * 0.06, 0.5)
    k.pop()
    lathe(k, 'weave', [(0.12, 0), (0.15, 0.13), (0.14, 0.135), (0.12, 0.02)], -1.1, 0, 0.95, seg=12, top=False, uvscale=3.0)
    k.cyl('terracotta', 0.13, 0.13, 0.01, -1.1, 0.1, 0.95, seg=12)
    for (x, z, ry) in ((-0.15, 1.0, 0.3), (0.05, 1.12, 1.1), (-0.05, 0.92, 2.4)):
        sack(k, x, z, 0.85, ry)
    faggots(k, 0.75, 1.0, 5, ry=math.pi / 2 + 0.2)
    tub(k, 1.15, -0.78, 0.15, 0.22)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- cigar factory

def bale(k, x, y, z, w=0.42, h=0.26, d=0.3, ry=0.0):
    """a tobacco bale sewn in sacking and roped"""
    k.push(x, y, z, ry)
    k.box('canvas', w, h, d, 0, 0, 0, uvscale=2.0, bevel=0.02)
    if not k.lod:
        for xx in (-w * 0.25, w * 0.25):
            k.box('rope', 0.02, h + 0.008, d + 0.008, xx, -0.004, 0)
        k.box('rope', w + 0.008, h + 0.006, 0.02, 0, -0.003, 0)
    k.pop()


@building('cigar_factory')
def cigar_factory(k):
    """a cigar works: an open thatched drying barn hung with tiers of tobacco on laths (green to gold to brown
    as it cures), a pink-rendered rolling room with a sign, rolling benches under an awning with leaf, cigars
    and cedar boxes, a leaf press and roped bales waiting for the boats"""
    yard(k, 3.6, 2.6, seed=13.0)
    # the drying barn
    bx, bz, bw, bd, bh = -0.68, -0.32, 2.1, 1.6, 1.25
    k.push(bx, 0, bz)
    xs = [-bw / 2, 0.0, bw / 2]
    zs = [-bd / 2, bd / 2]
    open_frame(k, xs, zs, bh, s=0.1, braces=True)
    thatch_gable(k, bw, bd, 0.7, over=0.25, y=bh, mat='thatchDark', gable='oldplanks', gable_kind='wattle', res=0.08 if k.lod else 0.055)
    # rails along x at two tiers carrying the laths
    for yy in (bh - 0.02, bh - 0.4):
        for z in zs:
            k.box('wood', bw, 0.05, 0.05, 0, yy - 0.05, z * 0.97)
    nl = 9
    for t, (yy, mats) in enumerate(((bh - 0.02, ('thatch', 'soil', 'thatch')), (bh - 0.4, ('leaf', 'thatch', 'leaf')))):
        for i in range(nl):
            x = -bw / 2 + 0.16 + i * (bw - 0.32) / (nl - 1)
            k.beam('wood', V(x, yy + 0.01, -bd / 2), V(x, yy + 0.01, bd / 2), 0.025, 0.02)
            if k.lod:
                k.box(mats[0] if t else 'thatch', 0.1, 0.18, bd - 0.2, x, yy - 0.2, 0)
            else:
                leaf_bunch(k, x, yy, 0.0, n=round((bd - 0.2) / 0.055), L=0.19, mats=mats, ry=math.pi / 2)
    # a slatted screen on the windward back
    if not k.lod:
        for i in range(14):
            x = -bw / 2 + 0.08 + i * (bw - 0.16) / 13
            k.box('oldplanks', 0.1, 0.7, 0.02, x, 0.0, -bd / 2 - 0.06, uvscale=1.3, grain=1)
    else:
        k.box('oldplanks', bw, 0.7, 0.02, 0, 0, -bd / 2 - 0.06)
    k.pop()
    # the rolling room
    rx_, rz_, rw, rd, rh = 1.15, -0.55, 1.15, 1.3, 0.92
    k.push(rx_, 0, rz_)
    plinth(k, rw + 0.06, rd + 0.06, 0.1)
    k.push(0, 0.1, 0)
    plastered(k, rw, rd, rh, 'plasterPink', [Op('front', -0.2, 'door', h=0.8), Op('front', 0.32, 'window', w=0.26), Op('right', 0.0, 'window'), Op('back', 0.0, 'window')])
    tile_gable(k, rw, rd, 0.5, over=0.18, y=rh, gable='plasterPink', tile_len=0.16, tile_w=0.1)
    k.pop()
    hanging_sign(k, 0.32, 0.96, rd / 2, 'CIGARS')
    k.pop()
    zf = rz_ + rd / 2
    # rolling benches under an awning
    awning(k, 0.6, 1.72, zf, zf + 0.75, 0.98, 0.76, 'canvasGreen')
    workbench(k, 1.15, zf + 0.4, 0.95, 0.32, vise=False)
    if not k.lod:
        k.push(1.15, 0.42, zf + 0.4)
        for i in range(4):
            k.mesh('thatch', [V(-0.36 + i * 0.07, 0.003, -0.12), V(-0.3 + i * 0.07, 0.003, -0.12), V(-0.28 + i * 0.07, 0.003, 0.06), V(-0.34 + i * 0.07, 0.003, 0.06)], [(3, 2, 1, 0)], uvscale=3)
        for i in range(10):
            k.cyl('soil', 0.008, 0.008, 0.11, 0.0 + (i % 5) * 0.022, 0.008, 0.02 + (i // 5) * 0.022, seg=5, rx=math.pi / 2)
        for j in range(3):
            k.box('planks', 0.16, 0.05, 0.11, 0.3, j * 0.05, -0.05, ry=0.1 * j, uvscale=2.5)
            k.box('bone', 0.08, 0.002, 0.05, 0.3, j * 0.05 + 0.05, -0.05, ry=0.1 * j)
        k.pop()
        for x in (0.85, 1.4):
            k.cyl('wood', 0.08, 0.08, 0.03, x, 0.26, zf + 0.75, seg=10)
            for i in range(3):
                a = TAU * i / 3 + x
                k.beam('wood', V(x + math.cos(a) * 0.09, 0, zf + 0.75 + math.sin(a) * 0.09), V(x + math.cos(a) * 0.05, 0.26, zf + 0.75 + math.sin(a) * 0.05), 0.02)
    # a screw press for the leaf
    k.push(-0.15, 0, 0.95)
    for s in (-1, 1):
        k.box('darkwood', 0.07, 0.75, 0.07, s * 0.2, 0, 0)
    k.box('darkwood', 0.52, 0.09, 0.1, 0, 0.72, 0)
    k.box('planksDark', 0.36, 0.2, 0.3, 0, 0, 0, uvscale=1.4)
    k.box('thatch', 0.3, 0.06, 0.26, 0, 0.2, 0)
    k.box('planks', 0.32, 0.04, 0.28, 0, 0.26, 0)
    k.cyl('wood', 0.03, 0.03, 0.44, 0, 0.3, 0, seg=8)
    k.beam('wood', V(-0.22, 0.62, 0), V(0.22, 0.62, 0), 0.025, round_=True)
    k.pop()
    # bales and baskets of leaf
    bale(k, -1.45, 0, 0.75, ry=0.1)
    bale(k, -1.0, 0, 0.8, ry=-0.05)
    bale(k, -1.22, 0.26, 0.77, ry=0.05)
    bale(k, -1.5, 0, 1.15, ry=1.5)
    lathe(k, 'weave', [(0.13, 0), (0.17, 0.22), (0.16, 0.225), (0.13, 0.02)], -0.6, 0, 1.05, seg=12, top=False, uvscale=3.0)
    if not k.lod:
        for i in range(6):
            a = TAU * i / 6
            k.mesh('leaf', [V(-0.6, 0.18, 1.05), V(-0.6 + math.cos(a) * 0.12, 0.27, 1.05 + math.sin(a) * 0.12 - 0.03),
                            V(-0.6 + math.cos(a) * 0.2, 0.25, 1.05 + math.sin(a) * 0.2), V(-0.6 + math.cos(a) * 0.12, 0.27, 1.05 + math.sin(a) * 0.12 + 0.03)],
                   [(0, 1, 2, 3), (3, 2, 1, 0)])
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- ration factory

@building('ration_factory')
def ration_factory(k):
    """a victualling house: a board salting house with a catslide roof running out over an open packing floor,
    a smokehouse puffing beside it; salting troughs of pork under salt, a barrel half packed, crates of
    hardtack, a steelyard, finished casks racked for the ships, a heap of bay salt and a sign"""
    yard(k, 3.6, 3.6, seed=15.0)
    w, d, h = 2.45, 1.4, 1.0
    cx, cz = -0.28, -1.0
    zw = cz + d / 2           # front wall
    k.push(cx, 0, cz)
    board_batten(k, w, d, h, 'oldplanks', [Op('front', -0.65, 'door', h=0.84), Op('front', 0.45, 'hatch', w=0.5, h=0.36, y=0.42),
                                         Op('left', 0.0, 'window', shutters=False, bars=True), Op('back', 0.3, 'window', shutters=False)])
    rise = 0.55
    shingles(k, w + 0.3, 0.0, d / 2 + 0.003, h + rise, h, mat='planksDark')      # front slope to the wall head
    k.push(0, 0, 0, math.pi)
    shingles(k, w + 0.3, 0.0, d / 2 + 0.22, h + rise, h - 0.22 * rise / (d / 2))  # back slope with its eave
    k.pop()
    k.beam('darkwood', V(-w / 2 - 0.16, h + rise + 0.03, 0), V(w / 2 + 0.16, h + rise + 0.03, 0), 0.09, 0.07)
    gables(k, w, d, rise, h, 'oldplanks', 'boards', barge=True)
    k.pop()
    # the catslide over the packing floor
    zf = 0.85
    k.push(cx, 0, 0)
    shingles(k, w + 0.3, zw, zf + 0.1, h - 0.005, 0.74)
    k.pop()
    for x in (cx - w / 2 + 0.05, cx, cx + w / 2 - 0.05):
        post(k, x, zf - 0.05, 0.72, 0.1)
        if not k.lod:
            for sx in (-1, 1):
                if cx - w / 2 < x + sx * 0.25 < cx + w / 2:
                    k.beam('wood', V(x, 0.36, zf - 0.05), V(x + sx * 0.25, 0.62, zf - 0.05), 0.045)
    k.box('darkwood', w + 0.1, 0.09, 0.11, cx, 0.62, zf - 0.05)
    # the smokehouse
    sx_, sz_ = 1.38, -1.2
    k.push(sx_, 0, sz_)
    board_batten(k, 0.72, 0.72, 0.9, 'planksDark', [Op('front', 0.0, 'door', w=0.36, h=0.72)])
    shingle_gable(k, 0.72, 0.72, 0.32, 0.9, over=0.12, gable='planksDark')
    louvre(k, 0.0, 0.9 + 0.32 - 0.02, 0.0, 0.22, 0.22, 0.18)
    k.marker('smoke', 0.0, 1.55, 0.0)
    k.pop()
    if not k.lod:
        # hams and sides hanging inside the hatch
        for i in range(3):
            lathe(k, 'red', [(0.02, 0), (0.045, 0.05), (0.05, 0.12), (0.025, 0.17), (0.008, 0.19)], cx + 0.32 + i * 0.12, 0.5, zw - 0.18, seg=8, top=True, bottom=True)
    # salting trough of pork under salt
    k.push(-1.0, 0, 0.25)
    k.box('planksDark', 0.95, 0.22, 0.38, 0, 0.18, 0, uvscale=1.3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box('wood', 0.05, 0.2, 0.05, sx * 0.4, 0, sz * 0.14)
    k.box('plaster', 0.88, 0.01, 0.31, 0, 0.385, 0)
    if not k.lod:
        for i in range(12):
            rock(k, 'red' if i % 3 else 'bone', (k.r() - 0.5) * 0.75, 0.395, (k.r() - 0.5) * 0.22, 0.06, 0.03, 0.05, seed=i * 0.7, sub=1, rough=0.2)
    k.pop()
    # a barrel half packed, its head off, and the cooper's mallet
    tub(k, -0.2, 0.3, 0.15, 0.36, fill='red', hoops=3)
    k.cyl('planksDark', 0.145, 0.145, 0.02, 0.05, 0.0, 0.55, seg=14, rx=0.15)
    hammer(k, -0.05, 0.37, 0.2, ry=0.5, L=0.18, head=0.08)
    # hardtack: crates, one open showing the biscuit
    for (x, y, z, ry) in ((0.45, 0, 0.25, 0.05), (0.78, 0, 0.3, -0.1), (0.6, 0.3, 0.27, 0.15)):
        crate(k, x, y, z, 0.3, ry)
    k.push(0.35, 0, 0.6, 0.2)
    k.box('oldplanks', 0.32, 0.18, 0.26, 0, 0, 0, uvscale=1.4)
    k.box('sand', 0.29, 0.005, 0.23, 0, 0.17, 0)
    if not k.lod:
        for i in range(5):
            for j in range(4):
                k.box('sand', 0.05, 0.012, 0.05, -0.12 + i * 0.06, 0.175, -0.09 + j * 0.06, ry=(k.r() - 0.5) * 0.3)
    k.cbox('oldplanks', 0.32, 0.02, 0.26, 0.0, 0.26, -0.2, rx=-1.2)
    k.pop()
    # a steelyard hanging from the plate
    if not k.lod:
        k.beam('iron', V(0.12, 0.62, zf - 0.05), V(0.12, 0.5, zf - 0.05), 0.008, round_=True, seg=4)
        k.beam('iron', V(-0.05, 0.5, zf - 0.05), V(0.32, 0.49, zf - 0.05), 0.015)
        k.cyl('iron', 0.025, 0.025, 0.05, 0.28, 0.42, zf - 0.05, seg=8)
        k.beam('iron', V(-0.03, 0.5, zf - 0.05), V(-0.03, 0.33, zf - 0.05), 0.006, round_=True, seg=4)
        k.cyl('iron', 0.08, 0.08, 0.012, -0.03, 0.32, zf - 0.05, seg=12)
    # finished casks for the ships, branded, and more crates
    stillage(k, -0.85, 1.35, 4, 2, s=0.85)
    for (x, z) in ((0.2, 1.3), (0.45, 1.5)):
        cask(k, x, z, 0.85)
        k.box('black', 0.1, 0.002, 0.1, x, 0.85 * 0.36 + 0.002, z)
    crate(k, 0.95, 0, 1.25, 0.3, 0.3)
    crate(k, 1.3, 0, 1.35, 0.3, -0.2)
    crate(k, 1.1, 0.3, 1.3, 0.28, 0.1)
    # bay salt heap with a shovel in it
    heap(k, 'plaster', 1.35, 0.35, 0.36, 0.28, seed=4.0)
    k.beam('wood', V(1.3, 0.2, 0.4), V(1.15, 0.7, 0.62), 0.025, round_=True)
    k.cbox('iron', 0.12, 0.01, 0.14, 1.32, 0.17, 0.38, rx=0.6)
    for (x, z, ry) in ((-1.6, 0.35, 0.4), (-1.55, 0.6, 1.6), (-1.62, 0.12, 2.5)):
        sack(k, x, z, 0.85, ry)
    sign_board(k, -1.65, 0.75, 0.95, 'RATIONS')
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- carpenter

def peg_leg(k, x, y, z, s=1.0, rx=0.0, ry=0.0, rz=0.0):
    """a turned peg leg: a padded cup for the stump, a strap, a long taper to an iron-shod foot (local +y up)"""
    prof = [(0.016, 0), (0.019, 0.01), (0.017, 0.02), (0.02, 0.06), (0.026, 0.2), (0.03, 0.26), (0.036, 0.28), (0.034, 0.3),
            (0.05, 0.33), (0.058, 0.39), (0.06, 0.42), (0.052, 0.425), (0.046, 0.4)]
    lathe(k, 'planks', [(r * s, hh * s) for (r, hh) in prof], x, y, z, seg=12, top=True, bottom=True, rx=rx, ry=ry, rz=rz, uvscale=2.0)
    if not k.lod:
        k.push(x, y, z, ry, rx, rz)
        k.cyl('iron', 0.018 * s, 0.018 * s, 0.012 * s, 0, 0, 0, seg=8)
        k.torus('soil', 0.06 * s, 0.006, 0, 0.38 * s, 0, seg=12, rseg=3)
        k.pop()


def ships_wheel(k, x, y, z, r=0.28, ry=0.0, rx=0.0):
    k.push(x, y, z, ry, rx)
    k.cyl('darkwood', 0.05, 0.05, 0.08, 0, 0, -0.04, seg=10, rx=math.pi / 2)
    k.cyl('brass', 0.03, 0.03, 0.09, 0, 0, -0.045, seg=8, rx=math.pi / 2)
    seg = 10 if k.lod else 24
    for i in range(seg):
        a0, a1 = TAU * i / seg, TAU * (i + 1) / seg
        k.beam('wood', V(math.cos(a0) * r, math.sin(a0) * r, 0), V(math.cos(a1) * r, math.sin(a1) * r, 0), 0.045, 0.035)
    for i in range(8):
        a = TAU * i / 8
        k.beam('wood', V(math.cos(a) * 0.04, math.sin(a) * 0.04, 0), V(math.cos(a) * (r + 0.1), math.sin(a) * (r + 0.1), 0), 0.022, round_=True, seg=6)
        if not k.lod:
            k.cyl('wood', 0.018, 0.012, 0.05, math.cos(a) * (r + 0.1), math.sin(a) * (r + 0.1), 0, seg=6, rz=a - math.pi / 2)
    k.pop()


@building('carpenter')
def carpenter(k):
    """a ship's carpenter and peg-leg turner: a weatherboarded shop and an open lean-to workshop with a
    spring-pole lathe turning a leg between centres, a rack of finished peg legs, a bench with its vise and
    planes, saws hung on the back boards, a ship's wheel and a rudder in for repair, timber and shavings"""
    yard(k, 3.7, 1.75, seed=17.0, wob=0.08)
    w, d, h = 1.35, 1.15, 0.9
    cx, cz = -1.1, -0.12
    k.push(cx, 0, cz)
    plinth(k, w + 0.04, d + 0.04, 0.1)
    k.push(0, 0.1, 0)
    clapboard(k, w, d, h, 'planks', [Op('front', 0.22, 'door', h=0.8), Op('front', -0.33, 'window'), Op('left', 0.0, 'window')], trim='darkwood')
    shingle_gable(k, w, d, 0.48, h, over=0.15, gable='planks')
    k.pop()
    hanging_sign(k, 0.62, 1.02, d / 2, 'PEG LEGS')
    k.pop()
    # open workshop: a boarded back, posts and a lean-to falling to the street
    x0, x1, zb, zf = -0.3, 1.75, -0.7, 0.62
    k.push((x0 + x1) / 2, 0, zb)
    if k.lod:
        k.box('oldplanks', x1 - x0, 1.02, 0.04, 0, 0, 0)
    else:
        n = round((x1 - x0) / 0.12)
        for i in range(n):
            k.box('oldplanks', (x1 - x0) / n - 0.006, 1.0 + k.r() * 0.03, 0.03, -(x1 - x0) / 2 + (i + 0.5) * (x1 - x0) / n, 0, 0, uvscale=1.3, grain=1)
        for yy in (0.25, 0.8):
            k.box('darkwood', x1 - x0, 0.06, 0.04, 0, yy, 0.03)
    k.pop()
    for x in (x0 + 0.05, x1 - 0.05):
        post(k, x, zb + 0.04, 1.05, 0.09)
    # an old topsail stretched over spars for a roof
    for x in (x0 + 0.08, 0.72, x1 - 0.06):
        k.beam('bark', V(x, 1.02, zb), V(x, 0.86, zf + 0.06), 0.05, round_=True)
    awning(k, x0 - 0.02, x1 + 0.04, zb - 0.02, zf + 0.1, 1.1, 0.9, 'canvas', posts=False, drop=0.05)
    for x in (x0 + 0.08, 0.72, x1 - 0.06):
        post(k, x, zf - 0.04, 0.92, 0.09)
    k.box('darkwood', x1 - x0, 0.08, 0.1, (x0 + x1) / 2, 0.84, zf - 0.04)
    # finished legs hung along the front plate for the customers
    for i in range(4):
        x = 0.05 + i * 0.13 + (0.45 if i > 1 else 0)
        k.beam('rope', V(x, 0.8, zf + 0.04), V(x, 0.68, zf + 0.04), 0.008, round_=True, seg=4)
        peg_leg(k, x, 0.34, zf + 0.04, 0.8)
    # peg legs on pegs along the back boards
    for i in range(7):
        x = x0 + 0.25 + i * 0.13
        k.cyl('wood', 0.008, 0.008, 0.06, x, 0.83, zb + 0.03, seg=5, rx=math.pi / 2)
        peg_leg(k, x, 0.42 + (i % 2) * 0.02, zb + 0.07, 0.95, rx=0.1)
    # saws, a brace and an adze on the boards to the right
    if not k.lod:
        for i, (L, hgt) in enumerate(((0.42, 0.11), (0.3, 0.09))):
            x = 1.25 + i * 0.12
            k.mesh('iron', [V(x - 0.02, 0.92, zb + 0.05), V(x + 0.04, 0.92, zb + 0.05), V(x + 0.01, 0.92 - L, zb + 0.05), V(x - 0.02, 0.92 - L, zb + 0.05)], [(3, 2, 1, 0)])
            k.box('wood', 0.04, 0.08, 0.02, x + 0.01, 0.9, zb + 0.06)
        k.beam('wood', V(1.6, 0.9, zb + 0.06), V(1.6, 0.55, zb + 0.06), 0.025, round_=True, seg=5)
        k.cbox('iron', 0.08, 0.025, 0.02, 1.63, 0.55, zb + 0.06)
    # bench along the back with a vise, planes and a leg blank
    workbench(k, 1.3, zb + 0.28, 0.85, 0.32)
    if not k.lod:
        for i in range(2):
            k.box('darkwood', 0.14, 0.05, 0.05, 1.05 + i * 0.2, 0.42, zb + 0.24)
            k.cbox('wood', 0.025, 0.04, 0.03, 1.05 + i * 0.2 - 0.03, 0.5, zb + 0.24, rz=0.4)
        k.cyl('bark', 0.05, 0.05, 0.42, 1.25, 0.47, zb + 0.32, seg=8, rz=-math.pi / 2)
    # the pole lathe: bed on legs, two poppets, a leg between centres, cord to a treadle and the spring pole
    lx, lz = 0.25, 0.05
    k.push(lx, 0, lz)
    for sx in (-1, 1):
        k.beam('wood', V(sx * 0.4, 0, -0.1), V(sx * 0.4, 0.45, 0), 0.05)
        k.beam('wood', V(sx * 0.4, 0, 0.1), V(sx * 0.4, 0.45, 0), 0.05)
    for sz in (-1, 1):
        k.box('wood', 1.0, 0.07, 0.06, 0, 0.45, sz * 0.05)
    for sx in (-1, 1):
        k.box('darkwood', 0.07, 0.22, 0.12, sx * 0.24, 0.52, 0)
        k.cyl('iron', 0.008, 0.002, 0.03, sx * 0.205, 0.66, 0, seg=5, rz=sx * math.pi / 2)
    peg_leg(k, 0.205, 0.66, 0.0, 0.92, rz=math.pi / 2)
    k.box('wood', 0.03, 0.03, 0.3, 0.0, 0.62, 0.12)   # tool rest
    k.beam('wood', V(-0.3, 0.02, 0.35), V(0.25, 0.08, 0.35), 0.06, 0.03)  # treadle
    k.beam('rope', V(0.0, 0.08, 0.35), V(0.0, 0.66, 0.035), 0.007, round_=True, seg=4)
    k.beam('rope', V(0.0, 0.7, 0.0), V(0.0, 0.94, -0.05), 0.007, round_=True, seg=4)
    k.pop()
    k.beam('bark', V(1.05, 0.62, zb + 0.08), V(lx, 0.95, lz - 0.05), 0.045, round_=True)
    k.box('wood', 0.07, 0.62, 0.07, 1.05, 0, zb + 0.08)
    heap(k, 'thatch', lx + 0.05, lz + 0.05, 0.38, 0.06, seed=6.0, sq=0.6)
    # timber: blanks and boards, a ship's wheel and a rudder in for repair, oars
    board_stack(k, 1.32, 0.22, 0.75, 3, 3, bw=0.1, ry=0.0)
    ships_wheel(k, -1.62, 0.36, 0.58, 0.24, ry=0.1, rx=-0.15)
    k.push(-0.2, 0, 0.66, 0.0)
    k.mesh('planksDark', [V(-0.08, 0.02, 0), V(0.12, 0.02, 0), V(0.16, 0.5, 0), V(0.0, 0.95, 0), V(-0.08, 0.95, 0)], [(0, 1, 2, 3, 4), (4, 3, 2, 1, 0)], uvscale=1.4)
    if not k.lod:
        for yy in (0.3, 0.6, 0.85):
            k.box('iron', 0.16, 0.03, 0.03, -0.0, yy, 0.0)
    k.pop()
    for i in range(3):
        k.beam('wood', V(1.55 + i * 0.04, 0, zb + 0.12), V(1.6 + i * 0.03, 1.0, zb + 0.06), 0.025, round_=True, seg=6)
        k.cbox('wood', 0.07, 0.25, 0.015, 1.555 + i * 0.04, 0.13, zb + 0.12)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- sawmill

def trestle(k, x, z, h, L=0.75, ry=0.0):
    """a heavy sawing trestle: a head beam on four splayed legs, braced"""
    k.push(x, 0, z, ry)
    k.box('darkwood', 0.14, 0.12, L, 0, h - 0.12, 0)
    for sz in (-1, 1):
        for sx in (-1, 1):
            k.beam('wood', V(sx * 0.2, 0, sz * (L / 2 - 0.02)), V(sx * 0.05, h - 0.1, sz * (L / 2 - 0.08)), 0.07)
        k.box('wood', 0.36, 0.05, 0.04, 0, h * 0.35, sz * (L / 2 - 0.05))
    k.pop()


def pick(k, x, z, ry=0.0, lean=0.25):
    k.push(x, 0, z, ry, -lean)
    k.beam('wood', V(0, 0, 0), V(0, 0.48, 0), 0.025, round_=True, seg=5)
    k.beam('iron', V(-0.15, 0.44, 0), V(0, 0.5, 0), 0.02)
    k.beam('iron', V(0, 0.5, 0), V(0.15, 0.44, 0), 0.02)
    k.pop()


def shovel(k, x, z, ry=0.0, lean=0.25):
    k.push(x, 0, z, ry, -lean)
    k.cbox('iron', 0.13, 0.17, 0.01, 0, 0.09, 0, rx=0.1)
    k.beam('wood', V(0, 0.16, 0), V(0, 0.62, 0), 0.022, round_=True, seg=5)
    k.box('wood', 0.09, 0.02, 0.02, 0, 0.62, 0)
    k.pop()


@building('sawmill')
def sawmill(k):
    """a pit-sawyers' mill: a long open shed on heavy posts under a shingle roof sheltering a great log on
    high trestles with a pit saw standing in the cut and the sawn end falling away in boards, sawdust
    below; seasoning stacks of boards under cover and outside, a pile of trunks on skids, and sheerlegs
    lifting the next log"""
    yard(k, 5.6, 3.6, seed=19.0)
    sx_, sz_, w, d, h = 0.1, -0.35, 3.3, 1.9, 1.5
    k.push(sx_, 0, sz_)
    open_frame(k, [-w / 2, 0.0, w / 2], [-d / 2, d / 2], h, s=0.15)
    shingle_gable(k, w, d, 0.75, h, over=0.25, gable='oldplanks', gable_kind='boards')
    k.pop()
    # the log on its trestles, sawn from the right end
    ty = 0.86
    trestle(k, -0.6, -0.15, ty)
    trestle(k, 0.85, -0.15, ty)
    r, ly, lz = 0.21, ty + 0.21, -0.15
    xc = 0.42    # where the saw is
    k.push(-0.35, ly, lz)
    k.cyl('bark', r, r * 0.95, xc + 0.35 + 0.75, -0.75, 0, 0, seg=12, rz=-math.pi / 2)
    if not k.lod:
        k.cyl('planks', r * 0.9, r * 0.9, 0.012, -0.754, 0, 0, seg=12, rz=math.pi / 2)
    k.pop()
    # the sawn part: slabs and boards standing apart by the kerf
    n = 5
    for i in range(n):
        z0 = -r + i * 2 * r / n
        zc_ = z0 + r / n
        chord = 2 * math.sqrt(max(0.0, r * r - zc_ * zc_))
        mat = 'bark' if i in (0, n - 1) else 'planks'
        k.box(mat, 1.25 - xc + 0.02, chord * 0.97, 2 * r / n - 0.008, xc + (1.25 - xc) / 2 + 0.01, ly - chord / 2, lz + zc_ + (i - (n - 1) / 2) * 0.004, uvscale=1.3)
    # pit saw standing in the kerf: blade, top tiller and the box handle below
    k.box('iron', 0.09, 1.2, 0.006, xc, 0.22, lz)
    if not k.lod:
        for i in range(24):
            k.cbox('iron', 0.012, 0.03, 0.005, xc + 0.045, 0.24 + i * 0.048, lz, rz=0.5)
    k.box('wood', 0.04, 0.05, 0.36, xc, 1.4, lz)
    k.box('wood', 0.05, 0.04, 0.05, xc, 1.38, lz)
    k.box('wood', 0.035, 0.04, 0.3, xc, 0.2, lz)
    heap(k, 'thatch', xc + 0.05, lz + 0.05, 0.45, 0.13, seed=8.0, sq=0.8)
    # chalk line pegs and a cant hook on the log
    if not k.lod:
        k.beam('wood', V(-0.6, ly + r, lz - 0.3), V(-0.1, ly + 0.05, lz + 0.5), 0.03, round_=True)
        k.beam('iron', V(-0.1, ly + 0.05, lz + 0.5), V(0.0, ly - 0.05, lz + 0.42), 0.015)
    # seasoning boards under the back of the shed
    board_stack(k, 0.1, -1.0, 2.6, 4, 5, bw=0.13, bt=0.035)
    # outside right: a second stack running along the side
    board_stack(k, 2.32, -0.25, 1.9, 4, 7, bw=0.12, bt=0.035, ry=math.pi / 2)
    if not k.lod:
        k.beam('rope', V(2.06, 0.62, -0.25), V(2.58, 0.62, -0.25), 0.012)
    # trunks waiting on skids, outside left, chocked
    k.push(-2.3, 0, -0.3)
    for zz in (-0.55, 0.55):
        k.box('darkwood', 0.95, 0.07, 0.09, 0, 0, zz)
    y = 0.07
    rows = (4, 3, 2)
    rr = 0.13
    for j, m in enumerate(rows):
        for i in range(m):
            x = (i - (m - 1) / 2) * rr * 2.05
            rad = rr * (0.9 + k.r() * 0.2)
            log(k, x, y + rr + j * rr * 1.75, 0.0, 1.55 + k.r() * 0.15, rad, ry=math.pi / 2 + (k.r() - 0.5) * 0.05)
    for sx in (-1, 1):
        k.cbox('wood', 0.06, 0.12, 0.06, sx * 0.46, 0.12, 0.55)
        k.cbox('wood', 0.06, 0.12, 0.06, sx * 0.46, 0.12, -0.55)
    k.pop()
    # sheerlegs (a tripod with tackle) lifting the next log
    ax, az = -1.25, 1.2
    apex = V(ax, 1.95, az)
    for (fx, fz) in ((-0.55, 0.35), (0.55, 0.35), (0.0, -0.55)):
        k.beam('bark', V(ax + fx, 0, az + fz), apex + V(fx * 0.04, 0.04, fz * 0.04), 0.07, round_=True)
    k.torus('rope', 0.06, 0.018, ax, 1.9, az, seg=10)
    k.cbox('darkwood', 0.07, 0.14, 0.05, ax, 1.72, az)
    k.beam('rope', V(ax, 1.65, az), V(ax, 0.62, az), 0.014, round_=True, seg=4)
    k.beam('rope', V(ax + 0.02, 1.68, az), V(ax + 0.48, 0.05, az + 0.32), 0.012, round_=True, seg=4)
    k.beam('iron', V(ax - 0.12, 0.6, az), V(ax, 0.64, az), 0.012, round_=True, seg=4)
    k.beam('iron', V(ax + 0.12, 0.6, az), V(ax, 0.64, az), 0.012, round_=True, seg=4)
    log(k, ax, 0.48, az, 1.5, 0.17, ry=0.05)
    # a grindstone and a water butt for the saws
    k.push(1.35, 0, 1.2, 0.4)
    for s in (-1, 1):
        k.box('wood', 0.05, 0.36, 0.05, s * 0.11, 0, 0)
    k.cyl('stoneDark', 0.17, 0.17, 0.07, 0, 0.36, -0.035, seg=18, rx=math.pi / 2)
    k.beam('iron', V(-0.16, 0.36, 0), V(0.18, 0.36, 0), 0.016, round_=True, seg=5)
    k.beam('iron', V(0.18, 0.36, 0), V(0.18, 0.26, 0.05), 0.012, round_=True, seg=4)
    k.pop()
    cask(k, 1.85, 1.25, 0.9)
    cask(k, 2.5, 1.35, 0.85)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- iron mine

def ore_cart(k, x, z, ry=0.0, gauge=0.22):
    """a wooden mine tub on four iron wheels, banded, heaped with ore"""
    k.push(x, 0, z, ry)
    for sz in (-1, 1):
        for sx in (-1, 1):
            k.push(sx * (gauge / 2 + 0.012), 0.07, sz * 0.15, math.pi / 2)
            k.cyl('iron', 0.065, 0.065, 0.025, 0, 0, -0.0125, seg=10, rx=math.pi / 2)
            k.pop()
        k.box('iron', gauge + 0.06, 0.02, 0.02, 0, 0.06, sz * 0.15)
    frustum(k, 'planksDark', 0, 0.1, 0, 0.3, 0.42, 0.36, 0.5, 0.26, uvscale=1.4)
    if not k.lod:
        for yy in (0.12, 0.33):
            t = (yy - 0.1) / 0.26
            frustum(k, 'iron', 0, yy, 0, 0.3 + 0.06 * t + 0.012, 0.42 + 0.08 * t + 0.012, 0.3 + 0.06 * t + 0.014, 0.42 + 0.08 * t + 0.014, 0.025, bottom=False)
    heap(k, 'soil', 0, 0, 0.17, 0.1, seed=5.0, y=0.33, rz=0.23, lumps=9, lumpsize=0.045, lumpmat='terracotta')
    k.pop()


def rails(k, x, z0, z1, gauge=0.22):
    L = z1 - z0
    n = max(2, round(L / 0.2))
    for i in range(n):
        k.box('wood', gauge + 0.16, 0.03, 0.06, x, 0.0, z0 + (i + 0.5) * L / n, ry=(k.r() - 0.5) * 0.06)
    for s in (-1, 1):
        k.box('iron', 0.02, 0.03, L, x + s * gauge / 2, 0.03, (z0 + z1) / 2)


@building('iron_mine')
def iron_mine(k):
    """an iron mine: a timbered adit driven into a rust-streaked rock face, rails running out to a tub of
    ore, a winding shaft with its windlass and kibble, an ore pile and a spoil heap, picks and shovels"""
    yard(k, 3.6, 2.7, seed=21.0, mat='dirt')
    # the hillside: an earthen bank with grey rock breaking through, a cutting for the adit
    heap(k, 'dirt', 0.0, -0.92, 1.78, 1.3, seed=31.0, rz=0.58, uvscale=0.8)
    crag = [(-0.88, 0.0, -0.5, 0.3, 0.62, 0.28, 0.3), (0.26, 0.0, -0.52, 0.32, 0.7, 0.28, -0.2), (-0.32, 0.86, -0.62, 0.5, 0.24, 0.26, 1.1),
            (0.95, 0.25, -0.8, 0.4, 0.45, 0.3, 0.5), (-1.3, 0.15, -0.75, 0.35, 0.4, 0.3, 0.8), (0.3, 0.9, -1.0, 0.42, 0.42, 0.3, 0.6),
            (-0.75, 1.0, -1.05, 0.3, 0.3, 0.25, 2.0), (1.45, 0.0, -0.55, 0.22, 0.25, 0.2, 1.0), (-1.55, 0.0, -0.35, 0.18, 0.2, 0.18, 0.3)]
    for i, (x, y, z, sx, sy, sz, ry) in enumerate(crag):
        rock(k, 'stoneDark' if i % 4 == 3 else 'stone', x, y, z, sx, sy, sz, seed=i * 3.3 + 0.7, sub=3, rough=0.28, ry=ry, floor=0.0 if y < 0.01 else None, uvscale=1.2)
    if not k.lod:
        # rusty ore showing in the face
        for i in range(16):
            rock(k, 'terracotta' if i % 3 else 'red', -1.2 + k.r() * 2.4, 0.15 + k.r() * 0.7, -0.5 - k.r() * 0.15, 0.07, 0.035, 0.03, seed=i * 2.1, sub=1, rough=0.3, ry=k.r())
        for (x, y, z, sc) in ((-1.1, 0.85, -0.95, 1.0), (0.0, 1.28, -1.0, 1.2), (0.85, 0.95, -1.05, 0.9), (1.35, 0.5, -0.9, 0.8), (-0.55, 1.2, -1.15, 0.8),
                              (-1.5, 0.3, -0.85, 0.7), (0.65, 0.6, -0.62, 0.6), (-0.1, 1.05, -0.75, 0.6)):
            bush(k, x, y, z, sc)
    # the adit: a timber set of round props and a cap, lagging above, the dark heading behind
    ax, az = -0.32, -0.36
    k.box('black', 0.56, 0.82, 0.8, ax, 0.0, az - 0.42)
    k.box('soil', 0.56, 0.01, 0.4, ax, 0.0, az - 0.2)
    for sx in (-1, 1):
        k.beam('bark', V(ax + sx * 0.34, 0, az), V(ax + sx * 0.3, 0.86, az), 0.1, round_=True, seg=8)
        k.beam('bark', V(ax + sx * 0.34, 0, az - 0.35), V(ax + sx * 0.3, 0.86, az - 0.35), 0.09, round_=True, seg=8)
    k.beam('bark', V(ax - 0.5, 0.9, az), V(ax + 0.5, 0.9, az), 0.12, round_=True, seg=8)
    k.beam('bark', V(ax - 0.42, 0.9, az - 0.35), V(ax + 0.42, 0.9, az - 0.35), 0.1, round_=True, seg=8)
    if not k.lod:
        for i in range(6):
            k.box('oldplanks', 0.09, 0.03, 0.45, ax - 0.27 + i * 0.105, 0.96, az - 0.18, ry=(k.r() - 0.5) * 0.08, uvscale=1.3)
    lantern(k, ax + 0.3, 0.78, az + 0.05)
    # rails out of the heading to the tip, a loaded tub
    rails(k, ax, az - 0.5, 1.25)
    ore_cart(k, ax, 0.55)
    # ore pile and spoil heap
    heap(k, 'soil', -1.25, 0.7, 0.45, 0.32, seed=7.0, lumps=30, lumpsize=0.06, lumpmat='terracotta')
    heap(k, 'dirt', 1.3, 0.85, 0.5, 0.3, seed=9.0, lumps=26, lumpsize=0.06, lumpmat='stone')
    # the winding shaft: a timber collar, windlass on A-frames, rope down to a kibble
    k.push(0.82, 0, 0.15)
    for (zz, ww, dd) in ((-0.27, 0.62, 0.1), (0.27, 0.62, 0.1)):
        k.box('darkwood', ww, 0.12, dd, 0, 0, zz)
    for xx in (-0.26, 0.26):
        k.box('darkwood', 0.1, 0.12, 0.44, xx, 0, 0)
    k.box('black', 0.42, 0.005, 0.44, 0, 0.003, 0)
    for sx in (-1, 1):
        k.beam('wood', V(sx * 0.33, 0.1, -0.22), V(sx * 0.33, 0.68, 0.0), 0.06)
        k.beam('wood', V(sx * 0.33, 0.1, 0.22), V(sx * 0.33, 0.68, 0.0), 0.06)
    k.cyl('bark', 0.07, 0.07, 0.62, -0.31, 0.68, 0.0, seg=10, rz=-math.pi / 2)
    if not k.lod:
        for i in range(5):
            k.push(-0.14 + i * 0.03, 0.68, 0.0, 0, 0, math.pi / 2)
            k.torus('rope', 0.075, 0.012, 0, 0, 0, seg=12)
            k.pop()
    for sx in (-1, 1):
        k.beam('iron', V(sx * 0.31, 0.68, 0), V(sx * 0.42, 0.68, 0), 0.025)
        k.beam('iron', V(sx * 0.42, 0.68, 0), V(sx * 0.42, 0.68 + 0.18 * sx, 0.06), 0.022)
        k.beam('wood', V(sx * 0.42, 0.68 + 0.18 * sx, 0.06), V(sx * 0.5, 0.68 + 0.18 * sx, 0.06), 0.028, round_=True, seg=5)
    k.beam('rope', V(0.0, 0.61, 0.05), V(0.0, 0.32, 0.05), 0.014, round_=True, seg=4)
    tub(k, 0.0, 0.05, 0.1, 0.16, fill='terracotta', y=0.12, hoops=2)
    k.beam('iron', V(-0.1, 0.28, 0.05), V(0.0, 0.33, 0.05), 0.008)
    k.beam('iron', V(0.1, 0.28, 0.05), V(0.0, 0.33, 0.05), 0.008)
    k.pop()
    # tools against the face by the adit
    pick(k, ax - 0.55, az + 0.12, ry=0.2, lean=0.3)
    pick(k, ax - 0.68, az + 0.08, ry=-0.3, lean=0.28)
    shovel(k, ax + 0.52, az + 0.12, ry=0.1, lean=0.3)
    bucket(k, 0.3, 0.9)
    crate(k, 1.55, 0, 0.1, 0.26, 0.3)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- blast furnace

def battered_stack(k, cx, cz, b0, b1, h, ops=(), rh=0.15, mat='stone'):
    """a square, battered masonry stack in courses of big blocks; ops are (face, width, height) openings at its foot"""
    if k.lod:
        frustum(k, mat, cx, 0, cz, b0, b0, b1, b1, h, uvscale=1.0)
        return
    frustum(k, 'stoneDark', cx, 0, cz, b0 - 0.1, b0 - 0.1, b1 - 0.1, b1 - 0.1, h, uvscale=2.0)
    rows = max(1, round(h / rh))
    rh = h / rows
    lean = math.atan2((b0 - b1) / 2, h)
    for r in range(rows):
        y = r * rh
        t = (y + rh / 2) / h
        size = b0 + (b1 - b0) * t
        for f in FACES:
            mine = [o for o in ops if o[0] == f and y < o[2]]
            k.push(cx, 0, cz)
            k.face(f, size, size)
            x = -size / 2 + (0.12 if (r + FACES.index(f)) % 2 else 0.0)
            if x > -size / 2:
                x0 = -size / 2
                k.cbox(mat if k.r() > 0.15 else 'coral', 0.105, rh - 0.016, 0.13, x0 + 0.06, y + rh / 2, -0.05, rx=-lean, uvscale=2.0)
            while x < size / 2 - 0.03:
                sw = min(size / 2 - x, 0.2 + k.r() * 0.16)
                if not any(x + sw > -o[1] / 2 and x < o[1] / 2 for o in mine):
                    q = k.r()
                    m = 'stoneDark' if q < 0.08 + 0.45 * t * t else (mat if q > 0.75 else 'coral')
                    hh = rh - 0.016 - k.r() * 0.035
                    k.cbox(m, sw - 0.016, hh, 0.13, x + sw / 2, y + rh / 2 + (k.r() - 0.5) * (rh - 0.016 - hh), -0.05,
                           rx=-lean + (k.r() - 0.5) * 0.04, rz=(k.r() - 0.5) * 0.05, uvscale=2.0)
                x += sw
            k.pop()
            k.pop()


def bellows(k, x, y, z, s=1.0, ry=0.0):
    """great leather bellows: teardrop boards with pleated hide between, nozzle toward local +z"""
    pts = []
    for i in range(14):
        a = TAU * i / 14
        r = 0.16 * s * (1 + 0.85 * max(0.0, -math.cos(a)) ** 1.5)
        pts.append((math.sin(a) * r * 0.9, math.cos(a) * r * 1.3))
    pts.reverse()
    k.push(x, y, z, ry)
    prism(k, 'planksDark', pts, 0.0, 0.03 * s, uvscale=1.3)
    if k.lod:
        prism(k, 'soil', [(a * 0.95, b * 0.95) for (a, b) in pts], 0.03 * s, 0.165 * s)
    else:
        for j in range(3):
            sc = 1.0 - 0.06 * (j % 2)
            prism(k, 'soil', [(a * sc * 0.97, b * sc * 0.97) for (a, b) in pts], (0.03 + j * 0.045) * s, (0.075 + j * 0.045) * s)
    prism(k, 'planksDark', pts, 0.165 * s, 0.195 * s, uvscale=1.3)
    k.cyl('brass', 0.03 * s, 0.018 * s, 0.24 * s, 0, 0.08 * s, 0.2 * s, seg=8, rx=math.pi / 2)
    k.pop()


@building('blast_furnace')
def blast_furnace(k):
    """a charcoal blast furnace: a battered stack of coursed stone with a deep tapping arch glowing at its
    foot and flame at its throat, a timber charging stage and stair at the back, a bellows house with two
    great bellows blowing into the tuyere, a sand casting floor laid out in sows and pigs, charcoal and ore"""
    yard(k, 4.6, 3.6, seed=23.0)
    fx, fz, b0, b1, fh = -0.55, -0.4, 1.45, 0.95, 2.2
    tw, th = 0.46, 0.66
    battered_stack(k, fx, fz, b0, b1, fh, ops=[('front', tw + 0.06, th + 0.02), ('right', 0.3, 0.55)])
    # tapping arch: piers projecting forward with a heavy lintel and a relieving course
    zf = fz + b0 / 2
    for sx in (-1, 1):
        k.box('stone', 0.24, th + 0.05, 0.42, fx + sx * (tw / 2 + 0.12), 0, zf - 0.12, uvscale=2.0)
    k.box('stoneDark', tw + 0.56, 0.18, 0.46, fx, th, zf - 0.13, uvscale=2.0)
    k.box('stone', tw + 0.4, 0.12, 0.36, fx, th + 0.18, zf - 0.17, uvscale=2.0)
    k.box('black', tw, th, 0.02, fx, 0, zf - 0.32)
    k.box('stoneDark', tw, 0.01, 0.45, fx, 0.0, zf - 0.1, uvscale=2.0)
    k.marker('glow:0.28x0.16x0.08', fx, 0.12, zf - 0.27)
    k.box('fire', 0.06, 0.02, 0.5, fx, 0.0, zf + 0.2)
    # tuyere arch on the bellows side
    k.box('black', 0.02, 0.55, 0.3, fx + b0 / 2 - 0.06, 0, fz)
    k.box('stoneDark', 0.18, 0.12, 0.5, fx + b0 / 2 - 0.02, 0.55, fz, uvscale=2.0)
    # the throat: a cast-iron charging ring and flames
    ty = fh
    k.box('stoneDark', b1 + 0.06, 0.08, b1 + 0.06, fx, ty, fz, uvscale=2.0)
    lathe(k, 'iron', [(0.3, 0), (0.3, 0.12), (0.26, 0.12), (0.26, 0.02)], fx, ty + 0.08, fz, seg=16, top=False)
    k.cyl('black', 0.27, 0.27, 0.01, fx, ty + 0.085, fz, seg=16)
    k.marker('glow:0.36x0.04x0.36', fx, ty + 0.1, fz)
    k.marker('smoke', fx, ty + 0.3, fz)
    # charging stage at the throat, on posts, with a stair down the back
    pz0, pz1 = fz - b1 / 2 - 0.02, -1.72
    px0, px1 = fx - 0.55, fx + 0.75
    k.push((px0 + px1) / 2, 0, (pz0 + pz1) / 2)
    deck(k, px1 - px0, pz0 - pz1, ty + 0.04, 'oldplanks', along='x', joists=True)
    k.pop()
    for x in (px0 + 0.05, px1 - 0.05):
        for z in (pz1 + 0.05,):
            post(k, x, z, ty - 0.08, 0.1)
        k.beam('wood', V(x, 0.3, pz1 + 0.05), V(x, ty - 0.12, pz0 - 0.05), 0.06)
    k.box('darkwood', px1 - px0, 0.08, 0.1, (px0 + px1) / 2, ty - 0.14, pz1 + 0.05)
    k.box('wood', px1 - px0, 0.04, 0.04, (px0 + px1) / 2, ty + 0.45, pz1 + 0.04)
    for x in (px0 + 0.05, (px0 + px1) / 2, px1 - 0.05):
        k.box('wood', 0.04, 0.45, 0.04, x, ty + 0.04, pz1 + 0.04)
    # stair: two stringers and treads rising from the yard to the stage
    sa, sb = V(2.1, 0.0, -1.5), V(px1, ty + 0.04, -1.5)
    for dz in (-0.17, 0.17):
        k.beam('wood', sa + V(0, 0.05, dz), sb + V(0, -0.02, dz), 0.05, 0.12)
    n = 14
    for i in range(1, n):
        p = sa + (sb - sa) * (i / n)
        k.box('oldplanks', 0.12, 0.03, 0.36, p.x, p.y, -1.5, uvscale=1.3)
    post(k, (sa.x + sb.x) / 2, -1.5, (sa.y + sb.y) / 2 - 0.05, 0.08)
    k.beam('wood', sa + V(0, 0.55, 0.17), sb + V(0, 0.45, 0.17), 0.035, round_=True)
    if not k.lod:
        # a barrow of charcoal and baskets on the stage
        lathe(k, 'weave', [(0.1, 0), (0.13, 0.12), (0.12, 0.125), (0.1, 0.02)], px0 + 0.3, ty + 0.04, pz1 + 0.25, seg=10, top=False, uvscale=3.0)
        k.cyl('black', 0.12, 0.12, 0.01, px0 + 0.3, ty + 0.15, pz1 + 0.25, seg=10)
    # the bellows house: open shed, two bellows on a frame and an overhead rocker
    bx, bz = 1.25, -0.3
    k.push(bx, 0, bz)
    open_frame(k, [-0.6, 0.6], [-0.5, 0.5], 1.05, s=0.1)
    shingle_gable(k, 1.2, 1.0, 0.42, 1.05, over=0.18, gable='oldplanks')
    for dz in (-0.2, 0.2):
        k.box('wood', 0.9, 0.06, 0.08, 0.05, 0.32, dz)
        for xx in (-0.35, 0.45):
            k.box('wood', 0.06, 0.32, 0.06, xx, 0, dz)
        bellows(k, 0.12, 0.38, dz, s=1.15, ry=-math.pi / 2)
    k.beam('wood', V(-0.45, 0.75, 0), V(0.6, 0.75, 0), 0.07)
    k.box('wood', 0.1, 0.2, 0.1, 0.55, 0.55, 0)
    for dz in (-0.2, 0.2):
        k.beam('iron', V(0.15, 0.75, dz * 0.4), V(0.15, 0.6, dz), 0.008, round_=True, seg=4)
    k.pop()
    # casting floor: sand bed with a runner, sows and pigs
    cz0 = zf + 0.25
    k.box('soil', 1.5, 0.03, 1.1, fx, 0, cz0 + 0.55, uvscale=1.0)
    k.box('black', 0.07, 0.002, 1.0, fx, 0.03, cz0 + 0.55)
    if not k.lod:
        for j in range(4):
            z = cz0 + 0.18 + j * 0.25
            for sx in (-1, 1):
                k.box('iron', 0.44, 0.03, 0.05, fx + sx * 0.28, 0.025, z)
                for i in range(4):
                    k.box('iron', 0.04, 0.03, 0.09, fx + sx * (0.12 + i * 0.1), 0.025, z + 0.07)
        k.box('fire', 0.05, 0.004, 0.25, fx, 0.032, cz0 + 0.15)
    # charcoal and ore
    heap(k, 'black', -1.75, 0.95, 0.5, 0.42, seed=12.0, lumps=20, lumpsize=0.04)
    heap(k, 'soil', -1.8, -0.35, 0.45, 0.36, seed=13.0, lumps=26, lumpsize=0.05, lumpmat='terracotta')
    bar_stack(k, 1.55, 1.1, 12, 0.5, ry=0.2)
    k.beam('iron', V(0.35, 0.0, 0.45), V(0.25, 1.05, 0.15), 0.025, round_=True)  # tapping bar
    shovel(k, -1.3, 0.3, ry=0.8, lean=0.3)
    cask(k, 2.05, 0.5, 0.85)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- cannon foundry

def shot_pile(k, x, z, n=4, r=0.055):
    """round shot in a square pyramid"""
    for j in range(n):
        m = n - j
        for a in range(m):
            for b in range(m):
                xx = x + (a - (m - 1) / 2) * r * 2
                zz = z + (b - (m - 1) / 2) * r * 2
                if k.lod and j < n - 1 and 0 < a < m - 1 and 0 < b < m - 1:
                    continue
                rock(k, 'iron', xx, r + j * r * 1.41, zz, r, r, r, sub=2, rough=0.0)


@building('cannon_foundry')
def cannon_foundry(k):
    """a gun foundry: a stone casting hall under tiles, a brick air furnace with a tall stack, a clay runner
    to the casting pit where moulds stand rammed in the earth, a timber gantry with a crab and chain lifting
    a new-cast barrel, barrels cooling on skids, a finished gun on its carriage, shot and pig iron"""
    yard(k, 5.6, 4.6, seed=25.0)
    # the hall
    w, d, h = 2.8, 1.7, 1.35
    hx, hz = -1.35, -1.35
    k.push(hx, 0, hz)
    plinth(k, w + 0.06, d + 0.06, 0.1)
    k.push(0, 0.1, 0)
    plastered(k, w, d, h, 'plaster', [Op('front', -0.65, 'arch', w=0.7, h=1.05), Op('front', 0.55, 'arch', w=0.7, h=1.05), Op('left', 0.0, 'window', bars=True),
                                       Op('right', 0.0, 'window', bars=True), Op('back', 0.0, 'window', bars=True)], quoins='stone')
    tile_gable(k, w, d, 0.7, over=0.2, y=h, gable='plaster', tile_len=0.2, tile_w=0.135)
    k.pop()
    k.pop()
    # air furnace with its stack
    fx, fz = 1.15, -1.55
    brick_block(k, fx, fz, 1.2, 0.85, 0.9)
    lathe(k, 'terracotta', [(0.45, 0), (0.42, 0.1), (0.32, 0.2), (0.15, 0.26), (0.001, 0.27)], fx, 0.9, fz, seg=14, top=False, sz=0.75, uvscale=2.0)
    k.box('black', 0.26, 0.24, 0.02, fx - 0.25, 0.12, fz + 0.455)
    k.box('iron', 0.32, 0.03, 0.03, fx - 0.25, 0.37, fz + 0.46)
    k.marker('glow:0.22x0.18x0.04', fx - 0.25, 0.22, fz + 0.45)
    k.box('black', 0.2, 0.14, 0.02, fx + 0.3, 0.3, fz + 0.455)
    chimney(k, fx + 0.1, -2.05, 0.0, 3.3, 0.48)
    # clay runner to the pit
    px, pz = 1.35, 0.35
    for i in range(6):
        t0, t1 = i / 6, (i + 1) / 6
        a = V(fx + 0.3, 0.3 - 0.2 * t0, fz + 0.5 + (pz - 0.55 - fz - 0.5) * t0)
        b = V(fx + 0.3, 0.3 - 0.2 * t1, fz + 0.5 + (pz - 0.55 - fz - 0.5) * t1)
        k.beam('terracotta', a, b, 0.12, 0.06)
    for i in range(3):
        y = 0.12 + 0.18 * (2 - i) / 2
        k.box('wood', 0.05, y, 0.05, fx + 0.3, 0, fz + 0.75 + i * 0.32)
    # the casting pit: a stone curb rammed full of earth with moulds standing in it
    for (x, z, L, ry) in ((px, pz - 0.55, 1.2, 0), (px, pz + 0.55, 1.2, 0), (px - 0.55, pz, 0.9, math.pi / 2), (px + 0.55, pz, 0.9, math.pi / 2)):
        rubble_wall(k, x, z, L, 0.26, 0.18, ry=ry, ends=False, faces=('front',))
    k.box('soil', 1.0, 0.24, 0.92, px, 0, pz)
    for (dx, dz) in ((-0.22, -0.15), (0.2, 0.18)):
        lathe(k, 'terracotta', [(0.12, 0), (0.12, 0.2), (0.1, 0.26), (0.06, 0.3), (0.06, 0.36), (0.04, 0.36), (0.04, 0.3)], px + dx, 0.24, pz + dz, seg=12, top=True)
        k.torus('iron', 0.123, 0.008, px + dx, 0.32, pz + dz, seg=12, rseg=3)
        k.torus('iron', 0.123, 0.008, px + dx, 0.4, pz + dz, seg=12, rseg=3)
    # gantry over the pit
    gy = 2.05
    for gx in (px - 0.82, px + 0.82):
        for sz in (-1, 1):
            k.beam('wood', V(gx, 0, pz + sz * 0.6), V(gx, gy, pz), 0.11)
        k.box('wood', 0.08, 0.06, 0.9, gx, 0.55, pz)
        k.cbox('darkwood', 0.14, 0.16, 0.14, gx, gy + 0.02, pz)
    k.box('darkwood', 1.9, 0.14, 0.14, px, gy + 0.08, pz)
    k.box('darkwood', 0.2, 0.1, 0.22, px + 0.05, gy - 0.02, pz)   # the crab
    k.cbox('darkwood', 0.07, 0.18, 0.06, px + 0.05, gy - 0.18, pz)
    k.beam('iron', V(px + 0.05, gy - 0.28, pz), V(px + 0.05, 1.62, pz), 0.02, round_=True, seg=4)
    cannon_barrel(k, px + 0.05, 0.62, pz, s=0.95, rz=0.0)
    for s in (-1, 1):
        k.beam('iron', V(px + 0.05, 1.62, pz), V(px + 0.05 + s * 0.09, 1.42, pz), 0.012, round_=True, seg=4)
    # winch on the near frame
    k.cyl('wood', 0.06, 0.06, 0.36, px + 0.82, 0.75, pz - 0.18, seg=10, rx=math.pi / 2)
    k.beam('iron', V(px + 0.86, 0.75, pz + 0.2), V(px + 0.86, 0.88, pz + 0.26), 0.02)
    # a flagstaff on the gantry
    k.cyl('wood', 0.02, 0.015, 0.75, px - 0.82, gy + 0.1, pz, seg=6)
    k.marker('flag', px - 0.82, gy + 0.85, pz)
    # barrels cooling on skids
    for zz in (0.55, 1.35):
        k.box('darkwood', 2.0, 0.08, 0.1, -1.35, 0, zz)
    for i in range(4):
        cannon_barrel(k, -2.15 + i * 0.52, 0.18, 0.45, ry=-math.pi / 2, s=0.98 - 0.05 * (i % 2))
    # a finished gun, shot, pig iron and fuel
    gun_carriage(k, 0.55, 1.6, ry=0.3, s=1.0)
    shot_pile(k, -0.35, 1.85, 4, 0.05)
    bar_stack(k, -2.2, 1.85, 12, 0.5, ry=0.1)
    k.push(2.35, 0, 1.45)
    for j, m in enumerate((3, 2)):
        for i in range(m):
            log(k, (i - (m - 1) / 2) * 0.2, 0.095 + j * 0.17, 0, 0.9, 0.095, ry=math.pi / 2)
    k.pop()
    heap(k, 'black', -0.1, -0.15, 0.45, 0.3, seed=14.0, lumps=12, lumpsize=0.04)
    return {'ao': 1024}
