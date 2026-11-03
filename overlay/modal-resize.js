// ScapeLite game windows. DISPLAY-ONLY: the game's big windows (Settings, Bank, Crafting, Skills Customization ... they all live in one full-screen
// "modal" container) are movable and resizable, and the game behind them can stay visible and usable.
//
// THE MODEL (one rule, no modes to switch):
//   - A window is either FULLSCREEN (the game's own look, the default) or a WINDOW with its own position and size.
//   - It is always draggable and resizable: a corner grip at the bottom-right of the fullscreen window, and in window form a title bar (drag to move)
//     plus eight edge / corner handles. Dragging the game's own header also moves it (from fullscreen it lifts the window out at 75%).
//   - FULLSCREEN SNAP: when a resize ENDS, the window becomes fullscreen if it is at least 80% of the fullscreen size in BOTH width and height, and
//     a window if either is below that (Settings > Plugins > Panels > Fullscreen Snap Threshold changes the 80). Moving never changes the mode, and while
//     you drag a label says what will happen when you let go. The size you had before the snap is kept, so the title bar's maximise button toggles back to it.
//   - SEE-THROUGH: while it is a window, the game behind it is shown and stays clickable (the background only dims and blurs while your pointer is
//     inside the window). Per window in the title-bar menu; Settings > Plugins > Panels > See-Through Windows turns the whole behaviour off.
//   - The title bar is a ScapeLite panel title bar: right-click it for the same menu as the panels (lock position and size, align to edges / corners / centre,
//     size presets in % of the screen) -- it registers with ui-scale.js (window.__ccUIReg, chrome mode) and adds its own items through window.__ccPanelMenu.
//   - Position is remembered as the distance to the nearest screen edges (like anchor.js does for panels), size in pixels, so a resized game window keeps the
//     window where it was relative to its edges and clamps it to the screen without forgetting the real size. Remembered per window (cc-modal-win).
// Implemented with CSS on .modal-container only (zoom + width/height + translate); nothing is re-parented, so drawers living inside the window
// (Lever Advisor, ui-kit windowDrawer) move, resize and scale with it.
(function () {
  'use strict';
  const NS = '__ccModalResize';
  const LS = 'cc-modal-win', LS_MIG = 'cc-modal-win-v1', LS_OLD_SCALE = 'cc-modal-scale', LS_OLD_FLOAT = 'cc-modal-float';
  const ID = 'cc-modal-win';          // the title bar's element id = its id in the ui-scale registry (lock key, menu)
  const BAR = 30, MIN_W = 520, MIN_H = 360, DETACH = 0.75;
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const life = window.__ccLife.scope('modal-resize');   // listeners and timers go through it: a re-inject cannot leave a second copy

  const setting = (k, d) => { try { const s = window.__ccPluginSettings; const v = s && s.get ? s.get(k) : undefined; return v === undefined ? d : v; } catch (e) { return d; } };
  const enabled = () => setting('modalResizeEnabled', true) !== false;
  const seeAllowed = () => setting('modalFloatEnabled', true) !== false;          // key kept from the old "Float" setting
  const snapFrac = () => Math.max(0.5, Math.min(1, (Number(setting('modalSnapPct', 80)) || 80) / 100));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };
  const VH = () => (window.__ccVH ? window.__ccVH() : window.innerHeight);          // bottom of the usable screen (above the bottom info bar)
  const top = () => ((window.__ccEdge && window.__ccEdge.top) || 0) + BAR;              // lowest the window's top edge may go: below the top info bar and its own title bar
  const locked = () => { try { return !!(window.__ccUIInfo && window.__ccUIInfo.locked && window.__ccUIInfo.locked(ID)); } catch (e) { return false; } };

  // ---------------------------------------------------------------- state: wins[tab] = { full, w, h, ax, dx, ay, dy, see }
  // full = shown fullscreen (the rest is the last window rect, kept for the maximise toggle); see = this window's see-through choice (undefined = follow the setting).
  let wins = {};
  try { wins = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { wins = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(wins)); } catch (e) { /* storage blocked */ } };
  // the fullscreen size of the game's window: its natural 1920 x 1080 in the game's own units (re-measured whenever it is fullscreen), times the game's UI zoom
  let nat = { w: 1920, h: 1080 };
  // visual px per layout px of the game's UI, per axis: the UI zoom, and vertically also the squeeze the game applies between the info bars (#game-container is scaled in y)
  const gains = () => { const k = uiZoom(), o = ov(); if (!o) return { x: k, y: k }; const r = o.getBoundingClientRect(), cs = getComputedStyle(o), w = parseFloat(cs.width), h = parseFloat(cs.height); return { x: w > 0 && r.width > 0 ? r.width / w : k, y: h > 0 && r.height > 0 ? r.height / h : k }; };
  const F = () => { const g = gains(); return { w: nat.w * g.x, h: nat.h * g.y }; };
  const anchorOf = (x, y, w, h) => { const vw = innerWidth, vh = VH(); return { ax: x <= vw - (x + w) ? 'l' : 'r', dx: Math.round(x <= vw - (x + w) ? x : vw - (x + w)), ay: y - top() <= vh - (y + h) ? 't' : 'b', dy: Math.round(y - top() <= vh - (y + h) ? y : vh - (y + h)) }; };
  const setRect = (e, x, y, w, h) => { e.w = Math.round(w); e.h = Math.round(h); Object.assign(e, { ax: 'l', dx: Math.round(x), ay: 't', dy: Math.round(y) }); };   // live while dragging; re-derived to the nearest edges at the end
  const reanchor = (e) => { const g = geom(e); Object.assign(e, anchorOf(g.x, g.y, g.w, g.h)); };
  function geom(e) {   // where a window with this state sits now: visual px, clamped to the screen (the clamp is never remembered)
    const vw = innerWidth, vh = VH(), L = top(), f = F();
    const w = clamp(e.w, Math.min(MIN_W, vw), vw), h = clamp(e.h, Math.min(MIN_H, vh - L), Math.max(vh - L, 100));
    const x = clamp(e.ax === 'r' ? vw - w - e.dx : e.dx, 0, Math.max(0, vw - w)), y = clamp(e.ay === 'b' ? vh - h - e.dy : e.dy, L, Math.max(L, vh - h));
    return { x, y, w, h, s: clamp(Math.min(w / f.w, h / f.h), 0.3, 1) };
  }
  const defaultRect = (frac) => { const f = F(), w = f.w * frac, h = f.h * frac; return { w, h, x: (innerWidth - w) / 2, y: Math.max(top(), (VH() - h) / 2) }; };
  const tabId = () => { const t = window.__ccDom.modalTab(); return (t && t.id) || 'modal'; };
  const ov = () => document.querySelector('.modal-overlay');
  const container = () => document.querySelector('.modal-overlay .modal-container');
  const isOpen = () => { const o = ov(); return !!o && o.style.display !== 'none' && o.offsetWidth > 0; };
  const entry = (id) => wins[id || tabId()];
  const isWin = (e) => !!e && !e.full;
  const seeOf = (e) => seeAllowed() && !(e && e.see === false);

  // one-time move of the old per-window zoom (cc-modal-scale) and float offsets (cc-modal-float) into windows: anything under the snap size becomes a window of that size
  try {
    if (!localStorage.getItem(LS_MIG)) {
      const sc = JSON.parse(localStorage.getItem(LS_OLD_SCALE) || '{}') || {}, fl = JSON.parse(localStorage.getItem(LS_OLD_FLOAT) || '{}') || {};
      Object.keys(sc).forEach((id) => {
        const s = Number(sc[id]); if (!(s > 0 && s < snapFrac()) || wins[id]) return;
        const f = F(), w = f.w * s, h = f.h * s, o = fl[id] || {}, fx = o.f ? o.x || 0 : 0, fy = o.f ? o.y || 0 : 0;
        const x = clamp((innerWidth - w) / 2 + fx, 0, Math.max(0, innerWidth - w)), y = clamp((VH() - h) / 2 + fy, top(), Math.max(top(), VH() - h));
        const e = { full: false, w: Math.round(w), h: Math.round(h), see: !!o.f }; Object.assign(e, anchorOf(x, y, w, h)); wins[id] = e;
      });
      save(); localStorage.setItem(LS_MIG, '1');
    }
  } catch (e) { /* nothing to migrate */ }

  // ---------------------------------------------------------------- DOM: title bar, handles, label, styles
  const el = (tag, cls, txt, attrs) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; if (attrs) Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k])); return n; };
  const style = el('style', null, null, { id: 'cc-modal-resize-style' }), base = el('style', null, null, { id: 'cc-modal-resize-base' });
  base.textContent = `
#cc-modal-win{position:fixed;z-index:var(--cc-z-win,100005);display:none;box-sizing:border-box;height:${BAR}px;background:linear-gradient(var(--cc-bg-3,#1d1c28),var(--cc-bg-2,#161620));border:1px solid var(--cc-border-strong,#3a3a4c);border-bottom:0;
  border-radius:var(--cc-r,10px) var(--cc-r,10px) 0 0;color:var(--cc-text,#dcdce8);font:var(--cc-fs,14px)/1 var(--cc-font,system-ui,sans-serif);user-select:none;touch-action:none}
#cc-modal-win .hd{display:flex;align-items:center;gap:6px;height:100%;padding:0 6px 0 12px;cursor:grab}
#cc-modal-win.drag .hd{cursor:grabbing}
#cc-modal-win[data-cc-locked] .hd{cursor:default}
#cc-modal-win .hd b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cc-accent,#ffd24a);font-size:calc(var(--cc-fs,14px) + 1.5px);letter-spacing:.02em}
#cc-modal-win[data-cc-locked] .hd b::after{content:' \\1F512';font-size:.8em;opacity:.7}
#cc-modal-win .cc-ib{width:24px;height:24px;font-size:15px}
.cc-mw-h{position:fixed;z-index:var(--cc-z-win,100004);display:none;touch-action:none}
.cc-mw-h[data-d=n],.cc-mw-h[data-d=s]{cursor:ns-resize}.cc-mw-h[data-d=e],.cc-mw-h[data-d=w]{cursor:ew-resize}
.cc-mw-h[data-d=nw],.cc-mw-h[data-d=se]{cursor:nwse-resize}.cc-mw-h[data-d=ne],.cc-mw-h[data-d=sw]{cursor:nesw-resize}
.cc-mw-h[data-d=se]{z-index:calc(var(--cc-z-win,100004) + 1);width:16px;height:16px;box-sizing:border-box;opacity:.5;transition:opacity .15s;border-right:2px solid rgba(255,255,255,.6);border-bottom:2px solid rgba(255,255,255,.6);border-radius:0 0 7px 0}
.cc-mw-h[data-d=se]:hover,.cc-mw-h[data-d=se].drag{opacity:1}
#cc-mw-lbl{position:fixed;z-index:100006;display:none;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,.8);color:#fff;font:12px/16px system-ui,sans-serif;white-space:nowrap;pointer-events:none}
#cc-mw-lbl.snap{background:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#241a00);font-weight:700}
body.cc-mw .modal-overlay .modal-header{cursor:grab}
body.cc-mw.cc-mw-drag .modal-overlay .modal-header{cursor:grabbing}
body.cc-mw-see .modal-overlay{pointer-events:none !important;background:transparent !important;transition:background .22s ease,backdrop-filter .22s ease}
body.cc-mw-see .modal-overlay .modal-container{pointer-events:auto !important}
body.cc-mw-see.cc-modal-in .modal-overlay{background:rgba(0,0,0,.55) !important;backdrop-filter:blur(3px)}`;
  const bar = el('div', null, null, { id: ID, role: 'toolbar', 'aria-label': 'Window title bar' });
  const hd = el('div', 'hd'), ttl = el('b'), bSee = el('button', 'cc-ib', '\u{1F441}', { type: 'button' }), bMax = el('button', 'cc-ib', '▢', { type: 'button', title: 'Fullscreen', 'aria-label': 'Fullscreen' }), bX = el('button', 'cc-ib', '×', { type: 'button', title: 'Close', 'aria-label': 'Close' });
  hd.append(ttl, bSee, bMax, bX); bar.appendChild(hd);
  const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'], handles = {};
  DIRS.forEach((d) => { handles[d] = el('div', 'cc-mw-h', null, { 'data-d': d }); });
  handles.se.title = 'Drag to resize this window';
  const lbl = el('div', null, null, { id: 'cc-mw-lbl' });
  const NAMES = { combat: 'Combat', processing: 'Processing', bank: 'Bank', skillcustom: 'Skills Customization', quests: 'Quests', unlocks: 'Unlocks', raid: 'Raid', clan: 'Clan', hiscores: 'Hiscores', settings: 'Settings', customize: 'Customize', ledger: 'Ledger' };
  const titleOf = (id) => NAMES[String(id).replace(/^tab-/, '')] || String(id).replace(/^tab-/, '').replace(/^./, (c) => c.toUpperCase());

  // ---------------------------------------------------------------- actions
  function toWindow(id, frac) {   // fullscreen -> window (at the remembered rect, else frac of the screen, centred)
    let e = wins[id];
    if (!e) { const r = defaultRect(frac || 0.7); e = wins[id] = { full: false, w: Math.round(r.w), h: Math.round(r.h) }; Object.assign(e, anchorOf(r.x, r.y, r.w, r.h)); }
    e.full = false; save(); render(); return e;
  }
  function toFull(id) { const e = wins[id || tabId()]; if (e) { e.full = true; save(); } render(); }
  function toggleFull() { const id = tabId(), e = wins[id]; if (isWin(e)) toFull(id); else toWindow(id, 0.7); }
  function toggleSee() { const id = tabId(), e = wins[id]; if (!e) return; e.see = seeOf(e) ? false : true; save(); render(); }
  function align(h, v) {   // nine spots on the free screen, flush against the edges
    const id = tabId(), e = toWindow(id), g = geom(e), vw = innerWidth, vh = VH(), L = top();
    const x = h === 'l' ? 0 : h === 'r' ? vw - g.w : (vw - g.w) / 2, y = v === 't' ? L : v === 'b' ? vh - g.h : (L + vh - g.h) / 2;
    Object.assign(e, anchorOf(x, y, g.w, g.h)); save(); render();
  }
  function sizePct(v) {   // size preset: share of the fullscreen size; at or over the snap size = fullscreen. Keeps the window's centre.
    const id = tabId(), e0 = wins[id];
    if (v >= snapFrac()) { if (e0) toFull(id); return; }
    const f = F(), c0 = isWin(e0) ? geom(e0) : null, w = f.w * v, h = f.h * v;
    const cx = c0 ? c0.x + c0.w / 2 : innerWidth / 2, cy = c0 ? c0.y + c0.h / 2 : (top() + VH()) / 2;
    const e = wins[id] || (wins[id] = { full: false });
    e.full = false; setRect(e, clamp(cx - w / 2, 0, Math.max(0, innerWidth - w)), clamp(cy - h / 2, top(), Math.max(top(), VH() - h)), w, h); reanchor(e); save(); render();
  }
  const curPct = () => { const e = entry(); if (!isWin(e)) return 1; const g = geom(e), f = F(); return Math.min(g.w / f.w, g.h / f.h); };
  const clickClose = () => { const c = container(), b = c && Array.from(c.querySelectorAll('.modal-close')).find((x) => x.getClientRects().length); if (b) b.click(); };   // the player's own click on the game's close button

  // ---------------------------------------------------------------- render
  let lastCss = '', op = null, inside = false, raf = 0;
  function render() {
    if (!document.head || !document.body) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!base.isConnected) document.head.appendChild(base);
    if (!bar.isConnected) { document.body.append(bar, lbl); DIRS.forEach((d) => document.body.appendChild(handles[d])); }
    const c = container(), on = enabled() && isOpen() && !!c, id = tabId(), e = wins[id], win = on && isWin(e), full = on && !win;
    const B = document.body.classList;
    B.toggle('cc-mw', win); B.toggle('cc-mw-see', win && seeOf(e)); if (!win) B.remove('cc-modal-in');
    let css = '';
    if (win) {
      const g = geom(e), k = gains(), o = ov().getBoundingClientRect(), cs = getComputedStyle(c), bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0), bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      const pad = cs.boxSizing === 'border-box' ? [0, 0] : [bw, bh];
      css = `body.cc-mw .modal-overlay .modal-container{position:absolute !important;left:0 !important;top:0 !important;margin:0 !important;max-width:none !important;max-height:none !important;` +
        `width:${(g.w / (k.x * g.s) - pad[0]).toFixed(2)}px !important;height:${(g.h / (k.y * g.s) - pad[1]).toFixed(2)}px !important;zoom:${g.s.toFixed(4)} !important;` +
        `translate:${((g.x - o.left) / (k.x * g.s)).toFixed(2)}px ${((g.y - o.top) / (k.y * g.s)).toFixed(2)}px !important;border-top-left-radius:0 !important;border-top-right-radius:0 !important;box-shadow:0 14px 44px rgba(0,0,0,.6)}`;
    }
    if (css !== lastCss) { lastCss = css; style.textContent = css; }
    if (full) { const r = c.getBoundingClientRect(); if (r.width > 300 && r.height > 200) { const k = gains(); nat = { w: r.width / k.x, h: r.height / k.y }; } }
    // bar and handles hug the real window rect
    const r = on ? c.getBoundingClientRect() : null, lock = locked();
    if (win && r && r.width > 40) {
      bar.style.display = 'block'; bar.style.left = Math.round(r.left) + 'px'; bar.style.top = Math.round(r.top - BAR) + 'px'; bar.style.width = Math.round(r.width) + 'px';
      const t = titleOf(id); if (ttl.textContent !== t) ttl.textContent = t;
      const see = seeOf(e); bSee.style.display = seeAllowed() ? '' : 'none'; bSee.setAttribute('aria-pressed', String(see)); bSee.title = see ? 'See-through: the game behind this window is visible and usable (click to turn off)' : 'See-through is off: the game behind is dimmed (click to turn on)'; bSee.setAttribute('aria-label', 'See-through');
      if (lock) bar.setAttribute('data-cc-locked', ''); else bar.removeAttribute('data-cc-locked');
      bMax.title = 'Fullscreen';
      place(r, lock);
    } else {
      bar.style.display = 'none';
      if (full && r && !lock && r.width > 40) place(r, false, true); else DIRS.forEach((d) => { handles[d].style.display = 'none'; });
    }
    if (!(op && op.type)) { if (!on) lbl.style.display = 'none'; }
  }
  function place(r, lock, onlyGrip) {
    const T = 6, C = 16, rr = Math.round, set = (d, l, t, w, h) => { const s = handles[d].style; s.display = 'block'; s.left = rr(l) + 'px'; s.top = rr(t) + 'px'; s.width = rr(w) + 'px'; s.height = rr(h) + 'px'; };
    DIRS.forEach((d) => { if (lock || (onlyGrip && d !== 'se')) handles[d].style.display = 'none'; });
    if (lock) return;
    const L = r.left, Tp = r.top, R = r.right, Bt = r.bottom;
    if (onlyGrip) { set('se', Math.min(R, innerWidth) - 16, Math.min(Bt, VH()) - 16, 16, 16); return; }
    set('se', R - 16, Bt - 16, 16, 16);
    set('n', L + C, Tp - T / 2, r.width - 2 * C, T); set('s', L + C, Bt - T / 2, r.width - 2 * C - 0, T);
    set('w', L - T / 2, Tp + C, T, r.height - 2 * C); set('e', R - T / 2, Tp + C, T, r.height - 2 * C);
    set('nw', L - T / 2, Tp - T / 2, C, C); set('ne', R - C + T / 2, Tp - T / 2, C, C); set('sw', L - T / 2, Bt - C + T / 2, C, C);
    handles.se.style.display = 'block';
  }
  const loop = () => { render(); if (op) raf = requestAnimationFrame(loop); };

  // ---------------------------------------------------------------- dragging: move (title bar, game header) and resize (handles, grip)
  function pctLabel(e, x, y) {
    const g = geom(e), f = F(), fw = g.w / f.w, fh = g.h / f.h, snap = fw >= snapFrac() && fh >= snapFrac();
    lbl.textContent = Math.round(fw * 100) + '% × ' + Math.round(fh * 100) + '%' + (snap ? ' → fullscreen' : ''); lbl.classList.toggle('snap', snap);
    lbl.style.display = 'block'; lbl.style.left = Math.round(Math.min(x + 16, innerWidth - 170)) + 'px'; lbl.style.top = Math.round(y + 18) + 'px';
  }
  const snapshot = (e) => (e && e.w ? { w: e.w, h: e.h, ax: e.ax, dx: e.dx, ay: e.ay, dy: e.dy } : null);
  function begin(type, d, ev, id, prev) {
    const e = wins[id]; if (!e) return false;
    if (prev === undefined) prev = snapshot(e);   // the rect to come back to when the resize ends over the snap size
    if (e.full) {   // leaving fullscreen: the window starts at the fullscreen rect (top-left fixed)
      const c = container(), r = c && c.getBoundingClientRect(); if (r) { setRect(e, r.left, Math.max(r.top, top()), r.width, Math.min(r.height, VH() - top())); reanchor(e); }
      e.full = false;
    }
    const g = geom(e);
    op = { type, d, id, x0: ev.clientX, y0: ev.clientY, g, prev };
    bar.classList.toggle('drag', type === 'move'); document.body.classList.add('cc-mw-drag'); if (d === 'se') handles.se.classList.add('drag');
    cancelAnimationFrame(raf); loop(); return true;
  }
  function onMove(ev) {
    if (pend && !op) { if (Math.hypot(ev.clientX - pend.x, ev.clientY - pend.y) < 12) return; detach(pend); pend = null; }
    if (!op) { hover(ev); return; }
    const e = wins[op.id]; if (!e) { end(); return; }
    const dx = ev.clientX - op.x0, dy = ev.clientY - op.y0, g = op.g, vw = innerWidth, vh = VH(), L = top();
    if (op.type === 'move') {
      setRect(e, clamp(g.x + dx, 90 - g.w, vw - 90), clamp(g.y + dy, L, vh - 30), g.w, g.h);
    } else {
      let x0 = g.x, y0 = g.y, x1 = g.x + g.w, y1 = g.y + g.h;
      if (op.d.includes('e')) x1 = clamp(g.x + g.w + dx, x0 + MIN_W, vw);
      if (op.d.includes('w')) x0 = clamp(g.x + dx, 0, x1 - MIN_W);
      if (op.d.includes('s')) y1 = clamp(g.y + g.h + dy, y0 + MIN_H, vh);
      if (op.d.includes('n')) y0 = clamp(g.y + dy, L, y1 - MIN_H);
      setRect(e, x0, y0, x1 - x0, y1 - y0); pctLabel(e, ev.clientX, ev.clientY);
    }
  }
  function end() {
    if (!op) return; const o = op, e = wins[o.id]; op = null; cancelAnimationFrame(raf); bar.classList.remove('drag'); document.body.classList.remove('cc-mw-drag'); handles.se.classList.remove('drag'); lbl.style.display = 'none';
    if (e) {
      if (o.type === 'resize') {
        const g = geom(e), f = F();
        if (g.w / f.w >= snapFrac() && g.h / f.h >= snapFrac()) {   // snap: fullscreen, and keep the rect the window had before for the maximise toggle
          if (o.prev) Object.assign(e, o.prev); else { const r = defaultRect(0.7); setRect(e, r.x, r.y, r.w, r.h); reanchor(e); }
          e.full = true;
        } else reanchor(e);
      } else reanchor(e);
      save();
    }
    render();
  }
  // lift a fullscreen window out by its game header: it becomes a window at 75% under the pointer
  let pend = null;
  function detach(p) {
    const id = p.id, f = F(), w = f.w * DETACH, h = f.h * DETACH, rc = p.rect;
    const px = clamp((p.x - rc.left) / Math.max(1, rc.width), 0, 1), py = clamp((p.y - rc.top) / Math.max(1, rc.height), 0, 1);
    const e = wins[id] || (wins[id] = { full: true }), prev = snapshot(e);
    setRect(e, clamp(p.x - px * w, 0, Math.max(0, innerWidth - w)), clamp(p.y - py * h, top(), Math.max(top(), VH() - h)), w, h); e.full = false; reanchor(e);
    begin('move', '', { clientX: p.x, clientY: p.y }, id, prev);
  }
  const INTERACTIVE = 'button, input, select, textarea, a, label, canvas, [role=slider], [role=button], [contenteditable], .tab-btn';
  function onDown(ev) {
    if (ev.button !== 0 || !enabled() || !isOpen()) return;
    const t = ev.target, id = tabId(), e = wins[id];
    let h = t && t.closest ? t.closest('.cc-mw-h') : null;
    if (h) { if (locked()) return; ev.preventDefault(); ev.stopPropagation(); if (!e) return; begin('resize', h.dataset.d, ev, id); return; }
    const inBar = t && t.closest && t.closest('#' + ID);
    if (inBar) { if (t.closest('button') || locked() || !isWin(e)) return; ev.preventDefault(); begin('move', '', ev, id); return; }
    const hdr = t && t.closest ? t.closest('.modal-overlay .modal-header') : null;
    if (!hdr || t.closest(INTERACTIVE) || locked()) return;
    const c = container(); if (!c) return;
    if (isWin(e)) { ev.preventDefault(); begin('move', '', ev, id); } else pend = { x: ev.clientX, y: ev.clientY, id, rect: c.getBoundingClientRect() };
  }
  const onUp = () => { pend = null; end(); };
  life.on(document, 'pointerdown', onDown, true);
  life.on(document, 'pointermove', onMove, true);
  life.on(document, 'pointerup', onUp, true);
  life.on(document, 'pointercancel', onUp, true);
  life.on(window, 'blur', onUp);
  // the background only dims while the pointer (or the keyboard focus) is inside a see-through window
  function hover(ev) {
    if (!document.body.classList.contains('cc-mw-see')) return;
    const t = ev.target, now = !!(t && t.closest && t.closest('.modal-overlay .modal-container, #' + ID + ', .cc-mw-h'));
    if (now !== inside) { inside = now; document.body.classList.toggle('cc-modal-in', inside || focusIn()); }
  }
  const focusIn = () => { const c = container(), a = document.activeElement; return !!(c && a && a !== document.body && c.contains(a)); };
  life.on(document, 'focusin', () => { if (document.body.classList.contains('cc-mw-see') && focusIn()) document.body.classList.add('cc-modal-in'); }, true);
  life.on(document, 'focusout', () => { setTimeout(() => { if (!inside && !focusIn()) document.body.classList.remove('cc-modal-in'); }, 0); }, true);
  life.on(document.documentElement, 'mouseleave', () => { inside = false; if (!focusIn()) document.body.classList.remove('cc-modal-in'); });
  life.on(window, 'resize', render);

  // buttons on the title bar (the player's own clicks)
  [bSee, bMax, bX].forEach((b) => { b.addEventListener('mousedown', (e) => e.stopPropagation()); b.addEventListener('pointerdown', (e) => e.stopPropagation()); });
  bSee.addEventListener('click', (e) => { e.stopPropagation(); toggleSee(); });
  bMax.addEventListener('click', (e) => { e.stopPropagation(); toggleFull(); });
  bX.addEventListener('click', (e) => { e.stopPropagation(); clickClose(); });
  hd.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && !locked()) toggleFull(); });
  [bar, lbl].concat(DIRS.map((d) => handles[d])).forEach((n) => ['mousedown', 'click', 'contextmenu'].forEach((t) => { if (n !== bar || t !== 'contextmenu') n.addEventListener(t, (e) => e.stopPropagation()); }));
  handles.se.addEventListener('dblclick', (e) => { e.preventDefault(); if (!locked()) { const id = tabId(); if (isWin(wins[id])) toFull(id); } });

  // ---------------------------------------------------------------- registration with the panel machinery (ui-scale.js): lock, align, size presets, menu items
  let regDone = false, menuFor = null, menuOff = null;
  function register() {
    const U = window.__ccUIInfo;
    if (window.__ccUIReg && U && (!regDone || U.name(ID) === ID)) { regDone = true; try { window.__ccUIReg(ID, { chrome: true, title: 'Game window', head: '.hd', align, size: { head: 'Size (share of the screen)', presets: [0.4, 0.5, 0.6, 0.7, 0.75, 1], cur: curPct, set: sizePct } }); } catch (e) { /* ui-scale not ready */ } }
    const M = window.__ccPanelMenu;
    if (M && menuFor !== M) {
      try { menuOff && menuOff(); } catch (e) { /* old registry gone */ }
      menuFor = M;
      menuOff = M.add((pid) => {
        if (pid !== ID) return null;
        const id = tabId(), e = wins[id];
        return [
          { label: 'See-through (game visible behind)', checked: () => seeOf(wins[tabId()]), disabled: !seeAllowed(), keepOpen: true, onClick: toggleSee },
          { label: 'Fullscreen', hint: 'double-click title', onClick: () => toFull(id) },
          { label: 'Reset window (70%, centred)', disabled: !e, onClick: () => { const r = defaultRect(0.7), w = wins[id]; if (w) { setRect(w, r.x, r.y, r.w, r.h); reanchor(w); w.full = false; save(); render(); } } },
        ];
      });
    }
  }

  let wasOpen = true, tick = 0;
  life.every(100, () => {
    if (op) return;
    const o = ov(), open = !!o && o.style.display !== 'none' && o.offsetWidth > 0;
    if (!open && !wasOpen) { if (++tick % 10 === 0) register(); return; }   // nothing is open and nothing changed: skip the layout work
    wasOpen = open; if (tick++ % 5 === 0) register(); render();
  });
  register(); render();

  function teardown() {
    life.dispose(); cancelAnimationFrame(raf); try { menuOff && menuOff(); } catch (e) {}
    bar.remove(); lbl.remove(); DIRS.forEach((d) => handles[d].remove()); style.remove(); base.remove();
    document.body.classList.remove('cc-mw', 'cc-mw-see', 'cc-mw-drag', 'cc-modal-in');
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc modal-resize torn down';
  }
  window[NS] = {
    version: 2, teardown, refresh: render, get wins() { return JSON.parse(JSON.stringify(wins)); },
    toWindow: (id, frac) => toWindow(id || tabId(), frac), toFull: (id) => toFull(id), align, sizePct, geom: (id) => { const e = wins[id || tabId()]; return e ? geom(e) : null; },
  };
  console.log('[cc] modal-resize loaded');
  return 'cc modal-resize loaded';
})();
