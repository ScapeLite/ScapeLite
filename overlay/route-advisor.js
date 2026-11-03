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
//   - Walking time = distance / the current walking speed (game bridge speed(): potions included; 15 steps/s when there is no bridge).
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

  //#core-begin
  const THRESH = { 1: 15000, 2: 12000, 3: 10000 };
  const MAX_ROWS = 10; // rows optimised exactly (subset DP); later rows keep their order after these

  function polyLen(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return d;
  }

  // The optimiser. Everything in here is DETERMINISTIC and free of the clock, the DOM and random numbers: the same input always gives the same
  // plan (docs/ROUTE-ADVISOR-MODEL.md). The search is exact (dynamic programming over the rows done, the option last taken, the teleport charges
  // used and the quest progress), ties go to the plan closest to the queue as it stands, and a change is only suggested when it clears a
  // threshold (stab) measured against both the queue and the previous suggestion (inc).
  function createCore() {
    let byId = {}, bankLen = new Map();
    const cache = new Map();
    // Seconds each queued task costs on top of its task time and the walk to it: banking and setting off. Measured on 462 completed skilling tasks and the
    // history gaps (docs/ROLL-MODEL-CALIBRATION.md): about 55 s a task (45 to 80 s). Not charged when the task is the very same one as the one before it.
    const TASK_OVERHEAD_S = 60;
    const FOOT_PEN = 21600;   // seconds charged for a leg the game would teleport on a plan that is meant to be on foot
    const QW = 0.05;          // the Quests path: weight of plain levels next to quest credit
    const BIG = 4e5;          // steps, for a pair of banks the path data does not know

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
          v = l == null ? v + BIG : v + l;
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

    const nodesOf = (rows, plan) => plan.map(p => rows[p.row].opts[p.opt].node);
    const sigOf = plan => plan.map(p => p.row + ':' + p.opt).join(',');
    const rowKeyOf = r => r.opts.map(o => o.node).sort().join(',');
    // a row's identity across recalculations: the sorted option nodes plus how many identical rows come before it (the same key the queue UI uses)
    const rowIds = rows => { const seen = {}; return rows.map(r => { const k = rowKeyOf(r); const n = seen[k] || 0; seen[k] = n + 1; return k + '#' + n; }); };

    function describe(rows, head, plan, crystals, speed, curPlan) {
      const withTp = simulate(head, nodesOf(rows, plan), crystals, speed, true), noTp = simulate(head, nodesOf(rows, plan), [], speed, false);
      let moved = 0, changed = 0;
      plan.forEach((p, pos) => {
        const cp = curPlan.findIndex(c => c.row === p.row);
        if (cp !== pos) moved++;
        if (curPlan[cp] && curPlan[cp].opt !== p.opt) changed++;
      });
      return { plan, sig: sigOf(plan), moved, changed, withTp, noTp };
    }

    // ---- Exact search --------------------------------------------------------------------------------------------------------------------
    // Minimises, over every ORDER of the rows and every OPTION choice, the additive cost
    //   A * (task time + leg time + lam per teleport charge + foot penalty) - option value - quest credit + DELTA * disruption
    // State = (rows done, option taken last, charges used, quest progress). The game's teleport rule (which crystal's threshold applies depends only
    // on how many charges were used) and the quest chain (a step counts only when it is the quest's next one) need nothing more, so the result is the
    // true optimum, not a heuristic one. DELTA is far below any real difference: it only decides exact ties, in favour of the plan that moves
    // the fewest rows and swaps the fewest picks (so a plan that is already optimal is never replaced by an equal one).
    // S: n, G, rowOf[], optOf[] (per flat option), tAct[], kv[], optDiff[], headD[], D (G*G), curPos[] (per row), A, delta, speed, lam, tpOn, C, thr[],
    //    foot, thr0, Q, cred (G*Q), nxt (G*Q)
    function dpSolve(S) {
      const { n, G, rowOf, A, delta, speed, lam } = S;
      const C1 = S.C + 1, Q = S.Q, M = 1 << n, N = M * G * C1 * Q;
      const dp = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1);
      const base = new Float64Array(G);
      for (let g = 0; g < G; g++) base[g] = A * S.tAct[g] - S.kv[g] + delta * S.optDiff[g];
      const thr = S.thr, tpOn = S.tpOn, foot = S.foot, thr0 = S.thr0, cred = S.cred, nxt = S.nxt;
      let tpf = 0;
      const legCost = (d, c) => {
        if (tpOn && c < S.C && d > thr[c]) { tpf = 1; return A * lam; }
        tpf = 0;
        return A * (d / speed + (foot && d > thr0 ? FOOT_PEN : 0));
      };
      for (let g = 0; g < G; g++) {
        const r = rowOf[g];
        let v = legCost(S.headD[g], 0);
        const c2 = tpf;
        if (S.ovh && !S.sameHead[g]) v += A * S.ovh;
        v += base[g] - (cred ? cred[g * Q] : 0) + delta * (S.curPos[r] !== 0 ? 1 : 0);
        const idx = ((((1 << r) * G + g) * C1) + c2) * Q + (nxt ? nxt[g * Q] : 0);
        if (v < dp[idx]) dp[idx] = v;
      }
      const D = S.D;
      for (let mask = 1; mask < M; mask++) {
        let pos = 0; for (let m = mask; m; m &= m - 1) pos++;
        for (let g = 0; g < G; g++) {
          if (!((mask >> rowOf[g]) & 1)) continue;
          for (let c = 0; c < C1; c++) {
            for (let qs = 0; qs < Q; qs++) {
              const idx = (((mask * G + g) * C1) + c) * Q + qs, v = dp[idx];
              if (v === Infinity) continue;
              for (let g2 = 0; g2 < G; g2++) {
                const r2 = rowOf[g2];
                if ((mask >> r2) & 1) continue;
                let nv = v + legCost(D[g * G + g2], c) + base[g2] + (S.curPos[r2] !== pos ? delta : 0) + (S.ovh && !S.same[g * G + g2] ? A * S.ovh : 0);
                const c2 = c + tpf;
                let q2 = qs;
                if (cred) { nv -= cred[g2 * Q + qs]; q2 = nxt[g2 * Q + qs]; }
                const ni = ((((mask | (1 << r2)) * G + g2) * C1) + c2) * Q + q2;
                if (nv < dp[ni]) { dp[ni] = nv; par[ni] = idx; }
              }
            }
          }
        }
      }
      let best = -1, bv = Infinity;
      const fm = (M - 1) * G;
      for (let g = 0; g < G; g++) for (let c = 0; c < C1; c++) for (let qs = 0; qs < Q; qs++) { const i = ((fm + g) * C1 + c) * Q + qs; if (dp[i] < bv) { bv = dp[i]; best = i; } }
      if (best < 0) return null;
      const gs = [];
      for (let i = best; i >= 0; i = par[i]) gs.push(Math.floor(i / (C1 * Q)) % G);
      gs.reverse();
      return { gs, cost: bv, states: N };
    }

    // ---- Everything the objective needs, built once per input ---------------------------------------------------------------------------
    function prep(input) {
      const head = input.head;
      const speed = Math.round((Number(input.speed) > 0 ? Number(input.speed) : 15) * 100) / 100;   // quantised: a rate that wobbles in the 4th digit must not matter
      const crystals = (input.crystals || []).filter(c => c && c.charges > 0).map(c => ({ tier: c.tier, charges: c.charges, name: c.name }));
      const q0 = x => (Number.isFinite(x) ? Math.round(x) : x);
      const qm = m => {
        const c = Object.assign({}, m); c.t = q0(m.t); if (Number.isFinite(m.x)) c.x = q0(m.x);
        c.sk = {}; for (const k in (m.sk || {})) c.sk[k] = q0(m.sk[k]);
        c.quest = m.quest ? m.quest.map(x => Object.assign({}, x)) : m.quest;
        return c;
      };
      const all = (input.rows || []).filter(r => r.opts.some(o => byId[o.node]));
      const rows = all.slice(0, MAX_ROWS).map(r => ({ id: r.id, opts: r.opts.filter(o => byId[o.node]).map(o => ({ node: o.node, selected: o.selected, label: o.label, idx: o.idx, m: o.m ? qm(o.m) : undefined })) }));
      if (!rows.length || !byId[head]) return null;
      const curPlan = rows.map((r, i) => ({ row: i, opt: Math.max(0, r.opts.findIndex(o => o.selected)) }));
      const thr0 = crystals.length ? (THRESH[crystals[0].tier] || 15000) : null;
      const chargeThr = []; crystals.forEach(c => { for (let k = 0; k < c.charges && chargeThr.length < rows.length; k++) chargeThr.push(THRESH[c.tier] || 15000); });
      const hm0 = input.hm || null;
      const hm = hm0 ? qm(Object.assign({ sk: {} }, hm0)) : { t: 0, sk: {}, v: 0, qv: 0, k: 'skill' };
      const qi = {}; Object.keys(input.questInfo || {}).forEach(n => { qi[n] = Object.assign({}, input.questInfo[n]); });
      return { input, head, speed, crystals, rows, curPlan, thr0, chargeThr, hm, qi, n: rows.length, ids: rowIds(rows) };
    }

    // The three paths (Skilling / Combat / Quests), compared in levels per hour. Every option carries m = {t: action seconds, k: 'skill'|'slay',
    // sk: {skill: xp}, v: weighted levels it is worth, qv: levels of quest credit}. A path maximises its own kind of value per hour of "effective"
    // time = task time + walking + lam per teleport charge used (+ a large penalty per forced teleport on a foot plan). All three are then
    // scored the same way, exact weighted levels gained per real hour, so combat's multi-skill XP and a quest reward compare with plain skilling.
    function* buildPaths(P) {
      const { rows, head, crystals, speed, curPlan, thr0, chargeThr, input, hm, qi, n } = P;
      const tbl = input.table, SK = input.skills;
      const hasM = !!tbl && !!SK && rows.every(r => r.opts.every(o => o.m && Number.isFinite(o.m.t) && o.m.sk));
      if (!hasM) return { available: false };
      const tpOn = input.tpMode !== 'foot' && thr0 != null;
      const footLock = input.tpMode === 'foot' && thr0 != null;
      const lam = tpOn ? Math.max(0, input.tpSteps > 0 && speed > 0 ? input.tpSteps / speed : Number(input.tpPrice) || 0) : 0;   // seconds a teleport charge must save
      const wC = input.wCombat != null ? Math.max(0, Number(input.wCombat)) : 1;
      const COMBAT = new Set(['slay', 'spirit', 'life', 'dodge', 'defend', 'strike', 'heft', 'sight', 'draw', 'surge', 'focus', 'fortify']);   // Vigor is trained by plain skilling tasks, so it is not discounted as a combat skill
      const prio = input.prio || {};
      // "Even progress": no favourites. Skills in the lowest 10-level band count most, the next band a little, the rest normal.
      const evenBand = (() => {
        if (!prio._even) return null;
        const mins = { s: 99, c: 99 };
        for (const k in SK) { const b = Math.floor((SK[k].level || 1) / 10); const g = COMBAT.has(k) ? 'c' : (k === 'luck' || k === 'alms' || k === 'delve' || k === 'fortify') ? null : 's'; if (g && b < mins[g]) mins[g] = b; }
        return mins;
      })();
      const evenW = k => { if (!evenBand || !SK[k]) return 1; const g = COMBAT.has(k) ? 'c' : (k === 'luck' || k === 'alms' || k === 'delve' || k === 'fortify') ? null : 's'; if (!g) return 1; const d = Math.floor((SK[k].level || 1) / 10) - evenBand[g]; return d <= 0 ? 1.7 : d === 1 ? 1.25 : 1; };
      const wOf = k => (COMBAT.has(k) ? wC : 1) * (prio[k] != null && k !== '_even' ? Number(prio[k]) : 1) * evenW(k);
      // Objective: 'xp' (default) values raw XP x skill priority; 'levels' values XP by what each skill's next level costs; 'balanced' averages the two.
      const objective = input.objective === 'levels' || input.objective === 'balanced' ? input.objective : 'xp';
      const realSpan = k => { const L = SK[k]; if (!L) return 0; const a = tbl[L.level], b = tbl[L.level + 1]; return a != null && b != null && b > a ? b - a : 0; };
      const REF = (() => { const a = Object.keys(SK).map(realSpan).filter(x => x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 20000; })();
      const spanOf = k => { const r = realSpan(k); return !r ? 0 : objective === 'levels' ? r : objective === 'balanced' ? Math.sqrt(r * REF) : REF; };
      const lvVal = sk => { let v = 0; for (const k in sk) { const sp = spanOf(k); if (sp) v += wOf(k) * sk[k] / sp; } return v; };
      Object.keys(qi).forEach(nm => { qi[nm].lv = lvVal(qi[nm].xpBy || {}); });
      // The quest step the running task already completes: a queued stop for the same step would add nothing.
      const headStep = {};
      (hm.quest || []).forEach(cq => { const info = qi[cq.name]; if (info && (cq.exact || cq.current) && cq.step === info.current + 1) headStep[cq.name] = cq.step; });
      const qLv = (m, isHead) => (m.quest || []).filter(cq => cq.current && (isHead || headStep[cq.name] !== cq.step)).reduce((a, cq) => { const info = qi[cq.name]; return info ? a + (info.lv || 0) / Math.max(1, info.steps - info.current) : a; }, 0);
      const TW = (input.taskW || []).filter(r => r && r.match && Number.isFinite(Number(r.mult))).map(r => ({ alts: String(r.match).toLowerCase().split('|').map(x => x.trim()).filter(Boolean), mult: Number(r.mult) }));
      const luckyW = Math.max(1, Number(input.luckyBoost) || 1);
      const dropW = Math.max(1, Number(input.dropBoost) || 1);
      const bdW = m => (m && m.boostDrops > 0 ? dropW : 1);   // mobs that can still drop an XP-boost item you have not logged
      const actW = m => { if (m && m.lucky && luckyW > 1) return luckyW * bdW(m); const a = m && typeof m.act === 'string' ? m.act.toLowerCase() : ''; const bd = bdW(m); if (!a) return bd; for (const r of TW) if (r.alts.some(x => a.includes(x))) return r.mult * bd; return bd; };
      rows.forEach(r => r.opts.forEach(o => { o.m.v = lvVal(o.m.sk) * actW(o.m); o.m.qv = qLv(o.m); }));
      hm.v = lvVal(hm.sk || {}) * actW(hm); hm.qv = hm.quest ? qLv(hm, true) : (hm.qv || 0);
      // The same task as the one before it (same activity or mob at the same node) needs no new set-up: no overhead. An option that does not name its activity always pays it.
      const taskKey = (node, m) => (m && m.act != null && node ? node + '|' + m.act : null);
      const headKey = taskKey(head, hm);
      const fracAt = (skill, xp) => {
        let l = SK[skill] ? Math.max(1, SK[skill].level - 1) : 1;
        while (l > 1 && tbl[l] > xp) l--;
        while (tbl[l + 1] != null && tbl[l + 1] <= xp) l++;
        const lo = tbl[l], hi = tbl[l + 1];
        return hi != null && hi > lo ? l + (xp - lo) / (hi - lo) : l;
      };
      const gainLv = g => { let s = 0; for (const k in g) { if (!SK[k]) continue; const real = wOf(k) * (fracAt(k, SK[k].xp + g[k]) - fracAt(k, SK[k].xp)), flat = wOf(k) * g[k] / REF; s += objective === 'levels' ? real : objective === 'xp' ? flat : (real + flat) / 2; } return s; };
      // Quest credit in levels, in plan order: each quest advances one step per stop and only when the stop's node EXACTLY matches the quest's NEXT
      // required step; every step is credited once.
      const questBy = plan => {
        const next = {}, by = [];
        Object.keys(headStep).forEach(nm => { next[nm] = headStep[nm] + 1; });
        plan.forEach(p => {
          const m = rows[p.row].opts[p.opt].m;
          let credit = 0;
          if (m && m.quest) {
            const used = new Set();
            for (const cq of m.quest) {
              const info = qi[cq.name];
              if (!info || !(cq.exact || cq.current) || used.has(cq.name)) continue;
              const need = next[cq.name] != null ? next[cq.name] : info.current + 1;
              if (cq.step === need) { credit += (info.lv || 0) / Math.max(1, info.steps - info.current); next[cq.name] = need + 1; used.add(cq.name); }
            }
          }
          by.push(credit);
        });
        return by;
      };
      // The real numbers of a plan: no incumbent, no penalty, nothing that depends on the clock.
      const measure = plan => {
        const sim = simulate(head, nodesOf(rows, plan), crystals, speed, tpOn);
        let t = hm.t, v = hm.v || 0, vSkill = hm.k === 'skill' ? (hm.v || 0) : 0, vCombat = hm.k === 'slay' ? (hm.v || 0) : 0;
        const gains = Object.assign({}, hm.sk);
        let prevKey = headKey, overhead = 0;
        plan.forEach(p => {
          const o = rows[p.row].opts[p.opt], m = o.m, key = taskKey(o.node, m);
          if (!key || key !== prevKey) overhead += TASK_OVERHEAD_S;
          prevKey = key;
          t += m.t; v += m.v || 0;
          if (m.k === 'slay') vCombat += m.v || 0; else vSkill += m.v || 0;
          for (const k in m.sk) gains[k] = (gains[k] || 0) + m.sk[k];
        });
        const qBy = questBy(plan), q = qBy.reduce((a, b) => a + b, 0);
        let changed = 0; plan.forEach(p => { if (p.opt !== curPlan[p.row].opt) changed++; });
        const total = t + sim.time + overhead;
        const levels = gainLv(gains) + q;
        let xp = 0; for (const k in gains) xp += gains[k];
        const forced = footLock ? sim.legs.filter(l => l.dist > thr0).length : 0;
        const teff = total + lam * sim.charges + FOOT_PEN * forced;
        return { sim, action: t, walk: sim.time, overhead, total, teff, levels, xp, q, qBy, charges: sim.charges, used: sim.used, changed, v, vSkill, vCombat, score: teff > 0 ? levels / teff * 3600 : 0 };
      };
      const kindVal = (kind, m) => kind === 'skill' ? (m.k === 'skill' ? m.v || 0 : 0) : kind === 'combat' ? (m.k === 'slay' ? m.v || 0 : 0) : QW * (m.v || 0);
      const headVal = kind => kind === 'skill' ? (hm.k === 'skill' ? hm.v || 0 : 0) : kind === 'combat' ? (hm.k === 'slay' ? hm.v || 0 : 0) : (hm.qv || 0) + QW * (hm.v || 0);
      // The value rate a path maximises: its own kind of value per effective second.
      const rateOf = (kind, plan, me) => {
        me = me || measure(plan);
        let V = headVal(kind);
        plan.forEach(p => { V += kindVal(kind, rows[p.row].opts[p.opt].m); });
        if (kind === 'quest') V += me.q;
        return me.teff > 0 ? V / me.teff : 0;
      };
      // Which options a path may use. Combat XP only comes from combat tasks and skilling XP only from skilling tasks, so a path does not fill its
      // rows with the other kind just because a short task of the other kind lowers the time and so raises the average per hour.
      const okFor = kind => {
        if (kind === 'quest') return null;
        const fits = m => (kind === 'combat' ? m.k === 'slay' : m.k !== 'slay') || !!(m && m.lucky);
        const has = rows.map(r => r.opts.some(o => fits(o.m)));
        return (i, k) => !has[i] || fits(rows[i].opts[k].m);
      };
      const withKeep = ok => (input.keepPicks ? (i, k) => k === curPlan[i].opt : ok);   // keep my picks: nothing else is allowed, whatever the path
      const forceOk = (plan, ok) => (!ok ? plan : plan.map(p => {
        if (ok(p.row, p.opt)) return p;
        let bk = -1, bv = -Infinity;
        rows[p.row].opts.forEach((o, k) => { if (!ok(p.row, k)) return; const v = (o.m.t > 0 ? (o.m.v || 0) / o.m.t : 0); if (v > bv) { bv = v; bk = k; } });
        return bk >= 0 ? { row: p.row, opt: bk } : p;
      }));

      // Flat option table + exact-search spec for one kind.
      const specFor = (kind, ok, A, delta) => {
        const flat = [], rowOf = [], optOf = [];
        rows.forEach((r, i) => r.opts.forEach((o, k) => { if (ok && !ok(i, k)) return; flat.push(o); rowOf.push(i); optOf.push(k); }));
        const G = flat.length;
        for (let i = 0; i < n; i++) if (!rowOf.includes(i)) return null;
        const D = new Float64Array(G * G), headD = new Float64Array(G), tAct = new Float64Array(G), kv = new Float64Array(G), optDiff = new Float64Array(G);
        const keys = flat.map(o => taskKey(o.node, o.m)), sameHead = new Uint8Array(G), same = new Uint8Array(G * G);
        for (let a = 0; a < G; a++) {
          sameHead[a] = keys[a] && keys[a] === headKey ? 1 : 0;
          for (let b = 0; b < G; b++) same[a * G + b] = keys[a] && keys[a] === keys[b] ? 1 : 0;
          headD[a] = dist(head, flat[a].node); tAct[a] = flat[a].m.t; kv[a] = kindVal(kind, flat[a].m); optDiff[a] = optOf[a] !== curPlan[rowOf[a]].opt ? 1 : 0;
          for (let b = 0; b < G; b++) D[a * G + b] = dist(flat[a].node, flat[b].node);
        }
        const S = { n, G, rowOf, optOf, tAct, kv, optDiff, headD, D, curPos: curPlan.map((_, i) => i), A, delta, speed, lam, tpOn, C: 0, thr: chargeThr, foot: footLock, thr0, Q: 1, cred: null, nxt: null, exact: true, ovh: TASK_OVERHEAD_S, sameHead, same };
        if (tpOn) S.C = chargeThr.length;
        // quest progress as part of the state (Quests path only)
        if (kind === 'quest') {
          const names = [];
          flat.forEach(o => (o.m.quest || []).forEach(cq => { const info = qi[cq.name]; if (info && (cq.exact || cq.current) && !names.includes(cq.name)) names.push(cq.name); }));
          const qs = names.map(nm => { const info = qi[nm], b0 = headStep[nm] != null ? headStep[nm] + 1 : info.current + 1; return { nm, b0, K: Math.max(0, Math.min(n, info.steps - b0 + 1)), share: (info.lv || 0) / Math.max(1, info.steps - info.current) }; }).filter(x => x.K > 0);
          qs.sort((a, b) => b.share * b.K - a.share * a.K);   // the quests worth most go into the state; the rest only count in the final scoring
          let Q = 1; const qk = [];
          qs.forEach(x => {
            if (Q * (x.K + 1) <= 256) { x.mult = Q; Q *= x.K + 1; qk.push(x); }
            else { S.exact = false; flat.forEach((o, g) => { if ((o.m.quest || []).some(cq => cq.name === x.nm && (cq.exact || cq.current))) S.kv[g] += x.share; }); }   // too many to follow in the state: counted per stop, order ignored
          });
          qs.length = 0; qk.forEach(x => qs.push(x));
          if (qs.length) {
            const cred = new Float64Array(G * Q), nxt = new Int32Array(G * Q);
            for (let g = 0; g < G; g++) {
              const stepsOf = qs.map(x => { const set = new Set(); (flat[g].m.quest || []).forEach(cq => { if (cq.name === x.nm && (cq.exact || cq.current)) set.add(cq.step); }); return set; });
              for (let s = 0; s < Q; s++) {
                let c = 0, nx = s;
                qs.forEach((x, j) => { const off = Math.floor(s / x.mult) % (x.K + 1); if (off < x.K && stepsOf[j].has(x.b0 + off)) { c += x.share; nx += x.mult; } });
                cred[g * Q + s] = c; nxt[g * Q + s] = nx;
              }
            }
            S.Q = Q; S.cred = cred; S.nxt = nxt;
          }
        }
        // keep the state space small enough for a page thread: drop the charge dimension (then the plan is polished on the exact numbers below)
        const states = () => (1 << n) * G * (S.C + 1) * S.Q;
        if (states() > 5e6 && S.Q > 1) { S.Q = 1; S.cred = null; S.nxt = null; S.exact = false; flat.forEach((o, g) => { S.kv[g] += o.m.qv || 0; }); }
        if (states() > 5e6 && S.C > 0) { S.C = 0; S.tpOn = false; S.exact = false; S.relaxTp = true; }
        return S;
      };
      const planOf = (S, r) => r.gs.map(g => ({ row: S.rowOf[g], opt: S.optOf[g] }));

      // Dinkelbach iteration on the exact search: the plan with the best value-per-time ratio.
      let evaluated = 0;
      const bestRatio = (kind, ok) => {
        let best = forceOk(curPlan, ok), me = measure(best), lamR = rateOf(kind, best, me);
        const delta = Math.max(1e-12, 1e-9 * lamR * me.teff);
        const S = specFor(kind, ok, lamR, delta);
        if (!S) return { plan: best, exact: true };
        const exact = S.exact;
        for (let it = 0; it < 40; it++) {
          S.A = lamR;
          const r = dpSolve(S); if (!r) break;
          evaluated += r.states;
          const plan = planOf(S, r), m2 = measure(plan), r2 = rateOf(kind, plan, m2);
          if (r2 > rateOf(kind, best) * (1 + 1e-12) + 1e-15) { best = plan; lamR = r2; } else break;
        }
        return { plan: best, exact };
      };

      // Stops at the same place cost no walking between them, so their order does not matter to the score. Put the bigger task first (fewer
      // redundant kills on the same mob), unless that would change the score (quest steps are credited in order).
      const tidy = plan => {
        const key = p => { const o = rows[p.row].opts[p.opt]; return o.node + '|' + (o.m && o.m.act); };
        const out = plan.slice(); let changed = false;
        for (let i = 0; i < out.length;) {
          let j = i + 1; while (j < out.length && key(out[j]) === key(out[i])) j++;
          if (j - i > 1) {
            const run = out.slice(i, j), srt = run.slice().sort((x, y) => (rows[y.row].opts[y.opt].m.t || 0) - (rows[x.row].opts[x.opt].m.t || 0) || x.row - y.row);
            if (srt.some((x, k) => x !== run[k])) { for (let k = 0; k < srt.length; k++) out[i + k] = srt[k]; changed = true; }
          }
          i = j;
        }
        return changed && measure(out).score >= measure(plan).score - 1e-9 ? out : plan;
      };
      const pack = (plan0, raw) => {
        const plan = raw ? plan0 : tidy(plan0);
        const d = describe(rows, head, plan, crystals, speed, curPlan);
        const m = measure(plan);
        const noTpWalk = simulate(head, nodesOf(rows, plan), [], speed, false).time;
        // Why each swapped pick is in the plan: the path with ONLY that swap undone, and what that option is worth on its own.
        const swaps = {};
        const sumXp = sk => { let t = 0; for (const k in sk) t += sk[k]; return t; };
        plan.forEach(pp => {
          const cp = curPlan[pp.row];
          if (pp.opt === cp.opt) return;
          const rev = plan.map(q => (q.row === pp.row ? { row: q.row, opt: cp.opt } : q));
          const mr = measure(rev);
          const on = rows[pp.row].opts[pp.opt].m, oo = rows[pp.row].opts[cp.opt].m;
          swaps[pp.row] = {
            from: cp.opt, to: pp.opt,
            dScore: mr.score > 0 ? m.score / mr.score - 1 : 0, dLevels: m.levels - mr.levels, dTotal: m.total - mr.total, dWalk: m.walk - mr.walk, dCharges: m.charges - mr.charges,
            newT: on.t, oldT: oo.t, newXp: sumXp(on.sk), oldXp: sumXp(oo.sk), newLv: on.v, oldLv: oo.v,
            newRate: on.t > 0 ? on.v / on.t * 3600 : 0, oldRate: oo.t > 0 ? oo.v / oo.t * 3600 : 0, newQuest: (on.qv || 0) > 0, oldQuest: (oo.qv || 0) > 0,
          };
        });
        return { plan, sig: d.sig, moved: d.moved, changed: d.changed, m, tpSaved: Math.max(0, noTpWalk - m.walk), withTp: m.sim, noTp: m.sim, qBy: m.qBy, swaps, ids: plan.map(p => P.ids[p.row] + '=' + rows[p.row].opts[p.opt].node) };
      };

      // ---- Stability: a change is only suggested when it clears a threshold, measured against the queue AND against the previous suggestion ----
      const stab = Object.assign({ rel: 0.02, abs: 60, perSwap: 0.03, drift: 2, cross: 0.3 }, input.stab || {});
      const inc = input.inc || null;
      const fpNow = input.fp || {}, fpOld = inc && inc.fp ? inc.fp : null;
      const reasons = fpOld ? Object.keys(fpNow).filter(k => fpNow[k] !== fpOld[k]).concat(Object.keys(fpOld).filter(k => !(k in fpNow))) : [];
      const mult = !fpOld || reasons.length ? 1 : stab.drift;   // nothing changed but the clock: be twice as hard to move
      const swapsOf = (a, b) => { const bo = {}; b.forEach(p => { bo[p.row] = p.opt; }); let s = 0; a.forEach(p => { if (bo[p.row] !== p.opt) s++; }); return s; };
      // does y deserve to replace x? (relative gain, and the same levels reached this many seconds sooner)
      // mm scales the margin: `mult` when the clock alone moved (a switch has to be twice as clear), 0.5 for a plan that is already on show (it stays
      // until it falls clearly below the margin it needed to appear: a Schmitt trigger, so a gain hovering at the margin cannot flicker the badge)
      const clears = (mx, my, sw, mm) => my.score >= mx.score * (1 + (stab.rel + stab.perSwap * sw) * mm) && mx.teff * (1 - mx.score / Math.max(my.score, 1e-12)) >= stab.abs * mm;
      // the previous suggestion, mapped onto today's queue: finished rows drop out, rows it has never seen go where they fit best
      const adapt = (kind, ok) => {
        const arr = inc && inc[kind]; if (!arr || !arr.length) return null;
        const at = {}; P.ids.forEach((id, i) => { at[id] = i; });
        let plan = []; const used = new Set();
        arr.forEach(e => {
          const r = at[e.id]; if (r == null || used.has(r)) return; used.add(r);
          let k = rows[r].opts.findIndex(o => o.node === e.node);
          if (k < 0 || (ok && !ok(r, k))) k = curPlan[r].opt;
          plan.push({ row: r, opt: k });
        });
        if (!plan.length) return null;
        for (let r = 0; r < n; r++) {
          if (used.has(r)) continue;
          let bp = null, bs = -Infinity;
          for (let pos = 0; pos <= plan.length; pos++) { const p = plan.slice(); p.splice(pos, 0, { row: r, opt: curPlan[r].opt }); const s = measure(p).score; if (s > bs + 1e-12) { bs = s; bp = p; } }
          plan = bp;
        }
        return plan;
      };

      const curM = measure(curPlan);
      const out = { available: true, tpOn, lam, nTasks: n, objective, refSpan: REF, cur: pack(curPlan, true), exact: true, reasons, steady: !!fpOld && !reasons.length, info: {}, incNext: { shown: {} } };
      const hasQuest = rows.some(r => r.opts.some(o => (o.m.qv || 0) > 0)) || (hm.qv || 0) > 0;
      const ids0 = curPlan.map(p => ({ id: P.ids[p.row], node: rows[p.row].opts[p.opt].node }));
      // Which path are you FOLLOWING? The one whose suggested plan your queue has just become. Paths have different aims (skill levels, combat, quests), so the
      // best one by score is not the same as the one you chose: once you have followed the quest path, the skill path looks better again, you follow that, and
      // the quest path looks better again, forever. A path you follow is kept: the other paths only speak up when they would gain a lot (stab.cross) over it.
      let followed = inc && inc.followed || null;
      if (inc && inc.shown) for (const kk of ['skill', 'combat', 'quest']) { if (!inc.shown[kk]) continue; const ipk = adapt(kk, withKeep(okFor(kk))); if (ipk && swapsOf(curPlan, ipk) === 0) { followed = kk; break; } }
      out.followed = followed;
      for (const kind of ['skill', 'combat', 'quest']) {
        const hasKind = kind === 'quest' ? hasQuest : rows.some((r, i) => r.opts.some((o, k) => (!input.keepPicks || k === curPlan[i].opt) && kindVal(kind, o.m) > 0));
        out[kind] = null; out.incNext[kind] = ids0;
        out.incNext.followed = followed;
        if (hasKind) {
          const ok = withKeep(okFor(kind));
          const bro = bestRatio(kind, ok);
          if (!bro.exact) out.exact = false;
          let cand = bro.plan, candM = measure(cand);
          const ip = adapt(kind, ok);
          let fin = cand, finM = candM, kept = false, why = [], imx = null;
          if (ip) {
            imx = measure(ip);
            if (!clears(imx, candM, swapsOf(ip, cand), mult)) { fin = ip; finM = imx; kept = sigOf(ip) !== sigOf(cand); }
            else if (reasons.length) why = reasons;
          } else if (reasons.length) why = reasons;
          const hold = fin === ip && !!(inc.shown && inc.shown[kind]);
          let show = clears(curM, finM, swapsOf(curPlan, fin), hold ? 0.5 : 1);
          if (show && followed && kind !== followed && !(finM.score >= curM.score * (1 + stab.cross))) show = false;   // another path than the one you follow: only for a big gain
          out.info[kind] = { optSig: sigOf(cand), optScore: candM.score, incSig: ip ? sigOf(ip) : null, incScore: imx ? imx.score : null, finSig: sigOf(fin), finScore: finM.score, curScore: curM.score, kept, shown: show, gain: curM.score > 0 ? finM.score / curM.score - 1 : 0, reasons: why };
          out.incNext.shown[kind] = show;
          if (show) { out[kind] = pack(fin); out.incNext[kind] = out[kind].plan.map(p => ({ id: P.ids[p.row], node: rows[p.row].opts[p.opt].node })); }
          else out[kind + 'Floor'] = true;
        }
        yield 'path';
      }
      let bk = null;
      ['skill', 'combat', 'quest'].forEach(k => { if (out[k] && (!bk || out[k].m.score > out[bk].m.score)) bk = k; });
      // sticky: the path that was best last time stays best unless another is clearly better
      if (inc && inc.best && bk && inc.best !== bk && out[inc.best] && out[bk].m.score < out[inc.best].m.score * (1 + stab.rel * mult)) bk = inc.best;
      out.best = bk; out.evaluated = evaluated;
      // for the self-check
      if (input.keepCtx) out._ctx = { measure, rateOf, questBy, okFor: k => withKeep(okFor(k)), kindVal, headVal, specFor, dpSolve, planOf, curM };
      return out;
    }

    // rows: [{id, opts:[{node, selected, m}]}] (row 1..n); head: current task node; crystals: [{tier, charges}] in list order; speed: steps/sec.
    // A generator: it yields between its heavy steps so the caller can run it in short slices (keeps the game smooth) and show a progress bar.
    // optimize() below runs it to completion for tests/sync use.
    function* optimizeGen(input) {
      const P = prep(input);
      if (!P) return null;
      const { rows, head, crystals, speed, curPlan, thr0, chargeThr, n } = P;
      const footMode = input.tpMode === 'foot' && thr0 != null;
      const stab = Object.assign({ walkAbs: 30 }, input.stab || {});
      // plain walking-time searches (no task values): min walking time over order (and picks), with the game's teleport rule
      const walkBest = (ok, tp, foot) => {
        const flat = [], rowOf = [], optOf = [];
        rows.forEach((r, i) => r.opts.forEach((o, k) => { if (ok && !ok(i, k)) return; flat.push(o); rowOf.push(i); optOf.push(k); }));
        const G = flat.length;
        const D = new Float64Array(G * G), headD = new Float64Array(G), z = new Float64Array(G), optDiff = new Float64Array(G);
        for (let a = 0; a < G; a++) { headD[a] = dist(head, flat[a].node); optDiff[a] = optOf[a] !== curPlan[rowOf[a]].opt ? 1 : 0; for (let b = 0; b < G; b++) D[a * G + b] = dist(flat[a].node, flat[b].node); }
        const S = { n, G, rowOf, optOf, tAct: z, kv: z, optDiff, headD, D, curPos: curPlan.map((_, i) => i), A: 1, delta: 1e-7, speed, lam: 1e-3, tpOn: tp && thr0 != null, C: tp && thr0 != null ? chargeThr.length : 0, thr: chargeThr, foot: foot && thr0 != null, thr0, Q: 1, cred: null, nxt: null };
        const r = dpSolve(S);
        return r ? { plan: r.gs.map(g => ({ row: rowOf[g], opt: optOf[g] })), states: r.states } : null;
      };
      const keepOk = (i, k) => k === curPlan[i].opt;
      const current = describe(rows, head, curPlan, crystals, speed, curPlan);
      let evaluated = 0;
      const run = (ok, tp, foot) => { const r = walkBest(ok, tp, foot); if (!r) return null; evaluated += r.states; return describe(rows, head, r.plan, crystals, speed, curPlan); };
      const worth = (c, base, field) => (c && base[field].time - c[field].time >= stab.walkAbs ? c : base);
      let rec = run(keepOk, true, false) || current;
      rec = worth(rec, current, 'withTp');
      yield 0.15;
      let bestNoTp = run(keepOk, false, footMode) || current;
      const forced = c => (footMode ? c.noTp.legs.filter(l => l.dist > thr0).length : 0);
      if ((current.noTp.time + FOOT_PEN * forced(current)) - (bestNoTp.noTp.time + FOOT_PEN * forced(bestNoTp)) < stab.walkAbs) bestNoTp = current;
      yield 0.25;
      let bestAll = run(null, true, false) || current;
      bestAll = worth(bestAll, current, 'withTp');
      yield 0.35;
      const paths = yield* buildPaths(P);
      const result = { rows, head, crystals: input.crystals || [], speed, current, rec, bestAll, bestNoTp, pickOnly: null, fewestCharges: null, paths, evaluated: evaluated + (paths && paths.evaluated || 0), exact: !paths || paths.exact !== false, ids: P.ids };
      if (paths && !input.keepCtx) delete paths._ctx;
      return result;
    }

    function optimize(input) { const g = optimizeGen(input); let r; do { r = g.next(); } while (!r.done); return r.value; }

    // ---- Self-check: proves on a given input that the search is exact, repeatable, order-independent and stable --------------------------------
    // returns { ok, checks: [{name, ok, detail}] }. maxBrute = largest queue that is also checked against trying every single plan.
    function selfCheck(input, maxBrute) {
      const checks = [], add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || '' });
      const clone = o => JSON.parse(JSON.stringify(o));
      const KINDS = ['skill', 'combat', 'quest'];
      const base = clone(input); base.inc = null; delete base.keepCtx;
      const fp = r => JSON.stringify(r && r.paths && r.paths.available ? KINDS.map(k => r.paths[k] && r.paths[k].sig).concat([r.paths.best, r.rec.sig]) : [r && r.rec && r.rec.sig]);
      const a = optimize(clone(base)), b2 = optimize(clone(base));
      add('determinism: the same input twice gives the same plans', fp(a) === fp(b2), fp(a));
      if (!a) return { ok: false, checks };
      const queueOf = (src, r, plan) => { const x = clone(src); x.rows = plan.map((p, i) => ({ id: i + 1, opts: r.rows[p.row].opts.map((o, k) => ({ node: o.node, selected: k === p.opt, label: o.label, idx: o.idx, m: o.m ? clone(o.m) : undefined })) })); return x; };
      const P = a.paths;
      if (P && P.available) {
        KINDS.forEach(k => {
          if (!P[k]) return;
          const r2 = optimize(queueOf(base, a, P[k].plan));
          add('idempotence (' + k + '): after following it nothing more is suggested', r2 && r2.paths && !r2.paths[k], r2 && r2.paths && r2.paths[k] ? 'next: ' + r2.paths[k].sig : '');
        });
      }
      // exactness against trying every plan, with the thresholds switched off so the raw optimum shows
      const ZERO = { rel: 0, abs: 0, perSwap: 0, drift: 1, walkAbs: 0 };
      const ex = optimize(Object.assign(clone(base), { stab: ZERO, keepCtx: true }));
      const n = ex.rows.length, lim = maxBrute == null ? 5 : maxBrute;
      if (ex.paths && ex.paths.available) {
        const rev = clone(base); rev.rows = rev.rows.slice().reverse(); rev.rows.forEach((r, i) => { r.id = i + 1; });
        const rx = optimize(Object.assign(rev, { stab: ZERO, keepCtx: true }));
        const rate = (r, k) => { const inf = r.paths.info[k]; return inf ? r.paths._ctx.rateOf(k, inf.optSig.split(',').map(x => { const [rw, oo] = x.split(':').map(Number); return { row: rw, opt: oo }; })) : 0; };
        const diffs = KINDS.map(k => Math.abs(rate(rx, k) - rate(ex, k)) / Math.max(1e-12, rate(ex, k)));
        add('order invariance: the same rows in reverse order reach the same optimum', Math.max(...diffs) <= 1e-9, 'worst relative difference ' + Math.max(...diffs).toExponential(2));
      }
      const perms = (m, f) => { const used = new Array(m).fill(false), cur = []; (function rec() { if (cur.length === m) { f(cur); return; } for (let i = 0; i < m; i++) if (!used[i]) { used[i] = true; cur.push(i); rec(); cur.pop(); used[i] = false; } })(); };
      if (n <= Math.max(lim, 7)) {
        let bestT = Infinity;
        perms(n, o => { const t = simulate(ex.head, o.map(i => ex.current.plan.find(p => p.row === i)).map(p => ex.rows[p.row].opts[p.opt].node), ex.crystals, ex.speed, true).time; if (t < bestT) bestT = t; });
        add('walking order is the true minimum (all ' + n + '! orders tried)', ex.rec.withTp.time <= bestT + 1e-6, 'search ' + ex.rec.withTp.time.toFixed(3) + ' s, best of all ' + bestT.toFixed(3) + ' s');
      }
      if (ex.paths && ex.paths.available && ex.paths._ctx && n <= lim) {
        const C = ex.paths._ctx;
        KINDS.forEach(k => {
          const info = ex.paths.info[k]; if (!info) return;
          const ok = C.okFor(k); let bestR = -Infinity, cnt = 0;
          perms(n, o => {
            const choose = (i, plan) => {
              if (i === n) { cnt++; const r = C.rateOf(k, plan); if (r > bestR) bestR = r; return; }
              ex.rows[o[i]].opts.forEach((_, kk) => { if (!ok || ok(o[i], kk)) { plan.push({ row: o[i], opt: kk }); choose(i + 1, plan); plan.pop(); } });
            };
            choose(0, []);
          });
          const dpPlan = info.optSig.split(',').map(x => { const [r, oo] = x.split(':').map(Number); return { row: r, opt: oo }; });
          const rd = C.rateOf(k, dpPlan);
          add('path ' + k + ' is the true optimum (all ' + cnt + ' plans tried)', rd >= bestR * (1 - 1e-9) - 1e-15, 'search ' + rd.toFixed(8) + ', best of all ' + bestR.toFixed(8));
        });
      }
      return { ok: checks.every(c => c.ok), checks };
    }

    return { setData, node, dist, simulate, optimize, optimizeGen, selfCheck, rowIds, THRESH, TASK_OVERHEAD_S };
  }
  //#core-end

  if (typeof module !== 'undefined' && module.exports) { module.exports = { createCore, polyLen, THRESH, MAX_ROWS }; return; }

  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const life = window.__ccLife.scope('route-advisor');   // page listeners and timers go through it: a re-inject cannot leave a second copy

  // ---------------------------------------------------------------------
  // Everything below needs the browser.
  // ---------------------------------------------------------------------
  const core = createCore();   // the page's own copy: node lookups for drawing, and the in-page solver when the worker is off

  // ---- Solver: runs core.optimizeGen on a background thread (Web Worker built from this file's own core code) so route searches never block the game's frames.
  // If the worker cannot start (or a result cannot be passed back) the same generator runs in the page in 10 ms slices, exactly as before.
  //   const job = solver.run(input, onProgress);  job.done -> Promise<result>;  job.cancel()
  const WORKER_MAIN = `
let core = createCore(), cur = 0;
onmessage = (e) => {
  const m = e.data;
  if (m.t === 'data') core.setData(m.nodes, new Map(m.lens));
  else if (m.t === 'cancel') { if (cur === m.id) cur = 0; }
  else if (m.t === 'run') { cur = m.id; let gen; try { gen = core.optimizeGen(m.input); } catch (err) { cur = 0; postMessage({ t: 'err', id: m.id, msg: String(err && err.message || err) }); return; } slice(m.id, gen); }
};
function slice(id, gen) {
  if (cur !== id) return;
  let r, p = -1; const end = Date.now() + 25;
  try { do { r = gen.next(); if (!r.done && typeof r.value === 'number') p = r.value; } while (!r.done && Date.now() < end); }
  catch (err) { cur = 0; postMessage({ t: 'err', id, msg: String(err && err.message || err) }); return; }
  if (!r.done) { if (p >= 0) postMessage({ t: 'prog', id, p }); setTimeout(() => slice(id, gen), 0); return; }   // the timeout lets a cancel message in between slices
  cur = 0;
  try { postMessage({ t: 'done', id, result: r.value }); } catch (err) { postMessage({ t: 'err', id, msg: 'result not transferable: ' + String(err && err.message || err) }); }
}
postMessage({ t: 'ready' });`;
  const solver = (() => {
    let w = null, dead = false, seq = 0, dataMsg = null; const jobs = new Map();
    const onThread = () => !!settingOn('routeWorker', true) && !dead && typeof Worker === 'function';
    function fail(id, err) { const j = jobs.get(id); if (j) { jobs.delete(id); j.reject(err); } }
    function spawn() {
      if (w) return w;
      try {
        const src = '"use strict";const THRESH=' + JSON.stringify(THRESH) + ';const MAX_ROWS=' + MAX_ROWS + ';' + polyLen.toString() + ';' + createCore.toString() + ';' + WORKER_MAIN;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        w = new Worker(url);
        w.onmessage = (e) => {
          const m = e.data;
          if (m.t === 'ready') { URL.revokeObjectURL(url); return; }
          const j = jobs.get(m.id); if (!j) return;
          if (m.t === 'prog') { if (j.onProg) j.onProg(m.p); } else if (m.t === 'done') { jobs.delete(m.id); j.resolve(m.result); } else if (m.t === 'err') { jobs.delete(m.id); j.reject(new Error(m.msg)); }
        };
        w.onerror = () => { dead = true; try { w.terminate(); } catch (e) { /* gone */ } w = null; Array.from(jobs.keys()).forEach((id) => fail(id, new Error('route worker failed'))); };
        if (dataMsg) w.postMessage(dataMsg);
      } catch (e) { dead = true; w = null; }
      return w;
    }
    function inPage(input, onProg) {
      let live = true, timer = 0, gen;
      const done = new Promise((resolve, reject) => {
        try { gen = core.optimizeGen(input); } catch (e) { reject(e); return; }
        const step = () => {
          if (!live) return; let r;
          try { const end = performance.now() + 10; do { r = gen.next(); if (!r.done && typeof r.value === 'number' && onProg) onProg(r.value); } while (!r.done && performance.now() < end); } catch (e) { reject(e); return; }
          if (!r.done) { timer = setTimeout(step, 6); return; }
          resolve(r.value);
        };
        step();
      });
      return { done, cancel: () => { live = false; clearTimeout(timer); } };
    }
    function run(input, onProg) {
      if (onThread() && spawn()) {
        const id = ++seq;
        const done = new Promise((resolve, reject) => { jobs.set(id, { resolve, reject, onProg }); });
        try { w.postMessage({ t: 'run', id, input }); }
        catch (e) { jobs.delete(id); dead = true; return inPage(input, onProg); }   // the input could not be copied: solve it here
        const job = { done, cancel: () => { if (jobs.delete(id) && w) w.postMessage({ t: 'cancel', id }); } };
        // a worker that dies or cannot return its result falls back to the page once, so the user still gets an answer
        job.done = done.catch((err) => { if (!dead && !/worker failed/.test(String(err && err.message))) throw err; dead = true; const f = inPage(input, onProg); job.cancel = f.cancel; return f.done; });
        return job;
      }
      return inPage(input, onProg);
    }
    function setData(nodes, lens) {
      dataMsg = { t: 'data', nodes, lens: Array.from(lens) };
      if (w) w.postMessage(dataMsg);
    }
    function dispose() { jobs.clear(); if (w) { try { w.terminate(); } catch (e) { /* gone */ } w = null; } }
    return { run, setData, dispose, get threaded() { return !!w; } };
  })();
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
      core.setData(nodes, lens); solver.setData(nodes, lens);
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
  // Walking speed in steps per second: the bridge's single source (potions included). 0 without the bridge; the model then falls back to 15.
  function readSpeed() { try { const s = window.__ccBridge && window.__ccBridge.speed ? window.__ccBridge.speed() : null; return s ? s.sps : 0; } catch (e) { return 0; } }
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
  // The queue as the game really has it (from the game data bridge). The game's own queue panel is not redrawn while it is hidden, so reading its rows
  // could show a task that has already finished as the current one and miss the real one: the advisor then planned with the wrong queue.
  function readQueue() {
    try {
      if (settingOn('gameBridgeEnabled', true) && window.__ccBridge && window.__ccBridge.ok && window.__ccBridge.ok()) {
        const p = window.__ccBridge.project();
        if (p && p.head && Array.isArray(p.slots) && p.slots.length) {
          const nice = s => String(s || '').replace(/_/g, ' ').replace(/\w/g, m => m.toUpperCase());
          const lbl = o => nice(o.act) + (o.qty ? ' ×' + o.qty : '');
          return { head: p.head.node, headLabel: lbl(p.head), rows: p.slots.map((s, i) => ({ id: i + 1, rowEl: null, slot: s.index, opts: s.options.map((o, k) => ({ node: o.node, selected: k === s.selected, label: lbl(o), el: null, oidx: k })) })) };
        }
      }
    } catch (e) { /* fall back to the game's panel */ }
    return readQueueDom();
  }
  function readQueueDom() {
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
  const PRIO_DEFAULT = { vigor: 2, smith: 1.6, mine: 1.6, cook: 1.4, slay: 1.2, fish: 1.1, brew: 1.1, farm: 1, forage: 1, craft: 1, invoke: 1, imbue: 1, plunder: 1, barter: 0.8, bard: 0.8, discover: 0.8, alms: 0.8, luck: 0.7, delve: 0.5, fortify: 0.5 };
  // gathering skills (they produce the materials) against processing skills (they turn materials into gear, food and potions): see Settings > Route Advisor > Gathering vs Processing
  const GATHER_SK = ['mine', 'fish', 'forage', 'farm', 'invoke'];
  const gatherRatio = () => { try { const v = Number(window.__ccPluginSettings.get('routeGatherRatio')); return Number.isFinite(v) && v > 0 ? Math.min(5, Math.max(0.1, v)) : 1; } catch (e) { return 1; } };
  let calc = null, calcRun = 0; // calc: {p} while an optimisation is running
  const SETTLE_MS = 1700;
  let pendSig = '', pendAt = 0, settling = false;
  let result = null, lastSig = '', computeTimer = null, selectedKey = 'auto', rowsRef = [], mapOpen = false, stepsOpen = false, xpTbl = null;
  try { mapOpen = localStorage.getItem('cc-route-map-open') === '1'; } catch (e) {}
  // Remembered forever (localStorage): do you plan with teleports or on foot? The headline, the alert triangle and
  // the notification all follow it; teleports are only pushed on you when they save a LOT per charge used.
  // tpPref: 'foot' (no teleports), 'eff' (teleport only when it pays, default), 'max' (use charges freely).
  let tpPref = 'eff';
  try { const v = localStorage.getItem('cc-route-tp-pref'); tpPref = v === 'notp' || v === 'foot' ? 'foot' : v === 'max' ? 'max' : 'eff'; if (tpPref === 'max' && !(window.__ccPluginSettings && window.__ccPluginSettings.get('routeShowMaxTp'))) tpPref = 'eff'; } catch (e) {}   // Max only when it has been switched on in Settings
  let keepPicks = false;
  try { keepPicks = localStorage.getItem('cc-route-keep') === '1'; } catch (e) {}
  const prefKey = () => (tpPref === 'foot' ? 'noTp' : 'withTp');
  const prefPlan = () => (tpPref === 'foot' && result.bestNoTp ? result.bestNoTp : result.rec);
  // Time the badge / header claims you can save. With the path comparison it comes from the best plan that passed the safety floor
  // (never a plan worse than your queue for the chosen objective); 0 when nothing beats your queue.
  const prefSaved = () => {
    const P = result.paths;
    if (P && P.available) { const bk = bestPathKey(); { const real = (m) => (m.total > 0 ? m.levels / m.total : 0), rc = real(P.cur.m), rb = bk ? real(P[bk].m) : 0;   // levels per REAL second: the search's score also holds penalties (walking forced on foot, charges) that are no time at all
      return rb > 0 ? Math.max(0, Math.min(P.cur.m.total, P.cur.m.total * (1 - rc / rb))) : 0; } }   // the same progress reached this much sooner: a share of the queue's REAL time (not of the search's penalised time, which holds a 30 hour walking penalty) and never more than the queue itself
    return result.current[prefKey()].time - prefPlan()[prefKey()].time;
  };
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

  // ---- "what if" table: the best route for each objective under every combination of Keep mine / Optimise and Teleports off / on.
  // Teleports are judged on the TOTAL steps they save over the whole queue (Settings: worth-it threshold), not per charge.
  const VARS = [{ key: 'KF', k: true, t: false, ic: '🔒\🚶', name: 'Keep mine, no teleports' }, { key: 'KT', k: true, t: true, ic: '🔒\u26A1', name: 'Keep mine, with teleports' },
    { key: 'OF', k: false, t: false, ic: '\🔀\🚶', name: 'Optimise picks, no teleports' }, { key: 'OT', k: false, t: true, ic: '\🔀\u26A1', name: 'Optimise picks, with teleports' }];
  const OBJS = [{ key: 'skill', label: 'Skilling', ic: '\u26CF', col: '#5fe06d' }, { key: 'combat', label: 'Combat', ic: '\u2694', col: '#ff7a7a' }, { key: 'quest', label: 'Quests', ic: '\📜', col: '#6fb6ff' }];
  let variantsFull = {}, variantsSig = '';
  const tpAggSteps = () => Math.max(0, Number(settingOn('routeTpSteps', 20000)) || 0);
  const tpEachSteps = () => Math.max(0, Number(settingOn('routeTpMinEach', 6000)) || 0);   // what ONE charge must save (steps)
  const gateState = {};   // per keep/optimise: was the teleport gate blocking last time
  let varJob = null, mainJob = null;   // the running jobs, cancelled when a newer calculation starts
  function runVariants(baseInput, run) {
    const jobs = VARS.slice(), out = {};
    const liberal = Math.min(tpAggSteps() || tpEachSteps(), tpEachSteps());
    const next = () => {
      if (run !== calcRun) return;
      const v = jobs.shift();
      if (!v) { variantsFull = out; applyGate(); noteGate(); render(); return; }
      const inp = Object.assign({}, baseInput, { keepPicks: v.k, tpMode: v.t ? 'eff' : 'foot', tpSteps: v.t ? liberal : 0, inc: null });   // the teleport column is always the Efficient mode
      inp.inc = incs[modeKey(inp)] || null;
      const job = solver.run(inp); varJob = job;
      job.done.then((res) => { if (run !== calcRun) return; out[v.key] = res; rememberPaths(inp, res, baseInput.fp); next(); }, () => { if (run !== calcRun) return; out[v.key] = null; next(); });
    };
    next();
  }
  // Teleports only count when they save enough steps over the whole route; otherwise the on-foot plan is shown.
  function applyGate() {
    if (!result) return;
    result.gate = null;
    if (tpPref === 'foot' || !result.paths || !result.paths.available) return;
    const off = variantsFull[(keepPicks ? 'K' : 'O') + 'F'], pk = bestPathKey();
    if (!off || !off.paths || !off.paths.available || !pk) return;
    const a = off.paths[pk] && off.paths[pk].m, b = result.paths[pk] && result.paths[pk].m;
    if (!a || !b) return;
    const saved = Math.max(0, a.walk - b.walk) * (result.speed || 0), th = tpAggSteps();
    result.gate = { saved, th };
    // hysteresis: a gate that is blocked opens only 15% above the bar, an open one closes only 15% below it, so a saving hovering at the bar cannot flip the plan
    const gk = (keepPicks ? 'K' : 'O'), wasBlocked = gateState[gk] === true;
    const blocked = (b.charges || 0) > 0 && (wasBlocked ? saved < th * 1.15 : saved < th * 0.85);
    gateState[gk] = blocked;
    if (blocked) { const q = result.q, ms = result.ms; result = off; result.q = q; result.ms = ms; result.gate = { saved, th, blocked: true }; }
  }
  const vPct = (x) => (x >= 0 ? '+' : '\u2212') + Math.abs(x * 100).toFixed(1) + '%';
  function cellInfo(vk, ok) {
    const v = variantsFull[vk], cur = result && result.paths && result.paths.cur && result.paths.cur.m;
    if (!v || !v.paths || !v.paths.available || !cur) return null;
    const m = v.paths[ok] && v.paths[ok].m; if (!m) return { none: true };
    return { dScore: cur.score > 0 ? m.score / cur.score - 1 : 0, dWalk: m.walk - cur.walk, dTotal: m.total - cur.total, walk: m.walk, curWalk: cur.walk, total: m.total, curTotal: cur.total, charges: m.charges || 0, changed: m.changed || 0 };
  }
  // Click a cell: use exactly that combination (objective path, keep/optimise picks, teleports off / Efficient).
  function chooseVariant(vk, ok) {
    const v = VARS.find((x) => x.key === vk); if (!v) return;
    keepPicks = v.k; try { localStorage.setItem('cc-route-keep', v.k ? '1' : '0'); } catch (e) {}
    tpPref = v.t ? 'eff' : 'foot'; try { localStorage.setItem('cc-route-tp-pref', tpPref); } catch (e) {}
    selectedKey = ok; try { localStorage.setItem('cc-route-sel', ok); } catch (e) {}
    lastSig = ''; hideVTip(); userOpen = true; scheduleCompute(); render();   // also opens the Route Advisor, so you see the plan you just chose
  }
  function variantTable(onCell) {
    const wrap = h('div', 'rt-vt');
    const t = h('table'); const hr = h('tr'); hr.appendChild(h('th', null, ''));
    VARS.forEach((v) => { const th = h('th', null, v.ic); th.title = v.name; hr.appendChild(th); });
    t.appendChild(hr);
    const det = h('div', 'rt-vdet', 'Hover a value for the details.');
    OBJS.forEach((o) => {
      const tr = h('tr'); const lab = h('td', 'rl', o.ic + ' ' + o.label); lab.style.color = o.col; tr.appendChild(lab);
      VARS.forEach((v) => {
        const ci = cellInfo(v.key, o.key), td = h('td', 'c');
        if (!ci) td.textContent = '\u2026';
        else if (ci.none) { td.textContent = '±0'; td.className = 'c z'; td.title = 'Nothing beats your current queue here'; }
        else {
          const g = ci.dScore > 0.0005, line = (g ? vPct(ci.dScore) : '\u00b10') + (ci.dWalk <= -30 ? ' \u00b7 ' + fmtT(-ci.dWalk) : '');
          td.textContent = line; td.className = 'c ' + (g ? 'g' : 'z');
          if (v.key === (keepPicks ? 'K' : 'O') + (tpPref === 'foot' ? 'F' : 'T') && o.key === (bestPathKey() || '')) td.classList.add('cur');
          td.style.cursor = 'pointer'; td.title = 'Click to use this: ' + o.label + ', ' + v.name;
          td.addEventListener('click', (e) => { e.stopPropagation(); chooseVariant(v.key, o.key); });
          td.addEventListener('mouseenter', () => {
            det.textContent = '';
            det.appendChild(h('b', null, o.label + ' \u00b7 ' + v.name + ': '));
            det.appendChild(document.createTextNode((g ? vPct(ci.dScore) + ' levels per hour' : 'no gain over your queue') + '. Walking ' + fmtT(ci.curWalk) + ' \u2192 ' + fmtT(ci.walk) + (ci.dWalk <= -1 ? ' (saves ' + fmtT(-ci.dWalk) + ')' : '') + '. Whole queue ' + fmtT(ci.curTotal) + ' \u2192 ' + fmtT(ci.total) + (v.t ? '. Teleport charges used: ' + ci.charges : '') + (!v.k && ci.changed ? '. Swaps ' + ci.changed + ' pick' + (ci.changed === 1 ? '' : 's') : '') + '.'));
          });
        }
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    wrap.appendChild(t); wrap.appendChild(det);
    return wrap;
  }
  let vtipEl = null;
  function hideVTip() { vtipEl = null; document.querySelectorAll('#cc-route-vtip').forEach((e) => e.remove()); }   // every copy, including ones left by an older load
  hideVTip();
  function showVTip(anchor) {
    hideVTip();
    if (!result || !Object.keys(variantsFull).length) return;
    vtipEl = h('div', 'rt-vtip'); vtipEl.id = 'cc-route-vtip';
    vtipEl.appendChild(h('div', 'rt-vh', 'Best route for each choice'));
    vtipEl.appendChild(variantTable());
    vtipEl.appendChild(h('div', 'rt-vleg', '🔒 keep my picks \u00b7 \🔀 optimise picks \u00b7 \🚶 no teleports \u00b7 \u26A1 teleports. Value = levels per hour, then walking saved.'));
    document.body.appendChild(vtipEl);
    const r = anchor.getBoundingClientRect(), tr = vtipEl.getBoundingClientRect(), sc = window.__ccScale || 1;
    vtipEl.style.left = Math.max(4, Math.min(innerWidth - tr.width - 4, r.left)) + 'px';
    vtipEl.style.top = Math.max(4, r.top - tr.height - 6) + 'px';
    if (parseFloat(vtipEl.style.top) < 4 || r.top - tr.height - 8 < 4) vtipEl.style.top = (r.bottom + 8) + 'px';
  }
  // The badge is rebuilt every few hundred ms, so a mouseleave on it never fires: decide from where the pointer is instead.
  let vtOut = 0;
  const vtOver = (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    const tri = t && t.closest('#cc-route-alert .tri');
    if (tri) { vtOut = 0; if (!vtipEl) showVTip(tri); return; }
    if (!vtipEl) return;
    if (t && (t.closest('#cc-route-vtip') || t.closest('#cc-route-alert'))) { vtOut = 0; return; }
    if (!vtOut) vtOut = performance.now();                  // give the pointer a moment to cross the gap to the tooltip
    else if (performance.now() - vtOut > 350) { vtOut = 0; hideVTip(); }
  };
  // Safety net: whatever the events did, the tooltip never outlives the pointer being over the badge or over the tooltip itself.
  life.every(150, () => { if (!document.querySelector('#cc-route-vtip')) return; if (document.querySelector('#cc-route-vtip:hover') || document.querySelector('#cc-route-alert:hover')) { vtOut = 0; return; } if (!vtOut) vtOut = performance.now(); else if (performance.now() - vtOut > 700) { vtOut = 0; hideVTip(); } });
  life.on(document, 'mouseover', vtOver, true);
  life.on(document, 'mousemove', vtOver, true);
  life.on(window, 'blur', () => hideVTip());
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
    const questValue = bo => (bo.quest || []).filter(c => c.current).reduce((sum, c) => {
      const qq = bridge.quests && bridge.quests[c.name];
      return qq ? sum + qq.xp / Math.max(1, qq.steps - qq.current) : sum;
    }, 0);
    // Per-skill XP of an option, and what it is worth in LEVELS (xp / the XP its skill's next level costs).
    const skMap = bo => {
      const sk = {};
      if (bo.combat) { const cb = bo.combat, add = (k, v) => { if (k && v > 0) sk[k] = (sk[k] || 0) + v; }; add('slay', cb.slay); add('spirit', cb.spirit); add(cb.chosenSkill, cb.chosen); add('life', cb.life); add(cb.secSkill, cb.sec); }
      else if (bo.skill) sk[bo.skill] = bo.totalXp;   // the bridge's XP already includes the skill's bonus
      // Lucky tasks also pay Luck XP equal to the (doubled) skill XP; slay: slay XP + the chosen combat skill's XP.
      if (bo.lucky) { const l = bo.combat ? (bo.combat.slay || 0) + (bo.combat.chosen || 0) : sk[bo.skill] || 0; if (l > 0) sk.luck = (sk.luck || 0) + l; }
      return sk;
    };
    const spanOf = k => { const L = bridge && bridge.skills && bridge.skills[k]; if (!L || !xpTbl) return 0; const a = xpTbl[L.level], b = xpTbl[L.level + 1]; return a != null && b != null && b > a ? b - a : 0; };
    const lvVal = sk => Object.keys(sk).reduce((a, k) => { const sp = spanOf(k); return sp ? a + sk[k] / sp : a; }, 0);
    const questLv = bo => (bo.quest || []).filter(c => c.current).reduce((sum, c) => {
      const qq = bridge.quests && bridge.quests[c.name];
      return qq ? sum + lvVal(qq.xpBy || {}) / Math.max(1, qq.steps - qq.current) : sum;
    }, 0);
    const metricsFor = (slot, oidx) => {
      if (!bridge || slot == null || oidx == null) return null;
      const sl = bridge.slots.find(x => x.index === slot);
      const bo = sl && sl.options[oidx];
      if (!bo || !Number.isFinite(bo.timeSec) || !Number.isFinite(bo.totalXp)) return null;
      // Slay options: total XP across Slay + combat skills (bridge `combat`); skills: dashboard XP x XP bonus.
      const xp = bo.combat ? bo.combat.total : bo.totalXp;
      const tm = bo.combat && Number.isFinite(bo.combat.timeSec) ? bo.combat.timeSec : bo.timeSec;
      const sk = skMap(bo);
      return { t: tm, x: xp, q: questValue(bo), skill: bo.skill, act: bo.act, lucky: !!bo.lucky, boostDrops: bo.boostDrops || 0, quest: bo.quest, k: bo.kind === 'slay' ? 'slay' : 'skill', sk, v: lvVal(sk), qv: questLv(bo) };
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
    input.luckyBoost = Math.max(1, Number(settingOn('routeLuckyBoost', 2)) || 1);
    input.keepPicks = keepPicks;
    input.objective = String(settingOn('routeObjective', 'xp'));
    input.tpSteps = tpPref === 'max' ? 0 : Math.min(tpAggSteps() || tpEachSteps(), tpEachSteps());   // each charge must save this much; the whole set must also clear the total bar (applyGate)
    input.dropBoost = Math.max(1, Number(settingOn('routeDropBoost', 1.3)) || 1);
    if (tpPref === 'max' && !settingOn('routeShowMaxTp', false)) { tpPref = 'eff'; try { localStorage.setItem('cc-route-tp-pref', 'eff'); } catch (e) {} }   // the setting was switched off: back to Efficient
    input.tpMode = tpPref;
    input.tpPrice = tpPref === 'max' ? 0 : Math.max(0, Number(settingOn('routeTpWorthMin', 10)) || 10) * 60;
    // Stability rule (docs/ROUTE-ADVISOR-MODEL.md): a change is only suggested when it beats the queue / the last suggestion by this margin.
    input.stab = { rel: Math.max(0, Number(settingOn('routeMinGainPct', 2)) || 0) / 100, abs: 60, perSwap: Math.max(0, Number(settingOn('routePickPenaltyPct', 3)) || 0) / 100, drift: 2, walkAbs: Math.max(5, Number(settingOn('routeAdvisorMinSaveSec', 30)) || 30) };
    input.wCombat = Math.max(0, Number(settingOn('routeCombatWeightPct', 40))) / 100;
    try { const pv = window.__ccPluginSettings && window.__ccPluginSettings.get('routePriorities'); input.prio = pv && typeof pv === 'object' ? pv : PRIO_DEFAULT; } catch (e) { input.prio = PRIO_DEFAULT; }
    // Gathering against processing: every gathering skill's priority is multiplied by this ratio (1 = as set above; 1.5 = a gathering level is worth half as much again)
    { const gr = gatherRatio(); if (gr !== 1) { const sc = {}; Object.keys(input.prio).forEach((k) => { sc[k] = GATHER_SK.includes(k) ? input.prio[k] * gr : input.prio[k]; }); GATHER_SK.forEach((k) => { if (sc[k] == null) sc[k] = gr; }); input.prio = sc; } }
    if (bridge && bridge.head && Number.isFinite(bridge.head.timeSec)) input.hm = { t: bridge.head.combat && Number.isFinite(bridge.head.combat.timeSec) ? bridge.head.combat.timeSec : bridge.head.timeSec, x: bridge.head.combat ? bridge.head.combat.total : (bridge.head.totalXp || 0) * (1 + (bridge.head.xpBonus || 0)) };
    if (bridge && input.hm) { const hsk = skMap(bridge.head); Object.assign(input.hm, { sk: hsk, v: lvVal(hsk), lucky: !!bridge.head.lucky, boostDrops: bridge.head.boostDrops || 0, act: bridge.head.act, k: bridge.head.kind === 'slay' ? 'slay' : 'skill', qv: questLv(bridge.head), quest: bridge.head.quest }); }
    input.fp = fingerprint(q, input, bridge);
    input.inc = incs[modeKey(input)] || null;
    lastInput = input;
    // Run the optimiser in ~10 ms slices so the game stays smooth; the panel greys out with a progress bar meanwhile.
    const run = ++calcRun, t0 = performance.now();
    if (mainJob) mainJob.cancel(); if (varJob) varJob.cancel();
    calc = { p: 0 };
    render();
    const job = mainJob = solver.run(input, (p) => { if (run === calcRun && calc) { calc.p = p; setCalcBar(); } });
    job.done.then((res) => {
      if (run !== calcRun) return; // superseded by a newer calculation
      result = res;
      if (result) { result.ms = performance.now() - t0; result.q = q; }
      if (result) { noteChange(input); rememberPaths(input, result, input.fp); }
      calc = null;
      render();
      maybeNotify();
      if (result) { variantsFull = {}; runVariants(input, run); }
    }, (e) => {
      if (run !== calcRun) return;
      console.warn('[cc] route-advisor: optimize failed', e); calc = null; result = null; render();
    });
  }
  // ---- stability memory: the plan last suggested for each mode (keep / optimise x foot / teleports), so a recalculation has to beat it by a margin
  // before it replaces it, and a plan the player is following is not re-argued. Kept in the browser for six hours.
  const LS_INC = 'cc-route-inc-v2';
  let incs = {};
  try { const sv = JSON.parse(localStorage.getItem(LS_INC) || 'null'); if (sv && sv.v === 2 && Date.now() - sv.at < 6 * 3600 * 1000) incs = sv.incs || {}; } catch (e) {}
  const modeKey = (inp) => (inp.keepPicks ? 'K' : 'O') + inp.tpMode;
  function rememberPaths(inp, res, fp) {
    const P = res && res.paths; if (!P || !P.available || !P.incNext) return;
    incs[modeKey(inp)] = { skill: P.incNext.skill, combat: P.incNext.combat, quest: P.incNext.quest, shown: P.incNext.shown, followed: P.incNext.followed || null, best: P.best, fp };
    try { localStorage.setItem(LS_INC, JSON.stringify({ v: 2, at: Date.now(), incs })); } catch (e) {}
  }
  // What the player and the game did since the last suggestion, as short strings compared for equality: when none of them changed, the only thing
  // that moved is the clock (progress, rates), and a re-ranking then has to be twice as clear.
  function fingerprint(q, input, bridge) {
    const sk = bridge && bridge.skills ? Object.keys(bridge.skills).sort().map((k) => k + bridge.skills[k].level).join(',') : '';
    const st = JSON.stringify([input.objective, input.taskW, input.luckyBoost, input.dropBoost, input.tpSteps, input.tpPrice, input.wCombat, input.prio, input.stab && [input.stab.rel, input.stab.perSwap]]);
    return {
      rows: q.rows.map((r) => r.opts.map((o) => o.node + ':' + (o.label || '')).sort().join('/')).sort().join('>'),
      order: q.rows.map((r) => r.opts.map((o) => o.node + (o.selected ? '*' : '')).join('/')).join('>'),
      head: q.head + '|' + (q.headLabel || ''), levels: sk, settings: st,
      crystals: (input.crystals || []).map((c) => c.tier + 'x' + c.charges).join('+'), speed: String(Math.round((input.speed || 0) * 10)),
    };
  }
  const WHY = { rows: 'the tasks in your queue changed', order: 'you changed your queue', head: 'your current task changed', levels: 'a skill levelled up', settings: 'a Route Advisor setting changed', crystals: 'your teleport crystals changed', speed: 'your movement speed changed', gate: 'teleports now do (or no longer) save enough steps' };
  let lastInput = null, lastShown = null, changeInfo = null;
  const trace = [];   // the last suggestions, newest last (window.__ccRouteAdvisor.log): what was suggested, why it changed, what was kept
  function shownOf(res) {
    const P = res && res.paths;
    if (P && P.available) { const bk = P.best; return { best: bk, sig: bk ? P[bk].sig : '', cur: P.cur.sig }; }
    return { best: null, sig: res && res.rec ? res.rec.sig : '', cur: res && res.current ? res.current.sig : '' };
  }
  const nodesNamed = (res, plan) => plan.map(p => { const o = res.rows[p.row] && res.rows[p.row].opts[p.opt]; return o ? o.node : '?'; }).join('>');
  function noteChange(input) {
    const P = result && result.paths, sh = shownOf(result);
    const reasons = P && P.available ? P.reasons || [] : [];
    trace.push({ t: Date.now(), best: sh.best, sig: sh.sig, cur: sh.cur, reasons: reasons.slice(), steady: P ? P.steady : null, info: P && P.available ? P.info : null, rows: result ? result.rows.length : 0, head: result ? result.head : '',
      curN: P && P.available && result ? nodesNamed(result, P.cur.plan) : null, tgtN: P && P.available && P.best && result ? nodesNamed(result, P[P.best].plan) : null });   // by task, so a flip can be replayed
    if (trace.length > 200) trace.shift();
    if (lastShown && (lastShown.sig !== sh.sig || lastShown.best !== sh.best)) {
      const kept = P && P.available && sh.best && P.info && P.info[sh.best] && P.info[sh.best].kept;
      changeInfo = { at: Date.now(), reasons: reasons.length ? reasons : (kept ? [] : ['gain']), from: lastShown.sig, to: sh.sig };
    }
    lastShown = sh;
  }
  // the teleport gate can swap the shown plan for the on-foot one: note that as a change too
  function noteGate() {
    if (!result) return;
    const sh = shownOf(result);
    if (lastShown && (lastShown.sig !== sh.sig || lastShown.best !== sh.best)) changeInfo = { at: Date.now(), reasons: ['gate'], from: lastShown.sig, to: sh.sig };
    lastShown = sh;
  }
  function changeLine() {
    if (!changeInfo || Date.now() - changeInfo.at > 30 * 60 * 1000) return null;
    const why = changeInfo.reasons.map((r) => WHY[r]).filter(Boolean);
    const txt = why.length ? 'Suggestion updated because ' + why.join(' and ') + '.' : 'Suggestion updated: the new order is clearly better than the last one.';
    return h('div', 'rt-dim rt-chg', txt);
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
      const Pn = result.paths, bkn = Pn && Pn.available ? bestPathKey() : null;
      new Notification('Scapewatch', { body: bkn ? 'Better queue available: +' + ((Pn[bkn].m.score / Pn.cur.m.score - 1) * 100).toFixed(1) + '% progress per hour, the same progress about ' + fmtT(saved) + ' sooner.' : 'Faster route available: reorder your queue to save ' + fmtT(saved) + ' of walking (' + fmtT(result.current[prefKey()].time) + ' → ' + fmtT(prefPlan()[prefKey()].time) + ').' });
      try { localStorage.setItem(LS_NOTIFY, JSON.stringify({ sig, at: now })); } catch (e) {}
    } catch (e) { /* notifications are best effort */ }
  }

  function signature() {
    let pr = ''; try { pr = JSON.stringify(window.__ccPluginSettings.get('routePriorities') || '') + '|' + gatherRatio(); } catch (e) {}
    const q = readQueue();
    if (!q) return '';
    return [q.head, readCrystals().map(c => c.tier + 'x' + c.charges).join('+'), Math.round(readSpeed() * 10),
      q.rows.map(r => r.opts.map(o => o.node + (o.selected ? '*' : '')).join('/')).join('>'),
      // Rates drift slowly (head task progress, levels): refresh once a minute while the bridge is attached.
      window.__ccBridge && window.__ccBridge.ok && window.__ccBridge.ok() ? 'B' + Math.floor(Date.now() / 60000) : 'b', pr].join('#');
  }
  function recSig() { if (!result) return ''; const sh = shownOf(result); return sh.sig + '|' + sh.cur; }   // what is SHOWN, so dismissing and notifying follow the plan on screen

  // --- UI ------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'cc-route-style';
  style.textContent = `
#cc-route-panel{position:fixed;left:24px;top:90px;width:420px;max-height:80vh;z-index:99984;display:flex;flex-direction:column;
  background:var(--cc-sunk);border:1px solid rgba(255,255,255,.16);border-radius:10px;color:var(--cc-text);overflow:hidden;
  font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55);transition:border-radius .26s ease}
#cc-route-panel[data-map-side=r]{border-top-right-radius:0;border-bottom-right-radius:0}
#cc-route-panel[data-map-side=l]{border-top-left-radius:0;border-bottom-left-radius:0}
#cc-route-panel .rt-head,#cc-route-panel .rt-body{zoom:var(--rz,1)}
#cc-route-panel{min-width:0 !important;min-height:0 !important}
#cc-route-panel .rt-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:3;border-right:3px solid rgba(255,255,255,.35);border-bottom:3px solid rgba(255,255,255,.35);border-bottom-right-radius:8px;box-sizing:border-box}
#cc-route-panel .rt-grip:hover{border-color:var(--cc-accent)}
#cc-route-panel[hidden]{display:none!important}
#cc-route-panel button{font:inherit;color:var(--cc-text);background:var(--cc-bg-3);border:1px solid var(--cc-border-strong);border-radius:6px;padding:2px 10px;cursor:pointer}
#cc-route-panel button:hover{border-color:var(--cc-text-faint)}
/* header + tabs: solid, never scroll away */
#cc-route-panel .rt-head{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:grab;user-select:none;background:var(--cc-bg-2);
  border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-panel .rt-head:active{cursor:grabbing}
#cc-route-panel .rt-ttl{font-weight:700;font-size:14px;color:var(--cc-text)}
#cc-route-panel .rt-pill{font-size:12px;font-weight:600;border-radius:10px;padding:1px 9px;background:var(--cc-bg-3);color:var(--cc-text-dim)}
#cc-route-panel .rt-pill.good{background:rgba(95,220,106,.14);color:var(--cc-good)}
#cc-route-panel .rt-sp{flex:1}
#cc-route-panel .rt-x{padding:0 8px;font-size:16px;line-height:20px}
#cc-route-panel .rt-tabs{display:flex;gap:2px;padding:0 8px;background:var(--cc-bg-2);border-bottom:1px solid rgba(255,255,255,.1);flex:none}
#cc-route-panel .rt-tab{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:7px 12px;color:var(--cc-text-dim);font-weight:600}
#cc-route-panel .rt-subtabs{display:flex;gap:6px;margin:0 0 8px}
#cc-route-panel .rt-prefrow{display:flex;align-items:center;gap:6px;margin-top:8px}
#cc-route-panel .rt-upsell{margin-top:8px;padding:6px 8px;border:1px solid var(--cc-magic);border-radius:7px;background:rgba(176,124,255,.09);color:var(--cc-magic);font-size:12px}
#cc-route-panel .rt-upsell button{margin-left:6px}
#cc-route-panel .rt-tab:hover{color:var(--cc-text);border-color:transparent}
#cc-route-panel .rt-tab.on{color:var(--cc-accent);border-bottom-color:var(--cc-accent)}
/* only the body scrolls, with a slim scrollbar */
#cc-route-panel .rt-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px 12px;scrollbar-width:thin;scrollbar-color:var(--cc-border-strong) transparent}
#cc-route-panel .rt-body::-webkit-scrollbar{width:8px}
#cc-route-panel .rt-body::-webkit-scrollbar-track{background:transparent;margin:6px 0}
#cc-route-panel .rt-body::-webkit-scrollbar-thumb{background:var(--cc-border-strong);border-radius:8px;border:2px solid var(--cc-sunk)}
#cc-route-panel .rt-body::-webkit-scrollbar-thumb:hover{background:var(--cc-border-strong)}
#cc-route-panel .rt-h{margin:14px 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--cc-text-faint);font-weight:700}
#cc-route-panel .rt-h:first-child{margin-top:0}
#cc-route-panel .rt-hero{padding:10px 12px;border-radius:8px;background:var(--cc-bg-2);border:1px solid rgba(255,255,255,.07)}
#cc-route-panel .rt-big{font-size:16px;font-weight:700}
#cc-route-panel .rt-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
#cc-route-panel .rt-chip{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--cc-bg-3);color:var(--cc-text-dim);border:1px solid rgba(255,255,255,.06)}
#cc-route-panel .rt-chip b{color:var(--cc-text);font-weight:600}
#cc-route-panel .rt-good{color:var(--cc-good)}#cc-route-panel .rt-bad{color:var(--cc-bad)}#cc-route-panel .rt-dim{color:var(--cc-text-dim)}
#cc-route-panel .rt-plan{margin:0 0 8px;padding:9px 11px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:var(--cc-bg-2);cursor:pointer;transition:border-color .12s,background .12s}
#cc-route-panel .rt-plan:hover{border-color:rgba(255,255,255,.22);background:var(--cc-bg-2)}
#cc-route-panel .rt-plan.sel{border-color:var(--cc-accent);background:rgba(255,210,74,.06)}
#cc-route-panel .rt-plan.qst{border-color:var(--cc-info)}
#cc-route-panel .rt-plan.tp{border-color:var(--cc-magic)}
#cc-route-panel .rt-plan.tp.qst{outline:1.5px solid var(--cc-info);outline-offset:1px}
#cc-route-panel .rt-plan{position:relative}
/* Selected marker sits OUTSIDE the card edge so it never covers the purple / blue border. */
#cc-route-panel .rt-plan.sel.tp,#cc-route-panel .rt-plan.sel.qst{background:rgba(255,210,74,.07)}
#cc-route-panel .rt-plan.sel.tp::before,#cc-route-panel .rt-plan.sel.qst::before{content:'';position:absolute;left:-8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:var(--cc-accent)}
.rt-vtip{position:fixed;z-index:2147482400;width:392px;padding:9px 11px;border-radius:10px;background:var(--cc-bg);border:1px solid var(--cc-border-strong);box-shadow:0 10px 30px rgba(0,0,0,.65);color:var(--cc-text);font:12.5px/1.4 system-ui,sans-serif}
.rt-vtip::before,.rt-vtip::after{content:'';position:absolute;left:0;right:0;height:16px;pointer-events:none}   /* the gap strips must never sit over the badge and steal its clicks */
.rt-vtip::before{top:-16px}.rt-vtip::after{bottom:-16px}
.rt-vh{font-weight:700;color:var(--cc-accent);margin-bottom:5px}
.rt-vt table,#cc-route-panel .rt-vt table{width:100%;border-collapse:collapse}
.rt-vt th{font-size:15px;padding:3px 2px;text-align:center;font-weight:400}
.rt-vt td.rl{padding:4px 6px 4px 0;white-space:nowrap;font-weight:600}
.rt-vt td.c{text-align:center;padding:4px 3px;border-radius:6px;cursor:default;font-size:12px}
.rt-vt td.c.g{color:var(--cc-good)}.rt-vt td.c.z{color:var(--cc-text-dim)}
.rt-vt td.c:hover{background:rgba(255,255,255,.08)}
.rt-vt td.c.cur{outline:1px solid var(--cc-accent);outline-offset:-1px}
.rt-vdet{margin-top:6px;padding:5px 7px;border-radius:6px;background:rgba(255,255,255,.05);color:var(--cc-text-dim);font-size:12px;min-height:34px}
.rt-vdet b{color:var(--cc-text)}
.rt-vleg{margin-top:5px;color:var(--cc-text-faint);font-size:11px}
#cc-route-panel .rt-wi{margin:8px 0}
#cc-route-panel .rt-wi h4{margin:0 0 4px;color:var(--cc-accent);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
#cc-route-panel .rt-legend{font-size:11.5px;color:var(--cc-text-dim);margin:0 0 6px}
#cc-route-panel .rt-legend .lp{color:var(--cc-magic)}#cc-route-panel .rt-legend .lq{color:var(--cc-info)}
#cc-route-panel .rt-plan h4{margin:0 0 4px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:baseline}
#cc-route-panel .rt-plan h4 .rt-big{font-size:14px;white-space:nowrap}
#cc-route-panel ul{margin:5px 0 0;padding:0 0 0 16px}
#cc-route-panel li{margin:1px 0}
#cc-route-panel li.pro{color:var(--cc-good);list-style:'+ '}#cc-route-panel li.con{color:var(--cc-bad);list-style:'− '}
#cc-route-panel .rt-obj{margin:0}
#cc-route-panel .rt-objbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:8px}
#cc-route-panel .rt-seg{padding:2px 10px;font-size:12px}
#cc-route-panel .rt-seg.on{border-color:var(--cc-accent);color:var(--cc-accent);background:var(--cc-accent-bg)}
#cc-route-panel .rt-seg:disabled{opacity:.4;cursor:default}
#cc-route-panel .rt-showing{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;border-radius:8px;background:var(--cc-bg-2);border:1px solid rgba(255,255,255,.07)}
#cc-route-panel .rt-showing .rt-sp{flex:1}
#cc-route-panel .rt-pick{flex:1;min-width:0;font:inherit;color:var(--cc-text);background:var(--cc-bg-3);border:1px solid var(--cc-border-strong);border-radius:6px;padding:3px 6px;cursor:pointer}
#cc-route-panel .rt-pick:focus{outline:none;border-color:var(--cc-accent)}
#cc-route-panel svg{display:block;width:100%;margin:0 0 8px;background:var(--cc-sunk);border:1px solid rgba(255,255,255,.1);border-radius:8px}
#cc-route-panel ol.rt-stops{margin:0;padding:0 0 0 22px;font-size:12px}
#cc-route-panel ol.rt-stops li{padding:3px 4px;border-radius:4px;cursor:default}
#cc-route-panel ol.rt-stops li:hover{background:rgba(255,255,255,.07)}
#cc-route-panel .rt-tp{color:var(--cc-accent)}
#cc-route-panel .rt-note{margin-top:12px;font-size:11px;color:var(--cc-text-faint);line-height:1.35}
.uq-row.cc-route-hl{box-shadow:inset 0 0 0 2px var(--cc-accent) !important}
#cc-route-panel .rt-calc{padding:8px 12px 9px;background:var(--cc-bg-2);border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-panel .rt-calc-top{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cc-text)}
#cc-route-panel .rt-calc-top b{color:var(--cc-info);font-variant-numeric:tabular-nums}
#cc-route-panel .rt-calc-bar{height:5px;margin-top:6px;border-radius:3px;background:var(--cc-border);overflow:hidden}
#cc-route-panel .rt-calc-bar i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#2f8cff,var(--cc-info));box-shadow:0 0 8px rgba(74,168,255,.7);transition:width .15s linear}
#cc-route-panel .rt-spin{width:11px;height:11px;border-radius:50%;border:2px solid var(--cc-border-strong);border-top-color:var(--cc-info);animation:rtspin .8s linear infinite}
@keyframes rtspin{to{transform:rotate(360deg)}}
#cc-route-panel .rt-calc.load .rt-calc-bar i{width:35%!important;animation:rtind 1.3s ease-in-out infinite}
@keyframes rtind{0%{margin-left:-35%}100%{margin-left:100%}}
#cc-route-panel.calculating .rt-body,#cc-route-panel.calculating .rt-tabs{opacity:.38;filter:grayscale(1);pointer-events:none;transition:opacity .15s}
@media (prefers-reduced-motion:reduce){#cc-route-panel .rt-spin{animation:none}}
#cc-route-panel .rt-ptitle{font-size:13px}
#cc-route-panel .rt-badge{font-size:11px;background:#3a3216;color:var(--cc-accent);border-radius:8px;padding:0 7px;font-weight:500}
#cc-route-panel .rt-pbar{height:6px;border-radius:3px;background:var(--cc-border);margin:6px 0}
#cc-route-panel .rt-pbar i{display:block;height:100%;border-radius:3px}
#cc-route-panel .rt-pstats{display:flex;gap:4px 12px;flex-wrap:wrap;color:var(--cc-text-dim);font-size:11.5px;margin-top:2px}
#cc-route-panel .rt-pstats b{color:var(--cc-text);font-weight:500}
#cc-route-panel .rt-tpc{color:var(--cc-magic)}
#cc-route-panel .rt-why{margin:4px 0 6px;padding:6px 8px;border:1px solid rgba(255,184,107,.35);border-left:3px solid var(--cc-warn);border-radius:6px;background:rgba(255,184,107,.06);font-size:11.5px;line-height:1.45}
#cc-route-panel .rt-why-h{color:var(--cc-warn);margin-bottom:2px}
#cc-route-panel .rt-why-h b{color:var(--cc-warn);font-weight:600}
#cc-route-panel .rt-why-l{color:var(--cc-text-dim)}
#cc-route-panel .rt-why-l.good{color:var(--cc-good)}
#cc-route-panel .rt-why-l.bad{color:var(--cc-bad)}
#cc-route-panel .rt-sw{color:var(--cc-warn)}
#cc-route-panel .rt-plan.best{border-color:var(--cc-accent)}
#cc-route-panel .rt-plan.rt-off{opacity:.55;cursor:default}
#cc-route-panel .rt-steps-btn{margin-top:6px}
#cc-route-panel .rt-curnow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;padding:6px 10px;border:1px solid var(--cc-border);border-radius:8px;color:var(--cc-text-dim);font-size:12px;cursor:pointer}
#cc-route-panel .rt-curnow.sel{border-color:var(--cc-accent)}
#cc-route-panel .rt-curnow b{color:var(--cc-text);font-weight:500}
#cc-route-maptab{position:fixed;z-index:99985;width:26px;padding:10px 0;writing-mode:vertical-rl;background:#1d2a44;border:1px solid #3a5fa0;color:var(--cc-info);font:12px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;transition:left .26s ease;border-radius:0 8px 8px 0}
#cc-route-maptab[data-side=l]{border-radius:8px 0 0 8px}
#cc-route-maptab:hover{background:#26375a;color:var(--cc-text)}
#cc-route-maptab[hidden]{display:none!important}
#cc-route-map{position:fixed;z-index:99983;box-sizing:border-box;display:flex;flex-direction:column;background:var(--cc-sunk);border:1px solid rgba(255,255,255,.16);color:var(--cc-text);font:12px/1.4 system-ui,sans-serif;
  box-shadow:0 8px 30px rgba(0,0,0,.55);overflow:hidden;transition:transform .26s ease,opacity .2s ease,visibility 0s linear .26s;visibility:hidden;opacity:0;pointer-events:none}
#cc-route-map[data-side=r]{border-radius:0 10px 10px 0;transform:translateX(-102%)}
#cc-route-map[data-side=l]{border-radius:10px 0 0 10px;transform:translateX(102%)}
#cc-route-map[data-open="1"]{transform:none;visibility:visible;opacity:1;pointer-events:auto;transition:transform .26s ease,opacity .2s ease,visibility 0s}
#cc-route-map .rt-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--cc-bg-2);border-bottom:1px solid rgba(255,255,255,.08);flex:none}
#cc-route-map .rt-ttl{font-weight:700;font-size:14px;color:var(--cc-text)}
#cc-route-map .rt-sp{flex:1}
#cc-route-map .rt-x{padding:0 8px;font-size:16px;line-height:20px;color:var(--cc-text);background:var(--cc-bg-3);border:1px solid var(--cc-border-strong);border-radius:6px;cursor:pointer}
#cc-route-map svg{display:block;background:var(--cc-sunk);flex:1;min-height:0}
#cc-route-map .rt-dim{color:var(--cc-text-dim)}
#cc-route-map .rt-maplegend{display:flex;gap:14px;flex-wrap:wrap;padding:7px 12px;border-top:1px solid rgba(255,255,255,.08);color:var(--cc-text-dim);font-size:11.5px;flex:none}
#cc-route-map .rt-maplegend i{display:inline-block;width:18px;vertical-align:middle}
@media (prefers-reduced-motion:reduce){#cc-route-map,#cc-route-maptab{transition:none}}
#cc-route-alert{position:fixed;z-index:99983;display:flex;align-items:center;gap:2px;font:12px/1 system-ui,sans-serif}
#cc-route-alert[hidden],#cc-route-alert[data-park]{display:none!important}
#cc-route-alert.in-card{position:static;display:flex;align-items:center;gap:2px;margin:0 0 8px;padding:3px 6px;border:1px solid #b8962f;border-radius:8px;background:rgba(10,10,14,.55)}
#cc-route-alert.in-card.ok{border-color:#3f9a52}
#cc-route-alert.in-card .tri,#cc-route-alert.in-card .x{border:0;background:transparent}
#cc-route-alert .tri{display:flex;align-items:center;gap:5px;background:rgba(10,10,14,.92);color:var(--cc-accent);border:1px solid #b8962f;
  border-radius:5px;padding:3px 7px;cursor:pointer;font:inherit;font-size:13px;font-weight:600}
#cc-route-alert .tri:hover{background:rgba(40,36,10,.95)}
#cc-route-alert .tri.calc{color:var(--cc-text-dim);border-color:var(--cc-border-strong)}
.rt-spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:var(--cc-accent);border-radius:50%;animation:ccRtSpin .8s linear infinite;vertical-align:-2px}
@keyframes ccRtSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.rt-spin{animation-duration:2.4s}}
#cc-route-alert .tri.ok{color:var(--cc-good);border-color:#3f9a52}
#cc-route-alert .tri.ok:hover{background:rgba(12,40,18,.95)}
#cc-route-alert.docked{position:absolute;left:0;top:auto;bottom:calc(100% - 1px);z-index:0;gap:0;background:rgba(10,10,14,.97);border:3px solid #d9aa2c;border-bottom:none;border-radius:9px 9px 0 0;padding:3px 6px 3px 5px;
  animation:ccRaPulse 2.6s ease-in-out infinite}
@keyframes ccRaPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,210,74,0);border-color:#b8902a}50%{box-shadow:0 -2px 9px 1px rgba(255,210,74,.42);border-color:var(--cc-accent)}}
#cc-route-alert.bardock{overflow:hidden;white-space:nowrap;position:fixed;right:auto;bottom:auto;z-index:2147482590;box-sizing:border-box;justify-content:center;transition:left .24s cubic-bezier(.2,.8,.2,1),top .24s cubic-bezier(.2,.8,.2,1),width .24s cubic-bezier(.2,.8,.2,1);animation:ccRaIn .34s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes ccRaIn{from{clip-path:inset(0 50% 0 50%);opacity:0}to{clip-path:inset(0 0 0 0);opacity:1}}
@media (prefers-reduced-motion:reduce){#cc-route-alert.bardock{animation:none;transition:none}}
#cc-route-alert.bardock[data-pos=top]{border-top:none;border-bottom:3px solid #d9aa2c;border-radius:0 0 9px 9px}
#cc-route-alert.bardock[data-pos=top].ok{border-bottom-color:#3f9a52}
@media (prefers-reduced-motion:reduce){#cc-route-alert.docked{animation:none}}
#cc-route-alert.docked.ok{border-color:#3f9a52;animation:none}
#cc-route-alert.docked.ok .tri.ok:hover{background:rgba(12,40,18,.8)}
#cc-route-alert.docked .tri,#cc-route-alert.docked .x{border:0;background:transparent;border-radius:4px}
#cc-route-alert.docked .x{width:16px}
#cc-route-alert .x{background:rgba(10,10,14,.92);color:var(--cc-text-dim);border:1px solid var(--cc-border-strong);border-radius:4px;width:18px;height:18px;line-height:14px;padding:0;cursor:pointer;font-size:13px}
#cc-route-alert .x:hover{color:var(--cc-text);border-color:var(--cc-text-faint)}
/* drawer: the panel is docked to the right screen edge and slides out; its handle stays on the edge */
#cc-route-panel[data-dock=r]{left:auto !important;right:0 !important;top:calc(var(--cc-bar-h,34px) + 12px) !important;bottom:60px;height:auto !important;max-height:none !important;width:min(420px,92vw) !important;
  border-radius:12px 0 0 12px;border-right:0;box-shadow:-10px 0 34px rgba(0,0,0,.55);z-index:99984;
  transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
#cc-route-panel[data-dock=r][data-state=closed]{transform:translateX(calc(100% + 30px));visibility:hidden;pointer-events:none;transition:transform .26s cubic-bezier(.4,0,1,1),visibility 0s linear .26s}
#cc-route-panel[data-dock=r] .rt-grip{display:none}
#cc-route-panel[data-dock=r] .rt-head{cursor:default}
#cc-route-handle{position:fixed;z-index:99985;width:30px;padding:12px 0;writing-mode:vertical-rl;background:var(--cc-sunk,#14141b);border:1px solid var(--cc-border-strong,rgba(255,255,255,.22));border-right:0;border-radius:10px 0 0 10px;
  color:var(--cc-text,#ddd);font:600 12px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:-4px 2px 16px rgba(0,0,0,.45);transition:right .3s cubic-bezier(.2,.8,.2,1),background .15s,color .15s}
#cc-route-handle:hover{background:var(--cc-bg-hover,#26262f);color:#fff}
#cc-route-handle[hidden]{display:none !important}
#cc-route-handle[data-tone=warn]{border-color:#d9aa2c;color:#ffd24a;box-shadow:-4px 2px 16px rgba(217,170,44,.25)}
#cc-route-handle[data-tone=ok]::after{content:"";display:block;width:7px;height:7px;margin:8px auto 0;border-radius:50%;background:#3f9a52}
#cc-route-handle[data-tone=warn]::after{content:"";display:block;width:7px;height:7px;margin:8px auto 0;border-radius:50%;background:#ffd24a}
@media (prefers-reduced-motion:reduce){#cc-route-panel[data-dock=r],#cc-route-handle{transition:none}}
`;
  const panel = document.createElement('div');
  panel.id = 'cc-route-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Route Advisor');
  panel.hidden = true;
  const alertEl = document.createElement('div');
  alertEl.id = 'cc-route-alert';
  alertEl.hidden = true;
  // The badge's buttons are rebuilt every few hundred ms, which can swallow a click (mouse down on one copy, up on the next): the click then lands here.
  alertEl.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.x')) return; if (e.target === alertEl || (e.target.closest && e.target.closest('.tri'))) { userOpen = true; render(); } });

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // drawer handle: a slim tab on the screen edge (always shown while the advice exists); a click slides the drawer out or in
  const handle = document.createElement('button');
  handle.id = 'cc-route-handle'; handle.type = 'button'; handle.hidden = true;
  handle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.dataset.state === 'open') { userOpen = false; if (document.body.classList.contains('map-active')) userClosedOnMap = true; }
    else { userOpen = true; userClosedOnMap = false; }
    render();
  });
  ['mousedown', 'contextmenu', 'wheel'].forEach((t) => handle.addEventListener(t, (e) => e.stopPropagation()));
  function dockHandle(show, open) {
    handle.hidden = !show;
    if (!show) return;
    handle.dataset.open = open ? '1' : '0';
    let tone = '';
    if (result) { const minSave = Math.max(5, Number(settingOn('routeAdvisorMinSaveSec', 30)) || 30); tone = prefSaved() >= minSave ? 'warn' : 'ok'; }
    handle.dataset.tone = tone;
    const label = open ? '▸ Route Advisor' : '◂ Route Advisor';
    if (handle.dataset.label !== label) { handle.dataset.label = label; handle.textContent = label; }
    handle.title = open ? 'Slide the Route Advisor away' : 'Slide the Route Advisor out';
    // when the drawer is out the tab sits on its outer edge
    const vh = window.__ccVH ? window.__ccVH() : window.innerHeight;   // layout sizes, not the rect: the panel is mid-slide for a moment
    handle.style.right = open && panel.offsetWidth ? panel.offsetWidth + 'px' : '0px';
    handle.style.top = Math.round(Math.max(60, Math.min(vh - 170, vh * 0.3))) + 'px';
  }
  function insertUi() {
    if (!document.body) return false;
    if (!document.getElementById('cc-route-handle')) document.body.appendChild(handle);
    if (!document.getElementById('cc-route-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-route-panel')) document.body.appendChild(panel);
    if (!document.getElementById('cc-route-alert')) document.body.appendChild(alertEl);
    if (!document.getElementById('cc-route-map')) document.body.appendChild(drawer);
    if (!document.getElementById('cc-route-maptab')) document.body.appendChild(mapTab);
    return true;
  }

  // a row is known by the set of places its options are at (and which of the rows with that same set it is), so it can be found again in the queue cards even if the queue has changed since
  const rowKey = (row) => row.opts.map((o) => o.node).sort().join(',');
  const rowNth = (row) => result.rows.filter((r2) => r2.id < row.id && rowKey(r2) === rowKey(row)).length;
  function clearHl() { document.querySelectorAll('.cc-route-hl').forEach(e => e.classList.remove('cc-route-hl')); try { if (window.__ccBar && window.__ccBar.highlight) window.__ccBar.highlight(null); } catch (e) { /* bar not there */ } }

  const fmtXp = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const PATH_DEFS = [
    ['skill', 'Skilling XP', '#6fe27a', 'Picks your skilling options and orders them for the most levels per hour.'],
    ['combat', 'Combat XP', '#ff8a7a', 'Picks the Slay options. Combat XP is split over Slay, Life, your combat skill and Dodge/Defend.'],
    ['quest', 'Quests and scrolls', '#6fb6ff', 'Favours stops that complete your active quest steps.'],
  ];
  const lvFmt = v => (v >= 10 ? v.toFixed(1) : v.toFixed(2));
  const isXp = () => !!(result && result.paths && result.paths.objective === 'xp');
  const rate = v => (isXp() ? (v * ((result.paths && result.paths.refSpan) || 20000) / 1000).toFixed(1) + 'k xp/hr' : lvFmt(v) + ' lv/hr');
  const unit = () => (isXp() ? 'xp/hr' : 'lv/hr');
  const pctTxt = (a, b) => (b > 0 ? (a >= b ? '+' : '\u2212') + Math.abs((a / b - 1) * 100).toFixed(Math.abs(a / b - 1) < 0.1 ? 1 : 0) + '%' : '');
  function bestPathKey() {
    const P = result && result.paths; if (!P || !P.available) return null;
    return P.best && P[P.best] ? P.best : null;   // chosen by the optimiser: the best score, the previous winner staying unless another clearly beats it
  }
  function selKey() {
    const P = result && result.paths;
    if (!P || !P.available) return null;
    if (selectedKey === 'cur') return 'cur';
    // A path you chose stays chosen. When it has nothing left to suggest (your queue already is that plan) the panel and the queue stay on YOUR queue, they never
    // jump to another path; only the badge on the Tasks panel may point at a better path.
    if (PATH_DEFS.some(d => d[0] === selectedKey)) return P[selectedKey] ? selectedKey : 'cur';
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
      off.appendChild(h('div', 'rt-dim', result.paths && result.paths[key + 'Floor'] ? 'Your current queue is already as good or better for this goal.' : key === 'quest' ? 'No quest steps among your queue options right now.' : 'Nothing in your queue fits this path.'));
      return off;
    }
    const m = p.m;
    const card = h('div', 'rt-plan' + (sel ? ' sel' : '') + (isBest ? ' best' : '') + pathFlags(p));
    card.title = tip;
    const hd = h('h4');
    const t = h('span', 'rt-ptitle', title); t.style.color = color; hd.appendChild(t);
    if (isBest) hd.appendChild(h('span', 'rt-badge', 'Best progress'));
    hd.appendChild(h('span', 'rt-sp'));
    const big = h('span', 'rt-big', '+' + rate(m.score)); big.title = 'Levels gained per hour: every skill\u2019s XP divided by what its next level costs'; hd.appendChild(big);
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
    const showMax = settingOn('routeShowMaxTp', false) || tpPref === 'max';
    [['foot', 'On foot', 'Plan without teleport crystals'], ['eff', 'Efficient', 'The recommended mode. Teleports are used only when they save at least ' + tpAggSteps().toLocaleString('en-US') + ' steps over the whole route (Settings > Plugins > Route Advisor)']].concat(showMax ? [['max', 'Max', 'Use charges freely, fastest possible. Never chosen automatically: only when you pick it here']] : []).forEach(([k, label, tip]) => {
      const b = h('button', 'rt-seg' + (tpPref === k ? ' on' : ''), label); b.title = tip;
      b.addEventListener('click', e => { e.stopPropagation(); tpPref = k; try { localStorage.setItem('cc-route-tp-pref', k); } catch (er) {} lastSig = ''; scheduleCompute(); render(); });
      prefRow.appendChild(b);
    });
    prefRow.appendChild(h('span', 'rt-sp'));
    prefRow.appendChild(h('span', 'rt-dim', cr.length ? cr.map(c => c.charges + '\u00d7 ' + (TIER_NAME[c.tier] || 'T' + c.tier)).join(', ') : 'no crystals'));
    body.appendChild(prefRow);
    const keepRow = h('div', 'rt-prefrow');
    keepRow.appendChild(h('span', 'rt-dim', 'Picks'));
    [[false, 'Optimise', 'May swap which option you picked in a row when that is better'], [true, 'Keep mine', 'Never change your picks: only reorder the rows and plan teleports']].forEach(([k, label, tip]) => {
      const b = h('button', 'rt-seg' + (keepPicks === k ? ' on' : ''), label); b.title = tip;
      b.addEventListener('click', e => { e.stopPropagation(); keepPicks = k; try { localStorage.setItem('cc-route-keep', k ? '1' : '0'); } catch (er) {} lastSig = ''; scheduleCompute(); render(); });
      keepRow.appendChild(b);
    });
    body.appendChild(keepRow);
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
    row.appendChild(h('b', null, '+' + rate(cm.score)));
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
        bl('This pick: ' + fmtT(sw.newT) + ' for +' + fmtXp(sw.newXp) + ' xp (' + rate(sw.newRate) + ')', null);
        bl('Your pick: ' + fmtT(sw.oldT) + ' for +' + fmtXp(sw.oldXp) + ' xp (' + rate(sw.oldRate) + ')', null);
        if (sw.newQuest && !sw.oldQuest) bl('Completes a quest step your pick does not', true);
        const dT = sw.dTotal, dL = sw.dLevels;
        bl('Effect on this path with only this swap: ' + (sw.dScore >= 0 ? '+' : '\u2212') + Math.abs(sw.dScore * 100).toFixed(1) + '% ' + unit() + ' \u00b7 ' + (dL >= 0 ? '+' : '\u2212') + Math.abs(dL).toFixed(2) + ' levels \u00b7 ' + (dT <= 0 ? fmtT(-dT) + ' less' : fmtT(dT) + ' more') + ' time' + (Math.abs(sw.dWalk) >= 1 ? ' (' + (sw.dWalk <= 0 ? fmtT(-sw.dWalk) + ' less' : fmtT(sw.dWalk) + ' more') + ' walking)' : ''), sw.dScore >= 0);
        if (sw.dScore < 0) { const dk = PATH_DEFS.find(d => d[0] === selKey()); if (dk) bl('Kept for this path’s goal: the ' + dk[1] + ' path only counts ' + ({ skill: 'skilling XP', combat: 'combat XP', quest: 'quest progress' }[dk[0]]) + ', so it can cost overall lv/hr.', null); }
        if (sw.dCharges) bl((sw.dCharges > 0 ? 'Uses ' + sw.dCharges + ' more' : 'Saves ' + -sw.dCharges) + ' teleport charge' + (Math.abs(sw.dCharges) === 1 ? '' : 's'), sw.dCharges < 0);
        li.appendChild(why);
      }
      li.addEventListener('mouseenter', () => { clearHl(); if (q && q.rowEl) q.rowEl.classList.add('cc-route-hl'); try { if (window.__ccBar && window.__ccBar.highlight) window.__ccBar.highlight(rowKey(row), rowNth(row), opt.node); } catch (e) { /* bar not there */ } });
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
    const drawerOn = settingOn('routeAdvisorDrawer', true);
    // drawer: the panel is docked to the screen edge and slides out; while the World Map is open only its handle shows until you open it
    const wantPanel = enabled && (result || calc) && (userOpen || (mapActive && settingOn('routeAdvisorAutoMap', drawerOn ? false : true) && !userClosedOnMap));
    panel.hidden = !(wantPanel || (drawerOn && enabled && (result || calc) && mapActive));
    panel.dataset.dock = drawerOn ? 'r' : '';
    panel.dataset.state = wantPanel ? 'open' : 'closed';
    dockHandle(drawerOn && enabled && !!(result || calc), wantPanel);   // the handle stays on the screen edge whether or not the World Map is open
    // alert triangle
    const minSave = Math.max(5, Number(settingOn('routeAdvisorMinSaveSec', 30)) || 30);
    const saved = result ? prefSaved() : 0;
    // Having the panel open counts as having seen the current suggestion: dismiss the warning until the calculation changes.
    if (wantPanel && result && recSig() !== dismissedSig) { dismissedSig = recSig(); try { localStorage.setItem(LS_DISMISS, dismissedSig); } catch (err) {} }
    // Persistent badge on the Tasks panel: yellow warning while a faster route is waiting, then (once dismissed, or when nothing is left to save)
    // a calm green badge showing the saving or "optimal". Always one click from the Route Advisor, no World Map needed.
    const alertOn = enabled && settingOn('routeAdvisorAlert', true) && (result || calc) && !wantPanel;
    const warn = saved >= minSave && recSig() !== dismissedSig;
    alertEl.hidden = !alertOn;
    if (alertOn && (calc || settling)) {
      alertEl.textContent = ''; alertEl.classList.remove('ok');
      const tri = h('button', 'tri calc'); tri.appendChild(h('span', 'rt-spin')); tri.appendChild(document.createTextNode(' Calculating\u2026'));
      tri.addEventListener('click', e => { e.stopPropagation(); userOpen = true; render(); });
      alertEl.appendChild(tri); placeAlert();
    } else if (alertOn) {
      alertEl.textContent = '';
      alertEl.classList.toggle('ok', !warn);
      const canSave = saved >= minSave;
      const tri = h('button', 'tri' + (warn ? '' : ' ok'), warn ? '\u26a0 \u2212' + fmtT(saved) : canSave ? '\u21af \u2212' + fmtT(saved) + ' possible' : '\u2713 Route optimal');

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
    if (P && P.available) {
      const up = bk && P.cur.m.score > 0 ? P[bk].m.score / P.cur.m.score - 1 : 0;
      const pill = h('span', 'rt-pill' + (up >= 0.02 ? ' good' : ''), up >= 0.0002 ? 'Best: +' + (up < 0.1 ? (up * 100).toFixed(1) : Math.round(up * 100)) + '% ' + unit() : 'Optimal ✓');
      if (up < 0.0002) pill.title = 'Your queue is the best order found after checking ' + (result.evaluated || 0).toLocaleString('en-US') + ' search states (the search is exact for up to ' + MAX_ROWS + ' rows, so no better order exists).';
      head.appendChild(pill);
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
    { const cl = changeLine(); if (cl) body.appendChild(cl); }
    planBody(body);
    if (result.gate) body.appendChild(h('div', 'rt-dim', result.gate.blocked ? 'Teleports would save ' + Math.round(result.gate.saved).toLocaleString('en-US') + ' steps over the whole route, under your ' + result.gate.th.toLocaleString('en-US') + '-step bar, so they are not used.' : 'Teleports save ' + Math.round(result.gate.saved).toLocaleString('en-US') + ' steps over the whole route (bar: ' + result.gate.th.toLocaleString('en-US') + ').'));
    if (Object.keys(variantsFull).length) { const wi = h('div', 'rt-wi'); wi.appendChild(h('h4', null, 'What you could gain')); wi.appendChild(variantTable()); wi.appendChild(h('div', 'rt-dim', '🔒 keep my picks \u00b7 \🔀 optimise picks \u00b7 \🚶 no teleports \u00b7 \u26A1 teleports. Highlighted = what you use now.')); body.appendChild(wi); }
    body.appendChild(h('div', 'rt-note', 'Display only \u2013 apply a suggestion by dragging queue rows / picking options yourself. lv/hr = weighted levels gained per hour (combat levels count ' + Math.round((Number(settingOn('routeCombatWeightPct', 40)) || 0)) + '%, see Settings > Plugins > Route Advisor). ' +
      (result.evaluated || 0).toLocaleString('en-US') + ' search states in ' + Math.round(result.ms) + ' ms' + (result.rows.length < (result.q ? result.q.rows.length : 0) ? '; first ' + result.rows.length + ' rows optimised' : '') + '.'));
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
    const show = !panel.hidden && r.width > 0 && !!result && panel.dataset.state !== 'closed';
    mapTab.hidden = !show;
    if (!show) { drawer.setAttribute('data-open', '0'); panel.dataset.mapSide = ''; return; }
    const S = window.__ccScale || 1, DW = DRAWER_W * S; // panels are scaled with the game window: geometry below is in screen pixels
    const roomR = innerWidth - r.right, roomL = r.left;
    const side = roomR >= DW + 24 * S || roomR >= roomL ? 'r' : 'l';
    const H = Math.max(300 * S, Math.min(r.height, (window.__ccVH ? window.__ccVH() : window.innerHeight) - 20)) / S;
    drawer.dataset.side = side;
    panel.dataset.mapSide = mapOpen ? side : '';
    drawer.style.top = Math.round(r.top) + 'px'; drawer.style.height = Math.round(H) + 'px'; drawer.style.width = DRAWER_W + 'px';
    drawer.style.left = Math.round(side === 'r' ? r.right - 1 : r.left - DW + 1) + 'px';
    drawer.setAttribute('data-open', mapOpen ? '1' : '0');
    if (mapOpen) renderDrawer();
    mapTab.dataset.side = side; mapTab.dataset.open = mapOpen ? '1' : '0';
    mapTab.textContent = mapOpen ? (side === 'r' ? '\u25c2 Map' : 'Map \u25b8') : (side === 'r' ? 'Map \u25b8' : '\u25c2 Map');
    const tabW = 26 * S;
    const edgeX = side === 'r' ? (mapOpen ? r.right + DW - 1 : r.right - 1) : (mapOpen ? r.left - DW + 1 - tabW : r.left - tabW + 1);
    mapTab.style.left = Math.round(edgeX) + 'px'; mapTab.style.top = Math.round(r.top + 58 * S) + 'px';
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

  // Where the Route Advisor badge lives: on the game's own Tasks panel (original) or at the top of the info bar's Tasks button card (bar).
  // If the game's Tasks panel is not there any more (hidden or disabled) and the bar has a Tasks button, the setting switches to the bar by itself.
  const barHasTasks = () => { try { return !!(window.__ccBar && window.__ccBar.hasButton && window.__ccBar.hasButton('tasks')); } catch (e) { return false; } };
  function origHost() { const q = document.querySelector('#unified-queue-panel'); const host = q ? (q.closest('.panel-floating') || q) : null; if (!host) return null; const r = host.getBoundingClientRect(); return r.width && getComputedStyle(host).display !== 'none' ? host : null; }
  // asked every frame by the badge loop: the answer only changes when a setting or the bar does, so it is kept for a quarter of a second
  let amV = '', amAt = 0;
  function attachMode() { const n = performance.now(); if (amV && n - amAt < 250) return amV; amV = attachMode0(); amAt = n; return amV; }
  function attachMode0() {
    let v = 'original'; try { v = window.__ccPluginSettings && window.__ccPluginSettings.get('routeAttach') === 'bar' ? 'bar' : 'original'; } catch (e) { v = 'original'; }
    if (v === 'original' && !origHost() && barHasTasks()) { try { window.__ccPluginSettings.set('routeAttach', 'bar'); } catch (e) { /* settings not there */ } v = 'bar'; }
    if (v === 'bar' && !barHasTasks()) v = 'original';
    return v;
  }
  function parkAlert() { alertEl.classList.remove('in-card'); alertEl.dataset.park = '1'; if (alertEl.parentElement !== document.body) document.body.appendChild(alertEl); }
  function alertToCard(host) { delete alertEl.dataset.park; alertEl.classList.remove('docked'); alertEl.classList.add('in-card'); if (alertEl.parentElement !== host) host.appendChild(alertEl); }
  function placeAlert() {
    if (attachMode() === 'bar') {
      // docked on the bar's Tasks button: a tab sitting on top of it (below it on a top bar), always visible, outside any panel
      const an = window.__ccBar && window.__ccBar.tasksAnchor && window.__ccBar.tasksAnchor();
      if (an) {
        const first = !alertEl.classList.contains('bardock');
        // this runs every frame: write only what changed, so a still badge costs no DOM mutations
        const st = (k, v) => { if (alertEl.style[k] !== v) alertEl.style[k] = v; };
        if (alertEl.dataset.kind !== an.kind) { alertEl.dataset.kind = an.kind; alertEl._kindAt = performance.now(); }
        st('transition', first || performance.now() - (alertEl._kindAt || 0) > 320 ? 'none' : '');
        if (alertEl.classList.contains('in-card')) alertEl.classList.remove('in-card'); if (alertEl.dataset.park !== undefined) delete alertEl.dataset.park;
        if (!alertEl.classList.contains('docked')) alertEl.classList.add('docked'); if (!alertEl.classList.contains('bardock')) alertEl.classList.add('bardock');
        { const ps = an.above ? 'bottom' : 'top'; if (alertEl.dataset.pos !== ps) alertEl.dataset.pos = ps; }
        if (alertEl.parentElement !== document.body) document.body.appendChild(alertEl);
        // the badge scales with what it sits on: on the Tasks button it is full size, on the card or panel it shrinks and grows with the panel's width
        const r = an.rect;
        const sig = alertEl.textContent; if (alertEl._natSig !== sig) { st('width', 'max-content'); alertEl._nat = alertEl.offsetWidth; alertEl._natSig = sig; }
        const nat = alertEl._nat || 60, ah = alertEl.offsetHeight || 26;
        // half the width of what it sits on, so it stays clear of the rounded corners: on the button it shrinks to fit, on a card or panel it scales with the panel
        const f = an.kind === 'btn' ? Math.max(0.62, Math.min(1, r.width * 0.5 / nat)) : Math.max(0.3, Math.min(1.4, r.width / 450));
        const w = an.kind === 'btn' ? nat : Math.max(nat, Math.round(r.width * 0.5 / f));
        st('width', w + 'px'); st('transformOrigin', an.above ? '50% 100%' : '50% 0'); st('transform', f === 1 ? '' : 'scale(' + f.toFixed(3) + ')');
        st('left', Math.round(r.left + r.width / 2 - w / 2) + 'px'); st('top', Math.round(an.above ? r.top + 1 - ah : r.bottom - 1) + 'px');
        return;
      }
    }
    alertEl.classList.remove('in-card', 'bardock'); delete alertEl.dataset.park; alertEl.style.left = ''; alertEl.style.top = ''; alertEl.style.width = ''; alertEl.style.transition = ''; alertEl.style.transform = ''; alertEl.style.transformOrigin = '';
    const host = origHost();
    if (!host) { alertEl.hidden = true; return; }
    // Lives INSIDE the Tasks panel, absolutely positioned on its top edge like a tab: it then shares the panel's scale,
    // zoom, position and stacking level (so windows / other panels correctly cover it). Re-attached if the game rebuilds the panel.
    alertEl.classList.add('docked');
    if (alertEl.parentElement !== host) host.appendChild(alertEl);
  }
  // follows its anchor every frame, so it moves with the panel you drag

  // every frame while a mouse button is down (so it follows a panel you drag), otherwise ten times a second: nothing else moves it
  let ptrDown = false, lastPlace = 0;
  const onPD = () => { ptrDown = true; }, onPU = () => { ptrDown = false; lastPlace = 0; };
  life.on(document, 'pointerdown', onPD, true); life.on(document, 'pointerup', onPU, true);
  const barDockLoop = () => { const n = performance.now(); if (!ptrDown && n - lastPlace < 100) return; lastPlace = n; try { if (!alertEl.hidden && alertEl.classList.contains('bardock')) placeAlert(); } catch (e) { /* next frame */ } };
  life.frame(barDockLoop);

  // draggable panel
  // the content scales with the panel: widen it and everything grows, narrow it and everything shrinks (420 px is 100%)
  let rzF = 1;
  const rzObs = (() => { try { const o = new ResizeObserver(() => { const f = Math.max(0.3, Math.min(2.2, panel.clientWidth / 420)); if (Math.abs(f - rzF) > 0.01) { rzF = f; panel.style.setProperty('--rz', String(f)); } }); o.observe(panel); return o; } catch (e) { return null; } })();
  const LS_SIZE = 'cc-route-panel-size';
  function applySize() {
    try {
      const z = JSON.parse(localStorage.getItem(LS_SIZE) || 'null');
      if (z && z.w) { panel.style.width = Math.max(120, Math.min(innerWidth - 20, z.w)) + 'px'; }
      if (z && z.h) { panel.style.height = Math.max(80, Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - 20, z.h)) + 'px'; panel.style.maxHeight = 'none'; }
    } catch (e) {}
  }
  function addGrip() {
    const g = h('div', 'rt-grip'); g.title = 'Drag to resize \u00b7 double-click to reset';
    g.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation(); moving = true;
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, sc = (r.width / (panel.offsetWidth || 1)) || 1;   // the panel is scaled with the window: CSS size = screen size / scale
      const move = ev => {
        panel.style.width = Math.max(120, Math.min(innerWidth - r.left - 4, r.width + ev.clientX - sx) / sc) + 'px';
        panel.style.height = Math.max(80, Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - r.top - 4, r.height + ev.clientY - sy) / sc) + 'px';
        panel.style.maxHeight = 'none';
        placeExtras();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); moving = false; placeExtras();
        const b = panel.getBoundingClientRect();
        try { localStorage.setItem(LS_SIZE, JSON.stringify({ w: Math.round(panel.offsetWidth), h: Math.round(panel.offsetHeight) })); } catch (err) {}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', e => { e.stopPropagation(); try { localStorage.removeItem(LS_SIZE); } catch (err) {} panel.style.width = ''; panel.style.height = ''; panel.style.maxHeight = ''; placeExtras(); });
    panel.appendChild(g);
  }
  function restorePos() {
    applySize();
    if (!panel.querySelector('.rt-grip')) addGrip();
    try { const p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); if (p) { panel.style.left = Math.min(innerWidth - 60, Math.max(0, p.x)) + 'px'; panel.style.top = Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - 40, Math.max(0, p.y)) + 'px'; } } catch (e) {}
  }
  function wireDrag(bar) {
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation(); moving = true;
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      // Clamp: at least 80 px x 30 px of the panel always stays on screen.
      const move = ev => {
        panel.style.left = Math.max(80 - r.width, Math.min(innerWidth - 80, r.left + ev.clientX - sx)) + 'px';
        panel.style.top = Math.max(0, Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - 30, r.top + ev.clientY - sy)) + 'px';
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
  // A potion starting or ending (or a level-up) changes every walking time: plan again at once instead of waiting for the queue to settle. The bridge keeps
  // the subscription across a re-attach, so one is enough.
  let offSpeed = null;
  function watchSpeed() { if (offSpeed) return; const b = window.__ccBridge; if (b && b.onChange) offSpeed = b.onChange('speed', () => { lastSig = ''; }); }
  function tick() {
    try {
      watchSpeed();
      if (!settingOn('routeAdvisorEnabled', true)) { panel.hidden = true; alertEl.hidden = true; return; }
      if (dataState === 'idle') loadData();
      if (!xpTbl) loadXpTbl();
      if (dataState === 'ready') {
        const s = signature();
        // The queue has to hold still before it is judged: while you drag tasks around the game's queue passes through half-finished states, and the advice
        // for such a state ("swap them back") is for a queue that is about to be gone. The old advice is replaced by "Calculating..." until the queue has
        // been the same for SETTLE_MS; a recalculation you asked for (lastSig cleared) runs at once.
        if (s !== lastSig) {
          const now = performance.now();
          if (lastSig === '' || !result) { lastSig = s; pendSig = s; scheduleCompute(); }
          else if (s !== pendSig) { pendSig = s; pendAt = now; if (!settling) { settling = true; render(); } }
          else if (now - pendAt >= SETTLE_MS) { lastSig = s; settling = false; scheduleCompute(); }
        } else if (settling) { settling = false; pendSig = s; render(); }
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
    calcRun++; if (offSpeed) offSpeed(); life.dispose(); solver.dispose(); clearTimeout(timerId); clearTimeout(computeTimer); try { if (rzObs) rzObs.disconnect(); } catch (e) { /* gone */ }
    hideVTip(); panel.remove(); handle.remove(); alertEl.remove(); drawer.remove(); mapTab.remove(); style.remove(); clearHl();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc route-advisor torn down';
  }
  window[NS] = {
    get threaded() { return solver.threaded; },   // true while the search runs on its background thread
    version: 1, teardown, core,
    get result() { return result; },
    recompute() { lastSig = ''; tick(); },
    // read-only diagnostics: the last suggestions with the reasons they changed, the last optimiser input, and a self-check of the search on it
    get log() { return trace.slice(); },
    get lastInput() { try { return JSON.parse(JSON.stringify(lastInput)); } catch (e) { return null; } },
    selfCheck(maxBrute) { return lastInput ? core.selfCheck(JSON.parse(JSON.stringify(lastInput)), maxBrute) : null; },
    setTpPref(k) { tpPref = k === 'foot' ? 'foot' : k === 'max' ? 'max' : 'eff'; try { localStorage.setItem('cc-route-tp-pref', tpPref); } catch (e) {} lastSig = ''; },
    open() { userOpen = true; render(); },
    get isOpen() { return !panel.hidden; },
    // The order the shown path recommends: slot -> { pos: recommended place, from: place now, node: the recommended option's place }. Null when your own queue is shown.
    recommended() {
      try {
        const k = selKey(); if (!k || k === 'cur' || !result) return null;
        const c = planFor(k); if (!c || !c.plan) return null;
        return c.plan.map((p, i) => { const row = result.rows[p.row]; return { key: rowKey(row), nth: rowNth(row), pos: i + 1, from: p.row + 1, node: row.opts[p.opt].node }; });
      } catch (e) { return null; }
    },
    attachMode, widget: () => alertEl, toCard: alertToCard, park: parkAlert,
    toggle() { if (!panel.hidden) { userOpen = false; if (document.body.classList.contains('map-active')) userClosedOnMap = true; } else { userOpen = true; userClosedOnMap = false; } render(); },
    get state() { return { data: dataState, polys: polyState }; },
  };
  console.log('[cc] route-advisor loaded');
  return 'cc route-advisor loaded';
})();
