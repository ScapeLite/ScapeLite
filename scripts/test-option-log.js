// npm run test:option-log
// The Task Option Log: the page-side recorder (overlay/option-log.js, run against a fake bridge), the file store (overlay/option-log-store.js) and the report
// (scripts/option-log-report.js, run on logs made from known odds). No game needed.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { createStore } = require('../overlay/option-log-store');
const { analyse, MIN_DRAWS } = require('./option-log-report');

let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

// ---------------------------------------------------------------- the page side, with a fake bridge
function page(opts) {
  const timers = [], win = { __ccPluginSettings: { get: (k) => (k === 'optionLogEnabled' ? opts.enabled !== false : undefined) } };
  const state = { slots: [] };
  win.__ccBridge = {
    project: () => ({ slots: state.slots }),
    oddsSkills: () => [{ id: 'fish', pct: 8, lever: 1, lucky: 0.04 }, { id: 'cook', pct: 12, lever: 2, lucky: 0.03 }, { id: 'quests', pct: 5, lever: 0, lucky: null, quests: true }],
    oddsTiers: (s) => [{ id: s + '_a', pct: 60, open: true }, { id: s + '_b', pct: 40, open: true }, { id: s + '_c', pct: 0, open: false }],
    oddsSlay: () => ({ mobs: [{ id: 'rat', pct: 70, open: true, lever: 0 }, { id: 'bat', pct: 30, open: true, lever: -1 }] }),
  };
  const ctx = { window: win, document: { hidden: false }, setInterval: (f) => { timers.push(f); return timers.length; }, clearInterval: () => {}, Date, Math, JSON, Number, Set, Map, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'overlay', 'option-log.js'), 'utf8'), ctx);
  return { win, state, log: win.__ccOptionLog };
}
const slot = (i, sel, ops) => ({ index: i, selected: sel, options: ops });
const sk = (s, a, n, lucky) => ({ kind: 'skill', skill: s, act: a, node: n, qty: 100, lucky: !!lucky });
const sl = (a, lucky) => ({ kind: 'slay', skill: 'slay', act: a, node: a, qty: 50, lucky: !!lucky });

test('a set of options becomes a row once it is gone, with the odds the game gave each option', () => {
  const p = page({}); p.state.slots = [slot(0, 1, [sl('rat'), sk('fish', 'fish_a', 'pier'), sk('cook', 'cook_b', 'inn', true)])];
  p.log.poll(); assert.strictEqual(p.log.drain(), null, 'nothing is handed over while the set is still on offer');
  p.state.slots[0].selected = 2; p.log.poll();
  p.state.slots = []; p.log.poll();
  const d = p.log.drain(); assert(d && d.rows.length === 1);
  const r = d.rows[0]; assert.strictEqual(r.sel, 2, 'the last selection is kept'); assert.strictEqual(r.init, 1, 'seen when the page loaded');
  assert.strictEqual(r.o.length, 3); assert.strictEqual(r.sp.fish, 8); assert(!('quests' in r.sp), 'the quest share is not a skill');
  const fish = r.o[1]; assert.strictEqual(fish.ps, 8); assert.strictEqual(fish.lv, 1); assert.strictEqual(fish.lk, 0.04); assert.strictEqual(fish.pa, 60); assert.strictEqual(JSON.stringify(fish.pt), JSON.stringify({ fish_a: 60, fish_b: 40 }));
  assert.strictEqual(r.o[2].l, 1); assert.strictEqual(r.o[0].pa, 70); assert.strictEqual(JSON.stringify(r.o[0].pt), JSON.stringify({ rat: 70, bat: 30 }));
});
test('a set seen later is not marked as present at load; the same set is only one row', () => {
  const p = page({}); p.log.poll();
  p.state.slots = [slot(0, 0, [sl('bat'), sk('fish', 'fish_b', 'pier'), sk('cook', 'cook_a', 'inn')])];
  p.log.poll(); p.log.poll(); p.state.slots = []; p.log.poll();
  const d = p.log.drain(); assert.strictEqual(d.rows.length, 1); assert.strictEqual(d.rows[0].init, 0);
});
test('a slot with fewer than two options is ignored; the log switch stops recording', () => {
  const p = page({}); p.state.slots = [slot(0, 0, [sk('fish', 'fish_a', 'pier')])]; p.log.poll(); p.state.slots = []; p.log.poll();
  assert.strictEqual(p.log.drain(), null);
  const q = page({ enabled: false }); q.state.slots = [slot(0, 0, [sl('rat'), sk('fish', 'fish_a', 'pier')])]; q.log.poll(); q.state.slots = []; q.log.poll();
  assert.strictEqual(q.log.drain(), null);
});
test('the rows hold no names or account data', () => {
  const p = page({}); p.state.slots = [slot(0, 0, [sl('rat'), sk('fish', 'fish_a', 'pier')])]; p.log.poll(); p.state.slots = []; p.log.poll();
  const text = JSON.stringify(p.log.drain());
  assert(!/player|name|clan|steam|email/i.test(text), text);
});

// ---------------------------------------------------------------- the store
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-optlog-'));
const row = (g, extra) => Object.assign({ g, t: 1, te: 2, sel: 0, o: [{ k: 'skill', s: 'fish', a: 'x', n: 'y' }, { k: 'skill', s: 'cook', a: 'x', n: 'y' }] }, extra);
test('the store keeps rows across a restart, once each, and writes atomically', () => {
  const f = path.join(tmp, 'a.json'); const s = createStore(f);
  assert.strictEqual(s.ingest([row('a'), row('b'), row('a'), { g: 'c', o: [{}] }, null]), 2, 'a duplicate, a one-option set and null are skipped');
  assert(s.save()); assert(!s.save(), 'nothing new: nothing written'); assert(!fs.existsSync(f + '.tmp'), 'no temp file left behind');
  const s2 = createStore(f); assert.strictEqual(s2.ingest([row('b'), row('d')]), 1, 'b is found again after a restart'); assert.strictEqual(s2.stats().rows, 3);
});
test('the store keeps only the newest rows', () => {
  const s = createStore(path.join(tmp, 'b.json'), { cap: 50 }); s.ingest(Array.from({ length: 80 }, (_, i) => row('r' + i)));
  const d = s.load(); assert.strictEqual(d.rows.length, 50); assert.strictEqual(d.rows[0].g, 'r30'); assert.strictEqual(d.rows[49].g, 'r79');
});
test('a damaged file is recovered, not fatal', () => {
  const f = path.join(tmp, 'c.json'); fs.writeFileSync(f, '{"v":1,"rows":[{"g":"a","o":[{},{}]},{"g":"b"'); const s = createStore(f);
  assert(Array.isArray(s.load().rows));
});

// ---------------------------------------------------------------- the report, on logs made from known odds
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SK = { fish: 20, cook: 30, mine: 10, smith: 40 }, ACT = { a: 50, b: 30, c: 20 }, LK = { fish: 0.04, cook: 0.03, mine: 0.035, smith: 0.03 };
function pick(r, tab) { let x = r() * Object.values(tab).reduce((t, v) => t + v, 0); for (const k of Object.keys(tab)) { x -= tab[k]; if (x <= 0) return k; } return Object.keys(tab)[0]; }
function makeLog(n, seed, luckBoost) {
  const r = rng(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const o = [{ k: 'slay', s: 'slay', a: 'rat', n: 'rat', l: r() < 0.03 ? 1 : 0, pt: { rat: 100 } }];
    for (let j = 0; j < 2; j++) { const s = pick(r, SK), a = pick(r, ACT); o.push({ k: 'skill', s, a, n: 'node', ps: SK[s], pa: ACT[a], lk: LK[s], l: r() < LK[s] * (luckBoost || 1) ? 1 : 0, pt: Object.assign({}, ACT) }); }
    rows.push({ g: 'g' + i, t: i, te: i + 1, sel: 0, sp: Object.assign({}, SK), o });
  }
  return rows;
}
test('a log with too few options says how far along it is', () => {
  const a = analyse(makeLog(20, 1)); assert.strictEqual(a.tests.skillMix.enough, false); assert.strictEqual(a.tests.skillMix.have, 40); assert.strictEqual(a.tests.skillMix.need, MIN_DRAWS);
});
test('options drawn from the stated odds pass every test', () => {
  const a = analyse(makeLog(900, 7)), t = a.tests;
  assert(t.skillMix.enough && t.skillMix.p > 0.01, 'skill mix p ' + t.skillMix.p);
  assert(t.activity.enough && t.activity.p > 0.01, 'activity p ' + t.activity.p);
  assert(Math.abs(t.luckySkilling.z) < 3, 'lucky z ' + t.luckySkilling.z);
  assert(Math.abs(t.pairIndependence.z) < 3, 'pair z ' + t.pairIndependence.z);
});
test('options that do not follow the odds are caught', () => {
  const biased = makeLog(900, 7, 3);   // three times the stated lucky chance
  assert(analyse(biased).tests.luckySkilling.z > 5, 'lucky z ' + analyse(biased).tests.luckySkilling.z);
  const r = rng(9), skew = makeLog(900, 11); skew.forEach((x) => x.o.forEach((o) => { if (o.k === 'skill' && r() < 0.5) { o.s = 'fish'; } }));
  assert(analyse(skew).tests.skillMix.p < 0.001, 'skew p ' + analyse(skew).tests.skillMix.p);
});

// ---------------------------------------------------------------- where it lives
test('the log is a State file: never packaged, the watcher and the settings know it', () => {
  const root = path.join(__dirname, '..'), w = fs.readFileSync(path.join(root, 'overlay', 'panel-resize-watcher.js'), 'utf8');
  assert(/id: 'option-log'/.test(w) && /option-log\.json/.test(w) && /drainOptionLog\(evalAwait\)/.test(w), 'registered and drained in the watcher');
  const ui = fs.readFileSync(path.join(root, 'overlay', 'plugins-settings-ui.js'), 'utf8'); assert(/key: 'optionLogEnabled'/.test(ui), 'has a switch');
  assert(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files.some((f) => /!\*\*\/State\/\*\*/.test(f)), 'State/ is excluded from the package');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ }
console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ': ' + pass + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
