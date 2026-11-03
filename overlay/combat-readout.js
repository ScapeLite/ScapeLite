// ScapeLite Combat Readout: exact numbers drawn ON the combat scene's own bars. Display only.
// HP and Spirit as "57 / 80" on their bars, the attack timer counting down on its bar, and under your bars the unrounded attack
// interval, attacks per second and expected DPS (the game's own formula, for the loadout the fight really uses).
// It asks the Game Data Bridge to add text after the scene paints each bar; nothing in the game is changed or clicked.
(function () {
  'use strict';
  const NS = '__ccCombatReadout';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('combatReadoutEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };

  const KEYS = ['meHp', 'meSpirit', 'meTimer', 'meDps', 'enemyHp', 'enemySpirit', 'enemyTimer', 'allyHp', 'allySpirit', 'allyTimer'];
  const flag = (k) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('combat_' + k); return v === undefined ? true : !!v; } catch (e) { return true; } };
  let cache = null, cacheAt = 0;
  const flags = () => { if (!on()) return false; const n = performance.now(); if (!cache || n - cacheAt > 500) { cache = {}; KEYS.forEach((k) => { cache[k] = flag(k); }); cacheAt = n; } return cache; };
  let hooked = false, zoomAt = 0;
  function tick() {
    const b = window.__ccBridge;
    if (!b || !b.barLabels) { hooked = false; return; }
    if (!hooked) hooked = !!b.barLabels(flags);
    if (hooked && on()) { try { b.combat(); } catch (e) {} } // keeps the DPS figure fresh
    try { if (hooked && b.fitScene && !flag('autoZoom')) b.fitReset(); } catch (e) {}
  }
  // The camera fit runs often and moves only a little each time, so the zoom and pan glide instead of jumping.
  function fitTick() { try { const b = window.__ccBridge; if (hooked && b && b.fitScene && flag('autoZoom')) b.fitScene(); } catch (e) {} }
  // Food-eaten pop-ups ("[food] +39 HP" above the kill count). The game fades and removes each one with two timers that it keeps in a list, and it clears that whole list at certain
  // moments (a new wave or encounter) WITHOUT removing the pop-ups that already exist: they then sit there for good, stacked on one spot, never floating up or fading. This gives every
  // new pop-up the same schedule as the game's own (fade after 1.5 s, gone 0.6 s later) with timers of its own, which nothing clears; if the game's timers did their job the pop-up is
  // already gone and these do nothing. Anything left over from before is cleared too. Switch: Plugins > Combat Readout > Clean Up Food Pop-ups.
  let eatObs = null, eatHud = null, eatSeen = new WeakSet();
  const eatFlag = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('combat_eatFix'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  function eatSchedule(n) {
    if (!n || eatSeen.has(n) || !(n.classList && n.classList.contains('eat-indicator'))) return; eatSeen.add(n);
    setTimeout(() => { try { if (n.isConnected && !n.classList.contains('fading')) n.classList.add('fading'); } catch (e) { /* gone */ } setTimeout(() => { try { if (n.isConnected) n.remove(); } catch (e) { /* gone */ } }, 700); }, 1700);
  }
  function eatWatch() {
    try {
      if (!on() || !eatFlag()) { if (eatObs) { eatObs.disconnect(); eatObs = null; eatHud = null; } return; }
      const hud = document.querySelector('.combat-hud') || null; if (hud === eatHud && eatObs) return;
      if (eatObs) eatObs.disconnect(); eatHud = hud; eatObs = null; if (!hud) return;
      hud.querySelectorAll('.eat-indicator').forEach((n) => { if (!eatSeen.has(n)) { eatSeen.add(n); n.classList.add('fading'); setTimeout(() => { try { n.remove(); } catch (e) { /* gone */ } }, 700); } });   // left over from before
      eatObs = new MutationObserver((ms) => { ms.forEach((m) => m.addedNodes.forEach(eatSchedule)); }); eatObs.observe(hud, { childList: true });
    } catch (e) { /* never break the page */ }
  }
  const eatTimer = setInterval(eatWatch, 1500); eatWatch();
  const fitTimer = setInterval(fitTick, 70);
  const timer = setInterval(tick, 500);
  tick();
  function teardown() {
    clearInterval(timer); clearInterval(fitTimer); clearInterval(eatTimer); try { if (eatObs) eatObs.disconnect(); } catch (e) { /* gone */ }
    try { window.__ccBridge && window.__ccBridge.unbarLabels && window.__ccBridge.unbarLabels(); } catch (e) {}
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc combat-readout torn down';
  }
  window[NS] = { version: 2, teardown };
  return 'cc combat-readout loaded';
})();
