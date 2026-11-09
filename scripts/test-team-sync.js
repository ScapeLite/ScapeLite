// npm run test:teamsync -- team settings sync (overlay/team-sync.js and the "ts" storage in overlay/relay-lease.js).
// Pure checks (whitelist, validation, injection strings, secrets, text format, chunking, diff, plan) and a FAKE Discord on 127.0.0.1 with the real sender and the real lease:
// one PC publishes, another gathers; a republish edits in place; a heartbeat keeps the pointer; damaged and missing parts are reported.
'use strict';
const http = require('http');
const zlib = require('zlib');
const assert = require('assert');
const T = require('../overlay/team-sync');
const L = require('../overlay/relay-lease');
const S = require('../overlay/discord-sender');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOOK = 'https://discord.com/api/' + 'webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
const HOOK2 = 'https://discord.com/api/' + 'webhooks/223456789012345678/ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-wxyz';
const LEASE_HOOK = 'https://discord.com/api/' + 'webhooks/777777777777777777/LeaseLeaseLeaseLeaseLease_123456';
const src = () => ({
  plugin: { clanRelayEnabled: true, globalRelayEnabled: false, relayPlainChat: true, pingRoles: [{ name: 'Rare drops', roleId: '111111111111111111', categories: ['rareDrop', 'shinyRareDrop'] }, { name: 'Pets', roleId: '222222222222222222', categories: ['pet'] }],
    hiscoresEnabled: true, hiscoresPollMinutes: 20, hiscoresPostIntervalHours: 6, hiscoresMajorRankChange: 3, digestEnabled: true, digestIntervalHours: 6, digestPostTimes: '14:00, 20:00',
    raidSummaryEnabled: true, raidSummaryMode: 'any', raidSummaryMinMembers: 2, clanBoardIntervalMin: 5, clanBoardTask: true,
    relayRole: 'never', uiPalette: 'game', alertSound: true, relayLeaseWebhook: LEASE_HOOK },
  files: { clanTag: 'ABC', clanMembers: ['Member A', 'Member B', 'Member C'], ultraRareKeywords: ['shiny', 'lucky'] },
  secrets: { relayClanWebhook: HOOK, digestWebhook: HOOK2, relayLeaseWebhook: LEASE_HOOK },
});

// ---------------------------------------------------------------- pure
test('collect: only whitelisted keys, nothing local, no webhook address by default', () => {
  const b = T.collect(src(), { by: 'Member A', at: 1793104926944 });
  assert.ok(b.k.pingRoles && b.k.clanTag === 'ABC' && b.k.digestPostTimes === '14:00, 20:00');
  ['relayRole', 'uiPalette', 'alertSound', 'relayLeaseWebhook'].forEach((k) => assert.strictEqual(b.k[k], undefined, k));
  assert.strictEqual(b.s, undefined);
  assert.ok(!JSON.stringify(b).includes('discord.com'));
});
test('collect with webhook addresses on request: known channels only, never the lease webhook', () => {
  const b = T.collect(src(), { includeUrls: true });
  assert.deepStrictEqual(Object.keys(b.s).sort(), ['digestWebhook', 'relayClanWebhook']);
  assert.ok(!JSON.stringify(b).includes('LeaseLease'));
});
test('validate: unknown keys, the relay mode and the lease webhook are refused', () => {
  const v = T.validateBundle({ v: 1, k: { relayRole: 'always', relayLeaseWebhook: LEASE_HOOK, uiPalette: 'x', clanTag: 'ABC', evil: 1, '__proto__': { x: 1 } }, s: { relayLeaseWebhook: LEASE_HOOK, relayClanWebhook: HOOK } });
  assert.ok(v.ok);
  assert.deepStrictEqual(Object.keys(v.bundle.k), ['clanTag']);
  assert.deepStrictEqual(Object.keys(v.bundle.s), ['relayClanWebhook']);
  ['relayRole', 'relayLeaseWebhook', 'uiPalette', 'evil'].forEach((k) => assert.ok(v.refused.includes(k), k));
  assert.strictEqual(Object.prototype.x, undefined);
});
test('validate: mention and markup injection in names is removed, bad role ids are dropped', () => {
  const v = T.validateBundle({ v: 1, k: { pingRoles: [
    { name: '@everyone <@&123> `rm -rf` @here', roleId: '333333333333333333', categories: ['rareDrop', 'nonsense'] },
    { name: 'Short id', roleId: '12345', categories: ['pet'] },
    { name: 'Letters', roleId: '33333333333333333x', categories: [] },
    'not a role', null,
  ], clanMembers: ['<@&999>', 'Member\u0000 A', '@everyone'], ultraRareKeywords: ['shiny', '<b>x</b>'], clanTag: '<script>' } });
  const k = v.bundle.k;
  assert.strictEqual(k.pingRoles.length, 1);
  assert.ok(!/[@<>`]/.test(k.pingRoles[0].name), k.pingRoles[0].name);
  assert.deepStrictEqual(k.pingRoles[0].categories, ['rareDrop']);
  assert.ok(k.clanMembers.every((m) => !/[@<>\u0000]/.test(m)), JSON.stringify(k.clanMembers));
  assert.ok(!/[<>]/.test(k.clanTag));
});
test('validate: numbers are clamped, wrong types dropped, caps hold', () => {
  const v = T.validateBundle({ v: 1, k: { hiscoresPollMinutes: 99999, hiscoresPostIntervalHours: -4, raidSummaryMinMembers: '3', digestEnabled: 'yes', raidSummaryMode: 'maybe', digestPostTimes: '14:00 <b>', clanMembers: new Array(500).fill('Member A'), pingRoles: new Array(40).fill({ name: 'R', roleId: '444444444444444444', categories: [] }) } });
  const k = v.bundle.k;
  assert.strictEqual(k.hiscoresPollMinutes, 1440); assert.strictEqual(k.hiscoresPostIntervalHours, 1);
  ['raidSummaryMinMembers', 'digestEnabled', 'raidSummaryMode', 'digestPostTimes'].forEach((x) => assert.strictEqual(k[x], undefined, x));
  assert.strictEqual(k.clanMembers.length, T.LIMITS.maxMembers); assert.strictEqual(k.pingRoles.length, T.LIMITS.maxRoles);
});
test('validate: a different bundle version and non-objects are refused', () => {
  assert.ok(!T.validateBundle({ v: 2, k: {} }).ok); assert.ok(!T.validateBundle(null).ok); assert.ok(!T.validateBundle([]).ok); assert.ok(!T.validateBundle('x').ok);
});
test('text: round trip, whole-text checksum, damaged and foreign text, inflate bomb', () => {
  const b = T.collect(src(), { by: 'Member A', at: 1793104926944 });
  const e = T.encodeText(b); assert.ok(e.ok && e.text.startsWith('SLT1.'));
  const d = T.decodeText(e.text); assert.ok(d.ok); assert.deepStrictEqual(d.bundle.k, b.k); assert.strictEqual(d.bundle.by, 'Member A');
  assert.ok(T.decodeText('  ' + e.text.replace(/(.{40})/g, '$1\n') + ' ').ok, 'line breaks and spaces from a chat paste are fine');
  const bad = e.text.slice(0, 20) + (e.text[20] === 'A' ? 'B' : 'A') + e.text.slice(21);
  assert.ok(!T.decodeText(bad).ok && /checksum|damaged/.test(T.decodeText(bad).error));
  assert.ok(!T.decodeText('hello').ok); assert.ok(!T.decodeText('').ok);
  const bomb = zlib.deflateRawSync(Buffer.alloc(5 * 1024 * 1024, 0x20)).toString('base64url');
  assert.ok(!T.decodeText('SLT1.' + bomb + '.' + T.hash8(bomb)).ok, 'an inflate bomb is refused');
});
test('text: the settings are refused when they would not fit', () => {
  const b = T.collect(src(), {}); b.k.ultraRareKeywords = new Array(2000).fill('x'.repeat(30));   // validate would cap it; encode must still refuse a huge object
  assert.ok(!T.encodeText(b).ok);
});
test('parts: each Discord message is under 2000 characters; join gives the text back; gaps and mixed versions are caught', () => {
  const big = 'SLT1.' + 'abcdEFGH_-'.repeat(900) + '.' + '0123abcd';
  const parts = T.toParts(big); assert.ok(parts.length >= 5);
  const msgs = parts.map((p, i) => T.partMessage(i, parts.length, 12, p)); msgs.forEach((m) => assert.ok(m.length < 2000, String(m.length)));
  const back = msgs.map((m) => T.parsePart(m)); assert.strictEqual(T.joinParts(back, 12).text, big);
  assert.ok(!T.joinParts(back.slice(1), 12).ok); assert.ok(!T.joinParts(back, 13).ok);
  assert.ok(!T.joinParts([back[0], Object.assign({}, back[1], { ver: 11 })].concat(back.slice(2)), 12).ok);
  assert.strictEqual(T.parsePart('-# ScapeLite team settings · part 1/1 · v1 · do not edit or delete\n||<script>||'), null);
  assert.strictEqual(T.parsePart('hello'), null);
});
test('meta: only a well-formed pointer is accepted', () => {
  assert.ok(T.cleanMeta({ ver: 3, ids: ['123456789012345678'], sum: 'abcd0123', by: 'Member A', at: 1 }));
  [null, {}, { ver: 0, ids: ['123456789012345678'], sum: 'abcd0123' }, { ver: 1, ids: ['x'], sum: 'abcd0123' }, { ver: 1, ids: ['123456789012345678'], sum: 'zz' }].forEach((m) => assert.strictEqual(T.cleanMeta(m), null));
});
test('diff: rows for what the team says, marked same or different; addresses never shown', () => {
  const local = T.collect(src(), {}), remote = T.collect(src(), { includeUrls: true });
  remote.k.hiscoresPollMinutes = 30; remote.k.clanTag = 'XYZ';
  const rows = T.diff(local, remote);
  assert.strictEqual(rows.find((r) => r.key === 'hiscoresPollMinutes').same, false);
  assert.strictEqual(rows.find((r) => r.key === 'clanRelayEnabled').same, true);
  assert.ok(rows.some((r) => r.secret && r.key === 'relayClanWebhook'));
  assert.ok(!JSON.stringify(rows).includes('discord.com') && !JSON.stringify(rows).includes('AbCdEf'));
});
test('plan: settings go to the right store; addresses only when asked for', () => {
  const b = T.validateBundle(T.collect(src(), { includeUrls: true })).bundle;
  const p = T.plan(b, null, {});
  assert.ok(p.plugin.pingRoles && p.files.clanTag && Object.keys(p.secrets).length === 0);
  const p2 = T.plan(b, null, { urls: true }); assert.deepStrictEqual(Object.keys(p2.secrets).sort(), ['digestWebhook', 'relayClanWebhook']);
  const p3 = T.plan(b, ['clanTag', 'relayClanWebhook', 'relayRole'], {}); assert.deepStrictEqual(p3.applied, ['clanTag']);
});

test('the page accepts exactly the plugin keys of the whitelist, no secrets, and every one is a real setting', () => {
  const ui = require('fs').readFileSync(require('path').join(__dirname, '..', 'overlay', 'plugins-settings-ui.js'), 'utf8');
  const m = /const TEAM_KEYS = \[([^\]]*)\]/.exec(ui); assert.ok(m, 'TEAM_KEYS not found');
  const page = m[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
  const wl = T.KEYS.filter((k) => k.store === 'plugin').map((k) => k.key).sort();
  assert.deepStrictEqual(page, wl);
  wl.forEach((k) => assert.ok(ui.includes("{ key: '" + k + "'"), 'no setting called ' + k));
  assert.ok(!page.some((k) => /webhook/i.test(k)) && !page.includes('relayRole') && !page.includes('teamAutoSync'));
});

// ---------------------------------------------------------------- fake Discord with one lease webhook
function fakeDiscord() {
  const f = { hook: { name: 'Private Lease Channel', messages: {} }, next: 1564000000000000000n, calls: [], server: null, url: '' };
  const idPath = /^\/api\/webhooks\/(\d+)\/[^/]+(?:\/messages\/(\d+))?/;
  f.server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)); };
      const m = idPath.exec(req.url.split('?')[0]); if (!m) { reply(404, { code: 10015 }); return; }
      f.calls.push(req.method + (m[2] ? ' message' : ' hook')); const mid = m[2], data = body ? JSON.parse(body) : null, H = f.hook;
      if (!mid) {
        if (req.method === 'GET') { reply(200, { id: m[1], name: H.name }); return; }
        if (req.method === 'PATCH') { H.name = data.name; reply(200, { id: m[1], name: H.name }); return; }
        if (req.method === 'POST') { const id = String(f.next++); if ((data.content || '').length > 2000) { reply(400, { code: 50035 }); return; } H.messages[id] = { id, content: data.content }; reply(200, { id }); return; }
      } else {
        const msg = H.messages[mid]; if (!msg) { reply(404, { code: 10008 }); return; }
        if (req.method === 'GET') { reply(200, { id: mid, content: msg.content }); return; }
        if (req.method === 'PATCH') { if ((data.content || '').length > 2000) { reply(400, { code: 50035 }); return; } msg.content = data.content; reply(200, { id: mid }); return; }
        if (req.method === 'DELETE') { delete H.messages[mid]; reply(204); return; }
      }
      reply(405, {});
    });
  });
  f.parts = () => Object.values(f.hook.messages).filter((x) => /^-# ScapeLite team settings/.test(x.content));
  f.leaseMsg = () => Object.values(f.hook.messages).find((x) => /^-# ScapeLite relay lease/.test(x.content));
  return new Promise((resolve) => f.server.listen(0, '127.0.0.1', () => { f.url = 'http://127.0.0.1:' + f.server.address().port + '/api/webhooks/777777/TOKEN'; resolve(f); }));
}
const FAST = { ttlMs: 700, fenceMs: 350, heartbeatMs: 100, pollMs: 100, takeoverJitterMs: 40, verifyDelayMs: 40, discoverRetryMs: 100, claimSettleMs: 40, claimRetries: 3 };
function pc(f, name) {
  const sender = S.createSender({ timeoutMs: 1000, bucketSize: 100, bucketWindowMs: 50, backoffBaseMs: 10, backoffMaxMs: 40, cooldownMaxMs: 60, brokenProbeMs: 60000, maxWaitMs: 5000 });
  const logs = [];
  const mgr = L.createLeaseManager({ send: sender.send, label: () => name, options: FAST, log: (t) => logs.push(t), leaseUrl: f.url, version: '0.4.1' });
  const x = { name, mgr, logs, lease: () => mgr.forWebhook(), timer: setInterval(() => { mgr.tickAll().catch(() => {}); }, 30), stop() { clearInterval(x.timer); } };
  return x;
}
async function until(cond, ms, what) { const end = Date.now() + (ms || 5000); while (Date.now() < end) { if (await cond()) return; await sleep(25); } throw new Error('timed out waiting for: ' + (what || cond)); }
async function withDiscord(fn) { const f = await fakeDiscord(); try { await fn(f); } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); } }
const ready = (x) => until(() => x.lease().role() !== 'unsure', 6000, x.name + ' has a lease');

test('publish from one PC, gather on another: same text, checksum matches, parts under 2000, pointer in the lease', () => withDiscord(async (f) => {
  const a = pc(f, 'Member A'), b = pc(f, 'Member B');
  try {
    await ready(a); await ready(b);
    const bundle = T.collect(src(), { by: 'Member A', at: Date.now(), includeUrls: false });
    bundle.k.clanMembers = Array.from({ length: 300 }, () => require('crypto').randomBytes(9).toString('hex').slice(0, 17));   // enough to need more than one message
    const enc = T.encodeText(bundle); assert.ok(enc.ok);
    const r = await a.lease().teamPublish(enc.text, { urls: false });
    assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.meta.ver, 1);
    f.parts().forEach((p) => assert.ok(p.content.length < 2000));
    assert.strictEqual(f.parts().length, r.meta.ids.length);
    const st = L.decodeState(f.leaseMsg().content); assert.deepStrictEqual(st.ts.ids, r.meta.ids);
    await until(() => b.lease().teamMeta(), 4000, 'B sees the pointer without an extra request');
    const g = await b.lease().teamFetch(); assert.ok(g.ok && !g.none, JSON.stringify(g));
    assert.strictEqual(g.text, enc.text); assert.strictEqual(g.meta.sum, T.decodeText(g.text).sum);
    assert.deepStrictEqual(T.decodeText(g.text).bundle.k, T.validateBundle(bundle).bundle.k);
  } finally { a.stop(); b.stop(); }
}));
test('republish edits the same messages, raises the version and removes parts that are no longer needed', () => withDiscord(async (f) => {
  const a = pc(f, 'Member A');
  try {
    await ready(a);
    const mk = (n) => { const b = T.collect(src(), { by: 'Member A', at: Date.now() }); b.k.clanMembers = Array.from({ length: n }, () => require('crypto').randomBytes(9).toString('hex').slice(0, 17)); return T.encodeText(b); };
    const e1 = mk(200), r1 = await a.lease().teamPublish(e1.text, {});
    assert.ok(r1.ok && r1.meta.ids.length >= 2, JSON.stringify(r1.meta));
    const before = f.parts().length, posts1 = f.calls.filter((c) => c === 'POST message').length;
    const e2 = mk(200), r2 = await a.lease().teamPublish(e2.text, {});
    assert.ok(r2.ok && r2.meta.ver === 2); assert.deepStrictEqual(r2.meta.ids, r1.meta.ids);
    assert.strictEqual(f.parts().length, before); assert.strictEqual(f.calls.filter((c) => c === 'POST message').length, posts1, 'no new messages for an edit');
    const e3 = mk(3), r3 = await a.lease().teamPublish(e3.text, {});
    assert.ok(r3.ok && r3.meta.ver === 3 && r3.meta.ids.length === 1); assert.strictEqual(f.parts().length, 1, 'the extra parts are deleted');
  } finally { a.stop(); }
}));
test('the leader heartbeat keeps the pointer (an older ScapeLite rewriting the lease keeps unknown fields)', () => withDiscord(async (f) => {
  const a = pc(f, 'Member A');
  try {
    await ready(a);
    const r = await a.lease().teamPublish(T.encodeText(T.collect(src(), { by: 'Member A' })).text, {}); assert.ok(r.ok);
    await sleep(700);   // several heartbeats
    assert.deepStrictEqual(L.decodeState(f.leaseMsg().content).ts.ids, r.meta.ids);
    const old = L.decodeState(f.leaseMsg().content); old.s += 1;   // what an old client would write: the same state, unknown fields kept
    assert.ok(L.decodeState(L.encodeState(old, 'x')).ts, 'encode/decode keep it');
  } finally { a.stop(); }
}));
test('a deleted or damaged part is reported, nothing is applied from it', () => withDiscord(async (f) => {
  const a = pc(f, 'Member A'), b = pc(f, 'Member B');
  try {
    await ready(a); await ready(b);
    const r = await a.lease().teamPublish(T.encodeText(T.collect(src(), { by: 'Member A' })).text, {}); assert.ok(r.ok);
    const id = r.meta.ids[0], keep = f.hook.messages[id].content;
    f.hook.messages[id].content = keep.replace(/\|\|(.).*\|\|/, (m, c) => '||' + (c === 'A' ? 'B' : 'A') + m.slice(3));
    const g = await b.lease().teamFetch();
    assert.ok(!g.ok || !T.decodeText(g.text).ok, 'the damaged text does not pass the checksum');
    delete f.hook.messages[id];
    const g2 = await b.lease().teamFetch(); assert.ok(!g2.ok && /deleted|publish again/.test(g2.error), JSON.stringify(g2));
  } finally { a.stop(); b.stop(); }
}));
test('without a lease nothing is written and the answer says why', async () => {
  const sender = S.createSender({ timeoutMs: 500 });
  const mgr = L.createLeaseManager({ send: sender.send, label: () => 'X', leaseUrl: '', options: FAST });
  assert.strictEqual(mgr.forWebhook(), null);
});
test('publishing too much is refused before anything is sent', () => withDiscord(async (f) => {
  const a = pc(f, 'Member A');
  try { await ready(a); const calls = f.calls.length; const r = await a.lease().teamPublish('SLT1.' + 'a'.repeat(T.LIMITS.chunk * 9) + '.0123abcd', {}); assert.ok(!r.ok); assert.strictEqual(f.parts().length, 0); assert.ok(f.calls.length - calls <= 2); } finally { a.stop(); }
}));

// ---------------------------------------------------------------- the host (what the watcher does with it)
const { createTeamHost } = require('../overlay/team-sync-host');
function host(f, name, init) {
  const x = pc(f, name), data = JSON.parse(JSON.stringify(init || src()));
  const log = [], saved = { state: null };
  const h = createTeamHost({
    lease: () => x.mgr.forWebhook(), name: () => name, log: (t) => log.push(t),
    getPlugin: async () => JSON.parse(JSON.stringify(data.plugin)), applyPlugin: async (p) => { Object.assign(data.plugin, JSON.parse(JSON.stringify(p))); },
    readFiles: () => JSON.parse(JSON.stringify(data.files)), writeFiles: (p) => { Object.assign(data.files, JSON.parse(JSON.stringify(p))); },
    readSecrets: () => Object.assign({}, data.secrets), writeSecrets: (p) => { Object.assign(data.secrets, p); },
    load: () => saved.state, save: (s) => { saved.state = JSON.parse(JSON.stringify(s)); },
  });
  return Object.assign(x, { host: h, data, log, saved });
}
const blank = () => ({ plugin: { pingRoles: [], digestPostTimes: '' }, files: { clanTag: '' }, secrets: {} });   // the real settings always hold their defaults
test('host: publish on one PC, gather + apply on another, undo restores exactly', () => withDiscord(async (f) => {
  const a = host(f, 'Member A'), b = host(f, 'Member B', blank());
  try {
    await ready(a); await ready(b);
    const pv = await a.host.handle('preview', {}); assert.ok(pv.ok && pv.rows.length > 10 && pv.urls.length === 0 && pv.nextVer === 1, JSON.stringify(pv).slice(0, 200));
    assert.ok(!JSON.stringify(pv).includes('discord.com'));
    const pub = await a.host.handle('publish', {}); assert.ok(pub.ok && pub.ver === 1, JSON.stringify(pub));
    await until(() => b.lease().teamMeta(), 4000, 'pointer');
    const g = await b.host.handle('gather', {}); assert.ok(g.ok && g.by === 'Member A' && g.ver === 1 && g.changes > 10 && !g.urls, JSON.stringify(g).slice(0, 300));
    assert.ok(!JSON.stringify(g).includes('discord.com'));
    const ap = await b.host.handle('apply', { keys: ['pingRoles', 'clanTag', 'digestPostTimes'] }); assert.ok(ap.ok && ap.applied === 3);
    assert.strictEqual(b.data.files.clanTag, 'ABC'); assert.strictEqual(b.data.plugin.digestPostTimes, '14:00, 20:00'); assert.strictEqual(b.data.plugin.pingRoles.length, 2);
    assert.strictEqual(b.data.plugin.hiscoresPollMinutes, undefined, 'only the chosen keys were applied');
    assert.strictEqual(b.data.plugin.relayRole, undefined); assert.deepStrictEqual(b.data.secrets, {});
    assert.strictEqual(b.saved.state.lastVer, 1);
    const un = await b.host.handle('undo', {}); assert.ok(un.ok);
    assert.deepStrictEqual(b.data.plugin.pingRoles, []); assert.strictEqual(b.data.plugin.digestPostTimes, ''); assert.strictEqual(b.data.files.clanTag, ''); assert.strictEqual((await b.host.handle('undo', {})).ok, false);
  } finally { a.stop(); b.stop(); }
}));
test('host: webhook addresses need a confirmation to publish and to export, and an explicit choice to apply', () => withDiscord(async (f) => {
  const a = host(f, 'Member A'), b = host(f, 'Member B', blank());
  try {
    await ready(a); await ready(b);
    assert.ok(!(await a.host.handle('publish', { includeUrls: true })).ok); assert.ok(!(await a.host.handle('export', { includeUrls: true })).ok);
    const pv = await a.host.handle('preview', { includeUrls: true }); assert.deepStrictEqual(pv.urls.sort(), ['Activity digest webhook', 'Clan feed webhook']); assert.ok(!JSON.stringify(pv).includes('discord.com'));
    const pub = await a.host.handle('publish', { includeUrls: true, confirmUrls: true }); assert.ok(pub.ok && pub.urls);
    assert.ok(!f.parts().some((p) => p.content.includes('LeaseLease')));
    await until(() => b.lease().teamMeta(), 4000, 'pointer');
    const g = await b.host.handle('gather', {}); assert.ok(g.ok && g.urls); assert.ok(g.rows.some((r) => r.secret) && !JSON.stringify(g).includes('discord.com'));
    await b.host.handle('apply', { keys: null }); assert.deepStrictEqual(b.data.secrets, {}, 'Apply all does not take addresses unless asked');
    await b.host.handle('apply', { keys: null, urls: true });
    assert.strictEqual(b.data.secrets.relayClanWebhook, HOOK); assert.strictEqual(b.data.secrets.relayLeaseWebhook, undefined, 'never the lease webhook');
    assert.ok(!b.log.join(' ').includes('discord.com'), 'no address in the log');
    await b.host.handle('undo', {}); assert.strictEqual(b.data.secrets.relayClanWebhook, '');
  } finally { a.stop(); b.stop(); }
}));
test('host: export text imports on another PC; a foreign text is refused with a reason', () => withDiscord(async (f) => {
  const a = host(f, 'Member A'), b = host(f, 'Member B', blank());
  try {
    const ex = await a.host.handle('export', {}); assert.ok(ex.ok && ex.text.startsWith('SLT1.'));
    const im = await b.host.handle('import', { text: ex.text }); assert.ok(im.ok && im.source === 'import' && im.changes > 10, JSON.stringify(im).slice(0, 200));
    const ap = await b.host.handle('apply', { keys: ['hiscoresPollMinutes', 'raidSummaryMinMembers'] }); assert.ok(ap.ok); assert.strictEqual(b.data.plugin.raidSummaryMinMembers, 2);
    assert.strictEqual(b.saved.state.lastVer, 0, 'an import does not move the team version');
    const bad = await b.host.handle('import', { text: 'hello' }); assert.ok(!bad.ok && /SLT1/.test(bad.error));
  } finally { a.stop(); b.stop(); }
}));
test('host: automatic sync applies a newer version once, never addresses, and only when it is switched on', () => withDiscord(async (f) => {
  const a = host(f, 'Member A'), b = host(f, 'Member B', blank());
  try {
    await ready(a); await ready(b);
    await a.host.handle('publish', { includeUrls: true, confirmUrls: true });
    await until(() => b.lease().teamMeta(), 4000, 'pointer');
    assert.strictEqual(await b.host.tick(false), null, 'off: nothing happens');
    const r = await b.host.tick(true); assert.ok(r && r.ok, JSON.stringify(r));
    assert.strictEqual(b.data.files.clanTag, 'ABC'); assert.deepStrictEqual(b.data.secrets, {}); assert.ok(b.log.some((l) => /applied automatically/.test(l)));
    assert.strictEqual(await b.host.tick(true), null, 'the same version is not applied twice');
    assert.strictEqual(a.host.state().lastVer, 1, 'the publisher does not re-apply its own version');
    assert.strictEqual(await a.host.tick(true), null);
  } finally { a.stop(); b.stop(); }
}));
test('host: no lease webhook means a clear message and nothing is sent', async () => {
  const sender = S.createSender({ timeoutMs: 500 });
  const mgr = L.createLeaseManager({ send: sender.send, label: () => 'X', leaseUrl: '', options: FAST });
  const h = createTeamHost({ lease: () => mgr.forWebhook(), name: () => 'X', getPlugin: async () => ({}), applyPlugin: async () => {}, readFiles: () => ({}), writeFiles: () => {}, readSecrets: () => ({}), writeSecrets: () => {} });
  const r = await h.handle('publish', {}); assert.ok(!r.ok && /lease webhook/.test(r.error));
  assert.ok(!(await h.handle('gather', {})).ok); assert.ok(!(await h.handle('apply', {})).ok); assert.ok(!(await h.handle('nonsense', {})).ok);
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); } catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
