// Scapewatch hover-info overlay.
// Display-only: adds extra lines of information to tooltips the game
// already builds (or, for quests, a tooltip the game doesn't have yet but
// which uses its own cosmetic classes and shows the same way). Never
// clicks, selects, submits, or sends anything to the game's WebSocket --
// pure DOM reads plus purely cosmetic DOM additions. No mouse simulation
// was used anywhere in building or verifying this; CDP Runtime.evaluate
// was used to read back real tooltip DOM/text directly.
//
// Four independent features, each gated by its own toggle in
// window.__ccPluginSettings (Settings -> Plugins -> Hover Info), checked
// fresh on every poll tick -- no watcher-side plumbing needed since none
// of this affects Discord/webhook behavior, just what's drawn in the page.
//
// ---------------------------------------------------------------------
// Feature 1 -- Task XP preview (queued skilling tasks)
// ---------------------------------------------------------------------
// Confirmed live, 2026-10-07, via CDP Runtime.evaluate against the real
// running game (no hover simulation needed -- the game's own tooltip DOM
// nodes exist at all times, just CSS-hidden until :hover):
//
//   #unified-queue-panel .uq-row                -- one per queue SLOT (7
//     seen live). The currently-RUNNING slot carries an extra class
//     `uq-current` (confirmed: its `.icon-scroll-row` had
//     data-skill="smith" data-activity-id="iron_bar", matching the
//     floating Current Task widget's own text "Smith 131 Iron Bar" byte
//     for byte). This script explicitly skips that slot -- the existing
//     Current Task widget already shows live progress for it.
//   .icon-option                                 -- within a non-current
//     slot, EVERY option gets a preview -- both the one actually queued
//     (carries a `.selected` class) and the reroll/swap alternatives
//     sitting alongside it (confirmed live, 3 independent `.icon-option`s
//     per slot, each with its own activity identity/qty/tooltip). Originally
//     this only covered `.selected`; broadened after the user asked for it
//     on every task they can hover and switch to, not just the current pick.
//   .icon-scroll-row[data-skill][data-activity-id]  -- sibling of the
//     above inside the same `.icon-option`, carries the activity identity
//     for skilling tasks. Combat tasks have `data-mob-id` instead, with no
//     `data-skill` -- that's Feature 2, explicitly skipped here.
//   .icon-option > .icon-qty                     -- the queued goal
//     quantity (confirmed live: textContent "33", "68", plain digits).
//   .icon-option > .icon-tooltip.uq-tooltip       -- the tooltip to extend;
//     already has `.tt-name`/`.tt-line` children and already becomes
//     visible on real hover via the game's own CSS rule (confirmed live:
//     `.icon-option:hover .icon-tooltip, ... { display: block; }`) -- no
//     JS needed to show/hide anything here, just append a `.tt-line`.
//   .skill-cell[data-skill-id="<skill>"] .tooltip .tt-line.tt-xp
//     -- current skill XP, confirmed live e.g. textContent
//     "30,747 / 33,218 XP" on the real Smith cell. First number parsed out
//     as current XP. This recomputes every poll tick (not a one-time
//     snapshot), so if the player gains XP in that skill from something
//     else while a tooltip is showing, the numbers track it live -- by
//     design, matches the user's own example ("current XP in that skill
//     and the XP the task would give").
//
// Per-action XP is NOT available from any live game endpoint -- confirmed
// by inspecting mobs.json/quests.json/items.json; activity success-XP only
// exists in this repo's own extracted data/raw/activities/<skill>.json.
// The watcher (panel-resize-watcher.js) builds a flattened
// `{ "<skill>:<activityId>": successXP }` lookup from every file in that
// directory once at startup and bakes it into the injected page as a
// preamble constant, `__CC_ACTIVITY_XP`, prepended ahead of this script's
// own source at injection time (see panel-resize-watcher.js for why this
// one script needed a new injection pattern -- every other mod script here
// just reads its own file verbatim). Total XP for a queued task is
// approximated as `successXP * qty`, deliberately ignoring the rare
// fail-XP case (a handful of actions in the queued batch failing and
// giving failXP instead of successXP) -- close enough for a preview line,
// not claimed to be exact down to the last XP.
//
// Bonus (cheap to add, so included): for processing-style activities where
// data/raw/activities/<skill>.json gives a direct single input/output item
// pair (confirmed live: true for barter/brew/cook/craft/discover/imbue/
// smith activities, e.g. cook.json's "raw_shrimp" -> "shrimp"; NOT true for
// bard/farm/fish/forage/invoke/mine/plunder/vigor, which are loot-table
// based with no single input/output pair -- confirmed by reading every
// file, not guessed), the watcher also bakes a second preamble constant,
// `__CC_ACTIVITY_INOUT` (`{ "<skill>:<activityId>": {input, output} }`,
// only for activities that actually have both fields). This script
// resolves those item ids' `value` field from the game's own
// items.json (fetched live once, same pattern as mobs.json/quests.json
// below) and shows an estimated gold profit line:
// `(outputValue - inputValue) * qty`. Skipped entirely (no second line)
// for any activity not in that table, rather than guessing an input/output
// pair from the activity name. ALSO skipped (confirmed necessary live,
// 2026-10-07) whenever either item's `value` field is actually missing --
// 15 of the 86 input/output activities have an unfinished/intermediate
// OUTPUT item with no `value` at all (e.g. "(Unf) Hawk Potion"); treating
// that as 0 would show a misleadingly large "loss" that's really just
// missing price data, not a real loss.
//
// Both preamble tables (__CC_ACTIVITY_XP, __CC_ACTIVITY_INOUT) are plain
// `window.` property assignments, not `const` -- see panel-resize-watcher.js
// for why (a top-level `const` throws on a second injection into the same
// already-loaded page, confirmed live the hard way).
//
// ---------------------------------------------------------------------
// Feature 2 -- Combat task mob stats (cheap tier only, NOT a DPS sim)
// ---------------------------------------------------------------------
// Same queue-panel/tooltip plumbing as Feature 1, but for the
// `.icon-scroll-row[data-mob-id]` rows (e.g. `data-mob-id=
// "feeble_rage_slime"`, confirmed live). `data-mob-id` is an exact key
// into `mobTypes` from `https://play.scapewatch.com/shared/data/mobs.json`
// -- fetched live once from inside this script (page-side `fetch`, cached
// in memory, exact same `ensureX()` pattern as nodes.json in
// walking-countdown.js), and CONFIRMED to be the same shape as this repo's
// own data/raw/mobs.json (same `{_comment, mobTypes, encounters}` object,
// same real field names on the actual served file, checked live
// 2026-10-07): `name`, `life`, `attackStyle` ("crush"/"slash"/"stab"/...),
// plus per-style attack/defense numbers. No player state needed -- purely
// static per mob, no DPS/kill-time math (explicitly out of scope; that's a
// separate future task reusing src/combat.js).
//
// ---------------------------------------------------------------------
// Feature 3 -- Quest reward preview
// ---------------------------------------------------------------------
// `.quests-panel .quest-slot` (confirmed live: 5 real slots, all
// `quest-slot quest-slot-active`; `.quest-slot-name` holds the exact quest
// name text, e.g. "Duneridge Silk Run"). CONFIRMED LIVE there is no
// existing tooltip element here, and -- unlike Features 1/2's
// `.icon-tooltip`, which has a generic `.icon-option:hover .icon-tooltip
// { display: block }` CSS rule -- there is NO generic hover-show rule for
// the game's `.tooltip` class either (checked every stylesheet rule
// matching `.tooltip` + `:hover`: only found rules for *other* tooltip
// classes like `.icon-tooltip`/`.panel-tab-tooltip`/`.cat-tooltip`, each
// scoped to their own specific parent; `.skill-cell`'s own `.tooltip`
// clearly shows on hover in practice but through the game's own JS, not a
// CSS rule this mod could piggyback on). So this feature uses the spec's
// documented fallback: a real `mouseenter`/`mouseleave` listener pair on
// each `.quest-slot`, toggling `display` on our own absolutely-positioned
// div, itself styled with the game's own `.tooltip`/`.tt-line` classes for
// visual consistency (`.quest-slot` confirmed live to be `position:
// static` with every scroll ancestor up through the panel at `overflow:
// visible`, so an absolutely-positioned child anchors and isn't clipped --
// same as the game's own tooltips elsewhere).
//
// Quest name is matched against `name` in
// `https://play.scapewatch.com/shared/data/quests.json` (fetched live
// once, confirmed same shape as data/raw/quests.json: `{quests: [...]}`,
// each with a `rewards: {xp: {<skill>: amount}, items: [{itemId,
// quantity}], rerollCredits}` object). Item names are resolved via
// items.json (also fetched live once) for display; truncated to the first
// few XP/item entries to avoid a wall of text on quests with long reward
// lists.
//
// ---------------------------------------------------------------------
// Feature 4 -- Task distance color coding
// ---------------------------------------------------------------------
// The user's own description of what they wanted: the same kind of
// per-task color coding the game's own World Map already shows (task
// locations tinted by trail color) while the map is OPEN, but available
// while it's closed -- based on distance from your current position
// instead, green (near) to red (far).
//
// Every `.icon-scroll-row` in the queue panel (skilling AND combat alike)
// carries a `data-node-id` attribute -- confirmed live, 2026-10-07, e.g.
// `data-node-id="reefrun_pool"` for a Fish task, `data-node-id=
// "feeble_rat"` for a Kill task (same value as that row's own
// `data-mob-id` -- the game evidently treats a mob spawn as a "node" for
// this purpose too). Both resolve to a real `{x,y}` in the live-served
// `https://play.scapewatch.com/shared/data/nodes.json` (same file Walking
// Countdown already uses, fetched independently here with the same
// ensureX() pattern -- keyed by `id` this time, not lowercased `name`).
//
// "Current position" is read from `window.__ccWalkingCountdown.
// lastKnownPos` rather than re-implementing position tracking here --
// that's the same inferred-from-last-arrival position Walking Countdown
// already tracks and persists to `localStorage`. No position yet (a
// fresh session with no completed walk) means no coloring at all, same
// graceful-skip as every other feature's missing-data case.
//
// Colors are normalized to the CURRENT set of queued options, not an
// absolute world-distance scale: closest option gets hue 120 (green),
// farthest gets hue 0 (red), everything else interpolated linearly
// between. Deliberately relative -- real distances sampled live ranged
// from ~1,200 to ~11,800 units depending on the moment (world diagonal is
// ~18,600), so no single fixed cutoff would stay meaningful call to call;
// "which of my actual current choices is closer" is the useful signal.
//
// Applied as a CSS `outline` (not `border`), specifically so it can never
// visually collide with the game's own `.icon-option.selected` border --
// outline is a separate box-model layer, doesn't affect layout, and draws
// on top without disturbing anything else already there.

(function () {
  'use strict';
  const NS = '__ccHoverInfo';

  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const POLL_MS = 1000;
  const MOBS_URL = 'https://play.scapewatch.com/shared/data/mobs.json';
  const QUESTS_URL = 'https://play.scapewatch.com/shared/data/quests.json';
  const ITEMS_URL = 'https://play.scapewatch.com/shared/data/items.json';
  const NODES_URL = 'https://play.scapewatch.com/shared/data/nodes.json';

  function settingEnabled(key, def) {
    try {
      if (window.__ccPluginSettings && window.__ccPluginSettings.get) {
        const v = window.__ccPluginSettings.get(key);
        return v === undefined ? def : v;
      }
    } catch (e) {}
    return def;
  }

  function fmt(n) {
    const r = Math.round(n);
    return r.toLocaleString('en-US');
  }

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // --- lazy live-data loaders, same ensureX() pattern as walking-countdown.js ---
  let mobTypes = null, loadingMobs = false;
  async function ensureMobs() {
    if (mobTypes || loadingMobs) return;
    loadingMobs = true;
    try {
      const res = await fetch(MOBS_URL);
      const data = await res.json();
      mobTypes = data.mobTypes || {};
    } catch (e) {
      console.warn('[cc] hover-info: could not load mobs.json', e);
    } finally {
      loadingMobs = false;
    }
  }
  ensureMobs();

  let questsByName = null, loadingQuests = false;
  async function ensureQuests() {
    if (questsByName || loadingQuests) return;
    loadingQuests = true;
    try {
      const res = await fetch(QUESTS_URL);
      const data = await res.json();
      questsByName = {};
      for (const q of (data.quests || [])) {
        if (q && q.name) questsByName[q.name] = q;
      }
    } catch (e) {
      console.warn('[cc] hover-info: could not load quests.json', e);
    } finally {
      loadingQuests = false;
    }
  }
  ensureQuests();

  let itemsById = null, loadingItems = false;
  async function ensureItems() {
    if (itemsById || loadingItems) return;
    loadingItems = true;
    try {
      const res = await fetch(ITEMS_URL);
      const data = await res.json();
      itemsById = data.items || {};
    } catch (e) {
      console.warn('[cc] hover-info: could not load items.json', e);
    } finally {
      loadingItems = false;
    }
  }
  ensureItems();

  // The true farthest-possible distance between any two real nodes --
  // computed once, O(n^2) over ~567 nodes (~160k pairs, sub-10ms live) --
  // used as the fixed red endpoint for Feature 4's color scale instead of
  // the bounding box diagonal (an upper bound, not necessarily achieved by
  // any real pair of nodes) or anything relative to a given poll's queue.
  function computeMaxNodeDistance(byId) {
    const pts = Object.values(byId);
    let max = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > max) max = d;
      }
    }
    return max;
  }

  let nodesById = null, maxNodeDistance = null, loadingNodes = false;
  async function ensureNodesById() {
    if (nodesById || loadingNodes) return;
    loadingNodes = true;
    try {
      const res = await fetch(NODES_URL);
      const data = await res.json();
      nodesById = {};
      for (const n of (data.nodes || [])) {
        if (n && n.id && n.position) nodesById[n.id] = n.position;
      }
      maxNodeDistance = computeMaxNodeDistance(nodesById);
    } catch (e) {
      console.warn('[cc] hover-info: could not load nodes.json', e);
    } finally {
      loadingNodes = false;
    }
  }
  ensureNodesById();

  // --- shared helpers ----------------------------------------------------

  // xp-table.json: xpForLevel[level] = total XP to reach it. Used to turn a
  // 400%-of-next-level preview into "+3 Lvls + 42%". Levels above 99 only
  // exist for the extended skills (Constants.EXTENDED_LEVEL_SKILLS).
  const XP_TABLE_URL = 'https://play.scapewatch.com/shared/data/xp-table.json';
  const EXTENDED_LEVEL_SKILLS = ['slay', 'delve', 'fortify', 'luck'];
  let xpForLevel = null, loadingXpTable = false;
  async function ensureXpTable() {
    if (xpForLevel || loadingXpTable) return;
    loadingXpTable = true;
    try {
      const data = await (await fetch(XP_TABLE_URL)).json();
      xpForLevel = data.xpForLevel || null;
    } catch (e) {
      console.warn('[cc] hover-info: could not load xp-table.json', e);
    } finally {
      loadingXpTable = false;
    }
  }
  ensureXpTable();
  function levelForXp(skill, xp) {
    const cap = EXTENDED_LEVEL_SKILLS.indexOf(skill) >= 0 ? 120 : 99;
    let lvl = 1;
    while (lvl < cap && xpForLevel[lvl + 1] != null && xpForLevel[lvl + 1] <= xp) lvl++;
    return { lvl, cap };
  }

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
  function parseCurrentXP(skill) {
    const cell = qc('.skill-cell[data-skill-id="' + skill + '"]');
    if (!cell) return null;
    const line = cell.querySelector('.tooltip .tt-line.tt-xp');
    if (!line) return null;
    const m = (line.textContent || '').match(/^([\d,]+)\s*\//);
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ''), 10);
  }

  // The game's own `.tt-line.tt-next` already states the XP gap to next
  // level directly (e.g. "6,063 xp to level 32") -- used as-is rather than
  // deriving it from the two `.tt-xp` numbers or the `.tt-bar-fill` width.
  // Confirmed live, 2026-10-07: the tt-xp pair's difference does match this
  // number exactly, but the bar's own width does NOT correspond to either
  // number in any way worked out live (e.g. Vigor showed "56,592 / 62,655
  // XP" -- 90% of the total -- with a bar reading 2.1%) -- so rather than
  // guess at whatever the bar actually represents, this reads the one
  // value whose meaning the game states in plain text.
  function parseXpToNextLevel(skill) {
    const cell = qc('.skill-cell[data-skill-id="' + skill + '"]');
    if (!cell) return null;
    const line = cell.querySelector('.tooltip .tt-line.tt-next');
    if (!line) return null; // absent at max level -- no "next" to measure against
    const m = (line.textContent || '').match(/^([\d,]+)/);
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ''), 10);
  }

  // Every hoverable task option in non-current queue slots -- i.e. both
  // the task actually queued (`.icon-option.selected`) AND the reroll/swap
  // alternatives sitting alongside it (confirmed live, 2026-10-07: each
  // non-current `.uq-row` has 3 independent `.icon-option`s, each with its
  // own data-skill/data-activity-id (or data-mob-id), its own .icon-qty,
  // and its own .icon-tooltip -- all three are real, independently
  // hoverable previews of "what if I picked this instead," not just the
  // selected one). Originally this only returned the `.selected` option;
  // changed after the user explicitly asked for it on every option they
  // can hover, not just the currently-queued one. Skips the uq-current
  // row entirely either way -- that one already has the live Current Task
  // widget.
  // `includeCurrent` (distance coloring only): the uq-current row's selected
  // option + location text get the same distance color as every other row.
  function queuedSlots(includeCurrent) {
    const out = [];
    const uqRows = document.querySelectorAll('#unified-queue-panel .uq-row');
    uqRows.forEach((uqRow) => {
      if (uqRow.classList.contains('uq-current') && !includeCurrent) return;
      uqRow.querySelectorAll('.icon-option').forEach((option) => {
        const tooltip = option.querySelector('.icon-tooltip.uq-tooltip');
        if (!tooltip) return;
        out.push({ option, tooltip, current: uqRow.classList.contains('uq-current') });
      });
    });
    return out;
  }

  // The CURRENT task's icon count is actions DONE, not the target (queued
  // rows show the target). The game's own Current Task widget carries
  // "<done> | eta | <target>" in its first bar (confirmed live, 2026-10-07:
  // 141 ... 163 for "Plunder 163 Bandits"), so remaining = target - done.
  function currentTaskRemaining() {
    const bar = document.querySelector('#task-display .float-bar-text');
    if (!bar || bar.children.length < 3) return null;
    const done = parseInt(bar.children[0].textContent.replace(/[^\d]/g, ''), 10);
    const target = parseInt(bar.children[bar.children.length - 1].textContent.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(done) || !Number.isFinite(target)) return null;
    return Math.max(0, target - done);
  }

  // --- Feature 1: task XP preview ----------------------------------------

  // Level progress for gaining XP: before/after position inside the level you start in / land in (0..1).
  function calcProg(skill, currentXP, newXp) {
    if (!xpForLevel) return null;
    const from = levelForXp(skill, currentXP), to = levelForXp(skill, newXp);
    const fLo = xpForLevel[from.lvl], fHi = from.lvl >= from.cap ? null : xpForLevel[from.lvl + 1];
    const tLo = xpForLevel[to.lvl], tHi = to.lvl >= to.cap ? null : xpForLevel[to.lvl + 1];
    const cl = (v) => Math.max(0, Math.min(1, v));
    if (fHi != null && tHi != null && fHi > fLo && tHi > tLo) return { from: from.lvl, to: to.lvl, cur: cl((currentXP - fLo) / (fHi - fLo)), end: cl((newXp - tLo) / (tHi - tLo)) };
    if (from.lvl >= from.cap) return { maxed: true };
    if (to.lvl >= to.cap) return { from: from.lvl, to: to.lvl, cur: 0, end: 1, reachMax: true };
    return null;
  }
  const pct1 = (v) => Math.round(v * 1000) / 10;
  function progText(p) {
    if (!p) return '';
    if (p.maxed) return 'Max level';
    return p.to > p.from ? 'Lv ' + p.from + ' \u2192 Lv ' + p.to + (p.reachMax ? ' (max)' : ' + ' + pct1(p.end) + '%') : 'Lv ' + p.from + ': ' + pct1(p.cur) + '% \u2192 ' + pct1(p.end) + '%';
  }
  function progBar(p) {
    const bar = document.createElement('div'); bar.className = 'cc-xb';
    if (p.to === p.from) {
      const c = document.createElement('i'); c.className = 'cc-xb-cur'; c.style.width = pct1(p.cur) + '%'; bar.appendChild(c);
      const g = document.createElement('i'); g.className = 'cc-xb-gain'; g.style.left = pct1(p.cur) + '%'; g.style.width = Math.max(0.5, pct1(p.end - p.cur)) + '%'; bar.appendChild(g);
    } else {
      const g = document.createElement('i'); g.className = 'cc-xb-gain up'; g.style.left = '0'; g.style.width = Math.max(1, pct1(p.end)) + '%'; bar.appendChild(g);
    }
    return bar;
  }

  // The task XP block: "+3,000 XP . ~25m . 7.2k xp/hr", the level line, a progress bar, and the raw XP numbers.
  function renderXpBlock(el, skill, d) {
    const p = d.prog;
    const levelTxt = progText(p);
    const key = [skill, d.totalXp, d.currentXP, d.tsec, d.leftNote, levelTxt, p && p.cur, p && p.end].join('|');
    if (el.dataset.ccK === key) return;
    el.dataset.ccK = key;
    el.textContent = '';
    const head = document.createElement('div');
    head.className = 'cc-xb-head';
    head.appendChild(icoImg(skill, 'skill', cap1(skill)));
    const tot = document.createElement('b'); tot.textContent = '+' + fmt(d.totalXp) + ' XP'; head.appendChild(tot);
    if (d.tsec) {
      const t = document.createElement('span'); t.className = 'cc-xb-dim'; t.textContent = '~' + (d.tsec >= 120 ? (d.tsec >= 3600 ? Math.floor(d.tsec / 3600) + 'h ' + (Math.round(d.tsec % 3600 / 60) % 60) + 'm' : Math.round(d.tsec / 60) + 'm') : fmtDur1(d.tsec)); t.title = 'Rough time to finish, from the game\u2019s own projection'; head.appendChild(t);
      const r = document.createElement('span'); r.className = 'cc-xb-dim'; r.textContent = fmtXp1(d.totalXp / d.tsec * 3600) + ' xp/hr'; head.appendChild(r);
    }
    el.appendChild(head);
    if (levelTxt) {
      const lv = document.createElement('div'); lv.className = 'cc-xb-lv' + (p && p.to > p.from ? ' up' : ''); lv.textContent = levelTxt; el.appendChild(lv);
    }
    if (p && !p.maxed) el.appendChild(progBar(p));
    const raw = document.createElement('div'); raw.className = 'cc-xb-dim'; raw.textContent = fmt(d.currentXP) + ' \u2192 ' + fmt(d.newXp) + ' XP' + d.leftNote; el.appendChild(raw);
  }


  function updateTaskXpPreview() {
    ensureXpTable();
    const enabled = settingEnabled('hoverTaskXpPreview', true);
    let bridge = null;
    try { if (enabled && settingEnabled('hoverTaskDuration', true) && window.__ccBridge && window.__ccBridge.ok()) bridge = window.__ccBridge.project(); } catch (e) { bridge = null; }
    for (const { option, tooltip, current } of queuedSlots(true)) {
      const scrollRow = option.querySelector('.icon-scroll-row[data-skill][data-activity-id]');
      let xpLine = tooltip.querySelector('.cc-hover-xp');
      let goldLine = tooltip.querySelector('.cc-hover-gold');

      if (!enabled || !scrollRow) {
        if (xpLine) xpLine.remove();
        if (goldLine) goldLine.remove();
        continue;
      }

      const skill = scrollRow.getAttribute('data-skill');
      const activityId = scrollRow.getAttribute('data-activity-id');
      const qtyEl = option.querySelector('.icon-qty');
      let qty = qtyEl ? parseInt((qtyEl.textContent || '').replace(/[^\d]/g, ''), 10) : NaN;
      // Current task: only what is still left to do will actually be earned.
      let leftNote = '';
      if (current) {
        const rem = currentTaskRemaining();
        if (rem != null) { qty = rem; leftNote = ' \u00b7 ' + fmt(rem) + ' left'; }
      }
      // window.__CC_ACTIVITY_XP -- a plain property assignment prepended
      // ahead of this script's own source by the watcher (see
      // panel-resize-watcher.js for why it's a `window.` assignment and
      // not a `const` preamble: a top-level `const` throws "already been
      // declared" the second time it's evaluated into an already-loaded
      // page, e.g. on a watcher restart with no game reload in between --
      // confirmed live, 2026-10-07, the hard way).
      const table = window.__CC_ACTIVITY_XP || {};
      const successXP = table[skill + ':' + activityId];
      const currentXP = parseCurrentXP(skill);

      if (!Number.isFinite(qty) || qty <= 0 || successXP == null || currentXP == null) {
        if (xpLine) xpLine.remove();
        if (goldLine) goldLine.remove();
        continue;
      }

      // Approximation: ignores the rare fail-XP case (some actions in the
      // queued batch failing and giving failXP instead) -- accepted, see
      // header comment.
      // Lucky tasks: 2x XP per action (and 2x rewards), no failed actions -- the game marks them with `.lucky`.
      const lm = option.classList.contains('lucky') ? 2 : 1;
      if (lm > 1) leftNote += ' · lucky ×2';
      const totalXp = successXP * qty * lm;
      const newXp = currentXP + totalXp;
      if (!xpLine) {
        xpLine = document.createElement('div');
        xpLine.className = 'tt-line cc-hover-xp';
        tooltip.appendChild(xpLine);
      }
      // Level progress: where the task's XP takes you, as a bar (blue = what you have, green = what this task adds) and
      // as text ("42% -> 80% of Lv 30", or "Lv 30 -> Lv 31 + 6.5%" when it levels you up). The percent is of the
      // level you land in, not of the XP still needed. Separately toggleable (hoverTaskXpPercent).
      const prog = settingEnabled('hoverTaskXpPercent', true) ? calcProg(skill, currentXP, newXp) : null;
      // Rough duration from the game's own dashboard projection (needs the Game Data Bridge), like the Queue tab.
      let tsec = null;
      if (bridge) {
        let info = null;
        if (current) info = bridge.head;
        else {
          const uq = option.closest('.uq-row');
          const slot = uq ? parseInt(uq.getAttribute('data-row-index'), 10) : NaN;
          const oi = parseInt(option.getAttribute('data-option-index'), 10);
          const sl = Number.isFinite(slot) ? bridge.slots.find((x) => x.index === slot) : null;
          info = sl && Number.isFinite(oi) ? sl.options[oi] : null;
        }
        if (info && Number.isFinite(info.timeSec) && info.timeSec > 0) tsec = info.timeSec;
      }
      ensureIconStyle();
      renderXpBlock(xpLine, skill, { currentXP, newXp, totalXp, prog, tsec, leftNote });

      // Expected coin reward -- ONLY for activities whose loot table really
      // pays gold (Plunder, Bard; see __CC_ACTIVITY_GOLD in the watcher):
      // expected gold per success x queued actions. An earlier version showed
      // "profit" = vendor value of output item minus input item for crafting
      // style skills (e.g. Cook), which isn't a coin reward at all; removed
      // at the user's request 2026-10-07. Ignores failed actions (they drop
      // nothing), so it is an upper-ish estimate -> shown with "~".
      const perAction = (window.__CC_ACTIVITY_GOLD || {})[skill + ':' + activityId];
      if (perAction > 0 && settingEnabled('hoverTaskGoldEstimate', true)) {
        if (!goldLine) {
          goldLine = document.createElement('div');
          goldLine.className = 'tt-line cc-hover-gold';
          tooltip.appendChild(goldLine);
        }
        setIconLine(goldLine, 'gold', 'item', '~+' + fmt(Math.round(perAction * qty * lm)) + ' coins');
      } else if (goldLine) {
        goldLine.remove();
      }
    }
  }

  // --- Feature 2: combat task mob stats -----------------------------------

  function updateMobStats() {
    const enabled = settingEnabled('hoverMobStats', true);
    for (const { option, tooltip } of queuedSlots()) {
      const scrollRow = option.querySelector('.icon-scroll-row[data-mob-id]');
      let nameLine = tooltip.querySelector('.cc-hover-mob-name');
      let atkLine = tooltip.querySelector('.cc-hover-mob-atk');

      if (!enabled || !scrollRow || !mobTypes) {
        if (nameLine) nameLine.remove();
        if (atkLine) atkLine.remove();
        continue;
      }

      const mobId = scrollRow.getAttribute('data-mob-id');
      const mob = mobTypes[mobId];
      if (!mob) {
        if (nameLine) nameLine.remove();
        if (atkLine) atkLine.remove();
        continue;
      }

      if (!nameLine) {
        nameLine = document.createElement('div');
        nameLine.className = 'tt-line cc-hover-mob-name';
        tooltip.appendChild(nameLine);
      }
      nameLine.textContent = mob.name + ' — ' + mob.life + ' HP';

      if (!atkLine) {
        atkLine = document.createElement('div');
        atkLine.className = 'tt-line cc-hover-mob-atk';
        tooltip.appendChild(atkLine);
      }
      atkLine.textContent = 'Attacks: ' + cap(mob.attackStyle || '?');
    }
  }

  // --- Feature 3: quest reward preview ------------------------------------

  function buildRewardLines(quest) {
    const lines = ['Reward on completion:'];
    const xp = (quest.rewards && quest.rewards.xp) || {};
    const xpParts = Object.keys(xp).map((skill) => '+' + fmt(xp[skill]) + ' ' + cap(skill) + ' XP');
    if (xpParts.length) lines.push(xpParts.slice(0, 3).join(', '));

    const items = (quest.rewards && quest.rewards.items) || [];
    const itemParts = items.slice(0, 3).map((it) => {
      const item = itemsById ? itemsById[it.itemId] : null;
      const name = item ? item.name.replace(/^\[[A-Z]\d+\]\s*/, '') : it.itemId;
      return fmt(it.quantity) + 'x ' + name;
    });
    if (itemParts.length) lines.push(itemParts.join(', '));

    return lines;
  }

  function fillTooltipLines(tooltipEl, lines) {
    // Update in place (reuse existing .tt-line children) rather than
    // replacing the node, so an open (display:block, set by our own
    // mouseenter handler) tooltip doesn't flicker closed on the next poll
    // tick.
    const existing = tooltipEl.querySelectorAll(':scope > .tt-line');
    for (let i = 0; i < lines.length; i++) {
      let line = existing[i];
      if (!line) {
        line = document.createElement('div');
        line.className = 'tt-line';
        tooltipEl.appendChild(line);
      }
      line.textContent = lines[i];
    }
    for (let i = lines.length; i < existing.length; i++) existing[i].remove();
  }

  // Quest tooltip in the same style as the task tooltips: skill icons, XP per skill and how much of the
  // current level it fills (or the level it carries you to), item icons, unlocks and reroll credits.
  function fillQuestTooltip(tooltip, quest) {
    ensureIconStyle();
    const rw = quest.rewards || {};
    const xp = rw.xp || {};
    const parts = [];
    for (const skill of Object.keys(xp)) {
      const gain = xp[skill];
      const cur = xpForLevel ? parseCurrentXP(skill) : null;
      const pr = cur != null ? calcProg(skill, cur, cur + gain) : null;
      parts.push([skill, gain, pr]);
    }
    const items = (rw.items || []).map((it) => {
      const item = itemsById ? itemsById[it.itemId] : null;
      return [it.itemId, it.quantity, item ? item.name.replace(/^\[[A-Z]\d+\]\s*/, '') : it.itemId];
    });
    const unlocks = (rw.unlocks || []).map((id) => { const item = itemsById ? itemsById[id] : null; return [id, item ? item.name : id]; });
    const credits = rw.rerollCredits || 0;
    const key = JSON.stringify([parts, items, unlocks, credits]);
    if (tooltip.dataset.ccK === key) return;
    tooltip.dataset.ccK = key;
    tooltip.textContent = '';
    const box = document.createElement('div'); box.className = 'tt-line cc-qr';
    const head = document.createElement('div'); head.className = 'cc-sx-head';
    const hb = document.createElement('b'); hb.textContent = 'Reward on completion'; head.appendChild(hb); box.appendChild(head);
    const row = (iconName, kind, main, dim, accent) => {
      const r = document.createElement('div'); r.className = 'cc-qr-row';
      r.appendChild(icoImg(iconName, kind, ''));
      const m = document.createElement('span'); m.textContent = main; r.appendChild(m);
      if (dim) { const d = document.createElement('span'); d.className = 'cc-sx-dim'; d.textContent = dim; r.appendChild(d); }
      if (accent) { const a = document.createElement('span'); a.className = 'cc-qr-up'; a.textContent = accent; r.appendChild(a); }
      box.appendChild(r);
    };
    parts.forEach(([skill, gain, pr]) => {
      row(skill, 'skill', '+' + fmt(gain) + ' ' + cap(skill) + ' XP', '', '');
      if (pr && !pr.maxed) { const lv = document.createElement('div'); lv.className = 'cc-xb-lv' + (pr.to > pr.from ? ' up' : ''); lv.textContent = progText(pr); box.appendChild(lv); box.appendChild(progBar(pr)); }
    });
    items.forEach(([id, q, name]) => row(id, 'item', fmt(q) + '\u00d7 ' + name, '', ''));
    unlocks.forEach(([id, name]) => row(id, 'item', 'Unlocks ' + name, '', ''));
    if (credits) { const r = document.createElement('div'); r.className = 'cc-qr-row cc-sx-dim'; r.textContent = '+' + credits + ' reroll credit' + (credits === 1 ? '' : 's'); box.appendChild(r); }
    tooltip.appendChild(box);
  }

  function updateQuestRewards() {
    const enabled = settingEnabled('hoverQuestRewards', true);
    const slots = document.querySelectorAll('.quests-panel .quest-slot');
    slots.forEach((slot) => {
      let tooltip = slot.querySelector('.cc-hover-quest-tooltip');

      if (!enabled || !questsByName) {
        if (tooltip) tooltip.remove();
        return;
      }

      const nameEl = slot.querySelector('.quest-slot-name');
      const name = nameEl ? nameEl.textContent.trim() : null;
      const quest = name ? questsByName[name] : null;
      if (!quest || !quest.rewards) {
        if (tooltip) tooltip.remove();
        return;
      }

      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip cc-hover-quest-tooltip';
        tooltip.style.display = 'none'; // shown/hidden by our own listeners below, not CSS :hover
        if (getComputedStyle(slot).position === 'static') slot.style.position = 'relative';
        slot.appendChild(tooltip);
      }
      fillQuestTooltip(tooltip, quest);

      if (!slot.__ccHoverWired) {
        slot.addEventListener('mouseenter', () => {
          const t = slot.querySelector('.cc-hover-quest-tooltip');
          if (t) t.style.display = 'block';
        });
        slot.addEventListener('mouseleave', () => {
          const t = slot.querySelector('.cc-hover-quest-tooltip');
          if (t) t.style.display = 'none';
        });
        slot.__ccHoverWired = true;
      }
    });
  }

  // --- Feature 4: task distance color coding ------------------------------
  //
  // Each `.icon-scroll-row` (both skilling and combat) carries a
  // `data-node-id` attribute -- confirmed live, 2026-10-07, e.g.
  // data-node-id="reefrun_pool" for a Fish task, data-node-id="feeble_rat"
  // for a Kill task (same value as its data-mob-id there -- the game
  // apparently treats a mob spawn as a "node" too). Both kinds resolve to
  // a real {x,y} in the live-served nodes.json, confirmed by cross-checking
  // real distances against the player's current position.
  //
  // "Current position" reuses window.__ccWalkingCountdown.lastKnownPos --
  // the same inferred-from-last-arrival position Walking Countdown already
  // tracks and persists to localStorage (see that file) -- rather than
  // duplicating that tracking here. No position yet this session (or ever)
  // means no coloring at all, same graceful-skip pattern as everywhere else.
  //
  // Colors are normalized to the CURRENT set of queued options, not an
  // absolute world-distance scale -- closest visible option is green (hue
  // 120), farthest is red (hue 0), everything else interpolated linearly
  // between. Deliberately relative: "which of my actual choices right now
  // is closer" is the useful signal, not an arbitrary absolute cutoff this
  // mod would otherwise have to invent (the world's own diagonal is
  // ~18,600 units, but real task-to-task spread seen live was anywhere
  // from ~1,200 to ~11,800 depending on the moment -- no single fixed
  // scale would stay meaningful across that range).
  //
  // Applied as a CSS `outline` (not `border`) specifically so it can never
  // visually collide with the game's own `.icon-option.selected` border
  // styling -- outline is a separate box-model layer that doesn't affect
  // layout and draws on top without disturbing anything else.

  // The location-name text itself -- confirmed live, 2026-10-07, only for
  // SKILLING tasks: the tooltip's second `.uq-tt-row` (first is the task
  // name, `.tt-name.uq-tt-row`) holds an icon plus a plain-text span like
  // "Sandscale Wilds (7642)" or "Pebblehill Anvil (2366)". Combat tasks'
  // second row is NOT a location -- it's combat-style info (e.g. "Melee 1
  // (1357)"), confirmed by reading a real one, so this is deliberately
  // gated on the same `[data-skill][data-activity-id]` check Feature 1
  // uses, not attempted for combat tasks at all.
  function findLocationNameSpan(option) {
    const scrollRow = option.querySelector('.icon-scroll-row[data-skill][data-activity-id]');
    if (!scrollRow) return null;
    const tooltip = option.querySelector('.icon-tooltip.uq-tooltip');
    if (!tooltip) return null;
    const rows = tooltip.querySelectorAll(':scope > .uq-tt-row');
    const locRow = rows[1];
    if (!locRow) return null;
    for (const s of locRow.querySelectorAll('span')) {
      if (!s.classList.contains('uq-sub-wrap')) return s;
    }
    return null;
  }

  // The SAME queue row also has an always-visible "list row" companion
  // section, `.task-details > .task-node > .uq-name-text` -- a sibling of
  // `.icon-container` inside the same `.uq-row`, confirmed live,
  // 2026-10-07: `.closest('.uq-row')` from a `.task-node` lands on the
  // exact same row whose `.icon-option.selected` has the matching
  // `data-node-id` (e.g. row 1's task-node read "Stillbark Anvil (4700)"
  // and that row's selected option's node-id was "stillbark_anvil").
  // This is what the user's own screenshot showed -- the game's "Tasks"
  // window (this panel's own titlebar name) rendering each row as an
  // icon + always-visible name + location strip, not hidden in a hover
  // tooltip at all. Only ONE per row (the row's committed/selected
  // choice -- there's no separate list-row text for the 2 reroll
  // alternatives), so this is applied once per row using the SELECTED
  // option's already-computed color, not once per option.
  function findListRowLocationSpan(option) {
    if (!option.classList.contains('selected')) return null;
    const row = option.closest('.uq-row');
    if (!row) return null;
    const node = row.querySelector('.task-details .task-node');
    if (!node) return null;
    return node.querySelector('.uq-name-text') || null;
  }

  function clearDistanceColor(option) {
    if (option.classList.contains('cc-hover-dist-colored')) {
      option.classList.remove('cc-hover-dist-colored');
      option.style.outline = '';
      option.style.outlineOffset = '';
    }
    const locSpan = option.querySelector('.cc-hover-dist-loc-colored');
    if (locSpan) {
      locSpan.classList.remove('cc-hover-dist-loc-colored');
      locSpan.style.color = '';
    }
    const listSpan = findListRowLocationSpan(option);
    if (listSpan && listSpan.classList.contains('cc-hover-dist-loc-colored')) {
      listSpan.classList.remove('cc-hover-dist-loc-colored');
      listSpan.style.color = '';
    }
  }

  function updateTaskDistanceColor() {
    const enabled = settingEnabled('taskDistanceColor', true);
    const myPos = (window.__ccWalkingCountdown && window.__ccWalkingCountdown.lastKnownPos) || null;
    ensureNodesById();

    const entries = [];
    for (const { option } of queuedSlots(true)) {
      const scrollRow = option.querySelector('.icon-scroll-row[data-node-id]');
      const nodeId = scrollRow ? scrollRow.getAttribute('data-node-id') : null;
      entries.push({ option, nodeId });
    }

    if (!enabled || !myPos || !nodesById || !maxNodeDistance) {
      for (const e of entries) clearDistanceColor(e.option);
      return;
    }

    for (const e of entries) {
      const pos = e.nodeId ? nodesById[e.nodeId] : null;
      if (!pos) { clearDistanceColor(e.option); continue; }
      const dx = pos.x - myPos.x, dy = pos.y - myPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Fixed absolute scale: 0 -> green (hue 120), the true farthest-
      // possible distance between any two real nodes -> red (hue 0).
      // Originally normalized to min/max of the CURRENT queue instead --
      // changed after the user explicitly wanted a stable scale that
      // doesn't recolor the same task differently poll to poll just
      // because a different set of alternatives happened to be offered.
      const t = Math.min(1, dist / maxNodeDistance);
      const hue = (1 - t) * 120;
      const color = 'hsl(' + Math.round(hue) + ', 70%, 45%)';
      e.option.classList.add('cc-hover-dist-colored');
      e.option.style.outline = '3px solid ' + color;
      e.option.style.outlineOffset = '-2px';

      // Tint the location-name text itself in BOTH places it can show up:
      // the hover-only tooltip span (findLocationNameSpan, skilling tasks
      // only) and the always-visible list-row span (findListRowLocationSpan,
      // selected option only -- see that function's comment).
      const locSpan = findLocationNameSpan(e.option);
      if (locSpan) {
        locSpan.classList.add('cc-hover-dist-loc-colored');
        locSpan.style.color = color;
      }
      const listSpan = findListRowLocationSpan(e.option);
      if (listSpan) {
        listSpan.classList.add('cc-hover-dist-loc-colored');
        listSpan.style.color = color;
      }
    }
  }

  // --- Feature 6: food totals under the Active Potions food row ------------
  // The food row only shows the best tier's count ("354 Remaining"); the
  // game's own hover tooltip has the full-stack totals (`.potion-tt-total`:
  // total healing + total remaining across every food tier). Surfaces both
  // permanently under the row: Total Healing (Life icon) and Total Remaining
  // food (Cooking icon). Read straight from the tooltip's own DOM, so it
  // always matches what the game says. Absolutely positioned so the game's
  // own row children are never moved or wrapped.
  const foodStyle = document.createElement('style');
  foodStyle.id = 'cc-hover-food-style';
  foodStyle.textContent =
    // The extra bottom padding makes room for the totals; icon + stat are
    // shifted down by half of it (--cc-food-shift, set in px from the real
    // totals height) so the crab stays vertically centered on the whole row.
    '.potion-row.cc-food-sum { position: relative; padding-bottom: var(--cc-food-pad, 1.9em); }' +
    '.potion-row.cc-food-sum .potion-row-icon-wrap, .potion-row.cc-food-sum .potion-row-stat { transform: translateY(var(--cc-food-shift, 0.95em)); }' +
    '.potion-row .cc-food-total { position: absolute; right: 0.6em; bottom: 0.3em; display: flex; gap: 0.9em; align-items: center; font-size: 0.85em; color: #e0e0e0; white-space: nowrap; pointer-events: none; }' +
    '.potion-row .cc-food-total span { display: inline-flex; align-items: center; gap: 0.25em; }' +
    '.potion-row .cc-food-total img { width: 1.1em; height: 1.1em; image-rendering: pixelated; }' +
    '.potion-row .cc-food-heal { color: #e07b6c; }';
  document.head.appendChild(foodStyle);
  function updateFoodTotals() {
    const row = document.querySelector('.active-potions-body .potion-row[data-style="food"]');
    if (!row) return;
    const tot = row.querySelector('.potion-tt-total');
    if (!tot) return;
    const healVal = (tot.querySelector('.potion-tt-stat-val') || {}).textContent || '';
    const countTxt = ((tot.querySelector('.potion-tt-count') || {}).textContent || '').replace(/\s*Remaining\s*$/i, '');
    if (!healVal || !countTxt) return;
    let box = row.querySelector('.cc-food-total');
    if (!box) {
      box = document.createElement('div');
      box.className = 'cc-food-total';
      box.innerHTML =
        '<span class="cc-food-heal" title="Total Healing"><b class="cc-fh"></b><img src="/assets/icons/skills/life.png" alt="Life"></span>' +
        '<span title="Total Remaining Food"><b class="cc-fr"></b><img src="/assets/icons/skills/cook.png" alt="Cook"></span>';
      row.appendChild(box);
    }
    row.classList.add('cc-food-sum');
    const boxH = box.offsetHeight; // layout px -- unaffected by panel scale
    if (boxH > 0) {
      const pad = boxH + 8;
      if (row.style.getPropertyValue('--cc-food-pad') !== pad + 'px') {
        row.style.setProperty('--cc-food-pad', pad + 'px');
        row.style.setProperty('--cc-food-shift', (pad / 2) + 'px');
      }
    }
    const h = box.querySelector('.cc-fh'), r = box.querySelector('.cc-fr');
    if (h.textContent !== healVal) h.textContent = healVal;
    if (r.textContent !== countTxt) r.textContent = countTxt;
  }

  // --- Feature 7: Lucky / Quest-step rings on task options ----------------
  // Any queued/current task option that is Lucky (game adds `.lucky`) or
  // carries a quest step (its tooltip has `.tt-quest-line`) gets a super
  // slowly pulsing ring INSIDE the distance-color outline: yellow = Lucky,
  // blue = quest step; both -> yellow outside, blue inside it. Whether the
  // step is the NEXT one needed is already shown by the game itself (its
  // `Step n/m` tooltip line is white for the next step, gray via
  // `.tt-quest-future` otherwise), so no extra distinction is drawn here.
  // Pseudo-elements (confirmed unused on .icon-option, 2026-10-07) keep the
  // distance outline (inline style) and the game's own border untouched.
  const ringStyle = document.createElement('style');
  ringStyle.id = 'cc-hover-ring-style';
  ringStyle.textContent =
    '@keyframes ccRingPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }' +
    '.icon-option.cc-l::before, .icon-option.cc-q::after { content: ""; position: absolute; border-radius: 3px; pointer-events: none; animation: ccRingPulse 7s ease-in-out infinite; }' +
    '.icon-option.cc-l::before { inset: 3px; border: 2px solid #ffd84a; box-shadow: 0 0 4px rgba(255,216,74,0.7); }' +
    '.icon-option.cc-q::after { inset: 3px; border: 2px solid #4aa8ff; box-shadow: 0 0 4px rgba(74,168,255,0.7); }' +
    '.icon-option.cc-l.cc-q::after { inset: 6px; }';
  document.head.appendChild(ringStyle);
  function updateTaskRings() {
    document.querySelectorAll('#unified-queue-panel .icon-option').forEach((o) => {
      const lucky = o.classList.contains('lucky');
      const quest = !!o.querySelector('.tt-quest-line');
      if (o.classList.contains('cc-l') !== lucky) o.classList.toggle('cc-l', lucky);
      if (o.classList.contains('cc-q') !== quest) o.classList.toggle('cc-q', quest);
    });
  }

  // --- poll loop -----------------------------------------------------------
  // DOM nodes here (queue rows, quest slots) can be torn down and rebuilt by
  // the game at any time -- never cached across ticks, always re-queried
  // fresh each poll, same resilience pattern as chat-relay-collect.js /
  // plugins-settings-ui.js.

  // --- Feature: Skills-tab tooltip "% to next level" ----------------------
  // The game's skill tooltip shows "cur / next XP" and "N xp to level L" but no
  // percentage (its own bar width doesn't track either number -- see
  // parseXpToNextLevel's comment). Adds "NN.N% to level L" as a tooltip line:
  // pct = (xp - xpForLevel[lvl]) / (next - xpForLevel[lvl]), where `next` is the
  // tooltip's own second number (exact) and the level start comes from
  // xp-table.json. Updated on hover (the game may rebuild the tooltip) and on
  // every poll.
  function updateSkillCellPct(cell) {
    const tip = cell.querySelector('.tooltip');
    if (!tip) return;
    let line = tip.querySelector('.cc-hover-skillpct');
    const enabled = settingEnabled('hoverSkillPercent', true);
    const xpLine = tip.querySelector('.tt-line.tt-xp');
    const m = xpLine ? (xpLine.textContent || '').match(/^([\d,]+)\s*\/\s*([\d,]+)/) : null;
    const lvl = parseInt(((cell.querySelector('.skill-level') || {}).textContent || ''), 10);
    if (!enabled || !m || !Number.isFinite(lvl) || !xpForLevel || xpForLevel[lvl] == null) { if (line) line.remove(); return; }
    const cur = parseInt(m[1].replace(/,/g, ''), 10), next = parseInt(m[2].replace(/,/g, ''), 10);
    const lo = xpForLevel[lvl];
    if (!(next > lo)) { if (line) line.remove(); return; }
    const pct = Math.max(0, Math.min(100, (cur - lo) / (next - lo) * 100));
    const text = pct.toFixed(1) + '% to level ' + (lvl + 1);
    if (!line) {
      line = document.createElement('div');
      line.className = 'tt-line cc-hover-skillpct';
      const anchor = tip.querySelector('.tt-line.tt-next') || xpLine;
      anchor.insertAdjacentElement('afterend', line);
    }
    if (line.textContent !== text) line.textContent = text;
    // Gentle emphasis as a level gets close.
    line.style.color = pct >= 85 ? '#8fd98f' : pct >= 50 ? '#e0d98a' : '';
  }
  function updateSkillPercents() {
    ensureXpTable();
    document.querySelectorAll('.skill-cell[data-skill-id]').forEach(updateSkillCellPct);
  }
  const onSkillHover = (e) => {
    const cell = e.target && e.target.closest ? e.target.closest('.skill-cell[data-skill-id]') : null;
    if (cell) { try { updateSkillCellPct(cell); } catch (err) {} }
  };
  document.addEventListener('mouseover', onSkillHover, true);

  // --- Feature: queued XP on the Skills panel -----------------------------------
  // Every skill cell shows what the tasks you have queued (the current task plus each row's picked option) would add:
  // a striped section on the cell's progress bar, a "+N" level badge when it is whole levels, and a tooltip block with the
  // same bar + "Lv 39: 35% -> 64%" text as the task tooltips. Numbers come from the game bridge (same as the XP previews).
  const skqStyle = document.createElement('style');
  skqStyle.id = 'cc-hover-skq-style';
  skqStyle.textContent = `
.cc-skq-fill{position:absolute;top:0;bottom:0;pointer-events:none;background:#7dff94;box-shadow:0 0 4px rgba(125,255,148,.7)}
.cc-skq-up{margin:2px 0 3px;padding:2px 6px;border-radius:4px;background:rgba(255,210,74,.14);border:1px solid rgba(255,210,74,.55);color:#ffd24a;font-weight:700}
.cc-skq{display:block;min-width:200px}
.cc-skq .cc-skq-h{color:#8fe39a;font-weight:600}
`;
  document.head.appendChild(skqStyle);
  function queuedXp(bridge) {
    const xp = {}, n = {};
    const add = (bo) => {
      if (!bo) return;
      const sk = {};
      if (bo.combat) { const c = bo.combat, a = (k, v) => { if (k && v > 0) sk[k] = (sk[k] || 0) + v; }; a('slay', c.slay); a('spirit', c.spirit); a(c.chosenSkill, c.chosen); a('life', c.life); a(c.secSkill, c.sec); }
      else if (bo.skill && Number.isFinite(bo.totalXp)) sk[bo.skill] = bo.totalXp * (1 + (bo.xpBonus || 0));
      // Lucky tasks also pay Luck XP equal to the (doubled) skill XP; slay: slay XP + the chosen combat skill's XP (measured live, 2026-10-12).
      if (bo.lucky) { const l = bo.combat ? (bo.combat.slay || 0) + (bo.combat.chosen || 0) : sk[bo.skill] || 0; if (l > 0) sk.luck = (sk.luck || 0) + l; }
      for (const k in sk) { xp[k] = (xp[k] || 0) + sk[k]; n[k] = (n[k] || 0) + 1; }
    };
    add(bridge.head);
    (bridge.slots || []).forEach((sl) => add(sl.options[sl.selected]));
    return { xp, n };
  }
  // Colour-graded skill bars: 0% = red, 50% = amber, 100% = green (cell bar and tooltip bar).
  const gradeCol = (pct) => 'hsl(' + Math.round(Math.max(0, Math.min(100, pct)) * 1.2) + ',80%,' + (pct < 50 ? 46 : 42) + '%)';
  function gradeSkillBars() {
    const on = settingEnabled('hoverSkillGradient', true);
    document.querySelectorAll('.skill-cell[data-skill-id]').forEach((cell) => {
      [cell.querySelector('.skill-progress-fill'), cell.querySelector('.tt-bar-fill')].forEach((f) => {
        if (!f) return;
        if (!on) { if (f.dataset.ccG) { f.style.removeProperty('background'); delete f.dataset.ccG; } return; }
        const pct = parseFloat(f.style.width);
        if (!Number.isFinite(pct)) return;
        const c = gradeCol(pct);
        if (f.dataset.ccG !== c) { f.dataset.ccG = c; f.style.setProperty('background', c, 'important'); }
      });
    });
  }
  function updateSkillQueued() {
    const cells = document.querySelectorAll('.skill-cell[data-skill-id]');
    const enabled = settingEnabled('hoverSkillQueued', true) && xpForLevel;
    let bridge = null;
    try { if (enabled && window.__ccBridge && window.__ccBridge.ok()) bridge = window.__ccBridge.project(); } catch (e) { bridge = null; }
    const q = bridge ? queuedXp(bridge) : null;
    cells.forEach((cell) => {
      const k = cell.getAttribute('data-skill-id');
      const prog = cell.querySelector('.skill-progress');
      let fill = cell.querySelector('.cc-skq-fill'), badge = cell.querySelector('.cc-skq-badge');
      const tip = cell.querySelector('.tooltip');
      let line = tip ? tip.querySelector('.cc-skq') : null;
      const gain = q && q.xp[k] > 0 ? q.xp[k] : 0;
      const L = bridge && bridge.skills ? bridge.skills[k] : null;
      const pr = gain > 0 && L ? calcProg(k, L.xp, L.xp + gain) : null;
      if (!pr || pr.maxed || !prog) { if (fill) fill.remove(); if (badge) badge.remove(); if (line) line.remove(); return; }
      const gained = pr.to - pr.from;
      const base = prog.querySelector('.skill-progress-fill');
      const startPct = base && base.style.width ? parseFloat(base.style.width) : pr.cur * 100;
      if (!fill) { fill = document.createElement('div'); fill.className = 'cc-skq-fill'; prog.appendChild(fill); }
      fill.style.left = startPct + '%';
      fill.style.width = (gained >= 1 ? 100 - startPct : Math.max(1, (pr.end - pr.cur) * 100)) + '%';
      if (badge) badge.remove();
      if (tip) {
        ensureIconStyle();
        const key = [k, Math.round(gain), Math.round(L.xp), q.n[k]].join('|');
        if (!line) { line = document.createElement('div'); line.className = 'tt-line cc-skq'; const anchor = tip.querySelector('.cc-hover-skillpct') || tip.querySelector('.tt-line.tt-next') || tip.lastElementChild; anchor.insertAdjacentElement('afterend', line); }
        if (line.dataset.ccK !== key) {
          line.dataset.ccK = key; line.textContent = '';
          if (gained >= 1) { const up = document.createElement('div'); up.className = 'cc-skq-up'; up.textContent = '★ Levels up: Lv ' + pr.from + ' → Lv ' + pr.to + '  (+' + gained + (gained === 1 ? ' level' : ' levels') + ')'; line.appendChild(up); }
          const h = document.createElement('div'); h.className = 'cc-skq-h'; h.textContent = 'Queued tasks: +' + fmt(Math.round(gain)) + ' XP'; line.appendChild(h);
          const lv = document.createElement('div'); lv.className = 'cc-xb-lv' + (gained >= 1 ? ' up' : ''); lv.textContent = progText(pr); line.appendChild(lv);
          line.appendChild(progBar(pr));
          const d = document.createElement('div'); d.className = 'cc-xb-dim'; d.textContent = 'from ' + q.n[k] + (q.n[k] === 1 ? ' task' : ' tasks') + ' (current + queue)' + (gained >= 1 ? ' \u00b7 +' + gained + (gained === 1 ? ' level' : ' levels') : ''); line.appendChild(d);
        }
      }
    });
  }

  // --- Feature: Slay (kill) task XP preview --------------------------------
  // Same tooltips as the skilling XP preview, for mob options. Numbers come from
  // the game bridge: kills x per-kill XP (Slay XP + the damage-based combat XP
  // split into the chosen skill, Life and Dodge/Defend -- see game-bridge.js
  // combatInfo), time from the game's own kill-time model. An estimate: ignores
  // overkill and combat-XP bonuses. Needs the Plugins toggle "Game Data Bridge".
  const fmtXp1 = (n) => n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US');
  const cap1 = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function fmtDur1(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (sec % 60) + 's' : sec + 's';
  }

  // Shared tooltip look: 16px game icons instead of skill names.
  const ICON_STYLE_ID = 'cc-hover-ico-style';
  function ensureIconStyle() {
    if (document.getElementById(ICON_STYLE_ID) || !document.head) return;
    const st = document.createElement('style');
    st.id = ICON_STYLE_ID;
    st.textContent = `
.cc-ico{width:16px;height:16px;image-rendering:pixelated;vertical-align:-3px;margin-right:5px;flex:none}
.cc-hover-slayxp{display:block}
.cc-sx-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px}
.cc-sx-head b{color:#fff;font-weight:600}
.cc-sx-dim{color:#9a9aa6;font-size:.88em}
.cc-sx-chips{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:3px}
.cc-sx-chip{display:inline-flex;align-items:center;white-space:nowrap}
.cc-sx-note{margin-top:2px}
.cc-hover-xp{display:block;min-width:200px}
.cc-xb-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 10px}
.cc-xb-head b{color:#fff;font-weight:700}
.cc-xb-dim{color:#9a9aa6;font-size:.88em}
.cc-xb-lv{margin-top:2px;color:#cfd3dc;font-weight:600}
.cc-xb-lv.up{color:#ffd24a}
.cc-xb{position:relative;height:9px;margin:4px 0 3px;border-radius:5px;background:#262633;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.cc-xb i{position:absolute;top:0;bottom:0;display:block}
.cc-xb-cur{left:0;background:#3a7bd5}
.cc-xb-gain{background:linear-gradient(90deg,#3ddc5a,#8bf29b);box-shadow:0 0 6px rgba(61,220,90,.7)}
.cc-xb-gain.up{background:linear-gradient(90deg,#ffb52a,#ffe27a);box-shadow:0 0 6px rgba(255,210,74,.8)}
.cc-qr{display:block;min-width:200px}
.cc-qr-row{display:flex;align-items:center;gap:6px;margin-top:3px;white-space:nowrap}
.cc-qr-up{color:#8fd98f;font-weight:600}`;
    document.head.appendChild(st);
  }
  const iconSrc = (kind, name) => (kind === 'item' ? '/assets/icons/items/' : '/assets/icons/skills/') + name + '.png';
  function icoImg(name, kind, title) {
    const i = document.createElement('img');
    i.className = 'cc-ico';
    i.src = iconSrc(kind, name);
    i.alt = name;
    if (title) i.title = title;
    i.addEventListener('error', () => { i.style.display = 'none'; }); // never show a broken-image box
    return i;
  }
  // Replace a tooltip line's content with "[icon] text", only when it changed.
  function setIconLine(el, name, kind, text) {
    const key = name + '|' + kind + '|' + text;
    if (el.dataset.ccK === key) return;
    el.dataset.ccK = key;
    el.textContent = '';
    el.appendChild(icoImg(name, kind, cap1(name)));
    el.appendChild(document.createTextNode(text));
  }

  function updateSlayXpPreview() {
    ensureIconStyle();
    const enabled = settingEnabled('hoverTaskXpPreview', true) && settingEnabled('hoverSlayXp', true);
    let bridge = null;
    try { if (enabled && window.__ccBridge && window.__ccBridge.ok()) bridge = window.__ccBridge.project(); } catch (e) { bridge = null; }
    for (const { option, tooltip, current } of queuedSlots(true)) {
      const mobRow = option.querySelector('.icon-scroll-row[data-mob-id]');
      if (!mobRow) continue;
      let box = tooltip.querySelector('.cc-hover-slayxp');
      const stale = tooltip.querySelector('.cc-hover-slayrate'); if (stale) stale.remove();
      let info = null;
      if (bridge) {
        if (current) info = bridge.head;
        else {
          const uq = option.closest('.uq-row');
          const slot = uq ? parseInt(uq.getAttribute('data-row-index'), 10) : NaN;
          const oi = parseInt(option.getAttribute('data-option-index'), 10);
          const sl = Number.isFinite(slot) ? bridge.slots.find((x) => x.index === slot) : null;
          info = sl && Number.isFinite(oi) ? sl.options[oi] : null;
        }
      }
      const c = info && info.kind === 'slay' ? info.combat : null;
      if (!c) { if (box) box.remove(); continue; }
      const tsec = Number.isFinite(c.timeSec) && c.timeSec > 0 ? c.timeSec : info.timeSec;
      const chips = [['slay', c.slay], ['spirit', c.spirit]];
      if (c.chosenSkill) chips.push([c.chosenSkill, c.chosen]);
      chips.push(['life', c.life], [c.secSkill, c.sec]);
      const shown = chips.filter(([, v]) => v > 0);
      const note = (current ? c.kills + ' kills left \u00b7 ' : c.kills + ' kills \u00b7 ') + cap1(c.toggle) + ' XP' + (c.auto ? ' \u00b7 auto loadout' : '');
      const head = '~' + fmtXp1(c.total) + ' xp|' + (tsec > 0 ? fmtDur1(tsec) + '|' + fmtXp1(c.total / tsec * 3600) + '/hr' : '');
      const key = head + '|' + shown.map(([k, v]) => k + fmtXp1(v)).join(',') + '|' + note;
      if (!box) { box = document.createElement('div'); box.className = 'tt-line cc-hover-slayxp'; tooltip.appendChild(box); }
      if (box.dataset.ccK === key) continue;
      box.dataset.ccK = key;
      box.textContent = '';
      const hd = document.createElement('div');
      hd.className = 'cc-sx-head';
      const tot = document.createElement('b'); tot.textContent = '~' + fmtXp1(c.total) + ' xp'; hd.appendChild(tot);
      if (tsec > 0) {
        const t = document.createElement('span'); t.className = 'cc-sx-dim'; t.textContent = fmtDur1(tsec); hd.appendChild(t);
        const r = document.createElement('span'); r.className = 'cc-sx-dim'; r.textContent = fmtXp1(c.total / tsec * 3600) + ' xp/hr'; hd.appendChild(r);
      }
      box.appendChild(hd);
      const row = document.createElement('div');
      row.className = 'cc-sx-chips';
      shown.forEach(([k, v]) => {
        const chip = document.createElement('span');
        chip.className = 'cc-sx-chip';
        chip.appendChild(icoImg(k, 'skill', cap1(k)));
        chip.appendChild(document.createTextNode('+' + fmtXp1(v)));
        row.appendChild(chip);
      });
      box.appendChild(row);
      const nt = document.createElement('div'); nt.className = 'cc-sx-note cc-sx-dim'; nt.textContent = note; box.appendChild(nt);
    }
  }

  // --- Feature: show / hide the queue's "NEW TASKS" insert bar ---------------
  // The gold "NEW TASKS" line in the Tasks panel (.uq-insert, drag zone
  // .uq-insert-grab) sets where newly rolled tasks land, and is easy to grab by
  // accident when dragging the bottom task. This adds a small button beside the
  // game's own "Collapse to icons" / "Pin popouts" buttons that hides the bar and
  // makes it ungrabbable (visibility + pointer-events only; the game's chosen
  // insert position is untouched). State persists in localStorage.
  const INSERT_LS = 'cc-uq-insert-hidden';
  const INSERT_STYLE_ID = 'cc-hover-insert-style';
  let insertHidden = false;
  try { insertHidden = localStorage.getItem(INSERT_LS) === '1'; } catch (e) {}
  function ensureInsertStyle() {
    if (document.getElementById(INSERT_STYLE_ID) || !document.head) return;
    const st = document.createElement('style');
    st.id = INSERT_STYLE_ID;
    st.textContent = `
body.cc-uq-insert-hidden .uq-insert{visibility:hidden!important;pointer-events:none!important}
body.cc-uq-insert-hidden .uq-insert .uq-insert-grab{pointer-events:none!important;cursor:default!important}
.cc-insert-btn{position:absolute;width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0;
  background:var(--bg-cell);border:1px solid var(--border-primary);border-radius:4px;color:var(--text-muted);cursor:pointer;opacity:.7;z-index:61}
.cc-insert-btn:hover{opacity:1;background:var(--bg-hover);color:var(--text-light)}
.cc-insert-btn.active{opacity:1;color:var(--text-gold);border-color:var(--border-secondary);background:var(--bg-hover)}
.cc-insert-btn svg{width:13px;height:13px;display:block;fill:currentColor}`;
    document.head.appendChild(st);
  }
  function setInsertHidden(v) {
    insertHidden = !!v;
    try { localStorage.setItem(INSERT_LS, insertHidden ? '1' : '0'); } catch (e) {}
    updateInsertToggle();
  }
  function updateInsertToggle() {
    const panel = qc('.uq-panel');
    // Looked up directly (not through the cached qc(), which remembers "not found" for a few seconds and made a new button every tick).
    const all = [...document.querySelectorAll('.cc-insert-btn')];
    let btn = all.find((b) => panel && b.parentElement === panel) || null;
    all.forEach((b) => { if (b !== btn) b.remove(); });
    const enabled = settingEnabled('queueInsertToggle', true);
    if (!enabled || !panel) {
      if (btn) btn.remove();
      if (document.body) document.body.classList.remove('cc-uq-insert-hidden');
      return;
    }
    ensureInsertStyle();
    if (document.body) document.body.classList.toggle('cc-uq-insert-hidden', insertHidden);
    if (!btn || btn.parentElement !== panel) {
      if (btn) btn.remove();
      btn = document.createElement('div');
      btn.className = 'cc-insert-btn';
      // a bar with an up-arrow: "the insert line"
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18v3H3z"></path><path d="M12 4l5 6H7z"></path></svg>';
      // The game's own buttons swallow nothing special; keep clicks from reaching the panel.
      ['mousedown', 'pointerdown', 'dblclick', 'contextmenu'].forEach((t) => btn.addEventListener(t, (e) => e.stopPropagation()));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setInsertHidden(!insertHidden); });
      panel.appendChild(btn);
    }
    btn.classList.toggle('active', !insertHidden);
    btn.title = insertHidden ? 'Show the NEW TASKS insert bar' : 'Hide the NEW TASKS insert bar (stops accidental drags)';
    // Sit directly left of the game's "Collapse to icons" button, whatever the layout.
    const ref = panel.querySelector('.queue-collapse-btn') || panel.querySelector('.queue-pin-btn');
    if (ref) {
      const cs = getComputedStyle(ref);
      const right = parseFloat(cs.right);
      btn.style.right = (Number.isFinite(right) ? right + 24 : 60) + 'px';
      btn.style.top = cs.top !== 'auto' ? cs.top : '';
      btn.style.bottom = cs.bottom !== 'auto' ? cs.bottom : '';
    }
  }

  function tick() {
    try { updateInsertToggle(); } catch (e) { /* best effort */ }
    try { updateSkillPercents(); } catch (e) { /* best effort */ }
    try { gradeSkillBars(); } catch (e) { /* best effort */ }
    try { updateSkillQueued(); } catch (e) { /* best effort */ }
    try { updateSlayXpPreview(); } catch (e) { /* best effort */ }
    try { updateTaskXpPreview(); } catch (e) { /* best effort */ }
    try { updateMobStats(); } catch (e) { /* best effort */ }
    try { updateQuestRewards(); } catch (e) { /* best effort */ }
    try { updateTaskDistanceColor(); } catch (e) { /* best effort */ }
    try { updateFoodTotals(); } catch (e) { /* best effort */ }
    try { updateTaskRings(); } catch (e) { /* best effort */ }
  }

  const intervalId = setInterval(tick, POLL_MS);
  tick();

  function teardown() {
    clearInterval(intervalId);
    document.removeEventListener('mouseover', onSkillHover, true);
    document.querySelectorAll('.cc-hover-skillpct, .cc-hover-slayxp, .cc-hover-slayrate').forEach((el) => el.remove());
    const ics = document.getElementById('cc-hover-ico-style'); if (ics) ics.remove();
    document.querySelectorAll('.cc-insert-btn').forEach((el) => el.remove());
    const ins = document.getElementById('cc-hover-insert-style'); if (ins) ins.remove();
    if (document.body) document.body.classList.remove('cc-uq-insert-hidden');
    document.querySelectorAll('.cc-skq-fill, .cc-skq-badge, .cc-skq').forEach((el) => el.remove());
    document.querySelectorAll('[data-cc-g]').forEach((el) => { el.style.removeProperty('background'); delete el.dataset.ccG; });
    skqStyle.remove();
    document.querySelectorAll('.cc-hover-xp, .cc-hover-gold, .cc-hover-mob-name, .cc-hover-mob-atk').forEach((el) => el.remove());
    document.querySelectorAll('.cc-hover-quest-tooltip').forEach((el) => el.remove());
    const rs = document.getElementById('cc-hover-ring-style'); if (rs) rs.remove();
    document.querySelectorAll('.icon-option.cc-l, .icon-option.cc-q').forEach((el) => el.classList.remove('cc-l', 'cc-q'));
    const fs2 = document.getElementById('cc-hover-food-style'); if (fs2) fs2.remove();
    document.querySelectorAll('.cc-food-total').forEach((el) => el.remove());
    document.querySelectorAll('.cc-food-sum').forEach((el) => el.classList.remove('cc-food-sum'));
    document.querySelectorAll('.cc-hover-dist-colored').forEach((el) => clearDistanceColor(el));
    document.querySelectorAll('.cc-hover-dist-loc-colored').forEach((el) => { el.classList.remove('cc-hover-dist-loc-colored'); el.style.color = ''; });
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc hover-info torn down';
  }

  window[NS] = {
    version: 2,
    teardown,
    mobsLoaded() { return !!mobTypes; },
    questsLoaded() { return !!questsByName; },
    itemsLoaded() { return !!itemsById; },
    nodesLoaded() { return !!nodesById; },
  };

  console.log('[cc] hover-info loaded');
  return 'cc hover-info loaded';
})();
