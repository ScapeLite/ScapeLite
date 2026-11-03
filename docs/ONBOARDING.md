# Onboarding and looks (presets)

Study of 2026-10-28 (how a new user meets ScapeLite today) and what was built on top of it: three looks and a first-run chooser.

## 1. How onboarding works today (before the looks)

**Installer / first start.** The app (or `npm start`) runs `overlay/supervisor.js`, which calls `overlay/first-run.js` `ensureUserConfigs()`: it creates the per-user files (`chat-relay-config.json`, `digest-config.json`, `clan-hiscores-config.json`, `raid-summary-config.json`, `clan-board-config.json`) from the hollow `*.example.json` templates (never overwrites, refuses a template that holds a webhook) and `plugins-config.json` from the catalog defaults. Every Discord feature starts off. That is all `first-run.js` does: it never touches the in-game look.

**In the game.** The watcher injects the plugins over CDP. The only onboarding code in the page is `overlay/welcome-tour.js` (plugin `welcome-tour`, part of the core bundle, setting `welcomeTourEnabled`, default on):
1. Once the game UI is up (side strip and a floating panel exist) and `localStorage cc-welcome-seen` is not `1`, it opens a 5-step **Welcome tour** (what ScapeLite is, where Settings > Plugins is, the status light and dashboard, the marketplace, tips).
2. When the tour is closed it opens the **Play style setup** (one modal: combat style, teleports, combat XP weight, anonymous usage stats, UI size slider, clock format, Windows notifications). The answers seed plugin settings through `__ccPluginSettings.seed` and are stored in `cc-setup`.
3. Later, once both are done, a **UI tour** ("A new look...": layout editor, chips, tab groups, colours, info bars and alerts) opens once (`cc-ui-tour-seen`).
4. Existing installs that never answered the setup are asked once (`cc-setup-asked`). All three are replayable from Settings > Plugins (Show Welcome Tour, Play Style Setup, Show UI Tour). Per-plugin guides (chat relay, route advisor, clan board) use the same modal.

**What a fresh install looks like.** Plugin defaults come from the schema in `overlay/plugins-settings-ui.js` and the module list in `overlay/ui-bar.js`: the top Info Bar is on (task, location, XP per hour, gold, clock), the bottom bar is off, nothing of the game is hidden, the vertical bottom-right menu and the HP dock are on, the ScapeLite menu button and the alert bell are on, ScapeLite's task queue and cards exist but only open from the Info Bar buttons. Before this change the default bar had no panel buttons, so a new user reached the queue only by hovering the Task module (roadmap feat-024 / FEATURE-GAPS H6). The Plugins page (Settings > Plugins) lists every setting grouped in sections; nothing there said which settings belong together.

**Weaknesses found**
- No choice of look. The "full ScapeLite" experience (hidden game panels, bottom bar with chat, panel buttons, HP bar) took a dozen manual steps spread over the Info Bar right-click menus and the Plugins page; nobody could say "give me the vanilla game".
- The tour explains where things are, not what the game will look like. Three modals back to back on the first launch, none skippable as a whole except by pressing Skip three times.
- The default bar did not contain the Panel buttons module.
- State is scattered in localStorage keys (`cc-welcome-seen`, `cc-setup`, `cc-setup-asked`, `cc-ui-tour-seen`, `cc-bar:v1`, `cc-plugin-settings`): there is no single "this is a new install" flag, and the watcher seeds `cc-plugin-settings` on connect, so that key cannot tell a new install from an old one.
- Settings could be set programmatically only through `__ccPluginSettings.set(key, v)`, a prefix whitelist meant for the Layout Editor's Look row (one key at a time, no feedback, the Plugins page controls were not refreshed).
- Nothing handles "the game or Steam is not found" in the page (roadmap repo-013, launcher side).

## 2. Looks (presets)

Three looks, one table (`PRESETS` in `overlay/presets.js`, plugin `presets`, core bundle):

| Look | What it is | Settings it sets | Info Bar layout it sets |
|---|---|---|---|
| **Full Vanilla** | The game as it is; ScapeLite only does invisible and QoL work | `uiBarTop` off, `uiBarBottom` off, `uiBarHotkeys` off, `verticalMenuEnabled` off, `menuBarHidden` off, `hpPanelEnabled` off, `hpPanelHideOriginal` off, `scapeliteMenuEnabled` off, `alertBellHidden` on | the plain default bar (stored but not shown; it hides nothing, so no game panel can stay hidden) |
| **Combination** | ScapeLite's Info Bar plus the game's panels | `uiBarTop` on, `uiBarBottom` off, `uiBarHotkeys` on, `verticalMenuEnabled` on, `menuBarHidden` off, `hpPanelEnabled` off, `hpPanelHideOriginal` off, `scapeliteMenuEnabled` on, `alertBellHidden` off | top: Current task, Location, **Panel buttons**, XP/hr, Gold, Clock (buttons open the game's panels, nothing hidden) |
| **ScapeLite only** | The game's original panels hidden; ScapeLite bar, task queue, pinned cards | as Combination but `uiBarBottom` on | top: Current task, Location, XP/hr, Gold, Clock. bottom: Chat (hides the game's chat), **Panel buttons** (icon + text, live text, click opens ScapeLite's card, hide the game's panels), Hit points bar (hides the game's HP bar) |

Right-click any panel button in "ScapeLite only" and the game's original panel opens beside ScapeLite's card (and closes again with the same item).

**The current look is derived, not stored.** `__ccPresets.currentId()` compares the live settings (`__ccPluginSettings.get`) and the live bar layout (`__ccBar.config`: same module ids per bar, and the options the look writes) with each table row; no match is "Custom". So one changed option turns the label to Custom with no hook on the settings page, and a fresh install that never chose is shown as Combination (the defaults equal it; the default bar now includes the Panel buttons).

**Never touches an existing install.** On its first load `presets.js` writes `cc-preset`: an install that already has `cc-welcome-seen`, `cc-setup` or `cc-ui-tour-seen` gets `{chosen:true, existing:true}` and the chooser never opens by itself; a new install gets `{chosen:false}`. This is decided before the welcome tour can write anything. Before a look is applied, the values it would overwrite (every key any look sets, and the whole bar layout) are saved in `cc-preset-backup`, and "Undo last change" puts them back (one level).

**First-run chooser (since 2026-10-28: step 1 of the welcome tour).** On a new install the welcome tour opens with the three looks as its first step (`welcome-tour.js` embeds `__ccPresets.picker()`; a small picture and one line per look). Clicking one applies it at once, marks it current and offers Undo; Next carries on. Closing the tour (Skip, Escape) or finishing it without picking records `skipped` (`__ccPresets.settle()`) and leaves the defaults, so the choice is never asked twice. The look is picked before anything else, as a lead into the tour. The order on a new install is: tour (look first), setup, UI tour.

**The tour adapts to the look.** Step 2 "Your look" describes what the screen holds in the look picked (Full Vanilla: nothing added, the game's side menu and hotkeys, the Layout Editor hotkey; Combination: the top Info Bar and the ScapeLite menu; ScapeLite only: hidden game panels, bottom bar, right-click for the original panel; Custom: where the options are). It is drawn when the step opens, so going Back and picking another look changes it. The UI tour leaves out "Info bars and Alerts" in Full Vanilla and drops the ScapeLite-menu sentences there. Replaying the tour (Settings > Plugins > Show Welcome Tour) shows the same picker with the current look marked.

**Fallback.** `presets.js` still has its own chooser window, opened from Settings > Plugins > ScapeLite Look. On a new install it also opens by itself when the welcome tour is switched off, or has not appeared about nine seconds after the game UI is up, so a new user always gets the choice once.

**Plugins page.** Settings > Plugins > ScapeLite Core > **ScapeLite Look** (button "Choose"; its description starts with "Current look: ..." and refreshes when the pointer enters the row) reopens the chooser with the current look marked and Undo available.

**How settings are applied.** `__ccPluginSettings.setBundle(obj)` (new, in `plugins-settings-ui.js`): only keys that exist in the schema, are not secrets and belong to the look family (`ui*`, `alert*`, `cardFuse*`, `anchor*`, `hpPanel*`, `verticalMenuEnabled`, `menuBarHidden`, `routeAttach`, `queueWalk*`, `scapeliteMenuEnabled`, `menuDockEnabled`) are written; the rest is returned as `refused`; the Plugins page controls follow. The bar layout goes through `__ccBar.applyConfig(cfg)` (new, in `ui-bar.js`: unknown modules dropped, a malformed layout changes nothing).

## 3. Not done / decisions for the owner
- Decided by the owner on 2026-10-28: the status light is never hidden by any look; the game's side bar is always kept (no look sets `menuBarHidden`, until ScapeLite offers an alternative to it); Full Vanilla may turn the ScapeLite menu button off (it does); the chooser comes before the tour, as part of it (done, see above). The rest of the table is still a proposal.
- Looks do not switch plugins on or off (`plugins-config.json`); they only set display options.
- Applying a look live can shift Panel Fuse offsets (observed: the skills panel's fuse offset moved when the panels were hidden). Back up `cc-panel-fuse` before testing on a profile you care about.
- Undo restores effective values: a setting that was never saved becomes an explicit saved default.
- A clean-profile test (feat-027, repo-003) is still needed. `npm run test:onboarding` runs the real `presets.js` and `welcome-tour.js` in a private hidden Electron window on a fake game shell with empty storage (new install, pick, change mind, skip, existing install, replay, fallback, teardown: 18 checks). The merged first step was also looked at once in the real game (opened by replay, nothing clicked). A truly empty profile of the real game has not been run.
