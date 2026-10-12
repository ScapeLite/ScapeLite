// ScapeLite in-game bug report. Opens a small form with a description box and a diagnostics preview; the report goes to the
// ScapeLite issue tracker (a pre-filled GitHub issue opens in the browser) or can be copied. Nothing is sent by ScapeLite itself,
// and the diagnostics hold no player name, no webhooks and no settings values: only versions and which plugins are on.
// Reachable from: Settings > Plugins > ScapeLite Core > Report a Bug, and the bug icon in the Status Indicator hover menu.
(function () {
  'use strict';
  const NS = '__ccBugReport';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const REPO = 'https://github.com/ScapeLite/ScapeLite';
  const STATUS_URL = 'http://localhost:7777/status';
  const OFFICIAL = window.__CC_OFFICIAL || []; // [{id,name}] injected by the watcher from the catalog (plugins made by the ScapeLite team)

  // Remember the last few page errors so a report can include them.
  const errs = [];
  const onErr = (e) => { errs.push(String((e && (e.message || (e.reason && (e.reason.message || e.reason)))) || 'error').slice(0, 160)); if (errs.length > 8) errs.shift(); };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);

  const style = document.createElement('style');
  style.id = 'cc-bugreport-style';
  style.textContent = `
#cc-bugreport{position:fixed;left:50%;top:9%;transform:translateX(-50%);width:460px;max-width:94vw;max-height:84vh;z-index:2147483100;display:none;flex-direction:column;background:#0f0f14;
  border:1px solid rgba(255,255,255,.18);border-radius:10px;color:#ddd;font:13px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.65);overflow:hidden}
#cc-bugreport.show{display:flex}
#cc-bugreport .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.08);user-select:none}
#cc-bugreport .hd b{flex:1;color:#fff;font-size:14px;font-weight:600}
#cc-bugreport .hd button{background:none;border:0;color:#aaa;font-size:18px;cursor:pointer;line-height:1}
#cc-bugreport .bd{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:9px}
#cc-bugreport .scope{padding:8px 10px;border-radius:8px;background:rgba(255,210,74,.08);border:1px solid #b8962f;color:#e8e0c0;font-size:12.5px}
#cc-bugreport label{font-size:12px;color:#9a9ab0}
#cc-bugreport select,#cc-bugreport textarea{width:100%;box-sizing:border-box;background:#1a1a24;color:#e8e8f0;border:1px solid #3a3a4a;border-radius:6px;padding:7px 8px;font:inherit}
#cc-bugreport textarea{min-height:110px;resize:vertical}
#cc-bugreport pre{margin:0;max-height:120px;overflow:auto;background:#0a0a0f;border:1px solid #2a2a38;border-radius:6px;padding:7px 8px;font:11px/1.4 ui-monospace,Consolas,monospace;color:#9aa;white-space:pre-wrap}
#cc-bugreport .row{display:flex;gap:8px;justify-content:flex-end;align-items:center}
#cc-bugreport .row .note{flex:1;font-size:11.5px;color:#8a8a9a}
#cc-bugreport button.b{background:#2a2a35;color:#e8e8f0;border:1px solid #4a4a5a;border-radius:6px;padding:6px 14px;font:inherit;cursor:pointer}
#cc-bugreport button.b:hover{border-color:#8a8aa0}
#cc-bugreport button.b.p{background:#2f5d3a;border-color:#4f9a62}
`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cc-bugreport';
  root.innerHTML = `<div class="hd"><b>Report a ScapeLite bug</b><button type="button" class="x" title="Close">×</button></div>
<div class="bd">
  <div class="scope"><b>What gets fixed:</b> ScapeLite fixes bugs in its <b>Official plugins</b> (the ones tagged ScapeLite in the marketplace). Community plugins are made by other people: report problems with those to their author, they are not fixed by the ScapeLite team. Bugs in the game itself belong to the game’s developers.</div>
  <div><label>Which plugin is it about?</label><select class="plug"></select></div>
  <div><label>What happened? What did you expect? How can it be repeated?</label><textarea class="desc" placeholder="For example: I opened the Bank and ..."></textarea></div>
  <div><label>Diagnostics added to the report (versions and which plugins are on; no name, no webhooks)</label><pre class="diag">Collecting…</pre></div>
  <div class="row"><span class="note">Needs a free GitHub account. Or copy it and send it however you like.</span><button type="button" class="b copy">Copy report</button><button type="button" class="b p gh">Open on GitHub</button></div>
</div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const sel = q('.plug');
  [['', 'Not sure / the whole thing']].concat(OFFICIAL.map((p) => [p.id, p.name])).concat([['other', 'A community plugin (will not be fixed here)']]).forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
  });

  let diag = '';
  async function collect() {
    const lines = [];
    let ver = '?';
    try { const d = await (await fetch(STATUS_URL)).json(); ver = (d.update && d.update.version) || '?'; } catch (e) {}
    lines.push('ScapeLite: v' + ver);
    lines.push('Browser: ' + ((navigator.userAgent.match(/Chrome\/[\d.]+/) || ['?'])[0]));
    try {
      const all = window.__ccPluginSettings && window.__ccPluginSettings.getAll ? window.__ccPluginSettings.getAll() : {};
      const off = Object.keys(all).filter((k) => /Enabled$/.test(k) && all[k] === false);
      lines.push('Plugins switched off: ' + (off.length ? off.join(', ') : 'none'));
    } catch (e) {}
    lines.push('Loaded: ' + Object.keys(window).filter((k) => /^__cc[A-Z]/.test(k) && window[k] && typeof window[k] === 'object').map((k) => k.slice(4)).sort().join(', '));
    lines.push('Bridge: ' + (window.__ccBridge && window.__ccBridge.ok && window.__ccBridge.ok() ? 'attached' : 'not attached'));
    if (errs.length) lines.push('Recent page errors:\n  ' + errs.join('\n  '));
    diag = lines.join('\n');
    q('.diag').textContent = diag;
  }

  function report() {
    const plug = sel.value, name = sel.options[sel.selectedIndex].textContent;
    const desc = q('.desc').value.trim();
    const title = '[' + (plug ? name : 'Bug') + '] ' + (desc.split('\n')[0] || 'Bug report').slice(0, 70);
    const body = '### What happened\n' + (desc || '(please describe)') + '\n\n### Diagnostics\n```\n' + diag + '\n```\n';
    return { title, body };
  }

  q('.gh').addEventListener('click', () => {
    if (sel.value === 'other') { q('.note').textContent = 'Community plugins are supported by their own authors, not here.'; return; }
    const r = report();
    const url = REPO + '/issues/new?title=' + encodeURIComponent(r.title) + '&body=' + encodeURIComponent(r.body.slice(0, 5500));
    try { window.open(url, '_blank'); } catch (e) {}
  });
  q('.copy').addEventListener('click', () => {
    const r = report(), b = q('.copy');
    navigator.clipboard.writeText(r.title + '\n\n' + r.body).then(() => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy report'; }, 1400); }).catch(() => {});
  });
  const close = () => root.classList.remove('show');
  q('.x').addEventListener('click', close);
  const onKey = (e) => { if (e.key === 'Escape' && root.classList.contains('show')) close(); };
  document.addEventListener('keydown', onKey, true);
  // Keep typing in the box from triggering game hotkeys.
  ['keydown', 'keyup', 'keypress'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));

  function open(pluginId) {
    root.classList.add('show');
    if (pluginId && [...sel.options].some((o) => o.value === pluginId)) sel.value = pluginId;
    collect();
    setTimeout(() => q('.desc').focus(), 50);
  }
  function teardown() {
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
    document.removeEventListener('keydown', onKey, true);
    root.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc bug-report torn down';
  }
  window[NS] = { version: 1, open, close, teardown };
  return 'cc bug-report loaded';
})();
