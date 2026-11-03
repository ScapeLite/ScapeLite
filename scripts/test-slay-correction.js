// npm run test:slay-correction
// The measured correction for slay task totals and ETAs (overlay/task-log.js slayFactorOf / slayK): learned from the newest finished slay tasks, clamped, with 1.5
// as the fallback; rates and the logged predictions stay the game's own. No game needed.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

const src = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'task-log.js'), 'utf8');
function load(setting) {
  const store = {};
  const win = { addEventListener() {}, removeEventListener() {}, __ccPluginSettings: { get: (k) => (k === 'slayCorrection' ? setting : undefined) } };
  const ctx = { window: win, document: { hidden: true, createElement: () => ({}), body: {} }, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setInterval: () => 1, clearInterval() {}, setTimeout, Date, Math, JSON, Number, Set, Map, Object, Array, Blob: function () {}, URL: {}, console };
  vm.runInNewContext(src, ctx);
  return { T: win.__ccTaskLog, store };
}
// a finished slay task: predicted 1000 s and 10000 XP, took 1000 * tr seconds, paid 10000 * xr
const task = (i, tr, xr, extra) => Object.assign({ ts: 1000 + i, kind: 'slay', completed: true, partial: false, done: 70, qty: 70, lucky: false, secs: { total: 1000 * tr + 200, acting: 1000 * tr }, xp: { slay: 4000 * xr, heft: 6000 * xr, luck: 99999 }, pred: { dash: 1000, xp: 10000 }, v: 2 }, extra || {});
const many = (n, tr, xr) => Array.from({ length: n }, (_, i) => task(i, tr, xr));
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, 'expected ' + b + ', got ' + a);

test('with fewer than 5 finished slay tasks the fallback 1.5 is used and called an estimate', () => {
  const { T } = load(); const k = T.slayFactorOf(many(4, 1.1, 1.1)); near(k.t, 1.5); near(k.x, 1.5); assert.strictEqual(k.measured, false); assert.strictEqual(k.n, 4);
});
test('with enough tasks it is the median of real / predicted, for time and for XP separately', () => {
  const { T } = load(); const k = T.slayFactorOf(many(10, 1.4, 1.6)); near(k.t, 1.4); near(k.x, 1.6); assert.strictEqual(k.measured, true);
});
test('Luck XP is not counted in the XP the game predicted', () => {
  const { T } = load(); near(T.slayFactorOf(many(6, 1, 1)).x, 1);   // the tasks above carry 99999 Luck XP each
});
test('a wild value is clamped to 0.8 .. 2.5', () => {
  const { T } = load(); near(T.slayFactorOf(many(8, 9, 9)).t, 2.5); near(T.slayFactorOf(many(8, 0.2, 0.2)).x, 0.8);
});
test('only the newest 15 count; partial, unfinished and remaining-time predictions are skipped; a lucky task is left out of the XP ratio', () => {
  const { T } = load(), old = Array.from({ length: 20 }, (_, i) => task(i, 3, 3)), recent = Array.from({ length: 15 }, (_, i) => task(100 + i, 1.2, 1.3));
  const junk = [task(200, 9, 9, { partial: true }), task(201, 9, 9, { completed: false }), task(202, 9, 9, { pred: { dash: 20, xp: 10000 } }), task(203, 9, 9, { done: 10 })];
  const k = T.slayFactorOf(old.concat(recent)); near(k.t, 1.2); near(k.x, 1.3);
  const k2 = T.slayFactorOf(recent.concat(junk.map((j, i) => Object.assign(j, { ts: 50 + i })))); near(k2.t, 1.2);   // the junk is also older, so it is out either way
  const k3 = T.slayFactorOf(many(6, 1.5, 1.5).map((r, i) => (i < 5 ? Object.assign(r, { lucky: true, xp: { slay: 3000 } }) : r)));
  assert.strictEqual(k3.measured, false, 'one normal task is too few for the XP ratio');
});
test('skilling tasks never count', () => {
  const { T } = load(); assert.strictEqual(T.slayFactorOf(many(10, 2, 2).map((r) => Object.assign(r, { kind: 'skill' }))).measured, false);
});
test('slayK reads the Task Log, gives the label and the switch turns it off', () => {
  const on = load(); on.store['cc-task-log'] = JSON.stringify(many(10, 1.4, 1.6));
  const k = on.T.slayK(); near(k.t, 1.4); assert(/Measured correction/.test(k.text) && /last 10 finished slay tasks/.test(k.text) && /XP an hour is not changed/.test(k.text), k.text);
  const est = load(); const e = est.T.slayK(); near(e.t, 1.5); assert(/Estimated correction/.test(e.text), e.text);
  const off = load(false); off.store['cc-task-log'] = JSON.stringify(many(10, 1.4, 1.6)); const o = off.T.slayK(); near(o.t, 1); near(o.x, 1); assert.strictEqual(o.off, true);
});
test('the logged prediction is the game’s raw number: the correction is never applied where the log is written', () => {
  const body = src.slice(src.indexOf('const getLedger'), src.indexOf('function slayFactorOf'));
  assert(!/slayK|slayFactorOf/.test(body), 'the recorder part of task-log.js does not use the correction');
});
test('the queue and the option cards use it for slay totals and not for XP an hour', () => {
  const q = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'ui-queue.js'), 'utf8'), b = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'ui-bar.js'), 'utf8');
  assert(/timeSec: \(op\.timeSec \|\| 0\) \* \(sk \? sk\.t : 1\)/.test(q) && /xp: \(op\.totalXp \|\| 0\) \* \(sk \? sk\.x : 1\)/.test(q) && /xpHr: op\.xpHr/.test(q), 'queue: time and XP carry it, xpHr does not');
  assert(/fmtTime\(o\.timeSec \* \(sk \? sk\.t : 1\)\)/.test(b) && /num\(o\.totalXp \* \(sk \? sk\.x : 1\)\)/.test(b) && /L\.push\(\['XP \/ hour', num\(o\.xpHr\)\]\)/.test(b), 'option card: time and XP carry it, XP / hour does not');
  const ra = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'route-advisor.js'), 'utf8'); assert(!/slayK/.test(ra), 'the Route Advisor never sees it');
});

console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ': ' + pass + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
