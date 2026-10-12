# Scapewatch Planner

Offline efficiency/path planner for *Scapewatch: Idle MMO*, built entirely on
the game's own shipped reference data. No live account or network access —
you feed it your own current stats, it tells you what's efficient.

## Data provenance

`data/raw/` is a read-only copy of `shared/data/*.json` and `shared/Constants.js`,
extracted locally from the Steam client's `app.asar`
(`steamapps/common/Scapewatch Idle MMO/resources/app.asar`). This is the same
data the live client ships to every player and syncs against via the
`dataHash.js` beacon — it's not reverse-engineered or inferred, just unpacked.
`Constants.js` is plain CommonJS with no external dependencies, so it's
`require()`'d directly rather than reimplemented — the formulas here are the
game's actual formulas, not approximations.

Nothing in this repo touches the live game, your account, or the network.

### Refreshing after a game patch

The client checks `window.SCAPEWATCH_DATA_HASH` against the server on load;
if the data below goes stale after an update, re-extract:

```bash
npx --yes @electron/asar extract "C:\Program Files (x86)\Steam\steamapps\common\Scapewatch Idle MMO\resources\app.asar" <tmp-dir>
# then copy <tmp-dir>/shared/data/* and <tmp-dir>/shared/Constants.js into data/raw/
# and <tmp-dir>/assets/icons/{skills,items} into public/assets/icons/
```

### Image import (optional)

The dashboard's Import panel parses screenshots into structured data using
Claude's vision API. It's the one feature that makes an outbound network
call — everything else in this project is fully offline. To use it, set an
API key before starting the dashboard:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."
node src/server.js
```

Without a key set, every other tool in the dashboard still works — only
the Import panel will show an error telling you the key is missing.

## Status

- [x] Data loader (`src/data.js`) — indexes nodes/skills/quests/items/mobs/activities, exposes `Constants.js` formulas
- [x] Combat/XP efficiency calculator (`src/combat.js`) — DPS, kill time, XP/hr, gear-tier comparisons, built on the game's real combat formulas. One documented assumption (defense score doubles as both evasion and damage reduction) needs validating against real observed kill times — see the module's doc comment
- [x] Skilling XP/hr calculator (`src/skilling.js`) — action duration, success rate, lucky-task bonus, built on the real formulas
- [x] Travel-cost model (`src/travel.js`) — bank-to-bank distance (`paths.json`), node-to-bank distance (baked into `nodes.json`), movement speed, and teleport-crystal logic (auto-triggers only above a tier's distance threshold, consuming a charge)
- [x] Task-reroll expected-value model (`src/reroll.js`) — keep-vs-reroll decision for a queue slot's 3 visible task options, now travel-aware (compares *effective* XP/hr including walking/teleport time, not raw activity XP/hr) and scarcity-aware (reroll credits get a hyperbolic marginal-value curve — cheap to spend from a stockpile, expensive near zero). Known simplification: assumes uniform weighting over the candidate pool when estimating a fresh draw's value; the live game's actual per-skill "lever" weighting isn't available offline (pass `weights` if you know your own lever setup)
- [x] Rare-drop (permanent buff/unlock) expected-value model (`src/raredrops.js`) — farm-time + opportunity-cost + payback-period math, using real `rareDrops` odds from `mobs.json` encounters. Along the way, fixed a real bug in `combat.js`: crit chance was being blended into damage *before* the reduction/ceiling math, which silently zeroed out small crit bonuses (nonlinear rounding averaged-then-applied vs. applied-then-averaged) — now resolves each outcome discretely first
- [x] Slay/combat-lane reroll model (`src/slaytasks.js`) — the combat-task counterpart to `reroll.js`'s skilling model, using `mobs.json` encounters as the theoretical candidate pool instead of `activities.json` (same reasoning: the real 3 offered options aren't observable after one is already committed, so this estimates from everything you're eligible for, same as the skilling model always did). Validated against a real screenshot of an actual task queue.
- [x] Local web dashboard (`src/server.js` + `public/`) — a small Express server wrapping every module above behind a JSON API, with a browser UI: profile (skills/gear/credits/crystal), combat simulator + weapon comparison, skilling reroll, slay reroll, rare-drop farm calculator, and the quest route optimizer below. Manual-entry only, per the earlier display-options research — no live game access. Profile persists to `data/profile.json` (gitignored — personal data, not project code). Verified end-to-end in-browser: every tool returns sane results, profile save/reload survives a page refresh.
- [x] Quest-order + travel-path optimizer (`src/questoptimizer.js`) — respects prerequisites (`questRequirements`) and level gates, sequences eligible quests by a greedy nearest-next heuristic (not globally optimal — precedence-constrained travel ordering is NP-hard — but explainable and effective: ~81% less travel than data order in the worked example). Along the way, fixed a real bug: bank-type nodes don't carry `nearestBankId`/`nearestBankDistance` (they're the reference point, not a satellite of one), which silently zeroed out travel cost for any "visit a bank" quest step — the majority of them. Fixed and verified against a real cross-map distance.
- [x] Dashboard UI overhaul — sidebar navigation (one panel visible at a time instead of a long scroll), real game icons on skills and weapons (extracted from `app.asar`'s `assets/icons/{skills,items}`, 8.1MB, gitignored/regenerable like `data/raw`), and an Import panel that parses an uploaded screenshot into structured data via Claude's vision API. Image import needs `ANTHROPIC_API_KEY` set (the one feature in this project that makes a network call — everything else stays fully offline); verified it fails with a clear message rather than crashing when the key is absent, and that every other tool is unaffected either way. No flat mob icons exist in the game's assets (mobs use animated sprite sheets, not single icons) — skipped for now.
- [x] Searchable comboboxes — weapon and mob/encounter dropdowns are now type-to-filter (e.g. typing "Axe" or "Frost"), results keep their natural sort (tier for weapons, level for mobs — mob labels now show `[level]` prefixed, e.g. "[12] Frost Giant")
- [x] Map task builder (`/api/map`, `/api/queue/evaluate`, the Map panel) — a minimalist clickable map of all 60 banks. Hover a bank for a cascading menu (Skill → Node → Tier, or Combat → mob) built from real `nodes.json` positions; clicking adds to a drag-and-drop-reorderable queue with editable quantities. Travel between queue entries is computed from the *exact* node you picked (chained bank-to-bank, matching whatever order the queue is in) — this replaces needing to manually type a route-distance override, since the distance is now correct by construction. Routes are drawn on the map color-coded by distance (green→red), turn purple with a checkmark when a teleport crystal would trigger, animate with a flowing dash to show direction, and the player's current bank is marked with a pulsing dot. Fixed a real CSS bug along the way: pure `:hover` dropdown chains have a dead zone wherever the menu doesn't sit flush against its trigger (true here for the bank→menu gap specifically), so hover state is now driven by JS with a grace-period timer instead, which also makes every nested submenu level more robust, not just the top one.
- [x] Type-specific map icons — every node (not just banks) is now plotted using the game's own real icons: banks get `chest.png`, skill nodes get their actual skill icon (fish/pickaxe/etc.), combat nodes get `combat.png`, raid/gauntlet nodes get their own icons too. 507 nodes total, all loading cleanly. Combat nodes are directly clickable (adds straight to the queue, no need to go through a bank's hover menu for those).
- [x] Enemy node hover + tier coloring — replaced the unreliable native `title` tooltip with a proper styled tooltip (name, tier, slay level, category) shared across all 507 nodes. Combat icons are now colored by tier (gray→red, feeble→chaos) using the game's own `MOB_TIER_WORDS` ordering from `Constants.js`, not a guessed scheme. Verified all 6 tiers present and the tooltip correctly shows/hides.
- [ ] Unified "what's next" recommender

## Usage

```bash
node src/data.js      # smoke test — prints a sanity summary of loaded data
node src/server.js    # dashboard — open http://localhost:4100
```
