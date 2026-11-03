// Design Lab: stand-in for the game data bridge (window.__ccBridge, built by overlay/game-bridge.js from the live game) and the Route Advisor's public API,
// just rich enough that REAL plugin code (ui-queue.js) renders from the scenario's mock data. Read-only data, nothing to talk to.
(function () {
  'use strict';
  const snake = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const mockQ = () => window.Lab.M().queue;
  const opt = (o) => ({ act: snake(o.name), node: snake(o.place), kind: o.kind === 'kill' ? 'slay' : 'skill', skill: o.skill, qty: o.qty, timeSec: o.timeSec, totalXp: o.xp, xpHr: Math.round(o.xp / (o.timeSec / 3600)),
    success: 1, xpBonus: 0, lucky: !!o.lucky, boostDrops: o.boost ? 2 : 0, quest: o.quest ? [{ name: 'Ridgetop Ore' }] : [] });
  const slots = () => mockQ().filter((s) => !s.cur);
  window.__ccBridge = {
    ok: () => true,
    project() {
      const q = mockQ(), head = q.find((s) => s.cur);
      return { head: head ? Object.assign(opt(head.opts[0]), { totalXp: head.opts[0].xp }) : null, slots: slots().map((s, i) => ({ index: i, selected: 0, options: s.opts.map((o) => opt(o)) })) };
    },
    live() { const h = mockQ().find((s) => s.cur); if (!h) return null; const o = h.opts[0]; return { task: { activityId: snake(o.name), nodeId: snake(o.place), quantity: o.goal, progress: Math.round(o.goal * 0.38), nodeName: o.place, activityName: o.name } }; },
    hop(i) { const s = slots()[i]; if (!s || !s.walk) return null; return { d: s.walk.steps, th: 12000, tp: !!s.walk.tp }; },
    remain() { return 2393; },
    shortages() {
      const q = window.Lab.S.queue; if (q === 'empty' || q === 'few') return [];
      return [{ where: '4', need: 83, have: 41, save: 0.1, inputName: 'Moss' }, { where: '7', need: 183, have: 168, save: 0.2, inputName: 'Bright Essence' }];
    },
    queueCtl() { return { lane: window.Lab.S.mode === 'combat' ? 'slay' : 'skills', master: 'tier3', slayLevel: 69, credits: 633, costSkill: 25, costSlay: 25, auto: true }; },
    refreshQueuePanel() {},
  };
  window.__ccWalkingCountdown = { totalSpeed: 15.6 };   // steps per second: the walking pill shows steps / speed
  // the Route Advisor says: do task 2 as an alternative option and move task 3 to place 5
  window.__ccRouteAdvisor = { recommended() {
    const q = slots(); if (q.length < 4) return [];
    const key = (s) => s.opts.map((o) => snake(o.place)).sort().join(',');
    return [{ key: key(q[1]), nth: 0, node: snake(q[1].opts[q[1].opts.length - 1].place), pos: 4 }, { key: key(q[3]), nth: 0, node: snake(q[3].opts[0].place), pos: 2 }];
  } };
})();
