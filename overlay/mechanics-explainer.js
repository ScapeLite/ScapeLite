// ScapeLite Mechanics Explainer. Display only: adds a short plain-language explanation under the game's own tooltips.
// The game shows one shared tooltip (.ctrl-global-tooltip) for every lever in the Skills / Slay Customization windows and rebuilds
// its contents on each hover. This watches that tooltip and appends one extra block explaining what the lever really does,
// using the numbers already in the tooltip (position change, cost). Nothing is clicked or sent.
(function () {
  'use strict';
  const NS = '__ccMechanics';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('mechanicsExplainerEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };

  const style = document.createElement('style');
  style.id = 'cc-mech-style';
  style.textContent = '.ctrl-global-tooltip .cc-mech{margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.18);color:#9fd0ff;font-size:.88em;line-height:1.35;max-width:300px;white-space:normal}';
  document.head.appendChild(style);

  const r2 = (n) => String(Math.round(n * 100) / 100);
  // Explanations. Each gets the tooltip's action line ("Increase Weight (0 → 1)"), its cost line and the lever kind.
  function explain(action, cost) {
    const m = /^(Increase|Decrease)\s+(.+?)\s*\((-?\d+)\s*→\s*(-?\d+)\)/.exec(action || '');
    if (!m) return null;
    const kind = m[2].toLowerCase(), from = +m[3], to = +m[4];
    const mult = (p) => '×' + r2(Math.pow(1.25, p));
    const refund = to < from ? ' Lowering a lever gives credits back.' : '';
    if (kind === 'weight') {
      return 'Weight: how often this is picked compared to the others in the list. Each step is 1.25× as likely: now ' + mult(from) + ', after this ' + mult(to) +
        '. Odds are shared, so raising one entry makes every other entry a little less likely. The cost doubles with each step away from 0.' + refund;
    }
    if (/^(quantity|qty)/.test(kind)) {
      return 'Quantity: scales how many items or kills a task asks for. Each step is 1.25×: now ' + mult(from) + ', after this ' + mult(to) +
        '. More per task means fewer task rolls and walks, but longer tasks. The cost doubles with each step away from 0.' + refund;
    }
    return null;
  }

  let busy = false;
  function decorate(tt) {
    if (busy || !on() || tt.style.display === 'none' || tt.querySelector('.cc-mech')) return;
    const text = explain((tt.querySelector('.tt-action') || {}).textContent, (tt.querySelector('.tt-cost') || {}).textContent);
    if (!text) return;
    busy = true;
    try { const d = document.createElement('div'); d.className = 'cc-mech'; d.textContent = text; tt.appendChild(d); } finally { busy = false; }
  }
  const watch = (tt) => { if (!tt._ccMech) { tt._ccMech = true; obs.observe(tt, { childList: true, attributes: true, attributeFilter: ['style'] }); } };
  const obs = new MutationObserver((list) => { if (busy) return; list.forEach((m) => decorate(m.target.nodeType === 1 && m.target.classList.contains('ctrl-global-tooltip') ? m.target : document.querySelector('.ctrl-global-tooltip'))); });
  // The tooltip element is created when the customization window is first built, so look for it until it exists.
  const finder = setInterval(() => { const tt = window.__ccDom.q('.ctrl-global-tooltip'); if (tt) watch(tt); }, 1500);
  function teardown() {
    clearInterval(finder); obs.disconnect(); style.remove();
    document.querySelectorAll('.ctrl-global-tooltip .cc-mech').forEach((e) => e.remove());
    document.querySelectorAll('.ctrl-global-tooltip').forEach((e) => { delete e._ccMech; });
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc mechanics-explainer torn down';
  }
  window[NS] = { version: 1, teardown, explain };
  return 'cc mechanics-explainer loaded';
})();
