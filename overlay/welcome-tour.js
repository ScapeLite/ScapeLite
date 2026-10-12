// ScapeLite welcome tour. DISPLAY-ONLY: a short first-run popup that explains where the plugin settings are,
// what the status light / dashboard do, and how the plugin marketplace works. Shown once (remembered in
// localStorage); can be reopened from Settings > Plugins > "Show Welcome Tour" or window.__ccWelcome.open().
(function () {
  'use strict';
  const NS = '__ccWelcome';
  const LS_SEEN = 'cc-welcome-seen';
  const VERSION = '1';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const DASH = 'http://scapelite.localhost/';
  const MARKET = DASH + 'marketplace';
  const FALLBACK = 'http://localhost:7777/';
  const setting = (k, d) => { try { const s = window.__ccPluginSettings; const v = s && s.get ? s.get(k) : undefined; return v === undefined ? d : v; } catch (e) { return d; } };
  const seen = () => { try { return localStorage.getItem(LS_SEEN) === VERSION; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem(LS_SEEN, VERSION); } catch (e) {} };
  const openUrl = (u) => { try { window.open(u, '_blank'); } catch (e) { /* the copyable text in the step is the fallback */ } };
  // The game shows each panel's hotkey in its side-menu tooltip, e.g. "Settings [P]" -- read it live so a rebinding is honoured.
  function hotkey(tab) {
    const t = document.querySelector('.floating-tab-btn[data-tab="' + tab + '"] .floating-tab-tooltip, .tab-btn[data-tab="' + tab + '"] .tab-tooltip');
    const m = t && (t.textContent || '').match(/\[([^\]]+)\]/);
    return m ? m[1] : '';
  }
  const withKeys = (html) => html.replace(/\{\{hk:([a-z]+)\}\}/g, (_, tab) => { const k = hotkey(tab); return k ? ' <kbd>' + k.replace(/[<>&]/g, '') + '</kbd>' : ''; });

  // First-launch setup (also reachable from Settings > Plugins > ScapeLite Core > Play style setup): a few preference questions whose
  // answers pick sensible defaults. Everything stays editable in the Plugins settings afterwards.
  const LS_SETUP = 'cc-setup';
  const SETUP = {
    title: 'How do you play?',
    body: '<p>A few quick questions so ScapeLite\u2019s advice fits you. Every answer can be changed later in <b>Settings \u2192 Plugins</b>.</p>',
    ask: [
      { id: 'style', q: 'Which combat style do you play, or plan to?', opts: [['melee', 'Melee', 'Mine \u2192 Smith'], ['ranged', 'Ranged', 'Forage \u2192 Craft'], ['magic', 'Magic', 'Invoke \u2192 Imbue'], ['none', 'No preference', 'every skill evenly, lowest first']] },
      { id: 'tp', q: 'Teleport crystals for travel?', opts: [['eff', 'Only when it pays', 'saves enough time per charge'], ['foot', 'On foot', 'plan without teleports'], ['max', 'Use them freely', 'fastest possible']] },
      { id: 'combat', q: 'How much should combat XP count against skilling XP when ScapeLite compares plans?', opts: [['25', 'Less', '25%'], ['40', 'Normal', '40%'], ['100', 'Equal', '100%']] },
      { id: 'stats', q: 'Share anonymous usage data that helps us improve ScapeLite?', info: '<b>Sent</b>, at most once a day, to GoatCounter (a free, privacy-friendly counter): the page <i>/active</i>, the ScapeLite version, and, as with every web request, your IP address and browser/OS name. GoatCounter does not store the IP; it only uses it to count unique visitors.<br><b>Never sent</b>: your name, character, account, game progress or data, settings, plugin list, webhooks, or anything you do. No cookies, no ID is saved.<br>Change it any time: Settings → Plugins → ScapeLite Core.', opts: [['yes', 'Yes', 'one anonymous request a day: no name, no data'], ['no', 'No thanks', 'nothing is ever sent']] },
      { id: 'notify', q: 'Windows notifications while the game window is in front?', opts: [['yes', 'Yes', 'still dismissed automatically'], ['no', 'Only when tabbed away', 'the game\u2019s own behaviour']] },
    ],
  };
  const setupDone = () => { try { return !!localStorage.getItem(LS_SETUP); } catch (e) { return false; } };
  const loadAnswers = () => { try { return JSON.parse(localStorage.getItem(LS_SETUP) || '{}') || {}; } catch (e) { return {}; } };
  let answers = {};
  function applySetup() {
    try { localStorage.setItem(LS_SETUP, JSON.stringify(answers)); } catch (e) {}
    const ps = window.__ccPluginSettings;
    const upd = {};
    const prof = ps && ps.prioProfiles;
    if (prof) {
      const name = { melee: 'Melee gear first', ranged: 'Ranged gear first', magic: 'Magic gear first' }[answers.style] || 'Even progress';
      if (prof[name]) upd.routePriorities = Object.assign({}, prof[name]);
    }
    if (answers.combat) upd.routeCombatWeightPct = parseInt(answers.combat, 10);
    if (answers.stats) upd.usageStatsEnabled = answers.stats !== 'no';
    if (answers.notify) upd.osNotifyWhenFocused = answers.notify === 'yes';
    if (ps && ps.seed) ps.seed(upd);
    if (answers.tp) { try { localStorage.setItem('cc-route-tp-pref', answers.tp); } catch (e) {} try { window.__ccRouteAdvisor && window.__ccRouteAdvisor.setTpPref && window.__ccRouteAdvisor.setTpPref(answers.tp); } catch (e) {} }
    try { window.__ccRouteAdvisor && window.__ccRouteAdvisor.recompute && window.__ccRouteAdvisor.recompute(); } catch (e) {}
  }
  const STEPS = [
    {
      title: 'Welcome to ScapeLite',
      body: '<p>ScapeLite adds optional <b>plugins</b> to Scapewatch: better panels, route advice, extra tooltips, notifications and more.</p>' +
        '<p>Everything is <b>display-only</b>. It shows you things and tidies the interface, but never plays or clicks for you.</p>' +
        '<p>This short tour shows you where everything lives. It takes about a minute.</p>',
    },
    {
      title: 'Plugin settings',
      body: '<p>Open the game’s <b>Settings</b>{{hk:settings}}, then the <b>Plugins</b> tab (last button in the Settings header).</p>' +
        '<p>Every feature has its own switch and options there. Hover any category in the Settings header (Build, Display, … Plugins) to <b>jump straight to its sub-sections</b>.</p>' +
        '<p>Webhook URLs and other secrets have an <b>eye</b> button to reveal them; they are stored locally only.</p>',
    },
    {
      title: 'Status light & dashboard',
      body: '<p>The pulsing light in the <b>bottom-left corner</b> shows ScapeLite’s health (green = good, amber = needs attention, red = broken) with your frame rate underneath.</p>' +
        '<p><b>Hover it</b> for per-service status and a live performance breakdown: how much time the game and each plugin use, so you can spot a slow one.</p>' +
        '<p>The tooltip also has an <b>Open Dashboard</b> button: logs, restart controls and plugin switches.</p>',
      action: ['Open the dashboard', DASH],
      note: DASH,
    },
    {
      title: 'The plugin marketplace',
      body: '<p>Browse every plugin, read what it does and see screenshots in the <b>marketplace</b>:</p>' +
        '<p>Press <b>Add</b> to turn a plugin on (it appears in the game right away, no reload) and <b>Remove</b> to turn it off again. Plugins made by the ScapeLite team carry a <b>ScapeLite</b> tag; community plugins show their author.</p>' +
        '<p>You can open it from the dashboard (<i>Plugins ▸</i>) or directly:</p>',
      action: ['Open the marketplace', MARKET],
      note: MARKET,
    },
    {
      title: 'You’re set',
      body: '<p>That’s it. A few handy things to try first:</p>' +
        '<ul><li>Drag a panel’s corner grip to <b>resize</b> it; right-click its title for lock / size options.</li>' +
        '<li>Put two panels edge to edge and use the <b>link button</b> in their title bars to fuse them.</li>' +
        '<li>Open the <b>Route Advisor</b> to see a faster order for your task queue.</li></ul>' +
        '<p><b>Found a bug?</b> Click the small <b>bug icon</b> under the status light (bottom-left), or use <b>Settings → Plugins → Report a Bug</b>. ScapeLite fixes bugs in its <b>Official plugins</b> only; community plugins are supported by their own authors.</p>' +
        '<p>You can replay this tour any time: <b>Settings</b>{{hk:settings}} <b>→ Plugins → Show Welcome Tour</b>.</p>',
    },
  ];

  const style = document.createElement('style');
  style.id = 'cc-welcome-style';
  style.textContent = `
#cc-welcome{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font:14px/1.5 system-ui,sans-serif}
#cc-welcome[hidden]{display:none!important}
#cc-welcome .w-card{width:min(480px,92vw);background:#16161e;border:1px solid rgba(255,255,255,.18);border-radius:12px;box-shadow:0 14px 50px rgba(0,0,0,.7);color:#dedee8;overflow:hidden;animation:ccWIn .25s ease-out}
@keyframes ccWIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
#cc-welcome .w-head{display:flex;align-items:center;gap:10px;padding:14px 18px 6px}
#cc-welcome .w-logo{width:28px;height:28px;flex:none;line-height:0}
#cc-welcome h2{margin:0;font-size:18px;color:#fff}
#cc-welcome .w-step{margin-left:auto;font-size:12px;color:#8a8a99}
#cc-welcome .w-body{padding:6px 18px 4px;min-height:190px}
#cc-welcome .w-body p{margin:8px 0}#cc-welcome .w-body ul{margin:8px 0;padding-left:20px}#cc-welcome .w-body li{margin:4px 0}
#cc-welcome b{color:#fff}
#cc-welcome kbd{display:inline-block;min-width:18px;padding:0 6px;margin:0 1px;border:1px solid #4a4a5e;border-bottom-width:2px;border-radius:5px;background:#23232f;color:#ffd24a;font:600 12px/18px ui-monospace,Consolas,monospace;text-align:center}
#cc-welcome code{background:#0f0f14;border:1px solid #2a2a38;border-radius:4px;padding:0 5px;font:12px ui-monospace,Consolas,monospace;color:#9ecbff}
#cc-welcome .w-warn{color:#ffb4a8;font-size:13px}
#cc-welcome .w-fb{font-size:11.5px;color:#7f7f8e;margin-top:4px}
#cc-welcome .w-link{display:flex;gap:8px;align-items:center;margin:10px 0 2px}
#cc-welcome .w-url{flex:1;font:12px ui-monospace,Consolas,monospace;color:#9ecbff;background:#0f0f14;border:1px solid #2a2a38;border-radius:6px;padding:5px 8px;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cc-welcome .w-foot{display:flex;align-items:center;gap:8px;padding:12px 18px 16px}
#cc-welcome .w-dots{display:flex;gap:6px;margin-right:auto}
#cc-welcome .w-dot{width:8px;height:8px;border-radius:50%;background:#3a3a4a}#cc-welcome .w-dot.on{background:#ffd24a}
#cc-welcome button{font:inherit;color:#ddd;background:#23232f;border:1px solid #3a3a4a;border-radius:8px;padding:6px 14px;cursor:pointer}
#cc-welcome button:hover{border-color:#8a8aa0}
#cc-welcome button.primary{background:#2c2a18;border-color:#b8962f;color:#ffd24a}
#cc-welcome button.skip{background:transparent;border-color:transparent;color:#8a8a99}
#cc-welcome button.skip:hover{color:#ddd}`;
  const root = document.createElement('div');
  root.id = 'cc-welcome';
  root.hidden = true;
  let step = 0, timer = 0, steps = STEPS, isGuide = false, guideTitle = '';

  function render() {
    const s = steps[step], last = step === steps.length - 1;
    root.textContent = '';
    const card = document.createElement('div'); card.className = 'w-card';
    const head = document.createElement('div'); head.className = 'w-head';
    const logo = document.createElement('div'); logo.className = 'w-logo'; logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="28" height="28"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="24" height="12" fill="#ffd24a"/><rect x="46" y="58" width="36" height="12" fill="#ffd24a"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg>';
    const h = document.createElement('h2'); h.textContent = isGuide ? guideTitle + ' · ' + s.title : s.title;
    const st = document.createElement('span'); st.className = 'w-step'; st.textContent = (step + 1) + ' / ' + steps.length;
    head.append(logo, h, st);
    const body = document.createElement('div'); body.className = 'w-body'; body.innerHTML = withKeys(s.body);   // static, trusted strings above
    if (s.action) {
      const row = document.createElement('div'); row.className = 'w-link';
      const url = document.createElement('div'); url.className = 'w-url'; url.textContent = s.note;
      const go = document.createElement('button'); go.className = 'primary'; go.textContent = s.action[0] + ' ↗';
      go.addEventListener('click', (e) => { e.stopPropagation(); openUrl(s.action[1]); });
      row.append(url, go); body.appendChild(row);
      const fb = document.createElement('div'); fb.className = 'w-fb'; fb.textContent = 'If that address does not open, use ' + FALLBACK; body.appendChild(fb);
    }
    if (s.ask) {
      s.ask.forEach((q) => {
        const wrap = document.createElement('div'); wrap.style.cssText = 'margin:12px 0 4px;';
        const t = document.createElement('div'); t.textContent = q.q; t.style.cssText = 'font-weight:600;color:#fff;margin-bottom:6px;font-size:13.5px;'; wrap.appendChild(t);
        const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
        q.opts.forEach(([v, label, sub]) => {
          const b = document.createElement('button'); b.type = 'button';
          const on = answers[q.id] === v;
          b.style.cssText = 'text-align:left;padding:6px 12px;border-radius:9px;border:1px solid ' + (on ? '#4a90e2' : '#3a3a4a') + ';background:' + (on ? 'rgba(74,144,226,.2)' : '#23232f') + ';color:' + (on ? '#e6f1ff' : '#ddd') + ';';
          b.innerHTML = '<div style="font-size:13px"></div><div style="font-size:11px;color:#8a8a99"></div>';
          b.firstChild.textContent = label; b.lastChild.textContent = sub || '';
          b.addEventListener('click', (e) => { e.stopPropagation(); answers[q.id] = v; render(); });
          row.appendChild(b);
        });
        wrap.appendChild(row);
        if (q.info) { const inf = document.createElement('div'); inf.innerHTML = q.info; inf.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid #3a3a4a;font-size:11.5px;line-height:1.5;color:#b8b8c8;'; wrap.appendChild(inf); }
        body.appendChild(wrap);
      });
    }
    const foot = document.createElement('div'); foot.className = 'w-foot';
    const dots = document.createElement('div'); dots.className = 'w-dots';
    steps.forEach((_, i) => { const d = document.createElement('span'); d.className = 'w-dot' + (i === step ? ' on' : ''); dots.appendChild(d); });
    foot.appendChild(dots);
    if (!last) { const sk = document.createElement('button'); sk.className = 'skip'; sk.textContent = 'Skip'; sk.addEventListener('click', close); foot.appendChild(sk); }
    if (step > 0) { const b = document.createElement('button'); b.textContent = 'Back'; b.addEventListener('click', () => { step--; render(); }); foot.appendChild(b); }
    const nx = document.createElement('button'); nx.className = 'primary'; nx.textContent = last ? (isGuide ? 'Done' : 'Got it') : 'Next';
    if (s.ask) nx.textContent = 'Save';
    nx.addEventListener('click', () => { if (s.ask) applySetup(); if (last) close(); else { step++; render(); } });
    foot.appendChild(nx);
    card.append(head, body, foot);
    root.appendChild(card);
  }
  function openGuide(id) { const g = (window.__CC_GUIDES || {})[id]; if (!g || !g.steps || !g.steps.length) return false; steps = g.steps; isGuide = true; guideTitle = g.title || 'Guide'; step = 0; show(); return true; }
  function show() { if (!document.body) return; if (!document.getElementById('cc-welcome-style')) document.head.appendChild(style); if (!root.isConnected) document.body.appendChild(root); render(); root.hidden = false; }
  function open() { steps = STEPS; isGuide = false; step = 0; if (!document.body) return; if (!document.getElementById('cc-welcome-style')) document.head.appendChild(style); if (!root.isConnected) document.body.appendChild(root); render(); root.hidden = false; }
  function openSetup() { answers = Object.assign({ style: 'none', tp: 'eff', combat: '40', stats: 'yes', notify: 'yes' }, loadAnswers()); steps = [SETUP]; isGuide = true; guideTitle = 'Setup'; step = 0; show(); }
  function close() { root.hidden = true; if (!isGuide) { markSeen(); if (!setupDone() && setting('welcomeTourEnabled', true)) setTimeout(openSetup, 400); } }
  ['mousedown', 'click', 'wheel', 'contextmenu'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));
  const onKey = (e) => { if (!root.hidden && e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  // Auto-show once the game UI is up (logged in), if it has never been shown.
  let tries = 0;
  function maybeAutoShow() {
    if (!setting('welcomeTourEnabled', true)) return;
    if (seen()) { // existing installs: ask the setup questions once
      if (setupDone() || localStorage.getItem('cc-setup-asked')) return;
      if (document.querySelector('.floating-tab-strip') && document.querySelector('.panel-floating')) { timer = setTimeout(() => { if (!setupDone() && root.hidden) { try { localStorage.setItem('cc-setup-asked', '1'); } catch (e) {} openSetup(); } }, 5000); return; }
      if (++tries < 120) timer = setTimeout(maybeAutoShow, 2000);
      return;
    }
    if (document.querySelector('.floating-tab-strip') && document.querySelector('.panel-floating')) { timer = setTimeout(() => { if (!seen()) open(); }, 2500); return; }
    if (++tries < 120) timer = setTimeout(maybeAutoShow, 2000);
  }
  maybeAutoShow();

  function teardown() {
    clearTimeout(timer); document.removeEventListener('keydown', onKey, true);
    root.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc welcome-tour torn down';
  }
  window[NS] = { version: 3, teardown, open, openGuide, openSetup, close, reset() { try { localStorage.removeItem(LS_SEEN); } catch (e) {} } };
  console.log('[cc] welcome-tour loaded');
  return 'cc welcome-tour loaded';
})();
