// ScapeLite default layout: one ready-made arrangement of every panel, worked out for the window you have (viewport, Info Bars, game zoom).
// Pure data and arithmetic, no DOM: the Layout Editor (ui-layout.js) calls build() and stores the result as the layout 'ScapeLite default';
// scripts/test-default-layout.js loads this same file in node and checks it at many window sizes.
//
// The design is drawn once, in "design px" on a 1920 x 1012 area (a 1920 x 1080 window minus two 34 px Info Bars), and then scaled by
// f = min(width / 1920, usable height / 1012). Columns hug the right edge, the helper tabs and the chat hug the left, so a wider window
// only adds empty space in the middle.
//
//   ┌──────────────────────────────────────────────────────────────────────────────┐ top Info Bar
//   │ Info (game)    ░░ notifications: invites, task popups, toasts: kept clear ░░ │
//   │ ┌ helpers ────┐                   ┌ Route ─────┐ ┌ slot A ───┐ ┌ Queue ────┐ │
//   │ │ Goals Luck… │                   │ Advisor    │ │ Inventory │ │            │ │
//   │ │ (tab group) │                   │            │ │ Equipment │ │  (Task)    │ │
//   │ └─────────────┘                   │            │ │ Barter    │ │            │ │
//   │ ┌ Chat ───────┐                   │            │ ├ slot B ───┤ └────────────┘ │
//   │ │             │                   │            │ │ Skills …  │ ┌ XP tracker ┐ │
//   │ └─────────────┘                   └────────────┘ └───────────┘ └────────────┘ │
//   └──────────────────────────────────────────────────────────────────────────────┘ bottom Info Bar
//
// Panels that share a spot (slot A: inventory-type, slot B: character-type, the queue) are never opened together in practice; pinned cards of one
// slot are also made a tab group, so opening two shows a tab strip instead of one on top of the other.
(function (root) {
  'use strict';
  const NAME = 'ScapeLite default';
  const DW = 1920, DH = 1012;               // the design area
  const GAP = 8;
  const NOTIF_H = 150, NOTIF_X = 0.30;      // keep-out band for invites, task popups and toasts: top 150 design px, right 70 % of the width
  const STRIP_W = 84, STRIP_H = 640;        // the game's left tab strip
  const NAT = { w: 376, h: 440 };           // the game's windows (--panel-width x 440)
  const MULT_MIN = 0.5, MULT_MAX = 2;       // ui-scale.js setMult range

  // column geometry from the right edge, in design px: [right margin, real width]
  const COL = { R1: [GAP, 378], R2: [GAP + 378 + GAP, 302], R3: [GAP + 378 + GAP + 302 + GAP, 378] };
  const Y0 = 160;                           // first row below the notification band

  // ScapeLite panels. w,h = size before scaling; c = on-screen scale at f = 1 (real size is w*c by h*c); ax = anchor.
  const KIT = [
    { id: 'cc-queue', ax: ['r', 'R1'], y: Y0, w: 440, h: 700, c: 0.8, stack: 'queue', size: true },
    { id: 'cc-xp-tracker', ax: ['r', 'R1'], y: 744, w: 460, h: 300, c: 0.8, stack: 'xp', size: true },
    { id: 'cc-route-panel', ax: ['r', 'R3'], y: Y0, w: 420, h: 0, c: 0.9, stack: 'route', fixedW: true, estH: 640 },
    { id: 'cc-goals', ax: ['l', 96], y: Y0, w: 440, h: 500, c: 0.9, stack: 'helpers', size: true },
    { id: 'cc-droplog', ax: ['l', 96], y: Y0, w: 440, h: 500, c: 0.9, stack: 'helpers', size: true },
    { id: 'cc-matshort', ax: ['l', 96], y: Y0, w: 440, h: 500, c: 0.9, stack: 'helpers', size: true },
    { id: 'cc-treeadv', ax: ['l', 96], y: Y0, w: 440, h: 500, c: 0.9, stack: 'helpers', size: true },
    { id: 'cc-chat', ax: ['bl', GAP], yb: GAP, w: 580, h: 270, c: 0.9, stack: 'chat', size: true },
    // pinned cards share the spot of the game's window of the same family
    { id: 'cc-card-inventory', ax: ['r', 'R2'], y: Y0, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotA', size: true },
    { id: 'cc-card-equipment', ax: ['r', 'R2'], y: Y0, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotA', size: true },
    { id: 'cc-card-barter', ax: ['r', 'R2'], y: Y0, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotA', size: true },
    { id: 'cc-card-skills', ax: ['r', 'R2'], y: Y0 + 360, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotB', size: true },
    { id: 'cc-card-quests', ax: ['r', 'R2'], y: Y0 + 360, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotB', size: true },
    { id: 'cc-card-diary', ax: ['r', 'R2'], y: Y0 + 360, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotB', size: true },
    { id: 'cc-card-friends', ax: ['r', 'R2'], y: Y0 + 360, w: NAT.w, h: NAT.h, c: 0.8, stack: 'slotB', size: true },
  ];
  // the game's own floating windows: real width in design px (height follows from the window's own shape)
  const GAME = [
    { id: 'g:tasks', ax: ['r', 'R1'], y: Y0, rw: 340, nh: 616, stack: 'queue' },
    { id: 'g:inventory', ax: ['r', 'R2'], y: Y0, rw: 302, nh: NAT.h, stack: 'slotA' },
    { id: 'g:equipment', ax: ['r', 'R2'], y: Y0, rw: 302, nh: NAT.h, stack: 'slotA' },
    { id: 'g:barter', ax: ['r', 'R2'], y: Y0, rw: 302, nh: NAT.h, stack: 'slotA' },
    { id: 'g:skills', ax: ['r', 'R2'], y: Y0 + 360, rw: 302, nh: NAT.h, stack: 'slotB' },
    { id: 'g:quests', ax: ['r', 'R2'], y: Y0 + 360, rw: 302, nh: NAT.h, stack: 'slotB' },
    { id: 'g:diary', ax: ['r', 'R2'], y: Y0 + 360, rw: 302, nh: NAT.h, stack: 'slotB' },
    { id: 'g:friends', ax: ['r', 'R2'], y: Y0 + 360, rw: 302, nh: NAT.h, stack: 'slotB' },
  ];
  const GROUPS = [
    ['cc-goals', 'cc-droplog', 'cc-matshort', 'cc-treeadv'],
    ['cc-card-inventory', 'cc-card-equipment', 'cc-card-barter'],
    ['cc-card-skills', 'cc-card-quests', 'cc-card-diary', 'cc-card-friends'],
  ];
  // the look: the kit's own defaults (ScapeLite palette, cozy spacing, default text size, gold accent), so the layout never changes colours
  const LOOK = { uiPalette: 'default', uiDensity: 'cozy', uiFontPx: 0, uiAccent: '' };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r2 = (v) => Math.round(v * 100) / 100;

  // The numbers a window has to be laid out with. vp = { w, h, top, bottom, zoom, g }:
  //   w,h = innerWidth/innerHeight, top/bottom = Info Bar heights (0 when off), zoom = the game's UI zoom, g = global panel size (uiScalePct / 100).
  function frame(vp) {
    const w = Math.max(640, Number(vp.w) || DW), h = Math.max(480, Number(vp.h) || 1080);
    const top = Math.max(0, Number(vp.top) || 0), bottom = Math.max(0, Number(vp.bottom) || 0);
    const uh = Math.max(240, h - top - bottom);
    const f = clamp(Math.min(w / DW, uh / DH), 0.55, 1.6);
    const zoom = clamp(Number(vp.zoom) > 0 ? Number(vp.zoom) : Math.min(w / 1920, h / 1080), 0.3, 1.6);
    const g = clamp(Number(vp.g) > 0 ? Number(vp.g) : 1, 0.5, 2);
    return { w, h, top, bottom, uh, f, zoom, g };
  }
  const colX = (fr, ax, wr) => {
    const f = fr.f;
    if (ax[0] === 'r') { const c = typeof ax[1] === 'string' ? COL[ax[1]] : [ax[1], wr]; return fr.w - (c[0] + wr) * f; }
    return ax[1] * f;   // 'l' and 'bl': a left margin in design px
  };

  // build(vp) -> { name, panels, groups, look, gameScales, rects, frame }
  //   panels:  per id { x, y, w?, h?, s? } for the layout store (kit panels in viewport px; game windows: tx, ty = wanted on-screen top-left, x, y = first guess in the game's own units)
  //   gameScales: id -> scale the game's window gets (panel-resize's own unit: on-screen size / (natural size * zoom))
  //   rects:   id -> { x, y, w, h, stack } what each panel covers on screen (what the tests check)
  function build(vp) {
    const fr = frame(vp), f = fr.f, panels = {}, rects = {}, gameScales = {};
    KIT.forEach((e) => {
      const m = clamp(e.c * f / (fr.zoom * fr.g), MULT_MIN, MULT_MAX), S = m * fr.zoom * fr.g;   // S = the real scale after the clamp
      const wr = e.w * S, hr = e.h ? e.h * S : (e.estH || 400) * f;
      const x = colX(fr, e.ax, wr / f);
      const y = e.yb != null ? fr.top + fr.uh - e.yb * f - hr : fr.top + e.y * f;
      const p = { x: Math.round(x), y: Math.round(y) };
      if (e.size && e.h) { p.w = e.w; p.h = e.h; }
      if (Math.abs(m - 1) > 0.001) p.s = r2(m);
      panels[e.id] = p;
      rects[e.id] = { x: p.x, y: p.y, w: wr, h: hr, stack: e.stack };
    });
    GAME.forEach((e) => {
      const s = clamp(e.rw * f / (NAT.w * fr.zoom), MULT_MIN / Math.max(1, fr.zoom), 2), wr = NAT.w * fr.zoom * s, hr = e.nh * fr.zoom * s;
      const x = colX(fr, e.ax, wr / f), y = fr.top + e.y * f;
      gameScales[e.id.slice(2)] = Math.round(s * 1e6) / 1e6;
      panels[e.id] = { x: Math.round(x / fr.zoom), y: Math.round((y - fr.top) / fr.zoom), tx: Math.round(x), ty: Math.round(y) };
      rects[e.id] = { x: Math.round(x), y: Math.round(y), w: wr, h: hr, stack: e.stack };
    });
    return { name: NAME, panels, groups: GROUPS.map((g) => g.slice()), look: Object.assign({}, LOOK), gameScales, rects, frame: fr };
  }

  // the parts of the screen nothing of ours may cover (real px for a frame): the notification band and the game's own corner
  function keepOut(fr) {
    const f = fr.f;
    return [
      { name: 'notifications (invites, task popups, toasts)', x: fr.w * NOTIF_X, y: fr.top, w: fr.w * (1 - NOTIF_X), h: NOTIF_H * f },
      { name: 'Info panel and left tab strip', x: 0, y: fr.top, w: STRIP_W * f, h: STRIP_H * f },
    ];
  }

  const api = { NAME, KIT, GAME, GROUPS, LOOK, DW, DH, NAT, frame, build, keepOut, version: 1 };
  if (root) root.__ccDefaultLayout = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
