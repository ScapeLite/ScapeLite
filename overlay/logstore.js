// ScapeLite persistent logs. One file per run, named after the moment logging started
// (Logs/2026-10-10_14-43-12.log, local time), kept in a "Logs" folder at the project root.
// Settings (overlay/log-config.json, also editable in-game: Settings > Plugins > ScapeLite Core):
//   enabled   save logs at all (default true)
//   keepDays  delete log files older than this many days (default 14)
// The supervisor owns the file (every log line, including the watcher's, passes through it); a standalone watcher
// uses the same module. Nothing here reads or writes game state.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = require('./paths');
const LOG_DIR = P.logs;
const CONFIG_PATH = P.state('log-config.json');
const DEFAULTS = { enabled: true, keepDays: 14 };

let cached = null, cachedAt = 0, file = null, lastPrune = 0;

function config() {
  const now = Date.now();
  if (cached && now - cachedAt < 4000) return cached;
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch (e) { c = {}; }
  const keep = Math.round(Number(c.keepDays));
  cached = { enabled: c.enabled !== false, keepDays: Number.isFinite(keep) ? Math.min(365, Math.max(1, keep)) : DEFAULTS.keepDays };
  cachedAt = now;
  return cached;
}
function saveConfig(next) {
  const cur = config();
  const out = { enabled: next.enabled == null ? cur.enabled : !!next.enabled, keepDays: next.keepDays == null ? cur.keepDays : Math.min(365, Math.max(1, Math.round(Number(next.keepDays)) || cur.keepDays)) };
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  cached = null;
  return out;
}

const pad = (n, w) => String(n).padStart(w || 2, '0');
const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
const clock = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);

function prune(force) {
  const now = Date.now();
  if (!force && now - lastPrune < 6 * 3600 * 1000) return 0;
  lastPrune = now;
  const c = config();
  let removed = 0;
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/.test(f)) continue; // only ever touch our own files
      const p = path.join(LOG_DIR, f);
      if (file && p === file) continue;
      if (now - fs.statSync(p).mtimeMs > c.keepDays * 86400000) { fs.unlinkSync(p); removed++; }
    }
  } catch (e) { /* no Logs folder yet */ }
  return removed;
}

function write(entry) {
  try {
    const c = config();
    if (!c.enabled) return;
    if (!file) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const started = new Date();
      file = path.join(LOG_DIR, stamp(started) + '.log');
      let ver = '';
      try { ver = ' v' + JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (e) { /* ignore */ }
      fs.appendFileSync(file, '# ScapeLite' + ver + ' log started ' + clock(started) + '\n');
      prune(true);
    } else prune(false);
    const sub = entry.sub ? '/' + entry.sub : '';
    fs.appendFileSync(file, clock(new Date(entry.t || Date.now())) + ' [' + (entry.cat || 'system') + sub + '] ' + String(entry.text || '').replace(/\r?\n/g, ' | ') + '\n');
  } catch (e) { /* logging must never break the app */ }
}

function info() {
  let files = 0;
  try { files = fs.readdirSync(LOG_DIR).filter((f) => /\.log$/.test(f)).length; } catch (e) { files = 0; }
  return Object.assign({ dir: LOG_DIR, files, current: file ? path.basename(file) : null }, config());
}

module.exports = { write, config, saveConfig, prune, info, LOG_DIR };
