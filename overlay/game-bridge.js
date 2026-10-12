// Scapewatch game bridge (page side). Source text of a FUNCTION EXPRESSION that
// panel-resize-watcher.js evaluates through CDP with the game's own state
// object G and Dashboard object D (found via Runtime.queryObjects -- they are
// bundle-scoped, not on `window`). It installs window.__ccBridge, a READ-ONLY
// view of the numbers the game's own Dashboard "Queue" tab shows:
//   project() -> { head, slots:[{index,selected,options:[...]}], quests }
// where every option carries the game's exact projection
// (D._projectOpt -> success, timeSec, totalXp, xpHr), validated at 0.000%
// error against the live dashboard on 19/19 queue options (2026-10-07).
// Nothing here writes to the game or calls anything with side effects: only
// the dashboard's pure projection helpers and getters.
(function (G, D, Y, C, E) {
  'use strict';
  // Same rule as the game's Tasks panel (_getActiveQuestStepsAtNode): an
  // option is a quest step when an ACTIVE quest's remaining 'visit' step is at
  // the option's node or that node's nearest bank, or a 'kill' step names the
  // option's mob. isCurrent = it is the quest's current step (else a future step).
  var nodeIndex = null, dpsCache = null;
  function nodeById(id) {
    if (!nodeIndex) {
      nodeIndex = G._nodesById || null;
      if (!nodeIndex && G.nodesData) { nodeIndex = {}; G.nodesData.forEach(function (n) { nodeIndex[n.id] = n; }); }
    }
    return nodeIndex && nodeIndex[id];
  }
  function questSteps(node, mob) {
    var out = [];
    var active = (G.quests && G.quests.active) || {};
    var data = G.questsData || [];
    if (!node && !mob) return out;
    var nd = node ? nodeById(node) : null, bank = nd ? (nd.nearestBankId || null) : null;
    for (var qid in active) {
      var a = active[qid], q = null;
      for (var i = 0; i < data.length; i++) if (data[i].id === qid) { q = data[i]; break; }
      if (!q) continue;
      for (var h = a.currentStep; h < q.steps.length; h++) {
        var st = q.steps[h];
        var visit = st.type === 'visit' && (st.nodeId === node || (bank && st.nodeId === bank));
        var kill = st.type === 'kill' && !!mob && st.mobId === mob;
        // exact = the option's own node IS the step's node (not merely that node's nearest bank): only exact
        // matches are credited by the Route Advisor, since a task at the Hearth must not also count as the
        // "visit the Bank" step just because the Bank is the Hearth's nearest bank.
        if (visit || kill) out.push({ name: q.name || qid, step: h + 1, total: q.steps.length, current: h === a.currentStep, exact: kill ? true : st.nodeId === node });
      }
    }
    return out;
  }
  // Slay (kill) tasks: XP from damage dealt. A kill deals ~the mob's HP
  // (life x LIFE_HP_MULT); that damage becomes XP at COMBAT_XP_CHOSEN (0.5x) for
  // the chosen skill (Accuracy toggle -> accSkill, Strength toggle -> strSkill of
  // the loadout's combat style), COMBAT_XP_LIFE (0.2x) for Life and
  // COMBAT_XP_SECONDARY (0.2x) for Dodge (Accuracy) / Defend (Strength); plus the
  // per-kill Slay XP (D's own projection). An ESTIMATE: ignores overkill and
  // combat-XP bonuses (shards, milestones). Kill time is the game's own
  // D._killSeconds + respawn (inside D._projectOpt).
  function combatInfo(o, isHead, p) {
    if (o.kind !== 'slay' || !Y) return null;
    var t = o.task || {}, mob = G.mobTypes && G.mobTypes[t.taskId];
    if (!mob || !mob.life) return null;
    var target = t.killTarget || t.quantity || 0;
    var kills = isHead ? Math.max(0, target - (t.killCount || 0)) : target;
    var hp = mob.life * (Y.LIFE_HP_MULT || 2);
    // Auto Loadout (per-mob loadout + XP toggle) overrides the equipped loadout
    // when enabled -- the game's Current Task panel applies the same rule.
    var auto = G.autoLoadoutEnabled && G.autoLoadouts ? G.autoLoadouts[t.taskId] : null;
    var loadout = (auto && auto.loadoutStyle) || G.equippedLoadout || G.activeLoadout, style = null, map = null;
    try {
      var stats = G.computeLoadoutStats && loadout ? G.computeLoadoutStats(loadout) : null;
      style = stats ? Y.resolveCombatStyle(stats.attackStyle, loadout) : null;
      map = style ? Y.COMBAT_STYLE_MAP[style] : null;
    } catch (e) {}
    var strength = ((auto && auto.xpToggle) || G.combatXpToggle) === 'strength';
    var chosenSkill = map ? (strength ? map.strSkill : map.accSkill) : null;
    var secSkill = strength ? 'defend' : 'dodge';
    var k = function (m) { return hp * m * kills * (t.lucky ? 2 : 1); };
    var chosenXp = k(Y.COMBAT_XP_CHOSEN_MULTIPLIER), lifeXp = k(Y.COMBAT_XP_LIFE_MULTIPLIER), secXp = k(Y.COMBAT_XP_SECONDARY_MULTIPLIER);
    var slayXp = p && Number.isFinite(p.totalXp) ? p.totalXp : (mob.slayXPOnKill || 0) * kills;
    var spiritXp = (mob.spiritXPOnKill || 0) * kills * (t.lucky ? 2 : 1);
    // Time with the SAME loadout the fight will use (the dashboard projection
    // always uses the equipped loadout): kills x (kill seconds + respawn).
    var timeSec = null;
    try {
      var ks = D._killSeconds(t.taskId, loadout);
      if (ks && ks > 0) timeSec = kills * (ks + D._respawnSec());
    } catch (e) {}
    return {
      kills: kills, hp: hp, style: style, toggle: strength ? 'strength' : 'accuracy', loadout: loadout, auto: !!auto,
      slay: slayXp, spirit: spiritXp, chosenSkill: chosenSkill, chosen: chosenXp, life: lifeXp, secSkill: secSkill, sec: secXp,
      total: slayXp + spiritXp + chosenXp + lifeXp + secXp, timeSec: timeSec,
    };
  }
  function projOpt(o, isHead) {
    var t = o.task || {};
    var p = D._projectOpt(o, isHead) || {};
    var node = null;
    try { node = D._optNode(o); } catch (e) {}
    var mob = o.kind === 'slay' ? t.taskId : null;
    var quest = [];
    try { quest = questSteps(node, mob); } catch (e) {}
    var xpBonus = 0;
    try { if (o.kind !== 'slay') xpBonus = G.getSkillXpBonus(t.skill) || 0; } catch (e) {}
    // Lucky skilling tasks pay 2x XP per action (the game's own projection leaves this out; slay's damage-based XP is doubled in combatInfo).
    var lm = (o.kind !== 'slay' && t.lucky) ? 2 : 1;
    return {
      kind: o.kind, skill: t.skill || 'slay', act: t.activityId || t.taskId, node: node,
      qty: t.quantity || t.killTarget, done: t.progress || t.killCount || 0, lucky: !!t.lucky,
      success: p.success, timeSec: p.timeSec, totalXp: p.totalXp * lm, xpHr: p.xpHr * lm, xpBonus: xpBonus, quest: quest,
      combat: (function () { try { return combatInfo(o, isHead, p); } catch (e) { return null; } })(),
    };
  }
  // Your own raid-relevant stats, in the same shape the raid peek reports for
  // other players, plus the inputs of the game's join rules (see raid-alert.js).
  function raidSelf() {
    var loadout = G.raidLoadout || G.equippedLoadout || (Y && Y.DEFAULT_EQUIPPED_LOADOUT);
    var skills = {};
    for (var k in G.skills) skills[k] = G.skills[k].level;
    var stats = G.computeLoadoutStats && loadout ? G.computeLoadoutStats(loadout) : null;
    var interval = stats && Y && Y.attackInterval ? Y.attackInterval(stats.attackSpeed, skills.vigor || 1) : (stats && stats.attackSpeed) || 3;
    var roles = {};
    var R = (Y && Y.GAUNTLET_ROLES) || {};
    for (var r in R) roles[r] = { gather: skills[R[r].gatherSkill] || 1, process: skills[R[r].processSkill] || 1 };
    return {
      loadout: loadout, skills: skills, equipBonuses: stats || {}, attackInterval: interval,
      slay: skills.slay || 1, delve: skills.delve || 1, life: skills.life || 1,
      avgLevel: Y && Y.raidLoadoutAvgLevel ? Y.raidLoadoutAvgLevel(G.skills, loadout) : 1,
      weaponTier: Y && Y.raidLoadoutWeaponTier ? Y.raidLoadoutWeaponTier((G.equipmentLoadouts || {})[loadout], G.itemsData) : -1,
      roles: roles,
    };
  }
  var bridge = {
    at: Date.now(),
    raidSelf: function () { try { return raidSelf(); } catch (e) { return null; } },
    // DEV aid: shallow shape of a game-state path ("quests", "unlocks.tools" ...), read-only.
    shape: function (path) {
      try {
        var o = G; (path ? String(path).split('.') : []).forEach(function (k) { if (o != null) o = o[k]; });
        if (o == null) return String(o);
        if (typeof o !== 'object') return o;
        var out = {};
        Object.keys(o).slice(0, 400).forEach(function (k) {
          var v = o[k], t = typeof v;
          out[k] = t === 'object' ? (Array.isArray(v) ? 'array(' + v.length + ')' : v === null ? null : 'obj{' + Object.keys(v).length + '}') : (t === 'function' ? 'fn' : v);
        });
        return out;
      } catch (e) { return 'ERR ' + e.message; }
    },
    // Items currently held in the bank (qty > 0): { itemId: qty }.
    held: function () {
      try { var o = {}; (G.bank || []).forEach(function (b) { if (b && b.itemId && b.qty > 0) o[b.itemId] = b.qty; }); return o; } catch (e) { return null; }
    },
    // Recipes + bank + skill XP for the Crafting Potential plugin.
    craft: function () {
      try {
        var xp = {};
        ['smith', 'craft', 'imbue', 'brew'].forEach(function (k) { if (G.skills[k]) xp[k] = G.skills[k].xp; });
        var names = {};
        (Y && Y.FINISHING_RECIPES || []).forEach(function (r) { [r.unfPotionId, r.rawId, r.procId, r.resultId].forEach(function (id) { if (id && G.itemsData[id]) names[id] = G.itemsData[id].name; }); });
        var eq = (Y && Y.EQUIPMENT_RECIPES) || {};
        Object.keys(eq).forEach(function (id) { if (G.itemsData[id]) names[id] = G.itemsData[id].name; (eq[id].materials || []).forEach(function (m) { if (G.itemsData[m.itemId]) names[m.itemId] = G.itemsData[m.itemId].name; }); });
        var logged = {};
        var chk = function (id) { try { if (id && !(id in logged)) logged[id] = !!G.isCollectionLogged(id); } catch (e) {} };
        Object.keys(eq).forEach(chk);
        (Y && Y.FINISHING_RECIPES || []).forEach(function (r) { chk(r.resultId); });
        var tiers = {}, levels = {};
        Object.keys(eq).forEach(function (id) { if (G.itemsData[id] && G.itemsData[id].tier != null) tiers[id] = G.itemsData[id].tier; });
        ['smith', 'craft', 'imbue', 'brew'].forEach(function (k) { if (G.skills[k]) levels[k] = G.skills[k].level; });
        return { equip: eq, finishing: (Y && Y.FINISHING_RECIPES) || [], held: bridge.held(), xp: xp, names: names, logged: logged, tiers: tiers, levels: levels };
      } catch (e) { return null; }
    },
    // Item categories for the Bank Tools plugin: compact item records + which skill produces which items (D.itemSources).
    bank: function () {
      try {
        var items = {};
        for (var id in G.itemsData) { var it = G.itemsData[id]; items[id] = { t: it.type, s: it.skill, p: it.potionStyle, c: it.consumableType, a: it.attackStyle, h: it.holiday ? 1 : 0, r: Y && Y.EQUIPMENT_RECIPES && Y.EQUIPMENT_RECIPES[id] ? Y.EQUIPMENT_RECIPES[id].skill : undefined }; }
        return { items: items, sources: D.itemSources || {} };
      } catch (e) { return null; }
    },
    // Live combat numbers for the Combat Readout (read only): the combat scene's own units plus the game's expected DPS formula.
    combat: function () {
      if (!E || !E._active || !E._playerUnit) return null;
      var u = function (x) { return { name: x.name || null, hp: x.hp, maxHp: x.maxHp, spirit: x.spirit, maxSpirit: x.maxSpirit, timer: x.attackTimer, interval: x.attackInterval, alive: x.alive !== false && !x.dead }; };
      var out = { player: u(E._playerUnit), mobs: (E._mobs || []).map(u), selected: E._selectedSide === 'mob' ? E._selectedMobIdx : -1, raid: !!E._isRaid, dps: null };
      var now = Date.now();
      try {
        var head = D._queueHead(), id = head && head.task && head.task.taskId;
        if (id && (!dpsCache || dpsCache.id !== id || now - dpsCache.at > 3000)) {
          var mob = G.mobTypes && G.mobTypes[id], ks = mob ? D._killSeconds(id, G.equippedLoadout || G.activeLoadout) : null;
          dpsCache = { id: id, at: now, dps: ks && mob.life ? (mob.life * (Y.LIFE_HP_MULT || 2)) / ks : null };
        }
        if (dpsCache) out.dps = dpsCache.dps;
      } catch (e) {}
      return out;
    },
    // Chat UI state (read) and the one UI-only write ScapeLite makes: which channel the input sends to (never sends anything).
    chat: function () {
      if (!C) return null;
      return { active: C._activeChannel, dm: !!C._dmTarget, filters: JSON.parse(JSON.stringify(C._filters || {})), send: C.SEND_CHANNELS.slice() };
    },
    setChatChannel: function (ch) {
      if (!C || C.SEND_CHANNELS.indexOf(ch) < 0) return false;
      C._dmTarget = null; C._activeChannel = ch; C._updateChannelLabel();
      return true;
    },
    ok: function () { try { return !!(G && D && typeof D._projectOpt === 'function' && Array.isArray(G.taskQueue)); } catch (e) { return false; } },
    project: function () {
      var out = { t: Date.now(), head: null, slots: [], quests: {}, skills: {} };
      try { for (var sk in G.skills) out.skills[sk] = { xp: G.skills[sk].xp, level: G.skills[sk].level }; } catch (e) {}
      var head = D._queueHead();
      if (head) out.head = projOpt(head, true);
      G.taskQueue.forEach(function (s, i) {
        out.slots.push({ index: i, selected: s.selectedIndex || 0, options: (s.options || []).map(function (o) { return projOpt(o, false); }) });
      });
      // Reward XP of every ACTIVE quest (steps give no XP; the reward comes at completion).
      try {
        var active = (G.quests && G.quests.active) || {};
        (G.questsData || []).forEach(function (q) {
          var a = active[q.id];
          if (!a) return;
          var xp = 0, r = q.rewards && q.rewards.xp;
          if (r) for (var k in r) xp += r[k];
          out.quests[q.name || q.id] = { xp: xp, xpBy: r ? JSON.parse(JSON.stringify(r)) : {}, steps: q.steps ? q.steps.length : 0, current: a.currentStep };
        });
      } catch (e) {}
      return out;
    },
  };
  window.__ccBridge = bridge;
  return bridge;
})
