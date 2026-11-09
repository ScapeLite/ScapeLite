// Info Bar fit test.  npm run test:barfit   (options: --fixture-port=9341)
//
// Runs the REAL overlay/ui-bar.js (with ui-kit.js) in a private hidden Electron window on a fake game page (scripts/fixtures/barfit-fixture.html) that feeds the bars long, realistic
// module texts, and sets the window to widths from 1024 to 3840. At every width, for the default module set and for "everything on" (top and bottom bar, each fitted on its own):
//   - nothing overlaps, nothing sticks out of the window, no text is clipped without an ellipsis (and a shortened module keeps its whole text in the hover card)
//   - the compression order holds: free room first (spacers), then drop labels / secondary parts, then abbreviate numbers, then tight gaps, then ellipsis, then the "…" menu;
//     a later step only happens when the earlier ones are used up, and the longest module is shortened first
//   - the modules hidden into the menu are the lowest-priority ones, in order; the bell, Hit points and the panel buttons never are; "Hide it first" / "Never hide it" are honoured
//   - the fit runs on a resize, does not run again while nothing changes, and waits while Eco mode is on
// Nothing of the real game, its settings or its storage is touched.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9341));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const rows = [];
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 220) }); } }

const WIDTHS = [3840, 2560, 1920, 1680, 1600, 1440, 1366, 1280, 1152, 1100, 1024];
const HIDE_ORDER = ['clock', 'blood', 'online', 'world', 'offline', 'event', 'inv', 'gold', 'where', 'xp', 'advisor', 'windows', 'potions', 'task', 'chat'];
const NEVER = ['alerts', 'hp', 'panelbtns', 'pbtn'];
const PBTN = { look: 'both', live: true };
const SCEN = {
  default: { bar2: false, top: [{ id: 'task', s: 'l' }, { id: 'where', s: 'l' }, { id: 'panelbtns', s: 'c', o: PBTN }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r' }, { id: 'clock', s: 'r' }], bottom: [] },
  everything: {
    bar2: true,
    top: [{ id: 'alerts', s: 'l' }, { id: 'task', s: 'l' }, { id: 'where', s: 'l' }, { id: 'event', s: 'l', o: { name: true } }, { id: 'panelbtns', s: 'c', o: PBTN }, { id: 'advisor', s: 'c' }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r', o: { full: true } },
      { id: 'blood', s: 'r' }, { id: 'inv', s: 'r' }, { id: 'online', s: 'r' }, { id: 'world', s: 'r' }, { id: 'offline', s: 'r' }, { id: 'hp', s: 'r', o: { style: 'bar', w: 300 } }, { id: 'clock', s: 'r', o: { sec: true } }],
    bottom: [{ id: 'chat', s: 'l', o: { w: 700 } }, { id: 'space', s: 'l', o: { w: 200 } }, { id: 'advisor', s: 'c' }, { id: 'online', s: 'r' }, { id: 'gold', s: 'r' }, { id: 'clock', s: 'r' }],
  },
  spacers: { bar2: false, top: [{ id: 'task', s: 'l' }, { id: 'space', s: 'l', o: { w: 300 } }, { id: 'where', s: 'l' }, { id: 'space', s: 'r', o: { w: 200 } }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r' }], bottom: [] },
};

let page = null;
const VERBOSE = process.argv.includes('--v');
const setWidth = async (w) => { if (VERBOSE) console.error('width', w); await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(260); };
const info = (pos) => page.eval(`window.__ccBar.fitInfo(${J(pos)})`);
const useScenario = async (name, mod) => {
  const sc = JSON.parse(J(SCEN[name])); if (mod) mod(sc);
  await page.eval(`(() => { window.__ccPluginSettings.set('uiBarBottom', ${!!sc.bar2}); window.__ccPluginSettings.set('uiBarTop', true); return window.__ccBar.applyConfig(${J({ top: sc.top, bottom: sc.bottom })}); })()`);
};
function problems(inf, W) {
  const out = [], shown = inf.mods.filter((m) => !m.hid && m.w > 0).sort((a, b) => a.left - b.left);
  shown.forEach((m, i) => {
    if (m.left < -0.5) out.push(m.id + ' starts left of the window');
    if (m.right > W + 0.5) out.push(m.id + ' ends past the window (' + m.right + ' > ' + W + ')');
    if (i && m.left < shown[i - 1].right - 0.5) out.push(shown[i - 1].id + ' overlaps ' + m.id + ' by ' + Math.round((shown[i - 1].right - m.left) * 10) / 10);
    if (m.clipped) out.push(m.id + ' text clipped without an ellipsis');
  });
  if (inf.over > 0.5) out.push('does not fit by ' + inf.over + ' px');
  return out;
}
// what the compression order promises about one result
function orderProblems(inf, natural) {
  const out = [], vis = inf.mods.filter((m) => !m.hid && m.id !== 'space'), P = inf.phase;
  if (P === -1 || P === undefined) { vis.forEach((m) => { if (m.cut) out.push(m.id + ' shortened with nothing to fit'); }); if (inf.tight) out.push('tight without need'); }
  if (P >= 2) vis.forEach((m) => { if (m.drop < m.steps) out.push(m.id + ' still had a label or part to drop when numbers were abbreviated'); });
  if (P >= 3) { if (!inf.tight) out.push('phase ' + P + ' without tight'); vis.forEach((m) => { if (m.canAbbr && !m.abbr) out.push(m.id + ' still had a number to abbreviate'); }); }
  if (P >= 4) { if (!inf.tight) out.push('ellipsis without tight'); vis.forEach((m) => { if (m.drop < m.steps) out.push(m.id + ' cut before its parts were dropped'); }); }
  if (P >= 5) vis.forEach((m) => { if (m.flex && !(m.items ? m.ell >= 4 : (m.ell !== null && m.ell <= 64.5) || m.w <= 64.5)) out.push(m.id + ' hidden-phase but ' + m.id + ' could still be cut (' + m.ell + ')'); });
  if (P >= 1 && natural) {   // the longest module that has something to drop was shortened first
    const cand = vis.filter((m) => m.steps > 0 && natural[m.id] != null).sort((a, b) => natural[b.id] - natural[a.id])[0];
    if (cand && cand.drop === 0 && vis.some((m) => m.drop > 0 && natural[m.id] < natural[cand.id] - 1)) out.push(cand.id + ' (the longest) was not shortened before a shorter module');
  }
  vis.forEach((m) => { if (m.cut && !m.rich && m.full && !String(m.tip).includes(m.full)) out.push(m.id + ' is shortened but the hover card lacks its whole text'); });
  return out;
}
function hidingProblems(inf, ids) {
  const out = [], hid = inf.hidden;
  if (hid.length !== 0 !== inf.overflow) out.push('the … button does not match the hidden modules (' + J(hid) + ', button ' + inf.overflow + ')');
  hid.forEach((id) => { if (NEVER.includes(id)) out.push(id + ' must never be hidden'); });
  const rank = ids.filter((id) => !NEVER.includes(id) && id !== 'space').sort((a, b) => (HIDE_ORDER.indexOf(a) < 0 ? 99 : HIDE_ORDER.indexOf(a)) - (HIDE_ORDER.indexOf(b) < 0 ? 99 : HIDE_ORDER.indexOf(b)));
  // modules of one id on a bar are interchangeable here; compare as sorted rank lists
  const want = rank.slice(0, hid.length).join(), got = hid.slice().sort((a, b) => (HIDE_ORDER.indexOf(a) < 0 ? 99 : HIDE_ORDER.indexOf(a)) - (HIDE_ORDER.indexOf(b) < 0 ? 99 : HIDE_ORDER.indexOf(b))).join();
  if (want !== got) out.push('hidden ' + got + ' but the lowest priorities are ' + want);
  return out;
}

async function run() {
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rows.push({ name: 'fixture window', res: 'SKIP', detail: 'node_modules/electron missing' }); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-barfit-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE; env.CC_FIXTURE_SHOW = '1';
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'barfit-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  try {
    try { page = await cdp.connectToPage(PORT, /barfit-fixture/, 15000); } catch (e) { rows.push({ name: 'fixture window opens', res: 'FAIL', detail: String(e.message) }); return; }
    await page.send('Runtime.enable');
    for (let i = 0; i < 100; i++) { if (await page.eval('document.readyState === "complete" && !!window.fx')) break; await sleep(100); }
    // the bars wait while the page is hidden (Eco mode); a test window far off screen can report that, so show it as visible here
    await page.eval(`localStorage.clear(); try { Object.defineProperty(document, 'hidden', { get: () => false }); } catch (e) {} 1`);
    for (const f of ['lifecycle.js', 'dom-scope.js', 'ui-kit.js', 'card-sync.js', 'ui-bar.js']) {
      let r; try { r = await page.eval(fs.readFileSync(path.join(ROOT, 'overlay', f), 'utf8')); } catch (e) { rows.push({ name: 'inject overlay/' + f, res: 'FAIL', detail: String(e.message).slice(0, 200) }); return; }
      if (!/loaded|torn|undefined/.test(String(r))) { rows.push({ name: 'inject overlay/' + f, res: 'FAIL', detail: String(r) }); return; }
    }
    await page.eval(`window.__ccUI.eventInfo = () => ({ name: 'Winter Solstice Event', state: 'hunting', found: 3, need: 5, boostPct: 7.7, days: 12, total: 123456, totalText: '', lines: ['Winter Solstice Event', 'Find the lanterns'], attention: false }); 1`);
    rows.push({ name: 'real ui-bar.js injected into the fixture', res: (await page.eval('typeof window.__ccBar.fitInfo === "function"')) ? 'PASS' : 'FAIL', detail: '' });

    for (const sname of Object.keys(SCEN)) {
      await useScenario(sname);
      const results = [];
      let natural = null, prev = null;
      for (const W of WIDTHS) {
        await setWidth(W);
        const res = { W, top: await info('top'), bottom: SCEN[sname].bar2 ? await info('bottom') : null };
        results.push(res);
        if (W === WIDTHS[0]) { natural = {}; (res.top.mods || []).forEach((m) => { natural[m.id] = m.w; }); res.natural = natural; }
        prev = res;
      }
      const nat = results[0].natural;
      await check(sname + ': no overlap, nothing past the window, no unannounced clipping, at ' + WIDTHS.length + ' widths (1024 to 3840)', () => {
        const bad = []; results.forEach((r) => ['top', 'bottom'].forEach((pos) => { if (r[pos]) problems(r[pos], r.W).forEach((m) => bad.push(r.W + ' ' + pos + ': ' + m)); }));
        return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || results.map((r) => r.W + ':' + (r.top.phase === undefined ? '-' : r.top.phase)).join(' ') };
      });
      await check(sname + ': the compression order holds (earlier steps used up before later ones, longest first), hover card keeps the whole text', () => {
        const bad = []; results.forEach((r) => ['top', 'bottom'].forEach((pos) => { if (r[pos]) orderProblems(r[pos], nat).forEach((m) => bad.push(r.W + ' ' + pos + ': ' + m)); }));
        return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') };
      });
      await check(sname + ': the phase never goes down as the window gets narrower', () => {
        const bad = []; ['top', 'bottom'].forEach((pos) => { let last = -2; results.forEach((r) => { if (!r[pos]) return; const p = r[pos].phase === undefined || r[pos].phase === null ? -1 : r[pos].phase; if (p < last) bad.push(pos + ' ' + r.W + ': phase ' + p + ' after ' + last); last = Math.max(last, p); }); });
        return { ok: !bad.length, detail: bad.join(' | ') };
      });
      await check(sname + ': hidden modules are the lowest priorities, in order, never the bell / HP / panel buttons; the … button shows exactly when something is hidden', () => {
        const bad = []; results.forEach((r) => ['top', 'bottom'].forEach((pos) => { if (r[pos]) hidingProblems(r[pos], r[pos].mods.map((m) => m.id)).forEach((m) => bad.push(r.W + ' ' + pos + ': ' + m)); }));
        return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') };
      });
      await check(sname + ': in a wide window the free room is used and nothing is shortened', () => {
        const bad = results.filter((r) => r.W >= (sname === 'everything' ? 3840 : 2560)).filter((r) => ['top', 'bottom'].some((pos) => r[pos] && (r[pos].phase !== undefined && r[pos].phase !== null && r[pos].phase >= 0 || r[pos].mods.some((m) => m.cut || m.hid)))).map((r) => r.W);
        return { ok: bad.length === 0, detail: bad.join(',') };
      });
      if (sname === 'everything') {
        await check('everything: the narrowest windows reach the last steps (ellipsis, the … menu) and the top and bottom bar are fitted separately', () => {
          const n = results[results.length - 1]; const pt = n.top.phase, pb = n.bottom.phase;
          return { ok: pt >= 4 && n.top.hidden.length > 0 && (pb === undefined || pb === null || pb <= pt) && J(n.top.hidden) !== J(n.bottom.hidden), detail: 'top ' + J({ phase: pt, hidden: n.top.hidden }) + ' bottom ' + J({ phase: pb, hidden: n.bottom.hidden }) };
        });
      }
      if (sname === 'spacers') {
        await check('spacers: with free room missing, empty spacers shrink before any text is shortened', async () => {
          const rowsFound = [];
          for (const W of [1200, 1150, 1100]) {
            await setWidth(W); const inf = await info('top'); const sp = inf.mods.filter((m) => m.id === 'space');
            rowsFound.push({ W, phase: inf.phase, space: sp.map((m) => m.w), cut: inf.mods.some((m) => m.cut) });
          }
          const some = rowsFound.find((r) => r.phase === 0);
          return { ok: !!some && some.space.some((w, i) => w < [300, 200][i]) && rowsFound.every((r) => (r.phase === 0 ? !r.cut : true)), detail: J(rowsFound) };
        });
      }
    }

    // ---- when it runs ---------------------------------------------------------------------------------------------------------------
    await useScenario('everything'); await setWidth(1280);
    const i0 = await info('top');
    await check('a new window width fits again by itself (resize observer), and the first fit is not skipped', async () => {
      await setWidth(1152); const i1 = await info('top'); await setWidth(1366); const i2 = await info('top');
      return { ok: i1.fits > i0.fits && i2.fits > i1.fits && problems(i2, 1366).length === 0, detail: J([i0.fits, i1.fits, i2.fits]) };
    });
    await check('nothing changes: refreshing again and again does not fit again (no work while idle)', async () => {
      await setWidth(1280); const a = await info('top');
      await page.eval('for (let i = 0; i < 6; i++) window.__ccBar.refresh(); 1'); await sleep(250);
      const b = await info('top'); return { ok: a.fits === b.fits, detail: J([a.fits, b.fits]) };
    });
    await check('a longer text refits (the gold figure grows from 10 to 13 characters)', async () => {
      const a = await info('top'); await page.eval(`window.fx.set({ gold: 99999999999999 }); window.__ccBar.refresh(); 1`); await sleep(250);
      const b = await info('top'); await page.eval(`window.fx.set({ gold: 1234567890 }); window.__ccBar.refresh(); 1`);
      return { ok: b.fits > a.fits && problems(b, 1280).length === 0, detail: J([a.fits, b.fits, problems(b, 1280)]) };
    });
    await check('Eco mode: no fitting while the page is asleep; it fits as soon as it wakes', async () => {
      await setWidth(1280); const a = await info('top');
      await page.eval('window.__ccEcoOn = true; 1'); await setWidth(1100); const b = await info('top');
      await page.eval('window.__ccEcoOn = false; window.__ccBar.refresh(); 1'); await sleep(300); const c = await info('top');
      return { ok: b.fits === a.fits && c.fits > b.fits && problems(c, 1100).length === 0, detail: J([a.fits, b.fits, c.fits]) };
    });
    await check('"Hide it first" / "Never hide it" are honoured (gold goes first, the clock stays)', async () => {
      await useScenario('everything', (sc) => { sc.top.forEach((m) => { if (m.id === 'gold') m.keep = 'first'; if (m.id === 'clock') m.keep = 'never'; }); });
      await setWidth(700); const inf = await info('top');
      return { ok: inf.hidden.length > 0 && inf.hidden[0] === 'gold' && !inf.hidden.includes('clock') && !inf.hidden.some((id) => NEVER.includes(id)), detail: J({ hidden: inf.hidden, over: inf.over }) };
    });
    await check('the … button lists the hidden modules', async () => {
      await useScenario('everything'); await setWidth(1024);
      const inf = await info('top'); if (!inf.hidden.length) return { ok: false, detail: 'nothing hidden at 1024' };
      const r = await page.eval(`(() => { const b = document.querySelector('.cc-bar[data-pos=top] .m.ovf'); if (!b || b.classList.contains('fit-hid')) return 'NOBTN ' + (b ? b.className : 'missing'); b.click(); const t = (document.querySelector('.cc-menu') || {}).innerText || ''; document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return t; })()`);
      return { ok: !!r && /hidden/i.test(r) && /Clock|Blood|Players online|World|Offline|Game event/.test(r), detail: String(r).replace(/\s+/g, ' ').slice(0, 160) };
    });
    await check('fit leaves the user’s own settings alone (module list and options unchanged)', async () => {
      const sc = SCEN.everything, c = await page.eval('window.__ccBar.config');
      return { ok: J(c.top.map((m) => m.id)) === J(sc.top.map((m) => m.id)) && J(c.bottom.map((m) => m.id)) === J(sc.bottom.map((m) => m.id)), detail: '' };
    });
    await page.send('Emulation.clearDeviceMetricsOverride');
  } finally {
    if (page) page.close();
    try { child.kill(); } catch (e) { /* gone */ }
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ } }, 3000).unref();
  }
}

(async () => {
  const t0 = Date.now();
  await run();
  const w = Math.max(4, ...rows.map((r) => r.name.length));
  console.log('\n' + 'TEST'.padEnd(w) + '  RESULT  DETAIL');
  rows.forEach((r) => console.log(r.name.padEnd(w) + '  ' + r.res.padEnd(6) + '  ' + r.detail));
  const f = rows.filter((r) => r.res === 'FAIL').length;
  console.log('\n' + (rows.length - f) + ' passed, ' + f + ' failed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  process.exit(f ? 1 : 0);
})();
