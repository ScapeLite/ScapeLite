# Research: premium customisable overlay/HUD UI for ScapeLite

Scope: what loved mod ecosystems do, HUD UX principles, features worth building, safe rollout, 12 ranked ideas.
Evidence tags: **[S]** = from a source linked below, **[K]** = general design knowledge / my judgement, not verified by a source in this pass (verify before quoting publicly).

## 1. What successful ecosystems do

| Ecosystem | Pattern worth copying | Evidence |
| --- | --- | --- |
| WoW Edit Mode (Blizzard) | Named layouts, switchable from a dropdown; layouts are shared as a copyable string (Share > Copy to clipboard; Import > paste, name, confirm). Blizzard itself tells players to back up the string after a lost-layout incident. | [S] [Edit Mode wiki](https://warcraft.wiki.gg/wiki/Edit_Mode), [Blizzard support](https://eu.support.blizzard.com/en/article/322075) |
| ElvUI | Mover/anchor mode (`/moveui`, toggle anchors button), optional on-screen grid (`/egrid`), profiles shared as an import string from a community site (Wago.io), guides advise export-current-profile before importing. Whether the grid snaps was not confirmed. | [S] [guide](https://warcrafttavern.com/wow/guides/elvui-addon-guide), [Conquest guide](https://www.conquestofazerothwiki.wiki/guide/conquest-of-azeroth-elvui) |
| Default UI Sharer / MoveAny | Third parties exist because built-in sharing is not enough: bundling layout plus related settings (cVars) into one string; moving arbitrary windows. Signal that "layout + settings in one string" is wanted. | [S] [Default UI Sharer](https://www.curseforge.com/wow/addons/default-ui-sharer), [MoveAny](https://www.curseforge.com/wow/addons/moveany) |
| RuneLite | Plugins are built on a standard `PluginPanel` side panel (consistent look for free), a `MultiplexingPluginPanel` for sub-pages, and a curated Plugin Hub where devs verify plugins comply with Jagex rules and are not malicious. Loved because: one consistent shell, opt-in plugins, trust via review. | [S] [Plugin Hub](https://runelite.net/plugin-hub), [PluginPanel API](https://static.runelite.net/api/runelite-client/net/runelite/client/ui/class-use/PluginPanel.html) |
| Overwolf | Store review for quality/malware/performance; rule that overlays must not cover game UI or appear in active gameplay; claim "each app is about a browser tab" in cost. Takeaway: publish a performance budget and self-police it. | [S] [compliance](https://dev.overwolf.com/ow-native/guides/game-compliance/overview), [support](https://support.overwolf.com/support/solutions/articles/9000176825-what-is-overwolf-) |
| Awakened PoE Trade | Hotkey-driven, summon-on-demand overlay with user-rebindable keys and widgets; defaults differ by version so in-app hotkey settings are the truth. Low-friction "appears when needed". | [S, weak sources] [repo](https://github.com/SnosMe/awakened-poe-trade) |
| Dalamud (FFXIV), OSRS resizable mode, Diablo/PoE HUD | Not retrieved by search. [K]: Dalamud plugins share one ImGui look, per-plugin config windows, a plugin installer with repos and a "dev plugin" channel; OSRS resizable mode lets players choose panel placement and transparency of side panels; these are the user-demanded baseline. Verify via Dalamud docs if cited. | [K] |

What makes them loved (synthesis): (a) consistent shell so third-party/optional panels feel native; (b) full user control over position and visibility with a safe undo; (c) shareable configuration as text; (d) opt-in, reviewable, cheap in performance; (e) the default is already good so customisation is optional, not required.

## 2. Dense-information HUD principles

- **Hierarchy [K]:** one primary number per panel (largest, highest contrast), secondary values smaller/dimmer, labels dimmest. Group by task, not by data source. Limit to ~3 type sizes and 2 weights.
- **Density modes [K]:** Compact / Comfortable / Spacious via a single spacing token set; "minimal" = headline value only (e.g. XP/hr and ETA). Persist per panel.
- **Progressive disclosure [K]:** collapsed by default, expand on click or hover; details in tooltips or a drawer (ScapeLite's Tree Advisor drawer already does this). Never hide state that changes decisions (e.g. a better route exists) - show a small badge.
- **Tooltips [K]:** show on hover with short delay, keyboard-focus equivalent, never cover the thing that triggered them, same structure everywhere (title, key stat, delta, caveat).
- **Motion budget [K]:** animate only state change (value up/down, new item), 120-200 ms, ease-out; no looping animation; respect `prefers-reduced-motion`; use transform/opacity only to avoid layout cost. The game is an idle game: panels run for hours, so CPU/GPU cost matters more than flair (ScapeLite already has a per-plugin CPU breakdown - use it as the budget gate).
- **Small-size readability:** small labels are a leading complaint; offer text-size scaling and a plain backing panel or outline rather than text over art. [S] [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/), [Xbox XAG 101 text](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-101-text-display.md)
- **Contrast [S]:** WCAG-style 4.5:1 for normal text, 3:1 for large text and UI components; over variable backgrounds use a backing plate or outline; make contrast configurable (very high contrast can hurt some users). [Xbox XAG 102](https://devdocs.xbox.com/build/game-principles/accessibility/xag-deep-dives/xag-102-contrast.md)
- **Colour-blind-safe [S]:** never colour alone - pair with icon, text, or pattern; avoid red/green as sole pair; test with a simulator such as Color Oracle. ScapeLite already uses colour-coded route cards (purple border = teleports, blue = quest): add an icon/label so colour is redundant. [K] Use a validated palette (e.g. Okabe-Ito) for series colours.
- **Keyboard [K]:** every panel reachable by hotkey and Tab; visible focus ring; Esc closes drawers; never steal keys the game uses; all hotkeys rebindable and disable-able.

## 3. Customisation features worth building

1. **Edit mode** [S: WoW/ElvUI precedent]: toggle shows all ScapeLite panels with handles and names, dim game behind; drag, snap to edges/other panels (Panel Fuse already does side-snap), alignment guides, optional grid, per-panel lock, "Reset this panel", Esc to exit, one-step undo, "Revert to last saved".
2. **Layout profiles** [S]: named profiles (e.g. Questing, Combat/Raid, Skilling), quick switch, auto-switch by context (in raid, in combat) as optional.
3. **Import/export** [S]: single copyable string (versioned JSON, compressed, base64), with preview and "backup current first" prompt. Include layout + theme + per-plugin options, with secrets (Discord webhook) explicitly excluded.
4. **Theme editor** [K]: accent colour, background opacity, font size, density, corner radius, preset themes (default dark, high contrast, colour-blind-safe). Drive everything from CSS custom properties in the shared dark theme so one change restyles all panels; show live preview; contrast checker warning if the chosen accent fails 3:1.
5. **Per-panel opacity and auto-hide** [K]: idle fade (e.g. to 40%) and hover-to-restore; hide when a given game window is open or when nothing relevant to show; "peek" hotkey.
6. **Minimal variants** [K]: each panel gets a one-line "chip" mode (icon + one number) and a full mode; click to cycle.
7. **Hotkeys** [S: APT precedent]: show/hide all, edit mode, cycle profile, per-panel toggle; rebinding UI with conflict detection.
8. **Widget library** [K]: a "Add widget" picker in edit mode listing small widgets (XP/hr chip, ETA chip, inventory counter, drop luck chip, goal progress bar) so players compose a personal HUD from existing plugin data rather than whole panels.
9. **First-run presets** [K]: 3 presets (Minimal, Balanced, Everything) chosen in the welcome tour, each previewed with a screenshot; can be re-picked later.

## 4. Testing and shipping an overhaul safely

- **Feature flags [K]:** new UI behind a per-plugin option (`uiVersion: classic|next`), default classic; flag read at injection, hot-switchable because plugins can be added/removed at runtime. Keep the old renderer until the new one has one stable release.
- **Opt-in beta channel [K, cf. Dalamud testing repos/RuneLite hub review]:** "Preview features" switch in the Plugins tab, flagged "Beta" in the marketplace; separate catalog entry or `channel: beta` field.
- **Fallback [K]:** wrap new UI init in try/catch; on error, log to the existing saved-logs facility, revert to classic UI for the session, show a one-line notice with the existing bug-report button. Add a "Reset layout" and safe-mode (hold a key at load) that ignores saved layouts, since a bad saved position can strand a panel offscreen (Panel Tools "keep on screen" already helps; Blizzard's lost-layout case shows backup strings matter - [S] [support](https://eu.support.blizzard.com/en/article/322075)).
- **Versioned storage [K]:** layout schema `version`, migrate on load, keep the last-known-good copy.
- **Telemetry we can legally collect [K, not legal advice]:** the project promise is "nothing leaves your machine" (README), so default to **none**. If feedback is wanted: strictly opt-in, anonymous, aggregate-only counters (feature enabled yes/no, panel count, which preset) with no IDs, no game/account data, shown to the user as a preview before sending, documented in a privacy page, and with a kill switch. Prefer local-only diagnostics: the status light's CPU/FPS breakdown plus a one-click "copy diagnostics" for bug reports, which the user pastes themselves. Get a proper privacy review (GDPR/ePrivacy consent applies to non-essential analytics) before any network call.
- **Game rules [S]:** keep to display-only; Overwolf-style rule that overlays must not obstruct the game UI is a good self-imposed test (default positions must not cover action-critical areas). Overwolf publishes review for performance - mirror this with a CPU budget per plugin in CI/manual checklist.
- **Screenshots for the marketplace [K]:** scripted capture at a fixed resolution with a fixed demo account state, light/dark where relevant, before/after of each preset, 1 GIF of edit mode; reuse the existing `screenshots` field in `catalog.json`; avoid personal data (names, clan chat) in shots (project privacy rule).
- **Test matrix [K]:** panel scales 50-200%, game window sizes/ultrawide, reduced-motion, colour-blind simulator pass, 8-hour soak for leaks, import of malformed strings.

## 5. Prioritised ideas (12)

Value/effort/risk are H/M/L, my estimate [K]. "Builds on" = existing ScapeLite plugin.

| # | Idea | Value | Effort | Risk | Builds on |
| --- | --- | --- | --- | --- | --- |
| 1 | Shared design tokens + theme editor (accent, opacity, font size, density), contrast warning | H | M | L | shared dark theme, ui-scale |
| 2 | Layout edit mode: show all panels, drag, snap guides, lock, undo, reset | H | M | M | Panel Tools, Panel Fuse |
| 3 | Layout profiles + import/export string (secrets excluded) | H | M | L | Panel Tools storage, Plugins settings UI |
| 4 | First-run presets (Minimal / Balanced / Everything) in tour | H | L | L | welcome-tour, marketplace defaults |
| 5 | Minimal "chip" mode for every panel | H | M | L | XP Tracker, Walking Countdown, Route Advisor |
| 6 | Per-panel opacity, idle fade and auto-hide | M | L | L | Panel Tools right-click title menu |
| 7 | Colour-redundancy pass (icons/labels beside colour) + colour-blind palette option | M | L | L | Route Advisor cards, Tree Advisor marks, raid DPS graph |
| 8 | Hotkeys: show/hide all, edit mode, profile cycle, rebinding with conflicts | M | M | M | Side Menu Controls, ScapeLite menu |
| 9 | Rollout plumbing: per-plugin `uiVersion` flag, beta channel, safe-mode, auto-fallback to classic, copy-diagnostics | H | M | L | status light, bug-report, marketplace |
| 10 | Widget library ("add widget" chips from existing data) | M | H | M | XP tracker, drop luck, goals, inventory counter |
| 11 | Context auto-switch of profile (raid, combat, skilling) | M | M | M | raid DPS graph, queue bars |
| 12 | Scripted marketplace screenshot/GIF capture per preset | M | M | L | catalog.json screenshots, website build |

Dependencies: 1 before 5, 6, 7 (tokens); 2 before 3 and 11; 9 before shipping any of 2, 5, 10.

## Recommendation

Do it in three releases behind the opt-in flag. **Release A (foundations, low risk):** #1 tokens/theme editor, #9 flag/fallback/safe-mode, #4 presets, #7 colour redundancy. **Release B (the "premium" moment):** #2 edit mode, #3 profiles and import/export, #5 minimal chips, #6 opacity/auto-hide. **Release C:** #8 hotkeys, #11 auto-switch, #10 widget library, with #12 done alongside each release. Ship telemetry-free; rely on opt-in beta feedback and the existing bug-report flow. Principle across all: default already good, every customisation reversible in one click, zero extra CPU when idle.

## Source gaps

Search did not return primary docs for Dalamud, OSRS resizable mode, ElvUI grid snapping, Overwolf telemetry policy, or ElvUI/APT internals; those rows are marked [K]. Hotkey defaults for Awakened PoE Trade came from low-quality sites and are not used. Repo files README.md and catalog.json (first 120 lines) were read; CHANGELOG.md was not read, so overlap with already-shipped features may be understated.
