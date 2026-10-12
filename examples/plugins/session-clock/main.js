// Session Clock - example ScapeLite plugin (display-only).
// Shows the patterns every plugin should follow: replace any previous instance, add your own elements (never edit
// the game's), read game data defensively, keep timers light, and clean everything up in teardown().
(function () {
  'use strict';
  const NS = '__cc_session_clock';                       // must match "ns" in plugin.json
  try { window[NS] && window[NS].teardown(); } catch (e) {}   // re-injection safe: tear the old copy down first

  const KEY = 'cc-plugin-session-clock';                 // your own localStorage key (plugins cannot add rows to the Settings tab)
  const startedAt = Date.now();
  let pos = { x: 20, y: 200 };
  try { pos = Object.assign(pos, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  // 1) Your own stylesheet + element. Use a unique id/class prefix so nothing clashes with the game or other plugins.
  const style = document.createElement('style');
  style.textContent = `
    #cc-session-clock{position:fixed;z-index:99970;padding:5px 10px;border-radius:9px;background:rgba(14,14,20,.92);
      border:1px solid rgba(255,255,255,.16);color:#e6e6ee;font:13px/1.3 system-ui,sans-serif;cursor:grab;user-select:none;
      box-shadow:0 4px 14px rgba(0,0,0,.5);display:flex;gap:10px;align-items:center}
    #cc-session-clock b{color:#ffd24a}
    #cc-session-clock .x{cursor:pointer;color:#8a8a99}#cc-session-clock .x:hover{color:#fff}`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'cc-session-clock';
  el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
  el.innerHTML = '<span>Session <b class="t">00:00:00</b></span><span class="r"></span><span class="x" title="Hide">×</span>';
  document.body.appendChild(el);

  // 2) Drag to move, remember the position.
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('x')) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const move = (ev) => { el.style.left = Math.max(0, Math.min(innerWidth - 60, r.left + ev.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px'; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); try { localStorage.setItem(KEY, JSON.stringify({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })); } catch (er) {} };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  el.querySelector('.x').addEventListener('click', () => { el.hidden = true; });

  // 3) One light timer. Read other plugins' data defensively: their globals may not exist (yet).
  const pad = (n) => String(n).padStart(2, '0');
  const fmtXp = (n) => (n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  function tick() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    el.querySelector('.t').textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    let xp = 0;
    try { const rates = window.__ccXpTracker && window.__ccXpTracker.rates; if (rates) xp = Object.values(rates).reduce((a, b) => a + b, 0); } catch (e) {}
    el.querySelector('.r').textContent = xp > 0 ? fmtXp(xp) + ' xp/hr' : '';
  }
  tick();
  const timer = setInterval(tick, 1000);

  // 4) Clean up completely: "Remove" in the marketplace calls this.
  function teardown() {
    clearInterval(timer);
    el.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
  }
  window[NS] = { teardown };
  return 'session-clock loaded';
})();
