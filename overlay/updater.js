// ScapeLite updater (runs inside the dashboard server). Checks whether a newer ScapeLite exists and can apply it.
//   * Git installs (a .git folder next to overlay/): `git fetch` + compare with the upstream branch; "Update" runs
//     `git pull --ff-only` (+ `npm install` when package-lock.json changed). Works with a private repo because it
//     uses YOUR git credentials; no hosting or tokens needed here.
//   * Other installs: set "manifestUrl" in overlay/update-config.json to a JSON file
//     {"version","notes","downloadUrl"}; the updater reports the new version and offers the download link.
// Plugin updates ride along: bundled plugins live in the same repo, and the plugin list below compares each plugin's
// catalog version before/after. Checks run at launch (config "checkOnLaunch", default true) and on demand.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = require('./paths').state('update-config.json');
const state = { phase: 'idle', checkedAt: null, current: null, latest: null, behind: 0, commits: [], plugins: [], mode: null, message: '', error: null, applying: false, appliedAt: null, restartNeeded: false, downloadUrl: null };

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }
function config() { return Object.assign({ checkOnLaunch: true, manifestUrl: '', branch: '' }, readJson(CONFIG_PATH, {})); }
function localVersion() { return (readJson(path.join(ROOT, 'package.json'), {}).version) || '0.0.0'; }
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, Object.assign({ cwd: ROOT, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: process.platform === 'win32' && cmd === 'npm' }, opts), (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}
const isGit = () => fs.existsSync(path.join(ROOT, '.git'));
const semverGt = (a, b) => { const p = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function checkGit() {
  const cfg = config();
  const head = await run('git', ['rev-parse', '--short', 'HEAD']);
  state.current = { version: localVersion(), commit: head.ok ? head.out : '?' };
  const f = await run('git', ['fetch', '--quiet', 'origin'], { timeout: 40000 });
  if (!f.ok) throw new Error('Could not reach the remote (git fetch failed). ' + (f.err || '').split('\n')[0]);
  let upstream = cfg.branch ? 'origin/' + cfg.branch : '';
  if (!upstream) { const u = await run('git', ['rev-parse', '--abbrev-ref', '@{u}']); upstream = u.ok && u.out ? u.out : 'origin/main'; }
  const behind = await run('git', ['rev-list', '--count', 'HEAD..' + upstream]);
  state.behind = behind.ok ? parseInt(behind.out, 10) || 0 : 0;
  const rp = await run('git', ['show', upstream + ':package.json']);
  let latestVersion = state.current.version;
  try { latestVersion = JSON.parse(rp.out).version || latestVersion; } catch (e) { /* keep local */ }
  const rh = await run('git', ['rev-parse', '--short', upstream]);
  state.latest = { version: latestVersion, commit: rh.ok ? rh.out : '?' };
  const lg = state.behind ? await run('git', ['log', '--no-merges', '--format=%s', '-n', '15', 'HEAD..' + upstream]) : { ok: true, out: '' };
  state.commits = lg.out ? lg.out.split('\n').filter(Boolean) : [];
  // plugin versions: local catalog vs upstream catalog
  state.plugins = [];
  const rc = await run('git', ['show', upstream + ':overlay/catalog.json']);
  try {
    const remote = JSON.parse(rc.out).plugins || [];
    const local = (readJson(path.join(__dirname, 'catalog.json'), {}).plugins) || [];
    remote.forEach((rp2) => {
      const lp = local.find((x) => x.id === rp2.id);
      if (!lp) state.plugins.push({ id: rp2.id, name: rp2.name, from: null, to: rp2.version || '1.0.0' });
      else if (semverGt(rp2.version || '0', lp.version || '0')) state.plugins.push({ id: rp2.id, name: rp2.name, from: lp.version, to: rp2.version });
    });
  } catch (e) { /* no catalog upstream */ }
  state.mode = 'git';
  state.message = state.behind ? state.behind + ' new change' + (state.behind === 1 ? '' : 's') + ' available.' : 'You are up to date.';
}

async function checkManifest(url) {
  state.current = { version: localVersion(), commit: null };
  const res = await fetch(url, { headers: { 'user-agent': 'ScapeLite-updater' } });
  if (!res.ok) throw new Error('Update server answered ' + res.status);
  const m = await res.json();
  state.latest = { version: String(m.version || state.current.version), commit: null };
  state.behind = semverGt(state.latest.version, state.current.version) ? 1 : 0;
  state.commits = m.notes ? String(m.notes).split('\n').filter(Boolean).slice(0, 15) : [];
  state.plugins = Array.isArray(m.plugins) ? m.plugins.slice(0, 40) : [];
  state.downloadUrl = typeof m.downloadUrl === 'string' && /^https:\/\//.test(m.downloadUrl) ? m.downloadUrl : null;
  state.mode = 'manifest';
  state.message = state.behind ? 'Version ' + state.latest.version + ' is available.' : 'You are up to date.';
}

async function check() {
  if (state.phase === 'checking' || state.applying) return state;
  state.phase = 'checking'; state.error = null; state.message = 'Checking…';
  try {
    const cfg = config();
    if (isGit()) await checkGit();
    else if (cfg.manifestUrl) await checkManifest(cfg.manifestUrl);
    else { state.current = { version: localVersion(), commit: null }; state.latest = null; state.behind = 0; state.mode = 'none'; state.message = 'Updates are not configured for this install (no git folder or update-config.json manifestUrl).'; }
  } catch (e) { state.error = String(e && e.message || e); state.message = 'Update check failed.'; }
  state.checkedAt = Date.now(); state.phase = 'idle';
  return state;
}

async function apply() {
  if (state.applying) return state;
  if (!isGit()) { state.error = 'Automatic update needs a git install. Download the new version from the link instead.'; return state; }
  state.applying = true; state.error = null; state.message = 'Updating…';
  try {
    const before = fs.existsSync(path.join(ROOT, 'package-lock.json')) ? fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8') : '';
    const pull = await run('git', ['pull', '--ff-only'], { timeout: 90000 });
    if (!pull.ok) throw new Error('git pull failed: ' + (pull.err || pull.out).split('\n').slice(0, 3).join(' '));
    const after = fs.existsSync(path.join(ROOT, 'package-lock.json')) ? fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8') : '';
    if (before !== after) { const npm = await run('npm', ['install', '--no-audit', '--no-fund'], { timeout: 240000 }); if (!npm.ok) throw new Error('npm install failed: ' + npm.err.split('\n')[0]); }
    state.appliedAt = Date.now(); state.restartNeeded = true; state.behind = 0;
    state.message = 'Updated. Restart ScapeLite to finish (Dashboard > Restart, then reload the game once).';
  } catch (e) { state.error = String(e && e.message || e); state.message = 'Update failed.'; }
  state.applying = false;
  return state;
}

function snapshot() { return JSON.parse(JSON.stringify(Object.assign({}, state, { version: localVersion(), canApply: isGit() }))); }
function start() { if (config().checkOnLaunch !== false) setTimeout(() => { check().catch(() => {}); }, 30000); }

module.exports = { check, apply, snapshot, start };
