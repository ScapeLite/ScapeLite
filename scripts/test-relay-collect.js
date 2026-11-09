// npm run test:relay-collect   (option: --fixture-port=9336)
//
// The page-side collector of the Discord relay (overlay/chat-relay-collect.js) against a fake of the game's chat (scripts/fixtures/relay-collect-fixture.html) in a private
// hidden Electron window. The fake draws a chat line only when its filters allow it and keeps every line in its message list, exactly like the game; the REAL
// overlay/game-bridge.js and the REAL collector run on it.
//
// The bug this guards: the relay used to read the lines the game DRAWS, so a player whose default chat had a channel greyed out (Global) or a type switched off
// (drops, levels ...) relayed nothing of it. Now the lines the game keeps but hides are read from its message list as well, without double posting and without
// presenting history as news. Names in the fixtures are pseudonyms.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const cdp = require('./lib/cdp');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const PORT = Number(arg('fixture-port', 9336));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const J = JSON.stringify;
async function check(name, fn) { try { const r = await fn(); const ok = r === true || (r && r.ok); rows.push({ name, res: ok ? 'PASS' : 'FAIL', detail: (r && r.detail) || '' }); } catch (e) { rows.push({ name, res: 'FAIL', detail: String(e && e.message || e).slice(0, 300) }); } }
const read = (f) => fs.readFileSync(path.join(ROOT, 'overlay', f), 'utf8');

async function main() {
  let electron; try { electron = require('electron'); } catch (e) { electron = null; }
  if (!electron || typeof electron !== 'string' || !fs.existsSync(electron)) { rows.push({ name: 'fixture window', res: 'SKIP', detail: 'node_modules/electron missing' }); return; }
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-relay-collect-'));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(electron, [path.join(ROOT, 'scripts', 'fixtures', 'electron-host.js'), path.join(ROOT, 'scripts', 'fixtures', 'relay-collect-fixture.html'), String(PORT), udd], { env, stdio: 'ignore', windowsHide: true });
  let page = null;
  const collector = arg('collector', '') ? fs.readFileSync(arg('collector', ''), 'utf8') : read('chat-relay-collect.js'), bridge = read('game-bridge.js');
  const inj = async (src) => page.eval(`(() => { return (0, eval)(${J(src)}); })()`);
  const add = (args) => page.eval(`fx.C.addMessage(...${J(args)}); 1`);
  const scan = () => page.eval(`window.__ccChatRelay.scanNow ? (window.__ccChatRelay.scanNow(), 1) : 1`);
  const drain = async () => JSON.parse(await page.eval(`JSON.stringify(fx.drain() || [])`));
  const summary = (evs) => evs.map((e) => e.channel + '/' + e.kind + '/' + e.player + (e.self ? '*' : '')).join(', ');
  try {
    page = await cdp.connectToPage(PORT, /relay-collect-fixture/, 15000);
    await page.send('Runtime.enable');
    for (let i = 0; i < 60 && !(await page.eval('document.readyState === "complete" && !!window.fx')); i++) await sleep(100);

    // history that is already in the game's list when ScapeLite starts: some drawn, some hidden by a filter
    await add(['clan', 'Member A', 'hello there']);                                                    // plain chat, drawn
    await add(['clan', null, 'received a rare drop: [T1] Old Sword from Old Mob!', null, 'rareDrops', 'Member A']);   // drawn
    await page.eval(`fx.C.setClanFilter('rareDrops', false); 1`);
    await add(['clan', null, 'received a rare drop: [T1] Hidden Old Axe from Old Mob!', null, 'rareDrops', 'Member B']);   // hidden history
    await page.eval(`fx.C.setClanFilter('rareDrops', true); 1`);
    await check('the fixture draws only what its filters allow and keeps every line (same as the game)', async () => {
      const n = await page.eval(`({ list: fx.C._messages.length, drawn: document.querySelectorAll('.chat-message').length })`);
      return { ok: n.list === 3 && n.drawn === 3, detail: J(n) };   // after the filter is back on the list is redrawn: all three drawn
    });
    await page.eval(`fx.C.setClanFilter('rareDrops', false); 1`);    // hide again before the collector starts
    await check('with the drop filter off, the hidden line is in the game list but not on screen', async () => {
      const n = await page.eval(`({ list: fx.C._messages.length, drawn: document.querySelectorAll('.chat-message').length })`);
      return { ok: n.list === 3 && n.drawn === 1, detail: J(n) };
    });

    await check('the bridge hands out the hidden lines (chatHidden)', async () => {
      const t = await page.eval(`fx.installBridge(${J(bridge)})`);
      const hidden = await page.eval(`window.__ccBridge.chatHidden(false).length`), all = await page.eval(`window.__ccBridge.chatHidden(true).length`);
      return { ok: t === 'function' && hidden === 2 && all === 3, detail: J({ t, hidden, all }) };   // drawn: plain chat only; hidden: both drops (one was hidden by the filter, one redrawn away)
    });

    await inj(collector);
    await sleep(300);
    await check('start-up: lines already in the list (drawn or hidden) are history, nothing is queued', async () => {
      await scan(); const ev = await drain();
      return { ok: ev.length === 0, detail: summary(ev) };
    });
    await check('turning the filter back on (the game redraws its whole list) does not turn history into news', async () => {
      await page.eval(`fx.C.setClanFilter('rareDrops', true); 1`); await sleep(200); await scan();
      const ev = await drain();
      return { ok: ev.length === 0, detail: summary(ev) };
    });

    // ---- the bug -------------------------------------------------------------------------------------------------------------------------
    await page.eval(`fx.C.setClanFilter('rareDrops', false); 1`);
    await add(['clan', null, 'received a rare drop: [T2] Hidden Helm from Some Mob!', null, 'rareDrops', 'Member C']);
    await check('BUG: a clan drop that the game chat has filtered out is still relayed', async () => {
      const shown = await page.eval(`document.querySelectorAll('.chat-message[data-category=rareDrops]').length`);
      await scan(); const ev = await drain();
      return { ok: shown === 0 && ev.length === 1 && ev[0].kind === 'rareDrop' && ev[0].player === 'Member C' && /Hidden Helm/.test(ev[0].text) && ev[0].channel === 'clan', detail: J({ shown }) + ' ' + summary(ev) };
    });
    await check('the same line is not queued twice by the next look', async () => {
      await scan(); await scan(); const ev = await drain();
      return { ok: ev.length === 0, detail: summary(ev) };
    });
    await check('switching the filter on afterwards redraws that line: still only the one event, no double post', async () => {
      await page.eval(`fx.C.setClanFilter('rareDrops', true); 1`); await sleep(200); await scan();
      const ev = await drain();
      return { ok: ev.length === 0, detail: summary(ev) };
    });

    await page.eval(`fx.C.setFilter('global', false); 1`);
    await add(['global', null, 'got a pet: Rock Golem', null, 'pet', 'Member D']);
    await check('BUG: Global greyed out in the game chat: its pet announcement is still relayed (channel global)', async () => {
      const shown = await page.eval(`document.querySelectorAll('.chat-message[data-channel=global]').length`);
      await scan(); const ev = await drain();
      return { ok: shown === 0 && ev.length === 1 && ev[0].channel === 'global' && ev[0].kind === 'petDrop', detail: J({ shown }) + ' ' + summary(ev) };
    });
    await page.eval(`fx.C.setFilter('global', true); 1`);

    await page.eval(`fx.C.setFilter('game', false); 1`);
    await add(['game', null, 'Unlocked: Super Lantern', null, 'unlocks', null]);
    await check('BUG: the personal feed switched off: your own unlock is still relayed (merged into clan, marked self)', async () => {
      await scan(); const ev = await drain();
      return { ok: ev.length === 1 && ev[0].channel === 'clan' && ev[0].self === true && ev[0].kind === 'unlock' && ev[0].player === 'Wulf', detail: summary(ev) };
    });
    await page.eval(`fx.C.setFilter('game', true); 1`);

    await page.eval(`fx.C.setFilter('clan', false); 1`);
    await add(['clan', 'Member A', 'anyone up for a raid?']);
    await check('Clan channel switched off: plain clan chat is still collected (kind chat); the watcher decides what to post', async () => {
      await scan(); const ev = await drain();
      return { ok: ev.length === 1 && ev[0].kind === 'chat' && ev[0].text === 'anyone up for a raid?', detail: summary(ev) };
    });
    await page.eval(`fx.C.setFilter('clan', true); 1`);

    await check('lines the game shows are collected at once, without waiting for a look (the drawn path is unchanged)', async () => {
      await add(['clan', null, 'Level up! Mining level is now 50', null, 'levels', 'Member B']);
      await sleep(100); const ev = await drain();
      return { ok: ev.length === 1 && ev[0].kind === 'levelUp' && ev[0].level === '50' || (ev.length === 1 && ev[0].kind === 'levelUp'), detail: summary(ev) };
    });

    await check('a line that is drawn, then hidden by a filter and drawn again is one event', async () => {
      await add(['clan', null, 'received a rare drop: [T3] Round Trip Shield from Mob!', null, 'rareDrops', 'Member A']);
      await sleep(100); const a = await drain();
      await page.eval(`fx.C.setClanFilter('rareDrops', false); 1`); await sleep(100); await scan();
      await page.eval(`fx.C.setClanFilter('rareDrops', true); 1`); await sleep(100); await scan();
      const b = await drain();
      return { ok: a.length === 1 && b.length === 0, detail: a.length + ' then ' + b.length };
    });

    await check('rescan() (the watcher\'s catch-up) lists hidden lines too, in the game\'s order', async () => {
      await page.eval(`fx.C.setClanFilter('rareDrops', false); 1`);
      const r = JSON.parse(await page.eval(`JSON.stringify(window.__ccChatRelay.rescan())`));
      const names = r.map((e) => e.text).filter((t) => /Hidden Helm|Round Trip|Hidden Old Axe/.test(t));
      return { ok: names.length === 3 && /Hidden Old Axe/.test(names[0]) && /Hidden Helm/.test(names[1]) && /Round Trip/.test(names[2]), detail: J(names) };
    });

    await check('re-injecting the collector keeps what it has seen: nothing old comes back, a new hidden line still does', async () => {
      await add(['clan', null, 'received a rare drop: [T1] Between Injections from Mob!', null, 'rareDrops', 'Member A']);   // hidden, arrives before the re-injection
      await inj(collector); await sleep(300);
      await scan();
      const ev = await drain();
      return { ok: ev.length === 1 && /Between Injections/.test(ev[0].text), detail: summary(ev) };
    });

    await check('without the bridge the drawn lines still work and nothing throws', async () => {
      await page.eval(`window.__ccChatRelay.teardown(); delete window.__ccBridge; 1`);
      await inj(collector); await sleep(200);
      await page.eval(`fx.C.setClanFilter('rareDrops', true); 1`); await sleep(100); await drain();
      await add(['clan', null, 'received a rare drop: [T1] No Bridge Needed from Mob!', null, 'rareDrops', 'Member A']);
      await sleep(150); const ev = await drain();
      return { ok: ev.length === 1 && /No Bridge/.test(ev[0].text), detail: summary(ev) };
    });

    await check('teardown stops the look timer (no collector left running)', async () => {
      await page.eval(`window.__ccChatRelay.teardown(); 1`);
      return { ok: (await page.eval(`typeof window.__ccChatRelay`)) === 'undefined' };
    });
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
