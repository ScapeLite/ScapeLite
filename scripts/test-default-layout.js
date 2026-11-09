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
  // ---- the design rules: one grid, one column width, one scale, shared lines, equal margins ------------------------------------------------
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1.5 : tol);
  const DOCK = ['cc-queue', 'cc-xp-tracker', 'cc-card-inventory', 'cc-card-equipment', 'cc-card-barter', 'cc-card-skills', 'cc-card-quests', 'cc-card-diary', 'cc-card-friends', 'g:inventory', 'g:equipment', 'g:barter', 'g:skills', 'g:quests', 'g:diary', 'g:friends'];
  check_sync('one column width: everything docked on the right is exactly the same width (352 design px)', () => {
    const bad = []; SIZES.forEach(([w, h]) => { const b = D.build(vpOf(w, h, true)); DOCK.forEach((id) => { if (!near(b.rects[id].w, D.CW * b.frame.f, 1.5)) bad.push(w + 'x' + h + ' ' + id + ' ' + Math.round(b.rects[id].w) + ' wanted ' + Math.round(D.CW * b.frame.f)); }); });
    return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || DOCK.length + ' panels x ' + SIZES.length + ' sizes' };
  });
  check_sync('two docks, shared lines: both columns start at the same y, split at the same y, end at the same bottom edge; gutters are equal (8 design px)', () => {
    const bad = []; SIZES.forEach(([w, h]) => {
      const b = D.build(vpOf(w, h, true)), f = b.frame.f, R = b.rects, g = D.GAP * f, tag = w + 'x' + h + ': ';
      const top = b.frame.top + D.Y1 * f, bottom = b.frame.top + b.frame.uh - D.M * f;
      if (!near(R['cc-queue'].y, top) || !near(R['g:inventory'].y, top) || !near(R['cc-card-inventory'].y, top)) bad.push(tag + 'row 1 starts at different y');
      if (!near(R['cc-xp-tracker'].y, R['g:skills'].y) || !near(R['cc-xp-tracker'].y, R['cc-card-skills'].y)) bad.push(tag + 'row 2 starts at different y');
      if (!near(R['cc-xp-tracker'].y + R['cc-xp-tracker'].h, bottom) || !near(R['cc-card-skills'].y + R['cc-card-skills'].h, bottom)) bad.push(tag + 'bottom edges differ from ' + Math.round(bottom));
      if (!near(R['cc-xp-tracker'].y - (R['cc-queue'].y + R['cc-queue'].h), g, 2)) bad.push(tag + 'queue/xp gutter ' + Math.round(R['cc-xp-tracker'].y - R['cc-queue'].y - R['cc-queue'].h));
      if (!near(R['cc-queue'].x - (R['cc-card-inventory'].x + R['cc-card-inventory'].w), g, 2)) bad.push(tag + 'column gutter');
      if (!near(w - (R['cc-queue'].x + R['cc-queue'].w), Math.max(D.MR * f, 34), 2)) bad.push(tag + 'right margin');
      if (w - (R['cc-queue'].x + R['cc-queue'].w) < 30) bad.push(tag + 'the Route Advisor handle (30 px) would touch the dock');
    });
    return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || SIZES.length + ' sizes' };
  });
  check_sync('left side: the chat and the helpers keep the same margins; the chat sits D.M above the bottom Info Bar', () => {
    const bad = []; SIZES.forEach(([w, h]) => {
      const b = D.build(vpOf(w, h, true)), f = b.frame.f, R = b.rects, tag = w + 'x' + h + ': ';
      if (!near(R['cc-chat'].x, D.M * f, 1.5)) bad.push(tag + 'chat x ' + Math.round(R['cc-chat'].x));
      if (!near(R['cc-chat'].y + R['cc-chat'].h, b.frame.top + b.frame.uh - D.M * f, 2)) bad.push(tag + 'chat bottom');
      ['cc-goals', 'cc-droplog', 'cc-treeadv', 'cc-advisor', 'cc-diary-credits'].forEach((id) => { if (!near(R[id].x, D.HX * f, 1.5) || !near(R[id].y, b.frame.top + D.Y1 * f, 1.5)) bad.push(tag + id + ' not at the helpers spot'); });
    });
    return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || SIZES.length + ' sizes' };
  });
  check_sync('on the 8 px grid at f = 1 (1920 x 1080 with bars): every left edge and every width is a multiple of 8 (kit panels within 1 px)', () => {
    const b = D.build(vpOf(1920, 1080, true)), bad = []; Object.keys(b.rects).forEach((id) => {
      const r = b.rects[id], m8 = (v) => { const k = Math.round(v / 8) * 8; return Math.abs(v - k) <= 1; };
      if (!m8(r.x)) bad.push(id + ' x ' + r.x); if (D.KIT.find((e) => e.id === id && !e.w) === undefined && !m8(r.w)) bad.push(id + ' w ' + Math.round(r.w * 10) / 10);
    });
    return { ok: !bad.length, detail: bad.slice(0, 4).join(' | ') || Object.keys(b.rects).length + ' panels' };
  });
  check_sync('one scale: every ScapeLite panel gets the same size multiplier at one window size', () => {
    const bad = []; SIZES.forEach(([w, h]) => { const b = D.build(vpOf(w, h, true)), s = new Set(); Object.keys(b.panels).filter((id) => id.indexOf('cc-') === 0).forEach((id) => s.add(b.panels[id].s)); if (s.size !== 1) bad.push(w + 'x' + h + ' ' + [...s].join(',')); });
    return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') };
  });
  check_sync('few windows open: only the task queue, the XP tracker and the chat; the Route Advisor is not placed (it keeps its own handle)', () => {
    const b = D.build(vpOf(1920, 1080, true));
    return { ok: J(b.open) === J(['__ccQueue', '__ccXpTracker', '__ccChat']) && b.close.length >= 5 && !b.panels['cc-route-panel'] && !b.close.some((n) => b.open.includes(n)), detail: J({ open: b.open, close: b.close.length }) };
  });
  check_sync('the look is the kit defaults (nothing the player chose for colours is forced onto another look)', () => ({ ok: J(D.LOOK) === J({ uiPalette: 'default', uiDensity: 'cozy', uiFontPx: 0, uiAccent: '' }), detail: J(D.LOOK) }));
}
function check_sync(name, fn) { try { const r = fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 240) }); } }

// ---- the preview page ---------------------------------------------------------------------------------------------------------------------
// A mock of the screen at four window sizes: what the layout places, what is open (solid), what is placed but closed (dashed), what is kept clear.
// node scripts/test-default-layout.js --preview=docs/default-layout-preview.html, then node scripts/shoot-page.js <html> docs/default-layout-preview.png 1360 1240
function previewHtml() {
  const TITLE = { 'cc-queue': 'Task queue', 'cc-xp-tracker': 'XP tracker', 'cc-chat': 'Chat', 'g:inventory': 'Inventory', 'g:skills': 'Skills', 'cc-goals': 'Goals · Drop Luck · Materials · Tree · Advisor · Locations' };
  const SHOWN = [['cc-queue', 'open'], ['cc-xp-tracker', 'open'], ['cc-chat', 'open'], ['g:inventory', 'game'], ['g:skills', 'game'], ['cc-goals', 'closed']];
  const cases = [[1920, 1080, '1920 x 1080 (zoom 1.00)'], [2560, 1369, 'Your window: 2560 x 1369 (zoom 1.27)'], [1366, 768, 'Laptop 1366 x 768 (zoom 0.71)'], [1280, 720, 'Small 1280 x 720 (zoom 0.67)']];
  const scene = ([w, h, t]) => {
    const b = D.build(vpOf(w, h, true)), k = 640 / w, fr = b.frame, e = [];
    const box = (x, y, bw, bh, cls, inner, st) => e.push('<div class="' + cls + '" style="left:' + (x * k).toFixed(1) + 'px;top:' + (y * k).toFixed(1) + 'px;width:' + (bw * k).toFixed(1) + 'px;height:' + (bh * k).toFixed(1) + 'px;' + (st || '') + '">' + (inner || '') + '</div>');
    box(0, 0, w, fr.top, 'bar', '<i>Info Bar</i>'); box(0, h - fr.bottom, w, fr.bottom, 'bar', '<i>Info Bar</i>');
    // the game's own things that stay where they are
    box(0, fr.top, 84 * fr.f, 640 * fr.f, 'strip', '<i>side menu</i>'); box(96 * fr.f, fr.top + 6 * fr.f, 330 * fr.f, 112 * fr.f, 'game', '<b>Info</b><u></u><u></u>');
    box(w * 0.30, fr.top, w * 0.70, 150 * fr.f, 'ko', '<i>kept clear: invites, task popups, toasts</i>');
    box(w - 30, Math.max(60, Math.min(h - 170, h * 0.3)), 30, 125, 'handle', '<i>Route Advisor</i>');
    SHOWN.forEach(([id, kind]) => { const r = b.rects[id]; box(r.x, r.y, r.w, r.h, 'p ' + kind, '<b>' + TITLE[id] + '</b><u></u><u></u><u></u><u></u><u></u><u></u>'); });
    return '<div class="sc"><h3>' + t + '</h3><div class="scr" style="width:' + (w * k).toFixed(0) + 'px;height:' + (h * k).toFixed(0) + 'px">' + e.join('') + '</div></div>';
  };
  const css = 'body{background:#0d0d14;color:#dcdce8;font:14px system-ui;margin:22px 26px}h1{font-size:21px;color:#ffd24a;margin:0 0 4px}p{color:#9a9aae;max-width:1240px;margin:0 0 14px;line-height:1.5}'
    + '.row{display:flex;gap:26px;flex-wrap:wrap}h3{margin:10px 0 6px;font-size:13px;color:#dcdce8;font-weight:600}.scr{position:relative;background:#171722;border:1px solid #2c2c3c;overflow:hidden}'
    + '.scr>div{position:absolute;box-sizing:border-box;overflow:hidden}.bar{background:#23232f;color:#6a6a80;font:9px system-ui;display:flex;align-items:center;justify-content:center}'
    + '.strip{background:#1d1d29;border:1px dashed #34344a;color:#55556a;font:8px system-ui;padding:3px}.game{background:#1d1d29;border:1px solid #34344a;color:#6a6a80;font:8px system-ui;padding:3px}'
    + '.ko{background:repeating-linear-gradient(135deg,#1a1a26 0 6px,#20202e 6px 12px);border:1px dashed #3c3c52;color:#6a6a80;font:9px system-ui;padding:3px 6px}'
    + '.handle{background:#1d2a44;border:1px solid #3a5fa0;border-right:0;color:#8fb4ff;font:8px system-ui;writing-mode:vertical-rl;display:flex;align-items:center;justify-content:center;border-radius:4px 0 0 4px}'
    + '.p{background:#262636;border:1px solid #4a4a64;border-radius:5px;padding:4px 6px;font:9px system-ui}.p b{display:block;color:#e8e8f4;font-weight:600;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #3a3a52;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.p u{display:block;height:5px;margin:5px 0;background:#34344a;border-radius:2px;width:86%}.p u:nth-child(odd){width:64%}.p.open{border-color:#c9a227}.p.open b{color:#ffd24a}.p.game{border-color:#4a6a98;background:#232a3a}.p.closed{background:transparent;border:1px dashed #5a5a74;color:#7a7a92}.p.closed u{display:none}'
    + '.key{display:flex;gap:18px;margin:6px 0 14px;font-size:12px;color:#9a9aae}.key i{display:inline-block;width:14px;height:10px;border-radius:2px;vertical-align:middle;margin-right:6px}';
  return '<!doctype html><meta charset="utf-8"><title>ScapeLite default layout, preview</title><style>' + css + '</style><h1>ScapeLite default layout</h1>'
    + '<p>One 8 px grid, one column width, one scale. Two docks on the right share their top, their split and their bottom line. The task queue, the XP tracker and the chat are open; everything else is placed but closed, and opens in its spot from the ScapeLite menu. The Route Advisor keeps its handle on the right edge.</p>'
    + '<div class="key"><span><i style="background:#c9a227"></i>open by default</span><span><i style="background:#4a6a98"></i>the game\u2019s own window in its slot (opened by you)</span><span><i style="border:1px dashed #7a7a92"></i>placed, closed</span><span><i style="background:#2a2a3a;border:1px dashed #3c3c52"></i>kept clear</span></div>'
    + '<div class="row">' + cases.map(scene).join('') + '</div>';
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
      return { ok: n.kit === 17, detail: J(n) };
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
          else if (!(D.KIT.find((k) => k.id === id) || {}).estW && Math.abs(a[2] - e.w) > 3) bad.push(id + ' width ' + Math.round(a[2]) + ' wanted ' + Math.round(e.w));
        });
        const ids = Object.keys(got);
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const A = b.rects[ids[i]], B = b.rects[ids[j]]; if (!A || !B || A.stack === B.stack) continue; const ra = { x: got[ids[i]][0], y: got[ids[i]][1], w: got[ids[i]][2], h: got[ids[i]][3] }, rb = { x: got[ids[j]][0], y: got[ids[j]][1], w: got[ids[j]][2], h: got[ids[j]][3] }; if (hit(ra, rb)) bad.push(ids[i] + ' overlaps ' + ids[j]); }
        return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || ids.length + ' panels' };
      });
    }
    await check('three tab strips appear (helpers, inventory-type cards, character-type cards) and only one member of each group shows', async () => {
      await page.eval(`__ccUILayout.useDefault(); 1`); await sleep(1500);
      const t = await page.eval(`(() => ({ strips: document.querySelectorAll('#cc-grp-root .strip').length, hidden: document.querySelectorAll('.kp[data-cc-gh]').length }))()`);
      return { ok: t.strips === 3 && t.hidden === 5 + 2 + 3, detail: J(t) };   // 6+3+4 members, one lead each
    });
    await check('the default leaves open only the task queue, the XP tracker and the chat (the other ScapeLite panels are closed)', async () => {
      const o = await page.eval(`fx.open`), on = Object.keys(o).filter((n) => o[n]).sort();
      return { ok: J(on) === J(['__ccChat', '__ccQueue', '__ccXpTracker']), detail: J(on) };
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
    await check('going back reopens what was open before (Goals, Drop Luck) and closes what the default had opened', async () => {
      const o = await page.eval(`fx.open`), on = Object.keys(o).filter((n) => o[n]).sort();
      return { ok: J(on) === J(['__ccDropLuck', '__ccGoals']), detail: J(on) };
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
