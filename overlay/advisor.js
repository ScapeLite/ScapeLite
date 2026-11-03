// ScapeLite Advisor. Display only: one place that says what to do next, how, and where. It reads the other ScapeLite advisors (Route Advisor, Lever Advisor, Tree Advisor,
// Goals, Diary and Credits), turns what each says into the same kind of action, and shows the best one as a big card with the rest in tabs. It never presses, selects or
// changes anything in the game; "How" is text. Plan, scoring and the rules: docs/UNIVERSAL-ADVISOR.md. The logic is in advisor-core.js (tested offline).
// Opens from the ScapeLite menu. Nothing is changed in the game.
(function () {
  'use strict';
  const NS = '__ccAdvisor';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('advisorEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const core = () => window.__ccAdvisorCore || null;
  const UI = window.__ccUI;
  if (!UI) return 'cc advisor: UI kit not loaded';

  const P = UI.panel({ id: 'cc-advisor', title: 'Advisor', width: 470, height: 'min(660px,80vh)', closable: true, collapsible: true, resizable: true, onClose: () => setOpen(false) });
  const el = P.el;
  const KEY = 'panel:cc-advisor';
  let open = false, tab = 'now', model = null, prevHero = null, showUncertain = false, heroAt = 0, heroCache = null;
  const expanded = new Set();
  { const sv = UI.store.get(KEY, null); if (sv) { if (sv.open !== undefined) open = !!sv.open; if (sv.showUncertain) showUncertain = true; } else P.setOpen(false); }
  const saveOpts = () => { try { const sv = UI.store.get(KEY, {}) || {}; sv.showUncertain = showUncertain; UI.store.set(KEY, sv); } catch (e) { /* the kit keeps position anyway */ } };
  function setOpen(v) { open = !!v; P.setOpen(open); render(); }

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const SURE_TIP = { A: 'Exact: the game\'s own arithmetic', B: 'Measured: checked against logged play, small error', C: 'Modelled: not calibrated yet, can be well off' };
  const SURE_TONE = { A: 'good', B: 'info', C: 'warn' };
  const TABS = [['now', 'Now'], ['credits', 'Levers and locations'], ['hunts', 'Hunts'], ['build', 'Build'], ['why', 'Why']];
  const LANES_OF = { now: ['now'], credits: ['levers', 'setup'], hunts: ['hunts'], build: ['build'] };
  const OPENS = { route: '__ccRouteAdvisor', location: '__ccDiaryCredits', tree: '__ccTreeAdvisor', hunt: '__ccGoals', goal: '__ccGoals' };

  // ---- reading the other advisors (each in its own try: a missing or broken one just has no input)
  const away = (nodeId) => {
    try {
      const br = window.__ccBridge, d = br && br.remain && br.remain(nodeId); if (d == null) return null;
      const sp = br.speed && br.speed(), sec = sp && sp.time ? sp.time(d) : null;
      return sec == null ? null : sec / 60;
    } catch (e) { return null; }
  };
  function collect() {
    const C = core(), D = window.__ccDiaryCore, br = window.__ccBridge, inp = {};
    try { const st = br && br.diaryState && br.diaryState(); inp.diary = st && D ? D.build(st) : null; } catch (e) { inp.diary = null; }
    try { inp.goals = window.__ccGoals && window.__ccGoals.build ? window.__ccGoals.build() : null; } catch (e) { inp.goals = null; }
    try { const R = window.__ccRouteAdvisor; inp.route = R && R.result ? C.summariseRoute(R.result) : null; } catch (e) { inp.route = null; }
    // the Lever Advisor only works while the Skills Customization window is open; its last answer is stale after that
    try { const L = window.__ccLeverAdvisor, dr = document.getElementById('cc-lever-drawer'); inp.lever = L && L.last && dr && dr.getBoundingClientRect().width > 0 ? C.summariseLever(L.last, L.debug) : null; } catch (e) { inp.lever = null; }
    try { const T = window.__ccTreeAdvisor; inp.tree = T && T.plan ? C.summariseTree(T.plan) : null; } catch (e) { inp.tree = null; }
    return inp;
  }

  const placeLine = (w) => w.name + (w.min != null ? ' (' + (w.min < 1.5 ? '<2' : Math.round(w.min)) + ' min away)' : '');

  function detail(a, host) {
    if (a.how.length) { const ul = h('div', 'su'); a.how.forEach((t) => ul.appendChild(h('div', null, '• ' + t))); host.appendChild(h('div', 'cc-sec', 'How')); host.appendChild(ul); }
    if (a.where.length) { const ul = h('div', 'su'); a.where.slice(0, 4).forEach((w) => ul.appendChild(h('div', null, '• ' + placeLine(w)))); host.appendChild(h('div', 'cc-sec', 'Where')); host.appendChild(ul); }
    if (a.why.length) { const ul = h('div', 'su dim'); a.why.forEach((t) => ul.appendChild(h('div', null, t))); host.appendChild(h('div', 'cc-sec', 'Why')); host.appendChild(ul); }
    const tgt = OPENS[a.kind] && window[OPENS[a.kind]];
    if (tgt && typeof tgt.open === 'function') {
      const b = h('button', 'cc-btn', 'Open its window'); b.type = 'button'; b.title = 'Opens the ScapeLite panel that holds the detail. Nothing happens in the game.';
      b.addEventListener('click', (e) => { e.stopPropagation(); try { tgt.open(); } catch (er) { /* panel not there */ } }); host.appendChild(b);
    }
  }

  function sureChip(a) { const p = h('span', 'cc-pill', 'Sure ' + a.sure); p.dataset.tone = SURE_TONE[a.sure]; p.title = SURE_TIP[a.sure]; return p; }

  function heroCard(a, lane, C) {
    const c = h('div', 'cc-callout big'); c.dataset.tone = a.sure === 'A' ? 'good' : a.sure === 'B' ? 'accent' : 'warn';
    const s = h('span'); s.appendChild(h('b', null, 'Do this next'));
    s.appendChild(h('div', null, a.what));
    const meta = h('div', 'su'); meta.appendChild(document.createTextNode('Gain: ' + (a.gain.text || '–') + ' · Cost: ' + (a.cost.text || '–') + ' · ')); meta.appendChild(sureChip(a)); s.appendChild(meta);
    detail(a, s);
    c.appendChild(s);
    return c;
  }

  function row(a) {
    const r = h('div', 'cc-row nolf'); r.dataset.tone = a.sure === 'A' ? 'good' : a.sure === 'B' ? 'accent' : 'warn'; r.setAttribute('role', 'button'); r.style.cursor = 'pointer'; if (a.pinned) r.dataset.edge = '1';
    r.appendChild(h('div', 'ti', a.what));
    const su = h('div', 'su'); su.appendChild(document.createTextNode((a.gain.text || '') + (a.cost.text ? ' · ' + a.cost.text : '') + ' · ')); su.appendChild(sureChip(a)); r.appendChild(su);
    if (expanded.has(a.id)) detail(a, r);
    r.addEventListener('click', () => { if (expanded.has(a.id)) expanded.delete(a.id); else expanded.add(a.id); render(); });
    r.title = 'Click for how, where and why';
    return r;
  }

  function viewLanes(bd, m, lanes) {
    const C = core(); let any = false;
    lanes.forEach((l) => {
      const list = m.byLane[l]; if (!list || !list.length) return; any = true;
      if (lanes.length > 1) bd.appendChild(h('div', 'cc-sec', C.LANE_NAMES[l]));
      list.forEach((a) => bd.appendChild(row(a)));
    });
    if (!any) bd.appendChild(h('div', 'cc-hint', tab === 'now' ? 'Nothing to change in the queue: the Route Advisor has no better order to show, or it is not running.' : tab === 'credits' ? 'No location lever move saves enough walking right now. Skill and activity lever advice appears here while the Skills Customization window is open.' : tab === 'hunts' ? 'No goals or hunts to show yet: train a skill for a minute, or pin one in Goals.' : 'Your tree builds are already the best the Tree Advisor can find (or it has not been opened yet).'));
  }

  function viewWhy(bd, m, C) {
    bd.appendChild(h('div', 'cc-sec', 'Where the advice comes from'));
    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr'); ['Source', 'Reading', 'Actions'].forEach((t, i) => hr.appendChild(h('th', i ? 'num' : null, t))); hd.appendChild(hr); tb.appendChild(hd);
    const body = h('tbody'); m.sources.forEach((s) => { const tr = h('tr'); tr.appendChild(h('td', null, s.name)); tr.appendChild(h('td', 'num', s.has ? 'yes' : 'not available')); tr.appendChild(h('td', 'num', String(s.count))); body.appendChild(tr); }); tb.appendChild(body); bd.appendChild(tb);
    bd.appendChild(h('div', 'cc-sec', 'How sure'));
    const kv = h('dl', 'cc-kv'); ['A', 'B', 'C'].forEach((k) => { kv.appendChild(h('dt', null, 'Sure ' + k)); kv.appendChild(h('dd', null, SURE_TIP[k])); }); bd.appendChild(kv);
    const chips = h('div', 'cc-chips'), ch = h('button', 'cc-chip' + (showUncertain ? ' on' : ''), 'Show uncertain actions (' + m.hiddenUncertain + ' hidden)'); ch.type = 'button'; ch.setAttribute('aria-pressed', showUncertain ? 'true' : 'false');
    ch.addEventListener('click', () => { showUncertain = !showUncertain; saveOpts(); render(); }); chips.appendChild(ch); bd.appendChild(chips);
    bd.appendChild(h('div', 'cc-hint', 'The lanes are ranked on their own, because they do not share a unit: the hero comes from the first lane that has something (Now, then Levers, then Locations and free pips, then Hunts, then Build). Route gains are counted over ' + m.horizonH + ' hours of play (provisional, to be confirmed). Location levers (free diary pips) are ranked by the walking they save per task: they change where tasks are rolled, not the XP rate, and the saving is an estimate (half the straight difference in distance to the bank). The diary itself is passive and never advised. Hunts have no XP value and stay in their own lane.'));
  }

  function render() {
    const C = core();
    if (!on() || !open || !C) { el.classList.remove('show'); return; }
    let m = null;
    try { m = C.build(collect(), { prevHero, showUncertain, walkMin: away }); } catch (e) { m = null; }
    if (!m) { el.classList.remove('show'); return; }
    model = m; prevHero = m.hero ? m.hero.id : null;
    el.classList.add('show');
    const bd = el.querySelector('.bd'), top = bd.scrollTop; bd.textContent = '';
    if (m.hero) bd.appendChild(heroCard(m.hero, m.heroLane, C));
    else bd.appendChild(h('div', 'cc-callout', 'Nothing to change right now. Keep playing: the advisor looks again every few seconds.'));
    const tabs = h('div', 'cc-tabs'); tabs.setAttribute('role', 'tablist');
    TABS.forEach(([k, label]) => {
      const n = k === 'why' ? 0 : LANES_OF[k].reduce((t, l) => t + (m.byLane[l] || []).length, 0);
      const t = h('button', 'cc-tab', label); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', k === tab ? 'true' : 'false');
      if (n) t.appendChild(h('span', 'n', String(n)));
      t.addEventListener('click', () => { tab = k; render(); }); tabs.appendChild(t);
    });
    bd.appendChild(tabs);
    if (tab === 'why') viewWhy(bd, m, C); else viewLanes(bd, m, LANES_OF[tab]);
    P.setChip(m.hero ? m.hero.what.length > 46 ? m.hero.what.slice(0, 44) + '…' : m.hero.what : '');
    bd.scrollTop = top;
  }
  const timer = setInterval(() => { try { if (open && !(document.hidden || window.__ccEcoOn)) render(); } catch (e) { /* keep ticking */ } }, 6000);
  function teardown() {
    clearInterval(timer); P.destroy();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc advisor torn down';
  }
  window[NS] = {
    version: 1, teardown, render, get isOpen() { return open; }, toggle() { setOpen(!open); }, open() { setOpen(true); }, setTab(k) { tab = k; render(); },
    get model() { return model; },
    // for the Info Bar module "Next action": the short text of the best action, or null
    // (cached for 5 s: the Info Bar asks every second)
    hero() {
      try {
        const now = Date.now(); if (heroAt && now - heroAt < 5000) return heroCache;
        const C = core(), m = C && C.build(collect(), { prevHero, showUncertain, walkMin: away });
        heroAt = now; heroCache = m && m.hero ? { id: m.hero.id, text: m.hero.what, lane: m.heroLane, sure: m.hero.sure, gain: m.hero.gain.text } : null; return heroCache;
      } catch (e) { return null; }
    },
  };
  render();
  return 'cc advisor loaded';
})();
