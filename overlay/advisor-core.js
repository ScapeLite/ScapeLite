// ScapeLite Advisor core: pure code (no DOM, no game access). Works in the page (window.__ccAdvisorCore) and in Node (module.exports), so it is tested offline.
//
// The Universal Advisor (docs/UNIVERSAL-ADVISOR.md) does not compute anything the other advisors already own. Each adapter below takes a plain snapshot of one
// source (the Route Advisor result, the Lever Advisor's last answer, the Tree Advisor plan, Goals, the diary model) and turns it into zero or more ACTIONS of one
// shape. build() ranks them lane by lane and picks one hero action. An adapter never throws and returns [] when its input is missing or incomplete.
//
// Action:  { id, kind, lane, what, how: [text], where: [{ id, name, min? }], gain: { kind, value, text }, cost: { minutes, credits, text }, sure: 'A'|'B'|'C',
//            why: [text], score, pinned? }
//   lane  now (queue and route) | levers (skill and activity levers) | setup (location levers: free diary pips) | hunts (goals, drops, pets) | build (trees)
//   sure  A exact game arithmetic, B measured against logged play, C modelled and not calibrated (docs/ROLL-MODEL-CALIBRATION.md, adv-003)
//   score a number that is only comparable inside one lane: the lanes use different units on purpose (a drop has no XP value, a saved credit is not a level)
(function (root) {
  'use strict';

  const LANES = ['now', 'levers', 'setup', 'hunts', 'build'];
  const LANE_NAMES = { now: 'Now', levers: 'Levers', setup: 'Locations and free pips', hunts: 'Hunts and goals', build: 'Build' };
  const HERO_ORDER = ['now', 'levers', 'setup', 'hunts', 'build'];   // the lane the hero comes from: the first one that has a ranked action
  const HORIZON_H = 24;                                    // provisional (user to confirm): hours of play a route gain is counted over

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (d == null ? 0 : d));
  const str = (v) => (v == null ? '' : String(v));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const n0 = (n) => Math.round(n).toLocaleString('en-US');
  const mins = (m) => (m < 1 ? '<1 min' : m < 90 ? Math.round(m) + ' min' : (m / 60).toFixed(m < 600 ? 1 : 0) + ' h');
  const hrs = (h) => (!isFinite(h) ? 'never' : h < 1.5 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : (h / 24).toFixed(h < 240 ? 1 : 0) + ' days');
  const pctText = (f) => (f >= 0 ? '+' : '-') + Math.abs(f * 100).toFixed(Math.abs(f) < 0.1 ? 1 : 0) + '%';

  function act(o) {
    return {
      id: str(o.id), kind: o.kind || 'other', lane: LANES.indexOf(o.lane) >= 0 ? o.lane : 'setup', what: str(o.what), how: (o.how || []).map(str), where: o.where || [],
      gain: o.gain || { kind: 'none', value: 0, text: '' }, cost: o.cost || { minutes: 0, credits: 0, text: '' }, sure: o.sure || 'C', why: (o.why || []).map(str), score: num(o.score), pinned: !!o.pinned,
    };
  }

  // ---------------------------------------------------------------- adapters

  // Locations (overlay/diary-credits-core.js build().loc): where to spend the diary's free node-lever pips. A node lever changes how often a location is rolled, so it changes
  // WALKING, not the XP rate directly. One action per skill, the skill's whole free plan (several moves, each one pip), best skill first. Free moves are class B: the distances
  // are the game's own path distances (exact), the shares follow the calibrated roll model, and the claimed saving is half the geometric difference (see the core). A move that
  // costs credits is class C: the saving per credit is small and was not measured. The diary is gained passively; nothing here suggests doing anything to progress it.
  function fromLocations(m, o) {
    const L = m && m.loc; if (!L || !Array.isArray(L.skills)) return [];
    const out = [], sgn = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n);
    L.skills.forEach((s) => {
      const free = s.free || { moves: [] }, nm = {}; s.rows.forEach((r) => { nm[r.node] = r; });
      const doit = (plan, kind) => {
        if (!plan.moves.length) return;
        const all = plan.savedAll; if (!(all >= 0.05)) return;          // under 0.05 s per average task is not worth a card
        const paidKind = kind === 'paid', top = plan.moves.slice().sort((a, b) => b.saved - a.saved), first = top[0], fr = nm[first.node];
        out.push(act({
          id: 'loc:' + s.skill + ':' + kind, kind: 'location', lane: 'setup', sure: paidKind ? 'C' : 'B', score: all,
          what: (paidKind ? 'Buy ' : 'Place free pips on ') + cap(s.skill) + ' locations: set ' + str(fr && fr.name) + ' to ' + sgn(first.to) + (plan.moves.length > 1 ? ' and ' + (plan.moves.length - 1) + ' more' : '') + ' (about ' + all.toFixed(2) + ' s less walking per task)',
          how: ['Open Skills Customization, pick ' + cap(s.skill) + ', then its locations (node levers)'].concat(top.slice(0, 8).map((mv) => { const r = nm[mv.node]; return 'Set ' + str(r && r.name) + ' from ' + sgn(mv.from) + ' to ' + sgn(mv.to) + ' (' + Math.round((r && r.d) || 0) + ' steps from its bank, rated ' + str(r && r.quality) + ')' + (paidKind ? ', ' + Math.round(mv.cost) + ' credits' : ', free'); })).concat(top.length > 8 ? ['... and ' + (top.length - 8) + ' more in the Locations panel'] : []),
          where: top.slice(0, 4).map((mv) => { const r = nm[mv.node]; return { id: mv.node, name: str(r && r.name) }; }),
          gain: { kind: 'walk', value: all, text: 'about ' + all.toFixed(2) + ' s less walking per task overall (' + plan.saved.toFixed(1) + ' s per ' + s.skill + ' task)' },
          cost: paidKind ? { minutes: 1, credits: Math.round(plan.cost), text: Math.round(plan.cost) + ' ' + s.skill + ' credits' } : { minutes: 1, credits: 0, text: 'no credits: uses ' + plan.moves.reduce((t, mv) => t + Math.abs(mv.to) - Math.abs(mv.from), 0) + ' free diary pips' },
          why: ['This changes where tasks are rolled, so it saves walking, not the XP rate directly, and only for tasks rolled from now on.',
            'Distances are the path distances the game uses, from each node to its nearest bank (' + Math.round(L.sps * 10) / 10 + ' steps a second for you). The saving counts half the straight difference: legs inside one bank area do not pass the bank, and you already pick nearer locations than the roll offers.',
            'Walking is about a minute per task longer than the route model says (docs/ROLL-MODEL-CALIBRATION.md); this can only touch the node-to-bank part of it, so the total over all skills cannot exceed that.',
            paidKind ? 'Pips beyond the free ones cost 5, 10, 20 credits and buy little walking: only moves that pay back a visible amount per credit are listed.' : 'The pips are free because the diary of the nearest bank is at tier ' + (fr ? fr.tier : '?') + '.'],
        }));
      };
      doit({ moves: free.moves, savedAll: free.savedAll, saved: free.saved, cost: 0 }, 'free');
      doit({ moves: (s.paid || { moves: [] }).moves, savedAll: (s.paid || {}).savedAll || 0, saved: (s.paid || {}).saved || 0, cost: (s.paid || {}).cost || 0 }, 'paid');
    });
    return out;
  }

  // Goals (overlay/goals.js build()): pinned hunts first, then the nearest skill target, then the best unlock hunts. Hunts have no XP value, so they stay in their own lane.
  function fromGoals(g, o) {
    if (!g) return [];
    const out = [];
    const hunt = (e, pinned) => {
      const m = e.m || {}, x = e.x || {}; if (!x.name || !isFinite(e.hrs)) return;
      out.push(act({
        id: 'hunt:' + m.id + ':' + x.id, kind: 'hunt', lane: 'hunts', sure: 'B', pinned, score: (pinned ? 1e6 : 0) - e.hrs + (e.trained ? 1e3 : 0),
        what: 'Hunt ' + x.name + ' from ' + str(m.name),
        how: ['Take ' + str(m.name) + ' as a slay task or fight it', '1 in ' + n0(x.n || 0) + ' kills; you have ' + n0(m.kills || 0) + ' so far'],
        where: [{ id: m.id, name: str(m.name) }],
        gain: { kind: 'time', value: e.hrs, text: 'about ' + hrs(e.hrs) + ' of killing it' }, cost: { minutes: e.hrs * 60, credits: 0, text: 'only that mob, at your real kill time' },
        why: ['Expected time = one in N kills times your real kill time.' + (e.trained ? ' A tool for a skill you train, so it comes first.' : '')],
      }));
    };
    (g.pinItems || []).forEach((e) => hunt(e, true));
    (g.hunts || []).slice(0, 3).forEach((e) => hunt(e, false));
    const sk = (row, pinned) => {
      if (!row || !isFinite(row.hr) || row.done) return;
      out.push(act({
        id: 'goal:' + row.sk + ':' + row.target, kind: 'goal', lane: 'hunts', sure: 'B', pinned, score: (pinned ? 1e6 : 0) - row.hr,
        what: 'Reach ' + cap(row.sk) + ' ' + row.target + ' (' + hrs(row.hr) + ' at your pace)',
        how: [n0(row.left) + ' XP to go at ' + n0(row.rate) + ' XP an hour'], where: [],
        gain: { kind: 'time', value: row.hr, text: hrs(row.hr) + ' left' }, cost: { minutes: row.hr * 60, credits: 0, text: 'training it' },
        why: ['Your real XP an hour from the XP Tracker, bonus already in.'],
      }));
    };
    (g.pinSkill || []).forEach((r) => sk(r, true));
    (g.skillRows || []).slice(0, 2).forEach((r) => sk(r.next || r, false));
    return out;
  }

  // Route Advisor: only when it is showing a better queue (its own stability rules decided that). paths[kind] is the plan it shows.
  function fromRoute(r, o) {
    if (!r || !r.followed || !r.info) return [];
    const info = r.info[r.followed], plan = r.plans && r.plans[r.followed];
    if (!info || !info.shown || !plan || !plan.length) return [];
    const horizon = (o && o.horizonH) || HORIZON_H;
    const moves = plan.map((p, i) => ({ pos: i + 1, from: p.row + 1, label: str(p.label), node: str(p.node), pickChanged: !!p.pickChanged })).filter((p) => p.pos !== p.from || p.pickChanged);
    const cur = num(r.curWalkSec), rec = num(r.recWalkSec), save = cur > 0 && rec > 0 ? cur - rec : 0;
    const gain = num(info.gain);
    return [act({
      id: 'route:' + r.followed + ':' + str(r.sig), kind: 'route', lane: 'now', sure: 'B', score: gain,
      what: 'Reorder your task queue (' + moves.length + ' of ' + plan.length + ' tasks move): ' + pctText(gain) + ' value per hour',
      how: moves.slice(0, 8).map((p) => 'Put "' + p.label + '" in place ' + p.pos + ' (now ' + p.from + ')'),
      where: moves.slice(0, 3).map((p) => ({ id: p.node, name: p.label })),
      gain: { kind: 'score', value: gain, hours: horizon * gain / (1 + gain), text: pctText(gain) + ' value per hour (the Route Advisor score), the same work in about ' + (horizon * gain / (1 + gain)).toFixed(1) + ' h less over ' + horizon + ' h of play' },
      cost: { minutes: Math.max(1, moves.length * 0.3), credits: 0, text: 'about ' + mins(Math.max(1, moves.length * 0.3)) + ' to rearrange' + (save > 60 ? '; walking drops by ' + mins(save / 60) : '') },
      why: ['The Route Advisor (' + r.followed + ' path) found a better order; it only shows one that clears its own margin.', 'Walking is about a minute per task longer than the model says (docs/ROLL-MODEL-CALIBRATION.md), the same for every order, so the ranking holds and the gain is a little smaller in real life.', r.reasons && r.reasons.length ? r.reasons.join('; ') : ''].filter(Boolean),
    })];
  }

  // Lever Advisor (pages: all skills, one skill, slay). Calibrated 2026-10-29 (docs/ROLL-MODEL-CALIBRATION.md): the skill and activity weights fit the 200-task history
  // (the lever base 1.25 is inside the data's 1.08 to 1.26), and the rates (XP an hour) are right, so these are ranked by rate only and sit at class B. Not covered, so
  // never suggested from here: node (location) levers, and anything based on how near a node is to a bank. A credit-costing change must clear 1% expected payoff; a free one
  // or a refund half a percent.
  function fromLever(l, o) {
    if (!l || !(l.pulls || l.rels)) return [];
    const credits = num(l.credits), gain = num(l.gain), n = num(l.pulls) + num(l.rels);
    if (credits > 0 && gain < 1) return [];
    if (!(gain >= 0.5)) return [];   // under half a percent is inside the noise of the model, free or not
    const slay = l.page === 'slay';
    return [act({
      id: 'lever:' + str(l.page) + ':' + str(l.route), kind: 'lever', lane: 'levers', sure: l.page === 'node' ? 'C' : 'B', score: gain / 100,
      what: 'Change ' + n + ' lever' + (n > 1 ? 's' : '') + ' (' + str(l.page) + ', ' + str(l.route) + '): +' + gain.toFixed(1) + '% expected ' + (slay ? 'XP an hour' : 'payoff') + ' for ' + (credits > 0 ? n0(credits) + ' credits' : credits < 0 ? 'a refund of ' + n0(-credits) + ' credits' : 'no credits'),
      how: ['Open the Skills Customization window; the Lever Advisor outlines the buttons to press (yellow). Nothing is pressed for you.'], where: [],
      gain: { kind: 'score', value: gain / 100, text: '+' + gain.toFixed(1) + '% expected payoff (a rate, not a total)' },
      cost: { minutes: 1, credits, text: credits > 0 ? n0(credits) + ' credits' : credits < 0 ? n0(-credits) + ' credits back' : 'free' },
      why: ['The skill and activity weights fit your last 200 tasks; the lever base 1.25 is inside the range the data allows (1.08 to 1.26), so the real gain may be somewhat smaller.', slay ? 'Slay: the rate is right, but per-task XP and time have been about 1.5 times the model since 22 October, so read totals and ETAs with that.' : '', 'Location levers are not part of this advice: players pick nearer nodes than the roll offers, so their benefit is smaller than the model says.'].filter(Boolean),
    })];
  }

  // Tree Advisor: the best build for your points against the current build, in its own score (DPS priced with the game's Gear Calc maths for Delve).
  function fromTree(t, o) {
    if (!t || !t.cur || !t.best || !(t.curScore > 0)) return [];
    const cur = new Set(t.cur), best = new Set(t.best.ids || []);
    let take = 0, drop = 0; best.forEach((id) => { if (!cur.has(id)) take++; }); cur.forEach((id) => { if (!best.has(id)) drop++; });
    const gain = t.best.score / t.curScore - 1;
    if (!(gain > 0.005) || (!take && !drop)) return [];
    return [act({
      id: 'tree:' + str(t.key) + ':' + take + ':' + drop, kind: 'tree', lane: 'build', sure: 'B', score: gain,
      what: 'Re-spec your ' + str(t.name || t.key) + ' tree: ' + pctText(gain) + ' (' + take + ' to take, ' + drop + ' to refund)',
      how: ['Open the Tree Advisor: it lists the refunds first, then the nodes to take, in order'], where: [],
      gain: { kind: 'score', value: gain, text: pctText(gain) + ' build score' }, cost: { minutes: 2, credits: 0, text: drop ? 'refunds cost ' + (drop * 3) + ' credits' : 'no refund needed' },
      why: ['The knapsack over the whole tree finds the best build for your points; the score is the Tree Advisor\'s own.'],
    })];
  }

  // ---------------------------------------------------------------- summaries: the live objects of the other advisors, reduced to what the adapters read
  // (kept here, not in the panel, so the shapes are tested against the real ones)

  // Route Advisor: __ccRouteAdvisor.result. paths.followed names the path the player follows (skill / combat / quest); paths[kind] is only set while that plan is shown.
  function summariseRoute(res) {
    try {
      const P = res && res.paths; if (!P || !P.followed || !P.info) return null;
      const plans = {}, walk = {};
      ['skill', 'combat', 'quest'].forEach((k) => {
        const pk = P[k]; if (!pk || !Array.isArray(pk.plan) || !P.info[k] || !P.info[k].shown) return;
        plans[k] = pk.plan.map((p) => { const row = res.rows[p.row], op = row && row.opts && row.opts[p.opt]; return { row: p.row, opt: p.opt, label: op ? str(op.label) : '', node: op ? str(op.node) : '', pickChanged: !!(op && !op.selected) }; });
        const sec = (x) => (x && x.withTp && x.noTp ? num(P.tpOn ? x.withTp.time : x.noTp.time) : 0);
        walk[k] = { cur: sec(P.cur), rec: sec(pk), sig: str(pk.sig) };
      });
      const k = P.followed, w = walk[k] || {};
      return { followed: k, info: P.info, plans, curWalkSec: w.cur || 0, recWalkSec: w.rec || 0, sig: w.sig || '', reasons: (P.info[k] && P.info[k].reasons) || [] };
    } catch (e) { return null; }
  }

  // Lever Advisor: __ccLeverAdvisor.last ({ page, route, pulls, rels, gain }) and .debug (rows with p and to, and K, the price of the first pip). Credits = the price of all the moves.
  function summariseLever(last, dbg) {
    try {
      if (!last || !(last.pulls || last.rels)) return null;
      let credits = 0;
      if (dbg && Array.isArray(dbg.rows) && dbg.K > 0) dbg.rows.forEach((r) => { if (r.to !== r.p) credits += dbg.K * (Math.pow(2, Math.abs(r.to)) - Math.pow(2, Math.abs(r.p))); });
      return { page: last.page, route: last.route, pulls: last.pulls, rels: last.rels, gain: last.gain, credits };
    } catch (e) { return null; }
  }

  // Tree Advisor: __ccTreeAdvisor.plan ({ T: { key, name }, cur: [ids], curScore, best: { ids, score } })
  function summariseTree(plan) {
    try { return plan && plan.best && plan.cur ? { key: plan.T && plan.T.key, name: plan.T && plan.T.name, cur: plan.cur.slice(), curScore: plan.curScore, best: { ids: plan.best.ids.slice(), score: plan.best.score } } : null; } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- ranking and the hero

  const SURE_OK = { A: true, B: true };
  // Inside a lane, best first. Pinned things always lead.
  function rankLane(list, o) {
    const unc = !!(o && o.showUncertain);
    return list.filter((a) => SURE_OK[a.sure] || unc).sort((a, b) => (b.pinned - a.pinned) || (b.score - a.score) || a.id.localeCompare(b.id));
  }

  function build(inputs, o) {
    o = o || {}; inputs = inputs || {};
    const all = [].concat(
      fromRoute(inputs.route, o), fromLocations(inputs.diary, o), fromLever(inputs.lever, o), fromGoals(inputs.goals, o), fromTree(inputs.tree, o)
    );
    const byLane = {}; LANES.forEach((l) => { byLane[l] = rankLane(all.filter((a) => a.lane === l), o); });
    const hidden = all.filter((a) => !SURE_OK[a.sure] && !o.showUncertain);
    let hero = null, heroLane = null;
    for (const l of HERO_ORDER) { if (byLane[l].length) { hero = byLane[l][0]; heroLane = l; break; } }
    // Stability: keep the previous hero while it is still there, in the same lane, and not clearly beaten (no flicker)
    if (hero && o.prevHero) {
      const same = byLane[heroLane].find((a) => a.id === o.prevHero);
      const margin = o.margin == null ? 0.25 : o.margin;
      if (same && same.id !== hero.id && same.score >= hero.score * (1 - margin) - 1e-9) hero = same;
    }
    const sources = [
      { name: 'Route Advisor', has: !!inputs.route, count: all.filter((a) => a.kind === 'route').length },
      { name: 'Locations and Free Pips', has: !!(inputs.diary && inputs.diary.loc), count: all.filter((a) => a.kind === 'location').length },
      { name: 'Lever Advisor', has: !!inputs.lever, count: all.filter((a) => a.kind === 'lever').length },
      { name: 'Goals', has: !!inputs.goals, count: all.filter((a) => a.kind === 'hunt' || a.kind === 'goal').length },
      { name: 'Tree Advisor', has: !!inputs.tree, count: all.filter((a) => a.kind === 'tree').length },
    ];
    return { hero, heroLane, byLane, hiddenUncertain: hidden.length, sources, empty: !hero, horizonH: o.horizonH || HORIZON_H };
  }

  const api = { LANES, LANE_NAMES, HERO_ORDER, HORIZON_H, act, fromLocations, fromGoals, fromRoute, fromLever, fromTree, summariseRoute, summariseLever, summariseTree, rankLane, build, fmt: { n0, mins, hrs, pctText } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__ccAdvisorCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
