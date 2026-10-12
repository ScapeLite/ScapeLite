// ScapeLite: remembers which chat channel you send to and applies it once after login.
// The game always starts on Global, even when Global is hidden (greyed out). Here the last channel you picked is restored,
// and when that one is not shown (or none is saved) the leftmost shown channel is used: Global, Proximity (Raid in a raid), Friends, Clan.
// Only changes which channel the text box sends to (the [Clan] label); never sends anything. Later changes by you are never overridden.
(function () {
  'use strict';
  const NS = '__ccChatDefault';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS = 'cc-chat-last';
  const ORDER = ['global', 'proximity', 'friends', 'clan'];
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('chatDefaultEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.chat ? b : null; };
  const loggedIn = () => { const lf = document.querySelector('#login-form, .login-box, .login-hero'); return !(lf && lf.getClientRects().length); };
  let applied = false, last = null, settle = 0;

  function pick(info) {
    let saved = null;
    try { saved = localStorage.getItem(LS); } catch (e) {}
    if (saved && ORDER.indexOf(saved) >= 0 && info.filters[saved]) return saved;
    return ORDER.find((c) => info.filters[c]) || null;
  }

  function tick() {
    if (!on() || !loggedIn()) { settle = 0; return; }
    const b = bridge(), panel = document.getElementById('chat-panel');
    if (!b || !panel) return;
    const info = b.chat();
    if (!info) return;
    if (!applied) {
      if (++settle < 3) return; // let the game finish its own start-up first
      applied = true;
      const target = pick(info);
      if (target && !info.dm && target !== info.active) b.setChatChannel(target);
      last = (b.chat() || info).active;
      return;
    }
    // After the first application: remember what you choose (DM targets and Game are not channels you can pick here).
    if (info.dm) return;
    if (info.active !== last && ORDER.indexOf(info.active) >= 0) {
      last = info.active;
      try { localStorage.setItem(LS, last); } catch (e) {}
    }
  }

  const timer = setInterval(tick, 1000);
  function teardown() { clearInterval(timer); if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc chat-default torn down'; }
  window[NS] = { version: 1, teardown };
  return 'cc chat-default loaded';
})();
