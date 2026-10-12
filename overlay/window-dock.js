// ScapeLite window-controls dock. DISPLAY-ONLY. The row of buttons in the top-right corner (language, Ko-fi, Discord,
// World Map, Patch Notes, Sleep, Logout...) becomes
//   - movable and resizable: hover it and a small strip appears under it (drag the dots to move, drag the corner to
//     resize, double-click the dots to reset),
//   - collapsible: the strip has an arrow pointing at the nearest screen edge; click it and the row tucks away into a
//     small badge on that edge (click the badge to open it again),
//   - and while the World Map is open the cross button closes the map (the way the Map button does) instead of
//     logging out; its tooltip says so.
// State (position, scale, collapsed) lives in localStorage cc-wc-dock.
(function () {
  'use strict';
  const NS = '__ccWinDock';
  const LS = 'cc-wc-dock';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const settingOn = (k) => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get(k) === false); } catch (e) { return true; } };
  let st = { x: 0, y: 0, s: 1, col: false, side: 'r', rect: null, locked: false };
  try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); st = Object.assign(st, { x: +o.x || 0, y: +o.y || 0, s: Math.min(1.8, Math.max(0.5, +o.s || 1)), col: !!o.col, side: o.side || 'r', rect: o.rect || null, locked: !!o.locked }); } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} };
  const SEL = '#ui-container .window-controls';
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };

  const style = document.createElement('style'); style.id = 'cc-wc-style';
  const base = document.createElement('style'); base.id = 'cc-wc-base';
  base.textContent = `
#ui-container .window-controls .window-control-btn{position:relative;border-radius:10px !important;transition:background .16s ease,border-color .16s ease,transform .16s ease,box-shadow .16s ease,color .16s ease !important}
#ui-container .window-controls .window-control-btn:hover{background:#2a2a3a !important;border-color:#6a82c8 !important;color:#fff !important;transform:translateY(-1px);box-shadow:0 5px 16px rgba(0,0,0,.55),0 0 0 1px rgba(110,140,230,.3),0 0 14px rgba(110,140,230,.18) !important}
#ui-container .window-controls .window-control-btn-x:hover{background:linear-gradient(180deg,#8c2b2b,#6b1d1d) !important;border-color:#ff7f7f !important;box-shadow:0 5px 16px rgba(0,0,0,.55),0 0 0 1px rgba(255,110,110,.35),0 0 16px rgba(255,80,80,.4) !important}
#ui-container .window-controls .window-control-btn:active{transform:translateY(0) scale(.95)}
#ui-container .window-controls .window-control-btn svg,#ui-container .window-controls .window-control-btn img{transition:transform .16s ease}
#ui-container .window-controls .window-control-btn:hover svg,#ui-container .window-controls .window-control-btn:hover img{transform:scale(1.12)}
#ui-container .window-controls .window-control-btn:focus-visible{outline:2px solid #8fb0ff;outline-offset:2px}
body .tooltip.global-tooltip.window-control-style{max-width:290px !important;width:max-content !important;white-space:normal !important;padding:11px 14px !important;border-radius:12px !important;background:linear-gradient(180deg,#1b1b28,#11111a) !important;border:1px solid rgba(120,142,210,.42) !important;box-shadow:0 14px 34px rgba(0,0,0,.68),0 0 0 1px rgba(0,0,0,.4) !important;animation:ccWcTip .16s ease-out}
body .tooltip.global-tooltip.window-control-style .tt-name{color:#ffd86b !important;font-size:15px !important;font-weight:600 !important;margin-bottom:4px;letter-spacing:.01em}
body .tooltip.global-tooltip.window-control-style .tt-line{color:#b4bace !important;font-size:12.5px !important;line-height:1.45 !important}
@keyframes ccWcTip{from{opacity:0;transform:translateY(-4px) scale(1.2676)}to{opacity:1;transform:translateY(0) scale(1.2676)}}
body.cc-wc-on #ui-container .window-controls{background:transparent;border:1px solid transparent;border-left:0;border-right:0;border-radius:0 !important;padding:5px 6px !important;box-shadow:none;transition:border-color .2s,background .2s,box-shadow .2s}
body.cc-wc-on.cc-wc-hot #ui-container .window-controls{backdrop-filter:blur(6px);background:rgba(8,8,14,.92);border-color:rgba(120,142,210,.5);box-shadow:0 10px 28px rgba(0,0,0,.55)}
#cc-wc-strip{position:fixed;z-index:99990;display:none;box-sizing:border-box;pointer-events:none}
#cc-wc-strip.show{display:block}
#cc-wc-strip .mv,#cc-wc-strip .ar{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;box-sizing:border-box;opacity:0;background:rgba(8,8,14,.92);border:1px solid rgba(120,142,210,.5);backdrop-filter:blur(6px);box-shadow:0 10px 28px rgba(0,0,0,.55);transition:opacity .2s,color .2s,background .2s,border-color .2s,box-shadow .2s}
#cc-wc-strip.hot .mv,#cc-wc-strip.hot .ar{opacity:1}
#cc-wc-strip .mv{left:0;width:18px;cursor:grab;color:#7a8099;border-right:0;border-radius:16px 0 0 16px}
#cc-wc-strip .mv::before{content:'';width:6px;height:24px;background:radial-gradient(circle,currentColor 1.2px,transparent 1.7px) 0 0/6px 8px}
#cc-wc-strip .mv:hover{color:#ffd24a}
#cc-wc-strip .mv:active{cursor:grabbing}
#cc-wc-strip .ar{right:0;width:15px;cursor:pointer;color:#8a90aa;font:600 15px/1 system-ui,sans-serif;border-left:0;border-radius:0 16px 16px 0}
#cc-wc-strip .ar:hover{color:#ffd24a;background:rgba(40,34,12,.95)}
#cc-wc-strip.flip .mv{left:auto;right:0;border-right:1px solid rgba(255,255,255,.07);border-left:0;border-radius:0 16px 16px 0}
#cc-wc-strip.flip .ar{right:auto;left:0;border-left:1px solid rgba(255,255,255,.07);border-right:0;border-radius:16px 0 0 16px}
#cc-wc-strip .sz{position:absolute;left:4px;bottom:3px;width:11px;height:11px;pointer-events:auto;cursor:nesw-resize;border-left:2px solid #8a90aa;border-bottom:2px solid #8a90aa;border-radius:0 0 0 7px;opacity:0;transition:opacity .2s,border-color .2s;z-index:2}
#cc-wc-strip.flip .sz{left:auto;right:4px;border-left:0;border-right:2px solid #8a90aa;border-radius:0 0 7px 0;cursor:nwse-resize}
#cc-wc-strip.hot .sz{opacity:.9}
#cc-wc-strip .sz:hover{border-color:#ffd24a}
#cc-wc-badge{position:fixed;z-index:99990;display:none;align-items:center;justify-content:center;background:rgba(9,9,15,.88);border:1px solid rgba(120,142,210,.4);backdrop-filter:blur(6px);color:#aab1cc;
  font:600 16px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);transition:color .15s,border-color .15s,background .15s}
#cc-wc-badge:hover{color:#ffd24a;border-color:#ffd24a;background:rgba(30,26,12,.92)}
#cc-wc-badge.show{display:flex}`;
  const strip = document.createElement('div'); strip.id = 'cc-wc-strip';
  strip.innerHTML = '<span class="mv" title="Drag to move \u00b7 double-click to reset"></span><span class="sz" title="Drag to resize"></span><span class="ar" title="Tuck the buttons away into the screen edge"></span>';
  const badge = document.createElement('div'); badge.id = 'cc-wc-badge'; badge.title = 'Open the window buttons';
  const arEl = strip.querySelector('.ar');

  const wc = () => document.querySelector(SEL);
  const ARROW_OUT = { r: '›', l: '‹', t: '˄', b: '˅' }; // toward the wall = collapse
  const ARROW_IN = { r: '‹', l: '›', t: '˅', b: '˄' };   // away from the wall = open
  function nearest(r) {
    const d = { l: r.left, r: innerWidth - r.right, t: r.top, b: innerHeight - r.bottom };
    let best = 'r'; ['r', 'l', 't', 'b'].forEach((k) => { if (d[k] < d[best] - 0.5) best = k; });
    return best;
  }

  let lastCss = '', hover = false, hideT = 0, drag = null;
  function css() {
    const el = wc();
    if (!el || !settingOn('winDockEnabled')) return '';
    const z = uiZoom(), s = st.s;
    let tx = st.x / z / s, ty = st.y / z / s;
    let extra = '';
    if (st.col && st.rect) {
      const r = st.rect, out = { r: [r.width + 40, 0], l: [-(r.width + 40), 0], t: [0, -(r.height + 40)], b: [0, r.height + 40] }[st.side] || [0, 0];
      tx += out[0] / z / s; ty += out[1] / z / s;
      extra = 'opacity:0 !important;pointer-events:none !important;';
    }
    const zoom = Math.abs(s - 1) > 0.001 ? `zoom:${s.toFixed(4)} !important;` : '';
    return `${SEL}{${zoom}translate:${tx.toFixed(2)}px ${ty.toFixed(2)}px !important;${extra}transition:translate .22s ease,opacity .2s ease}`;
  }
  function place() {
    const el = wc();
    if (!el || !settingOn('winDockEnabled')) { strip.classList.remove('show'); badge.classList.remove('show'); return; }
    const r = el.getBoundingClientRect();
    if (!st.col && r.width > 0) {
      // remember where the row is (collapsing needs it) and which wall is nearest
      if (!drag) { st.side = nearest(r); st.rect = { left: r.left, top: r.top, width: r.width, height: r.height }; }
      // One dark pod around the whole row: move handle on the inner end, tuck-away tab on the end nearest the wall, resize corner on hover.
      const HD = 18, TB = 15, flip = st.side === 'l';
      const left = flip ? r.left - TB : r.left - HD, width = r.width + HD + TB;
      strip.classList.toggle('flip', flip);
      strip.style.left = Math.round(left) + 'px'; strip.style.top = Math.round(r.top) + 'px';
      strip.style.width = Math.round(width) + 'px'; strip.style.height = Math.round(r.height) + 'px';
      strip.classList.toggle('show', !st.locked);
      strip.classList.toggle('hot', !st.locked && (hover || !!drag));
      if (document.body) document.body.classList.toggle('cc-wc-hot', !st.locked && (hover || !!drag));
      arEl.textContent = (st.side === 'l') ? '\u2039' : '\u203a';
      badge.classList.remove('show');
    } else if (st.col && st.rect) {
      strip.classList.remove('show');
      const R = st.rect, vert = st.side === 'l' || st.side === 'r', bw = vert ? 20 : 48, bh = vert ? 50 : 20;
      let left, top;
      if (st.side === 'r') { left = innerWidth - bw; top = R.top + R.height / 2 - bh / 2; }
      else if (st.side === 'l') { left = 0; top = R.top + R.height / 2 - bh / 2; }
      else if (st.side === 't') { left = R.left + R.width / 2 - bw / 2; top = 0; }
      else { left = R.left + R.width / 2 - bw / 2; top = innerHeight - bh; }
      badge.style.cssText = `left:${Math.round(Math.max(0, Math.min(innerWidth - bw, left)))}px;top:${Math.round(Math.max(0, Math.min(innerHeight - bh, top)))}px;width:${bw}px;height:${bh}px;border-radius:${{ r: '8px 0 0 8px', l: '0 8px 8px 0', t: '0 0 8px 8px', b: '8px 8px 0 0' }[st.side]}`;
      badge.textContent = ARROW_IN[st.side];
      badge.classList.add('show');
    }
  }
  function render() {
    if (!document.head) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!base.isConnected) document.head.appendChild(base);
    if (document.body && !strip.isConnected) document.body.appendChild(strip);
    if (document.body && !badge.isConnected) document.body.appendChild(badge);
    const c = css(); if (c !== lastCss) { lastCss = c; style.textContent = c; }
    if (document.body) document.body.classList.toggle('cc-wc-on', settingOn('winDockEnabled') && !st.col && !st.locked);
    place();
    mapCross();
  }

  // ---- hover / strip actions ----
  const inside = (e) => { const el = wc(); return el && (el.contains(e.target) || strip.contains(e.target)); };
  const onOver = (e) => { if (inside(e)) { hover = true; clearTimeout(hideT); place(); } };
  const onOut = (e) => { if (inside(e)) { clearTimeout(hideT); hideT = setTimeout(() => { hover = false; place(); }, 350); } };
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  arEl.addEventListener('click', (e) => { e.stopPropagation(); const el = wc(); if (el) { const r = el.getBoundingClientRect(); if (r.width > 0) { st.side = nearest(r); st.rect = { left: r.left, top: r.top, width: r.width, height: r.height }; } } st.col = true; hover = false; save(); render(); });
  badge.addEventListener('click', (e) => { e.stopPropagation(); st.col = false; save(); render(); });
  ['mousedown', 'pointerdown', 'click', 'contextmenu'].forEach((t) => { strip.addEventListener(t, (e) => e.stopPropagation()); badge.addEventListener(t, (e) => e.stopPropagation()); });

  strip.querySelector('.mv').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st.locked) return; e.preventDefault();
    drag = { kind: 'mv', x0: e.clientX, y0: e.clientY, s0: { x: st.x, y: st.y } };
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
  });
  strip.querySelector('.mv').addEventListener('dblclick', () => { st.x = 0; st.y = 0; st.s = 1; save(); render(); });
  strip.querySelector('.sz').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || st.locked) return; e.preventDefault();
    const el = wc(), r = el ? el.getBoundingClientRect() : null;
    drag = { kind: 'sz', x0: e.clientX, w0: r ? r.width : 300, s0: st.s, left0: r ? r.left : 0, right0: r ? r.right : 0 };
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
  });
  const onMove = (e) => {
    if (!drag) return;
    if (drag.kind === 'mv') {
      const el = wc(), r = el ? el.getBoundingClientRect() : null;
      let nx = drag.s0.x + e.clientX - drag.x0, ny = drag.s0.y + e.clientY - drag.y0;
      if (r) { // keep at least a part of the row on screen
        const dx = nx - st.x, dy = ny - st.y;
        if (r.right + dx < 60) nx = st.x + (60 - r.right); if (r.left + dx > innerWidth - 60) nx = st.x + (innerWidth - 60 - r.left);
        if (r.top + dy < 0) ny = st.y - r.top; if (r.top + dy > innerHeight - 30) ny = st.y + (innerHeight - 30 - r.top);
      }
      st.x = nx; st.y = ny;
    } else {
      const k = (drag.w0 + (e.clientX - drag.x0) * (nearest({ left: drag.left0, right: drag.right0, top: 0, bottom: 100 }) === 'l' ? 1 : -1)) / drag.w0;
      st.s = Math.min(1.8, Math.max(0.5, drag.s0 * k));
    }
    render();
  };
  const onUp = () => { if (!drag) return; drag = null; save(); render(); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ---- the cross closes the World Map while it is open ----
  const mapOpen = () => document.body.classList.contains('map-active');
  function mapCross() {
    const x = document.querySelector('.window-control-btn-x');
    if (!x) return;
    const on = settingOn('winDockEnabled') && settingOn('mapCloseCross') && mapOpen();
    x.classList.toggle('cc-wc-closemap', on);
    const nm = x.querySelector('.tt-name'), ln = x.querySelector('.tt-line');
    if (nm) { const want = on ? 'Close map' : (nm.dataset.ccOrig || nm.textContent); if (!nm.dataset.ccOrig && !on) nm.dataset.ccOrig = nm.textContent; if (on && !nm.dataset.ccOrig) nm.dataset.ccOrig = nm.textContent; if (nm.textContent !== want) nm.textContent = want; }
    if (ln) { const want = on ? 'Go back to your game view.' : (ln.dataset.ccOrig || ln.textContent); if (on && !ln.dataset.ccOrig) ln.dataset.ccOrig = ln.textContent; if (!on && !ln.dataset.ccOrig) ln.dataset.ccOrig = ln.textContent; if (ln.textContent !== want) ln.textContent = want; }
  }
  function onClickCapture(e) {
    const x = e.target && e.target.closest ? e.target.closest('.window-control-btn-x') : null;
    if (!x || !settingOn('winDockEnabled') || !settingOn('mapCloseCross') || !mapOpen()) return;
    const map = document.querySelector('.window-control-btn-map');
    if (!map) return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    map.click();
  }
  document.addEventListener('click', onClickCapture, true);

  // ---- right-click menu (lock / reset) ----
  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; } document.removeEventListener('mousedown', onMenuAway, true); };
  function onMenuAway(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function openMenu(x, y, title, locked, onLock, onReset) {
    closeMenu();
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;z-index:100020;min-width:210px;background:#16161e;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,.65);font:13px/1.3 system-ui,sans-serif;color:#ddd;';
    const row = (txt, fn, dim) => { const d = document.createElement('div'); d.textContent = txt; d.style.cssText = 'padding:6px 10px;border-radius:7px;cursor:pointer;' + (dim ? 'color:#8a8a9a;' : ''); d.addEventListener('mouseenter', () => { d.style.background = 'rgba(255,255,255,.09)'; }); d.addEventListener('mouseleave', () => { d.style.background = ''; }); d.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); fn(); }); m.appendChild(d); };
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'padding:3px 10px 5px;color:#8a8a9a;font-size:11px;letter-spacing:.06em;text-transform:uppercase;'; m.appendChild(h);
    row(locked ? '\uD83D\uDD13 Unlock (move and resize again)' : '\uD83D\uDD12 Lock in place', onLock);
    row('Reset position and size', onReset, true);
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, x)) + 'px'; m.style.top = Math.max(4, Math.min(innerHeight - r.height - 4, y)) + 'px';
    menuEl = m; document.addEventListener('mousedown', onMenuAway, true);
  }
  const setLocked = (v) => { st.locked = !!v; hover = false; save(); render(); };
  strip.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, 'Window buttons', st.locked, () => setLocked(!st.locked), () => { st.x = 0; st.y = 0; st.s = 1; save(); render(); }); });
  // Locked: the pod is invisible, so the menu is reached by right-clicking the row's background (not one of the buttons).
  const onRowContext = (e) => {
    const row = wc();
    if (!row || e.target !== row || !settingOn('winDockEnabled')) return;
    e.preventDefault(); e.stopPropagation();
    openMenu(e.clientX, e.clientY, 'Window buttons', st.locked, () => setLocked(!st.locked), () => { st.x = 0; st.y = 0; st.s = 1; save(); render(); });
  };
  document.addEventListener('contextmenu', onRowContext, true);

  // ---- food and potions panel: movable (hover handle), lockable, resizing stays with the panel's own grip ----
  const PSEL = '.active-potions-panel';
  const LS_P = 'cc-potions-dock';
  let ps = { x: 0, y: 0, locked: false };
  try { const o = JSON.parse(localStorage.getItem(LS_P) || '{}'); ps = { x: +o.x || 0, y: +o.y || 0, locked: !!o.locked }; } catch (e) {}
  const saveP = () => { try { localStorage.setItem(LS_P, JSON.stringify(ps)); } catch (e) {} };
  const pStyle = document.createElement('style'); pStyle.id = 'cc-pot-dock-style';
  pStyle.textContent = '#cc-pot-handle{position:fixed;z-index:99990;width:16px;height:46px;display:none;align-items:center;justify-content:center;box-sizing:border-box;border-radius:9px 0 0 9px;cursor:grab;color:#7a8099;background:rgba(8,8,14,.92);border:1px solid rgba(120,142,210,.5);border-right:0;backdrop-filter:blur(6px);box-shadow:0 8px 22px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,color .2s}#cc-pot-handle.show{display:flex}#cc-pot-handle.hot{opacity:1}#cc-pot-handle:hover{color:#ffd24a}#cc-pot-handle:active{cursor:grabbing}#cc-pot-handle::before{content:"";width:6px;height:24px;background:radial-gradient(circle,currentColor 1.2px,transparent 1.7px) 0 0/6px 8px}';
  const pHandle = document.createElement('div'); pHandle.id = 'cc-pot-handle'; pHandle.title = 'Drag to move \u00b7 right-click to lock';
  let pHover = false, pHideT = 0, pDrag = null, pLast = '';
  const potPanel = () => document.querySelector(PSEL);
  function pRender() {
    if (!document.head) return;
    if (!pStyle.isConnected) document.head.appendChild(pStyle);
    if (document.body && !pHandle.isConnected) document.body.appendChild(pHandle);
    const el = potPanel(), on = settingOn('potionsDockEnabled') && el;
    const z = uiZoom();
    const css = on && (ps.x || ps.y) ? `${PSEL}{translate:${(ps.x / z).toFixed(2)}px ${(ps.y / z).toFixed(2)}px !important}` : '';
    if (css !== pLast) { pLast = css; pStyle.textContent = pStyle.textContent.split('\n')[0].replace(/\n.*/, '') && css ? pStyle.textContent.replace(/\n[\s\S]*$/, '') + '\n' + css : pStyle.textContent.replace(/\n[\s\S]*$/, ''); }
    if (!on) { pHandle.classList.remove('show'); return; }
    const r = el.getBoundingClientRect();
    const vis = r.width > 0 && r.height > 0 && !ps.locked;
    pHandle.classList.toggle('show', vis);
    pHandle.classList.toggle('hot', vis && (pHover || !!pDrag));
    if (vis) { pHandle.style.left = Math.round(Math.max(0, r.left - 16)) + 'px'; pHandle.style.top = Math.round(r.top + 6) + 'px'; }
  }
  const pInside = (e) => { const el = potPanel(); return el && (el.contains(e.target) || pHandle.contains(e.target)); };
  const pOver = (e) => { if (pInside(e)) { pHover = true; clearTimeout(pHideT); pRender(); } };
  const pOut = (e) => { if (pInside(e)) { clearTimeout(pHideT); pHideT = setTimeout(() => { pHover = false; pRender(); }, 350); } };
  document.addEventListener('mouseover', pOver, true); document.addEventListener('mouseout', pOut, true);
  ['mousedown', 'click'].forEach((t) => pHandle.addEventListener(t, (e) => e.stopPropagation()));
  pHandle.addEventListener('pointerdown', (e) => { if (e.button !== 0 || ps.locked) return; e.preventDefault(); e.stopPropagation(); pDrag = { x0: e.clientX, y0: e.clientY, o: { x: ps.x, y: ps.y } }; try { pHandle.setPointerCapture(e.pointerId); } catch (er) {} });
  pHandle.addEventListener('dblclick', () => { ps.x = 0; ps.y = 0; saveP(); pRender(); });
  pHandle.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY, 'Food and potions', ps.locked, () => { ps.locked = !ps.locked; pHover = false; saveP(); pRender(); }, () => { ps.x = 0; ps.y = 0; saveP(); pRender(); }); });
  // Locked: right-click the panel's own background to unlock.
  const onPotContext = (e) => {
    const el = potPanel();
    if (!el || !ps.locked || !settingOn('potionsDockEnabled')) return;
    if (!(e.target === el || (e.target.classList && e.target.classList.contains('active-potions-body')))) return;
    e.preventDefault(); e.stopPropagation();
    openMenu(e.clientX, e.clientY, 'Food and potions', true, () => { ps.locked = false; saveP(); pRender(); }, () => { ps.x = 0; ps.y = 0; ps.locked = false; saveP(); pRender(); });
  };
  document.addEventListener('contextmenu', onPotContext, true);
  const pMove = (e) => {
    if (!pDrag) return;
    const el = potPanel(), r = el ? el.getBoundingClientRect() : null;
    let nx = pDrag.o.x + e.clientX - pDrag.x0, ny = pDrag.o.y + e.clientY - pDrag.y0;
    if (r) { const dx = nx - ps.x, dy = ny - ps.y; if (r.right + dx < 80) nx = ps.x + (80 - r.right); if (r.left + dx > innerWidth - 40) nx = ps.x + (innerWidth - 40 - r.left); if (r.top + dy < 0) ny = ps.y - r.top; if (r.top + dy > innerHeight - 40) ny = ps.y + (innerHeight - 40 - r.top); }
    ps.x = nx; ps.y = ny; pRender();
  };
  const pUp = () => { if (!pDrag) return; pDrag = null; saveP(); pRender(); };
  window.addEventListener('pointermove', pMove); window.addEventListener('pointerup', pUp); window.addEventListener('pointercancel', pUp);

  const timer = setInterval(() => { try { if (!document.hidden && !drag) render(); if (!document.hidden && !pDrag) pRender(); } catch (e) { /* keep ticking */ } }, 400);
  render();

  function teardown() {
    clearInterval(timer); clearTimeout(hideT);
    document.removeEventListener('mouseover', onOver, true); document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('click', onClickCapture, true);
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
    strip.remove(); badge.remove(); style.remove(); base.remove();
    closeMenu(); pHandle.remove(); pStyle.remove();
    document.removeEventListener('contextmenu', onRowContext, true); document.removeEventListener('contextmenu', onPotContext, true);
    document.removeEventListener('mouseover', pOver, true); document.removeEventListener('mouseout', pOut, true);
    window.removeEventListener('pointermove', pMove); window.removeEventListener('pointerup', pUp); window.removeEventListener('pointercancel', pUp);
    if (document.body) document.body.classList.remove('cc-wc-on', 'cc-wc-hot');
    const x = document.querySelector('.window-control-btn-x');
    if (x) { x.classList.remove('cc-wc-closemap'); const nm = x.querySelector('.tt-name'), ln = x.querySelector('.tt-line'); if (nm && nm.dataset.ccOrig) nm.textContent = nm.dataset.ccOrig; if (ln && ln.dataset.ccOrig) ln.textContent = ln.dataset.ccOrig; }
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc window-dock torn down';
  }
  window[NS] = { version: 1, teardown, get state() { return Object.assign({}, st); }, collapse(v) { st.col = !!v; save(); render(); }, reset() { st = { x: 0, y: 0, s: 1, col: false, side: 'r', rect: null }; save(); render(); } };
  console.log('[cc] window-dock loaded');
  return 'cc window-dock loaded';
})();
