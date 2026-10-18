# Preview many CMU clips (whole take, 8 frames each) on one body: one strip per clip.
# blender -b -P mh_clip_batch.py -- out_dir clip1 clip2 ...
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
OUTDIR, CLIPS = argv[0], argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
base, rig = mhlib.make_human({'gender': 1.0, 'muscle': 0.6})
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.6, 0.65, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (0.6, 0.2, 0.8)
sc.render.resolution_x, sc.render.resolution_y = 150, 200
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.6
cam.location = (3.6, -3.6, 1.0); cam.rotation_euler = (math.radians(90), 0, math.radians(45))
sc.camera = cam
rig.hide_render = True
for clip in CLIPS:
    src = mhlib.load_bvh(os.path.join(mhlib.BVH_DIR, clip + '.bvh'))
    src.hide_render = True
    act = src.animation_data.action
    a, b = [int(x) for x in act.frame_range]
    frames = list(range(a, b + 1, 8))
    mhlib.retarget(src, rig, clip, frames, face=False)
    n = len(frames)
    tiles = []
    for k in range(10):
        f = 1 + int(k * (n - 1) / 9)
        sc.frame_set(f)
        sc.render.filepath = f'/tmp/_b{k}.png'
        bpy.ops.render.render(write_still=True)
        tiles.append(bpy.data.images.load(sc.render.filepath))
    W, H = tiles[0].size
    px = np.zeros((H, W * len(tiles), 4), dtype=np.float32)
    for i, im in enumerate(tiles):
        px[:, i * W:(i + 1) * W] = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
        bpy.data.images.remove(im)
    out = bpy.data.images.new('sheet', W * len(tiles), H)
    out.pixels = px.ravel()
    out.filepath_raw = os.path.join(OUTDIR, f'clip_{clip}.png')
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    print('CLIP', clip, a, b, n)
    bpy.data.objects.remove(src)
