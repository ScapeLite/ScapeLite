// ScapeLite chat commands, watcher side (docs/CHAT-COMMANDS.md). The page (overlay/chat-commands.js) leaves records in window.__ccCmdBox; the watcher's 3 s loop
// reads and clears that box and hands the records to the host below, which only ever runs commands from a STATIC allowlist, with validated plain arguments.
//
//   host      validation, limits, replies. No knowledge of what a command does.
//   handlers  the commands themselves. All dependencies are injected, so the tests run them with fakes.
//
// Rules this file keeps (display-only policy): no command posts to Discord, touches the game, runs code, reads a file path from the page or prints a secret.
// A reply line is cut to 220 characters, and anything that looks like a webhook address is replaced before it leaves this file.
'use strict';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const NAME_RE = /^[a-z]+(\.[a-z]+)?$/;
const LIMITS = { queue: 20, args: 4, argLen: 64, lines: 30, line: 220, seenIds: 300 };

const HOOK_RE = /https?:\/\/[^\s"'<>]*(discord(app)?\.com|discord\.gg)[^\s"'<>]*/gi;
const CTRL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31, 127, 0x2028, 0x2029) + ']', 'g');   // control characters and line separators
const scrub = (s) => String(s == null ? '' : s).replace(HOOK_RE, '[link hidden]').replace(CTRL_RE, ' ').trim();
function cleanLines(lines) {
  const out = [];
  (Array.isArray(lines) ? lines : [lines]).forEach((l) => { const t = scrub(l); if (t) out.push(t.length > LIMITS.line ? t.slice(0, LIMITS.line - 1) + '…' : t); });
  if (out.length > LIMITS.lines) { const n = out.length - (LIMITS.lines - 1); out.length = LIMITS.lines - 1; out.push('… ' + n + ' more line(s) not shown'); }
  return out;
}
// Plain strings (short), finite numbers and booleans only; anything else rejects the whole record.
function cleanArgs(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.args) return null;
  const out = [];
  for (const a of raw) {
    if (typeof a === 'string') { if (a.length > LIMITS.argLen) return null; out.push(a); }
    else if (typeof a === 'number' && Number.isFinite(a)) out.push(a);
    else if (typeof a === 'boolean') out.push(a);
    else return null;
  }
  return out;
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timed out')), ms); Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

// ------------------------------------------------------------------------------------------------ host
function createCommandHost(opts) {
  const handlers = opts.handlers, log = opts.log || (() => {}), now = opts.now || Date.now;
  const seen = new Map(), running = new Set(), lastRun = {};
  const has = (name) => typeof name === 'string' && NAME_RE.test(name) && Object.prototype.hasOwnProperty.call(handlers, name);

  async function runOne(rec) {
    const base = { id: rec.id, name: typeof rec.name === 'string' ? scrub(rec.name).slice(0, 30) : '' };
    const fail = (error) => Object.assign(base, { ok: false, lines: [], error: scrub(error) });
    if (!has(rec.name)) return fail('Unknown command.');
    const h = handlers[rec.name];
    const args = cleanArgs(rec.args);
    if (!args) return fail('Bad arguments.');
    let v = { ok: true, args };
    if (h.args) { try { v = h.args(args); } catch (e) { v = { ok: false, error: 'Bad arguments.' }; } }
    if (!v || !v.ok) return fail((v && v.error) || 'Bad arguments.');
    if (running.has(rec.name)) return fail('That command is still running.');
    const gap = h.gapMs || 0, left = (lastRun[rec.name] || 0) + gap - now();
    if (gap && left > 0) return fail('Too soon: wait ' + Math.ceil(left / 1000) + ' s before running it again.');
    lastRun[rec.name] = now();
    running.add(rec.name);
    const job = Promise.resolve().then(() => h.run(v.args));
    job.then(() => running.delete(rec.name), () => running.delete(rec.name));   // the command may outlive its reply (timeout), it stays "running" until it settles
    try {
      const r = await withTimeout(job, h.timeoutMs || 8000);
      const res = Array.isArray(r) || typeof r === 'string' ? { lines: r } : (r || {});
      return Object.assign(base, { ok: res.ok !== false, lines: cleanLines(res.lines), error: res.ok === false ? scrub(res.error || 'Failed.') : undefined });
    } catch (e) {
      log('Chat command ' + rec.name + ' failed -- ' + scrub(e && e.message || e));
      return fail(/timed out/.test(String(e && e.message)) ? 'No answer in time. It may still finish; try again in a moment.' : 'The command failed. See Logs/System.');
    }
  }

  // records: whatever the page left in the box (untrusted). Returns the replies to write back.
  async function process(records, onReply) {
    if (!Array.isArray(records) || !records.length) return [];
    const replies = [], todo = [];
    records.forEach((rec, i) => {
      if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || !ID_RE.test(rec.id)) return;   // no valid id: nothing can be answered
      if (seen.has(rec.id)) return;                                                                          // a record already handled (re-inject, double delivery)
      seen.set(rec.id, now()); if (seen.size > LIMITS.seenIds) seen.delete(seen.keys().next().value);
      if (i >= LIMITS.queue) { replies.push({ id: rec.id, name: '', ok: false, lines: [], error: 'Too many commands at once.' }); return; }
      todo.push(rec);
    });
    // Concurrent: a slow command (the hiscores lookup) must not hold up a quick one. Each reply goes out the moment it is ready.
    await Promise.all(todo.map(async (rec) => {
      const rep = await runOne(rec);
      log('Chat command run: ' + (rep.name || '?') + (rep.ok ? '' : ' (' + rep.error + ')'));
      replies.push(rep);
      if (onReply) { try { await onReply(rep); } catch (e) { /* the page is gone: nothing to tell */ } }
    }));
    return replies;
  }
  return { process, names: () => Object.keys(handlers).filter(has) };
}

// ------------------------------------------------------------------------------------------------ handlers
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
function dur(ms) { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
const agoOf = (t, now) => (t ? dur(now - t) + ' ago' : 'never');
const inOf = (t, now) => (t ? (t <= now ? 'due now' : 'in ' + dur(t - now)) : 'not scheduled');

// deps: { status(), version, now(), pluginDefs, setPluginEnabled(id, on), relayRole(), outbox(), digest: { buffer(), build(b), chunk(blocks, o), head(b), config() }, hiscoresCheck() }
function createHandlers(deps) {
  const now = () => (deps.now ? deps.now() : Date.now());
  const S = () => deps.status() || {};
  const ids = () => (deps.pluginDefs || []).map((d) => d.id);

  const handlers = {
    version: { gapMs: 1000, run: () => {
      const s = S(), n = (s.plugins || []).filter((p) => p.loaded).length;
      return ['ScapeLite ' + (deps.version || '?') + ' · running for ' + dur(now() - (s.startedAt || now())) + ' · ' + n + ' plugin(s) loaded'];
    } },

    status: { gapMs: 1000, run: () => {
      const s = S(), t = now(), L = [];
      L.push('ScapeLite ' + (deps.version || '?') + ' · running for ' + dur(t - (s.startedAt || t)));
      L.push('Game link: ' + (s.cdp && s.cdp.connected ? 'connected since ' + clock(s.cdp.since) : 'NOT connected') + ' · bridge ' + (s.bridge && s.bridge.ok ? 'ok' + (s.bridge.ms != null ? ' (' + s.bridge.ms + ' ms)' : '') : 'not attached' + (s.bridge && s.bridge.error ? ' (' + s.bridge.error + ')' : '')));
      const lease = s.relayLease || {}, d = s.discord || {};
      L.push('Relay: ' + (lease.mode || deps.relayRole && deps.relayRole() || 'auto') + ' · Discord problems: ' + (d.problems != null ? d.problems : '?'));
      const hs = s.clanHiscores || {}, dg = s.digest || {}, cb = s.clanBoard || {};
      L.push('Digest: last posted ' + agoOf(dg.lastPostAt, t) + ', next ' + inOf(dg.nextPostAt, t));
      L.push('Clan rank: ' + (hs.lastClanRank != null ? '#' + hs.lastClanRank : '?') + ' (polled ' + agoOf(hs.lastPollAt, t) + ') · Board: ' + (cb.configured ? 'last edit ' + agoOf(cb.lastEditAt, t) : 'not set up'));
      return L;
    } },

    plugins: { gapMs: 1000, run: () => {
      const list = S().plugins || [], on = list.filter((p) => p.enabled).map((p) => p.id), off = list.filter((p) => !p.enabled).map((p) => p.id);
      return ['Plugins on (' + on.length + '): ' + (on.join(', ') || 'none'), 'Plugins off (' + off.length + '): ' + (off.join(', ') || 'none')];
    } },

    plugin: {
      gapMs: 1500,
      args(a) {
        if (a.length !== 2 || typeof a[0] !== 'string' || typeof a[1] !== 'string') return { ok: false, error: 'Usage: /sl plugin <id> on|off' };
        const id = a[0].toLowerCase(), st = a[1].toLowerCase();
        if (!ids().includes(id)) return { ok: false, error: 'No plugin called "' + id.slice(0, 40) + '". /sl plugins lists them.' };
        if (st !== 'on' && st !== 'off') return { ok: false, error: 'Say on or off.' };
        return { ok: true, args: [id, st] };
      },
      async run(a) {
        const r = await deps.setPluginEnabled(a[0], a[1] === 'on');
        if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Failed.' };
        return ['Plugin ' + a[0] + ' is now ' + a[1] + (r.applied ? '.' : ' (applies when the game connects).')];
      },
    },

    'relay.status': { gapMs: 1000, run: () => {
      const s = S(), t = now(), L = [], lease = s.relayLease || {}, d = s.discord || {};
      L.push('Relay mode: ' + (lease.mode || 'auto') + ' · shared lease ' + (lease.configured ? 'set up' : 'not set up (this PC posts on its own)'));
      (lease.webhooks || []).forEach((w, i) => L.push('  lease ' + (i + 1) + ': ' + (w.role || '?') + (w.hasLease ? ' (this PC holds it)' : '') + ' · epoch ' + (w.epoch != null ? w.epoch : '?') + (w.errors ? ' · ' + w.errors + ' error(s)' : '') + (w.lastError ? ' · ' + w.lastError : '')));
      if (lease.newerVersion) L.push('Another ScapeLite user runs ' + lease.newerVersion + ' (this PC: ' + (lease.version || deps.version || '?') + ').');
      const ob = deps.outbox ? deps.outbox() : null;
      L.push('Events waiting to be posted: ' + (Array.isArray(ob) ? ob.length : '?'));
      (d.features || []).forEach((f) => L.push('  ' + f.label + ': ' + (!f.configured ? 'not set up' : f.broken ? 'BROKEN' + (f.brokenReason ? ' (' + f.brokenReason + ')' : '') : 'ok') + (f.configured ? ' · last ok ' + agoOf(f.lastOkAt, t) + (f.queueLength ? ' · ' + f.queueLength + ' queued' : '') + (f.lastError && (!f.lastOkAt || f.lastErrorAt > f.lastOkAt) ? ' · last error: ' + f.lastError : '') : '')));
      return L;
    } },

    'digest.preview': { gapMs: 3000, run: () => {
      const dg = deps.digest, buf = dg.buffer(), cfg = dg.config(), s = S(), t = now();
      const blocks = dg.build(buf), L = [];
      L.push('Digest preview (nothing is posted): ' + (cfg && cfg.webhookUrl ? (cfg.enabled === false ? 'switched off' : 'set up') : 'no webhook set') + ' · collecting for ' + dur(t - (buf.sinceAt || t)) + ' · next post ' + inOf(s.digest && s.digest.nextPostAt, t));
      if (!blocks.length) { L.push('Nothing notable yet: the next digest would be skipped.'); return L; }
      const chunks = dg.chunk(blocks, { max: 1900, head: dg.head(buf) });
      L.push(blocks.length + ' player(s) with activity · ' + chunks.length + ' message(s)');
      const first = String((chunks[0] && chunks[0].text) || '').replace(/\*\*/g, '').split('\n').filter(Boolean);
      first.slice(0, 12).forEach((l) => L.push('  ' + l));
      if (first.length > 12 || chunks.length > 1) L.push('  …');
      return L;
    } },

    'hiscores.check': {
      gapMs: 60000, timeoutMs: 120000,
      async run() {
        const r = await deps.hiscoresCheck();
        if (!r || r.error) return { ok: false, error: (r && r.error) || 'No result.' };
        const L = ['Clan rank #' + r.rank + (r.prevRank != null && r.prevRank !== r.rank ? ' (was #' + r.prevRank + ' at the last post)' : '') + ' · nothing was posted'];
        (r.members || []).forEach((m) => L.push('  ' + m.name + ': hiscores #' + m.rank + ', total level ' + m.totalLevel));
        (r.notFound || []).forEach((n) => L.push('  ' + n + ': not found in the hiscores'));
        if (!r.hasBaseline) L.push('No earlier post to compare with yet.');
        else if (r.changes) L.push(r.changes + ' change(s) since the last post' + (r.wouldPost ? ': a post is due by the normal rules.' : ', not due yet.'));
        else L.push('No change since the last post.');
        return L;
      },
    },
  };
  return handlers;
}

module.exports = { createCommandHost, createHandlers, cleanArgs, cleanLines, scrub, LIMITS };
