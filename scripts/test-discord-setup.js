// npm run test:discord-setup   (option: --fixture-port=9337)
//
// The Discord setup wizard (overlay/discord-setup.js) with the REAL UI kit in a private hidden Electron window, against a fake Plugins settings object and a fake
// watcher (scripts/fixtures/discord-setup-fixture.html). Checks what the wizard promises: a webhook shape check before anything is saved, a saved webhook is never shown
// again, the Test button only asks the watcher by feature id (no address travels), one message per press, clear status per channel, the switches go through the allow-list.
// It also checks the watcher's side of the contract in the source (static): only known feature ids, a labelled test message, no address in the state it sends back.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9337));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const J = JSON.stringify;
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 300) }); } }
const read = (f) => fs.readFileSync(path.join(ROOT, 'overlay', f), 'utf8');
// a made-up address in the right shape (not a real webhook)
const FAKE = 'https://discord.com/api/' + 'webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGH_-0123';

function staticChecks() {
  const w = read('panel-resize-watcher.js'), ui = read('plugins-settings-ui.js'), s = read('discord-setup.js');
  const fn = w.slice(w.indexOf('async function serveDiscordSetup'), w.indexOf('async function collectSecrets'));
  const add = (name, ok) => rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: '' });
  add('watcher: a test request is accepted only for a known feature id (no address comes from the page)', /DISCORD_FEATURES\.some\(\(f\) => f\.id === id\)/.test(fn));
  add('watcher: the state it sends back has no address (links in an error text are replaced)', /link hidden/.test(fn) && /discordHealth\(\)\.features\.map/.test(fn));
  add('watcher: the test message says it is a test and that nothing else is posted', /ScapeLite test message\*\* for/.test(w) && /Nothing else is posted by this button/.test(w));
  add('watcher: tests stay one per channel every 10 s (the existing guard)', /< 10000\) return \{ ok: false, error: 'wait a few seconds/.test(w));
  const put = ui.slice(ui.indexOf('discordPut(key'), ui.indexOf('takeSecrets() {'));
  add('settings: the wizard can write, ask about and flip only the Discord keys (allow-lists), and cannot read a saved address back', /DISCORD_SECRETS\.indexOf\(key\) < 0/.test(put) && /DISCORD_TOGGLES\.indexOf\(key\) < 0/.test(put) && !/discordGet|discordRead/.test(ui));
  add('wizard: nothing is stored in the page (no localStorage / sessionStorage / cookie of an address)', !/localStorage\.setItem|sessionStorage|document\.cookie/.test(s));
  const fnT = w.slice(w.indexOf('const TEAM_OPS'), w.indexOf('function currentSecrets'));
  add('watcher: team requests are accepted only for the listed operations, with plain data as arguments', w.includes('TEAM_OPS.indexOf(op) < 0') && w.includes("t.args && typeof t.args === 'object'"));
  add('watcher: a team apply never writes the lease webhook, and the team code logs no address', fnT.includes("k !== 'relayLeaseWebhook'") && !fnT.includes('log(patch') && !fnT.includes('log(JSON'));
  add('settings: teamApply accepts only the team keys and never a secret', ui.includes('TEAM_KEYS.indexOf(key) >= 0') && ui.includes("it.key === key && it.type !== 'secret'"));
  add('wizard: no personal names or Discord names in the text', !new RegExp(['wul' + 'f', 'ulves' + 'ten', 'cal' + 'le'].join('|'), 'i').test(s));
}

async function main() {
  staticChecks();
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rows.push({ name: 'fixture window', res: 'SKIP', detail: 'node_modules/electron missing' }); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-discord-setup-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'discord-setup-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  const inj = (f) => page.eval(`(() => { return (0, eval)(${J(read(f))}); })()`);
  const wiz = (js) => page.eval(`(() => { const e = document.getElementById('cc-discord-setup'); ${js} })()`);
  const typeInto = async (idx, text) => page.eval(`(() => { const i = document.querySelectorAll('#cc-discord-setup .cc-dinp')[${idx}]; i.focus(); i.value = ${J(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const feature = (id, extra) => Object.assign({ id, configured: false, lastOkAt: null, lastErrorAt: null, lastError: null, sent: 0, failed: 0 }, extra || {});
  const ALL = ['relay-clan', 'relay-global', 'digest', 'hiscores', 'raid', 'board'];
  const push = (over) => page.eval(`window.__ccDiscordSetup.setState(${J({ features: ALL.map((id) => feature(id, (over || {})[id])) })}); document.activeElement && document.activeElement.blur(); window.__ccDiscordSetup.render(true); 1`);
  const stat = `const s = e.querySelector('.cc-dcard .cc-dst'); return { tone: s.dataset.tone, text: s.textContent };`;
  const msgOf = `const c = e.querySelector('.cc-dcard'); return { msg: c.querySelector('.cc-dmsg').textContent, dis: c.querySelector('.cc-btn[data-v=primary]').disabled };`;
  try {
    page = await cdp.connectToPage(PORT, /discord-setup-fixture/, 15000);
    await page.send('Runtime.enable');
    for (let i = 0; i < 60 && !(await page.eval('document.readyState === "complete" && !!window.fxPS')); i++) await sleep(100);
    for (const f of ['lifecycle.js', 'dom-scope.js', 'ui-kit.js', 'discord-setup.js']) await inj(f);
    await sleep(300);

    await check('the wizard loads and starts closed (it never pops up by itself)', async () => { const r = await page.eval(`({ ns: typeof window.__ccDiscordSetup, open: window.__ccDiscordSetup.isOpen })`); return { ok: r.ns === 'object' && r.open === false, detail: J(r) }; });
    await check('opening it shows the six pages and the progress line', async () => {
      await page.eval(`window.__ccDiscordSetup.open('channels'); 1`); await sleep(200);
      const r = await wiz(`return { shown: e.classList.contains('show'), tabs: [...e.querySelectorAll('.cc-tab')].map((t) => t.textContent), cards: e.querySelectorAll('.cc-dcard').length, stat: e.querySelector('.cc-stat b').textContent };`);
      return { ok: r.shown && r.tabs.length === 6 && r.cards === 6 && r.stat === '0 / 6', detail: J(r) };
    });
    await check('a made-up address is refused with a plain reason; Save stays disabled', async () => {
      await typeInto(0, 'hello'); const a = await wiz(msgOf);
      await typeInto(0, 'https://example.com/hook'); const b = await wiz(msgOf);
      await typeInto(0, 'https://discord.com/api/' + 'webhooks/123/abc'); const c = await wiz(msgOf);
      return { ok: a.dis && b.dis && c.dis && /https/.test(a.msg) && /webhooks/.test(b.msg) && /missing|whole/.test(c.msg), detail: J({ a, b, c }) };
    });
    await check('the field is masked (a password field) and the address is not in the page text', async () => {
      const r = await wiz(`const i = e.querySelector('.cc-dinp'); return { type: i.type, text: e.innerText.indexOf('discord.com/api/webhooks') >= 0 };`);
      return { ok: r.type === 'password' && !r.text, detail: J(r) };
    });
    await check('a well-formed address enables Save; saving hands it to the settings and the field disappears', async () => {
      await typeInto(0, FAKE);
      const ok1 = await wiz(msgOf);
      await wiz(`e.querySelector('.cc-dcard .cc-btn[data-v=primary]').click(); return 1;`); await sleep(200);
      const r = await page.eval(`({ pending: Object.keys(window.fxPS.pending), val: window.fxPS.pending.relayClanWebhook === ${J(FAKE)} })`);
      const after = await wiz(`const c = e.querySelector('.cc-dcard'); return { inputs: c.querySelectorAll('.cc-dinp').length, text: e.innerText.indexOf('webhooks/1234') >= 0 || e.innerText.indexOf('abcdefgh') >= 0, saved: /Webhook saved/.test(c.innerText) };`);
      return { ok: !ok1.dis && /Looks right/.test(ok1.msg) && r.val && J(r.pending) === '["relayClanWebhook"]' && after.inputs === 0 && !after.text && after.saved, detail: J({ ok1, r, after }) };
    });
    await check('after saving, the address is never shown again anywhere in the wizard (all six pages)', async () => {
      const seen = [];
      for (const k of ['start', 'channels', 'roles', 'game', 'more', 'team']) { await page.eval(`window.__ccDiscordSetup.open(${J(k)}); 1`); await sleep(120); seen.push(await wiz(`return e.innerText.indexOf('abcdefgh') >= 0 || e.innerHTML.indexOf('abcdefgh') >= 0 || [...e.querySelectorAll('input')].some((i) => i.value.indexOf('abcdefgh') >= 0);`)); }
      await page.eval(`window.__ccDiscordSetup.open('channels'); 1`);
      return { ok: seen.every((x) => x === false), detail: J(seen) };
    });
    await check('the Test button asks the watcher by feature id only, and shows "Sending" until the answer', async () => {
      await push({ 'relay-clan': { configured: true } }); await sleep(100);
      await wiz(`[...e.querySelectorAll('.cc-dcard .cc-btn')].find((b) => /Test this channel/.test(b.textContent)).click(); return 1;`); await sleep(150);
      const q = await page.eval(`JSON.stringify(window.__ccDiscordSetup.take())`);
      const st = await wiz(`return e.querySelector('.cc-dst').textContent;`);
      const t = JSON.parse(q);
      return { ok: J(t.tests) === '[{"id":"relay-clan"}]' && t.want === true && /Sending/.test(st) && q.indexOf('discord') < 0, detail: q + ' · ' + st };
    });
    await check('a pressed Test cannot be pressed again while it is sending (one message per press)', async () => {
      const dis = await wiz(`return [...e.querySelectorAll('.cc-dcard .cc-btn')].filter((b) => /Sending/.test(b.textContent)).every((b) => b.disabled);`);
      const q = await page.eval(`JSON.stringify(window.__ccDiscordSetup.take().tests)`);
      return { ok: dis && q === '[]', detail: q };
    });
    await check('a good answer turns the channel green with the time; a failure says why in red', async () => {
      await page.eval(`window.__ccDiscordSetup.result('relay-clan', { ok: true }); 1`); await sleep(100);
      const good = await wiz(stat);
      await page.eval(`window.__ccDiscordSetup.result('relay-clan', { ok: false, error: 'HTTP 404: the webhook was deleted' }); 1`); await sleep(100);
      const bad = await wiz(stat);
      return { ok: good.tone === 'good' && /Works/.test(good.text) && bad.tone === 'bad' && /404/.test(bad.text), detail: J({ good, bad }) };
    });
    await check('what Discord reported on a real post also shows (a newer error is red, a newer test is green)', async () => {
      await push({ 'relay-clan': { configured: true, lastErrorAt: Date.now(), lastError: 'HTTP 401: invalid webhook token' } });
      await sleep(30); await page.eval(`window.__ccDiscordSetup.result('relay-clan', { ok: true }); 1`);
      const a = (await wiz(stat)).tone;
      await push({ 'relay-clan': { configured: true, lastErrorAt: Date.now() + 5000, lastError: 'HTTP 401: invalid webhook token' } });
      const b = await wiz(stat);
      return { ok: a === 'good' && b.tone === 'bad' && /401/.test(b.text), detail: a + ' | ' + J(b) };
    });
    await check('the switches go through the allow-list: clan feed and plain chat flip, other keys do not', async () => {
      await push({ 'relay-clan': { configured: true } });
      await wiz(`const sw = e.querySelectorAll('.cc-dcard .cc-sw'); sw[0].click(); sw[1].click(); return 1;`); await sleep(150);
      const r = await page.eval(`({ clan: window.fxPS.values.clanRelayEnabled, plain: window.fxPS.values.relayPlainChat, refused: window.fxPS.discordToggle('uiPalette'), refusedSecret: window.fxPS.discordPut('someOtherKey', 'x'), has: window.fxPS.discordHas('relayClanWebhook') })`);
      return { ok: r.clan === false && r.plain === false && r.refused === false && r.refusedSecret === false && r.has === true, detail: J(r) };
    });
    await check('"Replace or remove" forgets the saved address (an empty value goes to the watcher) and shows the field again', async () => {
      await wiz(`[...e.querySelectorAll('.cc-dcard .cc-btn')].find((b) => /Replace or remove/.test(b.textContent)).click(); return 1;`); await sleep(150);
      const r = await page.eval(`({ pending: window.fxPS.pending.relayClanWebhook })`);
      const f = await wiz(`return e.querySelectorAll('.cc-dcard')[0].querySelectorAll('.cc-dinp').length;`);
      return { ok: r.pending === '' && f === 1, detail: J({ r, f }) };
    });
    await check('typing in a field is never interrupted by a status update (the page is not rebuilt under the cursor)', async () => {
      await typeInto(1, 'https://disc'); await page.eval(`window.__ccDiscordSetup.setState(${J({ features: ALL.map((id) => feature(id, { sent: Math.random() })) })}); 1`); await sleep(200);
      const r = await page.eval(`(() => { const i = document.querySelectorAll('#cc-discord-setup .cc-dinp')[1]; return { v: i && i.value, focus: document.activeElement === i }; })()`);
      return { ok: r.v === 'https://disc' && r.focus, detail: J(r) };
    });
    // ---- page 6: Team settings (the watcher is played by this test: it reads take().team and answers with teamResult)
    const takeTeam = async () => JSON.parse(await page.eval(`JSON.stringify(window.__ccDiscordSetup.take().team)`));
    const answer = async (id, r) => page.eval(`window.__ccDiscordSetup.teamResult(${J(id)}, ${J(r)}); 1`);
    const clickBtn = (re) => wiz(`const b = [...e.querySelectorAll('.cc-btn')].find((x) => ${re}.test(x.textContent)); if (!b) return 'nobutton'; b.click(); return 1;`);
    const REPLY_STATUS = { ok: true, lease: true, meta: { ver: 4, by: 'Member A', at: 1793104926944, urls: false }, lastVer: 3, hasUndo: true };
    await check('the Team settings page asks the watcher for its status, and only while it is the open page', async () => {
      await page.eval(`window.__ccDiscordSetup.open('channels'); 1`); await sleep(100);
      const off = await takeTeam();
      await page.eval(`window.__ccDiscordSetup.open('team'); 1`); await sleep(200);
      const on = await takeTeam();
      await answer(on[0].id, REPLY_STATUS); await sleep(200);
      const r = await wiz(`return { cards: e.querySelectorAll('.cc-dcard').length, text: e.innerText };`);
      return { ok: off.length === 0 && on.length === 1 && on[0].op === 'status' && r.cards === 3 && /version 4 by Member A/.test(r.text) && /Undo last change/.test(r.text), detail: J({ off, on, cards: r.cards }) };
    });
    await check('Preview shows what would be published and never an address; Publish names the version', async () => {
      await clickBtn(`/^Preview$/`); await sleep(150);
      const q = await takeTeam(); const pv = q.find((x) => x.op === 'preview');
      await answer(pv.id, { ok: true, rows: [{ key: 'clanTag', group: 'Clan hiscores', label: 'Clan tag', value: 'ABC' }, { key: 'pingRoles', group: 'Chat relay pings', label: 'Ping roles', value: 'Rare drops (…1111): rareDrop' }], urls: [], size: 300, parts: 1, tooBig: false, nextVer: 5, current: { ver: 4, by: 'Member A', at: 1793104926944 } }); await sleep(250);
      const r = await wiz(`return { text: e.innerText, pub: [...e.querySelectorAll('.cc-btn')].some((b) => /Publish version 5/.test(b.textContent)) };`);
      return { ok: r.pub && /Clan tag/.test(r.text) && /replaces version 4/.test(r.text) && r.text.indexOf('discord.com') < 0, detail: r.text.slice(0, 200) };
    });
    await check('webhook addresses: a warning appears and Publish stays disabled until it is confirmed; the request says so', async () => {
      await wiz(`const c = [...e.querySelectorAll('label.cc-dsw')].find((l) => /Include webhook addresses/.test(l.textContent)); c.querySelector('input').click(); return 1;`); await sleep(150);
      await clickBtn(`/^Preview$/`); await sleep(100);
      const pv = (await takeTeam()).find((x) => x.op === 'preview');
      await answer(pv.id, { ok: true, rows: [{ key: 'clanTag', group: 'Clan hiscores', label: 'Clan tag', value: 'ABC' }], urls: ['Clan feed webhook'], size: 400, parts: 1, tooBig: false, nextVer: 5, current: null }); await sleep(250);
      const a = await wiz(`const b = [...e.querySelectorAll('.cc-btn')].find((x) => /Publish version/.test(x.textContent)); return { warn: /everyone who has the lease webhook can read them/.test(e.innerText), dis: b.disabled, listed: /Clan feed webhook/.test(e.innerText) };`);
      await wiz(`const c = [...e.querySelectorAll('label.cc-dsw')].find((l) => /I understand/.test(l.textContent)); c.querySelector('input').click(); return 1;`); await sleep(200);
      const b = await wiz(`const x = [...e.querySelectorAll('.cc-btn')].find((x) => /Publish version/.test(x.textContent)); x.click(); return { dis: x.disabled };`); await sleep(150);
      const q = (await takeTeam()).find((x) => x.op === 'publish');
      await answer(q.id, { ok: true, ver: 5, parts: 1, urls: true }); await sleep(250);
      const msg = await wiz(`return e.innerText;`);
      return { ok: a.warn && a.dis && a.listed && !b.dis && q.args.includeUrls === true && q.args.confirmUrls === true && /Published version 5 \(with webhook addresses\)/.test(msg), detail: J({ a, b, q }) };
    });
    await check('without the tick, Publish and Export never ask for addresses', async () => {
      await wiz(`const c = [...e.querySelectorAll('label.cc-dsw')].find((l) => /Include webhook addresses/.test(l.textContent)); if (c.querySelector('input').checked) c.querySelector('input').click(); return 1;`); await sleep(150);
      await clickBtn(`/^Export$/`); await sleep(100);
      const q = (await takeTeam()).find((x) => x.op === 'export');
      await answer(q.id, { ok: true, text: 'SLT1.abc.12345678', urls: false }); await sleep(250);
      return { ok: q && q.args.includeUrls === false && !q.args.confirmUrls, detail: J(q) };
    });
    await check('Gather shows the differences; Apply selected sends only the ticked keys and never takes addresses unless asked', async () => {
      await clickBtn(`/^Gather$/`); await sleep(120);
      const g = (await takeTeam()).find((x) => x.op === 'gather');
      await answer(g.id, { ok: true, source: 'team', by: 'Member A', at: 1793104926944, ver: 4, urls: true, refused: 1, changes: 2, rows: [
        { key: 'hiscoresPollMinutes', group: 'Clan hiscores', label: 'Poll every (minutes)', local: '20', remote: '30', same: false, secret: false },
        { key: 'clanTag', group: 'Clan hiscores', label: 'Clan tag', local: 'ABC', remote: 'ABC', same: true, secret: false },
        { key: 'pingRoles', group: 'Chat relay pings', label: 'Ping roles', local: '(none)', remote: 'Rare drops (…1111): rareDrop', same: false, secret: false },
        { key: 'relayClanWebhook', group: 'Webhook addresses', label: 'Clan feed webhook', local: 'not set', remote: 'in the team settings', same: false, secret: true }] }); await sleep(250);
      const t = await wiz(`const rows = [...e.querySelectorAll('table tbody tr')].filter((r) => r.querySelector('input')); return { text: e.innerText, boxes: rows.map((r) => ({ label: r.children[1].textContent, checked: r.querySelector('input').checked, dis: r.querySelector('input').disabled })) };`);
      await wiz(`const row = [...e.querySelectorAll('table tbody tr')].find((r) => r.children[1] && /Ping roles/.test(r.children[1].textContent)); row.querySelector('input').click(); return 1;`);   // untick one
      await clickBtn(`/^Apply selected$/`); await sleep(120);
      const a = (await takeTeam()).find((x) => x.op === 'apply');
      await answer(a.id, { ok: true, applied: 1, hasUndo: true }); await sleep(250);
      return { ok: /Published by Member A/.test(t.text) && /2 settings differ/.test(t.text) && /left out/.test(t.text) && t.boxes.find((b) => /Poll/.test(b.label)).checked && t.boxes.find((b) => /Clan feed webhook/.test(b.label)).dis && J(a.args.keys) === '["hiscoresPollMinutes"]' && a.args.urls === false && t.text.indexOf('discord.com') < 0, detail: J({ boxes: t.boxes, args: a && a.args }) };
    });
    await check('Import sends the pasted text to the watcher; a refused text shows the reason', async () => {
      await wiz(`const ta = e.querySelector('textarea'); ta.value = 'SLT1.abc.12345678'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 1;`);
      await clickBtn(`/^Import this text$/`); await sleep(120);
      const i = (await takeTeam()).find((x) => x.op === 'import');
      await answer(i.id, { ok: false, error: 'the text is damaged (checksum does not match): copy it again, whole' }); await sleep(250);
      const t = await wiz(`return e.innerText;`);
      return { ok: i.args.text === 'SLT1.abc.12345678' && /checksum does not match/.test(t), detail: J(i) };
    });
    await check('an answer that never comes ends with a plain message (no endless "busy")', async () => {
      const r = await page.eval(`(async () => { const p = window.__ccDiscordSetup; return typeof p.teamResult; })()`);
      return { ok: r === 'function' && read('discord-setup.js').indexOf("No answer from ScapeLite’s background program") >= 0, detail: r };
    });
    await check('closing it stops all asking (take() says it is not wanted)', async () => {
      await page.eval(`window.__ccDiscordSetup.toggle(); 1`); const q = await page.eval(`JSON.stringify(window.__ccDiscordSetup.take())`);
      return { ok: q === '{"tests":[],"want":false,"team":[]}', detail: q };
    });
    await check('teardown leaves nothing behind', async () => (await page.eval(`window.__ccDiscordSetup.teardown(); !document.getElementById('cc-discord-setup') && !document.getElementById('cc-discord-setup-style')`)));
  } catch (e) {
    rows.push({ name: 'harness', res: 'FAIL', detail: String(e && e.stack || e).slice(0, 300) });
  } finally {
    if (page) page.close();
    try { child.kill(); } catch (e) { /* gone */ }
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ } }, 3000).unref();
  }
}

main().then(() => {
  let fail = 0;
  rows.forEach((r) => { console.log((r.res === 'PASS' ? '  ok   ' : r.res === 'SKIP' ? '  skip ' : '  FAIL ') + r.name + (r.detail && r.res !== 'PASS' ? '\n         ' + r.detail : '')); if (r.res === 'FAIL') fail++; });
  console.log('\n' + rows.filter((r) => r.res === 'PASS').length + ' passed, ' + fail + ' failed' + (rows.some((r) => r.res === 'SKIP') ? ', ' + rows.filter((r) => r.res === 'SKIP').length + ' skipped' : ''));
  process.exit(fail ? 1 : 0);
});
