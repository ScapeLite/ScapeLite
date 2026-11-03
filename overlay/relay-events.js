// Chat-relay event model: ONE place that turns every raw game chat line into a typed event, and everything downstream (the live
// Discord post, the activity digest buckets, the cross-instance event key) works from that typed event, never from line wording.
//
// Why: the game words the same thing differently depending on who it happened to (see docs/DISCORD-RELAY-AUDIT.md):
//   * your own events arrive on the personal "game" feed, other members' on "clan":  "Dire Lich dropped [T1] X!"  vs  "received a rare drop: [T1] X from Dire Lich!"
//   * only other members get "unlocked: X"; your own unlock-type drops are plain drops (and Lucky/Shiny ones say "received the [Lucky] X!")
//   * only YOU see "+N Luck XP" on collection lines; quest, pet and level lines are worded differently for self and others
// so classifying by wording made the same item an Unlock for member A and a Drop for you. Here the bucket is decided by the ITEM
// (data/raw/items.json: type "unlock" = an unlock), the same for everybody.
//
//   const R = require('./relay-events');
//   const typed = R.normalise({ channel: 'clan', kind: 'rareDrop', player: 'Rad', text: 'received a rare drop: [T1] Faulty Crystal from Dire Lich!' });
//   R.formatEvent(typed)   -> { emoji, text, roleKeys, ultra }
//   R.digestBucket(typed)  -> 'drops' | 'unlocks' | 'pets' | 'quests' | 'levels' | null
//   const pipe = R.createPipeline(); pipe.process(rawEvents) -> typed events, one per logical event (drop + unlock + collection lines merged)
//
// "Luck XP" (the "+N Luck XP" suffix on collection lines) is stripped here and never appears in any output.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- game data: is this item an unlock? ------------------------------------------------------------------------------------
// items.json -> type "unlock" for every unlock item (tools, almanacs, Fortress beacons / satchels / notes, glyphs, relics ...). The game itself announces
// "unlocked: X" for all of them except these quest-reward ones (verified against the real logs, see the audit doc).
const NOT_ANNOUNCED_UNLOCK_TYPES = new Set(['barter_charm', 'queue_row', 'queue_insert']);

let itemsCache = null;      // Map(lowercased canonical name -> { type, unlockType })
function loadItems(file) {
  const m = new Map();
  try {
    let f = file;
    if (!f) { try { f = path.join(require('./paths').dataRaw, 'items.json'); } catch (e) { f = path.join(__dirname, '..', 'data', 'raw', 'items.json'); } }
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const items = j.items || j;
    Object.keys(items).forEach((id) => { const x = items[id]; if (x && x.name) m.set(String(x.name).toLowerCase(), { type: x.type || '', unlockType: x.unlockType || '' }); });
  } catch (e) { /* no game data: the unlock lines still say what is an unlock */ }
  return m;
}
function getItems() { if (!itemsCache) itemsCache = loadItems(); return itemsCache; }
function setItemsForTest(map) { itemsCache = map; }

function itemInfo(item) {
  const x = getItems().get(String(item || '').toLowerCase());
  return x || null;
}
function isUnlockItem(item) {
  const x = itemInfo(item);
  return !!(x && x.type === 'unlock' && !NOT_ANNOUNCED_UNLOCK_TYPES.has(x.unlockType));
}

// ---- text helpers -------------------------------------------------------------------------------------------------------------
const LUCK_XP_RE = /\s*\+\s*[\d,]+\s*Luck XP\.?/gi;
function stripLuckXp(text) { return String(text == null ? '' : text).replace(LUCK_XP_RE, '').trim(); }
const trimEnd = (s) => String(s).replace(/[\s!.]+$/g, '').trim();
const SKILLS = ['life', 'spirit', 'fish', 'cook', 'strike', 'heft', 'mine', 'smith', 'sight', 'draw', 'forage', 'craft', 'focus', 'surge', 'invoke', 'imbue', 'dodge', 'defend', 'farm', 'brew', 'slay', 'vigor', 'plunder', 'barter', 'delve', 'fortify', 'bard', 'discover', 'luck', 'alms'];
const SKILL_SET = new Set(SKILLS);

// "Shiny Lucky Culling Knife" (no brackets, from "received the ...") -> "[Shiny Lucky] Culling Knife"; everything else is left as printed.
function canonItem(raw) {
  let t = trimEnd(raw).replace(/^the\s+/i, '');
  const m = /^(Shiny Lucky|Lucky|Shiny)\s+(?!\[)(.+)$/.exec(t);
  if (m && !/^\[/.test(t)) {
    const cand = `[${m[1]}] ${m[2]}`;
    if (itemInfo(cand) || !itemInfo(t)) t = cand;
  }
  return t;
}
const itemKey = (item) => String(item || '').toLowerCase().replace(/\s+/g, ' ').trim();
function splitItem(item) {
  const tags = [];
  let rest = String(item || '');
  let m;
  while ((m = /^\[([^\]]+)\]\s*/.exec(rest))) { tags.push(m[1]); rest = rest.slice(m[0].length); }
  const tier = tags.find((t) => /^T\d+$/i.test(t)) || tags.find((t) => /^(Novice|Adept|Expert|Master|C\d*|D\d|L\d)$/i.test(t)) || '';
  const variant = tags.find((t) => /lucky|shiny/i.test(t)) || '';
  return { tags, tier, variant, base: rest.trim() };
}

// ---- where an item came from (source) -------------------------------------------------------------------------------------------
// Own lines say "T3 Chest Drops" / "Plunder Drops" / "Barter Drops", other members' say "a treasure chest" / "plundering" / "bartering": same thing.
function normaliseSource(raw, form) {
  let s = trimEnd(raw || '').replace(/^the\s+/i, '');
  if (!s) return { label: '', kind: '' };
  const lower = s.toLowerCase();
  if (/^t?\d*\s*chest drops?$/i.test(s) || /treasure chest/.test(lower)) return { label: 'a treasure chest', kind: 'chest' };
  if (/^plunder(ing| drops?)$/i.test(s) || lower === 'pickpockets') return { label: 'plundering', kind: 'plunder' };
  if (/^barter(ing| drops?)$/i.test(s)) return { label: 'bartering', kind: 'barter' };
  if (/task completion/.test(lower)) return { label: 'a task completion', kind: 'task' };
  if (/alms path/.test(lower)) return { label: 'the Alms Path', kind: 'alms' };
  if (lower === 'fortress' || /^fortress\b/.test(lower)) return { label: form === 'milestone' ? 'a Fortress milestone' : 'Fortress', kind: form === 'milestone' ? 'milestone' : 'fortress' };
  if (SKILL_SET.has(lower)) return { label: s, kind: 'skill' };
  if (/stall$/i.test(s)) return { label: s, kind: 'skill' };
  if (form === 'milestone') return { label: 'a ' + s + ' milestone', kind: 'milestone' };
  if (/dungeon$/i.test(s)) return { label: s, kind: 'dungeon' };
  if (form === 'drop' || form === 'from-rare') return { label: s, kind: 'monster' };
  return { label: s, kind: 'other' };
}
const DROP_LIKE_SOURCE = new Set(['monster', 'dungeon', 'fortress', 'milestone', 'other', '']);

// ---- parsing one raw line -----------------------------------------------------------------------------------------------------
// raw = { channel, kind (the collector's, from the game's own category), player, text, self?, timestamp? }
const PRIORITY = { unlock: 4, pet: 3, drop: 2, collection: 1 };

function parseItemQty(part) {
  let t = trimEnd(part);
  let qty = 1;
  const m = /^(\d[\d,]*)x\s+(.+)$/i.exec(t);
  if (m) { qty = parseInt(m[1].replace(/,/g, ''), 10) || 1; t = m[2]; }
  return { item: canonItem(t), qty };
}

function parseLine(raw) {
  const text = stripLuckXp(raw.text);
  const kind = raw.kind;
  let m;

  if (kind === 'chat') return { type: 'chat', text: String(raw.text == null ? '' : raw.text) };
  if (kind === 'levelUp' || /^Level up!/i.test(text)) {
    if ((m = /^Level up!\s*(.+?)\s+level is now\s+(\d+)/i.exec(text))) return { type: 'levelUp', skill: m[1].trim(), level: parseInt(m[2], 10) };
  }
  if (kind === 'questComplete' || /^Quest complete:|^completed the quest:/i.test(text)) {
    if ((m = /^(?:Quest complete|completed the quest):\s*(.+)$/i.exec(text))) return { type: 'quest', item: trimEnd(m[1]) };
  }
  // pets: "received the Luck pet!", "received the SHINY Farm pet!", own: "Fortify pet is now following you!"
  if (kind === 'petDrop' || kind === 'shinyPetDrop') {
    m = /^received the\s+(SHINY\s+)?(.+?)\s+pet(?![a-z])/i.exec(text) || /^(SHINY\s+)?(.+?)\s+pet is now following you/i.exec(text);
    if (m) return { type: 'pet', pet: m[2].trim(), shiny: !!m[1] || kind === 'shinyPetDrop', via: 'pet' };
    return { type: 'pet', pet: trimEnd(text.replace(/^received the\s+/i, '')).replace(/\s+pet$/i, ''), shiny: kind === 'shinyPetDrop', via: 'pet' };
  }
  // collection log: "New Collection! Received [T2] X as a Dire Lich drop." | "... from Craft." | "Claimed 2x [T2] X from the Alms Path." | "Unlocked the [Lucky] X." | "Unlocked the Fortify Pet."
  if (kind === 'collection' || /^New Collection!/i.test(text)) {
    if (/completed the quest/i.test(text)) return null;
    m = /^New Collection!\s*(?:Received|Claimed|Unlocked the)\s+(?:a SHINY\s+)?(.+?)\.?$/i.exec(text);
    if (!m) return { type: 'other', text };
    let body = m[1], src = '', form = '';
    let mm;
    if ((mm = /^(.+?)\s+as an?\s+(.+?)\s+(drop|milestone)$/i.exec(body))) { body = mm[1]; src = mm[2]; form = mm[3].toLowerCase(); }
    else if ((mm = /^(.+?)\s+from\s+(.+)$/i.exec(body))) { body = mm[1]; src = mm[2]; form = 'from'; }
    const iq = parseItemQty(body);
    if (/^unlocked the/i.test(text.replace(/^New Collection!\s*/i, '')) && /\bpet$/i.test(iq.item)) return { type: 'collection', petCollection: iq.item.replace(/\s+pet$/i, ''), via: 'collection', item: iq.item, qty: 1 };
    const s = normaliseSource(src, form);
    return { type: 'collection', item: iq.item, qty: iq.qty, source: s.label, sourceKind: s.kind, form, shinyFlag: /a SHINY/i.test(text), via: 'collection' };
  }
  // unlocks announced by the game: "unlocked: [T3] X" (other members) / "received the [Lucky] X!" (everybody, lucky and shiny ones)
  if (kind === 'unlock' || /^unlocked:/i.test(text)) {
    if ((m = /^unlocked:\s*(.+)$/i.exec(text))) return { type: 'unlock', item: canonItem(m[1]), qty: 1, via: 'unlocked' };
    if ((m = /^received the\s+(.+)$/i.exec(text))) return { type: 'unlock', item: canonItem(m[1]), qty: 1, via: 'received-the' };
    return { type: 'unlock', item: canonItem(text), qty: 1, via: 'unlock-text' };   // e.g. a global cape announcement: the category already said what it is
  }
  // rare drops: others "received a rare drop: X from SRC!" / "received a rare raid drop: X from Fortress!"; own "SRC dropped X!" / "Chaos Dungeon reward: X!" / "Invoke Stall turned up X!"
  if (kind === 'rareDrop' || /dropped |reward:|turned up |received a rare/i.test(text)) {
    if ((m = /^received a rare (raid )?drop:\s*(.+?)\s+from\s+(.+?)!*$/i.exec(text))) {
      const iq = parseItemQty(m[2]); const s = normaliseSource(m[3], 'from-rare');
      return { type: 'drop', item: iq.item, qty: iq.qty, source: s.label, sourceKind: s.kind, raid: !!m[1], via: 'rare-drop' };
    }
    if ((m = /^(.+?)\s+dropped\s+(.+?)!*$/i.exec(text))) {
      const iq = parseItemQty(m[2]); const s = normaliseSource(m[1], 'drop');
      return { type: 'drop', item: iq.item, qty: iq.qty, source: s.label, sourceKind: s.kind, via: 'dropped' };
    }
    if ((m = /^(.+?)\s+reward:\s*(.+?)!*$/i.exec(text))) {
      const iq = parseItemQty(m[2]); const s = normaliseSource(m[1], 'drop');
      return { type: 'drop', item: iq.item, qty: iq.qty, source: s.label, sourceKind: s.kind, via: 'reward' };
    }
    if ((m = /^(.+?)\s+turned up\s+(.+?)!*$/i.exec(text))) {
      const iq = parseItemQty(m[2]); const s = normaliseSource(m[1], 'skill');
      return { type: 'drop', item: iq.item, qty: iq.qty, source: s.label, sourceKind: s.kind === 'other' ? 'skill' : s.kind, via: 'turned-up' };
    }
    const iq = parseItemQty(text);
    return { type: 'drop', item: iq.item, qty: iq.qty, source: '', sourceKind: '', via: 'rare-drop-unparsed' };
  }
  return { type: 'other', text };
}

// raw event -> typed event (or null when it is not worth relaying)
function normalise(raw) {
  if (!raw || !raw.player) return null;
  const p = parseLine(raw);
  if (!p) return null;
  const e = Object.assign({
    v: 1, type: p.type, player: raw.player, channel: raw.channel || 'clan', self: !!raw.self,
    raw: raw.raw || `${raw.player}: ${raw.text}`, text: raw.text, timestamp: raw.timestamp || '',
    iconUrl: raw.iconUrl || null, badgeIconUrl: raw.badgeIconUrl || null, color: raw.color == null ? null : raw.color,
    id: raw.id, queuedAt: raw.queuedAt,
  }, p);
  e.rawKeys = [rawKey(raw)];
  if (e.item) {
    const sp = splitItem(e.item);
    e.tier = sp.tier; e.variant = sp.variant; e.itemKey = itemKey(e.item);
    const info = itemInfo(e.item);
    e.itemType = info ? info.type : '';
    e.knownUnlock = isUnlockItem(e.item);
    // the bucket follows the ITEM, not the line: an unlock item is an unlock whether the line said "dropped", "received a rare drop" or "unlocked:"
    if (e.type === 'drop' && e.knownUnlock) e.type = 'unlock';
    if (e.type === 'collection') {
      if (e.knownUnlock) e.type = 'unlock';
      else if (DROP_LIKE_SOURCE.has(e.sourceKind || '') && (e.form === 'drop' || e.form === 'milestone')) e.type = 'drop';   // only record of the drop (its rare-drop line was not seen)
    }
    e.shiny = /shiny/i.test(e.item) || !!e.shinyFlag;
    e.fortress = e.sourceKind === 'fortress' || e.sourceKind === 'milestone' && /fortress/i.test(e.source || '');
  }
  if (e.type === 'pet') e.itemKey = 'pet:' + itemKey(e.pet);
  if (e.petCollection) { e.type = 'pet'; e.pet = e.petCollection; e.itemKey = 'pet:' + itemKey(e.pet); delete e.item; e.via = 'collection'; e.onlyCollection = true; }
  e.lines = [p.type];            // what the LINE said (before the item decided the bucket)
  return e;
}

// ---- grouping lines that describe the SAME thing -------------------------------------------------------------------------------
// One drop reaches the chat as up to three lines (rare-drop line, "unlocked:" line, "New Collection!" line); the order differs. They are one event.
const GROUP_WINDOW_MS = 20000;
function mergeInto(a, b) {
  // a = the group so far (keeps its place in the order), b = another line about the same item for the same player
  const pa = PRIORITY[a.type] || 0, pb = PRIORITY[b.type] || 0;
  const sourceFrom = (a.source && a.sourceKind !== 'other') ? a : (b.source ? b : a);
  if (pb > pa) { const keep = { rawKeys: a.rawKeys, lines: a.lines }; Object.assign(a, b, keep); }
  a.rawKeys = a.rawKeys.concat(b.rawKeys.filter((k) => a.rawKeys.indexOf(k) === -1));
  a.lines = a.lines.concat(b.lines);
  if (sourceFrom.source) { a.source = sourceFrom.source; a.sourceKind = sourceFrom.sourceKind; }
  if ((b.qty || 0) > (a.qty || 0)) a.qty = b.qty;
  if (b.self) a.self = true;
  if (!a.badgeIconUrl && b.badgeIconUrl) a.badgeIconUrl = b.badgeIconUrl;
  if (!a.iconUrl && b.iconUrl) a.iconUrl = b.iconUrl;
  return a;
}

function rawKey(raw) { return `${raw.channel}|${raw.timestamp || ''}|${raw.player}|${raw.text}`; }

function createPipeline(options) {
  const o = Object.assign({ windowMs: GROUP_WINDOW_MS, now: Date.now }, options || {});
  const recent = new Map();   // player|itemKey -> { pri, at }
  function process(rawEvents) {
    const out = [];
    const open = new Map();
    const t = o.now();
    for (const raw of rawEvents || []) {
      const e = normalise(raw);
      if (!e) continue;
      if (e.type === 'chat' || e.type === 'levelUp' || e.type === 'quest' || e.type === 'other' || !e.itemKey) { out.push(e); continue; }
      const key = e.player + '|' + e.itemKey;
      const g = open.get(key);
      if (g) { mergeInto(g, e); continue; }
      open.set(key, e);
      out.push(e);
    }
    // a line of the same thing that follows a post made moments ago (a later poll) adds nothing unless it is more important
    const result = [];
    for (const e of out) {
      if (e.itemKey && e.type !== 'chat') {
        const key = e.player + '|' + e.itemKey;
        const r = recent.get(key);
        const pri = PRIORITY[e.type] || 0;
        if (r && t - r.at < o.windowMs && pri <= r.pri) { e.suppressed = true; continue; }
        recent.set(key, { pri, at: t });
      }
      e.alsoDrop = (e.lines || []).indexOf('drop') !== -1;
      e.newCollection = (e.lines || []).indexOf('collection') !== -1 && e.type !== 'collection';
      result.push(e);
    }
    if (recent.size > 400) for (const [k, v] of recent) if (t - v.at > o.windowMs * 3) recent.delete(k);
    return result;
  }
  return { process };
}

// ---- digest buckets ------------------------------------------------------------------------------------------------------------
function digestBucket(e) {
  switch (e && e.type) {
    case 'drop': return 'drops';
    case 'unlock': return 'unlocks';
    case 'pet': return 'pets';
    case 'quest': return 'quests';
    case 'levelUp': return 'levels';
    default: return null;   // collection-log entries from skilling, chat, unknown: not digest material
  }
}
const BUCKET_FIELD = { drops: 'rareDrops', unlocks: 'unlocks', pets: 'pets', quests: 'quests' };   // field names kept from the old digest-state.json
const emptyPlayer = () => ({ rareDrops: [], unlocks: [], pets: [], quests: [], levels: {} });

function digestEntry(e) {
  if (e.type === 'pet') return (e.shiny ? '✨ ' : '') + e.pet + ' pet';
  if (e.type === 'quest') return e.item;
  return (e.qty > 1 ? e.qty + 'x ' : '') + e.item;
}
// Adds a typed event to a digest buffer ({ sinceAt, players, seenKeys }). Returns true when the buffer changed.
function digestAdd(buffer, e) {
  const b = digestBucket(e);
  if (!b || !e.player) return false;
  const p = buffer.players[e.player] || (buffer.players[e.player] = emptyPlayer());
  if (b === 'levels') {
    const lvl = e.level;
    if (e.skill && Number.isFinite(lvl) && (p.levels[e.skill] == null || lvl > p.levels[e.skill])) { p.levels[e.skill] = lvl; return true; }
    return false;
  }
  const list = p[BUCKET_FIELD[b]];
  const entry = digestEntry(e);
  if (!entry) return false;
  if (b === 'quests' || b === 'unlocks' || b === 'pets') { if (list.includes(entry)) return false; }
  list.push(entry);
  return true;
}
// "[T1] Faulty Crystal" x3 -> "[T1] Faulty Crystal x3" (a repeated drop is one entry with a count)
function collapseEntries(list) {
  const counts = new Map();
  list.forEach((x) => { const m = /^(\d+)x\s+(.+)$/.exec(x); const name = m ? m[2] : x, n = m ? parseInt(m[1], 10) : 1; counts.set(name, (counts.get(name) || 0) + n); });
  return Array.from(counts, ([name, n]) => (n > 1 ? `${name} ×${n}` : name));
}

// Old digest-state.json: entries were cleaned strings under the bucket the WORDING picked. Re-bucket by item, drop Luck XP leftovers, tidy wording, remove duplicates.
function migrateDigestBuffer(buffer) {
  if (!buffer || !buffer.players) return buffer;
  const tidy = (s) => {
    let t = stripLuckXp(s);
    t = t.replace(/^(?:unlocked|received a rare(?: raid)? drop|completed the quest|quest complete)\s*:\s*/i, '').replace(/^(?:New Collection!\s*)?(?:Received|Claimed)\s+(?:\d+x\s+)?/i, '');
    t = t.replace(/^.+?\s+(?:dropped|turned up)\s+/i, '').replace(/^.+?\s+reward:\s*/i, '').replace(/^the\s+/i, '');
    t = t.replace(/\s+from\s+(?:the\s+)?[^!.\[]+$/i, '').replace(/\s+as an?\s+.+?\s+drop$/i, '');
    return canonItem(trimEnd(t));
  };
  for (const name of Object.keys(buffer.players)) {
    const p = Object.assign(emptyPlayer(), buffer.players[name]);
    const drops = [], unlocks = [], pets = [], quests = [];
    const seenU = new Set();
    const pushUnlock = (x) => { const k = itemKey(x); if (!seenU.has(k)) { seenU.add(k); unlocks.push(x); } };
    (p.unlocks || []).forEach((x) => { const t = tidy(x); if (t) pushUnlock(t); });
    (p.rareDrops || []).forEach((x) => { const t = tidy(x); if (!t) return; if (isUnlockItem(t)) pushUnlock(t); else drops.push(t); });
    (p.pets || []).forEach((x) => { const sh = /^✨\s*/.test(x); let t = tidy(String(x).replace(/^✨\s*/, '')).replace(/\s+is now following you$/i, ''); if (!t) return; if (!/\bpet$/i.test(t)) t += ' pet'; t = (sh ? '✨ ' : '') + t; if (!pets.includes(t)) pets.push(t); });
    (p.quests || []).forEach((x) => { const t = tidy(x); if (t && !quests.includes(t)) quests.push(t); });
    p.rareDrops = drops; p.unlocks = unlocks; p.pets = pets; p.quests = quests;
    buffer.players[name] = p;
  }
  return buffer;
}

// ---- Discord text from the typed event ----------------------------------------------------------------------------------------------
const CATEGORY_META = {
  unlock: { emoji: '🔓', roleKey: 'unlock' },
  drop: { emoji: '💎', roleKey: 'rareDrop' },
  pet: { emoji: '🐾', roleKey: 'pet' },
  levelUp: { emoji: '⭐', roleKey: 'levelUp' },
  collection: { emoji: '📖', roleKey: 'rareDrop' },
  quest: { emoji: '📜', roleKey: 'quest' },
};
const SKILL_EMOJI = {
  life: '❤️', spirit: '🪽', fish: '🐟', cook: '🍳', strike: '⚔️', heft: '💪', mine: '⛏️', smith: '🔨', sight: '🏹', draw: '🎨',
  forage: '🌿', craft: '🧵', focus: '🎯', surge: '⚡', invoke: '🔮', imbue: '🪄', dodge: '💨', defend: '🛡️', farm: '🌾', brew: '⚗️',
  slay: '💀', vigor: '🏃', plunder: '💰', barter: '⚖️', delve: '🕳️', fortify: '🧱', bard: '🎵', discover: '🔍', luck: '🍀', alms: '🙏',
};
const bold = (s) => `**${s}**`;
const fromText = (e) => (e.source ? (e.sourceKind === 'milestone' ? ` as ${e.source}` : ` from ${e.source}`) : '');

function isUltraRare(e, keywords) {
  if (!keywords || !keywords.length || !e.item) return false;
  if (e.type !== 'drop' && e.type !== 'unlock' && e.type !== 'collection') return false;
  const hay = e.item.toLowerCase();
  return keywords.some((k) => hay.includes(String(k).toLowerCase()));
}

function describe(e) {
  const qty = e.qty > 1 ? e.qty + 'x ' : '';
  const nc = e.newCollection ? ' · new collection entry' : '';
  switch (e.type) {
    case 'drop': return `received ${bold(qty + e.item)}${fromText(e)}${nc}`;
    case 'unlock': return `unlocked ${bold(qty + e.item)}${fromText(e)}${nc}`;
    case 'pet': return `received the ${bold((e.shiny ? 'SHINY ' : '') + e.pet + ' pet')}`;
    case 'levelUp': return `${e.skill} level is now ${bold(e.level)}`;
    case 'collection': return `logged ${bold(qty + e.item)}` + (e.source ? ` (${e.source})` : '');
    case 'quest': return `completed quest ${bold(e.item)}`;
    default: return e.text || e.raw || '';
  }
}

// -> { emoji, text, roleKeys: [...], ultra }.  roleKeys are the ping categories that apply (an unlock that arrived as a drop line too pings both).
function formatEvent(e, opts) {
  const o = opts || {};
  const ultra = e.type !== 'pet' && isUltraRare(e, o.ultraRareKeywords);
  const meta = CATEGORY_META[e.type] || { emoji: '•', roleKey: null };
  let emoji = meta.emoji;
  if (e.type === 'levelUp') emoji = SKILL_EMOJI[String(e.skill || '').toLowerCase()] || meta.emoji;
  else if (e.type === 'pet' && e.shiny) emoji = '✨';
  else if (ultra) emoji = '🌟';
  let roleKeys = [];
  if (e.type === 'pet') roleKeys = [e.shiny ? 'shinyPet' : 'pet'];
  else if (ultra) roleKeys = ['shinyRareDrop'];
  else if (meta.roleKey) roleKeys = [meta.roleKey];
  if (!ultra && e.type === 'unlock' && e.alsoDrop && roleKeys.indexOf('rareDrop') === -1) roleKeys.push('rareDrop');
  return { emoji, text: `${ultra ? '**ULTRA RARE** ' : ''}${describe(e)}`, roleKeys, ultra };
}

// ---- cross-instance identity ---------------------------------------------------------------------------------------------------------
// Same logical event => same key on every PC, whatever the wording (own line vs other-member line). No clock in it (PCs may be in other time zones).
function eventKey(e) {
  let basis;
  switch (e.type) {
    case 'chat': basis = ['chat', e.player, String(e.text || '').trim()]; break;
    case 'levelUp': basis = ['lv', e.player, String(e.skill || '').toLowerCase(), e.level]; break;
    case 'quest': basis = ['q', e.player, itemKey(e.item)]; break;
    case 'pet': basis = ['pet', e.player, itemKey(e.pet), e.shiny ? 1 : 0]; break;
    case 'drop': case 'unlock': case 'collection': basis = ['it', e.player, e.itemKey, e.qty || 1]; break;   // a drop and its unlock/collection line are one key
    default: basis = ['o', e.player, String(e.text || '')];
  }
  return crypto.createHash('sha1').update(basis.join('\u0001')).digest('hex').slice(0, 8);
}

module.exports = {
  normalise, createPipeline, digestBucket, digestAdd, digestEntry, collapseEntries, migrateDigestBuffer, emptyPlayer,
  formatEvent, describe, isUltraRare, eventKey, rawKey, stripLuckXp, canonItem, isUnlockItem, itemInfo, splitItem, normaliseSource,
  loadItems, setItemsForTest, SKILL_EMOJI, CATEGORY_META, PRIORITY, GROUP_WINDOW_MS, NOT_ANNOUNCED_UNLOCK_TYPES,
};
