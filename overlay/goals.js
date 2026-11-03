// ScapeLite Goals. Display only: what you are working towards and how long it takes at your real pace.
//  * Skill goals: for every skill you are training (from the XP Tracker's rates) the next level and the next milestone (a multiple of 5,
//    or the cap), with the XP left and the time at your current XP per hour.
//  * Item hunts: unlock drops you do not have yet, from mobs your Slay level lets you fight, with the time one is expected to take
//    ("1 in N kills" times your real kill time). Tools for skills you train come first.
//  * Pins: pin your own skill target or an item to keep it at the top.
// Opens from the ScapeLite menu. Nothing is changed in the game.
(function () {
  'use strict';
  const NS = '__ccGoals';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS_POS = 'cc-goals-pos', LS_OPEN = 'cc-goals-open', LS_PINS = 'cc-goals-pins';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('goalsEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.dropState && b.project ? b : null; };
  let open = false, pins = { skills: [], items: [] }, tbl = null;
  try { open = localStorage.getItem(LS_OPEN) === '1'; const p = JSON.parse(localStorage.getItem(LS_PINS) || 'null'); if (p) pins = { skills: p.skills || [], items: p.items || [] }; } catch (e) {}
  const savePins = () => { try { localStorage.setItem(LS_PINS, JSON.stringify(pins)); } catch (e) {} };
  fetch('https://play.scapewatch.com/shared/data/xp-table.json').then((r) => r.json()).then((d) => { tbl = d.xpForLevel || null; try { render(); } catch (e) {} }).catch(() => {});

  // Chrome (header, drag, memory, scale, layering) comes from the UI kit; only the content styles are kept here.
  const UI = window.__ccUI;
  if (!UI) return 'cc goals: UI kit not loaded';
  const P = UI.panel({ id: 'cc-goals', title: 'Goals', width: 420, height: 'min(560px,74vh)', closable: true, collapsible: true, resizable: true, legacyPosKey: LS_POS, onClose: () => setOpen(false) });
  const el = P.el;
  { const sv0 = UI.store.get('panel:cc-goals', null); if (sv0 && sv0.open !== undefined) open = !!sv0.open; else P.setOpen(open); }   // the kit remembers it now; the old key is read once
  function setOpen(v) { open = !!v; P.setOpen(open); render(); }

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  const dur = (hr) => { if (!isFinite(hr)) return '–'; const m = hr * 60; return m < 1 ? '<1 min' : m < 90 ? Math.round(m) + ' min' : hr < 48 ? hr.toFixed(hr < 10 ? 1 : 0) + ' h' : hr < 24 * 120 ? (hr / 24).toFixed(hr < 240 ? 1 : 0) + ' days' : hr < 24 * 365 * 100 ? (hr / 24 / 365).toFixed(1) + ' years' : 'a very long time'; };
  const xpFor = (l) => (tbl && tbl[l] != null ? tbl[l] : null);
  const maxLvl = () => { if (!tbl) return 99; let m = 1; while (tbl[m + 1] != null) m++; return m; };
  const SLOW_H = 24; // an ETA past this many hours is flagged as a long way off

  // ---- skill goals
  function skillGoal(sk, lvl, xp, target, rate) {
    const need = xpFor(target); if (need == null) return null;
    const left = Math.max(0, need - xp), from = xpFor(lvl) || 0;
    return { sk, target, left, hr: rate > 0 ? left / rate : Infinity, pct: Math.max(0, Math.min(1, (xp - from) / Math.max(1, need - from))), rate };
  }
  function milestone(lvl) { const m = Math.max(maxLvl(), 1); const next = (Math.floor(lvl / 5) + 1) * 5; return Math.min(next, m); }

  function build(b) {
    const proj = b.project(), skills = (proj && proj.skills) || {};
    const rates = (window.__ccXpTracker && window.__ccXpTracker.rates) || {};
    const out = { skillRows: [], pinSkill: [], hunts: [], pinItems: [], haveRates: Object.keys(rates).length > 0 };
    // Skills in training: next level, and the next multiple of 5.
    Object.keys(rates).forEach((sk) => {
      const s = skills[sk]; if (!s) return;
      const nl = Math.min(maxLvl(), s.level + 1), mt = milestone(s.level);
      const g = skillGoal(sk, s.level, s.xp, nl, rates[sk]); if (!g) return;
      g.lvl = s.level; g.next = g; g.mile = mt > nl ? skillGoal(sk, s.level, s.xp, mt, rates[sk]) : null; if (g.mile) g.mile.lvl = s.level;
      out.skillRows.push(g);
    });
    out.skillRows.sort((a, c) => a.hr - c.hr);
    pins.skills.forEach((p, i) => { const s = skills[p.skill]; if (!s) return; const g = skillGoal(p.skill, s.level, s.xp, p.level, rates[p.skill] || 0); if (g) { g.lvl = s.level; g.pin = i; g.done = s.level >= p.level; out.pinSkill.push(g); } });
    // Pets: 1 in 10,000,000 XP in the skill; All-Skills pet 1 in 100,000,000 XP in any skill. Expected time at your real XP per hour.
    const d = b.dropState();
    out.pets = [];
    if (d) {
      const own = {}; d.pets.forEach((p) => { own[p.skill] = (p.normal || 0) + (p.shiny || 0); });
      Object.keys(rates).forEach((sk) => { if (rates[sk] > 0 && !own[sk] && d.pets.some((p) => p.skill === sk)) out.pets.push({ name: cap(sk) + ' pet', hrs: d.petDiv / rates[sk], rate: rates[sk], div: d.petDiv }); });
      const tot = Object.values(rates).reduce((x, y) => x + y, 0);
      if (tot > 0 && !own.allSkills) out.pets.push({ name: 'All-Skills pet', hrs: d.allDiv / tot, rate: tot, div: d.allDiv });
      out.pets.sort((p, q) => p.hrs - q.hrs);
    }
    // Item hunts.
    let mvals = null; try { mvals = b.mobValues(); } catch (e) {}
    const slay = (skills.slay && skills.slay.level) || 1;
    if (d && mvals) {
      d.mobs.forEach((m) => {
        const v = mvals[m.id]; if (!v || !v.sec) return;
        if (v.slayReq && v.slayReq > slay) return;
        m.drops.forEach((x) => {
          if (!x.unlock || x.got) return;
          const hrs = x.n * v.sec / 3600;                       // expected time: 1 in N kills, at your real kill time
          const trained = x.ut === 'tool' && x.us && rates[x.us] > 0;
          out.hunts.push({ m, x, hrs, p1: 1 - Math.pow(1 - 1 / x.n, 3600 / v.sec), trained, score: hrs * (trained ? 0.4 : 1), key: m.id + '|' + x.id });
        });
      });
      out.hunts.sort((p, q) => p.score - q.score);
      const keys = new Set(pins.items.map((p) => p.mob + '|' + p.id));
      out.pinItems = out.hunts.filter((e) => keys.has(e.key));
      out.hunts = out.hunts.filter((e) => !keys.has(e.key));
    }
    return out;
  }

  function skillRow(g, isPin) {
    const r = h('div', 'cc-row nolf'); if (isPin) r.dataset.tone = 'accent';
    const top = h('div', 'ti'); top.appendChild(document.createTextNode(cap(g.sk))); top.appendChild(h('i', null, g.lvl + ' → ' + g.target));
    r.appendChild(top);
    r.appendChild(h('div', 'su', g.done ? 'Reached' : num(g.left) + ' XP left' + (g.rate > 0 ? ' at ' + num(g.rate) + ' XP/hr' : ' · not training right now')));
    const mt = h('div', 'mt'), mb = h('b', null, g.done ? '✔' : dur(g.hr)); mb.dataset.tone = g.done || g.hr <= SLOW_H ? 'good' : 'bad'; mb.style.color = 'var(--t)'; mt.appendChild(mb); r.appendChild(mt);
    const bar = h('span', 'pr'), pg = h('span', 'cc-prog thin'), i = h('i'); pg.style.setProperty('--p', Math.round(g.pct * 100) + '%'); pg.appendChild(i); bar.appendChild(pg); r.appendChild(bar);
    if (isPin) { const x = h('button', 'ac', '×'); x.title = 'Remove this goal'; x.addEventListener('click', () => { pins.skills.splice(g.pin, 1); savePins(); render(); }); r.appendChild(x); }
    return r;
  }
  function huntRow(e, isPin) {
    const r = h('div', 'cc-row nolf'); if (isPin) r.dataset.tone = 'accent';
    const top = h('div', 'ti'); top.appendChild(document.createTextNode(e.x.name)); top.appendChild(h('i', null, '· ' + e.m.name)); r.appendChild(top);
    const kind = e.x.ut === 'tool' ? 'Tool' + (e.x.us ? ' (' + cap(e.x.us) + ')' + (e.trained ? ', you train it' : '') : '') : cap(String(e.x.ut || 'unlock').replace(/_/g, ' '));
    r.appendChild(h('div', 'su', kind + ' · 1 in ' + num(e.x.n) + ' kills · ' + num(e.m.kills) + ' so far · ' + Math.round(e.p1 * 1000) / 10 + '% per hour of killing'));
    { const mt = h('div', 'mt'), mb = h('b', null, dur(e.hrs)); mb.dataset.tone = e.hrs > SLOW_H ? 'bad' : 'good'; mb.style.color = 'var(--t)'; mt.appendChild(mb); r.appendChild(mt); }
    const st = h('button', 'ac', isPin ? '×' : '☆'); st.title = isPin ? 'Unpin' : 'Pin this hunt';
    st.addEventListener('click', () => {
      if (isPin) pins.items = pins.items.filter((p) => !(p.mob === e.m.id && p.id === e.x.id)); else pins.items.push({ mob: e.m.id, id: e.x.id });
      savePins(); render();
    });
    r.appendChild(st);
    return r;
  }

  function render() {
    const b = bridge();
    if (!on() || !open || !b) { el.classList.remove('show'); return; }
    let data; try { data = build(b); } catch (e) { data = null; }
    if (!data) { el.classList.remove('show'); return; }
    el.classList.add('show');
    { const g0 = data.pinSkill[0] || (data.skillRows[0] && data.skillRows[0].next); P.setChip(g0 ? cap(g0.sk) + ' ' + g0.lvl + ' → ' + g0.target + (g0.done ? '' : ' · ' + dur(g0.hr)) : ''); }
    const bd = el.querySelector('.bd'), top = bd.scrollTop, keepAdd = bd.querySelector('.add select') && document.activeElement && bd.contains(document.activeElement);
    if (keepAdd) return; // do not rebuild the form while it is being used
    bd.textContent = '';
    if (data.pinSkill.length || data.pinItems.length) {
      bd.appendChild(h('div', 'cc-sec', 'Pinned'));
      data.pinSkill.forEach((g) => bd.appendChild(skillRow(g, true)));
      data.pinItems.forEach((e) => bd.appendChild(huntRow(e, true)));
    }
    bd.appendChild(h('div', 'cc-sec', 'Skills you are training'));
    if (!data.skillRows.length) bd.appendChild(h('div', 'cc-hint', data.haveRates ? 'Nothing to show yet.' : 'Train a skill for a minute: the goals use your real XP per hour from the XP Tracker.'));
    data.skillRows.slice(0, 6).forEach((g) => {
      bd.appendChild(skillRow(g.next, false));
      if (g.mile) bd.appendChild(skillRow(g.mile, false));
    });
    if (data.pets.length) {
      bd.appendChild(h('div', 'cc-sec', 'Pets (expected time)'));
      data.pets.slice(0, 4).forEach((p) => {
        const r = h('div', 'cc-row nolf'); r.appendChild(h('div', 'ti', p.name)); r.appendChild(h('div', 'su', '1 in ' + num(p.div) + ' XP · at ' + num(p.rate) + ' XP/hr'));
        { const mt = h('div', 'mt'), mb = h('b', null, dur(p.hrs)); mb.dataset.tone = p.hrs > SLOW_H ? 'bad' : 'good'; mb.style.color = 'var(--t)'; mt.appendChild(mb); r.appendChild(mt); } bd.appendChild(r);
      });
    }
    bd.appendChild(h('div', 'cc-sec', 'Item hunts worth a look'));
    data.hunts.slice(0, 8).forEach((e) => bd.appendChild(huntRow(e, false)));
    if (!data.hunts.length) bd.appendChild(h('div', 'cc-hint', 'No unlock drops left on mobs you can fight.'));
    bd.appendChild(h('div', 'cc-hint', 'Hunt times assume you fight only that mob. Tools for skills you train come first.'));
    // add-a-goal form
    bd.appendChild(h('div', 'cc-sec', 'Add a skill goal'));
    const add = h('div', 'cc-chips'), sel = h('select', 'cc-sel'), inp = h('input', 'cc-num'), btn = h('button', 'cc-btn', 'Add'); btn.dataset.v = 'primary';
    Object.keys((b.project().skills) || {}).sort().forEach((sk) => { const o = h('option', null, cap(sk)); o.value = sk; sel.appendChild(o); });
    inp.type = 'number'; inp.min = 2; inp.max = maxLvl(); inp.placeholder = 'Level';
    btn.type = 'button';
    btn.addEventListener('click', () => { const lv = Math.floor(Number(inp.value)); if (sel.value && lv >= 2 && lv <= maxLvl()) { pins.skills.push({ skill: sel.value, level: lv }); savePins(); inp.value = ''; render(); } });
    add.appendChild(sel); add.appendChild(inp); add.appendChild(btn); bd.appendChild(add);
    bd.scrollTop = top;
  }
  const timer = setInterval(() => { try { if (open && !(document.hidden || window.__ccEcoOn)) render(); } catch (e) { /* keep ticking */ } }, 6000);
  function teardown() {
    clearInterval(timer);
    P.destroy();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc goals torn down';
  }
  window[NS] = { version: 1, teardown, render, get isOpen() { return open; }, toggle() { setOpen(!open); }, open() { setOpen(true); }, build: () => { const b = bridge(); return b && build(b); } };
  render();
  return 'cc goals loaded';
})();
