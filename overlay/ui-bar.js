// ScapeLite Info Bars: customisable bars along the top and/or bottom of the screen (like WoW's Titan Panel).
// Pick modules (task, location, XP per hour, gold, clock ...), drag them to reorder or move them to the other side or bar, and
// right-click for everything else: add or remove a module, its options, the bar's height, move or hide the bar.
// The bars are a real screen edge: the game and ScapeLite's panels are laid out in the space that is left, so nothing is hidden under them.
// Display only: the modules read the game, nothing is clicked or changed in it.
(function () {
  'use strict';
  const NS = '__ccBar';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* old copy gone */ }
  const PS = () => window.__ccPluginSettings;
  const setting = (k, d) => { try { const v = PS() && PS().get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const put = (k, v) => { try { PS() && PS().set && PS().set(k, v); } catch (e) { /* ignore */ } };
  const bridge = () => { const b = window.__ccBridge; return b && typeof b.live === 'function' ? b : null; };
  const sync = () => window.__ccCardSync || null;   // the shared card layer (card-sync.js): which source changed, when a card may redraw
  const fwd0 = (key) => { try { const S = sync(); if (S) S.forwarded(key); } catch (e) { /* layer gone */ } };
  const swal = (where, err) => { try { const S = sync(); if (S && S.swallow) S.swallow(where, err); } catch (e) { /* layer gone */ } };   // a render error nobody sees: logged once, then at most every 10 minutes (card-sync.js)
  const fwd = () => fwd0();   // (outside a card: every source follows)
  // a click handed to the game from inside a card: only that card's own source follows it (the pinned card's tab, or the hover card's panel)
  const fwdFor = (el) => { const c = el && el.closest && el.closest('[id^="cc-card-"]'); fwd0(c ? c.id.slice(8) : (el && el.closest && el.closest('#cc-bar-tip') && tipFor && tipFor.key) || undefined); };
  const LS = 'cc-bar:v1';
  const H = { compact: 28, normal: 34, roomy: 42 };

  // ---------------------------------------------------------------- the modules
  const num = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
  const dur = (min) => (!isFinite(min) || min < 0 ? '' : min < 1 ? '<1 min' : min < 90 ? Math.round(min) + ' min' : (min / 60).toFixed(min < 600 ? 1 : 0) + ' h');
  let samples = [], taskKey = '', taskEta = NaN;
  // The task being worked on: a skilling task, or the slayer task during a fight (the game keeps those apart: live().task is empty while you fight and live().slay holds the kills)
  const taskOf = (l) => {
    if (!l) return null; const t = l.task; if (t && t.quantity) return t;
    const s = l.slay; if (s && s.killTarget > 0) return { skill: 'slay', activityId: s.taskId, activityName: s.mobName || cap(String(s.taskId || '').replace(/_/g, ' ')), quantity: s.killTarget, progress: s.killCount || 0, nodeId: '', nodeName: '', slay: true };
    return null;
  };
  // The game's Active Potions panel keeps one row per kind (food total, each potion type, teleport crystals): icon, effect and the charges left
  function potionRows() {
    const out = [];
    window.__ccDom.qa('.active-potions-panel .potion-row').forEach((r) => {
      const ic = r.querySelector('.potion-row-icon'), cnt = r.querySelector('.potion-row-count-num'), un = r.querySelector('.potion-row-count-unit'), st = r.querySelector('.potion-row-stat');
      if (!ic || !cnt) return;
      const lines = [];
      r.querySelectorAll('.tooltip .potion-tt-line').forEach((l) => {
        const q = (sel) => { const e = l.querySelector(sel); return e ? e.textContent.trim() : ''; };
        const im = l.querySelector('.potion-tt-icon');
        if (l.classList.contains('potion-tt-total')) lines.push({ total: true, label: q('.potion-tt-total-label').replace(/:$/, ''), stat: q('.potion-tt-stat-val'), count: q('.potion-tt-count') });
        else lines.push({ icon: im ? im.src : '', tier: q('.potion-tt-tier'), name: q('.potion-tt-name'), stat: q('.potion-tt-stat-val'), count: q('.potion-tt-count') });
      });
      out.push({ type: r.dataset.style || 'other', name: (ic.alt || '').replace(/^\[T\d+\]\s*/, '') || 'Potion', icon: ic.src, stat: st ? st.textContent.trim() : '', count: cnt.textContent.trim(), unit: un ? un.textContent.trim() : '', lines, total: (lines.find((l) => l.total) || {}).stat || '', statIcon: (st && st.querySelector('img') ? st.querySelector('img').src : '') });
    });
    return out;
  }
  // The whole queue: what you are doing now and every slot after it (your selected option), with time, XP and the total
  const pretty = (id) => String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const skillIcon = (sk) => '/assets/icons/skills/' + sk + '.png';
  const fmtTime = (sec) => (sec >= 5400 ? (sec / 3600).toFixed(sec >= 36000 ? 0 : 1) + ' h' : sec >= 60 ? Math.round(sec / 60) + ' min' : Math.round(sec) + ' s');
  // one option in its own box: blue border for a quest task, gold for a lucky one, purple when it can drop an XP boost
  function optBlock(op, on, best) {
    const tags = [], q = !!(op.quest && op.quest.length), lu = !!op.lucky, bd = (op.boostDrops || 0) > 0;
    if (on) tags.push('selected');
    if (q) tags.push('quest');
    if (lu) tags.push('lucky');
    if (bd) tags.push('boost drop');
    if (best) tags.push('fastest XP');
    const L = optLines(op), pick = (k) => (L.find((x) => x[0] === k) || [])[1];
    return { h: pretty(op.act) + (op.qty ? ' \u00D7' + op.qty : ''), on, tone: q ? 'quest' : lu ? 'lucky' : bd ? 'boost' : '', tags, img: skillIcon(op.skill), sub: pretty(op.skill) + ' \u00B7 ' + pretty(op.node), best: !!best,
      tiles: ['Time', 'XP', 'XP / hour', 'Success', 'XP bonus'].map((k) => [k, pick(k)]).filter((x) => x[1]), note: pick('Quest') ? 'Quest: ' + pick('Quest') : '', lines: L };
  }
  // the facts of one task option, as label / value lines
  function optLines(o) {
    const L = [['Skill', pretty(o.skill)], ['Where', pretty(o.node)]];
    if (o.qty) L.push(['Amount', String(o.qty)]);
    // a slay task's total time and XP carry the measured correction (task-log.js slayK); XP an hour is left as the game has it
    let sk = null; try { sk = o.kind === 'slay' && window.__ccTaskLog && window.__ccTaskLog.slayK ? window.__ccTaskLog.slayK() : null; if (sk && sk.off) sk = null; } catch (e) { sk = null; }
    if (Number.isFinite(o.timeSec)) L.push(['Time', fmtTime(o.timeSec * (sk ? sk.t : 1))]);
    if (Number.isFinite(o.totalXp)) L.push(['XP', num(o.totalXp * (sk ? sk.x : 1))]);
    if (sk) L.push([sk.measured ? 'Measured correction' : 'Estimated correction', 'time ×' + sk.t.toFixed(2) + ', XP ×' + sk.x.toFixed(2)]);
    if (Number.isFinite(o.xpHr)) L.push(['XP / hour', num(o.xpHr)]);
    if (Number.isFinite(o.success) && o.success < 1) L.push(['Success', Math.round(o.success * 100) + '%']);
    if (o.xpBonus) L.push(['XP bonus', '+' + Math.round(o.xpBonus * 100) + '%']);
    if (o.lucky) L.push(['Lucky task', '2x XP and rewards' + (o.kind === 'slay' ? ' (Slay and training skill; Luck XP on top)' : ', Luck XP on top')]);
    if (o.quest && o.quest.length) L.push(['Quest', o.quest.map((q) => q.name).join(', ')]);
    return L;
  }
  // The task queue (the kept panel, the hover card, the option tray, drag and drop) lives in ui-queue.js. The bar opens it and asks where the Route Advisor badge goes.
  const queueApi = () => window.__ccQueue || null;
  function toggleQueue() { const q = queueApi(); if (!q) return false; q.toggle(); return true; }
  const highlight = (key, nth, node) => { const q = queueApi(); if (q) q.highlight(key, nth, node); };
  function tasksAnchor() {
    const q = queueApi(), pe = q && q.panelEl();
    if (pe) return { rect: pe.getBoundingClientRect(), above: true, kind: 'panel' };
    if (tipEl && tipFor && tipFor.def && tipFor.def.label === 'Tasks') return { rect: tipEl.getBoundingClientRect(), above: true, kind: 'tip' };
    const bt = buttonEl('tasks'); if (!bt) return null;
    // the badge sits on the bar itself (on its top edge, or under its bottom edge on a top bar), above the button
    const br = bt.el.getBoundingClientRect(), bar = bt.el.closest('.cc-bar'), er = bar ? bar.getBoundingClientRect() : br;
    return { rect: { left: br.left, right: br.right, width: br.width, top: er.top, bottom: er.bottom }, above: bt.pos === 'bottom', kind: 'btn' };
  }
  // ---- hide a panel while it has a button: the button shows it on demand (the panel stays the game's own, interactive one)
  const revealed = {};   // panel id -> true while you have opened it from its button
  const revealedAt = {};   // panel id -> when it was last revealed (a panel the game is still opening is not yet 'gone')
  // the game's panel is really on screen (not closed by its own close button or its tab, not hidden by ScapeLite's rule)
  const gamePanelShown = (id) => { const tb = window.__ccDom.q('.panel-titlebar[data-panel-id="' + id + '"]'), p = tb && tb.parentElement; return !!(p && p.getClientRects().length); };
  // the flag follows what is really on screen: a revealed panel that the player closed by hand is no longer 'revealed'
  function syncRevealed() { const now = performance.now(); for (const id in revealed) if (revealed[id] && now - (revealedAt[id] || 0) > 1500 && !gamePanelShown(id)) delete revealed[id]; }
  const panelChoice = (o, tab) => { const v = o && o['p_' + tab]; return v === false ? 'off' : (v || 'default'); };
  const isHiddenManaged = (o, tab) => { const ch = panelChoice(o, tab); return ch === 'hide' || (ch === 'default' && !!(o && o.hideAll)); };
  const hideStyle = document.createElement('style'); hideStyle.id = 'cc-bar-hide'; document.head.appendChild(hideStyle);
  function applyHides() {
    syncRevealed();
    const want = new Set();
    Object.keys(cfg).forEach((pos) => { if (!Array.isArray(cfg[pos])) return; cfg[pos].forEach((m) => {
      const o = m.o || {};
      if (m.id === 'panelbtns') ['tasks', 'skills', 'equipment', 'inventory', 'diary', 'quests', 'friends', 'barter'].forEach((tab) => { if (isHiddenManaged(o, tab) && !revealed[tab]) want.add(tab); });
      if (m.id === 'pbtn' && o.hide && o.tab && !revealed[o.tab]) want.add(o.tab);
      if (m.id === 'chat' && o.hide && !revealed.chat) want.add('chat');
    }); });
    const css = [...want].map((id) => '#ui-container :has(> .panel-titlebar[data-panel-id="' + id + '"]){display:none !important}').join('\n');
    if (hideStyle.textContent !== css) hideStyle.textContent = css;
  }
  // ---- previews of the game's panels: one nicely laid out card per panel (read from the panel's contents; nothing is changed)
  const panelEl = (id) => { const tb = window.__ccDom.q('.panel-titlebar[data-panel-id="' + id + '"]'); return tb ? tb.parentElement : null; };
  // the markup of a game element's own tooltip (kept as text so a card can be compared and redrawn; shown in the detail card)
  const ttHtml = (el) => { const t = el && el.querySelector(':scope > .tooltip'); return t ? t.innerHTML : ''; };
  const txt = (el, sel) => { const e = el && el.querySelector(sel); return e ? e.textContent.trim() : ''; };
  const ownText = (el) => (el ? Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim() : '');
  const skillsTotal = () => { let n = 0; const root = window.__ccDom.q('.skills-panel'); if (root) root.querySelectorAll('.skill-cell .skill-level').forEach((e) => { n += parseInt(e.textContent, 10) || 0; }); return n; };
  function cloneRich(tab) {
    const el = panelEl(tab); if (!el) return { title: pretty(tab), blocks: [{ kind: 'text', text: 'Nothing to show.' }] };
    const c = el.cloneNode(true);
    c.querySelectorAll('.panel-titlebar,.tooltip,.cc-lock-btn,.cc-ps-handle,[class*="cc-"]').forEach((n) => n.remove());
    Object.assign(c.style, { position: 'static', left: 'auto', top: 'auto', margin: '0', translate: 'none', scale: 'none', display: 'block', width: 'auto', height: 'auto', maxHeight: '60vh', overflow: 'hidden', pointerEvents: 'none' });
    return { title: pretty(tab), blocks: [{ kind: 'clone', node: c }] };
  }
  // The model builders of the cards live in overlay/cards/<name>.js and register with the shared card layer (card-sync.js). A card gets this context once (create) and builds its model on every redraw.
  const cardCtx = { setting, put, bridge, panelEl, txt, ttHtml, ownText, hideTip: () => hideTip(), pretty, redraw: (t) => renderCard(t, true), fwd: (key) => fwd0(key) };
  const cardInst = {};
  function cardFor(tab) {
    const S = sync(), f = S && S.cardFactory ? S.cardFactory(tab) : null; if (!f) return null;
    let c = cardInst[tab]; if (!c || c.f !== f) c = cardInst[tab] = { f, i: f(cardCtx) };   // (a re-injected card file brings a new factory: the old instance is dropped)
    return c.i;
  }
  const panelCard = (tab) => Object.assign(panelCard0(tab), { panel: true });
  const panelCard0 = (tab) => { if (tab === 'tasks') return { title: 'Task queue', queue: true, blocks: [] }; const c = cardFor(tab); return c ? c.build() : cloneRich(tab); };
  const POT_CAT = { food: 'Food', melee: 'Potions', ranged: 'Potions', magic: 'Potions', spirit: 'Potions', defensive: 'Potions', discovery: 'Potions', movement: 'Movement', teleport: 'Teleports' };
  const POT_ORDER = ['Food', 'Potions', 'Movement', 'Teleports', 'Other'];
  // the hover card: one section per category, each item with its icon, effect and what is left
  // The second card when you point at one food or potion in the Active Potions card: the exact numbers and where they come from (game-bridge.js foodInfo / potionInfo,
  // the same formulas the game's own tooltips use). Display only.
  const itemIdOf = (src) => { const m = /\/items\/([^/.]+)\.png/.exec(String(src || '')); return m ? m[1] : ''; };
  const fnum = (n) => Number(n).toLocaleString('en-US');
  function itemDetail(type, id, img, countText) {
    const B = window.__ccBridge; if (!id || !B) return null;
    try {
      const n = parseInt(String(countText || '').replace(/[^\d]/g, ''), 10);
      if (type === 'food') {
        const f = B.foodInfo && B.foodInfo(id); if (!f) return null;
        const lines = [['Base heal', fnum(f.base)]];
        f.parts.forEach((p) => lines.push(['  + ' + p.label, '+' + p.n]));
        lines.push(['Heal bonus', '+' + f.bonus + (f.rawBonus > f.bonusMax ? ' (capped at ' + f.bonusMax + ')' : f.parts.length ? '' : ' (no pet, cape or talent bonus yet)')]);
        lines.push(['Spices', f.spices + ' x ' + Math.round(f.spiceEach * 100) + '% = x' + f.mult.toFixed(2)]);
        lines.push(['Heal per bite', 'floor((' + fnum(f.base) + ' + ' + f.bonus + ') x ' + f.mult.toFixed(2) + ') = ' + fnum(f.heal)]);
        if (n > 0) lines.push(['In stock', fnum(n) + ' x ' + fnum(f.heal) + ' = ' + fnum(n * f.heal) + ' HP']);
        if (f.maxHp > 0) lines.push(['Bites from empty to full', String(Math.ceil(f.maxHp / f.heal)) + ' (max HP ' + fnum(f.maxHp) + ')']);
        lines.push(['Eat cooldown', f.cooldown + ' s' + (f.hotsauces ? ' (' + f.hotsauces + ' hot sauce' + (f.hotsauces > 1 ? 's' : '') + ')' : '')]);
        return { blocks: [{ h: f.name, img: img, sub: 'Food', lines, on: true }] };
      }
      const p = B.potionInfo && B.potionInfo(id); if (!p) return null;
      const lines = [], pct = (v) => '+' + Math.round(v * 100) + '%', SK = { melee: ['Strike', 'Heft'], ranged: ['Sight', 'Draw'], magic: ['Focus', 'Surge'], defensive: ['Dodge', 'Defend'] };
      let sub = 'Potion', note = '';
      if (p.kind === 'combat') {
        const sk = SK[p.style] || ['', ''], eff = p.style === 'defensive' ? [[sk[0], p.dodge], [sk[1], p.defend]] : [[sk[0], p.acc], [sk[1], p.str]];
        sub = 'Tier ' + p.tier + ' ' + p.style + ' potion';
        eff.forEach(([k, v]) => { if (v) lines.push([k + ' level (in fights)', '+' + v]); });
        lines.push(['Lasts', fnum(p.charges) + ' attacks (' + fnum(p.baseCharges) + ' base x ' + p.eff.toFixed(2) + ')']);
        note = 'Only the first ' + p.style + ' potion in the list is active; the next one starts when it runs out. ' + (p.useInCombat ? 'Combat potions are used in fights.' : 'Combat potions are switched off in the game settings.');
      } else if (p.kind === 'movement') {
        sub = 'Movement potion';
        lines.push(['Walking speed', pct(p.pct)]); lines.push(['Lasts', fnum(p.charges) + ' charges (' + fnum(p.baseCharges) + ' base x ' + p.eff.toFixed(2) + ')']);
        note = 'Faster walking between nodes. Only the first movement potion is active.';
      } else if (p.kind === 'discovery') {
        sub = 'Tier ' + p.tier + ' discovery potion';
        lines.push(['Extra chest rolls', '+' + p.chestRolls]); lines.push(['Lasts', fnum(p.charges) + ' charges (' + fnum(p.baseCharges) + ' base x ' + p.eff.toFixed(2) + ')']);
        note = 'Only the first discovery potion is active.';
      } else if (p.kind === 'spirit') {
        sub = 'Tier ' + p.tier + ' spirit potion';
        lines.push(['Restores', fnum(p.restore) + ' Spirit (' + Math.round(p.restoreMult * 100) + '% of your max ' + fnum(p.maxSpirit) + ', at least 1)']);
        lines.push(['Lasts', fnum(p.charges) + ' charges (' + fnum(p.baseCharges) + ' base x ' + p.eff.toFixed(2) + ')']);
        note = 'Drunk automatically when Spirit falls under ' + Math.round(p.autoAt * 100) + '%.';
      } else if (p.kind === 'teleport') {
        sub = 'Teleport crystal (tier ' + p.tier + ')'; note = 'One charge per teleport the game plans for a long walk; higher tiers cover longer distances.';
      }
      if (p.kind !== 'teleport') lines.push(['Potion efficiency', 'x' + p.eff.toFixed(2) + ' (Alms level ' + p.alms + ')']);
      if (n > 0 && p.unit) lines.push(['Left', fnum(n) + ' ' + p.unit]);
      return { blocks: [{ h: p.name, img: img, sub: sub, lines, note, on: true }] };
    } catch (e) { swal('potion detail', e); return null; }
  }
  function potionRich(rows) {
    const secs = {};
    rows.forEach((r) => { const c = POT_CAT[r.type] || 'Other'; (secs[c] = secs[c] || []).push(r); });
    const sections = POT_ORDER.filter((c) => secs[c]).map((c) => {
      const items = [];
      secs[c].forEach((r) => {
        const subs = r.lines.filter((l) => !l.total);
        if (subs.length) subs.forEach((l) => items.push({ img: l.icon || r.icon, tier: l.tier, name: l.name || r.name, stat: l.stat, count: l.count, detail: itemDetail(r.type, itemIdOf(l.icon || r.icon), l.icon || r.icon, l.count) }));
        else items.push({ img: r.icon, tier: '', name: r.name, stat: r.stat && r.stat !== r.name ? r.stat : '', count: r.count + ' ' + r.unit.toLowerCase(), detail: itemDetail(r.type, itemIdOf(r.icon), r.icon, r.count) });
      });
      const tot = secs[c].map((r) => r.lines.find((l) => l.total)).filter(Boolean)[0];
      return { h: c, note: tot ? tot.label + ' ' + tot.stat + ' \u00B7 ' + tot.count : '', items };
    });
    return { title: 'Active potions', sections };
  }
  // What you are doing, in plain words: the skill's verb while a task runs, otherwise the game's own state
  const VERB = { cook: 'Cooking', forage: 'Foraging', fish: 'Fishing', mine: 'Mining', smith: 'Smithing', craft: 'Crafting', brew: 'Brewing', imbue: 'Imbuing', farm: 'Farming', slay: 'Slaying', delve: 'Delving', vigor: 'Exercising', heft: 'Lifting', life: 'Healing', alms: 'Giving alms', bard: 'Performing', draw: 'Drawing', luck: 'Gambling', dodge: 'Dodging', focus: 'Focusing', sight: 'Scouting', surge: 'Surging', barter: 'Bartering', defend: 'Defending', invoke: 'Invoking', fortify: 'Fortifying' };
  const doing = (l) => {
    const tk = l && l.task;
    if (l && l.state === 'acting' && tk) { if (tk.type === 'combat' && !VERB[tk.skill]) return 'Fighting'; return VERB[tk.skill] || (tk.skill ? 'Training ' + cap(tk.skill) : 'Working'); }
    const st = String((l && l.state) || '').toLowerCase();
    return { travelling: 'Travelling', traveling: 'Travelling', resting: 'Resting', idle: 'Idle', fighting: 'Fighting', banking: 'Banking' }[st] || cap(st) || 'Idle';
  };
  const xpRates = () => { const r = (window.__ccXpTracker && window.__ccXpTracker.rates) || {}; return Object.keys(r).reduce((s, k) => s + (r[k] || 0), 0); };
  const PANEL_TABS = [['tasks', 'Tasks'], ['skills', 'Skills'], ['equipment', 'Equipment'], ['inventory', 'Inventory'], ['diary', 'Diary'], ['quests', 'Quests'], ['friends', 'Friends'], ['barter', 'Barter']];
  // The game's big windows (the left icon strip: Bank, Smith, Craft ... Settings) and the World Map, for when the strip is hidden: one button each; a click is forwarded to the game's own strip button
  const WINDOW_TABS = [['bank', 'Bank'], ['skillcustom', 'Skill Customize'], ['quests', 'Quests'], ['mobs', 'Mob Selection'], ['pvp', 'PvP'], ['smith', 'Smith'], ['craft', 'Craft'], ['imbue', 'Imbue'], ['brew', 'Brew'], ['alms', 'Alms'], ['unlocks', 'Unlocks'], ['collections', 'Collections'],
    ['diary', 'Diary'], ['delvetree', 'Delve Tree'], ['fortifytree', 'Fortify Tree'], ['raid', 'Raids'], ['clan', 'Clan'], ['hiscores', 'Hiscores'], ['settings', 'Settings'], ['customize', 'Customize'], ['dashboard', 'Dashboard'], ['ledger', 'Ledger'], ['map', 'World Map']];
  const LOOKS = [['icon', 'Icon only'], ['both', 'Icon and text'], ['text', 'Text only']];
  const STYLES = [['flat', 'Plain'], ['pills', 'Separate pills']];
  // the short live text of a panel button: what is happening in that panel
  function liveFor(tab, c) {
    const a = c.alert, l = c.live;
    if (tab === 'tasks') { const tk = taskOf(l); if (!tk) return { t: 'No task', tone: 'warn' }; return { t: (tk.activityName || cap(tk.activityId || 'Task')) + ' ' + tk.progress + '/' + tk.quantity }; }
    if (tab === 'skills') { const n = skillsTotal(); return n ? { t: 'Lv ' + n } : null; }
    if (tab === 'equipment') { const p = panelEl('equipment'), s = p && txt(p, '.loadout-sel-slot.active .loadout-sel-slot-label'); return s ? { t: s } : null; }
    if (tab === 'inventory') { if (!a || !a.invTotal) return null; const free = a.invTotal - a.invUsed; return { t: a.invUsed + '/' + a.invTotal, tone: free <= 1 ? 'bad' : free <= 3 ? 'warn' : '' }; }
    if (tab === 'diary') { const p = panelEl('diary'), m = p && /\((\d+%)\)/.exec(txt(p, '.diary-sub')); return m ? { t: m[1] } : null; }
    if (tab === 'quests') { if (a && a.questsReady && a.questsReady.length) return { t: 'Claim ' + a.questsReady.length, tone: 'good' }; const p = panelEl('quests'), n = p ? p.querySelectorAll('.quest-slot:not(.quest-slot-empty)').length : 0; return { t: n + ' active' }; }
    if (tab === 'friends') { const p = panelEl('friends'), n = p ? p.querySelectorAll('.friend-row').length : 0; return { t: n + (n === 1 ? ' friend' : ' friends') }; }
    if (tab === 'barter') { const p = panelEl('barter'), b = p && txt(p, '.barter-header-budget'); if (!b) return null; const spent = /^0+$/.test(b.replace(/[^\d]/g, '') || 'x') || !!(p.querySelector('.barter-consumed-overlay') && p.querySelector('.barter-consumed-overlay').style.display !== 'none'); return spent ? { t: 'No charges', tone: 'dim' } : { t: b + ' left' }; }
    return null;
  }
  // one button per game panel (or only the panel `only`), in the order you set, as icon, icon and text or text, with live text if asked
  // the Tasks button opens ScapeLite's queue unless you switched that off; with the game's own Tasks panel hidden it always does (the game's panel is not there to open)
  const ownQ = () => true;   // the Tasks button always works ScapeLite's queue panel (the old per-button switch did nothing once the game's panel was hidden)
  // one query of the game's panel-tab buttons shared by every panel-button module in a refresh (each used to run its own)
  let tabBtnList = [], tabBtnAt = 0;
  const tabBtns = () => { const n = performance.now(); if (n - tabBtnAt > 400 || tabBtnList.some((b) => !b.isConnected)) { tabBtnAt = n; tabBtnList = Array.from(window.__ccDom.qa('.panel-tab-btn[data-tab]')); } return tabBtnList.slice(); };
  function btnRender(c, o, only) {
    const look = o.look || 'icon', live = o.live !== false, items = [], order = Array.isArray(o.order) ? o.order : [];
    const bs = tabBtns().filter((b) => !only || b.dataset.tab === only);
    bs.sort((a, b) => { const ia = order.indexOf(a.dataset.tab), ib = order.indexOf(b.dataset.tab); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    bs.forEach((b) => {
      const tab = b.dataset.tab, ch = only ? (o.hide ? 'hide' : 'keep') : panelChoice(o, tab); if (ch === 'off') return;
      const hid = only ? !!o.hide : isHiddenManaged(o, tab);
      const im = b.querySelector('img'), dot = b.querySelector('.panel-tab-dot');
      const lv = look === 'icon' ? null : (live ? liveFor(tab, c) : null);
      items.push({ key: tab, ours: (tab === 'tasks' && (ownQ(o) || hid) && !!queueApi()) || (!!o.pin && CARD_TABS.includes(tab)) || hid, img: look === 'text' ? '' : (im ? im.src : ''), t: look === 'icon' ? '' : (lv ? lv.t : pretty(tab)), tone: lv ? lv.tone : '', label: pretty(tab), tip: '', richFn: () => panelCard(tab),
        noTip: () => (tab === 'tasks' && (ownQ(o) || hid) && !!(queueApi() && queueApi().isOpen() && !queueApi().isCollapsed())) || (!!o.pin && cardApi.isOpen(tab) && !cardApi.isCollapsed(tab)),   // the open panel already shows the queue
        active: tab === 'tasks' && (ownQ(o) || hid) && queueApi() ? queueApi().isOpen() : o.pin && CARD_TABS.includes(tab) ? cardApi.isOpen(tab) : (hid ? !!revealed[tab] : b.classList.contains('active')), dot: !!(dot && dot.style.display !== 'none') || !!(lv && lv.tone === 'good' && tab === 'quests'),
        click: () => {
          if (tab === 'tasks' && (ownQ(o) || hid) && toggleQueue()) return;
          if (o.pin && cardApi.toggle(tab)) { refresh(); return; }
          if (hid) { revealed[tab] = !revealed[tab]; if (revealed[tab] && !b.classList.contains('active')) b.click(); }
          else b.click();
          applyHides(); refresh();
        } });
    });
    return items.length ? { items, tip: '', look, gap: Number.isFinite(Number(o.gap)) ? Number(o.gap) : 4, pills: o.style === 'pills', reorder: !only } : null;
  }
  // ---- window buttons: one per window of the game's left icon strip (and the World Map), in the game's own order unless you dragged them; the click is the game's own button's click (navigation only)
  const WIN_LABEL = {}; WINDOW_TABS.forEach(([k, l]) => { WIN_LABEL[k] = l; });
  function winSources() {
    const out = {};
    window.__ccDom.qa('.floating-tab-btn').forEach((b) => {
      if (b.classList.contains('cc-menu-btn')) return;
      const tt = b.querySelector('.floating-tab-tooltip'), k = b.dataset.tab || (tt && tt.dataset.tab); if (!k || out[k]) return;
      out[k] = { el: b, order: parseInt(b.style.order, 10) || 0 };
    });
    const m = window.__ccDom.q('.window-control-btn-map'); if (m) out.map = { el: m, order: 9999 };
    return out;
  }
  function windowsRender(c, o) {
    const look = o.look || 'icon', src = winSources(), order = Array.isArray(o.order) ? o.order : [], hk = window.HOTKEYS || {}, items = [];
    Object.keys(src).forEach((k) => {
      if (o['w_' + k] === 'off' || !WIN_LABEL[k]) return;
      const b = src[k].el, im = b.querySelector('img'), key = (hk.floatingByTab && hk.floatingByTab[k]) || (hk.extrasByTab && hk.extrasByTab[k]) || '', ku = key ? String(key).toUpperCase() : '', name = WIN_LABEL[k];
      items.push({ key: 'w:' + k, ord: src[k].order, img: look === 'text' ? '' : (im ? im.src : ''), t: look === 'icon' ? '' : name + (o.keys && ku ? ' [' + ku + ']' : ''), tone: '', label: name, tip: 'Open ' + name + (ku ? '  [' + ku + ']' : ''),
        active: b.classList.contains('active'), dot: false, click: () => { b.click(); setTimeout(refresh, 60); } });
    });
    items.sort((a, b) => { const ia = order.indexOf(a.key), ib = order.indexOf(b.key); return ia >= 0 || ib >= 0 ? (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) : a.ord - b.ord; });
    return items.length ? { items, tip: '', look, gap: Number.isFinite(Number(o.gap)) ? Number(o.gap) : 4, pills: o.style === 'pills', reorder: true } : null;
  }
  // ---- panel hotkeys: the game's keys (HOTKEYS.panel, with the player's own bindings) open ScapeLite's counterpart of a panel whose button replaces or hides the game's one.
  // A panel the game still shows keeps the game's key (this handler leaves the event alone). Only toggles ScapeLite's own panels (or does exactly what the button does).
  const gameSetting = (k, d) => { try { const v = JSON.parse(localStorage.getItem('scapewatch_settings') || '{}')[k]; return v === undefined ? d : v; } catch (e) { return d; } };   // read-only look at the game's saved settings
  function onHotkey(e) {
    if (setting('uiBarHotkeys', true) === false || e.ctrlKey || e.altKey || e.metaKey || e.repeat || !e.key || e.key.length !== 1) return;
    const ae = document.activeElement; if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return;   // typing (the game ignores the keys then, too)
    if (gameSetting('enableTabHotkeys', true) === false) return;
    const hk = window.HOTKEYS; if (!hk || !hk.panel) return;
    const tab = hk.panel[e.key.toLowerCase()]; if (!tab) return;
    const ov = document.querySelector('.modal-overlay'); if (ov && ov.checkVisibility && ov.checkVisibility()) return;   // a big window is open: the game ignores panel keys then
    const be = buttonEl(tab), q = be && be.el._q; if (!q || !q.ours || !q.click) return;   // no button of ours takes this panel over: the game's key does its job
    e.preventDefault(); e.stopImmediatePropagation(); q.click();
  }
  window.addEventListener('keydown', onHotkey, true);

  // turn the group into one module per button, so each can be placed, ordered and spaced by itself
  function splitButtons(mod, pos) {
    const o = mod.o || {}, order = Array.isArray(o.order) ? o.order : [];
    const tabs = PANEL_TABS.map((x) => x[0]).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); }).filter((tab) => panelChoice(o, tab) !== 'off');
    const at = cfg[pos].indexOf(mod); if (at < 0) return;
    cfg[pos].splice(at, 1, ...tabs.map((tab) => ({ id: 'pbtn', s: mod.s, o: { tab, look: o.look || 'icon', live: o.live !== false, style: o.style || 'flat', hide: isHiddenManaged(o, tab) } })));
    save(); Object.values(bars).forEach((bb) => { bb.sig = ''; }); refresh();
  }
  // keep the buttons of the group in place while they update (so hovering and dragging are not interrupted)
  function buildBtn(x, bar) {
    const c = document.createElement('span'); c.appendChild(document.createElement('img')); c.appendChild(document.createElement('b'));
    c.addEventListener('click', (ev) => { ev.stopPropagation(); if (!dragMoved && c._q && c._q.click) c._q.click(); });
    c.addEventListener('mouseenter', (ev) => { lastMouse.x = ev.clientX; const q = c._q; if (!q || !q.label || (q.noTip && q.noTip())) return; ev.stopPropagation(); keepTip(); if (tipEl && tipFor && tipFor.el === c) return; showTip({ el: c, def: { label: q.label }, key: CARD_TABS.includes(q.key) ? q.key : '', rich: null, richFn: q.richFn || null, tip: q.tip }, bar); });
    c.addEventListener('mouseleave', softHide);
    c.setAttribute('role', 'button'); c.tabIndex = 0; c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); if (c._q && c._q.click) c._q.click(); } });
    c.addEventListener('mousedown', (ev) => { if (!c._reorder || ev.button !== 0) return; ev.stopPropagation(); hideTip(); startBtnDrag(ev, c, x); });
    return c;
  }
  function syncItems(x, r, bar) {
    const pc = x.pc;
    const cls = 'pc' + (r.look ? ' look-' + r.look : '') + (r.pills ? ' pills' : '');
    if (pc.className !== cls) pc.className = cls;
    pc.style.setProperty('--pg', (r.gap == null ? 8 : r.gap) + 'px');
    const have = new Map(Array.from(pc.children).map((e) => [e.dataset.key, e]));
    r.items.forEach((q, i) => {
      const key = q.key || String(i); let c = have.get(key); have.delete(key);
      if (!c) { c = buildBtn(x, bar.el); c.dataset.key = key; }
      c._q = q; c._reorder = !!r.reorder;
      const cn = 'pi' + (q.img ? ' hi' : '') + (q.click ? ' btn' : '') + (q.active ? ' on' : '') + (q.tone ? ' t-' + q.tone : '') + (c.classList.contains('drag') ? ' drag' : '');
      if (c.className !== cn) c.className = cn;
      const im = c.firstChild, tx = c.children[1];
      if (q.img) { if (im.getAttribute('src') !== q.img) { im.src = q.img; im.alt = ''; } im.style.display = ''; } else im.style.display = 'none';
      if (tx.textContent !== (q.t || '')) tx.textContent = q.t || '';
      tx.style.display = q.t ? '' : 'none';
      let dot = c.querySelector('.dot');
      if (q.dot && !dot) { dot = document.createElement('i'); dot.className = 'dot'; c.appendChild(dot); } else if (!q.dot && dot) dot.remove();
      if (pc.children[i] !== c) pc.insertBefore(c, pc.children[i] || null);
    });
    have.forEach((e) => e.remove());
  }
  // drag a button to a new place inside its group; the order is remembered
  function startBtnDrag(ev, c, x) {
    const x0 = ev.clientX, y0 = ev.clientY, pc = c.parentNode; let on = false, ins = null, idx = 0;
    const others = () => Array.from(pc.children).filter((k) => k !== c);
    const move = (mv) => {
      if (!on) { if (Math.abs(mv.clientX - x0) < 5 && Math.abs(mv.clientY - y0) < 5) return; on = true; dragMoved = true; c.classList.add('drag'); ins = document.createElement('div'); ins.className = 'ins-btn'; document.body.appendChild(ins); }
      const ks = others(); idx = ks.length;
      for (let i = 0; i < ks.length; i++) { const r = ks[i].getBoundingClientRect(); if (mv.clientX < r.left + r.width / 2) { idx = i; break; } }
      const ref = ks[idx] || ks[ks.length - 1]; if (!ref) return;
      const r = ref.getBoundingClientRect();
      ins.style.left = (idx < ks.length ? r.left - 3 : r.right + 1) + 'px'; ins.style.top = (r.top - 2) + 'px'; ins.style.height = (r.height + 4) + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true);
      c.classList.remove('drag'); if (ins) ins.remove();
      if (on) { const ks = others(); ks.splice(idx, 0, c); x.m.o = Object.assign({}, x.m.o, { order: ks.map((k) => k.dataset.key) }); save(); refresh(); }
      setTimeout(() => { dragMoved = false; }, 30);
    };
    document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
  }
  // The Current Task panel's extras, from the game data bridge: the level bar of the skill being trained, and for a fight the loadout, the skill you train and the kills
  function taskCurrent() { try { const b = window.__ccBridge; return b && b.ok && b.ok() && b.current ? b.current() : null; } catch (e) { return null; } }
  function taskParts(cu, o) {
    if (!cu) return [];
    const p = [];
    if (o.lv && cu.lv) p.push('Lv ' + cu.lv.level + ' (' + cu.lv.pct + '%)' + (cu.lv.next ? ' → ' + cu.lv.next : ' MAX'));
    if (o.loadout && cu.combat && cu.loadout) p.push(cu.loadout);
    if (o.train && cu.combat && cu.train) p.push('Training ' + cu.train);
    if (o.kills && cu.combat && cu.kills) p.push(cu.kills.target ? cu.kills.count + '/' + cu.kills.target + ' kills' : cu.kills.count + ' kills');
    return p;
  }
  function taskTip(cu) {
    if (!cu) return '';
    const p = []; if (cu.lv) p.push(cu.lv.name + ' level ' + cu.lv.level + ', ' + cu.lv.pct + '%' + (cu.lv.next ? ' to level ' + cu.lv.next : ''));
    if (cu.combat) { if (cu.loadout) p.push('Loadout: ' + cu.loadout); if (cu.train) p.push('Training: ' + cu.train); if (cu.kills) p.push(cu.kills.target ? 'Kills: ' + cu.kills.count + '/' + cu.kills.target : 'Kills: ' + cu.kills.count); }
    return p.length ? ' · ' + p.join(' · ') : '';
  }
  // render(ctx) returns { t: text, tip?: string, frac?: 0..1 (a thin progress line), tone?: 'good'|'warn'|'bad' } or null to hide for now
  const MODULES = {
    task: { label: 'Current task', icon: '🎯', opts: [{ k: 'eta', label: 'Show time left', def: true }, { k: 'bar', label: 'Show progress line', def: true }, { k: 'queue', label: 'Hover shows the whole queue', def: true }, { k: 'lv', label: 'Show the level bar (Lv 48 (94%) → 49)', def: false }, { k: 'loadout', label: 'Show the loadout (fights)', def: false }, { k: 'train', label: 'Show the skill you train (fights)', def: false }, { k: 'kills', label: 'Show the kill count (fights)', def: false }], click: () => { try { window.__ccRouteAdvisor && window.__ccRouteAdvisor.toggle && window.__ccRouteAdvisor.toggle(); } catch (e) { /* ignore */ } },
      render: (c, o) => {
        const tk = taskOf(c.live); if (!tk) return { t: 'No task', tone: 'warn' };
        const key = (tk.activityId || '') + '|' + (tk.nodeId || '') + '|' + tk.quantity;
        if (key !== taskKey) { taskKey = key; samples = []; }
        const now = Date.now(); if (!samples.length || now - samples[samples.length - 1].t > 4000) samples.push({ t: now, p: tk.progress }); if (samples.length > 8) samples.shift();
        let eta = NaN; if (samples.length >= 2) { const a = samples[0], z = samples[samples.length - 1], dp = z.p - a.p, dt = (z.t - a.t) / 60000; if (dp > 0 && dt > 0) eta = (tk.quantity - tk.progress) / (dp / dt); }
        taskEta = eta;
        const cu = taskCurrent(), ex = taskParts(cu, o);
        return { t: (tk.activityName || cap(tk.activityId || 'Task')) + ' ' + tk.progress + '/' + tk.quantity + (o.eta !== false && isFinite(eta) ? ' · ' + dur(eta) : '') + (ex.length ? ' · ' + ex.join(' · ') : ''), tip: cap(tk.skill) + ' task' + (tk.nodeName ? ' at ' + tk.nodeName : '') + taskTip(cu), frac: o.bar !== false ? tk.progress / tk.quantity : null, richFn: o.queue !== false ? () => ({ title: 'Task queue', queue: true, blocks: [] }) : null };
      } },
    where: { label: 'Location', icon: '📍', opts: [{ k: 'state', label: 'Show what you are doing', def: true }],
      render: (c, o) => { const l = c.live; if (!l) return null; const tk = l.task; const place = (tk && tk.nodeName) || cap(String(l.at || '').replace(/_/g, ' ')); return { t: (o.state !== false ? doing(l) + ' · ' : '') + place, dropOrder: [0] }; } },
    xp: { label: 'XP per hour', icon: '📈', opts: [], click: () => { try { window.__ccXpTracker && window.__ccXpTracker.toggle(); } catch (e) { /* ignore */ } },
      render: () => { const r = xpRates(); return { t: r > 0 ? num(r) + ' XP/hr' : 'XP/hr –', short: r > 0 ? num(r) : '–', tone: r > 0 ? 'good' : undefined, tip: 'All skills, from the XP Tracker (click to open it)' }; } },
    gold: { label: 'Gold', icon: '🪙', opts: [{ k: 'full', label: 'Show the full number', def: false }],
      render: (c, o) => { const g = c.held && c.held.gold; if (g == null) return null; return { t: o.full ? Math.round(g).toLocaleString('en-US') : num(g), tip: Math.round(g).toLocaleString('en-US') + ' gold' }; } },
    blood: { label: 'Blood coins', icon: '🩸', opts: [], render: (c) => { const g = c.held && c.held.bloodcoins; return g == null ? null : { t: num(g), tip: Math.round(g).toLocaleString('en-US') + ' blood coins' }; } },
    clock: { label: 'Clock', icon: '🕒', opts: [{ k: 'h12', label: '12-hour clock', def: false }, { k: 'sec', label: 'Show seconds', def: false }],
      render: (c, o) => { const d = new Date(); return { t: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: o.sec ? '2-digit' : undefined, hour12: !!o.h12 }) }; } },
    advisor: { label: 'Next action', icon: '🧠', opts: [], render: () => { const A = window.__ccAdvisor, x = A && A.hero && A.hero(); if (!x) return null; return { t: x.text.length > 60 ? x.text.slice(0, 58) + '…' : x.text, tip: x.text + ' · ' + x.gain + ' (Advisor panel, sure ' + x.sure + ')', tone: x.sure === 'A' ? 'good' : undefined }; } },
    inv: { label: 'Inventory space', icon: '🎒', opts: [], render: (c) => { const a = c.alert; if (!a || !a.invTotal) return null; const free = a.invTotal - a.invUsed; return { t: free + ' free', short: String(free), tip: a.invUsed + ' of ' + a.invTotal + ' slots used', tone: free <= 1 ? 'bad' : free <= 3 ? 'warn' : undefined }; } },
    event: { label: 'Game event', icon: '\uD83C\uDF89', opts: [{ k: 'name', label: 'Show the event name', def: false }, { k: 'days', label: 'Show the days left', def: true }],
      render: (c, o) => {
        const ev = window.__ccUI && window.__ccUI.eventInfo && window.__ccUI.eventInfo(); if (!ev) return null;   // no event on: the module is not there
        const st = ev.state === 'claimed' ? '\u2713' : ev.state === 'hunting' ? ev.found + '/' + ev.need : ev.state === 'ready' ? 'claim' : 'start';
        const t = (o.name ? ev.name.replace(/ Event$/i, '') + ' ' : '') + '+' + ev.boostPct.toFixed(1) + '% XP \u00B7 ' + st + (o.days !== false && ev.days != null ? ' \u00B7 ' + ev.days + 'd' : '');
        const blocks = [{ kind: 'chips', chips: [['Boost', '+' + ev.boostPct.toFixed(1) + '% XP'], ['Found by all', ev.total.toLocaleString('en-US')], ['You', ev.state === 'new' ? 'not started' : ev.state === 'claimed' ? 'claimed' : ev.state === 'ready' ? 'all found' : ev.found + ' of ' + ev.need], ['Ends', ev.days == null ? '?' : ev.days + (ev.days === 1 ? ' day' : ' days')]] }];
        ev.lines.slice(1).forEach((ln) => blocks.push({ kind: 'text', text: ln }));
        return { t, tone: ev.attention ? 'warn' : '', rich: { title: ev.name, note: ev.totalText || '', blocks } };
      } },
    // Hit points: numbers with an icon, or a real HP bar (width adjustable). Right-click the module to switch; it can also hide the game's own HP bar.
    hp: { label: 'Hit points', icon: '\u2764\ufe0f',
      opts: [{ k: 'style', label: 'Display', choices: [['num', 'Numbers with an icon'], ['bar', 'Bar']], def: 'num' }, { k: 'w', label: 'Bar width', slider: { min: 60, max: 600, step: 10 }, def: 180 },
        { k: 'text', label: 'Numbers on the bar', def: true }, { k: 'icon', label: 'Heart icon', def: true }, { k: 'hideOrig', label: 'Hide the game\u2019s own HP bar', def: false }],
      render: (c, o) => {
        const a = c.alert; let cur, max;
        if (a && a.maxHP) { cur = a.currentHP; max = a.maxHP; } else { const t = document.querySelector(':is(#ui-container,#hud-layer)>.hp-bar .hp-bar-text'), m = t && /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(t.textContent); if (!m) return null; cur = Number(m[1].replace(/,/g, '')); max = Number(m[2].replace(/,/g, '')); }   // the game's own bar still holds the numbers while it is hidden
        if (!(max > 0)) return null;
        const f = Math.max(0, Math.min(1, cur / max)), bar = o.style === 'bar', txt = Math.round(cur) + (bar ? ' / ' : '/') + Math.round(max);
        return { t: bar && o.text === false ? '' : txt, frac: f, tone: f < 0.25 ? 'bad' : f < 0.5 ? 'warn' : undefined, bar, fw: bar ? Math.max(60, Number(o.w) || 180) : 0, noicon: o.icon === false, tip: txt + ' hit points' };
      } },
    alerts: { label: 'Alerts', icon: '🔔', opts: [], click: () => { try { window.__ccAlerts && window.__ccAlerts.toggle(); } catch (e) { /* ignore */ } },
      render: () => { const n = window.__ccAlerts ? window.__ccAlerts.alerts.length : 0; return { t: n ? n + ' alert' + (n > 1 ? 's' : '') : 'No alerts', tone: n ? 'bad' : undefined, tip: 'Hover to see the alert list' }; } },
    panelbtns: { label: 'Panel buttons', icon: '\uD83D\uDCCB',
      opts: [{ k: 'look', label: 'Look', choices: LOOKS, def: 'icon' }, { k: 'live', label: 'Live text (current task, bag space ...)', def: true }, { k: 'pin', label: 'Click opens ScapeLite’s card (instead of the game’s panel)', def: false }, { k: 'style', label: 'Buttons', choices: STYLES, def: 'flat' }, { k: 'gap', label: 'Space between buttons', slider: { min: 0, max: 40, step: 1 }, def: 4 },
        { k: 'hideAll', label: 'Hide a panel while it has a button', def: false }].concat(PANEL_TABS.map(([k, lab]) => ({ k: 'p_' + k, label: lab, choices: [['default', 'Button (panel follows the global setting)'], ['hide', 'Button, and hide the panel'], ['keep', 'Button, and keep the panel'], ['off', 'No button']], def: 'default' }))),
      actions: [{ label: 'Split into separate buttons', fn: (mod, pos) => splitButtons(mod, pos) }],
      render: (c, o) => btnRender(c, o, null) },
    pbtn: { label: 'Panel button', icon: '\uD83D\uDD18', many: true, variants: PANEL_TABS,
      opts: [{ k: 'tab', label: 'Panel', choices: PANEL_TABS, def: 'tasks' }, { k: 'look', label: 'Look', choices: LOOKS, def: 'icon' }, { k: 'live', label: 'Live text', def: true }, { k: 'pin', label: 'Click opens ScapeLite’s card (instead of the game’s panel)', def: false }, { k: 'style', label: 'Button', choices: STYLES, def: 'flat' }, { k: 'hide', label: 'Hide the panel while it has a button', def: false }],
      render: (c, o) => btnRender(c, o, o.tab || 'tasks') },
    windows: { label: 'Window buttons', icon: '\uD83E\uDE9F',
      opts: [{ k: 'look', label: 'Look', choices: LOOKS, def: 'icon' }, { k: 'keys', label: 'Show the hotkey next to the name', def: false }, { k: 'style', label: 'Buttons', choices: STYLES, def: 'flat' }, { k: 'gap', label: 'Space between buttons', slider: { min: 0, max: 40, step: 1 }, def: 4 }]
        .concat(WINDOW_TABS.map(([k, lab]) => ({ k: 'w_' + k, label: lab, choices: [['show', 'Button'], ['off', 'No button']], def: 'show' }))),
      render: (c, o) => windowsRender(c, o) },
    chat: { peek: true, matchWidth: true, label: 'Chat', icon: '\uD83D\uDCAC', opts: [{ k: 'snippet', label: 'Show the latest line', def: true }, { k: 'w', label: 'Width of the button', slider: { min: 160, max: 900, step: 10 }, def: 420 }, { k: 'hide', label: 'Hide the game chat window while this module is on', def: false }],
      click: (o) => {
        if (window.__ccChat) { window.__ccChat.toggle(); return; }
        if (o.hide) { revealed.chat = !revealed.chat; applyHides(); }
        setTimeout(() => { const i = document.querySelector('.chat-panel .chat-input'); if (i && (!o.hide || revealed.chat)) { try { i.focus(); } catch (e) { /* ignore */ } } }, 80);
      },
      render: (c, o) => {
        let last = '', n = 0;
        const cc = window.__ccChat;
        if (o.snippet !== false) {
          const l = cc && cc.latest ? cc.latest(1)[0] : null;
          if (l) last = (l.name ? l.name + ': ' : '') + l.text;
          else { const ms = document.querySelectorAll('.chat-panel .chat-message'); const m = ms[ms.length - 1]; if (m) { const ts = m.querySelector('.chat-timestamp'); last = m.textContent.replace(ts ? ts.textContent : '', '').trim(); } }
        }
        if (cc) n = cc.unread || 0;
        return { t: (last ? 'Chat \u00B7 ' + last : 'Chat') + (n ? ' \u00B7 ' + n + ' new' : ''), dropOrder: [0], fw: Math.max(160, Math.min(900, Number(o.w) || 420)), richFn: () => chatRich(), tip: '' };
      } },
    space: { many: true, label: 'Empty space (spacer)', icon: '', opts: [
        { k: 'w', label: 'Width', choices: [[16, 'Small (16 px)'], [40, 'Medium (40 px)'], [96, 'Large (96 px)'], [200, 'Extra large (200 px)'], [400, 'Huge (400 px)']], def: 40 },
        { k: 'w', label: 'Width (slider)', slider: { min: 4, max: 800, step: 2 }, def: 40 },
        { k: 'line', label: 'Show a thin divider line', def: false },
      ],
      render: (c, o) => ({ t: '', blank: true, w: Math.max(4, Math.min(800, Number(o.w) || 40)), line: !!o.line, tip: 'Empty space: right-click to set its width' }) },
    potions: { label: 'Active potions', icon: '\uD83E\uDDEA',
      // The game's own right-click menu of its Active Potions panel (filters, food eligibility, auto-eat): opened here as if you had right-clicked the original panel
      // (the same event, at the spot you clicked); you then change the settings in the game's own menu yourself. Nothing is changed for you.
      actions: [{ label: 'Food, potion filters and auto-eat (the game’s own menu)…', fn: () => openGamePotionMenu() }],
      opts: [
        { k: 'mode', label: 'Look', choices: [['min', 'Minimal (hover for the details)'], ['exp', 'Expanded (icons with their charges)']], def: 'min' },
        { k: 'foodHeal', label: 'Food shows total healing instead of the count', def: true },
        { k: 'f_food', label: 'Show food', def: true }, { k: 'f_melee', label: 'Show melee potions', def: true }, { k: 'f_ranged', label: 'Show ranged potions', def: true },
        { k: 'f_magic', label: 'Show magic potions', def: true }, { k: 'f_spirit', label: 'Show spirit potions', def: true }, { k: 'f_defensive', label: 'Show defensive potions', def: true },
        { k: 'f_discovery', label: 'Show discovery potions', def: true }, { k: 'f_movement', label: 'Show movement potions', def: true }, { k: 'f_teleport', label: 'Show teleport crystals', def: true },
      ],
      render: (c, o) => {
        const rows = potionRows().filter((r) => o['f_' + r.type] !== false);
        if (!rows.length) return { t: 'No potions', tip: 'Nothing active (or everything is filtered out)' };
        const tip = '';
        const rich = potionRich(rows);
        const heal = (r) => { if (o.foodHeal === false || r.type !== 'food' || !r.total) return null; const n = parseInt(String(r.total).replace(/[^\d]/g, ''), 10); return n > 0 ? n : null; };
        const hs = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n.toLocaleString('en-US'));
        if (o.mode === 'exp') return { rich, items: rows.map((r) => { const n = heal(r); return { img: n && r.statIcon ? r.statIcon : r.icon, t: n ? hs(n) : r.count, tip: n ? 'Food: ' + n.toLocaleString('en-US') + ' total healing' : r.name + (r.stat && r.stat !== r.name ? ' ' + r.stat : '') + ': ' + r.count + ' ' + r.unit.toLowerCase() }; }), tip };
        return { t: rows.length + ' active', rich };
      } },
    // Offline hours (the game's info HUD, top right: how long the character keeps working after you log out) with the game's tier list as the hover card. Display only.
    offline: { label: 'Offline hours', icon: '\u23F3', opts: [],
      render: () => {
        const el = document.querySelector('.ingame-hud-offline'), h = el && txt(el, ':scope > span'); if (!h) return null;
        const tiers = Array.from(el.querySelectorAll('.tooltip .tt-tier')).map((r) => ({ img: (r.querySelector('img') || {}).src || '', name: ownText(r.querySelector('.tt-tier-name')), sub: txt(r, '.tt-tier-lock') || (r.classList.contains('active') ? 'counts' : 'not counted'), right: txt(r, '.h'), dim: r.classList.contains('locked') }));
        const blocks = [{ kind: 'text', text: txt(el, '.tt-off-body') }].concat(tiers.length ? [{ kind: 'rows', rows: tiers }] : []).concat(txt(el, '.tt-hint') ? [{ kind: 'label', text: txt(el, '.tt-hint') }] : []);
        return { t: h + ' offline', short: h, tip: 'Your character keeps working this long after you log out', rich: { title: 'Offline hours', note: h, blocks } };
      } },
    // The world you are on (the game's info HUD). A click is passed to the game's own world name, which opens its world list; picking a world there is the game's own action.
    world: { label: 'World', icon: '\uD83C\uDF10', opts: [],
      render: () => { const el = document.querySelector('.ingame-hud-world'), w = el && txt(el, 'span'); return w ? { t: w, tip: 'Click to open the game\u2019s world list' } : null; },
      click: () => { const el = document.querySelector('.ingame-hud-world'); if (el) el.click(); } },
    // Players online (added by the cards/chat agent, kept at the END of the module list): the number the game shows in its info HUD, read from that element. Display only.
    online: { label: 'Players online', icon: '\uD83D\uDC65', opts: [],
      render: () => {
        const el = document.querySelector('.ingame-hud-online-total'), b = el && el.querySelector('b'); if (!b || !b.textContent.trim()) return null;
        const rows = Array.from(el.querySelectorAll('.tooltip .tt-pop-row')).map((r) => Array.from(r.querySelectorAll('span')).map((x) => x.textContent.trim()).filter(Boolean).join(' ')).filter(Boolean);
        const title = txt(el, '.tooltip .tt-pop-title');
        return { t: b.textContent.trim() + ' online', short: b.textContent.trim(), tip: [title, ...rows].filter(Boolean).join(' \u00B7 ') || 'Players online' };
      } },
  };
  const DEFAULT = { v: 1, top: [{ id: 'task', s: 'l' }, { id: 'where', s: 'l' }, { id: 'panelbtns', s: 'c' }, { id: 'xp', s: 'r' }, { id: 'gold', s: 'r' }, { id: 'clock', s: 'r' }], bottom: [] };
  let cfg = JSON.parse(JSON.stringify(DEFAULT));
  try { const s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && Array.isArray(s.top) && Array.isArray(s.bottom)) cfg = s; } catch (e) { /* first run */ }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } };

  // ---------------------------------------------------------------- styles
  const style = document.createElement('style'); style.id = 'cc-bar-style';
  style.textContent = `
.cc-bar{position:fixed;left:0;right:0;z-index:var(--cc-z-bar,99900);display:flex;align-items:stretch;gap:2px;box-sizing:border-box;padding:0 6px;user-select:none;overflow:hidden}
.cc-bar[data-pos=top]{top:0;border-bottom:1px solid var(--cc-border,#2e2e42);box-shadow:0 2px 10px rgba(0,0,0,.4)}
.cc-bar[data-pos=bottom]{bottom:0;border-top:1px solid var(--cc-border,#2e2e42);box-shadow:0 -2px 10px rgba(0,0,0,.4)}
.cc-bar .zl,.cc-bar .zr,.cc-bar .zc{display:flex;align-items:stretch;gap:2px;min-width:max-content}   /* a zone never gets narrower than its modules: the fit below makes them add up to the bar, so nothing runs under its neighbour */
.cc-bar .zl{flex:1 1 0;justify-content:flex-start}.cc-bar .zr{flex:1 1 0;justify-content:flex-end}.cc-bar .zc{flex:0 1 auto;justify-content:center}
.cc-bar .zc:empty{min-width:0}
.cc-bar .m{position:relative;display:flex;align-items:center;gap:6px;padding:0 10px;border-radius:6px;cursor:default;white-space:nowrap}
.cc-bar .m:hover{background:var(--cc-bg-3,#1c1c28)}
.cc-bar .m.clk{cursor:pointer}
.cc-bar .m .i{font-size:1.1em;line-height:1}
.cc-bar .m .t{font-weight:600}
.cc-bar .m:focus-visible,.cc-bar .pi:focus-visible{outline:2px solid var(--cc-info);outline-offset:-2px}
.cc-bar .m .i{flex:none}
/* fit (see fitBar): compression steps, cheapest first */
.cc-bar .m.fit-hid{display:none !important}
.cc-bar .m.ell{overflow:hidden;min-width:0 !important}
.cc-bar .m.ell .t{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.cc-bar .m.nolab .pi.hi b{display:none}
.cc-bar.tight{gap:1px;padding:0 3px}
.cc-bar.tight .zl,.cc-bar.tight .zr,.cc-bar.tight .zc{gap:1px}
.cc-bar.tight .m{padding:0 5px;gap:4px}
.cc-bar.tight .m .pc{gap:3px !important}
.cc-bar.tight .m .pi.btn{padding:3px 4px}
.cc-bar .m.ovf{flex:none;font-weight:700;cursor:pointer;padding:0 9px}
.cc-bar .m.fw{box-sizing:border-box;min-width:120px;overflow:hidden}   /* elastic: the chat button shrinks with its zone instead of running under the panel buttons */
.cc-bar .m.fw .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.cc-bar .m.sp{padding:0;min-width:0;box-sizing:border-box;border-radius:0}
.cc-bar .m.sp:hover{outline:1px dashed var(--cc-border-strong,#4a4a62);outline-offset:-2px;background:transparent}
body.cc-sp-nohover .cc-bar .m.sp:hover{outline:none}
.cc-bar .m.sp.ln::after{content:'';position:absolute;left:50%;top:7px;bottom:7px;width:1px;background:var(--cc-border,#2e2e42)}
.cc-bar .m .pc{display:flex;align-items:center;gap:8px}
.cc-bar .m .pi{display:flex;align-items:center;gap:3px}
.cc-bar .m .pi img{width:20px;height:20px;image-rendering:pixelated}
.cc-bar .m .pc{gap:var(--pg,8px)}
.cc-bar .m .pi.btn{position:relative;gap:6px;padding:3px 9px;border-radius:7px;cursor:pointer;color:var(--cc-text-dim,#8f8fa4);border:1px solid transparent;font-weight:600}
.cc-bar .m .pi.btn b{max-width:var(--bmax,260px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.cc-bar .m .pc.look-icon .pi.btn{padding:3px 6px}
.cc-bar .m .pc.pills .pi.btn{border-color:var(--cc-border,#2e2e42);background:var(--cc-bg-2,#161620)}
.cc-bar .m .pi.btn:hover{color:var(--cc-text,#fff);background:var(--cc-bg-hover,#262636)}
.cc-bar .m .pi.btn.on{color:var(--cc-text,#fff);background:var(--cc-accent-bg,#2a2518);border-color:var(--cc-accent,#ffd24a)}
.cc-bar .m .pc:not(.pills) .pi.btn.on{border-color:transparent;box-shadow:inset 0 -2px 0 var(--cc-accent,#ffd24a)}
.cc-bar .m .pi.btn.t-good b{color:var(--cc-good,#5fe06d)}
.cc-bar .m .pi.btn.t-warn b{color:var(--cc-warn,#ffb84a)}
.cc-bar .m .pi.btn.t-bad b{color:var(--cc-bad,#ff8a5c)}
.cc-bar .m .pi.btn.t-dim{opacity:.5;filter:grayscale(.7)}
.cc-bar .m .pi.btn.drag{opacity:.45}
.ins-btn{position:fixed;width:2px;border-radius:1px;background:var(--cc-accent,#ffd24a);z-index:2147482650;pointer-events:none}
.cc-bar .m .pi .dot{position:absolute;right:2px;top:2px;width:7px;height:7px;border-radius:50%;background:var(--cc-bad,#ff8a5c);box-shadow:0 0 0 2px var(--cc-bg)}
.cc-bar .m .pi b{font-weight:700}
.cc-bar .m.good .t{color:var(--cc-good,#5fe06d)}.cc-bar .m.warn .t{color:var(--cc-warn,#ffb84a)}.cc-bar .m.bad .t{color:var(--cc-bad,#ff8a5c)}
.cc-bar .m .f{position:absolute;left:8px;right:8px;bottom:2px;height:2px;border-radius:1px;background:var(--cc-bg-3,#1c1c28);overflow:hidden}
.cc-bar .m .f i{display:block;height:100%;background:var(--cc-accent,#ffd24a)}
.cc-bar .m.hpbar .f{left:5px;right:5px;top:5px;bottom:5px;height:auto;border-radius:6px;border:1px solid var(--cc-border,#2e2e42)}
.cc-bar .m.hpbar .f i{background:var(--cc-good,#5fe06d);transition:width .25s ease,background-color .25s}
.cc-bar .m.hpbar.warn .f i{background:var(--cc-warn,#ffb21e)}.cc-bar .m.hpbar.bad .f i{background:var(--cc-bad,#ff5c4d)}
.cc-bar .m.hpbar .t,.cc-bar .m.hpbar.good .t,.cc-bar .m.hpbar.warn .t,.cc-bar .m.hpbar.bad .t{position:relative;z-index:1;color:#fff !important;font-weight:700;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.75)}
.cc-bar .m.hpbar .t{flex:1}
.cc-bar .m.hpbar{justify-content:center}
.cc-bar .m.hpbar .i{position:relative;z-index:1}
body.cc-hp-hide-orig :is(#ui-container,#hud-layer)>.hp-bar{display:none !important}
.cc-bar .m.drag{opacity:.45}
.cc-bar .ins{position:absolute;top:3px;bottom:3px;width:2px;border-radius:1px;background:var(--cc-accent,#ffd24a);pointer-events:none}
.cc-bar .empty{align-self:center;color:var(--cc-text-faint,#707086);padding:0 8px}
#cc-bar-tip2{position:fixed;z-index:2147482601;min-width:220px;max-width:340px;padding:8px 10px;background:var(--cc-bg,#10101a);border:1px solid var(--cc-accent,#ffd24a);border-radius:var(--cc-r-sm,8px);box-shadow:var(--cc-shadow,0 14px 40px rgba(0,0,0,.7));font:var(--cc-fs-sm,12.5px)/1.35 var(--cc-font,system-ui,sans-serif);color:var(--cc-text,#dcdce8)}
#cc-bar-tip2 .th{color:var(--cc-text);font-weight:700;padding:0 2px 6px;border-bottom:1px solid var(--cc-border,#2e2e42);margin-bottom:4px}
#cc-bar-tip2 .tbx.ob{padding:9px 10px}
#cc-bar-tip2 .tbx.ob .ts{display:flex;align-items:center;gap:9px;margin:0 0 8px}
#cc-bar-tip2 .tbx.ob .ts img{width:28px;height:28px;image-rendering:pixelated;flex:none}
#cc-bar-tip2 .tbx.ob .hw{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#cc-bar-tip2 .tbx.ob .hw b{color:var(--cc-text,#fff);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-bar-tip2 .tbx.ob.on .hw b{color:var(--cc-good,#5fe06d)}
#cc-bar-tip2 .tbx.ob .hw span{color:var(--cc-text-dim,#8f8fa4);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-bar-tip2 .tgs{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;max-width:110px}
#cc-bar-tip2 .tgs em.sel{color:var(--cc-good,#5fe06d);border-color:var(--cc-good,#5fe06d)}
#cc-bar-tip2 .tgs em.bst{color:var(--cc-accent,#ffd24a);border-color:var(--cc-accent,#ffd24a)}
#cc-bar-tip2 .otl{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:5px}
#cc-bar-tip2 .ot{display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:7px;background:var(--cc-bg,#10101a);border:1px solid var(--cc-border,#2e2e42)}
#cc-bar-tip2 .ot span{color:var(--cc-text-faint,#707086);font-size:10px;letter-spacing:.05em;text-transform:uppercase}
#cc-bar-tip2 .ot b{color:var(--cc-text,#fff);font-weight:700}
#cc-bar-tip2 .onote{margin-top:6px;padding:4px 8px;border-radius:6px;background:color-mix(in srgb,var(--cc-info,#4aa8ff) 14%,transparent);color:var(--cc-info,#4aa8ff);font-size:11.5px}
#cc-bar-tip2{max-width:380px;min-width:300px}
#cc-bar-tip2 .tbx{margin:6px 0;padding:6px 8px;border-radius:8px;border:1px solid var(--cc-border,#2e2e42);background:var(--cc-bg-2,#161620)}
#cc-bar-tip2 .tbx.on{background:var(--cc-bg-3,#1c1c28);box-shadow:inset 3px 0 0 var(--cc-good,#5fe06d)}
#cc-bar-tip2 .tbx[data-tone=quest]{border-color:var(--cc-info,#4aa8ff)}
#cc-bar-tip2 .tbx[data-tone=lucky]{border-color:var(--cc-accent,#ffd24a)}
#cc-bar-tip2 .tbx[data-tone=boost]{border-color:var(--cc-magic,#b07cff)}
#cc-bar-tip2 .ts{display:flex;align-items:center;gap:6px;margin:0 0 3px;color:var(--cc-text,#fff);font-size:12.5px}#cc-bar-tip2 .ts.on b{color:var(--cc-good,#5fe06d)}
#cc-bar-tip2 .ts em{font-style:normal;font-size:10.5px;padding:0 6px;border-radius:999px;background:var(--cc-bg,#10101a);border:1px solid var(--cc-border,#2e2e42);color:var(--cc-text-dim,#8f8fa4)}
#cc-bar-tip2 .tkv{display:flex;gap:10px;padding:1px 4px}#cc-bar-tip2 .tkv span{flex:1;color:var(--cc-text-dim,#8f8fa4)}#cc-bar-tip2 .tkv b{font-weight:600}
/* a cell with a progress bar keeps its number above the bar and its icon clear of both */
.ccx .tcell:has(u) b{bottom:9px;right:5px;line-height:1}
.ccx .tcell:has(u) img{transform:translateY(-6px)}
.ccx .tcell:has(u) u{left:5px;right:5px;bottom:4px}
.cc-card-pin .bd.ccx{padding:8px 10px 10px;overflow-y:auto;overflow-x:hidden}
.cc-card-pin .ccx .tg{grid-template-columns:repeat(var(--cols,8),minmax(0,1fr)) !important;justify-content:stretch}
.cc-card-pin .ccx .tg .tcell{width:auto;height:auto;aspect-ratio:1}
.cc-card-pin .ccx .tg.big{--cs:56px !important;grid-template-columns:repeat(var(--cols,3),var(--cs)) !important;justify-content:center}
.cc-card-pin .ccx .tg.big .tcell{width:var(--cs);height:var(--cs);aspect-ratio:auto}
.cc-card-pin .ccx .tg .tcell b{font-size:inherit}
.cc-card-pin .bd.ccx .th{display:none}
#cc-bar-tip::before{content:'';position:absolute;left:0;right:0;top:-12px;height:12px}
.ccx .tr.hv{cursor:default}#cc-bar-tip .tr.hv:hover{background:var(--cc-bg-hover,#262636)}
@keyframes ccTipUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ccTipDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
#cc-bar-tip[data-from=up]{animation:ccTipUp .16s ease-out}
#cc-bar-tip[data-from=down]{animation:ccTipDown .16s ease-out}
@media (prefers-reduced-motion:reduce){#cc-bar-tip{animation:none !important}}
#cc-bar-tip{position:fixed;z-index:2147482600;min-width:230px;max-width:520px;padding:8px 10px;background:var(--cc-bg,#10101a);border:1px solid var(--cc-border-strong,#4a4a62);border-radius:var(--cc-r-sm,8px);box-shadow:var(--cc-shadow,0 14px 40px rgba(0,0,0,.7));font:var(--cc-fs-sm,12.5px)/1.35 var(--cc-font,system-ui,sans-serif);color:var(--cc-text,#dcdce8);pointer-events:auto}
.ccx .th{color:var(--cc-text);font-weight:700;padding:0 2px 6px;border-bottom:1px solid var(--cc-border,#2e2e42);margin-bottom:4px}
.ccx .ts{display:flex;align-items:baseline;gap:8px;margin:8px 2px 3px;color:var(--cc-text-faint,#707086);font-size:11px;letter-spacing:.07em;text-transform:uppercase}
.ccx .ts b{font-weight:700;color:var(--cc-text-dim,#8f8fa4)}
.ccx .ts span{margin-left:auto;text-transform:none;letter-spacing:0;color:var(--cc-text-dim,#8f8fa4);font-size:11.5px}
.ccx .tr{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;background:var(--cc-bg-2,#161620);margin-bottom:2px}
.ccx .tr img{width:22px;height:22px;image-rendering:pixelated;flex:none}
.ccx .tr .tn{flex:1;min-width:0;white-space:nowrap}
.ccx .tr .tx{color:var(--cc-good,#5fe06d);font-weight:600}
.ccx .tr .tc{color:var(--cc-text,#fff);font-weight:700;min-width:70px;text-align:right}
.ccx .tl{padding:1px 2px}
.ccx .th{display:flex;align-items:baseline;gap:10px}
.ccx .th span{margin-left:auto;color:var(--cc-text-dim,#8f8fa4);font-weight:500;font-size:11.5px}
.ccx .tg{display:grid;gap:3px;margin:4px 0 2px}
.ccx .ttabs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0 0 6px}
.ccx .ttabs .tadd{flex:1 1 90px;min-width:70px;height:22px;box-sizing:border-box;padding:0 8px;border-radius:6px;border:1px solid var(--cc-border-strong);background:var(--cc-bg-2);color:var(--cc-text);font:inherit;font-size:12px}
.ccx .ttabs .tadd[hidden]{display:none}
.ccx .ttabs .tplus{padding:0 9px;font-weight:700}
.ccx .tfit{display:block;position:relative}
.ccx .tcell{position:relative;display:flex;align-items:center;justify-content:center;min-width:44px;height:44px;border-radius:7px;background:var(--cc-bg-2,#161620)}
.ccx .tcell img{width:28px;height:28px;image-rendering:pixelated}
.ccx .tcell b{position:absolute;right:3px;bottom:2px;font-size:11px;font-weight:700;color:var(--cc-text,#fff);text-shadow:0 0 3px #000,0 0 2px #000}
.ccx .tcell i{position:absolute;left:3px;top:1px;font-style:normal;font-size:9.5px;color:var(--cc-text-faint,#707086)}
.ccx .tcell u{position:absolute;left:4px;right:4px;bottom:1px;height:2px;background:var(--cc-bg-3,#1c1c28);border-radius:1px;overflow:hidden}
.ccx .tcell u{overflow:hidden;height:4px;bottom:4px;border-radius:2px}
.ccx .tcell u s{display:block;height:100%;background:var(--cc-good,#5fe06d)}
.ccx .tcell u s.q{position:absolute;top:0;bottom:0;background:#7dff94;box-shadow:0 0 4px rgba(125,255,148,.8)}
.ccx .tcell em.tup{position:absolute;right:3px;top:1px;font-style:normal;font-size:9px;color:var(--cc-accent,#ffd24a)}
.ccx .hv:hover{background:var(--cc-bg-hover,#262636)}
#cc-bar-tip.pcard{box-sizing:border-box;min-width:360px;min-height:310px}
.ccx .tg{justify-content:center;gap:4px;margin:8px 0 4px}
.ccx .tcell{min-width:0;width:var(--cs,44px);height:var(--cs,44px);background:var(--cc-bg-2,#161620);border:1px solid var(--cc-border,#2e2e42);border-radius:8px}
.ccx .tcell.total{width:auto !important;aspect-ratio:auto !important;height:var(--cs) !important;flex-direction:column;gap:1px}
.ccx .tcell .tl-l{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--cc-text-dim)}.ccx .tcell .tl-v{font-size:17px;font-weight:700;color:var(--cc-text);font-variant-numeric:tabular-nums}
.ccx .tcell.ghost{background:transparent;border-style:dashed;opacity:.55}
.ccx .tg.big{gap:5px;justify-content:center}
.ccx .tg.big .tcell{height:var(--cs,54px);width:var(--cs,54px);min-width:0}
.ccx .tg .tcell img{width:calc(var(--cs,44px) * .62);height:calc(var(--cs,44px) * .62)}
.ccx .tg .tcell b{font-size:12px}
.ccx .tg.big .tcell img{width:36px;height:36px}
.ccx .tcell.ghost img{opacity:.18;filter:grayscale(1)}
.ccx .tcell.hv{cursor:default}
.ccx .tq.clk{cursor:pointer}.ccx .tq.clk:hover{background:var(--cc-bg-hover)}
.ccx .tq.good{box-shadow:inset 3px 0 0 var(--cc-good,#5fe06d)}
.ccx .tq.good .tql span,#cc-bar-tip .tq.good .tqs{color:var(--cc-good,#5fe06d)}
.ccx .tch{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 4px}
.ccx .tch span{display:inline-flex;align-items:baseline;gap:6px;padding:3px 9px;border-radius:999px;background:var(--cc-bg-2,#161620);border:1px solid var(--cc-border,#2e2e42)}
.ccx .tch i{font-style:normal;color:var(--cc-text-dim,#8f8fa4);font-size:11px}
.ccx .tch b{color:var(--cc-text,#fff);font-weight:700}
.ccx .tst{display:grid;grid-template-columns:auto repeat(3,1fr);gap:2px 14px;margin:6px 0 2px;padding:7px 10px;border-radius:8px;background:var(--cc-bg-2,#161620);font-variant-numeric:tabular-nums}
.ccx .tst i{font-style:normal;color:var(--cc-text-faint,#707086);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;text-align:right}
.ccx .tst b{color:var(--cc-text,#fff);font-weight:600}
.ccx .tst span{text-align:right;font-weight:600}
.ccx .tst .p{color:var(--cc-good,#5fe06d)}#cc-bar-tip .tst .n{color:var(--cc-bad,#ff8a5c)}#cc-bar-tip .tst .z{color:var(--cc-text-faint,#707086)}
#cc-bar-tip.qbare{padding:0 !important;background:transparent !important;border:0 !important;box-shadow:none !important;min-width:0 !important;max-width:none !important;width:450px;overflow:visible !important;max-height:none !important;animation-name:ccTipDown}
#cc-bar-tip.qbare .th{display:none}
#cc-bar-tip.hascorner{padding-top:34px}
#cc-bar-tip .tcn{right:8px;top:7px}
.ccx .tload{margin:0 34px 6px 0}
.ccx .tcn{position:absolute;right:0;top:0;width:24px;height:24px;padding:0;border-radius:6px;border:1px solid var(--cc-border,#2e2e42);background:var(--cc-bg-2,#161620);cursor:pointer;display:flex;align-items:center;justify-content:center}
.ccx .tcn:hover{background:var(--cc-bg-hover,#262636);border-color:var(--cc-accent,#ffd24a)}
.ccx .tcn img{width:18px;height:18px;image-rendering:pixelated}
.ccx .tlb{margin:8px 2px 2px;color:var(--cc-text-faint,#707086);font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700}
.ccx .trw{display:flex;align-items:center;gap:9px;margin:3px 0;padding:5px 8px;border-radius:7px;background:var(--cc-bg-2,#161620)}
.ccx .trw img{width:24px;height:24px;image-rendering:pixelated;flex:none}
.ccx .trw .tm{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.ccx .trw .tm b{color:var(--cc-text,#fff);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccx .trw .tm span{color:var(--cc-text-dim,#8f8fa4);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccx .trw em{font-style:normal;font-weight:700;color:var(--cc-text-dim,#8f8fa4)}
.ccx .trw.good em{color:var(--cc-good,#5fe06d)}#cc-bar-tip .trw.bad em{color:var(--cc-bad,#ff8a5c)}
.ccx .trw.dim{opacity:.5}
.ccx .trw.spent{opacity:.45;filter:grayscale(.85)}
.ccx .trw.wact{flex-wrap:wrap}
.ccx .rimg{position:relative;flex:none;width:24px;height:24px;display:block}
.ccx .rimg i{position:absolute;left:0;bottom:-3px;font:700 11px/1 var(--cc-font,system-ui);font-style:normal;color:#fff;text-shadow:1px 1px 0 #000,0 0 2px #000;pointer-events:none}
.ccx .tacts{flex:1 0 100%;display:flex;align-items:center;gap:6px;margin-top:3px}
.ccx .tacts input[type=range]{flex:1;min-width:60px;height:14px;accent-color:var(--cc-accent,#ffd24a)}
.ccx .tacts .tqty{font-size:11.5px;color:var(--cc-text-dim,#8f8fa4);white-space:nowrap}
.ccx .tactbar{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px}
.ccx .tacts .tabtn{padding:0 9px}
.ccx .tabtn{cursor:pointer}.ccx .tabtn:disabled{opacity:.4;cursor:default}
.ccx .tabtn.buy:not(:disabled),.ccx .tabtn.reroll:not(:disabled){color:var(--cc-accent,#ffd24a)}
#cc-bar-tip2:has(.cc-tt-clone){width:max-content;max-width:620px}
#cc-bar-tip2 .cc-tt-clone{display:block !important;position:static !important;transform:none !important;opacity:1 !important;visibility:visible !important;width:auto !important;max-width:none !important;min-width:0 !important;background:transparent !important;border:0 !important;box-shadow:none !important;padding:0 !important;margin:0 !important;pointer-events:none}
.ccx .tq{margin:5px 0;padding:6px 8px;border-radius:7px;background:var(--cc-bg-2,#161620)}
.ccx .tql{display:flex;gap:8px}#cc-bar-tip .tql b{flex:1;color:var(--cc-text,#fff)}#cc-bar-tip .tql span{color:var(--cc-good,#5fe06d);font-weight:600}
.ccx .tqs{color:var(--cc-text-dim,#8f8fa4);font-size:11.5px;margin:1px 0 4px}
.ccx .tqb{height:5px;border-radius:3px;background:var(--cc-bg-3,#1c1c28);overflow:hidden}#cc-bar-tip .tqb i{display:block;height:100%;background:var(--cc-accent,#ffd24a)}
.ccx .tcl{display:flex;gap:6px;padding:1px 2px;font-size:12.5px}#cc-bar-tip .tcs{color:var(--cc-text-faint,#707086);flex:none}
.ccx .tclone{max-width:480px;max-height:360px;overflow:hidden}
.cc-bar .m.find{outline:2px solid var(--cc-accent,#ffd24a);outline-offset:-2px;background:var(--cc-accent-bg,#2a2518);animation:ccFind .9s ease-in-out infinite}
@keyframes ccFind{50%{background:transparent}}
@media (prefers-reduced-motion:reduce){.cc-bar .m.find{animation:none}}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- the real screen edge
  // The whole game area (canvas and all its panels) is squeezed vertically (by a few percent) into the space between the bars. The game itself is not told
  // anything (no resize, no changed window size), so it keeps its layout, zoom and saved panel positions; everything inside simply shrinks with it.
  const realH = () => window.innerHeight;
  let edge = { top: 0, bottom: 0, reserved: 0 }, appliedKey = '';
  window.__ccEdge = edge;
  window.__ccVH = () => window.innerHeight - (edge.bottom || 0);   // the bottom of the usable screen, for code that places things in viewport coordinates
  const gameBox = () => document.getElementById('game-container');
  function applyEdge(top, bottom, reserve) {
    edge.top = top; edge.bottom = bottom; edge.reserved = 0;
    const g = gameBox(), H = window.innerHeight, W = window.innerWidth;
    const k = reserve && (top || bottom) ? (H - top - bottom) / H : 1;
    const key = [top, bottom, reserve, H, W].join('|');
    if (key === appliedKey) return; appliedKey = key;
    if (!g) return;
    window.__ccGameScale = { x: 1, y: k };   // the game area is squeezed vertically only (a few percent), so it still fills the full width
    if (k < 1) { g.style.transformOrigin = '0 0'; g.style.transform = 'translate(0px,' + top + 'px) scale(1,' + k + ')'; }
    else { g.style.transform = ''; g.style.transformOrigin = ''; }
  }

  // ---------------------------------------------------------------- the hover card (replaces the browser's plain tooltip)
  let tipEl = null, tipFor = null, tipBar = null;
  const lastMouse = { x: -1 };
  const onMouseX = (e) => { lastMouse.x = e.clientX; };
  document.addEventListener('mousemove', onMouseX, true);
  const atCursor = () => { try { return window.__ccUI ? window.__ccUI.tipAtCursor() : true; } catch (e) { return true; } };
  let tip2 = null, hideT = 0;
  function hideDetail() { if (tip2) { tip2.remove(); tip2 = null; } }
  let tipOff = null;   // the hover card's subscription to its source (shared layer), only while the card is on screen
  function hideTip() { clearTimeout(hideT); hideDetail(); if (tipOff) { try { tipOff(); } catch (e) { /* gone */ } tipOff = null; } if (tipEl) { try { if (tipEl.classList.contains('qbare') && queueApi()) queueApi().unmountHover(); } catch (e) { /* ignore */ } try { if (tipEl.querySelector('#cc-route-alert') && window.__ccRouteAdvisor) window.__ccRouteAdvisor.park(); } catch (e) { /* ignore */ } tipEl.remove(); tipEl = null; } tipFor = null; }
  const keepTip = () => { clearTimeout(hideT); };
  const alertHover = () => { const a = document.getElementById('cc-route-alert'); return !!(a && a.matches(':hover')) || !!(queueApi() && queueApi().trayHover && queueApi().trayHover()); };
  const softHide = () => { clearTimeout(hideT); hideT = setTimeout(() => { if (alertHover()) { softHide(); return; } hideTip(); }, 320); };   // leaving the module or the card closes it after a short grace
  const softHideDetail = () => { clearTimeout(hideT); hideT = setTimeout(() => { hideDetail(); if (alertHover()) { softHideDetail(); return; } if (tipEl && !tipEl.matches(':hover') && !(tipFor && tipFor.el && tipFor.el.matches(':hover'))) hideTip(); }, 320); };   // the queue's option tray and the Route badge belong to the card: stay open while the pointer is on them
  // a second card next to the queue card: the options of the slot (or the details of the current task) you point at
  function showDetail(d, rowEl, cur) {
    hideDetail(); const host = rowEl.closest('#cc-bar-tip,.cc-card-pin'); if (!d || !host) return;
    tip2 = document.createElement('div'); tip2.id = 'cc-bar-tip2';
    if (d.title) { const hd = document.createElement('div'); hd.className = 'th'; hd.textContent = d.title; tip2.appendChild(hd); }
    if (d.html) { const w = document.createElement('div'); w.className = 'tooltip cc-tt-clone'; w.innerHTML = d.html; tip2.appendChild(w); }
    (d.blocks || []).forEach((bk) => {
      const box = document.createElement('div'); box.className = 'tbx' + (bk.on ? ' on' : '') + (bk.tiles ? ' ob' : ''); if (bk.tone) box.dataset.tone = bk.tone;
      const h = document.createElement('div'); h.className = 'ts' + (bk.on ? ' on' : '');
      if (bk.img) { const im = document.createElement('img'); im.src = bk.img; im.alt = ''; h.appendChild(im); }
      const hw = document.createElement('div'); hw.className = 'hw'; const hn = document.createElement('b'); hn.textContent = bk.h; hw.appendChild(hn);
      if (bk.sub) { const sb = document.createElement('span'); sb.textContent = bk.sub; hw.appendChild(sb); }
      h.appendChild(hw);
      const tg = document.createElement('div'); tg.className = 'tgs'; (bk.tags || []).forEach((t2) => { const g = document.createElement('em'); g.textContent = t2; if (t2 === 'selected') g.className = 'sel'; else if (t2 === 'fastest XP') g.className = 'bst'; tg.appendChild(g); }); if (tg.children.length) h.appendChild(tg);
      box.appendChild(h);
      if (bk.tiles) {
        const g = document.createElement('div'); g.className = 'otl';
        bk.tiles.forEach(([k, v]) => { const c = document.createElement('div'); c.className = 'ot'; const a = document.createElement('span'); a.textContent = k; const b2 = document.createElement('b'); b2.textContent = v; c.append(a, b2); g.appendChild(c); });
        box.appendChild(g);
        if (bk.note) { const nn = document.createElement('div'); nn.className = 'onote'; nn.textContent = bk.note; box.appendChild(nn); }
      } else {
        bk.lines.forEach(([k, v]) => { const r = document.createElement('div'); r.className = 'tkv'; const a = document.createElement('span'); a.textContent = k; const c = document.createElement('b'); c.textContent = v; r.append(a, c); box.appendChild(r); });
        if (bk.note) { const nn = document.createElement('div'); nn.className = 'onote'; nn.textContent = bk.note; box.appendChild(nn); }
      }
      tip2.appendChild(box);
    });
    tip2.addEventListener('mouseenter', keepTip); tip2.addEventListener('mouseleave', softHide);
    document.body.appendChild(tip2);
    if (cur && atCursor()) { tip2.style.pointerEvents = 'none'; tip2.dataset.cur = '1'; placeAtCursor(tip2, cur.clientX, cur.clientY); return; }   // item and skill cells: the tooltip sits at the pointer and goes the moment it leaves
    const tr = host.getBoundingClientRect(), rr = rowEl.getBoundingClientRect(), w2 = tip2.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    const left = tr.right + 6 + w2.width <= vw ? tr.right + 6 : Math.max(6, tr.left - w2.width - 6);
    tip2.style.left = left + 'px'; tip2.style.top = Math.max(6, Math.min(vh - w2.height - 6, rr.top - 8)) + 'px';
  }
  function placeAtCursor(t, x, y) {
    const w = t.offsetWidth, h = t.offsetHeight, E = window.__ccEdge || { top: 0, bottom: 0 };
    let left = x + 18, top = y + 22;
    if (left + w > window.innerWidth - 6) left = x - w - 14;
    if (top + h > window.innerHeight - (E.bottom || 0) - 6) top = y - h - 16;
    t.style.left = Math.round(Math.max(6, left)) + 'px'; t.style.top = Math.round(Math.max((E.top || 0) + 4, top)) + 'px';
  }
  // cursor: item / skill cells. Their tooltip follows the pointer and closes the moment it leaves (nothing to move into); the rows with option cards keep the short grace.
  const hoverDetail = (el, d, cursor) => {
    if (!d || !(d.html || d.blocks)) return;
    el.classList.add('hv');
    el.addEventListener('mouseenter', (ev) => { keepTip(); showDetail(d, el, cursor ? ev : null); });
    if (cursor) {
      el.addEventListener('mousemove', (ev) => { if (tip2 && tip2.dataset.cur && atCursor()) placeAtCursor(tip2, ev.clientX, ev.clientY); });
      el.addEventListener('mouseleave', () => { if (tip2 && tip2.dataset.cur) { hideDetail(); if (tipEl) softHideDetail(); } else softHideDetail(); });
    } else el.addEventListener('mouseleave', softHideDetail);
  };
  // rich.gear = { tip, items: () => kit menu items }: a cogwheel in the header of the hover card and of the pinned panel
  function gearBtn(rich) {
    const g = document.createElement('button'); g.type = 'button'; g.className = 'cc-ib tgear'; g.textContent = '\u2699'; g.title = rich.gear.tip || 'Settings';
    g.addEventListener('mousedown', (e) => e.stopPropagation());
    g.addEventListener('click', (e) => { e.stopPropagation(); const r = g.getBoundingClientRect(); try { window.__ccUI.menu(rich.gear.items(), r.left, r.bottom + 4); } catch (er) { /* kit gone */ } });
    return g;
  }
  const tipSig = (x) => JSON.stringify(x.richFn ? x.richFn() : (x.rich || x.tip));
  // a button on a card that hands the user's own click to the game's matching control (the card's onClick looks the game button up at that moment; a synthetic click is ignored)
  function actBtn(b) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'cc-chip tabtn ' + (b.cls || ''); c.textContent = b.label; c.disabled = !!b.disabled; if (b.on) c.classList.add('on');
    c.addEventListener('mousedown', (ev) => ev.stopPropagation());
    c.addEventListener('click', (ev) => { ev.stopPropagation(); if (!ev.isTrusted || c.disabled) return; try { b.onClick(); } catch (e) { /* the game button is gone */ } fwdFor(c); });
    hoverDetail(c, b.detail); return c;
  }
  // the card body (grids, bars, rows, chips ...): built once for the hover card and for the pinned panel, so both look the same
  function fillCard(host, rich, text) {
    const fwd = () => fwdFor(host);
    if (rich && rich.blocks) rich.blocks.forEach((bk) => {
      if (bk.kind === 'grid') {
        const g = document.createElement('div'); g.className = 'tg' + (bk.big ? ' big' : ''); const cs = bk.cell || (bk.big ? 54 : 44); g.style.gridTemplateColumns = 'repeat(' + bk.cols + ',' + cs + 'px)'; g.style.setProperty('--cs', cs + 'px'); g.style.setProperty('--cols', String(bk.cols)); if (host.id === 'cc-bar-tip' && bk.cols * (cs + 4) + 30 > 520) host.style.maxWidth = Math.round(Math.min(window.innerWidth * 0.96, bk.cols * (cs + 4) + 30)) + 'px';   // a wide grid (few rows) widens the card
        bk.cells.forEach((cl) => {
          const c = document.createElement('div'); c.className = 'tcell' + (cl.ghost ? ' ghost' : '') + (cl.total ? ' total' : ''); if (cl.tip) c.dataset.tip = cl.tip;
          if (cl.span) c.style.gridColumn = 'span ' + cl.span;
          if (cl.total) { const l1 = document.createElement('span'); l1.className = 'tl-l'; l1.textContent = cl.total.label; const v1 = document.createElement('span'); v1.className = 'tl-v'; v1.textContent = String(cl.total.value); c.append(l1, v1); }
          if (cl.pos) { c.style.gridRow = String(cl.pos[0]); c.style.gridColumn = String(cl.pos[1]); }
          if (cl.img) { const im = document.createElement('img'); im.src = cl.img; im.alt = ''; c.appendChild(im); }
          if (cl.txt) { const tx = document.createElement('b'); tx.textContent = cl.txt; c.appendChild(tx); }
          if (cl.tier) { const tr = document.createElement('i'); tr.textContent = cl.tier; c.appendChild(tr); }
          if (cl.frac != null) {
            const pr = document.createElement('u'); const fl = document.createElement('s'); fl.style.width = Math.round(Math.max(0, Math.min(1, cl.frac)) * 100) + '%'; if (cl.col) fl.style.background = cl.col; pr.appendChild(fl);
            if (cl.q) { const qs = document.createElement('s'); qs.className = 'q'; qs.style.left = (cl.q[0] * 100).toFixed(1) + '%'; qs.style.width = Math.max(1, Math.min(100 - cl.q[0] * 100, cl.q[1] * 100)).toFixed(1) + '%'; pr.appendChild(qs); }
            c.appendChild(pr);
          }
          if (cl.up) { const ub = document.createElement('em'); ub.className = 'tup'; ub.textContent = '▲'; ub.title = 'Your queue levels this skill up'; c.appendChild(ub); }
          if (cl.onClick) { c.style.cursor = 'pointer'; c.addEventListener('click', (ev) => { ev.stopPropagation(); try { cl.onClick(); } catch (e) { /* the game cell is gone */ } fwd(); }); }
          hoverDetail(c, cl.detail, true);
          g.appendChild(c);
        });
        if (bk.maxRows) { g.style.maxHeight = (bk.maxRows * (cs + 4)) + 'px'; g.style.overflowY = 'auto'; g.style.alignContent = 'start'; }
        host.appendChild(g);
      } else if (bk.kind === 'bars') {
        bk.rows.forEach((r) => {
          const w = document.createElement('div'); w.className = 'tq' + (r.tone ? ' ' + r.tone : '');
          const l = document.createElement('div'); l.className = 'tql'; const a = document.createElement('b'); a.textContent = r.name; l.appendChild(a); if (r.right) { const rr = document.createElement('span'); rr.textContent = r.right; l.appendChild(rr); }
          const sub = document.createElement('div'); sub.className = 'tqs'; sub.textContent = r.sub;
          const bar = document.createElement('div'); bar.className = 'tqb'; const fi = document.createElement('i'); fi.style.width = Math.round(Math.max(0, Math.min(1, r.frac)) * 100) + '%'; bar.appendChild(fi);
          w.append(l, sub, bar); hoverDetail(w, r.detail);
          if (r.click) { w.classList.add('clk'); w.setAttribute('role', 'button'); w.tabIndex = 0; w.title = 'Open in the game'; const go = (ev) => { ev.stopPropagation(); try { r.click(); } catch (e) { /* the game panel is not there */ } fwd(); }; w.addEventListener('click', go); w.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } }); }
          host.appendChild(w);
        });
      } else if (bk.kind === 'tabs') {
        const bar = document.createElement('div'); bar.className = 'ttabs';
        if (bk.add) {
          const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'cc-chip tplus'; plus.textContent = '+'; plus.title = bk.addTip || 'Add'; bar.appendChild(plus);
          const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'tadd'; inp.placeholder = bk.addHint || 'Name...'; inp.hidden = true;
          plus.addEventListener('click', (ev) => { ev.stopPropagation(); inp.hidden = !inp.hidden; if (!inp.hidden) inp.focus(); });
          inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { const v = inp.value.trim(); if (v) { try { bk.add(v); } catch (e) { /* the game's box is not there */ } fwd(); } inp.value = ''; inp.hidden = true; inp.blur(); } else if (ev.key === 'Escape') { inp.value = ''; inp.hidden = true; inp.blur(); } });
          bar.appendChild(inp);
        }
        bk.tabs.forEach((t) => { const c = document.createElement('button'); c.type = 'button'; c.className = 'cc-chip' + (t.on ? ' on' : ''); c.textContent = t.label; c.addEventListener('click', (ev) => { ev.stopPropagation(); try { t.onClick(); } catch (e) { /* game tab is gone */ } fwd(); }); bar.appendChild(c); });
        host.appendChild(bar);
      } else if (bk.kind === 'actions') {
        const w = document.createElement('div'); w.className = 'tactbar'; bk.buttons.forEach((b) => w.appendChild(actBtn(b))); host.appendChild(w);
      } else if (bk.kind === 'rows') {
        bk.rows.forEach((r) => {
          const w = document.createElement('div'); w.className = 'trw' + (r.tone ? ' ' + r.tone : '') + (r.dim ? ' dim' : '') + (r.spent ? ' spent' : '') + (r.qty || r.buttons ? ' wact' : '');
          if (r.img) { const im = document.createElement('img'); im.src = r.img; im.alt = ''; if (r.tier) { const iw = document.createElement('span'); iw.className = 'rimg'; const tb = document.createElement('i'); tb.textContent = r.tier; iw.append(im, tb); w.appendChild(iw); } else w.appendChild(im); }
          const mid = document.createElement('div'); mid.className = 'tm'; const a = document.createElement('b'); a.textContent = r.name; if (r.col) a.style.color = r.col; mid.appendChild(a);
          if (r.sub) { const s2 = document.createElement('span'); s2.textContent = r.sub; mid.appendChild(s2); }
          w.appendChild(mid);
          if (r.right) { const rt = document.createElement('em'); rt.textContent = r.right; w.appendChild(rt); }
          if (r.ctx) w.addEventListener('contextmenu', (ev) => { if (setting('uiPlayerMenu', true) === false) return; ev.preventDefault(); ev.stopPropagation(); openPlayerMenu(r.name, r.ctx, ev.clientX, ev.clientY); });   // the game's own player menu (message, mute, remove ...)
          if (r.click) { w.classList.add('clk'); w.setAttribute('role', 'button'); w.tabIndex = 0; w.style.cursor = 'pointer'; w.addEventListener('click', (ev) => { ev.stopPropagation(); try { r.click(); } catch (e) { /* the game panel is not there */ } fwd(); }); }
          hoverDetail(w, r.detail);
          if (r.qty || r.buttons) {
            const ac = document.createElement('div'); ac.className = 'tacts';
            if (r.qty) {
              const q = r.qty, lb = document.createElement('span'); lb.className = 'tqty'; lb.textContent = q.text;
              const rg = document.createElement('input'); rg.type = 'range'; rg.min = String(q.min); rg.max = String(q.max); rg.value = String(q.value); rg.disabled = !!q.disabled; rg.title = 'Amount';
              ['mousedown', 'click'].forEach((t) => rg.addEventListener(t, (ev) => ev.stopPropagation()));
              rg.addEventListener('input', (ev) => { ev.stopPropagation(); if (!ev.isTrusted) return; try { lb.textContent = q.onInput(parseInt(rg.value, 10) || 1) || lb.textContent; } catch (e) { /* game slider gone */ } fwd(); });
              ac.append(rg, lb);
            }
            (r.buttons || []).forEach((b) => ac.appendChild(actBtn(b)));
            w.appendChild(ac);
          }
          host.appendChild(w);
        });
      } else if (bk.kind === 'chips') {
        const w = document.createElement('div'); w.className = 'tch';
        bk.chips.forEach(([k, v]) => { const c = document.createElement('span'); const a = document.createElement('i'); a.textContent = k; const b2 = document.createElement('b'); b2.textContent = v; c.append(a, b2); w.appendChild(c); });
        host.appendChild(w);
      } else if (bk.kind === 'stats') {
        const w = document.createElement('div'); w.className = 'tst';
        bk.head.forEach((hh) => { const c = document.createElement('i'); c.textContent = hh; w.appendChild(c); });
        bk.rows.forEach((r) => {
          const n = document.createElement('b'); n.textContent = r.name; w.appendChild(n);
          r.vals.forEach((v) => { const c = document.createElement('span'); c.textContent = v || '–'; c.className = /^\+0$/.test(v) || !v ? 'z' : /^-/.test(v) ? 'n' : 'p'; w.appendChild(c); });
        });
        host.appendChild(w);
      } else if (bk.kind === 'label') {
        const d = document.createElement('div'); d.className = 'tlb'; d.textContent = bk.text; host.appendChild(d);
      } else if (bk.kind === 'chat') {
        bk.lines.forEach((ln) => { const d = document.createElement('div'); d.className = 'tcl'; const ts = document.createElement('span'); ts.className = 'tcs'; ts.textContent = ln.ts; const tx = document.createElement('span'); if (setting('chatLinks', true) !== false && window.__ccUI && window.__ccUI.linkify) window.__ccUI.linkify(tx, ln.text); else tx.textContent = ln.text; if (ln.color) tx.style.color = ln.color; d.appendChild(ts); if (ln.world && setting('chatWorldTag', true) !== false) { const w = document.createElement('b'); w.textContent = ln.world; w.title = 'World ' + ln.world.replace(/^W/i, ''); w.style.cssText = 'flex:none;font-size:10.5px;color:var(--cc-text-dim,#8f8fa4)'; d.appendChild(w); } (ln.badges || []).forEach((bg) => { const im = document.createElement('img'); im.src = bg.src; im.alt = ''; im.title = bg.alt; im.style.cssText = 'flex:none;width:1.15em;height:1.15em;image-rendering:pixelated'; d.appendChild(im); }); d.appendChild(tx); host.appendChild(d); });
      } else if (bk.kind === 'clone') { const w = document.createElement('div'); w.className = 'tclone'; w.appendChild(bk.node); host.appendChild(w); }
      else if (bk.kind === 'text') { const d = document.createElement('div'); d.className = 'tl'; d.textContent = bk.text; host.appendChild(d); }
    });
    if (rich && rich.sections) {
      rich.sections.forEach((sec) => {
        const h = document.createElement('div'); h.className = 'ts'; const hn = document.createElement('b'); hn.textContent = sec.h; h.appendChild(hn);
        if (sec.note) { const n = document.createElement('span'); n.textContent = sec.note; h.appendChild(n); }
        host.appendChild(h);
        sec.items.forEach((it) => {
          const r = document.createElement('div'); r.className = 'tr' + (it.detail ? ' hv' : '');
          if (it.detail) { r.addEventListener('mouseenter', () => { keepTip(); showDetail(it.detail, r); }); r.addEventListener('mouseleave', softHideDetail); }
          const im = document.createElement('img'); im.src = it.img; im.alt = ''; r.appendChild(im);
          const nm = document.createElement('span'); nm.className = 'tn'; nm.textContent = (it.tier ? it.tier + ' ' : '') + it.name; r.appendChild(nm);
          if (it.stat) { const st = document.createElement('span'); st.className = 'tx'; st.textContent = it.stat; r.appendChild(st); }
          const c = document.createElement('span'); c.className = 'tc'; c.textContent = it.count; r.appendChild(c);
          host.appendChild(r);
        });
      });
    } else if (!rich) {
      String(text).split('\n').forEach((ln) => { const d = document.createElement('div'); d.className = 'tl'; d.textContent = ln; host.appendChild(d); });
    }
    if (rich && rich.corner) {
      const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'tcn'; cb.title = rich.corner.tip || '';
      const ci = document.createElement('img'); ci.src = rich.corner.img; ci.alt = ''; cb.appendChild(ci);
      cb.addEventListener('click', (ev) => { ev.stopPropagation(); try { rich.corner.click(); } catch (e) { /* the game's launcher is not there */ } fwd(); });
      host.appendChild(cb); host.classList.add('hascorner');
    }
  }
  function showTip(x, bar, quiet) {
    hideTip();
    const rich = x.richFn ? x.richFn() : x.rich, text = x.tip;
    if (!rich && !text) return;
    tipEl = document.createElement('div'); tipEl.id = 'cc-bar-tip'; tipFor = x; tipBar = bar;
    tipEl.addEventListener('mouseenter', keepTip); tipEl.addEventListener('mouseleave', softHideDetail);
    const hd = document.createElement('div'); hd.className = 'th'; hd.textContent = (rich && rich.title) || x.def.label;
    if (rich && rich.note) { const nn = document.createElement('span'); nn.textContent = rich.note; hd.appendChild(nn); }
    if (rich && rich.gear) hd.appendChild(gearBtn(rich));
    tipEl.appendChild(hd);
    tipEl.classList.add('ccx');
    if (rich && rich.queue) tipEl.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('.cc-q-head, .cc-q-foot') && toggleQueue()) { /* kept as a panel */ } });
    if (rich && rich.topWidget) { const hostW = document.createElement('div'); hostW.className = 'tw'; tipEl.appendChild(hostW); try { window.__ccRouteAdvisor.toCard(hostW); } catch (e) { /* no widget */ } }
    if (rich && rich.panel) { const mn = rich.min || [360, 310]; tipEl.style.boxSizing = 'border-box'; tipEl.style.minWidth = mn[0] + 'px'; tipEl.style.minHeight = mn[1] + 'px'; }
    fillCard(tipEl, rich, text);
    if (rich && rich.queue && queueApi()) { tipEl.classList.add('qbare'); queueApi().mountHover(tipEl); }
    document.body.appendChild(tipEl);
    try { tipEl.dataset.sig = tipSig(x); } catch (e) { /* no signature: it is redrawn when the pointer returns */ }
    if (quiet) tipEl.style.animation = 'none';
    const r = x.el.getBoundingClientRect(), vw = window.innerWidth;
    if (x.def && x.def.matchWidth) { tipEl.style.boxSizing = 'border-box'; tipEl.style.minWidth = tipEl.style.maxWidth = tipEl.style.width = Math.round(r.width) + 'px'; }
    const tr = tipEl.getBoundingClientRect();
    // spawned on the pointer (centred on it) unless Settings > Panels > Tooltips at the cursor is off, then it hangs under the module's left edge
    const cx = atCursor() && lastMouse.x >= r.left - 2 && lastMouse.x <= r.right + 2 ? lastMouse.x : null;
    tipEl.style.left = Math.max(6, cx != null ? Math.min(vw - tr.width - 6, cx - tr.width / 2) : r.left + tr.width + 6 <= vw ? r.left : Math.min(vw - tr.width - 6, r.right - tr.width)) + 'px';
    if (!rich) tipEl.dataset.plain = '1';
    tipEl.dataset.from = bar && bar.dataset.pos === 'bottom' ? 'up' : 'down';
    // a card on a bottom bar is anchored by its bottom edge (it grows upwards when something slides open), on a top bar by its top edge; it scrolls if it is taller than the room
    const E = window.__ccEdge || { top: 0, bottom: 0 };
    if (bar && bar.dataset.pos === 'bottom') {
      tipEl.style.top = 'auto'; tipEl.style.bottom = Math.max(6, window.innerHeight - r.top + 8) + 'px'; tipEl.style.maxHeight = Math.max(160, r.top - 8 - (E.top || 0) - 6) + 'px';
    } else {
      tipEl.style.top = (r.bottom + 8) + 'px'; tipEl.style.maxHeight = Math.max(160, window.innerHeight - (E.bottom || 0) - r.bottom - 14) + 'px';
    }
    tipEl.style.overflowY = 'auto';
    const S = sync();
    if (S && x.key && x.richFn) tipOff = S.watch(x.key, (info) => {
      if (tipFor !== x || !tipEl) return true;
      try { if (tipEl.dataset.sig === tipSig(x)) return true; } catch (e) { return true; }
      if (!S.mayRedraw(tipEl, info)) return false;
      const st = tipEl.scrollTop, left = tipEl.style.left; showTip(x, tipBar, true);
      if (tipEl) { tipEl.style.left = left; tipEl.scrollTop = st; }
      return true;
    });
  }


  // ---------------------------------------------------------------- pinned cards: the same card as a movable, resizable panel (a click on the button, if the module is set to it)
  const CARD_TABS = ['skills', 'inventory', 'equipment', 'diary', 'quests', 'friends', 'barter'];
  const cardPanels = {};
  // Fit the slot grid to the panel body like a flex grid: try every column count, take the one that makes the slots biggest, and size the cells to fill the room.
  function fitGrid(bd) {
    const g = bd.querySelector('.tg'); if (!g) return; const n = g.children.length; if (!n) return;
    const cs = getComputedStyle(bd), W = bd.clientWidth - 2 - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), note = bd.querySelector('.tl'), H = bd.clientHeight - 2 - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (note ? note.offsetHeight + (parseFloat(cs.rowGap) || 0) : 0) - (parseFloat(getComputedStyle(g).marginTop) || 0) - (parseFloat(getComputedStyle(g).marginBottom) || 0);
    if (!(W > 20)) return;
    const Hh = Math.max(H, 24);
    const gap = 4; let bc = 1, bs = 0;
    const tot = g.querySelector(':scope > .tcell.total'), cnt = tot ? n - 1 : n;   // with a Total cell: it fills what is left of the last row, or is a row of its own
    const rowsOf = (c) => (tot ? Math.ceil(cnt / c) + (cnt % c ? 0 : 1) : Math.ceil(n / c));
    const share = !!tot && setting('uiSkillShareTotal', true) !== false;
    for (let pass = 0; pass < 2 && !bs; pass++) for (let c = 1; c <= n; c++) { if (pass === 0 && share && cnt % c === 0) continue; const r = rowsOf(c), s = Math.min((W - (c - 1) * gap) / c, (Hh - (r - 1) * gap) / r); if (s > bs) { bs = s; bc = c; } }
    if (tot) tot.style.gridColumn = 'span ' + (cnt % bc ? bc - (cnt % bc) : bc);
    const tooSmall = bs < 12;   // only a panel this small (the slots would be under 12 px) gets a scroll bar; otherwise the grid always fits and there is none
    bs = Math.max(12, Math.min(Math.floor(bs) - 1, 120));
    bd.style.overflowY = tooSmall ? 'auto' : 'hidden'; bd.style.overflowX = 'hidden';
    g.style.setProperty('grid-template-columns', 'repeat(' + bc + ',' + bs + 'px)', 'important'); g.style.setProperty('--cs', bs + 'px'); g.style.setProperty('justify-content', 'center', 'important'); g.style.setProperty('align-content', 'center'); g.style.maxHeight = 'none'; g.style.overflow = 'visible';
    g.style.setProperty('font-size', Math.max(10, Math.round(bs * 0.24)) + 'px');
  }
  // Cards made of rows (diary, quests, friends, barter ...) cannot change their grid, so when they do not fit the panel they shrink as a whole (down to 60%) before they would scroll.
  function fitList(bd) {
    const w = bd.querySelector(':scope > .tfit'); if (!w) return;
    w.style.zoom = ''; if (!(bd.clientHeight > 40) || bd.scrollHeight <= bd.clientHeight + 1) return;
    let f = Math.max(0.6, bd.clientHeight / bd.scrollHeight); w.style.zoom = f.toFixed(3);
    for (let i = 0; i < 2 && f > 0.6 && bd.scrollHeight > bd.clientHeight + 1; i++) { f = Math.max(0.6, f * bd.clientHeight / bd.scrollHeight * 0.99); w.style.zoom = f.toFixed(3); }
  }
  function keepCardHeight(tab, cp) {
    const el = cp.api.el;
    if (el.classList.contains('cc-sized')) { el.style.minHeight = ''; return; }
    const E = window.__ccEdge || { top: 0, bottom: 0 }, room = innerHeight - (E.top || 0) - (E.bottom || 0) - 8;
    let top = 0; try { top = Number(localStorage.getItem('cc-card-ph-' + tab)) || 0; } catch (e) { /* none */ }
    const now = Math.round(el.offsetHeight); if (now > top && now <= room) { top = now; try { localStorage.setItem('cc-card-ph-' + tab, String(top)); } catch (e) { /* not saved */ } }
    el.style.minHeight = top ? Math.min(top, room) + 'px' : '';
  }
  function renderCard(tab, force, info) {   // returns false when the redraw had to wait (see __ccCardSync.mayRedraw), true otherwise
    const cp = cardPanels[tab]; if (!cp) return true;
    let rich; try { rich = panelCard0(tab); } catch (e) { swal('card ' + tab, e); return true; }
    let sg = ''; try { sg = JSON.stringify(rich); } catch (e) { /* no signature: always redraw */ }
    if (!force && sg && sg === cp.sig) return true;
    if (!force && cp.sig) { const S = sync(); if (S && !S.mayRedraw(cp.api.body, info || { forwarded: S.following() })) return false; }   // one rule for every card, in card-sync.js
    cp.sig = sg; hideDetail();
    const bd = cp.api.body, fk = focusKey(bd); bd.textContent = '';
    const isGrid = (tab === 'inventory' || tab === 'skills') && rich.auto;
    const host = isGrid ? bd : bd.appendChild(Object.assign(document.createElement('div'), { className: 'tfit' }));   // the wrapper is what fitList shrinks
    if (rich.loadout && rich.note) {
      const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'cc-chip tload'; nb.textContent = rich.note + ' \u25BE'; nb.title = 'Swap loadout';
      nb.addEventListener('click', (ev) => {
        ev.stopPropagation(); const r = nb.getBoundingClientRect(), lo = rich.loadout, items = [];
        lo.families.forEach((f) => { items.push({ head: f.label }); f.slots.forEach((s) => items.push({ label: s.name, checked: () => s.id === lo.current, onClick: () => lo.pick(f.id, s.id) })); });
        window.__ccUI.menu(items, r.left, r.bottom + 4);
      });
      host.appendChild(nb);
    } else if (rich.note) { const n = document.createElement('div'); n.className = 'tl'; n.style.cssText = 'color:var(--cc-text-dim);font-size:12px'; n.textContent = rich.note; host.appendChild(n); }
    fillCard(host, rich, '', tab);
    cp.api.setGear(rich.gear ? { tip: rich.gear.tip, items: rich.gear.items } : null);
    cp.fit = !!((tab === 'inventory' || tab === 'skills') && rich.auto); if (!cp.fit && (tab === 'inventory' || tab === 'skills')) { cp.api.body.style.overflowY = ''; cp.api.body.style.overflowX = ''; } // A card you have not resized keeps the tallest height it has had (Friends > Muted with an empty list must not collapse it); a resized card keeps your size.
    // Applied to the panel itself (never taller than the room between the info bars), after the content was fitted.
    bd.style.minHeight = '';
    if (cp.fit) fitGrid(bd); else fitList(bd);
    keepCardHeight(tab, cp); restoreFocus(bd, fk);
    if (!cp.ro) { try { cp.ro = new ResizeObserver(() => { if (cp.api.el.classList.contains('cc-sized') && cp.api.el.style.minHeight) cp.api.el.style.minHeight = ''; if (cp.fit) fitGrid(cp.api.body); else fitList(cp.api.body); }); cp.ro.observe(cp.api.body); } catch (e) { /* no observer */ } }
    return true;
  }
  // a redraw replaces the controls: the one that had the keyboard focus gets it back (same position in the card)
  const FOCUSABLE = 'button,input,select';
  function focusKey(bd) { const a = document.activeElement; if (!a || !bd.contains(a) || !a.matches(FOCUSABLE)) return -1; return Array.prototype.indexOf.call(bd.querySelectorAll(FOCUSABLE), a); }
  function restoreFocus(bd, k) { if (k < 0) return; const e = bd.querySelectorAll(FOCUSABLE)[k]; if (e) { try { e.focus({ preventScroll: true }); } catch (er) { /* not focusable */ } } }
  function ensureCard(tab) {
    if (cardPanels[tab]) return cardPanels[tab];
    const UI = window.__ccUI; if (!UI || !UI.panel) return null;
    const api = UI.panel({ id: 'cc-card-' + tab, title: pretty(tab), collapsible: true, closable: true, resizable: true, width: tab === 'skills' ? 420 : 400 });
    api.el.classList.add('cc-card-pin'); api.body.classList.add('ccx'); api.el.dataset.ccMin = '260,120';
    api.onOpenChange((v) => { if (v) { renderCard(tab, true); cardWatch(tab); } else cardUnwatch(tab); });
    const cp = cardPanels[tab] = { api, sig: '', off: null, vis: null, was: false };
    // a collapsed or re-shown card catches up at once (nothing redraws it while it is folded)
    try { cp.vis = new MutationObserver(() => { const sh = api.isShown() && !api.collapsed(); if (sh && !cp.was) renderCard(tab, true); cp.was = sh; }); cp.vis.observe(api.el, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* no observer */ }
    if (api.isOpen()) cardWatch(tab);
    return cp;
  }
  // A pinned card follows its source through the shared layer (one observer per game panel, only while the card is open)
  function cardWatch(tab) {
    const cp = cardPanels[tab], S = sync(); if (!cp || cp.off || !S) return;
    cp.off = S.watch(tab, (info) => (cp.api.isShown() && !cp.api.collapsed() ? renderCard(tab, false, info) : true));
  }
  function cardUnwatch(tab) { const cp = cardPanels[tab]; if (cp && cp.off) { try { cp.off(); } catch (e) { /* gone */ } cp.off = null; } }
  const cardApi = {
    isOpen: (tab) => !!(cardPanels[tab] && cardPanels[tab].api.isOpen()),
    isCollapsed: (tab) => !!(cardPanels[tab] && cardPanels[tab].api.collapsed()),
    toggle(tab) {
      if (!CARD_TABS.includes(tab)) return false;
      const cp = ensureCard(tab); if (!cp) return false;
      const fresh = !(window.__ccUI.store.get('panel:cc-card-' + tab, null) || {}).x;
      cp.api.toggle(); hideTip();
      if (cp.api.isOpen()) {
        cp.api.setCollapsed(false);
        renderCard(tab, true);
        if (fresh) {   // first time: open it right above (or below) the button it belongs to
          const be = buttonEl(tab), el = cp.api.el;
          if (be) { const r = be.el.getBoundingClientRect(); el.style.left = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, r.left + r.width / 2 - el.offsetWidth / 2)) + 'px'; el.style.top = Math.max(6, be.pos === 'bottom' ? r.top - el.offsetHeight - 8 : r.bottom + 8) + 'px'; try { window.__ccClamp && window.__ccClamp(); } catch (e) { /* ignore */ } }
        }
      }
      return true;
    },
    restore() { CARD_TABS.forEach((tab) => { const st = window.__ccUI && window.__ccUI.store.get('panel:cc-card-' + tab, null); if (st && st.open) { const cp = ensureCard(tab); if (cp) { cp.api.show(true); renderCard(tab, true); } } }); },
    destroy() { Object.values(cardPanels).forEach((c) => { try { if (c.off) c.off(); if (c.vis) c.vis.disconnect(); if (c.ro) c.ro.disconnect(); c.api.destroy(); } catch (e) { /* gone */ } }); },
  };

  // ---------------------------------------------------------------- bars
  const bars = {};
  const heightPx = () => H[String(setting('uiBarHeight', 'normal'))] || 34;
  function makeBar(pos) {
    const el = document.createElement('div'); el.className = 'cc-bar cc-ibar' + (pos === 'bottom' ? ' bottom' : ''); el.dataset.th = '1100,700'; el.dataset.pos = pos; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', pos === 'top' ? 'Top info bar' : 'Bottom info bar');
    const zl = document.createElement('div'); zl.className = 'zl'; const zc = document.createElement('div'); zc.className = 'zc'; const zr = document.createElement('div'); zr.className = 'zr';
    el.append(zl, zc, zr); document.body.appendChild(el);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); const m = e.target.closest('.m'), pi = e.target.closest('.pi[data-key]'); showMenu(e.clientX, e.clientY, pos, m ? m.dataset.id : null, m ? m.dataset.s : null, m ? Number(m.dataset.i) : -1, pi && /^(pbtn|panelbtns)$/.test(m ? m.dataset.id : '') ? pi.dataset.key : null); });
    ['mousedown', 'click', 'wheel'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
    try { window.__ccUI.ccWatch(el); } catch (e) { /* kit gone: no width classes */ }
    const ro = new ResizeObserver(() => fitSoon()); ro.observe(el);   // a new window width: fit again (coalesced into one frame)
    return { pos, el, zl, zc, zr, mods: {}, ro };
  }
    function ensureModules(b) {
    const list = cfg[b.pos];
    const want = list.map((m, i) => m.id + '|' + m.s + '|' + i);
    if (b.sig === want.join(',')) return;
    b.sig = want.join(','); b.zl.textContent = ''; b.zc.textContent = ''; b.zr.textContent = ''; b.mods = {}; b.ovf = null; b.fitKey = '';
    list.forEach((m, i) => {
      const def = MODULES[m.id]; if (!def) return;
      const e = document.createElement('div'); e.className = 'm' + (def.click ? ' clk' : ''); e.dataset.id = m.id; e.dataset.s = m.s; e.dataset.i = String(i);
      e.innerHTML = '<span class="i"></span><span class="t"></span><span class="pc"></span><span class="f"><i></i></span>';
      e.querySelector('.i').textContent = def.icon;
      if (def.click) e.addEventListener('click', (ev) => { if (!dragMoved) def.click(m.o || {}); });
      e.addEventListener('mousedown', (ev) => { hideTip(); startDrag(ev, b, m, e); });
      // keyboard: a clickable module is a button you can Tab to and press with Enter or Space
      if (def.click) { e.setAttribute('role', 'button'); e.tabIndex = 0; e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); e.click(); } }); } else e.setAttribute('role', 'group');
      e.setAttribute('aria-label', def.label);
      e.addEventListener('mouseenter', (ev0) => { lastMouse.x = ev0.clientX; if (def.peek && window.__ccChat && window.__ccChat.peek) { hideTip(); window.__ccChat.peek(e, b.pos); return; }
        if (m.id === 'alerts' && window.__ccAlerts && window.__ccAlerts.peek) { hideTip(); window.__ccAlerts.peek(e, b.pos); return; }   /* hovering the Alerts module opens the alert list there */ keepTip(); const xx = Object.values(b.mods).find((q) => q.el === e); if (xx && tipFor !== xx) showTip(xx, b.el); });
      e.addEventListener('mousemove', (ev1) => { if (tipEl && tipEl.dataset.plain && tipFor && tipFor.el === e && atCursor()) tipEl.style.left = Math.max(6, Math.min(window.innerWidth - tipEl.offsetWidth - 6, ev1.clientX - tipEl.offsetWidth / 2)) + 'px'; });
      e.addEventListener('mouseleave', () => { if (def.peek && window.__ccChat && window.__ccChat.unpeek) window.__ccChat.unpeek(); if (m.id === 'alerts' && window.__ccAlerts && window.__ccAlerts.unpeek) window.__ccAlerts.unpeek(); softHide(); });
      (m.s === 'r' ? b.zr : m.s === 'c' ? b.zc : b.zl).appendChild(e); b.mods[i] = { el: e, m, def, t: e.querySelector('.t'), pc: e.querySelector('.pc'), f: e.querySelector('.f'), fi: e.querySelector('.f i'), icon: e.querySelector('.i') };
    });
    if (!list.length) { const em = document.createElement('div'); em.className = 'empty'; em.textContent = 'Right-click to add modules'; b.zl.appendChild(em); }
  }
  function refresh() {
    applyHides();
    const ctx = { live: null, held: null, alert: null };
    const bg = bridge();
    if (bg) { try { ctx.live = bg.live(); ctx.held = (bg.snapshot && bg.snapshot() || {}).held || bg.held(); } catch (e) { /* not ready */ } try { ctx.alert = bg.alertState && bg.alertState(); } catch (e) { /* not ready */ } }
    document.body.classList.toggle('cc-sp-nohover', setting('uiBarSpacerHover', true) === false);
    document.body.classList.toggle('cc-hp-hide-orig', Object.keys(bars).some((pos) => (cfg[pos] || []).some((m) => m.id === 'hp' && m.o && m.o.hideOrig)));   // a Hit points module asked for the game's own HP bar to go
    Object.keys(bars).forEach((pos) => {
      const b = bars[pos]; ensureModules(b);
      Object.keys(b.mods).forEach((k) => {
        const x = b.mods[k]; let r = null; try { r = x.def.render(ctx, x.m.o || {}); } catch (e) { r = null; swal('Info Bar module ' + (x.m.id || k), e); }
        x.el.style.display = r ? '' : 'none'; if (!r) return;
        x.full = r.t == null ? '' : r.t; x.short = r.short == null ? null : r.short; x.dropOrder = r.dropOrder || null; x.isBar = !!r.bar; x.blank = !!r.blank; x.items = !!r.items; x.baseW = r.blank ? r.w : (r.fw || 0);
        x.el.classList.toggle('sp', !!r.blank); x.el.classList.toggle('ln', !!r.blank && !!r.line); x.el.style.width = r.blank ? r.w + 'px' : (r.fw ? r.fw + 'px' : ''); x.el.classList.toggle('fw', !!r.fw);
        if (r.blank) { x.t.style.display = 'none'; x.icon.style.display = 'none'; x.pc.textContent = ''; delete x.pc.dataset.sig; x.f.style.display = 'none'; x.tip = setting('uiBarSpacerHover', true) !== false ? (r.tip || '') : ''; x.rich = null; x.richFn = null; x.el.removeAttribute('title'); return; }
        if (r.items) {
          x.t.style.display = 'none'; x.icon.style.display = 'none';
          syncItems(x, r, b);
        } else { x.t.style.display = ''; x.icon.style.display = ''; x.pc.textContent = ''; delete x.pc.dataset.sig; }
        x.baseTip = r.tip || ''; x.hasRich = !!(r.rich || r.richFn); x.tip = x.baseTip;   // (applyFs adds the whole text when the module is shortened)
        applyFs(x);   // the text itself (in the shortest form the fit chose), the width limits, the hover text and the hidden state
        x.rich = r.rich || null; x.richFn = r.richFn || null; x.el.removeAttribute('title');
        if (tipFor === x && tipEl && !x.key && (x.richFn || x.rich || x.tip) && !tip2 && !tipEl.matches(':hover')) { if (tipEl.dataset.sig !== tipSig(x)) showTip(x, b.el, true); }
        x.el.classList.toggle('hpbar', !!r.bar); if (!r.items && r.noicon) x.icon.style.display = 'none';   // (item modules keep their own icon state)
        x.el.classList.toggle('good', r.tone === 'good'); x.el.classList.toggle('warn', r.tone === 'warn'); x.el.classList.toggle('bad', r.tone === 'bad');
        if (r.frac != null) { x.f.style.display = ''; x.fi.style.width = Math.max(0, Math.min(100, r.frac * 100)) + '%'; } else x.f.style.display = 'none';
      });
    });
    fitAll(false);
  }
  // ---------------------------------------------------------------- fit: a bar never overlaps its own text
  // Whenever the bar width or its content changes, the bar is fitted from scratch by measuring the real modules. The steps, cheapest first, each applied to the
  // LONGEST module that can still take it, until the modules add up to the bar:
  //   space  empty-space spacers shrink (free room is always used first: the zones only pack the modules, nothing is stretched)
  //   drop   labels and secondary parts of a text go ("12.3k XP/hr" -> "12.3k", "Mining 12/50 · 5 min" -> "Mining 12/50"); panel buttons lose their text when they have an icon
  //   abbr   long numbers become short ones (1,234,567 -> 1.2M)
  //   tight  gaps and padding shrink to a minimum (the whole bar)
  //   ell    the flexible text modules get an ellipsis; the full text stays in the hover card
  //   hide   last resort: the lowest-priority modules move into a "…" menu (the bell, Hit points and the panel buttons never do)
  const FIT_PHASES = ['space', 'drop', 'abbr', 'tight', 'ell', 'hide'];
  const FIT_NOELL = new Set(['alerts', 'clock', 'hp', 'gold', 'xp', 'blood', 'inv']);                 // short and numeric: they are hidden last, never cut
  const FIT_NEVER = new Set(['alerts', 'hp', 'panelbtns', 'pbtn']);                                    // never moved into the "…" menu
  const FIT_HIDE_ORDER = ['clock', 'blood', 'online', 'world', 'offline', 'event', 'inv', 'gold', 'where', 'xp', 'advisor', 'windows', 'potions', 'task', 'chat'];   // first hidden first
  const FIT_MIN_W = 64, FIT_BMAX = [260, 120, 80, 56], FIT_ITEMS_MAX = 4;   // smallest width of a cut text module; label widths of a panel-button group per cut level 0..3, level 4 = labels gone
  const SEP = ' \u00B7 ';
  const abbrNums = (t) => t.replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d{4,}\b/g, (m) => {
    const n = Number(m.replace(/,/g, '')), r = (v, u) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + u;
    return n >= 1e9 ? r(n / 1e9, 'B') : n >= 1e6 ? r(n / 1e6, 'M') : r(n / 1e3, 'k');
  });
  // the steps a module can drop: one for a short form (labels gone), else its ' · ' parts (never all of them; the order may come from the module)
  function dropOrder(x) {
    const segs = String(x.full || '').split(SEP), idx = segs.map((_, i) => i), first = (x.dropOrder || []).filter((i) => i < segs.length);
    return first.concat(idx.filter((i) => !first.includes(i)).reverse()).slice(0, Math.max(0, segs.length - 1));
  }
  const dropSteps = (x) => (x.items || x.blank ? 0 : x.short != null ? 1 : dropOrder(x).length);   // (panel buttons lose their text step by step in the ellipsis phase instead)
  function fitText(x, f0) {
    const f = f0 || x.fs || {}; let base = x.full == null ? '' : String(x.full);
    if (f.drop && x.short != null) base = String(x.short);
    else if (f.drop) { const gone = new Set(dropOrder(x).slice(0, f.drop)); base = base.split(SEP).filter((_, i) => !gone.has(i)).join(SEP); }
    return f.abbr ? abbrNums(base) : base;
  }
  const fitCut = (x) => !!(x.fs && !x.items && !x.blank && (x.fs.drop || x.fs.abbr || x.fs.ell != null));
  function applyFs(x) {
    const f = x.fs || (x.fs = { drop: 0, abbr: false, ell: null, spw: 1, hid: false });
    x.el.classList.toggle('fit-hid', !!f.hid);
    if (x.blank) { x.el.style.width = Math.max(4, Math.round((x.baseW || 4) * (f.spw == null ? 1 : f.spw))) + 'px'; return; }
    if (x.items) {
      const lv = f.ell || 0; x.el.classList.toggle('nolab', lv >= FIT_ITEMS_MAX);
      if (lv) x.el.style.setProperty('--bmax', FIT_BMAX[Math.min(lv, FIT_BMAX.length - 1)] + 'px'); else x.el.style.removeProperty('--bmax');
      return;
    }
    if (x.t && x.t.style.display !== 'none') { const t = fitText(x); if (x.t.textContent !== t) x.t.textContent = t; }
    const cut = f.ell != null;
    x.el.classList.toggle('ell', cut);
    if (cut) { x.el.style.maxWidth = f.ell + 'px'; if (x.baseW) x.el.style.width = Math.min(x.baseW, f.ell) + 'px'; } else { x.el.style.maxWidth = ''; if (x.baseW) x.el.style.width = x.baseW + 'px'; }
    if (x.baseTip !== undefined) x.tip = !x.hasRich && fitCut(x) ? (x.full || '') + (x.baseTip ? SEP + x.baseTip : '') : x.baseTip;   // a shortened module keeps its whole text in the hover card
  }
  const fitFlexible = (x) => (x.items ? true : !FIT_NOELL.has(x.m.id) || (x.m.id === 'hp' && x.isBar));
  function fitMeasure(b) {   // widths of the modules in their zones plus the gaps; the only layout read of a step
    const gap = b.tight ? 1 : 2, pad = b.tight ? 6 : 12; let tot = 2 * gap + pad;
    ['zl', 'zc', 'zr'].forEach((z) => {
      let k = 0;
      Array.from(b[z].children).forEach((e) => { if (e.classList.contains('fit-hid') || e.style.display === 'none' || (!e.dataset.id && !e.classList.contains('ovf'))) return; tot += e.getBoundingClientRect().width; k++; });
      if (k > 1) tot += (k - 1) * gap;
    });
    Object.values(b.mods).forEach((x) => { x.w = x.el.classList.contains('fit-hid') || x.el.style.display === 'none' ? 0 : x.el.getBoundingClientRect().width; });
    return tot - b.el.clientWidth;
  }
  function ovfButton(b) {
    if (b.ovf) return b.ovf;
    const e = document.createElement('div'); e.className = 'm clk ovf fit-hid'; e.textContent = '\u2026'; e.setAttribute('role', 'button'); e.tabIndex = 0; e.setAttribute('aria-label', 'More: modules that did not fit');
    const open = () => {
      const UI = window.__ccUI; if (!UI || !UI.menu) return; const r = e.getBoundingClientRect();
      const list = Object.values(b.mods).filter((x) => x.fs && x.fs.hid && x.el.style.display !== 'none');
      closeMenu();
      menu = UI.menu([{ head: 'Hidden: the bar is too narrow' }].concat(list.map((x) => ({ label: (x.def.icon ? x.def.icon + '  ' : '') + x.def.label + (x.full ? SEP + x.full : ''), disabled: !x.def.click, onClick: x.def.click ? () => { try { x.def.click(x.m.o || {}); } catch (er) { /* ignore */ } } : undefined }))), r.left, b.pos === 'bottom' ? r.top : r.bottom, { up: b.pos === 'bottom', onClose: () => { menu = null; } });
    };
    e.addEventListener('click', (ev) => { ev.stopPropagation(); open(); });
    e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    b.zr.appendChild(e); b.ovf = e; return e;
  }
  function fitBar(b) {
    if (!b || !b.el.isConnected) return;
    const ms = Object.values(b.mods).filter((x) => x.el.style.display !== 'none' && x.full !== undefined);
    ms.forEach((x) => { x.fs = { drop: 0, abbr: false, ell: null, spw: 1, hid: false }; applyFs(x); });
    b.tight = false; b.el.classList.remove('tight'); if (b.ovf) b.ovf.classList.add('fit-hid');
    let over = fitMeasure(b), phase = -1, guard = 0, hideN = 0;
    const widest = (list) => list.slice().sort((a, c) => c.w - a.w)[0];
    const loop = (ph, pick, step) => { while (over > 0.5 && guard++ < 600) { const x = pick(); if (!x) break; phase = Math.max(phase, ph); step(x); applyFs(x); over = fitMeasure(b); } };
    // space
    ms.filter((x) => x.blank).sort((a, c) => c.w - a.w).forEach((x) => { if (over <= 0.5) return; phase = 0; const nw = Math.max(4, x.w - over); x.fs.spw = nw / (x.baseW || nw); applyFs(x); over = fitMeasure(b); });
    // drop labels / secondary parts
    loop(1, () => widest(ms.filter((x) => !x.blank && !x.fs.hid && x.fs.drop < dropSteps(x))), (x) => { x.fs.drop++; });
    // abbreviate numbers
    loop(2, () => widest(ms.filter((x) => !x.blank && !x.items && !x.fs.abbr && fitText(x, Object.assign({}, x.fs, { abbr: true })) !== fitText(x))), (x) => { x.fs.abbr = true; });
    // tight
    if (over > 0.5) { phase = 3; b.tight = true; b.el.classList.add('tight'); over = fitMeasure(b); }
    // ellipsis (water-filling: the longest is cut down towards the next longest first)
    loop(4, () => widest(ms.filter((x) => !x.blank && fitFlexible(x) && (x.items ? (x.fs.ell || 0) < FIT_ITEMS_MAX : (x.fs.ell == null ? x.w : x.fs.ell) > FIT_MIN_W + 0.5))), (x) => {
      if (x.items) { x.fs.ell = (x.fs.ell || 0) + 1; return; }
      const cur = x.fs.ell == null ? x.w : x.fs.ell, others = ms.filter((y) => y !== x && !y.blank && fitFlexible(y) && !y.items).map((y) => (y.fs.ell == null ? y.w : y.fs.ell)), next = Math.max.apply(null, [FIT_MIN_W].concat(others.filter((v) => v < cur)));
      x.fs.ell = Math.max(FIT_MIN_W, Math.round(cur - Math.max(8, Math.min(over, cur - next))));
    });
    // hide (last resort)
    if (over > 0.5) {
      const rank = (x) => (x.m.keep === 'first' ? -1 : FIT_HIDE_ORDER.indexOf(x.m.id) < 0 ? 99 : FIT_HIDE_ORDER.indexOf(x.m.id));
      const never = (x) => x.m.keep === 'never' || (FIT_NEVER.has(x.m.id) && x.m.keep !== 'first') || x.blank;
      const o = ovfButton(b); o.classList.remove('fit-hid'); over = fitMeasure(b);
      loop(5, () => ms.filter((x) => !x.fs.hid && !never(x)).sort((a, c) => rank(a) - rank(c))[0], (x) => { x.fs.hid = true; x.fs.hidAt = ++hideN; });
      if (!ms.some((x) => x.fs.hid)) { o.classList.add('fit-hid'); over = fitMeasure(b); }
    }
    b.fitPhase = phase; b.fitOver = over; b.fitN = (b.fitN || 0) + 1;
    b.fitKey = fitKeyOf(b);
  }
  function fitKeyOf(b) {
    return [b.el.clientWidth, heightPx(), b.sig, Object.values(b.mods).map((x) => (x.el.style.display === 'none' ? 'h' : [String(x.full || '').length, x.short == null ? '' : String(x.short).length, x.baseW || 0, x.isBar ? 1 : 0, x.items ? x.el.querySelectorAll('.pi').length : 0].join(':'))).join(',')].join('|');
  }
  const fitQuick = (b) => { try { return b.el.scrollWidth > b.el.clientWidth + 1; } catch (e) { return false; } };   // something still sticks out: fit again
  function fitAll(force) {
    if (document.hidden || window.__ccEcoOn) return;
    Object.keys(bars).forEach((pos) => { const b = bars[pos]; if (force || b.fitKey !== fitKeyOf(b) || fitQuick(b)) fitBar(b); });
  }
  let fitRaf = 0;
  const fitSoon = () => { if (fitRaf) return; fitRaf = requestAnimationFrame(() => { fitRaf = 0; try { fitAll(false); } catch (e) { swal('Info Bar fit', e); } }); };
  function fitInfo(pos) {   // what the fit did, for the tests and for support
    const b = bars[pos]; if (!b) return null;
    const over = fitMeasure(b);
    return { w: b.el.clientWidth, fits: b.fitN || 0, over: Math.round(over * 10) / 10, tight: !!b.tight, phase: b.fitPhase, phases: FIT_PHASES, hidden: Object.values(b.mods).filter((x) => x.fs && x.fs.hid).sort((a, c) => (a.fs.hidAt || 0) - (c.fs.hidAt || 0)).map((x) => x.m.id),
      overflow: !!(b.ovf && !b.ovf.classList.contains('fit-hid')),
      mods: Object.values(b.mods).filter((x) => x.el.style.display !== 'none').map((x) => {
        const r = x.el.getBoundingClientRect(), shown = !!(x.t && x.t.style.display !== 'none');
        return { id: x.m.id, s: x.m.s, left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, w: Math.round(r.width * 10) / 10, hid: !!(x.fs && x.fs.hid), drop: x.fs ? x.fs.drop : 0, abbr: !!(x.fs && x.fs.abbr), ell: x.fs ? x.fs.ell : null,
          cut: fitCut(x), items: !!x.items, rich: !!(x.rich || x.richFn), steps: dropSteps(x), canAbbr: !x.items && !x.blank && fitText(x, Object.assign({}, x.fs, { abbr: true })) !== fitText(x, Object.assign({}, x.fs, { abbr: false })), flex: fitFlexible(x), text: shown ? x.t.textContent : '', full: x.full, clipped: shown ? x.t.scrollWidth > x.t.clientWidth + 1 && !(x.fs && x.fs.ell != null) && getComputedStyle(x.t).textOverflow !== 'ellipsis' : false, tip: x.tip || '' };
      }) };
  }

  function layout() {
    const wantTop = !!setting('uiBarTop', true), wantBottom = !!setting('uiBarBottom', false), h = heightPx();
    [['top', wantTop], ['bottom', wantBottom]].forEach(([pos, want]) => {
      if (want && !bars[pos]) bars[pos] = makeBar(pos);
      if (!want && bars[pos]) { bars[pos].el.remove(); delete bars[pos]; }
      if (bars[pos]) { bars[pos].el.style.height = h + 'px'; bars[pos].el.style.setProperty('--cc-bar-h', h + 'px'); bars[pos].el.style.opacity = String((Number(setting('uiBarOpacity', '100')) || 100) / 100); }
    });
    applyEdge(bars.top ? h : 0, bars.bottom ? h : 0, !!setting('uiBarReserve', true));
  }

  // ---------------------------------------------------------------- drag to reorder / move
  let dragMoved = false;
  function startDrag(ev, b, m, e) {
    if (ev.button !== 0) return;
    const x0 = ev.clientX, y0 = ev.clientY; let on = false, ins = null;
    // which bar, side and place the pointer is over
    const slot = (px, py) => {
      const tb = Object.keys(bars).map((p) => bars[p]).find((bb) => { const r = bb.el.getBoundingClientRect(); return py >= r.top - 12 && py <= r.bottom + 12; }) || b;
      const eb = tb.el.getBoundingClientRect(), fx = (px - eb.left) / eb.width, side = fx > 0.62 ? 'r' : fx < 0.38 ? 'l' : 'c', zone = side === 'r' ? tb.zr : side === 'c' ? tb.zc : tb.zl;
      const kids = [...zone.querySelectorAll('.m')].filter((k) => k !== e && k.style.display !== 'none');
      let idx = kids.length; for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (px < r.left + r.width / 2) { idx = i; break; } }
      return { tb, side, idx, kids, eb };
    };
    const move = (mv) => {
      if (!on) { if (Math.abs(mv.clientX - x0) < 5 && Math.abs(mv.clientY - y0) < 5) return; on = true; dragMoved = true; e.classList.add('drag'); ins = document.createElement('div'); ins.className = 'ins'; }
      const s2 = slot(mv.clientX, mv.clientY), { tb, side, idx, kids, eb } = s2;
      const ref = kids[idx] || kids[kids.length - 1], zr = tb.zr.getBoundingClientRect();
      ins.style.left = (ref ? (idx < kids.length ? ref.getBoundingClientRect().left : ref.getBoundingClientRect().right) : (side === 'r' ? zr.right - 4 : side === 'c' ? eb.left + eb.width / 2 : eb.left + 8)) - eb.left + 'px'; tb.el.appendChild(ins);
    };
    const up = (mu) => {
      document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseup', up, true);
      e.classList.remove('drag'); if (ins) ins.remove();
      if (on) {
        const { tb, side, idx, kids } = slot(mu.clientX, mu.clientY);
        const beforeM = kids[idx] ? cfg[tb.pos][Number(kids[idx].dataset.i)] : null;
        const from = cfg[b.pos].indexOf(m); if (from >= 0) cfg[b.pos].splice(from, 1);
        let at = cfg[tb.pos].length;
        if (beforeM) { const ti = cfg[tb.pos].indexOf(beforeM); if (ti >= 0) at = ti; }
        m.s = side; cfg[tb.pos].splice(at, 0, m); save(); Object.values(bars).forEach((bb) => { bb.sig = ''; }); refresh();
      }
      setTimeout(() => { dragMoved = false; }, 30);
    };
    document.addEventListener('mousemove', move, true); document.addEventListener('mouseup', up, true);
  }

  // ---------------------------------------------------------------- right-click menu
  let menu = null;
  function closeMenu() { if (menu) { try { window.__ccUI.closeMenu(); } catch (e) { /* kit gone */ } menu = null; } }
  function item(label, fn, o) { return Object.assign({ label, fn }, o || {}); }
  // where a module added from the menu goes: in the zone under the right-click, before the module the pointer is left of
  function placeAt(pos, x) {
    const b = bars[pos]; if (!b) return { s: 'l', at: cfg[pos].length };
    const eb = b.el.getBoundingClientRect(), fx = (x - eb.left) / eb.width, s = fx > 0.62 ? 'r' : fx < 0.38 ? 'l' : 'c', zone = s === 'r' ? b.zr : s === 'c' ? b.zc : b.zl;
    const kids = [...zone.querySelectorAll('.m')];
    for (const k of kids) { const r = k.getBoundingClientRect(); if (x < r.left + r.width / 2) { const m = cfg[pos][Number(k.dataset.i)]; const at = cfg[pos].indexOf(m); if (at >= 0) return { s, at }; } }
    const last = kids[kids.length - 1], lm = last ? cfg[pos][Number(last.dataset.i)] : null;
    return { s, at: lm ? cfg[pos].indexOf(lm) + 1 : cfg[pos].length };
  }
  const findMods = (pos, id) => (bars[pos] ? [...bars[pos].el.querySelectorAll('.m[data-id="' + id + '"]')] : []);
  let lastMenuXY = { x: 200, y: 60 };
  // Right-click a player in one of our lists (Friends card, chat names): the game builds its player menu (message, mute, add / remove friend, invite ...) only inside the
  // contextmenu handler of ITS OWN row for that player, so the same right-click is handed to that original row (the game's panels are hidden by CSS but still in the DOM).
  // For Clan and Muted the game's Friends panel is flipped to that tab for a moment (and flipped back): it only draws the tab that is showing. Nothing is chosen for you;
  // the menu is the game's, so every entry and rule is the game's. Sent a moment after your click so the game's click-outside rule does not close it at once.
  function openPlayerMenu(name, kind, x, y) {
    name = String(name || '').trim(); const fp = document.getElementById('friends-panel'); if (!name || !fp) return false;
    const btn = (k) => Array.from(fp.querySelectorAll('.qp-toggle-btn')).find((b) => b.textContent.trim().toLowerCase() === k);
    const cur = () => { const a = fp.querySelector('.qp-toggle-btn.active:not(.friends-add-btn)'); return a ? a.textContent.trim().toLowerCase() : ''; };
    const find = () => Array.from(fp.querySelectorAll('.friend-row')).find((r) => { const n = r.querySelector('.friend-row-name'); return n && n.textContent.trim() === name; });
    const prev = cur(), flip = !!(kind && kind !== prev && btn(kind));
    if (!flip && !find()) return false;
    if (flip) btn(kind).click();
    setTimeout(() => {
      try { const row = find(); if (row) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); } catch (e) { /* the panel is gone */ }
      if (flip) setTimeout(() => { try { const b = btn(prev); if (b && cur() !== prev) b.click(); } catch (e) { /* panel gone */ } }, 150);
    }, 90);
    return true;
  }
  function openGamePotionMenu() {
    const row = document.querySelector('.active-potions-body .potion-row') || document.querySelector('.active-potions-body') || document.querySelector('.active-potions-panel'); if (!row) return false;
    // a moment later, so the click that chose this item is over before the game's menu starts listening for clicks outside itself
    setTimeout(() => { try { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lastMenuXY.x, clientY: lastMenuXY.y, button: 2 })); } catch (e) { /* the panel is gone */ } }, 80);
    return true;
  }
  // Show or hide the GAME's own panel next to ScapeLite's version, to compare the two or look at something that seems wrong. It is the same step a click on the button takes when ScapeLite's
  // card is not wanted: the game's panel is un-hidden (or hidden again) and its tab opened.
  function toggleOriginal(tab) { const b = tabBtns().find((x) => x.dataset.tab === tab); revealed[tab] = !gamePanelShown(tab); revealedAt[tab] = performance.now(); applyHides(); if (revealed[tab] && b && !b.classList.contains('active')) b.click(); else if (!revealed[tab] && b && b.classList.contains('active')) b.click(); refresh(); }
  function showMenu(x, y, pos, modId, side, mIdx, tabKey) {
    lastMenuXY = { x, y };
    closeMenu();
    const other = pos === 'top' ? 'bottom' : 'top';
    const items = [];
    if (tabKey) { items.push({ h: pretty(tabKey) }); const shownNow = gamePanelShown(tabKey); if (!shownNow) delete revealed[tabKey]; else revealed[tabKey] = true; items.push(item(shownNow ? 'Hide the game’s original ' + pretty(tabKey) + ' panel' : 'Open the game’s original ' + pretty(tabKey) + ' panel (next to ScapeLite’s)', () => toggleOriginal(tabKey), { check: shownNow })); items.push({ sep: 1 }); }
    const mod = modId ? (mIdx >= 0 && cfg[pos][mIdx] && cfg[pos][mIdx].id === modId ? cfg[pos][mIdx] : cfg[pos].find((m) => m.id === modId && m.s === side)) : null;
    if (mod) {
      const def = MODULES[modId];
      items.push({ h: def.label });
      (def.opts || []).forEach((o) => {
        if (o.when && !o.when(mod.o || {})) return;   // an option with no effect in this configuration is not offered ("Click opens the card" only matters while the game's panel stays visible)
        const cur = (mod.o && mod.o[o.k] !== undefined) ? mod.o[o.k] : o.def;
        if (o.slider) items.push({ label: o.label, slider: Object.assign({}, o.slider, { val: Number.isFinite(Number(cur)) ? Number(cur) : o.def }), onInput: (v) => { mod.o = Object.assign({}, mod.o, { [o.k]: v }); save(); refresh(); } });
        else if (o.choices) items.push({ label: o.label, children: o.choices.map(([v, lab]) => item(lab, () => { mod.o = Object.assign({}, mod.o, { [o.k]: v }); save(); }, { check: cur === v })) });
        else items.push(item(o.label, () => { mod.o = Object.assign({}, mod.o, { [o.k]: !cur }); save(); }, { check: !!cur }));
      });
      (def.actions || []).forEach((a) => items.push(item(a.label, () => a.fn(mod, pos))));
      if (modId === 'alerts') items.push(item('Hide the bell button', () => put('alertBellHidden', !setting('alertBellHidden', false)), { check: !!setting('alertBellHidden', false) }));
      if (modId === 'pbtn' || modId === 'panelbtns' || modId === 'windows') items.push(item('Hide the menu bar completely', () => put('menuBarHidden', !setting('menuBarHidden', false)), { check: !!setting('menuBarHidden', false) }));
      if (modId === 'pbtn' || modId === 'panelbtns') items.push(item('ScapeLite vertical menu (bottom right)', () => put('verticalMenuEnabled', !(setting('verticalMenuEnabled', true) !== false)), { check: setting('verticalMenuEnabled', true) !== false }));   // the game's own menu comes back when it is off
      if ((def.opts || []).length || (def.actions || []).length) items.push({ sep: 1 });
      items.push({ label: 'Move to', children: [['l', 'The left'], ['c', 'The middle'], ['r', 'The right']].map(([k, t]) => item(t, () => { mod.s = k; save(); }, { check: side === k })) });
      items.push(item('Move to the ' + other + ' bar', () => { cfg[pos].splice(cfg[pos].indexOf(mod), 1); mod.s = side; cfg[other].push(mod); if (!setting(other === 'top' ? 'uiBarTop' : 'uiBarBottom', false)) put(other === 'top' ? 'uiBarTop' : 'uiBarBottom', true); save(); }));
      if (modId !== 'space') items.push({ label: 'When the bar is too narrow', children: [[undefined, 'Shorten it as needed, hide it when nothing else helps'], ['first', 'Hide it first'], ['never', 'Never hide it']].map(([k, t]) => item(t, () => { if (k) mod.keep = k; else delete mod.keep; save(); }, { check: (mod.keep || undefined) === k })) });
      items.push(item('Remove', () => { cfg[pos].splice(cfg[pos].indexOf(mod), 1); save(); }));
      items.push({ sep: 1 });
    }
    items.push({ h: 'Bar' });
    const here = placeAt(pos, x), addItems = [];
    Object.keys(MODULES).forEach((id) => {
      const def = MODULES[id];
      if (def.variants) {
        def.variants.forEach(([v, lab]) => {
          const mine = () => findMods(pos, id).filter((e) => { const m = cfg[pos][Number(e.dataset.i)]; return m && m.o && m.o.tab === v; });
          addItems.push(item(def.icon + '  Button: ' + lab, () => { cfg[pos].splice(here.at, 0, { id, s: here.s, o: { tab: v } }); save(); }, { check: mine().length > 0, find: mine }));
        });
        return;
      }
      const n = cfg[pos].filter((m) => m.id === id).length;
      addItems.push(item(def.icon + '  ' + def.label, () => { cfg[pos].splice(here.at, 0, { id, s: here.s }); save(); }, { check: n > 0, count: n > 1 ? n : 0, find: () => findMods(pos, id), dis: n > 0 && !def.many }));
    });
    items.push({ label: 'Add a module', children: addItems });
    items.push({ label: 'Height', children: [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']].map(([k, t]) => item(t, () => put('uiBarHeight', k), { check: String(setting('uiBarHeight', 'normal')) === k })) });
    items.push({ label: 'Opacity', children: [['100', '100%'], ['90', '90%'], ['75', '75%'], ['60', '60%']].map(([k, t]) => item(t, () => put('uiBarOpacity', k), { check: String(setting('uiBarOpacity', '100')) === k })) });
    items.push(item('Show a hint when hovering empty space', () => put('uiBarSpacerHover', !(setting('uiBarSpacerHover', true) !== false)), { check: setting('uiBarSpacerHover', true) !== false }));
    items.push(item('Game uses the space left', () => put('uiBarReserve', !setting('uiBarReserve', true)), { check: !!setting('uiBarReserve', true) }));
    items.push({ sep: 1 });
    items.push(item(setting(other === 'top' ? 'uiBarTop' : 'uiBarBottom', false) ? 'Hide the ' + other + ' bar' : 'Show a ' + other + ' bar', () => { const k = other === 'top' ? 'uiBarTop' : 'uiBarBottom'; put(k, !setting(k, false)); }));
    items.push(item('Hide this bar', () => put(pos === 'top' ? 'uiBarTop' : 'uiBarBottom', false)));
    items.push(item('Reset the bars', () => { cfg = JSON.parse(JSON.stringify(DEFAULT)); save(); }));
    // the bar menu is the kit's one menu component; this maps the bar's own item shape onto it
    const conv = (list) => list.map((it) => (it.sep ? { sep: true } : it.h ? { head: it.h }
      : it.slider ? { slider: { label: it.label, min: it.slider.min, max: it.slider.max, step: it.slider.step, value: it.slider.val, fmt: (v) => v + ' px', onInput: it.onInput } }
      : { label: it.label, checked: it.check ? true : undefined, badge: it.count ? '×' + it.count : undefined, disabled: it.dis, sub: it.children ? conv(it.children) : undefined,
          onClick: it.fn ? () => { try { it.fn(); } catch (er) { /* ignore */ } sig(); } : undefined,
          onHover: it.find ? (on) => it.find().forEach((e2) => e2.classList.toggle('find', on)) : undefined }));
    const UI = window.__ccUI; if (!UI || !UI.menu) return;
    menu = UI.menu(conv(items), x, y, { up: pos === 'bottom', onClose: () => { menu = null; document.querySelectorAll('.cc-bar .m.find').forEach((e2) => e2.classList.remove('find')); } });
  }
  const sig = () => { Object.values(bars).forEach((b) => { b.sig = ''; }); layout(); refresh(); };

  // ---------------------------------------------------------------- run
  layout(); refresh(); cardApi.restore();
  const t1 = setInterval(() => { try { layout(); refresh(); } catch (e) { swal('Info Bar refresh', e); } }, 1000);
  const onResize = () => { try { layout(); } catch (e) { /* ignore */ } };
  function teardown() {
    window.removeEventListener('keydown', onHotkey, true); document.body.classList.remove('cc-hp-hide-orig', 'cc-sp-nohover'); clearInterval(t1); cardApi.destroy(); closeMenu(); hideTip(); document.removeEventListener('mousemove', onMouseX, true); hideStyle.remove(); 
    Object.values(bars).forEach((b) => { try { b.ro && b.ro.disconnect(); } catch (e) { /* gone */ } b.el.remove(); });
    if (fitRaf) cancelAnimationFrame(fitRaf);
    const g = gameBox(); if (g) { g.style.transform = ''; g.style.transformOrigin = ''; }
    edge.top = 0; edge.bottom = 0; edge.reserved = 0; delete window.__ccEdge; delete window.__ccVH; delete window.__ccGameScale;
    style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc bar torn down';
  }
  const hasButton = (tab) => !!buttonEl(tab) || ['top', 'bottom'].some((pos) => (bars[pos] ? cfg[pos] : []).some((m) => (m.id === 'pbtn' && m.o && m.o.tab === tab) || (m.id === 'panelbtns' && panelChoice(m.o || {}, tab) !== 'off')));
  const buttonEl = (tab) => { for (const pos of ['bottom', 'top']) { const b = bars[pos]; if (!b) continue; const e = b.el.querySelector('.pi[data-key="' + tab + '"]'); if (e && e.getClientRects().length) return { el: e, pos }; } return null; };
  // Replace the whole bar layout (used by the looks in presets.js). Only known modules are kept; a bad layout changes nothing.
  function applyConfig(next) {
    if (!next || !Array.isArray(next.top) || !Array.isArray(next.bottom)) return false;
    const clean = (arr) => arr.filter((m) => m && MODULES[m.id] && /^[lcr]$/.test(m.s || 'l')).map((m) => JSON.parse(JSON.stringify(m)));
    cfg = { v: 1, top: clean(next.top), bottom: clean(next.bottom) };
    save(); Object.values(bars).forEach((bb) => { bb.sig = ''; }); applyHides(); layout(); refresh();
    return true;
  }
  window[NS] = { version: 1, teardown, fit: (pos) => { if (pos) fitBar(bars[pos]); else fitAll(true); }, fitInfo, edge: () => ({ top: edge.top || 0, bottom: edge.bottom || 0 }), MODULES, hasButton, buttonEl, tasksAnchor, toggleQueue, highlight, cards: cardApi, get config() { return JSON.parse(JSON.stringify(cfg)); }, applyConfig, refresh, playerMenu: openPlayerMenu, get isOpen() { return !!(setting('uiBarTop', true) || setting('uiBarBottom', false)); }, toggle() { put('uiBarTop', !setting('uiBarTop', true)); layout(); } };
  return 'cc bar loaded';
})();
