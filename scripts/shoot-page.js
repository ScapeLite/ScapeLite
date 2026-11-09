// Screenshot helper for design review: renders a local HTML file in an off-screen Electron window and writes a PNG.
//   node scripts/shoot-page.js <file.html> <out.png> [width] [height]
// Used by the default-layout preview (docs/default-layout-preview.png). Touches nothing of ScapeLite or the game.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
if (process.argv[2] === '--host') {
  // child side: runs inside Electron
  const { app, BrowserWindow } = require('electron');
  const [, , , file, out, W, H] = process.argv;
  app.disableHardwareAcceleration();
  app.whenReady().then(() => {
    const w = new BrowserWindow({ show: false, width: Number(W) || 1280, height: Number(H) || 800, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
    w.webContents.on('did-finish-load', () => setTimeout(async () => {
      try { const img = await w.webContents.capturePage(); fs.writeFileSync(out, img.toPNG()); console.log('wrote ' + out + ' ' + img.getSize().width + 'x' + img.getSize().height); } catch (e) { console.error(String(e)); process.exitCode = 1; }
      app.quit();
    }, 700));
    w.loadFile(path.resolve(file));
  });
  app.on('window-all-closed', () => app.quit());
} else {
  const [, , file, out, W, H] = process.argv;
  if (!file || !out) { console.error('usage: node scripts/shoot-page.js <file.html> <out.png> [width] [height]'); process.exit(1); }
  const electron = require('electron'), env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shoot-'));
  const r = cp.spawnSync(electron, [__filename, '--host', file, out, W || '1280', H || '800', '--user-data-dir=' + udd], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) { /* in use */ }
  process.exit(fs.existsSync(out) ? 0 : 1);
}
