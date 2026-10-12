// Non-combat (gathering/processing) activity math — XP/hr for a given
// activity at a given player level. Every formula is called straight out
// of data/raw/Constants.js: activitySuccessXP, activityFailXP,
// actionDuration, actionDurationFinal, successRate, successSpeedReduction.

const { loadGameData } = require('./data');

/**
 * @param {object} C - Constants module
 * @param {object} activity - an entry from activities/<skill>.json's `activities[]`
 * @param {object} player - { level, sources (capes/pets/tools reduction count), toolReduction (seconds), flatReduction (seconds), lucky (bool) }
 */
function activityValue(C, activity, player) {
  const level = player.level || activity.levelRequired || 1;
  const sources = player.sources || 0;

  // activities/*.json ships successXP/failXP already tier-scaled (that IS
  // the output of activitySuccessXP/activityFailXP, baked in at data-gen
  // time) -- use them directly. Only fall back to computing from the
  // skill's baseXP if a record is somehow missing successXP.
  const successXP = activity.successXP ?? C.activitySuccessXP(player.skillBaseXP ?? 0, activity.tier);
  const failXP = activity.failXP ?? C.activityFailXP(successXP);

  const successPct = C.successRate(level, activity.levelRequired, sources);
  const speedBonus = C.successSpeedReduction(level, activity.levelRequired, sources);

  const base = C.actionDuration(level, activity.levelRequired);
  const duration = C.actionDurationFinal(base, sources, player.toolReduction || 0, (player.flatReduction || 0) + speedBonus);

  const successFrac = Math.min(1, successPct / 100);
  let xpPerAction = successFrac * successXP + (1 - successFrac) * failXP;
  if (player.lucky) xpPerAction *= C.LUCK_TASK_XP_MULT; // lucky: no failed actions + 2x XP

  const actionsPerHour = 3600 / duration;
  return {
    successXP, failXP, successPct, duration,
    xpPerAction, xpPerHour: xpPerAction * actionsPerHour, actionsPerHour
  };
}

/** Total XP and real-world seconds to complete `quantity` actions of a task. */
function taskCompletionValue(C, activity, player, quantity) {
  const v = activityValue(C, activity, player);
  return {
    ...v,
    quantity,
    totalXp: v.xpPerAction * quantity,
    totalSeconds: v.duration * quantity
  };
}

module.exports = { activityValue, taskCompletionValue };
