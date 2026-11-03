// ScapeLite Drop Luck Tracker. Display only: how lucky your rare drops and pets have been.
// The game already keeps your kill count per mob and the first time you got each collectible drop, so nothing is logged here.
// For a drop of "1 in N per kill" and k kills, the chance of STILL not having it is (1 - 1/N)^k (the "dry" chance). Adding up
// every drop gives the number of drops you were expected to have, against the number you do have: that is the luck rating.
// Pets use the game's own rates: 1 in 10,000,000 XP gained in that skill, All-Skills pet 1 in 100,000,000 XP gained in any skill.
// Shiny versions (pets and lucky tools) are the same roll made 5 times rarer: 1 in 50,000,000, All-Skills 1 in 500,000,000. Published base rates only: a luck bonus is not part of them, so it can make you look luckier.
// Opens from the ScapeLite menu (left icon strip). Stack drops (food, materials) are not in the collection log and are left out.
// Tabs (default order, draggable): Overview (luck by category + most overdue), Pets & Tools (Pets | Tools | All), Unlocks (filters + search), Mobs, Delve (the dungeons and the Chaos Dungeon), Fortress. Every drop with a 1-in-N rate has a graph button: the chance of having it by kill count.
(function () {
  'use strict';
  const NS = '__ccDropLuck';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS_POS = 'cc-droplog-pos', LS_TAB = 'cc-droplog-tab', LS_OPEN = 'cc-droplog-open';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('dropLuckEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.dropState ? b : null; };
  const MAINS = [['over', 'Overview'], ['detail', 'Detailed']];
  const TABS = [['pets', 'Pets & Tools'], ['unlock', 'Unlocks'], ['mob', 'Mobs'], ['delve', 'Delve'], ['fortress', 'Fortress']];   // the sub-tabs of Detailed, in the default order; the user can drag them into another order   // this is the default order; the user can drag the tabs into another one
  // ---- nav (pure; the test loads this block too)
  const TAB_ALIAS = { luck: 'over', raid: 'delve', raids: 'delve' };   // the Luck tab is folded into Overview and Raids became Delve; old saved tabs and callers still land somewhere
  const tabKey = (k) => TAB_ALIAS[k] || k;
  // What to open from the saved main tab and saved sub-tab: a saved main tab wins; otherwise a former tab that is now a sub-tab opens Detailed on it, anything else Overview.
  const navFromSaved = (savedTab, savedMain, subs) => { const t = tabKey(savedTab), isSub = subs.includes(t); return { main: savedMain === 'over' || savedMain === 'detail' ? savedMain : (isSub ? 'detail' : 'over'), sub: isSub ? t : subs[0] }; };
  // ---- end nav
  let tab = 'over', main = 'over', subTab = 'pets', open = false, more = false;   // tab = what is shown: 'over' or the open sub-tab
  const LS_MOBS = 'cc-droplog-mobs';
  let mp = { q: '', tier: 'all', status: 'all', sort: 'kills', raid: 'all', dq: '' };
  try { Object.assign(mp, JSON.parse(localStorage.getItem(LS_MOBS) || '{}')); } catch (e) {}
  const saveMobPrefs = () => { try { localStorage.setItem(LS_MOBS, JSON.stringify(mp)); } catch (e) {} };
  const LS_UNL = 'cc-droplog-unlocks', LS_GRAPHS = 'cc-droplog-graphs', LS_ORDER = 'cc-droplog-order', LS_SUB = 'cc-droplog-sub', LS_MAIN = 'cc-droplog-main', LS_PF = 'cc-droplog-pets';
  let pf = { q: '', st: 'all' };   // Pets & Tools search and owned / missing filter
  try { Object.assign(pf, JSON.parse(localStorage.getItem(LS_PF) || '{}')); } catch (e) {}
  const savePf = () => { try { localStorage.setItem(LS_PF, JSON.stringify(pf)); } catch (e) {} };
  let sub = 'pets';   // Pets & Tools: which part is shown (pets, tools or all), remembered
  try { const v = localStorage.getItem(LS_SUB); if (v === 'pets' || v === 'tools' || v === 'all') sub = v; } catch (e) {}
  const saveSub = () => { try { localStorage.setItem(LS_SUB, sub); } catch (e) {} };
  let up = { q: '', status: 'missing', kind: 'all', tier: 'all', skill: 'all', src: 'all' };   // Unlocks tab filters (remembered; nothing personal in them)
  try { Object.assign(up, JSON.parse(localStorage.getItem(LS_UNL) || '{}')); } catch (e) {}
  const saveUp = () => { try { localStorage.setItem(LS_UNL, JSON.stringify(up)); } catch (e) {} };
  const graphOn = new Set();   // drops whose graph is switched on, remembered
  try { JSON.parse(localStorage.getItem(LS_GRAPHS) || '[]').forEach((k) => graphOn.add(k)); } catch (e) {}
  const saveGraphs = () => { try { localStorage.setItem(LS_GRAPHS, JSON.stringify(Array.from(graphOn).slice(-200))); } catch (e) {} };
  // Old saved tab keys map on: the Luck tab became Overview, Raids became Delve, and any former tab is now a sub-tab of Detailed (a saved one opens Detailed).
  try {
    const nv = navFromSaved(localStorage.getItem(LS_TAB), localStorage.getItem(LS_MAIN), TABS.map((x) => x[0]));
    subTab = nv.sub; main = nv.main;
    open = localStorage.getItem(LS_OPEN) === '1';
  } catch (e) {}
  tab = main === 'over' ? 'over' : subTab;
  const saveNav = () => { try { localStorage.setItem(LS_MAIN, main); localStorage.setItem(LS_TAB, subTab); } catch (e) {} };
  function go(k) {       // show a tab by its old-style key: 'over' or any sub-tab
    k = tabKey(k); more = false;
    if (k === 'over' || k === 'detail') main = k; else if (TABS.some((x) => x[0] === k)) { main = 'detail'; subTab = k; } else return;
    tab = main === 'over' ? 'over' : subTab; saveNav();
  }
  if (mp.raid === 'gauntlet') mp.raid = 'all';

  const style = document.createElement('style');
  style.id = 'cc-droplog-style';
  style.textContent = `
#cc-droplog .tabs{padding:0 10px;flex:none}
#cc-droplog .hero{padding:12px 14px;border-radius:10px;background:var(--cc-bg-2);border:1px solid var(--cc-border);margin-top:6px}
#cc-droplog .luckline{margin-top:6px;font-size:12.5px;line-height:1.3}
#cc-droplog .luckline .v{font-weight:700}
#cc-droplog .subtabs{padding:0 10px;flex:none}
#cc-droplog .subtabs .cc-tab{font-size:12.5px}
#cc-droplog .hero .v{font-size:22px;font-weight:800;letter-spacing:.01em}
#cc-droplog .hero .p{color:var(--cc-text-dim);font-size:12.5px;margin-top:1px}
#cc-droplog .meter{position:relative;height:8px;border-radius:4px;margin:10px 0 3px;background:linear-gradient(90deg,#ff6a4d,#ffb84a 35%,#ffe27a 50%,#8fe06a 70%,#3fd98a)}
#cc-droplog .meter i{position:absolute;top:-4px;width:4px;height:16px;border-radius:2px;background:var(--cc-text);box-shadow:0 0 0 2px var(--cc-bg);transform:translateX(-2px)}
#cc-droplog .ends{display:flex;justify-content:space-between;color:var(--cc-text-faint);font-size:11px}
#cc-droplog .stats{display:flex;gap:6px;margin-top:10px}
#cc-droplog .stats div{flex:1;padding:5px 8px;border-radius:7px;background:var(--cc-bg-2);text-align:center}
#cc-droplog .stats b{display:block;font-size:16px;color:var(--cc-text)}
#cc-droplog .stats span{color:var(--cc-text-dim);font-size:11.5px}
#cc-droplog .good{color:var(--cc-good)}#cc-droplog .bad{color:var(--cc-bad)}#cc-droplog .mid{color:var(--cc-accent)}
#cc-droplog h5{margin:8px 0 0;color:var(--cc-text-faint);font-size:11.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:700}
#cc-droplog .row{padding:6px 9px;border-radius:8px;background:var(--cc-bg-2);border-left:3px solid var(--cc-border-strong)}
#cc-droplog .row.r{border-left-color:var(--cc-bad)}#cc-droplog .row.o{border-left-color:var(--cc-warn)}#cc-droplog .row.y{border-left-color:var(--cc-accent)}#cc-droplog .row.g{border-left-color:var(--cc-good)}
#cc-droplog .row .t{color:var(--cc-text);font-weight:650}
#cc-droplog .row .t em{font-style:normal;color:var(--cc-text-dim);font-weight:400}
#cc-droplog .row .s{color:var(--cc-text-dim);font-size:12.5px;margin-top:1px}
#cc-droplog .row .dry{float:right;font-weight:700;font-size:13px}
#cc-droplog .more{align-self:center;margin-top:2px;background:var(--cc-bg-3);color:var(--cc-text-dim);border:1px solid var(--cc-border);border-radius:16px;padding:4px 16px;font:inherit;font-size:13px;cursor:pointer}
#cc-droplog .more:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
#cc-droplog details{border-radius:8px;background:var(--cc-bg-2);padding:5px 9px}
#cc-droplog details[open]{background:var(--cc-bg-3)}
#cc-droplog summary{cursor:pointer;display:flex;gap:8px;align-items:baseline;list-style:none}
#cc-droplog summary::-webkit-details-marker{display:none}
#cc-droplog summary::before{content:'▸';color:var(--cc-text-faint);font-size:11px;width:10px}
#cc-droplog details[open] summary::before{content:'▾'}
#cc-droplog summary .n{flex:1;color:var(--cc-text);font-weight:600}
#cc-droplog summary .c{color:var(--cc-text-dim);font-size:12.5px}
#cc-droplog details .d{padding:2px 0 2px 18px;font-size:13px;color:var(--cc-text-dim)}
#cc-droplog .search{width:100%;box-sizing:border-box;background:var(--cc-bg-2);color:var(--cc-text);border:1px solid var(--cc-border);border-radius:8px;padding:6px 10px;font:inherit;margin-top:6px;outline:none}
#cc-droplog .search:focus{border-color:var(--cc-accent)}
#cc-droplog .chip{padding:6px 9px;border-radius:8px;background:var(--cc-bg-2);border-left:3px solid var(--cc-border-strong);min-width:0}
#cc-droplog .chip.g{border-left-color:var(--cc-good);background:color-mix(in srgb,var(--cc-good) 8%,var(--cc-bg-2))}
#cc-droplog .chip .t{color:var(--cc-text);font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-droplog .chip .s{color:var(--cc-text-dim);font-size:12px}
#cc-droplog .mk{display:inline-block;width:1.15em;font-weight:800}
#cc-droplog .mk.ok{color:var(--cc-good)}
#cc-droplog .mk.no{color:var(--cc-bad)}
#cc-droplog .note{color:var(--cc-text-faint);font-size:12px;padding-top:4px}
#cc-droplog .row.mini .t{display:flex;flex-direction:row-reverse;justify-content:space-between}
#cc-droplog .meter.sm{height:5px;margin:7px 0 4px}
#cc-droplog .meter.sm i{top:-3px;height:11px;width:3px}
#cc-droplog .mobbar{display:flex;flex-direction:column;gap:6px;margin-top:6px}
#cc-droplog .mobsel{display:flex;gap:5px}
#cc-droplog .mobsel .sel{flex:1;min-width:0;background:var(--cc-bg-2);color:var(--cc-text);border:1px solid var(--cc-border);border-radius:8px;padding:4px 6px;font:inherit;font-size:12.5px;outline:none}
#cc-droplog details{border:1px solid var(--cc-border)}
#cc-droplog .pbar{height:3px;border-radius:2px;background:#26263a;margin:5px 0 3px;overflow:hidden}
#cc-droplog .pbar i{display:block;height:100%}
#cc-droplog .shinybar{display:flex;gap:9px;align-items:flex-start;padding:8px 11px;border-radius:9px;background:linear-gradient(135deg,#231f33,#1a1826);border:1px solid #3a3358;color:#b9b3d6;font-size:12.5px;margin-top:6px}
#cc-droplog .shinybar .sp{font-size:18px;line-height:1.1}
#cc-droplog .pgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#cc-droplog .pcard{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:9px;background:var(--cc-bg-2);border:1px solid #26263a;min-width:0}
#cc-droplog .pcard.own{border-color:#2d5a3c;background:color-mix(in srgb,var(--cc-good) 8%,var(--cc-bg-2))}
#cc-droplog .pcard.shiny{border-color:var(--cc-accent);background:linear-gradient(120deg,#2a2412,#1e1a2e,#2a2412);background-size:200% 100%;animation:ccShimmer 4s linear infinite;box-shadow:0 0 10px rgba(255,210,74,.28)}
@keyframes ccShimmer{to{background-position:-200% 0}}
#cc-droplog .pic{position:relative;width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center}
#cc-droplog .pic img{width:32px;height:32px;image-rendering:pixelated;opacity:.55;filter:grayscale(.7)}
#cc-droplog .pcard.own .pic img,#cc-droplog .pcard.shiny .pic img{opacity:1;filter:none}
#cc-droplog .pic .spk{position:absolute;right:-4px;top:-5px;font-size:13px}
#cc-droplog .pt{min-width:0;flex:1}
#cc-droplog .pn{color:var(--cc-text);font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13.5px}
#cc-droplog .ps{color:var(--cc-text-dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-droplog .ps.shn{color:#a89fd0}
#cc-droplog .ps.good{color:var(--cc-good)}
@media (prefers-reduced-motion:reduce){#cc-droplog .pcard.shiny{animation:none}}
#cc-droplog .tabs{position:relative}
#cc-droplog .tabs .cc-tab{touch-action:none}
#cc-droplog .tabs .cc-tab.dragging{opacity:.5}
#cc-droplog .tabmark{position:absolute;top:3px;bottom:3px;width:3px;margin-left:-1px;border-radius:2px;background:var(--cc-accent);pointer-events:none;box-shadow:0 0 6px var(--cc-accent)}
#cc-droplog .gbtn{float:right;margin-left:6px;cursor:pointer}
#cc-droplog .gbox{margin:4px 0 6px;padding:6px 8px;border-radius:8px;background:var(--cc-bg);border:1px solid var(--cc-border)}
#cc-droplog .dgraph{display:block;width:100%;height:auto;max-height:150px}
#cc-droplog .dgraph text{font-family:inherit}
#cc-droplog .gcap{color:var(--cc-text-dim);font-size:12px;margin-top:3px}
#cc-droplog .catrow{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
#cc-droplog .catchip{background:var(--cc-bg-2);color:var(--cc-text-dim);border:1px solid var(--cc-border);border-radius:14px;padding:2px 10px;font:inherit;font-size:12.5px;cursor:pointer}
#cc-droplog .catchip:hover{color:var(--cc-text)}
#cc-droplog .catchip.on{color:var(--cc-accent);border-color:var(--cc-accent);background:color-mix(in srgb,var(--cc-accent) 10%,var(--cc-bg-2))}
#cc-droplog .tp{display:inline-block;margin:1px 4px 1px 0;padding:0 7px;border-radius:9px;background:var(--cc-bg-3);color:var(--cc-text-dim);font-size:11.5px;white-space:nowrap}
#cc-droplog .tp.own{color:var(--cc-good);background:color-mix(in srgb,var(--cc-good) 12%,var(--cc-bg-3))}
#cc-droplog .fam{padding:3px 0;border-bottom:1px solid var(--cc-border)}
#cc-droplog .fam b{color:var(--cc-text);font-weight:600;margin-right:6px}
#cc-droplog .sub{color:var(--cc-text-faint);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;margin:7px 0 2px;font-weight:700}
`;
  document.head.appendChild(style);
  // Chrome (header, drag, memory, scale, layering) comes from the UI kit; the tab row sits between its header and body.
  const UI = window.__ccUI;
  if (!UI) return 'cc drop-luck: UI kit not loaded';
  const P = UI.panel({ id: 'cc-droplog', title: 'Drop Luck Tracker', width: 420, height: 'min(580px,74vh)', closable: true, collapsible: true, resizable: true, legacyPosKey: LS_POS, onClose: () => setOpen(false) });
  const el = P.el;
  const tabsRow = document.createElement('div'); tabsRow.className = 'tabs cc-tabs'; el.insertBefore(tabsRow, P.body);
  const subRow = document.createElement('div'); subRow.className = 'tabs cc-tabs subtabs'; el.insertBefore(subRow, P.body);   // the sub-tabs of Detailed
  if (UI.ccTip) UI.ccTip(el, (t) => (t._graph ? graphCard(t._graph.n, t._graph.k) : null));   // hover card for the chart buttons
  { const sv0 = UI.store.get('panel:cc-droplog', null); if (sv0 && sv0.open !== undefined) open = !!sv0.open; else P.setOpen(open); }
  function setOpen(v) { open = !!v; P.setOpen(open); render(); }

  // ---- maths (pure: no page access; scripts/test-drop-luck.js loads everything between this line and the end-maths line)
  const erf = (x) => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
  const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const dry = (n, k) => Math.pow(1 - 1 / n, k);                       // chance of still not having it
  const pct = (p) => (p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p >= 0.0001 ? (p * 100).toFixed(2) : '<0.01') + '%';
  const num = (n) => Math.round(n).toLocaleString('en-US');
  // The same number the other way round, which reads better: q = chance of STILL being without the drop (the old "dry %"), so 1 - q of the players would already have it.
  // "1.3% dry" meant: only 1.3% of players are still without it after this many kills = you are unlucky; "98.7% would have it" says it directly.
  const have = (q) => { const p = 1 - q; return (p >= 0.9999 ? '>99.99' : p >= 0.999 ? (p * 100).toFixed(2) : p >= 0.1 ? (p * 100).toFixed(1) : (p * 100).toFixed(p >= 0.01 ? 1 : 2)) + '%'; };
  const killsFor = (n, p) => (n > 1 ? Math.ceil(Math.log(1 - p) / Math.log(1 - 1 / n)) : 1);   // kills after which a share p of players would have the drop
  const haveTip = (n, k) => { const q = dry(n, k); return 'After ' + num(k) + ' kills at 1 in ' + num(n) + ', ' + have(q) + ' of players would already have this drop (you are in the unluckiest ' + pct(q) + '). Half of the players have it by ' + num(killsFor(n, 0.5)) + ' kills, 90% by ' + num(killsFor(n, 0.9)) + ', 95% by ' + num(killsFor(n, 0.95)) + ', 99% by ' + num(killsFor(n, 0.99)) + '.'; };
  const mark95 = (n, k) => { const m = killsFor(n, 0.95); return ' · 95% by ' + num(m) + ' kills' + (k >= m ? ' (passed)' : ''); };
  const rowClass = (q) => (q < 0.01 ? 'r' : q < 0.05 ? 'o' : q < 0.25 ? 'y' : '');
  const pois = (k, l) => { let term = Math.exp(-l), cum = 0; for (let i = 0; i < k; i++) { cum += term; term *= l / (i + 1); } return cum + 0.5 * term; };
  const sumUp = (list) => { let exp = 0, act = 0, vr = 0; list.forEach((e) => { exp += 1 - e.q; vr += e.q * (1 - e.q); if (e.got) act++; }); const z = vr > 0 ? (act - exp) / Math.sqrt(vr) : 0; return { exp, act, pctl: cdf(z) }; };

  function analyse(d) {
    const all = []; let kills = 0;
    d.mobs.forEach((m) => { kills += m.kills; m.drops.forEach((x) => all.push({ m, x, q: dry(x.n, m.kills), got: !!x.got })); });
    return Object.assign(sumUp(all), { kills, all });
  }
  // The chance of having a 1-in-n drop after k kills, and the curve the graphs draw. n <= 1 means guaranteed.
  const cumProb = (n, k) => (n > 1 ? 1 - dry(n, k) : 1);
  function curve(n, k, steps) {
    const xmax = Math.max(Math.ceil(killsFor(n, 0.99) * 1.03), Math.ceil(k * 1.15), 10), pts = [];
    for (let i = 0; i <= steps; i++) { const kc = Math.round(i / steps * xmax); pts.push({ kc, p: cumProb(n, kc) }); }
    return { xmax, pts, marks: [0.5, 0.9, 0.99].map((p) => ({ p, kc: killsFor(n, p) })), now: cumProb(n, k) };
  }
  // Only the dungeons that roll their rares once per run get a per-run luck rating. Chaos and the Fortress roll per wave: applying 1 - (1 - 1/N)^runs to them would be wrong, so they are left out.
  const runRolls = (raids, only) => { const out = []; (raids || []).filter((r) => r.perRun && r.kc > 0 && (!only || only === 'all' || r.id === only)).forEach((r) => r.rare.forEach((x) => out.push({ q: dry(x.n, r.kc), got: !!x.got }))); return out; };
  // Unlock drops from mobs and from the dungeons as one list, with the facets the Unlocks tab filters on.
  const prettySkill = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
  const kindOf = (x) => ({ tool: 'Tools', conduit: 'Conduits', ancient_shard: 'Ancient shards', chaos_shard: 'Chaos shards', feather: 'Dungeon extras', shard: 'Dungeon extras', sweet: 'Dungeon extras', medallion: 'Dungeon extras', blueprint: 'Dungeon extras' }[x.ut] || (x.ut ? prettySkill(x.ut) : 'Other'));
  const tierOf = (name) => { const m = /\[T(\d+)\]/.exec(name || ''); return m ? 'T' + m[1] : ''; };
  function unlockEntries(d) {
    const out = [];
    (d.mobs || []).forEach((m) => m.drops.forEach((x) => { if (x.unlock) out.push({ m, x, q: dry(x.n, m.kills), got: !!x.got, kind: kindOf(x), skill: prettySkill(x.us), tier: tierOf(x.name), src: 'Mobs', key: m.id + ':' + x.id }); }));
    (d.raids || []).filter((r) => r.perRun).forEach((r) => r.rare.forEach((x) => { if (x.unlock) out.push({ m: { id: r.id, name: r.name, kills: r.kc }, x, q: dry(x.n, r.kc), got: !!x.got, kind: kindOf(x), skill: prettySkill(x.us), tier: tierOf(x.name), src: 'Delve', key: r.id + ':' + x.id }); }));
    return out;
  }
  function filterUnlocks(list, f) {
    const q = String(f.q || '').trim().toLowerCase();
    return list.filter((e) => (!q || e.x.name.toLowerCase().includes(q) || e.m.name.toLowerCase().includes(q) || e.skill.toLowerCase().includes(q)) &&
      (f.status === 'all' || (f.status === 'missing' ? !e.got : e.got)) && (f.kind === 'all' || e.kind === f.kind) && (f.tier === 'all' || e.tier === f.tier) &&
      (f.skill === 'all' || e.skill === f.skill) && (f.src === 'all' || e.src === f.src));
  }
  // Tab order: the saved order wins for the tabs it knows, tabs it does not know are dropped, tabs it lacks (new ones) are appended in the default order.
  const mergeOrder = (saved, defaults) => { const out = []; (Array.isArray(saved) ? saved : []).forEach((k) => { if (defaults.includes(k) && !out.includes(k)) out.push(k); }); defaults.forEach((k) => { if (!out.includes(k)) out.push(k); }); return out; };
  // Move `key` so it sits before the item that is at index `slot` of the current order (slot = order.length puts it last).
  const moveKey = (order, key, slot) => { const i = order.indexOf(key); if (i < 0) return order.slice(); const o = order.slice(); o.splice(i, 1); o.splice(Math.max(0, Math.min(o.length, slot > i ? slot - 1 : slot)), 0, key); return o; };
  const verdict = (p) => (p >= 0.95 ? ['Very lucky', 'good'] : p >= 0.75 ? ['Lucky', 'good'] : p >= 0.25 ? ['About average', 'mid'] : p >= 0.08 ? ['A bit unlucky', 'mid'] : p >= 0.02 ? ['Unlucky', 'bad'] : ['Very unlucky', 'bad']);
  // "83rd percentile": the position among players as an ordinal, clipped to 1..99
  const ordinal = (n) => { const m = n % 100; return n + ((m >= 11 && m <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); };
  const pctlNum = (p) => Math.max(1, Math.min(99, Math.round(p * 100)));
  const luckParts = (pctl, obtained, expected) => ['Luck: ' + verdict(pctl)[0], ordinal(pctlNum(pctl)) + ' percentile · ' + obtained + ' obtained / ' + expected.toFixed(1) + ' expected'];
  const luckLine = (pctl, obtained, expected) => luckParts(pctl, obtained, expected).join(' · ');
  // ---- end maths
  let order = TABS.map((t) => t[0]);
  try { order = mergeOrder(JSON.parse(localStorage.getItem(LS_ORDER) || 'null'), order); } catch (e) { /* default order */ }
  const saveOrder = () => { try { if (order.join() === TABS.map((t) => t[0]).join()) localStorage.removeItem(LS_ORDER); else localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch (e) {} };
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Overview: the big card. Verdict, where you sit among players, a meter and three numbers.
  function hero(pctl, obtained, expected, basisLabel, basisNum, unit) {
    const [v, c] = verdict(pctl), s = h('div', 'hero');
    s.appendChild(h('div', 'v ' + c, v));
    s.appendChild(h('div', 'p', ordinal(pctlNum(pctl)) + ' percentile · luckier than about ' + Math.round(pctl * 100) + '% of players with the same ' + basisLabel + (expected > 0 ? ' · ' + Math.round(obtained / expected * 100) + '% of the expected ' + unit : '')));
    const m = h('div', 'meter'), i = h('i'); i.style.left = Math.max(1, Math.min(99, pctl * 100)) + '%'; m.appendChild(i); s.appendChild(m);
    const ends = h('div', 'ends'); ends.appendChild(h('span', null, 'unluckiest')); ends.appendChild(h('span', null, 'luckiest')); s.appendChild(ends);
    const st = h('div', 'stats');
    [[obtained, unit + ' obtained'], [expected.toFixed(1), 'expected'], [num(basisNum), basisLabel]].forEach(([b, t]) => { const x = h('div'); x.appendChild(h('b', null, String(b))); x.appendChild(h('span', null, t)); st.appendChild(x); });
    s.appendChild(st);
    return s;
  }
  // Sub-tabs: one small line in the verdict's colour. The Fortress tracker edits its .p part, so the two parts stay separate spans.
  function miniHero(pctl, obtained, expected) {
    const [head, tail] = luckParts(pctl, obtained, expected), s = h('div', 'luckline ' + verdict(pctl)[1]);
    s.title = 'Luckier than about ' + Math.round(pctl * 100) + '% of players with the same kills. The full picture is on the Overview.';
    s.appendChild(h('span', 'v', head)); s.appendChild(document.createTextNode(' · ')); s.appendChild(h('span', 'p', tail));
    return s;
  }

  // ---- the graph: chance of having a 1-in-n drop by kill count (the game's Dashboard > Drops chart, in the panel's own colours)
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, text) => { const e = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); if (text != null) e.textContent = text; return e; };
  const kfmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
  function dropGraph(n, k) {
    const W = 300, H = 100, L = 30, R = 10, T = 12, B = 20, pw = W - L - R, ph = H - T - B, c = curve(n, k, 80);
    const X = (kc) => L + kc / c.xmax * pw, Y = (p) => T + ph - Math.min(1, Math.max(0, p)) * ph;
    const col = c.now >= 0.5 ? 'var(--cc-good)' : c.now >= 0.25 ? 'var(--cc-accent)' : 'var(--cc-warn)';
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'dgraph', role: 'img', 'aria-label': 'Chance of having the drop by kill count: ' + have(1 - c.now) + ' after ' + num(k) + ' kills' });
    svg.appendChild(sv('rect', { x: L, y: T, width: pw, height: ph, fill: 'var(--cc-bg-2)', stroke: 'var(--cc-border)', 'stroke-width': 0.5, rx: 2 }));
    [0, 0.5, 0.9, 1].forEach((v) => {
      svg.appendChild(sv('line', { x1: L, x2: L + pw, y1: Y(v), y2: Y(v), stroke: 'var(--cc-border-strong)', 'stroke-width': v === 0.5 ? 0.8 : 0.4, 'stroke-dasharray': v === 0.5 || v === 0.9 ? '3,2' : '0' }));
      svg.appendChild(sv('text', { x: L - 3, y: Y(v) + 3, 'font-size': 8, fill: 'var(--cc-text-faint)', 'text-anchor': 'end' }, Math.round(v * 100) + '%'));
    });
    const pts = c.pts.map((q) => X(q.kc).toFixed(1) + ',' + Y(q.p).toFixed(1)), upto = c.pts.filter((q) => q.kc <= k);
    if (k > 0 && upto.length) svg.appendChild(sv('polygon', { points: upto.map((q) => X(q.kc).toFixed(1) + ',' + Y(q.p).toFixed(1)).join(' ') + ' ' + X(k).toFixed(1) + ',' + (T + ph) + ' ' + L + ',' + (T + ph), fill: col, opacity: 0.2 }));
    svg.appendChild(sv('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--cc-text-dim)', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
    let lastX = -99;       // x labels: 0, then the 50 / 90 / 99 percent marks, skipped when they would touch
    [{ kc: 0, l: '0' }].concat(c.marks.map((m) => ({ kc: m.kc, l: kfmt(m.kc), p: m.p }))).forEach((m) => {
      if (m.p) {
        svg.appendChild(sv('circle', { cx: X(m.kc), cy: Y(m.p), r: 2.2, fill: 'var(--cc-text-faint)' }));
        svg.appendChild(sv('text', { x: X(m.kc) - 3, y: Y(m.p) + (m.p >= 0.99 ? 10 : -4), 'font-size': 7.5, fill: 'var(--cc-text-faint)', 'text-anchor': 'end' }, Math.round(m.p * 100) + '%'));
      }
      if (X(m.kc) - lastX >= 26) { svg.appendChild(sv('text', { x: X(m.kc), y: H - 6, 'font-size': 8, fill: 'var(--cc-text-dim)', 'text-anchor': 'middle' }, m.l)); lastX = X(m.kc); }
    });
    if (k > 0) {
      const cx = X(k), cy = Y(c.now), flip = cx > L + pw * 0.7;
      svg.appendChild(sv('line', { x1: cx, x2: cx, y1: T, y2: T + ph, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '2,2', opacity: 0.8 }));
      svg.appendChild(sv('circle', { cx, cy, r: 3, fill: col }));
      svg.appendChild(sv('text', { x: cx + (flip ? -5 : 5), y: Math.max(T + 8, cy - 5), 'font-size': 9, 'font-weight': 700, fill: col, 'text-anchor': flip ? 'end' : 'start' }, (c.now * 100).toFixed(c.now >= 0.1 ? 0 : 1) + '% · you'));
    }
    // hover: a crosshair with the value under the pointer
    const hv = sv('g', { style: 'display:none' });
    const hl = sv('line', { y1: T, y2: T + ph, stroke: 'var(--cc-text)', 'stroke-width': 0.6 }), hc = sv('circle', { r: 2.5, fill: 'var(--cc-text)' }), ht = sv('text', { 'font-size': 8.5, fill: 'var(--cc-text)', y: T + 9 });
    hv.append(hl, hc, ht); svg.appendChild(hv);
    const cap = sv('rect', { x: L, y: T, width: pw, height: ph, fill: 'transparent' }); svg.appendChild(cap);
    cap.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(); if (!r.width) return;
      const kc = Math.max(0, Math.min(c.xmax, Math.round(((e.clientX - r.left) / r.width * W - L) / pw * c.xmax))), p = cumProb(n, kc), x = X(kc), right = x > L + pw * 0.6;
      hl.setAttribute('x1', x); hl.setAttribute('x2', x); hc.setAttribute('cx', x); hc.setAttribute('cy', Y(p));
      ht.textContent = num(kc) + ' kills · ' + (p * 100).toFixed(p >= 0.1 ? 1 : 2) + '%'; ht.setAttribute('x', right ? x - 4 : x + 4); ht.setAttribute('text-anchor', right ? 'end' : 'start');
      hv.style.display = '';
    });
    cap.addEventListener('pointerleave', () => { hv.style.display = 'none'; });
    return svg;
  }
  // The same chart as a hover card (the shared .cc-tip: follows the pointer, never takes it), and an inline copy that the button pins under the drop.
  function graphCard(n, k) {
    const box = h('div'); box.style.width = '250px';
    box.appendChild(dropGraph(n, k));
    const m = [0.5, 0.9, 0.99].map((p) => Math.round(p * 100) + '% by ' + num(killsFor(n, p))).join(' · ');
    box.appendChild(h('div', 'gcap', '1 in ' + num(n) + ' · ' + m + ' kills · you: ' + num(k) + ' kills (' + have(dry(n, k)) + ' would have it)'));
    return box;
  }
  const chartIcon = () => { const i = sv('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); i.appendChild(sv('path', { d: 'M2 2v12h12' })); i.appendChild(sv('path', { d: 'M4.5 10.5c2-.2 2.8-2 3.8-4 .9-1.8 2-2.8 4-3' })); return i; };
  // The icon button at the end of a drop's line: hover shows the chart, a click pins it inline under the drop (and again to remove it). On or off is remembered per drop.
  function attachGraph(btnHost, after, key, n, k) {
    if (!(n > 1)) return;
    const b = h('button', 'cc-ib gbtn'); b.type = 'button'; b.appendChild(chartIcon()); b.setAttribute('aria-label', 'Chance of having this drop by kill count'); b.dataset.tip = '1'; b._graph = { n, k };
    let box = null;
    const sync = () => {
      const on2 = graphOn.has(key);
      b.setAttribute('aria-pressed', on2 ? 'true' : 'false');
      if (on2 && !box && after.parentNode) { box = h('div', 'gbox'); box.appendChild(dropGraph(n, k)); box.appendChild(h('div', 'gcap', '1 in ' + num(n) + ' · ' + [0.5, 0.9, 0.99].map((p) => Math.round(p * 100) + '% by ' + num(killsFor(n, p))).join(' · ') + ' kills · you: ' + num(k) + ' kills (' + have(dry(n, k)) + ' would have it)')); after.after(box); }
      else if (!on2 && box) { box.remove(); box = null; }
    };
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (graphOn.has(key)) graphOn.delete(key); else graphOn.add(key); saveGraphs(); sync(); });
    btnHost.appendChild(b); sync();
  }

  const mobStats = (m) => ({ got: m.drops.filter((x) => x.got).length, exp: m.drops.reduce((t, x) => t + 1 - dry(x.n, m.kills), 0) });
  function dropRow(e) {
    const r = h('div', 'row ' + (e.got ? 'g' : rowClass(e.q)));
    const t = h('div', 't');
    if (!e.got) { const sp = h('span', 'dry ' + (e.q < 0.05 ? 'bad' : e.q < 0.25 ? 'mid' : ''), have(e.q) + ' would have it'); sp.title = haveTip(e.x.n, e.m.kills); t.appendChild(sp); }
    t.appendChild(document.createTextNode(e.x.name + (e.x.unlock ? ' ★' : '')));
    t.appendChild(h('em', null, ' · ' + e.m.name));
    r.appendChild(t);
    const exp = e.m.kills / e.x.n;
    const sline = h('div', 's', '1 in ' + num(e.x.n) + ' · ' + num(e.m.kills) + ' kills (' + exp.toFixed(1) + '× expected)' + (e.got ? ' · got it' : '')); r.appendChild(sline);
    if (!e.got && e.m.drops) {                       // is the rest of this mob's loot on rate? then one missing drop is not bad luck, just variance
      const ms = mobStats(e.m), ok = ms.exp > 0 && ms.got >= ms.exp * 0.9;
      r.appendChild(h('div', 's ' + (ok ? 'good' : ''), e.m.name + ': ' + ms.got + ' of ' + e.m.drops.length + ' drops, ' + ms.exp.toFixed(1) + ' expected' + (ok ? ' · this mob is on rate' : '')));
    }
    attachGraph(sline, r.lastElementChild, e.key || (e.m.id + ':' + e.x.id), e.x.n, e.m.kills);
    return r;
  }
  function list(bd, rows, n) {
    const cap = Math.min(rows.length, 60), shown = more ? cap : Math.min(n, cap);
    rows.slice(0, shown).forEach((e) => bd.appendChild(dropRow(e)));
    if (cap > n) {
      const b = h('button', 'cc-btn sm more', more ? 'Show less' : 'Show more (' + (cap - n) + ')'); b.type = 'button';
      b.addEventListener('click', () => { more = !more; render(); });
      bd.appendChild(b);
    }
  }


  // One component of the overall luck: expected, obtained, variance.
  function comps(d, a) {
    const out = [];
    const mobs = a; out.push({ key: 'Mob drops', exp: mobs.exp, act: mobs.act, vr: mobs.all.reduce((t, e) => t + e.q * (1 - e.q), 0), tab: 'mob' });
    const re = runRolls(d.raids);   // dungeons only: Chaos and the Fortress roll per wave and get no per-run rating
    out.push({ key: 'Dungeon loot', exp: re.reduce((t, e) => t + 1 - e.q, 0), act: re.filter((e) => e.got).length, vr: re.reduce((t, e) => t + e.q * (1 - e.q), 0), tab: 'delve' });
    const pr = d.pets.filter((p) => p.skill !== 'allSkills' && !p.seasonal), allp = d.pets.find((p) => p.skill === 'allSkills') || { normal: 0, shiny: 0 };
    let pe = 0, pa = 0;
    pr.forEach((p) => { pe += p.xp / d.petDiv + p.xp / d.petShinyDiv; pa += (p.normal > 0 ? p.normal : 0) + (p.shiny > 0 ? p.shiny : 0); });
    pe += d.totalXp / d.allDiv + d.totalXp / d.allShinyDiv; pa += allp.normal + allp.shiny;
    out.push({ key: 'Pets', exp: pe, act: pa, vr: pe, tab: 'pets' });
    let le = 0, la = 0; (d.lucky || []).forEach((r) => { le += r.xp / r.div + r.xp / r.sdiv; la += (r.owned ? 1 : 0) + (r.shinyOwned ? 1 : 0); });
    out.push({ key: 'Lucky tools', exp: le, act: la, vr: le, tab: 'pets', sub: 'tools' });
    return out;
  }
  const pctlOf = (c) => (c.vr > 0 ? cdf((c.act - c.exp) / Math.sqrt(c.vr)) : 0.5);
  function miniRow(c) {
    const p = pctlOf(c), [v, cls] = verdict(p), r = h('div', 'row mini'); r.style.cursor = 'pointer';
    const t = h('div', 't'); t.appendChild(h('span', 'dry ' + cls, v)); t.appendChild(document.createTextNode(c.key)); r.appendChild(t);
    const m = h('div', 'meter sm'), i = h('i'); i.style.left = Math.max(1, Math.min(99, p * 100)) + '%'; m.appendChild(i); r.appendChild(m);
    r.appendChild(h('div', 's', c.act + ' obtained / ' + c.exp.toFixed(1) + ' expected · ' + ordinal(pctlNum(p)) + ' percentile'));
    r.addEventListener('click', () => { if (c.sub) { sub = c.sub; saveSub(); } go(c.tab); render(); });
    return r;
  }
  // The panel redraws every few seconds; remember which mob / raid cards you have open so they stay open.
  const openCards = new Set();
  function keepOpen(det, key) { if (openCards.has(key)) det.open = true; det.addEventListener('toggle', () => { if (det.open) openCards.add(key); else openCards.delete(key); }); }
  // Milestone requirements in plain words (the game stores them as a kind plus milliseconds / counts).
  const msTxt = (ms) => { const t = Math.round(ms / 1000), h2 = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return h2 ? h2 + 'h ' + String(m).padStart(2, '0') + 'm' : m ? m + 'm' + (sec ? ' ' + String(sec).padStart(2, '0') + 's' : '') : sec + 's'; };
  function milestoneText(x) {
    if (x.kind === 'time') return 'clear a run in under ' + msTxt(x.at);
    if (x.kind === 'kc') return 'complete ' + num(x.at) + ' runs';
    if (x.kind === 'wave') return 'reach wave ' + (x.wave || '?') + ' as a team';
    if (x.kind === 'wave_time') return 'reach wave ' + (x.wave || '?') + ' within ' + msTxt(x.at);
    if (x.kind === 'deposits') return 'deposit ' + num(x.at) + ' items in a single run';
    return String(x.kind || 'milestone').replace(/_/g, ' ') + (x.at ? ' ' + num(x.at) : '');
  }
  // Tick and cross at the start of a line: green and red.
  function colorMarks(root) {
    root.querySelectorAll('.d, .ps').forEach((el) => {
      const t = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.nodeValue : '', c = t.charAt(0);
      if (c !== '✔' && c !== '✘') return;
      el.firstChild.nodeValue = t.slice(1);
      const m = document.createElement('span'); m.className = 'mk ' + (c === '✔' ? 'ok' : 'no'); m.textContent = c; el.insertBefore(m, el.firstChild);
    });
  }
  // ---- loot lists for the two endless raids (Chaos Dungeon, Fortress): what can drop, from which wave, what you have
  const TIER_TXT = { t1: 'T1', t2: 'T2', t3: 'T3', t4: 'T4', t5: 'T5', c: 'C', c7: 'C7' };
  const hit = (txt, f) => !f || String(txt).toLowerCase().includes(f);
  // One row per family with a pill per tier band: "T2 · wave 21", green when you have it
  function familyRows(parent, fams, f) {
    let shown = 0, got = 0, tot = 0;
    fams.forEach((fm) => {
      fm.tiers.forEach((t) => { tot++; if (t.got) got++; });
      const tiers = fm.tiers.filter((t) => hit(fm.name, f) || hit(t.name, f));
      if (f && !tiers.length) return;
      const row = h('div', 'fam'); row.appendChild(h('b', null, fm.name));
      tiers.forEach((t) => { const p = h('span', 'tp' + (t.got ? ' own' : ''), (t.got ? '✔ ' : '') + (TIER_TXT[t.tier] || t.tier) + ' · wave ' + t.wave); p.title = t.name + (t.got ? ' · you have it' : ' · not yet'); row.appendChild(p); });
      parent.appendChild(row); shown++;
    });
    return { shown, got, tot };
  }
  function itemLines(parent, items, f, from) {
    let n = 0;
    items.forEach((x) => { if (!hit(x.name, f)) return; const line = h('div', 'd'); line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + ' · ' + (from || 'from wave ' + x.wave); parent.appendChild(line); n++; });
    return n;
  }
  // The Chaos Dungeon: milestones plus everything the game lists in its Drop Table. The game gives no per-kill number for these (it says "chance rising with wave depth"), so there is no luck rating.
  function chaosCard(r, loot, f) {
    const ownedOf = (list) => list.filter((x) => x.got).length;
    const msHit = r.milestone.filter((x) => hit(x.name, f) || hit(r.name, f));
    const famGot = loot ? loot.special.reduce((t, fm) => t + ownedOf(fm.tiers), 0) : 0, famTot = loot ? loot.special.reduce((t, fm) => t + fm.tiers.length, 0) : 0;
    const extras = loot ? [].concat(loot.tools, loot.chaosMats, loot.godMats) : [];
    const got = ownedOf(r.milestone) + famGot + ownedOf(extras), tot = r.milestone.length + famTot + extras.length;
    const det = h('details'); keepOpen(det, 'delve:' + r.id); if (f) det.open = true;
    const fr = tot ? got / tot : 1; det.style.borderColor = fr >= 1 ? '#4ade80' : fr >= 0.67 ? '#a3e048' : fr >= 0.34 ? '#ffd24a' : fr > 0 ? '#ff9a3c' : '#ff5a4d';
    const sm = h('summary'); sm.appendChild(h('span', 'n', r.name)); sm.appendChild(h('span', 'c', (r.bestWave ? 'best wave ' + r.bestWave + ' · ' : '') + got + '/' + tot + ' items')); det.appendChild(sm);
    let any = false;
    if (msHit.length) { any = true; det.appendChild(h('div', 'sub', 'Milestones')); msHit.forEach((x) => { const line = h('div', 'd'); line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + ' · ' + milestoneText(x); det.appendChild(line); }); }
    if (loot) {
      const sp = h('div'); const res = familyRows(sp, loot.special, f);
      if (res.shown) { any = true; det.appendChild(h('div', 'sub', 'Special drops · one roll per kill, the chance rises with wave depth (' + res.got + '/' + res.tot + ')')); det.appendChild(sp); }
      const bits = [['Tools · wave ' + loot.start.c7 + ' and deeper', loot.tools], ['Chaos components · from wave ' + loot.start.c, loot.chaosMats], ['God gem and components · from wave ' + loot.start.c7, loot.godMats]];
      bits.forEach(([ttl, list]) => { const bx = h('div'); const n = itemLines(bx, list, f); if (n) { any = true; det.appendChild(h('div', 'sub', ttl)); det.appendChild(bx); } });
    }
    if (f && !any) return null;
    det.appendChild(h('div', 'note', 'Components roll once per kill each at 1/' + (loot ? loot.matDiv : 5) + ' of the band rate. Every 20 waves survived also banks one common roll from the next dungeon tier\'s table. The game does not publish the per-kill chances of these, so no luck rating is shown for Chaos.'));
    return det;
  }
  function body(a, d) {
    const bridgeNow = bridge(), loot = bridgeNow && bridgeNow.endlessLoot ? bridgeNow.endlessLoot() : null;
    const bd = el.querySelector('.bd'); bd.textContent = '';
    if (tab === 'over') {
      const cs = comps(d, a);
      const tot = cs.reduce((t, c) => ({ exp: t.exp + c.exp, act: t.act + c.act, vr: t.vr + c.vr }), { exp: 0, act: 0, vr: 0 });
      bd.appendChild(hero(pctlOf(tot), tot.act, tot.exp, 'kills', a.kills, 'drops'));
      bd.appendChild(h('h5', null, 'By category · click one to open its details'));
      cs.forEach((c) => bd.appendChild(miniRow(c)));
      bd.appendChild(h('h5', null, 'Most overdue'));
      const miss = a.all.filter((e) => !e.got && e.m.kills > 0).sort((p, q) => p.q - q.q);
      if (!miss.length) bd.appendChild(h('div', 'note', 'Nothing overdue yet.'));
      list(bd, miss, 5);
      bd.appendChild(h('div', 'note', 'Everything you can roll for, added together: mob drops, dungeon loot, pets and lucky tools (shinies included). Published base rates only. "98.7% would have it" means: after your kills at that drop rate, 98.7% of players would already have the drop, so you are in the unluckiest 1.3%. Red = unluckier than 1%, orange = unluckier than 5%. The chart button on a drop shows the chance of having it by kill count; hover the line for values.'));
    } else if (tab === 'fortress') {
      if (window.__ccFortress && window.__ccFortress.renderTab) window.__ccFortress.renderTab(bd, { h, hero: (pctl, obtained, expected) => miniHero(pctl, obtained, expected) });
      else bd.appendChild(h('div', 'note', 'The Fortress tracker plugin is off. Turn it on in Settings > Plugins > Trackers.'));
      const fr = (d.raids || []).find((r) => r.id === 'gauntlet');
      if (loot && loot.gauntlet.length) {
        const gTot = loot.gauntlet.reduce((t, fm) => t + fm.tiers.length, 0), gGot = loot.gauntlet.reduce((t, fm) => t + fm.tiers.filter((x) => x.got).length, 0), msN = fr ? fr.milestone.length : 0, msGot = fr ? fr.milestone.filter((x) => x.got).length : 0;
        bd.appendChild(h('h5', null, 'Everything the Fortress can drop'));
        const det = h('details'); keepOpen(det, 'fortress:loot');
        const sm = h('summary'); sm.appendChild(h('span', 'n', 'Tiered rares and milestones')); sm.appendChild(h('span', 'c', (gGot + msGot) + '/' + (gTot + msN) + ' items')); det.appendChild(sm);
        det.appendChild(h('div', 'sub', 'Tiered rares · one roll per cleared wave, the chance rises with depth'));
        familyRows(det, loot.gauntlet, '');
        if (fr && fr.milestone.length) { det.appendChild(h('div', 'sub', 'Milestones')); fr.milestone.forEach((x) => { const line = h('div', 'd'); line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + ' · ' + milestoneText(x); det.appendChild(line); }); }
        det.appendChild(h('div', 'note', 'Each tier band opens at the wave shown. The chances come from the Fortress HUD while you play (they are the ones tracked above); the game does not publish them anywhere else.'));
        bd.appendChild(det);
      }
    } else if (tab === 'delve') {
      // The dungeons (Feeble to Ancient) roll their rares once per run; the Chaos Dungeon is endless and lists everything the game shows in its Drop Table.
      const raids = (d.raids || []).filter((r) => r.id !== 'gauntlet');
      const sel = h('select', 'sel'); [['all', 'All dungeons']].concat(raids.map((r) => [r.id, r.name])).forEach(([v, l]) => { const o = h('option', null, l); o.value = v; sel.appendChild(o); });
      sel.value = raids.some((r) => r.id === mp.raid) ? mp.raid : 'all'; sel.addEventListener('change', () => { mp.raid = sel.value; saveMobPrefs(); renderList(); });
      const rs = sumUp(runRolls(raids, mp.raid)), runs = raids.reduce((t, r) => t + (r.perRun && (mp.raid === 'all' || r.id === mp.raid) ? r.kc : 0), 0);
      bd.appendChild(miniHero(rs.pctl, rs.act, rs.exp));
      const bar = h('div', 'mobbar');
      const inp = h('input', 'cc-in search'); inp.type = 'text'; inp.placeholder = 'Find a dungeon or an item'; inp.value = mp.dq || '';
      let tm = 0; inp.addEventListener('input', () => { mp.dq = inp.value; saveMobPrefs(); clearTimeout(tm); tm = setTimeout(renderList, 120); });
      bar.appendChild(inp); const row2 = h('div', 'mobsel'); row2.appendChild(sel); bar.appendChild(row2); bd.appendChild(bar);
      const box = h('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px'; bd.appendChild(box);
      function renderList() {
        box.textContent = ''; const f = (mp.dq || '').trim().toLowerCase();
        raids.filter((r) => mp.raid === 'all' || r.id === mp.raid).forEach((r) => {
          if (!r.perRun) { const c = chaosCard(r, loot, f); if (c) box.appendChild(c); return; }
          const nameHit = hit(r.name, f), rare = r.rare.filter((x) => nameHit || hit(x.name, f)), ms = r.milestone.filter((x) => nameHit || hit(x.name, f));
          if (f && !nameHit && !rare.length && !ms.length) return;
          const got = r.rare.filter((x) => x.got).length, fr2 = r.rare.length ? got / r.rare.length : 1;
          const det = h('details'); keepOpen(det, 'delve:' + r.id); if (f) det.open = true; det.style.borderColor = fr2 >= 1 ? '#4ade80' : fr2 >= 0.67 ? '#a3e048' : fr2 >= 0.34 ? '#ffd24a' : fr2 > 0 ? '#ff9a3c' : '#ff5a4d';
          const sm = h('summary'); sm.appendChild(h('span', 'n', r.name)); sm.appendChild(h('span', 'c', num(r.kc) + ' runs · ' + got + '/' + r.rare.length + ' rares')); det.appendChild(sm);
          rare.slice().sort((p, q) => (!!p.got - !!q.got) || (q.n - p.n)).forEach((x) => {
            const q = dry(x.n, r.kc), line = h('div', 'd');
            line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + (x.unlock ? ' ★' : '') + ' · 1 in ' + num(x.n) + (x.got ? '' : ' · ' + have(q) + ' would have it' + mark95(x.n, r.kc));
            det.appendChild(line); attachGraph(line, line, r.id + ':' + x.id, x.n, r.kc);
          });
          if (ms.length) {
            det.appendChild(h('div', 'sub', 'Milestones'));
            ms.forEach((x) => { const line = h('div', 'd'); line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + ' · ' + milestoneText(x); det.appendChild(line); });
          }
          box.appendChild(det);
        });
        if (!box.firstChild) box.appendChild(h('div', 'note', 'Nothing matches "' + (mp.dq || '') + '".'));
        colorMarks(box);
      }
      renderList();
      bd.appendChild(h('div', 'note', 'Dungeons roll their rares once per run, so they get a luck rating. The Chaos Dungeon is endless and rolls per kill and per wave, so it is listed without one. The Fortress has its own tab. Milestone items come from a time or run count, not luck.'));
    } else if (tab === 'mob') {
      // Filters and sort are remembered. Each mob's outline shows how complete it is: red (nothing) to green (everything).
      const tiers = Array.from(new Set(d.mobs.map((m) => m.id.split('_')[0]))).sort();
      bd.appendChild(miniHero(a.pctl, a.act, a.exp));
      const bar = h('div', 'mobbar');
      const mk = (cls, opts, val, onch) => { const sl = h('select', cls); opts.forEach(([v, l]) => { const o = h('option', null, l); o.value = v; sl.appendChild(o); }); sl.value = val; sl.addEventListener('change', () => { onch(sl.value); saveMobPrefs(); renderList(); }); return sl; };
      const inp = h('input', 'cc-in search'); inp.type = 'text'; inp.placeholder = 'Find a mob or an item'; inp.value = mp.q;
      inp.addEventListener('input', () => { mp.q = inp.value; saveMobPrefs(); renderList(); });
      bar.appendChild(inp);
      const row2 = h('div', 'mobsel');
      row2.appendChild(mk('sel', [['all', 'All tiers']].concat(tiers.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])), mp.tier, (v) => { mp.tier = v; }));
      row2.appendChild(mk('sel', [['all', 'All'], ['inc', 'Incomplete'], ['done', 'Complete'], ['none', 'Nothing yet']], mp.status, (v) => { mp.status = v; }));
      row2.appendChild(mk('sel', [['kills', 'Sort: most kills'], ['missing', 'Sort: most missing'], ['pct', 'Sort: least complete'], ['pctd', 'Sort: most complete'], ['luck', 'Sort: unluckiest'], ['name', 'Sort: name']], mp.sort, (v) => { mp.sort = v; }));
      bar.appendChild(row2); bd.appendChild(bar);
      const box = h('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px'; bd.appendChild(box);
      const colour = (f) => (f >= 1 ? '#4ade80' : f >= 0.67 ? '#a3e048' : f >= 0.34 ? '#ffd24a' : f > 0 ? '#ff9a3c' : '#ff5a4d');
      function renderList() {
        box.textContent = '';
        const f = mp.q.trim().toLowerCase();
        let mobs = d.mobs.filter((m) => m.kills > 0 && (!f || m.name.toLowerCase().includes(f) || m.drops.some((x) => x.name.toLowerCase().includes(f))) && (mp.tier === 'all' || m.id.split('_')[0] === mp.tier));
        mobs = mobs.map((m) => { const ms = mobStats(m); return { m, got: ms.got, exp: ms.exp, tot: m.drops.length, frac: m.drops.length ? ms.got / m.drops.length : 1, luck: ms.exp > 0 ? ms.got / ms.exp : 1 }; });
        mobs = mobs.filter((o) => mp.status === 'all' || (mp.status === 'inc' && o.got < o.tot) || (mp.status === 'done' && o.got >= o.tot) || (mp.status === 'none' && o.got === 0));
        const cmp = { kills: (a, b) => b.m.kills - a.m.kills, missing: (a, b) => (b.tot - b.got) - (a.tot - a.got), pct: (a, b) => a.frac - b.frac, pctd: (a, b) => b.frac - a.frac, luck: (a, b) => a.luck - b.luck, name: (a, b) => a.m.name.localeCompare(b.m.name) }[mp.sort] || ((a, b) => b.m.kills - a.m.kills);
        mobs.sort(cmp);
        if (!mobs.length) box.appendChild(h('div', 'note', f || mp.tier !== 'all' || mp.status !== 'all' ? 'No mob matches these filters.' : 'No kills recorded yet.'));
        mobs.forEach((o) => {
          const m = o.m, c = colour(o.frac);
          const det = h('details'); keepOpen(det, 'mob:' + m.id); if (f && !m.name.toLowerCase().includes(f)) det.open = true; det.style.borderColor = c; if (o.frac >= 1) det.style.boxShadow = '0 0 8px ' + c + '55';
          const sm = h('summary');
          sm.appendChild(h('span', 'n', m.name)); sm.appendChild(h('span', 'c', num(m.kills) + ' kills · ' + o.got + '/' + o.tot + ' (exp ' + o.exp.toFixed(1) + ')'));
          det.appendChild(sm);
          const pb = h('div', 'pbar'), pi = h('i'); pi.style.width = Math.round(o.frac * 100) + '%'; pi.style.background = c; pb.appendChild(pi); det.appendChild(pb);
          m.drops.slice().sort((p, q) => (!!p.got - !!q.got) || dry(p.n, m.kills) - dry(q.n, m.kills)).forEach((x) => {
            const q = dry(x.n, m.kills), line = h('div', 'd');
            line.textContent = (x.got ? '✔ ' : '✘ ') + x.name + (x.unlock ? ' ★' : '') + ' · 1 in ' + num(x.n) + (x.got ? '' : ' · ' + have(q) + ' would have it' + mark95(x.n, m.kills));
            det.appendChild(line); attachGraph(line, line, m.id + ':' + x.id, x.n, m.kills);
          });
          box.appendChild(det);
        });
        colorMarks(box);
      }
      renderList();
    } else if (tab === 'unlock') {
      // Every unlock drop (tools, conduits, shards ...) from mobs and dungeons, with categories, filters and a search.
      const all = unlockEntries(d), seen = all.filter((e) => e.m.kills > 0), u = sumUp(seen);
      bd.appendChild(miniHero(u.pctl, u.act, u.exp));
      const kindOrder = ['Tools', 'Conduits', 'Ancient shards', 'Chaos shards', 'Dungeon extras'], kinds = Array.from(new Set(all.map((e) => e.kind))).sort((p, q) => { const ip = kindOrder.indexOf(p), iq = kindOrder.indexOf(q); return (ip < 0 ? 99 : ip) - (iq < 0 ? 99 : iq) || p.localeCompare(q); });
      if (up.kind !== 'all' && !kinds.includes(up.kind)) up.kind = 'all';
      const cats = h('div', 'catrow'); bd.appendChild(cats);
      const inp = h('input', 'cc-in search'); inp.type = 'text'; inp.placeholder = 'Find an unlock by name, skill or source'; inp.value = up.q;
      let tm = 0; inp.addEventListener('input', () => { up.q = inp.value; saveUp(); clearTimeout(tm); tm = setTimeout(renderList, 120); });
      const bar = h('div', 'mobbar'); bar.appendChild(inp);
      const mk = (opts, val, onch) => { const sl = h('select', 'sel'); opts.forEach(([v, l]) => { const o = h('option', null, l); o.value = v; sl.appendChild(o); }); sl.value = opts.some((o) => o[0] === val) ? val : opts[0][0]; sl.addEventListener('change', () => { onch(sl.value); saveUp(); more = false; renderList(); }); return sl; };
      const uniq = (key) => Array.from(new Set(all.map((e) => e[key]).filter(Boolean))).sort();
      const r1 = h('div', 'mobsel'), r2 = h('div', 'mobsel');
      r1.appendChild(mk([['missing', 'Missing'], ['owned', 'Owned'], ['all', 'All']], up.status, (v) => { up.status = v; }));
      r1.appendChild(mk([['all', 'All tiers']].concat(uniq('tier').map((t) => [t, t])), up.tier, (v) => { up.tier = v; }));
      r1.appendChild(mk([['all', 'Mobs and Delve'], ['Mobs', 'Mobs'], ['Delve', 'Delve']], up.src, (v) => { up.src = v; }));
      r2.appendChild(mk([['all', 'All skills']].concat(uniq('skill').map((t) => [t, t])), up.skill, (v) => { up.skill = v; }));
      bar.append(r1, r2); bd.appendChild(bar);
      const box = h('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px'; bd.appendChild(box);
      function drawCats() {
        cats.textContent = '';
        [['all', 'All', all.length]].concat(kinds.map((k) => [k, k, all.filter((e) => e.kind === k).length])).forEach(([v, l, n]) => {
          const c = h('button', 'catchip' + (up.kind === v ? ' on' : ''), l + ' ' + n); c.type = 'button';
          c.addEventListener('click', () => { up.kind = v; saveUp(); more = false; drawCats(); renderList(); });
          cats.appendChild(c);
        });
      }
      function renderList() {
        box.textContent = '';
        const rows = filterUnlocks(all, up).sort((p, q) => (p.got - q.got) || ((q.m.kills > 0) - (p.m.kills > 0)) || (p.q - q.q) || p.x.name.localeCompare(q.x.name));
        box.appendChild(h('div', 'note', 'Showing ' + rows.length + ' of ' + all.length + ' unlock drops' + (up.status === 'missing' ? ' · most overdue first' : '')));
        const cap = Math.min(rows.length, 80), shown = more ? cap : Math.min(10, cap);
        rows.slice(0, shown).forEach((e) => box.appendChild(dropRow(e)));
        if (cap > 10) { const b = h('button', 'cc-btn sm more', more ? 'Show less' : 'Show more (' + (cap - 10) + ')'); b.type = 'button'; b.addEventListener('click', () => { more = !more; renderList(); }); box.appendChild(b); }
        if (!rows.length) box.appendChild(h('div', 'note', up.q || up.kind !== 'all' || up.tier !== 'all' || up.skill !== 'all' || up.src !== 'all' ? 'No unlock matches these filters.' : 'You have every unlock drop you have had a chance at.'));
        colorMarks(box);
      }
      drawCats(); renderList();
      bd.appendChild(h('div', 'note', '★ Unlock drops: tools, conduits, shards and other permanent gains. Chart button: the chance of having it by kill count.'));
    } else {
      // Pets & Tools. Pets: 1 in 10,000,000 XP in the skill, All-Skills 1 in 100,000,000 XP in any skill; lucky tools: 1 in 1,000,000 XP (Lantern 1 in 10,000,000); shiny = the same roll 5 times rarer.
      const allp = d.pets.find((p) => p.skill === 'allSkills') || { normal: 0, shiny: 0 };
      const seasonal = d.pets.filter((p) => p.seasonal);   // holiday pets are guaranteed, not rolled: they are shown apart and left out of every luck number
      const rows = d.pets.filter((p) => p.skill !== 'allSkills' && !p.seasonal).map((p) => ({ skill: p.skill, name: p.name, n: p.normal, s: p.shiny, xp: p.xp, ln: p.xp / d.petDiv, ls: p.xp / d.petShinyDiv }));
      rows.push({ skill: 'all_skills', name: 'All Skills', n: allp.normal, s: allp.shiny, xp: d.totalXp, ln: d.totalXp / d.allDiv, ls: d.totalXp / d.allShinyDiv, all: true });
      const lam = rows.reduce((t, r) => t + r.ln + r.ls, 0), got = rows.reduce((t, r) => t + (r.n > 0 ? r.n : 0) + (r.s > 0 ? r.s : 0), 0);
      const lk = d.lucky || [], lamK = lk.reduce((t, r) => t + r.xp / r.div + r.xp / r.sdiv, 0), gotK = lk.reduce((t, r) => t + (r.owned ? 1 : 0) + (r.shinyOwned ? 1 : 0), 0);
      if (sub === 'tools' && lk.length) bd.appendChild(miniHero(pois(gotK, lamK), gotK, lamK)); else bd.appendChild(miniHero(pois(got, lam), got, lam));
      const segs = h('div', 'catrow');
      [['pets', 'Pets'], ['tools', 'Tools'], ['all', 'All']].forEach(([v, l]) => { const c = h('button', 'catchip' + (sub === v ? ' on' : ''), l); c.type = 'button'; c.setAttribute('aria-pressed', sub === v ? 'true' : 'false'); c.addEventListener('click', () => { sub = v; saveSub(); render(); el.querySelector('.bd').scrollTop = 0; }); segs.appendChild(c); });
      bd.appendChild(segs);
      const bar = h('div', 'mobbar'), inp = h('input', 'cc-in search'); inp.type = 'text'; inp.placeholder = sub === 'tools' ? 'Find a lucky tool' : sub === 'pets' ? 'Find a pet' : 'Find a pet or a lucky tool'; inp.value = pf.q;
      let tm = 0; inp.addEventListener('input', () => { pf.q = inp.value; savePf(); clearTimeout(tm); tm = setTimeout(renderList, 120); });
      const st = h('select', 'sel'); [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing']].forEach(([v, l]) => { const o = h('option', null, l); o.value = v; st.appendChild(o); }); st.value = pf.st;
      st.addEventListener('change', () => { pf.st = st.value; savePf(); renderList(); });
      const r2 = h('div', 'mobsel'); r2.appendChild(st); bar.append(inp, r2); bd.appendChild(bar);
      const box = h('div'); bd.appendChild(box);
      const icon = (path) => { const i = document.createElement('img'); i.src = path; i.alt = ''; i.addEventListener('error', () => { i.style.visibility = 'hidden'; }); return i; };
      const pass = (name, owned) => hit(name, (pf.q || '').trim().toLowerCase()) && (pf.st === 'all' || (pf.st === 'owned' ? owned : !owned));
      function renderList() {
        box.textContent = '';
        if (sub !== 'tools') {
          const shinyGot = rows.reduce((t, r) => t + (r.s > 0 ? 1 : 0), 0), shinyExp = rows.reduce((t, r) => t + r.ls, 0);
          const sh = h('div', 'shinybar'); sh.appendChild(h('span', 'sp', '✨'));
          sh.appendChild(h('span', null, 'Shinies: ' + shinyGot + ' owned · ' + shinyExp.toFixed(2) + ' expected. A shiny is the same roll made 5 times rarer (skill pets 1 in 50,000,000 XP, All-Skills 1 in 500,000,000).'));
          box.appendChild(sh);
          box.appendChild(h('h5', null, 'Pets'));
          const grid = h('div', 'pgrid');
          rows.filter((r) => pass(r.name, r.n > 0 || r.s > 0)).sort((p, q) => ((q.s > 0) - (p.s > 0)) || ((q.n > 0) - (p.n > 0)) || (q.ln - p.ln)).forEach((r) => {
            const c = h('div', 'pcard' + (r.s > 0 ? ' shiny' : r.n > 0 ? ' own' : ''));
            const ic = h('div', 'pic'); ic.appendChild(icon('/assets/icons/pets/' + r.skill + '_pet' + (r.s > 0 ? '_s' : '') + '.png')); if (r.s > 0) ic.appendChild(h('span', 'spk', '✨')); c.appendChild(ic);
            const t = h('div', 'pt'); t.appendChild(h('div', 'pn', r.name + (r.n > 1 ? ' ×' + r.n : '')));
            t.appendChild(h('div', 'ps ' + (r.n > 0 ? 'good' : ''), r.n > 0 ? '✔ Pet owned' : 'Pet · ' + pct(1 - Math.exp(-r.ln)) + ' so far'));
            t.appendChild(h('div', 'ps shn ' + (r.s > 0 ? 'good' : ''), r.s > 0 ? '✨ Shiny owned' + (r.s > 1 ? ' ×' + r.s : '') : '✨ Shiny · ' + pct(1 - Math.exp(-r.ls)) + ' so far'));
            c.appendChild(t); grid.appendChild(c);
          });
          if (!grid.firstChild) box.appendChild(h('div', 'note', 'No pet matches.')); else box.appendChild(grid);
          const sea = seasonal.filter((p) => pass(p.name, p.normal > 0 || p.shiny > 0));
          if (sea.length) {
            box.appendChild(h('h5', null, 'Seasonal pets'));
            const sg = h('div', 'pgrid');
            sea.forEach((p) => { const c = h('div', 'pcard' + (p.normal > 0 || p.shiny > 0 ? ' own' : '')); const t = h('div', 'pt'); t.appendChild(h('div', 'pn', p.name + (p.normal > 1 ? ' ×' + p.normal : ''))); t.appendChild(h('div', 'ps ' + (p.normal > 0 || p.shiny > 0 ? 'good' : ''), p.normal > 0 || p.shiny > 0 ? '✔ Pet owned' : 'Not yet')); t.appendChild(h('div', 'ps', 'Guaranteed: not a roll')); c.appendChild(t); sg.appendChild(c); });
            box.appendChild(sg);
            box.appendChild(h('div', 'note', 'Seasonal pets are guaranteed rewards, not a chance per XP, so they are left out of the luck numbers.'));
          }
        }
        // Lucky tools: dropped per XP in the skill; shiny is 5 times rarer.
        if (sub !== 'pets' && lk.length) {
          const lg = lk.slice().sort((p, q) => (q.xp / q.div) - (p.xp / p.div));
          box.appendChild(h('h5', null, 'Lucky tools'));
          const hl = h('div', 'shinybar'); hl.appendChild(h('span', 'sp', '🍀'));
          hl.appendChild(h('span', null, 'Lucky tools owned: ' + gotK + ' · ' + lamK.toFixed(2) + ' expected. 1 in 1,000,000 XP in the skill (Lantern 1 in 10,000,000); the shiny lucky tool is 5 times rarer.'));
          box.appendChild(hl);
          const tg = h('div', 'pgrid');
          lg.filter((r) => pass(r.name, r.owned || r.shinyOwned)).forEach((r) => {
            const c = h('div', 'pcard' + (r.shinyOwned ? ' shiny' : r.owned ? ' own' : ''));
            const ic = h('div', 'pic'); ic.appendChild(icon('/assets/icons/items/' + (r.shinyOwned && r.sid ? r.sid : r.id) + '.png')); if (r.shinyOwned) ic.appendChild(h('span', 'spk', '✨')); c.appendChild(ic);
            const t = h('div', 'pt'); t.appendChild(h('div', 'pn', r.name));
            t.appendChild(h('div', 'ps ' + (r.owned ? 'good' : ''), r.owned ? '✔ Lucky tool owned' : 'Lucky · ' + pct(1 - Math.exp(-r.xp / r.div)) + ' so far'));
            t.appendChild(h('div', 'ps shn ' + (r.shinyOwned ? 'good' : ''), r.shinyOwned ? '✨ Shiny owned' : '✨ Shiny · ' + pct(1 - Math.exp(-r.xp / r.sdiv)) + ' so far'));
            c.appendChild(t); tg.appendChild(c);
          });
          if (!tg.firstChild) box.appendChild(h('div', 'note', 'No lucky tool matches.')); else box.appendChild(tg);
        }
        box.appendChild(h('div', 'note', '"So far" is the chance you would have it by now from your XP in that skill.'));
      }
      renderList();
    }
  }

  // ---- dragging the tabs: a pointer drag (after a few pixels) shows a marker where the tab will land; releasing drops it there. A drag never counts as a click.
  let drag = null, justDragged = false;
  const slotAt = (x) => { const bs = Array.from(subRow.querySelectorAll('.cc-tab')); let n = 0; bs.forEach((b) => { const r = b.getBoundingClientRect(); if (x > r.left + r.width / 2) n++; }); return { n, bs }; };
  function showMarker(x) {
    const { n, bs } = slotAt(x); let m = subRow.querySelector('.tabmark'); if (!m) { m = h('div', 'tabmark'); subRow.appendChild(m); }
    const base = subRow.getBoundingClientRect(), at = n >= bs.length ? bs[bs.length - 1].getBoundingClientRect().right : bs[n].getBoundingClientRect().left;
    m.style.left = Math.round(at - base.left) + 'px'; return n;
  }
  function endDrag(commit, x) {
    const dg = drag; drag = null; if (!dg) return;
    const m = subRow.querySelector('.tabmark'); if (m) m.remove(); dg.el.classList.remove('dragging');
    if (!dg.started) return;
    justDragged = true; setTimeout(() => { justDragged = false; }, 80);
    if (commit) { const { n } = slotAt(x); order = moveKey(order, dg.k, n); saveOrder(); }
    render();
  }
  const onMove = (e) => {
    if (!drag) return;
    if (!drag.started) { if (Math.abs(e.clientX - drag.x0) < 6) return; drag.started = true; drag.el.classList.add('dragging'); }
    showMarker(e.clientX);
  };
  const onUp = (e) => { if (drag) endDrag(true, e.clientX); };
  const onCancel = () => endDrag(false, 0);
  const onKeyDrag = (e) => { if (drag && e.key === 'Escape') endDrag(false, 0); };
  document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerup', onUp, true); document.addEventListener('pointercancel', onCancel, true); document.addEventListener('keydown', onKeyDrag, true);
  subRow.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    const isDefault = order.join() === TABS.map((t) => t[0]).join();
    if (UI.menu) UI.menu([{ head: 'Sub-tabs' }, { label: 'Reset tab order', disabled: isDefault, onClick: () => { order = TABS.map((t) => t[0]); saveOrder(); render(); } }], e.clientX, e.clientY);
  });

  function render() {
    const b = bridge();
    if (!on() || !open || !b) { el.classList.remove('show'); return; }
    const d = b.dropState();
    if (!d) { el.classList.remove('show'); return; }
    el.classList.add('show');
    if (drag && drag.started) return;   // a tab is being dragged: leave the strip alone
    tab = main === 'over' ? 'over' : subTab;
    const hadFocus = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.k : '';
    tabsRow.textContent = '';
    MAINS.forEach(([k, label]) => {
      const bt = h('button', 'cc-tab', label); bt.type = 'button'; bt.setAttribute('role', 'tab'); bt.setAttribute('aria-selected', k === main ? 'true' : 'false'); bt.style.flex = '1'; bt.dataset.k = k;
      bt.addEventListener('click', () => { go(k); render(); el.querySelector('.bd').scrollTop = 0; });
      tabsRow.appendChild(bt);
    });
    subRow.textContent = ''; subRow.style.display = main === 'detail' ? '' : 'none';
    const labels = {}; TABS.forEach(([k, label]) => { labels[k] = label; });
    if (main === 'detail') order.forEach((k) => {
      const bt = h('button', 'cc-tab', labels[k]); bt.type = 'button'; bt.setAttribute('role', 'tab'); bt.setAttribute('aria-selected', k === subTab ? 'true' : 'false'); bt.style.flex = '1'; bt.dataset.k = k; bt.title = 'Drag to reorder · Shift+Left / Shift+Right · right-click to reset the order';
      bt.addEventListener('click', () => { if (justDragged) return; go(k); render(); el.querySelector('.bd').scrollTop = 0; });
      bt.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { k, x0: e.clientX, started: false, el: bt }; });
      bt.addEventListener('keydown', (e) => {
        if (!e.shiftKey || e.altKey || e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;   // Alt+arrow is taken by the page before it reaches a panel
        e.preventDefault(); const i = order.indexOf(k), j = i + (e.key === 'ArrowLeft' ? -1 : 1); if (j < 0 || j >= order.length) return;
        order = moveKey(order, k, e.key === 'ArrowLeft' ? i - 1 : i + 2); saveOrder(); render(); const nb = subRow.querySelector('[data-k="' + k + '"]'); if (nb) nb.focus();
      });
      subRow.appendChild(bt);
    });
    if (hadFocus) { const nb = el.querySelector('.tabs [data-k="' + hadFocus + '"]'); if (nb) nb.focus(); }
    const bdEl = el.querySelector('.bd'), top = bdEl.scrollTop, typing = document.activeElement && el.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (typing || el.querySelector('.dgraph:hover')) return; // do not rebuild while typing in a search or reading a graph
    const a0 = analyse(d), cs0 = comps(d, a0), tot0 = cs0.reduce((t, c) => ({ exp: t.exp + c.exp, act: t.act + c.act, vr: t.vr + c.vr }), { exp: 0, act: 0, vr: 0 });
    P.setChip(verdict(pctlOf(tot0))[0]);
    body(a0, d);
    colorMarks(bdEl);
    bdEl.scrollTop = top;
  }
  let tickN = 0;
  const timer = setInterval(() => { try { tickN++; if (open && !(document.hidden || window.__ccEcoOn) && (tab === 'fortress' || tickN % 5 === 0)) render(); } catch (e) { /* keep ticking */ } }, 1000);   // the Fortress tab follows a live run once a second, the others every 5 s
  function teardown() {
    clearInterval(timer);
    document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerup', onUp, true); document.removeEventListener('pointercancel', onCancel, true); document.removeEventListener('keydown', onKeyDrag, true);
    P.destroy(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc drop-luck torn down';
  }
  window[NS] = { version: 2, teardown, render, get isOpen() { return open; }, toggle() { setOpen(!open); }, open() { setOpen(true); }, setTab(k) { go(k); render(); }, get main() { return main; }, get sub() { return sub; }, get subTab() { return subTab; }, get order() { return order.slice(); }, get tab() { return tab; }, analyse: () => { const b = bridge(); return b && analyse(b.dropState()); } };
  render();
  return 'cc drop-luck loaded';
})();
