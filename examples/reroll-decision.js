const { loadGameData } = require('../src/data');
const { evaluateReroll } = require('../src/reroll');

const data = loadGameData();
const C = data.constants;

const player = { level: 40, sources: 10, toolReduction: 0, flatReduction: 0, lucky: false, vigorLevel: 20 };
const FROM_BANK = 'cropshore_bank'; // where the player currently is

const candidatePool = ['mine', 'fish', 'forage', 'farm'].flatMap(skill =>
  data.activities.bySkill[skill].activities.map(a => ({ ...a, skill }))
);

function run(label, visibleActivityIds, quantity, extra = {}) {
  const visibleOptions = visibleActivityIds.map(activityId => ({ activityId, quantity }));
  const result = evaluateReroll(C, data, {
    visibleOptions, candidatePool, player, isSlayLane: false,
    fromBankId: FROM_BANK, ...extra
  });

  console.log(`\n=== ${label} ===`);
  for (const v of result.visibleValues) {
    const tp = v.teleportUsed ? ' [teleport]' : '';
    console.log(`  ${v.option.activityId} x${v.option.quantity}: ${v.totalXp.toFixed(0)} XP | travel ${v.travelDistance.toFixed(0)}px / ${v.travelSeconds.toFixed(0)}s${tp} | effective ${v.effectiveXpPerHour.toFixed(0)} XP/hr`);
  }
  console.log(`Best visible: ${result.bestVisible.option.activityId} (${result.bestVisible.effectiveXpPerHour.toFixed(0)} XP/hr effective)`);
  console.log(`Fresh-draw EV: ${result.freshDrawEV.toFixed(0)} XP/hr | credit marginal value: ${result.creditMarginalValue.toFixed(2)} XP/credit | reroll cost: ${result.rerollCost} credits (${result.creditCostXp.toFixed(0)} XP-equiv)`);
  console.log(`>> Recommendation: ${result.recommendation.toUpperCase()} (margin: ${result.marginXpPerHour.toFixed(0)} XP/hr)`);
}

// Case 1: a nearby-but-middling task bundle right next to the player's bank
run('Bundled near bank (plenty of credits)', ['raw_shrimp', 'raw_shrimp', 'raw_shrimp'], 80, { creditStock: 300 });

// Case 2: same nearby task bundle, but credits are nearly gone -- should
// make rerolling look worse (scarcity curve kicking in).
run('Bundled near bank (almost out of credits)', ['raw_shrimp', 'raw_shrimp', 'raw_shrimp'], 80, { creditStock: 2 });

// Case 3: a Perfect Crystal in hand -- long-distance tasks stop costing
// walking time at all, so raw XP/hr starts mattering more than proximity.
const bestMine = data.activities.bySkill.mine.activities
  .filter(a => a.levelRequired <= player.level).sort((a, b) => b.levelRequired - a.levelRequired)[0];
run('Same bundle, but with a Perfect Crystal active', [bestMine.activityId, bestMine.activityId, bestMine.activityId], 80, {
  creditStock: 300, crystal: { tier: 3, charges: 5 }
});
