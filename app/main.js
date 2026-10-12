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

async function ensureSupervisor() {
  if (await get('/status')) return 'attached';          // already running (e.g. started by the old startup script)
  supervisor = spawn(process.execPath, [SUPERVISOR], { cwd: path.join(ROOT, 'overlay'), env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), windowsHide: true, stdio: 'ignore' });
  ownsSupervisor = true;
  supervisor.on('exit', () => { supervisor = null; });
  for (let i = 0; i < 40; i++) { if (await get('/status')) return 'started'; await new Promise((r) => setTimeout(r, 500)); }
  return 'failed';
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
    { type: 'separator' },
    { label: 'Open dashboard', click: () => showWindow('/') },
    { label: 'Plugin marketplace', click: () => showWindow('/marketplace') },
    { type: 'separator' },
    { label: 'Launch Scapewatch', click: async () => { const r = await get('/api/game/launch', 'POST', 120000); if (r && r.error) dialog.showMessageBox({ type: 'info', message: r.error }); } },
    { label: 'Check for updates', click: async () => { await get('/api/update/check', 'POST', 60000); showWindow('/'); } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: login, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked }); } },
    { label: 'Quit ScapeLite', click: () => quit() },
  ]);
}

async function quit() {
  if (quitting) return;
  quitting = true;
  if (ownsSupervisor) {
    await get('/api/watcher/stop', 'POST', 20000);        // lets the relay flush its queue
    try { if (supervisor) supervisor.kill(); } catch (e) { /* already gone */ }
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
  if (TEST) setTimeout(quit, Number(process.env.SCAPELITE_TEST_MS || 6000));
});
app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; });
