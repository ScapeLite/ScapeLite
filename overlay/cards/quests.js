// ScapeLite card: Quests. The model builder of the quests card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Quests panel plus the bridge (active quests, ready to claim).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('quests', function create(c) {
    const { setting, bridge, panelEl, txt, ttHtml, redraw } = c;
    const stepFrac = (s) => { const m = /Step\s+(\d+)\s*\/\s*(\d+)/i.exec(s || ''); return m ? (Number(m[1]) - 1) / Math.max(1, Number(m[2])) : null; };
    function questsRich() {
      const root = panelEl('quests'), b = bridge(); let pr = null, al = null;
      try { pr = b && b.project && b.project(); al = b && b.alertState && b.alertState(); } catch (e) { /* not ready */ }
      const q = (pr && pr.quests) || {}, ready = new Set((al && al.questsReady) || []), rows = [];
      if (root) root.querySelectorAll('.quest-slot:not(.quest-slot-empty)').forEach((s) => {
        const name = txt(s, '.quest-slot-name'); if (!name) return;
        const qq = q[name], done = ready.has(name), hi = s.querySelector('.quest-hint-icon');
        rows.push({ name, sub: done ? 'All steps done: claim your reward' : txt(s, '.quest-slot-progress'), right: txt(s, '.quest-slot-hint'), frac: done ? 1 : (stepFrac(txt(s, '.quest-slot-progress')) != null ? stepFrac(txt(s, '.quest-slot-progress')) : (qq && qq.steps ? qq.current / qq.steps : 0)), tone: done ? 'good' : '', detail: { html: ttHtml(s) },
          // your click on a quest here is passed to the same quest in the game's Quests panel, which opens it (what clicking it there does)
          click: () => { const pe = panelEl('quests'), sl = pe && Array.from(pe.querySelectorAll('.quest-slot:not(.quest-slot-empty)')).find((x) => txt(x, '.quest-slot-name') === name); if (sl) sl.click(); } });
      });
      rows.sort((a, c) => (c.tone === 'good') - (a.tone === 'good') || c.frac - a.frac);
      const nReady = rows.filter((r) => r.tone === 'good').length, free = root ? root.querySelectorAll('.quest-slot-empty').length : 0;
      const qOn = setting('uiQuestsList', true) !== false;
      const head = qOn ? [{ kind: 'tabs', tabs: [['active', 'Active'], ['list', 'List']].map(([k, lab]) => ({ label: lab, on: questsMode === k, onClick: () => { questsMode = k; try { redraw('quests'); } catch (e) { /* card gone */ } } })) }] : [];
      if (qOn && questsMode === 'list') {
        const L = questList();
        return { title: 'Quests', note: L.head || '', blocks: head.concat(L.rows.length ? [{ kind: 'rows', rows: L.rows }] : [{ kind: 'text', text: 'Open the quests panel once to load the list.' }]) };
      }
      const note = (rows.length ? rows.length + ' active' + (nReady ? ' · ' + nReady + ' to claim' : '') : '') + (qOn && free ? (rows.length ? ' · ' : '') + free + (free === 1 ? ' free slot' : ' free slots') : '');
      return { title: 'Quests', note, blocks: head.concat(rows.length ? [{ kind: 'bars', rows }] : [{ kind: 'text', text: 'No active quests.' }]) };
    }
    // The List view: the game only draws it while its own Quests panel is switched to List, so that switch is flipped for an instant (and flipped back) to copy the rows;
    // clicking a row passes your click to the game's row, which opens that quest. The copy is kept for a few seconds so the card does not keep flipping the game's panel.
    let questsMode = 'active', qListCache = { t: 0, v: null };
    function questList() {
      const pe = panelEl('quests'); if (!pe) return { head: '', rows: [] };
      if (qListCache.v && Date.now() - qListCache.t < 4000) return qListCache.v;
      const btn = (k) => Array.from(pe.querySelectorAll('.qp-toggle-btn')).find((x) => x.textContent.trim().toLowerCase() === k), was = pe.querySelector('.qp-toggle-btn.active');
      const lb = btn('list'), flip = !!lb && !(lb.classList.contains('active'));
      if (flip) lb.click();
      const head = txt(pe, '.qp-list-header'), rows = Array.from(pe.querySelectorAll('.qp-list-row')).map((r) => { const name = r.textContent.trim(); return { name, col: r.style.color || '', click: () => { const p2 = panelEl('quests'), b2 = p2 && Array.from(p2.querySelectorAll('.qp-toggle-btn')).find((x) => x.textContent.trim().toLowerCase() === 'list'); if (!p2) return; const wasList = !!b2 && b2.classList.contains('active'); if (b2 && !wasList) b2.click(); const rw = Array.from(p2.querySelectorAll('.qp-list-row')).find((x) => x.textContent.trim() === name); if (rw) rw.click(); if (b2 && !wasList && was) setTimeout(() => { try { was.click(); } catch (e) { /* gone */ } }, 120); } }; });
      if (flip && was) was.click();
      qListCache = { t: Date.now(), v: { head, rows } };
      return qListCache.v;
    }
    return { source: 'quests', build: questsRich };
  });
})();
