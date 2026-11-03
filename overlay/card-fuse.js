// ScapeLite panel fusing (window.__ccCardFuse). DISPLAY-ONLY: it only moves ScapeLite's own panels (the kit's .cc-panel: pinned cards, Task Queue, Chat ...).
//
// Two open panels that sit edge to edge get a small link button on their seam. Click it to FUSE them:
//   - the pair is snapped flush and the seam is cleaned up (squared corners, one border line instead of two);
//   - dragging, snapping, aligning or edge-anchoring either panel carries the whole fused group with it; resizing a panel pushes the panel glued to its far edge;
//   - click the button again to unfuse.
// The game's own panels are handled by panel-fuse.js (its own links, its own storage key); the two never touch each other.
//
// Model: a link is { a, b, side, off }. b sits to the 'r'ight of a (b.left = a.right, b.top = a.top + off) or 'b'elow it (b.top = a.bottom, b.left = a.left + off),
// so `a` is always the left / upper panel. Panels get no extra offset: their own left / top are written, like every other mover does, which keeps the kit's
// saved positions and anchor.js valid (followers' saved positions are written here once the group has settled).
// Every frame the members that moved or resized since the last frame (drag, snap, preset, anchor, scale) are the "drivers"; the rest of the group is re-laid
// from them in the same task, so a seam is never a pixel off for a visible frame.
(function () {
  'use strict';
  const NS = '__ccCardFuse';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }
  const life = window.__ccLife.scope('card-fuse');
  const qa = (s, r) => window.__ccDom.qa(s, r);

  const LS = 'cc-card-fuse-v1';
  const TOUCH = 6, MIN_OVER = 24, EPS = 0.05;   // px gap that still counts as touching, px of shared edge needed, px below which nothing moved (small, so a seam never drifts)
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const enabled = () => setting('cardFuseEnabled', true) !== false;
  const edge = () => window.__ccEdge || { top: 0, bottom: 0 };

  // ---------------------------------------------------------------- links (kept in the browser, one entry per pair of panel ids)
  let links = [];
  try { links = (JSON.parse(localStorage.getItem(LS) || '[]') || []).filter((l) => l && l.a && l.b && (l.side === 'r' || l.side === 'b') && Number.isFinite(l.off)); } catch (e) { links = []; }
  const saveLinks = () => { try { localStorage.setItem(LS, JSON.stringify(links)); } catch (e) { /* storage blocked: fuses last until reload */ } };
  const findLink = (x, y) => links.find((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));

  // ---------------------------------------------------------------- panels (a collapsed chip or a closed panel is not part of a group until it is open again)
  const isOpen = (el) => !!el && el.isConnected && el.classList.contains('show') && !el.classList.contains('min') && el.getClientRects().length > 0;
  const panelOf = (id) => { const el = document.getElementById(id); return el && el.classList.contains('cc-panel') && isOpen(el) ? el : null; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const shift = (el, dx, dy) => { if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return; el.style.left = (num(el.style.left) + dx).toFixed(2) + 'px'; el.style.top = (num(el.style.top) + dy).toFixed(2) + 'px'; };

  // the pair as { a, b, side, off } when two open panels touch along an edge, else null (a is the left / upper one)
  function touching(e1, e2) {
    const r1 = rectOf(e1), r2 = rectOf(e2);
    const pair = (A, B, ea, eb, side) => {
      const gap = side === 'r' ? B.l - A.r : B.t - A.b, over = side === 'r' ? Math.min(A.b, B.b) - Math.max(A.t, B.t) : Math.min(A.r, B.r) - Math.max(A.l, B.l);
      return Math.abs(gap) <= TOUCH && over >= MIN_OVER ? { a: ea.id, b: eb.id, side } : null;
    };
    return pair(r1, r2, e1, e2, 'r') || pair(r2, r1, e2, e1, 'r') || pair(r1, r2, e1, e2, 'b') || pair(r2, r1, e2, e1, 'b');
  }

  // ---------------------------------------------------------------- groups: connected components of the links between OPEN panels
  function components() {
    const adj = new Map(), add = (id, l) => { if (!adj.has(id)) adj.set(id, []); adj.get(id).push(l); };
    links.forEach((l) => { if (panelOf(l.a) && panelOf(l.b)) { add(l.a, l); add(l.b, l); } });
    const seen = new Set(), out = [];
    adj.forEach((_, id) => {
      if (seen.has(id)) return;
      const ids = [], stack = [id]; seen.add(id);
      while (stack.length) { const x = stack.pop(); ids.push(x); adj.get(x).forEach((l) => { const y = l.a === x ? l.b : l.a; if (!seen.has(y)) { seen.add(y); stack.push(y); } }); }
      ids.sort(); out.push({ ids, links: links.filter((l) => ids.includes(l.a) && ids.includes(l.b)) });
    });
    return out;
  }
  // the open panel ids fused with `id` (always includes it, sorted when fused); anchor.js treats the group as one unit
  function group(id) { const g = components().find((c) => c.ids.includes(id)); return g ? g.ids.slice() : [id]; }

  // ---------------------------------------------------------------- laying a group out
  // move `el` so that its box sits where the link says, given the panel it is glued to
  // The upper / left panel's seam border is transparent, so the partner overlaps it by exactly that border's width: no gap, and one border line remains.
  function seamWidth(l) {
    const A = document.getElementById(l.a); if (!A) return 0;
    const bw = parseFloat(getComputedStyle(A)[l.side === 'r' ? 'borderRightWidth' : 'borderBottomWidth']) || 0, sc = A.offsetWidth ? A.getBoundingClientRect().width / A.offsetWidth : 1;
    return bw * sc;
  }
  function place(l, el, from) {
    const R = rectOf(el), F = rectOf(from), side = l.side === 'r', sw = seamWidth(l);
    const tx = el.id === l.b ? (side ? F.r - sw : F.l + l.off) : (side ? F.l - R.w + sw : F.l - l.off);
    const ty = el.id === l.b ? (side ? F.t + l.off : F.b - sw) : (side ? F.t - l.off : F.t - R.h + sw);
    shift(el, tx - R.l, ty - R.t);
  }
  const snap = new Map();   // id -> last seen rect: tells the drivers (moved / resized panels) apart from the followers
  const sameSize = (a, b) => Math.abs(a.w - b.w) <= EPS && Math.abs(a.h - b.h) <= EPS;
  const changed = (a, b) => Math.abs(a.l - b.l) > EPS || Math.abs(a.t - b.t) > EPS || !sameSize(a, b);
  const dirty = new Set();   // followers that moved: their saved positions are written once the group settles

  function layout(g) {
    const els = new Map(g.ids.map((id) => [id, panelOf(id)])), now = new Map();
    els.forEach((el, id) => now.set(id, rectOf(el)));
    const live = g.ids.filter((id) => snap.has(id)), fresh = g.ids.length - live.length;
    let drivers = live.filter((id) => changed(snap.get(id), now.get(id)));
    // every member resized at once = the scale changed: the offsets scale with it and the first member stays put
    if (live.length > 1 && live.every((id) => !sameSize(snap.get(id), now.get(id)))) {
      g.links.forEach((l) => { const o = snap.get(l.a), n = now.get(l.a); if (o && n && o.h > 0 && o.w > 0) l.off *= l.side === 'r' ? n.h / o.h : n.w / o.w; });
      saveLinks(); drivers = [live[0]];
    }
    if (!drivers.length && fresh) drivers = live.length ? live : [g.ids[0]];   // a panel (re)opened: it joins the others; a whole group appearing at once is laid out from its first panel
    if (!drivers.length) {   // nothing moved: make sure no seam has drifted (a panel that resized between two frames) by re-laying each pair from its upper / left panel
      g.links.forEach((l) => { const b = els.get(l.b), before = rectOf(b); place(l, b, els.get(l.a)); const after = rectOf(b); if (Math.abs(after.l - before.l) > EPS || Math.abs(after.t - before.t) > EPS) { dirty.add(l.b); snap.set(l.b, after); } });
      return;
    }
    const done = new Set(drivers), queue = drivers.slice();
    while (queue.length) {
      const x = queue.shift();
      g.links.forEach((l) => {
        const y = l.a === x ? l.b : l.b === x ? l.a : null;
        if (!y || done.has(y)) return;
        done.add(y); queue.push(y);
        const el = els.get(y), before = rectOf(el); place(l, el, els.get(x));
        const after = rectOf(el); if (Math.abs(after.l - before.l) > EPS || Math.abs(after.t - before.t) > EPS) dirty.add(y);
      });
    }
    els.forEach((el, id) => snap.set(id, rectOf(el)));
  }

  // keep the whole group on screen once it has settled (a drag may carry a follower past the edge); the group moves by one delta
  function keepOnScreen(g) {
    const els = g.ids.map(panelOf).filter(Boolean); if (els.length < 2) return;
    const E = edge(), lo = E.top || 0, hi = innerHeight - (E.bottom || 0), rs = els.map(rectOf);
    const L = Math.min(...rs.map((r) => r.l)), T = Math.min(...rs.map((r) => r.t)), R = Math.max(...rs.map((r) => r.r)), B = Math.max(...rs.map((r) => r.b));
    let dx = 0, dy = 0;
    if (R - L <= innerWidth) { if (L < 0) dx = -L; else if (R > innerWidth) dx = innerWidth - R; }
    if (B - T <= hi - lo) { if (T < lo) dy = lo - T; else if (B > hi) dy = hi - B; }
    if (!dx && !dy) return;
    els.forEach((el) => { shift(el, dx, dy); dirty.add(el.id); snap.set(el.id, rectOf(el)); });
  }
  // the kit saves a panel's spot when ITS drag ends; followers never had a drag, so their spot is written here
  function saveDirty() {
    const UI = window.__ccUI;
    if (UI && UI.store) dirty.forEach((id) => { const el = document.getElementById(id); if (!el) return; const k = 'panel:' + id; UI.store.set(k, Object.assign({}, UI.store.get(k, {}), { x: num(el.style.left), y: num(el.style.top) })); });
    dirty.clear();
  }

  // ---------------------------------------------------------------- seams: squared corners on the fused sides and a link button on every seam
  // a (the left / upper panel) carries the fused side r / b, its partner l / t; the seam keeps the partner's border line only
  const CORNERS = { r: ['top-right', 'bottom-right'], l: ['top-left', 'bottom-left'], t: ['top-left', 'top-right'], b: ['bottom-left', 'bottom-right'] };
  const seamCss = Object.keys(CORNERS).map((s) => {
    const sel = '.cc-panel[data-cc-fuse~="' + s + '"]', top = CORNERS[s].filter((c) => c.startsWith('top')), bot = CORNERS[s].filter((c) => c.startsWith('bottom'));
    const rules = (el, cs) => cs.length ? el + '{' + cs.map((c) => 'border-' + c + '-radius:0').join(';') + '}' : '';
    return rules(sel, CORNERS[s]) + rules(sel + '>.hd', top) + rules(sel + '>.bd:last-of-type,' + sel + '>.ft', bot);
  }).join('\n');
  const style = document.createElement('style'); style.id = 'cc-card-fuse-style';
  style.textContent = seamCss + `
.cc-panel[data-cc-fuse~="r"]{border-right-color:transparent}
.cc-panel[data-cc-fuse~="b"]{border-bottom-color:transparent}
.cc-fuse-link{position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;display:grid;place-items:center;padding:0;border-radius:50%;border:1px solid var(--cc-border-strong,#4a4a66);background:var(--cc-bg-3,#23222f);color:var(--cc-text-dim,#9a9ab0);cursor:pointer;opacity:0;pointer-events:none;transform:scale(.8);transition:opacity .12s,transform .12s,background .12s,color .12s}
.cc-fuse-link.vis{opacity:1;pointer-events:auto;transform:none}
.cc-fuse-link.on{background:var(--cc-accent,#ffd24a);border-color:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#241a00)}
.cc-fuse-link svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
`;
  document.head.appendChild(style);
  const SVG = '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

  const pool = [];   // one button per seam, reused between passes
  let seams = [];    // [{ p, pt }] of the last render
  function button(i) {
    if (pool[i]) return pool[i];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cc-fuse-link'; b.innerHTML = SVG;
    b.addEventListener('mousedown', (e) => e.stopPropagation());   // the panel underneath must not come to the front or start a drag
    b.addEventListener('click', (e) => { e.stopPropagation(); toggle(b._pair); });
    document.body.appendChild(b); return (pool[i] = b);
  }
  function seamPoint(p) {
    const A = panelOf(p.a), B = panelOf(p.b); if (!A || !B) return null;
    const a = rectOf(A), b = rectOf(B);
    return p.side === 'r' ? { x: (a.r + b.l) / 2, y: (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2 } : { x: (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2, y: (a.b + b.t) / 2 };
  }
  function markSeams() {
    const sides = new Map(), add = (id, s) => sides.set(id, (sides.get(id) || '') + ' ' + s);
    if (enabled()) components().forEach((g) => g.links.forEach((l) => { add(l.a, l.side); add(l.b, l.side === 'r' ? 'l' : 't'); }));
    qa('.cc-panel[data-cc-fuse]').forEach((el) => { if (!sides.has(el.id)) el.removeAttribute('data-cc-fuse'); });
    sides.forEach((s, id) => { const el = document.getElementById(id); if (el && el.dataset.ccFuse !== s.trim()) el.dataset.ccFuse = s.trim(); });
  }
  // the seams worth a button: every fused pair, plus every pair of open panels that currently touch (not while a mouse button is down)
  function candidates(pressed) {
    const out = [], seen = new Set();
    links.forEach((l) => { if (panelOf(l.a) && panelOf(l.b)) { out.push({ a: l.a, b: l.b, side: l.side, fused: true }); seen.add(l.a + '|' + l.b); } });
    if (pressed) return out;
    const open = qa('.cc-panel').filter((el) => el.id && isOpen(el));
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
      const p = touching(open[i], open[j]);
      if (p && !seen.has(p.a + '|' + p.b) && !findLink(p.a, p.b)) out.push(Object.assign(p, { fused: false }));
    }
    return out;
  }
  // Buttons stay out of the way: one shows for a few seconds when a move just made two panels fusable, and while the pointer is near a seam of two unlocked panels.
  const locked = (id) => { const el = document.getElementById(id); return !el || el.hasAttribute('data-cc-locked'); };
  const OFFER_MS = 4500, NEAR = 46;
  const offered = new Map();   // pair key -> until (ms)
  let mouse = { x: -1e9, y: -1e9 };
  const zOf = (id) => { const el = document.getElementById(id); return el ? (parseInt(el.style.zIndex || getComputedStyle(el).zIndex, 10) || 0) : 0; };
  function showing(s) {
    const k = s.p.a + '|' + s.p.b;
    if (locked(s.p.a) || locked(s.p.b)) return false;
    if (Math.hypot(mouse.x - s.pt.x, mouse.y - s.pt.y) <= NEAR) return true;
    return !s.p.fused && (offered.get(k) || 0) > performance.now();
  }
  function paint() {
    seams.forEach((s, i) => {
      const b = pool[i]; if (!b) return;
      b.classList.toggle('vis', showing(s)); b.style.zIndex = String(Math.max(zOf(s.p.a), zOf(s.p.b)) + 1);   // just above the two panels it joins, below anything stacked over them
    });
  }
  function render(pressed) {
    markSeams();
    seams = enabled() ? candidates(pressed).map((p) => ({ p, pt: seamPoint(p) })).filter((s) => s.pt) : [];
    seams.forEach((s, i) => {
      const b = button(i), t = s.p.fused ? 'Unfuse these panels' : 'Fuse these panels so they move together';
      b._pair = s.p; b.style.display = ''; b.style.left = Math.round(s.pt.x) + 'px'; b.style.top = Math.round(s.pt.y) + 'px';
      b.classList.toggle('on', s.p.fused); if (b.title !== t) b.title = t;
    });
    for (let i = seams.length; i < pool.length; i++) { pool[i].style.display = 'none'; pool[i]._pair = null; }
    paint();
  }

  // ---------------------------------------------------------------- fuse / unfuse
  const forgetAnchors = (ids) => { try { ids.forEach((id) => window.__ccAnchor && window.__ccAnchor.forget && window.__ccAnchor.forget('s:' + id)); } catch (e) { /* anchors start over on their own */ } };   // the unit changed shape: its edge distances are measured again
  function toggle(p) {
    if (!p) return;
    const old = findLink(p.a, p.b);
    if (old) { links = links.filter((l) => l !== old); [p.a, p.b].forEach((id) => snap.delete(id)); saveLinks(); forgetAnchors([p.a, p.b]); render(false); return; }
    const A = panelOf(p.a), B = panelOf(p.b); if (!A || !B) return;
    const l = { a: p.a, b: p.b, side: p.side, off: 0 };
    // flush: a panel that already belongs to a group stays, the loose one moves to meet it; two groups: b's whole group moves
    const gA = group(p.a), gB = group(p.b), moveA = gB.length > 1 && gA.length < 2;
    const mover = moveA ? gA : gB, el = moveA ? A : B, from = moveA ? B : A, R0 = rectOf(el);
    place(l, el, from);
    const R1 = rectOf(el), dx = R1.l - R0.l, dy = R1.t - R0.t;
    mover.forEach((id) => { const m = document.getElementById(id); if (m && m !== el) shift(m, dx, dy); dirty.add(id); snap.set(id, m ? rectOf(m) : null); });
    const ra = rectOf(A), rb = rectOf(B); l.off = Math.round((p.side === 'r' ? rb.t - ra.t : rb.l - ra.l) * 100) / 100;
    links.push(l); [p.a, p.b].forEach((id) => snap.set(id, rectOf(document.getElementById(id)))); saveLinks(); saveDirty(); forgetAnchors(gA.concat(gB)); render(false);
  }

  // ---------------------------------------------------------------- opening and closing together (Settings > Panels, and the panel's right-click menu)
  const closeTogether = () => setting('cardFuseCloseTogether', false) === true;
  const wasShown = new Map();
  function component(id) {   // every panel fused with id, open or not
    const out = new Set([id]), stack = [id];
    while (stack.length) { const x = stack.pop(); links.forEach((l) => { const y = l.a === x ? l.b : l.b === x ? l.a : null; if (y && !out.has(y)) { out.add(y); stack.push(y); } }); }
    return Array.from(out);
  }
  function closeWatch() {
    const ids = new Set(); links.forEach((l) => { ids.add(l.a); ids.add(l.b); });
    ids.forEach((id) => {
      const el = document.getElementById(id), shown = !!el && el.classList.contains('show'), was = wasShown.get(id);
      wasShown.set(id, shown);
      if (!closeTogether() || was === undefined || was === shown || (el && el.classList.contains('min'))) return;
      // one panel of a group opened or closed: the rest follow (a panel that is only collapsed does not count)
      component(id).forEach((o) => { if (o === id) return; const api = window.__ccUI && window.__ccUI.panels && window.__ccUI.panels[o]; if (api && api.isShown() !== shown) { wasShown.set(o, shown); api.setOpen(shown); } });
    });
  }
  // the entries ui-scale adds to a panel's right-click menu
  function menuItems(id) {
    if (!enabled() || !document.getElementById(id) || !document.getElementById(id).classList.contains('cc-panel')) return [];
    const items = [{ head: 'Fusing' }, { label: 'Open and close fused panels together', checked: closeTogether(), onClick: () => { try { window.__ccPluginSettings.set('cardFuseCloseTogether', !closeTogether()); } catch (e) { /* not saved */ } } }];
    if (links.some((l) => l.a === id || l.b === id)) items.push({ label: 'Unfuse this panel from its neighbours', onClick: () => unfuse(id) });
    return items;
  }
  function unfuse(id) { links = links.filter((l) => l.a !== id && l.b !== id); snap.delete(id); saveLinks(); forgetAnchors([id]); render(false); }

  // ---------------------------------------------------------------- the loop
  let pressed = false, settleAt = 0, mvRaf = 0;
  function frame() {
    if (!enabled()) { if (snap.size || seams.length) { snap.clear(); render(false); } return; }
    closeWatch();
    const groups = components(); groups.forEach(layout);
    const inGroup = new Set(); groups.forEach((g) => g.ids.forEach((id) => inGroup.add(id)));
    Array.from(snap.keys()).forEach((id) => { if (!inGroup.has(id)) snap.delete(id); });   // a panel that left its group comes back as a follower
    if (!pressed && settleAt && performance.now() >= settleAt) { settleAt = 0; groups.forEach(keepOnScreen); saveDirty(); }
    seams.forEach((s, i) => { const pt = s.p.fused ? seamPoint(s.p) : null, b = pool[i]; if (pt && b) { b.style.left = Math.round(pt.x) + 'px'; b.style.top = Math.round(pt.y) + 'px'; s.pt = pt; } });   // buttons ride along with their seam
    if (seams.length) paint();
  }
  const safe = (fn) => () => { try { fn(); } catch (e) { /* never break the page */ } };
  life.frame(safe(frame), { hz: 60 });
  life.every(250, safe(() => { if (!pressed) render(false); }));
  life.on(document, 'mousedown', (e) => { if (e.button === 0 && !(e.target.closest && e.target.closest('.cc-fuse-link'))) { pressed = true; render(true); } }, true);
  life.on(document, 'mouseup', () => {
    pressed = false; settleAt = performance.now() + 120;
    life.after(200, safe(() => { render(false); const until = performance.now() + OFFER_MS; seams.forEach((s) => { if (!s.p.fused) { const k = s.p.a + '|' + s.p.b; if (!(offered.get(k) > performance.now())) offered.set(k, until); } }); paint(); }));
  }, true);
  life.on(document, 'mousemove', (e) => { mouse = { x: e.clientX, y: e.clientY }; if (!mvRaf) mvRaf = requestAnimationFrame(() => { mvRaf = 0; safe(paint)(); }); }, true);
  life.on(window, 'blur', () => { pressed = false; });
  life.on(window, 'resize', () => { settleAt = performance.now() + 400; });
  life.add(() => { cancelAnimationFrame(mvRaf); pool.forEach((b) => b.remove()); style.remove(); qa('.cc-panel[data-cc-fuse]').forEach((el) => el.removeAttribute('data-cc-fuse')); });
  safe(() => render(false))();

  function teardown() { try { life.dispose(); } catch (e) { /* nothing left to undo */ } if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc card-fuse torn down'; }
  window[NS] = {
    version: 2, teardown, enabled, group, menuItems, unfuse, refresh: safe(() => render(false)),
    fused: (x, y) => !!findLink(x, y),
    links: () => links.map((l) => Object.assign({}, l)),
    clear() { links = []; snap.clear(); saveLinks(); render(false); },
  };
  return 'cc card-fuse loaded';
})();
