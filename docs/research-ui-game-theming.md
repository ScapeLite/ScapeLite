# Research: restyling and re-arranging the Scapewatch UI from ScapeLite

Method: read-only. Live DOM/CSS read over port 9222 with `inject.js` (reads only), plus the game's `style.css` (621 KB), `unified-queue.css` (46 KB) and the 2.3 MB `bundle.js`. Nothing was clicked, typed or injected. Game observed at patch v1.0.3 (2026-10-06). Items marked **(spec)** are speculation.

## TL;DR

- The game already ships a **theme system**: 39 colour themes (setting "Color Theme", `localStorage scapewatch_theme`). It writes 15 colour variables plus 2 bar-fill variables as inline style on `<html>`. The live page already shows such an override (`--bg-panel:#141418`, `--text-gold:#7098d8`, ...).
- The game CSS uses `var(--...)` heavily and its own brand hex values appear only once each (in the `:root` definition). A variable override therefore reskins nearly all of the game, and it is the safest option.
- Layout changes (moving or reparenting panels) are the risky part. The game keeps JS references to panel elements, and the whole UI sits inside a CSS-zoomed `#ui-container`.
- Display-only skinning cannot send actions. Actions only happen through the game's own click handlers (`L.send(...)`, 204 distinct action names). ScapeLite must never synthesise events.

## 1. UI structure (live)

- `#game-container` holds `#game-canvas` (2020x1080 backing store, world) and `#ui-container`.
- `#ui-container` is the game's UI root. Inline style at capture: `zoom: 1.26759; width:2020px; height:1080px; left:0; top:0; --playable-center-x:50%`. The window was 2560x1369.
- Zoom is written by `UIRenderer._layout` (bundle ~435k): `container.style.zoom = scale` on every `resize`. There are three modes (`body.scale-bars | scale-fill | scale-edges`; Settings > Display > Scaling, added in v1.0.1). `body.no-scale` turns it off. The design resolution is 1920x1080.
- Body-level children besides `#game-container`: `.global-tooltip` and `.ctrl-global-tooltip` (fixed, z 99999), the tutorial overlay (z 7000) and picker (7005), and an IFRAME. All ScapeLite panels are also direct body children, `position:fixed`, unzoomed (z 1100, handles 99990). That is why `ui-scale.js` has to copy the game's scale onto them.
- Direct `#ui-container` children, with computed z-index:

| z | element |
|---|---|
| 1 | `#screen-effects` |
| 5 | `.chat-panel` (`data-panel-id=chat`) |
| 10 | `.hp-bar`, `.active-potions-pill` |
| 80 | `.ingame-hud` (`population`), tutorial checklist |
| 100 | `.floating-tab-strip` (left icon strip, 23 `.floating-tab-btn[data-tab]`; `.floating-tab-tooltip`, `.floating-tab-hotkey`), `.recenter-camera-btn` |
| 150 | `.combat-encounter` |
| 500 | `#task-display` (`taskhud`) |
| 505 | `.raid-contrib-hud` (`raiddps`), `.gauntlet-hud` (`gauntlet`), `.btn-end-combat` |
| 1000 | `.map-overlay`, `.loot-drop-zone` |
| 1101 | `.panel-tab-bar` (bottom-right menu, 8 `.panel-tab-btn`, `#toggle-<panel>` ids) |
| 1500 | `#dashboard-panel` |
| 2000 | `.modal-overlay` > `.modal-container` (1920x1080 box, flex-centred) > `.modal-tabs` + `.modal-main`; tabs `.tab-btn[data-tab]` |
| 2100-2500 | xp drops, chest and lamp overlays, `.player-ctx-menu` |
| 3000-4000 | `.login-screen`, `.loading-screen` |
| 6000-6800 | `.invite-tray`, `.celebration-container`, `.steam-prompt-overlay` |
| 9998 / 99999 | `.patch-notes-panel` / `.window-controls` |

- Windowed panels: the setting `panelsWindowed` adds `body.panels-windowed`. `WindowedPanels` (`ea`, bundle ~2108912) then adds `.panel-floating`, appends a `.panel-titlebar[data-panel-id]` (children `.panel-titlebar-label` and `.panel-titlebar-btns`) as the LAST child, and stores `{left,top}` in `localStorage scapewatch_panel_windows`. Panel ids: tasks, skills, quests, inventory, diary, equipment, friends, barter, chat, taskhud, population, raiddps, gauntlet. Windowed z-index is capped at 99. `bringToFront` re-appends the node (scrollTop is saved and restored).
- Modal: `.modal-overlay` is `display:none` but holds **~135,000 DOM nodes** (of 142,512 in `#ui-container`). Every tab is pre-built. 8,349 elements carry inline colour or background styles, mostly tooltip lines and svg.
- Canvas layers: the world canvas, `#cc-bar-labels` (ScapeLite, z 1), per-card sprite canvases (64/128 px; mob and slay icons, hundreds), and `.map-overlay-canvas` x2 and `.login-bg-canvas` (full size). Canvas content (node labels, floating text, map) is drawn from JS constants (`MAP_BG_COLOR #08080f`, `ka.GOLD`), not CSS. CSS cannot theme it, except through the game's own `Xt.apply` side effects.

## 2. CSS variables

All 24 game variables are defined on `:root` in `style.css`. In the live game the theme overrides 17 of them inline on `<html>`.

| variable | default | uses in style.css (+uq.css) |
|---|---|---|
| `--border-primary` | #5c4a2a | 373 (+5) |
| `--text-accent` | #c8a83e | 317 |
| `--text-bright` | #ffff00 | 301 (+10) |
| `--text-light` | #cccccc | 243 |
| `--game-font` | 'Chakra Petch', 'Play', Noto Sans/Thai/SC/TC/JP/KR, sans-serif | 239 |
| `--bg-cell` | #3a3226 | 237 (+6) |
| `--text-gold` | #FFD700 | 163 (+8) |
| `--bg-panel` | #2b2216 | 146 (+7) |
| `--text-muted` | #888888 | 138 |
| `--text-dim` | #aaaaaa | 113 |
| `--bg-dark` | #1c1c0e | 106 |
| `--bg-hover` | #4a4230 | 89 |
| `--border-secondary` | #7a6a3a | 77 (+7) |
| `--bg-darkest` | #1a1a1a | 44 |
| `--text-success` | #88FF88 | 42 (not in theme) |
| `--tier-feeble/dire/savage/fell/ancient` | #4CAF50 / #4FC3F7 / #FF9800 / #F44336 / #9C27B0 | 11 / 9 / 6 / 13 / 5 |
| `--text-dark` | #666666 | 12 |
| `--text-disabled` | #555555 | 7 |
| `--bar-fill-damage` | #b8442d | 11 (theme sets it) |
| `--bar-fill-progress` | #5a8a3a | 9 (+3, theme sets it) |
| `--panel-width` | 376px | 12 (layout, do not touch) |
| `--playable-center-x` | 50% | 13 (layout, set inline on `#ui-container`) |

- Used but never defined, so they fall back to inline defaults: `--bg-darker` (6x, falls back to `--bg-dark` or `--bg-darkest`), `--text-danger` (#ff6b6b), `--text-warn` (#e0a050), `--bg-input`, `--accent` (#f0a040), `--red` (#c44/#e55). They are cheap extra hooks, and defining them on `html` changes only those spots.
- Other local vars: `--alms-preview/-active/-needs`, `--role-color`, `--uq-route-color`, `--notif-bg-opacity`, `--tasks-dock-w`, `--uq-full-w`, and `--mx/--my/--sx/--sy/--rot` (animation).
- **Consistency**: of 1,128 hex literals, 493 are `#000` (shadows). The rest are semantic status colours (#4caf50 x64, #f44336 x32, #ff4444, #e74c3c, #4fc3f7, ...). Each of the 15 brand palette hexes appears once (the `:root` rule). That is strong evidence the palette flows only through variables. There are 389 `rgba(...)` literals, mostly black overlays (`rgba(0,0,0,.6)` x54+, `.8` x25) and `rgba(200,168,62,.5)` x5 (a hard-coded accent glow). In live inline styles, 6,787 use `var(--...)` against 1,562 hex or rgb. JS-built markup (bundle) uses `var(--text-gold)` etc. in most places, with literals for status colours (#FF99CC pet, #ff3232 death, #4FC3F7 quest).
- One-off hard-coded: tier and status colours, HP bar thresholds in the dashboard (#b8442d / #FFA500), raid and role colours, chat channel colours (their own settings), canvas colours (not CSS).

**Existing theme system (important).** `Xt.THEMES` has 39 entries. There are 13 families, each in a base, Dark and Light variant (oldschool, modern, forest, crimson, royal, pink, ice, midnight, ember, mint, gold, sunset), plus `dark`, `light` and `highContrast`. Each theme defines the 15 colours (`_CSS_MAP`) plus `BAR_FILLS` for the two bar vars. `Xt.apply(id)` sets them with `documentElement.style.setProperty`, updates `ka.GOLD` and the player colours (canvas), calls `applyTheme()` on the chat, and saves `scapewatch_theme`. The Settings dropdown is `.settings-theme-select`.
- Consequence: **a ScapeLite "skin" is a custom 40th theme, written as a variable override.** No theme file or hook needs extracting from anywhere.
- Inline-on-html beats a normal stylesheet, so an override must either use `html{--x:...!important}` in a ScapeLite `<style>` (an author `!important` beats a non-important inline value) or write the inline properties itself. If it writes inline, the game's `Xt.apply` overwrites it on any theme change, so re-apply after that.
- `Xt` is not reachable by name (the bundle is minified). `scapewatch_theme` in localStorage and the variables on `<html>` are readable.
- ScapeLite's own `--cc-*` palette (`ui-scale.js`, `#cc-theme-style`: `--cc-bg:#10101a`, `--cc-accent:#ffd24a`, ...) is fixed dark navy and independent of the game theme. A light game theme would sit next to dark ScapeLite panels. **(spec)** Map `--cc-bg:var(--bg-panel)`, `--cc-border:var(--border-primary)`, `--cc-text:var(--text-light)`, `--cc-accent:var(--text-gold)` as an optional "follow game theme" mode.

## 3. Fonts, units, zoom

- Font: Chakra Petch (loaded from the Google Fonts stylesheet, the first sheet; the game has no `@font-face` of its own), Cinzel for titles (10 rules hard-coded), Play and Noto fallbacks. The setting "Game UI Font" offers Chakra Petch, Cinzel and Figtree. `_applyFont` writes `--game-font` **inline on `<html>`**, so a stylesheet override of `--game-font` loses unless `!important`. 145 live elements render in Arial: form controls (`button`/`input`) that do not inherit the font.
- Units: `rem` 0, `em` 12, `%` almost none, `vh/vw` ~10, **`px` 6,796**. Root font-size is 16px but unused. Everything is px at the 1920x1080 design size, then scaled as a whole by the `zoom` on `#ui-container`. Resulting computed sizes: 16px (1,087 elements), 18px, 14px, 13.33px (buttons).
- The game uses real CSS `zoom` (not `transform`) on `#ui-container`. Layout, hit-testing and `getBoundingClientRect` therefore mix zoomed and unzoomed units. Existing ScapeLite code reads `getComputedStyle(#ui-container).zoom` and converts every time (`uiZoom()` in panel-fuse, menu-dock, modal-resize, panel-resize). CSS `scale` on a panel composes with the game's transforms, and `zoom` on a panel keeps layout correct.
- **What breaks if a game panel is moved to another container:**
  - Moved out of `#ui-container` (into body): it loses the zoom (about 1.27x smaller here), `--panel-width`/`--playable-center-x`, the edge-anchored absolute positioning and the `#ui-container ...` selectors in `style.css`. Tooltips are positioned from zoomed coordinates.
  - Moved or wrapped inside the panel: the queue rebuild `panel.insertBefore(newRows, controlRowEl)` throws once `.uq-controls` has been moved. This was the v1 failure, documented in `panel-resize.js`.
  - The game holds element references (`mt.element`, `Gn.element` ...) and calls `appendChild` itself (`bringToFront`), so reparenting is unsafe whenever it happens during the game's own rebuilds.
  - Safe displacement tools: CSS `scale`, `zoom`, `margin` offsets, `order`, `:has()` selectors, `display:none` on a node (`visibility`/`opacity` safer). ScapeLite uses all of these today.

## 4. Stability of DOM and class names

- Patch notes in `bundle.js` (`_patchNotes`): 114 versions between Feb 4 and Oct 6 2026, per month: Feb 1, Mar 1, Apr 2, May 78, Jun 12, Jul 4, Aug 1, Sep 13, Oct 2. Roughly 203 of 776 note lines (26%, keyword match) mention UI or settings. The pace has slowed since the May launch burst (78 versions) but is still active: v1.0.1 to v1.0.3 (Sep 29 - Oct 6) changed scaling, the HUD online row, the invite tray, the bank, tooltips and font.
- Recent UI changes that would hit our CSS: removed End Combat button (v1.0.2), HUD row rearranged (v1.0.1), new Invites tray (v1.0.3), bottom-right panels above the World Map (v1.0.3), Ledger filter menu (v0.9.93), hiscores columns (v0.9.91/92). **Structure moves, but the class names of the main shells survived.**
- In the live DOM there are 1,496 distinct classes, none looks generated (no hashes); the names are hand-written BEM-ish (`panel-floating`, `panel-titlebar`, `floating-tab-btn`, `uq-*`, `dash-*`, `tt-*`). `style.css` has 2,451 class names. ScapeLite has already shipped 174 commits against these names with few reported breakages.
- Most stable hooks, in order:
  1. CSS variables (rarely renamed, unchanged in the 15-colour map since theming shipped). **Best.**
  2. `data-panel-id` on `.panel-titlebar` (the game's own API; used by panel-resize and fuse via `:has(> .panel-titlebar[data-panel-id="x"])`).
  3. `data-tab` on `.floating-tab-btn`, `.tab-btn`, `.panel-tab-btn`; `data-tutorial="..."` (96 elements; the game's tutorial depends on them; `floating-tab-bank`, `queue-slot-0`, `window-map`...); element ids (`#bag-panel`, `#unified-queue-panel`, `#toggle-<name>`, `#tab-<name>`, `#settings-sec-*`).
  4. Structural shells: `#ui-container`, `.modal-overlay`, `.panel-floating`, `.panel-tab-bar`, `.hp-bar`.
  5. Inner row classes (`.uq-rows`, `.dash-*`, `.tt-line`): volatile, avoid for layout.
- Making selectors resilient: always scope to a shell, use `:where()`/`:is()` lists with fallbacks, prefer `[data-*]` over class chains, wrap each rule group so a miss is a no-op (CSS is naturally forgiving), keep one selector table in one file, log selectors that match nothing at runtime (a self-check, `document.querySelector(sel)` once per login), and key off `body.panels-windowed`, `body.scale-*` state classes. Avoid MutationObserver on `#ui-container` (the 135k-node modal makes subtree observers expensive; see the rAF read loops in the existing mods).

## 5. Pure display vs interactive

The game sends actions through `L.send("<name>", ...)` (289 call sites, 204 names), always from the game's own click, input and key handlers. Restyling cannot trigger these, but **ScapeLite code must not call `.click()`, dispatch events, or call `L.send`**. Rough split **(spec: from live element counts and action names, not click-tested)**:

| surface | classification |
|---|---|
| `population` HUD (name, world, online, offline hours), `taskhud`, `raiddps`, `gauntlet` HUD, `hp-bar`, `active-potions-*`, xp drops, loot zone, `screen-effects`, tooltips, `patch-notes-panel`, `.global-tooltip` | display (a few buttons: world switch, leave) |
| `skills` (498 nodes, 6 buttons), `diary` (read, sort/filter local only), `quests` list | mostly display; clicking opens a modal tab and sends `get_custom_state` (read) |
| `dashboard-panel` | display plus local filters (1 input) |
| `inventory` / `bag-panel` and `equipment` | interactive: `equip_item`, `unequip_item`, `drink_potion`, `use_lamp`, `open_chest` |
| `unified-queue-panel` (`tasks`) | interactive: `queue_*`, `reorder_queue`, `reroll_queue_slot`, `select_queue_option`, `task_queue_skip_current`, `cancel_queued_*` |
| `barter-panel` (23 buttons, 6 inputs) | interactive (`barter_buy/sell/reroll`) |
| `chat-panel`, `friends-panel` (input) | interactive (`chat_message`, `friend_*`, `mute_player`) |
| Modal tabs: bank, smith, craft, imbue, brew, alms, raid, clan, customize (loadouts), settings | interactive, many `set_*` actions; settings also write `scapewatch_settings` |
| `.floating-tab-strip`, `.panel-tab-bar` | navigation only (open panel/modal; no server actions) but tied to hotkeys and the tutorial |
| `window-controls` | `sleep`, logout/close, map: **never** auto-trigger |

Safe to restyle everything. Do not hide, disable, or alter `pointer-events` on interactive controls in a way that could cause stray clicks (e.g. an enlarged transparent overlay); `modal-resize` Float mode sets `pointer-events:none` on the overlay by design but is user-driven.

## 6. Existing ScapeLite pieces touching the game UI

| file | what it does | technique |
|---|---|---|
| `panel-resize.js` (1172 lines) | Drag-scale (50% of base size and up; shown as on-screen % = stored scale x game UI zoom) of game floating panels by a corner handle; optional "vertical menu" (`body.cc-vmenu`): the bottom-right tab bar becomes a right-edge column, HP bar vertical (`#ui-container>.panel-tab-bar`, `>.hp-bar` selectors) | One `<style>` with `scale:` via `.panel-floating:has(> .panel-titlebar[data-panel-id="x"])`, handles are body-level `position:fixed` (rAF reads `getBoundingClientRect`); zero DOM mutation on game nodes (v2 rule); `cc-panel-scale-v2` in localStorage |
| `panel-fuse.js` | Link button in titlebars of touching floating panels; snaps edge, squares seam corners, moves partners together | `margin` offsets on the partner (game `left/top` never written), `uiZoom()` conversion; `cc-panel-fuse` |
| `menu-dock.js` | Makes menu bar + HP bar one movable, resizable (CSS `zoom`) block that joins fusing | Handle strip + corner grip, body-level; `cc-menu-dock` |
| `modal-resize.js` | Corner grip scales the big modal (`zoom` on `.modal-container`, 50%-100%, per tab); "Float" mode lets the game stay clickable behind it | `body.cc-modal-float`, `pointer-events` rules, per-window localStorage |
| `ui-scale.js` | ScapeLite-side: reads the game's `#ui-container` zoom and applies it as `scale` on all `cc-*` panels; shared theme (`body.cc-themed`, `--cc-*` vars, rounded corners); layering z 1100; corner resize handles; "Panel size" slider | Style element `#cc-theme-style`; **themes only ScapeLite's own panels, not the game's** |
| `window-dock.js`, `notif-dock.js`, `sidebar-tabs.js`, `settings-nav.js` | Move/resize/collapse the window-controls row; raise and move pop-ups (invite tray); show/hide/pin left-strip tabs via Settings > Hotkeys rows; Settings quick-jump menu | Same CSS-only/offset techniques; sidebar-tabs uses the game's `body.side-tabs-collapsed` |

Nothing yet changes the game's colour palette or fonts. In total ~3,000 lines show the pattern works: one stylesheet per feature, selectors on the game's stable attributes, body-level controls, no node mutation.

## 7. Options for a skin layer

| option | what | risk | effort |
|---|---|---|---|
| A. Variable override (custom 40th theme) | A `<style>` with `html{--bg-panel:...!important; ...}` for the 15 vars, `--bar-fill-*`, and the undefined hooks (`--bg-darker`, `--text-danger`, `--text-warn`, `--accent`); optional UI in Settings > Plugins with presets and a colour picker | Very low: game code unaffected. Does not reach canvas (nodes, map, floating text use `ka.GOLD`, `Pe.PLAYER_COLOR`), tier/status literals, 389 rgba overlays, chat channel colours. If the user changes the in-game theme afterwards, `!important` still wins (feature, not bug); a "none" preset must remove the style. Light schemes can make hard-coded `#000`/rgba shadows look off | Small |
| B. Follow-the-game-theme bridge for ScapeLite panels | Map `--cc-*` to the game vars so cc panels match any of the 39 themes | Very low | Small |
| C. Attribute-selector stylesheet for density and shape | `.panel-floating:has(> .panel-titlebar[data-panel-id="x"])` rules: font-size, padding, border radius, gap; `--game-font` override with `!important` | Low-medium: px layout is tuned at 1920x1080; shrinking font or padding can overflow fixed-height rows, and inner class chains drift with patches. Keep to shells and `font-size` on panel roots | Medium |
| D. Per-panel opacity | `opacity`/background alpha on `.panel-floating:has(...)`, or `--bg-panel` with alpha for all | Low. Opacity creates a stacking context (same tooltip-trap issue panel-resize handles with `:has` z-index bump); prefer alpha in background colour over `opacity` | Small |
| E. Re-arrange via CSS displacement | `scale`, `margin`, `order`, `zoom` as today; hide parts with `display:none` on inner nodes (`.panel-titlebar` buttons, empty rows) | Medium: hiding a node the game later `insertBefore`s relative to is fine (still in DOM), removing is not | Medium |
| F. Reparent real game nodes | Move panels into ScapeLite containers / tabs | **High**: breaks zoom, game references, rebuild code (see section 3); do not | Avoid |
| G. Clone/mirror panels in our own DOM | Render read-only copies from `window.__ccState` data | No effect on the game, but the copy has no actions, and it duplicates logic; fine for display-only widgets that ScapeLite already builds (xp, goals) | Large |

Cross-cutting: persist in localStorage keys of our own (`cc-*`); a global kill switch (remove the style elements); re-inject-safe teardown like the existing mods; apply on `DOMContentLoaded` since `<head>` may not exist at document-start (documented bug in `panel-resize.js`).

## Recommendation (priority order)

1. **A + B: ship "Game theme" first.** A ScapeLite "Custom UI colours" setting that writes an `!important` variable override (a custom palette editor plus a handful of presets that the 39 built-ins lack, e.g. translucent dark, high-contrast variants), plus the bridge so `--cc-*` follows the active game palette. Highest visual payoff for the least risk, because the game already routes its colours through those variables. Test with Light variants and Cinzel/Figtree fonts.
2. **D: panel background opacity** via an alpha background on the same variables (or on panel shells), with a per-panel slider reusing the `data-panel-id` selector pattern.
3. **C (narrow):** a "density" preset limited to font-size and padding on panel roots, tested at 1920x1080 and the three scaling modes; opt-in per panel, shipped with a one-click reset.
4. **E:** extend the existing displacement mods (already proven) before inventing new ones: more panels dockable and fusable, hide unused titlebar buttons.
5. Do not do F. Do not auto-click or emit any event; keep all new features declarative CSS plus body-level controls.
6. Maintenance: one table of selectors with a startup self-check, a smoke test per game patch (compare the variable list against the 24 above and check that the shells still exist), and re-read `_patchNotes` after each update for UI lines.
