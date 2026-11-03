// npm run test:discord -- tests for the shared Discord sender (overlay/discord-sender.js), the atomic state files (overlay/safe-json.js)
// and the dashboard test-send guard. Everything talks to a FAKE webhook server on 127.0.0.1: nothing here can reach real Discord.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const S = require('../overlay/discord-sender');
const J = require('../overlay/safe-json');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sl-discord-'));

// ---- fake Discord ----------------------------------------------------------------------------------------------------------
// script: array of handlers/answers consumed one per request; when empty, answers 200 { id } / 204. Each request is logged.
function fake() {
  const f = { hits: [], script: [], messages: {}, nextId: 100, server: null, url: '', port: 0 };
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const hit = { t: Date.now(), method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      f.hits.push(hit);
      const step = f.script.shift();
      const reply = (code, obj, headers) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, headers || {})); res.end(obj == null ? '' : JSON.stringify(obj)); };
      if (typeof step === 'function') { step(req, res, hit, reply); return; }
      if (step) { reply(step.code, step.body, step.headers); return; }
      if (req.method === 'POST') { const id = String(f.nextId++); f.messages[id] = hit.body; if (/wait=true/.test(req.url)) reply(200, { id }); else reply(204); return; }
      if (req.method === 'PATCH') { const id = req.url.split('/messages/')[1].split('?')[0]; if (!f.messages[id]) { reply(404, { code: 10008, message: 'Unknown Message' }); return; } f.messages[id] = hit.body; reply(200, { id }); return; }
      reply(204);
    });
  });
  return new Promise((resolve) => f.server.listen(0, '127.0.0.1', () => { f.port = f.server.address().port; f.url = 'http://127.0.0.1:' + f.port + '/api/webhooks/123456/SECRETTOKEN-abc'; resolve(f); }));
}
const quick = (extra) => S.createSender(Object.assign({ timeoutMs: 400, backoffBaseMs: 20, backoffMaxMs: 80, cooldownMaxMs: 120, bucketWindowMs: 200, brokenProbeMs: 60000, maxWaitMs: 5000 }, extra || {}));

async function withFake(fn) { const f = await fake(); try { await fn(f); } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); } }

// ---- sender ----------------------------------------------------------------------------------------------------------------
test('a plain post arrives, with allowed_mentions {parse: []} added', () => withFake(async (f) => {
  const s = quick();
  const r = await s.send('relay', f.url, { content: 'hello @everyone', username: 'Wulf' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.hits.length, 1);
  assert.deepStrictEqual(f.hits[0].body.allowed_mentions, { parse: [] });
  assert.strictEqual(f.hits[0].body.content, 'hello @everyone');
  assert.ok(/ScapeLite/.test(f.hits[0].headers['user-agent']));
}));

test('files: sent as multipart (payload_json + the file), still sanitised, attachments kept; plain sends stay JSON', async () => {
  let got = null;
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got = { ct: req.headers['content-type'], b }; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"9"}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = 'http://127.0.0.1:' + srv.address().port + '/api/webhooks/1/T';
    const s = quick();
    const r = await s.send('board', url, { username: 'ScapeLite', embeds: [{ description: 'x', author: { name: 'W', icon_url: 'attachment://logo.png' } }], attachments: [{ id: 0, filename: 'logo.png' }], allowed_mentions: { parse: ['everyone'] } }, { wait: true, files: [{ name: 'logo.png', data: Buffer.from([137, 80, 78, 71]), type: 'image/png' }] });
    assert.ok(r.ok && r.id === '9');
    assert.ok(/^multipart\/form-data; boundary=/.test(got.ct), got.ct);
    assert.ok(/name="payload_json"/.test(got.b) && /name="files\[0\]"; filename="logo.png"/.test(got.b));
    const pj = JSON.parse(/name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/.exec(got.b)[1]);
    assert.deepStrictEqual(pj.allowed_mentions, { parse: [] }); assert.deepStrictEqual(pj.attachments, [{ id: 0, filename: 'logo.png' }]);
    await s.send('board', url, { content: 'plain' });
    assert.strictEqual(got.ct, 'application/json');
  } finally { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); }
});

test('allowed_mentions: only named role ids can ping, never everyone', () => {
  const r = S.sanitizePayload({ content: 'x', allowed_mentions: { parse: ['everyone', 'roles'], roles: ['123456', 'bad'], users: ['999999'] } });
  assert.deepStrictEqual(r.payload.allowed_mentions, { parse: [], roles: ['123456'], users: ['999999'] });
});

test('wait=true returns the message id; PATCH edits it; a deleted message reports messageGone (webhook stays healthy)', () => withFake(async (f) => {
  const s = quick();
  const c = await s.send('board', f.url, { content: 'v1' }, { wait: true });
  assert.ok(c.ok && c.id, 'created with an id');
  assert.ok(/wait=true/.test(f.hits[0].url));
  const e = await s.send('board', f.url, { content: 'v2' }, { messageId: c.id });
  assert.ok(e.ok);
  assert.strictEqual(f.hits[1].method, 'PATCH');
  assert.ok(f.hits[1].url.includes('/messages/' + c.id));
  const gone = await s.send('board', f.url, { content: 'v3' }, { messageId: '555' });
  assert.strictEqual(gone.ok, false); assert.strictEqual(gone.messageGone, true); assert.strictEqual(gone.status, 404);
  assert.strictEqual(s.isBroken(f.url), false, 'a deleted message is not a dead webhook');
  const again = await s.send('board', f.url, { content: 'v4' });
  assert.ok(again.ok);
}));

test('PATCH 404 with code 10015 (unknown webhook) does mark the webhook broken', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 404, body: { code: 10015, message: 'Unknown Webhook' } });
  const r = await s.send('board', f.url, { content: 'x' }, { messageId: '1' });
  assert.ok(r.broken && r.permanent);
  assert.strictEqual(s.isBroken(f.url), true);
}));

test('429 with retry_after: waits that long, then succeeds with exactly one retry', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 429, body: { message: 'You are being rate limited.', retry_after: 0.3, global: false }, headers: { 'retry-after': '1' } });
  const t0 = Date.now();
  const r = await s.send('relay', f.url, { content: 'a' });
  const dt = Date.now() - t0;
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(f.hits.length, 2);
  assert.ok(dt >= 290, 'waited retry_after (' + dt + ' ms)');
  assert.ok(dt < 1200, 'did not wait the rounded-up Retry-After header (' + dt + ' ms)');
  assert.strictEqual(s.health().features.relay.failed, 0, 'a rate limit is not a failure');
}));

test('429 with retry_after longer than maxWaitMs is deferred at once (the caller keeps its data)', () => withFake(async (f) => {
  const s = quick({ maxWaitMs: 300 });
  f.script.push({ code: 429, body: { message: 'slow down', retry_after: 5 } });
  const r = await s.send('digest', f.url, { content: 'a' });
  assert.strictEqual(r.ok, false); assert.ok(r.deferred && r.rateLimited);
  assert.ok(r.retryAt > Date.now() + 3000);
  const n = f.hits.length;
  const r2 = await s.send('digest', f.url, { content: 'b' });
  assert.ok(r2.deferred); assert.strictEqual(f.hits.length, n, 'no request while rate limited');
  assert.ok(s.health().features.digest.rateLimitedUntil);
}));

test('X-RateLimit-Remaining 0 + Reset-After delays the next request without a 429', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 204, body: null, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.25' } });
  await s.send('relay', f.url, { content: 'a' });
  const t1 = Date.now();
  await s.send('relay', f.url, { content: 'b' });
  assert.ok(Date.now() - t1 >= 230, 'second request waited for the bucket reset');
  assert.strictEqual(f.hits.length, 2);
}));

test('local bucket: more than 5 sends inside the window are spread out, never dropped', () => withFake(async (f) => {
  const s = quick({ bucketSize: 3, bucketWindowMs: 300 });
  const t0 = Date.now();
  const rs = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => s.send('relay', f.url, { content: 'm' + i })));
  assert.ok(rs.every((r) => r.ok));
  assert.strictEqual(f.hits.length, 7);
  for (let i = 3; i < 7; i++) assert.ok(f.hits[i].t - f.hits[i - 3].t >= 290, 'hit ' + i + ' respected 3 per 300 ms');
  assert.ok(Date.now() - t0 >= 590);
}));

test('queue order is kept even when the first message is rate limited', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 429, body: { retry_after: 0.15 } });
  const ps = ['A', 'B', 'C', 'D'].map((c) => s.send('relay', f.url, { content: c }));
  await Promise.all(ps);
  const order = f.hits.filter((h) => h.body).map((h) => h.body.content).filter((c) => c);
  assert.deepStrictEqual([...new Set(order)], ['A', 'B', 'C', 'D']);
  assert.strictEqual(order.indexOf('B') > order.lastIndexOf('A'), true);
}));

test('timeout: a hanging webhook does not hang the sender; the item fails as retryable', () => withFake(async (f) => {
  const s = quick({ timeoutMs: 120, maxAttempts: 2 });
  const hang = (req, res) => { /* never answer */ };
  f.script.push(hang, hang);
  const t0 = Date.now();
  const r = await s.send('relay', f.url, { content: 'a' });
  assert.strictEqual(r.ok, false); assert.ok(r.retryable); assert.ok(/timed out/.test(r.error), r.error);
  assert.strictEqual(r.attempts, 2);
  assert.ok(Date.now() - t0 < 1500);
}));

test('5xx: retried with growing backoff and then succeeds', () => withFake(async (f) => {
  const s = quick({ backoffBaseMs: 80, backoffMaxMs: 1000, random: () => 1 });
  f.script.push({ code: 502, body: {} }, { code: 503, body: {} });
  const r = await s.send('relay', f.url, { content: 'a' });
  assert.ok(r.ok); assert.strictEqual(f.hits.length, 3); assert.strictEqual(r.attempts, 3);
  const g1 = f.hits[1].t - f.hits[0].t, g2 = f.hits[2].t - f.hits[1].t;
  assert.ok(g1 >= 75, 'first backoff ' + g1);
  assert.ok(g2 >= 150, 'second backoff doubled: ' + g2);
}));

test('5xx exhausted: retryable failure, then a cool-down answers instantly without new requests', () => withFake(async (f) => {
  const s = quick({ maxAttempts: 3 });
  f.script.push({ code: 500, body: {} }, { code: 500, body: {} }, { code: 500, body: {} });
  const r = await s.send('digest', f.url, { content: 'a' });
  assert.strictEqual(r.ok, false); assert.ok(r.retryable);
  assert.strictEqual(f.hits.length, 3);
  const r2 = await s.send('digest', f.url, { content: 'b' });
  assert.ok(r2.deferred, 'cooling down'); assert.strictEqual(f.hits.length, 3);
  await sleep(300);
  const r3 = await s.send('digest', f.url, { content: 'c' });
  assert.ok(r3.ok, 'tries again after the cool-down');
}));

test('network error (nothing listening) fails as retryable without throwing, and never leaks the URL', async () => {
  const s = quick({ maxAttempts: 2 });
  const logs = [];
  const s2 = quick({ maxAttempts: 2, log: (t) => logs.push(t) });
  const url = 'http://127.0.0.1:1/api/webhooks/123456/SECRETTOKEN-abc';
  const r = await s2.send('relay', url, { content: 'a' });
  assert.strictEqual(r.ok, false); assert.ok(r.retryable);
  assert.ok(!JSON.stringify(logs).includes('SECRETTOKEN'), 'log has no token');
  assert.ok(!JSON.stringify(r).includes('SECRETTOKEN'));
  assert.ok(!JSON.stringify(s2.health()).includes('SECRETTOKEN'));
  void s;
});

for (const code of [401, 403, 404]) {
  test('HTTP ' + code + ' on the webhook: broken at once, queued items fail without requests, no retry storm', () => withFake(async (f) => {
    const s = quick();
    f.script.push({ code, body: { message: 'nope' } });
    const ps = [s.send('relay', f.url, { content: 'a' }), s.send('relay', f.url, { content: 'b' }), s.send('digest', f.url, { content: 'c' })];
    const rs = await Promise.all(ps);
    assert.ok(rs.every((r) => !r.ok && r.permanent && r.broken), JSON.stringify(rs));
    assert.strictEqual(f.hits.length, 1, 'exactly one request was made');
    const later = await s.send('relay', f.url, { content: 'd' });
    assert.ok(later.broken); assert.strictEqual(f.hits.length, 1);
    const h = s.health();
    assert.strictEqual(h.features.relay.broken, true);
    assert.ok(h.features.relay.brokenReason && h.features.relay.brokenReason.length > 10);
    assert.strictEqual(h.features.relay.lastStatus, code);
    assert.ok(!JSON.stringify(h).includes('SECRETTOKEN'));
  }));
}

test('broken webhook: a forced probe (Test button) tries again and clears the flag on success', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 404, body: {} });
  await s.send('relay', f.url, { content: 'a' });
  assert.ok(s.isBroken(f.url));
  const r = await s.send('relay', f.url, { content: 'test' }, { force: true });
  assert.ok(r.ok); assert.strictEqual(s.isBroken(f.url), false);
}));

test('400 is a bad payload (rejected, permanent for that message) and does not break the webhook', () => withFake(async (f) => {
  const s = quick();
  f.script.push({ code: 400, body: { message: 'Invalid Form Body' } });
  const r = await s.send('relay', f.url, { content: 'a' });
  assert.ok(r.rejected && r.permanent && !r.broken);
  assert.strictEqual(s.isBroken(f.url), false);
}));

test('limits: content 2000, 10 embeds, 6000 embed characters, field sizes', () => {
  const big = 'x'.repeat(5000);
  let r = S.sanitizePayload({ content: big });
  assert.strictEqual(r.payload.content.length, 2000);
  const embeds = [];
  for (let i = 0; i < 14; i++) embeds.push({ title: 't' + i, description: 'd'.repeat(500) });
  r = S.sanitizePayload({ embeds });
  assert.ok(r.payload.embeds.length <= 10);
  const total = (p) => p.embeds.reduce((a, e) => a + (e.title || '').length + (e.description || '').length + (e.fields || []).reduce((b, f) => b + f.name.length + f.value.length, 0), 0);
  assert.ok(total(r.payload) <= 6000, 'embed total ' + total(r.payload));
  r = S.sanitizePayload({ embeds: [{ description: 'y'.repeat(9000), fields: Array.from({ length: 40 }, (_, i) => ({ name: 'n'.repeat(400), value: 'v'.repeat(2000) })) }] });
  assert.ok(total(r.payload) <= 6000);
  assert.ok(r.payload.embeds[0].description.length <= 4096);
  assert.ok((r.payload.embeds[0].fields || []).length <= 25);
  (r.payload.embeds[0].fields || []).forEach((f) => { assert.ok(f.name.length <= 256 && f.value.length <= 1024); });
  assert.ok(S.sanitizePayload({}).error, 'an empty message is refused locally');
  assert.strictEqual(S.sanitizePayload({ content: 'a', username: 'u'.repeat(200) }).payload.username.length, 80);
});

test('what reaches the server is already within the limits', () => withFake(async (f) => {
  const s = quick();
  await s.send('digest', f.url, { content: 'z'.repeat(9000) });
  assert.strictEqual(f.hits[0].body.content.length, 2000);
}));

test('splitContent: pieces fit, split at line breaks, nothing lost', () => {
  const lines = Array.from({ length: 300 }, (_, i) => 'line number ' + i + ' ' + 'w'.repeat(20));
  const parts = S.splitContent(lines.join('\n'), 2000);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 2000));
  assert.strictEqual(parts.join('\n').split('\n').length, 300);
  const one = S.splitContent('q'.repeat(4500), 2000);
  assert.ok(one.every((p) => p.length <= 2000)); assert.strictEqual(one.join('').length, 4500);
});

test('chunkBlocks keeps blocks whole and the head only on the first chunk', () => {
  const blocks = Array.from({ length: 40 }, (_, i) => ({ text: '**P' + i + '**\n' + 'drops '.repeat(30), name: 'P' + i }));
  const chunks = S.chunkBlocks(blocks, { max: 2000, head: 'HEAD' });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.text.length <= 2000));
  assert.ok(chunks[0].text.startsWith('HEAD') && !chunks[1].text.startsWith('HEAD'));
  assert.strictEqual(chunks.reduce((a, c) => a + c.blocks.length, 0), 40);
});

test('data is kept until accepted: a failing 2nd chunk leaves the unsent part in the buffer', () => withFake(async (f) => {
  const s = quick({ maxAttempts: 1 });
  const buffer = { players: {} };
  for (let i = 0; i < 12; i++) buffer.players['P' + i] = { text: ('item' + i + ' ').repeat(60) };
  const blocks = Object.keys(buffer.players).map((n) => ({ text: n + ' ' + buffer.players[n].text, name: n }));
  const chunks = S.chunkBlocks(blocks, { max: 900 });
  assert.ok(chunks.length >= 3, 'needs several chunks: ' + chunks.length);
  f.script.push(null, { code: 500, body: {} });
  let saves = 0;
  const r = await S.deliverChunks(s, 'digest', f.url, chunks, (c) => ({ content: c.text }), (c) => { c.blocks.forEach((b) => { delete buffer.players[b.name]; }); saves++; });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.sent, 1); assert.strictEqual(saves, 1);
  assert.strictEqual(Object.keys(buffer.players).length, 12 - chunks[0].blocks.length, 'only the accepted chunk left the buffer');
  assert.strictEqual(f.hits.length, 2, 'stopped at the first failure');
  // next try (the webhook recovers) sends the rest only
  await sleep(300);
  const rest = S.chunkBlocks(Object.keys(buffer.players).map((n) => ({ text: n + ' ' + buffer.players[n].text, name: n })), { max: 900 });
  const r2 = await S.deliverChunks(s, 'digest', f.url, rest, (c) => ({ content: c.text }), (c) => c.blocks.forEach((b) => { delete buffer.players[b.name]; }));
  assert.ok(r2.ok); assert.strictEqual(Object.keys(buffer.players).length, 0);
}));

test('replaceKey: the newest queued message wins, older ones resolve as superseded', () => withFake(async (f) => {
  const s = quick({ bucketSize: 1, bucketWindowMs: 200 });
  await s.send('board', f.url, { content: 'first' });         // fills the bucket so the next ones wait in the queue
  const a = s.send('board', f.url, { content: 'edit 1' }, { replaceKey: 'card' });
  const b = s.send('board', f.url, { content: 'edit 2' }, { replaceKey: 'card' });
  const c = s.send('board', f.url, { content: 'edit 3' }, { replaceKey: 'card' });
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.ok(ra.superseded && rb.superseded && rc.ok);
  assert.deepStrictEqual(f.hits.map((h) => h.body.content), ['first', 'edit 3']);
}));

test('health model: per feature last success / last error / queue length / broken, per webhook, no secrets', () => withFake(async (f) => {
  const s = quick({ maxAttempts: 1 });
  await s.send('relay', f.url, { content: 'ok' });
  f.script.push({ code: 500, body: {} });
  await sleep(10);
  await s.send('digest', f.url, { content: 'bad' });
  const h = s.health();
  assert.ok(h.features.relay.lastOkAt && !h.features.relay.lastError);
  assert.ok(h.features.digest.lastErrorAt && /500/.test(h.features.digest.lastError));
  assert.strictEqual(h.features.relay.queueLength, 0);
  assert.strictEqual(Object.keys(h.webhooks).length, 1);
  assert.ok(!JSON.stringify(h).includes('127.0.0.1') && !JSON.stringify(h).includes('SECRET'));
}));

test('no URL configured: send resolves with an error instead of throwing', async () => {
  const r = await quick().send('relay', '', { content: 'a' });
  assert.strictEqual(r.ok, false);
});

// ---- atomic state files ----------------------------------------------------------------------------------------------------
test('writeJsonAtomic leaves no .tmp file, replaces the file, keeps a .bak of the previous good copy', () => {
  const d = tmp(), file = path.join(d, 'state.json');
  J.writeJsonAtomic(file, [1, 2, 3]);
  J.writeJsonAtomic(file, [1, 2, 3, 4]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [1, 2, 3, 4]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), [1, 2, 3]);
  assert.ok(!fs.existsSync(file + '.tmp'));
  for (let i = 0; i < 50; i++) J.writeJsonAtomic(file, { n: i });
  assert.deepStrictEqual(J.readJsonRecover(file, null), { n: 49 });
  assert.ok(fs.readdirSync(d).every((n) => !n.endsWith('.tmp')));
});

test('a crash between temp write and rename keeps the old file intact', () => {
  const d = tmp(), file = path.join(d, 'state.json');
  J.writeJsonAtomic(file, { good: true });
  fs.writeFileSync(file + '.tmp', '{"half":');           // what a crash during the write leaves behind
  assert.deepStrictEqual(J.readJsonRecover(file, null), { good: true });
  J.writeJsonAtomic(file, { good: 2 });                  // and the next write simply replaces the stale temp
  assert.deepStrictEqual(J.readJsonRecover(file, null), { good: 2 });
});

test('truncated array file: the readable part is recovered', () => {
  const d = tmp(), file = path.join(d, 'outbox.json');
  fs.writeFileSync(file, '[{"id":"a","text":"one"},{"id":"b","text":"two"},{"id":"c","tex');
  const info = {};
  const v = J.readJsonRecover(file, [], info);
  assert.deepStrictEqual(v.map((x) => x.id), ['a', 'b']);
  assert.strictEqual(info.recovered, 'salvage');
  assert.ok(fs.existsSync(file + '.corrupt'), 'the broken file is kept for inspection');
});

test('truncated object file: falls back to the .bak copy, then to the fallback value', () => {
  const d = tmp(), file = path.join(d, 'digest.json');
  J.writeJsonAtomic(file, { players: { A: 1 } });
  J.writeJsonAtomic(file, { players: { A: 1, B: 2 } });
  fs.writeFileSync(file, '{"players":{"A":1,"B"');
  const info = {};
  assert.deepStrictEqual(J.readJsonRecover(file, null, info), { players: { A: 1 } });
  assert.strictEqual(info.recovered, 'backup');
  fs.unlinkSync(file + '.bak');
  assert.deepStrictEqual(J.readJsonRecover(file, { fresh: true }), { fresh: true });
  assert.deepStrictEqual(J.readJsonRecover(path.join(d, 'missing.json'), 7), 7);
  fs.writeFileSync(file, '');
  assert.deepStrictEqual(J.readJsonRecover(file, { fresh: 2 }), { fresh: 2 });
});

// ---- dashboard test-send guard ---------------------------------------------------------------------------------------------
test('the test-send endpoint only accepts the dashboard itself: local host, same-origin Origin header, control header', () => {
  const { testSendAllowed } = require('../overlay/status-server');
  const req = (h) => ({ headers: h });
  const good = { host: 'localhost:7777', origin: 'http://localhost:7777', 'x-cc-control': '1' };
  assert.strictEqual(testSendAllowed(req(good)), true);
  assert.strictEqual(testSendAllowed(req(Object.assign({}, good, { host: 'scapelite.localhost', origin: 'http://scapelite.localhost' }))), true);
  assert.strictEqual(testSendAllowed(req({ host: 'localhost:7777', 'x-cc-control': '1' })), false, 'no Origin header (curl, scripts)');
  assert.strictEqual(testSendAllowed(req(Object.assign({}, good, { origin: 'https://play.scapewatch.com' }))), false, 'the game page');
  assert.strictEqual(testSendAllowed(req(Object.assign({}, good, { origin: 'https://evil.example' }))), false);
  assert.strictEqual(testSendAllowed(req(Object.assign({}, good, { host: 'evil.example' }))), false, 'DNS rebinding');
  assert.strictEqual(testSendAllowed(req({ host: good.host, origin: good.origin })), false, 'missing control header');
});

(async () => {
  console.log('discord sender');
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); } catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
