// ScapeLite clan status board, watcher side. Keeps ONE Discord message (your card) up to date through the shared sender
// (overlay/discord-sender.js): it creates the message once (POST ?wait=true), remembers its id locally, then edits it (PATCH).
//
//   * tick(ctx) is called every ~15 s by the watcher with the newest snapshot from the page (or none when the game is closed). Nothing here ever
//     waits for Discord inside the watcher's loops: a tick that is still sending makes the next one return at once.
//   * The card is only edited when its rendered content really changed AND the refresh interval (1 to 5 minutes, default 2) has passed. A change of
//     state (online / idle / offline) may go out after 30 s. Relative times use Discord's <t:..:R> tags, which tick without any edit.
//   * Recent level-ups are found by comparing the skill levels of successive snapshots (and against the levels remembered from the last run), and
//     kept 24 hours in the state file, so they survive restarts.
//   * A deleted message (404) is recreated, at most once every 30 s. A dead webhook (401/403/404 on the webhook itself) is left alone by the
//     sender. On a graceful stop one last "Offline" edit is sent. A game that is closed shows the grey "offline, last seen" card.
//   * Each ScapeLite only ever edits ITS OWN message (the id is stored in clan-board-state.json, next to a short hash of the webhook URL; the URL
//     itself is never stored there).
'use strict';

const Card = require('./clan-board-card');
const Roster = require('./clan-board-roster');
const { readJsonRecover, writeJsonAtomic } = require('./safe-json');

const OFFLINE_GRACE_MS = 90 * 1000;       // no fresh snapshot for this long = the game is closed (or not logged in)
const STALE_SNAP_MS = 45 * 1000;          // a snapshot older than this is not trusted as "now"
const RECREATE_GAP_MS = 30 * 1000;        // a deleted message is recreated at most this often
const STATE_CHANGE_GAP_MS = 30 * 1000;    // online <-> idle <-> offline may be edited sooner than the refresh interval
const LEVELUP_KEEP_MS = 25 * 3600 * 1000;
const FEATURE = 'board';
const WEBHOOK_NAME = 'ScapeLite';          // the name of the card's message; Discord fixes it when the message is created
const LOGO_NAME = 'logo.png';

// The ScapeLite logo, attached to every create and edit as attachment://logo.png (the card header icon). Sent as multipart on EVERY edit with
// attachments [{id: 0}]: that was verified live to keep exactly one copy and a working icon however many edits follow, where a plain JSON edit relies
// on Discord keeping an old upload alive. Missing file = no logo, plain JSON.
function loadLogo() {
  try { return { name: LOGO_NAME, type: 'image/png', data: require('fs').readFileSync(require('path').join(__dirname, '..', 'branding', 'png', 'logo-128.png')) }; } catch (e) { return null; }
}

const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function fieldsFrom(plugin) {
  const KEY = { task: 'clanBoardTask', location: 'clanBoardLocation', progress: 'clanBoardProgress', levelUps: 'clanBoardLevelUps', totalLevel: 'clanBoardTotalLevel', xpHr: 'clanBoardXpHr', hp: 'clanBoardHp', slayer: 'clanBoardSlayer', fortress: 'clanBoardFortress', onlineSince: 'clanBoardOnlineSince', today: 'clanBoardToday' };
  const out = {};
  Card.FIELD_KEYS.forEach((k) => { const v = plugin ? plugin[KEY[k]] : undefined; out[k] = v === undefined ? Card.DEFAULT_FIELDS[k] : !!v; });
  return out;
}
const settingsFrom = (plugin) => ({ enabled: !!(plugin && plugin.clanBoardEnabled), intervalMin: clamp(plugin && plugin.clanBoardIntervalMin, 1, 5, 2), fields: fieldsFrom(plugin) });

function createBoard(o) {
  const logo = o.logo === undefined ? loadLogo() : o.logo;
  const iconUrl = logo ? 'attachment://' + logo.name : undefined;
  const withLogo = (payload) => (logo ? Object.assign({}, payload, { attachments: [{ id: 0, filename: logo.name }] }) : payload);
  const fileOpts = () => (logo ? { files: [{ name: logo.name, data: logo.data, type: logo.type }] } : {});
  const sender = o.sender, log = o.log || (() => {}), now = o.now || Date.now, file = o.statePath, urlKeyOf = o.urlKeyOf || ((u) => require('./discord-sender').hashOf(u));
  const blank = () => ({ v: 1, urlKey: null, messageId: null, createdAt: 0, lastSendAt: 0, lastCreateAt: 0, lastSig: '', lastSentState: null, levels: {}, levelLog: [], day: null, lastSeenAt: 0, onlineSince: 0, idleSince: 0, state: null, lastSnap: null, etaAt: 0, etaKey: '', settings: null, roster: null });
  let st = Object.assign(blank(), (() => { try { const v = readJsonRecover(file, null); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } })());
  const stat = { enabled: false, configured: false, lastEditAt: null, lastError: null, edits: 0, creates: 0, skipped: 0, state: null, nextDueAt: null };
  let busy = false, savedAt = 0, dirty = false;

  function save(force) {
    dirty = true;
    if (!force && now() - savedAt < 30000) return;
    try { writeJsonAtomic(file, st); savedAt = now(); dirty = false; } catch (e) { /* best effort */ }
  }

  function trackLevels(snap, t) {
    if (!snap || !snap.lv) return;
    let changed = false;
    Object.keys(snap.lv).forEach((sk) => {
      const lv = snap.lv[sk], prev = st.levels[sk];
      if (typeof lv !== 'number') return;
      if (typeof prev === 'number' && lv > prev) {
        st.levelLog.push({ skill: sk, from: prev, to: lv, t });
        log('Clan board: level-up ' + sk + ' ' + prev + ' -> ' + lv);
        changed = true;
      }
      if (prev !== lv && (typeof prev !== 'number' || lv > prev)) { st.levels[sk] = lv; changed = true; }
    });
    const before = st.levelLog.length;
    st.levelLog = st.levelLog.filter((x) => t - x.t <= LEVELUP_KEEP_MS).slice(-200);
    if (changed || before !== st.levelLog.length) save(true);
  }

  function trackDay(snap, t) {
    if (!snap || typeof snap.totalXp !== 'number') return { xp: 0, tasks: 0 };
    const k = dayKey(t);
    if (!st.day || st.day.date !== k) { st.day = { date: k, xp0: snap.totalXp, tasks0: typeof snap.tasks === 'number' ? snap.tasks : 0 }; save(true); }
    return { xp: Math.max(0, snap.totalXp - st.day.xp0), tasks: Math.max(0, (typeof snap.tasks === 'number' ? snap.tasks : st.day.tasks0) - st.day.tasks0) };
  }

  // keep the finish time steady: it only moves when the new estimate differs by more than a minute or 10 % of what is left
  function steadyEta(snap, t) {
    const task = snap && snap.task;
    if (!task || !task.etaAt) return;
    const key = [task.skill, task.text, task.goal].join('|');
    const fresh = Math.round(task.etaAt / 30000) * 30000;
    if (st.etaKey === key && st.etaAt && st.etaAt > t - 60000 && Math.abs(fresh - st.etaAt) < Math.max(60000, 0.1 * Math.max(0, st.etaAt - t))) task.etaAt = st.etaAt;
    else { task.etaAt = fresh; st.etaKey = key; st.etaAt = fresh; }
  }

  function compactSnap(s) {
    return { name: s.name, state: s.state, task: s.task, totalLevel: s.totalLevel, xpHr: s.xpHr, hp: s.hp, slay: s.slay, fortress: s.fortress, travelling: s.travelling };
  }

  // ctx: { url, plugin (the Plugins-tab values, null when the page is not reachable), snap (null when there is none), connected }
  async function tick(ctx) {
    const t = now(), c = ctx || {};
    if (c.plugin) { st.settings = settingsFrom(c.plugin); }
    const set = st.settings || settingsFrom(null);
    stat.enabled = !!set.enabled; stat.configured = !!c.url;
    if (!set.enabled || !c.url) { stat.state = null; return { sent: false, why: !set.enabled ? 'off' : 'no webhook' }; }
    if (busy) return { sent: false, why: 'busy' };
    const key = urlKeyOf(c.url);
    if (st.urlKey && st.urlKey !== key) { st.messageId = null; st.lastSig = ''; st.lastSendAt = 0; log('Clan board: the webhook changed, a new card will be created.'); }
    st.urlKey = key;

    const fresh = c.snap && c.snap.ok && t - (c.snap.ts || 0) <= STALE_SNAP_MS ? c.snap : null;
    let cls;
    if (fresh) {
      st.lastSeenAt = t;
      if (st.state === 'offline' || !st.state) st.onlineSince = t;
      cls = fresh.state === 'idle' ? 'idle' : 'online';
      if (cls === 'idle' && st.state !== 'idle') st.idleSince = t;
      trackLevels(fresh, t);
      st.lastSnap = compactSnap(fresh);
    } else if (!st.lastSeenAt) {
      return { sent: false, why: 'never seen' };
    } else {
      cls = t - st.lastSeenAt > OFFLINE_GRACE_MS ? 'offline' : (st.state || 'online');
    }
    st.state = cls; stat.state = cls;
    const today = trackDay(fresh, t);
    if (fresh) steadyEta(fresh, t);
    const snapForCard = fresh || st.lastSnap || {};
    if (cls === 'offline' && snapForCard.task) snapForCard.task = null;
    const built = Card.build({ iconUrl, name: snapForCard.name || (st.lastSnap && st.lastSnap.name) || '', snap: snapForCard, state: cls, lastSeenAt: st.lastSeenAt, onlineSince: st.onlineSince, idleSince: st.idleSince, levelUps: st.levelLog, today, fields: set.fields, now: t });

    const needCreate = !st.messageId;
    if (needCreate && (cls === 'offline' || t - st.lastCreateAt < RECREATE_GAP_MS)) { save(false); return { sent: false, why: cls === 'offline' ? 'offline, nothing to create' : 'recreate pause' }; }
    const changed = built.sig !== st.lastSig;
    const gap = needCreate ? 0 : (cls !== st.lastSentState ? STATE_CHANGE_GAP_MS : set.intervalMin * 60000);
    stat.nextDueAt = changed ? st.lastSendAt + gap : null;
    if (!changed || t - st.lastSendAt < gap) { stat.skipped++; save(false); return { sent: false, why: changed ? 'interval' : 'unchanged' }; }

    busy = true;
    try {
      let r;
      if (needCreate) {
        st.lastCreateAt = t;
        r = await sender.send(FEATURE, c.url, Object.assign({ username: WEBHOOK_NAME }, withLogo(built.payload)), Object.assign({ wait: true }, fileOpts()));
        if (r.ok && r.id) { st.messageId = r.id; st.createdAt = now(); stat.creates++; log('Clan board: card created.'); }
        else if (r.ok) { stat.lastError = 'Discord did not return a message id'; r = { ok: false, error: stat.lastError }; }
      } else {
        r = await sender.send(FEATURE, c.url, withLogo(built.payload), Object.assign({ messageId: st.messageId, replaceKey: 'board-card:' + st.messageId }, fileOpts()));
        if (r.messageGone) { st.messageId = null; st.lastCreateAt = t; log('Clan board: the card was deleted in Discord; it will be created again.'); }
        else if (r.ok) stat.edits++;
      }
      if (r.ok) {
        st.lastSig = built.sig; st.lastSendAt = now(); st.lastSentState = cls;
        stat.lastEditAt = now(); stat.lastError = null;
        save(true);
        return { sent: true, created: needCreate };
      }
      if (!r.superseded) stat.lastError = r.error || 'failed';
      save(true);
      return { sent: false, why: 'failed', error: r.error };
    } finally { busy = false; }
  }

  // Graceful stop: one last edit that says "offline" (bounded; never blocks the shutdown for long).
  async function shutdown(ctx) {
    const c = ctx || {}, set = st.settings;
    if (!set || !set.enabled || !c.url || !st.messageId || !st.lastSeenAt) { save(true); return { sent: false }; }
    const t = now();
    st.state = 'offline'; stat.state = 'offline';
    const snap = st.lastSnap ? Object.assign({}, st.lastSnap, { task: null }) : {};
    const built = Card.build({ iconUrl, name: snap.name || '', snap, state: 'offline', lastSeenAt: t, levelUps: st.levelLog, today: null, fields: set.fields, now: t });
    st.lastSeenAt = t;
    if (built.sig === st.lastSig) { save(true); return { sent: false, why: 'unchanged' }; }
    const r = await Promise.race([sender.send(FEATURE, c.url, withLogo(built.payload), Object.assign({ messageId: st.messageId, replaceKey: 'board-card:' + st.messageId }, fileOpts())), new Promise((res) => setTimeout(() => res({ ok: false, error: 'timed out' }), c.timeoutMs || 4000))]);
    if (r.ok) { st.lastSig = built.sig; st.lastSendAt = now(); st.lastSentState = 'offline'; stat.lastEditAt = now(); stat.edits++; }
    save(true);
    return { sent: !!r.ok };
  }

  // ---- roster cards: simple cards for clanmates who have no ScapeLite card (made by the host only, see overlay/clan-board-roster.js) ----
  const rstat = { enabled: false, host: false, cards: 0, creates: 0, edits: 0, deletes: 0, lastError: null, wanted: 0, lastTickAt: null };
  let rbusy = false;
  const cardMap = (rs) => { const m = {}; Object.keys(rs.cards).forEach((h) => { m[h] = rs.cards[h].id; }); return m; };
  // ctx: { url, enabled (the roster switch AND the board switch), host (this PC is the lease leader, or there is no lease), hostName, roster ({state, members:[{name, online}]}), exclude [names],
  //        self (this player), presence (Set of hashes with their own card), leaseCards ({hash: id}), hiscores ({name: {rank, totalLevel}}), setCards(map) (writes the ids to the lease) }
  async function rosterTick(ctx) {
    const c = ctx || {}, t = now();
    const rs = st.roster || (st.roster = { urlKey: null, cards: {}, seen: {}, lastCreateAt: 0, gone: {} });
    rstat.enabled = !!c.enabled; rstat.host = !!c.host; rstat.lastTickAt = t; rstat.cards = Object.keys(rs.cards).length;
    if (!c.url) return { why: 'no webhook' };
    const key = urlKeyOf(c.url);
    if (rs.urlKey && rs.urlKey !== key) { rs.cards = {}; rs.gone = {}; log('Clan board: the webhook changed, roster cards will be made again.'); }
    rs.urlKey = key;
    if (rbusy) return { why: 'busy' };
    const ids = {};
    Object.keys(c.leaseCards || {}).forEach((h) => { ids[h] = c.leaseCards[h]; });
    Object.keys(rs.cards).forEach((h) => { ids[h] = rs.cards[h].id; });
    let plan;
    if (!c.enabled) {
      // switched off: take down what this PC made (only a host, or a lone user, ever made any)
      if (!c.host || !Object.keys(rs.cards).length) return { why: 'off' };
      plan = { want: [], remove: Object.keys(rs.cards) };
    } else if (!c.host) { return { why: 'not host' }; }
    else {
      const ro = c.roster;
      if (!ro || ro.state !== 'ok' || !Array.isArray(ro.members) || !ro.members.length) return { why: 'roster not ready' };   // loading, no clan, or the bridge is not attached: touch nothing
      const inClan = new Set(ro.members.map((m) => Roster.hashOf(m.name)));
      ro.members.forEach((m) => { if (m.online) rs.seen[Roster.hashOf(m.name)] = t; });
      Object.keys(rs.seen).forEach((h) => { if (!inClan.has(h)) delete rs.seen[h]; });
      plan = Roster.planRoster({ roster: ro.members, exclude: c.exclude, self: c.self, presence: c.presence, ids });
      rstat.wanted = plan.want.length;
    }
    rbusy = true;
    let changedMap = false, creates = 0;
    try {
      for (const h of plan.remove) {
        const id = ids[h]; if (!id) { delete rs.cards[h]; continue; }
        const r = await sender.send(FEATURE, c.url, null, { method: 'DELETE', messageId: id });
        if (r.ok || r.messageGone) { delete rs.cards[h]; delete ids[h]; changedMap = true; rstat.deletes++; log('Clan board: removed a roster card (' + (c.enabled ? 'the member has their own card, left, or is switched off' : 'roster cards are switched off') + ').'); }
        else rstat.lastError = r.error || 'failed';
      }
      for (const m of plan.want) {
        const h = m.hash, facts = Roster.memberFacts(m, rs.seen, c.hiscores, t), built = Roster.buildRosterCard(facts, c.hostName, t, iconUrl);
        const cur = rs.cards[h], leaseId = ids[h];
        if (!cur && !leaseId) {
          if (c.canCreate === false || creates >= 2 || t - rs.lastCreateAt < Roster.CREATE_GAP_MS || (rs.gone[h] && t - rs.gone[h] < Roster.RECREATE_GAP_MS)) continue;
          rs.lastCreateAt = t; creates++;
          const r = await sender.send(FEATURE, c.url, Object.assign({ username: WEBHOOK_NAME }, withLogo(built.payload)), Object.assign({ wait: true }, fileOpts()));
          if (r.ok && r.id) { rs.cards[h] = { id: r.id, sig: built.sig, sentAt: now(), state: facts.online ? 'online' : 'offline' }; ids[h] = r.id; changedMap = true; rstat.creates++; log('Clan board: roster card created for a clanmate without a ScapeLite card.'); }
          else rstat.lastError = r.error || 'failed';
          continue;
        }
        const card = cur || (rs.cards[h] = { id: leaseId, sig: '', sentAt: 0, state: null });   // a card the previous host made: adopt it
        if (!cur) changedMap = true;
        const stateNow = facts.online ? 'online' : 'offline';
        if (built.sig === card.sig) continue;
        if (card.sentAt && t - card.sentAt < (stateNow !== card.state ? Roster.STATE_GAP_MS : Roster.EDIT_GAP_MS)) continue;
        const r = await sender.send(FEATURE, c.url, withLogo(built.payload), Object.assign({ messageId: card.id, replaceKey: 'roster-card:' + card.id }, fileOpts()));
        if (r.messageGone) { delete rs.cards[h]; delete ids[h]; rs.gone[h] = t; changedMap = true; log('Clan board: a roster card was deleted in Discord; it will be made again.'); }
        else if (r.ok) { card.sig = built.sig; card.sentAt = now(); card.state = stateNow; rstat.edits++; }
        else if (!r.superseded) rstat.lastError = r.error || 'failed';
      }
      if (changedMap && typeof c.setCards === 'function') { try { await c.setCards(cardMap(rs)); } catch (e) { /* the lease is written again at the next change */ } }
      rstat.cards = Object.keys(rs.cards).length;
      save(true);
      return { ok: true, creates, changed: changedMap };
    } finally { rbusy = false; }
  }
  const status = () => Object.assign({}, stat, { roster: Object.assign({}, rstat),  hasMessage: !!st.messageId, levelUps24h: st.levelLog.filter((x) => now() - x.t <= 24 * 3600 * 1000).length });
  function forget() { st.messageId = null; st.lastSig = ''; st.lastSendAt = 0; save(true); }
  function flushState() { if (dirty) save(true); }
  return { tick, rosterTick, shutdown, status, forget, flushState, _state: () => st };
}

module.exports = { createBoard, settingsFrom, fieldsFrom, OFFLINE_GRACE_MS, STALE_SNAP_MS, RECREATE_GAP_MS, STATE_CHANGE_GAP_MS };
