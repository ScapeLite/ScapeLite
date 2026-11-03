// ScapeLite UI core. Display only. Three jobs for every ScapeLite panel:
//  1. Scale: the game scales its whole interface to the window (it zooms #ui-container), but ScapeLite's floating panels sit
//     outside it, so in a small window they looked huge. This reads the game's scale and applies the same scale to every panel (CSS
//     `scale`, anchored at the top-left corner, so saved positions stay valid). window.__ccScale holds the factor.
//  2. Theme: one shared look (colours, corners, header, buttons, thin scrollbars) so all panels match.
//  3. Layering: clicking a panel brings it to the front; window.__ccNextPos() gives staggered first-open positions.
//  4. Resizing: every panel gets a corner handle (double-click it to reset); sizes are remembered. Right-click a panel's title for size
//     presets (50-150%). The Settings / first-launch setup "Panel size" slider scales every ScapeLite panel at once.
(function () {
  'use strict';
  const NS = '__ccUiScale';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const life = window.__ccLife.scope('ui-scale');   // every page listener and timer below goes through it, so a re-inject cannot leave a second copy
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const on = () => !!setting('uiScaleEnabled', true);
  const themeOn = () => !!setting('uiThemeEnabled', true);
  const IDS = ['cc-route-panel', 'cc-route-map', 'cc-route-maptab', 'cc-xp-tracker', 'cc-lever-panel', 'cc-matshort', 'cc-slmenu', 'cc-goals', 'cc-bugreport', 'cc-droplog', 'cc-treeadv', 'cc-treeadv-drawer', 'cc-treeadv-tab'];
  const BOXES = ['cc-route-panel', 'cc-xp-tracker', 'cc-lever-panel', 'cc-matshort', 'cc-slmenu', 'cc-goals', 'cc-bugreport', 'cc-droplog', 'cc-route-map', 'cc-treeadv'];
  const tsel = (ids, suffix) => ids.map((i) => 'body.cc-themed #' + i + (suffix || '')).join(',');   // every selector gets the prefix, so the theme can be switched off
  const sel = (ids, suffix) => ids.map((i) => '#' + i + (suffix || '')).join(',');
  let last = 1;
  const RESIZABLE = ['cc-xp-tracker', 'cc-lever-panel', 'cc-goals', 'cc-droplog', 'cc-matshort', 'cc-bugreport', 'cc-treeadv']; // the Route Advisor has its own grip
  const LS_SIZE = (id) => 'cc-size-' + id;
  const LS_MULT = 'cc-panel-mult';
  let mult = {};
  try { mult = JSON.parse(localStorage.getItem(LS_MULT) || '{}') || {}; } catch (e) {}
  // one-time: before the starting-size setting, 100% was never stored, so a stored 1 is not a choice; drop it so those panels get the starting size too
  try { if (!localStorage.getItem(LS_MULT + '-v2')) { Object.keys(mult).forEach((k) => { if (mult[k] === 1) delete mult[k]; }); localStorage.setItem(LS_MULT, JSON.stringify(mult)); localStorage.setItem(LS_MULT + '-v2', '1'); } } catch (e) {}
  const saveMult = () => { try { localStorage.setItem(LS_MULT, JSON.stringify(mult)); } catch (e) {} };
  const HEAD = { 'cc-route-panel': '.rt-head', 'cc-xp-tracker': '.hd', 'cc-lever-panel': '.hd', 'cc-matshort': '.hd', 'cc-goals': '.hd', 'cc-droplog': '.hd', 'cc-treeadv': '.hd' };
  const NAMES = { 'cc-route-panel': 'Route Advisor', 'cc-xp-tracker': 'XP Tracker', 'cc-lever-panel': 'Lever Advisor', 'cc-matshort': 'Materials', 'cc-goals': 'Goals', 'cc-droplog': 'Drop Luck Tracker', 'cc-treeadv': 'Tree Advisor' };

  // ---------------------------------------------------------------- theme
  const style = document.createElement('style');
  style.id = 'cc-theme-style';
  style.textContent = `
:root{--cc-hd:linear-gradient(var(--cc-bg-3),var(--cc-bg-2))}
${tsel(IDS)}{z-index:1100}
body.cc-themed #cc-slmenu{z-index:1950}
${tsel(BOXES)}{background:var(--cc-bg) !important;border:1px solid var(--cc-border) !important;color:var(--cc-text);box-shadow:var(--cc-shadow) !important;font-family:var(--cc-font) !important}
${tsel(['cc-lever-panel', 'cc-matshort', 'cc-slmenu', 'cc-goals', 'cc-bugreport', 'cc-droplog', 'cc-xp-tracker'])}{border-radius:var(--cc-r) !important}
body.cc-themed #cc-route-panel:not([data-map-side]){border-radius:var(--cc-r) !important}
body.cc-themed #cc-treeadv[data-drawer-side=r]{border-top-right-radius:0 !important;border-bottom-right-radius:0 !important}
body.cc-themed #cc-treeadv[data-drawer-side=l]{border-top-left-radius:0 !important;border-bottom-left-radius:0 !important}
${tsel(['cc-route-panel .rt-head', 'cc-lever-panel .hd', 'cc-matshort .hd', 'cc-goals .hd', 'cc-droplog .hd', 'cc-treeadv .hd'])}{background:var(--cc-hd) !important;border-bottom:1px solid var(--cc-border) !important}
${tsel(['cc-route-panel .rt-ttl'])}{color:var(--cc-accent) !important;letter-spacing:.02em}
${tsel(['cc-xp-tracker .xp-ttl', 'cc-lever-panel .hd b', 'cc-matshort .hd b', 'cc-goals .hd b', 'cc-droplog .hd b'])}{color:var(--cc-text) !important;letter-spacing:.02em}
${tsel(['cc-route-panel button', 'cc-lever-panel button', 'cc-bugreport button'])}{background:var(--cc-bg-3);border:1px solid var(--cc-border) !important;border-radius:8px !important;color:var(--cc-text)}
${tsel(['cc-route-panel button:hover', 'cc-lever-panel button:hover', 'cc-bugreport button:hover'])}{background:var(--cc-bg-hover);border-color:var(--cc-border-strong) !important;color:var(--cc-text)}
${tsel(['cc-lever-panel select', 'cc-bugreport textarea', 'cc-bugreport input'])}{background:var(--cc-bg-2) !important;border:1px solid var(--cc-border) !important;border-radius:8px !important;color:var(--cc-text) !important}
${tsel(['cc-lever-panel'])}{font-size:14.5px !important}
${tsel(['cc-matshort'])}{font-size:14.5px !important}
${tsel(['cc-slmenu'])}{font-size:14.5px !important}
${tsel(BOXES, ' *')}{scrollbar-width:thin;scrollbar-color:#3d3d52 transparent}
${tsel(BOXES, ' *::-webkit-scrollbar')}{width:7px;height:7px}
${tsel(BOXES, ' *::-webkit-scrollbar-track')}{background:transparent}
${tsel(BOXES, ' *::-webkit-scrollbar-thumb')}{background:#34344a;border-radius:4px}
${tsel(BOXES, ' *::-webkit-scrollbar-thumb:hover')}{background:#4a4a66}
${tsel(BOXES)}{scrollbar-width:thin;scrollbar-color:#3d3d52 transparent}
/* Route Advisor: same tabs-and-cards look as the other panels */
body.cc-themed #cc-route-panel{font-size:14px !important}
body.cc-themed #cc-route-panel .rt-prefrow{margin-top:7px}
body.cc-themed #cc-route-panel .rt-seg{padding:3px 12px !important;font-size:13px !important;font-weight:600}
body.cc-themed #cc-route-panel .rt-seg.on{background:var(--cc-accent-bg,#2a2518) !important;color:var(--cc-accent,#ffd24a) !important;border-color:var(--cc-accent) !important;box-shadow:inset 0 -2px 0 var(--cc-accent,#ffd24a)}
body.cc-themed #cc-route-panel .rt-plan{background:var(--cc-bg-2) !important;border:1px solid var(--cc-border) !important;border-left:3px solid var(--cc-border-strong) !important;border-radius:8px !important}
body.cc-themed #cc-route-panel .rt-plan:hover{background:var(--cc-bg-3) !important}
body.cc-themed #cc-route-panel .rt-plan.sel{background:var(--cc-accent-bg,#1b1a14) !important;border-left-color:var(--cc-accent,#ffd24a) !important}
body.cc-themed #cc-route-panel .rt-plan.qst{border-left-color:var(--cc-info,#4aa8ff) !important}
body.cc-themed #cc-route-panel .rt-plan.tp{border-left-color:var(--cc-magic,#b07cff) !important}
body.cc-themed #cc-route-panel .rt-plan h4{font-size:14px !important}
body.cc-themed #cc-route-panel .rt-note,body.cc-themed #cc-route-panel .rt-legend{color:var(--cc-text-faint) !important;font-size:12px !important}
body.cc-themed #cc-route-panel .rt-pill{background:var(--cc-bg-3) !important;border:1px solid var(--cc-border)}
body.cc-themed #cc-route-panel .rt-pill.good{background:rgba(95,224,109,.12) !important;border-color:#2d5a3c}
body.cc-themed #cc-route-panel .rt-grip{width:12px !important;height:12px !important;right:4px !important;bottom:4px !important;border-right:2px solid rgba(255,255,255,.35) !important;border-bottom:2px solid rgba(255,255,255,.35) !important;border-radius:0 0 4px 0 !important;opacity:0;transition:opacity .15s,border-color .15s}
body.cc-themed #cc-route-panel:hover .rt-grip{opacity:1}
body.cc-themed #cc-route-panel .rt-grip:hover{border-color:rgba(255,255,255,.7) !important}
.cc-rz{position:absolute;right:4px;bottom:4px;width:12px;height:12px;box-sizing:border-box;cursor:nwse-resize;z-index:6;background:transparent;
  border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);border-radius:0 0 4px 0;transition:border-color .15s;touch-action:none;user-select:none}
.cc-rz{opacity:0;transition:opacity .15s,border-color .15s}
*:hover>.cc-rz,.cc-rz:hover,.cc-rz.drag{opacity:1}
.cc-rz:hover{border-color:rgba(255,255,255,.7)}
#cc-xp-tracker.min .cc-rz{display:none}
#cc-xp-tracker.cc-sized{overflow:auto !important}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- layering
  // Click-to-front, the order of ScapeLite panels against each other and against the game's windows now live in one place: the z-order manager in ui-kit.js (window.__ccUI.z).
  // This file only sets the base z-index of its panels (band 1100-1880); the manager raises a panel when it is opened or pressed. Table: docs/UI-STYLING.md.

  // ---------------------------------------------------------------- resizing
  let rz = null;
  function applySize(el, w, h) {
    if (w) el.style.width = Math.round(w) + 'px';
    if (h) { el.style.height = Math.round(h) + 'px'; el.style.maxHeight = 'none'; el.classList.add('cc-sized'); }
  }
  function ensureGrips() {
    RESIZABLE.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.querySelector(':scope > .cc-rz')) return;
      const g = document.createElement('div'); g.className = 'cc-rz'; g.title = 'Drag to resize · double-click to reset';
      el.appendChild(g);
      if (!el.dataset.ccSizeLoaded) {
        el.dataset.ccSizeLoaded = '1';
        try { const sz = JSON.parse(localStorage.getItem(LS_SIZE(id)) || 'null'); if (sz && sz.w >= 100 && sz.h >= 90) applySize(el, sz.w, sz.h); else if (sz) localStorage.removeItem(LS_SIZE(id)); } catch (e) {}   // a saved size of a hidden or collapsed panel (0 x 0, or a 60 px strip) is junk: ignore and forget it
      }
      g.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const sc = window.__ccScale || 1;
        rz = { el, id, x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight, sc, others: matchTargets(el) }; g.classList.add('drag');
      });
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        el.style.width = ''; el.style.height = ''; el.style.maxHeight = ''; el.classList.remove('cc-sized');
        try { localStorage.removeItem(LS_SIZE(id)); } catch (er) {}
      });
    });
  }
  // Height matching: while you resize a ScapeLite panel its height snaps onto the height of any other open panel within 8 px, and a label names the panel it matches
  // (Settings > Plugins > Panel Mod > Snap to Other Panels' Height; hold Shift to resize freely). The other panels do not change while you drag: measured once.
  const matchOn = () => { try { return window.__ccPluginSettings.get('panelSizeMatchSnap') !== false; } catch (er) { return true; } };
  function matchTargets(el) {
    const out = [];
    document.querySelectorAll('.cc-panel, #ui-container .panel-floating, #cc-route-panel, #cc-xp-tracker').forEach((o) => {
      if (o === el || o.contains(el) || !o.getClientRects().length) return; const b = o.getBoundingClientRect();
      if (b.width < 60 || b.height < 40 || o.classList.contains('min')) return;
      const nm = (o.querySelector('.hd b, .panel-titlebar-label') || {}).textContent; out.push({ h: b.height, name: String(nm || o.id || 'panel').trim().slice(0, 24) });
    });
    return out;
  }
  let matchLbl = null;
  function showMatch(txt, x, y) {
    if (!txt) { if (matchLbl) { matchLbl.remove(); matchLbl = null; } return; }
    if (!matchLbl) { matchLbl = document.createElement('div'); matchLbl.className = 'cc-snapk-lbl'; document.body.appendChild(matchLbl); }
    if (matchLbl.textContent !== txt) matchLbl.textContent = txt; matchLbl.style.left = Math.round(x + 14) + 'px'; matchLbl.style.top = Math.round(y + 14) + 'px';
  }
  const rzMove = (e) => {
    if (!rz) return;
    const mn = String((rz.el && rz.el.dataset.ccMin) || '200,110').split(',').map(Number);   // a panel can ask for a smaller minimum with data-cc-min="w,h"
    const w = Math.max(mn[0] || 200, Math.min(innerWidth / rz.sc - 20, rz.w + (e.clientX - rz.x) / rz.sc));
    let h = Math.max(mn[1] || 110, Math.min(innerHeight / rz.sc - 20, rz.h + (e.clientY - rz.y) / rz.sc)), hit = null;
    if (!e.shiftKey && matchOn() && rz.others) { const hs = h * rz.sc; let best = 9; rz.others.forEach((o) => { const d = Math.abs(o.h - hs); if (d < best) { best = d; hit = o; } }); if (hit) h = hit.h / rz.sc; }
    showMatch(hit ? '= ' + hit.name + ' \u00B7 ' + Math.round(hit.h) + ' px' : '', e.clientX, e.clientY);
    applySize(rz.el, w, h);
  };
  const rzUp = () => {
    if (!rz) return;
    try { if (rz.el.offsetWidth >= 100 && rz.el.offsetHeight >= 90 && !rz.el.classList.contains('min')) localStorage.setItem(LS_SIZE(rz.id), JSON.stringify({ w: rz.el.offsetWidth, h: rz.el.offsetHeight })); } catch (e) {}
    document.querySelectorAll('.cc-rz.drag').forEach((x) => x.classList.remove('drag'));
    showMatch(''); rz = null;
  };
  life.on(document, 'mousemove', rzMove, true); life.on(document, 'mouseup', rzUp, true);

  // Staggered first-open positions for panels without a saved spot.
  let nextN = 0;
  window.__ccNextPos = () => { const n = nextN++ % 6; return { x: 150 + n * 34, y: 70 + n * 34 }; };

  // ---------------------------------------------------------------- scale
  function gameScale() {
    const u = document.getElementById('ui-container');
    const z = u ? parseFloat(u.style.zoom || getComputedStyle(u).zoom) : 1;
    return Number.isFinite(z) && z > 0 ? Math.max(0.3, Math.min(1.6, z)) : 1;
  }
  // panels you have not sized yourself start smaller than 100% (Settings > Plugins > Panels > Starting Size Of New Panels); a size you pick is kept
  const defM = () => Math.max(0.5, Math.min(1, (Number(setting('uiNewPanelPct', 80)) || 100) / 100));
  const mOf = (id) => (mult[id] !== undefined ? mult[id] : defM());
  function apply(s0) {
    const g = Math.max(0.5, Math.min(2, (Number(setting('uiScalePct', 100)) || 100) / 100));
    IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      let m = mOf(id); if (id === 'cc-route-map' || id === 'cc-route-maptab') m = mOf('cc-route-panel'); if (id === 'cc-treeadv-drawer' || id === 'cc-treeadv-tab') m = mOf('cc-treeadv');
      let s = s0 * g * m; if (mult[id] === undefined) s = Math.max(s, 0.75);   // a panel you have not sized yourself never drops below 75% (small windows made the text unreadable); your own size is respected
      if (Math.abs(s - 1) < 0.001) { if (el.style.scale) { el.style.scale = ''; el.style.transformOrigin = ''; } return; }
      const v = String(Math.round(s * 1000) / 1000);
      if (el.style.scale !== v) { el.style.scale = v; el.style.transformOrigin = '0 0'; }
    });
  }
  // window.__ccScale = base scale of the Route Advisor (its drawer geometry reads it).
  // Right-click a panel's title: size presets, like the game's own panels have.
  let ctx = null;
  function closeCtx() { if (ctx) { try { window.__ccUI && window.__ccUI.closeMenu(); } catch (e) { /* ignore */ } ctx = null; } }
  // ---- locks: a locked panel does not start drags or resizes (kept between sessions)
  const LS_LOCK = 'cc-ui-locks';
  let locks = {}; try { locks = JSON.parse(localStorage.getItem(LS_LOCK) || '{}') || {}; } catch (e) { locks = {}; }
  const saveLocks = () => { try { localStorage.setItem(LS_LOCK, JSON.stringify(locks)); } catch (e) { /* storage blocked */ } };
  const applyLocks = () => { Object.keys(locks).forEach((id) => { const el = document.getElementById(id); if (el && !el.hasAttribute('data-cc-locked')) el.setAttribute('data-cc-locked', ''); }); };
  const setLock = (id, v) => { if (v) locks[id] = 1; else { delete locks[id]; const el = document.getElementById(id); if (el) el.removeAttribute('data-cc-locked'); } saveLocks(); applyLocks(); };
  // ---- snapping: while you drag a ScapeLite panel it is pulled onto the edges of other panels, the screen and the info bars, with a yellow guide line where it catches (hold Shift to move freely)
  const SNAP_T = 10, snapPool = [];
  const snapStyle = document.createElement('style'); snapStyle.id = 'cc-snapk-style';
  snapStyle.textContent = '.cc-snapk-lbl{position:fixed;z-index:2147482641;pointer-events:none;padding:2px 8px;border-radius:999px;background:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#241a00);font:700 11.5px/1.5 system-ui,sans-serif;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.5)}.cc-snapk{position:fixed;z-index:2147482640;pointer-events:none;background:#ffd24a;box-shadow:0 0 8px rgba(255,210,74,.9);border-radius:1px}[data-cc-locked].cc-panel .cc-rz{display:none !important}';
  document.head.appendChild(snapStyle);
  function showSnap(list) {
    for (let i = 0; i < Math.max(list.length, snapPool.length); i++) {
      let g = snapPool[i];
      if (i >= list.length) { if (g) g.style.display = 'none'; continue; }
      if (!g) { g = snapPool[i] = document.createElement('div'); g.className = 'cc-snapk'; document.body.appendChild(g); }
      const q = list[i]; g.style.display = '';
      g.style.left = Math.round(q.x) + 'px'; g.style.top = Math.round(q.y) + 'px'; g.style.width = Math.max(2, Math.round(q.w)) + 'px'; g.style.height = Math.max(2, Math.round(q.h)) + 'px';
    }
  }
  let sd = null;
  const snapOn = () => { try { return !(window.__ccPluginSettings && window.__ccPluginSettings.get('panelSnap') === false); } catch (e) { return true; } };
  function snapStep(shift) {
    const el = sd && sd.el; if (!el || !el.isConnected) { showSnap([]); return; }
    if (shift || !snapOn()) { showSnap([]); return; }
    const E = window.__ccEdge || { top: 0, bottom: 0 }, VH = innerHeight, lo = E.top || 0, bb = VH - (E.bottom || 0);
    const r = el.getBoundingClientRect();
    // the other panels do not move while you drag this one: measure them once per drag, not on every mouse move
    if (!sd.others) { sd.others = [];
      document.querySelectorAll('.cc-panel, #ui-container .panel-floating, #cc-route-panel, #cc-xp-tracker').forEach((o) => {
        if (o === el || o.contains(el) || !o.getClientRects().length) return;
        const b = o.getBoundingClientRect(); if (b.width > 4 && b.height > 4) sd.others.push(b);
      }); }
    const others = sd.others;
    let bx = null, by = null;
    const tx = (d, line, o, edge) => { if (Math.abs(d) <= SNAP_T && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, line, o, edge }; };
    const ty = (d, line, o, edge) => { if (Math.abs(d) <= SNAP_T && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, line, o, edge }; };
    tx(0 - r.left, 0, null); tx(innerWidth - r.right, innerWidth - 2, null);
    if (E.top) ty(lo - r.top, lo, null); if (E.bottom) ty(bb - r.bottom, bb - 2, null);
    others.forEach((o) => {
      const vNear = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > -SNAP_T, hNear = Math.min(r.right, o.right) - Math.max(r.left, o.left) > -SNAP_T;
      if (vNear) { tx(o.left - r.right, o.left - 1, o, 'e'); tx(o.right - r.left, o.right - 1, o, 'e'); tx(o.left - r.left, o.left, o, 'a'); tx(o.right - r.right, o.right - 2, o, 'a'); }
      if (hNear) { ty(o.top - r.bottom, o.top - 1, o, 'e'); ty(o.bottom - r.top, o.bottom - 1, o, 'e'); ty(o.top - r.top, o.top, o, 'a'); ty(o.bottom - r.bottom, o.bottom - 2, o, 'a'); }
    });
    const dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    if (dx) el.style.left = Math.round((parseFloat(el.style.left) || 0) + dx) + 'px';
    if (dy) el.style.top = Math.round((parseFloat(el.style.top) || 0) + dy) + 'px';
    const L = r.left + dx, T = r.top + dy, R = r.right + dx, B = r.bottom + dy, g = [];
    if (bx) { const top = bx.o ? Math.min(T, bx.o.top) : T, bot = bx.o ? Math.max(B, bx.o.bottom) : B; g.push({ x: bx.line, y: top, w: 2, h: bot - top }); }
    if (by) { const left = by.o ? Math.min(L, by.o.left) : L, right = by.o ? Math.max(R, by.o.right) : R; g.push({ x: left, y: by.line, w: right - left, h: 2 }); }
    showSnap(g);
  }
  life.on(document, 'mousedown', (e) => {
    sd = null; if (e.button !== 0) return;
    const hd = e.target && e.target.closest ? e.target.closest('.cc-panel > .hd') : null;
    if (!hd || (e.target.closest && e.target.closest('button'))) return;
    const el = hd.parentElement; if (el.hasAttribute('data-cc-locked')) return;
    sd = { el };
  }, true);
  let snapRaf = 0, snapShift = false;
  life.on(document, 'mousemove', (e) => { if (!(sd && mouseDown)) return; snapShift = e.shiftKey; if (snapRaf) return; snapRaf = requestAnimationFrame(() => { snapRaf = 0; if (sd && mouseDown) snapStep(snapShift); }); });   // once per frame, after the panel has followed the pointer
  life.on(document, 'mouseup', () => { sd = null; showSnap([]); }, true);
  // place a panel in one of nine spots on the free screen (between the bars), flush against the edges
  function alignPanel(el, h, v) {
    const E = window.__ccEdge || { top: 0, bottom: 0 }, lo = E.top || 0, bb = innerHeight - (E.bottom || 0), r = el.getBoundingClientRect();
    const nx = h === 'l' ? 0 : h === 'r' ? innerWidth - r.width : (innerWidth - r.width) / 2, ny = v === 't' ? lo : v === 'b' ? bb - r.height : (lo + bb - r.height) / 2;
    el.style.left = Math.round((parseFloat(el.style.left) || 0) + nx - r.left) + 'px'; el.style.top = Math.round((parseFloat(el.style.top) || 0) + ny - r.top) + 'px';
    try { keepOnScreen(); dockUpdate(); } catch (e) { /* ignore */ }
  }
  const ctxMenuH = (e) => {
    const t = e.target && e.target.closest ? e.target : null; if (!t) return;
    const id = Object.keys(HEAD).find((k) => { const p = document.getElementById(k); const h = p && p.querySelector(HEAD[k]); return h && h.contains(t); });
    if (!id) return;
    e.preventDefault(); e.stopPropagation(); closeCtx();
    const UI = window.__ccUI; if (!UI || !UI.menu) return;
    const pel = document.getElementById(id), R = REGS[id] || {}, kit = !!(pel && pel.classList.contains('cc-panel')) || !!R.kit, cur = mOf(id), items = [{ head: NAMES[id] || id }];
    if (kit) {
      const all = Object.keys(HEAD).filter((k) => { const p = document.getElementById(k); return p && p.classList.contains('cc-panel'); }), anyUnlocked = all.some((k) => !locks[k]);
      items.push({ label: locks[id] ? 'Unlock this panel' : 'Lock this panel (no move / resize)', checked: !!locks[id], onClick: () => setLock(id, !locks[id]) });
      if (!R.kit) items.push({ label: anyUnlocked ? 'Lock all ScapeLite panels' : 'Unlock all ScapeLite panels', onClick: () => { all.forEach((k) => setLock(k, anyUnlocked)); } });
      items.push({ head: 'Align' }, { align: (hh, v) => (R.align ? R.align(hh, v) : alignPanel(pel, hh, v)) });
      try { if (window.__ccCardFuse && !R.kit) items.push(...window.__ccCardFuse.menuItems(id)); } catch (er) { /* fusing is optional */ }
    }
    menuProviders.forEach((fn) => { try { const more = fn(id); if (more && more.length) items.push({ sep: true }, ...more); } catch (er) { /* a provider must not break the menu */ } });
    if (!R.size) items.push({ label: 'Reset size (starting size)', disabled: mult[id] === undefined, onClick: () => { delete mult[id]; saveMult(); apply(last); } });
    if (RESIZABLE.includes(id)) items.push({ label: 'Reset width and height', onClick: () => { const p = document.getElementById(id); if (p) { p.style.width = ''; p.style.height = ''; p.style.maxHeight = ''; p.classList.remove('cc-sized'); } try { localStorage.removeItem(LS_SIZE(id)); } catch (er) {} } });
    // a window that sizes itself (R.size = { presets, cur(), set(v) }, e.g. the game's big windows) gets its own presets instead of the scale multiplier
    if (R.size) items.push({ head: R.size.head || 'Size' }, { chips: R.size.presets.map((v) => ({ label: Math.round(v * 100) + '%', on: Math.abs(R.size.cur() - v) < 0.005, onClick: () => R.size.set(v) })) });
    else {
      // the chips show the size on screen (100% = unscaled, like the game's own panels); the stored multiplier is that divided by the game zoom and the global panel size
      const k = (last || 1) * Math.max(0.5, Math.min(2, (Number(setting('uiScalePct', 100)) || 100) / 100));
      items.push({ head: 'Size' }, { chips: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].map((v) => ({ label: Math.round(v * 100) + '%', on: Math.abs(cur * k - v) < 0.01, onClick: () => { mult[id] = v / k; saveMult(); apply(last); } })) });
    }
    ctx = UI.menu(items, e.clientX, e.clientY);
  };
  const ctxDownH = (e) => { if (ctx && !(e.target.closest && e.target.closest('.cc-menu'))) closeCtx(); };
  // Escape: closes the context menu, else the topmost closable ScapeLite panel (never while typing in a field: that just leaves the field)
  const keyH = (e) => {
    if (e.key !== 'Escape') return;
    if (ctx && window.__ccUI && window.__ccUI.isMenuOpen()) { closeCtx(); return; }
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest && ae.closest(BOXES.map((i) => '#' + i).join(','))) { ae.blur(); return; }
    let best = null, bz = -1;
    BOXES.forEach((id) => { const p = document.getElementById(id); if (!p || !p.getClientRects().length) return; const x = p.querySelector('.x, .xp-x'); if (!x) return; const z = parseInt(p.style.zIndex || getComputedStyle(p).zIndex, 10) || 0; if (z >= bz) { bz = z; best = x; } });
    if (best) best.click();
  };
  const blurH = () => closeCtx();
  life.on(document, 'contextmenu', ctxMenuH, true); life.on(document, 'mousedown', ctxDownH, true); life.on(document, 'keydown', keyH, true); life.on(window, 'blur', blurH);
  // Keep every panel at least partly on screen (80 x 30 px of it), after dragging, restoring or a window resize.
  let mouseDown = false;
  const mdH = () => { mouseDown = true; }, muH = () => { mouseDown = false; };
  life.on(document, 'mousedown', mdH, true); life.on(document, 'mouseup', muH, true);
  const ANCHORED = ['cc-route-panel', 'cc-xp-tracker', 'cc-lever-panel', 'cc-matshort', 'cc-goals', 'cc-droplog', 'cc-treeadv'];
  let vpKey = '', vpAt = 0;
  function keepOnScreen() {
    if (mouseDown) return;
    { const k = innerWidth + 'x' + innerHeight; if (k !== vpKey) { vpKey = k; vpAt = performance.now(); } }
    const justResized = performance.now() - vpAt < 2500;   // after the window got smaller, panels come fully back (not only 80 px of them)
    if (window.__ccAnchor && window.__ccAnchor.enabled()) return;   // edge anchoring (anchor.js) keeps panels reachable and in place; this is the fallback when it is off
    ANCHORED.forEach((id) => {
      const el = document.getElementById(id); if (!el || !el.getClientRects().length || el.style.position === 'static') return;
      const r = el.getBoundingClientRect(); let L = parseFloat(el.style.left), T = parseFloat(el.style.top);
      if (!Number.isFinite(L) || !Number.isFinite(T)) return;
      let nL = L, nT = T;
      const E = window.__ccEdge || { top: 0, bottom: 0, reserved: 0 }, VH = innerHeight + (E.reserved || 0), lo = E.top || 0, bb = VH - (E.bottom || 0);   // the info bars are a screen edge: nothing sits under them
      if (r.left > innerWidth - 80) nL = L - (r.left - (innerWidth - 80));
      if (justResized && r.width <= innerWidth - 8 && r.right > innerWidth - 4) nL = L - (r.right - (innerWidth - 4));
      if (r.right < 80) nL = L + (80 - r.right);
      let vt = r.top;   // where the top will be after the moves below
      if (E.bottom && r.bottom > bb) { nT = T - (r.bottom - bb); vt = r.top - (r.bottom - bb); }
      else if (E.bottom && bb - r.bottom > 0 && bb - r.bottom <= 10) { nT = T + (bb - r.bottom); vt = r.top + (bb - r.bottom); }   // close to a bar: flush against it
      if (vt < lo || (E.top && vt - lo > 0 && vt - lo <= 10)) nT = nT - vt + lo;
      if (nL !== L) el.style.left = Math.round(nL) + 'px';
      if (nT !== T) el.style.top = Math.round(nT) + 'px';
    });
  }
  // A panel that sits flush against an info bar has square corners on that side; floating, it is rounded again.
  const dockStyle = document.createElement('style'); dockStyle.id = 'cc-dock-style';
  dockStyle.textContent = '.cc-panel.cc-dock-b{border-bottom-left-radius:0 !important;border-bottom-right-radius:0 !important;border-bottom-width:0 !important} .cc-panel.cc-dock-t{border-top-left-radius:0 !important;border-top-right-radius:0 !important;border-top-width:0 !important} .cc-panel.cc-dock-t .hd{border-top-left-radius:0 !important;border-top-right-radius:0 !important}';
  document.head.appendChild(dockStyle);
  function dockUpdate() {
    const E = window.__ccEdge || { top: 0, bottom: 0, reserved: 0 }, VH = innerHeight + (E.reserved || 0), lo = E.top || 0, bb = VH - (E.bottom || 0);
    ANCHORED.forEach((id) => {
      const el = document.getElementById(id); if (!el || !el.classList.contains('cc-panel')) return;
      if (!el.getClientRects().length) { el.classList.remove('cc-dock-b', 'cc-dock-t'); return; }
      const r = el.getBoundingClientRect();
      el.classList.toggle('cc-dock-b', !!E.bottom && Math.abs(r.bottom - bb) <= 1.5);
      el.classList.toggle('cc-dock-t', !!E.top && Math.abs(r.top - lo) <= 1.5);
    });
  }
  life.on(document, 'mousemove', () => { if (mouseDown) dockUpdate(); }, true);
  window.__ccClamp = () => { keepOnScreen(); dockUpdate(); };
  // Panels built with the UI kit register themselves here: they get scale, resize handle, bring-to-front, Escape and the size menu without editing these lists.
  // Plugins add entries to a panel's right-click menu here: add(fn) with fn(panelId) -> kit menu items; returns a function that removes it again
  const menuProviders = [];
  window.__ccPanelMenu = { add: (fn) => { menuProviders.push(fn); return () => { const i = menuProviders.indexOf(fn); if (i >= 0) menuProviders.splice(i, 1); }; } };
  // o.chrome = true: the element is a title bar of something ScapeLite does not scale (the game's big window, see modal-resize.js). It gets the right-click menu
  // (lock, align, plugin items, size presets) but none of the panel scaling / theming / Escape handling. With it: o.align(h, v) and o.size = { presets, cur(), set(v) } replace the defaults.
  const REGS = {};
  window.__ccUIReg = (id, o) => {
    o = o || {};
    if (o.chrome) { REGS[id] = { kit: true, align: o.align, size: o.size }; HEAD[id] = o.head || '.hd'; NAMES[id] = o.title || id; return; }
    [IDS, BOXES].forEach((l) => { if (!l.includes(id)) l.push(id); });
    if (o.resizable && !RESIZABLE.includes(id)) RESIZABLE.push(id);
    if (o.anchored && !ANCHORED.includes(id)) ANCHORED.push(id);
    HEAD[id] = o.head || '.hd'; NAMES[id] = o.title || id;
  };
  // Read / write access for the Layout Editor: which panels exist, their names, header selector, size multiplier and saved size.
  window.__ccUIInfo = {
    ids: () => ANCHORED.slice(), name: (id) => NAMES[id] || id, locked: (id) => !!locks[id], head: (id) => HEAD[id] || '.hd',
    mult: (id) => mOf(id),
    setMult: (id, v) => { if (!v) delete mult[id]; else mult[id] = Math.max(0.5, Math.min(2, v)); saveMult(); apply(last); },
    resizable: (id) => RESIZABLE.includes(id),
    setSize: (id, w, h) => { const el = document.getElementById(id); if (!el) return; applySize(el, w, h); try { if (w >= 100 && h >= 90) localStorage.setItem(LS_SIZE(id), JSON.stringify({ w: Math.round(w), h: Math.round(h) })); } catch (e) {} },
    clearSize: (id) => { const el = document.getElementById(id); if (el) { el.style.width = ''; el.style.height = ''; el.style.maxHeight = ''; el.classList.remove('cc-sized'); } try { localStorage.removeItem(LS_SIZE(id)); } catch (e) {} },
  };
  document.querySelectorAll('[data-cc-panel]').forEach((e) => window.__ccUIReg(e.id, { title: (e.querySelector('.hd b') || {}).textContent, resizable: e.dataset.ccResizable === '1', anchored: true }));   // panels that were built before this loaded
  function tick() {
    document.body.classList.toggle('cc-themed', themeOn());
    keepOnScreen(); dockUpdate(); applyLocks();
    ensureGrips();
    const floor = Math.max(0, Math.min(100, Number(setting('uiScaleMinPct', 0)) || 0)) / 100; // optional "never smaller than"
    const s = on() ? Math.max(gameScale(), floor) : 1;
    last = s;
    window.__ccScale = s * Math.max(0.5, Math.min(2, (Number(setting('uiScalePct', 100)) || 100) / 100)) * mOf('cc-route-panel'); // what the Route Advisor's drawer geometry uses
    apply(s);
  }
  life.every(400, () => { try { tick(); } catch (e) {} });
  tick();
  function teardown() {
    life.dispose(); window.__ccScale = 1; apply(1); closeCtx();
    delete window.__ccClamp; delete window.__ccPanelMenu; delete window.__ccUIReg; delete window.__ccUIInfo;
    document.body.classList.remove('cc-themed'); style.remove(); dockStyle.remove(); snapStyle.remove(); snapPool.forEach((g) => g.remove()); delete window.__ccNextPos;
    document.querySelectorAll('.cc-rz').forEach((g) => g.remove());
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc ui-scale torn down';
  }
  window[NS] = { version: 2, teardown, get scale() { return last; } };
  return 'cc ui-scale loaded';
})();
