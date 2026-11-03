// ScapeLite looks (presets) and the first-run chooser. DISPLAY-ONLY: it only sets ScapeLite's own look settings and Info Bar layout.
//
//   A  Full Vanilla     the game exactly as it is; ScapeLite only does invisible / quality-of-life things
//   B  Combination      ScapeLite's Info Bar next to the game's own panels
//   C  ScapeLite only   the game's original panels hidden; ScapeLite's bar, cards and task queue instead
//
// One table (PRESETS below) says which plugin settings and which Info Bar layout each look sets. The current look is DERIVED, never stored:
// when every value in a look's table matches what is set now it is that look, otherwise it is "Custom". So changing a single option by hand
// turns the label into Custom without any hook on the settings page.
//
// Never touches an existing install: the first time this runs it records whether the install is new (no welcome tour seen, no setup answers,
// no UI tour seen). An existing install is marked "already chosen" and the chooser never opens by itself; it is reachable only from
// Settings > Plugins > ScapeLite Look. Before a look is applied the values it would overwrite are saved once ("Undo" puts them back).
// Programmatic settings go through __ccPluginSettings.setBundle (look keys only, never secrets); the bar layout through __ccBar.applyConfig.
// State: localStorage cc-preset (chosen / skipped), cc-preset-backup (one level of undo).
(function () {
  'use strict';
  const NS = '__ccPresets';
  const LS = 'cc-preset', LS_BK = 'cc-preset-backup';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* first load */ }

  const PS = () => window.__ccPluginSettings;
  const BAR = () => window.__ccBar;
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const has = (k) => { try { return localStorage.getItem(k) !== null; } catch (e) { return true; } };

  // ---- the table ------------------------------------------------------------------------------------------------------------------------
  const BTNS_PLAIN = { look: 'icon', live: true, pin: false, hideAll: false, style: 'flat' };
  const BAR_PLAIN = {   // the default bar: the game's panels stay, the buttons just open them
    top: [{ id: 'task', s: 'l' }, { id: 'where', s: 'l' }, { id: 'panelbtns', s: 'c', o: BTNS_PLAIN }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r' }, { id: 'clock', s: 'r' }],
    bottom: [],
  };
  const PRESETS = {
    vanilla: {
      name: 'Full Vanilla',
      blurb: 'The game exactly as it is. No Info Bar, no extra menu button, no bell. ScapeLite keeps doing its invisible and quality-of-life work (tooltips, logs, alerts to Windows, Discord if you set it up).',
      short: 'The game exactly as it is. ScapeLite only does invisible and quality-of-life work.',
      settings: { uiBarTop: false, uiBarBottom: false, uiBarHotkeys: false, verticalMenuEnabled: false, menuBarHidden: false, hpPanelEnabled: false, hpPanelHideOriginal: false, scapeliteMenuEnabled: false, alertBellHidden: true },
      bar: BAR_PLAIN,   // kept sane even though the bars are off: a bar layout that hides panels would still hide them
    },
    combo: {
      name: 'Combination',
      blurb: 'ScapeLite’s Info Bar along the top (task, place, XP per hour, gold, clock and a row of panel buttons) with the game’s own panels and menu untouched.',
      short: 'ScapeLite’s Info Bar along the top; the game’s own panels and menu untouched.',
      settings: { uiBarTop: true, uiBarBottom: false, uiBarHotkeys: true, verticalMenuEnabled: true, menuBarHidden: false, hpPanelEnabled: false, hpPanelHideOriginal: false, scapeliteMenuEnabled: true, alertBellHidden: false },
      bar: BAR_PLAIN,
    },
    only: {
      name: 'ScapeLite only',
      blurb: 'The game’s original panels are hidden. You get ScapeLite’s bars, its task queue, pinned cards (Skills, Inventory, Equipment, Quests, Diary, Barter, Friends), the chat button and the hit points bar. Right-click a panel button any time to open the game’s original panel.',
      short: 'The game’s panels hidden; ScapeLite’s bars, task queue and pinned cards instead.',
      settings: { uiBarTop: true, uiBarBottom: true, uiBarHotkeys: true, verticalMenuEnabled: true, menuBarHidden: false, hpPanelEnabled: false, hpPanelHideOriginal: false, scapeliteMenuEnabled: true, alertBellHidden: false },
      bar: {
        top: [{ id: 'task', s: 'l' }, { id: 'where', s: 'l' }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r' }, { id: 'clock', s: 'r' }],
        bottom: [{ id: 'chat', s: 'l', o: { hide: true, snippet: true, w: 520 } }, { id: 'panelbtns', s: 'c', o: { look: 'both', live: true, pin: true, hideAll: true, style: 'flat' } }, { id: 'hp', s: 'r', o: { style: 'bar', hideOrig: true, icon: true, w: 200 } }],
      },
    },
  };
  const ORDER = ['vanilla', 'combo', 'only'];
  const ALL_KEYS = Array.from(new Set([].concat(...ORDER.map((id) => Object.keys(PRESETS[id].settings)))));

  // ---- which look is set now -----------------------------------------------------------------------------------------------------------
  const norm = (v) => (v === undefined || v === null ? false : v);
  function settingsMatch(p) { const ps = PS(); if (!ps || !ps.get) return false; return Object.keys(p.settings).every((k) => norm(ps.get(k)) === p.settings[k]); }
  function optDefault(id, k) { try { const d = BAR().MODULES[id]; const o = (d.opts || []).find((x) => x.k === k); return o ? o.def : undefined; } catch (e) { return undefined; } }
  function barMatches(p) {
    const b = BAR(); if (!b || !b.config || !p.bar) return !p.bar;
    const cfg = b.config;
    return ['top', 'bottom'].every((pos) => {
      const have = (cfg[pos] || []), want = p.bar[pos] || [];
      if (have.length !== want.length) return false;
      const ids = (a) => a.map((m) => m.id).sort().join(',');
      if (ids(have) !== ids(want)) return false;
      return want.every((w) => !w.o || have.filter((m) => m.id === w.id).every((m) => Object.keys(w.o).every((k) => { const v = (m.o && m.o[k] !== undefined) ? m.o[k] : optDefault(w.id, k); return v === w.o[k]; })));
    });
  }
  function currentId() { for (const id of ORDER) if (settingsMatch(PRESETS[id]) && barMatches(PRESETS[id])) return id; return 'custom'; }
  const currentName = () => { const id = currentId(); return id === 'custom' ? 'Custom' : PRESETS[id].name; };

  // ---- applying --------------------------------------------------------------------------------------------------------------------------
  function snapshot() {
    const ps = PS(), s = {};
    ALL_KEYS.forEach((k) => { s[k] = ps && ps.get ? ps.get(k) : undefined; });
    return { v: 1, at: Date.now(), from: currentId(), settings: s, bar: BAR() && BAR().config ? BAR().config : null };
  }
  let barTimer = 0;
  function putBar(cfg) {   // the bar may load a moment after this plugin: try for a few seconds
    clearInterval(barTimer); let n = 0;
    const go = () => { if (BAR() && BAR().applyConfig) { clearInterval(barTimer); BAR().applyConfig(cfg); return true; } return false; };
    if (!go()) barTimer = setInterval(() => { if (go() || ++n > 20) clearInterval(barTimer); }, 500);
  }
  function apply(id) {
    const p = PRESETS[id], ps = PS();
    if (!p || !ps || !ps.setBundle) return { ok: false, why: 'The settings page is not loaded yet.' };
    write(LS_BK, snapshot());
    const r = ps.setBundle(p.settings);
    if (r.refused.length) { try { console.warn('[cc] presets: refused keys', r.refused); } catch (e) { /* no console */ } }
    if (p.bar) putBar({ v: 1, top: JSON.parse(JSON.stringify(p.bar.top)), bottom: JSON.parse(JSON.stringify(p.bar.bottom)) });
    write(LS, { v: 1, chosen: true, id, at: Date.now() });
    return { ok: true, refused: r.refused };
  }
  const hasBackup = () => { const b = read(LS_BK); return !!(b && b.settings); };
  function undo() {
    const b = read(LS_BK), ps = PS(); if (!b || !b.settings || !ps || !ps.setBundle) return false;
    const clean = {}; Object.keys(b.settings).forEach((k) => { if (b.settings[k] !== undefined) clean[k] = b.settings[k]; });
    ps.setBundle(clean);
    if (b.bar) putBar(b.bar);
    try { localStorage.removeItem(LS_BK); } catch (e) { /* ignore */ }
    return true;
  }

  // ---- first run: new install or not -----------------------------------------------------------------------------------------------------
  // Decided once, on the very first load, before the welcome tour has had a chance to write anything.
  let st = read(LS);
  if (!st || typeof st !== 'object') {
    const fresh = !has('cc-welcome-seen') && !has('cc-setup') && !has('cc-ui-tour-seen');
    st = fresh ? { v: 1, chosen: false } : { v: 1, chosen: true, existing: true };
    write(LS, st);
  }
  const pending = () => { const s = read(LS); return !!(s && s.chosen === false); };

  // ---- the chooser -----------------------------------------------------------------------------------------------------------------------
  const style = document.createElement('style'); style.id = 'cc-presets-style';
  style.textContent = `
#cc-presets{position:fixed;inset:0;z-index:var(--cc-z-modal,2147482800);display:flex;align-items:center;justify-content:center;background:var(--cc-scrim,rgba(6,6,12,.62));font:var(--cc-fs,14px)/1.5 var(--cc-font,system-ui,sans-serif)}
#cc-presets[hidden]{display:none!important}
.pr-scope .pr-card{width:min(760px,94vw);max-height:92vh;overflow:auto;background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-radius:var(--cc-r);box-shadow:var(--cc-shadow);color:var(--cc-text);padding:16px 18px 14px}
#cc-presets h2{margin:0 0 4px;font-size:18px}
.pr-scope .pr-sub{margin:0 0 12px;color:var(--cc-text-dim);font-size:13px}
.pr-scope .pr-row{display:flex;gap:10px;flex-wrap:wrap}
.pr-scope .pr-opt{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;flex:1 1 200px;min-width:200px;text-align:left;cursor:pointer;padding:10px;border-radius:10px;background:var(--cc-bg-2,#161620);border:1px solid var(--cc-border);color:var(--cc-text);font:inherit}
.pr-scope .pr-opt:hover{border-color:var(--cc-border-strong);background:var(--cc-bg-3)}
.pr-scope .pr-opt:focus-visible{outline:2px solid var(--cc-info);outline-offset:2px}
.pr-scope .pr-opt.on{border-color:var(--cc-accent);box-shadow:inset 0 0 0 1px var(--cc-accent)}
.pr-scope .pr-opt b{display:block;font-size:14.5px;margin:8px 0 2px}
.pr-scope .pr-opt span.d{display:block;color:var(--cc-text-dim);font-size:12px;line-height:1.45}
.pr-scope .pr-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:8px;font-size:11px;background:var(--cc-accent-bg,#2a2518);color:var(--cc-accent);vertical-align:1px}
.pr-scope .pr-mock{position:relative;height:74px;border-radius:6px;background:var(--cc-sunk,#0c0c12);border:1px solid var(--cc-border);overflow:hidden}
.pr-scope .pr-mock i{position:absolute;display:block;border-radius:2px}
.pr-scope .pr-mock .g{background:#3b3b4c}.pr-scope .pr-mock .s{background:var(--cc-accent);opacity:.85}.pr-scope .pr-mock .c{background:transparent;border:1px solid var(--cc-accent)}
.pr-scope .pr-foot{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}
.pr-scope .pr-note{color:var(--cc-text-dim);font-size:12px;flex:1 1 220px}
.pr-scope .pr-ok{color:var(--cc-good)}
.pr-scope .pr-opt .tx{flex:1;min-width:0}
.pr-compact .pr-row{flex-direction:column;gap:8px}
.pr-compact .pr-opt{flex-direction:row;align-items:center;gap:12px;flex:none;min-width:0;padding:8px 10px}
.pr-compact .pr-opt b{margin:0 0 2px}
.pr-compact .pr-mock{zoom:.6;flex:none}
.pr-compact .pr-foot{margin-top:8px}`;
  const root = document.createElement('div'); root.id = 'cc-presets'; root.className = 'pr-scope'; root.hidden = true;
  let firstRun = false, lastMsg = '';

  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function mock(id) {
    const m = mk('div', 'pr-mock');
    const box = (cls, l, t, w, h) => { const e = document.createElement('i'); e.className = cls; e.style.cssText = 'left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px'; m.appendChild(e); };
    if (id === 'vanilla') { box('g', 6, 6, 52, 36); box('g', 64, 6, 52, 22); box('g', 160, 40, 20, 28); box('g', 122, 6, 40, 14); }
    else if (id === 'combo') { box('s', 0, 0, 200, 8); box('g', 6, 14, 52, 36); box('g', 64, 14, 52, 22); box('g', 160, 40, 20, 28); }
    else { box('s', 0, 0, 200, 8); box('c', 6, 14, 52, 28); box('c', 64, 14, 52, 22); box('s', 0, 66, 200, 8); box('s', 70, 52, 60, 6); box('s', 160, 56, 36, 6); }
    m.style.width = '200px'; m.style.flex = 'none';
    return m;
  }
  // The three looks as one row of buttons; shared by the chooser window and the picker embedded in the welcome tour.
  function looksRow(now, onPick, compact) {
    const row = mk('div', 'pr-row');
    ORDER.forEach((id) => {
      const p = PRESETS[id], b = mk('button', 'pr-opt' + (now === id ? ' on' : '')); b.type = 'button';
      b.appendChild(mock(id));
      const tx = mk('div', 'tx');
      const t = mk('b', '', p.name); if (now === id) t.appendChild(mk('span', 'pr-tag', 'current')); tx.appendChild(t);
      tx.appendChild(mk('span', 'd', compact ? p.short : p.blurb));
      b.appendChild(tx);
      b.addEventListener('click', (e) => { e.stopPropagation(); onPick(id); });
      row.appendChild(b);
    });
    return row;
  }
  function render() {
    root.textContent = '';
    const card = mk('div', 'pr-card');
    card.appendChild(mk('h2', '', firstRun ? 'How should ScapeLite look?' : 'ScapeLite look'));
    card.appendChild(mk('p', 'pr-sub', firstRun ? 'Pick a starting point. It only changes what ScapeLite shows; it never plays for you. You can switch any time in Settings → Plugins → ScapeLite Look.' : 'Current look: ' + currentName() + '. Picking another look replaces the Info Bar layout and a few display options; Undo puts your previous setup back.'));
    const now = currentId();
    card.appendChild(looksRow(now, choose, false));
    const foot = mk('div', 'pr-foot');
    const note = mk('div', 'pr-note', lastMsg || (now === 'custom' ? 'You have a custom mix of options. Picking a look replaces the ones it sets.' : ''));
    if (lastMsg) note.classList.add('pr-ok');
    foot.appendChild(note);
    if (hasBackup()) { const u = mk('button', 'cc-btn', 'Undo last change'); u.type = 'button'; u.addEventListener('click', (e) => { e.stopPropagation(); lastMsg = undo() ? 'Your previous setup is back.' : 'Nothing to undo.'; render(); }); foot.appendChild(u); }
    const c = mk('button', 'cc-btn', firstRun ? 'Skip for now' : 'Close'); c.type = 'button'; if (firstRun) c.dataset.v = 'quiet'; c.addEventListener('click', (e) => { e.stopPropagation(); skip(); });
    foot.appendChild(c);
    card.appendChild(foot);
    root.appendChild(card);
  }
  function choose(id) {
    const r = apply(id);
    if (!r.ok) { lastMsg = r.why; render(); return; }
    if (firstRun) { firstRun = false; closeUi(); return; }
    lastMsg = PRESETS[id].name + ' is on. Undo is available if you change your mind.'; render();
  }
  function skip() {   // leaves everything as it is; remembered, so the first-run chooser does not come back
    settle();
    firstRun = false; closeUi();
  }
  function settle() { const s = read(LS) || { v: 1 }; if (s.chosen === false) write(LS, { v: 1, chosen: true, skipped: true, at: Date.now() }); }   // "no choice made": remembered, defaults stay
  // The looks as an embeddable list (used by step 1 of the welcome tour): clicking one applies it at once; Undo is offered after a change.
  function picker(opts) {
    opts = opts || {};
    if (!document.getElementById('cc-presets-style')) document.head.appendChild(style);
    const wrap = mk('div', 'pr-scope pr-picker pr-compact');
    let msg = '';
    const draw = () => {
      wrap.textContent = '';
      wrap.appendChild(looksRow(currentId(), (id) => { const r = apply(id); msg = r.ok ? PRESETS[id].name + ' is on.' : r.why; draw(); try { opts.onChange && opts.onChange(id); } catch (e) { /* caller error */ } }, true));
      const foot = mk('div', 'pr-foot'), note = mk('div', 'pr-note', msg); if (msg) note.classList.add('pr-ok'); foot.appendChild(note);
      if (hasBackup() && msg) { const u = mk('button', 'cc-btn', 'Undo'); u.type = 'button'; u.addEventListener('click', (e) => { e.stopPropagation(); msg = undo() ? 'Your previous setup is back.' : 'Nothing to undo.'; draw(); try { opts.onChange && opts.onChange(currentId()); } catch (er) { /* caller error */ } }); foot.appendChild(u); }
      wrap.appendChild(foot);
    };
    draw();
    return wrap;
  }
  function closeUi() { root.hidden = true; lastMsg = ''; }
  function openChooser(first) {
    if (!document.body) return;
    firstRun = !!first; lastMsg = '';
    if (!document.getElementById('cc-presets-style')) document.head.appendChild(style);
    if (!root.isConnected) document.body.appendChild(root);
    render(); root.hidden = false;
    try { const b = root.querySelector('.pr-opt.on') || root.querySelector('.pr-opt'); b && b.focus(); } catch (e) { /* ignore */ }
  }
  ['mousedown', 'click', 'wheel', 'contextmenu'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));
  const onKey = (e) => { if (!root.hidden && e.key === 'Escape') { e.stopPropagation(); skip(); } };
  document.addEventListener('keydown', onKey, true);

  // First run: the welcome tour hosts the chooser as its step 1 (welcome-tour.js uses picker()). This window is only the fallback: it opens on a
  // new install when the tour is switched off or never appeared, so a new user is never left without the choice.
  let tries = 0, timer = 0;
  const tourVisible = () => { const w = document.getElementById('cc-welcome'); return !!(w && !w.hidden); };
  function maybeAutoShow() {
    if (!pending()) return;
    if (window.__ccDom && window.__ccDom.q('.floating-tab-strip') && window.__ccDom.q('.panel-floating') && PS() && PS().setBundle) {
      const tourOff = PS().get && PS().get('welcomeTourEnabled') === false;
      timer = setTimeout(() => { if (pending() && root.hidden && (tourOff || !tourVisible())) openChooser(true); else if (pending() && !tourOff) maybeAutoShow(); }, tourOff ? 1500 : 9000);
      return;
    }
    if (++tries < 120) timer = setTimeout(maybeAutoShow, 2000);
  }
  maybeAutoShow();

  function teardown() {
    clearTimeout(timer); clearInterval(barTimer); document.removeEventListener('keydown', onKey, true);
    root.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc presets torn down';
  }
  window[NS] = { version: 2, teardown, PRESETS, order: ORDER, keys: ALL_KEYS, currentId, currentName, apply, undo, hasBackup, pending, settle, picker, openChooser: () => openChooser(false), openFirstRun: () => openChooser(true), close: closeUi };
  console.log('[cc] presets loaded');
  return 'cc presets loaded';
})();
