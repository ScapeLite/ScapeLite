// ScapeLite Queue Walking Time. Display only: shows how long the walk to each queued task takes, right on the queue.
// Every queued row gets a thin bar along its top edge and a small tag ("🚶 2m 31s") that sits between it and the task above.
// The bar spans the whole card, fading out at both ends, and gets thicker and redder the longer the walk. A full bar is the game's teleport
// threshold (the walk length at which it would teleport instead); the Settings option "Relative walking bars" makes the longest walk in the queue the full bar. Green is short, red is long; purple means the game would teleport.
// Time = the path distance the game prints next to the task (steps) divided by your walking speed (steps per second).
// Hover a tag to enlarge it and see the steps. A button in the queue's header (next to the insert-bar button) switches it all on and off.
// Nothing in the game's queue is moved: the tag and bar are drawn inside each row and never change its layout.
(function () {
  'use strict';
  const NS = '__ccQueueWalk';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('queueWalkEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const DEFAULT_FULL_STEPS = 12000; // used when the game has no teleport threshold for a hop
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const LS_OFF = 'cc-qwalk-hidden';
  let hidden = false;
  try { hidden = localStorage.getItem(LS_OFF) === '1'; } catch (e) {}

  const style = document.createElement('style');
  style.id = 'cc-qwalk-style';
  style.textContent = `
#unified-queue-panel .uq-rows .uq-row.cc-qw{position:relative}
.cc-qw-bar{position:absolute;left:0;right:0;top:-2px;height:4px;border-radius:50%/100%;pointer-events:none;z-index:4;opacity:.95}
.cc-qw-tag{position:absolute;left:50%;top:-9px;transform:translateX(-50%);transform-origin:50% 0;z-index:5;padding:1px 9px;border-radius:10px;font:700 12px/15px system-ui,sans-serif;white-space:nowrap;color:#10101a;box-shadow:0 1px 4px rgba(0,0,0,.55);cursor:default;transition:transform .12s ease,font-size .12s ease}
.cc-qw-tag .m{display:none;font-weight:600}
.cc-qw-tag:hover{transform:translateX(-50%) scale(1.6);z-index:60;box-shadow:0 3px 12px rgba(0,0,0,.7)}
.cc-qw-tag:hover .m{display:inline}
.cc-qw-btn{position:absolute;width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:0;font-size:12px;line-height:1;
  background:var(--bg-cell,#1c1c26);border:1px solid var(--border-primary,#3a3a4a);border-radius:4px;color:var(--text-muted,#999);cursor:pointer;opacity:.7;z-index:61;user-select:none}
.cc-qw-btn:hover{opacity:1;background:var(--bg-hover,#2a2a38);color:var(--text-light,#fff)}
.cc-qw-btn.active{opacity:1;color:var(--text-gold,#ffd24a);border-color:var(--border-secondary,#6b5a2a);background:var(--bg-hover,#2a2a38)}
`;
  document.head.appendChild(style);

  const fmt = (sec) => { const s = Math.round(sec); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
  const colorOf = (f) => (f < 0.2 ? '#5fe06d' : f < 0.45 ? '#ffd24a' : f < 0.75 ? '#ff9a3c' : '#ff5a4d'); // share of a full bar

  // Header button, left of the insert-bar button (or of the collapse button when that one is off).
  function ensureButton() {
    const panel = document.getElementById('unified-queue-panel');
    let btn = window.__ccDom.q('.cc-qw-btn');
    if (!on() || !panel) { if (btn) btn.remove(); return; }
    if (!btn || btn.parentElement !== panel) {
      if (btn) btn.remove();
      btn = document.createElement('div'); btn.className = 'cc-qw-btn'; btn.textContent = '🚶';
      ['mousedown', 'pointerdown', 'dblclick', 'contextmenu'].forEach((t) => btn.addEventListener(t, (e) => e.stopPropagation()));
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hidden = !hidden; try { localStorage.setItem(LS_OFF, hidden ? '1' : '0'); } catch (er) {} ensureButton(); update(); });
      panel.appendChild(btn);
    }
    btn.classList.toggle('active', !hidden);
    btn.title = hidden ? 'Show the walking time between queued tasks' : 'Hide the walking time between queued tasks';
    const ins = panel.querySelector(':scope > .cc-insert-btn'), ref = ins || panel.querySelector('.queue-collapse-btn') || panel.querySelector('.queue-pin-btn');
    if (ref) {
      const cs = getComputedStyle(ref), right = parseFloat(cs.right);
      btn.style.right = (Number.isFinite(right) ? right + 24 : 84) + 'px';
      btn.style.top = cs.top !== 'auto' ? cs.top : ''; btn.style.bottom = cs.bottom !== 'auto' ? cs.bottom : '';
    }
  }
  function clear() { document.querySelectorAll('.cc-qw-bar, .cc-qw-tag').forEach((e) => e.remove()); document.querySelectorAll('.uq-row.cc-qw').forEach((r) => r.classList.remove('cc-qw')); }

  function update() {
    const b = window.__ccBridge;
    const spd = b && b.speed ? b.speed() : null, speed = spd ? spd.sps : 0;   // walking speed: the bridge's single source
    try { ensureButton(); } catch (e) {}
    const rows = on() && !hidden && b && b.hop && speed ? document.querySelectorAll('#unified-queue-panel .uq-rows .uq-row') : [];
    if (!rows.length) { clear(); return; }
    // 1. read every hop
    const list = [];
    rows.forEach((row) => {
      let hop = null;
      try {
        const opt = row.querySelector('.icon-option.selected') || row.querySelector('.icon-option');
        const sr = opt && opt.querySelector('.icon-scroll-row');
        const slot = sr ? parseInt(sr.getAttribute('data-slot-index'), 10) : NaN;
        const mob = sr ? sr.getAttribute('data-mob-id') : null, node = sr ? sr.getAttribute('data-node-id') : null;
        if (Number.isFinite(slot) && slot >= 0) hop = b.hop(slot, mob || node, !!mob);
      } catch (e) { hop = null; }
      list.push({ row, hop });
    });
    // 2. what a full bar means: the game's teleport threshold (a hop that long would be teleported), or, in relative mode, the longest walk in this queue
    const relative = !!setting('queueWalkRelative', false);
    const maxD = Math.max(1, ...list.map((e) => (e.hop && e.hop.d) || 0));
    const maxTh = Math.max(0, ...list.map((e) => (e.hop && e.hop.th) || 0)) || DEFAULT_FULL_STEPS;
    list.forEach(({ row, hop }) => {
      let bar = row.querySelector(':scope > .cc-qw-bar'), tag = row.querySelector(':scope > .cc-qw-tag');
      if (!hop || !(hop.d > 0)) { if (bar) bar.remove(); if (tag) tag.remove(); return; }
      row.classList.add('cc-qw');
      if (!bar) { bar = document.createElement('div'); bar.className = 'cc-qw-bar'; row.appendChild(bar); }
      if (!tag) { tag = document.createElement('div'); tag.className = 'cc-qw-tag'; row.appendChild(tag); }
      const sec = spd.time(hop.d), full = relative ? maxD : (hop.th || maxTh), f = Math.max(0.02, Math.min(1, hop.d / full));
      const col = hop.tp ? '#b57cff' : colorOf(f);
      // the bar spans the whole card and fades out to nothing at both ends; it gets thicker the closer the walk is to a full bar
      bar.style.height = (2 + 3 * f).toFixed(1) + 'px';
      bar.style.background = 'linear-gradient(90deg, transparent 0%, ' + col + ' 22%, ' + col + ' 78%, transparent 100%)';
      const text = hop.tp ? '⚡ teleport' : '🚶 ' + fmt(sec), more = ' · ' + Math.round(hop.d).toLocaleString('en-US') + ' steps';
      if (tag.dataset.t !== text + more) { tag.dataset.t = text + more; tag.textContent = text; const m = document.createElement('span'); m.className = 'm'; m.textContent = more; tag.appendChild(m); }
      tag.style.background = col;
      tag.title = 'Walking to this task: ' + fmt(sec) + ' (' + Math.round(hop.d).toLocaleString('en-US') + ' steps at ' + speed.toFixed(1) + ' steps/s). ' +
        Math.round(f * 100) + '% of ' + (relative ? 'the longest walk in this queue' : 'the teleport threshold (' + Math.round(full).toLocaleString('en-US') + ' steps)') + '.' + (hop.tp ? ' The game would teleport for this hop.' : '');
    });
  }
  const timer = setInterval(() => { try { if (!(document.hidden || window.__ccEcoOn)) update(); } catch (e) { /* keep ticking */ } }, 1500);
  function teardown() {
    clearInterval(timer); clear(); document.querySelectorAll('.cc-qw-btn').forEach((e) => e.remove()); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc queue-walk torn down';
  }
  window[NS] = { version: 1, teardown, update };
  return 'cc queue-walk loaded';
})();
