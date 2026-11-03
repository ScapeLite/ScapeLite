// npm run test:log -- tests for the logging core (overlay/logging/) and the in-game client (overlay/log-client.js).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createLogSystem, normalizeConfig, FILE_RE } = require('../overlay/logging');
const { createReader } = require('../overlay/logging/reader');
const { redactText, redactData } = require('../overlay/logging/redact');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); } }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sl-log-')); }
function sys(extra) {
  const dir = tmp();
  const s = createLogSystem(Object.assign({ dir: path.join(dir, 'Logs'), configPath: path.join(dir, 'log-config.json'), flushMs: 0 }, extra));
  return { s, dir, logs: path.join(dir, 'Logs'), cfg: path.join(dir, 'log-config.json') };
}
const ls = (d) => { try { return fs.readdirSync(d).sort(); } catch (e) { return []; } };
const T = new Date(2026, 9, 20, 9, 15, 2).getTime();

console.log('logging core');

test('channel folders and file names carry the channel prefix and a timestamp', () => {
  const { s, logs } = sys({ now: () => T });
  s.channel('Tasks', 'skilling').info('a'); s.channel('Tasks', 'slayer').info('b'); s.channel('System').info('c'); s.channel('Fortress').info('d');
  assert.deepStrictEqual(ls(path.join(logs, 'Tasks')).filter((f) => f.endsWith('.log')), ['Skilling_Tasks_2026-10-20_09-15-02.log', 'Slayer_Tasks_2026-10-20_09-15-02.log']);
  assert.deepStrictEqual(ls(path.join(logs, 'System')), ['System_2026-10-20_09-15-02.log']);
  assert.ok(ls(path.join(logs, 'Fortress')).includes('Fortress_Runs_2026-10-20_09-15-02.log'));
  ls(path.join(logs, 'Tasks')).forEach((f) => assert.ok(FILE_RE.test(f), f));
});

test('unknown channel and unknown stream fall back safely (no arbitrary file names)', () => {
  const { s, logs } = sys({ now: () => T });
  s.ingest([{ ch: '../../evil', st: '..\\x', lv: 'info', m: 'x' }, { ch: 'Tasks', st: '../../y', lv: 'info', m: 'z' }]);
  assert.deepStrictEqual(ls(logs).sort(), ['Plugins', 'Tasks']);
  assert.ok(ls(path.join(logs, 'Tasks')).every((f) => /^Tasks_/.test(f)));
});

test('line format, levels and the Errors mirror', () => {
  const { s, logs } = sys({ now: () => T });
  s.channel('Watcher').info('hello'); s.channel('Watcher').debug('hidden'); s.channel('Watcher').error('boom');
  const w = fs.readFileSync(path.join(logs, 'Watcher', ls(path.join(logs, 'Watcher'))[0]), 'utf8');
  assert.ok(/2026-10-20 09:15:02\.000 INFO  \[Watcher\] hello/.test(w));
  assert.ok(/ERROR \[Watcher\] boom/.test(w));
  assert.ok(!/hidden/.test(w), 'debug is filtered at the default level');
  const e = fs.readFileSync(path.join(logs, 'Errors', ls(path.join(logs, 'Errors'))[0]), 'utf8');
  assert.ok(/ERROR \[Errors\] \[Watcher\] boom/.test(e));
});

test('legacy supervisor/watcher entries map to System / Watcher / Discord', () => {
  const { s, logs } = sys({ now: () => T });
  s.write({ t: T, cat: 'system', sub: 'supervisor', text: '[supervisor] up' });
  s.write({ t: T, cat: 'system', sub: 'connection', text: 'Connected to game' });
  s.write({ t: T, cat: 'discord', sub: 'relay', text: '-> clan hello' });
  s.write({ t: T, cat: 'system', sub: 'error', text: 'ERROR: x failed' });
  assert.deepStrictEqual(ls(logs).sort(), ['Discord', 'Errors', 'System', 'Watcher']);
});

test('structured channels also write .jsonl; plain channels do not', () => {
  const { s, logs } = sys({ now: () => T });
  s.channel('Tasks', 'slayer').info('done', { rec: { ts: 1, act: 'goblin' } }); s.channel('System').info('x');
  const t = ls(path.join(logs, 'Tasks')).filter((f) => f.endsWith('.jsonl'));
  assert.strictEqual(t.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(logs, 'Tasks', t[0]), 'utf8').trim());
  assert.strictEqual(rec.ch, 'Tasks'); assert.strictEqual(rec.st, 'slayer'); assert.strictEqual(rec.d.rec.act, 'goblin');
  assert.ok(!ls(path.join(logs, 'System')).some((f) => f.endsWith('.jsonl')));
  // human line of a humanData:false channel stays a readable sentence
  assert.ok(!/"rec"/.test(fs.readFileSync(path.join(logs, 'Tasks', ls(path.join(logs, 'Tasks')).find((f) => f.endsWith('.log'))), 'utf8')));
});

test('rotation by size starts a new file', () => {
  let t = T;
  const { s, logs, cfg } = sys({ now: () => t });
  fs.writeFileSync(cfg, JSON.stringify({ maxFileMB: 0.01 })); // ~10 KB
  for (let i = 0; i < 400; i++) { t += 1000; s.channel('Watcher').info('line ' + i + ' ' + 'x'.repeat(60)); }
  const files = ls(path.join(logs, 'Watcher'));
  assert.ok(files.length >= 3, 'files: ' + files.length);
  files.forEach((f) => assert.ok(fs.statSync(path.join(logs, 'Watcher', f)).size < 20000));
  assert.strictEqual(new Set(files).size, files.length);
});

test('rotation at midnight', () => {
  let t = new Date(2026, 9, 20, 23, 59, 58).getTime();
  const { s, logs } = sys({ now: () => t });
  s.channel('Watcher').info('before'); t += 5000; s.channel('Watcher').info('after');
  const f = ls(path.join(logs, 'Watcher'));
  assert.strictEqual(f.length, 2);
  assert.ok(f[0].includes('2026-10-20') && f[1].includes('2026-10-21'));
});

test('same-second restarts never reuse or overwrite a file', () => {
  const a = sys({ now: () => T });
  a.s.channel('System').info('one');
  const b = createLogSystem({ dir: a.logs, configPath: a.cfg, flushMs: 0, now: () => T });
  b.channel('System').info('two');
  const f = ls(path.join(a.logs, 'System'));
  assert.strictEqual(f.length, 2); assert.ok(FILE_RE.test(f[1]));
});

test('retention: by age and by size, only our own files', () => {
  const { s, logs, cfg } = sys({ now: () => Date.now() });
  const d = path.join(logs, 'Watcher'); fs.mkdirSync(d, { recursive: true });
  const old = path.join(d, 'Watcher_2020-01-01_00-00-00.log'), fresh = path.join(d, 'Watcher_2026-10-19_00-00-00.log'), foreign = path.join(d, 'notes.txt'), foreign2 = path.join(d, 'Watcher.log');
  [old, fresh, foreign, foreign2].forEach((f) => fs.writeFileSync(f, 'x'.repeat(2000)));
  const past = new Date(Date.now() - 400 * 86400000); fs.utimesSync(old, past, past); fs.utimesSync(foreign, past, past); fs.utimesSync(foreign2, past, past);
  assert.strictEqual(s.prune('Watcher', true), 1);
  assert.deepStrictEqual(ls(d), ['Watcher.log', 'Watcher_2026-10-19_00-00-00.log', 'notes.txt']);
  // size cap: oldest first
  fs.writeFileSync(cfg, JSON.stringify({ maxTotalMB: 0.01 }));
  const s2 = createLogSystem({ dir: logs, configPath: cfg, flushMs: 0 });
  const mk = (n, age) => { const f = path.join(d, 'Watcher_2026-10-1' + n + '_00-00-00.log'); fs.writeFileSync(f, 'y'.repeat(6000)); const t = new Date(Date.now() - age * 1000); fs.utimesSync(f, t, t); return f; };
  const a = mk(1, 300), b = mk(2, 200), c = mk(3, 100);
  s2.prune('Watcher', true);
  assert.ok(!fs.existsSync(a) && fs.existsSync(c));
  void b;
});

test('history channels keep longer than diagnostics', () => {
  const { s } = sys();
  assert.strictEqual(s.resolve('Tasks').keepDays, 90); assert.strictEqual(s.resolve('System').keepDays, 14); assert.strictEqual(s.resolve('Perf').keepDays, 7);
});

test('config: per-channel overrides, disable, level, bad values', () => {
  const { s, logs, cfg } = sys({ now: () => T });
  fs.writeFileSync(cfg, JSON.stringify({ level: 'warn', channels: { Tasks: { enabled: false }, Watcher: { level: 'debug', keepDays: 3 }, Bogus: { enabled: false } } }));
  s.channel('Tasks').info('no'); s.channel('System').info('filtered by global warn'); s.channel('Watcher').debug('yes');
  assert.ok(!fs.existsSync(path.join(logs, 'Tasks')) && !fs.existsSync(path.join(logs, 'System')));
  assert.ok(fs.existsSync(path.join(logs, 'Watcher')));
  assert.strictEqual(s.resolve('Watcher').keepDays, 3);
  const n = normalizeConfig({ keepDays: 'abc', level: 'loud', maxFileMB: -4, channels: { Tasks: { level: 'nope' }, Bogus: {} } });
  assert.strictEqual(n.keepDays, 14); assert.strictEqual(n.level, 'info'); assert.ok(n.maxFileMB > 0); assert.deepStrictEqual(n.channels, {});
  const saved = s.saveConfig({ channels: { Perf: { enabled: false } }, keepDays: 30 });
  assert.strictEqual(saved.keepDays, 30); assert.strictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).channels.Perf.enabled, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).channels.Watcher.level, 'debug', 'saveConfig merges');
});

test('global off writes nothing', () => {
  const { s, logs, cfg } = sys();
  fs.writeFileSync(cfg, JSON.stringify({ enabled: false }));
  s.channel('System').error('x'); assert.ok(!fs.existsSync(logs));
});

test('redaction of webhooks, tokens, secrets and user names', () => {
  const hook = 'https://discord.com/api/webhooks/123456789/AbCdEf_ghIJ-klmnop';
  assert.ok(!/AbCdEf/.test(redactText('posted to ' + hook + ' ok')));
  assert.ok(!/hooks\.slack/.test(redactText('https://hooks.slack.com/services/T0/B0/XXXX')));
  assert.ok(!/abcdef123456/.test(redactText('Authorization: Bearer abcdef123456abcdef')));
  assert.ok(!/s3cr3tvalue/.test(redactText('token=s3cr3tvalue&x=1')));
  assert.ok(!/s3cr3tvalue/.test(redactText('{"apiKey":"s3cr3tvalue"}')));
  assert.ok(!/alice/i.test(redactText('C:\\Users\\alice\\Documents\\x')));
  assert.ok(/<user>/.test(redactText('C:\\Users\\alice\\Documents\\x')));
  assert.strictEqual(redactText('Slayer goblin 120/120 in 312s'), 'Slayer goblin 120/120 in 312s');
  const d = redactData({ webhookUrl: 'x', nested: { password: 'p', ok: 1, note: hook }, list: ['token=abcd1234'] });
  assert.strictEqual(d.webhookUrl, '[redacted]'); assert.strictEqual(d.nested.password, '[redacted]'); assert.strictEqual(d.nested.ok, 1);
  assert.ok(!/AbCdEf/.test(JSON.stringify(d)));
});

test('redaction applies to what reaches the files', () => {
  const { s, logs } = sys({ now: () => T });
  s.channel('Discord').info('posting https://discord.com/api/webhooks/1/SECRETPART now', { webhookUrl: 'https://x/SECRETPART' });
  const all = ls(path.join(logs, 'Discord')).map((f) => fs.readFileSync(path.join(logs, 'Discord', f), 'utf8')).join('');
  assert.ok(!/SECRETPART/.test(all));
});

test('never throws, bounded message and data size', () => {
  const { s, logs } = sys({ now: () => T });
  const circ = {}; circ.me = circ;
  assert.doesNotThrow(() => { s.write(null); s.write({}); s.ingest('nope'); s.ingest([null, 5, { ch: 'Tasks' }]); s.channel('Tasks').info(undefined, circ); s.channel('System').info('x'.repeat(100000), { big: 'y'.repeat(100000) }); });
  const f = fs.readFileSync(path.join(logs, 'System', ls(path.join(logs, 'System'))[0]), 'utf8');
  assert.ok(f.length < 12000);
});

test('write queue is bounded', () => {
  const { s, logs } = sys({ now: () => T, flushMs: 50 });
  for (let i = 0; i < 20000; i++) s.channel('System').info('n' + i);
  assert.ok(s.info().queued <= 6000 && s.info().dropped > 0);
  s.flushSync();
  assert.ok(ls(path.join(logs, 'System')).length === 1);
});

console.log('migration');

test('flat run logs move into Logs/System, nothing is deleted or overwritten', () => {
  const { s, logs } = sys();
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, '2026-10-10_18-21-55.log'), 'one'); fs.writeFileSync(path.join(logs, '2026-10-10_22-11-22.log'), 'two');
  fs.mkdirSync(path.join(logs, 'System')); fs.writeFileSync(path.join(logs, 'System', 'System_2026-10-10_22-11-22.log'), 'existing');
  fs.writeFileSync(path.join(logs, 'keep-me.txt'), 'x');
  const r = s.start();
  assert.strictEqual(r.moved, 2); assert.strictEqual(r.errors, 0);
  assert.deepStrictEqual(ls(path.join(logs, 'System')), ['System_2026-10-10_18-21-55.log', 'System_2026-10-10_22-11-22-2.log', 'System_2026-10-10_22-11-22.log']);
  assert.strictEqual(fs.readFileSync(path.join(logs, 'System', 'System_2026-10-10_22-11-22.log'), 'utf8'), 'existing');
  assert.strictEqual(fs.readFileSync(path.join(logs, 'System', 'System_2026-10-10_22-11-22-2.log'), 'utf8'), 'two');
  assert.ok(fs.existsSync(path.join(logs, 'keep-me.txt')) && fs.existsSync(path.join(logs, 'README.txt')));
  assert.strictEqual(s.start().moved, 0, 'idempotent');
});

console.log('reader and Task Log recovery');

test('tail, search, path safety', () => {
  const { s, logs } = sys({ now: () => T });
  for (let i = 0; i < 50; i++) s.channel('Watcher').info('row ' + i);
  s.channel('Watcher').warn('needle here');
  const r = createReader(s), f = s.listFiles('Watcher')[0].name;
  assert.strictEqual(r.tail('Watcher', f, { lines: 5 }).lines.length, 5);
  assert.strictEqual(r.tail('Watcher', f, { q: 'needle' }).lines.length, 1);
  assert.ok(r.tail('Watcher', f, { level: 'warn' }).lines.every((l) => /WARN|ERROR/.test(l) || l[0] === '#'));
  assert.strictEqual(r.search('needle').count >= 1, true);
  const ov = r.overview(); assert.ok(ov.channels.length >= 10 && ov.channels.find((c) => c.name === 'Watcher').list.length === 1);
  assert.strictEqual(r.tail('Watcher', '../../etc/passwd').ok, false);
  assert.strictEqual(r.tail('Nope', f).ok, false);
  assert.strictEqual(r.tail('Watcher', '..\\x.log').ok, false);
  void logs;
});

test('Task Log is rebuilt from Tasks .jsonl, de-duplicated, across files', () => {
  let t = T;
  const { s, logs } = sys({ now: () => t });
  const rec = (ts, act) => ({ ts, kind: 'skill', skill: 'mining', act, qty: 10, done: 10, completed: true, secs: { total: 50 } });
  s.channel('Tasks', 'skilling').info('a', { rec: rec(100, 'copper') });
  s.channel('Tasks', 'slayer').info('b', { rec: Object.assign(rec(200, 'goblin'), { kind: 'slay' }) });
  t += 86400000 * 2; // new day -> new file
  s.channel('Tasks', 'skilling').info('a again', { rec: rec(100, 'copper') });
  s.channel('Tasks', 'skilling').info('c', { rec: rec(300, 'tin') });
  const out = createReader(s).taskRecords();
  assert.deepStrictEqual(out.map((r) => r.ts), [100, 200, 300]);
  void logs;
});

console.log('plugin API (overlay/log-client.js)');

function pageWith(storage) {
  const store = storage || {};
  const listeners = {};
  const win = { addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); }, removeEventListener: () => {} };
  win.window = win;
  const ctx = vm.createContext({ window: win, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, Date, JSON, String, Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'overlay', 'log-client.js'), 'utf8'), ctx);
  return { win, store, fire: (n) => (listeners[n] || []).forEach((f) => f()) };
}

test('page logs reach files: __ccLog.channel -> drain -> ingest -> Logs/<Channel>/', () => {
  const { s, logs } = sys({ now: () => T });
  const p = pageWith();
  p.win.__ccLog.channel('Tasks', 'slayer').info('page says hi', { rec: { ts: 5, act: 'x' } });
  p.win.__ccLog.channel('Alerts').warn('careful');
  p.win.__ccLog.channel('NotAChannel').info('lands in Plugins');
  const drained = p.win.__ccLog.drain(400);
  assert.strictEqual(drained.entries.length, 3); assert.strictEqual(p.win.__ccLog.pending, 0);
  assert.strictEqual(s.ingest(JSON.parse(JSON.stringify(drained.entries)), { dropped: 0 }), 3);
  assert.ok(ls(path.join(logs, 'Tasks')).some((f) => f.startsWith('Slayer_Tasks_')));
  assert.ok(ls(path.join(logs, 'Alerts')).length && ls(path.join(logs, 'Plugins')).length && ls(path.join(logs, 'Errors')).length);
});

test('page buffer is bounded, counts drops, and never throws', () => {
  const p = pageWith(); const c = p.win.__ccLog.channel('Perf');
  const circ = {}; circ.me = circ;
  assert.doesNotThrow(() => { for (let i = 0; i < 1500; i++) c.info('n' + i); c.info('circ', circ); p.win.__ccLog.log('X', 'bad level', 'ok'); });
  assert.ok(p.win.__ccLog.pending <= 1000);
  assert.ok(p.win.__ccLog.drain(5000).dropped > 0);
});

test('unsent page entries survive a reload through localStorage', () => {
  const p = pageWith(); p.win.__ccLog.channel('Tasks').info('last words'); p.fire('pagehide');
  assert.ok(p.store['cc-log-pending']);
  const q = pageWith(p.store);
  const e = q.win.__ccLog.drain(10).entries;
  assert.strictEqual(e.length, 1); assert.strictEqual(e[0].m, 'last words');
  assert.ok(!('cc-log-pending' in p.store));
});

test('page entries cannot smuggle secrets or paths into files', () => {
  const { s, logs } = sys({ now: () => T });
  s.ingest([{ t: T, ch: 'Plugins', lv: 'info', m: 'hook https://discord.com/api/webhooks/9/TOPSECRET', d: { token: 'TOPSECRET' } }]);
  const all = ls(path.join(logs, 'Plugins')).map((f) => fs.readFileSync(path.join(logs, 'Plugins', f), 'utf8')).join('');
  assert.ok(!/TOPSECRET/.test(all));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
