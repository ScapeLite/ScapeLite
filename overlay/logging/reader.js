// ScapeLite logging: read side. Browse channels and files, tail, search, and rebuild history (e.g. the Task Log) from the
// structured .jsonl files. Used by the dashboard's log viewer (/logs) and by the Task Log recovery. Read-only; every
// name coming from a request is checked against the channel registry and the file-name pattern, so it can never
// reach outside Logs/<Channel>/.
'use strict';

const fs = require('fs');
const path = require('path');
const { CHANNELS, LEVELS } = require('./channels');
const { FILE_RE } = require('./index');

const TAIL_BYTES = 512 * 1024;       // how much of the end of a file a tail/search reads
const SEARCH_LIMIT = 500;

function createReader(sys) {
  const chanDir = (name) => (CHANNELS[name] ? path.join(sys.dir, CHANNELS[name].dir) : null);
  function filePath(ch, file) {
    const d = chanDir(ch);
    if (!d || typeof file !== 'string' || !FILE_RE.test(file)) return null;
    return path.join(d, file);
  }
  function readTail(p, bytes) {
    const st = fs.statSync(p);
    const start = Math.max(0, st.size - bytes);
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the cut first line
      return { text, size: st.size, truncated: start > 0 };
    } finally { fs.closeSync(fd); }
  }

  // Channels with their files, newest first.
  function overview() {
    const i = sys.info();
    return { dir: sys.dir, channels: i.channelList.map((c) => Object.assign({}, c, { list: sys.listFiles(c.name) })) };
  }
  // The last n lines of a file, optionally only those containing q and/or at least a level.
  function tail(ch, file, o) {
    o = o || {};
    const p = filePath(ch, file);
    if (!p) return { ok: false, error: 'unknown file' };
    try {
      const n = Math.min(2000, Math.max(1, Math.round(Number(o.lines)) || 200));
      const r = readTail(p, TAIL_BYTES);
      let lines = r.text.split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      const q = o.q ? String(o.q).toLowerCase() : '';
      const min = LEVELS[o.level] || 0;
      if (q || min) {
        lines = lines.filter((l) => {
          if (q && !l.toLowerCase().includes(q)) return false;
          if (min) { const m = /^\S+ \S+ (DEBUG|INFO|WARN|ERROR)\b/.exec(l); if (m && LEVELS[m[1].toLowerCase()] < min) return false; }
          return true;
        });
      }
      return { ok: true, file, size: r.size, truncated: r.truncated, lines: lines.slice(-n) };
    } catch (e) { return { ok: false, error: 'cannot read' }; }
  }
  // Case-insensitive text search across the newest files of a channel (or of every channel).
  function search(q, o) {
    o = o || {};
    q = String(q || '').toLowerCase();
    if (q.length < 2) return { ok: false, error: 'search for at least 2 characters' };
    const chans = o.channel && CHANNELS[o.channel] ? [o.channel] : Object.keys(CHANNELS);
    const hits = [];
    outer:
    for (const ch of chans) {
      for (const f of sys.listFiles(ch).filter((x) => x.ext === 'log').slice(0, 12)) {
        let text = '';
        try { text = readTail(path.join(chanDir(ch), f.name), TAIL_BYTES).text; } catch (e) { continue; }
        for (const l of text.split(/\r?\n/)) {
          if (l.toLowerCase().includes(q)) { hits.push({ channel: ch, file: f.name, line: l }); if (hits.length >= SEARCH_LIMIT) break outer; }
        }
      }
    }
    return { ok: true, q, count: hits.length, capped: hits.length >= SEARCH_LIMIT, hits };
  }
  // Every structured record of a channel, oldest first, from all its .jsonl files. Each item is the parsed line
  // { t, lv, ch, st, m, d }. `stream` narrows to one sub-stream (e.g. 'slayer').
  function records(ch, o) {
    o = o || {};
    const d = chanDir(ch);
    if (!d) return [];
    const out = [];
    let files = [];
    try { files = fs.readdirSync(d).filter((f) => FILE_RE.test(f) && f.endsWith('.jsonl')).sort(); } catch (e) { return out; }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(d, f), 'utf8'); } catch (e) { continue; }
      for (const l of text.split('\n')) {
        if (!l) continue;
        try {
          const r = JSON.parse(l);
          if (r && typeof r === 'object' && (!o.stream || r.st === o.stream)) out.push(r);
        } catch (e) { /* a half-written last line */ }
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  // The Task Log rebuilt from Logs/Tasks/*.jsonl: the original task records, de-duplicated, oldest first.
  function taskRecords() {
    const seen = new Set(), out = [];
    for (const r of records('Tasks')) {
      const rec = r.d && typeof r.d === 'object' && r.d.rec && typeof r.d.rec === 'object' ? r.d.rec : null;
      if (!rec || !rec.ts) continue;
      const k = rec.ts + '|' + rec.kind + '|' + rec.act + '|' + rec.qty;
      if (seen.has(k)) continue;
      seen.add(k); out.push(rec);
    }
    return out;
  }
  return { overview, tail, search, records, taskRecords, filePath };
}

module.exports = { createReader };
