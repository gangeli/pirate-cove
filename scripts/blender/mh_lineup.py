# Render a lineup of outfit candidates side by side (front and 3/4 views).
# blender -b -P mh_lineup.py -- out.png
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import mhlib
from mhlib import HumanService

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
D = '/root/.config/blender/4.2/extensions/.user/user_default/mpfb/data'
bpy.ops.wm.read_factory_settings(use_empty=True)

C = 'clothes/{0}/{0}.mhclo'
LINEUP = [
    ({'gender': 1, 'muscle': 0.6}, 'middleage_caucasian_male', 'male1591', ['hair/ponytail01/ponytail01.mhclo'], ['elvs_male_shirt_untucked_bd1', 'elvs_male_trouser_short_2', 'maciekg_leather_boots']),
    ({'gender': 1, 'muscle': 0.7, 'weight': 0.6}, 'middleage_african_male', 'male1591', ['hair/short02/short02.mhclo'], ['drednicolson_asymmetric_tunic_and_sash', 'toigo_harem_pants', 'punkduck_riding_boots']),
    ({'gender': 1, 'muscle': 0.4, 'weight': 0.4}, 'old_caucasian_male', 'male1591', ['hair/elvs_grump_hair/elvs_grump_hair.mhclo'], ['elvs_crude_t-shirt_male', 'rehmanpolanski_viking_pants']),
    ({'gender': 1, 'muscle': 0.5}, 'middleage_asian_male', 'male1591', ['hair/short04/short04.mhclo'], ['rehmanpolanski_viking_tunic', 'elvs_gored_elephant_pants']),
    ({'gender': 0, 'muscle': 0.5}, 'middleage_caucasian_female', 'female1605', ['hair/rehmanpolanski_hair_bun_brown/rehmanpolanski_hair_bun_brown.mhclo'], ['punkduck_medieval_dress', 'elvs_ladies_apron', 'elvs_dirty_lil_maid_bonnet']),
    ({'gender': 0, 'muscle': 0.5}, 'middleage_african_female', 'female1605', ['hair/braid01/braid01.mhclo'], ['elvs_ruffle_sleeve_peasant_blouse_1', 'toigo_long_full_skirt']),
    ({'gender': 0, 'muscle': 0.6}, 'toigo_light_skin_female_freckles', 'female1605', ['hair/long01/long01.mhclo'], ['toigo_bodice-style_top', 'elvs_male_trouser_short_1', 'grinsegold_female_pirate_boots']),
]
for i, (macro, skin, proxyname, hair, clothes) in enumerate(LINEUP):
    base, rig = mhlib.make_human(macro)
    def add(path, kind='Clothes'):
        p = os.path.join(D, path)
        if not os.path.exists(p):
            print('MISSING', p)
            return None
        return HumanService.add_mhclo_asset(p, base, asset_type=kind, subdiv_levels=0, material_type='MAKESKIN')
    proxy = add(f'proxymeshes/{proxyname}/{proxyname}.proxy', 'Proxymeshes')
    m = base.modifiers.new('Hide base mesh', 'MASK'); m.vertex_group = 'body'; m.invert_vertex_group = True
    sk = os.path.join(D, f'skins/{skin}/{skin}.mhmat')
    if os.path.exists(sk):
        HumanService.set_character_skin(sk, base, bodyproxy=proxy, skin_type='MAKESKIN')
    else:
        print('MISSING skin', sk)
    add('eyes/low-poly/low-poly.mhclo', 'Eyes')
    add('eyebrows/eyebrow001/eyebrow001.mhclo', 'Eyebrows')
    for h in hair:
        add(h, 'Hair')
    for c in clothes:
        add(C.format(c))
    rig.location.x = i * 0.9

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 12
sc.cycles.use_denoising = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.65, 0.7, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 3.5; sun.rotation_euler = (0.7, 0.1, 0.6)
n = len(LINEUP)
sc.render.resolution_x, sc.render.resolution_y = 170 * n, 420
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 0.9 * n
cx = (n - 1) * 0.45
cam.location = (cx, -8, 0.9)
cam.rotation_euler = (math.radians(90), 0, 0)
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
# isometric-ish view
cam.location = (cx + 5, -5, 5.5)
cam.rotation_euler = (math.radians(55), 0, math.radians(45))
cam.data.ortho_scale = 0.9 * n * 0.8
sc.render.filepath = OUT.replace('.png', '_iso.png')
bpy.ops.render.render(write_still=True)
