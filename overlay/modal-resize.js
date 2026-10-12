// ScapeLite modal resize. DISPLAY-ONLY: the game's big windows (Settings, Bank, Crafting, ... all live in one
// full-screen "modal" container) get a corner grip. Drag it towards the centre to shrink the window (so the game
// stays visible around it); double-click the grip to restore full size. The size is remembered per window/tab.
// Implemented with CSS `zoom` on .modal-container, so layout and text scale together and nothing is re-parented.
// FLOAT: a small "Float" button by the grip turns the window into a floating one: drag it by its tab bar to move it,
// and the game behind stays usable (clicks outside the window go through, and it stays where it is). The background
// is only dimmed and blurred while your pointer is inside the window. Remembered per window.
(function () {
  'use strict';
  const NS = '__ccModalResize';
  const LS = 'cc-modal-scale';
  const MIN = 0.5, MAX = 1;
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const enabled = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('modalResizeEnabled') === false); } catch (e) { return true; } };
  let scales = {};
  try { scales = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { scales = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(scales)); } catch (e) {} };
  const LS_FL = 'cc-modal-float';
  let fl = {};
  try { fl = JSON.parse(localStorage.getItem(LS_FL) || '{}') || {}; } catch (e) { fl = {}; }
  const saveFl = () => { try { localStorage.setItem(LS_FL, JSON.stringify(fl)); } catch (e) {} };
  const floatOn = () => { try { const st = window.__ccPluginSettings; return !(st && st.get && st.get('modalFloatEnabled') === false); } catch (e) { return true; } };
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };

  const style = document.createElement('style'); style.id = 'cc-modal-resize-style';
  const base = document.createElement('style'); base.id = 'cc-modal-resize-base';
  base.textContent = `
#cc-modal-grip{position:fixed;z-index:100005;width:16px;height:16px;box-sizing:border-box;cursor:nwse-resize;opacity:.5;transition:opacity .15s;
  border-right:2px solid rgba(255,255,255,.6);border-bottom:2px solid rgba(255,255,255,.6);border-radius:0 0 7px 0;touch-action:none}
#cc-modal-grip:hover,#cc-modal-grip.drag{opacity:1}
#cc-modal-grip .lbl{display:none;position:absolute;right:20px;bottom:0;padding:1px 6px;border-radius:4px;background:rgba(0,0,0,.75);color:#fff;font:12px/16px system-ui,sans-serif;white-space:nowrap}
#cc-modal-grip.drag .lbl{display:block}
#cc-modal-float{position:fixed;z-index:100005;height:18px;padding:0 8px;box-sizing:border-box;display:none;align-items:center;gap:4px;border-radius:9px;border:1px solid #3a3a4c;
  background:rgba(20,20,26,.92);color:#9a9aae;font:11px/16px system-ui,sans-serif;cursor:pointer;user-select:none;opacity:.7;transition:opacity .15s}
#cc-modal-float:hover{opacity:1;color:#fff}
#cc-modal-float.on{color:#ffd24a;border-color:#b8962f;opacity:1}
body.cc-modal-float .modal-overlay{pointer-events:none !important;background:transparent !important;transition:background .22s ease,backdrop-filter .22s ease}
body.cc-modal-float .modal-overlay .modal-container{pointer-events:auto !important}
body.cc-modal-float.cc-modal-in .modal-overlay{background:rgba(0,0,0,.55) !important;backdrop-filter:blur(3px)}
body.cc-modal-float .modal-overlay .modal-header{cursor:grab}
body.cc-modal-float.cc-modal-drag .modal-overlay .modal-header{cursor:grabbing}`;
  const grip = document.createElement('div'); grip.id = 'cc-modal-grip'; grip.title = 'Drag to resize this window · double-click to reset';
  grip.innerHTML = '<span class="lbl"></span>';
  const fbtn = document.createElement('div'); fbtn.id = 'cc-modal-float'; fbtn.textContent = 'Float'; fbtn.title = 'Float this window: move it by its tab bar, keep playing behind it';

  const ov = () => document.querySelector('.modal-overlay');
  const container = () => document.querySelector('.modal-overlay .modal-container');
  const tabId = () => { const t = document.querySelector('.modal-body > .tab-content.active'); return (t && t.id) || 'modal'; };
  const isOpen = () => { const o = ov(); return !!o && getComputedStyle(o).display !== 'none'; };
  const cur = () => Math.min(MAX, Math.max(MIN, scales[tabId()] || 1));

  let lastCss = '';
  function render() {
    if (!document.head) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!base.isConnected) document.head.appendChild(base);
    const on = enabled();
    const s = on ? cur() : 1;
    const f = on && floatOn() && isOpen() ? fl[tabId()] : null;
    const isF = !!(f && f.f);
    if (document.body) { document.body.classList.toggle('cc-modal-float', isF); if (!isF) document.body.classList.remove('cc-modal-in'); }
    let css = s < 0.999 ? `.modal-overlay .modal-container{zoom:${s} !important}` : '';
    if (isF && (f.x || f.y)) { const k = uiZoom() * s; css += `.modal-overlay .modal-container{translate:${((f.x || 0) / k).toFixed(2)}px ${((f.y || 0) / k).toFixed(2)}px !important}`; }
    if (css !== lastCss) { lastCss = css; style.textContent = css; }
    const c = container();
    const show = on && isOpen() && c;
    if (show && !grip.isConnected && document.body) document.body.appendChild(grip);
    if (!grip.isConnected) return;
    grip.style.display = show ? '' : 'none';
    if (show && !fbtn.isConnected && document.body) document.body.appendChild(fbtn);
    fbtn.style.display = show && floatOn() ? 'flex' : 'none';
    fbtn.classList.toggle('on', isF);
    if (show) {
      const r = c.getBoundingClientRect();
      grip.style.left = Math.round(Math.min(r.right, innerWidth) - 16) + 'px';
      grip.style.top = Math.round(Math.min(r.bottom, innerHeight) - 16) + 'px';
      fbtn.style.left = Math.round(Math.min(r.right, innerWidth) - 16 - 52) + 'px';
      fbtn.style.top = Math.round(Math.min(r.bottom, innerHeight) - 17) + 'px';
      if (isF && c && !c.dataset.ccFl) { c.dataset.ccFl = '1'; c.addEventListener('mouseenter', () => document.body.classList.add('cc-modal-in')); c.addEventListener('mouseleave', () => { if (!document.activeElement || !c.contains(document.activeElement) || document.activeElement.tagName === 'BODY') document.body.classList.remove('cc-modal-in'); }); }
    }
  }

  let drag = null, raf = 0;
  const loop = () => { render(); if (drag) raf = requestAnimationFrame(loop); };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const c = container(); if (!c) return;
    const r = c.getBoundingClientRect();
    drag = { x0: e.clientX, y0: e.clientY, s0: cur(), w: r.width, h: r.height, id: tabId() };
    grip.classList.add('drag'); try { grip.setPointerCapture(e.pointerId); } catch (er) {}
    loop();
  });
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    // The window is centred, so a corner moves by (f-1)/2 of its size when the scale changes by f.
    const t = 2 * (dx * drag.w + dy * drag.h) / (drag.w * drag.w + drag.h * drag.h);
    let s = Math.min(MAX, Math.max(MIN, Math.round(drag.s0 * (1 + t) * 1000) / 1000));
    if (s > 0.97) s = 1;
    if (s === 1) delete scales[drag.id]; else scales[drag.id] = s;
    grip.querySelector('.lbl').textContent = Math.round(s * 100) + '%';
  };
  const end = () => { if (!drag) return; drag = null; grip.classList.remove('drag'); cancelAnimationFrame(raf); save(); render(); };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  grip.addEventListener('dblclick', (e) => { e.preventDefault(); delete scales[tabId()]; save(); render(); });
  ['mousedown', 'click', 'contextmenu'].forEach((t) => grip.addEventListener(t, (e) => e.stopPropagation()));

  fbtn.addEventListener('click', (e) => {
    e.stopPropagation(); const id = tabId();
    const f = fl[id] || (fl[id] = { f: false, x: 0, y: 0 });
    f.f = !f.f; if (!f.f && !f.x && !f.y) delete fl[id];
    saveFl(); render();
  });
  fbtn.addEventListener('dblclick', (e) => { e.stopPropagation(); const f = fl[tabId()]; if (f) { f.x = 0; f.y = 0; saveFl(); render(); } });
  ['mousedown', 'pointerdown', 'contextmenu'].forEach((t) => fbtn.addEventListener(t, (e) => e.stopPropagation()));
  let mv = null;
  const onDown = (e) => {
    if (e.button !== 0 || !document.body.classList.contains('cc-modal-float')) return;
    const bar = e.target && e.target.closest ? e.target.closest('.modal-overlay .modal-header') : null;
    if (!bar || e.target.closest('button, input, select, textarea, a, .tab-btn')) return;
    const f = fl[tabId()]; if (!f || !f.f) return;
    const c = container(); if (!c) return;
    const r = c.getBoundingClientRect();
    mv = { x0: e.clientX, y0: e.clientY, fx: f.x || 0, fy: f.y || 0, r, id: tabId() };
    document.body.classList.add('cc-modal-drag'); e.preventDefault();
  };
  const onMv = (e) => {
    if (!mv) return;
    const f = fl[mv.id]; if (!f) return;
    let dx = e.clientX - mv.x0, dy = e.clientY - mv.y0;
    // keep at least 90 x 30 px of the window on screen
    dx = Math.max(90 - mv.r.right, Math.min(innerWidth - 90 - mv.r.left, dx)); dy = Math.max(-mv.r.top, Math.min(innerHeight - 30 - mv.r.top, dy));
    f.x = mv.fx + dx; f.y = mv.fy + dy; render();
  };
  const onUp = () => { if (!mv) return; mv = null; document.body.classList.remove('cc-modal-drag'); saveFl(); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMv, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  document.addEventListener('focusin', () => { if (document.body.classList.contains('cc-modal-float') && container() && container().contains(document.activeElement)) document.body.classList.add('cc-modal-in'); }, true);

  const timer = setInterval(() => { if (!drag && !mv) render(); }, 250);
  render();

  function teardown() {
    clearInterval(timer); cancelAnimationFrame(raf);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', end, true);
    grip.remove(); fbtn.remove(); style.remove(); base.remove();
    document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('pointermove', onMv, true);
    document.removeEventListener('pointerup', onUp, true); document.removeEventListener('pointercancel', onUp, true);
    document.body.classList.remove('cc-modal-float', 'cc-modal-in', 'cc-modal-drag');
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc modal-resize torn down';
  }
  window[NS] = { version: 1, teardown, get scales() { return Object.assign({}, scales); }, refresh: render };
  console.log('[cc] modal-resize loaded');
  return 'cc modal-resize loaded';
})();
