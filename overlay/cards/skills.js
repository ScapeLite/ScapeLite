// ScapeLite card: Skills. The model builder of the skills card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Skills panel (.skills-panel).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('skills', function create(c) {
    const { setting, put, txt, ttHtml, hideTip } = c;
    function skillsRich() {
      const cells = [], root = window.__ccDom.q('.skills-panel'); let tot = 0, qsum = 0;
      if (root) root.querySelectorAll('.skill-cell').forEach((c) => {
        const im = c.querySelector('img'), lv = c.querySelector('.skill-level'), pf = c.querySelector('.skill-progress-fill');
        const n = parseInt(lv && lv.textContent, 10) || 0; tot += n;
        const qf = c.querySelector('.cc-skq-fill'), up = !!c.querySelector('.tooltip .cc-skq-up');
        if (qf) qsum++;
        cells.push({ img: im ? im.src : '', txt: lv ? lv.textContent.trim() : '', frac: pf ? (parseFloat(pf.style.width) || 0) / 100 : null, col: pf && pf.dataset.ccG ? pf.dataset.ccG : '',
          q: qf ? [(parseFloat(qf.style.left) || 0) / 100, (parseFloat(qf.style.width) || 0) / 100] : null, up, detail: { html: ttHtml(c) },
          onClick: () => { if (setting('uiSkillCellClick', true) !== false) c.click(); } });   // your click on the cell is handed to the game's own cell, which opens that skill's window (levers, Delve / Fortify tree, Alms)
      });
      // columns: Settings > Plugins > Panels > Skills Card Columns (default 4, the same as the game's own Skills panel, so the order reads the same); the rows follow
      const auto = setting('uiSkillAuto', true) !== false;   // pinned panel: columns and sizes follow the panel
      const n = cells.length, cols = Math.max(1, Math.min(10, Math.round(Number(setting('uiSkillCols', 4))) || 4)), rem = n % cols;
      if (n) { const tc = root && root.querySelector('.total-cell'); cells.push({ total: { label: 'Total Level', value: tot }, span: rem ? cols - rem : cols, detail: tc ? { html: ttHtml(tc) } : null, onClick: () => { if (setting('uiSkillCellClick', true) !== false && tc) tc.click(); } }); }   // fills what is left of the last row (a whole row when it is full)
      return { title: 'Skills', note: (tot ? 'Total level ' + tot : '') + (qsum ? ' \u00B7 green = what your queue adds' : ''), min: [0, 0], blocks: [{ kind: 'grid', cols, cell: cols <= 4 ? 72 : cols <= 6 ? 60 : cols <= 8 ? 50 : 42, cells }], auto, share: setting('uiSkillShareTotal', true) !== false,
        gear: { tip: 'Layout', items: () => [{ label: 'Fit the panel (columns follow its size)', checked: () => setting('uiSkillAuto', true) !== false, keepOpen: true, onClick: () => { put('uiSkillAuto', !(setting('uiSkillAuto', true) !== false)); } },
          ...(setting('uiSkillAuto', true) !== false
            ? [{ label: 'Total level shares the last row (like the game)', checked: () => setting('uiSkillShareTotal', true) !== false, keepOpen: true, onClick: () => { put('uiSkillShareTotal', !(setting('uiSkillShareTotal', true) !== false)); } }]
            : [{ head: 'Columns (' + n + ' skills)' }, { chips: [3, 4, 5, 6, 7, 8, 10].map((c) => ({ label: String(c), on: c === cols, onClick: () => { put('uiSkillCols', c); hideTip(); } })) }])] } };
    }
    return { source: 'skills', build: skillsRich };
  });
})();
