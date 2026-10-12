// Scapewatch status indicator.
// Display-only: a small corner badge showing whether the watcher/mods are
// actually working, with a hover menu summarizing each feature and a
// button to open the full dashboard. Never clicks, selects, or submits
// anything in the GAME -- the one click this adds (the dashboard button)
// opens a separate browser tab/window, same category as every other
// button this mod has already added (e.g. the Plugins settings panel's
// own "Reset Scales" button), not an action taken on the player's behalf
// in-game.
//
// Reads the exact same /status JSON the full dashboard (status-server.js)
// already serves -- confirmed live, 2026-10-07, that fetching it directly
// from the game page (origin https://play.scapewatch.com) failed with a
// plain "Failed to fetch" until status-server.js started sending
// Access-Control-Allow-Origin for that origin; this script depends on
// that header being present (see status-server.js's own comment on it).
//
// Dashboard URL: defaults to the friendly `*.localhost` hostname
// (status-server.js also listens on port 80, best-effort, so this can be
// port-less) -- confirmed live, 2026-10-07, that Chromium resolves any
// `*.localhost` name straight to loopback with zero hosts-file changes,
// a browser-level special case for that TLD (RFC 6761), not anything this
// script or the server does. Falls back to the known-good :7777 URL for
// the actual fetch() calls (not dependent on port 80 having been free),
// and offers BOTH the friendly and fallback URLs in the hover menu so the
// player always has a working link regardless of whether port 80 was
// available when the watcher started.

(function () {
  'use strict';
  const NS = '__ccStatusIndicator';

  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const POLL_MS = 5000;
  const STATUS_URL = 'http://localhost:7777/status';
  const FRIENDLY_URL = 'http://scapelite.localhost/';
  const FALLBACK_URL = 'http://localhost:7777/';
  // The CDP remote-debugging port itself (see overlay/README.md's setup
  // section -- requires the game's Steam launch options to include
  // --remote-debugging-port=9222). Navigating here in a real browser
  // shows Chromium's own target list with an "inspect" link per page,
  // the standard way to get real DevTools on an app with in-app DevTools
  // disabled. Added 2026-10-07 at the user's request, alongside the
  // dashboard link, for one-click access from either surface.
  const DEVTOOLS_URL = 'http://localhost:9222/';

  function settingEnabled(key, def) {
    try {
      if (window.__ccPluginSettings && window.__ccPluginSettings.get) {
        const v = window.__ccPluginSettings.get(key);
        return v === undefined ? def : v;
      }
    } catch (e) {}
    return def;
  }

  function fmtAgo(ts) {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm ago';
  }

  // Time until a FUTURE timestamp ("in 5h 12m"); past/now reads "due".
  function fmtIn(ts) {
    if (!ts) return '–';
    const s = Math.round((ts - Date.now()) / 1000);
    if (s <= 5) return 'due';
    if (s < 60) return 'in ' + s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return 'in ' + m + 'm';
    const h = Math.floor(m / 60);
    return 'in ' + h + 'h ' + (m % 60) + 'm';
  }

  // Menu laid out via `flex-direction:column-reverse` on the OUTER
  // container (dot first in DOM/normal flow, so it renders at the
  // bottom; menu second, rendering above it) rather than the menu being
  // `position:absolute` -- fixed 2026-10-07 after the user reported being
  // unable to reach the "Open Dashboard" button: an absolutely-positioned
  // menu doesn't contribute to its parent's layout box, so the
  // `:hover`-triggering container was only ever as tall as the 14px dot
  // itself, leaving a real dead zone between dot and menu that broke
  // `:hover` the instant the cursor crossed it heading toward the button.
  // With normal flow instead, the container's own box naturally grows to
  // include the menu the moment it becomes visible, so there's no gap to
  // cross at all.
  const el = document.createElement('div');
  el.id = 'cc-status-indicator';
  el.innerHTML = `
    <div class="cc-si-head"><div class="cc-si-dot" id="cc-si-dot"></div><span class="cc-si-fps" id="cc-si-fps"></span></div>
    <div class="cc-si-menu">
      <button type="button" class="cc-si-bug" id="cc-si-bug" title="Report a ScapeLite bug"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><ellipse cx="8" cy="9.5" rx="3.2" ry="4"/><path d="M8 5.5V13.5M4.8 8H2M11.2 8H14M5 11.5L2.8 13M11 11.5L13.2 13M5.5 4.8L4 3M10.5 4.8L12 3M6.5 5.2a1.6 1.6 0 0 1 3 0"/></svg></button><div class="cc-si-title"><svg style="vertical-align:-3px;margin-right:4px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16" height="16"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="24" height="12" fill="#ffd24a"/><rect x="46" y="58" width="36" height="12" fill="#ffd24a"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg> ScapeLite</div>
      <div class="cc-si-rows" id="cc-si-rows"></div>
      <div class="cc-si-perf" id="cc-si-perf"></div>
      <button type="button" class="cc-si-open-btn" id="cc-si-open-btn">Open Dashboard ↗</button>
      <button type="button" class="cc-si-open-btn cc-si-devtools-btn" id="cc-si-devtools-btn">Open DevTools ↗</button>
      <div class="cc-si-url-row">
        <span class="cc-si-url" id="cc-si-url">${FRIENDLY_URL}</span>
        <button type="button" class="cc-si-copy-btn" id="cc-si-copy-btn" title="Copy URL">⧉</button>
      </div>
      <div class="cc-si-hint" id="cc-si-hint"></div>
    </div>`;
  const style = document.createElement('style');
  style.id = 'cc-status-indicator-style';
  style.textContent = `
#cc-status-indicator{position:fixed;left:10px;bottom:10px;z-index:99988;font:12px/1.4 system-ui,sans-serif;
  display:flex;flex-direction:column-reverse;align-items:flex-start}
#cc-status-indicator .cc-si-head{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 5px 4px;border-radius:12px;background:rgba(10,10,14,.72);
  border:1px solid rgba(255,255,255,.14);box-shadow:0 2px 8px rgba(0,0,0,.55)}
#cc-status-indicator .cc-si-fps{font:600 10px/1 system-ui,sans-serif;color:#aaa;white-space:nowrap}
#cc-status-indicator .cc-si-menu{position:relative}
#cc-status-indicator .cc-si-bug{position:absolute;top:7px;right:8px;background:none;border:0;padding:3px;margin:0;color:#8a8a9a;cursor:pointer;line-height:0;border-radius:4px}
#cc-status-indicator .cc-si-bug:hover{color:#ffd24a;background:rgba(255,255,255,.08)}
#cc-status-indicator .cc-si-fps.good{color:#7ee08a}#cc-status-indicator .cc-si-fps.mid{color:#ffc65a}#cc-status-indicator .cc-si-fps.low{color:#ff8f80}
/* The dot is ringed in near-black + white so it can't melt into a green map, and breathes with an expanding halo. */
#cc-status-indicator .cc-si-dot{--c:#777;position:relative;width:13px;height:13px;border-radius:50%;background:var(--c);
  border:2px solid #0b0b0f;outline:1.5px solid rgba(255,255,255,.85);box-shadow:0 0 8px 1px var(--c),0 1px 4px rgba(0,0,0,.8);cursor:default;
  transition:background .2s,box-shadow .2s;flex:none;animation:ccSiBreath 2.4s ease-in-out infinite}
#cc-status-indicator .cc-si-dot::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--c);opacity:0;animation:ccSiRing 2.4s ease-out infinite;pointer-events:none}
#cc-status-indicator .cc-si-dot.ok{--c:#3ddc5a}
#cc-status-indicator .cc-si-dot.warn{--c:#ffb21e}
#cc-status-indicator .cc-si-dot.bad{--c:#ff4d3d;animation-duration:1.1s}
#cc-status-indicator .cc-si-dot.bad::after{animation-duration:1.1s}
@keyframes ccSiBreath{0%,100%{box-shadow:0 0 5px 0 var(--c),0 1px 4px rgba(0,0,0,.8)}50%{box-shadow:0 0 11px 3px var(--c),0 1px 4px rgba(0,0,0,.8)}}
@keyframes ccSiRing{0%{transform:scale(.7);opacity:.85}100%{transform:scale(2.1);opacity:0}}
@media (prefers-reduced-motion:reduce){#cc-status-indicator .cc-si-dot,#cc-status-indicator .cc-si-dot::after{animation:none}}
#cc-status-indicator .cc-si-perf{border-top:1px solid rgba(255,255,255,.1);margin:4px 0 8px;padding-top:6px}
#cc-status-indicator .cc-si-ph{font-weight:600;color:#fff;margin:2px 0 4px}
#cc-status-indicator .cc-si-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;margin:2px 0 4px}
#cc-status-indicator .cc-si-bar>i{display:block;height:100%;border-radius:3px;background:#4ea3ff}
#cc-status-indicator .cc-si-bar>i.p{background:#b07cff}#cc-status-indicator .cc-si-bar>i.g{background:#7ee08a}#cc-status-indicator .cc-si-bar>i.b{background:#ffb21e}
#cc-status-indicator .cc-si-note{font-size:10px;color:#888;margin-top:3px}
#cc-status-indicator .cc-si-menu{display:none;width:300px;max-height:75vh;overflow-y:auto;margin-bottom:8px;
  background:rgba(18,18,24,.95);border:1px solid rgba(255,255,255,.14);border-radius:8px;
  padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.5);color:#e0e0e0}
#cc-status-indicator:hover .cc-si-menu{display:block}
#cc-status-indicator .cc-si-title{font-weight:600;margin-bottom:6px;color:#fff}
#cc-status-indicator .cc-si-rows{display:flex;flex-direction:column;gap:3px;margin-bottom:8px}
#cc-status-indicator .cc-si-row{display:flex;justify-content:space-between;gap:10px}
#cc-status-indicator .cc-si-row .k{color:#999}
#cc-status-indicator .cc-si-row .v{color:#ddd;text-align:right}
#cc-status-indicator .cc-si-row .v.ok{color:#8fd98f}
#cc-status-indicator .cc-si-row .v.bad{color:#ff9b9b}
#cc-status-indicator .cc-si-row .k{display:flex;align-items:center;gap:7px}
#cc-status-indicator .cc-si-led{width:9px;height:9px;border-radius:50%;background:#666;flex:none;box-shadow:0 0 4px rgba(0,0,0,.6)}
#cc-status-indicator .cc-si-led.ok{background:#4caf50;box-shadow:0 0 5px #4caf50}
#cc-status-indicator .cc-si-led.warn{background:#ffaa00;box-shadow:0 0 5px #ffaa00}
#cc-status-indicator .cc-si-led.bad{background:#f44336;box-shadow:0 0 5px #f44336}
#cc-status-indicator .cc-si-led.off{background:#555;box-shadow:none}
#cc-status-indicator .cc-si-sep{height:1px;background:rgba(255,255,255,.1);margin:3px 0}
#cc-status-indicator .cc-si-open-btn{width:100%;background:#2a2a35;color:#e0e0e0;border:1px solid #444;
  border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer;margin-bottom:6px}
#cc-status-indicator .cc-si-open-btn:hover{border-color:#777}
#cc-status-indicator .cc-si-devtools-btn{background:transparent;font-size:11px;color:#999;padding:4px 10px}
#cc-status-indicator .cc-si-devtools-btn:hover{color:#ccc}
#cc-status-indicator .cc-si-url-row{display:flex;align-items:center;gap:6px}
#cc-status-indicator .cc-si-url{flex:1;font:11px ui-monospace,Consolas,monospace;color:#9ecbff;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all;cursor:text}
#cc-status-indicator .cc-si-copy-btn{background:#2a2a35;color:#ccc;border:1px solid #444;border-radius:4px;
  padding:2px 6px;font:inherit;cursor:pointer}
#cc-status-indicator .cc-si-copy-btn:hover{border-color:#777;color:#fff}
#cc-status-indicator .cc-si-hint{margin-top:6px;font-size:10px;color:#888}
`;

  function insertOverlay() {
    if (!document.body) return false;
    if (!document.getElementById('cc-status-indicator-style')) document.head.appendChild(style);
    if (!document.getElementById('cc-status-indicator')) document.body.appendChild(el);
    return true;
  }

  function row(label, value, cls) {
    return `<div class="cc-si-row"><span class="k">${label}</span><span class="v${cls ? ' ' + cls : ''}">${value}</span></div>`;
  }
  // A row with a status light: state is ok (green) / warn (amber) / bad (red) / off (grey).
  function ledRow(label, value, state, title) {
    return `<div class="cc-si-row"${title ? ` title="${title}"` : ''}><span class="k"><span class="cc-si-led ${state}"></span>${label}</span><span class="v">${value}</span></div>`;
  }

  // ---- performance: frame rate (page side) + CPU attribution (watcher side, via the CDP profiler) ----
  const pf = { frames: 0, t0: performance.now(), last: performance.now(), maxFt: 0, fps: 0, worst: 0, slow: [] };
  let rafId = 0, hoverAt = 0, hoverTimer = 0, lastData = null, devMode = false;
  function frame(now) {
    const dt = now - pf.last; pf.last = now; pf.frames++;
    if (dt > pf.maxFt) pf.maxFt = dt;
    if (dt > 50) pf.slow.push(now);
    if (now - pf.t0 >= 1000) {
      pf.fps = Math.round(pf.frames * 1000 / (now - pf.t0)); pf.worst = Math.round(pf.maxFt);
      pf.frames = 0; pf.maxFt = 0; pf.t0 = now;
      while (pf.slow.length && now - pf.slow[0] > 60000) pf.slow.shift();
      const f = el.querySelector('#cc-si-fps');
      if (f) { f.textContent = pf.fps + ' fps'; f.className = 'cc-si-fps ' + (pf.fps >= 50 ? 'good' : pf.fps >= 30 ? 'mid' : 'low'); f.title = 'Frames per second (worst frame ' + pf.worst + ' ms). Hover the dot for the breakdown.'; }
    }
    rafId = requestAnimationFrame(frame);
  }
  const bar = (pct, cls) => '<div class="cc-si-bar"><i class="' + (cls || '') + '" style="width:' + Math.max(1, Math.min(100, pct)) + '%"></i></div>';
  function renderPerf() {
    const box = el.querySelector('#cc-si-perf'); if (!box) return;
    const p = lastData && lastData.perf, mem = performance.memory;
    const nodes = document.getElementsByTagName('*').length;
    let h = '<div class="cc-si-ph">Performance</div>' +
      row('Frame rate', pf.fps + ' fps', pf.fps >= 50 ? 'ok' : pf.fps < 30 ? 'bad' : '') +
      row('Worst frame (last s)', pf.worst + ' ms', pf.worst > 100 ? 'bad' : '') +
      row('Slow frames (>50 ms), last min', String(pf.slow.length), pf.slow.length > 20 ? 'bad' : '') +
      (mem ? row('JS memory', Math.round(mem.usedJSHeapSize / 1048576) + ' MB') : '') +
      row('Page elements', nodes.toLocaleString('en-US'), nodes > 80000 ? 'bad' : '');
    if (nodes > 80000) h += '<div class="cc-si-note">That is the game\u2019s own page size (its hidden crafting/smithing tabs), not ScapeLite. It makes every page-wide lookup slower.</div>';
    if (!p) {
      h += '<div class="cc-si-note">Measuring where the time goes\u2026 (a few seconds)</div>';
    } else {
      h += '<div class="cc-si-ph" style="margin-top:8px">Where the main thread\u2019s time goes</div>' +
        row('Busy (not idle)', p.busyPct + '%', p.busyPct > 90 ? 'bad' : '') + bar(p.busyPct, p.busyPct > 90 ? 'b' : 'g') +
        row('ScapeLite plugins', p.scapelitePct + '%', p.scapelitePct > 10 ? 'bad' : 'ok') + bar(p.scapelitePct * 2, 'p') +
        row('Game scripts', p.gamePct + '%') + bar(p.gamePct, '') +
        row('Browser / drawing', p.browserPct + '%') + bar(p.browserPct, 'b') +
        (p.gcPct >= 0.5 ? row('Garbage collection', p.gcPct + '%') : '');
      if (p.plugins.length) {
        h += '<div class="cc-si-ph" style="margin-top:8px">By plugin</div>';
        p.plugins.slice(0, 8).forEach((pl) => { h += row(pl.label, pl.pct + '%', pl.pct > 3 ? 'bad' : '') + bar(pl.pct * 6, 'p'); });
      }
      h += '<div class="cc-si-note">Sampled ' + fmtAgo(p.at) + ' over ' + (p.windowMs / 1000).toFixed(1) + ' s. Percent of one CPU thread. Plugin time includes the page lookups they trigger.</div>';
    }
    box.innerHTML = h;
  }
  function wantPerf() { return Date.now() - hoverAt < 12000; }
  el.addEventListener('mouseenter', () => {
    hoverAt = Date.now(); renderPerf();
    clearInterval(hoverTimer);
    hoverTimer = setInterval(() => { hoverAt = Date.now(); renderPerf(); tick(); }, 2000);
  });
  el.addEventListener('mouseleave', () => { clearInterval(hoverTimer); hoverTimer = 0; hoverAt = Date.now() - 6000; });
  rafId = requestAnimationFrame(frame);

  async function tick() {
    if (!settingEnabled('statusIndicatorEnabled', true)) {
      if (insertOverlay()) el.hidden = true;
      return;
    }
    insertOverlay();
    el.hidden = false;

    const dot = el.querySelector('#cc-si-dot');
    const rowsEl = el.querySelector('#cc-si-rows');
    const hintEl = el.querySelector('#cc-si-hint');

    let data = null;
    try {
      const res = await fetch(STATUS_URL);
      data = await res.json(); lastData = data; devMode = !!data.devMode; wireButtons();
    } catch (e) {
      dot.className = 'cc-si-dot bad';
      rowsEl.innerHTML = ledRow('Dashboard / watcher', 'Not reachable', 'bad') +
        ['Game connection', 'Chat relay', 'Clan hiscores', 'Raid summary', 'Activity digest', 'Plugins'].map(n => ledRow(n, '\u2013', 'off')).join('');
      hintEl.textContent = 'Is the supervisor / watcher process running? (start-watcher-hidden.vbs)';
      return;
    }

    const sup = data.supervisor || { managed: false };
    const anyConfigured = !!(data.chatRelay.configured || data.clanHiscores.configured || data.raidSummary.configured || data.digest.configured);
    if (sup.managed && sup.state !== 'running') {
      dot.className = sup.state === 'stopped' ? 'cc-si-dot bad' : 'cc-si-dot warn';
      hintEl.textContent = sup.state === 'stopped' ? 'Watcher is stopped (start it from the dashboard).' : 'Watcher is ' + sup.state + '\u2026';
    } else if (!data.cdp.connected) {
      dot.className = 'cc-si-dot warn';
      hintEl.textContent = 'Watcher running, not connected to the game.';
    } else if (!anyConfigured) {
      dot.className = 'cc-si-dot warn';
      hintEl.textContent = 'Connected, but nothing is configured yet.';
    } else {
      dot.className = 'cc-si-dot ok';
      hintEl.textContent = '';
    }

    // One status light per listener. green = working, amber = configured but
    // waiting/idle-problem, red = broken, grey = switched off / not configured.
    const connected = !!data.cdp.connected;
    const cr = data.chatRelay, hc = data.clanHiscores, rs = data.raidSummary, dg = data.digest;
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    const plugOn = plugins.filter(p => p.enabled), plugLoaded = plugOn.filter(p => p.loaded);
    const watcherRow = !sup.managed ? ledRow('Watcher process', 'Standalone', 'warn', 'Not under the supervisor: no Stop/Start/Restart')
      : ledRow('Watcher process', sup.state === 'running' ? 'Running' : sup.state, sup.state === 'running' ? 'ok' : sup.state === 'stopped' ? 'bad' : 'warn');
    rowsEl.innerHTML =
      watcherRow +
      ledRow('Game connection', connected ? 'Connected' : 'Disconnected', connected ? 'ok' : 'bad') +
      '<div class="cc-si-sep"></div>' +
      ledRow('Chat relay', !cr.configured ? 'Off' : cr.lastEventAt ? 'last ' + fmtAgo(cr.lastEventAt) : 'listening', !cr.configured ? 'off' : connected ? 'ok' : 'warn', 'Relayed this session: ' + cr.totalRelayed) +
      ledRow('Clan hiscores', !hc.configured ? 'Off' : !hc.wsHookReady ? 'needs game reload' : hc.lastClanRank != null ? '#' + hc.lastClanRank + ' \u00b7 ' + fmtAgo(hc.lastPollAt) : fmtAgo(hc.lastPollAt), !hc.configured ? 'off' : hc.wsHookReady ? 'ok' : 'warn') +
      ledRow('Raid summary', !rs.configured ? 'Off' : rs.totalPosted ? rs.totalPosted + ' posted' : 'listening', !rs.configured ? 'off' : connected ? 'ok' : 'warn') +
      ledRow('Activity digest', !dg.configured ? 'Off' : dg.nextPostAt ? 'next ' + fmtIn(dg.nextPostAt) : 'On', !dg.configured ? 'off' : 'ok') +
      '<div class="cc-si-sep"></div>' +
      ledRow('Game bridge', data.bridge && data.bridge.ok ? 'Attached' : (connected ? 'Waiting' : '–'), data.bridge && data.bridge.ok ? 'ok' : connected ? 'warn' : 'off', 'Read-only access to the game’s task duration / XP projections (Route Advisor XP/hr, tasks/hr, quests).') +
      (data.update ? ledRow('Updates', data.update.behind > 0 ? 'v' + data.update.version + ' \u2192 ' + (data.update.latest && data.update.latest.version) + ' available' : data.update.error ? 'check failed' : 'up to date', data.update.behind > 0 ? 'warn' : data.update.error ? 'off' : 'ok', data.update.message || '') : '') +
      ledRow('Plugins', plugins.length ? plugLoaded.length + '/' + plugOn.length + ' loaded' : '\u2013', !plugins.length ? 'off' : plugLoaded.length === plugOn.length ? 'ok' : connected ? 'warn' : 'off', plugins.length ? plugins.filter(p => !p.enabled).map(p => p.label + ' (off)').join(', ') : '');
    renderPerf();
  }

  function wireButtons() {
    const openBtn = el.querySelector('#cc-si-open-btn');
    const devtoolsBtn = el.querySelector('#cc-si-devtools-btn');
    const copyBtn = el.querySelector('#cc-si-copy-btn');
    if (devtoolsBtn) devtoolsBtn.style.display = devMode ? '' : 'none'; // developer tool: hidden in release mode
    if (openBtn && !openBtn.__ccWired) {
      openBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        // Opens a new browser tab/window -- not a click inside the game
        // itself. If the game's Electron shell blocks window.open outright
        // (untested -- no reliable way to verify without a real player
        // click), the copy button below is the guaranteed-safe fallback.
        try { window.open(FRIENDLY_URL, '_blank'); } catch (e2) { /* fall through to the copyable URL */ }
      });
      openBtn.__ccWired = true;
    }
    const bugBtn = el.querySelector('#cc-si-bug');
    if (bugBtn && !bugBtn.__ccWired) {
      bugBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { window.__ccBugReport && window.__ccBugReport.open(); } catch (e2) {} });
      bugBtn.__ccWired = true;
    }
    if (devtoolsBtn && !devtoolsBtn.__ccWired) {
      devtoolsBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { window.open(DEVTOOLS_URL, '_blank'); } catch (e2) { /* same fallback story as the dashboard button */ }
      });
      devtoolsBtn.__ccWired = true;
    }
    if (copyBtn && !copyBtn.__ccWired) {
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const urlEl = el.querySelector('#cc-si-url');
        const text = urlEl ? urlEl.textContent : FRIENDLY_URL;
        const original = copyBtn.textContent;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '✓';
          setTimeout(() => { copyBtn.textContent = original; }, 1200);
        }).catch(() => {
          // Clipboard API can be restricted in some contexts -- the URL
          // text itself is user-select:all, so a manual select+copy
          // always works as a fallback regardless.
        });
      });
      copyBtn.__ccWired = true;
    }
  }

  // Before login (boot, "Continue as ...", world select) only this badge shows: every other ScapeLite element is hidden.
  // Pre-login = the game's login form is visible. Anything unexpected (no login markup found) counts as in-game, so a failed check never hides the UI.
  const loginStyle = document.createElement('style');
  loginStyle.id = 'cc-prelogin-style';
  loginStyle.textContent = 'body.cc-prelogin [id^="cc-"]:not(#cc-status-indicator):not(#cc-bugreport):not(style):not(script){display:none!important}';
  document.head.appendChild(loginStyle);
  function checkLogin() {
    try {
      const lf = document.querySelector('#login-form, .login-box, .login-hero');
      const visible = !!(lf && lf.getClientRects().length && getComputedStyle(lf).visibility !== 'hidden');
      document.body.classList.toggle('cc-prelogin', visible && settingEnabled('hideBeforeLogin', true));
    } catch (e) { document.body.classList.remove('cc-prelogin'); }
  }
  const loginTimer = setInterval(checkLogin, 700);
  checkLogin();

  const intervalId = setInterval(tick, POLL_MS);
  insertOverlay();
  wireButtons();
  tick();

  function teardown() {
    clearInterval(intervalId); clearInterval(hoverTimer); cancelAnimationFrame(rafId); clearInterval(loginTimer);
    document.body.classList.remove('cc-prelogin'); loginStyle.remove();
    el.remove();
    style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc status-indicator torn down';
  }

  window[NS] = { version: 3, teardown, wantPerf, get perf() { return { fps: pf.fps, worst: pf.worst, slow: pf.slow.length }; } };

  console.log('[cc] status-indicator loaded');
  return 'cc status-indicator loaded';
})();
