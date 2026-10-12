// Loads Scapewatch's own static reference data (extracted read-only from
// the installed Steam client's app.asar — see ../data/raw/README.md) into
// indexed, easy-to-query structures. No live game/account access here;
// everything in data/raw ships to every player's disk as part of the game
// itself.

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
}

function indexById(list, idField = 'id') {
  const out = {};
  for (const item of list) out[item[idField]] = item;
  return out;
}

function loadGameData() {
  const constants = require(path.join(RAW_DIR, 'Constants.js'));

  const nodesRaw = readJson('nodes.json');
  const skillsRaw = readJson('skills.json');
  const questsRaw = readJson('quests.json');
  const xpTableRaw = readJson('xp-table.json');
  const pathsRaw = readJson('paths.json');
  const itemsRaw = readJson('items.json');
  const mobsRaw = readJson('mobs.json');
  const chestLootRaw = readJson('chest-loot.json');
  const raidsRaw = readJson('raids.json');
  const raidTreesRaw = readJson('raid-trees.json');
  const badgesRaw = readJson('badges.json');

  const activitySkillFiles = [
    'bard', 'barter', 'brew', 'cook', 'craft', 'discover', 'farm',
    'fish', 'forage', 'imbue', 'invoke', 'mine', 'plunder', 'smith', 'vigor'
  ];
  const activitiesBySkill = {};
  const activitiesById = {};
  for (const skill of activitySkillFiles) {
    const data = readJson(path.join('activities', `${skill}.json`));
    activitiesBySkill[skill] = data;
    for (const act of data.activities || []) {
      activitiesById[act.activityId] = { ...act, skill };
    }
  }

  return {
    constants,
    nodes: {
      list: nodesRaw.nodes,
      byId: indexById(nodesRaw.nodes)
    },
    skills: {
      list: skillsRaw.skills,
      byId: indexById(skillsRaw.skills)
    },
    quests: {
      list: questsRaw.quests,
      byId: indexById(questsRaw.quests)
    },
    xpForLevel: xpTableRaw.xpForLevel,
    bankPaths: pathsRaw.bankPaths,
    items: {
      byId: itemsRaw.items
    },
    mobs: {
      byId: mobsRaw.mobTypes,
      encounters: mobsRaw.encounters
    },
    chestLoot: chestLootRaw,
    raids: raidsRaw,
    raidTrees: raidTreesRaw,
    badges: badgesRaw.badges,
    activities: {
      bySkill: activitiesBySkill,
      byId: activitiesById
    }
  };
}

module.exports = { loadGameData, RAW_DIR };

// Smoke test: `node src/data.js` prints a quick sanity summary so a data
// refresh (after a game patch) can be eyeballed for obvious breakage.
if (require.main === module) {
  const d = loadGameData();
  console.log('Skills:', d.skills.list.length);
  console.log('Nodes:', d.nodes.list.length);
  console.log('Quests:', d.quests.list.length);
  console.log('Items:', Object.keys(d.items.byId).length);
  console.log('Mob types:', Object.keys(d.mobs.byId).length);
  console.log('Bank-to-bank paths:', Object.keys(d.bankPaths).length);
  console.log('Activities loaded:', Object.keys(d.activities.byId).length);
  console.log('Max skill level (xp table):', Object.keys(d.xpForLevel).length);
  console.log('REROLL_COST:', d.constants.REROLL_COST, '| SLAY_REROLL_COST:', d.constants.SLAY_REROLL_COST);
}
