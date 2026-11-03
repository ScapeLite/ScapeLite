// ScapeLite welcome tour. DISPLAY-ONLY: a short first-run popup. Step 1 is the look chooser (overlay/presets.js picker: Full Vanilla /
// Combination / ScapeLite only); the steps after it adapt to the look picked (what the screen holds, where things are). It then explains where
// the plugin settings are, what the status light / dashboard do, and how the plugin marketplace works. Shown once (remembered in
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
  // The look in force ('vanilla' | 'combo' | 'only' | 'custom'); step text asks for it when it is drawn, so picking a look in step 1 changes the steps after it.
  const look = () => { try { return (window.__ccPresets && window.__ccPresets.currentId()) || 'combo'; } catch (e) { return 'combo'; } };
  const html = (v) => (typeof v === 'function' ? v() : v);
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
      { id: 'uisize', q: 'How big should ScapeLite\u2019s panels be?', slider: [50, 200, 100], info: 'Drag to resize every ScapeLite panel (Route Advisor, XP Tracker, Goals ...) while you watch; it is saved as your default. You can also right-click any panel\u2019s title to size just that one.' },
      { id: 'clock', q: 'Which clock format should ScapeLite use?', opts: [['24', '24-hour', '13:45'], ['12', '12-hour', '1:45 pm']] },
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
    if (answers.clock) upd.clockFormat = answers.clock === '12' ? '12' : '24';
    if (answers.uisize) upd.uiScalePct = Math.max(50, Math.min(200, parseInt(answers.uisize, 10) || 100));
    if (ps && ps.seed) ps.seed(upd);
    if (answers.tp) { try { localStorage.setItem('cc-route-tp-pref', answers.tp); } catch (e) {} try { window.__ccRouteAdvisor && window.__ccRouteAdvisor.setTpPref && window.__ccRouteAdvisor.setTpPref(answers.tp); } catch (e) {} }
    try { window.__ccRouteAdvisor && window.__ccRouteAdvisor.recompute && window.__ccRouteAdvisor.recompute(); } catch (e) {}
  }
  const INTRO = '<p>ScapeLite adds optional <b>plugins</b> to Scapewatch: better panels, route advice, extra tooltips, notifications and more.</p>' +
    '<p>Everything is <b>display-only</b>. It shows you things and tidies the interface, but never plays or clicks for you.</p>';
  const LOOK_BODY = {
    vanilla: () => '<p>The game stays <b>exactly as it is</b>: no Info Bar, no extra menu button, no bell. Use the game’s own side menu and hotkeys{{hk:settings}} as always.</p>' +
      '<p>ScapeLite still does its invisible work (tooltips, logs, alerts to Windows). The <b>status light</b> in the bottom-left stays on screen in every look.</p>' +
      '<p>The Layout Editor opens with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>, and every feature has a switch in <b>Settings → Plugins</b>. Want more later? Settings → Plugins → <b>ScapeLite Look</b>.</p>',
    combo: () => '<p>A thin <b>Info Bar</b> runs along the top: your task, location, XP per hour, gold, a clock and a row of <b>panel buttons</b>. The buttons open the game’s own panels; nothing is hidden.</p>' +
      '<p><b>Right-click</b> the bar to add or remove modules; hover the Task module for the task queue. The game’s side menu stays, and so does the <b>ScapeLite menu</b> (the logo in the left strip).</p>',
    only: () => '<p>The game’s own panels are <b>hidden</b>. Instead you get the Info Bar on top, a bottom bar with chat, panel buttons and your hit points, ScapeLite’s task queue and pinned cards.</p>' +
      '<p>A panel button opens ScapeLite’s card; <b>right-click</b> it to open the game’s original panel beside it. The game’s <b>side menu always stays</b>, so Settings is never out of reach.</p>',
    custom: () => '<p>You have a <b>custom mix</b> of bars, buttons and hidden panels. Nothing was changed by this tour.</p>' +
      '<p><b>Right-click</b> an Info Bar to add or remove modules; every option is in <b>Settings → Plugins</b>. Picking a look in step 1 replaces your mix; Undo puts it back.</p>',
  };
  // an offer, never done for you: the ready-made panel arrangement lives in the Layout Editor
  const LAYOUT_NOTE = '<p><b>Panel layout:</b> want every panel placed for you? Open the Layout Editor (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>) and press <b>ScapeLite default</b>. Nothing moves unless you press it, and <b>Back to my old layout</b> undoes it.</p>';
  const buildSteps = () => {
    const P = window.__ccPresets;
    const hasLooks = !!(P && P.picker);
    const first = hasLooks
      ? { title: 'Welcome to ScapeLite', body: INTRO + '<p><b>First, how should it look?</b> Pick a starting point; it only changes what ScapeLite shows. You can switch any time in Settings → Plugins → ScapeLite Look.</p>', look: true }
      : { title: 'Welcome to ScapeLite', body: INTRO + '<p>This short tour shows you where everything lives. It takes about a minute.</p>' };
    const second = hasLooks ? [{ title: 'Your look', body: () => (LOOK_BODY[look()] || LOOK_BODY.combo)() + LAYOUT_NOTE }] : [];
    return [first].concat(second, STEPS_REST);
  };
  const STEPS_REST = [
    {
      title: 'Plugin settings',
      body: '<p>Open the game’s <b>Settings</b>{{hk:settings}}, then the <b>Plugins</b> tab (last button in the Settings header).</p>' +
        '<p>Every feature has its own switch and options there. Hover any category in the Settings header (Build, Display, … Plugins) to <b>jump straight to its sub-sections</b>.</p>' +
        '<p>Webhook URLs and other secrets have an <b>eye</b> button to reveal them; they are stored locally only.</p>',
    },
    {
      title: 'Status light & dashboard',
      body: '<p>The pulsing light in the <b>bottom-left corner</b> shows ScapeLite’s health (green = good, amber = needs attention, red = broken) with your frame rate underneath. It is always there, whichever look you picked.</p>' +
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


  // What's new: the UI overhaul. Small mock-ups are plain HTML/CSS so the tour needs no pictures.
  const MOCK = 'display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:10px;background:#10101a;border:1px solid #2e2e42;color:#dcdce8;font-size:13px;';
  const UI_STEPS = [
    {
      title: 'A new look, made for you to arrange',
      body: '<p>ScapeLite\u2019s panels have been rebuilt on one shared design, and you can now <b>arrange, restyle and shrink</b> them any way you like.</p>' +
        '<p>This quick tour shows the new pieces. Everything is still <b>display-only</b>: it moves and styles ScapeLite\u2019s own panels, it never plays for you.</p>',
    },
    {
      title: 'The Layout Editor',
      body: () => '<p>Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>L</kbd>' + (look() === 'vanilla' ? '' : ' (or <b>Edit Layout</b> in the ScapeLite menu)') + ' and every panel gets a frame:</p>' +
        '<ul><li><b>Drag</b> it: it snaps to screen edges and other panels (hold <kbd>Shift</kbd> to move freely, arrow keys nudge).</li>' +
        '<li><b>Lock</b> it, make it <b>see-through</b>, <b>fade it</b> when the mouse is away, make it bigger or smaller.</li>' +
        '<li>Save the whole arrangement as a <b>named layout</b> (a raid layout can switch on by itself during raids) and share it as text.</li></ul>',
      run: ['Try it now', () => { try { window.__ccUILayout && window.__ccUILayout.toggle(); } catch (e) { /* editor not loaded */ } }],
    },
    {
      title: 'Compact chips',
      body: '<p>Press the <b>dash</b> in a panel\u2019s title bar and it folds into a small <b>chip</b> that still shows what matters:</p>' +
        '<p><span style="' + MOCK + '"><b style="color:#ffd24a">Goals</b> Fish 48 \u2192 50 \u00B7 41 min</span></p>' +
        '<p><span style="' + MOCK + '"><b style="color:#ffd24a">XP Tracker</b> 20.7k XP/hr</span></p>' +
        '<p>Click a chip to open the full panel again.</p>',
    },
    {
      title: 'Tab groups',
      body: '<p>Too many windows? In the Layout Editor press the <b>group</b> button on a panel and pick another: they share <b>one spot</b>, and a tab strip lets you flip between them.</p>' +
        '<p><span style="' + MOCK + 'padding:3px 8px;"><b style="color:#ffd24a;border-bottom:2px solid #ffd24a">Goals</b><span style="color:#8f8fa4">Drop Luck</span><span style="color:#8f8fa4">Tree Advisor</span></span></p>',
    },
    {
      title: 'Your colours',
      body: '<p>Under <b>Settings \u2192 Plugins \u2192 Panels</b> (and in the editor\u2019s bottom row) you can choose:</p>' +
        '<ul><li><b>Match the game\u2019s theme</b>: panels take the colours of whichever theme the game uses.</li>' +
        '<li>A <b>colour-blind safe</b> palette, your own <b>accent colour</b>, <b>spacing</b> and <b>text size</b>.</li></ul>',
    },
    {
      title: 'Info bars and Alerts',
      not: ['vanilla'],
      body: '<p>The <b>info bars</b> run along the top (and optionally the bottom) of the screen, like Titan Panel: add modules such as your task, location, XP per hour, gold or a clock. <b>Right-click</b> a bar to add or remove modules and set their options, and drag a module to move it. The game fits itself into the space that is left.</p>' +
        '<p>The <b>alert bell</b> always shows a red number when something needs you: unspent tree points, a finished quest, an unopened chest. Hover it for the list; each alert can be dismissed or pointed out to you in the game.</p>',
    },
    {
      title: 'That is the tour',
      body: () => '<p>Everything above lives in ' + (look() === 'vanilla' ? '' : 'the <b>ScapeLite menu</b> (the logo in the left strip) and ') + '<b>Settings \u2192 Plugins \u2192 Panels</b>.</p>' +
        '<p>Replay this tour any time: <b>Settings \u2192 Plugins \u2192 Show UI Tour</b>.</p>',
    },
  ];

  const style = document.createElement('style');
  style.id = 'cc-welcome-style';
  style.textContent = `
#cc-welcome{position:fixed;inset:0;z-index:var(--cc-z-modal,2147482800);display:flex;align-items:center;justify-content:center;background:var(--cc-scrim,rgba(6,6,12,.62));font:var(--cc-fs,14px)/1.5 var(--cc-font,system-ui,sans-serif)}
#cc-welcome[hidden]{display:none!important}
#cc-welcome .w-card{width:min(480px,92vw);background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-radius:var(--cc-r);box-shadow:var(--cc-shadow);color:var(--cc-text);overflow:hidden;animation:cc-pop-in var(--cc-dur-2,.18s) var(--cc-ease-out)}
#cc-welcome .w-head{display:flex;align-items:center;gap:10px;padding:14px 18px 6px}
#cc-welcome .w-logo{width:28px;height:28px;flex:none;line-height:0}
#cc-welcome h2{margin:0;font-size:18px;color:var(--cc-text)}
#cc-welcome .w-step{margin-left:auto;font-size:12px;color:var(--cc-text-dim)}
#cc-welcome .w-body{padding:6px 18px 4px;min-height:190px;color:var(--cc-text-dim)}
#cc-welcome .w-body p{margin:8px 0}#cc-welcome .w-body ul{margin:8px 0;padding-left:20px}#cc-welcome .w-body li{margin:4px 0}
#cc-welcome b{color:var(--cc-text)}
#cc-welcome kbd{display:inline-block;min-width:18px;padding:0 6px;margin:0 1px;border:1px solid var(--cc-border-strong);border-bottom-width:2px;border-radius:5px;background:var(--cc-bg-3);color:var(--cc-accent);font:600 12px/18px ui-monospace,Consolas,monospace}
#cc-welcome code{background:var(--cc-sunk);border:1px solid var(--cc-border);border-radius:4px;padding:0 5px;font:12px ui-monospace,Consolas,monospace;color:var(--cc-info)}
#cc-welcome .w-warn{color:var(--cc-bad);font-size:13px}
#cc-welcome .w-fb{font-size:11.5px;color:var(--cc-text-faint);margin-top:4px}
#cc-welcome .w-link{display:flex;gap:8px;align-items:center;margin:10px 0 2px}
#cc-welcome .w-url{flex:1;font:12px ui-monospace,Consolas,monospace;color:var(--cc-info);background:var(--cc-sunk);border:1px solid var(--cc-border);border-radius:6px;padding:5px 8px;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cc-welcome .w-foot{display:flex;align-items:center;gap:8px;padding:12px 18px 16px}
#cc-welcome .w-dots{margin-right:auto}`;
  const root = document.createElement('div');
  root.id = 'cc-welcome';
  root.hidden = true;
  let step = 0, timer = 0, steps = [], isGuide = false, guideTitle = '', uiOpen = false;

  function render() {
    const s = steps[step], last = step === steps.length - 1;
    root.textContent = '';
    const card = document.createElement('div'); card.className = 'w-card'; if (s.look) card.style.width = 'min(560px,94vw)';
    const head = document.createElement('div'); head.className = 'w-head';
    const logo = document.createElement('div'); logo.className = 'w-logo'; logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="28" height="28"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="24" height="12" fill="#ffd24a"/><rect x="46" y="58" width="36" height="12" fill="#ffd24a"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg>';
    const h = document.createElement('h2'); h.textContent = isGuide ? guideTitle + ' · ' + s.title : s.title;
    const st = document.createElement('span'); st.className = 'w-step'; st.textContent = (step + 1) + ' / ' + steps.length;
    head.append(logo, h, st);
    const body = document.createElement('div'); body.className = 'w-body'; body.innerHTML = withKeys(html(s.body));   // static, trusted strings above
    if (s.look && window.__ccPresets && window.__ccPresets.picker) body.appendChild(window.__ccPresets.picker({ onChange: () => { try { window.__ccPresets.settle(); } catch (e) { /* ignore */ } } }));
    if (s.action) {
      const row = document.createElement('div'); row.className = 'w-link';
      const url = document.createElement('div'); url.className = 'w-url'; url.textContent = s.note;
      const go = document.createElement('button'); go.className = 'cc-btn'; go.dataset.v = 'primary'; go.textContent = s.action[0] + ' ↗';
      go.addEventListener('click', (e) => { e.stopPropagation(); openUrl(s.action[1]); });
      row.append(url, go); body.appendChild(row);
      const fb = document.createElement('div'); fb.className = 'w-fb'; fb.textContent = 'If that address does not open, use ' + FALLBACK; body.appendChild(fb);
    }
    if (s.run) {
      const row2 = document.createElement('div'); row2.className = 'w-link';
      const go2 = document.createElement('button'); go2.className = 'cc-btn'; go2.dataset.v = 'primary'; go2.textContent = s.run[0];
      go2.addEventListener('click', (e) => { e.stopPropagation(); close(); setTimeout(s.run[1], 150); });
      row2.appendChild(go2); body.appendChild(row2);
    }
    if (s.ask) {
      s.ask.forEach((q) => {
        const wrap = document.createElement('div'); wrap.style.cssText = 'margin:12px 0 4px;';
        const t = document.createElement('div'); t.textContent = q.q; t.style.cssText = 'font-weight:600;color:#fff;margin-bottom:6px;font-size:13.5px;'; wrap.appendChild(t);
        const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
        (q.opts || []).forEach(([v, label, sub]) => {
          const b = document.createElement('button'); b.type = 'button';
          const on = answers[q.id] === v;
          b.style.cssText = 'text-align:left;padding:6px 12px;border-radius:9px;border:1px solid ' + (on ? '#4a90e2' : '#3a3a4a') + ';background:' + (on ? 'rgba(74,144,226,.2)' : '#23232f') + ';color:' + (on ? '#e6f1ff' : '#ddd') + ';';
          b.innerHTML = '<div style="font-size:13px"></div><div style="font-size:11px;color:#8a8a99"></div>';
          b.firstChild.textContent = label; b.lastChild.textContent = sub || '';
          b.addEventListener('click', (e) => { e.stopPropagation(); answers[q.id] = v; render(); });
          row.appendChild(b);
        });
        if (q.slider) {
          const [lo, hi, def] = q.slider;
          let cur = parseInt(answers[q.id], 10); if (!(cur >= lo && cur <= hi)) { try { cur = Math.round(Number(window.__ccPluginSettings.get('uiScalePct')) || def); } catch (e) { cur = def; } }
          answers[q.id] = String(cur);
          const sw = document.createElement('div'); sw.style.cssText = 'display:flex;align-items:center;gap:10px;';
          const rg = document.createElement('input'); rg.type = 'range'; rg.min = lo; rg.max = hi; rg.step = 5; rg.value = cur; rg.style.cssText = 'flex:1;accent-color:var(--cc-accent,#ffd24a);';
          const lab = document.createElement('b'); lab.textContent = cur + '%'; lab.style.cssText = 'min-width:46px;text-align:right;color:var(--cc-accent,#ffd24a);';
          rg.addEventListener('input', () => { answers[q.id] = rg.value; lab.textContent = rg.value + '%'; try { window.__ccPluginSettings.seed({ uiScalePct: parseInt(rg.value, 10) }); } catch (e) {} });
          ['mousedown', 'click'].forEach((t) => rg.addEventListener(t, (e) => e.stopPropagation()));
          sw.append(rg, lab); row.appendChild(sw);
        }
        wrap.appendChild(row);
        if (q.info) { const inf = document.createElement('div'); inf.innerHTML = q.info; inf.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid #3a3a4a;font-size:11.5px;line-height:1.5;color:#b8b8c8;'; wrap.appendChild(inf); }
        body.appendChild(wrap);
      });
    }
    const foot = document.createElement('div'); foot.className = 'w-foot';
    const dots = document.createElement('div'); dots.className = 'w-dots cc-dots';
    steps.forEach((_, i) => { const d = document.createElement('i'); d.className = i === step ? 'on' : ''; dots.appendChild(d); });
    foot.appendChild(dots);
    if (!last) { const sk = document.createElement('button'); sk.className = 'cc-btn'; sk.dataset.v = 'quiet'; sk.textContent = 'Skip'; sk.addEventListener('click', close); foot.appendChild(sk); }
    if (step > 0) { const b = document.createElement('button'); b.className = 'cc-btn'; b.textContent = 'Back'; b.addEventListener('click', () => { step--; render(); }); foot.appendChild(b); }
    const nx = document.createElement('button'); nx.className = 'cc-btn'; nx.dataset.v = 'primary'; nx.textContent = last ? (isGuide ? 'Done' : 'Got it') : 'Next';
    if (s.ask) nx.textContent = 'Save';
    nx.addEventListener('click', () => { if (s.ask) applySetup(); if (last) close(); else { step++; render(); } });
    foot.appendChild(nx);
    card.append(head, body, foot);
    root.appendChild(card);
  }
  function openGuide(id) { const g = (window.__CC_GUIDES || {})[id]; if (!g || !g.steps || !g.steps.length) return false; steps = g.steps; uiOpen = false; isGuide = true; guideTitle = g.title || 'Guide'; step = 0; show(); return true; }
  function show() { if (!document.body) return; if (!document.getElementById('cc-welcome-style')) document.head.appendChild(style); if (!root.isConnected) document.body.appendChild(root); render(); root.hidden = false; }
  function open() { steps = buildSteps(); uiOpen = false; isGuide = false; step = 0; if (!document.body) return; if (!document.getElementById('cc-welcome-style')) document.head.appendChild(style); if (!root.isConnected) document.body.appendChild(root); render(); root.hidden = false; }
  const LS_UI = 'cc-ui-tour-seen';
  function openUiTour() { const lk = look(); steps = UI_STEPS.filter((x) => !(x.not && x.not.indexOf(lk) >= 0)); uiOpen = true; isGuide = true; guideTitle = 'What\u2019s new'; step = 0; show(); }
  function maybeUiTour() {
    if (!setting('welcomeTourEnabled', true)) return;
    try { if (localStorage.getItem(LS_UI) === '1') return; } catch (e) { return; }
    // wait until the game UI is up and no other tour or setup question is on screen
    if (window.__ccDom.q('.floating-tab-strip') && window.__ccDom.q('.panel-floating') && root.hidden && seen() && setupDone()) { uiTimer = setTimeout(() => { if (root.hidden) openUiTour(); }, 3500); return; }
    if (++uiTries < 400) uiTimer = setTimeout(maybeUiTour, 3000);
  }
  let uiTimer = 0, uiTries = 0;
  function openSetup() { answers = Object.assign({ style: 'none', tp: 'eff', combat: '40', stats: 'yes', notify: 'yes' }, loadAnswers()); steps = [SETUP]; uiOpen = false; isGuide = true; guideTitle = 'Setup'; step = 0; show(); }
  function close() { root.hidden = true; if (!isGuide) { try { window.__ccPresets && window.__ccPresets.settle && window.__ccPresets.settle(); } catch (e) { /* ignore */ } } if (uiOpen) { try { localStorage.setItem(LS_UI, '1'); } catch (e) { /* storage blocked */ } } if (!isGuide) { markSeen(); if (!setupDone() && setting('welcomeTourEnabled', true)) setTimeout(openSetup, 400); } }
  ['mousedown', 'click', 'wheel', 'contextmenu'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));
  const onKey = (e) => { if (!root.hidden && e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  // Auto-show once the game UI is up (logged in), if it has never been shown.
  let tries = 0;
  function maybeAutoShow() {
    if (!setting('welcomeTourEnabled', true)) return;
    if (seen()) { // existing installs: ask the setup questions once
      if (setupDone() || localStorage.getItem('cc-setup-asked')) return;
      if (window.__ccDom.q('.floating-tab-strip') && window.__ccDom.q('.panel-floating')) { timer = setTimeout(() => { if (!setupDone() && root.hidden) { try { localStorage.setItem('cc-setup-asked', '1'); } catch (e) {} openSetup(); } }, 5000); return; }
      if (++tries < 120) timer = setTimeout(maybeAutoShow, 2000);
      return;
    }
    if (window.__ccDom.q('.floating-tab-strip') && window.__ccDom.q('.panel-floating')) { timer = setTimeout(() => { if (!seen()) open(); }, 2500); return; }
    if (++tries < 120) timer = setTimeout(maybeAutoShow, 2000);
  }
  maybeAutoShow();
  maybeUiTour();

  function teardown() {
    clearTimeout(timer); clearTimeout(uiTimer); document.removeEventListener('keydown', onKey, true);
    root.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc welcome-tour torn down';
  }
  window[NS] = { version: 5, teardown, open, openGuide, openSetup, openUiTour, close, reset() { try { localStorage.removeItem(LS_SEEN); } catch (e) {} } };
  console.log('[cc] welcome-tour loaded');
  return 'cc welcome-tour loaded';
})();
