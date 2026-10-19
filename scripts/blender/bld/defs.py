"""Building definitions. Each takes a Kit and builds in game coordinates (front +z, centred, ground y=0).
Returns optional bake options. Footprints are in tiles (see src/sim/data/buildings.ts)."""
import math
from mathutils import Vector
from arch import *

REGISTRY = {}


def building(name):
    def deco(fn):
        REGISTRY[name] = fn
        return fn
    return deco


# ------------------------------------------------------------------------------------------- houses

@building('housing_plot@5')
def house5(k):
    """a wattle-and-daub cottage, timber framed, under a deep grass thatch"""
    w, d, h = 1.9, 1.35, 0.95
    plinth(k, w + 0.08, d + 0.08, 0.14)
    k.push(0, 0.14, 0)
    framed(k, w, d, h, 'plasterYellow', [Op('front', -0.35, 'door', h=0.8), Op('front', 0.45, 'window'), Op('left', 0.0, 'window'), Op('back', 0.3, 'window')])
    thatch_gable(k, w, d, 0.78, over=0.3, y=h)
    chimney(k, w / 2 + 0.1, 0.0, -0.14, h + 1.05, 0.3)
    k.pop()
    steps(k, -0.35, d / 2 + 0.1, 0.5, 0.14, 1, 'stone')
    # dooryard
    cask(k, 0.95, 0.85, 1.0)
    cask(k, 1.2, 0.7, 0.85)
    k.box('planks', 0.6, 0.05, 0.14, 0.45, 0.22, 0.95)  # bench
    for x in (0.2, 0.7):
        k.box('wood', 0.05, 0.22, 0.1, x, 0, 0.95)
    rope_coil(k, -1.0, 0.85)
    crate(k, -1.1, 0, 0.35, 0.28, 0.3)
    fence(k, -1.4, 1.3, 1.4, 1.3)
    return {'ao': 1024}


@building('housing_plot@1')
def house1(k):
    """a claim staked out with rope and a painted board"""
    for (x, z) in ((-1.1, -1.0), (1.1, -1.0), (1.1, 1.0), (-1.1, 1.0)):
        k.cyl('bark', 0.035, 0.03, 0.42, x, 0, z, seg=7)
        k.cyl('wood', 0.03, 0.005, 0.06, x, 0.42, z, seg=7)
    for (a, b) in (((-1.1, -1.0), (1.1, -1.0)), ((1.1, -1.0), (1.1, 1.0)), ((1.1, 1.0), (-1.1, 1.0)), ((-1.1, 1.0), (-1.1, -1.0))):
        k.beam('rope', V(a[0], 0.36, a[1]), V(b[0], 0.33, b[1]), 0.014, round_=True, seg=5)
    k.cyl('bark', 0.03, 0.03, 0.6, 0.0, 0, 1.0, seg=7)
    k.box('oldplanks', 0.5, 0.22, 0.03, 0.0, 0.32, 1.02, uvscale=1.4)
    k.marker('sign:FOR RENT', 0.0, 0.53, 1.05)
    # cleared, scuffed ground and a pile of salvage waiting to be used
    k.box('dirt', 2.1, 0.012, 1.9, 0, 0, 0)
    for i in range(5):
        k.box('oldplanks', 0.9, 0.035, 0.1, -0.5, i * 0.036, -0.4 + i * 0.03, ry=0.1 * i, uvscale=1.4)
    crate(k, 0.6, 0, -0.4, 0.26, 0.4)
    return {'ao': 512}


@building('housing_plot@2')
def house2(k):
    """a sailcloth lean-to rigged on poles with a cookfire"""
    w, d, h = 1.4, 1.1, 0.8
    for x in (-w / 2, w / 2):
        k.cyl('bark', 0.035, 0.03, h + 0.1, x, 0, d / 2, seg=7)
        k.cyl('bark', 0.03, 0.03, 0.35, x, 0, -d / 2, seg=7)
    k.beam('bark', V(-w / 2 - 0.1, h, d / 2), V(w / 2 + 0.1, h, d / 2), 0.05, round_=True)
    # sagging canvas from the ridge pole down to the ground pegs at the back
    nx, nz = 12, 8
    verts, faces = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            x = -w / 2 - 0.05 + (w + 0.1) * i / nx
            y = h * (1 - t) + 0.02 - 0.06 * math.sin(math.pi * i / nx) * math.sin(math.pi * t)
            verts.append(V(x, y, d / 2 - (d + 0.1) * t))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    k.mesh('canvas', verts, faces, uvscale=2.0)
    # side flaps and guy ropes
    for x in (-w / 2, w / 2):
        k.beam('rope', V(x, h, d / 2), V(x * 1.5, 0.0, d / 2 + 0.35), 0.01, round_=True, seg=4)
        k.cyl('wood', 0.015, 0.01, 0.08, x * 1.5, 0, d / 2 + 0.35, seg=5)
    # bedding, chest and a cookfire ringed with stones
    k.box('canvasRed', 0.6, 0.05, 0.35, -0.25, 0, -0.1)
    k.box('canvas', 0.5, 0.06, 0.3, 0.3, 0, -0.15)
    crate(k, 0.5, 0, 0.25, 0.22, 0.3)
    for i in range(8):
        a = i / 8 * math.tau
        k.cbox('stone', 0.07, 0.05, 0.06, 0.25 + math.cos(a) * 0.16, 0.025, 0.95 + math.sin(a) * 0.16, ry=a, uvscale=2.0)
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        k.beam('bark', V(0.25 + math.cos(a) * 0.12, 0.02, 0.95 + math.sin(a) * 0.12), V(0.25 - math.cos(a) * 0.02, 0.1, 0.95 - math.sin(a) * 0.02), 0.03, round_=True, seg=5)
    k.marker('smoke', 0.25, 0.15, 0.95)
    # spit over the fire
    for s in (-1, 1):
        k.beam('wood', V(0.25 + s * 0.2, 0, 0.95), V(0.25 + s * 0.17, 0.28, 0.95), 0.02, round_=True, seg=5)
    k.beam('iron', V(0.03, 0.26, 0.95), V(0.47, 0.26, 0.95), 0.012, round_=True, seg=5)
    cask(k, -0.75, 0.75, 0.75)
    return {'ao': 512}


@building('housing_plot@3')
def house3(k):
    """a hovel of driftwood and ship's timbers under a lean-to of palm thatch"""
    w, d, h = 1.45, 1.1, 0.72
    k.push(0, 0, 0)
    board_batten(k, w, d, h, 'oldplanks', [Op('front', -0.2, 'door', w=0.4, h=0.66), Op('right', 0.0, 'window', w=0.24, h=0.22, y=0.35, shutters=False)])
    # a lean-to thatch, high at the back
    hi, lo = h + 0.38, h - 0.02
    _slope = 0
    for i in range(1):
        pass
    k.push(0, 0, 0)
    verts = []
    _thatch_lean(k, w + 0.3, d + 0.4, hi, lo)
    k.pop()
    k.pop()
    # salvage: a ship's hatch cover leaning on the wall, an oar, a barrel stove
    k.cbox('planksDark', 0.45, 0.6, 0.04, 0.5, 0.3, d / 2 + 0.12, rx=-0.25, uvscale=1.2)
    k.beam('wood', V(-0.7, 0.0, d / 2 + 0.2), V(-0.65, 0.95, d / 2 + 0.05), 0.03, round_=True)
    k.cbox('wood', 0.1, 0.18, 0.02, -0.7, 0.1, d / 2 + 0.19, rx=-0.15)
    cask(k, 0.95, 0.2, 0.9)
    rope_coil(k, 0.85, 0.75)
    for i in range(6):
        a = i / 6 * math.tau
        k.cbox('stone', 0.07, 0.05, 0.06, -0.1 + math.cos(a) * 0.14, 0.025, 1.05 + math.sin(a) * 0.14, ry=a, uvscale=2.0)
    k.marker('smoke', -0.1, 0.12, 1.05)
    return {'ao': 512}


def _thatch_lean(k, w, d, hi, lo):
    """palm thatch on a lean-to falling toward +z"""
    from arch import _slope_grid
    _slope_grid(k, 'thatchDark', -w / 2, w / 2, hi, lo, -d / 2, d / 2, 0.06, 0.03, 1.0, seed=7.7, fringe=0.12)
    for x in (-w / 2 + 0.1, 0.0, w / 2 - 0.1):
        k.beam('bark', V(x, hi - 0.06, -d / 2 + 0.05), V(x, lo - 0.06, d / 2 - 0.08), 0.045, round_=True)
    for x in (-w / 2 + 0.12, w / 2 - 0.12):
        k.cyl('bark', 0.035, 0.03, lo - 0.05, x, 0, d / 2 - 0.1, seg=7)


@building('housing_plot@4')
def house4(k):
    """a planked shack raised on stilts against damp and crabs, palm thatch, ladder steps"""
    w, d, h, lift = 1.55, 1.2, 0.78, 0.32
    stilts(k, w, d, lift)
    deck(k, w + 0.5, d + 0.1, lift + 0.035, 'planks', along='z')
    k.push(-0.2, lift, 0)
    clapboard(k, w - 0.4, d - 0.05, h, 'oldplanks', [Op('front', -0.15, 'door', w=0.38, h=0.68), Op('front', 0.35, 'window', w=0.24, h=0.24, y=0.36), Op('left', 0.0, 'window', w=0.24, h=0.24, y=0.36)])
    thatch_gable(k, w - 0.4, d - 0.05, 0.6, over=0.26, y=h, mat='thatchDark', gable='oldplanks', gable_kind='wattle', res=0.06)
    k.pop()
    steps(k, -0.35, d / 2 + 0.18, 0.4, lift, 3, 'planks')
    # a side platform with a hammock and drying fish
    for x in (0.95, 0.95):
        pass
    k.cyl('bark', 0.03, 0.03, 0.75, w / 2 + 0.2, lift, -0.45, seg=7)
    k.cyl('bark', 0.03, 0.03, 0.75, w / 2 + 0.2, lift, 0.45, seg=7)
    k.beam('rope', V(w / 2 + 0.2, lift + 0.7, -0.45), V(w / 2 + 0.2, lift + 0.7, 0.45), 0.01, round_=True, seg=4)
    for i in range(4):
        z = -0.32 + i * 0.2
        k.cbox('bone', 0.03, 0.14, 0.05, w / 2 + 0.2, lift + 0.6, z)
    k.mesh('canvasRed', [V(w / 2 - 0.05, lift + 0.5, -0.4), V(w / 2 - 0.05, lift + 0.5, 0.4), V(w / 2 - 0.05, lift + 0.32, 0.25), V(w / 2 - 0.05, lift + 0.32, -0.25)], [(0, 1, 2, 3), (3, 2, 1, 0)])
    cask(k, -0.85, 0.85, 0.85)
    crate(k, 0.65, 0, 0.9, 0.24, 0.5)
    return {'ao': 1024}


@building('housing_plot@6')
def house6(k):
    """a weatherboarded cottage, painted, with a shingled porch and a chimney"""
    w, d, h = 2.0, 1.4, 0.98
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    clapboard(k, w, d, h, 'planks', [Op('front', 0.0, 'door', h=0.82), Op('front', -0.6, 'window'), Op('front', 0.6, 'window'), Op('left', 0.0, 'window'), Op('back', -0.4, 'window')], trim='plaster')
    tile_free = False
    # wooden shingle roof (as a gable of two lean-tos)
    rise = 0.62
    for s in (-1, 1):
        k.push(0, 0, 0, 0 if s > 0 else math.pi)
        shingle_lean(k, w + 0.36, d / 2 + 0.24, h + rise, h - 0.15, z0=0.0, mat='planksDark')
        k.pop()
    k.beam('darkwood', V(-w / 2 - 0.2, h + rise + 0.02, 0), V(w / 2 + 0.2, h + rise + 0.02, 0), 0.08, 0.06)
    gables(k, w, d, rise, h, 'planks', 'boards', barge=True)
    chimney(k, -w / 2 + 0.35, -0.2, -0.12, h + rise + 0.4, 0.26)
    front_porch(k, w * 0.8, 0.5, h - 0.05, d / 2)
    k.pop()
    steps(k, 0, d / 2 + 0.64, 0.5, 0.22, 2, 'planks')
    cask(k, 0.9, 1.05, 0.8)
    k.box('planks', 0.5, 0.04, 0.13, -0.5, 0.36, d / 2 + 0.3)
    return {'ao': 1024}


@building('housing_plot@7')
def house7(k):
    """a lime-rendered stone house under Spanish barrel tiles, with a walled yard"""
    w, d, h = 2.1, 1.55, 1.05
    plinth(k, w + 0.06, d + 0.06, 0.12)
    k.push(0, 0.12, 0)
    plastered(k, w, d, h, 'plaster', [Op('front', 0.0, 'door', h=0.86), Op('front', -0.62, 'window', bars=True), Op('front', 0.62, 'window'), Op('left', 0.1, 'window'), Op('right', -0.2, 'window'), Op('back', 0.3, 'window')])
    tile_gable(k, w, d, 0.55, over=0.2, y=h, gable='plaster')
    chimney(k, w / 2 - 0.3, -d / 2 + 0.28, h - 0.1, 0.9, 0.26)
    k.pop()
    steps(k, 0, d / 2 + 0.1, 0.55, 0.12, 1, 'stone')
    # low rubble yard wall with a gateway
    for (a, b) in (((-1.35, 1.25), (-0.4, 1.25)), ((0.4, 1.25), (1.35, 1.25)), ((-1.35, 1.25), (-1.35, -0.2)), ((1.35, 1.25), (1.35, -0.2))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / 0.16))
        for i in range(n):
            t = (i + 0.5) / n
            x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            for r in range(3):
                k.cbox('stone', 0.15, 0.09, 0.14, x + (k.r() - 0.5) * 0.02, 0.05 + r * 0.09, z + (k.r() - 0.5) * 0.02, ry=math.atan2(b[1] - a[1], b[0] - a[0]) + (k.r() - 0.5) * 0.1, uvscale=2.0)
    for x in (-0.4, 0.4):
        k.box('stone', 0.18, 0.42, 0.18, x, 0, 1.25, uvscale=2.0)
    cask(k, 1.0, 0.95, 0.85)
    sack(k, -1.0, 0.95)
    sack(k, -0.85, 1.0, 0.9, 0.5)
    return {'ao': 1024}


@building('housing_plot@8')
def house8(k):
    """a two-storey timber-framed house, render infill, tiled roof and a street balcony"""
    w, d, h1, h2 = 2.2, 1.6, 0.95, 0.85
    plinth(k, w + 0.06, d + 0.06, 0.14)
    k.push(0, 0.14, 0)
    plastered(k, w, d, h1, 'plasterPink', [Op('front', -0.45, 'door', h=0.84), Op('front', 0.5, 'window'), Op('left', 0.0, 'window'), Op('back', 0.0, 'window')], quoins='stone')
    k.push(0, h1, 0)
    framed(k, w + 0.08, d + 0.08, h2, 'plasterPink', [Op('front', -0.55, 'door', h=0.72), Op('front', 0.5, 'window'), Op('left', 0.2, 'window'), Op('right', -0.1, 'window'), Op('back', -0.4, 'window'), Op('back', 0.4, 'window')])
    k.box('darkwood', w + 0.14, 0.07, d + 0.14, 0, -0.04, 0)  # jetty beam
    tile_gable(k, w + 0.08, d + 0.08, 0.6, over=0.22, y=h2, gable='plasterPink')
    # balcony on brackets
    k.push(0, 0, d / 2 + 0.04)
    deck(k, w * 0.75, 0.38, 0.02, 'planks', joists=False)
    for x in (-w * 0.33, 0.0, w * 0.33):
        k.beam('darkwood', V(x, -0.3, 0.0), V(x, -0.01, 0.34), 0.05)
    for i in range(13):
        x = -w * 0.375 + i * w * 0.75 / 12
        k.cyl('darkwood', 0.012, 0.012, 0.3, x, 0.0, 0.36, seg=5)
    k.box('darkwood', w * 0.75, 0.04, 0.05, 0, 0.3, 0.36)
    for s in (-1, 1):
        k.box('darkwood', 0.04, 0.32, 0.36, s * w * 0.375, 0.0, 0.18)
    k.pop()
    chimney(k, w / 2 - 0.25, -d / 2 + 0.3, h2 - 0.1, 0.85, 0.26)
    k.pop()
    k.pop()
    lantern(k, -0.05, 0.14 + 0.82, d / 2 + 0.01)
    cask(k, 1.0, d / 2 + 0.3, 0.85)
    crate(k, 0.75, 0, d / 2 + 0.45, 0.26, 0.2)
    return {'ao': 1024}


@building('housing_plot@9')
def house9(k):
    """a planter's mansion: two rendered storeys, hipped tile roof, a deep columned veranda"""
    w, d, h1, h2 = 2.4, 1.7, 1.0, 0.9
    plinth(k, w + 0.06, d + 0.06, 0.2)
    k.push(0, 0.2, 0)
    plastered(k, w, d, h1, 'plaster', [Op('front', 0.0, 'double', h=0.88), Op('front', -0.75, 'window', h=0.5, y=0.25), Op('front', 0.75, 'window', h=0.5, y=0.25), Op('left', 0.0, 'window'), Op('right', 0.0, 'window'), Op('back', -0.5, 'window'), Op('back', 0.5, 'window')])
    k.box('stone', w + 0.06, 0.08, d + 0.06, 0, h1 - 0.02, 0, uvscale=2.0)  # string course
    k.push(0, h1 + 0.06, 0)
    plastered(k, w, d, h2, 'plaster', [Op('front', 0.0, 'window', h=0.5, y=0.2), Op('front', -0.75, 'window', h=0.5, y=0.2), Op('front', 0.75, 'window', h=0.5, y=0.2), Op('left', 0.0, 'window'), Op('right', 0.0, 'window'), Op('back', 0.0, 'window')])
    tile_gable(k, w, d, 0.62, over=0.25, y=h2, hip=False, gable='plaster')
    chimney(k, -w / 2 + 0.3, -0.25, h2 - 0.1, 0.95, 0.28)
    chimney(k, w / 2 - 0.3, -0.25, h2 - 0.1, 0.95, 0.28)
    k.pop()
    # veranda: stone floor, columns, a balustraded gallery above with its own lean-to
    vz = d / 2
    k.box('stone', w + 0.2, 0.06, 0.6, 0, -0.06, vz + 0.3, uvscale=2.0)
    for i in range(5):
        x = -w / 2 + 0.05 + i * (w - 0.1) / 4
        k.cyl('plaster', 0.06, 0.05, h1 - 0.08, x, 0, vz + 0.52, seg=12)
        k.box('stone', 0.15, 0.06, 0.15, x, 0, vz + 0.52, uvscale=2.0)
        k.box('stone', 0.15, 0.06, 0.15, x, h1 - 0.1, vz + 0.52, uvscale=2.0)
    k.push(0, h1 + 0.02, vz)
    deck(k, w + 0.2, 0.6, 0.0, 'planks', joists=False)
    k.box('darkwood', w + 0.2, 0.05, 0.05, 0, 0.3, 0.55)
    for i in range(33):
        x = -w / 2 - 0.08 + i * (w + 0.16) / 32
        k.cyl('plaster', 0.016, 0.014, 0.3, x, 0, 0.55, seg=6)
    for i in range(5):
        x = -w / 2 + 0.05 + i * (w - 0.1) / 4
        k.cyl('darkwood', 0.035, 0.035, h2 - 0.05, x, 0, 0.52, seg=8)
    shingle_lean(k, w + 0.3, 0.7, h2 + 0.02, h2 - 0.22, z0=-0.05, mat='planksDark')
    k.pop()
    k.pop()
    steps(k, 0, d / 2 + 0.72, 0.8, 0.2, 2, 'stone')
    # garden: clipped shrubs in tubs and a flagpole
    for x in (-1.0, 1.0):
        cask(k, x, d / 2 + 0.9, 0.9)
    k.cyl('wood', 0.03, 0.02, 2.6, 1.35, 0, d / 2 + 0.6, seg=7)
    k.marker('flag', 1.35, 2.6, d / 2 + 0.6)
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- the starting camp

@building('bunkhouse')
def bunkhouse(k):
    """a long, low barrack hut for the crew: raised on stumps, board-and-batten walls, palm thatch,
    hammocks slung on the porch and washing on a line"""
    w, d, h, lift = 1.7, 1.15, 0.72, 0.22
    stilts(k, w, d, lift)
    deck(k, w + 0.06, d + 0.45, lift + 0.035, 'oldplanks', along='z')
    k.push(0, lift, -0.15)
    board_batten(k, w, d - 0.3, h, 'oldplanks', [Op('front', -0.45, 'door', w=0.36, h=0.64), Op('front', 0.35, 'window', w=0.26, h=0.22, y=0.32), Op('left', 0.0, 'window', w=0.22, h=0.2, y=0.34, shutters=False), Op('right', 0.0, 'window', w=0.22, h=0.2, y=0.34, shutters=False)])
    thatch_gable(k, w, d - 0.3, 0.55, over=0.32, y=h, mat='thatchDark', gable='oldplanks', gable_kind='wattle', res=0.06)
    k.pop()
    steps(k, -0.45, d / 2 + 0.26, 0.4, lift, 2, 'oldplanks')
    # a hammock slung between the porch posts
    k.cyl('bark', 0.03, 0.03, 0.7, 0.9, lift, 0.55, seg=7)
    k.cyl('bark', 0.03, 0.03, 0.7, 0.15, lift, 0.55, seg=7)
    hv, hf = [], []
    for i in range(9):
        t = i / 8
        x = 0.18 + 0.69 * t
        y = lift + 0.5 - 0.18 * math.sin(math.pi * t)
        hv += [V(x, y, 0.47), V(x, y - 0.02, 0.63)]
    for i in range(8):
        a = i * 2
        hf += [(a, a + 2, a + 3, a + 1), (a, a + 1, a + 3, a + 2)]
    k.mesh('canvas', hv, hf, uvscale=1.5)
    # washing line with shirts drying
    k.cyl('bark', 0.025, 0.025, 0.9, -1.1, 0, 0.55, seg=6)
    k.cyl('bark', 0.025, 0.025, 0.9, -1.1, 0, -0.65, seg=6)
    k.beam('rope', V(-1.1, 0.86, 0.55), V(-1.1, 0.84, -0.65), 0.008, round_=True, seg=4)
    for i, (z, m) in enumerate(((0.35, 'canvas'), (0.05, 'canvasRed'), (-0.3, 'canvas'), (-0.48, 'canvasBlue'))):
        k.cbox(m, 0.01, 0.22, 0.16 - 0.02 * (i % 2), -1.1, 0.74, z, rz=0.05 * (i - 1.5))
    # sea chest and a rum cask by the steps
    k.push(0.55, 0, 0.85, 0.2)
    k.box('planksDark', 0.32, 0.17, 0.2, 0, 0, 0, uvscale=1.4)
    k.cbox('planksDark', 0.33, 0.06, 0.21, 0, 0.19, 0, uvscale=1.4)
    for x in (-0.12, 0.12):
        k.box('iron', 0.02, 0.2, 0.215, x, 0, 0)
    k.pop()
    cask(k, -0.75, 0.82, 0.8)
    return {'ao': 1024}


@building('chuck_tent')
def chuck_tent(k):
    """the crew's cookhouse: a sailcloth fly on poles over a stone hearth with a cauldron on a chain,
    a trestle table with benches, casks and hanging pots"""
    # four poles and ridge
    for (x, z) in ((-0.8, -0.65), (0.8, -0.65), (-0.8, 0.65), (0.8, 0.65)):
        k.cyl('bark', 0.035, 0.03, 1.05 if z < 0 else 0.92, x, 0, z, seg=7)
    k.beam('bark', V(-0.95, 1.12, 0), V(0.95, 1.12, 0), 0.05, round_=True)
    for x in (-0.8, 0.8):
        k.beam('bark', V(x, 0.0, 0.0), V(x, 1.12, 0.0), 0.05, round_=True)
    # sagging sailcloth fly, stitched panels
    nx, nz = 14, 10
    verts, faces = [], []
    for j in range(nz + 1):
        t = j / nz
        for i in range(nx + 1):
            x = -0.98 + 1.96 * i / nx
            z = -0.82 + 1.64 * t
            y = 1.15 - abs(z) * 0.32 - 0.05 * math.sin(math.pi * i / nx) * math.sin(math.pi * t * 2) ** 2
            verts.append(V(x, y, z))
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + nx + 1, a + nx + 2, a + 1))
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    k.mesh('canvas', verts, faces, uvscale=0.9)
    for (x, z) in ((-0.98, -0.82), (0.98, -0.82), (-0.98, 0.82), (0.98, 0.82)):
        k.beam('rope', V(x, 0.88, z), V(x * 1.35, 0.0, z * 1.35), 0.008, round_=True, seg=4)
        k.cyl('wood', 0.015, 0.01, 0.07, x * 1.35, 0, z * 1.35, seg=5)
    # hearth: a ring of stones, embers and a cauldron hung from a tripod
    for i in range(10):
        a = i / 10 * math.tau
        k.cbox('stone', 0.09, 0.07, 0.08, math.cos(a) * 0.24, 0.035, -0.15 + math.sin(a) * 0.24, ry=a, uvscale=2.0)
    for i in range(5):
        a = i / 5 * math.tau
        k.beam('bark', V(math.cos(a) * 0.16, 0.03, -0.15 + math.sin(a) * 0.16), V(-math.cos(a) * 0.03, 0.08, -0.15 - math.sin(a) * 0.03), 0.035, round_=True)
    k.cbox('black', 0.3, 0.02, 0.3, 0, 0.01, -0.15)
    for i in range(3):
        a = i / 3 * math.tau + 0.3
        k.beam('iron', V(math.cos(a) * 0.36, 0, -0.15 + math.sin(a) * 0.36), V(0, 0.82, -0.15), 0.022, round_=True)
    k.beam('iron', V(0, 0.82, -0.15), V(0, 0.52, -0.15), 0.008, round_=True, seg=4)
    pts = []
    for i in range(9):
        t = i / 8
        r = 0.17 * math.sin(0.25 + t * 2.5) + 0.02
        pts.append((max(0.03, r), 0.16 + t * 0.32))
    cv, cf = [], []
    seg = 14
    for (r, yy) in pts:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            cv.append(V(math.cos(a) * r, yy, -0.15 + math.sin(a) * r))
    for j in range(len(pts) - 1):
        for i in range(seg):
            a = j * seg + i
            b = j * seg + (i + 1) % seg
            cf.append((a, a + seg, b + seg, b))
    k.mesh('iron', cv, cf, uvscale=1.0)
    k.cyl('soil', 0.135, 0.135, 0.01, 0, 0.44, -0.15, seg=14)  # stew
    k.marker('smoke', 0, 0.55, -0.15)
    # trestle table, benches and the cook's stores
    k.box('planks', 0.9, 0.05, 0.32, 0.25, 0.42, 0.42, uvscale=1.2)
    for x in (-0.1, 0.6):
        k.beam('wood', V(x - 0.08, 0, 0.3), V(x + 0.08, 0.42, 0.42), 0.04)
        k.beam('wood', V(x + 0.08, 0, 0.3), V(x - 0.08, 0.42, 0.42), 0.04)
    for z in (0.18, 0.66):
        k.box('planks', 0.85, 0.04, 0.12, 0.25, 0.24, z, uvscale=1.2)
        for x in (-0.08, 0.58):
            k.box('wood', 0.05, 0.24, 0.08, x, 0, z)
    for i, x in enumerate((0.0, 0.25, 0.5)):
        k.cyl('planksDark', 0.03, 0.035, 0.07, x, 0.47, 0.42, seg=8)  # tankards
    cask(k, -0.62, 0.45, 0.85)
    cask(k, -0.75, 0.15, 0.75, ry=0.6)
    cask(k, -0.55, -0.6, 0.8, lying=True, ry=0.3)
    sack(k, 0.7, -0.55)
    sack(k, 0.55, -0.62, 0.85, 1.2)
    for i in range(3):
        k.cyl('iron', 0.04, 0.05, 0.06, -0.4 + i * 0.1, 0.78, -0.62, seg=8)  # pots hung on the back pole line
        k.beam('iron', V(-0.4 + i * 0.1, 0.84, -0.62), V(-0.4 + i * 0.1, 0.98, -0.64), 0.006, round_=True, seg=4)
    k.beam('wood', V(-0.8, 0.98, -0.64), V(0.0, 0.98, -0.64), 0.03, round_=True)
    return {'ao': 1024}


@building('construction_tent')
def construction_tent(k):
    """the builders' yard: a ridge tent for tools, sawhorses with a plank being cut, timber stacked on
    bearers, a grindstone, ropes and buckets"""
    w, d, h = 1.5, 1.0, 0.85
    for z in (-d / 2, d / 2):
        k.cyl('bark', 0.03, 0.025, h + 0.05, 0, 0, z - 0.4, seg=7)
    k.beam('bark', V(0, h + 0.03, -d / 2 - 0.45), V(0, h + 0.03, d / 2 - 0.35), 0.04, round_=True)
    tv, tf = [], []
    for j in range(7):
        t = j / 6
        z = -d / 2 - 0.4 + d * t
        for i in range(9):
            u = i / 8
            sgn = -1 if u < 0.5 else 1
            x = (u - 0.5) * 2 * (w / 2)
            y = h - abs(x) / (w / 2) * h + 0.02 * math.sin(t * math.pi * 3)
            tv.append(V(x * (1.0 + 0.04 * math.sin(t * 7)), max(0.0, y), z))
    for j in range(6):
        for i in range(8):
            a = j * 9 + i
            tf.append((a, a + 9, a + 10, a + 1))
            tf.append((a, a + 1, a + 10, a + 9))
    k.mesh('canvas', tv, tf, uvscale=0.9)
    # door flaps tied back, guy ropes and pegs along both sides
    zf = d / 2 - 0.4
    for sx in (-1, 1):
        k.mesh('canvas', [V(0, h, zf), V(sx * w / 2, 0, zf), V(sx * w * 0.42, 0.0, zf + 0.22), V(sx * 0.08, h * 0.75, zf + 0.06)], [(0, 1, 2, 3), (3, 2, 1, 0)])
        k.beam('rope', V(sx * 0.2, h * 0.55, zf + 0.12), V(sx * 0.32, h * 0.4, zf + 0.15), 0.01, round_=True, seg=4)
        for zz in (zf - 0.05, zf - d + 0.05):
            k.beam('rope', V(sx * w * 0.35, h * 0.32, zz), V(sx * (w / 2 + 0.3), 0.0, zz), 0.007, round_=True, seg=4)
            k.cyl('wood', 0.012, 0.008, 0.06, sx * (w / 2 + 0.3), 0, zz, seg=5)
    k.box('black', 0.5, 0.01, d - 0.1, 0, 0.002, -0.4)
    # back wall of the tent
    k.mesh('canvas', [V(-w / 2, 0, -d / 2 - 0.4), V(w / 2, 0, -d / 2 - 0.4), V(0, h, -d / 2 - 0.4)], [(0, 1, 2), (2, 1, 0)])
    # inside: a tool rack
    k.box('wood', 0.5, 0.04, 0.04, 0, 0.5, -0.75)
    for i in range(4):
        k.beam('wood', V(-0.18 + i * 0.12, 0.05, -0.72), V(-0.18 + i * 0.12, 0.55, -0.78), 0.02, round_=True, seg=5)
    # sawhorses with a plank and a saw left in the cut
    for x in (0.25, 0.85):
        for s in (-1, 1):
            k.beam('wood', V(x + s * 0.08, 0, 0.42), V(x, 0.36, 0.42), 0.035)
            k.beam('wood', V(x + s * 0.08, 0, 0.62), V(x, 0.36, 0.62), 0.035)
        k.box('wood', 0.06, 0.05, 0.3, x, 0.34, 0.52)
    k.box('planks', 1.1, 0.035, 0.16, 0.55, 0.39, 0.52, uvscale=1.2)
    k.cbox('iron', 0.3, 0.12, 0.006, 0.6, 0.5, 0.52, rz=0.4)
    k.cbox('wood', 0.04, 0.12, 0.02, 0.48, 0.57, 0.52, rz=0.4)
    # lumber on bearers under a rope
    for z in (-0.1, 0.3):
        k.box('bark', 0.08, 0.06, 0.6, 0.6, 0, z - 0.2)
    for i in range(14):
        k.box('planks', 0.95, 0.035, 0.12, 0.62, 0.06 + (i // 4) * 0.037, -0.42 + (i % 4) * 0.13 + (k.r() - 0.5) * 0.02, ry=(k.r() - 0.5) * 0.04, uvscale=1.2)
    # grindstone on its frame
    k.push(-0.7, 0, 0.55)
    for s in (-1, 1):
        k.box('wood', 0.04, 0.32, 0.04, s * 0.09, 0, 0)
    k.cyl('stone', 0.15, 0.15, 0.06, 0, 0.32, -0.03, seg=16, rx=math.pi / 2)
    k.beam('iron', V(-0.15, 0.32, 0), V(0.15, 0.32, 0), 0.015, round_=True, seg=5)
    k.pop()
    rope_coil(k, -0.65, 0.05)
    crate(k, -0.85, 0, -0.35, 0.28, 0.2)
    crate(k, -0.82, 0.28, -0.33, 0.22, 0.6)
    cask(k, 0.95, -0.85, 0.7)
    return {'ao': 1024}


@building('timber_camp')
def timber_camp(k):
    """a woodcutters' camp: a log cabin with a bark-shingle roof, a chopping block with the axe in it,
    a great stack of felled trunks, a sledge for hauling, stumps and chips"""
    k.push(-0.75, 0, -0.75)
    w, d, h = 1.55, 1.15, 0.78
    plinth(k, w + 0.12, d + 0.12, 0.08)
    k.push(0, 0.08, 0)
    logs(k, w, d, h, [Op('front', 0.2, 'door', w=0.38, h=0.68), Op('left', 0.0, 'window', w=0.24, h=0.22, y=0.34)])
    thatch_gable(k, w + 0.1, d + 0.1, 0.58, over=0.28, y=h, mat='thatchDark', gable='bark', gable_kind='wattle', res=0.06)
    chimney(k, -w / 2 - 0.12, 0.0, -0.08, h + 0.85, 0.24)
    k.pop()
    k.pop()
    # trunk stack between upright stakes, cut ends showing
    for x in (0.55, 1.65):
        for z in (0.0, 0.0):
            k.cyl('bark', 0.05, 0.045, 0.75, x, 0, 1.05, seg=7)
            k.cyl('bark', 0.05, 0.045, 0.75, x, 0, 0.2, seg=7)
    rows = [(4, 0.11), (3, 0.11), (3, 0.1), (2, 0.1)]
    y = 0.0
    for (n, r) in rows:
        for i in range(n):
            z = 0.62 + (i - (n - 1) / 2) * 0.23 + (0.1 if n % 2 == 0 else 0) * 0
            rr = r * (0.85 + k.r() * 0.3)
            k.cyl('bark', rr, rr * 0.92, 1.4 + k.r() * 0.15, 0.4 - k.r() * 0.08, y + rr, z, seg=10, rz=-math.pi / 2)
            k.cyl('planks', rr * 0.92, rr * 0.92, 0.01, 1.82, y + rr, z, seg=10, rz=-math.pi / 2)  # sawn end grain
        y += r * 1.75
    # chopping block, axe buried in it, a splitting wedge and chips
    k.cyl('bark', 0.17, 0.16, 0.3, 0.55, 0, -0.55, seg=12)
    k.cyl('planks', 0.155, 0.155, 0.012, 0.55, 0.3, -0.55, seg=12)
    k.beam('wood', V(0.45, 0.62, -0.5), V(0.56, 0.31, -0.55), 0.03, round_=True)
    k.cbox('iron', 0.1, 0.07, 0.015, 0.565, 0.31, -0.55, rz=-0.3)
    for i in range(18):
        a = k.r() * math.tau
        r = 0.2 + k.r() * 0.35
        k.cbox('planks', 0.05, 0.008, 0.025, 0.55 + math.cos(a) * r, 0.004, -0.55 + math.sin(a) * r, ry=k.r() * 3, uvscale=2.0)
    # stumps
    for (x, z) in ((1.6, -1.4), (-1.6, 1.5), (1.4, -0.4)):
        k.cyl('bark', 0.14, 0.12, 0.16, x, 0, z, seg=10)
        k.cyl('planks', 0.12, 0.12, 0.01, x, 0.16, z, seg=10)
    # hauling sledge with a log chained on
    k.push(-0.7, 0, 1.1, 0.3)
    for s in (-1, 1):
        k.box('wood', 0.07, 0.06, 0.9, s * 0.22, 0, 0)
        k.cbox('wood', 0.07, 0.06, 0.15, s * 0.22, 0.06, 0.48, rx=0.6)
    for zz in (-0.3, 0.0, 0.3):
        k.box('wood', 0.52, 0.04, 0.07, 0, 0.06, zz)
    k.cyl('bark', 0.13, 0.12, 0.85, 0, 0.23, 0, seg=10, rx=math.pi / 2)
    k.beam('iron', V(-0.15, 0.1, 0.15), V(-0.02, 0.37, 0.15), 0.012, round_=True, seg=4)
    k.beam('iron', V(0.15, 0.1, 0.15), V(0.02, 0.37, 0.15), 0.012, round_=True, seg=4)
    k.pop()
    return {'ao': 1024}


# ------------------------------------------------------------------------------------------- other modules
# each group of buildings lives in its own defs_<group>.py so several people can work at once
import importlib, glob, os as _os
for _f in sorted(glob.glob(_os.path.join(_os.path.dirname(__file__), 'defs_*.py'))):
    try:
        importlib.import_module(_os.path.basename(_f)[:-3])
    except Exception as _e:  # one broken module must not stop everyone else's builds
        import traceback
        print(f'!! could not load {_os.path.basename(_f)}: {_e!r}')
        traceback.print_exc()
