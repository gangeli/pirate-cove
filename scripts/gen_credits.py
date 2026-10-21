"""Build src/credits.json from the Poly Haven assets actually shipped (models + textures)."""
import json, os, re, urllib.request
ROOT = os.path.join(os.path.dirname(__file__), '..')
MODEL_SRC = {  # shipped glb -> poly haven id
  'cannon': 'cannon_01', 'chest': 'treasure_chest', 'barrel': 'Barrel_01', 'crate': 'wooden_crate_01', 'barrels': 'wooden_barrels_01',
  'lantern': 'Lantern_01', 'firepit': 'stone_fire_pit', 'bucket': 'wooden_bucket_01', 'basket': 'wicker_basket_01', 'table': 'wooden_picnic_table',
  'stool': 'wooden_stool_01', 'roundtable': 'round_wooden_table_01', 'pier': 'modular_wooden_pier', 'fort_kit': 'modular_fort_01',
  'bananas': 'bananas', 'winebarrel': 'wine_barrel_01',
}
TEX_SRC = {}
for line in open(os.path.join(ROOT, 'scripts', 'prep_textures.sh')):
    m = re.match(r'prep (\w+) (\w+)', line.strip())
    if m: TEX_SRC[m.group(1)] = m.group(2)
def info(aid):
    req = urllib.request.Request(f'https://api.polyhaven.com/info/{aid}', headers={'User-Agent': 'pirate-cove-credits'})
    return json.load(urllib.request.urlopen(req, timeout=60))
items = []
shipped_models = {f[:-4] for f in os.listdir(os.path.join(ROOT, 'public/assets/models')) if f.endswith('.glb')}
for name, aid in list(MODEL_SRC.items()) + list(TEX_SRC.items()):
    if name in MODEL_SRC and name not in shipped_models: continue
    try:
        d = info(aid)
        items.append({'asset': d.get('name', aid), 'kind': 'model' if name in MODEL_SRC else 'texture', 'authors': list(d.get('authors', {}).keys()),
                      'source': 'Poly Haven', 'url': f'https://polyhaven.com/a/{aid}', 'license': 'CC0 1.0'})
    except Exception as e:
        print('fail', aid, e)
items.sort(key=lambda x: (x['kind'], x['asset']))
json.dump({'thirdParty': items}, open(os.path.join(ROOT, 'src', 'credits.json'), 'w'), indent=1)
print(len(items), 'credits')
