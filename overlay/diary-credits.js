// ScapeLite Diary and Credits. Display only: where to spend the diary's free node-lever pips, and how your locations rate.
//  * Location quality: per skill, every location with its walking distance to the nearest bank, how often it is rolled and how often you did it (last 200 tasks), its lever,
//    the free pips there and the move that saves the most walking.
//  * Free pips: where unused free pips sit and the best places to put them, across all skills.
//  * Banks and Credits: reference data (diary progress, the three credit pools).
// The diary fills up by itself while you play; nothing here asks you to chase it. A node lever changes how often a location is rolled, so it changes walking,
// not the XP rate directly. Phase 1 of the Universal Advisor (docs/UNIVERSAL-ADVISOR.md). The arithmetic lives in diary-credits-core.js (tested offline).
// Opens from the ScapeLite menu. Nothing is changed in the game.
(function () {
  'use strict';
  const NS = '__ccDiaryCredits';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('diaryCreditsEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.diaryState ? b : null; };
  const core = () => window.__ccDiaryCore || null;
  const UI = window.__ccUI;
  if (!UI) return 'cc diary-credits: UI kit not loaded';

  const P = UI.panel({ id: 'cc-diary-credits', title: 'Locations and Free Pips', width: 560, height: 'min(660px,80vh)', closable: true, collapsible: true, resizable: true, onClose: () => setOpen(false) });
  const el = P.el;
  let open = false, tab = 'loc', skill = '', model = null;
  { const sv0 = UI.store.get('panel:cc-diary-credits', null); if (sv0 && sv0.open !== undefined) open = !!sv0.open; else P.setOpen(false); }
  function setOpen(v) { open = !!v; P.setOpen(open); render(); }

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const n0 = (n) => Math.round(n).toLocaleString('en-US');
  const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const f1 = (n) => (n < 0.1 ? n.toFixed(2) : n.toFixed(1));
  const TABS = [['loc', 'Location quality'], ['free', 'Free pips'], ['banks', 'Banks'], ['credits', 'Credits']];
  const QTONE = { good: 'good', ok: 'dim', bad: 'bad' };

  function summary(bd, m) {
    const stats = h('div', 'cc-stats');
    const stat = (v, l, tone) => { const s = h('div', 'cc-stat'); if (tone) s.dataset.tone = tone; s.appendChild(h('b', null, v)); s.appendChild(h('span', null, l)); stats.appendChild(s); };
    const L = m.loc;
    stat(n0(m.pips.freeUnused), 'free pips unused', m.pips.freeUnused ? 'accent' : null);
    stat(L ? f1(L.totals.freeSaved) + ' s' : '–', 'walking saved per task if you place them', L && L.totals.freeSaved > 0 ? 'good' : null);
    stat(n0(m.pips.saved), 'credits the diary has saved you');
    bd.appendChild(stats);
  }

  // ---- Location quality
  function viewLoc(bd, m) {
    const L = m.loc;
    if (!L || !L.skills.length) { bd.appendChild(h('div', 'cc-hint', 'No location data yet: the game has not shown its lever window data, or you have no open tasks. It fills in after a few seconds.')); return; }
    bd.appendChild(h('div', 'cc-hint', 'Every time a location comes up you walk from the node to its bank area and back. This table rates each location by that distance (good = under ' + L.goodSec + ' s of walking, bad = over ' + L.badSec + ' s, at your real speed), how often it is rolled, and what a node lever move would do. The diary fills up by itself while you play: you do not need to chase it, just place the free pips it gives.'));
    if (!skill || !L.skills.some((s) => s.skill === skill)) skill = L.skills[0].skill;
    const chips = h('div', 'cc-chips');
    L.skills.forEach((s) => {
      const c = h('button', 'cc-chip' + (s.skill === skill ? ' on' : ''), cap(s.skill)); c.type = 'button'; c.setAttribute('aria-pressed', s.skill === skill ? 'true' : 'false');
      const g = s.free.savedAll + s.paid.savedAll; if (g > 0.05) c.appendChild(h('span', 'n', f1(g) + ' s'));
      c.title = cap(s.skill) + ': ' + s.counts.good + ' good, ' + s.counts.ok + ' middling, ' + s.counts.bad + ' bad locations';
      c.addEventListener('click', () => { skill = s.skill; render(); }); chips.appendChild(c);
    });
    bd.appendChild(chips);
    const S = L.skills.find((s) => s.skill === skill);
    const line = (t) => bd.appendChild(h('div', 'cc-hint', t));
    line(cap(S.skill) + ' is ' + S.pct.toFixed(1) + '% of your rolls. On average a ' + S.skill + ' task is ' + n0(S.taskD) + ' steps (' + Math.round(S.taskSec) + ' s) from its bank' + (S.observedD != null ? '; the ' + S.observedN + ' you did in the last 200 averaged ' + n0(S.observedD) + ' steps (' + Math.round(S.observedD / L.sps) + ' s)' + (S.observedD < S.taskD ? ', so you already pick nearer ones than the roll offers' : '') : '') + '.');
    line(S.free.moves.length ? 'Free plan: ' + S.free.moves.length + ' lever move' + (S.free.moves.length > 1 ? 's' : '') + ' using ' + S.free.pips + ' of the ' + S.freePips + ' free pips here: about ' + f1(S.free.saved) + ' s less walking per ' + S.skill + ' task (' + f1(S.free.savedAll) + ' s per task overall). It changes where tasks are rolled, so it saves walking, not XP rate directly, and only for tasks rolled from now on.' : 'No free move saves enough walking here.');
    if (S.paid.moves.length) line('With credits: ' + S.paid.moves.length + ' more move' + (S.paid.moves.length > 1 ? 's' : '') + ' for ' + n0(S.paid.cost) + ' of your ' + n0(S.credits) + ' ' + S.skill + ' credits would save another ' + f1(S.paid.saved) + ' s per ' + S.skill + ' task.');
    else line('A pip beyond the free ones costs 5, 10, 20 ... credits (' + n0(S.credits) + ' ' + S.skill + ' credits now); none of them buys enough walking to be worth it.');

    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr');
    [['Location', 0], ['To bank', 1], ['Rated', 0], ['Rolled', 1], ['Done', 1], ['Lever', 1], ['Free', 1], ['Move', 0]].forEach(([t, num]) => hr.appendChild(h('th', num ? 'num' : null, t)));
    hd.appendChild(hr); tb.appendChild(hd);
    const body = h('tbody');
    S.rows.forEach((r) => {
      const tr = h('tr'); if (r.target) tr.style.fontWeight = '600';
      tr.appendChild(h('td', null, r.name));
      const d = h('td', 'num', n0(r.d) + ' · ' + Math.round(r.sec) + ' s'); d.title = n0(r.d) + ' steps to ' + r.bank.replace(/_bank$/, '') + ', ' + Math.round(r.sec) + ' s at your speed'; tr.appendChild(d);
      const q = h('td', null, r.quality); q.dataset.tone = QTONE[r.quality]; tr.appendChild(q);
      tr.appendChild(h('td', 'num', r.shareSk.toFixed(1) + '%'));
      tr.appendChild(h('td', 'num', r.used ? String(r.used) : '–'));
      tr.appendChild(h('td', 'num', r.lever ? sgn(r.lever) : '0'));
      const fr = h('td', 'num', r.freeLeft ? String(r.freeLeft) : '–'); fr.title = 'Free pips left here: the ' + r.bank.replace(/_bank$/, '') + ' diary is tier ' + r.tier; tr.appendChild(fr);
      const mv = h('td', null, r.target ? '→ ' + sgn(r.target.to) + ' · ' + (r.target.kind === 'free' ? 'free' : n0(r.target.cost) + ' cr') + ' · ' + f1(r.target.saved) + ' s' : '');
      if (r.target) mv.title = 'Set this node lever to ' + sgn(r.target.to) + ': about ' + f1(r.target.saved) + ' s less walking per ' + S.skill + ' task'; tr.appendChild(mv);
      body.appendChild(tr);
    });
    tb.appendChild(body); bd.appendChild(tb);
    bd.appendChild(h('div', 'cc-hint', 'Rolled = the chance a ' + S.skill + ' task is rolled at that location with your levers now (1.25 per pip, among the places that offer the same activity). Done = tasks there among your last 200. Move = the lever position to set (Skills Customization > the skill > its locations), whether it is free or costs credits, and the walking it saves per ' + S.skill + ' task. The saving counts half of the straight difference in distance: legs inside one bank area do not pass the bank, and you already choose nearer ones.'));
  }

  // ---- Free pips
  function viewFree(bd, m) {
    const L = m.loc;
    bd.appendChild(h('div', 'cc-sec', 'Where the free pips sit'));
    const kv = h('dl', 'cc-kv');
    const add = (k, v, tip) => { const dt = h('dt', null, k), dd = h('dd', null, v); if (tip) { dt.title = tip; dd.title = tip; } kv.append(dt, dd); };
    add('Free pips unused', n0(m.pips.freeUnused), 'Pips the diary gives for free that no node lever uses yet');
    add('Saved so far', n0(m.pips.saved) + ' credits', 'What the pips on your levers that the diary pays for would have cost');
    if (L) { add('Worth placing', n0(L.totals.freePips) + ' pips, ' + f1(L.totals.freeSaved) + ' s per task', 'Free pips where a move saves walking (all skills), and the walking they save per average task'); }
    bd.appendChild(kv);
    if (!L) return;
    bd.appendChild(h('div', 'cc-sec', 'Best places to put them'));
    const all = [];
    L.skills.forEach((s) => s.free.moves.forEach((mv) => { const r = s.rows.find((x) => x.node === mv.node); all.push({ s, mv, r, g: mv.saved * s.pct / 100 }); }));
    all.sort((a, b) => b.g - a.g);
    if (!all.length) bd.appendChild(h('div', 'cc-hint', 'No free move saves enough walking.'));
    all.slice(0, 15).forEach((e) => {
      const row = h('div', 'cc-row nolf'); row.dataset.tone = 'good';
      const top = h('div', 'ti', cap(e.s.skill) + ': ' + e.r.name); top.appendChild(h('i', null, sgn(e.mv.from) + ' → ' + sgn(e.mv.to))); row.appendChild(top);
      row.appendChild(h('div', 'su', n0(e.r.d) + ' steps (' + Math.round(e.r.sec) + ' s) from its bank, rated ' + e.r.quality + ' · free, the ' + e.r.bank.replace(/_bank$/, '') + ' diary is tier ' + e.r.tier + ' · saves ' + f1(e.mv.saved) + ' s per ' + e.s.skill + ' task'));
      bd.appendChild(row);
    });
    bd.appendChild(h('div', 'cc-hint', 'Each move is one pip: a bad location goes down (negative), a good one up (positive). Several moves on one location add up (shown as the last position). Open Skills Customization and set the lever yourself: nothing is pressed for you.'));
    bd.appendChild(h('div', 'cc-sec', 'Per skill'));
    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr');
    ['Skill', 'Free pips', 'Placed by plan', 'Saves / task'].forEach((t, i) => hr.appendChild(h('th', i ? 'num' : null, t))); hd.appendChild(hr); tb.appendChild(hd);
    const body = h('tbody');
    L.skills.forEach((s) => { const tr = h('tr'); tr.appendChild(h('td', null, cap(s.skill))); [n0(s.freePips), n0(s.free.pips), f1(s.free.saved) + ' s'].forEach((v) => tr.appendChild(h('td', 'num', v))); body.appendChild(tr); });
    tb.appendChild(body); bd.appendChild(tb);
  }

  // ---- Banks (reference)
  function viewBanks(bd, m) {
    bd.appendChild(h('div', 'cc-sec', 'All diaries (they fill up while you play)'));
    const rows = m.banks.slice().sort((a, c) => (c.pct - a.pct));
    rows.forEach((b) => {
      const r = h('div', 'cc-row nolf'); r.dataset.tone = b.nextTier ? 'dim' : 'good';
      const top = h('div', 'ti', b.name); top.appendChild(h('i', null, 'tier ' + b.tier)); r.appendChild(top);
      r.appendChild(h('div', 'su', b.completed + ' / ' + b.total + (b.nextTier ? ' · ' + b.need + ' to tier ' + b.nextTier : ' · complete') + ' · ' + b.freeUnused + ' free pip' + (b.freeUnused === 1 ? '' : 's') + ' unused' + (b.used ? ' · ' + b.used + ' lever' + (b.used > 1 ? 's' : '') + ' of yours' : '')));
      const bar = h('span', 'pr'), pg = h('span', 'cc-prog thin'), i = h('i'); pg.style.setProperty('--p', Math.round(b.pct * 100) + '%'); pg.appendChild(i); bar.appendChild(pg); r.appendChild(bar);
      bd.appendChild(r);
    });
    bd.appendChild(h('div', 'cc-hint', 'Passive: you do not need to chase the diary. Each tier only gives one more free pip at every location next to that bank.'));
  }

  // ---- Credits (reference)
  function viewCredits(bd, m) {
    const c = m.credits;
    bd.appendChild(h('div', 'cc-sec', 'Your credit pools'));
    const kv = h('dl', 'cc-kv');
    const add = (k, v, tip) => { const dt = h('dt', null, k), dd = h('dd', null, v); if (tip) { dt.title = tip; dd.title = tip; } kv.append(dt, dd); };
    add('Skill levers (total)', n0(c.total), 'Spent on a whole skill’s lever. The first step costs 25, then 50, 100, 200 ...');
    add('Per-skill levers', n0(c.individualTotal), 'Spent on activity and node levers of one skill. The first pip costs 5, then 10, 20, 40, 80');
    add('Queue rerolls', n0(c.reroll), 'Rerolling a task: 5 for a skilling roll, 10 for a slay roll');
    add('Saved by the diary', n0(m.pips.saved), 'What the pips on your levers that the diary gives for free would have cost');
    add('Free pips not used', n0(m.pips.freeUnused), 'Free pips you could still put on node levers at no cost');
    bd.appendChild(kv);
    bd.appendChild(h('div', 'cc-sec', 'Per skill'));
    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr');
    ['Skill', 'Credits', 'Levers', 'Saved', 'Free pips'].forEach((t, i) => hr.appendChild(h('th', i ? 'num' : null, t))); hd.appendChild(hr); tb.appendChild(hd);
    const bodyT = h('tbody');
    c.individual.slice().sort((a, b) => (b.credits - a.credits) || (b.freeUnused - a.freeUnused)).forEach((r) => {
      const tr = h('tr'); tr.appendChild(h('td', null, cap(r.skill)));
      [r.credits, r.levers, r.saved, r.freeUnused].forEach((v) => tr.appendChild(h('td', 'num', n0(v)))); bodyT.appendChild(tr);
    });
    tb.appendChild(bodyT); bd.appendChild(tb);
    bd.appendChild(h('div', 'cc-hint', 'Credits is what you can spend now (5 buys a first pip). Levers is how many node levers you use. Free pips are the diary’s pips you have not put anywhere yet.'));
  }

  function render() {
    const b = bridge(), C = core();
    if (!on() || !open || !b || !C) { el.classList.remove('show'); return; }
    let m = null; try { const st = b.diaryState(); m = st && C.build(st); } catch (e) { m = null; }
    if (!m) { el.classList.remove('show'); return; }
    model = m;
    el.classList.add('show');
    const body = el.querySelector('.bd'), top = body.scrollTop;
    body.textContent = '';
    summary(body, m);
    const tabs = h('div', 'cc-tabs'); tabs.setAttribute('role', 'tablist');
    TABS.forEach(([k, label]) => { const t = h('button', 'cc-tab', label); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', k === tab ? 'true' : 'false'); t.addEventListener('click', () => { tab = k; render(); }); tabs.appendChild(t); });
    body.appendChild(tabs);
    if (tab === 'loc') viewLoc(body, m); else if (tab === 'free') viewFree(body, m); else if (tab === 'banks') viewBanks(body, m); else viewCredits(body, m);
    P.setChip(m.loc ? n0(m.pips.freeUnused) + ' free pips · ' + f1(m.loc.totals.freeSaved) + ' s' : n0(m.pips.freeUnused) + ' free pips');
    body.scrollTop = top;
  }
  const timer = setInterval(() => { try { if (open && !(document.hidden || window.__ccEcoOn)) render(); } catch (e) { /* keep ticking */ } }, 6000);
  function teardown() {
    clearInterval(timer);
    P.destroy();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc diary-credits torn down';
  }
  window[NS] = { version: 2, teardown, render, get isOpen() { return open; }, toggle() { setOpen(!open); }, open() { setOpen(true); }, setTab(k) { tab = k; render(); }, setSkill(s) { skill = s; render(); }, get model() { return model; } };
  render();
  return 'cc diary-credits loaded';
})();
