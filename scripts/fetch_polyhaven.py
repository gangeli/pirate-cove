"""Fetch CC0 assets from Poly Haven into ../assets-src/polyhaven (source art, not shipped directly)."""
import json, os, sys, urllib.request, concurrent.futures as cf
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'polyhaven')
MODELS = ['dutch_ship_large_01','dutch_ship_large_02','dutch_ship_medium','ship_pinnace','treasure_chest','cannon_01',
  'modular_fort_01','modular_wooden_pier','island_tree_01','island_tree_02','island_tree_03','stone_fire_pit',
  'wooden_barrels_01','Barrel_01','barrel_03','wooden_crate_01','wooden_crate_02','wine_barrel_01','Lantern_01',
  'wooden_lantern_01','wooden_bucket_01','wicker_basket_01','bananas','shrub_01','shrub_02','shrub_03','shrub_04',
  'fern_02','boulder_01','coast_rocks_01','coast_rocks_02','rock_07','rock_09','tree_stump_01','wooden_picnic_table',
  'wooden_stool_01','round_wooden_table_01','lambis_shell','spinning_wheel_01','wooden_axe','ocean_buoy',
  'grass_medium_01','grass_medium_02','weed_plant_02','dead_tree_trunk','root_cluster_01','sand_rocks_small_01',
  'wooden_ladder','folding_wooden_stool','jug_01','seadogs_compass','lifebuoy','anthurium_botany_01','pachira_aquatica_01']
TEXTURES = ['coast_sand_01','coast_sand_02','aerial_sand','damp_beach_sand','leafy_grass','grass_ground','aerial_grass_rock',
  'forrest_ground_01','brown_mud_leaves_01','rock_boulder_dry','aerial_rocks_02','reed_roof_03','reed_roof_04','palm_bark',
  'brown_planks_05','brown_planks_09','old_planks_02','weathered_planks','raw_plank_wall','plastered_stone_wall','plaster_stone_wall_01',
  'clay_roof_tiles_02','coral_stone_wall','large_sandstone_blocks','mossy_cobblestone','dirt','raked_dirt','red_mud_stones',
  'clay_plaster','beige_wall_001','coral_fort_wall_01','coral_fort_wall_02','blue_plaster_weathered','castle_brick_02_white','bamboo_wall','bamboo_wall_02','fabric_pattern_05','denim_fabric','rough_wood','wood_planks','dark_wooden_planks','bark_brown_02','castle_brick_01','gravelly_sand','rocky_trail']
def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0: return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'pirate-cove-fetch'})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f: f.write(r.read())
def files(aid):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{aid}', headers={'User-Agent': 'pirate-cove-fetch'})
    return json.load(urllib.request.urlopen(req, timeout=60))
jobs = []
res = sys.argv[1] if len(sys.argv) > 1 else '2k'
for m in MODELS:
    try:
        f = files(m)['gltf']
        r = f.get(res) or f.get('1k')
        g = r['gltf']
        jobs.append((g['url'], f'{OUT}/models/{m}/{m}.gltf'))
        for rel, inc in g.get('include', {}).items(): jobs.append((inc['url'], f'{OUT}/models/{m}/{rel}'))
    except Exception as e: print('model fail', m, e)
for t in TEXTURES:
    try:
        f = files(t)
        for mapn in ['Diffuse', 'nor_gl', 'Rough', 'Displacement', 'arm', 'AO']:
            if mapn in f:
                e = f[mapn].get(res) or f[mapn].get('1k')
                e = e.get('jpg') or e.get('png')
                jobs.append((e['url'], f'{OUT}/textures/{t}/{t}_{mapn}.jpg'))
    except Exception as e: print('tex fail', t, e)
with cf.ThreadPoolExecutor(12) as ex:
    list(ex.map(lambda j: (get(*j)), jobs))
print('fetched', len(jobs))
