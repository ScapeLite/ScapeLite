// ScapeLite XP/hr tracker (v2). DISPLAY-ONLY: reads the XP numbers the game already shows in the Skills panel
// tooltips (the same `.tooltip .tt-line.tt-xp` / `.tt-next` lines hover-info.js reads) and never clicks or changes
// anything. A small draggable chip shows your total XP/hr with a sparkline; expand it for a live graph of XP/hr
// over a time frame you pick (5 m ... 3 h or the whole session), a per-skill breakdown with icons and level-up ETAs,
// and click a skill to graph only that skill. Other plugins (Route Advisor) read `window.__ccXpTracker.rates`.
(function () {
  'use strict';
  const NS = '__ccXpTracker';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const SAMPLE_MS = 2000;
  const KEEP_MS = 3 * 3600 * 1000 + 5 * 60 * 1000; // longest frame (3 h) + slack
  const LS_POS = 'cc-xp-tracker-pos', LS_MIN = 'cc-xp-tracker-min', LS_FRAME = 'cc-xp-tracker-frame';
  const FRAMES = [['5m', '5 m', 5 * 60e3], ['15m', '15 m', 15 * 60e3], ['30m', '30 m', 30 * 60e3], ['1h', '1 h', 3600e3], ['3h', '3 h', 3 * 3600e3], ['all', 'Session', 0]];

  const settingOn = (key, def) => {
    try { const s = window.__ccPluginSettings; if (s && s.get) { const v = s.get(key); return v === undefined ? def : v; } } catch (e) {}
    return def;
  };

  const hist = {};          // skill -> [{t, xp}]
  const sessionStart = {};  // skill -> xp at first sample
  let sessionAt = Date.now();
  let minimized = false, frameKey = '15m', focus = null; // focus = skill id to graph, or null for total
  try { minimized = localStorage.getItem(LS_MIN) === '1'; frameKey = localStorage.getItem(LS_FRAME) || frameKey; } catch (e) {}
  if (!FRAMES.some(f => f[0] === frameKey)) frameKey = '15m';
  const frameMs = () => { const f = FRAMES.find(x => x[0] === frameKey); return f[2] || Math.max(60e3, Date.now() - sessionAt); };

  function readSkills() {
    const out = [];
    document.querySelectorAll('.skill-cell[data-skill-id]').forEach(cell => {
      const id = cell.getAttribute('data-skill-id');
      const xpLine = cell.querySelector('.tooltip .tt-line.tt-xp');
      if (!xpLine) return;
      const m = (xpLine.textContent || '').match(/^([\d,]+)\s*\//);
      if (!m) return;
      const nextLine = cell.querySelector('.tooltip .tt-line.tt-next');
      const nm = nextLine ? (nextLine.textContent || '').match(/^([\d,]+)/) : null;
      const lvl = parseInt(((cell.querySelector('.skill-level') || {}).textContent || ''), 10);
      out.push({ id, xp: parseInt(m[1].replace(/,/g, ''), 10), toNext: nm ? parseInt(nm[1].replace(/,/g, ''), 10) : null, lvl: Number.isFinite(lvl) ? lvl : null });
    });
    return out;
  }

  let latest = {};
  function sample() {
    const now = Date.now();
    for (const s of readSkills()) {
      latest[s.id] = s;
      const h = hist[s.id] || (hist[s.id] = []);
      if (sessionStart[s.id] == null) sessionStart[s.id] = s.xp;
      const last = h[h.length - 1];
      if (!last || last.xp !== s.xp || now - last.t > 30000) h.push({ t: now, xp: s.xp }); // change + heartbeat
      while (h.length && now - h[0].t > KEEP_MS) h.shift();
    }
  }

  // XP/hr over the last `winMs`, from the oldest sample inside the window.
  function rateFor(id, winMs) {
    const h = hist[id];
    if (!h || h.length < 2) return 0;
    const now = Date.now(), last = h[h.length - 1];
    let a = h[0];
    for (const p of h) { if (now - p.t <= winMs) { a = p; break; } }
    const idx = h.indexOf(a);
    if (idx > 0) a = h[idx - 1];
    const dt = (Math.min(now, last.t + 30000) - a.t) / 1000;
    const dx = last.xp - a.xp;
    if (dx <= 0 || dt < 20) return 0;
    return (dx / Math.min(dt, winMs / 1000)) * 3600;
  }

  // XP gained by one skill (or all) between two timestamps, interpolating inside samples.
  function xpAt(id, t) {
    const h = hist[id]; if (!h || !h.length) return null;
    if (t <= h[0].t) return h[0].xp;
    const last = h[h.length - 1]; if (t >= last.t) return last.xp;
    let lo = 0, hi = h.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (h[mid].t <= t) lo = mid; else hi = mid; }
    const a = h[lo], b = h[hi]; return a.xp + (b.xp - a.xp) * ((t - a.t) / Math.max(1, b.t - a.t));
  }
  // Graph series: XP/hr in each bucket across the frame, lightly smoothed.
  function series(winMs, buckets, only) {
    const now = Date.now(), t0 = now - winMs, step = winMs / buckets;
    const ids = only ? [only] : Object.keys(hist);
    const raw = [];
    for (let i = 0; i < buckets; i++) {
      const a = t0 + i * step, b = a + step; let gain = 0;
      for (const id of ids) { const xa = xpAt(id, a), xb = xpAt(id, b); if (xa != null && xb != null && xb > xa) gain += xb - xa; }
      raw.push(gain / (step / 1000) * 3600);
    }
    const k = Math.max(1, Math.round(buckets / 24)); // smoothing radius
    return raw.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(buckets - 1, i + k); j++) { s += raw[j]; n++; } return s / n; });
  }

  const fmtXp = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const fmtDur = s => { s = Math.round(s); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // --- UI --------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'cc-xp-style';
  style.textContent = `
#cc-xp-tracker{position:fixed;left:12px;top:140px;width:318px;z-index:99980;background:linear-gradient(180deg,rgba(24,24,32,.96),rgba(12,12,17,.96));
  border:1px solid rgba(255,255,255,.16);border-radius:10px;color:#dcdce6;font:12px/1.35 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.55);overflow:hidden}
#cc-xp-tracker.min{width:auto;min-width:176px}
#cc-xp-tracker[hidden]{display:none!important}
#cc-xp-tracker .xp-bar{display:flex;align-items:center;gap:8px;padding:6px 9px;cursor:grab;user-select:none;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.07)}
#cc-xp-tracker.min .xp-bar{border-bottom:0}
#cc-xp-tracker .xp-ico{width:18px;height:18px;image-rendering:pixelated;flex:none}
#cc-xp-tracker .xp-ttl{font-weight:700;color:#fff;letter-spacing:.02em}
#cc-xp-tracker .xp-total{margin-left:auto;color:#5fe06d;font-size:16px;font-weight:700}
#cc-xp-tracker .xp-total small{font-size:10px;color:#8fd3a0;font-weight:600;margin-left:2px}
#cc-xp-tracker canvas.spark{width:54px;height:18px;flex:none}
#cc-xp-tracker button{font:inherit;line-height:1;color:#bbb;background:#26262f;border:1px solid #444;border-radius:5px;padding:2px 7px;cursor:pointer}
#cc-xp-tracker button:hover{border-color:#8a8aa0;color:#fff}
#cc-xp-tracker .xp-frames{display:flex;gap:4px;padding:8px 9px 4px}
#cc-xp-tracker .xp-frames button{flex:1;padding:3px 0;font-size:11px}
#cc-xp-tracker .xp-frames button.on{border-color:#ffd24a;color:#ffd24a;background:#2c2a18}
#cc-xp-tracker .xp-graphwrap{position:relative;margin:2px 9px 0}
#cc-xp-tracker canvas.graph{display:block;width:100%;height:96px;border-radius:6px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.07)}
#cc-xp-tracker .xp-tip{position:absolute;pointer-events:none;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.85);border:1px solid #444;color:#fff;font-size:11px;white-space:nowrap;display:none}
#cc-xp-tracker .xp-focus{padding:3px 11px 0;color:#8a8a99;font-size:11px;min-height:15px}
#cc-xp-tracker .xp-focus b{color:#cfe9ff}
#cc-xp-tracker .xp-rows{padding:4px 9px 4px}
#cc-xp-tracker .xp-row{display:grid;grid-template-columns:20px 1fr auto;gap:2px 7px;align-items:center;padding:3px 4px;border-radius:6px;cursor:pointer}
#cc-xp-tracker .xp-row:hover{background:rgba(255,255,255,.06)}
#cc-xp-tracker .xp-row.sel{background:rgba(79,163,255,.14);outline:1px solid rgba(79,163,255,.45)}
#cc-xp-tracker .xp-row img{width:18px;height:18px;image-rendering:pixelated;grid-row:span 2}
#cc-xp-tracker .xp-row .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-xp-tracker .xp-row .n i{color:#8a8a99;font-style:normal;margin-left:4px;font-size:11px}
#cc-xp-tracker .xp-row .r{color:#8fd3ff;font-weight:600;white-space:nowrap;text-align:right}
#cc-xp-tracker .xp-row .share{height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
#cc-xp-tracker .xp-row .share>i{display:block;height:100%;background:linear-gradient(90deg,#4ea3ff,#7fe3ff);border-radius:2px}
#cc-xp-tracker .xp-row .e{color:#9a9aa6;font-size:10.5px;white-space:nowrap;text-align:right}
#cc-xp-tracker .xp-empty{padding:6px 4px;color:#8a8a99}
#cc-xp-tracker .xp-foot{display:flex;align-items:center;gap:6px;padding:4px 10px 8px;color:#8a8a96;font-size:11px}
#cc-xp-tracker .xp-foot .sp{flex:1}
`;
  const el = document.createElement('div');
  el.id = 'cc-xp-tracker';
  el.hidden = true;

  function insertUi() {
    if (!document.body) return false;
    if (!document.getElementById('cc-xp-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-xp-tracker')) document.body.appendChild(el);
    return true;
  }
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const skillImg = (id, cls) => { const i = document.createElement('img'); i.src = '/assets/icons/skills/' + id + '.png'; i.alt = id; if (cls) i.className = cls; i.addEventListener('error', () => { i.style.visibility = 'hidden'; }); return i; };

  function restorePos() {
    try { const p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); if (p) { el.style.left = Math.min(innerWidth - 60, Math.max(0, p.x)) + 'px'; el.style.top = Math.min(innerHeight - 30, Math.max(0, p.y)) + 'px'; } } catch (e) {}
  }
  function wireDrag(bar) {
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      const move = ev => {
        el.style.left = Math.max(80 - r.width, Math.min(innerWidth - 80, r.left + ev.clientX - sx)) + 'px';
        el.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        try { localStorage.setItem(LS_POS, JSON.stringify({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })); } catch (err) {}
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));

  function prep(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cssW, cssH);
    return g;
  }
  function drawSpark(canvas, data) {
    const W = 54, H = 18, g = prep(canvas, W, H), max = Math.max(1, ...data);
    g.strokeStyle = '#5fe06d'; g.lineWidth = 1.5; g.lineJoin = 'round'; g.beginPath();
    data.forEach((v, i) => { const x = i / (data.length - 1) * (W - 2) + 1, y = H - 2 - (v / max) * (H - 4); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }
  function drawGraph(canvas, data, winMs, color) {
    const W = canvas.clientWidth || 298, H = 96, g = prep(canvas, W, H);
    const padL = 36, padR = 6, padT = 8, padB = 16, pw = W - padL - padR, ph = H - padT - padB;
    const max = Math.max(100, ...data) * 1.12;
    g.font = '10px system-ui,sans-serif'; g.textBaseline = 'middle';
    // grid + y labels
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#7f7f8e'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + ph - (i / 3) * ph; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.textAlign = 'right'; g.fillText(i ? fmtXp(max * i / 3) : '0', padL - 4, y);
    }
    // x labels (time ago)
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    [[0, fmtDur(winMs / 1000)], [0.5, fmtDur(winMs / 2000)], [1, 'now']].forEach(([f, t]) => { g.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; g.fillText(t, padL + f * pw, H - 3); });
    // area + line
    const pts = data.map((v, i) => [padL + i / (data.length - 1) * pw, padT + ph - (v / max) * ph]);
    const grad = g.createLinearGradient(0, padT, 0, padT + ph); grad.addColorStop(0, color + 'aa'); grad.addColorStop(1, color + '08');
    g.beginPath(); g.moveTo(pts[0][0], padT + ph); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(pts[pts.length - 1][0], padT + ph); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    const lp = pts[pts.length - 1]; g.beginPath(); g.arc(lp[0], lp[1], 3, 0, 7); g.fillStyle = '#fff'; g.fill();
    canvas._geo = { padL, padR, padT, ph, pw, W, data, max, winMs };
  }

  function render(auto) {
    insertUi();
    if (!settingOn('xpTrackerEnabled', true)) { el.hidden = true; return; }
    if (auto === true && el.childNodes.length && el.matches(':hover')) return; // don't rebuild under the cursor (keeps the graph tooltip steady)
    const rateWinMs = frameMs();
    const rows = [];
    let total = 0, sessionGain = 0;
    for (const id of Object.keys(hist)) {
      const r = rateFor(id, rateWinMs);
      const s = latest[id];
      const gained = s ? s.xp - sessionStart[id] : 0;
      sessionGain += Math.max(0, gained);
      if (r > 0) { total += r; rows.push({ id, r, s, gained }); }
    }
    rows.sort((a, b) => b.r - a.r);
    if (focus && !hist[focus]) focus = null;
    el.hidden = false;
    el.className = minimized ? 'min' : '';
    el.textContent = '';

    // ---- header: icon, title, total + sparkline, collapse ----
    const bar = h('div', 'xp-bar');
    const ic = skillImg(rows[0] ? rows[0].id : 'life', 'xp-ico'); bar.appendChild(ic);
    bar.appendChild(h('span', 'xp-ttl', 'XP / hr'));
    if (minimized) { const sp = document.createElement('canvas'); sp.className = 'spark'; bar.appendChild(sp); requestAnimationFrame(() => drawSpark(sp, series(Math.min(frameMs(), 15 * 60e3), 24, null))); }
    const tot = h('span', 'xp-total', total > 0 ? fmtXp(total) : '–'); if (total > 0) tot.appendChild(h('small', null, '/hr'));
    bar.appendChild(tot);
    const mb = h('button', null, minimized ? '▸' : '▾');
    mb.title = minimized ? 'Expand' : 'Collapse';
    mb.addEventListener('click', e => { e.stopPropagation(); minimized = !minimized; try { localStorage.setItem(LS_MIN, minimized ? '1' : '0'); } catch (err) {} render(); });
    bar.appendChild(mb);
    el.appendChild(bar);
    wireDrag(bar);
    restorePos();
    if (minimized) return;

    // ---- time frame ----
    const fr = h('div', 'xp-frames');
    FRAMES.forEach(([k, label]) => {
      const b = h('button', k === frameKey ? 'on' : '', label);
      b.title = k === 'all' ? 'Everything since the session counter was last reset' : 'Show the last ' + label;
      b.addEventListener('click', e => { e.stopPropagation(); frameKey = k; try { localStorage.setItem(LS_FRAME, k); } catch (err) {} render(); });
      fr.appendChild(b);
    });
    el.appendChild(fr);

    // ---- graph ----
    const wrap = h('div', 'xp-graphwrap');
    const gc = document.createElement('canvas'); gc.className = 'graph'; wrap.appendChild(gc);
    const tip = h('div', 'xp-tip'); wrap.appendChild(tip);
    el.appendChild(wrap);
    const winMs = frameMs();
    const data = series(winMs, 60, focus);
    const color = focus ? '#7fe3ff' : '#5fe06d';
    requestAnimationFrame(() => {
      drawGraph(gc, data, winMs, color);
      gc.addEventListener('mousemove', ev => {
        const geo = gc._geo; if (!geo) return;
        const r = gc.getBoundingClientRect(), x = ev.clientX - r.left;
        const f = Math.max(0, Math.min(1, (x - geo.padL) / geo.pw)), i = Math.round(f * (geo.data.length - 1));
        tip.style.display = 'block'; tip.textContent = fmtXp(geo.data[i]) + ' xp/hr · ' + (i === geo.data.length - 1 ? 'now' : fmtDur((1 - i / (geo.data.length - 1)) * geo.winMs / 1000) + ' ago');
        tip.style.left = Math.min(r.width - tip.offsetWidth - 2, Math.max(2, x + 8)) + 'px'; tip.style.top = '4px';
      });
      gc.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
    const fl = h('div', 'xp-focus');
    if (focus) { fl.appendChild(document.createTextNode('Graphing ')); fl.appendChild(h('b', null, cap(focus))); fl.appendChild(document.createTextNode(' · click it again for the total')); }
    else fl.textContent = 'All skills combined · click a skill to graph just that one';
    el.appendChild(fl);

    // ---- per-skill rows with icons ----
    const body = h('div', 'xp-rows');
    if (!rows.length) body.appendChild(h('div', 'xp-empty', 'Waiting for XP gains…'));
    const topRate = rows.length ? rows[0].r : 1;
    rows.slice(0, 6).forEach(({ id, r, s }) => {
      const row = h('div', 'xp-row' + (focus === id ? ' sel' : ''));
      row.appendChild(skillImg(id));
      const n = h('span', 'n', cap(id)); if (s && s.lvl) n.appendChild(h('i', null, 'Lv ' + s.lvl)); row.appendChild(n);
      row.appendChild(h('span', 'r', fmtXp(r) + '/hr'));
      const share = h('div', 'share'); const fill = document.createElement('i'); fill.style.width = Math.max(4, r / topRate * 100) + '%'; share.appendChild(fill); row.appendChild(share);
      row.appendChild(h('span', 'e', s && s.toNext != null ? 'level in ' + fmtDur(s.toNext / r * 3600) : ''));
      row.addEventListener('click', e => { e.stopPropagation(); focus = focus === id ? null : id; render(); });
      body.appendChild(row);
    });
    el.appendChild(body);

    const foot = h('div', 'xp-foot');
    foot.appendChild(h('span', null, 'Session +' + fmtXp(sessionGain) + ' XP in ' + fmtDur((Date.now() - sessionAt) / 1000)));
    foot.appendChild(h('span', 'sp'));
    const rs = h('button', null, 'Reset');
    rs.title = 'Restart the session counter';
    rs.addEventListener('click', e => { e.stopPropagation(); for (const k of Object.keys(latest)) sessionStart[k] = latest[k].xp; sessionAt = Date.now(); render(); });
    foot.appendChild(rs);
    el.appendChild(foot);
  }

  let timerId = null;
  function tick() {
    try { sample(); render(true); } catch (e) { /* keep running */ }
    timerId = setTimeout(tick, SAMPLE_MS);
  }
  tick();

  function teardown() {
    clearTimeout(timerId); el.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc xp-tracker torn down';
  }
  window[NS] = {
    version: 2, teardown,
    get rates() { const w = (Number(settingOn('xpTrackerWindowMin', 5)) || 5) * 60000; const o = {}; for (const k of Object.keys(hist)) { const r = rateFor(k, w); if (r > 0) o[k] = Math.round(r); } return o; },
  };
  console.log('[cc] xp-tracker loaded');
  return 'cc xp-tracker loaded';
})();
