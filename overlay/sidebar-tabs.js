// Scapewatch sidebar tab controls. DISPLAY-ONLY (never opens/clicks a tab).
// Adds two controls to every LEFT-side row of Settings > Hotkeys (the rows that
// list the left icon strip's tabs):
//   - a switch: show / hide that icon in the strip
//   - a pin: "sticky" -- the icon stays visible when the strip is MINIMIZED
//     (the arrow at the very top of the strip), so the strip becomes a small
//     "minimal" set of favourites vs. a "show all" mode.
// The game hides every strip button while `body.side-tabs-collapsed`; this only
// layers one generated stylesheet on top (no game node is moved or removed).
// Prefs live in localStorage `cc-sidebar-prefs` ({hidden:[tab], sticky:[tab]}).
// Custom tabs added by other mods (buttons carrying data-cc-tab) get a row too.
(function () {
  'use strict';
  const NS = '__ccSidebarTabs';
  const LS = 'cc-sidebar-prefs';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  let prefs = { hidden: [], sticky: [], order: [] };
  try { const p = JSON.parse(localStorage.getItem(LS) || 'null'); if (p) prefs = { hidden: p.hidden || [], sticky: p.sticky || [], order: Array.isArray(p.order) ? p.order : [] }; } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} };
  const enabled = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('sidebarTabsEnabled') === false); } catch (e) { return true; } };

  const style = document.createElement('style');
  style.id = 'cc-sidebar-style';
  const BASE = `
.cc-sb-ctl{display:inline-flex;align-items:center;gap:10px;margin-left:auto;padding-left:12px;flex:none}
.cc-sb-pin{width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;
  background:var(--bg-cell);border:1px solid var(--border-primary);color:var(--text-muted);opacity:.65}
.cc-sb-pin:hover{opacity:1;background:var(--bg-hover);color:var(--text-light)}
.cc-sb-pin.on{opacity:1;color:var(--text-gold);border-color:var(--border-secondary)}
.cc-sb-pin svg{width:13px;height:13px;fill:currentColor;display:block}
.cc-sb-ctl .settings-switch{flex:none}
.floating-tab-strip .cc-menu-btn{order:1000}
.cc-sb-note{padding:6px 2px 10px;font-size:13px;color:var(--text-muted)}
.cc-sb-go{display:block;margin-top:6px;padding:3px 10px;border:1px solid #3a3a48;border-radius:6px;background:#22222c;color:#ddd;font:inherit;font-size:12px;cursor:pointer}
.cc-sb-go:hover{border-color:var(--cc-accent,#ffd24a);color:var(--cc-accent,#ffd24a)}
@keyframes ccSbFlash{0%,60%{outline:2px solid #ffd24a;outline-offset:3px;background:rgba(255,210,74,.12)}100%{outline:2px solid transparent;background:transparent}}
.cc-sb-flash{animation:ccSbFlash 1.8s ease-out}
`;
  function render() {
    let css = BASE;
    if (enabled()) {
      for (const t of prefs.sticky) css += `body.side-tabs-collapsed .floating-tab-strip .floating-tab-btn[data-tab="${CSS.escape(t)}"]{display:flex !important}\n`;
      for (const t of prefs.hidden) css += `.floating-tab-strip .floating-tab-btn[data-tab="${CSS.escape(t)}"]{display:none !important}\n`;
    }
    if (style.textContent !== css) style.textContent = css;
  }

  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2v2h1v6l-3 3v2h4.5v5h1v-5H17v-2l-3-3V4h1V2z"></path></svg>';
  function toggle(list, tab, on) {
    const i = list.indexOf(tab);
    if (on && i < 0) list.push(tab); else if (!on && i >= 0) list.splice(i, 1);
    save(); render();
  }
  // "Go to Hotkeys" shortcut next to the Plugins toggle: scrolls the Settings page to Hotkeys > Left Panels.
  function gotoHotkeys() {
    const sec = document.getElementById('settings-sec-hotkeys');
    if (!sec) return;
    const sub = [...sec.querySelectorAll('.settings-subheading')].find((x) => /left panels/i.test(x.textContent)) || sec.querySelector('.settings-section-header') || sec;
    const nav = window.__ccSettingsNav;
    if (nav && nav.goto) { nav.goto(sub); return; }
    sub.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sub.classList.remove('cc-sb-flash'); void sub.offsetWidth; sub.classList.add('cc-sb-flash');
    setTimeout(() => sub.classList.remove('cc-sb-flash'), 1800);
  }
  function addGoButton() {
    const sec = document.getElementById('settings-sec-cc-sidebar');
    if (!sec || sec.querySelector('.cc-sb-go')) return;
    const row = [...sec.querySelectorAll('.settings-toggle-row')].find((r) => /Side Menu Tab Controls/i.test(r.textContent));
    const host = row && row.querySelector('.settings-toggle-text');
    if (!host) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cc-sb-go'; b.textContent = 'Go to Hotkeys › Left Panels';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); gotoHotkeys(); });
    host.appendChild(b);
  }
  function decorate() {
    addGoButton();
    const sec = document.getElementById('settings-sec-hotkeys');
    if (!sec) return;
    if (!sec.querySelector('.cc-sb-note')) {
      const hdr = sec.querySelector('.settings-section-header');
      const note = document.createElement('div');
      note.className = 'cc-sb-note';
      note.textContent = 'Side menu: use the switch to show / hide an icon, and the pin to keep it visible when the menu is minimized (arrow at the top).';
      if (hdr) hdr.insertAdjacentElement('afterend', note);
    }
    sec.querySelectorAll('.settings-hotkey-row[data-tab-side="left"]').forEach((row) => {
      const tab = row.dataset.tab;
      if (!tab || tab === 'undefined') return;
      let ctl = row.querySelector('.cc-sb-ctl');
      if (!ctl) {
        ctl = document.createElement('span');
        ctl.className = 'cc-sb-ctl';
        const pin = document.createElement('div');
        pin.className = 'cc-sb-pin';
        pin.innerHTML = PIN;
        pin.title = 'Sticky: stays visible when the side menu is minimized';
        pin.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const on = !pin.classList.contains('on'); pin.classList.toggle('on', on); toggle(prefs.sticky, tab, on); });
        const sw = document.createElement('div');
        sw.className = 'settings-switch';
        sw.title = 'Show this icon in the side menu';
        sw.innerHTML = '<div class="settings-switch-knob"></div>';
        sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const on = !sw.classList.contains('on'); sw.classList.toggle('on', on); toggle(prefs.hidden, tab, !on); });
        ctl.appendChild(pin); ctl.appendChild(sw);
        row.appendChild(ctl);
      }
      ctl.querySelector('.cc-sb-pin').classList.toggle('on', prefs.sticky.includes(tab));
      ctl.querySelector('.settings-switch').classList.toggle('on', !prefs.hidden.includes(tab));
    });
  }

  // Right-click an icon in the strip: pin it (it stays visible when the strip is minimised) or unpin it. Same list the Settings switches use.
  let ctx = null;
  const closeCtx = () => { if (ctx) { try { window.__ccUI.closeMenu(); } catch (e) { /* kit gone */ } ctx = null; } };
  const onCtx = (e) => {
    if (!enabled()) return;
    const b = e.target && e.target.closest ? e.target.closest('.floating-tab-strip .floating-tab-btn[data-tab]') : null;
    if (!b || b.classList.contains('cc-goal-btn')) return;
    e.preventDefault(); e.stopPropagation(); closeCtx();
    const tab = b.dataset.tab, pinned = prefs.sticky.includes(tab);
    const nm = b.classList.contains('cc-menu-btn') ? 'ScapeLite' : ((b.querySelector('.floating-tab-tooltip') || {}).dataset ? (b.querySelector('.floating-tab-tooltip').dataset.name || tab) : tab);
    const UI = window.__ccUI; if (!UI || !UI.menu) return;   // the shared menu (the old per-plugin menu style is gone)
    const items = [{ head: nm }, { label: pinned ? 'Unpin (hide when the strip is minimised)' : 'Pin (keep visible when the strip is minimised)', onClick: () => { toggle(prefs.sticky, tab, !pinned); } }];
    if (prefs.order.length) items.push({ label: 'Reset the icon order (ScapeLite logo back at the bottom)', onClick: () => { resetOrder(); } });
    ctx = UI.menu(items, e.clientX, e.clientY);
  };
  document.addEventListener('contextmenu', onCtx, true);
  // ---- rearrange: drag any icon of the strip to a new place. Only CSS `order` is changed (no game node is moved or removed), the list is remembered
  // (prefs.order, keyed by the icon's data-tab; the game's dashboard button is 'dashboard' and ScapeLite's own logo is 'cc-menu') and a line shows where it lands.
  const rOn = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('sidebarReorderEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const keyOf = (b) => (b.dataset && (b.dataset.tab || b.dataset.ccTab)) || (b.classList.contains('dashboard-launcher') ? 'dashboard' : '');
  const stripEl = () => window.__ccDom.q('.floating-tab-strip');
  const allBtns = () => { const s = stripEl(); return s ? Array.from(s.children).filter((c) => c.classList && c.classList.contains('floating-tab-btn') && keyOf(c)) : []; };
  const isShown = (b) => b.getClientRects().length > 0;
  // saved order first (only icons that exist), then icons the list does not know yet, each placed after the icon that precedes it in the page
  // (the logo defaults to the very end, below the dashboard button)
  function effectiveOrder() {
    const btns = allBtns(), keys = btns.map(keyOf), have = new Set(keys), out = prefs.order.filter((k) => have.has(k)).filter((k, i, a) => a.indexOf(k) === i), seen = new Set(out);
    const base = keys.filter((k) => k !== 'cc-menu' && k !== 'dashboard').concat(['dashboard', 'cc-menu']).filter((k) => have.has(k));
    base.forEach((k, i) => { if (seen.has(k)) return; let at = -1; for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(base[j]); if (p >= 0) { at = p; break; } } out.splice(at + 1, 0, k); seen.add(k); });
    return out;
  }
  let orderSig = '';
  function applyOrder() {
    const btns = allBtns(); if (!btns.length) return;
    if (!enabled() || !rOn() || !prefs.order.length) { if (orderSig !== 'off') { btns.forEach((b) => { if (b.style.order) b.style.removeProperty('order'); }); orderSig = 'off'; } return; }
    const eff = effectiveOrder(), sig = eff.join(',') + '|' + btns.length;
    const want = new Map(eff.map((k, i) => [k, String((i + 1) * 10)]));
    let changed = false; btns.forEach((b) => { const v = want.get(keyOf(b)); if (v && b.style.order !== v) { b.style.order = v; changed = true; } });
    orderSig = sig; return changed;
  }
  let rd = null, justDragged = 0;
  const rIns = document.createElement('div'); rIns.className = 'cc-sb-ins'; rIns.hidden = true;
  const rStyle = document.createElement('style'); rStyle.id = 'cc-sb-reorder-style';
  rStyle.textContent = `.cc-sb-ins{position:fixed;z-index:2147482620;pointer-events:none;border-radius:2px;background:var(--cc-accent,#ffd24a);box-shadow:0 0 8px color-mix(in srgb,var(--cc-accent,#ffd24a) 75%,transparent)}
.cc-sb-ins::before,.cc-sb-ins::after{content:"";position:absolute;width:7px;height:7px;border-radius:50%;background:var(--cc-accent,#ffd24a)}
.cc-sb-ins[data-ax=y]{height:3px}.cc-sb-ins[data-ax=y]::before{left:-3px;top:-2px}.cc-sb-ins[data-ax=y]::after{right:-3px;top:-2px}
.cc-sb-ins[data-ax=x]{width:3px}.cc-sb-ins[data-ax=x]::before{top:-3px;left:-2px}.cc-sb-ins[data-ax=x]::after{bottom:-3px;left:-2px}
.cc-sb-ghost{position:fixed;z-index:2147482621;pointer-events:none;left:0;top:0;opacity:.85;transform-origin:0 0;box-shadow:0 10px 24px rgba(0,0,0,.6);border-radius:8px}
.cc-sb-dragsrc{opacity:.3 !important}
body.cc-sb-dragging,body.cc-sb-dragging *{cursor:grabbing !important;user-select:none !important}
body.cc-sb-dragging .floating-tab-btn .floating-tab-tooltip,body.cc-sb-dragging #cc-sbgmenu{display:none !important}`;
  const rAxis = () => { const s = stripEl(); return s && /^row/.test(getComputedStyle(s).flexDirection) ? 'x' : 'y'; };
  function rPlace() {   // where would the dragged icon land: between the shown icons, by the pointer along the strip
    const ax = rAxis(), vis = rd.shown;
    let idx = vis.length;
    for (let i = 0; i < vis.length; i++) { const r = rd.rects[i], mid = ax === 'y' ? r.top + r.height / 2 : r.left + r.width / 2, p = ax === 'y' ? rd.y : rd.x; if (p < mid) { idx = i; break; } }
    rd.idx = idx;
    const first = rd.rects[0], last = rd.rects[vis.length - 1], ref = idx < vis.length ? rd.rects[idx] : last;
    const srcI = rd.shown.indexOf(rd.src), same = idx === srcI || idx === srcI + 1;
    rIns.hidden = same;
    rIns.dataset.ax = ax;
    if (ax === 'y') { const y = idx < vis.length ? ref.top - 3 : last.bottom + 1; rIns.style.left = Math.round(first.left - 2) + 'px'; rIns.style.width = Math.round(first.width + 4) + 'px'; rIns.style.top = Math.round(y) + 'px'; rIns.style.height = '3px'; }
    else { const x = idx < vis.length ? ref.left - 3 : last.right + 1; rIns.style.top = Math.round(first.top - 2) + 'px'; rIns.style.height = Math.round(first.height + 4) + 'px'; rIns.style.left = Math.round(x) + 'px'; rIns.style.width = '3px'; }
  }
  function rFrame() {
    if (!rd || !rd.on) return; rd.raf = 0;
    rd.ghost.style.transform = 'translate(' + Math.round(rd.x - rd.gx) + 'px,' + Math.round(rd.y - rd.gy) + 'px)'; rPlace();
  }
  function rStop(commit) {
    if (!rd) return; const d = rd; rd = null;
    document.removeEventListener('mousemove', rMove, true); document.removeEventListener('mouseup', rUp, true); document.removeEventListener('keydown', rKey, true); window.removeEventListener('blur', rBlur);
    cancelAnimationFrame(d.raf); document.body.classList.remove('cc-sb-dragging'); rIns.hidden = true; if (d.ghost) d.ghost.remove(); d.src.classList.remove('cc-sb-dragsrc');
    if (!d.on) return;
    justDragged = performance.now();   // the mouse-up of a drag must not also press the button
    if (!commit) return;
    // move the dragged icon before the shown icon at idx (or after the last shown one) in the FULL list, hidden and grouped icons keep their places
    const eff = effectiveOrder(), k = keyOf(d.src), without = eff.filter((x) => x !== k);
    let at; if (d.idx < d.shown.length) { const ref = keyOf(d.shown[d.idx] === d.src ? d.shown[d.idx + 1] || d.shown[d.idx] : d.shown[d.idx]); at = without.indexOf(ref); if (at < 0) at = without.length; }
    else { const lastShown = keyOf(d.shown.filter((b) => b !== d.src).pop() || d.src); at = without.indexOf(lastShown) + 1; if (at <= 0) at = without.length; }
    without.splice(at, 0, k);
    if (without.join(',') !== eff.join(',')) { prefs.order = without; save(); applyOrder(); }
  }
  const rMove = (e) => {
    if (!rd) return; rd.x = e.clientX; rd.y = e.clientY;
    if (!rd.on) {
      if (Math.hypot(e.clientX - rd.x0, e.clientY - rd.y0) < 7) return;
      rd.on = true; document.body.classList.add('cc-sb-dragging'); closeCtx(); try { closeG(); } catch (er) { /* groups not ready */ }
      // measured once: the icons do not move while you drag (the dragged one stays where it is, dimmed)
      rd.shown = allBtns().filter((b) => isShown(b)).sort((a, b) => (+getComputedStyle(a).order || 0) - (+getComputedStyle(b).order || 0) || (a.compareDocumentPosition(b) & 4 ? -1 : 1));
      rd.rects = rd.shown.map((b) => b.getBoundingClientRect());
      const sr = rd.src.getBoundingClientRect(); rd.gx = rd.x0 - sr.left; rd.gy = rd.y0 - sr.top;
      const g = rd.src.cloneNode(true); g.removeAttribute('id'); g.querySelectorAll('.floating-tab-tooltip,.tooltip').forEach((t) => t.remove()); g.className = (g.className + ' cc-sb-ghost').replace(/\bcc-sbg-lead\b|\bactive\b/g, '');
      g.style.width = sr.width + 'px'; g.style.height = sr.height + 'px'; g.style.order = '0'; g.style.position = 'fixed'; document.body.appendChild(g); rd.ghost = g;
      rd.src.classList.add('cc-sb-dragsrc'); if (!rIns.isConnected) document.body.appendChild(rIns);
    }
    if (!rd.raf) rd.raf = requestAnimationFrame(rFrame);
  };
  const rUp = () => rStop(true);
  const rKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); rStop(false); } };
  const rBlur = () => rStop(false);
  const rDown = (e) => {
    if (e.button !== 0 || !enabled() || !rOn() || rd) return;
    const b = e.target && e.target.closest ? e.target.closest('.floating-tab-strip > .floating-tab-btn') : null;
    if (!b || !keyOf(b) || b.classList.contains('cc-goal-btn')) return;
    rd = { src: b, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, raf: 0, shown: [], rects: [], idx: 0 };
    document.addEventListener('mousemove', rMove, true); document.addEventListener('mouseup', rUp, true); document.addEventListener('keydown', rKey, true); window.addEventListener('blur', rBlur);
  };
  // a drag ends with a mouse-up on the icon: swallow the click that follows so the game's button is not pressed by it
  const rClick = (e) => { if (justDragged && performance.now() - justDragged < 400) { e.stopPropagation(); e.preventDefault(); justDragged = 0; } };
  const rDrag = (e) => { if (e.target && e.target.closest && e.target.closest('.floating-tab-strip')) e.preventDefault(); };   // no native image drag of the icons
  document.addEventListener('mousedown', rDown, true); document.addEventListener('click', rClick, true); document.addEventListener('dragstart', rDrag, true);
  document.head.appendChild(rStyle);
  const resetOrder = () => { prefs.order = []; save(); applyOrder(); };

  // ---- groups: related icons share one button. Click the group's icon to open its first menu as usual; hover it for the others.
  const GROUPS = [
    { label: 'Crafting', tabs: ['smith', 'craft', 'imbue', 'brew'] },
    { label: 'Progress', tabs: ['unlocks', 'collections', 'diary'] },
    { label: 'Raids and trees', tabs: ['raid', 'delvetree', 'fortifytree'] },
    { label: 'Social', tabs: ['friends', 'clan', 'hiscores'] },
    { label: 'Skills', tabs: ['skills', 'skillcustom'] },
    { label: 'Combat', tabs: ['mobs', 'pvp'] },
  ];
  const gOn = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('sidebarGroupsEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const gStyle = document.createElement('style'); gStyle.id = 'cc-sbgroup-style';
  const btnOf = (t) => window.__ccDom.q('.floating-tab-strip .floating-tab-btn[data-tab="' + CSS.escape(t) + '"]:not(.cc-menu-btn)');
  let gMenu = null, gHide = 0, gBtn = null, lastGSig = '';
  const closeG = () => { clearTimeout(gHide); if (gMenu) { gMenu.remove(); gMenu = null; } gBtn = null; };
  function groupsRender() {
    // one query for the whole strip per tick (instead of one per icon), and nothing at all when the strip has not changed
    const strip = window.__ccDom.q('.floating-tab-strip');
    const btns = {}; if (strip) strip.querySelectorAll('.floating-tab-btn[data-tab]').forEach((b) => { if (!b.classList.contains('cc-menu-btn')) btns[b.dataset.tab] = b; });
    const sig = Object.keys(btns).map((k) => k + (btns[k].classList.contains('active') ? '*' : '')).join(',') + '|' + prefs.sticky.join(',') + '|' + (enabled() && gOn());
    if (sig === lastGSig) return;
    lastGSig = sig;
    let css = '';
    const active = [];
    if (enabled() && gOn()) {
      GROUPS.forEach((g, gi) => {
        const present = g.tabs.filter((t) => btns[t]); if (present.length < 2) return;
        const lead = present[0], members = present.slice(1);
        const lb = btns[lead]; lb.classList.add('cc-sbg-lead'); lb.dataset.ccGroup = String(gi);
        members.forEach((m) => { css += 'body .floating-tab-strip .floating-tab-btn[data-tab="' + CSS.escape(m) + '"]{display:none !important}\n'; });
        // collapsed strip: the group shows when the lead or any of its members is pinned
        if (members.concat([lead]).some((t) => prefs.sticky.includes(t))) css += 'body.side-tabs-collapsed .floating-tab-strip .floating-tab-btn[data-tab="' + CSS.escape(lead) + '"]{display:flex !important}\n';
        // the group lights up when any of its menus is open
        const anyActive = present.some((t) => btns[t].classList.contains('active'));
        lb.classList.toggle('cc-sbg-on', anyActive);
        active.push(lb);
      });
    }
    document.querySelectorAll('.cc-sbg-lead').forEach((b) => { if (!active.includes(b)) { b.classList.remove('cc-sbg-lead', 'cc-sbg-on'); delete b.dataset.ccGroup; } });
    css += `.floating-tab-btn.cc-sbg-lead::after{content:'';position:absolute;right:2px;bottom:2px;border:4px solid transparent;border-right-color:rgba(255,255,255,.55);border-bottom-color:rgba(255,255,255,.55);pointer-events:none}
.floating-tab-btn.cc-sbg-lead .floating-tab-tooltip{display:none !important}   /* the group list replaces the game's single-name tooltip */
.floating-tab-btn.cc-sbg-on{box-shadow:0 0 0 2px rgba(255,210,74,.55) inset}
#cc-sbgmenu{position:fixed;z-index:1950;min-width:190px;padding:5px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.6);color:#ddd;font:13px/1.35 system-ui,sans-serif}
#cc-sbgmenu::before{content:'';position:absolute;left:-14px;top:0;bottom:0;width:14px}
#cc-sbgmenu .h{padding:3px 9px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
#cc-sbgmenu .i{display:flex;align-items:center;gap:9px;padding:5px 9px;border-radius:6px;cursor:pointer}
#cc-sbgmenu .i:hover{background:rgba(255,255,255,.1)}
#cc-sbgmenu .i.on{color:var(--cc-accent,#ffd24a)}
#cc-sbgmenu .i img{width:22px;height:22px;image-rendering:pixelated}
#cc-sbgmenu .i kbd{margin-left:auto;color:#8a8a9a;font:11px system-ui}`;
    if (gStyle.textContent !== css) gStyle.textContent = css;
    if (!gStyle.isConnected && document.head) document.head.appendChild(gStyle);
  }
  function openG(lb) {
    const g = GROUPS[+lb.dataset.ccGroup]; if (!g) return;
    clearTimeout(gHide);
    if (gMenu && gBtn === lb) return;
    closeG(); gBtn = lb;
    const m = document.createElement('div'); m.id = 'cc-sbgmenu';
    const h = document.createElement('div'); h.className = 'h'; h.textContent = g.label; m.appendChild(h);
    g.tabs.forEach((t) => {
      const b = btnOf(t); if (!b) return;
      const nm = ((b.querySelector('.floating-tab-tooltip') || {}).dataset || {}).name || t;
      const hk = (b.querySelector('.floating-tab-hotkey') || {}).textContent || '';
      const row = document.createElement('div'); row.className = 'i' + (b.classList.contains('active') ? ' on' : '');
      const ic = b.querySelector('img'); if (ic) { const im = document.createElement('img'); im.src = ic.getAttribute('src'); row.appendChild(im); }
      row.appendChild(document.createTextNode(nm));
      if (hk) { const k = document.createElement('kbd'); k.textContent = hk; row.appendChild(k); }
      row.addEventListener('click', (e) => { e.stopPropagation(); closeG(); b.click(); });   // the real button does the opening
      m.appendChild(row);
    });
    document.body.appendChild(m); gMenu = m;
    const r = lb.getBoundingClientRect(), mr = m.getBoundingClientRect();
    m.style.left = (r.right + 8) + 'px'; m.style.top = Math.max(4, Math.min((window.__ccVH ? window.__ccVH() : window.innerHeight) - mr.height - 4, r.top + r.height / 2 - 16)) + 'px';
  }
  const gOver = (e) => {
    const lb = e.target.closest && e.target.closest('.floating-tab-btn.cc-sbg-lead');
    if (lb) { openG(lb); return; }
    if (gMenu && !(e.target.closest && e.target.closest('#cc-sbgmenu'))) { clearTimeout(gHide); gHide = setTimeout(closeG, 40); }
  };
  const gDown = (e) => { if (gMenu && !(e.target.closest && e.target.closest('#cc-sbgmenu'))) closeG(); };
  document.addEventListener('mouseover', gOver, true);
  document.addEventListener('mousedown', gDown, true);

  function tick() {
    try { groupsRender(); } catch (e) {}
    try { if (!rd) applyOrder(); } catch (e) {}
    try { if (document.head && !document.getElementById('cc-sidebar-style')) document.head.appendChild(style); render(); if (enabled()) decorate(); } catch (e) {}
  }
  tick();
  const timerId = setInterval(tick, 1500);

  function teardown() {
    clearInterval(timerId); closeCtx(); closeG(); rStop(false); document.removeEventListener('mousedown', rDown, true); document.removeEventListener('click', rClick, true); document.removeEventListener('dragstart', rDrag, true); rStyle.remove(); rIns.remove(); allBtns().forEach((b) => b.style.removeProperty('order')); gStyle.remove(); document.removeEventListener('mouseover', gOver, true); document.removeEventListener('mousedown', gDown, true);
    document.querySelectorAll('.cc-sbg-lead').forEach((b) => { b.classList.remove('cc-sbg-lead', 'cc-sbg-on'); delete b.dataset.ccGroup; });
    document.removeEventListener('contextmenu', onCtx, true);
    style.remove();
    document.querySelectorAll('.cc-sb-ctl, .cc-sb-note, .cc-sb-go').forEach((e) => e.remove());
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc sidebar-tabs torn down';
  }
  window[NS] = { version: 1, teardown, get prefs() { return JSON.parse(JSON.stringify(prefs)); }, refresh: tick, resetOrder };
  console.log('[cc] sidebar-tabs loaded');
  return 'cc sidebar-tabs loaded';
})();
