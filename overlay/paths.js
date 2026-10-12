// Where ScapeLite reads/writes. In a source checkout everything lives next to the code (unchanged behaviour). In the
// installed app, SCAPELITE_HOME points at the user's data folder (e.g. %APPDATA%/ScapeLite), so settings, logs and
// extracted game data survive updates and the program folder can stay read-only.
'use strict';
const path = require('path');

const APP = __dirname;                       // code + bundled read-only assets (catalog.json, examples, images)
const ROOT = path.join(__dirname, '..');
const HOME = process.env.SCAPELITE_HOME || null;
const base = HOME || APP;

module.exports = {
  APP, ROOT, HOME,
  state: (name) => path.join(base, name),                                   // per-user config / state files
  dataRaw: HOME ? path.join(HOME, 'data', 'raw') : path.join(ROOT, 'data', 'raw'),
  icons: HOME ? path.join(HOME, 'assets', 'icons') : path.join(ROOT, 'public', 'assets', 'icons'),
  logs: HOME ? path.join(HOME, 'Logs') : path.join(ROOT, 'Logs'),
  plugins: path.join(base, 'plugins'),                                      // drop-in community plugins
};
