# Player feedback checklist

Every request from the playtesting sessions, with where it stands. `[x]` done and deployed, `[~]` in progress
(owner in brackets), `[ ]` not started. Agents: tick items off as they land; add new feedback at the bottom of its
section.

## Rendering, performance, heat
- [x] Island invisible on real GPUs (terrain over 16 textures after the three.js upgrade): roads and overlay packed into one texture; failed shader links are logged
- [x] Sluggish input: height-field picking (5 ms to 0.01 ms per pointer move)
- [x] Adaptive resolution on High; graduated relief (shadows 30 Hz, half-res AO, half-res bloom) when the GPU still can't keep up
- [x] Frame-rate choice Smooth / Cool (30 fps), Cool by default on battery (laptop running hot)
- [x] Shader hitches on phones (Firefox): building, ghost and thumbnail shaders compiled under the loading card
- [x] Pause freezes all animation and stops redrawing a still picture
- [x] Phones default to Low, tablets to Medium
- [ ] Ask: sharper Low on phones (render up to 1.5 px per point)? (awaiting the player's answer)
- [ ] Optional quality-for-speed trades on the MacBook, only if the player agrees: depth-normal AO (drops a scene pass), character LODs
- [~] WebGPU: opt-in only until the palace-goes-dark bug on High is fixed

## Sound
- [x] Sound starts muted; the speaker button turns it on (remembered)
- [x] Music slow to start (moot while muted by default; streams on unmute)

## Map, terrain, water
- [x] Roads easier to see (packed earth)
- [x] Trees fade while the road tool is out (now 15%; the player said "not opaque enough", taken as "fade more": confirm)
- [x] Calm inland lakes: no swell, whitecaps or surf (seen on seed 9, deployed 8f01981)
- [~] Everything overlapping with everything (buildings vs footprints and each other, trees through buildings, props, terrain, UI) [overlap agent]
  Detectors: `npx tsx scripts/overlap/footprints.mts` (models vs footprint), `crops.mts`, `hooks.mts` (flags/smoke), `node scripts/overlap/world.mjs` (in-world: models, neighbours, trees, terrain), `shot.mjs` (close-ups)
  - [x] Trees through buildings and trunks in roads: trees lean away, move, shrink or are left out (seed 7: 79 crowns + 18 trunks -> 0)
  - [x] Terrain: a new building re-levelled its neighbour's shared edge (walls buried/floating up to 1.5); now it takes the neighbour's level (45 -> 10 footprints)
  - [x] Dock approach buried in the beach: ground under/in front of a new dock graded to the deck
  - [x] Farm crops vs. the field shelter, water butt and scarecrow, and banana/papaya leaves over the field walls
  - [x] Farm walls 0.08 past every edge (two farms side by side doubled up): inset
  - [~] Models past their footprint (31 -> rebuilding): chuck tent guy ropes 0.34 (done), construction tent, bunkhouse, house 6/9 steps, eatery, inn, gambling den, iron mine, graveyard, smugglers' cove, courtesan, anarchy shrubs, school sign, fort lantern, slipways 1.4-2 tiles past the yard
  - [x] Flags flying through their roofs or off small lots; smoke rising through tent flies and roofs (runtime fix in bldmodels.ts)
  - [x] "Update ready" toast over the undo seal / toolbar / minimap: placed clear of them (ui_shots state toast_undo, 7 devices clean)
  - [ ] Dock T-head reaches 0.25-0.4 past its footprint to seaward (ship berths: ship agent)

## People
- [~] Walking out of time with the animation (feet sliding) [people agent]
- [~] Workers bunching, standing on roofs, inside tents and crops [people agent]
- [~] Selecting a building highlights its workers, haulers, overseer, guards, customers and residents in colours [people agent]
- [x] People waiting on a path stand idle (not walking on the spot)
- [x] Follow doesn't centre the camera on the person [UI agent]

## Ships
- [x] Water showing inside the hull (plank floor at the waterline)
- [x] Ships sailing backwards (bow found per model); jerky movement (eased between sim steps, smooth turns)
- [x] Restyle ships to match the buildings: six classes rebuilt in the Blender kit (scripts/blender/bld/ships.py), kit materials + baked AO, far LOD [ship agent]
- [x] Rig and animate: sails billow/flutter in a vertex shader (WebGL + TSL), furl at the dock and set at sea, flags and pennants wave down the wind, heel into turns, pitch underway, bow wave + wake decal [ship agent]
- [x] Docked ship clips into the beach and palms: render-side berth fitting (hull outline kept in water and clear of the pier); ships underway lean off any shore their hull would cross [ship agent]
- [x] Rename ships [UI agent: done in 7a9d2aa, deployed]

## Controls and building
- [x] Delete (Delete key, Demolish for buildings and roads, road quick action) and undo (button, Ctrl/Cmd+Z)
- [x] Rotate while placing on desktop (R/E, Shift+R/Q, Shift+wheel; the tag says so)
- [x] Placing a farm or mine tints the matching overlay (soil for its crop, iron)
- [x] Placement controls around the object on touch (rotate, ✓, ✕), not a bottom bar
- [x] Easy game-speed control (tap the clock to pause, big 1x to 8x)
- [x] Fewer, clearer bottom-bar entries (Build, Views, Island, Menu) plus a floating Undo

## Panels and visual language (apply to ALL pages, not just the examples)
- [x] Less text, more visual hierarchy everywhere; explanations into tooltips [UI agent] (ship, building, person, chart, letters; edicts as icon cards with effect chips, an (i) toggle for descriptions and buttons by purpose; log Overview with score bars, a reign bar and icon deeds; Finances as bars; Powers as flag cards; settings and new-game setup with glyph choices and (i) tips. On touch, tapping an icon, figure or (i) shows its tip)
- [x] Ship panel: Set sail always in the panel (done in 7a9d2aa), quieter orders, spoils bar, rename [UI agent]
- [x] "Treat crew" was unclear: now "Bonus −500" with a tooltip; restyle as a transactional button [UI agent]
- [x] Remove "Hide details" (× folds the inspector) [UI agent: done in 7a9d2aa]
- [x] Sea chart side sheet: too much text; remove the Set sail and Ship details buttons and the orders block; sea, danger, plunder and sail time as icons; nations as a flag row [UI agent]
- [~] Map views and overlays easy to navigate on desktop and phone (Soil with a crop picker, chips, prev/next) [done; polish ongoing]
- [x] Bolder × close buttons on menus and overlays [UI agent]
- [x] Filled worker slots show the person's portrait, empty ones a placeholder [UI agent]
- [x] Shift-click (hold on touch) a slot to close it and the slots to its right; remove the Open-places stepper [UI agent]
- [x] Closing places is exact per row: on buildings with several worker rows (dive, eatery, inn) a shift-click no longer closes a place in an earlier row; fired workers keep their own place closed [UI agent]
- [x] Themed, direct-manipulation controls instead of generic segmented controls: wages as coins, priority as pennants, spoils as a treasure split, prices as coin stacks, missions and tactics as icon cards [UI agent]
- [x] Remove pointless explanatory lines ("Gold a month for each overseer…", "Higher-priority buildings are staffed first…") [UI agent]
- [x] Inventory and production as goods icons with tooltips (e.g. "2× Logs → Lumber 92") [UI agent]
- [x] Soil isn't a bar: a toggle for the soil overlay with its number; progress belongs with production [UI agent]
- [x] Influence as small subdued icons ("Defense +35 · 2 tiles") [UI agent]
- [x] Buttons styled to their purpose: navigation, primary, transactional, social or moral, destructive (Kill, Scuttle and Demolish unmistakably dangerous); toggles look like toggles [UI agent]
- [x] Letters and reports (e.g. "Night Heron Returns"): icon results (a coin pile for gold, one figure per recruit, skilled profession badges, losses), apply to every message type and the log [UI agent] (every sim letter carries display-only facts: invasions and their outcome, raids on the island, ships launched, sailed, lost, edicts and their costs and effects, ransoms, escapes, rebellions, Powers, game over with the score as bars; drawn in letters, toasts and the Letters tab. The sim has no trade or monthly-report letters)

## Mobile
- [x] Address bar covering the bottom buttons (sizes follow the visible viewport)
- [x] Portrait alignment (top bar vs clock, sheets off-screen, sound button over the toolbar)
- [x] Sea chart works on phones (pinch/zoom, fits); home marked; ship reach shown
- [x] Overlays on phones

## Platform
- [x] Installable PWA, offline download, update toast
- [x] Bundle size reduced losslessly (188 → 162 MB offline; first visit −20 MB; ships load on demand)
- [x] Pathfinding in a Web Worker
- [x] In-game performance recorder (Settings › Record performance)
