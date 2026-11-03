// npm run test:drop-luck
// Drop Luck Tracker: the maths block of overlay/drop-luck.js (probability curve, per-run versus per-wave rolls, unlock facets and search) and the bridge's
// endlessLoot() / seasonal-pet reading, run against fixtures. No game and no page needed.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); } };
const near = (a, b, eps, msg) => assert(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ' expected ' + b + ', got ' + a);

// ---- the maths block, between its two marker lines
const dl = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'drop-luck.js'), 'utf8');
const i0 = dl.indexOf('// ---- maths'), i1 = dl.indexOf('// ---- end maths');
assert(i0 > 0 && i1 > i0, 'maths markers are in drop-luck.js');
const block = dl.slice(dl.indexOf('\n', i0), i1);
const n0 = dl.indexOf('// ---- nav'), n1 = dl.indexOf('// ---- end nav');
assert(n0 > 0 && n1 > n0, 'nav markers are in drop-luck.js');
const navBlock = dl.slice(dl.indexOf('\n', n0), n1);
const M = new Function(navBlock + block + '\nreturn { navFromSaved, tabKey, ordinal, luckLine, verdict, dry, cumProb, curve, killsFor, runRolls, sumUp, unlockEntries, filterUnlocks, kindOf, tierOf, have, pct, num, cdf, pois, mergeOrder, moveKey };')();

test('the chance of having a 1-in-N drop after k kills is 1 - (1 - 1/N)^k', () => {
  near(M.cumProb(100, 100), 1 - Math.pow(0.99, 100), 1e-12);
  near(M.cumProb(1000, 0), 0); near(M.cumProb(500, 250), 1 - Math.pow(1 - 1 / 500, 250), 1e-12);
  assert.strictEqual(M.cumProb(1, 5), 1, 'a 1-in-1 drop is guaranteed');
});
test('kills for 50 / 90 / 99 percent match the closed form', () => {
  assert.strictEqual(M.killsFor(100, 0.5), 69); assert.strictEqual(M.killsFor(100, 0.9), 230); assert.strictEqual(M.killsFor(100, 0.99), 459);
  assert(M.cumProb(100, M.killsFor(100, 0.9)) >= 0.9 && M.cumProb(100, M.killsFor(100, 0.9) - 1) < 0.9);
});
test('the curve is monotonic, starts at 0, reaches 99% and covers your kills', () => {
  const c = M.curve(500, 3000, 80);
  assert.strictEqual(c.pts.length, 81); assert.strictEqual(c.pts[0].p, 0);
  for (let i = 1; i < c.pts.length; i++) assert(c.pts[i].p >= c.pts[i - 1].p && c.pts[i].kc >= c.pts[i - 1].kc);
  assert(c.pts[80].p >= 0.99, 'last point reaches 99%'); assert(c.xmax >= 3000 * 1.15, 'axis covers the current kill count');
  assert.deepStrictEqual(c.marks.map((m) => m.p), [0.5, 0.9, 0.99]); assert(c.marks[0].kc < c.marks[1].kc && c.marks[1].kc < c.marks[2].kc);
  near(c.now, M.cumProb(500, 3000), 1e-12);
});
test('with no kills yet the curve still draws', () => { const c = M.curve(1000, 0, 40); assert.strictEqual(c.now, 0); assert(c.xmax >= 10); assert(c.pts.every((q) => q.p >= 0 && q.p <= 1)); });
test('"would have it" reads the other way round from the dry chance', () => { assert.strictEqual(M.have(0.013), '98.7%'); assert.strictEqual(M.have(1), '0.00%'); });

// ---- per-run versus per-wave
const raids = [
  { id: 'feeble', name: 'Feeble Dungeon', kc: 460, perRun: true, rare: [{ id: 'a', name: '[T1] Enchanted Salve', n: 100, got: 1, unlock: 1, ut: 'tool', us: 'life' }, { id: 'b', name: '[T1] Enchanted Feather', n: 100, got: 0, unlock: 1, ut: 'feather' }] },
  { id: 'savage', name: 'Savage Dungeon', kc: 0, perRun: true, rare: [{ id: 'c', name: '[T3] Enchanted Salve', n: 400, got: 0, unlock: 1, ut: 'tool', us: 'life' }] },
  { id: 'chaos', name: 'Chaos Dungeon', kc: 12, perRun: false, rare: [{ id: 'z', name: 'Should Not Count', n: 10, got: 0 }], milestone: [] },
  { id: 'gauntlet', name: 'Fortress', kc: 156, perRun: false, rare: [], milestone: [] },
];
test('only dungeons that roll once per run get a per-run luck rating', () => {
  const r = M.runRolls(raids);
  assert.strictEqual(r.length, 2, 'two rares of the one dungeon with runs; Savage has 0 runs, Chaos and the Fortress roll per wave');
  near(r[0].q, Math.pow(0.99, 460), 1e-12); assert.strictEqual(r[0].got, true); assert.strictEqual(r[1].got, false);
  assert.strictEqual(M.runRolls(raids, 'chaos').length, 0, 'asking for Chaos by name still gives no per-run rolls');
  assert.strictEqual(M.runRolls(raids, 'feeble').length, 2);
});
test('sumUp adds expected drops (the sum of 1 - dry) and counts what you have', () => {
  const s = M.sumUp(M.runRolls(raids));
  near(s.exp, 2 * (1 - Math.pow(0.99, 460)), 1e-9); assert.strictEqual(s.act, 1); assert(s.pctl > 0 && s.pctl < 1);
});

// ---- unlocks: one list from mobs and dungeons, filters, search
const d = {
  mobs: [
    { id: 'tier1_rat', name: 'Cave Rat', kills: 1000, drops: [{ id: 'enchanted_rod_t1', name: '[T1] Enchanted Rod', n: 500, got: 0, unlock: 1, ut: 'tool', us: 'fish' }, { id: 'bone', name: 'Bone', n: 10, got: 1, unlock: 0 }] },
    { id: 'tier2_lich', name: 'Dire Lich', kills: 0, drops: [{ id: 'spirit_conduit_t2', name: '[T2] Spirit Conduit', n: 500, got: 0, unlock: 1, ut: 'conduit', us: '' }, { id: 'enchanted_pick_t2', name: '[T2] Enchanted Pickaxe', n: 100, got: 5, unlock: 1, ut: 'tool', us: 'mine' }] },
  ],
  raids,
};
const all = M.unlockEntries(d);
test('unlock entries merge mob and dungeon unlock drops and leave plain drops out', () => {
  assert.strictEqual(all.length, 6, 'rod, conduit, pickaxe, salve, feather, savage salve (Chaos has none)');
  assert(!all.some((e) => e.x.id === 'bone')); assert(all.some((e) => e.src === 'Delve' && e.m.name === 'Feeble Dungeon'));
  const rod = all.find((e) => e.x.id === 'enchanted_rod_t1'); assert.strictEqual(rod.kind, 'Tools'); assert.strictEqual(rod.skill, 'Fish'); assert.strictEqual(rod.tier, 'T1'); near(rod.q, Math.pow(1 - 1 / 500, 1000), 1e-12);
  assert.strictEqual(all.find((e) => e.x.id === 'b').kind, 'Dungeon extras'); assert.strictEqual(all.find((e) => e.x.id === 'spirit_conduit_t2').kind, 'Conduits');
});
const F = (o) => Object.assign({ q: '', status: 'all', kind: 'all', tier: 'all', skill: 'all', src: 'all' }, o);
test('status, kind, tier, skill and source filters', () => {
  assert.strictEqual(M.filterUnlocks(all, F({ status: 'missing' })).length, 4); assert.strictEqual(M.filterUnlocks(all, F({ status: 'owned' })).length, 2);
  assert.strictEqual(M.filterUnlocks(all, F({ kind: 'Tools' })).length, 4); assert.strictEqual(M.filterUnlocks(all, F({ kind: 'Conduits' })).length, 1);
  assert.strictEqual(M.filterUnlocks(all, F({ tier: 'T2' })).length, 2); assert.strictEqual(M.filterUnlocks(all, F({ skill: 'Mine' })).length, 1);
  assert.strictEqual(M.filterUnlocks(all, F({ src: 'Delve' })).length, 3); assert.strictEqual(M.filterUnlocks(all, F({ src: 'Mobs' })).length, 3);
  assert.strictEqual(M.filterUnlocks(all, F({ status: 'missing', kind: 'Tools', src: 'Mobs' })).length, 1);
});
test('search finds an item by name, source or skill, ignoring case and spaces at the ends', () => {
  assert.strictEqual(M.filterUnlocks(all, F({ q: '  ROD ' })).length, 1); assert.strictEqual(M.filterUnlocks(all, F({ q: 'feeble' })).length, 2);
  assert.strictEqual(M.filterUnlocks(all, F({ q: 'lich' })).length, 2); assert.strictEqual(M.filterUnlocks(all, F({ q: 'life' })).length, 2);
  assert.strictEqual(M.filterUnlocks(all, F({ q: 'nothing like this' })).length, 0);
});

// ---- tab order
const DEF = ['pets', 'unlock', 'mob', 'delve', 'fortress'];
test('Overview and Detailed are the main tabs; the sub-tabs default to Pets & Tools, Unlocks, Mobs, Delve, Fortress', () => {
  const m = /const TABS = \[(.*?)\];/.exec(dl); assert(m, 'TABS in the file');
  assert.deepStrictEqual(Array.from(m[1].matchAll(/\['(\w+)', '([^']+)'\]/g)).map((x) => x[1]), DEF);
  assert(/\['pets', 'Pets & Tools'\]/.test(m[1]));
  assert(/const MAINS = \[\['over', 'Overview'\], \['detail', 'Detailed'\]\];/.test(dl));
});
test('no saved order, or nonsense, gives the default order', () => {
  [null, undefined, 'x', 5, {}, []].forEach((v) => assert.deepStrictEqual(M.mergeOrder(v, DEF), DEF));
});
test('a saved order is kept, unknown tabs are dropped and missing ones are appended in default order', () => {
  assert.deepStrictEqual(M.mergeOrder(['fortress', 'over', 'mob'], DEF), ['fortress', 'mob', 'pets', 'unlock', 'delve']);
  assert.deepStrictEqual(M.mergeOrder(['over', 'luck', 'raid', 'delve', 'over', 'delve'], DEF), ['delve', 'pets', 'unlock', 'mob', 'fortress'], 'old tab names, the old Overview and repeats fall away');
  assert.deepStrictEqual(M.mergeOrder(['fortress', 'pets', 'unlock', 'mob', 'delve', 'brandnew'], DEF), ['fortress', 'pets', 'unlock', 'mob', 'delve'], 'a tab that no longer exists is dropped');
  assert.deepStrictEqual(M.mergeOrder(['pets', 'unlock', 'mob', 'delve'], DEF.concat('newtab')), ['pets', 'unlock', 'mob', 'delve', 'fortress', 'newtab'], 'a new tab lands at the end');
});
test('moving a tab: drop before a slot, before itself or after the last', () => {
  assert.deepStrictEqual(M.moveKey(DEF, 'fortress', 0), ['fortress', 'pets', 'unlock', 'mob', 'delve']);
  assert.deepStrictEqual(M.moveKey(DEF, 'pets', 5), ['unlock', 'mob', 'delve', 'fortress', 'pets']);
  assert.deepStrictEqual(M.moveKey(DEF, 'pets', 3), ['unlock', 'mob', 'pets', 'delve', 'fortress']);
  assert.deepStrictEqual(M.moveKey(DEF, 'unlock', 1), DEF, 'dropping a tab on its own left edge changes nothing');
  assert.deepStrictEqual(M.moveKey(DEF, 'unlock', 2), DEF, 'nor on its own right edge');
  assert.deepStrictEqual(M.moveKey(DEF, 'nope', 1), DEF);
  assert.deepStrictEqual(M.moveKey(DEF, 'mob', 1).length, 5, 'the tab count never changes');
});
test('shift+arrow moves by one place and stops at the ends', () => {
  const left = (o, k) => { const i = o.indexOf(k); return i < 1 ? o : M.moveKey(o, k, i - 1); }, right = (o, k) => { const i = o.indexOf(k); return i < 0 || i >= o.length - 1 ? o : M.moveKey(o, k, i + 2); };
  assert.deepStrictEqual(left(DEF, 'unlock'), ['unlock', 'pets', 'mob', 'delve', 'fortress']); assert.deepStrictEqual(right(DEF, 'unlock'), ['pets', 'mob', 'unlock', 'delve', 'fortress']);
  assert.deepStrictEqual(left(DEF, 'pets'), DEF); assert.deepStrictEqual(right(DEF, 'fortress'), DEF);
});
test('reset gives the default order back', () => { const moved = M.moveKey(DEF, 'fortress', 0); assert.notDeepStrictEqual(moved, DEF); assert.deepStrictEqual(M.mergeOrder(null, DEF), DEF); });
test('old saved tabs map onto the main tab and sub-tab', () => {
  const N = (a, b) => M.navFromSaved(a, b, DEF);
  assert.deepStrictEqual(N(null, null), { main: 'over', sub: 'pets' }, 'nothing saved: Overview');
  assert.deepStrictEqual(N('over', null), { main: 'over', sub: 'pets' }); assert.deepStrictEqual(N('luck', null), { main: 'over', sub: 'pets' }, 'the Luck tab is the Overview now');
  assert.deepStrictEqual(N('raid', null), { main: 'detail', sub: 'delve' }, 'Raids became Delve and is a sub-tab'); assert.deepStrictEqual(N('fortress', null), { main: 'detail', sub: 'fortress' });
  assert.deepStrictEqual(N('mob', 'over'), { main: 'over', sub: 'mob' }, 'a saved main tab wins and the sub-tab is still remembered'); assert.deepStrictEqual(N('mob', 'detail'), { main: 'detail', sub: 'mob' });
  assert.deepStrictEqual(N('garbage', 'garbage'), { main: 'over', sub: 'pets' });
});
test('the one-line luck indicator and the percentile wording', () => {
  assert.strictEqual(M.ordinal(1), '1st'); assert.strictEqual(M.ordinal(2), '2nd'); assert.strictEqual(M.ordinal(3), '3rd'); assert.strictEqual(M.ordinal(4), '4th');
  assert.strictEqual(M.ordinal(11), '11th'); assert.strictEqual(M.ordinal(12), '12th'); assert.strictEqual(M.ordinal(13), '13th'); assert.strictEqual(M.ordinal(21), '21st'); assert.strictEqual(M.ordinal(83), '83rd'); assert.strictEqual(M.ordinal(99), '99th');
  assert.strictEqual(M.luckLine(0.83, 4, 2.5), 'Luck: Lucky · 83rd percentile · 4 obtained / 2.5 expected');
  assert.strictEqual(M.luckLine(0.999, 1, 0), 'Luck: Very lucky · 99th percentile · 1 obtained / 0.0 expected', 'clipped to the 99th');
  assert.strictEqual(M.luckLine(0.001, 0, 3), 'Luck: Very unlucky · 1st percentile · 0 obtained / 3.0 expected', 'and to the 1st');
  assert.deepStrictEqual([0.96, 0.8, 0.5, 0.1, 0.03, 0.01].map((p) => M.verdict(p)[0]), ['Very lucky', 'Lucky', 'About average', 'A bit unlucky', 'Unlucky', 'Very unlucky']);
});
test('only the Overview calls the big hero; every sub-tab shows the one-line indicator', () => {
  const calls = dl.match(/bd\.appendChild\(hero\(/g) || [];
  assert.strictEqual(calls.length, 1, 'one big hero, on the Overview'); assert(/if \(tab === 'over'\) \{[\s\S]{0,400}bd\.appendChild\(hero\(pctlOf\(tot\)/.test(dl));
  assert((dl.match(/miniHero\(/g) || []).length >= 6, 'delve, mobs, unlocks, pets, tools, fortress');
});
test('the chart button is a kit icon button with a hover card, not a bare emoji', () => {
  assert(/h\('button', 'cc-ib gbtn'\)/.test(dl)); assert(!/'📈'/.test(dl)); assert(/UI\.ccTip\(el,/.test(dl)); assert(/aria-pressed/.test(dl.slice(dl.indexOf('function attachGraph'), dl.indexOf('function attachGraph') + 900)));
});
test('Pets & Tools has a Pets | Tools | All switch and the Overview Lucky tools row opens its Tools part', () => {
  assert(/\[\['pets', 'Pets'\], \['tools', 'Tools'\], \['all', 'All'\]\]/.test(dl), 'segmented switch');
  assert(/key: 'Lucky tools'[^;]*tab: 'pets', sub: 'tools'/.test(dl), 'Lucky tools row targets the Tools part');
  assert(/if \(c\.sub\) \{ sub = c\.sub; saveSub\(\); \}/.test(dl), 'the click applies it');
});

// ---- the bridge: endlessLoot() and the seasonal pets
const src = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'game-bridge.js'), 'utf8');
function attach(G, Y) {
  const ctx = { document: { querySelectorAll: () => [], getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} }, Date, Math, JSON, Object, Array, Number, String, isFinite, console, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  ctx.window = ctx;
  return vm.runInNewContext(src, ctx)(G, {}, Y, {}, { _active: false }, {}, {}, {}, {}, {});
}
const items = {
  ambush_t1: { slot: 'special', name: 'Ambush' }, ambush_t2: { slot: 'special', name: 'Ambush II' }, ambush_c: { slot: 'special', name: 'Ambush C' },
  extender_t1: { slot: 'special', name: 'Extender' },                       // an excluded family
  hot_sauce_t1: { gauntletRareTier: 't1', name: 'Hot Sauce' }, hot_sauce_t2: { gauntletRareTier: 't2', name: 'Hot Sauce II' }, hot_sauce_c7: { gauntletRareTier: 'c7', name: 'Hot Sauce C7' },
  enchanted_salve_c: { name: 'Enchanted Salve' }, chaos_blade: { name: 'Chaos Blade' }, god_gem: { name: 'God Gem' },
  bone: { name: 'Bone' },
};
const G = {
  itemsData: items, skills: { fish: { xp: 5 }, mine: { xp: 7 } }, getSkillName: (k) => k, getItemNameClean: (id) => (items[id] || {}).name || id, getTotalXP: () => 12, stats: { kills: 3 },
  pets: { fish: { normal: 1, shiny: 0 }, holiday_bat: { normal: 1, shiny: 0 }, allSkills: { normal: 0, shiny: 0 } },
  collections: { raid_chaos: { ambush_t1: true, chaos_blade: true }, raid_gauntlet: { hot_sauce_t1: true } }, encounters: [], raidsData: [], unlocks: { tools: {} },
};
const Y = {
  GAUNTLET_RARE_TIER_START: { t1: 1, t2: 21, t3: 41, t4: 61, t5: 81, c: 101, c7: 121 }, SPECIAL_DROP_EXCLUDED_FAMILIES: { extender: true }, CHAOS_RAID_MATERIAL_RATE_DIV: 5,
  chaosRaidToolIds: () => ['enchanted_salve_c'], chaosRaidChaosMaterialIds: () => ['chaos_blade'], chaosRaidGodMaterialIds: () => ['god_gem'],
};
test('endlessLoot lists the Chaos specials by family and band, with the wave each band opens and what you own', () => {
  const e = attach(G, Y).endlessLoot();
  assert.strictEqual(e.special.length, 1, 'extender is an excluded family'); const f = e.special[0];
  assert.deepStrictEqual(f.tiers.map((t) => t.tier + '@' + t.wave), ['t1@1', 't2@21', 'c@101']); assert.deepStrictEqual(f.tiers.map((t) => !!t.got), [true, false, false]);
  assert.strictEqual(f.name, 'Ambush'); assert.strictEqual(e.matDiv, 5);
});
test('endlessLoot lists tools from wave 121, Chaos components from 101 and the God gem from 121', () => {
  const e = attach(G, Y).endlessLoot();
  assert.deepStrictEqual(e.tools.map((t) => t.id + '@' + t.wave), ['enchanted_salve_c@121']); assert.deepStrictEqual(e.chaosMats.map((t) => t.id + '@' + t.wave + (t.got ? '+' : '-')), ['chaos_blade@101+']);
  assert.deepStrictEqual(e.godMats.map((t) => t.id + '@' + t.wave), ['god_gem@121']);
});
test('endlessLoot lists the Fortress tiered rares and reads ownership from the Fortress collection', () => {
  const g = attach(G, Y).endlessLoot().gauntlet; assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(g[0].tiers.map((t) => t.tier + '@' + t.wave + (t.got ? '+' : '-')).sort(), ['c7@121-', 't1@1+', 't2@21-']);
});
test('endlessLoot invents no chance: it carries waves and ownership only', () => {
  const e = attach(G, Y).endlessLoot(); const keys = new Set(); [].concat(e.special.flatMap((f) => f.tiers), e.tools, e.chaosMats, e.godMats, e.gauntlet.flatMap((f) => f.tiers)).forEach((t) => Object.keys(t).forEach((k) => keys.add(k)));
  assert(!keys.has('n') && !keys.has('rate') && !keys.has('oneInChance') && !keys.has('p'), 'only id, name, got, tier, wave: ' + Array.from(keys));
});
test('a holiday pet is flagged seasonal so it can be left out of the luck maths', () => {
  const pets = attach(G, Y).dropState().pets;
  assert.strictEqual(pets.find((p) => p.skill === 'holiday_bat').seasonal, true); assert.strictEqual(pets.find((p) => p.skill === 'fish').seasonal, false); assert.strictEqual(pets.find((p) => p.skill === 'allSkills').seasonal, false);
  assert.strictEqual(pets.find((p) => p.skill === 'holiday_bat').name, 'Holiday Bat');
});

console.log(failed ? `\n${failed} failed, ${pass} passed` : `\n${pass} passed`);
process.exit(failed ? 1 : 0);
