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
