// Scapewatch Goal Planner. DISPLAY-ONLY advisor: ranks what to do next for the
// most progress per hour, from (a) static game data compiled by the watcher
// (window.__CC_GOAL_DATA: quests, mob rare drops, raid rewards, item effects)
// and (b) your live state via the game bridge (levels, owned unlocks, quests,
// raid stats, kill times) and the XP tracker (your real XP/hr).
//
// Value model (everything is converted to "XP/hr advantage"):
//   base      = your XP/hr (tracker; falls back to a default)
//   Quests    = reward XP + 4k per unlock reward, over (walking + step time)
//   Levels    = quests an upcoming level threshold would unlock, over the time
//               to level (at that skill's XP/hr)
//   Unlocks   = permanent gains over a planning horizon H (setting, default 40 h):
//               tools cut action time by their seconds / ~8.5 s, scaled by how
//               much of your XP comes from that skill; drops are mob rare drops
//               "1 in N per kill" priced with the game's own kill time, minus
//               what the grind costs you versus your base XP/hr
//   Raids     = readiness + reward odds ("1 in N runs for a rare"); priced coarsely
// Heuristics are labelled as estimates in the UI. Nothing here clicks anything.
(function () {
  'use strict';
  const NS = '__ccGoalPlanner';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const DATA = window.__CC_GOAL_DATA;
  if (!DATA) { console.warn('[cc] goal-planner: no data baked in'); return 'cc goal-planner: no data'; }

  const get = (k) => { try { const s = window.__ccPluginSettings; return s && s.get ? s.get(k) : undefined; } catch (e) { return undefined; } };
  const num = (k, d) => { const v = Number(get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const fmtH = (h) => h < 1 / 6 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(h < 10 ? 1 : 0) + ' h' : (h / 24).toFixed(1) + ' days';
  const skillName = (id) => id === 'all_skills' ? 'all skills' : ((DATA.skills.find((s) => s.id === id) || {}).name || cap(id));
  const itemName = (id) => (DATA.items[id] || {}).n || id;

  // ---------------------------------------------------------------- engine ----
  let xpTable = null;
  fetch('https://play.scapewatch.com/shared/data/xp-table.json').then((r) => r.json()).then((d) => { xpTable = d.xpForLevel || null; }).catch(() => {});
  const xpFor = (lvl) => (xpTable && xpTable[lvl] != null ? xpTable[lvl] : lvl * lvl * 40);

  const killCache = new Map();
  function mobKill(task) {
    if (killCache.has(task)) return killCache.get(task);
    let v = null;
    try { v = window.__ccBridge && window.__ccBridge.mobKill ? window.__ccBridge.mobKill(task) : null; } catch (e) {}
    killCache.set(task, v);
    return v;
  }

  function compute() {
    killCache.clear();
    const br = window.__ccBridge;
    const st = br && br.goalState ? br.goalState() : null;
    if (!st) return { error: 'The game bridge is not attached yet (it attaches a few seconds after the game loads).' };
    const rates = (window.__ccXpTracker && window.__ccXpTracker.rates) || {};
    const rateSum = Object.values(rates).reduce((a, b) => a + b, 0);
    const base = Math.max(rateSum, 4000) || 6000;
    const H = num('goalHorizonHours', 40);
    let speed = 15;
    try { if (window.__ccWalkingCountdown && window.__ccWalkingCountdown.totalSpeed) speed = window.__ccWalkingCountdown.totalSpeed; } catch (e) {}
    const lvl = (s) => (st.skills[s] ? st.skills[s].level : 1);
    const xp = (s) => (st.skills[s] ? st.skills[s].xp : 0);
    const done = new Set(st.questsDone || []);
    const skillRate = (s) => Math.max(rates[s] || 0, base * 0.2);
    const hoursToLevel = (s, target) => Math.max(0, (xpFor(target) - xp(s)) / skillRate(s));

    // ---- quests ----
    const quests = [];
    DATA.quests.forEach((q) => {
      if (done.has(q.id)) return;
      const active = st.questsActive[q.id];
      const step = active != null ? active : 0;
      const missL = Object.entries(q.reqL).filter(([s, l]) => lvl(s) < l).map(([s, l]) => ({ skill: s, have: lvl(s), need: l }));
      const missQ = q.reqQ.filter((id) => !done.has(id));
      let dist = 0, kills = 0;
      for (let i = step; i < q.steps.length; i++) { dist += q.legs[i] || 0; if (q.steps[i].ty === 'kill') kills++; }
      const walkH = (dist / speed + (q.steps.length - step) * 20 + kills * 90) / 3600;
      const levelH = missL.reduce((a, m) => a + hoursToLevel(m.skill, m.need), 0);
      const value = q.xpTotal + q.unlocks.length * 4000;
      const hours = walkH + levelH;
      const ready = !missL.length && !missQ.length;
      quests.push({
        kind: 'quest', id: 'q:' + q.id, title: q.name, ready, hours, walkH, levelH, value, adv: hours > 0 ? value / hours - base : 0,
        locked: missQ.length > 0, step, total: q.steps.length, missL, missQ, xp: q.xp, unlocks: q.unlocks, q,
      });
    });

    // ---- level goals (next level that unlocks quests) ----
    const levels = [];
    DATA.skills.forEach((s) => {
      const have = lvl(s.id);
      const gate = quests.filter((q) => !q.locked && q.q.reqL[s.id] > have);
      if (!gate.length) return;
      const next = Math.min.apply(null, gate.map((q) => q.q.reqL[s.id]));
      const opened = gate.filter((q) => q.q.reqL[s.id] === next && q.missL.every((m) => m.skill === s.id));
      if (!opened.length) return;
      const value = opened.reduce((a, q) => a + q.value, 0);
      const hours = hoursToLevel(s.id, next);
      if (hours < 0.02) return;
      levels.push({ kind: 'level', id: 'l:' + s.id + next, title: 'Reach ' + skillName(s.id) + ' ' + next, hours, value, adv: value / hours - base, skill: s.id, have, next, opened });
    });

    // ---- unlock drops from slay mobs ----
    const bestBy = new Map();
    DATA.drops.forEach((d) => {
      if (st.owned[d.item]) return;
      const it = DATA.items[d.item] || {};
      const ok = lvl('slay') >= d.slay;
      const mk = mobKill(d.task);
      if (!mk) return;
      const hours = d.oneIn * mk.sec / 3600;
      const grind = mk.xp / mk.sec * 3600;
      let gain = 0, why = '';
      if (it.u === 'tool' && it.sec) {
        const frac = it.sec / 8.5;
        const share = it.s === 'all_skills' ? 1 : Math.min(1, (rates[it.s] || 0) / Math.max(rateSum, 1) || 0.05);
        gain = base * frac * share;
        why = '−' + it.sec + 's per action' + (it.s === 'all_skills' ? ' on every skill' : ' on ' + skillName(it.s)) + ' ≈ +' + (frac * share * 100).toFixed(1) + '% XP/hr';
      } else if (it.t === 'equipment') {
        gain = base * 0.02;
        why = 'Gear (' + (it.slot || '?') + (typeof it.tier === 'number' ? ', T' + (it.tier + 1) : '') + (it.pow ? ', power ' + it.pow : '') + ') – value depends on what you wear now';
      } else {
        gain = base * 0.015;
        why = cap((it.u || 'unlock').replace(/_/g, ' ')) + ' unlock';
      }
      const opp = hours * Math.max(0, base - grind);
      const net = gain * H - opp;
      const rec = {
        kind: it.t === 'equipment' ? 'gear' : 'unlock', id: 'd:' + d.item + ':' + d.task, title: itemName(d.item), hours, value: gain * H, gain, ok, req: d.slay,
        adv: net / Math.max(hours, 0.25), mob: d.mob, task: d.task, oneIn: d.oneIn, why, grindHr: grind, breakEven: gain > 0 ? opp / gain : 0, item: d.item, it, kills: d.oneIn,
      };
      const prev = bestBy.get(d.item);
      if (!prev || rec.hours < prev.hours) bestBy.set(d.item, rec);
    });
    const unlocks = [...bestBy.values()];

    // ---- raids / fortress ----
    const slay = lvl('slay'), delve = lvl('delve');
    const raids = DATA.raids.map((r) => {
      const s = st.raidStats[r.id] || {};
      const ready = slay >= r.slay && delve >= r.delve;
      const runMin = s.bestMs ? Math.max(5, s.bestMs / 60000 * 1.3) : 12;
      const missing = r.rare.filter((x) => !st.owned[x.item]);
      const hoursAny = r.runOneIn ? r.runOneIn * runMin / 60 : null;
      const hoursSpecific = r.runOneIn && r.rare.length ? r.runOneIn * r.rare.length * runMin / 60 : null;
      const ms = r.milestone.map((m) => ({ item: m.item, kind: m.kind, thr: m.thr, have: m.kind === 'kc' ? (s.kc || 0) : null, owned: !!st.owned[m.item] }));
      const gain = base * 0.015 * Math.min(missing.length, 3);
      const net = hoursAny ? (gain * H - hoursAny * base * 0.4) / Math.max(hoursAny, 0.25) : 0;
      return { kind: 'raid', id: 'r:' + r.id, title: r.name, ready, r, kc: s.kc || 0, runMin, missing, hoursAny, hoursSpecific, ms, adv: ready ? net : -1e9, req: { slay: r.slay, delve: r.delve } };
    });

    // ---- top picks: best of each, diversified ----
    const pool = []
      .concat(quests.filter((q) => q.ready).map((q) => Object.assign({}, q)))
      .concat(levels).concat(unlocks.filter((u) => u.ok && u.kind === 'unlock')).concat(raids.filter((r) => r.ready && r.hoursAny));
    pool.sort((a, b) => b.adv - a.adv);
    const caps = { quest: 4, level: 3, unlock: 4, raid: 2 }, used = {}, top = [];
    pool.forEach((p) => { used[p.kind] = used[p.kind] || 0; if (used[p.kind] < (caps[p.kind] || 3) && top.length < 12 && p.adv > -base) { top.push(p); used[p.kind]++; } });
    return { st, base, H, speed, quests, levels, unlocks, raids, top, rateSum };
  }

  // ------------------------------------------------------------------ UI ----
  const PX = [
    '................',
    '..kkkkkkkkkkkk..',
    '.kYYyyyyyyyyook.',
    'kkYyyyyyyyyyyokk',
    'kYkYyyyyyyyyokYk',
    'kYkYyyyyyyyyokYk',
    '.kkkYyyyyyyokk..',
    '...kkYyyyyyokk..',
    '....kkyyyyokk...',
    '.....kkyyokk....',
    '......kkokk.....',
    '.......kyk......',
    '.......kyk......',
    '......kkokk.....',
    '.....kbbbbbk....',
    '.....kkkkkkk....',
  ];
  const PAL = { k: '#2a1a0a', y: '#f4c430', Y: '#ffe68a', o: '#b8760f', b: '#7a5222' };
  function iconUrl() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    PX.forEach((row, yy) => { for (let xx = 0; xx < 16; xx++) { const ch = row[xx]; if (ch && ch !== '.' && PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(xx, yy, 1, 1); } } });
    return c.toDataURL('image/png');
  }
  const ICON = iconUrl();

  const style = document.createElement('style');
  style.id = 'cc-goal-style';
  style.textContent = `
#cc-goal-panel{position:fixed;left:120px;top:70px;width:540px;max-height:84vh;z-index:99985;display:flex;flex-direction:column;background:#0f0f14;
  border:1px solid rgba(255,255,255,.16);border-radius:10px;color:#ddd;overflow:hidden;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.55)}
#cc-goal-panel[hidden]{display:none!important}
#cc-goal-panel .gp-head{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none;flex:none}
#cc-goal-panel .gp-head img{width:22px;height:22px;image-rendering:pixelated}
#cc-goal-panel .gp-ttl{font-weight:700;font-size:14px;color:#fff}
#cc-goal-panel .gp-sp{flex:1}
#cc-goal-panel .gp-meta{font-size:12px;color:#9a9aa6}
#cc-goal-panel button{font:inherit;color:#ddd;background:#22222c;border:1px solid #3a3a48;border-radius:6px;padding:2px 10px;cursor:pointer}
#cc-goal-panel button:hover{border-color:#80808f}
#cc-goal-panel .gp-tabs{display:flex;gap:2px;padding:0 8px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.1);flex:none}
#cc-goal-panel .gp-tab{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:7px 12px;color:#9a9aa6;font-weight:600}
#cc-goal-panel .gp-tab.on{color:#ffd24a;border-bottom-color:#ffd24a}
#cc-goal-panel .gp-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px 12px;scrollbar-width:thin;scrollbar-color:#464658 transparent}
#cc-goal-panel .gp-body::-webkit-scrollbar{width:8px}
#cc-goal-panel .gp-body::-webkit-scrollbar-thumb{background:#3a3a4a;border-radius:8px;border:2px solid #0f0f14}
#cc-goal-panel .gp-note{font-size:12px;color:#8a8a96;margin:0 0 10px}
#cc-goal-panel .gp-h{margin:14px 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
#cc-goal-panel .gp-card{margin:0 0 8px;padding:9px 11px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#13131a}
#cc-goal-panel .gp-card.locked{opacity:.62}
#cc-goal-panel .gp-row{display:flex;align-items:baseline;gap:8px}
#cc-goal-panel .gp-row b{font-size:13.5px;color:#fff}
#cc-goal-panel .gp-chip{font-size:11px;padding:0 7px;border-radius:9px;background:#26262f;color:#aab;white-space:nowrap}
#cc-goal-panel .gp-chip.quest{background:#2a2540;color:#b9a8ff}#cc-goal-panel .gp-chip.level{background:#16332a;color:#6fe3a0}
#cc-goal-panel .gp-chip.unlock{background:#3a2c12;color:#ffc65a}#cc-goal-panel .gp-chip.gear{background:#1d2c3d;color:#7fc2ff}
#cc-goal-panel .gp-chip.raid{background:#3b1c1c;color:#ff9a8a}
#cc-goal-panel .gp-score{margin-left:auto;font-weight:700;color:#6fe27a;white-space:nowrap}
#cc-goal-panel .gp-score.neg{color:#ff9d8f}
#cc-goal-panel .gp-line{color:#b6b6c4;font-size:12.5px;margin-top:3px}
#cc-goal-panel .gp-dim{color:#8a8a96}
#cc-goal-panel .gp-req{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px}
#cc-goal-panel .gp-req .ok{color:#6fe27a}#cc-goal-panel .gp-req .no{color:#ff9d8f}
#cc-goal-panel .gp-ico{width:14px;height:14px;vertical-align:-2px;margin-right:3px;image-rendering:pixelated}
.floating-tab-btn.cc-goal-btn img{image-rendering:pixelated}`;
  const panel = document.createElement('div');
  panel.id = 'cc-goal-panel';
  panel.hidden = true;
  let tab = 'top', result = null, computedAt = 0, openFlag = false;
  try { tab = localStorage.getItem('cc-goal-tab') || 'top'; } catch (e) {}
  const LS_POS = 'cc-goal-pos';

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const skillIco = (s) => { const i = document.createElement('img'); i.className = 'gp-ico'; i.src = '/assets/icons/skills/' + s + '.png'; i.alt = s; i.title = skillName(s); i.addEventListener('error', () => { i.style.display = 'none'; }); return i; };
  function reqSpan(ok, text, skill) { const s = h('span', ok ? 'ok' : 'no'); if (skill) s.appendChild(skillIco(skill)); s.appendChild(document.createTextNode((ok ? '✓ ' : '✗ ') + text)); return s; }

  function card(r, ctx) {
    const c = h('div', 'gp-card' + ((r.locked || r.ok === false || r.ready === false) ? ' locked' : ''));
    const row = h('div', 'gp-row');
    row.appendChild(h('span', 'gp-chip ' + r.kind, { quest: 'QUEST', level: 'LEVEL', unlock: 'UNLOCK', gear: 'GEAR', raid: 'RAID' }[r.kind] || r.kind));
    row.appendChild(h('b', null, r.title));
    if (r.kind !== 'raid') {
      const sc = h('span', 'gp-score' + (r.adv < 0 ? ' neg' : ''), (r.adv >= 0 ? '+' : '−') + fmt(Math.abs(r.adv)) + ' xp/hr');
      sc.title = 'Advantage over your normal XP/hr (' + fmt(ctx.base) + '/hr)';
      row.appendChild(sc);
    }
    c.appendChild(row);
    if (r.kind === 'quest') {
      c.appendChild(h('div', 'gp-line', '⏱ ' + fmtH(r.hours) + (r.levelH > 0.02 ? ' (incl. ' + fmtH(r.levelH) + ' levelling)' : '') + ' · ' + fmt(r.q.xpTotal) + ' xp' +
        Object.keys(r.xp).length ? '' : ''));
      const rw = Object.keys(r.xp).map((k) => cap(k) + ' ' + fmt(r.xp[k])).join(' · ');
      c.appendChild(h('div', 'gp-line', '⏱ ' + fmtH(r.hours) + (r.levelH > 0.02 ? ' (incl. ' + fmtH(r.levelH) + ' levelling)' : '') + ' · ' + (r.step ? 'step ' + r.step + '/' + r.total + ' done · ' : '') + r.total + ' steps'));
      c.firstChild.nextSibling && c.removeChild(c.firstChild.nextSibling); // drop the draft line above
      c.appendChild(h('div', 'gp-line gp-dim', 'Rewards: ' + rw + (r.unlocks.length ? ' · unlocks ' + r.unlocks.map(itemName).join(', ') : '')));
      const q = h('div', 'gp-req');
      r.q.reqL && Object.keys(r.q.reqL).forEach((s) => q.appendChild(reqSpan(ctx.st.skills[s] ? ctx.st.skills[s].level >= r.q.reqL[s] : false, skillName(s) + ' ' + r.q.reqL[s] + ' (have ' + (ctx.st.skills[s] ? ctx.st.skills[s].level : 1) + ')', s)));
      r.q.reqQ.forEach((id) => { const d = (DATA.quests.find((x) => x.id === id) || {}).name || id; q.appendChild(reqSpan((ctx.st.questsDone || []).indexOf(id) >= 0, 'Quest: ' + d)); });
      if (q.childNodes.length) c.appendChild(q); else c.appendChild(h('div', 'gp-req')).appendChild(reqSpan(true, 'No requirements'));
    } else if (r.kind === 'level') {
      c.appendChild(h('div', 'gp-line', '⏱ ~' + fmtH(r.hours) + ' at your ' + skillName(r.skill) + ' pace (' + r.have + ' → ' + r.next + ')'));
      c.appendChild(h('div', 'gp-line gp-dim', 'Opens: ' + r.opened.slice(0, 4).map((q) => q.title).join(', ') + (r.opened.length > 4 ? ' +' + (r.opened.length - 4) : '') + ' · ' + fmt(r.value) + ' xp of rewards'));
    } else if (r.kind === 'unlock' || r.kind === 'gear') {
      c.appendChild(h('div', 'gp-line', '⏱ ~' + fmtH(r.hours) + ' expected (1 in ' + r.oneIn + ' kills of ' + r.mob + ')'));
      c.appendChild(h('div', 'gp-line gp-dim', r.why));
      c.appendChild(h('div', 'gp-line gp-dim', 'Grinding earns ~' + fmt(r.grindHr) + ' xp/hr' + (r.breakEven > 0 ? ' · pays back in ~' + fmtH(r.breakEven) + ' of play' : ' · costs you nothing extra')));
      const q = h('div', 'gp-req');
      q.appendChild(reqSpan(r.ok, 'Slay ' + r.req + ' (have ' + (ctx.st.skills.slay ? ctx.st.skills.slay.level : 1) + ')', 'slay'));
      c.appendChild(q);
    } else if (r.kind === 'raid') {
      const sub = [r.ready ? 'Ready' : 'Not ready', r.kc + ' clears'];
      if (r.hoursAny) sub.push('a rare every ~' + r.r.runOneIn + ' runs (~' + fmtH(r.hoursAny) + ')');
      c.appendChild(h('div', 'gp-line', sub.join(' · ')));
      const q = h('div', 'gp-req');
      q.appendChild(reqSpan(ctx.st.skills.slay && ctx.st.skills.slay.level >= r.req.slay, 'Slay ' + r.req.slay, 'slay'));
      if (r.req.delve) q.appendChild(reqSpan(ctx.st.skills.delve && ctx.st.skills.delve.level >= r.req.delve, 'Delve ' + r.req.delve, 'delve'));
      c.appendChild(q);
      if (r.r.rare.length) c.appendChild(h('div', 'gp-line gp-dim', 'Rares (' + r.missing.length + ' of ' + r.r.rare.length + ' missing): ' + r.missing.slice(0, 5).map((x) => itemName(x.item)).join(', ') + (r.missing.length > 5 ? '…' : '')));
      if (r.ms.length) c.appendChild(h('div', 'gp-line gp-dim', 'Milestones: ' + r.ms.map((m) => itemName(m.item) + (m.owned ? ' ✓' : m.kind === 'kc' ? ' (' + m.have + '/' + m.thr + ' kc)' : ' (clear in under ' + Math.round(m.thr / 1000) + ' s)')).join(' · ')));
    }
    return c;
  }

  function render() {
    if (!document.body) return;
    if (!document.getElementById('cc-goal-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-goal-panel')) document.body.appendChild(panel);
    if (!openFlag) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.textContent = '';
    const head = h('div', 'gp-head');
    const ic = document.createElement('img'); ic.src = ICON; head.appendChild(ic);
    head.appendChild(h('span', 'gp-ttl', 'Goal Planner'));
    if (result && !result.error) head.appendChild(h('span', 'gp-meta', 'your pace ' + fmt(result.base) + ' xp/hr · horizon ' + result.H + ' h'));
    head.appendChild(h('span', 'gp-sp'));
    const rf = h('button', null, 'Refresh'); rf.addEventListener('click', (e) => { e.stopPropagation(); refresh(true); });
    const x = h('button', null, '×'); x.addEventListener('click', (e) => { e.stopPropagation(); openFlag = false; render(); });
    head.appendChild(rf); head.appendChild(x);
    panel.appendChild(head); wireDrag(head);
    const tabs = h('div', 'gp-tabs');
    [['top', 'Top picks'], ['quests', 'Quests'], ['unlocks', 'Unlocks & gear'], ['raids', 'Raids'], ['levels', 'Levels']].forEach(([k, l]) => {
      const b = h('button', 'gp-tab' + (tab === k ? ' on' : ''), l);
      b.addEventListener('click', (e) => { e.stopPropagation(); tab = k; try { localStorage.setItem('cc-goal-tab', k); } catch (er) {} render(); });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    const prev = panel.querySelector('.gp-body');
    const body = h('div', 'gp-body'); panel.appendChild(body);
    if (!result) { body.appendChild(h('div', 'gp-note', 'Calculating…')); return; }
    if (result.error) { body.appendChild(h('div', 'gp-note', result.error)); return; }
    const ctx = result;
    const list = (arr, empty, max) => { if (!arr.length) body.appendChild(h('div', 'gp-note', empty)); arr.slice(0, max || 30).forEach((r) => body.appendChild(card(r, ctx))); };
    if (tab === 'top') {
      body.appendChild(h('div', 'gp-note', 'Best next steps for the most progress per hour of play. Scores are estimates: advantage over your current XP/hr, mixing quest rewards, permanent upgrades and unlock odds.'));
      list(result.top, 'Nothing stands out yet – play a bit so your XP/hr can be measured.');
    } else if (tab === 'quests') {
      const ready = result.quests.filter((q) => q.ready).sort((a, b) => b.adv - a.adv);
      const soon = result.quests.filter((q) => !q.ready && !q.locked).sort((a, b) => b.adv - a.adv);
      body.appendChild(h('div', 'gp-h', 'Available now (' + ready.length + ')')); list(ready, 'No quests available right now.', 12);
      body.appendChild(h('div', 'gp-h', 'After levelling (' + soon.length + ')')); list(soon, '–', 12);
    } else if (tab === 'unlocks') {
      const att = result.unlocks.filter((u) => u.ok).sort((a, b) => b.adv - a.adv);
      const tools = att.filter((u) => u.kind === 'unlock'), gear = att.filter((u) => u.kind === 'gear');
      body.appendChild(h('div', 'gp-h', 'Tools & unlocks you can chase now')); list(tools, 'None available.', 12);
      body.appendChild(h('div', 'gp-h', 'Gear drops you can chase now')); list(gear, 'None available.', 8);
      const locked = result.unlocks.filter((u) => !u.ok).sort((a, b) => a.req - b.req || a.hours - b.hours);
      body.appendChild(h('div', 'gp-h', 'Locked behind Slay level (' + locked.length + ')')); list(locked, '–', 6);
    } else if (tab === 'raids') {
      body.appendChild(h('div', 'gp-note', 'Dungeons and the Fortress: readiness and reward odds. Run time uses your best clear (or 12 min).'));
      list(result.raids.slice().sort((a, b) => (b.ready - a.ready) || (a.r.tier - b.r.tier)), 'No raid data.', 12);
    } else if (tab === 'levels') {
      body.appendChild(h('div', 'gp-note', 'The next level in each skill that opens up quests, with the time to get there at that skill’s pace.'));
      list(result.levels.slice().sort((a, b) => b.adv - a.adv), 'No level thresholds found.', 20);
    }
    restorePos();
  }

  let busy = false;
  function refresh(force) {
    if (busy) return;
    if (!force && result && Date.now() - computedAt < 20000) { render(); return; }
    busy = true;
    setTimeout(() => {
      try { result = compute(); computedAt = Date.now(); } catch (e) { result = { error: 'Planner error: ' + (e && e.message) }; console.warn('[cc] goal-planner', e); }
      busy = false; render();
    }, 20);
  }
  function openPanel() { openFlag = true; render(); refresh(true); }
  function restorePos() { try { const p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); if (p) { panel.style.left = Math.min(innerWidth - 80, Math.max(0, p.x)) + 'px'; panel.style.top = Math.min(innerHeight - 40, Math.max(0, p.y)) + 'px'; } } catch (e) {} }
  function wireDrag(bar) {
    bar.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation();
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const move = (ev) => { panel.style.left = Math.max(80 - r.width, Math.min(innerWidth - 80, r.left + ev.clientX - sx)) + 'px'; panel.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); try { localStorage.setItem(LS_POS, JSON.stringify({ x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) })); } catch (er) {} };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation()));

  // --- sidebar button (left icon strip), cloned from a native button's markup ---
  function ensureButton() {
    const strip = document.querySelector('.floating-tab-strip');
    const enabled = get('goalPlannerEnabled') !== false;
    let btn = document.querySelector('.floating-tab-btn.cc-goal-btn');
    if (!enabled || !strip) { if (btn) btn.remove(); panel.hidden = true; return; }
    if (btn && btn.parentElement === strip) return;
    if (btn) btn.remove();
    const tpl = [...strip.querySelectorAll('.floating-tab-btn')].find((b) => b.querySelector('img'));
    if (!tpl) return;
    btn = tpl.cloneNode(true);
    btn.classList.add('cc-goal-btn');
    btn.setAttribute('data-tab', 'cc-goals');
    btn.classList.remove('active');
    const img = btn.querySelector('img');
    img.src = ICON; img.alt = 'Goal Planner';
    const tip = btn.querySelector('.tab-tooltip');
    if (tip) { tip.textContent = 'Goal Planner'; tip.setAttribute('data-name', 'Goal Planner'); tip.setAttribute('data-tab', 'cc-goals'); }
    const hk = btn.querySelector('.modal-tab-hotkey'); if (hk) hk.remove();
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (openFlag) { openFlag = false; render(); } else openPanel(); });
    strip.appendChild(btn);
  }
  let tickTimer = null;
  function tick() { try { ensureButton(); } catch (e) {} tickTimer = setTimeout(tick, 1500); }
  document.head && document.head.appendChild(style);
  tick();

  function teardown() {
    clearTimeout(tickTimer);
    panel.remove(); style.remove();
    document.querySelectorAll('.cc-goal-btn').forEach((e) => e.remove());
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc goal-planner torn down';
  }
  window[NS] = { version: 1, teardown, open: openPanel, compute, get result() { return result; } };
  console.log('[cc] goal-planner loaded');
  return 'cc goal-planner loaded';
})();
