// Design Lab specimens: ScapeLite's kept panels and the plugin surfaces (XP Tracker, Goals, Drop Luck, advisors, HP, chat, walking countdown, layout editor,
// tooltips, pinned cards, settings page ...). Every specimen builds the same DOM and class names as the plugin's own builder (read from overlay/<plugin>.js)
// and fills it with the mock data of the scenario. The CSS is the real production CSS harvested at boot. The only CSS written here is a small block of
// lab-only layout helpers (class names starting lsp-) that imitates parts of the GAME's own page (its tooltip, its task widget, its settings sheet ...), which
// are not ScapeLite code and so are not harvested.
(function () {
  'use strict';
  const Lab = window.Lab;
  if (!Lab) return;
  const h = Lab.h;

  // ------------------------------------------------------------------ lab-only helper CSS (imitation of the game's own surfaces, never ScapeLite classes)
  if (!document.getElementById('lab-spec-panels-js')) {
    const st = document.createElement('style'); st.id = 'lab-spec-panels-js';
    st.textContent = `
.lsp-row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
.lsp-col{display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.lsp-note{font:11.5px/1.4 system-ui,sans-serif;color:#8a8aa0;max-width:420px;margin:0}
.lsp-win{position:relative;display:flex;flex-direction:column;background:#14141b;border:1px solid #2c2c3c;border-radius:10px;color:#e8e8f0;font:14px/1.4 system-ui,sans-serif;overflow:hidden}
.lsp-win>.lsp-wh{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#0f0f15;border-bottom:1px solid #26262f;font-size:18px}
.lsp-win>.lsp-wh img{width:30px;height:30px;image-rendering:pixelated;border:1px solid #3f6fb5;border-radius:6px;padding:2px;background:#191a24}
.lsp-win>.lsp-wb{flex:1;min-height:0;padding:10px 14px;position:relative}
.lsp-gtip{display:inline-block;min-width:200px;max-width:340px;padding:9px 12px;border-radius:8px;background:rgba(8,8,12,.96);border:1px solid #3a3a4c;box-shadow:0 8px 24px rgba(0,0,0,.6);color:#e9e9f2;font:14px/1.4 system-ui,sans-serif}
.lsp-gtip .tt-title{font-weight:700;font-size:16px;color:#fff;margin-bottom:3px}
.lsp-gtip .tt-line{display:block;color:#d4d4e0}
.lsp-gtip .tt-line.dim{color:#8b8b9c}
.lsp-gtip .tt-bar{height:8px;border-radius:4px;background:#262633;overflow:hidden;margin:4px 0}
.lsp-gtip .tt-bar i{display:block;height:100%}
.lsp-float{width:340px;border-radius:8px;overflow:hidden;background:rgba(10,10,14,.92);border:1px solid rgba(255,255,255,.14);color:#f0f0f6;font:14px/1.3 system-ui,sans-serif}
.lsp-float .tb{display:flex;align-items:center;height:22px;padding:0 8px;font-size:12px;color:#ccc;border-bottom:1px solid rgba(255,255,255,.08)}
.lsp-float .float-task-inner{display:flex;gap:10px;padding:8px 10px 8px}
.lsp-float .float-icon{width:54px;height:54px;flex:none;border:2px solid #3f6fb5;border-radius:6px;background:#12121a;display:grid;place-items:center}
.lsp-float .float-icon img{width:36px;height:36px;image-rendering:pixelated}
.lsp-float .float-details{flex:1;min-width:0}
.lsp-float .float-task-name{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lsp-float .float-task-node{font-size:13px;color:#8d8da0;margin-bottom:3px}
.lsp-float .float-bar{position:relative;height:17px;margin-top:3px;border-radius:3px;background:#0a0a0f;overflow:hidden}
.lsp-float .float-bar-fill{position:absolute;left:0;top:0;bottom:0}
.lsp-float .float-bar-fill.task-fill{background:#d9792a}
.lsp-float .float-bar-fill.level-fill{background:#2f7fd0}
.lsp-float .float-bar-text{position:absolute;inset:0;display:flex;justify-content:space-between;align-items:center;padding:0 6px;font-size:12.5px;text-shadow:0 0 3px #000}
.lsp-float .float-bar-text .bar-center{position:absolute;left:0;right:0;text-align:center}
.lsp-xpbar{position:relative;height:30px;border-radius:3px;background:#101014;border:1px solid #26262e;overflow:hidden}
.lsp-xpbar .fill{position:absolute;left:0;top:0;bottom:0;background:#2f6a2f}
.lsp-xpbar .lbl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#e8f0e8;text-shadow:0 0 4px #000}
.lsp-cbars{width:380px;padding:10px 14px 12px;border-radius:10px;background:rgba(14,14,20,.88);border:1px solid rgba(255,255,255,.14);color:#dcdce8;font:13px/1.3 system-ui,sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:6px 22px}
.lsp-cbars h6{margin:0 0 2px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#aab}
.lsp-cbars .nm{color:#b8b8d0}
.lsp-cb{position:relative;height:19px;border-radius:7px;background:rgba(255,255,255,.07);overflow:hidden;margin:3px 0}
.lsp-cb i{position:absolute;left:0;top:0;bottom:0;display:block;border-radius:7px}
.lsp-cb b{position:absolute;inset:0;display:grid;place-items:center;font:700 12.5px/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 2px #000}
.lsp-cbars .sm{color:#8d8da0;font-size:12.5px}
.lsp-cbars .sm b{color:#ffe27a;font-size:14px}
.lsp-bank{display:grid;grid-template-columns:repeat(5,52px);gap:2px 6px;width:340px;padding:8px 10px;background:#0f0f15;border:1px solid #26262f;border-radius:8px}
.lsp-bank .bank-slot{position:relative;width:52px;height:52px;display:flex;align-items:center;justify-content:center;border-radius:6px}
.lsp-bank .bank-slot img{width:34px;height:34px;image-rendering:pixelated}
.lsp-bank .bank-slot b{position:absolute;left:2px;top:0;font:12px/1 system-ui,sans-serif;color:#fff;text-shadow:0 0 3px #000}
.lsp-bank .bank-slot i{position:absolute;left:2px;bottom:0;font:normal 12px/1 system-ui,sans-serif;color:#d0d0dc;text-shadow:0 0 3px #000}
.lsp-btnrow{display:flex;gap:4px;padding:6px 10px;background:#0f0f15;border-bottom:1px solid #26262f;flex-wrap:wrap}
.lsp-btnrow button,.lsp-btnrow .bank-filter-btn{height:30px;padding:0 12px;border-radius:3px;border:1px solid #2a2a38;background:#141418;color:#aaa;font:13px system-ui,sans-serif}
.lsp-btnrow .bank-filter-btn.cc-sub-on{border-color:#4a90e2;color:#fff}
.lsp-set{width:640px;max-width:100%;color:#dcdce8;font:14px/1.4 system-ui,sans-serif}
.lsp-set .settings-section{background:#14141b;border:1px solid #2a2a38;border-radius:10px;padding:0 0 6px;margin:8px 0}
.lsp-set .settings-section-header{padding:12px 16px;font-size:18px;font-weight:700;border-bottom:1px solid #26262f}
.lsp-set .settings-toggle-row{display:flex;align-items:center;gap:14px;padding:9px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.lsp-set .settings-toggle-text{flex:1;min-width:0}
.lsp-set .settings-toggle-label{font-size:14.5px;color:#f0f0f6}
.lsp-set .settings-toggle-desc{font-size:12.5px;color:#8d8da0;margin-top:1px}
.lsp-set .settings-switch{position:relative;flex:none;width:44px;height:22px;border-radius:11px;background:#2c2c3a;cursor:pointer}
.lsp-set .settings-switch.on{background:#2f6bd0}
.lsp-set .settings-switch-knob{position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#aab;transition:left .15s}
.lsp-set .settings-switch.on .settings-switch-knob{left:25px;background:#fff}
.lsp-set .settings-nav-btn{background:none;border:0;color:#9a9ab0;font:inherit;padding:6px 12px;border-radius:6px}
.lsp-set .settings-nav-btn.on{background:#1d2a44;color:#fff}
.lsp-set .settings-header-nav{display:flex;gap:4px;margin-bottom:6px}
.lsp-rdps{width:300px;border-radius:8px;background:rgba(12,12,18,.92);border:1px solid rgba(255,255,255,.14);color:#e8e8f0;font:13px/1.35 system-ui,sans-serif;position:relative}
.lsp-rdps .raid-contrib-progress{display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08)}
.lsp-rdps .raid-contrib-tabs{display:flex;gap:3px;padding:4px 6px 0}
.lsp-rdps .raid-contrib-tab{flex:1;padding:5px 2px;text-align:center;border-radius:5px 5px 0 0;background:#1a1a24;color:#9a9ab0;border:1px solid #2a2a38;font:inherit;font-size:12px;cursor:pointer}
.lsp-rdps .raid-contrib-tab.active{background:#2a2a3a;color:#fff;border-bottom-color:#2a2a3a}
.lsp-rdps .raid-contrib-dps{padding:6px 8px}
.lsp-rdps .raid-contrib-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:3px 4px;border-radius:5px}
.lsp-rdps .raid-contrib-row.is-self{background:rgba(255,255,255,.06)}
.lsp-rdps .raid-contrib-bar{grid-column:1/-1;height:4px;border-radius:2px;background:#262633;overflow:hidden}
.lsp-rdps .raid-contrib-bar i{display:block;height:100%}
.lsp-grp{display:flex;gap:2px;padding:3px 4px 0;background:var(--cc-bg);border:1px solid var(--cc-border);border-bottom:0;border-radius:10px 10px 0 0;font:13px/1.2 system-ui,sans-serif;width:max-content}
.lsp-stage{position:relative;overflow:hidden;background:linear-gradient(#1c2733,#141b24)}
`;
    document.head.appendChild(st);
  }
  // CSS a plugin only injects when its panel first opens (so the harvest cannot see it): read the same string out of the plugin's own source, not a copy.
  (function srcStyle(file, id, re) {
    try {
      if (document.getElementById(id)) return;
      const x = new XMLHttpRequest(); x.open('GET', '../overlay/' + file, false); x.send(null);
      const m = x.status < 400 && re.exec(x.responseText); if (!m) return;
      const css = (0, eval)("'" + m[1] + "'");
      const st = document.createElement('style'); st.id = id; st.dataset.labSrc = file; st.textContent = css; document.head.appendChild(st);
    } catch (e) { /* the lab still works, the group head is just unstyled */ }
  })('plugins-settings-ui.js', 'cc-plugin-ui-style', /st\.id = 'cc-plugin-ui-style';\s*st\.textContent = '((?:[^'\\]|\\.)*)'/);

  // ------------------------------------------------------------------ helpers
  const num = Lab.num, cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const kxp = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : num(n));
  const fdur = (s) => { s = Math.round(s); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
  const fhr = (hr) => { if (!isFinite(hr)) return '–'; const m = hr * 60; return m < 1 ? '<1 min' : m < 90 ? Math.round(m) + ' min' : hr < 48 ? hr.toFixed(hr < 10 ? 1 : 0) + ' h' : (hr / 24).toFixed(hr < 240 ? 1 : 0) + ' days'; };
  const img = (path, cls, fb) => {
    const i = h('img' + (cls ? '.' + cls : ''), { src: Lab.iconBase + path, alt: '', draggable: 'false' });
    i.addEventListener('error', () => { if (fb && !i._fb) { i._fb = 1; i.src = Lab.iconBase + fb; } else i.style.visibility = 'hidden'; });
    return i;
  };
  const skImg = (id, cls, fb) => img('/skills/' + id + '.png', cls, fb);
  const itImg = (id, cls) => img('/items/' + id + '.png', cls);
  const bySkill = (M) => { const o = {}; M.skills.forEach((s) => { o[s.id] = s; }); return o; };
  const hpTone = (M) => { const f = M.hp / M.hpMax; return f >= 0.5 ? 'good' : f >= 0.25 ? 'warn' : 'bad'; };
  const hpCol = (M) => 'var(--cc-' + hpTone(M) + ',#5fe06d)';
  const CATS_OK = new Set(Lab.CATS);
  const add = (spec) => Lab.add(spec);
  const tinyNote = (t) => h('p.lsp-note', null, t);
  const mono = (n) => h('code', { style: { font: '11px ui-monospace,Consolas,monospace', color: '#8a8aa0' } }, n);

  // the skills a scenario is training, with believable XP rates that add up to the scenario's XP/hr
  function trained(ctx) {
    const { S, M } = ctx, by = bySkill(M);
    const ids = S.mode === 'combat' || S.mode === 'dungeon' ? ['strike', 'slay', 'life', 'defend', 'dodge', 'spirit'] : S.mode === 'fortress' ? ['fortify', 'mine', 'forage', 'craft', 'vigor', 'smith'] : ['farm', 'mine', 'vigor', 'brew', 'forage', 'smith'];
    const wt = [0.31, 0.24, 0.17, 0.12, 0.09, 0.07], mult = S.mode === 'dungeon' ? 1.4 : S.mode === 'combat' ? 1.15 : 1;
    return ids.map((id, i) => { const s = by[id]; return { id, lvl: s.lvl, frac: s.frac, rate: Math.round(M.xpHr * mult * wt[i] / 10) * 10, toNext: Math.round((1 - s.frac) * (s.lvl * s.lvl * 7 + 300)), xp: s.xp }; });
  }

  // a kit panel (what UI.panel() builds): header with title, chip, optional gear, collapse and close; optional row between header and body; body
  function kitPanel(o, ...kids) {
    const hd = h('div.hd', null, h('b', null, o.title), h('span.chiptxt', null, o.chip == null ? '' : o.chip));
    if (o.gear) hd.appendChild(h('button.cc-ib.cc-gear', { type: 'button', title: 'Settings', 'aria-label': o.title + ' settings' }, '⚙'));
    if (o.collapsible !== false) hd.appendChild(h('button.min', { type: 'button', title: o.min ? 'Expand' : 'Collapse' }, o.min ? '+' : '–'));
    if (o.closable !== false) hd.appendChild(h('button.x', { type: 'button', title: 'Close', 'aria-label': 'Close ' + o.title }, '×'));
    const bd = h('div.bd', o.bdAttrs || null, kids);
    const st = {}; if (o.w) st.width = o.w + 'px'; if (o.hgt) st.height = o.hgt; if (o.style) Object.assign(st, o.style);
    const el = h('div.cc-panel.show', { id: o.id, 'data-cc-panel': '1', role: 'dialog', 'aria-label': o.title, style: st }, hd, o.between || null, bd);
    if (o.min) el.classList.add('min');
    if (o.chipAlways) el.classList.add('chip-always');
    (o.cls || '').split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
    el._bd = bd; el._hd = hd;
    return el;
  }
  // a tab row in the kit's own look (.cc-tabs > .cc-tab)
  const kitTabs = (labels, on, cls) => h('div' + (cls ? '.' + cls : '') + '.cc-tabs', { role: 'tablist' }, labels.map((l, i) => h('button.cc-tab', { type: 'button', role: 'tab', 'aria-selected': String(i === on), style: { flex: '1' } }, l)));
  // deterministic wiggly series for graphs
  const wave = (n, base, seed, rise) => Array.from({ length: n }, (_, i) => Math.max(0, base * (0.72 + 0.26 * Math.sin(i / 5 + seed) + 0.14 * Math.sin(i / 2.1 + seed * 2.3) + (rise ? (i / n) * 0.18 : 0))));


  // =================================================================== XP Tracker (xp-tracker.js)
  const XP_PALETTE = ['#5fe06d', '#4ea3ff', '#ffb84a', '#ff6f91', '#b48cff', '#3fd8c8', '#e8e05a', '#ff8a4a', '#8fd0ff', '#c0c4cc'];
  function xpCanvas(w, hgt) { const c = h('canvas.graph'), dpr = window.devicePixelRatio || 1; c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, g }; }
  function xpAxes(g, W, H, max, winLabel) {
    const padL = 36, padR = 6, padT = 8, padB = 16, pw = W - padL - padR, ph = H - padT - padB;
    g.font = '10px system-ui,sans-serif'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#7f7f8e'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = padT + ph - (i / 3) * ph; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.textAlign = 'right'; g.fillText(i ? kxp(max * i / 3) : '0', padL - 4, y); }
    g.textBaseline = 'alphabetic';
    [[0, winLabel], [0.5, winLabel === '15m' ? '7m' : '1h'], [1, 'now']].forEach(([f, t]) => { g.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; g.fillText(t, padL + f * pw, H - 3); });
    return { padL, padT, pw, ph };
  }
  function xpLineGraph(w, data, color) {
    const W = w, H = 96, { c, g } = xpCanvas(W, H), max = Math.max(100, ...data) * 1.12, a = xpAxes(g, W, H, max, '15m');
    const pts = data.map((v, i) => [a.padL + i / (data.length - 1) * a.pw, a.padT + a.ph - (v / max) * a.ph]);
    const grad = g.createLinearGradient(0, a.padT, 0, a.padT + a.ph); grad.addColorStop(0, color + 'aa'); grad.addColorStop(1, color + '08');
    g.beginPath(); g.moveTo(pts[0][0], a.padT + a.ph); pts.forEach((p) => g.lineTo(p[0], p[1])); g.lineTo(pts[pts.length - 1][0], a.padT + a.ph); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    const lp = pts[pts.length - 1]; g.beginPath(); g.arc(lp[0], lp[1], 3, 0, 7); g.fillStyle = '#fff'; g.fill();
    return c;
  }
  function xpStackGraph(w, per, order) {
    const W = w, H = 120, { c, g } = xpCanvas(W, H), n = per[order[0]].length, totals = new Array(n).fill(0);
    order.forEach((id) => per[id].forEach((v, i) => { totals[i] += v; }));
    const max = Math.max(100, ...totals) * 1.1, a = xpAxes(g, W, H, max, '15m');
    const x = (i) => a.padL + i / (n - 1) * a.pw, y = (v) => a.padT + a.ph - (v / max) * a.ph, acc = new Array(n).fill(0);
    order.forEach((id, k) => {
      const col = XP_PALETTE[k], top = per[id].map((v, i) => acc[i] + v), bot = acc.slice();
      g.beginPath(); top.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); for (let i = n - 1; i >= 0; i--) g.lineTo(x(i), y(bot[i])); g.closePath(); g.fillStyle = col + 'cc'; g.fill();
      g.beginPath(); top.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
      top.forEach((v, i) => { acc[i] = v; });
    });
    c.style.height = '120px';
    return c;
  }
  const chipRow = (labels, on) => h('div.xp-frames', null, labels.map((l, i) => h('button.cc-chip' + (i === on ? '.on' : ''), { type: 'button' }, l)));
  add({
    id: 'xp-tracker', cat: 'Panels', title: 'XP Tracker', desc: 'XP per hour for everything you train: time-frame chips, a live graph, per-skill rows with level-up ETAs and a session total. Folds into a chip that shows the total.',
    keywords: 'xp per hour rate graph skills session sparkline total stacked all skills', covers: [],
    variants: [{ label: 'Panel, total graph', w: 318, id: 'total' }, { label: 'Panel, All skills stacked', w: 318, id: 'skills' }, { label: 'Panel, custom hours', w: 318, id: 'custom' }, { label: 'Panel, waiting for XP', w: 318, id: 'empty' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      const rows = trained(ctx), total = rows.reduce((t, r) => t + r.rate, 0), empty = v.id === 'empty';
      const chip = empty ? '–' : kxp(total) + ' XP/hr';
      if (v.id === 'chip') return kitPanel({ id: 'cc-xp-tracker', title: 'XP Tracker', chip, min: true, chipAlways: true });
      const mode = v.id === 'skills' ? 'skills' : 'total', frame = v.id === 'custom' ? 4 : 1;
      const kids = [chipRow(['5 m', '15 m', '30 m', '1 h', v.id === 'custom' ? '6 h' : '6 h', 'Session'], frame)];
      if (v.id === 'custom') kids.push(h('div.xp-custom', null, h('span', null, 'Show the last'), h('input.cc-num', { type: 'number', value: '6', min: '0.1', max: '168', step: '0.5' }), h('span', null, 'hours (up to 168)'), h('button.cc-btn.sm', { type: 'button' }, 'Set')));
      kids.push(h('div.xp-frames', null, [['Total', mode === 'total'], ['All skills', mode === 'skills']].concat(mode === 'skills' ? [['XP/hr', true], ['XP gained', false]] : []).map(([l, on]) => h('button.cc-chip' + (on ? '.on' : ''), { type: 'button' }, l))));
      const wrap = h('div.xp-graphwrap'), gw = (v.w || 318) - 38;
      if (empty) wrap.appendChild(xpLineGraph(gw, new Array(30).fill(0), '#5fe06d'));
      else if (mode === 'skills') {
        const per = {}; rows.forEach((r, i) => { per[r.id] = wave(60, r.rate, i * 1.7, true); });
        wrap.appendChild(xpStackGraph(gw, per, rows.map((r) => r.id)));
      } else wrap.appendChild(xpLineGraph(gw, wave(60, total, 0.6, true), '#5fe06d'));
      kids.push(wrap);
      kids.push(h('div.xp-focus', null, mode === 'skills' ? 'Each skill’s XP/hr, stacked · biggest at the bottom' : 'All skills combined · click a skill to graph just that one'));
      const list = h('div.xp-rows');
      if (empty) list.appendChild(h('div.xp-empty', null, 'Waiting for XP gains…'));
      rows.slice(0, 6).forEach((r, i) => {
        const row = h('div.xp-row' + (i === 1 && mode === 'total' ? '.sel' : ''));
        if (mode === 'skills') row.style.boxShadow = 'inset 3px 0 0 ' + XP_PALETTE[i];
        const n = h('span.n', null, cap(r.id), h('i', null, 'Lv ' + r.lvl));
        row.append(skImg(r.id), n, h('span.r', null, kxp(r.rate) + '/hr'), h('div.share', null, h('i', { style: { width: Math.max(4, r.rate / rows[0].rate * 100) + '%' } })), h('span.e', null, 'level in ' + fdur(r.toNext / r.rate * 3600)));
        list.appendChild(row);
      });
      kids.push(list);
      kids.push(h('div.xp-foot', null, h('span', null, empty ? 'Session +0 XP in 0s' : 'Session +' + kxp(total * 0.63) + ' XP in 38m'), h('span.sp'), h('button.cc-btn.sm', { type: 'button' }, 'Reset')));
      return kitPanel({ id: 'cc-xp-tracker', title: 'XP Tracker', chip, chipAlways: true, w: v.w || 318 }, kids);
    },
  });

  // =================================================================== Goals (goals.js)
  const goalRow = (sk, lvl, target, left, rate, hr, pct, tone, pin, done) => {
    const r = h('div.cc-row.nolf', pin ? { 'data-tone': 'accent' } : null);
    r.appendChild(h('div.ti', null, cap(sk), h('i', null, lvl + ' → ' + target)));
    r.appendChild(h('div.su', null, done ? 'Reached' : num(left) + ' XP left' + (rate > 0 ? ' at ' + num(rate) + ' XP/hr' : ' · not training right now')));
    r.appendChild(h('div.mt', null, h('b', { 'data-tone': tone, style: { color: 'var(--t)' } }, done ? '✔' : fhr(hr))));
    r.appendChild(h('span.pr', null, h('span.cc-prog.thin', { style: { '--p': Math.round(pct * 100) + '%' } }, h('i'))));
    if (pin) r.appendChild(h('button.ac', { title: 'Remove this goal' }, '×'));
    return r;
  };
  const huntRow = (name, mob, kind, n, kills, p1, hrs, pin) => {
    const r = h('div.cc-row.nolf', pin ? { 'data-tone': 'accent' } : null);
    r.appendChild(h('div.ti', null, name, h('i', null, '· ' + mob)));
    r.appendChild(h('div.su', null, kind + ' · 1 in ' + num(n) + ' kills · ' + num(kills) + ' so far · ' + p1 + '% per hour of killing'));
    r.appendChild(h('div.mt', null, h('b', { 'data-tone': hrs > 24 ? 'bad' : 'good', style: { color: 'var(--t)' } }, fhr(hrs))));
    r.appendChild(h('button.ac', { title: pin ? 'Unpin' : 'Pin this hunt' }, pin ? '×' : '☆'));
    return r;
  };
  add({
    id: 'goals', cat: 'Panels', title: 'Goals', desc: 'What you are working towards and how long it takes at your real pace: skill goals, pets, item hunts, and your pinned targets on top.',
    keywords: 'goal pin eta hunt pets level milestone', covers: [],
    variants: [{ label: 'Panel, training', w: 420, id: 'full' }, { label: 'Panel, nothing trained yet', w: 420, id: 'empty' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      const { M } = ctx, rows = trained(ctx);
      const g0 = rows[0], chip = g0 ? cap(g0.id) + ' ' + g0.lvl + ' → ' + (g0.lvl + 1) + ' · ' + fdur(g0.toNext / g0.rate * 3600) : '';
      if (v.id === 'chip') return kitPanel({ id: 'cc-goals', title: 'Goals', chip, min: true });
      const kids = [];
      if (v.id === 'empty') {
        kids.push(h('div.cc-sec', null, 'Skills you are training'), h('div.cc-hint', null, 'Train a skill for a minute: the goals use your real XP per hour from the XP Tracker.'));
        kids.push(h('div.cc-sec', null, 'Item hunts worth a look'), h('div.cc-hint', null, 'No unlock drops left on mobs you can fight.'));
      } else {
        kids.push(h('div.cc-sec', null, 'Pinned'));
        kids.push(goalRow('mine', 71, 75, 41200, rows[1].rate, 41200 / rows[1].rate, 0.46, 'good', true, false));
        kids.push(huntRow('Dustclaw Hatchet', 'Dustclaw Raider', 'Tool (Mine), you train it', 800, 612, 0.4, 20, true));
        kids.push(h('div.cc-sec', null, 'Skills you are training'));
        rows.slice(0, 3).forEach((r) => {
          const left = r.toNext, hr = left / r.rate, mile = Math.ceil((r.lvl + 1) / 5) * 5;
          kids.push(goalRow(r.id, r.lvl, r.lvl + 1, left, r.rate, hr, r.frac, hr <= 24 ? 'good' : 'bad', false, false));
          if (mile > r.lvl + 1) { const l2 = left + (mile - r.lvl - 1) * (r.lvl * r.lvl * 7 + 300); kids.push(goalRow(r.id, r.lvl, mile, l2, r.rate, l2 / r.rate, r.frac * 0.6, l2 / r.rate <= 24 ? 'good' : 'bad', false, false)); }
        });
        kids.push(h('div.cc-sec', null, 'Pets (expected time)'));
        [['Farm pet', 10e6, rows[0].rate, 10e6 / rows[0].rate], ['All-Skills pet', 100e6, M.xpHr, 100e6 / M.xpHr]].forEach(([n, div, rate, hrs]) => {
          const r = h('div.cc-row.nolf'); r.append(h('div.ti', null, n), h('div.su', null, '1 in ' + num(div) + ' XP · at ' + num(rate) + ' XP/hr'), h('div.mt', null, h('b', { 'data-tone': hrs > 24 ? 'bad' : 'good', style: { color: 'var(--t)' } }, fhr(hrs)))); kids.push(r);
        });
        kids.push(h('div.cc-sec', null, 'Item hunts worth a look'));
        kids.push(huntRow('Chitin Pickaxe', 'Dustclaw Raider', 'Tool (Mine), you train it', 1200, 612, 0.3, 30, false), huntRow('Ember Charm', 'Cinder Imp', 'Unlock', 600, 140, 0.8, 11, false));
        kids.push(h('div.cc-hint', null, 'Hunt times assume you fight only that mob. Tools for skills you train come first.'));
      }
      kids.push(h('div.cc-sec', null, 'Add a skill goal'));
      kids.push(h('div.cc-chips', null, h('select.cc-sel', null, h('option', null, 'Barter')), h('input.cc-num', { type: 'number', placeholder: 'Level' }), h('button.cc-btn', { type: 'button', 'data-v': 'primary' }, 'Add')));
      return kitPanel({ id: 'cc-goals', title: 'Goals', chip: '', w: 420, hgt: 'min(560px,74vh)' }, kids);
    },
  });

  // =================================================================== HP panel (hp-panel.js)
  function hpPanel(M, o) {
    const f = Math.max(0, Math.min(1, M.hp / M.hpMax)), st = o.st || 'bar';
    const bd = h('div.bd', { style: {} });
    bd.append(
      h('span.ic', { 'aria-hidden': 'true', style: o.icon === false ? { display: 'none' } : null }, '❤️'),
      h('div.bar', { role: 'progressbar', 'aria-label': 'Hit points', 'aria-valuenow': String(M.hp), 'aria-valuemax': String(M.hpMax) }, h('i', { style: { width: (f * 100).toFixed(1) + '%' } }), h('b', null, o.text === false ? '' : M.hp + ' / ' + M.hpMax)),
      h('span.num', null, M.hp + ' / ' + M.hpMax));
    const el = h('div.cc-panel.show', { id: 'cc-hp', 'data-cc-panel': '1', 'data-st': st, role: 'dialog', 'aria-label': 'Hit points', style: { '--hpc': hpCol(M), width: st === 'bar' ? (o.w || 200) + 'px' : '' } }, h('div.hd', null, h('b', null, 'Hit points'), h('span.chiptxt'), h('button.min', null, '–'), h('button.x', null, '×')), bd);
    return el;
  }
  add({
    id: 'hp-panel', cat: 'Panels', title: 'HP Panel', desc: 'Your hit points in a panel of its own: a bar with numbers, or just a heart and numbers. The colour follows your HP (green above half, amber under half, red under a quarter). Reads the scenario’s HP.',
    keywords: 'hit points health heart bar numbers low hp critical', covers: [],
    variants: [{ label: 'Bar (scenario HP)', id: 'bar' }, { label: 'Bar, wide', id: 'wide' }, { label: 'Bar, no numbers or icon', id: 'plain' }, { label: 'Numbers with an icon', id: 'num' }, { label: 'Healthy', id: 'good' }, { label: 'Low', id: 'low' }, { label: 'Critical', id: 'crit' }],
    render(ctx, v) {
      const M = Object.assign({}, ctx.M), mk = (hp) => Object.assign({}, M, { hp });
      if (v.id === 'good') return hpPanel(mk(Math.round(M.hpMax * 0.88)), {});
      if (v.id === 'low') return hpPanel(mk(Math.round(M.hpMax * 0.3)), {});
      if (v.id === 'crit') return hpPanel(mk(Math.round(M.hpMax * 0.09)), {});
      if (v.id === 'wide') return hpPanel(M, { w: 340 });
      if (v.id === 'plain') return hpPanel(M, { text: false, icon: false });
      if (v.id === 'num') return hpPanel(M, { st: 'numbers' });
      return hpPanel(M, {});
    },
  });

  // =================================================================== Material Shortage (material-shortage.js)
  add({
    id: 'material-shortage', cat: 'Panels', title: 'Material Shortage', desc: 'Appears only when the running task or a queued one will probably run out of materials: red = expect to run out, yellow = enough only if the material-save luck comes in.',
    keywords: 'materials warning scrap short risky queue slot', covers: [],
    variants: [{ label: 'Panel, red and yellow rows', w: 300, id: 'both' }, { label: 'Panel, one red row', w: 300, id: 'red' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      const rows = [{ red: true, w: 'Queue slot 3', a: 'Unf Swift Potion', rem: 83, miss: 12, inp: 'Moss', have: 58, need: 70, exp: 66, pct: 10, scrap: 'Scrap' }, { red: false, w: 'Current task', a: 'Mithril Bar', rem: 40, miss: 0, inp: 'Mithril Ore', have: 80, need: 80, exp: 76, pct: 5 }, { red: false, w: 'Queue slot 6', a: 'Calm Potion', rem: 70, miss: 0, inp: 'Calm Leaf', have: 70, need: 70, exp: 66, pct: 6 }];
      const use = v.id === 'red' ? rows.slice(0, 1) : rows;
      const chip = use.filter((e) => e.red).length + ' short' + (use.some((e) => !e.red) ? ', ' + use.filter((e) => !e.red).length + ' risky' : '');
      if (v.id === 'chip') return kitPanel({ id: 'cc-matshort', title: 'Materials', chip, min: true, closable: false });
      const kids = use.map((e) => h('div.cc-row.nolf', { 'data-tone': e.red ? 'bad' : 'warn' },
        h('div.ti', null, e.w + ': ' + e.a, h('i', null, '(' + e.rem + ')')),
        h('div.su', null, e.red ? ['Short by about ', h('b', null, String(e.miss)), ' ' + e.inp] : 'Needs some luck on saves: ' + e.inp),
        h('div.su', null, 'Have ' + e.have + ' · needs ' + e.need + ' without saves, ~' + e.exp + ' counting ' + e.pct + '% saved' + (e.red && e.scrap ? ' · ' + e.scrap + ' would be used' : ''))));
      return kitPanel({ id: 'cc-matshort', title: 'Materials', chip: '', w: 300, closable: false }, kids);
    },
  });

  // =================================================================== Drop Luck Tracker (drop-luck.js)
  const DL_TABS = ['Overview', 'Luck', 'Mobs', 'Raids', 'Unlocks', 'Pets', 'Fortress'];
  const DL_MOBS = [
    { name: 'Dustclaw Raider', kills: 1240, drops: [{ n: 'Dustclaw Hatchet', N: 800, unlock: 1, got: 0 }, { n: 'Chitin Plate', N: 400, got: 1 }, { n: 'Raider Banner', N: 2500, got: 0 }] },
    { name: 'Cinder Imp', kills: 640, drops: [{ n: 'Ember Charm', N: 600, unlock: 1, got: 1 }, { n: 'Imp Horn', N: 150, got: 1 }, { n: 'Smoking Ring', N: 3000, got: 0 }] },
    { name: 'Frostfang Wolf', kills: 3100, drops: [{ n: 'Frost Pelt', N: 200, got: 1 }, { n: 'Wolf Fang Ring', N: 5000, unlock: 1, got: 0 }, { n: 'Pale Claw', N: 900, got: 1 }] },
    { name: 'Mudback Toad', kills: 410, drops: [{ n: 'Toad Idol', N: 1500, got: 0 }, { n: 'Slime Vial', N: 90, got: 1 }] },
  ];
  const dlDry = (n, k) => Math.pow(1 - 1 / n, k);
  const dlPct = (p) => (p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p >= 0.0001 ? (p * 100).toFixed(2) : '<0.01') + '%';
  const dlVerdict = (p) => (p >= 0.95 ? ['Very lucky', 'good'] : p >= 0.75 ? ['Lucky', 'good'] : p >= 0.25 ? ['About average', 'mid'] : p >= 0.08 ? ['A bit unlucky', 'mid'] : p >= 0.02 ? ['Unlucky', 'bad'] : ['Very unlucky', 'bad']);
  const dlRowCls = (q) => (q < 0.01 ? 'r' : q < 0.05 ? 'o' : q < 0.25 ? 'y' : '');
  const dlColour = (f) => (f >= 1 ? '#4ade80' : f >= 0.67 ? '#a3e048' : f >= 0.34 ? '#ffd24a' : f > 0 ? '#ff9a3c' : '#ff5a4d');
  function dlHero(pctl, got, exp, basisLabel, basisNum, unit, subTxt) {
    const [v, c] = dlVerdict(pctl), s = h('div.hero');
    s.appendChild(h('div.v.' + c, null, v));
    s.appendChild(h('div.p', null, subTxt || 'Luckier than about ' + Math.round(pctl * 100) + '% of players with the same ' + basisLabel + (exp > 0 ? ' · ' + Math.round(got / exp * 100) + '% of the expected ' + unit : '')));
    s.appendChild(h('div.meter', null, h('i', { style: { left: Math.max(1, Math.min(99, pctl * 100)) + '%' } })));
    s.appendChild(h('div.ends', null, h('span', null, 'unluckiest'), h('span', null, 'luckiest')));
    s.appendChild(h('div.stats', null, [[got, unit + ' obtained'], [exp.toFixed(1), 'expected'], [num(basisNum), basisLabel]].map(([b, t]) => h('div', null, h('b', null, String(b)), h('span', null, t)))));
    return s;
  }
  const dlDropRow = (m, x) => {
    const q = dlDry(x.N, m.kills), r = h('div.row.' + (x.got ? 'g' : dlRowCls(q) || 'x'));
    if (!r.className.split(' ').includes('x') === false) r.classList.remove('x');
    const t = h('div.t');
    if (!x.got) t.appendChild(h('span.dry.' + (q < 0.05 ? 'bad' : q < 0.25 ? 'mid' : 'z'), null, dlPct(q) + ' dry'));
    t.appendChild(document.createTextNode(x.n + (x.unlock ? ' ★' : ''))); t.appendChild(h('em', null, ' · ' + m.name));
    r.appendChild(t);
    r.appendChild(h('div.s', null, '1 in ' + num(x.N) + ' · ' + num(m.kills) + ' kills (' + (m.kills / x.N).toFixed(1) + '× expected)' + (x.got ? ' · got it' : '')));
    if (!x.got) { const got = m.drops.filter((d) => d.got).length, exp = m.drops.reduce((t2, d) => t2 + 1 - dlDry(d.N, m.kills), 0), ok = got >= exp * 0.9; r.appendChild(h('div.s' + (ok ? '.good' : ''), null, m.name + ': ' + got + ' of ' + m.drops.length + ' drops, ' + exp.toFixed(1) + ' expected' + (ok ? ' · this mob is on rate' : ''))); }
    return r;
  };
  const dlMini = (key, p, act, exp) => {
    const [v, cls] = dlVerdict(p), r = h('div.row.mini', { style: { cursor: 'pointer' } });
    r.appendChild(h('div.t', null, h('span.dry.' + cls, null, v), key));
    r.appendChild(h('div.meter.sm', null, h('i', { style: { left: Math.max(1, Math.min(99, p * 100)) + '%' } })));
    r.appendChild(h('div.s', null, act + ' obtained · ' + exp.toFixed(1) + ' expected · luckier than ' + Math.round(p * 100) + '% of players'));
    return r;
  };
  const dlLine = (ok, txt) => h('div.d', null, h('span.mk.' + (ok ? 'ok' : 'no'), null, ok ? '✔' : '✘'), ' ' + txt);
  function dlMobDetails(mobs, openFirst) {
    const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    mobs.forEach((m, i) => {
      const got = m.drops.filter((x) => x.got).length, frac = got / m.drops.length, exp = m.drops.reduce((t, x) => t + 1 - dlDry(x.N, m.kills), 0), c = dlColour(frac);
      const det = h('details', { style: { borderColor: c, boxShadow: frac >= 1 ? '0 0 8px ' + c + '55' : null } });
      if (openFirst && i === 0) det.open = true;
      det.appendChild(h('summary', null, h('span.n', null, m.name), h('span.c', null, num(m.kills) + ' kills · ' + got + '/' + m.drops.length + ' (exp ' + exp.toFixed(1) + ')')));
      det.appendChild(h('div.pbar', null, h('i', { style: { width: Math.round(frac * 100) + '%', background: c } })));
      m.drops.slice().sort((p, q) => (!!p.got - !!q.got) || dlDry(p.N, m.kills) - dlDry(q.N, m.kills)).forEach((x) => det.appendChild(dlLine(!!x.got, x.n + (x.unlock ? ' ★' : '') + ' · 1 in ' + num(x.N) + (x.got ? '' : ' · ' + dlPct(dlDry(x.N, m.kills)) + ' dry'))));
      box.appendChild(det);
    });
    return box;
  }
  const PETS = [['farm', 'Farm', 1, 0, 1.6, 0.32], ['mine', 'Mine', 1, 1, 2.1, 0.42], ['smith', 'Smith', 0, 0, 0.9, 0.18], ['fish', 'Fish', 0, 0, 0.6, 0.12], ['brew', 'Brew', 0, 0, 0.4, 0.08], ['all_skills', 'All Skills', 0, 0, 0.3, 0.06]];
  function dlPets() {
    const bd = [dlHero(0.62, 3, 2.4, 'XP', 38400000, 'pets')];
    bd.push(h('div.shinybar', null, h('span.sp', null, '✨'), h('span', null, 'Shinies: 1 owned · 0.48 expected. A shiny is the same roll made 5 times rarer (skill pets 1 in 50,000,000 XP, All-Skills 1 in 500,000,000).')));
    bd.push(h('h5', null, 'Pets'));
    bd.push(h('div.pgrid', null, PETS.slice().sort((a, b) => (b[3] - a[3]) || (b[2] - a[2])).map(([sk, name, own, shiny, ln, ls]) => {
      const c = h('div.pcard' + (shiny ? '.shiny' : own ? '.own' : ''));
      const ic = h('div.pic', null, img('/pets/' + sk + '_pet' + (shiny ? '_s' : '') + '.png', null, '/skills/' + (sk === 'all_skills' ? 'levels' : sk) + '.png'));
      if (shiny) ic.appendChild(h('span.spk', null, '✨'));
      c.appendChild(ic);
      c.appendChild(h('div.pt', null, h('div.pn', null, name), h('div.ps' + (own ? '.good' : ''), null, own ? '✔ Pet owned' : 'Pet · ' + dlPct(1 - Math.exp(-ln)) + ' so far'), h('div.ps.shn' + (shiny ? '.good' : ''), null, shiny ? '✨ Shiny owned' : '✨ Shiny · ' + dlPct(1 - Math.exp(-ls)) + ' so far')));
      return c;
    })));
    bd.push(h('h5', null, 'Lucky tools'));
    bd.push(h('div.shinybar', null, h('span.sp', null, '🍀'), h('span', null, 'Lucky tools owned: 1 · 0.61 expected. 1 in 1,000,000 XP in the skill (Lantern 1 in 10,000,000); the shiny lucky tool is 5 times rarer.')));
    bd.push(h('div.pgrid', null, [['Lucky Pickaxe', 'lucky_charm_lucky', 1], ['Lucky Hatchet', 'lucky_charm_t2', 0]].map(([n, ic, own]) => h('div.pcard' + (own ? '.own' : ''), null, h('div.pic', null, itImg(ic)), h('div.pt', null, h('div.pn', null, n), h('div.ps' + (own ? '.good' : ''), null, own ? '✔ Lucky tool owned' : 'Lucky · 31% so far'), h('div.ps.shn', null, '✨ Shiny · 7.2% so far'))))));
    bd.push(h('div.note', null, '"So far" is the chance you would have it by now from your XP in that skill.'));
    return bd;
  }
  function dlBody(tab, ctx) {
    const miss = []; DL_MOBS.forEach((m) => m.drops.forEach((x) => { if (!x.got) miss.push([m, x]); })); miss.sort((a, b) => dlDry(a[1].N, a[0].kills) - dlDry(b[1].N, b[0].kills));
    const kills = DL_MOBS.reduce((t, m) => t + m.kills, 0);
    if (tab === 0) return [dlHero(0.55, 11, 11.9, 'kills', kills, 'drops'), h('h5', null, 'By category (click to open)'), dlMini('Mob drops', 0.41, 8, 8.6), dlMini('Raid loot', 0.86, 2, 1.1), dlMini('Pets', 0.62, 3, 2.4), dlMini('Lucky tools', 0.31, 1, 0.6), h('div.note', null, 'Everything you can roll for, added together: mob drops, raid and dungeon loot, pets and lucky tools (shinies included). Published base rates only.')];
    if (tab === 1) return [dlHero(0.41, 8, 8.6, 'kills', kills, 'drops'), h('h5', null, 'Most overdue')].concat(miss.slice(0, 4).map(([m, x]) => dlDropRow(m, x)), [h('button.cc-btn.sm.more', { type: 'button' }, 'Show more (' + (miss.length - 4) + ')'), h('div.note', null, 'Dry = the chance to still be without it after your kills. Red under 1%, orange under 5%.')]);
    if (tab === 2) {
      const sel = (opts, i) => h('select.sel', null, opts.map((o, k) => h('option', k === i ? { selected: true } : null, o)));
      return [dlHero(0.41, 8, 8.6, 'kills', kills, 'drops'), h('div.mobbar', null, h('input.cc-in.search', { type: 'text', placeholder: 'Find a mob' }), h('div.mobsel', null, sel(['All tiers', 'Dust', 'Frost'], 0), sel(['All', 'Incomplete', 'Complete', 'Nothing yet'], 0), sel(['Sort: most kills', 'Sort: most missing', 'Sort: unluckiest', 'Sort: name'], 0))), dlMobDetails(DL_MOBS.slice().sort((a, b) => b.kills - a.kills), true)];
    }
    if (tab === 3) {
      const raids = [['Battlefrost Smithy', '212 runs · 2/4 rares', 0.5, [['Frostforged Helm', 600, 1], ['Smithy Core', 1800, 0], ['Icebrand', 4000, 0], ['Rime Crown', 900, 1]]], ['Cinder Vault', '88 runs · 1/3 rares', 0.34, [['Vault Key', 400, 1], ['Ember Staff', 2500, 0], ['Cinder Wing', 6000, 0]]]];
      const raidSel = h('select.sel', { style: { marginTop: '8px', background: '#161620', color: '#e8e8f0', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '5px 8px', font: 'inherit', outline: 'none' } }, h('option', null, 'All raids'), h('option', null, 'Battlefrost Smithy'));
      return [dlHero(0.86, 3, 2.1, 'runs', 300, 'rare drops'), raidSel].concat(raids.map(([n, c, f, rs], i) => {
        const det = h('details', { style: { borderColor: dlColour(f) } }); if (i === 0) det.open = true;
        det.appendChild(h('summary', null, h('span.n', null, n), h('span.c', null, c)));
        rs.forEach(([nm, N, got]) => det.appendChild(dlLine(!!got, nm + ' · 1 in ' + num(N) + (got ? '' : ' · ' + dlPct(dlDry(N, 150)) + ' dry'))));
        if (i === 0) { det.appendChild(h('div.d', null, 'Milestones')); det.appendChild(dlLine(true, 'Frostbound Charm · clear a run in under 6m 30s')); det.appendChild(dlLine(false, 'Smithy Ledger · complete 250 runs')); }
        return det;
      }), [h('div.note', null, 'Dungeons roll their rares once per run. Chaos and the Fortress roll per wave, so they are listed without a luck rating. Milestone items come from a time or run count, not luck.')]);
    }
    if (tab === 4) { const un = miss.filter(([, x]) => x.unlock); return [dlHero(0.47, 2, 2.2, 'kills', kills, 'unlocks'), h('h5', null, 'Unlock drops still missing')].concat(un.map(([m, x]) => dlDropRow(m, x)), [h('div.note', null, '★ Unlock drops: tools and permanent gains.')]); }
    if (tab === 5) return dlPets();
    return [h('div.note', null, 'See the Fortress tracker specimen for this tab.')];
  }
  const dlTabsRow = (on) => kitTabs(DL_TABS, on, 'tabs');
  add({
    id: 'drop-luck', cat: 'Panels', title: 'Drop Luck Tracker', desc: 'How lucky your rare drops and pets have been, in seven tabs. Each tab opens with a verdict card (luck meter, three numbers) and then its own list.',
    keywords: 'drop luck dry kills pets shiny lucky tools raids unlocks mobs overview verdict meter', covers: [],
    variants: [{ label: 'Panel, Overview tab', id: 0 }, { label: 'Panel, Luck tab', id: 1 }, { label: 'Panel, Mobs tab', id: 2 }, { label: 'Panel, Raids tab', id: 3 }, { label: 'Panel, Unlocks tab', id: 4 }, { label: 'Panel, Pets tab', id: 5 }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      if (v.id === 'chip') return kitPanel({ id: 'cc-droplog', title: 'Drop Luck Tracker', chip: 'About average', min: true });
      return kitPanel({ id: 'cc-droplog', title: 'Drop Luck Tracker', chip: '', w: 420, hgt: 'min(580px,74vh)', between: dlTabsRow(v.id) }, dlBody(v.id, ctx));
    },
  });

  // =================================================================== Fortress Tracker (fortress-tracker.js: the Fortress tab of the Drop Luck panel)
  const FT_TIERS = [['t1', 'Tier 1', 0.012], ['t2', 'Tier 2', 0.008], ['t3', 'Tier 3', 0.004], ['t4', 'Tier 4', 0.0015], ['t5', 'Tier 5', null], ['c', 'Chaos', null]];
  const ftPc = (p) => (p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p > 0 ? (p * 100).toFixed(2) : '0') + '%';
  const ftTable = (rows) => {
    const t = h('div.ft-tbl'); ['Tier', 'Expected', 'Got', 'Chance of 1+'].forEach((x, i) => t.appendChild(h('div.th' + (i ? '.r' : ''), null, x)));
    rows.forEach(([n, e, g, a]) => t.append(h('div', null, n), h('div.r', null, e.toFixed(2)), h('div.r' + (g >= e ? '.good' : g === 0 && e >= 1 ? '.bad' : ''), null, String(g)), h('div.r', null, ftPc(a))));
    return t;
  };
  const ftRunBody = (waves, rolls) => h('div.ft-run', null, h('div.note', null, rolls + ' waves rolled · 1.41 rares expected · 1 got · 76% chance of at least one · your share about 38%'), ftTable([['Tier 1', 0.84, 1, 0.57], ['Tier 2', 0.42, 0, 0.34], ['Tier 3', 0.15, 0, 0.14]]), h('div.note', null, 'Expected = sum of the chances of every roll. Chance of none = product of (1 - chance) = 24%; chance of at least one = 1 - that = 76%.'));
  function ftBody(live) {
    const kids = [];
    if (live) kids.push(dlHero(0.7, 3, 2.4, 'waves rolled', 61, 'rares', 'Over 61 waves you had a 91% chance of at least one rare by now (2.40 expected) · luckier than about 70% of players with the same waves'));
    else kids.push(h('div.hero', null, h('div.v.mid', null, 'Tracking started'), h('div.p', null, 'Clear a few waves in the Fortress and your luck shows up here. The tracker reads the Fortress HUD and the game chat, so keep the Fortress HUD on screen.')));
    if (live) {
      const box = h('div.ft-live');
      box.appendChild(h('div.hd2', null, h('b', null, 'Live run · wave 14 · survived 13 · under attack'), h('span.ft-badge.ok', null, 'Your share 38% · eligible')));
      box.appendChild(h('div.ft-pills', null, FT_TIERS.map(([k, n, p]) => h('span.ft-pill' + (p ? '' : '.off'), null, n + ' ', h('b', null, p ? ftPc(p) : '-')))));
      box.appendChild(ftRunBody(14, 13));
      kids.push(box);
    }
    kids.push(h('h5', null, 'By tier · all tracked runs'));
    kids.push(live ? ftTable([['Tier 1', 2.9, 3, 0.94], ['Tier 2', 1.6, 1, 0.8], ['Tier 3', 0.7, 0, 0.5], ['Tier 4', 0.2, 0, 0.18]]) : h('div.note', null, 'No waves rolled yet.'));
    kids.push(h('h5', null, 'Drops and rewards'));
    if (live) kids.push(h('div.ft-log', null, [['rare', 'Today 19:21', 'Fortress Ledger [T2]', 'wave 12'], ['reward', 'Today 19:02', '23x [T3] Mithril Ore', 'reward'], ['mate', 'Today 18:40', 'Fortress Ledger [T1] · Ashen', 'wave 9'], ['milestone', 'Today 18:12', 'Wall Banner', 'wave 20']].map(([k, t, n, w]) => h('div.li.' + k, null, h('span.t', null, t), h('span.n', null, n), h('span.w', null, w)))));
    else kids.push(h('div.note', null, 'Nothing seen yet. Rewards, rares and ledgers show up here as they arrive.'));
    kids.push(h('h5', null, 'Run history'));
    if (live) {
      ['41 waves', '28 waves'].forEach((n, i) => { const det = h('details.ft-det'); if (i === 0) det.open = true; det.appendChild(h('summary', null, h('span.n', null, n), h('span.c', null, (i ? 'Yesterday 21:03' : 'Today 17:40') + ' · ' + (i ? '24 min' : '39 min') + ' · 1.41 exp · 1 got · 76% for 1+'))); if (i === 0) det.appendChild(ftRunBody(41, 41)); kids.push(det); });
    } else kids.push(h('div.note', null, 'Finished runs are listed here.'));
    kids.push(h('div.note', null, live ? 'The game counts 69 Fortress runs (best wave 41). Tracked by ScapeLite: 14 runs, 388 waves, 5 rares. Expected rares use the HUD per-wave chances and your contribution share.' : 'Tracked by ScapeLite: 0 runs, 0 waves, 0 rares.'));
    kids.push(h('button.cc-btn.sm.more', { type: 'button' }, 'Clear Fortress history'));
    return kids;
  }
  add({
    id: 'fortress-tracker', cat: 'Panels', title: 'Fortress Tracker', desc: 'The Fortress tab of the Drop Luck panel: it reads the Fortress HUD and chat, shows the live run (wave, your share, per-tier loot chances), luck, drops and run history.',
    keywords: 'fortress waves share rare tier chaos ledger live run history luck', covers: [],
    variants: [{ label: 'Follows the scenario (fortress run = live)', id: 'auto' }, { label: 'Live run (fortress data)', id: 'live' }, { label: 'Idle placeholder', id: 'idle' }],
    render(ctx, v) {
      const live = v.id === 'live' || (v.id === 'auto' && ctx.S.mode === 'fortress');
      return kitPanel({ id: 'cc-droplog', title: 'Drop Luck Tracker', chip: '', w: 420, hgt: 'min(640px,74vh)', between: dlTabsRow(6) }, ftBody(live));
    },
  });

  // =================================================================== Chat panel (chat-plus.js, kit .cc-msgs / .cc-composer)
  const CH_COL = { global: '#ffffff', raid: '#ff9f43', proximity: '#ffffff', friends: '#a6ff00', clan: '#cc88ff', game: '#5b9bd5' };
  function chatPanel(ctx, o) {
    const { M, S } = ctx, party = S.mode === 'dungeon' || S.mode === 'fortress';
    const chans = [['global', 'Global'], ['proximity', 'Nearby']].concat(party ? [['raid', 'Raid']] : [], [['friends', 'Friends'], ['clan', 'Clan'], ['game', 'Game']]);
    const tabs = h('div.tabs');
    chans.forEach(([id, l]) => { const on = id !== 'game'; const b = h('button.tab' + (on ? '.on' : '') + (id === 'game' ? '.off' : ''), { type: 'button', style: { '--tc': CH_COL[id] } }, l); if (!on) b.appendChild(h('i', null, '3')); tabs.appendChild(b); });
    tabs.appendChild(h('span.sp')); tabs.appendChild(h('button.ib' + (o.find ? '.on' : ''), { type: 'button', title: 'Search the chat' }, '🔍'));
    const rows = [];
    M.msgs.forEach((m, i) => {
      const ch = m[1].toLowerCase() === 'global' ? 'global' : m[1].toLowerCase() === 'clan' ? 'clan' : 'friends';
      const cm = h('div.cm' + (i === 3 ? '.hl' : ''), { 'data-ch': ch });
      cm.appendChild(h('span.ts', null, m[0]));
      if (o.tags) cm.appendChild(h('span.tg', { style: { color: CH_COL[ch] } }, '[' + m[1] + ']'));
      cm.appendChild(h('span.nm', { style: { color: CH_COL[ch] } }, m[2])); cm.appendChild(document.createTextNode(': '));
      const tx = h('span.tx'); if (o.find && /bank|ready/.test(m[3])) tx.append('', h('mark', null, o.find), m[3].replace(o.find, '')); else tx.appendChild(document.createTextNode(m[3])); cm.appendChild(tx);
      if (i === 1) cm.appendChild(h('span.ct', null, '×3'));
      rows.push(cm);
    });
    if (party) rows.push(h('div.cm', { 'data-ch': 'raid' }, h('span.ts', null, '19:42'), h('span.nm', { style: { color: CH_COL.raid } }, M.party[0][0]), ': ', h('span.tx', null, 'wave 4 starting, stack on me')));
    rows.push(h('div.cm', { 'data-ch': 'game' }, h('span.ts', null, '19:42'), h('span.tx', { style: { color: CH_COL.game } }, 'Frostfang Wolf: you found a Frost Pelt!')));
    const list = h('div.list', null, rows.length ? rows : h('div.empty', null, 'No messages yet.'));
    const wrap = h('div.wrap', null, list, h('button.jump' + (o.jump ? '.show' : ''), { type: 'button' }, '↓ 3 new'));
    if (o.sheet) {
      const r = (label, ctl) => h('div.r', null, h('span', null, label), ctl);
      wrap.appendChild(h('div.set.show', null, h('div.sh', null, h('button.ib', { type: 'button' }, '‹'), h('span', { style: { marginLeft: '8px' } }, 'Chat settings')),
        h('div.sb', null, h('h6', null, 'Look'),
          r('Width', [h('input', { type: 'range', min: '280', max: '700', value: '460' }), h('em', null, '460')]), r('Text size', [h('input', { type: 'range', min: '11', max: '20', value: '14' }), h('em', null, '14')]),
          r('Timestamps', h('select', null, h('option', null, 'Hours and minutes'))), r('Colour names', h('input', { type: 'checkbox', checked: true })), r('Merge repeated lines', h('input', { type: 'checkbox', checked: true })),
          h('h6', null, 'Filters'), r('Highlight words', h('input', { type: 'text', value: 'bank, raid' })), r('Mute words', h('input', { type: 'text', value: '' })), r('Hide level-up lines', h('input', { type: 'checkbox' })),
          h('h6', null, 'Data'), r('Saved history', h('button.bt', { type: 'button' }, 'Clear')))));
    }
    const cmp = h('div.cmp', null, h('button.cl', { type: 'button', style: { color: CH_COL.global } }, '[Global]'), h('input', { type: 'text', maxlength: '200', placeholder: 'Type a message' }), h('span.cn', null, o.typing ? '34' : ''));
    const bd = [tabs];
    if (o.find) bd.push(h('div.find.show', null, h('input', { type: 'text', value: o.find })));
    bd.push(wrap, cmp);
    const el = kitPanel({ id: 'cc-chat', title: 'Chat', chip: o.min ? '4 new · 1 @' : '', min: o.min, w: o.min ? null : 460, hgt: '340px', resizable: true }, bd);
    const gb = h('button.gb', { type: 'button', title: 'Chat settings' }, '⚙'); el._hd.insertBefore(gb, el._hd.querySelector('.min'));
    return el;
  }
  add({
    id: 'chat-panel', cat: 'Panels', title: 'Chat Panel', desc: 'A calmer replacement for the game’s chat: channel tabs with unread counts, search, highlight words, merged repeats, a composer, and its own settings sheet. Party channel appears in raid and fortress scenarios.',
    keywords: 'chat messages channels global clan friends nearby raid composer search settings unread mention', covers: [],
    variants: [{ label: 'Panel', id: 'p' }, { label: 'Panel, channel tags on', id: 'tags' }, { label: 'Panel, search with highlights', id: 'find' }, { label: 'Panel, scrolled up (jump button)', id: 'jump' }, { label: 'Panel, settings sheet', id: 'sheet' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      return chatPanel(ctx, { tags: v.id === 'tags', find: v.id === 'find' ? 'bank' : '', jump: v.id === 'jump', sheet: v.id === 'sheet', min: v.id === 'chip', typing: v.id === 'p' });
    },
  });

  // =================================================================== Tree Advisor (tree-advisor.js): panel, drawer, tab
  function treeCanvas(w, hgt, hoverIdx) {
    const c = h('canvas'), dpr = window.devicePixelRatio || 1; c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); c.style.height = hgt + 'px';
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2, cy = hgt / 2, nodes = [], COL = { have: '#5fe06d', add: '#ffd24a', rem: '#ff5a4d', other: '#3b3b55' };
    for (let ring = 1; ring <= 5; ring++) for (let k = 0; k < ring * 7; k++) { const a = (k / (ring * 7)) * Math.PI * 2 + ring * 0.4, r = ring * Math.min(w, hgt) * 0.085; nodes.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, ring, k, cls: (k * 7 + ring * 3) % 11 < 3 ? 'have' : (k * 5 + ring) % 13 < 2 ? 'add' : (k + ring) % 17 === 0 ? 'rem' : 'other', par: ring > 1 ? { ring: ring - 1, k: Math.floor(k * (ring - 1) / ring) } : null }); }
    const at = (ring, k) => nodes.find((n) => n.ring === ring && n.k === k);
    nodes.forEach((n) => { const p = n.par && at(n.par.ring, n.par.k); const used = n.cls !== 'other'; g.strokeStyle = used ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.12)'; g.lineWidth = used ? 1.6 : 1; g.beginPath(); g.moveTo(p ? p.x : cx, p ? p.y : cy); g.lineTo(n.x, n.y); g.stroke(); });
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fillStyle = '#6a6a88'; g.fill();
    nodes.forEach((n, i) => { const r = n.ring > 3 ? 9 : n.ring > 1 ? 6.5 : 5; g.beginPath(); g.arc(n.x, n.y, r + (i === hoverIdx ? 2 : 0), 0, Math.PI * 2); g.fillStyle = COL[n.cls]; g.fill(); if (n.cls !== 'other') { g.strokeStyle = 'rgba(0,0,0,.5)'; g.stroke(); } });
    return c;
  }
  function treeBody(kind) {
    const f1 = (n) => String(Math.round(n * 100) / 100);
    if (kind === 'builds') {
      return [h('h5', null, 'Saved builds'), ['Plan 10/18 · Delve · 31 nodes', 'Fortress run · Fortress · 24 nodes'].map((n) => h('div.row', null, h('span', null, n), h('span', { style: { flex: '1' } }), h('button.b', { type: 'button' }, 'Plan with it'), h('button.b', { type: 'button' }, 'Copy'), h('button.b', { type: 'button' }, '×'))),
        h('h5', null, 'Import a build'), h('textarea', { rows: '3', placeholder: 'Paste a build: {"app":"scapelite-tree",...} or delve:1,7,67,...', style: { width: '100%' } }), h('button.b', { type: 'button' }, 'Import'), h('div.dim', null, '')];
    }
    const fort = kind === 'fortify';
    const kids = [];
    kids.push(h('div.row', null, h('span.dim', null, 'Goal'), h('select', null, h('option', null, fort ? 'Skilling XP' : 'Max DPS'), h('option', null, 'Balanced')), h('span.dim', null, 'Level 31 · 29/31 points')));
    kids.push(h('div.hero', null, h('div.v.good', null, 'A better build exists'), h('div.dim', null, fort ? 'Priced with the weights below.' : 'DPS 41.2 → 44.9 (+9%) · attacks per second 1.204 → 1.236')));
    [['Best build (respec)', '+9% DPS · take 4, refund 2 (~60 credits)', '#ffd24a'], ['Keep my nodes', '+5.8% DPS · take 2, no refunds', '#44445a']].forEach(([l, t, col]) => kids.push(h('div.step.add', { style: { borderLeftColor: col } }, h('span.e', null, l + ': ' + t))));
    const rows = fort ? [['Skilling XP %', 14, 18], ['Double gather %', 6, 6], ['Move speed %', 0, 4]] : [['Min hit', 12, 14], ['Max hit', 46, 49], ['Crit chance %', 4, 7], ['Crit damage %', 25, 25], ['Attack speed %', 8, 11]];
    kids.push(h('table', null, h('tr', null, ['Effect', 'Now', 'Plan', 'Change'].map((x) => h('th', null, x))), rows.map(([n, a, b]) => h('tr', null, h('td', null, n), h('td', null, f1(a)), h('td', null, f1(b)), h('td' + (b > a ? '.good' : ''), null, b > a ? '+' + f1(b - a) : '–')))));
    kids.push(h('h5', null, 'Steps to get there'));
    kids.push(h('div.dim', null, 'Refund first (2 nodes, about 60 reroll credits; leaves first):'));
    kids.push(h('div.step.rem', null, h('span.n', null, '1.'), h('span.e', null, '+6 Min hit · spear arc'))); kids.push(h('div.step.rem', null, h('span.n', null, '2.'), h('span.e', null, '+3 Max hit · spear arc')));
    kids.push(h('div.dim', null, 'Then take (4, in this order; 2 points available):'));
    [['+7 Crit chance % · edge', '+2.1'], ['+4 Attack speed % · edge', '+1.4'], ['+5 Max hit · core', '+0.9'], ['+3 Crit chance % · edge', '+0.6']].forEach(([n, g], i) => kids.push(h('div.step.add', null, h('span.n', null, (i + 1) + '.'), h('span.e', null, n), h('span.g', null, g))));
    kids.push(h('h5', null, 'Save, share'));
    kids.push(h('div.row', null, ['Save this plan', 'Copy as text', 'Use my current build'].map((t) => h('button.b', { type: 'button' }, t))));
    kids.push(h('details', null, h('summary.dim', null, 'Custom weights (what each effect is worth)')));
    return kids;
  }
  function treePanel(kind, o) {
    const tabs = h('div.tabs', null, [['delve', 'Delve'], ['fortify', 'Fortress'], ['builds', 'My builds']].map(([k, l]) => h('button' + (k === kind ? '.on' : ''), { type: 'button' }, l)));
    const el = kitPanel({ id: 'cc-treeadv', title: 'Tree Advisor', chip: '', w: 470, hgt: o.hgt || '640px', between: tabs, cls: '' }, treeBody(kind));
    if (o.side) el.dataset.drawerSide = o.side;
    return el;
  }
  const treeDrawer = (hgt, w) => h('div#cc-treeadv-drawer.show', { 'data-side': 'r', style: { position: 'relative', display: 'flex', height: hgt + 'px', width: w + 'px', zIndex: 'auto', top: 'auto', left: 'auto' } },
    h('div.dh', null, 'The tree'), treeCanvas(w - 22, hgt - 90, 14),
    h('div.leg', null, [['#5fe06d', 'you have it, keep'], ['#ffd24a', 'take'], ['#ff5a4d', 'refund'], ['#3b3b55', 'not used']].map(([c, l]) => h('span', null, h('i', { style: { background: c } }), l))));
  const treeTab = (txt) => h('button#cc-treeadv-tab', { type: 'button', 'data-side': 'r', style: { position: 'relative', zIndex: 'auto', marginTop: '70px', alignSelf: 'flex-start', left: 'auto', top: 'auto' } }, txt);
  add({
    id: 'tree-advisor', cat: 'Panels', title: 'Tree Advisor', desc: 'Plans the best Delve and Fortress tree builds: goal, hero verdict, the two ways to get there, an effects table, ordered steps, saving and custom weights. It never allocates a node.',
    keywords: 'tree delve fortress build nodes refund dps weights plan builds import', covers: [],
    variants: [{ label: 'Panel, Delve tab', id: 'delve' }, { label: 'Panel, Fortress tab', id: 'fortify' }, { label: 'Panel, My builds tab', id: 'builds' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      if (v.id === 'chip') return kitPanel({ id: 'cc-treeadv', title: 'Tree Advisor', chip: 'Delve: 6 changes to the best build', min: true });
      return treePanel(v.id, {});
    },
  });
  add({
    id: 'tree-advisor-drawer', cat: 'Drawers', title: 'Tree Advisor drawer', desc: 'The picture of the tree slides out beside the panel (green = keep, gold = take, red = refund) with a vertical tab on its edge to open and fold it. The panel squares its corners where the drawer touches.',
    keywords: 'tree drawer tab canvas legend nodes picture slide', covers: [],
    variants: [{ label: 'Panel + Drawer open + Tab', id: 'open' }, { label: 'Drawer folded (tab only)', id: 'closed' }],
    render(ctx, v) {
      const open = v.id === 'open', p = treePanel('delve', { side: open ? 'r' : null, hgt: '560px' });
      return h('div', { style: { display: 'flex', alignItems: 'flex-start' } }, p, open ? treeDrawer(560, 420) : null, treeTab(open ? '◂ Tree' : 'Tree ▸'));
    },
  });

  // =================================================================== Lever Advisor (lever-advisor.js): window drawer in the Skills Customization window
  function leverRows(mode) {
    const rows = mode === 'slay' ? [['+2', 'Dustclaw Raider', '75 cr', 'pull'], ['+1', 'Cinder Imp', '25 cr', 'pull'], ['−1', 'Mudback Toad', '+25 back', 'rel']] : [['+2', 'Mine', '75 cr', 'pull'], ['+1', 'Smith', '25 cr', 'pull'], ['+1', 'Vigor', '25 cr', 'pull'], ['−2', 'Barter', '+75 back', 'rel'], ['−1', 'Sight', '+25 back', 'rel']];
    return rows.map(([s, n, c, k]) => h('div.it.' + k, null, h('span.s', null, s), h('span.n', null, n), h('span.c', null, c)));
  }
  function leverDrawer(o) {
    const root = h('div.cc-wd' + (o.open ? '.open' : ''), { id: 'cc-lever-drawer', role: 'region', 'aria-label': 'Lever Advisor', style: { '--cc-wd-w': '430px' } });
    const tab = h('button.cc-wd-tab', { type: 'button', 'aria-expanded': String(!!o.open) }, 'Lever Advisor', h('i', null, '5'));
    const body = h('div.cc-wd-bd');
    if (o.other) body.appendChild(h('div.note', null, 'Open the Skills page (skill weights) or the Slay page (mob weights): the advisor works on those. Single-skill pages show the activity weights too.'));
    else {
      body.append(h('select.route', null, h('option', null, o.mode === 'slay' ? 'Balanced: best XP per hour, XP-boost drops count extra' : 'My skill priorities (Route Advisor)')),
        h('div.sum', null, 'Credits ', h('b', null, '100'), ' → ', h('b', null, '25'), ' left. Expected payoff of the ' + (o.mode === 'slay' ? 'mobs' : 'skills') + ' you roll: ', h('b', null, '+6.4%'), '.'),
        h('div.list', null, leverRows(o.mode)),
        h('details.why', null, h('summary', null, 'Why these picks?'), h('div.whyb', null, h('table', null, h('tr', null, ['Skill', 'Route value', 'Now', 'Plan', 'Odds now', 'Odds plan'].map((t, i) => h('th' + (i ? '.r' : ''), null, t))), [['Mine', '2.1', 0, 2, '9%', '14%'], ['Smith', '1.8', 0, 1, '9%', '11%'], ['Barter', '0.4', 1, -1, '11%', '7%']].map(([n, v2, a, b, c, d]) => h('tr', null, h('td', null, n), h('td.r', null, v2), h('td.r', null, String(a)), h('td.r', null, (b > 0 ? '+' : '') + b + (b > a ? ' ▲' : ' ▼')), h('td.r', null, c), h('td.r', null, d)))))),
        h('div.note', null, 'Skill values come from the route. A weight is how likely that skill is to be rolled. The yellow buttons are the ones to press; nothing is pressed for you.'));
    }
    root.append(tab, h('div.cc-wd-box', null, h('div.cc-wd-hd', null, h('b', null, 'Lever Advisor'), h('span.chip', null, o.other ? '' : '3 to raise, 2 to lower · +6.4%'), h('button', { type: 'button', title: 'Fold this drawer' }, '›')), body));
    return root;
  }
  add({
    id: 'lever-advisor', cat: 'Drawers', title: 'Lever Advisor', desc: 'A drawer inside the game’s Skills Customization window: pick a route, see which levers to raise or lower within your credits, and why. Yellow outlines mark the lever buttons to press.',
    keywords: 'lever advisor skills customization window drawer wd tab box credits weights outline pull release', covers: [],
    variants: [{ label: 'Window drawer, open (Skills page)', box: [820, 470], id: 'total' }, { label: 'Window drawer, open (Slay page)', box: [820, 470], id: 'slay' }, { label: 'Window drawer, folded (tab only)', box: [820, 470], id: 'closed' }, { label: 'Window drawer, other page', box: [820, 470], id: 'other' }],
    render(ctx, v) {
      const win = h('div.lsp-win', { style: { position: 'absolute', inset: '0' } }, h('div.lsp-wh', null, skImg('levels'), 'Skills Customization'));
      const grid = h('div.lsp-wb');
      ['Mine', 'Smith', 'Vigor', 'Barter', 'Sight'].forEach((n, i) => grid.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid #222' } }, skImg(n.toLowerCase()), h('span', { style: { width: '90px' } }, n), h('button', { class: i < 3 ? 'cc-lv-release' : '', 'data-cc-n': '−', style: { background: '#23232f', color: '#fff', border: '1px solid #444', borderRadius: '4px', width: '28px', margin: '0 8px' } }, '−'), h('span', null, String([0, 0, 0, 1, 1][i])), h('button', { class: i < 3 ? 'cc-lv-pull' : '', 'data-cc-n': '+' + (2 - (i > 0 ? 1 : 0)), style: { background: '#23232f', color: '#fff', border: '1px solid #444', borderRadius: '4px', width: '28px', margin: '0 8px' } }, '+'))));
      win.appendChild(grid);
      const wrap = h('div', { style: { position: 'absolute', inset: '0' } }, win, leverDrawer({ open: v.id !== 'closed', mode: v.id === 'slay' ? 'slay' : 'total', other: v.id === 'other' }));
      return wrap;
    },
  });

  // =================================================================== Route Advisor (route-advisor.js)
  const RT_PATHS = [['Skilling XP', '#6fe27a', '+1.84 lv/hr', 100, '29m 40s', '6m 10s', '24.1k', '+12% vs now', true, '↯ 2 teleports (1× Stable, 1× Faulty) · saves 4m 30s', '3 picks swapped'], ['Combat XP', '#ff8a7a', '+1.31 lv/hr', 71, '33m 05s', '7m 40s', '21.7k', '−2% vs now', false, 'no teleports', 'keeps your picks'], ['Quests and scrolls', '#6fb6ff', '+1.52 lv/hr', 83, '31m 20s', '6m 55s', '22.9k', '+3% vs now', false, 'no teleports', '1 pick swapped']];
  function rtPlanCard(p, i, o) {
    const [t, col, sc, bar, tot, walk, xp, vs, best, tp, sw] = p, sel = i === 0;
    const c = h('div.rt-plan' + (sel ? '.sel' : '') + (best ? '.best' : '') + (tp.indexOf('teleport') >= 0 && tp[0] === '↯' ? '.tp' : '') + (i === 2 ? '.qst' : ''));
    c.appendChild(h('h4', null, h('span.rt-ptitle', { style: { color: col } }, t), best ? h('span.rt-badge', null, 'Best progress') : null, h('span.rt-sp'), h('span.rt-big', null, sc)));
    c.appendChild(h('div.rt-pbar', null, h('i', { style: { width: bar + '%', background: col } })));
    c.appendChild(h('div.rt-pstats', null, h('span', null, 'Total ', h('b', null, tot)), h('span', null, 'Walk ', h('b', null, walk)), h('span', null, 'XP/hr ', h('b', null, xp)), h('span.' + (vs.indexOf('−') === 0 ? 'rt-bad' : 'rt-good'), null, vs)));
    c.appendChild(h('div.rt-pstats', null, h('span.' + (tp[0] === '↯' ? 'rt-tpc' : 'rt-dim'), null, tp), h('span.' + (sw.indexOf('swapped') >= 0 ? 'rt-sw' : 'rt-dim'), null, sw)));
    if (sel) {
      c.appendChild(h('button.rt-steps-btn', { type: 'button' }, o.steps ? 'Hide steps' : 'Show steps'));
      if (o.steps) {
        const ol = h('ol.rt-stops');
        [['Mine Tin Ore – Windhollow Vein', '8,449 · 8m', ' · task 16m · +2.6k xp', false], ['Brew Unf Swift Potion – Icelock Cauldron', '5,148 · 5m', ' · task 11m · +2.9k xp · quest 1.2k', true], ['Vigor Lunges – Seasonfort Trail', '5,885', ' · task 25m · +8k xp', false]].forEach(([n, d, x, tpf], k) => {
          const li = h('li', null, n + ' ', h('span.rt-dim', null, '(' + d + ')'), h('span.rt-dim', null, x), tpf ? h('span.rt-tp', null, ' ↯ teleport (Stable)') : null);
          if (k === 1) li.appendChild(h('div.rt-why', null, h('div.rt-why-h', null, h('b', null, '⇄ Swap'), ' instead of Calm Potion'), h('div.rt-why-l', null, 'This pick: 11m for +2.9k xp (1.6 lv/hr)'), h('div.rt-why-l', null, 'Your pick: 10m for +2.1k xp (1.3 lv/hr)'), h('div.rt-why-l.good', null, 'Completes a quest step your pick does not'), h('div.rt-why-l.bad', null, 'Uses 1 more teleport charge')));
          ol.appendChild(li);
        });
        c.appendChild(ol);
      }
    }
    return c;
  }
  function rtPanel(o) {
    const head = h('div.rt-head', null, h('span.rt-ttl', null, 'Route Advisor'), o.first ? null : h('span.rt-pill' + (o.optimal ? '' : '.good'), null, o.optimal ? 'Optimal ✓' : 'Best: +12% lv/hr'), h('span.rt-sp'), h('button.rt-x', { type: 'button' }, '×'));
    const calc = (load) => h('div.rt-calc' + (load ? '.load' : ''), null, h('div.rt-calc-top', null, h('span.rt-spin'), h('span', null, load ? 'Loading map data (first time takes a moment)…' : o.first ? 'Calculating the best route…' : 'Recalculating the best route…'), h('span.rt-sp'), load ? null : h('b', null, '64%')), h('div.rt-calc-bar', null, h('i', { style: { width: '64%' } })));
    const el = h('div#cc-route-panel', { role: 'dialog', 'aria-label': 'Route Advisor', style: { position: 'relative', left: 'auto', top: 'auto', maxHeight: o.maxH || '760px', width: '420px' } });
    if (o.side) el.dataset.mapSide = o.side;
    if (o.calc) el.classList.add('calculating');
    el.appendChild(head);
    if (o.calc || o.first) el.appendChild(calc(o.first));
    if (o.first) return el;
    const body = h('div.rt-body'), segs = (label, opts, on, extra) => h('div.rt-prefrow', null, h('span.rt-dim', null, label), opts.map((t, i) => h('button.rt-seg' + (i === on ? '.on' : ''), { type: 'button' }, t)), extra || null);
    body.appendChild(segs('Teleports', ['On foot', 'Efficient'], 1, [h('span.rt-sp'), h('span.rt-dim', null, '1× Stable, 1× Faulty')]));
    body.appendChild(segs('Picks', ['Optimise', 'Keep mine'], 0));
    if (o.upsell) body.appendChild(h('div.rt-upsell', null, '↯ Teleports would save 4m 30s on this queue (2 charges, about 2m each). ', h('button.rt-seg', { type: 'button' }, 'Use teleports')));
    RT_PATHS.forEach((p, i) => body.appendChild(rtPlanCard(p, i, o)));
    body.appendChild(h('div.rt-curnow', null, h('span', null, 'Your queue now'), h('b', null, '+1.64 lv/hr'), h('span.rt-dim', null, '35m · walk 9m')));
    body.appendChild(h('div.rt-legend', null, h('span.lp', null, '■ purple border'), ' = uses teleports · ', h('span.lq', null, '■ blue'), ' = includes a quest step'));
    const wi = h('div.rt-wi', null, h('h4', null, 'What you could gain'));
    const vt = h('div.rt-vt', null, h('table', null, h('tr', null, h('th'), ['🚶', '⚡'].map((x) => h('th', null, x))), [['🔒 keep my picks', '+2%', '+5%'], ['🔀 optimise picks', '+7%', '+12%']].map(([l, a, b], k) => h('tr', null, h('td.rl', null, l), h('td.c.z', null, a), h('td.c.g' + (k === 1 ? '.cur' : ''), null, b)))));
    wi.append(vt, h('div.rt-dim', null, 'Highlighted = what you use now.')); body.appendChild(wi);
    body.appendChild(h('div.rt-note', null, 'Display only – apply a suggestion by dragging queue rows / picking options yourself. lv/hr = weighted levels gained per hour (combat levels count 40%, see Settings > Plugins > Route Advisor). 18,432 search states in 212 ms.'));
    el.appendChild(h('div.rt-tabs-placeholder', { style: { display: 'none' } }));
    el.appendChild(body);
    return el;
  }
  add({
    id: 'route-advisor', cat: 'Panels', title: 'Route Advisor', desc: 'Finds a faster order for your task queue: header pill with the best gain, teleport and pick preferences, one card per goal path (skilling, combat, quests), your queue now, and a table of what you could gain.',
    keywords: 'route advisor plan paths teleports picks steps swap quest calculating optimal queue order walking', covers: [],
    variants: [{ label: 'Panel, Plan', id: 'plan' }, { label: 'Panel, steps open', id: 'steps', steps: true }, { label: 'Panel, teleport suggestion', id: 'up' }, { label: 'Panel, already optimal', id: 'opt' }, { label: 'Panel, recalculating', id: 'calc' }, { label: 'Panel, first calculation', id: 'first' }],
    render(ctx, v) { return rtPanel({ steps: v.id === 'steps', upsell: v.id === 'up', optimal: v.id === 'opt', calc: v.id === 'calc', first: v.id === 'first', maxH: v.id === 'steps' ? '900px' : '700px' }); },
  });
  function rtMapSvg() {
    const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 300 360'); s.style.cssText = 'display:block;width:100%;flex:1;min-height:0;background:var(--cc-sunk)';
    const line = (pts, col, dash, w) => { const p = document.createElementNS(NS, 'polyline'); p.setAttribute('points', pts); p.setAttribute('fill', 'none'); p.setAttribute('stroke', col); p.setAttribute('stroke-width', w || 3); if (dash) p.setAttribute('stroke-dasharray', '8 6'); s.appendChild(p); };
    line('40,300 90,230 70,150 150,110 230,60', '#7a7a88', false, 2.5); line('40,300 120,260 190,200 160,130 230,60', '#5fdc6a', false, 3); line('190,200 250,120', '#ffd24a', true, 2.5);
    [[40, 300, 'Start'], [120, 260, ''], [190, 200, 'Brew'], [160, 130, 'Vigor'], [230, 60, 'Mine']].forEach(([x, y, t]) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 6); c.setAttribute('fill', '#ffd24a'); s.appendChild(c); if (t) { const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', x + 9); tx.setAttribute('y', y + 4); tx.setAttribute('fill', '#e8e8f0'); tx.setAttribute('font-size', '12'); tx.textContent = t; s.appendChild(tx); } });
    return s;
  }
  add({
    id: 'route-advisor-map', cat: 'Drawers', title: 'Route Advisor map drawer', desc: 'The map slides out from the panel’s outer edge (with a vertical Map tab on the seam): grey = current order, green = recommended, dashed gold = teleport.',
    keywords: 'route map drawer tab legend teleport polyline slide', covers: [],
    variants: [{ label: 'Panel + Map drawer open + Tab', id: 'open' }, { label: 'Map folded (tab only)', id: 'closed' }],
    render(ctx, v) {
      const open = v.id === 'open', p = rtPanel({ side: open ? 'r' : '', maxH: '560px' }); p.style.height = '560px';
      const drawer = h('div#cc-route-map', { 'data-side': 'r', 'data-open': '1', style: { position: 'relative', left: 'auto', top: 'auto', transform: 'none', width: '340px', height: '560px', visibility: 'visible', opacity: '1', pointerEvents: 'auto' } },
        h('div.rt-head', null, h('span.rt-ttl', null, 'Map'), h('span.rt-dim', { style: { color: '#6fe27a' } }, 'Skilling XP path'), h('span.rt-sp'), h('button.rt-x', { type: 'button' }, '×')), rtMapSvg(),
        h('div.rt-maplegend', null, [['#7a7a88', 'Current order', ''], ['#5fdc6a', 'Recommended', ''], ['#ffd24a', 'Teleport', 'dash']].map(([c, l, d]) => h('span', null, h('i', { style: { borderTop: '2px ' + (d ? 'dashed' : 'solid') + ' ' + c } }), ' ' + l))));
      const tab = h('button#cc-route-maptab', { type: 'button', 'data-side': 'r', 'data-open': open ? '1' : '0', style: { position: 'relative', left: 'auto', top: 'auto', marginTop: '58px', alignSelf: 'flex-start' } }, open ? '◂ Map' : 'Map ▸');
      return h('div', { style: { display: 'flex', alignItems: 'flex-start' } }, p, open ? drawer : null, tab);
    },
  });
  add({
    id: 'route-advisor-alert', cat: 'Toasts and alerts', title: 'Route Advisor badge', desc: 'The small badge that tells you a faster route is waiting: a yellow warning with the time saved (and a dismiss), a green "possible" or "Route optimal" badge, and the calculating state. Shown in the card form here.',
    keywords: 'route badge alert warning optimal calculating saved possible docked tasks card', covers: [],
    variants: [{ label: 'Warning (faster route waiting)', id: 'warn' }, { label: 'Possible saving (seen)', id: 'ok' }, { label: 'Route optimal', id: 'opt' }, { label: 'Calculating', id: 'calc' }, { label: 'Docked on the Tasks panel', id: 'dock' }],
    render(ctx, v) {
      const mk = (cls, kids) => h('div#cc-route-alert.in-card' + (cls ? '.' + cls : ''), { style: { position: v.id === 'dock' ? 'relative' : 'static' } }, kids);
      if (v.id === 'dock') { const a = h('div#cc-route-alert.docked', { style: { position: 'relative', bottom: 'auto', left: 'auto' } }, h('button.tri', { type: 'button' }, '⚠ −4m 30s'), h('button.x', { type: 'button' }, '×')); return h('div', { style: { padding: '8px 0 0' } }, a, h('div', { style: { width: '260px', padding: '10px 12px', border: '1px solid #3a3a4c', borderTop: 0, borderRadius: '0 0 8px 8px', background: '#14141b', color: '#aab', font: '13px system-ui' } }, 'Tasks panel (game)')); }
      if (v.id === 'warn') return mk('', [h('button.tri', { type: 'button' }, '⚠ −4m 30s'), h('button.x', { type: 'button', title: 'Dismiss the warning (the badge stays, in green)' }, '×')]);
      if (v.id === 'ok') return mk('ok', [h('button.tri.ok', { type: 'button' }, '↯ −4m 30s possible')]);
      if (v.id === 'opt') return mk('ok', [h('button.tri.ok', { type: 'button' }, '✓ Route optimal')]);
      return mk('', [h('button.tri.calc', { type: 'button' }, h('span.rt-spin'), ' Calculating…')]);
    },
  });

  // =================================================================== Walking countdown (walking-countdown.js)
  function walkInner(drawer) {
    const bar = (cls, fill, l, c, r, st) => h('div.float-bar', null, h('div.float-bar-fill.' + cls, { style: Object.assign({ width: fill + '%' }, st || {}) }), h('div.float-bar-text', null, h('span', null, l), h('span.bar-center', { style: st && st.center ? { color: st.center } : null }, c), h('span', null, r)));
    return h('div.float-task-inner', null,
      h('div.float-icon', null, skImg('vigor')),
      h('div.float-details', null, h('div.float-task-name.cc-walk-dest', null, 'Walking to Sandscale Lake'), h('div.float-task-node.cc-walk-vigor-label', null, 'Vigor'),
        bar('task-fill', 22, '2m 2s', '12s', '8m 56s', { background: '#d9792a', center: '#e8923a' }), bar('level-fill', 54.5, 'Lv 40', '54.5%', 'Lv 41')));
  }
  add({
    id: 'walking-countdown', cat: 'Widgets', title: 'Walking countdown', desc: 'A small floating widget with its own title bar (drag, resize grip): a trip timer bar graded red to green and a Vigor level bar, drawn with the game’s own task-widget classes.',
    keywords: 'walking countdown eta trip timer vigor float task widget titlebar resize', covers: [],
    variants: [{ label: 'Floating widget', w: 340, id: 'float' }, { label: 'Floating widget, wide', w: 420, id: 'wide' }],
    render(ctx, v) {
      const el = h('div#cc-walk-countdown', { style: { position: 'relative', top: 'auto', left: 'auto', transform: 'none', width: (v.w || 340) + 'px' } },
        h('div.cc-walk-slide.lsp-float', { style: { width: '100%' } }, h('div.cc-walk-titlebar#cc-walk-titlebar', null, h('span.cc-walk-titlebar-label', null, 'Walking')), walkInner(false)), h('div.cc-walk-resize-handle', { title: 'Drag to resize' }));
      return el;
    },
  });
  add({
    id: 'walking-drawer', cat: 'Drawers', title: 'Walking countdown drawer', desc: 'Drawer mode: the countdown is docked flush under the game’s Current Task widget and slides out of its bottom edge while you walk (no title bar, no icon).',
    keywords: 'walking drawer current task dock slide cc-walk-drawer', covers: [],
    variants: [{ label: 'Drawer open under the Current Task', id: 'open', box: [360, 250] }, { label: 'Drawer folded', id: 'closed', box: [360, 250] }],
    render(ctx, v) {
      const host = h('div.lsp-float', { style: { position: 'absolute', left: '10px', top: '10px', width: '340px', overflow: 'visible' } }, h('div.tb', null, 'Current Task'),
        h('div.float-task-inner', null, h('div.float-icon', null, skImg('mine')), h('div.float-details', null, h('div.float-task-name', null, 'Mine 90 Aluminum Ore'), h('div.float-task-node', null, 'Ridgeside Vein (6894)'), h('div.float-bar', null, h('div.float-bar-fill.task-fill', { style: { width: '0%' } }), h('div.float-bar-text', null, h('span', null, '0'), h('span.bar-center', null, '13m 11s'), h('span', null, '90'))))));
      const dr = h('div#cc-walk-countdown.cc-walk-drawer' + (v.id === 'open' ? '.cc-open' : ''), { style: { position: 'absolute', top: 'calc(100% - 1px)', left: '0', width: '100%' } }, h('div.cc-walk-slide.lsp-float', { style: { width: '100%', borderTop: 0 } }, walkInner(true)));
      host.appendChild(dr);
      return host;
    },
  });

  // =================================================================== Layout editor (ui-layout.js)
  function edFrame(o) {
    const f = h('div.fr' + (o.sel ? '.sel' : '') + (o.lk ? '.lk' : '') + (o.fz ? '.fz' : ''), { style: { position: 'absolute', left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px' } });
    f.appendChild(h('div.tb' + (o.y < 60 ? '.in' : ''), null, h('b', null, o.name), h('button', { type: 'button', title: 'Lock this panel in place' }, o.lk ? '🔒' : '🔓'), h('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: '1', title: 'Opacity' }), h('button', { type: 'button' }, '👻'), h('button', { type: 'button' }, '↺'), h('button', { type: 'button' }, '⧉')));
    if (!o.lk) f.appendChild(h('div.rz'));
    return f;
  }
  function edBar() {
    const b = h('div#cc-ed-bar', { style: { position: 'absolute', left: '50%', top: '8px' } });
    const mk = (t, on) => h('button' + (on ? '.on' : ''), { type: 'button' }, t);
    b.append(h('span.ttl', null, 'Layout editor'), h('select', null, h('option', null, 'Default'), h('option', null, 'Raid night')), h('select.auto', null, h('option', null, 'Used when I pick it')), mk('Save as…'), mk('Delete'), mk('Export'), mk('Import'), h('span.sep'),
      h('label', null, h('input.snap', { type: 'checkbox', checked: true }), 'Snap'), mk('Show all panels'), mk('Tidy up'), mk('Undo'), mk('Reset all'), mk('Done', true),
      h('div.look', null, h('label', null, 'Colours', h('select', null, h('option', null, 'ScapeLite'))), h('label', null, 'Spacing', h('select', null, h('option', null, 'Cozy'))), h('label', null, 'Text', h('select', null, h('option', null, 'Default'))), h('label', null, 'Accent', h('input', { type: 'color', value: '#ffd24a' }), h('button', { type: 'button' }, 'Default'))),
      h('div.hint', null, 'Drag a panel to move it · Shift = no snapping · click a panel, then arrow keys nudge it (Shift = 10 px) · corner = resize · Esc = done · Ctrl+Alt+L opens and closes this editor'));
    return b;
  }
  add({
    id: 'layout-editor', cat: 'Overlays', title: 'Layout editor', desc: 'Edit mode for ScapeLite’s panels: a top bar (layout picker, save/export/import, snap, tidy, look) and a dashed frame on every panel with its own toolbar (lock, opacity, fade, reset, tab group), a resize corner and alignment guides.',
    keywords: 'layout editor frame drag snap lock fade group tidy profile export import guides grid', covers: [],
    variants: [{ label: 'Editor bar + frames', box: [940, 520], id: 'edit' }, { label: 'Frame states', box: [640, 300], id: 'states' }],
    render(ctx, v) {
      const root = h('div#cc-ed-root', { style: { position: 'absolute', inset: '0' } });
      const panelAt = (x, y, el) => h('div', { style: { position: 'absolute', left: x + 'px', top: y + 'px' } }, el);
      const hp = hpPanel(ctx.M, {});
      if (v.id === 'states') {
        root.append(panelAt(14, 50, kitPanel({ id: 'cc-goals', title: 'Goals', chip: 'Fish 48 → 50', min: true })), edFrame({ name: 'Goals', x: 8, y: 44, w: 190, h: 44, sel: true }));
        root.append(panelAt(230, 50, hp), edFrame({ name: 'HP', x: 224, y: 44, w: 214, h: 62, lk: true }));
        root.append(edFrame({ name: 'Chat (frozen: fused)', x: 14, y: 150, w: 250, h: 110, fz: true }), edFrame({ name: 'XP Tracker', x: 300, y: 150, w: 250, h: 110 }));
        root.append(h('div.gd', { style: { position: 'absolute', left: '224px', top: '0', width: '1px', height: '100%' } }));
        return root;
      }
      root.append(edBar());
      root.append(panelAt(30, 170, kitPanel({ id: 'cc-xp-tracker', title: 'XP Tracker', chip: '24.8k XP/hr', chipAlways: true, min: true })), edFrame({ name: 'XP Tracker', x: 24, y: 164, w: 210, h: 44, sel: true }));
      root.append(panelAt(30, 280, hp), edFrame({ name: 'HP', x: 24, y: 274, w: 214, h: 64, lk: true }));
      root.append(panelAt(560, 200, kitPanel({ id: 'cc-matshort', title: 'Materials', chip: '1 short', min: true, closable: false })), edFrame({ name: 'Materials', x: 554, y: 194, w: 150, h: 44 }));
      root.append(h('div.gd', { style: { position: 'absolute', left: '24px', top: '0', width: '1px', height: '100%' } }));
      root.append(h('div.gm', { style: { position: 'absolute', left: '260px', top: '170px' } }, h('div.gh', null, 'Show as a tab together with:'), h('button', { type: 'button' }, 'Goals'), h('button', { type: 'button' }, 'Drop Luck ✓')));
      return root;
    },
  });
  add({
    id: 'tab-group-strip', cat: 'Docks and handles', title: 'Tab group strip', desc: 'When panels share one window spot (group button in the layout editor), a tab strip sits on the top edge of the group; the active tab has an accent underline.',
    keywords: 'tab group strip grouped panels share spot cc-grp-root', covers: [],
    variants: [{ label: 'Strip with three tabs', id: 's' }],
    render() {
      const s = h('div#cc-grp-root', { style: { position: 'relative' } }, h('div.strip', { style: { position: 'relative', width: 'max-content' } }, h('button.on', { type: 'button' }, 'Goals'), h('button', { type: 'button' }, 'Drop Luck'), h('button', { type: 'button' }, 'Tree Advisor')));
      return h('div', null, s, kitPanel({ id: 'cc-goals', title: 'Goals', chip: '', w: 360, hgt: '150px', style: { borderTopLeftRadius: '0' } }, h('div.cc-hint', null, 'The panel body of the active tab')));
    },
  });

  // =================================================================== Bug report (bug-report.js)
  add({
    id: 'bug-report', cat: 'Panels', title: 'Bug report panel', desc: 'A small form: which plugin, what happened, a diagnostics preview (versions and which plugins are on, no name or settings), then Copy report / Open on GitHub. Opens above the game’s Settings window.',
    keywords: 'bug report form diagnostics github issue textarea', covers: [],
    variants: [{ label: 'Panel', id: 'p' }, { label: 'Panel, community plugin chosen', id: 'c' }],
    render(ctx, v) {
      const lab = (t) => h('label', { style: { fontSize: '12px', color: '#9a9ab0' } }, t);
      const diag = 'ScapeLite: v0.9.4\nBrowser: Chrome/124.0\nPlugins switched off: none\nLoaded: Bar, Bridge, Chat, DropLuck, Goals, Hp, Queue, RouteAdvisor, UI, XpTracker\nBridge: attached';
      const el = kitPanel({ id: 'cc-bugreport', title: 'Report a ScapeLite bug', chip: '', w: 460, collapsible: false },
        h('div.scope', null, h('b', null, 'What gets fixed:'), ' ScapeLite fixes bugs in its ', h('b', null, 'Official plugins'), ' (the ones tagged ScapeLite in the marketplace). Community plugins are made by other people: report problems with those to their author, they are not fixed by the ScapeLite team. Bugs in the game itself belong to the game’s developers.'),
        h('div', null, lab('Which plugin is it about?'), h('select.plug', null, h('option', null, v.id === 'c' ? 'A community plugin (will not be fixed here)' : 'Not sure / the whole thing'))),
        h('div', null, lab('What happened? What did you expect? How can it be repeated?'), h('textarea.desc', { placeholder: 'For example: I opened the Bank and ...' })),
        h('div', null, lab('Diagnostics added to the report (versions and which plugins are on; no name, no webhooks)'), h('pre.diag', null, diag)),
        h('div.row', null, h('span.note', null, v.id === 'c' ? 'Community plugins are supported by their own authors, not here.' : 'Needs a free GitHub account. Or copy it and send it however you like.'), h('button.b.copy', { type: 'button' }, 'Copy report'), h('button.b.p.gh', { type: 'button' }, 'Open on GitHub')));
      el._bd.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      return el;
    },
  });

  // =================================================================== Welcome tour (welcome-tour.js)
  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="28" height="28"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="48" height="12" fill="#ffd24a"/><rect x="70" y="58" width="24" height="12" fill="#ffd24a"/><rect x="34" y="70" width="48" height="12" fill="#ffd24a"/></svg>';
  const KB = (k) => ' <kbd>' + k + '</kbd>';
  const MOCKCHIP = 'display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:10px;background:#10101a;border:1px solid #2e2e42;color:#dcdce8;font-size:13px;';
  const TOUR = {
    welcome: { title: 'Welcome to ScapeLite', n: '1 / 5', i: 0, tot: 5, body: '<p>ScapeLite adds optional <b>plugins</b> to Scapewatch: better panels, route advice, extra tooltips, notifications and more.</p><p>Everything is <b>display-only</b>. It shows you things and tidies the interface, but never plays or clicks for you.</p><p>This short tour shows you where everything lives. It takes about a minute.</p>' },
    market: { title: 'The plugin marketplace', n: '4 / 5', i: 3, tot: 5, body: '<p>Browse every plugin, read what it does and see screenshots in the <b>marketplace</b>:</p><p>Press <b>Add</b> to turn a plugin on (it appears in the game right away, no reload) and <b>Remove</b> to turn it off again. Plugins made by the ScapeLite team carry a <b>ScapeLite</b> tag; community plugins show their author.</p><p>You can open it from the dashboard (<i>Plugins ▸</i>) or directly:</p>', link: 'http://scapelite.localhost/marketplace', action: 'Open the marketplace' },
    chips: { title: 'What’s new · Compact chips', n: '3 / 7', i: 2, tot: 7, body: '<p>Press the <b>dash</b> in a panel’s title bar and it folds into a small <b>chip</b> that still shows what matters:</p><p><span style="' + MOCKCHIP + '"><b style="color:#ffd24a">Goals</b> Fish 48 → 50 · 41 min</span></p><p><span style="' + MOCKCHIP + '"><b style="color:#ffd24a">XP Tracker</b> 20.7k XP/hr</span></p><p>Click a chip to open the full panel again.</p>' },
    editor: { title: 'What’s new · The Layout Editor', n: '2 / 7', i: 1, tot: 7, body: '<p>Press' + KB('Ctrl') + '+' + KB('Alt') + '+' + KB('L') + ' (or <b>Edit Layout</b> in the ScapeLite menu) and every panel gets a frame:</p><ul><li><b>Drag</b> it: it snaps to screen edges and other panels (hold' + KB('Shift') + ' to move freely, arrow keys nudge).</li><li><b>Lock</b> it, make it <b>see-through</b>, <b>fade it</b> when the mouse is away, make it bigger or smaller.</li><li>Save the whole arrangement as a <b>named layout</b> and share it as text.</li></ul>', run: 'Try it now' },
    setup: { title: 'Setup · How do you play?', n: '1 / 1', i: 0, tot: 1, body: '<p>A few quick questions so ScapeLite’s advice fits you. Every answer can be changed later in <b>Settings → Plugins</b>.</p>', ask: [['Which combat style do you play, or plan to?', [['Melee', 'Mine → Smith', 1], ['Ranged', 'Forage → Craft'], ['Magic', 'Invoke → Imbue'], ['No preference', 'every skill evenly, lowest first']]], ['Teleport crystals for travel?', [['Only when it pays', 'saves enough time per charge', 1], ['On foot', 'plan without teleports'], ['Use them freely', 'fastest possible']]]], slider: true, last: true },
  };
  function tourCard(t) {
    const body = h('div.w-body'); body.innerHTML = t.body;
    if (t.link) { body.appendChild(h('div.w-link', null, h('div.w-url', null, t.link), h('button.cc-btn', { 'data-v': 'primary', type: 'button' }, t.action + ' ↗'))); body.appendChild(h('div.w-fb', null, 'If that address does not open, use localhost:7777/marketplace')); }
    if (t.run) body.appendChild(h('div.w-link', null, h('button.cc-btn', { 'data-v': 'primary', type: 'button' }, t.run)));
    (t.ask || []).forEach(([q, opts]) => {
      body.appendChild(h('div', { style: { margin: '12px 0 4px' } }, h('div', { style: { fontWeight: '600', color: '#fff', marginBottom: '6px', fontSize: '13.5px' } }, q), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, opts.map(([l, s, on]) => h('button', { type: 'button', style: { textAlign: 'left', padding: '6px 12px', borderRadius: '9px', border: '1px solid ' + (on ? '#4a90e2' : '#3a3a4a'), background: on ? 'rgba(74,144,226,.2)' : '#23232f', color: on ? '#e6f1ff' : '#ddd' } }, h('div', { style: { fontSize: '13px' } }, l), h('div', { style: { fontSize: '11px', color: '#8a8a99' } }, s))))));
    });
    if (t.slider) body.appendChild(h('div', { style: { margin: '12px 0 4px' } }, h('div', { style: { fontWeight: '600', color: '#fff', marginBottom: '6px', fontSize: '13.5px' } }, 'How big should ScapeLite’s panels be?'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('input', { type: 'range', min: '50', max: '200', value: '100', style: { flex: '1', accentColor: 'var(--cc-accent,#ffd24a)' } }), h('b', { style: { minWidth: '46px', textAlign: 'right', color: 'var(--cc-accent,#ffd24a)' } }, '100%'))));
    const logo = h('div.w-logo'); logo.innerHTML = LOGO;
    const dots = h('div.w-dots.cc-dots', null, Array.from({ length: t.tot }, (_, i) => h('i' + (i === t.i ? '.on' : ''))));
    const foot = h('div.w-foot', null, dots, t.i < t.tot - 1 ? h('button.cc-btn', { 'data-v': 'quiet', type: 'button' }, 'Skip') : null, t.i > 0 ? h('button.cc-btn', { type: 'button' }, 'Back') : null, h('button.cc-btn', { 'data-v': 'primary', type: 'button' }, t.ask ? 'Save' : t.i === t.tot - 1 ? 'Got it' : 'Next'));
    return h('div.w-card', null, h('div.w-head', null, logo, h('h2', null, t.title), h('span.w-step', null, t.n)), body, foot);
  }
  add({
    id: 'welcome-tour', cat: 'Modals', title: 'Welcome tour', desc: 'The first-run popup over a scrim: logo, step title and counter, body text, an optional link or action button, dots and Skip / Back / Next. The same card shows the UI tour and the play-style setup questions.',
    keywords: 'welcome tour first run modal setup questions steps dots skip scrim marketplace layout chips', covers: [],
    variants: [{ label: 'Modal, step 1', box: [600, 460], id: 'welcome' }, { label: 'Modal, link step', box: [600, 520], id: 'market' }, { label: 'Modal, UI tour (chips)', box: [600, 460], id: 'chips' }, { label: 'Modal, UI tour (action button)', box: [600, 500], id: 'editor' }, { label: 'Modal, setup questions', box: [600, 640], id: 'setup' }],
    render(ctx, v) { return h('div#cc-welcome', { style: { position: 'absolute', inset: '0' } }, tourCard(TOUR[v.id])); },
  });

  // =================================================================== Craft Potential (craft-potential.js)
  function potWindow(o) {
    const bar = h('div.header-xp-bar.lsp-xpbar', null, h('div.header-xp-bar-fill.fill', { style: { width: '46%' } }), h('div.header-xp-bar-label.lbl', null, 'Level 37 · 112,836 XP'));
    bar.appendChild(h('div.cc-pot-fill', { style: { left: '46%', width: o.lvls ? '54%' : '22%' } }));
    bar.appendChild(h('div.cc-pot-lbl', null, o.lvls ? '✦ +' + o.lvls + (o.lvls === 1 ? ' level' : ' levels') + ' + 61%' : '✦ +4.2k XP → 68%'));
    const kids = [bar];
    if (o.lvls) {
      const chips = []; const n = o.lvls;
      const lv = []; for (let x = 38; x < 38 + n; x++) lv.push(x);
      const show = lv.length > 7 ? lv.slice(0, 3).concat([null], lv.slice(-3)) : lv;
      show.forEach((x) => chips.push(x == null ? h('span.cc-pot-more', null, '… +' + (lv.length - 6) + ' more …') : h('span.cc-pot-chip', null, 'Lv ' + x)));
      chips.push(h('span.cc-pot-chip.part', null, h('i', { style: { width: '61%' } }), h('span', null, '61% → ' + (38 + n))));
      kids.push(h('div.cc-pot-row', null, h('span.hd', null, 'Potential'), chips, h('span.cc-pot-sum', null, '+10,695 XP from 220 crafts')));
    }
    return h('div.lsp-win', { style: { width: '460px' } }, h('div.lsp-wh', null, skImg('smith'), 'Smith'), h('div', { style: { padding: '0' } }, kids), h('div.lsp-wb', { style: { color: '#8d8da0', fontSize: '13px' } }, '175 [T0] Copper Bar in bank · recipes below'));
  }
  add({
    id: 'craft-potential', cat: 'Overlays', title: 'Crafting Potential bar', desc: 'In the Smith / Craft / Imbue / Brew windows the XP bar also shows what you could reach by crafting with everything in your bank: striped gold fill and a label, plus a row of level chips when it is whole levels.',
    keywords: 'craft potential xp bar bank levels chips stripes smith brew imbue', covers: [],
    variants: [{ label: 'Within a level', id: 'in' }, { label: 'One level and a part', id: 'one', n: 1 }, { label: 'Many levels (chips fold)', id: 'many', n: 12 }],
    render(ctx, v) { return potWindow({ lvls: v.n || 0 }); },
  });
  add({
    id: 'craft-potential-tip', cat: 'Tooltips and popovers', title: 'Crafting Potential tooltip', desc: 'Hover the potential bar or row: a card listing each recipe you would craft (new collection entries first), the materials, the count and the XP, and a totals footer.',
    keywords: 'craft potential tooltip recipes materials collection log star total crafts', covers: [],
    variants: [{ label: 'Tooltip', id: 't' }],
    render() {
      const rows = [['copper_bar', '★ Copper Helmet', true, [['copper_bar', 5]], 1, 480], ['iron_bar', 'Iron Platebody', false, [['iron_bar', 8]], 18, 7200], ['mithril_bar', 'Mithril Bar', false, [['mithril_bar', 1]], 201, 3015]];
      const tip = h('div.cc-pot-tip', { style: { position: 'relative', left: 'auto', top: 'auto' } }, h('div.th', null, h('b', null, 'Smith – crafting potential'), h('div', null, 'What you would earn by crafting with everything in your bank. New collection log entries (★) come first, then the most XP per material; nothing is crafted for you.')),
        h('div.tb', null, rows.map(([ic, n, coll, mats, cnt, xp]) => h('div.r', null, itImg(ic), h('div.nm', null, h('span', { style: coll ? { color: '#ffe27a' } : null }, n), h('small', null, mats.map(([m, q]) => [itImg(m), q + '  ']))), h('div.n', null, '×' + cnt), h('div.x', null, '+' + kxp(xp))))),
        h('div.tf', null, '220 crafts · +10,695 XP · Lv 37 (46%) → Lv 39 (61%)  =  +2 levels'));
      return tip;
    },
  });

  // =================================================================== Bank tools (bank-tools.js)
  function bankSlot(it, n, tier, o) { const s = h('div.bank-slot' + (o && o.nw ? '.cc-new' : ''), { style: { opacity: n === 0 ? '.4' : '1' } }, itImg(it), h('b', null, kxp(n)), h('i', null, tier)); return s; }
  const bankSep = (label, folded) => h('div.cc-bank-sep' + (folded ? '.folded' : '') + (label ? '' : '.nolabel'), null, label ? h('span', null, label) : null);
  add({
    id: 'bank-tools', cat: 'Overlays', title: 'Bank Tools', desc: 'Drawn onto the game’s Bank window: a labelled separator between every category group (click to fold), item tooltip category chips, a tidy Settings button, a slot-size slider, and NEW sparkles on items you never held.',
    keywords: 'bank separators categories fold chips size slider new sparkle filter settings', covers: [],
    variants: [{ label: 'Bank window', id: 'bank' }, { label: 'Category chips in an item tooltip', id: 'tip' }],
    render(ctx, v) {
      if (v.id === 'tip') return h('div.lsp-gtip', null, h('div.tt-title', null, 'Raw Crab'), h('span.tt-line', null, 'Held: 581'), h('span.tt-line.dim', null, 'Sells for 12 gold'), h('div.cc-bank-chips', null, h('i', null, 'Raw'), h('b', null, '>'), h('i', null, 'Fish'), h('i.gen', null, 'General'), h('i', null, 'Cook')));
      const bar = h('div.lsp-btnrow', null, h('input.cc-in', { placeholder: 'Search bank…', style: { width: '130px' } }), h('button.bank-filter-btn', null, 'All'), h('button.bank-filter-btn.cc-sub-on', { 'data-cc-sub': 'Fish' }, 'Raw'), h('button.bank-filter-btn', null, 'Equipment'), h('button.bank-filter-menu-btn', null, 'Settings'),
        h('span.cc-bank-size', null, h('svg', { viewBox: '0 0 16 16' }), h('input', { type: 'range', style: { '--p': '55%' } }), h('b', null, '100%')), h('button.cc-bank-new-clear', { type: 'button' }, 'New: 2 · Clear'));
      const grid = h('div.lsp-bank', { style: { width: 'auto' } });
      grid.append(bankSep('Fish'), bankSlot('shrimp', 523, 'T0'), bankSlot('crab', 581, 'T2'), bankSlot('lobster', 600, 'T3', { nw: true }), bankSep('Cook', true), bankSep('Mine'), bankSlot('copper_ore', 1528, 'T0'), bankSlot('iron_bar', 959, 'T2'), bankSlot('mithril_bar', 22, 'T4'), bankSlot('gold', 0, ''));
      return h('div.lsp-win', { style: { width: '640px' } }, h('div.lsp-wh', null, itImg('gold'), 'Bank'), bar, h('div.lsp-wb', null, grid));
    },
  });
  add({
    id: 'bank-tools-menus', cat: 'Menus', title: 'Bank Tools menus', desc: 'The sub-category dropdown that opens when hovering a bank filter (with item counts) and the Settings menu that holds Sort / Swap / Insert as switches.',
    keywords: 'bank dropdown filter sub category menu settings sort swap insert switch', covers: [],
    variants: [{ label: 'Filter dropdown', id: 'dd' }, { label: 'Settings menu', id: 'set' }],
    render(ctx, v) {
      const pos = { position: 'relative', left: 'auto', top: 'auto' };
      if (v.id === 'dd') return h('div.cc-bank-dd', { style: pos }, h('div.hd', null, 'Raw'), [['crab', 'All raw', 3010, 1], ['raw_crab', 'Fish', 1780], ['copper_ore', 'Ore', 1528], ['battle_root', 'Plants', 92]].map(([ic, l, n, on]) => h('div.it' + (on ? '.on' : ''), null, itImg(ic), h('span', null, l), h('em', null, num(n)))));
      return h('div.cc-bank-set', { style: pos }, h('div.hd', null, 'Bank settings'), [['Sort', 'Keep the bank sorted by category', 1], ['Swap', 'Drag an item onto another to swap them', 0], ['Insert', 'Drag an item to insert it at a spot', 0]].map(([l, s, on]) => h('div.it' + (on ? '.on.act' : ''), null, h('span', null, l, h('br'), h('small', null, s)), on ? h('em', null, 'on') : null, h('div.pill'))), h('div.sep'), h('div.it', null, h('span', null, 'Fold all groups'), h('div.pill')));
    },
  });

  // =================================================================== Combat readout (combat-readout.js)
  add({
    id: 'combat-readout', cat: 'Overlays', title: 'Combat readout', desc: 'Exact numbers drawn on the combat scene’s own bars: HP and Spirit as "57 / 80", the attack timer counting down, plus unrounded attack interval, attacks per second and expected DPS. Faithful mock of the game’s bars; your HP follows the scenario.',
    keywords: 'combat readout hp spirit attack timer dps bars numbers enemy ally', covers: [],
    variants: [{ label: 'You and enemy', id: 'p' }, { label: 'With an ally column', id: 'ally' }],
    render(ctx, v) {
      const M = ctx.M, mine = Math.max(1, Math.round(80 * M.hp / M.hpMax)), bar = (col, f, t) => h('div.lsp-cb', null, h('i', { style: { width: (f * 100) + '%', background: col } }), h('b', null, t));
      const you = h('div', null, h('h6', null, 'You'), bar('#c8342a', mine / 80, mine + ' / 80'), bar('#8a3ca0', 12 / 30, '12 / 30'), bar('#d99a1c', 1.37 / 2.384, '1.37s / 2.384s'), h('div.sm', null, '0.419 attacks/s', h('span', { style: { float: 'right' } }, 'DPS ', h('b', null, '7.82'))));
      const en = h('div', null, h('h6', null, 'Dire Rat'), bar('#c8342a', 20 / 44, '20 / 44'), bar('#d99a1c', 0.8 / 2.1, '0.80s / 2.100s'), h('div.sm', null, '0.476 attacks/s'));
      const al = h('div', null, h('h6', null, ctx.M.party[1][0]), bar('#c8342a', 0.7, '112 / 160'), bar('#8a3ca0', 0.5, '25 / 50'), bar('#d99a1c', 0.4, '0.9s / 2.2s'));
      return h('div.lsp-cbars', { style: { gridTemplateColumns: v.id === 'ally' ? '1fr 1fr 1fr' : '1fr 1fr', width: v.id === 'ally' ? '540px' : '380px' } }, you, en, v.id === 'ally' ? al : null);
    },
  });

  // =================================================================== Hover info (hover-info.js): extras inside the game's own tooltips
  const xbBar = (cur, gain, up) => h('div.cc-xb', null, h('i.cc-xb-cur', { style: { width: cur + '%' } }), h('i.cc-xb-gain' + (up ? '.up' : ''), { style: { left: cur + '%', width: gain + '%' } }));
  add({
    id: 'hover-skill-tooltip', cat: 'Tooltips and popovers', title: 'Skill tooltip: queued XP', desc: 'On the Skills panel each cell shows a striped section for what your queue would add, and its tooltip gets a "Queued tasks" block with a level-up banner, a progress bar and the number of tasks.',
    keywords: 'hover skill tooltip queued xp level up bar cc-skq cc-xb stripe skill cell', covers: [],
    variants: [{ label: 'Tooltip, whole level gained', id: 'up' }, { label: 'Tooltip, within a level', id: 'in' }, { label: 'Skill cell with queued stripe', id: 'cell' }],
    render(ctx, v) {
      if (v.id === 'cell') {
        const cell = (sk, lvl, cur, q, up) => h('div', { style: { position: 'relative', width: '58px', height: '58px', borderRadius: '8px', background: '#1a1a24', border: '1px solid #2e2e42', display: 'grid', placeItems: 'center', color: '#fff', font: '700 13px system-ui' } }, skImg(sk, null), h('span', { style: { position: 'absolute', right: '4px', bottom: '8px', textShadow: '0 0 3px #000' } }, lvl), h('div', { style: { position: 'absolute', left: '4px', right: '4px', bottom: '3px', height: '4px', borderRadius: '2px', background: '#2a2a38', overflow: 'hidden' } }, h('div', { style: { width: cur + '%', height: '100%', background: '#d9a21e' } }), h('div.cc-skq-fill', { style: { left: cur + '%', width: q + '%' } })), up ? h('span', { style: { position: 'absolute', right: '3px', top: '1px', color: 'var(--cc-accent)', fontSize: '10px' } }, '▲') : null);
        return h('div.lsp-row', null, cell('mine', 71, 62, 38, true), cell('farm', 64, 50, 14), cell('vigor', 66, 25, 0), cell('brew', 52, 33, 9));
      }
      const up = v.id === 'up', tip = h('div.lsp-gtip', null, h('div.tt-title', null, 'Mine'), h('span.tt-line', null, 'Level 71'), h('span.tt-line', null, '124,300 / 130,000 XP'), h('span.tt-line.dim', null, '5,700 to next level'));
      const sk = h('span.tt-line.cc-skq');
      if (up) sk.appendChild(h('div.cc-skq-up', null, '★ Levels up: Lv 71 → Lv 72  (+1 level)'));
      sk.append(h('div.cc-skq-h', null, 'Queued tasks: +' + (up ? '9.7k' : '3.2k') + ' XP'), h('div.cc-xb-lv' + (up ? '.up' : ''), null, up ? 'Lv 71: 62% → Lv 72: 14%' : 'Lv 71: 62% → 81%'), up ? xbBar(62, 38, true) : xbBar(62, 19, false), h('div.cc-xb-dim', null, 'from 3 tasks (current + queue)' + (up ? ' · +1 level' : '')));
      tip.appendChild(sk);
      return tip;
    },
  });
  add({
    id: 'hover-quest-tooltip', cat: 'Tooltips and popovers', title: 'Quest reward tooltip', desc: 'A tooltip the game does not have: "Reward on completion" for a quest step, with game icons, the XP and the level range it would give, items and credits.',
    keywords: 'hover quest reward tooltip completion xp level range cc-qr', covers: [],
    variants: [{ label: 'Tooltip', id: 'q' }],
    render() {
      const row = (ico, kind, txt, up) => h('div.cc-qr-row', null, kind === 'item' ? itImg(ico, 'cc-ico') : skImg(ico, 'cc-ico'), h('span', null, txt, up ? h('span.cc-qr-up', null, ' ' + up) : null));
      return h('div.lsp-gtip', null, h('div.tt-title', null, 'Reward on completion'), h('div.cc-qr', null, row('brew', 'skill', '+5,100 Brew XP', 'Lv 25 → 27'), row('alms', 'skill', '+5,100 Alms XP', null), row('calm_potion', 'item', '15× Calm Potion'), row('gold', 'item', '500× Gold'), h('div.cc-xb-dim', { style: { marginTop: '3px' } }, '+20 reroll credits')));
    },
  });
  add({
    id: 'hover-task-xp', cat: 'Tooltips and popovers', title: 'Task XP preview', desc: 'On a queued task’s tooltip: XP for the task, the level it reaches, a bar, and (for slay tasks) the Slay XP and combat XP split into chips with game icons, plus time.',
    keywords: 'hover task xp preview slay kill chips cc-hover-xp cc-hover-slayxp cc-sx', covers: [],
    variants: [{ label: 'Skilling task', id: 'skill' }, { label: 'Slay task (kills)', id: 'slay' }],
    render(ctx, v) {
      if (v.id === 'slay') {
        const chip = (sk, t) => h('span.cc-sx-chip', null, skImg(sk, 'cc-ico'), t);
        return h('div.lsp-gtip', null, h('div.tt-title', null, 'Slay Dustclaw Raider'), h('span.tt-line', null, '150 kills · 22m'),
          h('span.tt-line.cc-hover-slayxp', null, h('div.cc-sx-head', null, h('b', null, '+6.1k XP'), h('span.cc-sx-dim', null, '4.1k XP/hr')), h('div.cc-sx-chips', null, chip('slay', '2,100 Slay'), chip('strike', '1,950 Strike'), chip('life', '1,300 Life'), chip('dodge', '750 Dodge')), h('div.cc-sx-note.cc-sx-dim', null, 'An estimate: ignores overkill and combat-XP bonuses.')));
      }
      return h('div.lsp-gtip', null, h('div.tt-title', null, 'Mine 174 Tin Ore'), h('span.tt-line', null, 'Windhollow Vein · 16m'), h('span.tt-line.cc-hover-xp', null, h('div.cc-xb-head', null, h('b', null, '+2,574 XP'), h('span.cc-xb-dim', null, '9.6k XP/hr')), h('div.cc-xb-lv', null, 'Lv 71: 62% → Lv 71: 87%'), xbBar(62, 25, false)));
    },
  });

  // =================================================================== Pinned info-bar cards (ui-bar.js cc-card-<tab>)
  function ccxPanel(tab, title, w, kids, o) {
    const el = kitPanel({ id: 'cc-card-' + tab, title, chip: '', w, cls: 'cc-card-pin', hgt: (o && o.hgt) || null }, kids);
    el._bd.classList.add('ccx'); return el;
  }
  const skillGrid = (M, cols, cs) => {
    const trainedIds = trained({ S: { mode: 'idle' }, M }).map((t) => t.id), g = h('div.tg', { style: { gridTemplateColumns: 'repeat(' + cols + ',' + cs + 'px)', '--cs': cs + 'px', '--cols': String(cols) } });
    M.skills.forEach((s) => {
      const col = s.frac >= 0.85 ? 'var(--cc-good)' : s.frac >= 0.5 ? 'var(--cc-info)' : s.frac >= 0.25 ? 'var(--cc-warn)' : 'var(--cc-bad)', ti = trainedIds.indexOf(s.id);
      const c = h('div.tcell', null, skImg(s.id), h('b', null, String(s.lvl)), h('u', null, h('s', { style: { width: Math.round(s.frac * 100) + '%', background: col } }), ti >= 0 ? h('s.q', { style: { left: Math.round(s.frac * 100) + '%', width: Math.min(100 - Math.round(s.frac * 100), 10 + ti * 3) + '%' } }) : null), ti === 0 ? h('em.tup', null, '▲') : null);
      g.appendChild(c);
    });
    g.appendChild(h('div.tcell.total', { style: { gridColumn: 'span ' + (cols - (M.skills.length % cols || cols) + 1 > 0 ? cols : cols) } }, h('span.tl-l', null, 'Total level'), h('span.tl-v', null, String(M.skills.reduce((t, s) => t + s.lvl, 0)))));
    return g;
  };
  add({
    id: 'card-skills', cat: 'Panels', title: 'Pinned card: Skills', desc: 'The info bar’s Skills card pinned as a movable panel: a grid of skill cells (level, progress bar, striped queued XP, an arrow when your queue levels it up) and a Total level cell.',
    keywords: 'pinned card skills grid cells total level info bar cc-card-skills ccx tcell queued', covers: [],
    variants: [{ label: 'Panel, 6 columns', id: 'p' }, { label: 'Collapsed chip', id: 'chip' }],
    render(ctx, v) {
      if (v.id === 'chip') return kitPanel({ id: 'cc-card-skills', title: 'Skills', chip: '', min: true, cls: 'cc-card-pin' });
      return ccxPanel('skills', 'Skills', 420, h('div', null, skillGrid(ctx.M, 6, 60)));
    },
  });
  add({
    id: 'card-equipment', cat: 'Panels', title: 'Pinned card: Equipment and rows', desc: 'A card made of sections and item rows (icon, name, stat, count), the form used by Equipment, Inventory lists and Barter; hover a row for the detail card.',
    keywords: 'pinned card equipment inventory rows section tr ts tn tc ccx', covers: [],
    variants: [{ label: 'Panel', id: 'p' }],
    render() {
      const row = (ic, n, st, c) => h('div.tr.hv', null, itImg(ic), h('span.tn', null, n), st ? h('span.tx', null, st) : null, h('span.tc', null, c));
      return ccxPanel('equipment', 'Equipment', 400, h('div.tfit', null,
        h('div.ts', null, h('b', null, 'Weapons'), h('span', null, 'Loadout: Melee')), row('copper_axe', 'T3 Ancient Titanium Axe', '+46 max hit', '1'), row('copper_dagger', 'T2 Mithril Dagger', '+31 max hit', '1'),
        h('div.ts', null, h('b', null, 'Armour'), h('span', null, '5 pieces')), row('chitin_body', 'T4 Chitin Body', '+88 armour', '1'), row('chitin_coif', 'T4 Chitin Coif', '+41 armour', '1'), row('copper_belt', 'T1 Copper Belt', '+9 armour', '1')));
    },
  });
  add({
    id: 'card-quests', cat: 'Panels', title: 'Pinned card: Quests', desc: 'Quest and diary cards: tab chips, then one progress row per step (name, right-hand figure, sub text, thin bar), a green edge on the step you can complete now.',
    keywords: 'pinned card quests diary progress rows tq tqb tabs chips ccx', covers: [],
    variants: [{ label: 'Panel', id: 'p' }],
    render() {
      const q = (n, r, s, f, tone) => h('div.tq' + (tone ? '.' + tone : '') + '.clk', { role: 'button' }, h('div.tql', null, h('b', null, n), h('span', null, r)), h('div.tqs', null, s), h('div.tqb', null, h('i', { style: { width: Math.round(f * 100) + '%' } })));
      return ccxPanel('quests', 'Quests', 400, h('div.tfit', null, h('div.ttabs', null, ['Active', 'Available', 'Done'].map((t, i) => h('button.cc-chip' + (i === 0 ? '.on' : ''), { type: 'button' }, t))),
        q('The Frozen Forge', '3 / 5', 'Deliver 40 Tin Bar to Ridgetop Mine — ready now', 0.6, 'good'), q('Moss and Memory', '1 / 4', 'Gather 120 Moss in Birchwood', 0.25), q('Quiet Hands', '4 / 6', 'Pickpocket 30 times', 0.66)));
    },
  });

  // =================================================================== Settings > Plugins page (plugins-settings-ui.js)
  add({
    id: 'settings-plugins-page', cat: 'Windows', title: 'Settings > Plugins page', desc: 'ScapeLite’s own settings page inside the game’s Settings window: a group head with a fading rule, then sections made of the game’s own rows (label, description, switch) with a ScapeLite tag beside the title. The game’s chrome here is an imitation.',
    keywords: 'settings plugins page section toggle switch group head author tag nav rows', covers: [],
    variants: [{ label: 'Group head + two sections', id: 's' }],
    render() {
      const tg = (label, desc, on) => h('div.settings-toggle-row', null, h('div.settings-toggle-text', null, h('div.settings-toggle-label', null, label), desc ? h('div.settings-toggle-desc', null, desc) : null), h('div.settings-switch' + (on ? '.on' : ''), null, h('div.settings-switch-knob')));
      const tag = h('span.cc-author', { title: 'Made by the ScapeLite team', style: { marginLeft: '12px', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--cc-accent)', padding: '3px 7px', border: '1px solid rgba(255,210,74,.4)', background: 'rgba(255,210,74,.12)', borderRadius: '10px', display: 'inline-block' } }, 'ScapeLite');
      const sel = (label, desc, val) => h('div.settings-toggle-row', null, h('div.settings-toggle-text', null, h('div.settings-toggle-label', null, label), h('div.settings-toggle-desc', null, desc)), h('select.cc-sel', null, h('option', null, val)));
      return h('div.lsp-set', null,
        h('div.settings-header-nav', null, ['Build', 'Display', 'Audio', 'Plugins'].map((t) => h('button.settings-nav-btn' + (t === 'Plugins' ? '.on' : ''), { type: 'button' }, t))),
        h('div.cc-group-head', { 'data-cc-group': 'User Interface' }, 'User Interface'),
        h('div.settings-section', null, h('div.settings-section-header', null, 'HP Panel', tag), tg('Show the HP panel', 'Your hit points in a small panel of its own.', true), sel('Style', 'A bar, or a heart and numbers.', 'Bar'), tg('Numbers on the bar', '', true), tg('Hide the game’s own HP bar', 'Needs the HP panel on.', false)),
        h('div.settings-section', null, h('div.settings-section-header', null, 'Panels', tag.cloneNode(true)), sel('Colours', 'ScapeLite, match the game, or colour-blind safe.', 'ScapeLite'), tg('Snap panels to screen edges', 'Panels stick to edges and to each other.', true)));
    },
  });

  // =================================================================== Raid DPS extras (raid-dps-extra.js)
  const RD_COL = ['#5fe06d', '#4ea3ff', '#ffb84a', '#ff6f91', '#b48cff'];
  function rdpsPanel(ctx, o) {
    const P = ctx.M.party, dps = [P[0], P[1], P[3], P[2]].map((p, i) => ({ n: p[0], r: [118, 92, 64, 41][i], d: [31200, 24100, 16800, 10900][i] }));
    const tot = dps.reduce((t, x) => t + x.d, 0), rate = dps.reduce((t, x) => t + x.r, 0);
    const tabs = h('div.raid-contrib-tabs' + (o.graph ? '.cc-rdps-4' : ''), null, h('button.raid-contrib-tab' + (o.graph ? '' : '.active'), null, 'DPS Current'), h('button.raid-contrib-tab', null, 'DPS Total'), h('button.raid-contrib-tab', null, 'Recap'), h('button.raid-contrib-tab.cc-rdps-tab' + (o.graph ? '.active' : ''), null, 'Graph'));
    const el = h('div.lsp-rdps', null, h('div.raid-contrib-progress', null, h('span.raid-contrib-name', null, 'Battlefrost Smithy (4/7)'), h('span', null, '03:12')), tabs);
    if (!o.graph) {
      el.appendChild(h('div.raid-contrib-dps', null, dps.map((p, i) => h('div.raid-contrib-row' + (i === 1 ? '.is-self' : ''), null, h('span.raid-contrib-name', null, p.n), h('span.raid-contrib-dmg', null, num(p.d) + ' · ' + p.r + '/s'), h('div.raid-contrib-bar', null, h('i', { style: { width: (p.d / dps[0].d * 100) + '%', background: RD_COL[i] } })))),
        h('div.cc-rdps-total', null, h('span.n', null, 'Party'), h('b', null, num(tot)), h('span.s', null, '· ' + rate + '/s combined'))));
      return el;
    }
    const W = 280, Hh = 150, c = h('canvas'), dpr = window.devicePixelRatio || 1; c.width = W * dpr; c.height = Hh * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lines = dps.map((p, i) => ({ c: RD_COL[i], v: wave(40, p.r, i * 1.3, false) })), party = lines[0].v.map((_, k) => lines.reduce((t, l) => t + l.v[k], 0)), max = Math.max(...party) * 1.1, pl = 34, pt = 8, pw = W - pl - 6, ph = Hh - pt - 16;
    g.font = '10px system-ui'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#7f7f8e';
    for (let i = 0; i <= 3; i++) { const y = pt + ph - i / 3 * ph; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - 6, y); g.stroke(); g.textAlign = 'right'; g.fillText(String(Math.round(max * i / 3)), pl - 4, y + 3); }
    lines.concat([{ c: '#ffffff', v: party, party: true }]).forEach((l) => { g.beginPath(); l.v.forEach((v, k) => { const x = pl + k / 39 * pw, y = pt + ph - v / max * ph; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = l.c; g.lineWidth = l.party ? 2.4 : 1.6; g.stroke(); });
    const cv = c; cv.style.cssText = 'display:block;width:100%;height:150px;border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08)';
    const gr = h('div.cc-rdps-graph.show', null,
      h('div.bar', null, [['DPS', 1], ['Total damage', 0]].map(([t, on]) => h('button' + (on ? '.on' : ''), { type: 'button' }, t))),
      h('div.bar.sm.rng', null, [['Current fight', 1], ['Entire raid', 0], ['1 min', 0], ['5 min', 0]].map(([t, on]) => h('button' + (on ? '.on' : ''), { type: 'button' }, t))),
      h('div.bar.sm.smo', null, h('span', { style: { color: '#8f8fa4', alignSelf: 'center' } }, 'Smoothing'), [['Off', 0], ['Low', 0], ['Medium', 1], ['High', 0]].map(([t, on]) => h('button' + (on ? '.on' : ''), { type: 'button' }, t))), cv,
      h('div.leg', null, dps.map((p, i) => h('span' + (i === 3 ? '.off' : ''), null, h('i', { style: { background: RD_COL[i] } }), p.n)).concat([h('span', null, h('i', { style: { background: '#fff' } }), 'Party')])),
      h('div.tip', null, 'Damage per second, averaged over 15 s. Hover a name for details, click to hide it.'));
    if (o.ptip) gr.appendChild(h('div.cc-rdps-ptip', { style: { left: '120px', top: '50px' } }, h('div.th', null, 'Fight 1:20 · DPS'), dps.map((p, i) => h('div.tr', null, h('i', { style: { background: RD_COL[i] } }), h('span', null, p.n), h('b', null, p.r + '/s'))), h('div.tr.party', null, h('i', { style: { background: '#fff' } }), h('span', null, 'Party'), h('b', null, rate + '/s'))));
    el.appendChild(gr);
    return el;
  }
  add({
    id: 'raid-dps-extra', cat: 'Overlays', title: 'Raid DPS extras', desc: 'Added to the game’s Raid DPS panel: a Party line (everyone’s damage and combined DPS) under the player rows and a Graph tab with metric, range and smoothing buttons, a canvas and a legend. The game’s own panel is imitated; the party comes from the scenario.',
    keywords: 'raid dps party line graph tab smoothing range legend damage per second', covers: [],
    variants: [{ label: 'Party line under the rows', id: 'party' }, { label: 'Graph tab', id: 'graph' }, { label: 'Graph tab, hover readout', id: 'ptip' }],
    render(ctx, v) { return rdpsPanel(ctx, { graph: v.id !== 'party', ptip: v.id === 'ptip' }); },
  });
  add({
    id: 'raid-dps-tooltip', cat: 'Tooltips and popovers', title: 'Raid DPS legend tooltip', desc: 'Hovering a player name in the graph legend: DPS now, typical range (10th to 90th percentile), average, damage and share for the chosen range.',
    keywords: 'raid dps legend tooltip range average share percentile', covers: [],
    variants: [{ label: 'Tooltip', id: 't' }],
    render(ctx) {
      return h('div.cc-rdps-tip', { style: { position: 'relative' } }, h('b', { style: { color: RD_COL[1] } }, ctx.M.party[1][0]), [['DPS now', '92/s'], ['DPS range', '71 – 110/s'], ['Average', '88/s'], ['Damage', '24,100'], ['Share', '29.2%']].map(([a, b]) => h('div', null, h('span', null, a), h('i', null, b))), h('small', null, 'in this fight. Range = typical DPS, ignoring the highest and lowest 10%.'));
    },
  });

  // =================================================================== covers: ids from design-lab/names.json (docs/UI-NAMING.md)
  const COVERS = { "xp-tracker": [ "xp-tracker-panel", "xp-tracker-panel.header.icon", "xp-tracker-panel.header.total", "xp-tracker-panel.time-frame-chips", "xp-tracker-panel.custom-frame-editor", "xp-tracker-panel.view-chips", "xp-tracker-panel.graph", "xp-tracker-panel.focus-line", "xp-tracker-panel.skill-list", "xp-tracker-panel.footer", "xp-skill-row" ], "goals": [ "goals-panel", "goals-panel.section-heading", "goals-panel.add-form", "goal-skill-row" ], "hp-panel": [ "hp-panel", "hp-panel.handle", "hp-panel.heart", "hp-panel.bar", "hp-panel.number" ], "material-shortage": [ "materials-panel", "materials-panel.shortage-row" ], "drop-luck": [ "drop-luck-panel", "drop-luck-panel.tab-strip", "drop-luck-panel.tab-strip.tab", "drop-luck-panel.overview-tab.hero", "drop-luck-panel.overview-tab.luck-meter", "drop-luck-panel.overview-tab.stat-row", "drop-luck-panel.section-heading", "drop-luck-panel.search", "drop-luck-panel.mob-picker", "drop-luck-panel.more-button", "drop-luck-row", "pet-card", "shiny-bar-card" ], "fortress-tracker": [ "drop-luck-panel.fortress-tab", "drop-luck-panel.fortress-tab.live-run-card", "drop-luck-panel.fortress-tab.status-badge", "drop-luck-panel.fortress-tab.pills", "drop-luck-panel.fortress-tab.tier-table", "drop-luck-panel.fortress-tab.run-details", "drop-luck-panel.fortress-tab.run-log", "fortress-log-item" ], "chat-panel": [ "chat-panel", "chat-panel.channel-strip", "chat-panel.channel-strip.channel-chip", "chat-panel.channel-strip.search-button", "chat-panel.find-bar", "chat-panel.message-list", "chat-panel.jump-button", "chat-panel.composer", "chat-panel.composer.channel-button", "chat-panel.settings-sheet", "chat-panel.settings-sheet.sheet-header", "chat-panel.settings-sheet.setting-row", "chat-message" ], "tree-advisor": [ "tree-advisor-panel", "tree-advisor-panel.tab-strip", "tree-advisor-panel.tab-strip.tab", "tree-advisor-panel.body", "tree-advisor-panel.body.hero", "tree-advisor-panel.body.section-heading", "tree-advisor-panel.body.step-row" ], "tree-advisor-drawer": [ "tree-map-drawer", "tree-map-drawer.tab", "tree-map-drawer.header", "tree-map-drawer.legend", "tree-advisor-panel.body.tree-preview", "tree-advisor-panel.body.legend" ], "lever-advisor": [ "lever-advisor-drawer", "lever-advisor-drawer.tab", "lever-advisor-drawer.tab.badge", "lever-advisor-drawer.box", "lever-advisor-drawer.header", "lever-advisor-drawer.body", "lever-advisor-drawer.route-select", "lever-advisor-drawer.summary", "lever-advisor-drawer.pick-list", "lever-advisor-drawer.pick-list.item", "lever-advisor-drawer.why-details", "skills-customization-window", "skills-customization-window.lever-button", "lever-pull-outline", "lever-release-outline" ], "route-advisor": [ "route-advisor-panel", "route-advisor-panel.header", "route-advisor-panel.header.title", "route-advisor-panel.header.best-pill", "route-advisor-panel.header.close-button", "route-advisor-panel.calc-strip", "route-advisor-panel.body", "route-advisor-panel.body.teleport-mode-row", "route-advisor-panel.body.picks-row", "route-advisor-panel.body.teleport-upsell", "route-advisor-panel.body.what-you-could-gain", "route-advisor-panel.body.note", "route-advisor-panel.body.why-box", "route-plan-card", "route-plan-card.title", "route-plan-card.bar", "route-plan-card.stats", "route-plan-card.steps-button", "route-plan-card.stops-list", "route-current-queue-card", "route-plan-card.selected", "route-plan-card.best" ], "route-advisor-map": [ "route-map-drawer", "route-map-drawer.tab", "route-map-drawer.header", "route-map-drawer.legend" ], "route-advisor-alert": [ "route-advisor-badge", "route-advisor-badge.button", "route-advisor-badge.dismiss", "route-advisor-badge.mode", "route-advisor-badge.optimal" ], "walking-countdown": [ "walking-countdown", "walking-countdown.destination", "walking-countdown.time-bar", "walking-countdown.vigor-bar", "walking-countdown.titlebar", "walking-countdown.resize-handle" ], "walking-drawer": [ "walking-countdown-drawer" ], "layout-editor": [ "layout-editor-bar", "layout-editor-frame", "layout-editor-frame.toolbar", "layout-editor-frame.resize-corner", "layout-editor-frame.state" ], "tab-group-strip": [ "group-tab-strip" ], "bug-report": [ "bug-report-panel", "bug-report-panel.scope-note", "bug-report-panel.diagnostics" ], "welcome-tour": [ "welcome-tour", "welcome-tour.dialog", "welcome-tour.dialog.header", "welcome-tour.dialog.body", "welcome-tour.dialog.link-row", "welcome-tour.dialog.footer" ], "craft-potential": [ "crafting-window", "crafting-windows.xp-bar", "craft-potential-fill", "craft-potential-label", "craft-potential-row", "craft-potential-row.level-chip" ], "craft-potential-tip": [ "craft-potential-tooltip" ], "bank-tools": [ "bank-window", "bank-window.toolbar", "bank-window.grid", "bank-window.grid.slot", "bank-category-separator", "bank-size-slider", "bank-new-sparkle", "bank-new-clear-button", "game-tooltip.bank-categories" ], "bank-tools-menus": [ "bank-filter-dropdown", "bank-settings-menu" ], "combat-readout": [ "combat-readout", "combat-readout.bar-label", "combat-readout.dps-line" ], "hover-skill-tooltip": [ "game-tooltip", "game-tooltip.skill-queue-badge" ], "hover-quest-tooltip": [ "game-tooltip.quest-lines" ], "hover-task-xp": [ "game-tooltip.task-xp-preview", "game-tooltip.slay-xp-block" ], "card-skills": [ "skills-pinned-card", "pinned-card" ], "card-equipment": [ "equipment-pinned-card", "inventory-pinned-card", "barter-pinned-card" ], "card-quests": [ "quests-pinned-card", "diary-pinned-card" ], "settings-plugins-page": [ "settings-window.plugins-page", "settings-window.plugins-page.group-heading", "settings-window.plugins-page.author-tag", "settings-window.plugins-page.row-types", "settings-window", "settings-window.header-nav", "settings-window.header-nav.plugins-button", "settings-window.section", "settings-window.section.header", "settings-window.section.toggle-row" ], "raid-dps-extra": [ "game-raid-dps-panel", "game-raid-dps-panel.tab", "game-raid-dps-panel.party-line", "game-raid-dps-panel.graph-view", "raid-dps-graph-tooltip" ], "raid-dps-tooltip": [ "raid-dps-info-tip" ]
};
  Object.keys(COVERS).forEach((id) => { const sp = Lab.specs.find((s) => s.id === id); if (sp) sp.covers = COVERS[id]; });

})();
