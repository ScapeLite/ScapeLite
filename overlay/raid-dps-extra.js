// ScapeLite Raid DPS extras. Display only: adds to the game's Raid DPS panel
//  * a "Party" line under the player rows: the whole party's damage so far and combined damage per second (all players added up),
//  * a "Graph" tab next to DPS Current / DPS Total / Recap: every player's damage per second over time (and a Party line), or their
//    total damage over time, so you can see who carried which wave and compare raids. Choose the time range (current fight, entire raid,
//    last 1 or 5 minutes) and how strongly the lines are smoothed.
// It only reads the numbers the panel already shows (name, damage, rate) once a second; nothing is sent or clicked in the game.
(function () {
  'use strict';
  const NS = '__ccRaidDps';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('raidDpsExtraEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const COLORS = ['#5fe06d', '#4ea3ff', '#ffb84a', '#ff6f91', '#b48cff', '#3fd8c8', '#e8e05a'];
  const SAMPLE_MS = 1000, MAX_PTS = 4000;
  const LS_PREF = 'cc-raiddps-graph';
  let range = 'fight', smooth = 15;            // range: fight | raid | 1 | 5 (minutes); smooth: seconds of averaging for DPS
  try { const q = JSON.parse(localStorage.getItem(LS_PREF) || '{}'); if (q.range) range = q.range; if (q.smooth) smooth = q.smooth; } catch (e) {}
  const savePref = () => { try { localStorage.setItem(LS_PREF, JSON.stringify({ range, smooth })); } catch (e) {} };

  const style = document.createElement('style');
  style.id = 'cc-rdps-style';
  style.textContent = `
.cc-rdps-total{display:flex;align-items:baseline;gap:8px;margin:4px 0 0;padding:4px 8px;border-radius:6px;background:rgba(255,210,74,.10);border:1px solid rgba(255,210,74,.35);font:600 12.5px/1.3 system-ui,sans-serif;color:var(--cc-accent)}
.cc-rdps-total .n{flex:1}
.cc-rdps-total b{color:var(--cc-text)}
.cc-rdps-total .s{color:#b8a86a;font-weight:500;font-size:11.5px}
.cc-rdps-graph{display:none;padding:6px 8px 8px;font:12px/1.35 system-ui,sans-serif;color:var(--cc-text)}
.cc-rdps-graph.show{display:block}
.cc-rdps-graph canvas{display:block;width:100%;height:150px;border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08)}
.cc-rdps-graph .bar{display:flex;gap:4px;margin-bottom:5px}
.cc-rdps-graph .bar.sm button{padding:1px 4px;font-size:11.5px}
.cc-rdps-graph .bar button{flex:1;background:var(--cc-bg-3);color:var(--cc-text-dim);border:1px solid var(--cc-border);border-radius:6px;padding:2px 4px;font:inherit;cursor:pointer}
.cc-rdps-graph .bar button.on{border-color:var(--cc-accent);color:var(--cc-accent);background:var(--cc-accent-bg)}
.cc-rdps-graph .leg{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:5px}
.cc-rdps-graph .leg span{display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap}
.cc-rdps-graph .leg i{width:9px;height:9px;border-radius:2px;display:inline-block}
.cc-rdps-graph .leg span.off{opacity:.35}
.cc-rdps-graph .tip{margin-top:4px;color:var(--cc-text-dim);min-height:15px}
.cc-rdps-graph{position:relative}
.cc-rdps-ptip{position:absolute;z-index:6;min-width:150px;padding:6px 9px;border-radius:8px;background:rgba(18,18,26,.96);border:1px solid rgba(255,255,255,.22);box-shadow:0 6px 18px rgba(0,0,0,.65);pointer-events:none;font:12px/1.45 system-ui,sans-serif}
.cc-rdps-ptip .th{color:var(--cc-text-dim);margin-bottom:3px;font-size:11.5px}
.cc-rdps-ptip .tr{display:flex;align-items:center;gap:7px}
.cc-rdps-ptip .tr i{width:9px;height:9px;border-radius:2px;flex:none}
.cc-rdps-ptip .tr span{flex:1;color:var(--cc-text)}
.cc-rdps-ptip .tr b{color:var(--cc-text)}
.cc-rdps-ptip .tr.party{margin-top:3px;padding-top:3px;border-top:1px solid rgba(255,255,255,.18)}
.cc-rdps-tip{position:absolute;z-index:5;width:186px;padding:7px 9px;border-radius:8px;background:var(--cc-bg-2);border:1px solid rgba(255,255,255,.2);box-shadow:0 6px 18px rgba(0,0,0,.6);pointer-events:none;font:12px/1.4 system-ui,sans-serif}
.cc-rdps-tip b{display:block;margin-bottom:3px;font-size:13px}
.cc-rdps-tip div{display:flex;justify-content:space-between;gap:8px}
.cc-rdps-tip span{color:var(--cc-text-dim)}.cc-rdps-tip i{font-style:normal;color:var(--cc-text);font-weight:600}
.cc-rdps-tip small{display:block;margin-top:4px;color:var(--cc-text-faint);font-size:10.5px}
.raid-contrib-tab.cc-rdps-tab{cursor:pointer}
.raid-contrib-tabs.cc-rdps-4{top:4px !important;gap:3px !important}
.raid-contrib-tabs.cc-rdps-4 .raid-contrib-tab{height:31px !important;min-height:0 !important;padding-top:0 !important;padding-bottom:0 !important;line-height:31px !important}
.raid-contrib-hud:has(.raid-contrib-tabs.cc-rdps-4){min-height:150px}
`;
  document.head.appendChild(style);

  // ---- sampling
  let run = { key: '', t0: 0, wave: '', waveAt: 0, pl: {} };   // pl[name] = [{t, d}]; waveAt = when the current wave/fight began
  let hoverXY = null;
  let lastSeen = 0, metric = 'dps', hidden = new Set(), graphOn = false, hover = null;
  const num = (s) => { const m = /([\d,]+)/.exec(s || ''); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
  function readRows(hud) {
    const out = [];
    hud.querySelectorAll('.raid-contrib-rows .raid-contrib-row').forEach((r) => {
      const name = ((r.querySelector('.raid-contrib-name') || {}).textContent || '').trim();
      const dmgTxt = ((r.querySelector('.raid-contrib-dmg') || {}).textContent || '');
      const d = num(dmgTxt.split('·')[0]), rm = /([\d.,]+)\s*\/s/.exec(dmgTxt);
      if (name && d != null) out.push({ name, d, rate: rm ? parseFloat(rm[1].replace(/,/g, '')) : 0, self: r.classList.contains('is-self') });
    });
    return out;
  }
  const raidName = (hud) => (((hud.querySelector('.raid-contrib-progress .raid-contrib-name') || {}).textContent || '').replace(/\s*\(.*$/, '').trim());
  function sample(hud) {
    const now = Date.now(), name = raidName(hud), rows = readRows(hud);
    if (!rows.length) return rows;
    if (run.key !== name || now - lastSeen > 20000) run = { key: name, t0: now, wave: '', waveAt: now, pl: {} };   // a new raid, or the panel was gone for a while
    const wv = ((hud.querySelector('.raid-contrib-progress .raid-contrib-name') || {}).textContent || '').replace(/^.*\(/, '').replace(/\).*$/, '');
    if (wv && wv !== run.wave) { if (run.wave) run.waveAt = now; run.wave = wv; }                  // "4/7" -> "5/7": the next fight started
    lastSeen = now;
    const active = (hud.querySelector('.raid-contrib-tab.active:not(.cc-rdps-tab)') || {}).dataset;
    const scopeOk = !active || active.tab !== 'total';                                       // the Total tab counts the whole session, not this run
    rows.forEach((r) => {
      if (!scopeOk) return;
      const a = run.pl[r.name] || (run.pl[r.name] = []), last = a[a.length - 1];
      if (!last || last.d !== r.d || now - last.t >= 2500) { a.push({ t: now, d: r.d }); if (a.length > MAX_PTS) a.shift(); }
    });
    return rows;
  }
  // damage per second at time t for one player: damage over the last few seconds
  function dpsAt(a, t) {
    let lo = null, hi = null;
    for (let i = a.length - 1; i >= 0; i--) { if (a[i].t <= t && !hi) hi = a[i]; if (a[i].t <= t - (smooth || 2) * 1000) { lo = a[i]; break; } }
    if (!hi) return 0; if (!lo) lo = a[0];
    const dt = (hi.t - lo.t) / 1000; return dt > 0.5 ? Math.max(0, (hi.d - lo.d) / dt) : 0;
  }
  const dmgAt = (a, t) => { let v = 0; for (let i = 0; i < a.length && a[i].t <= t; i++) v = a[i].d; return v; };

  // ---- UI pieces
  let totalEl = null, graphEl = null, tabEl = null, cv = null;
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  function ensure(hud) {
    const dps = hud.querySelector('.raid-contrib-dps'), tabs = hud.querySelector('.raid-contrib-tabs');
    if (!dps || !tabs) return false;
    if (!totalEl || !totalEl.isConnected) { totalEl = document.createElement('div'); totalEl.className = 'cc-rdps-total'; totalEl.innerHTML = '<span class="n">Party</span><b></b><span class="s"></span>'; dps.appendChild(totalEl); }
    if (!tabEl || !tabEl.isConnected) {
      tabEl = document.createElement('button'); tabEl.type = 'button'; tabEl.className = 'raid-contrib-tab cc-rdps-tab'; tabEl.textContent = 'Graph';
      tabEl.addEventListener('click', (e) => { e.stopPropagation(); setGraph(true); });
      tabs.appendChild(tabEl); tabs.classList.add('cc-rdps-4');
      // the game's own tabs switch the graph off
      tabs.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.raid-contrib-tab'); if (b && b !== tabEl) setGraph(false); }, true);
    }
    if (!graphEl || !graphEl.isConnected) {
      graphEl = document.createElement('div'); graphEl.className = 'cc-rdps-graph';
      graphEl.innerHTML = '<div class="bar"><button data-m="dps">DPS</button><button data-m="dmg">Total damage</button></div><div class="bar sm rng"><button data-r="fight">Current fight</button><button data-r="raid">Entire raid</button><button data-r="1">1 min</button><button data-r="5">5 min</button></div><div class="bar sm smo"><span style="color:#8f8fa4;align-self:center">Smoothing</span><button data-s="0">Off</button><button data-s="6">Low</button><button data-s="15">Medium</button><button data-s="30">High</button></div><canvas></canvas><div class="leg"></div><div class="tip"></div>';
      cv = graphEl.querySelector('canvas');
      graphEl.querySelectorAll('.bar button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); if (b.dataset.m) metric = b.dataset.m; if (b.dataset.r) range = b.dataset.r; if (b.dataset.s) smooth = parseInt(b.dataset.s, 10); savePref(); draw(); }));
      cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); hover = (e.clientX - r.left) / r.width; hoverXY = { x: e.clientX, y: e.clientY }; draw(); });
      cv.addEventListener('mouseleave', () => { hover = null; hoverXY = null; draw(); });
      ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => graphEl.addEventListener(t, (e) => e.stopPropagation()));
      hud.appendChild(graphEl);
    }
    return true;
  }
  function setGraph(v) {
    graphOn = !!v;
    const hud = document.querySelector('.raid-contrib-hud'); if (!hud) return;
    const dps = hud.querySelector('.raid-contrib-dps'), rec = hud.querySelector('.raid-contrib-recap');
    if (graphOn) {
      hud.querySelectorAll('.raid-contrib-tab').forEach((b) => b.classList.toggle('active', b === tabEl));
      if (dps) dps.style.display = 'none'; if (rec) rec.style.display = 'none';
      graphEl.classList.add('show'); draw();
    } else {
      if (tabEl) tabEl.classList.remove('active');
      if (graphEl) graphEl.classList.remove('show');
      // the game restores its own views when its tab handler runs; make sure the DPS view is not left hidden
      setTimeout(() => { const t = (hud.querySelector('.raid-contrib-tab.active:not(.cc-rdps-tab)') || {}).dataset; if (dps && (!t || t.tab !== 'recap')) dps.style.display = ''; }, 0);
    }
  }

  // ---- legend tooltip
  let tipEl = null;
  const r0 = (n) => Math.round(n).toLocaleString('en-US');
  function showTip(span, l, st) {
    hideTip(); if (!st) return;
    tipEl = document.createElement('div'); tipEl.className = 'cc-rdps-tip';
    const rg = range === 'fight' ? 'this fight' : range === 'raid' ? 'the whole raid' : 'the last ' + range + ' min';
    const rows = [['DPS now', r0(st.now) + '/s'], ['DPS range', r0(st.lo) + ' – ' + r0(st.hi) + '/s'], ['Average', r0(st.avg) + '/s'], ['Damage', r0(st.dmg)], ['Share', l.party ? '100%' : st.share.toFixed(1) + '%']];
    tipEl.innerHTML = '<b></b>' + rows.map((r) => '<div><span>' + r[0] + '</span><i>' + r[1] + '</i></div>').join('') + '<small>in ' + rg + '. Range = typical DPS, ignoring the highest and lowest 10%.</small>';
    tipEl.querySelector('b').textContent = l.n; tipEl.querySelector('b').style.color = l.c;
    graphEl.appendChild(tipEl);
    const gr = graphEl.getBoundingClientRect(), sr = span.getBoundingClientRect();
    tipEl.style.left = Math.max(2, Math.min(gr.width - 190, sr.left - gr.left)) + 'px';
    tipEl.style.top = Math.max(2, sr.top - gr.top - tipEl.offsetHeight - 4) + 'px';
  }
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  // ---- graph
  function draw() {
    if (tipEl) return;                                  // hold still while a legend tooltip is open
    if (!graphOn || !cv || !graphEl.classList.contains('show')) return;
    graphEl.querySelectorAll('.bar button').forEach((b) => b.classList.toggle('on', !!(b.dataset.m === metric || b.dataset.r === range || (b.dataset.s !== undefined && parseInt(b.dataset.s, 10) === smooth))));
    const smo = graphEl.querySelector('.smo'); if (smo) smo.style.display = metric === 'dps' ? '' : 'none';
    const names = Object.keys(run.pl);
    const W = cv.clientWidth || 300, H = 150, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const now = Date.now();
    const t0 = range === 'raid' ? run.t0 : range === 'fight' ? (run.waveAt || run.t0) : Math.max(run.t0, now - parseInt(range, 10) * 60000);
    const span = Math.max(20000, now - t0), N = Math.max(40, Math.min(120, Math.floor(W / 3)));
    const padL = 38, padR = 6, padT = 8, padB = 16, pw = W - padL - padR, ph = H - padT - padB;
    const ts = []; for (let i = 0; i <= N; i++) ts.push(t0 + span * i / N);
    const lines = names.map((n, i) => ({ n, c: COLORS[i % COLORS.length], v: ts.map((t) => (metric === 'dps' ? dpsAt(run.pl[n], t) : Math.max(0, dmgAt(run.pl[n], t) - dmgAt(run.pl[n], t0)))) }));
    const party = { n: 'Party', c: '#ffffff', v: ts.map((_, k) => lines.reduce((s, l) => s + l.v[k], 0)), party: true };
    const all = lines.concat([party]).filter((l) => !hidden.has(l.n));
    const max = Math.max(metric === 'dps' ? 10 : 100, ...all.map((l) => Math.max(...l.v))) * 1.08;
    g.font = '10px system-ui,sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#7f7f8e'; g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = padT + ph - ph * i / 3; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.textAlign = 'right'; g.fillText(i ? fmt(max * i / 3) : '0', padL - 4, y); }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillText(range === 'fight' ? 'fight start' : range === 'raid' ? 'raid start' : '-' + range + ':00', padL, H - 3); g.textAlign = 'right';
    const secs = Math.round(span / 1000); g.fillText('now · ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), W - padR, H - 3);
    // smooth curves (quadratic through the midpoints), the party line thick and the players slightly thinner so the shape reads at a glance
    const curve = (l) => {
      const pts = l.v.map((v, k) => [padL + pw * k / N, padT + ph - (v / max) * ph]);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length - 1 && smoothCurves; k++) { const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2; g.quadraticCurveTo(pts[k][0], pts[k][1], mx, my); }
      if (!smoothCurves) for (let k = 1; k < pts.length - 1; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    };
    const smoothCurves = smooth > 0;
    g.lineJoin = 'round'; g.lineCap = 'round';
    all.slice().sort((a, b) => (a.party ? 1 : 0) - (b.party ? 1 : 0)).forEach((l) => {
      curve(l);
      if (l.party) { g.lineTo(padL + pw, padT + ph); g.lineTo(padL, padT + ph); g.closePath(); g.fillStyle = 'rgba(255,255,255,.07)'; g.fill(); curve(l); }
      g.strokeStyle = l.c; g.globalAlpha = l.party ? 1 : 0.9; g.lineWidth = l.party ? 2.4 : 1.7; g.setLineDash([]); g.stroke(); g.globalAlpha = 1;
    });
    let ptip = graphEl.querySelector('.cc-rdps-ptip');
    if (hover != null && hoverXY) {
      const k = Math.max(0, Math.min(N, Math.round(hover * N))), x = padL + pw * k / N;
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke();
      all.forEach((l) => { const y = padT + ph - (l.v[k] / max) * ph; g.beginPath(); g.arc(x, y, l.party ? 3.4 : 2.8, 0, Math.PI * 2); g.fillStyle = l.c; g.fill(); g.strokeStyle = '#10101a'; g.lineWidth = 1.2; g.stroke(); });
      const sec = Math.round((ts[k] - t0) / 1000), unit = metric === 'dps' ? '/s' : '';
      const rowsT = all.filter((l) => !l.party).sort((a, b) => b.v[k] - a.v[k]).concat(all.filter((l) => l.party));
      if (!ptip) { ptip = document.createElement('div'); ptip.className = 'cc-rdps-ptip'; graphEl.appendChild(ptip); }
      ptip.textContent = '';
      const hd = document.createElement('div'); hd.className = 'th'; hd.textContent = (range === 'fight' ? 'Fight ' : range === 'raid' ? 'Raid ' : '') + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' · ' + (metric === 'dps' ? 'DPS' : 'Total damage'); ptip.appendChild(hd);
      rowsT.forEach((l) => {
        const r = document.createElement('div'); r.className = 'tr' + (l.party ? ' party' : '');
        const sw = document.createElement('i'); sw.style.background = l.c; const nm = document.createElement('span'); nm.textContent = l.n; const vv = document.createElement('b'); vv.textContent = fmt(l.v[k]) + unit;
        r.append(sw, nm, vv); ptip.appendChild(r);
      });
      const gr = graphEl.getBoundingClientRect(), tw = ptip.offsetWidth, th = ptip.offsetHeight;
      let left = hoverXY.x - gr.left + 14; if (left + tw > gr.width - 2) left = hoverXY.x - gr.left - tw - 14;
      ptip.style.left = Math.max(2, left) + 'px'; ptip.style.top = Math.max(2, Math.min(gr.height - th - 2, hoverXY.y - gr.top - th / 2)) + 'px';
    } else if (ptip) ptip.remove();
    graphEl.querySelector('.tip').textContent = (hover != null && hoverXY ? '' : null) ?? '';
    if (hover == null) graphEl.querySelector('.tip').textContent = (metric === 'dps' ? 'Damage per second' + (smooth ? ', averaged over ' + smooth + ' s' : ' (no smoothing)') + '. Hover a name for details, click to hide it.' : 'Total damage so far. Click a name to hide it.');
    // per-line statistics over the chosen range: DPS now, typical range (10th-90th percentile), average, damage dealt and share
    const dpsOf = (n) => ts.map((t) => dpsAt(run.pl[n], t)), q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))] || 0; };
    const dmgIn = (n) => Math.max(0, dmgAt(run.pl[n], now) - dmgAt(run.pl[n], t0));
    const totalDmg = names.reduce((s2, n) => s2 + dmgIn(n), 0), secsR = Math.max(1, (now - t0) / 1000);
    const stat = {};
    names.forEach((n) => { const d = dpsOf(n), dm = dmgIn(n); stat[n] = { now: d[d.length - 1], lo: q(d, 0.1), hi: q(d, 0.9), avg: dm / secsR, dmg: dm, share: totalDmg ? dm / totalDmg * 100 : 0 }; });
    const pd = ts.map((_, k) => names.reduce((s2, n) => s2 + dpsAt(run.pl[n], ts[k]), 0));
    stat.Party = { now: pd[pd.length - 1], lo: q(pd, 0.1), hi: q(pd, 0.9), avg: totalDmg / secsR, dmg: totalDmg, share: 100 };
    const leg = graphEl.querySelector('.leg'); leg.textContent = '';
    lines.concat([party]).forEach((l) => { const s = document.createElement('span'); if (hidden.has(l.n)) s.className = 'off'; const i = document.createElement('i'); i.style.background = l.c; s.appendChild(i); s.appendChild(document.createTextNode(l.n)); s.addEventListener('click', () => { if (hidden.has(l.n)) hidden.delete(l.n); else hidden.add(l.n); draw(); });
      s.addEventListener('mouseenter', () => showTip(s, l, stat[l.n]));
      s.addEventListener('mouseleave', hideTip);
      leg.appendChild(s); });
  }

  // ---- tick
  function tick() {
    const hud = document.querySelector('.raid-contrib-hud');
    if (!on() || !hud || !hud.getClientRects().length) { if (!on()) cleanup(); return; }
    if (tabEl && !tabEl.isConnected) { tabEl = null; }
    if (!ensure(hud)) return;
    const rows = sample(hud);
    if (rows.length) {
      const now = Date.now(), dmg = rows.reduce((s, r) => s + r.d, 0);
      let dps = 0; Object.keys(run.pl).forEach((n) => { dps += dpsAt(run.pl[n], now); });
      if (!dps) dps = rows.reduce((s, r) => s + r.rate, 0);
      const el = (now - run.t0) / 1000, avg = el > 5 ? dmg / el : 0;
      totalEl.querySelector('b').textContent = Math.round(dps).toLocaleString('en-US') + '/s';
      totalEl.querySelector('.s').textContent = dmg.toLocaleString('en-US') + ' dmg' + (avg ? ' · avg ' + Math.round(avg) + '/s' : '') + ' · ' + rows.length + ' players';
    }
    if (graphOn) draw();
  }
  const timer = setInterval(() => { try { tick(); } catch (e) { /* keep ticking */ } }, SAMPLE_MS);
  function cleanup() { const tb = document.querySelector('.raid-contrib-tabs.cc-rdps-4'); if (tb) tb.classList.remove('cc-rdps-4'); if (totalEl) totalEl.remove(); if (graphEl) graphEl.remove(); if (tabEl) tabEl.remove(); totalEl = graphEl = tabEl = null; graphOn = false; }
  function teardown() {
    clearInterval(timer); cleanup(); style.remove();
    const d = document.querySelector('.raid-contrib-dps'); if (d && d.style.display === 'none') d.style.display = '';
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc raid-dps-extra torn down';
  }
  window[NS] = { version: 1, teardown, tick, get run() { return run; }, setGraph };
  return 'cc raid-dps-extra loaded';
})();
