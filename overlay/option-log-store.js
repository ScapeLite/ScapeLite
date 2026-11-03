// The Task Option Log on disk: State/option-log.json. The page side (option-log.js) hands finished rows to the watcher, which gives them to this store.
// Local only, capped, written atomically (safe-json.js). Each row is one set of options the game offered in a queue slot:
//   { g: signature, t: first seen (s), te: last seen (s), sel: the option selected last, init: 1 when it was already there at page load,
//     sp: { skill: share of the roll in % } at that moment, o: [{ k: "skill"|"slay", s: skill, a: activity or mob, n: node, q: quantity, l: lucky, ps, pa, pt: { id: % }, lv, lk }] }
// (ps = the skill's share of the roll in %, pa = the activity's share in its skill or the mob's share for the master, lv = lever, lk = lucky chance)
'use strict';
const fs = require('fs');
const { writeJsonAtomic, readJsonRecover } = require('./safe-json');

const SCHEMA = 1, DEFAULT_CAP = 2500, DEDUPE_WINDOW = 400;

function createStore(file, opts) {
  const cap = (opts && opts.cap) || DEFAULT_CAP;
  let doc = null, dirty = false;
  const load = () => {
    if (doc) return doc;
    const d = readJsonRecover(file, null);
    doc = d && Array.isArray(d.rows) ? { v: SCHEMA, rows: d.rows } : { v: SCHEMA, rows: [] };
    return doc;
  };
  // Only rows with a signature and at least two options are kept. The same set of options is never stored twice: after a page reload the
  // sets still on screen are found again, so the last DEDUPE_WINDOW signatures are checked.
  function ingest(rows) {
    const d = load(), seen = new Set(d.rows.slice(-DEDUPE_WINDOW).map((r) => r.g));
    let added = 0;
    for (const r of rows || []) {
      if (!r || typeof r.g !== 'string' || !Array.isArray(r.o) || r.o.length < 2 || seen.has(r.g)) continue;
      seen.add(r.g); d.rows.push(r); added++;
    }
    if (d.rows.length > cap) d.rows.splice(0, d.rows.length - cap);
    if (added) dirty = true;
    return added;
  }
  function save() {
    if (!dirty || !doc) return false;
    writeJsonAtomic(file, doc, { backup: false });
    dirty = false;
    return true;
  }
  function stats() {
    const d = load(); let bytes = 0; try { bytes = fs.statSync(file).size; } catch (e) { /* not written yet */ }
    return { rows: d.rows.length, bytes, first: d.rows.length ? d.rows[0].t : null, last: d.rows.length ? d.rows[d.rows.length - 1].t : null };
  }
  return { load, ingest, save, stats, get file() { return file; } };
}

module.exports = { createStore, SCHEMA, DEFAULT_CAP };
