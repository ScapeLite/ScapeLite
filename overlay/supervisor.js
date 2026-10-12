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
const launcher = require('./launcher');
const gamedata = require('./gamedata');

const WATCHER_PATH = path.join(__dirname, 'panel-resize-watcher.js');
const STATUS_PORT = 7777;
const LOG_CAP = 600;
const AUTO_RESTART_MAX = 5;            // crashes tolerated...
const AUTO_RESTART_WINDOW_MS = 5 * 60 * 1000; // ...per this window
const AUTO_RESTART_DELAY_MS = 3000;
const STOP_TIMEOUT_MS = 18000; // graceful flush budget (watcher itself caps at 12 s)

let child = null;
let state = 'stopped'; // stopped | starting | running | stopping
let startedAt = null;
let lastExit = null;
let manualStop = false;
let crashTimes = [];
let autoRestarts = 0;
let childStatus = null;
let restartTimer = null;
const logs = [];
const pendingReplies = new Map();
let replySeq = 0;

function sysLog(text) {
  const entry = { t: Date.now(), cat: 'system', sub: 'supervisor', text: '[supervisor] ' + text };
  logs.push(entry);
  if (logs.length > LOG_CAP) logs.shift();
  logstore.write(entry);
  console.log(entry.text);
}

function startWatcher() {
  if (child) return { ok: false, error: 'already running' };
  clearTimeout(restartTimer);
  manualStop = false;
  state = 'starting';
  childStatus = null;
  let c;
  try {
    c = fork(WATCHER_PATH, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  } catch (e) {
    state = 'stopped';
    sysLog('could not start watcher: ' + e.message);
    return { ok: false, error: e.message };
  }
  child = c;
  startedAt = Date.now();
  sysLog('watcher started (pid ' + c.pid + ')');
  c.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'status') { childStatus = m.status; if (state === 'starting') state = 'running'; }
    else if (m.type === 'log' && m.entry) { logs.push(m.entry); if (logs.length > LOG_CAP) logs.shift(); logstore.write(m.entry); }
    else if (m.type === 'reply' && pendingReplies.has(m.reqId)) { pendingReplies.get(m.reqId)(m.result); pendingReplies.delete(m.reqId); }
  });
  c.on('exit', (code, signal) => {
    if (child !== c) return;
    child = null;
    lastExit = { code, signal, at: Date.now() };
    const wasManual = manualStop || state === 'stopping';
    state = 'stopped';
    childStatus = null;
    sysLog('watcher exited (' + (code != null ? 'code ' + code : 'signal ' + signal) + ')');
    for (const [, r] of pendingReplies) r({ ok: false, error: 'watcher stopped' });
    pendingReplies.clear();
    if (wasManual) return;
    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < AUTO_RESTART_WINDOW_MS);
    crashTimes.push(now);
    if (crashTimes.length > AUTO_RESTART_MAX) { sysLog('watcher crashed ' + crashTimes.length + ' times in 5 min -- not restarting automatically (use Start)'); return; }
    autoRestarts++;
    sysLog('unexpected exit -- restarting in ' + AUTO_RESTART_DELAY_MS / 1000 + 's');
    restartTimer = setTimeout(startWatcher, AUTO_RESTART_DELAY_MS);
  });
  c.on('error', (e) => sysLog('watcher process error: ' + e.message));
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
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
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
    supervisor: { managed: true, state, pid: child ? child.pid : null, startedAt: child ? startedAt : null, lastExit, restarts: autoRestarts },
  });
}

startStatusServer(STATUS_PORT, getStatus, {
  plugin: setPlugin,
  watcher: {
    start: async () => startWatcher(),
    stop: () => stopWatcher(),
    restart: () => restartWatcher(),
  },
});
launcher.startGuard(sysLog);
sysLog('dashboard: http://scapelite.localhost/ (or http://localhost:' + STATUS_PORT + '/)');
// Game data first (first run / after a game update), so the watcher starts with fresh reference data; then re-check every
// 15 minutes and restart the watcher if the game was patched meanwhile.
gamedata.ensure(sysLog).catch(() => ({})).then(() => startWatcher());
setInterval(() => { gamedata.ensure(sysLog).then((r) => { if (r && r.extracted) restartWatcher(); }).catch(() => {}); }, 15 * 60 * 1000);

function shutdown() { stopWatcher().then(() => process.exit(0), () => process.exit(0)); setTimeout(() => process.exit(0), STOP_TIMEOUT_MS + 2000); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { if (child) child.kill(); } catch (e) {} });
