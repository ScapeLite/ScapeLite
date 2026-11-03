// Design Lab mock data: one consistent fictional player, shaped by the scenario state. No live game, no real player names.
(function () {
  'use strict';
  const SKILLS = [
    ['mine', 'Mine', 71, 0.62], ['smith', 'Smith', 68, 0.4], ['forage', 'Forage', 55, 0.9], ['fish', 'Fish', 60, 0.15], ['cook', 'Cook', 58, 0.7], ['farm', 'Farm', 64, 0.5],
    ['brew', 'Brew', 52, 0.33], ['craft', 'Craft', 49, 0.8], ['imbue', 'Imbue', 47, 0.55], ['vigor', 'Vigor', 66, 0.25], ['strike', 'Strike', 74, 0.45], ['defend', 'Defend', 72, 0.88],
    ['heft', 'Heft', 70, 0.1], ['sight', 'Sight', 40, 0.6], ['dodge', 'Dodge', 61, 0.37], ['focus', 'Focus', 59, 0.91], ['spirit', 'Spirit', 50, 0.2], ['surge', 'Surge', 45, 0.5],
    ['life', 'Life', 73, 0.77], ['luck', 'Luck', 38, 0.3], ['slay', 'Slay', 69, 0.58], ['delve', 'Delve', 31, 0.42], ['fortify', 'Fortify', 36, 0.66], ['barter', 'Barter', 44, 0.05],
  ].map((a) => ({ id: a[0], name: a[1], lvl: a[2], frac: a[3], xp: Math.round(Math.pow(a[2], 3.1) * 14 * (1 + a[3] * 0.06)), xpHr: Math.round(900 + a[2] * 140 + a[3] * 3000) }));
  const OPTION = (skill, name, place, qty, timeSec, xp, extra) => Object.assign({ skill, name, place, qty, timeSec, xp, kind: 'skill' }, extra || {});
  const QUEUE = [
    { cur: true, tier: 'T4', opts: [OPTION('farm', 'Battle Root', 'Hillfarm Greenhouse', 92, 720, 5167, { done: 0, goal: 92 })] },
    { tier: 'T1', opts: [OPTION('mine', 'Tin Ore', 'Windhollow Vein', 174, 960, 2574), OPTION('mine', 'Copper Ore', 'Windhollow Vein', 174, 940, 2490), OPTION('forage', 'Moss', 'Birchwood', 120, 840, 1900)], walk: { steps: 8449, min: 8, lvl: 3 } },
    { tier: 'T2', opts: [OPTION('vigor', 'Sit Ups', 'Timberchill Yard', 79, 480, 1540), OPTION('vigor', 'Push Ups', 'Ruincamp Pit', 98, 700, 2626)], walk: { steps: 5148, min: 5, lvl: 2 } },
    { tier: 'T3', opts: [OPTION('brew', 'Unf Swift Potion', 'Icelock Cauldron', 83, 660, 2889, { quest: true }), OPTION('brew', 'Calm Potion', 'Icelock Cauldron', 70, 600, 2100)], walk: { steps: 8615, min: 8, lvl: 3 } },
    { tier: 'T4', opts: [OPTION('vigor', 'Lunges', 'Seasonfort Trail', 205, 1500, 8030, { lucky: true })], walk: { steps: 5885, min: 5, lvl: 2 } },
    { tier: 'L40', opts: [OPTION('strike', 'Dustclaw Raider', 'Dustclaw Foundry', 150, 1320, 6100, { kind: 'kill' })], walk: { steps: 2964, min: 3, lvl: 1 } },
    { tier: 'T3', opts: [OPTION('imbue', 'Charged Bright Essence', 'Veilbridge Conduit', 183, 1740, 5198, { boost: true })], walk: { steps: 3030, min: 3, lvl: 1 } },
    { tier: 'T5', opts: [OPTION('mine', 'Titanium Ore', 'Drypocket Stone', 106, 840, 6470)], walk: { steps: 7206, min: 6, lvl: 4 } },
  ];
  const PARTY = [['Wulf', 'strike', 74, 'Ranger'], ['Ashen', 'defend', 72, 'Tank'], ['Mira', 'spirit', 66, 'Healer'], ['Brook', 'sight', 61, 'Mage']];
  const MSGS = [
    ['19:38', 'Global', 'Ashen', 'anyone for the Battlefrost raid?'], ['19:39', 'Clan', 'Wulf', 'ready in 2 min'], ['19:39', 'Global', 'Brook', 'selling Mithril Bar x176'],
    ['19:40', 'Friends', 'Mira', 'gz on 70 Mine!'], ['19:41', 'Clan', 'Wulf', 'bank is full again'], ['19:41', 'Global', 'Kest', 'LFG fortress run'],
  ];
  const ALERTS = [
    { tone: 'good', icon: 'mine', title: 'Quest ready', sub: 'Ridgetop Mine', go: 'Ridgetop Mine', n: 1 },
    { tone: 'accent', icon: 'luck', title: 'Lucky task reachable', sub: 'Lunges is 5 steps away', go: '', n: 3 },
    { tone: 'warn', icon: 'brew', title: 'Materials short', sub: 'Unf Swift Potion needs 12 more Moss', go: '', n: 1 },
  ];
  function build(S) {
    const hpMax = 840, hp = S.hp === 'low' ? Math.round(hpMax * 0.28) : S.hp === 'critical' ? Math.round(hpMax * 0.09) : hpMax - 96;
    const q = S.queue === 'empty' ? [] : S.queue === 'few' ? QUEUE.slice(0, 3) : S.queue === 'overfull' ? QUEUE.concat(QUEUE.slice(1)).slice(0, 14) : QUEUE;
    return {
      skills: SKILLS, queue: q, party: PARTY, msgs: MSGS, hp, hpMax, spirit: 61, spiritMax: 80, vigor: 78,
      gold: 3709221, gems: 48, xpHr: 24800, steps: 46529, totalSec: q.reduce((t, s) => t + s.opts[0].timeSec, 0),
      alerts: S.alert === 'firing' ? ALERTS : S.alert === 'one' ? ALERTS.slice(0, 1) : [],
      location: S.mode === 'dungeon' ? 'Battlefrost Smithy (raid)' : S.mode === 'fortress' ? 'Fortress, wave 14' : 'Hillfarm Greenhouse',
      task: S.mode === 'combat' ? 'Dustclaw Raider' : 'Battle Root',
    };
  }
  window.LabMock = { SKILLS, QUEUE, PARTY, MSGS, ALERTS, build, OPTION };
})();
