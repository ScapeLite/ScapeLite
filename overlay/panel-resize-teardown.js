// Full teardown for overlay/panel-resize.js (v2) AND any leftovers of the
// old v1 wrapper-based mod. Safe to run at any time, even if nothing is
// loaded. Returns a JSON summary of what it found/removed.
// Pass-through: set window.__ccKeepScaleStorage = true before running to
// keep saved per-panel scales in localStorage.
(function () {
  const out = { v2api: false, styles: 0, handles: 0, v1wrappers: 0, v1handles: 0, v1flags: 0, storage: false, chatRelay: false };
  out.handlesBefore = document.querySelectorAll('.cc-ps-handle').length;
  out.styleBefore = !!document.getElementById('cc-panel-scale-style');
  try { out.storage =localStorage.getItem('cc-panel-scale-v2') !== null && !window.__ccKeepScaleStorage; } catch (e) {}
  try {
    if (window.__ccPanelScale && window.__ccPanelScale.teardown) {
      window.__ccPanelScale.teardown({ keepStorage: !!window.__ccKeepScaleStorage });
      out.v2api = true;
    }
  } catch (e) { out.v2err = String(e); }
  // Belt and braces in case the API object was lost/broken.
  document.querySelectorAll('#cc-panel-scale-style').forEach(s => { s.remove(); out.styles++; });
  document.querySelectorAll('.cc-ps-handle').forEach(h => { h.remove(); out.handles++; });
  delete window.__ccPanelScale;
  if (!window.__ccKeepScaleStorage) {
    try { localStorage.removeItem('cc-panel-scale-v2'); } catch (e) {}
  }
  delete window.__ccKeepScaleStorage;

  try {
    if (window.__ccChatRelay && window.__ccChatRelay.teardown) {
      window.__ccChatRelay.teardown();
      out.chatRelay = true;
    }
  } catch (e) { out.chatRelayErr = String(e); }
  delete window.__ccChatRelay;

  // v1 leftovers: unwrap children back into the panel, in order.
  try { window._ccBodyObserver && window._ccBodyObserver.disconnect(); } catch (e) {}
  document.querySelectorAll('.cc-scale-wrapper').forEach(w => {
    const p = w.parentNode; if (!p) return;
    while (w.firstChild) p.insertBefore(w.firstChild, w);
    w.remove(); out.v1wrappers++;
  });
  document.querySelectorAll('.cc-resize-handle').forEach(h => { h.remove(); out.v1handles++; });
  document.querySelectorAll('[data-cc-handle],[data-cc-scale-wired],[data-cc-size-enforced]').forEach(p => {
    if (p._ccMO) { try { p._ccMO.disconnect(); } catch (e) {} delete p._ccMO; }
    if (p._ccUserSize) { p.style.width = ''; p.style.height = ''; }
    delete p.dataset.ccHandle; delete p.dataset.ccScaleWired; delete p.dataset.ccSizeEnforced;
    delete p._ccUserSize; delete p._ccNaturalSize; out.v1flags++;
  });
  delete window._ccBodyObserver; delete window._ccPanelModLoaded;
  return JSON.stringify(out);
})();
