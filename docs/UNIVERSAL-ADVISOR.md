# Universal Advisor: one panel that says what to do, how, and where

Status (2026-10-29): phases 1 to 4 built, phase 5 started, phase 6 open. **Correction from the owner, same day: the diary is gained passively and is never advised. The Diary and Credits panel became "Locations and Free Pips" (where to spend the diary's free node-lever pips, rated by walking distance), and the Advisor suggests location-lever placements instead of diary tier-ups.** Roadmap items `adv-022` (this) and `adv-002` (phase 1). Sections 4, 5, 7 and 8 were revised when the code was written: where this text and `overlay/advisor-core.js` disagree, the code and its tests (`npm run test:advisor`) are right.

## 1. Why

ScapeLite already has several advisors. Each answers one question in its own window: the Route Advisor orders the queue, the Lever Advisor says which levers to pull, the Tree Advisor plans trees, Goals shows time to targets, Drop Luck says how lucky you were, and the diary, credits and free node-lever pips had no home at all. The player has to open five windows, compare units (levels an hour, XP an hour, drops an hour, credits), and decide alone.

The Universal Advisor is the one place that says: **do this next, this is how, this is where, this is what you get.** It does not replace the other advisors. It reads their results through their public getters, turns each into the same kind of "action", ranks the actions, and shows the best few. The other windows stay as the place to look at the detail.

### User stories

1. *I sit down and have no idea what to do.* I open the panel and see one top action with what, how, where and what it gives me.
2. *I have free pips and credits.* The panel tells me where the free diary pips do the most good (which locations walk me far from a bank, which are close), what a pip costs otherwise, and says so plainly when the right answer is "keep them". The diary itself fills up while I play; I never choose a task for it.
3. *I am chasing a drop, a pet or a level.* The panel says what the goal costs in time, and what to change.
4. *I do not trust a number.* Every action has a "why" with the inputs, and a confidence label that says how sure the model is.
5. *I just want to play.* The panel never opens by itself and never presses anything.

## 2. What / How / Where

Every action answers three questions in the same order:

| Question | Contents | Example (free pips) |
|---|---|---|
| **What** | One verb and one object, plus the gain | "Place free pips on Mine locations: set Highroot Trail to -1 and 17 more (about 0.5 s less walking per task)" |
| **How** | The steps, in order, as text. Which windows and buttons. | "Open Skills Customization, pick Mine, then its locations; set Highroot Trail from 0 to -1 (2159 steps from its bank, rated bad), free" |
| **Where** | Place names (and, for a trip, the walk from where you stand: the game's own path distance and your real speed) | "Highroot Trail" |

A fourth line, **Gain / Cost / Sureness**, uses the lanes in section 4.

## 3. Sources: who owns which number

Rule: the Universal Advisor never recomputes what another module already owns. It asks, converts the unit, and says where the number came from. If a number is missing it shows nothing for that action instead of guessing.

| Number | Owner (file, getter) | Notes |
|---|---|---|
| Task times, XP, XP an hour, walking, teleports, queue order | Route Advisor (`overlay/route-advisor.js`, `window.__ccRouteAdvisor.result`), Game Data Bridge (`project()`, `dist`, `remain`, `speed`) | Model: `docs/ROUTE-ADVISOR-MODEL.md`. Value is levels, not XP. |
| Lever positions, credit costs, the worth of a lever change | Lever Advisor (`overlay/lever-advisor.js`, `__ccLeverAdvisor.last / debug`) | Reads the lever window, so it only answers while that window is open. |
| Free pips (diary tier of the nearest bank), credit prices and pools, node-to-bank distances, how often each location is rolled and used | Locations and Free Pips core (`overlay/diary-credits-core.js`, `__ccDiaryCore.build().loc`) fed by `__ccBridge.diaryState()` (game path distances, the Lever Advisor's own odds, the last 200 tasks) | Phase 1. Distances and prices are the game's own; shares follow the calibrated roll model. |
| Skill targets, ETAs, unlock drops | Goals (`overlay/goals.js`, `__ccGoals.build()`) and the XP Tracker (`__ccXpTracker.rates`) | Real XP an hour, bonus already in. |
| Delve and Fortress tree builds | Tree Advisor (`__ccTreeAdvisor.plan`) | DPS priced with the game's own maths. |
| Calibration of the roll model | `docs/ROLL-MODEL-CALIBRATION.md` (`node scripts/roll-calibration.js`) | Decides what the Advisor may say (section 7). |

Each source gets a small **adapter** in `overlay/advisor-core.js` (`fromRoute`, `fromLever`, `fromLocations`, `fromGoals`, `fromTree`) that turns the owner's result into zero or more actions and never throws. The live objects are reduced to plain snapshots first (`summariseRoute`, `summariseLever`, `summariseTree`), so the shapes are tested. An adapter whose input is missing is skipped and the panel keeps working.

## 4. Ranking: lanes, one unit per lane

### The action record

```
{ id, kind, lane, what, how: [step], where: [{id, name, min?}], gain: {kind, value, text}, cost: {minutes, credits, text}, sure: A|B|C, why: [text], score, pinned? }
kind  = route | lever | location | hunt | goal | tree
lane  = now | levers | setup | hunts | build
```

### Why lanes and not one number

The first draft proposed one unit ("progress-hours") for everything. Writing the adapters showed that only a route change has an honest value in it. The others do not:

* A location lever saves walking, not XP rate, and the saving is an estimate (see section 7).
* A hunt (drop, pet) has no XP value; whether it is worth an hour is the player's call.
* A tree build is scored in the Tree Advisor's own unit (DPS or Fortress score).

Forcing these into one number would hide the guess inside a conversion factor. So **each lane ranks on its own score, and the hero comes from the first lane that has a ranked action: Now, then Levers, then Locations and free pips, then Hunts, then Build.** The order says what to do first (fix the queue, then spend credits that pay in XP, then place the free pips, then chase goals, then re-spec); it does not claim a Now action is worth more than a hunt.

| Lane | Source | Score inside the lane | Unit shown |
|---|---|---|---|
| Now | Route Advisor | its own gain (value per hour, better order against yours) | % value per hour; also hours won over the horizon |
| Levers | Lever Advisor | expected payoff gain | % rate (XP an hour), credits it costs |
| Locations and free pips | Locations and Free Pips | walking saved per average task by the skill's free plan; a plan that costs credits is class C | seconds of walking per task |
| Hunts and goals | Goals | pinned first, then fastest expected time (a tool for a skill you train gets a bonus) | hours |
| Build | Tree Advisor | build score gain | % score |

The diary itself is passive and is **never advised**: no action asks you to do a task for diary progress.

**Horizon (provisional, user to confirm):** a route gain is also shown as hours won over 24 hours of play.

### Ranking rule

1. Drop every class C action unless "Show uncertain actions" is on (Why tab).
2. Rank inside each lane (pinned first, then score, then name).
3. The hero is the first of the lane order with an action. **Stability:** the previous hero stays while it is still there, in the same lane, and its score is within 25% of the new best (no flicker). The Route Advisor already holds back its own suggestions with a margin.
4. A lever change that costs credits must gain at least 1% expected payoff, a free or refunding one at least 0.5%; under that is inside the noise of the model.

### Confidence

| Class | Meaning | Examples |
|---|---|---|
| **A** exact | The game's own formula, reproduced and tested | Free pips from a diary tier, credit prices, path distances |
| **B** measured | Checked against logged play, small error | Route gains, lever advice (rates), hunts, trees, free location-lever moves |
| **C** modelled | Not calibrated; can be well off | Location moves that cost credits |

## 5. The panel

One kit panel, `#cc-advisor` (`overlay/advisor.js`), built with `UI.panel` like Goals and the Drop Luck Tracker (tokens and classes from `docs/DESIGN-SYSTEM.md` and `docs/COMPONENTS.md`; names from `docs/UI-NAMING.md`: "Advisor Panel", "Action Card", "Sureness Chip").

```
Advisor Panel                                         [chip: the top action, shortened]
  Hero card   "Do this next"   WHAT (the title)   Gain / Cost / Sure chip   HOW (steps)   WHERE (places, minutes away)   WHY   [Open its window]
  Tabs:  Now | Levers and locations | Hunts | Build | Why
  Action rows: one line each (what, gain, cost, sure); click to open How / Where / Why
```

* **Now**: queue and route (Route Advisor).
* **Levers and locations**: two lanes under one tab. Levers first (Lever Advisor; only while the Skills Customization window is open, because that is when the Lever Advisor works), then Locations and free pips.
* **Hunts**: pinned hunts and goals, unlock drops, skill targets (Goals).
* **Build**: Delve and Fortress trees (Tree Advisor).
* **Why**: which sources were readable and how many actions each gave, what A, B and C mean, the "Show uncertain actions" switch (with how many are hidden), and the ranking rules in plain words.

The panel opens only from the ScapeLite menu (entry "Advisor"). No pop-up, no sound. It recomputes every 6 seconds while open and visible. The Locations and Free Pips panel (phase 1, plugin id `diary-credits`) stays as its own window with the full tables; the Advisor's "Open its window" button opens it.

**Info Bar module "Next action"** (off by default; add it by right-clicking a bar): shows the short text of the top action; the hover shows the gain and how sure.

## 6. How it stays display-only

* The advisor reads. It never clicks, selects, sends or changes a lever, a queue slot or a setting. "How" is text. "Open its window" only opens another ScapeLite panel.
* No new forwarded clicks. The forward lint (`npm run lint:forwards`, baseline 82) must not move.
* It sends nothing off the PC and has no webhook. It posts nothing to Discord.
* It writes only its own panel state to the UI kit store (open, position, the "show uncertain" switch).
* Nothing in the panel or its documents may suggest the developers approved it.

## 7. What is and is not suggested

The roll model was checked against the last 200 tasks and the task log on 2026-10-29 (`docs/ROLL-MODEL-CALIBRATION.md`). Its conclusions decide what the Advisor may say:

| Statement | Allowed? | Why |
|---|---|---|
| "Pull these skill or activity levers, +x% expected payoff" | **Yes, class B**, ranked by rate (XP an hour) only | Skill and activity weights fit the history (activity chi-square p = 0.54; the skill mix p = 0.025 but far better than flat); the lever base 1.25 is inside the data's 1.08 to 1.26, so the real gain may be a bit smaller (said in the action) |
| A credit-costing lever change | Yes, if it gains at least 1% | A smaller gain is inside the model's noise |
| Place free diary pips on node (location) levers to cut walking | **Yes, class B**, as walking only, never as XP rate | Node distances are the game's own path distances; the shares follow the calibrated roll model (activity first, then node, 1.25 per pip); the claimed saving is **half** the straight difference in distance to the bank, because legs inside one bank area do not pass the bank and players already pick nearer nodes than the roll offers (496 against 640 steps in the calibration); the total across all skills stays far below the measured walking overhead of about a minute a task. It changes where future tasks are rolled and says so. |
| Spend credits on location levers | Only where a credit buys visible walking (at least 0.005 s per task per credit), class C | A pip beyond the free ones costs 5, 10, 20 ... credits and buys little |
| Choose or chase a task for diary progress | **Never** | The owner never picks a task for the diary; it is gained passively |
| Slay totals and ETAs | Only with a caveat | Since 22 October a slay task's XP and time per task are about 1.5 times the model (adv-025); rates are right, so lever advice for slay (a rate) is fine and says so |
| Plan times | With a caveat | Walking takes about a minute more per task than the model (the same for every order, so the ranking holds) |
| Mixing a hunt into the XP ranking | No | A drop has no XP value; hunts stay in their own lane |
| The chance of a lucky task | Not modelled | Cannot be measured from completed tasks |
| Anything that needs a game click | Never | Display-only |

## 8. Phases

| Phase | What | Size | State |
|---|---|---|---|
| **1. Locations and Free Pips panel** (adv-002) | `diary-credits-core.js`, `diary-credits.js`, bridge `diaryState()`, `npm run test:diary`. First built as a diary tier-up shopping list; reworked the same day to location quality and free-pip placement | M | **Built** |
| **2. Advisor core** | `overlay/advisor-core.js` (pure): the action record, the five adapters, the summaries of the live objects, lane ranking, hero and stability, `npm run test:advisor` | M | **Built** |
| **3. The Advisor panel** | `overlay/advisor.js`: hero card, tabs, Why, Plugins toggle, ScapeLite menu entry, catalog entry, Info Bar module "Next action" | L | **Built** |
| **4. Lever and tree adapters** | `fromLever` (class B, rate only) and `fromTree` with `summariseLever` and `summariseTree` | M | **Built** |
| **5. Calibrated credit advice** | Lever advice within the calibration (section 7). Open: free pip placement for node levers, and a recorder of what the queue *offered* (calibration recommendation 4) that would let the roll chance itself be tested | L | Lever advice built; the rest open |
| 6. Learning loop | The Task Log compares what the advisor predicted with what happened after you followed it, and shows the error per source. Includes the fixed per-task overhead (about 60 s) if it is added to the Route Advisor | M | Open |

## 9. Risks

* **Two numbers for one thing.** If an adapter recomputes a source's number it will drift. Mitigation: adapters only convert units and read the owner's own result; the summaries are tested against the real object shapes.
* **A wrong ranking costs trust.** Confidence classes, "show uncertain" off by default, the Why tab, and a minimum gain for lever advice.
* **Stale advice.** The Lever Advisor only works while its window is open; its last answer is ignored otherwise.
* **Information overload.** One hero card, a few rows per tab, everything else behind a click.
* **Game updates change the data.** The bridge getters are small and tested against a stub; a failed read hides the action instead of showing a wrong one.
* **Performance.** The panel computes only while open and visible, every 6 seconds (the same rule as Goals); the Info Bar module is cached for 5 seconds.
* **The diary data loads late.** `diaryState()` returns null until the game has loaded it; the panel fills in when it appears.

## 10. Test plan

* Pure cores run in Node on hand-made cases and on trimmed real states in `scripts/fixtures/`: `npm run test:diary` (diary arithmetic and the bridge getter against a stub) and `npm run test:advisor` (adapters, summaries, lanes, hero, stability).
* Live: `npm run test:cards` (the card harness must keep passing), `npm run lint:forwards` (no new forwards), `npm run test:package`.
* A live DOM check of the panel (hero, tabs, expanded rows) without screenshots.

## 11. Defaults (provisional, user to confirm)

These were chosen so work could go on while the owner is away. Each is one value in the code and can be changed without a redesign.

1. **Planning horizon:** 24 hours of play (`HORIZON_H` in `advisor-core.js`), used only to show a route gain as hours won.
2. **Hunts:** in their own lane, never mixed into the XP ranking. A pinned hunt leads its lane.
3. **Locations and Free Pips stays its own panel** and feeds the "Locations and free pips" lane of the Advisor.
4. **Info Bar module "Next action":** off by default.
5. **Names:** "Advisor Panel", "Action Card" (the hero card and the rows), "Sureness Chip" (the A, B, C pill). Final names for the Design Lab and `docs/UI-NAMING.md` are still to confirm.
6. **Hero order:** Now, Levers, Locations and free pips, Hunts, Build.
7. **Show uncertain actions:** off. Class C actions are hidden and counted on the Why tab.
