// ScapeLite Alerts: an always-visible bell with a red number for things that need your attention.
// Display only. It reads the game, shows a list when you hover the bell, and "Show me" only points things out (a pulsing outline on the
// game's own button, or ScapeLite's own panel opens): it never clicks, claims, equips or crafts anything for you.
// Each kind of alert can be switched off, and how often the game is checked is a setting (Settings > Plugins > Alerts).
(function () {
  'use strict';
  const NS = '__ccAlerts';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* old copy gone */ }
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const on = () => !!setting('alertsEnabled', true);
  const bridge = () => { const b = window.__ccBridge; return b && typeof b.live === 'function' ? b : null; };
  const LS_DIS = 'cc-alerts-dismissed';

  // ---------------------------------------------------------------- the kinds of alert
  // Each check returns a list of { key, text, sub?, sig?, tab?, open? }.
  //   key  : stable id of this alert; sig : changes when the situation changes (a dismissed alert comes back when it does)
  //   tab  : data-tab of the game's side-menu button to point out; open: name of a ScapeLite panel namespace to open
  // `id` is the setting suffix: alert<Id> switches the kind on and off.
  const CHECKS = [];
  const addCheck = (def) => CHECKS.push(def);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  let idleSince = 0, fullPolls = 0, prevPots = null;

  // Events (Halloween and every later one: the game has one generic holiday system). A new event, a changed state of your own part, and the days left.
  addCheck({ id: 'Event', icon: '\uD83C\uDF89', label: 'Game events', check: () => {
    const ev = window.__ccUI && window.__ccUI.eventInfo && window.__ccUI.eventInfo(); if (!ev) return [];
    const out = [], left = ev.days == null ? '' : ev.days === 1 ? ' \u00B7 last day' : ' \u00B7 ' + ev.days + ' days left';
    out.push({ key: 'event-live:' + ev.id, text: ev.name + ' is on: +' + ev.boostPct.toFixed(1) + '% XP for everyone', sub: (ev.totalText || ev.total + ' found') + left, sig: ev.id });
    if (ev.state === 'new') out.push({ key: 'event-todo:' + ev.id, text: ev.name + ': you have not started it', sub: 'Talk to the event NPC in the game to take part (the XP boost may depend on it).', sig: 'new' });
    else if (ev.state === 'ready') out.push({ key: 'event-todo:' + ev.id, text: ev.name + ': everything found, go back and claim', sub: ev.found + ' of ' + ev.need + ' found.', sig: 'ready' });
    return out;
  } });
  addCheck({ id: 'Tree', icon: '🌳', label: 'Unspent tree points', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    const out = [];
    if (s.tree.delve > 0) out.push({ key: 'tree-delve', text: plural(s.tree.delve, 'unspent Delve tree point', 'unspent Delve tree points'), sub: 'Delve level ' + s.tree.delveLevel + ': every level gives one point.', sig: s.tree.delve, tab: 'delvetree', dest: 'Delve tree', open: '__ccTreeAdvisor', hint: 'Delve tree: Raids and trees group in the side menu' });
    if (s.tree.fortify > 0) out.push({ key: 'tree-fortify', text: plural(s.tree.fortify, 'unspent Fortress tree point', 'unspent Fortress tree points'), sub: 'Fortify level ' + s.tree.fortifyLevel + ': every level gives one point.', sig: s.tree.fortify, tab: 'fortifytree', dest: 'Fortress tree', open: '__ccTreeAdvisor', hint: 'Fortress tree: Raids and trees group in the side menu' });
    return out;
  } });
  addCheck({ id: 'Lever', icon: '🎚️', label: 'Unspent lever credits', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s || !s.levers) return [];
    const out = [], min = Math.max(1, Number(setting('alertLeverMin', 25)) || 25);
    if (s.levers.total >= min) out.push({ key: 'lever-total', text: s.levers.total + ' unspent skill lever credits', sub: 'Open the Skills Customization page: the Lever Advisor shows what to change.', sig: Math.floor(s.levers.total / min), tab: 'skillcustom', dest: 'Skill levers' });
    if (s.levers.slay >= Math.max(5, Math.floor(min / 5))) out.push({ key: 'lever-slay', text: s.levers.slay + ' unspent slay lever credits', sub: 'Slay mob weights can use them.', sig: s.levers.slay, tab: 'skillcustom', dest: 'Slay levers' });
    return out;
  } });
  addCheck({ id: 'Chest', icon: '🎁', label: 'Unopened chests and lamps', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    const out = [];
    if (s.chests > 0) out.push({ key: 'chests', text: plural(s.chests, 'unopened treasure chest', 'unopened treasure chests'), sub: 'In your bank or inventory.', sig: s.chests, tab: 'bank', dest: 'Bank', find: { tab: 'bank', itemId: s.chestId }, tag: 'Open it here' });
    if (s.lamps > 0) out.push({ key: 'lamps', text: plural(s.lamps, 'unused lamp', 'unused lamps'), sub: 'In your bank or inventory.', sig: s.lamps, tab: 'bank', dest: 'Bank', find: { tab: 'bank', itemId: s.lampId }, tag: 'Use it here' });
    return out;
  } });
  addCheck({ id: 'Quest', icon: '/assets/icons/ui/quest.png', label: 'Quests ready to hand in', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    return s.questsReady.map((n) => ({ key: 'quest-' + n, text: 'Quest finished: ' + n, sub: 'All steps are done. Open the quest and press Complete to claim the reward.', tab: 'quests', dest: 'Quests', find: { tab: 'quests', text: n }, tag: 'Complete it here' }));
  } });
  // Free quest slots and unspent barter charges. Both are quiet: off by default, shown only after two checks in a row (no flicker), and once dismissed an alert stays
  // away until its situation changes (another number of free slots / quests, or a new barter roll). Display only: "Show me" opens the game's panel, nothing is begun or bought.
  let slotPolls = 0, barterPolls = 0;
  addCheck({ id: 'QuestSlot', icon: '/assets/icons/ui/quest.png', label: 'Free quest slots', def: false, check: (b) => {
    const s = b.alertState && b.alertState(), q = s && s.questSlots;
    slotPolls = q && q.free > 0 && q.availableN > 0 ? slotPolls + 1 : 0;
    if (slotPolls < 2) return [];
    return [{ key: 'quest-slots', text: plural(q.free, 'free quest slot', 'free quest slots') + ' and ' + plural(q.availableN, 'quest you can begin', 'quests you can begin'), sub: (q.firstAvailable ? 'For example ' + (q.firstAvailable) + '. ' : '') + 'You hold ' + q.used + ' of ' + q.max + ' active quests.', sig: q.free + ':' + q.availableN, tab: 'quests', dest: 'Quests' }];
  } });
  addCheck({ id: 'Barter', icon: '/assets/icons/skills/barter.png', label: 'Unspent barter charges', def: false, check: (b) => {
    const s = b.alertState && b.alertState(), t = s && s.barter;
    barterPolls = t && t.left > 0 ? barterPolls + 1 : 0;
    if (barterPolls < 2) return [];
    return [{ key: 'barter-charges', text: plural(t.left, 'barter charge', 'barter charges') + ' left on this roll', sub: 'Buying and selling spend them; spending the last one pays barter XP.' + (t.rerolls > 0 ? ' ' + plural(t.rerolls, 'reroll credit', 'reroll credits') + ' held.' : ''), sig: t.slots, tab: 'barter', dest: 'Barter' }];
  } });
  // the slots of the better-equipment alert, each with its own switch (Settings > Alerts, or right-click the bell > Filter alerts)
  const GEAR_SLOTS = [['head', 'Helmet'], ['cape', 'Cape'], ['neck', 'Amulet'], ['ammo', 'Ammo'], ['mainhand', 'Weapon'], ['body', 'Body armour'], ['offhand', 'Offhand'], ['hands', 'Gloves'], ['belt', 'Belt'], ['legs', 'Legs'], ['ring1', 'First ring'], ['ring2', 'Second ring']];
  const gearKey = (slot) => 'alertGear' + slot.charAt(0).toUpperCase() + slot.slice(1);
  const gearOn = (slot) => !!setting(gearKey(slot), true);
  addCheck({ id: 'Gear', icon: '⚔️', label: 'Gear upgrades in your bank', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s || !s.gear) return [];
    return s.gear.upgrades.filter((u) => gearOn(u.slot)).slice(0, 4).map((u) => ({ key: 'gear-' + u.slot + '-' + u.better, text: 'Better ' + u.slot + ' in your bank: ' + u.better, sub: (u.have ? 'You wear ' + u.have + '. ' : 'The slot is empty. ') + 'Better for your ' + String(s.gear.loadout).replace(/_/g, ' ') + ' loadout (check its stats first).', tab: 'bank', dest: 'Bank', find: { tab: 'bank', itemId: u.betterId }, tag: 'Equip it from here' }));
  } });
  addCheck({ id: 'Craft', icon: '🔨', label: 'New collection entries you can craft', check: (b) => {
    const d = b.craft && b.craft(); if (!d || !d.logged || !d.equip) return [];
    const need = (t) => (t == null || t <= 0 ? 1 : Math.min(99, t * 10)), held = d.held || {}, names = [];
    const skills = new Set(); let first = null;
    Object.keys(d.equip).forEach((id) => { const r = d.equip[id]; if (!r || !(r.xpPerCraft > 0) || Object.keys(r).some((k) => /^requires/.test(k)) || d.logged[id] !== false) return; if (need(d.tiers[id]) > ((d.levels && d.levels[r.skill]) || 0)) return; if ((r.materials || []).every((m) => (held[m.itemId] || 0) >= m.qty)) { const nm = (d.names && d.names[id]) || id; names.push(nm); skills.add(r.skill); if (!first) first = { skill: r.skill, name: nm }; } });
    (d.finishing || []).forEach((r) => { if (d.logged[r.resultId] !== false || need(r.tier) > ((d.levels && d.levels.brew) || 0)) return; if ((held[r.unfPotionId] || 0) >= 1 && (held[r.rawId] || 0) >= 1 && (!r.procId || (held[r.procId] || 0) >= 1)) { const nm = (d.names && d.names[r.resultId]) || r.resultId; names.push(nm); skills.add('brew'); if (!first) first = { skill: 'brew', name: nm }; } });
    if (!names.length) return [];
    return [{ key: 'craft-new', text: plural(names.length, 'craftable item', 'craftable items') + ' not in your collection yet', sub: names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') + '. One craft of each logs it.', sig: names.join('|'), tabs: first ? [first.skill] : [...skills], dest: first ? ({ smith: 'Smithing', craft: 'Crafting', imbue: 'Imbuing', brew: 'Brewing' }[first.skill] || 'Crafting') : 'Crafting', find: first ? { tab: first.skill, name: first.name } : null, tag: 'Craft it here' }];
  } });
  addCheck({ id: 'Pets', event: true, icon: '\uD83D\uDC3E', label: 'Pets and lucky tools', check: (b) => {
    const d = b.dropState && b.dropState(); if (!d) return [];
    const out = [], first = !snap.pets;
    const pets = {}, lucky = {};
    (d.pets || []).forEach((p) => { pets[p.skill] = [p.normal || 0, p.shiny || 0]; });
    (d.lucky || []).forEach((l) => { lucky[l.skill] = [l.owned ? 1 : 0, l.shinyOwned ? 1 : 0]; });
    if (!first) {
      (d.pets || []).forEach((p) => { const o = snap.pets[p.skill] || [0, 0]; if ((p.shiny || 0) > o[1]) out.push({ key: 'pet-s-' + p.skill + '-' + p.shiny, text: 'SHINY ' + p.name + ' pet!', sub: 'A shiny pet dropped.', open: '__ccDropLuck', dest: 'Drop Luck' }); else if ((p.normal || 0) > o[0]) out.push({ key: 'pet-' + p.skill + '-' + p.normal, text: 'New ' + p.name + ' pet!', sub: 'A pet dropped.', open: '__ccDropLuck', dest: 'Drop Luck' }); });
      (d.lucky || []).forEach((l) => { const o = snap.lucky[l.skill] || [0, 0]; if (l.shinyOwned && !o[1]) out.push({ key: 'lucky-s-' + l.skill, text: 'SHINY ' + l.name + '!', sub: 'A shiny lucky tool dropped.', open: '__ccDropLuck', dest: 'Drop Luck' }); else if (l.owned && !o[0]) out.push({ key: 'lucky-' + l.skill, text: l.name + '!', sub: 'A lucky tool dropped.', open: '__ccDropLuck', dest: 'Drop Luck' }); });
    }
    snap.pets = pets; snap.lucky = lucky;
    return out;
  } });
  addCheck({ id: 'Rare', event: true, icon: '\uD83D\uDC8E', label: 'Very rare drops', check: (b) => {
    const d = b.dropState && b.dropState(); if (!d) return [];
    const min = Math.max(2, Number(setting('alertRareMin', 500)) || 500), out = [], first = !snap.drops, drops = {};
    (d.mobs || []).forEach((m) => (m.drops || []).forEach((x) => {
      if (!(x.n >= min)) return; const k = m.id + '|' + x.id; drops[k] = x.got || 0;
      if (!first && (x.got || 0) > (snap.drops[k] || 0)) out.push({ key: 'rare-' + k + '-' + x.got, text: 'Rare drop: ' + x.name, sub: '1 in ' + x.n.toLocaleString('en-US') + ' from ' + m.name, open: '__ccDropLuck', dest: 'Drop Luck' });
    }));
    snap.drops = drops;
    return out;
  } });
  // "Thanks for playing": a free reward every 12 hours. The game puts the class thanks-eligible on its top-right button while it can be claimed. The claim stays in the game.
  addCheck({ id: 'Thanks', icon: '\uD83D\uDC4D', label: 'Thanks for playing reward', check: () => {
    const b = document.querySelector('.window-control-btn-thanks.thanks-eligible'); if (!b) return [];
    return [{ key: 'thanks', text: 'Free \u201CThanks for playing\u201D reward is ready', sub: 'A free reward every 12 hours: use the thumbs-up button at the top right of the game.', find: { selector: '.window-control-btn-thanks' }, tag: 'Claim here', hint: 'Top right: the thumbs-up button (it may be tucked away by the Window Buttons Dock)', dest: 'Point at it' }];
  } });
  addCheck({ id: 'Idle', icon: '💤', label: 'Nothing is running', check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    if (!s.idle) idleSince = 0; else if (!idleSince) idleSince = Date.now();
    return idleSince && Date.now() - idleSince >= 120000 ? [{ key: 'idle', text: 'No task is running', sub: 'Your queue has nothing active. Open the Tasks panel to pick something.', tab: 'tasks', dest: 'Tasks' }] : [];
  } });
  addCheck({ id: 'Inventory', icon: '🎒', label: 'Inventory full', def: false, check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    fullPolls = s.invFull ? fullPolls + 1 : 0;
    return fullPolls >= 2 ? [{ key: 'inv-full', text: 'Your inventory is full', sub: 'New items may not fit.', tab: 'inventory', dest: 'Inventory' }] : [];
  } });
  addCheck({ id: 'Potions', icon: '🧪', label: 'A potion ran out', def: false, check: (b) => {
    const s = b.alertState && b.alertState(); if (!s) return [];
    const out = [];
    if (prevPots) Object.keys(prevPots).forEach((t) => { if (prevPots[t] > 0 && !(s.potions[t] > 0)) out.push({ key: 'pot-' + t + '-' + Date.now(), text: 'A ' + t + ' potion has run out', sub: 'Its effect has ended.', tab: 'inventory', dest: 'Inventory' }); });
    prevPots = s.potions;
    return out;
  } });

  // ---------------------------------------------------------------- state
  let alerts = [];            // current, not dismissed
  let dismissed = {};         // key -> sig
  try { dismissed = JSON.parse(localStorage.getItem(LS_DIS) || '{}') || {}; } catch (e) { dismissed = {}; }
  const saveDis = () => { try { localStorage.setItem(LS_DIS, JSON.stringify(dismissed)); } catch (e) { /* storage blocked */ } };
  // Things that HAPPENED (a pet, a lucky tool, a very rare drop) stay in the list until dismissed, so you still see them after being away.
  const LS_EVT = 'cc-alerts-events', LS_SNAP = 'cc-alerts-snap';
  let events = [], snap = {};
  try { events = JSON.parse(localStorage.getItem(LS_EVT) || '[]') || []; } catch (e) { events = []; }
  try { snap = JSON.parse(localStorage.getItem(LS_SNAP) || '{}') || {}; } catch (e) { snap = {}; }
  const saveEvents = () => { try { localStorage.setItem(LS_EVT, JSON.stringify(events.slice(0, 40))); localStorage.setItem(LS_SNAP, JSON.stringify(snap)); } catch (e) { /* storage blocked */ } };
  let polling = 0, lastRun = 0; const goneAt = {};

  function run() {
    lastRun = Date.now();
    const b = bridge();
    const found = [];
    if (on() && b) {
      CHECKS.forEach((c) => {
        if (!setting('alert' + c.id, c.def !== false)) return;
        let r = []; try { r = c.check(b) || []; } catch (e) { r = []; }
        if (c.event) { r.forEach((a) => { if (!events.some((x) => x.key === a.key)) { const ev = Object.assign({ kind: c.id, icon: c.icon, label: c.label, at: Date.now() }, a); events.unshift(ev); try { const l = window.__ccLog && window.__ccLog.channel('Alerts'); if (l) l.info('Alert: ' + c.label + (a.text ? ' - ' + a.text : ''), { kind: c.id, key: a.key }); } catch (e) { /* never */ } } }); return; }
        r.forEach((a) => found.push(Object.assign({ kind: c.id, icon: c.icon, label: c.label }, a)));
      });
      events = events.slice(0, 40); saveEvents();
      events.forEach((e) => { if (setting('alert' + e.kind, true)) found.push(e); });
    }
    // forget dismissals whose alert is gone, so the same alert shows again next time it comes up. Only while the game data is really there (after a restart
    // the bridge attaches late and nothing is found yet: that must not wipe the dismissals), and only once the alert has been gone for a while.
    const live = new Set(found.map((a) => a.key));
    if (on() && b) {
      Object.keys(dismissed).forEach((k) => { if (live.has(k)) { delete goneAt[k]; return; } if (!goneAt[k]) goneAt[k] = Date.now(); else if (Date.now() - goneAt[k] > 120000) { delete dismissed[k]; delete goneAt[k]; } });
    }
    alerts = found.filter((a) => dismissed[a.key] === undefined || dismissed[a.key] !== (a.sig == null ? '' : String(a.sig)));
    saveDis(); render();
  }
  function schedule() {
    clearTimeout(polling);
    const sec = Math.max(3, Math.min(600, Number(setting('alertPollSec', 15)) || 15));
    polling = setTimeout(() => { try { if (!document.hidden || Date.now() - lastRun > 60000) run(); } catch (e) { /* keep polling */ } schedule(); }, sec * 1000);
  }

  // ---------------------------------------------------------------- taking you there
  // Pressing an alert's button does what you would do by hand: it presses the game's own side-menu or panel tab button (navigation only: it never
  // claims, equips, crafts, completes or buys anything), then scrolls to the item and rings it so it is easy to see. Only these tabs are ever pressed.
  const NAV_OK = new Set(['bank', 'skillcustom', 'quests', 'equipment', 'tasks', 'barter', 'inventory', 'skills', 'diary', 'delvetree', 'fortifytree', 'smith', 'craft', 'imbue', 'brew', 'collections']);
  let pulsed = [], pulseT = 0;
  function clearPulse() { pulsed.forEach((e) => e.remove()); pulsed = []; clearTimeout(pulseT); }
  function pointAt(target, label) {
    const r = target.getBoundingClientRect(); if (!r.width && !r.height) return false;
    const ring = document.createElement('div'); ring.className = 'cc-alert-ring cc-ring';
    ring.style.cssText = 'left:' + (r.left - 5) + 'px;top:' + (r.top - 5) + 'px;width:' + (r.width + 10) + 'px;height:' + (r.height + 10) + 'px';
    const tag = document.createElement('div'); tag.className = 'cc-alert-tag cc-ringtag'; tag.textContent = label || 'Here';
    const below = r.top < 60; tag.style.cssText = 'left:' + Math.max(4, Math.min(window.innerWidth - 150, r.left + r.width / 2 - 60)) + 'px;top:' + (below ? r.bottom + 10 : r.top - 38) + 'px';
    document.body.append(ring, tag); pulsed.push(ring, tag); return true;
  }
  const tabOpen = (t) => {
    const win = document.getElementById('tab-' + t); if (win && win.classList.contains('active') && win.getClientRects().length) return true;
    const pb = window.__ccDom.q('.panel-tab-btn[data-tab="' + t + '"]'); return !!(pb && pb.classList.contains('active'));
  };
  function pressTab(t) {
    if (!NAV_OK.has(t) || tabOpen(t)) return false;
    const btn = window.__ccDom.q('.panel-tab-btn[data-tab="' + t + '"]') || window.__ccDom.q('.floating-tab-strip .floating-tab-btn[data-tab="' + t + '"]:not(.cc-menu-btn)') || window.__ccDom.q('.floating-tab-btn[data-tab="' + t + '"]');
    if (!btn) return false;
    btn.click(); return true;
  }
  // find the thing to scroll to inside the opened window: a bank / inventory slot by item id, a recipe by its item name (the game keeps the name in the
  // tooltip that sits inside the recipe's cell), or any element whose text names it
  function findTarget(f) {
    if (!f) return null;
    const root = f.tab ? (document.getElementById('tab-' + f.tab) || document.getElementById(f.tab + '-panel') || document) : document;
    if (f.selector) { const hit = [...document.querySelectorAll(f.selector)].find((e) => e.getClientRects().length); if (hit) return hit; }
    if (f.itemId) { const hit = [...root.querySelectorAll('[data-item-id="' + f.itemId + '"]')].find((e) => e.getClientRects().length); if (hit) return hit; }
    if (f.name) {
      const tip = [...root.querySelectorAll('.tt-name')].find((e) => e.textContent.trim() === f.name && e.closest('.tooltip'));
      if (tip) { const cell = tip.closest('.tooltip').parentElement; if (cell && cell.getClientRects().length) return cell; }
      const leaf = [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && e.getClientRects().length && e.textContent.trim() === f.name);
      if (leaf) return leaf.closest('button,[class*=row],[class*=item],[class*=card]') || leaf;
    }
    if (f.text) { const leaf = [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && e.getClientRects().length && e.textContent.indexOf(f.text) >= 0); if (leaf) return leaf.closest('[class*=row],[class*=item],[class*=card],li') || leaf; }
    return null;
  }
  function showMe(a) {
    clearPulse();
    if (a.open && window[a.open] && typeof window[a.open].toggle === 'function') { try { if (!window[a.open].isOpen) window[a.open].toggle(); } catch (e) { /* panel failed */ } }
    const tabs = a.tabs || (a.tab ? [a.tab] : []);
    let waited = 0;
    tabs.forEach((t) => pressTab(t));
    // the window needs a moment to appear; then scroll to the item and ring it (or ring the tab if there is no item)
    const go = () => {
      const t = a.find ? findTarget(a.find) : null;
      if (t) { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ } setTimeout(() => { pointAt(t, a.tag || 'Here'); pulseT = setTimeout(clearPulse, 9000); }, 350); return; }
      if ((waited += 150) < 1800) { setTimeout(go, 150); return; }
      // not found: ring the opened window's tab button instead
      let hit = false;
      tabs.forEach((tb) => window.__ccDom.qa('.panel-tab-btn[data-tab="' + tb + '"], .floating-tab-strip .floating-tab-btn[data-tab="' + tb + '"]:not(.cc-menu-btn)').forEach((e) => { if (e.getClientRects().length && pointAt(e, a.tag || 'Opened')) hit = true; }));
      if (!hit && !a.open && a.hint) { const b = document.querySelector('#cc-alertbell .bell'); if (b) pointAt(b, a.hint); }
      pulseT = setTimeout(clearPulse, 7000);
    };
    setTimeout(go, 250);
  }

  // ---------------------------------------------------------------- bell
  const style = document.createElement('style'); style.id = 'cc-alerts-style';
  style.textContent = `
#cc-alertbell{position:fixed;left:90px;top:44px;z-index:1105;font:var(--cc-fs,14px)/1.4 var(--cc-font,system-ui,sans-serif);color:var(--cc-text,#dcdce8)}
#cc-alertbell .bell{user-select:none;box-shadow:var(--cc-sh-pop)}
#cc-alertbell .bell:hover,#cc-alertbell.open .bell{border-color:var(--cc-accent)}
#cc-alertbell.has .bell{animation:ccBellRing 2.4s ease-in-out 1}
@keyframes ccBellRing{0%,100%{transform:rotate(0)}10%{transform:rotate(14deg)}20%{transform:rotate(-12deg)}30%{transform:rotate(9deg)}40%{transform:rotate(-6deg)}50%{transform:rotate(0)}}
@media (prefers-reduced-motion:reduce){#cc-alertbell.has .bell{animation:none}}
#cc-alertbell .n{display:none}#cc-alertbell.has .n{display:inline-grid}
#cc-alertbell .list{position:absolute;left:0;top:calc(100% + 8px);max-height:70vh;overflow:auto;display:none;flex-direction:column;gap:0;background:var(--cc-bg-2);border:1px solid var(--cc-border-strong);border-radius:calc(10 * var(--u,1px));box-shadow:var(--cc-sh-pop)}
#cc-alertbell.open .list{display:flex}
#cc-alertbell.nobell .bell{display:none}
#cc-alertbell .list.peek{position:fixed;right:auto;bottom:auto}
#cc-alertbell .list::before{content:'';position:absolute;left:0;top:-12px;width:100%;height:12px}
#cc-alertbell .none{padding:10px;color:var(--cc-text-dim);text-align:center}
.cc-alert-ring{position:fixed;z-index:2147482000;box-sizing:border-box}
.cc-alert-tag{position:fixed;z-index:2147482001}
`;
  document.head.appendChild(style);
  const el = document.createElement('div'); el.id = 'cc-alertbell'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Alerts');
  el.innerHTML = '<div class="bell cc-bell" role="button" tabindex="0" aria-label="Alerts" title="Alerts">🔔<span class="n cc-badge"></span></div><div class="list cc-alist"></div>';
  document.body.appendChild(el);
  const bell = el.querySelector('.bell'), badge = el.querySelector('.n'), list = el.querySelector('.list');
  try { window.__ccUIReg && window.__ccUIReg('cc-alertbell', { title: 'Alert Bell', head: '.cc-no-ctx', anchored: true }); } catch (e) { /* ui-scale not loaded yet */ }
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));

  // ---- drag it anywhere; right-click to lock it in place (or put it back)
  const LS_POS = 'cc-alertbell-pos';
  let locked = false;
  try { const p = JSON.parse(localStorage.getItem(LS_POS) || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; } locked = !!(p && p.lock); } catch (e) { /* default spot */ }
  const savePos = () => { try { localStorage.setItem(LS_POS, JSON.stringify({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), lock: locked })); } catch (e) { /* storage blocked */ } };
  const viewH = () => (window.__ccVH ? window.__ccVH() : window.innerHeight), edgeTop = () => (window.__ccEdge && window.__ccEdge.top) || 0;
  bell.style.cursor = locked ? 'pointer' : 'grab';
  bell.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || locked) return;
    const r0 = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, L0 = parseFloat(el.style.left) || r0.left, T0 = parseFloat(el.style.top) || r0.top; let moved = false;
    const mv = (m) => {
      if (!moved && Math.abs(m.clientX - x0) < 4 && Math.abs(m.clientY - y0) < 4) return;
      moved = true; el.classList.remove('open');
      el.style.left = Math.round(Math.max(0, Math.min(window.innerWidth - 40, L0 + m.clientX - x0))) + 'px';
      el.style.top = Math.round(Math.max(edgeTop(), Math.min(viewH() - 40, T0 + m.clientY - y0))) + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); if (moved) savePos(); };
    document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
    e.preventDefault();
  });
  let menu = null;
  const closeMenu = () => { if (menu) { try { window.__ccUI.closeMenu(); } catch (e) { /* kit gone */ } menu = null; } };
  // right-click: lock / reset, and Filter > Categories / Individual alerts with check marks (each switches the same setting as Settings > Alerts)
  const GROUPS = [['Progress', ['Tree', 'Lever', 'Chest', 'Quest', 'QuestSlot', 'Barter', 'Gear', 'Craft']], ['Events while you were away', ['Pets', 'Rare']], ['Status', ['Idle', 'Inventory', 'Potions', 'Event']]];
  const isOn = (id) => { const c = CHECKS.find((x) => x.id === id); return !!setting('alert' + id, !c || c.def !== false); };
  const setOn = (id, v) => { try { window.__ccPluginSettings && window.__ccPluginSettings.set && window.__ccPluginSettings.set('alert' + id, !!v); } catch (e) { /* settings not there */ } };
  const refilter = () => { setTimeout(() => { try { run(); } catch (e) { /* next poll */ } }, 120); };
  function menuItems() {
    const labelOf = (id) => { const c = CHECKS.find((x) => x.id === id); return c ? c.icon + '  ' + c.label : id; };
    const cats = GROUPS.map(([name, ids]) => ({ label: name, mark: () => { const n = ids.filter(isOn).length; return n === ids.length ? '✓' : n ? '–' : ''; }, keep: true, fn: () => { const all = ids.every(isOn); ids.forEach((id) => setOn(id, !all)); refilter(); },
      children: ids.map((id) => ({ label: labelOf(id), mark: () => (isOn(id) ? '✓' : ''), keep: true, fn: () => { setOn(id, !isOn(id)); refilter(); } })) }));
    const setSlot = (slot, v) => { try { window.__ccPluginSettings && window.__ccPluginSettings.set && window.__ccPluginSettings.set(gearKey(slot), !!v); } catch (e) { /* settings not there */ } };
    const gearKids = [{ label: 'All slots', mark: () => { const n = GEAR_SLOTS.filter((x) => gearOn(x[0])).length; return n === GEAR_SLOTS.length ? '✓' : n ? '–' : ''; }, keep: true, fn: () => { const all = GEAR_SLOTS.every((x) => gearOn(x[0])); GEAR_SLOTS.forEach((x) => setSlot(x[0], !all)); refilter(); } }, { sep: 1 }]
      .concat(GEAR_SLOTS.map(([slot, lab]) => ({ label: lab + (slot === 'ammo' ? ' (ammo reminder)' : ''), mark: () => (gearOn(slot) ? '✓' : ''), keep: true, fn: () => { setSlot(slot, !gearOn(slot)); refilter(); } })));
    const ind = CHECKS.map((c) => (c.id === 'Gear'
      ? { label: labelOf(c.id), mark: () => (isOn(c.id) ? '✓' : ''), keep: true, fn: () => { setOn(c.id, !isOn(c.id)); refilter(); }, children: gearKids }
      : { label: labelOf(c.id), mark: () => (isOn(c.id) ? '✓' : ''), keep: true, fn: () => { setOn(c.id, !isOn(c.id)); refilter(); } }));
    return [
      { label: 'Filter alerts', children: [{ label: 'Categories', children: cats }, { label: 'Individual alerts', children: ind }, { sep: 1 }, { label: 'Show every alert', keep: true, fn: () => { CHECKS.forEach((c) => setOn(c.id, true)); refilter(); } }, { label: 'Hide every alert', keep: true, fn: () => { CHECKS.forEach((c) => setOn(c.id, false)); refilter(); } }] },
      { sep: 1 },
      { label: 'Hide the bell button (hover the Alerts module to see the list)', fn: () => { try { window.__ccPluginSettings.set('alertBellHidden', true); } catch (e) { /* not saved */ } setTimeout(() => { try { render(); } catch (e) { /* next poll */ } }, 60); } },
      { label: locked ? 'Unlock the bell' : 'Lock the bell in place', fn: () => { locked = !locked; bell.style.cursor = locked ? 'pointer' : 'grab'; savePos(); } },
      { label: 'Put it back in its default spot', fn: () => { el.style.left = '90px'; el.style.top = Math.max(44, edgeTop() + 10) + 'px'; savePos(); } },
    ];
  }
  // the bell's menu is the kit's one menu component: marks '✓' / '–' / '' become checked true / 'mixed' / none
  const conv = (items) => items.map((it) => (it.sep ? { sep: true } : { label: it.label, keepOpen: !!it.keep, onClick: it.fn,
    checked: it.mark ? () => { const m = typeof it.mark === 'function' ? it.mark() : it.mark; return m === '✓' ? true : m === '–' ? 'mixed' : ''; } : undefined,
    sub: it.children ? conv(it.children) : undefined }));
  function openAt(x, y) { const UI = window.__ccUI; if (UI && UI.menu) menu = UI.menu(conv(menuItems()), x, y); }
  bell.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); openAt(e.clientX, e.clientY); });

  let hideT = 0;
  const openList = () => { clearTimeout(hideT); el.classList.add('open'); };
  const closeList = () => { clearTimeout(hideT); hideT = setTimeout(() => { el.classList.remove('open'); list.classList.remove('peek'); list.style.left = list.style.top = ''; }, 220); };
  // Hover the Info Bar's Alerts module: the list opens right at the module (below a top bar, above a bottom bar) and stays while the pointer is on the module or the list.
  function peek(anchor, pos) {
    if (!on() || !anchor) return;
    clearTimeout(hideT); el.classList.add('open'); list.classList.add('peek');
    // the bell is scaled with the other panels (a transform), so the fixed list is placed in the bell's own scaled coordinates
    const a = anchor.getBoundingClientRect(), L = list.getBoundingClientRect(), o = el.getBoundingClientRect(), sc = (() => { try { return new DOMMatrix(getComputedStyle(el).transform).a || 1; } catch (e) { return 1; } })();
    const tx = Math.max(6, Math.min(window.innerWidth - L.width - 6, a.left)), ty = pos === 'bottom' ? Math.max(edgeTop() + 4, a.top - L.height - 6) : a.bottom + 6;
    list.style.left = Math.round((tx - o.left) / sc) + 'px'; list.style.top = Math.round((ty - o.top) / sc) + 'px';
  }
  const unpeek = () => closeList();
  el.addEventListener('mouseenter', openList); el.addEventListener('mouseleave', closeList);
  bell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.classList.toggle('open'); } });

  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  function dismiss(a) { dismissed[a.key] = a.sig == null ? '' : String(a.sig); saveDis(); alerts = alerts.filter((x) => x.key !== a.key); render(); }
  function render() {
    if (!on()) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.classList.toggle('nobell', !!setting('alertBellHidden', false));   // the bell button can be hidden; the list still opens from the Info Bar module
    const n = alerts.length;
    el.classList.toggle('has', n > 0);
    const prev = badge.textContent; badge.textContent = n > 99 ? '99+' : String(n);
    if (prev !== badge.textContent && n > 0) { el.classList.remove('has'); void el.offsetWidth; el.classList.add('has'); }
    bell.setAttribute('aria-label', n ? n + ' alert' + (n > 1 ? 's' : '') : 'No alerts');
    bell.title = n ? n + ' alert' + (n > 1 ? 's' : '') : 'No alerts';
    list.textContent = '';
    const hd = document.createElement('div'); hd.className = 'cc-mh';
    hd.appendChild(document.createTextNode('Alerts'));
    if (n > 1) { const all = document.createElement('button'); all.type = 'button'; all.className = 'cc-btn sm'; all.dataset.v = 'quiet'; all.textContent = 'Clear all'; all.addEventListener('click', () => { alerts.slice().forEach((a) => { dismissed[a.key] = a.sig == null ? '' : String(a.sig); }); saveDis(); alerts = []; render(); }); hd.appendChild(all); }
    list.appendChild(hd);
    if (!n) { const none = document.createElement('div'); none.className = 'none'; none.textContent = 'Nothing needs your attention.'; list.appendChild(none); return; }
    alerts.forEach((a) => {
      const row = document.createElement('div'); row.className = 'cc-alert it';
      const ic = document.createElement('span'); ic.className = 'cc-tile sm'; ic.style.gridRow = '1 / span 3'; const ico = /^\//.test(a.icon || '') ? document.createElement('img') : document.createElement('span'); ico.className = 'cc-ico'; if (/^\//.test(a.icon || '')) { ico.src = a.icon; ico.alt = ''; } else ico.textContent = a.icon || '❗'; ic.appendChild(ico);
      const tx = document.createDocumentFragment();
      const b = document.createElement('span'); b.className = 'ti'; b.textContent = a.text; tx.appendChild(b);
      if (a.sub || a.at) { const s = document.createElement('span'); s.className = 'su'; s.textContent = (a.sub || '') + (a.at ? (a.sub ? ' \u00B7 ' : '') + ago(a.at) : ''); tx.appendChild(s); }
      if (a.tab || a.tabs || a.open || a.selector || a.hint) { const go = document.createElement('button'); go.type = 'button'; go.className = 'cc-btn go sm go'; go.textContent = '\u2192 ' + (a.dest || (a.open && !(a.tab || a.tabs) ? 'Open it' : 'Go there')); go.addEventListener('click', () => showMe(a)); tx.appendChild(go); }
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.title = 'Dismiss'; x.setAttribute('aria-label', 'Dismiss: ' + a.text); x.addEventListener('click', () => dismiss(a));
      row.append(ic, tx, x); list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- start
  const first = setTimeout(() => { try { run(); } catch (e) { /* retry on the next poll */ } }, 4000);
  schedule();
  const settingTimer = setInterval(() => { try { render(); } catch (e) { /* ignore */ } }, 3000);   // picks up the master switch quickly
  function teardown() {
    clearTimeout(first); clearTimeout(polling); clearInterval(settingTimer); clearPulse(); closeMenu(); el.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc alerts torn down';
  }
  window[NS] = { version: 1, teardown, run, addCheck, resetDismissed() { dismissed = {}; saveDis(); run(); }, get alerts() { return alerts.slice(); }, get isOpen() { return el.classList.contains('open'); }, toggle() { el.classList.toggle('open'); }, peek, unpeek, showMe };
  return 'cc alerts loaded';
})();
