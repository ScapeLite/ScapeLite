// Design Lab: icon gallery. Every game icon the overlay can use (public/assets/icons: skills, ui, items), plus the glyphs and marker icons ScapeLite draws itself.
(function () {
  'use strict';
  const { h } = window.Lab;
  let index = null;
  const GLYPHS = [
    ['⚙', 'cogwheel (panel settings)'], ['–', 'collapse'], ['+', 'expand'], ['×', 'close / dismiss'], ['›', 'fold drawer / submenu'], ['‹', 'back (settings sheet)'],
    ['✓', 'check / chosen / good'], ['★', 'star: advisor pick'], ['⚡', 'bolt: fastest XP / possible gain'], ['▲', 'up marker (level up available)'], ['⚠', 'warning'],
    ['🔔', 'bell (alerts)'], ['🚶', 'walking pill'], ['🔗', 'fuse link'], ['🔒', 'lock'], ['↻', 'refresh / reroll'], ['→', 'arrow in ring tag'],
  ];
  const MARKS = [['skills', 'luck', 'lucky (clover)'], ['ui', 'quest', 'quest step (parchment)'], ['ui', 'diary', 'diary step (blue book)'], ['items', 'stable_crystal', 'teleport crystal']];
  window.Lab.views['Icon gallery'] = async (c) => {
    const q = document.getElementById('lab-q').value.trim();
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Icon gallery'), h('span', { id: 'lab-ico-count' }, 'loading ...')));
    c.appendChild(h('p.lab-lead', null, 'Click an icon to copy its path. Game icons are 30 px and drawn pixelated (image-rendering: pixelated). Search filters by file name.'));
    if (!index) { try { index = await (await fetch('api/icons')).json(); } catch (e) { index = {}; } }
    if (!Object.keys(index).length) { c.appendChild(h('div.lab-empty', null, 'The icon list comes from the lab server (npm run design-lab). Open the lab through it to see the icons.')); }
    const sec = (title, node) => { c.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, title))); c.appendChild(node); };
    const marks = h('div.lab-ico-grid');
    MARKS.forEach(([g, n, label]) => marks.appendChild(h('div.lab-ico', { onclick() { window.Lab.copy('/assets/icons/' + g + '/' + n + '.png'); } }, window.Lab.ico(g, n), h('span', null, label))));
    marks.appendChild(h('div.lab-ico', null, h('span.cc-tile.cc-q-tile', { 'data-p': 'xp', style: { '--cc-tile': '30px' } }), h('span', null, 'badge: fastest XP')));
    marks.appendChild(h('div.lab-ico', null, h('span.cc-tile', { 'data-p': 'adv', style: { '--cc-tile': '30px' } }), h('span', null, 'badge: advisor')));
    sec('Category and badge markers (queue tiles)', marks);
    const gl = h('div.lab-ico-grid');
    GLYPHS.forEach(([g, label]) => gl.appendChild(h('div.lab-ico', { onclick() { window.Lab.copy(g); } }, h('span', { style: { fontSize: '22px', color: 'var(--lab-text)' } }, g), h('span', null, label))));
    sec('Glyphs ScapeLite draws as text (no image file)', gl);
    let total = 0, shown = 0;
    Object.keys(index).forEach((g) => {
      const all = index[g], list = all.filter((n) => window.Lab.match(q, (g + ' ' + n).toLowerCase())); total += all.length; shown += list.length;
      if (!list.length) return;
      const grid = h('div.lab-ico-grid'); const cap = g === 'items' ? 400 : 1000;
      list.slice(0, cap).forEach((n) => grid.appendChild(h('div.lab-ico', { title: g + '/' + n + '.png', onclick() { window.Lab.copy('/assets/icons/' + g + '/' + n + '.png'); } }, h('img', { src: window.Lab.iconBase + '/' + g + '/' + n + '.png', loading: 'lazy', alt: n }), h('span', null, n))));
      sec(g + ' (' + list.length + (list.length > cap ? ', first ' + cap + ' shown: narrow the search' : '') + ')', grid);
    });
    const cnt = document.getElementById('lab-ico-count'); if (cnt) cnt.textContent = shown + ' of ' + total + ' game icons';
  };
})();
