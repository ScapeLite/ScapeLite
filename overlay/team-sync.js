// Team settings sync (pure functions, no DOM, no network). Lets ONE person set up the Discord features (ping roles, hiscores, digest, raid summaries ...) and everyone on
// the same shared lease webhook gather the same settings. Long version: docs/DISCORD-TEAM-SYNC.md.
//
//   KEYS      the whitelist of settings that may travel. Anything else (looks, hotkeys, the own character, relayRole, the lease webhook) never does.
//   SECRETS   the webhook addresses. They are NEVER part of a bundle unless the person asks for it on purpose ("Include webhook URLs").
//   bundle    { v: 1, by, at, k: { key: value }, s?: { secretKey: url } }       validateBundle() returns a clean copy and names what it refused.
//   text      "SLT1.<base64url(deflate(json))>.<checksum>"                       encodeText() / decodeText(); the same text is what Export shows and Import takes.
//   messages  the text is cut into <= CHUNK characters; each part is one Discord message on the lease webhook (partMessage / parsePart).
'use strict';
const zlib = require('zlib');
const crypto = require('crypto');

const PING_CATEGORIES = ['rareDrop', 'shinyRareDrop', 'pet', 'shinyPet', 'unlock', 'levelUp', 'quest'];
const HOOK_RE = /^https:\/\/(discord(app)?\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{20,}(\?[\w=&.%-]*)?$/;
const LIMITS = { chunk: 1800, maxParts: 8, maxJson: 65536, maxText: 14400, maxRoles: 12, maxMembers: 300, maxKeywords: 40 };

const hash8 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

// A name that is shown in Discord or in the UI: no mentions, no markup, no control characters.
function cleanName(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>@`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 40);
}

// ---- the whitelist ------------------------------------------------------------------------------------------------------------------------------------------------
// store: 'plugin' = a setting of the Plugins tab (page side) · 'file' = a field of one of the private config files (watcher side)
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const int = (min, max) => (v) => { const n = typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined; };
const oneOf = (list) => (v) => (list.indexOf(v) >= 0 ? v : undefined);
const list = (max, item) => (v) => {
  if (!Array.isArray(v)) return undefined;
  const out = []; v.slice(0, max).forEach((x) => { const c = item(x); if (c) out.push(c); });
  return out;
};
const roles = (v) => {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  v.slice(0, LIMITS.maxRoles).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const id = String(r.roleId == null ? '' : r.roleId);
    if (!/^\d{17,20}$/.test(id)) return;
    const cats = (Array.isArray(r.categories) ? r.categories : []).filter((c) => PING_CATEGORIES.indexOf(c) >= 0).filter((c, i, a) => a.indexOf(c) === i);
    out.push({ name: cleanName(r.name, 40) || 'Role', roleId: id, categories: cats });
  });
  return out;
};
const postTimes = (v) => (typeof v === 'string' && v.length <= 80 && /^[0-9:,;\s]*$/.test(v) ? v.trim() : undefined);
const tag = (v) => (typeof v === 'string' ? cleanName(v, 12).replace(/[^\w -]/g, '') : undefined);

const KEYS = [
  // chat relay
  { key: 'clanRelayEnabled', store: 'plugin', group: 'Chat relay', label: 'Relay clan chat', ok: bool },
  { key: 'globalRelayEnabled', store: 'plugin', group: 'Chat relay', label: 'Relay global chat', ok: bool },
  { key: 'relayPlainChat', store: 'plugin', group: 'Chat relay', label: 'Mirror plain chat messages', ok: bool },
  { key: 'pingRoles', store: 'plugin', group: 'Chat relay pings', label: 'Ping roles', ok: roles },
  { key: 'ultraRareKeywords', store: 'file', group: 'Chat relay pings', label: 'Ultra rare keywords', ok: list(LIMITS.maxKeywords, (x) => { const s = cleanName(x, 40); return s || null; }) },
  // clan hiscores
  { key: 'hiscoresEnabled', store: 'plugin', group: 'Clan hiscores', label: 'Clan hiscores on', ok: bool },
  { key: 'hiscoresPollMinutes', store: 'plugin', group: 'Clan hiscores', label: 'Poll every (minutes)', ok: int(5, 1440) },
  { key: 'hiscoresPostIntervalHours', store: 'plugin', group: 'Clan hiscores', label: 'Post every (hours)', ok: int(1, 168) },
  { key: 'hiscoresMajorRankChange', store: 'plugin', group: 'Clan hiscores', label: 'Major rank change', ok: int(1, 100) },
  { key: 'clanTag', store: 'file', group: 'Clan hiscores', label: 'Clan tag', ok: tag },
  { key: 'clanMembers', store: 'file', group: 'Clan hiscores', label: 'Member list', ok: list(LIMITS.maxMembers, (x) => { const s = cleanName(x, 24); return s || null; }) },
  // activity digest
  { key: 'digestEnabled', store: 'plugin', group: 'Activity digest', label: 'Digest on', ok: bool },
  { key: 'digestIntervalHours', store: 'plugin', group: 'Activity digest', label: 'Post every (hours)', ok: int(1, 168) },
  { key: 'digestPostTimes', store: 'plugin', group: 'Activity digest', label: 'Also post at', ok: postTimes },
  // raid summaries
  { key: 'raidSummaryEnabled', store: 'plugin', group: 'Raid summaries', label: 'Raid summaries on', ok: bool },
  { key: 'raidSummaryMode', store: 'plugin', group: 'Raid summaries', label: 'Post when', ok: oneOf(['any', 'all']) },
  { key: 'raidSummaryPartyOn', store: 'plugin', group: 'Raid summaries', label: 'Rule: party size', ok: bool },
  { key: 'raidSummaryMinMembers', store: 'plugin', group: 'Raid summaries', label: 'Party size at least', ok: int(1, 50) },
  { key: 'raidSummaryGuildOn', store: 'plugin', group: 'Raid summaries', label: 'Rule: guild members', ok: bool },
  { key: 'raidSummaryGuildMin', store: 'plugin', group: 'Raid summaries', label: 'Guild members at least', ok: int(1, 50) },
  { key: 'raidSummaryWaveOn', store: 'plugin', group: 'Raid summaries', label: 'Rule: wave reached', ok: bool },
  { key: 'raidSummaryWaveMin', store: 'plugin', group: 'Raid summaries', label: 'Wave at least', ok: int(1, 10000) },
  { key: 'raidSummaryDungeons', store: 'plugin', group: 'Raid summaries', label: 'Include dungeon runs', ok: bool },
  { key: 'raidSummaryRaids', store: 'plugin', group: 'Raid summaries', label: 'Include raids', ok: bool },
  // clan status board (what the card shows; whether YOU post one stays your own choice)
  { key: 'clanBoardRoster', store: 'plugin', group: 'Clan status board', label: 'Show clanmates without ScapeLite', ok: bool },
  { key: 'clanBoardRosterExclude', store: 'plugin', group: 'Clan status board', label: 'Clanmates left off the board', ok: list(LIMITS.maxMembers, (x) => { const s = cleanName(x, 24); return s || null; }) },
  { key: 'clanBoardIntervalMin', store: 'plugin', group: 'Clan status board', label: 'Update every (minutes)', ok: int(1, 1440) },
  ...['Task', 'Location', 'Progress', 'LevelUps', 'TotalLevel', 'XpHr', 'Hp', 'Slayer', 'Fortress', 'OnlineSince', 'Today'].map((n) => ({ key: 'clanBoard' + n, store: 'plugin', group: 'Clan status board', label: 'Card shows: ' + n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), ok: bool })),
];
const KEY_BY = {}; KEYS.forEach((k) => { KEY_BY[k.key] = k; });

// webhook addresses: never in a bundle by default, never the lease webhook, never shown
const SECRETS = [
  { key: 'relayClanWebhook', label: 'Clan feed webhook' },
  { key: 'relayGlobalWebhook', label: 'Global milestones webhook' },
  { key: 'digestWebhook', label: 'Activity digest webhook' },
  { key: 'hiscoresWebhook', label: 'Clan hiscores webhook' },
  { key: 'raidSummaryWebhook', label: 'Raid summaries webhook' },
  { key: 'boardWebhook', label: 'Clan status board webhook' },
];
const SECRET_BY = {}; SECRETS.forEach((s) => { SECRET_BY[s.key] = s; });

// ---- bundles --------------------------------------------------------------------------------------------------------------------------------------------------------
// collect: what this PC has, from the three places it lives. src = { plugin: PS.getAll(), files: { ultraRareKeywords, clanTag, clanMembers }, secrets: { relayClanWebhook: url, ... } }
function collect(src, opt) {
  const o = opt || {}, s = src || {}, k = {};
  KEYS.forEach((d) => {
    const raw = d.store === 'plugin' ? (s.plugin || {})[d.key] : (s.files || {})[d.key];
    if (raw === undefined) return;
    const v = d.ok(raw);
    if (v !== undefined) k[d.key] = v;
  });
  const b = { v: 1, by: cleanName(o.by, 24), at: Number(o.at) > 0 ? Math.floor(Number(o.at)) : 0, k };
  if (o.includeUrls) {
    const sec = {};
    SECRETS.forEach((d) => { const u = (s.secrets || {})[d.key]; if (typeof u === 'string' && HOOK_RE.test(u)) sec[d.key] = u; });
    if (Object.keys(sec).length) b.s = sec;
  }
  return b;
}

// validateBundle: anything received (a pasted text, a Discord message, a file) goes through here. Unknown keys are refused, bad values are dropped, sizes are capped.
function validateBundle(raw) {
  const res = { ok: false, bundle: null, refused: [], errors: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.errors.push('not a settings bundle'); return res; }
  if (raw.v !== 1) { res.errors.push('a different bundle version (' + String(raw.v).slice(0, 8) + '): update ScapeLite'); return res; }
  const k = {}, kin = raw.k && typeof raw.k === 'object' && !Array.isArray(raw.k) ? raw.k : {};
  Object.keys(kin).forEach((key) => {
    const d = KEY_BY[key];
    if (!d) { res.refused.push(key.slice(0, 40)); return; }
    const v = d.ok(kin[key]);
    if (v === undefined) { res.refused.push(key); return; }
    k[key] = v;
  });
  const b = { v: 1, by: cleanName(raw.by, 24), at: Number(raw.at) > 0 && Number(raw.at) < 4e12 ? Math.floor(Number(raw.at)) : 0, k };
  if (raw.s && typeof raw.s === 'object' && !Array.isArray(raw.s)) {
    const s = {};
    Object.keys(raw.s).forEach((key) => {
      if (!SECRET_BY[key]) { res.refused.push(key.slice(0, 40)); return; }       // relayLeaseWebhook and everything unknown end up here
      if (typeof raw.s[key] === 'string' && HOOK_RE.test(raw.s[key])) s[key] = raw.s[key]; else res.refused.push(key);
    });
    if (Object.keys(s).length) b.s = s;
  }
  res.bundle = b; res.ok = true;
  return res;
}

// ---- text (export / import and the Discord message body) ----------------------------------------------------------------------------------------------------------
function encodeText(bundle) {
  const json = JSON.stringify(bundle);
  if (json.length > LIMITS.maxJson) return { ok: false, error: 'the settings are too large to share (' + json.length + ' characters)' };
  const body = zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url');
  const text = 'SLT1.' + body + '.' + hash8(body);
  if (text.length > LIMITS.maxText) return { ok: false, error: 'the settings are too large to share through Discord (' + text.length + ' characters)' };
  return { ok: true, text, sum: hash8(body), size: text.length };
}
function decodeText(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, '');
  const m = /^SLT1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/.exec(t);
  if (!m) return { ok: false, error: 'this is not ScapeLite team settings text (it should start with SLT1.)' };
  if (m[1].length > LIMITS.maxText) return { ok: false, error: 'too large' };
  if (hash8(m[1]) !== m[2]) return { ok: false, error: 'the text is damaged (checksum does not match): copy it again, whole' };
  let json;
  try { json = zlib.inflateRawSync(Buffer.from(m[1], 'base64url'), { maxOutputLength: LIMITS.maxJson }).toString('utf8'); }
  catch (e) { return { ok: false, error: 'the text could not be read (damaged or too large)' }; }
  let raw; try { raw = JSON.parse(json); } catch (e) { return { ok: false, error: 'the text could not be read (not valid settings)' }; }
  const v = validateBundle(raw);
  if (!v.ok) return { ok: false, error: v.errors[0] };
  return { ok: true, bundle: v.bundle, refused: v.refused, sum: m[2] };
}

// ---- Discord messages -------------------------------------------------------------------------------------------------------------------------------------------------
function toParts(text) {
  const out = []; for (let i = 0; i < text.length; i += LIMITS.chunk) out.push(text.slice(i, i + LIMITS.chunk));
  return out;
}
const PART_RE = /^-# ScapeLite team settings · part (\d{1,2})\/(\d{1,2}) · v(\d{1,6}) · do not edit or delete\n\|\|([A-Za-z0-9_.-]+)\|\|$/;
const partMessage = (i, n, ver, chunk) => `-# ScapeLite team settings · part ${i + 1}/${n} · v${ver} · do not edit or delete\n||${chunk}||`;
function parsePart(content) {
  const m = PART_RE.exec(String(content || ''));
  return m ? { i: Number(m[1]) - 1, n: Number(m[2]), ver: Number(m[3]), chunk: m[4] } : null;
}
// the pointer kept in the lease state (field "ts"; old copies of ScapeLite keep unknown fields when they rewrite the lease)
function cleanMeta(ts) {
  if (!ts || typeof ts !== 'object') return null;
  const ids = Array.isArray(ts.ids) ? ts.ids.filter((x) => typeof x === 'string' && /^\d{15,25}$/.test(x)).slice(0, LIMITS.maxParts) : [];
  const ver = Number(ts.ver);
  if (!ids.length || !(ver >= 1) || ver > 999999 || !/^[0-9a-f]{8}$/.test(String(ts.sum || ''))) return null;
  return { ver: Math.floor(ver), ids, sum: String(ts.sum), by: cleanName(ts.by, 24), at: Number(ts.at) > 0 ? Math.floor(Number(ts.at)) : 0, u: ts.u ? 1 : 0 };
}
// join the parts read from Discord back into the text; the checksum inside the text is the final judge
function joinParts(parts, ver) {
  const have = {}; let n = 0;
  for (const p of parts) { if (!p || p.ver !== ver) return { ok: false, error: 'the parts belong to different versions: a publish is in progress, try again in a minute' }; have[p.i] = p.chunk; n = p.n; }
  if (!n || Object.keys(have).length !== n) return { ok: false, error: 'a part is missing' };
  let text = ''; for (let i = 0; i < n; i++) { if (have[i] === undefined) return { ok: false, error: 'a part is missing' }; text += have[i]; }
  return { ok: true, text };
}

// ---- comparing and applying ---------------------------------------------------------------------------------------------------------------------------------------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function show(key, v) {
  if (v === undefined) return '(not set)';
  if (key === 'pingRoles') return v.length ? v.map((r) => r.name + ' (…' + r.roleId.slice(-4) + '): ' + (r.categories.join(', ') || 'no events')).join(' · ') : '(none)';
  if (Array.isArray(v)) return v.length ? (v.length > 6 ? v.slice(0, 6).join(', ') + ' … (' + v.length + ')' : v.join(', ')) : '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v) === '' ? '(empty)' : String(v);
}
// diff: one row per key either side has. Secrets only say set / not set / differs, never the address.
function diff(local, remote) {
  const rows = [], lk = (local && local.k) || {}, rk = (remote && remote.k) || {};
  KEYS.forEach((d) => {
    if (rk[d.key] === undefined) return;                       // the team says nothing about it: nothing to compare
    rows.push({ key: d.key, group: d.group, label: d.label, local: show(d.key, lk[d.key]), remote: show(d.key, rk[d.key]), same: same(lk[d.key], rk[d.key]), secret: false });
  });
  const ls = (local && local.s) || {}, rs = (remote && remote.s) || {};
  SECRETS.forEach((d) => {
    if (!rs[d.key]) return;
    rows.push({ key: d.key, group: 'Webhook addresses', label: d.label, local: ls[d.key] ? 'set' : 'not set', remote: 'in the team settings', same: ls[d.key] === rs[d.key], secret: true });
  });
  return rows;
}
// plan: split the chosen keys of a bundle into the three places they are written to. Webhook addresses are applied only when asked for by name.
function plan(bundle, keys, opt) {
  const o = opt || {}, p = { plugin: {}, files: {}, secrets: {}, applied: [] };
  const want = Array.isArray(keys) ? keys : Object.keys((bundle && bundle.k) || {}).concat(o.urls ? Object.keys((bundle && bundle.s) || {}) : []);
  want.forEach((key) => {
    if (bundle.k && bundle.k[key] !== undefined && KEY_BY[key]) {
      if (KEY_BY[key].store === 'plugin') p.plugin[key] = bundle.k[key]; else p.files[key] = bundle.k[key];
      p.applied.push(key);
    } else if (o.urls && bundle.s && bundle.s[key] && SECRET_BY[key]) { p.secrets[key] = bundle.s[key]; p.applied.push(key); }
  });
  return p;
}

module.exports = { KEYS, KEY_BY, SECRETS, PING_CATEGORIES, LIMITS, HOOK_RE, cleanName, collect, validateBundle, encodeText, decodeText, toParts, partMessage, parsePart, cleanMeta, joinParts, diff, plan, show, hash8 };
