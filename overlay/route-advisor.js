// Scapewatch Route Advisor -- DISPLAY-ONLY. Suggests the best ORDER (and
// which of each row's 3 options) to do the already-queued tasks in, to
// minimise walking time, both without and with teleport crystals. It never
// clicks, drags, selects or reorders anything in the game: the player applies
// a suggestion themselves by dragging queue rows / picking options.
//
// Everything here was reverse-engineered from the game's own client bundle
// (game.*.js: getPathDistance / computeWaypoints / getTeleportPlan /
// _chainTaskNodeTextRaw) and validated live, 2026-10-07, at 0.00% error on all
// 18 queue options (see overlay/README.md "Route Advisor"):
//   - The "(N)" on a queue option is the route distance from the PREVIOUS
//     ROW'S SELECTED option's node (row 1 measures from the current task's
//     node), not from the player. So the player's position is not needed:
//     the chain starts at the current task's node.
//   - dist(a, b) = hubPathLen(a) + bankToBankLen(hub(a), hub(b)) +
//     hubPathLen(b), where hub = nearestBankId and hubPathLen is the length
//     of the live nodes.json `nearestBankPath` polyline (0 for a bank node,
//     bank-to-bank term 0 when the hubs are equal). Same-hub legs still
//     detour via the hub; there is no direct shortcut.
//   - Teleports: crystals are drained in LIST ORDER (the Active Potions
//     teleport tooltip order). Each leg whose distance exceeds the FIRST
//     crystal's tier threshold (T1 15000, T2 12000, T3 10000) costs 0 walking
//     and 1 charge; when that crystal is empty the next one takes over.
//   - Walking time = distance / total movement speed (Unlocks panel).
//
// Pieces: (1) core: distance model + simulate + optimizer (pure, tested in
// node), (2) data loading (nodes.json / paths.json fetched from the game's own
// server, cached), (3) queue + crystal readers, (4) UI: a panel (auto-shown on
// the World Map, or opened from the warning triangle) and the yellow triangle
// above the queue panel when a better route exists.
// All switchable from the Plugins tab (see plugins-settings-ui.js).

(function () {
  'use strict';
  const NS = '__ccRouteAdvisor';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  //#core-begin
  const THRESH = { 1: 15000, 2: 12000, 3: 10000 };
  const MAX_ROWS = 10; // rows optimised exactly (2^n DP); later rows keep their order after these

  function polyLen(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return d;
  }

  function createCore() {
    let byId = {}, bankLen = new Map();
    const cache = new Map();

    function setData(nodes, lens) {
      byId = {}; bankLen = lens; cache.clear();
      for (const n of nodes) {
        byId[n.id] = {
          id: n.id, name: n.name, type: n.type, pos: n.position,
          hub: n.type === 'bank' ? n.id : n.nearestBankId,
          hubLen: n.type !== 'bank' && n.nearestBankPath ? polyLen(n.nearestBankPath) : 0,
        };
      }
    }
    function node(id) { return byId[id] || null; }
    function dist(a, b) {
      if (!a || !b || a === b) return 0;
      const key = a + '|' + b;
      let v = cache.get(key);
      if (v !== undefined) return v;
      const A = byId[a], B = byId[b];
      if (!A || !B) v = NaN;
      else {
        v = A.hubLen + B.hubLen;
        if (A.hub !== B.hub) {
          const l = bankLen.get(A.hub + '|' + B.hub);
          v = l == null ? NaN : v + l;
        }
      }
      cache.set(key, v);
      return v;
    }

    // Walk a chain of nodes from `head`, applying the game's teleport rule.
    function simulate(head, seq, crystals, speed, useTp) {
      let cur = head, time = 0, total = 0;
      const legs = [], used = {};
      const cs = useTp ? (crystals || []).filter(c => c.charges > 0).map(c => ({ tier: c.tier, left: c.charges })) : [];
      let charges = 0;
      for (const node of seq) {
        const d = dist(cur, node);
        let tp = false, tier = null;
        if (cs.length && cur !== node && d > (THRESH[cs[0].tier] || 15000)) {
          tp = true; tier = cs[0].tier; used[tier] = (used[tier] || 0) + 1; charges++;
          if (--cs[0].left <= 0) cs.shift();
        }
        legs.push({ from: cur, to: node, dist: d, tp, tier });
        total += d;
        if (!tp) time += d / speed;
        cur = node;
      }
      return { legs, time, dist: total, used, charges };
    }

    // Exact best (row order + option choice) for a cost per leg, by DP over
    // row subsets: dp[mask][g] = cheapest way to have done `mask` ending on
    // flat option g. `restrict(rowIdx, optIdx)` can prune options.
    function dpBest(rows, head, costFn, restrict, optCost) {
      const n = rows.length, flat = [], rowOf = [], optOf = [];
      rows.forEach((r, i) => r.opts.forEach((o, k) => {
        if (restrict && !restrict(i, k)) return;
        flat.push(o.node); rowOf.push(i); optOf.push(k);
      }));
      const G = flat.length, M = 1 << n, INF = 1e18;
      if (!G) return null;
      for (let i = 0; i < n; i++) if (!rowOf.includes(i)) return null;
      const C = new Float64Array(G * G), oc = new Float64Array(G);
      // optCost(rowIdx, optIdx): extra cost for choosing that option (used by
      // the rate objectives: lambda * actionTime - value).
      for (let g = 0; g < G; g++) oc[g] = optCost ? optCost(rowOf[g], optOf[g]) : 0;
      for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) C[a * G + b] = costFn(dist(flat[a], flat[b])) + oc[b];
      const dp = new Float64Array(M * G).fill(INF), par = new Int32Array(M * G).fill(-1);
      for (let g = 0; g < G; g++) dp[(1 << rowOf[g]) * G + g] = costFn(dist(head, flat[g])) + oc[g];
      for (let mask = 1; mask < M; mask++) {
        for (let g = 0; g < G; g++) {
          const v = dp[mask * G + g];
          if (v >= INF) continue;
          for (let g2 = 0; g2 < G; g2++) {
            const r2 = rowOf[g2];
            if ((mask >> r2) & 1) continue;
            const nm = mask | (1 << r2), nv = v + C[g * G + g2];
            if (nv < dp[nm * G + g2]) { dp[nm * G + g2] = nv; par[nm * G + g2] = g; }
          }
        }
      }
      let best = -1, bv = INF;
      for (let g = 0; g < G; g++) if (dp[(M - 1) * G + g] < bv) { bv = dp[(M - 1) * G + g]; best = g; }
      if (best < 0) return null;
      const out = [];
      let mask = M - 1, g = best;
      while (g >= 0) {
        out.push({ row: rowOf[g], opt: optOf[g] });
        const pg = par[mask * G + g];
        mask &= ~(1 << rowOf[g]);
        g = pg;
      }
      return out.reverse();
    }

    // plan = [{row, opt}] -> node list
    const nodesOf = (rows, plan) => plan.map(p => rows[p.row].opts[p.opt].node);

    function evalPlan(rows, head, plan, crystals, speed) {
      const seq = nodesOf(rows, plan);
      return { withTp: simulate(head, seq, crystals, speed, true), noTp: simulate(head, seq, [], speed, false) };
    }
    const sigOf = plan => plan.map(p => p.row + ':' + p.opt).join(',');

    // Hill-climb on the exact (teleport-aware) objective: swap two rows,
    // move one row, or change one row's option.
    function climb(rows, head, plan, crystals, speed, budget, keepPicks, scoreFn) {
      const score = scoreFn || (p => simulate(head, nodesOf(rows, p), crystals, speed, true).time);
      let cur = plan.slice(), curT = score(cur);
      for (let iter = 0; iter < 40 && budget.left > 0; iter++) {
        let bestPlan = null, bestT = curT - 1e-6;
        const tryPlan = p => {
          budget.left--;
          const t = score(p);
          if (t < bestT) { bestT = t; bestPlan = p; }
        };
        for (let i = 0; i < cur.length; i++) {
          for (let j = i + 1; j < cur.length; j++) { const p = cur.slice(); [p[i], p[j]] = [p[j], p[i]]; tryPlan(p); }
          for (let j = 0; j < cur.length; j++) {
            if (j === i) continue;
            const p = cur.slice(); const [x] = p.splice(i, 1); p.splice(j, 0, x); tryPlan(p);
          }
          const nopt = keepPicks ? 0 : rows[cur[i].row].opts.length;
          for (let k = 0; k < nopt; k++) if (k !== cur[i].opt) { const p = cur.slice(); p[i] = { row: cur[i].row, opt: k }; tryPlan(p); }
        }
        if (!bestPlan) break;
        cur = bestPlan; curT = bestT;
      }
      return cur;
    }

    function describe(rows, head, plan, crystals, speed, curPlan) {
      const e = evalPlan(rows, head, plan, crystals, speed);
      let moved = 0, changed = 0;
      plan.forEach((p, pos) => {
        const cp = curPlan.findIndex(c => c.row === p.row);
        if (cp !== pos) moved++;
        if (curPlan[cp] && curPlan[cp].opt !== p.opt) changed++;
      });
      return { plan, sig: sigOf(plan), moved, changed, withTp: e.withTp, noTp: e.noTp };
    }

    // ---- Three paths (Skilling / Combat / Quests), compared in levels per hour ----
    // Every option carries m = {t: action seconds, k: 'skill'|'slay', sk: {skill: xp}, v: levels it is worth (xp / the
    // XP its skill's next level costs), qv: levels of quest credit}. A path maximises its own kind of value per hour of
    // "effective" time = task time + walking + lam per teleport charge used + mu per swapped pick. Lam makes charges
    // cost something (a teleport only pays when it saves more than lam seconds); mu makes a swap earn its place.
    // All three are then scored the same way -- exact levels gained per real hour -- so combat's multi-skill XP and
    // a quest reward are comparable with plain skilling.
    function* buildPaths(c) {
      const { rows, head, crystals, speed, curPlan, thr0, input } = c;
      const hm = input.hm || { t: 0, sk: {}, v: 0, qv: 0, k: 'skill' };
      const tbl = input.table, SK = input.skills, qi = input.questInfo || {};
      const hasM = !!tbl && !!SK && rows.every(r => r.opts.every(o => o.m && Number.isFinite(o.m.t) && o.m.sk));
      if (!hasM) return { available: false };
      const tpOn = input.tpMode !== 'foot' && thr0 != null;
      const lam = tpOn ? Math.max(0, Number(input.tpPrice) || 0) : 0;
      const nTasks = rows.length;
      // Weighted levels: combat-skill levels count wC (default < 1) because one combat task trains ~5 cheap skills at once.
      const wC = input.wCombat != null ? Math.max(0, Number(input.wCombat)) : 1;
      const COMBAT = new Set(['slay', 'spirit', 'life', 'dodge', 'defend', 'strike', 'heft', 'sight', 'draw', 'surge', 'focus', 'fortify', 'vigor']);
      const prio = input.prio || {};
      // "Even progress": no favourites. Skills in the lowest 10-level band count most, the next band a little, the rest normal, so every skill gets
      // brought up to the next 10 before any gets far ahead (combat skills are balanced among themselves).
      const evenBand = (() => {
        if (!prio._even) return null;
        const mins = { s: 99, c: 99 };
        for (const k in SK) { const b = Math.floor((SK[k].level || 1) / 10); const g = COMBAT.has(k) ? 'c' : (k === 'luck' || k === 'alms' || k === 'delve' || k === 'fortify') ? null : 's'; if (g && b < mins[g]) mins[g] = b; }
        return mins;
      })();
      const evenW = k => { if (!evenBand || !SK[k]) return 1; const g = COMBAT.has(k) ? 'c' : (k === 'luck' || k === 'alms' || k === 'delve' || k === 'fortify') ? null : 's'; if (!g) return 1; const d = Math.floor((SK[k].level || 1) / 10) - evenBand[g]; return d <= 0 ? 1.7 : d === 1 ? 1.25 : 1; };
      const wOf = k => (COMBAT.has(k) ? wC : 1) * (prio[k] != null && k !== '_even' ? Number(prio[k]) : 1) * evenW(k);
      const spanOf = k => { const L = SK[k]; if (!L) return 0; const a = tbl[L.level], b = tbl[L.level + 1]; return a != null && b != null && b > a ? b - a : 0; };
      const lvVal = sk => { let v = 0; for (const k in sk) { const sp = spanOf(k); if (sp) v += wOf(k) * sk[k] / sp; } return v; };
      Object.keys(qi).forEach(n => { qi[n].lv = lvVal(qi[n].xpBy || {}); });
      const qLv = m => (m.quest || []).filter(cq => cq.current && cq.exact).reduce((a, cq) => { const info = qi[cq.name]; return info ? a + (info.lv || 0) / Math.max(1, info.steps - info.current) : a; }, 0);
      // Brewing Swift / Fleet / Haste or Discovery potions (and their unfinished versions) is worth extra: movement and double rewards pay back across the whole route.
      // Task weight rules (Settings > Route Advisor): the first rule whose text (alternatives split by |) is contained in the task id wins.
      const TW = (input.taskW || []).filter(r => r && r.match && Number.isFinite(Number(r.mult))).map(r => ({ alts: String(r.match).toLowerCase().split('|').map(x => x.trim()).filter(Boolean), mult: Number(r.mult) }));
      const actW = m => { const a = m && typeof m.act === 'string' ? m.act.toLowerCase() : ''; if (!a) return 1; for (const r of TW) if (r.alts.some(x => a.includes(x))) return r.mult; return 1; };
      rows.forEach(r => r.opts.forEach(o => { o.m.v = lvVal(o.m.sk) * actW(o.m); o.m.qv = qLv(o.m); }));
      hm.v = lvVal(hm.sk || {}); hm.qv = hm.quest ? qLv(hm) : (hm.qv || 0);
      const fracAt = (skill, xp) => {
        let l = SK[skill] ? Math.max(1, SK[skill].level - 1) : 1;
        while (l > 1 && tbl[l] > xp) l--;
        while (tbl[l + 1] != null && tbl[l + 1] <= xp) l++;
        const lo = tbl[l], hi = tbl[l + 1];
        return hi != null && hi > lo ? l + (xp - lo) / (hi - lo) : l;
      };
      const gainLv = g => { let s = 0; for (const k in g) { if (!SK[k]) continue; s += wOf(k) * (fracAt(k, SK[k].xp + g[k]) - fracAt(k, SK[k].xp)); } return s; };
      // Quest credit in levels, in plan order: each quest advances one step per stop and only when the stop's node
      // EXACTLY matches the quest's NEXT required step; every step is credited once.
      const questBy = plan => {
        const next = {}, by = [];
        plan.forEach(p => {
          const m = rows[p.row].opts[p.opt].m;
          let credit = 0;
          if (m && m.quest) {
            const used = new Set();
            for (const cq of m.quest) {
              const info = qi[cq.name];
              if (!info || !cq.exact || used.has(cq.name)) continue;
              const need = next[cq.name] != null ? next[cq.name] : info.current + 1;
              if (cq.step === need) { credit += (info.lv || 0) / Math.max(1, info.steps - info.current); next[cq.name] = need + 1; used.add(cq.name); }
            }
          }
          by.push(credit);
        });
        return by;
      };
      const countChanged = plan => { let n = 0; plan.forEach(p => { if (p.opt !== curPlan[p.row].opt) n++; }); return n; };
      // Real (and effective) numbers of a plan.
      const measure = (plan, mu) => {
        const sim = simulate(head, nodesOf(rows, plan), crystals, speed, tpOn);
        let t = hm.t, v = hm.v || 0, vSkill = hm.k === 'skill' ? (hm.v || 0) : 0, vCombat = hm.k === 'slay' ? (hm.v || 0) : 0;
        const gains = Object.assign({}, hm.sk);
        plan.forEach(p => {
          const m = rows[p.row].opts[p.opt].m;
          t += m.t; v += m.v || 0;
          if (m.k === 'slay') vCombat += m.v || 0; else vSkill += m.v || 0;
          for (const k in m.sk) gains[k] = (gains[k] || 0) + m.sk[k];
        });
        const qBy = questBy(plan), q = qBy.reduce((a, b) => a + b, 0);
        const changed = countChanged(plan);
        const total = t + sim.time;
        const levels = gainLv(gains) + q;
        let xp = 0; for (const k in gains) xp += gains[k];
        const teff = total + lam * sim.charges + (mu || 0) * changed;
        return { sim, action: t, walk: sim.time, total, teff, levels, xp, q, qBy, charges: sim.charges, used: sim.used, changed, v, vSkill, vCombat, score: teff > 0 ? levels / teff * 3600 : 0 };
      };
      const mu0 = Math.max(0, Number(input.mu) || 0);
      const baseEff = measure(curPlan, 0).teff;
      const muT = mu0 * baseEff;
      const kindVal = (kind, m) => kind === 'skill' ? (m.k === 'skill' ? m.v || 0 : 0) : kind === 'combat' ? (m.k === 'slay' ? m.v || 0 : 0) : (m.qv || 0) + 0.05 * (m.v || 0);
      const headVal = kind => kind === 'skill' ? (hm.k === 'skill' ? hm.v || 0 : 0) : kind === 'combat' ? (hm.k === 'slay' ? hm.v || 0 : 0) : (hm.qv || 0) + 0.05 * (hm.v || 0);
      const rateOf = (kind, plan) => {
        const me = measure(plan, muT);
        let V = headVal(kind);
        if (kind === 'quest') { plan.forEach(p => { V += 0.05 * (rows[p.row].opts[p.opt].m.v || 0); }); V += me.q; }
        else plan.forEach(p => { V += kindVal(kind, rows[p.row].opts[p.opt].m); });
        return me.teff > 0 ? V / me.teff : 0;
      };
      const legTime = tpOn ? (d => (d > thr0 ? lam : d / speed)) : (d => d / speed);
      const budget = { left: 9000 };
      const solve = kind => {
        let best = curPlan, rate = rateOf(kind, curPlan);
        for (let it = 0; it < 8; it++) {
          const l = rate;
          const plan = dpBest(rows, head, d => l * legTime(d), null, (i, k) => l * rows[i].opts[k].m.t - kindVal(kind, rows[i].opts[k].m) + (k !== curPlan[i].opt ? l * muT : 0));
          if (!plan) break;
          const r = rateOf(kind, plan);
          if (r > rate + 1e-12) { best = plan; rate = r; } else break;
        }
        const climbed = climb(rows, head, best, crystals, speed, budget, false, p => -rateOf(kind, p));
        return rateOf(kind, climbed) >= rateOf(kind, best) ? climbed : best;
      };
      const pack = plan => {
        const d = describe(rows, head, plan, crystals, speed, curPlan);
        const m = measure(plan, muT);
        const noTpWalk = simulate(head, nodesOf(rows, plan), [], speed, false).time;
        // Why each swapped pick is in the plan: the path with ONLY that swap undone, and what that option is worth on its own.
        const swaps = {};
        const sumXp = (sk) => { let t = 0; for (const k in sk) t += sk[k]; return t; };
        plan.forEach((pp) => {
          const cp = curPlan[pp.row];
          if (pp.opt === cp.opt) return;
          const rev = plan.map((q) => (q.row === pp.row ? { row: q.row, opt: cp.opt } : q));
          const mr = measure(rev, muT);
          const on = rows[pp.row].opts[pp.opt].m, oo = rows[pp.row].opts[cp.opt].m;
          swaps[pp.row] = {
            from: cp.opt, to: pp.opt,
            dScore: mr.score > 0 ? m.score / mr.score - 1 : 0, dLevels: m.levels - mr.levels, dTotal: m.total - mr.total, dWalk: m.walk - mr.walk, dCharges: m.charges - mr.charges,
            newT: on.t, oldT: oo.t, newXp: sumXp(on.sk), oldXp: sumXp(oo.sk), newLv: on.v, oldLv: oo.v,
            newRate: on.t > 0 ? on.v / on.t * 3600 : 0, oldRate: oo.t > 0 ? oo.v / oo.t * 3600 : 0, newQuest: (on.qv || 0) > 0, oldQuest: (oo.qv || 0) > 0,
          };
        });
        return { plan, sig: d.sig, moved: d.moved, changed: d.changed, m, tpSaved: Math.max(0, noTpWalk - m.walk), withTp: m.sim, noTp: m.sim, qBy: m.qBy, swaps };
      };
      const out = { available: true, tpOn, lam, muT, nTasks, cur: pack(curPlan) };
      const hasQuest = rows.some(r => r.opts.some(o => (o.m.qv || 0) > 0)) || (hm.qv || 0) > 0;
      for (const kind of ['skill', 'combat', 'quest']) {
        const hasKind = kind === 'quest' ? hasQuest : rows.some(r => r.opts.some(o => kindVal(kind, o.m) > 0));
        out[kind] = hasKind ? pack(solve(kind)) : null;
        yield 'path';
      }
      return out;
    }

    // rows: [{id, opts:[{node, selected}]}] (row 1..n); head: current task node;
    // crystals: [{tier, charges}] in list order; speed: steps/sec.
    // Generator: yields a progress fraction (0..1) between its heavy steps so the caller can run it in short slices
    // (keeps the game smooth) and show a progress bar. optimize() below runs it to completion for tests/sync use.
    function* optimizeGen(input) {
      const { head, crystals, speed } = input;
      const all = input.rows.filter(r => r.opts.some(o => byId[o.node]));
      const rows = all.slice(0, MAX_ROWS).map(r => ({ id: r.id, opts: r.opts.filter(o => byId[o.node]) }));
      if (!rows.length || !byId[head]) return null;
      const curPlan = rows.map((r, i) => ({ row: i, opt: Math.max(0, r.opts.findIndex(o => o.selected)) }));
      const thr0 = crystals && crystals.length && crystals[0].charges > 0 ? (THRESH[crystals[0].tier] || 15000) : null;
      const walk = d => d;
      const tpRelaxed = d => (thr0 != null && d > thr0 ? 0 : d);

      const pool = new Map();
      const add = (plan, tag) => {
        if (!plan) return null;
        const sig = sigOf(plan);
        if (!pool.has(sig)) pool.set(sig, Object.assign(describe(rows, head, plan, crystals, speed, curPlan), { tags: [] }));
        const c = pool.get(sig);
        if (tag) c.tags.push(tag);
        return c;
      };
      const current = add(curPlan, 'current');
      const optNoTp = add(dpBest(rows, head, walk), 'noTpBest');
      const optTpRelaxed = thr0 != null ? add(dpBest(rows, head, tpRelaxed), 'tpRelaxed') : null;
      // Less disruptive variants.
      const keepPicks = add(dpBest(rows, head, thr0 != null ? tpRelaxed : walk, (i, k) => k === curPlan[i].opt), 'keepPicks');
      // Keep order, choose options (Viterbi over rows in current order).
      const keepOrder = (() => {
        const n = rows.length; let prev = [{ node: head, cost: 0, back: null }];
        const layers = [];
        for (let i = 0; i < n; i++) {
          const layer = rows[i].opts.map((o, k) => {
            let best = null, bc = Infinity;
            prev.forEach((p, pi) => { const c = p.cost + (thr0 != null ? tpRelaxed : walk)(dist(p.node, o.node)); if (c < bc) { bc = c; best = pi; } });
            return { node: o.node, cost: bc, back: best, opt: k };
          });
          layers.push(layer); prev = layer;
        }
        let bi = 0; prev.forEach((p, i) => { if (p.cost < prev[bi].cost) bi = i; });
        const plan = [];
        for (let i = n - 1, idx = bi; i >= 0; i--) { plan.unshift({ row: i, opt: layers[i][idx].opt }); idx = layers[i][idx].back; }
        return add(plan, 'keepOrder');
      })();
      // Exact-objective hill climbs from the structured seeds + random restarts.
      const budget = { left: 40000 };
      let stepN = 0;
      const TOTAL = 17 + 14 + 3 + 1;
      const prog = () => Math.min(0.97, ++stepN / TOTAL);
      const seeds = [current, optNoTp, optTpRelaxed, keepPicks, keepOrder].filter(Boolean).map(c => c.plan);
      for (let r = 0; r < 12; r++) {
        const order = rows.map((_, i) => i).sort(() => Math.random() - 0.5);
        seeds.push(order.map(i => ({ row: i, opt: Math.floor(Math.random() * rows[i].opts.length) })));
      }
      for (const s of seeds) { if (budget.left <= 0) break; add(climb(rows, head, s, crystals, speed, budget, false), 'climb'); yield prog(); }
      // Same, but never touching the option picks (random reorders of the current picks).
      const pickSeeds = [current.plan, keepPicks && keepPicks.plan].filter(Boolean);
      for (let r = 0; r < 12; r++) pickSeeds.push(rows.map((_, i) => i).sort(() => Math.random() - 0.5).map(i => ({ row: i, opt: curPlan[i].opt })));
      for (const s of pickSeeds) { if (budget.left <= 0) break; add(climb(rows, head, s, crystals, speed, budget, true), 'climbKeep'); yield prog(); }

      const cands = [...pool.values()];
      const byTp = (a, b) => a.withTp.time - b.withTp.time || a.withTp.charges - b.withTp.charges || a.changed + a.moved - (b.changed + b.moved);
      // The recommendation keeps the player's option picks (those are real
      // choices -- which skill/mob to train); only the ORDER changes. Plans
      // that also change picks are offered separately as "best overall".
      const keepers = cands.filter(c => c.changed === 0);
      const rec = keepers.slice().sort(byTp)[0];
      const bestAll = cands.slice().sort(byTp)[0];
      const bestNoTp = keepers.slice().sort((a, b) => a.noTp.time - b.noTp.time || a.moved - b.moved)[0];
      const pickOnly = cands.filter(c => c.moved === 0).sort(byTp)[0];
      const slack = rec.withTp.time + Math.max(60, rec.withTp.time * 0.08);
      const fewestCharges = keepers.filter(c => c.withTp.time <= slack && c.withTp.charges < rec.withTp.charges).sort((a, b) => a.withTp.charges - b.withTp.charges || a.withTp.time - b.withTp.time)[0];
      const paths = yield* buildPaths({ rows, head, crystals, speed, curPlan, thr0, input });
      return { rows, head, crystals, speed, current, rec, bestAll, bestNoTp, pickOnly, fewestCharges, paths, evaluated: cands.length };
    }

    function optimize(input) { const g = optimizeGen(input); let r; do { r = g.next(); } while (!r.done); return r.value; }
    return { setData, node, dist, simulate, optimize, optimizeGen, dpBest, THRESH };
  }
  //#core-end

  if (typeof module !== 'undefined' && module.exports) { module.exports = { createCore, polyLen, THRESH }; return; }

  // ---------------------------------------------------------------------
  // Everything below needs the browser.
  // ---------------------------------------------------------------------
  const core = createCore();
  const NODES_URL = 'https://play.scapewatch.com/shared/data/nodes.json';
  const XP_TABLE_URL = 'https://play.scapewatch.com/shared/data/xp-table.json';
  let xpTblLoading = false;
  async function loadXpTbl() {
    if (xpTbl || xpTblLoading) return;
    xpTblLoading = true;
    try { xpTbl = (await (await fetch(XP_TABLE_URL)).json()).xpForLevel || null; lastSig = ''; } catch (e) { /* paths stay unavailable until it loads */ } finally { xpTblLoading = false; }
  }
  const PATHS_URL = 'https://play.scapewatch.com/shared/data/paths.json';
  const LS_LEN = 'cc-route-banklen-v1';
  const LS_DISMISS = 'cc-route-dismissed';
  const LS_POS = 'cc-route-panel-pos';

  const settingOn = (key, def) => {
    try {
      const s = window.__ccPluginSettings;
      if (s && s.get) { const v = s.get(key); return v === undefined ? def : v; }
    } catch (e) {}
    return def;
  };

  // --- data loading --------------------------------------------------------
  let dataState = 'idle'; // idle | loading | ready | error
  let nodesLive = null;
  async function loadData() {
    if (dataState !== 'idle') return;
    dataState = 'loading';
    calc = { p: 0.03, load: true };
    try { render(); } catch (e) { /* UI not ready yet */ }
    try {
      const nodes = (await (await fetch(NODES_URL)).json()).nodes;
      nodesLive = nodes;
      const ctl = new AbortController();
      const res = await fetch(PATHS_URL, { signal: ctl.signal });
      const clen = res.headers.get('content-length') || '';
      let lens = null;
      try {
        const c = JSON.parse(localStorage.getItem(LS_LEN) || 'null');
        if (c && clen && c.clen === clen && c.pairs) lens = new Map(c.pairs);
      } catch (e) {}
      if (lens) ctl.abort();
      else {
        const bankPaths = (await res.json()).bankPaths;
        lens = new Map();
        for (const key of Object.keys(bankPaths)) {
          const [a, b] = key.split(':'), l = polyLen(bankPaths[key]);
          lens.set(a + '|' + b, l); lens.set(b + '|' + a, l);
        }
        try { localStorage.setItem(LS_LEN, JSON.stringify({ clen, pairs: [...lens] })); } catch (e) {}
      }
      core.setData(nodes, lens);
      dataState = 'ready';
      calc = null;
    } catch (e) {
      console.warn('[cc] route-advisor: data load failed', e);
      dataState = 'error';
      calc = null;
      try { render(); } catch (er) { /* ignore */ }
    }
  }

  // Polylines for drawing only (lazy: 17 MB JSON, parsed once, flattened).
  let polyState = 'idle', polys = null;
  async function loadPolylines() {
    if (polyState !== 'idle') return;
    polyState = 'loading';
    try {
      const bp = (await (await fetch(PATHS_URL)).json()).bankPaths;
      polys = new Map();
      for (const key of Object.keys(bp)) {
        const [a, b] = key.split(':'), pts = bp[key].map(p => [p.x, p.y]);
        polys.set(a + '|' + b, pts); polys.set(b + '|' + a, pts.slice().reverse());
      }
      polyState = 'ready';
      scheduleRender();
    } catch (e) { polyState = 'error'; }
  }
  function legPoints(a, b) {
    const A = nodesLive && nodesLive.find(n => n.id === a), B = nodesLive && nodesLive.find(n => n.id === b);
    if (!A || !B) return [];
    const pts = [];
    if (A.type !== 'bank' && A.nearestBankPath) A.nearestBankPath.forEach(p => pts.push([p.x, p.y])); else pts.push([A.position.x, A.position.y]);
    const l = A.type === 'bank' ? A.id : A.nearestBankId, d = B.type === 'bank' ? B.id : B.nearestBankId;
    if (l !== d && polys && polys.get(l + '|' + d)) polys.get(l + '|' + d).slice(1).forEach(p => pts.push(p));
    else if (l !== d) pts.push([B.position.x, B.position.y]);
    if (B.type !== 'bank' && B.nearestBankPath) for (let i = B.nearestBankPath.length - 2; i >= 0; i--) pts.push([B.nearestBankPath[i].x, B.nearestBankPath[i].y]);
    return pts;
  }

  // --- readers -------------------------------------------------------------
  // Cached document.querySelector: the game's DOM has ~130k nodes, so a global query costs ~1 ms. Elements are
  // re-validated with isConnected; "not found" is only re-queried every few seconds.
  const __qc = new Map();
  function qc(sel) {
    const e = __qc.get(sel);
    if (e && e.el && e.el.isConnected) return e.el;
    if (e && !e.el && performance.now() - e.t < 4000) return null;
    const el = document.querySelector(sel);
    __qc.set(sel, { el, t: performance.now() });
    return el;
  }
  function readSpeed() {
    const row = qc('.unlocks-perk-row[data-perk="movespeed"] .unlocks-perk-row-label');
    if (row) {
      const m = (row.firstChild ? row.firstChild.textContent : row.textContent).match(/\(([\d.]+)\s*steps?\/sec\)/i);
      if (m && parseFloat(m[1]) > 0) { try { localStorage.setItem('cc-walk-total-speed', m[1]); } catch (e) {} return parseFloat(m[1]); }
    }
    try { const c = parseFloat(localStorage.getItem('cc-walk-total-speed')); if (c > 0) return c; } catch (e) {}
    return 15;
  }
  function readCrystals() {
    const row = qc('.active-potions-body .potion-row[data-style="teleport"]');
    if (!row) return [];
    const out = [];
    const lines = row.querySelectorAll('.potion-tt-line');
    if (lines.length) {
      lines.forEach(l => {
        const t = parseInt(((l.querySelector('.potion-tt-tier') || {}).textContent || '').replace(/\D/g, ''), 10);
        const c = parseInt(((l.querySelector('.potion-tt-count') || {}).textContent || '').replace(/\D/g, ''), 10);
        if (t && c > 0) out.push({ tier: t, charges: c, name: ((l.querySelector('.potion-tt-name') || {}).textContent || '').trim() });
      });
    } else {
      const t = parseInt(((row.querySelector('.inv-label') || {}).textContent || '').replace(/\D/g, ''), 10);
      const c = parseInt(((row.querySelector('.potion-row-count-num') || {}).textContent || '').replace(/\D/g, ''), 10);
      if (t && c > 0) out.push({ tier: t, charges: c, name: ((row.querySelector('.potion-row-stat-name') || {}).textContent || '').trim() });
    }
    return out;
  }
  function readQueue() {
    const rows = [...document.querySelectorAll('#unified-queue-panel .uq-row')];
    if (!rows.length) return null;
    const optsOf = row => [...row.querySelectorAll('.icon-option')].map(o => {
      const r = o.querySelector('.icon-scroll-row[data-node-id]');
      const tt = ((o.querySelector('.icon-tooltip.uq-tooltip .tt-name') || {}).textContent || '').trim();
      const oi = parseInt(o.getAttribute('data-option-index'), 10);
      return r ? { node: r.getAttribute('data-node-id'), selected: o.classList.contains('selected'), label: tt, el: o, oidx: Number.isFinite(oi) ? oi : null } : null;
    }).filter(Boolean);
    const headRow = rows.find(r => r.classList.contains('uq-current'));
    const headOpts = headRow ? optsOf(headRow) : [];
    const head = (headOpts.find(o => o.selected) || headOpts[0] || {}).node || null;
    const list = [];
    rows.forEach((r, i) => {
      if (r === headRow) return;
      const opts = optsOf(r);
      const slot = parseInt(r.getAttribute('data-row-index'), 10);
      if (opts.length) list.push({ id: i, rowEl: r, opts, slot: Number.isFinite(slot) ? slot : null });
    });
    return { head, headLabel: headOpts[0] ? headOpts[0].label : '', rows: list };
  }

  // --- formatting ----------------------------------------------------------
  const fmtT = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m ? m + 'm ' + String(s % 60).padStart(2, '0') + 's' : s + 's'; };
  const fmtN = n => Math.round(n).toLocaleString('en-US');
  const TIER_NAME = { 1: 'Faulty', 2: 'Stable', 3: 'Perfect' };
  const usedText = used => { const k = Object.keys(used); return k.length ? k.map(t => used[t] + '× ' + (TIER_NAME[t] || 'T' + t)).join(', ') : 'none'; };

  // --- state ---------------------------------------------------------------
  // Skill priority multipliers on levels (see Settings > Route Advisor > Skill priorities). Default = the community order: Vigor first, then
  // the healing and combat-gear chains, then potions; gold/treasure skills and raid skills lower.
  const PRIO_DEFAULT = { vigor: 2, fish: 1.3, cook: 1.3, mine: 1.2, smith: 1.2, forage: 1.2, craft: 1.2, invoke: 1.2, imbue: 1.2, farm: 1.15, brew: 1.15, plunder: 1, barter: 0.8, bard: 0.8, discover: 0.8, alms: 0.8, luck: 0.7, delve: 0.5, fortify: 0.5 };
  let calc = null, calcRun = 0; // calc: {p} while an optimisation is running
  let result = null, lastSig = '', computeTimer = null, selectedKey = 'auto', rowsRef = [], mapOpen = false, stepsOpen = false, xpTbl = null;
  try { mapOpen = localStorage.getItem('cc-route-map-open') === '1'; } catch (e) {}
  // Remembered forever (localStorage): do you plan with teleports or on foot? The headline, the alert triangle and
  // the notification all follow it; teleports are only pushed on you when they save a LOT per charge used.
  // tpPref: 'foot' (no teleports), 'eff' (teleport only when it pays, default), 'max' (use charges freely).
  let tpPref = 'eff';
  try { const v = localStorage.getItem('cc-route-tp-pref'); tpPref = v === 'notp' || v === 'foot' ? 'foot' : v === 'max' ? 'max' : 'eff'; } catch (e) {}
  const prefKey = () => (tpPref === 'foot' ? 'noTp' : 'withTp');
  const prefPlan = () => (tpPref === 'foot' && result.bestNoTp ? result.bestNoTp : result.rec);
  const prefSaved = () => result.current[prefKey()].time - prefPlan()[prefKey()].time;
  // Teleport upsell for on-foot players: only when the saving per charge used clears the threshold (minutes).
  function tpUpsell() {
    if (tpPref !== 'foot' || !result || !result.bestNoTp || !result.crystals.length) return null;
    const foot = result.bestNoTp.noTp.time, tp = result.rec.withTp.time, used = result.rec.withTp.charges;
    if (!used) return null;
    const perCharge = (foot - tp) / used, need = Math.max(1, Number(settingOn('routeTpWorthMin', 10)) || 10) * 60;
    return perCharge >= need ? { saves: foot - tp, used, perCharge } : null;
  }
  try { const sv = localStorage.getItem('cc-route-sel'); if (sv === 'skill' || sv === 'combat' || sv === 'quest' || sv === 'cur') selectedKey = sv; else selectedKey = 'auto'; } catch (e) { selectedKey = 'auto'; }
  let userOpen = false, userClosedOnMap = false, wasMapActive = false, showMap = true;
  let tab = 'plan', lastTab = null; // panel tab: plan | alt | route
  try { tab = localStorage.getItem('cc-route-tab') || 'plan'; } catch (e) {}
  let selObj = 'xp', selTp = true; // objective selector: steps | xp | tasks | quest, teleports on/off
  try { const sv = JSON.parse(localStorage.getItem('cc-route-obj') || 'null'); if (sv) { selObj = sv.o || selObj; selTp = sv.tp !== false; } } catch (e) {}
  const saveObj = () => { try { localStorage.setItem('cc-route-obj', JSON.stringify({ o: selObj, tp: selTp })); } catch (e) {} };
  const loadDismissed = () => { try { return localStorage.getItem(LS_DISMISS) || ''; } catch (e) { return ''; } };
  let dismissedSig = loadDismissed();

  function scheduleCompute() { clearTimeout(computeTimer); computeTimer = setTimeout(compute, 350); }
  function scheduleRender() { render(); }

  function compute() {
    if (dataState !== 'ready') return;
    const q = readQueue();
    if (!q || !q.head) { calcRun++; calc = null; result = null; render(); return; }
    rowsRef = q.rows;
    // Task duration / XP / quest data from the game bridge (read-only; the
    // game's own dashboard projections), when attached.
    let bridge = null;
    try { if (settingOn('gameBridgeEnabled', true) && window.__ccBridge && window.__ccBridge.ok()) bridge = window.__ccBridge.project(); } catch (e) { bridge = null; }
    const questValue = bo => (bo.quest || []).filter(c => c.current && c.exact).reduce((sum, c) => {
      const qq = bridge.quests && bridge.quests[c.name];
      return qq ? sum + qq.xp / Math.max(1, qq.steps - qq.current) : sum;
    }, 0);
    // Per-skill XP of an option, and what it is worth in LEVELS (xp / the XP its skill's next level costs).
    const skMap = bo => {
      const sk = {};
      if (bo.combat) { const cb = bo.combat, add = (k, v) => { if (k && v > 0) sk[k] = (sk[k] || 0) + v; }; add('slay', cb.slay); add('spirit', cb.spirit); add(cb.chosenSkill, cb.chosen); add('life', cb.life); add(cb.secSkill, cb.sec); }
      else if (bo.skill) sk[bo.skill] = bo.totalXp * (1 + (bo.xpBonus || 0));
      return sk;
    };
    const spanOf = k => { const L = bridge && bridge.skills && bridge.skills[k]; if (!L || !xpTbl) return 0; const a = xpTbl[L.level], b = xpTbl[L.level + 1]; return a != null && b != null && b > a ? b - a : 0; };
    const lvVal = sk => Object.keys(sk).reduce((a, k) => { const sp = spanOf(k); return sp ? a + sk[k] / sp : a; }, 0);
    const questLv = bo => (bo.quest || []).filter(c => c.current && c.exact).reduce((sum, c) => {
      const qq = bridge.quests && bridge.quests[c.name];
      return qq ? sum + lvVal(qq.xpBy || {}) / Math.max(1, qq.steps - qq.current) : sum;
    }, 0);
    const metricsFor = (slot, oidx) => {
      if (!bridge || slot == null || oidx == null) return null;
      const sl = bridge.slots.find(x => x.index === slot);
      const bo = sl && sl.options[oidx];
      if (!bo || !Number.isFinite(bo.timeSec) || !Number.isFinite(bo.totalXp)) return null;
      // Slay options: total XP across Slay + combat skills (bridge `combat`); skills: dashboard XP x XP bonus.
      const xp = bo.combat ? bo.combat.total : bo.totalXp * (1 + (bo.xpBonus || 0));
      const tm = bo.combat && Number.isFinite(bo.combat.timeSec) ? bo.combat.timeSec : bo.timeSec;
      const sk = skMap(bo);
      return { t: tm, x: xp, q: questValue(bo), skill: bo.skill, act: bo.act, quest: bo.quest, k: bo.kind === 'slay' ? 'slay' : 'skill', sk, v: lvVal(sk), qv: questLv(bo) };
    };
    const input = {
      head: q.head,
      rows: q.rows.map(r => ({ id: r.id, opts: r.opts.map((o, i) => ({ node: o.node, selected: o.selected, label: o.label, idx: i, m: metricsFor(r.slot, o.oidx) || undefined })) })),
      crystals: readCrystals(), speed: readSpeed(),
    };
    if (bridge) {
      const qinfo = {};
      Object.keys(bridge.quests || {}).forEach(n => { const qq = bridge.quests[n]; qinfo[n] = Object.assign({}, qq, { lv: lvVal(qq.xpBy || {}) }); });
      input.questInfo = qinfo;
      input.skills = bridge.skills || null; input.table = xpTbl;
    }
    try { const tw = window.__ccPluginSettings && window.__ccPluginSettings.get('routeTaskWeights'); input.taskW = Array.isArray(tw) ? tw : [{ match: 'swift_potion|fleet_potion|haste_potion', mult: 2.5 }, { match: 'potion_of_discovery', mult: 2.5 }]; } catch (e) { input.taskW = []; }
    input.tpMode = tpPref;
    input.tpPrice = tpPref === 'max' ? 0 : Math.max(0, Number(settingOn('routeTpWorthMin', 10)) || 10) * 60;
    input.mu = Math.max(0, Number(settingOn('routePickPenaltyPct', 3)) || 0) / 100;
    input.wCombat = Math.max(0, Number(settingOn('routeCombatWeightPct', 40))) / 100;
    try { const pv = window.__ccPluginSettings && window.__ccPluginSettings.get('routePriorities'); input.prio = pv && typeof pv === 'object' ? pv : PRIO_DEFAULT; } catch (e) { input.prio = PRIO_DEFAULT; }
    if (bridge && bridge.head && Number.isFinite(bridge.head.timeSec)) input.hm = { t: bridge.head.combat && Number.isFinite(bridge.head.combat.timeSec) ? bridge.head.combat.timeSec : bridge.head.timeSec, x: bridge.head.combat ? bridge.head.combat.total : (bridge.head.totalXp || 0) * (1 + (bridge.head.xpBonus || 0)) };
    if (bridge && input.hm) { const hsk = skMap(bridge.head); Object.assign(input.hm, { sk: hsk, v: lvVal(hsk), k: bridge.head.kind === 'slay' ? 'slay' : 'skill', qv: questLv(bridge.head), quest: bridge.head.quest }); }
    // Run the optimiser in ~10 ms slices so the game stays smooth; the panel greys out with a progress bar meanwhile.
    const run = ++calcRun, t0 = performance.now();
    let gen;
    try { gen = core.optimizeGen(input); } catch (e) { console.warn('[cc] route-advisor: optimize failed', e); calc = null; result = null; render(); return; }
    calc = { p: 0 };
    render();
    const step = () => {
      if (run !== calcRun) return; // superseded by a newer calculation
      let r;
      try {
        const sliceEnd = performance.now() + 10;
        do { r = gen.next(); if (!r.done && typeof r.value === 'number') calc.p = r.value; } while (!r.done && performance.now() < sliceEnd);
      } catch (e) { console.warn('[cc] route-advisor: optimize failed', e); calc = null; result = null; render(); return; }
      if (!r.done) { setCalcBar(); computeTimer = setTimeout(step, 6); return; }
      result = r.value;
      if (result) { result.ms = performance.now() - t0; result.q = q; }
      calc = null;
      render();
      maybeNotify();
    };
    step();
  }
  function setCalcBar() {
    const bar = panel && panel.querySelector('.rt-calc i'), pc = panel && panel.querySelector('.rt-calc b');
    const v = calc ? Math.round(calc.p * 100) : 100;
    if (bar) bar.style.width = v + '%';
    if (pc) pc.textContent = v + '%';
  }

  // Phone/desktop alert for a BIG saving: a normal Notification, which the
  // user's existing Windows-toast -> Pushover forwarder picks up (same path as
  // the game's own "Scapewatch" notifications). Anti-spam: only when the
  // saving clears the Plugins-tab threshold, at most once per distinct
  // suggestion, and never more often than every 30 minutes.
  const LS_NOTIFY = 'cc-route-notified';
  const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
  function maybeNotify() {
    try {
      if (!result || !settingOn('routeAdvisorEnabled', true) || !settingOn('routePushover', true)) return;
      const saved = prefSaved();
      const min = Math.max(30, Number(settingOn('routePushoverMinSaveSec', 300)) || 300);
      if (saved < min) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      const sig = recSig();
      let st = {};
      try { st = JSON.parse(localStorage.getItem(LS_NOTIFY) || '{}') || {}; } catch (e) {}
      const now = Date.now();
      if (st.sig === sig || (st.at && now - st.at < NOTIFY_COOLDOWN_MS)) return;
      new Notification('Scapewatch', { body: 'Faster route available: reorder your queue to save ' + fmtT(saved) + ' of walking (' + fmtT(result.current[prefKey()].time) + ' → ' + fmtT(prefPlan()[prefKey()].time) + ').' });
      try { localStorage.setItem(LS_NOTIFY, JSON.stringify({ sig, at: now })); } catch (e) {}
    } catch (e) { /* notifications are best effort */ }
  }

  function signature() {
    let pr = ''; try { pr = JSON.stringify(window.__ccPluginSettings.get('routePriorities') || ''); } catch (e) {}
    const q = readQueue();
    if (!q) return '';
    return [q.head, readCrystals().map(c => c.tier + 'x' + c.charges).join('+'), Math.round(readSpeed() * 10),
      q.rows.map(r => r.opts.map(o => o.node + (o.selected ? '*' : '')).join('/')).join('>'),
      // Rates drift slowly (head task progress, levels): refresh once a minute while the bridge is attached.
      window.__ccBridge && window.__ccBridge.ok && window.__ccBridge.ok() ? 'B' + Math.floor(Date.now() / 60000) : 'b', pr].join('#');
  }
  function recSig() { return result ? result.rec.sig + '|' + result.current.sig : ''; }

  // --- UI ------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'cc-route-style';
  style.textContent = `
#cc-route-panel{position:fixed;left:24px;top:90px;width:420px;max-height:80vh;z-index:99984;display:flex;flex-direction:column;
  background:#0f0f14;border:1px solid rgba(255,255,255,.16);border-radius:10px;color:#ddd;overflow:hidden;
  font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55);transition:border-radius .26s ease}
#cc-route-panel[data-map-side=r]{border-top-right-radius:0;border-bottom-right-radius:0}
#cc-route-panel[data-map-side=l]{border-top-left-radius:0;border-bottom-left-radius:0}
#cc-route-panel .rt-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:3;border-right:3px solid rgba(255,255,255,.35);border-bottom:3px solid rgba(255,255,255,.35);border-bottom-right-radius:8px;box-sizing:border-box}
#cc-route-panel .rt-grip:hover{border-color:#ffd24a}
#cc-route-panel[hidden]{display:none!important}
#cc-route-panel button{font:inherit;color:#ddd;background:#22222c;border:1px solid #3a3a48;border-radius:6px;padding:2px 10px;cursor:pointer}
#cc-route-panel button:hover{border-color:#80808f}
/* header + tabs: solid, never scroll away */
#cc-route-panel .rt-head{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:grab;user-select:none;background:#17171f;
  border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-panel .rt-head:active{cursor:grabbing}
#cc-route-panel .rt-ttl{font-weight:700;font-size:14px;color:#fff}
#cc-route-panel .rt-pill{font-size:12px;font-weight:600;border-radius:10px;padding:1px 9px;background:#26262f;color:#aab}
#cc-route-panel .rt-pill.good{background:rgba(95,220,106,.14);color:#6fe27a}
#cc-route-panel .rt-sp{flex:1}
#cc-route-panel .rt-x{padding:0 8px;font-size:16px;line-height:20px}
#cc-route-panel .rt-tabs{display:flex;gap:2px;padding:0 8px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.1);flex:none}
#cc-route-panel .rt-tab{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:7px 12px;color:#9a9aa6;font-weight:600}
#cc-route-panel .rt-subtabs{display:flex;gap:6px;margin:0 0 8px}
#cc-route-panel .rt-prefrow{display:flex;align-items:center;gap:6px;margin-top:8px}
#cc-route-panel .rt-upsell{margin-top:8px;padding:6px 8px;border:1px solid #b07cff;border-radius:7px;background:rgba(176,124,255,.09);color:#d9c8ff;font-size:12px}
#cc-route-panel .rt-upsell button{margin-left:6px}
#cc-route-panel .rt-tab:hover{color:#ddd;border-color:transparent}
#cc-route-panel .rt-tab.on{color:#ffd24a;border-bottom-color:#ffd24a}
/* only the body scrolls, with a slim scrollbar */
#cc-route-panel .rt-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px 12px;scrollbar-width:thin;scrollbar-color:#464658 transparent}
#cc-route-panel .rt-body::-webkit-scrollbar{width:8px}
#cc-route-panel .rt-body::-webkit-scrollbar-track{background:transparent;margin:6px 0}
#cc-route-panel .rt-body::-webkit-scrollbar-thumb{background:#3a3a4a;border-radius:8px;border:2px solid #0f0f14}
#cc-route-panel .rt-body::-webkit-scrollbar-thumb:hover{background:#5a5a70}
#cc-route-panel .rt-h{margin:14px 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
#cc-route-panel .rt-h:first-child{margin-top:0}
#cc-route-panel .rt-hero{padding:10px 12px;border-radius:8px;background:#15151c;border:1px solid rgba(255,255,255,.07)}
#cc-route-panel .rt-big{font-size:16px;font-weight:700}
#cc-route-panel .rt-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#cc-route-panel .rt-chip{font-size:12px;padding:2px 8px;border-radius:6px;background:#1d1d26;color:#b4b4c0;border:1px solid rgba(255,255,255,.06)}
#cc-route-panel .rt-chip b{color:#fff;font-weight:600}
#cc-route-panel .rt-good{color:#6fe27a}#cc-route-panel .rt-bad{color:#ff8a7a}#cc-route-panel .rt-dim{color:#9a9aa6}
#cc-route-panel .rt-plan{margin:0 0 8px;padding:9px 11px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#13131a;cursor:pointer;transition:border-color .12s,background .12s}
#cc-route-panel .rt-plan:hover{border-color:rgba(255,255,255,.22);background:#171720}
#cc-route-panel .rt-plan.sel{border-color:#ffd24a;background:rgba(255,210,74,.06)}
#cc-route-panel .rt-plan.qst{border-color:#4aa8ff}
#cc-route-panel .rt-plan.tp{border-color:#b07cff}
#cc-route-panel .rt-plan.tp.qst{outline:1.5px solid #4aa8ff;outline-offset:1px}
#cc-route-panel .rt-plan{position:relative}
/* Selected marker sits OUTSIDE the card edge so it never covers the purple / blue border. */
#cc-route-panel .rt-plan.sel.tp,#cc-route-panel .rt-plan.sel.qst{background:rgba(255,210,74,.07)}
#cc-route-panel .rt-plan.sel.tp::before,#cc-route-panel .rt-plan.sel.qst::before{content:'';position:absolute;left:-8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#ffd24a}
#cc-route-panel .rt-legend{font-size:11.5px;color:#8a8a96;margin:0 0 6px}
#cc-route-panel .rt-legend .lp{color:#b07cff}#cc-route-panel .rt-legend .lq{color:#4aa8ff}
#cc-route-panel .rt-plan h4{margin:0 0 4px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:baseline}
#cc-route-panel .rt-plan h4 .rt-big{font-size:14px;white-space:nowrap}
#cc-route-panel ul{margin:5px 0 0;padding:0 0 0 16px}
#cc-route-panel li{margin:1px 0}
#cc-route-panel li.pro{color:#6fe27a;list-style:'+ '}#cc-route-panel li.con{color:#ff9d8f;list-style:'− '}
#cc-route-panel .rt-obj{margin:0}
#cc-route-panel .rt-objbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px}
#cc-route-panel .rt-seg{padding:2px 10px;font-size:12px}
#cc-route-panel .rt-seg.on{border-color:#ffd24a;color:#ffd24a;background:#2c2a18}
#cc-route-panel .rt-seg:disabled{opacity:.4;cursor:default}
#cc-route-panel .rt-showing{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;border-radius:8px;background:#15151c;border:1px solid rgba(255,255,255,.07)}
#cc-route-panel .rt-showing .rt-sp{flex:1}
#cc-route-panel .rt-pick{flex:1;min-width:0;font:inherit;color:#fff;background:#22222c;border:1px solid #3a3a48;border-radius:6px;padding:3px 6px;cursor:pointer}
#cc-route-panel .rt-pick:focus{outline:none;border-color:#ffd24a}
#cc-route-panel svg{display:block;width:100%;margin:0 0 8px;background:#0b0b10;border:1px solid rgba(255,255,255,.1);border-radius:8px}
#cc-route-panel ol.rt-stops{margin:0;padding:0 0 0 22px;font-size:12px}
#cc-route-panel ol.rt-stops li{padding:3px 4px;border-radius:4px;cursor:default}
#cc-route-panel ol.rt-stops li:hover{background:rgba(255,255,255,.07)}
#cc-route-panel .rt-tp{color:#ffd24a}
#cc-route-panel .rt-note{margin-top:12px;font-size:11px;color:#7f7f8e;line-height:1.35}
.uq-row.cc-route-hl{box-shadow:inset 0 0 0 2px #ffd24a !important}
#cc-route-panel .rt-calc{padding:8px 12px 9px;background:#14141c;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-panel .rt-calc-top{display:flex;align-items:center;gap:8px;font-size:12px;color:#c9c9d6}
#cc-route-panel .rt-calc-top b{color:#4aa8ff;font-variant-numeric:tabular-nums}
#cc-route-panel .rt-calc-bar{height:5px;margin-top:6px;border-radius:3px;background:#262633;overflow:hidden}
#cc-route-panel .rt-calc-bar i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#2f8cff,#7ad0ff);box-shadow:0 0 8px rgba(74,168,255,.7);transition:width .15s linear}
#cc-route-panel .rt-spin{width:11px;height:11px;border-radius:50%;border:2px solid #3a3a4c;border-top-color:#4aa8ff;animation:rtspin .8s linear infinite}
@keyframes rtspin{to{transform:rotate(360deg)}}
#cc-route-panel .rt-calc.load .rt-calc-bar i{width:35%!important;animation:rtind 1.3s ease-in-out infinite}
@keyframes rtind{0%{margin-left:-35%}100%{margin-left:100%}}
#cc-route-panel.calculating .rt-body,#cc-route-panel.calculating .rt-tabs{opacity:.38;filter:grayscale(1);pointer-events:none;transition:opacity .15s}
@media (prefers-reduced-motion:reduce){#cc-route-panel .rt-spin{animation:none}}
#cc-route-panel .rt-ptitle{font-size:13px}
#cc-route-panel .rt-badge{font-size:11px;background:#3a3216;color:#ffd24a;border-radius:8px;padding:0 7px;font-weight:500}
#cc-route-panel .rt-pbar{height:6px;border-radius:3px;background:#262633;margin:6px 0}
#cc-route-panel .rt-pbar i{display:block;height:100%;border-radius:3px}
#cc-route-panel .rt-pstats{display:flex;gap:4px 12px;flex-wrap:wrap;color:#9a9aa6;font-size:11.5px;margin-top:2px}
#cc-route-panel .rt-pstats b{color:#ddd;font-weight:500}
#cc-route-panel .rt-tpc{color:#c9a8ff}
#cc-route-panel .rt-why{margin:4px 0 6px;padding:6px 8px;border:1px solid rgba(255,184,107,.35);border-left:3px solid #ffb86b;border-radius:6px;background:rgba(255,184,107,.06);font-size:11.5px;line-height:1.45}
#cc-route-panel .rt-why-h{color:#ffd9a8;margin-bottom:2px}
#cc-route-panel .rt-why-h b{color:#ffb86b;font-weight:600}
#cc-route-panel .rt-why-l{color:#b9b9c6}
#cc-route-panel .rt-why-l.good{color:#8fe39a}
#cc-route-panel .rt-why-l.bad{color:#ff9d8f}
#cc-route-panel .rt-sw{color:#ffb86b}
#cc-route-panel .rt-plan.best{border-color:#ffd24a}
#cc-route-panel .rt-plan.rt-off{opacity:.55;cursor:default}
#cc-route-panel .rt-steps-btn{margin-top:6px}
#cc-route-panel .rt-curnow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;padding:6px 10px;border:1px solid #2a2a38;border-radius:8px;color:#9a9aa6;font-size:12px;cursor:pointer}
#cc-route-panel .rt-curnow.sel{border-color:#ffd24a}
#cc-route-panel .rt-curnow b{color:#fff;font-weight:500}
#cc-route-maptab{position:fixed;z-index:99985;width:26px;padding:10px 0;writing-mode:vertical-rl;background:#1d2a44;border:1px solid #3a5fa0;color:#8fc0ff;font:12px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;transition:left .26s ease;border-radius:0 8px 8px 0}
#cc-route-maptab[data-side=l]{border-radius:8px 0 0 8px}
#cc-route-maptab:hover{background:#26375a;color:#fff}
#cc-route-maptab[hidden]{display:none!important}
#cc-route-map{position:fixed;z-index:99983;box-sizing:border-box;display:flex;flex-direction:column;background:#0f0f14;border:1px solid rgba(255,255,255,.16);color:#ddd;font:12px/1.4 system-ui,sans-serif;
  box-shadow:0 8px 30px rgba(0,0,0,.55);overflow:hidden;transition:transform .26s ease,opacity .2s ease,visibility 0s linear .26s;visibility:hidden;opacity:0;pointer-events:none}
#cc-route-map[data-side=r]{border-radius:0 10px 10px 0;transform:translateX(-102%)}
#cc-route-map[data-side=l]{border-radius:10px 0 0 10px;transform:translateX(102%)}
#cc-route-map[data-open="1"]{transform:none;visibility:visible;opacity:1;pointer-events:auto;transition:transform .26s ease,opacity .2s ease,visibility 0s}
#cc-route-map .rt-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-map .rt-ttl{font-weight:700;font-size:14px;color:#fff}
#cc-route-map .rt-sp{flex:1}
#cc-route-map .rt-x{padding:0 8px;font-size:16px;line-height:20px;color:#ddd;background:#22222c;border:1px solid #3a3a48;border-radius:6px;cursor:pointer}
#cc-route-map svg{display:block;background:#13161c;flex:1;min-height:0}
#cc-route-map .rt-dim{color:#9a9aa6}
#cc-route-map .rt-maplegend{display:flex;gap:14px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid rgba(255,255,255,.08);color:#9a9aa6;font-size:11.5px;flex:none}
#cc-route-map .rt-maplegend i{display:inline-block;width:18px;vertical-align:middle}
@media (prefers-reduced-motion:reduce){#cc-route-map,#cc-route-maptab{transition:none}}
#cc-route-alert{position:fixed;z-index:99983;display:flex;align-items:center;gap:2px;font:12px/1 system-ui,sans-serif}
#cc-route-alert[hidden]{display:none!important}
#cc-route-alert .tri{display:flex;align-items:center;gap:5px;background:rgba(10,10,14,.92);color:#ffd24a;border:1px solid #b8962f;
  border-radius:5px;padding:3px 7px;cursor:pointer;font:inherit;font-size:13px;font-weight:600}
#cc-route-alert .tri:hover{background:rgba(40,36,10,.95)}
#cc-route-alert .tri.ok{color:#6fe27a;border-color:#3f9a52}
#cc-route-alert .tri.ok:hover{background:rgba(12,40,18,.95)}
#cc-route-alert.docked{position:absolute;left:0;top:auto;bottom:calc(100% - 1px);z-index:0;gap:0;background:rgba(10,10,14,.97);border:3px solid #d9aa2c;border-bottom:none;border-radius:9px 9px 0 0;padding:3px 6px 3px 5px;
  animation:ccRaPulse 2.6s ease-in-out infinite}
@keyframes ccRaPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,210,74,0);border-color:#b8902a}50%{box-shadow:0 -2px 9px 1px rgba(255,210,74,.42);border-color:#ffd24a}}
@media (prefers-reduced-motion:reduce){#cc-route-alert.docked{animation:none}}
#cc-route-alert.docked.ok{border-color:#3f9a52;animation:none}
#cc-route-alert.docked.ok .tri.ok:hover{background:rgba(12,40,18,.8)}
#cc-route-alert.docked .tri,#cc-route-alert.docked .x{border:0;background:transparent;border-radius:4px}
#cc-route-alert.docked .x{width:16px}
#cc-route-alert .x{background:rgba(10,10,14,.92);color:#aaa;border:1px solid #444;border-radius:4px;width:18px;height:18px;line-height:14px;padding:0;cursor:pointer;font-size:13px}
#cc-route-alert .x:hover{color:#fff;border-color:#888}
`;
  const panel = document.createElement('div');
  panel.id = 'cc-route-panel';
  panel.hidden = true;
  const alertEl = document.createElement('div');
  alertEl.id = 'cc-route-alert';
  alertEl.hidden = true;

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function insertUi() {
    if (!document.body) return false;
    if (!document.getElementById('cc-route-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-route-panel')) document.body.appendChild(panel);
    if (!document.getElementById('cc-route-alert')) document.body.appendChild(alertEl);
    if (!document.getElementById('cc-route-map')) document.body.appendChild(drawer);
    if (!document.getElementById('cc-route-maptab')) document.body.appendChild(mapTab);
    return true;
  }

  function clearHl() { document.querySelectorAll('.cc-route-hl').forEach(e => e.classList.remove('cc-route-hl')); }

  const fmtXp = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const PATH_DEFS = [
    ['skill', 'Skilling XP', '#6fe27a', 'Picks your skilling options and orders them for the most levels per hour.'],
    ['combat', 'Combat XP', '#ff8a7a', 'Picks the Slay options. Combat XP is split over Slay, Life, your combat skill and Dodge/Defend.'],
    ['quest', 'Quests and scrolls', '#6fb6ff', 'Favours stops that complete your active quest steps.'],
  ];
  const lvFmt = v => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
  const pctTxt = (a, b) => (b > 0 ? (a >= b ? '+' : '\u2212') + Math.abs((a / b - 1) * 100).toFixed(Math.abs(a / b - 1) < 0.1 ? 1 : 0) + '%' : '');
  function bestPathKey() {
    const P = result && result.paths; if (!P || !P.available) return null;
    let bk = null;
    PATH_DEFS.forEach(([k]) => { if (P[k] && (!bk || P[k].m.score > P[bk].m.score)) bk = k; });
    return bk;
  }
  function selKey() {
    const P = result && result.paths;
    if (!P || !P.available) return null;
    if (selectedKey === 'cur' || (PATH_DEFS.some(d => d[0] === selectedKey) && P[selectedKey])) return selectedKey;
    return bestPathKey() || 'cur';
  }
  function planFor(key) {
    if (!result || !result.paths || !result.paths.available) return result ? result.rec : null;
    const o = key === 'cur' ? result.paths.cur : result.paths[key];
    return o ? { plan: o.plan, sig: o.sig, moved: o.moved, changed: o.changed, withTp: o.m.sim, noTp: o.m.sim, qBy: o.qBy, swaps: o.swaps || {} } : null;
  }
  const pathFlags = (c) => { let quest = false; try { quest = c.plan.some(p => { const o = result.rows[p.row].opts[p.opt]; return o.m && o.m.quest && o.m.quest.some(q => q.current); }); } catch (e) {} return (c.m.charges > 0 ? ' tp' : '') + (quest ? ' qst' : ''); };

  function pathCard(def, key, p, isBest, maxScore, curScore) {
    const [, title, color, tip] = def;
    const sel = selKey() === key;
    if (!p) {
      const off = h('div', 'rt-plan rt-off');
      const hd = h('h4'); const t = h('span', null, title); t.style.color = color; hd.appendChild(t); off.appendChild(hd);
      off.appendChild(h('div', 'rt-dim', key === 'quest' ? 'No quest steps among your queue options right now.' : 'Nothing in your queue fits this path.'));
      return off;
    }
    const m = p.m;
    const card = h('div', 'rt-plan' + (sel ? ' sel' : '') + (isBest ? ' best' : '') + pathFlags(p));
    card.title = tip;
    const hd = h('h4');
    const t = h('span', 'rt-ptitle', title); t.style.color = color; hd.appendChild(t);
    if (isBest) hd.appendChild(h('span', 'rt-badge', 'Best progress'));
    hd.appendChild(h('span', 'rt-sp'));
    const big = h('span', 'rt-big', '+' + lvFmt(m.score) + ' lv/hr'); big.title = 'Levels gained per hour: every skill\u2019s XP divided by what its next level costs'; hd.appendChild(big);
    card.appendChild(hd);
    const bar = h('div', 'rt-pbar'); const fill = document.createElement('i'); fill.style.width = Math.max(4, Math.round(m.score / (maxScore || 1) * 100)) + '%'; fill.style.background = color; bar.appendChild(fill); card.appendChild(bar);
    const st = h('div', 'rt-pstats');
    const stat = (a, b) => { const s2 = h('span'); s2.appendChild(document.createTextNode(a + ' ')); s2.appendChild(h('b', null, b)); return s2; };
    st.appendChild(stat('Total', fmtT(m.total)));
    st.appendChild(stat('Walk', fmtT(m.walk)));
    st.appendChild(stat('XP/hr', fmtXp(m.total > 0 ? m.xp / m.total * 3600 : 0)));
    if (curScore > 0) { const d = h('span', m.score >= curScore ? 'rt-good' : 'rt-bad', pctTxt(m.score, curScore) + ' vs now'); st.appendChild(d); }
    card.appendChild(st);
    const st2 = h('div', 'rt-pstats');
    st2.appendChild(h('span', m.charges ? 'rt-tpc' : 'rt-dim', m.charges ? '\u21af ' + m.charges + ' teleport' + (m.charges === 1 ? '' : 's') + ' (' + usedText(m.used) + ')' + (p.tpSaved > 0 ? ' \u00b7 saves ' + fmtT(p.tpSaved) : '') : 'no teleports'));
    st2.appendChild(h('span', p.changed ? 'rt-sw' : 'rt-dim', p.changed ? p.changed + ' pick' + (p.changed === 1 ? '' : 's') + ' swapped' : 'keeps your picks'));
    if (p.moved) st2.appendChild(h('span', 'rt-dim', p.moved + ' row' + (p.moved === 1 ? '' : 's') + ' moved'));
    card.appendChild(st2);
    if (sel) {
      const sb = h('button', 'rt-steps-btn', stepsOpen ? 'Hide steps' : 'Show steps');
      sb.addEventListener('click', e => { e.stopPropagation(); stepsOpen = !stepsOpen; render(); });
      card.appendChild(sb);
      if (stepsOpen) card.appendChild(stopsList(planFor(key), false));
    }
    card.addEventListener('click', () => { selectedKey = key; try { localStorage.setItem('cc-route-sel', key); } catch (e) {} render(); });
    return card;
  }

  function planBody(body) {
    const P = result.paths;
    const cr = result.crystals;
    if (!P || !P.available) {
      body.appendChild(h('div', 'rt-dim', xpTbl ? 'Waiting for the game data bridge (it attaches a few seconds after the game loads) \u2013 task times and XP are needed to compare paths.' : 'Loading level data\u2026'));
      const best = result.rec, dTp = prefSaved();
      const card = h('div', 'rt-plan sel');
      const hd = h('h4'); hd.appendChild(h('span', null, 'Shortest walk \u00b7 keeps your picks')); hd.appendChild(h('span', 'rt-sp')); hd.appendChild(h('span', 'rt-big', fmtT(best[prefKey()].time)));
      card.appendChild(hd); card.appendChild(h('div', 'rt-dim', dTp >= 1 ? 'Saves ' + fmtT(dTp) + ' of walking' : 'Your order is already the shortest'));
      body.appendChild(card);
      return;
    }
    const prefRow = h('div', 'rt-prefrow');
    prefRow.appendChild(h('span', 'rt-dim', 'Teleports'));
    [['foot', 'On foot', 'Plan without teleport crystals'], ['eff', 'Efficient', 'Only where a charge saves at least ' + Math.round(P.lam / 60) + ' min (Settings > Plugins > Route Advisor)'], ['max', 'Max', 'Use charges freely, fastest possible']].forEach(([k, label, tip]) => {
      const b = h('button', 'rt-seg' + (tpPref === k ? ' on' : ''), label); b.title = tip;
      b.addEventListener('click', e => { e.stopPropagation(); tpPref = k; try { localStorage.setItem('cc-route-tp-pref', k); } catch (er) {} lastSig = ''; scheduleCompute(); render(); });
      prefRow.appendChild(b);
    });
    prefRow.appendChild(h('span', 'rt-sp'));
    prefRow.appendChild(h('span', 'rt-dim', cr.length ? cr.map(c => c.charges + '\u00d7 ' + (TIER_NAME[c.tier] || 'T' + c.tier)).join(', ') : 'no crystals'));
    body.appendChild(prefRow);
    const up = tpUpsell();
    if (up) {
      const note = h('div', 'rt-upsell');
      note.appendChild(document.createTextNode('\u21af Teleports would save ' + fmtT(up.saves) + ' on this queue (' + up.used + ' charge' + (up.used === 1 ? '' : 's') + ', about ' + fmtT(up.perCharge) + ' each). '));
      const use = h('button', 'rt-seg', 'Use teleports');
      use.addEventListener('click', e => { e.stopPropagation(); tpPref = 'eff'; try { localStorage.setItem('cc-route-tp-pref', 'eff'); } catch (er) {} lastSig = ''; scheduleCompute(); render(); });
      note.appendChild(use); body.appendChild(note);
    }
    const best = bestPathKey();
    const maxScore = Math.max(P.cur.m.score, ...PATH_DEFS.map(d => (P[d[0]] ? P[d[0]].m.score : 0)));
    PATH_DEFS.forEach(d => body.appendChild(pathCard(d, d[0], P[d[0]], d[0] === best, maxScore, P.cur.m.score)));
    // Baseline: the queue as it is now.
    const cur = P.cur, cm = cur.m;
    const row = h('div', 'rt-curnow' + (selKey() === 'cur' ? ' sel' : ''));
    row.appendChild(h('span', null, 'Your queue now'));
    row.appendChild(h('b', null, '+' + lvFmt(cm.score) + ' lv/hr'));
    row.appendChild(h('span', 'rt-dim', fmtT(cm.total) + ' \u00b7 walk ' + fmtT(cm.walk) + (cm.charges ? ' \u00b7 \u21af' + cm.charges : '')));
    row.addEventListener('click', () => { selectedKey = 'cur'; try { localStorage.setItem('cc-route-sel', 'cur'); } catch (e) {} render(); });
    body.appendChild(row);
    const lg = h('div', 'rt-legend'); lg.appendChild(h('span', 'lp', '\u25a0 purple border')); lg.appendChild(document.createTextNode(' = uses teleports \u00b7 ')); lg.appendChild(h('span', 'lq', '\u25a0 blue')); lg.appendChild(document.createTextNode(' = includes a quest step'));
    body.appendChild(lg);
  }

  function stopsList(c, noTp) {
    const ol = h('ol', 'rt-stops');
    const sim = noTp ? c.noTp : c.withTp;
    c.plan.forEach((p, i) => {
      const row = result.rows[p.row], opt = row.opts[p.opt], leg = sim.legs[i];
      const nd = core.node(opt.node);
      const q = result.q && result.q.rows.find(r => r.id === row.id);
      // The option's OWN label (looked up by node it would be ambiguous when a
      // row has two options at the same location, e.g. Cook 48 vs Cook 88).
      const label = opt.label || '';
      const li = h('li');
      const tp = leg.tp ? h('span', 'rt-tp', ' ↯ teleport (' + (TIER_NAME[leg.tier] || 'T' + leg.tier) + ')') : null;
      li.appendChild(document.createTextNode((label || (nd && nd.name) || opt.node) + ' – ' + (nd ? nd.name : '') + ' '));
      li.appendChild(h('span', 'rt-dim', '(' + fmtN(leg.dist) + (leg.tp ? '' : ' · ' + fmtT(leg.dist / result.speed)) + ')'));
      if (opt.m) {
        const qv = c.qBy ? c.qBy[i] : 0; // quest value actually credited to this stop in this plan
        li.appendChild(h('span', 'rt-dim', ' · task ' + fmtT(opt.m.t) + ' · +' + fmtXp(opt.m.x) + ' xp' + (qv > 0 ? ' · quest ' + fmtXp(qv) : '')));
      }
      if (tp) li.appendChild(tp);
      const sw = c.swaps && c.swaps[p.row];
      if (sw) {
        const oldO = row.opts[sw.from];
        const why = h('div', 'rt-why');
        const head = h('div', 'rt-why-h');
        head.appendChild(h('b', null, '\u21c4 Swap'));
        head.appendChild(document.createTextNode(' instead of ' + (oldO && oldO.label ? oldO.label : 'your pick')));
        why.appendChild(head);
        const bl = (txt, good) => { const d = h('div', 'rt-why-l' + (good == null ? '' : good ? ' good' : ' bad'), txt); why.appendChild(d); };
        bl('This pick: ' + fmtT(sw.newT) + ' for +' + fmtXp(sw.newXp) + ' xp (' + lvFmt(sw.newRate) + ' lv/hr)', null);
        bl('Your pick: ' + fmtT(sw.oldT) + ' for +' + fmtXp(sw.oldXp) + ' xp (' + lvFmt(sw.oldRate) + ' lv/hr)', null);
        if (sw.newQuest && !sw.oldQuest) bl('Completes a quest step your pick does not', true);
        const dT = sw.dTotal, dL = sw.dLevels;
        bl('Effect on this path with only this swap: ' + (sw.dScore >= 0 ? '+' : '\u2212') + Math.abs(sw.dScore * 100).toFixed(1) + '% lv/hr \u00b7 ' + (dL >= 0 ? '+' : '\u2212') + Math.abs(dL).toFixed(2) + ' levels \u00b7 ' + (dT <= 0 ? fmtT(-dT) + ' less' : fmtT(dT) + ' more') + ' time' + (Math.abs(sw.dWalk) >= 1 ? ' (' + (sw.dWalk <= 0 ? fmtT(-sw.dWalk) + ' less' : fmtT(sw.dWalk) + ' more') + ' walking)' : ''), sw.dScore >= 0);
        if (sw.dScore < 0) { const dk = PATH_DEFS.find(d => d[0] === selKey()); if (dk) bl('Kept for this path’s goal: the ' + dk[1] + ' path only counts ' + ({ skill: 'skilling XP', combat: 'combat XP', quest: 'quest progress' }[dk[0]]) + ', so it can cost overall lv/hr.', null); }
        if (sw.dCharges) bl((sw.dCharges > 0 ? 'Uses ' + sw.dCharges + ' more' : 'Saves ' + -sw.dCharges) + ' teleport charge' + (Math.abs(sw.dCharges) === 1 ? '' : 's'), sw.dCharges < 0);
        li.appendChild(why);
      }
      li.addEventListener('mouseenter', () => { clearHl(); if (q) q.rowEl.classList.add('cc-route-hl'); });
      li.addEventListener('mouseleave', clearHl);
      ol.appendChild(li);
    });
    return ol;
  }

  function mapSvg(c, noTp) {
    const cur = result.current;
    const sim = noTp ? c.noTp : c.withTp;
    const pts = [];
    const nodeIds = [result.head].concat(sim.legs.map(l => l.to), cur.withTp.legs.map(l => l.to));
    nodeIds.forEach(id => { const n = core.node(id); if (n) pts.push([n.pos.x, n.pos.y]); });
    // Bounds must cover everything drawn: both legs' endpoints and the winding road
    // points between them (hub paths can bulge well outside the stop nodes).
    [sim.legs, cur.withTp.legs, cur.noTp.legs].forEach(legs => legs.forEach(l => {
      [l.from, l.to].forEach(id => { const n = core.node(id); if (n) pts.push([n.pos.x, n.pos.y]); });
      if (!l.tp) { try { legPoints(l.from, l.to).forEach(p => pts.push([p[0], p[1]])); } catch (e) {} }
    }));
    if (!pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08 + 50;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const W = x1 - x0, H = y1 - y0;
    const NS_SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS_SVG, 'svg');
    svg.setAttribute('viewBox', x0 + ' ' + y0 + ' ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.height = Math.round(Math.min(420, Math.max(220, 330 * H / W))) + 'px';
    const sw = Math.max(W, H) / 260;
    const line = (points, color, width, dash, op) => {
      const p = document.createElementNS(NS_SVG, 'polyline');
      p.setAttribute('points', points.map(q => q[0] + ',' + q[1]).join(' '));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', width);
      p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
      if (dash) p.setAttribute('stroke-dasharray', dash); if (op) p.setAttribute('opacity', op);
      svg.appendChild(p);
    };
    const drawLegs = (legs, color, width, op, skipTp) => legs.forEach(l => {
      if (l.tp) { if (!skipTp) { const A = core.node(l.from), B = core.node(l.to); line([[A.pos.x, A.pos.y], [B.pos.x, B.pos.y]], '#ffd24a', width, (sw * 6) + ' ' + (sw * 4), 0.9); } return; }
      line(legPoints(l.from, l.to), color, width, null, op);
    });
    if (c !== cur) drawLegs(cur.withTp.legs, '#7a7a88', sw * 1.4, 0.6, true);
    drawLegs(sim.legs, '#5fdc6a', sw * 2.4, 1, false);
    const dot = (id, label, color) => {
      const n = core.node(id); if (!n) return;
      const g = document.createElementNS(NS_SVG, 'circle');
      g.setAttribute('cx', n.pos.x); g.setAttribute('cy', n.pos.y); g.setAttribute('r', sw * 5); g.setAttribute('fill', color);
      svg.appendChild(g);
      const t = document.createElementNS(NS_SVG, 'text');
      t.setAttribute('x', n.pos.x); t.setAttribute('y', n.pos.y + sw * 3.2); t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', sw * 8); t.setAttribute('fill', '#000'); t.setAttribute('font-weight', '700');
      t.textContent = label; svg.appendChild(t);
    };
    // Stops that sit on (or very near) each other fan out side by side so every numbered stop stays visible.
    const items = sim.legs.map((l, k) => ({ id: l.to, label: String(k + 1), n: core.node(l.to) })).filter(it => it.n);
    const R = sw * 5, gap = R * 2.35;
    const groups = [];
    items.forEach(it => {
      const g = groups.find(q => Math.hypot(q.x - it.n.pos.x, q.y - it.n.pos.y) < R * 3);
      if (g) g.items.push(it); else groups.push({ x: it.n.pos.x, y: it.n.pos.y, items: [it] });
    });
    const headN = core.node(result.head);
    if (headN) { const hg = groups.find(q => Math.hypot(q.x - headN.pos.x, q.y - headN.pos.y) < R * 3); if (hg) hg.items.unshift({ id: result.head, label: '\u25b6', n: headN, head: true }); else groups.push({ x: headN.pos.x, y: headN.pos.y, items: [{ id: result.head, label: '\u25b6', n: headN, head: true }] }); }
    groups.forEach(g => {
      const n = g.items.length;
      g.items.forEach((it, i) => {
        const cx = g.x + (i - (n - 1) / 2) * gap, cy = n > 1 ? g.y - R * 1.6 : g.y;
        if (n > 1) { const ln = document.createElementNS(NS_SVG, 'line'); ln.setAttribute('x1', g.x); ln.setAttribute('y1', g.y); ln.setAttribute('x2', cx); ln.setAttribute('y2', cy); ln.setAttribute('stroke', '#ffd24a'); ln.setAttribute('stroke-width', sw * 0.8); ln.setAttribute('opacity', '0.7'); svg.appendChild(ln); }
      });
      if (n > 1) { const a = document.createElementNS(NS_SVG, 'circle'); a.setAttribute('cx', g.x); a.setAttribute('cy', g.y); a.setAttribute('r', sw * 2); a.setAttribute('fill', '#ffd24a'); svg.appendChild(a); }
      g.items.forEach((it, i) => {
        const cx = g.x + (i - (n - 1) / 2) * gap, cy = n > 1 ? g.y - R * 1.6 : g.y;
        const c = document.createElementNS(NS_SVG, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', R); c.setAttribute('fill', it.head ? '#4ea3ff' : '#ffd24a'); c.setAttribute('stroke', '#0f0f14'); c.setAttribute('stroke-width', sw * 0.9);
        svg.appendChild(c);
        const t = document.createElementNS(NS_SVG, 'text');
        t.setAttribute('x', cx); t.setAttribute('y', cy + sw * 3.2); t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', sw * 8); t.setAttribute('fill', '#000'); t.setAttribute('font-weight', '700');
        t.textContent = it.label; svg.appendChild(t);
      });
    });
    return svg;
  }

  function render() {
    insertUi();
    const enabled = settingOn('routeAdvisorEnabled', true);
    const mapActive = document.body.classList.contains('map-active');
    if (mapActive && !wasMapActive) userClosedOnMap = false;
    wasMapActive = mapActive;
    const wantPanel = enabled && (result || calc) && (userOpen || (mapActive && settingOn('routeAdvisorAutoMap', true) && !userClosedOnMap));
    panel.hidden = !wantPanel;
    // alert triangle
    const minSave = Math.max(5, Number(settingOn('routeAdvisorMinSaveSec', 30)) || 30);
    const saved = result ? prefSaved() : 0;
    // Having the panel open counts as having seen the current suggestion: dismiss the warning until the calculation changes.
    if (wantPanel && result && recSig() !== dismissedSig) { dismissedSig = recSig(); try { localStorage.setItem(LS_DISMISS, dismissedSig); } catch (err) {} }
    // Persistent badge on the Tasks panel: yellow warning while a faster route is waiting, then (once dismissed, or when nothing is left to save)
    // a calm green badge showing the saving or "optimal". Always one click from the Route Advisor, no World Map needed.
    const alertOn = enabled && settingOn('routeAdvisorAlert', true) && result && !wantPanel;
    const warn = saved >= minSave && recSig() !== dismissedSig;
    alertEl.hidden = !alertOn;
    if (alertOn) {
      alertEl.textContent = '';
      alertEl.classList.toggle('ok', !warn);
      const canSave = saved >= minSave;
      const tri = h('button', 'tri' + (warn ? '' : ' ok'), warn ? '\u26a0 \u2212' + fmtT(saved) : canSave ? '\u21af \u2212' + fmtT(saved) + ' possible' : '\u2713 Route optimal');
      tri.title = canSave ? 'A faster route exists for your queue (' + fmtT(saved) + ' less walking). Click to open the Route Advisor.' : 'Your queue order is already optimal. Click to open the Route Advisor anyway.';
      tri.addEventListener('click', e => { e.stopPropagation(); userOpen = true; render(); });
      alertEl.appendChild(tri);
      if (warn) {
        const x = h('button', 'x', '\u00d7');
        x.title = 'Dismiss the warning (the badge stays, in green)';
        x.addEventListener('click', e => { e.stopPropagation(); dismissedSig = recSig(); try { localStorage.setItem(LS_DISMISS, dismissedSig); } catch (err) {} render(); });
        alertEl.appendChild(x);
      }
      placeAlert();
    }
    if (!wantPanel) { placeExtras(); return; }

    const prevBody = panel.querySelector('.rt-body');
    const prevScroll = prevBody ? prevBody.scrollTop : 0;
    panel.textContent = '';

    if (!result) {
      // First calculation: nothing to show yet, just the progress.
      const hd = h('div', 'rt-head');
      hd.appendChild(h('span', 'rt-ttl', 'Route Advisor')); hd.appendChild(h('span', 'rt-sp'));
      const cl = h('button', 'rt-x', '\u00d7'); cl.addEventListener('click', e => { e.stopPropagation(); userOpen = false; if (mapActive) userClosedOnMap = true; render(); });
      hd.appendChild(cl); panel.appendChild(hd); wireDrag(hd);
      panel.appendChild(calcStrip());
      panel.classList.remove('calculating');
      restorePos(); placeExtras();
      return;
    }
    panel.classList.toggle('calculating', !!calc);
    // --- header (solid, draggable) ---
    const P = result.paths, bk = bestPathKey();
    const head = h('div', 'rt-head');
    head.appendChild(h('span', 'rt-ttl', 'Route Advisor'));
    if (P && P.available && bk) {
      const up = P.cur.m.score > 0 ? P[bk].m.score / P.cur.m.score - 1 : 0;
      head.appendChild(h('span', 'rt-pill' + (up >= 0.02 ? ' good' : ''), up >= 0.02 ? 'Best: +' + Math.round(up * 100) + '% lv/hr' : 'Already near-optimal'));
    } else {
      const dTp = prefSaved();
      head.appendChild(h('span', 'rt-pill' + (dTp >= 1 ? ' good' : ''), dTp >= 1 ? '\u2212' + fmtT(dTp) + ' walking' : 'Already optimal'));
    }
    head.appendChild(h('span', 'rt-sp'));
    const close = h('button', 'rt-x', '\u00d7');
    close.title = 'Close';
    close.addEventListener('click', e => { e.stopPropagation(); userOpen = false; if (mapActive) userClosedOnMap = true; render(); });
    head.appendChild(close);
    panel.appendChild(head);
    wireDrag(head);
    if (calc) panel.appendChild(calcStrip());

    const body = h('div', 'rt-body');
    panel.appendChild(body);
    planBody(body);
    body.appendChild(h('div', 'rt-note', 'Display only \u2013 apply a suggestion by dragging queue rows / picking options yourself. lv/hr = weighted levels gained per hour (combat levels count ' + Math.round((Number(settingOn('routeCombatWeightPct', 40)) || 0)) + '%, see Settings > Plugins > Route Advisor). ' +
      result.evaluated + ' plans checked in ' + Math.round(result.ms) + ' ms' + (result.rows.length < (result.q ? result.q.rows.length : 0) ? '; first ' + result.rows.length + ' rows optimised' : '') + '.'));
    body.scrollTop = prevScroll;
    restorePos();
    placeExtras();
  }

  // ---- map drawer: slides out from the panel's outer edge -----------------------------------------------------
  const mapTab = document.createElement('button');
  mapTab.id = 'cc-route-maptab'; mapTab.type = 'button'; mapTab.hidden = true;
  const drawer = document.createElement('div');
  drawer.id = 'cc-route-map'; drawer.setAttribute('data-open', '0');
  const DRAWER_W = 340;
  mapTab.addEventListener('click', e => { e.stopPropagation(); mapOpen = !mapOpen; try { localStorage.setItem('cc-route-map-open', mapOpen ? '1' : '0'); } catch (er) {} if (mapOpen && polyState === 'idle') loadPolylines(); placeExtras(); });
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach(t => drawer.addEventListener(t, e => e.stopPropagation()));
  function renderDrawer() {
    const key = selKey(), c = key ? planFor(key) : null;
    const def = PATH_DEFS.find(d => d[0] === key);
    const sig = key + '|' + (c ? c.sig : '') + '|' + polyState + '|' + (result ? result.current.sig : '');
    if (drawer.dataset.sig === sig) return;
    drawer.dataset.sig = sig;
    drawer.textContent = '';
    const hd = h('div', 'rt-head');
    hd.appendChild(h('span', 'rt-ttl', 'Map'));
    const sub = h('span', 'rt-dim', key === 'cur' ? 'Your queue now' : def ? def[1] + ' path' : 'Recommended');
    if (def) sub.style.color = def[2];
    hd.appendChild(sub); hd.appendChild(h('span', 'rt-sp'));
    const x = h('button', 'rt-x', '\u00d7'); x.title = 'Hide the map';
    x.addEventListener('click', e => { e.stopPropagation(); mapOpen = false; try { localStorage.setItem('cc-route-map-open', '0'); } catch (er) {} placeExtras(); });
    hd.appendChild(x); drawer.appendChild(hd);
    if (polyState === 'idle') loadPolylines();
    const svg = c ? mapSvg(c, false) : null;
    if (svg) { svg.style.width = '100%'; drawer.appendChild(svg); } else drawer.appendChild(h('div', 'rt-dim', polyState === 'error' ? 'Could not load the map data.' : 'Loading the map\u2026'));
    const lg = h('div', 'rt-maplegend');
    [['#7a7a88', 'Current order', ''], ['#5fdc6a', 'Recommended', ''], ['#ffd24a', 'Teleport', 'dash']].forEach(([col, label, dash]) => {
      const s2 = h('span'); const sw = h('i'); sw.style.borderTop = '2px ' + (dash ? 'dashed' : 'solid') + ' ' + col; s2.appendChild(sw); s2.appendChild(document.createTextNode(' ' + label)); lg.appendChild(s2);
    });
    drawer.appendChild(lg);
  }
  let moving = false; // panel being dragged / resized: the map tab must follow instantly, not glide
  function placeExtras() {
    insertUi();
    mapTab.style.transition = moving ? 'none' : '';
    const r = panel.getBoundingClientRect();
    const show = !panel.hidden && r.width > 0 && !!result;
    mapTab.hidden = !show;
    if (!show) { drawer.setAttribute('data-open', '0'); panel.dataset.mapSide = ''; return; }
    const roomR = innerWidth - r.right, roomL = r.left;
    const side = roomR >= DRAWER_W + 24 || roomR >= roomL ? 'r' : 'l';
    const H = Math.max(300, Math.min(r.height, innerHeight - 20));
    drawer.dataset.side = side;
    panel.dataset.mapSide = mapOpen ? side : '';
    drawer.style.top = Math.round(r.top) + 'px'; drawer.style.height = Math.round(H) + 'px'; drawer.style.width = DRAWER_W + 'px';
    drawer.style.left = Math.round(side === 'r' ? r.right - 1 : r.left - DRAWER_W + 1) + 'px';
    drawer.setAttribute('data-open', mapOpen ? '1' : '0');
    if (mapOpen) renderDrawer();
    mapTab.dataset.side = side; mapTab.dataset.open = mapOpen ? '1' : '0';
    mapTab.textContent = mapOpen ? (side === 'r' ? '\u25c2 Map' : 'Map \u25b8') : (side === 'r' ? 'Map \u25b8' : '\u25c2 Map');
    const tabW = 26;
    const edgeX = side === 'r' ? (mapOpen ? r.right + DRAWER_W - 1 : r.right - 1) : (mapOpen ? r.left - DRAWER_W + 1 - tabW : r.left - tabW + 1);
    mapTab.style.left = Math.round(edgeX) + 'px'; mapTab.style.top = Math.round(r.top + 58) + 'px';
  }

  function calcStrip() {
    const w = h('div', 'rt-calc' + (calc && calc.load ? ' load' : ''));
    const top = h('div', 'rt-calc-top');
    top.appendChild(h('span', 'rt-spin'));
    top.appendChild(h('span', null, calc && calc.load ? 'Loading map data (first time takes a moment)\u2026' : result ? 'Recalculating the best route\u2026' : 'Calculating the best route\u2026'));
    top.appendChild(h('span', 'rt-sp'));
    if (!(calc && calc.load)) top.appendChild(h('b', null, Math.round((calc ? calc.p : 0) * 100) + '%'));
    w.appendChild(top);
    const bar = h('div', 'rt-calc-bar'); const fill = document.createElement('i'); fill.style.width = Math.round((calc ? calc.p : 0) * 100) + '%'; bar.appendChild(fill); w.appendChild(bar);
    return w;
  }

  function placeAlert() {
    const q = document.querySelector('#unified-queue-panel');
    const host = q ? (q.closest('.panel-floating') || q) : null;
    const r = host ? host.getBoundingClientRect() : null;
    if (!r || !r.width) { alertEl.hidden = true; return; }
    // Lives INSIDE the Tasks panel, absolutely positioned on its top edge like a tab: it then shares the panel's scale,
    // zoom, position and stacking level (so windows / other panels correctly cover it). Re-attached if the game rebuilds the panel.
    alertEl.classList.add('docked');
    if (alertEl.parentElement !== host) host.appendChild(alertEl);
  }

  // draggable panel
  const LS_SIZE = 'cc-route-panel-size';
  function applySize() {
    try {
      const z = JSON.parse(localStorage.getItem(LS_SIZE) || 'null');
      if (z && z.w) { panel.style.width = Math.max(340, Math.min(innerWidth - 20, z.w)) + 'px'; }
      if (z && z.h) { panel.style.height = Math.max(240, Math.min(innerHeight - 20, z.h)) + 'px'; panel.style.maxHeight = 'none'; }
    } catch (e) {}
  }
  function addGrip() {
    const g = h('div', 'rt-grip'); g.title = 'Drag to resize \u00b7 double-click to reset';
    g.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation(); moving = true;
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const move = ev => {
        panel.style.width = Math.max(340, Math.min(innerWidth - r.left - 4, r.width + ev.clientX - sx)) + 'px';
        panel.style.height = Math.max(240, Math.min(innerHeight - r.top - 4, r.height + ev.clientY - sy)) + 'px';
        panel.style.maxHeight = 'none';
        placeExtras();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); moving = false; placeExtras();
        const b = panel.getBoundingClientRect();
        try { localStorage.setItem(LS_SIZE, JSON.stringify({ w: Math.round(b.width), h: Math.round(b.height) })); } catch (err) {}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', e => { e.stopPropagation(); try { localStorage.removeItem(LS_SIZE); } catch (err) {} panel.style.width = ''; panel.style.height = ''; panel.style.maxHeight = ''; placeExtras(); });
    panel.appendChild(g);
  }
  function restorePos() {
    applySize();
    if (!panel.querySelector('.rt-grip')) addGrip();
    try { const p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); if (p) { panel.style.left = Math.min(innerWidth - 60, Math.max(0, p.x)) + 'px'; panel.style.top = Math.min(innerHeight - 40, Math.max(0, p.y)) + 'px'; } } catch (e) {}
  }
  function wireDrag(bar) {
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation(); moving = true;
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      // Clamp: at least 80 px x 30 px of the panel always stays on screen.
      const move = ev => {
        panel.style.left = Math.max(80 - r.width, Math.min(innerWidth - 80, r.left + ev.clientX - sx)) + 'px';
        panel.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px';
        placeExtras();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); moving = false; placeExtras();
        try { localStorage.setItem(LS_POS, JSON.stringify({ x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) })); } catch (err) {}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  // Keep game clicks from passing through the panel.
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));

  // --- main loop -----------------------------------------------------------
  let timerId = null;
  function tick() {
    try {
      if (!settingOn('routeAdvisorEnabled', true)) { panel.hidden = true; alertEl.hidden = true; return; }
      if (dataState === 'idle') loadData();
      if (!xpTbl) loadXpTbl();
      if (dataState === 'ready') {
        const s = signature();
        if (s !== lastSig) { lastSig = s; scheduleCompute(); }
      }
      const mapActive = document.body.classList.contains('map-active');
      if (mapActive !== wasMapActive) render();
      else if (!alertEl.hidden) placeAlert();
    } catch (e) { /* never let a bad tick stop the loop */ }
  }
  function loop() { timerId = setTimeout(() => { if (!document.hidden) tick(); loop(); }, 800); }
  insertUi();
  loop();

  function teardown() {
    calcRun++; clearTimeout(timerId); clearTimeout(computeTimer);
    panel.remove(); alertEl.remove(); drawer.remove(); mapTab.remove(); style.remove(); clearHl();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc route-advisor torn down';
  }
  window[NS] = {
    version: 1, teardown, core,
    get result() { return result; },
    recompute() { lastSig = ''; tick(); },
    setTpPref(k) { tpPref = k === 'foot' ? 'foot' : k === 'max' ? 'max' : 'eff'; try { localStorage.setItem('cc-route-tp-pref', tpPref); } catch (e) {} lastSig = ''; },
    open() { userOpen = true; render(); },
    get state() { return { data: dataState, polys: polyState }; },
  };
  console.log('[cc] route-advisor loaded');
  return 'cc route-advisor loaded';
})();
