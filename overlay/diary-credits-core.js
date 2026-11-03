// ScapeLite Diary and Credits core: pure code (no DOM, no game access). Works in the page (window.__ccDiaryCore) and in Node (module.exports), so it is tested offline.
//
// What the game does with the diary (read from its own code, docs/ADVISOR-NOTES.md):
//  * Every bank has a list of steps. Tier = share of steps done: 20% = 1, 40% = 2, 60% = 3, 80% = 4, 100% = 5. The diary is gained passively while you play; nothing here
//    asks you to chase it.
//  * The only mechanical reward is free node-lever pips: at every node whose nearest bank is that bank, the first `tier` pips of a lever are free
//    (the game's _nodeFreeFloor / _paidNodeCost). A lever at position p costs K * (2^|p| - 1) credits in total (K = 5 individual credits per skill), so
//    the next pip from |p| to |p| + 1 costs K * 2^|p|. A diary tier t pays for the first t of them.
//
// The question this answers is where to SPEND those free pips (and, when it is worth it, credits): a node lever changes how often a location is rolled, and a location
// whose node is far from its nearest bank costs walking every time it comes up. locations() works out, per skill, which locations are good or bad by walking distance,
// how often each is rolled and used, and which lever moves save the most walking, free pips first.
// Everything below is arithmetic on a plain state object that overlay/game-bridge.js diaryState() returns.
(function (root) {
  'use strict';

  const K = 5;                                    // individual credits: cost of the first pip (docs/ADVISOR-NOTES.md, "three layers")
  const K_TOTAL = 25;                             // total (skill) credits: cost of the first step of a skill lever
  const TIERS = 5;
  const BASE = 1.25;                              // likelihood multiplier of one lever pip (kept after docs/ROLL-MODEL-CALIBRATION.md: data allow 1.08 to 1.26)
  const LEVER_MAX = 5;
  const GOOD_SEC = 15, BAD_SEC = 40;              // a node this many seconds of walking from its bank is "good" / "bad" (at your real speed)
  // Claimed saving = HAIRCUT x (walk in and out of the node at the distance difference). Half, because (1) a leg between two nodes of one bank area does not pass the bank
  // and (2) you choose among rolled options and already pick nearer nodes than the roll offers (calibration: 496 steps chosen against 640 rolled).
  const HAIRCUT = 0.5;
  const MIN_GAIN = 0.03;                          // seconds saved per task of the skill below which a move is not worth a line

  const total = (p, k) => (k || K) * (Math.pow(2, Math.abs(p)) - 1);           // credits for a lever to stand at p
  const step = (p, k) => (k || K) * Math.pow(2, Math.abs(p));                   // credits for the next pip, from |p| to |p| + 1
  const paid = (p, tier) => total(p) - total(Math.min(Math.abs(p), tier || 0));  // credits actually paid for position p when the diary gives `tier` pips free
  const tierFor = (done, all) => { if (!(all > 0)) return 0; for (let t = TIERS; t >= 1; t--) if (done * TIERS >= all * t) return t; return 0; };
  const stepsToNext = (done, all, tier) => (tier >= TIERS || !(all > 0) ? 0 : Math.max(0, Math.ceil(all * (tier + 1) / TIERS) - done));
  const w = (l) => Math.pow(BASE, l);

  // Skills a node trains: its activities are "skill:activity".
  const nodeSkills = (n) => { const o = {}; (n.acts || []).forEach((a) => { o[String(a).split(':')[0]] = 1; }); return Object.keys(o); };

  // ---------------------------------------------------------------- banks, free pips and credits (reference data)
  function build(state) {
    if (!state || !Array.isArray(state.banks)) return null;
    const nodes = state.nodes || [], lev = state.levers || {};
    const cr = state.credits || { total: 0, individual: {}, reroll: 0 };
    const out = { overall: { completed: 0, total: 0, pct: 0, tierCounts: [0, 0, 0, 0, 0, 0] }, banks: [], pips: { levers: 0, covered: 0, saved: 0, freeUnused: 0, bySkill: {} }, credits: null, haveLevers: state.haveLevers !== false };
    const skillRow = (sk) => (out.pips.bySkill[sk] || (out.pips.bySkill[sk] = { skill: sk, levers: 0, saved: 0, freeUnused: 0 }));

    state.banks.forEach((b) => {
      const tier = typeof b.tier === 'number' ? b.tier : tierFor(b.completed, b.total);
      out.overall.completed += b.completed; out.overall.total += b.total; out.overall.tierCounts[Math.min(TIERS, tier)]++;
      const pairs = [];
      nodes.forEach((n) => { if (n.bank !== b.id || n.type !== 'skill') return; nodeSkills(n).forEach((sk) => { pairs.push({ skill: sk, node: n.id, name: n.name, lever: (lev[sk] && lev[sk][n.id]) || 0 }); }); });
      let saved = 0, freeUnused = 0, used = 0, covered = 0;
      pairs.forEach((p) => {
        const a = Math.abs(p.lever), r = skillRow(p.skill);
        if (a) { used++; r.levers++; if (a <= tier) covered++; }
        const sv = total(Math.min(a, tier)), fu = Math.max(0, tier - a);
        saved += sv; freeUnused += fu; r.saved += sv; r.freeUnused += fu;
      });
      out.pips.levers += used; out.pips.covered += covered; out.pips.saved += saved; out.pips.freeUnused += freeUnused;
      const need = stepsToNext(b.completed, b.total, tier);
      out.banks.push({ id: b.id, name: b.name, completed: b.completed, total: b.total, pct: b.total ? b.completed / b.total : 0, tier, nextTier: tier < TIERS ? tier + 1 : null, need, pairs: pairs.length, used, covered, saved, freeUnused });
    });
    out.overall.pct = out.overall.total ? out.overall.completed / out.overall.total : 0;

    const skills = Object.keys(cr.individual || {}).sort();
    out.credits = {
      total: cr.total || 0, reroll: cr.reroll || 0, totalFirstSteps: Math.floor((cr.total || 0) / K_TOTAL), totalToNext: K_TOTAL,
      individual: skills.map((sk) => { const c = cr.individual[sk] || 0, r = out.pips.bySkill[sk] || { levers: 0, saved: 0, freeUnused: 0 }; return { skill: sk, credits: c, firstPips: Math.floor(c / K), levers: r.levers, saved: r.saved, freeUnused: r.freeUnused }; }),
    };
    out.credits.individualTotal = out.credits.individual.reduce((t, r) => t + r.credits, 0);
    out.pips.skills = Object.keys(out.pips.bySkill).map((sk) => out.pips.bySkill[sk]).sort((x, y) => y.freeUnused - x.freeUnused);
    out.loc = locations(state);
    return out;
  }

  // ---------------------------------------------------------------- location quality and where to put pips
  // Model (docs/ROLL-MODEL-CALIBRATION.md, section 4): a task is rolled as skill, then activity, then node; among the nodes that offer an activity the weight is 1.25^lever.
  // Walking: every visit to a node walks from the node to its bank area and back, so the mean node-to-bank distance of the nodes you get is what location levers can change.
  function locations(state, opt) {
    if (!state || !Array.isArray(state.banks) || !state.skillOdds) return null;
    opt = opt || {};
    const sps = state.sps > 0 ? state.sps : 24, haircut = opt.haircut == null ? HAIRCUT : opt.haircut;
    const lev = state.levers || {}, tierOf = {}; state.banks.forEach((b) => { tierOf[b.id] = typeof b.tier === 'number' ? b.tier : tierFor(b.completed, b.total); });
    const skillNodes = (state.nodes || []).filter((n) => n.type === 'skill' && n.d != null);
    const byAct = {};   // 'skill:activity' -> [node]
    skillNodes.forEach((n) => (n.acts || []).forEach((a) => { (byAct[a] || (byAct[a] = [])).push(n); }));
    const usedAll = state.used || {}, usedN = state.usedN || 0, credits = (state.credits && state.credits.individual) || {};
    const sec = (d) => d / sps;
    const quality = (d) => (sec(d) <= GOOD_SEC ? 'good' : sec(d) >= BAD_SEC ? 'bad' : 'ok');
    const out = { sps, goodSec: GOOD_SEC, badSec: BAD_SEC, haircut, skills: [], totals: { freeSaved: 0, paidSaved: 0, freePips: 0, usedN } };

    Object.keys(state.skillOdds).forEach((sk) => {
      const ps = state.skillOdds[sk] / 100, acts = state.actOdds && state.actOdds[sk] || {};
      const myNodes = {}, actList = [];
      Object.keys(acts).forEach((a) => { const ns = byAct[sk + ':' + a]; if (ns && ns.length) { actList.push({ id: a, p: acts[a] / 100, nodes: ns }); ns.forEach((n) => { myNodes[n.id] = n; }); } });
      const ids = Object.keys(myNodes); if (!ids.length) return;
      const L = {}; ids.forEach((id) => { L[id] = (lev[sk] && lev[sk][id]) || 0; });
      const psum = actList.reduce((t, a) => t + a.p, 0) || 1;
      // expected node-to-bank distance (steps) over the activities, and the share of each node, under lever map `l`
      const distOf = (l, a) => { let s = 0, d = 0; a.nodes.forEach((n) => { const x = w(l[n.id] || 0); s += x; d += x * n.d; }); return s > 0 ? d / s : 0; };
      const meanD = (l) => actList.reduce((t, a) => t + (a.p / psum) * distOf(l, a), 0);
      const shares = (l) => {
        const sh = {}; ids.forEach((id) => { sh[id] = 0; });
        actList.forEach((a) => { let s = 0; a.nodes.forEach((n) => { s += w(l[n.id] || 0); }); a.nodes.forEach((n) => { sh[n.id] += (a.p / psum) * w(l[n.id] || 0) / s; }); });
        return sh;
      };
      const now = shares(L), mean0 = meanD(L);
      // history: how often each node was actually used among the skill's completed tasks
      const uSk = usedAll[sk] || {}, uTot = Object.keys(uSk).reduce((t, k) => t + uSk[k], 0);
      let dObs = 0; Object.keys(uSk).forEach((id) => { if (myNodes[id]) dObs += uSk[id] * myNodes[id].d; });
      const rows = ids.map((id) => {
        const n = myNodes[id], tier = tierOf[n.bank] || 0, l = L[id];
        return { skill: sk, node: id, name: n.name, bank: n.bank, d: n.d, sec: sec(n.d), quality: quality(n.d), shareSk: now[id] * 100, shareAll: now[id] * ps * 100, used: uSk[id] || 0, lever: l, tier, freeLeft: Math.max(0, tier - Math.abs(l)), target: null };
      }).sort((a, b) => b.d - a.d);

      // greedy plan: single-pip moves, best saving first. Free = no extra credits (within the diary's free pips, or moving back toward 0).
      const gainOf = (l0, l1) => haircut * 2 * (meanD(l0) - meanD(l1)) / sps;      // seconds saved per task of this skill
      const plan = (limitCredits) => {
        const l = Object.assign({}, L), moves = [], base = Object.assign({}, L);
        let left = limitCredits, guard = 0;
        for (;;) {
          if (++guard > 120) break;
          let best = null, cur = meanD(l);
          ids.forEach((id) => {
            const t = tierOf[myNodes[id].bank] || 0;
            [-1, 1].forEach((dl) => {
              const to = l[id] + dl; if (Math.abs(to) > LEVER_MAX) return;
              const cost = paid(to, t) - paid(l[id], t);
              if (limitCredits === 0 ? cost > 0 : cost <= 0 || cost > left) return;
              const l2 = Object.assign({}, l); l2[id] = to;
              const g = haircut * 2 * (cur - meanD(l2)) / sps;
              if (g < MIN_GAIN) return;
              const score = limitCredits === 0 ? g : g / Math.max(1, cost);
              if (!best || score > best.score) best = { id, to, g, cost, score };
            });
          });
          if (!best) break;
          l[best.id] = best.to; left -= Math.max(0, best.cost);
          const m = moves.find((x) => x.node === best.id);
          if (m) { m.to = best.to; m.saved += best.g; m.cost += best.cost; } else moves.push({ node: best.id, from: base[best.id], to: best.to, saved: best.g, cost: best.cost });
        }
        const lf = moves.filter((m) => m.to !== m.from);
        return { moves: lf, levers: l, saved: lf.reduce((t, m) => t + m.saved, 0), cost: lf.reduce((t, m) => t + m.cost, 0) };
      };
      const free = plan(0);
      const afterFree = free.levers;
      // a paid step on top of the free plan only with the credits this skill has, and only where a credit buys a visible gain (>= 0.05 s a task for 10 credits)
      const paidPlan = (() => {
        const l = Object.assign({}, afterFree), before = meanD(l);
        let left = credits[sk] || 0, moves = [], guard = 0, cur = before;
        for (;;) {
          if (++guard > 40 || left <= 0) break;
          let best = null;
          ids.forEach((id) => {
            const t = tierOf[myNodes[id].bank] || 0;
            [-1, 1].forEach((dl) => {
              const to = l[id] + dl; if (Math.abs(to) > LEVER_MAX) return;
              const cost = paid(to, t) - paid(l[id], t); if (cost <= 0 || cost > left) return;
              const l2 = Object.assign({}, l); l2[id] = to;
              const g = haircut * 2 * (cur - meanD(l2)) / sps; if (g < MIN_GAIN) return;
              const r = g / cost; if (r < 0.005) return;
              if (!best || r > best.r) best = { id, to, g, cost, r };
            });
          });
          if (!best) break;
          cur = meanD(Object.assign({}, l, { [best.id]: best.to })); l[best.id] = best.to; left -= best.cost;
          const m = moves.find((x) => x.node === best.id);
          if (m) { m.to = best.to; m.saved += best.g; m.cost += best.cost; } else moves.push({ node: best.id, from: afterFree[best.id], to: best.to, saved: best.g, cost: best.cost });
        }
        moves = moves.filter((m) => m.to !== m.from);
        return { moves, saved: moves.reduce((t, m) => t + m.saved, 0), cost: moves.reduce((t, m) => t + m.cost, 0) };
      })();

      const targets = {}; free.moves.forEach((m) => { targets[m.node] = { to: m.to, kind: 'free', saved: m.saved, cost: 0 }; });
      paidPlan.moves.forEach((m) => { const t = targets[m.node]; if (t) { t.to = m.to; t.kind = 'paid'; t.saved += m.saved; t.cost = m.cost; } else targets[m.node] = { to: m.to, kind: 'paid', saved: m.saved, cost: m.cost }; });
      rows.forEach((r) => { if (targets[r.node]) r.target = targets[r.node]; });
      const freePips = rows.reduce((t, r) => t + r.freeLeft, 0);
      out.skills.push({
        skill: sk, pct: state.skillOdds[sk], taskD: mean0, taskSec: sec(mean0), observedD: uTot ? dObs / uTot : null, observedN: uTot,
        rows, free: { moves: free.moves, saved: free.saved, savedAll: free.saved * ps, pips: free.moves.reduce((t, m) => t + Math.abs(m.to) - Math.abs(m.from), 0) },
        paid: { moves: paidPlan.moves, saved: paidPlan.saved, savedAll: paidPlan.saved * ps, cost: paidPlan.cost }, credits: credits[sk] || 0, freePips,
        counts: { good: rows.filter((r) => r.quality === 'good').length, ok: rows.filter((r) => r.quality === 'ok').length, bad: rows.filter((r) => r.quality === 'bad').length },
      });
      out.totals.freeSaved += free.saved * ps; out.totals.paidSaved += paidPlan.saved * ps; out.totals.freePips += freePips;
    });
    out.skills.sort((a, b) => (b.free.savedAll + b.paid.savedAll) - (a.free.savedAll + a.paid.savedAll));
    return out;
  }

  const api = { K, K_TOTAL, TIERS, BASE, GOOD_SEC, BAD_SEC, HAIRCUT, total, step, paid, tierFor, stepsToNext, nodeSkills, build, locations };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__ccDiaryCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
