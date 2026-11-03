// First run: creates the per-user config files from the hollow *.example.json templates that ship with the program.
//   - only in the per-user folder (paths.state(): SCAPELITE_HOME when installed, overlay/ in a source checkout), never next to a template
//   - NEVER overwrites a file that exists (exclusive create), and a template that is not hollow is refused (see isHollow)
//   - the templates are product files and hold no webhook, no member list, no role ids: every Discord feature starts OFF
// The dashboard / Plugins tab fill the real values in later (the watcher writes them atomically into these files).
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');

// <name>.json in the per-user folder is created from <name>.example.json in the program folder
const TEMPLATES = ['chat-relay-config', 'digest-config', 'clan-hiscores-config', 'raid-summary-config', 'clan-board-config'];

const WEBHOOK_RE = /discord(?:app)?\.com\/api\/webhooks\/\d{6,}\/[\w-]{8,}/i;
// A template is hollow when it holds no webhook URL, no non-empty member list and no role id. A cheap runtime tripwire against a
// maintainer pasting a real value into an example; scripts/verify-package.js is the real gate.
function isHollow(text) {
  if (WEBHOOK_RE.test(text)) return false;
  let o; try { o = JSON.parse(text); } catch (e) { return false; }
  let ok = true;
  (function walk(v, key) {
    if (Array.isArray(v)) { if (/^(members|pingRoles)$/.test(key || '') && v.length) ok = false; v.forEach((x) => walk(x, key)); }
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k], k));
    else if (typeof v === 'string' && v && /^(webhookUrl|roleSelectorWebhookUrl|url|webhook|clanTag|roleId)$/.test(key || '')) ok = false;
    else if (typeof v === 'string' && /<@&\d{6,}>/.test(v)) ok = false;
  })(o, '');
  return ok;
}

function createFrom(srcFile, dstFile) {
  let text;
  try { text = fs.readFileSync(srcFile, 'utf8'); } catch (e) { return 'no-template'; }
  if (!isHollow(text)) return 'refused';
  try { fs.writeFileSync(dstFile, text, { flag: 'wx' }); return 'created'; }
  catch (e) { return e.code === 'EEXIST' ? 'exists' : 'error:' + (e.code || e.message); }
}

// plugins-config.json starts as the catalog defaults (what loadDisabledPlugins() falls back to when the file is missing), so the file
// that the first toggle would create already exists with the same meaning. No user data in it.
function pluginsConfigText() {
  let disabled = [];
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(P.APP, 'catalog.json'), 'utf8')).plugins || [];
    disabled = cat.filter((p) => !p.core && p.default === false).map((p) => p.id);
  } catch (e) { /* no catalog: nothing disabled */ }
  return JSON.stringify({ disabled, seen: [] }, null, 2) + '\n';
}

// Returns { created: [...], skipped: [...] } and never throws; log(text) is optional.
function ensureUserConfigs(log) {
  const out = { created: [], skipped: [] };
  const say = typeof log === 'function' ? log : () => {};
  try { fs.mkdirSync(path.dirname(P.state('x')), { recursive: true }); } catch (e) { /* surfaces below as error:* */ }
  for (const name of TEMPLATES) {
    const r = createFrom(path.join(P.APP, name + '.example.json'), P.state(name + '.json'));
    (r === 'created' ? out.created : out.skipped).push(name + '.json' + (r === 'created' || r === 'exists' ? '' : ' (' + r + ')'));
    if (r === 'refused') say('first run: template ' + name + '.example.json is not hollow, not copied');
  }
  try { fs.writeFileSync(P.state('plugins-config.json'), pluginsConfigText(), { flag: 'wx' }); out.created.push('plugins-config.json'); }
  catch (e) { out.skipped.push('plugins-config.json'); }
  if (out.created.length) say('first run: created ' + out.created.join(', ') + ' (hollow, everything off)');
  return out;
}

module.exports = { ensureUserConfigs, isHollow, TEMPLATES };
