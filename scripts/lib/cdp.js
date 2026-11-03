// A small Chrome DevTools Protocol client for the test scripts (node 22+, uses the global WebSocket and fetch; no packages).
//   const page = await cdp.connectToPage(9222, /scapewatch/i);   // or connectToPage(9333, /cards-fixture/)
//   await page.eval('1 + 1');  page.click(x, y);  page.move(x, y);  page.down(x, y);  page.up(x, y);  page.close();
// Mouse input goes through Input.dispatchMouseEvent, so the page sees real (isTrusted) events, exactly like the user's mouse.
'use strict';

async function listTargets(port) { return (await fetch('http://127.0.0.1:' + port + '/json')).json(); }

async function connectToPage(port, urlRe, timeoutMs) {
  const end = Date.now() + (timeoutMs || 0); let tg = null;
  for (;;) {
    try { tg = (await listTargets(port)).find((t) => t.type === 'page' && urlRe.test(t.url)); } catch (e) { tg = null; }
    if (tg || Date.now() >= end) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!tg) throw new Error('no page matching ' + urlRe + ' on port ' + port);
  const ws = new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('websocket error'))); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); const p = d.id && pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const api = {
    send, url: tg.url,
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page error: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return r.result.value;
    },
    mouse: (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'none', buttons: 0, clickCount: 0 }, extra || {})),
    move(x, y) { return api.mouse('mouseMoved', x, y); },
    down(x, y) { return api.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 }); },
    up(x, y) { return api.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 }); },
    async click(x, y) { await api.move(x, y); await api.down(x, y); await api.up(x, y); },
    close() { try { ws.close(); } catch (e) { /* closed */ } },
  };
  return api;
}
module.exports = { connectToPage, listTargets };
