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
  const life = window.__ccLife.scope('plugins-settings-ui');   // listeners go through it: a re-inject cannot leave a second copy

  let values = {};
  try { values = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { values = {}; }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(values)); } catch (e) {} };

  const SCHEMA = [
    { key: 'logsEnabled', type: 'toggle', section: 'Logs', label: 'Save Logs to Files', desc: 'Writes ScapeLite’s logs into the Logs folder, one sub-folder per kind of log (System, Watcher, Discord, Tasks, Fortress, Drops, Alerts, Perf, Errors). File names start with what they log and the date and time they were started, e.g. Tasks/Slayer_Tasks_2026-10-20_09-15-02.log. Turn off to save nothing. Logs never leave this computer, and webhook URLs and other secrets are never written.', default: true },
    { key: 'logsLevel', type: 'select', section: 'Logs', label: 'Log Detail', desc: 'Normal keeps the useful lines. Detailed adds debug lines for troubleshooting (bigger files). Warnings only keeps just problems.', options: [['info', 'Normal'], ['debug', 'Detailed (debug)'], ['warn', 'Warnings and errors only'], ['error', 'Errors only']], default: 'info' },
    { key: 'logsKeepDays', type: 'number', section: 'Logs', label: 'Keep Diagnostic Logs For (days)', desc: 'System, Watcher, Discord, Alerts, Perf and Errors files older than this are deleted automatically (Alerts are kept 30 days and Perf 7 at most). 1 to 365.', default: 14, min: 1, max: 365 },
    { key: 'logsHistoryDays', type: 'number', section: 'Logs', label: 'Keep History Logs For (days)', desc: 'Tasks, Fortress runs and Drops are your history, so they are kept longer. Deleting them never touches the Task Log inside the game, but the log files are what the Task Log is rebuilt from if the browser data is ever cleared. 1 to 3650.', default: 90, min: 1, max: 3650 },
    { key: 'logsMaxMB', type: 'number', section: 'Logs', label: 'Size Limit Per Log Folder (MB)', desc: 'When a folder grows past this the oldest files in it are deleted first. Each file also starts a new one at about 5 MB and at midnight.', default: 100, min: 1, max: 10240 },
    { key: 'logsStructured', type: 'toggle', section: 'Logs', label: 'Also Save Data Files (.jsonl)', desc: 'Next to the readable .log files, the Tasks, Fortress, Drops, Alerts and Perf channels also write a .jsonl file with the same entries as data (one JSON object per line) for spreadsheets and scripts. The Task Log recovery needs the Tasks one.', default: true },
    { key: 'logsTasks', type: 'toggle', section: 'Logs', label: 'Log: Tasks', desc: 'Every task you finish (Logs/Tasks: Skilling_Tasks and Slayer_Tasks files).', default: true },
    { key: 'logsFortress', type: 'toggle', section: 'Logs', label: 'Log: Fortress Runs', desc: 'Fortress runs (Logs/Fortress).', default: true },
    { key: 'logsDrops', type: 'toggle', section: 'Logs', label: 'Log: Drops', desc: 'Notable drops the trackers saw (Logs/Drops).', default: true },
    { key: 'logsAlerts', type: 'toggle', section: 'Logs', label: 'Log: Alerts', desc: 'What the alerts bell raised (Logs/Alerts).', default: true },
    { key: 'logsPerf', type: 'toggle', section: 'Logs', label: 'Log: Performance', desc: 'A performance sample about once a minute (Logs/Perf).', default: true },
    { key: 'logsDiscord', type: 'toggle', section: 'Logs', label: 'Log: Discord Posts', desc: 'What was relayed or posted to Discord (Logs/Discord). Webhook URLs are never written.', default: true },
    { key: 'openLogsFolder', type: 'button', section: 'Logs', label: 'Open Logs Folder', desc: 'Opens the Logs folder in Explorer. The dashboard also has a log viewer: http://localhost:7777/logs', buttonText: 'Open' },
    { key: 'welcomeTourEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Show Welcome Tour on First Launch', desc: 'A short popup explaining where the plugin settings, the dashboard and the marketplace are. It is only shown once.', default: true },
    { key: 'showLooks', type: 'button', section: 'ScapeLite Core', label: 'ScapeLite Look', desc: 'Pick how much of ScapeLite you see: the game as it is (Vanilla), ScapeLite’s Info Bar next to the game’s panels (Combination), or ScapeLite’s own bar, cards and task queue instead of the game’s panels (ScapeLite only). Changing any single option afterwards makes it Custom.', buttonText: 'Choose' },
    { key: 'showSetup', type: 'button', section: 'ScapeLite Core', label: 'Play Style Setup', desc: 'The few preference questions asked on first launch (combat style, teleports, combat vs skilling weight, notifications). Answering again re-applies the matching defaults.', buttonText: 'Open' },
    { key: 'showWelcome', type: 'button', section: 'ScapeLite Core', label: 'Show Welcome Tour', desc: 'Replay the tour now.', buttonText: 'Show' },
    { key: 'settingsNavMenu', type: 'toggle', section: 'ScapeLite Core', label: 'Settings Quick-Jump Menu', desc: 'Hovering a category in the Settings header (Build, Display, Plugins, ...) opens a list of its sub-categories; click one to jump there.', default: true },
    { key: 'statusIndicatorEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Show Status Indicator', desc: 'A small corner dot showing whether the watcher/Discord features are connected and working, with a hover menu and a link to the full dashboard.', default: true },
    { key: 'usageStatsEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Share Anonymous Usage Data', desc: 'SENT, at most once a day, to GoatCounter (a privacy-friendly counter): the page /active, the ScapeLite version and, as with any web request, your IP address and browser/OS name (GoatCounter does not store the IP, it only counts unique visitors). NEVER SENT: your name, character, account, game progress or data, settings, plugin list, webhooks, or anything you do. No cookies, no ID is saved. Switch off to send nothing.', default: true },
    { key: 'leverAdvisorEnabled', type: 'toggle', section: 'Route Advisor', label: 'Lever Advisor', desc: 'Next to the Skills Customization window (skill weights and slay mob weights): a panel with routes to pick from, and a yellow outline on the levers worth pulling within your credits, orange on levers worth lowering. It never presses anything.', default: true },
    { key: 'leverAdvisorMasterPick', type: 'toggle', section: 'Route Advisor', label: 'Lever Advisor: Slay Master Picker', desc: 'On the Slay page of the Skills Customization window, the Lever Advisor lets you choose which slayer master its advice is for (the mobs it can roll, their odds now and after the plan), not only the one the game has selected. When it is not the master the game has selected, nothing is outlined. Also adds the route "Easy kills for combat levels" (least food and risk first). Display only.', default: true },
    { key: 'leverAdvisorFocus', type: 'toggle', section: 'Route Advisor', label: 'Lever Advisor: Focus On One Or Two Mobs', desc: 'On the Slay page, the routes that hunt XP-boost drops or unfinished collections can aim your credits at one or two mobs instead of spreading them (running between mobs costs time). Pick the mob count in the drawer. Off = always spread. Display only.', default: true },
    { key: 'taskLogEnabled', type: 'toggle', section: 'Route Advisor', label: 'Task Log', desc: 'Records every task you run (what it was, time split into walking / acting / banking, the XP it really paid, and what the dashboard and the Route Advisor predicted) in this browser profile only. Nothing is sent anywhere. It is used to check and tune the advisor.', default: true },
    { key: 'slayCorrection', type: 'toggle', section: 'Route Advisor', label: 'Measured Correction For Slay Task Totals', desc: 'Since 22 October slay tasks have paid and taken about 1.5x what the game shows per task, while XP an hour is still right. When this is on, a slay task’s total time and total XP in the queue and on the option cards are multiplied by a factor measured from your last finished slay tasks (or 1.5 when fewer than 5 are logged), and labelled as a measured correction. XP an hour, the Route Advisor and every ranking keep the game’s own numbers. Needs the Task Log.', default: true },
    { key: 'optionLogEnabled', type: 'toggle', section: 'Route Advisor', label: 'Task Option Log', desc: 'Writes down which task options the game offered in the queue (skill, activity, node, lucky, and the game’s own odds for each), not only the one you picked, in State/option-log.json on this PC. No names or account data, nothing is sent anywhere, the newest 2500 sets are kept. It is used to test the roll odds and the lucky chance (scripts/option-log-report.js).', default: true },
    { key: 'taskTipEnabled', type: 'toggle', section: 'Route Advisor', label: 'Task History Tooltips', desc: 'In the Skills Customization window, hovering a row of the history list (Total or per skill) shows the real lifetime task number, time split into walking / acting / banking, XP per skill, drops, materials used, potion charges and gold, from the Task Log. The Slay History, which the game leaves empty, is filled from the Task Log too. Display only.', default: true },
    { key: 'exportTaskLog', type: 'button', section: 'Route Advisor', label: 'Download Task Log', desc: 'Saves the recorded tasks and a summary (actual vs predicted time per skill) as a JSON file.', buttonText: 'Download' },
    { key: 'clearTaskLog', type: 'button', section: 'Route Advisor', label: 'Clear Task Log', desc: 'Deletes all recorded tasks from this browser profile.', buttonText: 'Clear' },
    { key: 'reportBug', type: 'button', section: 'ScapeLite Core', label: 'Report a Bug', desc: 'Describe a problem with a ScapeLite Official plugin. Opens a pre-filled report (versions and which plugins are on, no name or webhooks) on the ScapeLite issue tracker, or copy it. Only Official plugins are fixed by the ScapeLite team; community plugins are supported by their own authors.', buttonText: 'Report' },
    { key: 'ecoModeEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Eco Mode', desc: 'While the game cannot be seen (minimised, covered by another window) ScapeLite’s panels pause their timers and animations, so it uses almost nothing. Things that must keep running (Task Log, XP tracking, alerts, Route Advisor notifications) are not paused. Everything resumes the moment the game is visible.', default: true },
    { key: 'uiAutoDeselect', type: 'toggle', section: 'ScapeLite Core', label: 'Clear Stray Text Selections', desc: 'Text you select by accident (for example by dragging across a tooltip) is cleared on its own: at once when the selected text is no longer on screen, and after 20 seconds without being touched. Text in input fields is left alone.', default: true },
    { key: 'uiStatusFps', type: 'toggle', section: 'ScapeLite Core', label: 'Show FPS Counter', desc: 'The frame rate next to the Status Indicator dot. Also in the indicator’s right-click menu.', default: true },
    { key: 'hideBeforeLogin', type: 'toggle', section: 'ScapeLite Core', label: 'Hide ScapeLite Before Login', desc: 'On the game\'s main menu / login screen only the Status Indicator is shown; everything else appears once you are in the game.', default: true },
    { key: 'guideChatRelay', type: 'button', section: 'Chat Relay', label: 'Discord Setup Wizard', desc: 'Step by step: which channels and roles you need, where to paste each webhook, a Test button per channel, and what every feature posts.', buttonText: 'Open wizard' },
    { key: 'relayClanWebhook', type: 'secret', section: 'Chat Relay', label: 'Clan Channel Webhook URL', desc: 'Discord webhook for Clan announcements. Stored only on this PC (overlay config), never in the browser. Click the eye to reveal.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'relayGlobalWebhook', type: 'secret', section: 'Chat Relay', label: 'Global Channel Webhook URL', desc: 'Discord webhook for Global announcements (optional).', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'clanRelayEnabled', type: 'toggle', section: 'Chat Relay', label: 'Relay Clan Chat', desc: 'Forward Clan channel events (and optionally plain chat) to Discord.', default: true },
    { key: 'globalRelayEnabled', type: 'toggle', section: 'Chat Relay', label: 'Relay Global Chat', desc: 'Forward Global channel cape/pet milestones to Discord.', default: false },
    { key: 'relayPlainChat', type: 'toggle', section: 'Chat Relay', label: 'Mirror Plain Chat Messages', desc: 'Also relay ordinary Clan banter, not just drops/unlocks/levels.', default: true },
    { key: 'relayRole', type: 'select', section: 'Chat Relay', label: 'Several ScapeLite Users', desc: 'Only matters when more than one ScapeLite posts to the same Discord channel (two of your PCs, or clanmates). Automatic: one copy posts, the others wait and take over if it goes offline (works best with the Shared Lease Webhook below). Own events only: this PC posts only what happens to your own character. Always post: use this when you are the only user. Never post: this PC stays quiet. Guide: Open wizard, page 5.', options: [['auto', 'Automatic'], ['own', 'Own events only'], ['always', 'Always post'], ['never', 'Never post']], default: 'auto' },
    { key: 'relayPreferHost', type: 'toggle', section: 'Chat Relay', label: 'Prefer This PC As Host', desc: 'Only with a Shared Lease Webhook and Several ScapeLite Users on Automatic. Take over as host from a clanmate whose ScapeLite is working fine, and give it back only if this PC goes offline. If two PCs both prefer it, the one that got there first keeps it. Set on your main PC only; it is never shared with the team.', default: false },
    { key: 'relayLeaseWebhook', type: 'secret', section: 'Chat Relay', label: 'Shared Lease Webhook (optional)', desc: 'A webhook in a PRIVATE channel (for example leaders only). The clan leader makes it once and every ScapeLite user pastes the same one here, so the copies can agree who posts. ScapeLite keeps one small message there and never writes to your relay channels. Not the same webhook as the relay webhook.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'teamSettings', type: 'button', section: 'Chat Relay', label: 'Team Settings', desc: 'Publish your Discord setup to the team, or gather what the team published (ping roles, hiscores, digest, raid rules). Webhook addresses are never included unless you choose it.', buttonText: 'Open' },
    { key: 'teamAutoSync', type: 'toggle', section: 'Chat Relay', label: 'Keep In Sync Automatically', desc: 'When the team publishes newer settings, apply them (never webhook addresses). You can undo it in the wizard. Needs the shared lease webhook.', default: false },

    { key: 'pingRoles', type: 'roles', section: 'Chat Relay Pings', label: 'Ping Roles', desc: 'Create a ping role: paste the Discord role ID and tick the events it should be mentioned for. You can make as many roles as you like, and an event can ping several roles. Right-click a role in Discord (Developer Mode on) and choose Copy Role ID.' },

    { key: 'edgeSnapEnabled', type: 'toggle', section: 'Panel Mod', label: 'Edge Snapping', desc: 'Panels snap flush to the screen edge when dragged close, and stay snapped until pulled clearly away. Off by default.', default: false },
    { key: 'fortressTrackerEnabled', type: 'toggle', section: 'Trackers', label: 'Fortress Drop Tracker', desc: 'Keeps a history of your Fortress runs, the loot chance of every cleared wave and your drops and rewards, and rates your luck. Shown on the Fortress tab of the Drop Luck Tracker.', default: true },
    { key: 'hpPanelEnabled', type: 'toggle', section: 'HP Panel', label: 'Show The HP Panel', desc: 'A small standalone panel with your hit points (the Hit points module of the Info Bars does the same inside a bar). Drag it by its thin top strip; right-click it for the same options as here. Off by default.', default: false },
    { key: 'hpPanelStyle', type: 'select', section: 'HP Panel', label: 'HP Display Style', desc: 'A bar, or just the numbers with an icon.', options: [['bar', 'Bar'], ['numbers', 'Numbers with an icon']], default: 'bar' },
    { key: 'hpPanelWidth', type: 'number', section: 'HP Panel', label: 'HP Bar Width (px)', desc: 'How wide the bar is. 80 to 600.', default: 200, min: 80, max: 600 },
    { key: 'hpPanelText', type: 'toggle', section: 'HP Panel', label: 'Numbers On The Bar', desc: 'Writes current / maximum HP on the bar.', default: true },
    { key: 'hpPanelIcon', type: 'toggle', section: 'HP Panel', label: 'Heart Icon', desc: 'The heart beside the bar or the numbers.', default: true },
    { key: 'hpPanelHideOriginal', type: 'toggle', section: 'HP Panel', label: 'Hide The Game’s Own HP Bar', desc: 'Hides the game’s HP bar (the one beside the menu). The HP panel keeps working.', default: false },
    { key: 'altMenuBlock', type: 'toggle', section: 'Panel Mod', label: 'Alt Key Does Not Open The Window Menu Bar', desc: 'The game window is an Electron window whose menu bar slides down when you press Alt (Alt+Tab triggers it). With this on, a lone Alt press is ignored by the window. Alt shortcuts with another key are not affected.', default: true },
    { key: 'menuBarHidden', type: 'toggle', section: 'Panel Mod', label: 'Hide The Menu Bar Completely', desc: 'Hides the tab icon bar (the vertical one or the game’s own) altogether. Panels still open from the Info Bar buttons and the hotkeys. Also in the right-click menu of the bar’s drag strip and of the Info Bar’s panel buttons.', default: false },
    { key: 'verticalMenuEnabled', type: 'toggle', section: 'Panel Mod', label: 'Vertical Bottom-Right Menu', desc: 'Shows the tab icons as a column on the right edge with the HP bar as a vertical strip beside it (rotated "52 / 52" text). Turn off for the game\u2019s own horizontal layout.', default: true },
    { key: 'potionsResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Active Potions Resize Handle', desc: 'Adds a drag handle on the Active Potions strip\u2019s bottom-left corner so you can scale it (double-click to reset). Turning this off also puts the strip back at 100%.', default: true },
    { key: 'panelContextMenu', type: 'toggle', section: 'Panel Mod', label: 'Panel Title-Bar Menu + Lock', desc: 'Right-click a panel\u2019s title bar for a menu (lock, reset size, size presets, match another panel\u2019s height) and adds a lock button next to the title-bar buttons. A locked panel cannot be moved or resized.', default: true },
    { key: 'titlebarFontNormalize', type: 'toggle', section: 'Panel Mod', label: 'Equal Title-Bar Text Size', desc: 'Keeps every scaled panel\u2019s title text the same on-screen size (a panel scaled to 60% otherwise shows smaller text than one at 72%).', default: true },
    { key: 'dashboardResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Dashboard Resize Handle', desc: 'Adds a drag handle on the Dashboard window’s bottom-right corner so you can scale it (double-click to reset). Turning this off also puts it back at 100%.', default: true },
    { key: 'aboutInfo', type: 'info', section: 'About', label: 'ScapeLite', desc: 'Checking\u2026' },
    { key: 'checkUpdates', type: 'button', section: 'About', label: 'Check for Updates', desc: 'Looks for a newer ScapeLite (and newer versions of its plugins). A check also runs automatically when ScapeLite starts.', buttonText: 'Check now' },
    { key: 'applyUpdate', type: 'button', section: 'About', label: 'Install Update', desc: 'Downloads and applies the newest version (git installs). Restart ScapeLite from the dashboard afterwards.', buttonText: 'Update' },
    { key: 'aboutCredits', type: 'info', section: 'About', label: 'Made by @Wulf', desc: 'Thank you for using ScapeLite. It is a community project and is not made by, or affiliated with, the Scapewatch developers.' },
    { key: 'walkBarCollapse', type: 'toggle', section: 'Panels', label: 'Collapsible Walking Bar', desc: 'Adds a small chevron to the Walking bar (the drawer under the Current Task that counts down a walk) that folds just that bar to one thin line. The Current Task above it is not affected (it has its own chevron). The choice is remembered.', default: true },
    { key: 'currentTaskCollapse', type: 'toggle', section: 'Panels', label: 'Collapsible Current Task', desc: 'Adds a chevron to the Current Task title bar that shrinks it to one line (the task name) with thin progress bars; the Walking drawer becomes a single bar with its time.', default: true },
    { key: 'modalFloatEnabled', type: 'toggle', section: 'Panels', label: 'See-Through Windows', desc: 'While one of the big windows (Settings, Bank, ...) is smaller than fullscreen, the game behind it stays visible and usable; the background only dims and blurs while your pointer is inside the window. Each window can switch it off in its title-bar menu. Off: windows always dim the game behind them. (Key kept from the old Float button.)', default: true },
    { key: 'modalSnapPct', type: 'number', section: 'Panels', label: 'Fullscreen Snap Threshold (%)', desc: 'When you stop resizing a big window, it becomes fullscreen if it is at least this share of the fullscreen size in both width and height, and a movable window otherwise. 50 to 100 (100 = only an exact fit snaps).', default: 80, min: 50, max: 100 },
    { key: 'openLayouts', type: 'button', section: 'Panels', label: 'Layout Presets', desc: 'Save how your panels, docks and windows are arranged as a named layout, and load it again later. Loading a layout reloads the game page.', buttonText: 'Open layouts' },
    { key: 'winDockEnabled', type: 'toggle', section: 'Panels', label: 'Window Buttons Dock', desc: 'Lets you move, resize and tuck away the row of buttons in the top-right corner (hover it for a strip with handles and an edge arrow).', default: true },
    { key: 'potionsDockEnabled', type: 'toggle', section: 'Panels', label: 'Movable Food and Potions Panel', desc: 'Hover the left edge of the food / potions panel (top right) for a handle: drag to move it, right-click for lock and reset. Its own collapse (click a counter) and resize grip keep working.', default: true },
    { key: 'mapCloseCross', type: 'toggle', section: 'Panels', label: 'Cross Closes The Map', desc: 'While the World Map is open, the cross button in the top-right row closes the map instead of logging out.', default: true },
    { key: 'raidDpsExtraEnabled', type: 'toggle', section: 'Quality Of Life', label: 'Raid DPS Extras', desc: 'Adds a Party line (everyone’s damage and DPS added up) to the Raid DPS panel and a Graph tab showing each player’s DPS or total damage over time, plus a Party line.', default: true },
    { key: 'queueWalkRelative', type: 'toggle', section: 'Quality Of Life', label: 'Relative Walking Bars', desc: 'Off: a full walking bar is the distance at which the game would teleport instead. On: the longest walk in the current queue is the full bar and every other walk is shown relative to it.', default: false },
    { key: 'queueWalkEnabled', type: 'toggle', section: 'Quality Of Life', label: 'Queue Walking Time', desc: 'Every queued task gets a thin bar on its top edge and a small tag (for example 2m 31s) showing how long the walk to it takes. Green is short, red is long, purple means the game would teleport.', default: true },
    { key: 'goalsEnabled', type: 'toggle', section: 'Planning and Routes', label: 'Goals Panel', desc: 'A panel (open it from the ScapeLite button) with the next level and milestone of every skill you train and the time left at your real XP per hour, plus unlock drops worth hunting with the expected time. You can pin your own skill targets and hunts.', default: true },
    { key: 'treeAdvisorAutoOpen', type: 'toggle', section: 'Planning and Routes', label: 'Open Tree Advisor With The Tree Windows', desc: 'The Tree Advisor opens by itself when you open the game’s Delve or Fortress tree window and closes with it (unless you opened it yourself).', default: true },
    { key: 'treeAdvisorEnabled', type: 'toggle', section: 'Planning and Routes', label: 'Tree Advisor', desc: 'A panel (open it from the ScapeLite button) that plans the best Delve and Fortress tree builds for your points: DPS priced with the game\u2019s own Gear Calc maths, Delve XP, slayer or skilling goals, a picture of the tree, the steps to get there, saved builds and import / export. It never allocates anything.', default: true },
    { key: 'diaryCreditsEnabled', type: 'toggle', section: 'Planning and Routes', label: 'Locations And Free Pips Panel', desc: 'A panel (open it from the ScapeLite button) that rates every location by its walking distance to the nearest bank, shows how often each is rolled and used, and says where to put the free node-lever pips the diary gives (and what a pip costs otherwise) to cut walking. It also lists diary progress and your credit pools. It only reads the game.', default: true },
    { key: 'advisorEnabled', type: 'toggle', section: 'Planning and Routes', label: 'Advisor Panel', desc: 'One panel (open it from the ScapeLite button) that says what to do next, how and where: it reads the Route Advisor, Lever Advisor, Tree Advisor, Goals and Locations and Free Pips, puts the best action on top and keeps the rest in tabs, with how sure each one is. It only reads and shows; it never presses anything.', default: true },
    { key: 'dropLuckEnabled', type: 'toggle', section: 'Planning and Routes', label: 'Drop Luck Tracker', desc: 'A panel (open it from the ScapeLite button in the left icon strip) that rates how lucky your rare drops have been from your kill counts, lists the most overdue drops, every mob’s drops, the dungeons and the Chaos Dungeon’s loot, your unlock drops (with filters and a search) and your skill pets and lucky tools. A chart button on a drop shows the chance of having it by kill count.', default: true },
    { key: 'uiScaleEnabled', type: 'toggle', section: 'Panels', label: 'Scale Panels With The Window', desc: 'The game shrinks its interface when the window is small; with this on ScapeLite’s panels (Route Advisor, XP Tracker, Lever Advisor ...) shrink the same way instead of staying full size.', default: true },
    { key: 'uiScalePct', type: 'number', section: 'Panels', label: 'ScapeLite Panel Size (%)', desc: 'Makes every ScapeLite panel bigger or smaller at once, on top of following the game window. 100 = normal. The first-launch setup has a slider for this too. Right-click a panel\u2019s title to size just that panel.', default: 100, min: 50, max: 200 },
    { key: 'sidebarGroupsEnabled', type: 'toggle', section: 'Panels', label: 'Group Sidebar Icons', desc: 'Related icons in the left strip share one button: Crafting (Smith, Craft, Imbue, Brew), Progress (Unlocks, Collections, Diary), Raids and trees, Social (Friends, Clan, Hiscores), Skills, Combat. Click the button to open its first menu as usual; hover it to pick another.', default: true },
    { key: 'uiDensity', type: 'select', section: 'Panels', label: 'Panel Density', desc: 'How tightly ScapeLite panels are spaced: Compact fits more, Roomy is easier to read.', options: [['compact', 'Compact'], ['cozy', 'Cozy (default)'], ['roomy', 'Roomy']], default: 'cozy' },
    { key: 'uiBarTop', type: 'toggle', section: 'Info Bars', label: 'Top Info Bar', desc: 'A bar along the top of the screen with modules you choose (task, location, XP per hour, gold, clock ...). Right-click the bar to add, remove and set up modules; drag a module to move it.', default: true },
    { key: 'uiBarBottom', type: 'toggle', section: 'Info Bars', label: 'Bottom Info Bar', desc: 'A second bar along the bottom of the screen, set up the same way.', default: false },
    { key: 'uiBarSpacerHover', type: 'toggle', section: 'Info Bars', label: 'Hint When Hovering Empty Space', desc: 'Hovering an empty spacer module in an Info Bar draws a dashed outline and a hint. Turn it off for a clean bar. Also in the right-click menu of any empty part of a bar.', default: true },
    { key: 'uiBarHeight', type: 'select', section: 'Info Bars', label: 'Bar Height', desc: 'How tall the bars are.', options: [['compact', 'Compact'], ['normal', 'Normal (default)'], ['roomy', 'Roomy']], default: 'normal' },
    { key: 'uiBarOpacity', type: 'select', section: 'Info Bars', label: 'Bar Opacity', desc: 'How solid the bars look.', options: [['100', '100%'], ['90', '90%'], ['75', '75%'], ['60', '60%']], default: '100' },
    { key: 'uiBarReserve', type: 'toggle', section: 'Info Bars', label: 'Game Uses The Space Left', desc: 'The bars become a real screen edge: the game and its panels fit between them, so nothing sits under a bar. Turn off to let the bars float over the game instead.', default: true },
    { key: 'uiBarHotkeys', type: 'toggle', section: 'Info Bars', label: 'Panel Hotkeys Open ScapeLite’s Panels', desc: 'The game’s panel keys (Z Tasks, C Skills, V Equipment, B Inventory, N Diary, comma Quests, period Friends, / Barter; your own bindings from Settings > Hotkeys are followed) open and close ScapeLite’s counterpart when its Info Bar button replaces the game’s panel: the Task Queue panel, a pinned card, or the panel the button reveals. Panels the game still shows keep the game’s own key. Ignored while you type, with Ctrl/Alt, with a big window open, or when the game’s Enable Tab Hotkeys is off.', default: true },
    { key: 'uiStackFront', type: 'toggle', section: 'Panels', label: 'Newest Panel Or Window On Top', desc: 'The panel you open or click, and the game window (Bank, Settings ...) you open or click, goes on top of the others. With this off, the game’s big windows are always above ScapeLite panels (panels are cut away where a window covers them). Menus, tooltips, toasts, the Info Bars and the status dot always stay above everything.', default: true },
    { key: 'alertBellHidden', type: 'toggle', section: 'Alerts', label: 'Hide The Bell Button', desc: 'Hides the floating bell. The alert list opens when you hover the Alerts module in an Info Bar. Also in the right-click menu of the bell and of the Alerts module.', default: false },
    { key: 'alertsEnabled', type: 'toggle', section: 'Alerts', label: 'Alerts Bell', desc: 'A bell that is always visible with a red number for things that need your attention. Hover it for the list; each alert can be dismissed or pointed out in the game ("Show me where" only outlines a button, it never clicks anything).', default: true },
    { key: 'alertPollSec', type: 'select', section: 'Alerts', label: 'How Often To Check', desc: 'How often the game is checked for new alerts. Shorter is more up to date, longer is lighter on the computer.', options: [['5', 'Every 5 seconds'], ['10', 'Every 10 seconds'], ['15', 'Every 15 seconds (default)'], ['30', 'Every 30 seconds'], ['60', 'Every minute'], ['120', 'Every 2 minutes'], ['300', 'Every 5 minutes']], default: '15' },
    { key: 'alertEvent', type: 'toggle', section: 'Alerts', label: 'Alert: Game Events', desc: 'A new game event (Halloween and any later one) is on, you have not started it yet, or everything is found and it is time to claim. A new event shows again even if you dismissed the last one.', default: true },
    { key: 'alertTree', type: 'toggle', section: 'Alerts', label: 'Alert: Unspent Tree Points', desc: 'A Delve or Fortress tree point is waiting to be spent.', default: true },
    { key: 'alertLever', type: 'toggle', section: 'Alerts', label: 'Alert: Unspent Lever Credits', desc: 'You have lever credits left to spend on the Skills Customization page.', default: true },
    { key: 'alertLeverMin', type: 'number', section: 'Alerts', label: 'Lever Credits Needed For An Alert', desc: 'Only alert when at least this many skill lever credits are unspent (one lever step costs 25 at the start).', default: 25, min: 1, max: 500 },
    { key: 'alertSkillLever', type: 'toggle', section: 'Alerts', label: 'Alert: Skill Levers To Change', desc: 'One skill has unused lever credits AND the Lever Advisor has changes worth making for it (at least 1% more XP per hour). Nothing to change, no alert. It goes away when you apply the changes or look at the lever page of that skill for a few seconds.', default: true },
    { key: 'alertChest', type: 'toggle', section: 'Alerts', label: 'Alert: Unopened Chests And Lamps', desc: 'Treasure chests or lamps are sitting in your bank or inventory.', default: true },
    { key: 'alertQuest', type: 'toggle', section: 'Alerts', label: 'Alert: Quest Ready To Hand In', desc: 'Every step of a quest is done but you have not pressed Complete yet.', default: true },
    { key: 'alertGear', type: 'toggle', section: 'Alerts', label: 'Alert: Gear Upgrades', desc: 'Your bank holds a higher-tier item for a slot of your equipped loadout (a rough hint: it compares tiers, not full stats).', default: true },
    { key: 'alertGearHead', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Helmet', desc: 'Include the helmet slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearCape', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Cape', desc: 'Include the cape slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearNeck', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Amulet', desc: 'Include the amulet slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearAmmo', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Ammo', desc: 'Include the ammo slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearMainhand', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Weapon', desc: 'Include the weapon slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearBody', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Body armour', desc: 'Include the body armour slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearOffhand', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Offhand', desc: 'Include the offhand slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearHands', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Gloves', desc: 'Include the gloves slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearBelt', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Belt', desc: 'Include the belt slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearLegs', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Legs', desc: 'Include the legs slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearRing1', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better First ring', desc: 'Include the first ring slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertGearRing2', type: 'toggle', section: 'Alerts', label: 'Gear Alert: Better Second ring', desc: 'Include the second ring slot in the gear upgrade alert. Switch off to stop the reminder for this slot only.', default: true },
    { key: 'alertQuestSlot', type: 'toggle', section: 'Alerts', label: 'Alert: Free Quest Slots', desc: 'You hold fewer quests than the game allows and at least one more quest is open to you. Shown after two checks in a row; dismiss it and it stays away until the numbers change.', default: false },
    { key: 'alertBarter', type: 'toggle', section: 'Alerts', label: 'Alert: Unspent Barter Charges', desc: 'The Barter panel header still shows charges on this roll. Dismiss it and it stays away until the shop is rerolled.', default: false },
    { key: 'alertCraft', type: 'toggle', section: 'Alerts', label: 'Alert: New Collection Entries You Can Craft', desc: 'You have the level and materials to craft something that is not in your collection log yet.', default: true },
    { key: 'alertPets', type: 'toggle', section: 'Alerts', label: 'Alert: Pets And Lucky Tools', desc: 'A pet or a lucky tool (shiny or normal) dropped. These stay in the list until you dismiss them, so you see them after being away.', default: true },
    { key: 'alertRare', type: 'toggle', section: 'Alerts', label: 'Alert: Very Rare Drops', desc: 'A drop that is rarer than the limit below. These stay in the list until you dismiss them.', default: true },
    { key: 'alertRareMin', type: 'number', section: 'Alerts', label: 'Rare Drop Limit (1 in ...)', desc: 'Drops with a chance of 1 in this many or rarer count as very rare.', default: 500, min: 2, max: 1000000 },
    { key: 'alertThanks', type: 'toggle', section: 'Alerts', label: 'Alert: Thanks For Playing Reward', desc: 'The game’s free reward (every 12 hours, the thumbs-up button at the top right) is ready to claim. “Show me” points at the button; claiming stays in the game.', default: true },
    { key: 'alertIdle', type: 'toggle', section: 'Alerts', label: 'Alert: Nothing Is Running', desc: 'No task has been running for two checks in a row.', default: true },
    { key: 'alertInventory', type: 'toggle', section: 'Alerts', label: 'Alert: Inventory Full', desc: 'Every inventory slot is taken.', default: false },
    { key: 'alertPotions', type: 'toggle', section: 'Alerts', label: 'Alert: A Potion Ran Out', desc: 'An active potion effect has ended.', default: false },
    { key: 'alertsReset', type: 'button', section: 'Alerts', label: 'Show Dismissed Alerts Again', desc: 'Forget which alerts you dismissed, so everything current shows again.', buttonText: 'Reset' },
    { key: 'showUiTour', type: 'button', section: 'Panels', label: 'Show UI Tour', desc: 'Replay the short tour of the new panel features (Layout Editor, chips, tab groups, colours, alerts).', buttonText: 'Show' },
    { key: 'hiddenPanels', type: 'hiddenpanels', section: 'Panels', label: 'Hidden Panels', desc: 'Panels you hid with right-click on their title bar > Hide this panel. Restore any of them here.' },
    { key: 'openLayoutEditor', type: 'button', section: 'Panels', label: 'Open Layout Editor', desc: 'Closes Settings and opens the Layout Editor (also: Ctrl+Alt+L, or Edit Layout in the ScapeLite menu).', buttonText: 'Open' },
    { key: 'useDefaultLayout', type: 'button', section: 'Panels', label: 'ScapeLite Default Layout', desc: 'A ready-made arrangement of every panel for this window size: task queue and XP tracker on the right, the game’s windows and pinned cards beside them, Route Advisor next to those, helper panels as tabs and chat on the left. Nothing important is covered (invites and popups at the top stay clear). Your saved layouts are not touched, and Back To My Old Layout undoes it. Also in the Layout Editor.', buttonText: 'Use it' },
    { key: 'backToOldLayout', type: 'button', section: 'Panels', label: 'Back To My Old Layout', desc: 'Puts the panels, their sizes and scales, the game windows’ sizes and your panel look back the way they were before you used the ScapeLite Default Layout.', buttonText: 'Go back' },
    { key: 'uiLayoutEnabled', type: 'toggle', section: 'Panels', label: 'Layout Editor', desc: 'Adds an Edit Layout entry to the ScapeLite menu: drag every ScapeLite panel with snapping, fade, scale, resize and lock them, and save the whole arrangement as a named layout you can export and import.', default: true },
    { key: 'uiPalette', type: 'select', section: 'Panels', label: 'Panel Colours', desc: 'Default keeps ScapeLite’s dark look. Match Game follows whichever colour theme the game is using. Colour-Blind Safe swaps green, orange and red for colours that stay apart for most kinds of colour blindness (ticks and crosses keep their shapes either way).', options: [['default', 'ScapeLite (default)'], ['game', 'Match Game Theme'], ['colourblind', 'Colour-Blind Safe']], default: 'default' },
    { key: 'clockFormat', type: 'select', section: 'Panels', label: 'Clock Format', desc: 'Used by every ScapeLite clock: finish times in the task queue, chat timestamps and so on. The Info Bar clock module has its own options.', options: [['24', '24-hour (13:45)'], ['12', '12-hour (1:45 pm)']], default: '24' },
    { key: 'anchorEnabled', type: 'toggle', section: 'Panels', label: 'Panels Keep Their Place When The Window Resizes', desc: 'Every floating panel (ScapeLite’s and the game’s) remembers how far it is from its nearest screen edges and keeps that distance when you resize the window, so a panel in the bottom-right corner stays there and comes back when the window grows again.', default: true },
    { key: 'cardFuseCloseTogether', type: 'toggle', section: 'Panels', label: 'Open And Close Fused Panels Together', desc: 'Opening or closing one panel of a fused group opens or closes the whole group. Also in the right-click menu of a panel’s title bar. Collapsing a panel does not count as closing it.', default: false },
    { key: 'cardFuseEnabled', type: 'toggle', section: 'Panels', label: 'Fuse ScapeLite Panels', desc: 'When two ScapeLite panels (pinned cards, Task Queue, Chat) touch, a small link button appears on their seam. Click it to fuse them: they snap flush, lose the double border and move, anchor and resize-push together. Click it again to unfuse. Off hides the buttons and lets every panel move on its own (your fuses are kept).', default: true },
    { key: 'uiQueueTrayChosen', type: 'toggle', section: 'Queue and Tasks', label: 'Include The Chosen Task In The Alternatives', desc: 'The options that slide out of a queued task show the alternatives and, at the far right and a little bigger, the task that is picked. Turn it off to show only the alternatives. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueInsertBar', type: 'toggle', section: 'Queue and Tasks', label: 'Show The NEW TASKS Bar In The Queue', desc: 'The gold "NEW TASKS" bar between two queued tasks marks where freshly rolled tasks (new rows and rerolls) enter the queue. Drag it to any slot, just like the game\u2019s own bar (needs the Surveyor\u2019s Mark unlock). Turn it off to hide the bar and avoid dragging it by accident; the game keeps the position it had. Also in the queue panel\u2019s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueQueued', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Queued Combat And Skilling Dividers In The Queue', desc: 'The game’s "Combat Queued" and "Skilling Queued" dividers: a fight you queued that waits behind skilling tasks, or the skilling that resumes after a fight. It shows as a slim line under the card it follows, with a cross that cancels the queued task (your click on the cross is the game’s own cancel button). Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueClickMap', type: 'toggle', section: 'Queue and Tasks', label: 'Click A Task In The Queue To Show It On The Map', desc: 'A click on a queue card moves the world map to that task, exactly like a click on the game’s own task row. Ctrl-click an alternative in the pop-out does the same for that alternative, and a click on a queued-task divider does what it does in the game (a queued fight opens its mob in the game’s mob selection). Your click is passed to the game’s own row; ScapeLite never does it by itself. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueMapPreview', type: 'toggle', section: 'Queue and Tasks', label: 'Hover A Task To Preview Its Route On The World Map', desc: 'While the game’s World Map window is open, hovering a queue card or one of its alternatives shows the route to that task on the map, the same route the game draws when you hover a task in its own Tasks panel. Your hover is passed to the game’s matching task tile; ScapeLite draws and clicks nothing itself. Nothing shows while the map is closed.', default: true },
    { key: 'uiQueueRightClick', type: 'toggle', section: 'Queue and Tasks', label: 'Right-Click A Fight In The Queue For Its Menu', desc: 'Right-click a fight card for a small menu: train the other skill instead (a click on the game’s Training icon) and, on the current fight, switch the combat loadout (a click on the game’s loadout). Its first item, and a right-click on a fight in the pop-out, open the game’s combat calculator for that mob, and right-click the Auto chip to open the game’s Auto Loadout (combat defaults) settings. Your right-click is passed to the game’s own element, so you get the game’s own window. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueHeadLevel', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Level Bar On The Current Task', desc: 'A "Lv 48 94% Lv 49" bar under the current task card: the level of the skill being trained (during a fight: the skill of your combat style and XP toggle). Read from the game’s data; changes nothing. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueHeadLoadout', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Loadout On The Current Fight', desc: 'The name of the loadout you fight with, on the current task card while a fight is on. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueHeadTraining', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Skill You Train On The Current Fight', desc: 'The combat skill that gets the XP (your accuracy / strength toggle), on the current task card while a fight is on. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueHeadIcons', type: 'toggle', section: 'Queue and Tasks', label: 'Icons Instead Of Words On Fights', desc: 'The fight line of the current task card, and the line under every slay card in the queue (instead of "Slay - mob"), show the game\u2019s own icons (the loadout\u2019s weapon, the skills you train, kills) with the game\u2019s tooltips. Click the loadout or a training icon to pass your click to the game\u2019s own control (the loadout swaps, or the trained skill switches between accuracy and strength). Turn it off for words. Also in the queue panel\u2019s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueHeadKills', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Kill Count On The Current Fight', desc: 'Kills so far (and the target of a slay task), on the current task card while a fight is on. Also in the queue panel’s cogwheel and right-click menus.', default: true },
    { key: 'uiQueueOdds', type: 'toggle', section: 'Queue and Tasks', label: 'Show The Roll Odds In The Queue Panel', desc: 'A small "Roll odds" tag at the bottom of the queue panel. Hover it to see the chance of each skill for the next task, and hover a skill for the chance of each task tier (on the Slay lane: each mob of your slayer master). Uses the game\u2019s own numbers and changes nothing. Also in the queue panel\u2019s cogwheel and right-click menus.', default: true },
    { key: 'uiTipAtCursor', type: 'toggle', section: 'Panels', label: 'Tooltips At The Cursor', desc: 'ScapeLite tooltips and hover cards appear right where your pointer is and (for task tooltips) follow it. Turn it off and they sit next to the thing you point at instead.', default: true },
    { key: 'uiSkillCols', type: 'number', section: 'Panels', label: 'Skills Card Columns', desc: 'How many columns the Skills card on the info bar has (default 4, like the game\u2019s own Skills panel, so the skills read in the same order). The rows follow, and the Total Level fills what is left of the last row.', default: 4, min: 1, max: 10 },
    { key: 'uiInvAuto', type: 'toggle', section: 'Panels', label: 'Backpack Panel Fits Its Size', desc: 'The pinned Inventory panel picks the rows and columns that make the slots biggest for the panel\u2019s shape, and the slots grow as you resize it. Off = use the rows setting below.', default: true },
    { key: 'uiSkillAuto', type: 'toggle', section: 'Panels', label: 'Skills Panel Fits Its Size', desc: 'The pinned Skills panel picks the columns that make the skill cells biggest for the panel\u2019s shape and grows them as you resize it. Off = use the column setting below.', default: true },
    { key: 'uiSkillShareTotal', type: 'toggle', section: 'Panels', label: 'Skills Total Level Shares The Last Row', desc: 'When the Skills panel fits its size, the Total Level cell sits beside the last skills (like the game\u2019s own panel) instead of getting a row of its own.', default: true },
    { key: 'uiInvRows', type: 'number', section: 'Panels', label: 'Inventory Card Rows', desc: 'How many rows tall the Inventory card on the info bar is (default 4). 1 makes one long row, as many rows as you have slots makes one tall column; the columns adjust by themselves, and only the slots you actually have are shown (the bag grows with items).', default: 4, min: 1, max: 64 },
    { key: 'uiNewPanelPct', type: 'number', section: 'Panels', label: 'Starting Size Of New Panels (%)', desc: 'Panels you have not resized yourself open at this share of their full size (50 to 100, default 80), so they do not start out too big. Right-click a panel title to pick its own size; that choice is kept.', default: 80, min: 50, max: 100 },
    { key: 'uiAccent', type: 'text', section: 'Panels', label: 'Accent Colour', desc: 'The highlight colour of ScapeLite panels as a hex code, for example #ffd24a (the default gold) or #4ade80. Leave empty for the default.', default: '' },
    { key: 'uiFontPx', type: 'number', section: 'Panels', label: 'Panel Text Size (px)', desc: 'Base text size of panels built with the shared UI kit (11 to 18). 0 = default (14).', default: 0, min: 0, max: 18 },
    { key: 'uiThemeEnabled', type: 'toggle', section: 'Panels', label: 'Uniform ScapeLite Look', desc: 'Gives every ScapeLite panel the same colours, corners, header, buttons and thin scrollbars, and brings a panel to the front when you click it.', default: true },
    { key: 'uiScaleMinPct', type: 'number', section: 'Panels', label: 'Smallest Panel Size (%)', desc: 'In a very small window the panels shrink with the game and can get hard to read. Set a floor here (for example 60) so they never get smaller than that. 0 = follow the game exactly.', default: 0, min: 0, max: 100 },
    { key: 'scapeliteMenuEnabled', type: 'toggle', section: 'Panels', label: 'ScapeLite Menu Button', desc: 'Adds a ScapeLite logo button to the left icon strip. Hover it to open or close ScapeLite panels (Route Advisor, Goal Planner, XP Tracker). Replaces the Goal Planner’s own strip button.', default: true },
    { key: 'materialShortageEnabled', type: 'toggle', section: 'Quality Of Life', label: 'Material Shortage Warning', desc: 'A small panel appears when the running or a queued Smith / Craft / Imbue / Brew / Cook / Barter task will probably run out of materials, so the game does not fall back to scrap. Red = expect to run short, yellow = only enough if your material saves come in. Hidden when all is fine.', default: true },
    { key: 'materialShortageSaveCredit', type: 'number', section: 'Quality Of Life', label: 'Material Saves Counted (%)', desc: 'How much of your material-save chance the warning counts on. 50 = with 10% saves, 5% fewer materials are assumed. 0 = assume no saves, 100 = full chance (risky).', default: 50, min: 0, max: 100 },
    { key: 'mechanicsExplainerEnabled', type: 'toggle', section: 'Quality Of Life', label: 'Mechanics Explainer', desc: 'Hover a weight or quantity lever in the Skills / Slay Customization windows and the tooltip gets a short explanation of what the step really does (1.25x per step, shared odds, doubling cost).', default: true },
    { key: 'uiPlayerMenu', type: 'toggle', section: 'Panels', label: 'Game Player Menu On Right-Click', desc: 'Right-click a name in ScapeLite’s chat panel or a row in the Friends card to open the game’s own player menu (message, mute, add or remove friend, invite ...) right there. ScapeLite only passes your right-click on to the game’s matching name; you still choose every entry yourself. Turn it off to leave those names alone.', default: true },
    { key: 'chatRoomPicker', type: 'toggle', section: 'Panels', label: 'Chat Language Picker In ScapeLite Chat', desc: 'A small button next to the message box (for example EN · W1) that lists the game’s chat languages and worlds; choosing one is the same as choosing it in the game’s own chat. Turn off to hide the button.', default: true },
    { key: 'chatLinks', type: 'toggle', section: 'Panels', label: 'Chat: Clickable Links', desc: 'Web addresses (http and https only) in ScapeLite’s chat panel and Chat card become links that open in a new browser tab. Nothing is opened until you click. Turn off to show them as plain text.', default: true },
    { key: 'chatWorldTag', type: 'toggle', section: 'Panels', label: 'Chat: World Tag', desc: 'Shows the small W-number the game puts before a name in World chat when more than one world exists (in ScapeLite’s chat panel and Chat card).', default: true },
    { key: 'chatRulesFocus', type: 'toggle', section: 'Panels', label: 'Chat: Help With The Chat Rules Dialog', desc: 'The game asks you to accept its chat rules before your first message. When that stops a message sent from ScapeLite’s chat box, the message box tells you so and puts the focus in the game’s own message box; the dialog and the accepting are the game’s and yours.', default: true },
    { key: 'chatTabCycle', type: 'toggle', section: 'Panels', label: 'Chat: Tab Changes Send Channel', desc: 'Press Tab in ScapeLite’s chat message box to step to the next channel you can send to, like the game’s own box. Turn off to keep Tab for moving between fields.', default: true },
    { key: 'uiSkillCellClick', type: 'toggle', section: 'Panels', label: 'Click A Skill In The Skills Card', desc: 'Clicking a skill in the pinned Skills card opens what the game opens for that skill: its Skills Customization window (levers), the Delve or Fortify tree, or the Alms window. It is your click handed to the game’s own skill cell; nothing is changed. Turn off to make the cells hover-only.', default: true },
    { key: 'uiQuestsList', type: 'toggle', section: 'Panels', label: 'Quests Card: Free Slots And List', desc: 'The pinned Quests card also shows how many quest slots are free and gets an Active / List switch. The list shows every quest coloured by status (the game’s own colours); clicking one opens it in the game. Turn off for active quests only.', default: true },
    { key: 'uiDiaryAll', type: 'toggle', section: 'Panels', label: 'Diary Card: Full List And Sort', desc: 'The pinned Diary card gets a switch between the six closest banks and the full list, with Progress, A-Z and Game order sorting. Turn off for the six closest only.', default: true },
    { key: 'uiBarterInfo', type: 'toggle', section: 'Panels', label: 'Barter Card: Header Details', desc: 'The pinned Barter card gets two header rows (your gold, your charges) whose hover cards show the game’s price modifier ranges (buy and sell), the Barter Pool Access tiers and the charges per roll. Display only.', default: true },
    { key: 'uiBarterActions', type: 'toggle', section: 'Panels', label: 'Barter Card: Reroll, Buy, Sell And Charm Buttons', desc: 'The pinned Barter card gets the game panel’s own controls: a Reroll button (with its credit cost and the credits you have), Buy / Sell / Charm on every shop slot, an amount slider, and the "all charges used" notice. Each button only hands YOUR click to the game’s own button in its Barter panel (the game spends the credits, charges or gold exactly as it does there); it is greyed out when the game greys its own out, and the tooltips are the game’s. Nothing is ever sent automatically.', default: true },
    { key: 'uiEquipToggles', type: 'toggle', section: 'Panels', label: 'Equipment Card: Potion Boosts And Spirit Modifier Switches', desc: 'The pinned Equipment card shows the two switches of the game’s stats view (Potion Boosts and Spirit Modifier: ON or OFF) as buttons. A button hands your click to the game’s own switch, which only changes what the stats table counts.', default: true },
    { key: 'uiFriendRowClick', type: 'toggle', section: 'Panels', label: 'Friends Card: Click A Friend To Find Them', desc: 'Clicking an online friend on the pinned Friends card hands your click to the game’s own friend row, which moves the world map camera to that player (right-click still opens the player menu). Only works on the Friends tab.', default: true },
    { key: 'chatDefaultEnabled', type: 'toggle', section: 'Panels', label: 'Remember Chat Channel', desc: 'At login the chat box starts on the channel you last chose, or the leftmost shown one (Global, Proximity / Raid, Friends, Clan) instead of always Global. Applied once; later changes are yours.', default: true },
    { key: 'combatReadoutEnabled', type: 'toggle', section: 'Panels', label: 'Combat Readout', desc: 'Draws exact numbers on the combat scene’s own bars: HP and Spirit as 57 / 80, the attack timer counting down, and under your bars the exact attack interval, attacks per second and your expected DPS for the loadout the fight really uses.', default: true },
    { key: 'combat_eatFix', type: 'toggle', section: 'Combat: Allies', label: 'Clean Up Food Pop-ups', desc: 'The “[food] +39 HP” pop-ups above the kill count are meant to float up and fade. The game sometimes cancels their timers and leaves them stacked in one spot for good. This removes them on the game’s own schedule (and clears stuck ones). Turn off to leave the game’s behaviour as it is.', default: true },
    { key: 'combat_autoZoom', type: 'toggle', section: 'Combat: Allies', label: 'Zoom Out To Fit The Party', desc: 'In dungeons and raids, zooms the combat view out (never in) until the whole party is above the bottom panels. The game restores its own zoom when combat ends.', default: true },
    { key: 'combat_meHp', type: 'toggle', section: 'Combat: Player', label: 'Player HP', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_meSpirit', type: 'toggle', section: 'Combat: Player', label: 'Player Spirit', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_meTimer', type: 'toggle', section: 'Combat: Player', label: 'Player Attack timer (interval / countdown)', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_meDps', type: 'toggle', section: 'Combat: Player', label: 'Player DPS', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_enemyHp', type: 'toggle', section: 'Combat: Enemies', label: 'Enemies HP', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_enemySpirit', type: 'toggle', section: 'Combat: Enemies', label: 'Enemies Spirit', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_enemyTimer', type: 'toggle', section: 'Combat: Enemies', label: 'Enemies Attack timer (interval / countdown)', desc: 'Show this number on the combat scene bars.', default: true },
    { key: 'combat_allyHp', type: 'toggle', section: 'Combat: Allies', label: 'Allies HP', desc: 'Show this number on the combat scene bars (raid and dungeon party members).', default: true },
    { key: 'combat_allySpirit', type: 'toggle', section: 'Combat: Allies', label: 'Allies Spirit', desc: 'Show this number on the combat scene bars (raid and dungeon party members).', default: true },
    { key: 'combat_allyTimer', type: 'toggle', section: 'Combat: Allies', label: 'Allies Attack timer (interval / countdown)', desc: 'Show this number on the combat scene bars (raid and dungeon party members).', default: true },
    { key: 'craftPotential', type: 'toggle', section: 'Panels', label: 'Crafting Potential XP', desc: 'In the Smith, Craft, Imbue and Brew windows, the XP bar also shows what you could reach by crafting with every material in your bank (a gold striped section, plus level chips when it is whole levels).', default: true },
    { key: 'bankToolsEnabled', type: 'toggle', section: 'Bank', label: 'Bank Tools', desc: 'Separators between bank categories, category chips when hovering an item, and sub-category menus on the bank filter buttons.', default: true },
    { key: 'bankScrollNew', type: 'toggle', section: 'Bank', label: 'Scroll To New Items', desc: 'Opening the bank scrolls to the first new item (the ones with the sparkle).', default: true },
    { key: 'bankTidyToolbar', type: 'toggle', section: 'Bank', label: 'Tidy Bank Toolbar', desc: 'Tucks Sort, Swap, Insert and Remove placeholders into the Filters button, which becomes Settings. Filters is the first entry in that menu.', default: true },
    { key: 'bankSizeSlider', type: 'toggle', section: 'Bank', label: 'Item Size Slider', desc: 'A small-to-big slider in the bank toolbar that resizes the item slots. Double-click its percentage to reset.', default: true },
    { key: 'bankNewTags', type: 'toggle', section: 'Bank', label: 'New Item Sparkle', desc: 'Items you never held before get a sparkle and a NEW tag in the bank, and the bank icon in the side menu twinkles until you have looked at them (hover an item, or press the Clear button).', default: true },
    { key: 'bankSeparators', type: 'toggle', section: 'Bank', label: 'Category Separators', desc: 'A thin line between every category group in the bank grid.', default: true },
    { key: 'bankSepLabels', type: 'toggle', section: 'Bank', label: 'Separator Labels', desc: 'Writes the category name on each separator.', default: true },
    { key: 'bankHoverCats', type: 'toggle', section: 'Bank', label: 'Item Category Chips', desc: 'Lists the categories an item belongs to when you hover it, e.g. Raw > Fish.', default: true },
    { key: 'bankFilterMenus', type: 'toggle', section: 'Bank', label: 'Filter Button Menus', desc: 'Hover Raw, Processed, Equipment or Potions in the bank to pick a sub-category (Fish, Mine, Melee weapons...).', default: true },
    { key: 'notifDockEnabled', type: 'toggle', section: 'Notifications', label: 'Notification Dock', desc: 'Keeps invites (raid / party / friends), task popups and toasts above every panel and window, centred by default, and lets you move them.', default: true },
    { key: 'moveNotifications', type: 'button', section: 'Notifications', label: 'Move Notifications', desc: 'Shows draggable frames for invites, task popups and toasts. Position them, then press Done. Positions are remembered.', buttonText: 'Move' },
    { key: 'modalResizeEnabled', type: 'toggle', section: 'Panel Mod', label: 'Movable + Resizable Settings / Bank / Crafting Windows', desc: 'The game’s big windows are always draggable and resizable: a grip at the bottom-right corner of the fullscreen window, and once it is smaller than fullscreen a title bar (right-click: lock, align, size presets) plus edge handles. Resizing to at least 80% of the screen snaps back to fullscreen. Position and size are remembered per window. Off: the windows stay fullscreen.', default: true },
    { key: 'menuDockEnabled', type: 'toggle', section: 'Panel Mod', label: 'Move / Resize / Fuse the Menu + HP Bar', desc: 'Adds a drag strip and a resize corner to the vertical bottom-right menu and HP bar, and lets them fuse with panels. Double-click the strip to send it back home, the corner to reset its size.', default: true },
    { key: 'recenterCameraSmart', type: 'toggle', section: 'Panel Mod', label: 'Smart Recenter-Camera Button', desc: 'Keeps the Recenter Camera button centred but moves it into the lowest gap that no panel covers.', default: true },
    { key: 'keepPanelsOnScreen', type: 'toggle', section: 'Panel Mod', label: 'Keep Panels On Screen', desc: 'If a panel ends up partly or completely off screen, it is shifted back into view (display only; the game’s own position is untouched).', default: true },
    { key: 'panelSizeWholePx', type: 'toggle', section: 'Panel Mod', label: 'Whole-Pixel Panel Heights', desc: 'While resizing, the panel\u2019s on-screen height snaps to whole pixels (instead of fractional percentages), so two panels can be matched exactly. The label shows the size in px.', default: true },
    { key: 'panelSizeBadges', type: 'toggle', section: 'Panel Mod', label: 'Show All Panel Sizes While Resizing', desc: 'While you drag a resize handle, every resizable panel shows its width\u00d7height in px. Panels with the same height as the one you are dragging turn green, near-matches amber, with the pixel difference.', default: true },
    { key: 'panelSizeMatchSnap', type: 'toggle', section: 'Panel Mod', label: 'Snap to Other Panels\u2019 Height', desc: 'While resizing a panel (ScapeLite\u2019s and the game\u2019s), magnet the height onto another open panel\u2019s height when it is close, and say which panel it matches. Hold Shift to resize freely.', default: true },
    { key: 'resetScales', type: 'button', section: 'Panel Mod', label: 'Reset All Panel Scales', desc: 'Set every resized panel back to 100%.', buttonText: 'Reset' },

    { key: 'hiscoresWebhook', type: 'secret', section: 'Clan Hiscores', label: 'Hiscores Webhook URL', desc: 'Discord webhook the rank updates are posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'hiscoresEnabled', type: 'toggle', section: 'Clan Hiscores', label: 'Enable Clan Hiscores Tracking', desc: 'Poll the clan’s hiscores rank and post to Discord when it changes.', default: true },
    { key: 'hiscoresPollMinutes', type: 'number', section: 'Clan Hiscores', label: 'Poll Interval (minutes)', desc: 'How often to check. Lower = more up to date, more requests.', default: 20, min: 5, max: 120 },
    { key: 'hiscoresPostIntervalHours', type: 'number', section: 'Clan Hiscores', label: 'Post Interval (hours)', desc: 'How rarely to post routine rank/stat changes to Discord, unless a major change forces an immediate post (see below).', default: 6, min: 1, max: 24 },
    { key: 'hiscoresMajorRankChange', type: 'number', section: 'Clan Hiscores', label: 'Major Rank Change Threshold', desc: 'Post immediately, ignoring the interval above, if the clan rank moves by at least this many spots.', default: 3, min: 1, max: 20 },

    { key: 'raidSummaryWebhook', type: 'secret', section: 'Raid Summary', label: 'Raid Summary Webhook URL', desc: 'Discord webhook raid summaries are posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'raidSummaryEnabled', type: 'toggle', section: 'Raid Summary', label: 'Post Raid Summaries', desc: 'Post top damage and shared loot to Discord when a raid finishes.', default: true },
    { key: 'raidSummaryMode', type: 'select', section: 'Raid Summary', label: 'Post When', desc: 'How the rules below combine. Any: post when at least one switched-on rule matches. All: post only when every switched-on rule matches. Rules that do not apply to a run (the wave rule for a normal raid) are ignored.', options: [['any', 'Any rule matches'], ['all', 'All rules match']], default: 'any' },
    { key: 'raidSummaryPartyOn', type: 'toggle', section: 'Raid Summary', label: 'Rule: Party Size', desc: 'Matches when at least this many real players were in the run.', default: true },
    { key: 'raidSummaryMinMembers', type: 'number', section: 'Raid Summary', label: 'Party Size At Least', desc: 'Number of real players (clones do not count).', default: 2, min: 1, max: 5 },
    { key: 'raidSummaryGuildOn', type: 'toggle', section: 'Raid Summary', label: 'Rule: Guild Members', desc: 'Matches when at least this many of your guild mates were in the run (you do not count).', default: true },
    { key: 'raidSummaryGuildMin', type: 'number', section: 'Raid Summary', label: 'Guild Members At Least', desc: 'Number of guild mates besides you.', default: 1, min: 1, max: 4 },
    { key: 'raidSummaryWaveOn', type: 'toggle', section: 'Raid Summary', label: 'Rule: Wave Reached', desc: 'For dungeons: matches when the run got at least this far, whether or not it was finished.', default: true },
    { key: 'raidSummaryWaveMin', type: 'number', section: 'Raid Summary', label: 'Wave At Least', desc: 'Highest wave reached in the dungeon.', default: 10, min: 1, max: 500 },
    { key: 'raidSummaryDungeons', type: 'toggle', section: 'Raid Summary', label: 'Include Dungeon Runs', desc: 'Chaos Dungeon style wave runs, posted when the run ends.', default: true },
    { key: 'raidSummaryRaids', type: 'toggle', section: 'Raid Summary', label: 'Include Raids', desc: 'Normal raids, posted when a run is completed.', default: true },

    { key: 'digestWebhook', type: 'secret', section: 'Activity Digest', label: 'Digest Webhook URL', desc: 'Discord webhook the activity digest is posted to.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'digestEnabled', type: 'toggle', section: 'Activity Digest', label: 'Post Activity Digests', desc: 'Periodically post a summary of notable drops, level milestones and completed quests, grouped by player.', default: true },
    { key: 'digestPostTimes', type: 'text', section: 'Activity Digest', label: 'Also Post At (clock times)', desc: 'Extra fixed times to post the digest, 24 h local, comma separated, e.g. 08:00, 14:00, 20:00. Works together with the interval below: whichever comes first posts.', default: '', placeholder: '08:00, 14:00, 20:00' },
    { key: 'digestIntervalHours', type: 'number', section: 'Activity Digest', label: 'Digest Interval (hours)', desc: 'How often to post -- e.g. 6 for 4x/day, 12 for 2x/day.', default: 6, min: 1, max: 24 },

    { key: 'guideClanBoard', type: 'button', section: 'Clan Status Board', label: 'Setup Guide', desc: 'Step by step for the clan leader and for members, with the privacy note: what is sent, who can see it, who could change cards.', buttonText: 'Open guide' },
    { key: 'boardWebhook', type: 'secret', section: 'Clan Status Board', label: 'Board Webhook URL', desc: 'The webhook of your clan\u2019s board channel (your clan leader gives it to you). Stored only on this PC. Everyone who holds this URL could in principle edit any card posted through it; ScapeLite only ever edits your own card, and the clan leader decides who gets the URL.', placeholder: 'https://discord.com/api/webhooks/...' },
    { key: 'clanBoardEnabled', type: 'toggle', section: 'Clan Status Board', label: 'Show My Card On The Clan Board', desc: 'Posts one card under your in-game name in the board channel and keeps it up to date. Only the fields ticked below are sent. Off until you switch it on. Display only: nothing is done in the game.', default: false },
    { key: 'clanBoardIntervalMin', type: 'number', section: 'Clan Status Board', label: 'Refresh Every (minutes)', desc: 'How often the card is updated, when something changed. 1 to 5 minutes; the times on the card (\u201Cdone in 12 minutes\u201D) keep counting on their own between updates.', default: 2, min: 1, max: 5 },
    { key: 'clanBoardRoster', type: 'toggle', section: 'Clan Status Board', label: 'Also Show Clanmates Without ScapeLite', desc: 'Adds a simple card (online or offline, when you last saw them online, total level) for every clanmate who has no ScapeLite card of their own. Only ONE PC makes them: the host (the PC that leads the shared lease) or, without a lease webhook, this PC. A card disappears by itself when that clanmate starts using ScapeLite. Off until you switch it on.', default: false },
    { key: 'clanBoardRosterExclude', type: 'members', section: 'Clan Status Board', label: 'Clanmates On The Board', desc: 'Untick a clanmate to leave them off. Only used when the switch above is on. New clanmates start ticked.', default: [] },
    { key: 'clanBoardTask', type: 'toggle', section: 'Clan Status Board', label: 'Field: What I Am Doing', desc: 'The task you are on (skill and activity, or the fight).', default: true },
    { key: 'clanBoardLocation', type: 'toggle', section: 'Clan Status Board', label: 'Field: Where I Am', desc: 'Adds the place of the task (\u201Cat Pinewrap\u201D). Turn off if you do not want to show where you are.', default: true },
    { key: 'clanBoardProgress', type: 'toggle', section: 'Clan Status Board', label: 'Field: Progress And Time Left', desc: 'A progress bar with done/total, and when the task will be finished.', default: true },
    { key: 'clanBoardLevelUps', type: 'toggle', section: 'Clan Status Board', label: 'Field: Level-ups (24 hours)', desc: 'Your level-ups from the last 24 hours, like \u201CFish 49 \u2192 50 (2 hours ago)\u201D.', default: true },
    { key: 'clanBoardTotalLevel', type: 'toggle', section: 'Clan Status Board', label: 'Field: Total Level', desc: 'The sum of all your skill levels.', default: true },
    { key: 'clanBoardXpHr', type: 'toggle', section: 'Clan Status Board', label: 'Field: XP Per Hour', desc: 'Your XP per hour on the current task.', default: false },
    { key: 'clanBoardHp', type: 'toggle', section: 'Clan Status Board', label: 'Field: Hit Points', desc: 'Your current and maximum HP.', default: false },
    { key: 'clanBoardSlayer', type: 'toggle', section: 'Clan Status Board', label: 'Field: Slayer Task', desc: 'Your Slayer task and kills done.', default: false },
    { key: 'clanBoardFortress', type: 'toggle', section: 'Clan Status Board', label: 'Field: Fortress Run', desc: 'The wave and party size while you are in a Fortress or dungeon run.', default: false },
    { key: 'clanBoardOnlineSince', type: 'toggle', section: 'Clan Status Board', label: 'Field: Online Since', desc: 'Since when you have been online (the card always says \u201CIdle\u201D or \u201COffline, last seen\u201D when that is the case).', default: false },
    { key: 'clanBoardToday', type: 'toggle', section: 'Clan Status Board', label: 'Field: Today', desc: 'XP gained and tasks finished since midnight (counted from when ScapeLite first saw you today).', default: false },
    { key: 'clanBoardPreview', type: 'boardpreview', section: 'Clan Status Board', label: 'Preview', desc: 'The card as it would be posted right now, with the fields you ticked. Level-ups, \u201COnline since\u201D and \u201CToday\u201D show sample values here.' },

    { key: 'hoverTaskXpPreview', type: 'toggle', section: 'Hover Info', label: 'Task XP Preview', desc: 'Hovering a queued task shows current skill XP and the XP it would give (and an estimated gold profit, where known).', default: true },
    { key: 'hoverTaskXpPercent', type: 'toggle', section: 'Hover Info', label: 'Show Level Progress Bar', desc: 'Shows where a task’s XP takes you: a bar with your current progress and what the task adds, e.g. "Lv 30: 42% → 80%", or "Lv 30 → Lv 31 + 6.5%" when it levels you up.', default: true },
    { key: 'hoverSkillGradient', type: 'toggle', section: 'Hover Info', label: 'Colour-Graded Skill Bars', desc: 'Colours every skill bar in the Skills panel (and its tooltip bar) from red at 0% through amber to green at 100% of the way to the next level.', default: true },
    { key: 'hoverSkillQueued', type: 'toggle', section: 'Hover Info', label: 'Queued XP On Skills', desc: 'Shows the XP your queued tasks (the current one plus each row’s pick) would add on every skill cell of the Skills panel: a striped section on its bar, a +N badge when it is whole levels, and a block in its tooltip.', default: true },
    { key: 'hoverTaskDuration', type: 'toggle', section: 'Hover Info', label: 'Show Task Duration', desc: 'Adds a rough time to finish the task and its XP per hour, from the game’s own projection (needs the Game Data Bridge).', default: true },
    { key: 'hoverSlayXp', type: 'toggle', section: 'Hover Info', label: 'Slay Task XP Estimate', desc: 'Hovering a queued Slay (kill) task shows the estimated XP per skill (Slay, your chosen combat skill, Life, Dodge/Defend), time and XP/hr. Estimate from mob HP and the game\u2019s kill-time model; needs the Game Data Bridge.', default: true },
    { key: 'hoverSkillPercent', type: 'toggle', section: 'Hover Info', label: 'Skill % To Next Level', desc: 'Hovering a skill in the Skills tab also shows how far you are to the next level, e.g. "85.3% to level 31".', default: true },
    { key: 'hoverTaskGoldEstimate', type: 'toggle', section: 'Hover Info', label: 'Coin Reward Estimate', desc: 'Hovering a queued Plunder or Bard task shows the expected coins from its loot table (only skills that actually drop coins).', default: true },
    { key: 'hoverMobStats', type: 'toggle', section: 'Hover Info', label: 'Combat Task Mob Stats', desc: 'Hovering a queued combat task shows the target’s HP and attack style.', default: true },
    { key: 'hoverQuestRewards', type: 'toggle', section: 'Hover Info', label: 'Quest Reward Preview', desc: 'Hovering an active quest shows its XP and item rewards.', default: true },
    { key: 'hoverLampPreview', type: 'toggle', section: 'Hover Info', label: 'Lamp XP Preview', desc: 'Hovering an XP lamp, combat lamp or gem adds a table to its tooltip: for every skill you could use it on, your level now, what one lamp (and the whole stack) turns it into, colour coded (green = levels you up, yellow = a good step, grey = tiny), plus the best pick and your Route Advisor priority pick. Needs the Game Data Bridge.', default: true },
    { key: 'taskDistanceColor', type: 'toggle', section: 'Hover Info', label: 'Task Distance Color Coding', desc: 'Colors each queued task from green to red by the distance number the game prints next to it (the walk from the previous stop in your queue). Hops long enough to use a teleport charge turn purple.', default: true },

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
    { key: 'taskCountInTitle', type: 'toggle', section: 'Quality Of Life', label: 'Task Count In Title', desc: 'The Tasks panel title shows how many tasks you have, for example Tasks [8] (it grows as you unlock more queue slots).', default: true },
    { key: 'panelSmoothMove', type: 'toggle', section: 'Panels', label: 'Smooth Panel Dragging', desc: 'Makes a panel follow your mouse exactly 1:1 when you drag it by its title bar (resized panels used to jump when grabbed and drift away from the pointer).', default: true },
    { key: 'panelSnap', type: 'toggle', section: 'Panels', label: 'Snap Panels To Edges', desc: 'While dragging, panels pull onto the edges of other panels and the screen, with a gold guide line. Hold Shift to drag without snapping. When two panels snap edge to edge, a small Fuse button appears.', default: true },
    { key: 'panelAutoFuse', type: 'toggle', section: 'Panels', label: 'Auto-Fuse Snapped Panels', desc: 'Fuse two panels automatically when you drop one snapped against the other, instead of offering the Fuse button. Fused panels still separate with the link button in their title bars.', default: false },
    { key: 'fuseGroupToggle', type: 'toggle', section: 'Panels', label: 'Fused Panels Open And Close Together', desc: 'Closing one panel of a fused row closes the whole row, and opening one opens the rest, so a fused group acts like a single panel.', default: true },
    { key: 'panelFuseEnabled', type: 'toggle', section: 'Panels', label: 'Panel Fuse', desc: 'When two panels sit edge to edge, a link button appears in their title bars. Fusing snaps them flush, cleans up the seam and moves them together when dragged.', default: true },
    { key: 'sidebarReorderEnabled', type: 'toggle', section: 'Sidebar', label: 'Rearrange The Side Menu By Dragging', desc: 'Drag any icon of the left side menu to a new place; a line shows where it will land. Only the order of the icons changes (the game is not touched). Right-click an icon > Reset the icon order puts everything back. The ScapeLite logo sits at the very bottom by default.', default: true },
    { key: 'sidebarTabsEnabled', type: 'toggle', section: 'Sidebar', label: 'Side Menu Tab Controls', desc: 'Adds a show/hide switch and a sticky pin to each side-menu icon in Settings > Hotkeys. Sticky icons stay visible when you minimize the side menu with the arrow at the top. Turning this off restores the game’s own behaviour.', default: true },
    { key: 'xpTrackerEnabled', type: 'toggle', section: 'XP Tracker', label: 'Show XP Tracker', desc: 'A small draggable chip with your live XP/hr over a rolling window, your busiest skills and an ETA to their next level.', default: true },
    { key: 'xpTrackerWindowMin', type: 'number', section: 'XP Tracker', label: 'Rate Window (minutes)', desc: 'How far back the XP/hr is measured. Shorter reacts faster, longer is steadier.', default: 5, min: 1, max: 60 },

    { key: 'osNotifyWhenFocused', type: 'toggle', section: 'Notifications', label: 'Notify While Focused', desc: 'The game normally only sends its Windows notifications (and so Pushover) while you are tabbed away. Turn on to get them even while the game window is focused. Which events notify is still controlled by the game’s own notification settings.', default: true },

    { key: 'gameBridgeEnabled', type: 'toggle', section: 'ScapeLite Core', label: 'Game Data Bridge', desc: 'A read-only view of the game’s own numbers (task times and XP, your bank, recipes, combat state). The Route Advisor, Bank Tools, Crafting Potential, Combat Readout and Task Log need it: with it off they stop working.', default: true },
    { key: 'mapRouteLanes', type: 'toggle', section: 'Route Advisor', label: 'Map Route Lanes & Arrows', desc: 'On the World Map, overlapping route legs are drawn side by side (in queue order) and the dashed pills become arrows moving in the direction of travel. Display only.', default: true },
    { key: 'guideRouteAdvisor', type: 'button', section: 'Route Advisor', label: 'Guide', desc: 'How to read the plan, the purple / blue borders and the warning tab.', buttonText: 'Open guide' },
    { key: 'routeTpWorthMin', type: 'number', section: 'Route Advisor', label: 'Teleport Worth It (minutes saved per charge)', desc: 'Used for the "Teleports would save..." hint when you plan on foot, and as the teleport price when "Teleport Must Save (steps)" is 0: minutes a charge has to save.', default: 10, min: 1, max: 600 },
    { key: 'routeTaskWeights', type: 'taskw', section: 'Route Advisor', label: 'Task Weights (Exceptions)', desc: 'Extra worth for specific tasks, on top of the skill priorities above. Meant for exceptions only, such as brewing Swift Potions. Each rule has a task id (or several, separated by |) and a multiplier: 2 = counts double, 1 = no change. A rule matches when the task id contains the text.', default: [{ match: 'swift_potion|fleet_potion|haste_potion', mult: 2.5 }, { match: 'potion_of_discovery', mult: 2.5 }] },
    { key: 'routePriorities', type: 'prio', section: 'Route Advisor', label: 'Skill Priorities', desc: 'How much a level in each skill is worth when the Route Advisor compares paths (1 = normal, 2 = twice as valuable). The default follows the community order: Vigor first, then healing and your combat gear chain, then potions. Combat skills also use the Combat Level Weight below.' },
    { key: 'routeCombatWeightPct', type: 'number', section: 'Route Advisor', label: 'Combat Level Weight (%)', desc: 'Paths are compared in levels gained per hour. One combat task trains several cheap skills at once, so combat levels would always win; this counts them at this percentage (100 = equal to a skilling level).', default: 40, min: 0, max: 200 },
    { key: 'routeWorker', type: 'toggle', section: 'Route Advisor', label: 'Search On A Background Thread', desc: 'The Route Advisor searches for better orders on its own thread, so the game keeps its frame rate while it thinks. Turn it off to search in short slices on the game\u2019s own thread instead.', default: true },
    { key: 'routeObjective', type: 'select', section: 'Route Advisor', label: 'What The Route Advisor Optimises', desc: 'XP per hour (default): priority-weighted XP over the time it takes, walking included, so long high-tier tasks win. Levels per hour: values XP by what each skill’s next level costs, which favours cheap low-level skills. Balanced: a mix of both.', options: [['xp', 'XP per hour'], ['levels', 'Levels per hour'], ['balanced', 'Balanced']], default: 'xp' },
    { key: 'routeShowMaxTp', type: 'toggle', section: 'Route Advisor', label: 'Show Max Teleports Mode', desc: 'Adds a “Max” button next to On foot / Efficient in the Route Advisor. Max uses teleport charges freely. It is never used automatically: only when you switch this on and pick Max yourself. Off by default.', default: false },
    { key: 'routeTpMinEach', type: 'number', section: 'Route Advisor', label: 'Each Teleport Must Save (steps)', desc: 'On top of the total above, every single teleport charge has to save at least this many steps by itself. This stops the plan spending charges on small hops. Default 6000; lower it to use more charges, raise it to use fewer.', default: 6000, min: 0, max: 40000 },
    { key: 'routeTpSteps', type: 'number', section: 'Route Advisor', label: 'Teleports Must Save In Total (steps)', desc: 'Teleports are only used when all of them together save at least this many steps of walking over the whole route (the numbers in brackets in your queue add up). Below this the route is planned on foot.', default: 20000, min: 0, max: 60000 },
    { key: 'routeDropBoost', type: 'number', section: 'Route Advisor', label: 'XP-Boost Drop Bonus (x)', step: 0.1, desc: 'Kill tasks for mobs that can still drop an XP-boosting unlock you have not logged yet (Enchanted tools and similar) count this many times more. 1 = no bonus.', default: 1.3, min: 1, max: 5 },
    { key: 'routeGatherRatio', type: 'number', section: 'Route Advisor', label: 'Gathering vs Processing (x)', step: 0.1, desc: 'How much more a level in a GATHERING skill (Mine, Fish, Forage, Farm, Invoke) is worth than the same level in a PROCESSING skill (Smith, Cook, Craft, Brew, Imbue), applied on top of the skill priorities above. The Lever Advisor uses it too. 1 = exactly as the priorities say, 1.5 = gathering counts half as much again, 0.5 = processing is worth double.', default: 1, min: 0.1, max: 5 },
    { key: 'routeLuckyBoost', type: 'number', section: 'Route Advisor', label: 'Lucky Task Boost (x)', step: 0.5, desc: 'Extra worth of a Lucky task on top of its doubled XP, so the Route Advisor puts Lucky tasks first and picks them over normal options. 1 = only the doubled XP counts, 2 = Lucky tasks count double again (default), 4 = almost always first.', default: 2, min: 1, max: 10 },
    { key: 'routeMinGainPct', type: 'number', section: 'Route Advisor', label: 'Minimum Improvement To Suggest A Change (%)', desc: 'A new order is only suggested when it beats your queue (and the last suggestion) by at least this much progress per hour, and by at least a minute of time. Task times and walking are only known to within a couple of percent, so smaller gains are noise and would make the advice flip back and forth. With nothing new in your queue it must be twice as clear. 0 shows every difference.', default: 2, min: 0, max: 20, step: 0.5 },
    { key: 'routePickPenaltyPct', type: 'number', section: 'Route Advisor', label: 'Pick Swap Cost (%)', desc: 'Each option pick a suggestion swaps has to earn this much extra improvement on top of the Minimum Improvement below, so a swap is only suggested when it clearly pays.', default: 3, min: 0, max: 20 },
    { key: 'routeStayFloorPct', type: 'number', section: 'Route Advisor', label: 'Stay Put XP Floor (%)', desc: 'The advisor favours staying in one place: every move to another place counts as extra time, so tasks that share a place get stacked. A plan that stays put is only taken when its levels an hour are at least this share of the best plan that ignores moving, so a move that is clearly worth it still wins. 100 turns the preference off, 0 always stays put.', default: 85, min: 0, max: 100, step: 5 },
    { key: 'routeReorderPastBar', type: 'toggle', section: 'Route Advisor', label: 'Reorder Past The NEW TASKS Bar', desc: 'Off: only the rows above the gold NEW TASKS bar are reordered, the rows below it stay where they are (new tasks land at the bar). On: the whole queue is reordered. The Route Advisor panel has the same switch and shows what the other setting would give.', default: false },
    { key: 'routeAdvisorEnabled', type: 'toggle', section: 'Route Advisor', label: 'Enable Route Advisor', desc: 'Suggests the order of your queued tasks that minimises walking time, with and without teleport crystals. Display only: you apply a suggestion by dragging rows yourself.', default: true },
    { key: 'routeAdvisorDrawer', type: 'toggle', section: 'Route Advisor', label: 'Route Advisor As A Side Drawer', desc: 'Dock the Route Advisor to the right screen edge. It slides out from a slim tab and never sits over the World Map until you open it. Off = the old free-floating panel.', default: true },
    { key: 'routeAdvisorAutoMap', type: 'toggle', section: 'Route Advisor', label: 'Open Automatically On World Map', desc: 'Slide the Route Advisor out by itself whenever the World Map opens (with the drawer on, the tab is always there; this is off by default).', default: false },
    { key: 'routeAttach', type: 'select', section: 'Route Advisor', label: 'Attach The Route Badge To', desc: 'Where the Route Advisor badge sits: on the game’s own Tasks panel, or at the top of the info bar’s Tasks button card (hover the button). If the game’s Tasks panel is hidden or off and the bar has a Tasks button, this switches to the bar by itself.', options: [['original', 'The game’s Tasks panel'], ['bar', 'The info bar Tasks button']], default: 'original' },
    { key: 'routeAdvisorAlert', type: 'toggle', section: 'Route Advisor', label: 'Route Badge On The Tasks Panel', desc: 'A small badge above the task queue: a yellow warning when a faster route exists (dismiss it with the ×), then a green badge that keeps showing the time that could be saved, or Route optimal. Click it to open the Route Advisor without the World Map.', default: true },
    { key: 'routeAdvisorMinSaveSec', type: 'number', section: 'Route Advisor', label: 'Alert Threshold (seconds)', desc: 'Only warn when the suggestion reaches the same progress at least this many seconds sooner (walking time when the game data bridge is not attached).', default: 30, min: 5, max: 600 },
    { key: 'routePushover', type: 'toggle', section: 'Route Advisor', label: 'Notify on Big Savings', desc: 'Sends a notification (forwarded to Pushover by your notification listener) when a much faster route exists. At most once per suggestion and once every 30 minutes.', default: true },
    { key: 'osNotifyDismissSec', type: 'number', section: 'Notifications', label: 'Auto-Dismiss Windows Notifications (seconds)', desc: 'Closes each Windows notification this many seconds after it appears, and clears any that are left when you return to the game, so they do not pile up. 0 keeps them until you dismiss them.', default: 10, min: 0, max: 600 },
    { key: 'routePushoverMinSaveSec', type: 'number', section: 'Route Advisor', label: 'Notification Threshold (seconds)', desc: 'Only notify when the suggestion reaches the same progress at least this many seconds sooner (300 = 5 minutes).', default: 300, min: 30, max: 3600 },

  ];

  // Bigger categories ("groups"): the Plugins tab and its quick-jump menu show these, each holding the related sections.
  // Sections not listed here land in "More". About is a standalone, centred row.
  // Tidy-up: which section each setting lives in, and the order inside a section (listed keys first, in this order).
  const SECTION_OF = {
    // Panels was a catch-all: split by what the settings are about
    panelSmoothMove: 'Panel Dragging And Fusing', panelSnap: 'Panel Dragging And Fusing', panelAutoFuse: 'Panel Dragging And Fusing', fuseGroupToggle: 'Panel Dragging And Fusing', panelFuseEnabled: 'Panel Dragging And Fusing',
    raidDpsExtraEnabled: 'Quality Of Life', queueWalkRelative: 'Quality Of Life', queueWalkEnabled: 'Quality Of Life', goalsEnabled: 'Planning and Routes', diaryCreditsEnabled: 'Planning and Routes', advisorEnabled: 'Planning and Routes', dropLuckEnabled: 'Planning and Routes', uiScalePct: 'Panels', sidebarGroupsEnabled: 'Panels', uiDensity: 'Panels', uiAccent: 'Panels', uiPalette: 'Panels', uiLayoutEnabled: 'Panels', openLayoutEditor: 'Panels', hiddenPanels: 'Panels', showUiTour: 'Panels', uiFontPx: 'Panels', uiThemeEnabled: 'Panels', uiScaleMinPct: 'Panels', uiScaleEnabled: 'Panels', scapeliteMenuEnabled: 'Panels', materialShortageEnabled: 'Quality Of Life', materialShortageSaveCredit: 'Quality Of Life', mechanicsExplainerEnabled: 'Quality Of Life', chatDefaultEnabled: 'Quality Of Life', craftPotential: 'Quality Of Life', inventorySlotCount: 'Quality Of Life', taskCountInTitle: 'Quality Of Life', currentTaskCollapse: 'Quality Of Life',
    combatReadoutEnabled: 'Combat Readout', combat_autoZoom: 'Combat Readout', combat_eatFix: 'Combat Readout',
    // Route Advisor was 21 settings in one list
    routeObjective: 'Route Advisor: What It Optimises', routePriorities: 'Route Advisor: What It Optimises', routeGatherRatio: 'Route Advisor: What It Optimises', routeTaskWeights: 'Route Advisor: What It Optimises', routeCombatWeightPct: 'Route Advisor: What It Optimises',
    routeDropBoost: 'Route Advisor: What It Optimises', routeLuckyBoost: 'Route Advisor: What It Optimises', routeShowMaxTp: 'Route Advisor', routeTpMinEach: 'Route Advisor: What It Optimises', routeTpSteps: 'Route Advisor: What It Optimises', routeTpWorthMin: 'Route Advisor: What It Optimises', routePickPenaltyPct: 'Route Advisor: What It Optimises', routeMinGainPct: 'Route Advisor: What It Optimises', routeStayFloorPct: 'Route Advisor: What It Optimises', routeReorderPastBar: 'Route Advisor: What It Optimises',
    leverAdvisorEnabled: 'Levers And Task Log', leverAdvisorMasterPick: 'Levers And Task Log', leverAdvisorFocus: 'Levers And Task Log', taskLogEnabled: 'Levers And Task Log', slayCorrection: 'Levers And Task Log', optionLogEnabled: 'Levers And Task Log', taskTipEnabled: 'Levers And Task Log', exportTaskLog: 'Levers And Task Log', clearTaskLog: 'Levers And Task Log',
  };
  const ORDER = {
    'ScapeLite Core': ['statusIndicatorEnabled', 'ecoModeEnabled', 'uiAutoDeselect', 'uiStatusFps', 'hideBeforeLogin', 'gameBridgeEnabled', 'usageStatsEnabled', 'reportBug', 'showLooks', 'showSetup', 'showWelcome', 'welcomeTourEnabled', 'settingsNavMenu'],
    'Logs': ['logsEnabled', 'logsLevel', 'logsKeepDays', 'logsHistoryDays', 'logsMaxMB', 'logsStructured', 'logsTasks', 'logsFortress', 'logsDrops', 'logsAlerts', 'logsPerf', 'logsDiscord', 'openLogsFolder'],
    'Route Advisor': ['routeAdvisorEnabled', 'routeAdvisorDrawer', 'routeAdvisorAutoMap', 'routeAdvisorAlert', 'routeAttach', 'routeAdvisorMinSaveSec', 'routePushover', 'routePushoverMinSaveSec', 'mapRouteLanes', 'guideRouteAdvisor'],
    'Route Advisor: What It Optimises': ['routeWorker', 'routeObjective', 'routePriorities', 'routeGatherRatio', 'routeCombatWeightPct', 'routeDropBoost', 'routeLuckyBoost', 'routeTaskWeights', 'routeMinGainPct', 'routePickPenaltyPct', 'routeStayFloorPct', 'routeReorderPastBar', 'routeTpSteps', 'routeTpWorthMin'],
    'Levers And Task Log': ['leverAdvisorEnabled', 'leverAdvisorMasterPick', 'leverAdvisorFocus', 'taskLogEnabled', 'slayCorrection', 'optionLogEnabled', 'taskTipEnabled', 'exportTaskLog', 'clearTaskLog'],
    'Combat Readout': ['combatReadoutEnabled', 'combat_autoZoom', 'combat_eatFix'],
    'Quality Of Life': ['currentTaskCollapse', 'inventorySlotCount', 'taskCountInTitle', 'chatDefaultEnabled', 'queueWalkEnabled', 'queueWalkRelative', 'raidDpsExtraEnabled', 'mechanicsExplainerEnabled', 'materialShortageEnabled', 'materialShortageSaveCredit', 'craftPotential'],
    'Panels': ['modalFloatEnabled', 'modalSnapPct', 'openLayouts', 'useDefaultLayout', 'backToOldLayout', 'winDockEnabled', 'potionsDockEnabled', 'mapCloseCross', 'uiScaleEnabled', 'uiScalePct', 'uiScaleMinPct', 'uiThemeEnabled', 'uiPalette', 'clockFormat', 'anchorEnabled', 'cardFuseCloseTogether', 'cardFuseEnabled', 'uiTipAtCursor', 'uiNewPanelPct', 'uiInvAuto', 'uiSkillAuto', 'uiSkillShareTotal', 'uiInvRows', 'uiSkillCols', 'uiAccent', 'uiDensity', 'uiFontPx', 'uiLayoutEnabled', 'openLayoutEditor', 'showUiTour', 'hiddenPanels', 'sidebarGroupsEnabled', 'scapeliteMenuEnabled'],
    'Panel Dragging And Fusing': ['panelSmoothMove', 'panelSnap', 'panelAutoFuse', 'panelFuseEnabled', 'fuseGroupToggle'],
    'Raid Summary': ['raidSummaryEnabled', 'raidSummaryWebhook', 'raidSummaryMode', 'raidSummaryPartyOn', 'raidSummaryMinMembers', 'raidSummaryGuildOn', 'raidSummaryGuildMin', 'raidSummaryWaveOn', 'raidSummaryWaveMin', 'raidSummaryDungeons', 'raidSummaryRaids'],
  };
  // Second tidy-up: trackers, queue helpers and raid tools get their own sections instead of the catch-alls.
  Object.assign(SECTION_OF, {
    dropLuckEnabled: 'Trackers', treeAdvisorAutoOpen: 'Planning and Routes', treeAdvisorEnabled: 'Planning and Routes', goalsEnabled: 'Trackers', diaryCreditsEnabled: 'Trackers', advisorEnabled: 'Trackers', xpTrackerEnabled: 'Trackers', xpTrackerWindowMin: 'Trackers',
    queueWalkEnabled: 'Queue and Tasks', queueWalkRelative: 'Queue and Tasks', materialShortageEnabled: 'Queue and Tasks', materialShortageSaveCredit: 'Queue and Tasks',
    taskCountInTitle: 'Queue and Tasks', currentTaskCollapse: 'Queue and Tasks', walkBarCollapse: 'Queue and Tasks',
    raidDpsExtraEnabled: 'Raid DPS',
    mechanicsExplainerEnabled: 'Hover Info',
  });
  Object.assign(ORDER, {
    'Trackers': ['xpTrackerEnabled', 'xpTrackerWindowMin', 'goalsEnabled', 'diaryCreditsEnabled', 'advisorEnabled', 'dropLuckEnabled'],
    'Queue and Tasks': ['queueWalkEnabled', 'queueWalkRelative', 'materialShortageEnabled', 'materialShortageSaveCredit', 'taskCountInTitle', 'currentTaskCollapse', 'walkBarCollapse', 'uiQueueTrayChosen', 'uiQueueInsertBar', 'uiQueueOdds', 'uiQueueQueued', 'uiQueueClickMap', 'uiQueueMapPreview', 'uiQueueRightClick', 'uiQueueHeadLevel', 'uiQueueHeadLoadout', 'uiQueueHeadTraining', 'uiQueueHeadKills', 'uiQueueHeadIcons'],
  });
  SCHEMA.forEach((it) => { if (SECTION_OF[it.key]) it.section = SECTION_OF[it.key]; });
  (function sortSchema() {
    const idx = new Map(SCHEMA.map((it, i) => [it, i]));
    const secFirst = new Map();
    SCHEMA.forEach((it, i) => { if (!secFirst.has(it.section)) secFirst.set(it.section, i); });
    SCHEMA.sort((a, b) => {
      if (a.section !== b.section) return secFirst.get(a.section) - secFirst.get(b.section);
      const o = ORDER[a.section]; if (!o) return idx.get(a) - idx.get(b);
      const ia = o.indexOf(a.key), ib = o.indexOf(b.key);
      return (ia < 0 ? 999 + idx.get(a) : ia) - (ib < 0 ? 999 + idx.get(b) : ib);
    });
  })();

  const GROUPS = [
    ['Core', ['ScapeLite Core', 'Logs']],
    ['About', null],
    ['User Interface', ['Info Bars', 'Alerts', 'Panels', 'Panel Dragging And Fusing', 'Panel Mod', 'HP Panel', 'Quality Of Life', 'Hover Info', 'Bank', 'Sidebar', 'Combat Readout', 'Combat: Player', 'Combat: Enemies', 'Combat: Allies']],
    ['Trackers and Queue', ['Trackers', 'Queue and Tasks']],
    ['Planning and Routes', ['Route Advisor', 'Route Advisor: What It Optimises', 'Levers And Task Log', 'Walking Countdown']],
    ['Raids', ['Raid DPS', 'Raid Lobby Alerts', 'Raid Summary']],
    ['Notifications and Discord', ['Notifications', 'Chat Relay', 'Chat Relay Pings', 'Clan Hiscores', 'Activity Digest', 'Clan Status Board']],
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
  const DISCORD_SECRETS = ['relayClanWebhook', 'relayGlobalWebhook', 'relayLeaseWebhook', 'digestWebhook', 'hiscoresWebhook', 'raidSummaryWebhook', 'boardWebhook'];
  const TEAM_KEYS = ['clanRelayEnabled', 'globalRelayEnabled', 'relayPlainChat', 'pingRoles', 'hiscoresEnabled', 'hiscoresPollMinutes', 'hiscoresPostIntervalHours', 'hiscoresMajorRankChange', 'digestEnabled', 'digestIntervalHours', 'digestPostTimes', 'raidSummaryEnabled', 'raidSummaryMode', 'raidSummaryPartyOn', 'raidSummaryMinMembers', 'raidSummaryGuildOn', 'raidSummaryGuildMin', 'raidSummaryWaveOn', 'raidSummaryWaveMin', 'raidSummaryDungeons', 'raidSummaryRaids', 'clanBoardRoster', 'clanBoardRosterExclude', 'clanBoardIntervalMin', 'clanBoardTask', 'clanBoardLocation', 'clanBoardProgress', 'clanBoardLevelUps', 'clanBoardTotalLevel', 'clanBoardXpHr', 'clanBoardHp', 'clanBoardSlayer', 'clanBoardFortress', 'clanBoardOnlineSince', 'clanBoardToday'];   // team settings (docs/DISCORD-TEAM-SYNC.md)
  const DISCORD_TOGGLES = ['teamAutoSync', 'clanRelayEnabled', 'globalRelayEnabled', 'relayPlainChat', 'digestEnabled', 'hiscoresEnabled', 'raidSummaryEnabled', 'clanBoardEnabled'];

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
    if (item.key === 'showLooks') { const d = row.querySelector('.settings-toggle-desc'), base = item.desc, upd = () => { if (d && window.__ccPresets) d.textContent = 'Current look: ' + window.__ccPresets.currentName() + '. ' + base; }; upd(); row.addEventListener('mouseenter', upd); }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.buttonText || 'Run';
    btn.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:6px 16px;font:inherit;cursor:pointer;';
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#777'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--cc-border-strong)'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (item.key === 'resetScales' && window.__ccPanelScale) window.__ccPanelScale.reset();
      if (item.key === 'showWelcome' && window.__ccWelcome) window.__ccWelcome.open();
      if (item.key === 'showLooks' && window.__ccPresets) { window.__ccPresets.openChooser(); try { const m = document.querySelector('.modal-overlay'), sb = document.querySelector('.floating-tab-btn[data-tab=settings]'); if (sb && m && getComputedStyle(m).display !== 'none') sb.click(); } catch (er) { /* the chooser sits on top anyway */ } }
      if (item.key === 'alertsReset' && window.__ccAlerts && window.__ccAlerts.resetDismissed) { window.__ccAlerts.resetDismissed(); }
      if (item.key === 'showUiTour' && window.__ccWelcome && window.__ccWelcome.openUiTour) { window.__ccWelcome.openUiTour(); }
      if (item.key === 'openLayoutEditor' && window.__ccUILayout) { try { const m = document.querySelector('.modal-overlay'), b = document.querySelector('.floating-tab-btn[data-tab=settings]'); if (b && m && getComputedStyle(m).display !== 'none') b.click(); } catch (er) { /* leave Settings open */ } setTimeout(() => { if (!window.__ccUILayout.isOpen) window.__ccUILayout.toggle(); }, 200); }
      if (item.key === 'useDefaultLayout' && window.__ccUILayout && window.__ccUILayout.useDefault) { try { window.__ccUILayout.useDefault(); } catch (er) { /* the layout editor logs its own problems */ } }
      if (item.key === 'backToOldLayout' && window.__ccUILayout && window.__ccUILayout.backToOld) { try { window.__ccUILayout.backToOld(); } catch (er) { /* nothing to go back to */ } }
      if (item.key === 'showSetup' && window.__ccWelcome && window.__ccWelcome.openSetup) { window.__ccWelcome.openSetup(); try { const m = document.querySelector('.modal-overlay'), b = document.querySelector('.floating-tab-btn[data-tab=settings]'); if (b && m && getComputedStyle(m).display !== 'none') b.click(); } catch (er) {} }
      if (item.key === 'teamSettings' && window.__ccDiscordSetup) { window.__ccDiscordSetup.open('team'); }
      if (item.key === 'guideChatRelay' && window.__ccDiscordSetup) { window.__ccDiscordSetup.open(); }
      else if (item.key === 'guideChatRelay' && window.__ccWelcome) { window.__ccWelcome.openGuide('chat-relay'); try { const m = document.querySelector('.modal-overlay'), b = document.querySelector('.floating-tab-btn[data-tab=settings]'); } catch (er) {} }
      if (item.key === 'guideRouteAdvisor' && window.__ccWelcome) window.__ccWelcome.openGuide('route-advisor');
      if (item.key === 'guideClanBoard' && window.__ccWelcome) window.__ccWelcome.openGuide('clan-board');
      if (item.key === 'checkUpdates') { window.__ccUpdateReq = 'check'; if (infoEls.aboutInfo && infoEls.aboutInfo.descEl) infoEls.aboutInfo.descEl.textContent = 'Checking\u2026'; setTimeout(refreshAbout, 4000); setTimeout(refreshAbout, 9000); }
      if (item.key === 'applyUpdate') { window.__ccUpdateReq = 'apply'; if (infoEls.aboutInfo && infoEls.aboutInfo.descEl) infoEls.aboutInfo.descEl.textContent = 'Updating\u2026'; setTimeout(refreshAbout, 6000); setTimeout(refreshAbout, 15000); }
      if (item.key === 'openLayouts' && window.__ccLayouts) { window.__ccLayouts.open(); }
      if (item.key === 'reportBug' && window.__ccBugReport) { window.__ccBugReport.open(); }
      if (item.key === 'openLogsFolder') { window.__ccLogReq = 'open'; }
      if (item.key === 'exportTaskLog' && window.__ccTaskLog) { window.__ccTaskLog.export(); }
      if (item.key === 'clearTaskLog' && window.__ccTaskLog && confirm('Delete all recorded tasks?')) { window.__ccTaskLog.clear(); }
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
    input.style.cssText = 'width:260px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:5px 8px;font:inherit;';
    const eye = document.createElement('button');
    eye.type = 'button'; eye.innerHTML = EYE; eye.title = 'Show / hide';
    eye.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:5px 7px;cursor:pointer;display:grid;place-items:center;';
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
    input.style.cssText = 'width:200px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:5px 8px;font:inherit;';
    ['keydown', 'keyup', 'keypress'].forEach(t => input.addEventListener(t, ev => ev.stopPropagation())); // keep game hotkeys out of the field
    input.addEventListener('change', () => setVal(item.key, input.value.trim()));
    row.appendChild(input);
    controls[item.key] = { inputEl: input };
    return row;
  }

  // ---- clanmates list (Clan Status Board): a tick per clanmate, search, All / None. Stores the names that are switched OFF, so new clanmates start on ----
  function buildMembersRow(item) {
    const wrap = document.createElement('div'); wrap.className = 'settings-toggle-row'; wrap.style.cssText = 'display:block;';
    const head = document.createElement('div'); head.className = 'settings-toggle-text';
    head.innerHTML = '<div class="settings-toggle-label"></div><div class="settings-toggle-desc"></div>';
    head.firstChild.textContent = item.label; head.lastChild.textContent = item.desc || '';
    wrap.appendChild(head);
    const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;';
    const q = document.createElement('input'); q.type = 'text'; q.placeholder = 'Search'; q.spellcheck = false; q.autocomplete = 'off';
    q.style.cssText = 'width:150px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:4px 8px;font:inherit;';
    ['keydown', 'keyup', 'keypress'].forEach((t) => q.addEventListener(t, (ev) => ev.stopPropagation()));
    const mkBtn = (txt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:4px 12px;font:inherit;cursor:pointer;'; b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
    const list = document.createElement('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:8px;max-height:260px;overflow:auto;';
    const lc = (x) => String(x || '').trim().toLowerCase();
    const off = () => { const v = val(item.key); return Array.isArray(v) ? v.map(String) : []; };
    const roster = () => { try { const r = window.__ccBridge && window.__ccBridge.clanRoster && window.__ccBridge.clanRoster(); return r && r.state === 'ok' && Array.isArray(r.members) ? r.members.map((m) => ({ name: m.name, online: !!m.online })) : null; } catch (e) { return null; } };
    function render() {
      list.textContent = '';
      const ro = roster(), offSet = new Set(off().map(lc)), term = lc(q.value);
      if (!ro) { const e = document.createElement('div'); e.textContent = 'The clan list is not available yet. Open the game and join your clan, then press Reload.'; e.style.cssText = 'color:var(--cc-text-dim);font-size:12px;'; list.appendChild(e); }
      else ro.filter((m) => !term || lc(m.name).indexOf(term) !== -1).forEach((m) => {
        const lab = document.createElement('label'); lab.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;padding:2px 0;';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !offSet.has(lc(m.name));
        cb.addEventListener('change', () => { const cur = off().filter((n) => lc(n) !== lc(m.name)); if (!cb.checked) cur.push(m.name); setVal(item.key, cur); });
        const t = document.createElement('span'); t.textContent = m.name + (m.online ? '  · online' : '');
        lab.append(cb, t); list.appendChild(lab);
      });
      // switched-off clanmates who left the clan are remembered (they stay off if they come back) until you forget them
      if (ro) {
        const here = new Set(ro.map((m) => lc(m.name)));
        off().filter((n) => !here.has(lc(n))).forEach((n) => {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;color:var(--cc-text-dim);font-size:12px;';
          const t = document.createElement('span'); t.textContent = n + '  · left the clan, stays off';
          row.append(t, mkBtn('Forget', () => { setVal(item.key, off().filter((x) => lc(x) !== lc(n))); render(); }));
          list.appendChild(row);
        });
      }
    }
    q.addEventListener('input', render);
    bar.append(q,
      mkBtn('All', () => { const ro = roster(); const here = new Set((ro || []).map((m) => lc(m.name))); setVal(item.key, off().filter((n) => !here.has(lc(n)))); render(); }),
      mkBtn('None', () => { const ro = roster(); if (!ro) return; const keep = off().filter((n) => !ro.some((m) => lc(m.name) === lc(n))); setVal(item.key, keep.concat(ro.map((m) => m.name))); render(); }),
      mkBtn('Reload', render));
    wrap.append(bar, list);
    render();
    controls[item.key] = { rerender: render };
    return wrap;
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
    add.style.cssText = 'margin-top:10px;background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer;';
    wrap.appendChild(add);
    const roles = () => { const v = val(item.key); return Array.isArray(v) ? v : []; };
    const commit = (arr) => { setVal(item.key, arr); };
    function render() {
      list.textContent = '';
      const cur = roles();
      if (!cur.length) { const e = document.createElement('div'); e.textContent = 'No ping roles yet. Nothing is mentioned until you create one.'; e.style.cssText = 'color:var(--cc-text-dim);font-size:12px;'; list.appendChild(e); }
      cur.forEach((r, i) => {
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--cc-border);border-radius:8px;padding:10px;background:rgba(255,255,255,.03);';
        const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        const mk = (ph, w, v, fn) => { const x = document.createElement('input'); x.type = 'text'; x.placeholder = ph; x.value = v || ''; x.spellcheck = false; x.autocomplete = 'off'; x.style.cssText = 'width:' + w + 'px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:5px 8px;font:inherit;'; ['keydown', 'keyup', 'keypress'].forEach(t => x.addEventListener(t, ev => ev.stopPropagation())); x.addEventListener('change', () => fn(x)); return x; };
        top.appendChild(mk('Name (for you)', 150, r.name, (x) => { const a = roles().slice(); a[i] = Object.assign({}, a[i], { name: x.value.trim() }); commit(a); }));
        const idIn = mk('Discord role ID', 200, r.roleId, (x) => { const digits = (x.value.match(/\d{6,}/) || [''])[0]; x.value = digits; const a = roles().slice(); a[i] = Object.assign({}, a[i], { roleId: digits }); commit(a); });
        top.appendChild(idIn);
        const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.style.cssText = 'margin-left:auto;background:var(--cc-bg-3);color:var(--cc-bad);border:1px solid #5a3a3a;border-radius:6px;padding:4px 12px;font:inherit;cursor:pointer;';
        del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const a = roles().slice(); a.splice(i, 1); commit(a); render(); });
        top.appendChild(del);
        card.appendChild(top);
        const cats = document.createElement('div'); cats.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
        PING_CATS.forEach(([k, label]) => {
          const on = (r.categories || []).indexOf(k) !== -1;
          const chip = document.createElement('button'); chip.type = 'button'; chip.textContent = label;
          const paint = (o) => { chip.style.cssText = 'padding:3px 11px;border-radius:12px;font:inherit;font-size:12px;cursor:pointer;border:1px solid ' + (o ? '#4a90e2' : 'var(--cc-border-strong)') + ';background:' + (o ? 'rgba(74,144,226,.22)' : '#22222c') + ';color:' + (o ? 'var(--cc-info)' : '#9a9aa6') + ';'; };
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
      if (!cur.length) { const e = document.createElement('div'); e.textContent = 'No rules. Every task is valued by its skill alone.'; e.style.cssText = 'color:var(--cc-text-dim);font-size:12px;'; list.appendChild(e); }
      cur.forEach((r, i) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;';
        const inCss = 'background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:6px;padding:6px 8px;font:inherit;';
        const m = document.createElement('input'); m.type = 'text'; m.value = r.match || ''; m.placeholder = 'task id, e.g. swift_potion'; m.setAttribute('list', 'cc-taskw-ids'); m.spellcheck = false; m.autocomplete = 'off'; m.style.cssText = inCss + 'flex:1;min-width:0;';
        m.addEventListener('change', () => { const a = rules().slice(); a[i] = Object.assign({}, a[i], { match: m.value.trim().toLowerCase() }); commit(a); });
        const x = document.createElement('span'); x.textContent = '×'; x.style.color = '#9a9aa8';
        const n = document.createElement('input'); n.type = 'number'; n.step = '0.1'; n.min = '0'; n.max = '10'; n.value = r.mult != null ? r.mult : 1; n.style.cssText = inCss + 'width:70px;';
        n.addEventListener('change', () => { const v = Math.max(0, Math.min(10, parseFloat(n.value))); const a = rules().slice(); a[i] = Object.assign({}, a[i], { mult: Number.isFinite(v) ? v : 1 }); commit(a); n.value = a[i].mult; });
        const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-bad);border:1px solid #5a3a3a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer;';
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
      b.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:12px;padding:3px 12px;font:inherit;font-size:12px;cursor:pointer;';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setVal(item.key, Object.assign({}, PRIO_PROFILES[name])); fill(); });
      profs.appendChild(b);
    });
    PRIO_SKILLS.forEach(([k, label]) => {
      const cell = document.createElement('label'); cell.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--cc-text);font-size:13px;';
      const sp = document.createElement('span'); sp.textContent = label;
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.max = '5'; inp.step = '0.1';
      inp.style.cssText = 'width:64px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:3px 6px;font:inherit;text-align:center;';
      ['keydown', 'keyup', 'keypress'].forEach(t => inp.addEventListener(t, ev => ev.stopPropagation()));
      inp.addEventListener('change', () => { let n = parseFloat(inp.value); if (!Number.isFinite(n)) n = 1; n = Math.max(0, Math.min(5, n)); inp.value = String(n); const o = Object.assign({}, cur()); o[k] = n; setVal(item.key, o); });
      inputs[k] = inp; cell.appendChild(sp); cell.appendChild(inp); grid.appendChild(cell);
    });
    fill();
    controls[item.key] = { prioFill: fill };
    return wrap;
  }

  const infoEls = {};
  // Every panel hidden with right-click > Hide this panel, each with a Restore button
  function buildHiddenRow(item) {
    const row = buildRowShell(item); row.style.flexWrap = 'wrap';
    const box = document.createElement('div'); box.style.cssText = 'flex-basis:100%;display:flex;flex-direction:column;gap:6px;margin-top:8px;';
    row.appendChild(box);
    const mk = (t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.style.cssText = 'background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:4px 14px;font:inherit;cursor:pointer;'; return b; };
    const fill = () => {
      box.textContent = '';
      const P = window.__ccPanelScale, list = P && P.hiddenList ? P.hiddenList() : [];
      if (!list.length) { const n = document.createElement('div'); n.textContent = 'No panels are hidden.'; n.style.cssText = 'color:#8a8a99;font-size:13px;'; box.appendChild(n); return; }
      list.forEach((p) => {
        const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.05);';
        const nm = document.createElement('span'); nm.style.flex = '1'; nm.textContent = p.label;
        const b = mk('Restore'); b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); P.unhide(p.id); fill(); });
        r.append(nm, b); box.appendChild(r);
      });
      if (list.length > 1) { const all = mk('Restore all'); all.style.alignSelf = 'flex-start'; all.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); P.unhideAll(); fill(); }); box.appendChild(all); }
    };
    fill(); return row;
  }
  function buildInfoRow(item) {
    const row = buildRowShell(item);
    if (item.key === 'aboutInfo') {
      const v = document.createElement('div'); v.className = 'cc-about-val'; v.style.cssText = 'color:var(--cc-info);text-align:right;max-width:360px;font-size:13px;';
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
      const rl = d.relayLease || {};   // version signalling: another ScapeLite user on the same lease webhook runs a newer version (nothing else about them is known)
      const peer = rl.newerVersion ? ' Another ScapeLite user on your relay runs v' + rl.newerVersion + ' and you are on v' + (rl.version || u.version || '?') + ': press Check For Updates.' : '';
      let t = u.error ? u.error : (u.message || '');
      if (u.behind > 0 && u.plugins && u.plugins.length) t += ' Plugins: ' + u.plugins.slice(0, 4).map(function (p) { return p.name + ' ' + (p.from ? p.from + '\u2192' : '') + p.to; }).join(', ') + '.';
      if (u.behind > 0 && u.commits && u.commits.length) t += ' Latest: ' + u.commits.slice(0, 2).join('; ') + '.';
      if (info.descEl) info.descEl.textContent = (t || 'Not checked yet.') + peer;
      info.valEl.style.color = (u.behind > 0 || peer) ? 'var(--cc-accent)' : u.error ? 'var(--cc-bad)' : 'var(--cc-info)';
    } catch (e) { if (info.descEl) info.descEl.textContent = 'ScapeLite dashboard not reachable.'; }
  }
  setInterval(refreshAbout, 5000);

  // Live preview of the clan board card (Settings > Plugins > Clan Status Board): the same card builder the watcher uses, drawn like a Discord embed.
  function boardRel(ms) {
    const s = Math.round((ms - Date.now()) / 1000), a = Math.abs(s), u = a < 90 ? [Math.max(1, a), 'second'] : a < 5400 ? [Math.round(a / 60), 'minute'] : a < 129600 ? [Math.round(a / 3600), 'hour'] : [Math.round(a / 86400), 'day'];
    const t = u[0] + ' ' + u[1] + (u[0] === 1 ? '' : 's');
    return s >= 0 ? 'in ' + t : t + ' ago';
  }
  function boardInline(parent, text) {
    if (/^_[^_\\]+_$/.test(String(text))) { const i = document.createElement('i'); i.textContent = String(text).slice(1, -1); parent.appendChild(i); return; }
    String(text == null ? '' : text).split(/(\*\*[^*]+\*\*|<t:\d+:R>)/).forEach((p) => {
      if (!p) return;
      let m;
      if ((m = /^\*\*([^*]+)\*\*$/.exec(p))) { const b = document.createElement('b'); b.textContent = m[1].replace(/\\([\\*_`~|>@#<])/g, '$1'); parent.appendChild(b); }
      else if ((m = /^<t:(\d+):R>$/.exec(p))) { const s = document.createElement('span'); s.textContent = boardRel(Number(m[1]) * 1000); s.style.cssText = 'background:rgba(255,255,255,.1);border-radius:3px;padding:0 3px;'; parent.appendChild(s); }
      else parent.appendChild(document.createTextNode(p.replace(/\\([\\*_`~|>@#<])/g, '$1')));
    });
  }
  function buildBoardPreviewRow(item) {
    const row = buildRowShell(item);
    const box = document.createElement('div');
    box.style.cssText = 'flex:none;width:340px;max-width:100%;';
    row.appendChild(box);
    function draw() {
      if (!box.isConnected) return;
      const api = window.__ccClanBoard;
      box.textContent = '';
      if (!api || !api.preview) { const n = document.createElement('div'); n.style.cssText = 'color:var(--cc-text-dim);font-size:12px;'; n.textContent = 'The Clan status board plugin is not loaded (Marketplace > Clan Status Board).'; box.appendChild(n); return; }
      let r; try { r = api.preview(); } catch (e) { r = null; }
      const em = r && r.payload && r.payload.embeds && r.payload.embeds[0];
      if (!em) return;
      const card = document.createElement('div');
      card.style.cssText = 'background:#2b2d31;color:#dbdee1;border-radius:4px;border-left:4px solid #' + (em.color || 0).toString(16).padStart(6, '0') + ';padding:8px 12px 10px;font:13px/1.4 system-ui,sans-serif;';
      if (em.thumbnail && /^https:\/\/play\.scapewatch\.com\//.test(em.thumbnail.url || '')) { const im = document.createElement('img'); im.src = em.thumbnail.url; im.alt = ''; im.style.cssText = 'float:right;width:40px;height:40px;margin:0 0 4px 8px;border-radius:4px;'; card.appendChild(im); }   // the task's skill icon, from the game's own files
      const au = document.createElement('div'); au.style.cssText = 'font-weight:600;color:#fff;margin-bottom:2px;'; au.textContent = em.author && em.author.name || ''; card.appendChild(au);
      String(em.description || '').split('\n').forEach((ln) => { if (!ln.trim()) return; const d = document.createElement('div'); boardInline(d, ln); card.appendChild(d); });
      if (em.fields && em.fields.length) {
        const g = document.createElement('div'); g.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;margin-top:6px;';
        em.fields.forEach((f) => {
          const c = document.createElement('div'); if (!f.inline) c.style.gridColumn = '1 / -1';
          const n = document.createElement('div'); n.style.cssText = 'font-weight:600;color:#fff;font-size:12px;'; n.textContent = f.name; c.appendChild(n);
          String(f.value).split('\n').forEach((ln) => { const v = document.createElement('div'); boardInline(v, ln); c.appendChild(v); });
          g.appendChild(c);
        });
        card.appendChild(g);
      }
      const ft = document.createElement('div'); ft.style.cssText = 'margin-top:8px;font-size:11px;color:#949ba4;'; ft.textContent = (em.footer && em.footer.text || '') + (r.live ? ' (live values)' : ' (no game data yet: sample)'); card.appendChild(ft);
      box.appendChild(card);
    }
    draw();
    const timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } draw(); }, 3000);
    return row;
  }

  function buildNumberRow(item) {
    const row = buildRowShell(item);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(item.min != null ? item.min : 1);
    input.max = String(item.max || 999);
    if (item.step) input.step = String(item.step);
    input.value = String(val(item.key));
    input.style.cssText = 'width:80px;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:5px 8px;font:inherit;text-align:center;';
    input.addEventListener('change', () => {
      let n = item.step ? parseFloat(input.value) : parseInt(input.value, 10);
      if (!Number.isFinite(n)) n = item.default;
      n = Math.max(item.min != null ? item.min : 1, Math.min(item.max || 999, n));
      input.value = String(n);
      setVal(item.key, n);
    });
    row.appendChild(input);
    controls[item.key] = { inputEl: input };
    return row;
  }

  function buildSelectRow(item) {
    const row = buildRowShell(item);
    const sel = document.createElement('select');
    sel.style.cssText = 'background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:4px;padding:5px 8px;font:inherit;';
    (item.options || []).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = String(val(item.key));
    sel.addEventListener('change', () => setVal(item.key, sel.value));
    ['keydown', 'keyup', 'keypress'].forEach((t) => sel.addEventListener(t, (e) => e.stopPropagation()));
    row.appendChild(sel);
    controls[item.key] = { selectEl: sel };
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
    tag.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="15" height="15" style="display:block"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="var(--cc-accent)"/><rect x="34" y="34" width="24" height="12" fill="var(--cc-accent)"/><rect x="34" y="46" width="24" height="12" fill="var(--cc-accent)"/><rect x="46" y="58" width="36" height="12" fill="var(--cc-accent)"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg>';
    tag.style.cssText = 'margin-left:12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cc-accent,var(--cc-accent));cursor:help;vertical-align:middle;padding:3px 5px;border:1px solid rgba(255,210,74,.4);background:rgba(255,210,74,.12);border-radius:10px;display:inline-block;';
    tag.title = 'Made by the ScapeLite team' + (a.handle ? ' · by ' + a.handle : '');
    const open = () => {
      clearTimeout(authorHide);
      if (authorCard) return;
      const c = document.createElement('div');
      c.style.cssText = 'position:fixed;z-index:100003;min-width:230px;padding:10px 12px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.6);color:#ddd;font:13px/1.4 system-ui,sans-serif;';
      const t = document.createElement('div'); t.textContent = (a.handle || '') + (a.bio ? '  ·  ' + a.bio : ''); t.style.cssText = 'font-weight:700;margin-bottom:6px;color:var(--cc-text);'; c.appendChild(t);
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
      c.style.top = Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - cr.height - 4, r.bottom + 4) + 'px';
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
      else if (item.type === 'select') sec.appendChild(buildSelectRow(item));
      else if (item.type === 'secret') sec.appendChild(buildSecretRow(item));
      else if (item.type === 'info') sec.appendChild(buildInfoRow(item));
      else if (item.type === 'hiddenpanels') sec.appendChild(buildHiddenRow(item));
      else if (item.type === 'text') sec.appendChild(buildTextRow(item));
      else if (item.type === 'roles') sec.appendChild(buildRolesRow(item));
      else if (item.type === 'members') sec.appendChild(buildMembersRow(item));
      else if (item.type === 'boardpreview') sec.appendChild(buildBoardPreviewRow(item));
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

  // ---- the settings search box: the game filters only its own sections, so ScapeLite's rows follow the same box the same way
  // (rows whose text contains the query stay, a section with no match goes away, a section whose title matches stays whole, sub-headings hide while searching).
  const searchStyle = document.createElement('style'); searchStyle.id = 'cc-plugin-search-style';
  searchStyle.textContent = '.cc-sf-hide{display:none !important}';
  document.head.appendChild(searchStyle);
  function applyOwnSearch(q) {
    const t = String(q || '').trim().toLowerCase();
    document.querySelectorAll('.cc-group-head, .cc-row-break').forEach((e) => e.classList.toggle('cc-sf-hide', !!t));
    document.querySelectorAll('.settings-section[id^="settings-sec-cc-"]').forEach((sec) => {
      const head = sec.querySelector('.settings-section-header'), whole = !!t && !!head && (head.textContent || '').toLowerCase().includes(t);
      let n = 0;
      Array.from(sec.children).forEach((c) => {
        if (c === head) return;
        if (c.classList.contains('settings-subheading')) { c.classList.toggle('cc-sf-hide', !!t); return; }
        const ok = !t || whole || (c.textContent || '').toLowerCase().includes(t);
        c.classList.toggle('cc-sf-hide', !ok); if (ok) n++;
      });
      sec.classList.toggle('cc-sf-hide', !!t && n === 0);
    });
  }
  const searchInput = (e) => e.target && e.target.classList && e.target.classList.contains('settings-search-input');
  life.on(document, 'input', (e) => { if (searchInput(e)) applyOwnSearch(e.target.value); }, true);
  life.on(document, 'keydown', (e) => { if (searchInput(e) && e.key === 'Escape' && e.target.value) setTimeout(() => applyOwnSearch(e.target.value), 0); }, true);   // the game clears the box itself: follow what it left
  life.on(document, 'click', (e) => { if (e.target && e.target.classList && e.target.classList.contains('settings-search-clear')) setTimeout(() => { const i = document.querySelector('.settings-search-input'); applyOwnSearch(i ? i.value : ''); }, 0); }, true);

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
    try { life.dispose(); searchStyle.remove(); } catch (e) { /* already gone */ }
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc plugins-settings-ui torn down';
  }

  window[NS] = {
    version: 1,
    teardown,
    get(key) { return val(key); },
    // look settings only (the Layout Editor's Look row): ui* keys
    set(key, v) { if ((/^(ui|alert|cardFuse|anchor|hpPanel)[A-Z]/.test(key) || key === 'routeAttach' || key === 'routeReorderPastBar' || key === 'queueWalkRelative' || key === 'queueWalkEnabled' || key === 'verticalMenuEnabled' || key === 'menuBarHidden') && SCHEMA.some((it) => it.key === key)) setVal(key, v); },
    // Apply a whole bundle of LOOK settings at once (the ScapeLite looks in presets.js). Only keys that exist in the schema, are not secrets and
    // are look settings (the same family as set() above, plus the ScapeLite menu button and the menu dock) are written; the rest is refused and
    // returned so the caller can tell. The controls on the Plugins page follow.
    setBundle(obj) {
      const applied = [], refused = [];
      for (const key in (obj || {})) {
        const it = SCHEMA.find((s) => s.key === key), ok = it && it.type !== 'secret' && (/^(ui|alert|cardFuse|anchor|hpPanel)[A-Z]/.test(key) || ['routeAttach', 'queueWalkRelative', 'queueWalkEnabled', 'verticalMenuEnabled', 'menuBarHidden', 'scapeliteMenuEnabled', 'menuDockEnabled'].includes(key));
        if (ok) { values[key] = obj[key]; applied.push(key); } else refused.push(key);
      }
      save();
      for (const key of applied) { const c = controls[key]; if (!c) continue; if (c.switchEl) c.switchEl.classList.toggle('on', !!val(key)); if (c.inputEl) c.inputEl.value = String(val(key)); }
      return { applied, refused };
    },
    // Team settings: the watcher hands over values it has already checked (overlay/team-sync.js); only the keys of TEAM_KEYS are accepted, a webhook address never.
    teamApply(obj) {
      const applied = [];
      for (const key in (obj || {})) { if (TEAM_KEYS.indexOf(key) >= 0 && SCHEMA.some((it) => it.key === key && it.type !== 'secret')) { values[key] = obj[key]; applied.push(key); } }
      save();
      for (const key of applied) { const c = controls[key]; if (!c) continue; if (c.switchEl) c.switchEl.classList.toggle('on', !!val(key)); if (c.inputEl) c.inputEl.value = String(val(key)); if (c.rolesRender) c.rolesRender(); }
      return applied;
    },
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
    // The Discord setup wizard (discord-setup.js) may put a webhook in, ask whether one is saved and flip the relay switches, for these keys only. It never reads a
    // webhook back: the saved address stays in this page's memory and goes to the watcher through takeSecrets().
    discordPut(key, v) { if (DISCORD_SECRETS.indexOf(key) < 0) return false; v = String(v == null ? '' : v).trim(); secretVals[key] = v; pendingSecrets[key] = v; const c = controls[key]; if (c && c.secretEl) c.secretEl.value = v; return true; },
    discordHas(key) { return DISCORD_SECRETS.indexOf(key) >= 0 && !!secretVals[key]; },
    discordToggle(key) { if (DISCORD_TOGGLES.indexOf(key) < 0) return false; const next = !val(key); setVal(key, next); const c = controls[key]; if (c && c.switchEl) c.switchEl.classList.toggle('on', next); return next; },
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
