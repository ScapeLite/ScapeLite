// ScapeLite menu. Display only: adds one ScapeLite button (the logo) to the game's left icon strip. Hover it and a small menu lists
// ScapeLite's own panels (Route Advisor, Goal Planner, XP Tracker ...); click an entry to show or hide that panel, so a panel you
// closed or minimized is always one hover away. It only toggles ScapeLite panels and never touches the game's windows.
// Panels are found by their plugin namespace: a panel that is switched off in Plugins simply does not appear in the list.
(function () {
  'use strict';
  const NS = '__ccScapeliteMenu';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const life = window.__ccLife.scope('scapelite-menu');   // listeners and timers go through it: a re-inject cannot leave a second copy
  const LOGO = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22 width=%22128%22 height=%22128%22%3E%3Crect x=%223%22 y=%223%22 width=%22122%22 height=%22122%22 rx=%2228%22 fill=%22%2323232f%22/%3E%3Crect x=%2246%22 y=%2222%22 width=%2248%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2234%22 y=%2234%22 width=%2224%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2234%22 y=%2246%22 width=%2224%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2246%22 y=%2258%22 width=%2236%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2270%22 y=%2270%22 width=%2224%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2270%22 y=%2282%22 width=%2224%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2234%22 y=%2294%22 width=%2248%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2282%22 y=%2222%22 width=%2212%22 height=%2212%22 fill=%22%23fff0b0%22/%3E%3C/svg%3E";
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('scapeliteMenuEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  // label, plugin namespace, one-line hint. A panel needs `toggle()` (and optionally `isOpen`) on its namespace object.
  const ENTRIES = [
    ['🧭 Route Advisor', '__ccRouteAdvisor', 'Faster task order and teleports'],
    ['🎯 Goals', '__ccGoals', 'Skill targets and item hunts with ETAs'],
    ['📍 Locations and Free Pips', '__ccDiaryCredits', 'Good and bad locations by walking distance, where to put the free diary pips'],
    ['🧠 Advisor', '__ccAdvisor', 'What to do next, how and where'],
    ['📈 XP Tracker', '__ccXpTracker', 'XP per hour, graph and all skills'],
    ['🍀 Drop Luck', '__ccDropLuck', 'How lucky your rare drops have been'],
    ['🌳 Tree Advisor', '__ccTreeAdvisor', 'Best Delve and Fortress tree builds'],
    ['📊 Info Bars', '__ccBar', 'Top and bottom bars: task, XP per hour, gold ... (right-click a bar to set it up)'],
    ['💬 Chat', '__ccChat', 'A roomier chat window with tabs, search and settings'],
    ['🧩 Edit Layout', '__ccUILayout', 'Move, snap, fade and lock panels; save layouts'],
  ];

  const style = document.createElement('style');
  style.id = 'cc-slmenu-style';
  style.textContent = `
body.cc-slmenu-on .floating-tab-btn.cc-goal-btn{display:none !important}
#cc-slmenu{display:none;max-width:460px}
#cc-slmenu.show{display:block}
#cc-slmenu::before{content:'';position:absolute;left:-16px;top:0;bottom:0;width:16px}
/* same look as the sidebar group flyout (sidebar-tabs.js #cc-sbgmenu): dark card, small caps title, one plain row per entry, open ones in the accent colour; the hint is the row's tooltip */
#cc-slmenu{min-width:190px;padding:5px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.6);color:#ddd;font:13px/1.35 system-ui,sans-serif}
#cc-slmenu .cc-mh{display:block;padding:3px 9px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
#cc-slmenu .cc-mi{display:flex;align-items:center;gap:9px;min-height:0;padding:5px 9px;border-radius:6px;cursor:pointer;color:#ddd;font:inherit}
#cc-slmenu .cc-mi:hover{background:rgba(255,255,255,.1)}
#cc-slmenu .cc-mi[aria-checked=true]{color:var(--cc-accent,#ffd24a)}
#cc-slmenu .ck,#cc-slmenu .hint{display:none}
body.cc-slmenu-on .floating-tab-btn.cc-menu-btn::after{content:'';position:absolute;right:2px;bottom:2px;border:4px solid transparent;border-right-color:rgba(255,255,255,.55);border-bottom-color:rgba(255,255,255,.55);pointer-events:none}
`;
  document.head.appendChild(style);
  const menu = document.createElement('div');
  menu.id = 'cc-slmenu'; menu.className = 'cc-menu';
  document.body.appendChild(menu);
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => menu.addEventListener(t, (e) => e.stopPropagation()));

  let hideT = 0, btn = null;
  function fill() {
    const found = ENTRIES.filter((e) => window[e[1]] && typeof window[e[1]].toggle === 'function');
    menu.textContent = '';
    menu.appendChild(Object.assign(document.createElement('div'), { className: 'cc-mh', textContent: 'ScapeLite' }));
    if (!found.length) { const n = document.createElement('div'); n.className = 'cc-mh'; n.textContent = 'No panels are switched on.'; menu.appendChild(n); return; }
    found.forEach((e) => {
      const row = document.createElement('div');
      let open = false; try { open = !!window[e[1]].isOpen; } catch (er) {}
      row.className = 'cc-mi'; row.setAttribute('role', 'menuitem'); if (open) row.setAttribute('aria-checked', 'true');
      row.innerHTML = '<span class="ck"></span><span></span><span class="hint"></span>';
      row.children[1].textContent = e[0]; row.children[2].textContent = e[2]; row.title = e[2];
      row.addEventListener('click', (ev) => { ev.stopPropagation(); try { window[e[1]].toggle(); } catch (er) {} setTimeout(fill, 120); });
      menu.appendChild(row);
    });
  }
  function show() { clearTimeout(hideT); if (!btn) return; fill(); const r = btn.getBoundingClientRect(); menu.style.left = (r.right + 6) + 'px'; menu.style.top = '0px'; menu.classList.add('show'); const h = menu.getBoundingClientRect().height; menu.style.top = Math.max(4, Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - h - 4, r.top + r.height / 2 - 14 * (window.__ccScale || 1))) + 'px'; }
  function hide() { clearTimeout(hideT); hideT = setTimeout(() => menu.classList.remove('show'), 60); }
  // The moment the pointer is anywhere but the button or the menu, the menu goes away (no lingering tooltip).
  life.on(document, 'mousemove', (e) => {
    if (!menu.classList.contains('show')) return;
    const t = e.target;
    if (t && t.closest && (t.closest('#cc-slmenu') || t.closest('.cc-menu-btn'))) { clearTimeout(hideT); return; }
    clearTimeout(hideT); menu.classList.remove('show');
  }, true);
  life.on(document, 'mousedown', (e) => { if (menu.classList.contains('show') && !(e.target.closest && (e.target.closest('#cc-slmenu') || e.target.closest('.cc-menu-btn')))) menu.classList.remove('show'); }, true);
  menu.addEventListener('mouseenter', () => clearTimeout(hideT));
  menu.addEventListener('mouseleave', hide);

  function ensureButton() {
    const strip = window.__ccDom.q('.floating-tab-strip');
    let b = window.__ccDom.q('.floating-tab-btn.cc-menu-btn');
    document.body.classList.toggle('cc-slmenu-on', on() && !!strip); // the menu replaces the Goal Planner's own strip button
    if (!on() || !strip) { if (b) b.remove(); btn = null; menu.classList.remove('show'); return; }
    if (b && b.parentElement === strip) { btn = b; return; }
    if (b) b.remove();
    const tpl = [...strip.querySelectorAll('.floating-tab-btn')].find((x) => x.querySelector('img') && !x.classList.contains('cc-goal-btn'));
    if (!tpl) return;
    b = tpl.cloneNode(true);
    b.className = 'floating-tab-btn cc-menu-btn';   // a clean class list: the copy must not keep the Bank button's new-item sparkle or other state
    b.setAttribute('data-tab', 'cc-menu');
    const img = b.querySelector('img'); img.src = LOGO; img.alt = 'ScapeLite';
    b.querySelectorAll('.floating-tab-tooltip, .floating-tab-hotkey').forEach((x) => x.remove()); // the menu is the tooltip
    b.removeAttribute('data-tutorial');
    b.addEventListener('mouseenter', show); b.addEventListener('mouseleave', hide);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (menu.classList.contains('show')) menu.classList.remove('show'); else show(); });
    strip.appendChild(b); btn = b;
  }
  let timer = 0;
  function tick() { try { ensureButton(); } catch (e) {} timer = setTimeout(tick, 1500); }
  tick();
  function teardown() {
    life.dispose(); clearTimeout(timer); clearTimeout(hideT);
    menu.remove(); style.remove(); document.body.classList.remove('cc-slmenu-on');
    document.querySelectorAll('.cc-menu-btn').forEach((e) => e.remove());
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc scapelite-menu torn down';
  }
  window[NS] = { version: 1, teardown, show, hide };
  return 'cc scapelite-menu loaded';
})();
