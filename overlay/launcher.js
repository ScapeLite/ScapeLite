// ScapeLite game launcher. Removes the manual Steam launch-option step: it finds Steam and the Scapewatch install,
// and starts the game with the debugging port ScapeLite needs. Also usable from the command line:
//   node overlay/launcher.js            -> status
//   node overlay/launcher.js launch     -> start the game (through Steam) with ScapeLite's flags
//   node overlay/launcher.js restart    -> close a running game that has no port, then start it properly
// Windows only (Steam registry / tasklist). Never touches the game's files or account.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = 9222;
const FLAGS = ['--remote-debugging-port=' + PORT, '--remote-allow-origins=*'];
const GAME_NAME = /scapewatch/i;

const run = (cmd, args, timeout) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: timeout || 8000, windowsHide: true }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') }));
});

async function steamPath() {
  const r = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
  const m = r.out.match(/SteamPath\s+REG_SZ\s+(.+)/);
  if (m && fs.existsSync(m[1].trim())) return path.normalize(m[1].trim());
  for (const p of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) if (fs.existsSync(p)) return p;
  return null;
}

function libraries(steam) {
  const libs = [steam];
  try {
    const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(path.normalize(m[1].replace(/\\\\/g, '\\')));
  } catch (e) { /* default library only */ }
  return [...new Set(libs)];
}

async function findGame() {
  const steam = await steamPath();
  if (!steam) return null;
  for (const lib of libraries(steam)) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch (e) { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(dir, f), 'utf8');
        const name = (acf.match(/"name"\s+"([^"]+)"/) || [])[1];
        if (!name || !GAME_NAME.test(name)) continue;
        const appid = (acf.match(/"appid"\s+"(\d+)"/) || [])[1];
        const installdir = (acf.match(/"installdir"\s+"([^"]+)"/) || [])[1];
        const root = path.join(dir, 'common', installdir || '');
        const exe = fs.readdirSync(root).find((x) => /^scapewatch\.exe$/i.test(x));
        return { steam, appid, name, root, exe: exe ? path.join(root, exe) : null };
      } catch (e) { /* next manifest */ }
    }
  }
  return null;
}

async function portOpen() {
  try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; }
}
async function gameRunning() {
  const r = await run('tasklist', ['/FI', 'IMAGENAME eq Scapewatch.exe', '/FO', 'CSV', '/NH']);
  return /scapewatch\.exe/i.test(r.out);
}

// state: 'ready' (running with the port), 'needs-restart' (running without it), 'stopped', 'no-game' (not installed)
async function status() {
  const game = await findGame();
  const open = await portOpen();
  const running = open || await gameRunning();
  const state = !game ? 'no-game' : open ? 'ready' : running ? 'needs-restart' : 'stopped';
  return { state, port: PORT, game: game ? { appid: game.appid, name: game.name, root: game.root, exe: game.exe, steam: game.steam } : null };
}

async function waitForPort(ms) {
  const end = Date.now() + (ms || 90000);
  while (Date.now() < end) { if (await portOpen()) return true; await new Promise((r) => setTimeout(r, 1500)); }
  return false;
}

async function launch() {
  const st = await status();
  if (st.state === 'no-game') return Object.assign({ ok: false, error: 'Scapewatch was not found in your Steam libraries.' }, st);
  if (st.state === 'ready') return Object.assign({ ok: true, message: 'The game is already running with ScapeLite connected.' }, st);
  if (st.state === 'needs-restart') return Object.assign({ ok: false, needsRestart: true, error: 'The game is running without ScapeLite\u2019s connection. Close it (or use restart) and launch again.' }, st);
  const g = st.game;
  try {
    // Through Steam, so playtime / cloud saves / overlay keep working: steam://run/<appid>//<arguments>/
    const url = 'steam://run/' + g.appid + '//' + FLAGS.join(' ') + '/';
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    if (g.exe) spawn(g.exe, FLAGS, { detached: true, stdio: 'ignore', cwd: g.root }).unref(); // fallback: run the game directly
    else return Object.assign({ ok: false, error: 'Could not start the game: ' + e.message }, st);
  }
  const up = await waitForPort(90000);
  return Object.assign({ ok: up, message: up ? 'Game started with ScapeLite connected.' : 'Started the game, but the connection did not come up within 90 s.' }, await status());
}

async function restart() {
  const st = await status();
  if (st.state === 'needs-restart') {
    await run('taskkill', ['/IM', 'Scapewatch.exe', '/F'], 15000);
    for (let i = 0; i < 20 && await gameRunning(); i++) await new Promise((r) => setTimeout(r, 500));
  }
  return launch();
}

// ---- auto-intervention: notice the game starting WITHOUT ScapeLite's flags and restart it with them ----
const CONFIG_PATH = require('./paths').state('launch-config.json');
function config() { let c = {}; try { c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (e) { c = {}; } return { autoRelaunch: c.autoRelaunch !== false }; }
function setAuto(on) { const tmp = CONFIG_PATH + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ autoRelaunch: !!on }, null, 2)); fs.renameSync(tmp, CONFIG_PATH); return config(); }

async function gamePids() {
  const r = await run('tasklist', ['/FI', 'IMAGENAME eq Scapewatch.exe', '/FO', 'CSV', '/NH']);
  return [...r.out.matchAll(/"Scapewatch\.exe","(\d+)"/gi)].map((m) => m[1]);
}
// Command line of the game's MAIN process (the one that is not a --type=renderer/utility child).
async function mainCommandLine() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='Scapewatch.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.CommandLine }";
  const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], 15000);
  return r.out.trim();
}

let guard = null;
function startGuard(log) {
  if (guard) return;
  const say = log || (() => {});
  let known = new Set(), busy = false, stamps = [];
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!config().autoRelaunch) { known = new Set(await gamePids()); return; }
      const pids = await gamePids();
      const fresh = pids.filter((p) => !known.has(p));
      known = new Set(pids);
      if (!fresh.length) return;
      await new Promise((r) => setTimeout(r, 1800));            // let the main process finish starting
      const cmd = await mainCommandLine();
      if (!cmd || /--remote-debugging-port=/.test(cmd)) return; // started with the connection (or already gone): nothing to do
      const now = Date.now(); stamps = stamps.filter((t) => now - t < 180000);
      if (stamps.length >= 2) { say('Game guard: the game keeps starting without ScapeLite’s connection; giving up for now (use Restart in the dashboard).'); return; }
      stamps.push(now);
      say('Game guard: Scapewatch started without ScapeLite’s connection -- restarting it with the right flags.');
      const r = await restart();
      say('Game guard: ' + (r.ok ? 'restarted, connected.' : 'restart failed -- ' + (r.error || r.message || 'unknown')));
      known = new Set(await gamePids());
    } catch (e) { say('Game guard error: ' + (e && e.message || e)); }
    finally { busy = false; }
  };
  gamePids().then((p) => { known = new Set(p); guard = setInterval(tick, 1500); });
}
function stopGuard() { if (guard) { clearInterval(guard); guard = null; } }

module.exports = { status, launch, restart, findGame, config, setAuto, startGuard, stopGuard, PORT, FLAGS };

if (require.main === module) {
  const cmd = process.argv[2] || 'status';
  const fn = { status, launch, restart }[cmd];
  if (!fn) { console.error('usage: node launcher.js [status|launch|restart]'); process.exit(2); }
  fn().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok === false ? 1 : 0); }).catch((e) => { console.error(e); process.exit(1); });
}
