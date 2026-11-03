// npm run test:diary
// overlay/diary-credits-core.js (pure arithmetic of the Locations and Free Pips panel: diary tiers, free pips, credit pools, location quality and where to put pips) on
// hand-made cases and on a trimmed copy of a real game state (scripts/fixtures/diary-fixture.json), and overlay/game-bridge.js diaryState() against a stub game state.
// No game, no network.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const core = require('../overlay/diary-credits-core.js');
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'diary-fixture.json'), 'utf8'));

let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); } };
const near = (a, b, eps, msg) => assert(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ' ' + a + ' vs ' + b);

console.log('prices and tiers');
test('a lever at p costs 5 * (2^|p| - 1); the next pip 5 * 2^|p|', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((p) => core.total(p)), [0, 5, 15, 35, 75, 155]);
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((p) => core.step(p)), [5, 10, 20, 40, 80]);
  assert.strictEqual(core.total(-3), core.total(3), 'sign does not matter');
  assert.strictEqual(core.total(2, 25), 75, 'total (skill) credits use 25');
});
test('the credits you actually pay are the price minus the pips the diary gives', () => {
  assert.strictEqual(core.paid(2, 1), 10); assert.strictEqual(core.paid(-2, 2), 0); assert.strictEqual(core.paid(3, 0), 35); assert.strictEqual(core.paid(1, 3), 0);
});
test('tier is the share of steps done: 20 / 40 / 60 / 80 / 100 percent', () => {
  assert.deepStrictEqual([0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100].map((c) => core.tierFor(c, 100)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  assert.strictEqual(core.tierFor(9, 23), 1, '9 / 23 = 39%, still tier 1'); assert.strictEqual(core.tierFor(10, 23), 2); assert.strictEqual(core.tierFor(0, 0), 0);
});
test('steps to the next tier, with a bank whose size does not divide by 5', () => {
  assert.strictEqual(core.stepsToNext(7, 23, 1), 3); assert.strictEqual(core.stepsToNext(18, 100, 0), 2); assert.strictEqual(core.stepsToNext(100, 100, 5), 0);
});

console.log('banks, free pips and credits (reference data)');
const base = () => ({
  banks: [{ id: 'a_bank', name: 'Alpha', total: 10, completed: 4, tier: 2 }, { id: 'z_bank', name: 'Zed', total: 10, completed: 0, tier: 0 }],
  nodes: [
    { id: 'a_mine', name: 'Alpha Mine', bank: 'a_bank', type: 'skill', acts: ['mine:copper', 'mine:tin'], d: 100 },
    { id: 'a_pond', name: 'Alpha Pond', bank: 'a_bank', type: 'skill', acts: ['fish:raw_shrimp'], d: 400 },
    { id: 'wolf_den', name: 'Wolf Den', bank: 'a_bank', type: 'combat', acts: [], d: null },
    { id: 'z_mine', name: 'Zed Mine', bank: 'z_bank', type: 'skill', acts: ['mine:copper'], d: 2000 },
  ],
  levers: { mine: { a_mine: 3, z_mine: -1 }, fish: { a_pond: -1 } }, levels: { mine: 10, fish: 5 }, haveLevers: true, credits: { total: 60, individual: { mine: 12, fish: 4 }, reroll: 100 },
});
test('saved credits and unused free pips come from the diary tier of the nearest bank', () => {
  const m = core.build(base()), a = m.banks.find((b) => b.name === 'Alpha');
  assert.strictEqual(a.pairs, 2, 'mine at the mine and fish at the pond; the combat node does not count'); assert.strictEqual(a.used, 2); assert.strictEqual(a.covered, 1, 'the +3 is past the free level 2');
  assert.strictEqual(a.saved, core.total(2) + core.total(1)); assert.strictEqual(a.freeUnused, 0 + 1, 'mine 0, pond 1 (tier 2 minus |-1|)');
  assert.strictEqual(a.need, 2, '4 of 10 is tier 2; tier 3 needs 6');
  assert.strictEqual(m.banks.find((b) => b.name === 'Zed').saved, 0, 'a tier-0 bank pays nothing');
  assert.strictEqual(m.pips.saved, a.saved); assert.strictEqual(m.pips.freeUnused, a.freeUnused);
});
test('credit pools, first pips you can buy, per skill', () => {
  const c = core.build(base()).credits;
  assert.strictEqual(c.total, 60); assert.strictEqual(c.totalFirstSteps, 2); assert.strictEqual(c.reroll, 100);
  const mine = c.individual.find((r) => r.skill === 'mine'); assert.strictEqual(mine.firstPips, 2); assert.strictEqual(mine.credits, 12); assert.strictEqual(c.individualTotal, 16);
});
test('no state, no model', () => { assert.strictEqual(core.build(null), null); assert.strictEqual(core.build({}), null); assert.strictEqual(core.locations({ banks: [] }), null); });

console.log('location quality and where to put pips, by hand');
// one skill, one activity, three places 100 / 500 / 2000 steps from their banks, all banks at tier 2, you walk 20 steps a second
const loc = (over) => Object.assign({
  banks: [{ id: 'b1', name: 'One', total: 10, completed: 4, tier: 2 }, { id: 'b2', name: 'Two', total: 10, completed: 4, tier: 2 }, { id: 'b3', name: 'Three', total: 10, completed: 0, tier: 0 }],
  nodes: [
    { id: 'near', name: 'Near', bank: 'b1', type: 'skill', acts: ['mine:copper'], d: 100 },
    { id: 'mid', name: 'Mid', bank: 'b2', type: 'skill', acts: ['mine:copper'], d: 500 },
    { id: 'far', name: 'Far', bank: 'b3', type: 'skill', acts: ['mine:copper'], d: 2000 },
  ],
  levers: {}, levels: { mine: 10 }, skillOdds: { mine: 50 }, actOdds: { mine: { copper: 100 } }, used: { mine: { near: 6, mid: 3, far: 1 } }, usedN: 10, sps: 20,
  credits: { total: 0, individual: { mine: 0 }, reroll: 0 },
}, over || {});
const meanD = (l) => { const ws = { near: Math.pow(1.25, l.near || 0), mid: Math.pow(1.25, l.mid || 0), far: Math.pow(1.25, l.far || 0) }; const s = ws.near + ws.mid + ws.far; return (ws.near * 100 + ws.mid * 500 + ws.far * 2000) / s; };
test('every location is rated by its walking time and rolled with equal share before any lever', () => {
  const S = core.locations(loc()).skills[0], by = {}; S.rows.forEach((r) => { by[r.node] = r; });
  assert.strictEqual(by.near.quality, 'good', '100 steps = 5 s'); assert.strictEqual(by.mid.quality, 'ok', '500 steps = 25 s'); assert.strictEqual(by.far.quality, 'bad', '2000 steps = 100 s');
  near(by.near.sec, 5); near(by.far.sec, 100); near(by.near.shareSk, 100 / 3, 1e-6); near(by.near.shareAll, 100 / 3 / 2, 1e-6, 'half of the rolls are mine');
  assert.strictEqual(by.near.used, 6); assert.strictEqual(by.far.used, 1);
  assert.deepStrictEqual(S.rows.map((r) => r.node), ['far', 'mid', 'near'], 'worst first');
  near(S.taskD, meanD({}), 1e-9); near(S.observedD, (6 * 100 + 3 * 500 + 2000) / 10, 1e-9, 'what you really did');
});
test('lever weights move the share: 1.25 per pip among the places that offer the same activity', () => {
  const S = core.locations(loc({ levers: { mine: { far: -2 } } })).skills[0], far = S.rows.find((r) => r.node === 'far');
  const w = [1, 1, Math.pow(1.25, -2)]; near(far.shareSk, 100 * w[2] / (w[0] + w[1] + w[2]), 1e-6);
});
test('the free plan only uses the free pips of the diary: a tier-0 bank gives none, so its node is not touched', () => {
  const S = core.locations(loc()).skills[0], byNode = {}; S.free.moves.forEach((m) => { byNode[m.node] = m; });
  assert(!byNode.far, 'far sits at a tier-0 bank');
  assert(byNode.near && byNode.near.to > 0 && byNode.near.to <= 2, 'near (tier 2 bank) goes up, inside its 2 free pips');
  assert(byNode.mid && byNode.mid.to > 0 && byNode.mid.to <= 2, 'mid is nearer than the mean (the far place cannot be moved), so it goes up too');
  S.free.moves.forEach((m) => assert(m.cost === 0, 'free moves cost nothing'));
});
test('the claimed saving is the haircut times twice the change in mean distance, over your speed', () => {
  const S = core.locations(loc()).skills[0], l = {}; S.free.moves.forEach((m) => { l[m.node] = m.to; });
  near(S.free.saved, core.HAIRCUT * 2 * (meanD({}) - meanD(l)) / 20, 1e-9);
  near(S.free.savedAll, S.free.saved * 0.5, 1e-9, 'times the share of rolls the skill has');
  assert(S.free.saved > 0);
});
test('with the far place also at a diary tier, the biggest move is on the far place', () => {
  const S = core.locations(loc({ banks: [{ id: 'b1', name: 'One', total: 10, completed: 4, tier: 2 }, { id: 'b2', name: 'Two', total: 10, completed: 4, tier: 2 }, { id: 'b3', name: 'Three', total: 10, completed: 4, tier: 2 }] })).skills[0];
  const top = S.free.moves.slice().sort((a, b) => b.saved - a.saved)[0];
  assert.strictEqual(top.node, 'far'); assert.strictEqual(top.to, -2, 'two free pips, both used on the far place');
  S.rows.forEach((r) => { assert(r.freeLeft === 2); });
});
test('pips are never suggested past what the tier makes free, unless credits pay for them', () => {
  const st = loc({ credits: { total: 0, individual: { mine: 0 }, reroll: 0 } });
  const S = core.locations(st).skills[0]; assert.strictEqual(S.paid.moves.length, 0, 'no credits, no paid moves');
});
test('a skill with credits may get paid moves, only where a credit buys visible walking', () => {
  const st = loc({ credits: { total: 0, individual: { mine: 200 }, reroll: 0 } });
  const S = core.locations(st).skills[0];
  assert(S.paid.moves.length >= 1, 'the 2000-step place is worth a credit-costing pip'); assert(S.paid.cost > 0 && S.paid.cost <= 200);
  S.paid.moves.forEach((m) => assert(m.cost > 0));
});
test('an uninformative place (one node offers the activity) has nothing to move', () => {
  const st = loc({ nodes: [{ id: 'only', name: 'Only', bank: 'b1', type: 'skill', acts: ['mine:copper'], d: 900 }], used: { mine: { only: 5 } } });
  const S = core.locations(st).skills[0]; assert.strictEqual(S.free.moves.length, 0); assert.strictEqual(S.rows[0].shareSk, 100);
});
test('no speed known falls back to 24 steps a second; a node without a distance is left out', () => {
  const st = loc({ sps: 0 }); st.nodes[0].d = null;
  const L = core.locations(st); assert.strictEqual(L.sps, 24); assert.strictEqual(L.skills[0].rows.length, 2);
});

console.log('a real state (3 skills of one account, trimmed)');
test('ratings add up: every row has a quality and the shares of a skill add to 100', () => {
  const L = core.build(fixture()).loc; assert.strictEqual(L.skills.length, 3);
  L.skills.forEach((S) => { near(S.rows.reduce((t, r) => t + r.shareSk, 0), 100, 1e-6, S.skill); S.rows.forEach((r) => assert(['good', 'ok', 'bad'].includes(r.quality))); assert.strictEqual(S.counts.good + S.counts.ok + S.counts.bad, S.rows.length); });
});
test('the free plans stay inside the diary tiers and save walking', () => {
  const m = core.build(fixture()), tier = {}; m.banks.forEach((b) => { tier[b.id] = b.tier; });
  m.loc.skills.forEach((S) => {
    assert(S.free.saved > 0, S.skill + ' has something to gain'); assert(S.free.savedAll > 0 && S.free.savedAll < S.free.saved);
    S.free.moves.forEach((mv) => { const r = S.rows.find((x) => x.node === mv.node); assert(Math.abs(mv.to) <= Math.max(tier[r.bank], Math.abs(mv.from)), S.skill + ' ' + r.name + ' stays inside its ' + tier[r.bank] + ' free pips'); });
  });
});
test('the claimed total is far below the measured walking overhead (about a minute a task)', () => {
  const m = core.build(fixture()); assert(m.loc.totals.freeSaved < 20, 'three skills: ' + m.loc.totals.freeSaved + ' s per task');
  const all = core.locations(JSON.parse(JSON.stringify(fixture()))); assert(all.totals.freeSaved < 45);
});
test('without lever data nothing is claimed', () => {
  const s = fixture(); s.levers = {}; s.haveLevers = false; const m = core.build(s); assert.strictEqual(m.haveLevers, false); assert.strictEqual(m.pips.saved, 0);
});

console.log('the bridge getter');
function bridgeWith(G, S) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'game-bridge.js'), 'utf8'), timers = [];
  const ctx = { document: { querySelectorAll: () => [], getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} }, Date, Math, JSON, Object, Array, Number, String, isFinite, console,
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  ctx.window = ctx;
  const fn = vm.runInNewContext(src, ctx);
  return fn(G, {}, { totalMovementSpeed: () => 12, movementSpeed: () => 12, TELESCOPE_MOVE_SPEED_BONUS_PER: 0, GAUNTLET_RARE_TIER_KEYS: [], COLLECTOR_MAX_MOVE_SPEED: 0 }, {}, { _active: false }, {}, {}, S, {}, {});
}
const stubGame = () => ({
  state: 'idle', skills: { mine: { level: 12, xp: 1 }, slay: { level: 30, xp: 1 } }, bank: [], activePotions: {}, unlocks: {}, pets: {}, capes: {}, itemsData: {}, getDisplayedMovementYards: () => 0, rerollCredits: 7,
  getPathDistance: (a, b) => (a === 'a_mine' ? 640 : 5),
  nodesData: [
    { id: 'a_bank', name: 'Alpha Bank', type: 'bank', nearestBankId: 'a_bank', activities: [] },
    { id: 'a_mine', name: 'Alpha Mine', type: 'skill', nearestBankId: 'a_bank', activities: [{ skill: 'mine', activityId: 'copper', tier: 0, levelRequired: 1 }] },
    { id: 'gx', name: 'Fortress Mine', type: 'gauntlet', nearestBankId: 'a_bank', activities: [{ skill: 'mine', activityId: 'copper' }] },
  ],
  diary: { loaded: true, byBank: { a_bank: { bankName: 'Alpha Bank', total: 2, completed: 1, tier: 2, completedKeys: { 'skill:mine:copper': true },
    steps: [{ key: 'skill:mine:copper', kind: 'skill', skill: 'mine', activityId: 'copper', name: 'Copper', tier: 0, levelRequired: 1 }] } } },
});
const stubS = () => ({
  weights: { nodes: { mine: { a_mine: -2, other: 0 } } }, totalSkillCredits: 9, individualSkillCredits: { mine: 3 },
  _calcSkillPercentages: () => ({ mine: 60, quests: 5 }), _calcLuckChance: () => 0.03, _getSkillLever: () => 0, _getPlayerLevel: () => 12, _activityLeverMult: () => 1,
  _getActivityLever: () => ({ weight: 0 }), _leverMult: (x) => Math.pow(1.25, x), activitiesData: { mine: { activities: [{ id: 'copper', name: 'Copper', tier: 0, level: 1, baseQty: 100 }] } },
  taskHistory: [{ skill: 'mine', activityName: 'Copper', nodeName: 'Alpha Mine', quantity: 10, timestamp: 1 }, { skill: 'mine', activityName: 'Copper', nodeName: 'Unknown Place', quantity: 10, timestamp: 2 }],
});
test('diaryState reads banks, nodes with their bank distance, levers, odds, history, levels and credits', () => {
  const st = JSON.parse(JSON.stringify(bridgeWith(stubGame(), stubS()).diaryState()));   // objects built inside the vm have another Object prototype: compare plain copies
  assert.strictEqual(st.banks.length, 1); assert.strictEqual(st.banks[0].name, 'Alpha', '" Bank" is dropped from the name');
  assert.deepStrictEqual(st.nodes.map((n) => [n.id, n.d]), [['a_mine', 640]], 'only skill and combat nodes next to a bank, with the path distance to it; the bank itself and the Fortress are left out');
  assert.deepStrictEqual(st.levers, { mine: { a_mine: -2 } }, 'zero levers are left out');
  assert.deepStrictEqual(st.skillOdds, { mine: 60 }, 'quests are not a skill'); assert.deepStrictEqual(st.actOdds, { mine: { copper: 100 } });
  assert.deepStrictEqual(st.used, { mine: { a_mine: 1 } }); assert.strictEqual(st.usedN, 1, 'a node name the game does not know is not counted');
  assert.strictEqual(st.levels.mine, 12); assert.deepStrictEqual(st.credits, { total: 9, individual: { mine: 3 }, reroll: 7 });
  const m = core.build(st); assert.strictEqual(m.banks[0].saved, core.total(2)); assert(m.loc.skills.length === 1);
});
test('diaryState is null until the game has loaded the diary, and never throws', () => {
  const G = stubGame(); G.diary = { loaded: false, byBank: {} }; assert.strictEqual(bridgeWith(G, stubS()).diaryState(), null);
  const G2 = stubGame(); delete G2.diary; assert.strictEqual(bridgeWith(G2, stubS()).diaryState(), null);
  assert.doesNotThrow(() => bridgeWith(stubGame(), null).diaryState());
});
test('diaryState is read only', () => {
  const G = stubGame(), S = stubS(); const before = JSON.stringify([G, S]); const b = bridgeWith(G, S); b.diaryState(); b.diaryState();
  assert.strictEqual(JSON.stringify([G, S]), before, 'no game object was changed');
});

console.log(failed ? `\n${failed} failed, ${pass} passed` : `\n${pass} passed`);
process.exit(failed ? 1 : 0);
