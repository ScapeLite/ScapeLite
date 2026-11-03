// Scapewatch supervisor. Long-lived parent of the watcher: it hosts the
// dashboard (http://scapelite.localhost/) and forks
// panel-resize-watcher.js as a child, so the dashboard's Stop / Start /
// Restart buttons keep working even while the watcher itself is down (the
// dashboard can't live inside the process it's supposed to stop).
//
// Launched by overlay/start-watcher-hidden.vbs (put a shortcut to that file in
// the Startup folder). Plain `node panel-resize-watcher.js` still works on its
// own (it then serves its own dashboard, without the process controls).
//
// The child talks over IPC: {type:'status'} snapshots every second, {type:'log'}
// lines as they happen, {type:'reply'} answers to our {type:'plugin'} commands.
// Logs are kept here (not in the child) so they survive watcher restarts.

'use strict';

const path = require('path');
const { fork } = require('child_process');
const { startStatusServer } = require('./status-server');
const logstore = require('./logstore');
const P = require('./paths');
// First run: hollow per-user configs from the shipped templates (never overwrites an existing file; see first-run.js).
try { require('./first-run').ensureUserConfigs((t) => console.log('[supervisor] ' + t)); } catch (e) { console.log('[supervisor] first-run setup failed: ' + e.message); }
// One supervisor only: a second one would run a second watcher and double every Discord post. It leaves before it starts anything.
{ const lock = require('./single-instance').acquire('supervisor', { waitMs: 4000 });
  if (!lock.ok) { console.log('[supervisor] another supervisor is already running (pid ' + lock.owner + '): this copy exits.'); process.exit(0); } }
const launcher = require('./launcher');
const gamedata = require('./gamedata');

const WATCHER_PATH = path.join(__dirname, 'panel-resize-watcher.js');
const STATUS_PORT = 7777;
const LOG_CAP = 600;
const watchdog = require('./watchdog');   // restart policy (shared with the tray): now, +5 min, then every 10 min; docs/WATCHDOG.md
const STOP_TIMEOUT_MS = 18000; // graceful flush budget (watcher itself caps at 12 s)

let child = null;
let state = 'stopped'; // stopped | starting | running | stopping
let startedAt = null;
let lastExit = null;
let manualStop = false;
let retry = { failures: 0, nextAt: 0 }; // the current failure streak (reset by a manual start or after the watcher stayed up STABLE_MS)
let autoRestarts = 0;
let childStatus = null;
let restartTimer = null;
let retryAt = 0;
const logs = [];
const pendingReplies = new Map();
let replySeq = 0;

const logMigration = logstore.start(); // moves old flat Logs/*.log into Logs/System/, writes Logs/README.txt

function sysLog(text) {
  const entry = { t: Date.now(), cat: 'system', sub: 'supervisor', text: '[supervisor] ' + text };
  logs.push(entry);
  if (logs.length > LOG_CAP) logs.shift();
  logstore.write(entry);
  console.log(entry.text);
}

// One failure of the watcher (could not start, or exited unexpectedly): log why, then schedule the next try by the shared policy.
function scheduleRetry(reason) {
  const now = Date.now();
  const wait = watchdog.retryDelay(retry.failures);   // attempts already made in this streak: 0 -> at once, 1 -> 5 min, then 10 min
  retry = { failures: retry.failures + 1, nextAt: now + wait };
  retryAt = now + wait; autoRestarts++;
  const n = retry.failures;
  const phase = n === 1 ? 'retry 1: restarting at once' : n === 2 ? 'retry 2: restarting in 5 min' : 'slow retry ' + (n - 2) + ': restarting in ' + Math.round(wait / 60000) + ' min';
  sysLog('PROBLEM: ' + reason + ' -- ' + phase + (wait ? ' (at ' + new Date(retryAt).toLocaleTimeString() + ')' : ''));
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { retryAt = 0; sysLog('restart attempt ' + n + ': starting the watcher'); startWatcher(false); }, wait || 1000);
}

function startWatcher(manual) {
  if (child) return { ok: false, error: 'already running' };
  clearTimeout(restartTimer);
  retryAt = 0;
  if (manual !== false) retry = { failures: 0, nextAt: 0 }; // a start from the dashboard / tray begins a fresh streak
  manualStop = false;
  state = 'starting';
  childStatus = null;
  let c;
  try {
    c = fork(WATCHER_PATH, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  } catch (e) {
    state = 'stopped';
    sysLog('could not start watcher: ' + e.message);
    if (manual === false) scheduleRetry('could not start the watcher (' + e.message + ')');
    return { ok: false, error: e.message };
  }
  child = c;
  startedAt = Date.now();
  sysLog('watcher started (pid ' + c.pid + ')');
  c.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'status') { childStatus = m.status; if (state === 'starting') state = 'running'; }
    else if (m.type === 'log' && m.entry) { logs.push(m.entry); if (logs.length > LOG_CAP) logs.shift(); logstore.write(m.entry); }
    else if (m.type === 'logbatch') { logstore.ingest(m.entries, { dropped: m.dropped }); }
    else if (m.type === 'logcmd') { if (m.cmd === 'prune') logstore.prune(); }
    else if (m.type === 'reply' && pendingReplies.has(m.reqId)) { pendingReplies.get(m.reqId)(m.result); pendingReplies.delete(m.reqId); }
  });
  c.on('exit', (code, signal) => {
    if (child !== c) return;
    child = null;
    const upMs = Date.now() - startedAt;
    lastExit = { code, signal, at: Date.now(), upMs };
    const wasManual = manualStop || state === 'stopping';
    state = 'stopped';
    childStatus = null;
    const how = code != null ? 'code ' + code : 'signal ' + signal;
    sysLog('watcher exited (' + how + ') after ' + Math.round(upMs / 1000) + 's' + (wasManual ? ' -- stopped on request, not restarting' : ' -- UNEXPECTED'));
    for (const [, r] of pendingReplies) r({ ok: false, error: 'watcher stopped' });
    pendingReplies.clear();
    if (wasManual) return;
    // Stayed up long enough = a new problem, not a continuing one: the streak starts over (so a one-off crash a day later is retried at once again).
    if (upMs >= watchdog.STABLE_MS && retry.failures) { sysLog('watcher had been stable for ' + Math.round(upMs / 60000) + ' min -- failure streak reset'); retry = { failures: 0, nextAt: 0 }; }
    scheduleRetry('watcher exited unexpectedly (' + how + ' after ' + Math.round(upMs / 1000) + 's)');
  });
  c.on('error', (e) => sysLog('PROBLEM: watcher process error: ' + e.message));
  return { ok: true, state };
}

function stopWatcher() {
  clearTimeout(restartTimer);
  if (!child) { state = 'stopped'; return Promise.resolve({ ok: true, state }); }
  manualStop = true;
  state = 'stopping';
  const c = child;
  sysLog('stopping watcher (pid ' + c.pid + ')');
  return new Promise((resolve) => {
    const done = () => resolve({ ok: true, state });
    c.once('exit', done);
    // Graceful first: the watcher flushes its pending Discord messages (and the
    // page's queued chat events) before exiting. Force-kill only if it doesn't
    // finish in time (kill() on Windows is immediate).
    let asked = false;
    try { asked = c.send({ type: 'shutdown' }); } catch (e) { asked = false; }
    if (!asked) { try { c.kill(); } catch (e) { /* already gone */ } }
    setTimeout(() => { if (child === c) { sysLog('watcher did not exit in ' + STOP_TIMEOUT_MS / 1000 + 's -- force killing'); try { c.kill(); } catch (e) {} } }, STOP_TIMEOUT_MS);
  });
}

async function restartWatcher() {
  await stopWatcher();
  await new Promise((r) => setTimeout(r, 400));
  return startWatcher();
}

// Forward a plugin toggle to the child; if it isn't running, just persist it
// the same way the child would (so the choice applies on next start).
function setPlugin(id, enabled) {
  if (!child) {
    try {
      const fs = require('fs');
      const file = P.state('plugins-config.json');
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) {}
      const set = new Set(cfg.disabled || []);
      if (enabled) set.delete(id); else set.add(id);
      cfg.disabled = [...set];
      require('./safe-json').writeJsonAtomic(file, JSON.stringify(cfg, null, 2));
      sysLog('plugin ' + id + (enabled ? ' enabled' : ' disabled') + ' (watcher stopped -- applies on start)');
      return Promise.resolve({ ok: true, applied: false });
    } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  }
  return new Promise((resolve) => {
    const reqId = ++replySeq;
    pendingReplies.set(reqId, resolve);
    try { child.send({ type: 'plugin', id, enabled, reqId }); } catch (e) { pendingReplies.delete(reqId); resolve({ ok: false, error: e.message }); return; }
    setTimeout(() => { if (pendingReplies.delete(reqId)) resolve({ ok: false, error: 'timed out' }); }, 15000);
  });
}

// The dashboard's Discord "Test send": the watcher owns the webhook URLs and the sender, so the request is forwarded to it.
function discordTest(feature) {
  if (!child) return Promise.resolve({ ok: false, error: 'the watcher is not running' });
  return new Promise((resolve) => {
    const reqId = ++replySeq;
    pendingReplies.set(reqId, resolve);
    try { child.send({ type: 'discord-test', feature, reqId }); } catch (e) { pendingReplies.delete(reqId); resolve({ ok: false, error: e.message }); return; }
    setTimeout(() => { if (pendingReplies.delete(reqId)) resolve({ ok: false, error: 'timed out' }); }, 45000);
  });
}

function getStatus() {
  const base = childStatus || {
    startedAt: null,
    cdp: { connected: false, since: null },
    chatRelay: { configured: false, lastEventAt: null, totalRelayed: 0, totalSkipped: 0 },
    clanHiscores: { configured: false, wsHookReady: false, lastPollAt: null, lastClanRank: null, nextPollAt: null },
    raidSummary: { configured: false, lastPostAt: null, totalPosted: 0, totalSkippedSolo: 0 },
    digest: { configured: false, lastPostAt: null, nextPostAt: null, totalPosted: 0 },
    plugins: [],
  };
  return Object.assign({}, base, {
    recentLog: logs,
    supervisor: { managed: true, state, pid: child ? child.pid : null, startedAt: child ? startedAt : null, lastExit, restarts: autoRestarts, manualStop, retryAt: retryAt || null, failures: retry.failures },
  });
}

startStatusServer(STATUS_PORT, getStatus, {
  plugin: setPlugin,
  discordTest,
  watcher: {
    start: async () => startWatcher(),
    stop: () => stopWatcher(),
    restart: () => restartWatcher(),
  },
});
launcher.startGuard(sysLog);
if (logMigration && logMigration.moved) sysLog('logs: moved ' + logMigration.moved + ' old run log(s) into Logs/System/');
sysLog('dashboard: http://scapelite.localhost/ (or http://localhost:' + STATUS_PORT + '/)');
// Game data first (first run / after a game update), so the watcher starts with fresh reference data; then re-check every
// 15 minutes and restart the watcher if the game was patched meanwhile.
gamedata.ensure(sysLog).catch(() => ({})).then(() => startWatcher());
setInterval(() => { gamedata.ensure(sysLog).then((r) => { if (r && r.extracted) restartWatcher(); }).catch(() => {}); }, 15 * 60 * 1000);

function shutdown() { stopWatcher().then(() => process.exit(0), () => process.exit(0)); setTimeout(() => process.exit(0), STOP_TIMEOUT_MS + 2000); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { if (child) child.kill(); } catch (e) {} try { logstore.flushSync(); } catch (e) {} });
