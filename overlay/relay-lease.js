// Relay lease: keeps N ScapeLite instances that share one Discord webhook from posting the same thing N times. Webhooks only, no bot.
//
// Every member of a clan sees the same clan chat, so every member's ScapeLite would relay the same line. Instead the instances agree on ONE leader.
// Only the leader posts the shared stream (clan chat events, digest, hiscores); the others stay in standby and take over if it goes quiet.
//
// v2 (0.4.0): the agreement NO LONGER lives in the channel people read. It lives in one message on a separate, OPTIONAL "lease webhook" that the clan points at a
// private channel (docs/DISCORD-RELAY-AUDIT.md, part 8). Without a lease webhook there is no lease at all and nothing is written to any Discord channel or webhook.
// A webhook token may create, read (GET) and edit (PATCH) its own messages, so the lease webhook only ever holds this one message:
//
//   -# ScapeLite relay lease · do not edit or delete · leader Wulf
//   ||{"v":1,"id":"a1b2c3d4","n":"Wulf","e":3,"s":120,"t":1793...,"lk":["ab12cd34"],"dg":0,"cl":{"1f2e3d4c":"a1b2c3d4"}}||
//
//   id  instance id of the leader ("" = released)      e  epoch (+1 at every takeover)     s  heartbeat counter (+1 per beat)
//   t   leader's clock (information only, never used for decisions)                         lk keys of the last events the leader relayed (failover de-dup)
//   dg  when the leader last posted the digest (followers empty their copy)                 cl once-only claims { key8: instance id } (raid summaries)
//
// Finding the message without any setup: its id is written into the LEASE webhook's NAME as a suffix "[sl:<id>]" (a webhook token may rename its webhook, and GET on the
// webhook returns the name). The first instance creates the message and sets the suffix; everyone else reads it. Verified on real Discord (see the audit doc).
// "mv" is the highest ScapeLite version number any instance has written (version signalling: an instance that is behind says so locally; nothing else is shared).
//
// Rules that make it safe:
//   * No cross-machine clocks: a follower only measures, on ITS OWN clock, how long the heartbeat counter has not changed (ttlMs). Clock skew / time zones do not matter.
//   * The leader fences itself: if it has not confirmed the lease for fenceMs (< ttlMs) it stops posting, so a partitioned leader is silent before anyone takes over.
//   * Takeover: random jitter, re-read, write epoch+1, wait, read again - only if the lease still names me do I post. Two writers: the later write wins and the
//     loser sees it on the read-back (or on its next heartbeat, which reads before it writes) and steps down.
//   * Anything unclear (Discord down, message unreadable, corrupt) = role "unsure": nothing is posted, events wait. Never "post anyway".
'use strict';
const crypto = require('crypto');

const DEFAULTS = {
  ttlMs: 90000,            // heartbeat counter unchanged this long => the leader is gone
  fenceMs: 45000,          // leader without a confirmed heartbeat this long stops posting
  heartbeatMs: 15000,
  preemptRetryMs: 20000,   // a preferred host that lost a takeover try (the leader's own heartbeat can overwrite it) waits this long before the next one
  pollMs: 15000,           // followers / unsure instances read the lease this often
  takeoverJitterMs: 2500,
  verifyDelayMs: 2500,     // wait before reading back after a write
  discoverRetryMs: 10000,
  keepKeys: 40,
  claimSettleMs: 2200,
  claimRetries: 3,
};

const POINTER_RE = /\s*\[sl:(\d{15,25})\]\s*$/;
const STATE_RE = /\|\|(\{[\s\S]*\})\|\|/;
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const cmpVer = (a, b) => { const p = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; };
const goodVer = (v) => typeof v === 'string' && VER_RE.test(v);
const maxVer = (a, b) => (goodVer(a) && (!goodVer(b) || cmpVer(a, b) > 0)) ? a : (goodVer(b) ? b : '');
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
const hash8 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const newInstanceId = () => crypto.randomBytes(4).toString('hex');

function encodeState(st, label) {
  // Discord shows <t:unix:f> in each reader's own time zone and <t:unix:R> as "2 minutes ago": the message says by itself when the lease was last written
  const sec = Number(st.t) > 1e12 ? Math.floor(Number(st.t) / 1000) : 0;
  const head = `-# ScapeLite relay lease · do not edit or delete · leader ${String(st.n || label || '-').replace(/[^\w .-]/g, '').slice(0, 24) || '-'}${st.id ? '' : ' (released)'}${sec ? ` · last written <t:${sec}:f> (<t:${sec}:R>)` : ''}`;
  return `${head}\n||${JSON.stringify(st)}||`;
}
function decodeState(content) {
  const m = STATE_RE.exec(String(content || ''));
  if (!m) return null;
  try { const j = JSON.parse(m[1]); return j && typeof j === 'object' && j.v === 1 ? j : null; } catch (e) { return null; }
}

// One lease client per webhook. `send` is the shared sender's send(feature, url, payload, opts).
function createLease(o) {
  const opt = Object.assign({}, DEFAULTS, o.options || {});
  const me = o.instanceId;
  const send = o.send;
  const url = o.url;
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const sleep = o.sleep || sleepReal;
  const random = o.random || Math.random;
  const label = () => (typeof o.label === 'function' ? o.label() : o.label) || '';
  const prefer = () => { try { return !!(typeof o.prefer === 'function' ? o.prefer() : o.prefer); } catch (e) { return false; } };   // this PC wants to be the host whenever it can
  const myVer = () => { const v = typeof o.version === 'function' ? o.version() : o.version; return goodVer(v) ? v : ''; };
  const rank = (parseInt(me.slice(0, 4), 16) % 1000) / 1000 * opt.takeoverJitterMs * 0.5;   // deterministic tie-break: instances do not all jitter alike

  const S = {
    role: 'unsure',            // 'leader' | 'follower' | 'unsure'
    messageId: o.messageId || null, deadId: null,
    state: null,               // last parsed lease
    lastKey: '', lastChangeAt: 0, lastOkAt: 0, lastConfirmedAt: 0, lastBeatAt: 0, lastPollAt: 0, nextDiscoverAt: 0,
    myEpoch: 0, pendingKeys: [], pendingShared: {}, errors: 0, lastError: '', busy: false, released: false,
    since: now(), lastPreemptAt: 0, takeovers: 0, orphans: [], created: new Set(), pointerSwitches: 0, newest: '', verPushAt: 0,
  };

  const req = (feature, payload, opts) => send(feature, url, payload, opts);
  const fail = (r) => { S.errors++; S.lastError = (r && r.error) || 'failed'; };

  function becomeRole(role, why) {
    if (S.role !== role) log(`Relay lease: ${S.role} -> ${role}${why ? ' (' + why + ')' : ''}`);
    S.role = role;
  }

  async function readMessage() {
    const r = await req('lease', null, { method: 'GET', messageId: S.messageId });
    if (r.ok) {
      const st = decodeState(r.json && r.json.content);
      S.gap = S.lastOkAt ? now() - S.lastOkAt : 0;       // how long this PC could not read the lease before this read
      S.lastOkAt = now(); S.errors = 0;
      return { ok: true, state: st, corrupt: !st };
    }
    if (r.messageGone) return { gone: true };
    fail(r);
    return { ok: false, error: r.error };
  }

  function observe(st) {
    const key = `${st.id}:${st.e}:${st.s}`;
    // Blind for a while (Discord down, PC asleep): that says nothing about the leader. Start measuring its silence again from this read.
    if (key !== S.lastKey || S.gap > opt.pollMs * 4) { S.lastKey = key; S.lastChangeAt = now(); S.gap = 0; }
    // Who holds the lease is logged whenever it changes (a new instance, a new name, a release), so the log tells the story of the leader
    const who = st.id ? `${st.n || '?'} [${st.id}]` : '(released)';
    if (S.seenWho !== undefined && S.seenWho !== who) log(`Relay lease: the leader changed from ${S.seenWho} to ${who} (epoch ${st.e})`);
    S.seenWho = who;
    S.state = st;
    S.newest = maxVer(S.newest, st.mv);
  }

  function stateFor(base, patch) {
    const st = Object.assign({ v: 1, id: '', n: '', e: 0, s: 0, t: now(), lk: [], dg: 0, cl: {} }, base, patch);
    st.t = now();   // every write says when it was made (the "last written" time in the message header)
    return st;
  }

  async function writeMessage(st) {
    const r = await req('lease', { content: encodeState(st, label()) }, { messageId: S.messageId });
    if (!r.ok) { if (r.messageGone) { S.deadId = S.messageId; S.messageId = null; } fail(r); }
    return r;
  }

  // a lease message this PC made but lost the race for: delete it, and if Discord says no right now, try again later
  async function dropOrphan(id) {
    const r = await req('lease', null, { method: 'DELETE', messageId: id });
    if (!r.ok && !r.messageGone && S.orphans.indexOf(id) === -1) S.orphans.push(id);
  }
  async function sweepOrphans() {
    for (const id of S.orphans.slice()) {
      const r = await req('lease', null, { method: 'DELETE', messageId: id });
      if (r.ok || r.messageGone) S.orphans.splice(S.orphans.indexOf(id), 1);
    }
  }

  // ---- finding / creating the lease message ----
  async function discover() {
    const info = await req('lease', null, { method: 'GET' });
    if (!info.ok) { fail(info); S.nextDiscoverAt = now() + opt.discoverRetryMs; becomeRole('unsure', 'webhook unreadable: ' + S.lastError); return; }
    const name = String((info.json && info.json.name) || '');
    const m = POINTER_RE.exec(name);
    if (m && m[1] !== S.deadId) { S.messageId = m[1]; S.lastPollAt = 0; return; }
    // nobody has made one yet: create it, then publish its id in the webhook name; if two instances do this at once the name decides
    const base = name.replace(POINTER_RE, '').trim() || 'ScapeLite';
    const initial = stateFor({}, { id: me, n: label(), e: 1, s: 0, mv: myVer() });
    const c = await req('lease', { username: 'ScapeLite relay lease', content: encodeState(initial, label()) }, { wait: true });
    if (!c.ok || !c.id) { fail(c); S.nextDiscoverAt = now() + opt.discoverRetryMs; return; }
    S.created.add(c.id);
    const suffix = ` [sl:${c.id}]`;
    const nm = base.slice(0, 80 - suffix.length) + suffix;
    const pn = await req('lease', { name: nm }, { method: 'PATCH', raw: true });
    if (!pn.ok) { fail(pn); await dropOrphan(c.id); S.nextDiscoverAt = now() + opt.discoverRetryMs; return; }
    await sleep(opt.verifyDelayMs + random() * 500);
    const again = await req('lease', null, { method: 'GET' });
    const m2 = again.ok ? POINTER_RE.exec(String((again.json && again.json.name) || '')) : null;
    if (m2 && m2[1] === c.id) {
      S.messageId = c.id; S.myEpoch = 1; S.lastPollAt = 0;
      log('Relay lease: created the shared lease message for this webhook (this PC will read it first).');
    } else if (m2) {
      S.messageId = m2[1]; S.lastPollAt = 0;
      await dropOrphan(c.id);   // somebody else's name suffix won: use theirs
      log('Relay lease: another instance created the lease at the same moment; using theirs.');
    } else {
      S.nextDiscoverAt = now() + opt.discoverRetryMs;
    }
  }

  // ---- the webhook name is the one source of truth for WHICH lease message counts ----
  // Two instances that start at the same moment each make a message and each write the name; the last write wins, but each may have read the name back
  // before the other one wrote. So every cycle the name is looked at again: an instance that holds a message the name does not point to switches to the
  // one it points to (and deletes its own if it made it). This is what turned "two leaders" into one on the first live run against real Discord.
  async function checkPointer() {
    const info = await req('lease', null, { method: 'GET' });
    if (!info.ok) return;                                   // cannot tell: keep what we have (the leader fences itself if reads keep failing)
    const name = String((info.json && info.json.name) || '');
    const m = POINTER_RE.exec(name);
    if (!m) {                                               // someone removed the suffix: put it back (our message is the one in use)
      if (S.messageId) {
        const base = name.trim() || 'ScapeLite', suffix = ` [sl:${S.messageId}]`;
        await req('lease', { name: base.slice(0, 80 - suffix.length) + suffix }, { method: 'PATCH', raw: true });
      }
      return;
    }
    if (m[1] === S.messageId || m[1] === S.deadId) return;
    const old = S.messageId;
    S.messageId = m[1]; S.pointerSwitches++; S.lastKey = ''; S.lastPollAt = 0; S.lastConfirmedAt = 0; S.state = null;
    becomeRole('unsure', 'the webhook points to another lease message');
    if (old && S.created.has(old)) { S.created.delete(old); await dropOrphan(old); }
  }

  // ---- taking over ----
  async function takeover(seen, why, soft) {
    S.takeovers++;
    const seenKey = soft ? `${seen.id}:${seen.e}` : `${seen.id}:${seen.e}:${seen.s}`;   // soft = taking over from a leader that is alive (preferred host): its heartbeat moving on is no sign of a rival
    await sleep(random() * opt.takeoverJitterMs + rank);
    const r = await readMessage();
    if (r.gone) { S.deadId = S.messageId; S.messageId = null; return; }
    if (!r.ok) return;                                   // cannot read: do not write blind
    const cur = r.state;                                 // null = the content is damaged: overwrite it below
    if (cur) {
      if (cur.id === me) { observe(cur); return; }       // picked up by the next poll
      if ((soft ? `${cur.id}:${cur.e}` : `${cur.id}:${cur.e}:${cur.s}`) !== seenKey) { observe(cur); becomeRole('follower', 'someone else moved first'); return; }
    }
    const next = stateFor(cur || {}, { id: me, n: label(), e: ((cur && cur.e) || 0) + 1, s: 0, pf: prefer() ? 1 : 0, mv: maxVer(cur && cur.mv, myVer()) });   // keeps lk: the old leader's last posts, so the standby replay does not repeat them
    const w = await writeMessage(next);
    if (!w.ok) return;
    S.myEpoch = next.e;
    await sleep(opt.verifyDelayMs + random() * 500);
    const v = await readMessage();
    if (v.ok && v.state && v.state.id === me && v.state.e === S.myEpoch) {
      observe(v.state);
      S.lastConfirmedAt = S.lastBeatAt = now();
      becomeRole('leader', why);
    } else if (v.ok && v.state) {
      observe(v.state);
      becomeRole('follower', 'another instance won the takeover');
    }
  }

  // ---- leader heartbeat (read before write) ----
  async function beat() {
    await checkPointer();
    if (S.role !== 'leader') return;
    const r = await readMessage();
    if (r.gone) { S.deadId = S.messageId; S.messageId = null; becomeRole('unsure', 'lease message deleted'); return; }
    if (!r.ok) { if (now() - S.lastConfirmedAt > opt.fenceMs) becomeRole('unsure', 'lease not confirmed for ' + Math.round(opt.fenceMs / 1000) + ' s'); return; }
    if (!r.state) { if (now() - S.lastConfirmedAt > opt.fenceMs) becomeRole('unsure', 'lease unreadable'); }
    const cur = r.state;
    if (cur && cur.id !== me) { observe(cur); becomeRole(cur.id ? 'follower' : 'unsure', cur.id ? 'another instance holds the lease' : 'lease released'); return; }
    const sentKeys = S.pendingKeys.slice(), sentShared = Object.assign({}, S.pendingShared);   // anything noted while the write is in flight stays for the next beat
    const lk = (cur && cur.lk || []).concat(sentKeys).slice(-opt.keepKeys);
    const next = stateFor(cur || {}, { id: me, n: label(), e: (cur && cur.e) || S.myEpoch || 1, s: ((cur && cur.s) || 0) + 1, lk, pf: prefer() ? 1 : 0, mv: maxVer(cur && cur.mv, myVer()) });
    Object.assign(next, sentShared);
    const w = await writeMessage(next);
    if (w.ok) { S.pendingKeys = S.pendingKeys.slice(sentKeys.length); Object.keys(sentShared).forEach((k) => { if (S.pendingShared[k] === sentShared[k]) delete S.pendingShared[k]; }); S.lastConfirmedAt = S.lastBeatAt = now(); observe(next); }
    else if (now() - S.lastConfirmedAt > opt.fenceMs) becomeRole('unsure', 'could not write the lease');
  }

  // ---- version signalling: a newer ScapeLite writes its number into the lease so the others (who read it every poll) can tell their user they are behind ----
  async function pushVersion(st) {
    const v = myVer();
    if (!v || (st.mv && cmpVer(v, st.mv) <= 0) || now() - S.verPushAt < opt.pollMs) return;
    S.verPushAt = now();
    await writeMessage(Object.assign({}, st, { mv: v }));   // read-modify-write of one field; the leader's next beat keeps it. A lost race is retried by the next poll.
  }

  // ---- clan board (overlay/clan-board-roster.js) ----
  // "bm": hash of a lower-case player name -> 1, written by every ScapeLite that keeps its OWN board card (any entry = "this player has a card, the host makes none").
  // "bc": hash -> message id of a roster card the host made, so a new host after a failover edits the same messages. Old copies keep unknown fields when they rewrite the lease.
  // read, change, write, then read back: a leader heartbeat that was in flight at the same moment can overwrite the change, so it is checked and tried again (3 times)
  async function boardWrite(mutate) {
    if (!S.messageId) return { ok: false, error: 'no lease yet' };
    for (let a = 0; a < 3; a++) {
      const r = await readMessage();
      if (!r.ok || !r.state) return { ok: false, error: r.error || 'lease unreadable' };
      const patch = mutate(r.state);
      if (!patch) return { ok: true, same: true };
      const next = Object.assign({}, r.state, patch);
      const w = await writeMessage(next);
      if (!w.ok) return { ok: false, error: w.error };
      await sleep(opt.verifyDelayMs + random() * 300);
      const v = await readMessage();
      if (v.ok && v.state && Object.keys(patch).every((k) => JSON.stringify(v.state[k]) === JSON.stringify(patch[k]))) { observe(v.state); return { ok: true }; }
    }
    return { ok: false, error: 'the lease was overwritten three times in a row' };
  }
  const boardView = () => {
    const st = S.state || {};
    return { known: !!S.state, present: new Set(Object.keys(st.bm || {})), cards: Object.assign({}, st.bc || {}) };
  };
  // announce this player (a no-op when the entry is already there); keep (a Set of hashes) drops the entries of players who left the clan
  const boardAnnounce = (hash, keep) => boardWrite((st) => {
    const bm = Object.assign({}, st.bm || {}); let changed = false;
    if (!bm[hash]) { bm[hash] = 1; changed = true; }
    if (keep && keep.size) Object.keys(bm).forEach((k) => { if (k !== hash && !keep.has(k)) { delete bm[k]; changed = true; } });
    const keys = Object.keys(bm); while (keys.length > 40) { delete bm[keys.shift()]; changed = true; }
    return changed ? { bm } : null;
  });
  const boardSetCards = (map) => boardWrite((st) => {
    const bc = {}; Object.keys(map || {}).slice(0, 100).forEach((k) => { if (/^[0-9a-f]{8}$/.test(k) && /^\d{15,25}$/.test(String(map[k]))) bc[k] = String(map[k]); });
    return JSON.stringify(st.bc || {}) === JSON.stringify(bc) ? null : { bc };
  });
  // ---- follower / unsure poll ----
  async function poll() {
    S.lastPollAt = now();
    await checkPointer();
    const r = await readMessage();
    if (r.gone) { S.deadId = S.messageId; S.messageId = null; becomeRole('unsure', 'lease message deleted'); return; }
    if (!r.ok) { if (S.role === 'follower' && now() - S.lastOkAt > opt.ttlMs) becomeRole('unsure', 'lease unreadable'); return; }
    if (!r.state) {   // content without a lease in it (edited by hand): after the grace period, write a fresh one
      if (!S.corruptSince) S.corruptSince = now();
      if (now() - S.corruptSince > opt.ttlMs) { S.corruptSince = 0; await takeover({ id: '', e: 0, s: 0 }, 'lease content was damaged'); }
      return;
    }
    S.corruptSince = 0;
    const st = r.state;
    observe(st);
    await pushVersion(st);
    if (st.id === me) {                      // this PC was the leader before a restart: continue, after a fresh confirmation
      S.myEpoch = st.e; becomeRole('leader', 'resumed'); S.lastBeatAt = 0;   // posting starts after the first heartbeat has re-checked the webhook name and written
      return;
    }
    if (!st.id) { await takeover(st, 'lease was released'); return; }
    if (now() - S.lastChangeAt > opt.ttlMs) { await takeover(st, 'leader silent for ' + Math.round((now() - S.lastChangeAt) / 1000) + ' s'); return; }
    // A PC set to "prefer to be host" takes the lead from a healthy leader that does not prefer it (never from another preferred PC: nobody fights over it)
    if (prefer() && !st.pf && now() - S.lastPreemptAt > opt.preemptRetryMs) { S.lastPreemptAt = now(); await takeover(st, 'this PC is the preferred host', true); return; }
    becomeRole('follower', st.n ? 'leader is ' + st.n : '');
  }

  async function tick() {
    if (S.busy || S.released) return;
    S.busy = true;
    try {
      const t = now();
      if (S.orphans.length && t - S.lastPollAt >= opt.pollMs) { S.lastPollAt = t; await sweepOrphans(); }
      if (!S.messageId) { if (t >= S.nextDiscoverAt) await discover(); return; }
      if (S.role === 'leader') { if (t - S.lastBeatAt >= opt.heartbeatMs || S.lastBeatAt === 0) await beat(); return; }
      if (t - S.lastPollAt >= opt.pollMs) await poll();
    } catch (e) {
      fail({ error: String(e && e.message || e) });
    } finally { S.busy = false; }
  }

  // Once-only claim (raid summaries: every raid member's PC would post the same one). ok:true = this PC may post it.
  // `alsoKeys`: neighbouring keys (e.g. the previous and next time bucket) that count as the same thing if somebody else already claimed them.
  async function claim(key, alsoKeys) {
    if (!S.messageId) return { ok: false, error: 'no lease yet' };
    const k = hash8(key), others = (alsoKeys || []).map(hash8);
    for (let i = 0; i < opt.claimRetries; i++) {
      const r = await readMessage();
      if (!r.ok || !r.state) return { ok: false, error: r.error || 'lease unreadable' };
      const cl = Object.assign({}, r.state.cl || {});
      if (cl[k]) return { ok: cl[k] === me, by: cl[k] };
      const near = others.find((x) => cl[x]);
      if (near) return { ok: cl[near] === me, by: cl[near] };
      cl[k] = me;
      const keys = Object.keys(cl);
      while (keys.length > 12) delete cl[keys.shift()];
      const w = await writeMessage(Object.assign({}, r.state, { cl }));
      if (!w.ok) return { ok: false, error: w.error };
      await sleep(opt.claimSettleMs + random() * 700);
      const v = await readMessage();
      if (!v.ok || !v.state) return { ok: false, error: v.error || 'lease unreadable' };
      const owner = (v.state.cl || {})[k] || (others.map((x) => (v.state.cl || {})[x]).find((x) => x && x !== me));
      if (owner) return { ok: owner === me, by: owner };
      // my write was overwritten by somebody else's at the same moment: try again
    }
    return { ok: false, error: 'could not settle the claim' };
  }

  async function release() {
    S.released = true;
    if (S.role === 'leader' && S.messageId) {
      const r = await readMessage();
      if (r.ok && r.state && r.state.id === me) await writeMessage(Object.assign({}, r.state, { id: '', s: (r.state.s || 0) + 1, lk: (r.state.lk || []).concat(S.pendingKeys).slice(-opt.keepKeys) }));
    }
    becomeRole('unsure', 'released');
  }

  // ---- team settings (overlay/team-sync.js): a few extra messages on the lease webhook, found through the "ts" field of the lease state ----
  // Old copies of ScapeLite keep unknown fields when they rewrite the lease, so "ts" survives their heartbeats. teamMeta() costs no request: the lease is read anyway.
  const TS = require('./team-sync');
  const teamMeta = () => (S.state ? TS.cleanMeta(S.state.ts) : null);
  async function teamFetch() {
    if (!S.messageId) return { ok: false, error: 'There is no shared lease yet. Is the lease webhook saved and the game running?' };
    const r = await readMessage();
    if (!r.ok || !r.state) return { ok: false, error: 'The lease message could not be read right now.' };
    const meta = TS.cleanMeta(r.state.ts);
    if (!meta) return { ok: true, none: true };
    const parts = [];
    for (const id of meta.ids) {
      const g = await req('lease', null, { method: 'GET', messageId: id });
      if (!g.ok) return { ok: false, error: g.messageGone ? 'A part of the team settings was deleted from the channel. Ask the publisher to publish again.' : 'Discord did not answer: ' + (g.error || 'unknown error') };
      parts.push(TS.parsePart(g.json && g.json.content));
    }
    const j = TS.joinParts(parts, meta.ver);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, meta, text: j.text };
  }
  // text = TS.encodeText(...).text. Edits the existing part messages (new ones only when more are needed), points the lease at them LAST, reads the pointer back and
  // retries if a heartbeat overwrote it at the same moment. Parts that are no longer needed are deleted.
  async function teamPublish(text, info) {
    if (!S.messageId) return { ok: false, error: 'There is no shared lease yet. Is the lease webhook saved and the game running?' };
    const parts = TS.toParts(String(text || ''));
    if (!parts.length || parts.length > TS.LIMITS.maxParts) return { ok: false, error: 'The settings are too large to publish.' };
    const r0 = await readMessage();
    if (!r0.ok || !r0.state) return { ok: false, error: 'The lease message could not be read right now.' };
    const old = TS.cleanMeta(r0.state.ts), oldIds = old ? old.ids : [], ver = (old ? old.ver : 0) + 1, ids = [];
    for (let i = 0; i < parts.length; i++) {
      const content = TS.partMessage(i, parts.length, ver, parts[i]);
      if (oldIds[i]) {
        const e = await req('lease', { content }, { messageId: oldIds[i] });
        if (e.ok) { ids.push(oldIds[i]); continue; }
        if (!e.messageGone) return { ok: false, error: 'Discord did not take the edit: ' + (e.error || 'unknown error') };
      }
      const c = await req('lease', { username: 'ScapeLite team settings', content }, { wait: true });
      if (!c.ok || !c.id) return { ok: false, error: 'Discord did not take the message: ' + (c.error || 'unknown error') };
      ids.push(c.id);
    }
    const meta = { ver, ids, sum: String(text).slice(String(text).lastIndexOf('.') + 1), by: label(), at: now(), u: info && info.urls ? 1 : 0 };
    for (let a = 0; a < 3; a++) {
      const cur = await readMessage();
      if (!cur.ok || !cur.state) return { ok: false, error: 'The lease message could not be read right now.' };
      const w = await writeMessage(Object.assign({}, cur.state, { ts: meta }));
      if (!w.ok) return { ok: false, error: 'The lease could not be written: ' + (w.error || 'unknown error') };
      await sleep(opt.verifyDelayMs + random() * 300);
      const v = await readMessage();
      const m2 = v.ok && v.state ? TS.cleanMeta(v.state.ts) : null;
      if (m2 && m2.ver === ver) {
        for (const id of oldIds.slice(ids.length)) await req('lease', null, { method: 'DELETE', messageId: id });
        if (v.state) observe(v.state);
        log('Team settings published: version ' + ver + ' in ' + ids.length + ' message' + (ids.length > 1 ? 's' : '') + (meta.u ? ' (with webhook addresses)' : '') + '.');
        return { ok: true, meta };
      }
    }
    return { ok: false, error: 'The lease was rewritten at the same moment. Press Publish again.' };
  }

  return {
    tick, claim, release, teamMeta, teamFetch, teamPublish, resume: () => { S.released = false; S.lastPollAt = 0; },
    role: () => S.role,
    canRelay: () => S.role === 'leader' && now() - S.lastConfirmedAt < opt.fenceMs,
    noteRelayed: (key) => { if (key) S.pendingKeys.push(key); if (S.pendingKeys.length > 200) S.pendingKeys.splice(0, S.pendingKeys.length - 200); },
    alreadyRelayed: (key) => !!(S.state && Array.isArray(S.state.lk) && S.state.lk.indexOf(key) !== -1),
    setShared: (patch) => { Object.assign(S.pendingShared, patch); S.lastBeatAt = 0; },
    shared: () => (S.state ? { dg: S.state.dg || 0, lk: S.state.lk || [], leader: S.state.n || '', epoch: S.state.e || 0 } : null),
    boardView, boardAnnounce, boardSetCards,
    info: () => ({ version: myVer(), newest: S.newest, newerVersion: (S.newest && myVer() && cmpVer(S.newest, myVer()) > 0) ? S.newest : '', role: S.role, leader: S.state && S.state.n || '', epoch: S.state && S.state.e || 0, beat: S.state && S.state.s || 0, hasLease: !!S.messageId, errors: S.errors, lastError: S.lastError, takeovers: S.takeovers, sinceMs: now() - S.since }),
    _S: S,
  };
}

// The manager owns ONE lease: the one on the lease webhook (o.leaseUrl, a string or a function so a settings change takes effect live). Every shared stream
// (relay, digest, hiscores, raid) asks for it with forWebhook(its own posting url) and gets the same lease. No lease webhook = null = no coordination, nothing written to Discord.
function createLeaseManager(o) {
  const leases = new Map();
  const instanceId = o.instanceId || newInstanceId();
  const leaseUrl = () => { const u = typeof o.leaseUrl === 'function' ? o.leaseUrl() : o.leaseUrl; return typeof u === 'string' ? u : ''; };
  function forWebhook() {
    const url = leaseUrl();
    if (!url) return null;
    let l = leases.get(url);
    if (!l) {
      leases.forEach((old, k) => { old.release().catch(() => {}); leases.delete(k); });   // the lease webhook was replaced: let go of the old one
      l = createLease(Object.assign({}, o, { url, instanceId })); leases.set(url, l);
    }
    return l;
  }
  return {
    instanceId, forWebhook, configured: () => !!leaseUrl(),
    tickAll: () => { const l = forWebhook(); return l ? l.tick() : Promise.resolve(); },
    releaseAll: () => Promise.all(Array.from(leases.values()).map((l) => l.release().catch(() => {}))),
    resumeAll: () => leases.forEach((l) => l.resume()),
    forget: (url) => leases.delete(url),
    all: () => leases,
  };
}

module.exports = { createLease, createLeaseManager, encodeState, decodeState, newInstanceId, hash8, cmpVer, maxVer, goodVer, DEFAULTS, POINTER_RE };
