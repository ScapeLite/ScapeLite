// Per-skill lever alert tests (plain node, no game): node scripts/test-skill-lever-alert.js   (npm run test:skilllever)
// Loads overlay/lever-advisor.js and overlay/alert-bell.js in a sandbox with a stub DOM and a fake game bridge, and proves:
//   - a skill with unused credits AND a worthwhile change raises one alert; a skill with credits but nothing worth changing raises none;
//   - applying the advice (the levers moved to the plan) makes the alert go away by itself, with the same advisor code (idempotent);
//   - advice is cached (the game is not asked again) until credits, level or a lever position change;
//   - an alert the advisor has marked as seen stays quiet, and comes back when the credits or the advice change;
//   - at most a few fresh calculations per poll;
//   - the alert text and the 1 percent gain bar.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(cond, name, detail) { if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); } }
function section(t) { console.log('\n' + t); }

// A stand-in for anything the page code touches: any property is another stand-in, it can be called, and assigning is allowed.
function stub() {
  const fn = function () {};
  const store = {};
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k in store) return store[k];
      if (k === 'length') return 0;
      if (k === 'querySelectorAll' || k === 'getClientRects') return () => [];
      if (k === 'querySelector' || k === 'getElementById') return () => stub();
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (k === 'style') return { setProperty() {} };
      return (store[k] = stub());
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}

function makeSandbox(seedStorage) {
  const mem = Object.assign({}, seedStorage || {});
  const localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const doc = stub();
  doc.hidden = false;
  doc.createElement = () => stub();
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.getElementById = () => null;
  const win = { localStorage, document: doc, __ccUI: stub(), addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, innerWidth: 1920, innerHeight: 1080 };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, {
    document: doc, localStorage, console, Math, JSON, Date, Object, Array, Map, Set, Number, String, Boolean, RegExp, Error, TypeError, isFinite, parseInt, parseFloat,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, performance: { now: () => Date.now() },
    getComputedStyle: () => ({ transform: 'none' }), DOMMatrix: function () { this.a = 1; }, CustomEvent: function () {}, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  }));
  return { ctx, win, mem };
}
function load(ctx, file) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'overlay', file), 'utf8'), ctx, { filename: file }); }

// A fake game: skills with activities (name, level, weight = lever position) and a value (x XP, t seconds) for a typical task.
function makeGame() {
  const g = {
    credits: { fish: 4, mine: 3, cook: 25 },
    names: { fish: 'Fishing', mine: 'Mining', cook: 'Cooking' },
    levels: { fish: 60, mine: 60, cook: 60 },
    calls: { value: 0, tiers: 0 },
    acts: {
      // fish: a clearly better activity sitting at -2 and a worse one at +2: moving points is worth well over 1 percent
      fish: [{ id: 'f_good', name: 'Good fish', w: -2, x: 9000, t: 600 }, { id: 'f_bad', name: 'Bad fish', w: 2, x: 2000, t: 600 }, { id: 'f_mid', name: 'Mid fish', w: 0, x: 4000, t: 600 }],
      // mine: every activity pays the same, so nothing is worth changing
      mine: [{ id: 'm_a', name: 'Ore A', w: 0, x: 5000, t: 600 }, { id: 'm_b', name: 'Ore B', w: 0, x: 5000, t: 600 }],
      // cook: lots of credits, but only a negligible difference between the activities
      cook: [{ id: 'c_a', name: 'Dish A', w: 0, x: 5000, t: 600 }, { id: 'c_b', name: 'Dish B', w: 0, x: 5001, t: 600 }],
    },
  };
  g.bridge = {
    live() {}, mobValues() {},
    individualCredits() { const o = {}; Object.keys(g.credits).forEach((k) => { if (g.credits[k] > 0) o[k] = { n: g.credits[k], name: g.names[k] }; }); return o; },
    oddsTiers(sk) { g.calls.tiers++; return (g.acts[sk] || []).map((a) => ({ id: a.id, name: a.name, open: g.levels[sk] >= 1, weight: a.w })); },
    activityValue(sk, id) { g.calls.value++; const a = (g.acts[sk] || []).find((x) => x.id === id); return a ? { x: a.x, t: a.t } : null; },
    alertState() { return null; },
  };
  return g;
}

function boot(game, seed) {
  const sb = makeSandbox(seed);
  sb.win.__ccBridge = game.bridge;
  sb.win.__ccPluginSettings = { get: (k) => (k === 'alertSkillLever' ? true : undefined) };
  load(sb.ctx, 'lever-advisor.js');
  load(sb.ctx, 'alert-bell.js');
  return sb;
}
const LA = (sb) => sb.win.__ccLeverAdvisor, AL = (sb) => sb.win.__ccAlerts;
const apply = (game, sk, adv) => adv.changes.forEach((c) => { game.acts[sk].find((a) => a.id === c.id).w = c.to; });

section('the advisor: advice for one skill, read from game state');
{
  const game = makeGame(), sb = boot(game);
  ok(LA(sb) && typeof LA(sb).skillAdvice === 'function', 'skillAdvice is exposed');
  const f = LA(sb).skillAdvice('fish');
  ok(f && f.changes.length > 0 && f.gain >= 1, 'fish: a worthwhile change is found', JSON.stringify(f));
  ok(f && f.changes.some((c) => c.id === 'f_good' && c.to > c.from), 'fish: the good activity is raised');
  ok(f && f.changes.some((c) => c.id === 'f_bad' && c.to < c.from), 'fish: the bad activity is lowered');
  ok(f && /^4\|/.test(f.sig), 'fish: the signature starts with the credits', f && f.sig);
  const m = LA(sb).skillAdvice('mine');
  ok(m && m.changes.length === 0 && m.sig === '', 'mine: equal activities, nothing to change');
  const c = LA(sb).skillAdvice('cook');
  ok(c && c.changes.length === 0, 'cook: 25 credits but under the 1 percent bar, nothing to change', JSON.stringify(c));
  game.credits.fish = 0;
  const z = LA(sb).skillAdvice('fish');
  ok(z && z.changes.length === 0, 'no credits: no advice');
}

section('applying the advice ends the advice (same code, same answer)');
{
  const game = makeGame(), sb = boot(game);
  const f = LA(sb).skillAdvice('fish');
  apply(game, 'fish', f);
  const again = LA(sb).skillAdvice('fish');
  ok(again && again.changes.length === 0, 'after the levers are moved, nothing is left to recommend', JSON.stringify(again));
}

section('caching and budget');
{
  const game = makeGame(), sb = boot(game);
  LA(sb).skillAdvice('fish');
  const v1 = game.calls.value;
  LA(sb).skillAdvice('fish');
  ok(game.calls.value === v1, 'second call with the same state does not ask the game for values again');
  game.credits.fish = 5;
  LA(sb).skillAdvice('fish');
  ok(game.calls.value > v1, 'more credits: recalculated');
  const v2 = game.calls.value;
  game.acts.fish[2].w = 1;
  LA(sb).skillAdvice('fish');
  ok(game.calls.value > v2, 'a lever moved: recalculated');
  const st = { left: 1 };
  const game2 = makeGame(), sb2 = boot(game2);
  const first = LA(sb2).skillAdvice('fish', st), second = LA(sb2).skillAdvice('mine', st);
  ok(first && second === null, 'budget of one fresh calculation: the second skill waits for the next poll');
  ok(LA(sb2).skillAdvice('fish', { left: 0 }) !== null, 'a cached skill is still answered with no budget left');
}

section('the bell');
{
  const game = makeGame(), sb = boot(game);
  AL(sb).run();
  const keys = AL(sb).alerts.map((a) => a.key);
  ok(keys.includes('lever-skill-fish'), 'fish raises an alert', keys.join());
  ok(!keys.includes('lever-skill-mine') && !keys.includes('lever-skill-cook'), 'mine and cook (nothing worth changing) raise none', keys.join());
  const a = AL(sb).alerts.find((x) => x.key === 'lever-skill-fish');
  ok(a && /4 unused Fishing credits: the Lever Advisor has changes for you/.test(a.text), 'alert text', a && a.text);
  ok(a && /Raise Good fish/.test(a.sub) && /Lower Bad fish/.test(a.sub), 'alert names what to raise and lower', a && a.sub);
  ok(a && a.tab === 'skillcustom', 'alert points to the Skills Customization page');
  apply(game, 'fish', LA(sb).skillAdvice('fish'));
  AL(sb).run();
  ok(!AL(sb).alerts.some((x) => x.key === 'lever-skill-fish'), 'applying the advice removes the alert by itself');
}

section('seen: quiet until credits or advice change');
{
  const game0 = makeGame(), sb0 = boot(game0);
  const sig = LA(sb0).skillAdvice('fish').sig;
  const game = makeGame(), sb = boot(game, { 'cc-lever-seen': JSON.stringify({ fish: sig }) });
  AL(sb).run();
  ok(!AL(sb).alerts.some((x) => x.key === 'lever-skill-fish'), 'advice marked as seen: no alert');
  game.credits.fish = 6;
  AL(sb).run();
  ok(AL(sb).alerts.some((x) => x.key === 'lever-skill-fish'), 'more credits: the alert comes back');
  const game3 = makeGame(), sb3 = boot(game3, { 'cc-lever-seen': JSON.stringify({ fish: 'something else' }) });
  AL(sb3).run();
  ok(AL(sb3).alerts.some((x) => x.key === 'lever-skill-fish'), 'seen advice that is not this advice: alert shows');
}

section('slay credits are left to the slay alert');
{
  const game = makeGame(); game.credits.slay = 9; game.names.slay = 'Slay'; game.acts.slay = [{ id: 's1', name: 'Mob', w: 0, x: 9000, t: 600 }, { id: 's2', name: 'Mob 2', w: 0, x: 1000, t: 600 }];
  const sb = boot(game);
  AL(sb).run();
  ok(!AL(sb).alerts.some((x) => x.key === 'lever-skill-slay'), 'no per-skill alert for slay');
}

console.log('\n' + (fail ? 'FAILED' : 'passed') + ': ' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
