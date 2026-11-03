// Design Lab boot: harvest the production CSS from the real overlay scripts (in a hidden frame), install it, start the lab.
(function () {
  'use strict';
  // every overlay script that creates UI or injects CSS. Scripts that only hook the game's network, launch it, update it or manage files are not here.
  const PLUGINS = ['alert-bell', 'bank-tools', 'bug-report', 'card-fuse', 'chat-plus', 'craft-potential', 'drop-luck', 'fortress-tracker', 'goals', 'hover-info', 'hp-panel', 'layouts',
    'lever-advisor', 'material-shortage', 'mechanics-explainer', 'menu-dock', 'modal-resize', 'notif-dock', 'panel-fuse', 'queue-walk', 'raid-alert', 'raid-dps-extra', 'route-advisor',
    'scapelite-menu', 'settings-nav', 'sidebar-tabs', 'status-indicator', 'tree-advisor', 'ui-bar', 'ui-layout', 'ui-queue', 'walking-countdown', 'welcome-tour', 'window-dock', 'xp-tracker',
    'plugins-settings-ui', 'combat-readout'].map((n) => n + '.js');
  const BLOCK = new Set((new URLSearchParams(location.search).get('skip') || '').split(',').filter(Boolean));
  const list = PLUGINS.filter((f) => !BLOCK.has(f));

  function harvest() {
    return new Promise((resolve) => {
      const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:-9999px;width:1280px;height:720px;visibility:hidden'; fr.setAttribute('aria-hidden', 'true');
      const done = (r) => { clearTimeout(tm); window.removeEventListener('message', on); setTimeout(() => fr.remove(), 0); resolve(r); };
      const on = (e) => { if (e.source === fr.contentWindow && e.data && e.data.labHarvest) done(e.data.labHarvest); };
      const tm = setTimeout(() => done({ ok: [], failed: [{ src: 'harvest', msg: 'timed out' }], styles: [] }), 15000);
      window.addEventListener('message', on);
      fr.src = 'harvest-frame.html?plugins=' + encodeURIComponent(list.join(','));
      document.body.appendChild(fr);
    });
  }
  (async function () {
    // tag what the kit (loaded for real in this page) already installed
    [['cc-ui-tokens', 'ui-kit.js'], ['cc-ui-components', 'ui-kit.js'], ['cc-queue-style', 'ui-queue.js']].forEach(([id, f]) => { const s = document.getElementById(id); if (s) s.dataset.labSrc = f; });
    const rep = await harvest();
    const have = new Set(Array.from(document.querySelectorAll('style[id]')).map((s) => s.id));
    let n = 0;
    rep.styles.forEach((s) => {
      if (s.id && have.has(s.id)) return;
      const st = document.createElement('style'); if (s.id) { st.id = s.id; have.add(s.id); } st.dataset.labSrc = s.src; st.dataset.labHarvested = '1'; st.textContent = s.css; document.head.appendChild(st); n++;
    });
    window.__labHarvest = { loaded: rep.ok, failed: rep.failed, styles: n };
    console.info('[lab] harvested ' + n + ' style blocks from ' + rep.ok.length + ' scripts; failed:', rep.failed);
    window.Lab.start();
  })();
})();
