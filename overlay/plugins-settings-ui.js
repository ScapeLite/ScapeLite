// Scapewatch plugins settings UI.
// Adds a "Plugins" tab to the game's own Settings panel (hotkey P),
// reusing the game's own CSS classes verbatim (.settings-nav-btn,
// .settings-section, .settings-toggle-row, .settings-switch, ...) so it
// renders identically to a native settings category, not a reskin --
// confirmed live, 2026-10-06, by pulling the real toggle markup and
// computed styles before building this.
//
// Display-only: every control here configures OUR OWN mods (chat relay,
// panel edge-snapping, clan-hiscores polling, raid summaries, hover info)
// -- never touches any real game setting. Values live in localStorage (same
// pattern as panel-resize.js's own scale persistence); the watcher reads
// them each poll (see panel-resize-watcher.js) and calls seed() once per
// connection to push the real current config into the displayed toggles,
// so they don't show stale/default state after a watcher restart. The
// three Hover Info toggles are the simplest case: hover-info.js itself
// reads window.__ccPluginSettings.get(...) directly on each of its own
// poll ticks (no Discord/webhook/Node involvement), so there's no
// watcher-side merging or seeding for those three -- same as
// edgeSnapEnabled above.
//
// Injected the same way as the other three scripts (immediate +
// Page.addScriptToEvaluateOnNewDocument). Settings panel DOM may not
// exist yet (it's only built once the player opens it) and may not exist
// at document-start either way -- watches for both, same resilience
// pattern as chat-relay-collect.js.

(function () {
  'use strict';
  const NS = '__ccPluginSettings';
  const LS_KEY = 'cc-plugin-settings';

  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  let values = {};
  try { values = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { values = {}; }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(values)); } catch (e) {} };

  const SCHEMA = [
    { key: 'logsEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Save Logs to Files', desc: 'Writes ScapeLite’s log to a new file in the Logs folder each time it starts, named after the start date and time (e.g. 2026-10-10_14-43-12.log). Turn off to save nothing.', default: true },
    { key: 'logsKeepDays', type: 'number', section: 'ScapeLite Core', label: 'Keep Logs For (days)', desc: 'Log files older than this are deleted automatically. 1 to 365.', default: 14, min: 1, max: 365 },
    { key: 'welcomeTourEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Show Welcome Tour on First Launch', desc: 'A short popup explaining where the plugin settings, the dashboard and the marketplace are. It is only shown once.', default: true },
    { key: 'showSetup', type: 'button', section: 'ScapeLite Core', label: 'Play Style Setup', desc: 'The few preference questions asked on first launch (combat style, teleports, combat vs skilling weight, notifications). Answering again re-applies the matching defaults.', buttonText: 'Open' },
    { key: 'showWelcome', type: 'button', section: 'ScapeLite Core', label: 'Show Welcome Tour', desc: 'Replay the tour now.', buttonText: 'Show' },
    { key: 'settingsNavMenu', type: 'toggle', section: 'ScapeLite Core', label: 'Settings Quick-Jump Menu', desc: 'Hovering a category in the Settings header (Build, Display, Plugins, ...) opens a list of its sub-categories; click one to jump there.', default: true },
    { key: 'statusIndicatorEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Show Status Indicator', desc: 'A small corner dot showing whether the watcher/Discord features are connected and working, with a hover menu and a link to the full dashboard.', default: true },
    { key: 'usageStatsEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Share Anonymous Usage Data', desc: 'SENT, at most once a day, to GoatCounter (a privacy-friendly counter): the page /active, the ScapeLite version and, as with any web request, your IP address and browser/OS name (GoatCounter does not store the IP, it only counts unique visitors). NEVER SENT: your name, character, account, game progress or data, settings, plugin list, webhooks, or anything you do. No cookies, no ID is saved. Switch off to send nothing.', default: true },
    { key: 'reportBug', type: 'button', section: 'ScapeLite Core', label: 'Report a Bug', desc: 'Describe a problem with a ScapeLite Official plugin. Opens a pre-filled report (versions and which plugins are on, no name or webhooks) on the ScapeLite issue tracker, or copy it. Only Official plugins are fixed by the ScapeLite team; community plugins are supported by their own authors.', buttonText: 'Report' },
    { key: 'hideBeforeLogin', type: 'toggle', section: 'ScapeLite Core', label: 'Hide ScapeLite Before Login', desc: 'On the game\'s main menu / login screen only the Status Indicator is shown; everything else appears once you are in the game.', default: true },
    { key: 'guideChatRelay', type: 'button', section: 'Chat Relay', label: 'Setup Guide', desc: 'Step-by-step: create a Discord webhook, paste it here, and turn on the right chat announcements in the game.', buttonText: 'Open guide' },
    { key: 'relayClanWebhook', type: 'secret', section: 'Chat Relay', label: 'Clan Channel Webhook URL', desc: 'Discord webhook for Clan announcements. Stored only on this PC (overlay config), never in the browser. Click the eye to reveal.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'relayGlobalWebhook', type: 'secret', section: 'Chat Relay', label: 'Global Channel Webhook URL', desc: 'Discord webhook for Global announcements (optional).', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'clanRelayEnabled', type: 'toggle', section: 'Chat Relay', label: 'Relay Clan Chat', desc: 'Forward Clan channel events (and optionally plain chat) to Discord.', default: true },
    { key: 'globalRelayEnabled', type: 'toggle', section: 'Chat Relay', label: 'Relay Global Chat', desc: 'Forward Global channel cape/pet milestones to Discord.', default: false },
    { key: 'relayPlainChat', type: 'toggle', section: 'Chat Relay', label: 'Mirror Plain Chat Messages', desc: 'Also relay ordinary Clan banter, not just drops/unlocks/levels.', default: true },

    { key: 'pingRoles', type: 'roles', section: 'Chat Relay Pings', label: 'Ping Roles', desc: 'Create a ping role: paste the Discord role ID and tick the events it should be mentioned for. You can make as many roles as you like, and an event can ping several roles. Right-click a role in Discord (Developer Mode on) and choose Copy Role ID.' },

    { key: 'edgeSnapEnabled', type: 'toggle', section: 'Panel Mod', label: 'Edge Snapping', desc: 'Panels snap flush to the screen edge when dragged close, and stay snapped until pulled clearly away. Off by default.', default: false },
    { key: 'verticalMenuEnabled', type: 'toggle', section: 'Panel Mod', label: 'Vertical Bottom-Right Menu', desc: 'Shows the tab icons as a column on the right edge with the HP bar as a vertical strip beside it (rotated "52 / 52" text). Turn off for the game\u2019s own horizontal layout.', default: true },
    { key: 'potionsResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Active Potions Resize Handle', desc: 'Adds a drag handle on the Active Potions strip\u2019s bottom-left corner so you can scale it (double-click to reset). Turning this off also puts the strip back at 100%.', default: true },
    { key: 'panelContextMenu', type: 'toggle', section: 'Panel Mod', label: 'Panel Title-Bar Menu + Lock', desc: 'Right-click a panel\u2019s title bar for a menu (lock, reset size, size presets, match another panel\u2019s height) and adds a lock button next to the title-bar buttons. A locked panel cannot be moved or resized.', default: true },
    { key: 'titlebarFontNormalize', type: 'toggle', section: 'Panel Mod', label: 'Equal Title-Bar Text Size', desc: 'Keeps every scaled panel\u2019s title text the same on-screen size (a panel scaled to 60% otherwise shows smaller text than one at 72%).', default: true },
    { key: 'dashboardResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Dashboard Resize Handle', desc: 'Adds a drag handle on the Dashboard window’s bottom-right corner so you can scale it (double-click to reset). Turning this off also puts it back at 100%.', default: true },
    { key: 'aboutInfo', type: 'info', section: 'About', label: 'ScapeLite', desc: 'Checking\u2026' },
    { key: 'checkUpdates', type: 'button', section: 'About', label: 'Check for Updates', desc: 'Looks for a newer ScapeLite (and newer versions of its plugins). A check also runs automatically when ScapeLite starts.', buttonText: 'Check now' },
    { key: 'applyUpdate', type: 'button', section: 'About', label: 'Install Update', desc: 'Downloads and applies the newest version (git installs). Restart ScapeLite from the dashboard afterwards.', buttonText: 'Update' },
    { key: 'aboutCredits', type: 'info', section: 'About', label: 'Made by @Wulf', desc: 'Thank you for using ScapeLite. It is a community project and is not made by, or affiliated with, the Scapewatch developers.' },
    { key: 'currentTaskCollapse', type: 'toggle', section: 'Panels', label: 'Collapsible Current Task', desc: 'Adds a chevron to the Current Task title bar that shrinks it to one line (the task name) with thin progress bars; the Walking drawer becomes a single bar with its time.', default: true },
    { key: 'modalFloatEnabled', type: 'toggle', section: 'Panels', label: 'Floating Windows', desc: 'Adds a Float button to the big windows (Settings, Bank, ...). A floating window can be moved by its tab bar and the game behind it stays usable; the background only dims and blurs while your pointer is inside the window.', default: true },
    { key: 'openLayouts', type: 'button', section: 'Panels', label: 'Layout Presets', desc: 'Save how your panels, docks and windows are arranged as a named layout, and load it again later. Loading a layout reloads the game page.', buttonText: 'Open layouts' },
    { key: 'winDockEnabled', type: 'toggle', section: 'Panels', label: 'Window Buttons Dock', desc: 'Lets you move, resize and tuck away the row of buttons in the top-right corner (hover it for a strip with handles and an edge arrow).', default: true },
    { key: 'potionsDockEnabled', type: 'toggle', section: 'Panels', label: 'Movable Food and Potions Panel', desc: 'Hover the left edge of the food / potions panel (top right) for a handle: drag to move it, right-click for lock and reset. Its own collapse (click a counter) and resize grip keep working.', default: true },
    { key: 'mapCloseCross', type: 'toggle', section: 'Panels', label: 'Cross Closes The Map', desc: 'While the World Map is open, the cross button in the top-right row closes the map instead of logging out.', default: true },
    { key: 'chatDefaultEnabled', type: 'toggle', section: 'Panels', label: 'Remember Chat Channel', desc: 'At login the chat box starts on the channel you last chose, or the leftmost shown one (Global, Proximity / Raid, Friends, Clan) instead of always Global. Applied once; later changes are yours.', default: true },
    { key: 'combatReadoutEnabled', type: 'toggle', section: 'Panels', label: 'Combat Readout', desc: 'A small card on the combat screen with exact HP and Spirit numbers, the attack timer counting down, the unrounded attack interval, attacks per second and your DPS (the game2019s own formula). Drag it anywhere.', default: true },
    { key: 'craftPotential', type: 'toggle', section: 'Panels', label: 'Crafting Potential XP', desc: 'In the Smith, Craft, Imbue and Brew windows, the XP bar also shows what you could reach by crafting with every material in your bank (a gold striped section, plus level chips when it is whole levels).', default: true },
    { key: 'bankToolsEnabled', type: 'toggle', section: 'Bank', label: 'Bank Tools', desc: 'Separators between bank categories, category chips when hovering an item, and sub-category menus on the bank filter buttons.', default: true },
    { key: 'bankTidyToolbar', type: 'toggle', section: 'Bank', label: 'Tidy Bank Toolbar', desc: 'Tucks Sort, Swap, Insert and Remove placeholders into the Filters button, which becomes Settings. Filters is the first entry in that menu.', default: true },
    { key: 'bankSizeSlider', type: 'toggle', section: 'Bank', label: 'Item Size Slider', desc: 'A small-to-big slider in the bank toolbar that resizes the item slots. Double-click its percentage to reset.', default: true },
    { key: 'bankNewTags', type: 'toggle', section: 'Bank', label: 'New Item Sparkle', desc: 'Items you never held before get a sparkle and a NEW tag in the bank, and the bank icon in the side menu twinkles until you have looked at them (hover an item, or press the Clear button).', default: true },
    { key: 'bankSeparators', type: 'toggle', section: 'Bank', label: 'Category Separators', desc: 'A thin line between every category group in the bank grid.', default: true },
    { key: 'bankSepLabels', type: 'toggle', section: 'Bank', label: 'Separator Labels', desc: 'Writes the category name on each separator.', default: true },
    { key: 'bankHoverCats', type: 'toggle', section: 'Bank', label: 'Item Category Chips', desc: 'Lists the categories an item belongs to when you hover it, e.g. Raw > Fish.', default: true },
    { key: 'bankFilterMenus', type: 'toggle', section: 'Bank', label: 'Filter Button Menus', desc: 'Hover Raw, Processed, Equipment or Potions in the bank to pick a sub-category (Fish, Mine, Melee weapons...).', default: true },
    { key: 'notifDockEnabled', type: 'toggle', section: 'Notifications', label: 'Notification Dock', desc: 'Keeps invites (raid / party / friends), task popups and toasts above every panel and window, centred by default, and lets you move them.', default: true },
    { key: 'moveNotifications', type: 'button', section: 'Notifications', label: 'Move Notifications', desc: 'Shows draggable frames for invites, task popups and toasts. Position them, then press Done. Positions are remembered.', buttonText: 'Move' },
    { key: 'modalResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Resizable Settings / Bank / Crafting Windows', desc: 'Adds a corner grip to the game’s big windows so you can shrink them (50-100%). Double-click the grip to restore. Remembered per window.', default: true },
    { key: 'menuDockEnabled', type: 'toggle', section: 'Panel Mod', label: 'Move / Resize / Fuse the Menu + HP Bar', desc: 'Adds a drag strip and a resize corner to the vertical bottom-right menu and HP bar, and lets them fuse with panels. Double-click the strip to send it back home, the corner to reset its size.', default: true },
    { key: 'recenterCameraSmart', type: 'toggle', section: 'Panel Mod', label: 'Smart Recenter-Camera Button', desc: 'Keeps the Recenter Camera button centred but moves it into the lowest gap that no panel covers.', default: true },
    { key: 'keepPanelsOnScreen', type: 'toggle', section: 'Panel Mod', label: 'Keep Panels On Screen', desc: 'If a panel ends up partly or completely off screen, it is shifted back into view (display only; the game’s own position is untouched).', default: true },
    { key: 'panelSizeWholePx', type: 'toggle', section: 'Panel Mod', label: 'Whole-Pixel Panel Heights', desc: 'While resizing, the panel\u2019s on-screen height snaps to whole pixels (instead of fractional percentages), so two panels can be matched exactly. The label shows the size in px.', default: true },
    { key: 'panelSizeBadges', type: 'toggle', section: 'Panel Mod', label: 'Show All Panel Sizes While Resizing', desc: 'While you drag a resize handle, every resizable panel shows its width\u00d7height in px. Panels with the same height as the one you are dragging turn green, near-matches amber, with the pixel difference.', default: true },
    { key: 'panelSizeMatchSnap', type: 'toggle', section: 'Panel Mod', label: 'Snap to Other Panels\u2019 Height', desc: 'While resizing, magnet the height onto another panel\u2019s height when within 3 px. Off by default.', default: false },
    { key: 'resetScales', type: 'button', section: 'Panel Mod', label: 'Reset All Panel Scales', desc: 'Set every resized panel back to 100%.', buttonText: 'Reset' },

    { key: 'hiscoresWebhook', type: 'secret', section: 'Clan Hiscores', label: 'Hiscores Webhook URL', desc: 'Discord webhook the rank updates are posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'hiscoresEnabled', type: 'toggle', section: 'Clan Hiscores', label: 'Enable Clan Hiscores Tracking', desc: 'Poll the clan’s hiscores rank and post to Discord when it changes.', default: true },
    { key: 'hiscoresPollMinutes', type: 'number', section: 'Clan Hiscores', label: 'Poll Interval (minutes)', desc: 'How often to check. Lower = more up to date, more requests.', default: 20, min: 5, max: 120 },
    { key: 'hiscoresPostIntervalHours', type: 'number', section: 'Clan Hiscores', label: 'Post Interval (hours)', desc: 'How rarely to post routine rank/stat changes to Discord, unless a major change forces an immediate post (see below).', default: 6, min: 1, max: 24 },
    { key: 'hiscoresMajorRankChange', type: 'number', section: 'Clan Hiscores', label: 'Major Rank Change Threshold', desc: 'Post immediately, ignoring the interval above, if the clan rank moves by at least this many spots.', default: 3, min: 1, max: 20 },

    { key: 'raidSummaryWebhook', type: 'secret', section: 'Raid Summary', label: 'Raid Summary Webhook URL', desc: 'Discord webhook raid summaries are posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'raidSummaryEnabled', type: 'toggle', section: 'Raid Summary', label: 'Post Raid Summaries', desc: 'Post top damage and shared loot to Discord when a raid finishes.', default: true },
    { key: 'raidSummaryMinMembers', type: 'number', section: 'Raid Summary', label: 'Minimum Party Size', desc: 'Skip posting if fewer than this many real players were in the raid (filters out solo runs).', default: 2, min: 1, max: 5 },

    { key: 'digestWebhook', type: 'secret', section: 'Activity Digest', label: 'Digest Webhook URL', desc: 'Discord webhook the activity digest is posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'digestEnabled', type: 'toggle', section: 'Activity Digest', label: 'Post Activity Digests', desc: 'Periodically post a summary of notable drops, level milestones and completed quests, grouped by player.', default: true },
    { key: 'digestPostTimes', type: 'text', section: 'Activity Digest', label: 'Also Post At (clock times)', desc: 'Extra fixed times to post the digest, 24 h local, comma separated, e.g. 08:00, 14:00, 20:00. Works together with the interval below: whichever comes first posts.', default: '', placeholder: '08:00, 14:00, 20:00' },
    { key: 'digestIntervalHours', type: 'number', section: 'Activity Digest', label: 'Digest Interval (hours)', desc: 'How often to post -- e.g. 6 for 4x/day, 12 for 2x/day.', default: 6, min: 1, max: 24 },

    { key: 'hoverTaskXpPreview', type: 'toggle', section: 'Hover Info', label: 'Task XP Preview', desc: 'Hovering a queued task shows current skill XP and the XP it would give (and an estimated gold profit, where known).', default: true },
    { key: 'hoverTaskXpPercent', type: 'toggle', section: 'Hover Info', label: 'Show Level Progress Bar', desc: 'Shows where a task’s XP takes you: a bar with your current progress and what the task adds, e.g. "Lv 30: 42% → 80%", or "Lv 30 → Lv 31 + 6.5%" when it levels you up.', default: true },
    { key: 'hoverSkillGradient', type: 'toggle', section: 'Hover Info', label: 'Colour-Graded Skill Bars', desc: 'Colours every skill bar in the Skills panel (and its tooltip bar) from red at 0% through amber to green at 100% of the way to the next level.', default: true },
    { key: 'hoverSkillQueued', type: 'toggle', section: 'Hover Info', label: 'Queued XP On Skills', desc: 'Shows the XP your queued tasks (the current one plus each row’s pick) would add on every skill cell of the Skills panel: a striped section on its bar, a +N badge when it is whole levels, and a block in its tooltip.', default: true },
    { key: 'hoverTaskDuration', type: 'toggle', section: 'Hover Info', label: 'Show Task Duration', desc: 'Adds a rough time to finish the task and its XP per hour, from the game’s own projection (needs the Game Data Bridge).', default: true },
    { key: 'queueInsertToggle', type: 'toggle', section: 'Hover Info', label: 'Queue Insert-Bar Button', desc: 'Adds a button next to the Tasks panel\u2019s Collapse and Pin buttons that hides / shows the gold "NEW TASKS" insert bar, so it can\u2019t be dragged by accident. Display only.', default: true },
    { key: 'hoverSlayXp', type: 'toggle', section: 'Hover Info', label: 'Slay Task XP Estimate', desc: 'Hovering a queued Slay (kill) task shows the estimated XP per skill (Slay, your chosen combat skill, Life, Dodge/Defend), time and XP/hr. Estimate from mob HP and the game\u2019s kill-time model; needs the Game Data Bridge.', default: true },
    { key: 'hoverSkillPercent', type: 'toggle', section: 'Hover Info', label: 'Skill % To Next Level', desc: 'Hovering a skill in the Skills tab also shows how far you are to the next level, e.g. "85.3% to level 31".', default: true },
    { key: 'hoverTaskGoldEstimate', type: 'toggle', section: 'Hover Info', label: 'Coin Reward Estimate', desc: 'Hovering a queued Plunder or Bard task shows the expected coins from its loot table (only skills that actually drop coins).', default: true },
    { key: 'hoverMobStats', type: 'toggle', section: 'Hover Info', label: 'Combat Task Mob Stats', desc: 'Hovering a queued combat task shows the target’s HP and attack style.', default: true },
    { key: 'hoverQuestRewards', type: 'toggle', section: 'Hover Info', label: 'Quest Reward Preview', desc: 'Hovering an active quest shows its XP and item rewards.', default: true },
    { key: 'taskDistanceColor', type: 'toggle', section: 'Hover Info', label: 'Task Distance Color Coding', desc: 'Colors each queued task from green (closest) to red (farthest) based on distance from your current position -- like the World Map’s trail colors, but visible with the map closed.', default: true },

    { key: 'walkDrawerMode', type: 'toggle', section: 'Walking Countdown', label: 'Slide-Down Drawer', desc: 'Show the walking countdown as a slim drawer that slides out of the Current Task panel instead of a separate floating panel.', default: true },
    { key: 'walkMeasuredSpeed', type: 'toggle', section: 'Walking Countdown', label: 'Measured Walking Speed', desc: 'Uses the live "(N)" distance in the Current Task panel to measure your real walking speed and ETA. Turn off to use the Vigor formula estimate only.', default: true },
    { key: 'walkSpeedBuffDetect', type: 'toggle', section: 'Walking Countdown', label: 'Speed Buff Detection', desc: 'Flags a walk that is clearly faster than your normal measured speed (e.g. a speed potion) next to the speed readout.', default: true },

    { key: 'raidAlertEnabled', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Raid Lobby Alerts', desc: 'Notifies you when an open raid lobby has a strong party and a free slot. Read-only: it never joins for you. Polls the open-lobby list every few seconds (the same request the game\u2019s Raids browser makes) and peeks at promising lobbies.', default: false },
    { key: 'raidAlertDungeon', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Dungeon Lobbies', desc: 'Include dungeon (feeble \u2192 ancient) lobbies.', default: true },
    { key: 'raidAlertGauntlet', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Fortress (Gauntlet) Lobbies', desc: 'Include Fortress lobbies (judged on the lobby\u2019s requirements and your roles).', default: false },
    { key: 'raidAlertMinStrength', type: 'number', section: 'Raid Lobby Alerts', label: 'Minimum Party Strength (%)', desc: 'Alert only when the party is at least this strong compared to you (100 = as strong as you, 150 = clearly stronger). Combines combat level, damage output, Slay and Life.', default: 100, min: 30, max: 400 },
    { key: 'raidAlertMinSlots', type: 'number', section: 'Raid Lobby Alerts', label: 'Minimum Open Slots', desc: 'Alert only when at least this many slots are free.', default: 1, min: 1, max: 4 },
    { key: 'raidAlertMinTier', type: 'number', section: 'Raid Lobby Alerts', label: 'Minimum Difficulty Tier', desc: '1 = any dungeon, 2 = Dire and up, 3 = Savage and up, and so on.', default: 1, min: 1, max: 6 },
    { key: 'raidAlertCooldownSec', type: 'number', section: 'Raid Lobby Alerts', label: 'Cooldown Between Alerts (seconds)', desc: 'Minimum time between two alerts. Each lobby alerts once, each host once per hour.', default: 600, min: 30, max: 7200 },
    { key: 'raidAlertMaxPerHour', type: 'number', section: 'Raid Lobby Alerts', label: 'Max Alerts Per Hour', desc: 'Hard cap on notifications per hour.', default: 3, min: 1, max: 30 },
    { key: 'raidAlertQuiet', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Quiet Hours', desc: 'No raid notifications during the quiet window below (your local time).', default: true },
    { key: 'raidAlertQuietFrom', type: 'number', section: 'Raid Lobby Alerts', label: 'Quiet Hours Start (hour, 0-23)', desc: 'Notifications stop at this hour.', default: 23, min: 0, max: 23 },
    { key: 'raidAlertQuietTo', type: 'number', section: 'Raid Lobby Alerts', label: 'Quiet Hours End (hour, 0-23)', desc: 'Notifications resume at this hour.', default: 8, min: 0, max: 23 },
    { key: 'raidAlertPollSec', type: 'number', section: 'Raid Lobby Alerts', label: 'Check Interval (seconds)', desc: 'How often the lobby list is checked. Lower = faster alerts, more requests.', default: 12, min: 8, max: 120 },
    { key: 'raidAlertAllWorlds', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Include Other Worlds', desc: 'Lobbies on other worlds cannot be inspected, so they are judged by the host\u2019s hiscores rank (below).', default: false },
    { key: 'raidAlertHostRank', type: 'number', section: 'Raid Lobby Alerts', label: 'Other Worlds: Max Host Rank', desc: 'For other-world lobbies: alert only if the host\u2019s overall hiscores rank is this good or better.', default: 1000, min: 10, max: 100000 },
    { key: 'raidAlertSkipAfk', type: 'toggle', section: 'Raid Lobby Alerts', label: 'Skip "AFK" Lobbies', desc: 'Ignore lobbies whose name contains the word AFK.', default: false },
    { key: 'inventorySlotCount', type: 'toggle', section: 'Panels', label: 'Inventory Slot Counter', desc: 'Shows (used/total) slots next to the Inventory title, e.g. (0/32).', default: true },
    { key: 'panelSmoothMove', type: 'toggle', section: 'Panels', label: 'Smooth Panel Dragging', desc: 'Makes a panel follow your mouse exactly 1:1 when you drag it by its title bar (resized panels used to jump when grabbed and drift away from the pointer).', default: true },
    { key: 'panelSnap', type: 'toggle', section: 'Panels', label: 'Snap Panels To Edges', desc: 'While dragging, panels pull onto the edges of other panels and the screen, with a gold guide line. Hold Shift to drag without snapping. When two panels snap edge to edge, a small Fuse button appears.', default: true },
    { key: 'panelAutoFuse', type: 'toggle', section: 'Panels', label: 'Auto-Fuse Snapped Panels', desc: 'Fuse two panels automatically when you drop one snapped against the other, instead of offering the Fuse button. Fused panels still separate with the link button in their title bars.', default: false },
    { key: 'fuseGroupToggle', type: 'toggle', section: 'Panels', label: 'Fused Panels Open And Close Together', desc: 'Closing one panel of a fused row closes the whole row, and opening one opens the rest, so a fused group acts like a single panel.', default: true },
    { key: 'panelFuseEnabled', type: 'toggle', section: 'Panels', label: 'Panel Fuse', desc: 'When two panels sit edge to edge, a link button appears in their title bars. Fusing snaps them flush, cleans up the seam and moves them together when dragged.', default: true },
    { key: 'sidebarTabsEnabled', type: 'toggle', section: 'Sidebar', label: 'Side Menu Tab Controls', desc: 'Adds a show/hide switch and a sticky pin to each side-menu icon in Settings > Hotkeys. Sticky icons stay visible when you minimize the side menu with the arrow at the top. Turning this off restores the game’s own behaviour.', default: true },
    { key: 'xpTrackerEnabled', type: 'toggle', section: 'XP Tracker', label: 'Show XP/hr Tracker', desc: 'A small draggable chip with your live XP/hr over a rolling window, your busiest skills and an ETA to their next level.', default: true },
    { key: 'xpTrackerWindowMin', type: 'number', section: 'XP Tracker', label: 'Rate Window (minutes)', desc: 'How far back the XP/hr is measured. Shorter reacts faster, longer is steadier.', default: 5, min: 1, max: 60 },

    { key: 'osNotifyWhenFocused', type: 'toggle', section: 'Notifications', label: 'Notify While Focused', desc: 'The game normally only sends its Windows notifications (and so Pushover) while you are tabbed away. Turn on to get them even while the game window is focused. Which events notify is still controlled by the game’s own notification settings.', default: true },

    { key: 'gameBridgeEnabled', type: 'toggle', section: 'Route Advisor', label: 'Game Data Bridge', desc: 'Lets the Route Advisor read the game’s own task duration / XP-per-hour projections (read-only, the same numbers the in-game Dashboard shows) for its XP/hr, tasks/hr and quest modes. Without it only walking time is optimised.', default: true },
    { key: 'mapRouteLanes', type: 'toggle', section: 'Route Advisor', label: 'Map Route Lanes & Arrows', desc: 'On the World Map, overlapping route legs are drawn side by side (in queue order) and the dashed pills become arrows moving in the direction of travel. Display only.', default: true },
    { key: 'guideRouteAdvisor', type: 'button', section: 'Route Advisor', label: 'Guide', desc: 'How to read the plan, the purple / blue borders and the warning tab.', buttonText: 'Open guide' },
    { key: 'routeTpWorthMin', type: 'number', section: 'Route Advisor', label: 'Teleport Worth It (minutes saved per charge)', desc: 'If you plan on foot, teleports are only suggested when they save at least this many minutes per teleport charge used.', default: 10, min: 1, max: 600 },
    { key: 'routeTaskWeights', type: 'taskw', section: 'Route Advisor', label: 'Task Weights (Exceptions)', desc: 'Extra worth for specific tasks, on top of the skill priorities above. Meant for exceptions only, such as brewing Swift Potions. Each rule has a task id (or several, separated by |) and a multiplier: 2 = counts double, 1 = no change. A rule matches when the task id contains the text.', default: [{ match: 'swift_potion|fleet_potion|haste_potion', mult: 2.5 }, { match: 'potion_of_discovery', mult: 2.5 }] },
    { key: 'routePriorities', type: 'prio', section: 'Route Advisor', label: 'Skill Priorities', desc: 'How much a level in each skill is worth when the Route Advisor compares paths (1 = normal, 2 = twice as valuable). The default follows the community order: Vigor first, then healing and your combat gear chain, then potions. Combat skills also use the Combat Level Weight below.' },
    { key: 'routeCombatWeightPct', type: 'number', section: 'Route Advisor', label: 'Combat Level Weight (%)', desc: 'Paths are compared in levels gained per hour. One combat task trains several cheap skills at once, so combat levels would always win; this counts them at this percentage (100 = equal to a skilling level).', default: 40, min: 0, max: 200 },
    { key: 'routePickPenaltyPct', type: 'number', section: 'Route Advisor', label: 'Pick Swap Cost (%)', desc: 'A path only swaps one of your option picks when the swap improves it by roughly this much on its own, so you get a few justified swaps instead of all or none.', default: 3, min: 0, max: 20 },
    { key: 'routeAdvisorEnabled', type: 'toggle', section: 'Route Advisor', label: 'Enable Route Advisor', desc: 'Suggests the order of your queued tasks that minimises walking time, with and without teleport crystals. Display only: you apply a suggestion by dragging rows yourself.', default: true },
    { key: 'routeAdvisorAutoMap', type: 'toggle', section: 'Route Advisor', label: 'Show Panel on World Map', desc: 'Automatically show the Route Advisor panel whenever the World Map is open.', default: true },
    { key: 'routeAdvisorAlert', type: 'toggle', section: 'Route Advisor', label: 'Route Badge On The Tasks Panel', desc: 'A small badge above the task queue: a yellow warning when a faster route exists (dismiss it with the ×), then a green badge that keeps showing the time that could be saved, or Route optimal. Click it to open the Route Advisor without the World Map.', default: true },
    { key: 'routeAdvisorMinSaveSec', type: 'number', section: 'Route Advisor', label: 'Alert Threshold (seconds)', desc: 'Only warn when the suggested route saves at least this much walking time.', default: 30, min: 5, max: 600 },
    { key: 'routePushover', type: 'toggle', section: 'Route Advisor', label: 'Notify on Big Savings', desc: 'Sends a notification (forwarded to Pushover by your notification listener) when a much faster route exists. At most once per suggestion and once every 30 minutes.', default: true },
    { key: 'osNotifyDismissSec', type: 'number', section: 'Notifications', label: 'Auto-Dismiss Windows Notifications (seconds)', desc: 'Closes each Windows notification this many seconds after it appears, and clears any that are left when you return to the game, so they do not pile up. 0 keeps them until you dismiss them.', default: 10, min: 0, max: 600 },
    { key: 'routePushoverMinSaveSec', type: 'number', section: 'Route Advisor', label: 'Notification Threshold (seconds)', desc: 'Only notify when the suggested route saves at least this much walking time (300 = 5 minutes).', default: 300, min: 30, max: 3600 },

  ];

  // Bigger categories ("groups"): the Plugins tab and its quick-jump menu show these, each holding the related sections.
  // Sections not listed here land in "More". About is a standalone, centred row.
  const GROUPS = [
    ['ScapeLite', ['ScapeLite Core']],
    ['About', null],
    ['Discord', ['Chat Relay', 'Chat Relay Pings', 'Clan Hiscores', 'Raid Summary', 'Activity Digest', 'Raid Lobby Alerts']],
    ['Tasks and routes', ['Route Advisor', 'Walking Countdown', 'XP Tracker']],
    ['Interface', ['Panels', 'Panel Mod', 'Sidebar', 'Notifications', 'Hover Info', 'Bank']],
  ];
  const PING_CATS = [['rareDrop', 'Rare drops'], ['shinyRareDrop', 'Ultra rares'], ['pet', 'Pets'], ['shinyPet', 'Shiny pets'], ['unlock', 'Unlocks'], ['levelUp', 'Level ups'], ['quest', 'Quests']];

  function val(key) {
    const def = SCHEMA.find(s => s.key === key);
    return values[key] !== undefined ? values[key] : (def ? def.default : undefined);
  }

  const controls = {}; // key -> { switchEl } or { inputEl }
  // Secrets (webhook URLs, keys) are NEVER written to localStorage. They live in page memory only:
  // the watcher seeds them from its own config files and collects edits via takeSecrets().
  const secretVals = {}, pendingSecrets = {};

  function setVal(key, v) {
    values[key] = v;
    save();
    if (key === 'edgeSnapEnabled' && window.__ccPanelScale && window.__ccPanelScale.setEdgeSnapEnabled) {
      window.__ccPanelScale.setEdgeSnapEnabled(v);
    }
  }

  function buildRowShell(item) {
    const row = document.createElement('div');
    row.className = 'settings-toggle-row';
    const text = document.createElement('div');
    text.className = 'settings-toggle-text';
    const label = document.createElement('div');
    label.className = 'settings-toggle-label';
    label.textContent = item.label;
    text.appendChild(label);
    if (item.desc) {
      const desc = document.createElement('div');
      desc.className = 'settings-toggle-desc';
      desc.textContent = item.desc;
      text.appendChild(desc);
    }
    row.appendChild(text);
    return row;
  }

  function buildToggleRow(item) {
    const row = buildRowShell(item);
    const sw = document.createElement('div');
    sw.className = 'settings-switch' + (val(item.key) ? ' on' : '');
    const knob = document.createElement('div');
    knob.className = 'settings-switch-knob';
    sw.appendChild(knob);
    sw.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const next = !val(item.key);
      setVal(item.key, next);
      sw.classList.toggle('on', next);
    });
    row.appendChild(sw);
    controls[item.key] = { switchEl: sw };
    return row;
  }

  function buildButtonRow(item) {
    const row = buildRowShell(item);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.buttonText || 'Run';
    btn.style.cssText = 'background:#2a2a35;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:6px 16px;font:inherit;cursor:pointer;';
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#777'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#444'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (item.key === 'resetScales' && window.__ccPanelScale) window.__ccPanelScale.reset();
      if (item.key === 'showWelcome' && window.__ccWelcome) window.__ccWelcome.open();
      if (item.key === 'showSetup' && window.__ccWelcome && window.__ccWelcome.openSetup) { window.__ccWelcome.openSetup(); try { const m = document.querySelector('.modal-overlay'), b = document.querySelector('.floating-tab-btn[data-tab=settings]'); if (b && m && getComputedStyle(m).display !== 'none') b.click(); } catch (er) {} }
      if (item.key === 'guideChatRelay' && window.__ccWelcome) { window.__ccWelcome.openGuide('chat-relay'); try { const m = document.querySelector('.modal-overlay'), b = document.querySelector('.floating-tab-btn[data-tab=settings]'); } catch (er) {} }
      if (item.key === 'guideRouteAdvisor' && window.__ccWelcome) window.__ccWelcome.openGuide('route-advisor');
      if (item.key === 'checkUpdates') { window.__ccUpdateReq = 'check'; if (infoEls.aboutInfo && infoEls.aboutInfo.descEl) infoEls.aboutInfo.descEl.textContent = 'Checking\u2026'; setTimeout(refreshAbout, 4000); setTimeout(refreshAbout, 9000); }
      if (item.key === 'applyUpdate') { window.__ccUpdateReq = 'apply'; if (infoEls.aboutInfo && infoEls.aboutInfo.descEl) infoEls.aboutInfo.descEl.textContent = 'Updating\u2026'; setTimeout(refreshAbout, 6000); setTimeout(refreshAbout, 15000); }
      if (item.key === 'openLayouts' && window.__ccLayouts) { window.__ccLayouts.open(); }
      if (item.key === 'reportBug' && window.__ccBugReport) { window.__ccBugReport.open(); }
      if (item.key === 'moveNotifications' && window.__ccNotifDock) { window.__ccNotifDock.edit(true); const m = document.querySelector('.modal-overlay'); try { const b = document.querySelector('.floating-tab-btn[data-tab=settings]'); if (b && m && getComputedStyle(m).display !== 'none') b.click(); } catch (er) {} }
      const original = btn.textContent;
      btn.textContent = 'Done';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
    row.appendChild(btn);
    return row;
  }

  const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A10.7 10.7 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22"/></svg>';
  function buildSecretRow(item) {
    const row = buildRowShell(item);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:none;';
    const input = document.createElement('input');
    input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false;
    input.placeholder = item.placeholder || '';
    input.value = secretVals[item.key] || '';
    input.style.cssText = 'width:260px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:5px 8px;font:inherit;';
    const eye = document.createElement('button');
    eye.type = 'button'; eye.innerHTML = EYE; eye.title = 'Show / hide';
    eye.style.cssText = 'background:#2a2a35;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:5px 7px;cursor:pointer;display:grid;place-items:center;';
    eye.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.innerHTML = show ? EYE_OFF : EYE;
    });
    ['keydown', 'keyup', 'keypress'].forEach(t => input.addEventListener(t, ev => ev.stopPropagation())); // keep game hotkeys out of the field
    input.addEventListener('change', () => {
      const v = input.value.trim();
      secretVals[item.key] = v; pendingSecrets[item.key] = v;
    });
    wrap.appendChild(input); wrap.appendChild(eye);
    row.appendChild(wrap);
    controls[item.key] = { secretEl: input };
    return row;
  }

  function buildTextRow(item) {
    const row = buildRowShell(item);
    const input = document.createElement('input');
    input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off';
    input.placeholder = item.placeholder || '';
    input.value = String(val(item.key) == null ? '' : val(item.key));
    input.style.cssText = 'width:200px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:5px 8px;font:inherit;';
    ['keydown', 'keyup', 'keypress'].forEach(t => input.addEventListener(t, ev => ev.stopPropagation())); // keep game hotkeys out of the field
    input.addEventListener('change', () => setVal(item.key, input.value.trim()));
    row.appendChild(input);
    controls[item.key] = { inputEl: input };
    return row;
  }

  // ---- ping roles editor ----
  function buildRolesRow(item) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-toggle-row';
    wrap.style.cssText = 'display:block;';
    const head = document.createElement('div'); head.className = 'settings-toggle-text';
    head.innerHTML = '<div class="settings-toggle-label"></div><div class="settings-toggle-desc"></div>';
    head.firstChild.textContent = item.label; head.lastChild.textContent = item.desc || '';
    wrap.appendChild(head);
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:10px;';
    wrap.appendChild(list);
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Create ping role';
    add.style.cssText = 'margin-top:10px;background:#2a2a35;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer;';
    wrap.appendChild(add);
    const roles = () => { const v = val(item.key); return Array.isArray(v) ? v : []; };
    const commit = (arr) => { setVal(item.key, arr); };
    function render() {
      list.textContent = '';
      const cur = roles();
      if (!cur.length) { const e = document.createElement('div'); e.textContent = 'No ping roles yet. Nothing is mentioned until you create one.'; e.style.cssText = 'color:#8a8a96;font-size:12px;'; list.appendChild(e); }
      cur.forEach((r, i) => {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid #3a3a48;border-radius:8px;padding:10px;background:rgba(255,255,255,.03);';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        const mk = (ph, w, v, fn) => { const x = document.createElement('input'); x.type = 'text'; x.placeholder = ph; x.value = v || ''; x.spellcheck = false; x.autocomplete = 'off'; x.style.cssText = 'width:' + w + 'px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:5px 8px;font:inherit;'; ['keydown', 'keyup', 'keypress'].forEach(t => x.addEventListener(t, ev => ev.stopPropagation())); x.addEventListener('change', () => fn(x)); return x; };
        top.appendChild(mk('Name (for you)', 150, r.name, (x) => { const a = roles().slice(); a[i] = Object.assign({}, a[i], { name: x.value.trim() }); commit(a); }));
        const idIn = mk('Discord role ID', 200, r.roleId, (x) => { const digits = (x.value.match(/\d{6,}/) || [''])[0]; x.value = digits; const a = roles().slice(); a[i] = Object.assign({}, a[i], { roleId: digits }); commit(a); });
        top.appendChild(idIn);
        const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.style.cssText = 'margin-left:auto;background:#2a2a35;color:#e0a0a0;border:1px solid #5a3a3a;border-radius:6px;padding:4px 12px;font:inherit;cursor:pointer;';
        del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = roles().slice(); a.splice(i, 1); commit(a); render(); });
        top.appendChild(del);
        card.appendChild(top);
        const cats = document.createElement('div'); cats.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
        PING_CATS.forEach(([k, label]) => {
          const on = (r.categories || []).indexOf(k) !== -1;
          const chip = document.createElement('button'); chip.type = 'button'; chip.textContent = label;
          const paint = (o) => { chip.style.cssText = 'padding:3px 11px;border-radius:12px;font:inherit;font-size:12px;cursor:pointer;border:1px solid ' + (o ? '#4a90e2' : '#444') + ';background:' + (o ? 'rgba(74,144,226,.22)' : '#22222c') + ';color:' + (o ? '#cfe6ff' : '#9a9aa6') + ';'; };
          paint(on);
          chip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = roles().slice(); const c = (a[i].categories || []).slice(); const ix = c.indexOf(k); if (ix >= 0) c.splice(ix, 1); else c.push(k); a[i] = Object.assign({}, a[i], { categories: c }); commit(a); paint(ix < 0); });
          cats.appendChild(chip);
        });
        card.appendChild(cats);
        list.appendChild(card);
      });
    }
    add.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = roles().slice(); a.push({ name: 'Role ' + (a.length + 1), roleId: '', categories: [] }); commit(a); render(); });
    render();
    controls[item.key] = { rolesRender: render };
    return wrap;
  }

  // ---- task weight rules editor ----
  function buildTaskWRow(item) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-toggle-row';
    wrap.style.cssText = 'display:block;';
    const head = document.createElement('div'); head.className = 'settings-toggle-text';
    head.innerHTML = '<div class="settings-toggle-label"></div><div class="settings-toggle-desc"></div>';
    head.firstChild.textContent = item.label; head.lastChild.textContent = item.desc || '';
    wrap.appendChild(head);
    const dl = document.createElement('datalist'); dl.id = 'cc-taskw-ids'; wrap.appendChild(dl);
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:10px;';
    wrap.appendChild(list);
    const btnCss = 'background:#2a2a35;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer;';
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Add rule'; add.style.cssText = btnCss;
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset to defaults'; reset.style.cssText = btnCss;
    bar.appendChild(add); bar.appendChild(reset); wrap.appendChild(bar);
    const rules = () => { const v = val(item.key); return Array.isArray(v) ? v : []; };
    const commit = (a) => setVal(item.key, a);
    function suggest() {
      try { const p = window.__ccBridge && window.__ccBridge.project(); const ids = new Set(); p && [p.head].concat((p.slots || []).flatMap((s) => s.options)).forEach((o) => { if (o && o.act) ids.add(o.act); }); dl.textContent = ''; [...ids].sort().forEach((x) => { const o = document.createElement('option'); o.value = x; dl.appendChild(o); }); } catch (e) {}
    }
    function render() {
      suggest(); list.textContent = '';
      const cur = rules();
      if (!cur.length) { const e = document.createElement('div'); e.textContent = 'No rules. Every task is valued by its skill alone.'; e.style.cssText = 'color:#8a8a96;font-size:12px;'; list.appendChild(e); }
      cur.forEach((r, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;';
        const inCss = 'background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:6px;padding:6px 8px;font:inherit;';
        const m = document.createElement('input'); m.type = 'text'; m.value = r.match || ''; m.placeholder = 'task id, e.g. swift_potion'; m.setAttribute('list', 'cc-taskw-ids'); m.spellcheck = false; m.autocomplete = 'off'; m.style.cssText = inCss + 'flex:1;min-width:0;';
        m.addEventListener('change', () => { const a = rules().slice(); a[i] = Object.assign({}, a[i], { match: m.value.trim().toLowerCase() }); commit(a); });
        const x = document.createElement('span'); x.textContent = '×'; x.style.color = '#9a9aa8';
        const n = document.createElement('input'); n.type = 'number'; n.step = '0.1'; n.min = '0'; n.max = '10'; n.value = r.mult != null ? r.mult : 1; n.style.cssText = inCss + 'width:70px;';
        n.addEventListener('change', () => { const v = Math.max(0, Math.min(10, parseFloat(n.value))); const a = rules().slice(); a[i] = Object.assign({}, a[i], { mult: Number.isFinite(v) ? v : 1 }); commit(a); n.value = a[i].mult; });
        const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.style.cssText = 'background:#2a2a35;color:#e0a0a0;border:1px solid #5a3a3a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer;';
        del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = rules().slice(); a.splice(i, 1); commit(a); render(); });
        [m, x, n, del].forEach((e) => { ['keydown', 'keyup', 'keypress'].forEach((t) => e.addEventListener(t, (ev) => ev.stopPropagation())); row.appendChild(e); });
        list.appendChild(row);
      });
    }
    add.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = rules().slice(); a.push({ match: '', mult: 2 }); commit(a); render(); });
    reset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); commit(JSON.parse(JSON.stringify(item.default))); render(); });
    render();
    controls[item.key] = { taskwRender: render };
    return wrap;
  }

  // ---- skill priorities editor ----
  const PRIO_SKILLS = [['vigor', 'Vigor'], ['fish', 'Fish'], ['cook', 'Cook'], ['mine', 'Mine'], ['smith', 'Smith'], ['forage', 'Forage'], ['craft', 'Craft'], ['invoke', 'Invoke'], ['imbue', 'Imbue'], ['farm', 'Farm'], ['brew', 'Brew'], ['plunder', 'Plunder'], ['barter', 'Barter'], ['bard', 'Bard'], ['discover', 'Discover'], ['alms', 'Alms'], ['luck', 'Luck'], ['delve', 'Delve'], ['fortify', 'Fortify']];
  const PRIO_PROFILES = {
    'Even progress': { _even: 1 },
    'Vigor and gear first': { vigor: 2, fish: 1.3, cook: 1.3, mine: 1.2, smith: 1.2, forage: 1.2, craft: 1.2, invoke: 1.2, imbue: 1.2, farm: 1.15, brew: 1.15, plunder: 1, barter: 0.8, bard: 0.8, discover: 0.8, alms: 0.8, luck: 0.7, delve: 0.5, fortify: 0.5 },
    'Balanced': {},
    'Melee gear first': { vigor: 1.6, fish: 1.4, cook: 1.4, mine: 1.8, smith: 1.8, farm: 1.2, brew: 1.2, forage: 0.9, craft: 0.9, invoke: 0.9, imbue: 0.9 },
    'Ranged gear first': { vigor: 1.6, fish: 1.4, cook: 1.4, forage: 1.8, craft: 1.8, farm: 1.2, brew: 1.2, mine: 0.9, smith: 0.9, invoke: 0.9, imbue: 0.9 },
    'Magic gear first': { vigor: 1.6, fish: 1.4, cook: 1.4, invoke: 1.8, imbue: 1.8, farm: 1.2, brew: 1.2, mine: 0.9, smith: 0.9, forage: 0.9, craft: 0.9 },
    'Vigor focus': { vigor: 3 },
  };
  function buildPrioRow(item) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-toggle-row'; wrap.style.cssText = 'display:block;';
    const head = document.createElement('div'); head.className = 'settings-toggle-text';
    head.innerHTML = '<div class="settings-toggle-label"></div><div class="settings-toggle-desc"></div>';
    head.firstChild.textContent = item.label; head.lastChild.textContent = item.desc || '';
    wrap.appendChild(head);
    const profs = document.createElement('div'); profs.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;';
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px;margin-top:10px;';
    wrap.appendChild(profs); wrap.appendChild(grid);
    const cur = () => { const v = val(item.key); return v && typeof v === 'object' ? v : PRIO_PROFILES['Vigor and gear first']; };
    const inputs = {};
    function fill() { const c = cur(); PRIO_SKILLS.forEach(([k]) => { if (inputs[k]) inputs[k].value = String(c[k] != null ? c[k] : 1); }); }
    Object.keys(PRIO_PROFILES).forEach((name) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
      b.style.cssText = 'background:#2a2a35;color:#e0e0e0;border:1px solid #444;border-radius:12px;padding:3px 12px;font:inherit;font-size:12px;cursor:pointer;';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setVal(item.key, Object.assign({}, PRIO_PROFILES[name])); fill(); });
      profs.appendChild(b);
    });
    PRIO_SKILLS.forEach(([k, label]) => {
      const cell = document.createElement('label'); cell.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;color:#cfd3dc;font-size:13px;';
      const sp = document.createElement('span'); sp.textContent = label;
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.max = '5'; inp.step = '0.1';
      inp.style.cssText = 'width:64px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:3px 6px;font:inherit;text-align:center;';
      ['keydown', 'keyup', 'keypress'].forEach(t => inp.addEventListener(t, ev => ev.stopPropagation()));
      inp.addEventListener('change', () => { let n = parseFloat(inp.value); if (!Number.isFinite(n)) n = 1; n = Math.max(0, Math.min(5, n)); inp.value = String(n); const o = Object.assign({}, cur()); o[k] = n; setVal(item.key, o); });
      inputs[k] = inp; cell.appendChild(sp); cell.appendChild(inp); grid.appendChild(cell);
    });
    fill();
    controls[item.key] = { prioFill: fill };
    return wrap;
  }

  const infoEls = {};
  function buildInfoRow(item) {
    const row = buildRowShell(item);
    if (item.key === 'aboutInfo') {
      const v = document.createElement('div'); v.className = 'cc-about-val'; v.style.cssText = 'color:#cfe9ff;text-align:right;max-width:360px;font-size:13px;';
      row.appendChild(v); infoEls[item.key] = { valEl: v, descEl: row.querySelector('.settings-toggle-desc') };
    }
    return row;
  }
  const STATUS_URL = 'http://localhost:7777/status';
  async function refreshAbout() {
    const info = infoEls.aboutInfo; if (!info || !info.valEl.isConnected) return;
    try {
      const d = await (await fetch(STATUS_URL)).json();
      const u = d.update || {};
      info.valEl.textContent = 'v' + (u.version || '?') + (u.current && u.current.commit ? ' \u00b7 ' + u.current.commit : '');
      let t = u.error ? u.error : (u.message || '');
      if (u.behind > 0 && u.plugins && u.plugins.length) t += ' Plugins: ' + u.plugins.slice(0, 4).map(function (p) { return p.name + ' ' + (p.from ? p.from + '\u2192' : '') + p.to; }).join(', ') + '.';
      if (u.behind > 0 && u.commits && u.commits.length) t += ' Latest: ' + u.commits.slice(0, 2).join('; ') + '.';
      if (info.descEl) info.descEl.textContent = t || 'Not checked yet.';
      info.valEl.style.color = u.behind > 0 ? '#ffd24a' : u.error ? '#ff9d8f' : '#cfe9ff';
    } catch (e) { if (info.descEl) info.descEl.textContent = 'ScapeLite dashboard not reachable.'; }
  }
  setInterval(refreshAbout, 5000);

  function buildNumberRow(item) {
    const row = buildRowShell(item);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(item.min != null ? item.min : 1);
    input.max = String(item.max || 999);
    input.value = String(val(item.key));
    input.style.cssText = 'width:70px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:5px 8px;font:inherit;text-align:center;';
    input.addEventListener('change', () => {
      let n = parseInt(input.value, 10);
      if (!Number.isFinite(n)) n = item.default;
      n = Math.max(item.min != null ? item.min : 1, Math.min(item.max || 999, n));
      input.value = String(n);
      setVal(item.key, n);
    });
    row.appendChild(input);
    controls[item.key] = { inputEl: input };
    return row;
  }

  // "@Wulf" tag next to a section title; hovering shows the author's links (bug reports, suggestions, ...).
  let authorCard = null, authorHide = 0;
  function closeAuthorCard() { clearTimeout(authorHide); if (authorCard) { authorCard.remove(); authorCard = null; } }
  function addAuthorTag(header) {
    const authors = window.__CC_AUTHORS || {};
    const a = authors.Wulf || authors[Object.keys(authors)[0]];
    if (!a) return;
    const tag = document.createElement('span');
    tag.className = 'cc-author';
    tag.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="15" height="15" style="display:block"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="24" height="12" fill="#ffd24a"/><rect x="46" y="58" width="36" height="12" fill="#ffd24a"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg>';
    tag.style.cssText = 'margin-left:12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#ffd24a;cursor:help;vertical-align:middle;padding:3px 5px;border:1px solid rgba(255,210,74,.4);background:rgba(255,210,74,.12);border-radius:10px;display:inline-block;';
    tag.title = 'Made by the ScapeLite team' + (a.handle ? ' · by ' + a.handle : '');
    const open = () => {
      clearTimeout(authorHide);
      if (authorCard) return;
      const c = document.createElement('div');
      c.style.cssText = 'position:fixed;z-index:100003;min-width:230px;padding:10px 12px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.6);color:#ddd;font:13px/1.4 system-ui,sans-serif;';
      const t = document.createElement('div'); t.textContent = (a.handle || '') + (a.bio ? '  ·  ' + a.bio : ''); t.style.cssText = 'font-weight:700;margin-bottom:6px;color:#fff;'; c.appendChild(t);
      (a.links || []).forEach(l => {
        const x = document.createElement('a'); x.textContent = l.label; x.href = l.url; x.target = '_blank'; x.rel = 'noopener noreferrer';
        x.style.cssText = 'display:block;padding:3px 0;color:#7fb4ff;text-decoration:none;cursor:pointer;';
        x.addEventListener('mouseenter', () => { x.style.textDecoration = 'underline'; }); x.addEventListener('mouseleave', () => { x.style.textDecoration = 'none'; });
        c.appendChild(x);
      });
      if (a.discord) { const d = document.createElement('div'); d.textContent = 'Discord: ' + a.discord; d.style.cssText = 'padding:3px 0;color:#b9a8ff;'; c.appendChild(d); }
      c.addEventListener('mouseenter', () => clearTimeout(authorHide)); c.addEventListener('mouseleave', () => { authorHide = setTimeout(closeAuthorCard, 200); });
      document.body.appendChild(c);
      const r = tag.getBoundingClientRect(), cr = c.getBoundingClientRect();
      c.style.left = Math.max(4, Math.min(innerWidth - cr.width - 4, r.left)) + 'px';
      c.style.top = Math.min(innerHeight - cr.height - 4, r.bottom + 4) + 'px';
      authorCard = c;
    };
    if (!((a.links && a.links.length) || a.discord)) { tag.style.cursor = 'default'; header.appendChild(tag); return; } // nothing more to show on hover (the title above names the author)
    tag.addEventListener('mouseenter', open);
    tag.addEventListener('mouseleave', () => { authorHide = setTimeout(closeAuthorCard, 200); });
    header.appendChild(tag);
  }

  function buildSection(title, items) {
    const sec = document.createElement('div');
    sec.className = 'settings-section';
    sec.id = 'settings-sec-cc-' + title.toLowerCase().replace(/\s+/g, '-');
    const header = document.createElement('div');
    header.className = 'settings-section-header';
    header.textContent = title;
    addAuthorTag(header);
    sec.appendChild(header);
    for (const item of items) {
      if (item.type === 'toggle') sec.appendChild(buildToggleRow(item));
      else if (item.type === 'button') sec.appendChild(buildButtonRow(item));
      else if (item.type === 'number') sec.appendChild(buildNumberRow(item));
      else if (item.type === 'secret') sec.appendChild(buildSecretRow(item));
      else if (item.type === 'info') sec.appendChild(buildInfoRow(item));
      else if (item.type === 'text') sec.appendChild(buildTextRow(item));
      else if (item.type === 'roles') sec.appendChild(buildRolesRow(item));
      else if (item.type === 'prio') sec.appendChild(buildPrioRow(item));
      else if (item.type === 'taskw') sec.appendChild(buildTaskWRow(item));
    }
    return sec;
  }

  function buildAndInsert() {
    const nav = document.querySelector('.settings-header-nav');
    const settingsRoot = document.getElementById('tab-settings');
    if (!nav || !settingsRoot) return false;
    if (document.getElementById('cc-plugins-nav-btn')) return true; // already built this load

    const navBtn = document.createElement('button');
    navBtn.id = 'cc-plugins-nav-btn';
    navBtn.className = 'settings-nav-btn';
    navBtn.textContent = 'Plugins';
    nav.appendChild(navBtn);

    // #tab-settings is display:flex;flex-wrap:wrap with each
    // .settings-section fixed at 640px -- sections already flow side by
    // side when there's room, same as the game's own Display/Audio/etc.
    // An earlier version wrapped all of ours in one containing <div>,
    // which became a single flex item and forced them to stack instead of
    // participating in that wrap -- confirmed live, 2026-10-06. Fixed by
    // appending each section directly as a sibling of the game's own,
    // exactly like the game does it.
    const sections = {};
    const order = [];
    for (const item of SCHEMA) {
      if (!sections[item.section]) { sections[item.section] = []; order.push(item.section); }
      sections[item.section].push(item);
    }
    // Guides first inside every section (stable otherwise).
    Object.keys(sections).forEach((t) => { const g = sections[t].filter(i => /^guide/.test(i.key)), r = sections[t].filter(i => !/^guide/.test(i.key)); sections[t] = g.concat(r); });
    if (!document.getElementById('cc-plugin-ui-style')) {
      const st = document.createElement('style'); st.id = 'cc-plugin-ui-style';
      st.textContent = '.cc-group-head{flex:0 0 100%;display:flex;align-items:center;gap:12px;margin:22px 0 2px;color:#9aa4b8;font:700 12px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase}.cc-group-head::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.22),transparent)}.cc-row-break{flex:0 0 100%;height:0}.settings-section.cc-solo{margin-left:auto !important;margin-right:auto !important}';
      document.head.appendChild(st);
    }
    const ownSections = [];
    const placed = new Set();
    const addSection = (title, group) => { const sec = buildSection(title, sections[title]); sec.dataset.ccGroup = group || ''; ownSections.push(sec); placed.add(title); return sec; };
    const addGroupHead = (name) => { const h = document.createElement('div'); h.className = 'cc-group-head'; h.dataset.ccGroup = name; h.id = 'settings-sec-cc-group-' + name.toLowerCase().replace(/\s+/g, '-'); h.textContent = name; settingsRoot.appendChild(h); };
    const brk = () => { const b = document.createElement('div'); b.className = 'cc-row-break'; settingsRoot.appendChild(b); };
    for (const [gname, titles] of GROUPS) {
      if (titles === null) { // standalone, centred, on its own row
        if (!sections[gname]) continue;
        brk(); const sec = addSection(gname, ''); sec.classList.add('cc-solo'); settingsRoot.appendChild(sec); brk();
        continue;
      }
      const have = titles.filter(t => sections[t]);
      if (!have.length) continue;
      addGroupHead(gname);
      have.forEach(t => settingsRoot.appendChild(addSection(t, gname)));
    }
    const rest = order.filter(t => !placed.has(t));
    if (rest.length) { addGroupHead('More'); rest.forEach(t => settingsRoot.appendChild(addSection(t, 'More'))); }

    navBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      ownSections[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Apply edge-snap setting to the panel mod right away, in case it
    // loaded before this did (or vice versa).
    if (window.__ccPanelScale && window.__ccPanelScale.setEdgeSnapEnabled) {
      window.__ccPanelScale.setEdgeSnapEnabled(val('edgeSnapEnabled'));
    }

    return true;
  }

  function startWhenReady() {
    if (buildAndInsert()) return;
    const root = document.documentElement || document.body;
    if (!root) { document.addEventListener('DOMContentLoaded', startWhenReady, { once: true }); return; }
    const waiter = new MutationObserver(() => { if (buildAndInsert()) waiter.disconnect(); });
    waiter.observe(root, { childList: true, subtree: true });
  }
  startWhenReady();

  function teardown() {
    const btn = document.getElementById('cc-plugins-nav-btn');
    if (btn) btn.remove();
    closeAuthorCard();
    document.querySelectorAll('[id^="settings-sec-cc-"], .cc-group-head, .cc-row-break').forEach(sec => sec.remove());
    const ps = document.getElementById('cc-plugin-ui-style'); if (ps) ps.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc plugins-settings-ui torn down';
  }

  window[NS] = {
    version: 1,
    teardown,
    get(key) { return val(key); },
    get prioProfiles() { return PRIO_PROFILES; },
    // Called by the watcher: returns every current value as a plain
    // object, so Node-side code can decide behavior from it.
    getAll() {
      const out = {};
      for (const item of SCHEMA) if (item.type !== 'secret') out[item.key] = val(item.key);
      return out;
    },
    // Called once by the watcher right after connecting, to seed
    // displayed toggle state from the REAL current config file values --
    // without this, a watcher restart would show stale localStorage
    // values (or schema defaults) instead of what's actually configured.
    // Secrets: in-memory only; collected by the watcher (it writes them into its own config files).
    takeSecrets() { const o = Object.assign({}, pendingSecrets); for (const k in pendingSecrets) delete pendingSecrets[k]; return o; },
    seedSecrets(obj) {
      for (const k in (obj || {})) { if (pendingSecrets[k] !== undefined) continue; secretVals[k] = obj[k]; if (controls[k] && controls[k].secretEl) controls[k].secretEl.value = obj[k] || ''; }
    },
    seed(obj) {
      Object.assign(values, obj || {});
      save();
      for (const key in controls) {
        const c = controls[key];
        if (c.switchEl) c.switchEl.classList.toggle('on', !!val(key));
        if (c.inputEl) c.inputEl.value = String(val(key));
        if (c.rolesRender) c.rolesRender(); if (c.taskwRender) c.taskwRender();
        if (c.prioFill) c.prioFill();
      }
    },
  };

  console.log('[cc] plugins-settings-ui loaded');
  return 'cc plugins-settings-ui loaded';
})();
