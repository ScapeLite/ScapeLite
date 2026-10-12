// Task-reroll expected-value model. Answers: "is it worth spending reroll
// credits to discard the 3 currently-visible task options for 3 fresh
// ones?" -- now travel-aware: a task's EFFECTIVE value is its XP divided
// by (action time + walking time to reach it), not just raw XP/hr, since
// transit time is one of the biggest real losses to XP/hour. Also makes
// the credit cost scarcity-sensitive: spending credits when you're
// sitting on a stockpile is cheap, spending your last few is not.
//
// Known simplification: a fresh draw's candidate pool is weighted
// uniformly here. The live game almost certainly weights activity
// selection by each skill's "lever" setting (see Constants.js
// effectiveWeight/leverMultiplier) -- info not available offline. Pass
// `weights` matching candidatePool's order if you know your own lever
// setup for a sharper estimate.

const { taskCompletionValue } = require('./skilling');
const { buildActivityNodeIndex, nearestDistanceForActivity, resolveTravel } = require('./travel');

/**
 * Travel-adjusted value of one task: action time AND the walk/teleport to
 * reach it both count against effective XP/hr. `fromBankId` is where the
 * player currently is (or where their previous queued task left off).
 */
function taskOptionValue(C, data, option, player, nodeIndex, { fromBankId, crystal = null } = {}) {
  const activity = data.activities.byId[option.activityId];
  const base = taskCompletionValue(C, activity, player, option.quantity);

  let travelSeconds = 0;
  let teleportUsed = false;
  let travelDistance = 0;
  // The same activity is often minable/fishable/etc. at several different
  // nodes across the map -- the queue can assign ANY of them, not
  // necessarily the nearest one. If you can see the real route distance
  // in-game (shown right on the task), pass it as travelDistanceOverride
  // and that's used verbatim instead of guessing "nearest instance."
  if (option.travelDistanceOverride != null) {
    const travel = resolveTravel(C, option.travelDistanceOverride, { vigorLevel: player.vigorLevel, crystal });
    travelSeconds = travel.seconds || 0;
    teleportUsed = travel.teleportUsed;
    travelDistance = option.travelDistanceOverride;
  } else if (fromBankId) {
    const nearest = nearestDistanceForActivity(data, option.activityId, fromBankId, nodeIndex);
    if (nearest) {
      const travel = resolveTravel(C, nearest.distance, { vigorLevel: player.vigorLevel, crystal });
      travelSeconds = travel.seconds || 0;
      teleportUsed = travel.teleportUsed;
      travelDistance = nearest.distance;
      option._arrivesAtBankId = nearest.node.nearestBankId; // where you end up, for chaining
    }
  }

  const effectiveSeconds = base.totalSeconds + travelSeconds;
  return {
    ...base,
    travelDistance, travelSeconds, teleportUsed,
    effectiveSeconds,
    effectiveXpPerHour: base.totalXp / (effectiveSeconds / 3600)
  };
}

function expectedBestOfFreshDraw(C, data, candidatePool, player, nodeIndex, { fromBankId, crystal = null, quantity = null, trials = 20000, optionsPerSlot = C.QUEUE_OPTIONS_PER_SLOT, weights = null } = {}) {
  const eligible = candidatePool
    .map((act, i) => ({ act, weight: weights ? weights[i] : 1 }))
    .filter(({ act }) => (act.levelRequired || 1) <= (player.level || 1));
  if (eligible.length === 0) return 0;
  const pool = eligible.map(e => e.act);
  const poolWeights = weights ? eligible.map(e => e.weight) : null;

  const values = pool.map(act => {
    const q = quantity ?? C.quantityRange(C.adjustedBaseQuantity(act.baseQuantity ?? 60, 0)).max;
    const v = taskOptionValue(C, data, { activityId: act.activityId, quantity: q }, player, nodeIndex, { fromBankId, crystal });
    // Rate, not total XP: tasks demand different quantities, so comparing
    // totals would just reward whichever task asks for more of something,
    // not whichever is actually more efficient to work on.
    return v.effectiveXpPerHour;
  });

  const cumWeights = poolWeights ? poolWeights.reduce((acc, w, i) => { acc.push((acc[i - 1] || 0) + w); return acc; }, []) : null;
  function pickIndex() {
    if (!cumWeights) return Math.floor(Math.random() * values.length);
    const r = Math.random() * cumWeights[cumWeights.length - 1];
    return cumWeights.findIndex(c => r <= c);
  }

  let sum = 0;
  for (let t = 0; t < trials; t++) {
    let best = -Infinity;
    for (let k = 0; k < optionsPerSlot; k++) {
      const v = values[pickIndex()];
      if (v > best) best = v;
    }
    sum += best;
  }
  return sum / trials;
}

/**
 * Marginal XP-equivalent value of spending one more reroll credit, given
 * your current stock. Hyperbolic scarcity curve: cheap when you're
 * sitting on a pile, expensive as you approach zero.
 *   value(stock) = baseValue * reserve / (stock + reserve)
 * `reserve` is the stock level at which a credit is worth half baseValue
 * -- defaults to 10 rerolls' worth, a "comfortable buffer" heuristic
 * (there's no game-derived number for this; it's a risk-tolerance knob,
 * tune it to taste).
 */
function creditMarginalValue(stock, { rerollCost, baseValue, reserveMultiple = 10 } = {}) {
  const reserve = rerollCost * reserveMultiple;
  return baseValue * (reserve / (Math.max(0, stock) + reserve));
}

/**
 * The decision: given 3 currently-visible task options, is it worth
 * paying rerollCost credits to discard them for 3 fresh ones?
 *
 * Compares effective XP/hour (rate), not total XP -- see taskOptionValue.
 * The one-time credit cost is converted to a rate penalty by amortizing
 * it over the best visible option's own time commitment (the natural
 * window for "is it worth swapping THIS for a reroll"), so it can be
 * subtracted from a rate on equal footing. This is a modeling choice,
 * not a game-derived number -- the shape (scarce credits cost more) is
 * the part that matters, not the exact amortization window.
 *
 * creditStock: your current reroll-credit balance -- drives the scarcity
 * curve above. Pass creditValue directly instead if you want to override
 * the curve with a flat XP-equivalent-per-credit number.
 */
function evaluateReroll(C, data, {
  visibleOptions, candidatePool, player, isSlayLane = false,
  fromBankId = null, crystal = null,
  // creditBaseValue: XP-equivalent value of ONE credit at full scarcity
  // (stock -> 0). This is a small fraction of a typical task's total XP,
  // not a multiple of it -- a reroll credit is a minor, fast-regenerating
  // resource even when you're low, not a catastrophic one. Tune this to
  // your own risk tolerance; there's no game-derived number for it.
  creditStock = null, creditValue = null, creditBaseValue = 50
}) {
  const nodeIndex = buildActivityNodeIndex(data);

  const visibleValues = visibleOptions.map(opt => ({
    option: opt,
    ...taskOptionValue(C, data, opt, player, nodeIndex, { fromBankId, crystal })
  }));
  const bestVisible = visibleValues.reduce((a, b) => (b.effectiveXpPerHour > a.effectiveXpPerHour ? b : a));

  const rerollCost = isSlayLane ? C.SLAY_REROLL_COST : C.REROLL_COST;
  const freshDrawEV = expectedBestOfFreshDraw(C, data, candidatePool, player, nodeIndex, { fromBankId, crystal });

  const resolvedCreditValue = creditValue != null
    ? creditValue
    : (creditStock != null ? creditMarginalValue(creditStock, { rerollCost, baseValue: creditBaseValue }) : 0);
  const creditCostXp = rerollCost * resolvedCreditValue;
  const amortizationHours = bestVisible.effectiveSeconds / 3600;
  const creditCostRate = amortizationHours > 0 ? creditCostXp / amortizationHours : 0;
  const netRerollRate = freshDrawEV - creditCostRate;

  return {
    visibleValues,
    bestVisible,
    freshDrawEV,
    rerollCost,
    creditMarginalValue: resolvedCreditValue,
    creditCostXp,
    netRerollRate,
    recommendation: netRerollRate > bestVisible.effectiveXpPerHour ? 'reroll' : 'keep',
    marginXpPerHour: netRerollRate - bestVisible.effectiveXpPerHour
  };
}

module.exports = { taskOptionValue, expectedBestOfFreshDraw, creditMarginalValue, evaluateReroll };
