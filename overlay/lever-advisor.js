// ScapeLite Lever Advisor. Display only: it never clicks a lever, it only outlines the buttons you should press.
// Opens next to the game's Skills Customization window (the total page with the skill weights, and the Slay page with the mob weights).
// Pick a route in the panel; the levers worth pulling get a YELLOW outline (and a "x2" style badge when more than one step), levers that
// are costing you more than they give get an ORANGE outline on their "-" button. Credits are respected: it only suggests what you can pay
// for, counting the refund of any lever you lower.
//
// Model. A lever at position p multiplies how likely that skill / mob is by 1.25^p. For a stream of tasks the average payoff is
//   R = sum(w_i * x_i) / sum(w_i * t_i)       (w = 1.25^p, x = what a task is worth, t = how long it takes)
// A step from p to p+d costs K * (2^|p+d| - 2^|p|) credits (K = 25 total skill levers, 5 mob levers); negative = refund.
// The advisor greedily takes the step with the best gain per credit until the credits run out or nothing improves R.
// Slay page: the advice can be computed for ANY slayer master (picker in the drawer), not just the one the game has selected. The mob weights are one
// list for all masters; a master only decides which of the mobs it can roll. Highlights are drawn only when the picked master is the game's own.
(function () {
  'use strict';
  const NS = '__ccLeverAdvisor';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS_ROUTE = 'cc-lever-route', LS_POS = 'cc-lever-pos';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('leverAdvisorEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.mobValues ? b : null; };
  const LS_MASTER = 'cc-lever-master', LS_FOCUS = 'cc-lever-focus';
  const HUNT_ROUTES = ['boost', 'coll', 'balanced'];   // routes with a Focus control ("balanced" starts on Spread)
  const focusOn = () => setting('leverAdvisorFocus', true) !== false;
  const focusK = (route) => {
    if (!focusOn() || !HUNT_ROUTES.includes(route)) return 0;
    let v = null; try { v = localStorage.getItem(LS_FOCUS + '-' + route); } catch (e) {}
    if (v == null) v = route === 'balanced' ? '0' : '2';
    return v === '1' ? 1 : v === '2' ? 2 : 0;
  };
  const pAny = (list) => 1 - (list || []).reduce((t, d) => t * (1 - 1 / d.oneIn), 1);   // chance that a kill drops at least one of them
  // Walking between mobs: path steps from the game (memoised, the map does not change); the time is steps / your real walking speed (game bridge speed()).
  const DIST = new Map();
  const walkSps = () => { try { const b = bridge(), s = b && b.speed ? b.speed() : null; return s ? s.sps : 0; } catch (e) { return 0; } };   // 0 = unknown: no walking term
  function dist(a, b) {
    if (!a || !b || a === b) return 0;
    const k = a < b ? a + '|' + b : b + '|' + a; if (DIST.has(k)) return DIST.get(k);
    let d = null; try { const br = bridge(); d = br && br.dist ? br.dist(a, b) : null; } catch (e) {}
    if (d != null && isFinite(d)) DIST.set(k, d); else d = null;
    return d;
  }
  const pickOn = () => setting('leverAdvisorMasterPick', true) !== false;
  // The master the advice is for: the one picked in the drawer, else the one the game has selected. other = it is not the game's.
  function chosenMaster() {
    const b = bridge(), ms = b && b.slayMasters ? b.slayMasters() : null; if (!ms || !ms.masters.length) return null;
    let id = null; try { id = localStorage.getItem(LS_MASTER); } catch (e) {}
    const cur = ms.masters.find((m) => m.current) || null;
    let m = pickOn() && id ? ms.masters.find((x) => x.id === id) : null; if (!m) m = cur || ms.masters[0];
    return { ms, m, cur, other: !!(cur && m.id !== cur.id) };
  }

  // ------------------------------------------------------------------ styles
  const style = document.createElement('style');
  style.id = 'cc-lever-style';
  style.textContent = `
.cc-lv-pull{outline:3px solid var(--cc-accent) !important;outline-offset:1px;box-shadow:0 0 12px 3px rgba(255,210,74,.75) !important;position:relative;z-index:2;animation:ccLvPulse 1.6s ease-in-out infinite}
.cc-lv-release{outline:3px solid var(--cc-bad) !important;outline-offset:1px;box-shadow:0 0 10px 2px rgba(255,138,92,.6) !important;position:relative;z-index:2}
.cc-lv-pull::after,.cc-lv-release::after{content:attr(data-cc-n);position:absolute;right:-6px;top:-10px;padding:1px 6px;border-radius:9px;background:var(--cc-accent);color:var(--cc-accent-ink);font:700 15px/1.2 system-ui,sans-serif;pointer-events:none}
.cc-lv-release::after{background:var(--cc-bad);color:#2a0f00}
@keyframes ccLvPulse{50%{box-shadow:0 0 18px 6px rgba(255,210,74,.95)}}
@media (prefers-reduced-motion:reduce){.cc-lv-pull{animation:none}}
#cc-lever-drawer select{width:100%;box-sizing:border-box;background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:6px 8px;font:inherit}
#cc-lever-drawer select.master{margin-bottom:4px}
#cc-lever-drawer select.focus{margin-top:4px}
#cc-lever-drawer .it.foc{background:rgba(255,210,74,.12);cursor:default}
#cc-lever-drawer .it.foc .s{color:var(--cc-accent);font-weight:700}
#cc-lever-drawer .minfo{margin-bottom:6px}
#cc-lever-drawer .minfo b{color:var(--cc-accent)}
#cc-lever-drawer .minfo .warn{color:var(--cc-bad)}
#cc-lever-drawer label.hl{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--cc-text);font-size:13.5px}
#cc-lever-drawer label.hl input{accent-color:var(--cc-accent);width:15px;height:15px;margin:0}
#cc-lever-drawer .sum{color:var(--cc-text-dim);font-size:14.5px}
#cc-lever-drawer .sum b{color:var(--cc-accent)}
#cc-lever-drawer .list{display:flex;flex-direction:column;gap:3px}
#cc-lever-drawer .it{display:flex;gap:8px;align-items:baseline;padding:3px 6px;border-radius:6px;background:rgba(255,255,255,.04);cursor:pointer}
#cc-lever-drawer .it:hover{background:rgba(255,255,255,.09)}
#cc-lever-drawer .it .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cc-lever-drawer .it .c{color:var(--cc-text-dim);font-size:13.5px;white-space:nowrap}
#cc-lever-drawer .it.pull .s{color:var(--cc-accent);font-weight:700}
#cc-lever-drawer .it.rel .s{color:var(--cc-bad);font-weight:700}
#cc-lever-drawer details.why{color:var(--cc-text-dim);font-size:13px}
#cc-lever-drawer details.why summary{cursor:pointer;color:var(--cc-accent)}
#cc-lever-drawer .whyb{overflow-x:auto}
#cc-lever-drawer .whyb table{width:100%;border-collapse:collapse;margin-top:6px}
#cc-lever-drawer .whyb td,#cc-lever-drawer .whyb th{padding:2px 5px;text-align:left;font-weight:400;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap}
#cc-lever-drawer .whyb th{color:var(--cc-text-dim);font-size:12px}
#cc-lever-drawer .whyb td.r{text-align:right}
#cc-lever-drawer .gtab{margin-bottom:8px}
#cc-lever-drawer .gtab .gb{display:inline-block;height:8px;border-radius:3px;vertical-align:middle}
#cc-lever-drawer .gtab .up{color:#6fdc8c}#cc-lever-drawer .gtab .dn{color:var(--cc-bad)}#cc-lever-drawer .gtab .ne{color:var(--cc-text-dim)}
#cc-lever-drawer .gtab tr.tot td{font-weight:700;border-top:1px solid rgba(255,255,255,.25)}
#cc-lever-drawer .note{color:var(--cc-text-dim);font-size:13px}
`;
  document.head.appendChild(style);

  const UI = window.__ccUI;
  if (!UI) return 'cc lever-advisor: UI kit not loaded';
  // window chrome (header, drag, collapse, position memory) comes from the UI kit; the content is built below as before
  // The advisor lives in a drawer INSIDE the Skills Customization window (a floating panel there was drawn under the window's own layer and cut away): a tab on the window's right edge folds it.
  const P = UI.windowDrawer({ id: 'cc-lever-drawer', title: 'Lever Advisor', width: 430, open: true });
  const LS_HL = 'cc-lever-hl';
  const hlOn = () => { try { return localStorage.getItem(LS_HL) !== '0'; } catch (e) { return true; } };
  P.body.innerHTML = '<label class="hl"><input type="checkbox" class="hlt"><span>Highlight the levers to change in the window</span></label><select class="master" title="Slayer master the advice is for"></select><div class="minfo note"></div><select class="route"></select><select class="focus" title="How many mobs to aim your credits at"></select><div class="sum"></div><div class="list"></div><details class="why"><summary>Why these picks?</summary><div class="whyb"></div></details><div class="note"></div>';
  const panel = P.el;
  const q = (s) => panel.querySelector(s);
  ['keydown', 'keyup', 'keypress'].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation()));

  // ------------------------------------------------------------------ reading the lever window
  const tabEl = () => { const t = document.querySelector('#tab-skillcustom.active'); return t && t.getClientRects().length ? t : null; };
  const pFrom = (tip) => { const m = /\((-?\d+)\s*→\s*(-?\d+)\)/.exec(tip || ''); return m ? { from: +m[1], to: +m[2] } : null; };
  const credits = (T) => { const e = T.querySelector('.cred-amount'); const m = e && /(\d+)\s*\/\s*(\d+)/.exec(e.textContent); return m ? +m[1] : 0; };
  const pageOf = (T) => {
    const ct = T.querySelector('#activities-column .column-title');
    if (ct) return /Mobs/i.test(ct.textContent) ? 'slay' : 'skill';
    return T.querySelector('.skill-weight-row') ? 'total' : 'other';
  };

  // rows: [{ id, name, p, plus, minus, x, t }]
  function readTotal(T, route) {
    const rows = [];
    T.querySelectorAll('.skill-weight-row').forEach((r) => {
      const plus = r.querySelector('.ctrl-btn[data-dir="1"]'), minus = r.querySelector('.ctrl-btn[data-dir="-1"]');
      if (!plus || !minus) return;
      const sk = plus.dataset.skill, pp = pFrom(plus.dataset.tipAction);
      if (!sk || !pp || /^(luck|quest|quests)$/i.test(sk) || /Lucky chance|Quest/i.test(plus.dataset.tipEffect || '')) return; // not task-likelihood weights
      const lv =parseInt((r.querySelector('[class*=level]') || r).textContent.replace(/[^\d]/g, ''), 10) || 1;
      rows.push({ id: sk, name: (r.querySelector('[class*=name]') || { textContent: sk }).textContent.trim() || sk, p: pp.from, plus, minus, lv });
    });
    const valueOf = routeSkillValue(route, rows);
    rows.forEach((r) => { r.x = valueOf(r); r.t = 1; });
    return { rows, K: 25, label: 'skills', unit: 'weighted value per task' };
  }

  // One skill's page: the activities (which task of that skill is rolled). Valued by the game's own XP-per-hour projection at your levels.
  function readSkill(T, route) {
    const b = bridge(); if (!b || !b.activityValue) return null;
    const nav = T.querySelector('.skill-custom-nav-icon.active');
    const skill = nav && nav.dataset.navSkill; if (!skill) return null;
    const rows = [];
    T.querySelectorAll('#activities-column .activity-row').forEach((r) => {
      const id = r.dataset.actId, w = r.querySelector('.ctrl-btn[data-type="weight"][data-dir="1"]'), wm = r.querySelector('.ctrl-btn[data-type="weight"][data-dir="-1"]');
      if (!id || !w || !wm) return;
      const lvEl = r.querySelector('.activity-level');
      if (lvEl && !lvEl.classList.contains('has')) return; // not unlocked yet: it cannot be rolled
      const pp = pFrom(w.dataset.tipAction); if (!pp) return;
      const v = b.activityValue(skill, id); if (!v) return;
      const f = route === 'coll' ? (v.newCollection ? 3 : 0.8) : 1;
      rows.push({ id, name: (r.querySelector('.activity-name') || { textContent: id }).textContent.trim(), p: pp.from, plus: w, minus: wm, x: v.x * f, t: v.t });
    });
    return { rows, K: 5, label: 'tasks', skill };
  }

  // Risk tiers of the "easy kills" route, worst of: food per hour (foods of the best kind you hold, else 12 HP ones) and the worst single hit as a share of max HP.
  // Tiers rank strictly (each is worth 1/50 of the one above in the optimiser, more than the spread of XP per hour inside a tier).
  const EASY_TIERS = [{ n: 'A', t: 'no food, no risk', f: 2, r: 0.15, k: 1 }, { n: 'B', t: 'little food', f: 10, r: 0.3, k: 0.02 }, { n: 'C', t: 'a lot of food', f: 40, r: 0.5, k: 0.0004 }, { n: 'D', t: 'dangerous', f: Infinity, r: Infinity, k: 0.00001 }];
  function easyTier(rk, food) {
    if (!rk) return EASY_TIERS[3];
    const foodHr = food > 0 ? rk.hpHr / food : rk.foodHr || 0;
    return EASY_TIERS.find((t) => foodHr <= t.f && rk.risk <= t.r) || EASY_TIERS[3];
  }
  function readSlay(T, route) {
    const b = bridge(), mv = b && b.mobValues();
    if (!mv) return null;
    const cm = chosenMaster(); if (!cm) return null;
    const rows = [];
    const hunt = b.huntInfo ? b.huntInfo() : null, pool = new Set(cm.m.ids), rk = b.mobRisk ? b.mobRisk() : null, heal = rk && rk.food ? rk.food.heal : 12;
    T.querySelectorAll('#activities-column .activity-row').forEach((r) => {
      const id = r.dataset.actId, w = r.querySelector('.ctrl-btn[data-type="weight"][data-dir="1"]'), wm = r.querySelector('.ctrl-btn[data-type="weight"][data-dir="-1"]');
      const info = mv[id];
      if (!id || !w || !wm || !info) return;
      if (!pool.has(id)) return;   // not rolled by this master
      const lvEl = r.querySelector('.activity-level');
      if (lvEl && !lvEl.classList.contains('has')) return; // locked (slay level too low): it cannot be rolled
      const pp = pFrom(w.dataset.tipAction); if (!pp) return;
      const qr = (r.querySelector('.activity-qty-range') || { textContent: '' }).textContent.match(/(d+)D+(d+)/);
      const kills = qr ? (+qr[1] + +qr[2]) / 2 : 70;
      const sec = info.sec * kills;
      const qb = r.querySelector('.ctrl-btn[data-type="qty"][data-dir="1"]'), qpp = qb && pFrom(qb.dataset.tipAction);
      const risk = rk && rk.mobs[id] || null, tier = easyTier(risk, heal), hi = hunt && hunt[id] || null, pB = pAny(hi && hi.boost), pC = pAny(hi && hi.coll);
      rows.push({ id, qplus: qb || null, q0: qpp ? qpp.from : 0, name: info.name || (r.querySelector('.activity-name') || { textContent: id }).textContent, p: pp.from, plus: w, minus: wm, xp: info.xpKill * kills, cxp: (info.combatXp || 0) * kills, sec, boost: info.boost, coll: info.collMissing,
        risk, tier, kills, node: hi && hi.node, pB, pC, pDrop: route === 'coll' ? pC : pB, dropNames: hi ? (route === 'coll' ? hi.coll : hi.boost).map((d) => d.name) : [], perKill: info.combatXp || 0, fightSec: info.fightSec || 0, respSec: info.respSec || 0 });
    });
    const f = routeMobFactor(route);
    rows.forEach((r) => { r.x = (route === 'easy' ? r.cxp : r.xp) * f(r); r.t = r.sec; });
    return { rows, K: 5, label: 'mobs', unit: 'XP per hour', master: cm.m, route, wm: cm.m.chaos ? 2 : 1, other: cm.other, cm, risk: rk };
  }

  // ------------------------------------------------------------------ routes
  const SKILL_ROUTES = [['mine', 'My skill priorities (Route Advisor)'], ['melee', 'Melee gear first (Smith, Mine, Cook, Vigor)'], ['ranged', 'Ranged gear first'], ['magic', 'Magic gear first'], ['vigor', 'Vigor first'], ['even', 'Even progress (lowest levels first)'], ['flat', 'Neutral (no preference)']];
  const SKILL_PAGE_ROUTES = [['xp', 'Best XP per hour'], ['coll', 'Hunt new collection entries (book icon)']];
  const SLAY_ROUTES =[['easy', 'Easy kills for combat levels: least food and risk first'], ['balanced', 'Balanced: best XP per hour, XP-boost drops count extra'], ['xp', 'Best XP per hour only'], ['boost', 'Hunt XP-boost drops'], ['coll', 'Hunt unfinished collections']];
  const PROFILE = { melee: 'Melee gear first', ranged: 'Ranged gear first', magic: 'Magic gear first', vigor: 'Vigor focus' };
  function routeSkillValue(route, rows) {
    const ps = window.__ccPluginSettings;
    let pr = {};
    try {
      if (route === 'mine') { const v = ps.get('routePriorities'); pr = v && typeof v === 'object' ? v : {}; }
      else if (PROFILE[route] && ps.prioProfiles) pr = ps.prioProfiles[PROFILE[route]] || {};
    } catch (e) { pr = {}; }
    const maxLv = Math.max.apply(null, rows.map((r) => r.lv).concat([1]));
    const base = (id) => { const v = pr[id]; return v != null ? Number(v) : 1; };
    // Gathering skills (they make the raw materials) against processing skills (they use them): the same ratio the Route Advisor uses
    // (Settings > Route Advisor > Gathering vs Processing). 1 = every skill is worth exactly its priority; there is no hidden extra for raw-material skills.
    const GATHER = ['mine', 'fish', 'forage', 'farm', 'invoke'];
    let ratio = 1; try { const v = Number(ps.get('routeGatherRatio')); if (Number.isFinite(v) && v > 0) ratio = Math.min(5, Math.max(0.1, v)); } catch (e) { ratio = 1; }
    return (r) => {
      if (route === 'flat') return 1;
      if (route === 'even') return 1 + (maxLv - r.lv) / 12;
      return base(r.id) * (GATHER.includes(r.id) ? ratio : 1);
    };
  }
  function routeMobFactor(route) {
    const boost = Math.max(1, Number(setting('routeDropBoost', 1.3)) || 1.3);
    return (r) => {
      if (route === 'xp') return 1;
      if (route === 'easy') return r.tier.k;   // combat XP only, weighted by the risk tier
      if (route === 'boost') return r.boost > 0 ? 4 : 0.6;
      if (route === 'coll') return r.coll > 0 ? 2.5 : 0.8;
      return r.boost > 0 ? boost : 1; // balanced
    };
  }

  // Focus: aim the credits at one or two mobs instead of spreading them. A target is a mob that can still give the drop the route hunts (an XP-boost unlock, or a
  // missing collection entry). Candidates = the 6 with the most drops per hour of killing (drop chance per kill / (kill seconds + respawn)). Every set of k candidates is
  // run through the same optimiser with a payoff of "drops per task" for the targets and 0 for all other mobs (so the plan raises the targets and lowers the rest, refunds
  // included) and is scored by drops per second INCLUDING walking: sum of odds_i * odds_j * path steps(i, j) / your walking speed per task. A far-apart pair loses to a
  // close one. Without position data the walking term is 0 (value only). Display only.
  function applyFocus(data, route, cr) {
    const k = focusK(route); if (!k) return null;
    const rows = data.rows, cyc = (r) => (r.fightSec + r.respSec) > 0 ? r.fightSec + r.respSec : (r.kills > 0 ? r.sec / r.kills : 1);
    const cand = rows.filter((r) => r.pDrop > 0).sort((a, b) => b.pDrop / cyc(b) - a.pDrop / cyc(a)).slice(0, 6);
    if (!cand.length) { rows.forEach((r) => { r.focus = false; }); return { k, ids: [], none: true }; }
    const isHunt = route !== 'balanced', base = rows.map((r) => r.x), wm = data.wm || 1, sps = walkSps();
    const setX = (S) => rows.forEach((r, i) => { const inS = S.includes(r); r.focus = inS; r.x = isHunt ? (inS ? r.kills * r.pDrop : 0) : (inS ? base[i] * 3 : base[i]); });
    const evalS = (S) => {
      setX(S);
      const res = optimise(rows, data.K, cr, wm), w = res.pos.map((p) => Math.pow(1.25, p * wm)), tot = w.reduce((a, b) => a + b, 0), q = w.map((x) => x / tot);
      let num = 0, den = 0, walk = 0;
      rows.forEach((r, i) => { num += q[i] * r.x; den += q[i] * r.t; });
      rows.forEach((a, i) => rows.forEach((b, j) => { if (i < j) { const d = dist(a.node, b.node); if (d && sps > 0) walk += 2 * q[i] * q[j] * d / sps; } }));
      return { S, R: num / (den + walk), walk };
    };
    const sets = [];
    if (k === 1 || cand.length === 1) cand.forEach((c) => sets.push([c]));
    else for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) sets.push([cand[i], cand[j]]);
    let best = null; sets.forEach((S) => { const e = evalS(S); if (!best || e.R > best.R) best = e; });
    setX(best.S);
    return { k, ids: best.S.map((r) => r.id), S: best.S, walk: best.walk, pairDist: best.S.length === 2 ? dist(best.S[0].node, best.S[1].node) : null, cand: cand.length, speed: sps };
  }

  // ------------------------------------------------------------------ the optimiser
  let WM = 1;   // exponent multiplier: the Chaos master doubles the effect of every mob lever
  const W = (p) => Math.pow(1.25, p * WM);
  const T = (K, p) => K * (Math.pow(2, Math.abs(p)) - 1);
  function optimise(rows, K, budget, wm) {
    WM = wm || 1;
    const cur = rows.map((r) => r.p);
    const stat = (pos) => { let S = 0, D = 0; rows.forEach((r, i) => { const w = W(pos[i]); S += w * r.x; D += w * r.t; }); return D > 0 ? S / D : 0; };
    const r0 = stat(cur);
    // Greedy: keep taking the step with the best gain per credit while it is worth at least `minFrac` of the current payoff.
    const greedy = (pos, left, minFrac) => {
      let S = 0, D = 0; rows.forEach((r, i) => { const w = W(pos[i]); S += w * r.x; D += w * r.t; });
      for (let it = 0; it < 600; it++) {
        const cu = D > 0 ? S / D : 0; let best = null;
        rows.forEach((r, i) => [1, -1].forEach((d) => {
          const np = pos[i] + d; if (np < -5 || np > 5) return;
          const cost = T(K, np) - T(K, pos[i]); if (cost > left + 1e-9) return;
          const dw = W(np) - W(pos[i]), nr = (S + dw * r.x) / (D + dw * r.t), gain = nr - cu;
          if (gain <= cu * minFrac) return;
          const score = cost <= 0 ? 1e6 + gain / cu : (gain / cu) / Math.max(cost, 1e-9);
          if (!best || score > best.score) best = { i, np, cost, dw, score };
        }));
        if (!best) break;
        S += best.dw * rows[best.i].x; D += best.dw * rows[best.i].t; pos[best.i] = best.np; left -= best.cost;
      }
      return { pos, left };
    };
    // Coordinate ascent: try every position of every lever on its own and keep any change that raises the payoff (fixes greedy's order effects).
    const polish = (pos, left) => {
      for (let sweep = 0; sweep < 12; sweep++) {
        let moved = false;
        rows.forEach((r, i) => {
          let bp = pos[i], bl = left, br = stat(pos);
          for (let np = -5; np <= 5; np++) {
            if (np === pos[i]) continue;
            const cost = T(K, np) - T(K, pos[i]); if (cost > left + 1e-9) continue;
            const old = pos[i]; pos[i] = np; const nr = stat(pos); pos[i] = old;
            if (nr > br * (1 + 1e-6)) { br = nr; bp = np; bl = left - cost; }
          }
          if (bp !== pos[i]) { pos[i] = bp; left = bl; moved = true; }
        });
        if (!moved) break;
      }
      return { pos, left };
    };
    // The whole pool of credits (what is free now plus what the levers cost at the moment) is spent again from scratch, so the advice does
    // not depend on where the levers happen to be: remove every point and you get the same plan back.
    const pool = budget + cur.reduce((a, p) => a + T(K, p), 0);
    let sol = greedy(rows.map(() => 0), pool, 0.006);
    sol = greedy(sol.pos, sol.left, 1e-5); sol = polish(sol.pos, sol.left); sol = greedy(sol.pos, sol.left, 1e-5);
    let pos, left;
    if (stat(sol.pos) > r0 * 1.003) { pos = sol.pos; left = sol.left; }     // clearly better than now: take the fresh plan
    else { const g = greedy(cur.slice(), budget, 1e-5); pos = g.pos; left = g.left; }   // about as good: leave the levers, only spend what is left
    // Phase 3, last resort: when no weight step helps any more, make the tasks you DO get on the best mobs bigger (quantity levers).
    const qd = rows.map(() => 0);
    if (rows.some((r) => r.qplus)) {
      const order = rows.map((r, i) => i).filter((i) => rows[i].qplus && rows[i].t > 0).sort((a, b) => rows[b].x / rows[b].t - rows[a].x / rows[a].t);
      const want = order.slice(0, Math.max(1, Math.ceil(order.length / 4)));   // the top quarter by payoff per hour
      for (let guard = 0; guard < 60 && left > 0 && want.length; guard++) {
        let moved = false;
        for (const i of want) {
          const q0 = rows[i].q0 + qd[i], qn = q0 + 1; if (qn > 5) continue;
          const cost = T(K, qn) - T(K, q0);
          if (cost <= left + 1e-9) { qd[i]++; left -= cost; moved = true; }
        }
        if (!moved) break;
      }
    }
    return { pos, qd, left, r0, r1: stat(pos), spent: budget - left };
  }

  // ------------------------------------------------------------------ render
  let lastKey = '', lastOut = null, marks = [], dbg = null, lastOther = false;
  function applyMarks(Tb, page) {
    if (!hlOn() || (page === 'slay' && lastOther)) { clearMarks(); return; }   // other master picked: the game's lever window is for another master, nothing is outlined
    marks.forEach((m) => {
      const sel = page === 'total' ? '.ctrl-btn[data-skill="' + m.id + '"][data-dir="' + m.dir + '"]' : '#activities-column .activity-row[data-act-id="' + m.id + '"] .ctrl-btn[data-type="' + (m.type || 'weight') + '"][data-dir="' + m.dir + '"]';
      const b = Tb.querySelector(sel); if (!b) return;
      const cls = m.dir > 0 ? 'cc-lv-pull' : 'cc-lv-release';
      if (!b.classList.contains(cls)) { b.classList.add(cls); b.setAttribute('data-cc-n', m.n); }
    });
  }
  const clearMarks = () => document.querySelectorAll('.cc-lv-pull,.cc-lv-release').forEach((e) => { e.classList.remove('cc-lv-pull', 'cc-lv-release'); e.removeAttribute('data-cc-n'); });
  function routeFor(page) {
    const list = page === 'slay' ? SLAY_ROUTES : page === 'skill' ? SKILL_PAGE_ROUTES : SKILL_ROUTES;
    let cur = null; try { cur = localStorage.getItem(LS_ROUTE + '-' + page); } catch (e) {}
    return list.some((r) => r[0] === cur) ? cur : list[0][0];
  }
  function setRoute(page, v) { try { localStorage.setItem(LS_ROUTE + '-' + page, v); } catch (e) {} lastKey = ''; }

  function render() {
    const Tb = on() ? tabEl() : null;
    P.attach();
    if (!Tb) { P.show(false); curView = null; viewSince = 0; if (lastKey) { clearMarks(); lastKey = ''; } return; }
    const page = pageOf(Tb);
    if (page !== 'skill') { curView = null; viewSince = 0; }
    if (page === 'other') {
      P.show(true); lastKey = '';
      clearMarks();
      q('.route').style.display = 'none'; q('.focus').style.display = 'none'; q('.master').style.display = 'none'; q('.minfo').textContent = ''; q('.sum').textContent = ''; q('.list').textContent = '';
      q('.note').textContent = 'Open the Skills page (skill weights) or the Slay page (mob weights): the advisor works on those. Single-skill pages show the activity weights too.';
      return;
    }
    q('.route').style.display = '';
    const route = routeFor(page);
    const showM = page === 'slay' && pickOn();
    q('.master').style.display = showM ? '' : 'none'; if (!showM) q('.minfo').textContent = '';
    const fsel = q('.focus'), showF = page === 'slay' && focusOn() && HUNT_ROUTES.includes(route);
    fsel.style.display = showF ? '' : 'none';
    if (showF) {
      if (!fsel.options.length) { [['1', 'Focus: one mob'], ['2', 'Focus: two mobs'], ['0', 'Spread over all mobs']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; fsel.appendChild(o); }); fsel.onchange = () => { try { localStorage.setItem(LS_FOCUS + '-' + (fsel.dataset.route || ''), fsel.value); } catch (e) {} lastKey = ''; render(); }; }
      fsel.dataset.route = route; const want = String(focusK(route)); if (fsel.value !== want) fsel.value = want;
    }
    // the route select
    const sel = q('.route'), list = page === 'slay' ? SLAY_ROUTES : page === 'skill' ? SKILL_PAGE_ROUTES : SKILL_ROUTES;
    if (sel.dataset.page !== page) { sel.textContent = ''; list.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }); sel.dataset.page = page; sel.onchange = () => setRoute(page, sel.value); }
    if (sel.value !== route) sel.value = route;
    P.show(true);
    if (page === 'slay') renderMaster();
    const data = page === 'slay' ? readSlay(Tb, route) : page === 'skill' ? readSkill(Tb, route) : readTotal(Tb, route);
    if (!data || !data.rows.length) { q('.sum').textContent = page === 'slay' && data && !data.rows.length ? 'None of the mobs of this master are open to you yet (Slay level or requirements).' : 'Waiting for the game data…'; q('.list').textContent = ''; q('.note').textContent = ''; clearMarks(); marks = []; lastKey = ''; return; }
    const cr = credits(Tb);
    lastOther = page === 'slay' && !!data.other;
    const key = [page, route, cr, data.master ? data.master.id : '', focusK(route), Math.round(data.rows.reduce((t, r) => t + r.x, 0)), (() => { try { return window.__ccPluginSettings.get('routeGatherRatio') + JSON.stringify(window.__ccPluginSettings.get('routePriorities')); } catch (e) { return ''; } })(), data.rows.map((r) => r.id + ':' + r.p).join(',')].join('|');
    if (key === lastKey) { applyMarks(Tb, page); seenTick(); return; } // the game rebuilds these rows often: keep the outlines on the new buttons
    lastKey = key;
    data.focus = page === 'slay' ? applyFocus(data, route, cr) : null;
    const res = optimise(data.rows, data.K, cr, data.wm);
    dbg = { focus: data.focus && { ids: data.focus.ids, walk: data.focus.walk, pairDist: data.focus.pairDist }, page, route, master: data.master && data.master.id, other: !!data.other, cr, K: data.K, rows: data.rows.map((r, i) => ({ id: r.id, name: r.name, p: r.p, to: res.pos[i], x: Math.round(r.x), t: Math.round(r.t), rate: r.t ? Math.round(r.x / r.t * 3600) : null, boost: r.boost, coll: r.coll, lv: r.lv })), r0: res.r0, r1: res.r1 };
    clearMarks(); marks = [];
    const pulls = [], rels = [];
    data.rows.forEach((r, i) => {
      const d = res.pos[i] - r.p; if (!d) return;
      marks.push({ id: r.id, dir: d > 0 ? 1 : -1, n: (d > 0 ? '+' : '−') + Math.abs(d) });
      const cost = data.K * (Math.pow(2, Math.abs(res.pos[i])) - Math.pow(2, Math.abs(r.p)));
      (d > 0 ? pulls : rels).push({ r, d, cost, to: res.pos[i] });
    });
    data.rows.forEach((r, i) => { const k = res.qd ? res.qd[i] : 0; if (!k) return; marks.push({ id: r.id, dir: 1, type: 'qty', n: 'Q+' + k }); pulls.push({ r, d: k, cost: data.K * (Math.pow(2, Math.abs(r.q0 + k)) - Math.pow(2, Math.abs(r.q0))), to: r.q0 + k, qty: true }); });
    const gain = res.r0 > 0 ? (res.r1 / res.r0 - 1) * 100 : 0;
    const sum = q('.sum');
    sum.textContent = '';
    if (!pulls.length && !rels.length) {
      sum.innerHTML = 'Nothing to change for this route with <b>' + cr + '</b> credits. Your levers are already as good as they can be.';
    } else {
      sum.innerHTML = 'Credits <b>' + cr + '</b> → <b>' + Math.round(res.left) + '</b> left. Expected payoff of the ' + data.label + ' you roll: <b>' + (gain >= 0 ? '+' : '') + gain.toFixed(1) + '%</b>.';
    }
    renderWhy(data, res, page);
    P.setBadge(pulls.length + rels.length);
    P.setChip(pulls.length || rels.length ? pulls.length + ' to raise' + (rels.length ? ', ' + rels.length + ' to lower' : '') + ' · ' + (gain >= 0 ? '+' : '') + gain.toFixed(1) + '%' : 'already best');
    const ul = q('.list'); ul.textContent = '';
    if (data.focus && data.focus.ids.length) {
      const it = document.createElement('div'); it.className = 'it foc';
      const s0 = document.createElement('span'); s0.className = 's'; s0.textContent = 'Focus';
      const n0 = document.createElement('span'); n0.className = 'n'; n0.style.whiteSpace = 'normal'; n0.textContent = data.focus.S.map((r) => r.name).join(' and ');
      n0.title = 'Credits go to these mobs: ' + data.focus.S.map((r) => r.name + ' (' + (r.pDrop * 100).toFixed(2) + '% a kill)').join(', ');
      it.append(s0, n0); ul.appendChild(it);
    }
    const add = (e, cls) => {
      const it = document.createElement('div'); it.className = 'it ' + cls;
      const s = document.createElement('span'); s.className = 's'; s.textContent = (e.qty ? 'Qty ' : '') + (e.d > 0 ? '+' : '−') + Math.abs(e.d);
      const n = document.createElement('span'); n.className = 'n'; n.textContent = e.r.name; n.title = e.r.name + ': ' + e.r.p + ' → ' + e.to;
      const c = document.createElement('span'); c.className = 'c'; c.textContent = (e.cost > 0 ? e.cost + ' cr' : e.cost < 0 ? '+' + (-e.cost) + ' back' : '');
      it.append(s, n, c);
      it.addEventListener('click', () => { const b = e.qty ? e.r.qplus : (e.d > 0 ? e.r.plus : e.r.minus); try { b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (er) {} });
      ul.appendChild(it);
    };
    applyMarks(Tb, page);
    pulls.sort((a, b) => b.cost - a.cost).forEach((e) => add(e, 'pull'));
    rels.forEach((e) => add(e, 'rel'));
    q('.note').textContent = page === 'slay'
      ? 'Mobs ' + (data.master ? data.master.name : 'your slay master') + ' can roll, valued by XP per hour with your fight loadout. Weights come first; quantity levers (Q+) are used only for credits no weight step can use. ' + (data.other ? 'The game shows another master, so nothing is outlined: pick ' + data.master.name + ' in the game to roll these mobs, the weights below are the same list. ' : 'The yellow buttons are the ones to press. ') + 'Nothing is pressed for you.' + (data.focus ? (data.focus.none ? ' Focus: no mob of this master has a drop left to hunt, so the levers are spread.' : ' Focus: the credits are aimed at ' + data.focus.k + ' mob' + (data.focus.k > 1 ? 's' : '') + ' with the best chance of the drop, because mobs sit in different places and running between them costs time (' + data.focus.speed + ' steps a second). With two targets pick two that are close together. Tip: when one of your targets is rolled, move it to the front of your queue; when the other one rolls, leave it queued. The rest of the mobs are lowered to give the targets the best odds.' + (data.focus.pairDist ? ' These two are ' + Math.round(data.focus.pairDist) + ' steps apart.' : '')) : '') + (route === 'easy' ? ' Easy kills: combat XP only, mobs ranked by risk tier first (A: at most 2 foods an hour and no hit above 15% of your HP, B: 10 foods and 30%, C: 40 foods and 50%, D: the rest), then by XP per hour including the respawn wait, so within a tier the mob with the most HP (more XP per kill, fewer respawns) wins. Not counted: HP that comes back on its own.' : '')
      : page === 'skill'
        ? 'Which task of this skill gets rolled, valued by the game’s XP per hour at your levels. Locked tasks and the location levers (Nodes column) are not covered yet. Nothing is pressed for you.'
        : 'Skill values come from the route. A weight is how likely that skill is to be rolled. The yellow buttons are the ones to press; nothing is pressed for you.';
    lastOut = { page, route, pulls: pulls.length, rels: rels.length, gain };
    // The bell's per-skill alert is about the default route of a single skill's page: remember what this page is showing so seenTick() can tell when it has been looked at.
    if (page === 'skill' && route === 'xp' && data.skill) {
      const nv = { skill: data.skill, sig: pulls.length || rels.length ? sigOf(cr, data.rows, res.pos) : '' };
      if (!curView || curView.skill !== nv.skill || curView.sig !== nv.sig) viewSince = 0;
      curView = nv;
    } else { curView = null; viewSince = 0; }
    seenTick();
  }

  // ------------------------------------------------------------------ headless advice for ONE skill (the bell's per-skill alert)
  // The same rows the skill page reads from its window, but taken from game state (bridge.oddsTiers + activityValue), and the SAME optimise(): the alert and
  // the page agree. Cached per skill; only recomputed when the credits, the level or a lever position change. Pure read, nothing is pressed.
  const sigOf = (cr, rows, pos) => cr + '|' + rows.map((r, i) => (pos[i] !== r.p ? r.id + ':' + pos[i] : '')).filter(Boolean).sort().join(',');
  const SA = new Map();
  const LS_SEEN = 'cc-lever-seen';
  const MIN_GAIN = 1;   // percent: below this the alert stays quiet
  function skillAdvice(skill, st) {
    const b = bridge(); if (!b || !b.individualCredits || !b.oddsTiers || !b.activityValue) return null;
    const ic = b.individualCredits(), cr = ic && ic[skill] ? ic[skill].n : 0;
    if (!(cr > 0)) return { skill, credits: 0, changes: [], gain: 0, sig: '' };
    const t = b.oddsTiers(skill); if (!t) return null;
    const key = cr + '|' + t.map((a) => a.id + ':' + a.weight + (a.open ? '' : 'x')).join(',');
    const c = SA.get(skill); if (c && c.key === key) return c.out;
    if (st && st.left <= 0) return null;                 // the caller's budget for fresh work is spent: finish on the next poll
    if (st) st.left--;
    const rows = [];
    t.forEach((a) => { if (!a.open) return; const v = b.activityValue(skill, a.id); if (v) rows.push({ id: a.id, name: a.name, p: a.weight, x: v.x, t: v.t }); });
    let out = { skill, credits: cr, changes: [], gain: 0, sig: '' };
    if (rows.length) {
      const res = optimise(rows, 5, cr, 1);
      const changes = rows.map((r, i) => ({ id: r.id, name: r.name, from: r.p, to: res.pos[i] })).filter((e) => e.to !== e.from);
      const gain = res.r0 > 0 ? (res.r1 / res.r0 - 1) * 100 : 0;
      if (changes.length && gain >= MIN_GAIN) out = { skill, credits: cr, changes, gain, sig: sigOf(cr, rows, res.pos) };
    }
    SA.set(skill, { key, out });
    return out;
  }
  // "Seen": once a skill's page has shown the same advice for a few seconds, the alert about exactly that advice is answered (it returns if credits or advice change).
  let curView = null, viewSince = 0, seen = {};
  try { seen = JSON.parse(localStorage.getItem(LS_SEEN) || '{}') || {}; } catch (e) { seen = {}; }
  function seenTick() {
    if (!curView || !curView.sig || document.hidden || !tabEl()) { viewSince = 0; return; }
    if (!viewSince) { viewSince = Date.now(); return; }
    if (Date.now() - viewSince >= 4000 && seen[curView.skill] !== curView.sig) {
      seen[curView.skill] = curView.sig;
      try { localStorage.setItem(LS_SEEN, JSON.stringify(seen)); } catch (e) { /* storage blocked */ }
    }
  }
  const skillSeen = (skill) => seen[skill] || '';

  // The master picker: every master the game has, with its level band, whether you can use it and how many of its mobs you can roll.
  function renderMaster() {
    const cm = chosenMaster(), sel = q('.master'), info = q('.minfo'); if (!cm) { info.textContent = ''; return; }
    const sig = cm.ms.masters.map((m) => m.id + m.unlocked + m.current + m.open).join(',') + '|' + cm.m.id;
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig; sel.textContent = '';
      cm.ms.masters.forEach((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name + ' ' + m.range + (m.current ? ' · selected in the game' : '') + (m.unlocked ? '' : ' · locked (Slay ' + m.levelMin + ')') + ' · ' + m.open + '/' + m.mobs + ' mobs'; sel.appendChild(o); });
      sel.value = cm.m.id;
      sel.onchange = () => { try { localStorage.setItem(LS_MASTER, sel.value); } catch (e) {} lastKey = ''; render(); };
    }
    const m = cm.m, h = (t) => String(t).replace(/[<>&]/g, '');
    info.innerHTML = '<b>' + h(m.name) + '</b> (' + h(m.prefix) + ', Slay ' + m.range + '): rolls ' + m.mobs + ' mobs, ' + m.open + ' open to you now.' + (m.chaos ? ' Every mob lever counts double here.' : '') +
      (!m.unlocked ? ' <span class="warn">Locked: you need Slay level ' + m.levelMin + ' (you have ' + cm.ms.slayLevel + ').</span>' : '') +
      (cm.other ? ' <span class="warn">The game\'s lever window shows ' + h(cm.cur ? cm.cur.name : 'another master') + ': pick ' + h(m.name) + ' in the game to apply this. Nothing is outlined.</span>' : '');
  }

  // What following the advice is worth, in the route's own unit. The payoff of a lever setting is R = sum(w_i x_i) / sum(w_i t_i) with w = 1.25^(position);
  // the gain of one change is R(after) - R(before), the other levers staying where they are (so the others' normalising is counted). A skill page is in XP an hour,
  // the all-skills page in route value per task, the Slay page in combat XP an hour (Easy kills), drops an hour (hunt routes with a focus) or the route's XP an hour.
  let totals = null;   // expected average now and after the plan, set by gainHtml for the total row of the table below it
  function gainHtml(data, res, page, easy) {
    const wm = data.wm || 1, W1 = (p) => Math.pow(1.25, p * wm), rows = data.rows;
    const huntU = page === 'slay' && !!data.focus && !data.focus.none && HUNT_ROUTES.includes(data.route);
    const xs = rows.map((r) => (easy ? r.cxp : r.x)), mul = page === 'total' ? 1 : 3600;
    const unit = page === 'total' ? 'value' : huntU ? 'drops/h' : easy ? 'XP/h (combat)' : 'XP/h';
    const stat = (pos) => { let S = 0, D = 0; rows.forEach((r, i) => { const w = W1(pos[i]); S += w * xs[i]; D += w * r.t; }); return D > 0 ? S / D * mul : 0; };
    const cur = rows.map((r) => r.p), R0 = stat(cur), R1 = stat(res.pos);
    const fmt = (v) => { const a = Math.abs(v), t = a >= 1000 ? (a / 1000).toFixed(2) + 'k' : a >= 100 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toFixed(3); return (v > 0 ? '+' : v < 0 ? '−' : '') + t; };
    const pct = (v) => (R0 > 0 ? v / R0 * 100 : 0);
    const cls = (v) => (Math.abs(pct(v)) < 0.3 ? 'ne' : v > 0 ? 'up' : 'dn');
    const list = [];
    rows.forEach((r, i) => {
      const d = res.pos[i] - r.p; if (!d) return;
      const alone = cur.slice(); alone[i] = res.pos[i]; const one = cur.slice(); one[i] = r.p + Math.sign(d);
      const g = stat(alone) - R0, g1 = stat(one) - R0, cost = data.K * (Math.pow(2, Math.abs(res.pos[i])) - Math.pow(2, Math.abs(r.p))), c1 = data.K * (Math.pow(2, Math.abs(one[i])) - Math.pow(2, Math.abs(r.p)));
      list.push({ r, d, g, g1, cost, c1 });
    });
    totals = list.length && R0 > 0 ? { R0, R1, unit } : null;
    if (!list.length || !(R0 > 0)) return '<div class="gtab note">No lever change to value.</div>';
    list.sort((a, b) => b.g - a.g);
    const mx = Math.max.apply(null, list.map((e) => Math.abs(e.g)).concat([1e-9]));
    const per = (g, c) => (c > 0 ? fmt(g / c) : c < 0 ? 'refund' : '-');
    const body = list.map((e) => '<tr><td>' + e.r.name.replace(/[<>&]/g, '') + '</td><td class="r">' + (e.d > 0 ? '+' : '−') + Math.abs(e.d) + '</td><td class="r ' + cls(e.g) + '">' + fmt(e.g) + '</td><td class="r ' + cls(e.g) + '">' + (pct(e.g) >= 0 ? '+' : '−') + Math.abs(pct(e.g)).toFixed(1) + '%</td><td><span class="gb ' + cls(e.g) + '" style="width:' + Math.max(1, Math.round(Math.abs(e.g) / mx * 50)) + 'px;background:currentColor"></span></td><td class="r">' + (e.cost > 0 ? e.cost : e.cost < 0 ? '+' + (-e.cost) : 0) + '</td><td class="r" title="Gain of the first step alone, and per credit">' + fmt(e.g1) + ' (' + per(e.g1, e.c1) + '/cr)</td></tr>').join('');
    return '<div class="gtab"><b>Worth of the advice</b> (' + unit + ')<table><tr><th>Change</th><th class="r">Steps</th><th class="r">Gain</th><th class="r">%</th><th></th><th class="r" title="Credits it costs (+ = refund)">Cr</th><th class="r" title="Gain of its first step, per credit of that step">First step</th></tr>' + body +
      '<tr class="tot"><td>Following all picks</td><td></td><td class="r ' + cls(R1 - R0) + '">' + fmt(R1 - R0) + '</td><td class="r ' + cls(R1 - R0) + '">' + (pct(R1 - R0) >= 0 ? '+' : '−') + Math.abs(pct(R1 - R0)).toFixed(1) + '%</td><td></td><td></td><td class="r">' + Math.round(R0 * 100) / 100 + ' → ' + Math.round(R1 * 100) / 100 + '</td></tr></table>' +
      '<div class="note">Gain = payoff after − before, R = sum(1.25^position × value) / sum(1.25^position × time): each lever step makes that entry 1.25× as likely and the others share what is left. Each row moves only that lever (the rows do not add up to the total, which moves them all). Green = better, orange = worse, grey = under 0.3%. Quantity levers are not counted.</div></div>';
  }

  // Last row of the "Why these picks" table: the expected average of the whole list, as it is now and after the plan (same R as the Worth table above it)
  function totalRow(page, easy, hunt) {
    if (!totals) return '';
    const t = totals, f = (n) => (n >= 1000 ? (n / 1000).toFixed(2) + 'k' : n >= 100 ? n.toFixed(0) : n.toFixed(2)), g = t.R0 > 0 ? (t.R1 / t.R0 - 1) * 100 : 0;
    const span = 3 + (easy ? 5 : 0) + (hunt ? 4 : 0);
    return '<tr class="tot"><td><b>Expected average</b> (' + t.unit + ')</td><td class="r" colspan="' + span + '" title="Average of the whole list, weighted by how likely each entry is to be rolled: now, then with the plan">' + f(t.R0) + ' → <b>' + f(t.R1) + '</b> (' + (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(1) + '%)</td><td class="r">100%</td><td class="r">100%</td></tr>';
  }

  // The numbers behind the suggestion: what each lever is worth to the route, where it is now and where the advisor would put it.
  function renderWhy(data, res, page) {
    const f = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n * 100) / 100));
    const rows = data.rows.map((r, i) => ({ r, to: res.pos[i], v: r.t > 0 ? r.x / r.t * (page === 'total' ? 1 : 3600) : r.x }));
    // Chance each entry is the next one rolled: its weight (1.25^position) over the sum of all weights in the list.
    const wm = data.wm || 1, sumNow = rows.reduce((t, e) => t + Math.pow(1.25, e.r.p * wm), 0), sumPlan = rows.reduce((t, e) => t + Math.pow(1.25, e.to * wm), 0);
    rows.forEach((e) => { e.oNow = Math.pow(1.25, e.r.p * wm) / sumNow * 100; e.oPlan = Math.pow(1.25, e.to * wm) / sumPlan * 100; });
    const pc = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + '%';
    const easy = page === 'slay' && data.rows.length && data.rows[0].tier && data.route === 'easy';
    const hunt = page === 'slay' && HUNT_ROUTES.includes(data.route) && !!data.focus && !data.focus.none;
    if (easy) rows.forEach((e) => { e.v = e.r.t > 0 ? e.r.cxp / e.r.t * 3600 : 0; });
    if (hunt) rows.forEach((e) => { e.v = e.r.pDrop * 3600 / Math.max(1, e.r.fightSec + e.r.respSec); });
    rows.sort((a, b) => (hunt ? (b.r.focus ? 1 : 0) - (a.r.focus ? 1 : 0) : 0) || (easy ? (a.r.tier.n < b.r.tier.n ? -1 : a.r.tier.n > b.r.tier.n ? 1 : 0) : 0) || b.v - a.v);
    const rf = (n, d) => (n == null || !isFinite(n) ? '-' : n.toFixed(d));
    const extraHead = easy ? '<th class="r" title="Risk tier: A no food and no risk ... D dangerous">Tier</th><th class="r" title="Foods per hour (your best food)">Food/h</th><th class="r" title="Worst single hit (crit) as a share of your max HP">Risk</th><th class="r" title="Seconds a kill takes / share of the kill cycle that is respawn wait">Kill s / wait</th><th class="r" title="Combat XP per kill">XP/kill</th>' : '';
    const huntHead = hunt ? '<th class="r" title="Chance a kill gives a drop you still miss">Drop</th><th class="r" title="Kills until the drop on average">Kills</th><th class="r" title="Hours of killing only this mob until the drop (kill time plus respawn)">Hours</th><th class="r" title="Path steps to the nearest focus mob">Steps</th>' : '';
    const nearest = (r) => { if (!data.focus || !data.focus.S) return null; let m = null; data.focus.S.forEach((t) => { if (t !== r) { const d = dist(r.node, t.node); if (d != null && (m == null || d < m)) m = d; } }); return m; };
    const huntCells = (r) => !hunt ? '' : '<td class="r">' + (r.pDrop > 0 ? (r.pDrop * 100 < 1 ? (r.pDrop * 100).toFixed(2) : (r.pDrop * 100).toFixed(1)) + '%' : '-') + '</td><td class="r">' + (r.pDrop > 0 ? Math.round(1 / r.pDrop) : '-') + '</td><td class="r">' + (r.pDrop > 0 ? rf(Math.max(1, r.fightSec + r.respSec) / r.pDrop / 3600, 1) : '-') + '</td><td class="r">' + (r.focus && data.focus.S.length === 1 ? '-' : rf(nearest(r), 0)) + '</td>';
    const extraCells = (r) => !easy ? '' : '<td class="r">' + r.tier.n + '</td><td class="r">' + rf(r.risk && r.risk.hpHr / (data.risk && data.risk.food ? data.risk.food.heal : 12), 1) + '</td><td class="r">' + (r.risk ? Math.round(r.risk.risk * 100) + '%' : '-') + '</td><td class="r">' + rf(r.fightSec, 1) + ' / ' + (r.fightSec + r.respSec > 0 ? Math.round(r.respSec / (r.fightSec + r.respSec) * 100) + '%' : '-') + '</td><td class="r">' + Math.round(r.perKill) + '</td>';
    const head = page === 'total' ? 'Route value' : easy ? 'Combat XP/h' : hunt ? 'Drops/h' : 'XP per hour';
    const flag = (r) => (r.focus ? ' ◎' : '') + (r.boost > 0 ? ' ★' + r.boost : '') + (r.coll > 0 && page === 'slay' ? ' ▣' + r.coll : '');
    q('.whyb').innerHTML = gainHtml(data, res, page, easy) + '<table><tr><th>' + (page === 'total' ? 'Skill' : page === 'slay' ? 'Mob' : 'Task') + '</th><th class="r">' + head + '</th>' + extraHead + huntHead + '<th class="r">Now</th><th class="r">Plan</th><th class="r" title="Chance of being rolled">Odds now</th><th class="r" title="Chance of being rolled after the plan">Odds plan</th></tr>' +
      rows.map((e) => '<tr><td>' + e.r.name.replace(/[<>&]/g, '') + flag(e.r) + '</td><td class="r">' + f(e.v) + '</td>' + extraCells(e.r) + huntCells(e.r) + '<td class="r">' + (e.r.p > 0 ? '+' : '') + e.r.p + '</td><td class="r">' + (e.to > 0 ? '+' : '') + e.to + (e.to !== e.r.p ? (e.to > e.r.p ? ' ▲' : ' ▼') : '') + '</td><td class="r">' + pc(e.oNow) + '</td><td class="r">' + pc(e.oPlan) + '</td></tr>').join('') +
      totalRow(page, easy, hunt) +
      '</table><div style="margin-top:6px">A lever at +1 makes that entry 1.25× as likely. Odds = its weight divided by the total of all listed entries. The plan raises entries with a high value and lowers low ones, counting credit costs and refunds. ' +
      (page === 'slay' ? '★ = XP-boost drops you do not have yet, ▣ = collection entries missing.' + (easy ? ' Food/h uses the best food you hold (else 12 HP food); the model leaves out self-healing. Kill time and respawn wait are the game\'s own, so a high-HP mob loses less of its time to respawns.' : '') : page === 'total' ? 'Gathering skills (Mine, Fish, Forage, Farm, Invoke) are multiplied by the Gathering vs Processing ratio from the Route Advisor settings.' : '') + '</div>';
  }
  const timer = setInterval(() => { try { if (!(document.hidden || window.__ccEcoOn)) render(); } catch (e) { /* keep ticking */ } }, 600);
  { const t = P.body.querySelector('.hlt'); t.checked = hlOn(); t.addEventListener('change', () => { try { localStorage.setItem(LS_HL, t.checked ? '1' : '0'); } catch (e) {} lastKey = ''; render(); }); }
  function teardown() {
    clearInterval(timer); clearMarks();
    P.destroy(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc lever-advisor torn down';
  }
  window[NS] = { version: 1, teardown, render, get last() { return lastOut; }, get debug() { return dbg; }, optimise, skillAdvice, skillSeen, sigOf };
  return 'cc lever-advisor loaded';
})();
