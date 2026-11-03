// Read-only check of the game bridge's walking speed against the game itself, through the debug port (CDP, port 9222).
//   node scripts/verify-bridge-speed.js
// Checks, in the live game page:
//   1. __ccBridge.speed() exists, is cached (same object inside 500 ms), time(steps) is consistent with sps and follows a potion that runs out part-way
//   2. its unbuffed total and the three potion variants equal the game's Unlocks panel ("Total ... (N steps/sec)" and the Swift/Fleet/Haste rows) to 0.1 steps/s
//   3. while walking: equals the game's own path.speed (the speed the game moves the player at), when the page's game state can be reached
//   4. onChange('speed') registers and unsubscribes, and the subscription list survives on window
// Nothing is clicked, drunk or changed. Exit code 1 when a check fails; a check that cannot run (not walking, no potion) is reported as SKIP.
'use strict';
async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = list.find((x) => x.type === 'page' && /scapewatch/i.test(x.url));
  if (!page) { console.log('No Scapewatch page on port 9222.'); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pend = {};
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (pend[j.id]) { pend[j.id](j); delete pend[j.id]; } };
  await new Promise((r) => { ws.onopen = r; });
  const call = (method, params) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };

  const out = []; const check = (name, ok, detail) => { out.push({ name, ok, detail }); console.log((ok === null ? 'SKIP ' : ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

  // 1 + 2 + 4: everything the page can answer on its own
  const page1 = await ev(`(() => {
    const b = window.__ccBridge; if (!b || !b.speed) return { err: 'no bridge.speed' };
    const s = b.speed(), s2 = b.speed();
    const o = { sps: s.sps, unbuffed: s.unbuffed, potion: s.potion, mods: s.mods.length, cached: s === s2, t0: s.time(0), t100: s.time(100), tNeg: s.time(-5) };
    if (s.potion) { const L = s.potion.stepsLeft; o.tAcross = s.time(L + 1000); o.expectAcross = L / s.sps + 1000 / s.unbuffed; o.tWithin = s.time(L / 2); o.expectWithin = (L / 2) / s.sps; }
    const row = document.querySelector('.unlocks-perk-row[data-perk="movespeed"]');
    o.panel = row ? row.textContent : null;
    const off = b.onChange('speed', function () {}); o.off = typeof off; o.subs = window.__ccBridgeSubs && window.__ccBridgeSubs.speed.length; off(); o.subsAfter = window.__ccBridgeSubs.speed.length;
    o.badName = typeof b.onChange('nothing', function () {});
    return o; })()`);
  if (page1.err) { check('bridge.speed() available', false, page1.err); ws.close(); process.exit(1); }
  check('speed() returns a positive number and a breakdown', page1.sps > 0 && page1.unbuffed > 0 && page1.mods >= 1, 'sps ' + page1.sps.toFixed(3) + ', unbuffed ' + page1.unbuffed.toFixed(3) + ', ' + page1.mods + ' mods');
  check('speed() is cached (same object twice in a row)', page1.cached);
  check('time(steps) = steps / sps, 0 for none or negative', page1.t0 === 0 && page1.tNeg === 0 && (page1.potion ? true : Math.abs(page1.t100 - 100 / page1.sps) < 1e-9));
  if (page1.potion) {
    check('time() inside the potion = steps / sps', Math.abs(page1.tWithin - page1.expectWithin) < 1e-6);
    check('time() across the end of the potion follows the unbuffed speed', Math.abs(page1.tAcross - page1.expectAcross) < 1e-6, page1.tAcross.toFixed(1) + ' s');
  } else check('time() across the end of a potion', null, 'no movement potion active');
  const num = (re) => { const m = page1.panel && page1.panel.match(re); return m ? parseFloat(m[1]) : null; };
  const panelTotal = num(/Total Movement Speed[^(]*\(([\d.]+) steps\/sec\)/);
  check('unbuffed total equals the Unlocks panel', panelTotal != null && Math.abs(page1.unbuffed - panelTotal) < 0.051, 'bridge ' + page1.unbuffed.toFixed(2) + ' vs panel ' + panelTotal);
  const potRows = { 'Swift Potion': 0.15, 'Fleet Potion': 0.3, 'Haste Potion': 0.5 };
  const rv = await ev(`(() => { const s = window.__ccBridge.speed(), un = s.unbuffed, base = s.mods[0].steps + 10; return { un, vigSteps: base }; })()`);
  Object.keys(potRows).forEach((k) => {
    const v = num(new RegExp(k + ': ([\\d.]+) steps/sec'));
    const mine = rv.un + rv.vigSteps * potRows[k];
    check(k + ' row equals unbuffed + pct x Vigor speed', v != null && Math.abs(mine - v) < 0.051, 'bridge ' + mine.toFixed(2) + ' vs panel ' + v);
  });
  check('onChange subscribes, unsubscribes and ignores unknown names', page1.off === 'function' && page1.subs >= 1 && page1.subsAfter === page1.subs - 1 && page1.badName === 'function');
  if (page1.potion) { const rowPot = num(new RegExp(page1.potion.name + ': ([\\d.]+) steps/sec')); check('current speed equals the panel row of the active potion', rowPot != null && Math.abs(page1.sps - rowPot) < 0.051, 'bridge ' + page1.sps.toFixed(2) + ' vs panel ' + rowPot); }

  // 3: the game's own path.speed while walking (game state objects are bundle-scoped: found the way the watcher finds them)
  const proto = await call('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: 'vbs' });
  const qo = await call('Runtime.queryObjects', { prototypeObjectId: proto.result.result.objectId, objectGroup: 'vbs' });
  const r = await call('Runtime.callFunctionOn', {
    objectId: qo.result.objects.objectId, returnByValue: true,
    functionDeclaration: 'function(){var G=null;for(var i=0;i<this.length&&!G;i++){var x=this[i];try{if(x&&typeof x._estimateActionDuration==="function"&&x.skills)G=x}catch(e){}} if(!G)return {err:"no game state"}; var s=window.__ccBridge.speed(); return {state:G.state,pathSpeed:G.path&&G.path.speed,sps:s.sps,unbuffed:s.unbuffed,potion:!!s.potion};}',
  });
  await call('Runtime.releaseObjectGroup', { objectGroup: 'vbs' });
  const g = r.result.result.value;
  if (!g || g.err) check('equals the game path.speed', null, g ? g.err : 'no result');
  else if (g.state !== 'moving' || !g.pathSpeed) check('equals the game path.speed', null, 'not walking right now (state ' + g.state + '); run again while walking');
  else check('equals the game path.speed while walking' + (g.potion ? ' (potion on)' : ' (no potion)'), Math.abs(g.pathSpeed - g.sps) < 1e-9, 'game ' + g.pathSpeed + ' vs bridge ' + g.sps);
  ws.close();
  process.exit(out.some((o) => o.ok === false) ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
