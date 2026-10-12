// Local dashboard server. Wraps the existing src/*.js calculation modules
// behind a small JSON API and serves a static front-end. Everything here
// runs on your own machine against your own typed-in numbers -- no live
// game/account access, consistent with every other module in this project.

const express = require('express');
const fs = require('fs');
const path = require('path');

const { loadGameData } = require('./data');
const { simulateFight, mobToCombatant } = require('./combat');
const { activityValue, taskCompletionValue } = require('./skilling');
const { distanceFromBankToNode, resolveTravel } = require('./travel');
const { evaluateReroll } = require('./reroll');
const { evaluateSlayReroll, buildEncounterIndex } = require('./slaytasks');
const { evaluateRareDropFarm } = require('./raredrops');
const { greedyQuestRoute } = require('./questoptimizer');

const data = loadGameData();
const C = data.constants;
const PROFILE_PATH = path.join(__dirname, '..', 'data', 'profile.json');

const ALL_SKILL_IDS = data.skills.list.map(s => s.id);
const DEFAULT_PROFILE = {
  skills: Object.fromEntries(ALL_SKILL_IDS.map(id => [id, 1])),
  weaponId: 'copper_dagger',
  style: 'stab',
  critSources: 0,
  currentBankId: null,
  creditStock: 150,
  slayCreditStock: 150,
  crystal: null, // { tier: 1|2|3, charges: number }
  skillingSources: 0,
  toolReduction: 0,
  flatReduction: 0,
  lucky: false
};

function loadProfile() {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')) };
  } catch (_) {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p) {
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(p, null, 2));
}

/** Profile -> combat.js-shaped build for a given style. */
function combatBuildFromProfile(profile, styleOverride) {
  const weapon = data.items.byId[profile.weaponId];
  const style = styleOverride || profile.style || weapon.attackStyle || 'stab';
  return {
    skills: profile.skills,
    gear: {
      stabAttack: weapon.stabAttack, slashAttack: weapon.slashAttack, crushAttack: weapon.crushAttack,
      rangeAttack: weapon.rangeAttack, magicAttack: weapon.magicAttack,
      meleeStrength: weapon.meleeStrength, rangeStrength: weapon.rangeStrength, magicStrength: weapon.magicStrength
    },
    bonuses: 0, spirit: false, capePetBonus: 0,
    critSources: profile.critSources || 0,
    weaponSpeed: weapon.attackSpeed,
    style
  };
}

/** Profile -> skilling.js-shaped player. */
function skillingPlayerFromProfile(profile, skillId) {
  return {
    level: profile.skills[skillId] || 1,
    sources: profile.skillingSources || 0,
    toolReduction: profile.toolReduction || 0,
    flatReduction: profile.flatReduction || 0,
    lucky: !!profile.lucky,
    vigorLevel: profile.skills.vigor || 1
  };
}

const app = express();
// 20mb: a base64-encoded screenshot is easily several MB (raw PNG size x
// ~1.33 for base64 overhead), well past Express's 100kb default limit --
// that default was silently turning every image upload into a 413 HTML
// error page instead of a JSON error.
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Metadata for populating the UI ----
app.get('/api/meta', (req, res) => {
  const weapons = Object.entries(data.items.byId)
    .filter(([, it]) => it.slot === 'mainhand')
    .map(([id, it]) => ({ id, name: it.name, tier: it.tier, attackStyle: it.attackStyle }))
    .sort((a, b) => a.tier - b.tier);

  const encounters = Object.values(data.mobs.encounters)
    .map(enc => ({
      taskId: enc.taskId, name: enc.name, slayRequired: enc.slayRequired, nodeId: enc.nodeId,
      rareDrops: (enc.rareDrops || []).map(rd => ({ itemId: rd.itemId, name: data.items.byId[rd.itemId]?.name || rd.itemId, oneInChance: rd.oneInChance }))
    }))
    .sort((a, b) => a.slayRequired - b.slayRequired);

  const activitiesBySkill = {};
  for (const [skill, info] of Object.entries(data.activities.bySkill)) {
    activitiesBySkill[skill] = info.activities.map(a => ({ activityId: a.activityId, name: a.name, levelRequired: a.levelRequired, tier: a.tier }));
  }

  const banks = data.nodes.list.filter(n => n.type === 'bank').map(n => ({ id: n.id, name: n.name }));
  const quests = data.quests.list.map(q => ({ id: q.id, name: q.name }));

  res.json({ skills: data.skills.list, weapons, encounters, activitiesBySkill, banks, quests });
});

// ---- Profile ----
app.get('/api/profile', (req, res) => res.json(loadProfile()));
app.post('/api/profile', (req, res) => {
  const profile = { ...DEFAULT_PROFILE, ...req.body };
  saveProfile(profile);
  res.json(profile);
});

// ---- Combat: single fight / compare two weapons ----
app.post('/api/combat/simulate', (req, res) => {
  try {
    const profile = { ...loadProfile(), ...req.body.profileOverrides };
    const encounter = buildEncounterIndex(data)[req.body.mobTaskId];
    if (!encounter) return res.status(400).json({ error: 'Unknown mobTaskId' });
    const mob = data.mobs.byId[encounter.mobs[0].mobType];

    const player = combatBuildFromProfile(profile, req.body.style);
    const result = simulateFight(C, {
      player, mob: mobToCombatant(mob), style: player.style,
      mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed
    });
    res.json({ mobName: mob.name, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/combat/compare', (req, res) => {
  try {
    const profile = loadProfile();
    const encounter = buildEncounterIndex(data)[req.body.mobTaskId];
    if (!encounter) return res.status(400).json({ error: 'Unknown mobTaskId' });
    const mob = data.mobs.byId[encounter.mobs[0].mobType];

    const results = {};
    for (const key of ['weaponIdA', 'weaponIdB']) {
      const p = { ...profile, weaponId: req.body[key] };
      const player = combatBuildFromProfile(p, req.body.style);
      results[key] = simulateFight(C, {
        player, mob: mobToCombatant(mob), style: player.style,
        mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed
      });
    }
    res.json({ mobName: mob.name, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Reroll: skilling lane ----
app.post('/api/reroll/skilling', (req, res) => {
  try {
    const profile = loadProfile();
    const { skillId, visibleOptions } = req.body;
    const player = skillingPlayerFromProfile(profile, skillId);
    const candidatePool = data.activities.bySkill[skillId].activities.map(a => ({ ...a, skill: skillId }));

    const result = evaluateReroll(C, data, {
      visibleOptions, candidatePool, player,
      fromBankId: profile.currentBankId, crystal: profile.crystal,
      creditStock: profile.creditStock
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Reroll: slay lane ----
app.post('/api/reroll/slay', (req, res) => {
  try {
    const profile = loadProfile();
    const player = combatBuildFromProfile(profile);
    player.skills = { ...player.skills }; // slaytasks reads player.skills.vigor directly

    const result = evaluateSlayReroll(C, data, {
      visibleOptions: req.body.visibleOptions, player,
      fromBankId: profile.currentBankId, crystal: profile.crystal,
      creditStock: profile.slayCreditStock
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Rare drop farm EV ----
app.post('/api/raredrop', (req, res) => {
  try {
    const profile = loadProfile();
    const { mobTaskId, oneInChance, expectedRemainingHours } = req.body;
    const encounter = buildEncounterIndex(data)[mobTaskId];
    if (!encounter) return res.status(400).json({ error: 'Unknown mobTaskId' });
    const mob = data.mobs.byId[encounter.mobs[0].mobType];

    const player = combatBuildFromProfile(profile);
    const before = simulateFight(C, { player, mob: mobToCombatant(mob), style: player.style, mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed });
    const afterPlayer = { ...player, critSources: (player.critSources || 0) + 1 };
    const after = simulateFight(C, { player: afterPlayer, mob: mobToCombatant(mob), style: player.style, mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed });

    const result = evaluateRareDropFarm({
      oneInChance, rollsPerHour: before.killsPerHour,
      farmActivityXpPerHour: before.chosenSkillXpPerHour,
      normalActivityXpPerHour: req.body.normalActivityXpPerHour ?? before.chosenSkillXpPerHour,
      bonusXpPerHourGain: after.chosenSkillXpPerHour - before.chosenSkillXpPerHour,
      expectedRemainingHours: expectedRemainingHours ?? null
    });
    res.json({ mobName: mob.name, killsPerHour: before.killsPerHour, bonusXpPerHourGain: after.chosenSkillXpPerHour - before.chosenSkillXpPerHour, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Map: banks + every task reachable from each, grouped for the
// click-through task-builder UI ----
app.get('/api/map', (req, res) => {
  const banks = data.nodes.list.filter(n => n.type === 'bank').map(n => ({ id: n.id, name: n.name, x: n.position.x, y: n.position.y }));
  const bounds = {
    minX: Math.min(...banks.map(b => b.x)), maxX: Math.max(...banks.map(b => b.x)),
    minY: Math.min(...banks.map(b => b.y)), maxY: Math.max(...banks.map(b => b.y))
  };

  const byBank = {};
  for (const bank of banks) byBank[bank.id] = { skills: {}, combat: [] };

  const encounterByNodeId = {};
  for (const enc of Object.values(data.mobs.encounters)) encounterByNodeId[enc.nodeId] = enc;

  for (const node of data.nodes.list) {
    const bucket = byBank[node.nearestBankId];
    if (!bucket) continue;

    if (node.type === 'skill') {
      for (const act of node.activities || []) {
        if (!bucket.skills[act.skill]) bucket.skills[act.skill] = [];
        let nodeEntry = bucket.skills[act.skill].find(n => n.nodeId === node.id);
        if (!nodeEntry) {
          nodeEntry = { nodeId: node.id, name: node.name, tiers: [] };
          bucket.skills[act.skill].push(nodeEntry);
        }
        const full = data.activities.byId[act.activityId];
        nodeEntry.tiers.push({ activityId: act.activityId, name: full?.name || act.activityId, tier: act.tier, levelRequired: act.levelRequired });
      }
    } else if (node.type === 'combat') {
      const enc = encounterByNodeId[node.id];
      if (enc) bucket.combat.push({ nodeId: node.id, taskId: enc.taskId, name: enc.name, slayRequired: enc.slayRequired, slayCategory: enc.slayCategory });
    }
  }

  // Sort tiers within each node and nodes/combat entries by level for a
  // predictable, low-to-high menu.
  for (const bank of Object.values(byBank)) {
    for (const nodes of Object.values(bank.skills)) {
      nodes.sort((a, b) => (a.tiers[0]?.levelRequired || 0) - (b.tiers[0]?.levelRequired || 0));
      for (const n of nodes) n.tiers.sort((a, b) => a.levelRequired - b.levelRequired);
    }
    bank.combat.sort((a, b) => a.slayRequired - b.slayRequired);
  }

  // Every non-bank node, for plotting on the map with a type/skill-specific
  // icon. Banks are already covered by `banks` above.
  const satelliteNodes = data.nodes.list
    .filter(n => n.type !== 'bank')
    .map(n => {
      const enc = n.type === 'combat' ? encounterByNodeId[n.id] : null;
      // MOB_TIER_WORDS prefixes every mob id ('feeble_zombie', 'dire_zombie',
      // ...) -- index+1 is the tier, per Constants.js's own comment on it.
      const tier = enc ? (C.MOB_TIER_WORDS.findIndex(w => enc.taskId.startsWith(w + '_')) + 1 || null) : null;
      return {
        id: n.id, name: n.name, type: n.type, x: n.position.x, y: n.position.y,
        skill: n.type === 'skill' ? (n.activities || [])[0]?.skill || null : null,
        taskId: enc ? enc.taskId : null,
        slayRequired: enc ? enc.slayRequired : null,
        slayCategory: enc ? enc.slayCategory : null,
        tier,
        bankId: n.nearestBankId || null
      };
    });

  res.json({ banks, bounds, byBank, skills: data.skills.list, nodes: satelliteNodes });
});

// ---- Queue evaluation: the map-built task list, in order. Computes real
// sequential travel (each entry's start point is wherever the previous
// one left you) using the EXACT node you picked on the map -- no
// nearest-node guessing, since the map lets you pick the real one. ----
app.post('/api/queue/evaluate', (req, res) => {
  try {
    const profile = loadProfile();
    const entries = req.body.entries || [];
    const encounterIndex = buildEncounterIndex(data);
    let currentBank = profile.currentBankId;
    const results = [];
    let totalXp = 0, totalSeconds = 0, totalTravelDistance = 0;

    for (const e of entries) {
      const node = data.nodes.byId[e.nodeId];
      const distance = (currentBank && node) ? distanceFromBankToNode(data, currentBank, node) : null;
      const travel = distance != null ? resolveTravel(C, distance, { vigorLevel: profile.skills.vigor, crystal: profile.crystal }) : { seconds: 0, teleportUsed: false };

      let actionSeconds, xp, label;
      if (e.type === 'skilling') {
        const activity = data.activities.byId[e.activityId];
        const player = skillingPlayerFromProfile(profile, activity.skill);
        const v = taskCompletionValue(C, activity, player, e.quantity);
        actionSeconds = v.totalSeconds; xp = v.totalXp; label = activity.name;
      } else {
        const encounter = encounterIndex[e.taskId];
        const mob = data.mobs.byId[encounter.mobs[0].mobType];
        const player = combatBuildFromProfile(profile);
        const fight = simulateFight(C, { player, mob: mobToCombatant(mob), style: player.style, mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed });
        actionSeconds = e.quantity * fight.killSeconds;
        xp = actionSeconds * fight.chosenSkillXpPerHour / 3600;
        label = encounter.name;
      }

      const travelSeconds = travel.seconds || 0;
      const effectiveSeconds = actionSeconds + travelSeconds;
      const fromBankId = currentBank;
      const toBankId = node ? node.nearestBankId : currentBank;
      results.push({
        id: e.id, label, quantity: e.quantity,
        fromBankId, toBankId,
        travelDistance: distance || 0, travelSeconds, teleportUsed: travel.teleportUsed,
        actionSeconds, xp, effectiveSeconds,
        effectiveXpPerHour: effectiveSeconds > 0 ? xp / (effectiveSeconds / 3600) : 0
      });

      totalXp += xp; totalSeconds += effectiveSeconds; totalTravelDistance += (distance || 0);
      currentBank = toBankId;
    }

    res.json({
      startBankId: profile.currentBankId,
      results, totalXp, totalSeconds, totalTravelDistance,
      totalXpPerHour: totalSeconds > 0 ? totalXp / (totalSeconds / 3600) : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Quest route optimizer ----
app.post('/api/questroute', (req, res) => {
  try {
    const profile = loadProfile();
    const route = greedyQuestRoute(data, {
      completedQuestIds: new Set(req.body.completedQuestIds || []),
      playerLevels: profile.skills,
      fromBankId: profile.currentBankId,
      maxQuests: req.body.maxQuests || 15
    });
    res.json({ route, totalTravel: route.reduce((s, r) => s + r.travelDistance, 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Image import: upload a screenshot, get structured data back ----
// Calls Anthropic's Messages API with vision. Needs ANTHROPIC_API_KEY set
// in the environment -- the dashboard is otherwise 100% local/offline, so
// this is the one feature that makes an outbound network call, and it
// only ever sends the image you explicitly upload, to Anthropic, nothing
// else. See README for how to set the key.
const SKILL_IDS = ALL_SKILL_IDS;
const META_ENCOUNTERS = Object.values(data.mobs.encounters).map(enc => ({ taskId: enc.taskId, name: enc.name }));

async function callClaudeVision(base64Image, mediaType, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set on the server. Set it in your environment (see README) and restart the dashboard to use image import.');
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Anthropic API error ${res.status}`);
  const text = json.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('Could not find JSON in the model response: ' + text.slice(0, 300));
  return JSON.parse(match[0]);
}

app.post('/api/import', async (req, res) => {
  try {
    const { image, mediaType, kind } = req.body;
    if (!image || !mediaType) return res.status(400).json({ error: 'Missing image/mediaType' });

    if (kind === 'skills') {
      const prompt = `This is a screenshot of a Scapewatch (idle MMO) Skills panel -- a grid of skill icons each paired with a level number. The valid skill ids, in no particular order, are: ${SKILL_IDS.join(', ')}. Read every visible skill icon+level pair and return ONLY a JSON object mapping skill id to level, e.g. {"life": 20, "mine": 22, ...}. Use your best judgement matching icons to skill ids by their appearance/context. Only include skills you can actually see a level for. No other text, just the JSON object.`;
      const parsed = await callClaudeVision(image, mediaType, prompt);
      return res.json({ skills: parsed });
    }

    if (kind === 'tasks') {
      const prompt = `This is a screenshot of a Scapewatch (idle MMO) task queue. Each row shows a task like "[T1] Kill 81 Feeble Zombie" or a skilling task like "Mine 80 Copper Ore". Return ONLY a JSON array of objects: [{"type": "slay"|"skilling", "name": "<the mob or activity name as displayed>", "quantity": <number>}]. No other text, just the JSON array.`;
      const parsed = await callClaudeVision(image, mediaType, prompt);

      // Best-effort name -> internal id resolution against our own data,
      // so the result is directly usable, not just descriptive text.
      const resolved = parsed.map(t => {
        if (t.type === 'slay') {
          const enc = META_ENCOUNTERS.find(e => e.name.toLowerCase() === String(t.name).toLowerCase());
          return { ...t, taskId: enc?.taskId || null };
        }
        const match = Object.values(data.activities.byId).find(a => a.name.toLowerCase() === String(t.name).toLowerCase());
        return { ...t, activityId: match?.activityId || null };
      });
      return res.json({ tasks: resolved });
    }

    res.status(400).json({ error: 'kind must be "skills" or "tasks"' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all error handler: keeps every response JSON (even body-parser
// errors like payload-too-large, which Express otherwise renders as an
// HTML page) so the front-end's res.json() never has to guess.
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => console.log(`Scapewatch planner dashboard: http://localhost:${PORT}`));
