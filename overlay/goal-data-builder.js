// Compiles the static game data the Goal Planner needs into one compact object
// (baked into the page by the watcher as window.__CC_GOAL_DATA). Everything
// comes from the repo's own copy of the game files in data/raw; live state
// (levels, owned unlocks, quests...) is read in the page via the game bridge.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function buildGoalData(rawDir) {
  const J = (f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
  const C = require(path.join(rawDir, 'Constants.js'));

  const itemsRaw = J('items.json').items;
  const itemList = Array.isArray(itemsRaw) ? itemsRaw : Object.entries(itemsRaw).map(([id, v]) => Object.assign({ id }, v));
  const itemById = {};
  itemList.forEach((i) => { itemById[i.id] = i; });

  const nodes = J('nodes.json').nodes;
  const pos = {};
  nodes.forEach((n) => { pos[n.id] = n.position; });
  const dist = (a, b) => (pos[a] && pos[b]) ? Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y) * 1.4 : 0; // x1.4: roads wind

  // --- tool effect: seconds shaved off every action (Constants' own rule) ----
  const toolSec = (it) => {
    if (it.ctool) return C.CHAOS_TOOL_DURATION_REDUCTION || 0.6;
    const T = C.TOOL_DURATION_REDUCTIONS || [0.1, 0.1, 0.2, 0.3, 0.4];
    if (it.dtool === 2 || (it.lucky && it.shiny)) return T[1];
    if (it.dtool || it.lucky) return T[0];
    return T[it.tier] || 0;
  };
  const used = {}; // item ids referenced below -> compact record
  const ref = (id) => {
    const it = itemById[id];
    if (!it) return null;
    if (!used[id]) {
      const rec = { n: it.name || id, t: it.type };
      if (it.unlockType) rec.u = it.unlockType;
      if (it.unlockSkill) rec.s = it.unlockSkill;
      if (it.slot) rec.slot = it.slot;
      if (typeof it.tier === 'number') rec.tier = it.tier;
      if (it.unlockType === 'tool') rec.sec = toolSec(it);
      if (it.type === 'equipment') rec.pow = ['stab', 'slash', 'crush', 'range', 'magic'].reduce((m, k) => Math.max(m, it[k + 'Attack'] || 0), 0) + Math.max(it.meleeStrength || 0, it.rangeStrength || 0, it.magicStrength || 0);
      used[id] = rec;
    }
    return id;
  };

  // --- quests -------------------------------------------------------------------
  const questList = J('quests.json').quests || [];
  const quests = questList.map((q) => {
    const steps = (q.steps || []).map((s) => ({ ty: s.type, node: s.nodeId || null, mob: s.mobId || null }));
    const legs = [];
    let prev = null;
    steps.forEach((s) => { const n = s.node || null; legs.push(prev && n ? dist(prev, n) : 0); if (n) prev = n; });
    const xp = (q.rewards && q.rewards.xp) || {};
    const unlocks = ((q.rewards && q.rewards.unlocks) || []).map((u) => { ref(u); return u; });
    return {
      id: q.id, name: q.name, reqL: q.levelRequirements || {}, reqQ: q.questRequirements || [], steps, legs,
      xp, xpTotal: Object.values(xp).reduce((a, b) => a + b, 0), unlocks,
    };
  });

  // --- slay mob rare drops that are unlocks or gear -------------------------------
  const encounters = (J('mobs.json').encounters || []);
  const drops = [];
  encounters.forEach((e) => {
    if (!e.isSlay) return;
    (e.rareDrops || []).forEach((r) => {
      const it = itemById[r.itemId];
      if (!it || !(it.type === 'unlock' || (it.type === 'equipment' && it.slot))) return;
      ref(r.itemId);
      drops.push({ task: e.taskId, mob: e.name, slay: e.slayRequired || 1, item: r.itemId, oneIn: r.oneInChance });
    });
  });

  // --- raids / fortress ---------------------------------------------------------------
  const oneIn = C.RAID_RARE_ONE_IN || {};
  const raids = (J('raids.json').raids || []).map((r) => {
    const dt = r.dropTable || {};
    const rare = (dt.rare || []).map((x) => { ref(x.itemId); return { item: x.itemId, oneIn: x.oneInChance }; });
    const milestone = (dt.milestone || []).map((m) => { ref(m.itemId); return { item: m.itemId, kind: m.kind, thr: m.threshold || m.thresholdMs }; });
    return { id: r.id, name: r.name, tier: r.tier, slay: r.slayLevelRequired || 0, delve: r.delveLevelRequired || 0, runOneIn: oneIn[r.id] || null, rare, milestone };
  });

  const skillsRaw = J('skills.json').skills || [];
  const skills = skillsRaw.map((s) => ({ id: s.id || s.skillId, name: s.name }));

  return { skills, quests, drops, raids, items: used };
};
