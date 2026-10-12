// Scapewatch World Map route improver. DISPLAY-ONLY: it never clicks or
// changes anything in the game, it only changes how the game's already-drawn
// route legs are PAINTED.
//
// The map's coloured route (Ue._drawRouteLegs in game.*.js) strokes each queue
// leg as a dashed polyline (dash [12,8], round caps = the "pills"), legs painted
// in queue order, so overlapping legs hide each other and the dash gaps hide the
// colour underneath. This plugin, while the Plugins toggle "Map Route Lanes &
// Arrows" is on:
//   - wraps the map canvas's own 2D context INSTANCE (no prototype patching;
//     teardown is a plain `delete`) to recognise those route strokes and
//     suppress them,
//   - redraws the legs on its own canvas inserted directly BELOW the game's map
//     canvas (icons and the player dot stay on top, pointer-events:none so pan /
//     zoom still work), where legs that run along the same road are split into
//     parallel lanes (lane order = queue order) and the dash pills are replaced
//     by ">" chevrons travelling in the direction of travel.
// Research + prototype by an agent, tested on a synthetic canvas with the real
// queue legs; see overlay/README.md "Map route lanes". Depends on the game's
// dash constants [12,8]; if they change it silently does nothing (the game's
// own strokes pass through untouched).
(() => {
  'use strict';
  const NS = '__ccMapRoutes';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const CFG = { STEP: 3, R: 3.2, COS: 0.7, SPACING: 34, SPEED: 38, SMOOTH: 4 };
  let ctx = null, proto = null, mine = null, mctx = null, own = [], cv = null;
  let cur = null, legs = [], queued = false, cache = null;
  const stats = { frames: 0, recompute: 0, legs: 0, lastMs: 0, maxLane: 0 };

  function zoomOf() {
    try {
      const im = document.querySelector('.map-overlay-img');
      const m = /scale\(([\d.]+)\)/.exec(im.style.transform || '');
      return m ? +m[1] : 1;
    } catch (e) { return 1; }
  }

  // --- geometry -----------------------------------------------------------
  function resample(pts, step) {
    const out = [pts[0].slice()];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      let s = step - carry;
      while (s <= len) { out.push([ax + dx * s / len, ay + dy * s / len]); s += step; }
      carry = len - (s - step);
    }
    const l = pts[pts.length - 1], o = out[out.length - 1];
    if (Math.hypot(l[0] - o[0], l[1] - o[1]) > 0.5) out.push(l.slice());
    return out;
  }
  function tangents(P) {
    const T = [];
    for (let k = 0; k < P.length; k++) {
      const a = P[Math.max(0, k - 2)], b = P[Math.min(P.length - 1, k + 2)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1;
      T.push([tx / l, ty / l]);
    }
    return T;
  }
  function hashLegs(L) {
    const bx = L[0].pts[0][0], by = L[0].pts[0][1];
    let h = 2166136261 >>> 0;
    const mix = v => { h ^= (v | 0) & 0xffff; h = Math.imul(h, 16777619) >>> 0; };
    for (const l of L) {
      mix(l.pts.length); mix(l.lw * 10);
      for (const p of l.pts) { mix(Math.round((p[0] - bx) * 4)); mix(Math.round((p[1] - by) * 4)); }
    }
    return h;
  }

  // Lane assignment: for every resampled point of leg i, find legs j!=i that run parallel within R px.
  function compute(L) {
    const t0 = performance.now();
    const P = L.map(l => resample(l.pts, CFG.STEP));
    const T = P.map(tangents);
    const cell = CFG.R * 2, grid = new Map();
    P.forEach((pts, j) => pts.forEach((p, k) => {
      const key = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
      let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(j, k);
    }));
    const lw = L.reduce((m, l) => Math.max(m, l.lw), 6);
    const lane = Math.max(10, lw * 1.15);
    let maxLane = 1;
    const out = P.map((pts, i) => {
      const off = new Array(pts.length).fill(0);
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], t = T[i][k], cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
        const set = new Set([i]);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const arr = grid.get((cx + a) + ',' + (cy + b)); if (!arr) continue;
          for (let q = 0; q < arr.length; q += 2) {
            const j = arr[q]; if (j === i || set.has(j)) continue;
            const pj = P[j][arr[q + 1]];
            if (Math.hypot(pj[0] - p[0], pj[1] - p[1]) > CFG.R) continue;
            const tj = T[j][arr[q + 1]];
            if (Math.abs(tj[0] * t[0] + tj[1] * t[1]) < CFG.COS) continue;
            set.add(j);
          }
        }
        if (set.size > 1) {
          const s = [...set].sort((x, y) => x - y);
          off[k] = (s.indexOf(i) - (s.length - 1) / 2) * lane;
          if (s.length > maxLane) maxLane = s.length;
        }
      }
      // smooth lane changes
      const sm = off.slice();
      for (let k = 0; k < off.length; k++) {
        let s = 0, n = 0;
        for (let d = -CFG.SMOOTH; d <= CFG.SMOOTH; d++) { const q = k + d; if (q >= 0 && q < off.length) { s += off[q]; n++; } }
        sm[k] = s / n;
      }
      // offset points along canonical (undirected) normal so opposite-direction legs share a lane frame
      const op = pts.map((p, k) => {
        let [tx, ty] = T[i][k];
        if (tx < 0 || (Math.abs(tx) < 1e-9 && ty < 0)) { tx = -tx; ty = -ty; }
        return [p[0] - ty * sm[k], p[1] + tx * sm[k]];
      });
      const cum = [0];
      for (let k = 1; k < op.length; k++) cum.push(cum[k - 1] + Math.hypot(op[k][0] - op[k - 1][0], op[k][1] - op[k - 1][1]));
      return { op, cum };
    });
    stats.maxLane = maxLane; stats.recompute++; stats.lastMs = performance.now() - t0;
    return { out, base: L[0].pts[0] };
  }

  // --- drawing ------------------------------------------------------------
  function chevron(c, x, y, ux, uy, h) {
    const nx = -uy, ny = ux;
    c.beginPath();
    c.moveTo(x - ux * h * 1.1 + nx * h, y - uy * h * 1.1 + ny * h);
    c.lineTo(x + ux * h * 0.5, y + uy * h * 0.5);
    c.lineTo(x - ux * h * 1.1 - nx * h, y - uy * h * 1.1 - ny * h);
    c.stroke();
  }
  function render() {
    queued = false;
    if (!mine) return;
    if (mine.width !== cv.width || mine.height !== cv.height) { mine.width = cv.width; mine.height = cv.height; }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mine.width, mine.height);
    const L = legs; legs = [];
    stats.legs = L.length; stats.frames++;
    if (!L.length) return;
    const sig = hashLegs(L);
    if (!cache || cache.sig !== sig) { cache = compute(L); cache.sig = sig; }
    const dx = L[0].pts[0][0] - cache.base[0], dy = L[0].pts[0][1] - cache.base[1];
    const z = zoomOf(), k = Math.max(0.8, Math.min(1.5, 0.75 + 0.25 * z));
    const lw = L.reduce((m, l) => Math.max(m, l.lw), 6);
    const half = Math.max(3.5, lw * 0.38) * k, spacing = CFG.SPACING * k;
    const dir = L[0].off === 0 ? 0 : (L[0].off > 0 ? -1 : 1);       // game: static / reverse / forward
    const phase = ((performance.now() / 1000) * CFG.SPEED * dir % spacing + spacing) % spacing;
    mctx.save(); mctx.translate(dx, dy);
    mctx.lineJoin = 'round'; mctx.lineCap = 'round';
    // pass 1: casings + coloured base lines
    cache.out.forEach((o, i) => {
      const op = o.op; if (op.length < 2) return;
      const path = () => { mctx.beginPath(); mctx.moveTo(op[0][0], op[0][1]); for (let q = 1; q < op.length; q++) mctx.lineTo(op[q][0], op[q][1]); };
      path(); mctx.strokeStyle = 'rgba(0,0,0,0.55)'; mctx.lineWidth = 5.5 * k; mctx.stroke();
      path(); mctx.strokeStyle = L[i].color; mctx.globalAlpha = 0.55; mctx.lineWidth = 3 * k; mctx.stroke(); mctx.globalAlpha = 1;
    });
    // pass 2: chevrons (>) travelling in route direction
    cache.out.forEach((o, i) => {
      const { op, cum } = o; if (op.length < 2) return;
      const total = cum[cum.length - 1];
      let seg = 1;
      for (let s = phase; s < total; s += spacing) {
        while (seg < cum.length - 1 && cum[seg] < s) seg++;
        const a = op[seg - 1], b = op[seg], sl = cum[seg] - cum[seg - 1] || 1, f = (s - cum[seg - 1]) / sl;
        const ux = (b[0] - a[0]) / sl, uy = (b[1] - a[1]) / sl;
        const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        mctx.strokeStyle = 'rgba(0,0,0,0.75)'; mctx.lineWidth = 5.5 * k; chevron(mctx, x, y, ux, uy, half);
        mctx.strokeStyle = L[i].color; mctx.lineWidth = 3 * k; chevron(mctx, x, y, ux, uy, half);
      }
    });
    mctx.restore();
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(render); } }   // runs right after the game's rAF callback

  // --- install / teardown ---------------------------------------------------
  function install(canvas) {
    cv = canvas || document.querySelector('canvas.map-overlay-canvas:not(.mrp-route)');
    if (!cv) return false;
    ctx = cv.getContext('2d'); proto = Object.getPrototypeOf(ctx);
    mine = document.createElement('canvas');
    mine.className = cv.className + ' mrp-route';
    mine.width = cv.width; mine.height = cv.height;
    mine.style.pointerEvents = 'none';
    cv.parentNode.insertBefore(mine, cv);                       // below game canvas => icons stay on top
    mctx = mine.getContext('2d');
    const wrap = (n, f) => { ctx[n] = f; own.push(n); };
    wrap('beginPath', function () { cur = []; return proto.beginPath.call(this); });
    wrap('moveTo', function (x, y) { if (cur) cur.push([x, y]); return proto.moveTo.call(this, x, y); });
    wrap('lineTo', function (x, y) { if (cur) cur.push([x, y]); return proto.lineTo.call(this, x, y); });
    wrap('clearRect', function () { legs = []; schedule(); return proto.clearRect.apply(this, arguments); });
    wrap('stroke', function () {
      const d = this.getLineDash();
      if (cur && cur.length >= 2 && d.length === 2 && d[0] === 12 && d[1] === 8 && this.lineWidth >= 6 && typeof this.strokeStyle === 'string') {
        legs.push({ color: this.strokeStyle, pts: cur, lw: this.lineWidth, off: this.lineDashOffset });
        schedule(); return;                                    // suppress the original dashed pills
      }
      return proto.stroke.apply(this, arguments);
    });
    return true;
  }
  function teardown() {
    for (const n of own) { try { delete ctx[n]; } catch (e) {} }
    own = []; legs = []; cur = null; cache = null;
    if (mine && mine.parentNode) mine.parentNode.removeChild(mine);
    mine = null; mctx = null; ctx = null; cv = null;
  }

  // --- lifecycle: follow the Plugins toggle and the map canvas ----------------
  const settingOn = (key, def) => {
    try { const s = window.__ccPluginSettings; if (s && s.get) { const v = s.get(key); return v === undefined ? def : v; } } catch (e) {}
    return def;
  };
  let installed = false, timer = null;
  function sync() {
    try {
      const want = settingOn('mapRouteLanes', true);
      const canvas = document.querySelector('canvas.map-overlay-canvas:not(.mrp-route)');
      if (installed && (!want || !canvas || canvas !== cv || !cv.isConnected)) { teardownInner(); installed = false; }
      if (!installed && want && canvas) installed = install(canvas);
    } catch (e) { /* never break the page */ }
    timer = setTimeout(sync, 1000);
  }
  function teardownInner() { teardown(); }
  sync();

  window[NS] = {
    version: 1, stats, CFG,
    get installed() { return installed; },
    isClean: () => ctx ? Object.getOwnPropertyNames(ctx).length === 0 : true,
    teardown() {
      clearTimeout(timer);
      try { teardownInner(); } catch (e) {}
      installed = false;
      if (window[NS] && window[NS].teardown === this.teardown) delete window[NS];
      return 'cc map-routes torn down';
    },
  };
  console.log('[cc] map-routes loaded');
  return 'cc map-routes loaded';
})();
