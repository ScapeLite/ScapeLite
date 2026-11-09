// Self-test of the package guard (scripts/lib/package-guard.js) and of the first-run / hollow-template logic.
//   npm run test:package
// Builds tiny fake package trees in the OS temp dir. Every planted secret is ASSEMBLED HERE AT RUN TIME from fragments and is obviously
// fake (id of zeros, TOKEN-PLACEHOLDER), so this file and the repo contain no secret-looking string. Nothing real is read or written.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const guard = require('./lib/package-guard');
const root = path.join(__dirname, '..');

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
function section(title) { queue.push([null, title]); }

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scapelite-pkgtest-'));
let n = 0;
const put = (dir, rel, text) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
function cleanTree() {
  const d = path.join(tmpRoot, 'tree' + (++n));
  put(d, 'package.json', '{"name":"x","version":"1.0.0"}');
  put(d, 'app/main.js', "'use strict';\n");
  put(d, 'overlay/supervisor.js', "'use strict';\nconst a = 1;\n");
  put(d, 'overlay/logging/index.js', "'use strict';\n");
  put(d, 'overlay/catalog.json', '{"plugins":[{"id":"core","url":"https://example.com/x"}]}');
  put(d, 'overlay/digest-config.example.json', JSON.stringify({ enabled: false, webhookUrl: '', intervalHours: 6 }));
  put(d, 'overlay/clan-hiscores-config.example.json', JSON.stringify({ enabled: false, webhookUrl: '', clanTag: '', members: [] }));
  put(d, 'overlay/icon.png', 'png');
  put(d, 'docs/PLUGINS.md', '# Plugins\nA placeholder looks like C:\\Users\\<you>\\x and discord.com/api/webhooks/XXXXXXXXXXXXXXXXXXXX/YYYYYYYYYYYYYYYYYYYY\n');
  put(d, 'branding/logo.svg', '<svg/>');
  put(d, 'node_modules/express/index.js', 'module.exports = {};\n');
  return d;
}
const scan = (d, extra) => guard.scanTree(d, Object.assign({ mode: 'package', denyTerms: [] }, extra || {}));
const classes = (r) => r.findings.map((f) => f.cls);
const has = (r, re) => r.findings.some((f) => re.test(f.cls));

// fake secrets, assembled from fragments
const ID = '0'.repeat(18), TOKEN = 'TOKEN-' + 'PLACEHOLDER-' + 'TOKEN-PLACEHOLDER';
const FAKE_WEBHOOK = 'https://discord' + '.com/api/' + 'webhooks/' + ID + '/' + TOKEN;
const FAKE_BOT = 'M' + 'A'.repeat(23) + '.' + 'abcdef' + '.' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';
const FAKE_KEY = 'a1b2c3d4e5f6g7h8i9j0' + 'k1l2m3n4o5p6';
const FAKE_USER = 'zed_person';

section('package guard');
t('a clean tree passes', () => { const r = scan(cleanTree()); assert.deepStrictEqual(r.findings, []); assert.ok(r.files >= 8); });
t('placeholders (<you>, XXXX webhooks, example urls) do not trip the guard', () => { assert.strictEqual(scan(cleanTree()).findings.length, 0); });

const FORBIDDEN = {
  'overlay/discord-test-webhook.json': /webhook file/,
  'overlay/chat-relay-config.json': /user config file/,
  'overlay/clan-hiscores-config.json': /user config file/,
  'overlay/digest-state.json': /user state file/,
  'overlay/chat-relay-seen.json': /state file/,
  'overlay/State/chat-relay-seen.json': /state file/,
  'overlay/State/anything.txt': /folder/,
  'overlay/State/option-log.json': /folder/,   // the Task Option Log: local data, never shipped
  'overlay/digest-state.json.moved': /backup/,
  'overlay/chat-relay-outbox.json': /state file/,
  'overlay/raid-summary-pending.json': /state file/,
  'overlay/clan-board-levels.json': /state file/,
  'overlay/plugins-config.json': /user config file/,
  'overlay/authors.local.json': /local override/,
  'overlay/player-icon-cache.json': /cache/,
  'overlay/supervisor.lock': /lock/,
  'overlay/watcher.log': /log file/,
  'overlay/chat-relay-outbox.json.bak': /backup/,
  'overlay/x.js.tmp': /backup\/temp/,
  'overlay/x.corrupt': /backup\/temp/,
  'Logs/System/a.txt': /folder/,
  'roadmap/roadmap.json': /folder/,
  'notes/a.md': /folder/,
  'design-lab/index.html': /folder/,
  'graphify-out/graph.json': /folder/,
  'dist/x.txt': /folder/,
  'scripts/x.js': /folder/,
  'data/raw/items.json': /game data/,
  'data/profile.json': /game data/,
  'public/assets/icons/a.png': /game data/,
  'release.local.json': /local override|release credentials/,
  '.env': /env file/,
  'nul': /reserved/,
  'tray1.png': /stray/,
  'keys/id_rsa': /ssh key/,
};
for (const rel of Object.keys(FORBIDDEN)) {
  t('forbidden path is caught: ' + rel, () => { const d = cleanTree(); put(d, rel, 'x'); const r = scan(d); assert.ok(r.findings.some((f) => f.file === rel || f.file.startsWith(rel.split('/')[0])), 'not reported'); assert.ok(has(r, FORBIDDEN[rel]), 'wrong class: ' + classes(r).join(' | ')); });
}
t('a file that is merely unexpected (not on the allow-list) is caught', () => { const d = cleanTree(); put(d, 'overlay/notes.txt', 'x'); assert.ok(has(scan(d), /allow-list/)); });
t('a new top-level folder is caught', () => { const d = cleanTree(); put(d, 'stuff/a.js', 'x'); assert.ok(has(scan(d), /top-level/)); });
t('every doc the installer lists is allowed by the guard (a CI build once failed on a doc that was listed but not allowed)', () => {
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const docs = pk.build.files.filter((f) => /^docs\/[^*!]+\.md$/.test(f)).map((f) => f.slice(5));
  assert.ok(docs.length >= 4);
  const d = cleanTree(); docs.forEach((n) => put(d, 'docs/' + n, '# x'));
  assert.ok(!has(scan(d), /doc not in/), docs.join(', '));
});
t('an extra doc is caught',() => { const d = cleanTree(); put(d, 'docs/DISTRIBUTION-RISKS.md', '# x'); assert.ok(has(scan(d), /doc not in/)); });
t('webhook files are caught inside node_modules too', () => { const d = cleanTree(); put(d, 'node_modules/foo/my-webhook.json', '{}'); assert.ok(has(scan(d), /webhook file/)); });

t('a Discord webhook URL inside a code file is caught (and not echoed)', () => {
  const d = cleanTree(); put(d, 'overlay/supervisor.js', "const u = '" + FAKE_WEBHOOK + "';\n");
  const r = scan(d); assert.ok(has(r, /webhook URL/)); assert.ok(!JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes(ID));
});
t('a webhook URL is caught inside node_modules as well', () => { const d = cleanTree(); put(d, 'node_modules/express/index.js', '// ' + FAKE_WEBHOOK + '\n'); assert.ok(has(scan(d), /webhook URL/)); });
t('a bot-token-like string is caught', () => { const d = cleanTree(); put(d, 'overlay/supervisor.js', 'const b = "' + FAKE_BOT + '";\n'); assert.ok(has(scan(d), /bot-token/)); });
t('a long random value next to a secret-like key is caught', () => {
  for (const key of ['token', 'webhook', 'secret', 'password', 'apiKey']) {
    const d = cleanTree(); put(d, 'overlay/supervisor.js', 'const o = { ' + key + ': "' + FAKE_KEY + '" };\n');
    assert.ok(has(scan(d), /random value/), key);
  }
  const d = cleanTree(); put(d, 'overlay/catalog.json', '{"apiKey": "' + FAKE_KEY + '"}'); assert.ok(has(scan(d), /random value/), 'json');
});
t('a short or placeholder value next to a key is not a hit', () => { const d = cleanTree(); put(d, 'overlay/supervisor.js', 'const o = { token: "abc", secret: "' + 'x'.repeat(30) + '", password: "your-password-here-please" };\n'); assert.strictEqual(scan(d).findings.length, 0); });
t('a real-looking Windows user path is caught (raw and escaped)', () => {
  for (const sep of ['\\', '\\\\', '/']) {
    const d = cleanTree(); put(d, 'overlay/supervisor.js', "const p = 'C:" + sep + 'Users' + sep + FAKE_USER + sep + "Documents';\n");
    assert.ok(has(scan(d), /Windows user path/), 'sep ' + sep);
  }
});
t('placeholder user paths are fine', () => { const d = cleanTree(); put(d, 'overlay/supervisor.js', "// C:\\\\Users\\\\alice\\\\x C:\\Users\\<you>\\x C:\\Users\\%USERNAME%\\x C:/Users/user/x\n"); assert.strictEqual(scan(d).findings.length, 0); });
t('a bundled config with a webhook value is caught', () => { const d = cleanTree(); put(d, 'overlay/digest-config.example.json', JSON.stringify({ enabled: false, webhookUrl: 'https://example.invalid/hook', intervalHours: 6 })); assert.ok(has(scan(d), /not hollow: non-empty webhookUrl/)); });
t('a bundled config with members / clan tag / role mention is caught', () => {
  let d = cleanTree(); put(d, 'overlay/clan-hiscores-config.example.json', JSON.stringify({ enabled: false, webhookUrl: '', clanTag: 'ABC', members: ['A', 'B'] }));
  const r = scan(d); assert.ok(has(r, /non-empty members/)); assert.ok(has(r, /non-empty clanTag/));
  d = cleanTree(); put(d, 'overlay/digest-config.example.json', JSON.stringify({ roleMentions: { pet: '<@&' + '1'.repeat(18) + '>' } })); assert.ok(has(scan(d), /role mention/));
});
t('the personal-name deny-list catches a term, as a whole word only, and never echoes it', () => {
  const d = cleanTree(); put(d, 'overlay/supervisor.js', '// written by ' + FAKE_USER.replace('_', '') + '\n');
  const r = scan(d, { denyTerms: [FAKE_USER.replace('_', '')] }); assert.ok(has(r, /deny-list/)); assert.ok(!JSON.stringify(r).includes(FAKE_USER.replace('_', '')));
  const d2 = cleanTree(); put(d2, 'overlay/supervisor.js', '// recalledx ' + FAKE_USER.replace('_', '') + 'ing\n');
  assert.ok(!has(scan(d2, { denyTerms: [FAKE_USER.replace('_', '')] }), /deny-list/), 'substring of a longer word must not match');
});
t('the deny-list is read from env, a file outside the repo and the OS/git identity (never from a repo file)', () => {
  const f = path.join(tmpRoot, 'deny.txt'); fs.writeFileSync(f, '# comment\nfilelisted_term\nab\n');
  const keep = { a: process.env.SCAPELITE_DENY_TERMS, b: process.env.SCAPELITE_DENY_FILE };
  process.env.SCAPELITE_DENY_TERMS = 'envlisted_term'; process.env.SCAPELITE_DENY_FILE = f;
  try { const terms = guard.denyTerms(tmpRoot); assert.ok(terms.includes('envlisted_term') && terms.includes('filelisted_term')); assert.ok(!terms.includes('ab'), 'too short'); assert.ok(!terms.includes('wulf'), 'generic'); }
  finally { process.env.SCAPELITE_DENY_TERMS = keep.a || ''; if (keep.b === undefined) delete process.env.SCAPELITE_DENY_FILE; else process.env.SCAPELITE_DENY_FILE = keep.b; if (!keep.a) delete process.env.SCAPELITE_DENY_TERMS; }
  try { const me = os.userInfo().username.toLowerCase(); if (me.length >= 4 && !/^(user|admin|administrator|runner|root|ubuntu|test|tester)$/.test(me)) assert.ok(guard.denyTerms(tmpRoot).includes(me), 'OS user name missing'); } catch (e) { if (e.name === 'AssertionError') throw e; }
});
t('a require() that the allow-list left out of the package is caught (relative and bare)', () => {
  const d = cleanTree(); put(d, 'overlay/supervisor.js', "const a = require('./not-shipped');\nconst b = require('express');\nconst c = require('fs');\ntry { require('../roadmap/server'); } catch (e) {}\n");
  const r = scan(d); const miss = r.findings.filter((f) => /require\(\) target missing/.test(f.cls));
  assert.strictEqual(miss.length, 2, miss.map((m) => m.cls).join(' | '));
  assert.deepStrictEqual(scan(cleanTree()).findings, []);
});
t('an oversized file is caught', () => { const d = cleanTree(); put(d, 'overlay/big.js', '//' + 'x'.repeat(2 * 1024 * 1024)); assert.ok(has(scan(d), /oversized/)); });
t('source mode: dev folders are fine, state/config files and secrets are not', () => {
  const d = cleanTree(); put(d, 'roadmap/roadmap.json', '{}'); put(d, 'scripts/a.js', 'x'); put(d, 'docs/DISTRIBUTION-RISKS.md', '# x'); put(d, 'notes/x.md', 'x');
  assert.strictEqual(guard.scanTree(d, { mode: 'source', denyTerms: [] }).findings.length, 0);
  put(d, 'overlay/chat-relay-config.json', '{}'); put(d, 'docs/a.md', FAKE_WEBHOOK);
  const r = guard.scanTree(d, { mode: 'source', denyTerms: [] }); assert.ok(has(r, /user config file/)); assert.ok(has(r, /webhook URL/));
});
t('findings carry file + class + line but never the matched text', () => {
  const d = cleanTree(); put(d, 'overlay/supervisor.js', 'a\nb\n' + FAKE_WEBHOOK + '\n'); const r = scan(d);
  const f = r.findings.find((x) => /webhook URL/.test(x.cls)); assert.strictEqual(f.line, 3); assert.deepStrictEqual(Object.keys(f).sort(), ['cls', 'file', 'line']);
});

let asar = null; try { asar = require('@electron/asar'); } catch (e) { /* optional */ }
if (asar) {
  t('an app.asar is listed and extracted: clean passes, a planted file fails', () => {
    const out = path.join(tmpRoot, 'asar-out'); const src = cleanTree();
    fs.mkdirSync(path.join(out, 'resources'), { recursive: true });
    return asar.createPackage(src, path.join(out, 'resources', 'app.asar')).then(() => {
      assert.strictEqual(guard.scanBuiltApp(out, { denyTerms: [] }).findings.length, 0);
      const bad = cleanTree(); put(bad, 'overlay/discord-test-webhook.json', '{}'); put(bad, 'overlay/supervisor.js', "x='" + FAKE_WEBHOOK + "'");
      const out2 = path.join(tmpRoot, 'asar-out2'); fs.mkdirSync(path.join(out2, 'resources'), { recursive: true });
      return asar.createPackage(bad, path.join(out2, 'resources', 'app.asar')).then(() => { const r = guard.scanBuiltApp(out2, { denyTerms: [] }); assert.ok(has(r, /webhook file/) && has(r, /webhook URL/)); });
    });
  });
} else section('(skip asar test: @electron/asar not installed)');
t('scanBuiltApp finds resources/app (asar off) and refuses an output with no app', () => {
  const out = path.join(tmpRoot, 'dir-out'); fs.cpSync(cleanTree(), path.join(out, 'resources', 'app'), { recursive: true });
  assert.strictEqual(guard.scanBuiltApp(out, { denyTerms: [] }).findings.length, 0);
  assert.throws(() => guard.scanBuiltApp(path.join(tmpRoot, 'nothing'), {}));
});

section('repository templates and first run');
const OVERLAY = path.join(root, 'overlay');
t('every shipped *.example.json is hollow (guard, first-run check, every Discord feature off)', () => {
  const FR = require('../overlay/first-run');
  for (const name of FR.TEMPLATES) {
    const txt = fs.readFileSync(path.join(OVERLAY, name + '.example.json'), 'utf8');
    assert.ok(FR.isHollow(txt), name + ' not hollow'); assert.deepStrictEqual(guard.jsonFindings(txt), [], name);
    const o = JSON.parse(txt);
    if ('enabled' in o) assert.strictEqual(o.enabled, false, name + ' must start disabled');
    if (o.channels) Object.keys(o.channels).forEach((k) => assert.strictEqual(o.channels[k].enabled, false, name + ' ' + k));
  }
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(OVERLAY, 'clan-hiscores-config.example.json'), 'utf8')).members, []);
});
t('first-run isHollow refuses a template with a webhook, members or a role id', () => {
  const FR = require('../overlay/first-run');
  assert.ok(!FR.isHollow(JSON.stringify({ webhookUrl: FAKE_WEBHOOK })));
  assert.ok(!FR.isHollow(JSON.stringify({ webhookUrl: 'whatever' })));
  assert.ok(!FR.isHollow(JSON.stringify({ members: ['a'] })));
  assert.ok(!FR.isHollow(JSON.stringify({ pingRoles: [{ roleId: '1', categories: [] }] })));
  assert.ok(!FR.isHollow('not json'));
  assert.ok(FR.isHollow(JSON.stringify({ webhookUrl: '', members: [], pingRoles: [] })));
});
t('first run creates the configs in SCAPELITE_HOME, never overwrites, and never writes next to the code', () => {
  const home = path.join(tmpRoot, 'home');
  const run = (code) => execFileSync(process.execPath, ['-e', code], { cwd: root, env: Object.assign({}, process.env, { SCAPELITE_HOME: home }), encoding: 'utf8' });
  const o1 = JSON.parse(run("process.stdout.write(JSON.stringify(require('./overlay/first-run').ensureUserConfigs()))"));
  assert.strictEqual(o1.created.length, 6, JSON.stringify(o1));
  for (const f of o1.created) assert.ok(fs.existsSync(path.join(home, f)), f);
  fs.writeFileSync(path.join(home, 'digest-config.json'), '{"mine":true}');
  const o2 = JSON.parse(run("process.stdout.write(JSON.stringify(require('./overlay/first-run').ensureUserConfigs()))"));
  assert.strictEqual(o2.created.length, 0); assert.strictEqual(fs.readFileSync(path.join(home, 'digest-config.json'), 'utf8'), '{"mine":true}');
  // the created copies hold nothing a template did not
  for (const f of o1.created) assert.deepStrictEqual(guard.jsonFindings(fs.readFileSync(path.join(home, f), 'utf8')), [], f);
});
t('an installed copy (resources/app) with no SCAPELITE_HOME defaults to the per-user folder, never to the program folder', () => {
  const fake = path.join(tmpRoot, 'Program', 'resources', 'app'); fs.cpSync(OVERLAY, path.join(fake, 'overlay'), { recursive: true, filter: (s) => /paths\.js$|overlay$/.test(s) });
  const env = Object.assign({}, process.env, { APPDATA: path.join(tmpRoot, 'Roaming') }); delete env.SCAPELITE_HOME;
  const out = execFileSync(process.execPath, ['-e', "const p=require(" + JSON.stringify(path.join(fake, 'overlay', 'paths.js')) + ");process.stdout.write(JSON.stringify({i:p.INSTALLED,h:p.HOME,s:p.state('x.json'),l:p.logs}))"], { env, encoding: 'utf8' });
  const o = JSON.parse(out); assert.strictEqual(o.i, true); assert.strictEqual(o.h, path.join(tmpRoot, 'Roaming', 'ScapeLite')); assert.ok(o.s.startsWith(o.h) && !o.s.startsWith(fake));
  const src = JSON.parse(execFileSync(process.execPath, ['-e', "const p=require('./overlay/paths');process.stdout.write(JSON.stringify({i:p.INSTALLED,h:p.HOME}))"], { cwd: root, env: (() => { const e = Object.assign({}, process.env); delete e.SCAPELITE_HOME; return e; })(), encoding: 'utf8' }));
  assert.strictEqual(src.i, false); assert.strictEqual(src.h, null);
});
t('package.json: build.files starts as an allow-list (excludes everything first) and names no private file as included', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
  assert.strictEqual(b.files[0], '!**/*'); assert.ok(b.afterPack && fs.existsSync(path.join(root, b.afterPack)));
  const inc = b.files.filter((p) => !p.startsWith('!')).join(' ');
  assert.ok(!/roadmap|notes|design-lab|scripts|graphify|Logs|data\/|public\//.test(inc), inc);
  assert.ok(!/overlay\/\*\*/.test(inc), 'overlay/** would re-open the deny-list problem');
});

(async () => {
  for (const [name, fn] of queue) {
    if (name === null) { console.log(fn); continue; }
    try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' -- ' + (e && e.message)); }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
