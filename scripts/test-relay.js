// npm run test:relay -- the chat relay: typed events (overlay/relay-events.js), the delivery engine (overlay/relay-core.js), the duplicate-instance lease on the optional
// private lease webhook (overlay/relay-lease.js), version signalling and the clean-up of the first (visible) lease version (overlay/relay-legacy-cleanup.js).
// Everything talks to a FAKE Discord on 127.0.0.1; five simulated instances run the REAL code (sender + lease + relay core).
// Names in the fixtures are pseudonyms: Wulf = the player running ScapeLite (personal "game" feed), Member A..D = clan members.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const E = require('../overlay/relay-events');
const C = require('../overlay/relay-core');
const L = require('../overlay/relay-lease');
const LC = require('../overlay/relay-legacy-cleanup');
const S = require('../overlay/discord-sender');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raw = (kind, player, text, extra) => Object.assign({ channel: 'clan', kind, player, text, self: player === 'Wulf' }, extra || {});
const N = (kind, player, text) => E.normalise(raw(kind, player, text));

// ============================================================================================================================
// 1. typed events
// ============================================================================================================================
test('Luck XP is stripped from every line and never appears in any formatted output', () => {
  const e = N('collection', 'Wulf', 'New Collection! Received [T2] Enchanted Chisel as a Dire Treant drop. +646 Luck XP');
  assert.strictEqual(e.item, '[T2] Enchanted Chisel');
  assert.ok(!/luck xp/i.test(JSON.stringify(e.rawKeys.length ? E.formatEvent(e) : '')));
  assert.strictEqual(E.stripLuckXp('hello +1,234 Luck XP.'), 'hello');
  const lines = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'relay-corpus.json'), 'utf8')).lines;
  lines.forEach((l) => { const t = E.normalise(raw(l.kind, l.player, l.text)); if (t) assert.ok(!/luck xp/i.test(E.formatEvent(t).text), l.text); });
  // the SKILL called Luck is not Luck XP: its level-ups stay
  const lv = N('levelUp', 'Member A', 'Level up! Luck level is now 63');
  assert.strictEqual(lv.type, 'levelUp'); assert.strictEqual(lv.skill, 'Luck'); assert.strictEqual(lv.level, 63);
  assert.ok(/Luck level is now \*\*63\*\*/.test(E.formatEvent(lv).text));
});

test('the same drop is the same event for the player and for everybody else (own wording vs other members\' wording)', () => {
  const own = N('rareDrop', 'Member A', 'Dire Lich dropped [T1] Faulty Crystal!');
  const other = N('rareDrop', 'Member A', 'received a rare drop: [T1] Faulty Crystal from Dire Lich!');
  ['type', 'item', 'itemKey', 'source', 'sourceKind', 'qty'].forEach((k) => assert.deepStrictEqual(own[k], other[k], k));
  assert.strictEqual(E.eventKey(own), E.eventKey(other));
  assert.strictEqual(E.formatEvent(own).text, E.formatEvent(other).text);
  assert.strictEqual(own.type, 'drop');
});

test('Fortress loot: an unlock item is an Unlock for everybody (own "The Fortress dropped" line and the others\' "rare raid drop" line)', () => {
  const own = N('rareDrop', 'Wulf', 'The Fortress dropped [T1] Bounty Beacon!');
  const other = N('rareDrop', 'Member A', 'received a rare raid drop: [T1] Bounty Beacon from Fortress!');
  const ownTrader = N('rareDrop', 'Wulf', 'The Fortress dropped [T2] Trader\'s Notes!');
  [own, other, ownTrader].forEach((e) => { assert.strictEqual(e.type, 'unlock', e.raw); assert.strictEqual(e.sourceKind, 'fortress'); assert.strictEqual(E.digestBucket(e), 'unlocks'); });
  const buf = { sinceAt: 0, players: {}, seenKeys: [] };
  [own, other, ownTrader].forEach((e) => E.digestAdd(buf, e));
  assert.deepStrictEqual(buf.players.Wulf.unlocks, ['[T1] Bounty Beacon', '[T2] Trader\'s Notes']);
  assert.deepStrictEqual(buf.players.Wulf.rareDrops, []);
  assert.deepStrictEqual(buf.players['Member A'].unlocks, ['[T1] Bounty Beacon']);
  assert.deepStrictEqual(buf.players['Member A'].rareDrops, []);
  // a normal drop stays a drop for both
  const d1 = N('rareDrop', 'Wulf', 'Dire Lich dropped [T3] Bright Ward!'), d2 = N('rareDrop', 'Member A', 'received a rare drop: [T3] Bright Ward from Dire Lich!');
  assert.strictEqual(d1.type, 'drop'); assert.strictEqual(d2.type, 'drop');
});

test('unlock lines: "unlocked:", "received the [Lucky] X!" and "received the Lucky X!" are the same item', () => {
  const a = N('unlock', 'Member C', 'unlocked: [Shiny Lucky] Culling Knife');
  const b = N('unlock', 'Member C', 'received the Shiny Lucky Culling Knife!');
  const c = N('unlock', 'Wulf', 'received the [Shiny Lucky] Culling Knife!');
  assert.strictEqual(a.itemKey, b.itemKey); assert.strictEqual(a.itemKey, c.itemKey);
  assert.strictEqual(b.item, '[Shiny Lucky] Culling Knife');
  [a, b, c].forEach((e) => assert.strictEqual(e.type, 'unlock'));
  const pipe = E.createPipeline();
  const out = pipe.process([raw('unlock', 'Member C', 'unlocked: [Shiny Lucky] Culling Knife'), raw('unlock', 'Member C', 'received the Shiny Lucky Culling Knife!')]);
  assert.strictEqual(out.length, 1);
});

test('one drop = up to three lines = ONE event (pipeline), in any order, own or other', () => {
  const trio = (order) => order.map((i) => [
    raw('unlock', 'Member C', 'unlocked: [T3] Enchanted Trowel'),
    raw('rareDrop', 'Member C', 'received a rare drop: [T3] Enchanted Trowel from Savage Mushroom!'),
    raw('collection', 'Member C', 'New Collection! Received [T3] Enchanted Trowel as a Savage Mushroom drop.'),
  ][i]);
  [[0, 1, 2], [2, 1, 0], [1, 2, 0]].forEach((o) => {
    const out = E.createPipeline().process(trio(o));
    assert.strictEqual(out.length, 1, 'order ' + o);
    const e = out[0];
    assert.strictEqual(e.type, 'unlock'); assert.strictEqual(e.source, 'Savage Mushroom'); assert.strictEqual(e.newCollection, true); assert.strictEqual(e.rawKeys.length, 3);
    assert.deepStrictEqual(E.formatEvent(e).roleKeys.sort(), ['rareDrop', 'unlock']);
  });
  // own drop (collection with Luck XP first, then the dropped line)
  const own = E.createPipeline().process([raw('collection', 'Wulf', 'New Collection! Received [T4] Fur Crossbow as a Savage Mushroom drop. +743 Luck XP'), raw('rareDrop', 'Wulf', 'Savage Mushroom dropped [T4] Fur Crossbow!')]);
  assert.strictEqual(own.length, 1); assert.strictEqual(own[0].type, 'drop'); assert.strictEqual(own[0].newCollection, true);
  assert.strictEqual(E.formatEvent(own[0]).text, 'received **[T4] Fur Crossbow** from Savage Mushroom · new collection entry');
});

test('a skilling collection entry stays a collection (live post only, never in the digest); a trailing line of an already posted drop is suppressed', () => {
  const pipe = E.createPipeline();
  const c = pipe.process([raw('collection', 'Member B', 'New Collection! Received [T4] Fur Arrow from Craft.')]);
  assert.strictEqual(c[0].type, 'collection'); assert.strictEqual(E.digestBucket(c[0]), null);
  assert.strictEqual(E.formatEvent(c[0]).text, 'logged **[T4] Fur Arrow** (Craft)');
  const first = pipe.process([raw('rareDrop', 'Member B', 'received a rare drop: [T4] Mithril Ore from Dire Golem!')]);
  const later = pipe.process([raw('collection', 'Member B', 'New Collection! Received [T4] Mithril Ore as a Dire Golem drop.')]);
  assert.strictEqual(first.length, 1); assert.strictEqual(later.length, 0);
});

test('self and others word sources differently; the typed source is the same', () => {
  const own = N('collection', 'Wulf', 'New Collection! Received [T1] The Reducer as a T1 Chest Drops drop. +767 Luck XP');
  const other = N('collection', 'Member A', 'New Collection! Received [T1] The Reducer from a treasure chest.');
  assert.strictEqual(own.source, other.source); assert.strictEqual(own.sourceKind, 'chest'); assert.strictEqual(own.type, 'collection'); assert.strictEqual(other.type, 'collection');
  const p1 = N('collection', 'Wulf', 'New Collection! Received [T1] Thief\'s Gauntlets as a Plunder Drops drop. +701 Luck XP'), p2 = N('collection', 'Member B', 'New Collection! Received [T1] Thief\'s Gauntlets from plundering.');
  assert.strictEqual(p1.source, p2.source);
});

test('quests, pets and level-ups: the same typed event for own and other wording', () => {
  const q1 = N('questComplete', 'Wulf', 'Quest complete: Sandscale Valley Drill'), q2 = N('questComplete', 'Member A', 'completed the quest: Sandscale Valley Drill!');
  assert.strictEqual(q1.type, 'quest'); assert.strictEqual(q1.item, q2.item);
  assert.strictEqual(E.formatEvent(q1).text, E.formatEvent(q2).text);
  const p1 = N('petDrop', 'Wulf', 'Fortify pet is now following you!'), p2 = N('petDrop', 'Member A', 'received the Fortify pet!');
  assert.strictEqual(p1.pet, 'Fortify'); assert.strictEqual(p2.pet, 'Fortify');
  assert.strictEqual(E.formatEvent(p1).text, E.formatEvent(p2).text);
  const col = N('collection', 'Wulf', 'New Collection! Unlocked the Fortify Pet. +686 Luck XP');
  assert.strictEqual(col.type, 'pet'); assert.strictEqual(col.itemKey, p1.itemKey);
  assert.strictEqual(E.createPipeline().process([raw('collection', 'Wulf', 'New Collection! Unlocked the Fortify Pet. +686 Luck XP'), raw('petDrop', 'Wulf', 'Fortify pet is now following you!')]).length, 1);
  const sp = N('shinyPetDrop', 'Member B', 'received the SHINY Farm pet!');
  assert.strictEqual(sp.pet, 'Farm'); assert.strictEqual(sp.shiny, true); assert.strictEqual(E.formatEvent(sp).emoji, '✨');
  const l1 = N('levelUp', 'Wulf', 'Level up! Vigor level is now 52.'), l2 = N('levelUp', 'Member A', 'Level up! Vigor level is now 52');
  assert.strictEqual(E.eventKey(Object.assign({}, l1, { player: 'x' })), E.eventKey(Object.assign({}, l2, { player: 'x' })));
});

test('own-only wordings are understood: Chaos Dungeon reward, "turned up", quantity', () => {
  const a = N('rareDrop', 'Wulf', 'Chaos Dungeon reward: [Chaos] [T2] Dire Dungeon Glyph!');
  assert.strictEqual(a.type, 'unlock'); assert.strictEqual(a.item, '[Chaos] [T2] Dire Dungeon Glyph'); assert.strictEqual(a.sourceKind, 'dungeon');
  const b = N('rareDrop', 'Wulf', 'Invoke Stall turned up [T1] Farmer\'s Almanac!');
  assert.strictEqual(b.type, 'unlock'); assert.strictEqual(b.sourceKind, 'skill');
  const c = N('rareDrop', 'Wulf', 'The Fortress reward: 15x [T1] Linen Thread!');
  assert.strictEqual(c.qty, 15); assert.strictEqual(c.item, '[T1] Linen Thread');
  const d = N('collection', 'Member A', 'New Collection! Claimed 2x [T4] Treasure Chest from the Alms Path.');
  assert.strictEqual(d.qty, 2); assert.strictEqual(d.sourceKind, 'alms');
});

test('items.json decides: every unlock item is an Unlock, quest-reward charms are not announced unlocks', () => {
  assert.ok(E.isUnlockItem('[T2] Enchanted Chisel')); assert.ok(E.isUnlockItem('[T3] Fortress Banner')); assert.ok(E.isUnlockItem('[T2] Satchel'));
  assert.ok(!E.isUnlockItem('[T3] Bright Ward')); assert.ok(!E.isUnlockItem('[T1] Faulty Crystal'));
  assert.ok(!E.isUnlockItem('Barter\'s Penny'));
  assert.strictEqual(N('collection', 'Member A', 'New Collection! Received Barter\'s Penny from Riverwatch Market Audit.').type, 'collection');
  // a collection of an unlock item that has no other line (own task-completion relic) is still an unlock
  assert.strictEqual(N('collection', 'Wulf', 'New Collection! Received [T3] Telescope from a task completion. +700 Luck XP').type, 'unlock');
});

test('regression corpus: real lines from the logs (anonymised) produce the reviewed typed events', () => {
  const lines = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'relay-corpus.json'), 'utf8')).lines;
  assert.ok(lines.length > 80);
  lines.forEach((l) => {
    const e = E.normalise(raw(l.kind, l.player, l.text));
    if (!l.expect) { assert.strictEqual(e, null, l.text); return; }
    assert.ok(e, l.text);
    Object.keys(l.expect).forEach((k) => assert.deepStrictEqual(e[k], l.expect[k], k + ' of: ' + l.text));
  });
});

test('every drop/unlock/collection line in the corpus lands in the bucket its ITEM says, whoever it came from', () => {
  const lines = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'relay-corpus.json'), 'utf8')).lines;
  lines.forEach((l) => {
    const e = E.normalise(raw(l.kind, l.player, l.text));
    if (!e || !e.item) return;
    if (E.isUnlockItem(e.item)) assert.strictEqual(E.digestBucket(e), 'unlocks', l.text);
    else assert.notStrictEqual(E.digestBucket(e), 'unlocks', l.text);
  });
});

test('digest: repeated drops are counted, unlocks and quests are not listed twice, levels keep the highest', () => {
  const buf = { sinceAt: 0, players: {}, seenKeys: [] };
  const add = (k, p, t) => E.createPipeline().process([raw(k, p, t)]).forEach((e) => E.digestAdd(buf, e));
  add('rareDrop', 'Member A', 'received a rare drop: [T1] Faulty Crystal from Dire Lich!');
  add('rareDrop', 'Member A', 'received a rare drop: [T1] Faulty Crystal from Dire Lich!');
  add('unlock', 'Member A', 'unlocked: [T3] Enchanted Trowel'); add('unlock', 'Member A', 'unlocked: [T3] Enchanted Trowel');
  add('levelUp', 'Member A', 'Level up! Mine level is now 40'); add('levelUp', 'Member A', 'Level up! Mine level is now 41');
  add('levelUp', 'Member A', 'Level up! Mine level is now 39');
  add('collection', 'Member A', 'New Collection! Received [T4] Fur Arrow from Craft.');
  const p = buf.players['Member A'];
  assert.deepStrictEqual(E.collapseEntries(p.rareDrops), ['[T1] Faulty Crystal ×2']);
  assert.deepStrictEqual(p.unlocks, ['[T3] Enchanted Trowel']);
  assert.strictEqual(p.levels.Mine, 41);
});

test('old digest-state.json: entries are re-bucketed by item, Luck XP and wording leftovers removed, duplicates collapsed', () => {
  const old = { sinceAt: 5, seenKeys: ['x'], players: {
    Wulf: { rareDrops: ['[T1] Bounty Beacon', '[T2] Trader\'s Notes', 'Chaos Dungeon reward: [T1] Steady Aim', '[T3] Bright Ward', '[T3] Bright Ward'], unlocks: ['[Lucky] Enchanted Rod'], pets: ['Fortify pet is now following you'], quests: [], levels: { Mine: 3 } },
    'Member A': { rareDrops: [], unlocks: ['[T3] Corruptor\'s Idol', 'Shiny Lucky Culling Knife', '[Shiny Lucky] Culling Knife'], pets: ['✨ Farm pet', 'Luck pet'], quests: ['Caravan Defense'], levels: {} } } };
  E.migrateDigestBuffer(old);
  assert.deepStrictEqual(old.players.Wulf.unlocks, ['[Lucky] Enchanted Rod', '[T1] Bounty Beacon', '[T2] Trader\'s Notes']);
  assert.deepStrictEqual(old.players.Wulf.rareDrops, ['[T1] Steady Aim', '[T3] Bright Ward', '[T3] Bright Ward']);
  assert.deepStrictEqual(old.players.Wulf.pets, ['Fortify pet']);
  assert.deepStrictEqual(old.players['Member A'].unlocks, ['[T3] Corruptor\'s Idol', '[Shiny Lucky] Culling Knife']);
  assert.deepStrictEqual(old.players['Member A'].pets, ['✨ Farm pet', 'Luck pet']);
  assert.strictEqual(old.players.Wulf.levels.Mine, 3); assert.deepStrictEqual(old.seenKeys, ['x']);
});

test('ultra rare keywords work for every item event the same way; role pings follow the event categories', () => {
  const u = N('unlock', 'Wulf', 'received the [Shiny Lucky] Enchanted Trowel!');
  const f = E.formatEvent(u, { ultraRareKeywords: ['shiny'] });
  assert.ok(f.ultra); assert.ok(f.text.startsWith('**ULTRA RARE** unlocked')); assert.deepStrictEqual(f.roleKeys, ['shinyRareDrop']);
  const cfg = { pingRoles: [{ roleId: '111111', categories: ['rareDrop'] }, { roleId: '222222', categories: ['unlock'] }, { roleId: '333333', categories: ['levelUp'] }] };
  const trio = E.createPipeline().process([raw('unlock', 'Member C', 'unlocked: [T3] Enchanted Trowel'), raw('rareDrop', 'Member C', 'received a rare drop: [T3] Enchanted Trowel from Savage Mushroom!')])[0];
  const pay = C.buildPayload(trio, cfg);
  assert.ok(pay.content.includes('<@&111111>') && pay.content.includes('<@&222222>') && !pay.content.includes('333333'));
  assert.deepStrictEqual(pay.allowed_mentions.roles.sort(), ['111111', '222222']);
  assert.strictEqual(pay.username, 'Member C');
});

// ============================================================================================================================
// 2. fake Discord + simulated instances
// ============================================================================================================================
// Two webhooks: the POSTING one (the clan's relay channel, id 123456, f.url) and the LEASE one (a private channel, id 777777, f.leaseUrl).
// f.messages / f.name are the posting webhook's; f.leaseHook.messages / .name the lease webhook's. Requests are counted per webhook and method.
function fakeDiscord() {
  const hook = (name) => ({ name, messages: {} });
  const f = { hooks: { 123456: hook('Clan Relay'), 777777: hook('Private Lease Channel') }, nextId: 1564000000000000000n, log: [], failGet: false, down: false, failGetMessage: false, server: null, url: '', leaseUrl: '', hits: 0, delayMs: 0, calls: [] };
  Object.defineProperty(f, 'messages', { get: () => f.hooks[123456].messages });
  Object.defineProperty(f, 'name', { get: () => f.hooks[123456].name, set: (v) => { f.hooks[123456].name = v; } });
  f.leaseHook = f.hooks[777777];
  const idPath = /^\/api\/webhooks\/(\d+)\/[^/]+(?:\/messages\/(\d+))?/;
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      f.hits++;
      if (f.delayMs) await sleep(f.delayMs);
      const reply = (code, obj, h) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, h || {})); res.end(obj == null ? '' : JSON.stringify(obj)); };
      const m = idPath.exec(req.url.split('?')[0]);
      if (!m || !f.hooks[m[1]]) { reply(404, { code: 10015, message: 'Unknown Webhook' }); return; }
      const H = f.hooks[m[1]];
      f.calls.push(req.method + ' ' + m[1] + (m[2] ? ' message' : ''));
      if (f.down) { reply(500, { message: 'down' }); return; }
      const mid = m[2], data = body ? JSON.parse(body) : null;
      if (!mid) {
        if (req.method === 'GET') { if (f.failGet) { reply(500, {}); return; } reply(200, { id: m[1], name: H.name, channel_id: '9', type: 1 }); return; }
        if (req.method === 'PATCH') { H.name = data.name; reply(200, { id: m[1], name: H.name }); return; }
        if (req.method === 'POST') {
          const id = String(f.nextId++); H.messages[id] = { id, content: data.content, username: data.username, at: Date.now(), edits: 0 };
          reply(200, { id }); return;
        }
      } else {
        const msg = H.messages[mid];
        if (!msg) { reply(404, { code: 10008, message: 'Unknown Message' }); return; }
        if (req.method === 'GET') { if (f.failGet || f.failGetMessage) { reply(500, {}); return; } reply(200, { id: mid, content: msg.content }); return; }
        if (req.method === 'PATCH') { msg.content = data.content != null ? data.content : msg.content; msg.edits++; reply(200, { id: mid, content: msg.content }); return; }
        if (req.method === 'DELETE') { delete H.messages[mid]; reply(204); return; }
      }
      reply(405, {});
    });
  });
  f.posts = () => Object.values(f.hooks[123456].messages);                       // everything in the clan's channel
  f.leases = () => Object.values(f.leaseHook.messages).filter((x) => /^-# ScapeLite relay lease/.test(x.content || ''));
  f.state = () => { const l = f.leases()[0]; return l ? L.decodeState(l.content) : null; };
  return new Promise((resolve) => f.server.listen(0, '127.0.0.1', () => { const base = 'http://127.0.0.1:' + f.server.address().port + '/api/webhooks/'; f.url = base + '123456/TESTTOKEN'; f.leaseUrl = base + '777777/LEASETOKEN'; resolve(f); }));
}
async function withDiscord(fn) { const f = await fakeDiscord(); try { await fn(f); } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); } }

const FAST = { ttlMs: 700, fenceMs: 350, heartbeatMs: 100, pollMs: 100, takeoverJitterMs: 40, verifyDelayMs: 40, discoverRetryMs: 100, claimSettleMs: 40, claimRetries: 3, preemptRetryMs: 200 };

function makeInstance(f, name, o) {
  const opts = Object.assign({ mode: 'auto', id: L.newInstanceId() }, o || {});
  const sender = S.createSender({ timeoutMs: 1000, bucketSize: 100, bucketWindowMs: 50, backoffBaseMs: 10, backoffMaxMs: 40, cooldownMaxMs: 60, brokenProbeMs: 60000, maxWaitMs: 5000 });
  const logs = [];
  const mgr = L.createLeaseManager({ send: sender.send, label: () => name, instanceId: opts.id, options: FAST, log: (t) => logs.push(t), prefer: () => !!opts.prefer, messageId: opts.messageId, leaseUrl: opts.lease === false ? '' : f.leaseUrl, version: opts.version });
  let store = { keys: [], outbox: [] };
  const relay = C.createRelay({
    send: sender.send, isBroken: sender.isBroken, log: (...a) => logs.push(a.join(' ')),
    gate: C.leaseGate(mgr, () => inst.mode),
    ownOnly: () => inst.mode === 'own',
    noteRelayed: (url, k) => { const l = mgr.forWebhook(url); if (l) l.noteRelayed(k); },
    alreadyRelayedByOthers: (url, k) => { const l = mgr.forWebhook(url); return !!(l && l.alreadyRelayed(k)); },
    store: { loadKeys: () => store.keys, saveKeys: (a) => { store.keys = a; }, loadOutbox: () => store.outbox, saveOutbox: (a) => { store.outbox = JSON.parse(JSON.stringify(a)); } },
    options: { spacingMs: 0, standbyMs: 2500, unsureHoldMs: 6000 },
  });
  const cfg = { channels: { clan: { enabled: true, relayPlainChat: true, webhookUrl: f.url } } };
  const inst = { name, id: opts.id, mode: opts.mode, mgr, relay, sender, logs, cfg, stopped: false, timer: null, store: () => store,
    feed(rawEvents) { relay.enqueue(relay.typed(rawEvents)); },
    start() { inst.stopped = false; if (inst.mode === 'auto') mgr.forWebhook(f.url); inst.timer = setInterval(() => { if (inst.stopped) return; if (inst.mode === 'auto') mgr.tickAll(); relay.process(cfg).catch(() => {}); }, 30); },
    crash() { inst.stopped = true; clearInterval(inst.timer); },                 // process killed: no release
    async stop() { inst.stopped = true; clearInterval(inst.timer); await mgr.releaseAll(); },
    role: () => { const l = mgr.forWebhook(f.url); return l ? l.role() : 'none'; },
    leader: () => inst.role() === 'leader' && mgr.forWebhook(f.url).canRelay() };
  inst.restartWith = (newId) => makeInstance(f, name, Object.assign({}, opts, { id: newId || opts.id }));
  return inst;
}
async function until(cond, ms, what) { const end = Date.now() + (ms || 5000); while (Date.now() < end) { if (await cond()) return; await sleep(25); } throw new Error('timed out waiting for: ' + (what || cond)); }
const leaders = (insts) => insts.filter((i) => i.leader());
// what each of the 5 PCs sees of one logical event: the owner sees its own wording on the personal feed, the others the clan wording
function feedAll(insts, who, kind, ownText, otherText) {
  insts.forEach((i) => i.feed([i.name === who ? raw(kind, who, ownText, { self: true }) : raw(kind, who, otherText, { self: false })]));
}
const contentsOf = (f) => f.posts().map((p) => p.content);

test('simultaneous start of 5 instances: exactly one lease message, one pointer, exactly one leader', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C', 'Member D'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1 && insts.every((i) => i.role() !== 'unsure'), 6000, 'a single leader');
  await sleep(400);
  assert.strictEqual(leaders(insts).length, 1);
  assert.strictEqual(f.leases().length, 1, 'one lease message (the race losers delete theirs)');
  assert.ok(/\[sl:\d+\]$/.test(f.leaseHook.name) && f.leaseHook.name.startsWith('Private Lease Channel'), f.leaseHook.name);
  assert.strictEqual(f.name, 'Clan Relay', 'the clan\'s relay webhook is never renamed');
  assert.strictEqual(f.posts().length, 0, 'nothing at all is written to the clan\'s channel');
  assert.ok(f.calls.every((c) => / 777777/.test(c)), 'every request went to the lease webhook: ' + f.calls.filter((c) => !/ 777777/.test(c)).join(', '));
  assert.strictEqual(insts.filter((i) => i.role() === 'follower').length, 4);
  const st = f.state(); assert.ok(st.id && st.s > 0);
  insts.forEach((i) => i.crash());
}));

test('5 instances, one clan: every shared event is posted exactly once, whoever it is about (own wording on the owner\'s PC)', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C', 'Member D'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  feedAll(insts, 'Member A', 'rareDrop', 'Dire Lich dropped [T1] Faulty Crystal!', 'received a rare drop: [T1] Faulty Crystal from Dire Lich!');
  feedAll(insts, 'Wulf', 'rareDrop', 'The Fortress dropped [T1] Bounty Beacon!', 'received a rare raid drop: [T1] Bounty Beacon from Fortress!');
  feedAll(insts, 'Member B', 'levelUp', 'Level up! Mine level is now 41.', 'Level up! Mine level is now 41');
  feedAll(insts, 'Member C', 'questComplete', 'Quest complete: Caravan Defense', 'completed the quest: Caravan Defense!');
  insts.forEach((i) => i.feed([raw('chat', 'Member D', 'gz all', { self: i.name === 'Member D' })]));
  await until(() => f.posts().length >= 5, 6000, '5 posts');
  await sleep(600);
  const c = contentsOf(f);
  assert.strictEqual(c.length, 5, JSON.stringify(c));
  assert.ok(c.some((x) => /Faulty Crystal/.test(x))); assert.ok(c.some((x) => /Bounty Beacon/.test(x) && /unlocked/.test(x))); assert.ok(c.some((x) => /Mine level is now \*\*41\*\*/.test(x)));
  assert.ok(c.some((x) => /completed quest \*\*Caravan Defense\*\*/.test(x))); assert.ok(c.some((x) => x === 'gz all'));
  insts.forEach((i) => i.crash());
}));

test('leader crashes (no release): a follower takes over after the TTL, nothing is posted twice, nothing after the takeover is lost', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C', 'Member D'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  feedAll(insts, 'Member A', 'rareDrop', 'Dire Lich dropped [T4] Cured Fur!', 'received a rare drop: [T4] Cured Fur from Dire Lich!');
  await until(() => f.posts().length === 1, 4000);
  await sleep(300);                                            // a heartbeat lists the relayed key
  const old = leaders(insts)[0]; old.crash();
  const alive = insts.filter((i) => i !== old);
  // events during the outage: every surviving PC sees them, nobody may post yet (still follower / unsure)
  feedAll(alive, 'Member B', 'rareDrop', 'Dire Orc dropped [T3] Aluminum Belt!', 'received a rare drop: [T3] Aluminum Belt from Dire Orc!');
  feedAll(alive, 'Member A', 'rareDrop', 'Dire Lich dropped [T4] Cured Fur!', 'received a rare drop: [T4] Cured Fur from Dire Lich!');   // the one the dead leader already posted
  await until(() => leaders(alive).length === 1, 6000, 'a new leader');
  await until(() => f.posts().some((p) => /Aluminum Belt/.test(p.content)), 4000, 'standby replay');
  feedAll(alive, 'Member C', 'levelUp', 'Level up! Fish level is now 50.', 'Level up! Fish level is now 50');
  await until(() => f.posts().some((p) => /Fish level/.test(p.content)), 4000);
  await sleep(500);
  const c = contentsOf(f);
  assert.strictEqual(c.filter((x) => /Cured Fur/.test(x)).length, 1, 'the old leader\'s post is not repeated: ' + JSON.stringify(c));
  assert.strictEqual(c.filter((x) => /Aluminum Belt/.test(x)).length, 1);
  assert.strictEqual(c.filter((x) => /Fish level/.test(x)).length, 1);
  assert.strictEqual(f.leases().length, 1);
  assert.ok(f.state().e >= 2, 'epoch moved on');
  insts.forEach((i) => i.crash());
}));

test('graceful stop releases the lease at once: the takeover does not wait for the TTL', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  const old = leaders(insts)[0]; const t0 = Date.now();
  await old.stop();
  const alive = insts.filter((i) => i !== old);
  await until(() => leaders(alive).length === 1, 3000, 'fast takeover');
  assert.ok(Date.now() - t0 < FAST.ttlMs, 'faster than the TTL (' + (Date.now() - t0) + ' ms)');
  alive.forEach((i) => i.crash());
}));

test('restart of the leader PC (same instance id): it resumes the lease, no extra epoch, no duplicate posts', () => withDiscord(async (f) => {
  const a = makeInstance(f, 'Wulf'), b = makeInstance(f, 'Member A');
  a.start(); await until(() => a.leader(), 5000); b.start(); await until(() => b.role() === 'follower', 5000);
  const epoch = f.state().e;
  a.feed([raw('levelUp', 'Member B', 'Level up! Cook level is now 20')]); b.feed([raw('levelUp', 'Member B', 'Level up! Cook level is now 20')]);
  await until(() => f.posts().length === 1, 4000);
  a.crash();
  const a2 = a.restartWith(); a2.start();
  await until(() => a2.leader() || b.leader(), 6000, 'a leader after the restart');
  await sleep(300);
  assert.strictEqual(leaders([a2, b]).length, 1);
  if (a2.leader()) assert.strictEqual(f.state().e, epoch, 'resumed without a takeover');
  assert.strictEqual(f.posts().length, 1);
  a2.crash(); b.crash();
}));

test('a failing GET: everybody fences/waits, nothing is posted during the outage, everything is posted exactly once afterwards', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  f.failGet = true;
  await sleep(FAST.fenceMs + 150);
  assert.strictEqual(leaders(insts).length, 0, 'the leader fenced itself');
  insts.forEach((i) => i.feed([raw('levelUp', 'Member D', 'Level up! Delve level is now 35')]));
  await sleep(500);
  assert.strictEqual(f.posts().length, 0, 'nothing posted while the lease cannot be confirmed');
  f.failGet = false;
  await until(() => f.posts().length === 1, 8000, 'the held event is posted');
  await sleep(600);
  assert.strictEqual(f.posts().length, 1);
  insts.forEach((i) => i.crash());
}));

test('Discord down for longer than the TTL: no instance posts or takes over blindly; after it returns there is one leader and no duplicates', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1 && insts.every((i) => i.role() !== 'unsure'), 6000);
  await sleep(300);
  f.down = true;
  await sleep(FAST.ttlMs + 400);
  insts.forEach((i) => i.feed([raw('rareDrop', 'Member A', 'received a rare drop: [T3] Lobster from Dire Zombie!')]));
  await sleep(300);
  f.down = false;
  await until(() => leaders(insts).length === 1, 8000, 'one leader again');
  await until(() => f.posts().length >= 1, 8000, 'post');
  await sleep(1200);
  assert.strictEqual(f.posts().length, 1, JSON.stringify(contentsOf(f)));
  assert.strictEqual(f.leases().length, 1);
  insts.forEach((i) => i.crash());
}));

test('simultaneous start with network latency (the creation race is wider): still one lease message, one pointer, one leader', () => withDiscord(async (f) => {
  f.delayMs = 60;
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C', 'Member D'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1 && insts.every((i) => i.role() !== 'unsure') && f.leases().length === 1, 12000, 'convergence');
  await sleep(800);
  assert.strictEqual(leaders(insts).length, 1); assert.strictEqual(f.leases().length, 1);
  assert.ok(f.leaseHook.name.endsWith('[sl:' + f.leases()[0].id + ']'));
  insts.forEach((i) => i.crash());
}));

test('two instances holding different lease messages (a creation race): the webhook name decides, the other one switches', () => withDiscord(async (f) => {
  const put = (id, leader) => { f.leaseHook.messages[id] = { id, content: L.encodeState({ v: 1, id: leader, n: 'X', e: 1, s: 5, t: 0, lk: [], dg: 0, cl: {} }, 'X'), username: 'ScapeLite relay lease', at: Date.now(), edits: 0 }; };
  put('111111111111111111', 'aaaaaaaa'); put('222222222222222222', 'bbbbbbbb');
  f.leaseHook.name = 'Private Lease Channel [sl:222222222222222222]';
  const a = makeInstance(f, 'Wulf', { id: 'aaaaaaaa', messageId: '111111111111111111' }); a.start();
  await until(() => a.role() === 'follower', 6000, 'a follower of the pointed message');
  assert.strictEqual(a.leader(), false);
  assert.strictEqual(a.mgr.forWebhook(f.url)._S.messageId, '222222222222222222');
  assert.strictEqual(a.mgr.forWebhook(f.url).info().leader, 'X');
  a.crash();
}));

test('the lease message says when it was last written, and a change of leader is logged', () => {
  const head = L.encodeState({ v: 1, id: 'aabbccdd', n: 'Sandis', e: 2, s: 0, t: 1793104926944, lk: [], dg: 0, cl: {} }).split('\n')[0];
  assert.ok(/leader Sandis · last written <t:1793104926:f> \(<t:1793104926:R>\)/.test(head), head);
  assert.ok(!/last written/.test(L.encodeState({ v: 1, id: '', n: '', e: 1, s: 0, t: 0 }).split('\n')[0]));
  assert.ok(L.decodeState(L.encodeState({ v: 1, id: 'aabbccdd', n: 'Sandis', e: 2, s: 0, t: 1793104926944 })));
});

test('a change of leader is written to the log with the old and the new name', () => withDiscord(async (f) => {
  const a = makeInstance(f, 'Wulf'); a.start();
  await until(() => a.role() === 'leader', 6000, 'leader a');
  a.crash();
  const b = makeInstance(f, 'Sandis'); b.start();
  await until(() => b.role() === 'leader', 20000, 'leader b');
  assert.ok(b.logs.some((l) => /the leader changed from Wulf \[.+\] to Sandis/.test(l)) || b.logs.some((l) => /leader (is|changed)/.test(l)), b.logs.join(' | '));
  b.crash();
}));

test('clan board presence and roster card ids live on the lease: written by any instance, seen by the others, kept by the leader heartbeat', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  const lead = insts.find((i) => i.role() === 'leader'), fol = insts.find((i) => i.role() !== 'leader');
  await until(() => insts.every((i) => i.mgr.forWebhook().boardView().known), 8000, 'both instances have read the lease');
  const hA = L.hash8('member a'), hW = L.hash8('wulf');
  const ra = await fol.mgr.forWebhook().boardAnnounce(hA); assert.ok(ra.ok, 'a follower can announce itself: ' + JSON.stringify(ra));
  assert.ok((await lead.mgr.forWebhook().boardAnnounce(hW)).ok, 'and so can the leader');
  await until(() => insts.every((i) => { const v = i.mgr.forWebhook().boardView(); return v.present.has(hA) && v.present.has(hW); }), 8000, 'everybody sees both entries');
  const again = await fol.mgr.forWebhook().boardAnnounce(hA); assert.ok(again.ok && again.same, 'announcing twice writes nothing');
  assert.ok((await lead.mgr.forWebhook().boardSetCards({ [hA]: '123456789012345678', zz: 'x', [hW]: 'not-an-id' })).ok);
  await until(() => insts.every((i) => Object.keys(i.mgr.forWebhook().boardView().cards).length === 1), 8000, 'the card map is shared and checked');
  assert.strictEqual(lead.mgr.forWebhook().boardView().cards[hA], '123456789012345678');
  await sleep(1200);   // some heartbeats later the fields are still there, and an old copy that does not know them keeps them (unknown fields survive)
  const st = f.state(); assert.ok(st.bm && st.bm[hA] && st.bm[hW] && st.bc && st.bc[hA], JSON.stringify(st));
  const pruned = await fol.mgr.forWebhook().boardAnnounce(hA, new Set([hA])); assert.ok(pruned.ok);
  await until(() => !insts[0].mgr.forWebhook().boardView().present.has(hW), 8000, 'entries of players who left the clan are dropped');
  insts.forEach((i) => i.crash());
}));

test('a PC set to prefer being host takes the lead from a healthy leader that does not prefer it, and keeps it', () => withDiscord(async (f) => {
  const sandis = makeInstance(f, 'Member A'); sandis.start();
  await until(() => sandis.role() === 'leader', 6000, 'member A leads');
  const main = makeInstance(f, 'Main', { prefer: true }); main.start();
  await until(() => main.role() === 'leader', 8000, 'the preferred PC leads');
  await until(() => sandis.role() === 'follower', 6000, 'member A yields');
  await new Promise((r) => setTimeout(r, 1200));
  assert.strictEqual(leaders([sandis, main]).length, 1); assert.strictEqual(main.leader(), true);   // no ping-pong
  assert.ok(f.state().pf === 1);
  sandis.crash(); main.crash();
}));

test('a PC that does not prefer it never takes the lead from a healthy leader, and two preferred PCs do not fight', () => withDiscord(async (f) => {
  const a = makeInstance(f, 'Member A', { prefer: true }); a.start();
  await until(() => a.role() === 'leader', 6000, 'a leads');
  const b = makeInstance(f, 'Member B', { prefer: true }); b.start();
  const c = makeInstance(f, 'Member C'); c.start();
  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(leaders([a, b, c]).length, 1); assert.strictEqual(a.leader(), true);
  a.crash();   // if the preferred host goes away, somebody else takes over as before
  await until(() => leaders([b, c]).length === 1, 8000, 'a new leader after the preferred host left');
  b.crash(); c.crash();
}));

test('the lease message is deleted by hand: the instances create a new one and agree on it', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  const oldId = f.leases()[0].id;
  delete f.leaseHook.messages[oldId];
  await until(() => f.leases().length === 1 && f.leases()[0].id !== oldId && leaders(insts).length === 1, 10000, 'a new lease and a leader');
  await sleep(300);
  assert.strictEqual(f.leases().length, 1);
  assert.ok(f.leaseHook.name.endsWith('[sl:' + f.leases()[0].id + ']'), f.leaseHook.name);
  assert.strictEqual(f.posts().length, 0, 'the clan\'s channel never saw a lease message');
  insts.forEach((i) => i.crash());
}));

test('mode "always" (the only ScapeLite user) posts with no lease message at all; mode "never" never posts the shared stream', () => withDiscord(async (f) => {
  const solo = makeInstance(f, 'Wulf', { mode: 'always' }); solo.start();
  solo.feed([raw('rareDrop', 'Member A', 'received a rare drop: [T3] Lobster from Dire Zombie!')]);
  await until(() => f.posts().length === 1, 4000);
  assert.strictEqual(f.leases().length, 0); assert.strictEqual(f.name, 'Clan Relay');
  solo.crash();
  const mute = makeInstance(f, 'Member B', { mode: 'never' }); mute.start();
  mute.feed([raw('rareDrop', 'Member A', 'received a rare drop: [T3] Hide from Dire Ghost!')]);
  await sleep(1300);
  assert.strictEqual(f.posts().length, 1); assert.strictEqual(f.leases().length, 0);
  mute.crash();
}));

test('once-only claims (raid summaries): three PCs claim the same key at the same moment, exactly one wins; a new key is free again', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B', 'Member C'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1 && insts.every((i) => i.role() !== 'unsure'), 6000);
  const results = await Promise.all(insts.slice(0, 3).map((i) => i.mgr.forWebhook(f.url).claim('raid:Dungeon:1793000000')));
  assert.strictEqual(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  const again = await insts[3].mgr.forWebhook(f.url).claim('raid:Dungeon:1793000000');
  assert.strictEqual(again.ok, false);
  const other = await insts[3].mgr.forWebhook(f.url).claim('raid:Dungeon:1793009999');
  assert.strictEqual(other.ok, true);
  assert.ok(f.state().s > 0, 'the leader\'s heartbeats go on next to the claims');
  insts.forEach((i) => i.crash());
}));

test('the leader publishes shared facts (digest time) that followers can read', () => withDiscord(async (f) => {
  const a = makeInstance(f, 'Wulf'), b = makeInstance(f, 'Member A');
  a.start(); await until(() => a.leader(), 5000); b.start(); await until(() => b.role() === 'follower', 5000);
  a.mgr.forWebhook(f.url).setShared({ dg: 1793000123456 });
  await until(() => (b.mgr.forWebhook(f.url).shared() || {}).dg === 1793000123456, 4000, 'follower sees dg');
  a.crash(); b.crash();
}));

test('clock skew does not matter: only the heartbeat counter is compared, on each PC\'s own clock', () => withDiscord(async (f) => {
  const skew = (ms) => { const t0 = Date.now(); return () => Date.now() + ms * 1 + (Date.now() - t0) * 0; };
  const mk = (name, offset) => {
    const sender = S.createSender({ timeoutMs: 1000, bucketSize: 100, bucketWindowMs: 50 });
    const mgr = L.createLeaseManager({ send: sender.send, label: () => name, options: FAST, now: skew(offset), leaseUrl: f.leaseUrl });
    return { name, mgr, tick: setInterval(() => mgr.tickAll(), 30), l: () => mgr.forWebhook(f.url) };
  };
  const a = mk('Wulf', 0), b = mk('Member A', 3600 * 1000 * 5), c = mk('Member B', -3600 * 1000 * 7);
  [a, b, c].forEach((x) => x.l());
  await until(() => [a, b, c].filter((x) => x.l().role() === 'leader').length === 1 && [a, b, c].every((x) => x.l().role() !== 'unsure'), 8000, 'a single leader despite +5h / -7h clocks');
  await sleep(600);
  assert.strictEqual([a, b, c].filter((x) => x.l().role() === 'leader').length, 1);
  [a, b, c].forEach((x) => clearInterval(x.tick));
}));

// ============================================================================================================================
// 3. v2: no coordination message in any channel people read; optional private lease webhook; version signalling; clean-up of the first version
// ============================================================================================================================
test('no lease webhook (the default): nothing but the posts themselves is ever sent to Discord - no lease message, no GET, no webhook rename', () => withDiscord(async (f) => {
  const solo = makeInstance(f, 'Wulf', { lease: false }); solo.start();
  assert.strictEqual(solo.mgr.configured(), false); assert.strictEqual(solo.mgr.forWebhook(f.url), null);
  solo.feed([raw('rareDrop', 'Member A', 'received a rare drop: [T3] Lobster from Dire Zombie!')]);
  solo.feed([raw('levelUp', 'Member B', 'Level up! Cook level is now 20')]);
  await until(() => f.posts().length === 2, 4000, 'both posts');
  await sleep(500);
  assert.strictEqual(f.posts().length, 2);
  assert.deepStrictEqual(Array.from(new Set(f.calls)), ['POST 123456'], 'only POSTs of the events themselves: ' + JSON.stringify(Array.from(new Set(f.calls))));
  assert.strictEqual(f.name, 'Clan Relay'); assert.strictEqual(f.leases().length, 0); assert.strictEqual(Object.keys(f.leaseHook.messages).length, 0);
  assert.ok(f.posts().every((p) => !/lease/i.test(p.content)));
  solo.crash();
}));

test('"Own events only": every PC posts only the events about its own player, nothing is posted twice and no lease or shared state is needed', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A', 'Member B'].map((n) => makeInstance(f, n, { mode: 'own', lease: false }));
  insts.forEach((i) => i.start());
  feedAll(insts, 'Member A', 'rareDrop', 'Dire Lich dropped [T1] Faulty Crystal!', 'received a rare drop: [T1] Faulty Crystal from Dire Lich!');
  feedAll(insts, 'Wulf', 'levelUp', 'Level up! Mine level is now 41.', 'Level up! Mine level is now 41');
  insts.forEach((i) => i.feed([raw('rareDrop', 'Member E', 'received a rare drop: [T2] Hide from Dire Ghost!')]));   // a clan mate without ScapeLite: nobody posts it
  await until(() => f.posts().length >= 2, 4000);
  await sleep(600);
  const c = contentsOf(f);
  assert.strictEqual(c.length, 2, JSON.stringify(c));
  assert.ok(c.some((x) => /Faulty Crystal/.test(x))); assert.ok(c.some((x) => /Mine level is now \*\*41\*\*/.test(x)));
  assert.deepStrictEqual(Array.from(new Set(f.calls)), ['POST 123456']);
  assert.strictEqual(C.leaseGate(insts[0].mgr, 'own')(f.url), 'standby', 'the shared streams (digest, rank, raid) stay quiet in "own" mode');
  insts.forEach((i) => i.crash());
}));

test('the lease webhook can be set and cleared while running; with none, the gate lets this PC post (it is on its own)', () => withDiscord(async (f) => {
  let url = '';
  const sender = S.createSender({ timeoutMs: 1000, bucketSize: 100, bucketWindowMs: 50 });
  const mgr = L.createLeaseManager({ send: sender.send, label: () => 'Wulf', options: FAST, leaseUrl: () => url });
  const gate = C.leaseGate(mgr, 'auto');
  assert.strictEqual(gate(f.url), 'send'); assert.strictEqual(mgr.forWebhook(f.url), null);
  url = f.leaseUrl;
  assert.strictEqual(gate(f.url), 'unsure', 'a lease webhook is set but the lease is not agreed yet: hold, never "post anyway"');
  const t = setInterval(() => mgr.tickAll(), 30);
  await until(() => gate(f.url) === 'send', 6000, 'leader of the lease');
  url = '';
  assert.strictEqual(gate(f.url), 'send'); assert.strictEqual(mgr.forWebhook(f.url), null);
  clearInterval(t);
}));

test('version signalling: instances behind the newest version in the lease know it; the newest never does; a leader on an old version does not downgrade the record; junk is ignored', () => withDiscord(async (f) => {
  const old = makeInstance(f, 'Wulf', { version: '0.4.0' });
  old.start(); await until(() => old.leader(), 5000);                                   // the OLD version is the leader
  const newer = makeInstance(f, 'Member A', { version: '0.4.2' }), mid = makeInstance(f, 'Member B', { version: '0.3.9' }), junk = makeInstance(f, 'Member C', { version: 'banana' }), none = makeInstance(f, 'Member D');
  [newer, mid, junk, none].forEach((i) => i.start());
  const info = (i) => i.mgr.forWebhook(f.url).info();
  await until(() => f.state() && f.state().mv === '0.4.2', 6000, 'the follower on 0.4.2 wrote its version into the lease');
  await until(() => info(old).newerVersion === '0.4.2' && info(mid).newerVersion === '0.4.2', 6000, 'the others read it');
  await sleep(500);                                                                     // several heartbeats of the 0.4.0 leader
  assert.strictEqual(f.state().mv, '0.4.2', 'the leader on 0.4.0 keeps the newest version in the record');
  assert.strictEqual(info(newer).newerVersion, '');
  assert.strictEqual(info(junk).version, ''); assert.strictEqual(info(junk).newerVersion, '', 'an invalid version string is not shared and not compared');
  assert.strictEqual(info(none).newerVersion, '', 'an instance that does not report a version says nothing and is told nothing');
  assert.ok(!/[a-z]/i.test(JSON.stringify(f.state().mv)), 'only a version number');
  assert.deepStrictEqual(Object.keys(f.state()).sort(), ['cl', 'dg', 'e', 'id', 'lk', 'mv', 'n', 'pf', 's', 't', 'v'], 'no other personal or setup data in the record');
  assert.strictEqual(f.posts().length, 0);
  [old, newer, mid, junk, none].forEach((i) => i.crash());
}));

test('version signalling when the newest version is the leader: followers on older versions are told', () => withDiscord(async (f) => {
  const a = makeInstance(f, 'Member A', { version: '0.5.0' }), b = makeInstance(f, 'Wulf', { version: '0.4.9' });
  a.start(); await until(() => a.leader(), 5000); b.start();
  await until(() => b.mgr.forWebhook(f.url).info().newerVersion === '0.5.0', 6000, 'the follower learns 0.5.0');
  assert.strictEqual(a.mgr.forWebhook(f.url).info().newerVersion, '');
  assert.strictEqual(L.cmpVer('0.10.0', '0.9.9'), 1); assert.strictEqual(L.cmpVer('1.0.0', '1.0.0'), 0); assert.strictEqual(L.cmpVer('0.4.9', '0.5.0'), -1);
  a.crash(); b.crash();
}));

test('lease message deleted by hand on the lease webhook: recreated once, same leader election, still nothing in the clan\'s channel', () => withDiscord(async (f) => {
  const insts = ['Wulf', 'Member A'].map((n) => makeInstance(f, n));
  insts.forEach((i) => i.start());
  await until(() => leaders(insts).length === 1, 6000);
  for (let k = 0; k < 2; k++) {
    const oldId = f.leases()[0].id; delete f.leaseHook.messages[oldId];
    await until(() => f.leases().length === 1 && f.leases()[0].id !== oldId && leaders(insts).length === 1, 10000, 'a new lease #' + k);
  }
  assert.strictEqual(f.posts().length, 0); assert.strictEqual(f.name, 'Clan Relay');
  insts.forEach((i) => i.crash());
}));

const LEGACY = (leader) => L.encodeState({ v: 1, id: 'aabbccdd', n: leader || 'Wulf', e: 3, s: 120, t: 1, lk: [], dg: 0, cl: {} }, leader || 'Wulf');
function legacySetup(f, opts) {
  const o = opts || {};
  const human = { id: '1564999999999999991', content: 'gz on the drop!', username: 'Member B', at: Date.now(), edits: 0 };
  f.hooks[123456].messages[human.id] = human;
  const lease = { id: '1564999999999999992', content: o.content || LEGACY(), username: 'ScapeLite relay lease', at: Date.now(), edits: 0 };
  if (!o.gone) f.hooks[123456].messages[lease.id] = lease;
  f.name = 'Clan Relay [sl:' + lease.id + ']';
  return { human, lease };
}
const memoryStore = () => { let s = {}; return { load: () => JSON.parse(JSON.stringify(s)), save: (x) => { s = JSON.parse(JSON.stringify(x)); }, get: () => s }; };
const cleanSender = () => S.createSender({ timeoutMs: 1000, bucketSize: 100, bucketWindowMs: 50, backoffBaseMs: 10, backoffMaxMs: 40, cooldownMaxMs: 60, brokenProbeMs: 60000, maxWaitMs: 5000 });

test('clean-up of the first lease version: the old lease message is deleted by the id in the webhook name, the name is restored, nothing else is touched, and it runs only once', () => withDiscord(async (f) => {
  const { human, lease } = legacySetup(f);
  const st = memoryStore(), logs = [], sender = cleanSender();
  const targets = [{ feature: 'relay', url: f.url }, { feature: 'digest', url: f.url }];       // the same webhook twice: looked at once
  const r = await LC.run({ send: sender.send, targets, load: st.load, save: st.save, log: (t) => logs.push(t) });
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].deleted, lease.id);
  assert.ok(!f.hooks[123456].messages[lease.id], 'the lease message is gone');
  assert.ok(f.hooks[123456].messages[human.id], 'a human message in the same channel is untouched');
  assert.strictEqual(f.name, 'Clan Relay', 'the original webhook name is back');
  assert.strictEqual(st.get().deleted.length, 1); assert.strictEqual(st.get().deleted[0].messageId, lease.id);
  assert.ok(!JSON.stringify(st.get()).includes('TESTTOKEN'), 'the webhook URL is never stored');
  assert.ok(logs.some((l) => l.includes(lease.id)));
  const before = f.calls.length;
  assert.deepStrictEqual(await LC.run({ send: sender.send, targets, load: st.load, save: st.save, log: () => {} }), []);
  assert.strictEqual(f.calls.length, before, 'the second run sends nothing');
  // the new code never brings it back: an auto instance without a lease webhook only posts what it relays
  const solo = makeInstance(f, 'Wulf', { lease: false }); solo.start();
  solo.feed([raw('levelUp', 'Member B', 'Level up! Cook level is now 21')]);
  await until(() => f.posts().length === 2, 4000);
  assert.strictEqual(f.name, 'Clan Relay'); assert.strictEqual(f.leases().length, 0);
  assert.ok(!Object.values(f.hooks[123456].messages).some((m) => /relay lease/.test(m.content)));
  solo.crash();
}));

test('clean-up: a name pointing to a message that is NOT a ScapeLite lease message deletes nothing and leaves the name alone; a pointer to an already deleted message only restores the name', () => withDiscord(async (f) => {
  const { human } = legacySetup(f, { content: 'something a person wrote' });
  const st = memoryStore(), sender = cleanSender(), logs = [];
  let r = await LC.run({ send: sender.send, targets: [{ feature: 'relay', url: f.url }], load: st.load, save: st.save, log: (t) => logs.push(t) });
  assert.strictEqual(r[0].deleted, undefined); assert.ok(r[0].skipped);
  assert.strictEqual(Object.keys(f.hooks[123456].messages).length, 2, 'both messages still there'); assert.ok(/\[sl:/.test(f.name), 'name left alone');
  assert.ok(f.hooks[123456].messages[human.id]);
  // gone already
  const st2 = memoryStore(); f.hooks[123456].messages = {}; f.name = 'Clan Relay [sl:1564999999999999777]';
  r = await LC.run({ send: sender.send, targets: [{ feature: 'relay', url: f.url }], load: st2.load, save: st2.save, log: () => {} });
  assert.strictEqual(r[0].deleted, null); assert.strictEqual(r[0].nameRestored, true); assert.strictEqual(f.name, 'Clan Relay');
  // a webhook that never had a suffix: nothing is sent except the one GET
  const st3 = memoryStore(); f.calls.length = 0;
  r = await LC.run({ send: sender.send, targets: [{ feature: 'relay', url: f.url }], load: st3.load, save: st3.save, log: () => {} });
  assert.strictEqual(r[0].found, false); assert.deepStrictEqual(f.calls, ['GET 123456']);
}));

test('clean-up: Discord failing is retried at the next run, not marked done', () => withDiscord(async (f) => {
  const { lease } = legacySetup(f);
  const st = memoryStore(), sender = cleanSender();
  f.down = true;
  let r = await LC.run({ send: sender.send, targets: [{ feature: 'relay', url: f.url }], load: st.load, save: st.save, log: () => {} });
  assert.strictEqual(r[0].done, false); assert.ok(f.hooks[123456].messages[lease.id]);
  f.down = false; sender.reset && sender.reset(f.url);
  await sleep(120);
  r = await LC.run({ send: sender.send, targets: [{ feature: 'relay', url: f.url }], load: st.load, save: st.save, log: () => {} });
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].deleted, lease.id); assert.strictEqual(f.name, 'Clan Relay');
}));

test('state files: an old outbox of raw collector events is converted to typed events on load', () => {
  const store = { outbox: [{ id: 1, channel: 'clan', kind: 'collection', player: 'Wulf', text: 'New Collection! Received [T4] Fur Body as a Savage Mushroom drop. +739 Luck XP', timestamp: '[18:33]', _q: 5, _tries: 2 }, { id: 2, channel: 'clan', kind: 'chat', player: 'Wulf', text: 'hi', timestamp: '[18:34]' }], keys: [] };
  const relay = C.createRelay({ send: async () => ({ ok: true }), store: { loadKeys: () => store.keys, loadOutbox: () => store.outbox, saveKeys() {}, saveOutbox() {} } });
  relay.load();
  const ob = relay.outbox();
  assert.strictEqual(ob.length, 2); assert.strictEqual(ob[0].v, 1); assert.strictEqual(ob[0].type, 'drop'); assert.strictEqual(ob[0]._tries, 2); assert.ok(ob[0].ek); assert.strictEqual(ob[1].type, 'chat');
});

// ============================================================================================================================
(async () => {
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); } catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
