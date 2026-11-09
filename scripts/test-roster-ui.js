// npm run test:roster-ui   (option: --fixture-port=9338)
//
// The "Clanmates On The Board" list in Settings > Plugins > Clan Status Board (buildMembersRow in overlay/plugins-settings-ui.js, cut out of the source) in a private hidden
// Electron window with a FAKE clan roster (scripts/fixtures/roster-ui-fixture.html). Checks: a tick per clanmate, new clanmates start ticked, search, All / None, the
// switched-off names are what gets stored, clanmates who left stay off and can be forgotten.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9338));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const rows = [];
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e) }); } }

async function main() {
  const src = fs.readFileSync(path.join(ROOT, 'overlay', 'plugins-settings-ui.js'), 'utf8');
  const a = src.indexOf('  function buildMembersRow(item) {'), b = src.indexOf('  // ---- ping roles editor ----');
  if (a < 0 || b < 0 || b < a) { rows.push({ name: 'the list control exists in the source', res: 'FAIL', detail: 'not found' }); return; }
  const fnSrc = src.slice(a, b);
  rows.push({ name: 'the Plugins settings use the list control for clanBoardRosterExclude', res: /type: 'members'/.test(src) && /key: 'clanBoardRosterExclude'/.test(src) && /item\.type === 'members'/.test(src) ? 'PASS' : 'FAIL', detail: '' });
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rows.push({ name: 'fixture window', res: 'SKIP', detail: 'node_modules/electron missing' }); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-roster-ui-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'roster-ui-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  const ui = (js) => page.eval(`(() => { const e = document.getElementById('host'); ${js} })()`);
  try {
    page = await cdp.connectToPage(PORT, /roster-ui-fixture/, 15000);
    await page.send('Runtime.enable');
    for (let i = 0; i < 60 && !(await page.eval('document.readyState === "complete" && !!window.fx')); i++) await sleep(100);
    await page.eval(`(() => { ${fnSrc}; window.mount = () => { const h = document.getElementById('host'); h.textContent = ''; h.appendChild(buildMembersRow({ key: 'excl', label: 'Clanmates On The Board', desc: 'x' })); }; window.mount(); return 1; })()`);
    await sleep(150);
    const names = () => ui(`return [...e.querySelectorAll('label')].map((l) => ({ t: l.querySelector('span').textContent.trim(), on: l.querySelector('input').checked }));`);
    await check('every clanmate has a tick and everybody starts ticked', async () => { const r = await names(); return { ok: r.length === 4 && r.every((x) => x.on) && /Member A/.test(r[1].t) && /online/.test(r[1].t), detail: J(r) }; });
    await check('unticking stores that name; ticking removes it', async () => {
      await ui(`const l = [...e.querySelectorAll('label')].find((x) => /Member B/.test(x.textContent)); l.querySelector('input').click(); return 1;`);
      const a1 = await page.eval('window.fx.values.excl');
      await ui(`const l = [...e.querySelectorAll('label')].find((x) => /Member B/.test(x.textContent)); l.querySelector('input').click(); return 1;`);
      const a2 = await page.eval('window.fx.values.excl');
      return { ok: J(a1) === '["Member B"]' && J(a2) === '[]', detail: J({ a1, a2 }) };
    });
    await check('search narrows the list (case-insensitive)', async () => {
      await ui(`const q = e.querySelector('input[type=text]'); q.value = 'MEMBER c'; q.dispatchEvent(new Event('input')); return 1;`);
      const r = await names(); return { ok: r.length === 1 && /Member C/.test(r[0].t), detail: J(r) };
    });
    await check('None switches everybody off, All switches everybody on', async () => {
      await ui(`const q = e.querySelector('input[type=text]'); q.value = ''; q.dispatchEvent(new Event('input')); [...e.querySelectorAll('button')].find((b) => b.textContent === 'None').click(); return 1;`);
      const n = await page.eval('window.fx.values.excl'); const r1 = await names();
      await ui(`[...e.querySelectorAll('button')].find((b) => b.textContent === 'All').click(); return 1;`);
      const m = await page.eval('window.fx.values.excl'); const r2 = await names();
      return { ok: n.length === 4 && r1.every((x) => !x.on) && m.length === 0 && r2.every((x) => x.on), detail: J({ n, m }) };
    });
    await check('a switched-off clanmate who left the clan stays off, is listed apart, and Forget removes the entry', async () => {
      await page.eval(`window.fx.values.excl = ['Ex Member']; window.mount(); 1`); await sleep(100);
      const t = await ui(`return e.innerText;`);
      await ui(`[...e.querySelectorAll('button')].find((b) => b.textContent === 'Forget').click(); return 1;`);
      const after = await page.eval('window.fx.values.excl');
      return { ok: /Ex Member/.test(t) && /left the clan/.test(t) && J(after) === '[]', detail: J({ after }) };
    });
    await check('a new clanmate starts ticked; an unavailable clan list says so instead of an empty box', async () => {
      await page.eval(`window.fx.values.excl = []; window.fx.roster.members.push({ name: 'Member D', online: false }); window.mount(); 1`); await sleep(100);
      const r = await names();
      await page.eval(`window.fx.roster = { state: 'loading', members: [] }; window.mount(); 1`); await sleep(100);
      const t = await ui(`return e.innerText;`);
      return { ok: r.length === 5 && r.every((x) => x.on) && /not available yet/.test(t), detail: J({ n: r.length, t: t.slice(-80) }) };
    });
  } catch (e) { rows.push({ name: 'fixture run', res: 'FAIL', detail: String(e && e.message || e) }); }
  finally { try { page && page.close && page.close(); } catch (e) { /* done */ } try { child.kill(); } catch (e) { /* done */ } }
}
main().then(() => {
  console.log('clan board: clanmates list');
  rows.forEach((r) => console.log('  ' + (r.res === 'PASS' ? 'ok   ' : r.res === 'SKIP' ? 'skip ' : 'FAIL ') + r.name + (r.res === 'FAIL' && r.detail ? '\n       ' + r.detail : '')));
  const fail = rows.filter((r) => r.res === 'FAIL').length;
  console.log('\n' + rows.filter((r) => r.res === 'PASS').length + ' passed, ' + fail + ' failed' + (rows.some((r) => r.res === 'SKIP') ? ', ' + rows.filter((r) => r.res === 'SKIP').length + ' skipped' : ''));
  process.exit(fail ? 1 : 0);
});
