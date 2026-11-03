// npm run test:bridge
// overlay/game-bridge.js: the cached snapshot() and onChange('snapshot'). The bridge source is a function expression; it is run here against a stub game state.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'game-bridge.js'), 'utf8');
let pass = 0, failed = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); } };

function attach() {
  const timers = [];
  const win = { __ccBridgeSubs: undefined, EffectiveLevel: null, setInterval: null };
  const ctx = {
    window: win, document: { querySelectorAll: () => [], getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} },
    Date, Math, JSON, Object, Array, Number, String, isFinite, console,
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  ctx.window = Object.assign(ctx.window, ctx);
  const G = {
    state: 'idle', skills: { mining: { level: 10, xp: 1000 }, vigor: { level: 5, xp: 10 } }, bank: [{ itemId: 'oak_log', qty: 5 }], activePotions: {},
    currentTask: { skill: 'mining', activityName: 'Copper', nodeName: 'Mine' }, slayTask: null, queueMaster: 'tier1', unlocks: {}, pets: {}, capes: {}, itemsData: {},
    getDisplayedMovementYards: () => 0,
  };
  const Y = { totalMovementSpeed: () => 12, movementSpeed: () => 12, TELESCOPE_MOVE_SPEED_BONUS_PER: 0, GAUNTLET_RARE_TIER_KEYS: [], COLLECTOR_MAX_MOVE_SPEED: 0 };
  const E = { _active: false };
  const fn = vm.runInNewContext(src, ctx);
  const bridge = fn(G, {}, Y, {}, E, {}, {}, {}, {}, {});
  return { G, E, bridge, timers, win };
}

test('snapshot() carries every part the item lists', () => {
  const { bridge } = attach(), s = bridge.snapshot();
  ['at', 'rev', 'speed', 'held', 'skills', 'potions', 'task', 'slay', 'combat'].forEach((k) => assert(k in s, 'missing ' + k));
  assert.strictEqual(s.held.oak_log, 5); assert.strictEqual(s.skills.mining.level, 10); assert.strictEqual(s.task.skill, 'mining'); assert.strictEqual(s.combat.active, false);
});
test('two calls inside 500 ms share one build', () => {
  const { bridge } = attach(), a = bridge.snapshot(), b = bridge.snapshot();
  assert.strictEqual(a, b);
  assert.notStrictEqual(bridge.snapshot(true), a, 'force rebuilds');
});
test('rev and the event move on a real change, not on XP', () => {
  const { bridge, G } = attach(); const seen = [];
  bridge.snapshot(); const off = bridge.onChange('snapshot', (s, c) => seen.push(c.join()));
  G.skills.mining.xp += 500; bridge.snapshot(true); assert.strictEqual(seen.length, 0, 'xp alone is not a change');
  const rev0 = bridge.snapshot().rev;
  G.skills.mining.level = 11; bridge.snapshot(true); assert.deepStrictEqual(seen, ['skills']); assert.strictEqual(bridge.snapshot().rev, rev0 + 1);
  G.bank.push({ itemId: 'ash', qty: 2 }); G.currentTask = null; G.slayTask = { active: { taskId: 'rat', killCount: 0, killTarget: 10 } }; bridge.snapshot(true);
  assert(/held/.test(seen[1]) && /task/.test(seen[1]) && /slay/.test(seen[1]), seen[1]);
  off();
});
test('combat start and a potion are changes', () => {
  const { bridge, G, E } = attach(); const seen = []; bridge.snapshot(); bridge.onChange('snapshot', (s, c) => seen.push(c.join()));
  E._active = true; E._playerUnit = {}; E._mobs = [{ alive: true }]; bridge.snapshot(true); assert(/combat/.test(seen[0]));
  G.activePotions = { melee: [{ potionId: 'p1', left: 3 }] }; bridge.snapshot(true); assert(/potions/.test(seen[1]));
});
test('a throwing subscriber does not break the others, and unsubscribing stops the check', () => {
  const { bridge, G, timers } = attach(); let ok = 0; bridge.snapshot();
  const a = bridge.onChange('snapshot', () => { throw new Error('boom'); }), b = bridge.onChange('snapshot', () => { ok++; });
  assert(timers.length >= 1 && !timers[timers.length - 1].dead, 'timer runs while listened to');
  G.skills.vigor.level = 6; bridge.snapshot(true); assert.strictEqual(ok, 1);
  a(); b(); assert(timers[timers.length - 1].dead, 'timer stops with the last listener');
});
test('existing readers still answer', () => {
  const { bridge } = attach(); assert.strictEqual(typeof bridge.held, 'function'); assert.strictEqual(bridge.held().oak_log, 5); assert(bridge.speed());
});

console.log(failed ? `\n${failed} failed, ${pass} passed` : `\n${pass} passed`);
process.exit(failed ? 1 : 0);
