// npm run test:commands
// Chat commands (docs/CHAT-COMMANDS.md). No game, no Discord, no network:
//   1. watcher side: the host only runs the static allowlist, with validated plain arguments, and never prints a webhook address
//   2. page side: overlay/chat-commands.js in a stub page (parsing, replies, the mailbox, the game-input guard)
//   3. policy: the registry holds no verb that acts in the game or posts
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const OV = path.join(__dirname, '..', 'overlay');
const { createCommandHost, createHandlers, cleanArgs, scrub, LIMITS } = require(path.join(OV, 'chat-commands-watcher.js'));

let pass = 0, failed = 0;
const jobs = [];
const test = (name, fn) => jobs.push({ name, fn });

// ----------------------------------------------------------------------------- 1. watcher side
const HOOK = 'https://discord.com/api/webhooks/123456789/SECRET-token_abc';
function fakeDeps(over) {
  const status = {
    startedAt: Date.now() - 3 * 3600000, cdp: { connected: true, since: Date.now() - 3600000 }, bridge: { ok: true, ms: 12 },
    plugins: [{ id: 'chat-plus', enabled: true, loaded: true }, { id: 'ui-bar', enabled: true, loaded: true }, { id: 'notif-dock', enabled: false, loaded: false }],
    relayLease: { mode: 'auto', configured: true, version: '0.4.0', newerVersion: '', webhooks: [{ role: 'leader', hasLease: true, epoch: 3, errors: 0, lastError: 'failed for ' + HOOK }] },
    discord: { problems: 1, features: [{ id: 'digest', label: 'Activity digest', configured: true, broken: false, lastOkAt: Date.now() - 60000, queueLength: 0, lastError: 'bad ' + HOOK, lastErrorAt: Date.now() }, { id: 'raid', label: 'Raid summary', configured: false }] },
    digest: { lastPostAt: Date.now() - 7200000, nextPostAt: Date.now() + 3600000 }, clanHiscores: { lastClanRank: 55, lastPollAt: Date.now() - 600000 }, clanBoard: { configured: true, lastEditAt: Date.now() - 120000 },
  };
  const toggled = [];
  return Object.assign({
    status: () => status, version: '9.9.9', pluginDefs: [{ id: 'chat-plus' }, { id: 'ui-bar' }, { id: 'notif-dock' }, { id: 'lifecycle', core: true }],
    setPluginEnabled: async (id, on) => { toggled.push([id, on]); return id === 'lifecycle' ? { ok: false, error: 'core plugin cannot be disabled' } : { ok: true, applied: true }; },
    relayRole: () => 'auto', outbox: () => [1, 2, 3],
    digest: {
      buffer: () => ({ sinceAt: Date.now() - 3600000, players: {} }), config: () => ({ enabled: true, webhookUrl: HOOK }),
      build: () => [{ name: 'Rad', text: '**Rad**\nDrops: Dragon bones' }, { name: 'Wulf', text: '**Wulf**\nLevels: Mining 50' }],
      chunk: (blocks, o) => [{ text: o.head + '\n\n' + blocks.map((b) => b.text).join('\n\n'), blocks }], head: () => 'Activity Digest -- last 1h',
    },
    hiscoresCheck: async () => ({ rank: 55, prevRank: 57, members: [{ name: 'Rad', rank: 318, totalLevel: 1800 }], notFound: ['Ghost'], hasBaseline: true, changes: 2, wouldPost: false }),
    _toggled: toggled,
  }, over || {});
}
function host(over, extra) { const deps = fakeDeps(over); const logs = []; const h = createCommandHost(Object.assign({ log: (t) => logs.push(t), handlers: createHandlers(deps) }, extra || {})); return { h, deps, logs }; }
let n = 0;
const rec = (name, args, id) => ({ id: id || 'id' + (++n), name, args: args || [] });
const one = async (h, name, args) => (await h.process([rec(name, args)]))[0];

test('allowlist: only the known names run, nothing inherited from Object', async () => {
  const { h } = host();
  assert.deepStrictEqual(h.names().sort(), ['digest.preview', 'hiscores.check', 'plugin', 'plugins', 'relay.status', 'status', 'version']);
  for (const bad of ['nope', 'eval', 'board.repost', 'digest.post', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a'.repeat(50), 'Status', 'status ', '../x', '', null, 5, {}, ['status']]) {
    const r = await one(h, bad);
    assert.strictEqual(r.ok, false, 'must reject ' + JSON.stringify(bad));
  }
});
test('records without a valid id are ignored, repeated ids run once', async () => {
  const { h } = host();
  assert.deepStrictEqual(await h.process([{ name: 'status' }, { id: 'a b', name: 'status' }, { id: 'x'.repeat(41), name: 'status' }, null, 7, 'status']), []);
  const a = await h.process([{ id: 'same1', name: 'version' }, { id: 'same1', name: 'version' }]);
  assert.strictEqual(a.length, 1);
  assert.strictEqual((await h.process([{ id: 'same1', name: 'version' }])).length, 0, 'an id already handled is never run again');
});
test('arguments: plain strings, numbers and booleans only, short, at most four', async () => {
  assert.strictEqual(cleanArgs([{}]), null); assert.strictEqual(cleanArgs([[1]]), null); assert.strictEqual(cleanArgs([null]), null); assert.strictEqual(cleanArgs([() => 1]), null);
  assert.strictEqual(cleanArgs(['x'.repeat(LIMITS.argLen + 1)]), null); assert.strictEqual(cleanArgs([1, 2, 3, 4, 5]), null); assert.strictEqual(cleanArgs('status'), null);
  assert.strictEqual(cleanArgs([NaN]), null); assert.strictEqual(cleanArgs([Infinity]), null);
  assert.deepStrictEqual(cleanArgs(['a', 1, true]), ['a', 1, true]); assert.deepStrictEqual(cleanArgs(), []);
  const { h } = host();
  const r = await one(h, 'plugin', [{ toString: 'x' }, 'on']); assert.strictEqual(r.ok, false);
  const r2 = await one(h, 'plugin', ['x'.repeat(5000), 'on']); assert.strictEqual(r2.ok, false); assert.ok(r2.error.length < 100);
});
test('100 records at once: 20 are looked at, the rest answered "too many", nothing is executed twice', async () => {
  const { h, deps } = host();
  const recs = []; for (let i = 0; i < 100; i++) recs.push(rec('version', [], 'bulk' + i));
  const r = await h.process(recs);
  assert.strictEqual(r.length, 100);
  assert.strictEqual(r.filter((x) => x.error === 'Too many commands at once.').length, 80);
  assert.ok(r.filter((x) => x.ok).length <= 1, 'one version at a time (still running / too soon guards)');
  assert.strictEqual(deps._toggled.length, 0);
});
test('a huge or hostile reply is cut and scrubbed; a webhook address never leaves the host', async () => {
  const { h } = host({ status: () => ({ startedAt: 1, plugins: [] }) });
  const x = createCommandHost({ handlers: { version: { run: () => Array.from({ length: 80 }, (_, i) => 'line ' + i + ' ' + 'z'.repeat(500) + ' ' + HOOK) } } });
  const r = (await x.process([rec('version')]))[0];
  assert.ok(r.lines.length <= LIMITS.lines); assert.ok(r.lines.every((l) => l.length <= LIMITS.line));
  assert.ok(!JSON.stringify(r).includes('SECRET-token'));
  assert.ok(!/[\u0000-\u001f]/.test(scrub('a\u0001b\nc')));
  assert.ok(!scrub('see https://discordapp.com/api/webhooks/1/abc and https://canary.discord.com/api/webhooks/2/def').includes('webhooks'));
  void h;
});
test('every real handler answers without a webhook address in any reply', async () => {
  const { h } = host();
  for (const [name, args] of [['version'], ['status'], ['plugins'], ['relay.status'], ['digest.preview'], ['hiscores.check']]) {
    const r = await one(h, name, args || []);
    assert.strictEqual(r.ok, true, name + ' -> ' + JSON.stringify(r));
    const all = JSON.stringify(r);
    assert.ok(!/SECRET|webhooks\/|discord\.com/.test(all), name + ' leaked: ' + all);
    assert.ok(r.lines.length >= 1);
  }
});
test('status and relay status say the useful things', async () => {
  const { h } = host();
  const s = (await one(h, 'status')).lines.join('\n');
  assert.ok(/9\.9\.9/.test(s) && /connected since/.test(s) && /#55/.test(s) && /Discord problems: 1/.test(s), s);
  const r = (await one(h, 'relay.status')).lines.join('\n');
  assert.ok(/Relay mode: auto/.test(r) && /Events waiting to be posted: 3/.test(r) && /Activity digest: ok/.test(r) && /Raid summary: not set up/.test(r), r);
});
test('plugin: validated against the plugin list, core refused, on/off only', async () => {
  const { h, deps } = host();
  assert.strictEqual((await one(h, 'plugin', ['nosuch', 'on'])).ok, false);
  assert.strictEqual((await one(h, 'plugin', ['chat-plus'])).ok, false);
  assert.strictEqual((await one(h, 'plugin', ['chat-plus', 'maybe'])).ok, false);
  assert.strictEqual((await one(h, 'plugin', ['lifecycle', 'off'])).ok, false);
  assert.deepStrictEqual(deps._toggled, [['lifecycle', false]], 'only the core attempt reached setPluginEnabled, which refuses it');
  const h2 = host(); const ok = await one(h2.h, 'plugin', ['Chat-Plus', 'OFF']);   // (a fresh host: the same command has a minimum gap between runs)
  assert.strictEqual(ok.ok, true); assert.deepStrictEqual(h2.deps._toggled[0], ['chat-plus', false]);
});
test('per-command gap and "still running" guards', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const x = createCommandHost({ handlers: { slow: { run: () => gate.then(() => ['done']), timeoutMs: 50 }, quick: { gapMs: 60000, run: () => ['ok'] } } });
  const a = await x.process([rec('slow')]);
  assert.ok(/No answer in time/.test(a[0].error), 'a command that outlives its timeout gets a polite reply');
  const b = await x.process([rec('slow')]);
  assert.ok(/still running/.test(b[0].error), 'and cannot be started twice while it runs');
  release(); await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual((await x.process([rec('quick')]))[0].ok, true);
  assert.ok(/Too soon/.test((await x.process([rec('quick')]))[0].error));
});
test('a handler that throws gives an error record, never an exception', async () => {
  const x = createCommandHost({ handlers: { boom: { run: () => { throw new Error('kaput ' + HOOK); } }, boom2: { run: async () => { throw new Error('later'); } } } });
  for (const nm of ['boom', 'boom2']) { const r = (await x.process([rec(nm)]))[0]; assert.strictEqual(r.ok, false); assert.ok(!JSON.stringify(r).includes('SECRET')); }
});
test('onReply gets every reply as it is ready', async () => {
  const { h } = host(); const got = [];
  await h.process([rec('version'), rec('plugins')], (r) => got.push(r.name));
  assert.deepStrictEqual(got.sort(), ['plugins', 'version']);
});

// ----------------------------------------------------------------------------- 2. page side (stub page)
function page() {
  const calls = { local: [], toast: [], life: [] };
  const handlers = [];
  const win = { __ccReloadRequest: 0, __ccCmdBox: undefined };
  win.window = win;
  win.__ccLife = { scope: () => ({ on: (t, ty, fn, o) => { handlers.push({ t, ty, fn, o }); return fn; }, dispose: () => { calls.life.push('dispose'); } }) };
  win.__ccChat = { isOpen: () => true, local: (text, o) => { calls.local.push([text, o]); return true; } };
  win.__ccUI = { toast: (m) => calls.toast.push(m) };
  const ctx = vm.createContext(Object.assign(win, {
    document: { scripts: [{ src: 'https://play.scapewatch.com/app/game.74703fe3dc0c.js' }] },
    HTMLInputElement: class { }, Event: class { constructor(t) { this.type = t; } }, setTimeout, clearTimeout, console, Promise, Date, Math, Array, Object, String, Map, Set, JSON, Error,
  }));
  Object.defineProperty(ctx.HTMLInputElement.prototype, 'value', { get() { return this._v || ''; }, set(v) { this._v = v; }, configurable: true });
  vm.runInContext(fs.readFileSync(path.join(OV, 'chat-commands.js'), 'utf8'), ctx);
  return { win: ctx, calls, handlers };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 5));
const kb = (target, key) => { const e = { key, target, isComposing: false, prevented: 0, stopped: 0, preventDefault() { e.prevented++; }, stopImmediatePropagation() { e.stopped++; } }; return e; };
const chatInput = (value) => { const el = { classList: { contains: (c) => c === 'chat-input' }, dispatched: 0, dispatchEvent() { el.dispatched++; } }; el._v = value; Object.defineProperty(el, 'value', { get() { return el._v; }, set(v) { el._v = v; } }); return el; };

test('page: the prefix is exact, nothing else is ours', () => {
  const { win } = page(), m = win.__ccCmd.match;
  for (const yes of ['/sl', '/sl help', '/SL help', '/scapelite status', '  /sl x', '/ScapeLite', '/sl\thelp']) assert.strictEqual(m(yes), true, yes);
  for (const no of ['/help', '/slx', '/s1 help', '/ls help', '/scapelte help', 'sl help', 'hello /sl', '/w bob', '/r', '/me waves', '', '/', '//sl', '/scapelitex']) assert.strictEqual(m(no), false, no);
});
test('page: echo and help answer with local lines only', async () => {
  const { win, calls } = page();
  assert.strictEqual(win.__ccCmd.handle('/sl echo hello  world', { source: 'chat-plus' }), true);
  await tick(); assert.strictEqual(calls.local[0][0], 'hello world');
  calls.local.length = 0;
  win.__ccCmd.handle('/scapelite help', { source: 'chat-plus' }); await tick();
  assert.ok(calls.local.length >= 8 && /only you see/.test(calls.local[0][0]));
  assert.ok(!calls.local.some((l) => /echo/.test(l[0])), 'hidden commands are not listed');
  calls.local.length = 0;
  win.__ccCmd.handle('/sl help relay', { source: 'chat-plus' }); await tick();
  assert.ok(/relay status/.test(calls.local[0][0]));
  assert.strictEqual(win.__ccCmd.handle('/help', {}), false);
});
test('page: unknown command, near miss, bad group, options', async () => {
  const { win, calls } = page(); const H = (l) => win.__ccCmd.handle(l, { source: 'chat-plus' });
  H('/sl reflesh'); await tick(); assert.ok(/Unknown command "reflesh"\. Did you mean refresh\?/.test(calls.local.pop()[0]));
  H('/sl zzzzzzzz'); await tick(); assert.ok(!/Did you mean/.test(calls.local.pop()[0]));
  H('/sl relay'); await tick(); assert.ok(/\/sl relay status/.test(calls.local.pop()[0]));
  H('/sl status --yes'); await tick(); assert.ok(/Unknown option/.test(calls.local.pop()[0]));
  H('/sl'); await tick(); assert.ok(/ScapeLite commands/.test(calls.local[0][0]));
});
test('page: a watcher command leaves a record and shows the reply', async () => {
  const { win, calls } = page();
  win.__ccCmd.handle('/sl plugin chat-plus off', { source: 'chat-plus' }); await tick();
  const box = win.__ccCmdBox; assert.strictEqual(box.length, 1);
  assert.strictEqual(box[0].name, 'plugin'); assert.strictEqual(JSON.stringify(box[0].args), '["chat-plus","off"]'); assert.ok(/^[A-Za-z0-9_-]{1,40}$/.test(box[0].id));
  win.__ccCmdReply({ id: box[0].id, ok: true, lines: ['Plugin chat-plus is now off.'] }); await tick();
  assert.strictEqual(calls.local.pop()[0], 'Plugin chat-plus is now off.');
  win.__ccCmdReply({ id: 'unknown-id', ok: true, lines: ['stray'] }); await tick(); assert.strictEqual(calls.local.length, 0, 'a reply nobody asked for is dropped');
  win.__ccCmd.handle('/sl status', { source: 'chat-plus' }); await tick();
  win.__ccCmdReply({ id: win.__ccCmdBox[1].id, ok: false, lines: [], error: 'Too soon: wait 1 s.' }); await tick();
  assert.strictEqual(calls.local.pop()[0], 'Too soon: wait 1 s.');
});
test('page: the box never holds more than 20 records, and a silent service times out politely', async () => {
  const { win, calls } = page();
  for (let i = 0; i < 25; i++) win.__ccCmd.handle('/sl plugins', { source: 'chat-plus' });
  await tick(); assert.strictEqual(win.__ccCmdBox.length, 20);
  assert.ok(calls.local.some((l) => /Too many commands are waiting/.test(l[0])));
  const p = win.__ccCmd.ask('status', [], { waitMs: 20 }); const r = await p;
  assert.strictEqual(r.ok, false);
});
test('page: refresh asks the watcher the way the status tooltip does', async () => {
  const { win, calls } = page();
  win.__ccCmd.handle('/sl refresh', { source: 'chat-plus' }); await tick();
  assert.ok(win.__ccReloadRequest > 0); assert.ok(/Reloading ScapeLite/.test(calls.local[0][0]));
});
test('page: replies go to a toast when the chat panel is shut and the answer is one line', async () => {
  const { win, calls } = page(); win.__ccChat.isOpen = () => false;
  win.__ccCmd.handle('/sl echo short', { source: 'game-input' }); await tick();
  assert.deepStrictEqual(calls.toast, ['short']); assert.strictEqual(calls.local.length, 0);
  win.__ccCmd.handle('/sl help', { source: 'game-input' }); await tick();
  assert.ok(calls.local.length > 1 && calls.local[0][1].open === true, 'a long answer opens the panel');
  const { win: w2, calls: c2 } = page(); delete w2.__ccChat;
  w2.__ccCmd.handle('/sl help', { source: 'game-input' }); await tick(); assert.strictEqual(c2.toast.length, 1, 'no chat panel plugin: one toast');
});
test('page: the game-input guard takes /sl lines before the game sees them, and only those', async () => {
  const { win, handlers, calls } = page();
  assert.strictEqual(handlers.length, 1); assert.strictEqual(handlers[0].ty, 'keydown'); assert.strictEqual(handlers[0].o, true, 'capture phase');
  const run = (value, key, mutate) => { const el = chatInput(value), e = kb(el, key || 'Enter'); if (mutate) mutate(e); handlers[0].fn(e); return { el, e }; };
  let r = run('/sl echo hi');
  assert.strictEqual(r.e.prevented, 1); assert.strictEqual(r.e.stopped, 1); assert.strictEqual(r.el.value, ''); await tick(); assert.strictEqual(calls.local.pop()[0], 'hi');
  for (const v of ['/help', 'hello', '/w bob hi', '/slx', '/s1 help', '/me sl', '']) { r = run(v); assert.strictEqual(r.e.prevented + r.e.stopped, 0, 'must not touch ' + JSON.stringify(v)); assert.strictEqual(r.el.value, v); }
  r = run('/sl echo hi', 'a'); assert.strictEqual(r.e.prevented, 0); assert.strictEqual(r.el.value, '/sl echo hi');
  r = run('/sl echo hi', 'Enter', (e) => { e.isComposing = true; }); assert.strictEqual(r.e.prevented, 0, 'IME composition');
  const other = { classList: { contains: () => false }, value: '/sl echo hi' }; const e2 = kb(other, 'Enter'); handlers[0].fn(e2); assert.strictEqual(e2.prevented, 0, 'only the game chat input');
  assert.ok(win.__ccCmdReply);
});
test('page: teardown removes the guard and the reply hook and releases a waiting command', async () => {
  const { win, calls } = page(); const p = win.__ccCmd.ask('status', [], { waitMs: 5000 });
  win.__ccCmd.teardown(); const r = await p;
  assert.strictEqual(r.ok, false); assert.deepStrictEqual(calls.life, ['dispose']); assert.strictEqual(win.__ccCmd, undefined); assert.strictEqual(win.__ccCmdReply, undefined);
});

// ----------------------------------------------------------------------------- 3. policy
test('policy: no command acts in the game or posts; nothing in the page file reaches the bridge write methods', () => {
  const { win } = page();
  win.__ccCmd.commands().forEach((c) => assert.ok(c.kind === 'read' || c.kind === 'ctl', c.usage + ' has kind ' + c.kind + ': a post command needs a --yes gate first'));
  const src = fs.readFileSync(path.join(OV, 'chat-commands.js'), 'utf8');
  assert.ok(!/__ccBridge|queueInsert|queueCtl|setChatChannel|__ccGameSocket|\.click\(|sendMessage|chat_message|addMessage|fetch\(|XMLHttpRequest|WebSocket/.test(src.replace(/\/\/ .*$/gm, '')), 'chat-commands.js must stay display-only');
  const w = fs.readFileSync(path.join(OV, 'chat-commands-watcher.js'), 'utf8').replace(/\/\/ .*$/gm, '');
  assert.ok(!/\beval\(|new Function|child_process|\.send\(|deliverChunks|sender\./.test(w), 'the watcher side runs no code and posts nothing');
  const handlers = createHandlers(fakeDeps());
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['digest.preview', 'hiscores.check', 'plugin', 'plugins', 'relay.status', 'status', 'version']);
});
test('policy: the page names only commands the watcher allowlist has', () => {
  const { win } = page(); const watcher = Object.keys(createHandlers(fakeDeps()));
  const src = fs.readFileSync(path.join(OV, 'chat-commands.js'), 'utf8');
  const asked = Array.from(src.matchAll(/(?:viaWatcher|ask)\('([a-z.]+)'/g)).map((m) => m[1]);
  assert.ok(asked.length >= 7);
  asked.forEach((a) => assert.ok(watcher.includes(a), 'the page asks for "' + a + '" which the watcher does not know'));
  void win;
});
test('chat-plus: reply lines are local, unsaved, unmuted and invisible to the relay', () => {
  const src = fs.readFileSync(path.join(OV, 'chat-plus.js'), 'utf8');
  assert.ok(/filter\(\(m\) => !m\.local\)\.slice\(-400\)/.test(src), 'saveLog must skip local lines');
  assert.ok(/isMuted = \(m\) => \{ if \(m\.local\) return false;/.test(src));
  assert.ok(/latest\(n\) \{ return msgs\.filter\(\(m\) => !m\.local/.test(src));
  assert.ok(/__ccCmd/.test(src) && /ours/.test(src));
});
test('chat-plus: the SL button hides SL lines, persists, and a hidden reply is never silent', () => {
  const src = fs.readFileSync(path.join(OV, 'chat-plus.js'), 'utf8');
  assert.ok(/showSL: true/.test(src), 'showSL default on');
  assert.ok(/if \(isSL\(m\)\) \{ if \(cfg\.showSL === false\) continue; \}/.test(src), 'visible() hides SL lines only through showSL');
  assert.ok(/cfg\.showSL = !slOn; if \(cfg\.showSL\) hiddenSL = 0; saveCfg\(\)/.test(src), 'the button toggles and saves');
  assert.ok(/if \(cfg\.showSL === false\) \{[^}]*hiddenSL\+\+[^}]*UI\.toast/.test(src), 'a reply while hidden is counted and toasted');
});
test('chat-plus: message types can be hidden per channel as well as on every channel', () => {
  const src = fs.readFileSync(path.join(OV, 'chat-plus.js'), 'utf8');
  assert.ok(/hideCatCh: \{\}/.test(src), 'per-channel set has a default');
  assert.ok(/catHidden = \(m\) => \{[^}]*cfg\.hideCat\[c\][^}]*cfg\.hideCatCh\[m\.ch\]\[c\]/.test(src), 'a type is hidden by the all-channels set or by its own channel set');
  assert.ok(/isMuted = \(m\) => \{ if \(m\.local\) return false; if \(catHidden\(m\)\) return true;/.test(src), 'muting uses it and never touches local SL lines');
  assert.ok(/catScope/.test(src) && /cfg\.hideCatCh = Object\.assign/.test(src), 'the settings list edits the chosen scope');
});

(async () => {
  for (const j of jobs) {
    try { await j.fn(); pass++; console.log('ok   ' + j.name); } catch (e) { failed++; console.log('FAIL ' + j.name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
  }
  console.log((failed ? 'FAIL' : 'ok') + ': ' + pass + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
