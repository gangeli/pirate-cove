import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
acts = argv[2].split(',') if len(argv) > 2 else ['idle']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
rig = [o for o in sc.objects if o.type == 'ARMATURE'][0]
mesh = [o for o in sc.objects if o.type == 'MESH'][0]
# region colour material
mat = bpy.data.materials.new('m'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
ca = nt.nodes.new('ShaderNodeVertexColor')
sep = nt.nodes.new('ShaderNodeSeparateColor')
ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'
cols = [(0.85,0.6,0.45),(0.8,0.75,0.65),(0.25,0.25,0.4),(0.15,0.1,0.05),(0.2,0.12,0.05),(0.6,0.1,0.1),(0.7,0.15,0.1),(0.6,0.05,0.05),(0.02,0.02,0.02),(0.1,0.1,0.1),(0.25,0.15,0.05)]
els = ramp.color_ramp.elements
els[0].position = 0; els[0].color = (*cols[0],1)
els[1].position = 0.105; els[1].color = (*cols[1],1)
for i in range(2, 11):
    e = els.new(i/10 + 0.005); e.color = (*cols[i],1)
nt.links.new(ca.outputs['Color'], sep.inputs[0]); nt.links.new(sep.outputs[0], ramp.inputs[0]); nt.links.new(ramp.outputs[0], bsdf.inputs['Base Color'])
mesh.data.materials.clear(); mesh.data.materials.append(mat)
# lay out copies with different actions
objs = []
for i, a in enumerate(acts):
    if i > 0:
        r2 = rig.copy(); r2.data = rig.data; sc.collection.objects.link(r2)
        m2 = mesh.copy(); sc.collection.objects.link(m2); m2.parent = r2
        m2.modifiers[0].object = r2
    else:
        r2, m2 = rig, mesh
    r2.location.x = i * 0.9
    r2.animation_data_create()
    act = bpy.data.actions.get(a)
    if act: r2.animation_data.action = act
sc.frame_set(int(argv[3]) if len(argv) > 3 else 8)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cx = (len(acts)-1)*0.45
cam.location = (cx + 1.5, -3.2 - len(acts)*0.4, 1.7)
cam.rotation_euler = (mathutils.Vector((cx, 0, 0.9)) - cam.location).to_track_quat('-Z','Y').to_euler()
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun','SUN')); sc.collection.objects.link(sun); sun.rotation_euler=(0.8,0.2,0.6); sun.data.energy=4
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.6,0.7,0.8,1)
sc.render.engine='CYCLES'; sc.cycles.samples=12; sc.render.resolution_x=960; sc.render.resolution_y=420; sc.render.filepath=out
bpy.ops.render.render(write_still=True)
