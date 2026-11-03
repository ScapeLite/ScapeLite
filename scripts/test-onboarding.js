// Onboarding test.  npm run test:onboarding   (options: --fixture-port=9334)
//
// The look chooser is step 1 of the welcome tour (overlay/welcome-tour.js hosts overlay/presets.js picker()), and the tour's later steps adapt to the look.
// Runs the REAL overlay files in a private hidden Electron window on a fake game shell (scripts/fixtures/onboarding-fixture.html, empty localStorage, own port).
// Nothing of the real game, its settings or its storage is touched.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9334));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 200) }); } }
async function until(fn, ms, step) { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await sleep(step || 100); } while (Date.now() < end); return v; }
const J = JSON.stringify;
const inject = async (page, f) => page.eval(fs.readFileSync(path.join(ROOT, 'overlay', f), 'utf8'));
const rectOf = (sel) => `(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`;
async function clickSel(page, sel) { const p = await page.eval(rectOf(sel)); if (!p) throw new Error('not on screen: ' + sel); await page.click(p.x, p.y); }
// the option buttons of the picker, by the look's name
const optSel = (name) => '#cc-welcome .pr-picker .pr-opt:nth-child(' + ({ 'Full Vanilla': 1, 'Combination': 2, 'ScapeLite only': 3 })[name] + ')';
const tourText = (page) => page.eval(`(document.querySelector('#cc-welcome .w-card') || {}).innerText || ''`);
const tourTitle = (page) => page.eval(`(document.querySelector('#cc-welcome h2') || {}).textContent || ''`);
const tourHidden = (page) => page.eval(`document.getElementById('cc-welcome').hidden`);
const footBtn = (page, re) => page.eval(`(() => { const b = [...document.querySelectorAll('#cc-welcome .w-foot button')].find((x) => ${re}.test(x.textContent)); b && b.click(); return !!b; })()`);
const next = (page) => footBtn(page, '/^(Next|Save|Got it|Done)$/');
const readyTour = (page) => until(() => page.eval(`!!document.querySelector('#cc-welcome:not([hidden]) .pr-picker')`), 8000, 200);
// every title of a tour, paged through with Next
async function walk(page) { let t = ''; for (let i = 0; i < 14; i++) { t += (await tourTitle(page)) + '|'; if (!(await next(page))) break; await sleep(60); if (await tourHidden(page)) break; } return t; }

async function fresh(page, set) {   // empty storage, empty settings, then the overlay files in load order
  await page.eval(`localStorage.clear(); for (const k of Object.keys(fx.SET)) delete fx.SET[k]; fx.barApplied = 0; Object.assign(fx.SET, ${J(set || {})}); document.querySelectorAll('#cc-welcome,#cc-presets').forEach((e) => e.remove()); 1`);
  await inject(page, 'presets.js'); await inject(page, 'welcome-tour.js');
}

(async () => {
  const t0 = Date.now();
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { console.log('SKIP: node_modules/electron missing'); process.exit(0); }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-onb-fixture-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'onboarding-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  try {
    page = await cdp.connectToPage(PORT, /onboarding-fixture/, 15000);
    await page.send('Runtime.enable');
    if (!(await until(() => page.eval('document.readyState === "complete" && !!window.fx'), 10000, 100))) throw new Error('fixture page did not load');

    // ---- a new install: the tour opens with the chooser as step 1
    await fresh(page);
    await check('new install: the look is still pending when the tour starts', async () => (await page.eval('__ccPresets.pending()')) === true);
    await check('new install: the tour opens by itself and step 1 holds the three looks', async () => {
      const ok = await readyTour(page);
      const names = await page.eval(`[...document.querySelectorAll('#cc-welcome .pr-opt b')].map((b) => b.firstChild.textContent)`);
      return { ok: ok && names.join('|') === 'Full Vanilla|Combination|ScapeLite only', detail: names.join('|') + ' / ' + (await tourTitle(page)) };
    });
    await check('the separate chooser window does not open on top of the tour', async () => { await sleep(500); return (await page.eval(`(() => { const e = document.getElementById('cc-presets'); return !e || e.hidden; })()`)) === true; });
    await check('step counter says 1 / N and the look step is first', async () => { const t = await tourText(page); return { ok: /1 \/ \d+/.test(t) && /how should it look/i.test(t), detail: t.slice(0, 60).replace(/\n/g, ' ') }; });

    // ---- ScapeLite only
    await check('picking ScapeLite only applies it at once and settles the pending choice', async () => {
      await clickSel(page, optSel('ScapeLite only')); await sleep(300);
      const r = await page.eval(`({ id: __ccPresets.currentId(), pending: __ccPresets.pending(), bottom: fx.SET.uiBarBottom, menu: fx.SET.menuBarHidden, bar: fx.barApplied, st: JSON.parse(localStorage.getItem('cc-preset')) })`);
      return { ok: r.id === 'only' && r.pending === false && r.bottom === true && r.menu === false && r.bar === 1 && r.st.chosen === true && !r.st.skipped, detail: J(r) };
    });
    await check('the picker marks the current look and offers Undo', async () => { const r = await page.eval(`({ on: document.querySelector('#cc-welcome .pr-opt.on b').firstChild.textContent, undo: !!([...document.querySelectorAll('#cc-welcome .pr-foot button')].find((b) => b.textContent === 'Undo')) })`); return { ok: r.on === 'ScapeLite only' && r.undo, detail: J(r) }; });
    await check('step 2 "Your look" describes ScapeLite only and says the side menu stays', async () => {
      await next(page); await sleep(150); const t = await tourText(page), h = await tourTitle(page);
      return { ok: /Your look/.test(h) && /hidden/.test(t) && /side menu always stays/.test(t), detail: h };
    });

    // ---- change the mind: Back, Full Vanilla, forward: the step text changes
    await check('Back then Full Vanilla: step 2 adapts', async () => {
      await footBtn(page, '/^Back$/'); await sleep(150);
      await clickSel(page, optSel('Full Vanilla')); await sleep(300);
      const s = await page.eval(`({ id: __ccPresets.currentId(), menuBtn: fx.SET.scapeliteMenuEnabled, bell: fx.SET.alertBellHidden, top: fx.SET.uiBarTop, sidebar: fx.SET.menuBarHidden })`);
      await next(page); await sleep(150); const t = await tourText(page);
      return { ok: s.id === 'vanilla' && s.menuBtn === false && s.bell === true && s.top === false && s.sidebar === false && /exactly as it is/.test(t) && /status light/.test(t), detail: J(s) };
    });
    await check('no look hides the game side bar or the status light', async () => page.eval(`__ccPresets.order.every((id) => __ccPresets.PRESETS[id].settings.menuBarHidden === false && !Object.keys(__ccPresets.PRESETS[id].settings).some((k) => /status/i.test(k)))`));
    await check('later steps still follow: status light, marketplace', async () => {
      const titles = await walk(page);
      return { ok: /Status light/.test(titles) && /marketplace/.test(titles), detail: titles };
    });
    await check('finishing marks the tour seen', async () => { await sleep(300); return (await page.eval(`localStorage.getItem('cc-welcome-seen')`)) === '1'; });

    // ---- the UI tour drops the Info bar step in Full Vanilla
    await check('UI tour in Full Vanilla leaves out "Info bars and Alerts"; in Combination it is there', async () => {
      await sleep(700); await page.eval(`localStorage.setItem('cc-setup', '{}'); __ccWelcome.close(); __ccPresets.apply('vanilla'); __ccWelcome.openUiTour(); 1`); await sleep(200);
      const vt = await walk(page);
      await page.eval(`__ccPresets.apply('combo'); __ccWelcome.openUiTour(); 1`); await sleep(200);
      const ct = await walk(page);
      return { ok: !/Info bars/.test(vt) && /Info bars/.test(ct), detail: vt };
    });

    // ---- skipping the tour on step 1 settles the choice and changes nothing
    await fresh(page);
    await check('Skip on step 1: nothing is changed, the choice is remembered as skipped', async () => {
      await readyTour(page);
      const before = await page.eval(`JSON.stringify(fx.SET) + fx.barApplied`);
      await footBtn(page, '/^Skip$/'); await sleep(300);
      const r = await page.eval(`({ same: JSON.stringify(fx.SET) + fx.barApplied, pending: __ccPresets.pending(), st: JSON.parse(localStorage.getItem('cc-preset')) })`);
      return { ok: r.same === before && !r.pending && r.st.skipped === true, detail: J(r.st) };
    });
    await check('Next without picking, then closing the tour: counts as skipped, defaults stay', async () => {
      await sleep(700);   // the previous test's Skip schedules the Setup modal 400 ms later; let it come and go
      await fresh(page);
      await readyTour(page);
      await next(page); await sleep(200);
      const onStep2 = await page.eval(`/Your look/.test(document.querySelector('#cc-welcome h2').textContent)`); const dbg = await tourTitle(page);
      await page.eval(`__ccWelcome.close(); 1`); await sleep(200);
      const r2 = await page.eval(`({ pending: __ccPresets.pending(), st: JSON.parse(localStorage.getItem('cc-preset')), bar: fx.barApplied })`);
      return { ok: onStep2 && r2.pending === false && r2.st.skipped === true && r2.bar === 0, detail: J({ onStep2, dbg, r2 }) };
    });

    // ---- an existing install never gets the chooser by itself
    await check('existing install (tour already seen): no tour, no chooser, look is not pending', async () => {
      await sleep(700);   // a Setup modal scheduled by the previous test's close has come and gone
      await page.eval(`localStorage.clear(); localStorage.setItem('cc-welcome-seen', '1'); localStorage.setItem('cc-setup', '{}'); localStorage.setItem('cc-ui-tour-seen', '1'); document.querySelectorAll('#cc-welcome,#cc-presets').forEach((e) => e.remove()); 1`);
      await inject(page, 'presets.js'); await inject(page, 'welcome-tour.js'); await sleep(4000);
      const r = await page.eval(`({ pending: __ccPresets.pending(), tour: !!document.querySelector('#cc-welcome:not([hidden])'), chooser: !!document.querySelector('#cc-presets:not([hidden])') })`);
      return { ok: !r.pending && !r.tour && !r.chooser, detail: J(r) };
    });
    await check('replaying the tour on an existing install shows the picker with the current look marked', async () => {
      await page.eval(`__ccPresets.apply('combo'); __ccWelcome.open(); 1`); await sleep(200);
      const r = await page.eval(`({ on: (document.querySelector('#cc-welcome .pr-opt.on b') || { firstChild: {} }).firstChild.textContent, n: document.querySelectorAll('#cc-welcome .pr-opt').length })`);
      await page.eval(`__ccWelcome.close(); 1`);
      return { ok: r.on === 'Combination' && r.n === 3, detail: J(r) };
    });

    // ---- fallback: tour switched off on a new install -> the chooser window still opens
    await check('new install with the welcome tour switched off: the chooser window opens as a fallback', async () => {
      await fresh(page, { welcomeTourEnabled: false });
      const ok = await until(() => page.eval(`!!document.querySelector('#cc-presets:not([hidden]) .pr-opt')`), 6000, 200);
      await page.eval(`__ccPresets.close(); 1`);
      return ok === true;
    });
    await check('teardown leaves no tour or chooser behind', async () => (await page.eval(`__ccWelcome.teardown(); __ccPresets.teardown(); !document.getElementById('cc-welcome') && !document.getElementById('cc-presets') && !document.getElementById('cc-presets-style')`)) === true);
  } catch (e) {
    rows.push({ name: 'harness', res: 'FAIL', detail: String(e && e.stack || e).slice(0, 300) });
  } finally {
    if (page) page.close();
    try { child.kill(); } catch (e) { /* gone */ }
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ } }, 3000).unref();
  }
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  console.log('\n' + 'TEST'.padEnd(w) + '  RESULT  DETAIL');
  rows.forEach((r) => console.log(r.name.padEnd(w) + '  ' + r.res.padEnd(6) + '  ' + r.detail));
  const f = rows.filter((r) => r.res === 'FAIL').length;
  console.log('\n' + (rows.length - f) + ' passed, ' + f + ' failed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  process.exit(f ? 1 : 0);
})();
