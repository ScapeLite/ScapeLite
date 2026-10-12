// Worked example answering: "is it worth going up one gear tier before
// fighting, or better to just grind at my current tier?"
//
// Replace PLAYER_SKILLS / MOB_ID / weapon ids with your real numbers —
// these are illustrative, not a recommendation.

const path = require('path');
const { loadGameData } = require('../src/data');
const { simulateFight } = require('../src/combat');

const data = loadGameData();
const C = data.constants;

const PLAYER_SKILLS = { strike: 10, heft: 10, defend: 10, dodge: 10, life: 10, vigor: 1, spirit: 0 };
const MOB_ID = 'feeble_acid_slime';
const WEAPON_CURRENT = 'copper_dagger';  // T0
const WEAPON_NEXT_TIER = 'aluminum_dagger'; // T3

function buildFromWeapon(weaponId) {
  const weapon = data.items.byId[weaponId];
  return {
    skills: PLAYER_SKILLS,
    gear: {
      stabAttack: weapon.stabAttack || 0,
      meleeStrength: weapon.meleeStrength || 0
      // Add armor stabDefense/slashDefense/etc here once you plug in real gear.
    },
    bonuses: 0,
    spirit: false,
    capePetBonus: 0,
    critSources: 0,
    weaponSpeed: weapon.attackSpeed
  };
}

const mob = data.mobs.byId[MOB_ID];
const mobBuild = {
  skills: { strike: mob.strike, heft: mob.heft, defend: mob.defend, dodge: mob.dodge, life: mob.life, vigor: mob.vigor, spirit: mob.spirit },
  gear: {
    slashAttack: mob.slashAttack, meleeStrength: mob.meleeStrength,
    stabDefense: mob.stabDefense, slashDefense: mob.slashDefense, crushDefense: mob.crushDefense,
    rangeDefense: mob.rangeDefense, magicDefense: mob.magicDefense
  },
  bonuses: 0, spirit: false, capePetBonus: 0, critSources: 0, weaponSpeed: mob.attackSpeed
};

for (const [label, weaponId] of [['T0 Copper Dagger (current)', WEAPON_CURRENT], ['T3 Aluminum Dagger (upgrade)', WEAPON_NEXT_TIER]]) {
  const player = buildFromWeapon(weaponId);
  const result = simulateFight(C, {
    player, mob: mobBuild, style: 'stab',
    mobLife: mob.life, mobAttackStyle: mob.attackStyle, mobWeaponSpeed: mob.attackSpeed
  });

  console.log(`\n=== ${label} vs ${mob.name} ===`);
  console.log(`Hit chance: ${(result.hitChance * 100).toFixed(1)}%`);
  console.log(`DPS: ${result.dps.toFixed(2)}`);
  console.log(`Kill time: ${result.killSeconds.toFixed(2)}s  (${result.killsPerHour.toFixed(0)} kills/hr)`);
  console.log(`Total combat XP/hr: ${result.totalXpPerHour.toFixed(0)}  |  Strike XP/hr: ${result.chosenSkillXpPerHour.toFixed(0)}`);
  console.log(`Expected damage taken per kill: ${result.damageTakenPerKill.toFixed(2)}`);
}
