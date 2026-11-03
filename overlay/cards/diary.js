// ScapeLite card: Diary. The model builder of the diary card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Diary panel (.diary-row).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('diary', function create(c) {
    const { setting, panelEl, txt, redraw } = c;
    function diaryRich() {
      const root = panelEl('diary'); if (!root) return { title: 'Diary', blocks: [{ kind: 'text', text: 'Nothing to show.' }] };
      const fill = root.querySelector('.diary-all-fill'), all = fill ? (parseFloat(fill.style.width) || 0) / 100 : 0, tiers = {}, rows = [];
      root.querySelectorAll('.diary-row').forEach((r) => {
        const t = txt(r, '.diary-tier-badge') || 'Tier 0', f = r.querySelector('.diary-bar-fill'), cnt = txt(r, '.diary-bank-count'), m = /(\d+)\s*\/\s*(\d+)/.exec(cnt);
        tiers[t] = (tiers[t] || 0) + 1;
        const frac = f ? (parseFloat(f.style.width) || 0) / 100 : (m ? m[1] / m[2] : 0);
        rows.push({ name: txt(r, '.diary-bank-name'), sub: t + ' · ' + txt(r, '.diary-tier-reward'), right: cnt, frac, left: m ? m[2] - m[1] : 99 });
      });
      const dOn = setting('uiDiaryAll', true) !== false;
      const near = dOn && diaryAll ? rows.slice().sort(diarySort === 'az' ? (a, c) => a.name.localeCompare(c.name) : diarySort === 'game' ? () => 0 : (a, c) => (a.frac >= 1) - (c.frac >= 1) || c.frac - a.frac) : rows.filter((r) => r.frac < 1).sort((a, c) => c.frac - a.frac).slice(0, 6);
      const tierLine = Object.keys(tiers).sort().reverse().map((t) => tiers[t] + ' at ' + t.toLowerCase()).join(' · ');
      return { title: 'Diary', note: txt(root, '.diary-sub'), blocks: [{ kind: 'bars', rows: [Object.assign({ name: 'All diaries', sub: tierLine, right: Math.round(all * 100) + '%', frac: all }, setting('uiDiaryAll', true) !== false ? { detail: { html: (root.querySelector('.diary-info-tooltip') || {}).innerHTML || '' }, click: () => { const t = panelEl('diary'), ti = t && t.querySelector('.diary-title'); if (ti) ti.click(); } } : {})] }]
        .concat(dOn ? [{ kind: 'tabs', tabs: [['near', 'Closest 6'], ['all', 'All ' + rows.length]].map(([k, lab]) => ({ label: lab, on: (k === 'all') === diaryAll, onClick: () => { diaryAll = k === 'all'; try { redraw('diary'); } catch (e) { /* card gone */ } } })).concat(diaryAll ? [['progress', 'Progress'], ['az', 'A-Z'], ['game', 'Game order']].map(([k, lab]) => ({ label: lab, on: diarySort === k, onClick: () => { diarySort = k; try { redraw('diary'); } catch (e) { /* card gone */ } } })) : []) }] : [{ kind: 'label', text: 'Closest to the next step' }])
        .concat([{ kind: 'bars', rows: near }]) };
    }
    let diaryAll = false, diarySort = 'progress';
    return { source: 'diary', build: diaryRich };
  });
})();
