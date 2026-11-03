// ScapeLite Design Lab core: registry of named UI elements (names.json, see docs/UI-NAMING.md), specimen rendering, search, scenario simulator, inspector.
// Specimens are small functions in spec-*.js that build DOM with ScapeLite's REAL classes; the CSS is the real production CSS (harvest-frame.js).
(function () {
  'use strict';
  const CATS = ['Scenes', 'Panels', 'Windows', 'Drawers', 'Bars', 'Cards and rows', 'Menus', 'Tooltips and popovers', 'Trays', 'Modals', 'Toasts and alerts', 'Docks and handles', 'Overlays', 'Widgets', 'Components', 'States and variants'];
  const LEAD = {
    'Scenes': 'Whole game screens at a chosen window size, composed of the surfaces below. Change the scenario on the right and every surface follows.',
    'Panels': 'Kept floating panels (class cc-panel): header, body, footer, hover and collapsed forms.',
    'Windows': 'The game’s own big windows ScapeLite hooks into, and ScapeLite’s drawn imitations of their relevant parts.',
    'Drawers': 'Surfaces that slide out of the edge of a window or panel.',
    'Bars': 'Info bars, HP bar, menu strips and other bars that are not progress bars.',
    'Cards and rows': 'The fixed-height list card (.cc-row), grid cells, hover cards and queue cards.',
    'Menus': 'Context and dropdown menus, built with the real UI.menu().',
    'Tooltips and popovers': 'Hover tooltips and small detail popovers.',
    'Trays': 'Option trays that slide out beside a card.',
    'Modals': 'Centered dialogs over a scrim.',
    'Toasts and alerts': 'Notifications, the alert bell and its list, outlines pointing at game buttons.',
    'Docks and handles': 'Move handles, resize grips, fuse links, window-control docks.',
    'Overlays': 'Things drawn onto the game’s own screens.',
    'Widgets': 'Small single floating things.',
    'Components': 'Buttons, chips, pills, badges, tiles, bars, inputs, tables: the parts panels are made of.',
    'States and variants': 'Hover, pressed, selected, disabled, tones, sizes, width classes side by side.',
  };
  const DEF = { mode: 'idle', queue: 'full', hp: 'high', alert: 'none', win: '1280x720', zoom: 100, palette: 'default', accent: '', density: 'cozy', fontPx: 0, still: false, bg: 'dark', side: true };
  let S = Object.assign({}, DEF);
  try { Object.assign(S, JSON.parse(localStorage.getItem('lab-state') || '{}')); } catch (e) { /* first visit */ }

  const Lab = window.Lab = {
    CATS, S, specs: [], names: new Map(), nameList: [], LEAD, DEF,
    iconBase: (location.protocol === 'file:' ? '../public' : '') + '/assets/icons',
  };

  // ---------------------------------------------------------------- tiny DOM builder: h('div.cc-row.is-hl', {'data-tone':'good', onclick}, child, [children], 'text')
  function h(sel, attrs, ...kids) {
    const m = /^([a-z0-9]*)((?:[.#][\w-]+)*)$/i.exec(sel || 'div') || [0, 'div', ''];
    const e = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => { if (t[0] === '.') e.classList.add(t.slice(1)); else e.id = t.slice(1); });
    if (attrs && (attrs.nodeType || typeof attrs === 'string' || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) for (const k in attrs) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach((p) => (p.startsWith('--') ? e.style.setProperty(p, v[p]) : (e.style[p] = v[p])));
      else if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    (function add(list) { list.forEach((c) => { if (c == null || c === false) return; if (Array.isArray(c)) add(c); else e.appendChild(c.nodeType ? c : document.createTextNode(String(c))); }); })(kids);
    return e;
  }
  Lab.h = h;
  Lab.ico = (group, name, cls) => h('img.cc-ico' + (cls ? '.' + cls : ''), { src: Lab.iconBase + '/' + group + '/' + name + '.png', alt: '', draggable: 'false', onerror() { this.style.visibility = 'hidden'; } });
  Lab.skill = (n) => Lab.ico('skills', n);
  Lab.item = (n) => Lab.ico('items', n);
  Lab.num = (n) => Math.round(n).toLocaleString('en-US');
  Lab.dur = (sec) => { const s = Math.round(sec); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m < 60 ? m + ' min' : (m / 60).toFixed(1) + ' h'; };
  Lab.pretty = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

  // ---------------------------------------------------------------- registry (docs/UI-NAMING.md is generated from the same list)
  Lab.loadNames = async function () {
    try {
      const r = await fetch('names.json', { cache: 'no-store' }); const list = await r.json();
      Lab.nameList = Array.isArray(list) ? list : [];
    } catch (e) { Lab.nameList = []; }
    Lab.names = new Map(Lab.nameList.map((n) => [n.id, n]));
  };
  Lab.name = (id) => Lab.names.get(id) || null;
  Lab.add = (spec) => { spec.variants = spec.variants && spec.variants.length ? spec.variants : [{}]; spec.covers = spec.covers || []; Lab.specs.push(spec); return spec; };
  Lab.specTitle = (sp) => sp.title || (Lab.name(sp.covers[0]) || {}).name || sp.id;
  Lab.specPath = (sp) => (Lab.name(sp.covers[0]) || {}).path || '';

  // ---------------------------------------------------------------- state / scenario
  const SCENARIOS = {
    'Fresh start': { mode: 'idle', queue: 'few', hp: 'high', alert: 'none' },
    'Busy skilling': { mode: 'idle', queue: 'full', hp: 'high', alert: 'one' },
    'Combat, low HP': { mode: 'combat', queue: 'full', hp: 'low', alert: 'none' },
    'Fortress run': { mode: 'fortress', queue: 'few', hp: 'high', alert: 'none' },
    'Raid night': { mode: 'dungeon', queue: 'empty', hp: 'high', alert: 'firing' },
    'Everything wrong': { mode: 'combat', queue: 'overfull', hp: 'critical', alert: 'firing' },
  };
  Lab.SCENARIOS = SCENARIOS;
  const listeners = [];
  Lab.onChange = (fn) => listeners.push(fn);
  Lab.set = function (patch) {
    Object.assign(S, patch);
    try { localStorage.setItem('lab-state', JSON.stringify(S)); } catch (e) { /* storage blocked */ }
    applyScenario(); listeners.forEach((f) => { try { f(patch); } catch (e) { console.error(e); } });
  };
  Lab.M = () => window.LabMock.build(S);
  Lab.winSize = () => { const m = /^(\d+)x(\d+)$/.exec(S.win) || [0, 1280, 720]; return { w: +m[1], h: +m[2] }; };
  function applyScenario() {
    const V = window.__labSettings;
    V.uiPalette = S.palette; V.uiDensity = S.density; V.uiAccent = S.accent || ''; V.uiFontPx = S.fontPx || 0;
    try { window.__ccUI.applyTheme(); } catch (e) { /* kit not loaded yet */ }
    document.documentElement.style.setProperty('--lab-zoom', String(S.zoom / 100));
    document.body.dataset.labBg = S.bg;
    document.body.classList.toggle('lab-noside', !S.side);
    let st = document.getElementById('lab-still');
    if (S.still) { if (!st) { st = h('style#lab-still'); st.textContent = '.lab-subject *,.lab-subject{animation:none !important;transition:none !important}'; document.head.appendChild(st); } } else if (st) st.remove();
    const b = document.getElementById('lab-side-toggle'); if (b) b.setAttribute('aria-pressed', String(!!S.side));
  }
  Lab.applyScenario = applyScenario;

  // ---------------------------------------------------------------- search
  const hay = (sp) => {
    if (sp._hay) return sp._hay;
    const bits = [sp.id, sp.title, sp.cat, sp.keywords, sp.desc];
    sp.covers.forEach((id) => { const n = Lab.name(id); bits.push(id); if (n) bits.push(n.name, n.path, n.selector, n.file, n.desc, (n.aliases || []).join(' '), n.category); });
    return (sp._hay = bits.filter(Boolean).join(' ').toLowerCase());
  };
  Lab.match = (q, text) => { const t = q.toLowerCase().split(/\s+/).filter(Boolean); return t.every((w) => text.includes(w)); };
  Lab.searchSpecs = (q) => Lab.specs.filter((sp) => Lab.match(q, hay(sp)));
  Lab.searchNames = (q) => Lab.nameList.filter((n) => Lab.match(q, [n.id, n.name, n.path, n.selector, n.file, n.desc, n.category, (n.aliases || []).join(' '), n.clash].filter(Boolean).join(' ').toLowerCase()));

  // ---------------------------------------------------------------- specimen cards
  const copy = (txt, node) => { try { navigator.clipboard.writeText(txt); } catch (e) { /* no clipboard */ } if (node) { const o = node.textContent; node.textContent = 'copied'; setTimeout(() => { node.textContent = o; }, 700); } };
  Lab.copy = copy;
  let io = null;
  // a fresh render context; Lab.build(id) renders another specimen's first (or nth) variant, so scenes can compose real specimens
  Lab.ctx = (v) => ({ S, M: Lab.M(), v: v || {}, h, Lab, UI: window.__ccUI, ico: Lab.ico, skill: Lab.skill, item: Lab.item, watch: (el) => { try { window.__ccUI.ccWatch(el); } catch (e) { /* kit missing */ } return el; } });
  Lab.build = (id, n) => { const sp = Lab.specs.find((x) => x.id === id); if (!sp) return h('div', { style: { color: '#ff8a5c' } }, 'no specimen ' + id); const v = sp.variants[n || 0]; const out = sp.render(Lab.ctx(v), v); const a = Array.isArray(out) ? out : [out]; if (a.length === 1 && a[0] && a[0].nodeType) return a[0]; return h('div', null, a); };
  function renderInto(card, sp) {
    const body = card.querySelector('.lab-body'); body.replaceChildren();
    const M = Lab.M();
    sp.variants.forEach((v) => {
      const subject = h('div.lab-subject');
      if (v.w) subject.style.width = v.w + 'px';
      if (v.box) { subject.classList.add('lab-box'); subject.style.width = (v.box[0]) + 'px'; subject.style.height = (v.box[1]) + 'px'; }
      try {
        const ctx = Object.assign(Lab.ctx(v), { M });
        const out = sp.render(ctx, v);
        (Array.isArray(out) ? out : [out]).forEach((n) => n && subject.appendChild(n.nodeType ? n : document.createTextNode(String(n))));
      } catch (e) { console.error('specimen ' + sp.id, e); subject.appendChild(h('div', { style: { color: '#ff8a5c', font: '12px monospace' } }, 'Specimen failed: ' + e.message)); }
      const cap = v.label || v.id ? h('figcaption', null, v.label ? h('b', null, v.label) : null, v.id ? h('code', null, v.id) : null) : null;
      body.appendChild(h('figure.lab-variant', null, cap, subject));
    });
    sp._rendered = true;
  }
  Lab.renderAll = () => { document.querySelectorAll('.lab-spec').forEach((c) => { if (!c._spec._rendered) renderInto(c, c._spec); }); const bad = [...document.querySelectorAll('.lab-subject')].filter((x) => /Specimen failed/.test(x.textContent)).map((x) => x.closest('.lab-spec').dataset.spec + ': ' + x.textContent); return bad; };   // test hook: render everything now, list failures
  function card(sp) {
    const title = Lab.specTitle(sp), path = Lab.specPath(sp);
    const a = h('article.lab-spec', { id: 'spec-' + sp.id, 'data-spec': sp.id },
      h('header', null, h('h3', null, title), path ? h('span.lab-path', null, path) : null, h('span.lab-id', null, sp.id), sp.desc ? h('p.lab-desc', null, sp.desc) : null),
      h('div.lab-body'),
      sp.covers.length ? h('footer', null, 'Names:', sp.covers.map((id) => {
        const n = Lab.name(id), t = h('span.lab-tag', { title: n ? (n.desc || '') + (n.selector ? '\n' + n.selector : '') + (n.file ? '\n' + n.file : '') : 'not in names.json', onclick() { copy(n ? n.path : id, t); } }, n ? n.path : id, h('code', null, n ? n.id : '?'));
        if (!n) t.style.borderStyle = 'dashed';
        return t;
      })) : null);
    a._spec = sp;
    return a;
  }
  Lab.cardFor = card;
  function mount(list, parent) {
    if (!io) io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const c = e.target; if (!c._spec._rendered || c._dirty) { c._dirty = false; renderInto(c, c._spec); } } }), { root: document.getElementById('lab-content'), rootMargin: '700px 0px' });
    list.forEach((sp) => { const c = card(sp); parent.appendChild(c); sp._card = c; sp._rendered = false; io.observe(c); });
  }
  // re-render only what is already on screen; the rest renders when it scrolls in
  Lab.onChange(() => document.querySelectorAll('.lab-spec').forEach((c) => { if (c._spec._rendered) renderInto(c, c._spec); }));

  // ---------------------------------------------------------------- views
  Lab.views = {};   // name -> function(container)
  Lab.searchViews = { 'Design tokens': true, 'Icon gallery': true, 'Naming registry': false };   // views that filter themselves by the search box
  const $ = (id) => document.getElementById(id);
  let route = 'Scenes';
  function nav() {
    const n = $('lab-nav'); n.replaceChildren();
    const link = (label, r, count) => h('a', { class: route === r ? 'on' : '', onclick() { go(r); } }, h('span', null, label), count != null ? h('small', null, count) : null);
    n.appendChild(h('h6', null, 'Surfaces'));
    CATS.forEach((c) => n.appendChild(link(c, c, Lab.specs.filter((s) => s.cat === c).length)));
    n.appendChild(h('h6', null, 'Reference'));
    n.appendChild(link('Design tokens', 'Design tokens'));
    n.appendChild(link('Icon gallery', 'Icon gallery'));
    n.appendChild(link('Naming registry', 'Naming registry', Lab.nameList.length));
    n.appendChild(link('Coverage', 'Coverage'));
    n.appendChild(h('h6', null, 'All'));
    n.appendChild(link('Everything', 'All', Lab.specs.length));
  }
  function go(r) { route = r; try { history.replaceState(null, '', '#/' + encodeURIComponent(r)); } catch (e) { /* file: */ } draw(); }
  Lab.go = go;
  function draw() {
    const c = $('lab-content'); const q = $('lab-q').value.trim(); c.replaceChildren(); if (io) io.disconnect();
    nav();
    if (q && !Lab.searchViews[route]) return drawSearch(c, q);
    if (Lab.views[route]) { Lab.views[route](c); c.scrollTop = 0; return; }
    const cats = route === 'All' ? CATS : [route];
    cats.forEach((cat) => {
      const list = Lab.specs.filter((s) => s.cat === cat); if (!list.length) return;
      c.appendChild(h('div.lab-cat', null, h('h2', null, cat), h('span', null, list.length + ' specimens')));
      if (LEAD[cat]) c.appendChild(h('p.lab-lead', null, LEAD[cat]));
      const g = h('div.lab-grid'); c.appendChild(g); mount(list, g);
    });
    if (!c.children.length) c.appendChild(h('div.lab-empty', null, 'Nothing here yet.'));
    c.scrollTop = 0;
  }
  function drawSearch(c, q) {
    const specs = Lab.searchSpecs(q), names = Lab.searchNames(q);
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Search: ' + q), h('span', null, specs.length + ' specimens, ' + names.length + ' registered names')));
    if (specs.length) { const g = h('div.lab-grid'); c.appendChild(g); mount(specs, g); }
    const covered = new Set(); Lab.specs.forEach((s) => s.covers.forEach((i) => covered.add(i)));
    const rest = names.filter((n) => !covered.has(n.id));
    if (rest.length) {
      c.appendChild(h('div.lab-cat', null, h('h2', null, 'Named, no specimen yet'), h('span', null, rest.length)));
      c.appendChild(namesTable(rest));
    }
    let toks = []; try { toks = Lab.tokenIndex().filter((t) => Lab.match(q, (t.name + ' ' + t.value + ' ' + t.src).toLowerCase())); } catch (e) { toks = []; }
    if (toks.length) {
      c.appendChild(h('div.lab-cat', null, h('h2', null, 'Design tokens'), h('span', null, toks.length + ' matching custom properties'), h('button.lab-btn.sm', { onclick() { Lab.go('Design tokens'); } }, 'edit in token sheet')));
      c.appendChild(h('table.lab-tok', null, toks.slice(0, 40).map((t) => h('tr', null, h('td', null, h('code', null, t.name)), h('td', null, h('code', null, t.value)), h('td', null, h('code', null, t.selector)), h('td', null, h('code', null, t.src))))));
    }
    if (!specs.length && !names.length && !toks.length) c.appendChild(h('div.lab-empty', null, 'No match. Try a class name (cc-row), a file (ui-queue.js), or a word (tray).'));
  }
  function namesTable(list) {
    const t = h('table.lab-tok', null, h('thead', null, h('tr', null, ['Path', 'Id', 'Kind', 'Selector', 'File', 'Code alias / clash'].map((x) => h('th', null, x)))));
    const tb = h('tbody'); t.appendChild(tb);
    list.forEach((n) => tb.appendChild(h('tr', null, h('td', null, h('b', null, n.path || n.name)), h('td', null, h('code', { style: { cursor: 'pointer' }, onclick() { copy(n.id); } }, n.id)), h('td', null, n.kind || ''), h('td', null, h('code', null, n.selector || '')), h('td', null, h('code', null, n.file || '')), h('td', null, (n.aliases || []).join(', ') + (n.clash ? ' | ' + n.clash : '')))));
    return t;
  }
  Lab.namesTable = namesTable;
  Lab.views['Naming registry'] = (c) => {
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Naming registry'), h('span', null, Lab.nameList.length + ' names, from names.json / docs/UI-NAMING.md')));
    const by = {}; Lab.nameList.forEach((n) => (by[n.category] = by[n.category] || []).push(n));
    Object.keys(by).forEach((k) => { c.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, k), h('span', null, by[k].length))); c.appendChild(namesTable(by[k])); });
  };
  Lab.views['Coverage'] = (c) => {
    const covered = new Map(); Lab.specs.forEach((s) => s.covers.forEach((i) => { (covered.get(i) || covered.set(i, []).get(i)).push(s.id); }));
    // a token that the Design tokens page lists (every --custom-property in the real stylesheets, with swatch and live value) is shown there
    const onTokens = new Set((Lab.tokenIndex ? Lab.tokenIndex() : []).map((t) => t.name || t));
    const missing = Lab.nameList.filter((n) => !covered.has(n.id) && !(n.kind === 'token' && /^--/.test(n.selector || '') && onTokens.has(n.selector))), unknown = [...covered.keys()].filter((i) => !Lab.names.has(i));
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Coverage'), h('span', null, (Lab.nameList.length - missing.length) + ' of ' + Lab.nameList.length + ' registered names have a specimen; ' + Lab.specs.length + ' specimens')));
    c.appendChild(h('p.lab-lead', null, 'To add a specimen for a name below, see docs/DESIGN-LAB.md. Names that are only the game’s own DOM (no ScapeLite code) are expected to stay listed.'));
    if (unknown.length) { c.appendChild(h('p.lab-lead', { style: { color: '#ffb84a' } }, 'Specimens reference ids missing from names.json: ' + unknown.join(', '))); }
    const by = {}; missing.forEach((n) => (by[n.category] = by[n.category] || []).push(n));
    Object.keys(by).forEach((k) => { c.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, k), h('span', null, by[k].length + ' without specimen'))); c.appendChild(namesTable(by[k])); });
  };

  // ---------------------------------------------------------------- scenario side panel
  function side() {
    const el = $('lab-side'); el.replaceChildren();
    const opts = (key, list, label) => h('div.lab-opts', null, list.map((o) => { const [val, text] = Array.isArray(o) ? o : [o, o]; return h('button', { 'aria-pressed': String(S[key] === val), onclick() { Lab.set({ [key]: val }); side(); } }, text); }));
    el.append(
      h('h5', null, 'Quick scenarios'), h('div.lab-opts', null, Object.keys(SCENARIOS).map((k) => h('button', { onclick() { Lab.set(SCENARIOS[k]); side(); } }, k))),
      h('h5', null, 'Activity'), opts('mode', [['idle', 'Idle / skilling'], ['combat', 'In combat'], ['fortress', 'Fortress run'], ['dungeon', 'Dungeon / raid party']]),
      h('h5', null, 'Task queue'), opts('queue', [['empty', 'Empty'], ['few', '3 tasks'], ['full', '8 tasks'], ['overfull', '14 tasks']]),
      h('h5', null, 'Hit points'), opts('hp', [['high', 'Healthy'], ['low', 'Low'], ['critical', 'Critical']]),
      h('h5', null, 'Alerts'), opts('alert', [['none', 'None'], ['one', 'One'], ['firing', 'Firing']]),
      h('h5', null, 'Game window (Scenes)'), opts('win', [['1920x1080', '1920x1080'], ['1600x900', '1600x900'], ['1280x720', '1280x720'], ['1024x640', '1024x640'], ['800x600', '800x600']]),
      h('h5', null, 'Look'),
      h('div.lab-opts', null, [['default', 'ScapeLite'], ['game', 'Match game'], ['colourblind', 'Colour-blind']].map(([v, t]) => h('button', { 'aria-pressed': String(S.palette === v), onclick() { Lab.set({ palette: v }); side(); } }, t))),
      h('div.lab-opts', { style: { marginTop: '4px' } }, [['compact', 'Compact'], ['cozy', 'Cozy'], ['roomy', 'Roomy']].map(([v, t]) => h('button', { 'aria-pressed': String(S.density === v), onclick() { Lab.set({ density: v }); side(); } }, t))),
      h('label', null, 'UI scale ' + S.zoom + '%', h('input', { type: 'range', min: 50, max: 150, step: 5, value: S.zoom, oninput() { Lab.set({ zoom: +this.value }); this.parentNode.firstChild.textContent = 'UI scale ' + S.zoom + '%'; } })),
      h('label', null, 'Text size ' + (S.fontPx || 'auto'), h('input', { type: 'range', min: 10, max: 18, step: 1, value: S.fontPx || 14, oninput() { Lab.set({ fontPx: +this.value }); this.parentNode.firstChild.textContent = 'Text size ' + S.fontPx; } })),
      h('label', null, 'Accent', h('span', null, h('input', { type: 'color', value: S.accent || '#ffd24a', oninput() { Lab.set({ accent: this.value }); } }), ' ', h('button.lab-btn.sm', { onclick() { Lab.set({ accent: '' }); side(); } }, 'reset'))),
      h('h5', null, 'Stage'), opts('bg', [['dark', 'Dark'], ['game', 'Game-like'], ['light', 'Light'], ['check', 'Checker']]),
      h('div.lab-opts', { style: { marginTop: '4px' } }, h('button', { 'aria-pressed': String(S.still), onclick() { Lab.set({ still: !S.still }); side(); } }, 'Freeze animations')),
      h('p.lab-note', null, '"Match game" uses an approximation of the game theme variables (the real ones need the live game). Window size applies to the Scenes; UI scale and text size to everything.'));
  }
  Lab.drawSide = side;

  // ---------------------------------------------------------------- inspector: click an element, get its standard name
  let inspecting = false;
  function identify(target) {
    const hits = [], seen = new Set(); const sub = target.closest('.lab-subject');
    for (let e = target; e && e !== sub && e.nodeType === 1; e = e.parentElement) {
      Lab.nameList.forEach((n) => {
        if (seen.has(n.id) || !n.selector) return;
        const sels = String(n.selector).replace(/`/g, '').split(/\s*(?:,|\s\/\s|\sor\s)\s*/).filter(Boolean);
        for (const s of sels) { let ok = false; try { ok = e.matches(s); } catch (x) { ok = false; } if (ok) { seen.add(n.id); hits.push({ n, el: e }); break; } }
      });
    }
    return hits;
  }
  document.addEventListener('click', (ev) => {
    if (!inspecting) return; const t = ev.target; if (!t.closest || !t.closest('.lab-subject')) return;
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.lab-hl').forEach((x) => x.classList.remove('lab-hl')); t.classList.add('lab-hl');
    const hits = identify(t), box = $('lab-ident'); box.hidden = false; box.replaceChildren(
      h('div', null, h('b', null, hits.length ? hits[0].n.path : 'No registered name matches this element'), ' ', h('code', null, hits.length ? hits[0].n.id : '')),
      ...hits.slice(1, 5).map((x) => h('div', null, 'inside: ', x.n.path, ' ', h('code', null, x.n.id))),
      h('div', null, h('code', null, t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).join('.') : '') + (t.id ? '#' + t.id : ''))));
    copy(hits.length ? hits[0].n.path : '');
  }, true);
  Lab.setInspect = (on) => { inspecting = on; document.body.classList.toggle('lab-inspecting', on); $('lab-inspect').setAttribute('aria-pressed', String(on)); if (!on) { $('lab-ident').hidden = true; document.querySelectorAll('.lab-hl').forEach((x) => x.classList.remove('lab-hl')); } };

  // ---------------------------------------------------------------- start
  Lab.start = async function () {
    await Lab.loadNames();
    applyScenario();
    const q = $('lab-q'); let t = 0;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
    document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); q.focus(); q.select(); } if (e.key === 'Escape') { if (q.value) { q.value = ''; draw(); } else Lab.setInspect(false); } });
    $('lab-inspect').addEventListener('click', () => Lab.setInspect(!inspecting));
    $('lab-side-toggle').addEventListener('click', () => Lab.set({ side: !S.side }));
    const m = /^#\/(.+)$/.exec(location.hash); if (m) { const r = decodeURIComponent(m[1]); if (CATS.includes(r) || Lab.views[r] || r === 'All') route = r; }
    side(); draw();
    $('lab-boot').remove();
  };
})();
