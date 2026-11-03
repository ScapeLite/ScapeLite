// Where ScapeLite reads/writes. In a source checkout everything lives next to the code (unchanged behaviour). In the
// installed app, SCAPELITE_HOME points at the user's data folder (e.g. %APPDATA%/ScapeLite), so settings, logs and
// extracted game data survive updates and the program folder can stay read-only.
'use strict';
const path = require('path');
const os = require('os');

const APP = __dirname;                       // code + bundled read-only assets (catalog.json, examples, images)
const ROOT = path.join(__dirname, '..');
// An installed copy lives in <install dir>/resources/app (electron-builder, asar off). There the per-user folder is MANDATORY: if
// the launcher forgot SCAPELITE_HOME we default to %APPDATA%/ScapeLite instead of falling back to files next to the code
// (the program folder is product only, never a place for user data). A source checkout keeps its state in overlay/ (git-ignored).
const INSTALLED = /[\\/]resources[\\/]app(\.asar)?[\\/]?$/i.test(ROOT);
const HOME = process.env.SCAPELITE_HOME || (INSTALLED ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ScapeLite') : null);
const base = HOME || APP;
const STATE_DIR = path.join(base, 'State');   // runtime state the watcher rewrites all the time (dedup keys, digest buffer, hiscores baseline)

// One-time move of runtime state files from the config folder into State/. Each file is COPIED, checked, and only then the old one is renamed to
// <name>.moved (kept as a safety copy, git-ignored and never packaged). A file that cannot be moved stays where it is and its old path is used.
// Returns { paths: {name: pathToUse}, notes: [text] } -- the caller logs the notes once its logger exists.
function migrateRuntime(names) {
  const fs = require('fs');
  const out = { paths: {}, notes: [] };
  let dirOk = true;
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch (e) { dirOk = false; out.notes.push('State folder could not be created (' + (e.code || e.message) + '): the state files stay where they were.'); }
  for (const name of names) {
    const oldMain = path.join(base, name), newMain = path.join(STATE_DIR, name);
    out.paths[name] = oldMain;
    if (!dirOk) continue;
    let ok = true;
    for (const suf of ['', '.bak']) {
      const from = oldMain + suf, to = newMain + suf;
      let hasOld = false;
      try { hasOld = fs.statSync(from).isFile(); } catch (e) { /* nothing to move */ }
      if (!hasOld) continue;
      if (fs.existsSync(to)) { if (!suf) out.notes.push(name + ': found in both places, using State/ (the old copy is left untouched).'); continue; }
      try {
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(from).size !== fs.statSync(to).size) throw new Error('copy size mismatch');
        if (!suf && fs.statSync(to).size > 0) JSON.parse(fs.readFileSync(to, 'utf8'));
        try { fs.unlinkSync(from + '.moved'); } catch (e) { /* none yet */ }
        fs.renameSync(from, from + '.moved');
        if (!suf) out.notes.push(name + ': moved into State/ (old copy kept as ' + name + '.moved).');
      } catch (e) {
        ok = false;
        try { fs.unlinkSync(to); } catch (e2) { /* not created */ }
        out.notes.push(name + suf + ': could not be moved (' + (e.code || e.message) + '), the old location is used.');
      }
    }
    if (ok) out.paths[name] = newMain;
  }
  return out;
}

module.exports = {
  APP, ROOT, HOME, INSTALLED,
  state: (name) => path.join(base, name),                                   // per-user config / state files
  stateDir: STATE_DIR,
  runtime: (name) => path.join(STATE_DIR, name),                            // runtime state files (see migrateRuntime)
  migrateRuntime,
  dataRaw: HOME ? path.join(HOME, 'data', 'raw') : path.join(ROOT, 'data', 'raw'),
  icons: HOME ? path.join(HOME, 'assets', 'icons') : path.join(ROOT, 'public', 'assets', 'icons'),
  logs: HOME ? path.join(HOME, 'Logs') : path.join(ROOT, 'Logs'),
  plugins: path.join(base, 'plugins'),                                      // drop-in community plugins
};
