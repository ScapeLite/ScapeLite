// ScapeLite DOM scope (window.__ccDom). Core plugin, loaded before the plugins that poll the page.
//
// Why: the game keeps its crafting / smithing / imbuing windows (about 134 000 hidden elements) inside #ui-container > .modal-overlay. Every page-wide
// document.querySelector for something that is NOT in those windows has to walk past all of them when it misses (1.3 to 2.5 ms per miss, measured), and the
// plugins poll such lookups many times a second.
//
// What: the same lookups, restricted to the visible game UI (everything under <body> except the modal overlay). Same selector syntax, same document order.
//
//     __ccDom.q('.ingame-hud-state')            first match or null          (like document.querySelector)
//     __ccDom.qa('.skill-cell[data-skill-id]')   array of all matches        (like document.querySelectorAll, but a real array)
//     __ccDom.roots()                           the subtrees searched
//     __ccDom.modalTab()                        the open tab of the crafting-style window, or null
//
// Use document.* instead when the target can live inside the modal windows (crafting tabs, the bank window ...). Display only.
(function () {
  'use strict';
  const NS = '__ccDom';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }

  const SKIP = 'modal-overlay';   // class of the heavy hidden window container
  let list = [], listAt = -1e9;   // (not 0: in the first second of a page's life performance.now() is under 1000 and the empty first list would be served)

  // The subtrees to search: body's children, with the game's wrapper elements (#game-container, #ui-container) replaced by their children, minus the modal overlay.
  // Rebuilt once a second or as soon as one of them went away.
  const WRAP = { 'game-container': 1, 'ui-container': 1 };
  function collect(parent, out) {
    for (const c of parent.children) { if (c.classList.contains(SKIP)) continue; if (WRAP[c.id]) collect(c, out); else out.push(c); }
    return out;
  }
  function roots() {
    const now = performance.now();
    if (now - listAt < 1000 && list.every((e) => e.isConnected)) return list;
    list = collect(document.body, []); listAt = now; return list;
  }
  function q(sel) {
    for (const r of roots()) { if (r.matches(sel)) return r; const f = r.querySelector(sel); if (f) return f; }
    return null;
  }
  function qa(sel) {
    const out = [];
    for (const r of roots()) { if (r.matches(sel)) out.push(r); r.querySelectorAll(sel).forEach((e) => out.push(e)); }
    return out;
  }
  // The open tab of the game's crafting-style window (a direct child of .modal-body with class active), found without scanning its 134 000 elements.
  let mbody = null;
  function modalTab() {
    if (!mbody || !mbody.isConnected) { const o = document.getElementById('ui-container'); const ov = o && o.querySelector(':scope > .modal-overlay'); mbody = ov ? ov.querySelector('.modal-body') : null; }
    if (!mbody) return null;
    for (const c of mbody.children) if (c.classList.contains('tab-content') && c.classList.contains('active')) return c;
    return null;
  }
  function teardown() { list = []; mbody = null; if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc dom-scope torn down'; }
  window[NS] = { version: 1, q, qa, roots, modalTab, teardown };
  return 'cc dom-scope loaded';
})();
