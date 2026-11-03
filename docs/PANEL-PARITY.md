# Panel parity: what the game's original panels offer versus ScapeLite's counterparts

Audit of 2026-10-27, prompted by the report "the reroll feature on the Barter panel is gone, are there other features we are missing?". It replaces the guess in `docs/FEATURE-GAPS.md` (2026-10-21), which missed the Barter controls completely and is partly out of date (many of its gaps were closed in the 0.4.0 work, see the status column here).

**Method.** Live game over CDP (client `app/game.74703fe3dc0c.js`). For every original panel the hidden-but-present DOM was enumerated for anything interactive or informative (buttons, inputs, `cursor:pointer` elements, draggable images, elements with a tooltip), then the game's render and listener code was read for what the DOM does not show: conditional controls (a Buy button exists only on slots that are "buy", a Charm button only after the Trader's Charm is unlocked, a "consumed" overlay only when all charges are spent), delegated click handlers and right-click or double-click handlers. Our counterpart was then compared element by element (`overlay/ui-bar.js`, `ui-queue.js`, `chat-plus.js`, `alert-bell.js`). Nothing was changed in the game while auditing; test clicks were stubbed (see "How it was verified").

**Legend.** Ours: **yes** / **partial** / **no**. Effort: S under a day, M a few days, L a week or more. Risk (ScapeLite never acts on its own):
- **D** pure display (read the game, draw our own).
- **N** navigation: opens a game window or moves the camera; no game state changes.
- **F** forwards the user's own click to the game's own control. Only as the direct result of the user's click on OUR element (checked with `isTrusted`), the game's own disabled state, cost and confirmation apply, nothing is sent automatically.
- **W** would write on its own: do not build; leave it in the game.

---

## 1. Barter (Game Barter Panel `#barter-panel` versus Barter Card)

What the original really has (read from the DOM and the game's `BarterPanel` code): a header with the gold figure and the charges figure (each with a tooltip), a **Reroll button** (disabled when the Barter level is too low or the credits are under the cost; no confirmation dialog), six slot rows (RES / EQP, locked until Barter level 40 / 50 / 70 / 80), per active slot: icon with item tooltip and tier label, price, price modifier (green or red), an **amount slider** (1 to the charges left), **Buy** (slots that "buy") or **Sell** (slots that "sell"), a **Charm** button (only when the Trader's Charm is unlocked; one per roll), and an "All charges used. Panel XP paid." overlay with the reroll hint. Buy, Sell, Charm and Reroll send `barter_buy`, `barter_sell`, `barter_charm`, `barter_reroll` straight away: **the game shows no confirmation dialog for any of them**, so none is forwarded or invented here.

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| **Reroll button** (↻) | Spends the reroll cost in credits (10) and rolls a new shop; tooltip "Reroll (10 barter reroll credits)", credits available, credits earned per task | **yes (new)**: "↻ Reroll · 10 credits" button, greyed when the game greys its own, tooltip = the game's | S | F |
| **Buy / Sell** per slot | Buys or sells the shown quantity for the shown price, spends charges; tooltip "Buy 5 X for N gold / Spends 5 of 185 charges" | **yes (new)**: button on every slot with the same label, disabled state and live tooltip | S | F |
| **Charm** per slot | Rerolls the price modifier of that slot (once per roll); only shown with the Trader's Charm | **yes (new)**: shown only when the game shows it; disabled like the game's | S | F |
| **Charm: what it is and why it looked dead** | The game’s Charm is a per-slot button (`barter_charm` with the slot index) that only exists once the Trader’s Charm is unlocked. It is enabled only when no slot has been charmed in this roll (one charm per roll) and charges are left; after a charm the button turns invisible on every slot. It re-rolls that slot’s price modifier from the other range (a Buy slot flips to Sell and the other way round, so the Buy / Sell button and the % change). No confirmation dialog. | **fixed (new)**: the forward itself was correct (a trusted click on our Charm sends one click to `.barter-charm-btn` of that slot, verified with stubs). What made it feel dead: the game answers a second or two later and the card was not redrawn while the pointer rested on it, so it kept showing the old Charm button and old modifier. The card now follows the game while the pointer is only on a row (still not under a button or slider) and re-reads for six seconds after every Reroll, Buy, Sell or Charm click | S | F |
| **Amount slider** | Sets the quantity (1 to charges left) and updates the price and tooltips | **yes (new)**: our slider sets the game's slider and lets the game's own handler update price and tooltips; label shows "×N = price gold" | S | F |
| "All charges used" overlay | Blocks the panel until a reroll | **yes (new)**: the same two lines under the Reroll button, plus "No charges left"; every row of the card is greyed out (the Info Bar's Barter button reads "No charges" in grey) until charges are back | S | D |
| Gold figure and tooltip (bank / inventory split, BUY and SELL ranges, Barter Pool Access per tier) | Hover | yes (0.4.0 `uiBarterInfo`) | - | D |
| Charges figure and tooltip | Hover | yes (0.4.0) | - | D |
| Credits and charges note | Tooltips | yes (card note: "N charges left, N rerolls") | - | D |
| Item **tier** (T1..T5 label on the icon, `[T3]` in the name and tooltip) | White "T3" badge bottom left of the icon; tooltip name carries the tier | **yes (new, 0.4.0)**: the card showed none for potions and food because their label is `.inv-label` not `.inv-tier-label`; now badge on the icon, `[T3]` in the name, the item's own tooltip on hover | S | D |
| Item tooltip (equipment stat table, quantity) | Hover on the slot icon | **yes (new)**: hover on the row | S | D |
| RES / EQP slot type | Label with tooltip, locked tooltip "Locked: Level 40 Barter required" | partial: "Resource" / "Equipment" text, "Lv 40 needed" on locked rows | - | D |
| Price modifier colour | Green good, red bad (thresholds depend on buy or sell) | yes | - | D |
| Gold held in the bank (`Qty`) | Item slot count | yes ("you hold N") | - | D |
| Pool refresh countdown | **None exists**: the shop changes only on a reroll ("Refreshes on the next reroll") | n/a | - | - |

Remaining: the game's own sounds and slot animation (cosmetic, not needed).

---

## 2. Skills (Game Skills Panel `#skills-panel` versus Skills Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| Skill cell: level, progress bar | Level number, XP progress fill, cape phase colours (trimmed, done) | yes (green extension for what your queue adds; cape phase colour via `data-cc-g`) | - | D |
| Skill cell tooltip | Level, XP / next, XP to next level, **Effective level** (only refreshed on mouse enter) | partial: copies the game's tooltip; the Effective line is only as fresh as the game's last hover on the hidden cell | S | D |
| Click a cell | Opens the Skills Customization window for the skill; Delve / Fortify open the tree windows; Alms opens the Alms window | yes (0.4.0 `uiSkillCellClick`) | - | N/F |
| **Total Level cell click** | Opens the Skills Customization window for all skills (`xe.open(null)`) | **yes (new)**: the Total Level cell is clickable | S | N/F |
| Total XP cell (second total cell, `totalXPCell`) | Optional second cell | no (the game does not build it in the standard layout; seen as null) | - | - |

## 3. Inventory (Game Inventory Panel `#bag-panel` versus Inventory Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| Slots with tooltip, quantity badge (k / M tiers) | Display only: no click, right-click or drag handlers (code read) | yes | - | D |
| Tier label | `inv-tier-label` (gear, materials) or `inv-label` (potions, food) | **fixed (new)**: the card read only `inv-tier-label`, so potions and cooked food showed no tier; now both | S | D |
| Overflow slots (bag grows beyond the base size) | Extra slots offset to the side | yes (shown as ordinary slots; used / total in the note) | - | D |
| Item `UNF` label for unfinished potions | `inv-label` "UNF" | yes (now through the same label read) | - | D |

## 4. Equipment (Game Equipment Panel `#equipment-panel` versus Equipment Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| Paper doll slots, silhouettes, tier labels, tooltips | Display only | yes | - | D |
| Loadout family buttons (Melee / Ranged / Magic ...) and slot buttons | Click selects the equipped loadout (`set_equipped_loadout`) | yes (chip plus menu, forwards the user's click) | - | F |
| **Loadout rename** (double-click a slot) | Inline rename, sends `rename_loadout` | no | M | F (do last) |
| Stats view toggle (combat icon) | Switches between paper doll and stats table | n/a (our card shows both) | - | - |
| Stats table, style, speed, max hit | Stats view | yes (plus DPS chip) | - | D |
| Weapon line ("Weapon: [T5] ...") | Stats view | partial: the weapon is in the paper doll, no text line | S | D |
| **Potion Boosts ON/OFF** switch | Click toggles whether active potions count in the stats table (client preference) | **yes (new)**: button "Potion boosts: ON/OFF" | S | F |
| **Spirit Modifier ON/OFF** switch | Same for the spirit modifier | **yes (new)** | S | F |
| Extended Combat Calculator launcher | Opens the wiki calculator | yes (corner button) | - | N |
| Compare toggle (`equip-compare-toggle-wrap`) | Only exists in the bank / smith windows | n/a | - | - |

## 5. Quests (Game Quests Panel versus Quests Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| Active / List toggle | Switches the panel | yes (0.4.0 `uiQuestsList`) | - | F |
| Active quest slot: name, step, hint with icon, progress, tooltip | Click opens the quest window | yes (name, step, hint, bar, tooltip, click) | - | N/F |
| Free slots ("- Empty -") | Count of free slots | yes (note) | - | D |
| "Complete!" claim state | Slot shows a claim state | yes (green row, "claim your reward"; the claim itself stays in the game) | - | D |
| Rewards (XP per skill, items, credits) | In the slot | partial: only in the hover card | S | D |
| List rows colour by status, click opens quest | List mode | yes | - | N/F |
| Quest dots / unlock requirements text | List header count | yes (header text) | - | D |

## 6. Diary (Game Diary Panel versus Diary Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| All-diaries bar and count | Header bar | yes | - | D |
| 60 bank rows: name, count, bar with 20/40/60/80% notches, tier badge, free weight text | Rows | yes (name, count, bar, tier text; notches not drawn) | S | D |
| Sort toggles (Sort: Tier/Skill, Banks: A-Z/%) | Header chips | partial: our own Progress / A-Z / Game order (equivalent for banks; the Tier/Skill step sort has no meaning without step rows) | - | D |
| **Click a row to expand its steps** (every step with a done mark) | Delegated click toggles `_expanded[bank]`, builds the step list | no | M | F (UI state only) |
| **Click the title to open Unlocks > Diary** | `_openInModal` | **yes (new)**: click the "All diaries" row | S | N |
| Info tooltip (what a diary is, the 20..100% notches) | Hover on the header | **yes (new)**: hover on the "All diaries" row | S | D |

## 7. Friends (Game Friends Panel versus Friends Card)

| Control or info | Original behaviour | Ours | Effort | Risk |
|---|---|---|---|---|
| Friends / Clan / Muted tabs | Toggle bar | yes | - | D |
| Add friend (+ box, Enter sends `friend_add`) | Header | yes (forwards the typed name to the game's box) | - | F |
| Row: name, activity icon and text, online colour | Rows | yes | - | D |
| Right-click row = player menu | `nn.show` | yes (0.4.0 `uiPlayerMenu`) | - | F |
| **Click an online friend / clan member = camera pans to them; click yourself = recenter** | `_panToPlayer` / `_recenterCamera` | **partial (new)**: Friends tab only (the game only builds the rows of the tab it shows); clan rows and the self row not done | S | N |
| World tag ("· W12" when the friend is on another world) | `.friend-row-world` | no | S | D |
| Clan header details (name, rank, attack toggle, invites) | Clan window | no (members only) | M | D |
| Muted row unmute button | Row | via the right-click menu | - | F |

## 8. Task queue (Game Tasks Panel `#unified-queue-panel` versus Queue Panel `ui-queue.js`)

Reviewed against the DOM (`uq-*` classes: reroll, skip, option tiles, master tiles, lane toggle, Auto Loadout toggle, slay/skill switch, credits, pin / compact / collapse buttons) and `FEATURE-GAPS.md` section A, with the closing commits checked in code.

| Control or info | Original | Ours | Effort | Risk |
|---|---|---|---|---|
| Reroll, skip, option swap, drag reorder, NEW TASKS insert, lane switch, master picker incl. locked tiers, credits tooltip, walking pills, markers (quest, lucky, boost, diary, teleport), material shortage | yes | yes | - | F |
| Queued Combat / Skilling dividers with cancel | yes | yes (0.4.0) | - | F |
| Click a row / Ctrl-click an option = map pan | yes | yes (`uiQueueClickMap`) | - | N |
| Right-click Auto Loadout = combat defaults; right-click a fight = combat calculator | yes | yes (`uiQueueRightClick`) | - | F |
| Hover a task or option = route preview drawn on the World Map (`setRoutePreview`) | yes | yes (0.4.0, `uiQueueMapPreview`): the hover is passed to the game's matching tile, the game draws the route; only while the World Map window is open | - | N |
| Pin / compact / collapse-to-icons buttons | yes | n/a (our own fold and size model) | - | - |

## 9. Current task (Game Current Task Panel `#task-display`) and Info HUD (`.ingame-hud`)

| Control or info | Original | Ours | Effort | Risk |
|---|---|---|---|---|
| Task name, node, progress bar and text | yes | yes (Task module, Current card) | - | D |
| Level bar (Lv 48, 94%, Lv 49) | yes | yes (Task module option "level bar", Current card) | - | D |
| Combat rows (loadout, training skill, kills), Auto Loadout pill | yes | yes (Task module text and queue card; pill via the queue's Auto chip) | - | D/F |
| Raid lobby blurb (difficulty, role, members) | yes | no (`raid-alert.js` is opt-in and only notifies) | M | D |
| Players online with per-platform tooltip | yes | yes (Players online module) | - | D |
| **Offline hours ("32h") with the tier tooltip** | yes, top right | **yes (new)**: Info Bar module "Offline hours" with the game's tiers as hover card | S | D |
| **World name and world switcher** | click opens the world list | **yes (new)**: Info Bar module "World"; the click is forwarded to the game's own name, the list is the game's | S | N |
| Free-to-play flag | yes | no (shown nowhere) | S | D |
| Holiday event row (boost, total found, tooltip) | yes | partial (Game event module: days left, name; no boost or total) | S | D |

## 10. Chat (Game Chat Panel versus Chat Panel `chat-plus.js`)

| Control or info | Original | Ours | Effort | Risk |
|---|---|---|---|---|
| Channel buttons: solo, Shift-click toggle, minimise when clicked again | six buttons | yes (tabs with unread) | - | D |
| Right-click channel = per-type filter menu | yes | yes (19 message types, 0.4.0) | - | D |
| Font A- / A+ , reset size (right-click toggle) | yes | yes (text size slider) | - | D |
| Collapse toggle | yes | yes (panel fold) | - | D |
| Channel label click / **Tab cycles the send channel** | yes | yes (0.4.0: Tab in our message box steps to the next send channel; switch Plugins > Panels > Chat: Tab Changes Send Channel) | - | D |
| Chat language / world picker | yes | yes (0.4.0, the game's list in our menu) | - | F |
| Sender name right-click = player menu | yes | yes | - | F |
| World tag ("W3") on global lines | yes | yes (0.4.0, chat panel and Chat card; switch Chat: World Tag) | - | D |
| Staff crown, badges, game icons, timestamps | yes | yes (options; the Chat card shows crown and badges too since 0.4.0) | - | D |
| Chat-rules dialog on first focus | yes | yes (0.4.0: the game's own gate still opens its dialog on Enter; our box says so and focuses the game's box) | - | N |
| Clickable links | none found in the game's chat code (plain text) | yes, extra (0.4.0: http and https only, new tab, Chat panel and card; switch Chat: Clickable Links) | - | D |
| Profanity filter | game setting | n/a (applies to the game's text before we copy it) | - | - |

## 11. Info Bar modules, alert bell, potions

| Original surface | Ours | Status |
|---|---|---|
| Game Active Potions Panel: rows, tooltips, right-click filter menu, food and auto-eat settings | Active potions module (rows, hover card per category, and a second card per food or potion with the exact numbers: food heal formula, potion stats, charges and efficiency), "Food, potion filters and auto-eat (the game's own menu)" entry | yes; collapsed pill not mirrored; tiers show in the hover card but not on the module icons (partial) |
| Game HP Bar | Hit points module | yes; the game's click "hide all docked panels" not mirrored |
| Game Info HUD | Players online, Offline hours (new), World (new), Game event | see section 9 |
| Window Controls (Thanks, Map, Patch notes, Fullscreen, Sleep, Logout ...) | Alert "Thanks for playing", Window buttons module (map and windows) | partial: Patch notes, Fullscreen not mirrored on purpose (Sleep and Logout never forwarded) |
| Game Invite Tray / Task popup / Dashboard toast | Notification dock keeps them on top; no content alert | no (alert kind "Invites" is an idea) |
| Left icon strip | Window buttons module | yes |
| Panel hotkeys | hotkeys open our counterparts (0.4.0) | yes |

---

## 12. Prioritised gaps (what is still open)

1. **Item tier everywhere an item is shown** (P1, S, D). Done for Barter, Inventory, Equipment. Still without a badge: Active Potions module icons, bank-like clones in tooltips (they already carry the game's own tier text).
2. **Diary step list** (expand a bank to see which steps are missing) (P2, M, F UI-state only).
3. **Friends: click clan members and yourself, world tag** (P3, S, N/D).
4. ~~Chat: Tab to cycle the send channel, world tag, links, rules dialog~~ done in 0.4.0.
5. **Queue: hover route preview on the World Map** (P3, M, D).
6. **Loadout rename** (P3, M, F, rename is an account change: confirm by user in the game's own box).
7. **Equipment weapon line, diary notches, holiday boost and free-to-play on the HUD, raid lobby blurb** (P3, S each, D).
8. **Invite tray content as an alert** (P2, M, D).
9. **Quest reward line on the card** (P3, S, D).

Deliberately not built (would write on its own): quest start or claim, diary claims, Sleep, Logout, auto-eat sliders and per-food switches, cancel queued tasks other than through the user's click on our cross (already a user-click forward), friend and clan moderation entries except through the game's own menu.

## 13. How it was verified (stubs)

- `HTMLElement.prototype.click` and `EventTarget.prototype.dispatchEvent` were stubbed for the game's elements (and restored, checked) so nothing reached the game. Barter: a real pointer click (CDP `Input.dispatchMouseEvent`, so `isTrusted`) on our Reroll button forwarded exactly one click to `.barter-reroll-btn`; a synthetic click on our button forwarded nothing; a click on a greyed button forwarded nothing; the hover card shows the game's reroll tooltip.
- Skills total cell, Diary title, Friends row: forwards observed as one `.total-cell`, `.diary-title`, `.friend-row` click each. Offline and World modules rendered with live data. Tier badges on Barter rows and Inventory cells observed in the DOM and in a screenshot.
- **Not tested with live game state:** Buy / Sell / Charm and the amount slider with enabled game buttons (the shop had 0 charges or the game greyed them; they use the same `press()` path as Reroll), the Equipment card's two switches (buttons rendered with the right ON/OFF state, no click sent), opening the game's world list from the World module.
