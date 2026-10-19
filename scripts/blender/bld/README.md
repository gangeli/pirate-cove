# Building models

Every building in Buccaneer Cove is modelled procedurally in Blender (4.2, at
`/home/user/blender-4.2.3-linux-x64/blender`) by Python in this folder. The game loads the GLBs from
`public/assets/buildings/` and falls back to the old procedural three.js prefab
(`src/render/prefabs.ts`) when a model is missing.

## The bar

Publishable, professional, *realistic* Caribbean pirate colony, c. 1700. Not toy-like, not
cartoon. Think a well-art-directed city builder seen up close: honest materials and construction
(how would a carpenter or mason really have built it from salvage, palm, coral rag, ship's timbers),
weathering, lived-in clutter, a strong silhouette that reads at gameplay distance, and a clear
"what is this building" from its props (a tavern has a hanging sign, casks, benches, a lantern; a
blacksmith has a forge with glowing coals, bellows, anvil on a stump, quench tub, tongs on a rack).
More polygons are welcome where they add realism (bevelled timbers, individual boards, stones,
tiles, thatch). Pirate theming should be present but believable (black flag, skulls only where they
make sense, ship salvage reused as building material: hatch covers, gratings, a figurehead, oars,
sail canvas, ships' lanterns, cannon as bollards).

## Scale and conventions

* Units are **tiles**; 1 tile ~ 2 m. A person is ~0.85 tall. Doors 0.75-0.9 high and 0.4-0.45 wide,
  a storey ~0.9-1.0, windows ~0.3 x 0.34 with sills ~0.4 off the floor.
* The footprint (from `src/sim/data/buildings.ts`, `size: [W, D]`) is centred on the origin; build
  **inside** it, front (the door/road side) faces **+z**, ground at y = 0. Leave ~0.15 margin.
* Coordinates are game coordinates (y up). `Kit` converts to Blender.

## Files

* `kit.py` - `Kit`: bevelled boxes/cylinders/beams/meshes with box-mapped UVs, frames (`push/pop/face`),
  markers, and `finish()` which merges by material, bakes the weathering map (AO x ground grime x
  streaks x mottling) to `<name>_ao.jpg`, and exports a Draco GLB.
* `arch.py` - the architecture library: `plinth`, `stilts`, `deck`, `steps`, `door`, `window`, `hatch`,
  `Op` openings, walls (`solid_walls`, `plastered`, `framed`, `clapboard`, `board_batten`, `logs`),
  roofs (`thatch_gable`, `tile_gable`, `shingle_lean`, `thatch_cone`, `gables`), `front_porch`,
  `chimney`, dressing (`cask`, `crate`, `sack`, `rope_coil`, `lantern`, `hanging_sign`, `fence`).
  Read it before starting; reuse it rather than re-inventing.
* `defs.py` - houses and the starting camp (good examples). `defs_<group>.py` - one module per group of
  buildings; they are auto-imported. **Only edit your own `defs_<group>.py`.** If you need a new
  reusable helper, put it in your own module (don't edit `kit.py`, `arch.py` or `defs.py`; other people
  are working in them at the same time).
* `build.py` - `blender -b -P scripts/blender/bld/build.py -- name [name...]` (`FAST=1` for quick bakes).
  It also builds the far LOD (`Kit(lod=True)`): every arch helper simplifies itself when `k.lod`; in
  your own code, skip tiny details when `k.lod` is true (the LOD should be ~1.5-5k tris).
* `preview.sh <name> <gallery item> <out.png> [dist] [pitch]` - fast build plus a 3-view contact sheet
  (two close three-quarter views from opposite sides, one gameplay-distance view) on a neutral lot.
  The gallery item is `def` or `def:level`. Look at every sheet you make.

## Registering

```python
from defs import building
from arch import *

@building('tavern')          # the building def id; leveled ones use 'def@level'
def tavern(k):
    ...
    return {'ao': 1024}      # bake size (512 for small decor)
```

## Materials

Material names map to the game's shared textured materials (`src/render/kit.ts`): `thatch`,
`thatchDark`, `planks`, `planksDark`, `oldplanks`, `plaster`, `plasterPink`, `plasterYellow`,
`plasterBlue`, `coral`, `bamboo`, `weave`, `stone`, `stoneDark`, `tiles` (a photo of a tiled roof, for
flat LOD slabs only), `terracotta` (clay, for individual tiles/pots), `bark`, `dirt`, `wood`,
`darkwood`, `iron`, `gold`, `brass`, `canvas`, `canvasRed`/`Blue`/`Green`/`Purple` (striped awnings),
`black`, `window` (glazing; glows at night), `bone`, `rope`, `leaf`, `soil`, `red`, `water`, `sand`,
`fire` (static embers), `flagBlack`.
Stones look best with `uvscale=2.0`; planks/boards with `uvscale=1.2-1.5` and `grain=1` for vertical
boards; long walls with `wuv=True` so the texture runs continuously across segments.

## Hooks (markers)

`k.marker(name, x, y, z)` exports an empty the game turns into behaviour:
* `smoke` - chimney/fire smoke while the building works (any number).
* `sign:TEXT` - a painted board (use with `hanging_sign`, which places it).
* `flag` - a black flag flying from that point (top of a pole you model).
* `glow:WxHxD` - a flickering ember/furnace box of that size (forges, furnaces, ovens, braziers).
* `hull` - where a ship under construction sits (boatyard/shipyard). `deck` - the dock's deck height.
Check the old prefab in `src/render/prefabs.ts` for the hooks a building had and keep them.

## Budget

Full model up to ~60k tris (big landmark buildings up to ~100k); LOD 1.5-5k. Bake size 1024 for most,
512 for small props/decor.

## Process

For each building: read its old prefab and its role in the sim (`src/sim/data/buildings.ts` desc), design
it, write it, `preview.sh`, look hard at the sheet, fix what looks wrong (floating parts, things
poking through roofs, z-fighting, wrong scale, too clean, unreadable from far), and repeat until it
genuinely looks professional - at least 3 rounds. Check the LOD too with gallery `&lod=far`.
