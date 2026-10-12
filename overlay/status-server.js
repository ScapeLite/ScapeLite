// ScapeLite dashboard (http://scapelite.localhost/).
// A tiny local-only HTTP server (Node's built-in http module -- no new
// dependencies): live health cards, categorised logs (All / Discord /
// System), per-plugin on/off switches, and -- when run under
// overlay/supervisor.js -- Stop / Start / Restart for the watcher process.
// Bound to 127.0.0.1 only. GET /status is read-only; the few POST control
// endpoints are hardened (see guard()): Host and Origin must be this
// dashboard itself and a custom header is required, so no other web page --
// including the game page -- can drive them via CSRF or DNS rebinding.

'use strict';

const http = require('http');

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ScapeLite Dashboard</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0f0f14; color:#e0e0e0; font:14px/1.5 system-ui,sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
  .devtools-link { font-size:12px; font-weight:normal; color:#888; text-decoration:none;
    border:1px solid #333; border-radius:4px; padding:2px 7px; }
  .devtools-link:hover { color:#ccc; border-color:#666; }
  .sub { color:#888; font-size:12px; margin-bottom:16px; }
  .ctl { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 18px; padding:10px 14px;
    background:#17171f; border:1px solid #2a2a35; border-radius:8px; }
  .ctl .state { font-weight:600; margin-right:6px; }
  .ctl .meta { color:#888; font-size:12px; margin-left:auto; }
  button { font:inherit; font-size:13px; color:#ddd; background:#22222c; border:1px solid #3a3a48; border-radius:6px; padding:4px 14px; cursor:pointer; }
  button:hover:not(:disabled) { border-color:#777; color:#fff; }
  button:disabled { opacity:.4; cursor:default; }
  button.stop:hover:not(:disabled) { border-color:#f44336; }
  button.start:hover:not(:disabled) { border-color:#4caf50; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin-bottom:22px; }
  .card { background:#17171f; border:1px solid #2a2a35; border-radius:8px; padding:14px 16px; }
  .card h2 { font-size:12px; margin:0 0 10px; color:#999; text-transform:uppercase; letter-spacing:.05em; }
  .row { display:flex; justify-content:space-between; gap:10px; padding:3px 0; font-size:13px; }
  .row .k { color:#999; }
  .row .v { font-weight:600; text-align:right; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:7px; }
  .dot.ok { background:#4caf50; } .dot.bad { background:#f44336; } .dot.warn { background:#ffaa00; }
  h3.section { font-size:12px; margin:0 0 10px; color:#999; text-transform:uppercase; letter-spacing:.05em; }
  details.plugbox { background:#17171f; border:1px solid #2a2a35; border-radius:8px; margin-bottom:22px; }
  details.plugbox > summary { cursor:pointer; padding:9px 14px; font-size:13px; font-weight:600; list-style:none; display:flex; align-items:center; gap:8px; user-select:none; }
  details.plugbox > summary::-webkit-details-marker { display:none; }
  details.plugbox > summary::before { content:'\\25B8'; color:#888; font-size:12px; transition:transform .12s; }
  details.plugbox[open] > summary::before { transform:rotate(90deg); }
  details.plugbox > summary .cnt { color:#888; font-weight:400; font-size:12px; }
  .plugins { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:2px 18px; padding:4px 14px 10px; border-top:1px solid #2a2a35; }
  .plug { display:flex; align-items:center; gap:10px; padding:4px 0; }
  .plug .n { flex:1; min-width:0; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .plug .d { color:#888; font-size:11px; margin-left:6px; }
  .sw { position:relative; width:38px; height:20px; border-radius:10px; background:#3a3a48; cursor:pointer; flex:none; transition:background .15s; }
  .sw::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#ddd; transition:left .15s; }
  .sw.on { background:#2e7d32; } .sw.on::after { left:20px; }
  .sw.locked { opacity:.45; cursor:not-allowed; }
  .tabs { display:flex; gap:6px; margin-bottom:8px; align-items:center; }
  .tabs .sp { flex:1; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width:900px) { .split { grid-template-columns:1fr; } }
  .pane h4 { margin:0 0 6px; font-size:12px; color:#999; text-transform:uppercase; letter-spacing:.05em; font-weight:600; }
  .pane h4 .c { color:#666; margin-left:6px; font-weight:400; }
  .tab { background:#17171f; border:1px solid #2a2a35; border-radius:6px; padding:3px 12px; color:#999; cursor:pointer; font-size:13px; }
  .tab.sel { color:#fff; border-color:#6a6a80; background:#22222c; }
  .tab .c { color:#777; margin-left:5px; font-size:11px; }
  .log { background:#0a0a0e; border:1px solid #2a2a35; border-radius:8px; padding:12px 14px; height:420px;
    overflow-y:auto; font:12px/1.5 ui-monospace,Consolas,monospace; white-space:pre-wrap; word-break:break-word; }
  /* Colour coding: Discord = blurple family, System = teal family; the chip
     says which kind of message it is. */
  .log .line { padding:1px 0 1px 8px; border-left:3px solid transparent; margin:1px 0; border-radius:2px; }
  .log .line.f-discord { border-left-color:#5865f2; background:rgba(88,101,242,.07); color:#c9cffb; }
  .log .line.f-system { border-left-color:#26a69a; background:rgba(38,166,154,.06); color:#bfe6e1; }
  .log .line.err { color:#ff8a80; background:rgba(244,67,54,.10); border-left-color:#f44336; }
  .log .line.dup { opacity:.6; }
  .log .ts { color:#667; margin-right:8px; }
  .chip { display:inline-block; font:600 10px/14px system-ui,sans-serif; letter-spacing:.03em; padding:0 6px; margin-right:7px; border-radius:8px; color:#0b0b10; vertical-align:1px; }
  .s-relay { background:#7289ff; } .s-hiscores { background:#ffb74d; } .s-raid { background:#ef7a70; } .s-digest { background:#4dd0e1; }
  .s-plugin { background:#81c784; } .s-connection { background:#4fc3f7; } .s-config { background:#a8b0b8; } .s-supervisor { background:#ce93d8; } .s-error { background:#ff5252; color:#fff; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 14px; align-items:center; margin:0 0 8px; font-size:11px; color:#8a8a96; }
  .legend .grp { display:flex; align-items:center; gap:4px; }
  .legend .grp b { font-weight:600; color:#aab; margin-right:2px; }
  .clock-fmt-btn { padding:1px 7px; font-size:11px; margin-left:4px; color:#888; }
  .toast { position:fixed; bottom:18px; right:18px; background:#22222c; border:1px solid #555; border-radius:8px; padding:8px 14px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; }
  .toast.show { opacity:1; }
  .banner { margin:10px 0 4px; padding:14px 18px 10px; border-radius:12px; border:1px solid #2a2a38; background:#15151d; position:relative; overflow:hidden; }
  .banner::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--bn,#2a2a38); }
  .banner.ok { --bn:#3ddc5a; border-color:rgba(61,220,90,.45); background:linear-gradient(90deg,rgba(61,220,90,.13),rgba(61,220,90,.03) 55%,#15151d); box-shadow:0 0 22px rgba(61,220,90,.10); }
  .banner.warn { --bn:#ffd24a; border-color:rgba(255,210,74,.5); background:linear-gradient(90deg,rgba(255,210,74,.14),rgba(255,210,74,.03) 55%,#15151d); }
  .banner.bad { --bn:#ff5a5a; border-color:rgba(255,90,90,.5); background:linear-gradient(90deg,rgba(255,90,90,.13),rgba(255,90,90,.03) 55%,#15151d); }
  .bn-top { display:flex; align-items:center; gap:14px; }
  .bn-dot { width:14px; height:14px; border-radius:50%; background:var(--bn); box-shadow:0 0 12px var(--bn); flex:none; animation:bnPulse 2s ease-in-out infinite; }
  @keyframes bnPulse { 0%,100% { box-shadow:0 0 6px var(--bn); opacity:.8 } 50% { box-shadow:0 0 16px var(--bn); opacity:1 } }
  .bn-tx { flex:1; min-width:0; }
  .bn-h { font-size:18px; font-weight:700; letter-spacing:-.01em; }
  .bn-s { font-size:13px; color:#a9a9ba; margin-top:1px; }
  .bn-btn { padding:8px 16px; font-weight:600; border-radius:9px; border:1px solid var(--bn); background:rgba(255,255,255,.06); color:#fff; cursor:pointer; flex:none; }
  .bn-btn:hover:not(:disabled) { background:rgba(255,255,255,.14); }
  .bn-ft { display:flex; flex-wrap:wrap; gap:6px 22px; align-items:center; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,.07); font-size:12px; color:#8a8a9c; }
  .bn-auto { cursor:pointer; }
  .bn-link { background:none; border:0; color:#7ab8ff; cursor:pointer; padding:0 2px; font-size:12px; text-decoration:underline; }
  @media (prefers-reduced-motion:reduce) { .bn-dot { animation:none } }
</style>
</head>
<body>
  <h1><img src="/logo.svg" alt="" style="width:26px;height:26px;vertical-align:-6px;margin-right:8px">ScapeLite <a href="http://localhost:9222/" target="_blank" class="devtools-link">DevTools &#8599;</a> <a href="/marketplace" class="devtools-link">Plugins &#9656;</a> <a href="/site/" id="siteLink" class="devtools-link" target="_blank" rel="noopener" data-site="1">Website &#8599;</a></h1>
  <div id="game" style="margin:6px 0"></div>
  <div id="upd" style="display:none;margin:6px 0"></div>
  <div class="sub" id="updated">loading... <button id="clockFmtBtn" class="clock-fmt-btn"></button></div>
  <div class="ctl" id="ctl"></div>
  <div class="grid" id="cards"></div>
  <details class="plugbox" id="plugBox">
    <summary><span>Plugins</span><span class="cnt" id="plugCount"></span></summary>
    <div class="plugins" id="plugins"></div>
  </details>
  <h3 class="section">Logs</h3>
  <div class="tabs" id="tabs"></div>
  <div class="legend" id="legend"></div>
  <div id="logArea"></div>
  <div class="toast" id="toast"></div>
<script>
function fmtAgo(ts) {
  if (!ts) return 'never';
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return 'in ' + Math.abs(s) + 's';
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm ago';
}
function dot(ok) { return '<span class="dot ' + (ok === true ? 'ok' : ok === false ? 'bad' : 'warn') + '"></span>'; }
function esc(l) { return String(l).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

var use24h = true;
try { use24h = localStorage.getItem('cc-status-clock-24h') !== '0'; } catch (e) {}
function formatClock(date) { return use24h ? date.toLocaleTimeString(undefined, { hour12: false }) : date.toLocaleTimeString(undefined, { hour12: true }); }
function refreshClockFmtBtn() { document.getElementById('clockFmtBtn').textContent = use24h ? '24h' : '12h'; }
refreshClockFmtBtn();
document.getElementById('clockFmtBtn').addEventListener('click', function () {
  use24h = !use24h;
  try { localStorage.setItem('cc-status-clock-24h', use24h ? '1' : '0'); } catch (e) {}
  refreshClockFmtBtn(); refresh();
});

var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
function post(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cc-control': '1' }, body: JSON.stringify(body || {}) })
    .then(function (r) { return r.json(); });
}

var logTab = 'all';
try { logTab = localStorage.getItem('cc-status-logtab') || 'all'; } catch (e) {}
var last = null;

function renderCtl(d) {
  var sup = d.supervisor || { managed: false };
  var el = document.getElementById('ctl');
  if (!sup.managed) {
    el.innerHTML = '<span class="state">' + dot(null) + 'Standalone watcher</span>' +
      '<span class="meta">Start via overlay\\\\start-watcher-hidden.vbs (supervisor) to get Stop / Start / Restart here.</span>';
    return;
  }
  var st = sup.state;
  var col = st === 'running' ? true : st === 'stopped' ? false : null;
  var label = { running: 'Running', stopped: 'Stopped', starting: 'Starting\\u2026', stopping: 'Stopping\\u2026' }[st] || st;
  var busy = st === 'starting' || st === 'stopping';
  el.innerHTML = '<span class="state">' + dot(col) + 'Watcher: ' + label + '</span>' +
    '<button class="start" id="bStart"' + (st !== 'stopped' ? ' disabled' : '') + '>Start</button>' +
    '<button class="stop" id="bStop"' + (st !== 'running' ? ' disabled' : '') + '>Stop</button>' +
    '<button id="bRestart"' + (busy ? ' disabled' : '') + '>Restart</button>' +
    '<span class="meta">' + (sup.pid ? 'pid ' + sup.pid + ' \\u00b7 ' : '') + (st === 'running' ? 'up ' + fmtAgo(sup.startedAt).replace(' ago', '') : '') +
    (sup.lastExit ? ' \\u00b7 last exit ' + (sup.lastExit.code != null ? 'code ' + sup.lastExit.code : sup.lastExit.signal) + ' ' + fmtAgo(sup.lastExit.at) : '') +
    (sup.restarts ? ' \\u00b7 auto-restarts: ' + sup.restarts : '') + '</span>';
  [['bStart', 'start'], ['bStop', 'stop'], ['bRestart', 'restart']].forEach(function (p) {
    var b = document.getElementById(p[0]);
    if (b) b.onclick = function () {
      b.disabled = true;
      post('/api/watcher/' + p[1]).then(function (r) { toast(r.ok ? 'Watcher: ' + p[1] : (r.error || 'failed')); refresh(); })
        .catch(function () { toast('Request failed'); });
    };
  });
}

var plugBox = document.getElementById('plugBox');
try { plugBox.open = localStorage.getItem('cc-status-plugins-open') === '1'; } catch (e) {}
plugBox.addEventListener('toggle', function () { try { localStorage.setItem('cc-status-plugins-open', plugBox.open ? '1' : '0'); } catch (e) {} });

function renderPlugins(d) {
  var el = document.getElementById('plugins');
  var raw = d.plugins || [];
  // Same grouping as the marketplace: all always-on essentials appear as ONE "ScapeLite Core" entry.
  var coreParts = raw.filter(function (p) { return p.core; });
  var list = raw.filter(function (p) { return !p.core; });
  if (coreParts.length) list.unshift({ id: 'core', label: 'ScapeLite Core', core: true, enabled: true, loaded: coreParts.every(function (p) { return p.loaded; }), desc: 'Always on: ' + coreParts.map(function (p) { return p.label; }).join(', ') });
  var on = list.filter(function (p) { return p.enabled; }).length;
  document.getElementById('plugCount').textContent = list.length ? on + ' of ' + list.length + ' enabled' : 'watcher not running';
  el.innerHTML = list.map(function (p) {
    return '<div class="plug" title="' + esc(p.desc || '') + '"><div class="n">' + dot(p.enabled ? (p.loaded ? true : null) : false) + esc(p.label) + (p.core ? '<span class="d">core</span>' : '') + '</div>' +
      '<div class="sw' + (p.enabled ? ' on' : '') + (p.core ? ' locked' : '') + '" data-id="' + esc(p.id) + '" title="' + (p.core ? 'Required' : (p.enabled ? 'Click to disable' : 'Click to enable')) + '"></div></div>';
  }).join('') || '<div class="d" style="padding:6px 0">No plugin info yet (watcher not running?)</div>';
  el.querySelectorAll('.sw').forEach(function (sw) {
    if (sw.classList.contains('locked')) return;
    sw.onclick = function () {
      var id = sw.getAttribute('data-id'), on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      post('/api/plugin', { id: id, enabled: on }).then(function (r) {
        toast(r.ok ? (id + (on ? ' enabled' : ' disabled') + (r.applied ? '' : ' (applies when the game connects)')) : (r.error || 'failed'));
        refresh();
      }).catch(function () { toast('Request failed'); refresh(); });
    };
  });
}

var logMode = 'split'; // side by side by default; 'tabs' = one pane with All / Discord / System tabs
try { logMode = localStorage.getItem('cc-status-logmode') || 'split'; } catch (e) {}

var SUB_LABEL = { relay: 'Chat relay', hiscores: 'Hi-scores', raid: 'Raid', digest: 'Digest', plugin: 'Plugin', connection: 'Connection', config: 'Config', supervisor: 'Supervisor', error: 'Error' };
function logLines(logs, filter) {
  return logs.filter(filter).map(function (l) {
    var fam = l.cat === 'discord' ? 'discord' : 'system';
    var sub = l.sub || (fam === 'discord' ? 'relay' : 'config');
    var cls = 'f-' + fam + (/ERROR/.test(l.text) ? ' err' : /duplicate/.test(l.text) ? ' dup' : '');
    return '<div class="line ' + cls + '"><span class="ts">' + formatClock(new Date(l.t)) + '</span>' +
      '<span class="chip s-' + sub + '">' + (SUB_LABEL[sub] || sub) + '</span>' + esc(l.text) + '</div>';
  }).join('');
}
function legendHtml() {
  function g(title, subs) { return '<span class="grp"><b>' + title + '</b>' + subs.map(function (s) { return '<span class="chip s-' + s + '">' + SUB_LABEL[s] + '</span>'; }).join('') + '</span>'; }
  return g('Discord', ['relay', 'hiscores', 'raid', 'digest']) + g('System', ['plugin', 'connection', 'config', 'supervisor', 'error']);
}
// Re-render a scrollable log box without losing the scroll position (stick to
// the bottom only if it was already there).
function fillLog(el, html) {
  var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  var top = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = atBottom ? el.scrollHeight : top;
}

function renderLogs(d) {
  var logs = d.recentLog || [];
  var nDiscord = 0, nSystem = 0;
  logs.forEach(function (l) { if (l.cat === 'discord') nDiscord++; else nSystem++; });
  var tabs = document.getElementById('tabs');
  var area = document.getElementById('logArea');
  var isDiscord = function (l) { return l.cat === 'discord'; };
  var isSystem = function (l) { return l.cat !== 'discord'; };

  var head = '<span class="tab' + (logMode === 'split' ? ' sel' : '') + '" data-m="split">Side by side</span>' +
    '<span class="tab' + (logMode === 'tabs' ? ' sel' : '') + '" data-m="tabs">Tabs</span>';
  if (logMode === 'tabs') {
    head += '<span class="sp"></span>' + [['all', 'All', logs.length], ['discord', 'Discord', nDiscord], ['system', 'System', nSystem]].map(function (t) {
      return '<span class="tab' + (logTab === t[0] ? ' sel' : '') + '" data-t="' + t[0] + '">' + t[1] + '<span class="c">' + t[2] + '</span></span>';
    }).join('');
  }
  tabs.innerHTML = head;
  document.getElementById('legend').innerHTML = legendHtml();
  tabs.querySelectorAll('[data-m]').forEach(function (t) {
    t.onclick = function () { logMode = t.getAttribute('data-m'); try { localStorage.setItem('cc-status-logmode', logMode); } catch (e) {} area.innerHTML = ''; renderLogs(last); };
  });
  tabs.querySelectorAll('[data-t]').forEach(function (t) {
    t.onclick = function () { logTab = t.getAttribute('data-t'); try { localStorage.setItem('cc-status-logtab', logTab); } catch (e) {} renderLogs(last); };
  });

  if (logMode === 'split') {
    if (!document.getElementById('logD')) {
      area.innerHTML = '<div class="split">' +
        '<div class="pane"><h4>Discord<span class="c" id="cntD"></span></h4><div class="log" id="logD"></div></div>' +
        '<div class="pane"><h4>System<span class="c" id="cntS"></span></h4><div class="log" id="logS"></div></div></div>';
    }
    document.getElementById('cntD').textContent = nDiscord;
    document.getElementById('cntS').textContent = nSystem;
    fillLog(document.getElementById('logD'), logLines(logs, isDiscord) || '<div class="line f-discord dup">Nothing sent to Discord yet.</div>');
    fillLog(document.getElementById('logS'), logLines(logs, isSystem));
  } else {
    if (!document.getElementById('logOne')) area.innerHTML = '<div class="log" id="logOne"></div>';
    var filter = logTab === 'discord' ? isDiscord : logTab === 'system' ? isSystem : function () { return true; };
    fillLog(document.getElementById('logOne'), logLines(logs, filter));
  }
}

function refresh() {
  return fetch('/status').then(function (r) { return r.json(); }).then(function (data) {
    last = data;
    document.getElementById('updated').firstChild.textContent = 'Last updated ' + formatClock(new Date()) + ' ';
    renderCtl(data);

    var cards = [];
    var cdp = data.cdp || {};
    cards.push('<div class="card"><h2>Connection</h2>' +
      '<div class="row"><span class="k">' + dot(cdp.connected) + 'Game (CDP)</span><span class="v">' + (cdp.connected ? 'Connected' : 'Not connected') + '</span></div>' +
      '<div class="row"><span class="k">Since</span><span class="v">' + fmtAgo(cdp.since) + '</span></div>' +
      '<div class="row"><span class="k">Watcher uptime</span><span class="v">' + fmtAgo(data.startedAt) + '</span></div></div>');
    var cr = data.chatRelay;
    cards.push('<div class="card"><h2>Chat relay</h2>' +
      '<div class="row"><span class="k">' + dot(cr.configured) + 'Configured</span><span class="v">' + (cr.configured ? 'Yes' : 'No') + '</span></div>' +
      '<div class="row"><span class="k">Last event</span><span class="v">' + fmtAgo(cr.lastEventAt) + '</span></div>' +
      '<div class="row"><span class="k">Relayed this session</span><span class="v">' + cr.totalRelayed + '</span></div>' +
      '<div class="row"><span class="k">Duplicates skipped</span><span class="v">' + cr.totalSkipped + '</span></div></div>');
    var hc = data.clanHiscores;
    var hcStatus = !hc.configured ? 'Not configured' : hc.wsHookReady ? 'Active' : 'Waiting for game reload';
    cards.push('<div class="card"><h2>Clan hiscores</h2>' +
      '<div class="row"><span class="k">' + dot(!hc.configured ? null : hc.wsHookReady) + 'Status</span><span class="v">' + hcStatus + '</span></div>' +
      '<div class="row"><span class="k">Last poll</span><span class="v">' + fmtAgo(hc.lastPollAt) + '</span></div>' +
      '<div class="row"><span class="k">Clan rank</span><span class="v">' + (hc.lastClanRank != null ? '#' + hc.lastClanRank : '--') + '</span></div>' +
      '<div class="row"><span class="k">Next poll</span><span class="v">' + (hc.nextPollAt ? fmtAgo(hc.nextPollAt) : '--') + '</span></div></div>');
    var rs = data.raidSummary;
    cards.push('<div class="card"><h2>Raid summary</h2>' +
      '<div class="row"><span class="k">' + dot(rs.configured) + 'Configured</span><span class="v">' + (rs.configured ? 'Yes' : 'No') + '</span></div>' +
      '<div class="row"><span class="k">Last posted</span><span class="v">' + fmtAgo(rs.lastPostAt) + '</span></div>' +
      '<div class="row"><span class="k">Posted this session</span><span class="v">' + rs.totalPosted + '</span></div>' +
      '<div class="row"><span class="k">Solo runs skipped</span><span class="v">' + rs.totalSkippedSolo + '</span></div></div>');
    var dg = data.digest;
    cards.push('<div class="card"><h2>Activity digest</h2>' +
      '<div class="row"><span class="k">' + dot(dg.configured) + 'Configured</span><span class="v">' + (dg.configured ? 'Yes' : 'No') + '</span></div>' +
      '<div class="row"><span class="k">Last posted</span><span class="v">' + fmtAgo(dg.lastPostAt) + '</span></div>' +
      '<div class="row"><span class="k">Next post</span><span class="v">' + (dg.nextPostAt ? fmtAgo(dg.nextPostAt) : '--') + '</span></div>' +
      '<div class="row"><span class="k">Posted this session</span><span class="v">' + dg.totalPosted + '</span></div></div>');
    document.getElementById('cards').innerHTML = cards.join('');
    renderPlugins(data);
    renderLogs(data);
  }).catch(function () {
    document.getElementById('updated').textContent = 'Could not reach the dashboard server -- is the supervisor / watcher running?';
  });
}
refresh();
setInterval(refresh, 3000);
</script>
<script>
(function(){var box=document.getElementById('game');function post(u){return fetch(u,{method:'POST',headers:{'content-type':'application/json','x-cc-control':'1'},body:'{}'}).then(function(r){return r.json()})}
function post2(u,b){return fetch(u,{method:'POST',headers:{'content-type':'application/json','x-cc-control':'1'},body:JSON.stringify(b)}).then(function(r){return r.json()})}
var busy=false,gdata=null;function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function show(g){var st=g.state,T={ready:['Scapewatch is running','Connected to ScapeLite'],stopped:['Scapewatch is not running','Start it from here so ScapeLite can connect'],'needs-restart':['Scapewatch is running without ScapeLite','Restart it so ScapeLite can connect'],'no-game':['Scapewatch was not found','ScapeLite looked in your Steam libraries']}[st]||[st,''];
box.innerHTML='';box.className='banner '+(st==='ready'?'ok':st==='no-game'?'bad':'warn');box.style.cssText='';
var top=el('div','bn-top');top.appendChild(el('span','bn-dot'));var tx=el('div','bn-tx');tx.appendChild(el('div','bn-h',T[0]));tx.appendChild(el('div','bn-s',T[1]));top.appendChild(tx);
if(st==='stopped'||st==='needs-restart'){var b=el('button','bn-btn',st==='stopped'?'Launch Scapewatch':'Restart game with ScapeLite');b.disabled=busy;b.onclick=function(){busy=true;b.disabled=true;b.textContent='Starting\u2026 (can take a minute)';post(st==='stopped'?'/api/game/launch':'/api/game/restart').then(function(r){busy=false;load();if(r&&r.error)alert(r.error)}).catch(function(){busy=false;load()})};top.appendChild(b)}
box.appendChild(top);
var ft=el('div','bn-ft');var lab=el('label','bn-auto');var cb=document.createElement('input');cb.type='checkbox';cb.checked=!!g.auto;cb.onchange=function(){post2('/api/game/auto',{enabled:cb.checked}).then(load)};lab.appendChild(cb);lab.appendChild(document.createTextNode(' Fix it automatically when the game starts without ScapeLite'));ft.appendChild(lab);
if(gdata){var gd=el('span','bn-gd','Game data: '+(gdata.message||gdata.phase)+(gdata.error?' ('+gdata.error+')':'')+' ');var rb=el('button','bn-link','Refresh');rb.onclick=function(){rb.disabled=true;rb.textContent='Reading\u2026';post('/api/gamedata/refresh').then(function(){load()})};gd.appendChild(rb);ft.appendChild(gd)}
box.appendChild(ft)}
function load(){fetch('/api/gamedata').then(function(r){return r.json()}).then(function(d){gdata=d}).catch(function(){}).then(function(){return fetch('/api/game')}).then(function(r){return r.json()}).then(show).catch(function(){})}load();setInterval(function(){if(!busy)load()},6000)})();
(function(){fetch('/api/site').then(function(r){return r.json()}).then(function(d){var a=document.getElementById('siteLink');if(a&&d.url)a.href=d.url}).catch(function(){})})();
(function(){fetch('/status').then(function(r){return r.json()}).then(function(d){document.querySelectorAll('.devtools-link[target]:not([data-site])').forEach(function(a){a.style.display=d.devMode?'':'none'})}).catch(function(){});})();
(function(){var box=document.getElementById('upd');function post(u){return fetch(u,{method:'POST',headers:{'content-type':'application/json','x-cc-control':'1'},body:'{}'}).then(function(r){return r.json()})}
function show(u){if(!u)return;var avail=u.behind>0,txt='ScapeLite v'+u.version+' · '+(u.error?u.error:u.message||'');box.style.display='block';box.style.cssText='display:block;margin:4px 0 6px;font-size:12.5px;color:#9a9aa6;'+(avail?'padding:6px 10px;border-radius:8px;border:1px solid #b8962f;background:rgba(255,210,74,.08);color:#e8e8f0;font-size:13px':'padding:0 4px');box.innerHTML='';var s=document.createElement('span');s.textContent=txt;box.appendChild(s);var b=document.createElement('button');b.textContent='Check for updates';b.style.marginLeft='10px';b.onclick=function(){b.disabled=true;post('/api/update/check').then(show)};box.appendChild(b);if(avail&&u.canApply){var a=document.createElement('button');a.textContent='Update now';a.style.marginLeft='6px';a.onclick=function(){a.disabled=true;post('/api/update/apply').then(show)};box.appendChild(a)}if(avail&&u.downloadUrl){var l=document.createElement('a');l.href=u.downloadUrl;l.target='_blank';l.textContent='Download';l.style.marginLeft='10px';box.appendChild(l)}}
function load(){fetch('/api/update').then(function(r){return r.json()}).then(show).catch(function(){})}load();setInterval(load,15000)})();
</script>
</body>
</html>`;

// CORS: the in-game status indicator (status-indicator.js, page-side, origin
// https://play.scapewatch.com) fetches /status from the game window. Scoped
// to that one real caller; the control POSTs are NOT cross-origin callable.
const ALLOWED_ORIGIN = 'https://play.scapewatch.com';

// Hosts this dashboard legitimately answers to (DNS-rebinding guard) and the
// only origins allowed to use the control endpoints (CSRF guard).
const ALLOWED_HOSTS = new Set([
  'scapelite.localhost', 'scapewatch-dashboard.localhost', 'localhost', '127.0.0.1',
  'localhost:7777', '127.0.0.1:7777', 'scapelite.localhost:7777', 'scapewatch-dashboard.localhost:7777',
]);
function hostOk(req) { return ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase()); }
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // same-origin navigations / curl send none
  try { const u = new URL(o); return u.protocol === 'http:' && ALLOWED_HOSTS.has(u.host.toLowerCase()); } catch (e) { return false; }
}

// ---- Plugin marketplace data (catalog.json + drop-in plugins/<id>/plugin.json) ----
const P = require('./paths');
const updater = require('./updater');
const launcher = require('./launcher');
const gamedata = require('./gamedata');
const pluginInstall = require('./plugin-install');
const docsPage = require('./docs-page');
const fsx = require('fs');
const pathx = require('path');
const CATALOG_PATH = pathx.join(__dirname, 'catalog.json');
const EXT_DIR = P.plugins;
const IMG_DIR = pathx.join(__dirname, 'catalog-img');
function readCatalog(status) {
  let cat = { categories: [], plugins: [] };
  try { cat = JSON.parse(fsx.readFileSync(CATALOG_PATH, 'utf8')); } catch (e) { /* missing catalog -> empty */ }
  const plugins = (cat.plugins || []).slice();
  try {
    fsx.readdirSync(EXT_DIR, { withFileTypes: true }).forEach((d) => {
      if (!d.isDirectory()) return;
      try {
        const m = JSON.parse(fsx.readFileSync(pathx.join(EXT_DIR, d.name, 'plugin.json'), 'utf8'));
        if (m && m.id && !plugins.some((p) => p.id === m.id)) plugins.push(Object.assign({ category: 'Community', tagline: m.description || '', description: m.description || '', features: [], tags: [], author: 'community', default: false }, m, { community: true }));
      } catch (e) { /* skip broken manifest */ }
    });
  } catch (e) { /* no plugins dir */ }
  const live = new Map(((status && status.plugins) || []).map((p) => [p.id, p]));
  let disabled = null;
  try { disabled = new Set(JSON.parse(fsx.readFileSync(P.state('plugins-config.json'), 'utf8')).disabled || []); } catch (e) { disabled = null; }
  const categories = (cat.categories || []).slice();
  plugins.forEach((p) => { if (p.category && !categories.includes(p.category)) categories.push(p.category); });
  return {
    categories,
    authors: require('./authors').loadAuthors(),
    plugins: plugins.map((p) => {
      const l = live.get(p.id);
      const enabled = p.core ? true : l ? !!l.enabled : disabled ? !disabled.has(p.id) : p.default !== false;
      const loaded = p.includes ? p.includes.every((id) => { const q = live.get(id); return !!(q && q.loaded); }) : !!(l && l.loaded);
      return Object.assign({}, p, { enabled, loaded });
    }),
  };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limit) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

async function handleRequest(getStatus, control, req, res) {
  if (!hostOk(req)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden host'); return; }
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && url === '/status') {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    let dev = false; try { dev = !!JSON.parse(fsx.readFileSync(P.state('local-config.json'), 'utf8')).devMode; } catch (e) { /* no local config: release mode */ }
    sendJson(res, 200, Object.assign({}, getStatus(), { update: updater.snapshot(), devMode: dev }));
    return;
  }
  if (req.method === 'GET' && (url === '/logo.svg' || url === '/logo-lockup.svg')) {
    try { const buf = fsx.readFileSync(pathx.join(__dirname, '..', 'branding', url.slice(1))); res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=300' }); res.end(buf); }
    catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  // The ScapeLite website, served locally (the same files as the public site). `website` in app-info.json (once the public
  // address exists) makes the dashboard link there instead.
  if (req.method === 'GET' && (url === '/site' || url.startsWith('/site/'))) {
    if (url === '/site') { res.writeHead(302, { location: '/site/' }); res.end(); return; }
    const rel = decodeURIComponent(url.slice(6)) || 'index.html';
    const SITE = pathx.join(__dirname, '..', 'website');
    const file = pathx.normalize(pathx.join(SITE, rel.endsWith('/') ? rel + 'index.html' : rel));
    const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
    const ct = T[pathx.extname(file).toLowerCase()];
    try { if (!ct || !file.startsWith(SITE + pathx.sep)) throw new Error('no'); const buf = fsx.readFileSync(file); res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-cache' }); res.end(buf); } catch (e) { res.writeHead(404); res.end('Not found'); }
    return;
  }
  if (req.method === 'GET' && url === '/api/site') { let w = ''; try { w = JSON.parse(fsx.readFileSync(pathx.join(__dirname, 'app-info.json'), 'utf8')).website || ''; } catch (e) { /* none */ } sendJson(res, 200, { url: /^https:[/][/]/.test(w) ? w : '/site/' }); return; }
  if (req.method === 'GET' && url === '/api/community') { sendJson(res, 200, pluginInstall.community()); return; }
  if (req.method === 'GET' && (url.startsWith('/docs/') || url === '/guide')) {
    const html = docsPage.page(url === '/guide' ? 'plugin-author-guide' : url.slice(6).replace(/\/$/, ''));
    if (html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); } else { res.writeHead(404); res.end('Not found'); }
    return;
  }
  if (req.method === 'GET' && url === '/api/gamedata') { sendJson(res, 200, gamedata.snapshot()); return; }
  if (req.method === 'GET' && url === '/api/game') { sendJson(res, 200, Object.assign(await launcher.status(), { auto: launcher.config().autoRelaunch })); return; }
  if (req.method === 'GET' && url === '/api/update') { sendJson(res, 200, updater.snapshot()); return; }
  if (req.method === 'GET' && url === '/api/catalog') { sendJson(res, 200, readCatalog(getStatus())); return; }
  if (req.method === 'GET' && (url === '/marketplace' || url === '/plugins')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(require('./marketplace-page'));
    return;
  }
  if (req.method === 'GET' && url.startsWith('/catalog-img/')) {
    const f = pathx.basename(decodeURIComponent(url.slice('/catalog-img/'.length)));
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    const ct = types[pathx.extname(f).toLowerCase()];
    try { if (!ct) throw new Error('type'); const buf = fsx.readFileSync(pathx.join(IMG_DIR, f)); res.writeHead(200, { 'content-type': ct, 'cache-control': 'max-age=60' }); res.end(buf); }
    catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (req.method === 'POST' && url.startsWith('/api/')) {
    if (!originOk(req) || req.headers['x-cc-control'] !== '1') { sendJson(res, 403, { ok: false, error: 'forbidden' }); return; }
    const body = await readBody(req, 4096);
    if (body === null) { sendJson(res, 400, { ok: false, error: 'bad body' }); return; }
    try {
      if (url === '/api/plugins/preview') { try { sendJson(res, 200, await pluginInstall.preview(body.url)); } catch (e) { sendJson(res, 200, { ok: false, error: String(e.message || e) }); } return; }
      if (url === '/api/plugins/install') { try { const r = await pluginInstall.install(body.url); if (control && control.watcher) await control.watcher.restart(); sendJson(res, 200, r); } catch (e) { sendJson(res, 200, { ok: false, error: String(e.message || e) }); } return; }
      if (url === '/api/plugins/remove') { try { const r = pluginInstall.remove(body.id); if (control && control.watcher) await control.watcher.restart(); sendJson(res, 200, r); } catch (e) { sendJson(res, 200, { ok: false, error: String(e.message || e) }); } return; }
      if (url === '/api/plugins/open-folder') { sendJson(res, 200, pluginInstall.openFolder()); return; }
      if (url === '/api/gamedata/refresh') { const r = await gamedata.ensure(null, true); sendJson(res, 200, Object.assign({}, gamedata.snapshot(), { result: r })); return; }
      if (url === '/api/game/auto') { sendJson(res, 200, { ok: true, auto: launcher.setAuto(!!body.enabled).autoRelaunch }); return; }
      if (url === '/api/game/launch') { sendJson(res, 200, await launcher.launch()); return; }
      if (url === '/api/game/restart') { sendJson(res, 200, await launcher.restart()); return; }
      if (url === '/api/update/check') { await updater.check(); sendJson(res, 200, updater.snapshot()); return; }
      if (url === '/api/update/apply') { await updater.apply(); sendJson(res, 200, updater.snapshot()); return; }
      if (url === '/api/plugin' && control && control.plugin) {
        if (typeof body.id !== 'string' || typeof body.enabled !== 'boolean') { sendJson(res, 400, { ok: false, error: 'bad args' }); return; }
        sendJson(res, 200, await control.plugin(body.id, body.enabled));
        return;
      }
      const m = url.match(/^\/api\/watcher\/(start|stop|restart)$/);
      if (m && control && control.watcher) { sendJson(res, 200, await control.watcher[m[1]]()); return; }
    } catch (e) { sendJson(res, 500, { ok: false, error: String(e && e.message || e) }); return; }
    sendJson(res, 404, { ok: false, error: 'not available' });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

// Also listens on port 80, best-effort, alongside the usual `port` (7777) --
// lets http://scapelite.localhost/ work with no port number
// (`*.localhost` resolves to loopback in Chromium with no setup). Port 80 is a
// courtesy: if something else holds it the failure is logged and ignored, and
// `port` stays authoritative.
function startStatusServer(port, getStatus, control) {
  updater.start();
  const handler = (req, res) => { handleRequest(getStatus, control, req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) {} }); };
  const primary = http.createServer(handler);
  primary.on('error', (e) => { console.error('[status-server] failed to start on port ' + port + ':', e.message); });
  primary.listen(port, '127.0.0.1');
  const port80 = http.createServer(handler);
  port80.on('error', (e) => {
    console.log('[status-server] port 80 not available (' + e.code + ') -- port-less URL won\'t work, falling back to :' + port + ' only.');
  });
  port80.listen(80, '127.0.0.1');
  return { primary, port80 };
}

module.exports = { startStatusServer };
