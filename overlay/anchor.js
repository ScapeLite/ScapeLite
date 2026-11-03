// ScapeLite edge anchoring (window.__ccAnchor). Core plugin. Keeps floating panels in the same place RELATIVE TO THE SCREEN EDGES when the window changes size.
//
// The rule: every floating panel remembers its distance to the nearest horizontal edge (left or right) and the nearest vertical edge (top or bottom) of the
// screen. A panel in the bottom-right corner stays that far from the right and bottom edge however the window is resized; shrink the window and grow it
// again and the panel is back where it was, because the remembered distances are never overwritten by the squeeze.
//
// What it manages (one rule for all of them):
//   - every ScapeLite panel: kit panels, cards, chat, the task queue, Route Advisor, XP tracker, the alert bell ...
//   - the game's own floating panels (fused panels move together as one unit; they keep their seams)
//
// How it decides what is "the player moved it" and what is "the window changed":
//   - the remembered distances are re-read only when a panel was moved or resized while the window size stayed the same (a drag, the layout editor ...);
//   - when the window size, the info bars or a panel's scaled size changes, the panel is PLACED from its remembered distances instead (clamped on screen,
//     but the clamped spot is never remembered).
// Distances are kept in the browser (cc-anchors-v1), so they also hold between sessions with different window sizes. Display only: it only moves panels.
(function () {
  'use strict';
  const NS = '__ccAnchor';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }
  const life = window.__ccLife.scope('anchor');

  const LS = 'cc-anchors-v1', SETTLE_MS = 2500, TOL = 0.6;
  const SL_IDS = ['cc-route-panel', 'cc-xp-tracker', 'cc-lever-panel', 'cc-matshort', 'cc-goals', 'cc-droplog', 'cc-treeadv', 'cc-alertbell'];
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const enabled = () => setting('anchorEnabled', true) !== false;
  const edge = () => window.__ccEdge || { top: 0, bottom: 0 };

  // ---------------------------------------------------------------- remembered anchors
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { saved = {}; }
  let saveT = 0;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (e) { /* storage full or blocked */ } }, 400); };

  const states = new WeakMap();   // element (the unit's leader) -> { key, ax, dx, ay, dy, L, T, w, h, vk }

  // ---------------------------------------------------------------- geometry
  const viewKey = () => { const E = edge(); return innerWidth + 'x' + innerHeight + '|' + (E.top || 0) + '|' + (E.bottom || 0); };
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const visible = (el) => el.isConnected && el.getClientRects().length > 0;
  function unionRect(els) {
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    els.forEach((e) => { const q = e.getBoundingClientRect(); if (!(q.width > 0 && q.height > 0)) return; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
    return r > l ? { left: l, top: t, width: r - l, height: b - t } : null;
  }
  // distances to the nearest horizontal / vertical screen edge, measured to the physical edges of the window
  function deriveAnchor(R) {
    const W = innerWidth, H = innerHeight, gl = R.left, gr = W - (R.left + R.width), gt = R.top, gb = H - (R.top + R.height);
    return { ax: gl <= gr ? 'l' : 'r', dx: gl <= gr ? gl : gr, ay: gt <= gb ? 't' : 'b', dy: gt <= gb ? gt : gb };
  }
  // where a box of w x h goes for an anchor; strict = it must fit on screen (a placement after the window changed), else only a part must stay reachable
  function target(a, w, h, strict) {
    const W = innerWidth, H = innerHeight, E = edge(), lo = E.top || 0, bb = H - (E.bottom || 0);
    let x = a.ax === 'l' ? a.dx : W - w - a.dx, y = a.ay === 't' ? a.dy : H - h - a.dy;
    if (strict && w <= W - 8) x = Math.max(0, Math.min(W - w, x)); else x = Math.max(80 - w, Math.min(W - 80, x));
    if (strict && h <= bb - lo) y = Math.max(lo, Math.min(bb - h, y));
    else { y = Math.max(lo, y); if (E.bottom && h <= bb - lo) y = Math.min(bb - h, y); y = Math.min(H - 40, y); }
    if (E.bottom && bb - (y + h) > 0 && bb - (y + h) <= 10) y = bb - h;   // close to a bar: flush against it
    if (E.top && y - lo > 0 && y - lo <= 10) y = lo;
    return { x, y };
  }

  // ---------------------------------------------------------------- the units: a ScapeLite panel, a game panel or a fused group of game panels
  function discover() {
    const units = new Map();
    const addSL = (el) => {
      if (!el) return; const name = el.id || el.dataset.ccPanel; if (!name || units.has('s:' + name)) return;
      if (!visible(el) || getComputedStyle(el).position === 'static' || num(el.style.left) == null || num(el.style.top) == null) return;
      units.set('s:' + name, { key: 's:' + name, els: [el], game: false });
    };
    window.__ccDom.qa('.cc-panel,[data-cc-panel]').forEach(addSL);
    SL_IDS.forEach((id) => addSL(document.getElementById(id)));
    // fused ScapeLite panels (card-fuse.js) are one unit, like fused game panels: they keep their seams and share one remembered anchor
    const cf = window.__ccCardFuse, folded = new Set();
    if (cf && cf.group) Array.from(units.keys()).forEach((k) => {
      if (folded.has(k)) return;
      let ids = [k.slice(2)]; try { ids = cf.group(ids[0]); } catch (e) { /* no fuse */ }
      const ks = ids.map((i) => 's:' + i).filter((i) => units.has(i)).sort();
      if (ks.length < 2) return;
      const els = ks.map((i) => units.get(i).els[0]); ks.forEach((i) => { folded.add(i); units.delete(i); });
      units.set(ks[0], { key: ks[0], els, game: false });
    });
    const u = document.getElementById('ui-container');
    if (u) {
      const byId = new Map();
      for (const c of u.children) {
        if (!c.classList.contains('panel-floating') || c.classList.contains('panel-min-attached') || !visible(c)) continue;   // the HUD strips and attached panels are placed by the game itself
        let tb = null; for (const k of c.children) if (k.classList.contains('panel-titlebar')) { tb = k; break; }
        const pid = tb && tb.dataset.panelId; if (!pid || num(c.style.left) == null || num(c.style.top) == null) continue;
        byId.set(pid, c);
      }
      const done = new Set();
      byId.forEach((el, pid) => {
        if (done.has(pid)) return;
        let ids = [pid]; try { const g = window.__ccFuse && window.__ccFuse.group && window.__ccFuse.group(pid); if (g && g.length > 1) ids = g; } catch (e) { /* no fuse */ }
        const els = ids.map((i) => byId.get(i)).filter(Boolean); ids.forEach((i) => done.add(i));
        if (els.length) units.set('g:' + ids.filter((i) => byId.has(i)).sort().join('+'), { key: 'g:' + ids.filter((i) => byId.has(i)).sort()[0], els, game: true });
      });
    }
    return units;
  }
  // style units per visual px: a game panel sits in a zoomed / squeezed container
  const gainOf = (el) => { const p = el.parentElement; if (!p || p === document.body) return 1; const w = p.offsetWidth; const g = w ? p.getBoundingClientRect().width / w : 1; return g > 0.2 && g < 5 ? g : 1; };

  // Move a unit so its union box lands on (x, y). Safe against elements that do not follow left/top (centred by CSS, clamped by the game ...):
  // when a panel does not respond the move is undone and the panel is left alone from then on.
  function moveTo(unit, x, y, st) {
    const orig = unit.els.map((el) => [el.style.left, el.style.top]);
    const R0 = unionRect(unit.els); if (!R0) return false;
    for (let it = 0; it < 3; it++) {
      const R = unionRect(unit.els); if (!R) break;
      const dx = x - R.left, dy = y - R.top; if (Math.abs(dx) < TOL && Math.abs(dy) < TOL) return true;
      unit.els.forEach((el) => {
        const g = Math.max(0.5, Math.min(2, st.gain || gainOf(el))), L = num(el.style.left) || 0, T = num(el.style.top) || 0;
        el.style.left = (L + dx / g).toFixed(2) + 'px'; el.style.top = (T + dy / g).toFixed(2) + 'px';
      });
      const R2 = unionRect(unit.els); if (!R2) break;
      const sx = R2.left - R.left, sy = R2.top - R.top;
      if (it === 0 && ((Math.abs(dx) > 8 && Math.abs(sx) < 0.2 * Math.abs(dx)) || (Math.abs(dy) > 8 && Math.abs(sy) < 0.2 * Math.abs(dy)))) {   // it did not move: not ours to place
        unit.els.forEach((el, i) => { el.style.left = orig[i][0]; el.style.top = orig[i][1]; }); st.stuck = true; return false;
      }
      if (it === 0) { const g0 = st.gain || gainOf(unit.els[0]); if (Math.abs(dx) > 4 && Math.abs(sx) > 0.1) st.gain = Math.max(0.5, Math.min(2, g0 * dx / sx)); else if (Math.abs(dy) > 4 && Math.abs(sy) > 0.1) st.gain = Math.max(0.5, Math.min(2, g0 * dy / sy)); }
    }
    return true;
  }

  // ---------------------------------------------------------------- the pass
  let vk = '', vkAt = 0, down = false, downAt = 0;
  function pass() {
    if (!enabled() || down) return;
    const now = performance.now(), key = viewKey();
    if (key !== vk) { vk = key; vkAt = now; }
    const settling = now - vkAt < SETTLE_MS && downAt < vkAt;   // the window just changed and the player has not touched anything since
    discover().forEach((unit) => {
      const lead = unit.els[0], R = unionRect(unit.els); if (!R) return;
      let st = states.get(lead); if (st && st.stuck) return;
      const L = num(lead.style.left), T = num(lead.style.top);
      if (!st || st.key !== unit.key) {
        const rec = saved[unit.key];
        st = rec ? { key: unit.key, ax: rec.ax, dx: rec.dx, ay: rec.ay, dy: rec.dy, L, T, w: R.width, h: R.height, vk: '' } : Object.assign({ key: unit.key, L, T, w: R.width, h: R.height, vk }, deriveAnchor(R));
        states.set(lead, st);
        if (!rec) { saved[unit.key] = { ax: st.ax, dx: Math.round(st.dx), ay: st.ay, dy: Math.round(st.dy) }; persist(); }
      }
      const posMoved = Math.abs(L - st.L) > TOL || Math.abs(T - st.T) > TOL, sizeMoved = Math.abs(R.width - st.w) > 1 || Math.abs(R.height - st.h) > 1, viewMoved = st.vk !== vk;
      if (viewMoved || (settling && (posMoved || sizeMoved))) {
        // the window (or the scale that follows it) changed: place from the remembered distances
        const t = target(st, R.width, R.height, true); moveTo(unit, t.x, t.y, st);
        const R2 = unionRect(unit.els) || R; st.L = num(lead.style.left); st.T = num(lead.style.top); st.w = R2.width; st.h = R2.height; st.vk = vk;
      } else if (posMoved || sizeMoved) {
        // moved or resized by the player (or a layout action) while the window stayed the same: these are the new distances
        Object.assign(st, deriveAnchor(R)); st.L = L; st.T = T; st.w = R.width; st.h = R.height;
        saved[unit.key] = { ax: st.ax, dx: Math.round(st.dx), ay: st.ay, dy: Math.round(st.dy), vw: innerWidth, vh: innerHeight }; persist();
      } else {
        // at rest: only keep it reachable (bars appearing, a panel growing). The anchor is not touched.
        const t = target({ ax: 'l', dx: R.left, ay: 't', dy: R.top }, R.width, R.height, false);
        if (Math.abs(t.x - R.left) > TOL || Math.abs(t.y - R.top) > TOL) { moveTo(unit, t.x, t.y, st); const R2 = unionRect(unit.els) || R; st.L = num(lead.style.left); st.T = num(lead.style.top); st.w = R2.width; st.h = R2.height; }
      }
    });
  }
  const safe = () => { try { pass(); } catch (e) { /* never break the page */ } };

  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; safe(); }); };
  life.on(window, 'resize', soon);
  life.on(document, 'pointerdown', () => { down = true; downAt = performance.now(); }, true);
  life.on(document, 'pointerup', () => { down = false; setTimeout(safe, 90); }, true);
  life.on(document, 'pointercancel', () => { down = false; }, true);
  life.on(window, 'blur', () => { down = false; });
  life.every(250, safe);
  life.add(() => { cancelAnimationFrame(raf); clearTimeout(saveT); });
  safe();

  function teardown() { life.dispose(); if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc anchor torn down'; }
  window[NS] = {
    version: 1, teardown, enabled, refresh: safe,
    forget(key) { if (key) delete saved[key]; else saved = {}; persist(); },   // a panel that was reset to its default spot starts over
    info() { const out = {}; discover().forEach((u, k) => { const st = states.get(u.els[0]); if (st) out[k] = { ax: st.ax, dx: Math.round(st.dx), ay: st.ay, dy: Math.round(st.dy) }; }); return out; },
  };
  return 'cc anchor loaded';
})();
