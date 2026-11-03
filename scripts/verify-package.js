#!/usr/bin/env node
// Build-time guard: inspects a BUILT ScapeLite app and exits 1 when it holds anything that must never ship (user config/state, webhooks,
// personal names, dev folders, files outside the allow-list ...). See docs/PACKAGING.md and scripts/lib/package-guard.js.
//   node scripts/verify-package.js                 checks dist/win-unpacked (the unpacked output of `npm run pack` / `npm run dist`)
//   node scripts/verify-package.js <outDir>        checks another electron-builder output dir (the one that holds resources/)
//   node scripts/verify-package.js --source [dir]  checks a source tree (default: the repo's git-tracked files) with the source-mode rules
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const guard = require('./lib/package-guard');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);

function main() {
  if (args.includes('--source')) {
    let dir = args.find((a) => !a.startsWith('--'));
    let tmp = null;
    if (!dir) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scapelite-src-')); execSync('git archive HEAD | tar -x -C "' + tmp + '"', { cwd: root, shell: true }); dir = tmp; }
    try { const r = guard.scanTree(dir, { mode: 'source', root }); return guard.report(r); }
    finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'win-unpacked'));
  if (!fs.existsSync(out)) { console.error('package guard: ' + out + ' does not exist (run `npm run pack` first).'); return false; }
  return guard.report(guard.scanBuiltApp(out, { root }));
}
let ok = false;
try { ok = main(); } catch (e) { console.error('package guard: could not run -- ' + e.message); }
process.exit(ok ? 0 : 1);
