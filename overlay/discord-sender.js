// The one place ScapeLite talks to Discord webhooks. Every feature (chat relay, activity digest, clan hiscores, raid summary,
// the clan status board) sends through here, so the rules live once:
//
//   * one queue per webhook (messages leave in order, one request in flight per webhook);
//   * rate limits: 429 + retry_after / Retry-After, X-RateLimit-Remaining/Reset-After, a local 5 per 2 s bucket, the global flag;
//   * a timeout on every request (AbortController);
//   * retry with exponential backoff + jitter for 5xx and network errors, then a cool-down so a dead Discord is not hammered;
//   * 401 / 403 / 404 are permanent: the webhook is marked broken, nothing is retried, a clear error is kept for the dashboard;
//   * Discord's size limits are enforced before sending (2000 characters, 10 embeds, 6000 embed characters ...);
//   * allowed_mentions is {parse: []} unless the caller names the roles it really wants to ping; @everyone can never be pinged;
//   * the webhook URL is never logged or exposed (health only carries a short hash of it).
//
// The sender never decides what is "done": it returns a result and the caller keeps its data until result.ok is true.
//
//   const sender = createSender({ log });
//   const r = await sender.send('digest', url, { content: '...' });            // r = { ok, status, error, permanent, broken, deferred, ... }
//   const m = await sender.send('board', url, payload, { wait: true });        // create: r.id is the message id
//   await sender.send('board', url, payload, { messageId: m.id });             // edit (PATCH)
//
// Result flags: ok | status | id | error | permanent (do not retry) | broken (webhook is dead) | deferred (not tried: rate limited or cooling
// down, retryAt says when) | rejected (Discord said 400: this payload is bad) | messageGone (PATCH on a deleted message) | superseded
// (a newer message with the same replaceKey took its place) | attempts.
'use strict';

const crypto = require('crypto');
const { redactText } = require('./logging/redact');

const LIMITS = { content: 2000, embeds: 10, embedTotal: 6000, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, username: 80 };

const DEFAULTS = {
  timeoutMs: 10000,
  bucketSize: 5,            // requests ...
  bucketWindowMs: 2000,     // ... per this window, per webhook
  maxAttempts: 4,           // tries for a 5xx / network error before the item fails (the caller keeps its data)
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  cooldownMaxMs: 60000,     // after an item failed for good, new sends wait up to this long (doubling) before trying again
  maxWaitMs: 30000,         // never hold a send longer than this for a rate limit: fail it as deferred instead
  maxRateLimitRetries: 8,
  maxQueue: 300,
  brokenProbeMs: 15 * 60 * 1000, // a broken webhook is tried again once in this long (the Test button tries at once)
  userAgent: 'ScapeLite (display-only overlay)',
};

// ---- payload limits -------------------------------------------------------------------------------------------------------
const clip = (s, n) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s; };

function embedChars(e) {
  let n = 0;
  if (e.title) n += e.title.length;
  if (e.description) n += e.description.length;
  if (e.footer && e.footer.text) n += e.footer.text.length;
  if (e.author && e.author.name) n += e.author.name.length;
  (e.fields || []).forEach((f) => { n += String(f.name || '').length + String(f.value || '').length; });
  return n;
}

function cleanEmbed(src) {
  const e = {};
  if (src.title) e.title = clip(src.title, LIMITS.title);
  if (src.description) e.description = clip(src.description, LIMITS.description);
  if (src.url) e.url = String(src.url);
  if (Number.isFinite(src.color)) e.color = Math.max(0, Math.min(0xFFFFFF, Math.floor(src.color)));
  if (src.timestamp) e.timestamp = String(src.timestamp);
  if (src.footer && src.footer.text) e.footer = Object.assign({}, src.footer, { text: clip(src.footer.text, LIMITS.footer) });
  if (src.author && src.author.name) e.author = Object.assign({}, src.author, { name: clip(src.author.name, LIMITS.author) });
  if (src.thumbnail && src.thumbnail.url) e.thumbnail = { url: String(src.thumbnail.url) };
  if (src.image && src.image.url) e.image = { url: String(src.image.url) };
  if (Array.isArray(src.fields)) {
    e.fields = src.fields.slice(0, LIMITS.fields).filter((f) => f && (f.name || f.value)).map((f) => ({ name: clip(f.name || '​', LIMITS.fieldName), value: clip(f.value || '​', LIMITS.fieldValue), inline: !!f.inline }));
  }
  return e;
}

// Makes a payload Discord-safe. Returns { payload, changed: [what was cut] } or { error } when nothing sendable is left.
function sanitizePayload(input) {
  const p = input || {}, out = {}, changed = [];
  if (p.content != null && p.content !== '') {
    out.content = String(p.content);
    if (out.content.length > LIMITS.content) { out.content = clip(out.content, LIMITS.content); changed.push('content cut to ' + LIMITS.content + ' characters'); }
  }
  if (p.username) out.username = clip(p.username, LIMITS.username);
  if (p.avatar_url) out.avatar_url = String(p.avatar_url);
  if (p.thread_name) out.thread_name = String(p.thread_name).slice(0, 100);
  // files sent with this request (multipart): which ones the message keeps, e.g. [{ id: 0, filename: 'logo.png' }]
  if (Array.isArray(p.attachments)) out.attachments = p.attachments.slice(0, 10).filter((a) => a && a.id != null).map((a) => (a.filename ? { id: a.id, filename: String(a.filename).slice(0, 100) } : { id: a.id }));
  if (p.flags != null) out.flags = p.flags;
  // Mentions: nobody is pinged unless the caller names role / user ids. @everyone / @here can never ping.
  const am = p.allowed_mentions && typeof p.allowed_mentions === 'object' ? p.allowed_mentions : {};
  const ids = (a) => (Array.isArray(a) ? a.map(String).filter((x) => /^\d{5,25}$/.test(x)).slice(0, 100) : []);
  out.allowed_mentions = { parse: [] };
  const roles = ids(am.roles), users = ids(am.users);
  if (roles.length) out.allowed_mentions.roles = roles;
  if (users.length) out.allowed_mentions.users = users;

  if (Array.isArray(p.embeds) && p.embeds.length) {
    let embeds = p.embeds.filter(Boolean).map(cleanEmbed).filter((e) => Object.keys(e).length);
    if (embeds.length > LIMITS.embeds) { embeds = embeds.slice(0, LIMITS.embeds); changed.push('embeds cut to ' + LIMITS.embeds); }
    // 6000 characters across every embed: trim fields from the end of the last embeds first, then their descriptions.
    let total = embeds.reduce((a, e) => a + embedChars(e), 0);
    for (let i = embeds.length - 1; i >= 0 && total > LIMITS.embedTotal; i--) {
      const e = embeds[i];
      while (e.fields && e.fields.length && total > LIMITS.embedTotal) { const f = e.fields.pop(); total -= String(f.name).length + String(f.value).length; changed.push('field dropped'); }
      if (total > LIMITS.embedTotal && e.description) {
        const over = total - LIMITS.embedTotal, keep = Math.max(0, e.description.length - over);
        const before = e.description.length;
        e.description = keep > 0 ? clip(e.description, keep) : '';
        total -= before - e.description.length;
        changed.push('description cut');
      }
    }
    while (total > LIMITS.embedTotal && embeds.length > 1) { total -= embedChars(embeds.pop()); changed.push('embed dropped'); }
    embeds = embeds.filter((e) => Object.keys(e).length);
    if (embeds.length) out.embeds = embeds;
  }
  if (out.content == null && !out.embeds) return { error: 'empty message', changed };
  return { payload: out, changed };
}

// Splits text into pieces of at most `max` characters, at line breaks where possible (then at spaces, then hard).
function splitContent(text, max) {
  max = max || LIMITS.content;
  const s = String(text == null ? '' : text);
  if (s.length <= max) return [s];
  const parts = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.replace(/\s+$/, '')); cur = ''; };
  for (const line of s.split('\n')) {
    if (line.length > max) {
      push();
      let rest = line;
      while (rest.length > max) {
        let at = rest.lastIndexOf(' ', max);
        if (at < max * 0.5) at = max;
        parts.push(rest.slice(0, at).replace(/\s+$/, ''));
        rest = rest.slice(at).replace(/^\s+/, '');
      }
      cur = rest;
      continue;
    }
    if (cur.length + line.length + (cur ? 1 : 0) > max) push();
    cur += (cur ? '\n' : '') + line;
  }
  push();
  return parts;
}

// Groups blocks ({ text, ...anything }) into chunks of at most `max` characters joined with `sep`; a block is never cut in half
// (one bigger than max is clipped). `head` goes in front of the first chunk. Returns [{ text, blocks: [block...] }].
function chunkBlocks(blocks, opts) {
  const o = Object.assign({ max: LIMITS.content, sep: '\n\n', head: '' }, opts || {});
  const chunks = [];
  let cur = { text: o.head || '', blocks: [] };
  (blocks || []).forEach((b) => {
    const t = clip(b.text, o.max - 20);
    const join = cur.text ? o.sep : '';
    if (cur.blocks.length && cur.text.length + join.length + t.length > o.max) { chunks.push(cur); cur = { text: '', blocks: [] }; }
    cur.text += (cur.text ? o.sep : '') + t;
    cur.blocks.push(b);
  });
  if (cur.blocks.length) chunks.push(cur);
  return chunks;
}

// Sends the chunks one after the other and stops at the first failure. `onSent(chunk, index)` runs after Discord accepted a chunk, so
// the caller can drop exactly that part of its buffer. Returns { ok, sent, total, last }: nothing counts as delivered before it is accepted.
async function deliverChunks(sender, feature, url, chunks, makePayload, onSent, opts) {
  let sent = 0, last = null;
  for (let i = 0; i < chunks.length; i++) {
    last = await sender.send(feature, url, makePayload(chunks[i], i, chunks.length), opts);
    if (!last.ok) return { ok: false, sent, total: chunks.length, last };
    sent++;
    if (onSent) await onSent(chunks[i], i);
  }
  return { ok: true, sent, total: chunks.length, last };
}

// ---- the sender -----------------------------------------------------------------------------------------------------------
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (url) => crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 10);

function baseUrl(url) { return String(url).split('?')[0].replace(/\/+$/, ''); }

function createSender(options) {
  const opt = Object.assign({}, DEFAULTS, options || {});
  const log = typeof opt.log === 'function' ? opt.log : () => {};
  const doFetch = opt.fetch || ((...a) => fetch(...a));
  const now = opt.now || Date.now;
  const random = opt.random || Math.random;
  const queues = new Map();       // url hash -> queue
  const features = new Map();     // feature -> stats
  const state = { globalUntil: 0 };

  function say(text, url) { let t = redactText(text); if (url) t = t.split(String(url)).join('[webhook]'); log(t); }

  function queueFor(url) {
    const key = hashOf(url);
    let q = queues.get(key);
    if (!q) {
      q = { key, url: String(url), items: [], running: false, sent: [], blockedUntil: 0, coolUntil: 0, failStreak: 0, broken: null, brokenAt: 0, lastOkAt: null, lastErrorAt: null, lastError: null, lastStatus: null, features: new Set() };
      queues.set(key, q);
    }
    return q;
  }
  function statFor(feature) {
    let f = features.get(feature);
    if (!f) { f = { feature, lastOkAt: null, lastErrorAt: null, lastError: null, lastStatus: null, sent: 0, failed: 0, webhook: null }; features.set(feature, f); }
    return f;
  }
  function record(q, item, res) {
    const f = statFor(item.feature);
    f.webhook = q.key;
    if (res.ok) {
      f.lastOkAt = now(); f.lastStatus = res.status || null; f.sent++;
      q.lastOkAt = f.lastOkAt; q.lastStatus = res.status || null; q.failStreak = 0; q.coolUntil = 0;
      q.broken = null;
    } else if (!res.superseded) {
      f.lastErrorAt = now(); f.lastError = res.error || ('HTTP ' + res.status); if (res.status) f.lastStatus = res.status; f.failed++;
      q.lastErrorAt = f.lastErrorAt; q.lastError = f.lastError; if (res.status) q.lastStatus = res.status;
    }
  }
  function finish(q, item, res) {
    res.attempts = item.attempts;
    record(q, item, res);
    item.resolve(res);
  }

  function bucketDelay(q) {
    const t = now();
    q.sent = q.sent.filter((x) => t - x < opt.bucketWindowMs);
    if (q.sent.length < opt.bucketSize) return 0;
    return q.sent[0] + opt.bucketWindowMs - t + 5;
  }

  function parseRetryAfter(res, json) {
    let s = json && Number(json.retry_after);
    if (!Number.isFinite(s)) s = Number(res.headers.get('retry-after'));
    if (!Number.isFinite(s)) s = Number(res.headers.get('x-ratelimit-reset-after'));
    if (!Number.isFinite(s) || s < 0) s = 1;
    return Math.min(s, 3600) * 1000;
  }

  // One HTTP request. Returns { kind: 'ok'|'ratelimit'|'retry'|'broken'|'rejected'|'gone', ... }
  async function once(q, item) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opt.timeoutMs);
    let res;
    try {
      const headers = { 'user-agent': opt.userAgent };
      if (typeof item.body === 'string') headers['content-type'] = 'application/json';   // a FormData body (files) sets its own multipart header
      res = await doFetch(item.url, { method: item.method, headers, body: item.body, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = ctl.signal.aborted || (e && e.name === 'AbortError');
      return { kind: 'retry', error: timedOut ? 'timed out after ' + Math.round(opt.timeoutMs / 1000) + ' s' : redactText(String(e && e.cause && e.cause.code || e && e.message || e)), status: null };
    }
    let text = '';
    try { text = await res.text(); } catch (e) { /* body lost: status still counts */ }
    clearTimeout(timer);
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    q.sent.push(now());
    // Discord says when the bucket resets: honour it before the next request
    const remaining = res.headers.get('x-ratelimit-remaining'), resetAfter = Number(res.headers.get('x-ratelimit-reset-after'));
    if (remaining === '0' && Number.isFinite(resetAfter)) q.blockedUntil = Math.max(q.blockedUntil, now() + Math.ceil(resetAfter * 1000) + 25);
    const st = res.status;
    if (st >= 200 && st < 300) return { kind: 'ok', status: st, json };
    if (st === 429) {
      const wait = parseRetryAfter(res, json), isGlobal = !!(json && json.global) || res.headers.get('x-ratelimit-global') === 'true';
      return { kind: 'ratelimit', status: st, wait: wait + 250, global: isGlobal };
    }
    if (st === 401 || st === 403) return { kind: 'broken', status: st, error: st === 401 ? 'the webhook token is not accepted (401)' : 'the webhook may not post here (403)' };
    if (st === 404) {
      const code = json && json.code;
      if (item.method !== 'POST' && code !== 10015) return { kind: 'gone', status: st, error: 'message not found (it was deleted)' };
      return { kind: 'broken', status: st, error: 'the webhook does not exist any more (404): it was deleted or the URL is wrong' };
    }
    if (st >= 500) return { kind: 'retry', status: st, error: 'Discord answered ' + st };
    return { kind: 'rejected', status: st, error: 'Discord rejected the message (' + st + (json && json.message ? ': ' + clip(json.message, 120) : '') + ')' };
  }

  function failQueueBroken(q, why) {
    const items = q.items.splice(0);
    items.forEach((it) => finish(q, it, { ok: false, status: q.lastStatus, error: why, permanent: true, broken: true }));
  }

  async function pump(q) {
    if (q.running) return;
    q.running = true;
    try {
      while (q.items.length) {
        const item = q.items[0];
        // dead webhook: no requests, except one probe now and then (or when the user pressed Test)
        if (q.broken && !item.force && now() - q.brokenAt < opt.brokenProbeMs) { q.items.shift(); finish(q, item, { ok: false, error: q.broken, permanent: true, broken: true }); continue; }
        if (q.coolUntil > now() && !item.force) { q.items.shift(); finish(q, item, { ok: false, error: 'Discord is not answering: waiting before trying again', deferred: true, retryAt: q.coolUntil }); continue; }
        const until = Math.max(state.globalUntil, q.blockedUntil, now() + bucketDelay(q));
        const wait = until - now();
        if (wait > opt.maxWaitMs && !item.force) { q.items.shift(); finish(q, item, { ok: false, error: 'rate limited by Discord', deferred: true, rateLimited: true, retryAt: until }); continue; }
        if (wait > 0) { await sleepMs(wait); continue; }
        item.attempts++;
        const r = await once(q, item);
        if (r.kind === 'ok') {
          q.items.shift();
          finish(q, item, { ok: true, status: r.status, id: r.json && r.json.id ? String(r.json.id) : null, json: r.json });
        } else if (r.kind === 'ratelimit') {
          item.rlTries++;
          const until2 = now() + r.wait;
          if (r.global) state.globalUntil = Math.max(state.globalUntil, until2); else q.blockedUntil = Math.max(q.blockedUntil, until2);
          say('Discord webhook rate limit (' + (r.global ? 'global' : 'per webhook') + '): waiting ' + (r.wait / 1000).toFixed(1) + ' s before the next try.');
          q.lastStatus = 429;
          if (item.rlTries > opt.maxRateLimitRetries) { q.items.shift(); finish(q, item, { ok: false, status: 429, error: 'rate limited by Discord', deferred: true, rateLimited: true, retryAt: until2 }); }
          item.attempts--;                       // a rate limit is not a failed attempt
        } else if (r.kind === 'broken') {
          q.broken = r.error; q.brokenAt = now(); q.lastStatus = r.status;
          say('Discord webhook is broken: ' + r.error + '. Nothing more is sent to it until the URL changes or you press Test.');
          q.items.shift();
          finish(q, item, { ok: false, status: r.status, error: r.error, permanent: true, broken: true });
          failQueueBroken(q, r.error);
        } else if (r.kind === 'gone') {
          q.items.shift();
          finish(q, item, { ok: false, status: r.status, error: r.error, messageGone: true, permanent: true });
        } else if (r.kind === 'rejected') {
          q.items.shift();
          finish(q, item, { ok: false, status: r.status, error: r.error, rejected: true, permanent: true });
        } else {                                  // retry: 5xx / network / timeout
          if (item.attempts >= opt.maxAttempts) {
            q.failStreak++;
            q.coolUntil = now() + Math.min(opt.cooldownMaxMs, opt.backoffBaseMs * Math.pow(2, q.failStreak));
            q.items.shift();
            say('Discord webhook request failed (' + r.error + '); giving up after ' + item.attempts + ' tries, the data is kept and sent later.');
            finish(q, item, { ok: false, status: r.status, error: r.error, retryable: true });
          } else {
            const back = Math.min(opt.backoffMaxMs, opt.backoffBaseMs * Math.pow(2, item.attempts - 1)) * (0.5 + random() * 0.5);
            say('Discord webhook request failed (' + r.error + '); trying again in ' + (back / 1000).toFixed(1) + ' s.');
            await sleepMs(back);
          }
        }
      }
    } catch (e) {
      say('Discord sender error: ' + (e && e.message || e));
      const items = q.items.splice(0);
      items.forEach((it) => finish(q, it, { ok: false, error: String(e && e.message || e), retryable: true }));
    } finally {
      q.running = false;
      if (q.items.length) setImmediate(() => pump(q));
    }
  }

  // send(feature, url, payload, opts)
  //   opts.wait        POST with ?wait=true: the result carries the new message id
  //   opts.messageId   PATCH that message instead of creating one
  //   opts.method      'DELETE' (with messageId) removes a message; 'GET' reads one (with messageId) or the webhook itself (without): the answer is in result.json
//   opts.raw         send the payload as given (JSON, no message sanitising): for PATCH of the webhook itself (its name), which has no content
  //   opts.replaceKey  a still-queued item with the same key is replaced by this one (latest wins; the old one resolves as superseded)
  //   opts.force       try even when the webhook is marked broken or cooling down (the Test button)
  //   opts.threadId    thread of the webhook's channel
  //   opts.files       [{ name, data: Buffer, type }] sent as multipart (create and edit alike; list them in payload.attachments to keep them)
  function send(feature, url, payload, o) {
    const op = o || {};
    return new Promise((resolve) => {
      if (!url || typeof url !== 'string') { resolve({ ok: false, error: 'no webhook URL', permanent: true }); return; }
      const q = queueFor(url);
      q.features.add(feature);
      statFor(feature).webhook = q.key;
      const method = op.method || (op.messageId ? 'PATCH' : 'POST');
      let body = null, target = baseUrl(url);
      if (op.raw && method !== 'GET' && method !== 'DELETE') {
        body = JSON.stringify(payload || {});
      } else if (method !== 'DELETE' && method !== 'GET') {
        const s = sanitizePayload(payload);
        if (s.error) { const res = { ok: false, error: s.error, rejected: true, permanent: true }; record(q, { feature }, res); resolve(res); return; }
        if (s.changed.length) say(feature + ': message trimmed to fit Discord (' + s.changed.join(', ') + ').');
        body = JSON.stringify(s.payload);
        // files (e.g. the ScapeLite logo the card header uses as attachment://logo.png) go as multipart: payload_json + files[n]
        if (Array.isArray(op.files) && op.files.length) {
          const fd = new FormData();
          fd.append('payload_json', body);
          op.files.forEach((f, n) => fd.append('files[' + n + ']', new Blob([f.data], { type: f.type || 'application/octet-stream' }), f.name));
          body = fd;
        }
      }
      const qs = [];
      if (op.messageId) target += '/messages/' + encodeURIComponent(op.messageId);
      if (method === 'POST' && op.wait) qs.push('wait=true');
      if (op.threadId) qs.push('thread_id=' + encodeURIComponent(op.threadId));
      if (qs.length) target += '?' + qs.join('&');
      if (q.items.length >= opt.maxQueue) { const res = { ok: false, error: 'queue full', deferred: true }; record(q, { feature }, res); resolve(res); return; }
      if (op.replaceKey) {
        for (let i = q.items.length - 1; i >= 0; i--) {
          const old = q.items[i];
          if (old.replaceKey === op.replaceKey && !(i === 0 && q.running && old.attempts > 0)) { q.items.splice(i, 1); old.resolve({ ok: false, superseded: true, error: 'replaced by a newer message' }); }
        }
      }
      q.items.push({ feature, url: target, method, body, resolve, attempts: 0, rlTries: 0, force: !!op.force, replaceKey: op.replaceKey || null });
      pump(q);
    });
  }

  // Forget everything known about a webhook (its broken flag, cool-down, rate-limit wait). The Test button and a changed URL use this.
  function reset(url) { const q = queues.get(hashOf(url)); if (q) { q.broken = null; q.coolUntil = 0; q.blockedUntil = 0; q.failStreak = 0; } }
  function isBroken(url) { const q = url && queues.get(hashOf(url)); return !!(q && q.broken); }
  function keyOf(url) { return hashOf(url); }

  function health() {
    const t = now();
    const hooks = {};
    queues.forEach((q) => {
      hooks[q.key] = { features: [...q.features], broken: !!q.broken, error: q.broken || null, lastOkAt: q.lastOkAt, lastErrorAt: q.lastErrorAt, lastError: q.lastError, lastStatus: q.lastStatus, queueLength: q.items.length, rateLimitedUntil: Math.max(q.blockedUntil, state.globalUntil) > t ? Math.max(q.blockedUntil, state.globalUntil) : null, coolingUntil: q.coolUntil > t ? q.coolUntil : null };
    });
    const by = {};
    features.forEach((f) => {
      const h = f.webhook && hooks[f.webhook];
      by[f.feature] = { lastOkAt: f.lastOkAt, lastErrorAt: f.lastErrorAt, lastError: f.lastError, lastStatus: f.lastStatus, sent: f.sent, failed: f.failed, queueLength: h ? h.queueLength : 0, broken: !!(h && h.broken), brokenReason: h && h.broken ? h.error : null, rateLimitedUntil: h ? h.rateLimitedUntil : null, webhook: f.webhook };
    });
    return { features: by, webhooks: hooks, globalRateLimitedUntil: state.globalUntil > t ? state.globalUntil : null };
  }

  // Resolves when every queue is empty (graceful shutdown), or after timeoutMs.
  async function flush(timeoutMs) {
    const end = now() + (timeoutMs || 10000);
    while (now() < end) {
      let busy = false;
      queues.forEach((q) => { if (q.items.length) busy = true; });
      if (!busy) return true;
      await sleepMs(50);
    }
    return false;
  }

  return { send, health, reset, isBroken, keyOf, flush, _queues: queues };
}

let shared = null;
function getSender(options) { if (!shared) shared = createSender(options); return shared; }

module.exports = { createSender, getSender, sanitizePayload, splitContent, chunkBlocks, deliverChunks, LIMITS, DEFAULTS, hashOf };
