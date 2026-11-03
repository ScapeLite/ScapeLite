// Design Lab specimens for the shared kit (overlay/ui-kit.js): panel shell, rows, cells, chips, menus, tooltips, toasts, inputs, states ...
// Menus and toasts are built by the REAL UI.menu() / UI.toast(); everything else is DOM with the kit's real classes (docs/COMPONENTS.md).
(function () {
  'use strict';
  const L = window.Lab, h = L.h, add = L.add;
  const num = L.num;
  const stage = (kids, st) => h('div', { style: Object.assign({ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }, st || {}) }, kids);
  const col = (kids, st) => h('div', { style: Object.assign({ display: 'flex', flexDirection: 'column', gap: '8px' }, st || {}) }, kids);
  const note = (t) => h('p.lab-note-inline', null, t);
  const tones = ['good', 'warn', 'bad', 'info', 'magic', 'accent', 'kill', 'dim'];
  const sk = (n) => L.skill(n);

  // a real kit menu, detached from the page so it can sit in a specimen (its hover submenus are pure CSS)
  function realMenu(items, opts) {
    const UI = window.__ccUI; const m = UI.menu(items, -9999, -9999, opts); const c = m.cloneNode(true); UI.closeMenu(); c.removeAttribute('style'); return c;
  }
  function realToast(msg, o) {
    const UI = window.__ccUI; const t = UI.toast(msg, o); const c = t.cloneNode(true); t.remove(); c.removeAttribute('style'); c.removeAttribute('id'); return c;
  }
  // panel shell as ui-kit's UI.panel() builds it
  function shell(o, body, foot) {
    const hd = h('div.hd', null, h('b', null, o.title, o.sub ? h('span.cc-hsub', null, o.sub) : null), o.chip ? h('span.chiptxt', null, o.chip) : null, o.val ? h('span.cc-hval', null, o.val) : null,
      o.gear ? h('button.cc-ib.cc-gear', { title: 'Settings' }, '⚙') : null, o.min === false ? null : h('button.min', null, o.collapsed ? '+' : '–'), o.x === false ? null : h('button.x', null, '×'));
    const p = h('div.cc-panel.show' + (o.cls ? '.' + o.cls : ''), { role: 'dialog', 'data-cc-panel': '1', 'data-mode': o.mode, style: o.w ? { width: o.w + 'px' } : null }, hd, h('div.bd.cc-scroll', null, body), foot ? h('div.ft', null, foot) : null, o.mode === 'hover' ? null : h('i.cc-grip'));
    if (o.collapsed) p.classList.add('min');
    if (o.w && o.w < 220) p.style.minWidth = '90px';   // panels that go micro set their own minimum (e.g. the queue: 90 px)
    return o.w ? (window.Lab.ctx().watch(p), p) : p;
  }
  Lab.shell = shell; Lab.realMenu = realMenu; Lab.realToast = realToast;

  // ---------------------------------------------------------------- Panels
  add({ id: 'panel-shell', cat: 'Panels', title: 'Panel shell', desc: 'The kit panel every kept panel is made of: header (title, summary, value, buttons), body, optional footer, resize grip.',
    keywords: 'cc-panel hd bd ft grip header body footer',
    covers: ['panel', 'panel.header', 'panel.body', 'panel.footer', 'panel.grip'],
    variants: [{ label: 'Full (400 px)', w: 400 }, { label: 'Compact (260 px)', w: 260 }, { label: 'Micro (150 px)', w: 150 }],
    render: (ctx, v) => shell({ title: 'Goals', sub: '3 skills on pace', val: '1h 24m', gear: true, w: v.w },
      [h('div.cc-sec', null, 'Closest to the next step', h('span.n', null, '3')),
       ...ctx.M.skills.slice(0, 3).map((s, i) => h('div.cc-row.flat', { 'data-tone': ['good', 'info', 'warn'][i] }, h('span.lf', null, h('span.cc-tile.sm', null, sk(s.id))), h('span.ti', null, s.name + ' ' + (s.lvl + 1)), h('span.su', null, num(s.xpHr) + ' XP/h'),
         h('span.mt', null, h('b', null, i + 1 + 'h ' + (i * 12 + 10) + 'm'), h('span', null, num(2000 * (i + 1)) + ' XP')), h('span.pr', null, h('span.cc-prog.thin', { style: { '--p': s.frac * 100 + '%' } }, h('i')))))],
      [h('span', null, '3 goals'), h('span.cc-hint', null, 'right-click the title for sizes')]) });
  add({ id: 'panel-modes', cat: 'Panels', title: 'Panel modes', desc: 'One DOM, four chromes: floating, docked (square bottom), collapsed to a chip, and the hover form (no buttons, no grip).',
    covers: ['panel', 'mode.collapsed-chip', 'mode.hover', 'mode.docked'],
    variants: [{ label: 'Floating' }, { label: 'Docked (.docked)' }, { label: 'Collapsed chip (.min)' }, { label: 'Hover form (data-mode=hover)' }],
    render: (ctx, v) => {
      const body = h('dl.cc-kv', null, h('dt', null, 'Speed'), h('dd', null, '2.1s'), h('dt', null, 'Max hit'), h('dd', { 'data-tone': 'good' }, '46'), h('dt', null, 'Accuracy'), h('dd', null, '87%'));
      const i = ctx.Lab.specs.length; const lbl = v.label;
      const o = { title: 'Combat', sub: 'Dustclaw Raider', val: '46 max', w: 280 };
      if (/Docked/.test(lbl)) o.cls = 'docked'; if (/Collapsed/.test(lbl)) { o.collapsed = true; o.chip = '24.8k XP/h'; o.w = 0; } if (/Hover/.test(lbl)) o.mode = 'hover';
      const p = shell(o, body); if (o.mode === 'hover') { p.style.position = 'relative'; p.style.width = '280px'; } else if (o.w) p.style.width = o.w + 'px'; return p;
    } });
  add({ id: 'panel-tabbadge', cat: 'Panels', title: 'Panel with tab-docked badge', desc: 'The status tab that sits on the top edge of a panel or button (Route Advisor "possible" badge). Panels keep overflow:visible so it can sit outside.',
    covers: ['tab-docked-badge', 'panel'],
    variants: [{ label: 'Optimal (green)' }, { label: 'Accent' }, { label: 'Spinner (calculating)' }],
    render: (ctx, v) => {
      const tone = /Accent/.test(v.label) ? 'accent' : '', badge = h('button.cc-tabbadge', { 'data-tone': tone || null, style: { position: 'absolute', left: '50%', top: '0', transform: 'translate(-50%,-100%)' } }, /Spinner/.test(v.label) ? [h('i.cc-spin'), 'Calculating'] : tone ? '⚡ +1.8% possible' : '✓ Optimal');
      const p = shell({ title: 'Task queue', sub: '2.1 h, 8 tasks', w: 300 }, h('div.cc-empty', null, h('span.ic', null, '⚒'), h('b', null, 'Nothing queued'), h('span', null, 'Pick tasks in the game’s task window'))); p.appendChild(badge);
      const wrap = h('div', { style: { paddingTop: '30px' } }, p); return wrap;
    } });

  // ---------------------------------------------------------------- Components
  add({ id: 'cmp-buttons', cat: 'Components', title: 'Buttons', desc: 'Text buttons (.cc-btn) in every variant, and the 24 px icon button (.cc-ib).', keywords: 'cc-btn cc-ib button primary quiet danger go',
    covers: ['button', 'icon-button', 'button-row'],
    render: () => col([
      stage([h('button.cc-btn', null, 'Default'), h('button.cc-btn', { 'data-v': 'primary' }, 'Primary'), h('button.cc-btn', { 'data-v': 'quiet' }, 'Quiet'), h('button.cc-btn', { 'data-v': 'danger' }, 'Danger'), h('button.cc-btn.go', null, 'Ridgetop Mine ›'), h('button.cc-btn', { disabled: true }, 'Disabled')]),
      stage([h('button.cc-btn.sm', null, 'Small'), h('button.cc-btn.sm', { 'data-v': 'primary' }, 'Small primary'), h('button.cc-btn.sm.go', null, 'Show me')]),
      stage([h('button.cc-ib', { title: 'Settings' }, '⚙'), h('button.cc-ib', { 'aria-pressed': 'true', title: 'Pinned' }, '★'), h('button.cc-ib', null, '×'), h('button.cc-ib', null, '–'), h('button.cc-ib', null, '+')]),
      note('Hover and pressed look: move the pointer over a button (hover = --cc-bg-hover, pressed moves 1 px down).')]) });
  add({ id: 'cmp-chips', cat: 'Components', title: 'Chips', desc: 'Filter / toggle chips (.cc-chip). Dashed = filter off. The count is an accent bubble.', keywords: 'cc-chip filter toggle channel',
    covers: ['chip', 'chip-group'],
    render: () => col([stage([h('button.cc-chip', null, 'Global'), h('button.cc-chip.on', { 'aria-pressed': 'true' }, 'Nearby'), h('button.cc-chip', { 'data-tone': 'good' }, 'Friends', h('span.n', null, '3')), h('button.cc-chip', { 'data-tone': 'magic' }, '[Clan]'), h('button.cc-chip.off', null, 'Game'), h('button.cc-chip', { disabled: true }, 'Disabled')]),
      stage([h('div.cc-chips', null, ['Skilling', 'Combat', 'Quests', 'Lucky', 'Boosts'].map((t, i) => h('button.cc-chip' + (i < 2 ? '.on' : ''), { 'aria-pressed': String(i < 2) }, t)))])]) });
  add({ id: 'cmp-tabs-seg', cat: 'Components', title: 'Tabs and segmented control', desc: 'Tab = underline, switches a panel view. Segmented = one-of-N setting. Three shapes for three jobs: chip (filter), tab (view), seg (choice).', keywords: 'cc-tabs cc-tab cc-seg tab strip',
    covers: ['tab-strip', 'tab', 'segmented-control'],
    render: () => col([h('div.cc-tabs', { role: 'tablist', style: { width: '340px' } }, h('button.cc-tab', { role: 'tab', 'aria-selected': 'true' }, 'Plan'), h('button.cc-tab', { role: 'tab' }, 'Alternatives'), h('button.cc-tab', { role: 'tab' }, 'Luck', h('span.n', null, '12'))),
      h('div.cc-seg', null, h('button', { 'aria-pressed': 'true' }, 'On foot'), h('button', null, 'Efficient'), h('button', null, 'Teleport'), h('button', { disabled: true }, 'Locked'))]) });
  add({ id: 'cmp-pills-badges', cat: 'Components', title: 'Pills, badges and tier chips', desc: 'Pill = short status/value with tone (walk time scale via --w). Badge = count or dot. Tier chip = T5 / L40.', keywords: 'cc-pill cc-badge cc-tierchip walking time',
    covers: ['pill', 'badge', 'tier-chip'],
    render: () => col([
      stage([h('span.cc-pill', { style: { '--w': '95,224,109' } }, '🚶 2 min', h('small', null, '2,393 steps')), h('span.cc-pill', { style: { '--w': '226,216,74' } }, '🚶 5 min'), h('span.cc-pill', { style: { '--w': '255,160,60' } }, '🚶 8 min'), h('span.cc-pill', { style: { '--w': '255,90,80' } }, '🚶 14 min'), h('span.cc-pill', { 'data-tone': 'magic' }, '🌀 Teleport')]),
      stage(tones.slice(0, 6).map((t) => h('span.cc-pill', { 'data-tone': t }, 'Best +1.8%')).concat([h('span.cc-pill.solid', { 'data-tone': 'good' }, 'Done')])),
      stage([h('span.cc-badge', null, '3'), h('span.cc-badge', { 'data-tone': 'accent' }, 'new'), h('span.cc-badge.dot'), h('span.cc-tierchip', null, 'T5'), h('span.cc-tierchip', { 'data-tone': 'kill' }, 'L40')])]) });
  add({ id: 'cmp-tiles', cat: 'Components', title: 'Tiles', desc: 'Icon tile: lane outline (green skilling, red combat), tier label, corner marker. The queue’s tiles add category icons and a material-shortage mark.', keywords: 'cc-tile cc-q-tile lane marker',
    covers: ['tile', 'queue-panel.card.tile', 'queue-panel.card.tile.category-markers', 'queue-panel.card.tile.shortage-mark', 'card.lane'],
    render: () => col([
      stage([h('span.cc-tile.sm', null, sk('mine')), h('span.cc-tile', null, sk('mine'), h('b.cc-tier', null, 'T5')), h('span.cc-tile.lg', null, sk('smith'), h('b.cc-tier', null, 'T3')), h('span.cc-tile', { 'data-k': 'kill' }, sk('strike'), h('b.cc-tier', null, 'L40')), h('span.cc-tile', { 'data-k': 'empty' }, h('span.cc-ico', null, '+')),
        h('span.cc-tile', { 'data-p': 'xp' }, sk('farm')), h('span.cc-tile', { 'data-p': 'adv' }, sk('brew'))]),
      stage([['', 'normal'], ['lucky', 'lucky'], ['quest', 'quest step'], ['boost', 'XP-boost drop']].map(([e, t]) => h('figure', { style: { margin: 0, textAlign: 'center', color: 'var(--lab-faint)', fontSize: '11px' } }, h('span.cc-tile.cc-q-tile', { 'data-k': 'skill', 'data-e': e || null }, sk('forage'), h('b.cc-tier', null, 'T2')), h('div', null, t)))
        .concat([['bad', 'short'], ['warn', 'tight'], ['save', 'relies on saves']].map(([m, t]) => h('figure', { style: { margin: 0, textAlign: 'center', color: 'var(--lab-faint)', fontSize: '11px' } }, h('span.cc-tile.cc-q-tile', { 'data-k': 'skill', 'data-m': m }, sk('brew')), h('div', null, 'material ' + t))))),
      note('Tile data attributes: data-k = skill|kill|empty (lane), data-e = lucky|quest|boost (frame), data-m = bad|warn|save (material shortage), data-p = xp|adv (corner badge).')]) });
  add({ id: 'cmp-progress', cat: 'Components', title: 'Progress bars', desc: '.cc-prog: thin / default / thick, tones, and the queued-XP segment (<u>) that starts at --p.', keywords: 'cc-prog progress bar queued xp',
    covers: ['progress-bar'],
    render: () => col([['thin', '', 'thick'].map((s, i) => h('span.cc-prog' + (s ? '.' + s : ''), { style: { '--p': 30 + i * 25 + '%', width: '240px' } }, h('i'))),
      tones.slice(0, 5).map((t, i) => h('span.cc-prog', { 'data-tone': t, style: { '--p': 20 + i * 18 + '%', width: '240px' } }, h('i'))),
      h('span.cc-prog.thick', { 'data-tone': 'info', style: { '--p': '40%', '--q': '14%', width: '240px' } }, h('i'), h('u')), note('Bright green segment = XP already queued.')].flat()) });
  add({ id: 'cmp-stats-kv-table', cat: 'Components', title: 'Stats, key-value list and table', keywords: 'cc-stat cc-kv cc-table hero delta',
    desc: 'Headline numbers (.cc-stat, .hero for the one big number), label/value pairs (.cc-kv), comparison table with signed deltas (.cc-table .num .pos .neg).',
    covers: ['stat', 'stat-row', 'key-value-list', 'table'],
    render: (ctx) => col([
      h('div.cc-stats', { style: { width: '420px' } }, h('div.cc-stat.hero', { 'data-tone': 'good' }, h('b', null, '+' + num(ctx.M.xpHr / 1000 * 10) / 10 + 'k'), h('span', null, 'xp / hr')), h('div.cc-stat', null, h('b', null, '2.1 h'), h('span', null, 'queue')), h('div.cc-stat', { 'data-tone': 'warn' }, h('b', null, num(ctx.M.steps)), h('span', null, 'steps'))),
      h('dl.cc-kv', { style: { width: '260px' } }, h('dt', null, 'Speed'), h('dd', null, '2.1s'), h('dt', null, 'Max hit'), h('dd', { 'data-tone': 'good' }, '46'), h('dt', null, 'Defence'), h('dd', { 'data-tone': 'bad' }, '12')),
      h('table.cc-table', { style: { width: '420px' } }, h('thead', null, h('tr', null, h('th', null, 'Effect'), h('th.num', null, 'Change'))), h('tbody', null, h('tr', null, h('td', null, 'Crit'), h('td.num.pos', { 'data-tone': 'good' }, '4')), h('tr', null, h('td', null, 'Damage taken'), h('td.num.neg', { 'data-tone': 'bad' }, '2'))))]) });
  add({ id: 'cmp-callouts', cat: 'Components', title: 'Callouts and section headings', desc: 'A message inside a body (never a coloured panel). One glyph per tone so colour is never the only cue. Section heading = uppercase with hairline.', keywords: 'cc-callout cc-sec big headline',
    covers: ['callout', 'section-heading'],
    render: () => col([h('div.cc-sec', null, 'Closest to the next step', h('span.n', null, '6')),
      ...['info', 'good', 'warn', 'bad', 'accent', 'magic'].map((t) => h('div.cc-callout', { 'data-tone': t, style: { width: '420px' } }, h('span', null, h('b', null, t[0].toUpperCase() + t.slice(1) + '. '), 'A short plain-language message about what is happening.'))),
      h('div.cc-callout.big', { 'data-tone': 'good', style: { width: '420px' } }, h('b', null, 'Save 24m 59s of walking'), h('span', null, 'Best order found with teleports'))]) });
  add({ id: 'cmp-inputs', cat: 'Components', title: 'Inputs: text, select, number, toggle, slider', keywords: 'cc-in cc-sel cc-num cc-sw cc-range cc-field input switch slider',
    desc: 'All real form controls. Toggle is <input class="cc-sw" type=checkbox>; slider fill is --fill.',
    covers: ['input', 'number-input', 'select', 'toggle-switch', 'slider', 'field'],
    render: () => {
      const r = h('input.cc-range', { type: 'range', style: { '--fill': '60%', width: '180px' }, value: 60, oninput() { this.style.setProperty('--fill', this.value + '%'); } });
      return col([stage([h('input.cc-in', { placeholder: 'Search ...' }), h('input.cc-in', { value: 'wrong value', 'aria-invalid': 'true' }), h('select.cc-sel', null, h('option', null, 'Top bar'), h('option', null, 'Bottom bar')), h('input.cc-num', { type: 'number', value: 12 })]),
        stage([h('input.cc-sw', { type: 'checkbox' }), h('input.cc-sw', { type: 'checkbox', checked: true }), h('input.cc-sw', { type: 'checkbox', disabled: true }), r]),
        h('label.cc-field', null, 'Name', h('input.cc-in', { 'aria-invalid': 'true' }), h('span.err', null, 'This name is already used'))]);
    } });
  add({ id: 'cmp-settings', cat: 'Components', title: 'Settings rows and sheet', desc: 'A settings row (.cc-set: label, hint, control) and the sheet that slides over a panel body (cogwheel > settings).', keywords: 'cc-set cc-sheet cc-btnrow settings',
    covers: ['settings-row', 'settings-sheet'],
    render: () => {
      const sheet = h('div.cc-sheet', null, h('div.hd', null, h('button.cc-ib', null, '‹'), 'Chat settings'), h('div.bd.cc-scroll', null, h('div.cc-sec', null, 'Chat'),
        h('div.cc-set', null, h('b', null, 'Show seconds'), h('span', null, 'Adds :ss to every time stamp.'), h('div.ctl', null, h('input.cc-sw', { type: 'checkbox', checked: true }))),
        h('div.cc-set', null, h('b', null, 'Message width'), h('span', null, 'Percent of the panel.'), h('div.ctl', null, h('input.cc-range', { type: 'range', style: { '--fill': '70%' }, value: 70 }))),
        h('div.cc-set', { 'data-wide': '' }, h('b', null, 'Highlight words'), h('span', null, 'Comma separated.'), h('div.ctl', null, h('input.cc-in', { value: 'raid, clan' }))),
        h('div.cc-btnrow', null, h('button.cc-btn', { 'data-v': 'primary' }, 'Apply'), h('button.cc-btn', { 'data-v': 'quiet' }, 'Reset'))));
      const p = shell({ title: 'Chat', w: 380 }, h('div', { style: { height: '300px' } })); p.appendChild(sheet); return p;
    } });
  add({ id: 'cmp-empty-states', cat: 'Components', title: 'Empty, skeleton and spinner', desc: 'Loading = skeleton blocks at the real heights; computing = spinner + text; empty = glyph, title, one line.', keywords: 'cc-empty cc-skel cc-spin loading',
    covers: ['empty-state', 'skeleton', 'spinner'],
    render: () => stage([h('div.cc-empty', { style: { width: '240px', border: '1px dashed var(--cc-border)', borderRadius: '8px' } }, h('span.ic', null, '⚒'), h('b', null, 'Nothing queued'), h('span', null, 'Pick tasks in the game’s task window')),
      col([h('div.cc-skel.row', { style: { width: '240px' } }), h('div.cc-skel.row', { style: { width: '240px' } }), h('div.cc-skel', { style: { width: '160px', height: '12px' } })]), h('span', { style: { color: 'var(--cc-text-dim)', font: '13px system-ui' } }, h('i.cc-spin'), ' Calculating the best order ...')]) });
  add({ id: 'cmp-graph', cat: 'Components', title: 'Graph and sparkline', desc: '.cc-graph frames an SVG using classes gl (grid), ax (axis text), ln (line), ar (area); .cc-spark is the inline sparkline.', keywords: 'cc-graph cc-spark chart',
    covers: ['graph-frame', 'sparkline'],
    render: () => {
      const pts = [12, 18, 15, 24, 31, 28, 38, 35, 44, 41], mx = 50, path = pts.map((p, i) => (i ? 'L' : 'M') + (i * 34 + 6) + ' ' + (110 - p / mx * 96)).join(' ');
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 320 120');
      [20, 50, 80, 110].forEach((y) => { const l = document.createElementNS(ns, 'line'); l.setAttribute('class', 'gl'); l.setAttribute('x1', 0); l.setAttribute('x2', 320); l.setAttribute('y1', y); l.setAttribute('y2', y); svg.appendChild(l); });
      const a = document.createElementNS(ns, 'path'); a.setAttribute('class', 'ar'); a.setAttribute('d', path + ' L312 110 L6 110 Z'); a.setAttribute('opacity', '.35'); svg.appendChild(a);
      const l = document.createElementNS(ns, 'path'); l.setAttribute('class', 'ln'); l.setAttribute('d', path); svg.appendChild(l);
      const t = document.createElementNS(ns, 'text'); t.setAttribute('class', 'ax'); t.setAttribute('x', 4); t.setAttribute('y', 14); t.textContent = '30k xp/h'; svg.appendChild(t);
      const sp = document.createElementNS(ns, 'svg'); sp.setAttribute('class', 'cc-spark'); sp.setAttribute('viewBox', '0 0 64 20'); const sp2 = document.createElementNS(ns, 'path'); sp2.setAttribute('d', 'M1 16 L10 12 L19 14 L28 8 L37 9 L46 4 L63 2'); sp.appendChild(sp2);
      return stage([h('div.cc-graph', { style: { width: '340px' } }, svg), sp]);
    } });
  add({ id: 'cmp-skill-grid', cat: 'Cards and rows', title: 'Grid cells (skills grid)', desc: 'The skills/inventory/equipment grid: .cc-grid > .cc-cell. Bar tone follows progress (>= 85% good, >= 50% info, >= 25% warn, else bad). Level-up arrow, tier chip, quantity, empty slot, silhouette, dimmed.', keywords: 'cc-grid cc-cell skills inventory equipment',
    covers: ['grid', 'cell'],
    variants: [{ label: '5 columns', w: 380 }, { label: '3 columns, compact', w: 230 }],
    render: (ctx, v) => {
      const cols = v.w < 300 ? 3 : 5;
      const g = h('div.cc-grid', { style: { '--cols': cols } });
      ctx.M.skills.slice(0, cols * 3 - 2).forEach((s, i) => { const t = s.frac >= .85 ? 'good' : s.frac >= .5 ? 'info' : s.frac >= .25 ? 'warn' : 'bad';
        g.appendChild(h('div.cc-cell', { 'data-up': i === 3 ? '' : null }, i % 4 === 0 ? h('span.cc-tierchip', null, 'T' + (1 + i % 5)) : null, i % 3 === 0 ? h('span.q', null, num(40 + i * 7)) : null, sk(s.id), h('span.lv', null, s.lvl), h('span.cc-prog', { 'data-tone': t, style: { '--p': s.frac * 100 + '%', '--q': i === 1 ? '12%' : '0%' } }, h('i'), h('u'))));
      });
      g.appendChild(h('div.cc-cell.sil', null, sk('luck'), h('span.lv', null, '1'))); g.appendChild(h('div.cc-cell.empty'));
      return h('div', { style: { width: v.w + 'px' } }, g);
    } });
  const rowOf = (o) => h('div.cc-row' + (o.cls ? '.' + o.cls : ''), Object.assign({ 'data-tone': o.tone || null, role: o.btn ? 'button' : null, 'aria-disabled': o.disabled ? 'true' : null, 'data-edge': o.edge ? '' : null, style: { width: '380px' } }),
    o.nolf ? null : h('span.lf', null, h('span.cc-tile.sm', null, sk(o.ic || 'smith'))), h('span.ti', null, o.t || 'Mithril Bar', h('i', null, '×176')), h('span.su', null, o.s || 'Smithing · Dustclaw Foundry'),
    h('span.mt', null, h('b', null, o.m || '27 min'), h('span', null, '5,705 XP')), o.prog ? h('span.pr', null, h('span.cc-prog.thin', { style: { '--p': '40%' } }, h('i'))) : null);
  add({ id: 'cmp-row', cat: 'Cards and rows', title: 'Card row (.cc-row)', desc: 'The one list item: lane colour, left tile, title and sub line, right-hand meta, optional bar. Fixed 44 px; never grows. The queue’s own card (cc-q-row) is a larger sibling.', keywords: 'cc-row list item card row lane edge locked advisor highlight',
    covers: ['row', 'row.lead', 'row.title', 'row.subtitle', 'row.meta', 'row.bar', 'row.action-button', 'list'],
    variants: [{ label: 'Lane tones' }, { label: 'States' }],
    render: (ctx, v) => /Lane/.test(v.label) ? col(['good', 'info', 'warn', 'bad', 'magic', 'accent'].map((t) => rowOf({ tone: t, btn: true, ic: t === 'bad' ? 'strike' : 'smith' })).concat([rowOf({ cls: 'flat', prog: true }), rowOf({ nolf: true, cls: 'nolf', tone: 'good' })]))
      : col([rowOf({ tone: 'good', btn: true }), rowOf({ tone: 'good', cls: 'is-hl', btn: true, t: 'Advisor highlight' }), rowOf({ tone: 'info', edge: true, t: 'Special edge' }), rowOf({ tone: 'good', cls: 'locked', s: 'Lv 40 needed', t: 'Locked' }), rowOf({ tone: 'good', disabled: true, t: 'Disabled' }), rowOf({ tone: 'good', cls: 'hov', t: 'Hover look on a div' })]) });
  add({ id: 'cmp-chat-msgs', cat: 'Cards and rows', title: 'Chat messages and composer', desc: '.cc-msg lines with channel tag, name, repeat count, highlight; the composer under them.', keywords: 'cc-msg cc-composer cc-msgs chat',
    covers: ['chat-message', 'composer', 'message-list'],
    render: (ctx) => h('div', { style: { width: '400px', background: 'var(--cc-bg)', border: '1px solid var(--cc-border)', borderRadius: '12px', color: 'var(--cc-text)', fontFamily: 'var(--cc-font)' } },
      h('div.cc-msgs', null, ctx.M.msgs.map((m, i) => h('div.cc-msg', { 'data-hl': i === 1 ? '' : null }, h('span.t', null, m[0]), h('span', null, h('span.tag', { 'data-tone': m[1] === 'Clan' ? 'magic' : m[1] === 'Friends' ? 'good' : 'dim', style: { color: 'var(--t)' } }, '[' + m[1] + ']'), h('span.who', null, m[2]), ': ' + m[3], i === 3 ? h('span.x3', null, '×3') : null)))),
      h('div.cc-composer', null, h('button.cc-chip', { 'data-tone': 'magic' }, '[Clan]'), h('input.cc-in', { placeholder: 'Say something' }), h('span.cnt', null, '34'))) });

  // ---------------------------------------------------------------- Menus
  const menuItems = (ctx) => [{ head: 'Info bar' }, { label: 'Show clock', checked: true, hint: 'Ctrl L' }, { label: 'Show hit points', checked: false }, { label: 'Partly shown', checked: 'mixed' },
    { label: 'Alerts', badge: ctx.M.alerts.length || 3 }, { sep: true }, { label: 'Add module', sub: [{ head: 'Modules' }, { label: 'XP per hour' }, { label: 'Gold' }, { label: 'Location' }] }, { label: 'Bar height', sub: [{ label: 'Small' }, { label: 'Medium', checked: true }, { label: 'Large' }] },
    { chips: [{ label: 'Top', on: true }, { label: 'Bottom' }] }, { slider: { label: 'Opacity', min: 20, max: 100, value: 85, fmt: (v) => v + '%' } }, { sep: true }, { label: 'Not available', disabled: true }, { label: 'Remove this module', danger: true }];
  add({ id: 'menu-context', cat: 'Menus', title: 'Menu (context / dropdown)', desc: 'Built by the real UI.menu(): heading, check, mixed dash, hint, count badge, submenu (hover opens it), chips row, slider, separator, disabled, danger.', keywords: 'cc-menu cc-mi cc-mh cc-msep cc-mslider UI.menu context right-click dropdown submenu',
    covers: ['menu', 'menu.heading', 'menu.item', 'menu.item.check', 'menu.item.hint', 'menu.submenu', 'menu.separator', 'menu.slider-row'],
    render: (ctx) => realMenu(menuItems(ctx)) });
  add({ id: 'menu-align', cat: 'Menus', title: 'Menu with alignment grid', desc: 'The 3x3 anchor picker used by bar and panel menus.', keywords: 'cc-align alignment grid anchor',
    covers: ['menu', 'menu.align-grid'],
    render: () => realMenu([{ head: 'Anchor' }, { align: () => {} }, { sep: true }, { label: 'Lock position', checked: true }]) });

  // ---------------------------------------------------------------- Tooltips and popovers
  add({ id: 'tip-basic', cat: 'Tooltips and popovers', title: 'Tooltip (.cc-tip)', desc: 'One shared tooltip that follows the pointer; title, text, key-value lines, progress bar. Max 280 px. Never blocks the pointer.', keywords: 'cc-tip tooltip hover follows pointer',
    covers: ['tooltip'],
    variants: [{ label: 'Text only' }, { label: 'With key-value + bar' }],
    render: (ctx, v) => /Text/.test(v.label) ? h('div.cc-tip.on', null, h('b', null, 'Quest step'), 'Ridgetop Ore: mine 20 Tin Ore at Windhollow Vein. Rewards 1,200 Mine XP.')
      : h('div.cc-tip.on', null, h('b', null, 'Mine 71'), 'Next level in 11 min.', h('dl.cc-kv', null, h('dt', null, 'XP / hr'), h('dd', null, '14,280'), h('dt', null, 'To next'), h('dd', { 'data-tone': 'good' }, '3,011'), h('dt', null, 'Queued'), h('dd', null, '+2,574')), h('span.cc-prog', { style: { '--p': '62%' } }, h('i'))) });
  add({ id: 'pop-basic', cat: 'Tooltips and popovers', title: 'Popover (.cc-pop)', desc: 'Detail of one thing (an option, a row): title, sub line, key-values. 214 px.', keywords: 'cc-pop popover detail',
    covers: ['popover'],
    render: () => h('div.cc-pop', { style: { width: '214px' } }, h('b', null, 'Push Ups'), h('em', null, 'Vigor · Ruincamp Pit'), h('dl.cc-kv', { style: { marginTop: '6px' } }, h('dt', null, 'Time'), h('dd', null, '11 min'), h('dt', null, 'XP'), h('dd', null, '2,626'), h('dt', null, 'Walk'), h('dd', { 'data-tone': 'warn' }, '5 min'))) });

  // ---------------------------------------------------------------- Toasts
  add({ id: 'toast-tones', cat: 'Toasts and alerts', title: 'Toast (UI.toast)', desc: 'A short notice above the bottom bar, one at a time. Built by the real UI.toast(). Each tone has its own glyph.', keywords: 'cc-toast notification UI.toast',
    covers: ['toast'],
    render: () => col([['good', 'Layout saved'], ['info', 'Panel scale set to 90%'], ['warn', 'The game has no Reroll control right now.'], ['bad', 'Could not read the game data'], ['accent', 'New: Lever Advisor']].map(([t, m], i) => realToast(m, { tone: t, action: i === 2 ? { label: 'Open Tasks', onClick() {} } : null }))) });

  // ---------------------------------------------------------------- Trays
  add({ id: 'tray-generic', cat: 'Trays', title: 'Tray (.cc-tray)', desc: 'Generic out-of-panel option tiles. The queue keeps its own tray (cc-q-tray, hover a tile in the Queue Panel to see the real one).', keywords: 'cc-tray option tiles alternatives',
    covers: ['tray'],
    render: () => h('div.cc-tray.is-on', { style: { position: 'relative' } }, [['mine', ''], ['forage', 'lucky'], ['fish', 'quest']].map(([s, e], i) => h('span.cc-tile.cc-q-tile', { 'data-k': 'skill', 'data-e': e || null, style: i === 0 ? { outline: '2px solid var(--cc-accent)' } : null }, sk(s)))) });

  // ---------------------------------------------------------------- Modals
  add({ id: 'modal-basic', cat: 'Modals', title: 'Modal (.cc-modal over .cc-scrim)', desc: 'Centered dialog: title, text, footer with step dots and buttons. Pointer-blocking scrim behind it.', keywords: 'cc-modal cc-scrim dialog dots tour',
    covers: ['modal', 'scrim'],
    variants: [{ label: 'Modal on scrim', box: [460, 250] }],
    render: () => h('div', { style: { position: 'absolute', inset: 0, background: 'var(--cc-scrim)' } }, h('div.cc-modal', { style: { position: 'absolute !important', left: '50% !important', top: '50% !important', transform: 'translate(-50%,-50%) !important', width: '380px' } },
      h('h3', null, 'Info bars'), h('p', null, 'Run along the top of the screen. Add modules such as your task, gold or a clock.'), h('div.ft', null, h('span.cc-dots', null, h('i.on'), h('i'), h('i')), h('button.cc-btn', { 'data-v': 'quiet' }, 'Skip'), h('button.cc-btn', { 'data-v': 'primary' }, 'Next')))) });

  // ---------------------------------------------------------------- States and variants
  add({ id: 'state-tones', cat: 'States and variants', title: 'Tone matrix', desc: 'data-tone on a component (or any ancestor) sets --t plus two mixes. Same attribute, every component.', keywords: 'data-tone good warn bad info magic accent kill dim colour meaning',
    covers: ['tone.good', 'tone.warn', 'tone.bad', 'tone.info', 'tone.magic', 'tone.accent', 'tone.kill', 'tone.dim'],
    render: () => h('table.cc-table', { style: { width: '640px' } }, h('thead', null, h('tr', null, h('th', null, 'tone'), h('th', null, 'chip'), h('th', null, 'pill'), h('th', null, 'callout'), h('th', null, 'progress'), h('th', null, 'row'))),
      h('tbody', null, tones.map((t) => h('tr', null, h('td', null, t), h('td', null, h('span.cc-chip', { 'data-tone': t }, 'Chip')), h('td', null, h('span.cc-pill', { 'data-tone': t === 'kill' || t === 'info' ? 'bad' : t }, 'Pill')), h('td', null, h('span.cc-callout', { 'data-tone': t, style: { padding: '3px 8px' } }, h('span', null, 'Msg'))),
        h('td', null, h('span.cc-prog', { 'data-tone': t, style: { '--p': '60%', width: '80px' } }, h('i'))), h('td', null, h('span.cc-row.flat', { 'data-tone': t, style: { minHeight: '22px', padding: '2px 8px', display: 'inline-flex' } }, 'row')))))) });
  add({ id: 'state-interactive', cat: 'States and variants', title: 'Interactive states', desc: 'Default, selected (accent), off (dashed), disabled, locked, attention dot, highlight. Hover/pressed/focus are live: point at, click and Tab to them.', keywords: 'hover pressed selected disabled focus locked attention highlight',
    covers: ['selected', 'disabled', 'locked', 'highlighted', 'attention', 'hover', 'pressed', 'focus'],
    render: () => h('table.cc-table', { style: { width: '640px' } }, h('thead', null, h('tr', null, ['State', 'Chip', 'Button', 'Seg', 'Module'].map((x) => h('th', null, x)))),
      h('tbody', null, [['default', {}], ['selected', { pressed: true }], ['off', { off: true }], ['disabled', { dis: true }]].map(([n, o]) => h('tr', null, h('td', null, n),
        h('td', null, h('button.cc-chip' + (o.pressed ? '.on' : '') + (o.off ? '.off' : ''), { 'aria-pressed': o.pressed ? 'true' : null, disabled: o.dis }, 'Chip')),
        h('td', null, h('button.cc-btn', { 'data-v': o.pressed ? 'primary' : null, disabled: o.dis }, 'Button')),
        h('td', null, h('div.cc-seg', null, h('button', { 'aria-pressed': o.pressed ? 'true' : null, disabled: o.dis }, 'One'), h('button', null, 'Two'))),
        h('td', null, h('span.cc-mod.btn' + (o.pressed ? '.active' : '') + (n === 'default' ? '.attn' : ''), { 'aria-pressed': o.pressed ? 'true' : null, style: o.dis ? { opacity: '.45' } : null }, h('span.tx', null, 'Tasks'))))))) });
  add({ id: 'state-width-classes', cat: 'States and variants', title: 'Width classes: full / compact / micro', desc: 'A scaled root (.cc-s) gets data-bp from its own width. .cc-hide-c hides in compact and micro, .cc-hide-m hides in micro, .cc-only-m shows in micro only.', keywords: 'data-bp cc-s cc-hide-c cc-hide-m cc-only-m responsive breakpoint',
    covers: ['width-class.full', 'width-class.compact', 'width-class.micro'],
    variants: [{ label: 'full (>= 340 px)', w: 400 }, { label: 'compact (180-339 px)', w: 260 }, { label: 'micro (< 180 px)', w: 150 }],
    render: (ctx, v) => { const p = shell({ title: 'Task queue', sub: 'subtitle shows in full only', val: '2.1 h', w: v.w }, [h('div.cc-row.flat', { 'data-tone': 'good' }, h('span.lf', null, h('span.cc-tile.sm', null, sk('mine'))), h('span.ti', null, 'Tin Ore'), h('span.su.cc-hide-c', null, 'Mine · Windhollow Vein (hidden in compact)'), h('span.mt', null, h('b', null, '16 min'), h('span.cc-hide-m', null, '2,574 XP'))), h('span.cc-only-m', null, 'micro only')]); return p; } });
})();
