// npm run test:advisor
// overlay/advisor-core.js: the adapters (locations, goals, route, lever, tree) and the ranking of the Universal Advisor, on plain snapshots. No game, no network.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const A = require('../overlay/advisor-core.js');
const D = require('../overlay/diary-credits-core.js');
const diary = () => D.build(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'diary-fixture.json'), 'utf8')));

let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); } };

const route = (over) => Object.assign({ followed: 'skill', sig: '1:0,0:1', info: { skill: { shown: true, gain: 0.05, reasons: [] } },
  plans: { skill: [{ row: 1, opt: 0, label: 'oak logs x40', node: 'oak_grove', pickChanged: false }, { row: 0, opt: 1, label: 'iron ore x60', node: 'iron_mine', pickChanged: true }] }, curWalkSec: 1800, recWalkSec: 600 }, over || {});
const lever = (over) => Object.assign({ page: 'skill', route: 'mine', pulls: 2, rels: 1, gain: 3.2, credits: 25 }, over || {});
const goals = () => ({
  pinItems: [], hunts: [{ m: { id: 'wolf', name: 'Wolf', kills: 120 }, x: { id: 'fang', name: 'Wolf Fang', n: 500 }, hrs: 6.2, trained: false }, { m: { id: 'bear', name: 'Bear', kills: 0 }, x: { id: 'claw', name: 'Bear Claw', n: 100 }, hrs: 2, trained: true }],
  pinSkill: [], skillRows: [{ sk: 'mine', target: 60, left: 12000, hr: 4.5, rate: 2666, lvl: 59, next: { sk: 'mine', target: 60, left: 12000, hr: 4.5, rate: 2666, lvl: 59 } }],
});
const tree = (over) => Object.assign({ key: 'fortify', name: 'Fortify', cur: ['a', 'b', 'c'], curScore: 10, best: { ids: ['a', 'b', 'd'], score: 11 } }, over || {});

console.log('adapters');
test('every adapter returns [] for a missing or empty input and never throws', () => {
  [A.fromLocations, A.fromGoals, A.fromRoute, A.fromLever, A.fromTree].forEach((f) => { assert.deepStrictEqual(f(null), []); assert.deepStrictEqual(f(undefined), []); assert.deepStrictEqual(f({}), []); });
});
test('locations: one action per skill with a free plan, class B, in the setup lane, best saving first', () => {
  const l = A.fromLocations(diary()).filter((a) => a.id.endsWith(':free'));
  assert.deepStrictEqual(l.map((a) => a.id), ['loc:mine:free', 'loc:fish:free', 'loc:smith:free']);
  assert(l.every((a) => a.lane === 'setup' && a.sure === 'B' && a.kind === 'location'));
  assert(l[0].score > l[1].score && l[1].score > l[2].score, 'ordered by walking saved per average task');
});
test('locations: What / How / Where name the locations, the target positions and the steps in the game', () => {
  const a = A.fromLocations(diary())[0];
  assert(/^Place free pips on Mine locations: set .+ to [+-]\d/.test(a.what), a.what); assert(/s less walking per task/.test(a.what));
  assert(/Skills Customization/.test(a.how[0])); assert(a.how.some((h) => /^Set .+ from [+-]?\d to [+-]\d \(\d+ steps from its bank, rated (good|ok|bad)\), free$/.test(h)), a.how.join(' | '));
  assert(a.where.length >= 1 && a.where.every((w) => w.id && w.name));
  assert.strictEqual(a.gain.kind, 'walk'); assert.strictEqual(a.cost.credits, 0); assert(/no credits/.test(a.cost.text));
});
test('locations: they say they change walking, not the XP rate, and what the claim leaves out', () => {
  const w = A.fromLocations(diary())[0].why.join(' ');
  assert(/saves walking, not the XP rate/.test(w)); assert(/half the straight difference/.test(w)); assert(/about a minute per task/.test(w));
});
test('locations: a paid move is class C and shows the credits; under 0.05 s per average task nothing is shown', () => {
  const m = diary(); m.loc.skills[0].paid = { moves: [{ node: m.loc.skills[0].rows[0].node, from: 0, to: -3, saved: 1, cost: 35 }], saved: 1, savedAll: 0.2, cost: 35 };
  const p = A.fromLocations(m).find((a) => a.id === 'loc:' + m.loc.skills[0].skill + ':paid');
  assert.strictEqual(p.sure, 'C'); assert.strictEqual(p.cost.credits, 35); assert(/Buy /.test(p.what));
  const tiny = diary(); tiny.loc.skills.forEach((s) => { s.free.savedAll = 0.01; s.paid.savedAll = 0; }); assert.deepStrictEqual(A.fromLocations(tiny), []);
});
test('locations: the diary itself is never advised (no diary action kind exists)', () => {
  const kinds = {}; A.build({ diary: diary() }, { showUncertain: true }).byLane.setup.forEach((a) => { kinds[a.kind] = 1; });
  assert.deepStrictEqual(Object.keys(kinds), ['location']);
});
test('goals: pinned hunts lead; hunts are in the hunts lane and keep their own unit (time)', () => {
  const g = goals(); g.pinItems = [{ m: { id: 'rat', name: 'Rat', kills: 1 }, x: { id: 'tail', name: 'Rat Tail', n: 50 }, hrs: 30, trained: false }];
  const l = A.rankLane(A.fromGoals(g));
  assert.strictEqual(l[0].id, 'hunt:rat:tail', 'pinned first even though it is the slowest');
  assert(l.every((a) => a.lane === 'hunts')); assert(l.find((a) => a.kind === 'hunt').gain.kind === 'time');
  assert.strictEqual(l[1].id, 'hunt:bear:claw', 'a tool for a skill you train beats a faster plain drop? here it is faster too');
});
test('goals: a skill target shows the time at your pace', () => {
  const a = A.fromGoals(goals()).find((x) => x.kind === 'goal'); assert(/Mine 60/.test(a.what)); assert.strictEqual(a.gain.value, 4.5);
});
test('route: a shown better order becomes a "now" action with the moves in order', () => {
  const a = A.fromRoute(route())[0];
  assert.strictEqual(a.lane, 'now'); assert.strictEqual(a.sure, 'B');
  assert(/2 of 2 tasks move/.test(a.what)); assert(/5\.0%/.test(a.what));
  assert.strictEqual(a.how[0], 'Put "oak logs x40" in place 1 (now 2)');
  assert(Math.abs(a.gain.hours - A.HORIZON_H * 0.05 / 1.05) < 1e-9, 'time saved over the 24 h horizon: the same work in 1/(1+gain) of the time');
  assert(/walking drops by 20 min/.test(a.cost.text));
});
test('route: nothing shown, nothing suggested', () => {
  assert.deepStrictEqual(A.fromRoute(route({ info: { skill: { shown: false, gain: 0 } } })), []);
  assert.deepStrictEqual(A.fromRoute(route({ plans: {} })), []);
});
test('route: a task that only changes its option (same place) still counts as a move', () => {
  const r = route({ plans: { skill: [{ row: 0, opt: 1, label: 'iron ore x60', node: 'iron_mine', pickChanged: true }] } });
  assert(/1 of 1 tasks move/.test(A.fromRoute(r)[0].what));
});
test('lever: class B (calibrated rates), ranked by gain, with the credits it costs and the caveats', () => {
  const a = A.fromLever(lever())[0];
  assert.strictEqual(a.sure, 'B'); assert.strictEqual(a.lane, 'levers'); assert.strictEqual(a.cost.credits, 25); assert(/3\.2%/.test(a.what)); assert(/25 credits/.test(a.what));
  assert(a.why.some((w) => /1\.08 to 1\.26/.test(w)), 'says how far the lever base is known'); assert(a.why.some((w) => /Location levers/.test(w)));
  assert.deepStrictEqual(A.fromLever(lever({ pulls: 0, rels: 0 })), []);
});
test('lever: a credit-costing change under 1% is not suggested; a free one or a refund only has to be positive', () => {
  assert.deepStrictEqual(A.fromLever(lever({ gain: 0.9, credits: 25 })), []);
  assert.strictEqual(A.fromLever(lever({ gain: 0.6, credits: 0 })).length, 1);
  assert.deepStrictEqual(A.fromLever(lever({ gain: 0.4, credits: 0 })), [], 'under half a percent is noise even when free');
  assert(/refund of 5 credits/.test(A.fromLever(lever({ gain: 0.6, credits: -5 }))[0].what));
  assert.deepStrictEqual(A.fromLever(lever({ gain: 0, credits: 0 })), [], 'no gain, nothing');
});
test('lever: the slay page carries the 1.5x per-task caveat; a node page would be class C', () => {
  assert(A.fromLever(lever({ page: 'slay', route: 'easy' }))[0].why.some((w) => /1\.5 times/.test(w)));
  assert.strictEqual(A.fromLever(lever({ page: 'node' }))[0].sure, 'C');
});
test('tree: only a clearly better build is an action, with take and refund counts', () => {
  const a = A.fromTree(tree())[0]; assert.strictEqual(a.lane, 'build'); assert(/1 to take, 1 to refund/.test(a.what)); assert(/10%/.test(a.what.replace('+10.0%', '+10%')) || /\+10/.test(a.what));
  assert.deepStrictEqual(A.fromTree(tree({ best: { ids: ['a', 'b', 'c'], score: 10 } })), [], 'same build');
  assert.deepStrictEqual(A.fromTree(tree({ best: { ids: ['a', 'b', 'd'], score: 10.01 } })), [], 'under half a percent');
});

console.log('summaries of the live objects');
const routeRes = (shown) => ({
  rows: [{ id: 1, opts: [{ node: 'a', label: 'oak x40', selected: true }, { node: 'b', label: 'iron x60', selected: false }] }, { id: 2, opts: [{ node: 'c', label: 'cook x10', selected: true }] }],
  paths: { followed: 'skill', tpOn: false, info: { skill: { shown, gain: 0.04, reasons: ['why'] }, combat: { shown: false, gain: 0 } }, cur: { withTp: { time: 100 }, noTp: { time: 900 } },
    skill: shown ? { plan: [{ row: 1, opt: 0 }, { row: 0, opt: 1 }], sig: '1:0,0:1', withTp: { time: 90 }, noTp: { time: 600 } } : null },
});
test('summariseRoute: the shown plan with labels, nodes, picks that change and the walking of both orders', () => {
  const r = A.summariseRoute(routeRes(true));
  assert.strictEqual(r.followed, 'skill'); assert.deepStrictEqual(r.plans.skill.map((p) => [p.label, p.node, p.pickChanged]), [['cook x10', 'c', false], ['iron x60', 'b', true]]);
  assert.strictEqual(r.curWalkSec, 900, 'teleports are off, so the no-teleport walk is used'); assert.strictEqual(r.recWalkSec, 600);
  const a = A.fromRoute(r)[0]; assert(/2 of 2 tasks move/.test(a.what)); assert(/walking drops by 5 min/.test(a.cost.text));
});
test('summariseRoute: nothing shown means no plan, and bad input gives null', () => {
  assert.deepStrictEqual(A.fromRoute(A.summariseRoute(routeRes(false))), []);
  assert.strictEqual(A.summariseRoute(null), null); assert.strictEqual(A.summariseRoute({}), null);
});
test('summariseLever: credits are the price of every move (pips cost K * 2^|p|)', () => {
  const dbg = { K: 5, rows: [{ p: 0, to: 2 }, { p: -1, to: -1 }, { p: 3, to: 1 }] };
  const l = A.summariseLever({ page: 'skill', route: 'mine', pulls: 1, rels: 1, gain: 2 }, dbg);
  assert.strictEqual(l.credits, 5 * (4 - 1) + 5 * (2 - 8), 'raise 0 to 2 costs 15, lower 3 to 1 gives 30 back');
  assert.strictEqual(A.summariseLever({ pulls: 0, rels: 0 }, dbg), null);
});
test('summariseTree: copies the ids so the advisor cannot be changed through it', () => {
  const plan = { T: { key: 'fortify', name: 'Fortify' }, cur: ['a'], curScore: 1, best: { ids: ['a', 'b'], score: 2 } };
  const t = A.summariseTree(plan); t.cur.push('z'); t.best.ids.push('z'); assert.deepStrictEqual(plan.cur, ['a']); assert.deepStrictEqual(plan.best.ids, ['a', 'b']);
  assert.strictEqual(A.summariseTree({}), null);
});

console.log('ranking and the hero');
test('class C stays out of the lanes and the hero unless uncertain actions are asked for', () => {
  const r = A.build({ lever: lever({ page: 'node' }) });
  assert.strictEqual(r.hero, null); assert.strictEqual(r.empty, true); assert.strictEqual(r.hiddenUncertain, 1); assert.strictEqual(r.byLane.levers.length, 0);
  const u = A.build({ lever: lever({ page: 'node' }) }, { showUncertain: true });
  assert.strictEqual(u.hero.kind, 'lever'); assert.strictEqual(u.hiddenUncertain, 0);
});
test('the hero comes from the first lane that has a ranked action: now, levers, setup, hunts, build', () => {
  const inp = { route: route(), lever: lever(), diary: diary(), goals: goals(), tree: tree() };
  assert.strictEqual(A.build(inp).heroLane, 'now');
  assert.strictEqual(A.build(Object.assign({}, inp, { route: null })).heroLane, 'levers');
  assert.strictEqual(A.build(Object.assign({}, inp, { route: null, lever: null })).heroLane, 'setup');
  assert.strictEqual(A.build({ goals: goals(), tree: tree() }).heroLane, 'hunts');
  assert.strictEqual(A.build({ tree: tree() }).heroLane, 'build');
  assert.strictEqual(A.build({}).hero, null);
});
test('an uncalibrated (class C) action never beats a measured location action, even with a huge claimed gain', () => {
  const r = A.build({ diary: diary(), lever: lever({ page: 'node', gain: 500 }) });
  assert.strictEqual(r.hero.kind, 'location');
});
test('lanes are ranked on their own scores', () => {
  const r = A.build({ diary: diary(), goals: goals() });
  assert.deepStrictEqual(r.byLane.setup.map((a) => a.kind), ['location', 'location', 'location']); assert.strictEqual(r.byLane.levers.length, 0);
  assert.strictEqual(r.byLane.hunts[0].id, 'hunt:bear:claw', 'two hours beats six');
});
test('the hero does not flicker: the previous one stays unless clearly beaten', () => {
  const m = diary(), first = A.build({ diary: m }).hero;
  assert.strictEqual(first.id, 'loc:mine:free');
  const m2 = JSON.parse(JSON.stringify(m)), fish = m2.loc.skills.find((x) => x.skill === 'fish'), mine = m2.loc.skills.find((x) => x.skill === 'mine');
  fish.free.savedAll = mine.free.savedAll * 1.1;   // fish now a bit better
  const kept = A.build({ diary: m2 }, { prevHero: first.id });
  assert.strictEqual(kept.hero.id, first.id, 'within the margin');
  fish.free.savedAll = mine.free.savedAll * 2;
  const moved = A.build({ diary: m2 }, { prevHero: first.id });
  assert.notStrictEqual(moved.hero.id, first.id, 'a clear win replaces it');
});
test('the previous hero is dropped when it is gone', () => {
  assert.strictEqual(A.build({ tree: tree() }, { prevHero: 'nope' }).hero.kind, 'tree');
});
test('sources list says which inputs were there', () => {
  const r = A.build({ diary: diary() }); assert.strictEqual(r.sources.find((s) => s.name === 'Locations and Free Pips').has, true); assert.strictEqual(r.sources.find((s) => s.name === 'Route Advisor').has, false);
});
test('actions have the full shape', () => {
  const r = A.build({ route: route(), diary: diary(), goals: goals(), tree: tree(), lever: lever() }, { showUncertain: true });
  Object.keys(r.byLane).forEach((l) => r.byLane[l].forEach((a) => {
    ['id', 'kind', 'lane', 'what', 'how', 'where', 'gain', 'cost', 'sure', 'why', 'score'].forEach((k) => assert(k in a, a.id + ' missing ' + k));
    assert(['A', 'B', 'C'].includes(a.sure)); assert(a.what.length > 5); assert(Array.isArray(a.how));
  }));
});

console.log(failed ? `\n${failed} failed, ${pass} passed` : `\n${pass} passed`);
process.exit(failed ? 1 : 0);
