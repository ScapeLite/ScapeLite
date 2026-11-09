// Shared leak guard for packages and publishes. Used by scripts/verify-package.js (built output), scripts/after-pack.js (electron-builder
// hook: a failing check fails the build), scripts/publish-release.js (files about to be published) and scripts/test-package.js (self-test).
//
// Two modes:
//   'package'  the contents of a built app (resources/app or an unpacked app.asar): an ALLOW-LIST of what may exist, plus every content rule
//   'source'   a source tree about to be published: content rules and "state/config/secret file" names only (roadmap/, docs/ ... are fine there)
//
// Findings never contain the matched text: only the file, the rule class and (for text hits) the line number.
// The personal-name deny-list is NEVER kept in the repo. Sources: env SCAPELITE_DENY_TERMS (comma separated), a file named by
// SCAPELITE_DENY_FILE or ~/.scapelite-deny.txt (one term per line, # comments), release.local.json "scrubTerms" (git-ignored), and values
// derived at run time (OS user name, git user.name / user.email).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MB = 1024 * 1024;
const LIMITS = { file: 1.5 * MB, totalNoModules: 30 * MB };

// ---- allow-list (package mode) ------------------------------------------------------------------------------------------------
const TOP_ALLOWED = new Set(['package.json', 'app', 'branding', 'overlay', 'website', 'examples', 'docs', 'node_modules']);
const DOCS_ALLOWED = new Set(['PLUGINS.md', 'SUBMIT-A-PLUGIN.md', 'PLUGIN-AUTHOR-GUIDE.md', 'DISCORD-RELAY-SETUP.md']);
const ALLOW = [
  [/^package\.json$/, 'package.json'],
  [/^app\/main\.js$/, 'app/main.js'],
  [/^branding\/(?:[\w.-]+\.svg|png\/[\w.-]+\.png)$/, 'branding'],
  [/^overlay\/[\w.-]+\.js$/, 'overlay module'],
  [/^overlay\/logging\/[\w.-]+\.js$/, 'overlay/logging'],
  [/^overlay\/cards\/[\w.-]+\.js$/, 'overlay/cards'],
  [/^overlay\/(?:catalog|community|app-info)\.json$/, 'overlay catalog'],
  [/^overlay\/[\w-]+\.example\.json$/, 'hollow template'],
  [/^overlay\/[\w.-]+\.png$/, 'overlay image'],
  [/^overlay\/catalog-img\/[\w.-]+\.png$/, 'catalog image'],
  [/^website\/.+\.(?:html|js|css|json|png|svg)$/, 'website'],
  [/^examples\/plugins\/.+\.(?:js|json|md)$/, 'plugin example'],
  [/^docs\/[\w.-]+\.md$/, 'doc'],
];

// ---- forbidden names (both modes) ---------------------------------------------------------------------------------------------
// [regex on the lower-cased relative path, class, optional 'pkg' = package mode only]. The rules apply to every path except inside node_modules (see NM_NAME_RULES).
const NAME_RULES = [
  [/(^|\/)[\w.-]*-config\.json$/, 'user config file'],
  [/(^|\/)[\w.-]*-state\.json$/, 'user state file'],
  [/(^|\/)[\w.-]*(?:-seen|-outbox|-pending|-levels)\.json$/, 'relay/user state file'],
  [/(^|\/)[\w.-]*webhook[\w.-]*$/, 'webhook file'],
  [/(^|\/)[\w.-]*\.local\.json$/, 'local override file'],
  [/(^|\/)player-icon-cache\.json$/, 'user cache file'],
  [/\.(?:bak|tmp|lock|log|corrupt|orig|rej|moved)$/, 'backup/temp/lock/log file'],
  [/(^|\/)(?:nul|con|prn|aux)(\.[^/]*)?$/, 'reserved Windows name'],
  [/(^|\/)\.env(\..*)?$/, 'env file'],
  [/(^|\/)release\.local\.json$/, 'release credentials'],
  [/(^|\/)(?:logs|state|roadmap|notes|design-lab|graphify-out|dist|\.git|\.github|\.claude|\.vscode|\.idea|coverage)\//, 'dev-only or runtime folder', 'pkg'],
  [/(^|\/)(?:data\/raw|data\/profile\.json|public\/assets)(\/|$)/, 'extracted game data or personal profile', 'pkg'],
  [/(^|\/)(?:scripts|tests?)\//, 'scripts/tests folder', 'pkg'],
  [/(^|\/)[\w.-]*\.(?:pem|key|pfx|p12|ppk)$/, 'key/certificate file'],
  [/(^|\/)id_(?:rsa|ed25519|ecdsa)(\.pub)?$/, 'ssh key'],
  [/(^|\/)tray\d*\.png$/, 'stray screenshot', 'pkg'],
];
const NM_NAME_RULES = [
  [/(^|\/)[\w.-]*webhook[\w.-]*\.json$/, 'webhook file'],
  [/(^|\/)\.env(\..*)?$/, 'env file'],
  [/(^|\/)[\w.-]*(?:-config|-state)\.json$/, 'user config/state file'],
];

// ---- content rules ------------------------------------------------------------------------------------------------------------
const WEBHOOK_RE = /discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{15,}\/[A-Za-z0-9_-]{20,}/;
const BOT_TOKEN_RE = /\b[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}\b/;
const KEYED_RE = /["']?\b(token|webhook|secret|password|passwd|apikey|api_key|authorization|bearer)["']?\s*[:=]\s*["']([A-Za-z0-9+\/_.=-]{24,})["']/gi;
const WINPATH_RE = /[A-Za-z]:(?:\\{1,4}|\/)Users(?:\\{1,4}|\/)([^\\\/\s"'`<>|*?:;,()[\]{}]+)/g;
const PLACEHOLDER_USERS = new Set(['you', 'user', 'users', 'username', 'yourname', 'your-name', 'name', 'example', 'alice', 'bob', 'public', 'default', 'all', 'admin', 'administrator', 'someone', 'me', 'home', 'runner', 'x', 'xxx', 'test', 'foo', 'tester', 'player']);
const JSON_SECRET_KEYS = /webhook|^roleid$|^clantag$|^token$|^secret$|^password$|^apikey$/i;
const GENERIC_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'runner', 'root', 'ubuntu', 'github', 'actions', 'scapelite', 'wulf', 'claude', 'anthropic', 'noreply', 'default', 'public', 'owner', 'name', 'test', 'tester', 'developer', 'localhost']);

const TEXT_EXT = /\.(?:js|json|md|html|css|svg|txt|yml|yaml|vbs|cmd|bat|ps1|xml|csv|map|d\.ts|mjs|cjs|ts)$/i;
const looksRandom = (s) => /\d/.test(s) && /[A-Za-z]/.test(s) && new Set(s).size >= 10 && !/^(.)\1+$/.test(s) && !/x{6,}|y{6,}|placeholder|example|your[-_ ]?|<.*>/i.test(s);

// ---- deny-list (personal names) -----------------------------------------------------------------------------------------------
function denyTerms(root, extra) {
  const set = new Set();
  const add = (t) => { t = String(t || '').trim().toLowerCase(); if (t.length >= 4 && !GENERIC_NAMES.has(t)) set.add(t); };
  (extra || []).forEach(add);
  String(process.env.SCAPELITE_DENY_TERMS || '').split(',').forEach(add);
  const files = [process.env.SCAPELITE_DENY_FILE, path.join(os.homedir(), '.scapelite-deny.txt')].filter(Boolean);
  for (const f of files) { try { fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).forEach(add); } catch (e) { /* none */ } }
  try { (JSON.parse(fs.readFileSync(path.join(root || '.', 'release.local.json'), 'utf8')).scrubTerms || []).forEach(add); } catch (e) { /* none */ }
  try { add(os.userInfo().username); } catch (e) { /* none */ }
  for (const key of ['user.name', 'user.email']) {
    try {
      const v = execFileSync('git', ['config', '--get', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      add(v); add(v.split('@')[0].replace(/^\d+\+/, ''));
    } catch (e) { /* no git identity */ }
  }
  return [...set];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function denyRegex(terms) {
  if (!terms.length) return null;
  return new RegExp('(?<![a-z0-9])(?:' + terms.map(esc).join('|') + ')(?![a-z0-9])', 'i');
}

// ---- scanning -----------------------------------------------------------------------------------------------------------------
function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { out.push({ rel: r + '/', dir: true }); walk(path.join(dir, e.name), r, out); }
    else out.push({ rel: r, abs: path.join(dir, e.name), size: (() => { try { return fs.statSync(path.join(dir, e.name)).size; } catch (x) { return 0; } })() });
  }
  return out;
}

function jsonFindings(text) {
  const bad = [];
  let o; try { o = JSON.parse(text); } catch (e) { return bad; }
  (function go(v, key) {
    if (Array.isArray(v)) { if (/^(members|pingroles)$/i.test(key) && v.length) bad.push('non-empty ' + key); v.forEach((x) => go(x, key)); }
    else if (v && typeof v === 'object') { Object.keys(v).forEach((k) => go(v[k], k)); }
    else if (typeof v === 'string' && v) {
      if (JSON_SECRET_KEYS.test(key)) bad.push('non-empty ' + key);
      else if (/^rolemention/i.test(key) || /<@&\d{6,}>/.test(v)) bad.push('role mention');
    }
  })(o, '');
  return bad;
}

// opts: { mode: 'package'|'source', denyTerms: [...], root: <repo root for release.local.json>, noRuntimeDeny: bool }
function scanTree(dir, opts) {
  const o = Object.assign({ mode: 'package' }, opts || {});
  const findings = [], add = (file, cls, line) => findings.push({ file, cls, line: line || null });
  const deny = denyRegex(o.denyTerms || denyTerms(o.root || path.join(__dirname, '..', '..')));
  const entries = walk(dir, '', []);
  let total = 0;
  if (o.mode === 'package') {
    for (const e of fs.readdirSync(dir)) if (!TOP_ALLOWED.has(e)) add(e, 'top-level entry not in the allow-list');
    if (fs.existsSync(path.join(dir, 'docs'))) for (const e of fs.readdirSync(path.join(dir, 'docs'))) if (!DOCS_ALLOWED.has(e)) add('docs/' + e, 'doc not in the allow-list');
  }
  for (const f of entries) {
    const inNM = /^node_modules\//.test(f.rel);
    const low = f.rel.toLowerCase();
    // names
    for (const [re, cls, only] of (inNM ? NM_NAME_RULES : NAME_RULES)) if ((!only || o.mode === 'package') && re.test(low)) { add(f.rel, cls); break; }
    if (f.dir) continue;
    if (o.mode === 'package' && !inNM && !ALLOW.some(([re]) => re.test(f.rel))) add(f.rel, 'file not in the allow-list');
    if (!inNM) total += f.size;
    if (!inNM && f.size > LIMITS.file && !(o.mode === 'source')) add(f.rel, 'oversized file (' + Math.round(f.size / 1024) + ' KB)');
    // content
    if (!TEXT_EXT.test(f.rel) || f.size > 8 * MB) continue;
    let text; try { text = fs.readFileSync(f.abs, 'utf8'); } catch (e) { continue; }
    const lines = text.split(/\r?\n/);
    const hit = (re, cls) => { for (let i = 0; i < lines.length; i++) { re.lastIndex = 0; if (re.test(lines[i])) { add(f.rel, cls, i + 1); return true; } } return false; };
    hit(WEBHOOK_RE, 'Discord webhook URL');
    if (!inNM) {
      hit(BOT_TOKEN_RE, 'Discord bot-token-like string');
      for (let i = 0; i < lines.length; i++) {
        KEYED_RE.lastIndex = 0; let m;
        while ((m = KEYED_RE.exec(lines[i]))) if (looksRandom(m[2])) { add(f.rel, 'long random value next to a secret-like key', i + 1); break; }
        WINPATH_RE.lastIndex = 0;
        while ((m = WINPATH_RE.exec(lines[i]))) { const n = m[1].toLowerCase(); if (!PLACEHOLDER_USERS.has(n) && !/^[<%$@{]/.test(m[1])) { add(f.rel, 'real-looking Windows user path', i + 1); break; } }
      }
    }
    if (deny) { const i = lines.findIndex((l) => deny.test(l)); if (i >= 0) add(f.rel, 'personal-name deny-list term', i + 1); }
    if (!inNM && /\.json$/i.test(f.rel) && /(config|state|example|settings)/i.test(path.basename(f.rel))) {
      for (const b of jsonFindings(text)) add(f.rel, 'bundled config is not hollow: ' + b);
    }
  }
  if (o.mode === 'package') for (const m of missingRequires(dir, entries)) add(m.file, 'require() target missing from the package: ' + m.target, m.line);
  if (o.mode === 'package' && total > LIMITS.totalNoModules) add('(whole package)', 'package outside node_modules is ' + Math.round(total / MB) + ' MB, over the ' + Math.round(LIMITS.totalNoModules / MB) + ' MB budget');
  return { findings, files: entries.filter((e) => !e.dir).length, denyTermCount: deny ? 1 : 0 };
}

// The allow-list must not be tighter than what the code needs: every relative require() in app/ and overlay/ has to resolve inside the
// package (the two release-optional dev servers are exempt: status-server.js wraps them in try/catch), and bare requires must be
// Node built-ins, electron, or present in the package's node_modules.
const OPTIONAL_REQUIRES = new Set(['../design-lab/serve', '../roadmap/server']);
function missingRequires(dir, entries) {
  const have = new Set(entries.filter((e) => !e.dir).map((e) => e.rel));
  const builtin = new Set(require('module').builtinModules);
  const out = [];
  for (const f of entries) {
    if (f.dir || !/^(?:overlay|app)\/.*\.js$/.test(f.rel)) continue;
    const lines = fs.readFileSync(f.abs, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      const re = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g; let m;
      while ((m = re.exec(l))) {
        const spec = m[1];
        if (spec.startsWith('.')) {
          if (OPTIONAL_REQUIRES.has(spec)) continue;
          const base = path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), spec));
          if (![base, base + '.js', base + '.json', base + '/index.js'].some((c) => have.has(c))) out.push({ file: f.rel, line: i + 1, target: spec });
        } else {
          const pkg = spec.startsWith('node:') ? spec.slice(5) : spec;
          if (builtin.has(pkg) || builtin.has(pkg.split('/')[0]) || pkg === 'electron' || pkg === 'original-fs') continue;
          const root = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
          if (!have.has('node_modules/' + root + '/package.json')) out.push({ file: f.rel, line: i + 1, target: spec });
        }
      }
    });
  }
  return out;
}

// A built app: resources/app (asar off) or resources/app.asar (extracted to a temp dir for the scan). Returns { findings, scanned, kind }.
function scanBuiltApp(outDir, opts) {
  const res = path.join(outDir, 'resources');
  const dir = path.join(res, 'app'), asar = path.join(res, 'app.asar');
  if (fs.existsSync(dir)) { const r = scanTree(dir, Object.assign({}, opts, { mode: 'package' })); r.kind = 'dir'; r.scanned = dir; return r; }
  if (fs.existsSync(asar)) {
    const A = require('@electron/asar');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scapelite-asar-'));
    try { A.extractAll(asar, tmp); const r = scanTree(tmp, Object.assign({}, opts, { mode: 'package' })); r.kind = 'asar'; r.scanned = asar; r.listed = A.listPackage(asar).length; return r; }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  throw new Error('no resources/app or resources/app.asar under ' + outDir);
}

function report(r, log) {
  const say = log || console.log;
  if (!r.findings.length) { say('package guard: clean (' + r.files + ' files scanned' + (r.scanned ? ' in ' + (path.relative(process.cwd(), r.scanned) || r.scanned) : '') + ')'); return true; }
  say('package guard: ' + r.findings.length + ' problem(s)');
  const byCls = {};
  for (const f of r.findings) (byCls[f.cls] = byCls[f.cls] || []).push(f);
  for (const cls of Object.keys(byCls)) { say('  [' + cls + ']'); byCls[cls].slice(0, 40).forEach((f) => say('    ' + f.file + (f.line ? ':' + f.line : ''))); if (byCls[cls].length > 40) say('    ... ' + (byCls[cls].length - 40) + ' more'); }
  return false;
}

module.exports = { missingRequires, scanTree, scanBuiltApp, report, denyTerms, jsonFindings, LIMITS, ALLOW, WEBHOOK_RE };
