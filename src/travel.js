// Travel-time cost model. Walking distance between tasks is one of the
// biggest hidden hits to real XP/hour -- this makes it explicit instead of
// pretending every action happens with zero transit time.

/** Sum of segment lengths for a bank-to-bank route from paths.json. */
function bankToBankDistance(data, bankA, bankB) {
  if (bankA === bankB) return 0;
  const key = [bankA, bankB].sort().join(':');
  const waypoints = data.bankPaths[key];
  if (!waypoints) return null;
  let dist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    dist += Math.sqrt(dx * dx + dy * dy);
  }
  return dist;
}

/** activityId -> every {nodeId, nearestBankId, nearestBankDistance} that offers it. */
function buildActivityNodeIndex(data) {
  const index = {};
  for (const node of data.nodes.list) {
    if (!node.activities) continue;
    for (const act of node.activities) {
      if (!index[act.activityId]) index[act.activityId] = [];
      index[act.activityId].push({
        nodeId: node.id,
        nearestBankId: node.nearestBankId,
        nearestBankDistance: node.nearestBankDistance
      });
    }
  }
  return index;
}

/** Walking distance from a bank to a specific node (via its hub bank if different). */
function distanceFromBankToNode(data, fromBankId, nodeEntry) {
  if (nodeEntry.nearestBankId === fromBankId) return nodeEntry.nearestBankDistance;
  const leg = bankToBankDistance(data, fromBankId, nodeEntry.nearestBankId);
  if (leg == null) return null;
  return leg + nodeEntry.nearestBankDistance;
}

/**
 * Best-case (nearest instance) distance from fromBankId to any node
 * offering `activityId`. Multiple nodes often offer the same activity at
 * different map locations; this assumes you'd rationally pick the closest.
 */
function nearestDistanceForActivity(data, activityId, fromBankId, nodeIndex) {
  const candidates = nodeIndex[activityId];
  if (!candidates || candidates.length === 0) return null;
  let best = Infinity;
  let bestEntry = null;
  for (const entry of candidates) {
    const d = distanceFromBankToNode(data, fromBankId, entry);
    if (d != null && d < best) { best = d; bestEntry = entry; }
  }
  return best === Infinity ? null : { distance: best, node: bestEntry };
}

/**
 * Resolve travel time for one leg, applying a teleport crystal if the
 * player has one active and the distance clears its tier threshold.
 * crystal: { tier: 1|2|3, charges: number } or null/undefined.
 */
function resolveTravel(C, distance, { vigorLevel = 1, speedOpts = {}, crystal = null } = {}) {
  if (distance == null) return { seconds: null, teleportUsed: false };

  if (crystal && crystal.charges > 0) {
    const threshold = C.TELEPORT_TIER_THRESHOLDS[crystal.tier];
    if (threshold != null && distance > threshold) {
      return { seconds: 0, teleportUsed: true, distance };
    }
  }

  const speed = C.totalMovementSpeed({ vigorLevel, ...speedOpts });
  return { seconds: distance / speed, teleportUsed: false, distance };
}

module.exports = { bankToBankDistance, buildActivityNodeIndex, distanceFromBankToNode, nearestDistanceForActivity, resolveTravel };
