// Scapewatch Raid Lobby Alert. READ-ONLY: it never joins, creates, readies or
// otherwise touches a lobby -- it only notifies you (toast + the Windows
// notification your forwarder sends on to Pushover) when an open dungeon /
// Fortress lobby has an open slot AND a strong enough party, so you can decide
// to join by hand.
//
// Data (all read-only requests of the same kinds the game's own Raids browser
// and Hiscores pages send, via the ws-hook's request helper; verified live
// 2026-10-07):
//   raid_list_open -> raid_open_list.lobbies[]   every open lobby, all worlds
//                     {lobbyId, kind, hostName, hostPlayerId, name, difficulty,
//                      memberCount, maxMembers, status, visibility, minRoleLevel,
//                      minRoleAny, takenRoles, isMine, world?}
//   raid_peek      -> raid_peek_state.lobby.members[]   (current-world lobbies only)
//                     per member: levels, skills{}, equipBonuses{}, attackInterval,
//                     raidKc, slayLevel, delveLevel, lifeLevel ...
//   hiscores_get_player -> hiscores_player {totalLevel,totalRank,misc{raid*Kc}}
//                     (used for the host of OTHER-world lobbies, which can't be peeked)
// Your own stats and the game's join rules come from the game bridge
// (window.__ccBridge.raidSelf), so lobbies you cannot enter are never reported.
//
// Strength: every member is scored RELATIVE TO YOU (1.0 = as strong as you):
//   0.40 combat level (avg of the style's accuracy + strength skills)
//   0.40 damage proxy ((2*level + attack bonus + strength bonus) / attack interval)
//   0.10 Slay level, 0.10 Life level            (each ratio capped at 2)
// Lobby strength = mean of members, host weighted 1.5. Alert when it reaches
// the Plugins-tab threshold (default 100% = at least as strong as you).
// Anti-spam (tightened 2026-10-08 after a night of notifications): off by default,
// once per lobby (re-alert only if +15%), once per host per hour (+25% to repeat),
// 10-minute global cooldown, max 3 per hour, quiet hours (default 23:00-08:00),
// nothing while you are in a lobby/raid yourself.
(function () {
  'use strict';
  const NS = '__ccRaidAlert';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const DEFS = window.__CC_RAID_DEFS || {}; // {difficultyId: {tier, name, slay, delve}} baked in by the watcher
  const PEEK_TTL = 20000, HS_TTL = 30 * 60000, MAX_PEEKS = 4;

  const get = (key) => { try { const s = window.__ccPluginSettings; return s && s.get ? s.get(key) : undefined; } catch (e) { return undefined; } };
  const on = (key, def) => { const v = get(key); return v === undefined ? def : !!v; };
  const num = (key, def) => { const v = Number(get(key)); return Number.isFinite(v) ? v : def; };

  const stats = { polls: 0, lobbies: 0, candidates: 0, alerts: 0, lastPollAt: null, lastError: null, inRaid: false };
  const alerted = new Map(); // lobbyId -> {score, at}
  const peekCache = new Map();
  const hsCache = new Map();
  let lastAlertAt = 0, timer = null, busy = false, lastScan = [];
  const alertTimes = [];      // timestamps of recent alerts (hourly cap)
  const hostAlerted = new Map(); // hostPlayerId -> {score, at}: lobbies get re-created with new ids, hosts repeat

  // Quiet hours (local time): no notifications, evaluation continues silently.
  function inQuietHours() {
    if (!on('raidAlertQuiet', true)) return false;
    const h = new Date().getHours(), from = num('raidAlertQuietFrom', 23), to = num('raidAlertQuietTo', 8);
    return from === to ? false : from < to ? (h >= from && h < to) : (h >= from || h < to);
  }

  // --- own stats / eligibility ----------------------------------------------
  const selfInfo = () => { try { return window.__ccBridge && window.__ccBridge.raidSelf ? window.__ccBridge.raidSelf() : null; } catch (e) { return null; } };
  function canJoin(l, self) {
    const min = l.minRoleLevel || 0;
    if (l.kind === 'gauntlet') {
      if (!min) return true;
      const taken = new Set(!l.minRoleAny && Array.isArray(l.takenRoles) ? l.takenRoles : []);
      return Object.keys(self.roles || {}).some((r) => !taken.has(r) && self.roles[r].gather >= min && self.roles[r].process >= min);
    }
    if (min && (self.avgLevel < min || self.weaponTier < Math.floor(min / 10))) return false;
    const d = l.difficulty && DEFS[l.difficulty];
    if (d && (self.slay < d.slay || (d.delve && self.delve < d.delve))) return false;
    return true;
  }

  // --- strength ---------------------------------------------------------------
  const famOf = (st) => (st === 'range' || st === 'crossbow') ? 'range' : (st === 'magic' || st === 'wand') ? 'magic' : 'melee';
  function power(m) {
    const eb = m.equipBonuses || {}, sk = m.skills || {}, st = eb.attackStyle || 'slash', f = famOf(st);
    let atk, str, acc, strS;
    if (f === 'range') { atk = eb.rangeAttack; str = eb.rangeStrength; acc = sk.sight; strS = sk.draw; }
    else if (f === 'magic') { atk = eb.magicAttack; str = eb.magicStrength; acc = sk.focus; strS = sk.surge; }
    else { atk = eb[st + 'Attack'] != null ? eb[st + 'Attack'] : Math.max(eb.stabAttack || 0, eb.slashAttack || 0, eb.crushAttack || 0); str = eb.meleeStrength; acc = sk.strike; strS = sk.heft; }
    const lvl = ((acc || 1) + (strS || 1)) / 2;
    const interval = m.attackInterval > 0 ? m.attackInterval : 3;
    return { lvl, dps: (2 * lvl + Math.max(0, atk || 0) + Math.max(0, str || 0)) / interval, slay: m.slayLevel || sk.slay || 1, life: m.lifeLevel || sk.life || 1 };
  }
  const ratio = (a, b) => Math.min(2, b > 0 ? a / b : 1);
  function relStrength(m, me) {
    const p = power(m);
    return 0.4 * ratio(p.lvl, me.lvl) + 0.4 * ratio(p.dps, me.dps) + 0.1 * ratio(p.slay, me.slay) + 0.1 * ratio(p.life, me.life);
  }

  // --- network (read-only) -----------------------------------------------------
  const sock = () => window.__ccGameSocket;
  async function peek(l) {
    const key = l.lobbyId + '|' + (l.world || 0), c = peekCache.get(key);
    if (c && Date.now() - c.at < PEEK_TTL) return c.data;
    const r = await sock().request({ type: 'raid_peek', data: { lobbyId: l.lobbyId, world: l.world } }, 'raid_peek_state', 6000);
    const members = r && r.lobby && Array.isArray(r.lobby.members) ? r.lobby.members : null;
    peekCache.set(key, { at: Date.now(), data: members });
    return members;
  }
  async function hostHiscores(l) {
    const c = hsCache.get(l.hostPlayerId);
    if (c && Date.now() - c.at < HS_TTL) return c.data;
    const r = await sock().request({ type: 'hiscores_get_player', data: { playerId: l.hostPlayerId } }, 'hiscores_player', 6000);
    hsCache.set(l.hostPlayerId, { at: Date.now(), data: r });
    return r;
  }

  const tierOf = (l) => (l.kind === 'gauntlet' ? 99 : (l.difficulty && DEFS[l.difficulty] ? DEFS[l.difficulty].tier : 0));
  const diffName = (l) => l.kind === 'gauntlet' ? 'Fortress' : (l.difficulty && DEFS[l.difficulty] ? DEFS[l.difficulty].name : 'Dungeon (no difficulty yet)');

  // Evaluate one lobby: {ok, score|null, text}
  async function evaluate(l, self) {
    const slots = l.maxMembers - l.memberCount;
    const base = diffName(l) + ' · ' + l.memberCount + '/' + l.maxMembers + ' · host ' + (l.hostName || '?') + (l.minRoleLevel ? ' · min Lv ' + l.minRoleLevel : '');
    if (!l.world) {
      const members = await peek(l);
      if (!members || !members.length) return null;
      const me = power({ equipBonuses: self.equipBonuses, skills: self.skills, attackInterval: self.attackInterval, slayLevel: self.slay, lifeLevel: self.life });
      let sum = 0, wsum = 0;
      members.forEach((m) => { const w = m.isHost ? 1.5 : 1; sum += w * relStrength(m, me); wsum += w; });
      const score = sum / wsum;
      return { score, ok: score * 100 >= num('raidAlertMinStrength', 100), text: base + ' · party strength ' + score.toFixed(2) + '× yours', slots };
    }
    // Other world: members can't be peeked -> judge the host by hiscores rank.
    if (!on('raidAlertAllWorlds', false)) return null;
    const hs = await hostHiscores(l);
    const rank = hs && hs.totalRank > 0 ? hs.totalRank : null;
    if (!rank) return null;
    return { score: null, ok: rank <= num('raidAlertHostRank', 1000), text: base + ' · world ' + l.world + ' · host rank #' + rank, slots };
  }

  // --- alerting ------------------------------------------------------------------
  let toastEl = null, toastTimer = null;
  function toast(text) {
    if (!document.body) return;
    if (!document.getElementById('cc-raid-toast-style')) {
      const st = document.createElement('style');
      st.id = 'cc-raid-toast-style';
      st.textContent = '#cc-raid-toast{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:99990;max-width:560px;padding:9px 16px;border-radius:9px;'
        + 'background:#17171f;border:1px solid #ffd24a;color:#fff;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);cursor:pointer}'
        + '#cc-raid-toast small{display:block;font-weight:400;color:#bdbdca;margin-top:2px}';
      document.head.appendChild(st);
    }
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'cc-raid-toast';
      toastEl.addEventListener('click', () => { toastEl.remove(); toastEl = null; });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = '';
    toastEl.appendChild(document.createTextNode('⚔ Raid lobby open'));
    const small = document.createElement('small'); small.textContent = text; toastEl.appendChild(small);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, 12000);
  }
  function notify(text) {
    toast(text);
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Scapewatch', { body: 'Raid lobby: ' + text }); } catch (e) {}
  }

  // --- main scan -------------------------------------------------------------------
  async function scan(dry) {
    const S = sock();
    if (!S || !S.isReady || !S.isReady()) { stats.lastError = 'no game socket'; return []; }
    const self = selfInfo();
    if (!self) { stats.lastError = 'game bridge not attached yet'; return []; }
    const list = await S.request({ type: 'raid_list_open', data: {} }, 'raid_open_list', 8000);
    const lobbies = (list && list.lobbies) || [];
    stats.polls++; stats.lobbies = lobbies.length; stats.lastPollAt = Date.now(); stats.lastError = null;
    stats.inRaid = lobbies.some((l) => l.isMine);
    // forget alerts for lobbies that are gone
    const live = new Set(lobbies.map((l) => l.lobbyId));
    for (const id of [...alerted.keys()]) if (!live.has(id)) alerted.delete(id);

    const minSlots = Math.max(1, num('raidAlertMinSlots', 1)), minTier = Math.max(1, num('raidAlertMinTier', 1));
    const cands = lobbies.filter((l) =>
      !l.isMine && l.status === 'lobby' && l.maxMembers - l.memberCount >= minSlots &&
      (l.kind === 'gauntlet' ? on('raidAlertGauntlet', false) : on('raidAlertDungeon', true)) &&
      (l.kind === 'gauntlet' || tierOf(l) >= minTier || !l.difficulty && minTier <= 1) &&
      !(on('raidAlertSkipAfk', false) && /\bafk\b/i.test(l.name || '')) &&
      canJoin(l, self));
    stats.candidates = cands.length;
    cands.sort((a, b) => b.memberCount - a.memberCount);
    const out = [];
    let peeks = 0;
    for (const l of cands) {
      if (peeks >= MAX_PEEKS && !l.world) break;
      if (!l.world) peeks++;
      let ev = null;
      try { ev = await evaluate(l, self); } catch (e) { stats.lastError = String(e && e.message || e); continue; }
      if (!ev) continue;
      out.push({ lobbyId: l.lobbyId, text: ev.text, score: ev.score, ok: ev.ok, slots: ev.slots });
      if (!ev.ok || dry || stats.inRaid) continue;
      const prev = alerted.get(l.lobbyId);
      const improved = prev && ev.score != null && prev.score != null && ev.score >= prev.score * 1.15;
      if (prev && !improved) continue;
      // Same host again (new lobby id) within an hour: only if clearly stronger now.
      const hp = hostAlerted.get(l.hostPlayerId);
      if (hp && Date.now() - hp.at < 3600000 && !(ev.score != null && hp.score != null && ev.score >= hp.score * 1.25)) continue;
      if (inQuietHours()) continue;
      if (Date.now() - lastAlertAt < num('raidAlertCooldownSec', 600) * 1000) continue;
      while (alertTimes.length && Date.now() - alertTimes[0] > 3600000) alertTimes.shift();
      if (alertTimes.length >= Math.max(1, num('raidAlertMaxPerHour', 3))) continue;
      alerted.set(l.lobbyId, { score: ev.score, at: Date.now() });
      hostAlerted.set(l.hostPlayerId, { score: ev.score, at: Date.now() });
      lastAlertAt = Date.now(); alertTimes.push(lastAlertAt); stats.alerts++;
      notify(ev.text);
    }
    lastScan = out;
    return out;
  }

  function schedule() {
    const every = Math.max(8, num('raidAlertPollSec', 12)) * 1000;
    timer = setTimeout(async () => {
      if (on('raidAlertEnabled', true) && !busy) {
        busy = true;
        try { await scan(false); } catch (e) { stats.lastError = String(e && e.message || e); }
        busy = false;
      }
      schedule();
    }, every);
  }
  schedule();

  function teardown() {
    clearTimeout(timer); clearTimeout(toastTimer);
    if (toastEl) toastEl.remove();
    const st = document.getElementById('cc-raid-toast-style'); if (st) st.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc raid-alert torn down';
  }
  window[NS] = {
    version: 1, teardown, stats,
    scan: (dry) => scan(dry !== false), // manual dry run by default: evaluates, never notifies
    get last() { return lastScan; },
  };
  console.log('[cc] raid-alert loaded');
  return 'cc raid-alert loaded';
})();
