// Install community plugins from a GitHub link (or list / remove the ones already installed). Runs inside the dashboard
// server and only on the player's explicit request. A plugin is a folder with plugin.json + a script; this downloads those
// few small text files from raw.githubusercontent.com into the user's plugins folder. It never executes anything itself:
// the plugin only runs if the player later presses Add in the marketplace. Plugins run inside the game page, so the
// preview shows what the code can do (network, eval, ...) before anything is written.
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./paths');

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const MAX_FILE = 400 * 1024;
const MAX_FILES = 10;
const TEXT_EXT = /\.(js|css|json|svg|txt|md)$/i;
const BUNDLED_IDS = () => { try { return new Set((JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).plugins || []).map((p) => p.id)); } catch (e) { return new Set(); } };

function parseSource(url) {
  const m = String(url || '').trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/);
  if (!m) throw new Error('Use a GitHub link like https://github.com/owner/repo (or .../tree/branch/folder).');
  return { owner: m[1], repo: m[2], ref: m[3] || '', sub: (m[4] || '').replace(/^\/+|\/+$/g, '') };
}
const safeRel = (rel) => typeof rel === 'string' && rel.length < 120 && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..') && !/^[a-z]+:/i.test(rel) && TEXT_EXT.test(rel);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'ScapeLite-plugin-installer' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FILE) throw new Error('A file is larger than ' + Math.round(MAX_FILE / 1024) + ' KB, which is not allowed for plugins.');
  return buf.toString('utf8');
}

async function load(url) {
  const src = parseSource(url);
  const refs = src.ref ? [src.ref] : ['main', 'master'];
  let manifest = null, base = null, lastErr = null;
  for (const ref of refs) {
    base = 'https://raw.githubusercontent.com/' + src.owner + '/' + src.repo + '/' + ref + '/' + (src.sub ? src.sub + '/' : '');
    try { manifest = JSON.parse(await fetchText(base + 'plugin.json')); break; } catch (e) { lastErr = e; manifest = null; }
  }
  if (!manifest) throw new Error('Could not find a plugin.json in that repository' + (src.sub ? ' folder' : '') + ' (' + (lastErr && lastErr.message || 'not found') + ').');
  if (!manifest.id || !ID_RE.test(manifest.id)) throw new Error('plugin.json needs an "id" of lowercase letters, digits and dashes.');
  if (BUNDLED_IDS().has(manifest.id)) throw new Error('"' + manifest.id + '" is the id of a built-in ScapeLite plugin; pick another id.');
  if (!safeRel(manifest.main)) throw new Error('plugin.json "main" must be a relative .js file inside the plugin folder.');
  const rels = [manifest.main].concat(Array.isArray(manifest.files) ? manifest.files : []);
  if (rels.length > MAX_FILES || !rels.every(safeRel)) throw new Error('plugin.json lists too many files, or a file path that is not allowed.');
  const files = {};
  for (const rel of [...new Set(rels)]) files[rel] = await fetchText(base + rel);
  return { src, manifest, files, base };
}

// What the code can do, so the player can decide. Heuristic: it flags capabilities, it does not prove safety.
function scan(code) {
  const flags = [];
  const t = (re, msg) => { if (re.test(code)) flags.push(msg); };
  t(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'Makes network requests');
  t(/\beval\s*\(|new\s+Function\s*\(|importScripts|document\.write/, 'Runs dynamically built code (eval / new Function)');
  t(/document\.cookie|localStorage\.(getItem|setItem)\(\s*['"](?!cc-plugin-)/, 'Reads or writes browser storage outside its own cc-plugin-* keys');
  t(/\.click\(\s*\)|dispatchEvent\s*\(|\.submit\s*\(/, 'Triggers clicks / events (not allowed for ScapeLite plugins: they must be display-only)');
  t(/https?:\/\/(?!localhost)/, 'Contains web addresses');
  return flags;
}

async function preview(url) {
  const { src, manifest, files } = await load(url);
  const code = files[manifest.main];
  return { ok: true, id: manifest.id, name: manifest.name || manifest.id, version: manifest.version || '', author: manifest.author || src.owner, description: manifest.description || manifest.tagline || '',
    source: 'https://github.com/' + src.owner + '/' + src.repo, files: Object.keys(files).map((f) => ({ file: f, bytes: Buffer.byteLength(files[f]) })), flags: scan(code), exists: fs.existsSync(path.join(P.plugins, manifest.id)) };
}

async function install(url) {
  const { src, manifest, files } = await load(url);
  const dir = path.join(P.plugins, manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  const out = Object.assign({}, manifest, { category: manifest.category || 'Community', author: manifest.author || src.owner });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(out, null, 2));
  for (const [rel, text] of Object.entries(files)) { const dest = path.join(dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); }
  fs.writeFileSync(path.join(dir, '.source.json'), JSON.stringify({ url: String(url).trim(), installedAt: new Date().toISOString() }));
  return { ok: true, id: manifest.id, name: manifest.name || manifest.id, restartNeeded: true };
}

function remove(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('bad id');
  const dir = path.join(P.plugins, id);
  if (!fs.existsSync(path.join(dir, 'plugin.json'))) throw new Error('That plugin is not installed in your plugins folder.');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, id, restartNeeded: true };
}

function openFolder() {
  fs.mkdirSync(P.plugins, { recursive: true });
  require('child_process').spawn('explorer.exe', [P.plugins], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, dir: P.plugins };
}

function community() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'community.json'), 'utf8')); } catch (e) { return { plugins: [] }; } }

module.exports = { preview, install, remove, openFolder, community, pluginsDir: () => P.plugins };
