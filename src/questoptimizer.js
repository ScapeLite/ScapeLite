// Quest-order + travel-path optimizer. Respects quest prerequisites
// (questRequirements) and level gates (levelRequirements), and sequences
// eligible quests to minimize travel between them.
//
// Honest framing: optimal ordering under both precedence constraints AND
// travel cost is a precedence-constrained TSP -- NP-hard in general. This
// uses a greedy nearest-next heuristic (at each step, do whichever
// eligible quest is cheapest to reach from where you are), which is not
// globally optimal but is explainable, fast, and in the same spirit as
// every other model in this project (practical EV/heuristics over the
// game's real data, not brute-force search).

const { bankToBankDistance } = require('./travel');

function isQuestEligible(quest, completedQuestIds, playerLevels) {
  if (completedQuestIds.has(quest.id)) return false;
  for (const req of quest.questRequirements || []) {
    if (!completedQuestIds.has(req)) return false;
  }
  for (const [skill, lvl] of Object.entries(quest.levelRequirements || {})) {
    if ((playerLevels[skill] || 1) < lvl) return false;
  }
  return true;
}

/** mobType -> every encounter that features it (a kill-step's mobId can appear at more than one node). */
function buildMobTypeIndex(data) {
  const byMobType = {};
  for (const enc of Object.values(data.mobs.encounters)) {
    for (const m of enc.mobs) {
      if (!byMobType[m.mobType]) byMobType[m.mobType] = [];
      byMobType[m.mobType].push(enc);
    }
  }
  return byMobType;
}

// Bank-type nodes don't carry nearestBankId/nearestBankDistance -- they
// ARE the reference point, not a satellite of one. A quest step that's
// "visit <some bank>" (the common case -- most quest steps are NPC
// dialogue at a bank) needs its own branch: distance is a straight
// bank-to-bank hop, not node-to-nearest-bank-plus-hop.
function distanceFromBankToNode(data, fromBankId, node) {
  if (!node) return null;
  if (node.type === 'bank') {
    if (node.id === fromBankId) return 0;
    return bankToBankDistance(data, fromBankId, node.id);
  }
  if (node.nearestBankId === fromBankId) return node.nearestBankDistance;
  const leg = bankToBankDistance(data, fromBankId, node.nearestBankId);
  return leg == null ? null : leg + node.nearestBankDistance;
}

/** The bank you end up "at" after visiting a node -- itself if it's a bank, else its hub. */
function endBankFor(node) {
  return node.type === 'bank' ? node.id : node.nearestBankId;
}

/** Resolve one quest step to a node id. Kill steps pick the nearest encounter of that mob type. */
function stepNodeId(data, step, fromBankId, mobTypeIndex) {
  if (step.type === 'visit') return step.nodeId;
  if (step.type === 'kill') {
    const encounters = mobTypeIndex[step.mobId] || [];
    if (encounters.length === 0) return null;
    if (!fromBankId || encounters.length === 1) return encounters[0].nodeId;
    let best = null, bestDist = Infinity;
    for (const enc of encounters) {
      const d = distanceFromBankToNode(data, fromBankId, data.nodes.byId[enc.nodeId]);
      if (d != null && d < bestDist) { bestDist = d; best = enc.nodeId; }
    }
    return best;
  }
  return null;
}

/** Walks a quest's steps in order, summing travel between consecutive step locations. */
function questTravelCost(data, quest, fromBankId, mobTypeIndex) {
  let totalDistance = 0;
  let currentBank = fromBankId;
  for (const step of quest.steps || []) {
    const nodeId = stepNodeId(data, step, currentBank, mobTypeIndex);
    const node = nodeId ? data.nodes.byId[nodeId] : null;
    if (!node) continue;
    const distance = distanceFromBankToNode(data, currentBank, node);
    if (distance != null) totalDistance += distance;
    currentBank = endBankFor(node);
  }
  return { totalDistance, endBankId: currentBank };
}

/** Greedy nearest-next quest route -- see module doc comment for the heuristic's limits. */
function greedyQuestRoute(data, { completedQuestIds = new Set(), playerLevels = {}, fromBankId = null, maxQuests = null } = {}) {
  const mobTypeIndex = buildMobTypeIndex(data);
  const completed = new Set(completedQuestIds);
  const route = [];
  let currentBank = fromBankId;

  while (maxQuests == null || route.length < maxQuests) {
    const eligible = data.quests.list.filter(q => isQuestEligible(q, completed, playerLevels));
    if (eligible.length === 0) break;

    let best = null, bestCost = Infinity, bestEndBank = null;
    for (const q of eligible) {
      const { totalDistance, endBankId } = questTravelCost(data, q, currentBank, mobTypeIndex);
      if (totalDistance < bestCost) { bestCost = totalDistance; best = q; bestEndBank = endBankId; }
    }
    route.push({ questId: best.id, name: best.name, travelDistance: bestCost });
    completed.add(best.id);
    currentBank = bestEndBank;
  }
  return route;
}

/** Same eligibility walk but in the data's own (unsequenced) order -- a baseline to compare the greedy route against. */
function naiveQuestRoute(data, { completedQuestIds = new Set(), playerLevels = {}, fromBankId = null, maxQuests = null } = {}) {
  const mobTypeIndex = buildMobTypeIndex(data);
  const completed = new Set(completedQuestIds);
  const route = [];
  let currentBank = fromBankId;

  let progressed = true;
  while (progressed && (maxQuests == null || route.length < maxQuests)) {
    progressed = false;
    for (const q of data.quests.list) {
      if (maxQuests != null && route.length >= maxQuests) break;
      if (!isQuestEligible(q, completed, playerLevels)) continue;
      const { totalDistance, endBankId } = questTravelCost(data, q, currentBank, mobTypeIndex);
      route.push({ questId: q.id, name: q.name, travelDistance: totalDistance });
      completed.add(q.id);
      currentBank = endBankId;
      progressed = true;
    }
  }
  return route;
}

module.exports = { isQuestEligible, buildMobTypeIndex, stepNodeId, questTravelCost, greedyQuestRoute, naiveQuestRoute };
