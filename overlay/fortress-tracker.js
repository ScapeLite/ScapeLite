// ScapeLite Fortress tracker (window.__ccFortress). DISPLAY-ONLY: it reads what the game already shows (the Fortress HUD and the game chat) and keeps its own history.
//
// What the game gives us, and how it is used:
//   - the Fortress HUD ("The Fortress . Wave 20 - under attack! . Survived 19", the loot-chance pills per tier, and the contribution lists in the bar tooltips):
//       every time "Survived" goes up one wave was cleared, and each cleared wave is one roll for a Fortress rare per unlocked tier at the chance the HUD showed;
//   - the game chat: "The Fortress: your army survived N waves." (end of a run), "The Fortress reward: 23x [T3] Item!" (the run's rewards),
//     "X received the [T2] Fortress Ledger!" and "The Fortress dropped X!" (drops).
// Luck = the drops you got against the drops the rolls were expected to give (expected = the sum of the per-wave chances over the waves you were eligible for;
// eligible = your contribution is at least 5% of the army's, the game's own minimum, shown here as an approximation).
// Expected is a COUNT (the sum of the per-wave chances). The chance of at least one drop is NOT that sum: it is 1 - the product of (1 - chance) over every roll
// (100 waves at 1% = 1.00 expected, but a 63% chance of at least one).
// Everything is kept in the browser (cc-fortress-v1): the last 300 runs and the last 1000 drops. The Drop Luck panel shows it on its Fortress tab.
(function () {
  'use strict';
  const NS = '__ccFortress';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }
  const life = window.__ccLife.scope('fortress-tracker');
  const qa = (s) => window.__ccDom.qa(s);

  const LS = 'cc-fortress-v1', KEEP_RUNS = 300, KEEP_DROPS = 1000, MIN_SHARE = 0.05, END_AFTER_MS = 8000, REWARD_WINDOW_MS = 120000;
  const TIERS = ['t1', 't2', 't3', 't4', 't5', 'c'];
  const TIER_LABEL = { t1: 'Tier 1', t2: 'Tier 2', t3: 'Tier 3', t4: 'Tier 4', t5: 'Tier 5', c: 'Chaos' };
  const enabled = () => { try { const v = window.__ccPluginSettings.get('fortressTrackerEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };

  // ---------------------------------------------------------------- store
  let store = { v: 1, runs: [], drops: [] };
  try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && Array.isArray(s.runs) && Array.isArray(s.drops)) store = s; } catch (e) { /* start empty */ }
  let saveT = 0;
  // The run in progress is saved too, so a reload or restart in the middle of a run resumes it (expected drops and chances included) instead of starting over
  const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 500); };
  function flush() { try { localStorage.setItem(LS, JSON.stringify({ v: 1, runs: store.runs.slice(-KEEP_RUNS), drops: store.drops.slice(-KEEP_DROPS), active: run ? Object.assign({}, run, { lastRates, lastShare, lastSeen: lastHudAt || Date.now() }) : null })); } catch (e) { /* storage blocked */ } }
  life.add(() => { clearTimeout(saveT); flush(); });

  // ---------------------------------------------------------------- reading the HUD
  const num = (t) => { const n = parseFloat(String(t).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
  const hudEl = () => qa('.gauntlet-hud').find((e) => e.getClientRects().length > 0) || null;
  function readHud(h) {
    const head = ((h.querySelector('.gauntlet-hud-header') || {}).textContent || '').replace(/\s+/g, ' ');
    const w = /Wave (\d+)/.exec(head), sv = /Survived (\d+)/.exec(head);
    const s = { wave: w ? +w[1] : 0, survived: sv ? +sv[1] : 0, phase: /under attack/i.test(head) ? 'wave' : /Upcoming/i.test(head) ? 'prep' : 'other', rates: {}, mine: 0, total: 0, names: [] };
    h.querySelectorAll('.gauntlet-hud-rares .raid-contrib-spec-pill').forEach((p) => {
      const k = TIERS.find((t) => p.classList.contains('spec-' + t)); if (!k) return;
      const lab = ((p.querySelector('.spec-pill-label') || {}).textContent || '').trim(), m = /([\d.]+)%/.exec(lab);
      s.rates[k] = m ? parseFloat(m[1]) / 100 : null;   // null = not unlocked yet
    });
    // the bar tooltips list "Army total: N" and who contributed what ("You: 1,482 (100%)")
    h.querySelectorAll('.gauntlet-hud-barwrap:not(.mirrored)').forEach((bw) => {
      let tot = 0, mine = 0;
      bw.querySelectorAll('.tt-line').forEach((l) => {
        const t = (l.textContent || '').trim(), a = /^Army total:\s*([\d,]+)/.exec(t), c = /^(.+?):\s*([\d,]+)\s*\((\d+)%\)\s*$/.exec(t);
        if (a) tot = num(a[1]); else if (c) { if (c[1].toLowerCase() === 'you') mine = num(c[2]); else if (!s.names.includes(c[1])) s.names.push(c[1]); }
      });
      s.total += tot; s.mine += mine;
    });
    return s;
  }
  const shareOf = (s) => (s.total > 0 ? s.mine / s.total : 0);

  // ---------------------------------------------------------------- runs
  let run = null, lastHudAt = 0, lastRates = {}, lastShare = 0;
  let pending = store.active || null; delete store.active;   // a run that was open when the page went away: resumed if the HUD still shows it, else closed
  const newRun = (s, partial) => ({ id: Date.now(), start: Date.now(), end: 0, survived: s.survived, waves: s.survived, partial: !!partial, rolls: 0, skipped: 0, expected: { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0 }, logDry: { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0 }, shareSum: 0, shareN: 0, party: s.names.slice(), drops: 0, rewards: 0 });
  const lgRun = (r) => { try { const l = window.__ccLog && window.__ccLog.channel('Fortress'); if (l) l.info('Fortress run: ' + (r.waves || 0) + ' wave(s), ' + Math.round(((r.end || Date.now()) - r.start) / 1000) + 's' + (r.partial ? ' (partial)' : ''), { run: { id: r.id, start: r.start, end: r.end, waves: r.waves, survived: r.survived, partial: !!r.partial, rolls: r.rolls, drops: r.drops, rewards: r.rewards } }); } catch (e) { /* never */ } };
  const lgDrop = (d) => { try { const l = window.__ccLog && window.__ccLog.channel('Drops', 'fortress'); if (l) l.info('Fortress drop: ' + (d.item || d.name || d.kind || 'item') + (d.mine ? '' : ' (not yours)'), { drop: d }); } catch (e) { /* never */ } };
  function finalize(waves) {
    if (!run) return;
    run.end = Date.now(); if (waves != null) run.waves = Math.max(run.survived, waves); else run.waves = run.survived;
    store.runs.push(run); lgRun(run); run = null; save();
  }
  const bootAt = Date.now();
  let lastFlushAt = 0;
  function closePending() {   // the saved run is over (or too old): it goes into the history as it stood
    if (!pending) return; const r = pending; pending = null;
    r.end = r.lastSeen || Date.now(); r.waves = r.survived; delete r.lastRates; delete r.lastShare; delete r.lastSeen; store.runs.push(r); lgRun(r); save();
  }
  function tick() {
    if (!enabled()) { return; }
    const h = hudEl(), now = Date.now();
    if (!h) { if (run && now - lastHudAt > END_AFTER_MS) finalize(); if (pending && now - bootAt > 45000) closePending(); return; }
    lastHudAt = now;
    const s = readHud(h);
    if (!s.survived && !s.wave) return;   // the HUD is still empty
    if (pending) { if (!run && s.survived >= pending.survived && now - pending.lastSeen < 6 * 3600 * 1000) { lastRates = pending.lastRates || {}; lastShare = pending.lastShare || 0; run = pending; delete run.lastRates; delete run.lastShare; delete run.lastSeen; pending = null; } else closePending(); }
    if (run && s.survived < run.survived) finalize();   // a new run started while the old one was still open
    if (!run) { run = newRun(s, s.survived > 0); lastRates = {}; lastShare = 0; }   // a new run starts from nothing: no chances or share carried over from the last one
    if (!run.rateAt) run.rateAt = {};
    if (s.survived > run.survived) {
      // Each newly cleared wave k is one roll per unlocked tier at the chance the HUD showed WHILE wave k was the current wave (remembered per wave, so a HUD refresh
      // at the very moment of the clear cannot swap in the next wave's chances). Waves cleared while we were not looking use the nearest earlier chances.
      for (let k = run.survived + 1; k <= s.survived; k++) {
        let r = run.rateAt[k]; if (!r) { const ks = Object.keys(run.rateAt).map(Number).filter((n) => n <= k).sort((a, b) => b - a); r = ks.length ? run.rateAt[ks[0]] : lastRates; }
        if (!run.logDry) run.logDry = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0 };
        if (lastShare >= MIN_SHARE) { TIERS.forEach((t) => { if (r && r[t]) { run.expected[t] += r[t]; run.logDry[t] += Math.log(1 - Math.min(r[t], 0.999999)); } }); run.rolls++; } else run.skipped++;   // expected count = sum of the chances; P(none) = product of (1 - chance)
      }
      Object.keys(run.rateAt).forEach((k) => { if (+k < s.survived - 2) delete run.rateAt[k]; });
    }
    if (TIERS.some((t) => s.rates[t] != null)) run.rateAt[s.wave] = s.rates;
    const moved = run.survived !== s.survived; run.survived = s.survived; run.waves = s.survived;
    if (moved || now - lastFlushAt > 15000) { lastFlushAt = now; save(); }   // the run in progress is written when it moves on, and at least every 15 s
    if (TIERS.some((t) => s.rates[t] != null)) lastRates = s.rates;
    if (s.total > 0) { lastShare = shareOf(s); run.shareSum += lastShare; run.shareN++; }
    s.names.forEach((n) => { if (!run.party.includes(n)) run.party.push(n); });
    live = s;
  }
  let live = null;

  // ---------------------------------------------------------------- the game chat
  const who = () => { try { const w = window.__ccBridge.whoami(); return w ? [String(w.name).toLowerCase(), String(w.display).toLowerCase(), 'you'] : ['you']; } catch (e) { return ['you']; } };
  const tierOf = (item) => { const m = /\[(T\d|C\d*)\]/i.exec(item); return m ? m[1].toLowerCase().replace(/^c\d+$/, 'c') : ''; };
  const kindOf = (item) => (/ledger|banner/i.test(item) ? 'milestone' : 'rare');
  const seen = new Set();
  function addDrop(d) {
    const r = run || store.runs[store.runs.length - 1];
    d.t = Date.now(); d.runId = r ? r.id : 0; d.wave = run ? run.survived : (r ? r.waves : 0);
    store.drops.push(d); lgDrop(d);
    if (r && d.mine) { if (d.kind === 'reward') r.rewards++; else r.drops++; }
    save();
  }
  function onLine(text, channel, ts) {
    const t = text.replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '').replace(/^★\s*/, '').trim(), key = ts + '|' + t;
    if (seen.has(key)) return; seen.add(key); if (seen.size > 400) seen.delete(seen.values().next().value);
    let m;
    if ((m = /army survived ([\d,]+) waves?/i.exec(t)) && /Fortress/.test(t)) {
      const n = num(m[1]);
      if (run) finalize(n); else { const r = store.runs[store.runs.length - 1]; if (r && Date.now() - r.end < REWARD_WINDOW_MS) { r.waves = Math.max(r.waves, n); save(); } }
      return;
    }
    if (channel !== 'game') return;   // the same line also arrives on the proximity channel for teammates: count the game-channel copy only
    if ((m = /^The Fortress reward:\s*(?:([\d,]+)x\s+)?(.+?)!?$/i.exec(t))) { const item = m[2].trim(); addDrop({ kind: 'reward', item, qty: m[1] ? num(m[1]) : 1, tier: tierOf(item), mine: true, who: '' }); return; }
    if ((m = /^The Fortress dropped\s+(.+?)!?$/i.exec(t))) { const item = m[1].trim(); addDrop({ kind: kindOf(item), item, qty: 1, tier: tierOf(item), mine: true, who: '' }); return; }
    if ((m = /^(.+?) received the (.+?)!?$/i.exec(t)) && (/Fortress/i.test(m[2]) || (run && Date.now() - lastHudAt < END_AFTER_MS))) {
      const name = m[1].trim(), item = m[2].trim(); addDrop({ kind: kindOf(item), item, qty: 1, tier: tierOf(item), mine: who().includes(name.toLowerCase()), who: name });
    }
  }
  let area = null, obs = null;
  const lineOf = (n) => { if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains('chat-message')) return; onLine(n.textContent || '', n.dataset.channel || 'game', ((n.querySelector('.chat-timestamp') || {}).textContent || '')); };
  function attach() {
    const a = window.__ccDom.q('.chat-panel .chat-message-area');
    if (a === area) return;
    if (obs) obs.disconnect();
    area = a; if (!a) return;
    Array.from(a.children).forEach((n) => { n.nodeType === 1 && seen.add(((n.querySelector('.chat-timestamp') || {}).textContent || '') + '|' + (n.textContent || '').replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '').replace(/^★\s*/, '').trim()); });   // what is already there was not seen live: never counted
    obs = new MutationObserver((recs) => { if (!enabled()) return; recs.forEach((r) => r.addedNodes.forEach(lineOf)); });
    obs.observe(a, { childList: true });
  }

  // ---------------------------------------------------------------- numbers for the view
  const pois = (k, l) => { let term = Math.exp(-l), cum = 0; for (let i = 0; i < k; i++) { cum += term; term *= l / (i + 1); } return cum + 0.5 * term; };   // P(fewer than k) + half of P(exactly k)
  function luck() {
    const lnNone = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0 }, exp = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0 }, act = { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, c: 0, other: 0 };
    const runs = store.runs.concat(run ? [run] : (pending ? [pending] : []));
    // exact: the chance of NO drop over all rolls is the product of (1 - chance) of every roll (runs saved before this was kept fall back to exp(-expected))
    runs.forEach((r) => TIERS.forEach((t) => { const e = (r.expected && r.expected[t]) || 0; exp[t] += e; lnNone[t] += r.logDry ? r.logDry[t] || 0 : -e; }));
    store.drops.forEach((d) => { if (d.mine && d.kind === 'rare') { if (act[d.tier] != null) act[d.tier]++; else act.other++; } });
    const E = TIERS.reduce((s, t) => s + exp[t], 0), A = TIERS.reduce((s, t) => s + act[t], 0) + act.other;
    const none = {}; TIERS.forEach((t) => { none[t] = Math.exp(lnNone[t]); });
    const noneAll = Math.exp(TIERS.reduce((a, t) => a + lnNone[t], 0));
    return { exp, act, E, A, none, noneAll, atLeast: 1 - noneAll, dry: noneAll, pctl: E > 0 ? pois(A, E) : 0.5, waves: runs.reduce((s, r) => s + (r.rolls || 0), 0) };
  }
  // The maths of one run (or of everything): per tier the expected COUNT (sum of the chances), the drops you got, P(none) = product of (1 - chance), and P(at least one) = 1 - P(none)
  function runStats(r) {
    const st = {}; let lnAll = 0, E = 0, A = 0;
    TIERS.forEach((t) => {
      const e = (r.expected && r.expected[t]) || 0, ln = r.logDry ? r.logDry[t] || 0 : -e;   // runs saved before the product was kept fall back to exp(-expected)
      const got = store.drops.filter((d) => d.runId === r.id && d.mine && d.kind === 'rare' && d.tier === t).length;
      st[t] = { e, got, none: Math.exp(ln), atLeast: 1 - Math.exp(ln) }; lnAll += ln; E += e; A += got;
    });
    const other = store.drops.filter((d) => d.runId === r.id && d.mine && d.kind === 'rare' && !TIERS.includes(d.tier)).length;
    return { tiers: st, E, A: A + other, other, none: Math.exp(lnAll), atLeast: 1 - Math.exp(lnAll), rolls: r.rolls || 0 };
  }
  const gameStats = () => { try { const d = window.__ccBridge.dropState(), g = (d.raids || []).find((r) => r.id === 'gauntlet'); return g ? { kc: g.kc, best: g.bestWave } : null; } catch (e) { return null; } };

  // ---------------------------------------------------------------- the view (the Fortress tab of the Drop Luck panel builds its body here, in that panel's own look)
  const style = document.createElement('style'); style.id = 'cc-fortress-style';
  style.textContent = `
#cc-droplog .ft-live{padding:9px 11px;border-radius:10px;background:var(--cc-bg-2);border:1px solid var(--cc-border);margin-top:8px}
#cc-droplog .ft-live .hd2{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
#cc-droplog .ft-live .hd2 b{font-size:15px;color:var(--cc-text)}
#cc-droplog .ft-badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:700;border:1px solid var(--cc-border-strong);color:var(--cc-text-dim);white-space:nowrap}
#cc-droplog .ft-badge.ok{color:var(--cc-good);border-color:var(--cc-good)}#cc-droplog .ft-badge.no{color:var(--cc-bad);border-color:var(--cc-bad)}
#cc-droplog .ft-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
#cc-droplog .ft-pill{padding:2px 8px;border-radius:7px;background:var(--cc-bg-3);font-size:12px;color:var(--cc-text-dim)}
#cc-droplog .ft-pill b{color:var(--cc-text)}#cc-droplog .ft-pill.off{opacity:.45}
#cc-droplog .ft-tbl{display:grid;grid-template-columns:1.3fr .8fr .6fr 1fr;gap:2px 8px;font-size:12.5px;margin-top:6px;padding:7px 9px;border-radius:8px;background:var(--cc-bg-2)}
#cc-droplog .ft-tbl .th{color:var(--cc-text-faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
#cc-droplog .ft-tbl .r{text-align:right;font-variant-numeric:tabular-nums}
#cc-droplog .ft-det{margin-top:5px}
#cc-droplog .ft-det summary .n{flex:none}
#cc-droplog .ft-run{padding:2px 0 4px}
#cc-droplog .ft-log{display:flex;flex-direction:column;gap:3px;margin-top:6px}
#cc-droplog .ft-log .li{display:flex;gap:8px;align-items:baseline;padding:4px 8px;border-radius:7px;background:var(--cc-bg-2);font-size:12.5px}
#cc-droplog .ft-log .li .t{color:var(--cc-text-faint);font-size:11.5px;min-width:76px}
#cc-droplog .ft-log .li .n{flex:1;min-width:0;color:var(--cc-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cc-droplog .ft-log .li.mate .n{color:var(--cc-text-dim)}#cc-droplog .ft-log .li.rare .n{color:var(--cc-accent);font-weight:650}#cc-droplog .ft-log .li.milestone .n{color:var(--cc-info)}
#cc-droplog .ft-log .li .w{color:var(--cc-text-dim);font-size:11.5px}
`;
  document.head.appendChild(style); life.add(() => style.remove());
  const when = (t) => { const d = new Date(t), p = (v) => String(v).padStart(2, '0'); return window.__ccUI && window.__ccUI.fmt && window.__ccUI.fmt.clock ? window.__ccUI.fmt.clock(d) : p(d.getHours()) + ':' + p(d.getMinutes()); };
  const dayOf = (t) => { const d = new Date(t); return d.toDateString() === new Date().toDateString() ? 'Today' : (d.getMonth() + 1) + '/' + d.getDate(); };
  const dur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
  const pc = (p) => (p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p > 0 ? (p * 100).toFixed(2) : '0') + '%';

  // ui = { h(tag, cls, text), hero(pctl, obtained, expected, basisLabel, basisNum, unit) } from the Drop Luck panel
  let showAllLog = false;
  const openRuns = new Set();   // history rows that are open (the tab redraws every second while a run is live)
  function tierTable(h, st) {
    const tbl = h('div', 'ft-tbl');
    ['Tier', 'Expected', 'Got', 'Chance of 1+'].forEach((t, i) => tbl.appendChild(h('div', 'th' + (i ? ' r' : ''), t)));
    let rows = 0;
    TIERS.forEach((t) => {
      const x = st.tiers[t]; if (!(x.e > 0) && !x.got) return; rows++;
      tbl.appendChild(h('div', null, TIER_LABEL[t])); tbl.appendChild(h('div', 'r', x.e.toFixed(2))); tbl.appendChild(h('div', 'r ' + (x.got >= x.e ? 'good' : x.got === 0 && x.e >= 1 ? 'bad' : ''), String(x.got))); tbl.appendChild(h('div', 'r', pc(x.atLeast)));
    });
    if (st.other) { rows++; tbl.appendChild(h('div', null, 'Other')); tbl.appendChild(h('div', 'r', '-')); tbl.appendChild(h('div', 'r good', String(st.other))); tbl.appendChild(h('div', 'r', '-')); }
    return rows ? tbl : null;
  }
  // The numbers of one run: totals line, the tier table and the formula with this run's own values
  function runBody(h, r) {
    const st = runStats(r), box = h('div', 'ft-run');
    box.appendChild(h('div', 'note', st.rolls + ' wave' + (st.rolls === 1 ? '' : 's') + ' rolled' + (r.skipped ? ' (' + r.skipped + ' without enough share)' : '') + ' · ' + st.E.toFixed(2) + ' rares expected · ' + st.A + ' got · ' + pc(st.atLeast) + ' chance of at least one' + (r.shareN ? ' · your share about ' + Math.round(r.shareSum / r.shareN * 100) + '%' : '') + (r.partial ? ' · started mid-run, earlier waves not counted' : '')));
    const tb = tierTable(h, st); if (tb) box.appendChild(tb);
    box.appendChild(h('div', 'note', 'Expected = sum of the chances of every roll. Chance of none = product of (1 - chance) = ' + pc(st.none) + '; chance of at least one = 1 - that = ' + pc(st.atLeast) + '.'));
    return box;
  }
  const redraw = () => { if (window.__ccDropLuck) window.__ccDropLuck.render(); };
  function renderTab(bd, ui) {
    const h = ui.h, L = luck(), lv = api.live(), gs = gameStats();
    // verdict
    if (L.E >= 0.05) {
      const hero = ui.hero(L.pctl, L.A, L.E, 'waves rolled', L.waves, 'rares');
      const p = hero.querySelector('.p');
      if (p) p.textContent = 'Over ' + L.waves + ' waves you had a ' + pc(L.atLeast) + ' chance of at least one rare by now (' + L.E.toFixed(2) + ' expected) · luckier than about ' + Math.round(L.pctl * 100) + '% of players with the same waves' + (L.A === 0 ? ' · chance of having none: ' + pc(L.noneAll) : '');
      bd.appendChild(hero);
    } else {
      const hr = h('div', 'hero'); hr.appendChild(h('div', 'v mid', 'Tracking started'));
      hr.appendChild(h('div', 'p', 'Clear a few waves in the Fortress and your luck shows up here. The tracker reads the Fortress HUD and the game chat, so keep the Fortress HUD on screen.'));
      bd.appendChild(hr);
    }
    // live run
    if (lv && lv.hud) {
      const r = lv.run, s = lv.hud, box = h('div', 'ft-live');
      const hd = h('div', 'hd2'); hd.appendChild(h('b', null, 'Live run · wave ' + s.wave + ' · survived ' + s.survived + (s.phase === 'wave' ? ' · under attack' : s.phase === 'prep' ? ' · preparing' : '')));
      const bg = h('span', 'ft-badge ' + (lv.eligible ? 'ok' : 'no'), 'Your share ' + Math.round(lv.share * 100) + '%' + (lv.eligible ? ' · eligible' : ' · under ' + Math.round(MIN_SHARE * 100) + '%'));
      bg.title = 'The game only rolls loot for players who contributed at least 5% of the army (approximated from the HUD tooltips).'; hd.appendChild(bg);
      box.appendChild(hd);
      const pills = h('div', 'ft-pills');
      TIERS.forEach((t) => { const p = lv.rates[t], e = h('span', 'ft-pill' + (p ? '' : ' off')); e.appendChild(document.createTextNode(TIER_LABEL[t] + ' ')); e.appendChild(h('b', null, p ? pc(p) : '-')); e.title = p ? TIER_LABEL[t] + ' rare chance per cleared wave' : 'Unlocks deeper into the run'; pills.appendChild(e); });
      box.appendChild(pills);
      box.appendChild(runBody(h, r));
      bd.appendChild(box);
    }
    // by tier (everything tracked)
    bd.appendChild(h('h5', null, 'By tier · all tracked runs'));
    { const all = { tiers: {}, other: L.act.other }; TIERS.forEach((t) => { all.tiers[t] = { e: L.exp[t], got: L.act[t], atLeast: 1 - L.none[t] }; }); const tb = tierTable(h, all); bd.appendChild(tb || h('div', 'note', 'No waves rolled yet.')); }
    // drops
    const drops = api.drops(); bd.appendChild(h('h5', null, 'Drops and rewards'));
    if (!drops.length) bd.appendChild(h('div', 'note', 'Nothing seen yet. Rewards, rares and ledgers show up here as they arrive.'));
    else {
      const log = h('div', 'ft-log');
      drops.slice(0, showAllLog ? 120 : 12).forEach((d) => {
        const li = h('div', 'li ' + (d.mine ? d.kind : 'mate')); li.appendChild(h('span', 't', dayOf(d.t) + ' ' + when(d.t)));
        li.appendChild(h('span', 'n', (d.qty > 1 ? d.qty + 'x ' : '') + d.item + (d.mine ? '' : ' · ' + d.who)));
        li.appendChild(h('span', 'w', d.kind === 'reward' ? 'reward' : 'wave ' + d.wave)); log.appendChild(li);
      });
      bd.appendChild(log);
      if (drops.length > 12) { const mb = h('button', 'more', showAllLog ? 'Show fewer' : 'Show more'); mb.type = 'button'; mb.addEventListener('click', () => { showAllLog = !showAllLog; redraw(); }); bd.appendChild(mb); }
    }
    // history
    const runs = api.runs(); bd.appendChild(h('h5', null, 'Run history'));
    if (!runs.length) bd.appendChild(h('div', 'note', 'Finished runs are listed here.'));
    else runs.slice(0, 25).forEach((r) => {
      const st = runStats(r), det = h('details'), sm = h('summary');
      det.className = 'ft-det'; if (openRuns.has(r.id)) det.open = true; det.addEventListener('toggle', () => { if (det.open) openRuns.add(r.id); else openRuns.delete(r.id); });
      sm.appendChild(h('span', 'n', r.waves + ' waves'));
      sm.appendChild(h('span', 'c', dayOf(r.start) + ' ' + when(r.start) + ' · ' + dur((r.end || Date.now()) - r.start) + ' · ' + st.E.toFixed(2) + ' exp · ' + st.A + ' got · ' + pc(st.atLeast) + ' for 1+' + (r.partial ? ' · partial' : '')));
      det.appendChild(sm);
      det.appendChild(runBody(h, r));
      const mine = store.drops.filter((d) => d.runId === r.id).sort((x, y) => x.t - y.t);
      if (mine.length) { const lg = h('div', 'ft-log'); mine.forEach((d) => { const li = h('div', 'li ' + (d.mine ? d.kind : 'mate')); li.appendChild(h('span', 't', when(d.t))); li.appendChild(h('span', 'n', (d.qty > 1 ? d.qty + 'x ' : '') + d.item + (d.mine ? '' : ' · ' + d.who))); li.appendChild(h('span', 'w', d.kind === 'reward' ? 'reward' : 'wave ' + d.wave)); lg.appendChild(li); }); det.appendChild(lg); }
      if ((r.party || []).length) det.appendChild(h('div', 'note', 'Party: ' + r.party.join(', ')));
      bd.appendChild(det);
    });
    // lifetime
    const tw = store.runs.reduce((a, r) => a + r.waves, 0);
    bd.appendChild(h('div', 'note', (gs ? 'The game counts ' + gs.kc + ' Fortress runs (best wave ' + gs.best + '). ' : '') + 'Tracked by ScapeLite: ' + store.runs.length + ' runs, ' + tw + ' waves, ' + store.drops.filter((d) => d.mine && d.kind === 'rare').length + ' rares. Expected rares use the HUD per-wave chances and your contribution; the dry chance is exp(-expected).'));
    const clr = h('button', 'more', 'Clear Fortress history'); clr.type = 'button';
    clr.addEventListener('click', () => { if (clr.dataset.sure) { api.clear(); redraw(); } else { clr.dataset.sure = '1'; clr.textContent = 'Click again to clear everything tracked'; setTimeout(() => { delete clr.dataset.sure; clr.textContent = 'Clear Fortress history'; }, 4000); } });
    bd.appendChild(clr);
  }

  const api = {
    version: 1, TIERS, TIER_LABEL, MIN_SHARE, enabled, runStats,
    live: () => (run ? { run, hud: live, share: lastShare, rates: (live && TIERS.some((t) => live.rates[t] != null)) ? live.rates : lastRates, eligible: lastShare >= MIN_SHARE } : null),
    runs: () => store.runs.slice().reverse(), drops: () => store.drops.slice().reverse(), luck, gameStats,
    clear() { store = { v: 1, runs: [], drops: [] }; run = null; save(); }, renderTab,
  };

  life.every(500, () => { try { tick(); } catch (e) { /* never break the page */ } }, { always: true });   // a run goes on while the window is covered: never rests in eco mode
  life.every(2000, () => { try { attach(); } catch (e) { /* chat not ready */ } }, { always: true });
  life.add(() => { if (obs) obs.disconnect(); });
  attach();
  function teardown() { try { life.dispose(); } catch (e) { /* nothing left to undo */ } if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc fortress-tracker torn down'; }
  window[NS] = Object.assign(api, { teardown });
  return 'cc fortress-tracker loaded';
})();
