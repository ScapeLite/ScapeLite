// Worked example: "the Culling Knife T1 drops 1-in-100 from Feeble
// Skeleton (mobs.json encounter 15) and is worth +1 permanent crit source
// forever. Is farming it worth the opportunity cost?"

const { loadGameData } = require('../src/data');
const { simulateFight } = require('../src/combat');
const { evaluateRareDropFarm } = require('../src/raredrops');

const data = loadGameData();
const C = data.constants;

const playerSkills = { strike: 26, heft: 26, defend: 26, dodge: 26, life: 26, vigor: 1, spirit: 0 };
const weapon = data.items.byId.copper_dagger;
const mob = data.mobs.byId.feeble_skeleton;
const encounter = data.mobs.encounters['15'];
const cullingKnife = encounter.rareDrops.find(d => d.itemId === 'culling_knife_t1');

function buildPlayer(critSources) {
  return {
    skills: playerSkills,
    gear: { stabAttack: weapon.stabAttack, meleeStrength: weapon.meleeStrength },
    bonuses: 0, spirit: false, capePetBonus: 0, critSources, weaponSpeed: weapon.attackSpeed
  };
}

const mobBuild = {
  skills: { strike: mob.strike, heft: mob.heft, defend: mob.defend, dodge: mob.dodge, life: mob.life, vigor: mob.vigor, spirit: mob.spirit },
  gear: { slashAttack: mob.slashAttack, meleeStrength: mob.meleeStrength, stabDefense: mob.stabDefense, slashDefense: mob.slashDefense, crushDefense: mob.crushDefense, rangeDefense: mob.rangeDefense, magicDefense: mob.magicDefense },
  bonuses: 0, spirit: false, capePetBonus: 0, critSources: 0, weaponSpeed: mob.attackSpeed
};

function fightResult(critSources) {
  return simulateFight(C, {
    player: buildPlayer(critSources), mob: mobBuild, style: 'stab',
    mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed
  });
}

const before = fightResult(0); // no combat tool yet
const after = fightResult(1);  // owns the Culling Knife T1 (+1 crit source)

console.log(`=== Feeble Skeleton (encounter 15), Culling Knife T1 (1 in ${cullingKnife.oneInChance}) ===`);
console.log(`Kill rate: ${before.killsPerHour.toFixed(0)} kills/hr`);
console.log(`Strike XP/hr without tool: ${before.chosenSkillXpPerHour.toFixed(0)} | with tool: ${after.chosenSkillXpPerHour.toFixed(0)} (+${(after.chosenSkillXpPerHour - before.chosenSkillXpPerHour).toFixed(0)}/hr from +1 crit source)`);

const result = evaluateRareDropFarm({
  oneInChance: cullingKnife.oneInChance,
  rollsPerHour: before.killsPerHour,
  farmActivityXpPerHour: before.chosenSkillXpPerHour,     // XP/hr AT this farm spot
  normalActivityXpPerHour: before.chosenSkillXpPerHour,   // assume this IS your current best spot -- no opportunity cost
  bonusXpPerHourGain: after.chosenSkillXpPerHour - before.chosenSkillXpPerHour,
  expectedRemainingHours: 200
});

console.log(`\nExpected farm time: ${result.farmHours.toFixed(1)} hours`);
console.log(`Opportunity cost: ${result.opportunityCostXp.toFixed(0)} XP (0 here -- this IS your grind spot already)`);
console.log(`Payback period after farming: ${result.paybackHours.toFixed(1)} hours`);
console.log(`Worth it over 200 more hours of play? ${result.worthIt}`);

console.log('\n--- Now the same drop, but it is NOT your best spot (you would normally be at a better one) ---');
const normalXpPerHour = before.chosenSkillXpPerHour * 1.6; // pretend your usual spot is 60% better XP/hr
const result2 = evaluateRareDropFarm({
  oneInChance: cullingKnife.oneInChance,
  rollsPerHour: before.killsPerHour,
  farmActivityXpPerHour: before.chosenSkillXpPerHour,
  normalActivityXpPerHour: normalXpPerHour,
  bonusXpPerHourGain: after.chosenSkillXpPerHour - before.chosenSkillXpPerHour,
  expectedRemainingHours: 200
});
console.log(`Opportunity cost: ${result2.opportunityCostXp.toFixed(0)} XP`);
console.log(`Payback period: ${result2.paybackHours.toFixed(1)} hours`);
console.log(`Worth it over 200 more hours of play? ${result2.worthIt}`);
