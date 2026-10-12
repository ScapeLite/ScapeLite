// Scapewatch panel resize + content-scale mod (v2: zero-DOM-mutation).
// Display-only -- never clicks, selects, or submits anything in the game.
// Matches the developer's stated policy: modifying the client's display
// without taking actions for the player is fine.
//
// DESIGN RULE (the whole point of v2): this script never moves, wraps,
// removes, or edits ANY node inside a game panel, and never sets any
// attribute/inline style on a game panel either. v1 reparented each
// panel's children into a scaled wrapper div; the game's Tasks rebuild
// (`_buildRowElements`) removes the old `.uq-rows`, then calls
// `panel.insertBefore(newRows, controlRowEl)` -- which throws once
// `.uq-controls` has been moved into a wrapper, leaving no `.uq-rows` at
// all. So v2 only:
//
//   1. Adds ONE <style> element to <head>. Scaling is a stylesheet rule
//      that targets a panel by the `data-panel-id` the game already puts
//      on its own titlebar, e.g.
//        .panel-floating:has(> .panel-titlebar[data-panel-id="tasks"])
//          { scale: 0.7 !important; transform-origin: 0 0 !important }
//      Uses the CSS `scale` property (not `transform`), so it composes
//      with any `transform` the game sets itself instead of overriding it.
//      Because it's a selector, not a reference, it keeps applying even if
//      the game rebuilds or re-appends the panel element, and it stops
//      applying the moment the panel is re-docked (loses .panel-floating).
//   2. Adds resize handles as children of <body> (position: fixed), NOT of
//      the panel. A requestAnimationFrame loop reads each floating panel's
//      getBoundingClientRect() (read-only) and parks the handle on the
//      panel's visual bottom-right corner.
//
// Scaling is uniform (aspect ratio locked): the panel's own layout box
// stays exactly what the game makes it, and only its paint is scaled, so
// the content always fits the visual box exactly -- at any size, natural
// size changes (e.g. the Tasks panel recomputing its own width/height on
// every queue tick) just scale along with it, with nothing to fight.
//
// Known tradeoffs (all cosmetic, see overlay/README.md):
//   - The game's drag-clamp uses offsetWidth/Height (unscaled), so a
//     shrunk panel stops (1-s)*size short of the right/bottom screen edge,
//     and an enlarged one can be dragged partly off the right/bottom edge.
//   - A scaled panel is its own stacking context, so its tooltips would
//     otherwise be trapped under higher-z-index sibling panels; a :has()
//     rule raises the panel's z-index only while one of its tooltips is
//     being hovered.
//   - Docked (non-floating) panels get no handle -- they're CSS-anchored
//     to screen edges. Drag one out by its titlebar (game feature) first.
//
// Controls: drag the dot-grip to scale (50%-200%, capped so the panel never
// grows past the window's right/bottom edge); double-click it to reset to
// 100%. Console: __ccPanelScale.scales / .reset('tasks') / .reset().
// Scales persist in localStorage key `cc-panel-scale-v2` (our own key).
// Re-inject after every game reload/relaunch. Re-injecting is safe: the
// previous instance is torn down first. Full teardown:
//   window.__ccPanelScale.teardown()   (or overlay/panel-resize-teardown.js)

(function () {
  'use strict';
  const NS = '__ccPanelScale';
  const LS_KEY = 'cc-panel-scale-v2';
  const MIN_S = 0.5, MAX_S = 2.0, SNAP_TO_1 = 0.03;
  const HANDLE = 14;         // px, viewport pixels (handle lives outside the UI zoom)
  const OCCLUDE_EVERY = 6;    // frames between occlusion hit-tests

  // --- replace any previous instance (v2) and clean up v1 leftovers ---
  try { window[NS] && window[NS].teardown && window[NS].teardown({ keepStorage: true }); } catch (e) {}
  (function legacyV1Cleanup() {
    try { window._ccBodyObserver && window._ccBodyObserver.disconnect(); } catch (e) {}
    document.querySelectorAll('.cc-scale-wrapper').forEach(w => {
      const p = w.parentNode; if (!p) return;
      while (w.firstChild) p.insertBefore(w.firstChild, w);
      w.remove();
    });
    document.querySelectorAll('.cc-resize-handle').forEach(h => h.remove());
    document.querySelectorAll('.panel-floating, [data-cc-handle]').forEach(p => {
      if (p._ccMO) { try { p._ccMO.disconnect(); } catch (e) {} delete p._ccMO; }
      delete p.dataset.ccHandle; delete p.dataset.ccScaleWired; delete p.dataset.ccSizeEnforced;
      delete p._ccUserSize; delete p._ccNaturalSize;
    });
    delete window._ccBodyObserver; delete window._ccPanelModLoaded;
  })();

  let scales = {};
  try { scales = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { scales = {}; }
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(scales)); } catch (e) {} };

  const style = document.createElement('style');
  style.id = 'cc-panel-scale-style';
  if (document.head) {
    document.head.appendChild(style);
  } else {
    // Page.addScriptToEvaluateOnNewDocument can run before <head> exists --
    // genuine document-start, sometimes earlier than any HTML has been
    // parsed. Confirmed live, 2026-10-06: this was the only synchronous DOM
    // dependency at script-load time in the whole file, and it was silently
    // aborting the entire IIFE on a fresh page load via the auto-injection
    // path (window.__ccPanelScale never got set, panel resize/scale
    // completely absent after a reload) while manual re-injection into an
    // already-loaded page worked fine -- unlike chat-relay-collect.js's
    // defensive null-checked querySelector pattern, which degrades
    // gracefully instead of throwing. DOMContentLoaded guarantees <head>
    // exists by the time it fires. Setting style.textContent on a still-
    // detached element (renderCss(), below) is fine either way -- it just
    // renders once actually appended.
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style), { once: true });
  }

  // Panels that are not `.panel-floating` + titlebar (so the generic loop
  // can't see them) but still want a scale handle. They are pinned to a
  // fixed screen edge by the game's own CSS, so the scale origin is fixed
  // (top-right for the Active Potions strip) and the handle sits on the
  // opposite-from-origin bottom corner ('bl' = bottom-left).
  const EXTRA = {
    potions: { sel: '.active-potions-panel', origin: 'tr', corner: 'bl', setting: 'potionsResizeEnabled' },
    // The in-game Dashboard window (own titlebar, not a data-panel-id panel).
    dashboard: { sel: '.dashboard-panel', origin: 'tl', corner: 'br', setting: 'dashboardResizeEnabled' },
  };
  const panelSel = id => EXTRA[id] ? EXTRA[id].sel
    : `.panel-floating:has(> .panel-titlebar[data-panel-id="${CSS.escape(id)}"])`;

  // The game's own drag-clamp keeps a panel's UNSCALED box on-screen (it
  // reads offsetWidth/Height, which `scale` doesn't change -- only paint
  // is scaled, not layout). Scaling is anchored top-left by default, so a
  // shrunk panel's right/bottom edges end up (1-s)*size short of the
  // screen edge: the game thinks the panel is still full-size there.
  // Fix: track which edge(s) each panel is actually resting against and
  // anchor the scale from that corner instead, so shrinking pulls inward
  // from the edge the user pushed it to rather than always from top-left.
  // Two thresholds, not one -- hysteresis. Confirmed live, 2026-10-06: a
  // single EDGE_TOL meant a panel sitting right at that boundary could
  // flip its anchor corner every frame as sub-pixel position noise
  // crossed the same line back and forth, which reads as the panel
  // fighting the user's drag / being stuck snapped in place, unable to be
  // pulled away. The actual request wasn't "remove edge-snapping" but
  // "let me manually move it away when I want to" -- so: easy to snap
  // IN (small ENTER threshold), but a clearly deliberate drag required to
  // release (much larger EXIT threshold), same pattern as OS-level window
  // edge-snapping.
  // Exit tolerance brought way down from an original 50px, 2026-10-07 --
  // the user explicitly kept finding "quite a lot of panels" still felt
  // stuck/snappy even with hysteresis in place: a 50px exit band meant
  // dragging a scaled panel 30-40px away from an edge did nothing
  // visually, which read as broken/sticky rather than "intentionally
  // resists tiny jitter." Explicit choice from the user: keep SOME snap
  // (not disable it outright), but make it release almost as soon as you
  // start pulling away. 6px of hysteresis margin (10 -> 16) is enough to
  // stop the original sub-pixel-noise flicker bug without being
  // perceptible as stickiness during a real drag.
  const EDGE_TOL_ENTER = 10; // px -- snap TO an edge once this close
  const EDGE_TOL_EXIT = 16;  // px -- must be dragged at least this far out to release
  const origins = {}; // panelId -> 'tl' | 'tr' | 'bl' | 'br'
  let edgeSnapEnabled = false; // toggled from the in-game Plugins settings tab, see plugins-settings-ui.js
  // A proposed flip must be seen on 2 CONSECUTIVE rAF ticks (~16-33ms,
  // imperceptible) before it's actually committed -- added 2026-10-07
  // after a user-recorded video showed a scaled panel visually teleport
  // to the opposite corner for a single frame right as a native drag
  // began, then teleport straight back. The jump's size matched a
  // bottom-anchor flip almost exactly ((1-s)*unscaledHeight), even though
  // the panel was nowhere near that edge -- consistent with `r` (this
  // tick's getBoundingClientRect) and `s` (this panel's scale) going
  // momentarily out of sync with each other during whatever reflow the
  // game's own drag-start does, which would send the recovered
  // unscaledRight/Bottom calculation briefly haywire. Debouncing is a
  // one-tick-delayed but root-cause-agnostic fix: a REAL, sustained
  // edge-approach still flips normally (just ~1 frame later), while a
  // one-frame glitch from ANY cause never survives long enough to commit.
  const pendingFlip = {}; // panelId -> { key, count }
  function updateOrigin(id, panel, s) {
    if (EXTRA[id]) { origins[id] = EXTRA[id].origin; return false; }
    // Snapping off (default): CONTINUOUS origin. The game clamps a panel's
    // UNSCALED box to the screen, so a scaled panel can only reach an edge if
    // its scale origin sits on that edge. Instead of flipping between four
    // corners (the visual jump users read as "snapping"), slide the origin
    // fraction smoothly with the panel's unscaled position: fx = left /
    // (W - w), so flush-left => origin 0%, flush-right => origin 100%, and
    // the visual box touches the matching screen edge exactly at both ends,
    // with no discontinuity anywhere in between. Same for the vertical axis.
    if (!edgeSnapEnabled) {
      const r = panel.getBoundingClientRect();
      const c = cont[id] || { fx: 0, fy: 0 };
      const k = s > 0 ? s : 1;
      const w = r.width / k, h = r.height / k;
      // Recover the unscaled box from the visual rect, given the origin in use.
      const left = r.left - c.fx * w * (1 - k), top = r.top - c.fy * h * (1 - k);
      const clamp01 = v => Math.max(0, Math.min(1, v));
      const fx = innerWidth - w > 1 ? clamp01(left / (innerWidth - w)) : 0;
      const fy = innerHeight - h > 1 ? clamp01(top / (innerHeight - h)) : 0;
      origins[id] = 'cont';
      if (!r.width || !r.height) return false;
      if (!cont[id] || Math.abs(fx - c.fx) > 0.002 || Math.abs(fy - c.fy) > 0.002) { cont[id] = { fx, fy }; saveCont(); return true; }
      return false;
    }
    delete cont[id];
    const prev = origins[id] || 'tl';
    if (!edgeSnapEnabled || !(s > 0) || s === 1) {
      delete pendingFlip[id];
      if (prev !== 'tl') { origins[id] = 'tl'; return true; }
      return false;
    }
    const r = panel.getBoundingClientRect(); // visual (post-scale) rect -- Chromium reports `scale` correctly here
    const anchorRight = prev === 'tr' || prev === 'br';
    const anchorBottom = prev === 'bl' || prev === 'br';
    // Recover the game's unscaled box from the current visual rect, given
    // which corner is presently fixed (that corner's coordinate is shared
    // between visual and unscaled; the opposite edge is w/s or h/s away).
    const unscaledW = r.width / s, unscaledH = r.height / s;
    const unscaledRight = anchorRight ? r.right : r.left + unscaledW;
    const unscaledBottom = anchorBottom ? r.bottom : r.top + unscaledH;
    const rightTol = anchorRight ? EDGE_TOL_EXIT : EDGE_TOL_ENTER;
    const bottomTol = anchorBottom ? EDGE_TOL_EXIT : EDGE_TOL_ENTER;
    const atRight = unscaledRight > innerWidth - rightTol;
    const atBottom = unscaledBottom > innerHeight - bottomTol;
    const next = (atRight ? 'r' : 'l') + (atBottom ? 'b' : 't');
    const key = next[1] + next[0]; // -> 'tl'/'tr'/'bl'/'br' to match origins' existing values
    if (key === prev) { delete pendingFlip[id]; return false; }
    const pending = pendingFlip[id];
    if (pending && pending.key === key) { pending.count++; } else { pendingFlip[id] = { key, count: 1 }; }
    if (pendingFlip[id].count < 2) return false; // not confirmed yet -- could still be a one-frame glitch
    delete pendingFlip[id];
    origins[id] = key;
    return true;
  }
  const cont = {}; // panelId -> { fx, fy } continuous origin fractions (snapping off)
  // Remembered across reloads: without this, a scaled panel is first painted with the default top-left origin after every
  // (re)load of the plugins, so it jumps toward the middle of the screen until the origin is recomputed (and sometimes
  // the recompute races with the game's own layout and it never fully goes back). With the last known origin restored
  // up front, the very first paint is already where the panel really is.
  const LS_ORIGIN = 'cc-panel-origins';
  try { const o = JSON.parse(localStorage.getItem(LS_ORIGIN) || '{}') || {}; for (const k of Object.keys(o)) { const v = o[k]; if (v && isFinite(v.fx) && isFinite(v.fy)) { cont[k] = { fx: Math.min(1, Math.max(0, v.fx)), fy: Math.min(1, Math.max(0, v.fy)) }; origins[k] = 'cont'; } } } catch (e) { /* ignore */ }
  let contSaveT = 0;
  const saveCont = () => { clearTimeout(contSaveT); contSaveT = setTimeout(() => { try { localStorage.setItem(LS_ORIGIN, JSON.stringify(cont)); } catch (e) {} }, 5000); };
  const ORIGIN_CSS = { tl: '0 0', tr: '100% 0', bl: '0 100%', br: '100% 100%' };
  const BASE_CSS = `
.cc-ps-handle{position:fixed;left:0;top:0;width:${HANDLE}px;height:${HANDLE}px;z-index:99990;
  box-sizing:border-box;cursor:nwse-resize;background:transparent;
  border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);
  border-radius:0 0 6px 0;transition:border-color .15s;
  touch-action:none;user-select:none;-webkit-user-select:none}
.cc-ps-handle.cc-ps-bl{cursor:nesw-resize;border-right:0;border-left:2px solid rgba(255,255,255,.35);border-radius:0 0 0 6px}
.cc-ps-handle.cc-ps-bl:hover,.cc-ps-handle.cc-ps-bl.cc-ps-drag{border-left-color:rgba(255,255,255,.7)}
.cc-ps-handle.cc-ps-bl .cc-ps-label{right:auto;left:${HANDLE + 4}px}
.cc-ps-handle:hover,.cc-ps-handle.cc-ps-drag{border-color:rgba(255,255,255,.7)}
.cc-ps-handle[hidden]{display:none!important}
.cc-ps-label{position:absolute;right:${HANDLE + 4}px;bottom:0;padding:1px 5px;border-radius:3px;
  font:12px/16px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.7);white-space:nowrap;
  pointer-events:none;display:none}
.cc-ps-handle.cc-ps-drag .cc-ps-label{display:block}
/* Dimension badges shown on every resizable panel while one is being resized. */
.cc-ps-badges{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:99989}
.cc-ps-badge{position:absolute;left:0;top:0;padding:1px 6px;border-radius:4px;background:rgba(10,10,14,.92);
  border:1px solid #555;color:#ddd;font:12px/16px system-ui,sans-serif;white-space:nowrap}
.cc-ps-badge.drag{border-color:#4ea3ff;color:#fff}
.cc-ps-badge.eq{border-color:#4caf50;color:#7dff8a}
.cc-ps-badge.near{border-color:#ffaa00;color:#ffd24a}
/* Game bug, not ours: .celebration-container (the task-complete popup)
   renders with left:~1620px inside a 2020px-wide #ui-container at a width
   of ~800px -- right edge lands ~400px past the container's own edge,
   permanently off-screen. The numbers line up with a centering formula
   that subtracted half-width from the wrong side (left = containerWidth -
   width/2, instead of (containerWidth - width)/2). Force true centering
   instead of trying to replicate/patch their exact formula -- correct
   regardless of the real root cause, and self-corrects if the element's
   width ever changes. Display-only CSS, same as everything else here. */
/* Queue alternatives: hovering a row's icon container expands the alternative
   options, which overflow past the Tasks panel's edge over neighbouring panels.
   The raise-on-tooltip rule below only holds while the pointer is ON an option,
   so crossing the 3-4 px gap between options dropped the Tasks panel under its
   neighbour and the row collapsed. Keep the panel raised for the whole icon
   container (also while a touch-opened popout is pinned open). */
.panel-floating:has(.icon-container:hover, .icon-container.tap-open){z-index:100000 !important}
/* Title-bar lock button + right-click panel menu. */
/* Current Task panel: its title bar and body had mismatched borders (body has side borders, bar had none) leaving a notch/seam. Give the bar the same side borders and a single divider. */
/* Seam fix: at fractional panel scales the title bar / body edge antialiases into a hairline gap; tuck the body 1px under the bar. */
.floating-current-task > .float-task-inner{margin-top:-1px !important}
.floating-current-task > .panel-titlebar{box-sizing:border-box;border:1.58px solid #2a2a38 !important;border-bottom:0 !important;border-radius:6px 6px 0 0 !important}
.cc-inv-count{margin-left:6px;font-size:12px;color:var(--text-muted,#9a9aa6);white-space:nowrap}
.cc-inv-count.full{color:#ff9d8f}
.cc-lock-btn{opacity:.45}
.cc-lock-btn:hover{opacity:1}
.cc-lock-btn.locked{opacity:1;color:var(--text-gold)}
.cc-pm{position:fixed;z-index:100001;min-width:210px;padding:5px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;
  box-shadow:0 8px 26px rgba(0,0,0,.6);color:#ddd;font:13px/1.35 system-ui,sans-serif;user-select:none}
.cc-pm .pm-h{padding:4px 9px 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
.cc-pm .pm-i{padding:5px 9px;border-radius:5px;cursor:pointer;display:flex;gap:8px;align-items:center}
.cc-pm .pm-i:hover{background:rgba(255,255,255,.09)}
.cc-pm .pm-i.dis{opacity:.4;pointer-events:none}
.cc-pm .pm-sep{height:1px;margin:4px 2px;background:rgba(255,255,255,.1)}
.cc-pm .pm-chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 6px 4px}
.cc-pm .pm-chip{padding:2px 8px;border-radius:5px;border:1px solid #3a3a48;background:#22222c;cursor:pointer}
.cc-pm .pm-chip:hover,.cc-pm .pm-chip.on{border-color:#ffd24a;color:#ffd24a}
.celebration-container{left:50% !important;right:auto !important;transform:translateX(-50%) !important}
/* Same class of game bug as .celebration-container above: .xp-drops-container
   (the floating "+14 XP" readout) renders with left:2020px -- exactly the
   #ui-container's own logical width -- at a width of ~280px, so it starts
   flush at the container's right edge and extends entirely past it
   (confirmed live: ~half on-screen, half off, matching left == containerWidth
   rather than containerWidth - elementWidth). Centered per request. */
.xp-drops-container{left:50% !important;right:auto !important;transform:translateX(-50%) !important}
/* Same bug, third instance: .gauntlet-leave-btn ("Leave Fortress") also
   renders at left:2020px == #ui-container's own logical width, so it starts
   flush at the right edge and extends entirely past it. Centered per request. */
.gauntlet-leave-btn{left:50% !important;right:auto !important;transform:translateX(-50%) !important}
/* Vertical bottom-right menu (display-only restyle of the game's own
   #panel-tab-bar + .hp-bar; nothing is moved or re-parented). The tab icons
   become a column hugging the right edge, and the HP bar becomes a vertical
   strip of the same height right next to it. The HP bar is the game's own
   horizontal element rotated -90deg about its bottom-left corner, so the
   game's inline fill width (width:NN%) keeps working untouched -- it just
   grows upward from the bottom -- and the "52 / 52" text rotates with it.
   --cc-menu-n (tab count) is kept current by sync(); 42px is the game's own
   tab button height. Only the main bar is targeted (not .combat-encounter's
   own .panel-tab-bar variants, which have their own rules). Everything is
   scoped under body.cc-vmenu, which sync() sets/clears from the Plugins
   tab's "Vertical Bottom-Right Menu" toggle. */
body.cc-vmenu #ui-container>.panel-tab-bar{flex-direction:column !important;width:42px !important;
  right:0 !important;bottom:0 !important;top:auto !important}
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn{flex:none !important;width:42px !important;height:42px !important}
/* Vertical mode: the game's buttons only round their BOTTOM corners (made for a bar hanging under a panel).
   Round the side facing away from the screen edge the bar is attached to; all four when it floats free.
   Active = solid outline + a slightly enlarged button (no glow: it was clipped/overdrawn by neighbours and the HP bar). */
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn{border-radius:6px !important}
body.cc-vmenu.cc-vm-r #ui-container>.panel-tab-bar>.panel-tab-btn{border-radius:6px 0 0 6px !important}
body.cc-vmenu.cc-vm-l #ui-container>.panel-tab-bar>.panel-tab-btn{border-radius:0 6px 6px 0 !important}
body.cc-vmenu.cc-vm-t #ui-container>.panel-tab-bar>.panel-tab-btn{border-radius:0 0 6px 6px !important}
body.cc-vmenu.cc-vm-b #ui-container>.panel-tab-bar>.panel-tab-btn{border-radius:6px 6px 0 0 !important}
/* The game's buttons have NO top border (they hang under a panel), so the active outline/glow was open at the top. */
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn{border-top:1.58px solid #2a2a38 !important}
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn{box-shadow:none !important}
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn.active{position:relative;z-index:3;border-color:#5580c0 !important;
  box-shadow:none !important;transform:scale(1.09);transform-origin:50% 50%}
body.cc-vmenu.cc-vm-r #ui-container>.panel-tab-bar>.panel-tab-btn.active{transform-origin:100% 50%}
/* The rounded button corners left see-through wedges next to the HP bar (and between buttons): back the whole bar with the
   buttons' own dark colour so the column reads as one solid piece, and, on sides where the dock is fused to something, tighten the rounding (3px) instead of squaring it off. */
body.cc-vmenu #ui-container>.panel-tab-bar{background:#141418 !important}
/* (fused sides keep the same rounding as everywhere else; only the dark backing hides the wedges) */
body.cc-vmenu.cc-vm-l #ui-container>.panel-tab-bar>.panel-tab-btn.active{transform-origin:0 50%}
body.cc-vmenu #ui-container>.panel-tab-bar>.panel-tab-btn:hover{z-index:4}
body.cc-vmenu #ui-container>.panel-tab-bar{overflow:visible !important;z-index:2}
body.cc-vmenu #ui-container>.panel-tab-bar .panel-tab-tooltip{bottom:auto !important;top:50% !important;
  left:auto !important;right:calc(100% + 34px) !important;transform:translateY(-50%) !important}
body.cc-vmenu #ui-container>.hp-bar{width:calc(var(--cc-menu-n,8) * 42px) !important;height:24px !important;
  right:calc(42px - var(--cc-menu-n,8) * 42px) !important;bottom:0 !important;
  transform-origin:0 100% !important;transform:rotate(-90deg) !important;border-radius:0 !important}
/* The content block is counter-rotated back to upright and turned into a
   column (24px wide, bar-length tall): heart on top, then the text wrapped
   one word per line -- "52" / "/" / "52" -- so it reads normally. */
body.cc-vmenu #ui-container>.hp-bar .hp-bar-content{position:absolute !important;left:50% !important;top:50% !important;
  width:24px !important;height:calc(var(--cc-menu-n,8) * 42px) !important;
  transform:translate(-50%,-50%) rotate(90deg) !important;
  flex-direction:column !important;justify-content:center !important;align-items:center !important;gap:2px !important}
body.cc-vmenu #ui-container>.hp-bar .hp-bar-text{width:min-content;white-space:normal;text-align:center;line-height:1.05;font-size:15px}
`;
  // "Recenter Camera" button: the game pins it 80px above the bottom edge, which lands it on top of the bottom
  // panels. Keep it horizontally centred but drop it into the lowest gap not covered by a panel. Done with a
  // stylesheet rule (the button itself is never touched), recomputed whenever panels move.
  let recenterRule = '', recenterAt = 0;
  function updateRecenter(force) {
    const now = performance.now();
    if (!force && now - recenterAt < 250) return;
    recenterAt = now;
    let rule = '';
    if (settingOn('recenterCameraSmart')) {
      const btn = document.querySelector('.recenter-camera-btn');
      const host = (btn && btn.offsetParent) || document.getElementById('ui-container');
      const hr = host ? host.getBoundingClientRect() : null;
      if (hr && hr.width > 0) {
        const z = uiZoom();
        const br = btn ? btn.getBoundingClientRect() : null;
        const w = br && br.width > 0 ? br.width : 190 * z, h = br && br.height > 0 ? br.height : 42 * z;
        const cx = hr.left + hr.width / 2, x0 = cx - w / 2 - 6, x1 = cx + w / 2 + 6;
        const obst = [];
        for (const tb of titlebars()) {
          const el = tb.parentElement; if (!el || !el.isConnected) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.right > x0 && r.left < x1 && getComputedStyle(el).visibility !== 'hidden') obst.push(r);
        }
        const GAP = 8 * z, floor = hr.bottom - 14 * z;
        const cands = [floor].concat(obst.map(r => r.top - GAP)).sort((a, b) => b - a);
        let y = null;
        for (const c of cands) {
          if (c > floor || c - h < hr.top) continue;
          if (!obst.some(r => r.bottom > c - h && r.top < c)) { y = c; break; }
        }
        if (y == null) y = floor;
        const bottomCss = (hr.bottom - y) / z;
        rule = `.recenter-camera-btn.recenter-camera-btn{bottom:${bottomCss.toFixed(1)}px !important}\n`;
      }
    }
    if (rule !== recenterRule) { recenterRule = rule; renderCss(); }
  }
  const TB_REF = 0.72; // reference scale the title font is normalised to
  let tbFontOn = true;
  const shifts = {}; // panelId -> {x,y} css-px translate that keeps the panel inside the viewport
  const extraOn = {}; // id -> Plugins toggle state for each EXTRA panel (default on)
  function renderCss() {
    let css = BASE_CSS;
    for (const id of Object.keys(scales)) {
      const s = scales[id];
      if (!(s > 0) || s === 1) continue;
      if (EXTRA[id] && extraOn[id] === false) continue;
      const S = panelSel(id);
      css += `${S}{scale:${s} !important;transform-origin:${origins[id] === 'cont' && cont[id] ? (cont[id].fx * 100).toFixed(2) + '% ' + (cont[id].fy * 100).toFixed(2) + '%' : ORIGIN_CSS[origins[id] === 'cont' ? 'tl' : (origins[id] || 'tl')]} !important}\n`;
      // Scaling makes the panel a stacking context; lift it only while one
      // of its own tooltips is showing so the tooltip isn't drawn under a
      // neighbouring panel with a higher z-index.
      css += `${S}:has(:hover > .tooltip, :hover > .icon-tooltip){z-index:100000 !important}\n`;
    }
    // Title text: a scaled panel's title shrinks with it (Tasks at 60% looked tiny
    // beside 72% panels). Counter-scale ONLY the label's font so every scaled
    // panel's title is the same on-screen size (the game's 13px at TB_REF scale).
    if (tbFontOn) {
      for (const id of Object.keys(scales)) {
        const sc = scales[id];
        if (!(sc > 0) || sc === 1 || EXTRA[id]) continue;
        css += `${panelSel(id)} > .panel-titlebar .panel-titlebar-label{font-size:${(13 * TB_REF / sc).toFixed(2)}px !important}\n`;
      }
    }
    // Keep-on-screen corrections (see keepOnScreen): `translate` composes with
    // the game's own transform and our `scale`, and is applied in the parent's
    // (zoomed) px, so values are stored in css px.
    for (const id of Object.keys(shifts)) {
      const sh = shifts[id];
      if (!sh || (Math.abs(sh.x) < 0.05 && Math.abs(sh.y) < 0.05)) continue;
      css += `${panelSel(id)}{translate:${sh.x.toFixed(2)}px ${sh.y.toFixed(2)}px !important}
`;
    }
    css += recenterRule;
    if (style.textContent !== css) style.textContent = css;
  }

  const handles = new Map(); // panelId -> { el, label, last }
  let drag = null;

  function stop(e) { e.stopPropagation(); }

  // "W x H px" (the real on-screen size, so two panels can be matched to the
  // pixel) plus the scale to one decimal.
  const sizeLabel = (r, s) => Math.round(r.width) + '\u00d7' + Math.round(r.height) + ' px \u00b7 ' + (s * 100).toFixed(1) + '%';

  function visiblePanels() {
    const out = [];
    for (const pid of handles.keys()) {
      if (EXTRA[pid] && extraOn[pid] === false) continue;
      const p = findPanel(pid);
      if (!p) continue;
      const r = p.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0) || p.classList.contains('panel-minimized') || getComputedStyle(p).visibility === 'hidden') continue;
      out.push({ id: pid, panel: p, rect: r });
    }
    return out;
  }
  let badgeLayer = null;
  const badgeEls = new Map();
  function hideBadges() { if (badgeLayer) { badgeLayer.remove(); badgeLayer = null; badgeEls.clear(); } }
  // While one panel is being resized, every resizable panel gets a badge with
  // its size in px; panels matching the dragged one's height turn green ("="),
  // within 3 px amber, with the pixel difference -- so outliers stand out.
  function updateBadges(dragId) {
    if (!drag || !drag.opts || !drag.opts.badges) return;
    if (!badgeLayer) { badgeLayer = document.createElement('div'); badgeLayer.className = 'cc-ps-badges'; document.body.appendChild(badgeLayer); }
    const items = visiblePanels();
    const base = items.find(i => i.id === dragId);
    const bh = base ? Math.round(base.rect.height) : 0;
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let b = badgeEls.get(it.id);
      if (!b) { b = document.createElement('div'); badgeLayer.appendChild(b); badgeEls.set(it.id, b); }
      const w = Math.round(it.rect.width), hgt = Math.round(it.rect.height), dh = hgt - bh;
      const isDrag = it.id === dragId;
      b.textContent = w + '\u00d7' + hgt + (isDrag ? '' : dh === 0 ? '  =' : '  ' + (dh > 0 ? '+' : '\u2212') + Math.abs(dh));
      b.className = 'cc-ps-badge' + (isDrag ? ' drag' : dh === 0 ? ' eq' : Math.abs(dh) <= 3 ? ' near' : '');
      b.style.transform = 'translate(' + Math.round(Math.max(0, it.rect.left + 6)) + 'px,' + Math.round(Math.max(0, it.rect.top + 6)) + 'px)';
    }
    for (const [pid, b] of badgeEls) if (!seen.has(pid)) { b.remove(); badgeEls.delete(pid); }
  }

  function createHandle(id) {
    const el = document.createElement('div');
    el.className = 'cc-ps-handle' + (EXTRA[id] && EXTRA[id].corner === 'bl' ? ' cc-ps-bl' : '');
    el.title = 'Drag to scale panel · double-click to reset';
    el.hidden = true;
    el.innerHTML = '<span class="cc-ps-label"></span>';
    const label = el.querySelector('.cc-ps-label');
    // Swallow everything so no click/press ever reaches the game.
    ['mousedown', 'mouseup', 'click', 'contextmenu', 'pointerup', 'wheel'].forEach(t => el.addEventListener(t, stop));
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (e.button !== 0) return;
      const panel = findPanel(id);
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const s0 = scales[id] || 1;
      // Lock in the correct anchor corner for this whole gesture up front
      // -- sync() skips updating it while a drag is active (see below), so
      // without this a fresh scale starting on a panel already sitting at
      // an edge would anchor top-left until release, then jump.
      updateOrigin(id, panel, s0);
      // Never let the panel grow past whichever edge(s) it's now anchored
      // to (it may be top-right/bottom-left/etc, not always top-left), or
      // the grip would end up off-screen.
      let sFit;
      if (origins[id] === 'cont' && cont[id] && !EXTRA[id]) {
        // Continuous origin (ox = fx*w from the unscaled left): the visual
        // box spans [left + ox(1-s), left + ox + s(w-ox)]; largest s keeping
        // both ends on-screen, per axis.
        const { fx, fy } = cont[id];
        const w = r.width / s0, h = r.height / s0;
        const left = r.left - fx * w * (1 - s0), top = r.top - fy * h * (1 - s0);
        const axis = (pos, f, len, max) => {
          let m = Infinity;
          if (f < 1) m = Math.min(m, (max - pos - f * len) / (len * (1 - f)));
          if (f > 0) m = Math.min(m, 1 + pos / (f * len));
          return m;
        };
        sFit = Math.min(axis(left, fx, w, innerWidth), axis(top, fy, h, innerHeight));
      } else {
        const anchorRight = origins[id] === 'tr' || origins[id] === 'br';
        const anchorBottom = origins[id] === 'bl' || origins[id] === 'br';
        const availW = anchorRight ? r.right : innerWidth - r.left;
        const availH = anchorBottom ? r.bottom : innerHeight - r.top;
        sFit = Math.min(availW / (r.width / s0), availH / (r.height / s0));
      }
      // Plugins-tab size options, read once per gesture.
      const opts = {
        whole: settingOn('panelSizeWholePx'),    // snap the visual HEIGHT to whole pixels
        badges: settingOn('panelSizeBadges'),    // show every panel's W x H while resizing
        match: !!(window.__ccPluginSettings && window.__ccPluginSettings.get('panelSizeMatchSnap')), // snap to another panel's height
      };
      // Fused group: scale every member by the same factor around the group's top-left.
      let grp = null;
      const F = window.__ccPanelFuse;
      if (F && F.group && !EXTRA[id]) {
        const ids = F.group(id);
        if (ids.length > 1) {
          const R0 = {}, S0 = {};
          let ax = Infinity, ay = Infinity, ur = -Infinity, ub = -Infinity, kMin = 0, kMax = Infinity;
          ids.forEach(j => {
            const pj = findPanel(j); if (!pj) return;
            const rj = pj.getBoundingClientRect();
            R0[j] = rj; S0[j] = scales[j] || 1;
            ax = Math.min(ax, rj.left); ay = Math.min(ay, rj.top); ur = Math.max(ur, rj.right); ub = Math.max(ub, rj.bottom);
            kMin = Math.max(kMin, MIN_S / S0[j]); kMax = Math.min(kMax, MAX_S / S0[j]);
          });
          kMax = Math.min(kMax, (innerWidth - ax) / (ur - ax), (innerHeight - ay) / (ub - ay));
          if (Object.keys(R0).length > 1) grp = { ids: Object.keys(R0), R0, S0, ax, ay, kMin, kMax: Math.max(1, kMax) };
        }
      }
      drag = { grp, id, el, label, x0: e.clientX, y0: e.clientY, w0: r.width, h0: r.height, s0, sMax: Math.max(s0, Math.min(MAX_S, sFit)), pointerId: e.pointerId, opts };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('cc-ps-drag');
      label.textContent = sizeLabel(r, s0);
      updateBadges(id);
    });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.el !== el) return;
      e.stopPropagation();
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      // Project the pointer delta onto the panel's diagonal: the uniform
      // scale whose corner lands closest to the pointer.
      // Bottom-left handle (right-anchored panel): dragging LEFT grows it.
      const dxs = (EXTRA[id] && EXTRA[id].corner === 'bl') ? -dx : dx;
      const t = (dxs * drag.w0 + dy * drag.h0) / (drag.w0 * drag.w0 + drag.h0 * drag.h0);
      let s = drag.s0 * (1 + t);
      // Unscaled (layout) height in screen px: the visual height is H0 * scale.
      const H0 = drag.h0 / drag.s0;
      if (drag.opts.whole) s = Math.round(H0 * s) / H0; // exact whole-pixel visual height
      else if (Math.abs(s - 1) < SNAP_TO_1) s = 1;
      if (drag.opts.match) {
        // Optional magnet: land exactly on another panel's current height.
        for (const o of visiblePanels()) {
          if (o.id === id) continue;
          if (Math.abs(H0 * s - o.rect.height) <= 3) { s = o.rect.height / H0; break; }
        }
      }
      s = Math.min(drag.sMax, Math.max(MIN_S, s));
      if (drag.grp) {
        const g = drag.grp;
        s = Math.min(drag.s0 * g.kMax, Math.max(drag.s0 * g.kMin, s));
        const k = s / drag.s0, tg = {};
        g.ids.forEach(j => { scales[j] = Math.round(g.S0[j] * k * 1e6) / 1e6; tg[j] = { left: g.ax + k * (g.R0[j].left - g.ax), top: g.ay + k * (g.R0[j].top - g.ay) }; });
        renderCss();
        sync(false);
        g.tg = tg;
        try { window.__ccPanelFuse.place(tg); } catch (err) {}
      } else {
      scales[id] = Math.round(s * 1e6) / 1e6;
      renderCss();
      sync(false);
      }
      const pnl = findPanel(id);
      if (pnl) label.textContent = sizeLabel(pnl.getBoundingClientRect(), scales[id]);
      updateBadges(id);
    });
    const end = e => {
      if (!drag || drag.el !== el) return;
      if (e) e.stopPropagation();
      try { el.releasePointerCapture(drag.pointerId); } catch (err) {}
      el.classList.remove('cc-ps-drag');
      const gEnd = drag.grp;
      if (gEnd) gEnd.ids.forEach(j => { if (scales[j] === 1) delete scales[j]; });
      if (scales[id] === 1) delete scales[id];
      drag = null;
      if (gEnd) {
        // Origins re-settle once the gesture is over (they are frozen for the dragged panel
        // while it is held), which nudges panels: re-place the group a few times, then record offsets.
        for (let i = 0; i < 3; i++) { renderCss(); sync(false); if (gEnd.tg) { try { window.__ccPanelFuse.place(gEnd.tg); } catch (err) {} } }
        try { window.__ccPanelFuse.rebase(); } catch (err) {}
      }
      hideBadges();
      save(); renderCss();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', () => end());
    el.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      delete scales[id]; save(); renderCss();
    });
    document.body.appendChild(el);
    const h = { el, label, last: '' };
    handles.set(id, h);
    return h;
  }

  function findPanel(id) {
    if (EXTRA[id]) return document.querySelector(EXTRA[id].sel);
    const tb = document.querySelector(`.panel-floating > .panel-titlebar[data-panel-id="${CSS.escape(id)}"]`);
    return tb ? tb.parentElement : null;
  }

  function isOccluded(panel, x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const n of stack) {
      if (n.classList && n.classList.contains('cc-ps-handle')) continue;
      if (n.closest && n.closest('.cc-ps-handle')) continue;
      return !panel.contains(n);
    }
    return true;
  }

  // Plugins-tab toggles (plugins-settings-ui.js) -- default ON when that
  // script isn't loaded yet, same as its own schema defaults.
  const settingOn = key => { try { return !(window.__ccPluginSettings && window.__ccPluginSettings.get(key) === false); } catch (e) { return true; } };
  let vmenuOn = null, keepOn = true;
  function syncSettings() {
    const v = settingOn('verticalMenuEnabled');
    if (v !== vmenuOn && document.body) { vmenuOn = v; document.body.classList.toggle('cc-vmenu', v); }
    // Edge snapping is opt-in: unlike the toggles above this is OFF unless the
    // Plugins tab says otherwise, and it's applied here (not only when the
    // Settings panel is built) so it holds from page load.
    edgeSnapEnabled = !!(window.__ccPluginSettings && window.__ccPluginSettings.get('edgeSnapEnabled'));
    const tf = settingOn('titlebarFontNormalize');
    if (tf !== tbFontOn) { tbFontOn = tf; renderCss(); }
    menuOn = settingOn('panelContextMenu');
    const k = settingOn('keepPanelsOnScreen');
    if (k !== keepOn) { keepOn = k; if (!k) { for (const id of Object.keys(shifts)) delete shifts[id]; renderCss(); } }
    for (const id of Object.keys(EXTRA)) {
      const p = settingOn(EXTRA[id].setting);
      if (p !== (extraOn[id] !== false)) { extraOn[id] = p; renderCss(); }
    }
  }
  let frame = 0, lastMenuN = 0;
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
  function syncMenuCount() {
    const tb = qc('#ui-container>.panel-tab-bar');
    if (!tb) return;
    let n = 0;
    for (const c of tb.children) if (getComputedStyle(c).display !== 'none') n++;
    if (n && n !== lastMenuN) { lastMenuN = n; document.documentElement.style.setProperty('--cc-menu-n', String(n)); }
    // Which screen edge(s) the bar is attached to -> which side of the buttons gets the radius.
    const r = tb.getBoundingClientRect();
    if (r.width > 0 && document.body) {
      const E = 6, cl = document.body.classList;
      const near = { r: innerWidth - r.right <= E, l: r.left <= E, t: r.top <= E, b: innerHeight - r.bottom <= E };
      const pick = near.r ? 'r' : near.l ? 'l' : near.t ? 't' : near.b ? 'b' : '';
      ['r', 'l', 't', 'b'].forEach(k => cl.toggle('cc-vm-' + k, pick === k));
    }
  }
  // Perf (2026-10-07): profiled live, this used to run every animation frame
  // and the page-wide querySelectorAll below was ~30% of ALL main-thread time
  // (+ ~9% elementsFromPoint / rect reads). The titlebar list now comes from a
  // cache refreshed at most once a second (panels open/close rarely), and sync
  // itself is scheduled by a ~5 Hz timer plus per-frame ONLY while a mouse
  // button is held (so handles still track a panel being dragged smoothly).
  let tbCache = [], tbCacheAt = -1e9;
  function titlebars() {
    const now = performance.now();
    if (now - tbCacheAt > 1000 || tbCache.some(t => !t.isConnected)) {
      tbCache = [...document.querySelectorAll('.panel-floating > .panel-titlebar[data-panel-id]')];
      tbCacheAt = now;
    }
    return tbCache;
  }
  // A panel can end up (partly or wholly) off screen even though the game
  // clamps drags: the game clamps its own UNSCALED layout box, and e.g. the
  // Tasks panel's saved/auto layout can already put that box past the right
  // edge, which no scale origin can fix. So: if the panel's visual box leaves
  // the viewport, shift it back in with a CSS `translate` (display-only; the
  // game's own left/top are never touched). The shift is recomputed from the
  // panel's NATURAL rect (current rect minus our shift) so it disappears again
  // as soon as the game puts the panel somewhere valid. Frozen while a mouse
  // button is held so it never fights an in-progress drag.
  const KEEP_TOL = 4; // px of overhang ignored (flush-to-edge rounding)
  function uiZoom() {
    const u = document.getElementById('ui-container');
    const z = u ? parseFloat(getComputedStyle(u).zoom) : 1;
    return z > 0 ? z : 1;
  }
  function keepOnScreen(id, r) {
    const z = uiZoom();
    const cur = shifts[id] || { x: 0, y: 0 };
    const nl = r.left - cur.x * z, nr = r.right - cur.x * z, nt = r.top - cur.y * z, nb = r.bottom - cur.y * z;
    let dx = 0, dy = 0;
    if (nr > innerWidth + KEEP_TOL) dx = innerWidth - nr;
    if (nl + dx < -KEEP_TOL) dx = -nl;
    if (nb > innerHeight + KEEP_TOL) dy = innerHeight - nb;
    if (nt + dy < -KEEP_TOL) dy = -nt;
    const nx = dx / z, ny = dy / z;
    if (Math.abs(nx - cur.x) > 0.3 || Math.abs(ny - cur.y) > 0.3) {
      if (nx === 0 && ny === 0) delete shifts[id]; else shifts[id] = { x: nx, y: ny };
      return true;
    }
    return false;
  }
  // ---- panel locks, title-bar lock button, right-click menu ---------------------
  // Lock = the panel can't be moved (title-bar drag is swallowed in the capture
  // phase, so the game's own drag never starts) and can't be resized (handle
  // hidden). Persisted per panel in localStorage `cc-panel-locks`.
  const LOCK_LS = 'cc-panel-locks';
  let locks = {}, menuOn = true, menuEl = null;
  try { locks = JSON.parse(localStorage.getItem(LOCK_LS) || '{}') || {}; } catch (e) { locks = {}; }
  const saveLocks = () => { try { localStorage.setItem(LOCK_LS, JSON.stringify(locks)); } catch (e) {} };
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z"></path></svg>';
  function setLock(id, on) { if (on) locks[id] = true; else delete locks[id]; saveLocks(); decorateTitlebars(); }
  function labelOf(id) {
    const tb = document.querySelector(`.panel-floating > .panel-titlebar[data-panel-id="${CSS.escape(id)}"]`);
    const l = tb && tb.querySelector('.panel-titlebar-label');
    return (l && l.textContent.trim()) || id;
  }
  // Inventory title: "(used/total)" slot counter, a sibling span after the game's label.
  function invCount(tb) {
    let c = tb.querySelector('.cc-inv-count');
    if (!settingOn('inventorySlotCount')) { if (c) c.remove(); return; }
    const slots = tb.parentElement.querySelectorAll('.inv-slot');
    if (!slots.length) return;
    let used = 0; slots.forEach(x => { if (!x.classList.contains('empty')) used++; });
    const txt = '(' + used + '/' + slots.length + ')';
    if (!c) {
      c = document.createElement('span'); c.className = 'cc-inv-count';
      const l = tb.querySelector('.panel-titlebar-label'); if (!l) return;
      l.insertAdjacentElement('afterend', c);
    }
    if (c.textContent !== txt) c.textContent = txt;
    c.classList.toggle('full', used >= slots.length);
  }
  function decorateTitlebars() {
    for (const tb of titlebars()) {
      if (!tb.isConnected) continue;
      const id = tb.dataset.panelId, btns = tb.querySelector('.panel-titlebar-btns');
      if (id === 'inventory') invCount(tb);
      let b = tb.querySelector('.cc-lock-btn');
      if (!menuOn) { if (b) b.remove(); continue; }
      if (!b && btns) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'panel-titlebar-btn cc-lock-btn';
        b.innerHTML = LOCK_SVG;
        ['mousedown', 'pointerdown', 'dblclick'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setLock(id, !locks[id]); });
        btns.insertBefore(b, btns.firstChild);
      }
      if (b) { b.classList.toggle('locked', !!locks[id]); b.title = locks[id] ? 'Locked \u2013 click to unlock this panel' : 'Lock this panel\u2019s position and size'; }
    }
  }
  const inTitlebarDrag = (e) => {
    const t = e.target && e.target.closest ? e.target.closest('.panel-titlebar[data-panel-id]') : null;
    return t && !e.target.closest('.panel-titlebar-btns') ? t : null;
  };
  const onLockPress = (e) => {
    if (!menuOn) return;
    const tb = inTitlebarDrag(e);
    if (tb && locks[tb.dataset.panelId] && e.button === 0) { e.stopPropagation(); e.preventDefault(); }
  };
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function setScaleFor(id, s) {
    s = Math.min(MAX_S, Math.max(MIN_S, s));
    if (Math.abs(s - 1) < 1e-6) delete scales[id]; else scales[id] = Math.round(s * 1e6) / 1e6;
    save(); renderCss();
  }
  function openMenu(id, x, y) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'cc-pm';
    const add = (cls, text, fn) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; if (fn) d.addEventListener('click', e => { e.stopPropagation(); fn(); closeMenu(); }); m.appendChild(d); return d; };
    const head = document.createElement('div'); head.className = 'pm-h'; head.textContent = labelOf(id); m.appendChild(head);
    add('pm-i', locks[id] ? '🔓 Unlock this panel' : '🔒 Lock this panel (no move / resize)', () => setLock(id, !locks[id]));
    const all = titlebars().filter(t => t.isConnected).map(t => t.dataset.panelId);
    const anyUnlocked = all.some(p => !locks[p]);
    add('pm-i', anyUnlocked ? '🔒 Lock all panels' : '🔓 Unlock all panels', () => { all.forEach(p => { if (anyUnlocked) locks[p] = true; else delete locks[p]; }); saveLocks(); decorateTitlebars(); });
    const sep = () => { const d = document.createElement('div'); d.className = 'pm-sep'; m.appendChild(d); };
    sep();
    const panel = findPanel(id), r = panel ? panel.getBoundingClientRect() : null;
    if (!panel) { // a title bar that is not a standard floating panel (e.g. the Current Task): lock only
      document.body.appendChild(m); menuEl = m;
      const mr0 = m.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(innerWidth - mr0.width - 4, x)) + 'px'; m.style.top = Math.max(4, Math.min(innerHeight - mr0.height - 4, y)) + 'px';
      return;
    }
    const cur = scales[id] || 1;
    add('pm-i' + (scales[id] ? '' : ' dis'), 'Reset size (100%)', () => setScaleFor(id, 1));
    const sh = document.createElement('div'); sh.className = 'pm-h'; sh.textContent = 'Size'; m.appendChild(sh);
    const chips = document.createElement('div'); chips.className = 'pm-chips';
    [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].forEach(v => {
      const c = document.createElement('div'); c.className = 'pm-chip' + (Math.abs(cur - v) < 0.005 ? ' on' : ''); c.textContent = Math.round(v * 100) + '%';
      c.addEventListener('click', e => { e.stopPropagation(); setScaleFor(id, v); closeMenu(); }); chips.appendChild(c);
    });
    m.appendChild(chips);
    // Match another panel's on-screen height (the pixel-perfect alignment case).
    const others = visiblePanels().filter(o => o.id !== id && !EXTRA[o.id] && !locks[id]);
    if (r && others.length) {
      const mh = document.createElement('div'); mh.className = 'pm-h'; mh.textContent = 'Match height of'; m.appendChild(mh);
      others.forEach(o => add('pm-i', labelOf(o.id) + '  \u00b7  ' + Math.round(o.rect.height) + ' px', () => {
        const h0 = r.height / cur; if (h0 > 0) setScaleFor(id, o.rect.height / h0);
      }));
    }
    document.body.appendChild(m);
    menuEl = m;
    const mr = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(innerWidth - mr.width - 4, x)) + 'px';
    m.style.top = Math.max(4, Math.min(innerHeight - mr.height - 4, y)) + 'px';
  }
  const onContext = (e) => {
    if (!menuOn) return;
    const tb = e.target && e.target.closest ? e.target.closest('.panel-titlebar[data-panel-id]') : null;
    if (!tb) return;
    e.preventDefault(); e.stopPropagation();
    openMenu(tb.dataset.panelId, e.clientX, e.clientY);
  };
  const onDocClose = (e) => { if (menuEl && !(e.target.closest && e.target.closest('.cc-pm'))) closeMenu(); };
  const onKeyClose = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('mousedown', onLockPress, true);
  document.addEventListener('pointerdown', onLockPress, true);
  document.addEventListener('contextmenu', onContext, true);
  document.addEventListener('mousedown', onDocClose, true);
  document.addEventListener('keydown', onKeyClose, true);
  window.addEventListener('blur', closeMenu);

  // ---- smooth panel move: 1:1 with the pointer, edge snapping, fuse chip -----------------------------------
  // The game's own title-bar drag starts from the panel's VISUAL left/top but writes them back as its layout
  // left/top, so a scaled panel jumped by (origin offset) when you grabbed it and then crept at the wrong speed
  // while our sliding scale-origin changed under it. After each of the game's drag moves (bubble phase, so the
  // game has already written its position) we recompute the layout position that puts the panel's visual box
  // exactly where the pointer drags it, optionally pulled onto nearby panel / screen edges. The game saves
  // whatever ends up in left/top when the drag ends, so the position persists as usual.
  const settingTrue = key => { try { return !!(window.__ccPluginSettings && window.__ccPluginSettings.get(key) === true); } catch (e) { return false; } };
  const SNAP_T = 10; // px
  let mv = null, chip = null, chipTimer = 0;
  const guidePool = [];
  const mvStyle = document.createElement('style');
  mvStyle.id = 'cc-pmove-style';
  mvStyle.textContent = `.cc-snap-guide{position:fixed;z-index:100000;pointer-events:none;background:#ffd24a;box-shadow:0 0 8px rgba(255,210,74,.9);border-radius:1px}
.cc-snap-chip{position:fixed;z-index:100001;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;border:1px solid #ffd24a;background:rgba(20,20,26,.96);color:#ffd24a;font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.6);animation:ccChipIn .18s ease-out}
.cc-snap-chip:hover{background:#2c2a18}
@keyframes ccChipIn{from{opacity:0;transform:translate(-50%,-50%) scale(.85)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.cc-snap-chip{transform:translate(-50%,-50%)}`;
  document.head && document.head.appendChild(mvStyle);
  function showGuides(list) {
    for (let i = 0; i < Math.max(list.length, guidePool.length); i++) {
      let g = guidePool[i];
      if (i >= list.length) { if (g) g.style.display = 'none'; continue; }
      if (!g) { g = guidePool[i] = document.createElement('div'); g.className = 'cc-snap-guide'; document.body.appendChild(g); }
      const q = list[i]; g.style.display = '';
      g.style.left = Math.round(q.x) + 'px'; g.style.top = Math.round(q.y) + 'px'; g.style.width = Math.max(2, Math.round(q.w)) + 'px'; g.style.height = Math.max(2, Math.round(q.h)) + 'px';
    }
  }
  function dropChip() { if (chip) { chip.remove(); chip = null; } clearTimeout(chipTimer); }
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function snapTo(m, Vx, Vy) {
    const F = window.__ccPanelFuse;
    const skip = new Set(F && F.group ? F.group(m.id) : [m.id]); skip.add(m.id);
    const others = [];
    for (const tb of titlebars()) {
      const id = tb.dataset.panelId; if (skip.has(id) || !tb.isConnected) continue;
      const p = tb.parentElement; if (p.classList.contains('panel-minimized')) continue;
      const r = p.getBoundingClientRect(); if (r.width > 0 && r.height > 0) others.push({ id, r });
    }
    const bw = m.bw, bh = m.bh;
    let bx = { d: SNAP_T + 1 }, by = { d: SNAP_T + 1 };
    const tx = (d, kind, o, pen) => { if (Math.abs(d) + (pen || 0) < Math.abs(bx.d) + (bx.pen || 0)) bx = { d, kind, o, pen: pen || 0 }; };
    const ty = (d, kind, o, pen) => { if (Math.abs(d) + (pen || 0) < Math.abs(by.d) + (by.pen || 0)) by = { d, kind, o, pen: pen || 0 }; };
    tx(0 - Vx, 'screen', null, 0); tx(innerWidth - (Vx + bw), 'screen', null, 0);
    ty(0 - Vy, 'screen', null, 0); ty(innerHeight - (Vy + bh), 'screen', null, 0);
    for (const o of others) {
      const r = o.r;
      const vNear = Math.min(Vy + bh, r.bottom) - Math.max(Vy, r.top) > -SNAP_T;
      const hNear = Math.min(Vx + bw, r.right) - Math.max(Vx, r.left) > -SNAP_T;
      if (vNear) { tx(r.left - (Vx + bw), 'edge', o, 0); tx(r.right - Vx, 'edge', o, 0); tx(r.left - Vx, 'align', o, 3); tx(r.right - (Vx + bw), 'align', o, 3); }
      if (hNear) { ty(r.top - (Vy + bh), 'edge', o, 0); ty(r.bottom - Vy, 'edge', o, 0); ty(r.top - Vy, 'align', o, 3); ty(r.bottom - (Vy + bh), 'align', o, 3); }
    }
    const sx = Math.abs(bx.d) <= SNAP_T ? bx : null, sy = Math.abs(by.d) <= SNAP_T ? by : null;
    const x = Vx + (sx ? sx.d : 0), y = Vy + (sy ? sy.d : 0);
    const guides = [], contacts = [];
    if (sx) {
      const lineX = sx.kind === 'screen' ? (Math.abs(sx.d) === Math.abs(0 - Vx) ? 0 : innerWidth - 2) : (Math.abs(sx.d - (sx.o.r.left - (Vx + bw))) < 0.01 ? sx.o.r.left : Math.abs(sx.d - (sx.o.r.right - Vx)) < 0.01 ? sx.o.r.right : (Math.abs(sx.d - (sx.o.r.left - Vx)) < 0.01 ? sx.o.r.left : sx.o.r.right));
      const top = sx.o ? Math.min(y, sx.o.r.top) : y, bot = sx.o ? Math.max(y + bh, sx.o.r.bottom) : y + bh;
      guides.push({ x: lineX, y: top, w: 2, h: bot - top });
      if (sx.kind === 'edge') contacts.push({ o: sx.o, axis: 'x' });
    }
    if (sy) {
      const lineY = sy.kind === 'screen' ? (Math.abs(sy.d) === Math.abs(0 - Vy) ? 0 : innerHeight - 2) : (Math.abs(sy.d - (sy.o.r.top - (Vy + bh))) < 0.01 ? sy.o.r.top : Math.abs(sy.d - (sy.o.r.bottom - Vy)) < 0.01 ? sy.o.r.bottom : (Math.abs(sy.d - (sy.o.r.top - Vy)) < 0.01 ? sy.o.r.top : sy.o.r.bottom));
      const left = sy.o ? Math.min(x, sy.o.r.left) : x, right = sy.o ? Math.max(x + bw, sy.o.r.right) : x + bw;
      guides.push({ x: left, y: lineY, w: right - left, h: 2 });
      if (sy.kind === 'edge') contacts.push({ o: sy.o, axis: 'y' });
    }
    return { x, y, guides, contacts };
  }

  const onMoveStart = (e) => {
    if (e.target && e.target.closest && e.target.closest('.cc-snap-chip')) return; // clicking the chip must not remove it first
    dropChip(); mv = null;
    if (e.button !== 0 || !settingOn('panelSmoothMove')) return;
    const tb = e.target && e.target.closest ? e.target.closest('.panel-floating > .panel-titlebar[data-panel-id]') : null;
    if (!tb || e.target.closest('.panel-titlebar-btn, .cc-fuse-btn, .cc-ps-handle')) return;
    const id = tb.dataset.panelId;
    if (EXTRA[id] || (menuOn && locks[id])) return;
    const el = tb.parentElement, r = el.getBoundingClientRect();
    const uic = document.getElementById('ui-container');
    const z = uic && uic.offsetWidth ? uic.getBoundingClientRect().width / uic.offsetWidth : 1;
    const k = scales[id] || 1;
    const L0 = parseFloat(el.style.left), T0 = parseFloat(el.style.top);
    if (!(r.width > 0) || !isFinite(L0) || !isFinite(T0) || !(z > 0)) return;
    if (k !== 1 && origins[id] !== 'cont') return; // corner-snapping mode keeps the old behaviour
    const w = el.offsetWidth * z, h = el.offsetHeight * z;
    const c0 = k !== 1 && cont[id] ? cont[id] : { fx: 0, fy: 0 };
    mv = {
      id, el, pid: e.pointerId, z, k, w, h, bw: r.width, bh: r.height,
      extraX: r.left - (L0 * z + c0.fx * w * (1 - k)), extraY: r.top - (T0 * z + c0.fy * h * (1 - k)),
      grabX: e.clientX - r.left, grabY: e.clientY - r.top, L0s: el.style.left, T0s: el.style.top, engaged: false, contacts: [],
    };
  };
  const onMoveAfter = (e) => {
    if (!mv || e.pointerId !== mv.pid) return;
    const m = mv, el = m.el;
    if (!el.isConnected) { mv = null; return; }
    if (!m.engaged) { if (el.style.left === m.L0s && el.style.top === m.T0s) return; m.engaged = true; }
    let Vx = e.clientX - m.grabX, Vy = e.clientY - m.grabY;
    m.contacts = [];
    if (settingOn('panelSnap') && !e.shiftKey) { const s = snapTo(m, Vx, Vy); Vx = s.x; Vy = s.y; m.contacts = s.contacts; showGuides(s.guides); } else showGuides([]);
    const solve = (V, extra, size, total) => {
      const room = total - size;
      if (room <= 1) return { X: 0, f: 0 };
      const den = Math.max(0.2, 1 + size * (1 - m.k) / room);
      const X = Math.max(0, Math.min(room, (V - extra) / den));
      return { X, f: clamp01(X / room) };
    };
    const sx = solve(Vx, m.extraX, m.w, innerWidth), sy = solve(Vy, m.extraY, m.h, innerHeight);
    el.style.left = (sx.X / m.z).toFixed(3) + 'px';
    el.style.top = (sy.X / m.z).toFixed(3) + 'px';
    if (m.k !== 1 && origins[m.id] === 'cont') { cont[m.id] = { fx: sx.f, fy: sy.f }; renderCss(); }
  };
  const onMoveEnd = (e) => {
    const m = mv;
    if (!m || (e && e.pointerId !== m.pid)) return;
    mv = null; showGuides([]);
    if (!m.engaged || !m.contacts.length) return;
    const F = window.__ccPanelFuse;
    if (!F || !F.fuseIds || !settingOn('panelFuseEnabled')) return;
    const partner = m.contacts[0].o.id;
    if (F.links.some(l => (l.a === m.id && l.b === partner) || (l.a === partner && l.b === m.id))) return;
    setTimeout(() => {
      try {
        if (settingTrue('panelAutoFuse')) { F.fuseIds(m.id, partner); return; }
        const a = m.el.getBoundingClientRect(), pe = document.querySelector(`.panel-floating > .panel-titlebar[data-panel-id="${CSS.escape(partner)}"]`);
        const b = pe && pe.parentElement.getBoundingClientRect(); if (!b || !(a.width > 0)) return;
        const ox0 = Math.max(a.left, b.left), ox1 = Math.min(a.right, b.right), oy0 = Math.max(a.top, b.top), oy1 = Math.min(a.bottom, b.bottom);
        const side = m.contacts[0].axis;
        const cx = side === 'x' ? (Math.abs(a.right - b.left) < Math.abs(b.right - a.left) ? a.right : a.left) : (ox0 + ox1) / 2;
        const cy = side === 'y' ? (Math.abs(a.bottom - b.top) < Math.abs(b.bottom - a.top) ? a.bottom : a.top) : (oy0 + oy1) / 2;
        dropChip();
        chip = document.createElement('button'); chip.type = 'button'; chip.className = 'cc-snap-chip';
        chip.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 9.5l3-3M5.2 7.2L3.6 8.8a2.4 2.4 0 003.4 3.4l1.6-1.6M10.8 8.8l1.6-1.6a2.4 2.4 0 00-3.4-3.4L7.4 5.4"/></svg>Fuse';
        chip.title = 'Fuse these two panels so they move together';
        chip.style.left = Math.round(cx) + 'px'; chip.style.top = Math.round(cy) + 'px';
        ['pointerdown', 'mousedown'].forEach(t => chip.addEventListener(t, ev => ev.stopPropagation()));
        chip.addEventListener('click', ev => { ev.stopPropagation(); F.fuseIds(m.id, partner); dropChip(); });
        document.body.appendChild(chip);
        chipTimer = setTimeout(dropChip, 5000);
      } catch (err) { /* chip is a nicety */ }
    }, 120);
  };
  document.addEventListener('pointerdown', onMoveStart, true);
  window.addEventListener('pointermove', onMoveAfter);
  window.addEventListener('pointerup', onMoveEnd);
  window.addEventListener('pointercancel', onMoveEnd);

  function sync(checkOcclusion) {
    if (checkOcclusion) { syncMenuCount(); syncSettings(); decorateTitlebars(); }
    updateRecenter(false);
    const seen = new Set();
    for (const tb of titlebars()) {
      if (!tb.isConnected) continue;
      const id = tb.dataset.panelId;
      const panel = tb.parentElement;
      seen.add(id);
      const h = handles.get(id) || createHandle(id);
      const r = panel.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && !panel.classList.contains('panel-minimized') &&
        getComputedStyle(panel).visibility !== 'hidden';
      if (!visible || (menuOn && locks[id])) { h.el.hidden = true; continue; }
      // Fused panels resize as one: only the bottom-right-most member keeps its grip.
      if (!EXTRA[id] && window.__ccPanelFuse && window.__ccPanelFuse.isPrimary && !window.__ccPanelFuse.isPrimary(id) && !(drag && drag.id === id)) { h.el.hidden = true; continue; }
      if (!pointerDown && keepOn && keepOnScreen(id, r)) renderCss();
      // Keep the scale anchor matched to whichever edge(s) this panel is
      // actually resting against (see updateOrigin above) -- re-checked
      // every frame so it tracks the game's own titlebar drag live, not
      // just at drag-start/end on our own handle.
      if (!drag || drag.id !== id) {
        if (updateOrigin(id, panel, scales[id] || 1)) renderCss();
      }
      // Same look as the Walking Countdown panel's handle: an L-shaped
      // corner hugging the panel's own bottom-right corner, drawn inside it.
      // Clamped to the viewport so it always stays grabbable.
      const x = Math.round(Math.min(r.right - HANDLE, innerWidth - HANDLE));
      const y = Math.round(Math.min(r.bottom - HANDLE, innerHeight - HANDLE));
      const key = x + ',' + y;
      if (h.last !== key) { h.el.style.transform = `translate(${x}px,${y}px)`; h.last = key; }
      if (drag && drag.id === id) { h.el.hidden = false; continue; }
      if (checkOcclusion || h.el.hidden) {
        // Probe a point just inside the panel's corner: if something else
        // (another panel, a tooltip, a modal) is on top there, hide the grip.
        h.el.hidden = isOccluded(panel, Math.min(r.right - 6, innerWidth - 2), Math.min(r.bottom - 6, innerHeight - 2));
      }
    }
    for (const id of Object.keys(EXTRA)) {
      seen.add(id);
      const panel = qc(EXTRA[id].sel);
      const h = handles.get(id) || createHandle(id);
      const r = panel ? panel.getBoundingClientRect() : null;
      // display:none (e.g. the game hides it on the World Map view) -> 0x0.
      if (extraOn[id] === false || !r || !(r.width > 0 && r.height > 0) || getComputedStyle(panel).visibility === 'hidden') { h.el.hidden = true; continue; }
      const brc = EXTRA[id].corner === 'br';
      const x = brc ? Math.round(Math.min(r.right - HANDLE, innerWidth - HANDLE)) : Math.round(Math.max(r.left, 0));
      const y = Math.round(Math.min(r.bottom - HANDLE, innerHeight - HANDLE));
      const key = x + ',' + y;
      if (h.last !== key) { h.el.style.transform = `translate(${x}px,${y}px)`; h.last = key; }
      if (drag && drag.id === id) { h.el.hidden = false; continue; }
      // Same occlusion probe as floating panels, just inside the handle's
      // corner: the strip sits at z-index -1, so an open panel covers it.
      if (checkOcclusion || h.el.hidden) h.el.hidden = isOccluded(panel, brc ? Math.min(r.right - 6, innerWidth - 2) : Math.max(r.left + 6, 2), Math.min(r.bottom - 6, innerHeight - 2));
    }
    for (const [id, h] of handles) if (!seen.has(id)) h.el.hidden = true;
  }

  let rafId = 0, alive = true, timerId = 0, frameQueued = false, pointerDown = false;
  const STATS = { syncs: 0, ms: 0 };
  function runSync(occ) {
    if (!alive) return;
    const t0 = performance.now();
    try { sync(occ); } catch (e) { /* never let a bad pass kill the loop */ }
    STATS.syncs++; STATS.ms += performance.now() - t0;
  }
  function queueFrame() {
    if (frameQueued || !alive) return;
    frameQueued = true;
    rafId = requestAnimationFrame(() => { frameQueued = false; runSync(++frame % OCCLUDE_EVERY === 0); if (pointerDown) queueFrame(); });
  }
  const onPointerDown = () => { pointerDown = true; queueFrame(); };
  const onPointerUp = () => { pointerDown = false; setTimeout(() => runSync(true), 60); };
  const onResize = () => { tbCacheAt = -1e9; runSync(true); };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('resize', onResize);
  let tickN = 0;
  function tick() {
    if (!alive) return;
    if (!document.hidden && !pointerDown) runSync(++tickN % 5 === 0); // heavy checks (occlusion, titlebar decoration) once a second
    timerId = setTimeout(tick, 200);
  }

  function teardown(opts) {
    alive = false;
    cancelAnimationFrame(rafId); clearTimeout(timerId);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('resize', onResize);
    for (const h of handles.values()) h.el.remove();
    handles.clear();
    hideBadges();
    closeMenu();
    document.removeEventListener('mousedown', onLockPress, true);
    document.removeEventListener('pointerdown', onLockPress, true);
    document.removeEventListener('pointerdown', onMoveStart, true);
    window.removeEventListener('pointermove', onMoveAfter);
    window.removeEventListener('pointerup', onMoveEnd);
    window.removeEventListener('pointercancel', onMoveEnd);
    dropChip(); showGuides([]); guidePool.forEach(g => g.remove()); mvStyle.remove();
    document.removeEventListener('contextmenu', onContext, true);
    document.removeEventListener('mousedown', onDocClose, true);
    document.removeEventListener('keydown', onKeyClose, true);
    window.removeEventListener('blur', closeMenu);
    document.querySelectorAll('.cc-lock-btn, .cc-inv-count').forEach(el => el.remove());
    style.remove();
    document.documentElement.style.removeProperty('--cc-menu-n');
    if (document.body) document.body.classList.remove('cc-vmenu');
    if (!(opts && opts.keepStorage)) { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc panel-scale torn down';
  }

  window[NS] = {
    version: 2,
    teardown,
    get stats() { return Object.assign({}, STATS); },
    get scales() { return Object.assign({}, scales); },
    // reset('tasks') -> one panel back to 100%; reset() -> all panels.
    reset(id) { if (id) delete scales[id]; else scales = {}; save(); renderCss(); },
    // Controlled from the in-game Plugins settings tab (plugins-settings-ui.js).
    setEdgeSnapEnabled(v) { edgeSnapEnabled = !!v; },
  };

  renderCss();
  tick();
  console.log('[cc] panel scale mod v2 loaded');
  return 'cc panel-scale v2 loaded';
})();
