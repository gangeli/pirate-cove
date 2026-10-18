# Assemble a MakeHuman character with an outfit and render front / 3-4 / isometric views.
# blender -b -P mh_outfit_preview.py -- out.png
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
from mhlib import HumanService

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
D = '/root/.config/blender/4.2/extensions/.user/user_default/mpfb/data'
bpy.ops.wm.read_factory_settings(use_empty=True)
base, rig = mhlib.make_human({'gender': 1.0, 'muscle': 0.6, 'age': 0.5})


def add(path, kind='Clothes'):
    o = HumanService.add_mhclo_asset(os.path.join(D, path), base, asset_type=kind, subdiv_levels=0, material_type='MAKESKIN')
    return o


proxy = add('proxymeshes/male1591/male1591.proxy', 'Proxymeshes')
m = base.modifiers.new('Hide base mesh', 'MASK')
m.vertex_group = 'body'
m.invert_vertex_group = True
HumanService.set_character_skin(os.path.join(D, 'skins/middleage_caucasian_male/middleage_caucasian_male.mhmat'), base, bodyproxy=proxy, skin_type='MAKESKIN')
add('eyes/low-poly/low-poly.mhclo', 'Eyes')
add('eyebrows/eyebrow001/eyebrow001.mhclo', 'Eyebrows')
add('hair/short02/short02.mhclo', 'Hair')
add('clothes/elvs_male_boho_top1/elvs_male_boho_top1.mhclo')
add('clothes/elvs_male_trouser_short_1/elvs_male_trouser_short_1.mhclo')
add('clothes/punkduck_medieval_boots/punkduck_medieval_boots.mhclo')

for o in bpy.data.objects:
    if o.type == 'MESH':
        print('OBJ', o.name, len(o.data.vertices), [s.material.name if s.material else None for s in o.material_slots])

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 16
sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.65, 0.7, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (0.7, 0.1, 0.6)
sc.render.resolution_x, sc.render.resolution_y = 360, 520
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
tiles = []
views = [(0, 0, 2.0, 0.9, 90), (35, 0, 2.0, 0.9, 90), (200, 0, 2.0, 0.9, 90), (35, 50, 2.0, 0.9, 40)]
for i, (yaw, pitch, scale, cz, _) in enumerate(views):
    cam.data.ortho_scale = scale
    a = math.radians(yaw)
    el = math.radians(pitch)
    dist = 6
    cam.location = (math.sin(a) * dist * math.cos(el), -math.cos(a) * dist * math.cos(el), cz + dist * math.sin(el))
    cam.rotation_euler = (math.radians(90) - el, 0, a)
    p = f'/tmp/_ot{i}.png'
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    tiles.append(p)
import numpy as np
imgs = [bpy.data.images.load(p) for p in tiles]
W, H = imgs[0].size
px = np.zeros((H, W * len(imgs), 4), dtype=np.float32)
for i, im in enumerate(imgs):
    px[:, i * W:(i + 1) * W] = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
out = bpy.data.images.new('sheet', W * len(imgs), H)
out.pixels = px.ravel()
out.filepath_raw = OUT
out.file_format = 'PNG'
out.save()
