// Design Lab scenes: a whole mock game screen at the scenario's window size, composed from the same specimens as the category pages (Lab.build(id)).
// What shows follows the scenario: activity (idle / combat / fortress / dungeon), queue size, hit points, alerts. The game itself is only a backdrop.
(function () {
  'use strict';
  const L = window.Lab, h = L.h;

  // [specimen id, variant index, anchor, dx, dy, show(S)]. Anchors: tl tr bl br tc bc. A missing specimen id is skipped (so the lab works while specimens are added).
  const PARTS = [
    ['info-bar-top', 0, 'tl', 0, 0, () => true],
    ['queue-hover-card', 0, 'tl', 12, 48, (S) => S.queue !== 'empty' || true],
    ['xp-tracker', 0, 'bl', 12, 12, (S) => S.mode === 'idle'],
    ['alert-bell', 0, 'tr', 16, 48, () => true],
    ['hp-panel', 0, 'bc', 0, 16, (S) => S.mode !== 'idle' || S.hp !== 'high'],
    ['combat-readout', 0, 'tc', 0, 110, (S) => S.mode === 'combat'],
    ['fortress-tracker', 0, 'tr', 16, 110, (S) => S.mode === 'fortress'],
    ['raid-dps-extra', 0, 'tr', 16, 110, (S) => S.mode === 'dungeon'],
    ['chat-panel', 0, 'bl', 12, 12, (S) => S.mode !== 'idle'],
    ['raid-toast', 0, 'tc', 0, 52, (S) => S.mode === 'dungeon' && S.alert === 'firing'],
    ['status-indicator', 0, 'br', 8, 8, () => true],
  ];

  function game(W, H, S) {
    const el = h('div', { style: { position: 'relative', width: W + 'px', height: H + 'px', overflow: 'hidden', background: 'radial-gradient(ellipse at 50% 40%,#2b3a2a,#141c18 70%)', fontFamily: 'system-ui,sans-serif', contain: 'layout paint' }, class: 'lab-box' });
    // backdrop: the game's own world and left icon strip (not ScapeLite)
    el.appendChild(h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.07)', fontSize: Math.round(H / 14) + 'px', fontWeight: 700, letterSpacing: '.08em', userSelect: 'none' } },
      S.mode === 'combat' ? 'COMBAT (mock backdrop)' : S.mode === 'fortress' ? 'FORTRESS (mock backdrop)' : S.mode === 'dungeon' ? 'DUNGEON (mock backdrop)' : 'GAME WORLD (mock backdrop)'));
    const strip = h('div', { style: { position: 'absolute', left: '0', top: '46px', display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px' } });
    for (let i = 0; i < 9; i++) strip.appendChild(h('div', { style: { width: '34px', height: '34px', borderRadius: '6px', background: 'rgba(20,26,34,.8)', border: '1px solid rgba(255,255,255,.12)' } }));
    el.appendChild(strip);
    return el;
  }
  function place(part, node, W, H) {
    const [, , a, dx, dy] = part, st = { position: 'absolute' };
    if (a[0] === 't') st.top = dy + 'px'; else st.bottom = dy + 'px';
    if (a[1] === 'l') st.left = dx + 'px'; else if (a[1] === 'r') st.right = dx + 'px'; else { st.left = '50%'; st.transform = 'translateX(-50%)'; }
    return h('div', { style: st }, node);
  }
  function scene(ctx, v) {
    const S = ctx.S, size = v.size || ctx.Lab.winSize(), W = size.w, H = size.h;
    const avail = Math.max(360, (document.getElementById('lab-content') || document.body).clientWidth - 80), k = Math.min(1, avail / W);
    const g = game(W, H, S), used = [];
    PARTS.forEach((p) => {
      if (!p[5](S) || !L.specs.some((s) => s.id === p[0])) return;
      try { g.appendChild(place(p, L.build(p[0], p[1]), W, H)); used.push(p[0]); } catch (e) { console.error('scene part ' + p[0], e); }
    });
    const wrap = h('div.lab-scene-wrap', { style: { width: Math.round(W * k) + 'px', height: Math.round(H * k) + 'px' } }, h('div', { style: { width: W + 'px', height: H + 'px', transform: 'scale(' + k + ')', transformOrigin: '0 0' } }, g));
    return h('div', null, wrap, h('p.lab-note-inline', { style: { marginTop: '6px' } }, W + ' x ' + H + (k < 1 ? ' (shown at ' + Math.round(k * 100) + '%)' : '') + ' · ' + used.length + ' ScapeLite surfaces: ' + used.join(', ')));
  }
  L.add({ id: 'scene-game', cat: 'Scenes', title: 'Game screen', desc: 'Everything ScapeLite draws on one mock screen. Change the activity, queue, hit points, alerts and window size in the Scenario panel.', keywords: 'scene screen layout whole composition window size',
    covers: [], variants: [{ label: 'Selected window size' }], render: (ctx, v) => scene(ctx, v) });
  L.add({ id: 'scene-small', cat: 'Scenes', title: 'Small window', desc: 'The same scenario in a small game window: panels keep their size, so this is where overlap and clamping problems show.', keywords: 'scene small window 800x600 crowding overlap',
    covers: [], variants: [{ label: '800 x 600', size: { w: 800, h: 600 } }], render: (ctx, v) => scene(ctx, v) });
})();
