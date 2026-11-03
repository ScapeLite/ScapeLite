// ScapeLite Tree Advisor. Display only: plans the best Delve and Fortress (Fortify) tree builds for you. It never allocates or refunds a node; it shows
// which nodes to take (and which to refund) and you do it yourself in the game's tree window.
//  * Modes: Max DPS (priced with the game's own Gear Calc on your equipped loadout), Delve XP, Slayer and combat XP, Balanced, and for the Fortress
//    skilling XP, Fortify XP or efficiency. Every effect's weight can be edited ("Custom").
//  * The result: the best build for your points, what it changes against your current build (min hit, crit, attacks per second, DPS ...), the steps to
//    get there, and a picture of the tree. Hover a node to see exactly what it is worth.
//  * Builds can be saved, exported as text and imported again.
// The planning code is in tree-core.js (an exact tree knapsack, re-solved with marginal weights for non-linear scores like DPS).
(function () {
  'use strict';
  const NS = '__ccTreeAdvisor';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('treeAdvisorEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const core = () => window.__ccTreeCore;
  const bridge = () => { const b = window.__ccBridge; return b && b.treeState ? b : null; };
  const LS = { pos: 'cc-treeadv-pos', open: 'cc-treeadv-open', tree: 'cc-treeadv-tree', mode: 'cc-treeadv-mode', weights: 'cc-treeadv-weights', builds: 'cc-treeadv-builds' };
  const ld = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const sv = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  const EFFECT_NAMES = { minHit: 'Min hit', maxHit: 'Max hit', critChancePct: 'Crit chance %', critDamagePct: 'Crit damage %', attackSpeedPct: 'Attack speed %', corruptChancePct: 'Corruption chance %',
    combatXpPct: 'Combat XP %', slayXpPct: 'Slay XP %', delveXpPct: 'Delve XP %', globalXpPct: 'All XP %', moveSpeedPct: 'Move speed %', successPct: 'Success chance %',
    saveMaterialPct: 'Save materials %', doubleGatherPct: 'Double gather %', skillingXpPct: 'Skilling XP %', fortifyXpPct: 'Fortify XP %', actionTimeSec: 'Action time (s)', foodHeal: 'Food heal' };
  const effName = (e, skill) => (e === 'effLevel' ? '+' + (skill ? skill[0].toUpperCase() + skill.slice(1) : '') + ' level' : EFFECT_NAMES[e] || e.replace(/([A-Z])/g, ' $1').replace(/Pct$/, ' %'));

  // ---- modes: weight = how much one unit of that effect is worth, in "percent of the thing you care about"
  // Weights are "worth, in percent of the thing you care about, of one unit of the effect": 1% DPS = 1 point, +1 delve XP % = 1 point, one second shaved
  // off an action (about 10 s) = 10 points (it speeds every action by 10%), and so on. They are only a starting point: every weight can be edited.
  const MODES = {
    delve: [
      ['dps', 'Max DPS', { dps: 1 }],
      ['delvexp', 'Delve XP', { dps: 1, delveXpPct: 1, globalXpPct: 1, combatXpPct: 0.3, slayXpPct: 0.1 }],
      ['slayer', 'Slayer and combat XP', { dps: 1, slayXpPct: 1, combatXpPct: 1, globalXpPct: 1, delveXpPct: 0.1 }],
      ['balanced', 'Balanced', { dps: 1, delveXpPct: 0.4, slayXpPct: 0.4, combatXpPct: 0.6, globalXpPct: 1 }],
    ],
    fortify: [
      ['skilling', 'Skilling XP', { skillingXpPct: 1, globalXpPct: 1, actionTimeSec: 10, successPct: 0.3, moveSpeedPct: 0.15, doubleGatherPct: 0.2, saveMaterialPct: 0.2 }],
      ['fortify', 'Fortify XP', { fortifyXpPct: 1, globalXpPct: 1 }],
      ['efficiency', 'Efficiency', { actionTimeSec: 10, moveSpeedPct: 0.25, successPct: 0.4, doubleGatherPct: 0.5, saveMaterialPct: 0.5, skillingXpPct: 0.5, globalXpPct: 0.5 }],
    ],
  };

  // ---- state
  let open = ld(LS.open, '0') === '1', treeKey = ld(LS.tree, 'delve') === 'fortify' ? 'fortify' : 'delve', trees = {}, st = null, loadErr = '';
  let modeKey = {}, weights = {}, plan = null, planSig = '', hoverId = null, target = null, view = 'plan';
  try { modeKey = JSON.parse(ld(LS.mode, '{}')) || {}; weights = JSON.parse(ld(LS.weights, '{}')) || {}; } catch (e) {}
  const curMode = () => { const l = MODES[treeKey]; const k = modeKey[treeKey]; return l.find((m) => m[0] === k) || l[0]; };
  const curWeights = () => Object.assign({}, curMode()[2], (weights[treeKey] && weights[treeKey][curMode()[0]]) || {});
  const builds = () => { try { return JSON.parse(ld(LS.builds, '[]')) || []; } catch (e) { return []; } };

  fetch('/shared/data/raid-trees.json').then((r) => r.json()).then((j) => { trees = { delve: core() && core().buildTree(j, 'delve'), fortify: core() && core().buildTree(j, 'fortify') }; render(); }).catch((e) => { loadErr = 'Could not load the tree data.'; });

  // ---- styles + panel
  const style = document.createElement('style'); style.id = 'cc-treeadv-style';
  style.textContent = `
#cc-treeadv .tabs{display:flex;gap:4px;padding:8px 10px;background:var(--cc-bg-2);flex:none}
#cc-treeadv .tabs button{flex:1;background:transparent;color:var(--cc-text-dim);border:0;border-radius:8px;padding:5px 4px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}
#cc-treeadv .tabs button.on{background:var(--cc-accent-bg);color:var(--cc-accent);box-shadow:inset 0 -2px 0 var(--cc-accent)}
#cc-treeadv .row{display:flex;gap:6px;align-items:center}
#cc-treeadv select,#cc-treeadv input,#cc-treeadv textarea{background:var(--cc-bg-2);color:var(--cc-text);border:1px solid var(--cc-border);border-radius:8px;padding:4px 8px;font:inherit;outline:none}
#cc-treeadv button.b{background:var(--cc-bg-3);color:var(--cc-text);border:1px solid var(--cc-border);border-radius:8px;padding:3px 11px;font:inherit;font-size:13px;cursor:pointer}
#cc-treeadv button.b:hover{border-color:var(--cc-accent);color:var(--cc-accent)}
#cc-treeadv .hero{padding:10px 12px;border-radius:10px;background:linear-gradient(135deg,var(--cc-bg-3),var(--cc-bg-2));border:1px solid var(--cc-border)}
#cc-treeadv .hero .v{font-size:19px;font-weight:800}
#cc-treeadv .good{color:var(--cc-good)}#cc-treeadv .bad{color:var(--cc-bad)}#cc-treeadv .dim{color:var(--cc-text-dim);font-size:12.5px}
#cc-treeadv h5{margin:6px 0 0;color:var(--cc-text-faint);font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:700}
#cc-treeadv table{width:100%;border-collapse:collapse;font-size:13px}
#cc-treeadv td,#cc-treeadv th{padding:2px 5px;text-align:right;border-bottom:1px solid rgba(255,255,255,.05)}
#cc-treeadv td:first-child,#cc-treeadv th:first-child{text-align:left}
#cc-treeadv th{color:var(--cc-text-faint);font-weight:600;font-size:11.5px}
#cc-treeadv .step{display:flex;gap:8px;padding:3px 8px;border-radius:7px;background:var(--cc-bg-2);border-left:3px solid var(--cc-border-strong);cursor:pointer}
#cc-treeadv .step.add{border-left-color:var(--cc-accent)}#cc-treeadv .step.rem{border-left-color:var(--cc-bad)}
#cc-treeadv .step span.n{color:var(--cc-text-dim);min-width:22px}
#cc-treeadv .step span.e{flex:1}
#cc-treeadv .step span.g{color:var(--cc-good);font-size:12.5px}
#cc-treeadv canvas{display:block;width:100%;border-radius:8px;background:var(--cc-sunk);border:1px solid var(--cc-border)}
.cc-tadv-tip{position:fixed;z-index:1200;max-width:230px;padding:6px 9px;border-radius:8px;background:var(--cc-bg-2);border:1px solid rgba(255,255,255,.22);box-shadow:0 6px 18px rgba(0,0,0,.65);pointer-events:none;font:12.5px/1.4 system-ui,sans-serif;color:var(--cc-text)}
#cc-tadv-dim,.cc-tadv-tip .dim{color:var(--cc-text-dim);font-size:12px}
.cc-tadv-tip .good{color:var(--cc-good)}
#cc-treeadv-drawer{position:fixed;z-index:1100;display:none;flex-direction:column;box-sizing:border-box;padding:8px 10px;background:var(--cc-bg);border:1px solid var(--cc-border);border-radius:12px;color:var(--cc-text);font:13px/1.4 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.7)}
#cc-treeadv-drawer.show{display:flex}
#cc-treeadv-drawer[data-side=r]{border-top-left-radius:0;border-bottom-left-radius:0}
#cc-treeadv-drawer[data-side=l]{border-top-right-radius:0;border-bottom-right-radius:0}
#cc-treeadv-drawer .dh{color:var(--cc-accent);font-weight:700;margin-bottom:6px}
#cc-treeadv-drawer canvas{flex:1;min-height:0;width:100%;border-radius:8px;background:var(--cc-sunk);border:1px solid var(--cc-border)}
#cc-treeadv-drawer .leg{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--cc-text-dim)}
#cc-treeadv-drawer .leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
#cc-treeadv-tab{position:fixed;z-index:1100;width:26px;height:78px;padding:0;border:1px solid var(--cc-border);background:var(--cc-bg-3);color:var(--cc-accent);font:700 12px system-ui,sans-serif;cursor:pointer;writing-mode:vertical-rl;text-orientation:mixed}
#cc-treeadv-tab[data-side=r]{border-radius:0 8px 8px 0;border-left:0}
#cc-treeadv-tab[data-side=l]{border-radius:8px 0 0 8px;border-right:0;writing-mode:vertical-lr}
#cc-treeadv-tab:hover{background:var(--cc-bg-hover)}
#cc-treeadv .leg{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--cc-text-dim)}
#cc-treeadv .leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
`;
  document.head.appendChild(style);
  // Chrome (header, drag, memory, scale, layering) comes from the UI kit; the tab row sits between its header and body.
  const UI = window.__ccUI;
  if (!UI) return 'cc tree-advisor: UI kit not loaded';
  const P = UI.panel({ id: 'cc-treeadv', title: 'Tree Advisor', width: 470, height: 'min(640px,82vh)', closable: true, collapsible: true, resizable: true, legacyPosKey: LS.pos, onClose: () => setOpen(false) });
  const el = P.el;
  const tabsRow = document.createElement('div'); tabsRow.className = 'tabs'; el.insertBefore(tabsRow, P.body);
  { const sv0 = UI.store.get('panel:cc-treeadv', null); if (sv0 && sv0.open !== undefined) open = !!sv0.open; else P.setOpen(open); }
  function setOpen(v) { open = !!v; P.setOpen(open); if (open && !followRaf && typeof follow === 'function') followRaf = requestAnimationFrame(follow); render(); }
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const f1 = (n) => (Math.round(n * 100) / 100).toString();
  const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

  // ---- scoring: DPS from the game's own Gear Calc when available, else a simple damage model
  function dpsOf(effects) {
    const b = bridge();
    try { if (b && b.treeDps) { const r = b.treeDps(effects); if (r && isFinite(r.dps)) return r; } } catch (e) {}
    return null;
  }
  function makeScore(w, base) {
    return (eff) => {
      let s = 0;
      for (const k of Object.keys(w)) {
        if (k === 'dps') { const d = dpsOf(eff), d0 = base.dps0; if (d && d0) s += w.dps * 100 * (d.dps / d0 - 1); }
        else if (eff[k]) s += w[k] * eff[k];
      }
      return s;
    };
  }

  // ---- planning
  function compute() {
    const c = core(), T = trees[treeKey], S = st && st[treeKey]; if (!c || !T || !S) return null;
    const level = S.level || 1, cur = (S.allocated || []).slice();
    const sig = [treeKey, level, cur.join(','), curMode()[0], JSON.stringify(curWeights()), JSON.stringify(S.extra || 0)].join('|');
    if (plan && planSig === sig) return plan;
    const w = curWeights(), curEff = c.sumEffects(T, cur);
    const base = { dps0: null };
    if (treeKey === 'delve' && w.dps) { const d0 = dpsOf(c.sumEffects(T, [])); base.dps0 = d0 && d0.dps; }
    const scoreOf = makeScore(w, base);
    const fromScratch = c.optimise(T, { budget: level, level, scoreOf, start: cur, iters: 12 });
    const keepMine = c.optimise(T, { budget: level, level, scoreOf, start: cur, iters: 12, must: cur });
    plan = { T, S, level, cur, curEff, scoreOf, base, best: fromScratch, keep: keepMine, curScore: scoreOf(curEff) };
    planSig = sig; return plan;
  }
  const nodeScore = (p, ids, id) => { const ef = core().sumEffects(p.T, ids.concat([id])); return p.scoreOf(ef) - p.scoreOf(core().sumEffects(p.T, ids)); };
  const nodeText = (n) => (n.head ? n.head : '+' + n.value + ' ' + effName(n.effect, n.skill));

  // ---- drawing
  let layout = null, cv = null;
  // The tree picture uses the game's own layout (RaidTreeLayout, the same call the game's tree window makes), so it looks like the real tree. If that is not
  // available it falls back to a plain layered drawing.
  function layoutTree(T) {
    const L = window.RaidTreeLayout;
    try {
      if (L && L.buildExtended) {
        const lay = L.buildExtended(T.base, T.ext), pos = {}; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        const put = (id, q) => { pos[id] = { x: q.x, y: q.y }; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); };
        Object.values(T.nodes).forEach((n) => { const q = lay.nodes[n.slot]; if (q) put(n.id, q); });
        const rt = lay.nodes[0]; if (rt) put(T.rootId, rt);
        if (Object.keys(pos).length > 20) return { game: true, pos, x0: x0 - 45, y0: y0 - 45, w: x1 - x0 + 90, h: y1 - y0 + 90 };
      }
    } catch (e) { /* fall through */ }
    const pos = {}; let nextX = 0;
    const rec = (id) => { const n = T.nodes[id]; if (!n.children.length) { pos[id] = { x: nextX++ * 30, y: T.depth[id] * 40 }; return; } n.children.forEach(rec); const xs = n.children.map((c) => pos[c].x); pos[id] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: T.depth[id] * 40 }; };
    T.roots.forEach(rec); pos[T.rootId] = { x: nextX * 15, y: 0 };
    const xs = Object.values(pos).map((q) => q.x), ys = Object.values(pos).map((q) => q.y);
    return { game: false, pos, x0: Math.min(...xs) - 20, y0: Math.min(...ys) - 20, w: Math.max(...xs) - Math.min(...xs) + 40, h: Math.max(...ys) - Math.min(...ys) + 40 };
  }
  function drawTree(p, ids, cls) {
    const T = p.T; if (!layout || layout.key !== treeKey) { layout = layoutTree(T); layout.key = treeKey; }
    const W = cv.clientWidth || 440, Hh = cv.clientHeight || 400, dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
    const sc = Math.min(W / layout.w, Hh / layout.h), ox = (W - layout.w * sc) / 2, oy = (Hh - layout.h * sc) / 2;
    const px = (id) => ox + (layout.pos[id].x - layout.x0) * sc, py = (id) => oy + (layout.pos[id].y - layout.y0) * sc;
    g.lineWidth = 1;
    Object.values(T.nodes).forEach((n) => { if (!layout.pos[n.id] || !layout.pos[n.parent]) return; const used = cls[n.id] && cls[n.id] !== 'other'; g.strokeStyle = used ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.12)'; g.lineWidth = used ? 1.6 : 1; g.beginPath(); g.moveTo(px(n.parent), py(n.parent)); g.lineTo(px(n.id), py(n.id)); g.stroke(); });
    const COL = { have: '#5fe06d', add: '#ffd24a', rem: '#ff5a4d', other: '#3b3b55' };
    const R = layout.game ? { small: 13, medium: 19, large: 27 } : { small: 6, medium: 8, large: 11 };
    g.beginPath(); g.arc(px(T.rootId), py(T.rootId), Math.max(4, 30 * sc), 0, Math.PI * 2); g.fillStyle = '#6a6a88'; g.fill();   // the free starting node
    Object.values(T.nodes).forEach((n) => { if (!layout.pos[n.id]) return; const c = cls[n.id] || 'other', r = Math.max(2.5, (R[n.tier] || R.small) * sc); g.beginPath(); g.arc(px(n.id), py(n.id), r, 0, Math.PI * 2); g.fillStyle = COL[c]; g.fill(); if (c !== 'other') { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke(); } if (n.id === hoverId) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(px(n.id), py(n.id), r + 2, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; } });
    cv._pts = Object.values(T.nodes).filter((n) => layout.pos[n.id]).map((n) => ({ id: n.id, x: px(n.id), y: py(n.id), r: Math.max(6, (R[n.tier] || R.small) * sc + 3) }));
  }
  function classes(p, ids) { const cur = new Set(p.cur), tg = new Set(ids), cls = {}; Object.keys(p.T.nodes).forEach((id) => { cls[id] = cur.has(id) && tg.has(id) ? 'have' : tg.has(id) ? 'add' : cur.has(id) ? 'rem' : 'other'; }); return cls; }

  // ---- render
  // ---- the tree drawer: slides out beside the panel (like the Route Advisor's map), with a tab on the edge to open and close it
  let drawerCtx = null, drawerOpen = ld('cc-treeadv-drawer', '1') === '1';
  const drawerEl = document.createElement('div'); drawerEl.id = 'cc-treeadv-drawer';
  drawerEl.innerHTML = '<div class="dh">The tree</div><canvas></canvas><div class="leg"></div>';
  cv = drawerEl.querySelector('canvas');
  const dLeg = drawerEl.querySelector('.leg');
  [['#5fe06d', 'you have it, keep'], ['#ffd24a', 'take'], ['#ff5a4d', 'refund'], ['#3b3b55', 'not used']].forEach(([c0, l]) => { const sp = h('span'); const dot = h('i'); dot.style.background = c0; sp.appendChild(dot); sp.appendChild(document.createTextNode(l)); dLeg.appendChild(sp); });
  const dTab = document.createElement('button'); dTab.type = 'button'; dTab.id = 'cc-treeadv-tab';
  dTab.addEventListener('click', (e) => { e.stopPropagation(); drawerOpen = !drawerOpen; sv('cc-treeadv-drawer', drawerOpen ? '1' : '0'); updateDrawer(); });
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => drawerEl.addEventListener(t, (e) => e.stopPropagation()));
  cv.addEventListener('mousemove', (e) => {
    if (!drawerCtx) return;
    const r = cv.getBoundingClientRect(), k = (r.width / (cv.clientWidth || 1)) || 1, x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    let best = null, bd2 = 1e9; (cv._pts || []).forEach((q) => { const dd = (q.x - x) ** 2 + (q.y - y) ** 2; if (dd < q.r * q.r && dd < bd2) { bd2 = dd; best = q.id; } });
    const c = drawerCtx;
    if (best !== hoverId) { hoverId = best; drawTree(c.p, c.tg, c.cls); showTip(c.p, c.tg, best, e); } else if (best) moveTip(e);
  });
  cv.addEventListener('mouseleave', () => { hoverId = null; hideTip(); if (drawerCtx) drawTree(drawerCtx.p, drawerCtx.tg, drawerCtx.cls); });
  document.body.appendChild(drawerEl); document.body.appendChild(dTab);
  const DRAWER_W = 500;
  function placeDrawer() {
    if (!open || !el.classList.contains('show') || el.hasAttribute('data-cc-gh') || el.classList.contains('min') || view === 'builds') { drawerEl.classList.remove('show'); dTab.style.display = 'none'; delete el.dataset.drawerSide; return; }
    const r = el.getBoundingClientRect(), S = (r.width / (el.offsetWidth || 1)) || 1, DW = DRAWER_W * S, tabW = 26 * S;   // the panel's real scale (it has its own size setting)
    const side = innerWidth - r.right >= DW + 24 * S || innerWidth - r.right >= r.left ? 'r' : 'l';
    dTab.style.display = ''; dTab.textContent = drawerOpen ? (side === 'r' ? '\u25c2 Tree' : 'Tree \u25b8') : (side === 'r' ? 'Tree \u25b8' : '\u25c2 Tree');
    dTab.dataset.side = side;
    const edgeX = side === 'r' ? (drawerOpen ? r.right + DW - 1 : r.right - 1) : (drawerOpen ? r.left - DW + 1 - tabW : r.left - tabW + 1);
    dTab.style.left = Math.round(edgeX) + 'px'; dTab.style.top = Math.round(r.top + 70 * S) + 'px';
    drawerEl.classList.toggle('show', drawerOpen);
    if (drawerOpen) el.dataset.drawerSide = side; else delete el.dataset.drawerSide;   // squares the panel corners that touch the drawer
    if (drawerOpen) {
      drawerEl.dataset.side = side;
      drawerEl.style.top = Math.round(r.top) + 'px'; drawerEl.style.height = Math.round(r.height / S) + 'px'; drawerEl.style.width = DRAWER_W + 'px';
      drawerEl.style.left = Math.round(side === 'r' ? r.right - 1 : r.left - DW + 1) + 'px';
      const sz = Math.round(r.height) + 'x' + side; if (sz !== drawnSize) { drawnSize = sz; if (drawerCtx) requestAnimationFrame(() => drawTree(drawerCtx.p, drawerCtx.tg, drawerCtx.cls)); }   // the panel was resized
    }
  }
  let drawnSize = '';
  function updateDrawer() {
    placeDrawer();
    if (drawerOpen && drawerEl.classList.contains('show') && drawerCtx) requestAnimationFrame(() => { if (drawerEl.classList.contains('show')) drawTree(drawerCtx.p, drawerCtx.tg, drawerCtx.cls); });
  }

  function render() {
    if (!on() || !open) { el.classList.remove('show'); placeDrawer(); return; }
    el.classList.add('show');
    const tabs = el.querySelector('.tabs'); tabs.textContent = '';
    [['delve', 'Delve'], ['fortify', 'Fortress'], ['builds', 'My builds']].forEach(([k, label]) => {
      const b = h('button', (k === treeKey && view !== 'builds') || (k === 'builds' && view === 'builds') ? 'on' : '', label); b.type = 'button';
      b.addEventListener('click', () => { if (k === 'builds') view = 'builds'; else { view = 'plan'; treeKey = k; sv(LS.tree, k); target = null; plan = null; } render(); });
      tabs.appendChild(b);
    });
    const bd = el.querySelector('.bd'), top = bd.scrollTop;
    if (el.querySelector('input:focus,select:focus,textarea:focus')) return;
    bd.textContent = '';
    st = bridge() ? bridge().treeState() : null;
    if (loadErr) { bd.appendChild(h('div', 'dim', loadErr)); return; }
    if (!core()) { bd.appendChild(h('div', 'dim', 'The planner code is not loaded yet.')); return; }
    if (!trees.delve || !st) { bd.appendChild(h('div', 'dim', 'Waiting for the tree data and the game bridge (a few seconds after the game loads).')); return; }
    if (view === 'builds') { buildsView(bd); bd.scrollTop = top; placeDrawer(); return; }
    const p = compute(); if (!p) { bd.appendChild(h('div', 'dim', 'No data for this tree yet.')); return; }
    planView(bd, p); bd.scrollTop = top;
  }

  function planView(bd, p) {
    const c = core(), tg = target ? target.ids : p.best.ids;
    try { const dd = c.diff(trees[treeKey], p.cur, p.best.ids), n = dd.add.length + dd.remove.length; P.setChip((treeKey === 'delve' ? 'Delve' : 'Fortress') + ': ' + (n ? n + ' changes to the best build' : 'on the best build')); } catch (e) { /* no chip */ }
    const keepMode = p.keepMode;
    // controls
    const row = h('div', 'row'); const sel = h('select'); MODES[treeKey].forEach((m) => { const o = h('option', null, m[1]); o.value = m[0]; sel.appendChild(o); }); sel.value = curMode()[0];
    sel.addEventListener('change', () => { modeKey[treeKey] = sel.value; sv(LS.mode, JSON.stringify(modeKey)); plan = null; target = null; render(); });
    row.appendChild(h('span', 'dim', 'Goal')); row.appendChild(sel);
    row.appendChild(h('span', 'dim', 'Level ' + p.level + ' · ' + p.cur.length + '/' + p.level + ' points'));
    bd.appendChild(row);
    // hero
    const eNow = p.curEff, eNew = c.sumEffects(p.T, tg);
    const hero = h('div', 'hero');
    const sNow = p.curScore, sNew = p.scoreOf(eNew), pct = sNow !== 0 ? (sNew / Math.max(1e-9, Math.abs(sNow)) - 1) * 100 : 0;
    const dNow = treeKey === 'delve' ? dpsOf(eNow) : null, dNew = treeKey === 'delve' ? dpsOf(eNew) : null;
    const better = sNew > sNow + 1e-6;
    hero.appendChild(h('div', 'v ' + (better ? 'good' : ''), target ? 'Your target build' : better ? 'A better build exists' : 'Your build is already the best'));
    const sub = []; if (dNow && dNew) sub.push('DPS ' + f1(dNow.dps) + ' → ' + f1(dNew.dps) + ' (' + (dNew.dps >= dNow.dps ? '+' : '') + f1((dNew.dps / dNow.dps - 1) * 100) + '%)');
    if (dNow && dNew && dNow.aps != null) sub.push('attacks per second ' + f3(dNow.aps) + ' \u2192 ' + f3(dNew.aps));
    hero.appendChild(h('div', 'dim', sub.join(' · ') || (treeKey === 'delve' ? 'DPS is priced with the game’s Gear Calc once the bridge is attached.' : 'Priced with the weights below.')));
    bd.appendChild(hero);
    // the two ways to get there: refund and rebuild (costs reroll credits) or only add nodes (no refunds)
    const optRow = (label, ids, key) => {
      const d0 = c.diff(p.T, p.cur, ids), ef = c.sumEffects(p.T, ids), sc = p.scoreOf(ef), dv = treeKey === 'delve' ? dpsOf(ef) : null;
      const r = h('div', 'step add'); r.style.borderLeftColor = (target ? (target.key === key) : key === 'best') ? '#ffd24a' : '#44445a';
      const e = h('span', 'e', label + ': ' + (dv && dNow ? (dv.dps >= dNow.dps ? '+' : '') + f1((dv.dps / dNow.dps - 1) * 100) + '% DPS' : (sc - sNow >= 0 ? '+' : '') + f1(sc - sNow) + ' points') + ' · take ' + d0.add.length + (d0.remove.length ? ', refund ' + d0.remove.length + ' (~' + d0.refundCredits + ' credits)' : ', no refunds'));
      r.appendChild(e); r.addEventListener('click', () => { target = { ids, key }; render(); }); bd.appendChild(r);
    };
    optRow('Best build (respec)', p.best.ids, 'best'); optRow('Keep my nodes', p.keep.ids, 'keep');
    // effects table
    const keys = Array.from(new Set(Object.keys(eNow).concat(Object.keys(eNew)).filter((k) => k !== 'effLevel'))).filter((k) => (eNow[k] || 0) !== 0 || (eNew[k] || 0) !== 0);
    const skills = Array.from(new Set(Object.keys(eNow.effLevel || {}).concat(Object.keys(eNew.effLevel || {}))));
    const t = h('table'); const th = h('tr'); ['Effect', 'Now', 'Plan', 'Change'].forEach((x) => th.appendChild(h('th', null, x))); t.appendChild(th);
    const addRow = (name, a, b) => { const d = b - a; const tr = h('tr'); tr.appendChild(h('td', null, name)); tr.appendChild(h('td', null, f1(a))); tr.appendChild(h('td', null, f1(b))); const cd = h('td', d > 0 ? 'good' : d < 0 ? 'bad' : '', d ? (d > 0 ? '+' : '') + f1(d) : '–'); tr.appendChild(cd); t.appendChild(tr); };
    keys.forEach((k) => addRow(effName(k), eNow[k] || 0, eNew[k] || 0));
    skills.forEach((s) => addRow(effName('effLevel', s), (eNow.effLevel || {})[s] || 0, (eNew.effLevel || {})[s] || 0));
    bd.appendChild(t);
    // steps
    const d = c.diff(p.T, p.cur, tg);
    const free = Math.max(0, p.level - p.cur.length);
    bd.appendChild(h('h5', null, 'Steps to get there'));
    if (!d.add.length && !d.remove.length) bd.appendChild(h('div', 'dim', 'Nothing to change.'));
    else {
      const w = curWeights(); const order = c.buildOrder(p.T, tg, (n) => { const ef = {}; return p.scoreOf(c.sumEffects(p.T, [n.id])) - p.scoreOf(c.sumEffects(p.T, [])); });
      if (d.remove.length) { bd.appendChild(h('div', 'dim', 'Refund first (' + d.remove.length + ' node' + (d.remove.length === 1 ? '' : 's') + ', about ' + d.refundCredits + ' reroll credits; leaves first):')); d.remove.forEach((id, i) => bd.appendChild(stepRow('rem', i + 1, p.T.nodes[id], null))); }
      const adds = order.filter((id) => d.add.includes(id)); const keepIds = p.cur.filter((id) => tg.includes(id));
      bd.appendChild(h('div', 'dim', 'Then take (' + adds.length + ', in this order; ' + Math.max(0, free + d.remove.length) + ' points available):'));
      const have = keepIds.slice(); adds.forEach((id, i) => { const gain = nodeScore(p, have, id); have.push(id); bd.appendChild(stepRow('add', i + 1, p.T.nodes[id], gain)); });
    }
    // the tree picture lives in the drawer beside the panel
    drawerCtx = { p, tg, cls: classes(p, tg) };
    updateDrawer();
    // actions
    bd.appendChild(h('h5', null, 'Save, share'));
    const acts = h('div', 'row'); const mk = (label, fn) => { const b = h('button', 'b', label); b.type = 'button'; b.addEventListener('click', fn); acts.appendChild(b); };
    mk('Save this plan', () => { const name = 'Plan ' + new Date().toLocaleDateString(); const bl = builds(); bl.push({ name, tree: treeKey, ids: tg.map(short), mode: curMode()[0], at: Date.now() }); sv(LS.builds, JSON.stringify(bl)); view = 'builds'; render(); });
    mk('Copy as text', () => { const txt = exportText(treeKey, tg); try { navigator.clipboard.writeText(txt); } catch (e) {} });
    mk('Use my current build', () => { target = null; plan = null; render(); });
        bd.appendChild(acts);
    // custom weights
    const det = document.createElement('details'); det.appendChild(h('summary', 'dim', 'Custom weights (what each effect is worth)'));
    const wrap = h('div'); wrap.style.cssText = 'display:grid;grid-template-columns:1fr 70px;gap:4px 8px;padding:6px 0';
    const w2 = curWeights(); const effs = treeKey === 'delve' ? ['dps', 'delveXpPct', 'slayXpPct', 'combatXpPct', 'globalXpPct'] : ['skillingXpPct', 'fortifyXpPct', 'globalXpPct', 'doubleGatherPct', 'successPct', 'moveSpeedPct', 'saveMaterialPct', 'actionTimeSec'];
    effs.forEach((k) => { wrap.appendChild(h('span', 'dim', k === 'dps' ? 'DPS (1 per % of DPS)' : effName(k) + ' (per point)')); const i = h('input'); i.type = 'number'; i.step = '0.1'; i.value = String(w2[k] || 0); i.addEventListener('change', () => { weights[treeKey] = weights[treeKey] || {}; weights[treeKey][curMode()[0]] = Object.assign({}, weights[treeKey][curMode()[0]] || {}, { [k]: parseFloat(i.value) || 0 }); sv(LS.weights, JSON.stringify(weights)); plan = null; target = null; render(); }); wrap.appendChild(i); });
    const rs = h('button', 'b', 'Reset weights'); rs.type = 'button'; rs.addEventListener('click', () => { if (weights[treeKey]) delete weights[treeKey][curMode()[0]]; sv(LS.weights, JSON.stringify(weights)); plan = null; render(); });
    det.appendChild(wrap); det.appendChild(rs); bd.appendChild(det);
  }
  function stepRow(kind, n, node, gain) {
    const r = h('div', 'step ' + kind); r.appendChild(h('span', 'n', n + '.')); r.appendChild(h('span', 'e', nodeText(node) + ' · ' + (node.cluster || '').replace(/_/g, ' ')));
    if (gain != null && Math.abs(gain) > 1e-9) r.appendChild(h('span', 'g', (gain > 0 ? '+' : '') + f1(gain)));
    r.title = node.id; r.addEventListener('mouseenter', () => { hoverId = node.id; if (cv && plan) { const tg = target ? target.ids : plan.best.ids; drawTree(plan, tg, classes(plan, tg)); } });
    return r;
  }
  const short = (id) => id.replace(/^[a-z]+_n/, '');
  const full = (k, n) => k + '_n' + n;
  function exportText(k, ids) { return JSON.stringify({ app: 'scapelite-tree', v: 1, tree: k, nodes: ids.map(short).map(Number).sort((a, b) => a - b) }); }
  function importText(txt) {
    let o; try { o = JSON.parse(txt); } catch (e) { const m = /^\s*(delve|fortify)\s*[:=]\s*([\d,\s]+)$/i.exec(txt); if (m) o = { tree: m[1].toLowerCase(), nodes: m[2].split(/[,\s]+/).filter(Boolean).map(Number) }; }
    if (!o || !Array.isArray(o.nodes) || !(o.tree === 'delve' || o.tree === 'fortify')) return null;
    return { tree: o.tree, ids: o.nodes.map((n) => full(o.tree, n)) };
  }
  function buildsView(bd) {
    const bl = builds(); bd.appendChild(h('h5', null, 'Saved builds'));
    if (!bl.length) bd.appendChild(h('div', 'dim', 'Nothing saved yet. Use "Save this plan" on a plan, or import a build below.'));
    bl.forEach((b, i) => {
      const r = h('div', 'row'); r.appendChild(h('span', null, b.name + ' · ' + (b.tree === 'delve' ? 'Delve' : 'Fortress') + ' · ' + b.ids.length + ' nodes')); const sp = h('span'); sp.style.flex = '1'; r.appendChild(sp);
      const use = h('button', 'b', 'Plan with it'); use.type = 'button'; use.addEventListener('click', () => { treeKey = b.tree; view = 'plan'; target = { ids: b.ids.map((n) => full(b.tree, n)) }; plan = null; render(); });
      const cp = h('button', 'b', 'Copy'); cp.type = 'button'; cp.addEventListener('click', () => { try { navigator.clipboard.writeText(exportText(b.tree, b.ids.map((n) => full(b.tree, n)))); } catch (e) {} });
      const del = h('button', 'b', '×'); del.type = 'button'; del.addEventListener('click', () => { const l = builds(); l.splice(i, 1); sv(LS.builds, JSON.stringify(l)); render(); });
      r.append(use, cp, del); bd.appendChild(r);
    });
    bd.appendChild(h('h5', null, 'Import a build'));
    const ta = h('textarea'); ta.rows = 3; ta.placeholder = 'Paste a build: {"app":"scapelite-tree",...} or delve:1,7,67,...'; bd.appendChild(ta);
    const msg = h('div', 'dim'); const go = h('button', 'b', 'Import'); go.type = 'button';
    go.addEventListener('click', () => { const r = importText(ta.value); if (!r) { msg.textContent = 'That text is not a tree build.'; return; } const T = trees[r.tree], S = st && st[r.tree]; const v = T && S ? core().validate(T, r.ids, Math.max(S.level, r.ids.length)) : { ok: true }; if (!v.ok) { msg.textContent = 'Not a legal build: ' + v.reason; return; } const l = builds(); l.push({ name: 'Imported ' + new Date().toLocaleDateString(), tree: r.tree, ids: r.ids.map(short), mode: 'import', at: Date.now() }); sv(LS.builds, JSON.stringify(l)); render(); });
    bd.appendChild(go); bd.appendChild(msg);
  }

  // What a node is worth, as short lines: used by our own tree picture and by the game's real tree window.
  function nodeLines(p, tg, id) {
    const n = p.T.nodes[id], c = core(), curSet = new Set(p.cur), inT = new Set(tg), out = [];
    const without = p.cur.filter((x) => x !== id);
    const dps = (ids) => (treeKey === 'delve' ? dpsOf(c.sumEffects(p.T, ids)) : null);
    const a = dps(without), b = dps(without.concat([id])), gain = p.scoreOf(c.sumEffects(p.T, without.concat([id]))) - p.scoreOf(c.sumEffects(p.T, without));
    out.push(['Plan', curSet.has(id) ? (inT.has(id) ? 'you have it, keep' : 'you have it, refund') : inT.has(id) ? 'take it' : 'not used', curSet.has(id) ? (inT.has(id) ? 'good' : 'bad') : inT.has(id) ? 'gold' : '']);
    // what the node does to its own stat: the total of that effect without it and with it
    const eW = c.sumEffects(p.T, without), eB = c.sumEffects(p.T, without.concat([id]));
    const own = (e) => (n.effect === 'effLevel' ? (e.effLevel || {})[n.skill] || 0 : e[n.effect] || 0);
    out.push([effName(n.effect, n.skill), f3(own(eW)) + ' \u2192 ' + f3(own(eB)), 'good']);
    if (a && b && Math.abs(b.dps - a.dps) > 1e-9) {
      out.push(['DPS', (b.dps >= a.dps ? '+' : '') + f3(b.dps - a.dps) + '  (' + f3(a.dps) + ' \u2192 ' + f3(b.dps) + ')', b.dps > a.dps + 1e-9 ? 'good' : '']);
      if (b.aps != null && Math.abs(b.aps - a.aps) > 1e-9) { out.push(['Attacks/s', f3(a.aps) + ' \u2192 ' + f3(b.aps), 'good']); out.push(['Attack time', f3(a.interval) + 's \u2192 ' + f3(b.interval) + 's', 'good']); }
    } else if (Math.abs(gain) > 1e-9 && n.effect !== 'effLevel' && !(EFFECT_NAMES[n.effect] || '').length) out.push(['Goal', (gain > 0 ? '+' : '') + f1(gain) + ' points', gain > 0 ? 'good' : 'bad']);
    else if (Math.abs(gain) > 1e-9) out.push(['Worth', (gain > 0 ? '+' : '') + f1(gain) + ' points of your goal', gain > 0 ? 'good' : 'bad']);
    if (!curSet.has(id)) { let k = 0, q = id; while (q && q !== p.T.rootId && !curSet.has(q)) { k++; q = p.T.nodes[q] && p.T.nodes[q].parent; } if (k > 1) out.push(['Path', (k - 1) + ' node' + (k > 2 ? 's' : '') + ' first (' + k + ' points)', 'dim']); }
    return out;
  }
  const ROW_COL = { good: '#5fe06d', bad: '#ff8a5c', gold: '#ffd24a', dim: '#9a9ab0', '': '#e8e8f0' };
  function fillRows(box, rows) {
    rows.forEach(([k, v, cl]) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;gap:14px';
      const a = document.createElement('span'); a.textContent = k; a.style.color = '#8f8fa4';
      const b = document.createElement('span'); b.textContent = v; b.style.cssText = 'font-weight:600;text-align:right;color:' + (ROW_COL[cl] || ROW_COL['']);
      r.append(a, b); box.appendChild(r);
    });
  }
  // ---- marks drawn on the game's real tree: gold ring + step number = take this node, red ring = refund it
  function markRealTree(hud, k) {
    const T = trees[k]; if (!T || !core()) return;
    if (k !== treeKey) { treeKey = k; sv(LS.tree, k); target = null; plan = null; }
    st = bridge() ? bridge().treeState() : st;
    const p = compute(); if (!p) return;
    const tg = target ? target.ids : p.best.ids, d = core().diff(T, p.cur, tg);
    const lay = layoutTree(T), ids = Object.values(T.nodes).filter((n) => lay.pos[n.id]).map((n) => n.id);
    const order = core().buildOrder(T, tg, (n) => p.scoreOf(core().sumEffects(T, [n.id])) - p.scoreOf(core().sumEffects(T, [])));
    const addIdx = {}; order.filter((id) => d.add.includes(id)).forEach((id, i) => { addIdx[id] = i + 1; });
    const rem = new Set(d.remove), hits = document.querySelectorAll('.rtv-hit');
    hits.forEach((h2, i) => {
      const id = ids[i]; let m = h2.querySelector(':scope > .cc-rtv-mark');
      const kind = !id ? '' : rem.has(id) ? 'rem' : addIdx[id] ? 'add' : '';
      if (!kind) { if (m) m.remove(); return; }
      if (!m) { m = document.createElement('div'); m.className = 'cc-rtv-mark'; h2.appendChild(m); }
      if (m.dataset.k !== kind + (addIdx[id] || '')) {
        m.dataset.k = kind + (addIdx[id] || ''); m.textContent = kind === 'add' ? String(addIdx[id]) : '\u2212';
        m.style.cssText = 'position:absolute;inset:-6px;border-radius:50%;border:3px solid ' + (kind === 'add' ? '#ffd24a' : '#ff5a4d') + ';box-shadow:0 0 10px ' + (kind === 'add' ? 'rgba(255,210,74,.8)' : 'rgba(255,90,77,.8)') + ';pointer-events:none;display:flex;align-items:center;justify-content:center;font:700 13px system-ui,sans-serif;color:' + (kind === 'add' ? '#ffd24a' : '#ff8a7a') + ';text-shadow:0 0 3px #000';
      }
    });
  }
  const clearRealMarks = () => window.__ccDom.qa('.cc-rtv-mark').forEach((e) => e.remove());

  // ---- the game's own tree window: add the same lines to its tooltip
  const hitDone = new WeakSet();
  function hookRealTree(hud, k) {
    const T = trees[k]; if (!T || !core()) return;
    const lay = layoutTree(T), ids = Object.values(T.nodes).filter((n) => lay.pos[n.id]).map((n) => n.id);
    const hits = hud.parentElement ? hud.parentElement.querySelectorAll('.rtv-hit') : document.querySelectorAll('.rtv-hit');
    hits.forEach((h2, i) => {
      if (hitDone.has(h2) || !ids[i]) return; hitDone.add(h2);
      h2.addEventListener('mouseenter', () => {
        try {
          if (k !== treeKey) { treeKey = k; sv(LS.tree, k); target = null; plan = null; }
          st = bridge() ? bridge().treeState() : st;
          const p = compute(); if (!p) return;
          const tip = document.querySelector('.rtv-tip'); if (!tip) return;
          tip.querySelectorAll('.cc-rtv-x').forEach((e) => e.remove());
          const box = document.createElement('div'); box.className = 'cc-rtv-x'; box.style.cssText = 'margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,.2);font-size:12px;line-height:1.4';
          const tg = target ? target.ids : p.best.ids;
          fillRows(box, nodeLines(p, tg, ids[i]));
          tip.appendChild(box);
        } catch (e) { /* the game's own tooltip still works */ }
      });
    });
  }

  // ---- node tooltip
  let tipEl = null;
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
  function moveTip(e) { if (!tipEl) return; tipEl.style.left = Math.min(innerWidth - 240, e.clientX + 14) + 'px'; tipEl.style.top = (e.clientY + 14) + 'px'; }
  function showTip(p, tg, id, e) {
    hideTip(); if (!id) return;
    const n = p.T.nodes[id];
    tipEl = h('div', 'cc-tadv-tip');
    tipEl.appendChild(h('b', null, nodeText(n))); tipEl.appendChild(h('div', 'dim', (n.cluster || '').replace(/_/g, ' ') + ' · ' + n.id + (n.requiresLevel ? ' · needs level ' + n.requiresLevel : '')));
    const box = h('div'); box.style.cssText = 'margin-top:5px;font-size:12.5px;line-height:1.45'; fillRows(box, nodeLines(p, tg, id)); tipEl.appendChild(box);
    document.body.appendChild(tipEl); moveTip(e);
  }

  const timer = setInterval(() => { try { if (open && !(document.hidden || window.__ccEcoOn) && !hoverId) render(); } catch (e) { /* keep ticking */ } }, 4000);
  // follow the panel every frame while it moves or is resized (no lag behind the drag)
  let followRaf = 0, followSig = '', alive = true;
  const follow = () => { if (!alive) return; if (!open) { followRaf = 0; return; } try { if (open) { const r = el.getBoundingClientRect(), sg = r.left + ',' + r.top + ',' + r.width + ',' + r.height + ',' + el.classList.contains('show'); if (sg !== followSig) { followSig = sg; placeDrawer(); } } } catch (e) { /* keep following */ } followRaf = requestAnimationFrame(follow); };
  followRaf = requestAnimationFrame(follow);
  // Opens by itself with the game's Delve / Fortify tree window (and closes with it, unless you opened it yourself).
  let treeWasUp = false, autoOpened = false;
  const autoOn = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('treeAdvisorAutoOpen'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const watchTimer = setInterval(() => {
    try {
      const hud = window.__ccDom.q('.rtv-hud'), up = !!(hud && hud.getClientRects().length > 0);
      if (up && !treeWasUp && on() && autoOn()) {
        const img = hud.querySelector('.rtv-title img'), src = (img && img.getAttribute('src')) || '';
        const k = /fortify/i.test(src) ? 'fortify' : /delve/i.test(src) ? 'delve' : null;
        if (k && k !== treeKey) { treeKey = k; sv(LS.tree, k); target = null; plan = null; view = 'plan'; }
        if (!open) { autoOpened = true; setOpen(true); }
      } else if (!up && treeWasUp && autoOpened) { autoOpened = false; setOpen(false); }
      treeWasUp = up;
      if (up && on()) { const img = hud.querySelector('.rtv-title img'), src = (img && img.getAttribute('src')) || '', k2 = /fortify/i.test(src) ? 'fortify' : 'delve'; hookRealTree(hud, k2); if (open || autoOpened) markRealTree(hud, k2); else clearRealMarks(); } else clearRealMarks();
    } catch (e) { /* keep watching */ }
  }, 500);
  function teardown() {
    clearInterval(timer); clearInterval(watchTimer); alive = false; cancelAnimationFrame(followRaf); drawerEl.remove(); dTab.remove(); clearRealMarks(); hideTip();
    P.destroy(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc tree-advisor torn down';
  }
  window[NS] = { version: 1, teardown, render, get isOpen() { return open; }, toggle() { setOpen(!open); }, open() { setOpen(true); }, get plan() { return plan; }, compute, nodeLines: (id) => { const p = compute(); return p && nodeLines(p, p.best.ids, id); } };
  render();
  return 'cc tree-advisor loaded';
})();
