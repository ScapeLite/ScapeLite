// Design Lab: the Task queue, rendered by the REAL overlay/ui-queue.js against the stub bridge (stub-bridge.js).
(function () {
  'use strict';
  const { h } = window.Lab;
  const Q = () => window.__ccQueue;
  function size(root, w) {   // what ui-queue's setWidth() does for the kept panel
    const bp = w >= 340 ? 'full' : w >= 180 ? 'compact' : 'micro', s = bp === 'full' ? Math.min(1.5, Math.max(0.9, w / 450)) : bp === 'compact' ? Math.min(1.1, Math.max(0.9, w / 300)) : 1;
    root.style.setProperty('--s', s.toFixed(3)); root.dataset.bp = bp; if (w >= 620) root.dataset.wide = '1';
  }
  function hoverCard(w) {
    const host = h('div', { style: { width: w + 'px' } });
    if (!Q()) return h('div', { style: { color: '#ff8a5c' } }, 'overlay/ui-queue.js did not load');
    const root = Q().mountHover(host); size(root, w); root.style.setProperty('--cc-q-maxh', '640px');
    return host;
  }
  window.Lab.add({ id: 'queue-hover-card', cat: 'Cards and rows', title: 'Queue Panel (hover card form)', keywords: 'task queue tray walking pill tile real code',
    desc: 'Real ui-queue.js code. Hover a tile to open the Tray with the alternatives; the cards, pills and tiles are the real DOM.',
    covers: ['queue-hover-card', 'queue-hover-card.header', 'queue-panel.card', 'queue-panel.card.tile', 'queue-panel.walking-gap.walking-pill', 'queue-options-tray', 'queue-panel.controls-bar'],
    variants: [{ label: 'Full width (450 px)', w: 450 }, { label: 'Compact (300 px)', w: 300 }, { label: 'Micro (150 px)', w: 150 }],
    render: (ctx, v) => hoverCard(v.w) });
  window.Lab.add({ id: 'queue-kept-panel', cat: 'Panels', title: 'Queue Panel (kept, pinned)', keywords: 'task queue kept pinned panel gear cogwheel real code',
    desc: 'The real kept panel: the Info Bar Tasks button opens it. Same Card list as the hover form, with the cogwheel and collapse buttons.',
    covers: ['queue-panel', 'queue-panel.header', 'queue-panel.footer', 'queue-panel.controls-bar'],
    variants: [{ label: 'Kept panel, 450 px' }],
    render: () => {
      const wrap = h('div', { style: { minHeight: '60px' } });
      if (!Q()) return h('div', { style: { color: '#ff8a5c' } }, 'overlay/ui-queue.js did not load');
      try {
        if (!Q().isOpen()) Q().toggle();
        const el = Q().panelEl(); if (el) { el.style.width = '450px'; el.style.maxHeight = '700px'; wrap.appendChild(el); Q().refresh(true); }
      } catch (e) { wrap.textContent = 'queue panel failed: ' + e.message; }
      return wrap;
    } });
})();

// The game's own big window, drawn as a plain stand-in (the game's CSS is not available here) so ScapeLite additions can be shown in context.
(function () {
  'use strict';
  const { h } = window.Lab, st = (o) => ({ style: o });
  window.Lab.add({ id: 'game-window-frame', cat: 'Windows', title: 'Game window (stand-in)', keywords: 'settings bank crafting modal-overlay modal-container window game',
    desc: 'Stand-in for one of the game’s big windows (Settings, Bank, Crafting ...: .modal-overlay > .modal-container). ScapeLite adds a corner grip (modal-resize) and drawers/bars inside it. Game styling is approximated.',
    covers: ['game-window', 'game-window.header', 'game-window.tab-bar', 'game-window.body', 'settings-window'],
    variants: [{ label: 'Settings window, Plugins tab', box: [720, 380] }],
    render: () => h('div.modal-overlay', st({ position: 'absolute', inset: 0, background: '#0d1016', color: '#e6e6ee', fontFamily: 'system-ui' }),
      h('div.modal-container', st({ position: 'absolute', inset: '8px', border: '1px solid #2c3442', borderRadius: '8px', background: '#12161d' }),
        h('div', st({ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', fontSize: '24px' }), '⚙ Settings'),
        h('div', st({ display: 'flex', gap: '6px', padding: '0 14px', flexWrap: 'wrap' }), ['Build', 'Display', 'Chat', 'Queue', 'Plugins'].map((t, i) => h('span', st({ padding: '4px 10px', border: '1px solid #2c3442', borderRadius: '5px', background: i === 4 ? '#1d2735' : 'transparent', fontSize: '13px' }), t))),
        h('div', st({ padding: '14px', display: 'grid', gap: '10px', width: '60%' }), ['Enable Route Advisor', 'Show Panel on World Map', 'Alert Threshold (seconds)'].map((t) => h('div', st({ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #232a36', paddingBottom: '8px', fontSize: '14px' }), t, h('input.cc-sw', { type: 'checkbox', checked: true })))),
        h('div#cc-modal-grip', st({ position: 'absolute', right: '4px', bottom: '4px', width: '16px', height: '16px', cursor: 'nwse-resize', background: 'linear-gradient(135deg,transparent 52%,#7fb4ff 52% 62%,transparent 62% 76%,#7fb4ff 76% 86%,transparent 86%)' })))) });
})();
