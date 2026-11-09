// ScapeLite Task queue (ns __ccQueue). The game's task queue as one compact card per task: a big icon tile, a walking pill between the cards, the other options of a task
// sliding out to the side, drag to reorder, tiers, quest / lucky / boost colours, the Route Advisor's highlight and recommended order. It is used twice: as a kept panel
// (click the Tasks button) and as the hover card of the info bar's Tasks button. Design: notes/queue-panel-design (DESIGN.md), shared look: docs/DESIGN-SYSTEM.md.
// Display only: nothing is changed in the game except on your own click on an option tile or your own drag of a card (passed on to the game's own queue rows).
(function () {
  'use strict';
  const NS = '__ccQueue';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* nothing to replace */ }
  const UI = window.__ccUI;
  if (!UI) return 'cc queue needs the ui kit';

  // ---------------------------------------------------------------- small helpers
  const bridge = () => { const b = window.__ccBridge; try { return b && b.ok && b.ok() ? b : null; } catch (e) { return null; } };
  // The shared card layer (card-sync.js): the queue is drawn from bridge data, so its source is a poll that only runs while the panel or the hover card is on screen;
  // fwd() = "the user's click was handed to the game": the layer follows the game for a few seconds and the queue redraws as soon as it changes.
  const SYNC = () => window.__ccCardSync || null;
  const fwd = () => { try { const S = SYNC(); if (S) S.forwarded(); } catch (e) { /* layer gone */ } };
  const freshQ = () => { const S = SYNC(); if (S && S.fresh('queue')) return; const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); };   // the game does not redraw its hidden queue panel: its own redraw call, read only
  const pretty = (id) => String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const short = (n) => (n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : num(n));
  const fmtTime = (sec) => (sec >= 5400 ? (sec / 3600).toFixed(sec >= 36000 ? 0 : 1) + ' h' : sec >= 60 ? Math.round(sec / 60) + ' min' : Math.round(sec) + ' s');
  const skillIcon = (sk) => '/assets/icons/skills/' + sk + '.png';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const E = () => window.__ccEdge || { top: 0, bottom: 0 };
  const setting = (k, d) => { try { const v = window.__ccPluginSettings.get(k); return v === undefined ? d : !!v; } catch (e) { return d; } };

  // ---------------------------------------------------------------- what the game's own queue shows on each option: the tier badge (T0.., or the level of a kill task) and the
  // category icons on its tile (diary step, teleport). Looked up by row and option first (two rows can hold the same mob), else by node and activity.
  function gameTiers() {
    const map = new Map(), byRow = new Map();
    document.querySelectorAll('#unified-queue-panel .icon-option').forEach((o) => {
      const e = o.querySelector('.task-tier-label:not(.uq-cost-badge)'), s = o.querySelector('.icon-scroll-row'); if (!s) return;
      const node = s.dataset.nodeId || '', act = s.dataset.activityId || '', tier = e ? e.textContent.trim() : '';
      const src = Array.from(o.querySelectorAll('.icon-scroll-indicator')).map((i) => i.getAttribute('src') || '').join(' ');
      const v = { tier, diary: /\/diary\.png/.test(src), tp: /stable_crystal/.test(src) };
      const row = o.closest('.uq-row'), ri = row && row.dataset.rowIndex != null ? row.dataset.rowIndex : '', oi = o.dataset.optionIndex;
      if (ri !== '' && oi != null) byRow.set(ri + '|' + oi + '|' + node, v);
      map.set(node + '|' + act, v); if (!map.has(node + '|')) map.set(node + '|', v);
    });
    return (op, si, k) => (si != null && byRow.get(si + '|' + k + '|' + op.node)) || map.get(op.node + '|' + (op.act || '')) || map.get(op.node + '|') || { tier: '', diary: false, tp: false };
  }

  // ---------------------------------------------------------------- data
  let insOv = null;       // { at, t }: a NEW TASKS bar move you just made, shown before the game's own data has caught up
  const optSel = {};      // slot index -> { node, act, t }: an option you just chose, shown before the game's own data has caught up
  let samples = [], sampleKey = '';
  function etaOf(tk) {
    const key = (tk.activityId || '') + '|' + (tk.nodeId || '') + '|' + tk.quantity;
    if (key !== sampleKey) { sampleKey = key; samples = []; }
    const now = Date.now(); if (!samples.length || now - samples[samples.length - 1].t > 4000) samples.push({ t: now, p: tk.progress }); if (samples.length > 8) samples.shift();
    if (samples.length < 2) return NaN;
    const a = samples[0], z = samples[samples.length - 1], dp = z.p - a.p, dt = (z.t - a.t) / 60000;
    return dp > 0 && dt > 0 ? ((tk.quantity - tk.progress) / (dp / dt)) * 60 : NaN;
  }
  // e = the colour that frames the card (lucky, then quest, then boost); mk = every category icon the card carries, strongest first
  // Slay tasks pay and take about 1.5x the game's numbers since 22 October: totals and ETAs (not XP an hour) carry the measured correction (task-log.js slayK)
  const slayK = (op) => { try { const k = op.kind === 'slay' && window.__ccTaskLog && window.__ccTaskLog.slayK ? window.__ccTaskLog.slayK() : null; return k && !k.off ? k : null; } catch (e) { return null; } };
  function optInfo(op, tierOf, si, k) {
    const sk = slayK(op), quest = !!(op.quest && op.quest.length), lucky = !!op.lucky, boost = (op.boostDrops || 0) > 0, g = tierOf(op, si, k), mk = [];
    if (lucky) mk.push('lucky'); if (quest) mk.push('quest'); if (g.diary) mk.push('diary'); if (boost) mk.push('boost'); if (g.tp) mk.push('tp');
    return { act: op.act, node: op.node, k: op.kind === 'slay' ? 'kill' : 'skill', skill: op.skill, qty: op.qty || 0, timeSec: (op.timeSec || 0) * (sk ? sk.t : 1), xp: (op.totalXp || 0) * (sk ? sk.x : 1), corr: sk ? sk.text : '', corrMeasured: !!(sk && sk.measured), xpHr: op.xpHr, success: op.success, xpBonus: op.xpBonus || 0,
      e: lucky ? 'lucky' : quest ? 'quest' : boost ? 'boost' : '', lucky, boost, diary: g.diary, tp: g.tp, mk, quest: (op.quest || []).map((q) => q.name), tier: g.tier, ui: op.ui || null, name: pretty(op.act), place: pretty(op.node), skillName: pretty(op.skill) };
  }
  // the queue as the game really has it (the game data bridge), with the walks, tiers and the advisor's recommended order
  function model() {
    const b = bridge(); let pr = null, lv = null;
    try { pr = b && b.project && b.project(); lv = b && b.live && b.live(); } catch (e) { /* not ready */ }
    if (!pr) return null;
    const tierOf = gameTiers(), spd = b.speed ? b.speed() : null, speed = spd ? spd.sps : 0;   // walking speed: the bridge's single source
    let rec = null; try { const ra = window.__ccRouteAdvisor; rec = ra && ra.recommended ? ra.recommended() : null; } catch (e) { rec = null; }
    const m = { head: null, slots: [], total: 0, speed };
    try { m.ctl = b.queueCtl ? b.queueCtl() : null; } catch (e) { m.ctl = null; }
    // Material shortage per task, counted pessimistically: only a part of your save-materials chance is assumed (Settings > Materials Saves Counted, default 50%: a 10% chance counts as 5%).
    //   bad  = you hold under 75% of what the task needs;  warn = 75% or more but not enough even with that cautious save chance;
    //   save = enough only with the cautious save chance (it relies on saves);  nothing = you hold what it needs.
    const mats = {};
    try {
      const credit = Math.max(0, Math.min(1, Number(window.__ccPluginSettings.get('materialShortageSaveCredit') != null ? window.__ccPluginSettings.get('materialShortageSaveCredit') : 50) / 100));
      (b.shortages && b.shortages(credit) || []).forEach((r) => {
        if (!(r.need > 0) || r.have >= r.need) return;
        const exp = r.need * (1 - r.save * credit), ratio = r.have / r.need, lvl = r.have >= exp ? 'save' : ratio >= 0.75 ? 'warn' : 'bad', miss = Math.max(1, Math.ceil(exp - r.have));
        mats[r.where === 'now' ? 'now' : String(r.where)] = { lvl, text: (lvl === 'save' ? 'Enough only if your saves come in: ' : 'Short by about ' + miss + ' ') + (lvl === 'save' ? '' : '') + r.inputName + '. Have ' + Math.floor(r.have) + ', needs ' + r.need + ' without saves (about ' + Math.ceil(exp) + ' counting ' + Math.round(r.save * credit * 100) + '% saved).' };
      });
    } catch (e) { /* no shortage data */ }
    m.mats = mats;
    m.queued = null;   // the game's "Combat Queued" / "Skilling Queued" dividers
    try { const qd = b.queued ? b.queued() : null; if (qd && (qd.combat || qd.skilling) && setting('uiQueueQueued', true)) m.queued = qd; } catch (e) { m.queued = null; }
    const hd = pr.head, tk = lv && lv.task;
    if (hd || tk) {
      const fight = !!(hd && hd.kind === 'slay'), tkk = fight ? null : tk;   // a fight has no skilling task: its progress is the kill count (the game's killCount / killTarget), which the projected head carries as done / qty
      const o = optInfo(hd || {}, tierOf), eta = tkk && tkk.quantity ? etaOf(tkk) : NaN;
      o.timeLeft = isFinite(eta) ? eta : o.timeSec;
      if (tkk && tkk.nodeName) o.place = tkk.nodeName;
      if (tkk && (tkk.activityName)) o.name = tkk.activityName;
      o.done = fight ? (hd.done || 0) : tkk && tkk.quantity ? tkk.progress : 0; o.goal = fight ? (hd.qty || o.qty) : tkk && tkk.quantity ? tkk.quantity : o.qty;
      try { const rd = o.node && b.remain ? b.remain(o.node) : null; o.steps = rd > 0 ? rd : 0; } catch (e) { o.steps = 0; }   // the walk still ahead to the current task
      try { o.cur = b.current ? b.current() : null; } catch (e) { o.cur = null; }   // the Current Task panel's level bar and combat lines
      o.xLv = !!(o.cur && o.cur.lv && setting('uiQueueHeadLevel', true));
      o.xCi = !!(o.cur && o.cur.combat && ((o.cur.loadout && setting('uiQueueHeadLoadout', true)) || (o.cur.train && setting('uiQueueHeadTraining', true)) || (o.cur.kills && setting('uiQueueHeadKills', true))));
      o.mat = mats.now || null; m.head = o; m.total += o.timeLeft;
    }
    const seen = {};
    (pr.slots || []).forEach((sl, i) => {
      const opts = (sl.options || []).map((op, k) => optInfo(op, tierOf, sl.index, k));
      let sel = sl.selected; const ov = optSel[sl.index];
      if (ov) { const kk = opts.findIndex((o) => o.node === ov.node && (!ov.act || o.act === ov.act)); if (kk === sl.selected || kk < 0 || Date.now() - ov.t > 6000) delete optSel[sl.index]; else sel = kk; }
      if (!opts[sel]) sel = 0; if (!opts.length) return;
      const rkey = opts.map((o) => o.node).sort().join(','), rnth = seen[rkey] || 0; seen[rkey] = rnth + 1;
      const r0 = rec && rec.find((e) => e.key === rkey && e.nth === rnth) || null;
      let bestK = -1, bestV = -1; opts.forEach((o, k) => { if (Number.isFinite(o.xpHr) && o.xpHr > bestV) { bestV = o.xpHr; bestK = k; } });
      let advK = -1; if (r0) advK = opts.findIndex((o) => o.node === r0.node);
      let hop = null;
      try { const h = b.hop(sl.index, opts[sel].node, opts[sel].k === 'kill'); if (h && Number.isFinite(h.d) && h.d >= 1) { const f = h.d / (h.th || 12000); hop = { d: h.d, tp: !!h.tp, lvl: h.tp ? 't' : f < 0.25 ? '1' : f < 0.5 ? '2' : f < 0.75 ? '3' : '4', sec: spd ? spd.time(h.d) : 0 }; } } catch (e) { hop = null; }
      m.slots.push({ mat: mats[String(sl.index + 1)] || null, index: sl.index, n: i + 1, opts, sel, bestK, advK: advK >= 0 && advK !== sel ? advK : -1, rkey, rnth, recPos: r0 && r0.pos !== i + 1 ? r0.pos : 0, hop });
      m.total += opts[sel].timeSec;
    });
    // The NEW TASKS bar: where freshly rolled tasks enter. Shown only when the game lets you move it (Surveyor's Mark) and the switch is on.
    //   at = the row it sits before (slots.length = after the last one); a move you just made shows at once, before the game's own data has caught up.
    m.insert = null;
    try {
      const gi = b.queueInsert ? b.queueInsert() : null, n = m.slots.length;
      if (gi && gi.movable && n && setting('uiQueueInsertBar', true)) {
        const lo = Math.min(gi.min, n), cl = (v) => Math.max(lo, Math.min(n, v));
        let at = cl(gi.at == null ? n : gi.at);
        if (insOv) { if (cl(insOv.at) === at || Date.now() - insOv.t > 6000) insOv = null; else at = cl(insOv.at); }
        m.insert = { at, min: lo, n };
      }
    } catch (e) { m.insert = null; }
    // "Relative walking bars": the longest walk in this queue is the full bar (a teleported hop keeps its own colour)
    try {
      const PSr = window.__ccPluginSettings, rel = PSr && PSr.get('queueWalkRelative') === true;
      if (rel) { const mx = Math.max(1, ...m.slots.map((s) => (s.hop && !s.hop.tp ? s.hop.d : 0))); m.slots.forEach((s) => { if (s.hop && !s.hop.tp) { const f = s.hop.d / mx; s.hop.lvl = f < 0.25 ? '1' : f < 0.5 ? '2' : f < 0.75 ? '3' : '4'; } }); }
    } catch (e) { /* settings not there */ }
    return m;
  }

  // ---------------------------------------------------------------- game actions (only on your own click or drag)
  function flash(msg) {
    try { window.__ccUI.toast(msg, { tone: 'warn' }); } catch (e) { /* kit not there */ }
  }
  // The game does not redraw its queue panel while it is hidden, so before a click or drag is passed to its rows they are redrawn and checked against the game's own data.
  function rowsFresh() {
    const b = bridge(); let p = null; try { freshQ(); p = b && b.project && b.project(); } catch (e) { return false; }
    if (!p || !p.slots) return false;
    const rows = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'));
    if (rows.length !== p.slots.length) return false;
    const key = (list) => list.map((x) => x.node + '|' + x.sel).sort().join(',');
    return p.slots.every((s, i) => {
      const dom = Array.from(rows[i].querySelectorAll('.icon-option')).map((o) => { const sc = o.querySelector('.icon-scroll-row'); return { node: sc ? sc.dataset.nodeId : '', sel: o.classList.contains('selected') ? 1 : 0 }; });
      const gm = s.options.map((o, k) => ({ node: o.node, sel: k === s.selected ? 1 : 0 }));
      return dom.length === gm.length && key(dom) === key(gm);
    });
  }
  // the game's own Reroll (queued rows) and Skip (the current task) buttons: one click on our tile is one click on that button, same cost, same credits
  function rerollEl(slotIdx) {
    const row = slotIdx < 0 ? document.querySelector('#unified-queue-panel .uq-current') : Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'))[slotIdx];
    return row ? row.querySelector('.reroll-option') : null;
  }
  function rerollInfo(slotIdx) {
    try { freshQ(); } catch (e) { /* ignore */ }
    const e = rerollEl(slotIdx); if (!e) return null;
    const lines = Array.from(e.querySelectorAll('.icon-tooltip .tt-name, .icon-tooltip .tt-line')).map((x) => x.textContent.trim()).filter(Boolean), bg = e.querySelector('.uq-cost-badge');
    return { cost: bg ? bg.textContent.trim() : '', lines, disabled: /disabled|locked|insufficient|no-credit/i.test(e.className) };
  }
  function doReroll(slotIdx) {
    if (!rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was rerolled. Open the game’s Tasks panel once and try again.'); return false; }
    const e = rerollEl(slotIdx); if (!e) { flash('The game has no reroll button for this task right now.'); return false; }
    const before = slotKey(slotIdx), row = document.querySelector('.cc-q-row[data-s="' + slotIdx + '"]'); if (row) row.classList.add('is-rolling');
    e.click(); watchSlot(slotIdx, before); return true;
  }
  // the options of one row as one string: it changes when a reroll (or a swap) has landed
  function slotKey(idx) { try { const m = model(), s = m && m.slots.find((x) => x.index === idx); return s ? s.opts.map((o) => o.node + '|' + o.act + '|' + o.qty).join(',') : idx < 0 && m && m.head ? m.head.node + '|' + m.head.act : ''; } catch (e) { return ''; } }
  let watchT = 0;
  function watchSlot(idx, before) {
    clearInterval(watchT); let n = 0;
    watchT = setInterval(() => {
      n++; try { const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); } catch (e) { /* stale panel */ }
      if (slotKey(idx) !== before || n > 30) { clearInterval(watchT); refreshAll(true); document.querySelectorAll('.cc-q-row.is-rolling').forEach((r) => r.classList.remove('is-rolling')); }
    }, 80);   // every 80 ms for up to 2.4 s: the new row appears the moment the game has it
  }
  let renderHold = 0, settleT = 0;
  // After a move the game needs a moment to reorder its own data. Poll its queue panel (as a reroll does) and redraw the moment the order changed, instead of waiting for the next slow refresh.
  const orderSig = () => { try { const m = model(); return m ? m.slots.map((x) => x.rkey).join(',') : ''; } catch (e) { return ''; } };
  function settleAfterReorder(before) {
    clearInterval(settleT); let n = 0;
    settleT = setInterval(() => {
      n++; try { const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); } catch (e) { /* stale panel */ }
      if (orderSig() !== before || n > 24) { clearInterval(settleT); renderHold = 0; refreshAll(true); }
    }, 60);   // every 60 ms for up to 1.4 s
  }
  function selectOption(slotIdx, k, op) {
    if (!rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was changed. Open the game’s Tasks panel once and try again.'); return false; }
    const rows = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)')), row = rows[slotIdx]; if (!row) return false;
    const opts = Array.from(row.querySelectorAll('.icon-option'));
    const idOf = (o) => { const s = o.querySelector('.icon-scroll-row'); return s ? { act: s.dataset.activityId, node: s.dataset.nodeId } : {}; };
    const target = opts.find((o) => { const d = idOf(o); return d.node === op.node && (!d.act || d.act === op.act); }) || opts[k];
    if (!target || target.classList.contains('selected')) return false;
    target.click();
    optSel[slotIdx] = { node: op.node, act: op.act, t: Date.now() };
    refreshAll(true);
    return true;
  }
  function reorderSlot(from, to) {
    if (!rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was moved. Open the game’s Tasks panel once and try again.'); return false; }
    const rs = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'));
    if (!rs[from] || !rs[to] || from === to) return false;
    const before = orderSig();
    const ok = laidOut(rs[from], () => {
      const rf = rs[from].getBoundingClientRect(), rt = rs[to].getBoundingClientRect();
      if (!rf.height || !rt.height) return false;
      const x = rf.left + rf.width / 2, y0 = rf.top + rf.height / 2, y1 = to < from ? rt.top + 2 : rt.bottom - 2;
      const fire = gameFire(x);
      fire('pointerdown', rs[from], y0); fire('pointermove', rs[from], y0 + (y1 > y0 ? 30 : -30)); fire('pointermove', rs[to], y1); fire('pointerup', rs[to], y1);
      return true;
    });
    if (!ok) return false;
    renderHold = Date.now() + 1600;
    settleAfterReorder(before);
    fwd();
    return true;
  }
  // The game's own divider of a queued task (it keeps one per kind in its Tasks panel, shown or not): the click on ours is passed on to it, so what happens is the game's own
  const gameDivider = (kind) => document.querySelector(kind === 'skilling' ? '.skilling-queued-divider' : '.combat-queued-divider:not(.skilling-queued-divider)');
  function cancelQueued(kind) {   // the divider's cross: the game cancels the queued task itself
    const g = gameDivider(kind), btn = g && g.querySelector('.cqd-cancel');
    if (!btn) { flash('The game has no queued ' + kind + ' to cancel right now. Open the game’s Tasks panel once and try again.'); return false; }
    btn.click(); fwd(); return true;
  }
  function openQueued(kind) {   // the divider itself: a queued fight opens its mob in the game's mob selection, queued skilling shows the task on the map
    const g = gameDivider(kind); if (!g) return false;
    g.click(); return true;
  }
  // Click a card = the game's own row click (the map pans to the task); the current card has no row click in the game, so its own Ctrl-click on the picked option is used.
  function panToRow(row) {
    const s = row._s; if (!s) return false;
    if (s.now) {
      const o = gameOption(-1, 0, row.dataset.node, row.dataset.act); if (!o) return false;
      o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); return true;
    }
    if (!rowsFresh()) { flash('The game’s queue panel is out of date, so the map was not moved. Open the game’s Tasks panel once and try again.'); return false; }
    const g = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'))[s.index]; if (!g) return false;
    g.click(); return true;
  }
  // Right-click: the game builds what a right-click opens (a fight's combat calculator, the Auto Loadout defaults) inside the contextmenu handler of its own element, so the same
  // right-click is handed to that element, a moment after yours so a click-away rule of the game does not close it at once.
  function forwardCtx(target, x, y) {
    if (!target) return false;
    setTimeout(() => { try { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); } catch (e) { /* the element is gone */ } }, 80);
    return true;
  }
  // Right-click a fight card: a small menu of what the game offers on that row. Each item is passed on to the game's own element when you choose it:
  //  - Open combat calculator = the game's right-click on the row;  - Train <the other skill> instead = a click on the "Training" icon of the game's row ("Click to train strength instead");
  //  - Switch combat loadout (the current fight only) = a click on the loadout words of the game's Current Task panel.
  function ctxRow(row, x, y) {
    const s = row._s; if (!s) return false;
    if (s.now) { try { const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); } catch (e) { /* stale panel */ } }
    else if (!rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was opened. Open the game’s Tasks panel once and try again.'); return false; }
    const g = s.now ? document.querySelector('#unified-queue-panel .uq-current') : Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'))[s.index];
    if (!g) return false;
    const items = [], wraps = Array.from(g.querySelectorAll('.uq-sub-wrap')), lw = wraps.find((w) => { const n = w.querySelector('.tt-name'); return n && n.textContent === 'Loadout'; });
    if (lw) items.push({ label: 'Open combat calculator', onClick: () => forwardCtx(g, x, y) });
    let xp = g.querySelector('.uq-xp-icon');
    const hudT = s.now ? hudCols()[1] : null, cu = s.now ? (() => { try { return bridge().current(); } catch (e) { return null; } })() : null;
    if (hudT && cu && cu.other) items.push({ label: 'Train ' + cu.other + ' instead (' + cu.loadout + ', now ' + cu.train + ')', onClick: () => forwardClick(hudT) });
    else if (xp) {
      const hint = xp.querySelector('.tt-line:last-child'), now = xp.querySelector('.uq-tt-row span'), lo = lw && lw.querySelector('.uq-tt-row span');
      const what = hint ? hint.textContent.replace(/^Click to /, '') : 'switch the trained skill';
      items.push({ label: what.charAt(0).toUpperCase() + what.slice(1) + ' (' + (lo ? lo.textContent + ', ' : '') + 'now ' + (now ? now.textContent : '') + ')', onClick: () => forwardClick(xp) });
    }
    if (s.now) { const hud = hudCols()[0], nm = hud ? hud.textContent.replace(/^Loadout:\s*/, '').trim() : ''; if (nm) items.push({ label: 'Switch combat loadout (now ' + nm + ')', onClick: () => forwardClick(hud) }); }
    if (!items.length) return false;
    items.unshift({ head: s.now ? 'Current fight' : 'Fight' });
    UI.menu(items, x, y); return true;
  }
  // The game measures its rows' screen positions when a drag moves, and a hidden panel has none: for the moment of the gesture the game's window is laid out invisibly.
  function laidOut(row, fn) {
    let tmp = null;
    if (!row.getBoundingClientRect().height) { tmp = el('style'); tmp.textContent = '#ui-container :has(> .panel-titlebar[data-panel-id="tasks"]){display:flex !important;visibility:hidden !important}'; document.head.appendChild(tmp); }
    let r = false; try { r = fn(); } finally { if (tmp) setTimeout(() => tmp.remove(), 60); }
    return r;
  }
  // a pointer event the way the game's own drag handlers receive it (they listen for pointerdown on the thing and pointermove / pointerup on it or the window)
  const gameFire = (x) => (type, tgt, y) => tgt.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse', pointerId: 1, isPrimary: true, view: window }));
  // The game keeps where new tasks land in queueInsertAt and changes it only through its own NEW TASKS bar (a drag, then a message to the server). Your drag of our bar is replayed on that bar:
  // the game works out the target row from its row positions and sends the change itself, so the rules (lowest row, unlock) stay the game's.
  function moveInsert(to) {
    if (!rowsFresh()) { flash('The game\u2019s queue panel is out of date, so the NEW TASKS bar was not moved. Open the game\u2019s Tasks panel once and try again.'); return false; }
    const pn = document.getElementById('unified-queue-panel'), bar = pn && pn.querySelector('.uq-insert'), rs = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'));
    if (!bar || !rs.length) { flash('The game has no NEW TASKS bar right now, so it was not moved.'); return false; }
    const ok = laidOut(rs[0], () => {
      const last = rs[rs.length - 1].getBoundingClientRect(), tgt = to < rs.length ? rs[to].getBoundingClientRect() : last;
      if (!tgt.height) return false;
      const y = to < rs.length ? tgt.top + 2 : last.bottom - 2, fire = gameFire(tgt.left + tgt.width / 2);
      fire('pointerdown', bar, y); fire('pointermove', window, y); fire('pointerup', window, y);   // the game takes the row under the pointer; lifting sends the change
      return true;
    });
    if (!ok) flash('The game\u2019s queue panel could not be measured, so the NEW TASKS bar was not moved.');
    return ok;
  }

  // ---------------------------------------------------------------- styles (the shared look is in ui-kit: tokens, .cc-pill, .cc-tile, .cc-spin, .cc-skel ...)
  const style = el('style'); style.id = 'cc-queue-style';
  style.textContent = String.raw`
.cc-qroot{--s:1;--u:calc(var(--s) * 1px);--cc-q-ease:cubic-bezier(.2,.8,.2,1);
  --q-pad:calc(10*var(--u));--q-rowh:calc(50*var(--u));--q-nowh:calc(70*var(--u));--q-tile:calc(42*var(--u));--q-hop:calc(10*var(--u));--q-num:calc(24*var(--u));--q-mk:calc(22*var(--u));--q-dim:color-mix(in srgb,var(--cc-text-dim) 55%,var(--cc-text));
  --q-fs-t:calc(14*var(--u));--q-fs-s:calc(12*var(--u));--q-fs-x:calc(11*var(--u));
  position:relative;display:flex;flex-direction:column;box-sizing:border-box;min-height:0;font:400 var(--q-fs-s)/1.25 var(--cc-font);color:var(--cc-text);-webkit-font-smoothing:antialiased}
.cc-qroot *,.cc-qroot *::before,.cc-qroot *::after{box-sizing:border-box}
.cc-qroot [hidden]{display:none!important}
.cc-qroot i,.cc-qroot em{font-style:normal}
.cc-qroot :where(button){font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}
.cc-qroot :focus-visible{outline:2px solid var(--cc-info);outline-offset:1px}
/* the kept panel: the kit's panel is the shell; this panel just fills it */
#cc-queue .bd{padding:0 !important;gap:0 !important;overflow:hidden !important}
#cc-queue .hd b.cc-q-title0{display:flex;flex-direction:column;gap:1px;min-width:0;color:var(--cc-text);font-size:calc(16px * var(--cc-qs,1));font-weight:700;line-height:1.2}
#cc-queue .hd .cc-q-sum{font-size:var(--cc-fs-sm);font-weight:400;color:var(--cc-text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-queue .hd .cc-q-sum b{color:var(--cc-text);font-weight:600}
#cc-queue.min .cc-q-sum{display:none}
#cc-queue[data-bp=micro] .hd b.cc-q-title0{display:none}
#cc-queue[data-bp=micro] .hd{justify-content:center}
#cc-queue[data-bp=micro] .hd .min{display:none}
#cc-queue .cc-qroot{flex:1 1 auto}
.cc-q-list{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--q-pad) var(--q-pad) calc(var(--q-pad) - 2px);scrollbar-width:thin;scrollbar-color:var(--cc-border-strong) transparent}
.cc-q-foot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:calc(8*var(--u));padding:calc(8*var(--u)) calc(14*var(--u));border-top:1px solid var(--cc-border);font-size:var(--q-fs-s);color:var(--cc-text-dim)}
.cc-q-hint{font-size:var(--q-fs-x);color:var(--cc-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* the hover card: the same content with its own shell */
.cc-qroot[data-mode=hover] .cc-q-panel{position:relative;z-index:2;display:flex;flex-direction:column;min-height:0;max-height:var(--cc-q-maxh,none);background:var(--cc-bg);border:1px solid var(--cc-border);border-radius:var(--cc-r);box-shadow:var(--cc-shadow)}
.cc-qroot[data-mode=hover] .cc-q-head{flex:none;display:flex;flex-direction:column;gap:1px;padding:calc(10*var(--u)) calc(14*var(--u)) calc(8*var(--u));border-bottom:1px solid var(--cc-border)}
.cc-qroot[data-mode=hover] .cc-q-h{font-size:calc(16*var(--u));font-weight:700;line-height:1.2}
.cc-qroot[data-mode=hover] .cc-q-sum{font-size:var(--q-fs-s);color:var(--cc-text-dim)}
.cc-qroot[data-mode=hover] .cc-q-sum b{color:var(--cc-text);font-weight:600}
.cc-qroot[data-mode=hover] .cc-q-row{cursor:default}
.cc-qroot[data-mode=hover]::after{content:"";position:absolute;left:0;right:0;bottom:-14px;height:14px}
/* task cards */
/* ONE outline language (the game's queue reads at a glance because its outlines are heavy): every card has a 2px frame, every tile a 3px lane outline (green skilling, red combat).
   Frame colour says what the card is: grey = normal, lane colour = the current task, gold = lucky, blue = quest step, purple = XP-boost drop. The Route Advisor's pick is the only DASHED outline. */
.cc-q-row{--rs:2;--k:var(--cc-good);--kr:var(--cc-q-skill-rgb);--fr:var(--cc-text-faint);--ec:transparent;--glow:0 0 0 0 transparent;
  position:relative;display:grid;grid-template-columns:var(--q-num) var(--q-tile) minmax(0,1fr) auto calc(10*var(--u));column-gap:calc(8*var(--u));align-content:center;align-items:center;
  height:var(--q-rowh);padding:0 calc(8*var(--u)) 0 calc(3*var(--u));background-color:var(--cc-bg-3);border:2px solid var(--fr);border-radius:var(--cc-r-sm);
  box-shadow:var(--glow);cursor:grab;user-select:none;transition:background-color .12s,border-color .12s,box-shadow .18s,opacity .12s}
.cc-q-row[data-k=kill]{--k:var(--cc-q-kill);--kr:var(--cc-q-kill-rgb)}
.cc-q-row[data-e=lucky]{--ec:var(--cc-accent)}
.cc-q-row[data-e=quest]{--ec:var(--cc-info)}
.cc-q-row[data-e=boost]{--ec:var(--cc-magic)}
.cc-q-row[data-e]{--fr:var(--ec);background-image:linear-gradient(90deg,color-mix(in srgb,var(--ec) 13%,transparent),transparent 70%)}
.cc-q-row:hover,.cc-q-row.is-open{background-color:var(--cc-bg-hover)}
.cc-q-row:not([data-e]):hover,.cc-q-row.is-open:not([data-e]){--fr:var(--cc-text)}
.cc-q-row[data-e],.cc-q-row.is-now{--q-dim:color-mix(in srgb,var(--cc-text-dim) 30%,var(--cc-text))}   /* the dim lines must still reach 4.5:1 on a tinted card */
.cc-q-row:active{background-color:var(--cc-bg-hover);cursor:grabbing}
.cc-q-row.is-dragging{opacity:.32}
.cc-q-row[data-sw]{border-color:var(--cc-accent);box-shadow:inset calc(4*var(--u)) 0 0 var(--cc-accent),var(--glow)}
.cc-q-switch{position:absolute;right:calc(10*var(--u));top:calc(-9*var(--u));z-index:2;display:flex;align-items:center;gap:calc(4*var(--u));max-width:calc(100% - 60*var(--u));height:calc(15*var(--u));padding:0 calc(8*var(--u));border-radius:99px;background:var(--cc-accent);color:var(--cc-accent-ink);font-size:var(--q-fs-x);font-weight:700;line-height:1;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:auto}
.cc-q-switch b{font-size:1.15em}.cc-q-switch span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.cc-qroot[data-bp=micro] .cc-q-switch span{display:none}
.cc-q-row.is-adv{outline:calc(3*var(--u)) dashed var(--cc-accent);outline-offset:calc(2*var(--u));--glow:0 0 14px color-mix(in srgb,var(--cc-accent) 55%,transparent);animation:cc-q-pulse 1.5s ease-in-out infinite}
.cc-q-row.is-dropped{animation:cc-q-drop .7s ease-out}
.cc-q-ghost{position:fixed!important;z-index:2147482620;margin:0;pointer-events:none;background-color:var(--cc-bg-hover);box-shadow:0 12px 28px rgba(0,0,0,.6);transform:scale(1.015);opacity:.8}
.cc-q-num{grid-column:1;grid-row:1 / span var(--rs);text-align:center;font-size:calc(13*var(--u));font-weight:700;line-height:1.05;color:var(--q-dim);font-variant-numeric:tabular-nums}
.cc-q-num i{display:block;margin-top:calc(1*var(--u));font-size:var(--q-fs-x);color:var(--cc-accent);cursor:help}
.cc-q-tt{grid-column:3;grid-row:1;align-self:end;display:flex;align-items:center;gap:calc(5*var(--u));min-width:0;font-size:var(--q-fs-t);font-weight:700;line-height:1.25;color:var(--cc-text)}
.cc-q-tt span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cc-q-xtra{margin-top:calc(6*var(--u));padding-top:calc(5*var(--u));border-top:1px solid rgba(255,255,255,.12)}.cc-q-row.is-rolling{opacity:.65}.cc-q-row.is-rolling .cc-q-tile{animation:cc-q-pulse-o .7s ease-in-out infinite}
.cc-q-ctl{display:flex;align-items:center;gap:calc(8*var(--u));flex:none;flex-wrap:wrap;padding:calc(6*var(--u)) var(--q-pad) calc(2*var(--u))}
.cc-q-ctl[hidden]{display:none}
.cc-q-ctlt{flex:none;width:calc(18*var(--u));height:calc(18*var(--u));padding:0;border:0;border-radius:calc(5*var(--u));background:transparent;color:var(--cc-text-dim);cursor:pointer;font-size:calc(11*var(--u));line-height:1}
.cc-q-ctlt:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-q-fsum{display:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cc-text-dim);font-size:calc(11.5*var(--u))}
.cc-q-ctl.fold{flex-wrap:nowrap;padding-top:calc(3*var(--u));padding-bottom:calc(1*var(--u))}
.cc-q-ctl.fold>*:not(.cc-q-ctlt):not(.cc-q-fsum){display:none}
.cc-q-ctl.fold .cc-q-fsum{display:block}
.cc-q-ctl .cc-seg button{height:calc(22*var(--u));padding:0 calc(9*var(--u));font-size:calc(11.5*var(--u))}
.cc-q-masters{display:flex;gap:calc(4*var(--u))}
.cc-q-mt{position:relative;width:calc(28*var(--u));height:calc(28*var(--u));padding:0;border-radius:calc(7*var(--u));border:1px solid var(--cc-border);background:var(--cc-bg-2);cursor:pointer;display:grid;place-items:center;transition:border-color .12s,background-color .12s,transform .12s}
.cc-q-mt img{width:calc(22*var(--u));height:calc(22*var(--u));image-rendering:pixelated}
.cc-q-mt i{position:absolute;right:calc(-3*var(--u));bottom:calc(-3*var(--u));padding:0 calc(3*var(--u));border-radius:calc(5*var(--u));background:rgba(10,10,18,.94);font-style:normal;font-size:calc(9*var(--u));font-weight:700;line-height:1.4;color:var(--cc-text-dim)}
.cc-q-mt:hover{border-color:var(--cc-border-strong);background:var(--cc-bg-hover)}
.cc-q-mt.is-sel{border-color:var(--cc-accent);box-shadow:0 0 0 1px var(--cc-accent);background:var(--cc-accent-bg);cursor:default}
.cc-q-mt.is-locked{opacity:.38;filter:grayscale(.7);cursor:not-allowed}
.cc-q-cr{margin-left:auto;font-size:calc(11.5*var(--u));font-weight:600;color:var(--cc-text-dim);white-space:nowrap;font-variant-numeric:tabular-nums}
.cc-q-au{height:calc(22*var(--u));padding:0 calc(9*var(--u));font-size:calc(11*var(--u))}
.cc-qroot[data-bp=micro] .cc-q-ctl{display:none}
.cc-q-xl{font-size:inherit;line-height:1.35;white-space:normal;overflow-wrap:break-word}
#cc-q-tip3 .cc-q-xi{display:flex;align-items:flex-start;gap:6px;font-weight:600}
#cc-q-tip3 .cc-q-xi img{flex:none;width:20px;height:20px;image-rendering:pixelated;filter:drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000)}
#cc-q-tip3 .cc-q-xi i{flex:none;width:18px;height:18px;margin-top:1px;display:grid;place-items:center;border-radius:5px;color:#10101a;font-size:11px;font-weight:800;line-height:1}
#cc-q-tip3 .cc-q-xtra{width:0;min-width:100%;white-space:normal}   /* the added lines wrap inside the game's tooltip instead of widening or overflowing it */
.cc-q-matnote{font-style:normal;font-size:calc(10.5*var(--u));font-weight:700;line-height:1.5;padding:0 calc(5*var(--u));border-radius:calc(4*var(--u));background:var(--cc-sunk);border:1px solid var(--cc-border);color:var(--cc-text-dim)}
.cc-q-tier{flex:none;padding:0 calc(4*var(--u));border-radius:calc(4*var(--u));background:var(--cc-sunk,var(--cc-bg));border:1px solid var(--cc-border-strong);font-size:var(--q-fs-x);font-weight:700;line-height:1.35;color:var(--cc-text);font-variant-numeric:tabular-nums}
.cc-q-row[data-k=kill] .cc-q-tier{color:#ffb4b4;border-color:var(--cc-q-kill)}
.cc-q-tt b{flex:none;font-weight:700;color:var(--cc-text);font-variant-numeric:tabular-nums}
.cc-q-sub{grid-column:3;grid-row:2;align-self:start;display:flex;min-width:0;font-size:var(--q-fs-s);color:var(--q-dim)}
.cc-q-sub i{flex:none;color:var(--q-dim)}
.cc-q-sub i::after{content:"\B7";margin:0 calc(4*var(--u))}
.cc-q-sub span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cc-q-meta{grid-column:4;grid-row:1 / span var(--rs);display:flex;flex-direction:column;justify-content:center;align-items:flex-end;white-space:nowrap;font-variant-numeric:tabular-nums}
.cc-q-time{font-size:var(--q-fs-t);font-weight:600}
.cc-q-xp{font-size:var(--q-fs-s);color:var(--q-dim)}
.cc-q-xph{display:none;color:var(--q-dim)}
.cc-q-xph::before{content:"\B7";margin:0 calc(4*var(--u))}
.cc-qroot[data-wide] .cc-q-xph{display:inline}
.cc-q-dots{grid-column:5;grid-row:1 / span var(--rs);display:flex;flex-direction:column;align-items:center;gap:calc(3*var(--u))}
.cc-q-dots i{width:calc(5*var(--u));height:calc(5*var(--u));border-radius:50%;background:var(--cc-border-strong);transition:background .12s}
.cc-q-dots i.on{background:var(--cc-accent)}
.cc-q-row:hover .cc-q-dots i,.cc-q-row.is-open .cc-q-dots i{background:var(--cc-text-faint)}
.cc-q-row:hover .cc-q-dots i.on,.cc-q-row.is-open .cc-q-dots i.on{background:var(--cc-accent)}
/* the current task */
.cc-q-row.is-now{--rs:3;--q-tile:calc(58*var(--u));--fr:var(--k);height:var(--q-nowh);cursor:default;background-image:linear-gradient(90deg,color-mix(in srgb,var(--k) 10%,transparent),transparent 60%);
  box-shadow:0 2px 10px rgba(0,0,0,.35),var(--glow)}
.cc-q-row.is-now[data-e]{background-image:linear-gradient(90deg,color-mix(in srgb,var(--ec) 13%,transparent),transparent 70%)}
.cc-q-row.is-now:active{cursor:default;background-color:var(--cc-bg-3)}
.cc-q-row.is-now .cc-q-num{color:var(--cc-accent);font-size:calc(14*var(--u))}
.cc-q-row.is-now .cc-q-tt{font-size:calc(var(--q-fs-t) + calc(1*var(--u)));font-weight:700}
.cc-q-bar{grid-column:3;grid-row:3;align-self:start;margin-top:calc(5*var(--u));height:calc(6*var(--u))}
.cc-q-row.is-now .cc-q-time{color:color-mix(in srgb,var(--cc-good) 75%,var(--cc-text))}
/* tiles (cards and option tiles): the icon + tier badge, outline = lane */
.cc-q-row[data-e=lucky] .cc-q-tt>span{color:var(--cc-accent)}
.cc-q-row[data-m=bad] .cc-q-tt>span{color:var(--cc-q-kill)}.cc-q-row[data-m=warn] .cc-q-tt>span{color:var(--cc-warn)}.cc-q-row[data-m=save] .cc-q-tt>span{color:var(--cc-info)}
.cc-mobico{display:block;background-size:contain;background-position:center;background-repeat:no-repeat;image-rendering:pixelated;aspect-ratio:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}   /* the picture is the creature itself, cropped out of its sprite sheet (see mobArt): contain + centre fills the square whatever the sprite's size */
.cc-q-tile{grid-column:2;grid-row:1 / span var(--rs);align-self:center;width:var(--q-tile);height:var(--q-tile);--cc-tile:var(--q-tile)}
.cc-q-tray .cc-q-tile{grid-column:auto;grid-row:auto}
.cc-qroot .cc-q-tile{border:calc(3*var(--u)) solid var(--k);border-radius:calc(7*var(--u));background:var(--cc-bg-2);box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.5)}
.cc-qroot .cc-q-tile .cc-ico{width:78%;height:78%}
.cc-qroot .cc-q-tile .cc-mobico{width:90%;height:90%}
.cc-qroot .cc-q-tile[data-e=lucky]{background:color-mix(in srgb,var(--cc-accent) 22%,var(--cc-bg-2))}
.cc-qroot .cc-q-tile[data-e=quest]{background:color-mix(in srgb,var(--cc-info) 22%,var(--cc-bg-2))}
.cc-qroot .cc-q-tile[data-e=boost]{background:color-mix(in srgb,var(--cc-magic) 22%,var(--cc-bg-2))}
/* category icons: the game's own pictures (clover, quest book, diary book, teleport crystal), each a different SHAPE and colour, big, on the tile's lower right where the eye lands; at most two */
.cc-q-mk{position:absolute;right:calc(-8*var(--u));bottom:calc(-5*var(--u));display:flex;pointer-events:none;z-index:2}
.cc-q-mk>*{flex:none;width:var(--q-mk);height:var(--q-mk);margin-left:calc(-8*var(--u));image-rendering:pixelated;filter:drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000)}
.cc-q-mk>*:first-child{margin-left:0}
.cc-q-mk .cc-q-mkb{display:grid;place-items:center;border-radius:calc(5*var(--u));background:var(--cc-magic);color:var(--cc-accent-ink,#10101a);font-size:calc(13*var(--u));font-weight:700;line-height:1;filter:drop-shadow(0 0 1px #000)}
/* a material shortage: a warning triangle (or a round "i" when it only works with your saves) on the tile's upper right, so it is never colour alone */
.cc-q-row .cc-q-tile[data-m]::after{content:"!";position:absolute;top:calc(-6*var(--u));right:calc(-6*var(--u));width:calc(18*var(--u));height:calc(17*var(--u));display:grid;place-items:end center;padding-bottom:calc(1*var(--u));clip-path:polygon(50% 0,100% 100%,0 100%);font-size:calc(11*var(--u));font-weight:800;line-height:1;color:#10101a;z-index:3;background:var(--cc-warn)}
.cc-q-row .cc-q-tile[data-m=bad]::after{background:var(--cc-q-kill)}
.cc-q-row .cc-q-tile[data-m=save]::after{content:"i";clip-path:circle(50%);place-items:center;padding:0;background:var(--cc-info)}
/* walks */
.cc-q-hop{position:relative;height:var(--q-hop);display:flex;align-items:center;justify-content:center;transition:opacity .12s}
.cc-q-hop{--hw:var(--cc-w1)}
.cc-q-hop::before{content:"";position:absolute;left:calc(14*var(--u));right:calc(14*var(--u));top:50%;height:2px;margin-top:-1px;background:linear-gradient(90deg,transparent,rgba(var(--hw),.6) 18%,rgba(var(--hw),.6) 82%,transparent)}
.cc-q-hop[data-h="1"]{--hw:var(--cc-w1)}.cc-q-hop[data-h="2"]{--hw:var(--cc-w2)}.cc-q-hop[data-h="3"]{--hw:var(--cc-w3)}.cc-q-hop[data-h="4"]{--hw:var(--cc-w4)}.cc-q-hop[data-h=t]{--hw:var(--cc-wt)}
.cc-q-row + .cc-q-row{margin-top:calc(6*var(--u))}
.cc-q-fl{flex:1;min-width:0;white-space:nowrap}
.cc-q-hop .cc-pill{--w:var(--hw);--cc-pill-h:calc(13*var(--u));font-size:var(--q-fs-x);padding:0 calc(9*var(--u))}
/* the option tray (one, outside the scrolling list) */
.cc-q-trayhost{position:fixed;pointer-events:none;z-index:1895}   /* above every ScapeLite panel (band 1100-1890) so the alternatives are never hidden behind a pinned card; the window clip guard still cuts it under the game's windows */
.cc-q-tray{position:relative;display:flex;align-items:center;gap:calc(8*var(--u));height:var(--q-rowh);padding:0 calc(8*var(--u));background:var(--cc-bg-2);border:2px solid var(--cc-text-dim);border-radius:var(--cc-r);box-shadow:0 0 0 1px rgba(0,0,0,.75),var(--cc-shadow);   /* light line inside a dark line: visible on snow, grass and night alike */
  opacity:0;visibility:hidden;pointer-events:none;transition:opacity .14s ease,transform .18s var(--cc-q-ease),visibility 0s .18s}
.cc-q-tray.is-on{opacity:1;visibility:visible;pointer-events:auto;transform:none!important;transition-delay:0s}
.cc-q-tray[data-side=right]{padding-left:calc(18*var(--u));transform:translateX(calc(-16*var(--u)))}
.cc-q-tray[data-side=left]{padding-right:calc(18*var(--u));transform:translateX(calc(16*var(--u)))}
.cc-q-tray[data-side=inset]{transform:translateX(calc(14*var(--u)))}
.cc-q-tray[data-side=column]{flex-direction:column;height:auto;padding:calc(6*var(--u));transform:translateY(calc(-6*var(--u)))}
.cc-q-tray .cc-tile{flex:none;transform:scale(.82);opacity:0;transition:transform .2s var(--cc-q-ease),opacity .16s,border-color .12s,background-color .12s,box-shadow .15s}
.cc-q-tray.is-on .cc-tile{transform:none;opacity:1}
.cc-q-tray.is-on .cc-tile:nth-child(2){transition-delay:.03s}
.cc-q-tray.is-on .cc-tile:nth-child(3){transition-delay:.06s}
.cc-q-opt{cursor:pointer}
.cc-q-reroll{--kr:143,143,164}
.cc-q-reroll .cc-q-glyph{font-size:calc(var(--q-tile) * .5);line-height:1;color:var(--cc-text-dim);transition:color .12s,transform .25s var(--cc-q-ease)}
.cc-q-reroll:hover .cc-q-glyph{color:var(--cc-text);transform:rotate(180deg)}
.cc-q-reroll .cc-tier{color:var(--cc-accent)}
.cc-q-reroll.is-off{opacity:.45;cursor:not-allowed}
.cc-q-tray .cc-q-tile{--q-tile:calc(40*var(--u));--q-mk:calc(20*var(--u))}
.cc-qroot .cc-q-tray .cc-tile .cc-tier{top:0;left:0;bottom:auto;padding:0 calc(4*var(--u));border-radius:calc(4*var(--u)) 0 calc(6*var(--u)) 0;font-size:calc(11*var(--u));line-height:1.3;z-index:2}
/* option states, all as OUTLINES around the tile so the lane colour inside never changes: hover = white, chosen = solid gold + a check, a lucky / quest / boost drop = solid in its colour, the Route Advisor's pick = DASHED gold + a star */
.cc-q-opt:hover{outline:calc(2*var(--u)) solid var(--cc-text);outline-offset:calc(1*var(--u));background-color:var(--cc-bg-hover);transform:translateY(-1px)!important}
.cc-q-opt:active{transform:scale(.94)!important;transition-duration:.05s}
.cc-q-opt[data-e]{outline:calc(2*var(--u)) solid var(--ec);outline-offset:calc(1*var(--u))}
.cc-q-opt[data-e=lucky]{--ec:var(--cc-accent);animation:cc-q-pulse-o 1.4s ease-in-out infinite}
.cc-q-opt[data-e=quest]{--ec:var(--cc-info)}
.cc-q-opt[data-e=boost]{--ec:var(--cc-magic)}
.cc-q-opt.is-adv{outline:calc(3*var(--u)) dashed var(--cc-accent);outline-offset:calc(1*var(--u));animation:cc-q-pulse-o 1.5s ease-in-out infinite}
.cc-q-opt.is-sel{cursor:default;background-color:var(--cc-accent-bg);outline:calc(2*var(--u)) solid var(--cc-accent);outline-offset:0;animation:none}
.cc-q-tray .cc-q-opt.is-sel{--q-tile:calc(44*var(--u));--q-mk:calc(22*var(--u))}   /* the picked task is a little bigger, so it reads as the current one at a glance */
.cc-q-opt.is-sel:hover{transform:none!important}
.cc-q-opt.is-sel::before{content:"\2713";position:absolute;bottom:calc(-8*var(--u));left:calc(-8*var(--u));width:calc(19*var(--u));height:calc(19*var(--u));border-radius:50%;display:grid;place-items:center;background:var(--cc-accent);color:var(--cc-accent-ink,#10101a);font-size:calc(12*var(--u));font-weight:800;border:1px solid var(--cc-bg);z-index:3}
.cc-qroot .cc-q-tray .cc-tile[data-p]::after{top:calc(-8*var(--u));right:calc(-8*var(--u));width:calc(19*var(--u));height:calc(19*var(--u));font-size:calc(11*var(--u));font-weight:800;border:1px solid var(--cc-bg);z-index:3;color:var(--cc-accent-ink,#10101a)}
.cc-qroot .cc-q-tray .cc-tile[data-p=xp]::after{color:#10101a}
.cc-q-tray.is-wait .cc-q-opt:not(.is-sel){opacity:.45;pointer-events:none}
.cc-q-pop{--pc:var(--cc-text-faint);position:absolute;z-index:2;top:calc(100% + 8px);width:calc(224*var(--u));padding:calc(9*var(--u)) calc(11*var(--u));background:var(--cc-bg);border:2px solid var(--pc);border-radius:var(--cc-r-sm);box-shadow:var(--cc-shadow);
  opacity:0;pointer-events:none;transform:translateY(-4px);transition:opacity .12s,transform .14s var(--cc-q-ease)}
.cc-q-pop[data-k=kill]{--pc:var(--cc-q-kill)}.cc-q-pop[data-k=skill]{--pc:var(--cc-good)}
.cc-q-pop.is-on{opacity:1;transform:none}
.cc-q-pop.is-up{top:auto;bottom:calc(100% + 8px);transform:translateY(4px)}.cc-q-pop.is-up.is-on{transform:none}
.cc-q-tray[data-side=right] .cc-q-pop,.cc-q-tray[data-side=column] .cc-q-pop{left:0}
.cc-q-tray[data-side=left] .cc-q-pop,.cc-q-tray[data-side=inset] .cc-q-pop{right:0}
.cc-q-pop b{display:block;font-size:calc(14*var(--u));font-weight:700;line-height:1.25}
.cc-q-pop em{display:block;margin-top:calc(1*var(--u));font-size:var(--q-fs-s);color:var(--cc-text-dim)}
.cc-q-pop dl{display:grid;grid-template-columns:auto 1fr;gap:calc(3*var(--u)) calc(10*var(--u));margin:calc(7*var(--u)) 0 0;font-size:var(--q-fs-s);font-variant-numeric:tabular-nums}
.cc-q-pop dt{color:var(--cc-text-dim)}.cc-q-pop dd{margin:0;text-align:right;font-weight:600}
.cc-q-pop u{--t:var(--cc-text-dim);display:flex;align-items:center;gap:calc(6*var(--u));margin:calc(6*var(--u)) 0 0;padding:calc(2*var(--u)) calc(7*var(--u)) calc(2*var(--u)) calc(4*var(--u));border-radius:calc(7*var(--u));text-decoration:none;font-size:var(--q-fs-s);font-weight:700;line-height:1.25;color:var(--cc-text);border:2px solid var(--t);background:color-mix(in srgb,var(--t) 16%,var(--cc-bg))}
.cc-q-pop u img{flex:none;width:calc(20*var(--u));height:calc(20*var(--u));image-rendering:pixelated;filter:drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000)}
.cc-q-pop u i{flex:none;width:calc(20*var(--u));height:calc(20*var(--u));display:grid;place-items:center;border-radius:calc(5*var(--u));background:var(--t);color:var(--cc-accent-ink,#10101a);font-size:calc(12*var(--u));font-weight:800}
.cc-q-pop u span{min-width:0;overflow-wrap:anywhere}
.cc-q-pop u[data-t=xp]{--t:var(--cc-good)}.cc-q-pop u[data-t=adv],.cc-q-pop u[data-t=lucky],.cc-q-pop u[data-t=sel]{--t:var(--cc-accent)}.cc-q-pop u[data-t=quest]{--t:var(--cc-info)}.cc-q-pop u[data-t=boost]{--t:var(--cc-magic)}.cc-q-pop u[data-t=diary]{--t:var(--cc-text)}.cc-q-pop u[data-t=tp]{--t:var(--cc-magic)}
/* the NEW TASKS bar: where freshly rolled tasks enter the queue. Gold like the game's own, sits between two cards, grab it anywhere along its length. Rows below it are dimmed (they are pushed down by new tasks). */
.cc-q-insert{position:relative;height:calc(16*var(--u));flex:none;cursor:grab;touch-action:none;user-select:none}
.cc-q-insert::before{content:"";position:absolute;left:calc(2*var(--u));right:calc(2*var(--u));top:50%;height:calc(4*var(--u));margin-top:calc(-2*var(--u));border-radius:calc(3*var(--u));background:var(--cc-accent);box-shadow:0 0 8px color-mix(in srgb,var(--cc-accent) 70%,transparent);transition:box-shadow .12s}
.cc-q-insert:hover::before,.cc-q-insert.is-dragging::before{box-shadow:0 0 14px color-mix(in srgb,var(--cc-accent) 95%,transparent)}
.cc-q-insert b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:calc(2*var(--u)) calc(12*var(--u));border-radius:99px;background:var(--cc-accent);color:var(--cc-accent-ink,#10101a);font-size:var(--q-fs-x);font-weight:800;letter-spacing:.06em;line-height:1.25;white-space:nowrap;pointer-events:none}
.cc-q-insert.is-dragging,.cc-q-insert.is-dragging *{cursor:grabbing}
.cc-q-row.is-held{filter:brightness(.78)}
.cc-q-row.is-held:hover,.cc-q-row.is-held.is-open{filter:none}
.cc-qroot[data-bp=micro] .cc-q-insert{height:calc(12*var(--u))}
.cc-qroot[data-bp=micro] .cc-q-insert b{display:none}
/* the roll-odds hover card (footer): the chance of each skill (or, on the Slay lane, each mob) for the next task roll; hovering a line opens a second card beside it */
.cc-q-odds{flex:none;display:inline-flex;align-items:center;gap:calc(5*var(--u));height:calc(20*var(--u));padding:0 calc(8*var(--u));border:1px solid var(--cc-border);border-radius:99px;background:var(--cc-bg-2);color:var(--cc-text-dim);font-size:var(--q-fs-x);font-weight:600;cursor:help;transition:color .12s,border-color .12s,background-color .12s}
.cc-q-odds::before{content:"%";display:grid;place-items:center;width:calc(13*var(--u));height:calc(13*var(--u));border-radius:50%;background:var(--cc-text-dim);color:var(--cc-bg);font-size:calc(9*var(--u));font-weight:800;line-height:1}
.cc-q-odds:hover,.cc-q-odds[aria-expanded=true]{color:var(--cc-text);border-color:var(--cc-border-strong);background:var(--cc-bg-hover)}
.cc-q-oddshost{position:fixed;left:0;top:0;pointer-events:none;z-index:2147482600}
.cc-q-oc{position:fixed;display:none;flex-direction:column;width:calc(268*var(--u));max-width:92vw;overflow:hidden;background:var(--cc-bg);border:2px solid var(--cc-text-dim);border-radius:var(--cc-r);box-shadow:0 0 0 1px rgba(0,0,0,.75),var(--cc-shadow);pointer-events:auto;font-size:var(--q-fs-s)}
.cc-q-oc.is-on{display:flex}
.cc-q-oh{flex:none;display:flex;align-items:center;gap:calc(8*var(--u));padding:calc(9*var(--u)) calc(12*var(--u)) calc(7*var(--u));border-bottom:1px solid var(--cc-border)}
.cc-q-oh img{flex:none;width:calc(28*var(--u));height:calc(28*var(--u));image-rendering:pixelated}
.cc-q-oh div{min-width:0;display:flex;flex-direction:column;gap:1px}
.cc-q-oh b{font-size:calc(14*var(--u));font-weight:700;line-height:1.25}
.cc-q-oh em{color:var(--cc-text-dim);font-size:var(--q-fs-x);line-height:1.3}
.cc-q-ol{flex:1 1 auto;min-height:0;overflow-y:auto;padding:calc(5*var(--u)) calc(6*var(--u));scrollbar-width:thin;scrollbar-color:var(--cc-border-strong) transparent}
.cc-q-or{display:grid;grid-template-columns:calc(22*var(--u)) minmax(0,1fr) calc(54*var(--u)) calc(48*var(--u));align-items:center;column-gap:calc(7*var(--u));height:calc(26*var(--u));padding:0 calc(6*var(--u));border-radius:calc(6*var(--u));cursor:default;outline:0}
.cc-q-or:hover,.cc-q-or.is-hot,.cc-q-or:focus-visible{background:var(--cc-bg-hover)}
.cc-q-or img{width:calc(20*var(--u));height:calc(20*var(--u));image-rendering:pixelated}
.cc-q-or .t{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.cc-q-or .t small{margin-left:calc(5*var(--u));font-size:var(--q-fs-x);font-weight:400;color:var(--cc-text-dim)}
.cc-q-or .bar{height:calc(6*var(--u));border-radius:99px;background:var(--cc-sunk,var(--cc-bg-2));overflow:hidden}
.cc-q-or .bar i{display:block;height:100%;border-radius:inherit;background:var(--cc-good)}
.cc-q-or .p{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.cc-q-or.is-lock{color:var(--cc-text-dim)}
.cc-q-or.is-lock img{opacity:.45}
.cc-q-or.is-lock .p{font-weight:600;font-size:var(--q-fs-x)}
.cc-q-oc[data-k=kill] .cc-q-or .bar i{background:var(--cc-q-kill)}
.cc-q-or .tb{display:grid;place-items:center;height:calc(18*var(--u));border-radius:calc(5*var(--u));background:var(--cc-sunk,var(--cc-bg-2));border:1px solid var(--cc-border-strong);font-size:var(--q-fs-x);font-weight:700;font-variant-numeric:tabular-nums}
.cc-q-os{padding:calc(6*var(--u)) calc(8*var(--u)) calc(2*var(--u));color:var(--cc-text-dim);font-size:var(--q-fs-x);font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.cc-q-od{margin:0;padding:calc(7*var(--u)) calc(12*var(--u)) 0;display:grid;grid-template-columns:auto 1fr;gap:calc(3*var(--u)) calc(10*var(--u));font-variant-numeric:tabular-nums}
.cc-q-od dt{color:var(--cc-text-dim)}.cc-q-od dd{margin:0;text-align:right;font-weight:600}
.cc-q-on{flex:none;padding:calc(7*var(--u)) calc(12*var(--u)) calc(9*var(--u));border-top:1px solid var(--cc-border);color:var(--cc-text-dim);font-size:var(--q-fs-x);line-height:1.4}
.cc-q-oc .cc-q-on:first-child{border-top:0}
/* queued task dividers (a fight or skilling waiting its turn) and the current card's extra lines (combat info, level bar) */
.cc-q-qd{--qc:var(--cc-q-kill);display:flex;align-items:center;gap:calc(6*var(--u));height:calc(22*var(--u));margin:calc(5*var(--u)) 0;padding:0 calc(4*var(--u)) 0 calc(8*var(--u));border:1px dashed var(--qc);border-radius:99px;background:color-mix(in srgb,var(--qc) 12%,transparent);font-size:var(--q-fs-x);font-weight:700;color:var(--cc-text);cursor:pointer}
.cc-q-qd[data-qk=skilling]{--qc:var(--cc-good)}
.cc-q-qd:hover{background:color-mix(in srgb,var(--qc) 24%,transparent)}
.cc-q-qd .cc-q-qi{flex:none;width:calc(16*var(--u));height:calc(16*var(--u));image-rendering:pixelated}
.cc-q-qd .cc-q-ql{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cc-q-qx{flex:none;width:calc(18*var(--u));height:calc(18*var(--u));border-radius:50%;line-height:1;font-size:calc(10*var(--u));color:var(--cc-text-dim)}
.cc-q-qx:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-qroot[data-bp=micro] .cc-q-qd{justify-content:center;padding:0}
.cc-qroot[data-bp=micro] .cc-q-ql,.cc-qroot[data-bp=micro] .cc-q-qx{display:none}
.cc-q-row.is-now[data-xr]{height:calc(var(--q-nowh) + var(--xr,0) * 17 * var(--u))}
.cc-q-cinfo,.cc-q-lv{grid-column:3 / -1;align-self:center;min-width:0;margin-top:calc(3*var(--u));font-size:var(--q-fs-x);color:var(--q-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.cc-q-cinfo{grid-row:4}
.cc-q-cinfo.is-ico{display:flex;align-items:center;gap:calc(7*var(--u));overflow:visible}
.cc-q-cinfo:not(.is-ico) .cc-q-chip + .cc-q-chip::before{content:"\B7";margin:0 calc(4*var(--u));color:var(--q-dim)}
.cc-q-chip{display:inline-flex;align-items:center;gap:calc(3*var(--u));padding:0 calc(2*var(--u));border-radius:calc(4*var(--u));cursor:pointer;vertical-align:middle}
.cc-q-chip:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-q-chip[data-ci=kills]{cursor:default}
.cc-q-chip img{width:calc(15*var(--u));height:calc(15*var(--u));image-rendering:pixelated;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
.cc-q-cinfo.is-ico .cc-q-chip:not(.txt) .cc-q-chtxt{display:none}
.cc-q-cinfo:not(.is-ico) .cc-q-kn{display:none}
.cc-q-kn{font-weight:700;color:var(--cc-text)}
.cc-qroot[data-bp=full] .cc-q-row.is-now[data-xr] .cc-q-meta{grid-row:1 / span 3}
.cc-q-lv{grid-row:4;display:flex;align-items:center;gap:calc(6*var(--u))}
.cc-q-cinfo + .cc-q-lv{grid-row:5}
.cc-q-lv b{flex:none;font-weight:700;color:var(--cc-text)}
.cc-q-lvb{position:relative;flex:1;min-width:0;height:calc(11*var(--u));border-radius:99px;background:var(--cc-sunk,var(--cc-bg-2));border:1px solid var(--cc-border-strong);overflow:hidden}
.cc-q-lvb i{position:absolute;left:0;top:0;bottom:0;background:var(--cc-accent);opacity:.8}
.cc-q-lvb em{position:absolute;left:0;right:0;top:0;bottom:0;display:grid;place-items:center;font-size:calc(9.5*var(--u));font-weight:700;line-height:1;color:var(--cc-text);text-shadow:0 0 2px #000,0 0 2px #000}
.cc-qroot[data-bp=micro] .cc-q-cinfo,.cc-qroot[data-bp=micro] .cc-q-lv{display:none}
.cc-qroot[data-bp=micro] .cc-q-row.is-now[data-xr]{height:var(--q-nowh)}
.cc-q-subi{align-items:center;gap:calc(5*var(--u))}
.cc-q-subi .cc-q-chip:not(.txt) .cc-q-chtxt{display:none}
.cc-q-ldhost{position:fixed;left:0;top:0;z-index:2147482605}
.cc-q-ldc{min-width:calc(170*var(--u));max-width:calc(260*var(--u));padding:calc(5*var(--u));background:var(--cc-bg);border:2px solid var(--cc-text-dim);border-radius:var(--cc-r-sm);box-shadow:0 0 0 1px rgba(0,0,0,.75),var(--cc-shadow);font-size:var(--q-fs-s)}
.cc-q-ldh{padding:calc(2*var(--u)) calc(6*var(--u)) calc(4*var(--u));font-size:var(--q-fs-x);font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--cc-text-dim)}
.cc-q-ldr{display:flex;align-items:center;gap:calc(8*var(--u));width:100%;padding:calc(3*var(--u)) calc(6*var(--u));border-radius:calc(6*var(--u));text-align:left;color:var(--cc-text)}
.cc-q-ldr:hover{background:var(--cc-bg-hover)}
.cc-q-ldr img{flex:none;width:calc(22*var(--u));height:calc(22*var(--u));image-rendering:pixelated}
.cc-q-ldr span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.cc-q-ldr i{flex:none;color:var(--cc-accent);font-weight:800}
.cc-q-ldr.is-cur{cursor:default;background:var(--cc-accent-bg)}
.cc-q-ldn{padding:calc(4*var(--u)) calc(6*var(--u)) calc(1*var(--u));color:var(--cc-text-dim);font-size:var(--q-fs-x)}
/* drag */
.cc-q-ins{position:absolute;left:10px;right:10px;height:3px;margin-top:-1px;border-radius:2px;background:var(--cc-accent);box-shadow:0 0 8px rgba(255,210,74,.75);pointer-events:none;z-index:4}
.cc-q-ins::before,.cc-q-ins::after{content:"";position:absolute;top:-2px;width:7px;height:7px;border-radius:50%;background:var(--cc-accent)}
.cc-q-ins::before{left:-3px}.cc-q-ins::after{right:-3px}
.cc-qroot.is-drag,.cc-qroot.is-drag .cc-q-row{cursor:grabbing}
.cc-qroot.is-drag .cc-q-hop{opacity:.3}
/* states */
.cc-qroot[data-state=loading] .cc-q-row{pointer-events:none;background-image:linear-gradient(90deg,var(--cc-bg-3) 25%,var(--cc-bg-hover) 50%,var(--cc-bg-3) 75%);background-size:300% 100%;animation:cc-skel 1.3s linear infinite}
.cc-qroot[data-state=loading] .cc-q-row>*{visibility:hidden}
/* compact (180..339 px) */
.cc-qroot[data-bp=compact]{--q-pad:calc(8*var(--u));--q-rowh:calc(50*var(--u));--q-nowh:calc(68*var(--u));--q-tile:calc(42*var(--u));--q-hop:calc(16*var(--u));--q-num:calc(18*var(--u));--q-fs-t:calc(13*var(--u));--q-fs-s:calc(11.5*var(--u));--q-fs-x:calc(10.5*var(--u))}
.cc-qroot[data-bp=compact] .cc-q-row{column-gap:calc(6*var(--u));padding-right:calc(6*var(--u));grid-template-columns:var(--q-num) var(--q-tile) minmax(0,1fr) calc(8*var(--u))}
.cc-qroot[data-bp=compact] .cc-q-num{font-size:calc(12*var(--u))}
.cc-qroot[data-bp=compact] .cc-q-sub,.cc-qroot[data-bp=compact] .cc-q-sum,.cc-qroot[data-bp=compact] .cc-q-hint{display:none}
.cc-qroot[data-bp=compact] .cc-q-meta{grid-column:3;grid-row:2;align-self:start;flex-direction:row;align-items:baseline;gap:calc(5*var(--u));justify-content:flex-start}
.cc-qroot[data-bp=compact] .cc-q-time{font-size:var(--q-fs-s)}
.cc-qroot[data-bp=compact] .cc-q-xp::before{content:"\B7";margin-right:calc(5*var(--u))}
.cc-qroot[data-bp=compact] .cc-q-dots{grid-column:4}
.cc-qroot[data-bp=compact] .cc-q-row.is-now .cc-q-meta{grid-row:2}
.cc-qroot[data-bp=compact] .cc-pill small,.cc-qroot[data-bp=compact] .cc-q-nx{display:none}
/* micro (90..179 px): an icon column */
.cc-qroot[data-bp=micro]{--q-pad:calc(6*var(--u));--q-rowh:calc(50*var(--u));--q-nowh:calc(58*var(--u));--q-tile:calc(42*var(--u));--q-hop:calc(15*var(--u));--q-num:0px;--q-fs-t:calc(12*var(--u));--q-fs-s:calc(11*var(--u));--q-fs-x:calc(10*var(--u))}
.cc-qroot[data-bp=micro] .cc-q-row{display:flex;justify-content:center;align-items:center;padding:0}
.cc-qroot[data-bp=micro] .cc-q-row.is-now{--q-tile:calc(48*var(--u))}
.cc-qroot[data-bp=micro] .cc-q-num,.cc-qroot[data-bp=micro] .cc-q-tt,.cc-qroot[data-bp=micro] .cc-q-sub,.cc-qroot[data-bp=micro] .cc-q-meta,.cc-qroot[data-bp=micro] .cc-q-dots,.cc-qroot[data-bp=micro] .cc-q-bar,
.cc-qroot[data-bp=micro] .cc-q-sum,.cc-qroot[data-bp=micro] .cc-q-foot{display:none}
.cc-qroot[data-bp=micro] .cc-q-tile[data-n]::before{content:attr(data-n);position:absolute;top:calc(-6*var(--u));left:calc(-6*var(--u));min-width:calc(15*var(--u));padding:0 calc(3*var(--u));height:calc(15*var(--u));border-radius:99px;display:grid;place-items:center;
  background:var(--cc-bg);border:1px solid var(--cc-border-strong);font-size:calc(9.5*var(--u));font-weight:700;color:var(--cc-text-dim);z-index:1}
.cc-qroot[data-bp=micro] .cc-q-tile[data-n*=">"]::before{color:var(--cc-accent)}
.cc-qroot[data-bp=micro] .cc-pill small{display:none}
.cc-qroot[data-bp=micro] .cc-pill{padding:0 calc(6*var(--u))}
@keyframes cc-q-pulse{0%,100%{box-shadow:0 0 6px color-mix(in srgb,var(--cc-accent) 40%,transparent)}50%{box-shadow:0 0 18px color-mix(in srgb,var(--cc-accent) 85%,transparent)}}
@keyframes cc-q-pulse-o{0%,100%{box-shadow:0 0 5px color-mix(in srgb,var(--cc-accent) 35%,transparent)}50%{box-shadow:0 0 16px color-mix(in srgb,var(--cc-accent) 80%,transparent)}}
@keyframes cc-q-drop{0%{background-color:rgba(255,210,74,.28)}100%{background-color:var(--cc-bg-3)}}
@media (prefers-reduced-motion:reduce){.cc-qroot *{animation-duration:.01ms!important;transition-duration:.01ms!important}}
#cc-q-tip3 .tt-quest-line{color:var(--cc-info);font-weight:600}
#cc-q-tip3 .tt-quest-line.tt-quest-future{color:var(--cc-text-faint);font-weight:400;opacity:.8}
#cc-q-tip3{position:fixed;z-index:2147482601;max-width:360px;padding:8px 10px;background:var(--cc-bg,#10101a);border:2px solid var(--cc-accent,#ffd24a);border-radius:var(--cc-r-sm,8px);box-shadow:var(--cc-shadow,0 14px 40px rgba(0,0,0,.7));font:var(--cc-fs-sm,12.5px)/1.35 var(--cc-font,system-ui,sans-serif);color:var(--cc-text,#dcdce8);pointer-events:none}
#cc-q-tip3 .cc-tt-clone{display:block !important;position:static !important;transform:none !important;opacity:1 !important;visibility:visible !important;width:auto !important;max-width:none !important;min-width:0 !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;margin:0 !important}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- building the cards
  // the mob's picture: the creature in the first frame of its idle sprite sheet (frames sit side by side, each as wide as the sheet is tall), cropped to the pixels it really covers
  // so it fills its square centred, whatever size the sprite is drawn at inside its frame. A mob without a sheet keeps the slayer icon.
  const mobBad = new Set(), mobArt = new Map();   // act -> data URL of the cropped creature (null while loading)
  function cropMob(im) {
    const h = im.naturalHeight, c = document.createElement('canvas'); c.width = c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, h, h, 0, 0, h, h);
    const d = g.getImageData(0, 0, h, h).data; let x0 = h, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) if (d[(y * h + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return im.src;
    const c2 = document.createElement('canvas'); c2.width = x1 - x0 + 1; c2.height = y1 - y0 + 1; c2.getContext('2d').drawImage(c, x0, y0, c2.width, c2.height, 0, 0, c2.width, c2.height);
    return c2.toDataURL();
  }
  function loadMob(act, skill) {
    mobArt.set(act, null); const im = new Image();
    im.onerror = () => { mobBad.add(act); mobArt.delete(act); document.querySelectorAll('.cc-mobico[data-act="' + act + '"]').forEach((e) => { const im2 = el('img', 'cc-ico'); im2.src = skillIcon(e.dataset.skill || skill); im2.alt = ''; e.replaceWith(im2); }); };
    im.onload = () => {
      let url; try { url = cropMob(im); } catch (e) { url = im.src; }
      mobArt.set(act, url); document.querySelectorAll('.cc-mobico[data-act="' + act + '"]').forEach((e) => { e.style.backgroundImage = 'url(' + url + ')'; });
    };
    im.src = '/assets/mobs/sprite_sheets/' + act + '/idle_south.png';
  }
  function mobIco(act, skill) {
    const s = el('span', 'cc-ico cc-mobico'); s.dataset.act = act; s.dataset.skill = skill || '';
    const have = mobArt.get(act); if (have) s.style.backgroundImage = 'url(' + have + ')'; else if (have === undefined) loadMob(act, skill);
    return s;
  }
  // the category icons of a card or option: the game's own pictures, at most two (a teleport crystal is the weakest and drops out first)
  const MK_SRC = { lucky: '/assets/icons/skills/luck.png', quest: '/assets/icons/ui/quest.png', diary: '/assets/icons/ui/diary.png', tp: '/assets/icons/items/stable_crystal.png' };
  const MK_TXT = { lucky: 'Lucky task', quest: 'Quest step', diary: 'Diary step', boost: 'Drops XP-boost items', tp: 'Reachable by teleport' };
  function marksEl(o, max, tray) {
    const list = (o.mk || []).filter((k) => tray || k !== 'tp').slice(0, max);   // the walking pill already says "Teleport" between the cards, so only the alternatives show the crystal if (!list.length) return null;
    const m = el('span', 'cc-q-mk'); m.setAttribute('aria-hidden', 'true');
    list.reverse().forEach((k) => { if (k === 'boost') m.appendChild(el('span', 'cc-q-mkb', '▲')); else { const im = el('img'); im.src = MK_SRC[k]; im.alt = ''; m.appendChild(im); } });
    return m;
  }
  function tile(o, extra) {
    const t = el('span', 'cc-tile cc-q-tile' + (extra ? ' ' + extra : '')); t.dataset.k = o.k; if (o.e) t.dataset.e = o.e;
    if (o.k === 'kill' && o.act && !mobBad.has(o.act)) t.appendChild(mobIco(o.act, o.skill));
    else { const im = el('img', 'cc-ico'); im.src = skillIcon(o.skill); im.alt = ''; t.appendChild(im); }
    if (o.tier && extra) t.appendChild(el('b', 'cc-tier', o.tier));
    { const mk = marksEl(o, 2, !!extra); if (mk) t.appendChild(mk); }
    return t;
  }
  function hopEl(h) {
    const d = el('div', 'cc-q-hop'); d.dataset.h = h.lvl;
    const p = el('span', 'cc-pill'); p.dataset.tone = '';
    p.appendChild(document.createTextNode(h.tp ? '🌀 Teleport' : '🚶 ' + fmtTime(h.sec)));
    if (!h.tp) p.appendChild(el('small', '', num(h.d) + ' steps'));
    d.appendChild(p); return d;
  }
  function rowEl(s) {
    const o = s.opts[s.sel], r = el('div', 'cc-q-row'); r.tabIndex = 0; r.dataset.s = String(s.index); r.dataset.k = o.k; if (o.e) r.dataset.e = o.e; r.dataset.rkey = s.rkey; r.dataset.rnth = String(s.rnth); r.dataset.node = o.node; r.dataset.act = o.act;
    const n = el('span', 'cc-q-num', String(s.n)); if (s.recPos) { const i = el('i', '', '(' + s.recPos + ')'); i.title = 'The Route Advisor would put this task in place ' + s.recPos; n.appendChild(i); } r.appendChild(n);
    const t = tile(o); if (s.recPos) t.dataset.n = s.n + '>' + s.recPos; else t.dataset.n = String(s.n); r.appendChild(t);
    if (s.mat) { r.dataset.m = s.mat.lvl; t.dataset.m = s.mat.lvl; r.title = s.mat.text; }
    const tt = el('span', 'cc-q-tt'); if (o.tier) tt.appendChild(el('em', 'cc-q-tier', o.tier)); tt.appendChild(el('span', '', o.name)); tt.appendChild(el('b', '', '×' + o.qty)); r.appendChild(tt);
    r.appendChild(o.k === 'kill' && o.ui && setting('uiQueueHeadIcons', true) ? slaySub(r, o.ui) : subText(o));
    const meta = el('span', 'cc-q-meta'); if (o.corr) meta.title = o.corr; meta.appendChild(el('b', 'cc-q-time', fmtTime(o.timeSec)));
    const xp = el('span', 'cc-q-xp', num(o.xp) + ' XP'); if (Number.isFinite(o.xpHr)) xp.appendChild(el('em', 'cc-q-xph', short(o.xpHr) + '/h')); meta.appendChild(xp); r.appendChild(meta);
    if (s.advK >= 0 && s.opts[s.advK]) {   // the Route Advisor wants a DIFFERENT option here: say so on the card itself, not only when its tray is open
      const a = s.opts[s.advK]; r.dataset.sw = '1';
      const sw = el('span', 'cc-q-switch'); sw.appendChild(el('b', '', '⇄')); sw.appendChild(el('span', '', 'Switch to ' + a.name));
      sw.title = 'The Route Advisor recommends another task for this slot: ' + a.name + ' (' + a.skillName + ', ' + fmtTime(a.timeSec) + ', ' + num(a.xp) + ' XP). Point at the card to see the options.'; r.appendChild(sw);
    }
    if (s.opts.length > 1) { const dots = el('span', 'cc-q-dots'); s.opts.forEach((_, k) => dots.appendChild(el('i', k === s.sel ? 'on' : ''))); r.appendChild(dots); }
    r._s = s; return r;
  }
  function nowEl(h) {
    const r = el('div', 'cc-q-row is-now'); r._s = { now: true, index: -1, opts: [], sel: 0 }; r.dataset.k = h.k; if (h.e) r.dataset.e = h.e; r.dataset.node = h.node; r.dataset.act = h.act;
    r.appendChild(el('span', 'cc-q-num', '▶'));
    { const ht = tile(h); r.appendChild(ht); if (h.mat) { r.dataset.m = h.mat.lvl; ht.dataset.m = h.mat.lvl; r.title = h.mat.text; } }
    const tt = el('span', 'cc-q-tt'); if (h.tier) tt.appendChild(el('em', 'cc-q-tier', h.tier)); tt.appendChild(el('span', '', h.name)); tt.appendChild(el('b', '', '×' + h.goal)); r.appendChild(tt);
    r.appendChild(h.k === 'kill' && h.ui && setting('uiQueueHeadIcons', true) ? (h.xCi ? el('span', 'cc-q-sub') : slaySub(r, h.ui)) : subText(h));   // a fight: the game's icons instead of "Slay - mob" (the name is in the title); the fight line below already has them
    const bar = el('span', 'cc-prog cc-q-bar'); bar.appendChild(el('i')); r.appendChild(bar);
    const meta = el('span', 'cc-q-meta'); meta.appendChild(el('b', 'cc-q-time')); const xp = el('span', 'cc-q-xp'); xp.appendChild(el('em', 'cc-q-dn')); xp.appendChild(document.createTextNode(' / ' + h.goal)); xp.appendChild(el('span', 'cc-q-nx')); meta.appendChild(xp); r.appendChild(meta);
    // what the game's Current Task panel shows besides the task: for a fight the loadout / trained skill / kills, and the level bar of the skill being trained (filled in by fillHead)
    let xr = 0;
    if (h.xCi) { const ci = el('span', 'cc-q-cinfo'); wireCinfo(ci); r.appendChild(ci); xr++; }
    if (h.xLv) { const lv = el('span', 'cc-q-lv'); lv.appendChild(el('b', 'l')); const lb = el('span', 'cc-q-lvb'); lb.appendChild(el('i')); lb.appendChild(el('em')); lv.appendChild(lb); lv.appendChild(el('b', 'r')); r.appendChild(lv); xr++; }
    if (xr) { r.dataset.xr = String(xr); r.style.setProperty('--xr', String(xr)); r.style.setProperty('--rs', String(3 + xr)); }
    return r;
  }
  // a queued task divider: a fight waiting behind skilling tasks, or the skilling that resumes after a fight (the game's "Combat Queued" / "Skilling Queued"), with its cancel cross
  function queuedEl(kind, q) {
    const combat = kind === 'combat', d = el('div', 'cc-q-qd'); d.dataset.qk = kind; d.tabIndex = 0;
    const im = el('img', 'cc-q-qi'); im.src = combat ? '/assets/icons/ui/combat.png' : (q.skill ? skillIcon(q.skill) : '/assets/icons/ui/tasks.png'); im.alt = ''; d.appendChild(im);
    const pos = q.position || 0, when = combat ? (pos > 0 ? 'Starts after task ' + (pos + 1) : 'Starts after the current task') : (pos > 0 ? 'Resumes after slay task ' + (pos + 1) : 'Resumes after the current slay task');
    d.appendChild(el('span', 'cc-q-ql', combat ? 'Combat queued: ' + q.name : q.name ? 'Skilling queued: ' + q.name : 'Skilling queued'));
    d.title = (combat ? 'Combat queued' : 'Skilling queued') + '. ' + when + (q.node ? ' (' + q.node + ')' : '') + '. ' + (setting('uiQueueClickMap', true) ? (combat ? 'Click to open the mob in the game. ' : 'Click to show the task on the map. ') : '') + 'The cross cancels it.';
    const x = el('button', 'cc-q-qx', '✕'); x.type = 'button'; x.title = 'Cancel queued ' + kind; x.setAttribute('aria-label', x.title); d.appendChild(x);
    x.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.isTrusted) cancelQueued(kind); });
    d.addEventListener('click', (ev) => { if (!ev.isTrusted || ev.target.closest('.cc-q-qx') || !setting('uiQueueClickMap', true)) return; openQueued(kind); });
    return d;
  }
  // the NEW TASKS bar between two cards (its position lives in the game; see moveInsert)
  function insertEl(ins) {
    const d = el('div', 'cc-q-insert'); d.dataset.at = String(ins.at); d.dataset.min = String(ins.min); d.appendChild(el('b', '', '\u25B2 NEW TASKS \u25B2'));
    d.title = 'Freshly rolled tasks (rerolls and new rows) enter the queue here. Drag the bar to choose where.';
    return d;
  }
  const structOf = (m) => JSON.stringify([m.head && [m.head.node, m.head.act, m.head.tier, m.head.goal, m.head.xLv, m.head.xCi, m.head.ui ? m.head.ui.loadout + m.head.ui.tog : ''], m.slots.map((s) => [s.index, s.sel, s.recPos, s.advK, s.hop && [s.hop.lvl, Math.round(s.hop.sec)], s.rkey, s.opts.map((o) => [o.node, o.act, o.qty, o.tier, o.e, o.k, o.mk.join('+'), o.ui ? o.ui.loadout + o.ui.tog : '']), s.advK, s.bestK]), m.insert && [m.insert.at, m.insert.min], m.queued && [m.queued.combat && [m.queued.combat.name, m.queued.combat.position], m.queued.skilling && [m.queued.skilling.name, m.queued.skilling.skill, m.queued.skilling.position]]]);
  function fillSum(b, S) {
    const key = S.total + '|' + S.fin + '|' + S.count; if (b._k === key) return; b._k = key; b.textContent = '';
    if (S.total) { b.appendChild(el('b', '', S.total)); b.appendChild(document.createTextNode(', done around ' + S.fin + ' · ' + S.count + ' tasks')); } else b.appendChild(document.createTextNode('Nothing queued'));
  }
  // patch the numbers that change every second; the structure is only rebuilt when it changed
  function setMat(r, mat) {
    const t = r.querySelector('.cc-q-tile'), v = mat ? mat.lvl : '';
    if ((r.dataset.m || '') !== v) { if (v) { r.dataset.m = v; if (t) t.dataset.m = v; } else { delete r.dataset.m; if (t) delete t.dataset.m; } }
    const tx = mat ? mat.text : ''; if ((r.title || '') !== tx) r.title = tx;
  }
  // The fight line of the current card as the game's own icons (the loadout's weapon, the two skills trained, kills), with the game's own tooltip wording. A click on the loadout or a
  // training icon is passed on to the game's own control (the Training icons of its queue row, the loadout / training words of its Current Task panel), only when you click.
  const escH = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const tipRow = (src, txt) => '<div class="tt-line uq-tt-row">' + (src ? '<img class="uq-inline-icon uq-inline-icon-sub" src="' + escH(src) + '" alt="">' : '') + '<span>' + escH(txt) + '</span></div>';
  function ciChip(kind, src, text, tip) {
    const e = el('span', 'cc-q-chip'); e.dataset.ci = kind; e._tip = tip; e.setAttribute('aria-label', text);
    if (src) { const im = el('img'); im.src = src; im.alt = ''; im.addEventListener('error', () => { im.remove(); e.classList.add('txt'); }); e.appendChild(im); } else e.classList.add('txt');
    e.appendChild(el('span', 'cc-q-chtxt', text)); return e;
  }
  function fillCinfo(ci, c) {
    const wl = !!(c.loadout && setting('uiQueueHeadLoadout', true)), wt = !!(c.train && setting('uiQueueHeadTraining', true)), wk = !!(c.kills && setting('uiQueueHeadKills', true)), ic = setting('uiQueueHeadIcons', true);
    const key = [ic, wl && c.loadout + '|' + c.loadoutIcon + '|' + (c.loadouts || []).map((x) => x.id).join(),  wt && c.train + '|' + (c.trainIcons || []).join() + '|' + c.other, wk].join('~');
    const kt = wk ? (c.kills.target ? c.kills.count + '/' + c.kills.target : String(c.kills.count)) : '';
    if (ci._key !== key) {
      ci._key = key; ci.textContent = ''; ci.classList.toggle('is-ico', !!ic);
      if (wl) { const lc = ciChip('loadout', ic ? c.loadoutIcon : '', 'Loadout: ' + c.loadout, '<div class="tt-name">Loadout</div>' + tipRow(c.loadoutIcon, c.loadout)); lc._ld = c.loadouts || []; lc._ldCur = c.loadoutId; ci.appendChild(lc); }
      if (wt) {
        const icons = c.trainIcons || [], names = c.trainNames || [], hint = c.other ? '<div class="tt-line" style="color:var(--text-muted)">Click to train ' + escH(c.other) + ' instead</div>' : '';
        const tip = '<div class="tt-name">Training</div>' + icons.map((s, i) => tipRow(skillIcon(s), names[i] || s)).join('') + (icons.length ? '' : tipRow('', c.train)) + hint;
        if (ic && icons.length) icons.forEach((s, i) => ci.appendChild(ciChip('train', skillIcon(s), 'Training: ' + (names[i] || s), tip)));
        else ci.appendChild(ciChip('train', '', 'Training: ' + c.train, tip));
      }
      if (wk) { const k = ciChip('kills', ic ? '/assets/icons/ui/combat.png' : '', 'Kills', '<div class="tt-name">Kills</div>'); k.appendChild(el('b', 'cc-q-kn')); ci.appendChild(k); }
    }
    if (wk) { const k = ci.querySelector('[data-ci=kills]'); if (k) { const t = k.querySelector('.cc-q-chtxt'), n = k.querySelector('.cc-q-kn'), tx = 'Kills: ' + kt; if (t.textContent !== tx) t.textContent = tx; if (n.textContent !== kt) n.textContent = kt; k._tip = '<div class="tt-name">Kills</div>' + tipRow('', c.kills.target ? c.kills.count + ' of ' + c.kills.target + ' (slay task)' : c.kills.count + ' kills this fight'); } }
  }
  const hudCols = () => Array.from(document.querySelectorAll('#task-display .float-combat-col'));
  function forwardClick(t) {   // your click, passed to the game's own control a moment later
    if (!t) return false;
    setTimeout(() => { try { t.click(); } catch (e) { /* the control is gone */ } }, 80); fwd(); return true;
  }
  function chipClick(kind) {
    try { const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); } catch (e) { /* stale panel */ }
    const hud = hudCols(), t = kind === 'loadout' ? hud[0] : kind === 'train' ? (hud[1] || document.querySelector('#unified-queue-panel .uq-current .uq-xp-icon')) : null;   // the icons show the Current Task panel's own state, so its own controls are the ones clicked
    if (!t) { flash('The game has no control for this right now. Open the game’s Tasks panel once and try again.'); return false; }
    return forwardClick(t);
  }
  // hover = the game's tooltip wording (the loadout chip of the current fight opens the list of loadouts instead), click = the click on the game's own control
  function wireChips(ci, onClick) {
    ci.addEventListener('mouseover', (ev) => {
      const c = ev.target.closest && ev.target.closest('.cc-q-chip'); if (!c || !c._tip) return; ev.stopPropagation();
      if (c._ld && c._ld.length > 1) { hideTip3(); openLd(c); return; }
      tipHtml(c._tip, ev.clientX, ev.clientY, c);
    });
    ci.addEventListener('mousemove', (ev) => { if (tip3) placeTip3(ev.clientX, ev.clientY); });
    ci.addEventListener('mouseout', (ev) => { if (!ci.contains(ev.relatedTarget) || !(ev.relatedTarget.closest && ev.relatedTarget.closest('.cc-q-chip'))) { hideTip3(); ldLeave(); } });
    ci.addEventListener('click', (ev) => { const c = ev.target.closest && ev.target.closest('.cc-q-chip'); if (!c) return; ev.stopPropagation(); if (!ev.isTrusted || c.dataset.ci === 'kills') return; onClick(c.dataset.ci, c); });
  }
  const wireCinfo = (ci) => wireChips(ci, (kind) => chipClick(kind));
  const subText = (o) => { const sub = el('span', 'cc-q-sub'); sub.appendChild(el('i', '', o.skillName)); sub.appendChild(el('span', '', o.place)); return sub; };
  // the icons the game shows beside a slay task (the weapon of its saved loadout, the two skills trained), with its tooltips; a click on a training icon is passed to that row's own Training icon
  function slaySub(row, ui) {
    const sub = el('span', 'cc-q-sub cc-q-subi');
    if (ui.none) sub.appendChild(ciChip('loadout', '/assets/icons/ui/head.png', 'No loadout saved', '<div class="tt-name">Loadout</div>' + tipRow('/assets/icons/ui/head.png', 'No loadout saved')));
    else {
      sub.appendChild(ciChip('loadout', ui.loadoutIcon, 'Loadout: ' + ui.loadoutName, '<div class="tt-name">Loadout</div>' + tipRow(ui.loadoutIcon, ui.loadoutName)));
      const tip = '<div class="tt-name">Training</div>' + ui.skills.map((s, i) => tipRow(skillIcon(s), ui.skillNames[i])).join('') + '<div class="tt-line" style="color:var(--text-muted)">Click to train ' + escH(ui.other) + ' instead</div>';
      ui.skills.forEach((s, i) => sub.appendChild(ciChip('train', skillIcon(s), 'Training: ' + ui.skillNames[i], tip)));
    }
    wireChips(sub, (kind) => rowChip(row, kind));
    return sub;
  }
  function rowChip(row, kind) {   // your click on a training icon of a card = a click on the Training icon of the game's own row
    if (kind !== 'train') return false; const s = row._s; if (!s) return false;
    let g;
    if (s.now) { try { const b = bridge(); if (b && b.refreshQueuePanel) b.refreshQueuePanel(); } catch (e) { /* stale */ } g = document.querySelector('#unified-queue-panel .uq-current'); }
    else { if (!rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was changed. Open the game’s Tasks panel once and try again.'); return false; } g = Array.from(document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row:not(.uq-current)'))[s.index]; }
    const xp = g && g.querySelector('.uq-xp-icon'); if (!xp) { flash('The game has no Training icon for this task right now.'); return false; }
    return forwardClick(xp);
  }
  // ---- the list of combat loadouts under the loadout icon of the current fight. The game has the same list in its combat panel (a "Loadout" drop-down whose buttons choose a loadout directly);
  // choosing here clicks that very button (after its family tab if needed), only when you choose. The loadout words of the Current Task panel only cycle, so they are not replayed.
  let ldEl = null, ldT = 0, ldChip = null;
  function ldLeave() { clearTimeout(ldT); ldT = setTimeout(closeLd, 220); }
  function closeLd() { clearTimeout(ldT); if (ldEl) { ldEl.remove(); ldEl = null; } ldChip = null; }
  function openLd(chip) {
    clearTimeout(ldT); if (ldChip === chip && ldEl) return; closeLd(); ldChip = chip;
    const list = chip._ld, cur = chip._ldCur, host = el('div', 'cc-qroot cc-q-ldhost'), box = el('div', 'cc-q-ldc');
    host.style.setProperty('--s', (chip.closest('.cc-qroot') && chip.closest('.cc-qroot').style.getPropertyValue('--s')) || '1');
    box.appendChild(el('div', 'cc-q-ldh', 'Loadout'));
    list.forEach((l) => {
      const b = el('button', 'cc-q-ldr' + (l.id === cur ? ' is-cur' : '')); b.type = 'button'; b.dataset.id = l.id;
      const im = el('img'); im.src = l.icon; im.alt = ''; b.appendChild(im); b.appendChild(el('span', '', l.name)); if (l.id === cur) b.appendChild(el('i', '', '✓'));
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (!ev.isTrusted || l.id === cur) return; closeLd(); pickLoadout(l); });
      box.appendChild(b);
    });
    box.appendChild(el('div', 'cc-q-ldn', 'Click the icon itself to cycle to the next one.'));
    host.appendChild(box); host.addEventListener('mouseenter', () => clearTimeout(ldT)); host.addEventListener('mouseleave', ldLeave); document.body.appendChild(host); ldEl = host;
    const r = chip.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, ed = E();
    host.style.left = Math.round(Math.max(6, Math.min(r.left, window.innerWidth - bw - 6))) + 'px';
    const below = r.bottom + 4 + bh <= window.innerHeight - (ed.bottom || 0) - 6;
    host.style.top = Math.round(below ? r.bottom + 4 : Math.max((ed.top || 0) + 4, r.top - bh - 4)) + 'px';
  }
  function pickLoadout(l) {
    const menu = document.querySelector('#ce-player-panel .loadout-dropdown-menu');
    const find = () => menu && menu.querySelector('.loadout-sel-slot[data-loadout="' + l.id + '"]');
    if (!menu) { flash('The game’s combat loadout list is not available right now, so nothing was changed. Click the loadout icon to cycle instead.'); return false; }
    const go = () => {
      const s = find(); if (!s) { flash('The game’s combat panel has no button for ' + l.name + ' right now.'); return; }
      s.click();
      setTimeout(() => { let now = ''; try { now = bridge().current().loadoutId; } catch (e) { /* none */ } if (now !== l.id) flash('The game did not switch to ' + l.name + '. Its combat panel may think it is already in use.'); refreshAll(true); }, 900);
    };
    if (find()) setTimeout(go, 80);
    else { const fb = menu.querySelector('.loadout-sel-family[data-family="' + l.family + '"]'); if (!fb) { flash('The game’s combat panel has no ' + l.family + ' loadouts tab right now.'); return false; } setTimeout(() => { fb.click(); setTimeout(go, 80); }, 80); }
    return true;
  }  // the current card's extra lines: loadout / trained skill / kills of a fight, and the level bar of the skill being trained (numbers change every second, the lines are only built when shown)
  function fillHead(now, h) {
    const c = h.cur, ci = now.querySelector('.cc-q-cinfo'), lv = now.querySelector('.cc-q-lv'); if (!c) return;
    if (ci) fillCinfo(ci, c);
    if (lv && c.lv) {
      const L = c.lv, a = lv.querySelector('.l'), z = lv.querySelector('.r'), f = lv.querySelector('.cc-q-lvb i'), pe = lv.querySelector('.cc-q-lvb em');
      const ta = 'Lv ' + L.level, tz = L.next ? 'Lv ' + L.next : 'MAX', tp = L.pct + '%';
      if (a.textContent !== ta) a.textContent = ta; if (z.textContent !== tz) z.textContent = tz; if (pe.textContent !== tp) pe.textContent = tp; f.style.width = L.pct + '%';
      const tt = L.name + ' level ' + L.level + ', ' + L.pct + '% of the way to ' + (L.next ? 'level ' + L.next : 'the end'); if (lv.title !== tt) lv.title = tt;
    }
  }
  function patch(root, m) {
    setCtl(root, m.ctl);
    const list = root.querySelector('.cc-q-list');
    const now = list.querySelector('.cc-q-row.is-now');
    if (now && m.head) { setMat(now, m.head.mat);
      const h = m.head; now.querySelector('.cc-q-time').textContent = h.timeLeft > 0 ? fmtTime(h.timeLeft) + ' left' : '';
      now.querySelector('.cc-q-dn').textContent = num(h.done); const nx = now.querySelector('.cc-q-nx'); nx.textContent = h.xp ? ' · ' + num(h.xp) + ' XP' : '';
      now.querySelector('.cc-q-bar i').style.width = (h.goal ? Math.min(100, (h.done / h.goal) * 100) : 0).toFixed(1) + '%';
      fillHead(now, h);
    }
    list.querySelectorAll('.cc-q-row[data-s]').forEach((r) => {
      const s = m.slots.find((x) => String(x.index) === r.dataset.s); if (!s) return; r._s = s; const o = s.opts[s.sel];
      const tm = r.querySelector('.cc-q-time'); const t1 = fmtTime(o.timeSec); if (tm.textContent !== t1) tm.textContent = t1;
      setMat(r, s.mat);
    });
    const total = m.total > 0 ? fmtTime(m.total) : '', fin = m.total > 0 ? UI.fmt.clock(new Date(Date.now() + m.total * 1000)) : '';
    const count = (m.head ? 1 : 0) + m.slots.length;
    // every step you still have to walk (teleported hops excluded): the walk to the current task plus each hop between the queued tasks
    let steps = m.head && m.head.steps ? m.head.steps : 0, tpHops = 0; m.slots.forEach((s) => { if (s.hop && s.hop.d > 0) { if (s.hop.tp) tpHops++; else steps += s.hop.d; } });
    root._steps = { steps, tpHops };
    root._sum = { total, fin, count };
    root.querySelectorAll('.cc-q-sum').forEach((b) => fillSum(b, root._sum));
    const fl = root.querySelector('.cc-q-fl'); if (fl) fl.textContent = count ? '' : 'Nothing queued';
    { const tg = root.querySelector('.cc-q-odds'); if (tg) { const on = setting('uiQueueOdds', true); if (tg.hidden === on) tg.hidden = !on; if (!on && od && od.root === root) closeOdds(); } }
    { const hi = root.querySelector('.cc-q-hint'); if (hi) { const t = root._steps.steps > 0 ? num(Math.round(root._steps.steps)) + ' steps' : ''; if (hi.textContent !== t) hi.textContent = t; hi.title = t ? 'Steps still to walk: the walk to the current task plus every hop between the queued tasks. Hops that use a teleport are not counted' + (root._steps.tpHops ? ' (' + root._steps.tpHops + ' of them)' : '') + '. The game banks without a walk, so there are no bank trips to add.' : ''; } }
    root._chip = total ? count + ' · ' + total : '';
  }
  // The kept panel keeps the height you gave it, but a list that no longer fits (a longer queue, the NEW TASKS bar, a bigger card) grows the panel just enough instead of growing a scroll bar.
  // Only when even the tallest the screen allows (the panel's max-height) is not enough does the list scroll.
  function fitPanel(root) {
    if (!P || root !== keptRoot || !P.isShown() || P.collapsed()) return;
    const list = root.querySelector('.cc-q-list'), over = list.scrollHeight - list.clientHeight;
    if (over >= 1) P.el.style.height = (P.el.offsetHeight + Math.ceil(over)) + 'px';
  }
  function render(root) {
    const m = model();
    if (!m) { root.dataset.state = 'loading'; return; }
    delete root.dataset.state;
    const list = root.querySelector('.cc-q-list'), sig = structOf(m);
    if (root._sig !== sig) {
      if (root._drag) return;
      const keepIdx = trayRow && trayRoot === root && trayRow._s ? trayRow._s.index : null, keepPeek = peek;   // a reroll changes the row: the tray stays open on it instead of vanishing
      if (keepIdx == null) closeTray(true);
      root._sig = sig; const st = list.scrollTop; list.textContent = '';
      const qd = [];   // queued dividers: position 0 sits under the current card, n under the nth queued card
      if (m.queued && m.queued.combat) qd.push({ kind: 'combat', q: m.queued.combat });
      if (m.queued && m.queued.skilling) qd.push({ kind: 'skilling', q: m.queued.skilling });
      const putQ = (n) => qd.forEach((x) => { if (Math.max(0, Math.min(m.slots.length, x.q.position || 0)) === n) list.appendChild(queuedEl(x.kind, x.q)); });
      if (m.head) list.appendChild(nowEl(m.head));
      putQ(0);
      m.slots.forEach((s, i) => {
        if (m.insert && m.insert.at === i) list.appendChild(insertEl(m.insert));
        if (s.hop) list.appendChild(hopEl(s.hop));
        const r = rowEl(s); if (m.insert && i >= m.insert.at) r.classList.add('is-held'); list.appendChild(r); putQ(i + 1);
      });
      if (m.insert && m.insert.at >= m.slots.length) list.appendChild(insertEl(m.insert));
      if (!m.head && !m.slots.length) { const e = el('div', 'cc-empty'); e.appendChild(el('b', '', 'Nothing queued')); e.appendChild(document.createTextNode('Pick tasks in the game’s task window')); list.appendChild(e); }
      list.scrollTop = st; applyHl(root); fitPanel(root);
      if (keepIdx != null) {
        const nr = list.querySelector('.cc-q-row[data-s="' + keepIdx + '"]');
        if (nr && nr._s) { trayRow = nr; nr.classList.add('is-open'); peek = keepPeek; fillTray(nr._s); placeTray(root, nr); if (tray && !tray.classList.contains('is-on')) tray.classList.add('is-on'); } else closeTray(true);
      }
    }
    patch(root, m);
  }
  // ---------------------------------------------------------------- roll controls: how new tasks roll (Skilling / Slay) and which slayer master, plus your reroll credits and Auto Loadout.
  // The state is read from the game's data; a click on one of these passes YOUR click to the game's own control (the game panel keeps them in the page even when it is hidden).
  const MASTERS = [['tier1', 'Valthor', 'Feeble', '1-30', 1], ['tier2', 'Seraphine', 'Dire', '30-50', 30], ['tier3', 'Draven', 'Savage', '50-70', 50], ['tier4', 'Morwenna', 'Fell', '70-90', 70], ['tier6', 'Varyndra', 'Chaos', '75+', 75], ['tier5', 'Azrathel', 'Ancient', '90+', 90]];
  const gameCtl = (sel) => { const pn = document.getElementById('unified-queue-panel'); return pn ? pn.querySelector('.uq-controls ' + sel) : null; };
  function ctlClick(sel, what) {
    const e = gameCtl(sel); if (!e) { flash('The game has no ' + what + ' control right now. Open the game\u2019s Tasks panel once and try again.'); return false; }
    e.click(); fwd(); return true;
  }
  function tipHtml(html, x, y, owner) { hideTip3(); tip3 = el('div'); tip3.id = 'cc-q-tip3'; const w = el('div', 'icon-tooltip uq-tooltip tooltip cc-tt-clone'); w.innerHTML = html; tip3.appendChild(w); document.body.appendChild(tip3); tip3.__row = owner; placeTip3(x, y); }
  // The roll controls take a whole strip; it folds into one slim line (kept between sessions) so the queue itself shows more rows.
  let ctlFold = false; try { ctlFold = localStorage.getItem('cc-q-ctl-fold') === '1'; } catch (e) { /* default open */ }
  function setFold(v) {
    ctlFold = !!v; try { localStorage.setItem('cc-q-ctl-fold', ctlFold ? '1' : '0'); } catch (e) { /* not saved */ }
    allRoots().forEach((r) => { const c = r.querySelector('.cc-q-ctl'); if (c) foldCtl(c); });
  }
  function foldCtl(c) { c.classList.toggle('fold', ctlFold); const b = c.querySelector('.cc-q-ctlt'); if (b) { b.setAttribute('aria-expanded', String(!ctlFold)); b.title = ctlFold ? 'Show the task roll controls' : 'Fold the task roll controls (more queue rows)'; b.textContent = ctlFold ? '▸' : '▾'; } }
  function ctlEl() {
    const c = el('div', 'cc-q-ctl');
    { const tg = el('button', 'cc-q-ctlt', '▾'); tg.type = 'button'; tg.addEventListener('click', (ev) => { ev.stopPropagation(); setFold(!ctlFold); }); c.appendChild(tg); c.appendChild(el('span', 'cc-q-fsum')); }
    const seg = el('div', 'cc-seg cc-q-lane'); [['skills', 'Skilling'], ['slay', 'Slay']].forEach(([k, lab]) => { const b = el('button', '', lab); b.type = 'button'; b.dataset.lane = k; seg.appendChild(b); }); c.appendChild(seg);
    const ms = el('div', 'cc-q-masters'); MASTERS.forEach(([id, nm, , , ]) => { const b = el('button', 'cc-q-mt'); b.type = 'button'; b.dataset.master = id; const im = el('img'); im.src = '/assets/icons/ui/' + nm.toLowerCase() + '.png'; im.alt = nm; b.appendChild(im); b.appendChild(el('i', '', 'T' + id.slice(4))); ms.appendChild(b); }); c.appendChild(ms);
    c.appendChild(el('span', 'cc-q-cr')); const au = el('button', 'cc-chip cc-q-au', 'Auto'); au.type = 'button'; c.appendChild(au);
    c.addEventListener('click', (ev) => {
      if (!ev.isTrusted) return; const t = ev.target.closest && ev.target.closest('button'); if (!t || t.classList.contains('cc-q-ctlt')) return; ev.stopPropagation();
      if (t.dataset.lane) { if (t.getAttribute('aria-pressed') !== 'true') ctlClick('.uq-lane-toggle', 'Skilling / Slay'); }
      else if (t.dataset.master) { if (!t.classList.contains('is-sel') && !t.classList.contains('is-locked')) ctlClick('.uq-master-tile[data-master="' + t.dataset.master + '"]', 'slayer master'); }
      else if (t.classList.contains('cc-q-au')) ctlClick('.uq-toggle', 'Auto Loadout');
    });
    c.addEventListener('mouseover', (ev) => {
      const t = ev.target.closest && ev.target.closest('button, .cc-q-cr'); if (!t || (ev.relatedTarget && t.contains(ev.relatedTarget))) return; const ct = c._ctl; if (!ct) return;
      let html = '';
      if (t.dataset && t.dataset.master) { const M = MASTERS.find((x) => x[0] === t.dataset.master); html = '<div class="tt-name">' + M[1] + ' <span style="opacity:.7">(' + M[2] + ' \u00B7 slay ' + M[3] + ')</span></div><div class="tt-line">The slayer master the combat tasks roll from.</div>' + (ct.slayLevel < M[4] ? '<div class="tt-line" style="color:var(--cc-bad)">Requires Slay level ' + M[4] + ' (you are ' + ct.slayLevel + ')</div>' : t.classList.contains('is-sel') ? '<div class="tt-line" style="color:var(--cc-good)">Selected</div>' : '<div class="tt-line">Click to roll from this master</div>'); }
      else if (t.dataset && t.dataset.lane) html = '<div class="tt-name">Task type: ' + (ct.lane === 'slay' ? 'Slay' : 'Skilling') + '</div><div class="tt-line">Skilling rolls 2 skilling tasks and 1 combat task per row.</div><div class="tt-line">Slay rolls 2 combat tasks and 1 skilling task per row (from the master you picked).</div><div class="tt-line">Only changes rows rolled after you switch.</div>' + (t.getAttribute('aria-pressed') === 'true' ? '' : '<div class="tt-line">Click to switch</div>');
      else if (t.classList.contains('cc-q-cr')) html = '<div class="tt-name">' + num(ct.credits) + ' reroll credits</div><div class="tt-line">Earn 1 for each skilling task you complete. Combat tasks do not pay credits.</div><div class="tt-line">' + ct.costSkill + ' per reroll on Skilling (' + num(Math.floor(ct.credits / ct.costSkill)) + ' rerolls)</div><div class="tt-line">' + ct.costSlay + ' per reroll on Slay (' + num(Math.floor(ct.credits / ct.costSlay)) + ' rerolls)</div>';
      else if (t.classList.contains('cc-q-au')) html = '<div class="tt-name">Auto Loadout: ' + (ct.auto ? 'on' : 'off') + '</div><div class="tt-line">On: the loadout you assigned to a mob in the mob selection is used for it automatically. Right-click for its settings (the game\u2019s combat defaults).</div><div class="tt-line">Click to switch</div>';
      if (html) tipHtml(html, ev.clientX, ev.clientY, t);
    });
    c.addEventListener('mousemove', (ev) => { if (tip3) placeTip3(ev.clientX, ev.clientY); });
    c.addEventListener('mouseout', (ev) => { if (!c.contains(ev.relatedTarget)) hideTip3(); });
    c.addEventListener('contextmenu', (ev) => {   // right-click Auto = the game's own right-click on its Auto Loadout button (the combat defaults)
      const t = ev.target.closest && ev.target.closest('.cc-q-au'); if (!t || !setting('uiQueueRightClick', true)) return;
      ev.preventDefault(); ev.stopPropagation(); if (!ev.isTrusted) return;
      const g = gameCtl('.uq-toggle'); if (!g) { flash('The game has no Auto Loadout control right now. Open the game’s Tasks panel once and try again.'); return; }
      forwardCtx(g, ev.clientX, ev.clientY);
    });
    return c;
  }
  function setCtl(root, ct) {
    const c = root.querySelector('.cc-q-ctl'); if (!c) return; c._ctl = ct;
    c.hidden = !ct; if (!ct) return;
    c.querySelectorAll('.cc-q-lane button').forEach((b) => { const on = b.dataset.lane === ct.lane; if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); });
    c.querySelectorAll('.cc-q-mt').forEach((b) => { const M = MASTERS.find((x) => x[0] === b.dataset.master); b.classList.toggle('is-sel', b.dataset.master === ct.master); b.classList.toggle('is-locked', ct.slayLevel < M[4]); });
    const cr = c.querySelector('.cc-q-cr'), t = '\u21BB ' + num(ct.credits) + ' \u00B7 ' + num(Math.floor(ct.credits / (ct.lane === 'slay' ? ct.costSlay : ct.costSkill))) + ' rerolls'; if (cr.textContent !== t) cr.textContent = t;
    const au = c.querySelector('.cc-q-au'); au.classList.toggle('on', ct.auto); au.setAttribute('aria-pressed', String(ct.auto));
    const M = MASTERS.find((x) => x[0] === ct.master), sm = c.querySelector('.cc-q-fsum'), st = (ct.lane === 'slay' ? 'Slay' + (M ? ' · ' + M[1] : '') : 'Skilling') + ' · ↻ ' + num(ct.credits) + (ct.auto ? ' · auto loadout' : ''); if (sm && sm.textContent !== st) sm.textContent = st;
    foldCtl(c);
  }
  function makeRoot(mode) {
    const root = el('div', 'cc-qroot'); root.dataset.mode = mode; root.dataset.bp = 'full';
    const shell = mode === 'hover' ? el('div', 'cc-q-panel') : root;
    if (mode === 'hover') { const hd = el('div', 'cc-q-head'); hd.appendChild(el('b', 'cc-q-h', 'Task queue')); hd.appendChild(el('span', 'cc-q-sum')); shell.appendChild(hd); root.appendChild(shell); }
    shell.appendChild(ctlEl()); shell.appendChild(el('div', 'cc-q-list'));
    const foot = el('div', 'cc-q-foot'); foot.appendChild(oddsTrigger()); foot.appendChild(el('span', 'cc-q-fl')); foot.appendChild(el('span', 'cc-q-hint', '')); shell.appendChild(foot);
    wire(root); return root;
  }
  function setWidth(root, w) {
    const bp = w >= 340 ? 'full' : w >= 180 ? 'compact' : 'micro';
    const s = bp === 'full' ? Math.min(1.5, Math.max(0.9, w / 450)) : bp === 'compact' ? Math.min(1.1, Math.max(0.9, w / 300)) : 1;
    root.style.setProperty('--s', s.toFixed(3)); root.dataset.bp = bp; if (w >= 620) root.dataset.wide = '1'; else delete root.dataset.wide;
    const pe = root.closest('#cc-queue'); if (pe) { pe.dataset.bp = bp; pe.style.setProperty('--cc-qs', s.toFixed(3)); }
  }

  // ---------------------------------------------------------------- the option tray
  let tray = null, trayRow = null, trayRoot = null, openT = 0, closeT = 0, popT = 0, peek = false, drag = null;
  function ensureTray() {
    if (tray) return tray;
    const host = el('div', 'cc-qroot cc-q-trayhost'); host.id = 'cc-q-tray';
    tray = el('div', 'cc-q-tray'); tray.appendChild(el('div', 'cc-q-pop')); host.appendChild(tray); document.body.appendChild(host);
    host.addEventListener('mouseenter', () => { clearTimeout(closeT); });
    host.addEventListener('mouseleave', () => schedClose());
    tray._host = host; return tray;
  }
  let raisedPanel = null, raisedZ = '';
  function unraise() { if (raisedPanel) { raisedPanel.style.zIndex = raisedZ; raisedPanel = null; raisedZ = ''; } }
  function closeTray(now) {
    clearTimeout(openT); clearTimeout(popT); unraise();
    if (!tray) return;
    tray.classList.remove('is-on'); tray.querySelector('.cc-q-pop').classList.remove('is-on');
    if (trayRow) trayRow.classList.remove('is-open'); trayRow = null; trayRoot = null; peek = false;
    if (now) tray._host.style.display = 'none';
  }
  function schedClose() { clearTimeout(closeT); closeT = setTimeout(() => { if (!peek) closeTray(); }, 170); }
  function placeTray(root, row) {
    const host = tray._host, anchor = root.closest('#cc-queue') || root.querySelector('.cc-q-panel') || root, rr = anchor.getBoundingClientRect(), rw = row.getBoundingClientRect();
    const bd = E(), bounds = { left: 0, right: window.innerWidth, top: bd.top || 0, bottom: window.innerHeight - (bd.bottom || 0) };
    host.style.display = ''; host.style.left = '0px'; host.style.top = '0px'; tray.dataset.side = 'right';
    const tw = tray.offsetWidth + 8, th = tray.offsetHeight;
    const side = rr.left - tw + 10 >= bounds.left ? 'left' : rr.right + tw - 10 <= bounds.right ? 'right' : root.dataset.bp === 'micro' ? 'column' : 'inset';
    tray.dataset.side = side;
    const th2 = tray.offsetHeight, tw2 = tray.offsetWidth;
    let x = side === 'right' ? rr.right - 10 : side === 'left' ? rr.left - tw2 + 10 : side === 'inset' ? rr.right - tw2 - 12 : rr.left + rr.width / 2 - tw2 / 2;
    let y = rw.top; if (side === 'column') y -= (th2 - rw.height) / 2;
    const list = root.querySelector('.cc-q-list').getBoundingClientRect();
    const lo = side === 'column' ? bounds.top : Math.max(list.top, bounds.top), hi = (side === 'column' ? bounds.bottom : Math.min(list.bottom, bounds.bottom)) - th2;
    y = Math.max(lo, Math.min(y, Math.max(lo, hi)));
    host.style.left = Math.round(x) + 'px'; host.style.top = Math.round(y) + 'px';
    // The tray slides out from UNDER its panel, so it must sit just below the panel, and the panel above every other ScapeLite panel (a pinned card at the same level used to cover the tray).
    // While the tray is open the pinned queue panel is lifted to the top of the panel band (1891) and the tray goes just under it (1890); closeTray puts the panel's level back.
    const kept = root.closest('.cc-panel');
    if (kept) { if (raisedPanel !== kept) { unraise(); raisedPanel = kept; raisedZ = kept.style.zIndex; } kept.style.zIndex = '1891'; host.style.zIndex = '1890'; }
    else { const pz = parseInt(getComputedStyle(root.querySelector('.cc-q-panel') || root).zIndex, 10); host.style.zIndex = String((Number.isFinite(pz) ? pz : 1100) - 1); }
    if (root.closest('#cc-bar-tip')) host.style.zIndex = '2147482599';
    tray.querySelector('.cc-q-pop').classList.toggle('is-up', y + th2 + 200 > bounds.bottom);
    host.dataset.bp = root.dataset.bp; host.style.setProperty('--s', root.style.getPropertyValue('--s') || '1');
    return side;
  }
  function popFor(t, s, k) {
    const o = s.opts[k], pop = tray.querySelector('.cc-q-pop'); pop.textContent = '';
    pop.appendChild(el('b', '', o.name + (o.qty ? ' ×' + o.qty : ''))); pop.appendChild(el('em', '', o.skillName + ' · ' + o.place));
    const dl = el('dl'); const row = (a, b) => { dl.appendChild(el('dt', '', a)); dl.appendChild(el('dd', '', b)); };
    row('Time', fmtTime(o.timeSec)); row('XP', num(o.xp)); if (o.corr) row(o.corrMeasured ? 'Measured correction' : 'Estimated correction', 'slay task time and XP'); if (Number.isFinite(o.xpHr)) row('XP / hour', num(o.xpHr)); if (Number.isFinite(o.success) && o.success < 1) row('Success', Math.round(o.success * 100) + '%'); if (o.xpBonus) row('XP bonus', '+' + Math.round(o.xpBonus * 100) + '%');
    pop.appendChild(dl);
    if (k === s.sel && s.mat) pop.appendChild(Object.assign(el('div', 'cc-q-matnote', s.mat.text), { }));
    // every tag leads with its icon (the game's own picture, or a gold check / bolt / star badge), one line each, so the popup reads as the same icon system as the tiles
    const tag = (t2, c, ic) => { const u = el('u'); u.dataset.t = c; if (ic && ic[0] === '/') { const im = el('img'); im.src = ic; im.alt = ''; u.appendChild(im); } else u.appendChild(el('i', '', ic || '')); u.appendChild(el('span', '', t2)); pop.appendChild(u); };
    pop.dataset.k = o.k;
    tag(k === s.sel ? 'Chosen for this row' : 'Click to swap this in', k === s.sel ? 'sel' : 'dim', k === s.sel ? '✓' : '⇄');
    if (k === s.advK) tag('Route Advisor pick', 'adv', '★'); if (k === s.bestK && s.opts.length > 1) tag('Fastest XP of this row', 'xp', '⚡');
    if (o.lucky) tag('Lucky: double XP and rewards', 'lucky', MK_SRC.lucky); if (o.boost) tag(MK_TXT.boost, 'boost', '▲');
    if (o.quest.length) tag('Quest: ' + Array.from(new Set(o.quest)).join(', '), 'quest', MK_SRC.quest);
    if (o.diary) tag(MK_TXT.diary, 'diary', MK_SRC.diary); if (o.tp) tag(MK_TXT.tp, 'tp', MK_SRC.tp);
    pop.classList.add('is-on');
  }
  function rerollTile(s) {
    const b = el('button', 'cc-tile cc-q-tile cc-q-opt cc-q-reroll'); b.type = 'button'; b.dataset.k = 'reroll';
    b.appendChild(el('span', 'cc-q-glyph', s.now ? '⏭' : '↻')); const info = rerollInfo(s.index);
    if (info && info.cost) b.appendChild(el('b', 'cc-tier', info.cost));
    if (!info || info.disabled) b.classList.add('is-off');
    b.addEventListener('mouseenter', () => { clearTimeout(popT); popT = setTimeout(() => popReroll(s), 220); });
    b.addEventListener('mouseleave', () => { clearTimeout(popT); tray.querySelector('.cc-q-pop').classList.remove('is-on'); });
    b.addEventListener('click', (ev) => {
      ev.stopPropagation(); if (!ev.isTrusted || b.classList.contains('is-off')) return;
      tray.classList.add('is-wait'); setTimeout(() => tray.classList.remove('is-wait'), 800);
      doReroll(s.index);
    });
    return b;
  }
  function popReroll(s) {
    const info = rerollInfo(s.index), pop = tray.querySelector('.cc-q-pop'); pop.textContent = '';
    if (!info) { pop.appendChild(el('b', '', s.now ? 'Skip task' : 'Reroll row')); pop.appendChild(el('em', '', 'The game’s button is not available right now.')); }
    else { pop.appendChild(el('b', '', info.lines[0] || (s.now ? 'Skip task' : 'Reroll row'))); info.lines.slice(1).forEach((l) => pop.appendChild(el('em', '', l))); }
    pop.classList.add('is-on');
  }
  function fillTray(s) {
    tray.querySelectorAll('.cc-q-opt').forEach((n) => n.remove());
    const pop = tray.querySelector('.cc-q-pop');
    tray.insertBefore(rerollTile(s), pop);   // the reroll (or skip) tile is always the leftmost
    // Order: the reroll tile, then the options you did not pick (slayer first, then skilling), and the picked task last, at the far right (optionally left out: right-click the queue panel).
    const showChosen = setting('uiQueueTrayChosen', true);
    const lane = (o) => (o.k === 'kill' ? 0 : 1);
    const order = s.opts.map((o, k) => k).filter((k) => k !== s.sel).sort((a, b) => lane(s.opts[a]) - lane(s.opts[b]) || a - b);
    if (showChosen && s.opts[s.sel]) order.push(s.sel);
    order.forEach((k) => {
      const o = s.opts[k], t = tile(o, 'cc-q-opt'); const b = el('button', 'cc-tile cc-q-tile cc-q-opt' + (k === s.sel ? ' is-sel' : '') + (k === s.advK ? ' is-adv' : '')); b.dataset.k = o.k; b._k = k; b.type = 'button'; if (o.e) b.dataset.e = o.e;
      if (k === s.advK) b.dataset.p = 'adv'; else if (k === s.bestK && s.opts.length > 1) b.dataset.p = 'xp';
      while (t.firstChild) b.appendChild(t.firstChild);
      b.addEventListener('mouseenter', (ev) => { clearTimeout(popT); showTipOpt(b, s, k, ev.clientX, ev.clientY); mapPreview(s.index, k, o.node, o.act); });
      b.addEventListener('mousemove', (ev) => { if (tip3) placeTip3(ev.clientX, ev.clientY); });
      b.addEventListener('mouseleave', () => { clearTimeout(popT); hideTip3(); mapPreview(null); });
      b.addEventListener('click', (ev) => {
        ev.stopPropagation(); if (!ev.isTrusted) return;
        if (ev.ctrlKey && setting('uiQueueClickMap', true)) {   // Ctrl-click an option = the game's own Ctrl-click on it: the map pans to that task
          const go = gameOption(s.index, k, o.node, o.act); if (go) go.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
          return;
        }
        if (k === s.sel) return;
        tray.classList.add('is-wait'); setTimeout(() => tray.classList.remove('is-wait'), 400);
        selectOption(s.index, k, o);
      });
      if (o.k === 'kill') b.addEventListener('contextmenu', (ev) => {   // right-click a fight = the game's right-click on that option (its combat calculator)
        if (!setting('uiQueueRightClick', true)) return; ev.preventDefault(); ev.stopPropagation(); if (!ev.isTrusted) return;
        if (s.index >= 0 && !rowsFresh()) { flash('The game’s queue panel is out of date, so nothing was opened. Open the game’s Tasks panel once and try again.'); return; }
        forwardCtx(gameOption(s.index, k, o.node, o.act), ev.clientX, ev.clientY);
      });
      tray.insertBefore(b, pop);
    });
  }
  function openTray(root, row, isPeek, litNode) {
    const s = row._s; if (!s || drag) return;
    ensureTray(); clearTimeout(closeT);
    if (trayRow && trayRow !== row) trayRow.classList.remove('is-open');
    trayRow = row; trayRoot = root; peek = !!isPeek; row.classList.add('is-open');
    fillTray(s);
    if (litNode) tray.querySelectorAll('.cc-q-opt:not(.cc-q-reroll)').forEach((b) => b.classList.toggle('is-adv', !!s.opts[b._k] && s.opts[b._k].node === litNode));   // the reroll tile is not an option: indexing it shifted the highlight by one and threw on a row's last option
    placeTray(root, row);
    requestAnimationFrame(() => tray.classList.add('is-on'));
  }

  // ---------------------------------------------------------------- the game's own tooltip of a task, beside the panel on the side the tray is not on
  let tip3 = null;
  function hideTip3() { if (tip3) { tip3.remove(); tip3 = null; } }
  function placeTip3(x, y) {
    if (!tip3) return; const tr = tip3.getBoundingClientRect(), bd = E();
    let left = x + 18, top = y + 22;
    if (!(window.__ccUI && window.__ccUI.tipAtCursor()) && tip3.__row && tip3.__row.isConnected) { const rr = tip3.__row.getBoundingClientRect(); left = rr.right + 10; top = rr.top; x = rr.left; }
    if (left + tr.width > window.innerWidth - 6) left = x - tr.width - 14;
    if (top + tr.height > window.innerHeight - (bd.bottom || 0) - 6) top = y - tr.height - 16;
    tip3.style.left = Math.round(Math.max(6, left)) + 'px'; tip3.style.top = Math.round(Math.max((bd.top || 0) + 4, top)) + 'px';
  }
  // The game's own task tooltip of an option: found by its row and option index (several rows can hold the same task with different amounts), else by node and activity.
  function gameOption(slotIdx, k, node, act) {
    const pn = document.getElementById('unified-queue-panel'); if (!pn) return null;
    const okNode = (o) => { const sr = o && o.querySelector('.icon-scroll-row'); return !!sr && sr.dataset.nodeId === node && (!sr.dataset.activityId || !act || sr.dataset.activityId === act); };
    let o = slotIdx >= 0 ? pn.querySelector('.uq-row[data-row-index="' + slotIdx + '"] .icon-option[data-option-index="' + k + '"]') : (pn.querySelector('.uq-current .icon-option.selected') || pn.querySelector('.uq-current .icon-option'));
    if (okNode(o)) return o;
    o = null; pn.querySelectorAll('.icon-option').forEach((c) => { if (!o && okNode(c)) o = c; });
    return o;
  }
  // the ScapeLite lines added under the game's tooltip
  function tipExtras(s, k) {
    const o = s && s.opts && s.opts[k]; if (!o) return null;
    const box = el('div', 'tt-line cc-q-xtra');
    // icon lines (the same pictures as the tiles); ic is an image path or a short glyph in a coloured badge
    const add = (txt, c, ic) => { const d = el('div', 'cc-q-xl', txt); if (c) d.style.color = c; if (ic) { d.classList.add('cc-q-xi'); const b = ic[0] === '/' ? Object.assign(el('img'), { src: ic, alt: '' }) : el('i', '', ic); if (ic[0] !== '/' && c) b.style.background = c; d.prepend(b); } box.appendChild(d); };
    if (s.opts.length > 1 && k === s.bestK) add('Fastest XP of this row', 'var(--cc-good)', '⚡');
    if (k === s.advK) add('The Route Advisor would pick this', 'var(--cc-accent)', '★');
    if (o.lucky) add('Lucky task: double XP and rewards', 'var(--cc-accent)', MK_SRC.lucky);
    if (o.boost) add('Drops XP-boost items', 'var(--cc-magic)', '▲');
    if (o.diary) add('Counts for a diary step', 'var(--cc-text)', MK_SRC.diary);
    if (k === s.sel && s.mat) add(s.mat.text, s.mat.lvl === 'bad' ? 'var(--cc-bad)' : s.mat.lvl === 'warn' ? 'var(--cc-warn)' : 'var(--cc-info)', '!');
    if (Number.isFinite(o.xpHr)) add('XP / hour: ' + num(o.xpHr) + (o.xpBonus ? ' (includes +' + Math.round(o.xpBonus * 100) + '% XP bonus)' : ''), 'var(--cc-text-dim)');
    return box.childNodes.length ? box : null;
  }
  function showTipFor(src, x, y, owner, extras) {
    hideTip3(); if (drag) return false;
    const tt = src && src.querySelector('.icon-tooltip'); if (!tt || !tt.innerHTML.trim()) return false;
    tip3 = el('div'); tip3.id = 'cc-q-tip3'; const w = el('div', 'icon-tooltip uq-tooltip tooltip cc-tt-clone'); w.innerHTML = tt.innerHTML; tip3.appendChild(w); if (extras) w.appendChild(extras); document.body.appendChild(tip3);
    tip3.__row = owner; placeTip3(x, y);   // it follows the pointer while it is over the card
    return true;
  }
  function showTip3(root, row, x, y) {
    const node = row.dataset.node, act = row.dataset.act; if (!node || drag) return; hideTip3();
    const s = row._s || null, k = s && Number.isFinite(s.sel) ? s.sel : 0, src = gameOption(s && s.index != null ? s.index : -1, k, node, act);
    showTipFor(src, x, y, row, s && s.opts ? tipExtras(s, k) : null);
  }
  function showTipOpt(b, s, k, x, y) { const o = s.opts[k]; showTipFor(gameOption(s.index, k, o.node, o.act), x, y, b, tipExtras(s, k)); }

  // ---------------------------------------------------------------- route preview on the World Map
  // The game draws the route to a task on its World Map when you hover that task in its own queue panel (its option tile calls setRoutePreview on mouseenter, and the map only
  // draws it while the map window is open). Hovering our card or tile passes the same hover to the game's matching tile, so the game paints the route itself: nothing is drawn
  // or clicked by ScapeLite. It is skipped when the map is closed, when the game's hidden queue panel is out of date (the route would be another task's) and while dragging.
  let mpEl = null, mpT = 0;
  const mpFire = (e, type) => { try { e.dispatchEvent(new MouseEvent(type, { bubbles: false, cancelable: false })); } catch (err) { /* the tile is gone */ } };
  function mapPreview(slotIdx, k, node, act) {
    clearTimeout(mpT);
    if (slotIdx == null) {
      if (mpEl) { const e = mpEl.isConnected ? mpEl : document.querySelector('#unified-queue-panel .icon-option'); mpEl = null; if (e) mpFire(e, 'mouseleave'); }
      return;
    }
    mpT = setTimeout(() => {
      try {
        if (drag || slotIdx < 0 || !setting('uiQueueMapPreview', true) || !document.body.classList.contains('map-active') || !rowsFresh()) { mapPreview(null); return; }
        const g = gameOption(slotIdx, k, node, act); if (!g) { mapPreview(null); return; }
        if (g === mpEl) return;
        if (mpEl) mapPreview(null);
        mpEl = g; mpFire(g, 'mouseenter');
      } catch (e) { mpEl = null; }
    }, 90);
  }

  // ---------------------------------------------------------------- the Route Advisor points at a task
  let hlState = null;
  function applyHl(root) {
    const roots = root ? [root] : allRoots();
    roots.forEach((r) => {
      r.querySelectorAll('.cc-q-row.is-adv').forEach((e) => e.classList.remove('is-adv'));
      if (!hlState) return;
      const row = Array.from(r.querySelectorAll('.cc-q-row[data-rkey]')).find((x) => x.dataset.rkey === hlState.key && x.dataset.rnth === String(hlState.nth));
      if (!row) return;
      row.classList.add('is-adv');
      const sc = row.closest('.cc-q-list'); if (sc) { const a = row.getBoundingClientRect(), b = sc.getBoundingClientRect(); if (a.top < b.top || a.bottom > b.bottom) row.scrollIntoView({ block: 'nearest' }); }
      const s = row._s; if (s && s.opts.length > 1 && s.opts[s.sel].node !== hlState.node && s.opts.some((o) => o.node === hlState.node)) openTray(r, row, true, hlState.node);
    });
    if (!hlState && peek) { peek = false; closeTray(); }
  }
  const highlight = (key, nth, node) => { hlState = key == null ? null : { key, nth, node }; applyHl(); };

  // ---------------------------------------------------------------- pointer wiring on a root (delegated, so replaced rows keep working)
  function wire(root) {
    root.addEventListener('mouseover', (ev) => {
      if (drag) return;
      const row = ev.target.closest && ev.target.closest('.cc-q-row'); if (!row || !root.contains(row)) return;
      showTip3(root, row, ev.clientX, ev.clientY);
      if (row._s && !row._s.now) mapPreview(row._s.index, row._s.sel, row.dataset.node, row.dataset.act); else mapPreview(null);
      clearTimeout(closeT);
      if (row._s) {
        if (trayRow === row) return;
        clearTimeout(openT); openT = setTimeout(() => openTray(root, row, false), tray && tray.classList.contains('is-on') ? 60 : 110);
      } else { clearTimeout(openT); if (!peek) schedClose(); }
    });
    root.addEventListener('mousemove', (ev) => { if (tip3) placeTip3(ev.clientX, ev.clientY); });
    root.addEventListener('mouseout', (ev) => { const row = ev.target.closest && ev.target.closest('.cc-q-row'); if (row && !row.contains(ev.relatedTarget)) { hideTip3(); mapPreview(null); } });
    root.addEventListener('mouseleave', () => { clearTimeout(openT); hideTip3(); mapPreview(null); schedClose(); });
    root.querySelector('.cc-q-list').addEventListener('scroll', () => { closeTray(); hideTip3(); });
    root.addEventListener('click', (ev) => {   // click a card = the map pans to the task, like a click on the game's own row
      if (!ev.isTrusted || drag || root.dataset.state || !setting('uiQueueClickMap', true)) return;
      const row = ev.target.closest && ev.target.closest('.cc-q-row'); if (!row || !root.contains(row) || ev.target.closest('.cc-q-switch')) return;
      panToRow(row);
    });
    root.addEventListener('contextmenu', (ev) => {   // right-click a fight card = the game's own right-click on its row (the combat calculator of that mob)
      if (!setting('uiQueueRightClick', true) || root.dataset.state) return;
      const row = ev.target.closest && ev.target.closest('.cc-q-row'); if (!row || !root.contains(row) || row.dataset.k !== 'kill') return;
      ev.preventDefault(); ev.stopPropagation(); if (!ev.isTrusted || drag) return;
      ctxRow(row, ev.clientX, ev.clientY);
    });
    root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !ev.isTrusted) return;
      if (root.dataset.state) return;
      const bar = ev.target.closest && ev.target.closest('.cc-q-insert'); if (bar && root.contains(bar)) { startInsertDrag(ev, root, bar); return; }
      const row = ev.target.closest && ev.target.closest('.cc-q-row[data-s]'); if (!row) return;
      startDrag(ev, root, row);
    });
  }
  const allRoots = () => [keptRoot, hoverRoot].filter((r) => r && r.isConnected);

  // The number badges and slot indexes are positions: after a move the rows keep their old values in their new places, so hand the old values out again in the new order at once.
  function renumber(oldRows, newRows) {
    const keep = oldRows.map((r) => { const n = r.querySelector('.cc-q-num'); return { s: r.dataset.s, n: n ? n.firstChild && n.firstChild.nodeType === 3 ? n.firstChild.nodeValue : null : null }; });
    newRows.forEach((r, i) => { const k = keep[i]; if (!k) return; r.dataset.s = k.s; const n = r.querySelector('.cc-q-num'); if (n && n.firstChild && n.firstChild.nodeType === 3 && k.n != null) n.firstChild.nodeValue = k.n; });
  }
  // ---------------------------------------------------------------- drag to reorder
  function startDrag(ev, root, row) {
    const x0 = ev.clientX, y0 = ev.clientY, list = root.querySelector('.cc-q-list');
    const rows = () => Array.from(list.querySelectorAll('.cc-q-row[data-s]')), from = rows().indexOf(row); if (from < 0) return;
    let on = false, ins = null, ghost = null, idx = from, off = 0, raf = 0, lastY = y0, lastX = x0, gl = 0, gw = 0, geo = null, k = 1, lr0 = null;
    // The rows do not move while you drag (the dragged one stays in its place), so their positions are measured ONCE, in the list's own pixels
    // (screen size divided by the panel's scale, which is what made the line land in the wrong place when the panel is scaled). Each frame then
    // only does arithmetic and moves the ghost with a transform: no layout reads, so the drag stays smooth.
    const measure = () => {
      lr0 = list.getBoundingClientRect(); k = lr0.width / (list.offsetWidth || lr0.width) || 1;
      const rs = rows(); geo = rs.map((r) => { const b = r.getBoundingClientRect(); return { top: (b.top - lr0.top) / k + list.scrollTop, h: b.height / k }; });
      geo.forEach((g, i) => { g.gap = i ? g.top - (geo[i - 1].top + geo[i - 1].h) : 8; });   // the free space above a card (a walking pill, the NEW TASKS bar): the line sits in the middle of it
    };
    const place = () => {
      const n = geo.length, ly = (lastY - lr0.top) / k + list.scrollTop; idx = n;
      for (let t = 0; t < n; t++) if (ly < geo[t].top + geo[t].h / 2) { idx = t; break; }
      ins.hidden = idx === from || idx === from + 1;
      const y = idx < n ? geo[idx].top - geo[idx].gap / 2 : geo[n - 1].top + geo[n - 1].h + 3;
      const v = Math.round(y) + 'px'; if (ins.style.top !== v) ins.style.top = v;
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const z = 44;
      if (lastY < lr0.top + z) list.scrollTop -= Math.ceil((lr0.top + z - lastY) / 4); else if (lastY > lr0.bottom - z) list.scrollTop += Math.ceil((lastY - (lr0.bottom - z)) / 4);
      ghost.style.transform = 'translate(' + gl + 'px,' + Math.round(lastY - off) + 'px)' + (k !== 1 ? ' scale(' + k.toFixed(4) + ')' : ''); place();
    };
    const move = (e) => {
      lastY = e.clientY; lastX = e.clientX;
      if (!on) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
        on = true; drag = true; closeTray(true); hideTip3(); root._drag = true; root.classList.add('is-drag'); row.classList.add('is-dragging');
        const rr = row.getBoundingClientRect(); off = y0 - rr.top;
        ghost = row.cloneNode(true); ghost.classList.remove('is-dragging', 'is-open'); ghost.classList.add('cc-q-ghost'); ghost.removeAttribute('data-s'); ghost.style.width = rr.width + 'px'; ghost.style.left = rr.left + 'px'; ghost.style.setProperty('--s', root.style.getPropertyValue('--s') || '1');
        const gh = el('div', 'cc-qroot'); gh.dataset.bp = root.dataset.bp; gh.style.setProperty('--s', root.style.getPropertyValue('--s') || '1'); gh.style.position = 'fixed'; gh.style.zIndex = '2147482620'; gh.style.pointerEvents = 'none'; gh.appendChild(ghost); ghost = gh; document.body.appendChild(gh);
        gl = Math.round(rr.left); gw = row.offsetWidth; ghost.style.left = '0px'; ghost.style.top = '0px'; ghost.style.width = gw + 'px'; ghost.style.willChange = 'transform'; ghost.style.transformOrigin = '0 0';
        ghost.firstChild.style.left = '0px'; ghost.firstChild.style.top = '0px'; ghost.firstChild.style.width = gw + 'px';   // fixed inside the transformed wrapper: sits at its origin
        measure(); ins = el('i', 'cc-q-ins'); list.appendChild(ins); raf = requestAnimationFrame(frame);
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); cancelAnimationFrame(raf);
      if (ghost) ghost.remove(); if (ins) ins.remove(); root.classList.remove('is-drag'); row.classList.remove('is-dragging'); root._drag = false;
      setTimeout(() => { drag = null; }, 30);
      if (!on) return;
      const to = idx > from ? idx - 1 : idx;
      if (to !== from && reorderSlot(from, to)) {
        // show the new order at once (the game's own data catches up a moment later)
        const rs = rows(), par = rs[from], ref = rs[to], hopOf = (r) => { const p0 = r.previousElementSibling; return p0 && p0.classList.contains('cc-q-hop') ? p0 : null; };
        const frag = document.createDocumentFragment(), hp = hopOf(par); if (hp) frag.appendChild(hp); frag.appendChild(par);
        if (to > from) ref.after(frag); else (hopOf(ref) || ref).before(frag);
        par.classList.add('is-dropped');
        renumber(rs.map((r) => r), rows());
      }
    };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true);
  }

  // ---------------------------------------------------------------- drag the NEW TASKS bar
  // The bar follows your pointer from card to card (it sits before the card under the pointer, never above the lowest row the game allows); on release the move is replayed on the game's own bar.
  function startInsertDrag(ev, root, bar) {
    const list = root.querySelector('.cc-q-list'), rows = () => Array.from(list.querySelectorAll('.cc-q-row[data-s]'));
    const from = Number(bar.dataset.at), min = Number(bar.dataset.min), x0 = ev.clientX, y0 = ev.clientY;
    let on = false, idx = from, lastY = y0, raf = 0, cancel = false;
    ev.preventDefault();
    const hopOf = (r) => { const p0 = r.previousElementSibling; return p0 && p0.classList.contains('cc-q-hop') ? p0 : r; };
    const put = () => {
      const rs = rows(); let t = rs.length;
      for (let i = 0; i < rs.length; i++) { const b = rs[i].getBoundingClientRect(); if (lastY < b.top + b.height / 2) { t = i; break; } }
      t = Math.max(min, t); if (t === idx) return; idx = t;
      if (t < rs.length) hopOf(rs[t]).before(bar); else list.appendChild(bar);
      rs.forEach((r, i) => r.classList.toggle('is-held', i >= idx));
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const lr = list.getBoundingClientRect(), z = 44;
      if (lastY < lr.top + z) list.scrollTop -= Math.ceil((lr.top + z - lastY) / 4); else if (lastY > lr.bottom - z) list.scrollTop += Math.ceil((lastY - (lr.bottom - z)) / 4);
      put();
    };
    const move = (e) => {
      lastY = e.clientY;
      if (!on) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
        on = true; drag = true; closeTray(true); hideTip3(); root._drag = true; root.classList.add('is-drag'); bar.classList.add('is-dragging'); raf = requestAnimationFrame(frame);
      }
    };
    const key = (e) => { if (e.key === 'Escape') { cancel = true; up(); } };
    const up = () => {
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('keydown', key, true); cancelAnimationFrame(raf);
      bar.classList.remove('is-dragging'); root.classList.remove('is-drag'); root._drag = false;
      setTimeout(() => { drag = null; }, 30);
      if (!on) return;
      if (!cancel && idx !== from && moveInsert(idx)) insOv = { at: idx, t: Date.now() };
      root._sig = null; refreshAll(true);   // redraw from the game's data: the bar is where it really is (or back where it was)
    };
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('keydown', key, true);
  }

  // ---------------------------------------------------------------- roll odds: the chance of each skill (Slay lane: each mob of your slayer master) for the next task roll
  // All numbers are the game's own formulas read through the bridge (skill levers, task levels, the master's mob list); nothing is sent to the game. A "~" marks odds that are only an estimate.
  const LEVER = 1.25, ODDS_NOTE_SKILL = 'The game rolls the skill first (its lever weight), then a task you have the level for. One of the three tasks in a new row is a combat task from your slayer master. Automaters and rerolls are not counted.';
  let od = null;   // { host, c1, c2, root, trig, t, hot }
  // percentages that add up to exactly 100: the rounding left over goes to the biggest remainders
  function pctRound(vals, dp) {
    const f = Math.pow(10, dp), fl = vals.map((v) => Math.floor(v * f + 1e-9)); let rem = Math.round(vals.reduce((a, b) => a + b, 0) * f) - fl.reduce((a, b) => a + b, 0);
    vals.map((v, i) => [v * f - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0) { fl[i]++; rem--; } });
    return fl.map((x) => x / f);
  }
  const fmtPct = (v, raw) => (v === 0 && raw > 0 ? '<0.1' : v.toFixed(1)) + '%';
  const leverTxt = (k) => (k > 0 ? '+' : '') + k + '  (' + Math.pow(LEVER, k).toFixed(2) + '\u00D7 as likely)';
  function oddsTrigger() {
    const b = el('button', 'cc-q-odds', 'Roll odds'); b.type = 'button'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); b.hidden = !setting('uiQueueOdds', true);
    b.addEventListener('mouseenter', () => { clearTimeout(od && od.t); const t = setTimeout(() => openOdds(b), 90); if (!od) oddsInit(); od.t = t; });
    b.addEventListener('mouseleave', () => oddsLeave());
    b.addEventListener('focus', () => openOdds(b)); b.addEventListener('blur', () => oddsLeave());
    b.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOdds(); });
    return b;
  }
  function oddsInit() {
    if (od) return od;
    const host = el('div', 'cc-qroot cc-q-oddshost'); host.id = 'cc-q-odds';
    const c1 = el('div', 'cc-q-oc'), c2 = el('div', 'cc-q-oc'); c1.setAttribute('role', 'tooltip'); host.appendChild(c1); host.appendChild(c2); document.body.appendChild(host);
    [c1, c2].forEach((c) => { c.addEventListener('mouseenter', () => clearTimeout(od.t)); c.addEventListener('mouseleave', () => oddsLeave()); });
    od = { host, c1, c2, root: null, trig: null, t: 0, hot: null, key: '' }; return od;
  }
  function oddsLeave() { if (od) { clearTimeout(od.t); od.t = setTimeout(closeOdds, 220); } }
  function closeOdds() {
    if (!od) return; clearTimeout(od.t); od.c1.classList.remove('is-on'); od.c2.classList.remove('is-on'); od.hot = null; od.key = '';
    if (od.trig) od.trig.setAttribute('aria-expanded', 'false'); od.trig = null; od.root = null;
  }
  function oddsData() {
    const b = bridge(); if (!b) return null;
    let lane = 'skills'; try { const c = b.queueCtl && b.queueCtl(); if (c && c.lane === 'slay') lane = 'slay'; } catch (e) { /* default */ }
    if (lane === 'slay') { const s = b.oddsSlay && b.oddsSlay(); return s ? { lane, slay: s } : null; }
    const sk = b.oddsSkills && b.oddsSkills(); return sk ? { lane, skills: sk } : null;
  }
  function oddsRow(img, name, small, frac, ptxt, cls) {
    const r = el('div', 'cc-q-or' + (cls ? ' ' + cls : '')); r.tabIndex = 0;
    if (img && img[0] === '/') { const im = el('img'); im.src = img; im.alt = ''; r.appendChild(im); } else r.appendChild(el('span', 'tb', img || ''));
    const t = el('span', 't', name); if (small) t.appendChild(el('small', '', small)); r.appendChild(t);
    const bar = el('span', 'bar'); if (frac > 0) { const i = el('i'); i.style.width = Math.max(3, Math.min(100, frac * 100)).toFixed(1) + '%'; bar.appendChild(i); } r.appendChild(bar);
    r.appendChild(el('span', 'p', ptxt)); return r;
  }
  function oddsHead(img, title, sub) {
    const h = el('div', 'cc-q-oh'); if (img) { const im = el('img'); im.src = img; im.alt = ''; h.appendChild(im); }
    const d = el('div'); d.appendChild(el('b', '', title)); if (sub) d.appendChild(el('em', '', sub)); h.appendChild(d); return h;
  }
  const oddsNote = (txt) => el('div', 'cc-q-on', txt);
  // the first card: every skill (or every mob of the chosen master) with its chance
  function fillOdds1(d) {
    const c = od.c1; c.textContent = ''; c.dataset.k = d && d.lane === 'slay' ? 'kill' : 'skill';
    if (!d) { c.appendChild(oddsHead(null, 'Roll odds', 'The game\u2019s data is not ready yet.')); return; }
    const list = el('div', 'cc-q-ol');
    if (d.lane === 'skills') {
      const rows = d.skills.slice().sort((a, b) => b.pct - a.pct), pr = pctRound(rows.map((r) => r.pct), 1), mx = Math.max(...rows.map((r) => r.pct), 1);
      c.appendChild(oddsHead('/assets/icons/skills/levels.png', 'Roll odds: Skilling', 'Chance of each skill for a skilling task'));
      rows.forEach((r, i) => { const row = oddsRow(r.quests ? MK_SRC.quest : skillIcon(r.id), r.name, '', r.pct / mx, (r.quests ? '~' : '') + fmtPct(pr[i], r.pct)); row._it = r; row.dataset.id = r.id; list.appendChild(row); });
      c.appendChild(list); c.appendChild(oddsNote(ODDS_NOTE_SKILL + ' ~ = estimated.'));
    } else {
      const s = d.slay, open = s.mobs.filter((m) => m.open).sort((a, b) => b.pct - a.pct || a.req - b.req), shut = s.mobs.filter((m) => !m.open).sort((a, b) => a.req - b.req), pr = pctRound(open.map((m) => m.pct), 1), mx = Math.max(...open.map((m) => m.pct), 1), est = s.chaos ? '~' : '';
      c.appendChild(oddsHead('/assets/icons/ui/' + String(s.name).toLowerCase() + '.png', 'Roll odds: ' + s.name, s.prefix + ' master, mobs of Slay ' + (s.chaos ? 'any level' : s.levelMin + '-' + s.levelMax) + ' \u00B7 you are Slay ' + s.slayLevel + ' \u00B7 \u21BB ' + num(s.credits)));
      open.forEach((m, i) => { const row = oddsRow(skillIcon('slay'), m.name, '', m.pct / mx, est + fmtPct(pr[i], m.pct)); row._it = m; list.appendChild(row); });
      if (shut.length) { list.appendChild(el('div', 'cc-q-os', 'Locked out (' + shut.length + ')')); shut.forEach((m) => { const row = oddsRow(skillIcon('slay'), m.name, '', 0, 'Slay ' + m.req, 'is-lock'); row._it = m; list.appendChild(row); }); }
      c.appendChild(list);
      c.appendChild(oddsNote('Two of the three tasks in a new row are combat tasks from this master (the Slay lane); the third is a skilling task. ' + (s.chaos ? '~ = estimated: the Chaos master rolls from every mob and favours your levers twice as strongly; this follows the game\u2019s formula but is unchecked.' : 'Odds are among the mobs you can fight now.')));
    }
    list.querySelectorAll('.cc-q-or').forEach((r) => {
      const hot = () => { clearTimeout(od.t); showOdds2(r, d); };
      r.addEventListener('mouseenter', hot); r.addEventListener('focus', hot);
    });
  }
  // the second card: the tiers of the hovered skill, or the detail of the hovered mob
  function showOdds2(row, d) {
    const c = od.c2, it = row._it; if (!it) return; if (od.hot) od.hot.classList.remove('is-hot'); od.hot = row; row.classList.add('is-hot');
    c.textContent = ''; c.dataset.k = d.lane === 'slay' ? 'kill' : 'skill';
    const dl = el('dl', 'cc-q-od'), kv = (a, b) => { dl.appendChild(el('dt', '', a)); dl.appendChild(el('dd', '', b)); };
    if (d.lane === 'skills') {
      if (it.quests) {
        c.appendChild(oddsHead(MK_SRC.quest, 'Quests', 'A quest step as one of the three tasks'));
        kv('Chance', '~' + it.pct.toFixed(1) + '%'); c.appendChild(dl);
        c.appendChild(oddsNote('~ = estimated. A quest step can only be rolled while one of your active quests has a step you can reach, and quest tools add a bonus on top of this share.'));
      } else {
        const tiers = (bridge() && bridge().oddsTiers) ? bridge().oddsTiers(it.id) : null;
        c.appendChild(oddsHead(skillIcon(it.id), it.name, 'Which task of this skill is rolled'));
        kv('Your level', String(it.level)); kv('Weight lever', leverTxt(it.lever)); if (it.lucky != null) kv('Lucky task chance', (it.lucky * 100).toFixed(1) + '%'); c.appendChild(dl);
        if (tiers && tiers.length) {
          const open = tiers.filter((t) => t.open), pr = pctRound(open.map((t) => t.pct), 1), mx = Math.max(...open.map((t) => t.pct), 1), list = el('div', 'cc-q-ol'); 
          tiers.slice().sort((a, b) => b.tier - a.tier).forEach((t) => { list.appendChild(t.open ? oddsRow('T' + t.tier, t.name, '', t.pct / mx, fmtPct(pr[open.findIndex((x) => x.id === t.id)], t.pct)) : oddsRow('T' + t.tier, t.name, '', 0, 'Lv ' + t.level, 'is-lock')); });
          c.appendChild(list);
        }
        c.appendChild(oddsNote('Only tasks you have the level for can be rolled; each open task is weighted by its own lever. Higher tiers unlock as you level up, and the lucky chance comes from your Luck level, tools and pets.'));
      }
    } else {
      c.appendChild(oddsHead(skillIcon('slay'), it.name, it.open ? 'A mob you can be sent to' : 'You cannot be sent to this mob yet'));
      kv('Chance', it.open ? (it.pct < 0.05 ? '<0.1' : it.pct.toFixed(1)) + '%' : 'locked out'); kv('Slay level needed', String(it.req)); kv('Weight lever', leverTxt(it.lever)); c.appendChild(dl);
      c.appendChild(oddsNote(it.open ? 'Its lever (Skills Customization > Slay) makes it ' + Math.pow(LEVER, it.lever).toFixed(2) + '\u00D7 as likely against the other mobs of this master.' : (it.why || 'Not available to you yet.')));
    }
    c.classList.add('is-on'); placeOdds2(row);
  }
  function placeOdds1(trig) {
    const { c1, host } = od, root = od.root, rr = trig.getBoundingClientRect(), bd = E();
    host.style.setProperty('--s', root.style.getPropertyValue('--s') || '1'); host.dataset.bp = root.dataset.bp;
    const top0 = bd.top || 0, bot0 = window.innerHeight - (bd.bottom || 0), above = rr.top - top0 - 10, below = bot0 - rr.bottom - 10, up = above >= Math.min(below, 360) || above >= below;
    c1.style.maxHeight = Math.max(160, up ? above : below) + 'px'; c1.classList.add('is-on');
    const w = c1.offsetWidth, h = c1.offsetHeight; let x = Math.min(Math.max(6, rr.left), window.innerWidth - w - 6), y = up ? rr.top - h - 8 : rr.bottom + 8;
    c1.style.left = Math.round(x) + 'px'; c1.style.top = Math.round(Math.max(top0 + 4, y)) + 'px';
  }
  function placeOdds2(row) {
    const { c1, c2 } = od, a = c1.getBoundingClientRect(), r = row.getBoundingClientRect(), bd = E(), top0 = bd.top || 0, bot0 = window.innerHeight - (bd.bottom || 0);
    c2.style.maxHeight = Math.max(160, bot0 - top0 - 12) + 'px';
    const w = c2.offsetWidth, h = c2.offsetHeight; let x = a.right + 8; if (x + w > window.innerWidth - 6) x = a.left - w - 8; if (x < 6) x = Math.min(6, a.left);
    const y = Math.max(top0 + 4, Math.min(r.top - 4, bot0 - h - 4));
    c2.style.left = Math.round(x) + 'px'; c2.style.top = Math.round(y) + 'px';
  }
  function openOdds(trig) {
    if (drag || trig.hidden) return; oddsInit(); clearTimeout(od.t);
    const root = trig.closest('.cc-qroot'); if (!root) return;
    if (od.trig === trig && od.c1.classList.contains('is-on')) return;
    closeOdds(); od.trig = trig; od.root = root; trig.setAttribute('aria-expanded', 'true');
    fillOdds1(oddsData()); placeOdds1(trig);
  }

  // ---------------------------------------------------------------- the kept panel and the hover card
  // the panel's own on/off switches (settings keys): the cogwheel and the title bar's right-click menu list the same ones, the Settings window has them too
  const SWITCHES = [['uiQueueTrayChosen', 'Include the chosen task in the alternatives'], ['uiQueueInsertBar', 'Show the NEW TASKS bar (where new tasks enter)'], ['uiQueueOdds', 'Show the roll odds in the footer'], ['uiQueueQueued', 'Show the queued combat / skilling dividers'], ['uiQueueClickMap', 'Click a task to show it on the map'], ['uiQueueMapPreview', 'Hover a task or alternative to preview its route on the World Map'], ['uiQueueRightClick', 'Right-click a fight for its menu (combat calculator, swap training), Auto for its defaults'],
    ['uiQueueHeadLevel', 'Current task: show the level bar'], ['uiQueueHeadLoadout', 'Current task: show the loadout (fights)'], ['uiQueueHeadTraining', 'Current task: show the skill you train (fights)'], ['uiQueueHeadKills', 'Current task: show the kill count (fights)'], ['uiQueueHeadIcons', 'Fights: the game\u2019s icons instead of words (cards and current task)']];
  let P = null, keptRoot = null, hoverRoot = null, ro = null, unregPM = null;
  function ensurePanel() {
    if (P) return P;
    P = UI.panel({ id: 'cc-queue', title: '', collapsible: true, closable: true, resizable: true, width: 450, gear: { tip: 'Task queue settings', items: () => {
      const PS = window.__ccPluginSettings, get = (k, d) => { try { const v = PS.get(k); return v === undefined ? d : v; } catch (e) { return d; } }, flip = (k, d) => () => { try { PS.set(k, !get(k, d)); } catch (e) { /* settings not there */ } setTimeout(() => refreshAll(true), 0); };
      return [{ head: 'Task queue' },
        { label: 'Show walking time on the cards', checked: () => !!get('queueWalkEnabled', true), onClick: flip('queueWalkEnabled', true), keepOpen: true },
        { label: 'Relative walking bars', checked: () => !!get('queueWalkRelative', false), onClick: flip('queueWalkRelative', false), keepOpen: true },
        ...SWITCHES.map(([k, label]) => ({ label, checked: () => !!get(k, true), onClick: flip(k, true), keepOpen: true })),
        { sep: true }, { head: 'Route Advisor badge sits on' },
        { label: 'The game\u2019s Tasks panel', checked: () => get('routeAttach', 'original') !== 'bar', onClick: () => { try { PS.set('routeAttach', 'original'); } catch (e) { /* ignore */ } } },
        { label: 'The info bar Tasks button', checked: () => get('routeAttach', 'original') === 'bar', onClick: () => { try { PS.set('routeAttach', 'bar'); } catch (e) { /* ignore */ } } }];
    } } });
    // the title bar's right-click menu gets the same switch as the cogwheel
    try { unregPM = window.__ccPanelMenu && window.__ccPanelMenu.add((id) => (id === 'cc-queue' ? SWITCHES.map(([k, label]) => ({ label, checked: setting(k, true), onClick: () => { try { window.__ccPluginSettings.set(k, !setting(k, true)); } catch (e) { /* not saved */ } setTimeout(() => refreshAll(true), 0); } })) : [])); } catch (e) { /* ui-scale menu hook not there */ }
    P.el.setAttribute('aria-label', 'Task queue'); P.el.style.minWidth = '90px'; P.el.style.minHeight = '60px'; P.el.dataset.ccMin = '90,60';
    P.titleEl.className = 'cc-q-title0'; P.titleEl.textContent = ''; P.titleEl.appendChild(el('span', 'cc-q-h', 'Task queue')); P.titleEl.appendChild(el('span', 'cc-q-sum'));
    keptRoot = makeRoot('kept'); P.body.appendChild(keptRoot);
    try { let rf = 0; ro = new ResizeObserver(() => { if (rf) return; rf = requestAnimationFrame(() => { rf = 0; setWidth(keptRoot, P.el.clientWidth); }); }); ro.observe(P.el); } catch (e) { /* no observer */ }
    P.onOpenChange((v) => { if (v) { render(keptRoot); applyHl(keptRoot); const sb = P.titleEl.querySelector('.cc-q-sum'); if (sb && keptRoot._sum) fillSum(sb, keptRoot._sum); } else { closeTray(true); hideTip3(); closeOdds(); } });
    setWidth(keptRoot, P.el.clientWidth || 450);
    // whatever shows or hides the kept panel (its button, its close box, a layout) moves the subscription with it
    try { qVis = new MutationObserver(() => { qSync(); if (P.isShown() && !P.collapsed()) refreshAll(true); }); qVis.observe(P.el, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* no observer */ }
    return P;
  }
  function refreshAll(force) {
    if (P && P.isShown() && !P.collapsed() && !drag && (force || Date.now() >= renderHold)) {
      const ed = E(); P.el.style.maxHeight = Math.max(320, window.innerHeight - (ed.top || 0) - (ed.bottom || 0) - 36) + 'px';
      render(keptRoot); P.setChip(keptRoot._chip || ''); const sb = P.titleEl.querySelector('.cc-q-sum'); if (sb && keptRoot._sum) fillSum(sb, keptRoot._sum);
    }
    if (hoverRoot && hoverRoot.isConnected && !drag && (force || Date.now() >= renderHold)) render(hoverRoot);
  }
  function toggle() {
    ensurePanel();
    if (P.isShown()) { closeTray(true); hideTip3(); P.setOpen(false); return false; }
    P.setOpen(true); P.setCollapsed(false); render(keptRoot); refreshAll(true); return true;   // opening it from the button shows the whole queue, not a collapsed chip
  }
  // the hover card (mounted by the info bar into its card)
  function mountHover(host) {
    hoverRoot = makeRoot('hover'); setWidth(hoverRoot, 450); host.appendChild(hoverRoot);
    const ed = E(); hoverRoot.style.setProperty('--cc-q-maxh', Math.max(320, window.innerHeight - (ed.top || 0) - (ed.bottom || 0) - 90) + 'px');
    render(hoverRoot); if (typeof qSync === 'function') qSync(); return hoverRoot;
  }
  function unmountHover() { closeTray(true); hideTip3(); if (hoverRoot) hoverRoot.remove(); hoverRoot = null; if (typeof qSync === 'function') qSync(); }
  // a potion starting or ending changes every walking time: redraw at once (the subscription survives a bridge re-attach, so one is enough)
  let offSpeed = null;
  const watchSpeed = () => { if (offSpeed) return; const b = bridge(); if (b && b.onChange) offSpeed = b.onChange('speed', () => { try { refreshAll(true); } catch (e) { /* keep going */ } }); };
  // The queue redraws when the layer says its data changed (a poll of the game's queue data, once a second, only while the panel or the hover card is on screen)
  // and every 250 ms for a few seconds after a click that was handed to the game.
  let qOff = null, qVis = null;
  function qSync() {
    const S = SYNC(), want = !!((P && P.isShown()) || (hoverRoot && hoverRoot.isConnected));
    if (S && !S.has('queue')) defQ(S);   // (the layer was re-injected: its sources are gone)
    if (want && !qOff && S) { watchSpeed(); qOff = S.watch('queue', () => { try { watchSpeed(); refreshAll(false); } catch (e) { /* keep going */ } return true; }); }
    else if (!want && qOff) { try { qOff(); } catch (e) { /* gone */ } qOff = null; }
  }
  const defQ = (S0) => S0.define('queue', { poll: { ms: 1000 }, fresh: () => { const b = bridge(); if (!b || !b.refreshQueuePanel) return false; return b.refreshQueuePanel(); } });
  { const S0 = SYNC(); if (S0) defQ(S0); }
  watchSpeed();

  function teardown() {
    unraise(); try { unregPM && unregPM(); } catch (e) { /* gone */ }
    closeLd(); try { if (qOff) qOff(); if (qVis) qVis.disconnect(); } catch (e) { /* gone */ } qOff = null; if (offSpeed) offSpeed(); clearTimeout(openT); clearTimeout(closeT); clearTimeout(popT); closeTray(true); hideTip3(); mapPreview(null);
    try { if (ro) ro.disconnect(); if (P) P.destroy(); } catch (e) { /* gone */ }
    clearTimeout(od && od.t); if (od) od.host.remove(); if (tray && tray._host) tray._host.remove(); if (hoverRoot) hoverRoot.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc queue torn down';
  }
  window[NS] = { version: 1, teardown, toggle, isOpen: () => !!(P && P.isShown()), isCollapsed: () => !!(P && P.collapsed()), panelEl: () => (P && P.isShown() ? P.el : null),
    highlight, mountHover, unmountHover, hoverEl: () => (hoverRoot && hoverRoot.isConnected ? hoverRoot : null), trayHover: () => !!(tray && tray._host && tray._host.matches(':hover')),
    selectOption, reorderSlot, moveInsert, refresh: refreshAll, model };
  try { if (UI.store.get('panel:cc-queue', {}).open) { ensurePanel(); P.show(true); render(keptRoot); } } catch (e) { /* kit not there */ }
  qSync();
  return 'cc queue loaded';
})();
