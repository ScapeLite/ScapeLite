// ScapeLite menu dock. DISPLAY-ONLY: makes the vertical bottom-right menu + the HP bar behave like one panel:
// a thin handle strip above it lets you MOVE it (drag), a corner grip RESIZES it (CSS zoom, so layout and
// outlines scale correctly), and it takes part in Panel Fuse (link buttons appear in the strip when it touches
// a panel). Works on top of panel-resize's vertical menu (needs it switched on). State: localStorage cc-menu-dock.
(function () {
  'use strict';
  const NS = '__ccMenuDock';
  const LS = 'cc-menu-dock';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const settingOn = (k) => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get(k) === false); } catch (e) { return true; } };
  let st = { x: 0, y: 0, s: 1, locked: false };
  try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); st = { x: +o.x || 0, y: +o.y || 0, s: Math.min(1.8, Math.max(0.5, +o.s || 1)), locked: !!o.locked }; } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} };

  const BAR = '#ui-container>.panel-tab-bar', HP = '#ui-container>.hp-bar';
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };
  const style = document.createElement('style'); style.id = 'cc-menu-dock-style';
  const base = document.createElement('style'); base.id = 'cc-menu-dock-base';
  base.textContent = `
#cc-dock-grip{position:fixed;z-index:99987;display:flex;align-items:center;gap:4px;height:18px;padding:0 4px;box-sizing:border-box;
  background:rgba(20,20,26,.92);border:1px solid #2a2a38;border-bottom:0;border-radius:6px 6px 0 0;color:#8f8fa0;font:11px/1 system-ui,sans-serif;
  cursor:grab;user-select:none;opacity:.55;transition:opacity .15s}
#cc-dock-grip:hover,#cc-dock-grip.drag{opacity:1}
#cc-dock-grip.drag{cursor:grabbing}
#cc-dock-grip .gb{flex:1;text-align:center;pointer-events:none;letter-spacing:.1em}
#cc-dock-grip .panel-titlebar-btns{display:flex;gap:2px}
#cc-dock-grip .cc-fuse-btn{background:transparent;border:0;color:#9a9aae;padding:0 3px;cursor:pointer;display:inline-flex;align-items:center}
#cc-dock-grip .cc-fuse-btn:hover,#cc-dock-grip .cc-fuse-btn.fused{color:#ffd24a}
#cc-dock-size{position:fixed;z-index:99987;width:14px;height:14px;box-sizing:border-box;cursor:nwse-resize;opacity:.5;
  border-left:2px solid rgba(255,255,255,.55);border-top:2px solid rgba(255,255,255,.55);border-radius:6px 0 0 0}
#cc-dock-size:hover,#cc-dock-size.drag{opacity:1}`;
  const grip = document.createElement('div'); grip.id = 'cc-dock-grip'; grip.className = 'cc-dock-grip'; grip.dataset.panelId = 'menudock';
  grip.innerHTML = '<span class="gb">⠇⠇</span><span class="panel-titlebar-btns"></span>';
  grip.title = 'Drag to move the menu + HP bar';
  const sizer = document.createElement('div'); sizer.id = 'cc-dock-size'; sizer.title = 'Drag to resize the menu + HP bar';

  function els() { return { bar: document.querySelector(BAR), hp: document.querySelector(HP) }; }
  function union() {
    const { bar, hp } = els(); if (!bar) return null;
    let r = bar.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    if (hp) { const h = hp.getBoundingClientRect(); if (h.width > 0) { l = Math.min(l, h.left); t = Math.min(t, h.top); rr = Math.max(rr, h.right); b = Math.max(b, h.bottom); } }
    return { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t };
  }
  const fuseOff = () => { try { return (window.__ccPanelFuse && window.__ccPanelFuse.off && window.__ccPanelFuse.off.menudock) || { x: 0, y: 0 }; } catch (e) { return { x: 0, y: 0 }; } };

  let lastCss = '';
  function render() {
    if (!document.head) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!base.isConnected) document.head.appendChild(base);
    const on = settingOn('menuDockEnabled') && document.body && document.body.classList.contains('cc-vmenu');
    let css = '';
    if (on) {
      const o = fuseOff(), tx = (st.x + o.x) / st.s, ty = (st.y + o.y) / st.s; // translate is scaled by the element's own zoom
      const t = (Math.abs(tx) > 0.05 || Math.abs(ty) > 0.05) ? `translate:${tx.toFixed(2)}px ${ty.toFixed(2)}px !important;` : '';
      const z = Math.abs(st.s - 1) > 0.001 ? `zoom:${st.s.toFixed(4)} !important;` : '';
      const rule = (z + t);
      // The menu must paint above the HP bar (the HP bar's z-index is 1100) or its outlines get cut.
      css = `body.cc-vmenu ${BAR}{${rule}z-index:1101 !important}\nbody.cc-vmenu ${HP}{${rule}}\n`;
    }
    if (css !== lastCss) { lastCss = css; style.textContent = css; }
    // Sides the dock is fused on: the menu buttons drop their rounding there so the seam is flush.
    let sides = [];
    try { sides = (on && window.__ccPanelFuse && window.__ccPanelFuse.sidesOf && window.__ccPanelFuse.sidesOf('menudock')) || []; } catch (e) {}
    ['l', 'r', 't', 'b'].forEach((k) => document.body && document.body.classList.toggle('cc-dock-f-' + k, sides.includes(k)));
    const u = on ? union() : null;
    const show = !!u;
    [grip, sizer].forEach((e) => { if (show && !e.isConnected && document.body) document.body.appendChild(e); if (e.isConnected) e.style.display = show ? '' : 'none'; });
    if (u) {
      const gw = Math.max(u.width, 30);
      grip.title = st.locked ? 'Locked (right-click to unlock)' : 'Drag to move the menu + HP bar · right-click for options';
      grip.firstChild.textContent = st.locked ? '🔒' : '⠇⠇';
      grip.style.cursor = st.locked ? 'default' : '';
      grip.style.width = gw + 'px'; grip.style.left = u.left + 'px'; grip.style.top = Math.max(0, u.top - 18) + 'px';
      sizer.style.left = (u.left - 1) + 'px'; sizer.style.top = (u.top - 1) + 'px';
      // The strip hugs the top edge; keep the resize corner just inside the group's top-left.
    }
  }

  function clampMove(dx, dy, u) {
    // keep the group fully on screen
    const z = uiZoom();
    let nx = st.x + dx / z, ny = st.y + dy / z;
    const adjX = (nx - st.x) * z, adjY = (ny - st.y) * z;
    if (u.left + adjX < 0) nx = st.x - u.left / z;
    if (u.right + adjX > innerWidth) nx = st.x + (innerWidth - u.right) / z;
    if (u.top + adjY < 20) ny = st.y - (u.top - 20) / z;
    if (u.bottom + adjY > innerHeight) ny = st.y + (innerHeight - u.bottom) / z;
    return { x: nx, y: ny };
  }

  let drag = null, raf = 0;
  const loop = () => { render(); if (drag) raf = requestAnimationFrame(loop); };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.cc-fuse-btn')) return;
    e.preventDefault(); e.stopPropagation();
    if (st.locked) return;
    const u = union(); if (!u) return;
    drag = { kind: 'move', x0: e.clientX, y0: e.clientY, sx: st.x, sy: st.y, u };
    grip.classList.add('drag'); try { grip.setPointerCapture(e.pointerId); } catch (er) {}
    loop();
  });
  sizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (st.locked) return;
    const u = union(); if (!u) return;
    drag = { kind: 'size', x0: e.clientX, y0: e.clientY, s0: st.s, sx: st.x, sy: st.y, u };
    sizer.classList.add('drag'); try { sizer.setPointerCapture(e.pointerId); } catch (er) {}
    loop();
  });
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (drag.kind === 'move') {
      st.x = drag.sx; st.y = drag.sy;
      const m = clampMove(dx, dy, drag.u); st.x = m.x; st.y = m.y;
    } else {
      // dragging toward the top-left grows it (the group is anchored by its bottom-right corner)
      const w = drag.u.width, h = drag.u.height;
      const t = ((-dx) * w + (-dy) * h) / (w * w + h * h);
      st.s = Math.min(1.8, Math.max(0.5, Math.round(drag.s0 * (1 + t) * 1000) / 1000));
      if (Math.abs(st.s - 1) < 0.03) st.s = 1;
    }
  };
  const end = () => {
    if (!drag) return;
    const kind = drag.kind; drag = null;
    grip.classList.remove('drag'); sizer.classList.remove('drag');
    cancelAnimationFrame(raf); save(); render();
    if (kind === 'size') { try { window.__ccPanelFuse && window.__ccPanelFuse.rebase && window.__ccPanelFuse.rebase(); } catch (e) {} }
  };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  grip.addEventListener('dblclick', (e) => { e.preventDefault(); if (st.locked) return; st.x = 0; st.y = 0; save(); render(); });
  sizer.addEventListener('dblclick', (e) => { e.preventDefault(); if (st.locked) return; st.s = 1; save(); render(); });
  ['mousedown', 'click', 'contextmenu'].forEach((t) => { grip.addEventListener(t, (e) => e.stopPropagation()); sizer.addEventListener(t, (e) => e.stopPropagation()); });

  // ---- right-click menu on the strip: same options as the panels' title-bar menu ----
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  function otherPanels() {
    const out = [];
    document.querySelectorAll('.panel-floating > .panel-titlebar[data-panel-id]').forEach((tb) => {
      const r = tb.parentElement.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { const l = tb.querySelector('.panel-titlebar-label'); out.push({ name: (l && l.textContent.trim()) || tb.dataset.panelId, h: r.height }); }
    });
    return out;
  }
  function setScale(v) { st.s = Math.min(1.8, Math.max(0.5, Math.round(v * 1000) / 1000)); save(); render(); try { window.__ccPanelFuse && window.__ccPanelFuse.rebase && window.__ccPanelFuse.rebase(); } catch (e) {} }
  function openMenu(x, y) {
    closeMenu();
    const m = document.createElement('div'); m.className = 'cc-pm';
    const add = (cls, text, fn) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; d.addEventListener('click', (e) => { e.stopPropagation(); fn(); closeMenu(); }); m.appendChild(d); };
    const head = (t) => { const d = document.createElement('div'); d.className = 'pm-h'; d.textContent = t; m.appendChild(d); };
    head('Menu + HP bar');
    add('pm-i', st.locked ? '🔓 Unlock position and size' : '🔒 Lock (no move / resize)', () => { st.locked = !st.locked; save(); render(); });
    const sep = document.createElement('div'); sep.className = 'pm-sep'; m.appendChild(sep);
    add('pm-i' + (st.s !== 1 || st.x || st.y ? '' : ' dis'), 'Reset size and position', () => { if (st.locked) return; st.x = 0; st.y = 0; st.s = 1; save(); render(); });
    head('Size');
    const chips = document.createElement('div'); chips.className = 'pm-chips';
    [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].forEach((v) => {
      const c = document.createElement('div'); c.className = 'pm-chip' + (Math.abs(st.s - v) < 0.005 ? ' on' : ''); c.textContent = Math.round(v * 100) + '%';
      c.addEventListener('click', (e) => { e.stopPropagation(); if (!st.locked) setScale(v); closeMenu(); }); chips.appendChild(c);
    });
    m.appendChild(chips);
    const u = union(), others = otherPanels();
    if (u && others.length && !st.locked) {
      head('Match height of');
      others.forEach((o) => add('pm-i', o.name + '  ·  ' + Math.round(o.h) + ' px', () => setScale(st.s * o.h / u.height)));
    }
    document.body.appendChild(m); menu = m;
    const mr = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(innerWidth - mr.width - 4, x)) + 'px';
    m.style.top = Math.max(4, Math.min(innerHeight - mr.height - 4, y)) + 'px';
  }
  grip.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); });
  const onDocDown = (e) => { if (menu && !(e.target.closest && e.target.closest('.cc-pm'))) closeMenu(); };
  const onKeyEsc = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKeyEsc, true);

  const timer = setInterval(() => { if (!drag) render(); }, 300);
  render();

  // Panel Fuse integration: the dock presents itself as a panel-like item.
  function item() {
    const u = union(); const { bar } = els();
    if (!u || !bar || !grip.isConnected || grip.style.display === 'none') return null;
    const r = { left: u.left, right: u.right, top: u.top, bottom: u.bottom, width: u.width, height: u.height };
    return { id: 'menudock', name: 'Menu', el: bar, tb: grip, r, nx: st.x, ny: st.y, widget: true };
  }
  function teardown() {
    clearInterval(timer); cancelAnimationFrame(raf); closeMenu();
    document.removeEventListener('mousedown', onDocDown, true); document.removeEventListener('keydown', onKeyEsc, true);
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', end, true);
    document.removeEventListener('pointercancel', end, true);
    grip.remove(); sizer.remove(); style.remove(); base.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc menu-dock torn down';
  }
  window[NS] = { version: 1, teardown, item, refresh: render, get state() { return Object.assign({}, st); } };
  console.log('[cc] menu-dock loaded');
  return 'cc menu-dock loaded';
})();
