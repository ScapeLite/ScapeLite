// Scapewatch panel-resize watcher.
// Display-only automation of the INJECTION step, not of the game -- it
// never clicks, selects, or submits anything in the game itself; it only
// decides when to load panel-resize.js / chat-relay-collect.js / ws-hook.js /
// plugins-settings-ui.js / walking-countdown.js / hover-info.js (same mods,
// same README policy), and, using those: forwards Clan/Global
// drop, unlock and level-up announcements to Discord webhooks (chat
// relay), and periodically checks the clan's overall hiscores rank and
// posts to Discord when it changes (clan hiscores tracking). Nothing here
// reads any chat channel outside Clan/Global, and the only game-server
// requests ever sent are the same read-only ranking lookups the game's
// own Hiscores UI sends -- nothing that changes game state.
//
// Also runs a tiny local-only status dashboard (status-server.js) at
// http://localhost:7777/ -- connection state, chat-relay/clan-hiscores
// health, and a live tail of recent activity, so "is this actually
// working" doesn't require reading watcher.log by hand.
//
// Runs forever in the background. Polls the CDP endpoint
// (http://localhost:9222/json) until the Scapewatch page shows up, then:
//   1. Injects all three scripts into the page right away (covers "game
//      was already open when this watcher started").
//   2. Registers all three via Page.addScriptToEvaluateOnNewDocument, so
//      Chromium re-runs them automatically on every future navigation in
//      that same process (an in-game reload, F5, etc) -- no watcher action
//      needed for that case. ws-hook.js in particular only *works* when
//      picked up this way (document-start, before the game creates its own
//      WebSocket) -- see ws-hook.js's own header for why.
//   3. While connected, polls the chat-relay collector's queue every few
//      seconds and posts any new events to the configured Discord
//      webhook(s), and separately polls the clan's hiscores rank every
//      N minutes (configurable, default 20).
// If the debugger connection closes (the game was closed), it goes back to
// polling for the next launch. Intended to be started once (e.g. from the
// Windows Startup folder) and left running for the whole login session.
//
// Requires Scapewatch's Steam launch options to include:
//   --remote-debugging-port=9222 --remote-allow-origins=*
//
// Chat relay requires overlay/chat-relay-config.json (gitignored, not
// included -- copy chat-relay-config.example.json and fill it in; see
// overlay/README.md for the full format and how to get role IDs).
//
// Clan hiscores tracking requires overlay/clan-hiscores-config.json
// (gitignored, not included -- copy clan-hiscores-config.example.json and
// fill it in) AND at least one game reload/relaunch after this watcher
// first injects ws-hook.js (see that file's header for why).

'use strict';

const fs = require('fs');
const path = require('path');
const { startStatusServer } = require('./status-server');
const logstore = require('./logstore');
const P = require('./paths');

const PANEL_SCRIPT_PATH = path.join(__dirname, 'panel-resize.js');
const CHAT_RELAY_SCRIPT_PATH = path.join(__dirname, 'chat-relay-collect.js');
const CHAT_RELAY_CONFIG_PATH = P.state('chat-relay-config.json');
const RELAYED_STATE_PATH = P.state('chat-relay-seen.json');
const PLAYER_ICON_CACHE_PATH = P.state('player-icon-cache.json');
const WS_HOOK_SCRIPT_PATH = path.join(__dirname, 'ws-hook.js');
const PLUGINS_UI_SCRIPT_PATH = path.join(__dirname, 'plugins-settings-ui.js');
const WALKING_COUNTDOWN_SCRIPT_PATH = path.join(__dirname, 'walking-countdown.js');
const HOVER_INFO_SCRIPT_PATH = path.join(__dirname, 'hover-info.js');
const ROUTE_ADVISOR_SCRIPT_PATH = path.join(__dirname, 'route-advisor.js');
const NOTIFY_ALWAYS_SCRIPT_PATH = path.join(__dirname, 'notify-always.js');
const XP_TRACKER_SCRIPT_PATH = path.join(__dirname, 'xp-tracker.js');
const MAP_ROUTES_SCRIPT_PATH = path.join(__dirname, 'map-routes.js');
const GAME_BRIDGE_PATH = path.join(__dirname, 'game-bridge.js');
const SIDEBAR_TABS_SCRIPT_PATH = path.join(__dirname, 'sidebar-tabs.js');
const PANEL_FUSE_SCRIPT_PATH = path.join(__dirname, 'panel-fuse.js');
const SETTINGS_NAV_SCRIPT_PATH = path.join(__dirname, 'settings-nav.js');
const WELCOME_TOUR_SCRIPT_PATH = path.join(__dirname, 'welcome-tour.js');
const MENU_DOCK_SCRIPT_PATH = path.join(__dirname, 'menu-dock.js');
const MODAL_RESIZE_SCRIPT_PATH = path.join(__dirname, 'modal-resize.js');
const NOTIF_DOCK_SCRIPT_PATH = path.join(__dirname, 'notif-dock.js');
const BANK_TOOLS_SCRIPT_PATH = path.join(__dirname, 'bank-tools.js');
const WIN_DOCK_SCRIPT_PATH = path.join(__dirname, 'window-dock.js');
const CHAT_DEFAULT_SCRIPT_PATH = path.join(__dirname, 'chat-default.js');
const COMBAT_READOUT_SCRIPT_PATH = path.join(__dirname, 'combat-readout.js');
const BUG_REPORT_SCRIPT_PATH = path.join(__dirname, 'bug-report.js');
const USAGE_PING_SCRIPT_PATH = path.join(__dirname, 'usage-ping.js');
const CRAFT_POT_SCRIPT_PATH = path.join(__dirname, 'craft-potential.js');
const LAYOUTS_SCRIPT_PATH = path.join(__dirname, 'layouts.js');
const RAID_ALERT_SCRIPT_PATH = path.join(__dirname, 'raid-alert.js');
const RAIDS_DATA_PATH = path.join(P.dataRaw, 'raids.json');
const STATUS_INDICATOR_SCRIPT_PATH = path.join(__dirname, 'status-indicator.js');
const ACTIVITIES_DIR = path.join(P.dataRaw, 'activities');
const CLAN_HISCORES_CONFIG_PATH = P.state('clan-hiscores-config.json');
const CLAN_HISCORES_STATE_PATH = P.state('clan-hiscores-state.json');
const RAID_SUMMARY_CONFIG_PATH = P.state('raid-summary-config.json');
const DIGEST_CONFIG_PATH = P.state('digest-config.json');
const DIGEST_STATE_PATH = P.state('digest-state.json');
const LOG_PATH = P.state('watcher.log');
const CDP_PORT = 9222;
const STATUS_SERVER_PORT = 7777;
// `.localhost` is special-cased by Chromium (and most modern browsers) to
// always resolve straight to loopback -- confirmed live, 2026-10-07, with
// zero hosts-file changes needed. Any name ending in `.localhost` works
// the same way; this one's just this project's pick.
const STATUS_SERVER_FRIENDLY_HOST = 'scapelite.localhost';
const POLL_MS = 3000;
const CHAT_RELAY_POLL_MS = 5000;
const RAID_SUMMARY_POLL_MS = 5000;
const CLAN_HISCORES_INITIAL_DELAY_MS = 30000; // let the connection settle first
const HISCORES_AVATAR_URL = 'https://play.scapewatch.com/assets/icons/ui/hiscores.png'; // the sidebar crown
const HISCORES_MAX_PAGE_PROBE = 4000; // safety cap (~100k players) for the unbounded search
const DISCORD_POST_SPACING_MS = 500; // stay well under Discord's per-webhook rate limit
const URL_FILTER = /scapewatch/i;
const RECENT_LOG_CAP = 300;

// Status dashboard state -- see overlay/status-server.js. Plain mutable
// object updated in-place at the relevant points below; the status server
// just serializes whatever it currently holds on each /status request.
const STATUS = {
  startedAt: Date.now(),
  cdp: { connected: false, since: null },
  chatRelay: { configured: false, lastEventAt: null, totalRelayed: 0, totalSkipped: 0 },
  clanHiscores: { configured: false, wsHookReady: false, lastPollAt: null, lastClanRank: null, nextPollAt: null },
  raidSummary: { configured: false, lastPostAt: null, totalPosted: 0, totalSkippedSolo: 0 },
  digest: { configured: false, lastPostAt: null, nextPostAt: null, totalPosted: 0 },
  recentLog: [],
  plugins: [],
  bridge: { ok: false, attachedAt: null, ms: null, error: null },
};

// Supervised mode: overlay/supervisor.js forks this process with an IPC
// channel and hosts the dashboard itself (so Stop/Start/Restart work even
// when this process is down). Standalone `node panel-resize-watcher.js` still
// works exactly as before, serving its own dashboard.
const SUPERVISED = typeof process.send === 'function';

// Dashboard log categories. `cat`: "discord" (things relayed/posted to
// Discord) or "system" (everything else). `sub` refines it for colour coding:
//   discord: relay (chat relay events) | hiscores | raid | digest
//   system:  plugin | connection | config | error   (+ "supervisor", set by supervisor.js)
function categorize(text) {
  const t = text;
  if (/^\s*->\s*(clan|global|chat)\b/i.test(t)) return { cat: 'discord', sub: 'relay' };
  if (/hiscores/i.test(t) && /polled|posted|\bpost\b|rank/i.test(t)) return { cat: 'discord', sub: 'hiscores' };
  if (/raid summar/i.test(t) && /post/i.test(t)) return { cat: 'discord', sub: 'raid' };
  if (/digest/i.test(t) && /posted/i.test(t)) return { cat: 'discord', sub: 'digest' };
  if (/\bposted\b|webhook|discord post/i.test(t)) return { cat: 'discord', sub: 'relay' };
  if (/\bERROR\b|\bWARNING\b|failed|exception/i.test(t)) return { cat: 'system', sub: 'error' };
  if (/^\s*->\s*cc\b|^Plugin|plugin/i.test(t)) return { cat: 'system', sub: 'plugin' };
  if (/Connected to|Debugger connection|WebSocket|CDP|Waiting for the game|Running under|started\./i.test(t)) return { cat: 'system', sub: 'connection' };
  return { cat: 'system', sub: 'config' };
}

function log(...args) {
  const text = args.join(' ');
  const line = `[${new Date().toISOString()}] ${text}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (e) { /* best effort */ }
  const entry = Object.assign({ t: Date.now(), text }, categorize(text));
  STATUS.recentLog.push(entry);
  if (STATUS.recentLog.length > RECENT_LOG_CAP) STATUS.recentLog.shift();
  if (SUPERVISED) { try { process.send({ type: 'log', entry }); } catch (e) { /* supervisor gone */ } }
  else logstore.write(entry); // standalone: the supervisor normally owns the session log
}

// --- Plugin table (page-side mods) -------------------------------------------
// Which mods get injected into the game page. `core` mods are required by the
// Discord/settings machinery and can't be switched off. Enabled state lives in
// overlay/plugins-config.json ({"disabled": ["id", ...]}) and is editable from
// the dashboard (live inject / teardown, no game reload needed).
const PLUGINS_CONFIG_PATH = P.state('plugins-config.json');
const readScript = (file) => fs.readFileSync(file, 'utf8');
const PLUGIN_DEFS = [
  { id: 'ws-hook', label: 'WebSocket hook', core: true, ns: '__ccGameSocket', desc: 'Reads the game\u2019s websocket traffic (hiscores, raid summaries).', build: () => readScript(WS_HOOK_SCRIPT_PATH) },
  { id: 'panel-resize', core: true, label: 'Panel resize + vertical menu', ns: '__ccPanelScale', desc: 'Resize handles, edge anchoring, vertical bottom-right menu.', build: () => readScript(PANEL_SCRIPT_PATH) },
  { id: 'chat-relay', label: 'Chat collector (Discord relay)', ns: '__ccChatRelay', desc: 'Collects clan/game chat events for the Discord relay and digest.', build: () => readScript(CHAT_RELAY_SCRIPT_PATH) },
  { id: 'plugins-settings-ui', label: 'Plugins settings tab', core: true, ns: '__ccPluginSettings', desc: 'The Plugins tab inside the game\u2019s Settings.', build: () => {
      const authors = require('./authors').loadAuthors();
      return `window.__CC_AUTHORS = ${JSON.stringify(authors)};
` + readScript(PLUGINS_UI_SCRIPT_PATH);
    } },
  { id: 'walking-countdown', label: 'Walking countdown', ns: '__ccWalkingCountdown', desc: 'Measured-speed walking ETA panel.', build: () => readScript(WALKING_COUNTDOWN_SCRIPT_PATH) },
  {
    id: 'hover-info', core: true, label: 'Hover info', ns: '__ccHoverInfo', desc: 'XP / gold / mob / quest tooltips, distance colouring.',
    // hover-info.js needs the activity-XP / input-output / gold tables built at
    // startup (buildActivityTables) -- baked in as plain `window.` property
    // assignments ahead of its source. NOT `const`: a top-level const throws
    // "already been declared" on a second injection into the same page
    // (confirmed live, 2026-10-07).
    build: () => `window.__CC_ACTIVITY_XP = ${JSON.stringify(ACTIVITY_TABLES.xpTable)};\n` +
      `window.__CC_ACTIVITY_INOUT = ${JSON.stringify(ACTIVITY_TABLES.inoutTable)};\n` +
      `window.__CC_ACTIVITY_GOLD = ${JSON.stringify(ACTIVITY_TABLES.goldTable)};\n` +
      readScript(HOVER_INFO_SCRIPT_PATH),
  },
  { id: 'status-indicator', core: true, label: 'Status indicator', ns: '__ccStatusIndicator', desc: 'Corner dot showing watcher / Discord health.', build: () => readScript(STATUS_INDICATOR_SCRIPT_PATH) },
  { id: 'route-advisor', label: 'Route advisor', ns: '__ccRouteAdvisor', desc: 'Best task order, teleport-aware, with warning triangle.', build: () => readScript(ROUTE_ADVISOR_SCRIPT_PATH) },
  { id: 'notify-always', label: 'Notify while focused', ns: '__ccNotifyAlways', desc: 'Lets the game\u2019s OS notifications fire while focused.', build: () => readScript(NOTIFY_ALWAYS_SCRIPT_PATH) },
  { id: 'map-routes', label: 'Map route lanes + arrows', ns: '__ccMapRoutes', desc: 'World Map: overlapping route legs side by side, chevron arrows for direction.', build: () => readScript(MAP_ROUTES_SCRIPT_PATH) },
  {
    id: 'raid-alert', label: 'Raid lobby alert', ns: '__ccRaidAlert', desc: 'Notifies you when an open raid lobby has a strong party and a free slot (read-only; never joins).',
    // difficulty id -> {tier, name, slay, delve}: the join requirements the game itself enforces.
    build: () => {
      let defs = {};
      try {
        const raids = JSON.parse(fs.readFileSync(RAIDS_DATA_PATH, 'utf8')).raids || [];
        raids.forEach((r) => { defs[r.id] = { tier: r.tier, name: r.name, slay: r.slayLevelRequired || 0, delve: r.delveLevelRequired || 0 }; });
      } catch (e) { log('WARNING: could not read raids.json for the raid alert --', e.message); }
      return `window.__CC_RAID_DEFS = ${JSON.stringify(defs)};\n` + readScript(RAID_ALERT_SCRIPT_PATH);
    },
  },
  { id: 'sidebar-tabs', core: true, label: 'Side menu tab controls', ns: '__ccSidebarTabs', desc: 'Show/hide switches and sticky pins for the left icon strip (Settings > Hotkeys).', build: () => readScript(SIDEBAR_TABS_SCRIPT_PATH) },
  { id: 'window-dock', label: 'Window buttons dock', ns: '__ccWinDock', desc: 'The top-right button row: movable, resizable, collapsible to an edge badge; the cross closes the World Map.', build: () => readScript(WIN_DOCK_SCRIPT_PATH) },
  { id: 'layouts', label: 'Layout presets', ns: '__ccLayouts', desc: 'Save and load named layouts of your panels, docks and windows.', build: () => readScript(LAYOUTS_SCRIPT_PATH) },
  { id: 'chat-default', label: 'Chat default channel', ns: '__ccChatDefault', desc: 'Remembers your last chat channel and starts on the leftmost shown one.', build: () => readScript(CHAT_DEFAULT_SCRIPT_PATH) },
  { id: 'combat-readout', label: 'Combat readout', ns: '__ccCombatReadout', desc: 'Exact HP, Spirit, attack timer countdown, attacks per second and DPS on the combat screen.', build: () => readScript(COMBAT_READOUT_SCRIPT_PATH) },
  { id: 'bug-report', core: true, label: 'Bug report', ns: '__ccBugReport', desc: 'In-game bug report form (Settings > Plugins, and the bug icon under the status light).', build: () => {
      let official = [];
      try { official = (JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || []).filter((pl) => pl.id !== 'core').map((pl) => ({ id: pl.id, name: pl.name })); } catch (e) { /* no catalog */ }
      return `window.__CC_OFFICIAL = ${JSON.stringify(official)};
` + readScript(BUG_REPORT_SCRIPT_PATH);
    } },
  { id: 'usage-ping', label: 'Anonymous usage count', ns: '__ccUsagePing', desc: 'One anonymous request per day so the author can see roughly how many people use ScapeLite. Off in Settings or the first-launch setup.', build: () => readScript(USAGE_PING_SCRIPT_PATH) },
  { id: 'craft-potential', label: 'Crafting potential', ns: '__ccCraftPot', desc: 'Shows the level you could reach by crafting with every material in your bank, in the XP bar of the Smith / Craft / Imbue / Brew windows.', build: () => readScript(CRAFT_POT_SCRIPT_PATH) },
  { id: 'bank-tools', label: 'Bank tools', ns: '__ccBankTools', desc: 'Category separators in the bank, category chips on item hover, and sub-category filter menus.', build: () => readScript(BANK_TOOLS_SCRIPT_PATH) },
  { id: 'notif-dock', label: 'Notification dock', ns: '__ccNotifDock', desc: 'Raid/party invites and popups: always on top, centred, movable.', build: () => readScript(NOTIF_DOCK_SCRIPT_PATH) },
  { id: 'modal-resize', label: 'Resizable windows', ns: '__ccModalResize', desc: 'Shrink the big Settings / Bank / Crafting windows with a corner grip.', build: () => readScript(MODAL_RESIZE_SCRIPT_PATH) },
  { id: 'menu-dock', label: 'Menu + HP bar dock', ns: '__ccMenuDock', desc: 'Move, resize and fuse the vertical menu and HP bar.', build: () => readScript(MENU_DOCK_SCRIPT_PATH) },
  { id: 'welcome-tour', core: true, label: 'Welcome tour', ns: '__ccWelcome', desc: 'First-run popup explaining the plugin settings, dashboard and marketplace.', build: () => {
      let guides = {};
      try { (JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || []).forEach((pl) => { if (pl.guide) guides[pl.id] = pl.guide; }); } catch (e) { /* no catalog */ }
      return `window.__CC_GUIDES = ${JSON.stringify(guides)};\n` + readScript(WELCOME_TOUR_SCRIPT_PATH);
    } },
  { id: 'settings-nav', core: true, label: 'Settings quick-jump menu', ns: '__ccSettingsNav', desc: 'Hover a Settings category to jump straight to its sub-categories.', build: () => readScript(SETTINGS_NAV_SCRIPT_PATH) },
  { id: 'panel-fuse', core: true, label: 'Panel fuse', ns: '__ccPanelFuse', desc: 'Fuse panels that sit edge to edge: move together, cleaner seam.', build: () => readScript(PANEL_FUSE_SCRIPT_PATH) },
  { id: 'xp-tracker', core: true, label: 'XP/hr tracker', ns: '__ccXpTracker', desc: 'Live XP/hr chip with level-up ETA.', build: () => readScript(XP_TRACKER_SCRIPT_PATH) },
];
// Drop-in community plugins: overlay/plugins/<id>/plugin.json = {id, name, description, main, ns?}
// with `main` a page script (relative to that folder). They appear in the marketplace
// and are enabled/disabled exactly like the bundled ones.
(function loadExternalPlugins() {
  const dir = P.plugins;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  entries.forEach((d) => {
    if (!d.isDirectory()) return;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, d.name, 'plugin.json'), 'utf8'));
      if (!m || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id || '') || !m.main || PLUGIN_DEFS.some((x) => x.id === m.id)) return;
      const file = path.resolve(dir, d.name, m.main);
      if (!file.startsWith(path.resolve(dir, d.name) + path.sep)) return; // stay inside the plugin folder
      PLUGIN_DEFS.push({ community: true, id: m.id, label: m.name || m.id, ns: m.ns || ('__cc_' + m.id.replace(/-/g, '_')), desc: m.description || '', build: () => readScript(file) });
    } catch (e) { log('WARNING: could not load community plugin', d.name, '--', e.message); }
  });
})();
// Every injected plugin script gets a sourceURL so CPU profiles (and DevTools) can name it.
function withSourceUrl(def) { return def.build() + '\n//# sourceURL=cc-plugin-' + def.id + '.js'; }
function loadDisabledPlugins() {
  try { return new Set((JSON.parse(fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf8')).disabled) || []); } catch (e) { /* first run: fall through to the catalog defaults */ }
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || [];
    return new Set(cat.filter((p) => !p.core && p.default === false).map((p) => p.id));
  } catch (e) { return new Set(); }
}
function saveDisabledPlugins(set) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf8')) || {}; } catch (e) { cfg = {}; }
    cfg.disabled = [...set];
    fs.writeFileSync(PLUGINS_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) { log('ERROR: could not save plugins-config.json --', e.message); }
}
// Community plugins start disabled the first time they are seen (the user opts in from the marketplace).
(function seedCommunityDefaults() {
  const fresh = PLUGIN_DEFS.filter((d) => d.community);
  if (!fresh.length) return;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf8')) || {}; } catch (e) { cfg = {}; }
  const seen = new Set(cfg.seen || []);
  const add = fresh.filter((d) => !seen.has(d.id));
  if (!add.length) return;
  const disabled = loadDisabledPlugins();
  add.forEach((d) => { disabled.add(d.id); seen.add(d.id); });
  cfg.disabled = [...disabled]; cfg.seen = [...seen];
  try { fs.writeFileSync(PLUGINS_CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) { /* best effort */ }
})();
const pluginEnabled = (def) => def.core || !loadDisabledPlugins().has(def.id);
let activeConn = null; // { call, evalAwait, registered: {id: identifier}, loaded: Set } while the game is connected
function refreshPluginStatus() {
  STATUS.plugins = PLUGIN_DEFS.map((d) => ({
    id: d.id, label: d.label, desc: d.desc, core: !!d.core,
    enabled: pluginEnabled(d), loaded: !!(activeConn && activeConn.loaded.has(d.id)),
  }));
}
// Live enable/disable. Disabling tears the mod down in the page now and drops
// its next-document registration; enabling injects it now and re-registers.
async function setPluginEnabled(id, enabled) {
  const def = PLUGIN_DEFS.find((d) => d.id === id);
  if (!def) return { ok: false, error: 'unknown plugin' };
  if (def.core) return { ok: false, error: 'core plugin cannot be disabled' };
  const disabled = loadDisabledPlugins();
  if (enabled) disabled.delete(id); else disabled.add(id);
  saveDisabledPlugins(disabled);
  log(`Plugin ${id}: ${enabled ? 'enabled' : 'disabled'} from the dashboard`);
  const conn = activeConn;
  let applied = false;
  if (conn) {
    try {
      if (enabled) {
        const code = withSourceUrl(def);
        await conn.evalAwait(code, false);
        const r = await conn.call('Page.addScriptToEvaluateOnNewDocument', { source: code });
        if (r && r.identifier) conn.registered[id] = r.identifier;
        conn.loaded.add(id);
      } else {
        await conn.evalAwait(`(function(){try{var m=window.${def.ns};if(m&&m.teardown)m.teardown();}catch(e){} return 'ok';})()`, false);
        if (conn.registered[id]) { await conn.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: conn.registered[id] }); delete conn.registered[id]; }
        conn.loaded.delete(id);
      }
      applied = true;
    } catch (e) { log('ERROR: could not apply plugin change live --', e.message); }
  }
  refreshPluginStatus();
  return { ok: true, applied };
}

function loadChatRelayConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CHAT_RELAY_CONFIG_PATH, 'utf8'));
    STATUS.chatRelay.configured = true;
    return cfg;
  } catch (e) {
    STATUS.chatRelay.configured = false;
    return null; // not configured -- relay stays off
  }
}

// Hover info (hover-info.js) needs per-action success-XP, and -- for the
// gold-profit bonus line -- single input/output item pairs, for every
// skilling activity. Neither is available from any live game endpoint
// (confirmed: mobs.json/quests.json/items.json have none of this) -- it
// only exists in this repo's own extracted data/raw/activities/<skill>.json
// files. Built ONCE here at watcher startup (AST-only/plain JSON reads, no
// API cost) by flattening every file in that directory into two lookup
// tables keyed "<skill>:<activityId>", then baked into the injected page as
// preamble constants prepended ahead of hover-info.js's own source at
// injection time (see the injection site below) -- a new pattern for this
// project (every other script here just reads its own file verbatim), used
// because this is page-side data that has no live server endpoint to fetch
// it from, unlike mobs.json/quests.json/items.json which hover-info.js
// fetches directly.
function buildActivityTables() {
  const xpTable = {};
  const inoutTable = {};
  const goldTable = {}; // "<skill>:<activityId>" -> expected gold per successful action (loot tables with a gold entry)
  let files = [];
  try {
    files = fs.readdirSync(ACTIVITIES_DIR).filter((f) => f.endsWith('.json'));
  } catch (e) {
    log('WARNING: could not read data/raw/activities --', e.message, '-- hover-info XP preview will be unavailable.');
    return { xpTable, inoutTable, goldTable };
  }
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(ACTIVITIES_DIR, file), 'utf8'));
    } catch (e) {
      log('WARNING: could not parse activities file', file, '--', e.message);
      continue;
    }
    const skill = data.skill;
    for (const act of (data.activities || [])) {
      if (!skill || !act.activityId) continue;
      const key = skill + ':' + act.activityId;
      if (typeof act.successXP === 'number') xpTable[key] = act.successXP;
      if (act.input && act.output) inoutTable[key] = { input: act.input, output: act.output };
      // Real coin rewards only: activities whose loot table has a `gold`
      // entry (Plunder, Bard). Barter is skipped -- its gold is spent, not
      // earned. Expected gold per success = sum(weight * avg qty) / sum(weight)
      // over the whole table (sub-table / scroll entries count as non-gold).
      if (skill !== 'barter' && Array.isArray(act.lootTable)) {
        let total = 0, gold = 0;
        for (const e of act.lootTable) {
          const w = typeof e.weight === 'number' ? e.weight : 0;
          total += w;
          if (e.itemId === 'gold') {
            const q = Array.isArray(e.quantity) ? (e.quantity[0] + e.quantity[1]) / 2 : (typeof e.quantity === 'number' ? e.quantity : 1);
            gold += w * q;
          }
        }
        if (gold > 0 && total > 0) goldTable[key] = gold / total;
      }
    }
  }
  log(`Hover info: built activity-XP table (${Object.keys(xpTable).length} activities, ${Object.keys(inoutTable).length} with known input/output).`);
  return { xpTable, inoutTable, goldTable };
}
const ACTIVITY_TABLES = buildActivityTables();

async function findPage() {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json`);
    if (!res.ok) return null;
    const targets = await res.json();
    return targets.find(t => t.type === 'page' && URL_FILTER.test(t.url)) || null;
  } catch (e) {
    return null; // CDP not up yet -- game isn't running
  }
}

// --- Discord formatting -----------------------------------------------

const CATEGORY_META = {
  unlock: { emoji: '🔓', roleKey: 'unlock' },
  rareDrop: { emoji: '💎', roleKey: 'rareDrop' },
  petDrop: { emoji: '🐾', roleKey: 'pet' },
  shinyPetDrop: { emoji: '✨', roleKey: 'shinyPet' },
  levelUp: { emoji: '⭐', roleKey: 'levelUp' },
  collection: { emoji: '📖', roleKey: 'rareDrop' },
  questComplete: { emoji: '📜', roleKey: 'quest' },
};

// One emoji per skill, keyed by the game's own data-skill-id (pulled live
// from the real Skills panel, not guessed -- see overlay/README.md). Best
// a thematic reading of the id can do for a few of these (draw, sight,
// imbue, delve) -- swap any that don't match the actual skill icon.
const SKILL_EMOJI = {
  life: '❤️', spirit: '🪽', fish: '🐟', cook: '🍳', strike: '⚔️',
  heft: '💪', mine: '⛏️', smith: '🔨', sight: '🏹', draw: '🎨',
  forage: '🌿', craft: '🧵', focus: '🎯', surge: '⚡', invoke: '🔮',
  imbue: '🪄', dodge: '💨', defend: '🛡️', farm: '🌾', brew: '⚗️',
  slay: '💀', vigor: '🏃', plunder: '💰', barter: '⚖️', delve: '🕳️',
  fortify: '🧱', bard: '🎵', discover: '🔍', luck: '🍀', alms: '🙏',
};

// Secondary, text-based check -- the primary pet detection is the
// collector's category match (pets/shinyPets/... on Clan, pet/shiny_pet/...
// on Global), which is reliable. This catches non-pet "Shiny" items (e.g.
// a Shiny Telescope or Shiny Lucky Tool), which the game's own category
// list has no dedicated category for -- they come through as a plain
// rareDrops line, so this is the only way to detect them. Routed to its
// own "shinyRareDrop" role, separate from "shinyPet".
function isUltraRare(evt, keywords) {
  if (!keywords || !keywords.length) return false;
  if (evt.kind !== 'rareDrop' && evt.kind !== 'collection') return false;
  const hay = (evt.item || '').toLowerCase();
  return keywords.some(k => hay.includes(String(k).toLowerCase()));
}

function descriptionFor(evt) {
  switch (evt.kind) {
    case 'rareDrop':
    case 'petDrop':
    case 'shinyPetDrop':
      return evt.source ? `received **${evt.item}** from ${evt.source}` : `received **${evt.item}**`;
    case 'unlock': return `unlocked **${evt.item}**`;
    case 'levelUp': return `${evt.skill} level is now **${evt.level}**`;
    case 'collection': return `logged **${evt.item}**` + (evt.source ? ` (${evt.source})` : '') + (evt.luck ? ` · +${Number(evt.luck).toLocaleString('en-US')} Luck XP` : '');
    case 'questComplete': return `completed quest **${evt.item}**`;
    default: return evt.text || evt.raw;
  }
}

// Per-player avatar cache: badgeIconUrl (equipped title) is the normal
// avatar, but "game"-channel events (your own drops/unlocks/levels, merged
// into "clan" -- see chat-relay-collect.js) never have one, since the game
// leaves .chat-badge-slot empty on your own lines. Falling back straight to
// evt.iconUrl (the skill/item icon) meant your own avatar genuinely changed
// every event -- pickaxe for Mining, thread for Crafting, etc, not just a
// Discord display quirk. This cache makes it stable: only update it when a
// real badgeIconUrl shows up (another player's equipped title), otherwise
// keep reusing whatever's cached, and only seed from iconUrl on a true
// first sighting with nothing cached yet.
let playerIconCache = {};
function loadPlayerIconCache() {
  try { playerIconCache = JSON.parse(fs.readFileSync(PLAYER_ICON_CACHE_PATH, 'utf8')) || {}; } catch (e) { playerIconCache = {}; }
}
function savePlayerIconCache() {
  try { fs.writeFileSync(PLAYER_ICON_CACHE_PATH, JSON.stringify(playerIconCache)); } catch (e) { /* best effort */ }
}
function resolvePlayerAvatar(evt) {
  if (!evt.player) return evt.badgeIconUrl || evt.iconUrl || undefined;
  if (evt.badgeIconUrl) {
    if (playerIconCache[evt.player] !== evt.badgeIconUrl) {
      playerIconCache[evt.player] = evt.badgeIconUrl;
      savePlayerIconCache();
    }
    return evt.badgeIconUrl;
  }
  if (playerIconCache[evt.player]) return playerIconCache[evt.player];
  if (evt.iconUrl) {
    playerIconCache[evt.player] = evt.iconUrl;
    savePlayerIconCache();
  }
  return evt.iconUrl || undefined;
}

// No embeds -- an embed's padding/box has a fixed minimum size in Discord
// no matter how little is in it. The player's name/icon instead ride on
// the webhook's own per-message identity override (username/avatar_url),
// and the message itself is a single line of plain markdown text. Tried a
// ```ansi code-block tier-color treatment here too; dropped it after
// seeing it live -- the grey monospace box looked out of place next to
// the plain single-line messages. Tier tags still show, just as plain
// **bold** text like everything else, no color.
function buildDiscordPayload(evt, cfg) {
  const identity = { username: evt.player || undefined, avatar_url: resolvePlayerAvatar(evt) };

  if (evt.kind === 'chat') {
    return Object.assign({ content: evt.text }, identity);
  }

  const ultra = evt.kind !== 'petDrop' && evt.kind !== 'shinyPetDrop' && isUltraRare(evt, cfg.ultraRareKeywords);
  const meta = CATEGORY_META[evt.kind] || { emoji: '•', roleKey: null };
  const emoji = evt.kind === 'levelUp' ? (SKILL_EMOJI[(evt.skill || '').toLowerCase()] || meta.emoji) : (ultra ? '🌟' : meta.emoji);

  let roleKey = ultra ? 'shinyRareDrop' : meta.roleKey;
  if (roleKey === 'levelUp' && !cfg.pingLevelUps) roleKey = null;
  if (roleKey === 'rareDrop' && cfg.pingRareDrops === false) roleKey = null;
  if (roleKey === 'unlock' && cfg.pingUnlocks === false) roleKey = null;
  if ((roleKey === 'pet' || roleKey === 'shinyPet') && cfg.pingPets === false) roleKey = null;
  if (roleKey === 'quest' && cfg.pingQuests === false) roleKey = null;
  // Ping roles (Plugins > Chat Relay Pings): any number of roles, each with any number of categories. A category pings every
  // role that lists it. Without pingRoles the old per-category roleMentions + toggles apply.
  let mention = '';
  if (Array.isArray(cfg.pingRoles)) {
    const ck = ultra ? 'shinyRareDrop' : meta.roleKey;
    mention = ck ? cfg.pingRoles.filter((r) => r && /^\d{6,}$/.test(String(r.roleId || '')) && Array.isArray(r.categories) && r.categories.indexOf(ck) !== -1).map((r) => `<@&${r.roleId}>`).join(' ') : '';
  } else {
    const mentions = cfg.roleMentions || {};
    mention = roleKey && mentions[roleKey] ? mentions[roleKey] : '';
  }

  const prefix = ultra ? '**ULTRA RARE** ' : '';
  // Role mention moved to the end and spoiler-wrapped so it doesn't clutter
  // the line -- Discord still fires the ping/notification for a mention
  // inside ||spoiler|| tags, only the visible text is hidden until clicked.
  const mentionSuffix = mention ? ` ||${mention}||` : '';
  const content = `${emoji} ${prefix}${descriptionFor(evt)}${mentionSuffix}`;
  return Object.assign({ content }, identity);
}

// Returns true when Discord accepted the message (callers that must not lose
// it -- the chat relay outbox -- retry on false).
async function postToDiscord(webhookUrl, payload) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log('  -> Discord webhook error:', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    log('  -> Discord webhook request failed:', e.message || String(e));
    return false;
  }
}

// Global chat is server-wide (thousands of players), so plain banter is
// gated per-channel the same as Clan's -- off by default for Global.
// Structured events need no extra volume filtering: the collector only
// ever recognizes Global's own narrow category vocabulary (cape/pet
// milestones -- the game itself never broadcasts anything else to
// Global), so anything that reaches here already cleared that bar.
function shouldRelay(evt, channelCfg) {
  if (evt.kind === 'chat') return !!channelCfg.relayPlainChat;
  return true;
}

// Authoritative dedup -- same key shape as the collector's own in-page
// "seen" set, but persisted to disk, not just in-memory. This matters
// because of what a live rebuild test confirmed (2026-10-06): switching
// chat tabs away and back destroys and recreates every message's DOM node
// (confirmed via isConnected), but the message *content*, including its
// in-game timestamp, is preserved exactly. The collector's in-page set
// catches that fine *within one script instance's lifetime* -- but it
// (and an earlier in-memory-only version of this set) resets to empty on
// every watcher restart, which has no memory of what a *previous* process
// already relayed. The failure mode that exposed this: restart the
// watcher to deploy a fix -> user switches tabs -> the game rebuilds the
// whole visible history as "new" nodes -> a fresh process doesn't
// recognize any of it as already-sent -> the entire chat history gets
// relayed again. Persisting this set means a restart no longer forgets.
const RELAYED_CAP = 1000;
let relayedKeys = new Set();

function loadRelayedKeys() {
  try {
    const arr = JSON.parse(fs.readFileSync(RELAYED_STATE_PATH, 'utf8'));
    if (Array.isArray(arr)) relayedKeys = new Set(arr.slice(-RELAYED_CAP));
  } catch (e) { /* no state file yet -- fine, starts empty */ }
}

function saveRelayedKeys() {
  try { fs.writeFileSync(RELAYED_STATE_PATH, JSON.stringify(Array.from(relayedKeys))); } catch (e) { /* best effort */ }
}

const relayKey = (evt) => `${evt.channel}|${evt.timestamp || ''}|${evt.player}|${evt.text}`;
function isRelayed(evt) { return relayedKeys.has(relayKey(evt)); }
// Marked only AFTER Discord accepted the post (it used to be marked before, so a
// kill/restart mid-send lost the event for good).
function markRelayed(evt) {
  relayedKeys.add(relayKey(evt));
  if (relayedKeys.size > RELAYED_CAP) relayedKeys.delete(relayedKeys.values().next().value);
  saveRelayedKeys();
}

// --- Outbox: events drained from the page but not yet accepted by Discord ----
// Persisted to disk before any posting, so a watcher stop / restart / crash
// can't lose them: they're re-sent on the next start (or retried on the next
// tick after a failed post, up to OUTBOX_MAX_TRIES). A graceful Stop/Restart
// from the dashboard additionally flushes everything first (gracefulShutdown).
const OUTBOX_PATH = P.state('chat-relay-outbox.json');
const OUTBOX_MAX_TRIES = 6;
let outbox = [];
try { const a = JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf8')); if (Array.isArray(a)) outbox = a; } catch (e) { /* none yet */ }
function saveOutbox() {
  try { fs.writeFileSync(OUTBOX_PATH, JSON.stringify(outbox)); } catch (e) { /* best effort */ }
}
let outboxBusy = false;
async function processOutbox(cfg) {
  if (outboxBusy || !cfg) return;
  outboxBusy = true;
  try {
    while (outbox.length) {
      const evt = outbox[0];
      const channelCfg = cfg.channels && cfg.channels[evt.channel];
      let done = true;
      if (!channelCfg || !channelCfg.enabled || !channelCfg.webhookUrl || !shouldRelay(evt, channelCfg)) {
        /* this channel is off / filtered: nothing to send */
      } else if (isRelayed(evt)) {
        log('  -> skipped duplicate:', evt.channel, evt.kind, '--', evt.raw);
        STATUS.chatRelay.totalSkipped += 1;
      } else {
        log('  ->', evt.channel, evt.kind, '--', evt.raw);
        const ok = await postToDiscord(channelCfg.webhookUrl, buildDiscordPayload(evt, cfg));
        if (ok) {
          markRelayed(evt);
          STATUS.chatRelay.lastEventAt = Date.now();
          STATUS.chatRelay.totalRelayed += 1;
        } else {
          evt._tries = (evt._tries || 0) + 1;
          if (evt._tries >= OUTBOX_MAX_TRIES) log('  -> giving up on a relay event after', String(OUTBOX_MAX_TRIES), 'failed posts:', evt.raw);
          else done = false;
        }
      }
      if (!done) { saveOutbox(); break; } // retry on the next tick, keep order
      outbox.shift();
      saveOutbox();
      await new Promise((r) => setTimeout(r, DISCORD_POST_SPACING_MS));
    }
  } finally {
    outboxBusy = false;
  }
}
async function relayEvents(events, cfg) {
  outbox.push(...events); // persist BEFORE posting
  saveOutbox();
  await processOutbox(cfg);
}

// Graceful shutdown: pull whatever the page has queued, post everything pending,
// then exit. Bounded so a dead webhook can't hang a restart.
let shuttingDown = false;
async function gracefulShutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Shutting down (${reason}) -- flushing pending messages first`);
  try {
    await Promise.race([
      (async () => {
        if (activeConn && activeConn.flushRelay) await activeConn.flushRelay();
        else { const cfg = loadChatRelayConfig(); await processOutbox(cfg); }
      })(),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
  } catch (e) { log('Flush error during shutdown --', e.message || String(e)); }
  log(`Flush finished (${outbox.length} event(s) left in the outbox for next start) -- exiting`);
  setTimeout(() => process.exit(0), 150);
}
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// --- Clan hiscores tracking ----------------------------------------------
//
// Uses window.__ccGameSocket (installed by ws-hook.js) to send the exact
// same read-only request messages the game's own UI sends from
// Hiscores -> Clan -> "View Your Rank" and Hiscores -> Players ->
// "View Your Rank" -- reverse-engineered live, 2026-10-06, by watching
// real network traffic while clicking those buttons. Never sends
// anything that changes game state.
//
// ws-hook.js can only intercept the game's WebSocket if it's injected
// *before* the game's own script creates it (document-start, via
// Page.addScriptToEvaluateOnNewDocument) -- so on a page that was already
// open when the hook was first installed, window.__ccGameSocket.isReady()
// returns false until the next game reload/relaunch. Each poll just logs
// that and waits for the next cycle rather than erroring.

function loadClanHiscoresConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CLAN_HISCORES_CONFIG_PATH, 'utf8'));
    STATUS.clanHiscores.configured = !!(cfg && cfg.enabled);
    return cfg;
  } catch (e) {
    STATUS.clanHiscores.configured = false;
    return null; // not configured -- feature stays off
  }
}

function loadClanHiscoresState() {
  try {
    const s = JSON.parse(fs.readFileSync(CLAN_HISCORES_STATE_PATH, 'utf8'));
    if (s && typeof s === 'object') return Object.assign({ clanRank: null, members: {}, lastPost: null }, s);
  } catch (e) { /* no state yet */ }
  return { clanRank: null, members: {}, lastPost: null };
  // members: displayName -> {rank, totalLevel, page} -- updated every poll,
  // used only to hint findMemberInHiscores's search for the NEXT poll.
  // lastPost: {at, clanRank, members: {displayName -> {rank, totalLevel}}}
  // or null before the first-ever post -- the baseline everything gets
  // diffed against to decide what to announce (see pollClanHiscores).
  // Deliberately NOT the same thing as `members` above: if posting gets
  // throttled for hours (see "scarcity" below), `members` keeps moving
  // every poll (so the search stays cheap) while `lastPost.members` stays
  // frozen at whatever was last actually announced, so a delayed post
  // still shows the full change since then, not just the latest poll's.
}

function saveClanHiscoresState(state) {
  try { fs.writeFileSync(CLAN_HISCORES_STATE_PATH, JSON.stringify(state, null, 2)); } catch (e) { /* best effort */ }
}

function formatNumber(n) { return typeof n === 'number' ? n.toLocaleString('en-US') : String(n); }

// --- Raid summary ---------------------------------------------------------
//
// Posts a party-wide recap to Discord when a raid finishes -- top damage
// and shared loot, not just your own private "X reward" line (which the
// chat relay already deliberately ignores, see chat-relay-collect.js's
// game-channel filtering). Fed by ws-hook.js passively watching
// raid_state/raid_run_complete frames the game already receives; see that
// file's header for the real payload shapes.
//
// minMembers gates out solo runs by default (>=2 real players, clones
// excluded) -- requested explicitly, 2026-10-07: "a filter so it only
// sends the summary if there is atleast 2 clan members so its not only a
// solo run by myself etc."

function loadRaidSummaryConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(RAID_SUMMARY_CONFIG_PATH, 'utf8'));
    STATUS.raidSummary.configured = !!(cfg && cfg.enabled);
    return cfg;
  } catch (e) {
    STATUS.raidSummary.configured = false;
    return null; // not configured -- feature stays off
  }
}

function formatRaidDuration(ms) {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function buildRaidSummaryPayload(entry) {
  const dmgLine = entry.perPlayerDamage.length
    ? entry.perPlayerDamage.slice(0, 5).map((p) => `${p.playerName} (${formatNumber(p.damageDealt)})`).join(', ')
    : '--';
  const lootLine = entry.loot.length
    ? entry.loot.map((l) => `${l.quantity > 1 ? l.quantity + 'x ' : ''}${l.name}${l.isRare ? ' 🌟' : ''}`).join(', ')
    : 'No loot';
  const memberWord = entry.memberCount === 1 ? 'member' : 'members';
  const content = `⚔️ **${entry.raidName}** complete -- ${entry.memberCount} ${memberWord}, ${formatRaidDuration(entry.runMs)}\n` +
    `🏆 ${dmgLine}\n` +
    `🎁 ${lootLine}`;
  return { username: 'Raid Summary', content };
}

// --- Activity digest -------------------------------------------------------
//
// A periodic (default every 6h) Discord rollup of notable Clan+Global
// activity, categorized by player -- rare drops, unlocks, pet drops, level
// milestones, and completed quests. Requested 2026-10-07 explicitly as
// something separate from (not a replacement for) the existing live
// per-event relay: "either 2 daily summaries or 4, so either every 12 or 6
// hours." Defaults to every 6 hours (4x/day), configurable.
//
// Accumulates INDEPENDENTLY of the live relay's own per-channel/per-type
// enabled toggles -- fed directly from every drained chat-relay event (see
// the ws.addEventListener('message') handler's pendingDrains branch),
// not from inside relayEvents() -- so the digest keeps working even if the
// player has turned off live Discord pings entirely. Persisted to disk
// (digest-state.json) so hours of accumulated activity survive a watcher
// restart, same "persisted state" lesson as everywhere else in this file.

function loadDigestConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(DIGEST_CONFIG_PATH, 'utf8'));
    STATUS.digest.configured = !!(cfg && cfg.enabled);
    return cfg;
  } catch (e) {
    STATUS.digest.configured = false;
    return null; // not configured -- feature stays off
  }
}

function emptyDigestBuffer() {
  return { sinceAt: Date.now(), players: {}, seenKeys: [] };
}

function loadDigestBuffer() {
  try {
    const b = JSON.parse(fs.readFileSync(DIGEST_STATE_PATH, 'utf8'));
    if (b && typeof b === 'object' && b.players) return Object.assign({ seenKeys: [] }, b);
  } catch (e) { /* no buffer yet */ }
  return emptyDigestBuffer();
}

function saveDigestBuffer(buffer) {
  try { fs.writeFileSync(DIGEST_STATE_PATH, JSON.stringify(buffer)); } catch (e) { /* best effort */ }
}

let digestBuffer = emptyDigestBuffer(); // loaded for real in main()

// Independent dedup, same key shape and same reasoning as `alreadyRelayed`
// above (restart + DOM-rebuild can re-drain already-seen chat history as
// "new") -- but deliberately a SEPARATE Set/array, not a reuse of
// `relayedKeys`. Confirmed necessary live, 2026-10-07: accumulateForDigest
// runs on every drained event regardless of whether relayEvents() already
// touched it for live-relay purposes (digest works even with live relay
// off), so if both shared one check-and-mark Set, whichever ran first in
// a given drain cycle (relayEvents does, see the call site) would mark an
// event as "seen" and the digest would then wrongly treat a BRAND NEW
// event as a duplicate just because relayEvents saw it moments earlier in
// the very same cycle. Capped and persisted the same way (DIGEST_SEEN_CAP,
// stored inside digest-state.json's own `seenKeys` field).
const DIGEST_SEEN_CAP = 1000;
let digestSeenKeys = new Set();
function syncDigestSeenKeys() { digestSeenKeys = new Set(digestBuffer.seenKeys || []); }
syncDigestSeenKeys();

function alreadyInDigest(evt) {
  const key = `${evt.channel}|${evt.timestamp || ''}|${evt.player}|${evt.text}`;
  if (digestSeenKeys.has(key)) return true;
  digestSeenKeys.add(key);
  if (digestSeenKeys.size > DIGEST_SEEN_CAP) digestSeenKeys.delete(digestSeenKeys.values().next().value);
  digestBuffer.seenKeys = Array.from(digestSeenKeys);
  return false;
}

// Only structured events are worth a digest line -- plain chat ('chat'
// kind) is deliberately skipped, same "noise vs. signal" call as the rest
// of this file.
function accumulateForDigest(events) {
  if (!Array.isArray(events) || !events.length) return;
  let changed = false;
  for (const evt of events) {
    if (!evt.player || evt.kind === 'chat') continue;
    if (alreadyInDigest(evt)) continue; // restart/DOM-rebuild re-drain guard -- see comment above
    changed = true; // seenKeys itself changed even on a kind/field this switch doesn't otherwise handle
    const p = digestBuffer.players[evt.player] || (digestBuffer.players[evt.player] = {
      rareDrops: [], unlocks: [], pets: [], quests: [], levels: {},
    });
    switch (evt.kind) {
      case 'rareDrop':
      case 'collection':
        if (evt.item) { p.rareDrops.push(evt.item); changed = true; }
        break;
      case 'petDrop':
      case 'shinyPetDrop':
        if (evt.item) { p.pets.push((evt.kind === 'shinyPetDrop' ? '✨ ' : '') + evt.item); changed = true; }
        break;
      case 'unlock':
        if (evt.item) { p.unlocks.push(evt.item); changed = true; }
        break;
      case 'questComplete':
        if (evt.item) { p.quests.push(evt.item); changed = true; }
        break;
      case 'levelUp':
        // Only the skill name + highest level reached in the window is
        // kept, not one line per ding -- a single skill can level up
        // dozens of times in 6h, which would otherwise bury everything
        // else in the digest under one repetitive skill's noise.
        if (evt.skill && evt.level != null) {
          const lvl = parseInt(evt.level, 10);
          if (Number.isFinite(lvl) && (p.levels[evt.skill] == null || lvl > p.levels[evt.skill])) {
            p.levels[evt.skill] = lvl;
            changed = true;
          }
        }
        break;
      default:
        break;
    }
  }
  if (changed) saveDigestBuffer(digestBuffer);
}

// Caps each category per player so one extremely active member can't blow
// past Discord's ~2000-char content limit on their own -- same "truncate
// rather than silently fail" approach used for quest-reward lines
// elsewhere in this mod.
const DIGEST_CAP_PER_CATEGORY = 8;
function capList(list) {
  if (list.length <= DIGEST_CAP_PER_CATEGORY) return list.join(', ');
  return list.slice(0, DIGEST_CAP_PER_CATEGORY).join(', ') + ` (+${list.length - DIGEST_CAP_PER_CATEGORY} more)`;
}

function buildDigestPayload(buffer) {
  const names = Object.keys(buffer.players).filter((name) => {
    const p = buffer.players[name];
    return p.rareDrops.length || p.unlocks.length || p.pets.length || p.quests.length || Object.keys(p.levels).length;
  });
  if (!names.length) return null;
  names.sort((a, b) => a.localeCompare(b));

  const hours = Math.round((Date.now() - buffer.sinceAt) / 3600000);
  const lines = [`📋 **Activity Digest** -- last ${hours}h`, ''];
  for (const name of names) {
    const p = buffer.players[name];
    lines.push(`**${name}**`);
    if (p.rareDrops.length) lines.push(`💎 Drops: ${capList(p.rareDrops)}`);
    if (p.pets.length) lines.push(`🐾 Pets: ${capList(p.pets)}`);
    if (p.unlocks.length) lines.push(`🔓 Unlocks: ${capList(p.unlocks)}`);
    const skillNames = Object.keys(p.levels);
    if (skillNames.length) {
      lines.push(`⭐ Levels: ${skillNames.map((s) => `${s} → ${p.levels[s]}`).join(', ')}`);
    }
    if (p.quests.length) lines.push(`📜 Quests: ${capList(p.quests)}`);
    lines.push('');
  }
  return { username: 'Activity Digest', content: lines.join('\n').trim() };
}

// Finds `displayName`'s current {rank, totalLevel, page} in the "overall"
// player hiscores. `hintPage`/`hintLevel` come from the last successful
// lookup (persisted state): checking the hinted page (and its near
// neighbors) first means every poll after the first is typically a
// single request, since a player's rank rarely moves far in 15-30
// minutes.
//
// Cold-search fallback (no hint, or the hinted neighborhood no longer
// matches): binary-search by hintLevel for the page bracket where that
// level currently sits (exponential probe for an upper bound first, since
// the API gives no total-page-count), check that bracket + its immediate
// neighbors (covers ties -- several players can share a level, and the
// binary search's landing page isn't guaranteed to be the specific one
// our target sits on), then -- if still not found -- walk from the lower
// bracket bound toward page 0.
//
// That last part matters: total level in this game only ever increases
// (confirmed: it's cumulative XP-derived, never decreases), so between
// polls a member's CURRENT page can only be the same or BETTER (lower)
// than wherever their OLD, stale hintLevel currently lands -- never
// worse. An earlier version of this walked from the *upper* bracket bound
// instead and, separately, only checked isolated power-of-2-spaced probe
// points rather than a contiguous walk -- both versions independently
// failed to find a member whose level had jumped (tested live with a
// synthetic +150 level jump, simulating a long gap between polls e.g.
// from the watcher being restarted): the first missed because walking
// away from page 0 can only ever find a *worse* rank than the stale
// hint, never the improved one; the second because it could jump clean
// over the target's actual page without ever landing on it. Fixed by
// walking the *lower* bound contiguously toward 0, bounded by a request
// budget so a single pathological case can't hang a poll cycle.
const HISCORES_WALK_BUDGET = 80;
const HISCORES_COLD_SCAN_BUDGET = 400; // ~10,000 players -- one-time cost for a never-before-seen member

async function findMemberInHiscores(evalAwait, displayName, hintPage, hintLevel) {
  // One retry on a failed/timed-out request before giving up on it -- a
  // member search is typically ~10 sequential round-trips (neighbor check,
  // doubling probe, binary narrow, walk fallback), and confirmed live,
  // 2026-10-07: a single one of those can occasionally time out as a pure
  // flake (the EXACT same page request timed out once, then succeeded in
  // 35ms moments later with nothing else changed) -- previously that one
  // flake failed the ENTIRE member lookup for the whole poll, which is why
  // a member could keep silently dropping out of the Discord summary even
  // though the search logic itself was finding their real page correctly.
  async function fetchPage(page) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await evalAwait(
          `window.__ccGameSocket.request({type:'hiscores_get_ranking',data:{skillId:'overall',page:${page}}}, 'hiscores_ranking', 8000)`,
          true
        );
        return data && Array.isArray(data.rows) ? data.rows : [];
      } catch (e) {
        if (attempt === 1) throw e; // second failure in a row -- let it propagate for real
      }
    }
  }
  function findInRows(rows) { return rows.find(r => r.displayName === displayName) || null; }

  if (hintPage != null) {
    for (const p of [hintPage, hintPage - 1, hintPage + 1, hintPage - 2, hintPage + 2]) {
      if (p < 0) continue;
      const hit = findInRows(await fetchPage(p));
      if (hit) return { rank: hit.rank, totalLevel: hit.totalLevel, page: p };
    }
  }

  // Truly cold: a brand-new member with no persisted state at all has no
  // level to binary-search by either. Confirmed as a real, not merely
  // theoretical, gap live, 2026-10-06: a freshly-configured member list
  // polled once, found nothing for any of the 5 members (none had prior
  // state), and -- because state is only ever written inside the "found"
  // branch below -- every one of them would have failed identically on
  // every future poll too, forever, not just this first one. Fall back to
  // a bounded sequential scan from page 0. Expensive, but it only ever
  // runs once per member: the very first success persists {page,
  // totalLevel}, and every poll after that uses the cheap hinted-neighbor
  // or binary-search paths above instead.
  if (hintLevel == null) {
    for (let p = 0; p <= HISCORES_COLD_SCAN_BUDGET; p++) {
      const hit = findInRows(await fetchPage(p));
      if (hit) return { rank: hit.rank, totalLevel: hit.totalLevel, page: p };
    }
    return null; // not found within budget -- will retry next poll
  }

  let lo = 0, hi = 1;
  let hiRows = await fetchPage(hi);
  while (hiRows.length && hiRows[hiRows.length - 1].totalLevel > hintLevel && hi < HISCORES_MAX_PAGE_PROBE) {
    lo = hi;
    hi *= 2;
    hiRows = await fetchPage(hi);
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const rows = await fetchPage(mid);
    if (rows.length && rows[rows.length - 1].totalLevel > hintLevel) lo = mid; else hi = mid;
  }

  const tried = new Set();
  for (const p of [lo, hi, lo + 1, hi + 1, lo - 1, hi - 1]) {
    if (p < 0 || tried.has(p)) continue;
    tried.add(p);
    const hit = findInRows(await fetchPage(p));
    if (hit) return { rank: hit.rank, totalLevel: hit.totalLevel, page: p };
  }
  for (let p = lo - 1, steps = 0; p >= 0 && steps < HISCORES_WALK_BUDGET; p--, steps++) {
    if (tried.has(p)) continue;
    const hit = findInRows(await fetchPage(p));
    if (hit) return { rank: hit.rank, totalLevel: hit.totalLevel, page: p };
  }
  return null; // genuinely not found -- name typo in config, or an extreme jump beyond the walk budget (will retry next poll)
}

async function pollClanHiscores(evalAwait, cfg) {
  STATUS.clanHiscores.lastPollAt = Date.now();
  const ready = await evalAwait(`window.__ccGameSocket ? window.__ccGameSocket.isReady() : false`, false).catch(() => false);
  STATUS.clanHiscores.wsHookReady = !!ready;
  if (!ready) {
    log('Clan hiscores: ws-hook not active yet (needs a game reload since it was installed) -- skipping this poll.');
    return;
  }

  let myRank;
  try {
    myRank = await evalAwait(`window.__ccGameSocket.request({type:'clan_hiscores_my_rank',data:{}}, 'clan_hiscores_my_rank', 8000)`, true);
  } catch (e) {
    log('Clan hiscores: request failed --', e.message || String(e));
    return;
  }
  if (!myRank || typeof myRank.rank !== 'number') return;
  STATUS.clanHiscores.lastClanRank = myRank.rank;

  const state = loadClanHiscoresState();
  const lastPost = state.lastPost; // baseline everything below diffs against -- NOT state.members, see loadClanHiscoresState's comment
  const memberChangesSincePost = [];

  for (const name of cfg.members || []) {
    // Hint for the SEARCH comes from the last POLL (state.members), kept
    // fresh every cycle regardless of posting -- cheap, and unrelated to
    // what gets announced.
    const hint = state.members[name] || {};
    let found = null;
    try {
      found = await findMemberInHiscores(evalAwait, name, hint.page, hint.totalLevel);
    } catch (e) {
      log('Clan hiscores: lookup failed for', name, '--', e.message || String(e));
    }
    if (!found) { log('Clan hiscores: could not locate member', JSON.stringify(name), 'in hiscores'); continue; }
    state.members[name] = { rank: found.rank, totalLevel: found.totalLevel, page: found.page };

    // What to ANNOUNCE is diffed against the last POST, not the last poll
    // -- so a throttled/delayed post still shows the full change since
    // then, not just whatever happened to move in the most recent poll.
    const prevPost = lastPost ? lastPost.members[name] : null;
    if (prevPost && (found.totalLevel !== prevPost.totalLevel || found.rank !== prevPost.rank)) {
      memberChangesSincePost.push({ name, prevLevel: prevPost.totalLevel, level: found.totalLevel, prevRank: prevPost.rank, rank: found.rank });
    }
  }

  // Posting is throttled ("scarce") -- requested 2026-10-07 after the
  // immediate-on-any-change behavior above (itself a fix from earlier the
  // same day) turned out to be too chatty for routine 1-2 level stat
  // drift. Posts now wait for `postIntervalMinutes` (default 360 = 6h)
  // UNLESS the clan's rank itself jumped by at least `majorRankChange`
  // (default 3) spots since the last post, which posts immediately
  // regardless of the timer -- "several spots moved" shouldn't sit
  // unannounced for hours just because the clock hasn't hit 6h yet.
  // Polling itself (how often the game is actually checked, separate
  // from how often we're willing to ANNOUNCE) is untouched -- still needs
  // to stay frequent so a major move is caught promptly, not just at the
  // next scheduled announcement.
  const rankChangeSincePost = lastPost && lastPost.clanRank != null ? myRank.rank - lastPost.clanRank : 0;
  const rankChanged = rankChangeSincePost !== 0;
  const hasChanges = rankChanged || memberChangesSincePost.length > 0;
  const isMajor = Math.abs(rankChangeSincePost) >= (cfg.majorRankChange || 3);
  const postIntervalMs = Math.max(1, cfg.postIntervalMinutes || 360) * 60000;
  const dueForScheduledPost = !lastPost || (Date.now() - (lastPost.at || 0)) >= postIntervalMs;
  const shouldPost = !!lastPost && hasChanges && (isMajor || dueForScheduledPost);

  state.clanRank = myRank.rank; // latest observed, independent of posting -- for status/logging only

  if (shouldPost) {
    const lines = [];
    if (rankChanged) {
      const arrow = myRank.rank < lastPost.clanRank ? '📈' : '📉';
      lines.push(`${arrow} **${cfg.clanTag || 'Clan'}** moved from clan rank **#${lastPost.clanRank}** to **#${myRank.rank}**${isMajor ? ' (major move)' : ''}`);
    } else {
      lines.push(`📊 **${cfg.clanTag || 'Clan'}** update -- rank unchanged at **#${myRank.rank}**`);
    }
    if (memberChangesSincePost.length) {
      lines.push('', rankChanged ? '**Reason**' : '**Changes**');
      // One block per member: name on its own line, then one line per change.
      // 🔼 = improvement (higher level, or a LOWER rank number), 🔽 = drop.
      for (const c of memberChangesSincePost) {
        lines.push('', `**${c.name}**`);
        if (c.prevLevel !== c.level) lines.push(`${c.level > c.prevLevel ? '🔼' : '🔽'} Total level ${formatNumber(c.prevLevel)} → ${formatNumber(c.level)}`);
        if (c.prevRank !== c.rank) lines.push(`${c.rank < c.prevRank ? '🔼' : '🔽'} Hiscores rank #${formatNumber(c.prevRank)} → #${formatNumber(c.rank)}`);
      }
    }
    if (cfg.webhookUrl) await postToDiscord(cfg.webhookUrl, { username: 'Clan Hi Scores', avatar_url: HISCORES_AVATAR_URL, content: lines.join('\n') });
    const memberSnapshot = {};
    for (const name of cfg.members || []) {
      if (state.members[name]) memberSnapshot[name] = { rank: state.members[name].rank, totalLevel: state.members[name].totalLevel };
    }
    state.lastPost = { at: Date.now(), clanRank: myRank.rank, members: memberSnapshot };
    log(
      'Clan hiscores:',
      rankChanged ? `rank changed ${lastPost.clanRank} -> ${myRank.rank}${isMajor ? ' (major)' : ''}` : `rank unchanged at ${myRank.rank}`,
      '--', memberChangesSincePost.length, 'member change(s) -- posted'
    );
  } else if (!lastPost) {
    // First poll ever (or state file was reset) -- establish the baseline
    // silently, same as the original first-poll guard, just now also
    // seeding `lastPost` rather than only `clanRank`.
    const memberSnapshot = {};
    for (const name of cfg.members || []) {
      if (state.members[name]) memberSnapshot[name] = { rank: state.members[name].rank, totalLevel: state.members[name].totalLevel };
    }
    state.lastPost = { at: Date.now(), clanRank: myRank.rank, members: memberSnapshot };
    log('Clan hiscores: first poll -- baseline established, rank', myRank.rank);
  } else {
    log(
      'Clan hiscores: polled, rank', myRank.rank,
      hasChanges ? `(${memberChangesSincePost.length} member change(s) + rank ${rankChanged ? 'moved' : 'unchanged'} since last post, not due/major yet)` : '(no change since last post)'
    );
  }
  saveClanHiscoresState(state);
}

// --- Plugins settings UI (in-game Settings -> Plugins tab) ---------------
//
// plugins-settings-ui.js (page-side) owns the actual toggle state
// (persisted to that page's localStorage); these values are an OVERRIDE
// layer on top of the JSON config files, read fresh every poll so a
// toggle flipped in-game takes effect within one poll cycle, no watcher
// restart needed. The JSON files remain authoritative for anything that
// can't safely live in page JS -- webhook URLs, role IDs, the member
// name list -- values the page UI never sees or controls.

const PLUGINS_NS = '__ccPluginSettings';

function applyPluginOverridesToChatCfg(cfg, plugin) {
  if (!cfg || !plugin) return cfg;
  const out = JSON.parse(JSON.stringify(cfg)); // shallow-safe clone; cfg is plain JSON data
  if (out.channels && out.channels.clan) {
    out.channels.clan.enabled = !!plugin.clanRelayEnabled;
    out.channels.clan.relayPlainChat = !!plugin.relayPlainChat;
  }
  if (out.channels && out.channels.global) {
    out.channels.global.enabled = !!plugin.globalRelayEnabled;
  }
  out.pingRareDrops = plugin.pingRareDrops !== false;
  out.pingUnlocks = plugin.pingUnlocks !== false;
  out.pingLevelUps = !!plugin.pingLevelUps;
  out.pingPets = plugin.pingPets !== false;
  out.pingQuests = !!plugin.pingQuests;
  if (Array.isArray(plugin.pingRoles)) {
    out.pingRoles = plugin.pingRoles.map((r) => ({ name: String(r && r.name || '').slice(0, 40), roleId: String(r && r.roleId || '').replace(/\D/g, ''), categories: Array.isArray(r && r.categories) ? r.categories.filter((c) => PING_CATEGORIES.indexOf(c) !== -1) : [] }));
    persistPingRoles(out.pingRoles);
  }
  return out;
}

// Ping role categories (relay event kinds) and the migration of the old per-category role mentions into ping roles.
const PING_CATEGORIES = ['rareDrop', 'shinyRareDrop', 'pet', 'shinyPet', 'unlock', 'levelUp', 'quest'];
function derivePingRoles(cfg) {
  if (!cfg) return [];
  if (Array.isArray(cfg.pingRoles)) return cfg.pingRoles;
  const on = { rareDrop: cfg.pingRareDrops !== false, shinyRareDrop: cfg.pingRareDrops !== false, unlock: cfg.pingUnlocks !== false, levelUp: !!cfg.pingLevelUps, pet: cfg.pingPets !== false, shinyPet: cfg.pingPets !== false, quest: !!cfg.pingQuests };
  const byId = {};
  Object.keys(cfg.roleMentions || {}).forEach((k) => { const m = /(\d{6,})/.exec(String(cfg.roleMentions[k] || '')); if (!m || !on[k]) return; (byId[m[1]] = byId[m[1]] || []).push(k); });
  return Object.keys(byId).map((id, i) => ({ name: 'Role ' + (i + 1), roleId: id, categories: byId[id] }));
}
let lastPingRoles = null;
function persistPingRoles(roles) {
  const s = JSON.stringify(roles);
  if (s === lastPingRoles) return;
  lastPingRoles = s;
  try {
    let file = {};
    try { file = JSON.parse(fs.readFileSync(CHAT_RELAY_CONFIG_PATH, 'utf8')) || {}; } catch (e) { return; } // no relay config yet: nothing to attach roles to
    if (JSON.stringify(file.pingRoles || null) === s) return;
    file.pingRoles = roles;
    fs.writeFileSync(CHAT_RELAY_CONFIG_PATH, JSON.stringify(file, null, 2));
    log('Ping roles saved (' + roles.length + ').');
  } catch (e) { log('ERROR: could not save ping roles --', e.message); }
}

function applyPluginOverridesToHiscoresCfg(cfg, plugin) {
  if (!cfg) return cfg; // nothing to merge into -- no webhook/members either way
  if (!plugin) return cfg;
  const out = Object.assign({}, cfg);
  out.enabled = plugin.hiscoresEnabled !== false;
  if (typeof plugin.hiscoresPollMinutes === 'number' && plugin.hiscoresPollMinutes > 0) {
    out.pollMinutes = plugin.hiscoresPollMinutes;
  }
  if (typeof plugin.hiscoresPostIntervalHours === 'number' && plugin.hiscoresPostIntervalHours > 0) {
    out.postIntervalMinutes = plugin.hiscoresPostIntervalHours * 60;
  }
  if (typeof plugin.hiscoresMajorRankChange === 'number' && plugin.hiscoresMajorRankChange > 0) {
    out.majorRankChange = plugin.hiscoresMajorRankChange;
  }
  return out;
}

function applyPluginOverridesToRaidSummaryCfg(cfg, plugin) {
  if (!cfg) return cfg; // nothing to merge into -- no webhook either way
  if (!plugin) return cfg;
  const out = Object.assign({}, cfg);
  out.enabled = plugin.raidSummaryEnabled !== false;
  if (typeof plugin.raidSummaryMinMembers === 'number' && plugin.raidSummaryMinMembers > 0) {
    out.minMembers = plugin.raidSummaryMinMembers;
  }
  return out;
}

// "08:00, 14:00 20:00" -> ["08:00","14:00","20:00"] (24 h local time; invalid entries dropped).
function parsePostTimes(v) {
  const out = [];
  String(v == null ? '' : v).split(/[\s,;]+/).forEach((t) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m && +m[1] < 24 && +m[2] < 60) { const s = String(+m[1]).padStart(2, '0') + ':' + m[2]; if (!out.includes(s)) out.push(s); }
  });
  return out.sort();
}
// Delay until the next digest: the interval timer AND any fixed clock times, whichever comes first.
function nextDigestDelay(cfg, intervalMs) {
  let best = intervalMs;
  const now = new Date();
  for (const t of (cfg && cfg.postTimes) || []) {
    const [h, m] = t.split(':').map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (at.getTime() <= now.getTime() + 30000) at.setDate(at.getDate() + 1);
    best = Math.min(best, at.getTime() - now.getTime());
  }
  return Math.max(30000, best);
}
function applyPluginOverridesToDigestCfg(cfg, plugin) {
  if (!cfg) return cfg; // nothing to merge into -- no webhook either way
  if (!plugin) return cfg;
  const out = Object.assign({}, cfg);
  out.enabled = plugin.digestEnabled !== false;
  if (typeof plugin.digestIntervalHours === 'number' && plugin.digestIntervalHours > 0) {
    out.intervalHours = plugin.digestIntervalHours;
  }
  if (typeof plugin.digestPostTimes === 'string') out.postTimes = parsePostTimes(plugin.digestPostTimes);
  return out;
}

// Pushes the REAL current config values into the page's displayed toggle
// state once per connection -- without this, a watcher restart would show
// whatever was last in that page's localStorage (or schema defaults)
// instead of what's actually configured, which could look like the
// toggle lied about current behavior.
// --- Performance sampling (CDP CPU profiler) ------------------------------------
// Short bursts of the V8 sampling profiler on the game page, aggregated by script: every plugin script carries a
// sourceURL (cc-plugin-<id>.js), so time spent in them -- including native calls they make (querySelector,
// elementsFromPoint, ...) -- is attributed to the plugin. Result goes to STATUS.perf for the in-game indicator
// and the dashboard. Bursts run every 60 s, or back-to-back while the indicator tooltip is open.
STATUS.perf = null;
async function perfBurst(call, ms, plugins) {
  const metricsOf = (r) => { const o = {}; (r && r.metrics || []).forEach((m) => { o[m.name] = m.value; }); return o; };
  await call('Profiler.enable', {});
  await call('Profiler.setSamplingInterval', { interval: 2000 });
  await call('Performance.enable', {});
  const m0 = metricsOf(await call('Performance.getMetrics', {}));
  const t0 = Date.now();
  await call('Profiler.start', {});
  await new Promise((r) => setTimeout(r, ms));
  const m1 = metricsOf(await call('Performance.getMetrics', {}));
  const stopped = await call('Profiler.stop', {}, 15000);
  const prof = stopped && stopped.profile;
  if (!prof) throw new Error('profiler returned no profile');
  const wall = Math.max(1, (prof.endTime - prof.startTime) / 1000);
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  prof.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
  const acc = { game: 0, browser: 0, gc: 0, idle: 0, other: 0 }, per = {};
  prof.samples.forEach((sid, i) => {
    const dt = (prof.timeDeltas[i] || 0) / 1000;
    let n = byId.get(sid), plug = null;
    for (let q = sid; q; q = parent.get(q)) {            // nearest scripted caller decides who gets the time
      const u = byId.get(q).callFrame.url || '';
      const m = u.match(/cc-plugin-([a-z0-9-]+)\.js/);
      if (m) { plug = m[1]; break; }
      if (/\/app\/game\./.test(u) || /play\.scapewatch\.com/.test(u)) break;
    }
    if (plug) { per[plug] = (per[plug] || 0) + dt; return; }
    const fn = n.callFrame.functionName;
    if (fn === '(idle)') acc.idle += dt;
    else if (fn === '(garbage collector)') acc.gc += dt;
    else if (fn === '(program)' || fn === '(root)') acc.browser += dt;
    else if (/\/app\/game\./.test(n.callFrame.url || '') || n.callFrame.url) acc.game += dt;
    else acc.game += dt; // native work called from game code
  });
  const pct = (v) => Math.round(v / wall * 1000) / 10;
  const labelOf = (id) => { const d = plugins.find((p) => p.id === id); return d ? d.label : id; };
  const list = Object.keys(per).map((id) => ({ id, label: labelOf(id), pct: pct(per[id]) })).sort((a, b) => b.pct - a.pct);
  const d = (k) => (m1[k] != null && m0[k] != null ? m1[k] - m0[k] : 0);
  const secs = Math.max(0.001, (t0 ? (Date.now() - t0) / 1000 : ms / 1000));
  return {
    at: Date.now(), windowMs: Math.round(wall),
    idlePct: pct(acc.idle), busyPct: Math.max(0, Math.round((100 - pct(acc.idle)) * 10) / 10),
    gamePct: pct(acc.game), browserPct: pct(acc.browser), gcPct: pct(acc.gc),
    scapelitePct: Math.round(list.reduce((a, p) => a + p.pct, 0) * 10) / 10,
    plugins: list,
    metrics: { scriptPct: Math.round(d('ScriptDuration') / secs * 1000) / 10, layoutPct: Math.round(d('LayoutDuration') / secs * 1000) / 10, stylePct: Math.round(d('RecalcStyleDuration') / secs * 1000) / 10 },
  };
}

// --- In-game log settings -> overlay/log-config.json (the supervisor's log store re-reads it every few seconds) ---
async function syncLogSettings(evalAwait) {
  let v = null;
  try { v = await evalAwait(`window.${PLUGINS_NS} ? ({ e: window.${PLUGINS_NS}.get('logsEnabled'), d: window.${PLUGINS_NS}.get('logsKeepDays') }) : null`, false); } catch (e) { return; }
  if (!v) return;
  const cur = logstore.config();
  const enabled = v.e !== false, days = Number(v.d);
  if (enabled === cur.enabled && (!Number.isFinite(days) || days === cur.keepDays)) return;
  try { const n = logstore.saveConfig({ enabled, keepDays: Number.isFinite(days) ? days : undefined }); log('Log settings: ' + (n.enabled ? 'saving logs, keeping ' + n.keepDays + ' day(s)' : 'saving logs is OFF')); logstore.prune(true); } catch (e) { log('ERROR: could not save log settings --', e.message); }
}

// --- In-game "About" buttons -> updater (the dashboard server owns the update logic) ---------------------
async function handleUpdateRequest(evalAwait) {
  let req = null;
  try { req = await evalAwait('(() => { const r = window.__ccUpdateReq || null; window.__ccUpdateReq = null; return r; })()', false); } catch (e) { return; }
  if (req !== 'check' && req !== 'apply') return;
  try {
    const r = await fetch('http://127.0.0.1:' + STATUS_SERVER_PORT + '/api/update/' + req, { method: 'POST', headers: { 'x-cc-control': '1', 'content-type': 'application/json' }, body: '{}' });
    log('Update ' + req + ' requested from the game: HTTP ' + r.status);
  } catch (e) { log('Update ' + req + ' request failed --', e.message); }
}

// --- Secrets (webhook URLs) edited in the in-game Plugins tab -----------------
// The page keeps them in memory only; this side owns the config files. Edits are
// collected with takeSecrets() and written atomically into the matching JSON
// config (created from its *.example.json when missing). Values are never logged.
const SECRET_FIELDS = {
  relayClanWebhook: { file: CHAT_RELAY_CONFIG_PATH, example: 'chat-relay-config.example.json', at: ['channels', 'clan', 'webhookUrl'], label: 'Clan relay webhook' },
  relayGlobalWebhook: { file: CHAT_RELAY_CONFIG_PATH, example: 'chat-relay-config.example.json', at: ['channels', 'global', 'webhookUrl'], label: 'Global relay webhook' },
  hiscoresWebhook: { file: CLAN_HISCORES_CONFIG_PATH, example: 'clan-hiscores-config.example.json', at: ['webhookUrl'], label: 'Clan hiscores webhook' },
  raidSummaryWebhook: { file: RAID_SUMMARY_CONFIG_PATH, example: 'raid-summary-config.example.json', at: ['webhookUrl'], label: 'Raid summary webhook' },
  digestWebhook: { file: DIGEST_CONFIG_PATH, example: 'digest-config.example.json', at: ['webhookUrl'], label: 'Activity digest webhook' },
};
const isPlaceholderUrl = (v) => !v || /X{6,}|Y{6,}/.test(v);
function readSecretValue(def) {
  try {
    let o = JSON.parse(fs.readFileSync(def.file, 'utf8'));
    for (const k of def.at) o = o && o[k];
    return typeof o === 'string' && !isPlaceholderUrl(o) ? o : '';
  } catch (e) { return ''; }
}
function writeSecretValue(def, value) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(def.file, 'utf8')); }
  catch (e) { try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, def.example), 'utf8')); } catch (e2) { cfg = {}; } }
  let o = cfg;
  def.at.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[def.at[def.at.length - 1]] = value;
  const tmp = def.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, def.file);
}
function currentSecrets() {
  const out = {};
  for (const k of Object.keys(SECRET_FIELDS)) out[k] = readSecretValue(SECRET_FIELDS[k]);
  return out;
}
async function collectSecrets(evalAwait) {
  let got = null;
  try { got = await evalAwait(`window.${PLUGINS_NS} && window.${PLUGINS_NS}.takeSecrets ? window.${PLUGINS_NS}.takeSecrets() : null`, false); } catch (e) { return; }
  if (!got || typeof got !== 'object') return;
  for (const [k, v] of Object.entries(got)) {
    const def = SECRET_FIELDS[k];
    if (!def || typeof v !== 'string') continue;
    if (v && !/^https:\/\/(discord(app)?\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\//.test(v)) { log('Ignored ' + def.label + ': not a Discord webhook URL.'); continue; }
    try { writeSecretValue(def, v); log('Saved ' + def.label + (v ? '' : ' (cleared)') + ' from the Plugins tab.'); } catch (e) { log('ERROR: could not save ' + def.label + ' --', e.message); }
  }
}

async function seedPluginSettings(evalAwait) {
  const chatCfg = loadChatRelayConfig();
  const hiscoresCfg = loadClanHiscoresConfig();
  const raidSummaryCfg = loadRaidSummaryConfig();
  const digestCfg = loadDigestConfig();
  const seed = {
    clanRelayEnabled: !!(chatCfg && chatCfg.channels && chatCfg.channels.clan && chatCfg.channels.clan.enabled),
    globalRelayEnabled: !!(chatCfg && chatCfg.channels && chatCfg.channels.global && chatCfg.channels.global.enabled),
    relayPlainChat: !!(chatCfg && chatCfg.channels && chatCfg.channels.clan && chatCfg.channels.clan.relayPlainChat),
    pingRoles: derivePingRoles(chatCfg),
    pingRareDrops: !chatCfg || chatCfg.pingRareDrops !== false,
    pingUnlocks: !chatCfg || chatCfg.pingUnlocks !== false,
    pingLevelUps: !!(chatCfg && chatCfg.pingLevelUps),
    pingPets: !chatCfg || chatCfg.pingPets !== false,
    pingQuests: !!(chatCfg && chatCfg.pingQuests),
    hiscoresEnabled: !!(hiscoresCfg && hiscoresCfg.enabled),
    hiscoresPollMinutes: (hiscoresCfg && hiscoresCfg.pollMinutes) || 20,
    hiscoresPostIntervalHours: ((hiscoresCfg && hiscoresCfg.postIntervalMinutes) || 360) / 60,
    hiscoresMajorRankChange: (hiscoresCfg && hiscoresCfg.majorRankChange) || 3,
    raidSummaryEnabled: !!(raidSummaryCfg && raidSummaryCfg.enabled),
    raidSummaryMinMembers: (raidSummaryCfg && raidSummaryCfg.minMembers) || 2,
    digestEnabled: !!(digestCfg && digestCfg.enabled),
    digestIntervalHours: (digestCfg && digestCfg.intervalHours) || 6,
    digestPostTimes: ((digestCfg && digestCfg.postTimes) || []).join(', '),
    logsEnabled: logstore.config().enabled,
    logsKeepDays: logstore.config().keepDays,
  };
  try {
    await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.seed(${JSON.stringify(seed)}) : null`, false);
    await evalAwait(`window.${PLUGINS_NS} && window.${PLUGINS_NS}.seedSecrets ? window.${PLUGINS_NS}.seedSecrets(${JSON.stringify(currentSecrets())}) : null`, false);
    log('Plugins settings UI: seeded from current config.');
  } catch (e) {
    // Settings panel script may not have finished loading yet, or the
    // player has never opened Settings this session (window.__ccPluginSettings
    // still exists either way -- it builds its API before building any DOM --
    // so this is unlikely, but harmless to skip if it happens).
  }
}

// --- CDP connection -----------------------------------------------------

function connectAndWatch(target) {
  return new Promise((resolve) => {
    let id = 0;
    const send = (method, params) => {
      id += 1;
      ws.send(JSON.stringify({ id, method, params }));
      return id;
    };

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let chatRelayTimer = null;
    let clanHiscoresTimer = null;
    let raidSummaryTimer = null;
    let digestTimer = null;
    const pendingDrains = new Map(); // request id -> cfg, so the message handler knows it's a drain reply
    const pendingEvals = new Map(); // request id -> {resolve, reject}, for general awaited evaluations
    const pendingCalls = new Map(); // request id -> resolve(result), for awaited raw CDP calls
    // Awaited raw CDP call (e.g. Page.addScriptToEvaluateOnNewDocument, whose
    // result is {identifier}); resolves null on a CDP error.
    function call(method, params, timeoutMs) {
      return new Promise((resolve) => {
        const reqId = send(method, params);
        pendingCalls.set(reqId, resolve);
        setTimeout(() => { if (pendingCalls.delete(reqId)) resolve(null); }, timeoutMs || 10000);
      });
    }

    // --- Game bridge ---------------------------------------------------------
    // The game's own state (G) and Dashboard (D) objects are bundle-scoped, so
    // they are found through CDP Runtime.queryObjects and handed to
    // overlay/game-bridge.js, which installs window.__ccBridge -- a READ-ONLY
    // view of the dashboard's per-task duration / XP projections (used by the
    // Route Advisor's XP/hr, tasks/hr and quest objectives). Re-attached
    // whenever the page loses it (game reload). Toggle: Plugins > Game Data Bridge.
    let bridgeTimer = null, bridgeKick = null, bridgeBusy = false;
    async function ensureGameBridge() {
      if (bridgeBusy) return;
      bridgeBusy = true;
      try {
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        if (plugin && plugin.gameBridgeEnabled === false) { STATUS.bridge.ok = false; return; }
        const have = await evalAwait('!!(window.__ccBridge && window.__ccBridge.ok && window.__ccBridge.ok())', false).catch(() => false);
        if (have) { STATUS.bridge.ok = true; return; }
        const t0 = Date.now();
        await call('Runtime.enable', {});
        const proto = await call('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: 'ccbridge' });
        const protoId = proto && proto.result && proto.result.objectId;
        if (!protoId) { STATUS.bridge.error = 'no Object.prototype handle'; return; }
        const qo = await call('Runtime.queryObjects', { prototypeObjectId: protoId, objectGroup: 'ccbridge' }, 30000);
        const arrId = qo && qo.objects && qo.objects.objectId;
        if (!arrId) { STATUS.bridge.error = 'queryObjects failed'; return; }
        let src;
        try { src = fs.readFileSync(GAME_BRIDGE_PATH, 'utf8'); } catch (e) { STATUS.bridge.error = 'cannot read game-bridge.js'; return; }
        const r = await call('Runtime.callFunctionOn', {
          objectId: arrId,
          functionDeclaration: 'function(){var G=null,D=null,Y=null,C=null,E=null;for(var i=0;i<this.length&&!(G&&D&&Y&&C&&E);i++){var x=this[i];try{if(!E&&x&&typeof x.onMobDeath==="function"&&Array.isArray(x._mobs)&&"_playerUnit" in x)E=x;if(!C&&x&&typeof x._soloFilter==="function"&&x.SEND_CHANNELS)C=x;if(!G&&x&&typeof x._estimateActionDuration==="function"&&x.skills)G=x;else if(!D&&x&&typeof x._projectOpt==="function")D=x;else if(!Y&&x&&typeof x.actionDurationFinal==="function"&&x.MIN_ACTION_DURATION)Y=x}catch(e){}}if(!G||!D)return false;(' + src + ')(G,D,Y,C,E);return true}',
          returnByValue: true,
        }, 30000);
        await call('Runtime.releaseObjectGroup', { objectGroup: 'ccbridge' });
        const ok = !!(r && r.result && r.result.value === true);
        STATUS.bridge = { ok, attachedAt: ok ? Date.now() : STATUS.bridge.attachedAt, ms: Date.now() - t0, error: ok ? null : 'game state objects not found yet' };
        if (ok) log(`Game bridge: attached (game state found in ${Date.now() - t0} ms)`);
      } catch (e) {
        STATUS.bridge.error = String(e && e.message || e);
      } finally { bridgeBusy = false; }
    }
    function startBridgeWatch() {
      stopBridgeWatch();
      bridgeKick = setTimeout(() => ensureGameBridge().catch(() => {}), 6000);
      bridgeTimer = setInterval(() => ensureGameBridge().catch(() => {}), 10000);
    }
    function stopBridgeWatch() {
      if (bridgeKick) { clearTimeout(bridgeKick); bridgeKick = null; }
      if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; }
      STATUS.bridge.ok = false;
    }

    // General-purpose awaited page evaluation, used by the clan-hiscores
    // poller to drive window.__ccGameSocket.request(...) (an async,
    // promise-returning page-side call) from here and get the result back.
    function evalAwait(expression, awaitPromise) {
      return new Promise((resolve, reject) => {
        const reqId = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise });
        pendingEvals.set(reqId, { resolve, reject });
      });
    }

    let secretsTimer = null, perfTimer = null, perfBusy = false, perfLast = 0; let perfWarned = false;
    // Re-inject any enabled plugin whose page global is missing (cheap: one probe per plugin).
    let reinjectTimer = null, reinjectBusy = false;
    function scheduleReinject(delay) {
      clearTimeout(reinjectTimer);
      reinjectTimer = setTimeout(reinjectMissing, delay);
    }
    async function reinjectMissing() {
      if (reinjectBusy || !activeConn) return;
      reinjectBusy = true;
      try {
        const missing = [];
        for (const def of PLUGIN_DEFS) {
          if (!pluginEnabled(def) || !def.ns) continue;
          const there = await evalAwait(`typeof window.${def.ns} !== 'undefined'`, false).catch(() => true);
          if (!there) missing.push(def);
        }
        if (missing.length) {
          log('Page reloaded: re-injecting ' + missing.length + ' plugin(s) -- ' + missing.map((d) => d.id).join(', '));
          for (const def of missing) { try { await evalAwait(withSourceUrl(def), false); } catch (e) { log('ERROR: re-inject ' + def.id + ' failed --', e.message); } }
          seedPluginSettings(evalAwait);
          // The bridge needs the new page's game objects too.
          try { await evalAwait('delete window.__ccBridge; 1', false); } catch (e) { /* ignore */ }
        }
      } finally { reinjectBusy = false; }
    }
    // Safety net: every 20 s make sure nothing silently went missing (tab reload we did not hear about, plugin crash).
    let reinjectSweep = setInterval(() => { scheduleReinject(10); }, 20000);

    function stopChatRelayPolling() {
      clearInterval(reinjectSweep); clearTimeout(reinjectTimer);
      if (perfTimer) { clearInterval(perfTimer); perfTimer = null; }
      if (secretsTimer) { clearInterval(secretsTimer); secretsTimer = null; }
      if (chatRelayTimer) { clearInterval(chatRelayTimer); chatRelayTimer = null; }
    }

    // Catch-up safety net, run on every (re)connect: the page collector can miss
    // events (page reload while the watcher was down, a hard kill ...). The
    // game's recent chat history is still in the DOM, so compare it with what was
    // actually relayed and send ONLY events that came after the last relayed one
    // (older unrelayed ones were filtered/skipped on purpose and are never
    // dumped). Duplicates are impossible: relayedKeys + the outbox are checked.
    async function catchUpRelay() {
      const cfg = loadChatRelayConfig();
      if (!cfg || !cfg.channels || relayedKeys.size === 0) return;
      const raw = await evalAwait("window.__ccChatRelay && window.__ccChatRelay.rescan ? JSON.stringify(window.__ccChatRelay.rescan()) : '[]'", false).catch(() => '[]');
      let events = [];
      try { events = JSON.parse(raw || '[]'); } catch (e) { events = []; }
      if (!Array.isArray(events) || !events.length) return;
      let last = -1;
      events.forEach((e, i) => { if (isRelayed(e)) last = i; });
      const queued = new Set(outbox.map(relayKey));
      const missed = events.slice(last + 1).filter((e) => !isRelayed(e) && !queued.has(relayKey(e)));
      if (!missed.length) return;
      log(`Relay catch-up: ${missed.length} event(s) from the game's chat history were never relayed -- sending now`);
      const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
      const eff = applyPluginOverridesToChatCfg(cfg, plugin);
      const stamped = missed.map((e, i) => Object.assign({ id: 'catchup-' + Date.now() + '-' + i, queuedAt: Date.now() }, e));
      accumulateForDigest(stamped);
      await relayEvents(stamped, eff);
    }

    function startChatRelayPolling() {
      stopChatRelayPolling();
      chatRelayTimer = setInterval(async () => {
        const cfg = loadChatRelayConfig(); // re-read each tick so config edits take effect live
        if (!cfg || !cfg.channels) return;
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const effectiveCfg = applyPluginOverridesToChatCfg(cfg, plugin);
        processOutbox(effectiveCfg).catch(() => {}); // retry / recover anything still pending first
        const drainId = send('Runtime.evaluate', {
          expression: `window.__ccChatRelay ? JSON.stringify(window.__ccChatRelay.drain()) : '[]'`,
          returnByValue: true,
        });
        pendingDrains.set(drainId, effectiveCfg);
      }, CHAT_RELAY_POLL_MS);
    }

    function stopClanHiscoresPolling() {
      if (clanHiscoresTimer) { clearTimeout(clanHiscoresTimer); clanHiscoresTimer = null; }
      STATUS.clanHiscores.nextPollAt = null;
    }

    function scheduleClanHiscoresPoll(delayMs) {
      stopClanHiscoresPolling();
      STATUS.clanHiscores.nextPollAt = Date.now() + delayMs;
      clanHiscoresTimer = setTimeout(async () => {
        const rawCfg = loadClanHiscoresConfig();
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const cfg = applyPluginOverridesToHiscoresCfg(rawCfg, plugin);
        if (cfg && cfg.enabled && cfg.webhookUrl && Array.isArray(cfg.members) && cfg.members.length) {
          try {
            await pollClanHiscores(evalAwait, cfg);
          } catch (e) {
            log('Clan hiscores: poll error --', e.message || String(e));
          }
        }
        const intervalMs = Math.max(5, (cfg && cfg.pollMinutes) || 20) * 60 * 1000;
        scheduleClanHiscoresPoll(intervalMs);
      }, delayMs);
    }

    function stopRaidSummaryPolling() {
      if (raidSummaryTimer) { clearInterval(raidSummaryTimer); raidSummaryTimer = null; }
    }

    function startRaidSummaryPolling() {
      stopRaidSummaryPolling();
      raidSummaryTimer = setInterval(async () => {
        const rawCfg = loadRaidSummaryConfig();
        if (!rawCfg || !rawCfg.enabled || !rawCfg.webhookUrl) return;
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const cfg = applyPluginOverridesToRaidSummaryCfg(rawCfg, plugin);
        if (!cfg || !cfg.enabled || !cfg.webhookUrl) return;
        let entries;
        try {
          entries = await evalAwait(
            `window.__ccGameSocket && window.__ccGameSocket.drainRaidSummaries ? window.__ccGameSocket.drainRaidSummaries() : []`,
            false
          );
        } catch (e) {
          return; // ws-hook not active yet (needs a game reload) -- same as clan hiscores, just skip this tick
        }
        if (!Array.isArray(entries) || !entries.length) return;
        const minMembers = cfg.minMembers != null ? cfg.minMembers : 2;
        for (const entry of entries) {
          if ((entry.memberCount || 0) < minMembers) {
            log(`Raid summary: skipping solo/small run (${entry.memberCount} member(s), need ${minMembers}) --`, entry.raidName);
            STATUS.raidSummary.totalSkippedSolo += 1;
            continue;
          }
          log('  -> raid summary:', entry.raidName, `(${entry.memberCount} members)`);
          await postToDiscord(cfg.webhookUrl, buildRaidSummaryPayload(entry));
          STATUS.raidSummary.lastPostAt = Date.now();
          STATUS.raidSummary.totalPosted += 1;
          await new Promise((r) => setTimeout(r, DISCORD_POST_SPACING_MS));
        }
      }, RAID_SUMMARY_POLL_MS);
    }

    function stopDigestPosting() {
      if (digestTimer) { clearTimeout(digestTimer); digestTimer = null; }
      STATUS.digest.nextPostAt = null;
    }

    // The fixed digest times are typed into the in-game Plugins tab but must outlive restarts (the page is re-seeded
    // from the config file), so a change is written into digest-config.json and the next post is re-planned.
    async function syncDigestTimes() {
      let v = null;
      try { v = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.get('digestPostTimes') : null`, false); } catch (e) { return; }
      if (typeof v !== 'string') return;
      const cfg = loadDigestConfig();
      if (!cfg) return;
      const times = parsePostTimes(v);
      if ((cfg.postTimes || []).join(',') === times.join(',')) return;
      cfg.postTimes = times;
      try {
        const tmp = DIGEST_CONFIG_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
        fs.renameSync(tmp, DIGEST_CONFIG_PATH);
        log('Activity digest: fixed post times now ' + (times.length ? times.join(', ') : 'none') + '.');
        const intervalMs = Math.max(1, cfg.intervalHours || 6) * 3600000;
        const left = Math.max(30000, intervalMs - (Date.now() - digestBuffer.sinceAt));
        scheduleDigestPost(nextDigestDelay(cfg, left));
      } catch (e) { log('ERROR: could not save digest post times --', e.message); }
    }

    function scheduleDigestPost(delayMs) {
      stopDigestPosting();
      STATUS.digest.nextPostAt = Date.now() + delayMs;
      digestTimer = setTimeout(async () => {
        const rawCfg = loadDigestConfig();
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const cfg = applyPluginOverridesToDigestCfg(rawCfg, plugin);
        if (cfg && cfg.enabled && cfg.webhookUrl) {
          const payload = buildDigestPayload(digestBuffer);
          if (payload) {
            await postToDiscord(cfg.webhookUrl, payload);
            STATUS.digest.lastPostAt = Date.now();
            STATUS.digest.totalPosted += 1;
            log('  -> activity digest posted,', Object.keys(digestBuffer.players).length, 'player(s) with activity');
            // Reset the reporting window (sinceAt/players) but deliberately
            // KEEP seenKeys/digestSeenKeys across the flush -- that dedup
            // guards against restart+DOM-rebuild re-drains independent of
            // the reporting period, so wiping it here would reopen the
            // exact duplicate-counting window it exists to close (a
            // message seen just before this post, then re-drained just
            // after, would otherwise look "new" again for the next period).
            digestBuffer = { sinceAt: Date.now(), players: {}, seenKeys: digestBuffer.seenKeys };
            saveDigestBuffer(digestBuffer);
          } else {
            log('Activity digest: nothing notable since last digest -- skipped.');
          }
        }
        const intervalMs = Math.max(1, (cfg && cfg.intervalHours) || 6) * 3600000;
        scheduleDigestPost(nextDigestDelay(cfg, intervalMs));
      }, delayMs);
    }

    ws.addEventListener('open', () => {
      log('Connected to', target.url, '-- injecting mods');
      STATUS.cdp.connected = true;
      STATUS.cdp.since = Date.now();
      const toInject = [];
      try {
        for (const def of PLUGIN_DEFS) {
          if (!pluginEnabled(def)) { log('Plugin disabled (skipped):', def.id); continue; }
          toInject.push({ def, code: withSourceUrl(def) });
        }
      } catch (e) {
        log('ERROR: could not read mod script --', e.message);
        try { ws.close(); } catch (_) {}
        return;
      }
      activeConn = { call, evalAwait, registered: {}, loaded: new Set(toInject.map((x) => x.def.id)) };
      // Used by gracefulShutdown: drain the page's queued chat events right now
      // (also feeding the digest), then post everything pending.
      activeConn.flushRelay = async () => {
        const cfg = loadChatRelayConfig();
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const eff = cfg && cfg.channels ? applyPluginOverridesToChatCfg(cfg, plugin) : null;
        const raw = await evalAwait("window.__ccChatRelay ? JSON.stringify(window.__ccChatRelay.drain()) : '[]'", false).catch(() => '[]');
        let events = [];
        try { events = JSON.parse(raw || '[]'); } catch (e) { events = []; }
        if (Array.isArray(events) && events.length) { accumulateForDigest(events); outbox.push(...events); saveOutbox(); }
        if (eff) await processOutbox(eff);
      };
      refreshPluginStatus();
      for (const x of toInject) send('Runtime.evaluate', { expression: x.code, returnByValue: true });
      send('Page.enable', {});
      // ws-hook MUST be registered for next-document execution to ever
      // actually intercept the game's WebSocket -- the immediate
      // Runtime.evaluate above only helps if the watcher connected before
      // the game's own script ran (rare), and otherwise just no-ops until
      // the next reload picks up this registration instead. The returned
      // identifiers let the dashboard drop a registration when a mod is
      // switched off.
      const conn = activeConn;
      (async () => {
        for (const x of toInject) {
          const r = await call('Page.addScriptToEvaluateOnNewDocument', { source: x.code }).catch(() => null);
          if (r && r.identifier) conn.registered[x.def.id] = r.identifier;
        }
      })();
      startChatRelayPolling();
      setTimeout(() => { catchUpRelay().catch((e) => log('Relay catch-up error --', e.message || String(e))); }, 10000);
      startBridgeWatch();
      scheduleClanHiscoresPoll(CLAN_HISCORES_INITIAL_DELAY_MS);
      startRaidSummaryPolling();
      // Resume the digest schedule relative to when the buffer actually
      // started accumulating, not a fresh full interval on every watcher
      // restart -- if 5 of 6 configured hours already elapsed before this
      // restart, the next post should be in ~1h, not another 6h. Overdue
      // (elapsed past the interval already) posts soon rather than
      // instantly, same "let the connection settle first" reasoning as
      // the clan-hiscores initial delay.
      {
        const digestCfg = loadDigestConfig();
        const digestIntervalMs = Math.max(1, (digestCfg && digestCfg.intervalHours) || 6) * 3600000;
        const digestElapsed = Date.now() - digestBuffer.sinceAt;
        scheduleDigestPost(Math.min(Math.max(CLAN_HISCORES_INITIAL_DELAY_MS, digestIntervalMs - digestElapsed), nextDigestDelay(applyPluginOverridesToDigestCfg(digestCfg, null) || digestCfg, Infinity)));
      }
      seedPluginSettings(evalAwait);
      if (secretsTimer) clearInterval(secretsTimer);
      secretsTimer = setInterval(() => { collectSecrets(evalAwait); syncDigestTimes(); handleUpdateRequest(evalAwait); syncLogSettings(evalAwait); }, 3000);
      if (perfTimer) clearInterval(perfTimer);
      perfTimer = setInterval(async () => {
        if (perfBusy) return;
        let want = false;
        try { want = !!(await evalAwait('!!(window.__ccStatusIndicator && window.__ccStatusIndicator.wantPerf && window.__ccStatusIndicator.wantPerf())', false)); } catch (e) { /* page busy */ }
        if (Date.now() - perfLast < (want ? 4000 : 60000)) return;
        perfBusy = true;
        try { const r = await perfBurst(call, 3000, STATUS.plugins || []); if (r) STATUS.perf = r; } catch (e) { if (!perfWarned) { perfWarned = true; log('Performance sampling failed:', e.message); } }
        finally { perfLast = Date.now(); perfBusy = false; }
      }, 4000);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data.toString()); } catch (err) { return; }

      // The page (re)loaded -- e.g. the game navigates after login, or after a crash/reboot the watcher connected while the
      // title screen was still loading. Scripts registered for "next document" run at document-start, where most plugins
      // cannot work yet (no <head>/<body>), so re-inject whatever is missing once the document is ready.
      if (msg.method === 'Page.domContentEventFired' || msg.method === 'Page.loadEventFired') { scheduleReinject(msg.method === 'Page.loadEventFired' ? 600 : 1500); return; }

      if (pendingCalls.has(msg.id)) {
        const resolveCall = pendingCalls.get(msg.id);
        pendingCalls.delete(msg.id);
        resolveCall(msg.error ? null : msg.result);
        return;
      }

      if (pendingEvals.has(msg.id)) {
        const { resolve, reject } = pendingEvals.get(msg.id);
        pendingEvals.delete(msg.id);
        if (msg.error) { reject(new Error(JSON.stringify(msg.error))); return; }
        if (msg.result && msg.result.exceptionDetails) {
          reject(new Error((msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description) || msg.result.exceptionDetails.text || 'page exception'));
          return;
        }
        resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
        return;
      }

      if (pendingDrains.has(msg.id)) {
        const cfg = pendingDrains.get(msg.id);
        pendingDrains.delete(msg.id);
        const value = msg.result && msg.result.result && msg.result.result.value;
        if (!value) return;
        let events;
        try { events = JSON.parse(value); } catch (err) { return; }
        if (Array.isArray(events) && events.length) {
          relayEvents(events, cfg);
          // Independent of relayEvents' own per-channel enabled gate --
          // the digest should keep accumulating even if live Discord
          // pings are turned off entirely, see "Activity digest" above.
          accumulateForDigest(events);
        }
        return;
      }

      if (msg.result && msg.result.result && 'value' in msg.result.result) {
        log('  ->', msg.result.result.value);
      } else if (msg.error) {
        log('  -> CDP error:', JSON.stringify(msg.error));
      }
    });

    ws.addEventListener('close', () => {
      activeConn = null; refreshPluginStatus(); stopBridgeWatch();
      stopChatRelayPolling();
      stopClanHiscoresPolling();
      stopRaidSummaryPolling();
      stopDigestPosting();
      STATUS.cdp.connected = false;
      STATUS.cdp.since = Date.now();
      STATUS.clanHiscores.wsHookReady = false;
      log('Debugger connection closed (game closed) -- waiting for it to reopen');
      resolve();
    });
    ws.addEventListener('error', (e) => {
      activeConn = null; refreshPluginStatus(); stopBridgeWatch();
      stopChatRelayPolling();
      stopClanHiscoresPolling();
      stopRaidSummaryPolling();
      stopDigestPosting();
      STATUS.cdp.connected = false;
      STATUS.cdp.since = Date.now();
      STATUS.clanHiscores.wsHookReady = false;
      log('WebSocket error:', e.message || String(e));
      try { ws.close(); } catch (_) {}
      resolve();
    });
  });
}

async function main() {
  log('Scapewatch panel-resize watcher started. Waiting for the game on CDP port', String(CDP_PORT), '...');
  refreshPluginStatus();
  if (SUPERVISED) {
    // The supervisor hosts the dashboard; push it our state and take its commands.
    setInterval(() => { try { process.send({ type: 'status', status: Object.assign({}, STATUS, { recentLog: undefined }) }); } catch (e) {} }, 1000);
    process.on('message', async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'shutdown') { gracefulShutdown('stop requested'); return; }
      if (m.type === 'plugin') {
        const r = await setPluginEnabled(m.id, !!m.enabled).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
        try { process.send({ type: 'reply', reqId: m.reqId, result: r }); } catch (e) {}
      }
    });
    process.on('disconnect', () => process.exit(0)); // supervisor died -- don't linger as an orphan
    log('Running under the supervisor (dashboard + Stop/Start/Restart are served by it).');
  } else {
    startStatusServer(STATUS_SERVER_PORT, () => STATUS, { plugin: setPluginEnabled });
    log(`Status dashboard: http://${STATUS_SERVER_FRIENDLY_HOST}/ (or http://localhost:${STATUS_SERVER_PORT}/ if port 80 wasn't free)`);
  }
  loadRelayedKeys();
  log(`Chat relay: loaded ${relayedKeys.size} previously-relayed message key(s) from disk.`);
  loadPlayerIconCache();
  log(`Chat relay: loaded ${Object.keys(playerIconCache).length} cached player avatar(s) from disk.`);
  if (!loadChatRelayConfig()) {
    log('Chat relay: no overlay/chat-relay-config.json found -- relay disabled, panel mod still active.');
  }
  const hiscoresCfg = loadClanHiscoresConfig();
  if (!hiscoresCfg || !hiscoresCfg.enabled) {
    log('Clan hiscores: not configured or disabled -- see overlay/clan-hiscores-config.example.json.');
  }
  const raidSummaryCfg = loadRaidSummaryConfig();
  if (!raidSummaryCfg || !raidSummaryCfg.enabled) {
    log('Raid summary: not configured or disabled -- see overlay/raid-summary-config.example.json.');
  }
  digestBuffer = loadDigestBuffer();
  syncDigestSeenKeys(); // digestBuffer was just replaced wholesale -- re-sync the in-memory dedup Set to match
  log(`Activity digest: resumed buffer with ${Object.keys(digestBuffer.players).length} player(s) of accumulated activity (since ${new Date(digestBuffer.sinceAt).toISOString()}), ${digestSeenKeys.size} seen-message key(s).`);
  const digestCfg = loadDigestConfig();
  if (!digestCfg || !digestCfg.enabled) {
    log('Activity digest: not configured or disabled -- see overlay/digest-config.example.json.');
  }
  for (;;) {
    const target = await findPage();
    if (target) {
      await connectAndWatch(target);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
