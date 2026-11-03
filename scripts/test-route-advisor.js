// Route Advisor tests (plain node, no framework): node scripts/test-route-advisor.js   (npm run test:route)
// Runs the optimiser core from overlay/route-advisor.js on REAL inputs recorded from the game (scripts/fixtures) and on seeded random queues built
// from the same options, and proves: the same input gives the same plan; the search is exact (checked against trying every plan); following a
// suggestion leaves nothing more to suggest; small changes in rates / progress / speed do not change the suggestion; a real improvement is still
// suggested. Model and thresholds: docs/ROUTE-ADVISOR-MODEL.md.
'use strict';
const fs = require('fs');
const path = require('path');
const { createCore, polyLen, THRESH, MAX_ROWS } = require('../overlay/route-advisor.js');

const dir = path.join(__dirname, 'fixtures');
const world = JSON.parse(fs.readFileSync(path.join(dir, 'route-world.json'), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(dir, 'route-live-1.json'), 'utf8')).inputs;

const core = createCore();
core.setData(world.nodes.map(n => Object.assign({}, n, { nearestBankPath: n.hubLen ? [{ x: 0, y: 0 }, { x: n.hubLen, y: 0 }] : null })), new Map(world.bankLens.flatMap(([a, b, l]) => [[a + '|' + b, l], [b + '|' + a, l]])));

const clone = o => JSON.parse(JSON.stringify(o));
const KINDS = ['skill', 'combat', 'quest'];
let pass = 0, fail = 0;
function ok(cond, name, detail) { if (cond) pass++; else { fail++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); } }
function section(t) { console.log('\n' + t); }
// small seeded random numbers (tests only: the optimiser itself uses none)
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const FP = { rows: 'r', order: 'o', head: 'h', levels: 'l', settings: 's', crystals: 'c', speed: 'v' };
const withMem = (input, res, fp) => Object.assign(clone(input), { fp: fp || FP, inc: res && res.paths && res.paths.available ? Object.assign({}, res.paths.incNext, { best: res.paths.best, fp: fp || FP }) : null });
const shown = res => JSON.stringify(res.paths.available ? KINDS.map(k => res.paths[k] && res.paths[k].sig).concat([res.paths.best]) : [res.rec.sig]);
// the queue as it stands after the player applies a plan (rows in the plan's order, its picks selected)
function applied(src, res, plan) {
  const x = clone(src);
  x.rows = plan.map((p, i) => ({ id: i + 1, opts: res.rows[p.row].opts.map((o, k) => ({ node: o.node, selected: k === p.opt, label: o.label, idx: o.idx, m: o.m ? clone(o.m) : undefined })) }));
  return x;
}
// the first row of the plan becomes the running task
function advance(src, res, plan) {
  const x = applied(src, res, plan), first = x.rows.shift(), sel = first.opts.find(o => o.selected);
  x.head = sel.node; x.hm = clone(sel.m);
  const qi = x.questInfo || {};
  (sel.m.quest || []).forEach(cq => { if (cq.current && cq.exact && qi[cq.name] && qi[cq.name].current + 1 === cq.step) qi[cq.name].current = cq.step; });
  x.rows.forEach(r => r.opts.forEach(o => { if (o.m && o.m.quest) o.m.quest = o.m.quest.filter(cq => qi[cq.name] && cq.step > qi[cq.name].current).map(cq => Object.assign(cq, { current: qi[cq.name].current + 1 === cq.step })); }));
  x.rows.forEach((r, i) => { r.id = i + 1; });
  return x;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('1. Real recorded queues: determinism, exactness, idempotence');
live.forEach(inp => {
  const t0 = Date.now(), r = core.optimize(clone(inp)), ms = Date.now() - t0;
  const sc = core.selfCheck(inp, 4);
  sc.checks.forEach(c => ok(c.ok, inp._name + ': ' + c.name, c.detail));
  ok(ms < 3000, inp._name + ': solves in under 3 s', ms + ' ms');
  console.log('  ' + inp._name + ': ' + r.rows.length + ' rows, best path ' + r.paths.best + ', ' + sc.checks.length + ' self-checks, ' + ms + ' ms, ' + r.evaluated.toLocaleString('en-US') + ' search states');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('2. Stability under small changes (the last suggestion is remembered)');
{
  const rng = rngOf(7);
  let trials = 0, flips = 0, flipsNoMem = 0;
  const eachM = (x, f) => { x.rows.forEach(r => r.opts.forEach(o => o.m && f(o.m))); };
  const perturb = [
    ['task times +-1%', (x) => eachM(x, m => { m.t *= 1 + (rng() * 2 - 1) * 0.01; })],
    ['task times +-3%', (x) => eachM(x, m => { m.t *= 1 + (rng() * 2 - 1) * 0.03; })],
    ['task XP +-2%', (x) => eachM(x, m => { const f = 1 + (rng() * 2 - 1) * 0.02; for (const k in m.sk) m.sk[k] *= f; })],
    ['running task 1..5% further along', (x) => { const f = 1 - (0.01 + rng() * 0.04); x.hm.t *= f; for (const k in x.hm.sk) x.hm.sk[k] *= f; }],
    ['movement speed +-1%', (x) => { x.speed *= 1 + (rng() * 2 - 1) * 0.01; }],
    ['a skill gains a level (bonus +0.5%)', (x) => { const ks = Object.keys(x.skills); const k = ks[Math.floor(rng() * ks.length)]; x.skills[k].level++; x.skills[k].xp = x.table[x.skills[k].level] || x.skills[k].xp; eachM(x, m => { if (m.sk[k]) m.sk[k] *= 1.005; }); }],
  ];
  live.forEach(inp => {
    const r0 = core.optimize(Object.assign(clone(inp), { fp: FP, inc: null }));
    const base = shown(r0);
    perturb.forEach(([name, f]) => {
      let f1 = 0, f2 = 0;
      for (let i = 0; i < 25; i++) {
        const x = clone(inp); f(x); trials++;
        // with the memory of the last suggestion and nothing but drift: the suggestion must not move
        if (shown(core.optimize(withMem(x, r0))) !== base) { flips++; f1++; }
        // without memory: how often the raw answer moves (reported, not asserted)
        if (shown(core.optimize(Object.assign(x, { fp: FP, inc: null }))) !== base) { flipsNoMem++; f2++; }
      }
      ok(f1 === 0, inp._name + ': ' + name + ' leaves the suggestion unchanged', f1 + ' of 25 changed');
    });
  });
  console.log('  ' + trials + ' perturbed runs: suggestion changed ' + flips + ' times with the memory, ' + flipsNoMem + ' times without it');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('3. A real improvement IS suggested');
live.forEach(inp => {
  // a scrambled queue (the recorded rows in reverse order) must get a suggestion that clears the threshold
  const scr = clone(inp); scr.rows.reverse(); scr.rows.forEach((r, i) => { r.id = i + 1; });
  const rs = core.optimize(Object.assign(scr, { fp: FP, inc: null }));
  const bs = rs.paths.best;
  const rawS = core.optimize(Object.assign(clone(scr), { stab: { rel: 0, abs: 0, perSwap: 0, drift: 1, walkAbs: 0 }, fp: FP, inc: null }));
  const rawGain = Math.max(...KINDS.map(k => (rawS.paths.info[k] ? rawS.paths.info[k].optScore / rawS.paths.cur.m.score - 1 : 0)));
  if (rawGain >= 0.06) ok(!!bs && rs.paths[bs].m.score >= rs.paths.cur.m.score * 1.02, inp._name + ': a scrambled queue gets a suggestion that clears the threshold (best possible gain ' + (rawGain * 100).toFixed(1) + '%)', String(bs));
  else ok(!bs || rs.paths[bs].m.score >= rs.paths.cur.m.score * 1.02, inp._name + ': a scrambled queue with little to gain gets only a suggestion that clears the threshold (best possible gain ' + (rawGain * 100).toFixed(1) + '%)');
  if (inp.keepPicks) return;
  // the player follows a suggestion; then an option they did not pick becomes much better (a boost drops): that swap must be suggested, in full
  const r0 = core.optimize(Object.assign(clone(inp), { fp: FP, inc: null })), bk = r0.paths.best;
  if (!bk) return;
  const q1 = applied(inp, r0, r0.paths[bk].plan);
  const r1 = core.optimize(withMem(q1, r0));
  ok(!r1.paths[bk], inp._name + ': after following a suggestion there is nothing left to suggest');
  const q2 = clone(q1);
  let target = null;
  for (let i = q2.rows.length - 1; i >= 0 && !target; i--) target = q2.rows[i].opts.find(o => !o.selected && o.m && o.m.k === 'skill') || null;
  if (!target) return;
  for (const k in target.m.sk) target.m.sk[k] *= 40;
  target.m.t = Math.max(60, target.m.t / 3);
  const fp2 = Object.assign({}, FP, { levels: 'l2' });
  const r2 = core.optimize(withMem(q2, r1, fp2));
  const raw = core.optimize(Object.assign(clone(q2), { stab: { rel: 0, abs: 0, perSwap: 0, drift: 1, walkAbs: 0 }, fp: fp2, inc: null }));
  const k2 = KINDS.find(k => r2.paths[k] && r2.paths[k].changed > 0);
  ok(!!k2, inp._name + ': an option that became much better is picked up');
  if (k2) ok(Math.abs(r2.paths.info[k2].finScore - raw.paths.info[k2].optScore) <= 1e-9 * Math.max(1, raw.paths.info[k2].optScore), inp._name + ': the suggestion is the true optimum, not a compromise', r2.paths.info[k2].finScore + ' vs ' + raw.paths.info[k2].optScore);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('4. Random queues built from the recorded options');
{
  const pool = [];
  live.forEach(inp => inp.rows.forEach(r => r.opts.forEach(o => pool.push({ o, base: inp }))));
  const rng = rngOf(2024);
  const pick = a => a[Math.floor(rng() * a.length)];
  const gen = (nMin, nMax) => {
    const n = nMin + Math.floor(rng() * (nMax - nMin + 1)), baseIn = pick(live), rows = [];
    for (let i = 0; i < n; i++) {
      const used = new Set(), opts = [];
      while (opts.length < 3) { const p = pick(pool); if (used.has(p.o.node)) continue; used.add(p.o.node); opts.push(clone(p.o)); }
      const s = Math.floor(rng() * 3); opts.forEach((o, k) => { o.selected = k === s; });
      rows.push({ id: i + 1, opts });
    }
    const x = clone(baseIn); x.rows = rows; x.keepPicks = rng() < 0.3;
    if (rng() < 0.5) { x.crystals = [{ tier: 1 + Math.floor(rng() * 3), charges: 1 + Math.floor(rng() * 3) }, { tier: 3, charges: 2 }]; x.tpMode = 'eff'; x.tpSteps = Math.floor(rng() * 8000); } else { x.crystals = rng() < 0.5 ? [{ tier: 2, charges: 4 }] : []; x.tpMode = 'foot'; }
    x.objective = ['xp', 'levels', 'balanced'][Math.floor(rng() * 3)];
    delete x._name;
    return x;
  };
  // 4a exactness and all the self-checks on small queues (every plan is tried)
  let bad = 0, withTp = 0;
  const N1 = 120;
  for (let i = 0; i < N1; i++) {
    const x = gen(3, 5), sc = core.selfCheck(x, 5);
    if (!sc.ok) { bad++; sc.checks.filter(c => !c.ok).forEach(c => ok(false, 'random queue ' + i + ': ' + c.name, c.detail)); }
    const r = core.optimize(clone(x)); if (r.paths.cur.m.charges > 0 || KINDS.some(k => r.paths[k] && r.paths[k].m.charges > 0)) withTp++;
  }
  ok(bad === 0, '4a. ' + N1 + ' random queues of 3-5 rows pass every self-check (' + withTp + ' of them use teleports)', bad + ' failed');
  // 4b. following the suggestion exactly leaves nothing to suggest (no ratchet), on bigger queues
  let notIdem = 0, total = 0;
  for (let i = 0; i < 60; i++) {
    const x = gen(5, 9), r = core.optimize(clone(x));
    KINDS.forEach(k => {
      if (!r.paths[k]) return;
      total++;
      const r2 = core.optimize(applied(x, r, r.paths[k].plan));
      if (r2.paths[k]) notIdem++;
    });
  }
  ok(notIdem === 0, '4b. after following a suggestion exactly nothing more is suggested (' + total + ' suggestions on 5-9 rows)', notIdem + ' came back with another');
  // 4c. the queue moves on (the first stop is done, a new task joins): the rest of the old suggestion is only replaced when the new one is clearly better
  let kept = 0, switched = 0, viol = 0;
  for (let i = 0; i < 60; i++) {
    const x = gen(5, 8), r = core.optimize(Object.assign(clone(x), { fp: FP, inc: null }));
    const k = r.paths.best; if (!k) continue;
    let y = advance(x, r, r.paths[k].plan);
    if (rng() < 0.5) { const extra = gen(1, 1).rows[0]; extra.id = y.rows.length + 1; y.rows.push(extra); }
    const fp2 = Object.assign({}, FP, { head: 'h2', rows: 'r2', order: 'o2' });
    const r2 = core.optimize(withMem(y, r, fp2));
    KINDS.forEach(kk => {
      const inf = r2.paths.info[kk]; if (!inf || inf.incScore == null) return;
      const need = 0.02 + 0.03 * 0;   // at least the base margin must have been cleared to leave the remembered plan
      if (inf.finSig === inf.incSig) kept++;
      else { switched++; if (!(inf.optScore >= inf.incScore * (1 + need) - 1e-12)) viol++; }
    });
  }
  ok(viol === 0, '4c. the remembered plan is only replaced by one that beats it by the margin', viol + ' replaced without clearing it');
  console.log('  after a task finished (or one joined): the old plan was kept ' + kept + ' times, replaced ' + switched + ' times');
  // 4d. determinism and speed on the largest queue
  const big = gen(10, 10), t0 = Date.now(), a = core.optimize(clone(big)), ms = Date.now() - t0, b = core.optimize(clone(big));
  ok(shown(a) === shown(b), '4d. a 10-row queue gives the same answer twice');
  ok(ms < 5000, '4d. a 10-row queue solves in under 5 s (' + ms + ' ms)');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('5. The core runs stand-alone (as in the Web Worker)');
{
  // the worker is built from the source text of createCore: nothing it uses may live outside it
  const src = '"use strict";const THRESH=' + JSON.stringify(THRESH) + ';const MAX_ROWS=' + MAX_ROWS + ';' + polyLen.toString() + ';' + createCore.toString() + ';return createCore;';
  const standalone = new Function(src)()();
  standalone.setData(world.nodes.map(n => Object.assign({}, n, { nearestBankPath: n.hubLen ? [{ x: 0, y: 0 }, { x: n.hubLen, y: 0 }] : null })), new Map(world.bankLens.flatMap(([a, b, l]) => [[a + '|' + b, l], [b + '|' + a, l]])));
  live.forEach(inp => {
    const a = standalone.optimize(clone(inp)), b = core.optimize(clone(inp));
    ok(shown(a) === shown(b), inp._name + ': the stand-alone copy gives the same plans');
    let cloned = true; try { structuredClone(a); } catch (e) { cloned = false; }
    ok(cloned, inp._name + ': the result can be passed between threads (no functions in it)');
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
section('6. Overhead per task (docs/ROUTE-ADVISOR-MODEL.md section 2)');
{
  const OV = core.TASK_OVERHEAD_S;
  ok(OV === 60, '6a. the documented constant is 60 s (' + OV + ')');
  // two queued stops that are the very same task, after a head that is, or is not, that task
  const src = clone(live.find(i => i._name === 'live-eff-optimise')), opt = src.rows.map(r => r.opts.find(o => o.m && o.m.k === 'skill' && o.m.act != null)).find(Boolean);
  const mk = (headSame) => {
    const x = clone(src), o = clone(opt); o.selected = true;
    x.rows = [{ id: 1, opts: [clone(o)] }, { id: 2, opts: [clone(o)] }];
    x.head = headSame ? o.node : src.head;
    x.hm = Object.assign(clone(x.hm || {}), { act: headSame ? o.m.act : o.m.act + '_other', t: 100, sk: {}, v: 0, k: 'skill' });
    x.inc = null; x.keepPicks = false;
    return x;
  };
  const ovh = res => (res && res.paths && res.paths.cur ? res.paths.cur.m.overhead : null);   // the queue as it stands, measured
  const diff = ovh(core.optimize(mk(false)));
  ok(diff === OV, '6b. two identical tasks after a different head: the first pays the overhead, the second does not (' + diff + ' s)');
  const same = ovh(core.optimize(mk(true)));
  ok(same === 0, '6c. identical tasks right after a head that is the same task: no overhead at all (' + same + ' s)');
  // different tasks each pay it, and it is part of the time the rate is divided by
  const real = core.optimize(clone(src));
  KINDS.forEach(k => {
    const pk = real.paths && real.paths[k]; if (!pk) return;
    ok(pk.m.overhead % OV === 0 && pk.m.overhead <= OV * real.rows.length, '6d. ' + k + ' path: overhead is a whole number of tasks (' + pk.m.overhead + ' s of at most ' + OV * real.rows.length + ')');
    ok(Math.abs(pk.m.total - (pk.m.action + pk.m.walk + pk.m.overhead)) < 1e-6, '6e. ' + k + ' path: total = task time + walking + overhead');
  });
}

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ': ' + pass + ' checks passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
