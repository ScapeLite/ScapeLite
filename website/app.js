// Renders the plugin list from catalog.json (copied here by `npm run build-site`).
(function () {
  'use strict';
  var grid = document.getElementById('pluginGrid');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  fetch('catalog.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (cat) {
    var v = document.getElementById('ver'); if (v && cat.version) v.textContent = 'v' + cat.version;
    grid.textContent = '';
    cat.plugins.forEach(function (p) {
      var c = el('article', 'pl');
      if (!p.community) { var t = el('span', 'tag'); t.title = 'Made by the ScapeLite team'; var i = document.createElement('img'); i.src = 'assets/logo.svg'; i.alt = 'ScapeLite'; t.appendChild(i); c.appendChild(t); }
      if (p.screenshots && p.screenshots[0]) { var im = document.createElement('img'); im.className = 'thumb'; im.loading = 'lazy'; im.alt = ''; im.src = 'assets/shots/' + encodeURIComponent(p.screenshots[0]); im.onerror = function () { im.remove(); }; c.appendChild(im); }
      c.appendChild(el('h3', null, p.name));
      c.appendChild(el('p', null, p.tagline || p.description));
      var chips = el('div', 'chips'); chips.appendChild(el('span', 'chip', p.category));
      if (p.core) chips.appendChild(el('span', 'chip core', 'always on'));
      c.appendChild(chips);
      grid.appendChild(c);
    });
  }).catch(function () { grid.textContent = 'The plugin list could not be loaded.'; });
})();

// If the ScapeLite dashboard is running on this PC, the download buttons become "Dashboard" buttons.
(function () {
  var local = /^(localhost|127\.0\.0\.1|.*\.localhost)$/.test(location.hostname);
  var base = (local && location.port === '7777') ? location.origin : 'http://127.0.0.1:7777';
  var ctl = new AbortController();
  var t = setTimeout(function () { ctl.abort(); }, 2000);
  fetch(base + '/logo.svg', { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }).then(function () {
    clearTimeout(t);
    document.querySelectorAll('a[href="#download"]').forEach(function (a) {
      a.href = base + '/'; a.removeAttribute('aria-disabled'); a.classList.remove('disabled'); a.classList.remove('primary'); a.classList.add('live');
      if (a.id === 'dlBtn') { a.textContent = 'Open Dashboard'; return; }
      a.textContent = a.classList.contains('small') ? 'Dashboard' : 'Open Dashboard';
    });
    var lead = document.querySelector('#download .lead'); if (lead) lead.textContent = 'ScapeLite is running on this PC. Open the dashboard to manage plugins and settings.';
  }).catch(function () { clearTimeout(t); });
})();
