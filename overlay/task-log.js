// ScapeLite Task Log: records every task you run, locally, so the Route Advisor can be checked and tuned against what really happens.
// Per task: what it was, how long it took split into walking / acting / banking, the XP it really paid, and what the game's dashboard and
// the Route Advisor predicted. Stored in this browser profile only (localStorage), never sent anywhere. Display-only: it only reads.
// Download or clear it from Settings > Plugins > Task Log.
// Schema (field `v` on each record; records without `v` are version 1 and stay valid):
//   v1: ts (start, s), kind, skill, act, node, qty, done, lucky, completed, partial, end, secs{total,moving,acting,banking}, xp{skill:xp}, xpSum, pred{dash,dashXp,xp,bonus,adv}
//   v2 adds: te (end, s), n (the game's own lifetime counter for this task, only when seen completing: skill tasks = all non-slay tasks,
//        slay tasks = the slay counter), gain{itemId:qty} / use{itemId:qty} (bank+inventory deltas over the task, biggest 20 each, gold
//        excluded), gp (net gold change), pot{style:[potionId, used, endedFlag]} (potion charges / yards / attacks spent).
(function () {
  'use strict';
  const NS = '__ccTaskLog';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS = 'cc-task-log', CAP = 2000, SCHEMA = 2;
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('taskLogEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const read = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (e) { return []; } };
  const write = (a) => { try { localStorage.setItem(LS, JSON.stringify(a.slice(-CAP))); } catch (e) {} };

  let ep = null, lastTick = 0, firstTick = true, led = null;
  const getLedger = (b) => { try { return b && b.ledger ? b.ledger() : null; } catch (e) { return null; } };
  // Bank+inventory deltas between two ledgers: the biggest 20 gains and 20 losses (gold is reported separately).
  function itemDelta(a, b) {
    const gain = {}, use = {}; let gp = 0;
    if (!a || !b) return { gain, use, gp: null };
    const ids = new Set(Object.keys(a.items).concat(Object.keys(b.items)));
    const g = [], u = [];
    ids.forEach((id) => {
      const d = (b.items[id] || 0) - (a.items[id] || 0);
      if (!d) return;
      if (id === 'gold') { gp = d; return; }
      (d > 0 ? g : u).push([id, Math.abs(d)]);
    });
    const top = (arr, out) => arr.sort((x, y) => y[1] - x[1]).slice(0, 20).forEach((e) => { out[e[0]] = e[1]; });
    top(g, gain); top(u, use);
    return { gain, use, gp };
  }
  // Potion use over the task: first active potion of each style, remaining-charge field (attacks / yards / charges) start vs end.
  function potDelta(a, b) {
    const out = {};
    if (!a || !b) return out;
    for (const st in a.pots) {
      const x = a.pots[st][0]; if (!x) continue;
      const f = Object.keys(x).find((k) => /Remaining$/.test(k) && typeof x[k] === 'number'); if (!f) continue;
      const id = x.potionId || ('tier' + x.tier), y = b.pots[st] && b.pots[st][0];
      const same = y && (y.potionId || ('tier' + y.tier)) === id && typeof y[f] === 'number';
      const used = same ? x[f] - y[f] : x[f];
      if (used > 0.5) out[st] = [id, Math.round(used), same ? 0 : 1];
    }
    return out;
  }
  const bucket = (st) => (st === 'moving' ? 'moving' : st === 'banking' ? 'banking' : st === 'acting' || st === 'combat' ? 'acting' : 'other');

  function snapshot(b) {
    const L = b.live();
    if (!L) return null;
    const t = L.task, s = L.slay;
    let key = null, kind = null, name = null, qty = 0, prog = 0, node = null, skill = null, lucky = false;
    if (s && (L.state === 'combat' || !t)) {
      kind = 'slay'; name = s.taskId; qty = s.killTarget || s.quantity || 0; prog = s.killCount || s.progress || 0; skill = 'slay'; lucky = !!s.lucky; node = s.nodeId || null;
      key = 'slay:' + name + ':' + qty;
    } else if (t) {
      kind = 'skill'; name = t.activityId; qty = t.quantity || 0; prog = t.progress || 0; skill = t.skill; lucky = !!t.lucky; node = t.nodeId || null;
      key = 'skill:' + skill + ':' + name + ':' + node + ':' + qty;
    }
    return { L, key, kind, name, qty, prog, node, skill, lucky };
  }

  function finalize(why, endLed) {
    if (!ep) return;
    const e = ep; ep = null;
    const total = e.s.moving + e.s.acting + e.s.banking + e.s.other;
    if (total < 20) return; // too short to mean anything
    const xp = {}; let xpSum = 0;
    for (const k in e.xpEnd) { const d = Math.round(e.xpEnd[k] - (e.xp0[k] || 0)); if (d > 0) { xp[k] = d; xpSum += d; } }
    const d = itemDelta(e.led0, endLed), rec = {
      v: SCHEMA, te: Math.round(Date.now() / 1000), ts: Math.round(e.t0 / 1000), kind: e.kind, skill: e.skill, act: e.name, node: e.node, qty: e.qty, done: e.prog, lucky: e.lucky,
      completed: e.qty > 0 && e.prog >= e.qty * 0.98, partial: e.partial, end: why,
      secs: { total: Math.round(total), moving: Math.round(e.s.moving), acting: Math.round(e.s.acting), banking: Math.round(e.s.banking) },
      xp, xpSum, pred: e.pred,
    };
    if (endLed && e.led0) {
      if (rec.completed) { const c1 = e.kind === 'slay' ? endLed.slayDone : endLed.tasksTotal, c0 = e.kind === 'slay' ? e.led0.slayDone : e.led0.tasksTotal; if (c1 > c0 && c1 - c0 <= 1) rec.n = c1; }
      if (Object.keys(d.gain).length) rec.gain = d.gain;
      if (Object.keys(d.use).length) rec.use = d.use;
      if (d.gp) rec.gp = d.gp;
      const pd = potDelta(e.led0, endLed); if (Object.keys(pd).length) rec.pot = pd;
    }
    const a = read(); a.push(rec); write(a);
    // Also hand the finished record to the core logger (Logs/Tasks/, kept as history) when it is loaded.
    try {
      const lg = window.__ccLog && window.__ccLog.channel('Tasks', rec.kind === 'slay' ? 'slayer' : 'skilling');
      if (lg) lg.info((rec.kind === 'slay' ? 'Slayer: ' : 'Task: ') + rec.act + ' x' + rec.qty + ' ' + (rec.completed ? 'done' : 'stopped at ' + rec.done) + ' in ' + rec.secs.total + 's, ' + rec.xpSum + ' xp', { rec });
    } catch (e) {}
  }

  function tick() {
    const b = window.__ccBridge;
    if (!on() || !b || !b.live) { return; }
    const now = Date.now();
    const sn = snapshot(b);
    if (!sn) return;
    led = getLedger(b) || led;
    const dt = lastTick ? Math.min(5, (now - lastTick) / 1000) : 0;
    lastTick = now;
    if (ep && sn.key !== ep.key) finalize('next', led);
    if (!ep && sn.key) {
      let pred = null;
      try { const p = b.project(), h = p && p.head; if (h) pred = { dash: Math.round(h.timeSec || 0), dashXp: Math.round(h.rawXp != null ? h.rawXp : h.totalXp || 0), xp: Math.round(h.totalXp || 0), bonus: h.xpBonus || 0, adv: h.combat && Number.isFinite(h.combat.timeSec) ? Math.round(h.combat.timeSec) : null }; } catch (e) {}
      ep = { key: sn.key, kind: sn.kind, name: sn.name, qty: sn.qty, node: sn.node, skill: sn.skill, lucky: sn.lucky, prog: sn.prog, t0: now,
        partial: firstTick || sn.prog > Math.max(2, sn.qty * 0.03), s: { moving: 0, acting: 0, banking: 0, other: 0 }, xp0: sn.L.xp, xpEnd: sn.L.xp, pred, led0: led };
    }
    firstTick = false;
    if (ep) { ep.s[bucket(sn.L.state)] += dt; ep.prog = Math.max(ep.prog, sn.prog); ep.xpEnd = sn.L.xp; }
  }
  const timer = setInterval(() => { try { if (!document.hidden) tick(); } catch (e) {} }, 1000);
  const onHide = () => { try { finalize('closed', led); } catch (e) {} };
  window.addEventListener('beforeunload', onHide);

  // Median of actual / predicted acting time per skill, for the Route Advisor's calibration (clean, completed, fully observed tasks only).
  function summary() {
    const by = {};
    read().forEach((r) => {
      if (!r.completed || r.partial || !r.pred || !r.pred.dash) return;
      const k = r.kind === 'slay' ? 'slay:' + r.act : r.skill;
      (by[k] = by[k] || []).push({ dash: r.secs.acting / r.pred.dash, adv: r.pred.adv ? r.secs.acting / r.pred.adv : null, xph: r.xpSum / Math.max(1, r.secs.total) * 3600 });
    });
    const med = (a) => { a = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const out = {};
    for (const k in by) out[k] = { n: by[k].length, actualOverDash: med(by[k].map((x) => x.dash)), actualOverAdv: med(by[k].map((x) => x.adv)), xpPerHour: med(by[k].map((x) => x.xph)) };
    return out;
  }
  // Slay tasks pay and take about 1.5x what the game's dashboard says since 2026-10-22 (docs/ROLL-MODEL-CALIBRATION.md section 7): one counted kill stands
  // for more kills' worth of XP and time. The rates (XP an hour) are still right, so this correction is for TASK TOTALS AND ETAs ONLY: the queue and the
  // option cards multiply a slay task's time and XP by it; XP an hour, the Route Advisor and the rankings never see it, and the log below keeps the raw
  // prediction (so the correction is measured against the unadjusted number). Learned from the newest N finished slay tasks: the median of
  // (acting seconds / predicted seconds) and (real XP / predicted XP), each clamped; with fewer than MIN tasks the fallback is used instead.
  const SLAY_N = 15, SLAY_MIN = 5, SLAY_FALLBACK = 1.5, SLAY_LO = 0.8, SLAY_HI = 2.5;
  function slayFactorOf(recs) {
    const clamp = (x) => Math.max(SLAY_LO, Math.min(SLAY_HI, x));
    const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };
    const ok = (recs || []).filter((r) => r && r.kind === 'slay' && r.completed && !r.partial && r.pred && r.pred.dash > 100 && r.pred.xp > 0 && r.secs && r.xp && r.done >= (r.qty || 0) - 2)
      .sort((x, y) => x.ts - y.ts).slice(-SLAY_N);
    if (ok.length < SLAY_MIN) return { t: SLAY_FALLBACK, x: SLAY_FALLBACK, n: ok.length, measured: false };
    // XP: everything the task paid except Luck XP and Alms XP, which are not part of the dashboard's number; a lucky task is left out of the XP ratio (it pays double on top)
    const xr = ok.filter((r) => !r.lucky).map((r) => Object.keys(r.xp).filter((k) => k !== 'luck' && k !== 'alms').reduce((t, k) => t + (r.xp[k] || 0), 0) / r.pred.xp).filter(isFinite);
    const tr = ok.map((r) => (r.secs.acting || 0) / r.pred.dash).filter(isFinite);   // acting seconds: the task itself, without the walk to it
    return { t: tr.length >= SLAY_MIN ? clamp(med(tr)) : SLAY_FALLBACK, x: xr.length >= SLAY_MIN ? clamp(med(xr)) : SLAY_FALLBACK, n: ok.length, measured: tr.length >= SLAY_MIN && xr.length >= SLAY_MIN };
  }
  let slayMemo = null;
  function slayK() {
    try {
      const v = window.__ccPluginSettings && window.__ccPluginSettings.get('slayCorrection');
      if (v === false) return { t: 1, x: 1, n: 0, measured: false, off: true, text: '' };
    } catch (e) { /* default: on */ }
    const now = Date.now();
    if (!slayMemo || now - slayMemo.at > 30000) slayMemo = { at: now, k: slayFactorOf(read()) };
    const k = slayMemo.k;
    const f = (x) => '×' + x.toFixed(2);
    return Object.assign({ text: k.measured ? 'Measured correction: time ' + f(k.t) + ', XP ' + f(k.x) + ' (median of your last ' + k.n + ' finished slay tasks, against the game’s own numbers). XP an hour is not changed.' : 'Estimated correction ' + f(k.t) + ' (too few finished slay tasks to measure: ' + k.n + ' of ' + SLAY_MIN + '). XP an hour is not changed.' }, k);
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ app: 'ScapeLite task log', schema: SCHEMA, exported: new Date().toISOString(), tasks: read(), summary: summary() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scapelite-task-log.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function teardown() {
    clearInterval(timer); window.removeEventListener('beforeunload', onHide); onHide();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc task-log torn down';
  }
  // Refill from the log files (the watcher calls this only when the browser copy is empty). Merges by start time, newest CAP kept.
  function restore(recs) {
    try {
      if (!Array.isArray(recs)) return 0;
      const cur = read(), seen = new Set(cur.map((r) => r.ts + '|' + r.act));
      const add = recs.filter((r) => r && r.ts && !seen.has(r.ts + '|' + r.act));
      write(cur.concat(add).sort((x, y) => x.ts - y.ts));
      return add.length;
    } catch (e) { return 0; }
  }
  window[NS] = { version: SCHEMA, teardown, log: read, restore, summary, slayK, slayFactorOf, export: exportJson, clear() { write([]); }, get current() { return ep && { key: ep.key, secs: Object.assign({}, ep.s), partial: ep.partial }; } };
  return 'cc task-log loaded';
})();
