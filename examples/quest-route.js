const { loadGameData } = require('../src/data');
const { greedyQuestRoute, naiveQuestRoute } = require('../src/questoptimizer');

const data = loadGameData();

// A fresh-ish character: decent all-round levels, nothing done yet.
const playerLevels = Object.fromEntries(data.skills.list.map(s => [s.id, 40]));
const fromBankId = 'longha_bank'; // wherever they currently are

const opts = { completedQuestIds: new Set(), playerLevels, fromBankId, maxQuests: 15 };

const greedy = greedyQuestRoute(data, opts);
const naive = naiveQuestRoute(data, opts);

function summarize(label, route) {
  const total = route.reduce((s, r) => s + r.travelDistance, 0);
  console.log(`\n=== ${label} (${route.length} quests, ${total.toFixed(0)}px total travel) ===`);
  for (const r of route) console.log(`  ${r.name} (+${r.travelDistance.toFixed(0)}px)`);
}

summarize('Greedy nearest-next route', greedy);
summarize('Naive data-order route', naive);

const greedyTotal = greedy.reduce((s, r) => s + r.travelDistance, 0);
const naiveTotal = naive.reduce((s, r) => s + r.travelDistance, 0);
console.log(`\nTravel saved by sequencing: ${(naiveTotal - greedyTotal).toFixed(0)}px (${((1 - greedyTotal / naiveTotal) * 100).toFixed(0)}% less)`);
