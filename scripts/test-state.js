// npm run test:state -- the State/ folder move (overlay/paths.js migrateRuntime) and the atomic config writes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); } }

// paths.js reads SCAPELITE_HOME once when loaded: load a fresh copy per temp home.
function withHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-state-'));
  Object.keys(files || {}).forEach((n) => fs.writeFileSync(path.join(home, n), files[n]));
  process.env.SCAPELITE_HOME = home;
  delete require.cache[require.resolve('../overlay/paths')];
  return { home, P: require('../overlay/paths') };
}
const NAMES = ['chat-relay-seen.json', 'digest-state.json', 'clan-hiscores-state.json'];

console.log('State folder move');
test('files are copied into State/, the old copy is kept as .moved, and the new path is used', () => {
  const { home, P } = withHome({ 'digest-state.json': '{"players":{"A":{}}}', 'digest-state.json.bak': '{"players":{}}', 'chat-relay-seen.json': '["k1"]' });
  const r = P.migrateRuntime(NAMES);
  assert.strictEqual(r.paths['digest-state.json'], path.join(home, 'State', 'digest-state.json'));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r.paths['digest-state.json'], 'utf8')), { players: { A: {} } });
  assert.ok(fs.existsSync(path.join(home, 'State', 'digest-state.json.bak')), 'the .bak moves too');
  assert.ok(fs.existsSync(path.join(home, 'digest-state.json.moved')), 'safety copy');
  assert.ok(!fs.existsSync(path.join(home, 'digest-state.json')), 'old name is gone, so nothing writes there any more');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r.paths['chat-relay-seen.json'], 'utf8')), ['k1']);
  assert.strictEqual(r.paths['clan-hiscores-state.json'], path.join(home, 'State', 'clan-hiscores-state.json'), 'a missing file still gets its State/ path');
});
test('running it again changes nothing', () => {
  const { home, P } = withHome({ 'digest-state.json': '{"a":1}' });
  P.migrateRuntime(NAMES);
  const before = fs.readFileSync(path.join(home, 'State', 'digest-state.json'), 'utf8');
  const r2 = P.migrateRuntime(NAMES);
  assert.strictEqual(fs.readFileSync(path.join(home, 'State', 'digest-state.json'), 'utf8'), before);
  assert.strictEqual(r2.notes.length, 0);
});
test('a file present in both places keeps the State/ one and leaves the old one alone', () => {
  const { home, P } = withHome({ 'digest-state.json': '{"old":1}' });
  fs.mkdirSync(path.join(home, 'State'));
  fs.writeFileSync(path.join(home, 'State', 'digest-state.json'), '{"new":1}');
  const r = P.migrateRuntime(NAMES);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r.paths['digest-state.json'], 'utf8')), { new: 1 });
  assert.strictEqual(fs.readFileSync(path.join(home, 'digest-state.json'), 'utf8'), '{"old":1}');
});
test('a damaged file is not moved: the old path stays in use and the data is untouched', () => {
  const { home, P } = withHome({ 'digest-state.json': '{"half":' });
  const r = P.migrateRuntime(NAMES);
  assert.strictEqual(r.paths['digest-state.json'], path.join(home, 'digest-state.json'));
  assert.strictEqual(fs.readFileSync(path.join(home, 'digest-state.json'), 'utf8'), '{"half":');
  assert.ok(!fs.existsSync(path.join(home, 'State', 'digest-state.json')), 'no half copy is left behind');
  assert.ok(r.notes.some((n) => /could not be moved/.test(n)));
});
test('when State/ cannot be created every name keeps its old path', () => {
  const { home, P } = withHome({ 'digest-state.json': '{}' });
  fs.writeFileSync(path.join(home, 'State'), 'i am a file');   // a FILE named State: mkdir fails
  const r = P.migrateRuntime(NAMES);
  assert.strictEqual(r.paths['digest-state.json'], path.join(home, 'digest-state.json'));
  assert.ok(fs.existsSync(path.join(home, 'digest-state.json')));
});

console.log('atomic config writes');
const { writeJsonAtomic } = require('../overlay/safe-json');
test('backup:false leaves no .bak (configs hold webhooks) and no .tmp', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-state-')), f = path.join(d, 'x-config.json');
  writeJsonAtomic(f, JSON.stringify({ a: 1 }), { backup: false });
  writeJsonAtomic(f, JSON.stringify({ a: 2 }), { backup: false });
  assert.deepStrictEqual(fs.readdirSync(d), ['x-config.json']);
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).a, 2);
});
test('the watcher and supervisor no longer write config files with a bare writeFileSync', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'overlay', 'panel-resize-watcher.js'), 'utf8');
  assert.ok(!/writeFileSync\((PLUGINS_CONFIG_PATH|tmp, JSON)/.test(src), 'plugins-config / config temp writes go through writeJsonAtomic');
  assert.ok(!/DIGEST_CONFIG_PATH \+ '\.tmp'/.test(src));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
