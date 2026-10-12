// Slay/combat-lane counterpart to reroll.js's skilling-task EV model.
// Same reasoning as skilling tasks: we can't observe the real 3 alternative
// options once a slot is already committed (they're gone from the UI the
// moment one is picked), so -- exactly as with skilling tasks -- this
// estimates a fresh draw's value from the THEORETICAL pool of every
// encounter you're eligible for (mobs.json's `encounters`, filtered by
// slayRequired), not from observed alternatives. Same uniform-weighting
// caveat as reroll.js applies here too.

const { simulateFight, mobToCombatant } = require('./combat');
const { bankToBankDistance, resolveTravel } = require('./travel');
const { creditMarginalValue } = require('./reroll');

function buildEncounterIndex(data) {
  const byTaskId = {};
  for (const [encId, enc] of Object.entries(data.mobs.encounters)) {
    byTaskId[enc.taskId] = { ...enc, encId };
  }
  return byTaskId;
}

/** Distance from fromBankId to an encounter's single associated node. */
function distanceToEncounter(data, fromBankId, encounter) {
  const node = data.nodes.byId[encounter.nodeId];
  if (!node || !fromBankId) return null;
  if (node.nearestBankId === fromBankId) return node.nearestBankDistance;
  const leg = bankToBankDistance(data, fromBankId, node.nearestBankId);
  if (leg == null) return null;
  return leg + node.nearestBankDistance;
}

/**
 * Travel- and crit-aware value of killing `quantity` of one encounter's
 * mob. player must be a combat.js-shaped build (skills/gear/weaponSpeed/
 * critSources) PLUS `style` for which combat style to fight with.
 */
function slayTaskValue(C, data, option, player, encounterIndex, { fromBankId, crystal } = {}) {
  const encounter = encounterIndex[option.taskId];
  if (!encounter) return null;
  const mob = data.mobs.byId[encounter.mobs[0].mobType]; // first mob in the encounter; multi-mob encounters need extending later

  const fight = simulateFight(C, {
    player, mob: mobToCombatant(mob), style: player.style || 'stab',
    mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed
  });

  let travelSeconds = 0, teleportUsed = false, travelDistance = 0;
  // Pass the real in-game route distance if you can see it (it's shown
  // right on the task) rather than relying on the computed estimate --
  // same reasoning as reroll.js's skilling-task override.
  if (option.travelDistanceOverride != null) {
    const travel = resolveTravel(C, option.travelDistanceOverride, { vigorLevel: player.skills.vigor, crystal });
    travelSeconds = travel.seconds || 0;
    teleportUsed = travel.teleportUsed;
    travelDistance = option.travelDistanceOverride;
  } else if (fromBankId) {
    const distance = distanceToEncounter(data, fromBankId, encounter);
    if (distance != null) {
      const travel = resolveTravel(C, distance, { vigorLevel: player.skills.vigor, crystal });
      travelSeconds = travel.seconds || 0;
      teleportUsed = travel.teleportUsed;
      travelDistance = distance;
    }
  }

  const totalSeconds = option.quantity * fight.killSeconds;
  const totalXp = option.quantity * fight.killSeconds * fight.chosenSkillXpPerHour / 3600; // == quantity * xpPerKill, expressed via the rate for consistency with fight's own units
  const effectiveSeconds = totalSeconds + travelSeconds;

  return {
    encounter, mob, fight, travelDistance, travelSeconds, teleportUsed,
    totalXp, totalSeconds, effectiveSeconds,
    effectiveXpPerHour: totalXp / (effectiveSeconds / 3600)
  };
}

/** Same Monte Carlo best-of-N approach as reroll.js, over eligible encounters instead of activities. */
function expectedBestOfFreshSlayDraw(C, data, player, encounterIndex, { fromBankId, crystal = null, quantity = 60, trials = 20000, optionsPerSlot = C.QUEUE_OPTIONS_PER_SLOT, slayLevel = null, weights = null } = {}) {
  const lvl = slayLevel ?? (player.skills && player.skills.slay) ?? 1;
  const eligible = Object.values(encounterIndex).filter(enc => (enc.slayRequired || 1) <= lvl);
  if (eligible.length === 0) return 0;

  const values = eligible.map(enc => {
    const v = slayTaskValue(C, data, { taskId: enc.taskId, quantity }, player, encounterIndex, { fromBankId, crystal });
    return v ? v.effectiveXpPerHour : 0;
  });

  let sum = 0;
  for (let t = 0; t < trials; t++) {
    let best = -Infinity;
    for (let k = 0; k < optionsPerSlot; k++) {
      const v = values[Math.floor(Math.random() * values.length)];
      if (v > best) best = v;
    }
    sum += best;
  }
  return sum / trials;
}

/** Slay-lane keep-vs-reroll decision, mirroring reroll.js's evaluateReroll. */
function evaluateSlayReroll(C, data, { visibleOptions, player, fromBankId = null, crystal = null, creditStock = null, creditValue = null, creditBaseValue = 50 }) {
  const encounterIndex = buildEncounterIndex(data);

  const visibleValues = visibleOptions.map(opt => ({ option: opt, ...slayTaskValue(C, data, opt, player, encounterIndex, { fromBankId, crystal }) }));
  const bestVisible = visibleValues.reduce((a, b) => (b.effectiveXpPerHour > a.effectiveXpPerHour ? b : a));

  const rerollCost = C.SLAY_REROLL_COST;
  const freshDrawEV = expectedBestOfFreshSlayDraw(C, data, player, encounterIndex, { fromBankId, crystal });

  const resolvedCreditValue = creditValue != null ? creditValue : (creditStock != null ? creditMarginalValue(creditStock, { rerollCost, baseValue: creditBaseValue }) : 0);
  const creditCostXp = rerollCost * resolvedCreditValue;
  const amortizationHours = bestVisible.effectiveSeconds / 3600;
  const creditCostRate = amortizationHours > 0 ? creditCostXp / amortizationHours : 0;
  const netRerollRate = freshDrawEV - creditCostRate;

  return {
    visibleValues, bestVisible, freshDrawEV, rerollCost,
    creditMarginalValue: resolvedCreditValue, creditCostXp, netRerollRate,
    recommendation: netRerollRate > bestVisible.effectiveXpPerHour ? 'reroll' : 'keep',
    marginXpPerHour: netRerollRate - bestVisible.effectiveXpPerHour
  };
}

module.exports = { buildEncounterIndex, distanceToEncounter, slayTaskValue, expectedBestOfFreshSlayDraw, evaluateSlayReroll };
