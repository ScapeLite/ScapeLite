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
(function (G, D, Y, C, E, U, M, S, Q, W) {
  'use strict';
  // Same rule as the game's Tasks panel (_getActiveQuestStepsAtNode): an
  // option is a quest step when an ACTIVE quest's remaining 'visit' step is at
  // the option's node or that node's nearest bank, or a 'kill' step names the
  // option's mob. isCurrent = it is the quest's current step (else a future step).
  var diaryStatic = null;
  var nodeIndex = null, dpsCache = null, projMemo = null; var riskMemo = null, riskAt = 0, riskKey = ''; var huntMemo = null, huntAt = 0;
  // getSkillXpBonus walks every item of the game each call (about 0.1 ms) and a projection asks for it per option: ask once per skill per projection
  var bonusMemo = {}, bonusAt = 0;
  var chatLineNodes = new WeakMap(), chatLineIds = new WeakMap(), chatLineSeq = 0;   // chatHidden(): one detached line and one id per game chat message
  function bonusOf(sk) { var n = Date.now(); if (n - bonusAt > 1000) { bonusMemo = {}; bonusAt = n; } if (!(sk in bonusMemo)) { try { bonusMemo[sk] = G.getSkillXpBonus(sk) || 0; } catch (e) { bonusMemo[sk] = 0; } } return bonusMemo[sk]; }
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
    var bn = function (sk) { return sk ? bonusOf(sk) : 0; };   // every skill pays base x (1 + its own XP bonus)
    // A Lucky slay task doubles Slay XP and the chosen combat skill's XP only (the game's tooltip: "2x slay XP, 2x combat XP for your training focus"; 9 logged lucky tasks: chosen / slay
    // stays about 2.0 like a normal task, while life, spirit and the secondary skill per slay XP are half of a normal task's). Life, spirit and the secondary skill are not doubled.
    var k = function (m, dbl) { return hp * m * kills * (dbl && t.lucky ? 2 : 1); };
    var chosenXp = k(Y.COMBAT_XP_CHOSEN_MULTIPLIER, true) * (1 + bn(chosenSkill)), lifeXp = k(Y.COMBAT_XP_LIFE_MULTIPLIER) * (1 + bn('life')), secXp = k(Y.COMBAT_XP_SECONDARY_MULTIPLIER) * (1 + bn(secSkill));
    var slayXp = (p && Number.isFinite(p.totalXp) ? p.totalXp : (mob.slayXPOnKill || 0) * kills) * (1 + bn('slay'));
    var spiritXp = (mob.spiritXPOnKill || 0) * kills * (1 + bn('spirit'));
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
  // What the game's queue row shows beside a slay task (read only), by the game's own rule (_nodeIcons / _xpSkills): the weapon icon of the loadout saved for that mob (Auto Loadout list),
  // and the two skills trained (the task's own accuracy / strength choice, else the saved one, else accuracy).
  function slayUi(t) {
    try {
      var auto = G.autoLoadouts ? G.autoLoadouts[t.taskId] : null;
      if (!auto) return { none: true, loadout: '', tog: '' };
      var ls = auto.loadoutStyle, eq = G.equipmentLoadouts ? G.equipmentLoadouts[ls] : null;
      var key = { melee: 'slash', range: 'range', magic: 'magic', pvp: 'slash' }[String(ls || '').split('_')[0]] || 'slash', m = Y && Y.COMBAT_STYLE_MAP ? Y.COMBAT_STYLE_MAP[key] : null;
      var tog = t.xpToggle === 'accuracy' || t.xpToggle === 'strength' ? t.xpToggle : (auto.xpToggle === 'strength' ? 'strength' : 'accuracy');
      var sk = m ? (tog === 'strength' ? [m.strSkill, 'defend'] : [m.accSkill, 'dodge']) : [];
      return { none: false, loadout: ls, loadoutName: G.loadoutName ? G.loadoutName(ls) : ls, loadoutIcon: eq && eq.mainhand ? '/assets/icons/items/' + eq.mainhand + '.png' : '/assets/icons/ui/head.png',
        skills: sk, skillNames: sk.map(function (s) { return G.getSkillName ? G.getSkillName(s) : s; }), tog: tog, other: tog === 'strength' ? 'accuracy' : 'strength' };
    } catch (e) { return null; }
  }
  // XP-boost unlocks (Enchanted tools, ...) that a mob can still drop and you have not logged yet. Cheap, cached per task id.
  var dropCache = {};
  function missingBoostDrops(taskId) {
    if (taskId in dropCache) return dropCache[taskId];
    var n = 0;
    try {
      var enc = (G.encounters || []).find(function (e) { return e.taskId === taskId; });
      (enc && enc.rareDrops || []).forEach(function (d) {
        var it = G.itemsData && G.itemsData[d.itemId];
        if (it && it.type === 'unlock' && !G.isCollectionLogged(taskId, d.itemId)) n++;
      });
    } catch (e) {}
    dropCache[taskId] = n;
    setTimeout(function () { delete dropCache[taskId]; }, 30000);
    return n;
  }
  // ---- Tree Advisor: DPS model (mirrors the Gear Calc; verified against its reading) ----
  var treeInp = null, treeInpAt = 0;
  function treeDpsInputs() {
    var ls = fightLoadout() || G.equippedLoadout || (Y && Y.DEFAULT_EQUIPPED_LOADOUT);
    var st = G.computeLoadoutStats(ls), style = Y.resolveCombatStyle ? Y.resolveCombatStyle(st.attackStyle, ls) : st.attackStyle;
    var skills = {}, bonus = {}, pot = {}, names = ['life', 'spirit', 'strike', 'heft', 'sight', 'draw', 'focus', 'surge', 'dodge', 'defend', 'vigor'];
    var pb = {}; try { pb = G.combatPotionUse === false ? {} : (G.getPotionBoosts() || {}); } catch (e) {}
    names.forEach(function (s) { skills[s] = (G.skills[s] && G.skills[s].level) || 1; bonus[s] = G.getCombatBonus(s) || 0; pot[s] = pb[s] | 0; });
    var tid = (G.slayTask && G.slayTask.active && G.slayTask.active.taskId) || null;
    if (!tid) {   // no slay task: the toughest mob your Slay level lets you take
      var sl = (G.skills.slay && G.skills.slay.level) || 1, hi = -1;
      (G.encounters || []).forEach(function (e) { var mt = e.mobs && e.mobs[0] && e.mobs[0].mobType; if (mt && G.mobTypes[mt] && e.isSlay && (e.slayRequired || 0) <= sl && (e.slayRequired || 0) > hi) { hi = e.slayRequired || 0; tid = mt; } });
    }
    var mob = G.mobTypes[tid]; if (!mob) return null;
    var ex = { chancePct: 0, damagePct: 0 }; try { if (U && U._deriveExtraCrit) ex = U._deriveExtraCrit(); } catch (e) {}
    var sm = Y.COMBAT_STYLE_MAP && Y.COMBAT_STYLE_MAP[style];
    return { style: style, weaponSpeed: st.attackSpeed, equip: st, lvl: skills, bonus: bonus, pot: pot, spirit: { active: true, sources: 0 }, usesAmmo: !!(sm && sm.ammoType), hasAmmo: true,
      critSources: G.getCritSources ? G.getCritSources() : 0, collectorPct: (G.getCollectorProgress ? G.getCollectorProgress() : 0) * 100, extraCrit: ex,
      talent: { minHit: 0, maxHit: 0, critChancePct: 0, critDamagePct: 0, attackSpeedPct: 0 }, passives: { critFloorPct: 0, penetration: 0, critChanceDamagePct: 0 }, mob: mob, mobName: mob.name || tid, mobPostReduction: 0 };
  }
  function gearCalcDps(C, inp) {
    var m = C.COMBAT_STYLE_MAP[inp.style] || C.COMBAT_STYLE_MAP[C.UNARMED_STYLE]; if (!m) return null;
    var spMod = inp.spirit.active ? C.SPIRIT_BASE_MODIFIER + inp.spirit.sources * C.SPIRIT_MODIFIER_PER_SOURCE : C.SPIRIT_DEPLETED_MODIFIER;
    var sp = spMod < C.SPIRIT_BASE_MODIFIER ? { s: false, c: 0 } : { s: true, c: Math.max(0, spMod - C.SPIRIT_BASE_MODIFIER) };
    var eb = function (k) { return (inp.bonus[k] | 0) + (inp.pot[k] | 0); };
    var A = C.buildScore(inp.lvl[m.accSkill], inp.equip[m.accBonus] || 0, eb(m.accSkill), sp.s, sp.c);
    var S = C.buildScore(inp.lvl[m.strSkill], inp.equip[m.strBonus] || 0, eb(m.strSkill), sp.s, sp.c);
    var pen = Math.min(0.95, Math.max(0, (inp.passives || {}).penetration || 0)), pk = 1 - pen, mob = inp.mob, mobSp = { s: true, c: 0 };
    var eqD = Math.floor((mob[m.defBonus] || 0) * pk);
    var D = C.buildScore((mob.dodge || 0) * pk, eqD, 0, mobSp.s, mobSp.c), SD = C.buildScore((mob.defend || 0) * pk, eqD, 0, mobSp.s, mobSp.c);
    if (inp.usesAmmo && !inp.hasAmmo) { A = C.ammoPenaltyScore(A); S = C.ammoPenaltyScore(S); }
    var t = inp.talent, rawMax = C.maxHit(S) + (t.maxHit || 0), red = C.damageReduction(SD), hc = C.hitChanceFromScores(A, D);
    var minF = C.minHitFloor(hc.overflow, rawMax); if (t.minHit) minF = Math.min(rawMax, minF + t.minHit);
    var cfp = (inp.passives || {}).critFloorPct || 0, critFloor = cfp > 0 ? Math.min(rawMax, Math.max(minF, Math.floor(cfp * rawMax))) : minF;
    var vigor = (inp.lvl.vigor | 0) + eb('vigor'), interval = C.attackInterval(inp.weaponSpeed, vigor);
    if (t.attackSpeedPct) interval *= (1 - t.attackSpeedPct / 100);
    var xc = inp.extraCrit || {}, col = (inp.collectorPct || 0) / 100;
    var cc = Math.min(1, C.critChance(inp.critSources) + (t.critChancePct || 0) / 100 + col * C.COLLECTOR_MAX_CRIT_CHANCE_PCT / 100 + (xc.chancePct || 0) / 100);
    var cm = C.critDamageMult(inp.critSources) + (t.critDamagePct || 0) + col * C.COLLECTOR_MAX_CRIT_DAMAGE_PCT + (xc.damagePct || 0);
    var dmult = 1 + Math.max(0, (inp.passives || {}).critChanceDamagePct || 0) * cc, post = Math.min(1, Math.max(0, inp.mobPostReduction || 0));
    var postCut = function (v) { return post > 0 ? Math.max(1, Math.floor(v * (1 - post))) : v; };
    var n = rawMax - minF + 1, sN = 0, sC = 0;
    if (n <= 0) { sN = 1; sC = 1; n = 1; } else for (var k = minF; k <= rawMax; k++) {
      sN += postCut(Math.max(1, Math.ceil(Math.floor(k * dmult) * (1 - red))));
      var kk = Math.max(k, critFloor), cr = Math.floor(Math.max(kk + 1, Math.floor(kk * cm / 100)) * dmult);
      sC += postCut(Math.max(1, Math.ceil(cr * (1 - red))));
    }
    var avg = (1 - cc) * (sN / n) + cc * (sC / n);
    return { dps: avg * hc.chance / interval, hit: hc.chance, minHit: minF, maxHit: rawMax, critChance: cc, interval: interval };
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
    xpBonus = bonusOf(o.kind === 'slay' ? 'slay' : t.skill);
    // Lucky skilling tasks pay 2x XP per action (the game's own projection leaves this out; slay's damage-based XP is doubled in combatInfo).
    var lm = (o.kind !== 'slay' && t.lucky) ? 2 : 1;
    // the inputs of the game's own XP maths, so the real XP of a task can be checked against it (read-only)
    var baseXp = null, failXp = 0, dbl = 0;
    try { if (o.kind !== 'slay') { var ai = D._activityInfo(t.skill, t.activityId); if (ai && typeof ai.successXP === 'number') { baseXp = ai.successXP; failXp = (Y && Y.activityFailXP) ? Y.activityFailXP(ai.successXP) : 0; } if (G._getDoubleGatherChance) dbl = G._getDoubleGatherChance(t.skill) || 0; } } catch (e) {}
    // The dashboard's XP leaves out two things the game really pays (checked against 240 logged tasks and live samples, to within 1%):
    //  1. the skill's XP bonus: XP per action is base x (1 + bonus) (the game's own tooltips show it that way);
    //  2. gathering pays XP per ITEM, and a double gather gives two items for one action, but the dashboard divides the actions by (1 + double chance)
    //     and so also divides the XP. Lucky tasks pay double per item.
    // So: XP = items left x (base + fail XP share) x (1 + bonus) x lucky. The time is the dashboard's, which matches reality (acting time / predicted = 1.00 to 1.03).
    var rawXp = p.totalXp * lm, xpFinal = rawXp, xpHrFinal = p.xpHr * lm;
    try {
      if (o.kind === 'slay') { xpFinal = rawXp * (1 + xpBonus); }
      else if (baseXp != null) {
        var items = isHead ? Math.max(0, (t.quantity || 0) - (t.progress || 0)) : (t.quantity || 0), sc = (p.success == null || !(p.success > 0)) ? 1 : p.success;
        var gatherSk = D.GATHER_SKILLS && D.GATHER_SKILLS.indexOf(t.skill) >= 0, lg = gatherSk ? dbl : 0;
        var perItem = baseXp + (t.lucky ? 0 : failXp * (1 - sc) / (sc * (1 + lg)));
        xpFinal = items * perItem * (1 + xpBonus) * lm;
      } else xpFinal = rawXp * (1 + xpBonus);
      xpHrFinal = p.timeSec > 0 && isFinite(xpFinal) ? xpFinal / p.timeSec * 3600 : (p.xpHr * lm * (1 + xpBonus));
    } catch (e) { xpFinal = rawXp; xpHrFinal = p.xpHr * lm; }
    // Slay: the dashboard's kill time is 60% too long (real acting time / dashboard 0.62, / this model 1.00 on 14 logged tasks) and it counts only the Slay skill's XP;
    // combatInfo uses the loadout the fight really uses, and pays every skill the fight trains. The dashboard's numbers stay as dashTimeSec / rawXp.
    var cmb = (function () { try { return combatInfo(o, isHead, p); } catch (e) { return null; } })(), dashTime = p.timeSec;
    if (o.kind === 'slay' && cmb && isFinite(cmb.timeSec) && cmb.timeSec > 0 && isFinite(cmb.total)) { p = { success: p.success, timeSec: cmb.timeSec, totalXp: p.totalXp, xpHr: p.xpHr, name: p.name }; xpFinal = cmb.total; xpHrFinal = cmb.total / cmb.timeSec * 3600; }
    return {
      kind: o.kind, ui: o.kind === 'slay' ? slayUi(t) : null, skill: t.skill || 'slay', act: t.activityId || t.taskId, node: node, dashTimeSec: dashTime,
      qty: t.quantity || t.killTarget, done: t.progress || t.killCount || 0, lucky: !!t.lucky,
      boostDrops: o.kind === 'slay' ? missingBoostDrops(t.taskId) : 0,
      success: p.success, timeSec: p.timeSec, totalXp: xpFinal, xpHr: xpHrFinal, rawXp: rawXp, xpBonus: xpBonus, baseXp: baseXp, failXp: failXp, dbl: dbl, quest: quest,
      combat: cmb,
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
  // The loadout the combat window is really showing (its dropdown), falling back to what the game says is equipped.
  function fightLoadout() {
    try { if (M && M._loadoutStyle) return M._loadoutStyle; } catch (e) {}
    return G.equippedLoadout || G.activeLoadout;
  }
  // ---- DPS from the game's own Gear Calc ----------------------------------------------------------------------------------
  // The Gear Calc page (/wiki/tools/gearcalc-embed.html, same origin) is the game's most precise damage model. We hand it the same snapshot
  // the in-game Gear Calc button builds (your loadout for this fight vs this mob), load it in a hidden frame and read its "Avg DPS".
  var calc = { key: '', at: 0, busy: false, dps: null };
  function calcRefresh(taskId, loadoutStyle) {
    if (!U || calc.busy || !taskId) return;
    var key = taskId + '|' + loadoutStyle;
    if (calc.key === key && Date.now() - calc.at < 45000) return;
    calc.busy = true;
    try {
      localStorage.setItem(U.STORAGE_KEY, JSON.stringify(U.buildSnapshot({ encounterTaskId: taskId, loadoutStyle: loadoutStyle })));
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-12000px;top:0;width:1300px;height:900px;border:0;opacity:0;pointer-events:none';
      f.onload = function () {
        setTimeout(function () {
          try {
            var rows = [].slice.call(f.contentDocument.querySelectorAll('tr'));
            var tr = rows.filter(function (r) { return r.firstElementChild && /^Avg DPS/.test(r.firstElementChild.textContent.trim()); })[0];
            var v = tr ? parseFloat(tr.children[1].textContent) : NaN;
            if (isFinite(v) && v > 0) calc.dps = v;
          } catch (e) {}
          calc.key = key; calc.at = Date.now(); calc.busy = false;
          try { f.remove(); } catch (e) {}
        }, 1500);
      };
      f.onerror = function () { calc.busy = false; };
      f.src = U.CALC_URL + '?cc=' + Date.now();
      document.body.appendChild(f);
    } catch (e) { calc.busy = false; }
  }

  // ---- combat bar labels: overlay canvas ------------------------------------------------------------------------------------
  var simUnit = false, curUnit = null, barCfg = null, barAnch = { me: null, allies: new Map(), mobs: new Map() }, ov = null, octx = null, ovRaf = 0, ovLive = false, ovPoll = 0;   // ovLive: something was drawn last frame (the canvas needs clearing and per-frame upkeep)
  function ovEnsure() {
    var cv = document.getElementById('game-canvas'); if (!cv) return null;
    if (!ov || !ov.isConnected) {
      ov = document.createElement('canvas'); ov.id = 'cc-bar-labels'; ov.dataset.ccNew = '2';
      if (!document.getElementById('cc-bar-labels-style')) { var st = document.createElement('style'); st.id = 'cc-bar-labels-style'; st.textContent = '#cc-bar-labels:not([data-cc-new="2"]){display:none!important}'; document.head.appendChild(st); }
      var z = getComputedStyle(cv).zIndex;
      ov.style.cssText = 'position:fixed;pointer-events:none;z-index:' + (z === 'auto' ? '1' : z);
      cv.parentNode.insertBefore(ov, cv.nextSibling); octx = ov.getContext('2d');
    }
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    // Inside a transformed parent (the info bars squeeze the game container) a fixed overlay lives in the parent's own space, so use the canvas's untransformed box.
    try { var pt0 = getComputedStyle(ov.parentNode).transform; if (pt0 && pt0 !== 'none') r = { left: cv.offsetLeft, top: cv.offsetTop, width: cv.offsetWidth, height: cv.offsetHeight }; } catch (e0) {}
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (ov.width !== w) ov.width = w;
    if (ov.height !== h) ov.height = h;
    ov.style.left = r.left + 'px'; ov.style.top = r.top + 'px'; ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
    return { k: cv.width > 0 ? r.width / cv.width : 1, dpr: dpr };
  }
  function ovText(t, X, Y, px, align) {
    octx.font = '700 ' + px + 'px "Segoe UI", system-ui, sans-serif'; octx.textAlign = align || 'center'; octx.textBaseline = 'middle';
    octx.lineJoin = 'round'; octx.lineWidth = Math.max(2, px / 4); octx.strokeStyle = 'rgba(0,0,0,0.92)'; octx.fillStyle = '#fff';
    octx.strokeText(t, X, Y); octx.fillText(t, X, Y);
  }
  // Idle (outside combat, nothing drawn last frame): only look at 10 Hz and touch neither the DOM nor the canvas. Drawing runs at full rate.
  function ovDraw(ts) {
    ovRaf = requestAnimationFrame(ovDraw);
    if (!ovLive && ts - ovPoll < 100) return;
    ovPoll = ts;
    var F = barCfg && barCfg();
    if (!simUnit && !(F && E && E._active)) { if (ovLive) { ovLive = false; if (ov && octx) { octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height); } } return; }
    var g = ovEnsure(); if (!g) return;
    ovLive = true;
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height);
    if (simUnit) { octx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0); var sr = { M: [1.2, 0, 0, 1.2, 600, 400], x: 0, y: 0, w: 64, h: 6, t: performance.now() }; var sa = { hp: sr, sp: Object.assign({}, sr, { y: 8 }), at: Object.assign({}, sr, { y: 16 }) }; var lbl = function (rec, text, dx, dy, al) { var q = { X: (rec.M[0] * (rec.x + dx) + rec.M[4]) * g.k, Y: (rec.M[3] * (rec.y + dy) + rec.M[5]) * g.k }; ovText(text, q.X, q.Y, 14, al); }; lbl(sa.hp, '57 / 80', 32, 3); lbl(sa.sp, '12 / 30', 32, 3); lbl(sa.at, '1.37s', 32, 3); lbl(sa.at, 'DPS 11.48  ·  hit every 1.79s', 0, 12, 'left'); return; }
    octx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    var now = performance.now();
    var pt = function (rec, dx, dy) { // bar-local point -> overlay css px
      var Mx = rec.M, cx = rec.x + dx, cy = rec.y + dy;
      return { X: (Mx[0] * cx + Mx[2] * cy + Mx[4]) * g.k, Y: (Mx[1] * cx + Mx[3] * cy + Mx[5]) * g.k, s: Mx[0] * g.k };
    };
    var label = function (rec, text, dx, dy, align) { if (!rec) return; var q = pt(rec, dx, dy), px = Math.max(9, Math.min(22, Math.round(7.5 * q.s))); ovText(text, q.X, q.Y, px, align); };
    var unit = function (u, a, cat) {
      if (!u || !a) return;
      if (F[cat + 'Hp'] && a.hp) label(a.hp, Math.round(u.hp) + ' / ' + u.maxHp, a.hp.w / 2, a.hp.h / 2);
      if (F[cat + 'Spirit'] && a.sp && u.maxSpirit > 0) label(a.sp, Math.round(u.spirit) + ' / ' + u.maxSpirit, a.sp.w / 2, a.sp.h / 2);
      if (a.at && u.attackInterval > 0) {
        // attack bar: exact interval, then the countdown
        if (F[cat + 'Timer']) label(a.at, u.attackInterval.toFixed(2) + 's / ' + Math.max(0, u.attackTimer).toFixed(2) + 's', a.at.w / 2, a.at.h / 2);
        if (cat === 'me' && F.meDps && dpsCache && dpsCache.dps) label(a.at, 'DPS ' + dpsCache.dps.toFixed(2), 0, a.at.h + 6, 'left');
      }
    };
    if (barAnch.me && barAnch.me.u) unit(barAnch.me.u, barAnch.me, 'me'); // stays visible while mobs respawn
    barAnch.allies.forEach(function (a, u) {
      if (!(a.hp && now - a.hp.t < 250)) { if (now - ((a.hp && a.hp.t) || 0) > 5000) barAnch.allies.delete(u); return; }
      unit(u, a, 'ally');
    });
    barAnch.mobs.forEach(function (a, u) {
      if (!(a.hp && now - a.hp.t < 250)) { if (now - ((a.hp && a.hp.t) || 0) > 5000) barAnch.mobs.delete(u); return; }
      unit(u, a, 'enemy');
    });
  }
  function startOverlay() { if (!ovRaf) ovRaf = requestAnimationFrame(ovDraw); try { E.__ccStopOverlay = stopOverlay; } catch (e) {} }
  function stopOverlay() { if (ovRaf) cancelAnimationFrame(ovRaf); ovRaf = 0; ovLive = false; if (ov) { ov.remove(); ov = null; } barAnch = { me: null, allies: new Map(), mobs: new Map() }; }

  // Raid camera memory: the zoom and vertical offset that fitted each dungeon, kept in browser storage.
  var camInit = false, camSavedAt = 0;
  // the list of panels the camera fit looks at changes rarely but fitScene runs ~14 times a second: query it once a second, read the rects every call
  var fitPanelList = [], fitPanelAt = 0;
  function fitPanels() { var n = Date.now(); if (n - fitPanelAt > 1000) { fitPanelAt = n; fitPanelList = [].slice.call(document.querySelectorAll('.panel-floating, .raid-contrib-hud, .floating-current-task')); } return fitPanelList.filter(function (e) { return e.isConnected; }); }

  // Manual camera: when the player zooms (wheel) or pans (the game's free camera) the automatic fit stands down and does not touch the camera again until the game's own idle timer
  // (Settings > camera auto reset, 20 s by default) has run out; every zoom or pan starts that timer again. The game itself ends its free camera after that time and resets the zoom to
  // its raid zoom: the fit then eases back to what fits the party, as before.
  var userZoomAt = 0, wheelOn = null;
  function camResetMs() { try { var v = JSON.parse(localStorage.getItem('scapewatch_settings') || '{}').cameraAutoReset; return (v > 0 ? v : 20) * 1000; } catch (e) { return 20000; } }
  function watchUserZoom(cv) { if (wheelOn === cv) return; try { if (wheelOn) wheelOn.removeEventListener('wheel', onUserWheel, true); cv.addEventListener('wheel', onUserWheel, true); wheelOn = cv; } catch (e) { /* no canvas */ } }
  function onUserWheel(ev) { if (ev.isTrusted !== false) userZoomAt = Date.now(); }
  function unwatchUserZoom() { try { if (wheelOn) wheelOn.removeEventListener('wheel', onUserWheel, true); } catch (e) { /* gone */ } wheelOn = null; }
  function loadCam() { try { return JSON.parse(localStorage.getItem('cc-raid-cam') || '{}') || {}; } catch (e) { return {}; } }
  function saveCam(o) { try { localStorage.setItem('cc-raid-cam', JSON.stringify(o)); } catch (e) {} }
  // ---- Walking speed: the single source of truth (steps per second) ----
  // The game's own number: Y.totalMovementSpeed over the exact inputs the Unlocks panel feeds it (the game's _appendSkillLevelBoostsRow), plus the
  // movement potion that is active (the Unlocks panel shows the unbuffed total and the three potion variants next to it). Cached 500 ms.
  // speed() -> { sps (now, potion included), unbuffed, base (10), vigor:{level,effective}, mods:[{id,label,source,pct,steps}], potion:{id,name,pct,stepsLeft}|null,
  //   time(steps) -> seconds (a potion that runs out part-way is followed), at }.
  var SPD_EPS = 0.02, spdMemo = null, spdAt = 0;
  function speedCompute() {
    var unl = G.unlocks || {}, vig = (G.skills && G.skills.vigor && G.skills.vigor.level) || 1, eff = vig, EL = window.EffectiveLevel;
    try { var r = EL && EL.compute ? EL.compute({ level: vig, pets: G.pets, capes: G.capes, tools: unl.tools, itemsData: G.itemsData }, 'vigor') : null; if (r && r.effective > 0) eff = r.effective; } catch (e) { /* plain level */ }
    var relics = unl.relics || {}, tel = 0, i;
    for (i = 0; i <= 10; i++) { if (relics['telescope_t' + i]) tel += Y.TELESCOPE_MOVE_SPEED_BONUS_PER; if (relics['shiny_telescope_t' + i]) tel += Y.TELESCOPE_SHINY_MOVE_SPEED_BONUS_PER; }
    var beacons = unl.beacons || {}, tiers = Y.GAUNTLET_RARE_TIER_KEYS || [], bea = 0, gau = 0, banners = unl.banners || {}, ledgers = unl.ledgers || {}, comp = 0, compasses = unl.compasses || {};
    for (i = 0; i < tiers.length; i++) {
      if (beacons['beacon_swift_' + tiers[i]]) bea += Y.swiftBeaconMoveBonus(i);
      if (banners['gauntlet_banner_' + tiers[i]]) gau += Y.gauntletMilestoneMoveBonus(i);
      if (ledgers['gauntlet_ledger_' + tiers[i]]) gau += Y.gauntletMilestoneMoveBonus(i);
    }
    for (i = 0; i <= 10; i++) if (compasses['enchanted_compass_t' + i]) comp++;
    var tal = 0; try { if (window.RaidTreeEffects && G.raidTrees) tal = (window.RaidTreeEffects.sumEffects({ delve: [], fortify: (G.raidTrees.fortify && G.raidTrees.fortify.allocated) || [] }).moveSpeedPct || 0) / 100; } catch (e) { /* no tree */ }
    var col = 0; try { col = G.getCollectorProgress() * Y.COLLECTOR_MAX_MOVE_SPEED; } catch (e) { /* no collector */ }
    var anc = 0; try { anc = G.getShardSetMoveSpeedBonus ? G.getShardSetMoveSpeedBonus() : 0; } catch (e) { /* no shards */ }
    var J = { vigorLevel: eff, telescope: tel, compass: comp * Y.COMPASS_MOVE_SPEED_BONUS_PER, gauntlet: gau, beacon: bea, collector: col, ancient: anc, talent: tal };
    var unbuffed = Y.totalMovementSpeed(J), vigSteps = Y.movementSpeed(eff), pot = null, pm = 0;
    var mp = G.activePotions && G.activePotions.movement && G.activePotions.movement[0], pd = mp && Y.MOVEMENT_POTION_LOOKUP && Y.MOVEMENT_POTION_LOOKUP[mp.potionId];
    var left = 0; try { left = G.getDisplayedMovementYards(); } catch (e) { left = (mp && mp.yardsRemaining) || 0; }
    if (pd && left > 0) { pm = pd.speedMultiplier || 0; pot = { id: mp.potionId, name: G.getItemNameClean ? G.getItemNameClean(mp.potionId) : mp.potionId, pct: pm, stepsLeft: left }; }
    var sps = Y.totalMovementSpeed(Object.assign({}, J, { potionMult: pm }));
    var mods = [{ id: 'vigor', label: 'Vigor lvl ' + vig + (eff !== vig ? ' (effective ' + eff + ')' : ''), source: 'Vigor skill' + (eff !== vig ? ', pets, capes, tools' : ''), pct: null, steps: vigSteps - 10 }];
    [['telescope', 'Telescopes', 'Unlocks: telescopes', tel], ['compass', 'Compasses', 'Unlocks: enchanted compasses (' + comp + '/11)', J.compass], ['beacon', 'Swift Beacons', 'Unlocks: swift beacons', bea],
      ['gauntlet', 'Fortress Milestones', 'Unlocks: fortress banners and ledgers', gau], ['collector', 'Collector', 'Collection log progress', col], ['ancient', 'Ancient Shards', 'Shard sets and slates', anc],
      ['talent', 'Fleet Foot', 'Fortify tree', tal]].forEach(function (m) { if (m[3] > 0) mods.push({ id: m[0], label: m[1], source: m[2], pct: m[3], steps: vigSteps * m[3] }); });
    if (pot) mods.push({ id: 'potion', label: pot.name, source: 'Active movement potion', pct: pm, steps: vigSteps * pm });
    var info = { sps: sps, unbuffed: unbuffed, base: 10, vigor: { level: vig, effective: eff }, mods: mods, potion: pot, at: Date.now() };
    // Walking time for a distance in steps. A potion that runs out part-way is followed (the buffed stretch first, the rest at the unbuffed speed).
    info.time = function (steps) {
      steps = +steps; if (!(steps > 0) || !(sps > 0)) return 0;
      return pot && pot.stepsLeft < steps ? pot.stepsLeft / sps + (steps - pot.stepsLeft) / unbuffed : steps / sps;
    };
    return info;
  }
  function speedInfo() {
    var n = Date.now();
    if (!spdMemo || n - spdAt > 500) { try { var s = speedCompute(); if (s && s.sps > 0) { spdMemo = s; spdAt = n; } else if (!spdMemo) return null; } catch (e) { if (!spdMemo) return null; } }
    return spdMemo;
  }
  // Change subscriptions. Kept on window so they survive a bridge re-attach (the new bridge adopts them and the old poll stops).
  var subs = window.__ccBridgeSubs = window.__ccBridgeSubs || { speed: [] }, lastSps = window.__ccBridgeSpeedLast || null;
  subs.snap = subs.snap || [];
  try { clearInterval(window.__ccBridgeSpeedTimer); } catch (e) { /* none */ }
  window.__ccBridgeSpeedTimer = 0;
  // snapshot() -> one cached read-only object with everything the cards and plugins keep asking the bridge for separately:
  //   { at, rev, speed:{sps,unbuffed,potion}, held:{itemId:qty}, skills:{id:{level,xp}}, potions:{type:[{...}]}, task:{state,skill,activity,node,idle},
  //     slay:{active:{taskId,killCount,killTarget}|null, master}, combat:{active,raid,mobs,mobsAlive} }.
  // Rebuilt from the existing readers at most every 500 ms and only when asked (or by the one slow check below while somebody listens), so a dozen readers in one frame share one build.
  // rev goes up only when something a listener cares about changed (a skill LEVEL, not every XP tick); onChange('snapshot', fn(snap, changedKeys)) fires then.
  var snapMemo = window.__ccBridgeSnap || null, snapAt = 0, snapSig = window.__ccBridgeSnapSig || null, snapRev = (snapMemo && snapMemo.rev) || 0;
  function snapBuild() {
    var o = { at: Date.now(), rev: snapRev, speed: null, held: {}, skills: {}, potions: {}, task: null, slay: null, combat: null };
    try { var sp = speedInfo(); if (sp) o.speed = { sps: sp.sps, unbuffed: sp.unbuffed, potion: sp.potion }; } catch (e) { /* none */ }
    try { (G.bank || []).forEach(function (b) { if (b && b.itemId && b.qty > 0) o.held[b.itemId] = b.qty; }); } catch (e) { /* none */ }
    try { for (var k in (G.skills || {})) o.skills[k] = { level: G.skills[k].level, xp: G.skills[k].xp }; } catch (e) { /* none */ }
    try { Object.keys(G.activePotions || {}).forEach(function (t) { var a = G.activePotions[t] || []; if (a.length) o.potions[t] = a.map(function (x) { var r = {}; for (var q in x) if (typeof x[q] === 'number' || typeof x[q] === 'string') r[q] = x[q]; return r; }); }); } catch (e) { /* none */ }
    try {
      var ct = G.currentTask || null, st = G.slayTask && G.slayTask.active || null;
      o.task = { state: G.state || '', skill: (ct && ct.skill) || '', activity: (ct && ct.activityName) || '', node: (ct && ct.nodeName) || '', idle: !ct && !st && !(E && E._active) };
      o.slay = { active: st ? { taskId: st.taskId, killCount: st.killCount || 0, killTarget: st.killTarget || 1 } : null, master: G.queueMaster || null };
    } catch (e) { /* none */ }
    try { var ac = !!(E && E._active && E._playerUnit), mb = ac ? (E._mobs || []) : []; o.combat = { active: ac, raid: !!(ac && E._isRaid), mobs: mb.length, mobsAlive: mb.filter(function (m) { return m.alive !== false && !m.dead; }).length }; } catch (e) { /* none */ }
    return o;
  }
  // What counts as "changed" per part: cheap strings. XP and HP move every action, so they are left out (they are still fresh in the next snapshot).
  function snapSigs(o) {
    var lv = [], hk = Object.keys(o.held), hq = 0;
    for (var k in o.skills) lv.push(k + o.skills[k].level);
    hk.forEach(function (i) { hq += o.held[i]; });
    return {
      speed: o.speed ? Math.round(o.speed.sps / SPD_EPS) + '|' + (o.speed.potion ? o.speed.potion.id : '') : '',
      held: hk.length + ':' + hq, skills: lv.join(','),
      potions: Object.keys(o.potions).map(function (t) { return t + o.potions[t].map(function (x) { return x.potionId || x.id || ''; }).join('+'); }).join(','),
      task: o.task ? [o.task.state, o.task.skill, o.task.activity, o.task.node, o.task.idle].join('|') : '',
      slay: o.slay && o.slay.active ? o.slay.active.taskId + ':' + o.slay.active.killTarget : '-',
      combat: o.combat ? o.combat.active + ':' + o.combat.raid + ':' + o.combat.mobs : ''
    };
  }
  function snapshot(force) {
    var n = Date.now();
    if (!snapMemo || force || n - snapAt > 500) {
      var o = snapBuild(), sg = snapSigs(o), prev = snapSig, changed = [];
      if (prev) Object.keys(sg).forEach(function (k) { if (sg[k] !== prev[k]) changed.push(k); });
      if (changed.length) snapRev++;
      o.rev = snapRev; snapMemo = window.__ccBridgeSnap = o; snapSig = window.__ccBridgeSnapSig = sg; snapAt = n;
      if (changed.length) subs.snap.slice().forEach(function (fn) { try { fn(o, changed); } catch (e) { /* a subscriber must not break the others */ } });
    }
    return snapMemo;
  }
  function pollSpeed() {
    if (window.__ccBridge !== bridge) { clearInterval(window.__ccBridgeSpeedTimer); return; }
    if (subs.snap.length) { try { snapshot(true); } catch (e) { /* next second */ } }
    if (!subs.speed.length) return;
    spdAt = 0; var s = speedInfo(); if (!s) return;
    var prev = lastSps; if (prev != null && Math.abs(s.sps - prev) <= SPD_EPS) return;
    lastSps = window.__ccBridgeSpeedLast = s.sps;
    if (prev == null) return;
    subs.speed.slice().forEach(function (fn) { try { fn(s, prev); } catch (e) { /* a subscriber must not break the others */ } });
  }
  function startSpeedPoll() { clearInterval(window.__ccBridgeSpeedTimer); window.__ccBridgeSpeedTimer = setInterval(pollSpeed, 1000); }
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
    // Material check for the Material Shortage Warning: every processing task in the queue (and the running one) with what it
    // consumes, what you hold (bank + inventory), your chance to save materials, and the scrap item used when you run out.
    // The same materials are not counted twice: tasks are checked in queue order against what the earlier ones leave over.
    shortages: function (credit) {
      try {
        if (credit == null) credit = 0.5; // share of the save chance counted when earlier tasks use up materials
        var out = [], used = {}, tasks = [];
        var head = D._queueHead();
        if (head && head.task) tasks.push({ where: 'now', task: head.task });
        G.taskQueue.forEach(function (s, i) { var o = (s.options || [])[s.selectedIndex || 0]; if (o && o.task) tasks.push({ where: i + 1, task: o.task }); });
        tasks.forEach(function (e) {
          var t = e.task;
          if (t.type !== 'processing' || !t.input || t.skill === 'discover') return;
          var remaining = Math.max(0, (t.quantity || 0) - (t.progress || 0));
          var perAct = 1; // one input per action (the game compares the quantity with what you hold)
          var save = 0; try { save = G._getDoubleGatherChance(t.skill) || 0; } catch (e2) {}
          var have = (G.getBankQty(t.input) || 0) + (G.getInventoryQty(t.input) || 0) - (used[t.input] || 0);
          var scrap = t.skill === 'barter' ? 'scrap_coins' : (Y && Y.RAW_SCRAP_MAP && Y.RAW_SCRAP_MAP[t.skill]) || null;
          var need = remaining * perAct;
          used[t.input] = (used[t.input] || 0) + need * (1 - save * credit);
          out.push({ where: e.where, skill: t.skill, act: t.activityId, input: t.input, inputName: G.getItemNameClean ? G.getItemNameClean(t.input) : t.input,
            remaining: remaining, perAct: perAct, need: need, have: Math.max(0, have), save: save, scrap: scrap });
        });
        return out;
      } catch (e) { return null; }
    },
    // Kills per mob and the rare drops you have / have not got, for the Drop Luck Tracker. Only drops that are single collectible items
    // count (stacks like food or materials are not in the collection log, so they cannot be checked). Pets are per-skill counts.
    // Diary and credits, read only, for the Diary and Credits panel (overlay/diary-credits.js + diary-credits-core.js). The slow parts (steps of every bank, which
    // nodes sit next to which bank, which mob sits where) never change in a session and are built once; progress, levers and credits are read fresh on every call.
    diaryState: function () {
      try {
        if (!G.diary || !G.diary.loaded || !G.diary.byBank) return null;
        var by = G.diary.byBank, ids = Object.keys(by);
        if (!diaryStatic || diaryStatic.n !== ids.length) {
          var enc = {}; (G.encounters || []).forEach(function (e) { if (e && e.taskId) enc[e.taskId] = e.nodeId || e.taskId; });
          var nodes = [], nname = {};
          (G.nodesData || []).forEach(function (n) {
            nname[n.id] = n.name || n.id;
            if ((n.type !== 'skill' && n.type !== 'combat') || !n.nearestBankId) return;
            var acts = []; (n.activities || []).forEach(function (a) { if (a && a.skill && a.activityId) acts.push(a.skill + ':' + a.activityId); });
            var dist = null; if (n.type === 'skill') { try { var dd = G.getPathDistance(n.id, n.nearestBankId); dist = isFinite(dd) ? Math.round(dd) : null; } catch (e5) { dist = null; } }
            nodes.push({ id: n.id, name: n.name || n.id, bank: n.nearestBankId, type: n.type, acts: acts, d: dist });
          });
          var steps = {};
          ids.forEach(function (id) { steps[id] = (by[id].steps || []).map(function (st) { return { key: st.key, kind: st.kind, skill: st.skill || 'slay', activityId: st.activityId || '', name: st.name || st.key, req: st.kind === 'combat' ? (st.slayRequired || 0) : (st.levelRequired || 0), node: st.kind === 'combat' ? (enc[st.encounterTaskId] || st.encounterTaskId || '') : '' }; }); });
          diaryStatic = { n: ids.length, nodes: nodes, nname: nname, steps: steps };
        }
        var banks = ids.map(function (id) {
          var b = by[id], ck = b.completedKeys || {};
          return { id: id, name: (b.bankName || id).replace(/ Bank$/, ''), total: b.total || 0, completed: b.completed || 0, tier: b.tier || 0,
            steps: diaryStatic.steps[id].map(function (st) { return { key: st.key, kind: st.kind, skill: st.skill, activityId: st.activityId, name: st.name, req: st.req, node: st.node, done: !!ck[st.key] }; }) };
        });
        var lv = {}, levels = {}; var wn = (S && S.weights && S.weights.nodes) || {};
        Object.keys(wn).forEach(function (sk) { var m = wn[sk], o = null; for (var nid in m) if (m[nid]) { (o || (o = {}))[nid] = m[nid]; } if (o) lv[sk] = o; });
        Object.keys(G.skills || {}).forEach(function (sk) { levels[sk] = (G.skills[sk] && G.skills[sk].level) || 1; });
        // Where the rolls go: the share of each skill, of each open activity inside it (the Lever Advisor's own odds), and the nodes the last 200 completed tasks were done at
        var skillOdds = {}, actOdds = {}, used = {}, usedN = 0;
        try { (bridge.oddsSkills() || []).forEach(function (r) { if (!r.quests && r.pct > 0) skillOdds[r.id] = r.pct; }); } catch (e6) { skillOdds = {}; }
        Object.keys(skillOdds).forEach(function (sk) { try { var t = bridge.oddsTiers(sk), o = {}; (t || []).forEach(function (a) { if (a.open && a.pct > 0) o[a.id] = a.pct; }); actOdds[sk] = o; } catch (e7) { actOdds[sk] = {}; } });
        try {
          var idByName = {}; diaryStatic.nodes.forEach(function (n) { idByName[n.name] = n.id; });
          ((S && S.taskHistory) || []).forEach(function (x) { var id = idByName[x.nodeName]; if (!id || !x.skill) return; (used[x.skill] || (used[x.skill] = {}))[id] = ((used[x.skill] || {})[id] || 0) + 1; usedN++; });
        } catch (e8) { used = {}; usedN = 0; }
        var sps = 0; try { var spd = bridge.speed(); sps = spd ? spd.sps : 0; } catch (e9) { sps = 0; }
        return { banks: banks, nodes: diaryStatic.nodes, nodeNames: diaryStatic.nname, levers: lv, levels: levels, haveLevers: !!(S && S.weights), skillOdds: skillOdds, actOdds: actOdds, used: used, usedN: usedN, sps: sps,
          credits: { total: (S && S.totalSkillCredits) || 0, individual: (S && S.individualSkillCredits) ? JSON.parse(JSON.stringify(S.individualSkillCredits)) : {}, reroll: G.rerollCredits || 0 } };
      } catch (e) { return null; }
    },
    // Everything that can drop in the two endless raids (Chaos Dungeon, Fortress), the way the game's own Drop Table lists them: tiered specials per wave band, tools, components,
    // and which of them are already in the collection log. The per-kill / per-wave chances are NOT published (the game says "chance rising with wave depth"), so none is made up here.
    endlessLoot: function () {
      try {
        var I = G.itemsData || {}, coll = G.collections || {}, start = (Y && Y.GAUNTLET_RARE_TIER_START) || { t1: 1, t2: 21, t3: 41, t4: 61, t5: 81, c: 101, c7: 121 };
        var nm = function (id) { try { return G.getItemNameClean(id) || (I[id] && I[id].name) || id; } catch (e) { return (I[id] && I[id].name) || id; } };
        var owned = function (rid, id) { var g = (coll['raid_' + rid] || {})[id]; return g || 0; };
        var item = function (rid, id, extra) { var o = { id: id, name: nm(id), got: owned(rid, id) || 0 }; for (var k in (extra || {})) o[k] = extra[k]; return o; };
        // Specials (Chaos): items with slot 'special' named <family>_t1..t5 / _c, minus the excluded families
        var excl = (Y && Y.SPECIAL_DROP_EXCLUDED_FAMILIES) || {}, fam = {};
        Object.keys(I).forEach(function (id) { var it = I[id]; if (!it || it.slot !== 'special') return; var m = /^(.*)_(t[1-5]|c)$/.exec(id); if (!m || excl[m[1]]) return; (fam[m[1]] || (fam[m[1]] = { family: m[1], name: m[1], tiers: {} })).tiers[m[2]] = id; if (m[2] === 't1') fam[m[1]].name = nm(id); });
        var special = Object.keys(fam).map(function (k) { var f = fam[k]; return { family: f.family, name: f.name, tiers: Object.keys(f.tiers).map(function (t) { return item('chaos', f.tiers[t], { tier: t, wave: start[t] || 1 }); }) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        var ids = function (fn) { try { return (Y && typeof Y[fn] === 'function' ? Y[fn](I) : []) || []; } catch (e) { return []; } };
        var tools = ids('chaosRaidToolIds').map(function (id) { return item('chaos', id, { wave: start.c7 || 121 }); });
        var chaosMats = ids('chaosRaidChaosMaterialIds').map(function (id) { return item('chaos', id, { wave: start.c || 101 }); });
        var godMats = ids('chaosRaidGodMaterialIds').map(function (id) { return item('chaos', id, { wave: start.c7 || 121 }); });
        // Fortress: tiered rares (items carrying gauntletRareTier)
        var gf = {};
        Object.keys(I).forEach(function (id) { var it = I[id]; if (!it || !it.gauntletRareTier) return; var t = it.gauntletRareTier, fk = id.slice(0, id.length - (t.length + 1)); (gf[fk] || (gf[fk] = { family: fk, name: fk, tiers: {} })).tiers[t] = id; if (t === 't1') gf[fk].name = nm(id); });
        var gauntlet = Object.keys(gf).map(function (k) { var f = gf[k]; return { family: f.family, name: f.name, tiers: Object.keys(f.tiers).map(function (t) { return item('gauntlet', f.tiers[t], { tier: t, wave: start[t] || 1 }); }) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        return { start: start, matDiv: (Y && Y.CHAOS_RAID_MATERIAL_RATE_DIV) || 5, special: special, tools: tools, chaosMats: chaosMats, godMats: godMats, gauntlet: gauntlet };
      } catch (e) { return null; }
    },
    // Exact numbers behind a food and a potion, for the Active Potions hover cards (read only; the same formulas the game's own tooltips use).
    //   foodInfo(itemId)   -> { id, name, base, parts:[{label,n}], rawBonus, bonusMax, bonus, spices, spiceEach, mult, heal, maxHp, cooldown } | null
    //   potionInfo(itemId) -> { id, name, kind:'combat'|'movement'|'discovery'|'spirit'|'teleport', eff, ... } | null
    foodInfo: function (id) {
      try {
        var it = G.itemsData && G.itemsData[id]; if (!it || !it.healHP) return null;
        var pets = G.pets || {}, caps = G.capes || {}, parts = [], add = function (label, n) { if (n) parts.push({ label: label, n: n }); };
        var lp = pets.life || {}; add('Life pet', lp.normal >= 1 ? 1 : 0); add('Shiny Life pet', lp.shiny >= 1 ? 1 : 0);
        var lc = caps.life || {}; add('Life skill cape', lc.skillCape ? 1 : 0); add('Trimmed Life cape', lc.trimmedCape ? 1 : 0);
        add('Max cape', caps.maxCape ? 1 : 0); add('Trimmed Max cape', caps.trimmedMaxCape ? 1 : 0);
        var ap = pets.allSkills || {}; add('All Skills pet', ap.normal >= 1 ? 1 : 0); add('Shiny All Skills pet', ap.shiny >= 1 ? 1 : 0);
        var tal = 0; try { tal = (G._getTalentEffects && G._getTalentEffects().foodHeal) || 0; } catch (e1) { /* none */ } add('Talents', tal);
        var raw = parts.reduce(function (t, x) { return t + x.n; }, 0), max = (Y && Y.FOOD_HEAL_BONUS_MAX) || 20, bonus = Math.min(raw, max);
        var sp = (G.unlocks && G.unlocks.spices) || {}, ns = 0; for (var k in sp) if (sp[k]) ns++;
        var each = (Y && Y.SPICE_FOOD_HEAL_BONUS) || 0.2, mult = 1 + ns * each;
        var hs = (G.unlocks && G.unlocks.hotsauces) || {}, nh = 0; for (var h in hs) if (hs[h]) nh++;
        var cd = Math.max(0, ((Y && Y.FOOD_AUTO_EAT_COOLDOWN_MS) || 5000) - nh * ((Y && Y.HOT_SAUCE_EAT_COOLDOWN_REDUCTION_MS) || 250)) / 1000;
        var maxHp = 0; try { maxHp = G.getEffectiveMaxHP(); } catch (e2) { /* none */ }
        return { id: id, name: (G.getItemNameClean && G.getItemNameClean(id)) || it.name || id, base: it.healHP, parts: parts, rawBonus: raw, bonusMax: max, bonus: bonus, spices: ns, spiceEach: each, mult: mult, heal: Math.floor((it.healHP + bonus) * mult), maxHp: maxHp, cooldown: cd, hotsauces: nh };
      } catch (e) { return null; }
    },
    potionInfo: function (id) {
      try {
        var it = G.itemsData && G.itemsData[id], nm = (G.getItemNameClean && G.getItemNameClean(id)) || (it && it.name) || id;
        var al = (G.skills && G.skills.alms && G.skills.alms.level) || 1, t = 0, tiers = (Y && Y.POTION_EFFICIENCY_TIERS) || [];
        for (var i = 0; i < tiers.length; i++) if (al >= tiers[i].almsLevel) t += tiers[i].bonus;
        var eff = 1 + Math.min(t, (Y && Y.POTION_EFFICIENCY_MAX_BONUS) || 0), o = { id: id, name: nm, eff: eff, alms: al, queue: true };
        var cb = Y && Y.COMBAT_POTION_BOOSTS && Y.COMBAT_POTION_BOOSTS[id];
        if (cb) { var base = Y.combatPotionAttacks(cb.tier); o.kind = 'combat'; o.style = cb.style; o.tier = cb.tier; o.acc = cb.acc || 0; o.str = cb.str || 0; o.dodge = cb.dodge || 0; o.defend = cb.defend || 0; o.baseCharges = base; o.charges = Math.floor(base * eff); o.unit = 'attacks'; o.useInCombat = G.combatPotionUse !== false; return o; }
        var mv = Y && Y.MOVEMENT_POTION_LOOKUP && Y.MOVEMENT_POTION_LOOKUP[id];
        if (mv) { o.kind = 'movement'; o.pct = mv.speedMultiplier; o.baseCharges = mv.duration; o.charges = Math.floor(mv.duration * eff); o.unit = 'charges'; return o; }
        var dv = Y && Y.DISCOVERY_POTION_LOOKUP && Y.DISCOVERY_POTION_LOOKUP[id];
        if (dv) { o.kind = 'discovery'; o.tier = dv.tier; o.chestRolls = dv.chestBonusRolls || 0; o.baseCharges = dv.charges; o.charges = Math.floor(dv.charges * eff); o.unit = 'charges'; return o; }
        var sv = Y && Y.SPIRIT_POTION_LOOKUP && Y.SPIRIT_POTION_LOOKUP[id];
        if (sv) { var ch = (Y.SPIRIT_POTION_CHARGES && Y.SPIRIT_POTION_CHARGES[id]) || 0, ms = G.maxSpirit || 0; o.kind = 'spirit'; o.tier = sv.tier; o.restoreMult = sv.restoreMultiplier; o.restoreFlat = sv.restoreFlat; o.maxSpirit = ms; o.restore = Math.max(1, Math.floor(ms * sv.restoreMultiplier)); o.baseCharges = ch; o.charges = Math.floor(ch * eff); o.unit = 'charges'; o.autoAt = (Y && Y.SPIRIT_POTION_AUTO_THRESHOLD) || 0.1; return o; }
        var tn = { faulty_crystal: 1, stable_crystal: 2, perfect_crystal: 3 }[id];
        if (tn) { o.kind = 'teleport'; o.tier = tn; o.unit = 'charges'; return o; }
        return null;
      } catch (e) { return null; }
    },
    dropState: function () {
      try {
        var kills = G.dropCounts || {}, coll = G.collections || {}, I = G.itemsData || {}, mobs = [];
        (G.encounters || []).forEach(function (e) {
          var rd = (e.rareDrops || []).filter(function (d) { return d && d.itemId && !d.quantity && d.oneInChance > 0; });
          if (!rd.length) return;
          var got = coll[e.taskId] || {};
          mobs.push({ id: e.taskId, name: e.name || e.taskId, kills: kills[e.taskId] || 0,
            drops: rd.map(function (d) { var it = I[d.itemId] || {}; return { id: d.itemId, name: it.name || d.itemId, n: d.oneInChance, got: got[d.itemId] || 0, unlock: it.unlockType ? 1 : 0, ut: it.unlockType || '', us: it.unlockSkill || '' }; }) });
        });
        // Raid / dungeon / Fortress loot: the rare table of each raid, what you have, and how many runs you have done.
        var raids = [];
        (G.raidsData || []).forEach(function (r) {
          var dt = r.dropTable || {}, gotR = coll['raid_' + r.id] || {}, st = (G.raidStats && G.raidStats[r.id]) || {};
          var perRun = r.id !== 'chaos' && r.id !== 'gauntlet';     // the others roll once per run; Chaos and the Fortress roll per wave
          raids.push({ id: r.id, name: r.name || r.id, kc: st.kc || 0, bestWave: st.bestWave || 0, perRun: perRun,
            rare: (dt.rare || []).filter(function (d) { return d && d.itemId && d.oneInChance > 0; }).map(function (d) { var it = I[d.itemId] || {}; return { id: d.itemId, name: it.name || d.itemId, n: d.oneInChance, got: gotR[d.itemId] || 0, unlock: it.unlockType ? 1 : 0, ut: it.unlockType || '', us: it.unlockSkill || '' }; }),
            milestone: (dt.milestone || []).map(function (d) { var it = I[d.itemId] || {}; return { id: d.itemId, name: it.name || d.itemId, kind: d.kind || '', at: d.threshold || d.thresholdMs || 0, wave: d.targetWave || 0, got: gotR[d.itemId] || 0 }; }) });
        });
        var pets = [];
        for (var sk in (G.pets || {})) { var pp = G.pets[sk] || {}; var nm = sk; try { nm = G.getSkillName(sk) || sk; } catch (e2) {} var seasonal = sk !== 'allSkills' && !(G.skills && G.skills[sk]); if (seasonal) nm = nm.replace(/^holiday_/, 'holiday ').replace(/_/g, ' ').split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); pets.push({ skill: sk, name: nm, normal: pp.normal || 0, shiny: pp.shiny || 0, seasonal: seasonal, xp: sk === 'allSkills' ? 0 : ((G.skills[sk] && G.skills[sk].xp) || 0) }); }
        var totalXp = 0; try { totalXp = G.getTotalXP(); } catch (e3) {}
        // Lucky tools: one per skill, dropped per XP gained in that skill; the shiny version is the same roll made 5 times rarer.
        var lucky = [], toolsOwned = (G.unlocks && G.unlocks.tools) || {}, byS = {};
        Object.keys(I).forEach(function (id) {
          var it = I[id];
          if (!it || it.unlockType !== 'tool' || !it.lucky || !it.unlockSkill) return;
          var o = byS[it.unlockSkill] || (byS[it.unlockSkill] = { skill: it.unlockSkill });
          if (it.shiny) { o.sid = id; o.shinyOwned = !!toolsOwned[id]; } else { o.id = id; o.owned = !!toolsOwned[id]; }
        });
        Object.keys(byS).forEach(function (sk) {
          var o = byS[sk], lant = /lantern/.test(o.id || ''), div = lant ? ((Y && Y.LUCKY_LANTERN_XP_DIVISOR) || 1e7) : ((Y && Y.LUCKY_TOOL_XP_DIVISOR) || 1e6);
          var nm = sk; try { nm = G.getSkillName(sk) || sk; } catch (e4) {}
          lucky.push({ skill: sk, name: nm, id: o.id || '', sid: o.sid || '', owned: !!o.owned, shinyOwned: !!o.shinyOwned, xp: (G.skills[sk] && G.skills[sk].xp) || 0, div: div, sdiv: lant ? ((Y && Y.LUCKY_LANTERN_SHINY_DIVISOR) || div * 5) : div * 5 });
        });
        return { mobs: mobs, raids: raids, pets: pets, lucky: lucky, totalXp: totalXp, petShinyDiv: ((Y && Y.PET_XP_DIVISOR) || 1e7) / ((Y && Y.PET_SHINY_CHANCE) || 0.2), petDiv: (Y && Y.PET_XP_DIVISOR) || 1e7, allDiv: (Y && Y.ALL_SKILLS_PET_NORMAL_DIVISOR) || 1e8, allShinyDiv: (Y && Y.ALL_SKILLS_PET_SHINY_DIVISOR) || 5e8, totalKills: (G.stats && G.stats.kills) || 0 };
      } catch (e) { return null; }
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
        // true = already in the collection log. The game's own test for the book icon on a crafting button is needsSkillingStamp.
        var chk = function (id) { try { if (id && !(id in logged)) logged[id] = !G.needsSkillingStamp(id); } catch (e) {} };
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
    // Raw live state for the task log and diagnostics (read only).
    live: function () {
      try {
        var ct = G.currentTask || null, st = G.slayTask && G.slayTask.active || null;
        var xp = {}; for (var k in G.skills) xp[k] = G.skills[k].xp;
        return { t: Date.now(), loadouts: { equipped: G.equippedLoadout || null, active: G.activeLoadout || null, auto: G.autoLoadoutEnabled && G.autoLoadouts && st ? ((G.autoLoadouts[st.taskId] || {}).loadoutStyle || null) : null }, state: G.state, dest: G.destinationNodeId || null, at: G.currentNodeId || null,
          task: ct ? JSON.parse(JSON.stringify(ct)) : null, slay: st ? JSON.parse(JSON.stringify(st)) : null, xp: xp };
      } catch (e) { return null; }
    },
    // Read-only holdings snapshot for the Task Log: item counts (bank + inventory), gold, potion charges and the game's own task counters.
    // items: { itemId: qty }; pots: { style: [{ id, left }] } as the game keeps them (left = remaining charges when the game says so).
    ledger: function () {
      try {
        var items = {}, add = function (arr) { (arr || []).forEach(function (e) { if (e && e.itemId && e.qty > 0) items[e.itemId] = (items[e.itemId] || 0) + e.qty; }); };
        add(G.bank); add(G.inventory);
        var gold = null; ['gold', 'coins', 'gp', 'money'].forEach(function (k) { if (gold == null && typeof G[k] === 'number') gold = G[k]; });
        var pots = {}; Object.keys(G.activePotions || {}).forEach(function (t) { var a = G.activePotions[t] || []; if (a.length) pots[t] = a.map(function (x) { var o = {}; for (var k in x) if (typeof x[k] === 'number' || typeof x[k] === 'string') o[k] = x[k]; return o; }); });
        var tc = S && S.tasksCompleted || {}, total = 0; for (var k2 in tc) total += tc[k2] || 0;
        var h = S && S.taskHistory || [];
        return { items: items, gold: gold, pots: pots, tasksTotal: total, tasksBy: JSON.parse(JSON.stringify(tc)), slayDone: G.slayTask && G.slayTask.tasksCompleted || 0, histLen: h.length, histNewest: h[0] ? { skill: h[0].skill, act: h[0].activityName, qty: h[0].quantity, ts: h[0].timestamp } : null };
      } catch (e) { return null; }
    },
    // The Skills Customization window's own task history (server-sent, newest first, the last ~200 non-slay tasks) and which view is open.
    // Slay tasks are never in it: the game keeps only a counter for them (slayDone in ledger()).
    taskHistory: function () {
      try {
        var h = S && S.taskHistory || [];
        return { view: S ? S.currentView : null, skill: S ? S.currentSkillId : null, entries: h.map(function (x) { return { skill: x.skill, name: x.activityName, qty: x.quantity, ts: x.timestamp }; }) };
      } catch (e) { return null; }
    },
    // Item id -> display name for the Task Log tooltip (read only).
    itemName: function (id) { try { var it = G.itemsData && G.itemsData[id]; return it ? (it.name || id) : id; } catch (e) { return id; } },
    // Live combat numbers for the Combat Readout (read only): the combat scene's own units plus the game's expected DPS formula.
    combat: function () {
      if (!E || !E._active || !E._playerUnit) return null;
      var u = function (x) { return { name: x.name || null, hp: x.hp, maxHp: x.maxHp, spirit: x.spirit, maxSpirit: x.maxSpirit, timer: x.attackTimer, interval: x.attackInterval, alive: x.alive !== false && !x.dead }; };
      var out = { player: u(E._playerUnit), mobs: (E._mobs || []).map(u), selected: E._selectedSide === 'mob' ? E._selectedMobIdx : -1, raid: !!E._isRaid, dps: null };
      var now = Date.now();
      try {
        var head = D._queueHead(), id = head && head.task && head.task.taskId;
        var ls = fightLoadout();
        if (id && (!dpsCache || dpsCache.id !== id || dpsCache.ls !== ls || now - dpsCache.at > 3000)) {
          var mob = G.mobTypes && G.mobTypes[id], ks = mob ? D._killSeconds(id, ls) : null;
          dpsCache = { id: id, ls: ls, at: now, dps: ks && mob.life ? (mob.life * (Y.LIFE_HP_MULT || 2)) / ks : null };
        }
        // Prefer the Gear Calc's own figure when it has been read for this exact mob and loadout.
        calcRefresh(id, ls);
        if (dpsCache && calc.key === id + '|' + ls && calc.dps) dpsCache.dps = calc.dps;
        if (dpsCache) out.dps = dpsCache.dps;
      } catch (e) {}
      return out;
    },
    // Exact numbers on the combat scene's own HP / Spirit / attack-timer bars. Display only: the scene's bar painter is wrapped just to note
    // WHERE each bar is drawn; the text itself is painted on a separate full-resolution overlay canvas (the game canvas is drawn smaller and
    // scaled up, which made text on it blurry). Your own labels stay on screen while mobs respawn. cfg() -> truthy to show them.
    barLabels: function (cfg) {
      if (!E || typeof E._drawBar !== 'function') return false;
      // A bridge re-install leaves the previous instance's wrappers and overlay on the scene: undo them first.
      try { if (E.__ccStopOverlay) E.__ccStopOverlay(); } catch (e) {}
      if (E.__ccOrigBar) {
        E._drawBar = E.__ccOrigBar; delete E.__ccOrigBar;
        var prevU = E.__ccOrigUnits || {}; for (var pn in prevU) E[pn] = prevU[pn]; delete E.__ccOrigUnits;
      }
      var stale = document.getElementById('cc-bar-labels'); if (stale) stale.remove();
      if (!E.__ccOrigBar) {
        E.__ccOrigBar = E._drawBar;
        E.__ccOrigUnits = {};
        ['_drawPlayerBars', '_drawMobBars', '_drawRaidPlayerBars'].forEach(function (name) {
          if (typeof E[name] !== 'function') return;
          var o = E[name]; E.__ccOrigUnits[name] = o;
          E[name] = function () {
            var prev = curUnit;
            try {
              curUnit = name === '_drawPlayerBars' ? { u: this._playerUnit, cat: 'me' }
                : name === '_drawMobBars' ? { u: arguments[1], cat: 'enemy' }
                : { u: arguments[1], cat: arguments[1] && arguments[1].playerId === E._localPlayerId ? 'me' : 'ally' };
            } catch (e) { curUnit = null; }
            try { return o.apply(this, arguments); } finally { curUnit = prev; }
          };
        });
      }
      var orig = E.__ccOrigBar;
      barCfg = cfg;
      E._drawBar = function (ctx, x, y, w, h, r, c1, c2, d, g) {
        orig.apply(this, arguments);
        try {
          var kind = c1 === '#5cbf60' || c1 === '#f25555' ? 'hp' : c1 === '#b06cc8' ? 'sp' : c1 === '#e8a832' ? 'at' : null;
          if (!kind || !curUnit || !curUnit.u || !barCfg || !barCfg()) return;
          var m = ctx.getTransform(), rec = { M: [m.a, m.b, m.c, m.d, m.e, m.f], x: x, y: y, w: w, h: h, t: performance.now() };
          var slot;
          if (curUnit.cat === 'me') slot = (barAnch.me = barAnch.me || {});
          else { var mp = curUnit.cat === 'ally' ? barAnch.allies : barAnch.mobs; slot = mp.get(curUnit.u) || (mp.set(curUnit.u, {}), mp.get(curUnit.u)); }
          slot[kind] = rec; slot.u = curUnit.u;
        } catch (e) {}
      };
      startOverlay();
      return true;
    },
    // Dungeon / raid view: choose the zoom so EVERY party member and mob fits between the top HUD and the lowest panel, and centre them in that
    // band. Positions come from the scene's own world coordinates (not from painted bars), so a player hidden behind a panel still counts.
    // The game restores its own zoom when combat ends; the camera shift is undone here too. Returns what it did, for diagnostics.
    // The game has ONE generic event system (HolidayEvents / the holiday manager), not one per event: the server sends holiday_status
    // { active, key, id, total (community finds), boostPct (community XP boost), endsAt }, mirrored at G.holidayStatus. Halloween is just the first key.
    holiday: function () {
      try { var h = G.holidayStatus; if (!h || !h.active) return { active: false }; var o = {}; for (var k in h) { var t = typeof h[k]; if (t === 'string' || t === 'number' || t === 'boolean') o[k] = h[k]; } o.active = true; return o; } catch (e) { return { active: false }; }
    },
    // the game's own XP inputs for a mob (read-only): per-kill base XP of every skill it pays, and each skill's current XP bonus
    mobXp: function (id) {
      try { var mob = G.mobTypes && G.mobTypes[id]; if (!mob) return null; var hp = (mob.life || 0) * ((Y && Y.LIFE_HP_MULT) || 2), bon = {};
        ['slay', 'life', 'spirit', 'strike', 'heft', 'sight', 'draw', 'focus', 'surge', 'dodge', 'defend', 'vigor'].forEach(function (k) { bon[k] = G.getSkillXpBonus(k) || 0; });
        return { slay: mob.slayXPOnKill || 0, spirit: mob.spiritXPOnKill || 0, hp: hp, chosen: Y.COMBAT_XP_CHOSEN_MULTIPLIER, life: Y.COMBAT_XP_LIFE_MULTIPLIER, sec: Y.COMBAT_XP_SECONDARY_MULTIPLIER, bonus: bon };
      } catch (e) { return null; }
    },
    // the game's own XP inputs for an activity (read-only): base XP on success / fail, the skill's XP bonus and its double-gather (or material-save) chance
    actXp: function (skill, act) {
      try { var ai = D._activityInfo(skill, act); if (!ai || typeof ai.successXP !== 'number') return null;
        return { base: ai.successXP, fail: (Y && Y.activityFailXP) ? Y.activityFailXP(ai.successXP) : 0, bonus: G.getSkillXpBonus(skill) || 0, dbl: G._getDoubleGatherChance ? G._getDoubleGatherChance(skill) || 0 : 0 };
      } catch (e) { return null; }
    },
    fitScene: function () {
      try {
        if (!E || !E._active || !E._isRaid) { camInit = false; userZoomAt = 0; unwatchUserZoom(); bridge.fitReset(); return null; }
        // First frame of a raid: go straight to the camera that fitted this dungeon last time (remembered between waves and restarts).
        var camKey = G.raidName || 'raid';
        if (!camInit) {
          camInit = true;
          var sv = loadCam()[camKey];
          if (sv && isFinite(sv.z) && isFinite(sv.o)) {
            if (Y.__ccViewOff0 === undefined) Y.__ccViewOff0 = Y.COMBAT_VIEW_Y_OFFSET || 0;
            G.targetZoom = sv.z; Y.COMBAT_VIEW_Y_OFFSET = sv.o; try { G.updateCamera(); } catch (e0) {}
          }
        }
        var cv = document.getElementById('game-canvas'); if (!cv) return null;
        watchUserZoom(cv);
        if (G.cameraFree) { userZoomAt = 0; return { manual: 'free camera' }; }   // the player is panning: the game's timer ends it
        if (userZoomAt && Date.now() - userZoomAt < camResetMs()) return { manual: 'zoom' };
        var r = cv.getBoundingClientRect(), k = cv.width > 0 ? r.width / cv.width : 1;
        var ys = [], xs = [], push = function (p) { if (p && isFinite(p.x) && isFinite(p.y)) { ys.push(p.y); xs.push(p.x); } };
        push(E._getPlayerWorldPos && E._getPlayerWorldPos());
        (E._partyPlayers || []).forEach(function (pp, i) { if (pp && !pp.removed) push(E._getRaidPlayerWorldPos(i)); });
        (E._mobs || []).forEach(function (m, i) { push(E._getMobWorldPos(i)); });
        if (ys.length < 2) return { wait: true };
        var wTop = Math.min.apply(null, ys) - 40, wBot = Math.max.apply(null, ys) + 46, wL = Math.min.apply(null, xs) - 60, wR = Math.max.apply(null, xs) + 140;
        var zoom = G.zoom, camX = G.cameraX, camY = G.cameraY;
        var cssY = function (wy) { return (wy - camY) * zoom * k + r.top; };
        var cssX = function (wx) { return (wx - camX) * zoom * k + r.left; };
        var x0 = cssX(wL), x1 = cssX(wR), L = Infinity, T = r.top + 8;
        fitPanels().forEach(function (p) {
          var q = p.getBoundingClientRect(); if (!(q.width > 0 && q.height > 0) || !(q.right > x0 && q.left < x1)) return;
          if (q.top > r.top + r.height * 0.5) L = Math.min(L, q.top);
          else if (q.bottom < r.top + r.height * 0.5) T = Math.max(T, q.bottom + 6);
        });
        if (!isFinite(L)) L = r.top + r.height - 8;
        L -= 8;
        var avail = L - T; if (avail < 120) return { tooSmall: true };
        if (Math.abs(G.zoom - G.targetZoom) > 0.4) return { settling: true };
        // Ease towards the fit a little every call (called many times a second) instead of jumping: smooth zoom and pan, and a small dead zone
        // so tiny movements of the mobs do not keep nudging the camera.
        var want = Math.max(0.5, Math.min(Y.RAID_ZOOM || 2.2, (avail * 0.97) / ((wBot - wTop) * k)));
        var moved = false;
        if (Math.abs(want - G.targetZoom) > 0.012) { G.targetZoom = G.targetZoom + (want - G.targetZoom) * 0.12; moved = true; }
        if (Y.__ccViewOff0 === undefined) Y.__ccViewOff0 = Y.COMBAT_VIEW_Y_OFFSET || 0;
        var dy = ((T + L) / 2) - ((cssY(wTop) + cssY(wBot)) / 2);
        if (Math.abs(dy) > 2) { Y.COMBAT_VIEW_Y_OFFSET = Math.max(-1200, Math.min(400, (Y.COMBAT_VIEW_Y_OFFSET || 0) + 0.12 * dy / k)); try { G.updateCamera(); } catch (e) {} moved = true; }
        if (moved) return { zoom: want, shift: dy };
        var nowT = Date.now();
        if (nowT - camSavedAt > 3000) { camSavedAt = nowT; var all = loadCam(); all[camKey] = { z: G.targetZoom, o: Y.COMBAT_VIEW_Y_OFFSET || 0 }; saveCam(all); }
        return { fits: true };
      } catch (e) { return null; }
    },
    // What each mob is worth per kill and per second (with the loadout the fight window shows), plus XP-boost drops / collections still missing.
    // Feeds the Lever Advisor's slay page. Read only.
    mobValues: function () {
      try {
        var ls = fightLoadout(), resp = D._respawnSec(), m = (Y.COMBAT_XP_CHOSEN_MULTIPLIER || 0) + (Y.COMBAT_XP_LIFE_MULTIPLIER || 0) + (Y.COMBAT_XP_SECONDARY_MULTIPLIER || 0), out = {};
        var enc = {}; (G.encounters || []).forEach(function (e) { enc[e.taskId] = e; });
        for (var id in G.mobTypes) {
          var mt = G.mobTypes[id]; if (!mt || !mt.life) continue;
          var ks = D._killSeconds(id, ls); if (!ks) continue;
          var hp = mt.life * (Y.LIFE_HP_MULT || 2), cp = null;
          try { cp = G.getCollectionProgress ? G.getCollectionProgress(id) : null; } catch (e) {}
          var e0 = enc[id] || {};
          out[id] = { name: mt.name || e0.name || id, xpKill: (mt.slayXPOnKill || 0) + hp * m, combatXp: hp * m, fightSec: ks, respSec: resp, sec: ks + resp, slayReq: e0.slayRequired || mt.slayRequired || 0, boost: missingBoostDrops(id), collMissing: cp && cp.total ? Math.max(0, cp.total - cp.count) : 0 };
        }
        return out;
      } catch (e) { return null; }
    },
    // XP and time of a typical task (100 actions) of one skilling activity at your levels, from the game's own projection. Read only.
    activityValue: function (skill, act) {
      try {
        var e = { skill: skill, activityId: act, quantity: 100, progress: 0 };
        var p = D._projectTask(e, false);
        if (!p || !isFinite(p.timeSec) || !isFinite(p.totalXp) || p.timeSec <= 0) return null;
        var stamp = false; try { stamp = !!G.needsSkillingStamp(act); } catch (e2) {}
        return { x: p.totalXp, t: p.timeSec, xpHr: p.totalXp / p.timeSec * 3600, name: p.name, newCollection: stamp };
      } catch (err) { return null; }
    },
    _unlocks: function (ids) { try { var u = G.unlocks || {}, o = { buckets: Object.keys(u) }; ids.forEach(function (id) { o[id] = Object.keys(u).filter(function (b) { return u[b] && typeof u[b] === 'object' && u[b][id]; }); o[id + '_coll'] = G.isCollectionLogged('dire_mushroom', id); }); return o; } catch (e) { return String(e); } },
    slayMaster: function () { try { return { master: G.queueMaster || null }; } catch (e) { return null; } },
    // Raid lobby roster as the game holds it (read only), with guild mates flagged: used by the Raid Summary rules.
    // A guild mate is a lobby member listed in your clan roster, or seen nearby wearing your clan tag.
    lobby: function () {
      try {
        var l = G.raidLobby; if (!l) return null;
        var ids = {}, cm = (G.clan && G.clan.members) || [];
        cm.forEach(function (m) { ids[m.playerId] = 1; });
        var op = G.otherPlayers || {};
        for (var k in op) if (G.clanTag && op[k] && op[k].clanTag === G.clanTag) ids[op[k].id !== undefined ? op[k].id : k] = 1;
        var real = (l.members || []).filter(function (m) { return m && !m.isClone; });
        var out = real.map(function (m) { return { id: m.playerId, name: m.playerName, guild: m.playerId !== G.playerId && !!ids[m.playerId] }; });
        return { at: Date.now(), me: G.playerId, size: out.length, guild: out.filter(function (m) { return m.guild; }).length, members: out };
      } catch (e) { return null; }
    },
    fitReset: function () { if (Y) delete Y.__ccBaseZoom; if (Y && Y.__ccViewOff0 !== undefined) { Y.COMBAT_VIEW_Y_OFFSET = Y.__ccViewOff0; delete Y.__ccViewOff0; try { G.updateCamera(); } catch (e) {} } },
    _calc: function (id, ls) { calcRefresh(id, ls); return { key: calc.key, dps: calc.dps, busy: calc.busy, hasU: !!U, loadout: fightLoadout() }; },
    _sim: function (on) { simUnit = !!on; if (on) startOverlay(); },
    unbarLabels: function () {
      if (E && E.__ccOrigBar) {
        E._drawBar = E.__ccOrigBar; delete E.__ccOrigBar;
        var os = E.__ccOrigUnits || {}; for (var n in os) E[n] = os[n]; delete E.__ccOrigUnits;
      }
      barCfg = null; stopOverlay(); bridge.fitReset();
    },
    // The number the game prints next to a queued task ("Gallowfrost Kitchen (4291)"): path distance from the previous stop in the
    // merged task chain, plus whether the game's teleport plan would teleport for that hop. Read only.
    // Expected DPS for a hypothetical Delve allocation (effects = sum of the tree nodes: {minHit,maxHit,critChancePct,critDamagePct,attackSpeedPct,effLevel:{}}),
    // with the game's own Gear Calc maths (CombatMath/Constants formulas, see docs/research-fortress-and-dps.md) on the loadout the fight window uses, against the
    // mob of your current slay task (else your most-killed mob). Nothing in the game is changed.
    treeDps: function (effects) {
      try {
        var now = Date.now();
        if (!treeInp || now - treeInpAt > 3000) { treeInp = treeDpsInputs(); treeInpAt = now; }
        var inp = treeInp; if (!inp) return null;
        var cur = (window.RaidTreeEffects && G.raidTrees && G.raidTrees.delve) ? window.RaidTreeEffects.sumEffects({ delve: G.raidTrees.delve.allocated || [], fortify: [] }) : { effLevel: {} };
        var e = effects || {}, el = e.effLevel || {}, cel = cur.effLevel || {}, bonus = {};
        Object.keys(inp.bonus).forEach(function (k) { bonus[k] = inp.bonus[k] - (cel[k] || 0) + (el[k] || 0); });
        var c2 = {}; for (var k in inp) c2[k] = inp[k];
        c2.bonus = bonus; c2.talent = { minHit: e.minHit || 0, maxHit: e.maxHit || 0, critChancePct: e.critChancePct || 0, critDamagePct: e.critDamagePct || 0, attackSpeedPct: e.attackSpeedPct || 0 };
        var r = gearCalcDps(Y, c2); if (!r) return null;
        return { dps: r.dps, aps: 1 / r.interval, hit: r.hit, minHit: r.minHit, maxHit: r.maxHit, critChance: r.critChance, interval: r.interval, mob: inp.mobName };
      } catch (err) { return null; }
    },
    // Ask the game's queue panel to redraw its rows from the real queue. A hidden panel is not redrawn by the game, so its rows can be out of date.
    refreshQueuePanel: function () {
      try { if (!Q) return false; if (typeof Q.reseed === 'function') Q.reseed(); Q._prevSig = null; Q.update(); return true; } catch (e) { return false; }   // reseed: the panel re-reads the game's own queue data (a hidden panel is never redrawn, so its rows can be out of date)
    },
    // Expected DPS, hit chance and max hit of the loadout you fight with now (the game's Gear Calc maths, your current Delve tree), against your current slay mob. Read only.
    gearDps: function () {
      try {
        var cur = (window.RaidTreeEffects && G.raidTrees && G.raidTrees.delve) ? window.RaidTreeEffects.sumEffects({ delve: G.raidTrees.delve.allocated || [], fortify: [] }) : { effLevel: {} };
        return bridge.treeDps(cur);
      } catch (e) { return null; }
    },
    // Delve / Fortify tree state for the Tree Advisor: allocated node ids and the skill level that gives the points. Read only.
    treeState: function () {
      try {
        var rt = G.raidTrees || {}, sk = G.skills || {};
        return { delve: { allocated: ((rt.delve && rt.delve.allocated) || []).slice(), level: (sk.delve && sk.delve.level) || 1 },
          fortify: { allocated: ((rt.fortify && rt.fortify.allocated) || []).slice(), level: (sk.fortify && sk.fortify.level) || 1 }, credits: G.rerollCredits || 0 };
      } catch (e) { return null; }
    },
    // How new tasks roll (read-only): the lane (skills: 2 skilling + 1 combat task per row, slay: 2 combat + 1 skilling), the slay master, reroll credits, Auto Loadout.
    // Friends, clan members and muted players straight from the game's data (read-only), so the Friends card can show any of the three lists
    // without touching the game's own panel (which forgets which tab was open whenever it is hidden).
    social: function () {
      try {
        var dn = function (n) { try { return G.displayName ? G.displayName(n) : n; } catch (e) { return n; } };
        var byName = function (a, b) { return (a.online && !b.online) ? -1 : (!a.online && b.online) ? 1 : String(a.name).localeCompare(String(b.name)); };
        var fl = G.friendsList || [];
        var friends = fl.map(function (f) { return { name: dn(f.playerName), online: !!f.online, text: f.online ? (f.activity || 'Idle') : 'Offline', skill: f.online && f.activity ? (f.activitySkill || '') : '' }; }).sort(byName);
        var cl = { state: !G.clanId ? 'none' : (!G.clan || !G.clan.members) ? 'loading' : 'ok', tag: G.clanTag || '', members: [] };
        if (cl.state === 'ok') cl.members = G.clan.members.map(function (m) {
          var o = { name: dn(m.displayName), online: !!m.online, text: m.online ? 'Online' : 'Offline', skill: '' };
          if (m.playerId === G.playerId) {
            var t = G.currentTask;
            if (t) { o.text = (t.skill ? t.skill.charAt(0).toUpperCase() + t.skill.slice(1) : '') + ' ' + (t.quantity || '') + ' ' + (t.activityName || '') + ' at ' + (t.nodeName || '') + (t.progress > 0 ? ' [' + t.progress + '/' + t.quantity + ']' : ''); o.skill = t.skill || ''; }
            else o.text = G.state === 'combat' ? 'In Combat' : 'Idle';
          } else if (m.online) { for (var i = 0; i < fl.length; i++) if (fl[i].playerId === m.playerId && fl[i].activity) { o.text = fl[i].activity; o.skill = fl[i].activitySkill || ''; break; } }
          return o;
        }).sort(byName);
        var muted = (G.mutedPlayers || []).map(function (m) { return { name: dn(m.playerName), online: false, text: '', skill: '' }; });
        return { friends: friends, clan: cl, muted: muted };
      } catch (e) { return null; }
    },
    // The combat loadouts (families and their slots with the names you gave them) and the one that is equipped (read-only)
    loadouts: function () {
      try {
        var fams = (Y.COMBAT_FAMILIES || []).map(function (f) { var m = Y.LOADOUT_FAMILY_MAP[f]; return { id: f, label: m.label, slots: m.loadouts.map(function (id) { return { id: id, name: G.loadoutName(id) }; }) }; });
        return { families: fams, current: G.equippedLoadout || G.activeLoadout || null };
      } catch (e) { return null; }
    },
    // Your raid party (read-only): the game sends party chat on the same 'proximity' channel as everyone nearby and only RENAMES that channel to Raid while you are in a
    // party, so the chat panel tells the two apart by whether the sender is in the party. names = every spelling of a member's name (lowercase).
    raidParty: function () {
      try {
        var l = G.raidLobby, names = {}, inParty = !!(l && l.members && l.members.length > 1);
        if (l && l.members) l.members.forEach(function (m) { if (!m || m.isClone) return; names[String(m.playerName).toLowerCase()] = 1; try { names[String(G.displayName(m.playerName)).toLowerCase()] = 1; } catch (e) { /* no display name */ } });
        return { inParty: inParty, names: Object.keys(names) };
      } catch (e) { return null; }
    },
    // Who you are (read-only): the name chat lines and party lists use for you
    whoami: function () { try { var n = G.playerName || '', d = n; try { d = G.displayName(n) || n; } catch (e) { /* no display name */ } return { name: n, display: d, id: G.playerId }; } catch (e) { return null; } },
    // Your clan's member list as the game holds it (read-only): the source of truth the Clan Hiscores roster is kept in line with on every lookup.
    clanRoster: function () {
      try {
        var dn = function (n) { try { return G.displayName ? G.displayName(n) : n; } catch (e) { return n; } };
        if (!G.clanId) return { state: 'none', tag: '', members: [] };
        if (!G.clan || !G.clan.members) return { state: 'loading', tag: G.clanTag || '', members: [] };
        return { state: 'ok', tag: G.clanTag || '', members: G.clan.members.map(function (m) { return { id: m.playerId, name: dn(m.displayName), online: !!m.online }; }).filter(function (m) { return m.name; }) };
      } catch (e) { return null; }
    },
    // The queued dividers of the game's Tasks panel (read only): G.queuedCombat is a fight that waits behind skilling tasks, G.queuedSkilling the skilling that resumes after a fight.
    // position 0 = right after the current task, n = after the nth queued row.
    queued: function () {
      try {
        var qc = G.queuedCombat || null, qs = G.queuedSkilling || null, out = { combat: null, skilling: null };
        var pos = function (q) { return q && typeof q.position === 'number' ? q.position : 0; };
        if (qc && G.state !== 'combat') {
          var md = null; (G.mobsData || []).some(function (m) { if (m.taskId === qc.mobTaskId) { md = m; return true; } return false; });
          out.combat = { taskId: qc.mobTaskId, name: (md && md.name) || qc.mobTaskId, position: pos(qc), isSlay: !!(G.slayTask && G.slayTask.active && G.slayTask.active.taskId === qc.mobTaskId) };
        }
        if (qs) {
          var rt = null;
          if (qc && typeof qc.position === 'number') { var sl = (G.skillingQueue || G.taskQueue || [])[qc.position]; rt = sl && sl.options && sl.options[sl.selectedIndex || 0] || null; } else rt = G.currentTask || null;
          out.skilling = { position: pos(qs), name: (rt && rt.activityName) || '', skill: (rt && rt.skill) || '', node: (rt && rt.nodeName) || '' };
        }
        return out;
      } catch (e) { return null; }
    },
    // What the game's Current Task panel shows besides the task (read only): the level bar of the skill being trained (during a fight: the skill of your combat style and XP toggle),
    // and for a fight the loadout name, the skill you train and the kill count.
    current: function () {
      try {
        var ct = G.currentTask || null, st = G.slayTask && G.slayTask.active || null, ph = null;
        try { ph = bridge.project().head; } catch (e0) { ph = null; }
        var combat = G.state === 'combat' || G.state === 'raid' || !!(ph && ph.kind === 'slay');
        var out = { combat: combat, lv: null, loadoutId: '', loadouts: [], loadout: '', loadoutIcon: '', train: '', trainIcons: [], trainNames: [], other: '', kills: null };
        var skill = ct && ct.skill && ct.skill !== 'tutorial' ? ct.skill : null;
        if (combat) {
          var enc = G.combatEncounterTaskId || (st && st.taskId) || null, style = G.combatLoadoutStyle, tog = G.combatXpToggle;
          if (!style && G.autoLoadoutEnabled && st && G.autoLoadouts && G.autoLoadouts[st.taskId]) { style = G.autoLoadouts[st.taskId].loadoutStyle; tog = G.autoLoadouts[st.taskId].xpToggle; }
          skill = null;
          if (style) {
            out.loadout = G.loadoutName(style);
            try { out.loadoutIcon = G.loadoutIcon ? G.loadoutIcon(style) : ''; } catch (e1) { out.loadoutIcon = ''; }
            out.loadoutId = style;   // the combat loadouts that have a weapon (the ones the game's loadout click cycles through), for a list to pick from
            try { out.loadouts = (Y.COMBAT_LOADOUTS || []).filter(function (id) { var l = G.equipmentLoadouts && G.equipmentLoadouts[id]; return l && l.mainhand; }).map(function (id) { return { id: id, name: G.loadoutName(id), icon: G.loadoutIcon(id), family: Y.loadoutFamily ? Y.loadoutFamily(id) : String(id).split('_')[0] }; }); } catch (e2) { out.loadouts = []; }
            var sm = Y.COMBAT_STYLE_MAP[G.getResolvedCombatStyle(style)];
            if (sm && tog) {
              skill = tog === 'accuracy' ? sm.accSkill : sm.strSkill; out.train = G.getSkillName ? G.getSkillName(skill) : skill;
              var sk2 = tog === 'accuracy' ? 'dodge' : 'defend';   // the game's Training icons: the skill you chose plus its defensive partner
              out.trainIcons = [skill, sk2]; out.trainNames = [out.train, G.getSkillName ? G.getSkillName(sk2) : sk2]; out.other = tog === 'accuracy' ? 'strength' : 'accuracy';
            }
          }
          out.kills = st && st.taskId === enc ? { count: st.killCount || 0, target: st.killTarget || 1 } : { count: G.combatKillCount || 0, target: 0 };
        }
        if (skill && G.skills && G.skills[skill]) {
          var pg = G.getSkillProgress(skill);
          out.lv = { skill: skill, name: G.getSkillName ? G.getSkillName(skill) : skill, level: pg.level, pct: Math.round(pg.progressPct), next: pg.phase === 'level' ? pg.level + 1 : null };
        }
        return out;
      } catch (e) { return null; }
    },
    queueCtl: function () {
      try { return { lane: G.queueLane === 'slay' ? 'slay' : 'skills', master: G.queueMaster || 'tier1', credits: G.rerollCredits || 0, auto: !!G.autoLoadoutEnabled, slayLevel: (G.skills && G.skills.slay && G.skills.slay.level) || 1,
        costSkill: (Y && Y.REROLL_COST) || 5, costSlay: (Y && Y.SLAY_REROLL_COST) || 10 }; } catch (e) { return null; }
    },
    // Where freshly rolled tasks enter the queue (the gold NEW TASKS bar): the game's own queueInsertAt (null = at the end), the lowest row it may sit before,
    // and whether the Surveyor's Mark unlock lets you move it at all. Read only.
    queueInsert: function () {
      try {
        var u = G.unlocks && G.unlocks.queueInserts, can = false; if (u) for (var k in u) if (u[k]) can = true;
        var at = G.queueInsertAt;
        return { movable: can, at: (typeof at === 'number' && isFinite(at) && at >= 0) ? Math.floor(at) : null, min: (Q && Q.MIN_INSERT) || 1 };
      } catch (e) { return null; }
    },
    // ---- Roll odds (read only): how the game picks a new task, with the game's own formulas (its Skills Customization window S and its Slay Masters window W).
    // The skill is picked by weight (lever steps: 1.25 ^ position), then the task among the skill's tasks you have the level for; on a Slay lane the mob comes from the chosen master's mobs.
    // skills -> [{ id, name, pct, lucky, level, lever }]: pct sums to 100 (Quests counted when a quest step can be rolled)
    oddsSkills: function () {
      try {
        if (!S) return null;
        var pct = S._calcSkillPercentages(), out = [];
        for (var id in pct) {
          var isQ = id === 'quests', sk = G.skills && G.skills[id];
          out.push({ id: id, name: isQ ? 'Quests' : (G.getSkillName ? G.getSkillName(id) : id), pct: pct[id], lucky: isQ ? null : S._calcLuckChance(null, id), level: isQ ? 0 : (sk && sk.level) || 1, lever: isQ ? 0 : S._getSkillLever(id), quests: isQ });
        }
        return out;
      } catch (e) { return null; }
    },
    // tiers of one skill -> [{ id, name, tier, level, open, pct, weight }]: a task you lack the level for has pct 0; the open ones sum to 100
    oddsTiers: function (skill) {
      try {
        if (!S || !S.activitiesData || !S.activitiesData[skill]) return null;
        var acts = S.activitiesData[skill].activities || [], lv = S._getPlayerLevel(skill), c = S._activityLeverMult(skill), sum = 0, rows = [];
        acts.forEach(function (a) { var w = S._getActivityLever(skill, a.id).weight, v = a.baseQty * S._leverMult(w * c); var open = lv >= a.level; if (open) sum += v; rows.push({ id: a.id, name: a.name, tier: a.tier, level: a.level, open: open, v: v, weight: w }); });
        return rows.map(function (r) { return { id: r.id, name: r.name, tier: r.tier, level: r.level, open: r.open, pct: r.open && sum > 0 ? r.v / sum * 100 : 0, weight: r.weight }; });
      } catch (e) { return null; }
    },
    // the chosen slayer master and the mobs it rolls -> { master, name, prefix, levelMin, levelMax, chaos, slayLevel, credits, mobs: [{ id, name, req, open, pct, why }] }
    // `pick` (optional tier id such as "tier3") asks for another master than the one the game has selected; nothing is changed in the game.
    oddsSlay: function (pick) {
      try {
        if (!W || !S || !Y) return null;
        var cm = pick || W._currentMaster(), cfg = cm && W._getTierConfig(cm); if (!cfg) return null;
        var gr = W._groupEncountersByTier(), lv = (G.skills && G.skills.slay && G.skills.slay.level) || 1, lvls = W._skillLevels(), tot = W._totalLevel();
        var w = (S.weights && S.weights.activities && S.weights.activities.slay) || {}, k = Y.CHAOS_LEVER_MULT || 1, ch = !!cfg.isChaos, cand = [];
        if (ch) { for (var t in gr) cand = cand.concat(gr[t]); } else cand = gr[cm] || [];   // the Chaos master rolls from every mob, the others from their own level band
        var rows = cand.map(function (e) {
          var C0 = (w[e.taskId] && w[e.taskId].weight) || 0, fail = Y.encounterRequirementFailure(e, lvls, tot), req = e.slayRequired || 0;
          return { id: e.taskId, name: e.name, req: req, lever: C0, open: lv >= req && fail === null, v: Y.effectiveWeight(C0 * (ch ? k : 1)), why: lv < req ? 'Needs Slay level ' + req : (Y.encounterRequirementTooltip(e, lvls, tot) || '') };
        });
        var sum = 0; rows.forEach(function (r) { if (r.open) sum += r.v; });
        return { master: cm, name: cfg.master, prefix: cfg.prefix, levelMin: cfg.levelMin, levelMax: cfg.levelMax, chaos: ch, leverMult: ch ? k : 1, slayLevel: lv, credits: G.rerollCredits || 0,
          mobs: rows.map(function (r) { return { id: r.id, name: r.name, req: r.req, lever: r.lever, open: r.open, pct: r.open && sum > 0 ? r.v / sum * 100 : 0, why: r.why }; }) };
      } catch (e) { return null; }
    },
    // every slayer master the game has -> { current, slayLevel, masters: [{ id, name, prefix, levelMin, levelMax, range, chaos, unlocked, current, mobs, open, ids }] }
    // (unlocked = your Slay level reaches the master's minimum; mobs = size of its pool, open = how many of them you can roll now, ids = the pool). Read only.
    slayMasters: function () {
      try {
        if (!W || !Y) return null;
        var gr = W._groupEncountersByTier(), lv = (G.skills && G.skills.slay && G.skills.slay.level) || 1, cur = W._currentMaster(), lvls = W._skillLevels(), tot = W._totalLevel();
        var all = []; for (var t in gr) all = all.concat(gr[t]);
        var open = function (list) { return list.filter(function (e) { return lv >= (e.slayRequired || 0) && Y.encounterRequirementFailure(e, lvls, tot) === null; }).length; };
        var ms = (W._TIERS || []).map(function (c) {
          var pool = c.isChaos ? all : (gr[c.id] || []);
          return { id: c.id, name: c.master, prefix: c.prefix, levelMin: c.levelMin, levelMax: c.levelMax, range: c.displayRange, chaos: !!c.isChaos, unlocked: lv >= c.levelMin, current: c.id === cur, mobs: pool.length, open: open(pool), ids: pool.map(function (e) { return e.taskId; }) };
        });
        return { current: cur, slayLevel: lv, masters: ms };
      } catch (e) { return null; }
    },
    // What each mob can still give you: the XP-boost unlocks (Enchanted tools and similar) and the collection-log drops you do not have yet, with the "1 in n" of each,
    // and the map node the mob is fought at. -> { id: { node, boost: [{ id, name, oneIn }], coll: [{ id, name, oneIn }] } }. Cached 20 s. Read only.
    huntInfo: function () {
      try {
        var now = Date.now(); if (huntMemo && now - huntAt < 20000) return huntMemo;
        var out = {};
        (G.encounters || []).forEach(function (e) {
          var id = e.taskId; if (!id || !e.isSlay) return;
          var cp = null; try { cp = G.getCollectionProgress ? G.getCollectionProgress(id) : null; } catch (er) {}
          var haveOf = {}; ((cp && cp.drops) || []).forEach(function (d) { haveOf[d.itemId] = d.have; });
          var boost = [], coll = [];
          (e.rareDrops || []).forEach(function (d) {
            var it = G.itemsData && G.itemsData[d.itemId], one = d.oneInChance || 0; if (!(one > 0)) return;
            var nm = (it && it.name) || d.itemId;
            if (it && it.type === 'unlock' && !G.isCollectionLogged(id, d.itemId)) boost.push({ id: d.itemId, name: nm, oneIn: one });
            if (haveOf[d.itemId] === false) coll.push({ id: d.itemId, name: nm, oneIn: one });
          });
          var node = null; try { node = G._encounterNodeForTask(id); } catch (er) {}
          out[id] = { node: node, boost: boost, coll: coll };
        });
        huntMemo = out; huntAt = now; return out;
      } catch (e) { return null; }
    },
    // How dangerous each mob is for you with the loadout the fight window shows, from the game's own CombatMath (the function that rolls the mob's attacks):
    // the mob attacks with its own style, levels and equipment bonuses against your Dodge, Defend and the Defence bonus of your loadout for that style.
    // -> { maxHp, food: { id, name, heal, have } | null, mobs: { id: { hit, avg, maxHit, critMax, interval, dps, fightSec, dmgKill, killsHr, hpHr, foodHr, risk } } }
    //   hit     chance the mob's attack lands          avg   expected HP lost per attack (hit chance, crits, damage reduction, 1 HP minimum)
    //   dps     expected HP lost per second of fight   fightSec  seconds the kill takes (respawn excluded: nobody attacks then)
    //   dmgKill expected HP lost per kill              hpHr  HP lost per hour of killing (respawn included in the hour)
    //   foodHr  foods per hour (hpHr / healing of the best food you hold; null when you hold none)   risk  worst single hit (a crit at maximum) / max HP
    // Not modelled: HP that comes back by itself, food heal bonuses, prayers and specials. Read only.
    mobRisk: function () {
      try {
        var now = Date.now(), ls = fightLoadout(); if (riskMemo && now - riskAt < 4000 && riskKey === ls) return riskMemo;
        var st = G.computeLoadoutStats(ls), pb = {}; try { pb = G.combatPotionUse === false ? {} : (G.getPotionBoosts() || {}); } catch (e) {}
        var lvl = function (s) { return (G.skills[s] && G.skills[s].level) || 1; };
        var maxHp = G.getEffectiveMaxHP(), resp = D._respawnSec(), food = null;
        Object.keys(G.itemsData || {}).forEach(function (id) { var it = G.itemsData[id]; if (!it || !it.healHP || it.type !== 'processed' || it.skill !== 'cook') return; var have = 0; try { have = G.getBankQty(id) || 0; } catch (e) {} if (have > 0 && (!food || it.healHP > food.heal)) food = { id: id, name: it.name || id, heal: it.healHP, have: have }; });
        var out = {};
        for (var id in G.mobTypes) {
          var mob = G.mobTypes[id], m = mob && Y.COMBAT_STYLE_MAP[mob.attackStyle]; if (!mob || !mob.life || !m) continue;
          var ks = D._killSeconds(id, ls); if (!ks) continue;
          var def = { dodge: { level: lvl('dodge'), equipBonus: st[m.defBonus] || 0, potion: pb.dodge || 0, cape: G.getCombatBonus('dodge') }, defend: { level: lvl('defend'), potion: pb.defend || 0, cape: G.getCombatBonus('defend') } };
          var r = CombatMath.computeAttack({ spiritMod: 0, weaponSpeed: mob.attackSpeed, acc: { level: mob[m.accSkill] || 1, equipBonus: mob[m.accBonus] || 0 }, str: { level: mob[m.strSkill] || 1, equipBonus: mob[m.strBonus] || 0 }, vigor: { level: mob.vigor || 0, bonuses: 0 }, crit: { sources: 0 } }, def);
          if (!r || !(r.attackInterval > 0)) continue;
          // the mob's own crit chance and multiplier scale with its Slay level; a hit is uniform between the minimum and the maximum hit, then the damage reduction applies
          var cc = Y.mobCritChance(mob.slayLevel), cmu = Y.mobCritDamageMult(mob.slayLevel), lo = r.minHitFloor || 1, hi = r.maxHit, n = Math.max(1, hi - lo + 1), sN = 0, sC = 0;
          for (var h = lo; h <= hi; h++) { sN += Y.finalDamage(h, r.reduction); sC += Y.finalDamage(Y.critDamage(h, cmu), r.reduction); }
          var avg = r.hitChance * ((1 - cc) * sN / n + cc * sC / n), dps = avg / r.attackInterval, dmgKill = dps * ks, killsHr = 3600 / (ks + resp), hpHr = dmgKill * killsHr, cmax = Y.finalDamage(Y.critDamage(hi, cmu), r.reduction);
          out[id] = { hit: r.hitChance, avg: avg, maxHit: r.effectiveMaxHit, critMax: cmax, interval: r.attackInterval, dps: dps, fightSec: ks, dmgKill: dmgKill, killsHr: killsHr, hpHr: hpHr, foodHr: food ? hpHr / food.heal : null, risk: maxHp > 0 ? cmax / maxHp : 1 };
        }
        riskMemo = { maxHp: maxHp, food: food, mobs: out }; riskAt = now; riskKey = ls;
        return riskMemo;
      } catch (e) { return null; }
    },
    // steps left from where the player stands to a node (the game's own Current Task distance). Read only.
    remain: function (node) { try { var d = G.getRemainingDistanceToNode(node); return isFinite(d) ? d : null; } catch (e) { return null; } },
    // Path distance (steps) between two map nodes, as the game computes it. Read only.
    dist: function (a, b) { try { return G.getPathDistance(a, b); } catch (e) { return null; } },
    hop: function (slot, id, isMob) {
      try {
        var chain = G.getMergedTaskChain(), prev = null;
        for (var i = 0; i < chain.length; i++) if (chain[i].slot === slot) { prev = i > 0 ? chain[i - 1].nodeId : null; break; }
        var node = isMob ? G._encounterNodeForTask(id) : id;
        if (!prev || !node) return null;
        var d = G.getPathDistance(prev, node), plan = G.getTeleportPlan();
        var e = plan && (plan['skill:' + slot] || plan['slay:' + slot]);
        return { d: d, tp: !!(e && e.tier && d > e.threshold), th: (e && e.threshold) || 0 };
      } catch (e2) { return null; }
    },
    // Walking speed in steps per second, the single source of truth (see speedCompute above).
    speed: function () { try { return speedInfo(); } catch (e) { return null; } },
    snapshot: function (force) { try { return snapshot(!!force); } catch (e) { return null; } },
    // Subscribe to changes: onChange('speed', function (info, prevSps) {...}) fires when the speed moves by more than 0.02 steps/s (a potion starts or ends, a level-up,
    // a new unlock). Returns the unsubscribe function. Polled once a second, only while somebody is subscribed.
    // 'snapshot' fires fn(snap, changedKeys) when speed, held (item count/quantity), a skill level, potions, the task, the slay task or the combat state changed.
    onChange: function (what, fn) {
      if ((what !== 'speed' && what !== 'snapshot') || typeof fn !== 'function') return function () {};
      var list = what === 'snapshot' ? subs.snap : subs.speed;
      list.push(fn);
      if (what === 'speed' && lastSps == null) { var s0 = speedInfo(); if (s0) lastSps = window.__ccBridgeSpeedLast = s0.sps; }
      if (what === 'snapshot') { try { snapshot(false); } catch (e) { /* first check on the next tick */ } }
      if (!window.__ccBridgeSpeedTimer) startSpeedPoll();
      return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); if (!subs.speed.length && !subs.snap.length) { clearInterval(window.__ccBridgeSpeedTimer); window.__ccBridgeSpeedTimer = 0; } };
    },
    // Chat UI state (read) and the one UI-only write ScapeLite makes: which channel the input sends to (never sends anything).
    chat: function () {
      if (!C) return null;
      return { active: C._activeChannel, dm: !!C._dmTarget, dmName: C._dmTarget || '', filters: JSON.parse(JSON.stringify(C._filters || {})), send: C.SEND_CHANNELS.slice() };
    },
    // Chat lines the game keeps in its message list but does NOT draw because its own chat filters (a channel switched off, a type switched off) hide them. The Discord relay
    // reads the game's chat from the page; without this it would be blind to everything the player has filtered out. Each entry is { id, node }: a stable id per message and the
    // line as the game itself would draw it (built once with the game's own line builder and kept detached; never added to the page). all=true also returns the drawn lines (their real nodes).
    chatHidden: function (all) {
      try {
        if (!C || !C._messages || typeof C._buildLine !== 'function') return [];
        var list = C._messages, out = [];
        for (var i = Math.max(0, list.length - 400); i < list.length; i++) {
          var m = list[i];
          if (!m || (m.channel !== 'clan' && m.channel !== 'game' && m.channel !== 'global')) continue;
          var node = m._el;
          if (node) { if (!all) continue; }
          else { node = chatLineNodes.get(m); if (!node) { try { node = C._buildLine(m); } catch (eb) { continue; } chatLineNodes.set(m, node); } }
          var id = chatLineIds.get(m); if (!id) { id = ++chatLineSeq; chatLineIds.set(m, id); }
          out.push({ id: id, node: node });
        }
        return out;
      } catch (e) { return []; }
    },
    setChatChannel: function (ch) {
      if (!C || C.SEND_CHANNELS.indexOf(ch) < 0) return false;
      C._dmTarget = null; C._activeChannel = ch; C._updateChannelLabel();
      return true;
    },
    // Facts for the Alerts bell. Pure reads of the game's own state; nothing is called that changes anything.
    alertState: function () {
      try {
        var o = {}, items = G.itemsData || {};
        var lvl = function (sk) { return (G.skills && G.skills[sk] && G.skills[sk].level) || 0; };
        var alloc = function (t) { var a = G.raidTrees && G.raidTrees[t] && G.raidTrees[t].allocated; return a ? a.length : 0; };
        o.tree = { delve: Math.max(0, lvl('delve') - alloc('delve')), fortify: Math.max(0, lvl('fortify') - alloc('fortify')), delveLevel: lvl('delve'), fortifyLevel: lvl('fortify') };
        if (S) o.levers = { total: S.totalSkillCredits || 0, slay: (S.individualSkillCredits && S.individualSkillCredits.slay) || 0 };
        // chests and lamps held (bank and inventory)
        var chests = 0, lamps = 0, chestId = null, lampId = null, scan = function (arr) { (arr || []).forEach(function (e) { if (!e || !e.itemId) return; var it = items[e.itemId]; if (!it) return; var q = e.qty; if (!(q > 0)) return; if (it.type === 'chest') { chests += q; chestId = chestId || e.itemId; } else if (it.consumableType === 'lamp' || it.consumableType === 'combat_lamp') { lamps += q; lampId = lampId || e.itemId; } }); };
        scan(G.bank); scan(G.inventory);
        o.chests = chests; o.lamps = lamps; o.chestId = chestId; o.lampId = lampId;
        // quests finished but not turned in
        var ready = [], act = (G.quests && G.quests.active) || {};
        Object.keys(act).forEach(function (id) { var a = act[id], q = (G.questsData || []).filter(function (x) { return x.id === id; })[0]; if (q && a && !a.rewardClaimed && a.currentStep >= (q.steps || []).length) ready.push(q.name || id); });
        o.questsReady = ready;
        // free quest slots: the game allows MAX_ACTIVE_QUESTS at once (a finished quest keeps its slot until claimed); availableN = quests whose requirements you meet and have not begun
        try {
          var maxQ = (Y && Y.MAX_ACTIVE_QUESTS) || 5, qd = (G.quests && G.quests.completed) || [], avail = 0, qfirst = null;
          (G.questsData || []).forEach(function (q) {
            if (!q || qd.indexOf(q.id) >= 0 || act[q.id]) return;
            for (var sk in (q.levelRequirements || {})) { if (!G.skills || !G.skills[sk] || G.skills[sk].level < q.levelRequirements[sk]) return; }
            var qr = q.questRequirements || []; for (var qi = 0; qi < qr.length; qi++) { if (qd.indexOf(qr[qi]) < 0) return; }
            avail++; if (!qfirst) qfirst = q.name || q.id;
          });
          o.questSlots = { max: maxQ, used: Object.keys(act).length, free: Math.max(0, maxQ - Object.keys(act).length), availableN: avail, firstAvailable: qfirst };
        } catch (eq) { o.questSlots = null; }
        // barter: charges left on the current roll (the number in the Barter panel's header), and reroll credits
        try { var bp = G.barterPanel; o.barter = bp ? { left: Math.max(0, Number(bp.remainingQty) || 0), rerolls: Number(G.barterRerollCredits) || 0, slots: (bp.slots || []).map(function (s) { return s && s.itemId; }).join(',') } : null; } catch (eb) { o.barter = null; }
        // gear: for every slot of the equipped loadout, a held item that is clearly better for that loadout's style
        // (attack + strength of the style, a little defence) and fits the loadout
        var up = [], lo = G.equippedLoadout, eq = (G.equipmentLoadouts && G.equipmentLoadouts[lo]) || {};
        var style = String(lo || '').split('_')[0];
        var n0 = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };
        var off = function (it) {
          if (style === 'melee') return Math.max(n0(it.stab), n0(it.slash), n0(it.crush)) + n0(it.meleeStrength) * 2;
          if (style === 'range') return n0(it.range) + n0(it.rangeStrength) * 2;
          if (style === 'magic') return n0(it.magicAttack) + n0(it.magicStrength) * 2;
          return Math.max(n0(it.stab), n0(it.slash), n0(it.crush), n0(it.range), n0(it.magicAttack)) + Math.max(n0(it.meleeStrength), n0(it.rangeStrength), n0(it.magicStrength)) * 2;
        };
        var def = function (it) { return n0(it.stabDefense) + n0(it.slashDefense) + n0(it.crushDefense) + n0(it.rangeDefense) + n0(it.magicDefense); };
        var score = function (it) { return off(it) + def(it) * 0.15; };
        var held = {}; (G.bank || []).forEach(function (e) { if (e && e.itemId && e.qty > 0 && items[e.itemId] && items[e.itemId].type === 'equipment') held[e.itemId] = e.qty; });
        var slots = (Y && Y.EQUIPMENT_SLOTS) || Object.keys(eq);
        slots.forEach(function (slot) {
          if (slot === 'special') return;
          var cur = eq[slot] ? items[eq[slot]] : null, curScore = cur ? off(cur) : 0, best = null, bestId = null, bestScore = curScore;
          Object.keys(held).forEach(function (id) {
            var it = items[id]; if (!it || it.slot !== slot) return;
            try { if (Y && Y.canEquipOnLoadout && !Y.canEquipOnLoadout(it, lo)) return; } catch (e) { return; }
            // A weapon is only ever compared with weapons of its own kind: a dagger is not "worse than" a mace, they hit differently and at another speed (the loadout was set up on
            // purpose). Items of the same kind (a plain, a Feeble, a Dire ... Titanium Mace) differ by their stats, so the better one still counts.
            if (cur && (cur.attackStyle || cur.attackSpeed) && (it.attackStyle !== cur.attackStyle || it.attackSpeed !== cur.attackSpeed)) return;
            var sc = off(it); if (sc <= bestScore + 0.5) return;   // only a better attack / strength for this style counts
            best = it; bestId = id; bestScore = sc;
          });
          if (best) up.push({ slot: slot, have: cur ? (cur.name || eq[slot]) : null, better: best.name || bestId, betterId: bestId });
        });
        o.gear = { loadout: lo, upgrades: up };
        o.invFull = !!(G.inventory && G.inventory.length && G.inventory.every(Boolean));
        o.invTotal = G.inventory ? G.inventory.length : 0; o.invUsed = G.inventory ? G.inventory.filter(Boolean).length : 0;
        o.currentHP = G.currentHP || 0; o.maxHP = G.maxHP || 0;
        o.idle = !G.currentTask && !(G.slayTask && G.slayTask.active) && !(E && E._active);
        if (o.idle) { try { var qh = D && D._queueHead && D._queueHead(); if (qh && qh.task) o.idle = false; } catch (e3) { /* keep idle as is */ } }
        o.hp = G.maxHP ? G.currentHP / G.maxHP : 1;
        var pots = {}; Object.keys(G.activePotions || {}).forEach(function (t) { pots[t] = (G.activePotions[t] || []).length; }); o.potions = pots;
        return o;
      } catch (e) { return null; }
    },
    // What an XP lamp (or a combat lamp / gem, the game's isCombatXpItem) would do to each skill it can be poured into. PURE READ: nothing is
    // sent. Formulas (game tooltip text + Constants): lamp = xpMultiplier x the skill's CURRENT level in XP to the chosen skill (+ allSkillBonus x
    // level to every other skill except luck); combat lamp / gem = a flat Y.combatXpFlat to one of Y.COMBAT_LAMP_SKILLS. N lamps = N x one.
    // Returns { id, name, kind:'lamp'|'combat', held, qty, per, allBonus, skills:[{id,name,level,cap,xp,gain,gainN,lvTo,pctFrom,pctTo,lvToN,pctToN}], others:{xp,levels} }.
    lampPreview: function (itemId, qty) {
      try {
        var it = G.itemsData && G.itemsData[itemId]; if (!it || !G.xpTable || !G.skills) return null;
        var combat = !!(Y && Y.isCombatXpItem && Y.isCombatXpItem(itemId, it));
        if (!combat && it.consumableType !== 'lamp') return null;
        var tbl = G.xpTable.xpForLevel, held = 0;
        [G.bank, G.inventory].forEach(function (arr) { (arr || []).forEach(function (e) { if (e && e.itemId === itemId && e.qty > 0) held += e.qty; }); });
        var n = Math.max(1, Math.floor(qty > 0 ? qty : (held || 1)));
        var K = combat ? 0 : (it.xpMultiplier || 0), flat = combat ? (Y.combatXpFlat(itemId, it) || 0) : 0, allB = combat ? 0 : (it.allSkillBonus || 0);
        var cap = function (sk) { try { return Y.maxLevelFor(sk) || 99; } catch (e) { return 99; } };
        var levelAt = function (sk, xp) { var c = cap(sk), l = 1; while (l < c && tbl[l + 1] != null && tbl[l + 1] <= xp) l++; return l; };
        var pctAt = function (sk, xp, l) { var c = cap(sk); if (l >= c || tbl[l + 1] == null) return 1; var lo = tbl[l] || 0, hi = tbl[l + 1]; return hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 0; };
        var ids = combat ? (Y.COMBAT_LAMP_SKILLS || []).slice() : ((G.skillsData && G.skillsData.skills) || []).map(function (s) { return s.id; }).filter(function (s) { return s !== 'luck'; });
        var rows = ids.map(function (sk) {
          var st = G.skills[sk]; if (!st) return null;
          var xp = st.xp || 0, lv = levelAt(sk, xp), per = combat ? flat : K * lv, g1 = per, gN = per * n;
          var l1 = levelAt(sk, xp + g1), lN = levelAt(sk, xp + gN);
          var nm = sk; try { nm = G.getSkillName(sk) || sk; } catch (e) {}
          return { id: sk, name: nm, level: lv, cap: cap(sk), xp: xp, gain: g1, gainN: gN, lvTo: l1, pctFrom: pctAt(sk, xp, lv), pctTo: pctAt(sk, xp + g1, l1), lvToN: lN, pctToN: pctAt(sk, xp + gN, lN) };
        }).filter(Boolean);
        var others = null;
        if (allB) { var ox = 0, ol = 0; rows.forEach(function (r) { var g = allB * r.level * n; ox += g; ol += levelAt(r.id, r.xp + g) - r.level; }); others = { xp: ox, levels: ol, mult: allB }; }
        var nameOf = it.name || itemId;
        return { id: itemId, name: nameOf, kind: combat ? 'combat' : 'lamp', held: held, qty: n, per: combat ? flat : K, allBonus: allB, skills: rows, others: others };
      } catch (e) { return null; }
    },
    ok: function () { try { return !!(G && D && typeof D._projectOpt === 'function' && Array.isArray(G.taskQueue)); } catch (e) { return false; } },
    project: function () {
      if (projMemo && Date.now() - projMemo.t < 1200) return projMemo;
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
      projMemo = out;
      return out;
    },
  };
  try { if (window.__ccLobbyTimer) clearInterval(window.__ccLobbyTimer); } catch (e) {}
  // Run memory: while the Raid DPS panel is on screen note the dungeon name, wave, clock and each player's damage share; when your
  // lobby disappears (run finished, wiped, or you left) file it as an "ended run" for the Raid Summary rules.
  window.__ccEndedRuns = window.__ccEndedRuns || [];
  var hadLobby = false, runSeenAt = 0;
  function scrapeRun() {
    var hud = document.querySelector('.raid-contrib-hud');
    if (!hud || !hud.getClientRects().length) return null;
    var t = hud.innerText || '', m = /([^\n]*?)\s*\(Wave (\d+)\)\s*\n?\s*(\d+:\d{2})?/.exec(t);
    if (!m) return null;
    var rows = [], re = /(?:^|[\n\t])\s*([^\n\t%]{1,30}?)[\n\t ]+(\d+(?:\.\d+)?)%[\n\t ]+([\d.,]+[KMB]?)/g, r;
    while ((r = re.exec(t))) rows.push({ playerName: r[1].trim(), text: r[2] + '%' + ' (' + r[3] + ')' });
    return { raidName: (m[1] || '').replace(/^.*Recap\s*/, '').trim() || 'Chaos Dungeon', wave: +m[2], clock: m[3] || null, rows: rows, raw: t.slice(0, 500) };
  }
  window.__ccLobbyTimer = setInterval(function () {
    try {
      var l = bridge.lobby();
      if (l && l.size) window.__ccLastLobby = l;
      var s = scrapeRun();
      if (s) { window.__ccLastRun = Object.assign({ at: Date.now(), lobby: window.__ccLastLobby || null }, s); runSeenAt = Date.now(); }
      var inLobby = !!(G.raidLobby);
      if (hadLobby && !inLobby && window.__ccLastRun && Date.now() - runSeenAt < 5 * 60 * 1000) {
        var lr = window.__ccLastRun, p = (lr.clock || '0:00').split(':');
        window.__ccEndedRuns.push({ kind: 'dungeon', raidName: lr.raidName, wave: lr.wave, runMs: ((+p[0]) * 60 + (+p[1] || 0)) * 1000, memberCount: lr.lobby ? lr.lobby.size : 0,
          guildCount: lr.lobby ? lr.lobby.guild : 0, members: lr.lobby ? lr.lobby.members.map(function (x) { return x.name; }) : [], perPlayerDamage: lr.rows, loot: [], ts: Date.now(), fallback: true });
        if (window.__ccEndedRuns.length > 10) window.__ccEndedRuns.shift();
        window.__ccLastRun = null;
      }
      hadLobby = inLobby;
    } catch (e) {}
  }, 3000);
  window.__ccBridge = bridge;
  if (subs.speed.length || subs.snap.length) startSpeedPoll();
  return bridge;
})
