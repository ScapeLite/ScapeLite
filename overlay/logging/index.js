// ScapeLite logging core. One module owns every log file:
//
//   Logs/<Channel>/<Prefix>_<YYYY-MM-DD_HH-MM-SS>.log     human-readable
//   Logs/<Channel>/<Prefix>_<YYYY-MM-DD_HH-MM-SS>.jsonl   machine-readable (structured channels), one JSON object per line
//
// See docs/LOGGING.md. Guarantees: log calls never throw; memory is bounded (a capped write queue, flushed every few
// hundred ms with async appends, synchronously only on exit); secrets are redacted before anything is written; old
// files are pruned by age and size, and only files that match our own naming are ever touched. Nothing here reads or
// writes game state.
//
// One process owns the files. In the installed app that is the supervisor (the watcher forwards its lines and the
// in-game plugin lines over IPC); a standalone watcher uses the same module directly.
'use strict';

const fs = require('fs');
const path = require('path');
const { CHANNELS, LEVELS, LEVEL_NAMES, legacyChannel, legacyLevel } = require('./channels');
const { redactText, redactData } = require('./redact');

const DEFAULTS = {
  enabled: true,        // save logs at all
  keepDays: 14,         // diagnostics channels
  historyDays: 90,      // history channels (Tasks, Fortress, Drops)
  level: 'info',        // global minimum level
  maxFileMB: 5,         // rotate a file when it grows past this
  maxTotalMB: 100,      // per channel folder; oldest files go first
  daily: true,          // also start a new file at local midnight
  structured: true,     // allow the .jsonl files at all
  channels: {},         // per-channel overrides: { Tasks: { enabled, level, keepDays, maxFileMB, maxTotalMB, structured } }
};
const MAX_PENDING_LINES = 6000;
const MSG_MAX = 4000, DATA_MAX = 16000;
const PRUNE_EVERY_MS = 6 * 3600 * 1000;
const FILE_RE = /^([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z][A-Za-z0-9]*)*)_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?\.(log|jsonl)$/;
const LEGACY_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/;

const pad = (n, w) => String(n).padStart(w || 2, '0');
const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
const clock = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
const dayKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt; };

function normalizeConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const out = {
    enabled: c.enabled !== false,
    keepDays: Math.round(num(c.keepDays, 1, 365, DEFAULTS.keepDays)),
    historyDays: Math.round(num(c.historyDays, 1, 3650, DEFAULTS.historyDays)),
    level: LEVELS[c.level] ? c.level : DEFAULTS.level,
    maxFileMB: num(c.maxFileMB, 0.01, 512, DEFAULTS.maxFileMB),
    maxTotalMB: num(c.maxTotalMB, 0.01, 10240, DEFAULTS.maxTotalMB),
    daily: c.daily !== false,
    structured: c.structured !== false,
    channels: {},
  };
  const src = c.channels && typeof c.channels === 'object' ? c.channels : {};
  for (const name of Object.keys(src)) {
    if (!CHANNELS[name] || !src[name] || typeof src[name] !== 'object') continue; // unknown channel names are ignored
    const o = src[name], r = {};
    if (typeof o.enabled === 'boolean') r.enabled = o.enabled;
    if (LEVELS[o.level]) r.level = o.level;
    if (o.keepDays != null) r.keepDays = Math.round(num(o.keepDays, 1, 3650, out.keepDays));
    if (o.maxFileMB != null) r.maxFileMB = num(o.maxFileMB, 0.01, 512, out.maxFileMB);
    if (o.maxTotalMB != null) r.maxTotalMB = num(o.maxTotalMB, 0.01, 10240, out.maxTotalMB);
    if (typeof o.structured === 'boolean') r.structured = o.structured;
    if (Object.keys(r).length) out.channels[name] = r;
  }
  return out;
}

const README = [
  'ScapeLite logs',
  '',
  'Each folder holds one kind of log. File names start with what they log, then the date and time the file was started:',
  '',
  '  System/    supervisor: start, stop, restarts, dashboard, game launch      System_YYYY-MM-DD_HH-MM-SS.log',
  '  Watcher/   game connection, plugin injection, settings sync               Watcher_...',
  '  Discord/   chat relay, hiscores, raid summaries, digest                   Discord_...',
  '  Plugins/   general messages from in-game plugins                          Plugins_...',
  '  Tasks/     every task you ran                                             Skilling_Tasks_... and Slayer_Tasks_... (.log and .jsonl)',
  '  Fortress/  Fortress runs                                                  Fortress_Runs_... (.log and .jsonl)',
  '  Drops/     notable drops                                                  Drops_..., Fortress_Drops_... (.log and .jsonl)',
  '  Alerts/    what the alerts bell raised                                    Alerts_... (.log and .jsonl)',
  '  Perf/      performance samples                                            Perf_... (.log and .jsonl)',
  '  Errors/    every warning and error from all of the above                  Errors_...',
  '',
  '.log files are for reading; .jsonl files (one JSON object per line) are for tools.',
  'Settings: in the game, Settings > Plugins > ScapeLite Core. Everything stays on this computer.',
  'Dashboard viewer (browse, tail, search): http://localhost:7777/logs',
  '',
].join('\r\n');

function createLogSystem(opts) {
  opts = opts || {};
  const dir = opts.dir;
  const configPath = opts.configPath || null;
  const now = opts.now || (() => Date.now());
  const flushMs = opts.flushMs == null ? 400 : opts.flushMs;     // 0 = write synchronously (tests)
  const version = opts.version || '';
  const onInternal = opts.onInternal || (() => {});               // diagnostics about the logger itself

  let cfgCache = null, cfgAt = 0;
  const targets = new Map();          // "dir/prefix" -> { file, jfile, bytes, jbytes, day }
  const used = new Set();             // file paths this process created (a name is never reused)
  const pending = new Map();          // file -> string[]
  let pendingCount = 0, droppedLines = 0, timer = null, writing = Promise.resolve();
  const dirsMade = new Set();
  const pruned = new Map();           // channel -> last prune time
  const counters = { written: 0, filtered: 0 };

  // ---- config ---------------------------------------------------------------------------------------------------
  function config() {
    const t = Date.now();
    if (cfgCache && t - cfgAt < 4000) return cfgCache;
    let c = {};
    if (configPath) { try { c = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; } catch (e) { c = {}; } }
    cfgCache = normalizeConfig(c); cfgAt = t;
    return cfgCache;
  }
  function saveConfig(patch) {
    patch = patch || {};
    const cur = config();
    const merged = Object.assign({}, cur, patch);
    if (patch.channels) {
      merged.channels = Object.assign({}, cur.channels);
      for (const k of Object.keys(patch.channels)) merged.channels[k] = Object.assign({}, cur.channels[k], patch.channels[k]);
    }
    const out = normalizeConfig(merged);
    if (configPath) {
      const tmp = configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
      fs.renameSync(tmp, configPath);
    }
    cfgCache = out; cfgAt = Date.now();
    return out;
  }
  function resolve(chName) {
    const c = config(), def = CHANNELS[chName] || CHANNELS.Plugins, o = c.channels[chName] || {};
    return {
      enabled: c.enabled && o.enabled !== false,
      level: LEVELS[o.level] || LEVELS[def.level] || LEVELS[c.level],
      keepDays: o.keepDays || def.keepDays || (def.history ? c.historyDays : c.keepDays),
      maxFileBytes: Math.round((o.maxFileMB || c.maxFileMB) * 1048576),
      maxTotalBytes: Math.round((o.maxTotalMB || c.maxTotalMB) * 1048576),
      structured: !!def.structured && c.structured && o.structured !== false,
      daily: c.daily,
    };
  }

  // ---- files ----------------------------------------------------------------------------------------------------
  function ensureDir(d) {
    if (dirsMade.has(d)) return;
    fs.mkdirSync(d, { recursive: true });
    dirsMade.add(d);
  }
  function takePending() {
    const batch = [];
    for (const [file, lines] of pending) batch.push([file, lines.join('')]);
    pending.clear(); pendingCount = 0;
    return batch;
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const batch = takePending();
    if (batch.length) {
      writing = writing.then(async () => {
        for (const [file, text] of batch) { try { await fs.promises.appendFile(file, text); } catch (e) { onInternal('write failed: ' + e.message); } }
      });
    }
    return writing;
  }
  function flushSync() {
    if (timer) { clearTimeout(timer); timer = null; }
    for (const [file, text] of takePending()) { try { fs.appendFileSync(file, text); } catch (e) { onInternal('write failed: ' + e.message); } }
  }
  function enqueue(file, text) {
    if (pendingCount >= MAX_PENDING_LINES) { droppedLines++; return; }
    let q = pending.get(file); if (!q) { q = []; pending.set(file, q); }
    q.push(text); pendingCount++;
    if (flushMs <= 0) { flushSync(); return; }
    if (!timer) { timer = setTimeout(() => { timer = null; flush(); }, flushMs); if (timer.unref) timer.unref(); }
  }
  function uniqueName(d, prefix, ext, when) {
    const base = prefix + '_' + stamp(when);
    for (let i = 1; ; i++) {
      const p = path.join(d, base + (i > 1 ? '-' + i : '') + ext);
      if (!used.has(p) && !fs.existsSync(p)) { used.add(p); return p; }
    }
  }
  function header(chName, prefix, when) {
    return '# ScapeLite' + (version ? ' v' + version : '') + ' | ' + chName + ' | ' + prefix + ' | log started ' + clock(when) + '\n';
  }
  // The open .log (and .jsonl) for a channel/prefix, rotating by size and by day.
  function target(def, prefix, r, when) {
    const d = path.join(dir, def.dir);
    const key = def.dir + '/' + prefix;
    let t = targets.get(key);
    const today = dayKey(when);
    const rotate = t && ((r.daily && t.day !== today) || t.bytes >= r.maxFileBytes || (t.jfile && t.jbytes >= r.maxFileBytes));
    if (!t || rotate) {
      ensureDir(d);
      t = { file: uniqueName(d, prefix, '.log', when), jfile: null, bytes: 0, jbytes: 0, day: today };
      const h = header(def.name, prefix, when);
      enqueue(t.file, h); t.bytes += Buffer.byteLength(h);
      targets.set(key, t);
      prune(def.name, false);
    }
    if (r.structured && !t.jfile) t.jfile = uniqueName(d, prefix, '.jsonl', when);
    return t;
  }

  // ---- writing --------------------------------------------------------------------------------------------------
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '...' : s);
  // The one write path. Never throws.
  function emit(chName, stream, level, msg, data, t) {
    try {
      const def = CHANNELS[chName] || CHANNELS.Plugins;
      level = LEVELS[level] ? level : 'info';
      const r = resolve(def.name);
      if (!r.enabled || LEVELS[level] < r.level) { counters.filtered++; return false; }
      const when = new Date(t || now());
      const text = clip(redactText(msg == null ? '' : msg).replace(/\r?\n/g, ' | '), MSG_MAX);
      let d = data === undefined ? undefined : redactData(data);
      if (d !== undefined) { let j = ''; try { j = JSON.stringify(d); } catch (e) { j = ''; } if (!j) d = undefined; else if (j.length > DATA_MAX) d = { truncated: true, bytes: j.length }; }
      const sk = stream ? String(stream).toLowerCase() : '';
      const known = !!(sk && def.streams && def.streams[sk]);
      const prefix = known ? def.streams[sk] : def.prefix;
      const tg = target(def, prefix, r, when);
      const tag = def.name + (known ? '/' + sk : '');
      let line = clock(when) + ' ' + level.toUpperCase().padEnd(5) + ' [' + tag + '] ' + text;
      if (d !== undefined && def.humanData !== false) line += '  ' + JSON.stringify(d);
      line += '\n';
      enqueue(tg.file, line); tg.bytes += Buffer.byteLength(line);
      if (r.structured && tg.jfile) {
        const rec = { t: when.getTime(), lv: level, ch: def.name, st: known ? sk : undefined, m: text };
        if (d !== undefined) rec.d = d;
        const jl = JSON.stringify(rec) + '\n';
        enqueue(tg.jfile, jl); tg.jbytes += Buffer.byteLength(jl);
      }
      counters.written++;
      if (LEVELS[level] >= LEVELS.warn && def.name !== 'Errors') emit('Errors', null, level, '[' + tag + '] ' + text, undefined, when.getTime());
      return true;
    } catch (e) { onInternal('emit failed: ' + (e && e.message)); return false; }
  }

  // A channel handle: log.channel('Tasks', 'slayer').info('message', { data })
  function channel(name, stream) {
    const nm = CHANNELS[name] ? name : 'Plugins';
    const h = { name: nm, stream: stream || null, log: (lv, msg, data) => emit(nm, stream, lv, msg, data) };
    LEVEL_NAMES.forEach((lv) => { h[lv] = (msg, data) => emit(nm, stream, lv, msg, data); });
    return h;
  }
  // Legacy entry { t, cat, sub, text } from the watcher/supervisor, optionally already carrying { ch, level, stream, data }.
  function write(entry) {
    try {
      if (!entry) return;
      const ch = legacyChannel(entry);
      const sub = entry.sub && entry.sub !== 'supervisor' && ch === 'Discord' ? '(' + entry.sub + ') ' : '';
      emit(ch, entry.stream, legacyLevel(entry), sub + String(entry.text || ''), entry.data, entry.t);
    } catch (e) { /* never */ }
  }
  // Entries drained from the in-game plugins: { t, ch, st, lv, m, d }. All of it is untrusted: names are looked up, never used as paths.
  function ingest(entries, meta) {
    let n = 0;
    try {
      if (!Array.isArray(entries)) return 0;
      for (const e of entries.slice(0, 2000)) {
        if (!e || typeof e !== 'object') continue;
        const ch = CHANNELS[e.ch] && e.ch !== 'Errors' ? e.ch : 'Plugins';
        const t = Number.isFinite(e.t) && e.t > 0 && e.t < Date.now() + 86400000 ? e.t : now();
        if (emit(ch, typeof e.st === 'string' ? e.st : null, e.lv, typeof e.m === 'string' ? e.m : String(e.m), e.d, t)) n++;
      }
      if (meta && meta.dropped > 0) emit('Plugins', null, 'warn', 'in-game log buffer overflowed: ' + meta.dropped + ' line(s) lost');
    } catch (e) { /* never */ }
    return n;
  }

  // ---- retention ------------------------------------------------------------------------------------------------
  function openFiles() { const s = new Set(); for (const t of targets.values()) { s.add(t.file); if (t.jfile) s.add(t.jfile); } return s; }
  function prune(chName, force) {
    const t0 = Date.now();
    if (!force && t0 - (pruned.get(chName) || 0) < PRUNE_EVERY_MS) return 0;
    pruned.set(chName, t0);
    const def = CHANNELS[chName]; if (!def) return 0;
    const r = resolve(chName), d = path.join(dir, def.dir), open = openFiles();
    let removed = 0;
    try {
      const files = [];
      for (const f of fs.readdirSync(d)) {
        if (!FILE_RE.test(f)) continue;                 // only ever touch our own files
        const p = path.join(d, f);
        if (open.has(p)) continue;
        let st; try { st = fs.statSync(p); } catch (e) { continue; }
        files.push({ p, mtime: st.mtimeMs, size: st.size });
      }
      const keep = [];
      for (const f of files) { if (t0 - f.mtime > r.keepDays * 86400000) { try { fs.unlinkSync(f.p); removed++; } catch (e) { /* in use */ } } else keep.push(f); }
      keep.sort((a, b) => a.mtime - b.mtime);
      let total = keep.reduce((a, f) => a + f.size, 0);
      for (const f of keep) { if (total <= r.maxTotalBytes) break; try { fs.unlinkSync(f.p); total -= f.size; removed++; } catch (e) { /* in use */ } }
    } catch (e) { /* folder not created yet */ }
    return removed;
  }
  function pruneAll(force) { let n = 0; for (const k of Object.keys(CHANNELS)) n += prune(k, force); return n; }

  // ---- migration: flat Logs/<stamp>.log run logs -> Logs/System/System_<stamp>.log ------------------------------
  // Moves (renames), never deletes and never overwrites; a name clash gets a numeric suffix.
  function migrate() {
    const res = { moved: 0, errors: 0 };
    try {
      if (!fs.existsSync(dir)) return res;
      const dest = path.join(dir, CHANNELS.System.dir);
      for (const f of fs.readdirSync(dir)) {
        if (!LEGACY_RE.test(f)) continue;
        try {
          ensureDir(dest);
          let to = path.join(dest, 'System_' + f), i = 1;
          while (fs.existsSync(to)) { i++; to = path.join(dest, 'System_' + f.replace(/\.log$/, '') + '-' + i + '.log'); }
          fs.renameSync(path.join(dir, f), to);
          res.moved++;
        } catch (e) { res.errors++; }
      }
    } catch (e) { res.errors++; }
    return res;
  }
  function writeReadme() {
    try { ensureDir(dir); const p = path.join(dir, 'README.txt'); if (!fs.existsSync(p)) fs.writeFileSync(p, README); } catch (e) { /* ignore */ }
  }
  // Call once when the owning process starts.
  function start() { const m = migrate(); writeReadme(); return m; }

  // ---- introspection ---------------------------------------------------------------------------------------------
  function listFiles(chName) {
    const def = CHANNELS[chName]; if (!def) return [];
    const d = path.join(dir, def.dir), out = [];
    try {
      for (const f of fs.readdirSync(d)) {
        const m = FILE_RE.exec(f); if (!m) continue;
        let st; try { st = fs.statSync(path.join(d, f)); } catch (e) { continue; }
        out.push({ name: f, prefix: m[1], ext: m[4], size: st.size, mtime: st.mtimeMs });
      }
    } catch (e) { /* none yet */ }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  function info() {
    const c = config();
    const chans = Object.keys(CHANNELS).map((k) => {
      const fl = listFiles(k), r = resolve(k);
      return { name: k, dir: CHANNELS[k].dir, desc: CHANNELS[k].desc, structured: r.structured, files: fl.length, bytes: fl.reduce((a, f) => a + f.size, 0), newest: fl[0] ? fl[0].mtime : null, enabled: r.enabled, keepDays: r.keepDays };
    });
    const cur = targets.get('System/System');
    return Object.assign({ dir, files: chans.reduce((a, x) => a + x.files, 0), current: cur ? path.basename(cur.file) : null, channelList: chans, queued: pendingCount, dropped: droppedLines, counters: Object.assign({}, counters) }, c);
  }

  return { channel, write, ingest, emit, flush, flushSync, config, saveConfig, resolve, prune, pruneAll, migrate, start, info, listFiles, dir };
}

module.exports = { createLogSystem, normalizeConfig, DEFAULTS, FILE_RE, LEGACY_RE, CHANNELS, LEVELS };
