// ScapeLite Layout Editor: an edit mode for ScapeLite's own panels.
// Drag any panel with snapping (screen edges, other panels, grid), fade it, scale it, resize it, lock it, and save the whole arrangement as a named
// layout profile (export and import as text). Display only: it moves ScapeLite's panels, it never touches the game's windows or clicks anything in the game.
(() => {
  const NS = '__ccUILayout';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* old copy gone */ }
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const on = () => !!setting('uiLayoutEnabled', true);
  const info = () => window.__ccUIInfo || null;
  const KEY = 'cc-layout:v1';
  const SKIP = ['cc-lever-panel'];          // anchored to the game's own window: not movable
  const OPENABLE = ['__ccRouteAdvisor', '__ccGoals', '__ccXpTracker', '__ccDropLuck', '__ccTreeAdvisor', '__ccMaterialShortage'];

  // ---------------------------------------------------------------- stored layouts
  let db = { active: 'Default', profiles: { Default: { panels: {} } }, snap: true, grid: 8 };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.profiles && s.profiles[s.active]) db = Object.assign(db, s); } catch (e) { /* first run */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage blocked */ } };
  const prof = () => db.profiles[db.active];
  const ent = (id) => (prof().panels[id] = prof().panels[id] || {});
  // ScapeLite's own panels, plus the game's own floating windows (ids 'g:<panel-id>'; only when the game's windowed-panels setting is on)
  const ourIds = () => (info() ? info().ids() : []).filter((i) => !SKIP.includes(i));
  const uiBox = () => document.getElementById('ui-container');
  const zoomK = () => { const u = uiBox(), z = u ? parseFloat(u.style.zoom || getComputedStyle(u).zoom) : 1; return Number.isFinite(z) && z > 0 ? z : 1; };
  const isGame = (id) => id.indexOf('g:') === 0;
  let gCache = null, gAt = 0;
  function gameEls() {
    const now = performance.now(); if (gCache && now - gAt < 150) return gCache;   // looked up once per short while, not on every call
    const u = uiBox(), out = {}; gCache = out; gAt = now; if (!u || !document.body.classList.contains('panels-windowed')) return out;
    for (const p of (document.getElementById('hud-layer') || u).children) {   // each window is a direct child of the HUD layer (older game versions: of the UI container) with its titlebar as a direct child (the hidden modal overlay is skipped: 134 000 elements)
      if (p.classList.contains('modal-overlay')) continue;
      for (const tb of p.children) if (tb.dataset && tb.dataset.panelId && tb.classList.contains('panel-titlebar')) { out['g:' + tb.dataset.panelId] = p; break; }
    }
    return out;
  }
  // windows joined by Panel Fuse move as one group in the game; moving one of them here would break the fuse, so those are left to the game
  const fusedGame = (id) => { try { const F = window.__ccPanelFuse; const g = F && F.group ? F.group(id.slice(2)) : null; return !!g && g.length > 1; } catch (e) { return false; } };
  const GNAMES = { tasks: 'Tasks', slay: 'Slay', skills: 'Skills', quests: 'Quests', inventory: 'Inventory', diary: 'Diary', equipment: 'Equipment', friends: 'Friends', barter: 'Barter', chat: 'Chat', taskhud: 'Current Task', population: 'Info', raiddps: 'Raid DPS', gauntlet: 'Fortress' };
  const ids = () => ourIds().concat(Object.keys(gameEls()));
  const elOf = (id) => (isGame(id) ? gameEls()[id] || null : document.getElementById(id));
  const tabName = (id) => (isGame(id) ? (GNAMES[id.slice(2)] || id.slice(2)) : (info() ? info().name(id) : id));
  const nameOf = (id) => (isGame(id) ? (GNAMES[id.slice(2)] || id.slice(2)) + ' (game)' : (info() ? info().name(id) : id));
  const canResize = (id) => !isGame(id) && info() && info().resizable(id);
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------------------------------------------------------------- tab groups: several ScapeLite panels share one window spot, with a tab strip to pick which one shows
  // Members are stacked at the same position; only the active one is visible. Nothing is moved between elements, so every panel keeps working unchanged.
  const groups = () => (prof().groups || []).filter((g) => g.length > 1);
  const groupOf = (id) => groups().find((g) => g.includes(id)) || null;
  const grpAct = {}, grpOpen = {};
  let gRoot = null, gRaf = 0, gTimer = 0;
  const ghIds = new Set();   // panels currently hidden behind a tab (looked up by id, never by scanning the page)
  const isKit = (id) => !isGame(id) && id !== 'cc-route-panel' && !!document.getElementById(id);   // any panel except the Route Advisor (it has a map drawer attached)
  const isUp = (el) => !!el && el.getClientRects().length > 0;
  // put `el` exactly where `lead` is on screen (works whatever margins or offsets the panel carries)
  function alignTo(id, el, lead) {
    const a = lead.getBoundingClientRect(), b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) return;
    const k = isGame(id) ? zoomK() : 1;
    el.style.left = Math.round(((parseFloat(el.style.left) || 0) + dx / k) * 100) / 100 + 'px'; el.style.top = Math.round(((parseFloat(el.style.top) || 0) + dy / k) * 100) / 100 + 'px';
  }
  function leaveGroup(id) { const gs = prof().groups || []; gs.forEach((g) => { const i = g.indexOf(id); if (i >= 0) g.splice(i, 1); }); prof().groups = gs.filter((g) => g.length > 1); save(); const el = elOf(id); if (el) el.removeAttribute('data-cc-gh'); }
  function joinGroup(id, other) {
    // toggles `other` in the group `id` belongs to; when `id` has none, it joins other's group or starts a new one
    const gs = prof().groups = prof().groups || [];
    const mine = groupOf(id);
    if (mine && mine.includes(other)) { leaveGroup(other); return; }
    if (mine) { leaveGroup(other); const m2 = groupOf(id); if (m2) m2.push(other); else gs.push([id, other]); }
    else { const theirs = groupOf(other); if (theirs) theirs.push(id); else gs.push([id, other]); }
    save();
    // the panel being edited stays where it is and in front; the others come to it
    const grp = groupOf(id), el = elOf(id);
    if (grp && el) {
      grpAct[grp.slice().sort().join('|')] = id;
      grp.forEach((m) => { grpOpen[m] = isUp(elOf(m)); if (m === id) return; const o = elOf(m); if (o) alignTo(m, o, el); });
    }
  }
  function groupTick() {
    const gs = groups();
    if (!gs.length) { if (gRoot) { gRoot.remove(); gRoot = null; } if (ghIds.size) { ghIds.forEach((id) => { const e = elOf(id); if (e) e.removeAttribute('data-cc-gh'); }); ghIds.clear(); } return; }
    if (!gRoot) { gRoot = h('div'); gRoot.id = 'cc-grp-root'; document.body.appendChild(gRoot); }
    const keep = new Set(); ghIds.forEach((id) => { if (!groupOf(id)) { const e = elOf(id); if (e) e.removeAttribute('data-cc-gh'); ghIds.delete(id); } });
    gs.forEach((g) => {
      const key = g.slice().sort().join('|');
      const mem = g.filter((id) => isUp(elOf(id)));
      mem.forEach((id) => { if (!grpOpen[id] && grpAct[key] !== id) grpAct[key] = id; });   // a panel that has just been opened comes to the front of its group
      g.forEach((id) => { grpOpen[id] = mem.includes(id); });
      if (!mem.length) return;
      if (!mem.includes(grpAct[key])) grpAct[key] = mem[0];
      const lead = elOf(grpAct[key]);
      mem.forEach((id) => {
        const el = elOf(id);
        if (id === grpAct[key]) { if (el.hasAttribute('data-cc-gh')) el.removeAttribute('data-cc-gh'); ghIds.delete(id); }
        else { if (!el.hasAttribute('data-cc-gh')) el.setAttribute('data-cc-gh', '1'); ghIds.add(id); alignTo(id, el, lead); }
      });
      let st = gRoot.querySelector('[data-k="' + key + '"]');
      if (mem.length < 2) { if (st) st.remove(); return; }
      keep.add(key);
      const sig = mem.join(',') + '>' + grpAct[key];
      if (!st) { st = h('div', 'strip'); st.dataset.k = key; gRoot.appendChild(st); }
      if (st.dataset.sig !== sig) {
        st.dataset.sig = sig; st.textContent = '';
        mem.forEach((id) => { const b = h('button', id === grpAct[key] ? 'on' : '', tabName(id)); b.addEventListener('click', (e) => { e.stopPropagation(); grpAct[key] = id; groupTick(); }); st.appendChild(b); });
      }
      const r = lead.getBoundingClientRect(), above = r.top >= 32;
      st.style.left = Math.round(r.left) + 'px'; st.style.top = Math.round(above ? r.top - 30 : r.bottom + 2) + 'px'; st.style.zIndex = String((parseInt(lead.style.zIndex, 10) || 1100) + 1);
    });
    [...gRoot.children].forEach((c) => { if (!keep.has(c.dataset.k)) c.remove(); });
  }
  function groupLoop() {
    let has = false; try { groupTick(); has = groups().length > 0; } catch (e) { /* keep going */ }
    if (has) gRaf = requestAnimationFrame(groupLoop); else gTimer = setTimeout(groupLoop, 600);   // no tab groups: only a slow check
  }
  gTimer = setTimeout(groupLoop, 600);

  // ---------------------------------------------------------------- apply and follow
  const seen = {};   // id -> { vis, l, t, w }
  // a game window of the ready-made layout carries the on-screen spot it should land on (tx, ty): its left/top are in the game's own units and the window may be scaled, so nudge it by what is measured
  function aimGame(el, e) {
    if (!Number.isFinite(e.tx) || !Number.isFinite(e.ty)) return;
    for (let i = 0; i < 3; i++) {
      const r = el.getBoundingClientRect(); if (!r.width) return;
      const dx = e.tx - r.left, dy = e.ty - r.top; if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) break;
      const k = zoomK(), gs = window.__ccGameScale || { x: 1, y: 1 };
      el.style.left = Math.round(((parseFloat(el.style.left) || 0) + dx / (k * (gs.x || 1))) * 100) / 100 + 'px'; el.style.top = Math.round(((parseFloat(el.style.top) || 0) + dy / (k * (gs.y || 1))) * 100) / 100 + 'px';
    }
  }
  function applyEntry(id, el) {
    const e = prof().panels[id]; if (!e) return;
    if (Number.isFinite(e.x) && Number.isFinite(e.y) && !(isGame(id) && fusedGame(id))) { el.style.left = Math.round(e.x) + 'px'; el.style.top = Math.round(e.y) + 'px'; if (isGame(id)) aimGame(el, e); }
    if (e.w >= 100 && e.h >= 90 && !isGame(id) && info()) info().setSize(id, e.w, e.h);   // a saved 60 px height is a collapsed panel's, not a size
    el.style.opacity = e.o != null && e.o < 1 ? String(e.o) : '';
    if (info() && !isGame(id)) { if (e.s && Math.abs(e.s - 1) > 0.001) info().setMult(id, e.s); }
    el.toggleAttribute('data-cc-locked', !!e.lock); el.toggleAttribute('data-cc-fade', !!e.fade); if (isGame(id)) el.dataset.ccGid = id;
  }
  function remember(id, el) {
    const s = seen[id] = seen[id] || {};
    s.l = el.style.left; s.t = el.style.top; s.w = el.style.width + '/' + el.style.height;
  }
  // a smaller window pushes panels back onto the screen: that is the screen's doing, not the player's, so it must not overwrite the saved layout
  let lastVp = '', vpAt = 0;
  function follow() {
    if (!on() || !info()) return;
    { const vp = innerWidth + 'x' + innerHeight; if (vp !== lastVp) { lastVp = vp; vpAt = performance.now(); } }
    const resizing = performance.now() - vpAt < 2000;
    ids().forEach((id) => {
      const el = elOf(id); if (!el) return;
      const s = seen[id] = seen[id] || { vis: false };
      const vis = visible(el);
      if (el.dataset.ccPeek) { s.vis = vis; return; }   // a hover peek (the bar's Chat button) is not a layout position
      if (vis && !s.vis) { applyEntry(id, el); remember(id, el); }
      else if (vis && !editing) {
        // the player moved or resized it by hand: the active layout follows
        const wh = el.style.width + '/' + el.style.height;
        if (!resizing && (el.style.left !== s.l || el.style.top !== s.t)) { const L = parseFloat(el.style.left), T = parseFloat(el.style.top); if (Number.isFinite(L) && Number.isFinite(T)) { const e = ent(id); e.x = L; e.y = T; delete e.tx; delete e.ty; save(); } }
        if (!resizing && !isGame(id) && wh !== s.w && el.style.width && el.style.height && !el.classList.contains('min') && parseFloat(el.style.height) >= 90) { const e = ent(id); e.w = parseFloat(el.style.width); e.h = parseFloat(el.style.height); save(); }
        remember(id, el);
      }
      s.vis = vis;
    });
  }
  // a layout also remembers the panel look (palette, spacing, text size, accent)
  const LOOK = ['uiPalette', 'uiDensity', 'uiFontPx', 'uiAccent'];
  const lookNow = () => { const o = {}; LOOK.forEach((k) => { o[k] = setting(k, k === 'uiFontPx' ? 0 : k === 'uiPalette' ? 'default' : k === 'uiDensity' ? 'cozy' : ''); }); return o; };
  function applyLook(l) { const PS = window.__ccPluginSettings; if (!l || !PS || !PS.set) return; LOOK.forEach((k) => { if (l[k] !== undefined) PS.set(k, l[k]); }); try { window.__ccUI && window.__ccUI.applyTheme(); } catch (e) { /* ui kit not there */ } }
  function applyProfile(name) {
    if (!db.profiles[name]) return;
    db.active = name; undoSnap = null; save(); applyLook(db.profiles[name].look);
    ids().forEach((id) => { const el = elOf(id); if (el) { applyEntry(id, el); remember(id, el); } });
    refreshBar();
  }

  // ---------------------------------------------------------------- lock: the header of a locked panel stops starting drags
  const lockH = (e) => {
    if (editing || !info()) return;
    const t = e.target; if (!t || !t.closest) return;
    const p = t.closest('[data-cc-locked]'); if (!p) return;
    const hd = t.closest(isGame(p.dataset.ccGid || '') ? '.panel-titlebar' : info().head(p.id)); if (!hd || !p.contains(hd)) return;
    if (t.closest('button,input,select,textarea,a,canvas,.x,.xp-x,.min')) return;
    e.stopPropagation();
  };
  document.addEventListener('mousedown', lockH, true); document.addEventListener('pointerdown', lockH, true);

  // ---------------------------------------------------------------- styles
  const style = h('style'); style.id = 'cc-layout-style';
  style.textContent = `
[data-cc-fade]{opacity:.3 !important;transition:opacity .18s}
[data-cc-fade]:hover,[data-cc-fade]:focus-within{opacity:1 !important}
[data-cc-gh]{visibility:hidden !important;pointer-events:none !important}
#cc-grp-root .strip{position:fixed;display:flex;gap:2px;padding:3px 4px 0;background:var(--cc-bg);border:1px solid var(--cc-border);border-bottom:0;border-radius:10px 10px 0 0;font:13px/1.2 var(--cc-font,system-ui,sans-serif)}
#cc-grp-root .strip button{font:inherit;color:var(--cc-text-dim);background:transparent;border:0;border-bottom:2px solid transparent;padding:4px 10px;cursor:pointer;border-radius:6px 6px 0 0}
#cc-grp-root .strip button:hover{color:var(--cc-text);background:var(--cc-bg-3,var(--cc-bg-3))}
#cc-grp-root .strip button.on{color:var(--cc-accent);border-bottom-color:var(--cc-accent)}
[data-cc-locked]>.hd,[data-cc-locked]>.xp-bar,[data-cc-locked] .rt-head{cursor:default !important}
#cc-ed-root{position:fixed;inset:0;z-index:1955;pointer-events:none;font:13px/1.35 var(--cc-font,system-ui,sans-serif);color:var(--cc-text)}
#cc-ed-root .fr{position:fixed;box-sizing:border-box;border:2px dashed var(--cc-accent);background:color-mix(in srgb,var(--cc-accent) 7%,transparent);pointer-events:auto;cursor:move;border-radius:6px}
#cc-ed-root .fr.sel{border-style:solid;box-shadow:0 0 0 1px var(--cc-accent)}
#cc-ed-root .fr.fz{border-color:var(--cc-text-faint);background:rgba(120,120,140,.08);cursor:not-allowed}
#cc-ed-root .fr.lk{border-color:var(--cc-info);background:color-mix(in srgb,var(--cc-info) 8%,transparent);cursor:not-allowed}
#cc-ed-root .fr.drag{background:color-mix(in srgb,var(--cc-accent) 16%,transparent)}
#cc-ed-root .tb{position:absolute;left:-2px;bottom:100%;display:flex;gap:4px;align-items:center;padding:3px 5px;background:var(--cc-bg);border:1px solid var(--cc-border);border-radius:8px 8px 0 0;white-space:nowrap;cursor:default}
#cc-ed-root .tb.in{bottom:auto;top:0;border-radius:0 0 8px 0}
#cc-ed-root .tb b{color:var(--cc-accent);margin-right:4px}
#cc-ed-root button,#cc-ed-root select,#cc-ed-root input[type=text],#cc-ed-root textarea{font:inherit;color:var(--cc-text);background:var(--cc-bg-3,var(--cc-bg-3));border:1px solid var(--cc-border);border-radius:6px;padding:2px 8px}
#cc-ed-root button{cursor:pointer;line-height:1.2}
#cc-ed-root button:hover{border-color:var(--cc-accent)}
#cc-ed-root button.on{background:var(--cc-accent-bg);border-color:var(--cc-accent);color:var(--cc-accent)}
#cc-ed-root input[type=range]{width:70px;vertical-align:middle}
#cc-ed-root .gm{position:fixed;display:flex;flex-direction:column;gap:3px;padding:6px;background:var(--cc-bg);border:1px solid var(--cc-accent);border-radius:10px;pointer-events:auto;z-index:2}
#cc-ed-root .gm .gh{color:var(--cc-text-dim);font-size:12px;padding:0 2px 3px}
#cc-ed-root .gm button{text-align:left}
#cc-ed-root .rz{position:absolute;right:-2px;bottom:-2px;width:16px;height:16px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--cc-accent) 50%);border-radius:0 0 6px 0}
#cc-ed-root .gd{position:fixed;background:var(--cc-accent);opacity:.85;pointer-events:none}
#cc-ed-bar{position:fixed;left:50%;top:10px;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;max-width:min(96vw,980px);padding:7px 10px;background:var(--cc-bg);border:1px solid var(--cc-accent);border-radius:12px;box-shadow:var(--cc-shadow,0 14px 40px rgba(0,0,0,.7));pointer-events:auto}
#cc-ed-bar .ttl{font-weight:700;color:var(--cc-accent)}
#cc-ed-bar .sep{width:1px;height:20px;background:var(--cc-border)}
#cc-ed-bar label{display:flex;gap:4px;align-items:center;cursor:pointer}
#cc-ed-bar .io{flex-basis:100%;display:none;flex-direction:column;gap:5px}
#cc-ed-bar .io.show{display:flex}
#cc-ed-bar .io textarea{width:100%;height:90px;box-sizing:border-box;font:11px/1.3 ui-monospace,Consolas,monospace;resize:vertical}
#cc-ed-bar .io .row{display:flex;gap:6px;align-items:center}
#cc-ed-bar .look{flex-basis:100%;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;padding-top:6px;border-top:1px solid var(--cc-border)}
#cc-ed-bar .look label{color:var(--cc-text-dim)}
#cc-ed-bar .look input[type=color]{width:30px;height:22px;padding:0;background:none;border:1px solid var(--cc-border);border-radius:5px}
#cc-ed-bar .hint{flex-basis:100%;text-align:center;color:var(--cc-text-dim);font-size:12px}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- edit mode
  let editing = false, root = null, bar = null, raf = 0, opened = [], guides = [];
  const frames = {};
  let sel = '';
  let ioMode = '', nameBox = null;

  function others(except) {
    const out = [];
    ids().forEach((id) => { if (id === except) return; const el = elOf(id); if (visible(el)) out.push(el.getBoundingClientRect()); });
    return out;
  }
  function snapAxis(pos, size, cands, thr) {
    // try aligning the moving rect's start, middle and end to each candidate line
    let best = null;
    cands.forEach((c) => { [[0, pos], [size / 2, pos + size / 2], [size, pos + size]].forEach(([off, v]) => { const d = c - v; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: c }; }); });
    return best;
  }
  function drawGuides(lines) {
    guides.forEach((g) => g.remove()); guides = [];
    lines.forEach((l) => { const g = h('div', 'gd'); if (l.v) { g.style.cssText = 'left:' + l.v + 'px;top:0;width:1px;height:100vh'; } else { g.style.cssText = 'top:' + l.hz + 'px;left:0;height:1px;width:100vw'; } root.appendChild(g); guides.push(g); });
  }
  function makeFrame(id) {
    const f = h('div', 'fr'); f.dataset.id = id;
    const tb = h('div', 'tb');
    tb.appendChild(h('b', null, nameOf(id)));
    const lock = h('button', null, '🔓'); lock.title = 'Lock this panel in place';
    lock.addEventListener('click', (e) => { e.stopPropagation(); const en = ent(id); en.lock = !en.lock; const el = elOf(id); if (el) el.toggleAttribute('data-cc-locked', !!en.lock); save(); sync(id); });
    const op = h('input'); op.type = 'range'; op.min = '0.3'; op.max = '1'; op.step = '0.05'; op.title = 'Opacity';
    op.addEventListener('input', () => { const v = Number(op.value), en = ent(id), el = elOf(id); en.o = v; if (el) el.style.opacity = v < 1 ? String(v) : ''; save(); });
    const mk = (t, title, fn) => { const b = h('button', null, t); b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
    const sc = (d) => { const i = info(), v = Math.round(((i.mult(id) || 1) + d) * 100) / 100; i.setMult(id, v); ent(id).s = i.mult(id); save(); };
    const fade = mk('\uD83D\uDC7B', 'Fade out when the mouse is not over it', () => { const en = ent(id), el = elOf(id); en.fade = !en.fade; if (el) el.toggleAttribute('data-cc-fade', !!en.fade); save(); sync(id); });
    const rs = mk('↺', 'Reset this panel (size, scale, opacity, position)', () => {
      const el = elOf(id); delete prof().panels[id]; save();
      if (el && isGame(id)) { el.style.opacity = ''; el.removeAttribute('data-cc-locked'); el.removeAttribute('data-cc-fade'); } else if (el) { el.style.opacity = ''; el.removeAttribute('data-cc-fade'); info().setMult(id, 0); info().clearSize(id); el.removeAttribute('data-cc-locked'); const p = window.__ccNextPos ? window.__ccNextPos() : { x: 150, y: 70 }; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
    });
    const grp = mk('\u29C9', 'Tab group: share one window spot with other panels', () => {
      document.querySelectorAll('#cc-ed-root .gm').forEach((x) => x.remove());
      const menu = h('div', 'gm'); const rb = grp.getBoundingClientRect(); menu.style.left = rb.left + 'px'; menu.style.top = rb.bottom + 2 + 'px';
      menu.appendChild(h('div', 'gh', 'Show as a tab together with:'));
      const done = () => { menu.remove(); groupTick(); };
      ourIds().filter((o) => o !== id && isKit(o)).forEach((o) => { const b = h('button', null, tabName(o) + (groupOf(o) && groupOf(o) === groupOf(id) ? ' \u2713' : '')); b.addEventListener('click', (e) => { e.stopPropagation(); joinGroup(id, o); done(); }); menu.appendChild(b); });
      if (groupOf(id)) { const b = h('button', null, 'Leave the group'); b.addEventListener('click', (e) => { e.stopPropagation(); leaveGroup(id); done(); }); menu.appendChild(b); }
      const c = h('button', null, 'Close'); c.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); }); menu.appendChild(c);
      root.appendChild(menu);
    });
    grp.classList.toggle('on', !!groupOf(id));
    const colEl = isGame(id) ? null : elOf(id), colBtn = colEl && colEl.querySelector(':scope > .hd > button.min');
    const col = colBtn ? mk('▭', 'Collapse to a title bar or expand', () => { colBtn.click(); }) : null;
    (isGame(id) ? [lock, op, fade, rs] : [lock, op, fade, ...(col ? [col] : []), ...(isKit(id) ? [grp] : []), mk('−', 'Smaller', () => sc(-0.1)), mk('+', 'Bigger', () => sc(0.1)), rs]).forEach((x) => tb.appendChild(x));
    f.appendChild(tb);
    const rz = h('div', 'rz'); rz.title = 'Drag to resize'; f.appendChild(rz);
    f._lock = lock; f._op = op; f._tb = tb; f._fade = fade;

    f.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.tb')) return;
      sel = id;
      e.preventDefault(); e.stopPropagation();
      const el = elOf(id); if (!el) return;
      if (e.target === rz) {
        if (!canResize(id)) return;
        const sc0 = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1, w0 = el.offsetWidth, h0 = el.offsetHeight, x0 = e.clientX, y0 = e.clientY;
        const mv = (m) => { const nw = Math.max(200, w0 + (m.clientX - x0) / sc0), nh = Math.max(110, h0 + (m.clientY - y0) / sc0); info().setSize(id, nw, nh); };
        const up = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); const en = ent(id); en.w = el.offsetWidth; en.h = el.offsetHeight; save(); };
        document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
        return;
      }
      if (ent(id).lock || (isGame(id) && fusedGame(id))) return;
      f.classList.add('drag');
      const r0 = el.getBoundingClientRect(), kz = isGame(id) ? zoomK() : 1, L0 = parseFloat(el.style.left) || 0, T0 = parseFloat(el.style.top) || 0, x0 = e.clientX, y0 = e.clientY;
      const oth = others(id), g = Math.max(2, Number(db.grid) || 8);
      const EG = window.__ccEdge || { top: 0, bottom: 0, reserved: 0 }, VH = innerHeight + (EG.reserved || 0), xs = [0, innerWidth / 2, innerWidth], ys = [EG.top || 0, VH / 2, VH - (EG.bottom || 0)];
      oth.forEach((r) => { xs.push(r.left, r.right, r.left - 6, r.right + 6); ys.push(r.top, r.bottom, r.top - 6, r.bottom + 6); });
      const mv = (m) => {
        let dx = m.clientX - x0, dy = m.clientY - y0, lines = [];
        let nx = r0.left + dx, ny = r0.top + dy;
        if (db.snap && !m.shiftKey) {
          const sx = snapAxis(nx, r0.width, xs, 9), sy = snapAxis(ny, r0.height, ys, 9);
          if (sx) { nx += sx.d; lines.push({ v: sx.line }); } else { const gx = Math.round(nx / g) * g; if (Math.abs(gx - nx) < 4) nx = gx; }
          if (sy) { ny += sy.d; lines.push({ hz: sy.line }); } else { const gy = Math.round(ny / g) * g; if (Math.abs(gy - ny) < 4) ny = gy; }
        }
        nx = Math.max(80 - r0.width, Math.min(innerWidth - 80, nx)); const E = window.__ccEdge || { top: 0, bottom: 0, reserved: 0 }; ny = Math.max(E.top || 0, Math.min(innerHeight + (E.reserved || 0) - (E.bottom || 0) - r0.height, ny));
        el.style.left = Math.round((L0 + (nx - r0.left) / kz) * 100) / 100 + 'px'; el.style.top = Math.round((T0 + (ny - r0.top) / kz) * 100) / 100 + 'px';
        drawGuides(lines);
      };
      const up = () => {
        document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true);
        f.classList.remove('drag'); drawGuides([]);
        const en = ent(id); en.x = parseFloat(el.style.left); en.y = parseFloat(el.style.top); save(); remember(id, el);
      };
      document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
    });
    f.addEventListener('dblclick', (e) => e.stopPropagation());
    root.appendChild(f); frames[id] = f; sync(id);
    return f;
  }
  function sync(id) {
    const f = frames[id]; if (!f) return; const en = prof().panels[id] || {};
    f.classList.toggle('lk', !!en.lock); f._lock.textContent = en.lock ? '🔒' : '🔓'; f._lock.classList.toggle('on', !!en.lock); f._fade.classList.toggle('on', !!en.fade);
    f._op.value = String(en.o != null ? en.o : 1);
    const rz = f.querySelector('.rz'); rz.style.display = canResize(id) && !en.lock ? '' : 'none';
  }
  function loop() {
    if (!editing) return;
    raf = requestAnimationFrame(loop);
    try { loopBody(); } catch (e) { /* keep the editor alive */ }
  }
  function loopBody() {
    const all = ids(); Object.keys(frames).forEach((k) => { if (!all.includes(k)) { frames[k].remove(); delete frames[k]; } });
    all.forEach((id) => {
      const el = elOf(id), vis = visible(el), f = frames[id];
      if (!vis) { if (f) { f.remove(); delete frames[id]; } return; }
      const fr = f || makeFrame(id), r = el.getBoundingClientRect();
      fr.style.left = r.left + 'px'; fr.style.top = r.top + 'px'; fr.style.width = r.width + 'px'; fr.style.height = r.height + 'px';
      fr._tb.classList.toggle('in', r.top < 34); fr.classList.toggle('sel', sel === id);
      const fz = isGame(id) && fusedGame(id); if (fr.classList.contains('fz') !== fz) { fr.classList.toggle('fz', fz); fr.title = fz ? 'Fused with other windows (Panel Fuse): drag them in the game, they move together' : ''; }
    });
  }

  // ---------------------------------------------------------------- toolbar
  // The toolbar sits below the top Info Bar and never grows into the bottom one
  function placeBar() {
    if (!bar) return;
    let e = { top: 0, bottom: 0 }; try { const x = window.__ccBar && window.__ccBar.edge && window.__ccBar.edge(); if (x) e = x; } catch (er) { /* no bars */ }
    bar.style.top = ((e.top || 0) + 10) + 'px';
    bar.style.maxHeight = Math.max(120, innerHeight - (e.top || 0) - (e.bottom || 0) - 20) + 'px';
    bar.style.overflowY = 'auto';
  }
  function refreshBar() {
    if (!bar) return;
    placeBar();
    const sel = bar.querySelector('select'); sel.textContent = '';
    Object.keys(db.profiles).forEach((n) => { const o = h('option', null, n); o.value = n; if (n === db.active) o.selected = true; sel.appendChild(o); });
    { const bk = bar.querySelector('button.bk'); if (bk) bk.style.display = readBk() ? '' : 'none'; }
    bar.querySelector('.snap').checked = !!db.snap; bar.querySelector('select.auto').value = prof().auto || '';
  }
  function showIO(mode) {
    const io = bar.querySelector('.io'), ta = io.querySelector('textarea'), go = io.querySelector('.go'), lab = io.querySelector('.lab');
    if (ioMode === mode) { ioMode = ''; io.classList.remove('show'); return; }
    ioMode = mode; io.classList.add('show');
    if (mode === 'export') { ta.value = JSON.stringify({ app: 'scapelite-layout', v: 1, name: db.active, panels: prof().panels, groups: prof().groups || [], look: prof().look || lookNow() }); ta.select(); lab.textContent = 'Copy this text to share or back up this layout.'; go.textContent = 'Copy'; }
    else if (mode === 'import') { ta.value = ''; lab.textContent = 'Paste a layout here, then press Load. It is added as a new layout.'; go.textContent = 'Load'; }
    else if (mode === 'save') { ta.value = ''; lab.textContent = 'Name for the new layout (a copy of the current arrangement). Press Save.'; go.textContent = 'Save'; }
  }
  function ioGo() {
    const io = bar.querySelector('.io'), ta = io.querySelector('textarea');
    if (ioMode === 'export') { const fb = () => { ta.select(); try { document.execCommand('copy'); } catch (e) { /* user can copy by hand */ } }; try { navigator.clipboard.writeText(ta.value).catch(fb); } catch (e) { fb(); } return; }
    if (ioMode === 'save') {
      const n = ta.value.trim().slice(0, 40); if (!n) return;
      db.profiles[n] = JSON.parse(JSON.stringify(prof())); db.profiles[n].look = lookNow(); delete db.profiles[n].auto; db.active = n; save(); refreshBar(); showIO('save'); return;
    }
    if (ioMode === 'import') {
      try {
        const o = JSON.parse(ta.value); if (!o || o.app !== 'scapelite-layout' || !o.panels || typeof o.panels !== 'object') throw new Error('not a layout');
        const lim = { x: [-2000, 6000], y: [0, 4000], w: [200, 3000], h: [110, 3000], o: [0.3, 1], s: [0.5, 2] };
        const clean = {}; Object.keys(o.panels).forEach((k) => { if (!/^(cc-[a-z-]+|g:[a-z]+)$/.test(k)) return; const p = o.panels[k] || {}, q = {}; ['x', 'y', 'w', 'h', 'o', 's'].forEach((f) => { if (Number.isFinite(p[f])) q[f] = Math.max(lim[f][0], Math.min(lim[f][1], p[f])); }); if (p.lock) q.lock = true; if (p.fade) q.fade = true; clean[k] = q; });
        let n = String(o.name || 'Imported').slice(0, 40), i = 2; while (db.profiles[n]) n = String(o.name || 'Imported').slice(0, 36) + ' ' + i++;
        const lk = {}; if (o.look && typeof o.look === 'object') { if (['default', 'game', 'colourblind'].includes(o.look.uiPalette)) lk.uiPalette = o.look.uiPalette; if (['compact', 'cozy', 'roomy'].includes(o.look.uiDensity)) lk.uiDensity = o.look.uiDensity; if ([0, 12, 14, 16, 18].includes(o.look.uiFontPx)) lk.uiFontPx = o.look.uiFontPx; if (typeof o.look.uiAccent === 'string' && /^(#[0-9a-f]{6})?$/i.test(o.look.uiAccent)) lk.uiAccent = o.look.uiAccent; }
        const gr = (Array.isArray(o.groups) ? o.groups : []).map((g) => (Array.isArray(g) ? g.filter((x) => typeof x === 'string' && /^(cc-[a-z-]+|g:[a-z]+)$/.test(x)) : [])).filter((g) => g.length > 1);
        const used = new Set(); gr.forEach((g) => { for (let i = g.length - 1; i >= 0; i--) { if (used.has(g[i])) g.splice(i, 1); else used.add(g[i]); } });
        db.profiles[n] = { panels: clean, groups: gr.filter((g) => g.length > 1), look: lk }; save(); applyProfile(n); showIO('import');
      } catch (e) { ta.value = 'That text is not a ScapeLite layout.'; }
    }
  }
  // ---------------------------------------------------------------- the ready-made layout ('ScapeLite default', overlay/default-layout.js)
  // Built for the window as it is now (size, Info Bars, game zoom). Everything it is about to change is saved first, so "Back to my old layout" puts the
  // panels, their sizes and scales, the game windows' scales, the tab groups and the look back. Your own layouts are never touched.
  const LS_BK = 'cc-layout-backup:v1', BK_PREFIX = ['cc-size-', 'cc-ui:panel:'];
  const readBk = () => { try { return JSON.parse(localStorage.getItem(LS_BK) || 'null'); } catch (e) { return null; } };
  const lsKeys = () => { const k = []; try { for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i); if (BK_PREFIX.some((p) => n.indexOf(p) === 0)) k.push(n); } } catch (e) { /* storage blocked */ } return k; };
  function snapshotAll() {
    const o = { at: Date.now(), db: JSON.parse(JSON.stringify(db)), scales: {}, mult: {}, ls: {}, pos: {}, look: lookNow() };
    try { o.scales = (window.__ccPanelScale && window.__ccPanelScale.scales) || {}; } catch (e) { /* none */ }
    try { o.mult = JSON.parse(localStorage.getItem('cc-panel-mult') || '{}') || {}; } catch (e) { /* none */ }
    lsKeys().forEach((n) => { try { o.ls[n] = localStorage.getItem(n); } catch (e) { /* skip */ } });
    ids().forEach((id) => { const el = elOf(id); if (!el) return; const L = parseFloat(el.style.left), T = parseFloat(el.style.top); if (Number.isFinite(L) && Number.isFinite(T)) o.pos[id] = [L, T]; });
    return o;
  }
  const vpNow = () => { let e = { top: 0, bottom: 0 }; try { const x = window.__ccBar && window.__ccBar.edge && window.__ccBar.edge(); if (x) e = x; } catch (er) { /* no bars */ } return { w: innerWidth, h: innerHeight, top: e.top || 0, bottom: e.bottom || 0, zoom: zoomK(), g: Math.max(0.5, Math.min(2, (Number(setting('uiScalePct', 100)) || 100) / 100)) }; };
  function useDefault() {
    const D = window.__ccDefaultLayout; if (!D || !info()) return false;
    // the first press saves the old state; pressing it again on the same layout (to fit a new window size) keeps that first save
    if (!(db.active === D.NAME && readBk())) { try { localStorage.setItem(LS_BK, JSON.stringify(snapshotAll())); } catch (e) { /* storage blocked: no way back, but nothing is lost either */ } }
    const b = D.build(vpNow());
    db.profiles[D.NAME] = { panels: b.panels, groups: b.groups, look: b.look };
    try { window.__ccPanelScale && window.__ccPanelScale.setScales(b.gameScales); } catch (e) { /* game windows keep their scale */ }
    // sizes and scales of the ScapeLite panels are set here for every panel of the layout, built yet or not (a panel that is not on screen picks them up when it opens)
    Object.keys(b.panels).forEach((id) => {
      if (isGame(id)) return; const p = b.panels[id];
      info().setMult(id, p.s || 1);
      if (p.w && p.h) { try { localStorage.setItem('cc-size-' + id, JSON.stringify({ w: Math.round(p.w), h: Math.round(p.h) })); } catch (e) { /* storage blocked */ } }
      try { const k = 'cc-ui:panel:' + id, v = JSON.parse(localStorage.getItem(k) || 'null'); if (v) { v.x = p.x; v.y = p.y; localStorage.setItem(k, JSON.stringify(v)); } } catch (e) { /* none */ }   // the kit's saved spot (and whether it was open) of a panel that is not built yet
    });
    db.active = D.NAME; save(); undoSnap = null; applyProfile(D.NAME);
    return true;
  }
  function backToOld() {
    const o = readBk(); if (!o) return false;
    db = Object.assign({ active: 'Default', profiles: { Default: { panels: {} } }, snap: true, grid: 8 }, o.db); if (!db.profiles[db.active]) db.active = Object.keys(db.profiles)[0]; save();
    try { window.__ccPanelScale && window.__ccPanelScale.setScales(o.scales || {}, true); } catch (e) { /* game windows keep their scale */ }
    lsKeys().forEach((n) => { try { localStorage.removeItem(n); } catch (e) { /* skip */ } });
    Object.keys(o.ls || {}).forEach((n) => { try { localStorage.setItem(n, o.ls[n]); } catch (e) { /* skip */ } });
    const mult = o.mult || {}; let now = {}; try { now = JSON.parse(localStorage.getItem('cc-panel-mult') || '{}') || {}; } catch (e) { /* none */ }
    Object.keys(Object.assign({}, now, mult)).forEach((id) => { if (info()) info().setMult(id, mult[id] || 0); });
    ids().forEach((id) => {
      const el = elOf(id); if (!el) return;
      if (!isGame(id) && info()) { let sz = null; try { sz = JSON.parse((o.ls || {})['cc-size-' + id] || 'null'); } catch (e) { /* none */ } if (sz && sz.w && sz.h) info().setSize(id, sz.w, sz.h); else info().clearSize(id); }
      const p = (o.pos || {})[id]; if (p && !(isGame(id) && fusedGame(id))) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; }
      const e = prof().panels[id]; el.toggleAttribute('data-cc-locked', !!(e && e.lock)); el.toggleAttribute('data-cc-fade', !!(e && e.fade)); el.style.opacity = e && e.o != null && e.o < 1 ? String(e.o) : '';
      remember(id, el);
    });
    ghIds.forEach((id) => { const e = elOf(id); if (e) e.removeAttribute('data-cc-gh'); }); ghIds.clear();   // panels that were hidden behind a tab are back at once
    applyLook(o.look); try { localStorage.removeItem(LS_BK); } catch (e) { /* none */ }
    refreshBar(); return true;
  }
  // one level of undo for bulk changes (Tidy up, Reset all)
  let undoSnap = null;
  const snapNow = () => {
    const pn = JSON.parse(JSON.stringify(prof().panels));
    ids().forEach((id) => { const el = elOf(id); if (!visible(el)) return; const L = parseFloat(el.style.left), T = parseFloat(el.style.top); if (Number.isFinite(L) && Number.isFinite(T)) { const q = pn[id] = pn[id] || {}; q.x = L; q.y = T; } });
    undoSnap = JSON.stringify({ name: db.active, panels: pn, groups: prof().groups || [] });
  };
  function undo() {
    if (!undoSnap) return; const o = JSON.parse(undoSnap); undoSnap = null; if (o.name !== db.active) return;
    prof().panels = o.panels; prof().groups = o.groups; save();
    ids().forEach((id) => { const el = elOf(id); if (el) { applyEntry(id, el); remember(id, el); } });
  }
  // lay the open ScapeLite panels out in neat rows without overlap (locked panels stay where they are)
  function tidy() {
    snapNow();
    const items = ourIds().map((id) => ({ id, el: elOf(id) })).filter((v) => visible(v.el) && !(prof().panels[v.id] || {}).lock && !v.el.hasAttribute('data-cc-gh'))
      .map((v) => ({ id: v.id, el: v.el, r: v.el.getBoundingClientRect() })).sort((a, b) => b.r.height - a.r.height);
    const fixed = ourIds().map(elOf).filter((e) => visible(e) && e.dataset && (prof().panels[e.id] || {}).lock).map((e) => e.getBoundingClientRect());
    let x = 8, y = Math.max(70, ((window.__ccEdge && window.__ccEdge.top) || 0) + 8), rowH = 0; const gap = 8;
    items.forEach((v) => {
      if (x + v.r.width > innerWidth - 8 && x > 8) { x = 8; y += rowH + gap; rowH = 0; }
      v.el.style.left = Math.round(x) + 'px'; v.el.style.top = Math.round(y) + 'px';
      const en = ent(v.id); en.x = Math.round(x); en.y = Math.round(y); remember(v.id, v.el);
      x += v.r.width + gap; rowH = Math.max(rowH, v.r.height);
    });
    save();
  }
  function buildBar() {
    bar = h('div'); bar.id = 'cc-ed-bar';
    ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => bar.addEventListener(t, (e) => e.stopPropagation()));
    bar.appendChild(h('span', 'ttl', 'Layout editor'));
    const sel = h('select'); sel.title = 'Layout'; sel.addEventListener('change', () => { backTo = null; applyProfile(sel.value); }); bar.appendChild(sel);
    const au = h('select'); au.className = 'auto'; au.title = 'When this layout is used';
    [['', 'Used when I pick it'], ['raid', 'Switch to it in raids']].forEach(([v, t]) => { const o = h('option', null, t); o.value = v; au.appendChild(o); });
    au.addEventListener('change', () => { const v = au.value; if (v) Object.keys(db.profiles).forEach((n) => { if (db.profiles[n].auto === v) delete db.profiles[n].auto; }); if (v) prof().auto = v; else delete prof().auto; save(); });
    bar.appendChild(au);
    const mk = (t, title, fn) => { const b = h('button', null, t); b.title = title; b.addEventListener('click', fn); bar.appendChild(b); return b; };
    mk('Save as…', 'Save the current arrangement as a new layout', () => showIO('save'));
    mk('Delete', 'Delete the selected layout', () => { if (Object.keys(db.profiles).length < 2) return; delete db.profiles[db.active]; db.active = Object.keys(db.profiles)[0]; save(); applyProfile(db.active); });
    mk('Export', 'Show this layout as text', () => showIO('export'));
    mk('Import', 'Load a layout from text', () => showIO('import'));
    bar.appendChild(h('span', 'sep'));
    const lb = h('label'); const cb = h('input'); cb.type = 'checkbox'; cb.className = 'snap'; cb.addEventListener('change', () => { db.snap = cb.checked; save(); });
    lb.appendChild(cb); lb.appendChild(document.createTextNode('Snap')); lb.title = 'Snap to screen edges, other panels and a grid (hold Shift to move freely)'; bar.appendChild(lb);
    mk('Show all panels', 'Open every ScapeLite panel so you can place it (closed again when you finish)', () => {
      OPENABLE.forEach((n) => { const o = window[n]; if (!o || typeof o.toggle !== 'function') return; let open = false; try { open = !!o.isOpen; } catch (e) { /* unknown */ } if (!open) { try { o.toggle(); opened.push(n); } catch (e) { /* skip */ } } });
    });
    mk('Tidy up', 'Arrange the open ScapeLite panels in neat rows (Undo brings the old spots back)', tidy);
    mk('Undo', 'Undo the last Tidy up or Reset all', undo);
    mk('Reset all', 'Put every panel back to its default size, scale, opacity and position', () => {
      snapNow();
      ids().forEach((id) => { const el = elOf(id); delete prof().panels[id]; if (el && isGame(id)) { el.style.opacity = ''; el.removeAttribute('data-cc-locked'); } else if (el) { el.style.opacity = ''; el.removeAttribute('data-cc-locked'); info().setMult(id, 0); info().clearSize(id); const p = window.__ccNextPos ? window.__ccNextPos() : { x: 150, y: 70 }; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; } });
      save();
    });
    if (window.__ccDefaultLayout) {
      bar.appendChild(h('span', 'sep'));
      mk('ScapeLite default', 'A ready-made arrangement of every panel, worked out for this window size. Your own layouts stay as they are; "Back to my old layout" undoes it.', () => { useDefault(); refreshBar(); });
      const bk = mk('Back to my old layout', 'Put the panels, sizes, scales and look back the way they were before you used the ScapeLite default', () => { backToOld(); }); bk.className = 'bk'; bk.style.display = 'none';
    }
    const done = mk('Done', 'Leave the editor', () => api.toggle()); done.classList.add('on');
    const io = h('div', 'io'); io.appendChild(h('div', 'lab')); io.appendChild(h('textarea')); const row = h('div', 'row'); const go = h('button', 'go', 'OK'); go.addEventListener('click', ioGo); row.appendChild(go); io.appendChild(row); bar.appendChild(io);
    // look: palette, density, accent and text size (the same settings as Settings > Plugins > Panels)
    const look = h('div', 'look');
    const PS = window.__ccPluginSettings, put = (k, v) => { try { PS && PS.set && PS.set(k, v); if (window.__ccUI) window.__ccUI.applyTheme(); } catch (e) { /* ignore */ } };
    const mkSel = (label, key, opts, def) => { const l = h('label', null, label); const s = h('select'); opts.forEach(([v, t]) => { const o = h('option', null, t); o.value = v; s.appendChild(o); }); s.value = String(setting(key, def)); s.addEventListener('change', () => put(key, key === 'uiFontPx' ? Number(s.value) : s.value)); l.appendChild(s); look.appendChild(l); };
    mkSel('Colours', 'uiPalette', [['default', 'ScapeLite'], ['game', 'Match game'], ['colourblind', 'Colour-blind safe']], 'default');
    mkSel('Spacing', 'uiDensity', [['compact', 'Compact'], ['cozy', 'Cozy'], ['roomy', 'Roomy']], 'cozy');
    mkSel('Text', 'uiFontPx', [[0, 'Default'], [12, 'Small'], [14, 'Medium'], [16, 'Large'], [18, 'Huge']], 0);
    const al = h('label', null, 'Accent'); const ac = h('input'); ac.type = 'color'; const cur = String(setting('uiAccent', '') || ''); ac.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffd24a'; ac.addEventListener('input', () => put('uiAccent', ac.value)); al.appendChild(ac);
    const ar = h('button', null, 'Default'); ar.title = 'Back to the gold accent'; ar.addEventListener('click', () => { put('uiAccent', ''); ac.value = '#ffd24a'; }); al.appendChild(ar); look.appendChild(al);
    bar.appendChild(look);
    bar.appendChild(h('div', 'hint', 'Drag a panel to move it · Shift = no snapping · click a panel, then arrow keys nudge it (Shift = 10 px) · corner = resize · Esc = done · Ctrl+Alt+L opens and closes this editor'));
    root.appendChild(bar); refreshBar();
  }
  const typing = (e) => { const t = e.target; return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); };
  const escH = (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'l' || e.key === 'L') && !typing(e)) { e.preventDefault(); e.stopImmediatePropagation(); api.toggle(); return; }   // Ctrl+Alt+L
    if (!editing) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); api.toggle(); return; }
    // arrow keys nudge the selected panel (Shift = 10 px); never inside a text field
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d && sel && !typing(e)) {
      const el = elOf(sel), en = prof().panels[sel] || {}; if (!el || en.lock || (isGame(sel) && fusedGame(sel))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const st = e.shiftKey ? 10 : 1, k = isGame(sel) ? 1 : 1, L = parseFloat(el.style.left) || 0, T = parseFloat(el.style.top) || 0;
      el.style.left = (L + d[0] * st * k) + 'px'; el.style.top = (T + d[1] * st * k) + 'px';
      const q = ent(sel); q.x = parseFloat(el.style.left); q.y = parseFloat(el.style.top); save(); remember(sel, el);
    }
  };
  window.addEventListener('keydown', escH, true);

  const api = {
    version: 1,
    get isOpen() { return editing; },
    toggle() {
      if (!on() || !info()) return;
      editing = !editing;
      if (editing) {
        root = h('div'); root.id = 'cc-ed-root'; document.body.appendChild(root); buildBar(); raf = requestAnimationFrame(loop);
      } else {
        cancelAnimationFrame(raf); if (root) root.remove(); root = null; bar = null; Object.keys(frames).forEach((k) => delete frames[k]); guides = [];
        opened.forEach((n) => { try { if (window[n] && window[n].isOpen) window[n].toggle(); } catch (e) { /* ignore */ } }); opened = [];
        ids().forEach((id) => { const el = elOf(id); if (el) remember(id, el); });
      }
    },
    profiles: () => Object.keys(db.profiles),
    active: () => db.active,
    apply: applyProfile,
    useDefault, backToOld, get canGoBack() { return !!readBk(); },
    teardown() {
      clearInterval(timer); cancelAnimationFrame(raf); cancelAnimationFrame(gRaf); clearTimeout(gTimer); if (root) root.remove(); if (gRoot) gRoot.remove(); ghIds.forEach((id) => { const e = elOf(id); if (e) e.removeAttribute('data-cc-gh'); });
      document.removeEventListener('mousedown', lockH, true); document.removeEventListener('pointerdown', lockH, true); window.removeEventListener('keydown', escH, true);
      document.querySelectorAll('[data-cc-locked]').forEach((e) => e.removeAttribute('data-cc-locked')); document.querySelectorAll('[data-cc-fade]').forEach((e) => e.removeAttribute('data-cc-fade'));
      style.remove(); if (window[NS] && window[NS].teardown === api.teardown) delete window[NS];
      return 'cc ui-layout torn down';
    },
  };
  // a layout can take over while a raid is on (the raid DPS window or a raid lobby is up) and hand back afterwards
  let ctxRaid = false, backTo = null;
  function raidNow() {
    try { const b = window.__ccBridge; if (b && typeof b.lobby === 'function' && b.lobby()) return true; } catch (e) { /* bridge not ready */ }
    const u = uiBox(); const p = u && u.querySelector(':scope > [class*="raid-contrib-hud"]'); return !!p && p.getClientRects().length > 0;
  }
  function autoSwitch() {
    if (editing) return;
    const r = raidNow(); if (r === ctxRaid) return; ctxRaid = r;
    if (r) { const n = Object.keys(db.profiles).find((k) => db.profiles[k].auto === 'raid'); if (n && n !== db.active) { backTo = db.active; applyProfile(n); } }
    else if (backTo) { const n = backTo; backTo = null; if (db.profiles[n]) applyProfile(n); }
  }
  const timer = setInterval(() => { try { follow(); autoSwitch(); if (editing) placeBar(); if (editing && !on()) api.toggle(); } catch (e) { /* keep following */ } }, 500);
  window[NS] = api;
  return 'cc ui-layout loaded';
})();
