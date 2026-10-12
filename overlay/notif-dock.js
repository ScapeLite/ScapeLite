// ScapeLite notification dock. DISPLAY-ONLY: the game's pop-up notifications (invite tray for raid / party / friend
// invites, task-complete celebration popups, dashboard toasts) are
//   1. raised above every panel and window so nothing can hide them,
//   2. centred horizontally by default (the invite tray normally sits in the top-left),
//   3. movable: a small strip above the invite tray drags it, and "Move notifications" (Settings > Plugins, or
//      __ccNotifDock.edit(true)) shows draggable frames for all three so even short-lived popups can be placed.
// Positions are remembered (localStorage cc-notif-pos) as offsets from the centred default.
(function () {
  'use strict';
  const NS = '__ccNotifDock';
  const LS = 'cc-notif-pos';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const enabled = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('notifDockEnabled') === false); } catch (e) { return true; } };
  const Z = 6000; // above panels (<=505), windows (2000) and the task popup (3000), below confirm dialogs (6500)
  const T = [
    { id: 'invites', label: 'Invites', sel: '.invite-tray', w: 300, h: 70, base: (z) => ({ y: 57 * z }), centre: true },
    { id: 'popups', label: 'Task popups', sel: '.celebration-container', w: 420, h: 90, base: () => ({ y: 8 }), centre: false },
    { id: 'toasts', label: 'Toasts', sel: '.dash-toast', w: 320, h: 50, base: (z, h) => ({ y: innerHeight - 80 * z - h }), centre: false },
  ];
  let pos = {};
  try { pos = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { pos = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(pos)); } catch (e) {} };
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };
  const off = (id) => pos[id] || { x: 0, y: 0 };

  const style = document.createElement('style'); style.id = 'cc-notif-style';
  const base = document.createElement('style'); base.id = 'cc-notif-base';
  base.textContent = `
.cc-nd-grip{position:fixed;z-index:${Z + 1};height:16px;padding:0 8px;display:flex;align-items:center;gap:6px;background:rgba(20,20,26,.92);border:1px solid #2a2a38;border-bottom:0;
  border-radius:6px 6px 0 0;color:#8f8fa0;font:11px/1 system-ui,sans-serif;cursor:grab;user-select:none;opacity:.55;transition:opacity .15s}
.cc-nd-grip:hover,.cc-nd-grip.drag{opacity:1}.cc-nd-grip.drag{cursor:grabbing}
.cc-nd-frame{position:fixed;z-index:${Z + 2};box-sizing:border-box;border:2px dashed #ffd24a;background:rgba(255,210,74,.10);border-radius:8px;color:#ffd24a;
  font:600 13px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;cursor:grab;user-select:none;text-shadow:0 1px 3px #000}
.cc-nd-frame.drag{cursor:grabbing;background:rgba(255,210,74,.2)}
.cc-nd-bar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:${Z + 3};display:flex;gap:8px;align-items:center;padding:8px 12px;
  background:#16161e;border:1px solid rgba(255,255,255,.2);border-radius:10px;color:#ddd;font:13px/1.3 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6)}
.cc-nd-bar button{font:inherit;color:#ddd;background:#23232f;border:1px solid #3a3a4a;border-radius:7px;padding:4px 12px;cursor:pointer}
.cc-nd-bar button:hover{border-color:#8a8aa0}.cc-nd-bar button.primary{border-color:#b8962f;color:#ffd24a;background:#2c2a18}`;

  let editing = false, lastCss = '';
  function css() {
    if (!enabled()) return '';
    const z = uiZoom();
    return T.map((t) => {
      const o = off(t.id);
      const tr = (o.x || o.y) ? `translate:${(o.x / z).toFixed(1)}px ${(o.y / z).toFixed(1)}px !important;` : '';
      // The invite tray is centred (it ships in the top-left); the other two are already centred by the game / panel-resize.
      const centre = t.centre ? 'left:var(--playable-center-x,50%) !important;right:auto !important;transform:translateX(-50%) !important;' : '';
      return `${t.sel}{z-index:${Z} !important;${centre}${tr}}`;
    }).join('\n');
  }

  const grips = {}, frames = {};
  let bar = null, drag = null;
  function frameRect(t) {
    const z = uiZoom(), o = off(t.id), b = t.base(z, t.h * z);
    const cx = innerWidth / 2;
    return { left: cx - (t.w * z) / 2 + o.x, top: b.y + o.y, width: t.w * z, height: t.h * z };
  }
  function clampOff(t, o, r0) {
    // keep at least 60x24 px of the frame on screen
    const left = r0.left + o.x, top = r0.top + o.y;
    const nl = Math.min(innerWidth - 60, Math.max(60 - r0.width, left)), nt = Math.min(innerHeight - 24, Math.max(0, top));
    return { x: nl - r0.left, y: nt - r0.top };
  }
  function startDrag(t, e, el, rect0) {
    e.preventDefault(); e.stopPropagation();
    const o0 = Object.assign({}, off(t.id));
    drag = { t, x0: e.clientX, y0: e.clientY, o0, r0: rect0, el };
    el.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch (er) {}
  }
  const onMove = (e) => {
    if (!drag) return;
    const o = clampOff(drag.t, { x: drag.o0.x + e.clientX - drag.x0, y: drag.o0.y + e.clientY - drag.y0 }, drag.r0);
    pos[drag.t.id] = o; render();
  };
  const end = () => { if (!drag) return; drag.el.classList.remove('drag'); drag = null; save(); render(); };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);

  function render() {
    if (!document.head) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!base.isConnected) document.head.appendChild(base);
    const c = css(); if (c !== lastCss) { lastCss = c; style.textContent = c; }
    const on = enabled();
    // Strip above the invite tray (only while it is on screen).
    const tray = on && !editing ? document.querySelector('.invite-tray') : null;
    const tr = tray ? tray.getBoundingClientRect() : null;
    const t0 = T[0];
    if (tr && tr.width > 0 && tr.height > 0) {
      let g = grips.invites;
      if (!g) {
        g = grips.invites = document.createElement('div'); g.className = 'cc-nd-grip'; g.textContent = '⠇⠇ move'; g.title = 'Drag to move invites · double-click to reset';
        g.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; const r = tray.getBoundingClientRect(); const o = off('invites'); startDrag(t0, e, g, { left: r.left - o.x, top: r.top - o.y, width: r.width, height: r.height }); });
        g.addEventListener('dblclick', (e) => { e.preventDefault(); delete pos.invites; save(); render(); });
        ['mousedown', 'click', 'contextmenu'].forEach((ev) => g.addEventListener(ev, (e) => e.stopPropagation()));
      }
      if (!g.isConnected) document.body.appendChild(g);
      g.style.display = ''; g.style.left = Math.round(tr.left) + 'px'; g.style.top = Math.max(0, Math.round(tr.top) - 16) + 'px'; g.style.width = Math.round(tr.width) + 'px';
    } else if (grips.invites) grips.invites.style.display = 'none';
    // Edit-mode frames.
    if (editing && on) {
      T.forEach((t) => {
        let f = frames[t.id];
        if (!f) {
          f = frames[t.id] = document.createElement('div'); f.className = 'cc-nd-frame'; f.textContent = t.label;
          f.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; const r = frameRect(t); const o = off(t.id); startDrag(t, e, f, { left: r.left - o.x, top: r.top - o.y, width: r.width, height: r.height }); });
          f.addEventListener('dblclick', (e) => { e.preventDefault(); delete pos[t.id]; save(); render(); });
          ['mousedown', 'click', 'contextmenu'].forEach((ev) => f.addEventListener(ev, (e) => e.stopPropagation()));
        }
        if (!f.isConnected) document.body.appendChild(f);
        const r = frameRect(t);
        f.style.left = Math.round(r.left) + 'px'; f.style.top = Math.round(r.top) + 'px'; f.style.width = Math.round(r.width) + 'px'; f.style.height = Math.round(r.height) + 'px';
      });
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'cc-nd-bar';
        const msg = document.createElement('span'); msg.textContent = 'Drag the frames to where you want each notification. Double-click a frame to reset it.';
        const rs = document.createElement('button'); rs.textContent = 'Reset all'; rs.addEventListener('click', () => { pos = {}; save(); render(); });
        const dn = document.createElement('button'); dn.className = 'primary'; dn.textContent = 'Done'; dn.addEventListener('click', () => setEdit(false));
        bar.append(msg, rs, dn);
        ['mousedown', 'click', 'contextmenu'].forEach((ev) => bar.addEventListener(ev, (e) => e.stopPropagation()));
        document.body.appendChild(bar);
      }
    } else {
      Object.keys(frames).forEach((k) => { frames[k].remove(); delete frames[k]; });
      if (bar) { bar.remove(); bar = null; }
    }
  }
  function setEdit(on) { editing = !!on; render(); }
  const onKey = (e) => { if (editing && e.key === 'Escape') setEdit(false); };
  document.addEventListener('keydown', onKey, true);

  const timer = setInterval(() => { if (!drag) render(); }, 300);
  render();

  function teardown() {
    clearInterval(timer);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', end, true);
    document.removeEventListener('keydown', onKey, true);
    Object.values(grips).forEach((g) => g.remove()); Object.values(frames).forEach((f) => f.remove()); if (bar) bar.remove();
    style.remove(); base.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc notif-dock torn down';
  }
  window[NS] = { version: 1, teardown, edit: setEdit, get pos() { return JSON.parse(JSON.stringify(pos)); }, refresh: render };
  console.log('[cc] notif-dock loaded');
  return 'cc notif-dock loaded';
})();
