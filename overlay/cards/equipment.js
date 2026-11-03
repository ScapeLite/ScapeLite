// ScapeLite card: Equipment. The model builder of the equipment card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Equipment panel (paperdoll, stats, loadouts, the Potion / Spirit display toggles) plus the bridge (loadouts, DPS).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('equipment', function create(c) {
    const { setting, bridge, panelEl, txt, ttHtml, ownText, fwd } = c;
    function equipmentRich() {
      const root = panelEl('equipment'), cells = []; let note = '';
      const sp = document.querySelector('.equip-side .equip-stats-panel') || document.querySelector('.equip-stats-panel'), blocks = [];
      if (root) {
        const fam = ownText(root.querySelector('.loadout-sel-family.active')), act = txt(root, '.loadout-sel-slot.active .loadout-sel-slot-label');
        note = [fam, act].filter(Boolean).join(' · ');
        root.querySelectorAll('.equip-panel-paperdoll .inv-slot').forEach((s) => {
          const im = s.querySelector('.equip-panel-item-img'), sil = s.querySelector('.equip-panel-sil'), cs = getComputedStyle(s), have = !s.classList.contains('empty') && !!(im && im.getAttribute('src') && im.style.display !== 'none');   // the game keeps the last item's src on an emptied slot: only a slot without .empty and with a shown image holds an item
          cells.push({ img: have ? im.src : (sil ? sil.src : ''), ghost: !have, tier: have ? txt(s, '.inv-tier-label, .inv-label') : '', pos: [parseInt(cs.gridRowStart, 10) || 1, parseInt(cs.gridColumnStart, 10) || 1], detail: have ? { html: ttHtml(s) } : null });
        });
      }
      if (cells.length) blocks.push({ kind: 'grid', cols: 3, big: true, cell: 50, cells });
      let corner = null;
      if (sp) {
        const chips = [['Style', txt(sp, '.style-val')], ['Speed', txt(sp, '.speed-val')], ['Max hit', txt(sp, '.maxhit-val')]].filter((c) => c[1]);
        let dps = null; try { const b = bridge(); dps = b && b.gearDps && b.gearDps(); } catch (e) { /* not ready */ }
        if (dps && isFinite(dps.dps)) chips.push(['DPS', dps.dps.toFixed(2) + (dps.mob ? ' vs ' + dps.mob : '')]);
        if (chips.length) blocks.push({ kind: 'chips', chips });
        const rows = Array.from(sp.querySelectorAll('.stats-table tbody tr')).map((tr) => { const td = tr.children; return { name: (td[0] && td[0].textContent || '').trim(), vals: [1, 2, 3].map((k) => (td[k] && td[k].textContent || '').trim()) }; }).filter((r) => r.name);
        if (rows.length) blocks.push({ kind: 'stats', head: ['', 'Attack', 'Defence', 'Strength'], rows });
        const tg = setting('uiEquipToggles', true) === false ? [] : [['.potion-stats-toggle', 'Potion boosts'], ['.spirit-stats-toggle', 'Spirit modifier']].map(([ic, lab]) => {
          const im = sp.querySelector(ic), wr = im && im.parentElement; if (!wr) return null; const on = im.classList.contains('active');
          return { label: lab + ': ' + (on ? 'ON' : 'OFF'), on, cls: 'tgl', detail: { get html() { const e = document.querySelector(ic), t = e && e.parentElement && e.parentElement.querySelector(':scope > .tooltip'); return t ? t.innerHTML : ''; } },
            onClick: () => { const e = document.querySelector(ic); if (e && e.parentElement) { e.parentElement.click(); } } };
        }).filter(Boolean);
        if (tg.length) blocks.push({ kind: 'actions', buttons: tg });
        const gl = sp.querySelector('.gearcalc-launch');
        if (gl) corner = { img: gl.src, tip: 'Open the Extended Combat Calculator', click: () => gl.click() };
      }
      // The loadouts: a dropdown of every family and slot; a pick passes YOUR click to the game's own loadout buttons (family first, then the slot)
      let loadout = null;
      try {
        const lo = window.__ccBridge && window.__ccBridge.ok() && window.__ccBridge.loadouts ? window.__ccBridge.loadouts() : null, cur = root && (root.querySelector('.loadout-sel-slot.active') || {}).dataset;
        if (lo && lo.families && root) loadout = { families: lo.families, current: (cur && cur.loadout) || lo.current, pick: (fam, slot) => {
          const fb = root.querySelector('.loadout-sel-family[data-family="' + fam + '"]'); if (fb && !fb.classList.contains('active')) fb.click();
          setTimeout(() => { const sb = root.querySelector('.loadout-sel-slot[data-loadout="' + slot + '"]'); if (sb) sb.click(); fwd('equipment'); }, 60);
        } };
      } catch (e) { loadout = null; }
      return { title: 'Equipment', note, corner, loadout, blocks: blocks.length ? blocks : [{ kind: 'text', text: 'Open the equipment panel once to load it.' }] };
    }
    return { source: 'equipment', build: equipmentRich };
  });
})();
