// Default layout test.  npm run test:default-layout   (options: --fixture-port=9335, --preview=<file.html> writes the three-size preview page)
//
// Part 1 is pure arithmetic on overlay/default-layout.js: at many window sizes, with and without Info Bars, nothing leaves the usable area, nothing of
// different spots overlaps, the notification band and the left tab strip stay clear, sizes respect the panels' minimums, every id is one the layout import accepts.
// Part 2 runs the REAL ui-layout.js and default-layout.js in a private hidden Electron window on a fake game shell (scripts/fixtures/layout-fixture.html):
// "ScapeLite default" really puts every panel where the arithmetic says (kit panels and scaled game windows), and "Back to my old layout" puts everything back.
// Nothing of the real game, its settings or its storage is touched.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'overlay', 'default-layout.js'));
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9335));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 240) }); } }
const J = JSON.stringify;

const SIZES = [[1920, 1080], [2560, 1369], [1366, 768], [1280, 720], [1600, 900], [1920, 1200], [2560, 1440], [3440, 1440], [1024, 768], [3840, 2160]];
const vpOf = (w, h, bars) => ({ w, h, top: bars ? 34 : 0, bottom: bars ? 34 : 0, zoom: Math.min(w / 1920, h / 1080), g: 1 });
const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function geometry(w, h, bars) {
  const b = D.build(vpOf(w, h, bars)), fr = b.frame, out = [], ids = Object.keys(b.rects);
  const usable = { x: 0, y: fr.top, w: fr.w, h: fr.uh };
  ids.forEach((id) => {
    const r = b.rects[id];
    if (r.x < -0.5 || r.y < usable.y - 0.5 || r.x + r.w > usable.w + 0.5 || r.y + r.h > usable.y + usable.h + 0.5) out.push(id + ' outside the usable area ' + [r.x, r.y, r.w, r.h].map(Math.round));
  });
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = b.rects[ids[i]], c = b.rects[ids[j]];
    if (a.stack !== c.stack && hit(a, c)) out.push(ids[i] + ' overlaps ' + ids[j]);
  }
  D.keepOut(fr).forEach((k) => ids.forEach((id) => { if (hit(b.rects[id], k)) out.push(id + ' covers the ' + k.name); }));
  return out;
}

// ---- part 1 -------------------------------------------------------------------------------------------------------------------------------
function part1() {
  check_sync('every window size x bars on/off: inside the usable area, no overlaps between spots, keep-outs clear', () => {
    const bad = []; SIZES.forEach(([w, h]) => [true, false].forEach((bars) => geometry(w, h, bars).forEach((m) => bad.push(w + 'x' + h + (bars ? '' : ' no bars') + ': ' + m))));
    return { ok: bad.length === 0, detail: bad.slice(0, 4).join(' | ') || SIZES.length * 2 + ' cases' };
  });
  check_sync('the user’s window (2560 x 1369, zoom 1.2676, global size 100%) has the right-hand columns clear of the top band', () => {
    const b = D.build({ w: 2560, h: 1369, top: 34, bottom: 34, zoom: 1369 / 1080, g: 1 }); const r = b.rects['cc-queue'];
    return { ok: r.y >= 34 + 150 * b.frame.f - 1 && r.x + r.w <= 2560, detail: J(Object.assign({}, r, { w: Math.round(r.w), h: Math.round(r.h) })) };
  });
  check_sync('resizable panels keep a size the editor accepts (width 200+, height 110+) and a scale inside 0.5 to 2', () => {
    const bad = []; SIZES.forEach(([w, h]) => { const b = D.build(vpOf(w, h, true)); Object.keys(b.panels).forEach((id) => { const p = b.panels[id]; if (p.w != null && (p.w < 200 || p.h < 110)) bad.push(id + ' size'); if (p.s != null && (p.s < 0.5 || p.s > 2)) bad.push(w + 'x' + h + ' ' + id + ' scale ' + p.s); }); });
    return { ok: !bad.length, detail: bad.slice(0, 4).join(' | ') };
  });
  check_sync('game window scales stay inside what the size menu allows', () => {
    const bad = []; SIZES.forEach(([w, h]) => { const b = D.build(vpOf(w, h, true)); Object.keys(b.gameScales).forEach((id) => { const s = b.gameScales[id], mn = 0.5 / Math.max(1, b.frame.zoom); if (s < mn - 1e-6 || s > 2) bad.push(w + 'x' + h + ' ' + id + ' ' + s); }); });
    return { ok: !bad.length, detail: bad.slice(0, 4).join(' | ') };
  });
  check_sync('every id is accepted by the layout import (cc-name or g:name), tab groups use only known panels', () => {
    const b = D.build(vpOf(1920, 1080, true)), bad = Object.keys(b.panels).filter((id) => !/^(cc-[a-z-]+|g:[a-z]+)$/.test(id));
    const gbad = [].concat(...b.groups).filter((id) => !b.panels[id] || id.indexOf('g:') === 0);
    return { ok: !bad.length && !gbad.length && b.groups.every((g) => g.length > 1), detail: bad.concat(gbad).join(',') };
  });
  check_sync('members of one tab group share one spot (so the strip is the only difference)', () => {
    const b = D.build(vpOf(2560, 1369, true)), bad = [];
    b.groups.forEach((g) => { const r0 = b.rects[g[0]]; g.forEach((id) => { const r = b.rects[id]; if (Math.abs(r.x - r0.x) > 1 || Math.abs(r.y - r0.y) > 1) bad.push(id); }); });
    return { ok: !bad.length, detail: bad.join(',') };
  });
  check_sync('a game window and the pinned card of the same family sit within 3 px of each other', () => {
    const b = D.build(vpOf(2560, 1369, true)), pairs = [['g:inventory', 'cc-card-inventory'], ['g:equipment', 'cc-card-equipment'], ['g:barter', 'cc-card-barter'], ['g:skills', 'cc-card-skills'], ['g:quests', 'cc-card-quests'], ['g:diary', 'cc-card-diary'], ['g:friends', 'cc-card-friends']];
    const bad = pairs.filter(([a, c]) => Math.abs(b.rects[a].x - b.rects[c].x) > 3 || Math.abs(b.rects[a].y - b.rects[c].y) > 3 || Math.abs(b.rects[a].w - b.rects[c].w) > 3);
    return { ok: !bad.length, detail: bad.map((p) => p.join('~')).join(',') };
  });
  check_sync('deterministic and viewport-relative: the same window gives the same layout; a wider window moves only the right-hand columns', () => {
    const a = J(D.build(vpOf(1920, 1080, true)).panels), a2 = J(D.build(vpOf(1920, 1080, true)).panels);
    const l = D.build(vpOf(1920, 1080, true)).panels, w = D.build(vpOf(2560, 1080, true)).panels;
    return { ok: a === a2 && l['cc-goals'].x === w['cc-goals'].x && w['cc-queue'].x - l['cc-queue'].x === 640, detail: 'queue x ' + l['cc-queue'].x + ' -> ' + w['cc-queue'].x };
  });
  check_sync('the look is the kit defaults (nothing the player chose for colours is forced onto another look)', () => ({ ok: J(D.LOOK) === J({ uiPalette: 'default', uiDensity: 'cozy', uiFontPx: 0, uiAccent: '' }), detail: J(D.LOOK) }));
}
function check_sync(name, fn) { try { const r = fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 240) }); } }

// ---- the preview page ---------------------------------------------------------------------------------------------------------------------
function previewHtml() {
  const NAMEOF = { 'cc-queue': 'Task queue', 'cc-xp-tracker': 'XP tracker', 'cc-route-panel': 'Route Advisor', 'cc-goals': 'Goals / Luck / Materials / Tree (tabs)', 'cc-chat': 'Chat', 'cc-card-inventory': 'Inventory, Equipment, Barter (tabs or window)', 'cc-card-skills': 'Skills, Quests, Diary, Friends (tabs or window)', 'g:tasks': 'Game Tasks window' };
  const COL = { queue: '#c9a227', xp: '#4aa8ff', route: '#b07cff', helpers: '#5fe06d', chat: '#ff8a5c', slotA: '#e0c15f', slotB: '#7fd1c0' };
  const shown = ['cc-queue', 'cc-xp-tracker', 'cc-route-panel', 'cc-goals', 'cc-chat', 'cc-card-inventory', 'cc-card-skills'];
  const cases = [[1920, 1080, 'Common 1080p window (zoom 1.00)'], [2560, 1369, 'Your window: 2560 x 1369 (zoom 1.27)'], [1366, 768, 'Small laptop 1366 x 768 (zoom 0.71)']];
  const scene = ([w, h, t]) => {
    const b = D.build(vpOf(w, h, true)), k = 560 / w, boxes = shown.map((id) => { const r = b.rects[id]; return '<div class="p" style="left:' + r.x * k + 'px;top:' + r.y * k + 'px;width:' + r.w * k + 'px;height:' + r.h * k + 'px;border-color:' + COL[r.stack] + ';background:' + COL[r.stack] + '22"><b>' + NAMEOF[id] + '</b></div>'; }).join('');
    const ko = D.keepOut(b.frame).map((o) => '<div class="ko" style="left:' + o.x * k + 'px;top:' + o.y * k + 'px;width:' + o.w * k + 'px;height:' + o.h * k + 'px"><i>' + (o.name.indexOf('noti') === 0 ? 'notifications' : 'Info + tab strip') + '</i></div>').join('');
    return '<div class="sc"><h3>' + t + '</h3><div class="scr" style="width:' + w * k + 'px;height:' + h * k + 'px"><div class="bar" style="height:' + 34 * k + 'px;top:0">Info Bar</div><div class="bar" style="height:' + 34 * k + 'px;bottom:0">Info Bar</div>' + ko + boxes + '</div></div>';
  };
  return '<!doctype html><meta charset="utf-8"><title>ScapeLite default layout, preview</title><style>body{background:#10101a;color:#dcdce8;font:14px system-ui;margin:20px}h1{font-size:20px;color:#ffd24a}h3{margin:14px 0 6px;font-size:14px;color:#dcdce8}.scr{position:relative;background:#1c1c28;border:1px solid #3a3a4c;overflow:hidden}.bar{position:absolute;left:0;right:0;background:#2a2a3a;color:#8a8aa0;font-size:10px;line-height:12px;text-align:center}.p{position:absolute;box-sizing:border-box;border:2px solid;border-radius:5px;font-size:10px;overflow:hidden;padding:2px 4px}.p b{color:#fff;font-weight:600}.ko{position:absolute;background:repeating-linear-gradient(45deg,#ffffff0a,#ffffff0a 5px,#ffffff14 5px,#ffffff14 10px);color:#8a8aa0;font-size:10px}.ko i{padding:2px 4px;display:block;font-style:normal}p{color:#9a9ab0;max-width:760px}</style><h1>ScapeLite default layout</h1><p>Where each panel goes in three window sizes. Hatched areas are kept clear (invites, task popups and toasts at the top; the game’s Info panel and left tab strip). Panels that share a colour share one spot: the pinned cards of one family become tabs, the game’s window of that family sits on the same spot.</p>' + cases.map(scene).join('') + '</body>';
}

// ---- part 2 -------------------------------------------------------------------------------------------------------------------------------
const inject = async (page, f) => page.eval(fs.readFileSync(path.join(ROOT, 'overlay', f), 'utf8'));
async function setWindow(page, w, h) { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(250); }
const READ = `(() => { const out = {}; const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
  document.querySelectorAll('.kp').forEach((e) => { out[e.id] = r(e); });
  document.querySelectorAll('.gw').forEach((e) => { out['g:' + e.querySelector('.panel-titlebar').dataset.panelId] = r(e); });
  return out; })()`;

async function part2() {
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rows.push({ name: 'fixture window', res: 'SKIP', detail: 'node_modules/electron missing' }); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-layout-fixture-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'layout-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  try {
    page = await cdp.connectToPage(PORT, /layout-fixture/, 15000);
    await page.send('Runtime.enable');
    for (let i = 0; i < 60 && !(await page.eval('document.readyState === "complete" && !!window.fx')); i++) await sleep(100);
    await page.eval(`localStorage.clear(); 1`);
    await setWindow(page, 1920, 1080);
    await inject(page, 'default-layout.js'); await inject(page, 'ui-layout.js');
    await page.eval(`fxShow(true); 1`); await sleep(300);

    const before = await page.eval(READ);
    await check('the Layout Editor sees the ScapeLite panels and the game’s windows (they live in the HUD layer)', async () => {
      const n = await page.eval(`(() => ({ kit: __ccUIInfo.ids().length, layouts: __ccUILayout.profiles() }))()`);
      return { ok: n.kit === 15, detail: J(n) };
    });
    await check('the editor bar offers "ScapeLite default" and no way back yet', async () => {
      await page.eval(`__ccUILayout.toggle(); 1`); await sleep(300);
      const t = await page.eval(`(() => { const b = [...document.querySelectorAll('#cc-ed-bar button')]; const d = b.find((x) => x.textContent === 'ScapeLite default'), k = b.find((x) => /Back to my old/.test(x.textContent)); return { def: !!d, back: !!k, backShown: !!k && k.style.display !== 'none' }; })()`);
      await page.eval(`__ccUILayout.toggle(); 1`);
      return { ok: t.def && t.back && !t.backShown, detail: J(t) };
    });

    for (const [w, h] of [[1920, 1080], [2560, 1369], [1366, 768], [1600, 900]]) {
      await check('applied at ' + w + ' x ' + h + ': every panel sits where the arithmetic says (within 3 px), nothing overlaps or leaves the window', async () => {
        await setWindow(page, w, h); await page.eval(`fx.bars = { top: 34, bottom: 34 }; fxShow(true); 1`); await sleep(300);
        await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(900);
        const got = await page.eval(READ), b = D.build({ w, h, top: 34, bottom: 34, zoom: Math.min(w / 1920, h / 1080), g: 1 }), bad = [];
        Object.keys(b.rects).forEach((id) => {
          const e = b.rects[id], a = got[id]; if (!a) { bad.push(id + ' missing'); return; }
          if (Math.abs(a[0] - e.x) > 3 || Math.abs(a[1] - e.y) > 3) bad.push(id + ' at ' + Math.round(a[0]) + ',' + Math.round(a[1]) + ' wanted ' + Math.round(e.x) + ',' + Math.round(e.y));
          else if (Math.abs(a[2] - e.w) > 3) bad.push(id + ' width ' + Math.round(a[2]) + ' wanted ' + Math.round(e.w));
        });
        const ids = Object.keys(got);
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const A = b.rects[ids[i]], B = b.rects[ids[j]]; if (!A || !B || A.stack === B.stack) continue; const ra = { x: got[ids[i]][0], y: got[ids[i]][1], w: got[ids[i]][2], h: got[ids[i]][3] }, rb = { x: got[ids[j]][0], y: got[ids[j]][1], w: got[ids[j]][2], h: got[ids[j]][3] }; if (hit(ra, rb)) bad.push(ids[i] + ' overlaps ' + ids[j]); }
        return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || ids.length + ' panels' };
      });
    }
    await check('three tab strips appear (helpers, inventory-type cards, character-type cards) and only one member of each group shows', async () => {
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(1500);
      const t = await page.eval(`(() => ({ strips: document.querySelectorAll('#cc-grp-root .strip').length, hidden: document.querySelectorAll('.kp[data-cc-gh]').length }))()`);
      return { ok: t.strips === 3 && t.hidden === 3 + 2 + 3, detail: J(t) };   // 4+3+4 members, one lead each
    });
    await check('"Back to my old layout" is offered after using the default, and the layout is called ScapeLite default', async () => {
      const s = await page.eval(`(() => ({ can: __ccUILayout.canGoBack, active: __ccUILayout.active(), names: __ccUILayout.profiles() }))()`);
      return { ok: s.can && s.active === 'ScapeLite default' && s.names.indexOf('Default') >= 0, detail: J(s) };
    });
    await check('pressing the default again (new window size) keeps the FIRST backup, not the default itself', async () => {
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(300);
      await page.eval(`__ccUILayout.backToOld(); 1`); await sleep(500);
      await setWindow(page, 1920, 1080); await sleep(300);
      const after = await page.eval(READ), bad = [];
      Object.keys(before).forEach((id) => { const a = after[id], b0 = before[id]; if (!a || Math.abs(a[0] - b0[0]) > 1.5 || Math.abs(a[1] - b0[1]) > 1.5 || Math.abs(a[2] - b0[2]) > 1.5) bad.push(id + ' ' + J(a && a.map(Math.round)) + ' was ' + J(b0.map(Math.round))); });
      return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || 'all ' + Object.keys(before).length + ' panels back' };
    });
    await check('after going back: the saved layouts, the scales and the stored sizes are as before; no way back is offered any more', async () => {
      const s = await page.eval(`(() => ({ can: __ccUILayout.canGoBack, active: __ccUILayout.active(), names: __ccUILayout.profiles(), scales: Object.keys(fx.scales).length, mult: Object.keys(fx.mult).length, sizeKeys: Object.keys(localStorage).filter((k) => k.indexOf('cc-size-') === 0).length }))()`);
      return { ok: !s.can && s.active === 'Default' && J(s.names) === '["Default"]' && s.scales === 0 && s.mult === 0 && s.sizeKeys === 0, detail: J(s) };
    });
    await check('your own saved layout survives: Default (with a moved panel) is untouched by the default and by going back', async () => {
      await page.eval(`__ccUILayout.apply('Default'); 1`); await sleep(2600);   // the editor ignores moves for 2 s after the window changed size
      await page.eval(`(() => { const el = document.getElementById('cc-goals'); el.style.left = '333px'; el.style.top = '222px'; 1; })()`); await sleep(1200);
      const saved = await page.eval(`JSON.parse(localStorage.getItem('cc-layout:v1')).profiles.Default.panels['cc-goals']`);
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(500);
      await page.eval(`__ccUILayout.backToOld(); 1`); await sleep(500);
      const after = await page.eval(`JSON.parse(localStorage.getItem('cc-layout:v1')).profiles.Default.panels['cc-goals']`);
      const pos = await page.eval(`(() => { const e = document.getElementById('cc-goals'); return [e.style.left, e.style.top]; })()`);
      return { ok: saved && after && saved.x === 333 && after.x === 333 && after.y === 222 && J(pos) === '["333px","222px"]', detail: J({ saved, after, pos }) };
    });
    await check('a game window moved by hand after the default forgets its target (it stays where the player put it)', async () => {
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(500);
      await page.eval(`(() => { const e = document.querySelector('.gw.inventory'); e.style.left = '40px'; e.style.top = '40px'; 1; })()`); await sleep(1300);
      const p = await page.eval(`JSON.parse(localStorage.getItem('cc-layout:v1')).profiles['ScapeLite default'].panels['g:inventory']`);
      return { ok: p && p.x === 40 && p.y === 40 && p.tx === undefined, detail: J(p) };
    });
    await check('without Info Bars (Full Vanilla look) the layout starts at the top of the window', async () => {
      await page.eval(`__ccUILayout.backToOld(); 1`); await sleep(300);
      await setWindow(page, 1920, 1080); await page.eval(`fx.bars = { top: 0, bottom: 0 }; fxShow(true); 1`); await sleep(300);
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(900);
      const got = await page.eval(READ), b = D.build({ w: 1920, h: 1080, top: 0, bottom: 0, zoom: 1, g: 1 });
      const a = got['cc-queue'], e = b.rects['cc-queue'];
      return { ok: Math.abs(a[1] - e.y) <= 3 && e.y < 200, detail: 'queue y ' + Math.round(a[1]) + ' wanted ' + Math.round(e.y) };
    });
    await check('teardown leaves no editor or tab strip behind', async () => (await page.eval(`__ccUILayout.teardown(); !document.getElementById('cc-ed-root') && !document.getElementById('cc-grp-root')`)) === true);
  } catch (e) {
    rows.push({ name: 'harness', res: 'FAIL', detail: String(e && e.stack || e).slice(0, 300) });
  } finally {
    if (page) page.close();
    try { child.kill(); } catch (e) { /* gone */ }
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ } }, 3000).unref();
  }
}

(async () => {
  const t0 = Date.now();
  const pv = arg('preview', '');
  if (pv) { fs.writeFileSync(pv, previewHtml()); console.log('preview written: ' + pv); return; }
  part1();
  await part2();
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  console.log('\n' + 'TEST'.padEnd(w) + '  RESULT  DETAIL');
  rows.forEach((r) => console.log(r.name.padEnd(w) + '  ' + r.res.padEnd(6) + '  ' + r.detail));
  const f = rows.filter((r) => r.res === 'FAIL').length;
  console.log('\n' + (rows.length - f) + ' passed, ' + f + ' failed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  process.exit(f ? 1 : 0);
})();
