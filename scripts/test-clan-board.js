// npm run test:board -- tests for the clan status board: the card builder (overlay/clan-board-card.js) and the watcher side that creates and
// edits the card (overlay/clan-board-sync.js), against a FAKE webhook server on 127.0.0.1. Nothing here can reach real Discord.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const Card = require('../overlay/clan-board-card');
const { createBoard } = require('../overlay/clan-board-sync');
const S = require('../overlay/discord-sender');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sl-board-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const MIN = 60000;
const snap = (over) => Object.assign({ v: 1, ok: true, ts: T0, name: 'Wulf', state: 'online', task: { skill: 'forage', skillName: 'Forage', text: 'Fur', place: 'Pinewrap', done: 34, goal: 120, etaAt: T0 + 12 * MIN }, totalLevel: 1234, xpHr: 2400000, hp: { cur: 82, max: 100 }, slay: null, fortress: null, lv: { fish: 49, forage: 71 }, totalXp: 5000000, tasks: 100 }, over || {});
const build = (over) => Card.build(Object.assign({ name: 'Wulf', snap: snap(), state: 'online', lastSeenAt: T0, onlineSince: T0 - 3600000, idleSince: 0, levelUps: [], today: { xp: 1250000, tasks: 31 }, fields: undefined, now: T0 }, over || {}));
const text = (r) => JSON.stringify(r.payload);

// ---- fake Discord ----------------------------------------------------------------------------------------------------------
function fake() {
  const f = { hits: [], script: [], messages: {}, nextId: 500, server: null };
  f.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const ct = req.headers['content-type'] || '';
      let payload = null, files = [];
      if (/multipart/.test(ct)) { const m = /name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/.exec(body); payload = m ? JSON.parse(m[1]) : null; files = [...body.matchAll(/filename="([^"]+)"/g)].map((x) => x[1]); }
      else payload = body ? JSON.parse(body) : null;
      const hit = { method: req.method, url: req.url, body: payload, files, multipart: /multipart/.test(ct) };
      f.hits.push(hit);
      const step = f.script.shift();
      const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)); };
      if (step) { reply(step.code, step.body); return; }
      if (req.method === 'POST') { const id = String(f.nextId++); f.messages[id] = hit.body; reply(/wait=true/.test(req.url) ? 200 : 204, /wait=true/.test(req.url) ? { id } : null); return; }
      if (req.method === 'PATCH') { const id = req.url.split('/messages/')[1].split('?')[0]; if (!f.messages[id]) { reply(404, { code: 10008, message: 'Unknown Message' }); return; } f.messages[id] = hit.body; reply(200, { id }); return; }
      reply(204);
    });
  });
  return new Promise((resolve) => f.server.listen(0, '127.0.0.1', () => { f.url = 'http://127.0.0.1:' + f.server.address().port + '/api/webhooks/777/BOARDTOKEN-xyz'; resolve(f); }));
}
async function rig(fn, opts) {
  const f = await fake(), dir = tmp();
  const clock = { t: T0 };
  const sender = S.createSender({ timeoutMs: 500, backoffBaseMs: 10, cooldownMaxMs: 30, maxAttempts: 2, bucketWindowMs: 20 });
  const mk = () => createBoard({ sender, statePath: path.join(dir, 'clan-board-state.json'), now: () => clock.t, log: () => {} });
  const ctx = { board: mk(), mk, f, dir, clock, sender, statePath: path.join(dir, 'clan-board-state.json') };
  try { await fn(ctx); } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); }
  void opts;
}
const ON = { clanBoardEnabled: true };
const tick = (c, over) => c.board.tick(Object.assign({ url: c.f.url, plugin: ON, snap: snap({ ts: c.clock.t }), connected: true }, over || {}));
const live = (c, over) => snap(Object.assign({ ts: c.clock.t }, over || {}));

// ---- card builder ----------------------------------------------------------------------------------------------------------
test('default card: task, progress with finish time, level-ups, total level and nothing else', () => {
  const r = build({ levelUps: [{ skill: 'fish', from: 49, to: 50, t: T0 - 2 * 3600000 }] });
  const e = r.payload.embeds[0];
  assert.strictEqual(e.author.name, 'Wulf');
  assert.ok(/Forage/.test(e.description) && /Fur/.test(e.description) && /Pinewrap/.test(e.description), e.description);
  assert.ok(/34\/120/.test(e.description), 'progress count');
  assert.ok(new RegExp('<t:' + Math.floor((T0 + 12 * MIN) / 1000) + ':R>').test(e.description), 'finish time as a Discord relative timestamp');
  assert.deepStrictEqual(e.fields.map((x) => x.name), ['Total level', 'Level-ups (last 24 h)']);
  assert.ok(/Fish 49 \u2192 50 \(<t:\d+:R>\)/.test(e.fields[1].value), e.fields[1].value);
  assert.strictEqual(e.color, Card.COLORS.online);
  assert.deepStrictEqual(r.payload.allowed_mentions, { parse: [] });
  ['XP/h', 'HP', 'Today', 'Online', 'Slayer', 'Fortress'].forEach((n) => assert.ok(!e.fields.some((x) => x.name.indexOf(n) === 0), n + ' is opt-in'));
});

test('every optional field appears when switched on, and each switch really hides its field', () => {
  const all = Object.assign({}, Card.DEFAULT_FIELDS, { xpHr: true, hp: true, slayer: true, fortress: true, onlineSince: true, today: true });
  const r = build({ snap: snap({ slay: { name: 'goblin', done: 12, goal: 40 }, fortress: { name: 'Fortress', wave: 7, party: 3 } }), fields: all, levelUps: [{ skill: 'fish', from: 1, to: 2, t: T0 - 1000 }] });
  const names = r.payload.embeds[0].fields.map((x) => x.name);
  ['Online', 'Total level', 'XP/h', 'HP', 'Slayer task', 'Fortress', 'Today', 'Level-ups (last 24 h)'].forEach((n) => assert.ok(names.includes(n), n + ' missing: ' + names));
  const v = (n) => r.payload.embeds[0].fields.find((x) => x.name === n).value;
  assert.strictEqual(v('XP/h'), '2.4M'); assert.strictEqual(v('HP'), '82 / 100'); assert.ok(/Goblin 12\/40/.test(v('Slayer task')));
  assert.ok(/wave 7/.test(v('Fortress')) && /3 players/.test(v('Fortress'))); assert.ok(/1\.3M XP/.test(v('Today')) || /1\.2M XP/.test(v('Today')));
  const off = Object.keys(all).reduce((o, k) => { o[k] = false; return o; }, {});
  const none = build({ fields: off });
  assert.strictEqual((none.payload.embeds[0].fields || []).length, 0);
  assert.ok(!/Pinewrap/.test(build({ fields: Object.assign({}, Card.DEFAULT_FIELDS, { location: false }) }).payload.embeds[0].description), 'location switch');
  assert.ok(!/34\/120/.test(build({ fields: Object.assign({}, Card.DEFAULT_FIELDS, { progress: false }) }).payload.embeds[0].description), 'progress switch');
});

test('offline card is grey with "last seen" as a relative timestamp; idle is amber with "since"', () => {
  const o = build({ state: 'offline', lastSeenAt: T0 - 20 * MIN, snap: Object.assign(snap(), { task: null }) });
  const e = o.payload.embeds[0];
  assert.strictEqual(e.color, Card.COLORS.offline);
  assert.ok(new RegExp('Offline.*<t:' + Math.floor((T0 - 20 * MIN) / 1000) + ':R>').test(e.description), e.description);
  assert.ok(e.fields.some((x) => x.name === 'Total level'), 'last known total level stays');
  const i = build({ state: 'idle', idleSince: T0 - 5 * MIN, snap: Object.assign(snap(), { task: null }) }).payload.embeds[0];
  assert.strictEqual(i.color, Card.COLORS.idle);
  assert.ok(/Idle.*since <t:\d+:R>/.test(i.description), i.description);
});

test('a name or task text with markdown, mentions or links cannot change the card or ping anybody', () => {
  const r = build({ name: '@everyone <@&123456789> **x**', snap: snap({ task: { skill: 'forage', text: '<@123456> [click](http://evil) @here', place: '_x_', done: 1, goal: 2 } }) });
  const e = r.payload.embeds[0];
  assert.ok(!/<@/.test(e.description.replace(/\\</g, '')), 'no live mention tag: ' + e.description);
  assert.ok(e.description.indexOf('\\@here') >= 0, 'escaped @here');
  assert.deepStrictEqual(r.payload.allowed_mentions, { parse: [] });
});

test('level-ups: last 24 hours only, newest first, runs of the same skill folded, capped with a "more" line', () => {
  const ups = [
    { skill: 'fish', from: 49, to: 50, t: T0 - 2 * 3600000 }, { skill: 'fish', from: 50, to: 51, t: T0 - 1 * 3600000 },
    { skill: 'mine', from: 10, to: 11, t: T0 - 30 * 3600000 }, { skill: 'cook', from: 5, to: 6, t: T0 - 5 * 3600000 },
  ];
  const r = Card.recentLevelUps(ups, T0);
  assert.deepStrictEqual(r.map((x) => x.skill + x.from + '-' + x.to), ['fish49-51', 'cook5-6']);
  const many = Array.from({ length: 10 }, (_, i) => ({ skill: 'sk' + i, from: 1, to: 2, t: T0 - i * 1000 }));
  const body = build({ levelUps: many }).payload.embeds[0].fields.find((x) => /Level-ups/.test(x.name)).value;
  assert.strictEqual(body.split('\n').length, 7); assert.ok(/and 4 more/.test(body));
});

test('the signature ignores the timestamp, so an unchanged card is never re-sent', () => {
  assert.strictEqual(build({ now: T0 }).sig, build({ now: T0 + 5 * MIN, snap: snap({ ts: T0 + 5 * MIN }) }).sig);
  assert.notStrictEqual(build().sig, build({ snap: snap({ task: Object.assign({}, snap().task, { done: 35 }) }) }).sig);
});

test('the card is inside Discord limits even with absurd input', () => {
  const huge = 'x'.repeat(5000);
  const r = build({ name: huge, snap: snap({ task: { skill: 'forage', text: huge, place: huge, done: 1, goal: 2 } }), fields: Object.assign({}, Card.DEFAULT_FIELDS, { xpHr: true, hp: true }) });
  const s = S.sanitizePayload(r.payload);
  assert.ok(s.payload && s.payload.embeds.length === 1);
  assert.ok(s.payload.embeds[0].author.name.length <= 256);
});

// ---- page side (the collector, run in a sandbox with a stub game bridge) -----------------------------------------------------
function collector(over) {
  const vm = require('vm');
  const settings = Object.assign({ clanBoardEnabled: true }, over && over.settings);
  const bridge = Object.assign({
    ok: () => true, whoami: () => ({ display: 'Wulf', name: 'wulf1', id: 'secret-id-123' }),
    live: () => ({ state: 'acting', at: 'pinewrap', task: { skill: 'forage', activityId: 'fur', activityName: 'Fur', nodeName: 'Pinewrap', progress: 34, quantity: 120 }, slay: null, xp: { forage: 1000, fish: 500 } }),
    current: () => ({ combat: false, kills: null }),
    project: () => ({ head: { timeSec: 600, xpHr: 2400000, kind: 'skill' }, skills: { fish: { level: 49 }, forage: { level: 71 } } }),
    ledger: () => ({ tasksTotal: 100, slayDone: 3 }), alertState: () => ({ currentHP: 82, maxHP: 100 }), raidParty: () => ({ names: [] }),
  }, over && over.bridge);
  const win = { __ccBridge: bridge, __ccBoardCard: Card, __ccPluginSettings: { get: (k) => settings[k] }, __ccLife: { scope: () => ({ every() {}, after() {}, dispose() {} }) } };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'overlay', 'clan-board-collect.js'), 'utf8'), Object.assign(win, { Date, JSON, Math, Object, Number, String, Array, isFinite, console }));
  const api = win.__ccClanBoard, clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));   // objects made inside the sandbox have their own prototypes
  return { snapshot: () => clone(api.snapshot()), preview: () => clone(api.preview()) };
}
test('collector: a compact snapshot from the bridge, with no account id and no raw game objects', () => {
  const api = collector();
  const s = api.snapshot();
  assert.ok(s && s.ok && s.name === 'Wulf');
  assert.deepStrictEqual({ skill: s.task.skill, text: s.task.text, place: s.task.place, done: s.task.done, goal: s.task.goal }, { skill: 'forage', text: 'Fur', place: 'Pinewrap', done: 34, goal: 120 });
  assert.ok(s.task.etaAt > Date.now() + 590000 && s.task.etaAt < Date.now() + 610000);
  assert.strictEqual(s.totalLevel, 120); assert.strictEqual(s.xpHr, 2400000); assert.strictEqual(s.tasks, 103); assert.deepStrictEqual(s.lv, { fish: 49, forage: 71 });
  assert.ok(!/secret-id-123|wulf1/.test(JSON.stringify(s)), 'no account id or login name');
  assert.ok(JSON.stringify(s).length < 700, 'compact: ' + JSON.stringify(s).length);
  assert.strictEqual(s.hp, undefined, 'HP is only read when its field is on');
});
test('collector: switched off = no snapshot and no reads; no game state = no snapshot', () => {
  let reads = 0;
  const off = collector({ settings: { clanBoardEnabled: false }, bridge: { live: () => { reads++; return null; } } });
  assert.strictEqual(off.snapshot(), null); assert.strictEqual(reads, 0);
  assert.strictEqual(collector({ bridge: { ok: () => false } }).snapshot(), null);
});
test('collector: combat with a Slayer task, idle, and the HP field', () => {
  const fight = collector({ settings: { clanBoardHp: true }, bridge: { live: () => ({ state: 'combat', at: 'goblin_camp', task: null, slay: { taskId: 'goblin', killCount: 12, killTarget: 40 }, xp: {} }), current: () => ({ combat: true, kills: { count: 12, target: 40 }, loadout: 'Melee' }) } }).snapshot();
  assert.strictEqual(fight.task.skillName, 'Slayer'); assert.strictEqual(fight.task.goal, 40); assert.ok(fight.task.kills); assert.deepStrictEqual(fight.slay, { name: 'Goblin', done: 12, goal: 40 });
  assert.deepStrictEqual(fight.hp, { cur: 82, max: 100 });
  const idle = collector({ bridge: { live: () => ({ state: 'idle', at: 'bank', task: null, slay: null, xp: {} }), project: () => ({ head: null, skills: {} }) } }).snapshot();
  assert.strictEqual(idle.state, 'idle'); assert.ok(!idle.task);
});
test('collector: preview() is the same card the watcher builds', () => {
  const api = collector({ settings: { clanBoardXpHr: true } });
  const p = api.preview();
  assert.ok(p.live && p.payload.embeds[0].author.name === 'Wulf');
  assert.ok(p.payload.embeds[0].fields.some((f) => f.name === 'XP/h'));
  assert.strictEqual(collector({ bridge: { ok: () => false } }).preview().state, 'none');
});

// ---- watcher side ----------------------------------------------------------------------------------------------------------
test('first tick creates the card with POST ?wait=true under the in-game name; the id is stored without the URL', () => rig(async (c) => {
  const r = await tick(c);
  assert.ok(r.sent && r.created);
  assert.strictEqual(c.f.hits.length, 1); assert.strictEqual(c.f.hits[0].method, 'POST'); assert.ok(/wait=true/.test(c.f.hits[0].url));
  assert.strictEqual(c.f.hits[0].body.username, 'ScapeLite', 'the message name is ScapeLite; the player is the card author');
  assert.strictEqual(c.f.hits[0].body.embeds[0].author.name, 'Wulf');
  const file = fs.readFileSync(c.statePath, 'utf8');
  assert.ok(/"messageId":"500"/.test(file));
  assert.ok(!/BOARDTOKEN|127\.0\.0\.1|webhooks/.test(file), 'no URL or token in the state file');
}));

test('logo: the create is a multipart POST with logo.png, the header icon points at attachment://logo.png', () => rig(async (c) => {
  await tick(c);
  const h = c.f.hits[0];
  assert.ok(h.multipart && h.files.length === 1 && h.files[0] === 'logo.png', JSON.stringify(h.files));
  assert.strictEqual(h.body.embeds[0].author.icon_url, 'attachment://logo.png');
  assert.deepStrictEqual(h.body.attachments, [{ id: 0, filename: 'logo.png' }]);
}));

test('logo: every edit re-sends the file and keeps exactly it (attachments [{id:0}]); username is only sent on create', () => rig(async (c) => {
  await tick(c);
  for (let i = 1; i <= 3; i++) { c.clock.t += 3 * MIN; await tick(c, { snap: live(c, { totalLevel: 1300 + i }) }); }
  const edits = c.f.hits.filter((h) => h.method === 'PATCH');
  assert.strictEqual(edits.length, 3);
  edits.forEach((h) => {
    assert.ok(h.multipart && h.files[0] === 'logo.png');
    assert.deepStrictEqual(h.body.attachments, [{ id: 0, filename: 'logo.png' }]);
    assert.strictEqual(h.body.embeds[0].author.icon_url, 'attachment://logo.png');
    assert.ok(!('username' in h.body) && !('avatar_url' in h.body));
  });
  await c.board.shutdown({ url: c.f.url });
  const last = c.f.hits[c.f.hits.length - 1]; assert.ok(last.multipart && last.body.attachments.length === 1, 'the final offline edit keeps the logo too');
  delete c.f.messages['500'];                                             // card deleted: the recreate carries the logo and the name again
  c.clock.t += 3 * MIN; await tick(c, { snap: live(c, { totalLevel: 1400 }) });
  c.clock.t += 31000; await tick(c, { snap: live(c, { totalLevel: 1401 }) });
  const re = c.f.hits[c.f.hits.length - 1];
  assert.strictEqual(re.method, 'POST'); assert.ok(re.multipart && re.files[0] === 'logo.png'); assert.strictEqual(re.body.username, 'ScapeLite');
}));

test('without a logo file the board still works with plain JSON and no icon', async () => {
  const f = await fake(), clock = { t: T0 };
  try {
    const sender = S.createSender({ timeoutMs: 500 });
    const b = createBoard({ sender, logo: null, statePath: path.join(tmp(), 's.json'), now: () => clock.t, log: () => {} });
    await b.tick({ url: f.url, plugin: ON, snap: snap({ ts: T0 }), connected: true });
    assert.ok(!f.hits[0].multipart && !('attachments' in f.hits[0].body) && !f.hits[0].body.embeds[0].author.icon_url);
  } finally { f.server.close(); f.server.closeAllConnections && f.server.closeAllConnections(); }
});

test('thumbnail: the task skill icon from the game asset host; none for idle, offline, foreign hosts or unknown skills', () => {
  const icon = Card.skillIconUrl('https://play.scapewatch.com', 'forage');
  assert.strictEqual(icon, 'https://play.scapewatch.com/assets/icons/skills/forage.png');
  assert.strictEqual(Card.skillIconUrl('https://play.scapewatch.com', 'combat'), 'https://play.scapewatch.com/assets/icons/skills/slay.png');
  assert.strictEqual(Card.skillIconUrl('https://play.scapewatch.com', 'nonsense'), null);
  assert.strictEqual(Card.skillIconUrl('http://localhost:9222', 'forage'), null, 'only the game origin');
  const withIcon = snap({ task: Object.assign({}, snap().task, { icon }) });
  assert.deepStrictEqual(build({ snap: withIcon }).payload.embeds[0].thumbnail, { url: icon });
  assert.ok(!build({ snap: withIcon, state: 'idle' }).payload.embeds[0].thumbnail);
  assert.ok(!build({ snap: withIcon, state: 'offline' }).payload.embeds[0].thumbnail);
  assert.ok(!build({ snap: withIcon, fields: Object.assign({}, Card.DEFAULT_FIELDS, { task: false }) }).payload.embeds[0].thumbnail);
  const evil = snap({ task: Object.assign({}, snap().task, { icon: 'https://evil.example/x.png' }) });
  assert.ok(!build({ snap: evil }).payload.embeds[0].thumbnail, 'a foreign icon url is never used');
});

test('off, or no webhook: nothing is sent and nothing is created', () => rig(async (c) => {
  await tick(c, { plugin: { clanBoardEnabled: false } });
  await tick(c, { url: '' });
  assert.strictEqual(c.f.hits.length, 0);
}));

test('cadence: changes inside the refresh interval wait; after it ONE edit with the newest state; unchanged = silence', () => rig(async (c) => {
  await tick(c);                                                         // create at T0
  c.clock.t += 30000; await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { done: 40 }) }) });
  c.clock.t += 30000; await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { done: 47 }) }) });
  assert.strictEqual(c.f.hits.length, 1, 'still inside the 2 minute interval');
  c.clock.t += 61000; await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { done: 60 }) }) });
  assert.strictEqual(c.f.hits.length, 2); assert.strictEqual(c.f.hits[1].method, 'PATCH');
  assert.ok(/60\/120/.test(c.f.hits[1].body.embeds[0].description), 'newest state, not an old one');
  assert.ok(!('username' in c.f.hits[1].body), 'identity is only set at creation');
  c.clock.t += 5 * MIN; await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { done: 60 }) }) });
  assert.strictEqual(c.f.hits.length, 2, 'nothing changed: no edit, however much time passed');
}));

test('refresh interval setting (1 to 5 minutes) is honoured and clamped', () => rig(async (c) => {
  await tick(c, { plugin: { clanBoardEnabled: true, clanBoardIntervalMin: 5 } });
  c.clock.t += 3 * MIN; await tick(c, { plugin: { clanBoardEnabled: true, clanBoardIntervalMin: 5 }, snap: live(c, { totalLevel: 1300 }) });
  assert.strictEqual(c.f.hits.length, 1, '3 minutes < 5');
  c.clock.t += 2.1 * MIN; await tick(c, { plugin: { clanBoardEnabled: true, clanBoardIntervalMin: 5 }, snap: live(c, { totalLevel: 1301 }) });
  assert.strictEqual(c.f.hits.length, 2);
  const { settingsFrom } = require('../overlay/clan-board-sync');
  assert.strictEqual(settingsFrom({ clanBoardEnabled: true, clanBoardIntervalMin: 99 }).intervalMin, 5);
  assert.strictEqual(settingsFrom({ clanBoardEnabled: true, clanBoardIntervalMin: 0 }).intervalMin, 1);
  assert.strictEqual(settingsFrom({ clanBoardEnabled: true }).intervalMin, 2);
}));

test('no spam: progress changing on every tick for an hour produces about one edit per interval', () => rig(async (c) => {
  for (let i = 0; i < 240; i++) {                                         // 240 ticks x 15 s = 1 hour
    await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { done: 34 + i }) }) });
    c.clock.t += 15000;
  }
  assert.ok(c.f.hits.length >= 25 && c.f.hits.length <= 32, 'requests in an hour: ' + c.f.hits.length);
}));

test('the finish time does not flap: small ETA estimate changes never cause an edit', () => rig(async (c) => {
  await tick(c);
  for (let i = 1; i <= 12; i++) {
    c.clock.t += 15000;
    await tick(c, { snap: live(c, { task: Object.assign({}, snap().task, { etaAt: c.clock.t + (12 * MIN - i * 15000) + (i % 2 ? 9000 : -9000) }) }) });
  }
  assert.strictEqual(c.f.hits.length, 1);
}));

test('level-ups are found by comparing snapshots, shown on the card, and survive a restart', () => rig(async (c) => {
  await tick(c);                                                         // baseline: fish 49, no level-up recorded
  assert.strictEqual(c.board._state().levelLog.length, 0);
  c.clock.t += 3 * MIN; await tick(c, { snap: live(c, { lv: { fish: 50, forage: 71 } }) });
  assert.strictEqual(c.board._state().levelLog.length, 1);
  const body = c.f.hits[1].body.embeds[0].fields.find((x) => /Level-ups/.test(x.name)).value;
  assert.ok(/Fish 49 \u2192 50/.test(body), body);
  const again = c.mk();                                                  // watcher restarted: state file read back
  assert.strictEqual(again._state().levelLog.length, 1); assert.strictEqual(again._state().messageId, '500');
  c.clock.t += 5 * MIN; await again.tick({ url: c.f.url, plugin: ON, snap: live(c, { lv: { fish: 51, forage: 71 } }), connected: true });
  const after = c.f.hits[c.f.hits.length - 1].body.embeds[0].fields.find((x) => /Level-ups/.test(x.name)).value;
  assert.ok(/Fish 49 \u2192 51/.test(after), 'folded: ' + after);
  assert.strictEqual(c.f.hits.filter((h) => h.method === 'POST').length, 1, 'the same card is edited, not a new one created');
  // a level-up that happened while the watcher was not running is found on the first snapshot after the restart
  c.clock.t += 5 * MIN; const third = c.mk();
  await third.tick({ url: c.f.url, plugin: ON, snap: live(c, { lv: { fish: 51, forage: 72 } }), connected: true });
  assert.ok(third._state().levelLog.some((x) => x.skill === 'forage' && x.to === 72));
}));

test('level-ups older than 24 hours leave the log', () => rig(async (c) => {
  await tick(c); c.clock.t += 3 * MIN; await tick(c, { snap: live(c, { lv: { fish: 50, forage: 71 } }) });
  c.clock.t += 26 * 3600000; await tick(c, { snap: live(c, { lv: { fish: 50, forage: 71 } }) });
  assert.strictEqual(c.board._state().levelLog.length, 0);
}));

test('game closed: after the grace period the card goes grey "offline, last seen", once', () => rig(async (c) => {
  await tick(c);
  c.clock.t += 40000; await tick(c, { snap: null, connected: false });
  assert.strictEqual(c.f.hits.length, 1, 'inside the grace period nothing changes');
  c.clock.t += 2 * MIN; await tick(c, { snap: null, connected: false });
  assert.strictEqual(c.f.hits.length, 2);
  const e = c.f.hits[1].body.embeds[0];
  assert.strictEqual(e.color, Card.COLORS.offline); assert.ok(/Offline.*last seen <t:\d+:R>/.test(e.description));
  c.clock.t += 20 * MIN; await tick(c, { snap: null, connected: false });
  assert.strictEqual(c.f.hits.length, 2, 'offline stays one edit, the relative time keeps counting by itself');
  c.clock.t += MIN; await tick(c, { snap: live(c) });
  c.clock.t += 31000; await tick(c, { snap: live(c) });
  assert.strictEqual(c.f.hits.length, 3); assert.strictEqual(c.f.hits[2].body.embeds[0].color, Card.COLORS.online, 'back online');
}));

test('never seen and game closed: no card is created just to say offline', () => rig(async (c) => {
  const r = await tick(c, { snap: null, connected: false });
  assert.strictEqual(r.sent, false); assert.strictEqual(c.f.hits.length, 0);
}));

test('idle player: one amber edit, then silence', () => rig(async (c) => {
  await tick(c);
  c.clock.t += 2 * MIN; await tick(c, { snap: live(c, { state: 'idle', task: null }) });
  assert.strictEqual(c.f.hits.length, 2); assert.strictEqual(c.f.hits[1].body.embeds[0].color, Card.COLORS.idle);
  c.clock.t += 10 * MIN; await tick(c, { snap: live(c, { state: 'idle', task: null }) });
  assert.strictEqual(c.f.hits.length, 2);
}));

test('a stale snapshot (page frozen) is not trusted as "now"', () => rig(async (c) => {
  await tick(c);
  c.clock.t += 5 * MIN; await tick(c, { snap: snap({ ts: T0 }) });       // ts is 5 minutes old
  assert.strictEqual(c.f.hits[c.f.hits.length - 1].body.embeds[0].color, Card.COLORS.offline);
}));

test('graceful stop: one final "offline" edit, bounded', () => rig(async (c) => {
  await tick(c);
  c.clock.t += 10000;
  const r = await c.board.shutdown({ url: c.f.url });
  assert.ok(r.sent); const e = c.f.hits[c.f.hits.length - 1].body.embeds[0];
  assert.strictEqual(e.color, Card.COLORS.offline); assert.ok(/Offline/.test(e.description));
}));

test('graceful stop with the board off or without a card sends nothing', () => rig(async (c) => {
  const r = await c.board.shutdown({ url: c.f.url });
  assert.strictEqual(r.sent, false); assert.strictEqual(c.f.hits.length, 0);
}));

test('the card was deleted in Discord: recreated, but never more often than every 30 seconds', () => rig(async (c) => {
  await tick(c);
  delete c.f.messages['500'];
  c.clock.t += 2.1 * MIN; await tick(c, { snap: live(c, { totalLevel: 1400 }) });          // PATCH -> 404
  assert.strictEqual(c.board._state().messageId, null);
  const hitsAfterGone = c.f.hits.length;
  c.clock.t += 5000; const r = await tick(c, { snap: live(c, { totalLevel: 1401 }) });     // too soon
  assert.strictEqual(r.sent, false); assert.strictEqual(c.f.hits.length, hitsAfterGone);
  c.clock.t += 31000; await tick(c, { snap: live(c, { totalLevel: 1402 }) });
  assert.strictEqual(c.f.hits[c.f.hits.length - 1].method, 'POST');
  assert.ok(c.board._state().messageId, 'a new id is stored');
}));

test('a different webhook gets its own new card (the old id is forgotten)', () => rig(async (c) => {
  await tick(c);
  c.clock.t += 3 * MIN; const other = c.f.url.replace('BOARDTOKEN-xyz', 'OTHERTOKEN-abc');
  await tick(c, { url: other, snap: live(c) });
  assert.strictEqual(c.f.hits[1].method, 'POST');
}));

test('Discord error: nothing is lost, the next due tick retries with the newest state', () => rig(async (c) => {
  await tick(c);
  c.f.script.push({ code: 500, body: {} }, { code: 500, body: {} });
  c.clock.t += 3 * MIN; const r = await tick(c, { snap: live(c, { totalLevel: 1500 }) });
  assert.strictEqual(r.sent, false);
  assert.ok(c.board.status().lastError);
  await sleep(80);                                                        // the sender's own short cool-down
  c.clock.t += 15000; const r2 = await tick(c, { snap: live(c, { totalLevel: 1501 }) });
  assert.ok(r2.sent, JSON.stringify(r2));
  assert.ok(/1,501/.test(JSON.stringify(c.f.hits[c.f.hits.length - 1].body)));
  assert.strictEqual(c.board.status().lastError, null);
}));

test('today: XP and tasks since the first snapshot of the day, reset at midnight', () => rig(async (c) => {
  const p = Object.assign({}, ON, { clanBoardToday: true });
  await tick(c, { plugin: p });
  c.clock.t += 3 * MIN; await tick(c, { plugin: p, snap: live(c, { totalXp: 5000000 + 250000, tasks: 105 }) });
  const f = c.f.hits[1].body.embeds[0].fields.find((x) => x.name === 'Today');
  assert.ok(f && /250\.0K XP/.test(f.value) && /5 tasks/.test(f.value), f && f.value);
}));

test('the whole board stays quiet when the webhook is dead (404): no retry storm', () => rig(async (c) => {
  c.f.script.push({ code: 404, body: { code: 10015, message: 'Unknown Webhook' } });
  await tick(c);
  const n = c.f.hits.length;
  for (let i = 0; i < 6; i++) { c.clock.t += 3 * MIN; await tick(c, { snap: live(c, { totalLevel: 2000 + i }) }); }
  assert.strictEqual(c.f.hits.length, n, 'the sender holds the dead webhook back');
  assert.ok(c.sender.isBroken(c.f.url));
}));

(async () => {
  console.log('clan status board');
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ok   ' + t.name); } catch (e) { fail++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e)); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
