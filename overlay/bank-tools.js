// ScapeLite Bank Tools. DISPLAY-ONLY: never moves, sorts or edits anything in the game's bank.
//   1. Separators between every category group in the bank grid (the way the game already separates Scraps), each with
//      a small label ("Fish", "Cook", "Melee weapons", ...).
//   2. Hovering an item lists the categories it belongs to in its tooltip ("Raw > Fish").
//   3. Hovering a bank filter button that has sub-categories (Raw, Processed, Equipment, Potions) opens a small menu
//      of them, with item counts; picking one shows only those items (a display filter on top of the game's own).
//   3b. The function buttons (Sort, Swap, Insert, Remove placeholders) tuck into the Filters button, renamed Settings.
//   4. A size slider in the bank toolbar makes the item slots smaller or bigger.
//   5. New items (ones you never held before) get a sparkle in the bank, and the bank icon in the side menu twinkles until you
//      have looked at them (hover an item, or press Clear).
// Categories are the game's own taxonomy (the same rules as its "Bank Filters" menu), read through the Game Data Bridge.
(function () {
  'use strict';
  const NS = '__ccBankTools';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  const on = (key, def) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(key); return v === undefined || v === null ? def : v !== false; } catch (e) { return def; } };

  // The game's own category tables (Bank Filters menu): id, label, icon and the rule that puts an item in it.
  const RES = [
    { id: 'raw', label: 'Raw', icon: 'tin_ore', type: 'raw', generic: true },
    { id: 'processed', label: 'Processed', icon: 'tin_bar', type: 'processed', generic: true },
    { id: 'fish', label: 'Fish', icon: 'raw_shrimp', type: 'raw', skill: 'fish' },
    { id: 'cook', label: 'Cook', icon: 'shrimp', type: 'processed', skill: 'cook' },
    { id: 'cook_soup', label: 'Cook (soup)', icon: 'life_soup_t0', prefix: 'life_soup' },
    { id: 'mine', label: 'Mine', icon: 'copper_ore', type: 'raw', skill: 'mine' },
    { id: 'smith', label: 'Smith', icon: 'copper_bar', type: 'processed', skill: 'smith' },
    { id: 'forage', label: 'Forage', icon: 'leather', type: 'raw', skill: 'forage' },
    { id: 'craft', label: 'Craft', icon: 'leather_strips', type: 'processed', skill: 'craft' },
    { id: 'invoke', label: 'Invoke', icon: 'dim_essence', type: 'raw', skill: 'invoke' },
    { id: 'imbue', label: 'Imbue', icon: 'charged_dim_essence', type: 'processed', skill: 'imbue' },
    { id: 'farm', label: 'Farm', icon: 'skirmish_root', type: 'raw', skill: 'farm' },
    { id: 'brew_unf', label: 'Brew (unfinished)', icon: 'unf_skirmish_potion', type: 'potion_unfinished' },
    { id: 'brew', label: 'Brew', icon: 'skirmish_potion_t0', potion: true },
    { id: 'bard', label: 'Bard', icon: 'treasure_scroll_t5', scroll: true },
    { id: 'discover', label: 'Discover', icon: 'treasure_chest_t5', type: 'chest' },
    { id: 'other', label: 'Other', icon: 'jar_of_sweat', ids: ['barding_notes', 'jar_of_dirt', 'jar_of_sweat', 'sturdy_whale_ribs', 'chaos_blade', 'chaos_bowstring', 'chaos_core', 'god_blade', 'god_bowstring', 'god_core'] },
  ];
  const CATS = { scraps: ['Scraps', 'scrap_ore'], coins: ['Coins', 'gold'], bloodcoins: ['Bloodcoins', 'bloodcoins'], lamps: ['Lamps', 'large_lamp'], teleports: ['Teleports', 'stable_crystal'], gems: ['Gems', 'savage_gem'], gear: ['Gear', 'copper_dagger'], unlocks: ['Unlocks', 'enchanted_rod_t1'] };
  const GEAR = {
    melee_weapon: ['Melee weapons', 'copper_dagger'], melee_armour: ['Melee equipment', 'copper_platebody'],
    range_weapon: ['Ranged weapons', 'leather_bow'], range_armour: ['Ranged equipment', 'leather_body'],
    magic_weapon: ['Magic weapons', 'dim_staff'], magic_armour: ['Magic equipment', 'dim_robe_top'], other_gear: ['Other gear', 'copper_dagger'],
  };
  // Sub-menus of the game's top filter buttons.
  const MENUS = {
    raw: { rows: ['fish', 'mine', 'forage', 'invoke', 'farm'] },
    processed: { rows: ['cook', 'cook_soup', 'smith', 'craft', 'imbue'] },
    equipment: { gear: ['melee_weapon', 'melee_armour', 'range_weapon', 'range_armour', 'magic_weapon', 'magic_armour'] },
    potions: { rows: ['brew_unf', 'brew'] },
    scrolls: { rows: ['bard'] },
  };

  let data = null, dataAt = 0, srcOf = null;
  function load() {
    const now = Date.now();
    if (data && now - dataAt < 60000) return true;
    try {
      const b = window.__ccBridge;
      if (!b || !b.bank) return !!data;
      const d = b.bank();
      if (!d || !d.items) return !!data;
      data = d; dataAt = now; memo.clear();
      srcOf = {};
      for (const sk in d.sources || {}) (d.sources[sk] || []).forEach(id => { (srcOf[id] || (srcOf[id] = {}))[sk] = true; });
    } catch (e) { /* retry later */ }
    return !!data;
  }
  const memo = new Map();
  const iconOf = (img) => { const m = ((img && img.src) || '').match(/\/items\/([^/]+)\.png/); return m ? m[1] : null; };

  function inRow(e, id, it) {
    if (e.id === 'other' && it && it.h) return true;
    if (e.ids) return e.ids.indexOf(id) !== -1;
    if (e.prefix) return id.indexOf(e.prefix) === 0;
    if (e.scroll) return /scroll/.test(id);
    if (!it) return false;
    if (e.potion) return it.t === 'potion' || (!!it.p && it.t !== 'potion_unfinished');
    if ((e.type && it.t !== e.type) || (e.generic && it.p)) return false;
    if (e.skill) { if (!srcOf || !srcOf[id]) return it.s === e.skill; if (!srcOf[id][e.skill]) return false; }
    return true;
  }
  function gearRow(it, id) {
    const a = it.a;
    const style = a === 'stab' || a === 'slash' || a === 'crush' ? 'melee' : a === 'range' || a === 'crossbow' ? 'range' : a === 'magic' || a === 'wand' ? 'magic'
      : (it.r === 'smith' ? 'melee' : it.r === 'craft' ? 'range' : it.r === 'imbue' ? 'magic' : (srcOf && srcOf[id] ? (srcOf[id].smith ? 'melee' : srcOf[id].craft ? 'range' : srcOf[id].imbue ? 'magic' : null) : null));
    if (!style) return 'other_gear';
    return style + (a ? '_weapon' : '_armour');
  }
  // -> { key, label, chips: [labels], rows: [row ids], gear: gearRowId|null }
  function classify(id) {
    if (memo.has(id)) return memo.get(id);
    const it = data && data.items ? data.items[id] : null;
    let out = null;
    if (it) {
      const chips = []; const rows = []; let gear = null, cat = null;
      switch (it.t) {
        case 'currency': cat = id === 'bloodcoins' ? 'bloodcoins' : 'coins'; break;
        case 'virtual': cat = 'scraps'; break;
        case 'equipment': cat = 'gear'; break;
        case 'gem': cat = 'gems'; break;
        case 'unlock': cat = 'unlocks'; break;
        case 'consumable': cat = it.c === 'teleport' ? 'teleports' : (it.c === 'lamp' || it.c === 'combat_lamp') ? 'lamps' : null; break;
        default: cat = null;
      }
      if (cat) chips.push(CATS[cat][0]);
      if (cat === 'gear') { gear = gearRow(it, id); chips.push(GEAR[gear][0]); }
      else RES.forEach((e) => { if (id.indexOf('life_soup') === 0 && e.id === 'cook') return; if (inRow(e, id, it)) { rows.push(e.id); chips.push(e.label); } });
      const specific = rows.filter((r) => !RES.find((e) => e.id === r).generic);
      const key = gear ? 'gear:' + gear : specific.length ? specific[0] : rows.length ? rows[0] : cat ? cat : 'other';
      const label = gear ? GEAR[gear][0] : (RES.find((e) => e.id === key) || {}).label || (CATS[key] && CATS[key][0]) || 'Other';
      out = { key, label, chips: chips.length ? chips : ['Other'], rows, gear };
    }
    memo.set(id, out);
    return out;
  }

  // ---------------------------------------------------------------- styles
  const style = document.createElement('style');
  style.id = 'cc-bank-style';
  style.textContent = `
.cc-bank-hide{display:none !important}
.cc-bank-sep{grid-column:1/-1;display:flex;align-items:center;gap:8px;height:14px;margin:2px 0;cursor:pointer;user-select:none}
.cc-bank-sep:hover span{color:#d6d6e4}
.cc-bank-sep.folded span{color:#b9a76a}
.cc-bank-fold{display:none!important}
.cc-bank-sep::before,.cc-bank-sep::after{content:'';height:1px;background:rgba(255,255,255,.14);flex:1}
.cc-bank-sep::before{flex:0 0 10px}
.cc-bank-sep span{font:600 10px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#8a8a9a}
.cc-bank-sep.nolabel::before{flex:1}
.cc-bank-chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:3px}
.cc-bank-chips i{font-style:normal;font-size:.8em;padding:0 6px;border-radius:8px;background:rgba(255,255,255,.1);color:#cfd3dc;white-space:nowrap}
.cc-bank-chips i.gen{background:rgba(255,255,255,.06);color:#9a9aa6}
.cc-bank-chips b{font-weight:400;color:#6a6a78;font-size:.8em}
.bank-filter-btn.cc-sub-on::after{content:' \\00b7  ' attr(data-cc-sub);color:#ffd24a}
.cc-bank-dd{position:fixed;z-index:100002;min-width:190px;background:#16161e;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.65);font:13px/1.3 system-ui,sans-serif;color:#ddd}
.cc-bank-dd .it{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.cc-bank-dd .it:hover{background:rgba(255,255,255,.1)}
.cc-bank-dd .it.on{background:rgba(255,210,74,.14);color:#ffd24a}
.cc-bank-dd .it img{width:20px;height:20px;image-rendering:pixelated}
.cc-bank-dd .it span{flex:1}
.cc-bank-dd .it em{font-style:normal;color:#8a8a9a;font-size:.88em}
.cc-bank-dd .hd{padding:3px 8px 5px;color:#8a8a9a;font-size:11px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:3px}`;
  document.head.appendChild(style);
  const style2 = document.createElement('style'); style2.id = 'cc-bank-style2';
  style2.textContent = `
#tab-bank .bank-grid{--cc-s:1}
#tab-bank .bank-grid.cc-sized{grid-template-columns:repeat(auto-fill,calc(57px * var(--cc-s))) !important}
#tab-bank .bank-grid.cc-sized .bank-slot{zoom:var(--cc-s)}
.cc-bank-size{display:inline-flex;align-items:center;gap:8px;margin-left:auto;padding:0 10px;height:30px;border:1px solid #2a2a38;border-radius:3px;background:#141418;color:#9a9aae;font:11px/1 system-ui,sans-serif;flex:none}
.cc-bank-size svg{width:15px;height:15px;flex:none;fill:currentColor;opacity:.85}
.cc-bank-size input[type=range]{-webkit-appearance:none;appearance:none;width:96px;height:4px;border-radius:2px;background:linear-gradient(90deg,#4a90e2 var(--p,40%),rgba(255,255,255,.18) var(--p,40%));outline:none;cursor:pointer;margin:0}
.cc-bank-size input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#fff;border:2px solid #4a90e2;box-shadow:0 0 6px rgba(74,144,226,.7)}
.cc-bank-size b{font-weight:500;min-width:30px;text-align:right;color:#cfd3dc;cursor:pointer}
.cc-bank-new-clear{margin-left:8px;height:26px;padding:0 10px;border-radius:13px;border:1px solid #b8962f;background:rgba(255,210,74,.1);color:#ffd24a;font:11px/1 system-ui,sans-serif;cursor:pointer;vertical-align:middle}
.cc-bank-new-clear:hover{background:rgba(255,210,74,.2)}
.bank-slot.cc-new{box-shadow:0 0 0 1px rgba(255,210,74,.75),0 0 10px rgba(255,210,74,.45) !important;border-radius:6px}
.bank-slot.cc-new::after{content:'\\2726';position:absolute;top:-3px;right:-2px;font:13px/1 system-ui,sans-serif;color:#ffe27a;text-shadow:0 0 6px #ffb52a,0 0 12px rgba(255,181,42,.8);pointer-events:none;animation:ccTwinkle 1.6s ease-in-out infinite;z-index:3}
.bank-slot.cc-new::before{content:'NEW';position:absolute;left:2px;bottom:1px;padding:0 3px;border-radius:3px;font:700 8px/10px system-ui,sans-serif;letter-spacing:.05em;color:#2a1a0a;background:#ffd24a;pointer-events:none;z-index:3}
.floating-tab-btn.cc-bank-spark,.tab-btn.cc-bank-spark{position:relative}
.floating-tab-btn.cc-bank-spark::after,.tab-btn.cc-bank-spark::after{content:'\\2726';position:absolute;top:-4px;right:-3px;font:14px/1 system-ui,sans-serif;color:#ffe27a;text-shadow:0 0 6px #ffb52a,0 0 12px rgba(255,181,42,.85);pointer-events:none;animation:ccTwinkle 1.6s ease-in-out infinite;z-index:4}
@keyframes ccTwinkle{0%,100%{opacity:.55;transform:scale(.8) rotate(0deg)}50%{opacity:1;transform:scale(1.25) rotate(25deg)}}
@media (prefers-reduced-motion:reduce){.bank-slot.cc-new::after,.floating-tab-btn.cc-bank-spark::after,.tab-btn.cc-bank-spark::after{animation:none}}`;
  document.head.appendChild(style2);
  const style3 = document.createElement('style'); style3.id = 'cc-bank-style3';
  style3.textContent = `
#tab-bank .bank-toolbar.cc-tidy .bank-mode-btn{display:none !important}
#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn{display:block !important;font-size:18px !important;padding:4px 10px !important;border:1px solid #2a2a38 !important;border-radius:3px !important;background:#141418 !important;color:#aaa !important;cursor:pointer}
#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn:hover{color:#fff !important;border-color:#4a4a62 !important}
#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn .bank-filter-btn-check,#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn .bank-filter-btn-label{display:none !important}
#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn::before{content:'Settings'}
#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn.filtering::after{content:'';display:inline-block;width:6px;height:6px;margin-left:8px;border-radius:50%;background:#5580c0;vertical-align:middle}
.cc-bank-set{position:fixed;z-index:100002;min-width:230px;background:#16161e;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,.65);font:13px/1.3 system-ui,sans-serif;color:#ddd}
.cc-bank-set .hd{padding:3px 8px 5px;color:#8a8a9a;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.cc-bank-set .it{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer}
.cc-bank-set .it:hover{background:rgba(255,255,255,.09)}
.cc-bank-set .it span{flex:1}
.cc-bank-set .it small{color:#8a8a9a;font-size:11px}
.cc-bank-set .pill{width:30px;height:16px;border-radius:8px;background:#2c2c3a;position:relative;flex:none;transition:background .15s}
.cc-bank-set .pill::after{content:'';position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#aab;transition:left .15s,background .15s}
.cc-bank-set .it.on .pill{background:#2f6bd0}
.cc-bank-set .it.on .pill::after{left:16px;background:#fff}
.cc-bank-set .it.act em{font-style:normal;color:#e0675a;font-size:11px}
.cc-bank-set .sep{height:1px;background:rgba(255,255,255,.1);margin:4px 2px}`;
  document.head.appendChild(style3);

  // ---------------------------------------------------------------- toolbar tidy: Settings menu
  const FN = [['sort', 'Sort', 'Keep the bank sorted by category'], ['swap', 'Swap', 'Drag an item onto another to swap them'], ['insert', 'Insert', 'Drag an item to insert it at a spot']];
  let setMenu = null;
  const closeSet = () => { if (setMenu) { setMenu.remove(); setMenu = null; } document.removeEventListener('mousedown', onDocDown, true); };
  function onDocDown(e) { if (setMenu && !setMenu.contains(e.target) && !(e.target.closest && e.target.closest('.bank-filter-menu-btn'))) closeSet(); }
  const modeBtn = (name) => [...document.querySelectorAll('#tab-bank .bank-toolbar .bank-mode-btn')].find((b) => (b.textContent || '').trim().toLowerCase().indexOf(name) === 0);
  function tidy() {
    const tb = document.querySelector('#tab-bank .bank-toolbar');
    if (!tb) return;
    const want = on('bankToolsEnabled', true) && on('bankTidyToolbar', true);
    tb.classList.toggle('cc-tidy', want);
    if (!want) closeSet();
  }
  function openSet(btn) {
    closeSet();
    const m = document.createElement('div'); m.className = 'cc-bank-set'; setMenu = m;
    const hd = document.createElement('div'); hd.className = 'hd'; hd.textContent = 'Bank settings'; m.appendChild(hd);
    const row = (label, small, onState, act, fn) => {
      const r = document.createElement('div'); r.className = 'it' + (onState ? ' on' : '') + (act ? ' act' : '');
      const sp = document.createElement('span'); sp.textContent = label; r.appendChild(sp);
      if (small) { const sm = document.createElement('small'); sm.textContent = small; r.appendChild(sm); }
      if (!act) { const pl = document.createElement('i'); pl.className = 'pill'; r.appendChild(pl); }
      r.addEventListener('click', (e) => { e.stopPropagation(); fn(r); }); m.appendChild(r); return r;
    };
    const fcount = ((btn.textContent || '').match(/\((\d+)\)/) || [])[1];
    row('Filters\u2026', fcount ? fcount + ' hidden' : '', false, true, () => { closeSet(); realClick(btn); });
    const sep = document.createElement('div'); sep.className = 'sep'; m.appendChild(sep);
    FN.forEach(([k, label, tip]) => { const b = modeBtn(k); if (!b) return; const r = row(label, '', b.classList.contains('active'), false, () => { b.click(); setTimeout(() => { r.classList.toggle('on', b.classList.contains('active')); }, 60); }); r.title = tip; });
    const rp = modeBtn('remove');
    if (rp) { const sep2 = document.createElement('div'); sep2.className = 'sep'; m.appendChild(sep2); row('Remove placeholders', '', false, true, () => { closeSet(); rp.click(); }); }
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(innerWidth - m.offsetWidth - 4, r.left)) + 'px';
    m.style.top = Math.min(innerHeight - m.offsetHeight - 4, r.bottom + 4) + 'px';
    document.addEventListener('mousedown', onDocDown, true);
  }
  let passClick = false;
  const realClick = (btn) => { passClick = true; try { btn.click(); } finally { passClick = false; } };
  function onSetClick(e) {
    if (passClick) return;
    const b = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-toolbar.cc-tidy .bank-filter-menu-btn') : null;
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    if (setMenu) closeSet(); else openSet(b);
  }
  document.addEventListener('click', onSetClick, true);

  // ---------------------------------------------------------------- slot size slider
  const LS_SIZE = 'cc-bank-size';
  let size = 1;
  try { size = Math.min(1.8, Math.max(0.6, parseFloat(localStorage.getItem(LS_SIZE)) || 1)); } catch (e) {}
  let sliderEl = null, clearEl = null;
  const pctOf = (v) => Math.round((v - 0.6) / (1.8 - 0.6) * 100);
  function syncSlider() {
    const tb = document.querySelector('#tab-bank .bank-toolbar');
    const g = grid();
    if (!tb || !g) return;
    const want = on('bankToolsEnabled', true) && on('bankSizeSlider', true);
    if (!want) { if (sliderEl) { sliderEl.remove(); sliderEl = null; } g.classList.remove('cc-sized'); g.style.removeProperty('--cc-s'); return; }
    if (!sliderEl || !sliderEl.isConnected) {
      sliderEl = document.createElement('span'); sliderEl.className = 'cc-bank-size'; sliderEl.title = 'Item size \u00b7 double-click the number to reset';
      sliderEl.innerHTML = '<svg viewBox="0 0 16 16" aria-label="Small items"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg><input type="range" min="0.6" max="1.8" step="0.05"><svg viewBox="0 0 16 16" aria-label="Big items"><rect x="1" y="1" width="14" height="14" rx="2"/></svg><b></b>';
      const r = sliderEl.querySelector('input'), b = sliderEl.querySelector('b');
      r.addEventListener('input', () => { size = parseFloat(r.value); try { localStorage.setItem(LS_SIZE, String(size)); } catch (e) {} applySize(); });
      b.addEventListener('dblclick', () => { size = 1; try { localStorage.setItem(LS_SIZE, '1'); } catch (e) {} applySize(); });
      ['mousedown', 'click', 'keydown'].forEach((t) => sliderEl.addEventListener(t, (e) => e.stopPropagation()));
      tb.appendChild(sliderEl);
    } else if (sliderEl.parentElement !== tb) tb.appendChild(sliderEl);
    applySize();
  }
  function applySize() {
    const g = grid(); if (!g || !sliderEl) return;
    const r = sliderEl.querySelector('input'), b = sliderEl.querySelector('b');
    if (parseFloat(r.value) !== size) r.value = String(size);
    r.style.setProperty('--p', pctOf(size) + '%'); b.textContent = Math.round(size * 100) + '%';
    g.style.setProperty('--cc-s', String(size));
    g.classList.toggle('cc-sized', Math.abs(size - 1) > 0.001);
  }

  // ---------------------------------------------------------------- new items
  const LS_KNOWN = 'cc-bank-known', LS_NEW = 'cc-bank-new';
  let known = null, fresh = {};
  try { const k = localStorage.getItem(LS_KNOWN); if (k) known = JSON.parse(k); } catch (e) {}
  try { fresh = JSON.parse(localStorage.getItem(LS_NEW) || '{}') || {}; } catch (e) { fresh = {}; }
  const saveNew = () => { try { localStorage.setItem(LS_KNOWN, JSON.stringify(known || {})); localStorage.setItem(LS_NEW, JSON.stringify(fresh)); } catch (e) {} };
  function trackNew() {
    if (!on('bankToolsEnabled', true) || !on('bankNewTags', true)) { if (Object.keys(fresh).length) { document.querySelectorAll('.cc-new').forEach((e) => e.classList.remove('cc-new')); sparkle(false); } return; }
    const b = window.__ccBridge; if (!b || !b.held) return;
    const held = b.held(); if (!held || !Object.keys(held).length) return; // bank not loaded yet
    if (!known) { known = {}; Object.keys(held).forEach((id) => { known[id] = 1; }); saveNew(); return; } // first run: everything you own is "known"
    let ch = false;
    Object.keys(held).forEach((id) => { if (!known[id]) { known[id] = 1; fresh[id] = Date.now(); ch = true; } });
    Object.keys(fresh).forEach((id) => { if (!held[id] && Date.now() - fresh[id] > 5000) { /* kept: it was new when it arrived */ } });
    if (ch) saveNew();
    sparkle(Object.keys(fresh).length > 0);
  }
  function sparkle(v) {
    document.querySelectorAll('.floating-tab-btn[data-tab=bank], .modal-tabs .tab-btn[data-tab=bank]').forEach((e) => e.classList.toggle('cc-bank-spark', !!v));
  }
  function markSlots() {
    const g = grid(); if (!g) return;
    const want = on('bankToolsEnabled', true) && on('bankNewTags', true);
    let n = 0;
    slotsOf(g).forEach((s) => { const id = iconOf(s.querySelector('img')); const isNew = want && !!id && !!fresh[id]; if (isNew) n++; if (s.classList.contains('cc-new') !== isNew) s.classList.toggle('cc-new', isNew); });
    const tb = document.querySelector('#tab-bank .bank-toolbar');
    if (tb) {
      if (n > 0 && want) {
        if (!clearEl || !clearEl.isConnected) { clearEl = document.createElement('button'); clearEl.type = 'button'; clearEl.className = 'cc-bank-new-clear'; clearEl.addEventListener('click', (e) => { e.stopPropagation(); clearNew(); }); tb.insertBefore(clearEl, sliderEl && sliderEl.parentElement === tb ? sliderEl : null); }
        const t = '\u2726 ' + n + ' new \u2013 clear'; if (clearEl.textContent !== t) clearEl.textContent = t;
      } else if (clearEl) { clearEl.remove(); clearEl = null; }
    }
  }
  function clearNew(id) {
    if (id) delete fresh[id]; else fresh = {};
    saveNew(); markSlots(); sparkle(Object.keys(fresh).length > 0);
  }
  // Looking at a new item (hovering it) counts as seen.
  function onSeen(e) {
    const slot = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-slot.cc-new') : null;
    if (!slot) return;
    const id = iconOf(slot.querySelector('img'));
    if (id && fresh[id]) { clearTimeout(seenT[id]); seenT[id] = setTimeout(() => { clearNew(id); }, 500); }
  }
  const onSeenOut = (e) => { const slot = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-slot') : null; if (!slot) return; const id = iconOf(slot.querySelector('img')); if (id) clearTimeout(seenT[id]); };
  document.addEventListener('mouseout', onSeenOut, true);
  const seenT = {};
  document.addEventListener('mouseover', onSeen, true);

  // ---------------------------------------------------------------- separators + sub-filter
  let sub = null; // { parent: 'raw', kind: 'row'|'gear', id: 'fish', label }
  let lastSig = '', bankOpenSince = 0;
  // Collapsed separators (by group key), remembered between sessions and applied every time the bank opens.
  let fold = {};
  try { fold = JSON.parse(localStorage.getItem('cc-bank-fold') || '{}') || {}; } catch (e) { fold = {}; }
  const saveFold = () => { try { localStorage.setItem('cc-bank-fold', JSON.stringify(fold)); } catch (e) {} };
  const grid = () => document.querySelector('#tab-bank .bank-grid');
  const slotsOf = (g) => [...g.children].filter((c) => c.classList && c.classList.contains('bank-slot'));
  function matchesSub(c) {
    if (!sub || !c) return !sub;
    return sub.kind === 'gear' ? c.gear === sub.id : c.rows.indexOf(sub.id) !== -1;
  }
  function refresh() {
    const g = grid();
    if (!g) return;
    const vis = g.getBoundingClientRect().width > 0;
    // Opening the bank and closing it again counts as having seen the new items.
    if (!vis) { if (bankOpenSince && Date.now() - bankOpenSince > 1500 && Object.keys(fresh).length) clearNew(); bankOpenSince = 0; return; }
    if (!bankOpenSince) bankOpenSince = Date.now();
    if (!load()) return;
    tidy(); syncSlider(); markSlots();
    const slots = slotsOf(g);
    const keys = slots.map((s) => { const id = iconOf(s.querySelector('img')); const c = id ? classify(id) : null; return { s, id, c }; });
    // sub-filter first (a display-only class), so separators only count what is shown
    keys.forEach((k) => { const hide = !!sub && !matchesSub(k.c); if (k.s.classList.contains('cc-bank-hide') !== hide) k.s.classList.toggle('cc-bank-hide', hide); });
    const wantSep = on('bankToolsEnabled', true) && on('bankSeparators', true);
    // The game sorts gear by tier, so weapons and armour of every style interleave. Visually (CSS order, DOM untouched) gather them
    // into one block per style at the spot of the first gear item.
    const GR = Object.keys(GEAR);
    let firstGear = -1;
    keys.forEach((k, i) => { if (firstGear < 0 && k.c && k.c.gear) firstGear = i; });
    keys.forEach((k, i) => {
      const gi = k.c && k.c.gear ? GR.indexOf(k.c.gear) : -1;
      k.o = wantSep ? (gi >= 0 && firstGear >= 0 ? firstGear * 1e6 + gi * 1e4 + i : i * 1e6) : null;
      const v = k.o === null ? '' : String(k.o);
      if (k.s.style.order !== v) k.s.style.order = v;
    });
    // The game's empty filler slots keep order 0 and would otherwise land right after the first group (a big gap under Coins): send them to the end.
    g.querySelectorAll(':scope > .inv-slot.empty').forEach((e) => { const v = wantSep ? '2000000000' : ''; if (e.style.order !== v) e.style.order = v; });
    const shown = keys.filter((k) => k.s.style.display !== 'none' && !k.s.classList.contains('cc-bank-hide'));
    if (wantSep) shown.sort((a, b) => a.o - b.o);
    const labels = on('bankSepLabels', true);
    const canFold = wantSep && labels;
    keys.forEach((k) => { const f = canFold && !!fold[k.c ? k.c.key : '?'] && !k.s.classList.contains('cc-bank-hide'); if (k.s.classList.contains('cc-bank-fold') !== f) k.s.classList.toggle('cc-bank-fold', f); });
    const sig = wantSep ? shown.map((k) => (k.c ? k.c.key : '?')).join(',') + '|' + labels + '|' + slots.length + '|' + Object.keys(fold).filter((x) => fold[x]).join(',') : 'off';
    if (sig === lastSig && g.querySelector('.cc-bank-sep') != null === wantSep) return;
    lastSig = sig;
    g.querySelectorAll('.cc-bank-sep').forEach((e) => e.remove());
    if (!wantSep) return;
    let prev = null;
    const count = {};
    shown.forEach((k) => { const key = k.c ? k.c.key : '?'; count[key] = (count[key] || 0) + 1; });
    shown.forEach((k) => {
      const key = k.c ? k.c.key : '?';
      if (key !== prev && (prev !== null || labels)) {
        const folded = canFold && !!fold[key];
        const sep = document.createElement('div');
        sep.className = 'cc-bank-sep' + (labels ? '' : ' nolabel') + (folded ? ' folded' : '');
        if (labels) {
          const sp = document.createElement('span');
          sp.textContent = (folded ? '▸ ' : '▾ ') + (k.c ? k.c.label : '') + (folded ? ' (' + count[key] + ')' : '');
          sep.appendChild(sp);
          sep.title = folded ? 'Click to expand' : 'Click to collapse';
          sep.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); fold[key] = !fold[key]; if (!fold[key]) delete fold[key]; saveFold(); lastSig = ''; refresh(); });
        }
        sep.style.order = String(k.o - 1);
        g.insertBefore(sep, k.s);
      }
      prev = key;
    });
  }

  // ---------------------------------------------------------------- hover chips in item tooltips
  function onOver(e) {
    if (!on('bankToolsEnabled', true) || !on('bankHoverCats', true)) return;
    const slot = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-slot, #tab-bank .bank-scrap-slot') : null;
    if (!slot || !load()) return;
    const tt = slot.querySelector('.tooltip');
    if (!tt) return;
    let id = iconOf(slot.querySelector('img'));
    if (slot.dataset && slot.dataset.itemId) id = slot.dataset.itemId;
    const c = id ? classify(id) : null;
    let line = tt.querySelector('.cc-bank-chips');
    if (!c) { if (line) line.remove(); return; }
    const key = c.chips.join('>');
    if (line && line.dataset.k === key) return;
    if (!line) { line = document.createElement('div'); line.className = 'tt-line cc-bank-chips'; tt.appendChild(line); }
    line.dataset.k = key; line.textContent = '';
    c.chips.forEach((ch, i) => {
      if (i) { const b = document.createElement('b'); b.textContent = '›'; line.appendChild(b); }
      const t = document.createElement('i'); t.textContent = ch; if (RES.find((r) => r.label === ch && r.generic)) t.className = 'gen'; line.appendChild(t);
    });
  }
  document.addEventListener('mouseover', onOver, true);

  // ---------------------------------------------------------------- filter-button menus
  let dd = null, ddFor = null, ddTimer = 0;
  const closeDd = () => { clearTimeout(ddTimer); if (dd) { dd.remove(); dd = null; ddFor = null; } };
  const keyOfBtn = (b) => (b.dataset && b.dataset.filter) || (b.textContent || '').trim().toLowerCase();
  function setSub(s) {
    sub = s; lastSig = '';
    document.querySelectorAll('#tab-bank .bank-filter-btn').forEach((b) => { if (s && keyOfBtn(b) === s.parent) { b.classList.add('cc-sub-on'); b.dataset.ccSub = s.label; } else { b.classList.remove('cc-sub-on'); delete b.dataset.ccSub; } });
    refresh();
  }
  function counts(menu) {
    const g = grid(); const out = {};
    if (!g || !load()) return out;
    slotsOf(g).forEach((s) => { const id = iconOf(s.querySelector('img')); const c = id ? classify(id) : null; if (!c || s.classList.contains('bank-placeholder')) return;
      (menu.rows || []).forEach((r) => { if (c.rows.indexOf(r) !== -1) out[r] = (out[r] || 0) + 1; });
      (menu.gear || []).forEach((r) => { if (c.gear === r) out[r] = (out[r] || 0) + 1; }); });
    return out;
  }
  function openDd(btn) {
    const parent = keyOfBtn(btn), menu = MENUS[parent];
    if (!menu || !on('bankToolsEnabled', true) || !on('bankFilterMenus', true) || !load()) return;
    if (dd && ddFor === btn) { clearTimeout(ddTimer); return; }
    closeDd();
    const cnt = counts(menu);
    dd = document.createElement('div'); dd.className = 'cc-bank-dd'; ddFor = btn;
    const hd = document.createElement('div'); hd.className = 'hd'; hd.textContent = (btn.textContent || '').trim() + ' – show only…'; dd.appendChild(hd);
    const entries = (menu.rows || []).map((r) => { const e = RES.find((x) => x.id === r); return { kind: 'row', id: r, label: e.label, icon: e.icon }; })
      .concat((menu.gear || []).map((r) => ({ kind: 'gear', id: r, label: GEAR[r][0], icon: GEAR[r][1] })));
    entries.forEach((en) => {
      const row = document.createElement('div'); row.className = 'it' + (sub && sub.id === en.id ? ' on' : '');
      const im = document.createElement('img'); im.src = '/assets/icons/items/' + en.icon + '.png'; im.addEventListener('error', () => { im.style.visibility = 'hidden'; });
      const sp = document.createElement('span'); sp.textContent = en.label;
      const n = document.createElement('em'); n.textContent = String(cnt[en.id] || 0);
      row.append(im, sp, n);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!btn.classList.contains('active')) btn.click();
        setSub(sub && sub.id === en.id ? null : { parent, kind: en.kind, id: en.id, label: en.label });
        closeDd();
      });
      dd.appendChild(row);
    });
    document.body.appendChild(dd);
    const r = btn.getBoundingClientRect();
    dd.style.left = Math.max(4, Math.min(innerWidth - dd.offsetWidth - 4, r.left)) + 'px';
    dd.style.top = Math.min(innerHeight - dd.offsetHeight - 4, r.bottom + 2) + 'px';
    dd.addEventListener('mouseenter', () => clearTimeout(ddTimer));
    dd.addEventListener('mouseleave', () => { ddTimer = setTimeout(closeDd, 250); });
  }
  function onBtnOver(e) {
    const b = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-filter-btn') : null;
    if (!b) return;
    if (!MENUS[keyOfBtn(b)]) { ddTimer = setTimeout(closeDd, 150); return; }
    clearTimeout(ddTimer); openDd(b);
  }
  function onBtnOut(e) {
    const b = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-filter-btn') : null;
    if (b) ddTimer = setTimeout(closeDd, 300);
  }
  // Picking a top filter button (not through the menu) resets the sub-filter.
  function onBtnClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('#tab-bank .bank-filter-btn') : null;
    if (b && sub && !(e.isTrusted === false)) setSub(null);
  }
  document.addEventListener('mouseover', onBtnOver, true);
  document.addEventListener('mouseout', onBtnOut, true);
  document.addEventListener('click', onBtnClick, true);

  const timer = setInterval(() => { try { if (!document.hidden) refresh(); } catch (e) { /* keep ticking */ } }, 400);
  const timerNew = setInterval(() => { try { trackNew(); } catch (e) { /* keep ticking */ } }, 2000);
  setTimeout(() => { try { trackNew(); } catch (e) { /* ignore */ } }, 800);
  setTimeout(refresh, 300);

  function teardown() {
    clearInterval(timer); clearInterval(timerNew); closeDd(); closeSet();
    document.removeEventListener('click', onSetClick, true); style3.remove();
    const tb0 = document.querySelector('#tab-bank .bank-toolbar'); if (tb0) tb0.classList.remove('cc-tidy');
    document.removeEventListener('mouseover', onSeen, true);
    document.querySelectorAll('.cc-new').forEach((e) => e.classList.remove('cc-new')); sparkle(false);
    if (sliderEl) sliderEl.remove(); if (clearEl) clearEl.remove(); const g0 = grid(); if (g0) { g0.classList.remove('cc-sized'); g0.style.removeProperty('--cc-s'); }
    style2.remove();
    document.removeEventListener('mouseover', onOver, true);
    document.removeEventListener('mouseover', onBtnOver, true);
    document.removeEventListener('mouseout', onBtnOut, true);
    document.removeEventListener('click', onBtnClick, true);
    document.querySelectorAll('.cc-bank-sep').forEach((e) => e.remove());
    document.querySelectorAll('.cc-bank-hide').forEach((e) => e.classList.remove('cc-bank-hide'));
    document.querySelectorAll('.cc-bank-fold').forEach((e) => e.classList.remove('cc-bank-fold'));
    document.querySelectorAll('#tab-bank .bank-grid .inv-slot').forEach((e) => { e.style.order = ''; });
    document.querySelectorAll('.cc-bank-chips').forEach((e) => e.remove());
    document.querySelectorAll('.bank-filter-btn.cc-sub-on').forEach((b) => { b.classList.remove('cc-sub-on'); delete b.dataset.ccSub; });
    style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc bank-tools torn down';
  }
  window[NS] = { version: 1, teardown, classify, load, refresh, trackNew, clearNew, get fresh() { return Object.assign({}, fresh); }, get sub() { return sub; }, setSub };
  console.log('[cc] bank-tools loaded');
  return 'cc bank-tools loaded';
})();
