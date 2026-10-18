# Tropico 2: Pirate Cove — Mechanics Research (Design Bible)

Research compiled 2026-10-18 for a faithful mechanics remake (original art and names). Everything below is about the original game: Tropico 2: Pirate Cove (Frog City Software, published by Gathering/PopTop, Windows, April 2003).

## Source key

Each fact is tagged with where it came from:

| Tag | Source | URL |
|---|---|---|
| **[MAN]** | Official manual, "Tropico 2 Pirate's Book o' Lore" (84 pp., EN, Steam-hosted PDF). This is the primary source. Page numbers are given as `p.N`. | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/33520/manuals/Tropico%202%20Manual%20(EN).pdf |
| **[WIKI]** | Tropico Fandom wiki: building infoboxes, aura tables, edicts, captains, traits. Read through the MediaWiki API because the HTML is behind Cloudflare. | https://tropico.fandom.com/wiki/Tropico_2 (and subpages named below) |
| **[WIKI-M]** | Fandom wiki, campaign walkthrough page "Missions (Tropico 2)" | https://tropico.fandom.com/wiki/Missions_(Tropico_2) |
| **[STEAM1]** | Steam forum thread with a new-player build-order guide | https://steamcommunity.com/app/33530/discussions/0/358415738194002959 |
| **[STEAM2]** | Steam forum thread with player mechanics notes | https://steamcommunity.com/app/33530/discussions/0/3563973712295367190 |
| **[WP]** | Worthplaying review, 2003 (UI and sound details) | https://worthplaying.com/article/2003/8/20/reviews/11890-pc-review-tropico-2-pirate-cove/ |
| **[MW]** | Macworld review (sandbox options, 18 sea territories, Smitty voice) | https://www.macworld.com/article/176154/tropico2-2.html |
| **[GPG]** | Gold Plated Games retrospective review | https://goldplatedgames.com/2017/08/08/review-tropico-2-pirate-cove/ |
| **[WPED]** | Wikipedia | https://en.wikipedia.org/wiki/Tropico_2:_Pirate_Cove |
| **[GOL]** | GamersOnLinux guide (settings menu list) | https://www.gamersonlinux.com/forum/threads/tropico-2-pirate-cove-guide.2163/ |

**Sources I could not reach.** GameFAQs (fawkes66's walkthrough), StrategyWiki, GameSpot (review, Q&A, preview), MobyGames and the Wayback Machine all returned 403 or reset the connection. The Next Level "Blue Parrot Inn" game guide (http://www.the-nextlevel.com/tropico/trop2/gameguide/) returned 503. These are worth retrying from a normal browser. They may hold the few numbers this report marks as unknown, such as plunder-share percentages, production times and price-level multipliers.

**Conventions.** **(EST)** marks my own design estimate for a number that is unknown. **(CONFLICT)** marks places where sources disagree. Aura values are written `(strength:range)`, the same notation the wiki uses. Section 9 explains it.

---

## 1. Core loop

### 1.1 The "reverse economy" [MAN p.7]
- The island does **not** make money by producing goods. Gold comes from **stealing** it (cruises) and captives come from **kidnapping** them (raids).
- Island industry exists to make the **tools** that support theft: sea rations, cutlasses, muskets, cannons. It also makes **luxuries** that pirates consume when they spend their share of the plunder: beer, rum, pastries, cigars.
- The money loop:
  1. A ship sails, plunders, and returns.
  2. The **division of spoils** splits the take between the **island treasury** and the **crew**.
  3. Pirates spend their share in **entertainment buildings** you own. Fees go to the treasury.
  4. Pirates also **stash** part of their money at home. Stashed money leaves circulation.
  5. Pirates who own housing plots pay **upgrade fees** as they gain rank.
  6. Your **personal hoard** (Pirate Cave / "Skull Cave") skims a percentage of all treasury income.
- The manual's intro states the design intent: "Charge 'em a share of their plunder to dock their ships. Charge 'em to drink grog… Charge 'em more to 'visit' your brothels." [MAN p.4]
- **Treasury vs hoard.** Treasury gold is spending money for buildings, wages, maintenance, ships and edicts. The **hoard** is what counts for victory and score. Gold can never be withdrawn from the hoard, and treasury gold cannot be moved into it; the hoard is only fed by a percentage "tax" on future income. [MAN p.14, p.32] In the campaign, the hoard carries into the next episode's treasury. [MAN p.32]

### 1.2 Two populations [MAN p.7, p.54-59]
| | Pirates | Captives |
|---|---|---|
| Share of population | Less than half, but bring in nearly all income | Majority; do all island labour |
| Work | Ship crew; on land only as **Overseer** or **Guard**, and only for pay | Every production and service job; never paid |
| Happiness metric | **Happiness** (orange bar). Counts heavily toward score | **Resignation** (silver bar). Counts for nothing in score |
| Good auras | **Anarchy**, **Defense** | **Order**, **Fear**, **Awe** |
| Bad auras | **Order** | **Anarchy** |
| Failure mode | Disgruntled → Enraged → kills someone; majority unhappy → **Coup** (game over) | Escape (risks revealing the island → invasion); **Rebellion** (marches on the palace → game over) |

### 1.3 Order vs anarchy [MAN p.35; WIKI Anarchy/Order]
- Order and anarchy are **one signed axis**. The overlays are mirror images, and a tile cannot be high in both. Internally this is a 16-bit signed value: 0..255 is order, -1..-256 is anarchy. [WIKI Aura]
- The intended zoning: keep the island orderly except in two districts, **pirate housing** and **pirate entertainment**, both near the docks. Captives who work in entertainment are offset with **fear** (fear has no downside for pirates). Put chuck tents, churches and bunkhouses next to the entertainment district, but not inside it, so workers get a dose of order on breaks. Use skeleton haulers (immune to auras) at docks and entertainment. [MAN p.35-36]
- Environmental auras only start affecting a character **after a delay since that character arrived**. The delay is longer at easier "Island Stability" settings, and on very easy settings it lasts several years. New arrivals get the same delay counted from their own arrival. [MAN p.53] The same applies to pirates feeling anarchy and defense. [MAN p.32]

### 1.4 Notoriety
- **Notoriety is a per-pirate trait** (1-9), not a global meter. A captain's notoriety lowers the enemy crew's courage (more surrenders, sometimes before any fight), affects pirate recruitment on cruises, and decides which ship idle pirates join first. It rises with success and with a **peg leg** from the Carpenter. [MAN p.33, p.55-56; WIKI Notoriety]
- The global equivalent is each Great Power's **knowledge of your island's location** (secrecy) plus their **relations** with you. See section 5.

### 1.5 Captive fear and resignation, escapes [MAN p.29-30, p.59-60]
- Resignation is built from the **needs** (food, rest, prayer), the **environment** (fear, order, awe) and "evidence of impressive pirates". That last item is awe from a rich palace or pirate mansions.
- Low resignation plus high courage leads to an **escape attempt**: the captive runs for the shore. If they reach the beach they vanish on a "floating log, abandoned skiff, friendly giant tortoise". Guards and overseers chase reliably; other pirates attack only if the runner passes close.
- Killing an escapee makes escapes **less likely** for a while. A successful escape makes them **more likely**. [MAN p.60]
- On every escape attempt the game runs a **rebellion check**: the escapee's leadership against the courage and resignation of the captives nearby. If it fails, a rebellion begins. [MAN p.60, p.71]

---

## 2. Buildings

### 2.1 General construction rules
- Almost everything must touch the **single road network**. Roads are built instantly. You can only remove a road from a dead end, so the network can never be split. [MAN p.18-19]
- Placement is shown green (legal) or red (illegal). Most buildings appear **yellow** until **builders** from a **Construction Tent** finish them. Builders take the nearest job first unless you set **priority arrows** on a site. [MAN p.17]
- **Instant, free buildings:** construction tent, chuck tent, timber camp. Pirate housing plots and décor are also instant but cost lumber. Décor needs no road. [MAN p.18; WIKI]
- **Rotation:** most buildings rotate 4 ways. Doors facing the road improve efficiency. [MAN p.16; STEAM1]
- **Unlocks:** many buildings are greyed out until a specific **skilled captive** is on the island. That captive is needed to *build* the building; once it stands, unskilled captives can often staff it. [MAN p.8, p.63; WIKI Captive]
- **Haulers:** every building that takes inputs has its **own hauler** (a few have 2), who fetches inputs from the source building. Without a hauler there is no production. [MAN p.23]
- **Production ratio:** "In all cases, the production is on a 2:1 relation", meaning 2 input units make 1 output. Exceptions: the bakery uses 1 banana + 1 papaya per pastry, and the aviary, hat shop and carpenter need no input. Every producing building shows a progress bar. [MAN p.22, p.29]
- **Workers:** captives are auto-assigned by building **priority**. Shift-click a worker to fire them; shift-click an empty slot to block it (red X). Some building types share one global hiring priority (EST: per building). **Overseers** (pirates) "add fear and increase productivity". Their wage is set by the same priority menu. [MAN p.21]
- **Docks:** placed over water with the ramp facing a beach. The ramp/beach edge must be straight across a full tile, there must be room for a large ship, and an existing road must be within about **8 cells** (an auto-road extends to it). [MAN p.17; WIKI-M Ep.2]
- **Boatyard/Shipyard:** on land next to a beach, near empty sea where hulls under construction are displayed. [MAN p.18]
- **Bulldoze:** marks the building condemned (red) until demolition crews arrive, and can be reversed before then. Separate tools: Remove Vegetation, Scuttle Ship (the crew survives), Remove Road (end segments only). Bulldozing a timber camp destroys the wood stored there. [MAN p.19, p.24]
- **Ship repair** after a cruise takes time and consumes some lumber. A ship stuck with no lumber stays "repairing". [WIKI-M Ep.3]
- **Starting buildings:** every island starts with a **Pirate Palace**, a **Stockade** and a **Sawmill**. Most starts also have a corn farm and a chuck tent. [MAN p.6, p.23, p.25]
- **Construction menu:** 10 buttons. Nine are categories (Infrastructure, Resource, Production, Entertainment, Nautical, Captive Control, Education, Defense, Accoutrement) and the tenth is Destruction. [MAN p.16; WIKI Buildings]

### 2.2 Master building table
Notes on columns:
- **Cost** is gold + lumber.
- **Upkeep** is gold per month.
- Overseer and guard wages are set via priority: 1-12 gold/month for most buildings, 2-14 gold/month at the palace. [WIKI]
- **Workers**: C = captive, P = pirate. "Req" is the skilled captive needed to build.
- **Size** is in tiles.
- Data is from [WIKI] infoboxes unless marked otherwise. Gender comes from [MAN p.62-63].

#### Infrastructure
| Building | Cost | Upkeep | Req | Workers | In → Out | Serves/Provides | Aura | Size | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Road | free (EST) | — | — | — | — | — | — | 1 | Instant; single connected network |
| Construction Tent | 0g/0L | 0 | — | 5 Builder (C, M/F), 1 Overseer (P) | — | Builds structures | — | 2x2 | Instant. Common tactic: drop a tent next to each big job, then delete it |
| Chuck Tent | 0g/2L (manual says free) | 2 | — | 1 Cook (C, F), 1 Hauler | 2 Corn → 1 Slop | 7 captives at once; Feasting 0-82% | — | 2x2 | Rule of thumb: 1 per ~30 captives [WIKI] |
| Bunkhouse | 0g/2L | 1 | — | — | — | 5 captives; Resting 86% | — | 2x2 | Captives otherwise sleep on the ground for less rest |
| Pirate Housing Plot | Rank-based (Rank 1 plot: 6L) | 0 | — | — | — | 1 pirate: Resting + Stashing | Anarchy + Awe (by rank) | 3x3 | Instant. See 2.3 |
| Pirate Palace | start building | 0 | — | 4 Guards (P), 2-14 g/mo | — | Required for Assassinate; defends against rebels | Order + Defense (by hoard) | 9x6 | Unique. Upgrades with hoard size (2.3) |
| Pirate Cave ("Skull Cave") | 150g/15L | 5 | — | — | — | Creates the hoard | — | 3x3 | Unique. Hoard setting menu; at most 25% of income goes to the hoard [WIKI] |
| Black Market | 100g/20L | 5 | — | 2 Trader (C, M), 1 Overseer | — | Instantly buys ship supplies | Fear (47:4) | 3x3 | Unique. Adds a "mask" button to the ship panel. Prices in 2.5 |
| Smuggler's Cove | 100g/20L | 2 | Skilled Trader | 2 Trader (C, M), 1 Overseer, 1 Hauler | Surplus goods → gold | Sells to nations it is opened to | — | 4x3 | Unique. Opening it reveals your location. Prices in 2.5 |
| Timber Camp | 0g/0L | 1 | — | 3 Lumberjack (C, M), 1 Overseer | Trees → Wood | — | — | 4x4 | Instant. Place near dense forest. The wiki files it under Resource |

#### Resource
| Building | Cost | Upkeep | Req | Workers | Output | Size | Notes |
|---|---|---|---|---|---|---|---|
| Corn Farm | 0g/3L | 1 | — | 4 Farmer (C, M/F), 1 Overseer | Corn | 3x2 | Corn feeds slop, sea rations and beer |
| Banana Farm | 0g/3L | 1 | Skilled Farmer | 2 Farmer, 1 Overseer | Banana | 3x2 | Needs land fertile for the crop |
| Papaya Farm | 0g/3L | 1 | Skilled Farmer | 2 Farmer, 1 Overseer | Papaya | 3x2 | |
| Sugarcane Farm | 0g/3L | 1 | Skilled Farmer | 4 Farmer, 1 Overseer | Sugarcane | 3x2 | |
| Tobacco Farm | 0g/3L | 1 | Skilled Farmer | 4 Farmer, 1 Overseer | Tobacco | 3x2 | |
| Iron Mine | 0g/10L | 1 | — | 3 Miner (C, M), 1 Overseer | Ore | 4x3 | Place **next to**, not on, the dark-green mineral deposits [MAN p.26]. Skilled miners are much faster. Players recommend at least 2 mines per furnace [WIKI-M] |

Farms depend on per-crop **fertility**, which is shown on an overlay. [MAN p.29; MW]

#### Production
| Building | Cost | Upkeep | Req | Workers | In → Out | Aura | Size |
|---|---|---|---|---|---|---|---|
| Sawmill | 0g/20L | 1 | — | 2 Lumberjack (C, M), 1 Hauler, 1 Overseer | 2 Wood → 1 Lumber | — | 6x4 |
| Blast Furnace | 0g/20L | 1 | — | 3 Blacksmith (C, M), 1 Hauler, 1 Overseer | 2 Ore → 1 Pig Iron | Defense (39:2) | 5x4 |
| Blacksmithy | 0g/15L | 1 | — | 2 Blacksmith (C, M), 1 Hauler | 2 Pig Iron → 1 Cutlass | Defense (39:2) | 3x3 |
| Gunsmithy | 0g/20L | 2 | Gunsmith | 2 Gunsmith (skilled only, M), 1 Hauler | 2 Pig Iron → 1 Musket | Defense (39:2) | 4x4 |
| Cannon Foundry | 0g/25L | 2 | Engineer | 2 Engineer (skilled only, M), 1 Hauler | Pig Iron + Wood → Cannon (EST 2 + 2 → 1) | Defense (39:2) | 6x5 |
| Brewery | 0g/10L | 2 | — | 2 Cook (C, F), 1 Hauler | 2 Corn → 1 Beer | — | 3x3 |
| Rum Distillery | 0g/25L | 2 | Distiller | 2 Distiller (skilled only, F), 1 Hauler | 2 Sugarcane → 1 Rum | — | 6x5 |
| Cigar Factory ("Tobacconist") | 0g/20L | 2 | Tobacconist | 2 Tobacconist (skilled only, F), 1 Hauler | 2 Tobacco → 1 Cigar | — | 4x3 |
| Bakery | 0g/20L | 2 | Skilled Cook + Skilled Farmer | 2 Cook (C, F), 1 Hauler | 1 Banana + 1 Papaya → 1 Pastry | — | 3x3 |

The user asked about rope, sails and gunpowder. **None of these exist** in Tropico 2. Ships cost only **lumber** (plus gold), and the weapons are cutlasses, muskets and cannons. Wood goes straight into cannons. The game also has no generic "grog" good: grog is the **drinking need**, met at any drinking venue, with beer and rum as optional bonus goods. [MAN p.56; WIKI Goods]

**Goods list (21):** Banana, Beer, Cannon, Cigar, Corn, Cutlass, Hat, Lumber, Musket, Ore, Papaya, Parrot, Pastry, Peg Leg, Pig Iron, Rum, Sea Ration, Slop, Sugarcane, Tobacco, Wood. [WIKI Goods]

#### Entertainment
Every entertainment building emits **anarchy**. Each has two menus, **Service Quality** (a pirate-rank band) and **Price Level** ("Bargain Prices" is the default and lowest; "Middling" and "Gouge 'Em" appear in guides). Only entertainment buildings have individual, renamable names. [MAN p.20; WIKI-M]

| Building | Cost | Upkeep | Req | Staff (C, all F except haulers) | Capacity | Rank band | Fee range | Needs met (base satisfaction range) | Bonus goods | Anarchy | Size |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Smuggler's Dive | 0g/8L | 1 | — | 2 Server, 1 Cook, 1 Hauler | 6 | 1-5 | 0-10 | Drinking 24-59%, Feasting 24-51% | Beer; Banana, Papaya | (23:2) | 3x2 |
| Wench & Masseuse | 0g/2L | 1-5 | — | 1 Wench | 1 | 1-5 | 0-10 | Companionship 47-78% | — | (23:2) | 2x2 |
| Animal Pit | 0g/10L | 1 | — | 1 Server | 6 | 1-5 | 0-10 | Gambling 39% | — | (23:2) | 3x3 |
| Cheap Eatery | 0g/10L | 2 | Skilled Cook | 2 Server, 1 Cook, 1 Hauler | 6 | 2-6 | 2-12 | Drinking 16-43%, Feasting 31-75% | Beer; Pastry | (34:3) | 3x2 |
| Gambling Den | 0g/15L | 2 | — | 1 Server, 1 Hauler | 5 | 3-7 | 2-12 | Drinking 22-55%, Gambling 39-65% | Beer; Cigar | (34:3) | 4x3 |
| Brothel & Salon | 0g/30L | 2 | Skilled Wench | 5 Wench, 1 Hauler | 5 | 3-7 | 5-20 | Companionship 57-112% | Cigar | (34:3) | 6x4 |
| Tavern | 0g/12L | 2 | Skilled Server | 3 Server, 1 Hauler | 9 | 4-8 | 5-20 | Drinking 31-94% | Rum, Beer | (34:3) | 3x3 |
| Inn | 350g/35L | 5 | Skilled Server + Skilled Cook | 3 Server, 1 Cook, 1 Hauler | 12 | 5-9 | 8-30 | Drinking 20-63%, Feasting 39-98%, Resting 20% | Rum; Pastry | (46:4) | 5x4 |
| Casino | 300g/30L | 5 | — | 2 Server, 1 Hauler | 8 | 5-9 | 8-30 | Drinking 24-59%, Gambling 39-69% | Rum; Cigar | (46:4) | 5x4 |
| Courtesan & Spa | 0g/8L | 2 | Courtesan | 1 Courtesan (skilled only), 1 Hauler | 1 | 5-9 | 8-30 | Companionship 65-135% | Cigar | (34:3) | 3x3 |

Details:
- The satisfaction ranges are low-to-high: without and with bonus goods and/or better staff skill (EST interpretation). Staff skill raises satisfaction: server skill for drink and gambling, cook skill for food, wench/courtesan skill for companionship. [WIKI Happiness/Skill]
- **Rank mismatch:** a pirate gets **-10% satisfaction for every rank** they are outside the building's current service setting. [WIKI Entertainment Areas]
- **Reservation:** a pirate reserves a slot as soon as they start walking to a building (shown as a grey icon), and you cannot evict them. [MAN p.20; STEAM2]
- **Pirate behaviour:** while on land, each pirate seeks out their **greatest current need**. They often walk to distant venues. [MAN p.27; WIKI]
- **Ratio rules of thumb** [WIKI Entertainment Areas]:
  - At least 4 Wench houses per Smuggler's Dive.
  - 1 Animal Pit per 2 Dives.
  - 1 Dive per ~20 pirates.
  - Companionship is usually the least-satisfied need.
  - Basic layout: 1 Dive + 1 Pit + 4-5 Wench houses, cloned at each dock.
- **Wealthy captives** behave like rank-9 customers. Their spending is added to their ransom. Set their venues to "Gouge 'Em". [WIKI]
- **Charging too early:** if you raise prices before pirates have plundered anything, they go broke and become unhappy. [MAN p.20]

#### Nautical
| Building | Cost | Upkeep | Req | Workers | Notes | Aura | Size |
|---|---|---|---|---|---|---|---|
| Dock | 0g/5L | 1 | — | 2 Hauler, 1 Overseer | **One dock per ship.** Haulers deliver rations and weapons to it, and the docked ship loads them automatically. When the first dock is completed, "a free ship may arrive" [MAN p.7] | Defense (35:2) | 5x4 |
| Sea Ration Factory | 0g/10L | 2 | — | 2 Cook (C, F), 1 Hauler, 1 Overseer | 2 Corn → 1 Sea Ration | — | 4x4 |
| Boatyard | 0g/10L | 2 | Shipwright | 2 Shipwright (skilled only, M) | Builds Snow, Schooner, Sloop | Defense (39:2) | 5x5, unique |
| Shipyard | **8000g (CONFLICT, see note)**/30L | 3 | Shipwright | 3 Shipwright | Builds all 6 ship types | Defense (39:2) | 9x6, unique |

Shipyard cost: the wiki infobox says 8000 gold. That is far out of line with every other building (the Fort costs 1000g) and with the campaign pacing, so it is probably a typo for **800g (EST)**. Verify in-game if possible. The Shipwright background halves the cost. [WIKI Background]

#### Captive Control (order and fear)
| Building | Cost | Upkeep | Req | Workers | Provides | Aura | Size |
|---|---|---|---|---|---|---|---|
| Stockade | 500g/30L (every island starts with one) | 1 | — | — | Houses unemployed captives (15); Resting 59% | Order (59:2), Fear (69:5) | 5x5 |
| Church | 0g/18L | 2 | Skilled Priest | 3 Priest (C, M) | Religion for 9 captives (59%) | — | 6x3 |
| Apothecary | 0g/12L | 2 | Skilled Surgeon | 2 Surgeon (unskilled males allowed per wiki) | Keeps captives healthy (unverified) | Order (47:4) | 3x3, unique |
| Gallows | 0g/20L | 1 | — | — | — | Fear (47:4) | 4x3 (aura table: 4x4), unique |
| Interrogation Chamber | 250g/25L | 5 | — | 1 Overseer | Enables the Interrogate story edict | Fear (86:4) — strongest fear | 5x4, unique |
| Hotel | 500g/50L | 5 | a Wealthy Captive present | — | Rest for 8 wealthy captives (98%); fee 10 | Order (31:2) | 6x6 |
| Orderly Shrubs | 0g/5L | — | — | — | décor | Order (12:2) | 1x1 |
| Very Orderly Decor | 0g/10L | — | — | — | décor | Order (24:3) | 1x1 |
| Scary Decor | 0g/5L | — | — | — | décor (e.g. a giant severed-arm sculpture, skeleton hands) | Fear (12:2) | 1x1 |
| Very Scary Decor | 0g/10L | — | — | — | décor | Fear (24:3) | 1x1 |

Notes:
- **Church:** captives start to need religion after about 2 years on the island. [WIKI Church]
- **Apothecary:** the wiki says unskilled males can staff it. The manual says surgery is a skilled-male-only job. (CONFLICT)
- **Orderly Shrubs:** the wiki flags it "Unique", which is probably an error for a 1x1 décor item.

#### Education (all unique; all Defense (35:3); no staff)
| School | Cost | Upkeep | Capacity | Skill trained | Size |
|---|---|---|---|---|---|
| Gunnery School | 600g/40L | 5 | 6 pirates | Gunnery | 6x3 |
| Marksmanship School | 600g/40L | 5 | 6 | Marksmanship | 5x3 |
| Swordsmanship School | 600g/40L | 5 | 6 | Swordsmanship | 5x4 |
| Seamanship School | 600g/40L | 5 | 6 | Seamanship | 4x4 |
| Navigation School | 600g/40L | 5 | 6 | Navigation | 5x4 |

Each school is used through the **Educate Pirate** edict (100g). The pirate stays at school "a while" and comes out about **+2** in that skill, with all their needs depleted. [MAN p.34; WIKI]

#### Defense
| Building | Cost | Upkeep | Req | Workers | Aura | Size |
|---|---|---|---|---|---|---|
| Fort | 1000g/60L | 5 | Engineer | 4 Guards (P) | Defense (59:4), Fear (47:4), Awe (47:4) | 9x6 |
| Watch Tower | 0g/8L | 2 | — | 2 Guards (P) | Defense (47:2), Fear (47:2) | 2x2 |
| Observatory | 0g/20L | 0 | — | — | Defense (59:4) | 3x3, unique |
| Surgery | 0g/12L | 2 | Skilled Surgeon | 2 Surgeon | **Anarchy (46:4)** | 3x3, unique |
| Protective Cannon | 0g/10L | — | — | — | Defense (24:3) | 1x1 |
| Safe Harbor Anchor | 0g/5L | — | — | — | Defense (12:2) | 1x1 |
| Anarchy Decor | 0g/10L | — | — | — | Anarchy (23:3) | 1x1 |
| Anarchy Shrubs | 0g/5L | — | — | — | Anarchy (11:2) | 1x1 |

Notes:
- **Fort:** the main defence against invasion, and required for the Raise Jolly Roger edict.
- **Surgery:** the manual calls it the "surgeon house".

#### Accoutrement (all unique)
| Building | Cost | Upkeep | Req | Workers | Output | Aura | Size |
|---|---|---|---|---|---|---|---|
| Carpenter | 100g/20L | 5 | Carpenter | 2 Carpenter (skilled) | Peg Leg (+notoriety); slow | Fear (59:4) | 4x2 (aura table: 4x4) |
| Hat Shop | 100g/20L | 5 | Hatter | 2 Hatter (skilled, M) | Hat (+leadership); slow | Order (59:4) | 3x3 |
| Parrot Aviary | 100g/20L | 5 | Bird Handler | 2 Bird Handler (skilled, F) | Parrot (+courage) | Fear (59:4), Awe (59:4) | 3x2 |
| Graveyard | 0g/20L | 2 | — | — | Skeletons (Raise Dead edict) | Fear (47:4) | 3x2 |

- **Outfitting:** each item is given out with the **Outfit Pirate** edict, and each pirate can eventually own one of each. [MAN p.33-34, p.39] The size of the boost is unknown; **(EST)** +1 to +2 per item.
- **Graveyard:** once it exists, every pirate who dies, at sea or on land, is added to it as a corpse. [MAN p.26]

### 2.3 Rank-driven housing and palace
**Pirate housing plot by owner rank** [WIKI Pirate Housing Plot; Awe]

The pirate pays the upgrade cost. The "fee/visit" column is the stash fee paid each time they stash at home.

| Rank | Dwelling | Upgrade cost | Fee/visit | Resting | Stashing | Anarchy | Awe |
|---|---|---|---|---|---|---|---|
| 1 | Housing Plot | 6L (paid by you) | 0 | 0% | 0% | — | (4:2) |
| 2 | Tent | 20g | 5 | 59% | 39% | (3:1) | (16:2) |
| 3 | Hovel | 40g | 10 | 63% | 45% | (7:1) | (24:3) |
| 4 | Shack | 60g | 20 | 67% | 51% | (11:1) | (29:3) |
| 5 | Adobe | 80g | 30 | 71% | 57% | (15:1) | (35:3) |
| 6 | Dwelling | 100g | 40 | 75% | 63% | (19:1) | (41:3) |
| 7 | House | 120g | 50 | 78% | 69% | (23:1) | (47:4) |
| 8 | Estate | 140g | 60 | 82% | 75% | (26:1) | (53:4) |
| 9 | Mansion | 160g | 70 | 86% | 80% | (38:1) | (59:4) |

- Plots cannot be assigned to particular pirates. A high-rank pirate who moves onto a new plot instantly gets the matching house.
- Pirates without a house rest aboard their ship and never become fully rested. [MAN p.56]
- Pirates with 0 gold reportedly fail to sleep. [STEAM2]

**Pirate Palace levels by hoard size** [WIKI Pirate Palace]
| Level | Hoard | Order | Defense |
|---|---|---|---|
| 1 | 0-350 | (69:3) | (27:3) |
| 2 | 350-1250 | (73:3) | (39:3) |
| 3 | 1250-3500 | (76:3) | (51:3) |
| 4 | 3500-5000+ | (80:3) | (63:3) |

The palace also radiates **awe** to captives ("a large rich looking palace"). [MAN p.59] The wiki's Awe table does not list the palace, so its value is unknown.

### 2.4 Aura source summary
- **Order:** Palace, Stockade, Apothecary, Hat Shop, Hotel, Orderly Shrubs, Very Orderly Decor.
- **Fear:** Interrogation Chamber (86:4), Stockade (69:5), Carpenter, Parrot Aviary (59:4), Black Market, Fort, Gallows, Graveyard (47:4), Watch Tower (47:2), Very Scary (24:3), Scary (12:2).
- **Awe:** Housing plots (by rank), Fort (47:4), Parrot Aviary (59:4), and the Palace (value unknown).
- **Defense:** Palace, Fort, Observatory (59:4), Watch Tower (47:2), weapon industries (39:2), Shipyard and Boatyard (39:2), Dock (35:2), Schools (35:3), Protective Cannon (24:3), Safe Harbor Anchor (12:2).
- **Anarchy:** all entertainment, Surgery (46:4), housing plots, Anarchy Decor, Anarchy Shrubs.

### 2.5 Trade prices
**Black Market base purchase prices** [WIKI]
| Item | Base price |
|---|---|
| Cannon | 200 |
| Musket | 75 |
| Cutlass | 50 |
| Sea Ration | 8 |

- The price rises after **every** purchase and slowly decays when you stop buying. Better trader skill lowers prices.
- **(EST)** +5% per unit bought, decaying back about 2% per month.

**Smuggler's Cove base sale prices** [WIKI]
| Item | Base price |
|---|---|
| Cannon | 100 |
| Musket | 25 |
| Cutlass | 20 |
| Rum | 15 |
| Cigar | 15 |
| Pastry | 10 |
| Beer | 5 |

- `Price = floor(Base × (1 + TotalTraderSkill/50))`. TotalTraderSkill is the sum of the traders' (fractional) skills, with +1 per trader if an overseer is present.
- The cove's single hauler only collects from buildings holding **surplus**. One player estimates surplus means about 15-17 units; another reports cannon loads of 4.
- The cove must be **opened** to a nation, which reveals your location to that nation. [WIKI; STEAM2; MAN p.31]

---

## 3. Pirates

### 3.1 Needs and happiness [MAN p.56; WIKI Happiness]
Overall happiness is the **average of 8 factors**: 6 needs plus 2 auras. Each need has an *immediate* bar (shown in the overview, refilled by visiting a building) and a *long-term opinion* bar (shown on the happiness page, which drifts slowly toward recent experience). [MAN p.52-53]

| Factor | In-game label | Satisfied at |
|---|---|---|
| Grub (Feasting) | Feasting | Smuggler's Dive, Cheap Eatery, Inn. Pastries and fruit give bonuses |
| Grog (Drinking) | Drinking | Dive, Eatery, Tavern, Inn, Gambling Den, Casino. Beer and rum give bonuses |
| Companionship | Wenching (male) / Preening (female) — cosmetic difference | Wench & Masseuse, Brothel & Salon, Courtesan & Spa. Cigars give a bonus |
| Wagers (Gambling) | Gambling | Animal Pit, Gambling Den, Casino. Cigars give a bonus |
| Shelter (Resting) | Resting | Own house; ship berth (partial); Inn (20%) |
| Hoard (Stashing) | Stashing | Own house only. Depends on the amount stashed and how recently |
| Defense | aura | "How safe from capture or death by a Great Power" |
| Anarchy | aura | "Does the pirate feel free… or too many rules" |

- **Personal weights:** each pirate weights these needs differently; some like wenching more than gambling. [MAN p.56]
- **Stash:** a pirate puts a **percentage** of each payout into the stash. Pirates who care more about stash save more, and low-rank pirates expect less. Stashed money is out of circulation. [MAN p.56]
- **Peace announcements** lower the happiness of pirates who are outlawed by that nation, through "security concerns" about defense. [MAN p.41]

### 3.2 Rank [WIKI Rank; MAN p.20, p.47]
Rank is set by **lifetime earnings**: 1 Scurvy Dog (0), 2 Pirate Lad (75), 3 Rogue (200), 4 Buccaneer (350), 5 Pirate (550), 6 Senior Pirate (800), 7 Pirate Champion (1100), 8 Pirate Master (1500), 9 Pirate Lord/Lady (2000).

Higher rank means pickier entertainment, stronger reactions to auras, and a better house. Captains and officers rank up fastest because of crew shares.

### 3.3 Skills and traits [MAN p.55-56; WIKI Skill/Trait]
**Skills** run 0-5, improve with use at sea and at schools, and are never lost:
- **Gunnery:** cannon rounds.
- **Swordsmanship:** boarding, and duels on the island (assassinations).
- **Marksmanship:** firearm rounds at sea; shooting fleeing captives; assassinations.
- **Seamanship:** the crew average affects voyage duration and accident chance. The captain's own value affects the chance to intercept or escape and to come alongside for boarding.
- **Navigation:** only the captain's and officers' values count. It is checked periodically to see whether the ship gets lost, which can be temporary or permanent.

**Traits** run 1-9:
- **Courage:** keeps a pirate fighting; makes a captain more willing to pursue.
- **Leadership:** for captains and officers, boosts crew courage; used to pick officers; factors into mutiny and coup.
- **Notoriety:** lowers enemy courage; affects recruitment; decides which ship idle pirates join; grows with success.
- **Loyalty:** shown only for captains; used in the mutiny vote.

Traits change only through gifts (parrot, hat, peg leg) and success (notoriety). Captive traits never change. [MAN p.53]

The ship panel shows **crew average skill** with each weapon. The maximum is 5.0, above 4.0 is very good, and 3.0-3.5 is average. [MAN p.44]

### 3.4 Pirate factions [WIKI Faction]
The wiki lists pirate factions: **English, French, Spanish** (nationality), and **Gunners, Hedonists, Gentry, Literati**. It gives no effects, and the manual shows only a "Politics" page with nationality. Treat factions as minor. The wiki main page says faction importance is "marginalized to the point of rendering them meaningless". [WIKI Tropico 2] **(EST)** For the remake, factions can simply weight that pirate's needs (Hedonists: companionship and drink; Gunners: defense; Gentry: higher rank tastes; Literati: education).

### 3.5 Pirate jobs and the life cycle [MAN p.54-55]
- Idle pirates fill **open ship berths** first. When several ships need crew, they pick the ship with the highest-notoriety captain first.
- Pirates take shore jobs as **Overseer** (works with captives; adds fear and productivity) or **Guard** (fort, watchtower, palace, stockade). Shore pay is low but regular, and pirates prefer a ship.
- All guards and overseers respond to escapes and rebellions. Palace guards carry out assassinations.
- **Captains** are unique, named individuals. Only they command ships, and only via the **Recruit Captain** edict (1000-2000g; 1500 base). A ship without a captain gets no crew. Ordinary pirates can never become captains. [MAN p.55]
- **New pirates come from:**
  - Recruits from captured ships. They are experienced, and their number depends on lives lost and your generosity (spoils setting).
  - **Press Gang** on unskilled captives. These are low quality and unhappy.
  - The "Always a Pirate" and "Once a Mutineer" backgrounds, which raise recruit rates.

### 3.6 Unhappiness, coup, mutiny
- **Disgruntled** (angry red face icon): refuses to work or board, except maybe to rest. Use Backspace to cycle to disgruntled pirates. [MAN p.57]
- **Enraged** (angry face + knife icon): attacks a random victim, and one of them dies. Captains always win these fights. A win cheers the enraged pirate up. [MAN p.57-58]
- **Pirate revolt / coup:** a pirate with high courage and high leadership can lead a revolt. [WIKI Happiness] The island-wide **coup** fires when **a majority of pirates are in the red zone** of the support scale. It cannot be fought off once triggered, but warnings come first. [MAN p.71]
- **Counter-measures:**
  - Fix the needs: donate money, add venues, add housing, raise anarchy and defense.
  - **Assassinate** (100g, needs a palace guard; not usable on captains or wealthy captives; the victim may win the fight).
  - Send malcontents to sea on weak ships in dangerous waters. The manual suggests this explicitly. [MAN p.71]
  - Happy crews can be ordered to sea to free up venue space. [MAN p.57]
- **Mutiny at sea:** happens mainly when **rations run out**, usually because a lost ship is returning with a poor navigator. It is "almost always" a mutiny then, and one of the few ways to permanently lose a captain. A **Hangman's Noose** icon on the ship panel shows crew mood about the upcoming cruise. The loyalty trait feeds the mutiny vote. [MAN p.49, p.54; WIKI Trait]
- **Leaving the island:** I found no source describing happy pirates quitting voluntarily. Pirates are lost through death, betrayal and assassination. **(EST)** Do not model voluntary departure, or model it only for long-disgruntled pirates as an option.

### 3.7 Wealthy captives (pirate-like consumers) [MAN p.58]
- Passengers taken from larger ships. They do no work and party like rank-9 pirates.
- They pay on **credit**: everything they spend is added to their **ransom**.
- They never try to escape, and they have no job, security, stash or religion needs.
- **Needs:** Food, Alcohol, Companionship, Entertainment (gambling), Shelter.
- **Ransom:** paid to the treasury, not shared with the crew, and available any time.
- One player held 50-100 of them and ransomed each at around 5,000g. [STEAM2] A campaign tip says to ransom once the value passes about 200. [WIKI-M]

---

## 4. Captives

### 4.1 Types [MAN p.22, p.58-63; WIKI Captive]
- **Unskilled:** flexible and can take any job allowed for their gender. They start low in all skills and learn by doing, up to **3**. They can be press-ganged. They wear a red shirt (female) or grey shirt (male) while idle or hauling, then switch to the uniform of their job.
- **Skilled:** inflexible. They work only at their speciality, wear their own clothes, start at skill **3-5** and cap at 5. When no matching slot is free they sit idle in the stockade. A skilled worker automatically replaces an unskilled worker in a shared slot. Skilled captives are the **unlock key** for many buildings.
- **Wealthy:** see 3.7.
- **Skeletons:** raised dead pirates. They can only haul, never eat, sleep or pray, ignore auras, and never escape. Cost: 100g, +20g for each one raised; Voodoo Adept starts at 50g.

### 4.2 Jobs by skill and gender [MAN p.62-63; WIKI Skill]
| Skill | Gender (unskilled) | Buildings | Effect of skill |
|---|---|---|---|
| Hauling | M/F (+skeleton) | All haulers | Skill doesn't change speed; skeletons never break |
| Farming | M/F | All farms | Plant/harvest time |
| Carpentry | M/F | Construction tent (builders), Carpenter shop | Build speed; peg-leg speed |
| Mining | M | Iron mine | Ore speed |
| Timber cutting | M | Timber camp, Sawmill | Speed |
| Smith crafting | M | Blast furnace, Blacksmithy | Speed |
| Succouring | M | Church | Effect unknown (applies to other captives) |
| Trading/Negotiation | M | Black market (lowers prices), Smuggler's cove (raises prices) | Price |
| Cooking | F | Chuck tent, Eatery, Dive, Inn, Brewery, Bakery, Sea ration factory | Speed, and feasting satisfaction |
| Companionship 1 (Wench) | F | Wench & Masseuse, Brothel | Satisfaction |
| Service (Server/waitress) | F | Dive, Eatery, Tavern, Inn, Casino, Den, Animal Pit | Drink and gambling satisfaction |

**Skilled-only jobs:**
| Job | Gender | Building |
|---|---|---|
| Gunsmith | M | Gunsmithy |
| Engineer | M | Cannon foundry; also unlocks the Fort |
| Distiller | F | Rum distillery |
| Tobacconist | F | Cigar factory |
| Courtesan | F | Courtesan & Spa |
| Shipwright | M | Boatyard, Shipyard |
| Bird Handler | F | Aviary |
| Surgeon | M | Surgery, Apothecary |
| Hatter | M | Hat shop |
| Carpenter | — | Carpenter shop |

**"Skilled X" captives who unlock buildings** that unskilled workers can then staff: Farmer (fruit, cane and tobacco farms), Cook (eatery, bakery), Server (tavern), Wench (brothel), Priest (church), Trader (smuggler's cove), Surgeon (apothecary, surgery). Skilled Blacksmith, Lumberjack and Miner unlock nothing; they just work faster.

### 4.3 Captive needs and resignation [MAN p.59; WIKI Resignation]
- **Food:** captives eat **slop** at chuck tents and nothing else. Starvation kills them.
- **Shelter:** any free bunkhouse bed (86%); the stockade (59%) for the unemployed; otherwise the ground (less rest). Captives have no fixed home.
- **Prayer:** briefly released to attend church, if one exists.
- **Fear**, **Order**, **Awe**: environmental.
- Resignation is the average of these bars. Its level sets the chances of escape and revolt. [MAN p.53]

**Captive traits:** courage drives escape and joining a rebellion; leadership drives inciting one. Press-ganging or assassinating high-courage or high-leadership captives defuses risk. [WIKI Courage/Leadership]

### 4.4 Acquisition [MAN p.25, p.51; WIKI]
| Source | What you get | Notes |
|---|---|---|
| **Raid Settlement** (ship mission) | Unskilled captives | Settlement types: **Farmstead**, **Trade settlement**, **Military base**. Military bases are the most dangerous but give the most captives. Leaves without full rations and needs no weapons. A few pirates may die; the ship always survives |
| **Kidnap Craftsman** (ship mission) | One chosen skilled captive | 250g. Always succeeds, no losses |
| **Cruise** (boarding victims) | Captives, skilled captives (more likely from Naval Sloops, Frigates, Galleons), wealthy captives (from larger ships) | Boarding keeps the most people alive; harassing kills almost everyone [MAN p.46, p.49] |
| **Shipwreck** special circumstance | Periodic free captives washing ashore | Shipwrights never wash ashore [WIKI] |
| **Patron** nation | Periodic captive deliveries (scenario-dependent) | [WIKI Strategy] |
| Graveyard | Skeleton haulers | |

### 4.5 Disposal options
- **Free Captive:** free of charge; small relations boost; if your location is unknown to their nation, it risks revealing it. [MAN p.38]
- **Free All of Nationality:** large relations boost, large loss of labour. [MAN p.41]
- **Ransom:** skilled captives have a fixed ransom by profession; wealthy captives have a growing one. [WIKI Edicts]
- **Press Gang:** unskilled captives only.
- **Assassinate:** costs 100g.

### 4.6 Escape and rebellion
See 1.5. Losing condition: rebels charge the **palace**. If the number of rebels entering exceeds the number of **palace guards**, you lose; otherwise the rebellion is crushed. Once rebelling, captives never go back to work: kill them all or lose. [MAN p.71]

---

## 5. Ships, missions, nations

### 5.1 Ship types [MAN p.54; WIKI Ship]
| Ship | Built at | Cost | Tons | Crew (men-officers-captain) | Speed | Rations | Cutlasses | Muskets | Cannons |
|---|---|---|---|---|---|---|---|---|---|
| Snow | Boatyard/Shipyard | 0g + 20L | 90 | 3-1-1 | 28 | 5 | 4 | 4 | 4 |
| Schooner | Boatyard/Shipyard | 100g + 30L | 90 | 5-2-1 | **32** (fastest) | 8 | 7 | 7 | 8 |
| Sloop | Boatyard/Shipyard | 250g + 50L | 100 | 8-2-1 | 28 | 10 | 10 | 10 | 16 |
| Brigantine | Shipyard | 500g + 70L | 150 | 8-2-1 | 26 | 30 | 10 | 10 | 12 |
| Frigate | Shipyard | 1000g + 125L | 360 | 13-4-1 | 22 | 40 | 17 | 17 | 26 |
| Galleon | Shipyard | 1000g + 150L | 450 | 15-5-1 | 15 | 60 | 20 | 20 | 40 |

Notes:
- **Hull strength:** tonnage stands in for staying power. The Brigantine is "sturdier" than the Sloop, and the Galleon is the most powerful ship.
- **Range:** a fully crewed Sloop can only cruise sectors adjacent to home. The Frigate and Galleon can reach anywhere with a full crew.
- **Rations:** consumption scales with crew size × distance. Firing crew extends range for explore missions. [MAN p.66]
- **Ship detail panel:**
  - Name (renamable), type, captain.
  - Crew slots: captain, officers, men. Grey means ashore; shift-click fires a crew member or blocks a slot.
  - The 3 crew-average weapon skills.
  - Status (e.g. "repairing", hover for %) and assigned region.
  - Equipment counts, coloured red (insufficient for orders), yellow (enough but not full) or white (full).
  - Three menus: **Mission**, **Operational Orders**, **Division of Spoils**.
  - Noose icon for crew mood, and the Black Market mask button.
  - **Set Sail** rings a bell, puts a bell icon over the ship and summons the crew. A second click forces departure, firing anyone not aboard; you can never leave without the captain.
  - Ships at sea cannot be recalled or re-tasked. [MAN p.43-44, p.47]

### 5.2 Mission types [MAN p.45-51]
| Mission | Requirements | Risk | Result |
|---|---|---|---|
| **Cruise** (default) | Minimum crew to "man the rigging", rations, weapons for the chosen operational order | Real: ship can sink, crew die | Gold, captives, skilled and wealthy captives, recruits, area knowledge |
| **Raid Settlement** | Some rations; no weapons | A few crew may die; the ship always survives | Unskilled captives (amount depends on settlement type) |
| **Kidnap Craftsman** | 250g, rations | None | 1 chosen skilled captive |
| **Explore** | Rations; no weapons | None | Knowledge of the assigned region, much faster than cruising; reveals trade routes and settlements |
| **Foster a War** | Ship assigned to a region, choose a target nation | Low | Flies false colours, fires on the target nation's ships and flees, to make two Great Powers angry at each other |

Raid and Kidnap ignore the ship's map assignment; the ship keeps its assigned region afterwards. [MAN p.67] Exploring takes **3 visits** to reach full knowledge. [WIKI-M]

### 5.3 Operational orders (cruise tactics) [MAN p.45-49]
- **Board 'em** (default) needs cutlasses and uses swordsmanship. It is the most dangerous for your crew but yields **the most captives and recruits**.
- **Pound 'em** needs cannons. It aims big guns at the hull and uses gunnery.
- **Harass 'em** needs cannons + muskets. It shoots rigging and crew with muskets and small guns, uses marksmanship and gunnery, is the safest for your crew, and kills nearly everyone on the enemy ship.

### 5.4 Cruise resolution (port this as the simulation) [MAN p.48-50]
1. **Departure:** rations start being eaten.
2. **Transit:** time = distance ÷ ship speed. Navigation (captain and officers) is checked periodically; a failure means lost, with a delay and extra rations.
3. **On station, search:** the encounter rate depends on the region's merchant and naval traffic per nation, trade routes (large boost), settlements (small boost), the **captain's seamanship**, and **area knowledge**.
4. **Assessment:** each side rates the other's strength, mostly by ship size; pirates rate naval and pirate types higher than merchants. This is compared against the captain's **courage**, and each side decides to **pursue or flee**. **Merchants always flee.**
5. **Outcome of the decisions:**
   - Both flee: nothing happens.
   - Both pursue: battle.
   - One pursues: a **pursuit roll** using the captains' seamanship and the ships' speed. Battle Craftiness gives +10% speed.
6. **Battle rounds:**
   - **Round 1:** both ships always use cannons (gunnery).
   - **Later rounds:** each side follows its orders. Pound and Harass can coexist.
   - **Boarding:** a ship trying to board makes a seamanship-based check to come alongside. Once either side boards, **all later rounds are boarding rounds** (cutlass, swordsmanship) for both.
   - **Each round:** every armed, fighting crewman attacks, and hit chance comes from his weapon skill. Hits kill.
   - **Morale:** at the end of each round, survivors make a **morale check** of courage + own captain's leadership − enemy captain's notoriety. Those who fail flee to the hold and stop fighting but are not killed.
   - **End:** the first ship with no fighting crew surrenders.
7. **Spoils:**
   - **Plunder** depends on the victim ship type (EST: a table by type and nation).
   - **Captives and recruits** depend on how many survived. Few Harass rounds or an immediate boarding means many survivors.
   - **Recruit acceptance** depends on your **generosity** (the spoils setting).
   - Captured enemy cannons are mentioned in [WIKI Ship]: "taking treasure, cannons and captives".
   - Merchants have small crews and usually surrender quickly. Naval and pirate fights are long and bloody.
8. **Loop:** the ship stays on station until the remaining rations equal the return trip plus a **small reserve**, then heads home (with another navigation check; lost plus no food means mutiny).
9. **Ship's Log** on return: a summary page plus a detailed page. Pirates then go ashore to party.
10. **Sinking:** the **captain is never killed**. He is "captured" and returns to the island later. Ship and crew are lost. [MAN p.50]
11. **Damage:** a damaged ship can return early and must repair (time + lumber). [WIKI-M]

**Advice the game gives:**
- Avoid regions with 4-5 cannon icons when using weak ships.
- **Rotate regions:** Great Powers move naval strength into regions with recent attacks and reduce merchant traffic there. Each power has a **limited pool of extra naval strength**.
- Send multiple ships into dangerous regions; they help each other in battle. [MAN p.50]

### 5.5 Division of spoils (booty shares) [MAN p.46-47]
- The menu has 4 settings: **Miserly**, **Selfish**, **Generous**, **Big Spender** (the crew keeps almost everything).
- It splits **cruise gold** between the treasury and the crew. The hoard takes its percentage from the treasury side only.
- **Within the crew:** the captain gets about **25%**, the officers share about **25%**, and the men share the remaining **50%**. You cannot change this split.
- **Trade-off:** stingy settings mean broke pirates (no entertainment, no stash, no house, no promotions) and **fewer recruits**, because captured sailors hear you are stingy.
- The **Greedy** flaw restricts the menu to Selfish or Miserly.
- **(EST)** Treasury shares of 80% / 60% / 40% / 20% for Miserly / Selfish / Generous / Big Spender. No source gives the exact values.

### 5.6 The strategy map [MAN p.11, p.64-67; MW]
- The Caribbean is divided into **18 sea regions/territories**. [MW] Region names seen in sources: Lesser Antilles, Panama, Bahamas, Jamaica, Tortuga, Hispaniola, Virgin Islands. [WIKI-M] I could not find the full list. **(EST)** Use 18 historically plausible zones.
- Your island is a white skull-and-crossbones in one region. In sandbox you choose its location, which matters because small ships cannot cross the whole map.
- Each new game randomises the starting **merchant traffic** and **naval traffic** for every region and every nation, and places **trade routes** (more likely in open sea) and **settlements** (more likely near island clusters or historic cities). [MAN p.11]
- **Region info panel:**
  - **Area Knowledge** level: Unexplored → Well Surveyed / Thoroughly Charted → Very Familiar Seas → Like the Back of Our Hand → Claimed as Our Waters. Knowledge makes the displayed data accurate and gives a bonus to finding victims.
  - **Risk** (0-5 cannon icons) and **Reward** (treasure chests).
  - A skull button toggles a danger overlay (red); a gold-coin button toggles a plunder overlay (green).
  - Which powers use the region.
  - Trade routes and settlements found there.
- **Settlement effects:** trade settlements raise traffic of large merchantmen (**Fluytes**, Galleons); military settlements raise **naval** traffic; farmsteads raise small local traffic (schooners, brigs).
- **Assigning ships:** drag a ship icon to a region. You can only use cleared regions or regions adjacent to cleared ones, and the ship must have enough rations for its crew to make the trip. Dragging only sets the destination; it does not launch the ship.
- **Enemy ship types** mentioned: merchant Fluytes and Galleons, Schooners, Brigs, Naval Sloops, Frigates, Galleons, and other pirates.

### 5.7 Nations and diplomacy [MAN p.41-42, p.64-68]
- There are **three** Great Powers: **England (Britain), France, Spain**. **Holland is not a playable power.** "Van Hoorn" and "de Graff" are captains whose nationality is given as Spanish or French.
- **Relations scale** (hidden number): **Hostile < Cold < Neutral < Cordial < Harmonious**.
  - Harmonious allows you to declare that power your patron.
  - Hostile makes invasion possible or likely, once they know your location.
- **Policy ladder** shown per nation: Our Favourite Target → Take Their Ships → Promised Peace → Patron → Letters of Marque.
- **Foreign affairs tab per nation:** policy and relations, **plunder history** (gold and captives taken from them), **secrecy** (whether they know your location), and European wars.
- **Relations fall when:**
  - Acts of piracy are attributed to you. Taking **naval** vessels hurts most.
  - You kill captives of that nationality.
  - You break a peace promise and get caught, which is much worse than ordinary piracy.
- **Relations rise when:**
  - You announce a peace policy: an immediate boost, then a little more each month it stays in force.
  - You free captives (one at a time, or all of a nationality).
  - You betray pirates of that nationality.
  - You prey on their **enemies** during a war, which they don't mind.
- **Discovery:** the location becomes known through escaped captives who inform, released captives, opening the Smuggler's Cove, and declaring a patron. The **Loose Lips** edict reduces leaks.
- **Invasion** [MAN p.70]:
  - **Conditions:** the power knows your location, you have **no patron**, and relations are low.
  - **Sequence:** warnings first, then preparations, then the invasion.
  - **Defence:** **Forts** matter most, then **ships and captains** (bigger ships are much better).
  - **Strength** scales with how much they hate you and how long the game has run. An early invasion can be held with a couple of good ships.
  - **Failure** means the game is lost.
  - Cheats `britinv`, `frenchinv` and `spaininv` trigger invasions directly. [WIKI Cheats]
- **Patron:**
  - Requires **Harmonious** relations, an active **Peace** announcement, and no current patron.
  - The island becomes a legitimate colony and **cannot be invaded by anyone**, but you can never take the patron's ships.
  - If the patron is at war, **Letters of Marque** become available: legal privateering against its enemies with no relations penalty.
  - A patron may offer **Emergency Funding**, and in scenarios may send captives.
- **Raise the Jolly Roger** (needs a Fort): independence. It cancels peace announcements, patron and marque, frees you to attack anyone, and removes invasion protection. You must repeal it before announcing peace again.
- Torture flaws ("Tortured by X") give -50 relations and block peace and patronage with that nation.

---

## 6. Pirate King: selection, traits, edicts

### 6.1 Ruler creation [MAN p.13; WIKI Pirate King]
- Choose one of **16 preset pirates**, or pick a portrait and **Edit**: 1 **Background**, 2 **Qualities**, 1 **Flaw**. Some combinations are incompatible.
- Nationality comes with the portrait.
- Scenarios set the ruler for you. The campaign hero is a custom-named ruler.

**Preset rulers** [WIKI Pirate King]
| Ruler | Sex | Nationality | Background | Qualities | Flaw |
|---|---|---|---|---|---|
| Anne Bonny | F | Eng | Always a Pirate | Charismatic, Fun-Loving | Illiterate |
| Black Bart | M | Eng | Once a Captain | Charismatic, Iron-Handed | Greedy |
| Blackbeard | M | Eng | Shipwright | Courageous Leader, Dreadful Notoriety | Suicidal Bravery |
| Bloody Mary | F | Eng | Experienced Gambler | Diplomacy, Religious | Alcoholic |
| Calico Jack | M | Eng | Sugar Planter | Battle Craftiness, Fun-Loving | Cowardly |
| Cap'n Hook | M | Spa | Decayed Gentleman | Inquisitor, Religious | Fanatic Catholic |
| Charlotte de Berry | F | Spa | Once a Mutineer | Expert Navigator, Industrious | Fanatic Protestant |
| Francis L'Ollonais | M | Fre | Master Gunner | Inquisitor, Trilingual | Tortured by England |
| Henry Morgan | M | Eng | Decayed Gentleman | Dreadful Notoriety, Iron-Handed | Greedy |
| Laurens de Graff | M | Fre | Always a Pirate | Battle Craftiness, Expert Duelist | Tortured by Spain |
| Long John Silver | M | Spa | Always a Pirate | Expert Duelist, Fun-Loving | Lazy |
| Mary Read | F | Eng | Once a Mutineer | Courageous Leader, Expert Duelist | Suicidal Bravery |
| Nickolaas Van Hoorn | M | Spa | Master Gunner | Dreadful Notoriety, Lucky with Cards | Suicidal Bravery |
| Rock Brazilliano | M | Spa | Tobacco Planter | Fun-loving, Inquisitor | Alcoholic |
| Roseanne Winnefree | F | Spa | Procurer | Charismatic, Voodoo Adept | Tortured by France |
| William Kidd | M | Eng | Once a Captain | Dreadful Notoriety, Expert Seafarer | Lazy |

These are real or fictional names. Replace them in the remake.

**Backgrounds** [WIKI Background]
| Background | Effects |
|---|---|
| Always a Pirate | ×2 chance of recruits on cruises (pirates +20%); captain recruit cost ×1.5 |
| Decayed Gentleman | Order +33%; +100 relations with all three powers; 1 bonus skilled Trader |
| Experienced Gambler | Gambling Den and Casino half price and maintenance-free; incompatible with Lucky with Cards |
| Master Gunner | Starting pirates +2 Gunnery; Gunnery School and Cannon Foundry half price; 1 bonus Engineer |
| Once a Captain | Order +33%; captains half price; recruits -10% |
| Once a Mutineer | Captains ×1.25 (the text says ×2, CONFLICT); recruits +10%; Fear +19%, Order -19% (the text says anarchy +33%, CONFLICT) |
| Procurer | +2 skilled Wenches, +1 Courtesan; Brothel half price |
| Shipwright | +2 Shipwrights; Shipyard cheaper (half) |
| Sugar Planter | +1 Distiller, +1 skilled Farmer; Distillery half price |
| Tobacco Planter | +1 Tobacconist, +1 skilled Farmer; Cigar Factory half price |

**Qualities** (pick 2) [WIKI Quality; MAN]
| Quality | Effect |
|---|---|
| Charismatic | +3 Leadership for all pirates |
| Courageous Leader | +2 Courage for all starting pirates; excludes Cowardly |
| Battle Craftiness | Ships +10% speed in pursuit and flight |
| Diplomacy | Defense +19%; +20 relations with all three powers |
| Expert Duelist | Pirates +2 Marksmanship |
| Fun-loving | +33% anarchy / -33% order island-wide; excludes Iron-handed |
| Iron-handed | +33% order / -33% anarchy; excludes Fun-loving |
| Industrious | +1 to captive skills (faster work); excludes Lazy |
| Lucky with Cards | Gambling Den and Casino half resources and no maintenance; excludes Experienced Gambler |
| Dreadful Notoriety | +10% money from surrendered ships (EST: also + notoriety for captains) |
| Trilingual | +40 relations with the two foreign powers |
| Voodoo Adept | Raise Dead base cost 50g instead of 100g (the manual's Skeleton Island tip implies more voodoo bonuses); excludes Religious |
| Inquisitor | Effect undocumented. **(EST)** + fear island-wide or a better Interrogation Chamber |
| Religious | Effect undocumented. **(EST)** church more effective or cheaper; excludes Voodoo Adept |
| Expert Navigator | Undocumented. **(EST)** +navigation for captains, fewer ships lost |
| Expert Seafarer | Undocumented. **(EST)** +seamanship for crews |

**Flaws** (pick 1) [WIKI Flaw]
| Flaw | Effect |
|---|---|
| Greedy | Spoils limited to Selfish or Miserly |
| Lazy | -1 captive skills; excludes Industrious |
| Suicidal Bravery | Ships engage recklessly: more sinkings and casualties |
| Fanatic Catholic | Only French and Spanish captives may attend church |
| Fanatic Protestant | Only English captives may attend church |
| Tortured by England / France / Spain | -50 relations; no peace or patron with that nation; can't share the ruler's nationality |
| Alcoholic | Undocumented. **(EST)** higher beer/rum consumption or edict costs, or random lost days |
| Cowardly | Undocumented. **(EST)** captains less likely to pursue; excludes Courageous Leader |
| Illiterate | Undocumented. **(EST)** reduced diplomacy/knowledge gains, or schools cost more |

The game's own strategy pairings [MAN p.73-74]:
- "Pirate Life is Cheap": Hoard bonus; recruiter rulers.
- "Pirate Happiness": Bonny, de Graff, Winnefree.
- "Elite Pirates": Hoard bonus; battle-bonus rulers; one ship.
- "Industrial Powerhouse": Fleet Size bonus; Blackbeard, Hook, de Berry, Calico Jack; 6 frigates or galleons.
- "Undead Factory": Skeleton Island; voodoo ruler.

### 6.2 Pirate Code / Articles
The user asked about Pirate Code articles. **Tropico 2 has no "Articles"/"Pirate Code" system**; the manual mentions Articles only in a historical sidebar. [MAN p.28] Rule-setting is done entirely through **Edicts**. If the remake wants a "Code", map it onto the ongoing-policy edicts below.

### 6.3 Edicts
- **Five tabs:** Individual Attention, Pirate Policy, Cruise Orders, Captive Policy, International Diplomacy. Story-only "Special Edicts" sit outside the tabs.
- **Flow:** pick a tab, pick an edict picture (grey means unavailable, and the circle window says why), press Issue or Repeal, then confirm on a parchment that lists costs and effects. A short movie plays in the circle window. Targeted edicts then need a click on a character or ship.
- **Ongoing edicts** can be repealed, with no refund.
- [MAN p.37-43; WIKI Edicts]

**Individual Attention**
| Edict | Cost | Req | Effect |
|---|---|---|---|
| Explore | — | a ship | Mission (see 5.2) |
| Raid Settlement | — | a ship | Mission |
| Kidnap Craftsman | 250g | a ship | Mission |
| Free Captive | free | — | Small relations boost; risks discovery |
| Educate Pirate (×5 variants) | 100g | the matching school | About +2 skill (variable) |
| Press Gang | free | unskilled captive | Captive becomes a (poor, unhappy) pirate |
| Ransom Captive | free (income) | skilled or wealthy captive | Fixed ransom by profession for skilled; growing ransom for wealthy |
| Donate Money | 100g | a pirate | Pirate receives 100g and spends it |
| Assassinate | 100g | palace guard | Guard duels the target, who may win. Not usable on captains or wealthy captives |
| Outfit Pirate | free | Carpenter / Hat Shop / Aviary with stock | Peg leg (+notoriety), hat (+leadership) or parrot (+courage) |

**Pirate Policy**
| Edict | Cost | Type | Effect |
|---|---|---|---|
| Free Beer | 1000g + beer | immediate | Drinking satisfaction of all pirates +up to 50% |
| Free Rum | 1500g + rum | immediate | Drinking +up to 100% |
| Pirate Festival | 1000g | immediate | Drinking, feasting and gambling +about 30% for pirates on the island; brief anarchy boost (and lower captive resignation) |
| Rig Gambling Against Pirates | 500g | ongoing | Gambling revenue + anarchy up, gambling satisfaction down |
| Rig Gambling in Favour | 500g | ongoing | Gambling satisfaction up, revenue down; pirates visit less often |
| Pirate Curfew | 750g | ongoing | Large order increase (pirates unhappy); captive productivity up. The wiki says "at the cost of fear" (CONFLICT) |
| Loose Lips | 100g | ongoing | Fewer leaks of your location by escaped or released captives; large order increase (pirate unhappiness) |
| Betray Pirates (by nationality) | free | immediate | All pirates of that nationality, captains included, are removed and hanged (pirates at sea are removed when they return); big relations boost |
| Donate Money to Crew | 500g | immediate | Split across the captain, officers and crew of one ship |

**Cruise Orders**
| Edict | Cost | Effect |
|---|---|---|
| Prohibit English / French / Spanish Victims | free, ongoing | Captains skip that nation's ships. This does not change relations by itself; it just stops new damage |
| Walk the Plank | free, ongoing | No captives or recruits are taken from victims; everyone is killed (secrecy) |
| Foster War | free | Mission |
| Recruit Captain | about 1500g (1000-2000 range; modified by background) | New unique captain |

**Captive Policy**
| Edict | Cost | Effect |
|---|---|---|
| Pay for Informants | 1000g, ongoing | Captive fear up (the wiki leaves the effect blank) |
| Free All of Nationality | free | Large relations boost; many captives lost |
| Random Executions | 500g, ongoing | Pirates randomly kill captives they meet. Fear and anarchy both up: net neutral for captives, good for pirates. The wiki adds that escapes become more likely |
| Pirate Guard Patrols | 500g, ongoing | Pirates patrol the roads: order and fear up; pirates dislike it |
| Raise Dead | 100g, +20g per skeleton (50g base with Voodoo) | Graveyard corpse becomes a skeleton hauler |

**International Diplomacy**
| Edict | Req | Effect |
|---|---|---|
| Raise Jolly Roger | Fort | Independence (see 5.7) |
| Announce Peace Policy (Eng/Fre/Spa) | not tortured by that nation; Jolly Roger repealed | Immediate relations boost plus monthly gains; pirates outlawed by that nation lose some happiness. Breaking the promise is punished severely |
| Open Smuggler's Cove (to nation) | Smuggler's Cove | Enables sales; reveals location |
| Declare Patron | Harmonious + Peace + no patron | Invasion immunity; location revealed; can't prey on the patron |
| Letters of Marque | patron at war | Legal piracy against the patron's enemy. It has a price; the amount is unknown, **(EST)** 1000g |

**Special (story-scripted) edicts**
- **Interrogate:** needs a special prisoner and an Interrogation Chamber; the advisor reveals story info.
- **Pay a Spy:** campaign only; costs gold; reveals trade routes or settlements.
- **Emergency Funding:** a patron gift when the treasury is low.

**Short-cut buttons** [MAN p.37]
- Scroll button on the pirate panel: Donate.
- Scroll button on the captive panel: Ransom / Press-gang.
- Graveyard panel: Raise.
- Smuggler's Cove panel: Open.
- Ship panel menu: Explore / Raid / Kidnap / Foster War.
- Accoutrement building panels: Outfit.

---

## 7. Game setup, victory, time

### 7.1 Modes [MAN p.10-13]
- **Campaign:** 16 episodes covering 1650-1730 and beyond; the final episode is the War of Jenkins' Ear, around 1740. Each episode unlocks the next and the hoard carries forward. Each has bronze, silver and gold medal times. Examples [WIKI-M]:
  - Ep.1 "Beer for Buccaneers": build a brewery and a dive. Bronze ≤13 months, silver ≤6, gold ≤4.
  - Ep.3: build a boatyard and reach a 3000g treasury.
  - Ep.4: build a sloop and reach pirate happiness above 62.5%.
- **Stand-alone scenarios:** story, difficulty estimate, special victory conditions, fixed ruler.
- **Sandbox:** random island, no script, no events.
- **Learn:** play with help activated.
- **Map Editor and scripting:** a map file plus a same-named `.txt` script in `Maps/`, with includes like `#include "Maps/T2Advice.txt"`. Documentation lives in `DOCUMENTATION.txt` and `PLAYER SAMPLE.txt`. Scripts can set starting characters, ships and captains, disallow buildings and edicts, and define win and lose conditions. [MAN p.75-76]

### 7.2 Sandbox setup screens [MAN p.11-13; MW; WIKI Time Limit]
1. **Island Location:** click a sea region; the skull icon marks it.
2. **Physical parameters:** island size, topography/terrain and **vegetation**. Vegetation is the biggest difficulty lever, because lumber limits everything. The exact options are unknown; **(EST)** Size Small/Medium/Large; Mountains Few/Some/Many; Vegetation Sparse/Normal/Lush; Mineral deposits Few/Normal/Many.
3. **Game Conditions:**
   - **Game Length:** **10-30 years**. At the end you may keep playing indefinitely. Longer games lower the difficulty %.
   - **Bonus Victory Condition:** 5 factors; the chosen one counts more. Inferred from the manual's examples: **Hoard, Pirate Happiness, Fleet Size, Number of Captains, Number of Pirates**.
4. **Special Circumstances:**
   - **Island Stability:** a numbered scale where 1-2 is recommended for beginners. This is the biggest difficulty factor. It controls how quickly auras start to affect people and how volatile they are. **(EST)** 5 levels.
   - **Island Advantages:** 5 worker options. **"Botany Bay"** is the easiest, giving extra workers plus other advantages, and **"Bare Bones"** is the hardest, with no extra workers. Other named conditions: **Shipwreck** (periodic castaway captives) and **Skeleton Island** (start with 10 skeletons in the graveyard). The fifth option is unknown; **(EST)** "Patron's Gift" or "Convict Ship".
   - Reviews mention separate pirate and captive stability settings. [MW]
   - Steam players mention a "Chaos" setting and a start option giving a free Engineer or Trader. [STEAM2]
5. **Ruler selection:** see 6.1. Starts with the "Start" button.
6. **Difficulty %:** shown at the bottom left. The final score is multiplied by it.

### 7.3 Scoring and losing [MAN p.15, p.69-71]
- **Sandbox score** = Σ(factor × normalising constant), with the bonus factor weighted heavily, × difficulty %.
- **Medals:** **Gold ≥ 25,000**, **Silver ≥ 15,000**, **Bronze** = any finished game.
- The score is driven heavily by pirate happiness. Captive resignation counts for nothing.
- **Ways to lose (all modes):**
  - **Invasion** succeeds.
  - **Pirate coup**: a majority of pirates in the red.
  - **Captive rebellion** breaches the palace.
  - Scenario conditions are failed.
  - Cheats `loseit` / `winit` end the game.

### 7.4 Time [MAN p.12, p.15]
- **Normal speed: 1 game year = 30 real minutes**; a 30-year game is about 15 hours.
- Speed is chosen with a bar control (taller bar = faster). **(EST)** 3-5 steps, e.g. ×0.5, ×1, ×2, ×4.
- The Pause key pauses. The **date** is shown as month/year.
- Upkeep and wages are charged **per month**.
- **Autosave** runs at an interval (one slot). **Q** is quicksave. [MAN p.9; WIKI-M]

### 7.5 Cheats (Ctrl+Shift+code) [WIKI Cheats]
| Code | Effect |
|---|---|
| timber | +100 lumber |
| booty | +2000 gold |
| freebuild | Ignore building rules |
| goape | Selected pirate becomes enraged |
| goforit | Selected captive attempts escape |
| britinv / frenchinv / spaininv | Trigger that nation's invasion |
| loseit / winit | Lose or win the game |

These are useful as debug commands in the remake.

---

## 8. UI layout, overlays, Island Log, advisor, audio

### 8.1 Main screen [MAN p.13-16]
- **Bottom toolbar** styled as a ship's railing. Its central area shows menus and details for whatever is selected.
- **Four wooden info boxes**, two in each bottom corner:
  - **Gold** and **Lumber** (the total across all sawmills) on the left.
  - **Date** on the right; hover shows when your rule began, click opens the victory conditions.
  - **Population** (pirates / captives) on the right; click opens Demographics.
  - Clicking Gold opens the finances page.
- **Info Bar** along the bottom for hover help.
- **Mini-map:** diamond-shaped, on the left. It has a white view rectangle, rotate-left/right arrows (90° steps), and +/- zoom (also the mouse wheel; up to 7 zoom levels [MW]). Click to jump there.
- **Circle Window**, framed by a ship's wheel, on the right. It shows:
  - Selected objects, with a **lock** to follow one; reviewers loved the follow-cam.
  - Building and edict requirements, edict movies and alerts.
  - By default, the **support scale**: treasure on the right means support, bones on the left mean opposition. Clicking it opens a graph with green (delighted), yellow (content) and red (coup-ready) zones, one skull per pirate.
- **Happiness/Resignation bars** on the far left: **orange** for pirate happiness, **silver** for captive resignation. Click them for the detail pages. [WIKI-M]
- **Speed control** bars beside the circle window.
- **Main toolbar buttons** (all "Silver"):
  - **Hammer:** construction, with 10 sub-buttons.
  - **Eye:** overlays.
  - **Scroll:** edicts, with 5 tabs.
  - **Telescope:** strategy map; toggles back to the island.
  - **Book:** Island Log.
  - **Ship's Wheel:** game controls (Save, Load, Settings, Quit).
- **Hotkeys mentioned:**
  - **G:** tile grid.
  - **Q:** quicksave.
  - **Backspace:** cycle to disgruntled pirates.
  - **Alt+0-9:** assign the selected character to a number key; the number recalls them.
  - **Pause.**
  - **Shift-click:** fire or block a slot.
  - The full hotkey list was on the back cover, which is not in the PDF.

### 8.2 Building detail panel [MAN p.19-22]
It has four sections:
1. **Centre:** type, name (renamable for entertainment buildings), output, wages, maintenance, profit or loss.
2. **Left: customers.** Silhouette slots up to capacity: grey means reserved and walking over, colour means present. Click one to view that customer. Below are up to two menus, **Service Quality** (rank range) and **Price Level**.
3. **Right: workers.** Up to 3 worker types. Hover shows the requirement, click selects, shift-click fires or blocks (red X). Below is the **priority** menu: hiring order, and pirate pay level.
4. **Bottom bar:** input icons and counts on the left, output on the right, and a production progress bar.

There is also a "book" icon that opens the Cyclopedia page, and priority arrows on construction sites.

### 8.3 Character panel: 7 pages [MAN p.52-53]
1. **Overview:** name, birthplace, rank/level, personal gold, current activity, immediate need bars (red to green).
2. **Happiness/Resignation:** long-term need opinions plus environmental bars on the left, averaged into an overall bar at the bottom.
3. **Politics:** nationality, faction.
4. **Job & House.**
5. **Haunts:** pirates only. Up to 4 favourite venues, one per entertainment type, each with a satisfaction bar.
6. **Skills & Traits.**
7. **Thoughts:** hover each for an explanation. Red thoughts are warnings, e.g. a captive about to escape thinking "I'm going to make it!".

Shortcut scroll buttons sit at the top of the panel. Status icons appear above heads: red angry face (disgruntled), face + knife (enraged), bell over a ship (summoning crew).

### 8.4 Overlays (Silver Eye) [MAN p.34-35; WIKI-M]
- **Three display styles:** colour the land, colour the buildings, or put coloured arrows over characters. Green is good, then light green, yellow and orange, and red is bad.
- **Aura overlays:** Order, Anarchy (mirror images of each other), Fear, Defense, Awe.
- **Terrain:** crop fertility per crop, and minerals.
- **Structures:** Staff Size (staffing level), with other building-status overlays.
- **Characters:** happiness and resignation arrows. **(EST)** for exact list; at least needs per type.

### 8.5 Island Log (the almanac equivalent) [MAN p.73; MAN p.57, p.71; WIKI-M]
- Book UI: chapter tabs, a contents tab at the top and a close tab at the bottom. Clicking a chapter title shows that chapter's outline on the opposite page.
- It opens automatically at intervals; this can be disabled.
- **Known pages:**
  - Victory conditions.
  - **Demographics**: pirates and captives lists, sortable by courage, leadership and ransom. You can ctrl-click entries to apply a pending edict, e.g. mass ransom or press-gang.
  - **Pirate Satisfaction**: overall happiness, a dissatisfied-pirates list, per-need graphs.
  - Finances.
  - **Cyclopedia** pages for every building, captain and ship. Captain pages show stats and loyalty.

### 8.6 Advisor and notifications [MAN p.72-73; WP; MW]
- **Smitty**, the Pirate King's first mate, appears at the top left.
- **Modes** (Settings, overview page):
  - **Tutorial** on: frequent, detailed reasoning.
  - **"Leave Smitty around"**: available, but not in your face.
  - Both off: he only reports major events.
- **Typical prompts:**
  - Timber shortage ("Cannot shiver me timbers, without timber!").
  - Recruit a captain when ships outnumber captains.
  - Kidnap a skilled worker.
  - Press-gang captives.
  - Check the stockade for idle workers.
  - Accoutrement finished ("a parrot is trained").
  - Escaping captives, needed buildings.
- **Modal notifications** pause the game. Each type has a "don't show again" checkbox, re-enabled under Settings → Notifications. Examples: plunder, parrot produced, disgruntled pirate, escape, invasion warnings, coup warnings, ship sunk / captain captured.
- **Settings:** five pages: overview/advisor, notifications, graphics, level of detail, and one more (EST: sound). Graphics options: Fullscreen, Setup Videos, Grid Lines, Ocean Animation, Reduced Graphics Shifting, 3D Mode HW/SW, Resolution up to 1600x1200. Level-of-detail options: Overall, Shading, Ground texture, People, Buildings, Trees, Ships, Border. [GOL]

### 8.7 Audio [MAN credits; WP; MW]
- **Music:** Caribbean/tropical score by **Daniel Indart**, plus an additional track "Arena". A reviewer criticised the limited track variety.
- **Voice:** Smitty speaks in a heavy pirate brogue and is the game's voice. Reviewers found his repeated lines annoying.
- **Unit clicks:** each class of character has nearly identical shouts.
- **Screams** on deaths: male screams were judged fitting, female screams harsh.
- **SFX** by Audiosyncrasy. A **ship's bell** rings on Set Sail.
- An opening cinematic leads to a **Pirate King's office** main menu: click large text lines to zoom to spots in the office (Play Campaign, Single Games, Learn, Extras → Map Editor).
- **Remake suggestion** (a reviewer's idea): a parrot announcer to vary the advisor voice.

---

## 9. Simulation formulas and implementation notes

### 9.1 Aura math [WIKI Aura]
- The map is divided into **4×4-tile clusters**.
- An aura has a **base strength** (0-255; the game UI shows it as % of 255) and a **range** in clusters.
- Distance d = Euclidean distance in clusters from the source cluster, and d ≤ range.
- `strength(d) = floor(Base × (Range − d + 1) / Range)`.
- Overlapping sources are **summed before flooring**.
- Order and anarchy share one signed channel: order is positive, anarchy negative.
- **Interpreting `(a:b)`:** a is the in-game strength value and b is the range. Because the UI shows % of 255, (23:3) is probably about 23% × 255 ≈ 59 base (EST). Whichever scale you choose, keep the **ratios** between buildings.
- **Global modifiers** (traits ±33%, ±19%, edicts) scale each channel island-wide.
- **Characters:** each character's personal level for an aura **drifts toward the local tile value** while they pass through. The rate is unknown; **(EST)** close 2-5% of the gap per game day. The drift starts only after the stability-based arrival delay.

### 9.2 Need loop (EST model consistent with sources)
- Each need has an immediate meter that decays over time. Decay is faster at sea for drink and companionship (EST), and much faster during school.
- **Seeking:** when on land, a pirate picks the most urgent need and goes to the nearest (EST: or a haunt) building that has a free slot for it. It reserves the slot.
- **Visit:** pay the fee, then the meter gains `baseSatisfaction × staffSkillFactor × bonusGoodFactor × (1 − 0.10 × rankDistance)`.
- **Opinion:** the long-term opinion bar moves toward the immediate meter's satisfaction.
- **Overall:** happiness = mean of the 6 opinions (weighted by personal preference) + Defense + Anarchy.
- **Broke:** a pirate with too little gold for a venue cannot use it, and the need goes unmet.

### 9.3 Economy flows summary
- **Gold in:** cruise plunder (treasury share), entertainment fees, housing upgrade and stash fees, ransoms, Smuggler's Cove sales, patron gifts.
- **Gold out:** construction, maintenance (monthly), pirate wages (overseers and guards, monthly), ship builds, edicts, Black Market purchases.
- **Hoard:** a % of every gold-in event (setting from 0 up to "Stash Maximum", capped at 25%).
- **Lumber in:** sawmill output. **Lumber out:** construction, ships, repairs, décor, housing plots.
- **Trees:** the manual says they regrow slowly; one player says they don't. (CONFLICT) Recommend slow regrowth.

---

## 10. Open questions (unverified; check the unreachable guides)
1. Exact plunder-share percentages per setting, and the hoard setting steps (labels seen: "Stash Maximum", "a lot").
2. Price Level labels and multipliers (seen: Bargain Prices, Middling, Gouge 'Em) and whether there are more steps.
3. Production times per building, and the rate at which skill speeds them up.
4. The Shipyard's real gold cost (wiki says 8000; likely 800).
5. The full list of 18 sea regions, and plunder values per victim ship type.
6. Effects of the undocumented qualities (Inquisitor, Religious, Expert Navigator, Expert Seafarer) and flaws (Alcoholic, Cowardly, Illiterate).
7. The full Island Advantages list (5 options) and the Island Stability levels.
8. How invasion strength is computed, and how a battle between the invasion and forts or ships resolves.
9. The full hotkey list (it was on the manual's back cover).
