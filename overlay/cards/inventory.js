// ScapeLite card: Inventory. The model builder of the inventory card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Inventory panel (.inventory-panel).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('inventory', function create(c) {
    const { setting, put, txt, ttHtml, hideTip } = c;
    function inventoryRich() {
      const root = window.__ccDom.q('.inventory-panel'), cells = []; let used = 0;
      if (root) root.querySelectorAll('.inv-slot').forEach((sl) => {
        const id = sl.classList.contains('empty') ? '' : sl.dataset.itemId, im = sl.querySelector('img'), tl = sl.querySelector('.inv-tier-label, .inv-label'), q = sl.querySelector('.inv-qty');
        if (id) used++;
        cells.push(id ? { img: im ? im.src : '', txt: q ? q.textContent.trim() : '', tier: tl ? tl.textContent.trim() : '', detail: { html: ttHtml(sl) } } : { img: '', ghost: true });
      });
      // Settings > Plugins > Panels > Inventory Card Rows: how many rows tall the grid is (1 = one long row, as many as you have slots = one column).
      // It only ever shows the slots you really have (the bag grows with items), and the columns follow: ceil(slots / rows).
      const auto = setting('uiInvAuto', true) !== false;   // pinned panel: rows and columns fill the whole panel and the slots grow with it
      const total = cells.length, rows = Math.max(1, Math.min(Math.max(1, total), Math.round(Number(setting('uiInvRows', 4))) || 4)), cols = Math.max(1, Math.ceil(total / rows));
      const opts = [1, 2, 3, 4, 5, 6, 8, 10, 16, 32, 64].filter((n) => n <= total); if (total && !opts.includes(total)) opts.push(total);
      return { title: 'Inventory', note: total ? used + ' / ' + total + ' slots used' : '', blocks: [{ kind: 'grid', cols, cell: cols > 20 ? 28 : cols > 14 ? 34 : cols > 10 ? 40 : 44, cells }], auto, gear: { tip: 'Layout', items: () => [{ label: 'Fit the panel (rows and columns follow its size)', checked: () => setting('uiInvAuto', true) !== false, keepOpen: true, onClick: () => { put('uiInvAuto', !(setting('uiInvAuto', true) !== false)); } }, { head: 'Rows when not fitting (' + total + ' slots)' }, { chips: opts.map((n) => ({ label: String(n), on: n === rows, onClick: () => { put('uiInvRows', n); hideTip(); } })) }] } };
    }
    return { source: 'inventory', build: inventoryRich };
  });
})();
