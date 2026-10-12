// Scapewatch: make the game's own OS notifications fire even while the game
// window is focused. Display/notification only -- never touches game state.
//
// Why: the game's `_osNotify` (game.*.js) returns early when
// `document.hasFocus()` is true, i.e. it only raises a Windows toast while
// the player is tabbed away. `hasFocus` appears nowhere else in the game
// bundle (confirmed 2026-10-07: 2 occurrences, both inside that one check;
// and 0 calls in 8 s of live play), so while the Plugins toggle "Notify
// While Focused" is on, document.hasFocus() is made to report false, which
// is the only thing that lets the game's own per-type notification settings
// (Settings > Notifications) fire. Everything else about the game's
// notifications (which types, sound, text) stays the game's own.
(function () {
  'use strict';
  const NS = '__ccNotifyAlways';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const orig = Document.prototype.hasFocus;
  const on = () => {
    try { return !(window.__ccPluginSettings && window.__ccPluginSettings.get('osNotifyWhenFocused') === false); } catch (e) { return true; }
  };
  const patched = function () { return on() ? false : orig.call(this); };
  Object.defineProperty(document, 'hasFocus', { value: patched, configurable: true, writable: true });

  // Auto-dismiss: every Windows notification the page raises (the game's own, Route Advisor, raid alerts) is closed again
  // after a few seconds, and all of them are closed when you come back to the game, so they stop piling up in the
  // Windows notification centre. Closing happens after the toast was shown, so the Pushover forwarder still sees it.
  const OrigN = window.Notification;
  const live = new Set();
  const secs = () => { try { const v = Number(window.__ccPluginSettings && window.__ccPluginSettings.get('osNotifyDismissSec')); return Number.isFinite(v) ? v : 10; } catch (e) { return 10; } };
  const closeAll = () => { live.forEach((n) => { try { n.close(); } catch (e) {} }); live.clear(); };
  if (typeof OrigN === 'function') {
    const Patched = class extends OrigN {
      constructor(title, opts) {
        super(title, opts);
        live.add(this);
        const s = secs();
        if (s > 0) setTimeout(() => { try { this.close(); } catch (e) {} live.delete(this); }, s * 1000);
        this.addEventListener('close', () => live.delete(this));
      }
    };
    try { window.Notification = Patched; } catch (e) {}
  }
  const onBack = () => { if (!document.hidden && secs() > 0) closeAll(); };
  document.addEventListener('visibilitychange', onBack, true);
  window.addEventListener('focus', onBack, true);

  function teardown() {
    try { delete document.hasFocus; } catch (e) {}
    try { if (typeof OrigN === 'function') window.Notification = OrigN; } catch (e) {}
    document.removeEventListener('visibilitychange', onBack, true);
    window.removeEventListener('focus', onBack, true);
    closeAll();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc notify-always torn down';
  }
  window[NS] = { version: 1, teardown };
  console.log('[cc] notify-always loaded');
  return 'cc notify-always loaded';
})();
