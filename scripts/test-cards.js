// Card test harness.  npm run test:cards   (options: --live-only, --fixture-only, --overlay-dir=<dir>, --port=9222, --fixture-port=9333)
//
// Question it answers: after the game changes (by itself, or because the user pressed a button on a ScapeLite card that hands the click to the game),
// does the card show what the game shows?
//
//  LIVE suite (the real game on CDP 9222, read-mostly): every card is opened with real mouse events (hover card on the Info Bar's panel button, pinned
//    card through __ccBar.cards) and its facts are compared with the game's own panel / data. The only thing pressed is the Equipment card's two DISPLAY
//    toggles (Potion boosts, Spirit modifier): pressed with a real CDP click, checked on both sides, pressed again, and restored in a finally block.
//    Nothing that spends or changes game state is ever pressed in the live game (Barter Reroll/Buy/Sell/Charm, queue rerolls/swaps/drags, quest claims,
//    equipment swaps). The suite also checks that it left nothing behind: panel-fuse / plugin-settings storage unchanged, HTMLElement.prototype.click
//    still native, the shared layer's observers all detached again.
//  FIXTURE suite (scripts/fixtures/cards-fixture.html in a private hidden Electron window on its own port, with the REAL overlay files injected):
//    a fake game that answers clicks a moment later, like the real one. Here the spend-type buttons ARE pressed (Barter Reroll / Buy / Charm, queue
//    select), plus the redraw rules (follows a source change, waits while a button is held down, waits while you point at a control, a click does not get lost).
//  FORWARD LINT: scripts/lint-forwards.js (a ratchet on direct .click() / dispatchEvent calls in overlay code).
//
// The harness never patches a prototype in the live page (it only evaluates read functions and uses the real input path), and every test restores what it touched.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const OVERLAY_DIR = (process.argv.find((a) => a.startsWith('--overlay-dir=')) || '').split('=')[1] || '';   // test another copy of the overlay files (e.g. the previous commit's) to prove the harness catches the old bugs
const has = (k) => process.argv.includes('--' + k);
const LIVE_PORT = Number(arg('port', 9222)), FIX_PORT = Number(arg('fixture-port', 9333));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; let suite = '';
const rec = (name, ok, detail, skip) => { rows.push({ suite, name, res: skip ? 'SKIP' : ok ? 'PASS' : 'FAIL', detail: detail || '' }); };
async function check(name, fn) { try { const r = await fn(); if (r === 'skip') return; if (r && r.skip) rec(name, true, r.skip, true); else if (r === true || r === undefined) rec(name, true); else if (r && r.ok !== undefined) rec(name, !!r.ok, r.detail); else rec(name, !!r, String(r)); } catch (e) { rec(name, false, String(e && e.message || e).slice(0, 220)); } }
// poll until fn() is truthy (returns the value) or the time is up (returns the last value)
async function until(fn, ms, step) { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(step || 100); } while (Date.now() < end); return v; }
const J = JSON.stringify;

// ---------------------------------------------------------------------------------------------------------- page-side probes (strings evaluated in the page)
// facts of what a card SHOWS, read from the card's DOM; `sel` is '#cc-card-<tab>' (pinned) or '#cc-bar-tip' (hover)
const CARD_FACTS = `((tab, sel) => {
  const host = document.querySelector(sel); if (!host) return null;
  const txt = (e) => (e ? e.textContent.trim() : '');
  const f = { title: txt(host.querySelector('.th, .cc-title, .cc-head')).slice(0, 40) };
  if (tab === 'skills') { const c = [...host.querySelectorAll('.tcell:not(.total)')]; f.n = c.length; f.sum = c.reduce((a, e) => a + (parseInt(txt(e.querySelector('b')), 10) || 0), 0); const t = host.querySelector('.tcell.total .tl-v'); f.total = t ? Number(t.textContent) : null; }
  else if (tab === 'inventory') { const c = [...host.querySelectorAll('.tcell')]; f.n = c.length; f.used = c.filter((e) => !e.classList.contains('ghost')).length; }
  else if (tab === 'equipment') { const t = [...host.querySelectorAll('.tactbar .tabtn')].map(txt); f.buttons = t; f.potion = (t.find((x) => /^Potion boosts/.test(x)) || '').replace(/^.*: /, ''); f.spirit = (t.find((x) => /^Spirit modifier/.test(x)) || '').replace(/^.*: /, ''); f.loadout = txt(host.querySelector('.tload')).replace(/\\s*[\\u25BE]$/, '') || txt(host.querySelector('.th span')) || txt(host.querySelector('.tl')); f.cells = host.querySelectorAll('.tcell').length; }
  else if (tab === 'diary') { const r = host.querySelector('.tq .tql span'); f.pct = r ? parseInt(r.textContent, 10) : null; f.name = txt(host.querySelector('.tq .tql b')); }
  else if (tab === 'quests') { f.mode = txt(host.querySelector('.ttabs .cc-chip.on')); f.n = host.querySelectorAll('.tq').length; f.names = [...host.querySelectorAll('.tq .tql b')].map(txt).sort(); }
  else if (tab === 'friends') { f.mode = txt(host.querySelector('.ttabs .cc-chip.on')); f.n = host.querySelectorAll('.trw').length; }
  else if (tab === 'barter') { const r = [...host.querySelectorAll('.trw')]; f.locked = r.filter((e) => e.classList.contains('dim')).length; f.buy = [...host.querySelectorAll('.tabtn.buy')].map((b) => b.disabled ? 0 : 1); f.charm = [...host.querySelectorAll('.tabtn.charm')].map((b) => b.disabled ? 0 : 1); f.reroll = txt(host.querySelector('.tabtn.reroll')); f.rerollOff = host.querySelector('.tabtn.reroll') ? host.querySelector('.tabtn.reroll').disabled : null; f.note = txt(host.querySelector('.th span')) || txt(host.querySelector('.tl')); f.names = r.filter((e) => !e.classList.contains('dim')).map((e) => txt(e.querySelector('.tm b'))).filter((x) => x && !/ gold$| charges$/.test(x)); f.subs = r.map((e) => txt(e.querySelector('.tm span'))); }
  return f; })`;
// the same facts read from the game's own panel / data
const GAME_FACTS = `((tab) => {
  const D = window.__ccDom || { q: (s) => document.querySelector(s) };
  const pe = (id) => { const t = D.q('.panel-titlebar[data-panel-id="' + id + '"]'); return t ? t.parentElement : null; };
  const txt = (e) => (e ? e.textContent.trim() : '');
  const f = {}; const root = pe(tab); const b = window.__ccBridge;
  if (tab === 'skills') { const r = D.q('.skills-panel'); const c = r ? [...r.querySelectorAll('.skill-cell')] : []; f.n = c.length; f.sum = c.reduce((a, e) => a + (parseInt(txt(e.querySelector('.skill-level')), 10) || 0), 0); f.total = f.sum; }
  else if (tab === 'inventory') { const r = D.q('.inventory-panel'); const c = r ? [...r.querySelectorAll('.inv-slot')] : []; f.n = c.length; f.used = c.filter((e) => !e.classList.contains('empty') && e.dataset.itemId).length; }
  else if (tab === 'equipment') { const sp = document.querySelector('.equip-side .equip-stats-panel') || document.querySelector('.equip-stats-panel'); const on = (s) => { const e = sp && sp.querySelector(s); return e ? (e.classList.contains('active') ? 'ON' : 'OFF') : ''; }; f.potion = on('.potion-stats-toggle'); f.spirit = on('.spirit-stats-toggle'); f.loadout = txt(root && root.querySelector('.loadout-sel-slot.active .loadout-sel-slot-label')); }
  else if (tab === 'diary') { const fl = root && root.querySelector('.diary-all-fill'); f.pct = fl ? Math.round(parseFloat(fl.style.width) || 0) : null; f.name = 'All diaries'; }
  else if (tab === 'quests') { f.n = root ? root.querySelectorAll('.quest-slot:not(.quest-slot-empty)').length : 0; f.names = root ? [...root.querySelectorAll('.quest-slot:not(.quest-slot-empty) .quest-slot-name')].map(txt).sort() : []; }
  else if (tab === 'friends') { const s = b && b.social && b.social(); f.friends = s ? s.friends.length : null; f.clan = s ? s.clan.members.length : null; f.muted = s ? s.muted.length : null; f.domRows = root ? root.querySelectorAll('.friend-row').length : 0; }
  else if (tab === 'barter') { const r = root ? [...root.querySelectorAll('.barter-slot-row')] : []; f.rows = r.length; f.locked = r.filter((e) => e.classList.contains('barter-slot-locked')).length; const vis = (e) => e && e.style.display !== 'none' && e.style.visibility !== 'hidden'; const act = r.filter((e) => !e.classList.contains('barter-slot-locked')); f.buy = act.map((e) => e.querySelector('.barter-buy-btn')).filter(vis).map((x) => x.disabled ? 0 : 1); f.charm = act.map((e) => e.querySelector('.barter-charm-btn')).filter(vis).map((x) => x.disabled ? 0 : 1); f.budget = txt(root && root.querySelector('.barter-header-budget')); f.names = r.filter((e) => !e.classList.contains('barter-slot-locked')).map((e) => { const i = e.querySelector('.barter-slot-icon img'); return i ? String(i.alt || '') : ''; }).filter(Boolean); const rr = root && root.querySelector('.barter-reroll-btn'); f.rerollOff = rr ? rr.disabled : null; }
  return f; })`;
const rectOf = (sel) => `(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`;
const hash = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const PAGE_STATE = `(() => { const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }; const S = window.__ccCardSync; return { fuse: ls('cc-panel-fuse'), settings: ls('cc-plugin-settings'), clickNative: /\\[native code\\]/.test(HTMLElement.prototype.click.toString()), dispatchNative: /\\[native code\\]/.test(EventTarget.prototype.dispatchEvent.toString()), sync: S ? S.state() : null, cardsOpen: window.__ccBar ? ['skills','inventory','equipment','diary','quests','friends','barter'].filter((t) => window.__ccBar.cards.isOpen(t)) : [], queueOpen: window.__ccQueue ? window.__ccQueue.isOpen() : null }; })()`;

// compare card facts with game facts for one tab: returns { ok, detail }
function compare(tab, c, g, ctx) {
  const bad = []; const eq = (label, a, b) => { if (J(a) !== J(b)) bad.push(label + ': card ' + J(a) + ' vs game ' + J(b)); };
  if (!c) return { ok: false, detail: 'card not on screen' };
  if (tab === 'skills') { eq('cells', c.n, g.n); eq('level sum', c.sum, g.sum); eq('total level', c.total, g.total); }
  else if (tab === 'inventory') { eq('slots', c.n, g.n); eq('used', c.used, g.used); }
  else if (tab === 'equipment') { if (c.potion !== '') eq('potion boosts', c.potion, g.potion); if (c.spirit !== '') eq('spirit modifier', c.spirit, g.spirit); if (g.loadout && !String(c.loadout).includes(g.loadout.replace(/\s+/g, ' '))) bad.push('loadout: card ' + J(c.loadout) + ' vs game ' + J(g.loadout)); }
  else if (tab === 'diary') { eq('all-diaries %', c.pct, g.pct); }
  else if (tab === 'quests') { if (c.mode === 'List') return { ok: true, detail: 'List view, skipped' }; eq('active quests', c.n, g.n); eq('quest names', c.names, g.names); }
  else if (tab === 'friends') { const m = String(c.mode || 'Friends').toLowerCase(); const want = m === 'clan' ? g.clan : m === 'muted' ? g.muted : g.friends; if (want != null) eq('rows (' + m + ')', c.n, want); }
  else if (tab === 'barter') { eq('locked rows', c.locked, g.locked); eq('buy buttons enabled', c.buy, g.buy); eq('charm buttons enabled', c.charm, g.charm); eq('reroll disabled', c.rerollOff, g.rerollOff); eq('item names', c.names.map((n) => n.replace(/^\[T\d+\]\s*/, '')), g.names.map((n) => n.replace(/^\[T\d+\]\s*/, ''))); if (g.budget !== '' && c.note && !new RegExp('\\b' + g.budget + ' charges left').test(c.note)) bad.push('charges: card ' + J(c.note) + ' vs game ' + g.budget); }
  return { ok: !bad.length, detail: bad.join('; ') };
}

// ------------------------------------------------------------------------------------------------------------------------------- shared card helpers
// open a pinned card through the bar's own API (not a game click), remembering whether it was open so it can be put back
async function pin(page, tab, want) {
  return page.eval(`(() => { const b = window.__ccBar; if (!b) return null; const was = b.cards.isOpen(${J(tab)}); if (${want} !== was) b.cards.toggle(${J(tab)}); return was; })()`);
}
async function cardFacts(page, tab, sel) { return page.eval(`${CARD_FACTS}(${J(tab)}, ${J(sel)})`); }
async function gameFacts(page, tab) { return page.eval(`${GAME_FACTS}(${J(tab)})`); }
// poll until the card agrees with the game (a card is allowed a moment to follow); returns { ok, detail }
async function agree(page, tab, sel, ms) {
  let last = { ok: false, detail: 'no data' };
  await until(async () => { last = compare(tab, await cardFacts(page, tab, sel), await gameFacts(page, tab)); return last.ok; }, ms || 2500, 150);
  return last;
}

// ------------------------------------------------------------------------------------------------------------------------------- LIVE suite
async function liveSuite() {
  suite = 'live';
  let page; try { page = await cdp.connectToPage(LIVE_PORT, /scapewatch/i, 1500); } catch (e) { rec('game reachable on CDP ' + LIVE_PORT, true, 'not running: live suite skipped', true); return; }
  const TABS = ['skills', 'inventory', 'equipment', 'diary', 'quests', 'friends', 'barter'];
  const before = await page.eval(PAGE_STATE);
  const opened = {};   // tab -> was it open before the test (restored in finally)
  try {
    await check('card layer is loaded', async () => ({ ok: !!(before.sync && before.sync.sources && before.sync.sources.equipment), detail: before.sync ? '' : 'window.__ccCardSync missing' }));
    await check('HTMLElement.prototype.click is native (before)', () => before.clickNative);
    // (a) every card, pinned: its facts match the game's panel
    for (const tab of TABS) {
      await check('pinned ' + tab + ' card matches the game', async () => {
        opened[tab] = await pin(page, tab, true); if (opened[tab] === null) return { skip: 'no Info Bar' };
        return agree(page, tab, '#cc-card-' + tab, 2500);
      });
    }
    // (a2) every card, as the hover card of its Info Bar button (real mouse move)
    for (const tab of TABS) {
      await check('hover ' + tab + ' card matches the game', async () => {
        await pin(page, tab, false);   // the hover card is not shown for a pinned open card
        const r = await page.eval(rectOf('.cc-bar .pi[data-key="' + tab + '"]'));
        if (!r) return { skip: 'no ' + tab + ' button on the Info Bars' };
        await page.move(r[0], r[1]); await sleep(120); await page.move(r[0] + 1, r[1]);
        const shown = await until(() => page.eval('!!document.querySelector("#cc-bar-tip")'), 1500);
        if (!shown) return { ok: false, detail: 'no hover card appeared' };
        const res = await agree(page, tab, '#cc-bar-tip', 2500);
        await page.move(4, 300); await until(() => page.eval('!document.querySelector("#cc-bar-tip")'), 2000);
        return res;
      });
    }
    // hidden-panel freshness: does the game keep the panels we copy up to date while they are hidden?
    await check('hidden game panels are in step with the bridge data (friends rows, inventory use)', async () => {
      const r = await page.eval(`(() => { const b = window.__ccBridge, D = window.__ccDom; const pe = (id) => { const t = D.q('.panel-titlebar[data-panel-id="' + id + '"]'); return t && t.parentElement; };
        const s = b.social(), a = b.alertState(), inv = pe('inventory'), fr = pe('friends');
        return { frDom: fr ? fr.querySelectorAll('.friend-row').length : null, frBr: s.friends.length, invDom: inv ? [...inv.querySelectorAll('.inv-slot')].filter((e) => !e.classList.contains('empty') && e.dataset.itemId).length : null, invBr: a.invUsed }; })()`);
      const bad = []; if (r.frDom !== r.frBr) bad.push('friends DOM ' + r.frDom + ' vs bridge ' + r.frBr); if (r.invBr != null && r.invDom !== r.invBr) bad.push('inventory DOM ' + r.invDom + ' vs bridge ' + r.invBr);
      return { ok: !bad.length, detail: bad.join('; ') };
    });
    // (b) the Equipment card's two display toggles: real click, both sides change, then restore
    for (const [label, key] of [['Potion boosts', 'potion'], ['Spirit modifier', 'spirit']]) {
      let orig = null, pressed = 0;
      const press = async () => {
        const r = await page.eval(`(() => { const e = [...document.querySelectorAll('#cc-card-equipment .tactbar .tabtn')].find((b) => b.textContent.indexOf(${J(label + ':')}) === 0); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2)]; })()`);
        if (!r) return null; await page.click(r[0], r[1]); pressed++; return r;
      };
      try {
        await check('equipment card: ' + label + ' toggle follows a real click (and restores)', async () => {
          const was = await pin(page, 'equipment', true); if (opened.equipment === undefined) opened.equipment = was; if (was === null) return { skip: 'no Info Bar' };
          await sleep(300);
          const g0 = await gameFacts(page, 'equipment'); orig = g0[key]; if (!orig) return { skip: 'the game has no ' + label + ' toggle' };
          const want = orig === 'ON' ? 'OFF' : 'ON';
          const pt = await press(); if (!pt) return { skip: 'toggle button hidden (Settings > Panels > Equipment Card)' };
          const flipped = await until(async () => (await gameFacts(page, 'equipment'))[key] === want && (await cardFacts(page, 'equipment', '#cc-card-equipment'))[key] === want, 3500, 100);
          if (!flipped) return { ok: false, detail: 'after the click game=' + (await gameFacts(page, 'equipment'))[key] + ' card=' + (await cardFacts(page, 'equipment', '#cc-card-equipment'))[key] + ', wanted ' + want };
          // the pointer still rests where the button was: the new button must be under it and hovered (the redraw keeps the hover)
          const hov = await page.eval(`(() => { const e = document.elementFromPoint(${pt[0]}, ${pt[1]}); return !!(e && e.closest && e.closest('.tabtn') && e.closest('.tabtn').matches(':hover')); })()`);
          const back = await press(); if (!back) return { ok: false, detail: 'button vanished' };
          const restored = await until(async () => (await gameFacts(page, 'equipment'))[key] === orig && (await cardFacts(page, 'equipment', '#cc-card-equipment'))[key] === orig, 3500, 100);
          return { ok: !!restored && hov, detail: !restored ? 'second press did not restore' : hov ? '' : 'the redrawn button is not hovered under the pointer' };
        });
      } finally {
        // always put the display preference back, with the same real click path
        try {
          const g = await gameFacts(page, 'equipment');
          for (let i = 0; orig && g && (await gameFacts(page, 'equipment'))[key] !== orig && i < 2; i++) { await press(); await until(async () => (await gameFacts(page, 'equipment'))[key] === orig, 3000, 100); }
          if (orig) rec('restore ' + label, (await gameFacts(page, 'equipment'))[key] === orig, 'original ' + orig);
        } catch (e) { rec('restore ' + label, false, String(e.message || e)); }
      }
    }
    // the task queue (read only): opening it matches the bridge's queue, and it polls only while it is on screen
    await check('queue panel matches the bridge data (and watches only while open)', async () => {
      if (!(await page.eval('!!window.__ccQueue'))) return { skip: 'queue plugin not loaded' };
      const was = await page.eval('window.__ccQueue.isOpen()'); if (!was) await page.eval('window.__ccQueue.toggle()');
      try {
        await sleep(600);
        const r = await page.eval(`(() => { const b = window.__ccBridge, pr = b.project(), rows = [...document.querySelectorAll('#cc-queue .cc-q-row')].filter((e) => Number(e.dataset.s) >= 0); const st = window.__ccCardSync.state().sources.queue; return { rows: rows.length, slots: pr.slots.length, polling: st.polling }; })()`);
        const off = []; if (r.rows !== r.slots) off.push('rows ' + r.rows + ' vs slots ' + r.slots); if (!r.polling) off.push('not watching while open');
        return { ok: !off.length, detail: off.join('; ') };
      } finally { if (!was) await page.eval('window.__ccQueue.toggle()'); }
    });
  } finally {
    // put every card back the way it was
    for (const tab of Object.keys(opened)) { try { if (opened[tab] === false) await pin(page, tab, false); } catch (e) { /* page gone */ } }
    try { await page.move(4, 300); } catch (e) { /* page gone */ }
    await sleep(400);
  }
  const after = await page.eval(PAGE_STATE);
  await check('storage cc-panel-fuse unchanged', () => ({ ok: hash(before.fuse) === hash(after.fuse), detail: 'before ' + hash(before.fuse) + ' after ' + hash(after.fuse) }));
  await check('storage cc-plugin-settings unchanged', () => ({ ok: hash(before.settings) === hash(after.settings), detail: 'before ' + hash(before.settings) + ' after ' + hash(after.settings) }));
  await check('HTMLElement.prototype.click and dispatchEvent still native', () => ({ ok: after.clickNative && after.dispatchNative, detail: '' }));
  await check('cards open as before', () => ({ ok: J(before.cardsOpen) === J(after.cardsOpen) && before.queueOpen === after.queueOpen, detail: J(before.cardsOpen) + ' -> ' + J(after.cardsOpen) }));
  await check('shared layer: no observers or listeners left behind', () => {
    const b = before.sync && before.sync.sources, a = after.sync && after.sync.sources; if (!a) return { ok: false, detail: 'no state' };
    const bad = Object.keys(a).filter((k) => a[k].subs !== (b[k] ? b[k].subs : 0) || a[k].observing !== (b[k] ? b[k].observing : false) || a[k].polling !== (b[k] ? b[k].polling : false));
    return { ok: !bad.length && before.sync.listening === after.sync.listening, detail: bad.length ? 'differs: ' + bad.join(',') : '' };
  });
  page.close();
}

// ------------------------------------------------------------------------------------------------------------------------------- FIXTURE suite
// the same order as PLUGIN_DEFS in panel-resize-watcher.js; 'cards/*' = every file of overlay/cards (the watcher's 'cards' plugin)
const OVERLAY_ORDER = ['lifecycle.js', 'dom-scope.js', 'ui-kit.js', 'card-sync.js', 'cards/*', 'ui-queue.js', 'ui-bar.js'];
const expand = (list) => list.reduce((a, f) => a.concat(f === 'cards/*' ? fs.readdirSync(path.join(OVERLAY_DIR ? path.resolve(OVERLAY_DIR) : path.join(ROOT, 'overlay'), 'cards')).filter((n) => n.endsWith('.js')).sort().map((n) => 'cards/' + n) : [f]), []);
async function fixtureSuite() {
  suite = 'fixture';
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rec('electron available', true, 'node_modules/electron missing: fixture suite skipped (live suite only)', true); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cards-fixture-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'cards-fixture.html'), String(FIX_PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  try {
    try { page = await cdp.connectToPage(FIX_PORT, /cards-fixture/, 15000); } catch (e) { rec('fixture window opens', false, String(e.message)); return; }
    await page.send('Runtime.enable');
    if (!(await until(() => page.eval('document.readyState === "complete" && !!window.fx'), 10000, 100))) { rec('fixture page loads', false, 'timeout'); return; }
    await page.eval(`localStorage.clear(); 1`);
    for (const f of expand(OVERLAY_ORDER)) {
      let r; try { const alt = OVERLAY_DIR && path.join(path.resolve(OVERLAY_DIR), f); r = await page.eval(fs.readFileSync(alt && fs.existsSync(alt) ? alt : path.join(ROOT, 'overlay', f), 'utf8')); } catch (e) { rec('inject overlay/' + f, false, String(e.message).slice(0, 200)); return; }
      if (!/loaded|torn|undefined/.test(String(r))) { rec('inject overlay/' + f, false, String(r)); return; }
    }
    rec('real overlay files injected into the fixture', true, J(await page.eval("({q: !!window.__ccDom.q('.panel-titlebar[data-panel-id=\"barter\"]'), roots: window.__ccDom.roots().length, tb: document.querySelectorAll('.panel-titlebar').length})")));
    await fixtureTests(page);
  } finally {
    if (page) page.close();
    if (!has('keep-electron')) { try { child.kill(); } catch (e) { /* gone */ } }
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ } }, 3000).unref();
  }
}

async function fixtureTests(page) {
  const SPOT = { barter: 10, equipment: 430, quests: 850 };   // pinned cards would open on top of each other: give each its own column
  const place = (tab) => page.eval(`(() => { const e = document.getElementById('cc-card-${tab}'); if (!e) return 0; e.style.left = '${SPOT[tab] || 10}px'; e.style.top = '40px'; return 1; })()`);
  const fxCalls = () => page.eval('window.fx.calls.slice()');
  const clickIn = async (sel) => { const r = await page.eval(rectOf(sel)); if (!r) throw new Error('no ' + sel + ' :: ' + (await page.eval('(() => { const c = document.querySelector("#cc-card-barter"); return c ? c.className + "|" + c.getBoundingClientRect().width + "|" + [...c.querySelectorAll(".tabtn")].map((b) => b.className + ":" + b.disabled + ":" + Math.round(b.getBoundingClientRect().width)).join(";") : "no card"; })()'))); await page.click(r[0], r[1]); return r; };
  const CARD = '#cc-card-barter';
  // ---- swallowed render errors are logged, but rate-limited (card-sync.js swallow)
  await check('swallowed render errors: logged once per place, not on every repeat', async () => {
    const r = await page.eval(`(() => { const got = []; const old = window.__ccLog; window.__ccLog = { channel: () => ({ warn: (m) => got.push(m) }) };
      try { const S = window.__ccCardSync; for (let i = 0; i < 50; i++) S.swallow('card fixture-a', new Error('boom')); S.swallow('card fixture-b', new Error('other')); } finally { window.__ccLog = old; }
      return got; })()`);
    return { ok: r.length === 2 && /fixture-a/.test(r[0]) && /boom/.test(r[0]) && /fixture-b/.test(r[1]), detail: J(r).slice(0, 200) };
  });
  // ---- Barter: Charm, Buy, Reroll (spend-type buttons: only here, in the fake game)
  await check('barter card opens and matches the fake game', async () => { await pin(page, 'barter', true); await place('barter'); await sleep(200); const a = await agree(page, 'barter', CARD, 1500); a.detail = a.detail || J(await cardFacts(page, 'barter', CARD)).slice(0, 150) + ' / ' + J(await gameFacts(page, 'barter')).slice(0, 100); return a; });
  await check('barter Charm: click is forwarded, card follows the delayed answer while the pointer rests on the button', async () => {
    const before = await fxCalls();
    const pt = await clickIn(CARD + ' .tabtn.charm:not(:disabled)');
    const sent = await until(async () => (await fxCalls()).filter((c) => /barter:charm/.test(c)).length > before.filter((c) => /barter:charm/.test(c)).length, 1500, 50);
    if (!sent) return { ok: false, detail: 'the game never got the click' };
    const ok = await until(async () => { const g = await page.eval('window.fx.game.barter'); const c = await cardFacts(page, 'barter', CARD); return g.budget === 2 && /2 charges left/.test(c.note) && c.subs.some((s) => true) && (await agree(page, 'barter', CARD, 10)).ok; }, 3500, 100);
    return { ok: !!ok, detail: ok ? '' : J(await cardFacts(page, 'barter', CARD)).slice(0, 200) };
  });
  await check('barter Buy: gold and "you hold" change on the card after the game answers', async () => {
    const held0 = await page.eval('window.fx.game.barter.slots[0].held');
    await clickIn(CARD + ' .tabtn.buy:not(:disabled)');
    const ok = await until(async () => { const held = await page.eval('window.fx.game.barter.slots[0].held'); if (held === held0) return false; const c = await cardFacts(page, 'barter', CARD); return c.subs.some((s) => s.includes('you hold ' + held)); }, 3500, 100);
    return { ok: !!ok, detail: ok ? '' : 'card ' + J((await cardFacts(page, 'barter', CARD)).subs) };
  });
  await check('barter Reroll: new items appear on the card, charges back to 3', async () => {
    const names0 = (await cardFacts(page, 'barter', CARD)).names.join();
    await page.eval('window.fx.game.barter.slots.forEach((s) => { s.qty = 1; })');
    await clickIn(CARD + ' .tabtn.reroll:not(:disabled)');
    const ok = await until(async () => { const g = await page.eval('window.fx.game.barter.budget'); if (g !== 3) return false; return (await agree(page, 'barter', CARD, 10)).ok; }, 4000, 100);
    return { ok: !!ok, detail: ok ? '' : 'card names ' + (await cardFacts(page, 'barter', CARD)).names.join() + ' (was ' + names0 + ')' };
  });
  // ---- Equipment: toggles and a loadout pick through the card's menu
  await check('equipment toggles (Potion boosts, Spirit modifier) follow real clicks', async () => {
    await pin(page, 'equipment', true); await place('equipment'); await sleep(200);
    for (const [label, key] of [['Potion boosts', 'potion'], ['Spirit modifier', 'spirit']]) {
      const g0 = (await gameFacts(page, 'equipment'))[key], want = g0 === 'ON' ? 'OFF' : 'ON';
      await clickIn('#cc-card-equipment .tactbar .tabtn:nth-child(' + (key === 'potion' ? 1 : 2) + ')');
      const ok = await until(async () => (await gameFacts(page, 'equipment'))[key] === want && (await cardFacts(page, 'equipment', '#cc-card-equipment'))[key] === want, 3000, 100);
      if (!ok) return { ok: false, detail: label + ' did not follow: ' + J(await cardFacts(page, 'equipment', '#cc-card-equipment')) };
    }
    return true;
  });
  await check('equipment loadout pick through the card menu switches the game (family, then slot) and the card follows', async () => {
    await clickIn('#cc-card-equipment .tload');
    const item = await until(() => page.eval(`(() => { const m = [...document.querySelectorAll('.cc-menu *')].find((e) => e.children.length === 0 && /^range 1$/.test(e.textContent.trim())); if (!m) return null; const r = m.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`), 1500, 100);
    if (!item) return { skip: 'kit menu markup not found' };
    await page.click(item[0], item[1]);
    const ok = await until(async () => (await page.eval('window.fx.game.equip.loadout')) === 'range_1' && /range 1/.test((await cardFacts(page, 'equipment', '#cc-card-equipment')).loadout), 4000, 100);
    return { ok: !!ok, detail: ok ? '' : 'game ' + (await page.eval('window.fx.game.equip.loadout')) + ' card ' + (await cardFacts(page, 'equipment', '#cc-card-equipment')).loadout };
  });
  // ---- redraw rules, on the Quests card (its source changes without any click)
  await check('quests card follows a source change that nobody clicked', async () => {
    await pin(page, 'quests', true); await place('quests'); await sleep(200); await page.move(5, 700);
    await page.eval('window.fx.setQuest(1, "Step 3 / 3")');
    const ok = await until(async () => (await cardFacts(page, 'quests', '#cc-card-quests')).n === 3 && (await page.eval('document.querySelector("#cc-card-quests").textContent.includes("Step 3 / 3")')), 2500, 100);
    return { ok: !!ok, detail: ok ? '' : 'card did not show the new step' };
  });
  await check('a change waits while the pointer is on a hover-card row, and lands when it leaves', async () => {
    const r = await page.eval(rectOf('#cc-card-quests .tq.hv, #cc-card-quests .tq')); if (!r) return { skip: 'no quest rows' };
    await page.move(r[0], r[1]); await sleep(150);
    await page.eval('window.fx.setQuest(0, "Step 5 / 5")'); await sleep(900);
    const held = await page.eval('!document.querySelector("#cc-card-quests").textContent.includes("Step 5 / 5")');
    await page.move(5, 700);
    const landed = await until(() => page.eval('document.querySelector("#cc-card-quests").textContent.includes("Step 5 / 5")'), 2500, 100);
    return { ok: held && !!landed, detail: (held ? '' : 'redrew under the pointer (' + J(await page.eval('window.__ccCardSync.state()')).slice(-260) + '); ') + (landed ? '' : 'never landed after the pointer left') };
  });
  await check('a button held down is not destroyed by a redraw (the click is not lost)', async () => {
    const r = await page.eval(rectOf(CARD + ' .tabtn.buy:not(:disabled)')); if (!r) return { skip: 'no enabled Buy button' };
    const calls0 = (await fxCalls()).filter((c) => /barter:buy/.test(c)).length;
    await page.move(r[0], r[1]); await page.down(r[0], r[1]);
    await page.eval('(() => { const e = document.querySelector("' + CARD + ' .tabtn.buy:not(:disabled)"); window.__btn = e; return 1; })()');
    await page.eval('window.fx.game.barter.gold -= 1; window.fx.game.barter.budget = Math.max(window.fx.game.barter.budget, 1); document.querySelector("#barter-panel .barter-header-budget").textContent = "x"');   // a change of the source while the button is down
    await sleep(700);
    const same = await page.eval('window.__btn && window.__btn.isConnected');
    await page.up(r[0], r[1]);
    const sent = await until(async () => (await fxCalls()).filter((c) => /barter:buy/.test(c)).length > calls0, 1500, 50);
    await page.eval('delete window.__btn; 1');
    return { ok: !!same && !!sent, detail: (same ? '' : 'the pressed button was replaced mid-click; ') + (sent ? '' : 'the click never reached the game') };
  });
  await check('barter: with no charges left the card is greyed out and says so; it comes back with the charges', async () => {
    if (!(await page.eval('!!document.querySelector("' + CARD + '")'))) return { skip: 'no barter card' };
    await page.eval('(() => { const p = document.getElementById("barter-panel"), o = document.createElement("div"); o.className = "barter-consumed-overlay"; o.innerHTML = "<div class=\\"barter-consumed-title\\">All charges used. Panel XP paid.</div><div class=\\"barter-consumed-sub\\">Reroll to roll a new shop.</div>"; p.appendChild(o); window.__spentOv = o; return 1; })()');
    const grey = await until(() => page.eval('document.querySelectorAll("' + CARD + ' .trw.spent").length > 0 && /No charges left/.test(document.querySelector("' + CARD + '").textContent)'), 3000, 100);
    await page.eval('window.__spentOv && window.__spentOv.remove(); delete window.__spentOv; 1');
    const back = await until(() => page.eval('document.querySelectorAll("' + CARD + ' .trw.spent").length === 0 && !/No charges left/.test(document.querySelector("' + CARD + '").textContent)'), 3000, 100);
    return { ok: !!grey && !!back, detail: (grey ? '' : 'not greyed out with the overlay up; ') + (back ? '' : 'still greyed out after the overlay went') };
  });
  // ---- the queue (data comes from the bridge; the fixture's panel is stale until refreshQueuePanel())
  await check('queue: follows a silent change of the game data without any click', async () => {
    await page.eval('window.__ccQueue.toggle(); 1'); await sleep(500);
    const n0 = await page.eval('document.querySelectorAll("#cc-queue .cc-q-row").length');
    if (n0 !== 2) return { ok: false, detail: 'rows ' + n0 + ' (wanted 2)' };
    await page.eval('(() => { const Q = window.fx.game.queue; Q.slots[0].sel = 1; Q.rev++; })()');
    const ok = await until(() => page.eval('window.__ccQueue.model().slots[0].sel === 1 && !!document.querySelector("#cc-queue .cc-q-row[data-s=\\"0\\"]")'), 2500, 100);
    return { ok: !!ok, detail: ok ? '' : 'model still shows the old selection' };
  });
  await check('queue: selecting an option refreshes the hidden game panel first, is forwarded, and the card follows', async () => {
    const stale = await page.eval('window.fx.queueStale()');
    const res = await page.eval(`(() => { const m = window.__ccQueue.model(), s = m.slots[1], op = s.opts[1]; return window.__ccQueue.selectOption(1, 1, op); })()`);
    const calls = await fxCalls();
    const ok = await until(async () => (await page.eval('window.fx.game.queue.slots[1].sel')) === 1 && (await page.eval('window.__ccQueue.model().slots[1].sel')) === 1, 3500, 100);
    const bad = []; if (!stale) bad.push('(fixture panel was not stale: test is weak)'); if (res !== true) bad.push('selectOption refused: ' + res); if (!calls.includes('bridge:refreshQueuePanel')) bad.push('no fresh redraw of the hidden panel'); if (!calls.includes('queue:select:1:1')) bad.push('click not forwarded'); if (!ok) bad.push('card did not follow');
    return { ok: !bad.length, detail: bad.join('; ') };
  });
  await check('queue: watching stops when the panel is closed', async () => {
    await page.eval('window.__ccQueue.toggle(); 1'); await sleep(400);
    const st = await page.eval('window.__ccCardSync.state().sources.queue');
    return { ok: st.subs === 0 && !st.polling, detail: J(st) };
  });
  // ---- hygiene
  for (const t of ['barter', 'equipment', 'quests']) await pin(page, t, false);
  await sleep(300);
  await check('after closing every card the shared layer holds no observer, poll or listener', async () => {
    const s = await page.eval('window.__ccCardSync.state()');
    const open = Object.keys(s.sources).filter((k) => s.sources[k].subs || s.sources[k].observing || s.sources[k].polling);
    return { ok: !open.length && !s.listening, detail: open.join(',') + (s.listening ? ' (pointer listeners still on)' : '') };
  });
  await check('prototypes untouched in the fixture page', async () => (await page.eval(PAGE_STATE)).clickNative);
}

// ------------------------------------------------------------------------------------------------------------------------------- run
(async () => {
  const t0 = Date.now();
  if (!has('fixture-only')) { try { await liveSuite(); } catch (e) { suite = 'live'; rec('live suite crashed', false, String(e && e.stack || e).slice(0, 300)); } }
  if (!has('live-only')) { try { await fixtureSuite(); } catch (e) { suite = 'fixture'; rec('fixture suite crashed', false, String(e && e.stack || e).slice(0, 300)); } }
  suite = 'lint';
  await check('forwards stay in one place (npm run lint:forwards)', () => { const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'lint-forwards.js'), '--quiet'], { encoding: 'utf8' }); return { ok: r.status === 0, detail: (r.stdout || '').trim().split('\n').slice(-1)[0] }; });
  const w = [Math.max(5, ...rows.map((r) => r.suite.length)), Math.max(4, ...rows.map((r) => r.name.length))];
  console.log('\n' + 'SUITE'.padEnd(w[0]) + '  ' + 'TEST'.padEnd(w[1]) + '  RESULT  DETAIL');
  rows.forEach((r) => console.log(r.suite.padEnd(w[0]) + '  ' + r.name.padEnd(w[1]) + '  ' + r.res.padEnd(6) + '  ' + r.detail));
  const n = (k) => rows.filter((r) => r.res === k).length;
  console.log('\n' + n('PASS') + ' passed, ' + n('FAIL') + ' failed, ' + n('SKIP') + ' skipped in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  process.exit(n('FAIL') ? 1 : 0);
})();
