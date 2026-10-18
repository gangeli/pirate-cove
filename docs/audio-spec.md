# Audio spec

All generated audio goes in `public/assets/audio/`, and `src/audio/manifest.json` describes it (schema at the end of this file). Encode everything as **MP3**, mono for voices and SFX, stereo for music. Trim silence and normalise loudness to about -16 LUFS for voices and music, and about -14 LUFS for SFX.

## Voices

### Speakers
- **barnaby**: the Pirate King's first mate and advisor. An old, warm, gravelly West Country English sea dog with a dry wit. He says "Cap'n" (or "Your Majesty" when sarcastic).
- **polly**: a parrot that squawks very short urgent alerts. It should sound shrill and raspy, and be funny.
- **pirate_m1, pirate_m2, pirate_m3**: rough male pirate voices for click barks (cockney; gravelly Irish; deep and slow).
- **pirate_f1**: a tough female pirate.
- **captive_m, captive_f**: weary labourers with light Spanish or French accents.
- **soldier**: a stiff British marine.
- **wealthy**: a posh, indignant aristocrat.

### Advisor lines (speaker: barnaby)
The key is the message `voice` key the game emits. These spoken lines are short versions; the on-screen text is longer.

| key | line |
|---|---|
| adv_welcome | Welcome ashore, Cap'n! Captives do the work, pirates bring the gold. Keep the lads merry and the captives cowed, and we'll all die rich. |
| adv_lumber_low | Can't shiver me timbers without timber, Cap'n! We're near out of lumber. |
| adv_food_low | The captives are starving, Cap'n. More corn, more chuck tents! |
| adv_no_captain | There's a fine ship rotting at the dock with no captain. Recruit one! |
| adv_idle_ship | A ship in harbour makes no gold, Cap'n. Send her out! |
| adv_homeless | Half the crew's sleeping in the dirt. Lay out some housing plots, eh? |
| adv_company | The lads are lonely, if you take my meaning. More wenches, Cap'n. |
| adv_drink | A thirsty pirate is a dangerous pirate. We need more grog! |
| adv_gamble | The crews are bored stiff. Give 'em something to wager on. |
| adv_broke | The lads haven't a coin between 'em. Send the ships out, or loosen your purse strings. |
| adv_unemployed | There's a mob of captives loafing about the stockade. Put 'em to work! |
| adv_idle_skilled | We've a skilled craftsman sitting on his hands. Build him a workshop! |
| adv_no_cave | Don't forget yourself, Cap'n. Build a Pirate Cave and start filling your own hoard. |
| adv_escapes | Captives keep running off! We need more fear about the place. |
| adv_unhappy | The pirates are grumbling, Cap'n. Mind their needs, or mind your neck. |
| adv_debt | The treasury's bare and we're spending like admirals. No more building for now! |
| adv_church | The captives are asking for a church. Let the priest preach, eh? |
| adv_notice | One of the Powers knows where we are and hates us. Build defences, or make peace. |

### Event lines (speaker: barnaby unless noted)

| key | speaker | line |
|---|---|---|
| set_sail | barnaby | Anchors aweigh! Fair winds to 'em. |
| sail_ho | polly | Sail ho! Sail ho! Squawk! |
| ship_returns | barnaby | Our ship's back, Cap'n, and not empty-handed! |
| ship_returns_empty | barnaby | Back already, and nothing to show for it but sunburn. |
| big_plunder | barnaby | Ha-HAR! Look at all that gold! Now that's a proper haul! |
| ship_launched | barnaby | A new ship slides down the slipway. Ain't she a beauty? |
| ship_sunk | barnaby | We've lost a ship, Cap'n. Davy Jones takes his due. |
| mutiny | barnaby | Mutiny! Starving crews don't stay loyal for long. |
| free_ship | barnaby | Would you look at that, a ship's limped into our new dock. Finders keepers! |
| new_captain | barnaby | A new captain's signed on. Infamous, they say. Good. |
| captain_returns | barnaby | Our captain's escaped his captors and come home! |
| escape | polly | Runaway! Runaway! Squawk! |
| escaped | barnaby | One got away, Cap'n. Let's hope they don't talk. |
| rebellion | polly | Rebellion! Rebellion! Guard the palace! Squawk! |
| murder | barnaby | There's been a killing. Tempers are short on this island. |
| starvation | barnaby | A captive's starved to death, Cap'n. Bad for business. |
| discovered | barnaby | They know where we are, Cap'n. That's trouble. |
| invasion_rumour | barnaby | Rumours in the taverns, Cap'n. Someone means to come for us. |
| invasion_fleet | barnaby | An invasion fleet's gathering. Man the forts! |
| invasion | polly | Invasion! Invasion! All hands! Squawk! |
| invasion_repelled | barnaby | We sent 'em packing! They'll think twice before they come again! |
| invasion_cancelled | barnaby | Looks like they've called off the attack. Phew. |
| enemy_sunk | barnaby | Down she goes! Good shooting, lads! |
| coup_warning1 | barnaby | The lads are muttering about mutiny, Cap'n. Mind how you go. |
| coup_warning2 | barnaby | They're sharpening their cutlasses, Cap'n. Fix this, quick, or it's your head! |
| peace | barnaby | Peace it is, then. I'll tell the captains to behave. |
| peace_broken | barnaby | We broke our word, Cap'n. They won't forget it. |
| patron | barnaby | We're under royal protection now. Respectable! Ugh. |
| patron_gift | barnaby | Our patron's sent us some coin. Generous of 'em. |
| jolly_roger | barnaby | The Jolly Roger flies! We bow to no king! |
| war_declared | barnaby | There's war in Europe, Cap'n. Good for business! |
| festival | barnaby | A festival! Rum, fiddles and bonfires! The lads will love you for this! |
| free_grog | barnaby | Free grog for all! Three cheers for the Cap'n! |
| ransom | barnaby | The ransom's paid. Pleasure doing business. |
| free_all | barnaby | Off they go, singing your praises. Soft, if you ask me. |
| betray | barnaby | Hanged them, did they? Remind me never to cross you, Cap'n. |
| raise_dead | barnaby | The dead walk! I'll never get used to that. |
| assassination | barnaby | It's done, Cap'n. Quiet as a cat. |
| assassination_failed | barnaby | Our man didn't come back, Cap'n. The target fought him off. |
| castaways | barnaby | Castaways on the beach, Cap'n! More hands for the fields. |
| accessory_pegleg | barnaby | A fine new peg leg's been carved. Very fashionable. |
| accessory_hat | barnaby | A splendid new hat is ready, Cap'n. |
| accessory_parrot | polly | Pretty bird! Pretty bird! Squawk! |
| edict | barnaby | It's done, Cap'n. Your word is law. |
| victory | barnaby | That's it, Cap'n! Your reign's complete. They'll sing songs about you! |
| defeat | barnaby | It's all over, Cap'n. It was a good run while it lasted. |
| construction_done | barnaby | Another one finished, Cap'n. |

### Click barks (several variants per speaker; keys `bark_<speaker>_<n>`)
- **pirate_m1, m2, m3, f1**, about 6 each. Examples: "Arr?", "Aye, Cap'n?", "What be ye wantin'?", "Got any grog?", "I'm thirsty!", "Ready to sail!", "Yo ho!", "Don't touch me cutlass.", "Where's me gold?", "Fair winds!".
- **captive_m, captive_f**, about 5 each. Examples: "Yes... master.", "Another day in paradise.", "I miss my home.", "Sí, señor...", "Oui, oui, I go...", "Please, no more work."
- **soldier**, 4. Examples: "For the King!", "Surrender, pirate scum!", "Forward!", "Hold the line!"
- **wealthy**, 4. Examples: "Unhand me, ruffian!", "Do you know who my father is?", "This is an outrage!", "When will my ransom be paid?"
- **polly**, 4 squawks. Examples: "Squawk! Pieces of eight!", "Polly wants gold!", "Arr arr arr!", "Squawk!"

## Sound effects (keys -> short files; variants are allowed as `key_1`, `key_2`, ...)
ui_click, ui_open, ui_close, ui_error, build_place, build_complete, demolish, hammer_loop, saw_loop, axe_chop, ship_bell, cannon_fire, cannon_impact, explosion, splash, sword_clash, musket_shot, scream_m, scream_f, cheer_crowd, coins, chest_open, parchment, quill, horn_alert, drums_festival, parrot_squawk, rooster, fire_crackle_loop, tavern_murmur_loop, waves_loop, jungle_loop, seagulls, wind_loop.

## Music (loopable, 1.5-3 minutes each)
- `theme`: main menu. A swashbuckling Caribbean pirate theme with an accordion/fiddle lead, guitar, light percussion and a heroic melody.
- `island_1`, `island_2`, `island_3`: gameplay. Laid-back Caribbean acoustic: steel drum, nylon guitar, marimba, shaker, light pirate flavour. Not too busy.
- `tension`: invasion or rebellion. Driving drums and low strings.
- `victory` (about 20 s sting), `defeat` (about 15 s sting).

## Manifest schema (`src/audio/manifest.json`)
```json
{
  "voices": { "<key>": { "file": "audio/voice/<key>.mp3", "speaker": "barnaby", "text": "..." } },
  "barks": { "pirate_m1": ["audio/voice/bark_pirate_m1_1.mp3", ...], ... },
  "sfx": { "<key>": ["audio/sfx/<key>.mp3", "audio/sfx/<key>_2.mp3"] },
  "music": { "<key>": "audio/music/<key>.mp3" },
  "credits": [ { "asset": "...", "source": "...", "license": "...", "url": "...", "authors": ["..."] } ]
}
```
