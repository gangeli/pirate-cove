# Painted period portraits rendered from MakeHuman heads.
#   blender -b -P mh_portraits.py -- <out_dir> [id ...]
# Each portrait: full-resolution basemesh + skin, particle-hair beard, hat/coat built here, Rembrandt lighting,
# then an oil-paint post-process (Kuwahara + canvas + varnish) in numpy.
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
from mhlib import HumanService
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
OUTDIR = argv[0]
ONLY = argv[1:]
D = '/root/.config/blender/4.2/extensions/.user/user_default/mpfb/data'
W, H = 480, 600
SS = 2  # render supersampling for the paint filter


def rgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x ** 2.2 for x in c)


SKINS = {'light': 'middleage_caucasian_male', 'lightf': 'middleage_caucasian_female', 'old': 'old_caucasian_male', 'oldf': 'old_caucasian_female',
         'african': 'middleage_african_male', 'africanf': 'middleage_african_female', 'asian': 'middleage_asian_male', 'young': 'young_caucasian_male',
         'youngf': 'young_caucasian_female', 'freckles': 'toigo_light_skin_female_freckles', 'ginger': 'toigo_light_skin_female_ginger'}
HAIR = {'short': 'short02', 'short2': 'short04', 'long': 'long01', 'tied': 'ponytail01', 'curly': 'punkduck_alpha7_curly', 'curlyf': 'punkduck_alpha7_curly2',
        'braid': 'braid01', 'bun': 'rehmanpolanski_hair_bun_brown', 'afro': 'afro01', 'bob': 'bob02', 'messy': 'cortu_short_messy_hair', 'grump': 'elvs_grump_hair',
        'longf': 'punkduck_alpha7_long', 'none': None}

# id: spec. macro values 0..1; colours hex; beard one of none/stubble/full/braided/goatee/moustache/chin
P = {
    'blackbeard': dict(sex='M', macro=dict(age=0.75, muscle=0.75, weight=0.6), skin='light', hair='long', hairc='#141010', beard='braided', beardc='#141010', hat='tricorn', hatc='#1a1612', coat='#1c1a20', shirt='#d8d0c0', bg='#2a2a32', scar=True),
    'bart': dict(sex='M', macro=dict(age=0.70, muscle=0.6), skin='african', hair='short2', hairc='#141010', beard='moustache', beardc='#141010', hat='cavalier', hatc='#6a1414', plume='#e8e0d0', coat='#7a1414', shirt='#e8e0d0', bg='#3a2a40', earring=True),
    'bonny': dict(sex='F', macro=dict(age=0.64, muscle=0.5), skin='freckles', hair='curlyf', hairc='#9a3a14', hat='bandana', hatc='#1a3a6a', coat='#5a2222', shirt='#e8e0d0', bg='#4a3030', earring=True),
    'mary': dict(sex='F', macro=dict(age=0.68), skin='lightf', hair='longf', hairc='#4a2414', hat='cavalier', hatc='#2a1a3a', plume='#a03030', coat='#4a1a4a', shirt='#e8e0d0', bg='#40283a', earring=True),
    'calico': dict(sex='M', macro=dict(age=0.68, muscle=0.5, weight=0.45), skin='light', hair='tied', hairc='#5a3214', beard='goatee', beardc='#5a3214', hat='tricorn', hatc='#3a2a1a', coat='#d8c4a0', shirt='#c84a3a', bg='#3e4a32'),
    'low': dict(sex='M', macro=dict(age=0.72, muscle=0.55, weight=0.4), skin='light', hair='short', hairc='#2a1a14', beard='stubble', beardc='#2a1a14', hat='tricorn', hatc='#222222', coat='#2a2a2a', shirt='#c8c0b0', bg='#303030', eyepatch=True, scar=True),
    'deberry': dict(sex='F', macro=dict(age=0.64), skin='youngf', hair='braid', hairc='#c8a050', hat='bandana', hatc='#2a6a3a', coat='#2a4a3a', shirt='#e8e0d0', bg='#2e4a3e'),
    'lolonnais': dict(sex='M', macro=dict(age=0.70, muscle=0.6), skin='light', hair='long', hairc='#3a2410', beard='moustache', beardc='#3a2410', hat='cavalier', hatc='#1a2a4a', plume='#e8e0d0', coat='#1a2a5a', shirt='#e8e0d0', bg='#28344e'),
    'morgan': dict(sex='M', macro=dict(age=0.77, weight=0.65), skin='light', hair='curly', hairc='#3a2210', beard='moustache', beardc='#3a2210', hat='cavalier', hatc='#2a1410', plume='#d8c070', coat='#7a1a1a', shirt='#ece4d4', bg='#4a3020'),
    'degraff': dict(sex='M', macro=dict(age=0.68, muscle=0.6), skin='light', hair='tied', hairc='#c09048', beard='goatee', beardc='#b08040', hat='tricorn', hatc='#1a1a24', coat='#2a3a6a', shirt='#e8e0d0', bg='#2e3c4e'),
    'bonnet': dict(sex='M', macro=dict(age=0.75, weight=0.6, muscle=0.35), skin='old', hair='curly', hairc='#e0d8c8', beard='none', hat='tricorn', hatc='#3a2a4a', coat='#5a3a7a', shirt='#f0ece0', bg='#4a3a58'),
    'read': dict(sex='F', macro=dict(age=0.66, muscle=0.65), skin='lightf', hair='tied', hairc='#24160c', hat='tricorn', hatc='#2a2a20', coat='#3a3a2a', shirt='#d8d0c0', bg='#3a3a2c', scar=True),
    'vanhoorn': dict(sex='M', macro=dict(age=0.72, muscle=0.6, weight=0.6), skin='light', hair='long', hairc='#c8b068', beard='full', beardc='#b89a58', hat='tricorn', hatc='#2a2214', coat='#a88a38', shirt='#e8e0d0', bg='#4a3c22'),
    'brasiliano': dict(sex='M', macro=dict(age=0.70, muscle=0.7, weight=0.65), skin='african', hair='short2', hairc='#141010', beard='full', beardc='#141010', hat='bandana', hatc='#b07a1a', coat='#5a3a1a', shirt='#d8ccb0', bg='#4a3418', earring=True),
    'delahaye': dict(sex='F', macro=dict(age=0.66), skin='ginger', hair='curlyf', hairc='#8a2a0e', hat='bandana', hatc='#3a1a3a', coat='#3a1a3a', shirt='#e8e0d0', bg='#381c2c', earring=True),
    'kidd': dict(sex='M', macro=dict(age=0.79, weight=0.55), skin='old', hair='long', hairc='#5a3a1a', beard='goatee', beardc='#5a4030', hat='cavalier', hatc='#141414', plume='#e8e0d0', coat='#1a3a2a', shirt='#ece4d4', bg='#26362a'),
    'barnaby': dict(sex='M', macro=dict(age=0.88, weight=0.6, muscle=0.45), skin='old', hair='grump', hairc='#d8d4cc', beard='full', beardc='#e0dcd4', hat='bandana', hatc='#9a1a14', coat='#3a2e24', shirt='#d8ccb0', bg='#2a3a44'),
}


TG = '/root/.config/blender/4.2/extensions/user_default/mpfb/data/targets'


def apply_face(base, pid, sex, extra=None):
    """deterministic per-character facial structure so every portrait is a distinct person"""
    from mhlib import TargetService
    import random
    r = random.Random(pid)
    t = {}
    if sex == 'M':
        t[r.choice(['head/head-square', 'head/head-rectangular', 'head/head-oval', 'head/head-diamond'])] = r.uniform(0.3, 0.8)
        t['chin/chin-bones-incr'] = r.uniform(0.2, 0.7)
        t['chin/chin-prognathism-incr'] = r.uniform(0.0, 0.4)
        t['eyebrows/eyebrows-trans-down'] = r.uniform(0.2, 0.6)
        t['eyebrows/eyebrows-angle-down'] = r.uniform(0.0, 0.5)
    else:
        t[r.choice(['head/head-oval', 'head/head-invertedtriangular', 'head/head-round'])] = r.uniform(0.2, 0.6)
        t['eyebrows/eyebrows-angle-up'] = r.uniform(0.0, 0.3)
    side = r.choice(['incr', 'decr'])
    t[f'nose/nose-hump-{side}'] = r.uniform(0.0, 0.7)
    t[r.choice(['nose/nose-scale-horiz-incr', 'nose/nose-scale-horiz-decr', 'nose/nose-greek-incr', 'nose/nose-point-down'])] = r.uniform(0.2, 0.6)
    for sd in ('l', 'r'):
        t[f'cheek/{sd}-cheek-bones-incr'] = r.uniform(0.1, 0.5) if sex == 'M' else r.uniform(0.0, 0.3)
    t.update(extra or {})
    for k, w in t.items():
        path = os.path.join(TG, k + '.target.gz')
        if os.path.exists(path):
            TargetService.load_target(base, path, weight=w)


def gen_pool():
    import random
    r = random.Random(7)
    HC = ['#141010', '#2a1a10', '#3a2414', '#5a3418', '#7a4a20', '#9a5a2a', '#b08848', '#8a8478', '#d0ccc4']
    BG = ['#2a2a32', '#3a2a24', '#2a3a34', '#3a3424', '#30283a', '#3a2228']
    COAT = ['#5a1a14', '#1a2a4a', '#2a3a24', '#3a2a1a', '#4a3a2a', '#2a2a2a', '#6a4a20', '#3a1a3a']
    SH = ['#e8e0d0', '#d8ccb0', '#c8b898', '#a85040', '#5a6a8a']
    for i in range(14):
        hc = r.choice(HC[:7])
        P[f'pm{i:02d}'] = dict(sex='M', macro=dict(age=r.uniform(0.6, 0.85), muscle=r.uniform(0.45, 0.8), weight=r.uniform(0.35, 0.7)),
            skin=r.choice(['light', 'light', 'light', 'old', 'african', 'asian']), hair=r.choice(['short', 'short2', 'long', 'tied', 'curly', 'messy', 'grump']), hairc=hc,
            beard=r.choice(['none', 'stubble', 'stubble', 'full', 'goatee', 'moustache', 'chin']), beardc=hc,
            hat=r.choice(['none', 'bandana', 'bandana', 'tricorn', 'cavalier']), hatc=r.choice(['#9a1a14', '#1a1a1a', '#2a4a8a', '#c8b898', '#5a2a5a', '#a06020']),
            plume='#e8e0d0', coat=r.choice(COAT + [None, None, None]), shirt=r.choice(SH), bg=r.choice(BG), earring=r.random() < 0.35, eyepatch=r.random() < 0.1, scar=r.random() < 0.25)
    for i in range(6):
        P[f'pf{i:02d}'] = dict(sex='F', macro=dict(age=r.uniform(0.55, 0.75), muscle=r.uniform(0.4, 0.65)), skin=r.choice(['lightf', 'youngf', 'freckles', 'africanf', 'ginger']),
            hair=r.choice(['longf', 'curlyf', 'braid', 'tied', 'long']), hairc=r.choice(HC[:7]), hat=r.choice(['none', 'bandana', 'tricorn']),
            hatc=r.choice(['#9a1a14', '#1a1a1a', '#2a4a8a', '#5a2a5a']), coat=r.choice(COAT + [None]), shirt=r.choice(SH[:3]), bg=r.choice(BG), earring=r.random() < 0.5)
    for i in range(8):
        hc = r.choice(HC)
        P[f'cm{i:02d}'] = dict(sex='M', macro=dict(age=r.uniform(0.6, 0.9), muscle=r.uniform(0.3, 0.6), weight=r.uniform(0.3, 0.6)),
            skin=r.choice(['light', 'old', 'african', 'african', 'asian']), hair=r.choice(['short', 'short2', 'messy', 'grump', 'none']), hairc=hc,
            beard=r.choice(['none', 'stubble', 'stubble', 'full']), beardc=hc, hat='none', coat=None, shirt=r.choice(['#c8b898', '#a8a090', '#8a8070', '#d8ccb0']), bg=r.choice(BG))
    for i in range(6):
        P[f'cf{i:02d}'] = dict(sex='F', macro=dict(age=r.uniform(0.55, 0.85), weight=r.uniform(0.4, 0.65)), skin=r.choice(['lightf', 'oldf', 'africanf', 'africanf', 'youngf']),
            hair=r.choice(['bun', 'braid', 'tied', 'bun']), hairc=r.choice(HC), hat=r.choice(['bonnet', 'none', 'bonnet']), coat=None, shirt=r.choice(['#c8b898', '#a85040', '#8a8070', '#d8ccb0']), bg=r.choice(BG))
    for nat, coat in (('eng', '#a01c1c'), ('fra', '#1c3a8a'), ('spa', '#d8d0b0')):
        for i in range(2):
            P[f's{nat}{i}'] = dict(sex='M', macro=dict(age=r.uniform(0.58, 0.72), muscle=0.6), skin=r.choice(['light', 'light', 'old']), hair='tied', hairc=r.choice(HC[:6]),
                beard=r.choice(['none', 'moustache']), beardc='#2a1a10', hat='tricorn', hatc='#141414', coat=coat, shirt='#ece8e0', bg='#2a2a2a', cravat=True)
    for i in range(3):
        P[f'wm{i}'] = dict(sex='M', macro=dict(age=r.uniform(0.7, 0.9), weight=r.uniform(0.55, 0.8), muscle=0.35), skin=r.choice(['light', 'old']), hair='curly', hairc=r.choice(['#e8e4dc', '#d8d0c0', '#3a2414']),
            beard='none', hat=r.choice(['tricorn', 'none']), hatc='#141414', coat=r.choice(['#3a1a4a', '#1a3a2a', '#5a1a14']), shirt='#f0ece4', bg=r.choice(BG), cravat=True)
        P[f'wf{i}'] = dict(sex='F', macro=dict(age=r.uniform(0.6, 0.8)), skin=r.choice(['lightf', 'youngf']), hair=r.choice(['bun', 'curlyf']), hairc=r.choice(['#d8b878', '#3a2414', '#7a4a20']),
            hat='none', coat=r.choice(['#6a2a8a', '#2a4a6a', '#8a2a3a']), shirt='#f0ece4', bg=r.choice(BG), buttons=False)


def tint_material(obj, color, mix=0.85):
    """multiply the diffuse texture by colour (works through MakeSkin node groups)"""
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        done = False
        for tex in [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image]:
            nm = tex.image.name.lower()
            if any(k in nm for k in ('norm', 'bump', 'rough', 'spec', 'ao', 'disp')):
                continue
            links = [l for l in nt.links if l.from_node == tex and l.from_socket.name == 'Color']
            if not links:
                continue
            mixn = nt.nodes.new('ShaderNodeMix')
            mixn.data_type = 'RGBA'
            mixn.blend_type = 'MULTIPLY'
            mixn.inputs['Factor'].default_value = mix
            # desaturate the texture first so it only contributes shading
            hsv = nt.nodes.new('ShaderNodeHueSaturation')
            hsv.inputs['Saturation'].default_value = 0.0
            hsv.inputs['Value'].default_value = 2.4
            nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
            nt.links.new(hsv.outputs['Color'], mixn.inputs[6])
            mixn.inputs[7].default_value = (*color, 1)
            for l in links:
                nt.links.new(mixn.outputs[2], l.to_socket)
            done = True
        if not done:
            for n in nt.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    n.inputs['Base Color'].default_value = (*color, 1)


def plain(name, color, rough=0.7, sheen=0.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if not metal:
        b.inputs['Specular IOR Level'].default_value = 0.12
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen * 0.15
        b.inputs['Sheen Tint'].default_value = (*color, 1)
    # cloth weave bump
    nt = m.node_tree
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 400
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.15
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def shell(src, select, offset, name, mat, solid=0.006):
    me = src.data
    bm = bmesh.new()
    mw = src.matrix_world
    dg = bpy.context.evaluated_depsgraph_get()
    ev = src.evaluated_get(dg)
    em = ev.to_mesh()
    keep = {}
    for v in em.vertices:
        co = mw @ v.co
        if select(co):
            n = (mw.to_3x3() @ v.normal).normalized()
            keep[v.index] = bm.verts.new(co + n * (offset(co) if callable(offset) else offset))
    for p in em.polygons:
        if all(i in keep for i in p.vertices):
            try:
                bm.faces.new([keep[i] for i in p.vertices])
            except ValueError:
                pass
    ev.to_mesh_clear()
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    ob = bpy.data.objects.new(name, out)
    bpy.context.scene.collection.objects.link(ob)
    out.materials.append(mat)
    for p in out.polygons:
        p.use_smooth = True
    if solid:
        s = ob.modifiers.new('solid', 'SOLIDIFY')
        s.thickness = solid
        s.offset = 1
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    return ob


def build(pid, S):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = dict(gender=1.0 if S['sex'] == 'M' else 0.0, muscle=0.5, weight=0.5, age=0.78)
    macro.update(S.get('macro', {}))
    base, rig = mhlib.make_human(macro)
    apply_face(base, pid, S['sex'], S.get('face'))
    # relax the A-pose arms so the shoulders sit naturally in the bust
    bpy.context.view_layer.objects.active = rig
    for side, sx in (('Left', 1), ('Right', -1)):
        pb = rig.pose.bones[side + 'Arm']
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
    skin = SKINS[S['skin']]
    HumanService.set_character_skin(os.path.join(D, f'skins/{skin}/{skin}.mhmat'), base, skin_type='ENHANCED_SSS')
    add = lambda p, k: HumanService.add_mhclo_asset(os.path.join(D, p), base, asset_type=k, subdiv_levels=1, material_type='MAKESKIN')
    add('eyes/high-poly/high-poly.mhclo', 'Eyes')
    add('eyebrows/eyebrow005/eyebrow005.mhclo' if S['sex'] == 'M' else 'eyebrows/eyebrow001/eyebrow001.mhclo', 'Eyebrows')
    add('eyelashes/eyelashes02/eyelashes02.mhclo' if S['sex'] == 'F' else 'eyelashes/eyelashes01/eyelashes01.mhclo', 'Eyelashes')
    hair = None
    if HAIR.get(S.get('hair')):
        hn = HAIR[S['hair']]
        hair = add(f'hair/{hn}/{hn}.mhclo', 'Hair')
        hcol = tuple(c ** 0.8 for c in rgb(S['hairc']))
        tint_material(hair, hcol, 0.92)
    for o in bpy.data.objects:
        if o.type == 'MESH' and 'eyebrow' in o.name.lower():
            tint_material(o, rgb(S.get('beardc', S['hairc'])), 0.8)
    shirt_asset = 'elvs_male_shirt_untucked_bd1' if S['sex'] == 'M' else 'elvs_ruffle_sleeve_peasant_blouse_1'
    shirt = add(f'clothes/{shirt_asset}/{shirt_asset}.mhclo', 'Clothes')
    shirt.data.materials.clear()
    shirt.data.materials.append(plain('shirt', rgb(S['shirt']), 0.85, sheen=0.3))

    # landmarks from the evaluated basemesh
    # evaluate with the mask modifiers off so indices match the basemesh (for the beard vertex group)
    masks = [m for m in base.modifiers if m.type == 'MASK']
    for m in masks:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = base.evaluated_get(dg)
    em = ev.to_mesh()
    body = [base.matrix_world @ v.co for v in em.vertices]
    ev.to_mesh_clear()
    for m in masks:
        m.show_viewport = True
    assert len(body) == len(base.data.vertices)
    gi = base.vertex_groups['body'].index
    is_body = [any(g.group == gi and g.weight > 0.5 for g in v.groups) for v in base.data.vertices]
    bodyv = [c for c, ok in zip(body, is_body) if ok]
    top = max(v.z for v in bodyv)
    head = rig.matrix_world @ rig.data.bones['Head'].head_local
    neckz = (rig.matrix_world @ rig.data.bones['Neck'].head_local).z
    T = top
    face_front = min(v.y for v in bodyv if v.z > T - 0.2)
    headv = [v for v in bodyv if v.z > T - 0.12]
    hc = Vector((head.x, sum(v.y for v in headv) / len(headv), head.z))

    # coat: shell of the torso + upper arms, open at the front to show the shirt
    shz = (rig.matrix_world @ rig.data.bones['LeftArm'].head_local).z
    def coat_sel(c):
        if c.z > neckz - 0.01 or c.z < shz - 0.45:
            return False
        if abs(c.x) < 0.07 - 0.15 * max(0, shz - 0.05 - c.z) and c.y < -0.02:
            return False  # open front (V)
        return True
    gold = plain('gold', (0.75, 0.55, 0.22), 0.3, metal=1.0)
    if S.get('coat'):
        shell(shirt, coat_sel, 0.012, 'coat', plain('coat', rgb(S['coat']), 0.75, sheen=0.4), solid=0.012)
    if S.get('cravat'):
        def cv(c):
            return neckz - 0.09 < c.z < neckz + 0.005 and c.y < hc.y - 0.03 and abs(c.x) < 0.045
        shell(shirt, cv, 0.016, 'cravat', plain('cravat', (0.85, 0.83, 0.78), 0.8, sheen=0.5), solid=0.01)
    if S.get('hat') == 'bonnet':
        add('clothes/elvs_dirty_lil_maid_bonnet/elvs_dirty_lil_maid_bonnet.mhclo', 'Clothes')
    for i in range(4 if S.get('coat') and S.get('buttons', True) else 0):
        z = shz - 0.12 - i * 0.07
        for sx in (1, -1):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.008, location=(sx * (0.07 + 0.02 * i), face_front + 0.07 + 0.01 * i, z))
            bpy.context.object.data.materials.append(gold)

    # hats
    hat = S.get('hat', 'none')
    hatmat = plain('hat', rgb(S.get('hatc', '#222222')), 0.8, sheen=0.5)
    if hat in ('tricorn', 'cavalier'):
        bm = bmesh.new()
        seg = 48
        r_in, r_out = 0.098, (0.165 if hat == 'tricorn' else 0.225)
        cz = T - 0.06
        ring_in, ring_out, crown = [], [], []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            if hat == 'tricorn':
                cock = max(0.0, math.cos(3 * (a + math.pi / 2)))
                up = 0.07 * (1 - cock) ** 0.6
                ro = r_out * (0.88 + 0.12 * cock)
            else:
                # broad brim with the left side pinned up against the crown
                pin = max(0.0, math.cos(a - math.pi)) ** 3
                up = 0.13 * pin - 0.012 * (1 - pin)
                ro = r_out * (1 - 0.35 * pin)
            ring_in.append(bm.verts.new((hc.x + math.cos(a) * r_in, hc.y + math.sin(a) * r_in * 1.1, cz)))
            ring_out.append(bm.verts.new((hc.x + math.cos(a) * ro, hc.y + math.sin(a) * ro * 1.05, cz + up)))
            crown.append(bm.verts.new((hc.x + math.cos(a) * r_in * (0.92 if hat == 'tricorn' else 1.0), hc.y + math.sin(a) * r_in * 1.02, cz + (0.1 if hat == 'tricorn' else 0.085))))
        cap = bm.verts.new((hc.x, hc.y, cz + (0.115 if hat == 'tricorn' else 0.1)))
        pivot = Vector((hc.x, hc.y, cz))
        R = Matrix.Rotation(math.radians(-7), 3, 'X')
        for v in bm.verts:
            v.co = pivot + R @ (v.co - pivot)
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new((ring_in[k], ring_out[k], ring_out[k2], ring_in[k2]))
            bm.faces.new((ring_in[k2], crown[k2], crown[k], ring_in[k]))
            bm.faces.new((crown[k], crown[k2], cap))
        me = bpy.data.meshes.new('hat')
        bm.to_mesh(me)
        ob = bpy.data.objects.new('hat', me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(hatmat)
        for p in me.polygons:
            p.use_smooth = True
        s = ob.modifiers.new('s', 'SOLIDIFY'); s.thickness = 0.006
        ob.modifiers.new('sub', 'SUBSURF').levels = 1
        # gold trim on the tricorn brim
        if hat == 'tricorn':
            pass
        if hat == 'cavalier' and S.get('plume'):
            # ostrich plume curling over the brim
            # ostrich plume tucked into the band, sweeping back over the pinned-up side
            pts = [Vector((hc.x - 0.06, hc.y - 0.06, cz + 0.07)), Vector((hc.x - 0.12, hc.y - 0.02, cz + 0.12)), Vector((hc.x - 0.17, hc.y + 0.06, cz + 0.11)), Vector((hc.x - 0.19, hc.y + 0.13, cz + 0.04))]
            cu = bpy.data.curves.new('plume', 'CURVE')
            cu.dimensions = '3D'
            sp = cu.splines.new('BEZIER')
            sp.bezier_points.add(len(pts) - 1)
            for bp, p in zip(sp.bezier_points, pts):
                bp.co = p
                bp.handle_left_type = bp.handle_right_type = 'AUTO'
                bp.radius = 1.0
            cu.bevel_depth = 0.028
            cu.bevel_resolution = 2
            pl = bpy.data.objects.new('plume', cu)
            bpy.context.scene.collection.objects.link(pl)
            cu.materials.append(plain('plume', rgb(S['plume']), 0.9, sheen=1.0))
    elif hat in ('bandana',):
        def bsel(c):
            return c.z > T - 0.075 - (0.0 if c.y < hc.y else 0.04)
        shell(hair if hair else base, bsel, 0.008 if hair else 0.012, 'bandana', hatmat, solid=0.004)
        # knot and tails at the back
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.025, location=(hc.x + 0.03, hc.y + 0.1, T - 0.07))
        bpy.context.object.data.materials.append(hatmat)

    # beard via particle hair on a vertex group of the basemesh
    beard = S.get('beard', 'none')
    if beard != 'none' and S['sex'] == 'M':
        vg = base.vertex_groups.new(name='beard')
        lens = {'stubble': 0.003, 'full': 0.035, 'braided': 0.07, 'goatee': 0.025, 'moustache': 0.011, 'chin': 0.03}
        idx = []
        for i, c in enumerate(body):
            if not is_body[i] or c.y > hc.y - 0.01:
                continue
            mouth = T - 0.18
            jaw = T - 0.26 < c.z < T - 0.175 and abs(c.x) < 0.075
            tash = T - 0.176 < c.z < T - 0.163 and abs(c.x) < 0.03 and c.y < face_front + 0.035
            side = T - 0.19 < c.z < T - 0.12 and 0.055 < abs(c.x) < 0.085
            chin = T - 0.26 < c.z < T - 0.19 and abs(c.x) < 0.03
            ok = {'stubble': jaw or tash or side, 'full': jaw or tash or side, 'braided': jaw or tash or side, 'goatee': chin or tash,
                  'moustache': tash, 'chin': chin}[beard]
            if ok:
                idx.append(i)
        vg.add(idx, 1.0, 'REPLACE')
        ps = base.modifiers.new('beard', 'PARTICLE_SYSTEM').particle_system
        st = ps.settings
        st.type = 'HAIR'
        st.count = 4000 if beard != 'stubble' else 12000
        pass
        ps.vertex_group_density = 'beard'
        st.use_advanced_hair = True
        # with advanced settings the emission velocity sets length and direction: mostly down the face
        L = lens[beard]
        st.normal_factor = 0.6
        st.object_align_factor = (0, -0.15, -(1.2 if beard in ('full', 'braided', 'goatee', 'chin') else 0.4))
        st.factor_random = 0.15
        # with advanced hair the strand length follows the velocity magnitude: measure and rescale to L
        dg = bpy.context.evaluated_depsgraph_get()
        pse = base.evaluated_get(dg).particle_systems[-1]
        ls = [(p.hair_keys[-1].co - p.hair_keys[0].co).length for p in list(pse.particles)[:40] if len(p.hair_keys) > 1]
        if ls:
            k = L / (sum(ls) / len(ls))
            st.normal_factor *= k
            st.object_align_factor = tuple(x * k for x in st.object_align_factor)
            st.factor_random *= k
        st.child_type = 'INTERPOLATED'
        st.child_percent = st.rendered_child_count = 6 if beard != 'stubble' else 2
        st.clump_factor = 0.5 if beard == 'braided' else 0.15
        st.roughness_2 = 0.02
        st.roughness_endpoint = 0.01
        st.root_radius = 0.6 if beard == 'stubble' else 1.0
        st.radius_scale = 0.0012
        hm = bpy.data.materials.new('beard')
        hm.use_nodes = True
        nt = hm.node_tree
        for n in list(nt.nodes):
            if n.type == 'BSDF_PRINCIPLED':
                nt.nodes.remove(n)
        hb = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
        hb.parametrization = 'MELANIN'
        hx = S['beardc'].lstrip('#')
        sr, sg, sb = [int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        L = 0.3 * sr + 0.59 * sg + 0.11 * sb
        hb.inputs['Melanin'].default_value = max(0.0, min(1.0, 1.0 - L ** 1.3))
        hb.inputs['Melanin Redness'].default_value = max(0.0, min(1.0, (sr - sb) / max(0.05, sr) * 0.7))
        hb.inputs['Roughness'].default_value = 0.4
        nt.links.new(hb.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
        base.data.materials.append(hm)
        bpy.context.view_layer.objects.active = base
        st.material = len(base.material_slots)
        print('[dbg] beard verts', len(idx), 'hair_length', st.hair_length, 'scale', tuple(base.scale))

    if S.get('eyepatch'):
        def esel(c):
            ex = 0.032
            return (c - Vector((ex, face_front + 0.03, T - 0.11))).length < 0.026
        shell(base, esel, 0.006, 'patch', plain('patch', (0.02, 0.02, 0.02), 0.6), solid=0.003)
        def ssel(c):
            return abs(c.z - (T - 0.095 + 0.12 * c.x)) < 0.006 and c.y < hc.y + 0.1
        shell(base, ssel, 0.004, 'strap', plain('strap', (0.03, 0.03, 0.03), 0.6), solid=0.002)
    if S.get('earring'):
        ear = max((c for c in bodyv if T - 0.2 < c.z < T - 0.15 and abs(c.y - hc.y) < 0.05), key=lambda c: c.x)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.009, minor_radius=0.0018, location=(ear.x - 0.002, ear.y, ear.z - 0.022), rotation=(0, math.radians(90), 0))
        bpy.context.object.data.materials.append(gold)
    if S.get('scar'):
        def scsel(c):
            # a short slash across the left cheek
            p0 = Vector((-0.045, 0, T - 0.12)); p1 = Vector((-0.02, 0, T - 0.17))
            d = Vector((c.x, 0, c.z))
            t = max(0, min(1, (d - p0).dot(p1 - p0) / (p1 - p0).length_squared))
            return c.y < hc.y - 0.04 and (d - (p0 + (p1 - p0) * t)).length < 0.0028
        shell(base, scsel, 0.0006, 'scar', plain('scar', (0.35, 0.12, 0.1), 0.5), solid=0)

    if os.environ.get('DBG'):
        for o in bpy.data.objects:
            if o.type in ('MESH', 'CURVE'):
                mats = [(sl.material.name, tuple(round(x, 3) for x in sl.material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3]) if sl.material and 'Principled BSDF' in sl.material.node_tree.nodes else None) for sl in o.material_slots if sl.material]
                print('[dbg] obj', o.name, len(o.data.vertices) if o.type == 'MESH' else '', o.hide_render, mats[:3])
        for ps in base.particle_systems:
            print('[dbg] ps material', ps.settings.material, base.material_slots[ps.settings.material - 1].name)
        if hair:
            m = hair.material_slots[0].material
            print('[dbg] hair links', [(l.from_node.name, l.to_node.name, l.to_socket.name) for l in m.node_tree.links])
    # ------------------------------------------------------------------ lighting & camera
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24 if os.environ.get('FAST') else 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = W * SS, H * SS
    sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'AgX'
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.05
    # backdrop
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 2.5, T - 0.2), rotation=(math.radians(90), 0, 0))
    bd = bpy.context.object
    bgm = bpy.data.materials.new('bg')
    bgm.use_nodes = True
    nt = bgm.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    em = nt.nodes.new('ShaderNodeEmission')
    gr = nt.nodes.new('ShaderNodeTexGradient'); gr.gradient_type = 'SPHERICAL'
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.45, 0.45, 0.45); mp.inputs['Location'].default_value = (0.32, -0.1, 0)
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    c = rgb(S.get('bg', '#2a2a2a'))
    ramp.color_ramp.elements[0].color = (c[0] * 0.25, c[1] * 0.25, c[2] * 0.25, 1)
    ramp.color_ramp.elements[1].color = (c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
    nt.links.new(gr.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    bd.data.materials.append(bgm)
    bd.visible_shadow = False
    def area(name, loc, energy, size, color, target):
        L = bpy.data.lights.new(name, 'AREA')
        L.energy = energy; L.size = size; L.color = color
        ob = bpy.data.objects.new(name, L)
        sc.collection.objects.link(ob)
        ob.location = loc
        d = (target - Vector(loc)).normalized()
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    face = Vector((hc.x, face_front + 0.05, T - 0.13))
    area('key', (-0.9, -0.9, T + 0.5), 38, 0.7, (1.0, 0.86, 0.7), face)
    area('fill', (0.9, -1.0, T - 0.1), 5, 1.2, (0.75, 0.8, 1.0), face)
    area('rim', (0.6, 0.8, T + 0.2), 22, 0.5, (1.0, 0.9, 0.75), face)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 85
    look = Vector((hc.x, hc.y, T - 0.2))
    look = Vector((hc.x, hc.y, T - 0.16))
    cam.location = look + Vector((-0.36, -1.12, 0.05))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    raw = f'/tmp/_portrait_{pid}.png'
    sc.render.filepath = raw
    bpy.ops.render.render(write_still=True)
    return raw


# ------------------------------------------------------------------ oil paint post-process
def kuwahara(img, r):
    """classic 4-quadrant Kuwahara on an HxWx3 float image"""
    Hh, Ww, _ = img.shape
    lum = img.mean(axis=2)
    pad = np.pad(img, ((r, r), (r, r), (0, 0)), mode='edge')
    padl = np.pad(lum, r, mode='edge')
    S1 = np.cumsum(np.cumsum(np.pad(pad, ((1, 0), (1, 0), (0, 0))), 0), 1)
    S2 = np.cumsum(np.cumsum(np.pad(padl ** 2, ((1, 0), (1, 0))), 0), 1)
    Sl = np.cumsum(np.cumsum(np.pad(padl, ((1, 0), (1, 0))), 0), 1)
    def box(S, y0, x0, y1, x1):
        return S[y1:y1 + Hh, x1:x1 + Ww] - S[y0:y0 + Hh, x1:x1 + Ww] - S[y1:y1 + Hh, x0:x0 + Ww] + S[y0:y0 + Hh, x0:x0 + Ww]
    n = (r + 1) ** 2
    best_v = None
    out = np.zeros_like(img)
    for (dy, dx) in ((0, 0), (0, r), (r, 0), (r, r)):
        y0, x0, y1, x1 = dy, dx, dy + r + 1, dx + r + 1
        m = box(S1, y0, x0, y1, x1) / n
        ml = box(Sl, y0, x0, y1, x1) / n
        v = box(S2, y0, x0, y1, x1) / n - ml ** 2
        if best_v is None:
            best_v, out = v, m
        else:
            sel = v < best_v
            best_v = np.where(sel, v, best_v)
            out = np.where(sel[..., None], m, out)
    return out


def paint(raw, out):
    im = bpy.data.images.load(raw)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(im)
    orig = a.copy()
    a = kuwahara(a, 5)
    a = kuwahara(a, 3)
    # keep some of the rendered detail (eyes, lips) under the brushwork
    a = a * 0.78 + orig * 0.22
    # downsample 2x (box) so the strokes read as brushwork rather than blocks
    a = a.reshape(h // SS, SS, w // SS, SS, 3).mean(axis=(1, 3))
    h, w = h // SS, w // SS
    # varnish: warm, slightly desaturated, lifted shadows
    lum = a.mean(axis=2, keepdims=True)
    a = lum + (a - lum) * 0.82
    a = a * np.array([1.04, 0.98, 0.86]) + np.array([0.02, 0.012, 0.0])
    # vignette
    yy, xx = np.mgrid[0:h, 0:w]
    d = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h * 0.55) / (h / 2)) ** 2
    a *= (1 - 0.35 * np.clip(d - 0.35, 0, 1))[..., None]
    # canvas weave
    rng = np.random.default_rng(1)
    weave = 0.03 * np.sin(xx * 1.9) * np.sin(yy * 1.9) + 0.02 * rng.standard_normal((h, w))
    a *= (1 + weave)[..., None]
    a = np.clip(a, 0, 1)
    o = bpy.data.images.new('p', w, h)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = a
    o.pixels = px.ravel()
    o.filepath_raw = out
    o.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    o.save()


gen_pool()
os.makedirs(OUTDIR, exist_ok=True)
ids = ONLY or list(P.keys())
if ONLY == ['kings']:
    ids = [k for k in P if not k[:2] in ('pm', 'pf', 'cm', 'cf', 'wm', 'wf') and not k.startswith('s') or k in ('bonny', 'bart', 'blackbeard', 'mary', 'calico', 'low', 'deberry', 'lolonnais', 'morgan', 'degraff', 'bonnet', 'read', 'vanhoorn', 'brasiliano', 'delahaye', 'kidd', 'barnaby')]
if ONLY == ['pool']:
    ids = [k for k in P if k[:2] in ('pm', 'pf', 'cm', 'cf', 'wm', 'wf') or (k[0] == 's' and k[1:4] in ('eng', 'fra', 'spa'))]
skip = os.environ.get('SKIP_EXISTING')
for pid in ids:
    if skip and os.path.exists(os.path.join(OUTDIR, pid + '.jpg')):
        continue
    raw = build(pid, P[pid])
    paint(raw, os.path.join(OUTDIR, pid + '.jpg'))
    print('[portrait]', pid, flush=True)
