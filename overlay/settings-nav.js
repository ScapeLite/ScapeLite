// Settings quick-jump menu. DISPLAY/NAVIGATION ONLY: hovering a category in the
// Settings header nav (Build, Display, ..., Plugins) opens a dropdown listing
// that category's sub-categories; clicking one scrolls the Settings page there.
// Categories without sub-headings list their settings instead; "Plugins" lists
// every plugin section. Nothing in the game is changed or clicked.
(function () {
  'use strict';
  const NS = '__ccSettingsNav';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const enabled = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('settingsNavMenu') === false); } catch (e) { return true; } };

  const style = document.createElement('style');
  style.id = 'cc-settings-nav-style';
  style.textContent = `
.cc-sn-menu{position:fixed;z-index:100002;min-width:190px;max-width:300px;max-height:min(70vh,520px);overflow-y:auto;padding:5px;background:#17171f;border:1px solid rgba(255,255,255,.18);
  border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.6);color:#ddd;font:13px/1.35 system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:#464658 transparent}
.cc-sn-menu .sn-i{padding:5px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-sn-menu .sn-i:hover{background:rgba(255,255,255,.1);color:#fff}
.cc-sn-menu .sn-i.sn-set{padding-left:20px;font-size:12px;color:#9a9aa6}
.cc-sn-menu .sn-i.sn-grp{display:flex;align-items:center;justify-content:space-between;gap:14px}
.cc-sn-menu .sn-i.sn-grp::after{content:'\\203a';color:#8a8a9a;font-size:15px}
.cc-sn-menu .sn-i.sn-grp.sn-open{background:rgba(255,255,255,.1);color:#fff}
.cc-sn-menu.cc-sn-sub{z-index:100003}
.cc-sn-menu .sn-h{padding:4px 10px 2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
@keyframes ccSnFlash{0%,60%{outline:2px solid #ffd24a;outline-offset:3px;background:rgba(255,210,74,.12)}100%{outline:2px solid transparent;background:transparent}}
.cc-sn-flash{animation:ccSnFlash 1.8s ease-out}`;
  const attach = () => { if (document.head && !style.isConnected) document.head.appendChild(style); };
  attach();

  let menu = null, owner = null, hideT = 0, sub = null;
  const closeSub = () => { if (sub) { sub.remove(); sub = null; } document.querySelectorAll('.cc-sn-menu .sn-grp.sn-open').forEach((e) => e.classList.remove('sn-open')); };
  const closeMenu = () => { clearTimeout(hideT); closeSub(); if (menu) { menu.remove(); menu = null; owner = null; } };
  const later = () => { clearTimeout(hideT); hideT = setTimeout(closeMenu, 220); };

  const zoomOf = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };
  // Scroll so the target sits just under the Settings header bar (fully visible). Always takes the same
  // time (SCROLL_MS) however far the jump is, with an ease-in-out curve.
  const SCROLL_MS = 450;
  let anim = 0;
  function targetTop(el, sc) {
    const bar = document.querySelector('.settings-search-bar');
    const top = Math.max(bar ? bar.getBoundingClientRect().bottom : 0, sc.getBoundingClientRect().top);
    const z = zoomOf();
    return sc.scrollTop + (el.getBoundingClientRect().top - (top + 14 * z)) / z;
  }
  function goto(el) {
    if (!el) return;
    const sc = el.closest('#tab-settings') || document.getElementById('tab-settings');
    if (!sc) return;
    cancelAnimationFrame(anim);
    const from = sc.scrollTop, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / SCROLL_MS);
      sc.scrollTop = from + (targetTop(el, sc) - from) * ease(t); // target re-measured each frame (layout may shift)
      if (t < 1) anim = requestAnimationFrame(step);
      else sc.scrollTop = targetTop(el, sc);
    };
    anim = requestAnimationFrame(step);
    el.classList.remove('cc-sn-flash'); void el.offsetWidth; el.classList.add('cc-sn-flash');
    setTimeout(() => el.classList.remove('cc-sn-flash'), 1800);
  }
  const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');

  function itemsFor(btn) {
    const name = txt(btn);
    if (/^plugins$/i.test(name)) {
      // Bigger categories (Discord, Interface, ...) each with their sections as a flyout; standalone sections (About) sit on their own.
      const out = []; let cur = null;
      document.querySelectorAll('.cc-group-head, .settings-section[id^="settings-sec-cc-"]').forEach((n) => {
        if (n.classList.contains('cc-group-head')) { cur = { label: txt(n), el: n, children: [] }; out.push(cur); return; }
        const hd = n.querySelector('.settings-section-header') || n;
        const c = hd.cloneNode(true); c.querySelectorAll('.cc-author').forEach((x) => x.remove()); // title only, not the @author tag
        const it = { label: txt(c).slice(0, 60), el: hd };
        if (n.dataset.ccGroup && cur) cur.children.push(it); else { out.push(it); cur = null; }
      });
      return out.filter((g) => !g.children || g.children.length || !g.el.classList.contains('cc-group-head'));
    }
    const sec = document.getElementById('settings-sec-' + name.toLowerCase().replace(/\s+/g, '-'));
    if (!sec) return [];
    const subs = [...sec.querySelectorAll('.settings-subheading')].map((e) => ({ label: txt(e).slice(0, 60), el: e }));
    if (subs.length) return subs;
    return [...sec.querySelectorAll('.settings-toggle-label, .settings-row-label, .settings-label')].slice(0, 18).map((e) => ({ label: txt(e).slice(0, 60), el: e.closest('.settings-toggle-row') || e, set: true }));
  }

  function open(btn) {
    if (!enabled()) return;
    if (owner === btn && menu) { clearTimeout(hideT); return; }
    closeMenu();
    const items = itemsFor(btn).filter((i) => i.label);
    if (!items.length) return;
    const m = document.createElement('div');
    m.className = 'cc-sn-menu';
    const hd = document.createElement('div'); hd.className = 'sn-h'; hd.textContent = txt(btn); m.appendChild(hd);
    const openSub = (d, it) => {
      closeSub();
      d.classList.add('sn-open');
      const s = document.createElement('div'); s.className = 'cc-sn-menu cc-sn-sub';
      const h2 = document.createElement('div'); h2.className = 'sn-h'; h2.textContent = it.label; s.appendChild(h2);
      it.children.forEach((c) => {
        const x = document.createElement('div'); x.className = 'sn-i'; x.textContent = c.label;
        x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); goto(c.el); });
        s.appendChild(x);
      });
      s.addEventListener('mouseenter', () => clearTimeout(hideT)); s.addEventListener('mouseleave', later);
      ['mousedown', 'wheel'].forEach((t) => s.addEventListener(t, (e) => e.stopPropagation()));
      document.body.appendChild(s);
      const r = d.getBoundingClientRect(), sr = s.getBoundingClientRect();
      const right = r.right + 4 + sr.width <= innerWidth - 4;
      s.style.left = Math.max(4, right ? r.right + 4 : r.left - sr.width - 4) + 'px';
      s.style.top = Math.max(4, Math.min(innerHeight - sr.height - 4, r.top - 6)) + 'px';
      sub = s;
    };
    items.forEach((it) => {
      const d = document.createElement('div');
      const grp = it.children && it.children.length;
      d.className = 'sn-i' + (it.set ? ' sn-set' : '') + (grp ? ' sn-grp' : '');
      d.textContent = it.label;
      d.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); goto(it.el); });
      if (grp) d.addEventListener('mouseenter', () => { clearTimeout(hideT); openSub(d, it); });
      else d.addEventListener('mouseenter', closeSub);
      m.appendChild(d);
    });
    m.addEventListener('mouseenter', () => clearTimeout(hideT));
    m.addEventListener('mouseleave', later);
    ['mousedown', 'wheel'].forEach((t) => m.addEventListener(t, (e) => e.stopPropagation()));
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect(), mr = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(innerWidth - mr.width - 4, r.left)) + 'px';
    m.style.top = Math.min(innerHeight - mr.height - 4, r.bottom + 2) + 'px';
    menu = m; owner = btn;
  }

  const onOver = (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.settings-nav-btn') : null;
    if (b) open(b);
  };
  const onOut = (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.settings-nav-btn') : null;
    if (b && !(e.relatedTarget && menu && menu.contains(e.relatedTarget))) later();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target) && !(sub && sub.contains(e.target))) closeMenu(); }, true);
  const guard = setInterval(() => { attach(); if (menu && !document.querySelector('.settings-nav-btn')) closeMenu(); }, 1000);

  function teardown() {
    clearInterval(guard); closeMenu();
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseout', onOut, true);
    document.removeEventListener('keydown', onKey, true);
    style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc settings-nav torn down';
  }
  window[NS] = { version: 1, teardown, itemsFor, goto };
  console.log('[cc] settings-nav loaded');
  return 'cc settings-nav loaded';
})();
