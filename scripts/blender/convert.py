# blender -b -P convert.py -- in.gltf out.glb target_tris tex_size [scale_to_len]
import bpy, sys, mathutils, os
argv = sys.argv[sys.argv.index('--')+1:]
src, out, target, texsize = argv[0], argv[1], int(argv[2]), int(argv[3])
scale_to = float(argv[4]) if len(argv) > 4 else 0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
tris = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)
ratio = min(1.0, target / max(1, tris))
for o in objs:
    if ratio < 0.98:
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)
# downsize images
for img in bpy.data.images:
    if img.size[0] > texsize:
        img.scale(texsize, int(texsize * img.size[1] / img.size[0]))
    img.file_format = 'JPEG'
# optional normalise length (largest horizontal extent)
if scale_to > 0:
    mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
    ext = max(mx.x - mn.x, mx.y - mn.y)
    s = scale_to / ext
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.scale *= s
            o.location *= s
tris2 = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)
print('CONVERT', os.path.basename(src), tris, '->', tris2)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='JPEG', export_jpeg_quality=82, export_apply=True, export_yup=True)
