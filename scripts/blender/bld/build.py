"""Build building GLBs (+ baked AO) for the game.

    blender -b -P scripts/blender/bld/build.py -- [name ...]      (default: everything in REGISTRY)

Writes public/assets/buildings/<name>.glb and <name>_ao.jpg. Names are prefab keys: a building def id, or
def@level for leveled buildings (housing_plot@5, palace@2).
"""
import sys, os, time, importlib
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from kit import Kit
import defs

OUT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'public', 'assets', 'buildings')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = argv or list(defs.REGISTRY)
fast = bool(os.environ.get('FAST'))
for name in names:
    fn = defs.REGISTRY[name]
    t0 = time.time()
    k = Kit(seed=abs(hash(name)) % 10007)
    opts = fn(k) or {}
    k.finish(name.replace('@', '_'), os.path.abspath(OUT), ao_size=opts.get('ao', 1024), ao_samples=32 if fast else opts.get('samples', 96),
             ao_dist=opts.get('ao_dist', 0.6))
    print(f'{name} done in {time.time() - t0:.1f}s')
# manifest of every model on disk
import json
have = sorted(f[:-4] for f in os.listdir(os.path.abspath(OUT)) if f.endswith('.glb'))
json.dump(have, open(os.path.join(os.path.abspath(OUT), 'index.json'), 'w'))
