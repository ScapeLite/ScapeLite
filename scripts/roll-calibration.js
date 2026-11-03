#!/usr/bin/env node
// Roll model calibration (roadmap adv-003). READ ONLY: connects to the game page over CDP (9222), copies the numbers it needs
// (the Skills Customization state: levers, the last 200 non-slay tasks, activities and nodes; plus ScapeLite's task log and bridge getters)
// and prints how the roll model's predictions compare with what happened. Nothing is written to the game or to any file.
//
//   node scripts/roll-calibration.js            full report
//   node scripts/roll-calibration.js --json     the raw numbers as JSON
//
// Method and the numbers from 2026-10-29: docs/ROLL-MODEL-CALIBRATION.md
'use strict';

const WS = global.WebSocket;
const lm = (e) => Math.pow(1.25, e);          // lever multiplier (the game: Y.leverMultiplier)
const ew = (e) => 10 * Math.pow(1.25, e);     // node weight (the game: Y.effectiveWeight)

// ---------------------------------------------------------------- small statistics
function lgamma(z) { const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; z -= 1; let x = c[0]; for (let i = 1; i < 9; i++) x += c[i] / (z + i); const t = z + 7.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
function gammaP(a, x) {
  if (x <= 0) return 0; const gl = lgamma(a);
  if (x < a + 1) { let s = 1 / a, t = s, n = a; for (let i = 0; i < 500; i++) { n++; t *= x / n; s += t; if (Math.abs(t) < Math.abs(s) * 1e-12) break; } return s * Math.exp(-x + a * Math.log(x) - gl); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - gl) * h;
}
// chi-square with the smallest expected cells pooled until each has at least minE
function chi(obs, exp, minE) {
  minE = minE || 5; const cells = obs.map((o, i) => ({ o, e: exp[i] })).sort((a, b) => a.e - b.e), pool = { o: 0, e: 0 }, keep = [];
  cells.forEach((c) => { if (c.e < minE) { pool.o += c.o; pool.e += c.e; } else keep.push(c); });
  if (pool.e > 0) { if (pool.e < minE && keep.length) { const m = keep.shift(); pool.o += m.o; pool.e += m.e; } keep.push(pool); }
  let x = 0; keep.forEach((c) => { x += (c.o - c.e) * (c.o - c.e) / c.e; }); const k = keep.length - 1;
  return { x, df: k, p: k > 0 ? 1 - gammaP(k / 2, x / 2) : 1 };
}
const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = (a) => a.reduce((t, x) => t + x, 0) / Math.max(1, a.length);

// ---------------------------------------------------------------- reading the page
async function connect() {
  const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
  const pg = tabs.find((x) => x.type === 'page' && /scapewatch/i.test(x.url));
  if (!pg) throw new Error('no Scapewatch page on port 9222');
  const ws = new WS(pg.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = {}; ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (pend[d.id]) pend[d.id](d); });
  const call = (method, params) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  return { call, close: () => ws.close() };
}

// Same lookup the watcher uses for the bridge (Runtime.queryObjects): find the Skills Customization object S. Reading only.
const READ_S = `function(){var S=null;for(var i=0;i<this.length&&!S;i++){var x=this[i];try{if(x&&x.individualSkillCredits&&"totalSkillCredits" in x&&typeof x._resetAllSkillWeightLevers==="function")S=x}catch(e){}}
if(!S)return null;var j=function(v){return v==null?null:JSON.parse(JSON.stringify(v))};var o={};
o.weights=j(S.weights);o.hist=j(S.taskHistory);o.act=j(S.activitiesData);o.nodes=j(S.nodesData);o.tasksCompleted=j(S.tasksCompleted);
o.pct=S._calcSkillPercentages();o.hasQuests=S._hasViableQuestSteps();o.luck={};o.actMult={};o.level={};
Object.keys(S.activitiesData||{}).forEach(function(k){try{o.luck[k]=S._calcLuckChance(null,k)}catch(e){}try{o.actMult[k]=S._activityLeverMult(k)}catch(e){}try{o.level[k]=S._getPlayerLevel(k)}catch(e){}});
return JSON.stringify(o)}`;

async function load() {
  const c = await connect();
  try {
    await c.call('Runtime.enable', {});
    const proto = await c.call('Runtime.evaluate', { expression: 'Object.prototype', objectGroup: 'rollcal' });
    const qo = await c.call('Runtime.queryObjects', { prototypeObjectId: proto.result.result.objectId, objectGroup: 'rollcal' });
    const r = await c.call('Runtime.callFunctionOn', { objectId: qo.result.objects.objectId, functionDeclaration: READ_S, returnByValue: true });
    const S = r.result.result.value && JSON.parse(r.result.result.value);
    if (!S) throw new Error('the Skills Customization object was not found (is the game loaded?)');
    const ev = async (expression) => { const x = await c.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return x.result.result.value; };
    // per-activity task time and XP (the game's own projection, quantity 100), the speed, and the task log ScapeLite keeps
    const pairs = [...new Set(S.hist.map((e) => { const a = S.act[e.skill].activities.find((x) => x.name === e.activityName); return e.skill + '|' + a.id; }))];
    S.av = JSON.parse(await ev(`(async()=>{for(let i=0;i<40&&!(window.__ccBridge&&window.__ccBridge.activityValue);i++)await new Promise(r=>setTimeout(r,250));const o={};${JSON.stringify(pairs)}.forEach(k=>{const a=k.split('|');o[k]=window.__ccBridge.activityValue(a[0],a[1])});return JSON.stringify(o)})()`));
    S.speed = JSON.parse(await ev('JSON.stringify(window.__ccBridge.speed())'));
    S.log = JSON.parse((await ev("localStorage.getItem('cc-task-log')")) || '[]');
    const nodePairs = []; const ord = S.log.filter((e) => e.v === 2).sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < ord.length; i++) { const a = ord[i - 1], b = ord[i]; if (a.node && b.node && a.kind === 'skill' && b.kind === 'skill' && b.secs && Math.abs(b.ts - a.te) < 120) nodePairs.push({ from: a.node, to: b.node, moving: b.secs.moving }); }
    const dists = JSON.parse(await ev(`(async()=>JSON.stringify(${JSON.stringify(nodePairs.map((p) => [p.from, p.to]))}.map(p=>window.__ccBridge.dist(p[0],p[1]))))()`));
    nodePairs.forEach((p, i) => { p.dist = dists[i]; }); S.legs = nodePairs;
    const slayIds = [...new Set(S.log.filter((e) => e.kind === 'slay').map((e) => e.act))];
    S.mobXp = JSON.parse(await ev(`(async()=>{const o={};${JSON.stringify(slayIds)}.forEach(id=>o[id]=window.__ccBridge.mobXp(id));return JSON.stringify(o)})()`));
    return S;
  } finally { c.close(); }
}

// ---------------------------------------------------------------- the checks
function analyse(S) {
  const H = S.hist, N = H.length, out = {}; const sk = Object.keys(S.pct).filter((k) => k !== 'quests');
  // 1. which skill: displayed model (1.25^lever, the 15 rollable skills) against the chosen tasks
  const cnt = {}; sk.forEach((s) => { cnt[s] = 0; }); H.forEach((e) => { cnt[e.skill]++; });
  const tot = sk.reduce((t, s) => t + S.pct[s], 0), exp = sk.map((s) => N * S.pct[s] / tot), obs = sk.map((s) => cnt[s]);
  out.skill = { n: N, rows: sk.map((s, i) => { const p = S.pct[s] / tot; return { skill: s, observed: obs[i], expected: +exp[i].toFixed(1), z: +((obs[i] - exp[i]) / Math.sqrt(N * p * (1 - p))).toFixed(2) }; }), chi: chi(obs, exp), chiUniform: chi(obs, sk.map(() => N / sk.length)) };
  const ll = (r) => { const w = sk.map((s) => Math.pow(r, S.weights.skills[s] || 0)), T = w.reduce((a, b) => a + b); return sk.reduce((t, s, i) => t + cnt[s] * Math.log(w[i] / T), 0); };
  let best = 1, bl = -1e9; for (let r = 0.8; r <= 1.6; r += 0.001) { const l = ll(r); if (l > bl) { bl = l; best = r; } }
  let lo = null, hi = null; for (let r = 0.8; r <= 1.6; r += 0.001) if (ll(r) >= bl - 1.92) { if (lo == null) lo = r; hi = r; }
  out.leverBase = { mle: +best.toFixed(3), ci95: [+lo.toFixed(3), +hi.toFixed(3)], llAt125: +ll(1.25).toFixed(2), llBest: +bl.toFixed(2) };
  // 2. which activity inside the skill (open activities, weight = baseQty * 1.25^(lever * almanac multiplier))
  let llM = 0, llU = 0, onLocked = 0; const aO = [], aE = [];
  sk.forEach((s) => {
    const A = S.act[s].activities, lv = S.level[s], c = S.actMult[s];
    const w = A.map((a) => (a.level <= lv ? a.baseQty * lm(((S.weights.activities[s][a.id] || {}).weight || 0) * c) : 0)), W = w.reduce((a, b) => a + b, 0), open = A.filter((a) => a.level <= lv).length;
    const ob = A.map(() => 0), n = H.filter((e) => e.skill === s).length;
    H.filter((e) => e.skill === s).forEach((e) => { const i = A.findIndex((x) => x.name === e.activityName); ob[i]++; if (A[i].level > lv) onLocked++; llM += Math.log(Math.max(1e-6, w[i] / W)); llU += Math.log(1 / open); });
    A.forEach((a, i) => { aO.push(ob[i]); aE.push(n * w[i] / W); });
  });
  out.activity = { chi: chi(aO, aE), logLikPerTaskOverUniformOpen: +((llM - llU) / N).toFixed(3), tasksOnLockedActivities: onLocked };
  // 3. which node (among nodes that offer the activity, weight 10*1.25^lever), and whether activity-first or node-first explains the pairs better
  let llA = 0, llB = 0, dObs = 0, dExp = 0, dVar = 0, neg = [0, 0], pos = [0, 0];
  H.forEach((e) => {
    const s = e.skill, A = S.act[s].activities, a = A.find((x) => x.name === e.activityName), nodes = S.nodes[s], nd = nodes.find((x) => x.name === e.nodeName);
    const nl = (id) => S.weights.nodes[s][id] || 0, al = (id) => (S.weights.activities[s][id] || {}).weight || 0, lv = S.level[s], c = S.actMult[s], open = (x) => x.level <= lv;
    const sup = nodes.filter((x) => x.activities.includes(a.id)), Wn = sup.reduce((t, x) => t + ew(nl(x.id)), 0);
    const wa = A.map((x) => (open(x) ? x.baseQty * lm(al(x.id) * c) : 0)), Wa = wa.reduce((t, x) => t + x, 0);
    llA += Math.log(wa[A.indexOf(a)] / Wa * ew(nl(nd.id)) / Wn);
    const nOpen = nodes.filter((x) => x.activities.some((id) => open(A.find((y) => y.id === id)))), Wn2 = nOpen.reduce((t, x) => t + ew(nl(x.id)), 0);
    const acts = nd.activities.map((id) => A.find((y) => y.id === id)).filter(open), Wa2 = acts.reduce((t, x) => t + x.baseQty * lm(al(x.id) * c), 0);
    llB += Math.log(ew(nl(nd.id)) / Wn2 * a.baseQty * lm(al(a.id) * c) / Wa2);
    let em = 0, e2 = 0; sup.forEach((x) => { const p = ew(nl(x.id)) / Wn; em += p * x.nearestBankDistance; e2 += p * x.nearestBankDistance * x.nearestBankDistance; });
    dObs += nd.nearestBankDistance; dExp += em; dVar += e2 - em * em;
    sup.forEach((x) => { const p = ew(nl(x.id)) / Wn, l = nl(x.id); if (l < 0) neg[1] += p; else if (l > 0) pos[1] += p; });
    const l = nl(nd.id); if (l < 0) neg[0]++; else if (l > 0) pos[0]++;
  });
  out.node = { logLikActivityFirst: +llA.toFixed(1), logLikNodeFirst: +llB.toFixed(1), meanBankDistanceObserved: Math.round(dObs / N), meanBankDistanceModel: Math.round(dExp / N), zBankDistance: +((dObs - dExp) / Math.sqrt(dVar)).toFixed(2), onNegativeLeverNodes: { observed: neg[0], expected: +neg[1].toFixed(1) }, onPositiveLeverNodes: { observed: pos[0], expected: +pos[1].toFixed(1) } };
  // 4. quantity: uniform between half and one and a half times max(10, baseQty + 10 * quantity lever)
  const us = H.map((e) => { const a = S.act[e.skill].activities.find((x) => x.name === e.activityName), b = Math.max(10, a.baseQty + 10 * ((S.weights.activities[e.skill][a.id] || {}).quantity || 0)), lo2 = Math.round(b * 0.5), hi2 = Math.round(b * 1.5); return { u: (e.quantity - lo2) / (hi2 - lo2), out: e.quantity < lo2 || e.quantity > hi2 }; });
  const su = us.map((x) => Math.max(0, Math.min(1, x.u))).sort((a, b) => a - b); let D = 0; su.forEach((x, i) => { D = Math.max(D, (i + 1) / N - x, x - i / N); });
  out.quantity = { meanU: +mean(us.map((x) => x.u)).toFixed(3), ksD: +D.toFixed(3), ks95: +(1.358 / Math.sqrt(N)).toFixed(3), outsideRange: us.filter((x) => x.out).length };
  // 5. skilling task: realised XP and time against the model, from ScapeLite's task log (completed v2 entries)
  const sr = S.log.filter((e) => e.kind === 'skill' && e.v === 2 && e.completed && !e.partial && e.pred && e.pred.xp && e.pred.dash > 0 && e.secs && e.xp);
  // an entry whose prediction was made part way through (the remaining time only) shows a time ratio far from 1: leave those out of both numbers
  const pr = sr.map((e) => ({ lucky: e.lucky, xr: (e.xp[e.skill] || 0) / e.pred.xp, tr: (e.secs.total - (e.secs.moving || 0)) / e.pred.dash })).filter((x) => x.tr > 0.3 && x.tr < 5);
  const xr = pr.filter((x) => !x.lucky).map((x) => x.xr), tr = pr.map((x) => x.tr);
  const qs = (a) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => +quant(a, p).toFixed(2));
  out.skillingTask = { n: pr.length, xpRatioQuantiles_p10_p25_p50_p75_p90: qs(xr), actingTimeRatioQuantiles: qs(tr) };
  // 6. walking: the log's moving seconds for a leg against distance / speed
  const sps = S.speed.sps, legs = S.legs.filter((l) => l.dist != null);
  const walk = legs.filter((l) => l.dist > 0 && l.dist < 8000).map((l) => ({ pred: l.dist / sps, act: l.moving }));
  out.walking = { legs: legs.length, zeroDistanceLegsMedianSeconds: quant(legs.filter((l) => l.dist === 0).map((l) => l.moving), 0.5), walkedLegs: walk.length, actualOverPredicted_p25_p50_p75: [0.25, 0.5, 0.75].map((p) => +quant(walk.map((w) => w.act / w.pred), p).toFixed(2)), medianExtraSeconds: Math.round(quant(walk.map((w) => w.act - w.pred), 0.5)) };
  // 7. slay: XP per counted kill and time per task against the model, before and after 2026-10-22 11:00 UTC
  const cut = Date.UTC(2026, 9, 22, 11, 0) / 1000, sl = S.log.filter((e) => e.kind === 'slay' && e.xp && e.xp.slay > 0 && e.done >= e.qty - 2 && !e.partial && S.mobXp[e.act]).map((e) => { const m = S.mobXp[e.act], f = e.lucky ? 2 : 1; return { ts: e.ts, xr: e.xp.slay / f / (e.done * m.slay * (1 + m.bonus.slay)), tr: e.v === 2 && e.pred && e.pred.dash > 100 ? e.secs.total / e.pred.dash : null }; });
  const pre = sl.filter((x) => x.ts < cut), post = sl.filter((x) => x.ts >= cut);
  out.slay = { before: { n: pre.length, xpPerCountedKillMedian: +quant(pre.map((x) => x.xr), 0.5).toFixed(2) }, after: { n: post.length, xpPerCountedKillMedian: +quant(post.map((x) => x.xr), 0.5).toFixed(2), timeRatioMedian: +quant(post.filter((x) => x.tr && x.tr < 5).map((x) => x.tr), 0.5).toFixed(2), xpPerHourRatioMedian: +quant(post.filter((x) => x.tr && x.tr < 5).map((x) => x.xr / x.tr), 0.5).toFixed(2) } };
  // 8. lucky: share of completed tasks that were lucky against the game's chance (chosen tasks, so a player who prefers lucky ones inflates it)
  const sd = S.log.filter((e) => e.kind === 'skill' && e.completed && !e.partial);
  out.lucky = { skillingCompleted: sd.length, lucky: sd.filter((e) => e.lucky).length, expectedAtCurrentChances: +sd.reduce((t, e) => t + (S.luck[e.skill] || 0), 0).toFixed(1) };
  return out;
}

function print(o) {
  const f = (x) => JSON.stringify(x);
  console.log('SKILL MIX  n=' + o.skill.n + '  chi2 ' + o.skill.chi.x.toFixed(1) + ' df ' + o.skill.chi.df + ' p ' + o.skill.chi.p.toFixed(3) + '   (uniform: chi2 ' + o.skill.chiUniform.x.toFixed(1) + ' p ' + o.skill.chiUniform.p.toFixed(4) + ')');
  o.skill.rows.forEach((r) => console.log('  ' + r.skill.padEnd(9) + String(r.observed).padStart(3) + ' vs ' + String(r.expected).padStart(5) + '  z ' + r.z));
  console.log('LEVER BASE  best-fit ' + o.leverBase.mle + '  95% interval ' + o.leverBase.ci95.join(' to ') + '  (game: 1.25)');
  console.log('ACTIVITY    ' + f(o.activity));
  console.log('NODE        ' + f(o.node));
  console.log('QUANTITY    ' + f(o.quantity));
  console.log('SKILLING TASK (task log)  ' + f(o.skillingTask));
  console.log('WALKING     ' + f(o.walking));
  console.log('SLAY        ' + f(o.slay));
  console.log('LUCKY       ' + f(o.lucky));
}

module.exports = { analyse, chi };
if (require.main === module) {
  load().then((S) => { const o = analyse(S); if (process.argv.includes('--json')) console.log(JSON.stringify(o, null, 1)); else print(o); process.exit(0); })
    .catch((e) => { console.error('roll-calibration: ' + e.message); process.exit(1); });
}
