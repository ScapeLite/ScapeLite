// ScapeLite default layout: one clean, ready-made arrangement worked out for the window you have (viewport, Info Bars, game zoom).
// Pure data and arithmetic, no DOM: the Layout Editor (ui-layout.js) calls build() and stores the result as the layout 'ScapeLite default';
// scripts/test-default-layout.js loads this same file in node and checks it at many window sizes.
//
// The design is drawn once, in "design px" on a 1920 x 1012 area (a 1920 x 1080 window minus two 34 px Info Bars) and scaled by
// f = min(width / 1920, usable height / 1012). Rules that make it look intentional:
//   - ONE grid: a 16 px margin to the left, top and bottom edges, an 8 px gutter between panels, every x and width a multiple of 8. On the right the
//     margin is 48: the Route Advisor's handle sits on that edge, and the docks leave it a clear rail.
//   - ONE column width (352): the task queue, XP tracker, the game's windows and every pinned card are exactly that wide.
//   - ONE scale (0.9375 of the game's own, times f) for every ScapeLite panel, so text has the same size everywhere.
//   - TWO shared horizontal lines: the right-hand docks split at the same y and end at the same bottom edge.
//   - FEW things open: the task queue, the XP tracker and the chat. Everything else is placed (so it lands tidily when you open it from the
//     ScapeLite menu) but closed. The Route Advisor is not placed at all: it keeps its own handle on the right screen edge.
//
//   ┌──────────────────────────────────────────────────────────────────────────────┐ top Info Bar
//   │ Info (game)    ░░ notifications: invites, task popups, toasts: kept clear ░░ │
//   │ ┌ helpers ────┐                                    ┌ slot A ────┐ ┌ Queue ───┐ │
//   │ │ (closed;    │                                    │ Inventory  │ │          │ │
//   │ │  tab group) │                                    │ Equipment  │ │  (Task)  │ │
//   │ └─────────────┘                                    ├ slot B ────┤ ├──────────┤ │
//   │ ┌ Chat ───────┐                                    │ Skills …   │ │ XP       │ │
//   │ └─────────────┘                                    └────────────┘ └──────────┘ │
//   └──────────────────────────────────────────────────────────────────────────────┘ bottom Info Bar
//
// Panels that share a spot (slot A: inventory-type, slot B: character-type, the helpers) are never open together in practice; pinned cards of one
// slot are also made a tab group, so opening two shows a tab strip instead of one on top of the other.
(function (root) {
  'use strict';
  const NAME = 'ScapeLite default';
  const DW = 1920, DH = 1012;               // the design area
  const M = 16, GAP = 8;                    // margin to the left, top and bottom screen edges, gutter between panels
  const RAIL = 34;                          // real px the Route Advisor handle needs on the right edge (it is 30 px wide)
  const MR = 48;                            // the right margin is wider: a 30 px rail for the Route Advisor's handle, which sits on the right screen edge
  const NOTIF_H = 150, NOTIF_X = 0.30;      // keep-out band for invites, task popups and toasts: top 150 design px, right 70 % of the width
  const STRIP_W = 84, STRIP_H = 640;        // the game's left tab strip
  const NAT = { w: 376, h: 440 };           // the game's windows (--panel-width x 440)
  const MULT_MIN = 0.5, MULT_MAX = 2;       // ui-scale.js setMult range

  const CW = 352;                           // THE column width of everything docked on the right (and of the helpers' group)
  const C = 0.9375;                         // THE scale of every ScapeLite panel (15/16 of the game's own); 376 x 0.9375 = 352.5 = CW
  const KW = 376;                           // native width of a panel that is CW wide at scale C
  const Y1 = 152, H1 = 416;                 // top row of the right-hand docks: just below the notification band
  const Y2 = Y1 + H1 + GAP, H2 = 420;       // bottom row; it ends 16 px above the bottom edge of the design area
  const nat = (h) => Math.round(h / C);     // native height that shows as h design px at scale C

  // column geometry from the right edge, in design px: [right margin, real width]
  const COL = { R1: [MR, CW], R2: [MR + CW + GAP, CW] };
  const HX = 104;                           // left edge of the helpers: right of the game's left tab strip (84), on the grid

  // ScapeLite panels. w,h = size before scaling; c = on-screen scale at f = 1 (real size is w*c by h*c); ax = anchor.
  // w = 0: the panel keeps its own width (the wide data panels).
  const KIT = [
    { id: 'cc-queue', ax: ['r', 'R1'], y: Y1, w: KW, h: nat(H1), c: C, stack: 'queue', size: true },
    { id: 'cc-xp-tracker', ax: ['r', 'R1'], y: Y2, w: KW, h: nat(H2), c: C, stack: 'xp', size: true, grow: true },
    { id: 'cc-chat', ax: ['bl', M], yb: M, w: 444, h: nat(232), c: C, stack: 'chat', size: true },
    // helpers: one tab group, closed until you open one from the ScapeLite menu
    { id: 'cc-goals', ax: ['l', HX], y: Y1, w: KW, h: nat(H1), c: C, stack: 'helpers', size: true },
    { id: 'cc-droplog', ax: ['l', HX], y: Y1, w: KW, h: nat(H1), c: C, stack: 'helpers', size: true },
    { id: 'cc-matshort', ax: ['l', HX], y: Y1, w: KW, h: nat(H1), c: C, stack: 'helpers', size: true },
    { id: 'cc-treeadv', ax: ['l', HX], y: Y1, w: KW, h: nat(H1), c: C, stack: 'helpers', size: true },
    { id: 'cc-advisor', ax: ['l', HX], y: Y1, w: 0, estW: 470, h: nat(H1 + 112), c: C, stack: 'helpers', size: false, estH: H1 + 112 },
    { id: 'cc-diary-credits', ax: ['l', HX], y: Y1, w: 0, estW: 560, h: nat(H1 + 112), c: C, stack: 'helpers', size: false, estH: H1 + 112 },
    // pinned cards share the spot of the game's window of the same family
    { id: 'cc-card-inventory', ax: ['r', 'R2'], y: Y1, w: KW, h: nat(H1), c: C, stack: 'slotA', size: true },
    { id: 'cc-card-equipment', ax: ['r', 'R2'], y: Y1, w: KW, h: nat(H1), c: C, stack: 'slotA', size: true },
    { id: 'cc-card-barter', ax: ['r', 'R2'], y: Y1, w: KW, h: nat(H1), c: C, stack: 'slotA', size: true },
    { id: 'cc-card-skills', ax: ['r', 'R2'], y: Y2, w: KW, h: nat(H2), c: C, stack: 'slotB', size: true, grow: true },
    { id: 'cc-card-quests', ax: ['r', 'R2'], y: Y2, w: KW, h: nat(H2), c: C, stack: 'slotB', size: true, grow: true },
    { id: 'cc-card-diary', ax: ['r', 'R2'], y: Y2, w: KW, h: nat(H2), c: C, stack: 'slotB', size: true, grow: true },
    { id: 'cc-card-friends', ax: ['r', 'R2'], y: Y2, w: KW, h: nat(H2), c: C, stack: 'slotB', size: true, grow: true },
  ];
  // the game's own floating windows: real width in design px (height follows from the window's own shape). The game's Tasks window is not moved:
  // the Task queue takes its place. A window of 440 natural height fits both rows at this width (440 x 352 / 376 = 412).
  const GAME = [
    { id: 'g:inventory', ax: ['r', 'R2'], y: Y1, rw: CW, nh: NAT.h, stack: 'slotA' },
    { id: 'g:equipment', ax: ['r', 'R2'], y: Y1, rw: CW, nh: NAT.h, stack: 'slotA' },
    { id: 'g:barter', ax: ['r', 'R2'], y: Y1, rw: CW, nh: NAT.h, stack: 'slotA' },
    { id: 'g:skills', ax: ['r', 'R2'], y: Y2, rw: CW, nh: NAT.h, stack: 'slotB' },
    { id: 'g:quests', ax: ['r', 'R2'], y: Y2, rw: CW, nh: NAT.h, stack: 'slotB' },
    { id: 'g:diary', ax: ['r', 'R2'], y: Y2, rw: CW, nh: NAT.h, stack: 'slotB' },
    { id: 'g:friends', ax: ['r', 'R2'], y: Y2, rw: CW, nh: NAT.h, stack: 'slotB' },
  ];
  const GROUPS = [
    ['cc-goals', 'cc-droplog', 'cc-matshort', 'cc-treeadv', 'cc-advisor', 'cc-diary-credits'],
    ['cc-card-inventory', 'cc-card-equipment', 'cc-card-barter'],
    ['cc-card-skills', 'cc-card-quests', 'cc-card-diary', 'cc-card-friends'],
  ];
  // Which ScapeLite panels are open after the layout is applied: only the few that matter. Everything else of ours that can be opened is closed
  // (and reopened by "Back to my old layout"); the ScapeLite menu opens any of them again. NS maps a panel id to the plugin that opens it.
  const NS = {
    'cc-queue': '__ccQueue', 'cc-xp-tracker': '__ccXpTracker', 'cc-chat': '__ccChat',
    'cc-goals': '__ccGoals', 'cc-droplog': '__ccDropLuck', 'cc-matshort': '__ccMaterialShortage', 'cc-treeadv': '__ccTreeAdvisor',
    'cc-advisor': '__ccAdvisor', 'cc-diary-credits': '__ccDiaryCredits',
  };
  const OPEN = ['cc-queue', 'cc-xp-tracker', 'cc-chat'];
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
    if (ax[0] === 'r') { const c = typeof ax[1] === 'string' ? COL[ax[1]] : [ax[1], wr]; return fr.w - (c[0] + wr) * f - Math.max(0, RAIL - MR * f); }   // in a small window the rail still stays 34 real px wide
    return ax[1] * f;   // 'l' and 'bl': a left margin in design px
  };

  // build(vp) -> { name, panels, groups, look, gameScales, rects, frame, open, close }
  //   panels:  per id { x, y, w?, h?, s? } for the layout store (kit panels in viewport px; game windows: tx, ty = wanted on-screen top-left, x, y = first guess in the game's own units)
  //   gameScales: id -> scale the game's window gets (panel-resize's own unit: on-screen size / (natural size * zoom))
  //   rects:   id -> { x, y, w, h, stack } what each panel covers on screen (what the tests check)
  //   open / close: the ScapeLite panels to have open / closed afterwards (plugin namespaces, see NS)
  function build(vp) {
    const fr = frame(vp), f = fr.f, panels = {}, rects = {}, gameScales = {};
    const extra = Math.max(0, fr.uh / f - DH);   // a window taller than 16:9 has room left under the design: the bottom row of the docks takes it, so both columns still end 16 px above the bottom Info Bar
    KIT.forEach((e) => {
      const m = clamp(e.c * f / (fr.zoom * fr.g), MULT_MIN, MULT_MAX), S = m * fr.zoom * fr.g;   // S = the real scale after the clamp
      const hn = e.h && e.grow ? e.h + Math.round(extra * f / S) : e.h;
      const wr = (e.w || e.estW) * S, hr = hn ? hn * S : (e.estH || 400) * f;
      const x = colX(fr, e.ax, wr / f);
      const y = e.yb != null ? fr.top + fr.uh - e.yb * f - hr : fr.top + e.y * f;
      const p = { x: Math.round(x), y: Math.round(y) };
      if (e.size && hn) { p.w = e.w; p.h = hn; }
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
    const open = OPEN.map((id) => NS[id]), close = Object.keys(NS).filter((id) => !OPEN.includes(id)).map((id) => NS[id]);
    return { name: NAME, panels, groups: GROUPS.map((g) => g.slice()), look: Object.assign({}, LOOK), gameScales, rects, frame: fr, open, close };
  }

  // the parts of the screen nothing of ours may cover (real px for a frame): the notification band and the game's own corner
  function keepOut(fr) {
    const f = fr.f;
    return [
      { name: 'notifications (invites, task popups, toasts)', x: fr.w * NOTIF_X, y: fr.top, w: fr.w * (1 - NOTIF_X), h: NOTIF_H * f },
      { name: 'Info panel and left tab strip', x: 0, y: fr.top, w: STRIP_W * f, h: STRIP_H * f },
    ];
  }

  const api = { NAME, KIT, GAME, GROUPS, LOOK, NS, OPEN, DW, DH, NAT, M, MR, GAP, CW, C, Y1, Y2, H1, H2, HX, frame, build, keepOut, version: 2 };
  if (root) root.__ccDefaultLayout = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
