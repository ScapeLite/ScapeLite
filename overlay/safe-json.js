// Atomic JSON state files with recovery.
//
//   writeJsonAtomic(file, data, opts)  writes <file>.tmp, keeps the previous good copy as <file>.bak, then renames over <file>.
//                                      A crash or power loss leaves either the old file or the new one, never half of one.
//   readJsonRecover(file, fallback)    reads <file>; when it is missing, empty or truncated it falls back to salvaging the
//                                      readable part of an array, then to <file>.bak, then to `fallback`. Never throws.
//
// Used for every Discord state file (outbox, relayed keys, digest buffer, hiscores baseline, raid queue, board message id).
'use strict';

const fs = require('fs');

function renameReplace(from, to) {
  try { fs.renameSync(from, to); return; } catch (e) {
    // Windows can refuse a rename onto a file another process just closed: one short retry, then fall back to unlink + rename.
    if (!/EPERM|EBUSY|EACCES/.test(e.code || '')) throw e;
  }
  try { fs.unlinkSync(to); } catch (e2) { /* gone already */ }
  fs.renameSync(from, to);
}

function writeJsonAtomic(file, data, opts) {
  const o = opts || {};
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, o.indent || 0);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  if (o.backup !== false) {
    try { if (fs.statSync(file).size > 0) fs.copyFileSync(file, file + '.bak'); } catch (e) { /* no previous file */ }
  }
  renameReplace(tmp, file);
}

// The longest readable prefix of a truncated JSON array ("[1,2,{"a":" -> [1,2]). null when nothing can be saved.
function salvageArray(text) {
  const t = String(text || '').trimStart();
  if (t[0] !== '[') return null;
  let cut = t.length, tries = 0;
  while (cut > 1 && tries < 400) {
    cut = Math.max(t.lastIndexOf(',', cut - 1), 0);
    if (cut <= 0) break;
    tries++;
    try { const v = JSON.parse(t.slice(0, cut) + ']'); if (Array.isArray(v)) return v; } catch (e) { /* keep cutting */ }
  }
  try { return JSON.parse('[]'); } catch (e) { return null; }
}

function parseFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { missing: true }; }
  if (!text.trim()) return { empty: true, text };
  try { return { value: JSON.parse(text), text }; } catch (e) { return { corrupt: true, text }; }
}

// reads the file; `info` (optional object) receives { recovered: 'salvage'|'backup'|'fallback' } when the main file was unreadable
function readJsonRecover(file, fallback, info) {
  const main = parseFile(file);
  if (main.value !== undefined) return main.value;
  if (main.missing) return fallback;
  if (info) info.recovered = 'fallback';
  if (main.corrupt) {
    const part = salvageArray(main.text);
    // keep the broken file for inspection (one copy), then continue with what could be saved
    try { fs.copyFileSync(file, file + '.corrupt'); } catch (e) { /* best effort */ }
    const bak = parseFile(file + '.bak');
    if (bak.value !== undefined && (!part || (Array.isArray(bak.value) && bak.value.length > part.length) || !Array.isArray(bak.value))) { if (info) info.recovered = 'backup'; return bak.value; }
    if (part) { if (info) info.recovered = 'salvage'; return part; }
  }
  const bak = parseFile(file + '.bak');
  if (bak.value !== undefined) { if (info) info.recovered = 'backup'; return bak.value; }
  return fallback;
}

module.exports = { writeJsonAtomic, readJsonRecover, salvageArray };
