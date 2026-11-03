// One-time clean-up of the first relay lease (0.4.0 pre-release), which wrote a visible "ScapeLite relay lease" message into every shared channel and appended
// " [sl:<message id>]" to the webhook's name. The lease now lives on an optional private lease webhook (overlay/relay-lease.js) and nothing is written to the
// clan's channels any more; this module removes what the first version left behind:
//
//   1. GET the webhook; its name ends in " [sl:<id>]" when the old code was there. <id> is the lease message the old code stored in the name.
//   2. GET that message. ONLY if its text starts with the ScapeLite lease header is it deleted (DELETE on the webhook's own message). Anything else is left alone,
//      including the name, and reported.
//   3. The name gets its original text back (the suffix removed).
//
// Webhook tokens can only touch their own messages, so nothing a person wrote can be reached by this. Results are remembered per webhook (a short hash, never the URL) so
// a webhook is looked at once; a failed attempt is retried at the next run.
'use strict';
const crypto = require('crypto');
const { POINTER_RE } = require('./relay-lease');

const LEGACY_HEAD = /^-# ScapeLite relay lease/;
const hook8 = (u) => crypto.createHash('sha1').update(String(u)).digest('hex').slice(0, 8);

// -> { done: bool, found: bool, deleted?: id, nameRestored?: bool, skipped?: string, error?: string }
async function cleanupOne(send, url) {
  const info = await send('lease', url, null, { method: 'GET' });
  if (!info.ok) return { done: false, error: info.error || 'webhook unreadable' };
  const name = String((info.json && info.json.name) || '');
  const m = POINTER_RE.exec(name);
  if (!m) return { done: true, found: false };
  const id = m[1];
  const g = await send('lease', url, null, { method: 'GET', messageId: id });
  let deleted = null;
  if (g.ok) {
    if (!LEGACY_HEAD.test(String((g.json && g.json.content) || ''))) return { done: true, found: true, skipped: 'the message the webhook name points to is not a ScapeLite lease message: left alone' };
    const d = await send('lease', url, null, { method: 'DELETE', messageId: id });
    if (!d.ok && !d.messageGone) return { done: false, found: true, error: d.error || 'delete failed' };
    deleted = id;
  } else if (!g.messageGone) {
    return { done: false, found: true, error: g.error || 'message unreadable' };
  }
  const base = name.replace(POINTER_RE, '').trim() || 'ScapeLite';
  const p = await send('lease', url, { name: base }, { method: 'PATCH', raw: true });
  if (!p.ok) return { done: false, found: true, deleted, error: p.error || 'could not restore the webhook name' };
  return { done: true, found: true, deleted, messageId: id, nameRestored: true };
}

// o: { send, targets: [{ feature, url }], load() -> state, save(state), log }
async function run(o) {
  const log = o.log || (() => {});
  const st = (o.load && o.load()) || {};
  if (!st.done || typeof st.done !== 'object') st.done = {};
  if (!Array.isArray(st.deleted)) st.deleted = [];
  const seen = new Set(), out = [];
  for (const t of o.targets || []) {
    if (!t || !t.url || seen.has(t.url)) continue;
    seen.add(t.url);
    const key = hook8(t.url);
    if (st.done[key]) continue;
    let r;
    try { r = await cleanupOne(o.send, t.url); } catch (e) { r = { done: false, error: String(e && e.message || e) }; }
    out.push(Object.assign({ feature: t.feature }, r));
    if (r.deleted) { st.deleted.push({ webhook: key, feature: t.feature, messageId: r.deleted, at: new Date().toISOString() }); log('Relay lease clean-up (' + t.feature + ' webhook): deleted the old lease message ' + r.deleted + (r.nameRestored ? ' and restored the webhook name.' : '.')); }
    else if (r.found && r.nameRestored) log('Relay lease clean-up (' + t.feature + ' webhook): the old lease message was already gone; restored the webhook name.');
    else if (r.skipped) log('Relay lease clean-up (' + t.feature + ' webhook): ' + r.skipped);
    else if (r.error) log('Relay lease clean-up (' + t.feature + ' webhook): will retry later (' + r.error + ').');
    if (r.done) st.done[key] = new Date().toISOString();
    if (o.save) o.save(st);
  }
  return out;
}

module.exports = { run, cleanupOne, hook8, LEGACY_HEAD };
