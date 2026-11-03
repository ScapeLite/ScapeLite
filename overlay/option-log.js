// ScapeLite Task Option Log. Display-only: it writes down which task options the game OFFERED in the queue, not only the one you chose, so the roll can be
// checked directly (docs/ROLL-MODEL-CALIBRATION.md section 9). The task history and the task log only show what you picked, and you pick lucky and near tasks on purpose.
//
// What is kept per set of offered options (one queue slot): when it was first and last seen, which option was selected last, and for each option the kind (skill or
// slay), skill, activity (or mob), node, quantity, whether it is lucky, and what the game's own odds said about it at that moment: the skill's share of the roll in
// percent (ps), the activity's share inside the skill or the mob's share for the master (pa), the whole table that share came from (pt: id -> %, only the open ones), the
// skill's lever (lv) and its chance of a lucky task (lk); per set also the whole skill table (sp). No names, no chat, no account data. The page only collects; the watcher takes the rows over (drain) and appends them to State/option-log.json, capped. Nothing leaves this PC.
// Read by scripts/option-log-report.js. Switch off: Settings > Plugins > Task Option Log.
(function () {
  'use strict';
  const NS = '__ccOptionLog';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const SCHEMA = 1, POLL_MS = 3000, PENDING_CAP = 600;
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('optionLogEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.project && b.oddsSkills && b.oddsTiers ? b : null; };

  const open = new Map();   // signature of a set of options -> the row being followed
  const pending = [];       // finished rows waiting for the watcher
  let firstPoll = true, dropped = 0, timer = null;
  const round = (x, d) => (Number.isFinite(x) ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : null);

  // One offered option, with the game's odds for it right now. `memo` keeps the odds tables for one poll.
  function describe(b, op, memo) {
    const kind = op.kind === 'slay' ? 'slay' : 'skill', row = { k: kind, s: op.skill, a: op.act, n: op.node, q: op.qty || 0, l: op.lucky ? 1 : 0 };
    try {
      if (kind === 'skill') {
        const sk = (memo.skills || (memo.skills = b.oddsSkills() || [])).find((x) => x.id === op.skill);
        if (sk) { row.ps = round(sk.pct, 3); row.lv = sk.lever; row.lk = round(sk.lucky, 4); }
        const tiers = memo['t:' + op.skill] || (memo['t:' + op.skill] = b.oddsTiers(op.skill) || []);
        const t = tiers.find((x) => x.id === op.act);
        if (t) row.pa = round(t.pct, 3);
        row.pt = {}; tiers.forEach((x) => { if (x.open && x.pct > 0) row.pt[x.id] = round(x.pct, 2); });
      } else {
        const sl = memo.slay || (memo.slay = b.oddsSlay() || {});
        const m = (sl.mobs || []).find((x) => x.id === op.act);
        if (m) { row.pa = round(m.pct, 3); row.lv = m.lever; }
        row.pt = {}; (sl.mobs || []).forEach((x) => { if (x.open && x.pct > 0) row.pt[x.id] = round(x.pct, 2); });
      }
    } catch (e) { /* the odds are a bonus: the offer is still worth a row */ }
    return row;
  }

  function poll() {
    if (!on()) return;
    const b = bridge(); if (!b) return;
    let p; try { p = b.project(); } catch (e) { return; }
    if (!p || !Array.isArray(p.slots)) return;
    const memo = {}, now = Math.floor(Date.now() / 1000), seen = new Set();
    p.slots.forEach((sl) => {
      const ops = (sl.options || []).filter((o) => o && o.node && o.act);
      if (ops.length < 2) return;
      const sig = ops.map((o) => (o.kind === 'slay' ? 's' : 'k') + ':' + o.skill + ':' + o.act + ':' + o.node).join('|');
      seen.add(sig);
      let r = open.get(sig);
      if (!r) {
        r = { g: sig, t: now, te: now, sel: sl.selected || 0, init: firstPoll ? 1 : 0, o: ops.map((o) => describe(b, o, memo)) };
        try { const sp = {}; (memo.skills || b.oddsSkills() || []).forEach((x) => { if (!x.quests) sp[x.id] = round(x.pct, 2); }); r.sp = sp; } catch (e) { /* optional */ }
        open.set(sig, r);
      }
      r.te = now; r.sel = sl.selected || 0;
    });
    // a set that is gone (its slot finished, or it was rerolled away) is complete: hand it over
    open.forEach((r, sig) => {
      if (seen.has(sig)) return;
      open.delete(sig);
      if (pending.length >= PENDING_CAP) { pending.shift(); dropped++; }
      pending.push(r);
    });
    firstPoll = false;
  }

  // The watcher takes up to `max` finished rows. Returns { v, rows, left, dropped } or null when there is nothing.
  function drain(max) {
    if (!pending.length && !dropped) return null;
    const rows = pending.splice(0, Math.max(1, max || 200)), d = dropped; dropped = 0;
    return { v: SCHEMA, rows, left: pending.length, dropped: d };
  }

  timer = setInterval(() => { try { if (!document.hidden) poll(); } catch (e) { /* keep polling */ } }, POLL_MS);
  function teardown() {
    clearInterval(timer);
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc option-log torn down';
  }
  window[NS] = { version: SCHEMA, teardown, drain, poll, get openCount() { return open.size; }, get pendingCount() { return pending.length; } };
  return 'cc option-log loaded';
})();
