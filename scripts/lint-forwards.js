// Forward lint.  npm run lint:forwards   (options: --list, --quiet, --update-baseline)
//
// ScapeLite is display only: the only way it acts in the game is by handing the user's own real click to a game control. Those hand-overs must stay in one
// place so they can be audited (docs/DISTRIBUTION-RISKS.md has the click-forwarding audit). This check finds every `.click()` and `.dispatchEvent(` call in
// overlay/*.js and overlay/cards/*.js and reports the ones that are not marked as an approved forward.
//
//   approved  = the line or the line above carries the marker `fwd-ok` in a comment, e.g.   el.click(); // fwd-ok: the user's click on the card button
//   baseline  = scripts/forwards-baseline.json holds how many unapproved calls each file had when the rule was introduced. The check FAILS when a file has
//               MORE than its baseline (a new, unmarked forward), or a new file has any. Existing sites are reported (--list), not refactored.
//               When you mark or remove sites, run --update-baseline to lower the numbers (it never raises them without --force).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), OV = path.join(ROOT, 'overlay'), BASE = path.join(__dirname, 'forwards-baseline.json');
const args = new Set(process.argv.slice(2));
const files = [];
for (const dir of [OV, path.join(OV, 'cards')]) { if (!fs.existsSync(dir)) continue; fs.readdirSync(dir).forEach((f) => { if (f.endsWith('.js')) files.push(path.join(dir, f)); }); }
const CALL = /\.click\(\)|\.dispatchEvent\(/g;
const found = {};   // rel path -> [{ line, text, approved }]
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/'), lines = fs.readFileSync(f, 'utf8').split(/\r?\n/), out = [];
  lines.forEach((ln, i) => {
    const t = ln.trim(); if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const code = ln.replace(/\/\/ .*$/, '').replace(/\/\*.*?\*\//g, '');   // (a call that only appears in a comment is not a call)
    const n = (code.match(CALL) || []).length; if (!n) return;
    const approved = /fwd-ok/.test(ln) || (i > 0 && /fwd-ok/.test(lines[i - 1]));
    for (let k = 0; k < n; k++) out.push({ line: i + 1, text: t.slice(0, 110), approved });
  });
  if (out.length) found[rel] = out;
}
const count = (rel) => (found[rel] || []).filter((s) => !s.approved).length;
let base = {}; try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (e) { base = null; }
if (args.has('--update-baseline')) {
  const next = {}; Object.keys(found).forEach((rel) => { const c = count(rel); const old = base && base[rel]; if (c > 0) next[rel] = (old != null && !args.has('--force')) ? Math.min(old, c) : c; });
  if (base === null) Object.keys(found).forEach((rel) => { if (count(rel) > 0) next[rel] = count(rel); });
  fs.writeFileSync(BASE, JSON.stringify(next, null, 2) + '\n'); console.log('baseline written: ' + Object.values(next).reduce((a, b) => a + b, 0) + ' unmarked sites in ' + Object.keys(next).length + ' files'); process.exit(0);
}
if (base === null) { console.log('no baseline yet: run  node scripts/lint-forwards.js --update-baseline'); process.exit(1); }
const bad = [], total = Object.keys(found).reduce((a, rel) => a + count(rel), 0), approved = Object.keys(found).reduce((a, rel) => a + found[rel].filter((s) => s.approved).length, 0);
Object.keys(found).forEach((rel) => { const c = count(rel), b = base[rel] || 0; if (c > b) bad.push({ rel, c, b }); });
if (args.has('--list')) Object.keys(found).forEach((rel) => found[rel].filter((s) => !s.approved).forEach((s) => console.log(rel + ':' + s.line + '  ' + s.text)));
if (!args.has('--quiet') || bad.length) bad.forEach((x) => { console.log('NEW unmarked forward in ' + x.rel + ': ' + x.c + ' sites, baseline ' + x.b + '. Mark the approved ones with  // fwd-ok  or put the call in a helper that is marked. (node scripts/lint-forwards.js --list)'); });
console.log((bad.length ? 'FAIL' : 'ok') + ': ' + total + ' unmarked .click()/.dispatchEvent sites (baseline ' + Object.values(base).reduce((a, b) => a + b, 0) + '), ' + approved + ' marked fwd-ok, ' + Object.keys(found).length + ' files');
process.exit(bad.length ? 1 : 0);
