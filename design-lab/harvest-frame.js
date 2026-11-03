// Design Lab CSS harvest. Runs the REAL overlay scripts in this hidden frame (so none of their page side effects can touch the lab page) and hands the
// <style> elements they inject to the parent, which installs them verbatim. Production CSS is therefore never copied: edit overlay/*.js and reload.
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const CORE = ['lifecycle.js', 'dom-scope.js', 'ui-kit.js', 'ui-scale.js'];
  const PLUGINS = (q.get('plugins') || '').split(',').filter(Boolean);
  const report = { ok: [], failed: [], styles: [] };
  const seen = new Set();
  // some plugins build their <style> now and attach it only when their panel first opens: track every style element created, attached or not
  const created = [], mk = document.createElement.bind(document);
  document.createElement = function (tag, o) { const e = mk(tag, o); if (String(tag).toLowerCase() === 'style') created.push(e); return e; };
  function snap(src) {
    new Set(Array.from(document.querySelectorAll('style')).concat(created)).forEach((s) => {
      if (seen.has(s)) return; seen.add(s);
      if (s.textContent && s.textContent.length > 20) report.styles.push({ id: s.id || '', src, css: s.textContent });
    });
  }
  window.addEventListener('error', (e) => { report.failed.push({ src: 'runtime', msg: String(e.message) }); });
  const queue = CORE.concat(PLUGINS);
  (function next() {
    const f = queue.shift();
    if (!f) { try { parent.postMessage({ labHarvest: report }, '*'); } catch (e) { /* no parent */ } return; }
    const s = document.createElement('script'); s.src = '../overlay/' + f;
    s.onload = () => { report.ok.push(f); snap(f); next(); };
    s.onerror = () => { report.failed.push({ src: f, msg: 'load error' }); next(); };
    document.body.appendChild(s);
  })();
})();
