// Scapewatch walking countdown overlay.
// Display-only: reads the HUD's own "Moving to X" state (already shown to
// the player) and the game's own served map-node data (fetched live from
// the same URL the game itself uses), and shows an ETA. Never reads or
// writes anything about game state beyond what's already visible, never
// clicks/selects/submits anything. Dragging/resizing this panel is OUR
// OWN UI, not an action on the game -- same category as every other
// button/handle this mod has already added.
//
// Styled to match the game's own floating task-progress widget's INNER
// content exactly -- confirmed live, 2026-10-06, by pulling its real
// markup/computed styles (.float-task-inner/.float-icon/.float-details/
// .float-bar/.float-bar-fill/.float-bar-text). Reuses those same class
// names (the purely-cosmetic inner ones only -- never
// .floating-current-task/.panel-floating/.panel-titlebar, which are wired
// to the game's own drag/minimize/reattach panel system) so the CONTENT
// renders pixel-identical to a native task widget without copying a
// single CSS rule by hand. The titlebar/drag/resize CHROME around it is
// our own custom styling, not a reuse of the native titlebar -- added
// 2026-10-07 at the user's request ("the current task has a title bar,
// lets add that... aswell as making it movable and resizeable"),
// deliberately NOT hooking into the native panel system (which isn't
// built for arbitrary injected elements) to avoid any risk of fighting it.
//
// Two bars, same idea as a task's own [current/eta/target] + [[email protected]%/next]
// pair:
//   - Bar 1 (color-graded red->green as the trip progresses, see "ETA
//     color grading" below): time elapsed / ETA remaining / total
//     estimated walk time.
//   - Bar 2 (blue, "level-fill"): current Vigor level / XP-to-next
//     percent / next Vigor level -- read live from the Skills panel's own
//     .skill-progress-fill width, since Vigor is the stat that governs
//     movement speed (the "extra info for free" angle: you already see
//     your walk ETA, might as well also see the stat that determines it).
//
// How it works -- confirmed live, 2026-10-06/07, by reading the game's own
// bundle (not guessed):
//   - .ingame-hud-state gets class "state-moving" and text
//     "Moving to <destination name>" while walking (found via the
//     bundle's _computeStateText, which builds this same text from an
//     internal destinationNodeId + nodeMap -- not reachable from outside
//     the bundle, so this re-derives the same thing from the DOM text
//     instead). Gets class "state-acting" and text like "Gathering Tin
//     Bar..."/"Smithing..." while performing the active queued task.
//   - https://play.scapewatch.com/shared/data/nodes.json (served live,
//     same file an asar extract of the installed game also has) gives
//     {id, name, type, position:{x,y}} for every map location -- matches
//     the HUD's destination name to real coordinates. Indexed both by
//     lowercased `name` (for matching "Moving to X" HUD text) and by `id`
//     (for matching the queue panel's `data-node-id`, see below).
//   - Movement speed formula (Constants.js, also confirmed from the real
//     extracted data): 10 + (vigorLevel+1) * (0.1 + 0.0005*vigorLevel)
//     px/sec, read live from the Skills panel's Vigor level.
//
// MEASURED SPEED (2026-10-07, replaces the formula as the primary ETA): while
// walking to the current task's node, the game's own floating Current Task
// widget (`#task-display .float-task-node`) reads "<Node name> (N)" where N is
// the live remaining route distance (confirmed live: 1971 -> 1786 over 12 s,
// ticking ~once a second, ~15.4/s at Vigor 33 vs 13.96 from the formula --
// the ~10% gap is a permanent bonus the formula doesn't model). Speed =
// distance delta / time between N changes; ETA = N / speed. N is the real
// route length, so winding paths are handled without the correction factor.
// The formula (x correction) is only the fallback for the first few seconds
// of a walk and for walks where no N is shown (e.g. a bank trip). Speed
// buffs (potions etc.) are detected the same way: measured speed vs a
// learned baseline measured/formula ratio (see "Speed buff detection").
//
// Known limitation (unchanged for the fallback): the speed formula is BASE Vigor speed
// only -- doesn't account for movement buffs (potion, telescope,
// unlocks, Fortify talent, Collector bonus). The ETA self-calibration
// below (see "ETA correction factor") absorbs most of this in practice,
// since it learns from real observed trip times rather than trusting the
// formula blindly, but it's still an approximation, not exact physics.
//
// Position tracking: there's no live "where am I right now" the page can
// read directly, so this infers it two ways now (fixed 2026-10-07, see
// "Continuous position correction" below for why a single source wasn't
// enough): (1) whatever node you were last seen ARRIVING at via a tracked
// walk, same as before, and (2) whatever node the currently-ACTIVE queued
// task says you're AT, reaffirmed continuously while idle/acting, not
// just once per arrival. Persisted to localStorage so (1) only has to
// happen once, ever, across restarts.
//
// ETA correction factor: the base speed formula assumes a straight line
// between two points, but real in-game walking routes follow paths/roads
// that are usually LONGER than that straight-line (confirmed indirectly,
// 2026-10-07: the game's own `shared/data/paths.json` stores explicit
// multi-point bank-to-bank routes, not straight lines, though it only
// covers bank-to-bank pairs specifically -- not enough data to route
// arbitrary node-to-node walks directly). Rather than guess at a fixed
// fudge factor, this self-calibrates from real completed trips: each
// arrival compares the ACTUAL elapsed time against what was predicted,
// and blends that ratio into a persisted correction factor (exponential
// moving average, so one weird trip -- interrupted, or an unusually
// windy route -- doesn't swing it wildly) applied to every future
// estimate. Starts at 1.0 (no correction) and converges toward reality
// after a handful of real walks. Directly fixes the "stuck on arriving
// for a solid minute" bug the user reported: that's a straight-line
// estimate finishing well before the real (longer, winding) route does.

(function () {
  'use strict';
  const NS = '__ccWalkingCountdown';

  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const POLL_MS = 250; // halved from 500 -- short trips (e.g. a quick bank hop) were being missed entirely between polls
  const NODES_URL = 'https://play.scapewatch.com/shared/data/nodes.json';

  let nodesByName = null; // lowercased name -> {x,y}
  let nodesById = null;   // id -> {x,y} -- for matching the queue panel's data-node-id
  let loadingNodes = false;
  async function ensureNodes() {
    if (nodesByName || loadingNodes) return;
    loadingNodes = true;
    try {
      const res = await fetch(NODES_URL);
      const data = await res.json();
      nodesByName = {};
      nodesById = {};
      for (const n of (data.nodes || [])) {
        if (n && n.position) {
          if (n.name) nodesByName[n.name.toLowerCase()] = n.position;
          if (n.id) nodesById[n.id] = n.position;
        }
      }
    } catch (e) {
      console.warn('[cc] walking-countdown: could not load nodes.json', e);
    } finally {
      loadingNodes = false;
    }
  }
  ensureNodes();

  // Cached document.querySelector: the game's DOM has ~130k nodes, so a global query costs ~1 ms. Elements are
  // re-validated with isConnected; "not found" is only re-queried every few seconds.
  const __qc = new Map();
  function qc(sel) {
    const e = __qc.get(sel);
    if (e && e.el && e.el.isConnected) return e.el;
    if (e && !e.el && performance.now() - e.t < 4000) return null;
    const el = document.querySelector(sel);
    __qc.set(sel, { el, t: performance.now() });
    return el;
  }
  function readVigor() {
    const cell = qc('.skill-cell[data-skill-id="vigor"]');
    if (!cell) return null;
    const levelEl = cell.querySelector('.skill-level');
    const fillEl = cell.querySelector('.skill-progress-fill');
    const level = levelEl ? parseInt(levelEl.textContent, 10) : NaN;
    const pct = fillEl ? parseFloat(fillEl.style.width) : NaN;
    if (!Number.isFinite(level)) return null;
    return { level, pct: Number.isFinite(pct) ? pct : 0 };
  }
  function movementSpeedPxPerSec(vigorLevel) {
    return 10 + (vigorLevel + 1) * (0.1 + 0.0005 * vigorLevel);
  }

  // --- measured speed ----------------------------------------------------
  // Remaining route distance "(N)" from the game's own Current Task widget.
  // Only trusted when the widget's node name is the walk's destination.
  function readTaskDistance(destName) {
    const node = document.querySelector('#task-display .float-task-node');
    if (!node) return null;
    const m = (node.textContent || '').trim().match(/^(.*?)\s*\((\d+)\)$/);
    if (!m) return null;
    if (destName && m[1].trim().toLowerCase() !== destName.toLowerCase()) return null;
    return parseInt(m[2], 10);
  }
  // Plugins-tab toggles (plugins-settings-ui.js); default ON if not loaded yet.
  const settingOn = key => { try { return !(window.__ccPluginSettings && window.__ccPluginSettings.get(key) === false); } catch (e) { return true; } };
  const MEASURE_MIN_SEC = 3;  // window needed before the measurement replaces the formula
  const MEASURE_WINDOW_MS = 8000; // keep ~8 s of N changes, however often the game updates N
  function recordDistance(trip, n, now) {
    const c = trip.changes;
    const last = c[c.length - 1];
    if (!last || last.n !== n) c.push({ t: now, n, init: !last });
    while (c.length > 2 && now - c[0].t > MEASURE_WINDOW_MS) c.shift();
    trip.curDist = n;
    trip.curDistAt = c[c.length - 1].t;
    if (trip.startDist == null) trip.startDist = n;
    // The very first sample (init) was stamped at an arbitrary moment, not at
    // a real change, so it never anchors the measurement.
    const a = c.find(x => !x.init), b = c[c.length - 1];
    if (a && a !== b) {
      const dt = (b.t - a.t) / 1000, dd = a.n - b.n;
      if (dt >= MEASURE_MIN_SEC && dd > 0) trip.speed = dd / dt;
    }
  }

  // The game's own Unlocks panel states the player's total (unbuffed)
  // movement speed: "Total Movement Speed +51% (15.1 steps/sec)" in
  // `.unlocks-perk-row[data-perk="movespeed"]`. That's the authoritative base
  // speed (Vigor, telescopes, collector, fortress ... all included), so it
  // replaces the Vigor-only formula for the fallback ETA and is the baseline
  // a measured walk is compared against. Cached in localStorage since the
  // row only exists once the Unlocks panel has been built.
  const TOTAL_SPEED_KEY = 'cc-walk-total-speed';
  function readTotalSpeed() {
    const row = qc('.unlocks-perk-row[data-perk="movespeed"] .unlocks-perk-row-label');
    if (row) {
      const m = (row.firstChild ? row.firstChild.textContent : row.textContent).match(/\(([\d.]+)\s*steps?\/sec\)/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0) { try { localStorage.setItem(TOTAL_SPEED_KEY, String(v)); } catch (e) {} return v; }
      }
    }
    try { const c = parseFloat(localStorage.getItem(TOTAL_SPEED_KEY)); if (c > 0) return c; } catch (e) {}
    return null;
  }

  // --- Speed buff detection ----------------------------------------------
  // No game state says "speed potion active", so: learn the player's normal
  // measured/formula ratio (BASE_RATIO_KEY -- captures permanent bonuses the
  // formula lacks) and call a walk buffed when its ratio clearly exceeds it.
  // The baseline only moves down fast and up slowly, so a potion walk can't
  // poison it. Any Active Potions row that isn't food/discovery/teleport is
  // reported by its data-style, which also names the potion type once seen.
  const BASE_RATIO_KEY = 'cc-walk-base-speed-ratio';
  const BUFF_THRESHOLD = 1.08;
  const KNOWN_POTION_STYLES = ['food', 'discovery', 'teleport'];
  function loadBaseRatio() {
    try { const v = parseFloat(localStorage.getItem(BASE_RATIO_KEY)); if (Number.isFinite(v) && v > 0) return v; } catch (e) {}
    return null;
  }
  let baseRatio = loadBaseRatio();
  function updateBaseRatio(ratio) {
    if (baseRatio == null || ratio < baseRatio * 0.95) baseRatio = ratio;
    else if (ratio < baseRatio * BUFF_THRESHOLD) baseRatio = baseRatio * 0.7 + ratio * 0.3;
    else return; // buffed walk -- leave the baseline alone
    try { localStorage.setItem(BASE_RATIO_KEY, String(baseRatio)); } catch (e) {}
  }
  function unknownPotionStyles() {
    const out = [];
    for (const r of document.querySelectorAll('.active-potions-body .potion-row[data-style]')) {
      const st = r.getAttribute('data-style');
      if (!KNOWN_POTION_STYLES.includes(st)) out.push(st);
    }
    return out;
  }

  // --- ETA correction factor --------------------------------------------
  const ETA_CORRECTION_KEY = 'cc-walk-eta-correction';
  function loadEtaCorrection() {
    try {
      const v = parseFloat(localStorage.getItem(ETA_CORRECTION_KEY));
      if (Number.isFinite(v) && v > 0) return v;
    } catch (e) {}
    return 1.0;
  }
  function saveEtaCorrection(v) {
    try { localStorage.setItem(ETA_CORRECTION_KEY, String(v)); } catch (e) {}
  }
  let etaCorrection = loadEtaCorrection();

  // --- overlay element, built from the game's own cosmetic classes ----
  const el = document.createElement('div');
  el.id = 'cc-walk-countdown';
  el.hidden = true;
  el.innerHTML = `
    <div class="cc-walk-slide">
    <div class="cc-walk-titlebar" id="cc-walk-titlebar">
      <span class="cc-walk-titlebar-label">Walking</span>
    </div>
    <div class="float-task-inner">
      <div class="float-icon"><img class="float-icon-img" src="/assets/icons/skills/vigor.png" alt="vigor"></div>
      <div class="float-details">
        <div class="float-task-name cc-walk-dest">Walking</div>
        <div class="float-task-node cc-walk-vigor-label">Vigor</div>
        <div class="float-bar">
          <div class="float-bar-fill task-fill cc-walk-time-fill" style="width:0%"></div>
          <div class="float-bar-text">
            <span class="cc-walk-elapsed">0s</span>
            <span class="bar-center cc-walk-eta">--</span>
            <span class="cc-walk-total">--</span>
          </div>
        </div>
        <div class="float-bar">
          <div class="float-bar-fill level-fill cc-walk-vigor-fill" style="width:0%"></div>
          <div class="float-bar-text">
            <span class="cc-walk-vigor-lvl">Lv -</span>
            <span class="bar-center cc-walk-vigor-pct">-%</span>
            <span class="cc-walk-vigor-next">Lv -</span>
          </div>
        </div>
      </div>
    </div>
    </div>
    <div class="cc-walk-resize-handle" id="cc-walk-resize-handle" title="Drag to resize"></div>`;
  const style = document.createElement('style');
  style.id = 'cc-walk-countdown-style';
  style.textContent = `
#cc-walk-countdown{position:fixed;top:12px;left:50%;transform:translateX(-50%) scale(1);
  transform-origin:top left;z-index:99985}
#cc-walk-countdown[hidden]{display:none!important}
#cc-walk-countdown .float-task-inner{border-radius:0 0 6px 6px;pointer-events:none}
#cc-walk-countdown .cc-walk-titlebar{display:flex;align-items:center;height:22px;padding:0 8px;
  background:rgba(10,10,14,.92);border:1px solid rgba(255,255,255,.14);border-bottom:none;
  border-radius:6px 6px 0 0;cursor:grab;user-select:none;font:12px/22px system-ui,sans-serif;color:#ccc}
#cc-walk-countdown .cc-walk-titlebar:active{cursor:grabbing}
#cc-walk-countdown .cc-walk-titlebar-label{pointer-events:none}
#cc-walk-countdown .cc-walk-resize-handle{position:absolute;right:0;bottom:0;width:14px;height:14px;
  cursor:nwse-resize;border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);
  border-radius:0 0 6px 0}
#cc-walk-countdown .cc-walk-resize-handle:hover{border-color:rgba(255,255,255,.7)}
/* Drawer mode: docked flush under the Current Task panel, same width + scale, slides out of its bottom edge. */
#cc-walk-countdown.cc-walk-drawer{position:absolute;top:calc(100% - 1px);left:0;width:100%;overflow:hidden;border-radius:0 0 6px 6px;z-index:0;transform:none}
#cc-walk-countdown .cc-walk-slide{transition:transform .34s cubic-bezier(.2,.85,.25,1)}
#cc-walk-countdown.cc-walk-drawer .cc-walk-slide{transform:translateY(-101%)}
#cc-walk-countdown.cc-walk-drawer.cc-open .cc-walk-slide{transform:translateY(0)}
#cc-walk-countdown.cc-walk-drawer .cc-walk-titlebar,#cc-walk-countdown.cc-walk-drawer .cc-walk-resize-handle{display:none}
#cc-walk-countdown.cc-walk-drawer .float-task-inner{border-radius:0 0 6px 6px;border-top:0;padding:5px 10px 7px;min-height:0}
#cc-walk-countdown.cc-walk-drawer .float-icon,#cc-walk-countdown.cc-walk-drawer .cc-walk-vigor-label{display:none}
body.cc-walk-open .floating-current-task .float-task-inner{border-bottom-left-radius:0;border-bottom-right-radius:0}
`;

  function insertOverlay() {
    if (!document.body) return false;
    if (!document.getElementById('cc-walk-countdown-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-walk-countdown')) document.body.appendChild(el);
    return true;
  }

  // --- position/size persistence + drag/resize --------------------------
  // If the player has never manually moved/resized this panel, it docks
  // itself under the real task widget (old behavior, good default for a
  // first-time look). The MOMENT they drag or resize it even once, that
  // becomes authoritative and auto-docking stops permanently -- same
  // "once you've put a window somewhere, stay there" expectation as any
  // real native panel.
  const LAYOUT_KEY = 'cc-walk-panel-layout';
  function loadLayout() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null; // null = auto-dock mode
  }
  function saveLayout(layout) {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {}
  }
  let layout = loadLayout(); // {x, y, width, scale} once set, else null (auto-dock)
  const DEFAULT_WIDTH = 340; // matches the real task widget's own typical width, confirmed live 2026-10-06

  // `.float-task-inner` has NO width of its own outside the native
  // `.floating-current-task` panel's ancestry -- confirmed live,
  // 2026-10-07: a detached instance collapsed to 24px (shrink-wrapped to
  // its icon alone). Auto-dock mode gets this for free by copying the
  // real widget's width every tick; manual layout mode has no such
  // anchor to copy from, so `layout.width` is captured explicitly at the
  // moment the player first drags/resizes and persisted alongside
  // position -- without it the panel would silently collapse the instant
  // auto-docking stopped.
  let drawerOpen = false, hideTimer = 0;
  function drawerHost() {
    if (!settingOn('walkDrawerMode')) return null;
    const h = document.querySelector('.floating-current-task');
    const r = h ? h.getBoundingClientRect() : null;
    return r && r.width > 0 && r.height > 0 ? { h, r } : null;
  }
  function showDrawer() {
    clearTimeout(hideTimer);
    el.hidden = false;
    // Also re-opens when the open class was lost (e.g. the host panel was briefly hidden and applyLayout fell back), not only on first show.
    drawerOpen = true;
    if (!el.classList.contains('cc-open')) { void el.offsetWidth; requestAnimationFrame(() => { if (drawerOpen) { el.classList.add('cc-open'); document.body.classList.add('cc-walk-open'); } }); }
  }
  function hideDrawer() {
    if (!el.classList.contains('cc-walk-drawer')) { el.hidden = true; drawerOpen = false; document.body.classList.remove('cc-walk-open'); return; }
    if (!drawerOpen && el.hidden) return;
    drawerOpen = false;
    el.classList.remove('cc-open');
    document.body.classList.remove('cc-walk-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!drawerOpen) el.hidden = true; }, 380);
  }
  function applyLayout() {
    const dh = drawerHost();
    if (dh) {
      // Lives INSIDE the Current Task panel (absolutely positioned under it): it then shares the panel's scale, zoom,
      // position and stacking level, so modals such as Settings correctly cover it. Re-attached if the game rebuilds the panel.
      el.classList.add('cc-walk-drawer');
      if (el.parentElement !== dh.h) dh.h.appendChild(el);
      el.style.top = ''; el.style.left = ''; el.style.width = ''; el.style.transform = '';
      return;
    }
    if (el.parentElement !== document.body && document.body) document.body.appendChild(el);
    el.classList.remove('cc-walk-drawer', 'cc-open');
    if (layout) {
      el.style.top = layout.y + 'px';
      el.style.left = layout.x + 'px';
      el.style.width = layout.width + 'px';
      el.style.transform = 'scale(' + layout.scale + ')';
      return;
    }
    // Auto-dock directly underneath the real floating task widget (same
    // left/width, positioned right below its bottom edge) when it's on
    // screen -- confirmed live, 2026-10-07, that it stays visible while
    // walking (showing the next queued task) and a fixed top-center
    // position was overlapping it. Falls back to fixed top-center
    // otherwise.
    const taskEl = document.querySelector('.floating-current-task');
    const rect = taskEl ? taskEl.getBoundingClientRect() : null;
    if (rect && rect.width > 0) {
      el.style.top = (rect.bottom + 8) + 'px';
      el.style.left = rect.left + 'px';
      el.style.width = rect.width + 'px';
      el.style.transform = 'scale(1)';
    } else {
      el.style.top = '12px';
      el.style.left = '50%';
      el.style.width = DEFAULT_WIDTH + 'px';
      el.style.transform = 'translateX(-50%) scale(1)';
    }
  }

  function wireDragAndResize() {
    const titlebar = el.querySelector('#cc-walk-titlebar');
    const handle = el.querySelector('#cc-walk-resize-handle');
    if (titlebar.__ccWired) return;
    titlebar.__ccWired = true;
    handle.__ccWired = true;

    titlebar.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const startLeft = rect.left, startTop = rect.top;
      const scale = layout ? layout.scale : 1;
      // Base (unscaled) width: if already in manual layout, trust the
      // persisted value over re-deriving it (avoids float drift across
      // repeated drags); if still auto-docked, the element's current
      // rendered width at scale 1 -- set every tick by applyLayout() --
      // IS the base width directly.
      const width = layout ? layout.width : rect.width;
      function onMove(ev) {
        // Clamp: at least 80 px x 30 px of the panel always stays on screen.
        const x = Math.max(80 - rect.width, Math.min(innerWidth - 80, startLeft + (ev.clientX - startX)));
        const y = Math.max(0, Math.min(innerHeight - 30, startTop + (ev.clientY - startY)));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = width + 'px';
        el.style.transform = 'scale(' + scale + ')';
        layout = { x, y, width, scale };
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (layout) saveLayout(layout);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startScale = layout ? layout.scale : 1;
      const width = layout ? layout.width : rect.width; // base width stays fixed; only `scale` changes visual size
      const left = layout ? layout.x : rect.left;
      const top = layout ? layout.y : rect.top;
      function onMove(ev) {
        const dx = ev.clientX - startX;
        let scale = startScale + dx / width;
        scale = Math.max(0.6, Math.min(1.8, scale));
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = width + 'px';
        el.style.transform = 'scale(' + scale + ')';
        layout = { x: left, y: top, width, scale };
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (layout) saveLayout(layout);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- state tracking --------------------------------------------------
  const LAST_POS_KEY = 'cc-walk-last-pos';
  function loadLastKnownPos() {
    try {
      const raw = localStorage.getItem(LAST_POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore -- falls back to no reference, same as never having one */ }
    return null;
  }
  function saveLastKnownPos(pos) {
    try { localStorage.setItem(LAST_POS_KEY, JSON.stringify(pos)); } catch (e) { /* best effort */ }
  }

  let lastKnownPos = loadLastKnownPos(); // {x,y} -- best-effort, inferred
  let trip = null; // { destName, destPos, startPos, totalSec, startedAt } while actively walking

  function formatEta(sec) {
    if (sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function readMovingState() {
    const stateEl = document.querySelector('.ingame-hud-state');
    if (!stateEl) return { moving: false, acting: false, destName: null };
    const moving = stateEl.classList.contains('state-moving');
    const acting = stateEl.classList.contains('state-acting');
    if (!moving) return { moving: false, acting, destName: null };
    const m = (stateEl.textContent || '').match(/^Moving to (.+)$/);
    return { moving: true, acting: false, destName: m ? m[1].trim() : null };
  }

  // Continuous position correction -- fixes a real bug the user reported:
  // a quick round trip (e.g. to the bank and back) that's short enough to
  // slip between two POLL_MS ticks never registers as its own tracked
  // walk, so `lastKnownPos` silently goes stale and the NEXT real walk's
  // distance/ETA is computed from the wrong starting point. Rather than
  // relying solely on catching every walk's start/end, this reaffirms
  // `lastKnownPos` from an independent, continuously-available source
  // whenever the player is actively performing their queued task: the
  // unified queue panel's CURRENTLY RUNNING slot carries the same
  // `data-node-id` attribute Hover Info's distance-coloring already uses
  // (confirmed live, 2026-10-07, cross-checked against the real floating
  // task widget's own node-name text -- exact match). Self-heals a missed
  // short trip the moment the player resumes a recognizable task, without
  // needing to have caught the trip itself.
  function readCurrentActiveNodeId() {
    const row = document.querySelector('#unified-queue-panel .uq-row.uq-current .icon-scroll-row[data-node-id]');
    return row ? row.getAttribute('data-node-id') : null;
  }

  function updateVigorBar() {
    const v = readVigor();
    if (!v) return;
    el.querySelector('.cc-walk-vigor-fill').style.width = v.pct + '%';
    el.querySelector('.cc-walk-vigor-lvl').textContent = 'Lv ' + v.level;
    el.querySelector('.cc-walk-vigor-pct').textContent = v.pct.toFixed(1) + '%';
    el.querySelector('.cc-walk-vigor-next').textContent = 'Lv ' + (v.level + 1);
  }

  // "Vigor" row doubles as the speed readout: measured units/s, plus a buff
  // note when the walk is clearly faster than the player's learned baseline.
  function currentRatio() {
    if (!trip || trip.speed == null) return null;
        const v = readVigor();
    return trip.speed / movementSpeedPxPerSec(v ? v.level : 1);
  }
  // The Unlocks "Total Movement Speed" INCLUDES active potions (confirmed by
  // the player, 2026-10-07), so it can't itself be the no-potion baseline.
  // Learn that baseline instead: it drops immediately to any lower total
  // (potion expired / ran out) and creeps up slowly under non-buffed totals
  // (permanent gains: level-ups, telescopes ...). A total clearly above it
  // is a speed buff. This works even with no "(N)" distance on screen.
  const BASE_TOTAL_KEY = 'cc-walk-base-total-speed';
  let baseTotal = null;
  try { const v = parseFloat(localStorage.getItem(BASE_TOTAL_KEY)); if (v > 0) baseTotal = v; } catch (e) {}
  function updateBaseTotal(total) {
    if (!(total > 0)) return;
    if (baseTotal == null || total < baseTotal * 0.98) baseTotal = total;
    else if (total < baseTotal * BUFF_THRESHOLD) baseTotal = baseTotal * 0.9 + total * 0.1;
    else return; // buffed -- leave the baseline alone
    try { localStorage.setItem(BASE_TOTAL_KEY, String(baseTotal)); } catch (e) {}
  }
  // If the game's own breakdown text names a potion, quote that segment.
  function potionNote() {
    const d = document.querySelector('.unlocks-perk-row[data-perk="movespeed"] .unlocks-perk-row-desc');
    const seg = d ? (d.textContent || '').split(',').map(x => x.trim()).find(x => /potion/i.test(x)) : null;
    return seg ? seg.replace(/^\(|\)$/g, '') : null;
  }
  function updateSpeedLabel() {
    const label = el.querySelector('.cc-walk-vigor-label');
    const ratio = currentRatio();
    const total = readTotalSpeed();
    if (total) updateBaseTotal(total);
    let text = 'Vigor', color = '';
    if (ratio != null) text += ' \u00b7 ' + trip.speed.toFixed(1) + '/s';
    else if (trip && trip.effSpeed != null) text += ' \u00b7 ' + trip.effSpeed.toFixed(1) + '/s';
    let buffPct = null;
    if (total && baseTotal) { if (total > baseTotal * BUFF_THRESHOLD) buffPct = Math.round((total / baseTotal - 1) * 100); }
    else if (ratio != null && baseRatio != null && ratio > baseRatio * BUFF_THRESHOLD) buffPct = Math.round((ratio / baseRatio - 1) * 100);
    if (buffPct != null && settingOn('walkSpeedBuffDetect')) {
      const names = unknownPotionStyles(), note = potionNote();
      text += ' \u00b7 speed buff +' + buffPct + '%' + (note ? ' (' + note + ')' : names.length ? ' (' + names.join(', ') + ')' : '');
      color = '#ffd24a';
    }
    if (label.textContent !== text) label.textContent = text;
    label.style.color = color;
  }

  // Red (just started, hue 0) -> green (about to arrive, hue 120) as the
  // trip progresses -- requested 2026-10-07 ("color grading it from red
  // for very far and green to very close"). Same hue-interpolation
  // technique as Hover Info's task distance coloring, applied here to
  // trip PROGRESS instead of absolute distance.
  function colorForProgress(pct) {
    const hue = Math.max(0, Math.min(100, pct)) * 1.2; // 0 -> 0 (red), 100 -> 120 (green)
    return 'hsl(' + Math.round(hue) + ', 70%, 50%)';
  }

  // Separated out so it can be RETRIED on later ticks, not just once at
  // trip start -- fixed 2026-10-07 after confirming live a real race: if
  // this script (re)loads mid-walk, nodes.json's fetch may not have
  // resolved yet (or lastKnownPos may not exist yet) at the exact moment
  // the trip is first noticed, which used to permanently lock that trip
  // into "no ETA yet" for its entire duration even once nodes DID finish
  // loading moments later. Now any trip still missing totalSec gets
  // re-attempted every tick until it resolves (or the trip ends).
  function tryComputeTrip(destName, startedAt) {
    const destPos = nodesByName ? nodesByName[destName.toLowerCase()] : null;
    if (destPos && lastKnownPos) {
      const dx = destPos.x - lastKnownPos.x, dy = destPos.y - lastKnownPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vigor = readVigor();
      const speed = readTotalSpeed() || movementSpeedPxPerSec(vigor ? vigor.level : 1);
      const totalSec = (dist / speed) * etaCorrection;
      return { destName, destPos, startPos: lastKnownPos, totalSec, formulaSec: dist / speed, startedAt, changes: [], speed: null, curDist: null, startDist: null };
    }
    // No prior position fix yet, or destination not in nodes.json (e.g.
    // an instance/dungeon-local destination) -- can't show a time bar for
    // this one yet. Still track destName so lastKnownPos can update on
    // arrival once/if destPos resolves later.
    return { destName, destPos: destPos || null, startPos: lastKnownPos, totalSec: null, formulaSec: null, startedAt, changes: [], speed: null, curDist: null, startDist: null };
  }

  function tick() {
    ensureNodes();
    const { moving, acting, destName } = readMovingState();

    if (moving && destName) {
      if (!trip || trip.destName !== destName) {
        // Just started a new move (or we weren't tracking one yet).
        trip = tryComputeTrip(destName, Date.now());
      } else if (trip.totalSec == null) {
        // Same trip as last tick, but still missing an ETA -- retry,
        // preserving the ORIGINAL startedAt so elapsed-time tracking
        // doesn't reset once this does resolve.
        const retried = tryComputeTrip(destName, trip.startedAt);
        if (retried.totalSec != null) {
          // Keep any distance samples already collected for this walk.
          Object.assign(retried, { changes: trip.changes, speed: trip.speed, curDist: trip.curDist, curDistAt: trip.curDistAt, startDist: trip.startDist });
          trip = retried;
        }
      }

      // Measured speed (see header): once enough distance ticks are in, the
      // measured ETA = live remaining distance / measured speed replaces the
      // formula's. Interpolated between the game's ~1 s distance ticks.
      const nowMs = Date.now();
      if (settingOn('walkMeasuredSpeed')) {
        const dist = readTaskDistance(trip.destName);
        if (dist != null) recordDistance(trip, dist, nowMs);
      } else if (trip.speed != null) {
        // Toggled off mid-walk: drop the measurement, fall back to the formula.
        trip.speed = null; trip.curDist = null; trip.changes = [];
        const f = tryComputeTrip(trip.destName, trip.startedAt);
        trip.totalSec = f.totalSec;
      }
      // Until a measurement lands (~5 s of distance ticks), the game's own
      // stated total speed is the speed -- still distance-based, so it beats
      // the straight-line formula (which is wrong whenever the start
      // position is stale).
      trip.effSpeed = trip.speed != null ? trip.speed : (trip.curDist != null ? readTotalSpeed() : null);
      trip.measured = trip.curDist != null && trip.effSpeed != null;
      if (trip.measured) {
        const remainingM = Math.max(0, trip.curDist / trip.effSpeed - (nowMs - trip.curDistAt) / 1000);
        trip.totalSec = (nowMs - trip.startedAt) / 1000 + remainingM;
      }

      insertOverlay();
      applyLayout();
      showDrawer();
      wireDragAndResize();
      el.querySelector('.cc-walk-dest').textContent = 'Walking to ' + trip.destName;
      updateVigorBar();
      updateSpeedLabel();

      const fillEl = el.querySelector('.cc-walk-time-fill');
      const etaEl = el.querySelector('.cc-walk-eta');
      if (trip.totalSec != null) {
        const elapsed = (Date.now() - trip.startedAt) / 1000;
        const remaining = trip.totalSec - elapsed;
        const pct = Math.max(0, Math.min(100, (elapsed / trip.totalSec) * 100));
        const color = colorForProgress(pct);
        fillEl.style.width = pct + '%';
        fillEl.style.background = color;
        etaEl.style.color = color;
        el.querySelector('.cc-walk-elapsed').textContent = formatEta(Math.max(0, elapsed));
        etaEl.textContent = remaining > 0.3 ? (trip.measured ? '' : '~') + formatEta(remaining) : 'arriving...';
        el.querySelector('.cc-walk-total').textContent = (trip.measured ? '' : '~') + formatEta(trip.totalSec);
      } else {
        fillEl.style.width = '0%';
        fillEl.style.background = '';
        etaEl.style.color = '';
        el.querySelector('.cc-walk-elapsed').textContent = '--';
        etaEl.textContent = 'no ETA yet';
        el.querySelector('.cc-walk-total').textContent = '--';
      }
    } else {
      if (trip) {
        // Just arrived (or the move was interrupted). Calibrate the ETA
        // correction factor from the REAL elapsed time vs. what was
        // predicted -- see "ETA correction factor" in the header comment.
        // Skipped for degenerate cases: no totalSec to compare against,
        // or a trip under 1s (almost certainly an interrupted/cancelled
        // move, not a real data point).
        const actualElapsedSec = (Date.now() - trip.startedAt) / 1000;
        const ratioNow = currentRatio();
        if (ratioNow != null && actualElapsedSec > 6 && !readTotalSpeed()) updateBaseRatio(ratioNow);
        if (trip.formulaSec != null && trip.formulaSec > 0 && actualElapsedSec > 1) {
          const uncorrectedPredicted = trip.formulaSec;
          if (uncorrectedPredicted > 0) {
            const observedRatio = actualElapsedSec / uncorrectedPredicted;
            etaCorrection = etaCorrection * 0.7 + observedRatio * 0.3;
            etaCorrection = Math.max(0.5, Math.min(3, etaCorrection));
            saveEtaCorrection(etaCorrection);
          }
        }
        if (trip.destPos) {
          lastKnownPos = trip.destPos;
          saveLastKnownPos(lastKnownPos);
        }
        trip = null;
      }
      // Continuous correction while idle/acting -- see
      // readCurrentActiveNodeId()'s comment above.
      if (acting) {
        const activeNodeId = readCurrentActiveNodeId();
        const pos = activeNodeId && nodesById ? nodesById[activeNodeId] : null;
        if (pos && (!lastKnownPos || pos.x !== lastKnownPos.x || pos.y !== lastKnownPos.y)) {
          lastKnownPos = pos;
          saveLastKnownPos(lastKnownPos);
        }
      }
      if (insertOverlay()) { applyLayout(); hideDrawer(); }
    }
  }

  // Self-rescheduling instead of a fixed setInterval -- requested
  // 2026-10-07: update more frequently the closer the trip gets to
  // arriving, so the last stretch feels live instead of visibly stepping
  // in quarter-second jumps. Computed AFTER each tick() (so it reacts to
  // the trip state tick() just updated), using the CURRENT trip's
  // remaining time once one exists; falls back to the base POLL_MS
  // whenever there's no active trip with a known ETA to accelerate for.
  function nextPollDelay() {
    if (!trip || trip.totalSec == null) return POLL_MS;
    const remaining = trip.totalSec - (Date.now() - trip.startedAt) / 1000;
    if (remaining <= 3) return 80;
    if (remaining <= 8) return 150;
    return POLL_MS;
  }

  let timerId = null;
  function scheduleTick() {
    timerId = setTimeout(() => { tick(); scheduleTick(); }, nextPollDelay());
  }
  scheduleTick();
  insertOverlay();

  // ---- Collapsible Current Task ------------------------------------------------------------------------------
  // A small chevron in the Current Task title bar shrinks the widget to one line (the task name) with thin progress
  // bars under it; the Walking drawer below becomes a single plain bar with its time. Display only, remembered.
  const CT_LS = 'cc-ct-collapsed';
  let ctMin = false;
  try { ctMin = localStorage.getItem(CT_LS) === '1'; } catch (e) {}
  const ctEnabled = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('currentTaskCollapse'); return v !== false; } catch (e) { return true; } };
  const ctStyle = document.createElement('style');
  ctStyle.id = 'cc-ct-style';
  ctStyle.textContent = `
#task-display.cc-ct-min .float-icon,#task-display.cc-ct-min .float-task-node,#task-display.cc-ct-min .float-combat-info,#task-display.cc-ct-min .float-combat-toggles{display:none !important}
#task-display.cc-ct-min .float-task-inner{padding:3px 10px 5px !important;min-height:0 !important;gap:0 !important}
#task-display.cc-ct-min .float-details{width:100%;min-width:0}
#task-display.cc-ct-min .float-task-name{font-size:12.5px !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#task-display.cc-ct-min .float-bar{height:13px !important;min-height:0 !important;margin-top:3px !important}
#task-display.cc-ct-min .float-bar-text{display:flex !important;font-size:10px !important;line-height:13px !important;height:13px !important;padding:0 5px !important;align-items:center}
#task-display.cc-ct-min #cc-walk-countdown .float-icon,#task-display.cc-ct-min #cc-walk-countdown .float-bar:nth-of-type(n+2){display:none !important}
#task-display.cc-ct-min #cc-walk-countdown .float-task-inner{padding:2px 10px 4px !important}
#task-display.cc-ct-min #cc-walk-countdown .float-task-name{display:none !important}
#task-display.cc-ct-min #cc-walk-countdown .float-bar{height:13px !important;margin-top:0 !important}
#task-display.cc-ct-min #cc-walk-countdown .float-bar-text{display:flex !important;font-size:10px !important;line-height:13px !important;height:13px !important}
.cc-ct-btn svg{transition:transform .2s ease}
#task-display.cc-ct-min .cc-ct-btn svg{transform:rotate(180deg)}`;
  document.head.appendChild(ctStyle);
  function ctSync() {
    const t = document.getElementById('task-display');
    if (!t) return;
    const on = ctEnabled();
    t.classList.toggle('cc-ct-min', on && ctMin);
    let btn = t.querySelector('.cc-ct-btn');
    const btns = t.querySelector('.panel-titlebar-btns');
    if (!on) { if (btn) btn.remove(); return; }
    if (!btn && btns) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'panel-titlebar-btn cc-ct-btn';
      btn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M3 10 L8 5 L13 10"/></svg>';
      btn.title = 'Collapse / expand the Current Task';
      ['mousedown', 'pointerdown', 'dblclick'].forEach((ev) => btn.addEventListener(ev, (e) => e.stopPropagation()));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ctMin = !ctMin; try { localStorage.setItem(CT_LS, ctMin ? '1' : '0'); } catch (er) {} ctSync(); });
      btns.insertBefore(btn, btns.firstChild);
    }
    const det = t.querySelector('.float-task-inner .float-details');
    if (det && det.title) det.removeAttribute('title'); // (an earlier build set a tooltip here)
  }
  const ctTimer = setInterval(() => { try { if (!document.hidden) ctSync(); } catch (e) { /* keep ticking */ } }, 700);
  ctSync();

  function teardown() {
    clearInterval(ctTimer); ctStyle.remove();
    const t0 = document.getElementById('task-display'); if (t0) { t0.classList.remove('cc-ct-min'); const b0 = t0.querySelector('.cc-ct-btn'); if (b0) b0.remove(); }
    clearTimeout(timerId); clearTimeout(hideTimer);
    document.body.classList.remove('cc-walk-open');
    el.remove();
    style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc walking-countdown torn down';
  }

  window[NS] = {
    version: 5,
    teardown,
    // Debug/inspection helpers.
    get lastKnownPos() { return lastKnownPos; },
    get trip() { return trip; },
    get etaCorrection() { return etaCorrection; },
    get baseRatio() { return baseRatio; },
    get totalSpeed() { return readTotalSpeed(); },
    get baseTotal() { return baseTotal; },
    get speed() { return trip ? trip.speed : null; },
    nodesLoaded() { return !!nodesByName; },
    // Visual test hook: slide the drawer out with sample text / back in.
    preview(on) { insertOverlay(); if (on) { el.querySelector('.cc-walk-dest').textContent = 'Walking to Sandscale Lake'; el.querySelector('.cc-walk-eta').textContent = '12s'; el.querySelector('.cc-walk-time-fill').style.width = '40%'; applyLayout(); showDrawer(); } else hideDrawer(); },
  };

  console.log('[cc] walking-countdown loaded');
  return 'cc walking-countdown loaded';
})();
