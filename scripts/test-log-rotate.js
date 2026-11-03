// npm run test:logrotate -- size-based rotation of watcher.log (overlay/log-rotate.js), in a temp folder.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rotateIfBig, backupName } = require('../overlay/log-rotate');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-rot-'));
const f = path.join(dir, 'watcher.log');
let pass = 0;
const t = (n, fn) => { fn(); pass++; console.log('  ok   ' + n); };

t('backup name keeps the .log ending (git-ignored)', () => assert.strictEqual(path.basename(backupName(f)), 'watcher.1.log'));
t('a missing file is not an error', () => assert.strictEqual(rotateIfBig(f, 10), false));
t('a small file is left alone', () => { fs.writeFileSync(f, 'abc'); assert.strictEqual(rotateIfBig(f, 10), false); assert.strictEqual(fs.readFileSync(f, 'utf8'), 'abc'); });
t('a big file becomes the backup and the log starts empty', () => {
  fs.writeFileSync(f, 'x'.repeat(50)); assert.strictEqual(rotateIfBig(f, 10), true);
  assert.ok(!fs.existsSync(f)); assert.strictEqual(fs.readFileSync(backupName(f), 'utf8'), 'x'.repeat(50));
});
t('a second rotation replaces the backup (never more than one)', () => {
  fs.writeFileSync(f, 'y'.repeat(60)); assert.strictEqual(rotateIfBig(f, 10), true);
  assert.strictEqual(fs.readFileSync(backupName(f), 'utf8'), 'y'.repeat(60)); assert.deepStrictEqual(fs.readdirSync(dir), ['watcher.1.log']);
});
t('exactly at the limit does not rotate', () => { fs.writeFileSync(f, 'z'.repeat(10)); assert.strictEqual(rotateIfBig(f, 10), false); });

fs.rmSync(dir, { recursive: true, force: true });
console.log(pass + ' passed, 0 failed');
