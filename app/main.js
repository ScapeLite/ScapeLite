// ScapeLite desktop app (Electron shell). One program the user starts: it runs the supervisor (dashboard + watcher) in
// the background, sits in the system tray, and shows the dashboard / marketplace in its own window. It carries its own
// Node runtime, so nothing else needs installing. Display-only tooling; it never acts in the game.
'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUPERVISOR = path.join(ROOT, 'overlay', 'supervisor.js');
const PORT = 7777;
const BASE = 'http://localhost:' + PORT;
const ICON = path.join(ROOT, 'branding', 'png', 'logo-256.png');
const TEST = process.env.SCAPELITE_TEST === '1'; // headless smoke test: no window, quit after a few seconds

// Installed app: all per-user files (settings, logs, extracted game data) live in the user's data folder, not in the
// program folder, so updates and reinstalls never touch them. From source they stay next to the code, as before.
if (app.isPackaged && !process.env.SCAPELITE_HOME) process.env.SCAPELITE_HOME = app.getPath('userData');

let tray = null, win = null, supervisor = null, quitting = false, ownsSupervisor = false;

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => showWindow('/'));
}

function get(pathname, method, timeout) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: method || 'GET', timeout: timeout || 2500, headers: { 'x-cc-control': '1', 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({}); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

function spawnSupervisor() {
  supervisor = spawn(process.execPath, [SUPERVISOR], { cwd: path.join(ROOT, 'overlay'), env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), windowsHide: true, stdio: 'ignore' });
  ownsSupervisor = true;
  supervisor.on('exit', () => { supervisor = null; });
}

async function ensureSupervisor() {
  if (await get('/status')) return 'attached';          // already running (e.g. started by the old startup script)
  spawnSupervisor();
  for (let i = 0; i < 40; i++) { if (await get('/status')) return 'started'; await new Promise((r) => setTimeout(r, 500)); }
  return 'failed';
}

// ---- Watchdog (docs/WATCHDOG.md): notice a missing supervisor / watcher, log it to Logs/System, restart it: now, +5 min, then every 10 min ----
let wd = null, lastProblem = null;
const wdState = { supervisor: { failures: 0, nextAt: 0 }, watcher: { failures: 0, nextAt: 0 } };
const wdHealthy = { supervisor: null, watcher: null };
let wdBusy = false, wdBadStatus = 0;

function wdLog(text, problem) {
  const line = '[tray] ' + text;
  try { require('../overlay/logstore').write({ t: Date.now(), cat: 'system', sub: 'tray', text: line }); } catch (e) { /* logging must never break the tray */ }
  console.log(line);
  if (problem) lastProblem = { text: problem, at: Date.now() };
}

function judge(name) { // lock file -> pid alive -> really that program (pids get reused) -> verdict
  const P = require('../overlay/paths');
  const lock = wd.readLock(P.state(name + '.lock'));
  const alive = lock.exists && wd.alivePid(lock.pid);
  return new Promise((resolve) => {
    const done = (cmd) => resolve(Object.assign(wd.judgeProcess(lock, alive, cmd, name), { lock }));
    if (lock.exists && alive) wd.commandLine(lock.pid, done); else done(null);
  });
}

// Apply the retry policy to one component. Returns true if an attempt was made now.
async function wdRecover(name, reason, action) {
  const now = Date.now(), d = wd.retryDecision(wdState[name], now);
  if (!d.go) return false;
  wdState[name] = wd.afterAttempt(wdState[name], now);
  const n = wdState[name].failures, next = n === 1 ? '5 min' : '10 min';
  wdLog('PROBLEM: ' + reason + ' -- restart attempt ' + n + (n === 1 ? ' (at once)' : n === 2 ? ' (+5 min)' : ' (slow retry)') + '; if it is still down the next try is in ' + next, name + ': ' + reason);
  try { await action(); } catch (e) { wdLog('restart attempt ' + n + ' of the ' + name + ' failed: ' + e.message); }
  return true;
}

function wdMarkHealthy(name, now) {
  if (wdHealthy[name] == null) wdHealthy[name] = now;
  const s = wd.maybeReset(wdState[name], wdHealthy[name], now);
  if (s.reset) { wdState[name] = { failures: 0, nextAt: 0 }; wdLog(name + ' has been healthy again for ' + Math.round(wd.STABLE_MS / 60000) + ' min -- failure streak reset'); }
}

async function watchdogCheck() {
  if (wdBusy || quitting) return;
  wdBusy = true;
  try {
    const now = Date.now();
    let sup = await judge('supervisor');
    if (!sup.ok && wdState.supervisor.failures === 0) { await new Promise((r) => setTimeout(r, 12000)); sup = await judge('supervisor'); } // a service restart from the dashboard has the lock gone for a moment
    if (!sup.ok) {
      wdHealthy.supervisor = null; wdHealthy.watcher = null;
      if (sup.verdict === 'missing' && await get('/status')) { // something answers on the dashboard port without a lock: do not start a rival
        if (!wdState.supervisor.warned) { wdState.supervisor.warned = true; wdLog('supervisor lock is missing but the dashboard answers -- leaving it alone'); }
        return;
      }
      await wdRecover('supervisor', sup.why, async () => {
        spawnSupervisor();
        for (let i = 0; i < 40; i++) { if (await get('/status')) { wdLog('supervisor is back (dashboard answers)'); return; } await new Promise((r) => setTimeout(r, 500)); }
        wdLog('supervisor was started but the dashboard did not answer within 20 s');
      });
      return;
    }
    wdMarkHealthy('supervisor', now);
    const st = await get('/status');
    if (!st) { // lock is fine but the dashboard port is silent: log (twice in a row) and leave it, there is no safe way to restart a supervisor that is alive
      if (++wdBadStatus === 2) wdLog('PROBLEM: supervisor pid is alive but its dashboard does not answer', 'supervisor: dashboard does not answer');
      return;
    }
    wdBadStatus = 0;
    if (wd.supervisorOwnsRecovery(st.supervisor, now)) return; // stopped on purpose from the dashboard, or the supervisor has its own retry scheduled
    let wat = await judge('watcher');
    if (!wat.ok && wdState.watcher.failures === 0) { await new Promise((r) => setTimeout(r, 12000)); wat = await judge('watcher'); }
    if (!wat.ok) {
      wdHealthy.watcher = null;
      await wdRecover('watcher', wat.why, () => get('/api/watcher/start', 'POST', 30000));
      return;
    }
    const hb = wd.judgeHeartbeat(wd.readBeat(require('../overlay/paths').state(wd.HEARTBEAT_FILE)), wat.lock.mtimeMs, now);
    if (!hb.ok) {
      wdHealthy.watcher = null;
      await wdRecover('watcher', hb.why, () => get('/api/watcher/restart', 'POST', 40000));
      return;
    }
    wdMarkHealthy('watcher', now);
  } catch (e) { wdLog('watchdog check failed: ' + e.message); }
  finally { wdBusy = false; }
}

function startWatchdog() {
  if (TEST) return;
  try { wd = require('../overlay/watchdog'); } catch (e) { console.log('[app] watchdog unavailable: ' + e.message); return; }
  wdLog('watchdog started: checks the supervisor and the watcher every ' + wd.CHECK_EVERY_MS / 1000 + 's');
  setTimeout(() => { watchdogCheck(); setInterval(watchdogCheck, wd.CHECK_EVERY_MS); }, 45000); // grace for the first start
}

function showWindow(route) {
  if (TEST) return;
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({ width: 1180, height: 860, minWidth: 760, minHeight: 520, backgroundColor: '#0f0f15', title: 'ScapeLite', icon: ICON, autoHideMenuBar: true });
    win.setMenuBarVisibility(false);
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });   // keep running in the tray
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  }
  win.loadURL(BASE + (route || '/'));
  win.show(); win.focus();
}

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'ScapeLite', enabled: false },
    { label: lastProblem ? 'Last problem: ' + lastProblem.text.slice(0, 80) + ' (' + new Date(lastProblem.at).toLocaleTimeString() + ')' : 'Last problem: none', enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: () => showWindow('/') },
    { label: 'Plugin marketplace', click: () => showWindow('/marketplace') },
    { type: 'separator' },
    { label: 'Launch Scapewatch', click: async () => { const r = await get('/api/game/launch', 'POST', 120000); if (r && r.error) dialog.showMessageBox({ type: 'info', message: r.error }); } },
    { label: 'Restart Scapewatch with ScapeLite', click: async () => { const r = await get('/api/game/restart', 'POST', 120000); if (r && r.error) dialog.showMessageBox({ type: 'info', message: r.error }); } },
    { type: 'separator' },
    { label: 'Restart plugins (watcher)', click: () => { get('/api/watcher/restart', 'POST', 30000); } },
    { label: 'Restart ScapeLite service', click: async () => { await get('/api/service/restart', 'POST', 5000); setTimeout(() => { if (win && !win.isDestroyed() && win.isVisible()) win.loadURL(BASE + '/'); }, 9000); } },
    { type: 'separator' },
    { label: 'Open logs folder', click: () => shell.openPath(process.env.SCAPELITE_HOME ? path.join(process.env.SCAPELITE_HOME, 'Logs') : path.join(ROOT, 'Logs')) },
    { label: 'Website', click: () => shell.openExternal('https://scapelite.github.io/ScapeLite/') },
    { label: 'Report a bug', click: () => shell.openExternal('https://github.com/ScapeLite/ScapeLite/issues') },
    { label: 'Check for updates', click: async () => { await get('/api/update/check', 'POST', 60000); showWindow('/'); } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: login, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); } },
    { label: 'Quit ScapeLite (keep service running)', click: () => quit() },
    { label: 'Quit ScapeLite and stop the service', click: () => quit(true) },
  ]);
}

async function quit(stopService) {
  if (quitting) return;
  quitting = true;
  if (ownsSupervisor || stopService === true) {
    await get('/api/watcher/stop', 'POST', 20000);        // lets the relay flush its queue
    try { if (supervisor) supervisor.kill(); } catch (e) { /* already gone */ }
    if (stopService === true && !supervisor) await get('/api/service/stop', 'POST', 5000);
  }
  app.exit(0);
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('ScapeLite');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => showWindow('/'));
  tray.on('right-click', () => tray.setContextMenu(buildMenu()));
  const how = await ensureSupervisor();
  console.log('[app] supervisor ' + how);
  if (how === 'failed') { if (!TEST) dialog.showErrorBox('ScapeLite', 'The ScapeLite background service did not start. Try again, or check the Logs folder.'); }
  else if (!TEST) showWindow('/');
  startWatchdog();
  if (TEST) setTimeout(quit, Number(process.env.SCAPELITE_TEST_MS || 6000));
});
app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; });
