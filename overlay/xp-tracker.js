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
  const KEEP_MS = 7 * 24 * 3600 * 1000; // history kept (and saved between restarts): a week, the longest custom frame
  const LS_HIST = 'cc-xp-hist-v1', LS_CUSTOM = 'cc-xp-tracker-custom-h';
  const LS_CLOSED = 'cc-xp-tracker-closed';
  let closed = false;
  try { closed = localStorage.getItem(LS_CLOSED) === '1'; } catch (e) {}
  const setClosed = (v) => { closed = !!v; try { localStorage.setItem(LS_CLOSED, closed ? '1' : '0'); } catch (e) {} };
  const LS_POS = 'cc-xp-tracker-pos', LS_MIN = 'cc-xp-tracker-min', LS_FRAME = 'cc-xp-tracker-frame';
  const FRAMES = [['5m', '5 m', 5 * 60e3], ['15m', '15 m', 15 * 60e3], ['30m', '30 m', 30 * 60e3], ['1h', '1 h', 3600e3], ['custom', 'Custom', 0], ['all', 'Session', 0]];

  const settingOn = (key, def) => {
    try { const s = window.__ccPluginSettings; if (s && s.get) { const v = s.get(key); return v === undefined ? def : v; } } catch (e) {}
    return def;
  };

  const hist = {};          // skill -> [{t, xp}]
  const sessionStart = {};  // skill -> xp at first sample
  let sessionAt = Date.now();
  // Saved between restarts of ScapeLite and of the game (browser storage): only points where the XP changed, plus the newest.
  try {
    const sv = JSON.parse(localStorage.getItem(LS_HIST) || 'null'), now0 = Date.now();
    if (sv && sv.hist) {
      Object.keys(sv.hist).forEach((k) => { const a = (sv.hist[k] || []).filter((q) => q && now0 - q[0] <= KEEP_MS).map((q) => ({ t: q[0], xp: q[1] })); if (a.length) hist[k] = a; });
      if (sv.sessionAt && sv.sessionAt <= now0) sessionAt = sv.sessionAt;
      Object.assign(sessionStart, sv.sessionStart || {});
    }
  } catch (e) {}
  function compact(h, now) {
    // drop repeated "no change" points older than an hour (keep the first and last of each flat stretch)
    const out = [];
    for (let i = 0; i < h.length; i++) {
      const prev = out[out.length - 1], nxt = h[i + 1];
      if (prev && nxt && now - h[i].t > 3600e3 && h[i].xp === prev.xp && nxt.xp === h[i].xp) continue;
      out.push(h[i]);
    }
    return out;
  }
  function saveHist() {
    try {
      const now = Date.now(), o = { saved: now, sessionAt, sessionStart, hist: {} };
      Object.keys(hist).forEach((k) => { hist[k] = compact(hist[k], now); o.hist[k] = hist[k].map((q) => [q.t, q.xp]); });
      localStorage.setItem(LS_HIST, JSON.stringify(o));
    } catch (e) { /* storage full or blocked: keep running without saving */ }
  }
  const saveTimer = setInterval(saveHist, 20000);
  window.addEventListener('beforeunload', saveHist);
  let minimized = false, frameKey = '15m', focus = null; // focus = skill id to graph, or null for total
  let mode = 'total', metric = 'rate'; // mode: 'total' line, or 'skills' = every skill stacked; metric: XP per hour, or XP gained in the window
  try { minimized = localStorage.getItem(LS_MIN) === '1'; frameKey = localStorage.getItem(LS_FRAME) || frameKey; mode = localStorage.getItem('cc-xp-tracker-mode') === 'skills' ? 'skills' : 'total'; metric = localStorage.getItem('cc-xp-tracker-metric') === 'gained' ? 'gained' : 'rate'; } catch (e) {}
  let customH = 6, editing = false;
  try { const c = parseFloat(localStorage.getItem(LS_CUSTOM)); if (c > 0) customH = Math.min(168, c); } catch (e) {}
  if (frameKey === '3h') { frameKey = 'custom'; customH = 3; }  // the old fixed 3 h button became the custom one
  if (!FRAMES.some(f => f[0] === frameKey)) frameKey = '15m';
  const frameMs = () => { if (frameKey === 'custom') return Math.max(60e3, customH * 3600e3); const f = FRAMES.find(x => x[0] === frameKey); return f[2] || Math.max(60e3, Date.now() - sessionAt); };
  const fmtH = (h) => (Math.round(h * 100) / 100) + ' h';

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

  // Every skill's own series for the stacked view: XP/hr per bucket, or XP gained so far in the window.
  function seriesBySkill(winMs, buckets, kind) {
    const now = Date.now(), t0 = now - winMs, step = winMs / buckets, out = {};
    for (const id of Object.keys(hist)) {
      const base = xpAt(id, t0);
      if (base == null) continue;
      const raw = [];
      for (let i = 0; i < buckets; i++) {
        const a = t0 + i * step, b = a + step, xa = xpAt(id, a), xb = xpAt(id, b);
        raw.push(kind === 'gained' ? Math.max(0, (xpAt(id, b) || base) - base) : (xa != null && xb != null && xb > xa ? (xb - xa) / (step / 1000) * 3600 : 0));
      }
      if (kind === 'gained') { if (raw[raw.length - 1] > 0) out[id] = raw; continue; }
      const k = Math.max(1, Math.round(buckets / 24));
      const sm = raw.map((_, i) => { let sum = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(buckets - 1, i + k); j++) { sum += raw[j]; n++; } return sum / n; });
      if (sm.some(v => v > 0)) out[id] = sm;
    }
    return out;
  }
  const PALETTE = ['#5fe06d', '#4ea3ff', '#ffb84a', '#ff6f91', '#b48cff', '#3fd8c8', '#e8e05a', '#ff8a4a', '#8fd0ff', '#c0c4cc'];
  const fmtXp = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const fmtDur = s => { s = Math.round(s); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // --- UI --------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'cc-xp-style';
  style.textContent = `
#cc-xp-tracker{font-size:12px}
#cc-xp-tracker .xp-ico{width:18px;height:18px;image-rendering:pixelated;flex:none}
#cc-xp-tracker .xp-ttl{font-weight:700;color:var(--cc-text);letter-spacing:.02em}
#cc-xp-tracker .xp-total{margin-left:auto;color:var(--cc-good);font-size:16px;font-weight:700}
#cc-xp-tracker .xp-total small{font-size:10px;color:var(--cc-text-dim);font-weight:600;margin-left:2px}
#cc-xp-tracker canvas.spark{width:54px;height:18px;flex:none}
#cc-xp-tracker .xp-custom{display:flex;align-items:center;gap:6px;padding:2px 9px 4px;color:var(--cc-text-dim);font-size:11px}
#cc-xp-tracker .xp-frames{display:flex;gap:4px;padding:8px 9px 4px}
#cc-xp-tracker .xp-frames .cc-chip{flex:1;justify-content:center;padding:0 4px;font-size:11.5px}
#cc-xp-tracker .xp-graphwrap{position:relative;margin:2px 9px 0}
#cc-xp-tracker canvas.graph{display:block;width:100%;height:96px;border-radius:6px;background:var(--cc-sunk);border:1px solid var(--cc-border)}
#cc-xp-tracker .xp-tip{position:absolute;pointer-events:none;padding:2px 6px;border-radius:4px;background:var(--cc-bg);border:1px solid var(--cc-border-strong);color:var(--cc-text);font-size:11px;white-space:nowrap;display:none}
#cc-xp-tracker .xp-focus{padding:3px 11px 0;color:var(--cc-text-dim);font-size:11px;min-height:15px}
#cc-xp-tracker .xp-focus b{color:var(--cc-text)}
#cc-xp-tracker .xp-rows{padding:4px 9px 4px}
#cc-xp-tracker .xp-row{display:grid;grid-template-columns:20px 1fr auto;gap:2px 7px;align-items:center;padding:3px 4px;border-radius:6px;cursor:pointer}
#cc-xp-tracker .xp-row:hover{background:var(--cc-bg-3)}
#cc-xp-tracker .xp-row.sel{background:var(--cc-accent-bg);outline:1px solid color-mix(in srgb,var(--cc-accent) 45%,transparent)}
#cc-xp-tracker .xp-row img{width:18px;height:18px;image-rendering:pixelated;grid-row:span 2}
#cc-xp-tracker .xp-row .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-xp-tracker .xp-row .n i{color:var(--cc-text-dim);font-style:normal;margin-left:4px;font-size:11px}
#cc-xp-tracker .xp-row .r{color:var(--cc-info);font-weight:600;white-space:nowrap;text-align:right}
#cc-xp-tracker .xp-row .share{height:4px;border-radius:2px;background:var(--cc-sunk);overflow:hidden}
#cc-xp-tracker .xp-row .share>i{display:block;height:100%;background:linear-gradient(90deg,color-mix(in srgb,var(--cc-info) 70%,#000),var(--cc-info));border-radius:2px}
#cc-xp-tracker .xp-row .e{color:var(--cc-text-dim);font-size:10.5px;white-space:nowrap;text-align:right}
#cc-xp-tracker .xp-empty{padding:6px 4px;color:var(--cc-text-dim)}
#cc-xp-tracker .xp-foot{display:flex;align-items:center;gap:6px;padding:4px 10px 8px;color:var(--cc-text-dim);font-size:11px}
#cc-xp-tracker .xp-foot .sp{flex:1}
`;
  const UI = window.__ccUI;
  if (!UI) return 'cc xp-tracker: UI kit not loaded';
  // the window (header, drag, collapse, close, resize, position memory) comes from the UI kit; the content below is unchanged
  const P = UI.panel({ id: 'cc-xp-tracker', title: 'XP Tracker', width: 318, closable: true, collapsible: true, resizable: true, chipAlways: true, pos: { x: 12, y: 140 }, legacyPosKey: LS_POS, onClose: () => { setClosed(true); render(); } });
  const el = P.el;

  function insertUi() {
    if (!document.body) return false;
    if (!document.getElementById('cc-xp-style')) document.head.appendChild(style);
    return true;
  }
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const skillImg = (id, cls) => { const i = document.createElement('img'); i.src = '/assets/icons/skills/' + id + '.png'; i.alt = id; if (cls) i.className = cls; i.addEventListener('error', () => { i.style.visibility = 'hidden'; }); return i; };

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

  // Stacked area: every skill's share, biggest at the bottom; skills beyond the 8 biggest are grouped as "Other".
  function drawStack(canvas, per, order, colors, winMs) {
    const W = canvas.clientWidth || 298, H = 120, g = prep(canvas, W, H);
    const padL = 36, padR = 6, padT = 8, padB = 16, pw = W - padL - padR, ph = H - padT - padB;
    const n = per[order[0]].length, totals = new Array(n).fill(0);
    order.forEach(id => per[id].forEach((v, i) => { totals[i] += v; }));
    const max = Math.max(100, ...totals) * 1.1;
    g.font = '10px system-ui,sans-serif'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#7f7f8e'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = padT + ph - (i / 3) * ph; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.textAlign = 'right'; g.fillText(i ? fmtXp(max * i / 3) : '0', padL - 4, y); }
    g.textBaseline = 'alphabetic';
    [[0, fmtDur(winMs / 1000)], [0.5, fmtDur(winMs / 2000)], [1, 'now']].forEach(([f, t]) => { g.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; g.fillText(t, padL + f * pw, H - 3); });
    const x = i => padL + i / (n - 1) * pw, y = v => padT + ph - (v / max) * ph;
    const acc = new Array(n).fill(0);
    order.forEach(id => {
      const top = per[id].map((v, i) => acc[i] + v), bot = acc.slice();
      g.beginPath(); top.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); for (let i = n - 1; i >= 0; i--) g.lineTo(x(i), y(bot[i])); g.closePath();
      g.fillStyle = colors[id] + 'cc'; g.fill();
      g.beginPath(); top.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.strokeStyle = colors[id]; g.lineWidth = 1.2; g.stroke();
      top.forEach((v, i) => { acc[i] = v; });
    });
    canvas._geo = { padL, padR, padT, ph, pw, W, data: totals, max, winMs, per, order };
  }

  function render(auto) {
    insertUi();
    if (!settingOn('xpTrackerEnabled', true) || closed) { P.show(false); return; }   // closed: reopen from the ScapeLite menu
    if (auto === true && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // keep the hours box usable
    if (auto === true && P.body.childNodes.length && el.matches(':hover')) return; // don't rebuild under the cursor (keeps the graph tooltip steady)
    const rateWinMs = frameMs();
    const rows = [];
    let total = 0, sessionGain = 0;
    for (const id of Object.keys(hist)) {
      const r = rateFor(id, rateWinMs);
      const s = latest[id];
      const gained = s ? s.xp - sessionStart[id] : 0;
      sessionGain += Math.max(0, gained);
      let gain = 0; try { const n0 = Date.now(), a0 = xpAt(id, n0 - rateWinMs), b0 = xpAt(id, n0); if (a0 != null && b0 != null) gain = Math.max(0, b0 - a0); } catch (e) {}
      if (r > 0) { total += r; rows.push({ id, r, s, gained, gain }); }
    }
    rows.sort((a, b) => ((mode === 'skills' && metric === 'gained') ? b.gain - a.gain : b.r - a.r));
    if (focus && !hist[focus]) focus = null;
    P.show(true);
    minimized = el.classList.contains('min');
    P.body.textContent = '';

    // ---- header: the kit draws it; the total shows beside the title (also when collapsed) ----
    P.setChip(total > 0 ? fmtXp(total) + ' XP/hr' : '\u2013');
    if (minimized) return;

    // ---- time frame ----
    const fr = h('div', 'xp-frames');
    FRAMES.forEach(([k, label0]) => {
      const label = k === 'custom' ? fmtH(customH) : label0;
      const b = h('button', 'cc-chip' + (k === frameKey ? ' on' : ''), label); b.type = 'button';
      b.title = k === 'all' ? 'Everything since the session counter was last reset' : k === 'custom' ? 'Your own time frame: click to choose the number of hours' : 'Show the last ' + label;
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (k === 'custom') editing = frameKey === 'custom' ? !editing : true; else editing = false;
        frameKey = k; try { localStorage.setItem(LS_FRAME, k); } catch (err) {} render();
      });
      fr.appendChild(b);
    });
    P.body.appendChild(fr);
    if (editing && frameKey === 'custom') {
      const ed = h('div', 'xp-custom');
      const inp = h('input', 'cc-num'); inp.type = 'number'; inp.min = '0.1'; inp.max = '168'; inp.step = '0.5'; inp.value = String(customH);
      const ok = h('button', 'cc-btn sm', 'Set'); ok.type = 'button';
      const apply = () => { const v = parseFloat(inp.value); if (v > 0) { customH = Math.min(168, Math.max(0.1, v)); try { localStorage.setItem(LS_CUSTOM, String(customH)); } catch (err) {} editing = false; render(); } };
      ok.addEventListener('click', e => { e.stopPropagation(); apply(); });
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') apply(); });
      inp.addEventListener('mousedown', e => e.stopPropagation());
      ed.appendChild(h('span', null, 'Show the last')); ed.appendChild(inp); ed.appendChild(h('span', null, 'hours (up to 168)')); ed.appendChild(ok);
      P.body.appendChild(ed);
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (err) {} }, 0);
    }

    // ---- view: total line, or every skill stacked ----
    const vm = h('div', 'xp-frames');
    [['total', 'Total'], ['skills', 'All skills']].forEach(([k, label]) => {
      const b = h('button', 'cc-chip' + (k === mode ? ' on' : ''), label); b.type = 'button'; b.title = k === 'skills' ? 'Every skill as its own colour in one graph' : 'One line: the XP/hr of everything combined (or the skill you click)';
      b.addEventListener('click', e => { e.stopPropagation(); mode = k; try { localStorage.setItem('cc-xp-tracker-mode', k); } catch (err) {} render(); });
      vm.appendChild(b);
    });
    if (mode === 'skills') [['rate', 'XP/hr'], ['gained', 'XP gained']].forEach(([k, label]) => {
      const b = h('button', 'cc-chip' + (k === metric ? ' on' : ''), label); b.type = 'button'; b.title = k === 'gained' ? 'How much XP each skill has gained since the start of the time frame' : 'XP per hour in each part of the time frame';
      b.addEventListener('click', e => { e.stopPropagation(); metric = k; try { localStorage.setItem('cc-xp-tracker-metric', k); } catch (err) {} render(); });
      vm.appendChild(b);
    });
    P.body.appendChild(vm);

    // ---- graph ----
    const wrap = h('div', 'xp-graphwrap');
    const gc = document.createElement('canvas'); gc.className = 'graph'; wrap.appendChild(gc);
    let stack = null;
    if (mode === 'skills') {
      const per = seriesBySkill(frameMs(), 60, metric);
      const ids = Object.keys(per).sort((a, b) => per[b].reduce((x, y) => x + y, 0) - per[a].reduce((x, y) => x + y, 0));
      if (ids.length) {
        const keep = ids.slice(0, 8), rest = ids.slice(8), colors = {}, per2 = {};
        keep.forEach((id, i) => { colors[id] = PALETTE[i]; per2[id] = per[id]; });
        if (rest.length) { colors.other = PALETTE[9]; per2.other = per[rest[0]].map((_, i) => rest.reduce((sum, id) => sum + per[id][i], 0)); }
        const order = keep.concat(rest.length ? ['other'] : []);
        stack = { per: per2, order: order, colors };
        gc.style.height = '120px';
      }
    }
    const tip = h('div', 'xp-tip'); wrap.appendChild(tip);
    P.body.appendChild(wrap);
    const winMs = frameMs();
    const data = series(winMs, 60, focus);
    const color = focus ? '#7fe3ff' : '#5fe06d';
    requestAnimationFrame(() => {
      if (stack) drawStack(gc, stack.per, stack.order, stack.colors, winMs); else drawGraph(gc, data, winMs, color);
      gc.addEventListener('mousemove', ev => {
        const geo = gc._geo; if (!geo) return;
        const r = gc.getBoundingClientRect(), x = ev.clientX - r.left;
        const f = Math.max(0, Math.min(1, (x - geo.padL) / geo.pw)), i = Math.round(f * (geo.data.length - 1));
        const when = i === geo.data.length - 1 ? 'now' : fmtDur((1 - i / (geo.data.length - 1)) * geo.winMs / 1000) + ' ago';
        if (geo.per) { const top = geo.order.map(id => [id, geo.per[id][i]]).filter(e => e[1] > 0).slice(0, 4); tip.textContent = when + ': ' + top.map(e => cap(e[0]) + ' ' + fmtXp(e[1])).join(' · ') + (metric === 'rate' ? ' xp/hr' : ' xp'); }
        else tip.textContent = fmtXp(geo.data[i]) + ' xp/hr · ' + when;
        tip.style.display = 'block';
        tip.style.left = Math.min(r.width - tip.offsetWidth - 2, Math.max(2, x + 8)) + 'px'; tip.style.top = '4px';
      });
      gc.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    });
    const fl = h('div', 'xp-focus');
    if (stack) fl.textContent = (metric === 'gained' ? 'XP gained by each skill in this time frame' : 'Each skill\u2019s XP/hr, stacked') + ' \u00b7 biggest at the bottom';
    else if (focus) { fl.appendChild(document.createTextNode('Graphing ')); fl.appendChild(h('b', null, cap(focus))); fl.appendChild(document.createTextNode(' \u00b7 click it again for the total')); }
    else fl.textContent = 'All skills combined \u00b7 click a skill to graph just that one';
    P.body.appendChild(fl);

    // ---- per-skill rows with icons ----
    const body = h('div', 'xp-rows');
    if (!rows.length) body.appendChild(h('div', 'xp-empty', 'Waiting for XP gains…'));
    const topRate = rows.length ? rows[0].r : 1;
    const byGain = !!stack && metric === 'gained', topV = byGain ? Math.max(1, ...rows.map((x) => x.gain)) : topRate;
    (stack ? rows.slice(0, 14) : rows.slice(0, 6)).forEach(({ id, r, s, gain }) => {
      const row = h('div', 'xp-row' + (focus === id && !stack ? ' sel' : ''));
      if (stack && stack.colors[id]) row.style.boxShadow = 'inset 3px 0 0 ' + stack.colors[id];
      row.appendChild(skillImg(id));
      const n = h('span', 'n', cap(id)); if (s && s.lvl) n.appendChild(h('i', null, 'Lv ' + s.lvl)); row.appendChild(n);
      row.appendChild(h('span', 'r', byGain ? fmtXp(gain) + ' XP' : fmtXp(r) + '/hr'));
      const share = h('div', 'share'); const fill = document.createElement('i'); fill.style.width = Math.max(4, (byGain ? gain : r) / topV * 100) + '%'; share.appendChild(fill); row.appendChild(share);
      row.appendChild(h('span', 'e', s && s.toNext != null ? 'level in ' + fmtDur(s.toNext / r * 3600) : ''));
      row.addEventListener('click', e => { e.stopPropagation(); if (stack) { mode = 'total'; try { localStorage.setItem('cc-xp-tracker-mode', 'total'); } catch (err) {} } focus = focus === id && !stack ? null : id; render(); });
      body.appendChild(row);
    });
    P.body.appendChild(body);

    const foot = h('div', 'xp-foot');
    foot.appendChild(h('span', null, 'Session +' + fmtXp(sessionGain) + ' XP in ' + fmtDur((Date.now() - sessionAt) / 1000)));
    foot.appendChild(h('span', 'sp'));
    const rs = h('button', 'cc-btn sm', 'Reset'); rs.type = 'button';
    rs.title = 'Restart the session counter';
    rs.addEventListener('click', e => { e.stopPropagation(); for (const k of Object.keys(latest)) sessionStart[k] = latest[k].xp; sessionAt = Date.now(); render(); });
    foot.appendChild(rs);
    P.body.appendChild(foot);
  }

  let timerId = null;
  function tick() {
    try { sample(); if (!(document.hidden || window.__ccEcoOn)) render(true); } catch (e) { /* keep running */ }
    timerId = setTimeout(tick, SAMPLE_MS);
  }
  tick();

  function teardown() {
    clearTimeout(timerId); clearInterval(saveTimer); saveHist(); window.removeEventListener('beforeunload', saveHist); P.destroy(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc xp-tracker torn down';
  }
  window[NS] = {
    version: 2, teardown,
    get isOpen() { return !closed && P.isShown() && !el.classList.contains('min'); },
    // from the ScapeLite menu: a closed or minimised tracker opens; an open one closes
    toggle() { if (closed || el.classList.contains('min')) { setClosed(false); el.classList.remove('min'); } else setClosed(true); render(); },
    get rates() { const w = (Number(settingOn('xpTrackerWindowMin', 5)) || 5) * 60000; const o = {}; for (const k of Object.keys(hist)) { const r = rateFor(k, w); if (r > 0) o[k] = Math.round(r); } return o; },
  };
  console.log('[cc] xp-tracker loaded');
  return 'cc xp-tracker loaded';
})();
