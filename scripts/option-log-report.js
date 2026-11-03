#!/usr/bin/env node
// Tests the roll against the Task Option Log (overlay/option-log.js -> State/option-log.json): what the game OFFERED, not what you chose.
//
//   node scripts/option-log-report.js                 report on State/option-log.json
//   node scripts/option-log-report.js path/to/log.json
//   node scripts/option-log-report.js --json
//
// Each test needs enough data first (MIN_DRAWS offered options of that kind); until then it says how far along it is. Reads only.
'use strict';
const fs = require('fs');
const { chi } = require('./roll-calibration.js');

const MIN_DRAWS = 300;      // offered options of a kind before a test is run
const SLAY_LUCKY_CAP = 0.03; // the game's cap for a lucky slay task (Constants LUCK_MAX_CHANCE_SLAY); the real chance is at most this

const sum = (a) => a.reduce((t, x) => t + x, 0);

// Normal approximation of the difference between a count and its expectation (variance = sum of p(1-p) over the draws)
const zOf = (obs, exp, varr) => (varr > 0 ? (obs - exp) / Math.sqrt(varr) : 0);

function analyse(rows) {
  const out = { rows: rows.length, tests: {} };
  const skill = [], slay = [];
  rows.forEach((r) => (r.o || []).forEach((o) => { (o.k === 'slay' ? slay : skill).push({ row: r, o }); }));
  out.offered = { skill: skill.length, slay: slay.length };
  const need = (n) => (n >= MIN_DRAWS ? null : { enough: false, have: n, need: MIN_DRAWS });

  // 1. which skill: every offered skilling option is one draw from the row's skill table (sp, in %, the 15 rollable skills)
  {
    const t = need(skill.length); if (t) out.tests.skillMix = t;
    else {
      const obs = {}, exp = {};
      skill.forEach(({ row, o }) => {
        if (!row.sp || row.sp[o.s] == null) return;
        const tot = sum(Object.values(row.sp));
        obs[o.s] = (obs[o.s] || 0) + 1;
        Object.keys(row.sp).forEach((k) => { exp[k] = (exp[k] || 0) + row.sp[k] / tot; });
      });
      const keys = Object.keys(exp);
      const c = chi(keys.map((k) => obs[k] || 0), keys.map((k) => exp[k]));
      out.tests.skillMix = { enough: true, draws: sum(Object.values(obs)), chi2: +c.x.toFixed(1), df: c.df, p: +c.p.toFixed(4), worst: keys.map((k) => ({ skill: k, observed: obs[k] || 0, expected: +exp[k].toFixed(1), z: +zOf(obs[k] || 0, exp[k], exp[k] * (1 - exp[k] / Math.max(1, sum(Object.values(obs))))).toFixed(2) })).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 5) };
    }
  }
  // 2. which activity (skilling) and which mob (slay): the table the option was drawn from is stored with it (pt, %)
  const within = (list, label) => {
    const t = need(list.length); if (t) { out.tests[label] = t; return; }
    const obs = [], exp = [];
    const groups = {};
    list.forEach(({ o }) => { if (!o.pt || o.pt[o.a] == null) return; (groups[o.s + '|' + JSON.stringify(Object.keys(o.pt).sort())] = groups[o.s + '|' + JSON.stringify(Object.keys(o.pt).sort())] || []).push(o); });
    Object.keys(groups).forEach((gk) => {
      const os = groups[gk], cats = Object.keys(os[0].pt);
      cats.forEach((cat) => { obs.push(os.filter((o) => o.a === cat).length); exp.push(sum(os.map((o) => o.pt[cat] / sum(Object.values(o.pt))))); });
    });
    const c = chi(obs, exp);
    out.tests[label] = { enough: true, draws: sum(obs), chi2: +c.x.toFixed(1), df: c.df, p: +c.p.toFixed(4) };
  };
  within(skill, 'activity'); within(slay, 'mob');
  // 3. lucky: skilling options carry the skill's own chance (lk); a slay option is checked against the game's cap
  {
    const t = need(skill.length); if (t) out.tests.luckySkilling = t;
    else {
      const ps = skill.filter(({ o }) => o.lk != null).map(({ o }) => o.lk), obs = skill.filter(({ o }) => o.lk != null && o.l).length, exp = sum(ps), v = sum(ps.map((p) => p * (1 - p)));
      out.tests.luckySkilling = { enough: true, draws: ps.length, observed: obs, expected: +exp.toFixed(1), z: +zOf(obs, exp, v).toFixed(2) };
    }
    const t2 = need(slay.length);
    if (t2) out.tests.luckySlay = t2;
    else { const obs = slay.filter(({ o }) => o.l).length, exp = slay.length * SLAY_LUCKY_CAP; out.tests.luckySlay = { enough: true, draws: slay.length, observed: obs, atMostExpected: +exp.toFixed(1), z: +zOf(obs, exp, exp * (1 - SLAY_LUCKY_CAP)).toFixed(2) }; }
  }
  // 4. are the two skilling options of a slot independent draws? (same skill twice, against the chance of that)
  {
    const pairs = rows.filter((r) => r.sp && (r.o || []).filter((o) => o.k !== 'slay').length === 2);
    const t = need(pairs.length * 2); if (t) out.tests.pairIndependence = t;
    else {
      let obs = 0, exp = 0, v = 0;
      pairs.forEach((r) => { const tot = sum(Object.values(r.sp)), p = sum(Object.values(r.sp).map((x) => (x / tot) * (x / tot))); exp += p; v += p * (1 - p); const [a, b] = r.o.filter((o) => o.k !== 'slay'); if (a.s === b.s) obs++; });
      out.tests.pairIndependence = { enough: true, slots: pairs.length, sameSkillObserved: obs, expected: +exp.toFixed(1), z: +zOf(obs, exp, v).toFixed(2) };
    }
  }
  // 5. what gets picked (not a test of the roll: the player's choice)
  {
    const picked = rows.filter((r) => r.o && r.o[r.sel]);
    const luckyRows = picked.filter((r) => r.o.some((o) => o.l));
    out.choice = { slots: picked.length, pickedSlay: picked.filter((r) => r.o[r.sel].k === 'slay').length, slotsWithLucky: luckyRows.length, luckyPicked: luckyRows.filter((r) => r.o[r.sel].l).length };
  }
  return out;
}

function print(a) {
  const f = (x) => JSON.stringify(x);
  console.log('OPTION LOG  ' + a.rows + ' sets of options, ' + a.offered.skill + ' skilling and ' + a.offered.slay + ' slay options offered');
  Object.keys(a.tests).forEach((k) => {
    const t = a.tests[k];
    console.log((k + '          ').slice(0, 16) + (t.enough === false ? 'not enough yet (' + t.have + ' of ' + t.need + ' options)' : f(t)));
  });
  console.log('what was picked ' + f(a.choice));
  console.log('How to read it: p below 0.01 (or |z| above 3) means the roll does not follow the game’s own odds table; many tests are run, so a single p near 0.05 is not news.');
}

module.exports = { analyse, MIN_DRAWS };
if (require.main === module) {
  const args = process.argv.slice(2), json = args.includes('--json');
  const fileArg = args.find((x) => !x.startsWith('--'));
  const file = fileArg || require('../overlay/paths').runtime('option-log.json');
  let doc; try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('option-log-report: cannot read ' + file + ' (' + (e.code || e.message) + '). The log fills while the game runs with the Task Option Log switched on.'); process.exit(1); }
  const a = analyse(Array.isArray(doc.rows) ? doc.rows : []);
  if (json) console.log(JSON.stringify(a, null, 1)); else print(a);
}
