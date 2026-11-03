// ScapeLite roadmap: data store shared by the dashboard route (server.js) and the CLI (scripts/roadmap.js).
// Local project management only: nothing here touches the game. Data: roadmap/roadmap.json (committed, human readable).
// Writes are atomic (temp file, fsync, rename), the file is never left empty, and the last 20 versions are kept in roadmap/history/.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const FILE = path.join(DIR, 'roadmap.json');
const HIST = path.join(DIR, 'history');
const PUB = path.join(DIR, 'public');
const KEEP = 20;              // history versions kept
const SNAP_EVERY_MS = 120000; // a burst of saves makes one history version
const STATUSES = ['idea', 'planned', 'doing', 'done', 'wontdo'];
const STATUS_LABEL = { idea: 'Ideas', planned: 'Planned', doing: 'Doing now', done: 'Done', wontdo: "Won't do" };

function today() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

function validate(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('roadmap must be an object');
  if (!Array.isArray(doc.areas) || !doc.areas.length) throw new Error('roadmap needs areas');
  if (!Array.isArray(doc.items)) throw new Error('roadmap needs items');
  const areas = new Set(doc.areas.map((a) => a && a.id)), seen = new Set();
  doc.items.forEach((it) => {
    if (!it || typeof it !== 'object') throw new Error('bad item');
    if (typeof it.id !== 'string' || !it.id) throw new Error('item without id');
    if (seen.has(it.id)) throw new Error('duplicate id ' + it.id);
    seen.add(it.id);
    if (typeof it.title !== 'string') throw new Error('item without title: ' + it.id);
    if (!areas.has(it.area)) throw new Error('unknown area on ' + it.id);
    if (!STATUSES.includes(it.status)) throw new Error('bad status on ' + it.id);
  });
  return doc;
}

function readFile(file) { const t = fs.readFileSync(file, 'utf8'); if (!t.trim()) throw new Error('empty file'); return validate(JSON.parse(t)); }

function histFiles() { try { return fs.readdirSync(HIST).filter((f) => /^roadmap-.*\.json$/.test(f)).sort(); } catch (e) { return []; } }

// Load the roadmap. A damaged or empty main file falls back to the newest readable history version.
function load() {
  try { return readFile(FILE); } catch (e) {
    const hs = histFiles().reverse();
    for (const h of hs) { try { return readFile(path.join(HIST, h)); } catch (e2) { /* next */ } }
    throw new Error('roadmap.json unreadable and no usable history: ' + e.message);
  }
}

function writeAtomic(file, text) {
  if (!text || text.length < 2) throw new Error('refusing to write an empty file');
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  let err = null;
  for (let i = 0; i < 8; i++) { try { fs.renameSync(tmp, file); return; } catch (e) { err = e; const t = Date.now() + 40; while (Date.now() < t) { /* brief wait, antivirus may hold the file */ } } }
  try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  throw err;
}

function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }

function snapshot() {
  if (!fs.existsSync(FILE)) return;
  const hs = histFiles(), last = hs[hs.length - 1];
  if (last) { const m = /^roadmap-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(last); if (m && Date.now() - new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() < SNAP_EVERY_MS) return; }
  try { readFile(FILE); } catch (e) { return; } // never snapshot a damaged file
  fs.mkdirSync(HIST, { recursive: true });
  let name = 'roadmap-' + stamp(new Date()) + '.json', n = 2;
  while (fs.existsSync(path.join(HIST, name))) name = 'roadmap-' + stamp(new Date()) + '-' + (n++) + '.json';
  fs.copyFileSync(FILE, path.join(HIST, name));
  histFiles().slice(0, -KEEP).forEach((f) => { try { fs.unlinkSync(path.join(HIST, f)); } catch (e) { /* ignore */ } });
}

// Save the whole document. expectRev (optional) = the rev the caller loaded; a mismatch means someone else saved first.
function save(doc, expectRev) {
  validate(doc);
  let cur = null; try { cur = readFile(FILE); } catch (e) { /* new or damaged */ }
  if (expectRev != null && cur && cur.rev !== expectRev) { const e = new Error('conflict'); e.code = 'conflict'; e.rev = cur.rev; throw e; }
  doc.rev = (cur ? cur.rev : (doc.rev || 0)) + 1;
  doc.updated = new Date().toISOString();
  snapshot();
  fs.mkdirSync(DIR, { recursive: true });
  writeAtomic(FILE, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

// ---- item helpers (used by the CLI; the page has its own copy of the same rules) ----
function areaOf(doc, key) {
  const k = String(key || '').toLowerCase();
  return doc.areas.find((a) => a.id === k) || doc.areas.find((a) => a.name.toLowerCase() === k) || doc.areas.find((a) => (a.short || '').toLowerCase() === k) || doc.areas.find((a) => a.name.toLowerCase().includes(k)) || null;
}
function newId(doc, area) {
  doc.counters = doc.counters || {};
  const p = area.id;
  let n = Math.max(doc.counters[p] || 0, 0);
  const used = new Set(doc.items.map((i) => i.id));
  do { n++; } while (used.has(p + '-' + String(n).padStart(3, '0')));
  doc.counters[p] = n;
  return p + '-' + String(n).padStart(3, '0');
}
function findItem(doc, ref) {
  const r = String(ref || '').trim();
  if (!r) return null;
  const byId = doc.items.find((i) => i.id.toLowerCase() === r.toLowerCase());
  if (byId) return byId;
  const num = /^\d+$/.test(r) ? r.padStart(3, '0') : null;
  if (num) { const m = doc.items.filter((i) => i.id.endsWith('-' + num)); if (m.length === 1) return m[0]; }
  const low = r.toLowerCase();
  const m = doc.items.filter((i) => i.title.toLowerCase().includes(low));
  return m.length === 1 ? m[0] : null;
}
function makeItem(doc, o) {
  const area = areaOf(doc, o.area);
  if (!area) throw new Error('unknown area: ' + o.area + ' (' + doc.areas.map((a) => a.id).join(', ') + ')');
  const day = today();
  const status = o.status || 'idea';
  return {
    id: newId(doc, area), title: String(o.title || '').trim(), notes: o.notes || '', area: area.id, status,
    priority: o.priority || 'P2', effort: o.effort || 'M', tags: o.tags || [], source: o.source || 'claude',
    created: day, updated: day, done: status === 'done' ? day : '', links: o.links || [], public: !!o.public,
    milestone: o.milestone || '', summary: o.summary || '', reason: ''
  };
}
function setStatus(it, status, extra) {
  const day = today();
  it.status = status; it.updated = day;
  if (status === 'done') { if (!it.done) it.done = day; } else it.done = '';
  if (status === 'wontdo') it.reason = (extra && extra.reason) || it.reason || ''; else it.reason = '';
  return it;
}

// ---- release notes (done items by date or milestone) ----
function changelogMd(doc, opt) {
  opt = opt || {};
  const done = doc.items.filter((i) => i.status === 'done' && (!opt.milestone || i.milestone === opt.milestone) && (!opt.since || (i.done || '') >= opt.since));
  const area = (id) => (doc.areas.find((a) => a.id === id) || {}).name || id;
  const out = ['# What changed', ''];
  if (opt.by === 'date') {
    const days = [...new Set(done.map((i) => i.done || 'undated'))].sort().reverse();
    days.forEach((d) => { out.push('## ' + d, ''); done.filter((i) => (i.done || 'undated') === d).forEach((i) => out.push('- ' + i.title + ' (' + area(i.area) + ')')); out.push(''); });
  } else {
    const ms = [...new Set(done.map((i) => i.milestone || 'Unversioned'))].sort().reverse();
    ms.forEach((m) => { out.push('## ' + m, ''); doc.areas.forEach((a) => { const l = done.filter((i) => (i.milestone || 'Unversioned') === m && i.area === a.id); if (l.length) { out.push('**' + a.name + '**', ''); l.forEach((i) => out.push('- ' + i.title)); out.push(''); } }); });
  }
  return out.join('\n');
}

// ---- public export: only items flagged public. Titles, summaries, milestones and statuses only (no notes, links or tags). ----
function publicData(doc) {
  const pub = doc.items.filter((i) => i.public && ['planned', 'doing', 'done'].includes(i.status));
  const area = (id) => (doc.areas.find((a) => a.id === id) || {}).name || id;
  const row = (i) => ({ id: i.id, title: i.title, summary: i.summary || '', area: area(i.area), milestone: i.milestone || '', done: i.done || '' });
  return {
    project: 'ScapeLite', generated: today(),
    milestones: (doc.milestones || []).map((m) => ({ id: m.id, status: m.status, date: m.date || '', title: m.title || '' })),
    now: pub.filter((i) => i.status === 'doing').map(row),
    next: pub.filter((i) => i.status === 'planned').map(row),
    shipped: pub.filter((i) => i.status === 'done').sort((a, b) => (b.done || '').localeCompare(a.done || '')).map(row)
  };
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function publicHtml(d) {
  const sec = (title, list, cls) => list.length ? '<section><h2>' + title + ' <small>' + list.length + '</small></h2><ul class="' + cls + '">' + list.map((i) =>
    '<li><b>' + esc(i.title) + '</b>' + (i.milestone ? ' <span class="ms">' + esc(i.milestone) + '</span>' : '') + (i.summary ? '<p>' + esc(i.summary) + '</p>' : '') + '<span class="ar">' + esc(i.area) + (i.done ? ' &middot; ' + esc(i.done) : '') + '</span></li>').join('') + '</ul></section>' : '';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ScapeLite roadmap</title>\n<style>' +
    ':root{--bg:#10101a;--bg2:#161620;--bg3:#1c1c28;--line:#2e2e42;--text:#dcdce8;--dim:#8f8fa4;--accent:#ffd24a;--good:#5fe06d;--info:#4aa8ff}' +
    '@media (prefers-color-scheme:light){:root{--bg:#f5f5f8;--bg2:#fff;--bg3:#eeeef4;--line:#d6d6e2;--text:#1d1d2b;--dim:#5d5d72;--accent:#9a6b00;--good:#1f8a34;--info:#1769b0}}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,Segoe UI,sans-serif}main{max-width:820px;margin:0 auto;padding:32px 16px 64px}' +
    'h1{font-size:26px;margin:0 0 4px}h1+p{color:var(--dim);margin:0 0 24px}h2{font-size:17px;margin:28px 0 10px}h2 small{color:var(--dim);font-weight:400}' +
    'ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{background:var(--bg2);border:1px solid var(--line);border-left:3px solid var(--info);border-radius:10px;padding:10px 14px}' +
    'ul.now li{border-left-color:var(--accent)}ul.done li{border-left-color:var(--good)}li p{margin:4px 0 0;color:var(--dim);font-size:14px}.ms{font-size:12px;color:var(--accent);border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin-left:6px}' +
    '.ar{display:block;margin-top:4px;font-size:12px;color:var(--dim)}</style></head><body><main><h1>ScapeLite roadmap</h1><p>What we are working on, what is planned and what has shipped. Updated ' + esc(d.generated) + '.</p>' +
    sec('Working on now', d.now, 'now') + sec('Planned', d.next, 'next') + sec('Shipped', d.shipped, 'done') +
    (d.now.length + d.next.length + d.shipped.length ? '' : '<p>Nothing is marked public yet.</p>') + '</main></body></html>\n';
}
function exportPublic(doc) {
  const d = publicData(doc);
  fs.mkdirSync(PUB, { recursive: true });
  writeAtomic(path.join(PUB, 'roadmap.json'), JSON.stringify(d, null, 2) + '\n');
  writeAtomic(path.join(PUB, 'roadmap.html'), publicHtml(d));
  return { dir: PUB, files: ['roadmap.json', 'roadmap.html'], counts: { now: d.now.length, next: d.next.length, shipped: d.shipped.length } };
}

function history() {
  return histFiles().reverse().map((f) => { let s = null; try { s = fs.statSync(path.join(HIST, f)); } catch (e) { /* gone */ } return { file: f, size: s ? s.size : 0, time: s ? s.mtimeMs : 0 }; });
}
function readHistory(file) {
  if (!/^roadmap-[0-9-]+\.json$/.test(file)) throw new Error('bad history name');
  return readFile(path.join(HIST, file));
}

module.exports = { FILE, HIST, PUB, STATUSES, STATUS_LABEL, today, validate, load, save, areaOf, newId, findItem, makeItem, setStatus, changelogMd, publicData, publicHtml, exportPublic, history, readHistory };
