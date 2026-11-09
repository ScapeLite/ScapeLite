// npm run test:roster -- clan board cards for clanmates without ScapeLite ("roster cards"): the planner and card text (overlay/clan-board-roster.js) and the
// host side (overlay/clan-board-sync.js rosterTick) against a FAKE webhook server on 127.0.0.1. Nothing here can reach real Discord.
// Names are pseudonyms: Wulf = the player running ScapeLite, Member A..D = clanmates.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const R = require('../overlay/clan-board-roster');
const { createBoard } = require('../overlay/clan-board-sync');
const S = require('../overlay/discord-sender');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const MIN = 60000, T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
const h = R.hashOf;

function fake() {
  const f = { hits: [], messages: {}, nextId: 100000000000000000n, server: null };
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const ct = req.headers['content-type'] || '';
      let payload = null;
      if (/multipart/.test(ct)) { const m = /name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/.exec(body); payload = m ? JSON.parse(m[1]) : null; } else payload = body ? JSON.parse(body) : null;
      const id = (req.url.split('/messages/')[1] || '').split('?')[0];
      f.hits.push({ method: req.method, id, body: payload });
      const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST') { const nid = String(f.nextId++); f.messages[nid] = payload; reply(200, { id: nid }); return; }
      if (req.method === 'PATCH') { if (!f.messages[id]) { reply(404, { code: 10008, message: 'Unknown Message' }); return; } f.messages[id] = payload; reply(200, { id }); return; }
      if (req.method === 'DELETE') { if (!f.messages[id]) { reply(404, { code: 10008, message: 'Unknown Message' }); return; } delete f.messages[id]; reply(204); return; }
      reply(204);
    });
  });
  return new Promise((resolve) => f.server.listen(0, '127.0.0.1', () => { f.url = 'http://127.0.0.1:' + f.server.address().port + '/api/webhooks/777/BOARDTOKEN-xyz'; resolve(f); }));
}
async function rig(fn) {
  const f = await fake(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-roster-')), clock = { t: T0 };
  const sender = S.createSender({ timeoutMs: 500, backoffBaseMs: 10, cooldownMaxMs: 30, maxAttempts: 2, bucketWindowMs: 5 });
  const mk = (file) => createBoard({ sender, statePath: path.join(dir, file || 'clan-board-state.json'), now: () => clock.t, log: () => {}, logo: null });
  const c = { f, dir, clock, sender, mk, board: mk(), lease: { cards: {}, sets: 0 } };
  c.roster = { state: 'ok', tag: 'RAS', members: [{ name: 'Wulf', online: true }, { name: 'Member A', online: true }, { name: 'Member B', online: false }, { name: 'Member C', online: false }] };
  c.ctx = (over) => Object.assign({
    url: f.url, enabled: true, host: true, hostName: 'Wulf', roster: c.roster, exclude: [], self: 'Wulf', presence: new Set(), leaseCards: c.lease.cards,
    hiscores: { 'Member A': { rank: 332, totalLevel: 1760 } }, canCreate: true,
    setCards: async (m) => { c.lease.cards = m; c.lease.sets++; },
  }, over || {});
  c.tick = async (over, adv) => { if (adv) clock.t += adv; return c.board.rosterTick(c.ctx(over)); };
  try { await fn(c); } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); }
}
const count = (c, m) => c.f.hits.filter((x) => x.method === m).length;
const names = (c) => Object.values(c.f.messages).map((m) => m.embeds[0].author.name).sort();

// ---- the planner and the card text --------------------------------------------------------------------------------------------
test('planner: no card for me, for excluded members, or for members with their own card; cards of others go when they no longer qualify', () => {
  const p = R.planRoster({ roster: [{ name: 'Wulf' }, { name: 'Member A' }, { name: 'member b' }, { name: 'Member C' }, { name: 'Member D' }], exclude: ['Member B'], self: 'wulf', presence: new Set([h('Member C')]), ids: { [h('Member C')]: '1', [h('Gone Member')]: '2' } });
  assert.deepStrictEqual(p.want.map((m) => m.name), ['Member A', 'Member D']);
  assert.deepStrictEqual(p.remove.sort(), [h('Member C'), h('Gone Member')].sort());
});
test('card text: only what the host can see, labelled as seen by the host, never a task', () => {
  const on = R.buildRosterCard({ name: 'Member A', online: true, totalLevel: 1760, rank: 332 }, 'Wulf', T0).payload.embeds[0];
  assert.strictEqual(on.author.name, 'Member A');
  assert.ok(/Online now/.test(on.description) && /Total level 1,760/.test(on.description) && /rank #332/.test(on.description), on.description);
  assert.ok(/Seen by Wulf/.test(on.footer.text) && /no ScapeLite card/.test(on.footer.text));
  assert.ok(!/task|progress|level-up/i.test(on.description));
  const off = R.buildRosterCard({ name: 'Member B', online: false, lastOnlineAt: T0 - 60000 }, 'Wulf', T0).payload.embeds[0];
  assert.ok(/Offline/.test(off.description) && new RegExp('<t:' + Math.floor((T0 - 60000) / 1000) + ':R>').test(off.description));
  assert.notStrictEqual(on.color, off.color);
  assert.ok(!/level|rank/i.test(R.buildRosterCard({ name: 'Member B', online: false }, 'Wulf', T0).payload.embeds[0].description), 'no invented facts');
});
test('signature ignores the passing minutes, so an unchanged card is not edited', () => {
  const a = R.buildRosterCard({ name: 'Member B', online: false, lastOnlineAt: T0 }, 'Wulf', T0), b = R.buildRosterCard({ name: 'Member B', online: false, lastOnlineAt: T0 }, 'Wulf', T0 + 30 * MIN);
  assert.strictEqual(a.sig, b.sig);
});

// ---- the host side ---------------------------------------------------------------------------------------------------------------
test('switched off (default): nothing is sent, ever', () => rig(async (c) => {
  for (let i = 0; i < 4; i++) await c.tick({ enabled: false }, 5 * MIN);
  assert.strictEqual(c.f.hits.length, 0);
}));
test('solo, roster on: one card per clanmate, none for me, and then it stays quiet', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000); await c.tick({}, 3000);
  assert.deepStrictEqual(names(c), ['Member A', 'Member B', 'Member C']);
  const posts = count(c, 'POST'); assert.strictEqual(posts, 3);
  for (let i = 0; i < 5; i++) await c.tick({}, 10 * MIN);
  assert.strictEqual(count(c, 'POST'), 3); assert.strictEqual(count(c, 'PATCH'), 0, 'nothing changed: no edit');
  assert.ok(c.lease.sets >= 1 && Object.keys(c.lease.cards).length === 3, 'the ids were handed to the lease');
}));
test('rate: a member going online is edited after a minute, other changes at most every five minutes', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  c.roster.members[2].online = true;                        // Member B comes online
  await c.tick({}, 20 * 1000); assert.strictEqual(count(c, 'PATCH'), 0, 'too soon');
  await c.tick({}, 61 * 1000); assert.strictEqual(count(c, 'PATCH'), 1);
  c.roster.members[2].online = false;                        // and goes again: the next edit waits for the minute gap
  await c.tick({}, 10 * 1000); assert.strictEqual(count(c, 'PATCH'), 1);
  await c.tick({}, 61 * 1000); assert.strictEqual(count(c, 'PATCH'), 2);
}));
test('three ScapeLite users: the host makes cards only for members who have no card of their own', () => rig(async (c) => {
  await c.tick({ presence: new Set([h('Member A')]) }); await c.tick({ presence: new Set([h('Member A')]) }, 3000);
  assert.deepStrictEqual(names(c), ['Member B', 'Member C']);
}));
test('a member starts ScapeLite: their own card takes over and the host deletes the roster card', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  assert.strictEqual(names(c).length, 3);
  const before = c.lease.sets;
  await c.tick({ presence: new Set([h('Member B')]) }, 5000);
  assert.deepStrictEqual(names(c), ['Member A', 'Member C']); assert.strictEqual(count(c, 'DELETE'), 1);
  assert.ok(c.lease.sets > before && !c.lease.cards[h('Member B')], 'the lease no longer lists it');
}));
test('host failover: the new host adopts the cards from the lease (edits the same messages, makes none, drops the one it no longer needs)', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);          // Wulf is host and has made cards for A, B, C
  const ids = Object.assign({}, c.lease.cards), posts = count(c, 'POST'), idB = ids[h('Member B')];
  const second = c.mk('other-pc-state.json'); c.roster.members[2].online = true;      // Member A is the new host (an empty state); Member B came online
  await second.rosterTick(c.ctx({ hostName: 'Member A', self: 'Member A', leaseCards: ids, presence: new Set([h('Member A'), h('Wulf')]) }));
  assert.strictEqual(count(c, 'POST'), posts, 'no new cards');
  assert.ok(c.f.hits.some((x) => x.method === 'PATCH' && x.id === idB), 'edited the same message');
  assert.strictEqual(count(c, 'DELETE'), 1, 'the card of the new host (who has a card of their own) was removed');
  assert.deepStrictEqual(names(c), ['Member B', 'Member C']);
}));
test('a member leaves the clan: their card is deleted; a new member gets one', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  c.roster.members = c.roster.members.filter((m) => m.name !== 'Member C').concat([{ name: 'Member D', online: false }]);
  await c.tick({}, 3000); await c.tick({}, 3000);
  assert.deepStrictEqual(names(c), ['Member A', 'Member B', 'Member D']);
}));
test('toggling a member off deletes the card; the member list switch off deletes all of them', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  await c.tick({ exclude: ['member b'] }, 3000);
  assert.deepStrictEqual(names(c), ['Member A', 'Member C']);
  await c.tick({ enabled: false }, 3000);
  assert.deepStrictEqual(names(c), []);
}));
test('only the host acts: a follower sends nothing and deletes nothing', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  const n = c.f.hits.length;
  await c.tick({ host: false, presence: new Set([h('Member B')]) }, 10 * MIN);
  await c.tick({ host: false, enabled: false }, 10 * MIN);
  assert.strictEqual(c.f.hits.length, n);
}));
test('a roster that is not ready (loading, no clan) touches nothing', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  const n = c.f.hits.length;
  await c.tick({ roster: { state: 'loading', members: [] } }, 5000); await c.tick({ roster: null }, 5000); await c.tick({ roster: { state: 'none', members: [] } }, 5000);
  assert.strictEqual(c.f.hits.length, n); assert.strictEqual(names(c).length, 3);
}));
test('just after a start nothing is created (the others need a moment to announce themselves)', () => rig(async (c) => {
  await c.tick({ canCreate: false }); await c.tick({ canCreate: false }, 3000);
  assert.strictEqual(c.f.hits.length, 0);
}));
test('a card deleted in Discord is made again after a pause, not in a loop', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  const gone = Object.keys(c.f.messages)[0]; delete c.f.messages[gone];
  c.roster.members.forEach((m) => { m.online = !m.online; });      // force an edit
  await c.tick({}, 6 * MIN); await c.tick({}, 3000);
  const posts = count(c, 'POST'); assert.ok(posts <= 3 + 0, 'not yet recreated (pause): ' + posts);
  await c.tick({}, 31 * 1000); await c.tick({}, 3000);
  assert.strictEqual(names(c).length, 3);
}));
test('no webhook: nothing is sent', () => rig(async (c) => {
  assert.strictEqual((await c.tick({ url: '' })).why, 'no webhook');
}));
test('no secret in the state file or in any card: the webhook URL is only hashed', () => rig(async (c) => {
  await c.tick(); await c.tick({}, 3000); await c.tick({}, 3000);
  const st = fs.readFileSync(path.join(c.dir, 'clan-board-state.json'), 'utf8');
  assert.ok(!/BOARDTOKEN|api\/webhooks/.test(st), 'the URL is not stored');
  assert.ok(!/BOARDTOKEN|api\/webhooks/.test(JSON.stringify(c.f.messages)));
}));

(async () => {
  console.log('clan board roster cards');
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); } catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
