# blender -b -P preview.py -- in.gltf out.png
import bpy, sys, mathutils, math
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
objs = [o for o in sc.objects if o.type == 'MESH']
mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
tris = 0
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
    tris += sum(len(p.vertices)-2 for p in o.data.polygons)
ctr = (mn+mx)/2; rad = (mx-mn).length/2
print('BOUNDS', tuple(round(v,2) for v in (mx-mn)), 'TRIS', tris, 'OBJS', len(objs))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
d = mathutils.Vector((1, -1, 0.9)).normalized() * rad * 2.6
cam.location = ctr + d
cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30)); sun.data.energy = 4
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.7, 0.85, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.device = 'CPU'
sc.render.resolution_x = 480; sc.render.resolution_y = 360
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
