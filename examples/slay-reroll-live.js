// Real test case: the player's actual skill levels and actual task queue,
// as read from a live screenshot. One honest gap: the screenshot showed
// skill levels and the task queue, but not equipped gear stats (that's a
// different panel) -- so weapon stats below are a placeholder (Copper
// Axe), clearly not the real loadout. Swap in real gear once that panel
// gets captured too.

const { loadGameData } = require('../src/data');
const { evaluateSlayReroll } = require('../src/slaytasks');

const data = loadGameData();
const C = data.constants;

// Read directly off the screenshot's Skills panel.
const realSkills = {
  strike: 19, heft: 21, defend: 13, dodge: 11, life: 20, vigor: 28, spirit: 16, slay: 17
};

const weapon = data.items.byId.copper_axe; // PLACEHOLDER -- real loadout not visible in the screenshot
const player = {
  skills: realSkills,
  gear: { slashAttack: weapon.slashAttack, meleeStrength: weapon.meleeStrength },
  bonuses: 0, spirit: false, capePetBonus: 0, critSources: 0,
  weaponSpeed: weapon.attackSpeed, style: 'slash'
};

// Read directly off the screenshot's Tasks panel.
const visibleOptions = [
  { taskId: 'feeble_zombie', quantity: 81 },
  { taskId: 'feeble_rat', quantity: 53 },
  { taskId: 'feeble_mushroom', quantity: 109 }
  // (the other feeble_mushroom entries are the same taskId at different
  // quantities -- included a couple for variety, not all 5)
];

const result = evaluateSlayReroll(C, data, {
  visibleOptions, player,
  fromBankId: null, // no travel data in the screenshot -- comparing action-time value only
  creditStock: 150
});

console.log('=== Your real queue, evaluated ===');
for (const v of result.visibleValues) {
  console.log(`  ${v.option.taskId} x${v.option.quantity}: ${v.totalXp.toFixed(0)} XP | ${v.fight.killsPerHour.toFixed(0)} kills/hr | ${v.effectiveXpPerHour.toFixed(0)} XP/hr effective`);
}
console.log(`\nBest visible: ${result.bestVisible.option.taskId} (${result.bestVisible.effectiveXpPerHour.toFixed(0)} XP/hr)`);
console.log(`Fresh-draw EV (theoretical pool of everything your Slay 17 qualifies for): ${result.freshDrawEV.toFixed(0)} XP/hr`);
console.log(`>> Recommendation: ${result.recommendation.toUpperCase()} (margin: ${result.marginXpPerHour.toFixed(0)} XP/hr)`);
