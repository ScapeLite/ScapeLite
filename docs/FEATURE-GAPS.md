# Feature gaps: what the game's own UI offers that ScapeLite does not re-present yet

Research only (no product code changed). Question: if a user hides the game's original panels and uses ScapeLite's Queue Panel, Chat Panel, Info Bars and Pinned Cards instead, what do they lose?

**Method (2026-10-21).** Live game over CDP (page `play.scapewatch.com`, client `app/game.74703fe3dc0c.js`, read-only): DOM of each original panel/window dumped and diffed against our counterpart; the game's own client code read for handlers the DOM does not show (click, right-click, Ctrl-click, hotkeys, hidden menus); our files read for the matching handler. Names are the ones in `docs/UI-NAMING.md`; where the game element has no name yet the table proposes one in *italics*. Nothing was clicked in the game, no setting changed; windows were opened only through their navigation tab and closed again; no panel was moved; `cc-panel-fuse` untouched.

**Risk column** (ScapeLite must stay display-only):
- **D** = pure display (read the game, draw our own).
- **N** = navigation only: opens a game window, moves the map camera or toggles a game panel; no game state changes.
- **F** = forwards the user's own click to the game's element, like the queue's reroll and option tiles already do (`ui-queue.js` `doReroll`, `selectOption`). Allowed by today's rules only because it is the user's trusted click; flag it in review.
- **W** = would write to the game on our own: **do not build**, point the user at the game's control instead.

Effort: S = under a day, M = a few days, L = a week or more. Priority: P1 = a hidden-original user loses it daily, P2 = weekly, P3 = rare or cosmetic.

---

## 1. Gaps by area

### A. Task queue (Game Tasks Panel `#unified-queue-panel` versus Queue Panel `#cc-queue`)

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| A1 | **"Combat Queued" / "Skilling Queued" divider is not shown** (a combat or skilling task that waits for the current one, with its cancel cross, hover tooltip, click = jump to the task) | Game Tasks Panel > *Queued Divider* (`.combat-queued-divider`, `.skilling-queued-divider`, `.cqd-label`, `.cqd-cancel` "Cancel queued combat/skilling") | Nothing: no reference to `queuedCombat` / `queuedSkilling` / `cqd` in any `overlay/*.js`. With the original hidden the user cannot see that a task is queued. | M | D to show, **W** to cancel | Read the divider from the game's rows (DOM: label + tooltip) or add `queuedCombat`/`queuedSkilling` to the bridge `project()`; draw a Queue Panel > Walking Gap-like divider with the same text. Cancel: no button, tooltip says "cancel in the game's Tasks panel". | P1 |
| A2 | **Click a task = pan the World Map camera to it; Ctrl-click an option does the same; right-click a slay task = open the Mob Selection window for it** | Game Tasks Panel > Row (`.uq-row`, click handler `o.panToNode`), option `.icon-option` Ctrl-click, `.uq-current` contextmenu `_openMobSelection` | `wire()` in `ui-queue.js` (L906) handles only mouseover/pointerdown (drag). No click, no contextmenu, no Ctrl-click. | S | N | Add `click` on `.cc-q-row` (not on tiles/odds) that calls `panToNode` through the bridge (it already reaches the game object `o`); `contextmenu` on slay rows opens the `mobs` tab and selects the task. | P2 |
| A3 | **Auto Loadout: right-click opens the combat defaults dialog** | Game Tasks Panel > `.uq-toggle` "Auto Loadout" (contextmenu -> `openCombatDefaults()`); also the pill in the Game Current Task Panel (`.float-toggle-pill`) | Queue Panel > Controls Bar > Auto Chip (`.cc-q-au`) only toggles; its own tooltip says "Right-click the game's own button for its settings" (`ui-queue.js` L691) | S | N/F | Forward a `contextmenu` event to the game's `.uq-toggle` the same way `ctlClick()` forwards the click (trusted-event guard included). | P2 |
| A4 | **Hover a task/option = route preview drawn on the World Map** | Game Tasks Panel > Row / `.icon-option` mouseenter -> `De.setRoutePreview('skilling', slot, option)` / `clearRoutePreview` | Queue Options Tray tiles and Cards never trigger it (`map-routes.js` only restyles the map's lanes) | M | D (UI-only call) | Bridge helper that calls the same two functions on tile enter/leave, behind a setting. | P3 |
| A5 | Pop-outs pinned, compact rows, "collapse to icons" | `.queue-pin-btn`, `.queue-compact-btn`, `.queue-collapse-btn` | Not applicable: our Queue Panel has its own fold/size model | - | - | None. Listed so nobody reports it again. | - |

Already at parity (checked live, 7 game rows = 7 of ours): lane switch, slayer master picker incl. locked tiers, credits tooltip, reroll and skip (forwarded, `rowsFresh()` guard), option swap, drag reorder, NEW TASKS insert bar (`.uq-insert`), walking pills, route total steps, quest/lucky/boost/diary/teleport markers, material shortage.

### B. Current task and the "Info" HUD (Game Current Task Panel `#task-display`, `.ingame-hud`)

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| B1 | **Level bar of the skill being trained** ("Lv 48 94% Lv 49"; for combat the accuracy or strength skill of the style) | Game Current Task Panel > level bar (`levelBarLeft/Center/Right`) | Info Bar > Task Module shows `activity done/total · time left` only; Queue Panel > Card [Current] shows `39 / 173 · 5,968 XP`. No level or % to next level anywhere except the Skills card. | S | D | New option "Show level progress" on the Task Module and a second line on the Current card; data from `bridge.live()` or the skill cell `.skill-progress-fill`. | P1 |
| B2 | **Combat info row: Loadout name, "Training: <skill>", kill count ("Kills: n"), Auto Loadout pill** | Game Current Task Panel > combat rows (`_combatLoadoutEl`, `_combatSkillEl`, `taskBarCenter`) | Nothing in Task Module / Current card (Equipment card shows the loadout, but only while that card is open) | S | D | Add to the Current card when `tk.type === 'combat'`; an Info Bar module "Combat" (loadout + training + kills). | P2 |
| B3 | **Raid lobby blurb** (difficulty, your role/loadout icon, member count while you sit in a lobby) | Game Current Task Panel > `refreshRaidBlurb` (`.float-raid-lobby-*`) | `raid-alert.js` is disabled by default and only notifies; Raids window is the only place | M | D | Info Bar module or Queue Panel head row from `bridge.lobby()` (already exists). | P3 |
| B4 | **Players online count with the per-platform tooltip** (4,743 Online; Steam / Web) | Game Info HUD (`.ingame-hud-online-total`, tooltip `.tt-pop-row`) | None (`bridge` has friends' online flags only) | S | D | Info Bar module "Online"; read the three numbers from the `.ingame-hud-online-total` DOM. | P3 |
| B5 | Free-to-play flag | `.ingame-hud-f2p` | None | S | D | Part of B4's tooltip. | P3 |

### C. Chat (Game Chat Panel `.chat-panel` versus Chat Panel `#cc-chat`)

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| C1 | **Player context menu** (right-click a name: Attack, Message, View Profile, View Clan, Add/Remove Friend, Invite to Clan, Mute/Unmute) | `.player-ctx-menu` via `nn.show()`, opened from chat names (`.chat-sender-name`), friend rows, world units | Chat Panel names, Friends card rows and clan rows have no contextmenu handler. The only DM entry is "right-click a friend in the *game*" (`chat-plus.js` L365-415). A user who hides the game's chat and friends panels cannot start a DM, mute or add anyone. | M | F (each menu entry is a game action the user picks) | On right-click, call the game's own menu at the pointer with `{playerId, playerName, clanTag}` (same arguments the game passes) so every entry and rule stays the game's. | P1 |
| C2 | **Chat language / room picker** ("EN · W1", English per world vs All worlds, other languages) | `.chat-room-pill` + `.chat-room-menu` (title "Chat language") | Reads the label (`roomLabel`, `chat-plus.js` L137) but cannot change it | S | F | Chip in the composer row that forwards a click to `.chat-room-pill` then to the chosen `.chat-room-row`; or open the game's menu positioned at our chip. | P2 |
| C3 | **Per-channel message-type filters** (15 categories: Level Ups, Pets, Rare Drops, Deaths, Quests Completed, Quest Steps, Tasks Completed, Extender & Reducer, Unlocks, Collections, Corrupted Mobs, Scroll Steps, Scroll Completions, Teleports, Friend Logins, plus the Game/Clan/Nearby/Global variants) | `.chat-category-menu` (`_gameFilters`, `_clanFilters`, `_proximityFilters`, `_globalFilters`; localStorage `scapewatch_*Filters`) | `CATS` in `chat-plus.js` L18 has 9 coarser groups, applied to all channels alike; Deaths, Teleports, Corrupted mobs, Extender & Reducer, Unlocks all collapse into "Everything else" | S | D | Replace `CATS` by the game's list (read `_gameFilters` keys) and make it per channel. **Done for the per-channel part (0.4.0):** the Chat settings list "Hide message types" has an "Applies to" choice (all channels, or one channel) saved as `hideCatCh`; `CATS` already follows the game's list. | P3 |
| C4 | **Clickable links with the game's external-link confirmation** | `.chat-extlink-overlay` / `.chat-extlink-btn` | URLs show as plain text (no `http` handling in `chat-plus.js`) | S | N | Linkify, open only through the game's confirm dialog (or `window.open` after our own confirm). | P3 |
| C5 | **Chat rules acceptance dialog** (`qn.gate()`, `.chat-rules-overlay`) | Shown on first focus of the game chat input | `send()` types into the hidden game input; if rules were never accepted the user only gets "Could not send. Type it in the game chat." with no way to see the dialog | S | N | On that error, focus the game input (it opens the dialog itself). | P3 |
| C6 | World tag, staff crown link, `msgId` | `.chat-world-tag`, `.chat-staff-crown-link` | Badges shown (`badges` option); no world tag, no crown link | S | D | Optional tag. | P3 |
| C7 | Font A-/A+ and "right-click toggle resets size" | `.chat-font-group`, `.chat-toggle-btn` | Equivalent exists (Text size slider in the settings sheet) | - | - | None. | - |

Parity: channel tabs with unread, search, highlight/mute words, send channel list, DM mode (`[Name]`), history, raid/nearby split, relay of Enter to the game's own input.

### D. Social (Friends panel `#friends-panel`, Clan window)

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| D1 | Row menu on every friend/clan/muted row (Message, Remove, Invite, Unmute) | Friends panel rows -> `nn.show` | Friends card (`friendsRich`, `ui-bar.js` L205) rows are display-only and have no handler | S (after C1) | F | Same call as C1. | P1 |
| D2 | Clan tab details: clan name/tag, rank, "Include in clan attacks" toggle, clan invites | Clan window (`#tab-clan`), Friends panel Clan tab | Card lists members only (name, activity, online dot) | M | D | Header row with clan name/tag/member count from `bridge.social().clan`; leave attack toggle and invites in the Clan window (W). | P3 |

### E. Skills, Inventory, Equipment

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| E1 | **Click a skill cell = open that skill's Skills Customization (lever) window; Delve/Fortify cells open the tree windows; Alms opens the Alms window** | Game Skills Panel > `.skill-cell` click (`xe.open(skill)`, `O.switchTab('delvetree'|'fortifytree'|'alms')`) | Pinned Card grid cells (`fillCard` 'grid', `ui-bar.js` L768) have hover detail only, no click | S | N/F | Click on a skills cell forwards a click to the matching `.skill-cell[data-skill-id]` of the (hidden but present) game panel, so the game opens the right window itself. | P1 |
| E2 | Equipment: loadout **rename** (double-click) and per-slot tooltips | `.loadout-sel-slot` dblclick; `.equip-panel-paperdoll .inv-slot .tooltip` | Swap works (chip + menu, `loadout.pick`, F); item tooltips are cloned into the hover detail; rename not offered | - | **W** | Do not build rename. | - |
| E3 | Equipment stats view toggle, "Spirit Modifier: OFF/ON" toggle | `.equip-panel-view-toggle`, `.spirit-stats-toggle-wrap` (in `.equip-stats-panel`) | Stats table is always shown; spirit modifier state not shown, the toggle is not offered | S | D to show, F to toggle | Show the "Spirit modifier" state in the stats chips; keep the toggle in the game. | P3 |
| E4 | Inventory: nothing missing (the game's inventory slots are display-only: tooltip + count) | `#bag-panel .inv-slot` | Grid with tooltips, used/total, auto-fit | - | - | None. | - |

### F. Quests, Diary, Barter

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| F1 | **Free quest slots ("- Empty -" x N) and the List view** (all quests, start requirements) | Game Floating Panel [quests] > `.qp-toggle-bar` Active / List, `.quest-slot-empty` (`y.MAX_ACTIVE_QUESTS` slots) | Quests card (`questsRich`, L139) lists active quests only, skips `.quest-slot-empty`, no List | M | D | Show "n of MAX slots free" in the note; List chip that reads `o.questsData` through the bridge (Quests window has search). | P2 |
| F2 | **Quest reward block** (XP per skill with "Lv 50 -> Lv 51 + 59.3%", item list, reroll credits) and the "Complete!" claim badge | `.quest-slot` body | Only name, step text, hint and bar; rewards only inside the hover detail clone | S | D | Show first reward line under the bar; keep the claim in the game. | P3 |
| F3 | **Diary: full list with sort** (Sort: Skill / Banks: A-Z; all ~60 banks, tier badge, free node weight text) | `.diary-sort-toggles`, `.diary-row`, `.diary-tier-reward` | Diary card (`diaryRich`, L188) shows the total bar and the 6 closest banks (`slice(0, 6)`) | M | D | "Show all" scrolling list + the two sort chips (client-side, no game call). | P2 |
| F4 | **Barter header details**: price modifier ranges (BUY 88-150%, SELL 50-112%), "Barter Pool Access" (resources and equipment tiers), charges per roll, gold held, buy/sell price lines, Charm state | `.barter-title-wrap .tooltip`, `.barter-budget-wrap .tooltip`, `.barter-header-gold`, `.barter-btn-col` tooltips | Barter card (`barterRich`, L230) shows charges/rerolls note and one row per slot (name, price, hold, modifier label) | S | D (buy/sell/charm/reroll = **W**) | Add the two header tooltips as the card's hover detail and the gold figure to the note. | P3 |

### G. Food and potions (Game Active Potions Panel `.active-potions-panel`)

The original stays on screen (ScapeLite has no "hide the original" for it), so this is a loss only when the Potions Dock tucks it away. The Active Potions Module already follows the game's own filters because it reads the game's rows (`potionRows`, `ui-bar.js` L23).

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| G1 | **Auto-Eat settings**: HP threshold (default 75%), max waste (default 25%), eat cooldown; per-food eligibility (`set_food_eligibility`, `o.disabledFoods`) | Right-click menu of the panel / pill (`_showFilterMenu`, `.potions-filter-col-autoeat`) | None in any overlay file (`grep -i autoeat` = 0). The module shows food count/total healing only. | S to show | D to show, **W** to edit | Read `o.autoEatSettings` + disabled foods into the module's hover ("eats at 75% HP, wastes at most 25%"); edit stays in the game. | P2 |
| G2 | **Separate filter sets in combat and out of combat** (9 categories each), collapsed/expanded pill | `STORAGE_FILTERS_IN` / `STORAGE_FILTERS_OUT`, `.active-potions-pill` | Module has one set of `f_*` filters (all types, `ui-bar.js` L471+) that does not know about combat | S | D | Split the options in two sets keyed on `He._active` / bridge combat flag. | P3 |

### H. Navigation: hotkeys, left strip, top-right buttons, menu

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| H1 | **Panel hotkeys do not reach our counterparts.** Game binds Z Tasks, X Slay, C Skills, V Equipment, B Inventory, N Diary, `,` Quests, `.` Friends, `/` Barter, M Map (`HOTKEYS.panel`, `HOTKEYS.extras`). ScapeLite hides the original with CSS (`#ui-container > :has(> .panel-titlebar[data-panel-id=..]){display:none !important}`, `ui-bar.js` `applyHides`), so the key toggles an invisible panel. **Unverified by pressing a key** (would change panel state); read from code. | Game Panel Tab Bar hotkeys / `window.HOTKEYS` | `grep HOTKEYS overlay/*.js` finds no use; no global `keydown` in `ui-bar.js`/`ui-queue.js` opens a card or the queue | S-M | N | One capturing `keydown` listener that, for a panel that is hidden-managed, toggles our card/queue instead (`cardApi.toggle`, `__ccQueue.toggle`) and swallows the key; respect the game's key rebinding (`HOTKEYS.panel`). | P1 |
| H2 | **No way to open the game's windows without the left strip.** With `menuBarHidden` on (Settings > Panel Mod) the strip (Bank, Skill Customize, Quests, Mob Selection, PvP, Smith, Craft, Imbue, Brew, Alms, Unlocks, Collections, Diary, Delve/Fortify Tree, Raids, Clan, Hiscores, Settings, Customize, Dashboard, Ledger) is gone, and the Info Bar has no module for them: only 8 panel buttons (`PANEL_TABS`, `ui-bar.js` L290). Windows then open by hotkey only; the ScapeLite menu lives in the same strip. | Game Left Icon Strip > Button (`.floating-tab-btn[data-tab]`) | Not in any module | M | N | New Info Bar module "Window buttons" (icon row, one button per `.floating-tab-btn`, click = click the strip button, badge from the strip's own state), reusing `sidebar-tabs.js` ordering/hidden choices. | P1 |
| H3 | **Top-right buttons have no module**: Thanks for playing (free reward every 12 h), Mod Tool, Ko-fi, Discord, World Map, Patch Notes, Fullscreen, Sleep, Logout/Exit | Game Window Controls (`.window-controls .window-control-btn-*`) | Window Buttons Dock moves/tucks the row (`window-dock.js`); the Info Bar has nothing; a tucked row hides the "eligible" glow | S per button | N (Sleep, Logout: do not forward) | "Game buttons" module limited to Map, Patch notes, Fullscreen; leave Sleep/Logout out. | P2 |
| H4 | **"Thanks for playing" reward ready** is not an alert. The button gets class `thanks-eligible` (`update()` in the game); nobody reads it. Twelve alert kinds exist (`alert-bell.js` CHECKS) and none is this. | `.window-control-btn-thanks.thanks-eligible` | missing | S | D (the click that claims stays in the game) | New `addCheck({ id: 'Thanks' ... })` on that class, `tab`-less "point at" ring on the button. | P1 |
| H5 | **Game HP Bar click = hide / restore all docked panels** | Game HP Bar (`.hp-bar`, `_createHPBar` click -> `_openPanels` snapshot) | Info Bar > Hit Points Module has no click; with "Hide the game's own HP bar" the shortcut is gone | S | N | Click on the module toggles every open ScapeLite panel and the game's docked panels (snapshot/restore like the game). | P3 |
| H6 | **ScapeLite menu omits the Queue Panel and all Pinned Cards** (`ENTRIES` in `scapelite-menu.js` L13: Route Advisor, Goals, XP Tracker, Drop Luck, Tree Advisor, Info Bars, Chat, Edit Layout). The default Info Bar (`DEFAULT`, `ui-bar.js` L493) has no panel buttons either, so a new user can reach the Queue Panel only by hovering the Task module and the Pinned Cards not at all until a "Panel buttons" module is added. Also missing from the menu: Lever Advisor, HP Panel, Task Log, Walking Countdown, Material Shortage. | Game Panel Tab Bar | partial | S | D | Add "Task queue" and "Pinned cards" submenu to `ENTRIES`; add Panel buttons to the default bar or to the welcome setup. | P2 |
| H7 | **Sleep** (rest the client) vs ScapeLite Eco Mode | `.window-control-btn-sleep` | Eco Mode rests ScapeLite only when the game cannot be seen; it does not rest the game | - | - | None. Mention in docs. | - |

### I. Alerts and notifications

| # | Gap | Original UI element | Ours | Effort | Risk | Suggested approach | Pri |
|---|---|---|---|---|---|---|---|
| I1 | "Thanks" reward: see H4 | | | | | | P1 |
| I2 | **Game Invite Tray / Task Popup / Dashboard Toast content is not mirrored** (raid, party and friend invites, task-complete celebrations): Notification Dock only keeps them on top and movable (`notif-dock.js`) | `.invite-tray`, `.celebration-container`, `.dash-toast` | Raid lobby alert (opt-in, currently disabled in `plugins-config.json`) is the only invite-like alert; friend/party invites do not reach the Alert Bell | M | D | Alert kind "Invites" reading `.invite-tray` children; "Point at" ring on the tray. | P2 |
| I3 | Free quest slot / barter charges / event claim are only partly alerted (`Event`, `Quest ready` exist) | Quests and Barter panels | Barter charges and free quest slots: none | S | D | Two more `addCheck` entries, off by default. | P3 |

---

## 2. Deliberately not covered (would write to the game: keep it that way)

Barter Buy / Sell / Charm / Reroll (`.barter-btn`), Equipment loadout rename and "Save outfit", quest start/claim, "Cancel queued combat/skilling", auto-eat sliders and per-food switches, diary claims, friend/clan invites and moderation entries (only through the game's own menu, see C1), Sleep, Logout. Today's forwards (queue reroll/skip/option/drag/insert, loadout swap, add friend, quest open, Auto Loadout, lane and master, `send()` in the chat) are all user-click or Enter-key forwards, listed under Risk F: they should stay listed in `docs/PLUGINS.md` rule 1 as the known exceptions.

## 3. Broken, half-wired or inconsistent

| # | What | Where | Evidence | Severity |
|---|---|---|---|---|
| X1 | **Two dead settings are still shown**: "Search Effort" (`routeSearchPreset`) and "Custom Search Effort (plans)" (`routeSearchLimit`). Their own text says "No longer used". Nothing reads them. | `plugins-settings-ui.js` L288-289, listed again in `SECTION_OF`/`ORDER` L319/L327 | Only two of 256 settings keys have no reader (throw-away scan script, not committed; the other 49 "unread" keys are buttons or are read with a built string such as `'alert' + id`, `'combat_' + k`, or by the watcher) | Low: delete both rows |
| X2 | **Game panel hotkeys silently do nothing for hidden-managed panels** | `ui-bar.js` `applyHides` vs `window.HOTKEYS.panel` | See H1; unverified by key press | Medium |
| X3 | **Our Queue Panel depends on the game's Tasks panel DOM being present and fresh**: every action starts with `rowsFresh()` and, when stale, toasts "Open the game's Tasks panel once and try again". Cards show "Open the equipment panel once to load it." / "...barter panel..." (`equipmentRich`, `barterRich`) when the game panel was never rendered. A fresh install that never opens the originals therefore starts with empty cards. Not reproduced here (game panels existed), so it is a code-read risk. | `ui-queue.js` L129-141, `ui-bar.js` L186 and L241 | Medium |
| X4 | **Clan hiscores poll fails often**: ~110 log lines "Clan hiscores: request failed -- Error: timeout waiting for clan_hiscores_my_rank" and the per-member `hiscores_ranking` timeouts; once "no open game socket". The poll later succeeds (`watcher.log`: "polled, rank 33"), so the feature works but is noisy and slow. Seen live as the only non-plugin exception during a 20 s sweep (`ws-hook.js` L188-192 request/timeout). | `Logs/Errors/*.log`, `Logs/Watcher/*.log` | Low-Medium |
| X5 | **Menu without the main panel** (H6) and **default Info Bar without panel buttons** | `scapelite-menu.js` L13, `ui-bar.js` L493 | Low |
| X6 | **Module render errors vanish silently by design**: `refresh()` wraps every module `render` in `try { ... } catch (e) { r = null; }` (`ui-bar.js` L1053) and `renderCard()` in `try { rich = panelCard0(tab); } catch (e) { return; }` (L946). That is exactly how the 18 Oct Current-task bug (`queueRich` undefined) stayed invisible until it was reported. Nothing logs. | `ui-bar.js` | Medium: log once per module to `__ccLog` (channel Plugins), keep the swallow |
| X7 | Overlapping features with three names for "HP": Info Bar > Hit Points Module, HP Panel (`hp-panel.js`), Combat Readout; plus two ways to hide the game's HP bar (`hideOrig` and the HP Panel setting) | UI-NAMING "Three HP things" clash | Low |
| X8 | `raid-alert` is disabled in `overlay/plugins-config.json` (experimental): its settings section and the Alert Bell's raid text still appear | `plugins-config.json` | Low, intended |

### Regression sweep (what was run, result)

- Static: every `overlay/*.js` parsed; every identifier checked for a declaration in scope (a throw-away script using the acorn parser that ships inside Node, `node --expose-internals`). Result: **no undeclared names** (only browser globals such as `DOMMatrix`). Run on the file one commit before the 18 Oct fix it flags `queueRich`, so the check does catch that class.
- Live: CDP `Debugger.setPauseOnExceptions({state:'all'})` for the whole run, which also sees exceptions that are caught and swallowed, filtered to scripts named `cc-plugin-*`. Exercised: 25 s idle, every Info Bar module `render` with live data and default options (incl. `richFn` hover cards of Task, Potions, Chat, panel buttons for all 8 tabs), every Pinned Card (skills, inventory, equipment, diary, quests, friends, barter) opened and closed, XP Tracker, Goals, Drop Luck, Tree Advisor (compute), Route Advisor (open 20 s, self-check ok), Chat, Alert list, Queue `model()` / `refresh`, Material Shortage, Lever Advisor, Task Log summary, HP Panel, Raid DPS tick, 14 bridge calls, and the windows Bank, Skill Customize, Quests, Mobs, Smith, Craft, Imbue, Brew, Alms, Unlocks, Raids, Clan, Hiscores, Settings (+ our Plugins page, 48 sections), Customize, Ledger. Result: **zero swallowed exceptions inside ScapeLite code.** Only noise: the watcher's own clan-hiscores timeout (X4).
- Panels and stored UI state opened by the sweep were closed and the `cc-ui:*` localStorage keys restored.

---

## 4. Top 10 (do these first)

1. **Panel hotkeys for our counterparts** (H1): the hidden panel ignores Z/C/V/B/N... Effort S-M, risk N.
2. **"Window buttons" Info Bar module** (H2): with the strip hidden, Settings/Bank/Smith have no entry. M, N.
3. **Queued Combat / Skilling divider in the Queue Panel** (A1): a queued task is invisible today. M, D.
4. **Level bar and combat info on the Current card and Task Module** (B1, B2): the one thing the Current Task panel shows that ours does not. S, D.
5. **Player context menu from Chat names and Friends rows** (C1, D1): no way to DM, mute or add a friend from our UI. M, F.
6. **Skill cell click opens the lever / tree / Alms window** (E1). S, N/F.
7. **"Thanks for playing" alert** (H4/I1): a free reward every 12 h goes unnoticed once the top-right row is tucked. S, D.
8. **Queue row click pans the map, right-click opens Mob Selection, Auto Loadout right-click** (A2, A3). S, N.
9. **Quests free slots and List, Diary full list with sort, Barter header details** (F1, F3, F4). M, D.
10. **Log swallowed module/card render errors** (X6) and delete the two dead Search Effort settings (X1): keeps the next `queueRich` from hiding. S, D.

Next in line: chat language picker and per-channel categories (C2, C3), auto-eat readout (G1), ScapeLite menu entries for Queue and cards (H6), invite alert (I2).

## 5. Not checked

- Key presses (H1 is a code read; pressing a panel hotkey would toggle game panels).
- Hover/click behaviour of the game's own context menu and sheets (`nn.show`, `.uq-sheet` is phone-only), room menu contents beyond the code strings.
- Windows ScapeLite does not re-present at all (Collections, Unlocks, Hiscores, Dashboard, Ledger, Raids list, Clan management, Customize themes/outfits): they stay in the game by design; only reachable-ness (H2) was assessed.
- Game settings pages (themes, fonts, effects, hotkey rebinding): no ScapeLite counterpart and none needed unless Settings becomes hideable.
- Combat scene interactions (click a unit, player ctx menu on units), PvP window, loot drop zone (`.loot-drop-zone`) and XP drops (`.xp-drops-container`): not compared.
- Touch/phone layout (`qe.longPress`, phone sheets).
- Effects on a first run with the original panels never rendered (X3).
