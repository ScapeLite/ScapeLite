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

  let prefs = { hidden: [], sticky: [] };
  try { const p = JSON.parse(localStorage.getItem(LS) || 'null'); if (p) prefs = { hidden: p.hidden || [], sticky: p.sticky || [] }; } catch (e) {}
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
.cc-sb-note{padding:6px 2px 10px;font-size:13px;color:var(--text-muted)}
.cc-sb-go{display:block;margin-top:6px;padding:3px 10px;border:1px solid #3a3a48;border-radius:6px;background:#22222c;color:#ddd;font:inherit;font-size:12px;cursor:pointer}
.cc-sb-go:hover{border-color:#ffd24a;color:#ffd24a}
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

  function tick() {
    try { if (document.head && !document.getElementById('cc-sidebar-style')) document.head.appendChild(style); render(); if (enabled()) decorate(); } catch (e) {}
  }
  tick();
  const timerId = setInterval(tick, 1500);

  function teardown() {
    clearInterval(timerId);
    style.remove();
    document.querySelectorAll('.cc-sb-ctl, .cc-sb-note, .cc-sb-go').forEach((e) => e.remove());
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc sidebar-tabs torn down';
  }
  window[NS] = { version: 1, teardown, get prefs() { return JSON.parse(JSON.stringify(prefs)); }, refresh: tick };
  console.log('[cc] sidebar-tabs loaded');
  return 'cc sidebar-tabs loaded';
})();
