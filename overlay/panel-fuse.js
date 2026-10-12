// Panel Fuse. DISPLAY-ONLY: when two floating panels sit edge to edge, a link
// button appears in their title bars. Click it to "fuse" them:
//   - the touching edge is snapped flush and the seam is cleaned up (squared
//     corners, one border line instead of two rounded ones);
//   - dragging either panel carries the fused neighbours along.
// Moving the partner uses a CSS `margin` offset on the partner (the game's own
// left/top are never written), persisted in localStorage `cc-panel-fuse`.
// Fuses auto-release when the panels are pulled apart by other means (e.g. a
// resize that no longer leaves them touching) or via the same button.
(function () {
  'use strict';
  const NS = '__ccPanelFuse';
  const LS = 'cc-panel-fuse';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const enabled = () => { try { const s = window.__ccPluginSettings; return !(s && s.get && s.get('panelFuseEnabled') === false); } catch (e) { return true; } };
  const T0 = performance.now();
  const TOUCH = 8;     // px gap (either sign) that still counts as "touching"
  const MIN_OVER = 14; // px overlap along the shared edge

  // links: [{a, b, dx, dy, side}] ; dx,dy = logical(b) - logical(a), logical = left/top + margin offset
  let links = [], off = {};
  try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); links = o.links || []; off = o.off || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ links: links.map(l => ({ a: l.a, b: l.b, dx: l.dx, dy: l.dy, side: l.side })), off })); } catch (e) {} };

  const style = document.createElement('style');
  style.id = 'cc-panel-fuse-style';
  const attach = () => { if (document.head && !style.isConnected) document.head.appendChild(style); };
  attach();
  const sel = (id) => `.panel-floating:has(> .panel-titlebar[data-panel-id="${CSS.escape(id)}"])`;
  const uiZoom = () => { const u = document.getElementById('ui-container'); const z = u ? parseFloat(getComputedStyle(u).zoom) : 1; return z > 0 ? z : 1; };
  const LINK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 9.5l3-3M5.2 7.2L3.6 8.8a2.4 2.4 0 003.4 3.4l1.6-1.6M10.8 8.8l1.6-1.6A2.4 2.4 0 009 3.8L7.4 5.4"/></svg>';

  let tbList = [], tbAt = -1e9;
  function scan() {
    const out = new Map();
    const now = performance.now();
    if (now - tbAt > 1000 || tbList.some((t) => !t.isConnected)) { tbList = [...document.querySelectorAll('.panel-floating > .panel-titlebar[data-panel-id]')]; tbAt = now; }
    tbList.forEach((tb) => {
      const el = tb.parentElement, r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || el.classList.contains('panel-minimized')) return;
      const nx = parseFloat(el.style.left), ny = parseFloat(el.style.top);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      const label = tb.querySelector('.panel-titlebar-label');
      out.set(tb.dataset.panelId, { id: tb.dataset.panelId, el, tb, r, nx, ny, name: (label && label.textContent.trim()) || tb.dataset.panelId });
    });
    try { const w = window.__ccMenuDock && window.__ccMenuDock.item && window.__ccMenuDock.item(); if (w && w.r.width > 0) out.set(w.id, w); } catch (e) {}
    return out;
  }
  // Which side of `p` does `q` touch? 'r' = q is to the right of p, etc.; null = not touching.
  function touching(p, q) {
    const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    const vOv = ov(p.r.top, p.r.bottom, q.r.top, q.r.bottom), hOv = ov(p.r.left, p.r.right, q.r.left, q.r.right);
    if (vOv >= MIN_OVER && Math.abs(q.r.left - p.r.right) <= TOUCH) return 'r';
    if (vOv >= MIN_OVER && Math.abs(p.r.left - q.r.right) <= TOUCH) return 'l';
    if (hOv >= MIN_OVER && Math.abs(q.r.top - p.r.bottom) <= TOUCH) return 'b';
    if (hOv >= MIN_OVER && Math.abs(p.r.top - q.r.bottom) <= TOUCH) return 't';
    return null;
  }
  const OPP = { r: 'l', l: 'r', t: 'b', b: 't' };
  // Side a fused pair sits on. Normally the geometric one; when the pair has drifted (the Tasks panel grew into the HP bar / menu,
  // say) the side it was fused on (from the stored logical offset) is used, so the seam is restored instead of the overlap staying.
  // The side is remembered on the link (l.side) whenever the pair is seen touching; the menu / HP dock cannot use the sign of the
  // logical offset because its logical position is in a different coordinate system from the panels'.
  function lside(l, a, b) {
    const s = touching(a, b); if (s) { l.side = s; return s; }
    const side = l.side; if (!side) return null;
    const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    if (side === 'r' || side === 'l') {
      if (ov(a.r.top, a.r.bottom, b.r.top, b.r.bottom) < MIN_OVER) return null;
      const gap = side === 'r' ? b.r.left - a.r.right : a.r.left - b.r.right;
      return gap > -700 && gap < 120 ? side : null;
    }
    if (ov(a.r.left, a.r.right, b.r.left, b.r.right) < MIN_OVER) return null;
    const gap = side === 'b' ? b.r.top - a.r.bottom : a.r.top - b.r.bottom;
    return gap > -700 && gap < 120 ? side : null;
  }
  const lastNat = {};
  let pointerDown = false;

  function fuse(pa, pb) {
    // pa = panel whose button was clicked: it snaps flush against pb.
    const side = touching(pb, pa); // where pa sits relative to pb ('r' = pa is right of pb)
    if (!side) return;
    const z = uiZoom();
    // Displayed shift that would bring pa flush against pb.
    let ddx = 0, ddy = 0;
    if (side === 'r') ddx = pb.r.right - pa.r.left;
    else if (side === 'l') ddx = pb.r.left - pa.r.right;
    else if (side === 'b') ddy = pb.r.bottom - pa.r.top;
    else ddy = pb.r.top - pa.r.bottom;
    // The panel with fewer existing fuses is the one that moves (ties: the clicked one), together
    // with everything already fused to it, so an established group never shifts to close a gap.
    const cnt = (id) => links.filter(l => l.a === id || l.b === id).length;
    const mover = cnt(pb.id) < cnt(pa.id) ? pb : pa;
    if (mover === pb) { ddx = -ddx; ddy = -ddy; }
    group(mover.id).forEach((m) => { const o = off[m] || (off[m] = { x: 0, y: 0 }); o.x += ddx / z; o.y += ddy / z; });
    const La = { x: pb.nx + (off[pb.id] ? off[pb.id].x : 0), y: pb.ny + (off[pb.id] ? off[pb.id].y : 0) };
    const Lb = { x: pa.nx + (off[pa.id] ? off[pa.id].x : 0), y: pa.ny + (off[pa.id] ? off[pa.id].y : 0) };
    links.push({ a: pb.id, b: pa.id, dx: Lb.x - La.x, dy: Lb.y - La.y, side: side, born: performance.now() });
    save(); sync();
  }
  function unfuse(l) {
    links = links.filter(x => x !== l);
    // Release offsets of panels no longer in any link (they stay where they are).
    const inUse = new Set(); links.forEach(x => { inUse.add(x.a); inUse.add(x.b); });
    Object.keys(off).forEach(id => { if (!inUse.has(id)) delete off[id]; });
    save(); sync();
  }

  function propagate(P) {
    // Components of the link graph; a panel whose game position changed leads.
    const adj = new Map();
    links.forEach(l => { (adj.get(l.a) || adj.set(l.a, []).get(l.a)).push({ to: l.b, dx: l.dx, dy: l.dy }); (adj.get(l.b) || adj.set(l.b, []).get(l.b)).push({ to: l.a, dx: -l.dx, dy: -l.dy }); });
    const seen = new Set();
    for (const [start] of adj) {
      if (seen.has(start)) continue;
      const comp = [], q = [start]; seen.add(start);
      while (q.length) { const c = q.pop(); comp.push(c); for (const e of adj.get(c)) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); } }
      const here = comp.filter(id => P.has(id));
      const moved = here.filter(id => { const p = P.get(id), ln = lastNat[id]; return ln && (Math.abs(p.nx - ln.x) > 0.05 || Math.abs(p.ny - ln.y) > 0.05); });
      if (moved.length === 1) {
        const lead = P.get(moved[0]), o0 = off[lead.id] || { x: 0, y: 0 };
        const L = new Map([[lead.id, { x: lead.nx + o0.x, y: lead.ny + o0.y }]]);
        const bq = [lead.id];
        while (bq.length) { const c = bq.shift(), Lc = L.get(c); for (const e of adj.get(c)) if (!L.has(e.to)) { L.set(e.to, { x: Lc.x + e.dx, y: Lc.y + e.dy }); bq.push(e.to); } }
        for (const [id, Lp] of L) { if (id === lead.id || !P.has(id)) continue; const p = P.get(id); off[id] = { x: Lp.x - p.nx, y: Lp.y - p.ny }; }
      }
    }
    for (const [id, p] of P) lastNat[id] = { x: p.nx, y: p.ny };
  }

  let groups = new Map(); // id -> member ids (present panels only)
  function computeGroups(P) {
    const adj = new Map();
    links.forEach(l => { if (!P.has(l.a) || !P.has(l.b)) return; (adj.get(l.a) || adj.set(l.a, new Set()).get(l.a)).add(l.b); (adj.get(l.b) || adj.set(l.b, new Set()).get(l.b)).add(l.a); });
    const g = new Map();
    for (const [start] of adj) { if (g.has(start)) continue; const comp = [], q = [start]; g.set(start, comp); while (q.length) { const c = q.pop(); comp.push(c); g.set(c, comp); for (const n of adj.get(c)) if (!g.has(n)) { g.set(n, comp); q.push(n); } } }
    return g;
  }
  // A fused seam has no gap: the second panel overlaps the first one's (transparent) seam border by exactly
  // that border's width, so one border line remains and the background never shows through. Re-checked at rest,
  // so it also repairs gaps left by sub-pixel rounding, resizes, or scale changes. Returns true when it moved a panel.
  const dropLog = [];
  let gapFixes = 0, gapFixAt = 0;
  function closeGaps(P) {
    if (performance.now() - gapFixAt > 2000) gapFixes = 0;
    if (gapFixes > 12) return false; // never fight a panel that will not settle
    const z = uiZoom();
    for (const l of links) {
      const a = P.get(l.a), b = P.get(l.b); if (!a || !b) continue;
      const s = lside(l, a, b); if (!s) continue;                 // b relative to a
      const F = (s === 'r' || s === 'b') ? a : b, S = F === a ? b : a;
      const edgeProp = { r: 'borderRightWidth', b: 'borderBottomWidth', l: 'borderLeftWidth', t: 'borderTopWidth' };
      // F's seam edge: it is the left/top panel, so its right/bottom border faces S.
      const prop = (s === 'r' || s === 'l') ? 'borderRightWidth' : 'borderBottomWidth';
      const cs = getComputedStyle(F.el);
      const ratio = (s === 'r' || s === 'l') ? F.r.width / (F.el.offsetWidth || 1) : F.r.height / (F.el.offsetHeight || 1);
      const bw = (parseFloat(cs[prop]) || 0) * ratio;
      const vertical = (s === 'r' || s === 'l');
      const gap = vertical ? S.r.left - F.r.right : S.r.top - F.r.bottom;
      // Panel-to-panel seams overlap by one border width; against the menu dock (no border of its own) they just touch.
      const widgetPair = !!(F.widget || S.widget);
      const delta = (widgetPair ? 0 : -bw) - gap;                 // move S by this (displayed px)
      if (Math.abs(delta) < 0.5) continue;
      const cnt = (id) => links.filter(k => k.a === id || k.b === id).length;
      let mover = cnt(S.id) <= cnt(F.id) ? S : F;
      if (mover.widget) { // never push the menu / HP dock off the screen: move the panel instead
        const amt = (mover === S ? 1 : -1) * delta;
        const nl = mover.r.left + (vertical ? amt : 0), nr = mover.r.right + (vertical ? amt : 0), nt = mover.r.top + (vertical ? 0 : amt), nb = mover.r.bottom + (vertical ? 0 : amt);
        if (nl < -2 || nr > innerWidth + 2 || nt < -2 || nb > innerHeight + 2) mover = mover === S ? F : S;
      }
      const sign = mover === S ? 1 : -1;
      const o = off[mover.id] || (off[mover.id] = { x: 0, y: 0 });
      if (vertical) o.x += sign * delta / z; else o.y += sign * delta / z;
      l.dx = (P.get(l.b).nx + (off[l.b] ? off[l.b].x : 0)) - (P.get(l.a).nx + (off[l.a] ? off[l.a].x : 0));
      l.dy = (P.get(l.b).ny + (off[l.b] ? off[l.b].y : 0)) - (P.get(l.a).ny + (off[l.a] ? off[l.a].y : 0));
      gapFixes++; gapFixAt = performance.now();
      style.textContent = offCss() + (style.dataset.seam || '');
      return true;
    }
    return false;
  }
  // ---- fused panels open and close together ----
  // A fused row of panels behaves like one panel: closing one closes the others, opening one opens the others. Display-only: it clicks the
  // same close button / menu-bar tab you would click yourself. Ignores minimising, and waits out the first seconds after a (re)load.
  const gOn = () => { try { const st = window.__ccPluginSettings; return !(st && st.get && st.get('fuseGroupToggle') === false); } catch (e) { return true; } };
  let gPrev = null, gLock = 0;
  const comp = (id) => {
    const seen = new Set([id]), q = [id];
    while (q.length) { const c = q.pop(); links.forEach((l) => { const o = l.a === c ? l.b : l.b === c ? l.a : null; if (o && o !== 'menudock' && !seen.has(o)) { seen.add(o); q.push(o); } }); }
    seen.delete(id); return [...seen];
  };
  const isMinimized = (id) => { const t = document.querySelector(`.panel-titlebar[data-panel-id="${CSS.escape(id)}"]`); return !!(t && t.parentElement && t.parentElement.classList.contains('panel-minimized')); };
  function groupToggle(P) {
    const now = performance.now();
    const ids = new Set([...P.keys()].filter((i) => i !== 'menudock'));
    if (!gPrev) { gPrev = ids; return; }
    if (gOn() && enabled() && now - T0 > 15000 && now > gLock && !pointerDown && links.length) {
      let acted = false;
      for (const id of gPrev) {
        if (ids.has(id) || isMinimized(id) || P.has(id)) continue;
        comp(id).forEach((m) => { if (ids.has(m)) { const b = document.querySelector(`.panel-titlebar[data-panel-id="${CSS.escape(m)}"] .panel-titlebar-close`); if (b) { b.click(); acted = true; } } });
      }
      for (const id of ids) {
        if (gPrev.has(id)) continue;
        comp(id).forEach((m) => { if (!ids.has(m) && !isMinimized(m)) { const b = document.querySelector(`.panel-tab-btn[data-tab="${CSS.escape(m)}"]`); if (b) { b.click(); acted = true; } } });
      }
      if (acted) gLock = now + 1500;
    }
    gPrev = ids;
  }
  const seam = {};  // panelId -> Set of sides ('l','r','t','b') that are fused
  function sync() {
    attach();
    if (!enabled()) { style.textContent = ''; document.querySelectorAll('.cc-fuse-btn').forEach(b => b.remove()); return; }
    const P = scan();
    if (links.length) propagate(P); else for (const [id, p] of P) lastNat[id] = { x: p.nx, y: p.ny };
    // drop links that stopped touching (checked at rest only, after a short grace)
    if (!pointerDown) {
      const before = links.length;
      links = links.filter(l => { const a = P.get(l.a), b = P.get(l.b); if (!a || !b) return true; if (performance.now() - T0 < 45000 || (l.born && performance.now() - l.born < 1500)) return true; const now = performance.now(), touchingNow = !!lside(l, a, b);
        // Panels can sit in a transitional layout for a while after a (re)inject; only give up on a fuse once
        // it has been apart continuously for several seconds.
        const sig = [a.r.left, a.r.top, b.r.left, b.r.top].map(Math.round).join(',');
        if (touchingNow || sig !== l.lastSig) { l.lastSig = sig; l.lostSince = 0; return true; } // moving = still settling, not "apart"
        if (!l.lostSince) { l.lostSince = now; return true; }
        const ok = now - l.lostSince < 30000;
        if (!ok) dropLog.push({ a: l.a, b: l.b, t: Math.round(performance.now() - T0), ra: [a.r.left, a.r.right, a.r.top, a.r.bottom].map(Math.round), rb: [b.r.left, b.r.right, b.r.top, b.r.bottom].map(Math.round) }); return ok; });
      if (links.length !== before) { save(); const inUse = new Set(); links.forEach(x => { inUse.add(x.a); inUse.add(x.b); }); Object.keys(off).forEach(id => { if (!inUse.has(id)) delete off[id]; }); }
    }
    if (!pointerDown && closeGaps(P)) { save(); return sync(); }
    groups = computeGroups(P); lastP = P;
    try { groupToggle(P); } catch (e) { /* never break the sync */ }
    Object.keys(seam).forEach(k => delete seam[k]);
    const plain = new Set();
    links.forEach(l => {
      const a = P.get(l.a), b = P.get(l.b); if (!a || !b) return;
      const s = lside(l, a, b); if (!s) return;               // where b sits relative to a
      (seam[a.id] || (seam[a.id] = new Set())).add(s);
      (seam[b.id] || (seam[b.id] = new Set())).add(OPP[s]);
      if (a.widget || b.widget) { plain.add(a.id + ':' + s); plain.add(b.id + ':' + OPP[s]); } // keep the panel's own border next to the dock
    });
    // CSS: margin offsets + seam cleanup
    let css = '';
    for (const id of Object.keys(off)) {
      if (id === 'menudock') continue; // the dock applies its own offset (translate)
      const o = off[id]; if (!o || (Math.abs(o.x) < 0.05 && Math.abs(o.y) < 0.05)) continue;
      css += `${sel(id)}{margin-left:${o.x.toFixed(2)}px !important;margin-top:${o.y.toFixed(2)}px !important}\n`;
    }
    let seamCss = '';
    const SIDE = { l: ['left', 'top-left', 'bottom-left'], r: ['right', 'top-right', 'bottom-right'], t: ['top', 'top-left', 'top-right'], b: ['bottom', 'bottom-left', 'bottom-right'] };
    for (const id of Object.keys(seam)) {
      seam[id].forEach((s) => {
        const [edge, c1, c2] = SIDE[s];
        const pre = css.length; css += `${sel(id)}{border-${c1}-radius:0 !important;border-${c2}-radius:0 !important;`;
        // One border line per seam: the panel that sits first (left/top) hides its border.
        if ((s === 'r' || s === 'b') && !plain.has(id + ':' + s)) css += `border-${edge}-color:transparent !important;`;
        css += `}\n`; seamCss += css.slice(pre);
      });
    }
    style.dataset.seam = seamCss;
    if (style.textContent !== css) style.textContent = css;
    try { window.__ccMenuDock && window.__ccMenuDock.refresh && window.__ccMenuDock.refresh(); } catch (e) {}

    // title-bar buttons
    const want = new Set();
    const ids = [...P.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      const p = P.get(ids[i]), q = P.get(ids[j]);
      const link = links.find(l => (l.a === p.id && l.b === q.id) || (l.a === q.id && l.b === p.id));
      if (!link && !touching(p, q)) continue;
      const key = p.id + '>' + q.id; want.add(key);
      const btns = p.tb.querySelector('.panel-titlebar-btns'); if (!btns) continue;
      let b = btns.querySelector(`.cc-fuse-btn[data-with="${CSS.escape(q.id)}"]`);
      if (!b) {
        b = document.createElement('button'); b.type = 'button';
        b.className = 'panel-titlebar-btn cc-fuse-btn'; b.dataset.with = q.id; b.innerHTML = LINK_SVG + '<span class="cc-fa"></span>';
        ['mousedown', 'pointerdown', 'dblclick'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
        b.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const Pn = scan(), pp = Pn.get(p.id), qq = Pn.get(q.id); if (!pp || !qq) return;
          const lk = links.find(l => (l.a === p.id && l.b === q.id) || (l.a === q.id && l.b === p.id));
          if (lk) unfuse(lk); else fuse(pp, qq);
        });
        btns.insertBefore(b, btns.firstChild);
      }
      const dir = touching(p, q) || '';
      if (b.dataset.dir !== dir) { b.dataset.dir = dir; b.querySelector('.cc-fa').textContent = { r: '\u2192', l: '\u2190', t: '\u2191', b: '\u2193' }[dir] || ''; }
      b.classList.toggle('fused', !!link);
      b.title = link ? 'Fused with ' + q.name + ' – click to separate' : 'Fuse with ' + q.name + ' (move together, cleaner seam)';
    }
    document.querySelectorAll('.cc-fuse-btn').forEach(b => {
      const tb = b.closest('.panel-titlebar, .cc-dock-grip'); const pid = tb && tb.dataset.panelId;
      if (!want.has(pid + '>' + b.dataset.with)) b.remove();
    });
    // Always read left to right as: fuse-left, fuse-up, fuse-down, fuse-right (never dependent on scan order).
    const RANK = { l: 0, t: 1, b: 2, r: 3, '': 4 };
    for (const p of P.values()) {
      const btns = p.tb.querySelector('.panel-titlebar-btns'); if (!btns) continue;
      const mine = [...btns.querySelectorAll('.cc-fuse-btn')];
      if (mine.length < 2 && (!mine.length || btns.firstChild === mine[0])) continue;
      const sorted = mine.slice().sort((x, y) => RANK[x.dataset.dir || ''] - RANK[y.dataset.dir || '']);
      const cur = [...btns.children].filter(c => c.classList.contains('cc-fuse-btn'));
      const inPlace = cur.every((c, i) => c === sorted[i]) && cur.every((c, i) => btns.children[i] === c);
      if (!inPlace) for (let i = sorted.length - 1; i >= 0; i--) btns.insertBefore(sorted[i], btns.firstChild);
    }
  }

  const css0 = document.createElement('style');
  css0.textContent = `.cc-fuse-btn{display:inline-flex;align-items:center;gap:1px}.cc-fuse-btn .cc-fa{font-size:11px;line-height:1;font-weight:700}.cc-fuse-btn{opacity:.5}.cc-fuse-btn:hover{opacity:1}.cc-fuse-btn.fused{opacity:1;color:var(--text-gold,#ffd24a)}`;
  style.dataset.base = '1';
  const baseStyle = css0; baseStyle.id = 'cc-panel-fuse-base';
  const attachBase = () => { if (document.head && !baseStyle.isConnected) document.head.appendChild(baseStyle); };
  attachBase();

  let lastP = new Map();
  // Group resizing support (used by panel-resize.js): only the bottom-right-most member keeps a handle.
  function isPrimary(id) {
    const g = groups.get(id); if (!g || g.length < 2) return true;
    let best = null;
    g.forEach(m => { const p = lastP.get(m); if (!p || p.widget) return; if (!best || p.r.right > best.r.right + 2 || (Math.abs(p.r.right - best.r.right) <= 2 && p.r.bottom > best.r.bottom)) best = p; });
    return !best || best.id === id;
  }
  const sidesOf = (id) => (seam[id] ? [...seam[id]] : []);
  const group = (id) => { const g = groups.get(id); return g && g.length > 1 ? g.filter(m => m !== 'menudock') : [id]; };
  function offCss() {
    let css = '';
    for (const id of Object.keys(off)) { if (id === 'menudock') continue; const o = off[id]; if (!o || (Math.abs(o.x) < 0.05 && Math.abs(o.y) < 0.05)) continue; css += `${sel(id)}{margin-left:${o.x.toFixed(2)}px !important;margin-top:${o.y.toFixed(2)}px !important}`+String.fromCharCode(10); }
    return css;
  }
  // Move panels (via margin offsets) so their on-screen top-left lands on the targets.
  function place(targets) {
    const z = uiZoom();
    for (let it = 0; it < 3; it++) {
      const P = scan(); let moved = false;
      for (const id of Object.keys(targets)) {
        const p = P.get(id); if (!p) continue;
        const dx = targets[id].left - p.r.left, dy = targets[id].top - p.r.top;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) { const o = off[id] || (off[id] = { x: 0, y: 0 }); o.x += dx / z; o.y += dy / z; moved = true; style.textContent = offCss() + (style.dataset.seam || ''); }
      }
      if (!moved) break;
    }
  }
  // After a group resize the logical offsets between members changed: record the new ones.
  function rebase() {
    const P = scan();
    links.forEach(l => { const a = P.get(l.a), b = P.get(l.b); if (!a || !b) return; const oa = off[l.a] || { x: 0, y: 0 }, ob = off[l.b] || { x: 0, y: 0 }; l.dx = b.nx + ob.x - (a.nx + oa.x); l.dy = b.ny + ob.y - (a.ny + oa.y); l.born = performance.now(); });
    for (const [id, p] of P) lastNat[id] = { x: p.nx, y: p.ny };
    save();
  }
  let timer = 0, raf = 0, alive = true;
  const down = () => { pointerDown = true; loop(); };
  const up = () => { pointerDown = false; setTimeout(() => { try { sync(); } catch (e) {} }, 60); };
  function loop() { if (!alive || !pointerDown) return; try { sync(); } catch (e) {} raf = requestAnimationFrame(loop); }
  function tick() { if (!alive) return; if (!document.hidden && !pointerDown) { try { sync(); } catch (e) {} } timer = setTimeout(tick, 500); }
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  tick();

  function teardown() {
    alive = false; clearTimeout(timer); cancelAnimationFrame(raf);
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    document.querySelectorAll('.cc-fuse-btn').forEach(b => b.remove());
    style.remove(); baseStyle.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc panel-fuse torn down';
  }
  function fuseIds(a, b) {
    const P = scan(), pa = P.get(a), pb = P.get(b);
    if (!pa || !pb || !touching(pb, pa) || links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return false;
    fuse(pa, pb); return true;
  }
  window[NS] = { sidesOf, dropLog, version: 2, fuseIds, teardown, isPrimary, group, place, rebase, get links() { return links.slice(); }, get off() { return Object.assign({}, off); }, sync };
  console.log('[cc] panel-fuse loaded');
  return 'cc panel-fuse loaded';
})();
