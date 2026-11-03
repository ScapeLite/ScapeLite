// ScapeLite Clan Board collector (window.__ccClanBoard). DISPLAY-ONLY and read-only: every few seconds it reads what the game bridge already
// knows about YOU (current task, progress, ETA, levels, HP ...) and keeps one small snapshot in memory. It sends nothing anywhere and touches
// nothing in the game. The watcher (clan-board-sync.js) picks the snapshot up over the existing DevTools connection, and only when you switched the
// board on (Settings > Plugins > Clan Status Board) and gave it a webhook. The same snapshot feeds the live preview in that settings section.
//
//   window.__ccClanBoard.snapshot()  -> the latest snapshot (or null)
//   window.__ccClanBoard.preview()   -> { payload, state } the card as it would be posted right now, with your current field choices
//   window.__ccClanBoard.fields()    -> the current field switches
(function () {
  'use strict';
  const NS = '__ccClanBoard';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }
  const life = window.__ccLife && window.__ccLife.scope('clan-board');
  const Card = window.__ccBoardCard;
  if (!life || !Card) return 'cc clan-board: lifecycle or card builder not loaded';

  const KEY = { enabled: 'clanBoardEnabled', task: 'clanBoardTask', location: 'clanBoardLocation', progress: 'clanBoardProgress', levelUps: 'clanBoardLevelUps', totalLevel: 'clanBoardTotalLevel', xpHr: 'clanBoardXpHr', hp: 'clanBoardHp', slayer: 'clanBoardSlayer', fortress: 'clanBoardFortress', onlineSince: 'clanBoardOnlineSince', today: 'clanBoardToday' };
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(KEY[k]); return v === undefined ? d : v; } catch (e) { return d; } };
  const fields = () => { const o = {}; Card.FIELD_KEYS.forEach((k) => { o[k] = !!setting(k, Card.DEFAULT_FIELDS[k]); }); return o; };

  let snap = null, last = 0;
  const bridge = () => { const b = window.__ccBridge; return b && b.ok && b.ok() ? b : null; };

  function collect() {
    const b = bridge();
    if (!b) { snap = null; return null; }
    const out = { v: 1, ts: Date.now(), ok: true };
    try { const w = b.whoami(); out.name = (w && (w.display || w.name)) || ''; } catch (e) { out.name = ''; }
    let l = null, cu = null, pj = null, al = null;
    const wantHp = !!fields().hp;
    try { l = b.live(); } catch (e) { /* not ready */ }
    try { cu = b.current(); } catch (e) { /* not ready */ }
    try { pj = b.project(); } catch (e) { /* not ready */ }
    if (wantHp) { try { al = b.alertState(); } catch (e) { /* not ready */ } }   // the heavy read, only when the HP field is on
    if (!l) { snap = null; return null; }
    const head = pj && pj.head || null, tk = l.task || null, st = String(l.state || '').toLowerCase();
    const combat = st === 'combat' || st === 'raid' || !!(cu && cu.combat);
    out.state = !tk && !l.slay && !combat && !head ? 'idle' : 'online';
    out.travelling = /travel/.test(st);
    // what you are doing
    if (combat && l.slay) {
      const name = Card.cap(String(l.slay.taskId || head && head.act || 'fight'));
      const kills = cu && cu.kills;
      const where = Card.cap(String(l.at || ''));
      out.task = { skill: 'slay', skillName: 'Slayer', text: name, place: where.toLowerCase() === name.toLowerCase() ? '' : where, done: kills ? kills.count : (l.slay.killCount || 0), goal: kills ? kills.target : (l.slay.killTarget || 0), kills: true };
      out.slay = { name, done: out.task.done, goal: out.task.goal };
    } else if (combat) {
      out.task = { skill: 'combat', skillName: st === 'raid' ? 'Raid' : 'Combat', text: cu && cu.loadout ? cu.loadout : 'Fighting', place: Card.cap(String(l.at || '')), done: cu && cu.kills ? cu.kills.count : 0, goal: cu && cu.kills ? cu.kills.target : 0, kills: true };
    } else if (tk && tk.quantity) {
      out.task = { skill: tk.skill, skillName: Card.cap(tk.skill), text: tk.activityName || Card.cap(tk.activityId || 'Task'), place: tk.nodeName || '', done: tk.progress || 0, goal: tk.quantity };
    }
    if (out.task) { let origin = ''; try { origin = location.origin; } catch (e) { /* no location */ } const ic = Card.skillIconUrl(origin, out.task.skill); if (ic) out.task.icon = ic; }   // the game's own icon file for this skill
    if (out.task && head && head.timeSec > 0 && isFinite(head.timeSec) && !combat) out.task.etaAt = Date.now() + Math.round(head.timeSec * 1000);
    if (head && head.xpHr > 0 && isFinite(head.xpHr)) out.xpHr = Math.round(head.xpHr);
    if (al && al.maxHP) out.hp = { cur: Math.round(al.currentHP || 0), max: Math.round(al.maxHP) };
    // levels of every skill, total level, total xp and the game's own completed-task counter (the watcher turns them into level-ups and "today")
    const lv = {}; let total = 0, xp = 0;
    if (pj && pj.skills) Object.keys(pj.skills).forEach((k) => { const s = pj.skills[k]; if (s && s.level) { lv[k] = s.level; total += s.level; } });
    if (l.xp) Object.keys(l.xp).forEach((k) => { xp += Number(l.xp[k]) || 0; });
    out.lv = lv; out.totalLevel = total; out.totalXp = Math.round(xp);
    try { const g = b.ledger(); if (g && typeof g.tasksTotal === 'number') out.tasks = g.tasksTotal + (g.slayDone || 0); } catch (e) { /* no ledger */ }
    // Fortress / raid run in progress (the Raid DPS panel's wave counter), only while that panel is up
    try { const r = window.__ccLastRun; if (r && Date.now() - (r.at || 0) < 20000) { const p = b.raidParty(); out.fortress = { name: r.raidName || 'Run', wave: r.wave || 0, party: p && p.names ? p.names.length : 0 }; } } catch (e) { /* no run */ }
    snap = out;
    return out;
  }

  function tick(force) {
    if (!force && !setting('enabled', false)) return;       // switched off: no reads at all
    last = Date.now();
    try { collect(); } catch (e) { snap = null; }
  }

  life.every(10000, () => { try { tick(false); } catch (e) { /* never break the page */ } }, { always: true });   // keeps running while the window is covered
  life.after(4000, () => { try { tick(false); } catch (e) { /* ignore */ } });

  const api = {
    snapshot: function () {
      if (!setting('enabled', false)) return null;
      if (Date.now() - last > 12000) tick(false);
      return snap;
    },
    fields,
    // The card as it would be posted right now (also while the board is off, so the preview works before you switch it on).
    // Your task, progress, ETA, total level, XP/h and HP are live; the level-up line, "online since" and "today" are samples.
    preview: function () {
      if (Date.now() - last > 8000) tick(true);
      const s = snap;
      const now = Date.now();
      if (!s) return { state: 'none', payload: Card.build({ name: 'Your name', state: 'offline', lastSeenAt: now - 120000, snap: { totalLevel: 0 }, levelUps: [], fields: fields(), now }).payload };
      const res = Card.build({ name: s.name || 'Your name', state: s.state, snap: s, onlineSince: now - 3600000, idleSince: now - 300000, levelUps: [{ skill: 'fish', from: 49, to: 50, t: now - 2 * 3600000 }], today: { xp: 1250000, tasks: 31 }, fields: fields(), now });
      return { state: s.state, payload: res.payload, live: true };
    },
    teardown: function () {
      try { life.dispose(); } catch (e) { /* gone */ }
      if (window[NS] && window[NS].teardown === api.teardown) delete window[NS];
    },
  };
  window[NS] = api;
})();
