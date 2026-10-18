# Build an instanced-crowd character GLB from MakeHuman (MPFB) assets + CMU motion capture.
#   blender -b -P mh_build.py -- <variant> <out.glb> [preview.png]
# Variants: pirate, pirate_f, captive, captive_f, soldier
#
# Output contract (see src/render/crowd.ts):
#  * one skinned mesh, one material whose baseColor texture is an atlas of *detail* maps: the shader multiplies
#    the texel by 2 x the per-instance colour of the vertex's region (eyes are untinted).
#  * vertex colour R = region / 10:
#      0 skin, 1 shirt, 2 trousers/skirt, 3 boots, 4 hair+brows, 5 bandana/cap (toggle), 6 sash/apron, 7 coat,
#      8 eyes (untinted), 9 tricorn (toggle), 10 beard (toggle)
#  * actions named after src/render/crowd.ts CLIPS.
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix, Euler
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
from mhlib import HumanService
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
VARIANT, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
CLIP_ONLY = os.environ.get('CLIPS')  # comma list to limit clips while iterating
D = '/root/.config/blender/4.2/extensions/.user/user_default/mpfb/data'
CL = 'clothes/{0}/{0}.mhclo'

# ------------------------------------------------------------------------------------------- variant specs
# clothes: (asset, region, target verts)
SPECS = {
    'pirate': dict(
        macro={'gender': 1.0, 'muscle': 0.62, 'weight': 0.5, 'age': 0.45, 'height': 0.5},
        skin='middleage_caucasian_male', proxy='male1591',
        hair=('hair/short02/short02.mhclo', 700),
        clothes=[('elvs_male_boho_top1', 1, 900), ('toigo_harem_pants', 2, 800), ('punkduck_riding_boots', 3, 450)],
        extras=['sash', 'bandana', 'tricorn', 'beard'],
    ),
    'pirate_f': dict(
        macro={'gender': 0.0, 'muscle': 0.6, 'weight': 0.45, 'age': 0.4},
        skin='middleage_caucasian_female', proxy='female1605',
        hair=('hair/braid01/braid01.mhclo', 700),
        clothes=[('elvs_ruffle_sleeve_peasant_blouse_1', 1, 900), ('elvs_male_trouser_short_1', 2, 700), ('grinsegold_female_pirate_boots', 3, 450)],
        extras=['sash', 'bandana', 'tricorn'],
    ),
    'captive': dict(
        macro={'gender': 1.0, 'muscle': 0.45, 'weight': 0.4, 'age': 0.5},
        skin='middleage_caucasian_male', proxy='male1591',
        hair=('hair/short04/short04.mhclo', 600),
        clothes=[('elvs_crude_t-shirt_male', 1, 700), ('rehmanpolanski_viking_pants', 2, 800)],
        extras=['beard', 'strawhat'],
    ),
    'captive_f': dict(
        macro={'gender': 0.0, 'muscle': 0.45, 'weight': 0.5, 'age': 0.45},
        skin='middleage_caucasian_female', proxy='female1605',
        hair=('hair/rehmanpolanski_hair_bun_brown/rehmanpolanski_hair_bun_brown.mhclo', 600),
        clothes=[('punkduck_medieval_dress', 2, 1300), ('elvs_ladies_apron', 6, 500), ('elvs_dirty_lil_maid_bonnet', 5, 300)],
        extras=[],
    ),
    'soldier': dict(
        macro={'gender': 1.0, 'muscle': 0.6, 'weight': 0.5, 'age': 0.4},
        skin='middleage_caucasian_male', proxy='male1591',
        hair=('hair/ponytail01/ponytail01.mhclo', 600),
        clothes=[('elvs_male_shirt_untucked_bd1', 1, 700), ('elvs_male_trouser_short_2', 2, 700), ('punkduck_riding_boots', 3, 450)],
        extras=['coat', 'tricorn', 'crossbelt'],
    ),
}
S = SPECS[VARIANT]

def log(*a):
    print('[build]', *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
base, rig = mhlib.make_human(S['macro'])


def add(path, kind='Clothes'):
    p = os.path.join(D, path)
    assert os.path.exists(p), p
    return HumanService.add_mhclo_asset(p, base, asset_type=kind, subdiv_levels=0, material_type='MAKESKIN')


proxy = add(f"proxymeshes/{S['proxy']}/{S['proxy']}.proxy", 'Proxymeshes')
HumanService.set_character_skin(os.path.join(D, f"skins/{S['skin']}/{S['skin']}.mhmat"), base, bodyproxy=proxy, skin_type='MAKESKIN')
parts = [(proxy, 0, None)]
parts.append((add('eyes/low-poly/low-poly.mhclo', 'Eyes'), 8, None))
parts.append((add('eyebrows/eyebrow001/eyebrow001.mhclo', 'Eyebrows'), 4, None))
hp, hn = S['hair']
parts.append((add(hp, 'Hair'), 4, hn))
for name, region, n in S['clothes']:
    parts.append((add(CL.format(name)), region, n))


def write_credits():
    import glob
    meta = {}
    for f in glob.glob(os.path.join(D, 'packs', '*.json')):
        for k, v in json.load(open(f)).items():
            meta[k] = v
    used = [S['proxy'], S['skin'], 'low-poly', 'eyebrow001', os.path.basename(S['hair'][0]).replace('.mhclo', '')] + [c[0] for c in S['clothes']]
    out = []
    for k in used:
        m = meta.get(k, {})
        out.append({'asset': m.get('name') or k, 'id': k, 'author': m.get('author', 'MakeHuman'), 'license': m.get('license', 'CC0'),
                    'url': 'https://static.makehumancommunity.org/assets/assetpacks.html'})
    d = '/home/user/pirate-cove/src/charcredits'
    os.makedirs(d, exist_ok=True)
    json.dump(out, open(os.path.join(d, VARIANT + '.json'), 'w'), indent=1)


write_credits()


def diffuse_image(obj):
    best = None
    for slot in obj.material_slots:
        if not slot.material or not slot.material.use_nodes:
            continue
        for nd in slot.material.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image:
                nm = nd.image.name.lower()
                if any(k in nm for k in ('norm', 'bump', 'rough', 'spec', 'ao', 'disp', 'metal')):
                    continue
                if best is None or 'diffuse' in nm or 'color' in nm:
                    best = nd.image
    return best


# ------------------------------------------------------------------------------------------- bake modifiers
def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    for m in list(obj.modifiers):
        if m.type == 'ARMATURE':
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:  # noqa
            log('modifier apply failed', obj.name, m.name, e)
            obj.modifiers.remove(m)
    # shape keys (macro targets live on the basemesh only; clothes are already fitted)
    if obj.data.shape_keys:
        obj.shape_key_add(name='mix', from_mix=True)
        for kb in list(obj.data.shape_keys.key_blocks)[:-1]:
            obj.shape_key_remove(kb)
        obj.shape_key_remove(obj.data.shape_keys.key_blocks[0])


imgs = {}
for o, r, n in parts:
    imgs[o.name] = diffuse_image(o)
    apply_all(o)
    log('part', o.name, 'region', r, 'verts', len(o.data.vertices), 'img', imgs[o.name].name if imgs[o.name] else None)


def decimate(obj, target):
    nv = len(obj.data.vertices)
    if not target or nv <= target:
        return
    m = obj.modifiers.new('dec', 'DECIMATE')
    m.ratio = target / nv
    m.use_collapse_triangulate = False
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier='dec')
    log('decimated', obj.name, nv, '->', len(obj.data.vertices))


for o, r, n in parts:
    decimate(o, n)

# ------------------------------------------------------------------------------------------- geometry probes
def bone_head(name):
    return rig.matrix_world @ rig.data.bones[name].head_local


def bone_tail(name):
    return rig.matrix_world @ rig.data.bones[name].tail_local


body_v = [proxy.matrix_world @ v.co for v in proxy.data.vertices]
head_top = max(v.z for v in body_v)
neck = bone_head('Neck1') if 'Neck1' in rig.data.bones else bone_head('Neck')
head_c = bone_head('Head')
log('head top', head_top, 'head bone', head_c, 'neck', neck)


def new_obj(name, bm, weights):
    """weights: list per vertex of {bone: w}"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for b in rig.data.bones:
        ob.vertex_groups.new(name=b.name)
    for i, wd in enumerate(weights):
        for bn, w in wd.items():
            ob.vertex_groups[bn].add([i], w, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    me.shade_smooth() if hasattr(me, 'shade_smooth') else None
    return ob


def skin_weights_at(points):
    """copy weights from the nearest body proxy vertex"""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(body_v))
    for i, v in enumerate(body_v):
        kd.insert(v, i)
    kd.balance()
    vg = {g.index: g.name for g in proxy.vertex_groups}
    out = []
    for p in points:
        co, i, d = kd.find(p)
        wd = {}
        for g in proxy.data.vertices[i].groups:
            nm = vg[g.group]
            if nm in rig.data.bones and g.weight > 0.01:
                wd[nm] = g.weight
        out.append(wd)
    return out


def rigid(bone):
    return lambda pts: [{bone: 1.0} for _ in pts]


def shell_from(src, select, offset, name, flare=None):
    """offset copy of the faces of src whose vertices pass select(co) (world space); weights copied from src"""
    bm = bmesh.new()
    me = src.data
    keep = set(i for i, v in enumerate(me.vertices) if select(src.matrix_world @ v.co))
    remap = {}
    for i in keep:
        v = me.vertices[i]
        co = src.matrix_world @ v.co
        nrm = (src.matrix_world.to_3x3() @ v.normal).normalized()
        off = offset(co) if callable(offset) else offset
        p = co + nrm * off
        if flare:
            p = flare(p, co)
        remap[i] = bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.new('UVMap')
    src_uv = me.uv_layers.active.data if me.uv_layers else None
    for poly in me.polygons:
        if all(vi in keep for vi in poly.vertices):
            try:
                f = bm.faces.new([remap[vi] for vi in poly.vertices])
            except ValueError:
                continue
            for li, loop in zip(poly.loop_indices, f.loops):
                loop[uvl].uv = src_uv[li].uv if src_uv else (0, 0)
    bm.normal_update()
    pts = [v.co.copy() for v in bm.verts]
    idx_src = sorted(keep)
    vg = {g.index: g.name for g in src.vertex_groups}
    weights = []
    for i in remap:
        wd = {}
        for g in me.vertices[i].groups:
            nm = vg.get(g.group)
            if nm in rig.data.bones and g.weight > 0.01:
                wd[nm] = g.weight
        weights.append(wd)
    return new_obj(name, bm, weights)


extras = []  # (obj, region, image-or-color)
EX = S['extras']
cloth = {r: o for o, r, n in parts}
shirt = cloth.get(1)
pants = cloth.get(2)

def ring_around(src_objs, z0, z1, pad, name, rows=3, seg=40, tails=False):
    """a band hugging the outside of the given garments between heights z0..z1 (world)"""
    pts = []
    for so in src_objs:
        mw = so.matrix_world
        pts += [mw @ v.co for v in so.data.vertices]
    zc = (z0 + z1) / 2
    near = [p for p in pts if z0 - 0.03 < p.z < z1 + 0.03]
    cx = sum(p.x for p in near) / len(near)
    cy = sum(p.y for p in near) / len(near)
    # ignore hands and sleeves hanging beside the waist
    near = [p for p in near if abs(p.x - cx) < 0.2 and abs(p.y - cy) < 0.17]
    radius = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        dx, dy = math.cos(a), math.sin(a)
        best = 0.05
        for p in near:
            rx, ry = p.x - cx, p.y - cy
            proj = rx * dx + ry * dy
            perp = abs(-rx * dy + ry * dx)
            if perp < 0.03 and proj > best:
                best = proj
        radius.append(best + pad)
    # smooth the radius profile
    radius = [(radius[k - 1] + 2 * radius[k] + radius[(k + 1) % seg]) / 4 for k in range(seg)]
    bm = bmesh.new()
    grid = []
    for r_ in range(rows):
        z = z0 + (z1 - z0) * r_ / (rows - 1)
        bulge = 1 + 0.06 * math.sin(math.pi * r_ / (rows - 1))
        grid.append([bm.verts.new((cx + math.cos(2 * math.pi * k / seg) * radius[k] * bulge, cy + math.sin(2 * math.pi * k / seg) * radius[k] * bulge, z)) for k in range(seg)])
    for r_ in range(rows - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new((grid[r_][k], grid[r_][k2], grid[r_ + 1][k2], grid[r_ + 1][k]))
    if tails:
        # knotted ends hanging at the left hip
        k = int(seg * 0.12)
        base = Vector((cx + math.cos(2 * math.pi * k / seg) * radius[k], cy + math.sin(2 * math.pi * k / seg) * radius[k], z0))
        for off, ln in ((0.0, 0.2), (0.035, 0.16)):
            a = bm.verts.new(base + Vector((off - 0.02, -0.01, 0.01)))
            b = bm.verts.new(base + Vector((off + 0.02, -0.01, 0.01)))
            c = bm.verts.new(base + Vector((off + 0.03 + 0.01, 0.0, -ln)))
            d = bm.verts.new(base + Vector((off - 0.01, 0.0, -ln)))
            bm.faces.new((a, b, c, d))
    bm.normal_update()
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (math.atan2(l.vert.co.y - cy, l.vert.co.x - cx) / (2 * math.pi) + 0.5, (l.vert.co.z - z0) / max(0.01, z1 - z0))
    return new_obj(name, bm, skin_weights_at([v.co for v in bm.verts]))


if 'sash' in EX and (shirt or pants):
    waist_z = bone_head('Hips').z + 0.11
    srcs = [o for o in (shirt, pants) if o]
    extras.append((ring_around(srcs, waist_z - 0.04, waist_z + 0.04, 0.012, 'sash', tails=True), 6, 'cloth'))
if 'bandana' in EX:
    hair = cloth.get(4) if False else [o for o, r, n in parts if r == 4 and 'eyebrow' not in o.name][0]
    brow = head_c.z + 0.075
    def sel(c):
        return c.z > brow - (0.03 if c.y > head_c.y else -0.02)
    extras.append((shell_from(hair, sel, 0.008, 'bandana'), 5, 'cloth'))
if 'beard' in EX:
    T = head_top
    def sel(c):
        front = c.y < head_c.y - 0.015
        jaw = T - 0.25 < c.z < T - 0.188 and abs(c.x) < 0.072
        tash = T - 0.183 < c.z < T - 0.168 and abs(c.x) < 0.03 and c.y < head_c.y - 0.07
        sideburn = T - 0.188 < c.z < T - 0.12 and 0.055 < abs(c.x) < 0.08 and c.y < head_c.y + 0.01
        return front and (jaw or tash) or sideburn
    extras.append((shell_from(proxy, sel, 0.004, 'beard'), 10, 'hair'))


def tricorn():
    """three-cornered hat: felt crown + brim cocked up on three sides"""
    bm = bmesh.new()
    top = head_top
    r_in, r_out, seg = 0.098, 0.165, 36
    cz = top - 0.075
    ring_in, ring_out, crown = [], [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        # cocked brim: three peaks (front point + two back corners)
        cock = max(0.0, math.cos(3 * (a + math.pi / 2)))  # 1 at the three corners
        up = 0.065 * (1 - cock) ** 0.6
        ro = r_out * (0.88 + 0.12 * cock)
        ring_in.append(bm.verts.new((head_c.x + math.cos(a) * r_in, head_c.y + math.sin(a) * r_in * 1.08, cz)))
        ring_out.append(bm.verts.new((head_c.x + math.cos(a) * ro, head_c.y + math.sin(a) * ro, cz + up)))
        crown.append(bm.verts.new((head_c.x + math.cos(a) * r_in * 0.9, head_c.y + math.sin(a) * r_in * 0.98, cz + 0.095)))
    capv = bm.verts.new((head_c.x, head_c.y, cz + 0.108))
    for k in range(seg):
        k2 = (k + 1) % seg
        bm.faces.new((ring_in[k], ring_out[k], ring_out[k2], ring_in[k2]))
        bm.faces.new((ring_in[k2], crown[k2], crown[k], ring_in[k]))
        bm.faces.new((crown[k], crown[k2], capv))
    # underside of brim (double-sided)
    for k in range(seg):
        k2 = (k + 1) % seg
        a, b, c, d = ring_in[k], ring_out[k], ring_out[k2], ring_in[k2]
        nv = [bm.verts.new(v.co - Vector((0, 0, 0.004))) for v in (a, b, c, d)]
        bm.faces.new((nv[3], nv[2], nv[1], nv[0]))
    bm.normal_update()
    # tilt slightly forward and rotate so a corner points to the front (-Y)
    R = Matrix.Rotation(math.radians(-6), 4, 'X')
    for v in bm.verts:
        v.co = head_c + (R @ (v.co - head_c))
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (0.5 + (l.vert.co.x - head_c.x) * 2, 0.5 + (l.vert.co.y - head_c.y) * 2)
    return new_obj('tricorn', bm, [{'Head': 1.0} for _ in bm.verts])


def strawhat():
    bm = bmesh.new()
    cz = head_top - 0.05
    seg = 28
    ri, ro = 0.1, 0.24
    inner, outer, crown = [], [], []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        inner.append(bm.verts.new((head_c.x + math.cos(a) * ri, head_c.y + math.sin(a) * ri * 1.08, cz)))
        outer.append(bm.verts.new((head_c.x + math.cos(a) * ro, head_c.y + math.sin(a) * ro, cz - 0.03)))
        crown.append(bm.verts.new((head_c.x + math.cos(a) * ri * 0.85, head_c.y + math.sin(a) * ri * 0.92, cz + 0.07)))
    cap = bm.verts.new((head_c.x, head_c.y, cz + 0.085))
    for k in range(seg):
        k2 = (k + 1) % seg
        bm.faces.new((inner[k], outer[k], outer[k2], inner[k2]))
        bm.faces.new((inner[k2], crown[k2], crown[k], inner[k]))
        bm.faces.new((crown[k], crown[k2], cap))
        nv = [bm.verts.new(v.co - Vector((0, 0, 0.004))) for v in (inner[k], outer[k], outer[k2], inner[k2])]
        bm.faces.new((nv[3], nv[2], nv[1], nv[0]))
    bm.normal_update()
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (0.5 + (l.vert.co.x - head_c.x) * 2, 0.5 + (l.vert.co.y - head_c.y) * 2)
    return new_obj('strawhat', bm, [{'Head': 1.0} for _ in bm.verts])


if 'tricorn' in EX:
    extras.append((tricorn(), 9, 'felt'))
if 'strawhat' in EX:
    extras.append((strawhat(), 5, 'straw'))
if 'coat' in EX:
    # long-skirted regimental coat: shell of the shirt (torso + sleeves) plus skirts flaring from the hips to the knee
    knee = bone_head('LeftLeg').z
    hipz = bone_head('Hips').z
    def sel(c):
        return True
    coat = shell_from(shirt, sel, 0.014, 'coat')
    extras.append((coat, 7, 'wool'))
    # skirts: cylinder-ish shell from body proxy between hip and knee, flared
    def sel2(c):
        return knee + 0.05 < c.z < hipz + 0.02
    def flare(p, co):
        t = (hipz - co.z) / max(0.01, hipz - knee)
        d = Vector((p.x, p.y + 0.01, 0))
        d.normalize()
        return p + d * (0.025 + 0.07 * t)
    skirt = shell_from(proxy, sel2, 0.02, 'coatskirt', flare=flare)
    # skirts follow the hips/thighs loosely: blend thigh weights toward the hips
    for v in skirt.data.vertices:
        gs = {skirt.vertex_groups[g.group].name: g.weight for g in v.groups}
        tot = sum(gs.values()) or 1
        for g in v.groups:
            g.weight = g.weight * 0.45
        skirt.vertex_groups['Hips'].add([v.index], 0.55, 'ADD')
    extras.append((skirt, 7, 'wool'))
if 'crossbelt' in EX:
    pass

# ------------------------------------------------------------------------------------------- atlas
ATLAS = 2048
atlas = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
atlas[..., 3] = 1
TILE = {}
slots = [(0, 0, 1024)]  # skin gets 1024
for y in range(0, ATLAS, 512):
    for x in range(0, ATLAS, 512):
        if x < 1024 and y < 1024:
            continue
        slots.append((x, y, 512))
slot_i = 0


def img_pixels(im, size):
    im2 = im.copy()
    im2.scale(size, size)
    a = np.array(im2.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(im2)
    return a


def procedural_detail(kind, size):
    rng = np.random.default_rng(abs(hash(kind)) % 1000)
    y, x = np.mgrid[0:size, 0:size] / size
    if kind == 'straw':
        v = 0.85 + 0.15 * np.sin((x * 60 + np.sin(y * 20)) * np.pi) * np.sin(y * 70 * np.pi)
    elif kind == 'felt':
        v = 0.9 + 0.08 * rng.standard_normal((size, size)) * 0.5
    elif kind == 'wool':
        v = 0.92 + 0.06 * np.sin(x * 400) * np.sin(y * 400) + 0.03 * rng.standard_normal((size, size))
    elif kind == 'hair':
        v = 0.85 + 0.15 * np.sin(x * 300 + rng.standard_normal((size, size)) * 0.6)
    else:  # cloth
        v = 0.92 + 0.05 * np.sin(x * 500) * np.sin(y * 500) + 0.03 * rng.standard_normal((size, size))
    a = np.ones((size, size, 4), dtype=np.float32)
    a[..., 0] = a[..., 1] = a[..., 2] = np.clip(v, 0, 1.6)
    return a


def to_detail(px, region):
    rgb = px[..., :3]
    alpha = px[..., 3]
    mask = alpha > 0.5
    if not mask.any():
        mask = np.ones_like(alpha, bool)
    if region == 8:
        out = rgb
    elif region == 0:
        mean = rgb[mask].mean(axis=0)
        out = rgb / np.maximum(mean, 1e-3)
    elif region == 4:
        lum = rgb @ np.array([0.299, 0.587, 0.114])
        m = lum[mask].mean()
        out = np.repeat((0.45 + 0.55 * lum / max(m, 1e-3))[..., None], 3, axis=2)
    else:
        # fabric: printed patterns would turn into camouflage once tinted, so keep only broad shading
        # (seams, folds, wear) from a heavily blurred luminance, plus a fine procedural weave
        lum = rgb @ np.array([0.299, 0.587, 0.114])
        m = lum[mask].mean()
        n = lum.shape[0]
        small = lum.reshape(16, n // 16, 16, n // 16).mean(axis=(1, 3))
        yy = np.linspace(0, 15, n)
        bl = np.array([np.interp(yy, np.arange(16), row) for row in small])
        bl = np.array([np.interp(yy, np.arange(16), col) for col in bl.T]).T
        shade = bl / max(m, 1e-3)
        shade = 0.8 + 0.2 * np.clip(shade, 0.3, 1.7)
        rng = np.random.default_rng(region)
        weave = 1 + 0.035 * np.sin(np.arange(n)[None, :] * 2.1) * np.sin(np.arange(n)[:, None] * 2.1) + 0.03 * rng.standard_normal((n, n))
        out = np.repeat((shade * weave)[..., None], 3, axis=2)
    res = np.empty_like(px)
    res[..., :3] = np.clip(out * 0.5, 0, 1)
    res[..., 3] = alpha
    return res


def place(obj, region, src):
    """put obj's texture into the next atlas slot and remap its UVs"""
    global slot_i
    if src == 'skin' or region == 0:
        x0, y0, sz = slots[0]
    else:
        slot_i += 1
        x0, y0, sz = slots[slot_i]
    if isinstance(src, str) and src not in ('skin',):
        px = procedural_detail(src, sz)
    elif src is None:
        px = procedural_detail('cloth', sz)
    else:
        px = img_pixels(src, sz)
    # blender image pixels start bottom-left; numpy row 0 = bottom
    atlas[y0:y0 + sz, x0:x0 + sz] = to_detail(px, region) if not isinstance(src, str) else np.concatenate([px[..., :3] * 0.5, px[..., 3:]], axis=-1)
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    pad = 2 / ATLAS
    for l in uv:
        u, v = l.uv
        u = min(max(u - math.floor(u) if (u > 1.0001 or u < -0.0001) else u, 0), 1)
        v = min(max(v - math.floor(v) if (v > 1.0001 or v < -0.0001) else v, 0), 1)
        l.uv = (x0 / ATLAS + pad + u * (sz / ATLAS - 2 * pad), y0 / ATLAS + pad + v * (sz / ATLAS - 2 * pad))


all_parts = [(o, r, imgs.get(o.name)) for o, r, n in parts] + extras
for o, r, src in all_parts:
    if r == 0:
        place(o, 0, src)
for o, r, src in all_parts:
    if r != 0:
        place(o, r, src)

atlas_img = bpy.data.images.new('atlas', ATLAS, ATLAS, alpha=True)
atlas_img.pixels = atlas.ravel()
atlas_img.filepath_raw = '/tmp/_atlas_%s.png' % VARIANT
atlas_img.file_format = 'PNG'
atlas_img.save()

# ------------------------------------------------------------------------------------------- regions + join
for o, r, src in all_parts:
    me = o.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for d in ca.data:
        d.color = (r / 10, 0, 0, 1)
    me.materials.clear()

mat = bpy.data.materials.new('crowd')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = atlas_img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
mat.blend_method = 'CLIP'
bsdf.inputs['Roughness'].default_value = 0.85

objs = [o for o, r, s in all_parts]
for o in objs:
    o.data.materials.append(mat)
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = proxy
bpy.ops.object.join()
body = proxy
body.name = 'Body'
# drop vertex groups that aren't bones (MPFB helper groups) and limit to 4 influences
for g in list(body.vertex_groups):
    if g.name not in rig.data.bones:
        body.vertex_groups.remove(g)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
# remove the hidden basemesh
bpy.data.objects.remove(base)
log('final verts', len(body.data.vertices), 'tris', sum(len(p.vertices) - 2 for p in body.data.polygons))

# ------------------------------------------------------------------------------------------- animation + export
mhlib.bake_all_clips(rig, CLIP_ONLY)
mhlib.export_glb(rig, body, OUT)
log('EXPORTED', OUT, os.path.getsize(OUT))
