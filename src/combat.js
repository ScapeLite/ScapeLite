// Combat math for the planner. Every formula below is called straight out
// of the game's own data/raw/Constants.js (buildScore, hitChanceFromScores,
// maxHit, damageReduction, finalDamage, crit*, attackInterval) — nothing
// here is reimplemented or guessed.
//
// ONE assumption this file makes, because it isn't resolvable from the
// shipped client data: Constants.js documents that A / S_atk / D / S_def
// are "the one canonical" buildScore output, just fed different inputs,
// but the exact orchestration that wires mob/player stats into attacks
// per combat style (stab/slash/crush/range/magic) lives in server-only
// code (CombatSystem.js / combat-sim.js), not in the client bundle — that
// code has to stay server-side since combat is server-authoritative. The
// assumption: a defender's "Defend" (melee) or "Dodge" (ranged/magic)
// skill + the matching *Defense gear stat produces ONE score that is used
// BOTH as D (evasion, in hitChance) and S_def (in damage reduction) — the
// same number serving double duty, which is the simplest reading of
// "the one canonical way to produce A / S_atk / D / S_def". If real
// observed kill times don't match this module's predictions, that's the
// first thing to recalibrate — see calibrate() below.

const { loadGameData } = require('./data');

const STYLE_ACC_STAT = {
  stab: 'stabAttack', slash: 'slashAttack', crush: 'crushAttack',
  range: 'rangeAttack', magic: 'magicAttack'
};
const STYLE_DEF_STAT = {
  stab: 'stabDefense', slash: 'slashDefense', crush: 'crushDefense',
  range: 'rangeDefense', magic: 'magicDefense'
};
const STYLE_POWER_STAT = {
  stab: 'meleeStrength', slash: 'meleeStrength', crush: 'meleeStrength',
  range: 'rangeStrength', magic: 'magicStrength'
};
// Accuracy/power skill per style, and the defense skill a target uses
// against it (melee defends with Defend; ranged/magic dodge with Dodge).
const STYLE_ACC_SKILL = { stab: 'strike', slash: 'strike', crush: 'strike', range: 'sight', magic: 'focus' };
const STYLE_POWER_SKILL = { stab: 'heft', slash: 'heft', crush: 'heft', range: 'draw', magic: 'surge' };
const STYLE_DEF_SKILL = { stab: 'defend', slash: 'defend', crush: 'defend', range: 'dodge', magic: 'dodge' };

/**
 * One fighter's resolved combat scores for a given attack style.
 * @param {object} C - Constants module
 * @param {object} build - { skills: {strike,heft,sight,draw,focus,surge,dodge,defend,vigor,spirit,life}, gear: {stabAttack,...,meleeStrength,...,stabDefense,...}, bonuses, spirit, capePetBonus, critSources, weaponSpeed }
 * @param {string} style - stab|slash|crush|range|magic
 */
function resolveScores(C, build, style) {
  const skills = build.skills || {};
  const gear = build.gear || {};
  const bonuses = build.bonuses || 0;
  const spirit = !!build.spirit;
  const capePetBonus = build.capePetBonus || 0;

  const A = C.buildScore(skills[STYLE_ACC_SKILL[style]] || 0, gear[STYLE_ACC_STAT[style]] || 0, bonuses, spirit, capePetBonus);
  const sAtk = C.buildScore(skills[STYLE_POWER_SKILL[style]] || 0, gear[STYLE_POWER_STAT[style]] || 0, bonuses, spirit, capePetBonus);
  // Defense: same score serves as both D and S_def (see module doc comment).
  const def = C.buildScore(skills[STYLE_DEF_SKILL[style]] || 0, gear[STYLE_DEF_STAT[style]] || 0, bonuses, spirit, capePetBonus);

  return { A, sAtk, def };
}

/**
 * Expected (not simulated) damage-per-hit and hit chance between an
 * attacker and defender for one attack style. Crit is blended into the
 * expectation rather than rolled.
 */
function expectedAttack(C, attackerBuild, defenderBuild, style) {
  const atk = resolveScores(C, attackerBuild, style);
  const { def: defScore } = resolveScores(C, defenderBuild, style);

  const { chance: hitChance, overflow } = C.hitChanceFromScores(atk.A, defScore);
  const maxHit = C.maxHit(atk.sAtk);
  const floor = C.minHitFloor(overflow, maxHit);
  const rawDamage = (floor + maxHit) / 2; // uniform-roll expectation between floor and maxHit

  // Resolve the normal-hit and crit-hit outcomes SEPARATELY through
  // reduction+ceil before blending by crit chance. finalDamage uses
  // Math.ceil, which is nonlinear -- averaging raw damage first and
  // rounding once (the old approach here) silently swallows small crit
  // increases until they accumulate past an integer boundary, instead of
  // each discrete outcome rounding independently like it does in-game.
  const critSources = attackerBuild.critSources || 0;
  const critChance = C.critChance(critSources);
  const critMult = C.critDamageMult(critSources);
  const critRawDamage = C.critDamage(rawDamage, critMult);

  const reduction = C.damageReduction(defScore);
  const normalFinal = C.finalDamage(rawDamage, reduction);
  const critFinal = C.finalDamage(critRawDamage, reduction);
  const finalDamage = normalFinal * (1 - critChance) + critFinal * critChance;

  const vigorScore = attackerBuild.skills && attackerBuild.skills.vigor || 0;
  const interval = C.attackInterval(attackerBuild.weaponSpeed, vigorScore);

  return { hitChance, maxHit, rawDamage, finalDamage, interval, dps: (hitChance * finalDamage) / interval };
}

/**
 * Full expected-value fight summary: kill time, XP/hr split across the
 * three skills combat XP touches (chosen style's accuracy, Life, and the
 * style's defense skill — per Constants' COMBAT_XP_* multipliers), and
 * damage taken (so you can sanity-check survivability, not just speed).
 */
function simulateFight(C, { player, mob, style, mobLife, mobAttackStyle, mobWeaponSpeed }) {
  const attack = expectedAttack(C, player, mob, style);
  const killSeconds = mobLife / attack.dps;

  const xpPerDamage = C.COMBAT_XP_CHOSEN_MULTIPLIER + C.COMBAT_XP_LIFE_MULTIPLIER + C.COMBAT_XP_SECONDARY_MULTIPLIER;
  const totalDamageDealt = mobLife; // one full kill
  const xpPerHour = (totalDamageDealt * xpPerDamage) * (3600 / killSeconds);
  const chosenXpPerHour = totalDamageDealt * C.COMBAT_XP_CHOSEN_MULTIPLIER * (3600 / killSeconds);

  const incoming = expectedAttack(C, mob, player, mobAttackStyle || style);
  const damageTakenPerKill = incoming.dps * killSeconds;

  return {
    hitChance: attack.hitChance,
    dps: attack.dps,
    killSeconds,
    killsPerHour: 3600 / killSeconds,
    totalXpPerHour: xpPerHour,
    chosenSkillXpPerHour: chosenXpPerHour,
    damageTakenPerKill
  };
}

/** Convert a mobs.json mobType record into the {skills, gear, ...} shape expectedAttack/simulateFight expect. */
function mobToCombatant(mob) {
  return {
    skills: { strike: mob.strike, heft: mob.heft, defend: mob.defend, dodge: mob.dodge, life: mob.life, vigor: mob.vigor, spirit: mob.spirit },
    gear: {
      stabAttack: mob.stabAttack, slashAttack: mob.slashAttack, crushAttack: mob.crushAttack, rangeAttack: mob.rangeAttack, magicAttack: mob.magicAttack,
      meleeStrength: mob.meleeStrength, rangeStrength: mob.rangeStrength, magicStrength: mob.magicStrength,
      stabDefense: mob.stabDefense, slashDefense: mob.slashDefense, crushDefense: mob.crushDefense, rangeDefense: mob.rangeDefense, magicDefense: mob.magicDefense
    },
    bonuses: 0, spirit: false, capePetBonus: 0, critSources: 0, weaponSpeed: mob.attackSpeed
  };
}

module.exports = { resolveScores, expectedAttack, simulateFight, mobToCombatant, STYLE_ACC_STAT, STYLE_DEF_STAT, STYLE_POWER_STAT };
