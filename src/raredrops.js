// Rare-drop expected-value model. Answers: "is grinding this mob for its
// rare permanent-unlock drop (a crit-source tool, etc.) worth it, given
// how long the drop takes and how long I'll actually benefit from it
// afterward?" Pulls real drop odds from mobs.json encounters' rareDrops
// (oneInChance), and leans on combat.js/skilling.js for kill/action rates
// -- nothing here is a new formula, just the farm-time/payback math.

/** Expected rolls (kills/actions) for a 1-in-N drop: the mean of a geometric distribution. */
function expectedRollsForDrop(oneInChance) {
  return oneInChance;
}

function expectedFarmHours(oneInChance, rollsPerHour) {
  return expectedRollsForDrop(oneInChance) / rollsPerHour;
}

/**
 * The decision. A permanent unlock (e.g. a combat tool worth +1 crit
 * source) pays for itself over time -- this computes how long that takes.
 *
 * - farmActivityXpPerHour: your XP/hr AT the farm spot, right now.
 * - normalActivityXpPerHour: your XP/hr doing whatever you'd otherwise be
 *   doing. If the farm spot IS already your best activity, set this equal
 *   to farmActivityXpPerHour -- there's no opportunity cost, the drop is
 *   pure upside.
 * - bonusXpPerHourGain: the ongoing XP/hr improvement the unlock provides
 *   once owned (e.g. combat.js's simulateFight with critSources N vs N+1,
 *   or skilling.js's activityValue with sources N vs N+1 -- compute both
 *   and pass the delta).
 * - expectedRemainingHours: how much longer you expect to play this
 *   account. Without it, this can report payback time but not a flat
 *   yes/no -- that part is a genuinely personal question about how long
 *   you'll keep playing, not something derivable from game data.
 */
function evaluateRareDropFarm({ oneInChance, rollsPerHour, farmActivityXpPerHour, normalActivityXpPerHour, bonusXpPerHourGain, expectedRemainingHours = null }) {
  const farmHours = expectedFarmHours(oneInChance, rollsPerHour);
  const opportunityCostXp = Math.max(0, normalActivityXpPerHour - farmActivityXpPerHour) * farmHours;
  const paybackHours = bonusXpPerHourGain > 0 ? opportunityCostXp / bonusXpPerHourGain : Infinity;

  return {
    farmHours,
    opportunityCostXp,
    paybackHours,
    totalHoursUntilNetPositive: farmHours + paybackHours,
    worthIt: expectedRemainingHours != null ? (farmHours + paybackHours) <= expectedRemainingHours : null
  };
}

module.exports = { expectedRollsForDrop, expectedFarmHours, evaluateRareDropFarm };
