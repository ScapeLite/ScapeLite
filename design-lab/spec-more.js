// Design Lab: extra specimens that close gaps shown on the Coverage page (docs/DESIGN-LAB.md), plus the table of names that existing specimens already show.
// Everything here copies DOM and class names from the plugins' own builders; no new CSS is written for the lab.
(function () {
  'use strict';
  const L = window.Lab, h = L.h, add = L.add;
  const col = (kids, st) => h('div', { style: Object.assign({ display: 'flex', flexDirection: 'column', gap: '8px' }, st || {}) }, kids);

  // ---- Settings > Plugins page: every group heading and section header of the real page, with the ids the real page gives them
  const sectionNames = () => L.nameList.filter((n) => /^#settings-sec-cc-/.test(n.selector || ''));
  add({ id: 'settings-plugins-sections', cat: 'Windows', title: 'Settings > Plugins page: all groups and sections',
    desc: 'Every group heading and section header of ScapeLite’s Settings > Plugins page, in the real DOM (settings-section-header, cc-group-head) with the ids the real page uses. Rows are in the “Settings > Plugins page” specimen.',
    keywords: 'settings plugins groups sections order headers ids',
    covers: sectionNames().map((n) => n.id),
    variants: [{ label: 'All headings, in page order', w: 520 }],
    render: () => {
      const wrap = h('div.lsp-set', { style: { width: '520px', maxWidth: '100%' } });
      sectionNames().forEach((n) => {
        const grp = /group-/.test(n.id);
        const title = (n.name || n.path.split(' > ').pop()).replace(/^(Group|Section):?\s*/i, '');
        if (grp) wrap.appendChild(h('div.cc-group-head', { id: n.selector.slice(1), 'data-cc-group': title }, title));
        else wrap.appendChild(h('div.settings-section', { id: n.selector.slice(1) }, h('div.settings-section-header', null, title)));
      });
      return wrap;
    } });

  // ---- Layouts window (layouts.js)
  add({ id: 'layouts-window', cat: 'Windows', title: 'Layouts window', desc: 'Save and load named layouts of panel positions, sizes, fuses, docks and window sizes. Header, add row, one row per saved layout and the reset row.',
    keywords: 'layouts presets save load reset cc-layouts',
    covers: ['layouts-window', 'layouts-window.header', 'layouts-window.preset-row', 'layouts-window.add-row'],
    variants: [{ label: 'Two saved layouts', w: 420 }, { label: 'No saved layouts', w: 420 }],
    render: (ctx, v) => {
      const none = /No saved/.test(v.label);
      const rows = none ? [h('div.note', null, 'No saved layouts yet. Arrange your panels, windows and docks the way you like, then save them here.')]
        : ['Questing', 'Raid night'].map((n, i) => h('div.row', null, h('span.nm', null, n), h('small', null, i ? '10/22/2026' : '10/25/2026'), h('button', { title: 'Apply this layout (reloads the game page)' }, 'Load'), h('button', { title: 'Replace this layout with how things are now' }, 'Update'), h('button.dng', { title: 'Delete this layout' }, '×')));
      return h('div#cc-layouts.show', { style: { position: 'relative', left: 'auto', top: 'auto', transform: 'none', width: '400px', maxHeight: 'none' } },
        h('div.hd', null, h('b', null, 'Layouts'), h('span.sp'), h('button', { title: 'Close' }, '×')),
        h('div.bd', null, h('div.add', null, h('input', { placeholder: 'Name this layout (e.g. Questing)', maxlength: 30 }), h('button.pri', null, 'Save current')), ...rows,
          h('div.row', null, h('span.nm', null, 'Game default ', h('small', null, '(reset all positions and sizes)')), h('button.dng', null, 'Reset')),
          h('div.note', null, 'A layout covers panel positions, sizes, fuses, locks, the docks, notification positions, trackers and window sizes. Loading one reloads the game page.')));
    } });

  // ---- Small tooltips, a legacy card, a food total, the drag ghost, divider and channel colour
  add({ id: 'tooltips-small', cat: 'Tooltips and popovers', title: 'Small tooltips', desc: 'The Tree Advisor node tooltip and the tooltip on the window-control buttons (the dock’s World Map cross, the left strip).',
    keywords: 'tooltip tree advisor window control dock',
    covers: ['tree-tooltip', 'window-control-tooltip'],
    variants: [{ label: 'Tree Advisor node', box: [260, 90] }, { label: 'Window control', box: [320, 110] }],
    render: (ctx, v) => /Tree/.test(v.label)
      ? h('div.cc-tadv-tip', { style: { position: 'absolute', left: '14px', top: '10px' } }, h('b', null, 'Gather Speed II'), h('div.dim', null, 'Level 3 of 5'), h('div.good', null, '+4% items an hour'))
      : h('div.tooltip.global-tooltip.window-control-style', { style: { position: 'absolute', left: '14px', top: '10px', opacity: 1, visibility: 'visible', display: 'block' } }, h('div.tt-name', null, 'World Map'), h('div.tt-line', null, 'Opens the map of every area. Hotkey: M.')) });
  add({ id: 'legacy-card-spec', cat: 'Cards and rows', title: 'Legacy Card', desc: 'The old left-border list item, still exported for third-party plugins. New code uses the Row.',
    keywords: 'cc-card old alias', covers: ['legacy-card'],
    variants: [{ label: 'Tones', w: 320 }],
    render: () => col(['', 'good', 'warn', 'bad', 'accent', 'info'].map((t) => h('div.cc-card', { 'data-tone': t || null }, h('b', null, t ? t[0].toUpperCase() + t.slice(1) : 'Plain'), h('div.s', null, 'A line of detail under the title')))) });
  add({ id: 'drop-luck-chip', cat: 'Cards and rows', title: 'Drop Luck chip card', desc: 'The small stat chip on the Drop Luck panel’s overview; the green one marks a good result.',
    keywords: 'drop luck chip stat', covers: ['drop-luck-chip-card'],
    variants: [{ label: 'Plain and good', w: 300 }],
    render: () => h('div#cc-droplog', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '300px' } },
      h('div.chip', null, h('div.t', null, 'Kills tracked'), h('div.s', null, '1,482 this week')), h('div.chip.g', null, h('div.t', null, 'Rare drops'), h('div.s', null, '7 (expected 4.2)'))) });
  add({ id: 'food-total-spec', cat: 'Overlays', title: 'Food total on the potion row', desc: 'The total healing and the remaining food count that ScapeLite adds to the bottom right of the game’s food row.',
    keywords: 'food potion row heal remaining', covers: ['food-total'],
    variants: [{ label: 'On a food row', box: [300, 56] }],
    render: () => h('div.potion-row.cc-food-sum', { style: { position: 'absolute', inset: '8px', border: '1px solid #2c3442', borderRadius: '6px', background: '#12161d', color: '#e6e6ee', padding: '6px 8px', font: '13px system-ui' } }, 'Cooked Trout',
      h('div.cc-food-total', null, h('span.cc-food-heal', null, h('b', null, '2,340'), h('img', { src: '/assets/icons/skills/life.png', alt: 'Life' })), h('span', null, h('b', null, '78'), h('img', { src: '/assets/icons/skills/cook.png', alt: 'Cook' })))) });
  add({ id: 'cmp-more', cat: 'Components', title: 'Divider, channel colour and drag ghost', desc: 'The thin vertical divider between bar modules, the channel colour variable (--t) and the ghost of a queue card while it is dragged.',
    keywords: 'cc-vsep divider cc-chan channel colour cc-q-ghost drag', covers: ['divider', 'channel-colour', 'drag-ghost'],
    variants: [{ label: 'Divider and channel colour', w: 360 }, { label: 'Drag ghost', box: [320, 90] }],
    render: (ctx, v) => /ghost/i.test(v.label)
      ? h('div.cc-q-row.cc-q-ghost', { style: { position: 'absolute', left: '16px', top: '12px', width: '280px', height: '48px', padding: '8px 10px' } }, h('b', null, 'Battle Root'), h('span', { style: { opacity: 0.7 } }, '  92 x  12 min'))
      : h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', width: '360px' } }, h('span', null, 'Gold 3.7M'), h('span.cc-vsep'), h('span', null, 'XP/h 24.8k'), h('span.cc-vsep'),
        ['#7fd6ff', '#ffd24a', '#7ee081'].map((c, i) => h('span.cc-chan', { style: { '--t': c, color: 'var(--t)', fontWeight: 700 } }, ['Global', 'Clan', 'Friends'][i]))) });

  // ---- Names that other specimens already show in their real or copied DOM (checked against the rendered specimens by selector; see docs/DESIGN-LAB.md, Coverage).
  const ALSO = {
    'queue-hover-card': ['card', 'queue-panel.list', 'queue-panel.card.number', 'queue-panel.card.title', 'queue-panel.card.subtitle', 'queue-panel.card.meta', 'queue-panel.card.meta.time', 'queue-panel.card.meta.xp',
      'queue-panel.card.dots', 'queue-panel.card.progress-bar', 'queue-panel.walking-gap', 'card.current', 'card.frame-colour', 'card.material-shortage', 'walk-length.short-to-long',
      'queue-panel.controls-bar.fold-button', 'queue-panel.controls-bar.fold-summary', 'queue-panel.controls-bar.lane-switch', 'queue-panel.controls-bar.master-buttons', 'queue-panel.controls-bar.credits', 'queue-panel.controls-bar.auto-chip', 'queue-panel.footer.hint'],
    'queue-kept-panel': ['queue-panel.header.title', 'queue-panel.header.summary'],
    'panel-shell': ['panel.header.title', 'panel.header.subtitle', 'panel.header.value', 'panel.header.chip-text', 'panel.header.gear-button', 'panel.header.collapse-button', 'panel.header.close-button', 'icon', 'scroll-area', 'hint'],
    'panel-modes': ['hover-card'], 'panel-tabbadge': ['empty'],
    'menu-context': ['panel-gear-menu', 'queue-panel-gear-menu'], 'modal-basic': ['dots'], 'xp-tracker': ['xp-chip'], 'goals': ['goal-pet-row', 'goal-hunt-row'], 'drop-luck': ['pet-card.state'],
    'tree-advisor': ['saved-build-row'], 'lever-advisor': ['mode.drawer-open'], 'route-advisor': ['loading'], 'layout-editor': ['layout-editor-group-menu'], 'card-quests': ['info-bar.hover-card.tab-row'],
    'settings-plugins-page': ['author-card'],
  };
  Object.keys(ALSO).forEach((id) => { const sp = L.specs.find((s) => s.id === id); if (sp) ALSO[id].forEach((n) => { if (sp.covers.indexOf(n) < 0) sp.covers.push(n); }); });
})();
