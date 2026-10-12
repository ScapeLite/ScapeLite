// ScapeLite game-data extractor. Reads the game's own app.asar (a plain archive: JSON index + file blob) directly,
// with no helper tools or downloads, and writes the reference data ScapeLite needs:
//   shared/data/*  + shared/Constants.js  -> data/raw/
//   assets/icons/{skills,items}           -> public/assets/icons/
// It remembers the asar's size + date (data/raw/.source.json), so it only runs on first start and after a game update.
// Read-only on the game folder; never writes outside this project.
'use strict';

// Inside Electron the normal fs treats .asar files as virtual folders; the game's archive must be read as a plain file.
let fs; try { fs = require('original-fs'); } catch (e) { fs = require('fs'); }
const path = require('path');
const launcher = require('./launcher');

const ROOT = path.join(__dirname, '..');
const P = require('./paths');
const RAW = P.dataRaw;
const ICONS = P.icons;
const STAMP = path.join(RAW, '.source.json');
const state = { phase: 'idle', message: '', files: 0, icons: 0, startedAt: null, finishedAt: null, error: null, asar: null, lastExtractedAt: null };

function readHeader(fd) {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);   // pickle: bytes after the first 8
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  fs.readSync(fd, json, 0, jsonLen, 16);
  return { header: JSON.parse(json.toString('utf8')), base: 8 + headerSize };
}
function* walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (child.files) yield* walk(child, p); else yield [p, child];
  }
}
function nodeAt(header, p) {
  let n = header;
  for (const part of p.split('/').filter(Boolean)) { n = n.files && n.files[part]; if (!n) return null; }
  return n;
}
function writeFileFrom(fd, base, asarPath, rel, file, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (file.unpacked) { fs.copyFileSync(path.join(asarPath + '.unpacked', rel), dest); return; }
  const size = file.size, offset = base + Number(file.offset);
  const out = fs.openSync(dest, 'w');
  try {
    const buf = Buffer.alloc(Math.min(size, 1 << 20));
    for (let done = 0; done < size;) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - done), offset + done);
      if (n <= 0) break;
      fs.writeSync(out, buf, 0, n); done += n;
    }
  } finally { fs.closeSync(out); }
}

function stampOf(asarPath) { const s = fs.statSync(asarPath); return { size: s.size, mtimeMs: Math.round(s.mtimeMs) }; }
function needsExtract(asarPath) {
  try {
    if (!fs.existsSync(path.join(RAW, 'Constants.js'))) return 'missing';
    const st = JSON.parse(fs.readFileSync(STAMP, 'utf8')), cur = stampOf(asarPath);
    return st.size === cur.size && st.mtimeMs === cur.mtimeMs ? false : 'game updated';
  } catch (e) { return 'unknown'; }
}

function extract(asarPath) {
  state.phase = 'extracting'; state.error = null; state.startedAt = Date.now(); state.files = 0; state.icons = 0; state.message = 'Reading game data…';
  const fd = fs.openSync(asarPath, 'r');
  try {
    const { header, base } = readHeader(fd);
    const tmp = RAW + '.new';
    fs.rmSync(tmp, { recursive: true, force: true });
    // shared/data/** -> data/raw/**, plus Constants.js
    const dataNode = nodeAt(header, 'shared/data');
    if (!dataNode) throw new Error('This game version has no shared/data folder (unexpected archive layout).');
    for (const [rel, file] of walk(dataNode, '')) { writeFileFrom(fd, base, asarPath, 'shared/data/' + rel, file, path.join(tmp, rel)); state.files++; }
    const consts = nodeAt(header, 'shared/Constants.js');
    if (consts) { writeFileFrom(fd, base, asarPath, 'shared/Constants.js', consts, path.join(tmp, 'Constants.js')); state.files++; }
    // icons
    for (const sub of ['skills', 'items']) {
      const n = nodeAt(header, 'assets/icons/' + sub);
      if (!n) continue;
      for (const [rel, file] of walk(n, '')) { writeFileFrom(fd, base, asarPath, 'assets/icons/' + sub + '/' + rel, file, path.join(ICONS, sub, rel)); state.icons++; }
    }
    fs.writeFileSync(path.join(tmp, '.source.json'), JSON.stringify(Object.assign(stampOf(asarPath), { extractedAt: new Date().toISOString() })));
    fs.rmSync(RAW, { recursive: true, force: true });   // swap in only after everything was written
    fs.mkdirSync(path.dirname(RAW), { recursive: true });
    fs.renameSync(tmp, RAW);
    state.phase = 'done'; state.lastExtractedAt = Date.now(); state.message = 'Game data is up to date (' + state.files + ' data files, ' + state.icons + ' icons).';
  } finally { fs.closeSync(fd); state.finishedAt = Date.now(); }
}

// Runs the check (and the extraction if needed). Resolves { ok, extracted, reason }.
async function ensure(log, force) {
  const say = log || (() => {});
  try {
    const g = await launcher.findGame();
    if (!g || !g.root) { state.phase = 'idle'; state.message = 'Scapewatch is not installed (or not in a Steam library), so the game data could not be read.'; return { ok: fs.existsSync(path.join(RAW, 'Constants.js')), extracted: false, reason: 'no-game' }; }
    const asarPath = path.join(g.root, 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) { state.phase = 'error'; state.error = 'app.asar not found in the game folder.'; return { ok: false, extracted: false, reason: 'no-asar' }; }
    state.asar = asarPath;
    const why = force ? 'requested' : needsExtract(asarPath);
    if (!why) { state.phase = 'done'; state.message = 'Game data is up to date.'; return { ok: true, extracted: false, reason: 'current' }; }
    say('Game data: extracting from the game files (' + why + ')…');
    extract(asarPath);
    say('Game data: ' + state.message);
    return { ok: true, extracted: true, reason: why };
  } catch (e) {
    state.phase = 'error'; state.error = String(e && e.message || e); state.message = 'Could not read the game data.';
    say('Game data: ERROR -- ' + state.error);
    return { ok: false, extracted: false, reason: 'error' };
  }
}

const snapshot = () => JSON.parse(JSON.stringify(state));
module.exports = { ensure, snapshot, needsExtract };

if (require.main === module) { ensure(console.log, process.argv.includes('--force')).then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); }); }
