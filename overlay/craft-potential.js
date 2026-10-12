// ScapeLite Crafting Potential. DISPLAY-ONLY: in the Smith / Craft / Imbue / Brew windows the XP bar at the top also shows
// what you COULD reach if you crafted with every material in your bank, using the most XP-efficient recipes first.
//   - Within a level: the part of the bar the extra XP would fill (gold stripes after your current progress).
//   - Whole levels: the bar is filled to the end and a row of level chips shows each level you would gain, the last chip
//     showing how far into the next level you would be ("+3 levels and 40%").
// Recipes come from the game's own constants and your bank from the Game Data Bridge. Nothing is crafted for you.
(function () {
  'use strict';
  const NS = '__ccCraftPot';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('craftPotential') === false); } catch (e) { return true; } };
  const TABS = { 'tab-smith': 'smith', 'tab-craft': 'craft', 'tab-imbue': 'imbue', 'tab-brew': 'brew' };

  let tbl = null, loading = false;
  async function loadTbl() {
    if (tbl || loading) return; loading = true;
    try { tbl = (await (await fetch('https://play.scapewatch.com/shared/data/xp-table.json')).json()).xpForLevel || null; } catch (e) { /* retry next tick */ } finally { loading = false; }
  }
  function levelOf(xp) { let l = 1; while (tbl[l + 1] != null && tbl[l + 1] <= xp) l++; return l; }
  function frac(xp) { const l = levelOf(xp), lo = tbl[l], hi = tbl[l + 1]; return { lvl: l, p: hi != null && hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1, max: hi == null }; }

  // Potions that help every task (movement: Swift / Fleet / Haste, and Potions of Discovery) are crafted before XP-efficient ones.
  const PRIORITY = /^(swift|fleet|haste)_potion|^potion_of_discovery/;
  const prio = (r) => (r.id && PRIORITY.test(r.id) ? 6 : 1);
  // Greedy fractional-knapsack over the recipes of one skill: most XP per material unit first.
  function potentialXp(skill, d) {
    const stock = Object.assign({}, d.held || {});
    let recipes = [];
    if (skill === 'brew') {
      recipes = (d.finishing || []).map((r) => ({ id: r.resultId, tier: r.tier, mats: [[r.unfPotionId, 1], [r.rawId, 1], r.procId ? [r.procId, 1] : null].filter((m) => m && m[0]), xp: r.xp }));
    } else {
      recipes = Object.keys(d.equip || {}).map((k) => d.equip[k]).filter((r) => r && r.skill === skill).map((r) => ({ mats: (r.materials || []).map((m) => [m.itemId, m.qty]), xp: r.xpPerCraft, id: Object.keys(d.equip).find((k) => d.equip[k] === r), tier: null }));
      recipes.forEach((r) => { if (r.id && d.tiers) r.tier = d.tiers[r.id]; });
    }
    // A recipe needs its tier's level in this skill: T0 = 1, T1 = 10, T2 = 20 ... T10 = 99 (the Material Tiers list in the window).
    const lvl = (d.levels && d.levels[skill]) || 99;
    const need = (t) => (t == null ? 1 : t <= 0 ? 1 : Math.min(99, t * 10));
    recipes = recipes.filter((r) => need(r.tier) <= lvl);
    recipes = recipes.filter((r) => r.xp > 0 && r.mats.length).sort((a, b) => prio(b) * b.xp / b.mats.reduce((s, m) => s + m[1], 0) - prio(a) * a.xp / a.mats.reduce((s, m) => s + m[1], 0));
    let total = 0, crafts = 0; const lines = [], byId = {};
    const take = (r, n, coll) => {
      r.mats.forEach(([id, q]) => { stock[id] -= n * q; });
      total += n * r.xp; crafts += n;
      const key = r.id || JSON.stringify(r.mats);
      let ln = byId[key];
      if (!ln) { ln = byId[key] = { id: r.id, n: 0, xpEach: r.xp, xp: 0, mats: {}, coll: false }; lines.push(ln); }
      ln.n += n; ln.xp += n * r.xp; ln.coll = ln.coll || !!coll;
      r.mats.forEach(([id, q]) => { ln.mats[id] = (ln.mats[id] || 0) + q * n; });
    };
    const can = (r) => { let n = Infinity; r.mats.forEach(([id, q]) => { n = Math.min(n, Math.floor((stock[id] || 0) / q)); }); return isFinite(n) ? n : 0; };
    // 1) Anything that is not in your collection log yet comes first: one craft of each logs it.
    if (d.logged) recipes.slice().sort((a, b) => b.xp - a.xp).forEach((r) => { if (r.id && d.logged[r.id] === false && can(r) >= 1) take(r, 1, true); });
    // 2) The rest: most XP per material first.
    for (const r of recipes) {
      const n = can(r);
      if (!(n > 0)) continue;
      take(r, n, false);
    }
    lines.forEach((ln) => { ln.mats = Object.keys(ln.mats).map((k) => [k, ln.mats[k]]); });
    lines.sort((x, y) => (y.coll ? 1 : 0) - (x.coll ? 1 : 0) || y.xp - x.xp);
    return { xp: total, crafts, lines };
  }

  const style = document.createElement('style');
  style.id = 'cc-craftpot-style';
  style.textContent = `
.header-xp-bar{position:relative}
.header-xp-bar .header-xp-bar-label{position:relative;z-index:2;text-shadow:0 0 4px #000,0 0 3px #000}
.cc-pot-fill{z-index:1;position:absolute;top:0;bottom:0;pointer-events:none;border-radius:0 2px 2px 0;background:repeating-linear-gradient(135deg,rgba(255,210,74,.55) 0 7px,rgba(255,160,40,.55) 7px 14px);background-size:20px 20px;animation:ccPotMove 1.4s linear infinite;box-shadow:0 0 8px rgba(255,200,60,.55)}
@keyframes ccPotMove{to{background-position:20px 0}}
.cc-pot-lbl{position:absolute;right:8px;top:50%;transform:translateY(-50%);font:600 12px/1 system-ui,sans-serif;color:#fff1c2;text-shadow:0 0 4px #000,0 0 3px #000;pointer-events:none;white-space:nowrap;z-index:3}
.cc-pot-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 12px 4px;font:12px/1 system-ui,sans-serif;color:#cfd3dc}
.cc-pot-row .hd{color:#ffd24a;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;margin-right:4px}
.cc-pot-chip{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:18px;padding:0 7px;border-radius:9px;background:linear-gradient(180deg,#ffd24a,#e0a82a);color:#2a1a0a;font-weight:700;font-size:11px;box-shadow:0 0 6px rgba(255,200,60,.5)}
.cc-pot-chip.part{position:relative;overflow:hidden;background:#2a2a38;color:#fff1c2;min-width:64px;box-shadow:none;border:1px solid rgba(255,210,74,.5)}
.cc-pot-chip.part i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#e0a82a,#ffd24a);opacity:.85}
.cc-pot-chip.part span{position:relative;text-shadow:0 0 3px #000}
.cc-pot-more{color:#8a8a9a}
.cc-pot-sum{margin-left:6px;color:#9aa4b8}
.cc-pot-fill,.cc-pot-lbl{pointer-events:auto;cursor:help}
.cc-pot-row{cursor:help}
.cc-pot-tip{position:fixed;z-index:100010;width:460px;max-height:68vh;display:flex;flex-direction:column;background:#14141c;border:1px solid rgba(255,210,74,.45);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.7);color:#ddd;font:13px/1.35 system-ui,sans-serif;overflow:hidden}
.cc-pot-tip .th{padding:9px 12px;background:#1b1b26;border-bottom:1px solid rgba(255,255,255,.08)}
.cc-pot-tip .th b{color:#ffd24a;font-weight:600}
.cc-pot-tip .th div{color:#8a8a9a;font-size:11.5px;margin-top:2px}
.cc-pot-tip .tb{overflow-y:auto;padding:4px 6px;scrollbar-width:thin;scrollbar-color:#464658 transparent}
.cc-pot-tip .r{display:grid;grid-template-columns:24px 1fr 52px 62px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px}
.cc-pot-tip .r:hover{background:rgba(255,255,255,.06)}
.cc-pot-tip .r img{width:22px;height:22px;image-rendering:pixelated}
.cc-pot-tip .r .nm{min-width:0}
.cc-pot-tip .r .nm span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-pot-tip .r .nm small{display:flex;align-items:center;gap:4px;color:#8a8a9a;font-size:11px;flex-wrap:wrap}
.cc-pot-tip .r .nm small img{width:13px;height:13px}
.cc-pot-tip .r .n{text-align:right;color:#cfd3dc}
.cc-pot-tip .r .x{text-align:right;color:#ffe27a;font-weight:600}
.cc-pot-tip .tf{padding:8px 12px;background:#1b1b26;border-top:1px solid rgba(255,255,255,.08);color:#cfd3dc;font-size:12px}
@media (prefers-reduced-motion:reduce){.cc-pot-fill{animation:none}}`;
  document.head.appendChild(style);

  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  let lastKey = '', row = null, cur = null, tip = null, tipT = 0;
  const skillName = { smith: 'Smith', craft: 'Craft', imbue: 'Imbue', brew: 'Brew' };
  const iconOf = (id) => '/assets/icons/items/' + id + '.png';
  function closeTip() { clearTimeout(tipT); if (tip) { tip.remove(); tip = null; } }
  function openTip(anchor) {
    clearTimeout(tipT);
    if (tip || !cur) return;
    const { skill, pot, a, z, names } = cur;
    const el = document.createElement('div'); el.className = 'cc-pot-tip';
    const nm = (id) => (names && names[id]) || id;
    const gained = z.lvl - a.lvl;
    el.innerHTML = '<div class="th"><b></b><div></div></div><div class="tb"></div><div class="tf"></div>';
    el.querySelector('.th b').textContent = skillName[skill] + ' \u2013 crafting potential';
    el.querySelector('.th div').textContent = 'What you would earn by crafting with everything in your bank. New collection log entries (★) come first, then the most XP per material; nothing is crafted for you.';
    const tb = el.querySelector('.tb');
    pot.lines.forEach((ln) => {
      const r = document.createElement('div'); r.className = 'r';
      const im = document.createElement('img'); im.src = iconOf(ln.id); im.addEventListener('error', () => { im.style.visibility = 'hidden'; }); r.appendChild(im);
      const c = document.createElement('div'); c.className = 'nm';
      const t = document.createElement('span'); t.textContent = (ln.coll ? '★ ' : '') + nm(ln.id); t.title = nm(ln.id) + (ln.coll ? ' – new collection log entry' : ''); if (ln.coll) t.style.color = '#ffe27a'; c.appendChild(t);
      const sm = document.createElement('small');
      ln.mats.forEach(([id, q]) => { const mi = document.createElement('img'); mi.src = iconOf(id); mi.title = nm(id); mi.addEventListener('error', () => { mi.style.display = 'none'; }); sm.appendChild(mi); sm.appendChild(document.createTextNode(q.toLocaleString('en-US') + '  ')); });
      c.appendChild(sm); r.appendChild(c);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = '\u00d7' + ln.n.toLocaleString('en-US'); n.title = ln.xpEach + ' XP each'; r.appendChild(n);
      const x = document.createElement('div'); x.className = 'x'; x.textContent = '+' + fmt(ln.xp); r.appendChild(x);
      tb.appendChild(r);
    });
    el.querySelector('.tf').textContent = pot.crafts.toLocaleString('en-US') + ' crafts \u00b7 +' + Math.round(pot.xp).toLocaleString('en-US') + ' XP \u00b7 Lv ' + a.lvl + ' (' + Math.round(a.p * 100) + '%) \u2192 Lv ' + z.lvl + (z.max ? ' (max)' : ' (' + Math.round(z.p * 100) + '%)') + (gained > 0 ? '  =  +' + gained + (gained === 1 ? ' level' : ' levels') : '');
    el.addEventListener('mouseenter', () => clearTimeout(tipT)); el.addEventListener('mouseleave', () => { tipT = setTimeout(closeTip, 200); });
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect(), er = el.getBoundingClientRect();
    el.style.left = Math.max(6, Math.min(innerWidth - er.width - 6, r.left + r.width / 2 - er.width / 2)) + 'px';
    el.style.top = Math.min(innerHeight - er.height - 6, r.bottom + 8) + 'px';
    tip = el;
  }
  const hoverOn = (e) => { const t = e.target && e.target.closest ? e.target.closest('.cc-pot-fill, .cc-pot-lbl, .cc-pot-row') : null; if (t) openTip(t); };
  const hoverOff = (e) => { const t = e.target && e.target.closest ? e.target.closest('.cc-pot-fill, .cc-pot-lbl, .cc-pot-row') : null; if (t) tipT = setTimeout(closeTip, 250); };
  document.addEventListener('mouseover', hoverOn, true); document.addEventListener('mouseout', hoverOff, true);
  function clear() { closeTip(); document.querySelectorAll('.cc-pot-fill, .cc-pot-lbl, .cc-pot-row').forEach((e) => e.remove()); row = null; lastKey = ''; cur = null; }

  function tick() {
    if (!on()) { clear(); return; }
    const ov = document.querySelector('.modal-overlay');
    if (!ov || getComputedStyle(ov).display === 'none') { if (lastKey) clear(); return; }
    const act = document.querySelector('.modal-body > .tab-content.active');
    const skill = act ? TABS[act.id] : null;
    const bar = document.querySelector('.modal-main .header-xp-bar');
    if (!skill || !bar || getComputedStyle(bar).display === 'none') { if (lastKey) clear(); return; }
    loadTbl();
    const b = window.__ccBridge;
    if (!tbl || !b || !b.craft) return;
    const d = b.craft();
    if (!d || d.xp == null || d.xp[skill] == null) return;
    const curXp = d.xp[skill];
    const pot = potentialXp(skill, d);
    const key = [skill, Math.round(curXp), pot.xp, pot.crafts].join('|');
    if (key === lastKey && bar.querySelector('.cc-pot-fill, .cc-pot-lbl') != null === (pot.xp > 0)) return;
    lastKey = key;
    bar.querySelectorAll('.cc-pot-fill, .cc-pot-lbl').forEach((e) => e.remove());
    if (row) { row.remove(); row = null; }
    if (!(pot.xp > 0)) { cur = null; return; }
    const a = frac(curXp), z = frac(curXp + pot.xp);
    cur = { skill, pot, a, z, names: d.names || {} };
    const gained = z.lvl - a.lvl;
    const fillEl = bar.querySelector('.header-xp-bar-fill');
    const startPct = fillEl && fillEl.style.width ? parseFloat(fillEl.style.width) : a.p * 100;
    const f = document.createElement('div'); f.className = 'cc-pot-fill';
    f.style.left = startPct + '%';
    f.style.width = (gained >= 1 ? 100 - startPct : Math.max(0.4, (z.p - a.p) * 100)) + '%';
    bar.appendChild(f);
    const l = document.createElement('div'); l.className = 'cc-pot-lbl';
    l.textContent = gained >= 1 ? '✦ +' + gained + (gained === 1 ? ' level' : ' levels') + (z.max ? ' (max)' : ' + ' + Math.round(z.p * 100) + '%') : '✦ +' + fmt(pot.xp) + ' XP → ' + Math.round(z.p * 100) + '%';
    l.title = 'If you craft with every material in your bank: ' + pot.crafts.toLocaleString('en-US') + ' crafts, +' + Math.round(pot.xp).toLocaleString('en-US') + ' XP';
    bar.appendChild(l);
    if (gained >= 1) {
      row = document.createElement('div'); row.className = 'cc-pot-row';
      const hd = document.createElement('span'); hd.className = 'hd'; hd.textContent = 'Potential'; row.appendChild(hd);
      const lv = []; for (let x = a.lvl + 1; x <= z.lvl; x++) lv.push(x);
      const chip = (n) => { const c = document.createElement('span'); c.className = 'cc-pot-chip'; c.textContent = 'Lv ' + n; return c; };
      const show = lv.length > 7 ? lv.slice(0, 3).concat([null], lv.slice(-3)) : lv;
      show.forEach((n) => { if (n == null) { const m = document.createElement('span'); m.className = 'cc-pot-more'; m.textContent = '… +' + (lv.length - 6) + ' more …'; row.appendChild(m); } else row.appendChild(chip(n)); });
      if (!z.max) { const pc = document.createElement('span'); pc.className = 'cc-pot-chip part'; pc.title = 'Progress into level ' + (z.lvl + 1); pc.innerHTML = '<i></i><span></span>'; pc.firstChild.style.width = Math.round(z.p * 100) + '%'; pc.lastChild.textContent = Math.round(z.p * 100) + '% → ' + (z.lvl + 1); row.appendChild(pc); }
      const sm = document.createElement('span'); sm.className = 'cc-pot-sum'; sm.textContent = '+' + Math.round(pot.xp).toLocaleString('en-US') + ' XP from ' + pot.crafts.toLocaleString('en-US') + ' crafts';
      row.appendChild(sm);
      bar.parentElement.insertBefore(row, bar.nextSibling);
    }
  }
  const timer = setInterval(() => { try { if (!document.hidden) tick(); } catch (e) { /* keep ticking */ } }, 700);
  setTimeout(tick, 400);

  function teardown() {
    clearInterval(timer); clear(); style.remove();
    document.removeEventListener('mouseover', hoverOn, true); document.removeEventListener('mouseout', hoverOff, true);
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc craft-potential torn down';
  }
  window[NS] = { version: 1, teardown, potentialXp, tick };
  console.log('[cc] craft-potential loaded');
  return 'cc craft-potential loaded';
})();
