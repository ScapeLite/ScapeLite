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
//   --remote-debugging-port=9222 --remote-allow-origins=http://localhost:9222,http://127.0.0.1:9222
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
const { getSender, chunkBlocks, deliverChunks } = require('./discord-sender');
const { createCommandHost, createHandlers } = require('./chat-commands-watcher');
const { writeJsonAtomic, readJsonRecover } = require('./safe-json');
const { createStore: createOptionLogStore } = require('./option-log-store');   // State/option-log.json: the task options the game offered (overlay/option-log.js)
const { createBoard } = require('./clan-board-sync');
const RelayEvents = require('./relay-events');                           // raw game chat line -> typed event (the one place wording is parsed)
const { createRelay, leaseGate } = require('./relay-core');              // outbox + gate + posting
const { createTeamHost } = require('./team-sync-host');   // Team settings sync through the lease webhook (docs/DISCORD-TEAM-SYNC.md)
const { createLeaseManager, newInstanceId } = require('./relay-lease');
const { hashOf: rosterHash } = require('./clan-board-roster');  // one relay leader on the clan's optional private lease webhook (duplicate-instance protection)
const legacyLeaseCleanup = require('./relay-legacy-cleanup');            // removes the visible lease message + webhook-name suffix the first lease version left behind
// One watcher only (whoever started it: the supervisor, a shortcut, a terminal): a second one would double every Discord post and fight over the game connection.
// A watcher that is being restarted may need a few seconds to let go, so the new one waits for it.
{ const lock = require('./single-instance').acquire('watcher', { waitMs: 25000 });
  if (!lock.ok) { console.log('[watcher] another watcher is already running (pid ' + lock.owner + '): this copy exits.'); process.exit(0); } }

const PANEL_SCRIPT_PATH = path.join(__dirname, 'panel-resize.js');
const CHAT_RELAY_SCRIPT_PATH = path.join(__dirname, 'chat-relay-collect.js');
const CHAT_RELAY_CONFIG_PATH = P.state('chat-relay-config.json');
// Runtime state lives in State/ (moved there once, with a .moved safety copy left behind; see paths.js). Notes are logged when the logger exists.
const STATE_MOVE = P.migrateRuntime(['chat-relay-seen.json', 'digest-state.json', 'clan-hiscores-state.json']);
const RELAYED_STATE_PATH = STATE_MOVE.paths['chat-relay-seen.json'];
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
const PRESETS_SCRIPT_PATH = path.join(__dirname, 'presets.js');
const MENU_DOCK_SCRIPT_PATH = path.join(__dirname, 'menu-dock.js');
const MODAL_RESIZE_SCRIPT_PATH = path.join(__dirname, 'modal-resize.js');
const NOTIF_DOCK_SCRIPT_PATH = path.join(__dirname, 'notif-dock.js');
const BANK_TOOLS_SCRIPT_PATH = path.join(__dirname, 'bank-tools.js');
const WIN_DOCK_SCRIPT_PATH = path.join(__dirname, 'window-dock.js');
const CHAT_DEFAULT_SCRIPT_PATH = path.join(__dirname, 'chat-default.js');
const MECHANICS_SCRIPT_PATH = path.join(__dirname, 'mechanics-explainer.js');
const MATSHORT_SCRIPT_PATH = path.join(__dirname, 'material-shortage.js');
const SLMENU_SCRIPT_PATH = path.join(__dirname, 'scapelite-menu.js');
const UISCALE_SCRIPT_PATH = path.join(__dirname, 'ui-scale.js');
const DROPLUCK_SCRIPT_PATH = path.join(__dirname, 'drop-luck.js');
const GOALS_SCRIPT_PATH = path.join(__dirname, 'goals.js');
const DIARYCORE_SCRIPT_PATH = path.join(__dirname, 'diary-credits-core.js');
const DIARYCREDITS_SCRIPT_PATH = path.join(__dirname, 'diary-credits.js');
const DISCORD_SETUP_SCRIPT_PATH = path.join(__dirname, 'discord-setup.js');
const ADVISORCORE_SCRIPT_PATH = path.join(__dirname, 'advisor-core.js');
const ADVISOR_SCRIPT_PATH = path.join(__dirname, 'advisor.js');
const QWALK_SCRIPT_PATH = path.join(__dirname, 'queue-walk.js');
const RDPS_SCRIPT_PATH = path.join(__dirname, 'raid-dps-extra.js');
const UIKIT_SCRIPT_PATH = path.join(__dirname, 'ui-kit.js');
const LIFECYCLE_SCRIPT_PATH = path.join(__dirname, 'lifecycle.js');
const DOMSCOPE_SCRIPT_PATH = path.join(__dirname, 'dom-scope.js');
const LOGCLIENT_SCRIPT_PATH = path.join(__dirname, 'log-client.js');
const ANCHOR_SCRIPT_PATH = path.join(__dirname, 'anchor.js');
const HP_PANEL_SCRIPT_PATH = path.join(__dirname, 'hp-panel.js');
const FORTRESS_SCRIPT_PATH = path.join(__dirname, 'fortress-tracker.js');
const CARDFUSE_SCRIPT_PATH = path.join(__dirname, 'card-fuse.js');
const UILAYOUT_SCRIPT_PATH = path.join(__dirname, 'ui-layout.js');
const DEFAULT_LAYOUT_SCRIPT_PATH = path.join(__dirname, 'default-layout.js');
const CARDSYNC_SCRIPT_PATH = path.join(__dirname, 'card-sync.js');
const UIBAR_SCRIPT_PATH = path.join(__dirname, 'ui-bar.js');
const CARDS_DIR = path.join(__dirname, 'cards');
const CHATPLUS_SCRIPT_PATH = path.join(__dirname, 'chat-plus.js');
const CHATCMD_SCRIPT_PATH = path.join(__dirname, 'chat-commands.js');
const UIQUEUE_SCRIPT_PATH = path.join(__dirname, 'ui-queue.js');
const ALERTS_SCRIPT_PATH = path.join(__dirname, 'alert-bell.js');
const TREECORE_SCRIPT_PATH = path.join(__dirname, 'tree-core.js');
const TREEADV_SCRIPT_PATH = path.join(__dirname, 'tree-advisor.js');
const COMBAT_READOUT_SCRIPT_PATH = path.join(__dirname, 'combat-readout.js');
const BUG_REPORT_SCRIPT_PATH = path.join(__dirname, 'bug-report.js');
const USAGE_PING_SCRIPT_PATH = path.join(__dirname, 'usage-ping.js');
const TASK_LOG_SCRIPT_PATH = path.join(__dirname, 'task-log.js');
const OPTION_LOG_SCRIPT_PATH = path.join(__dirname, 'option-log.js');
const TASK_TIP_SCRIPT_PATH = path.join(__dirname, 'task-tip.js');
const LEVER_ADVISOR_SCRIPT_PATH = path.join(__dirname, 'lever-advisor.js');
const CRAFT_POT_SCRIPT_PATH = path.join(__dirname, 'craft-potential.js');
const LAYOUTS_SCRIPT_PATH = path.join(__dirname, 'layouts.js');
const RAID_ALERT_SCRIPT_PATH = path.join(__dirname, 'raid-alert.js');
const RAIDS_DATA_PATH = path.join(P.dataRaw, 'raids.json');
const STATUS_INDICATOR_SCRIPT_PATH = path.join(__dirname, 'status-indicator.js');
const CLAN_BOARD_CARD_SCRIPT_PATH = path.join(__dirname, 'clan-board-card.js');
const CLAN_BOARD_SCRIPT_PATH = path.join(__dirname, 'clan-board-collect.js');
const CLAN_BOARD_CONFIG_PATH = P.state('clan-board-config.json');
const CLAN_BOARD_STATE_PATH = P.state('clan-board-state.json');
const ACTIVITIES_DIR = path.join(P.dataRaw, 'activities');
const CLAN_HISCORES_CONFIG_PATH = P.state('clan-hiscores-config.json');
const CLAN_HISCORES_STATE_PATH = STATE_MOVE.paths['clan-hiscores-state.json'];
const RAID_SUMMARY_CONFIG_PATH = P.state('raid-summary-config.json');
const DIGEST_CONFIG_PATH = P.state('digest-config.json');
const DIGEST_STATE_PATH = STATE_MOVE.paths['digest-state.json'];
const optionLog = createOptionLogStore(P.runtime('option-log.json'));
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
  raidSummary: { configured: false, lastPostAt: null, totalPosted: 0, totalSkippedSolo: 0, lastDecision: null },
  digest: { configured: false, lastPostAt: null, nextPostAt: null, totalPosted: 0 },
  recentLog: [],
  plugins: [],
  bridge: { ok: false, attachedAt: null, ms: null, error: null },
};
// Discord health (per feature: configured, last success, last error, queue length, broken) -- computed on demand from the shared sender.
Object.defineProperty(STATUS, 'discord', { enumerable: true, get: () => discordHealth() });

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
  if (/^\s*Clan board/i.test(t)) return { cat: 'discord', sub: 'board' };
  if (/hiscores/i.test(t) && /polled|posted|\bpost\b|rank/i.test(t)) return { cat: 'discord', sub: 'hiscores' };
  if (/raid summar/i.test(t) && /post/i.test(t)) return { cat: 'discord', sub: 'raid' };
  if (/digest/i.test(t) && /posted/i.test(t)) return { cat: 'discord', sub: 'digest' };
  if (/\bposted\b|webhook|discord post/i.test(t)) return { cat: 'discord', sub: 'relay' };
  if (/\bERROR\b|\bWARNING\b|failed|exception/i.test(t)) return { cat: 'system', sub: 'error' };
  if (/^\s*->\s*cc\b|^Plugin|plugin/i.test(t)) return { cat: 'system', sub: 'plugin' };
  if (/Connected to|Debugger connection|WebSocket|CDP|Waiting for the game|Running under|started\./i.test(t)) return { cat: 'system', sub: 'connection' };
  return { cat: 'system', sub: 'config' };
}

// watcher.log is rotated by size (one backup, watcher.1.log): checked on the first line and then every 200 lines.
const { rotateIfBig } = require('./log-rotate');
const LOG_MAX_BYTES = 1024 * 1024; let logLines = 199;
function log(...args) {
  const text = args.join(' ');
  const line = `[${new Date().toISOString()}] ${text}`;
  console.log(line);
  if (++logLines >= 200) { logLines = 0; rotateIfBig(LOG_PATH, LOG_MAX_BYTES); }
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (e) { /* best effort */ }
  const entry = Object.assign({ t: Date.now(), text }, categorize(text));
  STATUS.recentLog.push(entry);
  if (STATUS.recentLog.length > RECENT_LOG_CAP) STATUS.recentLog.shift();
  if (SUPERVISED) { try { process.send({ type: 'log', entry }); } catch (e) { /* supervisor gone */ } }
  else logstore.write(entry); // standalone: the supervisor normally owns the session log
}

// The one Discord sender (overlay/discord-sender.js): queue per webhook, rate limits, timeout, retry, size limits, no mentions. Its log lines
// never contain a webhook URL.
const sender = getSender({ log: (t) => log(t) });

// Features that post to a webhook, for the dashboard's Discord health card and the Test button.
const DISCORD_FEATURES = [
  { id: 'relay-clan', label: 'Chat relay (clan)', secret: 'relayClanWebhook' },
  { id: 'relay-global', label: 'Chat relay (global)', secret: 'relayGlobalWebhook' },
  { id: 'digest', label: 'Activity digest', secret: 'digestWebhook' },
  { id: 'hiscores', label: 'Clan hiscores', secret: 'hiscoresWebhook' },
  { id: 'raid', label: 'Raid summary', secret: 'raidSummaryWebhook' },
  { id: 'board', label: 'Clan status board', secret: 'boardWebhook' },
];
let discordUrlCache = { at: 0, urls: {} };
function discordUrls() {
  if (Date.now() - discordUrlCache.at < 4000) return discordUrlCache.urls;
  const urls = {};
  DISCORD_FEATURES.forEach((f) => { try { urls[f.id] = readSecretValue(SECRET_FIELDS[f.secret]); } catch (e) { urls[f.id] = ''; } });
  discordUrlCache = { at: Date.now(), urls };
  return urls;
}
function discordHealth() {
  const h = sender.health(), urls = discordUrls();
  const features = DISCORD_FEATURES.map((f) => Object.assign({ id: f.id, label: f.label, configured: !!urls[f.id] }, h.features[f.id] || { lastOkAt: null, lastErrorAt: null, lastError: null, lastStatus: null, sent: 0, failed: 0, queueLength: 0, broken: false, brokenReason: null, rateLimitedUntil: null }));
  return { features, globalRateLimitedUntil: h.globalRateLimitedUntil, problems: features.filter((f) => f.configured && (f.broken || (f.lastErrorAt && (!f.lastOkAt || f.lastErrorAt > f.lastOkAt)))).length };
}
const lastDiscordTest = {};
// The dashboard's Test send button: one harmless message, only when asked, at most once every 10 s per feature.
async function discordTest(featureId) {
  const f = DISCORD_FEATURES.find((x) => x.id === featureId);
  if (!f) return { ok: false, error: 'unknown feature' };
  const url = discordUrls()[f.id];
  if (!url) return { ok: false, error: 'no webhook is set for ' + f.label };
  if (Date.now() - (lastDiscordTest[f.id] || 0) < 10000) return { ok: false, error: 'wait a few seconds between tests' };
  lastDiscordTest[f.id] = Date.now();
  sender.reset(url);
  const r = await sender.send(f.id, url, { username: 'ScapeLite', content: '**ScapeLite test message** for "' + f.label + '". You pressed Test in ScapeLite, so this one message was sent. If you can read this, the channel works. Nothing else is posted by this button.' }, { force: true });
  log('Discord test message (' + f.label + '): ' + (r.ok ? 'accepted' : 'failed -- ' + (r.error || 'unknown error')));
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'failed' };
}

// The clan status board (overlay/clan-board-sync.js): one editable card for this player. Never blocks the watcher: a tick that is still talking to
// Discord makes the next one return at once.
const clanBoard = createBoard({ sender, log: (t) => log(t), statePath: CLAN_BOARD_STATE_PATH });
Object.defineProperty(STATUS, 'clanBoard', { enumerable: true, get: () => clanBoard.status() });
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
// Clan board, who covers whom (overlay/clan-board-roster.js): every ScapeLite that keeps its OWN card announces itself on the lease; the host (the lease leader, or a
// lone PC without a lease webhook) additionally keeps a simple card for each clanmate who has none -- only when "Also show clanmates who do not run ScapeLite" is on.
async function boardRosterStep(url, plugin, conn) {
  const lease = leaseMgr ? leaseMgr.forWebhook() : null;   // null = no lease webhook
  const boardOn = !!(plugin && plugin.clanBoardEnabled), self = ownPlayerName;
  const roster = conn ? await withTimeout(conn.evalAwait('window.__ccBridge && window.__ccBridge.clanRoster ? window.__ccBridge.clanRoster() : null', false), 8000).catch(() => null) : null;
  const inClan = roster && roster.state === 'ok' && Array.isArray(roster.members) ? new Set(roster.members.map((m) => rosterHash(m.name))) : null;
  const view = lease ? lease.boardView() : { known: false, present: new Set(), cards: {} };
  // 1. my own card exists: say so on the lease (once; also drops the entries of players who left the clan)
  if (lease && boardOn && self && url && clanBoard._state().messageId) {
    const h = rosterHash(self);
    if (view.known && !view.present.has(h)) lease.boardAnnounce(h, inClan || undefined).catch(() => {});
  }
  // 2. roster cards: the host only
  const host = lease ? lease.canRelay() : true;
  let hs = null; try { const j = readJsonRecover(CLAN_HISCORES_STATE_PATH, null); hs = j && j.members || null; } catch (e) { /* no hiscores yet */ }
  await clanBoard.rosterTick({
    url, enabled: boardOn && !!(plugin && plugin.clanBoardRoster), host, hostName: self, roster, exclude: (plugin && Array.isArray(plugin.clanBoardRosterExclude)) ? plugin.clanBoardRosterExclude : [],
    self, presence: view.present, leaseCards: view.cards, hiscores: hs,
    canCreate: Date.now() - STATUS.startedAt > 120000 && (!lease || view.known),   // the others need a moment to announce themselves after a start
    setCards: lease ? (map) => lease.boardSetCards(map) : null,
  });
}
let boardTickBusy = false;
async function boardTick() {
  if (boardTickBusy) return;
  boardTickBusy = true;
  try {
    const url = readSecretValue(SECRET_FIELDS.boardWebhook), conn = activeConn;
    let plugin = null, snap = null;
    if (conn) {
      plugin = await withTimeout(conn.evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false), 8000).catch(() => null);
      if (plugin && plugin.clanBoardEnabled) snap = await withTimeout(conn.evalAwait('window.__ccClanBoard && window.__ccClanBoard.snapshot ? window.__ccClanBoard.snapshot() : null', false), 8000).catch(() => null);
    }
    await clanBoard.tick({ url, plugin, snap, connected: !!conn });
    await boardRosterStep(url, plugin, conn);
  } catch (e) { log('Clan board: error -- ' + (e && e.message || e)); }
  finally { boardTickBusy = false; }
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
  { id: 'lifecycle', core: true, label: 'Lifecycle', ns: '__ccLife', desc: 'Owns the listeners, timers and frame loops of every plugin so a re-inject never leaves a second copy running.', build: () => readScript(LIFECYCLE_SCRIPT_PATH) },
  { id: 'dom-scope', core: true, label: 'DOM scope', ns: '__ccDom', desc: 'Page lookups that skip the game’s 134 000 hidden crafting-window elements, so polling plugins stay cheap.', build: () => readScript(DOMSCOPE_SCRIPT_PATH) },
  { id: 'log-client', core: true, label: 'Log client', ns: '__ccLog', desc: 'Lets plugins write to the log files in Logs/<Channel>/ (window.__ccLog.channel(name).info(...)). The watcher drains it every few seconds.', build: () => readScript(LOGCLIENT_SCRIPT_PATH) },
  { id: 'ui-kit', core: true, label: 'UI kit', ns: '__ccUI', desc: 'Shared design tokens, theme (accent, density, font size) and panel component for ScapeLite panels.', build: () => readScript(UIKIT_SCRIPT_PATH) },
  { id: 'ui-scale', core: true, label: 'UI scale', ns: '__ccUiScale', desc: 'Scales ScapeLite panels with the game window so they stay in proportion in a small window.', build: () => readScript(UISCALE_SCRIPT_PATH) },
  { id: 'panel-resize', core: true, label: 'Panel tools', ns: '__ccPanelScale', desc: 'Part of Core: resize handles, lock, the right-click panel menu, keep-on-screen and the vertical bottom-right menu.', build: () => readScript(PANEL_SCRIPT_PATH) },
  { id: 'anchor', core: true, label: 'Edge anchoring', ns: '__ccAnchor', desc: 'Keeps every floating panel at the same distance from its nearest screen edges when the window is resized.', build: () => readScript(ANCHOR_SCRIPT_PATH) },
  { id: 'card-fuse', label: 'Panel fusing', ns: '__ccCardFuse', desc: 'Glue touching ScapeLite panels together with a link button on their seam; a fused group moves, snaps and anchors as one.', build: () => readScript(CARDFUSE_SCRIPT_PATH) },
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
  { id: 'clan-board', label: 'Clan status board', ns: '__ccClanBoard', desc: 'Reads your own task, progress and levels for the Clan Status Board (a Discord card per player). Sends nothing itself; off until you switch the board on in Settings > Plugins.', build: () => readScript(CLAN_BOARD_CARD_SCRIPT_PATH) + '\n' + readScript(CLAN_BOARD_SCRIPT_PATH) },
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
  { id: 'tree-advisor', label: 'Tree Advisor', ns: '__ccTreeAdvisor', desc: 'Plans the best Delve and Fortress tree builds (DPS priced with the Gear Calc maths), with a tree picture, steps, saved builds and import / export.', build: () => readScript(TREECORE_SCRIPT_PATH) + '\n' + readScript(TREEADV_SCRIPT_PATH) },
  { id: 'raid-dps-extra', label: 'Raid DPS extras', ns: '__ccRaidDps', desc: 'Party total DPS line and a damage-over-time graph tab in the Raid DPS panel.', build: () => readScript(RDPS_SCRIPT_PATH) },
  { id: 'queue-walk', label: 'Queue walking time', ns: '__ccQueueWalk', desc: 'A bar and tag on each queued task showing how long the walk to it takes.', build: () => readScript(QWALK_SCRIPT_PATH) },
  { id: 'fortress-tracker', label: 'Fortress tracker', ns: '__ccFortress', desc: 'Tracks your Fortress runs, loot chances and drops, and shows how lucky you have been (Fortress tab of the Drop Luck panel).', build: () => readScript(FORTRESS_SCRIPT_PATH) },
  { id: 'hp-panel', label: 'HP panel', ns: '__ccHpPanel', desc: 'Your hit points as a bar or as numbers with an icon, in a small movable panel (the game’s own HP bar can be hidden).', build: () => readScript(HP_PANEL_SCRIPT_PATH) },
  { id: 'goals', label: 'Goals', ns: '__ccGoals', desc: 'Skill goals with time left at your real XP per hour, plus unlock drops worth hunting.', build: () => readScript(GOALS_SCRIPT_PATH) },
  { id: 'diary-credits', label: 'Locations and free pips', ns: '__ccDiaryCredits', desc: 'Rates every location by walking distance to its bank, shows how often it is rolled and used, and says where to put the free node-lever pips the diary gives; also diary progress and credit pools.', build: () => readScript(DIARYCORE_SCRIPT_PATH) + '\n' + readScript(DIARYCREDITS_SCRIPT_PATH) },
  { id: 'drop-luck', label: 'Drop luck tracker', ns: '__ccDropLuck', desc: 'How lucky your rare drops have been: luck rating, most overdue drops, per-mob list, dungeons (Delve), unlocks with filters and search, pets and lucky tools, a chance graph per drop.', build: () => readScript(DROPLUCK_SCRIPT_PATH) },
  { id: 'advisor', label: 'Advisor', ns: '__ccAdvisor', desc: 'One panel that says what to do next, how and where, from the Route Advisor, Lever Advisor, Tree Advisor, Goals and Locations and Free Pips, with how sure each action is.', build: () => readScript(ADVISORCORE_SCRIPT_PATH) + '\n' + readScript(ADVISOR_SCRIPT_PATH) },
  { id: 'card-sync', core: true, label: 'Card sync', ns: '__ccCardSync', desc: 'One shared way for every ScapeLite card to learn that the game panel or data it copies changed, and one rule for when it may redraw.', build: () => readScript(CARDSYNC_SCRIPT_PATH) },
  { id: 'cards', core: true, label: 'Cards', ns: '__ccCards', desc: 'The model builders of the ScapeLite cards (Skills, Inventory, Equipment, Diary, Quests, Friends, Barter, Chat): what each card shows and which game panel it copies. Registered with the card layer.', build: () => {
      const names = fs.readdirSync(CARDS_DIR).filter((n) => /^[\w-]+\.js$/.test(n)).sort();
      return names.map((n) => readScript(path.join(CARDS_DIR, n))).join('\n;\n') + '\n;window.__ccCards = { files: ' + JSON.stringify(names) + ' };';
    } },
  { id: 'ui-bar', label: 'Info Bars', ns: '__ccBar', desc: 'Customisable bars along the top and bottom of the screen (like Titan Panel): task, location, XP per hour, gold, clock and more. Drag modules, right-click to add, remove and set options. The game and ScapeLite panels use the space that is left.', build: () => readScript(UIBAR_SCRIPT_PATH) },
  { id: 'ui-queue', label: 'Task queue panel', ns: '__ccQueue', desc: 'The task queue as compact cards: tiers, walking pills, options that slide out to the side, drag to reorder, the Route Advisor’s highlight and order. Opens from the info bar’s Tasks button.', build: () => readScript(UIQUEUE_SCRIPT_PATH) },
  { id: 'chat-plus', label: 'Chat panel', ns: '__ccChat', desc: 'A calmer replacement for the game chat window: a width you choose, channel tabs with unread counts, search, message-type filters, highlight and mute words, seconds on timestamps, font size and more.', build: () => readScript(CHATPLUS_SCRIPT_PATH) },
  { id: 'chat-commands', label: 'Chat commands', ns: '__ccCmd', desc: 'Type /sl help in the chat for ScapeLite commands (status, refresh, plugin on/off, relay and digest checks). Replies are only shown to you and never sent to chat.', build: () => readScript(CHATCMD_SCRIPT_PATH) },
  { id: 'ui-layout', label: 'Layout Editor', ns: '__ccUILayout', desc: 'Edit mode for ScapeLite panels: drag with snapping, fade, scale, resize, lock, and save whole layouts (export / import as text).', build: () => readScript(DEFAULT_LAYOUT_SCRIPT_PATH) + '\n' + readScript(UILAYOUT_SCRIPT_PATH) },
  { id: 'alert-bell', core: true, label: 'Alerts bell', ns: '__ccAlerts', desc: 'A bell that is always visible with a red number for things that need you: unspent tree points, finished quests, unopened chests, gear upgrades, craftable collection entries and more.', build: () => readScript(ALERTS_SCRIPT_PATH) },
  { id: 'scapelite-menu', core: true, label: 'ScapeLite menu', ns: '__ccScapeliteMenu', desc: 'A ScapeLite button in the left icon strip; hover it to open or close ScapeLite panels.', build: () => readScript(SLMENU_SCRIPT_PATH) },
  { id: 'material-shortage', label: 'Material shortage warning', ns: '__ccMaterialShortage', desc: 'Warns when the running or a queued processing task will probably run out of materials (counts half your save chance).', build: () => readScript(MATSHORT_SCRIPT_PATH) },
  { id: 'mechanics-explainer', label: 'Mechanics explainer', ns: '__ccMechanics', desc: 'Adds a plain-language explanation to the lever tooltips in the customization windows.', build: () => readScript(MECHANICS_SCRIPT_PATH) },
  { id: 'chat-default', label: 'Chat default channel', ns: '__ccChatDefault', desc: 'Remembers your last chat channel and starts on the leftmost shown one.', build: () => readScript(CHAT_DEFAULT_SCRIPT_PATH) },
  { id: 'combat-readout', label: 'Combat readout', ns: '__ccCombatReadout', desc: 'Exact HP, Spirit, attack timer countdown, attacks per second and DPS on the combat screen.', build: () => readScript(COMBAT_READOUT_SCRIPT_PATH) },
  { id: 'bug-report', core: true, label: 'Bug report', ns: '__ccBugReport', desc: 'In-game bug report form (Settings > Plugins, and the bug icon under the status light).', build: () => {
      let official = [];
      try { official = (JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || []).filter((pl) => pl.id !== 'core').map((pl) => ({ id: pl.id, name: pl.name })); } catch (e) { /* no catalog */ }
      return `window.__CC_OFFICIAL = ${JSON.stringify(official)};
` + readScript(BUG_REPORT_SCRIPT_PATH);
    } },
  { id: 'usage-ping', label: 'Anonymous usage count', ns: '__ccUsagePing', desc: 'One anonymous request per day so the author can see roughly how many people use ScapeLite. Off in Settings or the first-launch setup.', build: () => readScript(USAGE_PING_SCRIPT_PATH) },
  { id: 'task-log', label: 'Task log', ns: '__ccTaskLog', desc: 'Records every task you run (time split into walking and acting, real XP, predictions) locally, to tune the Route Advisor.', build: () => readScript(TASK_LOG_SCRIPT_PATH) },
  { id: 'option-log', label: 'Task option log', ns: '__ccOptionLog', desc: 'Writes down which task options the game offered (not only the one you picked) in State/option-log.json, to test the roll odds and the lucky chance. Local only.', build: () => readScript(OPTION_LOG_SCRIPT_PATH) },
  { id: 'task-tip', label: 'Task history tooltips', ns: '__ccTaskTip', desc: 'Rich hover tooltips on the Skills Customization history lists (real task number, time split, XP, drops, materials, potions) and a Slay History filled from the Task Log.', build: () => readScript(TASK_TIP_SCRIPT_PATH) },
  { id: 'lever-advisor', label: 'Lever advisor', ns: '__ccLeverAdvisor', desc: 'Outlines the skill and slay levers worth pulling, by route, within your credits.', build: () => readScript(LEVER_ADVISOR_SCRIPT_PATH) },
  { id: 'craft-potential', label: 'Crafting potential', ns: '__ccCraftPot', desc: 'Shows the level you could reach by crafting with every material in your bank, in the XP bar of the Smith / Craft / Imbue / Brew windows.', build: () => readScript(CRAFT_POT_SCRIPT_PATH) },
  { id: 'bank-tools', label: 'Bank tools', ns: '__ccBankTools', desc: 'Category separators in the bank, category chips on item hover, and sub-category filter menus.', build: () => readScript(BANK_TOOLS_SCRIPT_PATH) },
  { id: 'notif-dock', label: 'Notification dock', ns: '__ccNotifDock', desc: 'Raid/party invites and popups: always on top, centred, movable.', build: () => readScript(NOTIF_DOCK_SCRIPT_PATH) },
  { id: 'modal-resize', label: 'Resizable windows', ns: '__ccModalResize', desc: 'Move and resize the big Settings / Bank / Crafting windows (title bar, grips, fullscreen snap); the game stays visible behind them.', build: () => readScript(MODAL_RESIZE_SCRIPT_PATH) },
  { id: 'menu-dock', label: 'Menu + HP bar dock', ns: '__ccMenuDock', desc: 'Move, resize and fuse the vertical menu and HP bar.', build: () => readScript(MENU_DOCK_SCRIPT_PATH) },
  { id: 'welcome-tour', core: true, label: 'Welcome tour', ns: '__ccWelcome', desc: 'First-run popup explaining the plugin settings, dashboard and marketplace.', build: () => {
      let guides = {};
      try { (JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || []).forEach((pl) => { if (pl.guide) guides[pl.id] = pl.guide; }); } catch (e) { /* no catalog */ }
      return `window.__CC_GUIDES = ${JSON.stringify(guides)};\n` + readScript(WELCOME_TOUR_SCRIPT_PATH);
    } },
  { id: 'discord-setup', core: true, label: 'Discord setup wizard', ns: '__ccDiscordSetup', desc: 'A step-by-step guide to the Discord features: channels, webhooks, roles, a Test button per channel. Posts nothing by itself.', build: () => readScript(DISCORD_SETUP_SCRIPT_PATH) },
  { id: 'presets', core: true, label: 'ScapeLite looks', ns: '__ccPresets', desc: 'Full Vanilla, Combination and ScapeLite only: one choice that sets the Info Bar and the display options, with a one-time chooser on a new install.', build: () => readScript(PRESETS_SCRIPT_PATH) },
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
    writeJsonAtomic(PLUGINS_CONFIG_PATH, cfg, { indent: 2, backup: false });
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
  try { writeJsonAtomic(PLUGINS_CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (e) { /* best effort */ }
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
    // a hollow first-run config (no webhook on any channel) counts as not configured
    STATUS.chatRelay.configured = !!(cfg && cfg.channels && Object.keys(cfg.channels).some((k) => cfg.channels[k] && cfg.channels[k].webhookUrl));
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

// --- Discord formatting: overlay/relay-events.js (text from the typed event) and overlay/relay-core.js (payload) ---

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
  try { playerIconCache = readJsonRecover(PLAYER_ICON_CACHE_PATH, {}) || {}; } catch (e) { playerIconCache = {}; }
}
function savePlayerIconCache() {
  try { writeJsonAtomic(PLAYER_ICON_CACHE_PATH, playerIconCache, { backup: false }); } catch (e) { /* best effort */ }
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

// Every post goes through the shared sender (overlay/discord-sender.js). Returns its result: { ok, ... } -- callers that must not lose data
// (outbox, digest buffer, hiscores baseline, raid summaries) keep it until result.ok is true. See that file for the other flags.
function postToDiscord(feature, webhookUrl, payload, opts) {
  return sender.send(feature, webhookUrl, payload, opts);
}

// --- Chat relay engine (overlay/relay-core.js) ----------------------------------------------------------------------------------------
// Typed events -> outbox (kept on disk until Discord accepted them) -> gate -> shared sender. The gate is the duplicate-instance protection:
// with several ScapeLite instances on one webhook only the one holding the lease posts the shared stream (docs/DISCORD-RELAY-AUDIT.md).
// Global chat is server-wide, so plain banter stays gated per channel (off by default for Global); structured events pass.
const RELAYED_STATE_LOAD = () => { const info = {}, arr = readJsonRecover(RELAYED_STATE_PATH, null, info); if (info.recovered) log('WARNING: the relayed-keys file was damaged; recovered it from the ' + info.recovered + ' copy.'); return arr; };
const OUTBOX_PATH = P.state('chat-relay-outbox.json');
const RELAY_INSTANCE_PATH = P.state('relay-instance.json');
function loadInstanceId() {
  try { const j = readJsonRecover(RELAY_INSTANCE_PATH, null); if (j && /^[0-9a-f]{8}$/.test(String(j.id))) return j.id; } catch (e) { /* new id below */ }
  const id = newInstanceId();
  try { writeJsonAtomic(RELAY_INSTANCE_PATH, { id }, { backup: false }); } catch (e) { /* best effort */ }
  return id;
}
let ownNameAt = 0;
let ownPlayerName = '';           // the in-game name, shown on the lease message as "leader <name>"
let relayRole = 'auto';           // Plugins > Chat Relay > "Several ScapeLite users": auto | always | never | own
const SL_VERSION = (() => { try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || ''); } catch (e) { return ''; } })();
// The lease lives on the OPTIONAL lease webhook (Plugins > Chat Relay > Shared Lease Webhook, a webhook in a private channel). None set = no lease and nothing extra in any channel.
// A lease webhook that is also one of the posting webhooks is ignored: it would put the lease message back into a channel people read.
function leaseWebhookUrl() {
  const u = readSecretValue(SECRET_FIELDS.relayLeaseWebhook);
  if (!u) return '';
  const posting = [SECRET_FIELDS.relayClanWebhook, SECRET_FIELDS.relayGlobalWebhook, SECRET_FIELDS.digestWebhook, SECRET_FIELDS.hiscoresWebhook, SECRET_FIELDS.raidSummaryWebhook].map(readSecretValue);
  return posting.indexOf(u) === -1 ? u : '';
}
const leaseMgr = createLeaseManager({ send: (f, u, pl, o) => sender.send(f, u, pl, o), label: () => ownPlayerName, instanceId: loadInstanceId(), leaseUrl: leaseWebhookUrl, version: SL_VERSION, log: (t) => log(t) });
const relayGate = leaseGate(leaseMgr, () => relayRole);
const relay = createRelay({
  send: (feature, url, payload) => postToDiscord(feature, url, payload),
  isBroken: (url) => sender.isBroken(url),
  gate: relayGate,
  ownOnly: () => relayRole === 'own',
  noteRelayed: (url, key) => { if (relayRole === 'auto') { const l = leaseMgr.forWebhook(url); if (l) l.noteRelayed(key); } },
  alreadyRelayedByOthers: (url, key) => { const l = relayRole === 'auto' && leaseMgr.forWebhook(url); return !!(l && l.alreadyRelayed(key)); },
  avatarFor: (evt) => resolvePlayerAvatar(evt),
  log: (...a) => log(...a),
  status: STATUS.chatRelay,
  store: {
    loadKeys: RELAYED_STATE_LOAD,
    saveKeys: (a) => writeJsonAtomic(RELAYED_STATE_PATH, a),
    loadOutbox: () => readJsonRecover(OUTBOX_PATH, null),
    saveOutbox: (a) => writeJsonAtomic(OUTBOX_PATH, a),
  },
  options: { spacingMs: DISCORD_POST_SPACING_MS },
});
Object.defineProperty(STATUS, 'relayLease', { enumerable: true, get: () => {
  const hooks = [];
  leaseMgr.all().forEach((l) => { const i = l.info(); hooks.push({ role: i.role, leader: i.leader, epoch: i.epoch, errors: i.errors, lastError: i.lastError || null, hasLease: i.hasLease }); });
  const first = Array.from(leaseMgr.all().values())[0];
  return { mode: relayRole, instance: leaseMgr.instanceId, configured: leaseMgr.configured(), version: SL_VERSION, newerVersion: first ? first.info().newerVersion : '', webhooks: hooks };
} });
const processOutbox = (cfg) => relay.process(cfg);
// drained / rescanned raw events -> typed events -> digest + outbox -> post (what is allowed to leave this PC is decided by the gate)
function ingestDrained(rawEvents, cfg) {
  const typed = relay.typed(rawEvents);
  accumulateForDigest(typed);
  relay.enqueue(typed);
  return relay.process(cfg);
}
function setRelayRole(v) { relayRole = (v === 'always' || v === 'never' || v === 'own') ? v : 'auto'; }
// The lease is created ahead of the first event so a failover is ready. Without a lease webhook there is nothing to create: say so once.
let quietNoted = false;
function ensureLeases() {
  if (relayRole !== 'auto') return;
  if (leaseMgr.configured()) { leaseMgr.forWebhook(); return; }
  if (!quietNoted) { quietNoted = true; log('Relay: no shared lease webhook is set (Plugins > Chat Relay), so this PC posts everything it sees. If other ScapeLite users share these channels, set one or choose "Own events only" (docs/DISCORD-RELAY-AUDIT.md, part 8).'); }
}
// Version signalling: a clanmate on the same lease runs a newer ScapeLite. Shown in the Plugins tab (About) and logged once per version; nothing else about them is known.
let lastNewerLogged = '';
function noteNewerVersion() {
  const l = Array.from(leaseMgr.all().values())[0], nv = l ? l.info().newerVersion : '';
  if (nv && nv !== lastNewerLogged) { lastNewerLogged = nv; log('ScapeLite version: another ScapeLite user on this relay runs ' + nv + ', this PC runs ' + SL_VERSION + '. Plugins > About > Check For Updates.'); }
}
// One-time removal of the visible lease message and name suffix the first lease version put on the clan's webhooks (overlay/relay-legacy-cleanup.js).
const LEGACY_CLEANUP_PATH = P.state('relay-legacy-cleanup.json');
async function runLegacyLeaseCleanup() {
  const targets = [['relayClanWebhook', 'relay'], ['relayGlobalWebhook', 'relay (global)'], ['digestWebhook', 'digest'], ['hiscoresWebhook', 'hiscores'], ['raidSummaryWebhook', 'raid']]
    .map((x) => ({ feature: x[1], url: readSecretValue(SECRET_FIELDS[x[0]]) })).filter((t) => t.url);
  try {
    await legacyLeaseCleanup.run({ send: (f, u, pl, o) => sender.send(f, u, pl, o), targets, log: (t) => log(t),
      load: () => readJsonRecover(LEGACY_CLEANUP_PATH, {}), save: (s) => writeJsonAtomic(LEGACY_CLEANUP_PATH, s, { backup: false }) });
  } catch (e) { log('Relay lease clean-up: error --', e.message || String(e)); }
}
setTimeout(runLegacyLeaseCleanup, 20000);
setInterval(runLegacyLeaseCleanup, 3600000);

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
    try { await clanBoard.shutdown({ url: readSecretValue(SECRET_FIELDS.boardWebhook), timeoutMs: 4000 }); } catch (e) { log('Clan board: final offline update failed --', e.message || String(e)); }
    await sender.flush(2500);
    try { await Promise.race([leaseMgr.releaseAll(), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* the lease just expires */ }
  } catch (e) { log('Flush error during shutdown --', e.message || String(e)); }
  log(`Flush finished (${relay.outbox().length} event(s) left in the outbox for next start) -- exiting`);
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
    const s = readJsonRecover(CLAN_HISCORES_STATE_PATH, null);
    if (s && typeof s === 'object' && !Array.isArray(s)) return Object.assign({ clanRank: null, members: {}, lastPost: null }, s);
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
  try { writeJsonAtomic(CLAN_HISCORES_STATE_PATH, state, { indent: 2 }); } catch (e) { /* best effort */ }
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

// Rules for posting a summary (Settings > Plugins > Raid Summary). `st` = the run's facts: party size, guild mates, wave, kind.
// Mode 'any' posts when one switched-on rule that applies to this run matches; 'all' needs every one of them. No rules on = post everything.
function evaluateRaidSummaryRules(plugin, st) {
  const p = plugin || {};
  if (st.kind === 'dungeon' && p.raidSummaryDungeons === false) return { post: false, why: 'dungeon runs are switched off' };
  if (st.kind !== 'dungeon' && p.raidSummaryRaids === false) return { post: false, why: 'raids are switched off' };
  const rules = [];
  if (p.raidSummaryPartyOn !== false) { const n = Number(p.raidSummaryMinMembers) || 2; rules.push({ name: 'party >= ' + n, ok: (st.size || 0) >= n }); }
  if (p.raidSummaryGuildOn !== false) { const n = Number(p.raidSummaryGuildMin) || 1; rules.push({ name: 'guild mates >= ' + n, ok: (st.guild || 0) >= n }); }
  if (p.raidSummaryWaveOn !== false && st.kind === 'dungeon') { const n = Number(p.raidSummaryWaveMin) || 10; rules.push({ name: 'wave >= ' + n, ok: (st.wave || 0) >= n }); }
  if (!rules.length) return { post: true, why: 'no rules on' };
  const all = p.raidSummaryMode === 'all';
  const post = all ? rules.every((r) => r.ok) : rules.some((r) => r.ok);
  return { post, why: (all ? 'all of: ' : 'any of: ') + rules.map((r) => r.name + (r.ok ? ' yes' : ' no')).join(', ') };
}

function buildRaidSummaryPayload(entry) {
  const dmgLine = entry.perPlayerDamage.length
    ? entry.perPlayerDamage.slice(0, 5).map((p) => p.text ? `${p.playerName} ${p.text}` : `${p.playerName} (${formatNumber(p.damageDealt)})`).join(', ')
    : '--';
  const lootLine = entry.loot.length
    ? entry.loot.map((l) => `${l.quantity > 1 ? l.quantity + 'x ' : ''}${l.name}${l.isRare ? ' 🌟' : ''}`).join(', ')
    : 'No loot';
  const memberWord = entry.memberCount === 1 ? 'member' : 'members';
  const guildBit = entry.guildCount > 0 ? ` (${entry.guildCount} guild)` : '';
  const head = entry.kind === 'dungeon'
    ? `⚔️ **${entry.raidName}** -- reached **Wave ${entry.wave || '?'}** in ${formatRaidDuration(entry.runMs)} -- ${entry.memberCount} ${memberWord}${guildBit}`
    : `⚔️ **${entry.raidName}** complete -- ${entry.memberCount} ${memberWord}${guildBit}, ${formatRaidDuration(entry.runMs)}`;
  const content = head + '\n' +
    `🏆 ${dmgLine}\n` +
    `🎁 ${lootLine}`;
  return { username: 'Raid Summary', content };
}

// A finished run is drained from the page ONCE (the page forgets it), so it waits here until Discord has accepted it: kept on disk,
// retried with a growing delay, dropped after RAID_MAX_TRIES failed posts, or when the webhook rejects the message.
const RAID_PENDING_PATH = P.state('raid-summary-pending.json');
const RAID_MAX_TRIES = 6, RAID_MAX_AGE_MS = 6 * 3600 * 1000;
let raidPending = [], raidTickBusy = false;
function loadRaidPending() { try { const a = readJsonRecover(RAID_PENDING_PATH, []); raidPending = Array.isArray(a) ? a : []; } catch (e) { raidPending = []; } }
function saveRaidPending() { try { writeJsonAtomic(RAID_PENDING_PATH, raidPending); } catch (e) { /* best effort */ } }
async function flushRaidPending(cfg) {
  if (!cfg || !cfg.webhookUrl) return;
  for (const it of raidPending.slice()) {
    if (Date.now() < (it.nextAt || 0)) continue;
    if (Date.now() - it.firstAt > RAID_MAX_AGE_MS) { log('Raid summary: dropping', it.entry.raidName, 'after 6 hours without a successful post.'); raidPending.splice(raidPending.indexOf(it), 1); saveRaidPending(); continue; }
    if (relayRole === 'never' || relayRole === 'own') { log('Raid summary: not posting', it.entry.raidName, '-- this PC is set to never post shared messages.'); raidPending.splice(raidPending.indexOf(it), 1); saveRaidPending(); continue; }
    if (relayRole === 'auto' && !it.claimed && leaseMgr.forWebhook(cfg.webhookUrl)) {   // (needs the lease webhook; without one this PC posts) every raid member's PC has the same summary: the first to claim it posts it, the others skip it
      const bucket = Math.floor((it.entry.ts || it.firstAt) / 300000), nm = String(it.entry.raidName || '') + '|' + (it.entry.kind || 'raid');
      const lease = leaseMgr.forWebhook(cfg.webhookUrl);
      const c = lease ? await lease.claim('raid|' + nm + '|' + bucket, ['raid|' + nm + '|' + (bucket - 1), 'raid|' + nm + '|' + (bucket + 1)]) : { ok: false, error: 'no lease' };
      if (c.ok) { it.claimed = true; saveRaidPending(); }
      else if (c.by) { log('Raid summary:', it.entry.raidName, 'is posted by another ScapeLite instance -- skipping it here.'); raidPending.splice(raidPending.indexOf(it), 1); saveRaidPending(); continue; }
      else { it.nextAt = Date.now() + 60000; saveRaidPending(); continue; }   // lease not readable yet: ask again in a minute (the summary is kept)
    }
    log('  -> raid summary:', it.entry.raidName, '(' + it.entry.memberCount + ' members)' + (it.tries ? ' retry ' + it.tries : ''));
    const res = await postToDiscord('raid', cfg.webhookUrl, buildRaidSummaryPayload(it.entry));
    if (res.ok) {
      raidPending.splice(raidPending.indexOf(it), 1); saveRaidPending();
      STATUS.raidSummary.lastPostAt = Date.now();
      STATUS.raidSummary.totalPosted += 1;
      await new Promise((r) => setTimeout(r, DISCORD_POST_SPACING_MS));
      continue;
    }
    if (res.rejected) { log('Raid summary: Discord rejected the message, dropping it --', res.error); raidPending.splice(raidPending.indexOf(it), 1); saveRaidPending(); continue; }
    if (res.broken || res.deferred) { it.nextAt = Date.now() + 5 * 60000; saveRaidPending(); break; }   // not the summary's fault: no try used
    it.tries = (it.tries || 0) + 1;
    if (it.tries >= RAID_MAX_TRIES) { log('Raid summary: giving up on', it.entry.raidName, 'after', String(RAID_MAX_TRIES), 'failed posts.'); raidPending.splice(raidPending.indexOf(it), 1); }
    else it.nextAt = Date.now() + Math.min(30 * 60000, 30000 * Math.pow(2, it.tries - 1));
    saveRaidPending();
  }
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
    const b = readJsonRecover(DIGEST_STATE_PATH, null);
    if (b && typeof b === 'object' && b.players) {
      // Older buffers: entries were filed by the WORDING of the line (Fortress loot ended up under Unlocks for some members and Drops for others), carried "Luck XP"
      // leftovers and duplicates. Re-file every entry by its item (data/raw/items.json), the same for everybody.
      RelayEvents.migrateDigestBuffer(b);
      return Object.assign({ seenKeys: [] }, b);
    }
  } catch (e) { /* no buffer yet */ }
  return emptyDigestBuffer();
}

function saveDigestBuffer(buffer) {
  try { writeJsonAtomic(DIGEST_STATE_PATH, buffer); } catch (e) { /* best effort */ }
}

let digestBuffer = emptyDigestBuffer(); // loaded for real in main()

// Independent dedup, same reasoning as the relay's own (restart + DOM-rebuild can re-drain already-seen chat history as "new") but a SEPARATE set, not a reuse of
// the relay's: the digest keeps working with live relay off, and a relay that saw an event first must not make the digest treat it as a duplicate. Persisted inside
// digest-state.json (seenKeys). Keys are the raw line keys (channel|time|player|text) of every line that was merged into the typed event.
const DIGEST_SEEN_CAP = 1000;
let digestSeenKeys = new Set();
function syncDigestSeenKeys() { digestSeenKeys = new Set(digestBuffer.seenKeys || []); }
syncDigestSeenKeys();

function alreadyInDigest(evt) {
  const keys = evt.rawKeys && evt.rawKeys.length ? evt.rawKeys : [RelayEvents.rawKey(evt)];
  const fresh = keys.filter((k) => !digestSeenKeys.has(k));
  if (!fresh.length) return true;
  fresh.forEach((k) => digestSeenKeys.add(k));
  while (digestSeenKeys.size > DIGEST_SEEN_CAP) digestSeenKeys.delete(digestSeenKeys.values().next().value);
  digestBuffer.seenKeys = Array.from(digestSeenKeys);
  return false;
}

// ---- Activity digest: collecting ------------------------------------------------------------------------------------
// Fed with TYPED events (overlay/relay-events.js): one logical event per drop however many chat lines announced it, and the bucket is decided by the ITEM
// (an unlock item is an Unlock, whoever got it and however the game worded it). Collection-log entries from skilling are never listed.
const DIGEST_CHANNELS = new Set(['clan', 'friends', 'game']);
function accumulateForDigest(events) {
  if (!Array.isArray(events) || !events.length) return;
  let changed = false;
  for (const evt of events) {
    if (!evt.player || evt.type === 'chat') continue;
    if (evt.channel && !DIGEST_CHANNELS.has(evt.channel)) continue;   // only Clan, Friends and your own (Game) lines are ever reported: never Global or Proximity
    if (alreadyInDigest(evt)) continue; // restart/DOM-rebuild re-drain guard
    changed = true; // seenKeys itself changed
    if (RelayEvents.digestAdd(digestBuffer, evt)) changed = true;
  }
  if (changed) saveDigestBuffer(digestBuffer);
}

// A follower (another ScapeLite instance posts the digest): when the leader has posted, empty this PC's copy so a later takeover does not post the same activity again.
// Only compares the leader's "posted at" value with the one remembered here (never the clocks of two PCs); the first sighting is just remembered.
function syncDigestWithLease(url) {
  if (relayRole !== 'auto') return;
  const l = leaseMgr.forWebhook(url), sh = l && l.shared();
  if (!sh || !sh.dg) return;
  if (digestBuffer.lastDg === undefined) { digestBuffer.lastDg = sh.dg; saveDigestBuffer(digestBuffer); return; }
  if (digestBuffer.lastDg === sh.dg) return;
  log('Activity digest: another ScapeLite instance posted the digest -- emptying this PC\'s copy of it.');
  digestBuffer = { sinceAt: Date.now(), players: {}, seenKeys: digestBuffer.seenKeys, lastDg: sh.dg };
  saveDigestBuffer(digestBuffer);
}

// Caps each category per player so one extremely active member can't blow
// past Discord's ~2000-char content limit on their own -- same "truncate
// rather than silently fail" approach used for quest-reward lines
// elsewhere in this mod.
const DIGEST_CAP_PER_CATEGORY = 8;
function capList(listIn) {
  const list = RelayEvents.collapseEntries(listIn);   // a drop that came several times is one entry with a count
  if (list.length <= DIGEST_CAP_PER_CATEGORY) return list.join(', ');
  return list.slice(0, DIGEST_CAP_PER_CATEGORY).join(', ') + ` (+${list.length - DIGEST_CAP_PER_CATEGORY} more)`;
}

// One block per player with something notable (snap = what the block was built from, so a send that finishes later removes exactly that).
function buildDigestBlocks(buffer) {
  const names = Object.keys(buffer.players).filter((name) => {
    const p = buffer.players[name];
    return p.rareDrops.length || p.unlocks.length || p.pets.length || p.quests.length || Object.keys(p.levels).length;
  });
  names.sort((a, b) => a.localeCompare(b));
  return names.map((name) => {
    const p = buffer.players[name], lines = [`**${name}**`];
    if (p.rareDrops.length) lines.push(`💎 Drops: ${capList(p.rareDrops)}`);
    if (p.pets.length) lines.push(`🐾 Pets: ${capList(p.pets)}`);
    if (p.unlocks.length) lines.push(`🔓 Unlocks: ${capList(p.unlocks)}`);
    const skillNames = Object.keys(p.levels);
    if (skillNames.length) {
      lines.push(`⭐ Levels: ${skillNames.map((s) => `${s} → ${p.levels[s]}`).join(', ')}`);
    }
    if (p.quests.length) lines.push(`📜 Quests: ${capList(p.quests)}`);
    return { name, text: lines.join('\n'), snap: JSON.parse(JSON.stringify(p)) };
  });
}
const digestHead = (buffer) => `📋 **Activity Digest** -- last ${Math.round((Date.now() - buffer.sinceAt) / 3600000)}h`;
// After a chunk was accepted: take that player's sent entries out of the buffer (anything collected while the post was in flight stays).
function subtractDigestSnapshot(buffer, name, snap) {
  const cur = buffer.players[name];
  if (!cur) return;
  const lists = ['rareDrops', 'unlocks', 'pets', 'quests'];
  lists.forEach((k) => { cur[k] = (cur[k] || []).slice((snap[k] || []).length); });
  Object.keys(snap.levels || {}).forEach((s) => { if (cur.levels && cur.levels[s] != null && cur.levels[s] <= snap.levels[s]) delete cur.levels[s]; });
  if (lists.every((k) => !cur[k].length) && !Object.keys(cur.levels || {}).length) delete buffer.players[name];
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

// Keeps the Clan Hiscores member list in line with the clan roster the game itself holds. Runs at the start of every lookup:
//   - a member who joined the clan is added to the config's list;
//   - a member who left is removed from it, and forgotten in the poll state and in the last-post baseline (so nobody is announced as "changed" because they left);
//   - everything else in the config (webhook, intervals, tag, order of the remaining members) is left exactly as it was.
// It only acts on a complete, trustworthy roster: the game must report the same clan tag as the config (when the config has one), the roster must not be empty, and it must
// not be less than half the size of the list it replaces (a half-loaded roster would otherwise wipe the list). Otherwise it logs and changes nothing.
const lower = (n) => String(n || '').trim().toLowerCase();
function planRosterSync(current, roster) {
  const have = new Map((current || []).map((n) => [lower(n), n])), want = new Map((roster || []).map((m) => [lower(m.name), m.name]));
  const added = [...want.keys()].filter((k) => !have.has(k)).map((k) => want.get(k));
  const removed = [...have.keys()].filter((k) => !want.has(k)).map((k) => have.get(k));
  const kept = (current || []).filter((n) => want.has(lower(n)));
  return { added, removed, members: kept.concat(added) };
}
async function syncClanRoster(evalAwait, cfg, state) {
  let roster;
  try { roster = await evalAwait(`window.__ccBridge && window.__ccBridge.clanRoster ? window.__ccBridge.clanRoster() : null`, false); } catch (e) { return false; }
  if (!roster || roster.state !== 'ok' || !Array.isArray(roster.members) || !roster.members.length) return false;   // not in a clan, still loading, or the bridge is not attached
  if (cfg.clanTag && roster.tag && lower(cfg.clanTag) !== lower(roster.tag)) { log('Clan hiscores: roster sync skipped (the game is in clan', JSON.stringify(roster.tag), 'but the config is for', JSON.stringify(cfg.clanTag) + ')'); return false; }
  const cur = Array.isArray(cfg.members) ? cfg.members : [], plan = planRosterSync(cur, roster.members);
  // Someone who left must not stay in the next Activity Digest with what they did earlier in the same period (also cleans up after a roster change that was synced before this ran).
  if (digestBuffer && digestBuffer.players) {
    const here = new Set(roster.members.map((m) => lower(m.name))); const gone = Object.keys(digestBuffer.players).filter((n) => !here.has(lower(n)));
    if (gone.length) { gone.forEach((n) => delete digestBuffer.players[n]); saveDigestBuffer(digestBuffer); log('Activity digest: dropped the buffered activity of', gone.join(', '), '(not in the clan roster)'); }
  }
  if (!plan.added.length && !plan.removed.length) return false;
  if (cur.length && roster.members.length * 2 < cur.length) { log('Clan hiscores: roster sync skipped (the game reports', roster.members.length, 'members against', cur.length, 'in the config: looks incomplete)'); return false; }
  // write the change into the config FILE (read fresh, so edits made meanwhile, webhook included, are kept)
  try {
    const file = JSON.parse(fs.readFileSync(CLAN_HISCORES_CONFIG_PATH, 'utf8'));
    const filePlan = planRosterSync(Array.isArray(file.members) ? file.members : [], roster.members);
    file.members = filePlan.members;
    writeJsonAtomic(CLAN_HISCORES_CONFIG_PATH, JSON.stringify(file, null, 2) + '\n', { backup: false });   // no .bak: the config holds the webhook
  } catch (e) { log('Clan hiscores: could not update the member list --', e.message || String(e)); return false; }
  cfg.members = plan.members;
  plan.removed.forEach((n) => { delete state.members[n]; if (state.lastPost && state.lastPost.members) delete state.lastPost.members[n]; });
  STATUS.clanHiscores.rosterSync = { at: Date.now(), added: plan.added, removed: plan.removed, members: plan.members.length };
  log('Clan hiscores: roster updated --', plan.added.length ? 'added ' + plan.added.join(', ') : 'nobody added', '/', plan.removed.length ? 'removed ' + plan.removed.join(', ') : 'nobody removed');
  return true;
}

// One lookup at a time (the scheduled poll and /sl hiscores check share the game socket and the state file). opts.dryRun: look up and report, never post, never move the post baseline.
let hiscoresPollBusy = false;
let hiscoresMisses = 0; // clan rank requests in a row the game did not answer (after the quiet retry); the scheduler tries again early while it is small
const HISCORES_EARLY_RETRY_MS = 3 * 60 * 1000, HISCORES_EARLY_RETRIES = 2;
async function pollClanHiscores(evalAwait, cfg, opts) {
  if (hiscoresPollBusy) return opts && opts.dryRun ? { error: 'A clan hiscores lookup is already running. Try again in a minute.' } : undefined;
  hiscoresPollBusy = true;
  try { return await pollClanHiscoresRun(evalAwait, cfg, opts); } finally { hiscoresPollBusy = false; }
}
async function pollClanHiscoresRun(evalAwait, cfg, opts) {
  const dry = !!(opts && opts.dryRun);
  STATUS.clanHiscores.lastPollAt = Date.now();
  const ready = await evalAwait(`window.__ccGameSocket ? window.__ccGameSocket.isReady() : false`, false).catch(() => false);
  STATUS.clanHiscores.wsHookReady = !!ready;
  if (!ready) {
    log('Clan hiscores: ws-hook not active yet (needs a game reload since it was installed) -- skipping this poll.');
    return dry ? { error: 'The game connection is not ready for lookups yet (reload the game page once).' } : undefined;
  }

  let myRank;
  // The server sometimes does not answer within 8 s (busy during a dungeon, or just after a reconnect / watcher restart).
  // One quiet retry with a longer wait before reporting a failure; the next poll tries again anyway.
  try {
    try {
      myRank = await evalAwait(`window.__ccGameSocket.request({type:'clan_hiscores_my_rank',data:{}}, 'clan_hiscores_my_rank', 8000)`, true);
    } catch (e1) {
      if (!/timeout/.test(String(e1 && e1.message || e1))) throw e1;
      await new Promise((r) => setTimeout(r, 4000));
      myRank = await evalAwait(`window.__ccGameSocket.request({type:'clan_hiscores_my_rank',data:{}}, 'clan_hiscores_my_rank', 15000)`, true);
    }
  } catch (e) {
    const msg = e.message || String(e);
    hiscoresMisses++;
    STATUS.clanHiscores.missedRounds = hiscoresMisses;
    // A server that does not answer is routine (~100 lines a day before): one line for the first miss, then every third round in a row, and one when it answers again.
    // Any other error is logged every time.
    if (!/timeout/.test(msg) || hiscoresMisses === 1 || hiscoresMisses % 3 === 0) log('Clan hiscores: request failed --', msg, hiscoresMisses > 1 ? '(' + hiscoresMisses + ' rounds in a row)' : '');
    return dry ? { error: 'The clan rank request failed or timed out. Try again in a minute.' } : undefined;
  }
  if (!myRank || typeof myRank.rank !== 'number') return dry ? { error: 'The game did not report a clan rank (not in a clan?).' } : undefined;
  if (hiscoresMisses) { log('Clan hiscores: the game answers again after', hiscoresMisses, 'missed round(s).'); hiscoresMisses = 0; STATUS.clanHiscores.missedRounds = 0; }
  STATUS.clanHiscores.lastClanRank = myRank.rank;

  const state = loadClanHiscoresState();
  await syncClanRoster(evalAwait, cfg, state);   // the member list follows the game's clan roster on every lookup
  const lastPost = state.lastPost; // baseline everything below diffs against -- NOT state.members, see loadClanHiscoresState's comment
  const memberChangesSincePost = [], seenMembers = [], notFound = [], failedLookups = [];

  for (const name of cfg.members || []) {
    // Hint for the SEARCH comes from the last POLL (state.members), kept
    // fresh every cycle regardless of posting -- cheap, and unrelated to
    // what gets announced.
    const hint = state.members[name] || {};
    let found = null, lookupError = null;
    try {
      found = await findMemberInHiscores(evalAwait, name, hint.page, hint.totalLevel);
    } catch (e) {
      lookupError = e.message || String(e);
      failedLookups.push({ name, error: lookupError });
    }
    if (!found) { if (!lookupError) log('Clan hiscores: could not locate member', JSON.stringify(name), 'in hiscores'); notFound.push(name); continue; }
    state.members[name] = { rank: found.rank, totalLevel: found.totalLevel, page: found.page };
    seenMembers.push({ name, rank: found.rank, totalLevel: found.totalLevel });

    // What to ANNOUNCE is diffed against the last POST, not the last poll
    // -- so a throttled/delayed post still shows the full change since
    // then, not just whatever happened to move in the most recent poll.
    const prevPost = lastPost ? lastPost.members[name] : null;
    if (prevPost && (found.totalLevel !== prevPost.totalLevel || found.rank !== prevPost.rank)) {
      memberChangesSincePost.push({ name, prevLevel: prevPost.totalLevel, level: found.totalLevel, prevRank: prevPost.rank, rank: found.rank });
    }
  }

  // One line per round for the members whose lookup failed (a hiscores page that did not answer), not two lines per member.
  if (failedLookups.length) {
    const errs = [...new Set(failedLookups.map((f) => f.error))];
    log('Clan hiscores: lookup failed for', failedLookups.map((f) => f.name).join(', '), '--', errs.join('; '));
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

  if (dry) {   // /sl hiscores check: the lookup is kept (state.members, STATUS), nothing is posted and lastPost stays as it is
    saveClanHiscoresState(state);
    log('Clan hiscores: manual check, rank', myRank.rank, '-- nothing posted');
    return { rank: myRank.rank, prevRank: lastPost && lastPost.clanRank != null ? lastPost.clanRank : null, members: seenMembers, notFound, hasBaseline: !!lastPost, changes: memberChangesSincePost.length + (rankChanged ? 1 : 0), wouldPost: shouldPost };
  }

  if (shouldPost) {
    let head;
    if (rankChanged) {
      const arrow = myRank.rank < lastPost.clanRank ? '📈' : '📉';
      head = `${arrow} **${cfg.clanTag || 'Clan'}** moved from clan rank **#${lastPost.clanRank}** to **#${myRank.rank}**${isMajor ? ' (major move)' : ''}`;
    } else {
      head = `📊 **${cfg.clanTag || 'Clan'}** update -- rank unchanged at **#${myRank.rank}**`;
    }
    if (memberChangesSincePost.length) head += '\n\n' + (rankChanged ? '**Reason**' : '**Changes**');
    // One block per member: name on its own line, then one line per change.
    // 🔼 = improvement (higher level, or a LOWER rank number), 🔽 = drop.
    const blocks = memberChangesSincePost.map((c) => {
      const ls = [`**${c.name}**`];
      if (c.prevLevel !== c.level) ls.push(`${c.level > c.prevLevel ? '🔼' : '🔽'} Total level ${formatNumber(c.prevLevel)} → ${formatNumber(c.level)}`);
      if (c.prevRank !== c.rank) ls.push(`${c.rank < c.prevRank ? '🔼' : '🔽'} Hiscores rank #${formatNumber(c.prevRank)} → #${formatNumber(c.rank)}`);
      return { name: c.name, text: ls.join('\n') };
    });
    // The baseline (state.lastPost) only moves forward for what Discord ACCEPTED: a failed post is simply announced again at the next poll.
    const progress = { at: lastPost.at, clanRank: lastPost.clanRank, members: Object.assign({}, lastPost.members) };
    const memberSnapshot = {};
    for (const name of cfg.members || []) {
      if (state.members[name]) memberSnapshot[name] = { rank: state.members[name].rank, totalLevel: state.members[name].totalLevel };
    }
    let delivered = true, detail = '';
    if (cfg.webhookUrl) {
      const chunks = chunkBlocks(blocks, { max: 1900, head });
      const dr = await deliverChunks(sender, 'hiscores', cfg.webhookUrl, chunks,
        (c, i) => ({ username: 'Clan Hi Scores', avatar_url: HISCORES_AVATAR_URL, content: (i ? '(continued)\n\n' : '') + c.text }),
        (c, i) => { if (i === 0) progress.clanRank = myRank.rank; c.blocks.forEach((b) => { if (memberSnapshot[b.name]) progress.members[b.name] = memberSnapshot[b.name]; }); });
      delivered = dr.ok;
      if (!dr.ok) detail = (dr.sent ? dr.sent + ' of ' + dr.total + ' message(s) went out; ' : '') + (dr.last && dr.last.error || 'unknown error');
    }
    if (delivered) {
      state.lastPost = { at: Date.now(), clanRank: myRank.rank, members: memberSnapshot };
      log(
        'Clan hiscores:',
        rankChanged ? `rank changed ${lastPost.clanRank} -> ${myRank.rank}${isMajor ? ' (major)' : ''}` : `rank unchanged at ${myRank.rank}`,
        '--', memberChangesSincePost.length, 'member change(s) -- posted'
      );
    } else {
      state.lastPost = progress;
      log('Clan hiscores: the update was NOT delivered (' + detail + ') -- it stays pending and is sent again at the next poll.');
    }
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
    writeJsonAtomic(CHAT_RELAY_CONFIG_PATH, file, { indent: 2, backup: false });
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
let perfLogAt = 0;
function logPerfSample(r) {
  if (Date.now() - perfLogAt < 55000) return;
  perfLogAt = Date.now();
  const m = r.metrics || {};
  const text = 'ScapeLite uses ' + r.scapelitePct + '% of the page (script ' + m.scriptPct + '%, layout ' + m.layoutPct + '%, style ' + m.stylePct + '%)';
  const data = { scapelitePct: r.scapelitePct, metrics: m, plugins: (r.plugins || []).slice(0, 8).map((x) => ({ id: x.id, pct: x.pct })) };
  if (SUPERVISED) { try { process.send({ type: 'logbatch', entries: [{ t: Date.now(), ch: 'Perf', lv: 'info', m: text, d: data }], dropped: 0 }); } catch (e) { /* supervisor gone */ } }
  else logstore.ingest([{ t: Date.now(), ch: 'Perf', lv: 'info', m: text, d: data }]);
}
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
  // One line per package, not per file: everything that is part of ScapeLite Core (lifecycle, kit, scale, panel tools, anchoring, hover info ...) is one entry,
  // so the list names things the way the Plugins tab does and a Core internal never looks like a plugin of its own.
  const pkg = {};
  Object.keys(per).forEach((id) => { const d = plugins.find((p) => p.id === id), key = d && d.core ? 'core' : id; (pkg[key] = pkg[key] || { id: key, label: key === 'core' ? 'ScapeLite Core' : labelOf(id), v: 0 }).v += per[id]; });
  const list = Object.values(pkg).map((x) => ({ id: x.id, label: x.label, pct: pct(x.v) })).sort((a, b) => b.pct - a.pct);
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
// Plugins-tab keys: logsEnabled, logsKeepDays, logsHistoryDays, logsLevel, logsMaxMB, logsStructured, and one toggle per page-fed channel.
const LOG_CHANNEL_TOGGLES = { Tasks: 'logsTasks', Fortress: 'logsFortress', Drops: 'logsDrops', Alerts: 'logsAlerts', Perf: 'logsPerf', Discord: 'logsDiscord' };
async function syncLogSettings(evalAwait) {
  const keys = ['logsEnabled', 'logsKeepDays', 'logsHistoryDays', 'logsLevel', 'logsMaxMB', 'logsStructured'].concat(Object.values(LOG_CHANNEL_TOGGLES));
  let v = null;
  try { v = await evalAwait(`window.${PLUGINS_NS} ? ({ ${keys.map((k, i) => 'k' + i + ': window.' + PLUGINS_NS + '.get(' + JSON.stringify(k) + ')').join(', ')} }) : null`, false); } catch (e) { return; }
  if (!v) return;
  const g = (k) => v['k' + keys.indexOf(k)];
  const patch = {};
  const numeric = (k) => (g(k) !== '' && g(k) != null && Number.isFinite(Number(g(k))) ? Number(g(k)) : undefined);
  if (typeof g('logsEnabled') === 'boolean') patch.enabled = g('logsEnabled');
  if (numeric('logsKeepDays') !== undefined) patch.keepDays = numeric('logsKeepDays');
  if (numeric('logsHistoryDays') !== undefined) patch.historyDays = numeric('logsHistoryDays');
  if (typeof g('logsLevel') === 'string') patch.level = g('logsLevel');
  if (numeric('logsMaxMB') !== undefined) patch.maxTotalMB = numeric('logsMaxMB');
  if (typeof g('logsStructured') === 'boolean') patch.structured = g('logsStructured');
  patch.channels = {};
  for (const ch of Object.keys(LOG_CHANNEL_TOGGLES)) { const t = g(LOG_CHANNEL_TOGGLES[ch]); if (typeof t === 'boolean') patch.channels[ch] = { enabled: t }; }
  const cur = logstore.config();
  const chans = Object.assign({}, cur.channels);
  for (const c of Object.keys(patch.channels)) chans[c] = Object.assign({}, cur.channels[c], patch.channels[c]);
  const next = logstore.normalize(Object.assign({}, cur, patch, { channels: chans }));
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  try {
    logstore.saveConfig(patch);
    log('Log settings: ' + (next.enabled ? 'saving logs (level ' + next.level + ', diagnostics ' + next.keepDays + ' day(s), history ' + next.historyDays + ' day(s))' : 'saving logs is OFF'));
    if (SUPERVISED) { try { process.send({ type: 'logcmd', cmd: 'prune' }); } catch (e) { /* supervisor gone */ } } else logstore.prune();
  } catch (e) { log('ERROR: could not save log settings --', e.message); }
}

// --- In-game plugin log lines (window.__ccLog, overlay/log-client.js) -> the logging core ----------------------
// Drained over the existing DevTools connection every few seconds. Supervised: forwarded to the supervisor, which owns
// the files. Standalone: written directly.
let logDrainBusy = false;
async function drainPageLogs(evalAwait) {
  if (logDrainBusy) return 0;
  logDrainBusy = true;
  let total = 0;
  try {
    const req = await evalAwait('(() => { const r = window.__ccLogReq || null; window.__ccLogReq = null; return r; })()', false);
    if (req === 'open') {
      try { await fetch('http://127.0.0.1:' + STATUS_SERVER_PORT + '/api/logs/open', { method: 'POST', headers: { 'x-cc-control': '1', 'content-type': 'application/json' }, body: '{}' }); } catch (e) { log('Open logs folder request failed --', e.message); }
    }
    for (let i = 0; i < 5; i++) {
      const r = await evalAwait('window.__ccLog && window.__ccLog.drain ? window.__ccLog.drain(400) : null', false);
      if (!r || !Array.isArray(r.entries)) break;
      if (r.entries.length || r.dropped) forwardPageLogs(r.entries, r.dropped);
      total += r.entries.length;
      if (!r.left) break;
    }
  } catch (e) { /* page busy or reloading */ }
  finally { logDrainBusy = false; }
  return total;
}
// --- Task Option Log (window.__ccOptionLog, overlay/option-log.js) -> State/option-log.json --------------------
// The page only collects finished rows; they are taken over here and appended (deduplicated, capped, atomic write). A failed write keeps the rows for the next try.
let optionLogBusy = false, optionLogRetry = [];
async function drainOptionLog(evalAwait) {
  if (optionLogBusy) return 0;
  optionLogBusy = true;
  let total = 0;
  try {
    for (let i = 0; i < 5; i++) {
      const r = await evalAwait('window.__ccOptionLog && window.__ccOptionLog.drain ? window.__ccOptionLog.drain(200) : null', false);
      if (!r || !Array.isArray(r.rows)) break;
      optionLogRetry = optionLogRetry.concat(r.rows); total += r.rows.length;
      if (!r.left) break;
    }
    if (optionLogRetry.length) {
      optionLog.ingest(optionLogRetry);
      try { optionLog.save(); optionLogRetry = []; } catch (e) { log('Task option log: could not write State/option-log.json --', e.message); if (optionLogRetry.length > 2000) optionLogRetry = optionLogRetry.slice(-2000); }
    }
  } catch (e) { /* page busy or reloading */ }
  finally { optionLogBusy = false; }
  return total;
}
function forwardPageLogs(entries, dropped) {
  if (SUPERVISED) { try { process.send({ type: 'logbatch', entries, dropped: dropped || 0 }); } catch (e) { /* supervisor gone */ } }
  else logstore.ingest(entries, { dropped });
}

// One-time recovery: if this browser profile lost its Task Log (site data cleared), refill it from Logs/Tasks/*.jsonl.
async function recoverTaskLog(evalAwait) {
  try {
    const n = await evalAwait('window.__ccTaskLog && window.__ccTaskLog.log ? window.__ccTaskLog.log().length : -1', false);
    if (n !== 0) return;
    const recs = logstore.reader.taskRecords();
    if (!recs.length) return;
    const got = await evalAwait(`window.__ccTaskLog && window.__ccTaskLog.restore ? window.__ccTaskLog.restore(${JSON.stringify(recs.slice(-2500))}) : -1`, false);
    if (got > 0) log('Task Log: restored ' + got + ' task record(s) from the log files (the browser copy was empty).');
  } catch (e) { /* task log not loaded yet */ }
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
  relayLeaseWebhook: { file: CHAT_RELAY_CONFIG_PATH, example: 'chat-relay-config.example.json', at: ['leaseWebhookUrl'], label: 'Shared lease webhook' },
  hiscoresWebhook: { file: CLAN_HISCORES_CONFIG_PATH, example: 'clan-hiscores-config.example.json', at: ['webhookUrl'], label: 'Clan hiscores webhook' },
  raidSummaryWebhook: { file: RAID_SUMMARY_CONFIG_PATH, example: 'raid-summary-config.example.json', at: ['webhookUrl'], label: 'Raid summary webhook' },
  digestWebhook: { file: DIGEST_CONFIG_PATH, example: 'digest-config.example.json', at: ['webhookUrl'], label: 'Activity digest webhook' },
  boardWebhook: { file: CLAN_BOARD_CONFIG_PATH, example: 'clan-board-config.example.json', at: ['webhookUrl'], label: 'Clan board webhook' },
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
  writeJsonAtomic(def.file, JSON.stringify(cfg, null, 2), { backup: false });   // no .bak: these configs hold webhooks
}
// --- Team settings sync (overlay/team-sync.js + team-sync-host.js, docs/DISCORD-TEAM-SYNC.md) -----------------------------------------
// The wizard's "Team settings" page hands requests over (window.__ccDiscordSetup.take().team); the host publishes to / gathers from the lease webhook. Settings of the Plugins tab
// are written through the page (teamApply, a fixed list of keys), the rest into the private config files. Webhook addresses only when the person asked for them by name.
const TEAM_STATE_PATH = P.runtime('team-sync-state.json');   // { lastVer, undo }: the undo copy can hold webhook addresses, so it lives in State/ (never packaged)
const TEAM_OPS = ['status', 'preview', 'publish', 'export', 'gather', 'import', 'apply', 'undo'];
let teamEval = null;   // the page connection of the moment, set by the loop that serves the wizard
const teamCfg = (file, example) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, example), 'utf8')) || {}; } catch (e2) { return {}; } } };
const teamHost = createTeamHost({
  lease: () => (leaseMgr.configured() ? leaseMgr.forWebhook() : null),
  name: () => ownPlayerName,
  log: (t) => log(t),
  getPlugin: async () => { if (!teamEval) throw new Error('The game is not connected.'); return (await teamEval('window.' + PLUGINS_NS + ' ? window.' + PLUGINS_NS + '.getAll() : {}', false)) || {}; },
  applyPlugin: async (patch) => { if (!teamEval) throw new Error('The game is not connected.'); await teamEval('window.' + PLUGINS_NS + '.teamApply(' + JSON.stringify(patch) + ')', false); },
  readFiles: () => {
    const h = teamCfg(CLAN_HISCORES_CONFIG_PATH, 'clan-hiscores-config.example.json'), c = teamCfg(CHAT_RELAY_CONFIG_PATH, 'chat-relay-config.example.json');
    return { clanTag: String(h.clanTag || ''), clanMembers: Array.isArray(h.members) ? h.members : [], ultraRareKeywords: Array.isArray(c.ultraRareKeywords) ? c.ultraRareKeywords : [] };
  },
  writeFiles: (patch) => {
    if (patch.clanTag !== undefined || patch.clanMembers !== undefined) {
      const h = teamCfg(CLAN_HISCORES_CONFIG_PATH, 'clan-hiscores-config.example.json');
      if (patch.clanTag !== undefined) h.clanTag = patch.clanTag;
      if (patch.clanMembers !== undefined) h.members = patch.clanMembers;
      writeJsonAtomic(CLAN_HISCORES_CONFIG_PATH, JSON.stringify(h, null, 2) + '\n', { backup: false });
    }
    if (patch.ultraRareKeywords !== undefined) {
      const c = teamCfg(CHAT_RELAY_CONFIG_PATH, 'chat-relay-config.example.json');
      c.ultraRareKeywords = patch.ultraRareKeywords;
      writeJsonAtomic(CHAT_RELAY_CONFIG_PATH, JSON.stringify(c, null, 2) + '\n', { backup: false });
    }
  },
  readSecrets: () => currentSecrets(),
  writeSecrets: (patch) => {
    for (const k of Object.keys(patch)) { const def = SECRET_FIELDS[k]; if (def && k !== 'relayLeaseWebhook') writeSecretValue(def, String(patch[k] || '')); }
    discordUrlCache.at = 0;
    if (teamEval) teamEval('window.' + PLUGINS_NS + ' && window.' + PLUGINS_NS + '.seedSecrets && window.' + PLUGINS_NS + '.seedSecrets(' + JSON.stringify(patch) + ')', false).catch(() => {});
  },
  load: () => readJsonRecover(TEAM_STATE_PATH, {}),
  save: (st) => writeJsonAtomic(TEAM_STATE_PATH, st, { backup: false }),
});
function currentSecrets() {
  const out = {};
  for (const k of Object.keys(SECRET_FIELDS)) out[k] = readSecretValue(SECRET_FIELDS[k]);
  return out;
}
// The "Reload ScapeLite" button in the status tooltip leaves window.__ccReloadRequest; restart the watcher (re-injects every plugin) when it is set.
let reloadBusy = false;
async function handleReloadRequest(evalAwait) {
  if (reloadBusy) return;
  let t = 0;
  try { t = await evalAwait('(() => { const t = window.__ccReloadRequest || 0; window.__ccReloadRequest = 0; return t; })()', false); } catch (e) { return; }
  if (!t) return;
  reloadBusy = true;
  log('Reload requested from the status tooltip: restarting the watcher.');
  try { await fetch('http://127.0.0.1:7777/api/watcher/restart', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-control': '1' }, body: '{}' }); } catch (e) { log('ERROR: could not request the restart --', e.message); }
  setTimeout(() => { reloadBusy = false; }, 15000);
}
// Chat commands (/sl ...): chat-commands.js leaves records in window.__ccCmdBox; they run through the allowlisted host (overlay/chat-commands-watcher.js) and each reply is handed back to the page.
let cmdHost = null;
async function hiscoresCheckNow() {
  const conn = activeConn;
  if (!conn) return { error: 'The game is not connected.' };
  const rawCfg = loadClanHiscoresConfig();
  if (!rawCfg || !Array.isArray(rawCfg.members) || !rawCfg.members.length) return { error: 'No clan hiscores members are set up.' };
  const plugin = await conn.evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
  return pollClanHiscores(conn.evalAwait, applyPluginOverridesToHiscoresCfg(rawCfg, plugin), { dryRun: true });
}
function commandHost() {
  if (cmdHost) return cmdHost;
  cmdHost = createCommandHost({ log, handlers: createHandlers({
    status: () => STATUS, version: SL_VERSION, pluginDefs: PLUGIN_DEFS, setPluginEnabled,
    relayRole: () => relayRole, outbox: () => relay.outbox(),
    digest: { buffer: () => digestBuffer, build: buildDigestBlocks, chunk: chunkBlocks, head: digestHead, config: () => applyPluginOverridesToDigestCfg(loadDigestConfig(), null) },
    hiscoresCheck: hiscoresCheckNow,
  }) });
  return cmdHost;
}
async function handleCommandRequests(evalAwait) {
  let recs = null;
  try { recs = await evalAwait('(() => { const b = window.__ccCmdBox; return Array.isArray(b) && b.length ? b.splice(0, 20) : null; })()', false); } catch (e) { return; }
  if (!Array.isArray(recs) || !recs.length) return;
  const write = (rep) => evalAwait('window.__ccCmdReply && window.__ccCmdReply(' + JSON.stringify(rep) + ')', false);   // lines and names are already cleaned by the host
  await commandHost().process(recs, write).catch(() => {});
}
// The Discord setup wizard (overlay/discord-setup.js): hands over its Test requests and gets the state of every channel back. Only feature ids from DISCORD_FEATURES are
// accepted (no address ever travels from the page), and discordTest allows one message per channel every 10 s. While the wizard is closed, nothing is sent to the page.
async function serveDiscordSetup(evalAwait) {
  teamEval = evalAwait;
  let got = null;
  try { got = await evalAwait("(() => { const w = window.__ccDiscordSetup; return w && w.take ? w.take() : null; })()", false); } catch (e) { return; }
  if (!got || typeof got !== 'object') return;
  if (Array.isArray(got.tests) && got.tests.length) { await collectSecrets(evalAwait); discordUrlCache.at = 0; }   // a webhook saved a moment ago is on disk before it is tested
  for (const t of Array.isArray(got.tests) ? got.tests.slice(0, 5) : []) {
    const id = t && typeof t.id === 'string' ? t.id : '';
    if (!DISCORD_FEATURES.some((f) => f.id === id)) continue;
    const r = await discordTest(id).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    try { await evalAwait('window.__ccDiscordSetup && window.__ccDiscordSetup.result(' + JSON.stringify(id) + ', ' + JSON.stringify({ ok: !!r.ok, error: String(r.error || '').slice(0, 160) }) + ')', false); } catch (e) { /* page gone */ }
  }
  for (const t of Array.isArray(got.team) ? got.team.slice(0, 3) : []) {   // Team settings page: only the listed operations, arguments are plain data
    const id = t && typeof t.id === 'string' ? t.id.slice(0, 40) : '', op = t && typeof t.op === 'string' ? t.op : '';
    if (!id || TEAM_OPS.indexOf(op) < 0) continue;
    const r = await teamHost.handle(op, t.args && typeof t.args === 'object' ? t.args : {});
    try { await evalAwait('window.__ccDiscordSetup && window.__ccDiscordSetup.teamResult(' + JSON.stringify(id) + ', ' + JSON.stringify(r) + ')', false); } catch (e) { /* page gone */ }
  }
  if (got.want || (got.tests && got.tests.length)) {
    discordUrlCache.at = 0;   // look at the saved addresses again now: the wizard has just saved one
    const features = discordHealth().features.map((f) => ({ id: f.id, configured: !!f.configured, lastOkAt: f.lastOkAt || null, lastErrorAt: f.lastErrorAt || null, sent: f.sent || 0, failed: f.failed || 0,
      lastError: f.lastError ? String(f.lastError).replace(/https?:\/\/\S+/gi, '[link hidden]').slice(0, 160) : null }));   // no address and nothing else leaves this file
    try { await evalAwait('window.__ccDiscordSetup && window.__ccDiscordSetup.setState(' + JSON.stringify({ features }) + ')', false); } catch (e) { /* page gone */ }
  }
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
    logsHistoryDays: logstore.config().historyDays,
    logsLevel: logstore.config().level,
    logsMaxMB: logstore.config().maxTotalMB,
    logsStructured: logstore.config().structured,
    logsTasks: logstore.channelEnabled('Tasks'), logsFortress: logstore.channelEnabled('Fortress'), logsDrops: logstore.channelEnabled('Drops'), logsAlerts: logstore.channelEnabled('Alerts'), logsPerf: logstore.channelEnabled('Perf'), logsDiscord: logstore.channelEnabled('Discord'),
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
    let leaseTimer = null;
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
          functionDeclaration: 'function(){var G=null,D=null,Y=null,C=null,E=null,U=null,M=null,S=null,Q=null,W=null;for(var i=0;i<this.length&&!(G&&D&&Y&&C&&E&&U&&M&&S&&Q&&W);i++){var x=this[i];try{if(!W&&x&&x._masterMobCards&&typeof x._currentMaster===\"function\"&&typeof x._groupEncountersByTier===\"function\")W=x;if(!Q&&x&&typeof x._attachDragHandle===\"function\"&&typeof x._computeQueueSig===\"function\")Q=x;if(!S&&x&&x.individualSkillCredits&&"totalSkillCredits" in x&&typeof x._resetAllSkillWeightLevers==="function")S=x;if(!M&&x&&typeof x._onXPToggleClick===\"function\"&&\"_loadoutStyle\" in x)M=x;if(!U&&x&&x.CALC_URL&&typeof x.buildSnapshot===\"function\")U=x;if(!E&&x&&typeof x.onMobDeath==="function"&&Array.isArray(x._mobs)&&"_playerUnit" in x)E=x;if(!C&&x&&typeof x._soloFilter==="function"&&x.SEND_CHANNELS)C=x;if(!G&&x&&typeof x._estimateActionDuration==="function"&&x.skills)G=x;else if(!D&&x&&typeof x._projectOpt==="function")D=x;else if(!Y&&x&&typeof x.actionDurationFinal==="function"&&x.MIN_ACTION_DURATION)Y=x}catch(e){}}if(!G||!D)return false;(' + src + ')(G,D,Y,C,E,U,M,S,Q,W);return true}',
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
      if (leaseTimer) { clearInterval(leaseTimer); leaseTimer = null; leaseMgr.releaseAll().catch(() => {}); }   // game closed: this PC cannot see the chat any more, so it must not stay the relay
    }

    // Catch-up safety net, run on every (re)connect: the page collector can miss
    // events (page reload while the watcher was down, a hard kill ...). The
    // game's recent chat history is still in the DOM, so compare it with what was
    // actually relayed and send ONLY events that came after the last relayed one
    // (older unrelayed ones were filtered/skipped on purpose and are never
    // dumped). Duplicates are impossible: relayedKeys + the outbox are checked.
    async function catchUpRelay() {
      const cfg = loadChatRelayConfig();
      if (!cfg || !cfg.channels || relay.relayedCount() === 0) return;
      const raw = await evalAwait("window.__ccChatRelay && window.__ccChatRelay.rescan ? JSON.stringify(window.__ccChatRelay.rescan()) : '[]'", false).catch(() => '[]');
      let events = [];
      try { events = JSON.parse(raw || '[]'); } catch (e) { events = []; }
      if (!Array.isArray(events) || !events.length) return;
      let last = -1;
      const seenKeys = relay.relayedKeys();
      events.forEach((e, i) => { if (seenKeys.has(RelayEvents.rawKey(e))) last = i; });
      const queued = new Set(); relay.outbox().forEach((x) => (x.rawKeys || []).forEach((k) => queued.add(k)));
      const missed = events.slice(last + 1).filter((e) => !seenKeys.has(RelayEvents.rawKey(e)) && !queued.has(RelayEvents.rawKey(e)));
      if (!missed.length) return;
      log(`Relay catch-up: ${missed.length} event(s) from the game's chat history were never relayed -- sending now`);
      const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
      const eff = applyPluginOverridesToChatCfg(cfg, plugin);
      const stamped = missed.map((e, i) => Object.assign({ id: 'catchup-' + Date.now() + '-' + i, queuedAt: Date.now() }, e));
      await ingestDrained(stamped, eff);
    }

    function startChatRelayPolling() {
      stopChatRelayPolling();
      leaseMgr.resumeAll();
      let leasePaused = false;
      leaseTimer = setInterval(() => {
        // "Always" / "Never" post: this PC takes no part in the lease, and must not sit on a leadership that keeps the others from relaying
        if (relayRole !== 'auto') { if (!leasePaused) { leasePaused = true; leaseMgr.releaseAll().catch(() => {}); } return; }
        if (leasePaused) { leasePaused = false; leaseMgr.resumeAll(); }
        leaseMgr.tickAll().then(noteNewerVersion).catch(() => {});
      }, 3000);
      chatRelayTimer = setInterval(async () => {
        const cfg = loadChatRelayConfig(); // re-read each tick so config edits take effect live
        if (!cfg || !cfg.channels) return;
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const effectiveCfg = applyPluginOverridesToChatCfg(cfg, plugin);
        if (plugin) setRelayRole(plugin.relayRole);
        if (plugin) { teamEval = evalAwait; teamHost.tick(!!plugin.teamAutoSync).catch((e) => log('Team settings: automatic sync failed --', String(e && e.message || e).slice(0, 120))); }
        // the in-game name is looked at again every 30 s (and until it is known): it shows on the lease message as "leader <name>", so a name read once too early, or from before a character switch, must not stay
        if (!ownPlayerName || Date.now() - ownNameAt > 30000) { ownNameAt = Date.now(); try { const nm = String(await evalAwait("(document.querySelector('.ingame-hud-name') || {}).textContent || ''", false) || '').trim().slice(0, 24); if (nm && nm !== ownPlayerName) { if (ownPlayerName) log('Relay lease: the in-game name changed from ' + ownPlayerName + ' to ' + nm + ', the lease message follows at the next heartbeat.'); ownPlayerName = nm; } } catch (e) { /* page not ready */ } }
        ensureLeases();
        { const dgc = loadDigestConfig(); if (dgc && dgc.enabled && dgc.webhookUrl && relayRole === 'auto' && relayGate(dgc.webhookUrl) === 'standby') syncDigestWithLease(dgc.webhookUrl); }
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
        let polled = false;
        const rawCfg = loadClanHiscoresConfig();
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const cfg = applyPluginOverridesToHiscoresCfg(rawCfg, plugin);
        if (cfg && cfg.enabled && cfg.webhookUrl && Array.isArray(cfg.members) && cfg.members.length && relayGate(cfg.webhookUrl) !== 'send') {
          log('Clan hiscores: another ScapeLite instance posts the clan rank for this channel (or the shared lease cannot be read yet) -- not polling from this PC.');
        } else if (cfg && cfg.enabled && cfg.webhookUrl && Array.isArray(cfg.members) && cfg.members.length) {
          try {
            await pollClanHiscores(evalAwait, cfg);
          } catch (e) {
            log('Clan hiscores: poll error --', e.message || String(e));
          }
          polled = true;
        }
        const intervalMs = Math.max(5, (cfg && cfg.pollMinutes) || 20) * 60 * 1000;
        // The game did not answer: look again in a few minutes (twice at most) instead of leaving a 20-minute hole.
        scheduleClanHiscoresPoll(polled && hiscoresMisses > 0 && hiscoresMisses <= HISCORES_EARLY_RETRIES ? Math.min(HISCORES_EARLY_RETRY_MS, intervalMs) : intervalMs);
      }, delayMs);
    }

    function stopRaidSummaryPolling() {
      if (raidSummaryTimer) { clearInterval(raidSummaryTimer); raidSummaryTimer = null; }
    }

    function startRaidSummaryPolling() {
      stopRaidSummaryPolling();
      raidSummaryTimer = setInterval(() => {
        if (raidTickBusy) return;
        raidTickBusy = true;
        raidSummaryTick().catch((e) => log('Raid summary: error --', e.message || String(e))).finally(() => { raidTickBusy = false; });
      }, RAID_SUMMARY_POLL_MS);
      async function raidSummaryTick() {
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
          await flushRaidPending(cfg);
          return; // ws-hook not active yet (needs a game reload) -- same as clan hiscores, just skip this tick
        }
        if (!Array.isArray(entries)) entries = [];
        let ended = [];
        try { ended = await evalAwait('(window.__ccEndedRuns || []).splice(0)', false); } catch (e) { ended = []; }
        // A run the game socket already reported (a finished raid / dungeon) is not posted a second time from the ended-run memory.
        if (Array.isArray(ended)) ended.forEach((en) => { if (!entries.some((x) => x.kind === 'dungeon' && Math.abs((x.ts || 0) - (en.ts || 0)) < 120000)) entries.push(en); });
        if (!entries.length) { await flushRaidPending(cfg); return; }
        const lobby = await evalAwait('window.__ccLastLobby || null', false).catch(() => null);
        for (const entry of entries) {
          // The roster the socket saw is the party at the end; the bridge's last lobby sample says who in it is a guild mate.
          const fresh = lobby && entry.ts && Math.abs(entry.ts - lobby.at) < 20 * 60 * 1000 ? lobby : null;
          entry.guildCount = fresh ? fresh.guild : 0;
          const size = Math.max(entry.memberCount || 0, fresh ? fresh.size : 0);
          entry.memberCount = size;
          const verdict = evaluateRaidSummaryRules(plugin, { kind: entry.kind || 'raid', size, guild: entry.guildCount, wave: entry.wave });
          STATUS.raidSummary.lastDecision = `${entry.raidName}${entry.wave ? ' wave ' + entry.wave : ''}: ${verdict.post ? 'posted' : 'not posted'} (${verdict.why}; ${size} in party, ${entry.guildCount} guild)`;
          if (!verdict.post) {
            log(`Raid summary: not posting ${entry.raidName} (${verdict.why}) --`, `${size} in party, ${entry.guildCount} guild`);
            STATUS.raidSummary.totalSkippedSolo += 1;
            continue;
          }
          raidPending.push({ entry, firstAt: Date.now(), tries: 0, nextAt: 0 });   // kept on disk until Discord accepted it
          saveRaidPending();
        }
        await flushRaidPending(cfg);
      }
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
        writeJsonAtomic(DIGEST_CONFIG_PATH, JSON.stringify(cfg, null, 2), { backup: false });
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
        let digestFailed = false, digestWait = false;
        const digestGate = cfg && cfg.enabled && cfg.webhookUrl ? relayGate(cfg.webhookUrl) : 'send';
        if (digestGate === 'standby') { syncDigestWithLease(cfg.webhookUrl); log('Activity digest: another ScapeLite instance posts the digest for this channel -- not posting from this PC.'); }
        else if (digestGate === 'unsure') { digestWait = true; log('Activity digest: the shared relay lease cannot be read yet -- waiting before posting.'); }
        else if (cfg && cfg.enabled && cfg.webhookUrl) {
          // The buffer is only emptied for what Discord has ACCEPTED: a failed or half-delivered digest keeps the rest and is retried soon.
          const blocks = buildDigestBlocks(digestBuffer);
          const payload = blocks.length ? { blocks } : null;
          if (payload) {
            const chunks = chunkBlocks(blocks, { max: 1900, head: digestHead(digestBuffer) });
            const dr = await deliverChunks(sender, 'digest', cfg.webhookUrl, chunks,
              (c, i) => ({ username: 'Activity Digest', content: (i ? '📋 **Activity Digest** -- continued\n\n' : '') + c.text }),
              (c) => { c.blocks.forEach((b) => subtractDigestSnapshot(digestBuffer, b.name, b.snap)); saveDigestBuffer(digestBuffer); });
            if (!dr.ok) {
              digestFailed = true;
              log('Activity digest: NOT delivered (' + dr.sent + ' of ' + dr.total + ' message(s) accepted: ' + (dr.last && dr.last.error || 'unknown error') + ') -- the activity stays in the buffer, trying again soon.');
            } else {
            STATUS.digest.lastPostAt = Date.now();
            STATUS.digest.totalPosted += 1;
            log('  -> activity digest posted,', blocks.length, 'player(s) with activity,', chunks.length, 'message(s)');
            // Reset the reporting window (sinceAt/players) but deliberately
            // KEEP seenKeys/digestSeenKeys across the flush -- that dedup
            // guards against restart+DOM-rebuild re-drains independent of
            // the reporting period, so wiping it here would reopen the
            // exact duplicate-counting window it exists to close (a
            // message seen just before this post, then re-drained just
            // after, would otherwise look "new" again for the next period).
            const dgAt = Date.now();
            if (relayRole === 'auto') { const l = leaseMgr.forWebhook(cfg.webhookUrl); if (l) l.setShared({ dg: dgAt }); }   // followers empty their copy when they see this
            digestBuffer = { sinceAt: dgAt, players: {}, seenKeys: digestBuffer.seenKeys, lastDg: dgAt };
            saveDigestBuffer(digestBuffer);
            }
          } else {
            log('Activity digest: nothing notable since last digest -- skipped.');
          }
        }
        const intervalMs = Math.max(1, (cfg && cfg.intervalHours) || 6) * 3600000;
        scheduleDigestPost(digestWait ? 120000 : digestFailed ? Math.min(10 * 60000, nextDigestDelay(cfg, intervalMs)) : nextDigestDelay(cfg, intervalMs));
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
      activeConn.drainLogs = () => drainPageLogs(evalAwait);
      activeConn.flushRelay = async () => {
        await drainPageLogs(evalAwait);
        const cfg = loadChatRelayConfig();
        const plugin = await evalAwait(`window.${PLUGINS_NS} ? window.${PLUGINS_NS}.getAll() : null`, false).catch(() => null);
        const eff = cfg && cfg.channels ? applyPluginOverridesToChatCfg(cfg, plugin) : null;
        const raw = await evalAwait("window.__ccChatRelay ? JSON.stringify(window.__ccChatRelay.drain()) : '[]'", false).catch(() => '[]');
        let events = [];
        try { events = JSON.parse(raw || '[]'); } catch (e) { events = []; }
        if (Array.isArray(events) && events.length) { const typed = relay.typed(events); accumulateForDigest(typed); relay.enqueue(typed); }
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
      secretsTimer = setInterval(() => { global.__wdLoopAt = Date.now(); handleReloadRequest(evalAwait); collectSecrets(evalAwait); serveDiscordSetup(evalAwait); syncDigestTimes(); handleUpdateRequest(evalAwait); handleCommandRequests(evalAwait); syncLogSettings(evalAwait); drainPageLogs(evalAwait); drainOptionLog(evalAwait); }, 3000);
      setTimeout(() => recoverTaskLog(evalAwait), 20000);
      if (perfTimer) clearInterval(perfTimer);
      perfTimer = setInterval(async () => {
        if (perfBusy) return;
        let want = false;
        try { want = !!(await evalAwait('!!(window.__ccStatusIndicator && window.__ccStatusIndicator.wantPerf && window.__ccStatusIndicator.wantPerf())', false)); } catch (e) { /* page busy */ }
        if (Date.now() - perfLast < (want ? 4000 : 60000)) return;
        perfBusy = true;
        try { const r = await perfBurst(call, 3000, STATUS.plugins || []); if (r) { STATUS.perf = r; logPerfSample(r); } } catch (e) { if (!perfWarned) { perfWarned = true; log('Performance sampling failed:', e.message); } }
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
          // typed once; the digest takes every event (even with live Discord posts turned off), the relay takes what its channel settings and the lease allow
          ingestDrained(events, cfg);
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
  STATE_MOVE.notes.forEach((n) => log('State folder:', n));
  refreshPluginStatus();
  // Heartbeat for the tray watchdog (docs/WATCHDOG.md): a tiny file touched every 30 s; loopAt = last tick of the 3 s page loop, so "alive but loops stopped" is visible.
  { const wd = require('./watchdog'), hbFile = P.state(wd.HEARTBEAT_FILE); const hb = () => wd.beat(hbFile, { cdp: !!STATUS.cdp.connected, loopAt: global.__wdLoopAt || 0 }); hb(); setInterval(hb, wd.HEARTBEAT_EVERY_MS); }
  if (SUPERVISED) {
    // The supervisor hosts the dashboard; push it our state and take its commands.
    setInterval(() => { try { process.send({ type: 'status', status: Object.assign({}, STATUS, { recentLog: undefined }) }); } catch (e) {} }, 1000);
    process.on('message', async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'shutdown') { gracefulShutdown('stop requested'); return; }
      if (m.type === 'discord-test') {
        const r = await discordTest(String(m.feature || '')).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
        try { process.send({ type: 'reply', reqId: m.reqId, result: r }); } catch (e) {}
        return;
      }
      if (m.type === 'plugin') {
        const r = await setPluginEnabled(m.id, !!m.enabled).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
        try { process.send({ type: 'reply', reqId: m.reqId, result: r }); } catch (e) {}
      }
    });
    process.on('disconnect', () => process.exit(0)); // supervisor died -- don't linger as an orphan
    log('Running under the supervisor (dashboard + Stop/Start/Restart are served by it).');
  } else {
    startStatusServer(STATUS_SERVER_PORT, () => STATUS, { plugin: setPluginEnabled, discordTest });
    log(`Status dashboard: http://${STATUS_SERVER_FRIENDLY_HOST}/ (or http://localhost:${STATUS_SERVER_PORT}/ if port 80 wasn't free)`);
  }
  relay.load();
  log(`Chat relay: loaded ${relay.relayedCount()} previously-relayed message key(s) and ${relay.outbox().length} pending event(s) from disk. Instance ${leaseMgr.instanceId}.`);
  loadRaidPending();
  setTimeout(() => { boardTick(); setInterval(boardTick, 15000); }, 20000);
  if (raidPending.length) log(`Raid summary: ${raidPending.length} finished run(s) still waiting to be posted from the last session.`);
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
