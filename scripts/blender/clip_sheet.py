# Contact sheet of every animation in a crowd GLB: one row per clip, N frames per row.
#   blender -b -P clip_sheet.py -- in.glb out.png [frames]
import bpy, sys, math
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = argv[0], argv[1]
NF = int(argv[2]) if len(argv) > 2 else 6
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
grey = bpy.data.materials.new('g'); grey.diffuse_color = (0.7, 0.68, 0.64, 1)
mesh.data.materials.clear(); mesh.data.materials.append(grey)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.samples = 3; sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.5, 0.55, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 4; sun.rotation_euler = (0.7, 0.2, 0.9)
bpy.ops.mesh.primitive_plane_add(size=6)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.4
# 3/4 front view (model faces -Y in Blender after import? glTF +Z forward -> Blender -Y)
cam.location = (2.6, -3.2, 1.5); cam.rotation_euler = (math.radians(78), 0, math.radians(39))
RX, RY = int(__import__("os").environ.get("RX", 130)), int(__import__("os").environ.get("RY", 170))
sc.render.resolution_x, sc.render.resolution_y = RX, RY
acts = sorted(bpy.data.actions, key=lambda a: a.name)
ONLY = __import__('os').environ.get('ONLY')
if ONLY: acts = [a for a in acts if a.name.split('_')[0] in ONLY.split(',')]
rows = []
for act in acts:
    arm.animation_data.action = act
    a, b = act.frame_range
    tiles = []
    for k in range(NF):
        f = a + (b - a) * k / max(1, NF - 1)
        sc.frame_set(int(f), subframe=f - int(f))
        sc.render.filepath = '/tmp/_cs.png'
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load('/tmp/_cs.png')
        tiles.append(np.array(im.pixels[:], dtype=np.float32).reshape(RY, RX, 4))
        bpy.data.images.remove(im)
    rows.append((act.name.split('_')[0], np.concatenate(tiles, axis=1)))
    print('ROW', act.name, flush=True)
H = 170 * len(rows)
out = np.concatenate([r for _, r in rows][::-1], axis=0)
img = bpy.data.images.new('sheet', out.shape[1], out.shape[0])
img.pixels = out.ravel()
img.filepath_raw = OUT; img.file_format = 'PNG'; img.save()
print('NAMES', [n for n, _ in rows])
