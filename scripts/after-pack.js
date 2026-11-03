// electron-builder afterPack hook (package.json build.afterPack): runs the leak guard on the freshly packed app BEFORE the installer is
// made, so a forbidden file or a secret fails the build. Nothing is uploaded here; see docs/PACKAGING.md.
'use strict';
const guard = require('./lib/package-guard');
exports.default = async function afterPack(context) {
  const r = guard.scanBuiltApp(context.appOutDir, {});
  const lines = [];
  const ok = guard.report(r, (l) => lines.push(l));
  lines.forEach((l) => console.log('  • ' + l));
  if (!ok) throw new Error('package guard failed: the app must not contain the files listed above. Fix the build.files allow-list or remove the file, then build again.');
};
