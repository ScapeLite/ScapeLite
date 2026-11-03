// ScapeLite chat panel (ns __ccChat). A calmer replacement for the game's chat window. It mirrors every message the game's chat shows (read from
// the game's own message list, nothing is intercepted), keeps its own history, and adds: a width you choose, channel tabs with unread counts, search,
// message-type filters, highlight and mute words, seconds on timestamps, font size, spacing, opacity, merged repeats and more.
// Typing in the box and pressing Enter hands your text to the game's own chat input, so the game sends it exactly as if you had typed it there.
// Nothing is ever sent without you pressing Enter in this panel.
(function () {
  'use strict';
  const NS = '__ccChat';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* nothing to replace */ }
  const UI = window.__ccUI;
  if (!UI) return 'cc chat needs the ui kit';
  const h = UI.h;
  const opt = (k, d) => { try { const ps = window.__ccPluginSettings, v = ps && ps.get(k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };   // Plugins settings (chatLinks, chatWorldTag, chatRulesFocus, chatTabCycle)

  const LS_CFG = 'cc-chat:v1', LS_LOG = 'cc-chat-log:v1';
  // Raid is not a channel of its own in the game: party chat travels on 'proximity' (the game just renames that button to Raid while you are in a party). Here the two are told apart by sender.
  const CHANNELS = [['global', 'Global'], ['proximity', 'Nearby'], ['raid', 'Raid'], ['friends', 'Friends'], ['clan', 'Clan'], ['game', 'Game']];
  const FALLBACK = { global: '#ffffff', raid: '#ff9f43', proximity: '#ffffff', friends: '#a6ff00', clan: '#cc88ff', game: '#5b9bd5' };
  // the game's own message types (its chat filter menu), plus the global cape / pet announcements; the game's several pet and cape spellings fold into one entry each
  const CATS = [['levels', 'Level ups'], ['pets', 'Pets'], ['rareDrops', 'Rare drops'], ['deaths', 'Deaths'], ['questsCompleted', 'Quests completed'], ['questSteps', 'Quest steps'], ['tasks', 'Task completions'], ['slaySpecials', 'Extender & Reducer'], ['unlocks', 'Unlocks'], ['collections', 'Collection log'], ['corruptedMobs', 'Corrupted mobs'], ['scrollSteps', 'Scroll steps'], ['scrollCompletions', 'Scroll completions'], ['teleports', 'Teleports'], ['friendLogins', 'Friend logins'], ['pvp', 'PvP'], ['capes', 'Capes'], ['tips', 'Did you know?'], ['other', 'Everything else']];
  const CAT_ALIAS = { shinyPets: 'pets', allSkillsPet: 'pets', shinyAllSkillsPet: 'pets', pet: 'pets', shiny_pet: 'pets', all_skills_pet: 'pets', shiny_all_skills_pet: 'pets', teammateRareDrops: 'rareDrops', cape: 'capes', trimmed_cape: 'capes', max_cape: 'capes', trimmed_max_cape: 'capes' };
  const DEF = { width: 460, font: 14, space: 'normal', opacity: 96, stamp: 'hm', h12: false, tags: false, badges: true, icons: true, colourNames: true, wrap: true, merge: true, keep: 300, hl: '', mute: '', hideCat: {}, hideCatCh: {}, hideGame: false, showSL: true, input: true, sel: ['global', 'raid', 'proximity', 'friends', 'clan', 'game'] };

  let cfg = Object.assign({}, DEF);
  try { cfg = Object.assign({}, DEF, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch (e) { /* defaults */ }
  const saveCfg = () => { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } };
  if (!cfg.raidSplit) { cfg.raidSplit = true; if (Array.isArray(cfg.sel) && cfg.sel.includes('proximity') && !cfg.sel.includes('raid')) cfg.sel = cfg.sel.concat('raid'); saveCfg(); }   // the new Raid tab starts shown wherever Nearby is shown

  // ---------------------------------------------------------------- messages
  let msgs = [];
  try { msgs = (JSON.parse(localStorage.getItem(LS_LOG) || '[]') || []).filter((m) => m && m.ch && typeof m.text === 'string'); } catch (e) { msgs = []; }
  let logDirty = false;
  const saveLog = () => { if (!logDirty) return; logDirty = false; try { localStorage.setItem(LS_LOG, JSON.stringify(msgs.filter((m) => !m.local).slice(-400))); } catch (e) { /* storage full */ } };
  // Raid and Nearby share the game's one proximity channel, so a message is the same message whichever of the two it was filed under (a restart reads it back from the game's own list as Nearby; the saved Raid label must win)
  const keyOf = (m) => (m.ch === 'raid' ? 'proximity' : m.ch) + '|' + m.ts + '|' + m.name + '|' + m.text;
  msgs.forEach((m) => { m.k = keyOf(m); });   // keys follow the current rule (saved ones may predate it)
  if (msgs.every((x) => typeof x.t === 'number')) msgs = msgs.map((x, i) => [x, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map((x) => x[0]);   // a log saved with late-added old lines is put in time order once

  // raid party roster (cached for a second)
  let party = { inParty: false, names: new Set() }, partyAt = 0;
  function partyNow() {
    const t = Date.now(); if (t - partyAt < 1000) return party; partyAt = t;
    try { const b = window.__ccBridge, p = b && b.ok && b.ok() && b.raidParty ? b.raidParty() : null; party = p ? { inParty: !!p.inParty, names: new Set(p.names || []) } : { inParty: false, names: new Set() }; } catch (e) { /* keep the last roster */ }
    // Inside the Fortress (and raids) the game holds no lobby any more, but its HUD lists the party in the tooltips ("Name: 1,437 (52%)"): the party is whoever is listed there, plus you
    try {
      const hud = window.__ccDom.qa('.gauntlet-hud, .raid-contrib-hud').find((e) => e.getClientRects().length);   // the visible one (the other kind can sit hidden before it)
      if (hud) {
        party = { inParty: true, names: new Set(party.names) };
        hud.querySelectorAll('.tt-line').forEach((l) => { const m = /^(.+?):\s*[\d,]+\s*\(\d+%\)\s*$/.exec((l.textContent || '').trim()); if (m && m[1].toLowerCase() !== 'you') party.names.add(m[1].trim().toLowerCase()); });
        const w = window.__ccBridge && window.__ccBridge.whoami && window.__ccBridge.whoami(); if (w) { party.names.add(String(w.name).toLowerCase()); party.names.add(String(w.display).toLowerCase()); }
      }
    } catch (e) { /* no HUD */ }
    return party;
  }
  const channelOf = (ch, name) => (ch === 'proximity' && name && partyNow().names.has(String(name).toLowerCase()) ? 'raid' : ch);
  function parseNode(n) {
    const tsEl = n.querySelector('.chat-timestamp'), nameEl = n.querySelector('.chat-sender-name');
    const badges = Array.from(n.querySelectorAll('.chat-badge-slot img')).map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt') || '' }));
    const iconEl = n.querySelector(':scope > .chat-game-icon');
    const c = n.cloneNode(true);
    const wtEl = n.querySelector(':scope > .chat-world-tag');
    c.querySelectorAll('.chat-timestamp,.chat-badge-slot,.chat-world-tag,.chat-sender-name,.chat-game-icon,.tooltip').forEach((x) => x.remove());
    const nm0 = nameEl ? nameEl.textContent.trim() : '';
    const m = {
      ch: channelOf(n.dataset.channel || 'game', nm0), cat: n.dataset.category || '', col: n.style.color || '',
      ts: tsEl ? tsEl.textContent.replace(/[\[\]\s]/g, '') : '', name: nameEl ? nameEl.textContent.trim() : '', ncol: nameEl && nameEl.style.color ? nameEl.style.color : '',
      world: wtEl ? wtEl.textContent.trim() : '', badges, icon: iconEl ? iconEl.getAttribute('src') : '', text: c.textContent.replace(/^\s*:\s*/, '').trim(), t: Date.now(), live: true,
    };
    const mm = /^(\d{1,2}):(\d{2})$/.exec(m.ts);
    m.k = keyOf(m);
    m.mm = mm ? [parseInt(mm[1], 10), parseInt(mm[2], 10)] : null;
    return m;
  }
  function stamp(m, st) {
    let hh, mi, ss = null;
    if (m.live) { const d = new Date(m.t); hh = d.getHours(); mi = d.getMinutes(); ss = d.getSeconds(); }
    else if (m.mm) { hh = m.mm[0]; mi = m.mm[1]; } else return '';
    const p = (v) => String(v).padStart(2, '0');
    let hs = p(hh), suf = '';
    if (window.__ccUI && window.__ccUI.fmt.h12()) { suf = hh >= 12 ? ' pm' : ' am'; hs = String(hh % 12 || 12); }   // the global Clock Format setting
    return hs + ':' + p(mi) + (st === 'hms' && ss != null ? ':' + p(ss) : '') + suf;
  }

  let unreadCh = {}, unreadAll = 0, mentions = 0;
  const hlList = () => String(cfg.hl || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const muteList = () => String(cfg.mute || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const catOf = (m) => { const c = CAT_ALIAS[m.cat] || m.cat; return CATS.some((x) => x[0] === c) ? c : 'other'; };
  const isSL = (m) => !!(m.local || m.cat === 'scapelite');   // ScapeLite's own lines (the SL tag): the /sl replies. They follow the SL button, not a channel button.
  // Hidden message types: 'all channels' (hideCat) plus a set per channel (hideCatCh), like the game's own per-channel filter menus.
  const catHidden = (m) => { const c = catOf(m); return !!((cfg.hideCat && cfg.hideCat[c]) || (cfg.hideCatCh && cfg.hideCatCh[m.ch] && cfg.hideCatCh[m.ch][c])); };
  const isMuted = (m) => { if (m.local) return false; if (catHidden(m)) return true; const lo = (m.name + ' ' + m.text).toLowerCase(); return muteList().some((w) => lo.indexOf(w) >= 0); };
  const isMention = (m) => { if (m.ch === 'game' && !m.name) return false; const lo = m.text.toLowerCase(); return hlList().some((w) => lo.indexOf(w) >= 0); };
  const sel = () => new Set(cfg.sel || []);

  function addMsg(m, quiet) {
    msgs.push(m); logDirty = true;
    if (msgs.length > 1200) msgs.splice(0, msgs.length - 1000);
    if (quiet || isMuted(m)) return;   // quiet: a line read back from the game's list is history, not news (no unread badge)
    if (!sel().has(m.ch)) unreadCh[m.ch] = (unreadCh[m.ch] || 0) + 1;
    else if (!viewing()) { unreadAll++; }
    if (isMention(m) && !viewing()) mentions++;
  }
  function ingest(nodes, forceSeed) {
    const list = nodes.filter((n) => n && n.nodeType === 1 && n.classList && n.classList.contains('chat-message')).map(parseNode);
    if (!list.length) return;
    const have = {}; msgs.slice(-700).forEach((m) => { have[m.k] = (have[m.k] || 0) + 1; });
    let seed = !!forceSeed;
    if (!seed && list.length >= 3 && list.filter((m) => have[m.k]).length >= list.length / 2) seed = true;
    const used = {}; let backfilled = false;
    list.forEach((m) => {
      if (seed) { used[m.k] = (used[m.k] || 0) + 1; if (used[m.k] <= (have[m.k] || 0)) return; m.live = false; if (m.mm) { const d = new Date(); d.setHours(m.mm[0], m.mm[1], 0, 0); if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1); m.t = d.getTime(); } }
      addMsg(m, seed); if (seed) backfilled = true;
    });
    // Lines the game still lists but this log no longer had (older than the 400 kept, or after a clear) were appended at the end: put them back where their time says (stable, so equal minutes keep their order).
    if (backfilled && msgs.every((x) => typeof x.t === 'number')) msgs = msgs.map((x, i) => [x, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map((x) => x[0]);
    schedule();
  }

  // ---------------------------------------------------------------- watching the game's list
  let area = null, obs = null;
  function attach() {
    const a = window.__ccDom.q('.chat-panel .chat-message-area');
    if (a === area) return;
    if (obs) obs.disconnect();
    area = a; if (!a) return;
    ingest(Array.from(a.children), true);
    obs = new MutationObserver((recs) => { const nodes = []; recs.forEach((r) => r.addedNodes.forEach((n) => nodes.push(n))); if (nodes.length) ingest(nodes, false); });
    obs.observe(a, { childList: true });
  }
  let chCol = Object.assign({}, FALLBACK);
  const gameFilters = {};
  // The game renames some channels as things change (Nearby becomes Raid inside a raid group): tabs and the send button show the game's own current names.
  const chLab = {};
  let lastParty = false;
  const labOf = (id) => chLab[id] || (CHANNELS.find((c) => c[0] === id) || [0, id])[1];
  function readGame() {
    let renamed = false;
    CHANNELS.forEach(([id]) => {
      const b = window.__ccDom.q('.chat-filter-btn[data-chat-filter="' + (id === 'raid' ? 'proximity' : id) + '"]');
      if (b) {
        if (b.style.color && id !== 'raid') chCol[id] = b.style.color; gameFilters[id] = b.classList.contains('active');
        if (id !== 'global' && id !== 'raid' && id !== 'proximity') { const l = b.querySelector('.chat-filter-label'), t = l ? l.textContent.trim() : ''; if (t && chLab[id] !== t) { chLab[id] = t; renamed = true; } }   // the Global tab keeps its name; its room shows in the tooltip
      }
    });
    const inP = partyNow().inParty; if (inP !== lastParty) { lastParty = inP; renamed = true; }   // the Raid tab and send entry follow the party
    if (renamed) { try { renderTabs(); syncSendCh(); } catch (e) { /* panel not built yet */ } }
    const gl = window.__ccDom.q('.chat-filter-btn[data-chat-filter="global"] .chat-filter-label'); roomLabel = gl ? gl.textContent.trim() : '';
  }
  let roomLabel = '';
  const bridge = () => window.__ccBridge || null;

  // ---------------------------------------------------------------- panel
  const style = document.createElement('style'); style.id = 'cc-chat-style';
  style.textContent = `
#cc-chat .bd{padding:0;gap:0;overflow:hidden}
#cc-chat{--ccc-fs:14px;--ccc-gap:3px;--ccc-bg:var(--cc-bg,#10101a)}
#cc-chat.show{background:color-mix(in srgb,var(--ccc-bg) var(--ccc-op,96%),transparent)}
#cc-chat .hd{padding:6px 10px}
#cc-chat .hd .gb{font-size:14px;opacity:.8}
#cc-chat .tabs{display:flex;align-items:center;gap:4px;padding:6px 8px 4px;flex-wrap:wrap}
#cc-chat .tab{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;border:1px solid var(--cc-border,#2e2e42);background:transparent;color:var(--cc-text-dim,#8f8fa4);font:600 11.5px/1.5 var(--cc-font,system-ui);cursor:pointer}
#cc-chat .tab:hover{background:var(--cc-bg-hover,#262636)}
#cc-chat .tab.on{color:var(--tc,#fff);border-color:var(--tc,#fff);background:color-mix(in srgb,var(--tc,#fff) 14%,transparent)}
#cc-chat .tab.off:not(.on){opacity:.55;border-style:dashed}
#cc-chat .tab i{font-style:normal;min-width:15px;padding:0 4px;border-radius:999px;background:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#241a00);font-size:10.5px;text-align:center}
#cc-chat .sp{flex:1}
#cc-chat .ib{background:none;border:0;color:var(--cc-text-dim,#8f8fa4);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:6px}
#cc-chat .ib:hover,#cc-chat .ib.on{background:var(--cc-bg-hover,#262636);color:#fff}
#cc-chat .find{display:none;margin:0 8px 4px}
#cc-chat .find.show{display:block}
#cc-chat .find input,#cc-chat .cmp input{width:100%;box-sizing:border-box;background:var(--cc-bg-2,#161620);border:1px solid var(--cc-border,#2e2e42);border-radius:8px;color:var(--cc-text,#dcdce8);font:var(--cc-fs-sm,12.5px)/1.3 var(--cc-font,system-ui);padding:5px 9px;outline:none}
#cc-chat .find input:focus,#cc-chat .cmp input:focus{border-color:var(--cc-accent,#ffd24a)}
#cc-chat .wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
#cc-chat .list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 10px 6px;font-size:var(--ccc-fs);line-height:1.35}
#cc-chat .list::-webkit-scrollbar{width:7px}
#cc-chat .list::-webkit-scrollbar-thumb{background:var(--cc-border,#2e2e42);border-radius:4px}
#cc-chat .cm{padding:var(--ccc-gap) 0 var(--ccc-gap) 8px;margin-left:-8px;border-left:2px solid transparent;word-break:break-word;color:var(--cc-text,#dcdce8)}
#cc-chat .cm.hl{border-left-color:var(--cc-accent,#ffd24a);background:color-mix(in srgb,var(--cc-accent,#ffd24a) 9%,transparent)}
#cc-chat .cm.loc{border-left-color:var(--cc-accent,#ffd24a);color:var(--cc-text-dim,#b4b4c8);white-space:pre-wrap}
#cc-chat .cm .sl{display:inline-block;font-size:.72em;font-weight:800;letter-spacing:.04em;margin-right:6px;padding:0 4px;border-radius:3px;background:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#10101a)}
#cc-chat.nowrap .cm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-chat .cm .ts{color:var(--cc-text-faint,#707086);font-size:.82em;margin-right:6px;font-variant-numeric:tabular-nums}
#cc-chat .cm .tg{font-size:.82em;font-weight:700;margin-right:5px;opacity:.9}
#cc-chat .cm .wt{font-size:.78em;font-weight:700;margin-right:4px;padding:0 4px;border-radius:4px;background:var(--cc-bg-3,#1c1c28);color:var(--cc-text-dim,#8f8fa4);vertical-align:.08em}
#cc-chat .cm .bg{width:1.15em;height:1.15em;vertical-align:-.2em;margin-right:3px;image-rendering:pixelated}
#cc-chat .cm .ic{width:1.25em;height:1.25em;vertical-align:-.28em;margin:0 3px 0 0;image-rendering:pixelated}
#cc-chat .cm .nm{font-weight:700}
#cc-chat .cm .ct{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:var(--cc-bg-3,#1c1c28);color:var(--cc-text-dim,#8f8fa4);font-size:.8em}
#cc-chat .cm mark{background:color-mix(in srgb,var(--cc-accent,#ffd24a) 40%,transparent);color:inherit;border-radius:3px;padding:0 1px}
#cc-chat .empty{color:var(--cc-text-faint,#707086);text-align:center;padding:26px 0;font-size:var(--cc-fs-sm,12.5px)}
#cc-chat .jump{position:absolute;right:14px;bottom:8px;display:none;padding:3px 11px;border-radius:999px;border:0;background:var(--cc-accent,#ffd24a);color:var(--cc-accent-ink,#241a00);font:700 11.5px/1.5 var(--cc-font,system-ui);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5)}
#cc-chat .jump.show{display:block}
#cc-chat .cmp{display:flex;align-items:center;gap:6px;padding:6px 8px 8px;border-top:1px solid var(--cc-border,#2e2e42)}
#cc-chat .cmp .cl{flex:none;border:0;background:var(--cc-bg-2,#161620);border-radius:8px;padding:5px 9px;font:700 12px/1.3 var(--cc-font,system-ui);cursor:pointer;color:var(--cc-text,#fff)}
#cc-chat .cmp .cl:hover{background:var(--cc-bg-hover,#262636)}
#cc-chat .cmp .cn{flex:none;font-size:11px;color:var(--cc-text-faint,#707086);min-width:26px;text-align:right}
#cc-chat .cmp .er{color:var(--cc-bad,#ff8a5c);font-size:11.5px}
#cc-chat .set{position:absolute;inset:0;z-index:3;display:none;flex-direction:column;background:var(--cc-bg,#10101a)}
#cc-chat .set.show{display:flex}
#cc-chat .set .sh{display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid var(--cc-border,#2e2e42);font-weight:700;color:var(--cc-accent,#ffd24a)}
#cc-chat .set .sb{flex:1;min-height:0;overflow-y:auto;padding:4px 12px 12px}
#cc-chat .set h6{margin:12px 0 4px;font:700 10.5px/1.2 var(--cc-font,system-ui);letter-spacing:.07em;text-transform:uppercase;color:var(--cc-text-faint,#707086)}
#cc-chat .set .r{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:var(--cc-fs-sm,12.5px)}
#cc-chat .set .r>span{flex:1;color:var(--cc-text,#dcdce8)}
#cc-chat .set .r input[type=range]{width:150px;accent-color:var(--cc-accent,#ffd24a)}
#cc-chat .set .r input[type=text],#cc-chat .set .r select{width:190px;background:var(--cc-bg-2,#161620);border:1px solid var(--cc-border,#2e2e42);border-radius:7px;color:var(--cc-text,#dcdce8);padding:4px 7px;font:inherit}
#cc-chat .set .r input[type=checkbox]{accent-color:var(--cc-accent,#ffd24a);width:15px;height:15px}
#cc-chat .set .r em{font-style:normal;color:var(--cc-text-dim,#8f8fa4);min-width:38px;text-align:right;font-size:11.5px}
#cc-chat .set .bt{border:1px solid var(--cc-border,#2e2e42);background:var(--cc-bg-2,#161620);color:var(--cc-text,#dcdce8);border-radius:7px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12px}
#cc-chat .set .bt:hover{background:var(--cc-bg-hover,#262636)}
`;
  document.head.appendChild(style);
  const hideStyle = document.createElement('style'); hideStyle.id = 'cc-chat-hide'; document.head.appendChild(hideStyle);

  const P = UI.panel({ id: 'cc-chat', title: 'Chat', collapsible: true, closable: true, resizable: true, chipAlways: false, width: cfg.width, height: 330,
    pos: { x: 54, y: Math.max(70, (window.__ccVH ? window.__ccVH() : (window.innerHeight || 900)) - 460) } });
  const el = P.el, body = P.body;
  const gear = h('button', 'gb', '⚙', { type: 'button', title: 'Chat settings', 'aria-label': 'Chat settings' });
  P.head.insertBefore(gear, P.head.querySelector('.min'));

  const tabsEl = h('div', 'tabs');
  const findWrap = h('div', 'find'), findIn = h('input', null, null, { type: 'text', placeholder: 'Search the chat', 'aria-label': 'Search the chat' }); findWrap.appendChild(findIn);
  const wrapEl = h('div', 'wrap'), listEl = h('div', 'list'), jump = h('button', 'jump', '', { type: 'button' });
  const setEl = h('div', 'set');
  wrapEl.append(listEl, jump, setEl);
  const cmp = h('div', 'cmp'), chBtn = h('button', 'cl', '', { type: 'button', title: 'Channel your message goes to (click to change)' });
  const inp = h('input', null, null, { type: 'text', maxlength: '200', placeholder: 'Type a message', 'aria-label': 'Message' });
  const cnt = h('span', 'cn');
  // Chat language / room: the game's own picker lives inside its hidden chat panel, so its menu is opened there for a moment, its rows are copied into one of ours, and the row
  // you pick is clicked in the game's menu. Only your click on a row changes anything, and it is the game's own control that does it.
  const rmBtn = h('button', 'cl', '', { type: 'button', title: 'Chat language and world (the game’s own list)' });
  const pillOn = () => { try { const ps = window.__ccPluginSettings; return !(ps && ps.get('chatRoomPicker') === false); } catch (e) { return true; } };
  function syncRoom() { const l = document.querySelector('.chat-panel .chat-room-pill-label'), on = !!l && pillOn(); rmBtn.style.display = on ? '' : 'none'; if (on && rmBtn.textContent !== l.textContent.trim()) rmBtn.textContent = l.textContent.trim(); }
  rmBtn.addEventListener('click', (ev) => {
    ev.stopPropagation(); const pill = document.querySelector('.chat-panel .chat-room-pill'); if (!pill || !window.__ccUI || !window.__ccUI.menu) return;
    const scrl = () => document.querySelector('.chat-panel .chat-room-menu-scroll');
    if (!scrl()) pill.click();
    const nodes = scrl() ? Array.from(scrl().children) : []; if (!nodes.length) return;
    const items = nodes.map((n, i) => (n.classList.contains('chat-room-menu-header') ? { head: n.textContent.trim() } : { label: (n.querySelector('.chat-room-name') || n).textContent.trim() + ' · ' + ((n.querySelector('.chat-room-code') || {}).textContent || ''), checked: n.classList.contains('selected'), onClick: () => {
      let sc = scrl(); if (!sc) { pill.click(); sc = scrl(); }
      const t = sc && Array.from(sc.children)[i]; if (t) t.click();
      if (document.querySelector('.chat-panel .chat-room-menu')) pill.click();   // leave the game's list closed
      setTimeout(() => { syncRoom(); readGame(); }, 400); } }));
    if (document.querySelector('.chat-panel .chat-room-menu')) pill.click();   // closed again at once: the copy below is what you see
    const r = rmBtn.getBoundingClientRect(); window.__ccUI.menu(items, r.left, r.top - 4, { up: true });
  });
  cmp.append(chBtn, inp, cnt, rmBtn);
  body.append(tabsEl, findWrap, wrapEl, cmp);

  let hiddenSL = 0;   // /sl replies that arrived while the SL button was off
  let query = '', stuck = true, pending = 0, sendCh = null, hist = [], hi = -1, err = '';
  const viewing = () => P.isShown() && !P.collapsed() && stuck;
  const col = (id) => chCol[id] || FALLBACK[id] || '#fff';
  const esc = (s) => String(s);

  function visible() {
    const s = sel(), q = query.toLowerCase();
    const out = [];
    for (let i = msgs.length - 1; i >= 0 && out.length < Math.min(1000, cfg.keep || 300); i--) {
      const m = msgs[i];
      if (isSL(m)) { if (cfg.showSL === false) continue; }   // ScapeLite's own lines show on every channel tab; only the SL button hides them
      else if (!s.has(m.ch) || isMuted(m)) continue;
      if (q && (m.name + ' ' + m.text).toLowerCase().indexOf(q) < 0) continue;
      out.push(m);
    }
    out.reverse();
    if (!cfg.merge) return out.map((m) => ({ m, n: 1 }));
    const g = [];
    out.forEach((m) => { const l = g[g.length - 1]; if (l && !m.local && !l.m.local && l.m.ch === m.ch && l.m.name === m.name && l.m.text === m.text) { l.n++; l.m = m; } else g.push({ m, n: 1 }); });
    return g;
  }
  function textNodes(parent, text) {
    const words = hlList(), q = query.toLowerCase(), keys = words.concat(q ? [q] : []);
    const marked = (par, t) => {   // plain text with the highlight words and the search marked
      if (!keys.length) { par.appendChild(document.createTextNode(t)); return; }
      const lo = t.toLowerCase(), marks = [];
      keys.forEach((k) => { let i = 0; while ((i = lo.indexOf(k, i)) >= 0) { marks.push([i, i + k.length]); i += k.length; } });
      marks.sort((a, b) => a[0] - b[0]);
      let at = 0;
      marks.forEach(([a, b]) => { if (a < at) return; if (a > at) par.appendChild(document.createTextNode(t.slice(at, a))); par.appendChild(h('mark', null, t.slice(a, b))); at = b; });
      if (at < t.length) par.appendChild(document.createTextNode(t.slice(at)));
    };
    if (opt('chatLinks', true) !== false && UI.linkify) UI.linkify(parent, text, marked); else marked(parent, text);
  }
  // Right-click a name: the game's own player menu (message, mute, add friend, invite ...). The game builds it inside the contextmenu handler of its own chat line, so the
  // same right-click goes to the matching original line (hidden but still in the list); a name with no line left falls back to the original Friends / Clan / Muted row.
  function playerMenu(name, ev) {
    let on = true; try { const ps = window.__ccPluginSettings; if (ps && ps.get('uiPlayerMenu') === false) on = false; } catch (e) { /* default on */ }
    if (!on || !name) return;
    ev.preventDefault(); ev.stopPropagation();
    const x = ev.clientX, y = ev.clientY, line = Array.from(document.querySelectorAll('.chat-panel .chat-message-area .chat-message')).reverse().find((n) => { const e = n.querySelector('.chat-sender-name'); return e && !n.dataset.category && e.textContent.trim() === name; });   // event lines (level ups, unlocks ...) name a player but the game gives them no menu
    if (line) { setTimeout(() => { try { line.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); } catch (e) { /* line gone */ } }, 90); return; }
    let kind = null; try { const so = bridge().social(); if (so) kind = so.friends.some((p) => p.name === name) ? 'friends' : so.clan.members.some((p) => p.name === name) ? 'clan' : so.muted.some((p) => p.name === name) ? 'muted' : null; } catch (e) { /* no bridge */ }
    try { if (!(window.__ccBar && window.__ccBar.playerMenu && window.__ccBar.playerMenu(name, kind, x, y))) say('That player’s line is gone from the game chat; use the game’s Friends list.'); } catch (e) { /* ignore */ }
  }
  function row(g) {
    const m = g.m, r = h('div', 'cm' + (isMention(m) ? ' hl' : '') + (m.local ? ' loc' : '')); r.dataset.ch = m.ch;
    const tint = m.ch === 'raid' ? col('raid') : (m.col || col(m.ch));   // party chat has its own colour (the game colours it like everyone nearby)
    if (cfg.stamp !== 'off') { const s = stamp(m, cfg.stamp); if (s) r.appendChild(h('span', 'ts', s)); }
    if (m.local) r.appendChild(h('span', 'sl', 'SL', { title: 'Only you see this line. It was not sent to chat.' }));
    else if (cfg.tags) { const t = h('span', 'tg', '[' + labOf(m.ch) + ']'); t.style.color = col(m.ch); r.appendChild(t); }
    if (m.world && opt('chatWorldTag', true) !== false) { const w = h('span', 'wt', m.world, { title: 'World ' + m.world.replace(/^W/i, '') }); r.appendChild(w); }
    if (cfg.badges) m.badges.forEach((b) => { if (b.src) { const i = h('img', 'bg'); i.src = b.src; i.alt = b.alt; i.title = b.alt; r.appendChild(i); } });
    if (m.name) { const n = h('span', 'nm', m.name); n.style.color = cfg.colourNames ? (m.ncol || tint) : ''; n.addEventListener('contextmenu', (ev) => playerMenu(m.name, ev)); r.appendChild(n); r.appendChild(document.createTextNode(': ')); }
    if (cfg.icons && m.icon) { const i = h('img', 'ic'); i.src = m.icon; i.alt = ''; r.appendChild(i); }
    const tx = h('span', 'tx'); tx.style.color = m.local || (m.name && cfg.colourNames) ? '' : tint; textNodes(tx, m.text); r.appendChild(tx);
    if (g.n > 1) r.appendChild(h('span', 'ct', '×' + g.n));
    if (!cfg.wrap) r.title = (m.name ? m.name + ': ' : '') + m.text;
    return r;
  }
  function renderTabs() {
    const s = sel(); tabsEl.textContent = '';
    const hasRaid = partyNow().inParty || msgs.some((m) => m.ch === 'raid');
    CHANNELS.forEach(([id]) => {
      if (id === 'raid' && !hasRaid) return;
      const lab = labOf(id), b = h('button', 'tab' + (s.has(id) ? ' on' : '') + (gameFilters[id] === false ? ' off' : ''), lab, { type: 'button' });
      b.style.setProperty('--tc', col(id));
      b.title = gameFilters[id] === false ? lab + ': the game’s own chat filter has this channel switched off, so nothing arrives. Turn it on in the game chat’s filter bar.' : 'Show or hide ' + lab + ' messages. Double-click to show only this one.';
      if (unreadCh[id] && !s.has(id)) b.appendChild(h('i', null, unreadCh[id] > 99 ? '99+' : String(unreadCh[id])));
      b.addEventListener('click', () => { const n = sel(); if (n.has(id)) n.delete(id); else { n.add(id); delete unreadCh[id]; } cfg.sel = Array.from(n); saveCfg(); render(true); });
      b.addEventListener('dblclick', () => { cfg.sel = [id]; delete unreadCh[id]; saveCfg(); render(true); });
      tabsEl.appendChild(b);
    });
    const slOn = cfg.showSL !== false, slb = h('button', 'tab sltab' + (slOn ? ' on' : ''), 'SL', { type: 'button' });
    slb.style.setProperty('--tc', 'var(--cc-accent,#ffd24a)');
    slb.title = 'Show or hide ScapeLite’s own lines (the replies to /sl commands). Only you see them.';
    if (!slOn && hiddenSL) slb.appendChild(h('i', null, hiddenSL > 99 ? '99+' : String(hiddenSL)));
    slb.addEventListener('click', () => { cfg.showSL = !slOn; if (cfg.showSL) hiddenSL = 0; saveCfg(); render(true); });
    tabsEl.appendChild(slb);
    tabsEl.appendChild(h('span', 'sp'));
    const f = h('button', 'ib' + (findWrap.classList.contains('show') ? ' on' : ''), '🔍', { type: 'button', title: 'Search the chat' });
    f.addEventListener('click', () => { findWrap.classList.toggle('show'); if (findWrap.classList.contains('show')) findIn.focus(); else { query = ''; findIn.value = ''; render(true); } renderTabs(); });
    tabsEl.appendChild(f);
  }
  let raf = 0;
  function schedule() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(false); }); }
  function render(tabs) {
    if (tabs) renderTabs();
    const near = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 28;
    if (!P.isShown() || P.collapsed()) { updateChip(); return; }
    const keep = listEl.scrollTop, g = visible();
    listEl.textContent = '';
    if (!g.length) listEl.appendChild(h('div', 'empty', query ? 'Nothing matches your search.' : 'No messages yet.'));
    const fr = document.createDocumentFragment(); g.forEach((x) => fr.appendChild(row(x))); listEl.appendChild(fr);
    if (near || stuck) { listEl.scrollTop = listEl.scrollHeight; stuck = true; unreadAll = 0; mentions = 0; } else listEl.scrollTop = keep;
    pending = stuck ? 0 : pending;
    jump.classList.toggle('show', !stuck); jump.textContent = '↓ ' + (unreadAll ? unreadAll + ' new' : 'Latest');
    renderTabs();
    updateChip();
    if (typeof dmName === 'string' && dmName) { chBtn.textContent = '[' + dmName + ']'; chBtn.style.color = col('friends'); }
    else { chBtn.textContent = '[' + labOf(sendCh || '?') + ']'; chBtn.style.color = col(sendCh); }
  }
  function updateChip() {
    const n = unreadAll;
    P.setChip(n ? n + ' new' + (mentions ? ' · ' + mentions + ' @' : '') : '');
  }
  listEl.addEventListener('scroll', () => { const was = stuck; stuck = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 28; if (stuck && !was) { unreadAll = 0; mentions = 0; jump.classList.remove('show'); updateChip(); } else if (!stuck && was) jump.classList.add('show'); });
  jump.addEventListener('click', () => { stuck = true; unreadAll = 0; mentions = 0; render(false); });
  findIn.addEventListener('input', () => { query = findIn.value.trim(); render(false); });

  // ---------------------------------------------------------------- looks
  function applyLook() {
    el.style.setProperty('--ccc-fs', cfg.font + 'px');
    el.style.setProperty('--ccc-gap', cfg.space === 'compact' ? '1px' : cfg.space === 'roomy' ? '5px' : '2.5px');
    el.style.setProperty('--ccc-op', cfg.opacity + '%');
    el.classList.toggle('nowrap', !cfg.wrap);
    cmp.style.display = cfg.input ? '' : 'none';
    hideStyle.textContent = cfg.hideGame ? '#ui-container :has(> .panel-titlebar[data-panel-id="chat"]){display:none !important}' : '';
  }

  // ---------------------------------------------------------------- settings
  let catScope = 'all';   // which set the 'Hide message types' list edits: all channels or one channel
  function openSettings() {
    setEl.textContent = '';
    const hd = h('div', 'sh'); hd.appendChild(h('span', null, 'Chat settings')); hd.appendChild(h('span', 'sp'));
    const done = h('button', 'bt', 'Done', { type: 'button' }); done.addEventListener('click', () => setEl.classList.remove('show')); hd.appendChild(done);
    const sb = h('div', 'sb');
    const put = (k, v) => { cfg[k] = v; saveCfg(); };
    const sec = (t) => sb.appendChild(h('h6', null, t));
    const toggle = (k, lab, after) => { const r = h('label', 'r'); r.appendChild(h('span', null, lab)); const c = h('input', null, null, { type: 'checkbox' }); c.checked = !!cfg[k]; c.addEventListener('change', () => { put(k, c.checked); applyLook(); if (after) after(); render(true); }); r.appendChild(c); sb.appendChild(r); };
    const slider = (k, lab, min, max, step, unit, after) => { const r = h('label', 'r'); r.appendChild(h('span', null, lab)); const s = h('input', null, null, { type: 'range', min: String(min), max: String(max), step: String(step) }); s.value = cfg[k]; const v = h('em', null, cfg[k] + unit); s.addEventListener('input', () => { put(k, Number(s.value)); v.textContent = s.value + unit; applyLook(); if (after) after(); render(false); }); r.append(s, v); sb.appendChild(r); };
    const select = (k, lab, opts) => { const r = h('label', 'r'); r.appendChild(h('span', null, lab)); const s = h('select'); opts.forEach(([v, t]) => { const o = h('option', null, t); o.value = v; s.appendChild(o); }); s.value = String(cfg[k]); s.addEventListener('change', () => { const raw = s.value; put(k, /^\d+$/.test(raw) ? Number(raw) : raw); applyLook(); render(true); }); r.appendChild(s); sb.appendChild(r); };
    const text = (k, lab, ph) => { const r = h('label', 'r'); r.appendChild(h('span', null, lab)); const t = h('input', null, null, { type: 'text', placeholder: ph }); t.value = cfg[k] || ''; t.addEventListener('input', () => { put(k, t.value); render(false); }); r.appendChild(t); sb.appendChild(r); };
    sec('Size and look');
    slider('width', 'Width', 300, 1000, 10, ' px', () => { el.style.width = cfg.width + 'px'; });
    slider('font', 'Text size', 10, 22, 1, ' px');
    select('space', 'Line spacing', [['compact', 'Tight'], ['normal', 'Normal'], ['roomy', 'Airy']]);
    slider('opacity', 'Background', 40, 100, 2, '%');
    toggle('wrap', 'Wrap long messages (off: one line each, hover to read)');
    sec('Messages');
    select('stamp', 'Timestamps', [['off', 'Off'], ['hm', '12:34'], ['hms', '12:34:56']]);
    toggle('tags', 'Show [Clan] / [Game] channel tags');
    toggle('badges', 'Show player badges (crowns, pets)');
    toggle('icons', 'Show item icons');
    toggle('colourNames', 'Colour names and text by channel');
    toggle('merge', 'Merge repeated messages (×3)');
    select('keep', 'Messages on screen', [['100', '100'], ['300', '300'], ['600', '600'], ['1000', '1000']]);
    sec('Words');
    text('hl', 'Highlight words', 'name, trade, ...');
    text('mute', 'Hide messages containing', 'word, word');
    sec('Hide message types');
    { const r = h('label', 'r'); r.appendChild(h('span', null, 'Applies to')); const sc = h('select'); [['all', 'All channels']].concat(CHANNELS.map(([id]) => [id, labOf(id) + ' only'])).forEach(([v, t]) => { const o = h('option', null, t); o.value = v; sc.appendChild(o); }); sc.value = catScope;
      sc.addEventListener('change', () => { catScope = sc.value; const top = setEl.querySelector('.sb'); const y = top ? top.scrollTop : 0; openSettings(); const nb = setEl.querySelector('.sb'); if (nb) nb.scrollTop = y; }); r.appendChild(sc); sb.appendChild(r); }
    const scoped = () => (catScope === 'all' ? (cfg.hideCat || {}) : ((cfg.hideCatCh || {})[catScope] || {}));
    CATS.forEach(([id, lab]) => { const r = h('label', 'r'); r.appendChild(h('span', null, lab)); const c = h('input', null, null, { type: 'checkbox' }); c.checked = !!scoped()[id]; if (catScope !== 'all' && cfg.hideCat && cfg.hideCat[id]) { c.checked = true; c.disabled = true; r.title = 'Hidden on every channel (set under All channels)'; }
      c.addEventListener('change', () => { if (catScope === 'all') cfg.hideCat = Object.assign({}, cfg.hideCat, { [id]: c.checked }); else cfg.hideCatCh = Object.assign({}, cfg.hideCatCh, { [catScope]: Object.assign({}, (cfg.hideCatCh || {})[catScope], { [id]: c.checked }) }); saveCfg(); render(true); }); r.appendChild(c); sb.appendChild(r); });
    sec('Panel');
    toggle('input', 'Message box (off: read only)');
    toggle('hideGame', 'Hide the game’s own chat window');
    const r2 = h('div', 'r'); const clr = h('button', 'bt', 'Clear history', { type: 'button' }); clr.addEventListener('click', () => { msgs = []; unreadCh = {}; unreadAll = 0; mentions = 0; logDirty = true; saveLog(); render(true); });
    const rst = h('button', 'bt', 'Reset settings', { type: 'button' }); rst.addEventListener('click', () => { cfg = Object.assign({}, DEF); saveCfg(); el.style.width = cfg.width + 'px'; applyLook(); openSettings(); render(true); });
    r2.append(clr, rst); sb.appendChild(r2);
    setEl.append(hd, sb); setEl.classList.add('show');
  }
  gear.addEventListener('click', () => { if (setEl.classList.contains('show')) setEl.classList.remove('show'); else openSettings(); });

  // ---------------------------------------------------------------- sending (hands your text to the game's own chat input)
  // Raid goes out on the game's proximity channel (that IS its raid party chat while you are in a party), so both entries are offered while you are in one
  function sendChannels() {
    let l; try { const b = bridge(), c = b && b.chat && b.chat(); l = (c && c.send) || ['global', 'proximity', 'friends', 'clan']; } catch (e) { l = ['global', 'proximity', 'friends', 'clan']; }
    l = l.slice(); if (partyNow().inParty && l.includes('proximity') && !l.includes('raid')) l.splice(l.indexOf('proximity') + 1, 0, 'raid');
    return l;
  }
  const gameCh = (ch) => (ch === 'raid' ? 'proximity' : ch);
  // a private message (right-click a friend > Message in the game): the game keeps a target name; the channel button then shows [Name], and the text goes to that player
  let dmName = '';
  function syncSendCh() { const b = bridge(); dmName = ''; try { const c = b && b.chat && b.chat(); if (c && c.dm && c.dmName) dmName = c.dmName; else if (c && c.active && !c.dm) { if (c.active === 'proximity') { if (sendCh !== 'raid' && sendCh !== 'proximity') sendCh = partyNow().inParty ? 'raid' : 'proximity'; else if (sendCh === 'raid' && !partyNow().inParty) sendCh = 'proximity'; } else sendCh = c.active; } } catch (e) { /* not ready */ }
    if (dmName) { chBtn.textContent = '[' + dmName + ']'; chBtn.style.color = col('friends'); chBtn.title = 'Private message to ' + dmName + ' (click to go back to a channel)'; cmp.style.display = ''; inp.placeholder = 'Message ' + dmName; return; }
    chBtn.title = 'Channel your message goes to (click to change)'; inp.placeholder = ''; cmp.style.display = cfg.input ? '' : 'none';
    if (!sendCh) sendCh = 'proximity'; chBtn.textContent = '[' + labOf(sendCh) + ']'; chBtn.style.color = col(sendCh); }
  chBtn.addEventListener('click', () => { if (dmName) { const b0 = bridge(); try { b0 && b0.setChatChannel && b0.setChatChannel(gameCh(sendCh || 'proximity')); } catch (e) { /* ignore */ } syncSendCh(); inp.focus(); return; } const l = sendChannels(), i = l.indexOf(sendCh); chooseCh(l[(i + 1) % l.length]); });
  function chooseCh(ch) { sendCh = ch; const b = bridge(); try { b && b.setChatChannel && b.setChatChannel(gameCh(ch)); } catch (e) { /* ignore */ } syncSendCh(); inp.focus(); }
  // Hovering the channel button opens a list of the channels you can send to (Raid and Nearby are both offered while you are in a raid party)
  let chMenu = null, chMenuT = 0;
  const closeChMenu = () => { clearTimeout(chMenuT); if (chMenu) { try { window.__ccUI.closeMenu(); } catch (e) { /* kit gone */ } chMenu = null; } };
  const schedChMenu = () => { clearTimeout(chMenuT); chMenuT = setTimeout(() => { if (chMenu && chMenu.isConnected && chMenu.matches(':hover')) return; closeChMenu(); }, 250); };
  function openChMenu() {
    clearTimeout(chMenuT); if (chMenu && chMenu.isConnected) return; chMenu = null;
    const UI = window.__ccUI; if (!UI || !UI.menu) return;
    const r = chBtn.getBoundingClientRect(), cur = dmName ? null : sendCh;
    chMenu = UI.menu([{ head: 'Send to' }].concat(sendChannels().map((ch) => ({ label: labOf(ch), color: col(ch), checked: ch === cur, onClick: () => { closeChMenu(); chooseCh(ch); } }))), r.left, r.top - 4, { up: true });
    if (chMenu) { chMenu.addEventListener('mouseenter', () => clearTimeout(chMenuT)); chMenu.addEventListener('mouseleave', schedChMenu); }
  }
  chBtn.addEventListener('mouseenter', openChMenu); chBtn.addEventListener('mouseleave', schedChMenu);
  function say(txt) { err = txt; cnt.textContent = ''; if (txt) { cnt.replaceChildren(h('span', 'er', txt)); setTimeout(() => { if (err === txt) { err = ''; cnt.textContent = ''; } }, 3500); } }
  function send(text) {
    const gi = document.querySelector('.chat-panel .chat-input');
    if (!gi) { say('The game chat is not ready.'); return; }
    const b = bridge(); try { if (!dmName && b && b.setChatChannel && sendCh) b.setChatChannel(gameCh(sendCh)); } catch (e) { /* keep the game's channel */ }   // a private message keeps its target: choosing a channel would cancel it
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(gi, text); gi.dispatchEvent(new Event('input', { bubbles: true }));
    const key = (type) => gi.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    key('keydown');
    setTimeout(() => {
      // the game's own gate: before the chat rules are accepted, Enter opens its Chat Rules dialog instead of sending. The dialog is the game's; your text stays here until you have accepted it and press Enter again.
      if (opt('chatRulesFocus', true) !== false && gi.value === text && document.querySelector('.chat-rules-overlay')) { setter.call(gi, ''); gi.dispatchEvent(new Event('input', { bubbles: true })); say('Accept the game’s chat rules, then press Enter again.'); return; }
      if (gi.value !== text) { inp.value = ''; return; }
      key('keypress'); key('keyup');
      setTimeout(() => { if (gi.value === text) {
          setter.call(gi, ''); gi.dispatchEvent(new Event('input', { bubbles: true }));
          // your own keypress, forwarded: put the focus in the game's own message box (its focus handler is what shows the rules dialog), so you can finish there
          if (opt('chatRulesFocus', true) !== false) { try { gi.focus(); } catch (e) { /* hidden box */ } }
          say(document.querySelector('.chat-rules-overlay') ? 'Accept the game’s chat rules, then press Enter again.' : 'Could not send. Type it in the game chat.');
        } else inp.value = ''; }, 250);
    }, 250);
    hist.unshift(text); hist = hist.slice(0, 30); hi = -1;
  }
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const t = inp.value.trim();
      if (t) {
        // /sl ... is ScapeLite's own command (overlay/chat-commands.js): answered here with a line only you see, and never handed to the game, so it can not reach the server.
        const cmd = window.__ccCmd; let ours = false;
        try { ours = !!(cmd && cmd.match(t)); if (ours) cmd.handle(t, { source: 'chat-plus' }); } catch (er) { /* it was ours: still not sent */ }
        if (ours) { hist.unshift(t); hist = hist.slice(0, 30); hi = -1; inp.value = ''; } else send(t);
      }
      e.preventDefault();
    }
    else if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hist.length - 1, hi + 1); inp.value = hist[hi]; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hi = Math.max(-1, hi - 1); inp.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    else if (e.key === 'Escape') { inp.blur(); }
    else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && opt('chatTabCycle', true) !== false) {   // like the game's box: Tab steps to the next channel you can send to
      e.preventDefault(); e.stopPropagation(); if (dmName) { chBtn.click(); return; } const l = sendChannels(), i = l.indexOf(sendCh); chooseCh(l[(i + 1) % l.length]);
    }
  });
  inp.addEventListener('input', () => { const n = inp.value.length; if (!err) cnt.textContent = n > 140 ? String(200 - n) : ''; });

  // ---------------------------------------------------------------- run
  P.onOpenChange((v) => { if (v) { stuck = true; unreadAll = 0; mentions = 0; syncSendCh(); render(true); } });
  new MutationObserver(() => render(false)).observe(el, { attributes: true, attributeFilter: ['class'] });
  applyLook(); readGame(); attach(); syncSendCh(); renderTabs();
  const t1 = setInterval(() => { try { syncRoom(); readGame(); attach(); saveLog(); } catch (e) { /* keep going */ } }, 1500);
  const t2 = setInterval(() => { try { if (P.isShown()) syncSendCh(); } catch (e) { /* keep going */ } }, 4000);
  // right-click a friend > Message starts a private message in the game: bring this chat up, expanded, with the box ready to type
  let lastDm = '';
  const t3 = setInterval(() => { try { const b = bridge(), c = b && b.chat && b.chat(), n = c && c.dm && c.dmName ? c.dmName : ''; if (n !== lastDm) { lastDm = n; if (n) { P.setOpen(true); P.setCollapsed(false); syncSendCh(); stuck = true; render(true); setTimeout(() => { try { inp.focus(); } catch (e) { /* ignore */ } }, 60); } else syncSendCh(); } } catch (e) { /* keep going */ } }, 300);
  window.addEventListener('beforeunload', saveLog);
  if (P.isOpen()) { P.show(true); render(true); }

  function teardown() {
    closeChMenu(); clearInterval(t1); clearInterval(t2); clearInterval(t3); if (obs) obs.disconnect(); if (raf) cancelAnimationFrame(raf);
    saveLog(); window.removeEventListener('beforeunload', saveLog);
    try { P.destroy(); } catch (e) { /* gone */ }
    style.remove(); hideStyle.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc chat torn down';
  }
  // hovering the bar's Chat button shows this panel as a peek: it stays while the pointer is on the button or the panel (or you are typing), goes away after,
  // and a click on the button pins it open for good
  let peeking = false, peekT = 0, saved = null;
  const holding = () => el.matches(':hover') || (peekAnchor && peekAnchor.matches(':hover')) || document.activeElement === inp || !!(chMenu && chMenu.isConnected);   // the send-channel list belongs to the chat: it stays while that list is open
  let peekAnchor = null;
  function peek(anchor, pos) {
    clearTimeout(peekT); peekAnchor = anchor;
    if (P.isOpen() || peeking) return;
    peeking = true; saved = { l: el.style.left, t: el.style.top }; el.dataset.ccPeek = '1';
    P.show(true); stuck = true; unreadAll = 0; mentions = 0; syncSendCh(); render(true);
    // The peek appears exactly where the pinned chat sits (its own remembered spot, kept at the screen edges by the anchor plugin).
    // Only a chat that never had a spot is put next to the module it was hovered from.
    try { window.__ccAnchor && window.__ccAnchor.refresh(); } catch (e) { /* anchoring is optional */ }
    if (Number.isFinite(parseFloat(el.style.left)) && Number.isFinite(parseFloat(el.style.top))) return;
    const a = anchor.getBoundingClientRect(), vw = window.innerWidth, r0 = el.getBoundingClientRect();
    const wantL = Math.max(6, Math.min(vw - r0.width - 6, a.left)), wantT = pos === 'bottom' ? a.top - r0.height - 8 : a.bottom + 8;
    el.style.left = wantL + 'px'; el.style.top = Math.max((window.__ccEdge && window.__ccEdge.top) || 0, wantT) + 'px';
  }
  function unpeek() { clearTimeout(peekT); peekT = setTimeout(() => { if (!peeking) return; if (holding()) { unpeek(); return; } endPeek(); }, 350); }
  function endPeek() { if (!peeking) return; peeking = false; if (!P.isOpen()) { P.show(false); if (saved) { el.style.left = saved.l; el.style.top = saved.t; } } delete el.dataset.ccPeek; }
  el.addEventListener('mouseenter', () => clearTimeout(peekT));
  el.addEventListener('mouseleave', () => { if (peeking) unpeek(); });
  function toggle() { if (peeking) { peeking = false; delete el.dataset.ccPeek; P.setOpen(true); return; } P.toggle(); }
  window[NS] = { version: 1, teardown, toggle, peek, unpeek, get peeking() { return peeking; }, open: () => P.setOpen(true), isOpen: () => P.isOpen(),
    get unread() { return unreadAll; }, get mentions() { return mentions; }, get config() { return JSON.parse(JSON.stringify(cfg)); },
    // A line only you see: ScapeLite's own reply (chat commands). Never saved, never read by the relay (that reads the game's list), never sent. opts.open: bring the panel up.
    local(text, opts) {
      const t = String(text == null ? '' : text).slice(0, 400); if (!t) return false;
      const m = { ch: 'game', cat: 'scapelite', col: '', ts: '', name: '', ncol: '', world: '', badges: [], icon: '', text: t, t: Date.now(), live: true, mm: null, local: true, kind: (opts && opts.kind) || 'info' };
      m.k = 'local|' + m.t + '|' + Math.random();
      msgs.push(m); if (msgs.length > 1200) msgs.splice(0, msgs.length - 1000);
      if (cfg.showSL === false) {   // never silently hidden: the SL button counts the lines, and a toast carries the reply itself
        hiddenSL++; try { if (UI.toast) UI.toast(t.length > 200 ? t.slice(0, 199) + '…' : t, { tone: 'info', ms: 6000 }); } catch (e) { /* no toast */ }
        renderTabs(); return true;
      }
      if (opts && opts.open) { try { P.setOpen(true); P.setCollapsed(false); } catch (e) { /* panel gone */ } stuck = true; }
      schedule(); return true;
    },
    latest(n) { return msgs.filter((m) => !m.local && !isMuted(m)).slice(-(n || 1)).map((m) => ({ ts: stamp(m, 'hm'), ch: m.ch, name: m.name, text: m.text })); },
    focusInput() { P.setOpen(true); setTimeout(() => inp.focus(), 60); } };
  return 'cc chat loaded';
})();
