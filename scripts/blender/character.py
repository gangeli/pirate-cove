# Procedural rigged + animated characters.
# blender -b -P character.py -- out.glb variant
#   variant: male | female | soldier
# Vertex colour R channel encodes a clothing "region" id (see REGIONS) so the game can recolour per instance.
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix, Quaternion, Euler

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, VARIANT = argv[0], argv[1] if len(argv) > 1 else 'male'
REGIONS = {'skin': 0, 'shirt': 1, 'pants': 2, 'boots': 3, 'hair': 4, 'hat': 5, 'sash': 6, 'coat': 7, 'eyes': 8, 'hat2': 9, 'beard': 10}
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

female = VARIANT == 'female'
soldier = VARIANT == 'soldier'

# ------------------------------------------------------------------------------------------------ skeleton joints
J = {
    'pelvis': (0, 0, 0.95), 'spine': (0, 0.0, 1.12), 'chest': (0, 0.0, 1.32), 'neck': (0, 0, 1.50), 'head': (0, 0, 1.58), 'headtop': (0, 0, 1.82),
}
for s, x in (('L', 1), ('R', -1)):
    J[f'shoulder.{s}'] = (0.07 * x, 0, 1.44)
    J[f'upperarm.{s}'] = (0.2 * x, 0, 1.43)
    J[f'elbow.{s}'] = (0.28 * x, 0.02, 1.18)
    J[f'wrist.{s}'] = (0.33 * x, -0.02, 0.97)
    J[f'hand.{s}'] = (0.345 * x, -0.03, 0.89)
    J[f'hip.{s}'] = (0.095 * x, 0, 0.92)
    J[f'knee.{s}'] = (0.105 * x, -0.01, 0.50)
    J[f'ankle.{s}'] = (0.11 * x, 0.02, 0.09)
    J[f'toe.{s}'] = (0.115 * x, -0.13, 0.03)
if female:
    for s, x in (('L', 1), ('R', -1)):
        J[f'upperarm.{s}'] = (0.17 * x, 0, 1.40)
        J[f'hip.{s}'] = (0.10 * x, 0, 0.92)

# ------------------------------------------------------------------------------------------------ body mesh via skin modifier
EDGES = [
    ('pelvis', 'spine'), ('spine', 'chest'), ('chest', 'neck'),
    ('chest', 'shoulder.L'), ('shoulder.L', 'upperarm.L'), ('upperarm.L', 'elbow.L'), ('elbow.L', 'wrist.L'), ('wrist.L', 'hand.L'),
    ('chest', 'shoulder.R'), ('shoulder.R', 'upperarm.R'), ('upperarm.R', 'elbow.R'), ('elbow.R', 'wrist.R'), ('wrist.R', 'hand.R'),
    ('pelvis', 'hip.L'), ('hip.L', 'knee.L'), ('knee.L', 'ankle.L'), ('ankle.L', 'toe.L'),
    ('pelvis', 'hip.R'), ('hip.R', 'knee.R'), ('knee.R', 'ankle.R'), ('ankle.R', 'toe.R'),
]
RAD = {
    'pelvis': (0.155, 0.115), 'spine': (0.145, 0.11), 'chest': (0.18, 0.125), 'neck': (0.055, 0.055),
}
for s in 'LR':
    RAD[f'shoulder.{s}'] = (0.08, 0.075)
    RAD[f'upperarm.{s}'] = (0.062, 0.062)
    RAD[f'elbow.{s}'] = (0.05, 0.05)
    RAD[f'wrist.{s}'] = (0.033, 0.03)
    RAD[f'hand.{s}'] = (0.038, 0.022)
    RAD[f'hip.{s}'] = (0.085, 0.085)
    RAD[f'knee.{s}'] = (0.055, 0.055)
    RAD[f'ankle.{s}'] = (0.042, 0.042)
    RAD[f'toe.{s}'] = (0.04, 0.03)
if female:
    RAD['chest'] = (0.145, 0.115)
    RAD['spine'] = (0.115, 0.09)
    RAD['pelvis'] = (0.16, 0.115)
    for s in 'LR':
        RAD[f'upperarm.{s}'] = (0.042, 0.042)
        RAD[f'elbow.{s}'] = (0.036, 0.036)
        RAD[f'hip.{s}'] = (0.09, 0.09)
        RAD[f'knee.{s}'] = (0.05, 0.05)

names = list(J.keys())
names.remove('head'); names.remove('headtop')
me = bpy.data.meshes.new('body')
bm = bmesh.new()
vmap = {}
for n in names:
    vmap[n] = bm.verts.new(J[n])
for a, b in EDGES:
    bm.edges.new((vmap[a], vmap[b]))
bm.to_mesh(me)
body = bpy.data.objects.new('body', me)
scene.collection.objects.link(body)
sk = body.modifiers.new('skin', 'SKIN')
sk.use_smooth_shade = True
sv = me.skin_vertices[0].data
for i, n in enumerate(names):
    r = RAD.get(n, (0.05, 0.05))
    sv[i].radius = r
sv[names.index('pelvis')].use_root = True
sub = body.modifiers.new('sub', 'SUBSURF')
sub.levels = 2
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.modifier_apply(modifier='skin')
bpy.ops.object.modifier_apply(modifier='sub')
dec = body.modifiers.new('dec', 'DECIMATE')
dec.ratio = 0.5
bpy.ops.object.modifier_apply(modifier='dec')

# head
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=14, radius=0.11, location=(0, -0.005, 1.665))
head = bpy.context.active_object
head.scale = (0.92, 1.0, 1.12)
bpy.ops.object.transform_apply(scale=True)
# jaw / chin bulge
bm = bmesh.new(); bm.from_mesh(head.data)
for v in bm.verts:
    if v.co.z < 1.64 and v.co.y < 0:
        v.co.y -= 0.012 * (1.64 - v.co.z) / 0.1
bm.to_mesh(head.data); bm.free()
# nose
bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.022, radius2=0.004, depth=0.05, location=(0, -0.115, 1.66), rotation=(math.radians(90), 0, 0))
nose = bpy.context.active_object
# eyes
eyes = []
for x in (-0.038, 0.038):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.014, location=(x, -0.098, 1.69))
    eyes.append(bpy.context.active_object)
# ears
ears = []
for x in (-0.1, 0.1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.025, location=(x, 0.0, 1.665))
    e = bpy.context.active_object
    e.scale = (0.4, 0.8, 1.0)
    ears.append(e)

parts = {'skin_extra': [head, nose] + ears, 'eyes': eyes}

def tricorn(z0, name):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    N, R0, R1 = 36, 0.105, 0.215
    inner, outer = [], []
    for i in range(N):
        th = i / N * math.tau
        lift = 0.085 * ((math.cos(3 * th + math.pi / 2) + 1) / 2) ** 2
        inner.append(bm.verts.new((math.cos(th) * R0, math.sin(th) * R0, z0)))
        outer.append(bm.verts.new((math.cos(th) * R1 * (0.9 + 0.1 * math.cos(3 * th + math.pi / 2)), math.sin(th) * R1, z0 + 0.01 + lift)))
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    return o

def add_region_mesh(make, region):
    make()
    o = bpy.context.active_object
    o['region'] = region
    return o

clothes = []
# hair: a cap on the back/top of the head
bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=12, radius=0.118, location=(0, 0.012, 1.69))
hair = bpy.context.active_object
hair.scale = (0.97, 1.0, 1.06)
bm = bmesh.new(); bm.from_mesh(hair.data)
for v in list(bm.verts):
    # remove face front and lower parts
    if (v.co.y < -0.03 and v.co.z < 1.73 * 1.0 - 1.69 + 0.04 + 0.0) or v.co.z < -0.035:
        pass
bmesh.ops.delete(bm, geom=[v for v in bm.verts if (v.co.y < -0.05 and v.co.z < 0.03) or v.co.z < -0.06], context='VERTS')
bm.to_mesh(hair.data); bm.free()
hair['region'] = 'hair'
clothes.append(hair)
if female:
    # long hair falling down the back
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.1, depth=0.32, location=(0, 0.06, 1.52))
    lh = bpy.context.active_object
    lh.scale = (1.0, 0.55, 1.0)
    bm = bmesh.new(); bm.from_mesh(lh.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.02], context='VERTS')
    bm.to_mesh(lh.data); bm.free()
    lh['region'] = 'hair'
    clothes.append(lh)
    # skirt
    bpy.ops.mesh.primitive_cone_add(vertices=20, radius1=0.27, radius2=0.155, depth=0.58, location=(0, 0, 0.72), end_fill_type='NOTHING')
    skirt = bpy.context.active_object
    skirt['region'] = 'pants'
    clothes.append(skirt)
# hat: tricorn for soldiers, separate bandana mesh for pirates (toggled per instance)
if soldier:
    tri = tricorn(1.76, 'tricorn')
    tri['region'] = 'hat'
    clothes.append(tri)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.115, location=(0, 0, 1.76))
    crown = bpy.context.active_object
    crown.scale = (1, 1, 0.7)
    crown['region'] = 'hat'
    clothes.append(crown)
    # long coat skirt
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.24, radius2=0.165, depth=0.42, location=(0, 0.01, 0.78), end_fill_type='NOTHING')
    coat = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(coat.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.12 and abs(v.co.x) < 0.06], context='VERTS')
    bm.to_mesh(coat.data); bm.free()
    coat['region'] = 'coat'
    clothes.append(coat)
else:
    # bandana / head scarf (region hat) slightly larger than the hair
    bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=10, radius=0.124, location=(0, 0.004, 1.70))
    band = bpy.context.active_object
    band.scale = (0.98, 1.0, 1.04)
    bm = bmesh.new(); bm.from_mesh(band.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.012 * 0 + 0.0 - 0.0 + 0.012], context='VERTS')
    bm.to_mesh(band.data); bm.free()
    band['region'] = 'hat'
    clothes.append(band)
    # knot tail at the back
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.03, radius2=0.005, depth=0.12, location=(0, 0.13, 1.68), rotation=(math.radians(-60), 0, 0))
    knot = bpy.context.active_object
    knot['region'] = 'hat'
    clothes.append(knot)
    # tricorn hat (region hat2) for captains / wealthy pirates
    tri = tricorn(1.765, 'tricorn')
    tri['region'] = 'hat2'
    clothes.append(tri)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.116, location=(0, 0, 1.75))
    crown = bpy.context.active_object
    crown.scale = (1, 1, 0.75)
    crown['region'] = 'hat2'
    clothes.append(crown)
    # beard (region hair) for males: toggled per instance via the hair colour alpha
    if not female:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=8, radius=0.07, location=(0, -0.075, 1.6))
        beard = bpy.context.active_object
        beard.scale = (1.15, 0.6, 1.0)
        beard['region'] = 'beard'
        clothes.append(beard)

# belt / sash band
bpy.ops.mesh.primitive_torus_add(major_radius=0.148 if not female else 0.135, minor_radius=0.03, location=(0, 0, 0.98))
belt = bpy.context.active_object
belt.scale = (1.0, 0.78, 1.0)
belt['region'] = 'sash'
clothes.append(belt)

# ------------------------------------------------------------------------------------------------ region colours on body
def body_region(co):
    x, y, z = co
    ax = abs(x)
    if z > 1.5:
        return 'skin'
    # hands & forearms
    if ax > 0.27 and z < 1.28:
        return 'skin' if not soldier else ('coat' if z > 1.0 else 'skin')
    if z < 0.17:
        return 'boots'
    if z < (0.52 if not soldier else 0.56):
        return 'boots' if (soldier or z < 0.32) else 'skin'
    if z < 0.97:
        return 'pants'
    return 'coat' if soldier else 'shirt'

def colorize(o, fn):
    m = o.data
    if not m.color_attributes:
        m.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca = m.color_attributes[0]
    for v in m.vertices:
        r = REGIONS[fn(o.matrix_world @ v.co)]
        ca.data[v.index].color = (r / 10.0 + 0.01, 0, 0, 1)

colorize(body, lambda co: body_region(co))
for o in parts['skin_extra']:
    colorize(o, lambda co: 'skin')
for o in parts['eyes']:
    colorize(o, lambda co: 'eyes')
for o in clothes:
    reg = o['region']
    colorize(o, lambda co, reg=reg: reg)

# join everything
bpy.ops.object.select_all(action='DESELECT')
allp = [body] + parts['skin_extra'] + parts['eyes'] + clothes
for o in allp:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
char = bpy.context.active_object
char.name = 'character'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mat = bpy.data.materials.new('char')
mat.use_nodes = True
char.data.materials.append(mat)
print('TRIS', sum(len(p.vertices) - 2 for p in char.data.polygons))

# ------------------------------------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, a, b, parent=None, connect=False):
    bn = eb.new(name)
    bn.head = Vector(J[a]) if isinstance(a, str) else Vector(a)
    bn.tail = Vector(J[b]) if isinstance(b, str) else Vector(b)
    bn.roll = 0
    if parent:
        bn.parent = eb[parent]
        bn.use_connect = connect
    return bn
bone('root', (0, 0, 0), (0, 0, 0.3))
bone('hips', 'pelvis', 'spine', 'root')
bone('spine', 'spine', 'chest', 'hips', True)
bone('chest', 'chest', 'neck', 'spine', True)
bone('neck', 'neck', 'head', 'chest', True)
bone('head', 'head', 'headtop', 'neck', True)
for s in 'LR':
    bone(f'shoulder.{s}', 'shoulder.' + s, 'upperarm.' + s, 'chest')
    bone(f'upperarm.{s}', 'upperarm.' + s, 'elbow.' + s, f'shoulder.{s}', True)
    bone(f'forearm.{s}', 'elbow.' + s, 'wrist.' + s, f'upperarm.{s}', True)
    bone(f'hand.{s}', 'wrist.' + s, 'hand.' + s, f'forearm.{s}', True)
    bone(f'thigh.{s}', 'hip.' + s, 'knee.' + s, 'hips')
    bone(f'shin.{s}', 'knee.' + s, 'ankle.' + s, f'thigh.{s}', True)
    bone(f'foot.{s}', 'ankle.' + s, 'toe.' + s, f'shin.{s}', True)
bpy.ops.object.mode_set(mode='OBJECT')
# bind with automatic weights
bpy.ops.object.select_all(action='DESELECT')
char.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# hats / hair rigidly to head: reassign weights for vertices above the neck
vg_head = char.vertex_groups.get('head')
for v in char.data.vertices:
    co = v.co
    if co.z > 1.55 or (co.z > 1.47 and abs(co.x) < 0.07):
        for g in list(v.groups):
            char.vertex_groups[g.group].remove([v.index])
        vg_head.add([v.index], 1.0, 'REPLACE')

# ------------------------------------------------------------------------------------------------ animation
pb = rig.pose.bones
for p in pb:
    p.rotation_mode = 'QUATERNION'
REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}

def wrot(name, axis, deg):
    """rotation about a WORLD axis, expressed in the bone's local rest frame"""
    m = REST[name]
    ax = m.inverted() @ Vector(axis)
    return Quaternion(ax.normalized(), math.radians(deg))

def pose(frame, spec):
    """spec: bone -> list of (axis, degrees) world-axis rotations; root -> location offset"""
    for p in pb:
        q = Quaternion()
        for axis, deg in spec.get(p.name, []):
            q = q @ wrot(p.name, axis, deg)
        p.rotation_quaternion = q
        p.keyframe_insert('rotation_quaternion', frame=frame)
    loc = spec.get('_loc', (0, 0, 0))
    pb['root'].location = Vector(loc)
    pb['root'].keyframe_insert('location', frame=frame)

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

def action(name, length, fn, loop=True, step=2):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    n = int(length * FPS)
    for f in range(0, n + 1, step):
        t = f / n
        pose(f + 1, fn(t))
    if loop:
        for fc in act.fcurves:
            mod = fc.modifiers.new('CYCLES')
    # store as NLA strip so the exporter writes every action
    tr = rig.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, act)
    rig.animation_data.action = None
    return act

S = math.sin
TAU = math.pi * 2

def arms_down():
    # bring arms in from A-pose a bit
    return {'upperarm.L': [(Y, 8)], 'upperarm.R': [(Y, -8)]}

def merge(*ds):
    out = {}
    for d in ds:
        for k, v in d.items():
            if k == '_loc':
                out[k] = v
            else:
                out.setdefault(k, []).extend(v)
    return out

def walk(t, run=False, carry=False):
    a = TAU * t
    sw = 38 if run else 26
    knee = 55 if run else 38
    bob = (0.035 if run else 0.022) * abs(S(a))
    d = {
        'thigh.L': [(X, -sw * S(a))], 'thigh.R': [(X, sw * S(a))],
        'shin.L': [(X, knee * max(0, -S(a + 0.9)) + 4)], 'shin.R': [(X, knee * max(0, S(a + 0.9)) + 4)],
        'foot.L': [(X, -8 * S(a))], 'foot.R': [(X, 8 * S(a))],
        'hips': [(Z, 6 * S(a))], 'chest': [(Z, -9 * S(a)), (X, -(10 if run else 3))],
        'head': [(Z, 3 * S(a))],
        '_loc': (0, 0, bob - 0.012),
    }
    if carry:
        d.update({'upperarm.L': [(X, -55), (Y, 12)], 'upperarm.R': [(X, -55), (Y, -12)], 'forearm.L': [(X, -60)], 'forearm.R': [(X, -60)]})
    else:
        asw = 40 if run else 24
        d.update({'upperarm.L': [(Y, 8), (X, asw * S(a))], 'upperarm.R': [(Y, -8), (X, -asw * S(a))],
                  'forearm.L': [(X, -(25 if run else 12) - 10 * max(0, S(a)))], 'forearm.R': [(X, -(25 if run else 12) - 10 * max(0, -S(a)))]})
    return d

def idle(t):
    a = TAU * t
    return merge(arms_down(), {
        'chest': [(X, 1.5 * S(a))], 'head': [(Z, 6 * S(a * 0.5 + 1)), (X, 2 * S(a))],
        'forearm.L': [(X, -10)], 'forearm.R': [(X, -10)], 'thigh.L': [(Y, 3)], 'thigh.R': [(Y, -2)],
        '_loc': (0, 0, -0.004 * (1 + S(a))),
    })

def swing(t):
    # chop / hammer: both hands overhead then strike down
    ph = (S(TAU * t - 1.2) + 1) / 2  # 0..1
    up = ph
    return {
        'upperarm.L': [(X, -60 - 100 * up), (Y, 20)], 'upperarm.R': [(X, -60 - 100 * up), (Y, -20)],
        'forearm.L': [(X, -40 + 20 * up)], 'forearm.R': [(X, -40 + 20 * up)],
        'chest': [(X, -25 + 30 * up)], 'spine': [(X, -10 + 8 * up)],
        'thigh.L': [(X, -15)], 'thigh.R': [(X, 10)], 'shin.L': [(X, 20)], 'shin.R': [(X, 12)],
        '_loc': (0, 0, -0.03),
    }

def farm(t):
    a = TAU * t
    return {
        'spine': [(X, -25 - 6 * S(a))], 'chest': [(X, -20)], 'head': [(X, 15)],
        'upperarm.L': [(X, -50 - 25 * S(a)), (Y, 10)], 'upperarm.R': [(X, -40 - 25 * S(a)), (Y, -10)],
        'forearm.L': [(X, -30)], 'forearm.R': [(X, -30)],
        'thigh.L': [(X, -30)], 'thigh.R': [(X, -20)], 'shin.L': [(X, 45)], 'shin.R': [(X, 35)], 'foot.L': [(X, -12)], 'foot.R': [(X, -12)],
        '_loc': (0, 0, -0.09),
    }

def drink(t):
    # mug to mouth and back
    k = max(0, S(TAU * t))
    return merge(arms_down(), {
        'upperarm.R': [(X, -50 - 40 * k), (Y, -15)], 'forearm.R': [(X, -100 - 30 * k)],
        'head': [(X, -14 * k)], 'chest': [(X, -4 * k)], 'forearm.L': [(X, -10)],
        'thigh.L': [(Y, 4)], 'thigh.R': [(Y, -4)],
    })

def cheer(t):
    a = TAU * t
    k = (S(a) + 1) / 2
    return {
        'upperarm.L': [(Y, 70 + 60 * k)], 'upperarm.R': [(Y, -70 - 60 * k)], 'forearm.L': [(Y, 20)], 'forearm.R': [(Y, -20)],
        'chest': [(X, 6 * S(a))], 'head': [(X, -10)],
        'thigh.L': [(X, -8 * k)], 'thigh.R': [(X, -8 * (1 - k))], 'shin.L': [(X, 14 * k)], 'shin.R': [(X, 14 * (1 - k))],
        '_loc': (0, 0, 0.05 * abs(S(a))),
    }

def fight(t):
    a = TAU * t
    k = (S(a) + 1) / 2
    return {
        'upperarm.R': [(X, -40 - 90 * k), (Z, -40 + 60 * k)], 'forearm.R': [(X, -30 - 40 * (1 - k))],
        'upperarm.L': [(X, -30), (Y, 30)], 'forearm.L': [(X, -60)],
        'chest': [(Z, 25 - 45 * k), (X, -8)], 'hips': [(Z, 10 - 15 * k)],
        'thigh.L': [(X, -30)], 'thigh.R': [(X, 20)], 'shin.L': [(X, 30)], 'shin.R': [(X, 20)],
        '_loc': (0, 0, -0.06),
    }

def die(t):
    k = min(1, t * 1.6)
    e = k * k * (3 - 2 * k)
    return {
        'hips': [(X, 80 * e)], 'chest': [(X, -10 * e)], 'head': [(X, -20 * e)],
        'upperarm.L': [(Y, 60 * e)], 'upperarm.R': [(Y, -60 * e)],
        'thigh.L': [(X, -10 * e)], 'thigh.R': [(X, -30 * e)], 'shin.L': [(X, 20 * e)], 'shin.R': [(X, 45 * e)],
        '_loc': (0, 0.4 * e, -0.82 * e),
    }

def sleep(t):
    a = TAU * t
    return {
        'hips': [(X, -88)], 'head': [(X, 10)], 'upperarm.L': [(Y, 10)], 'upperarm.R': [(Y, -10)],
        'chest': [(X, 1.5 * S(a))], 'thigh.L': [(X, -6)], 'shin.L': [(X, 8)],
        '_loc': (0, -0.55, -0.82),
    }

def sit(t):
    a = TAU * t
    return merge(arms_down(), {
        'thigh.L': [(X, -85)], 'thigh.R': [(X, -85)], 'shin.L': [(X, 85)], 'shin.R': [(X, 85)],
        'chest': [(X, -6 + 2 * S(a))], 'head': [(Z, 10 * S(a * 0.5))], 'forearm.L': [(X, -50)], 'forearm.R': [(X, -50)],
        '_loc': (0, 0.05, -0.45),
    })

def dance(t):
    a = TAU * t
    return {
        'hips': [(Z, 15 * S(a))], 'chest': [(Z, -12 * S(a)), (Y, 8 * S(a))],
        'upperarm.L': [(Y, 40 + 30 * S(a)), (X, -30)], 'upperarm.R': [(Y, -40 + 30 * S(a)), (X, -30)],
        'forearm.L': [(X, -60)], 'forearm.R': [(X, -60)],
        'thigh.L': [(X, -25 * max(0, S(a)))], 'thigh.R': [(X, -25 * max(0, -S(a)))],
        'shin.L': [(X, 40 * max(0, S(a)))], 'shin.R': [(X, 40 * max(0, -S(a)))],
        '_loc': (0, 0, 0.03 * abs(S(a * 2))),
    }

def talk(t):
    a = TAU * t
    return merge(arms_down(), {
        'upperarm.R': [(X, -25 - 15 * S(a * 2)), (Z, -20)], 'forearm.R': [(X, -60 - 20 * S(a * 2 + 1))],
        'upperarm.L': [(X, -10 + 10 * S(a))], 'forearm.L': [(X, -30)],
        'head': [(Z, 12 * S(a)), (X, -3 * S(a * 3))], 'chest': [(Z, 5 * S(a))],
    })

action('idle', 3.0, idle)
action('walk', 1.0, lambda t: walk(t))
action('run', 0.62, lambda t: walk(t, run=True))
action('carry', 1.0, lambda t: walk(t, carry=True))
action('swing', 1.1, swing)
action('farm', 1.6, farm)
action('drink', 2.4, drink)
action('cheer', 0.8, cheer)
action('fight', 0.7, fight)
action('die', 1.2, die, loop=False)
action('sleep', 4.0, sleep)
action('sit', 4.0, sit)
action('dance', 0.9, dance)
action('talk', 2.0, talk)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animation_mode='NLA_TRACKS', export_skins=True,
                          export_all_influences=False, export_vertex_color='ACTIVE', export_attributes=True, export_yup=True, export_frame_step=1)
print('EXPORTED', OUT)
