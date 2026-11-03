// ScapeLite card: Barter. The model builder of the barter card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Barter panel (rows, Reroll / Buy / Sell / Charm, amount slider).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('barter', function create(c) {
    const { setting, panelEl, txt, ownText, fwd } = c;
    // The Barter card mirrors the game's Barter panel, controls included. Reroll, Buy, Sell, Charm and the amount slider are YOUR clicks handed to the game's own buttons in the same panel:
    // ScapeLite sends nothing itself, the greyed-out state, the cost and the tooltips are the game's (read live), and a button the game greys out is greyed out here.
    function barterRich() {
      const root = panelEl('barter'), rows = []; let note = '';
      const top = [], acts = setting('uiBarterActions', true) !== false;
      const game = (sel) => { const p = panelEl('barter'); return p ? p.querySelector(sel) : null; };
      const later = () => fwd('barter');   // the game answers a Reroll, Buy or Charm a moment later: the shared layer follows the game for a few seconds
      const press = (sel) => () => { const b = game(sel); if (b && !b.disabled) { b.click(); later(); } else { try { window.__ccUI.toast(b ? 'The game’s button is disabled right now.' : 'The game’s Barter panel has no such button right now.', { tone: 'warn', ms: 2500 }); } catch (e) { /* kit gone */ } later(); } };
      const live = (sel) => ({ get html() { const e = game(sel), t = e && e.querySelector(':scope > .tooltip'); return t ? t.innerHTML : ''; } });
      if (root) {
        const bud = txt(root, '.barter-header-budget'), rr = root.querySelector('.barter-reroll-btn'), rl = rr ? Array.from(rr.querySelectorAll('.tt-line')).map((l) => l.textContent.trim()).find((t) => /available/i.test(t)) : '';
        const cost = rr ? /\((\d+)\s/.exec(txt(rr, '.tt-name')) : null;
        note = [bud ? bud + ' charges left' : '', rl ? rl.replace(/\s*available/i, '') + ' rerolls' : ''].filter(Boolean).join(' · ');
        if (acts && rr) top.push({ label: '↻ Reroll' + (cost ? ' · ' + cost[1] + ' credits' : ''), cls: 'reroll', disabled: rr.disabled, detail: live('.barter-reroll-btn'), onClick: press('.barter-reroll-btn') });
        const ov = root.querySelector('.barter-consumed-overlay'), used = !!ov && ov.style.display !== 'none';
        root.querySelectorAll('.barter-slot-row').forEach((r) => {
          const idx = r.dataset.slotIndex, locked = r.classList.contains('barter-slot-locked'), im = r.querySelector('.barter-slot-icon img'), mod = r.querySelector('.barter-mod-label');
          const tcode = (r.querySelector('.barter-slot-icon .inv-tier-label, .barter-slot-icon .inv-label') || {}).textContent || '', tm = /^\[(T\d+)\]/.exec(im ? String(im.alt || '') : ''), tier = (tcode.trim() || (tm ? tm[1] : '')), itt = r.querySelector('.barter-slot-icon .inv-slot > .tooltip');
          const nm = im ? String(im.alt || '').replace(/^\[T\d+\]\s*/, '') : '', ty = ownText(r.querySelector('.barter-slot-type'));
          const row = { img: im ? im.src : '', name: locked ? 'Locked' : (nm || 'Empty'), sub: (locked ? txt(r, '.barter-price-value') + ' needed' : ({ RES: 'Resource', EQP: 'Equipment' }[ty] || ty || 'Item') + ' · ' + txt(r, '.barter-price-value') + ' gold' + (txt(r, '.inv-qty') ? ' · you hold ' + txt(r, '.inv-qty') : '')), right: mod ? mod.textContent.trim() : '', tone: mod && mod.classList.contains('barter-mod-good') ? 'good' : mod && mod.classList.contains('barter-mod-bad') ? 'bad' : '', dim: locked, tier: locked ? '' : tier, detail: !locked && itt ? { html: itt.innerHTML } : null };
          if (!locked && nm && tier && !/\[T\d+\]/.test(nm)) row.name = '[' + tier + '] ' + nm;
          if (acts && !locked && im) {
            const slot = '.barter-slot-row[data-slot-index="' + idx + '"]', qw = r.querySelector('.barter-qty-wrap'), qi = r.querySelector('.barter-qty-input'), btns = [];
            const qtxt = (rw) => '×' + txt(rw, '.barter-qty-label') + ' = ' + txt(rw, '.barter-price-value') + ' gold';
            if (qw && qi && qw.style.display !== 'none' && (parseInt(qi.max, 10) || 1) > 1) row.qty = { min: 1, max: parseInt(qi.max, 10) || 1, value: parseInt(qi.value, 10) || 1, disabled: qi.disabled, text: qtxt(r),
              onInput: (v) => { const g = game(slot + ' .barter-qty-input'); if (!g) return ''; g.value = String(v); g.dispatchEvent(new Event('input', { bubbles: true })); return qtxt(game(slot)); } };   // the game's own slider handler then updates its price and tooltips
            [['Buy', '.barter-buy-btn'], ['Sell', '.barter-sell-btn'], ['Charm', '.barter-charm-btn']].forEach(([lab, sel]) => {
              const b = r.querySelector(sel); if (!b || b.style.display === 'none' || b.style.visibility === 'hidden') return;
              btns.push({ label: lab, cls: lab.toLowerCase(), disabled: b.disabled, detail: live(slot + ' ' + sel), onClick: press(slot + ' ' + sel) });
            });
            if (btns.length) row.buttons = btns;
          }
          if (used) row.spent = true;   // no charges left: the whole list is greyed out, like the game's own dark overlay
          rows.push(row);
        });
        if (used) top.push({ text: ('No charges left. ' + txt(ov, '.barter-consumed-sub')).trim() });
      }
      // the game's two header tooltips: price modifier ranges + pool access (on the gold figure) and charges per roll (on the budget figure), shown as hover cards on two header rows
      if (root && rows.length && setting('uiBarterInfo', true) !== false) {
        const gw = root.querySelector('.barter-gold-wrap'), bw = root.querySelector('.barter-budget-wrap'), gt = gw && gw.querySelector(':scope > .tooltip'), bt = bw && bw.querySelector(':scope > .tooltip');
        const hd = [];
        if (gt) hd.push({ img: '/assets/icons/items/gold.png', name: txt(gw, '.barter-header-gold') + ' gold', sub: 'Hover: buy and sell price ranges, pool access', detail: { html: gt.innerHTML } });
        if (bt) hd.push({ img: '/assets/icons/skills/barter.png', name: txt(bw, '.barter-header-budget') + ' charges', sub: 'Hover: charges per roll', detail: { html: bt.innerHTML } });
        if (rows.some((x) => x.spent)) hd.forEach((x) => { x.spent = true; });
        rows.unshift(...hd);
      }
      const head = top.filter((x) => x.label).length ? [{ kind: 'actions', buttons: top.filter((x) => x.label) }] : [];
      top.filter((x) => x.text).forEach((x) => head.push({ kind: 'text', text: x.text }));
      return { title: 'Barter', note, blocks: rows.length ? head.concat([{ kind: 'rows', rows }]) : [{ kind: 'text', text: 'Open the barter panel once to load it.' }] };
    }
    return { source: 'barter', build: barterRich };
  });
})();
