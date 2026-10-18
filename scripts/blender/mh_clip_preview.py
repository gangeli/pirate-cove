# Retarget one CMU clip onto a MakeHuman body and render a strip of frames.
# blender -b -P mh_clip_preview.py -- out.png clip start end [loop]
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, CLIP, A, B = argv[0], argv[1], int(argv[2]), int(argv[3])
LOOP = len(argv) > 4 and argv[4] == 'loop'
bpy.ops.wm.read_factory_settings(use_empty=True)
mhlib.addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
base, rig = mhlib.make_human({'gender': 1.0, 'muscle': 0.6})
src = mhlib.load_bvh(os.path.join(mhlib.BVH_DIR, CLIP + '.bvh'))
if LOOP:
    v, A, B = mhlib.best_loop(src, A, B, 90, 200)
    print('LOOP', v, A, B)
step = 4
frames = list(range(A, B + 1, step))
act = mhlib.retarget(src, rig, CLIP, frames, loop=LOOP, inplace=LOOP)
src.hide_render = True
for o in bpy.data.objects:
    if o.type == 'ARMATURE':
        o.hide_render = True
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 6
sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.65, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (0.6, 0.2, 0.8)
fl = bpy.data.objects.new('floor', bpy.data.meshes.new('floor')); sc.collection.objects.link(fl)
import bmesh
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3); bm.to_mesh(fl.data)
sc.render.resolution_x, sc.render.resolution_y = 220, 300
sc.render.film_transparent = False
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.4
cam.location = (2.2, -3.2, 1.6)
cam.rotation_euler = (math.radians(78), 0, math.radians(34))
sc.camera = cam
n = len(frames)
picks = [1 + int(i * (n - 1) / 7) for i in range(8)]
tiles = []
for k, f in enumerate(picks):
    sc.frame_set(f)
    p = f'/tmp/_tile{k}.png'
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    tiles.append(p)
# stitch
imgs = [bpy.data.images.load(p) for p in tiles]
W, H = imgs[0].size
out = bpy.data.images.new('sheet', W * len(imgs), H)
import numpy as np
px = np.zeros((H, W * len(imgs), 4), dtype=np.float32)
for i, im in enumerate(imgs):
    a = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
    px[:, i * W:(i + 1) * W] = a
out.pixels = px.ravel()
out.filepath_raw = OUT
out.file_format = 'PNG'
out.save()
print('frames', A, B, n)
