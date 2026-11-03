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
  const blank = () => ({ v: 1, urlKey: null, messageId: null, createdAt: 0, lastSendAt: 0, lastCreateAt: 0, lastSig: '', lastSentState: null, levels: {}, levelLog: [], day: null, lastSeenAt: 0, onlineSince: 0, idleSince: 0, state: null, lastSnap: null, etaAt: 0, etaKey: '', settings: null });
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

  const status = () => Object.assign({}, stat, { hasMessage: !!st.messageId, levelUps24h: st.levelLog.filter((x) => now() - x.t <= 24 * 3600 * 1000).length });
  function forget() { st.messageId = null; st.lastSig = ''; st.lastSendAt = 0; save(true); }
  function flushState() { if (dirty) save(true); }
  return { tick, shutdown, status, forget, flushState, _state: () => st };
}

module.exports = { createBoard, settingsFrom, fieldsFrom, OFFLINE_GRACE_MS, STALE_SNAP_MS, RECREATE_GAP_MS, STATE_CHANGE_GAP_MS };
