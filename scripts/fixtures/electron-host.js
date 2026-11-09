// Tiny Electron main process for the card tests (scripts/test-cards.js): opens ONE hidden window on a local fixture page with a remote-debugging port,
// separate from the game (own user-data folder, own port). It touches nothing of ScapeLite or the game. Started and stopped by the test harness only.
//   electron scripts/fixtures/electron-host.js <fixture.html> <port> <userDataDir>
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const [, , page, port, userData] = process.argv;
if (userData) app.setPath('userData', userData);
app.commandLine.appendSwitch('remote-debugging-port', String(port || 9333));
app.commandLine.appendSwitch('remote-allow-origins', '*');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  // CC_FIXTURE_SHOW=1 (the bar-fit test): a window that is shown, but far off screen and not focusable, so the page really draws frames (resize observers and animation frames run) without anything appearing for the user
  const shown = process.env.CC_FIXTURE_SHOW === '1';
  const w = new BrowserWindow(shown ? { show: true, width: 1280, height: 800, x: -12000, y: -12000, focusable: false, skipTaskbar: true, webPreferences: { backgroundThrottling: false, contextIsolation: true } }
    : { show: false, width: 1280, height: 800, x: 0, y: 0, webPreferences: { backgroundThrottling: false, contextIsolation: true } });
  w.loadFile(path.resolve(page));
});
app.on('window-all-closed', () => app.quit());
