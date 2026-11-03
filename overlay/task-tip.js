// ScapeLite Task Tip: rich hover tooltips for the history lists in the Skills Customization window, and a Slay History that is never empty.
// Display only: it reads the Task Log (window.__ccTaskLog) and the game's own history through the read-only bridge, and only changes the
// text inside the history sidebar's own tooltips. It never presses anything.
//
// Why a Slay History is needed: the game builds its history lists from a server-sent list of the last ~200 NON-slay tasks. Slay tasks are
// not in it (the game only keeps a counter for them), so the "Slay History" view filters that list by skill 'slay' and is always empty
// ("0 tasks completed"). When that view is empty this fills it from the Task Log, in the game's own row markup. If the game ever fills it
// itself, the game's rows are left alone and only their tooltips are enriched.
//
// Reusable: window.__ccTaskTip.html(rec, ctx) builds the tooltip body for any Task Log record (other plugins may call it).
(function () {
  'use strict';
  const NS = '__ccTaskTip';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('taskTipEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };

  // ---------- formatting ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pretty = (id) => String(id || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const dur = (s) => {
    s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m ? m + 'm ' + String(r).padStart(2, '0') + 's' : r + 's';
  };
  const ago = (ms) => { const m = Math.floor((Date.now() - ms) / 6e4); if (m < 1) return 'now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago'; };
  const clock = (sec) => { try { const d = new Date(sec * 1000); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const pct = (a, b) => (b > 0 ? (a / b - 1) * 100 : null);
  const sgn = (p) => (p == null ? '' : (p >= 0 ? '+' : '') + Math.round(p) + '%');
  const itemNames = {};
  const itemName = (id) => {
    if (itemNames[id]) return itemNames[id];
    let n = null; try { const b = window.__ccBridge; n = b && b.itemName ? b.itemName(id) : null; } catch (e) {}
    return (itemNames[id] = n && n !== id ? n : pretty(id));
  };
  const SK = { fish: 'Fish', mine: 'Mine', forage: 'Forage', invoke: 'Invoke', farm: 'Farm', plunder: 'Plunder', bard: 'Bard', vigor: 'Vigor', cook: 'Cook', smith: 'Smith', craft: 'Craft', imbue: 'Imbue', brew: 'Brew', barter: 'Barter', discover: 'Discover', slay: 'Slay', life: 'Life', spirit: 'Spirit', luck: 'Luck', delve: 'Delve', fortify: 'Fortify' };
  const skName = (k) => SK[k] || pretty(k);
  const UNIT = { movement: 'yards', teleport: 'charges' };

  // ---------- Task Log access ----------
  let cache = null, cacheAt = 0;
  function records() {
    const now = Date.now();
    if (!cache || now - cacheAt > 4000) { try { cache = (window.__ccTaskLog && window.__ccTaskLog.log()) || []; } catch (e) { cache = []; } cacheAt = now; }
    return cache;
  }
  const endOf = (r) => r.te || (r.ts + (r.secs ? r.secs.total : 0));
  // The Task Log record that belongs to a game history entry {skill, qty, ts(ms)}: same skill and quantity, finished closest in time (within 15 min).
  function match(entry, used) {
    let best = null, bd = 900;
    const t = entry.ts / 1000;
    records().forEach((r) => {
      if (r.kind !== 'skill' || r.skill !== entry.skill || r.qty !== entry.qty || (used && used.has(r))) return;
      const d = Math.abs(endOf(r) - t); if (d < bd) { bd = d; best = r; }
    });
    if (best && used) used.add(best);
    return best;
  }

  // ---------- tooltip body ----------
  const dim = 'color:var(--text-muted)', small = 'font-size:17px;';
  const line = (inner, style) => '<div class="tt-line" style="' + small + (style || '') + '">' + inner + '</div>';
  const tag = (t, c) => '<span style="color:' + c + '">' + t + '</span>';
  const itemList = (m, cap) => {
    const ent = Object.keys(m).sort((a, b) => m[b] - m[a]);
    const shown = ent.slice(0, cap).map((id) => num(m[id]) + ' ' + esc(itemName(id)));
    const out = []; for (let i = 0; i < shown.length; i += 3) out.push(shown.slice(i, i + 3).join(', '));
    if (ent.length > cap) out.push('+' + (ent.length - cap) + ' more');
    return out;
  };
  // rec: a Task Log record or null. ctx: { n (task number), exact (bool), name, ago, icon, qty }
  function html(rec, ctx) {
    ctx = ctx || {};
    let h = '<div class="tt-line history-tt-line" style="gap:6px"><span>' + (ctx.n != null ? (ctx.exact ? '#' : '~#') + Math.round(ctx.n) : '') + '</span>' + (ctx.icon ? '<img class="tt-skill-icon" src="' + esc(ctx.icon) + '" alt="">' : '') + '<span>' + esc(ctx.name || '') + '</span><span class="history-tt-time">' + esc(ctx.ago || '') + '</span></div>';
    if (ctx.n != null && !ctx.exact) h += line(tag('~ estimated number: counted back from the game’s slay counter along the Task Log order', 'var(--text-muted)'), 'font-size:14px');
    if (!rec) return h + line(tag('Not in the Task Log (older than it, or logging was off)', 'var(--text-muted)'));
    const s = rec.secs || {}, tot = s.total || 0;
    // state
    const full = (rec.completed || ctx.gameDone) && !rec.partial;
    // ctx.gameDone: the game's own history lists it, so it finished even if the log saw it end a few steps short (e.g. 68/70 at the last sample)
    const fin = rec.completed || ctx.gameDone;
    const st = [fin ? tag('Completed', 'rgb(76,175,80)') + ' ' + num(ctx.gameDone ? rec.qty : rec.done || rec.qty) + '/' + num(rec.qty) : tag('Stopped', '#e8c15a') + ' at ' + num(rec.done || 0) + '/' + num(rec.qty)];
    if (rec.lucky) st.push(tag('Lucky', '#e8c15a'));
    if (rec.partial) st.push(tag('joined mid-task', 'var(--text-muted)'));
    st.push(esc(clock(endOf(rec))));
    h += line(st.join(' · '));
    // time
    const parts = [];
    if (s.moving) parts.push('walking ' + dur(s.moving)); if (s.acting) parts.push('acting ' + dur(s.acting)); if (s.banking) parts.push('banking ' + dur(s.banking));
    h += line('<b>' + dur(tot) + '</b>' + (parts.length ? ' · ' + parts.join(' · ') : '') + (rec.partial ? tag(' (observed part only)', 'var(--text-muted)') : ''));
    // xp
    const xk = Object.keys(rec.xp || {}).sort((a, b) => rec.xp[b] - rec.xp[a]);
    if (xk.length) {
      h += line('<b>' + num(rec.xpSum) + ' XP</b>' + (tot > 30 ? ' · ' + num(rec.xpSum / tot * 3600) + ' XP/h' : ''));
      const xs = xk.slice(0, 6).map((k) => skName(k) + ' ' + num(rec.xp[k])); const out = []; for (let i = 0; i < xs.length; i += 3) out.push(xs.slice(i, i + 3).join(', '));
      if (xk.length > 6) out.push('+' + (xk.length - 6) + ' more');
      out.forEach((l) => { h += line(l, dim + ';'); });
    }
    // plan vs actual
    const p = rec.pred;
    if (p && (p.dash || p.xp)) {
      const bits = [];
      if (p.dash && s.acting && full && !rec.partial) bits.push('time ' + dur(p.dash) + ' planned, ' + dur(s.acting) + ' acting ' + tag(sgn(pct(s.acting, p.dash)), 'var(--text-accent)'));
      else if (p.dash) bits.push('time ' + dur(p.dash) + ' planned');
      if (p.xp && rec.xpSum && full && !rec.partial) bits.push('XP ' + num(p.xp) + ' planned ' + tag(sgn(pct(rec.xpSum, p.xp)), 'var(--text-accent)'));
      if (bits.length) h += line('<span style="' + dim + '">Plan:</span> ' + bits.join(' · '));
    }
    // loot, materials, potions, gold
    if (rec.gain) { h += line('<span style="color:rgb(76,175,80)">Gained</span>'); itemList(rec.gain, 9).forEach((l) => { h += line(l, dim + ';'); }); }
    if (rec.use) { h += line('<span style="color:rgb(255,102,68)">Used up</span>'); itemList(rec.use, 9).forEach((l) => { h += line(l, dim + ';'); }); }
    if (rec.gp) h += line('Gold ' + tag((rec.gp > 0 ? '+' : '') + num(rec.gp), rec.gp > 0 ? 'rgb(76,175,80)' : 'rgb(255,102,68)'));
    if (rec.pot) {
      const ps = Object.keys(rec.pot).map((k) => { const x = rec.pot[k]; return esc(itemName(x[0])) + ' ' + (x[2] ? '≥' : '') + num(x[1]) + ' ' + (UNIT[k] || 'attacks'); });
      h += line('<span style="' + dim + '">Potions:</span> ' + ps.join(', '));
    }
    if (!rec.v) h += line(tag('Recorded before drops, materials and gold were tracked', 'var(--text-muted)'), 'font-size:14px');
    return h;
  }

  // ---------- sidebar enhancer ----------
  const originals = new WeakMap();
  let obs = null, obsEl = null, busy = false, sig = '';
  const sidebar = () => { const t = document.getElementById('tab-skillcustom'); return t ? t.querySelector('.history-sidebar') : null; };
  function restore(sb) {
    if (!sb) return;
    sb.querySelectorAll('.history-row').forEach((row) => {
      if (row.hasAttribute('data-cc-fill')) { row.remove(); return; }
      const t = row.querySelector('.tooltip'), o = originals.get(row);
      if (t && o != null) { t.innerHTML = o; originals.delete(row); }
    });
    sig = '';
  }
  function enhance() {
    const sb = sidebar();
    if (!sb) return;
    if (!on()) { if (sig) { busy = true; try { restore(sb); } finally { busy = false; } } return; }
    const b = window.__ccBridge;
    if (!b || !b.taskHistory || !b.ledger) return;
    const title = (sb.querySelector('.history-title') || {}).textContent || '';
    const rows = [].slice.call(sb.querySelectorAll('.history-row'));
    const key = title + '|' + rows.length + '|' + (rows[0] ? rows[0].textContent : '') + '|' + (rows[rows.length - 1] ? rows[rows.length - 1].textContent : '');
    if (key === sig && rows.every((r) => originals.has(r) || r.hasAttribute('data-cc-fill'))) return;
    const H = b.taskHistory(), L = b.ledger();
    if (!H || !L) return;
    busy = true;
    try {
      const total = H.view === 'total' || /^Total/.test(title);
      const skill = total ? null : H.skill;
      if (skill === 'slay' && !rows.length) fillSlay(sb, L);
      else {
        const entries = total ? H.entries : H.entries.filter((e) => e.skill === skill);
        if (entries.length === rows.length) {
          const used = new Set();
          rows.forEach((row, i) => {
            const t = row.querySelector('.tooltip'), e = entries[i]; if (!t) return;
            if (!originals.has(row)) originals.set(row, t.innerHTML);
            const base = total ? L.tasksTotal : (L.tasksBy && L.tasksBy[skill]);
            const icon = '/assets/icons/skills/' + e.skill + '.png';
            t.innerHTML = html(match(e, used), { gameDone: true, n: base != null ? base - i : null, exact: true, name: e.qty + ' ' + e.name, ago: ago(e.ts), icon });
          });
        }
      }
      sig = key;
      const rows2 = [].slice.call(sb.querySelectorAll('.history-row'));
      sig = title + '|' + rows2.length + '|' + (rows2[0] ? rows2[0].textContent : '') + '|' + (rows2[rows2.length - 1] ? rows2[rows2.length - 1].textContent : '');
    } catch (e) { /* never break the game's window */ } finally { if (obs) obs.takeRecords(); busy = false; }
  }
  // Slay History from the Task Log (completed slay tasks, newest first), in the game's own row markup.
  function fillSlay(sb, L) {
    const recs = records().filter((r) => r.kind === 'slay' && r.completed).sort((a, b) => endOf(b) - endOf(a));
    const scroll = sb.querySelector('.history-scroll'), stats = sb.querySelector('.history-stats');
    if (!scroll) return;
    let cur = L.slayDone, htmlRows = '';
    recs.forEach((r) => {
      const exact = r.n != null; if (exact) cur = r.n;
      const n = cur; cur--;
      const name = r.qty + ' ' + pretty(r.act), a = ago(endOf(r) * 1000);
      const inner = html(r, { n, exact, name, ago: a, icon: '/assets/icons/skills/slay.png' });
      htmlRows += '<div class="history-row" data-cc-fill="1"><span class="history-num">#' + (n > 0 ? n : '?') + '</span><span style="flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-light);padding:0 4px">' + esc(pretty(r.act)) + '</span><span class="history-time" style="margin-left:0">' + esc(a) + '</span><div class="tooltip">' + inner + '</div></div>';
    });
    scroll.innerHTML = htmlRows;
    if (stats) { stats.textContent = recs.length + ' of ' + L.slayDone + ' logged'; stats.title = 'The game keeps no slay history. These rows come from the ScapeLite Task Log, which has only the slay tasks it was running for.'; }
  }
  function attach() {
    const sb = sidebar();
    if (sb === obsEl) return;
    if (obs) { obs.disconnect(); obs = null; }
    obsEl = sb;
    if (!sb) return;
    obs = new MutationObserver(() => { if (!busy) enhance(); });
    obs.observe(sb, { childList: true, subtree: true, characterData: true });
    enhance();
  }
  const timer = setInterval(() => { try { attach(); const sb = sidebar(); if (sb && sb.offsetParent !== null) enhance(); } catch (e) {} }, 1500);
  attach();

  function teardown() {
    clearInterval(timer); if (obs) obs.disconnect(); obs = null;
    try { busy = true; restore(sidebar()); } catch (e) {}
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc task-tip torn down';
  }
  window[NS] = { version: 1, teardown, html, match, enhance, fmt: { dur, num, ago, pretty, itemName, skName } };
  return 'cc task-tip loaded';
})();
