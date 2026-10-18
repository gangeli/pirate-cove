# Procedural anatomical skeleton on the MakeHuman cmu_mb rig, sharing the crowd's mocap clips.
#   blender -b -P mh_skeleton.py -- <out.glb>
# Regions: 0 = bone (tinted by the instance's skin colour), 8 = sockets / gaps (untinted dark).
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
CLIP_ONLY = os.environ.get('CLIPS')
bpy.ops.wm.read_factory_settings(use_empty=True)
base, rig = mhlib.make_human({'gender': 1.0, 'muscle': 0.3, 'weight': 0.2, 'age': 0.5})
B = rig.data.bones
mw = rig.matrix_world


def H(n):
    return mw @ B[n].head_local


def T(n):
    return mw @ B[n].tail_local


bm = bmesh.new()
uvl = bm.loops.layers.uv.new('UVMap')
reg = bm.verts.layers.int.new('region')
bone_of = bm.verts.layers.string.new('bone')
cur = {'bone': 'Hips', 'region': 0}


def tag(verts):
    for v in verts:
        v[reg] = cur['region']
        v[bone_of] = cur['bone'].encode()


def fresh(fn):
    before = set(bm.verts)
    fn()
    new = [v for v in bm.verts if v not in before]
    tag(new)
    return new


def ellipsoid(c, r, segs=(10, 7), rot=None):
    def f():
        res = bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
        M = Matrix.Translation(c) @ (rot.to_4x4() if rot else Matrix()) @ Matrix.Diagonal((r[0], r[1], r[2], 1))
        bmesh.ops.transform(bm, matrix=M, verts=res['verts'])
    return fresh(f)


def rod(a, b, ra, rb=None, seg=7, knob=1.6):
    """a long bone from a to b: tapered shaft with knobbly ends"""
    rb = ra if rb is None else rb
    d = b - a
    L = d.length
    if L < 1e-4:
        return []
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    def f():
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=ra, radius2=rb, depth=L * 0.86)
        M = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=M, verts=res['verts'])
    out = fresh(f)
    if knob:
        out += ellipsoid(a + d * 0.05, (ra * knob, ra * knob, ra * knob * 0.9), (8, 5))
        out += ellipsoid(b - d * 0.05, (rb * knob, rb * knob, rb * knob * 0.9), (8, 5))
    return out


def ribbon(points, width, normal_hint=Vector((0, 0, 1))):
    """a flat strip along a polyline (ribs, clavicles)"""
    def f():
        prev = None
        for i, p in enumerate(points):
            t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            side = t.cross(normal_hint).normalized() * 0
            up = normal_hint * width / 2
            v1 = bm.verts.new(p + up)
            v2 = bm.verts.new(p - up)
            if prev:
                bm.faces.new((prev[0], prev[1], v2, v1))
            prev = (v1, v2)
    return fresh(f)


def tube(points, r, seg=5):
    def f():
        rings = []
        for i, p in enumerate(points):
            t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            a = t.orthogonal().normalized()
            b = t.cross(a).normalized()
            rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
        for i in range(len(rings) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    return fresh(f)


def use(bone, region=0):
    cur['bone'] = bone
    cur['region'] = region


# ------------------------------------------------------------------------------------------- skull
head = H('Head')
top = max((mw @ v.co).z for v in [base.data.vertices[i] for i in range(0, len(base.data.vertices), 7)])
skull_c = Vector((head.x, head.y - 0.005, head.z + 0.075))
use('Head')
ellipsoid(skull_c, (0.068, 0.088, 0.078), (14, 10))                                   # cranium
ellipsoid(skull_c + Vector((0, -0.055, -0.045)), (0.055, 0.04, 0.045), (12, 8))      # face / maxilla
ellipsoid(skull_c + Vector((0, -0.04, -0.085)), (0.045, 0.04, 0.02), (10, 6))        # jaw (mandible)
ellipsoid(skull_c + Vector((0, -0.075, -0.068)), (0.028, 0.012, 0.009), (10, 4))     # teeth
for sx in (1, -1):
    ellipsoid(skull_c + Vector((sx * 0.052, -0.035, -0.035)), (0.012, 0.02, 0.012), (6, 4))  # cheekbones
use('Head', 8)
for sx in (1, -1):
    ellipsoid(skull_c + Vector((sx * 0.026, -0.083, -0.018)), (0.017, 0.012, 0.016), (8, 6))  # eye sockets
ellipsoid(skull_c + Vector((0, -0.094, -0.046)), (0.008, 0.008, 0.013), (6, 4))  # nasal cavity
ellipsoid(skull_c + Vector((0, -0.084, -0.068)), (0.024, 0.005, 0.0025), (8, 3))  # gap between teeth

# ------------------------------------------------------------------------------------------- spine
use('LowerBack')
chain = ['LowerBack', 'Spine', 'Spine1', 'Neck', 'Neck1']
pts = []
for n in chain:
    a, b = H(n), T(n)
    k = 4 if n.startswith('Spine') or n == 'LowerBack' else 3
    for i in range(k):
        pts.append((n, a.lerp(b, (i + 0.5) / k)))
for n, p in pts:
    use(n)
    back = Vector((0, 0.035 if not n.startswith('Neck') else 0.02, 0))
    ellipsoid(p + back, (0.022, 0.02, 0.011), (8, 4))
    ellipsoid(p + back * 1.8 + Vector((0, 0, -0.008)), (0.006, 0.016, 0.008), (5, 3))  # spinous process

# ------------------------------------------------------------------------------------------- ribcage
s0, s1 = H('Spine1'), T('Spine1')
sp = H('Spine')
chest_top = s1.z - 0.02
chest_bot = sp.z + 0.02
cy = s0.y
for i in range(9):
    t = i / 8
    z = chest_top - (chest_top - chest_bot) * t
    w = 0.075 + 0.07 * math.sin(math.pi * (0.25 + 0.6 * t))
    dpt = 0.07 + 0.03 * math.sin(math.pi * (0.2 + 0.6 * t))
    use('Spine1' if t < 0.6 else 'Spine')
    for sx in (1, -1):
        arc = []
        for k in range(9):
            a = math.pi * k / 8 * (0.88 if i < 7 else 0.6)  # lower ribs are floating
            x = sx * w * math.sin(a)
            y = cy + 0.035 - (dpt + 0.035) * (1 - math.cos(a)) / 2
            zz = z - 0.045 * (1 - math.cos(a)) / 2
            arc.append(Vector((x, y, zz)))
        tube(arc, 0.0075, 4)
use('Spine1')
tube([Vector((0, cy - 0.105, chest_top - 0.005)), Vector((0, cy - 0.11, chest_top - 0.07)), Vector((0, cy - 0.1, chest_top - 0.13))], 0.012, 5)  # sternum

# ------------------------------------------------------------------------------------------- shoulders + arms
for side, sx in (('Left', 1), ('Right', -1)):
    sh = side + 'Shoulder'
    use(sh)
    tube([Vector((sx * 0.015, cy - 0.1, chest_top + 0.005)), H(side + 'Arm') + Vector((0, -0.01, 0.01))], 0.007, 5)  # clavicle
    sc = H(side + 'Arm') + Vector((-sx * 0.05, 0.07, -0.06))
    ellipsoid(sc, (0.045, 0.01, 0.06), (8, 5))  # scapula
    use(side + 'Arm')
    rod(H(side + 'Arm'), T(side + 'Arm'), 0.017, 0.014)
    use(side + 'ForeArm')
    a, b = H(side + 'ForeArm'), T(side + 'ForeArm')
    rod(a + Vector((sx * 0.009, 0, 0)), b + Vector((sx * 0.011, 0, 0)), 0.009, 0.011, knob=1.3)
    rod(a - Vector((sx * 0.007, 0, 0)), b - Vector((sx * 0.007, 0, 0)), 0.01, 0.008, knob=1.3)
    use(side + 'Hand')
    hd = T(side + 'ForeArm')
    fwd = (T(side + 'ForeArm') - H(side + 'ForeArm')).normalized()
    ellipsoid(hd + fwd * 0.03, (0.022, 0.012, 0.03), (6, 4), rot=Vector((0, 0, 1)).rotation_difference(fwd).to_matrix())
    for f in range(4):
        off = Vector((sx * (f - 1.5) * 0.009, -0.004, 0)).cross(fwd) if False else Vector(((f - 1.5) * 0.009, 0, 0))
        base_p = hd + fwd * 0.06 + off
        tube([base_p, base_p + fwd * 0.04, base_p + fwd * 0.07 + Vector((0, -0.01, 0))], 0.0035, 4)
    tube([hd + fwd * 0.02 + Vector((0, -0.015, 0)), hd + fwd * 0.05 + Vector((0, -0.035, 0))], 0.004, 4)

# ------------------------------------------------------------------------------------------- pelvis + legs
use('Hips')
hp = H('Hips')
for sx in (1, -1):
    # iliac wing: a curved plate from the sacrum to the hip socket
    wing = []
    for k in range(6):
        a = math.pi * (0.1 + 0.8 * k / 5)
        wing.append(Vector((sx * (0.04 + 0.08 * math.sin(a)), hp.y + 0.03 * math.cos(a), hp.z + 0.06 - 0.02 * math.sin(a))))
    tube(wing, 0.016, 5)
    tube([Vector((sx * 0.1, hp.y - 0.01, hp.z + 0.02)), H(('Left' if sx > 0 else 'Right') + 'UpLeg') + Vector((0, -0.01, 0.01)), Vector((sx * 0.025, hp.y - 0.06, hp.z - 0.07))], 0.011, 5)
ellipsoid(Vector((0, hp.y + 0.045, hp.z - 0.01)), (0.035, 0.018, 0.055), (8, 5))  # sacrum
for sx in (1, -1):
    ellipsoid(Vector((sx * 0.075, hp.y + 0.01, hp.z + 0.035)), (0.05, 0.022, 0.045), (8, 6), rot=Matrix.Rotation(sx * 0.5, 3, 'Z'))  # iliac blade
ellipsoid(Vector((0, hp.y - 0.055, hp.z - 0.06)), (0.04, 0.012, 0.02), (8, 4))  # pubic arch
for side in ('Left', 'Right'):
    use(side + 'UpLeg')
    rod(H(side + 'UpLeg'), T(side + 'UpLeg'), 0.021, 0.018)
    use(side + 'Leg')
    a, b = H(side + 'Leg'), T(side + 'Leg')
    ellipsoid(a + Vector((0, -0.03, 0)), (0.017, 0.01, 0.02), (6, 4))  # kneecap
    rod(a, b, 0.018, 0.013, knob=1.5)
    rod(a + Vector((0.012 if side == 'Left' else -0.012, 0.01, -0.03)), b + Vector((0.01 if side == 'Left' else -0.01, 0.005, 0.02)), 0.005, 0.005, knob=1.2)
    use(side + 'Foot')
    fa, fb = H(side + 'Foot'), T(side + 'Foot')
    ellipsoid(fa + Vector((0, 0.01, -0.03)), (0.02, 0.03, 0.02), (6, 4))  # heel
    for k in range(4):
        o = Vector(((k - 1.5) * 0.012, 0, 0))
        tube([fa + o + Vector((0, 0, -0.03)), fb + o * 1.4 + Vector((0, 0, -0.01))], 0.005, 4)
    use(side + 'ToeBase')
    ta, tb = H(side + 'ToeBase'), T(side + 'ToeBase')
    for k in range(4):
        o = Vector(((k - 1.5) * 0.014, 0, 0))
        tube([ta + o, tb + o + Vector((0, 0, -0.005))], 0.0045, 4)

bm.normal_update()
for f in bm.faces:
    for l in f.loops:
        r = l.vert[reg]
        # region 0 samples the bone tile, region 8 the dark tile
        u = 0.25 * (0.5 + 0.5 * math.sin(l.vert.co.x * 40 + l.vert.co.z * 13))
        v = 0.25 * (0.5 + 0.5 * math.cos(l.vert.co.y * 37 + l.vert.co.z * 21))
        l[uvl].uv = (u + (0.5 if r == 8 else 0.0) + 0.01, v + 0.01)

me = bpy.data.meshes.new('skeleton')
bm.to_mesh(me)
regions = [v[reg] for v in bm.verts]
bones = [v[bone_of].decode() for v in bm.verts]
body = bpy.data.objects.new('Body', me)
bpy.context.scene.collection.objects.link(body)
for b in rig.data.bones:
    body.vertex_groups.new(name=b.name)
for i, bn in enumerate(bones):
    body.vertex_groups[bn].add([i], 1.0, 'REPLACE')
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE')
mod.object = rig
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
for i, d in enumerate(ca.data):
    d.color = (regions[i] / 10, 0, 0, 1)
for p in me.polygons:
    p.use_smooth = True

# tiny atlas: left half weathered bone detail, right half dark crevice
N = 256
y, x = np.mgrid[0:N, 0:N] / N
rng = np.random.default_rng(3)
noise = rng.standard_normal((N, N))
k = np.ones(5) / 5
for _ in range(2):
    noise = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, noise)
    noise = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 0, noise)
px = np.ones((N, N, 4), dtype=np.float32)
bone = 0.5 * (0.92 + 0.12 * noise / max(1e-6, noise.std()) * 0.5)
px[:, : N // 2, 0] = bone[:, : N // 2]
px[:, : N // 2, 1] = bone[:, : N // 2] * 0.98
px[:, : N // 2, 2] = bone[:, : N // 2] * 0.93
px[:, N // 2:, :3] = np.array([0.05, 0.035, 0.025]) * 0.5 * 2
img = bpy.data.images.new('atlas', N, N, alpha=True)
img.pixels = np.clip(px, 0, 1).ravel()
mat = bpy.data.materials.new('crowd')
mat.use_nodes = True
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = img
mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
me.materials.append(mat)
bpy.data.objects.remove(base)
print('[build] skeleton verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

mhlib.bake_all_clips(rig, CLIP_ONLY)
mhlib.export_glb(rig, body, OUT)
print('[build] EXPORTED', OUT, os.path.getsize(OUT))
