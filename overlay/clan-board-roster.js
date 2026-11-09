// ScapeLite clan status board: cards for clanmates who do NOT run ScapeLite ("roster cards"). Pure planning and card text, no I/O, no clock of its own.
//
//   * A member who runs ScapeLite keeps their OWN full live card (overlay/clan-board-sync.js). Everybody else can get a simple card made by the HOST (the lease
//     leader, overlay/relay-lease.js), if somebody switched "Also show clanmates who do not run ScapeLite" on.
//   * The host only writes what it can really see: the game's clan roster (online or not), when the host last SAW the member online, and, if the clan hiscores
//     lookup is on, the member's total level and rank. Nothing about tasks, nothing invented. The card says so ("seen by <host>").
//   * Who has a ScapeLite card: every ScapeLite that keeps a board card announces itself on the lease (field "bm": hash of the lower-case name -> a counter that goes
//     up at every announcement). Any entry means "this member has their own card", so the host makes none for them and deletes one it made earlier.
//   * The ids of the cards the host made are written to the lease too (field "bc": hash -> message id), so after a failover the new host edits the same messages
//     instead of making a second set.
'use strict';

const crypto = require('crypto');

const CARD_ENABLED_STATES = ['online', 'offline'];
const MAX_CARDS = 100;                          // Discord channels cope with far more; a clan has at most five members today
const EDIT_GAP_MS = 5 * 60 * 1000;              // a roster card changes at most every five minutes ...
const STATE_GAP_MS = 60 * 1000;                 // ... or after a minute when the member went online or offline
const CREATE_GAP_MS = 2500;                     // creates are spaced out
const RECREATE_GAP_MS = 30 * 1000;              // a card somebody deleted is made again after this
const COLORS = { online: 0x57F287, offline: 0x747F8D };

const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
const hash8 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const hashOf = (name) => hash8(lower(name));
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
const num = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : '');

// m: { name, online (bool), lastOnlineAt (ms or 0), totalLevel, rank }  host: the host's in-game name
function buildRosterCard(m, host, now, iconUrl) {
  const state = m.online ? 'online' : 'offline';
  const unix = (ms) => Math.floor(ms / 1000);
  const lines = [];
  lines.push(m.online ? '**Online now**' : (m.lastOnlineAt ? '**Offline** \u00B7 last seen <t:' + unix(m.lastOnlineAt) + ':R>' : '**Offline**'));
  const facts = [];
  if (typeof m.totalLevel === 'number' && m.totalLevel > 0) facts.push('Total level ' + num(m.totalLevel));
  if (typeof m.rank === 'number' && m.rank > 0) facts.push('Hiscores rank #' + num(m.rank));
  if (facts.length) lines.push(facts.join(' \u00B7 '));
  const author = { name: clip(String(m.name || ''), 80) };
  if (iconUrl) author.icon_url = iconUrl;
  const embed = {
    author,
    description: lines.join('\n'),
    color: COLORS[state],
    footer: { text: 'Seen by ' + clip(String(host || 'the host'), 40).replace(/[\r\n]/g, ' ') + ' \u00B7 no ScapeLite card' },
  };
  // the signature leaves out the relative time so a card is not edited just because the minutes moved
  const sig = [state, m.online ? '' : (m.lastOnlineAt ? unix(m.lastOnlineAt) : ''), m.totalLevel || '', m.rank || '', host || ''].join('|');
  return { payload: { embeds: [embed] }, sig };
}

// roster: [{ name, online }]; exclude: names switched off; self: this PC's player; presence: Set of hashes that have their own card; ids: { hash: messageId } known cards
// Returns { want: [{ name, hash, ... }], remove: [hash...] } -- the members that should have a roster card, and the hashes whose card must go.
function planRoster(o) {
  const roster = Array.isArray(o.roster) ? o.roster : [];
  const exclude = new Set((o.exclude || []).map(lower));
  const presence = o.presence instanceof Set ? o.presence : new Set(o.presence || []);
  const self = lower(o.self);
  const want = [], wantHashes = new Set();
  for (const m of roster) {
    const n = lower(m && m.name);
    if (!n || n === self || exclude.has(n)) continue;
    const h = hashOf(n);
    if (presence.has(h) || wantHashes.has(h)) continue;
    if (want.length >= MAX_CARDS) break;
    wantHashes.add(h); want.push(Object.assign({}, m, { hash: h }));
  }
  const remove = Object.keys(o.ids || {}).filter((h) => !wantHashes.has(h));
  return { want, remove };
}

// the roster the game reports -> the cards' input. seen: { hash: last time the host saw them online (ms) }, hiscores: { name: { rank, totalLevel } }
function memberFacts(m, seen, hiscores, now) {
  const h = hashOf(m.name);
  const hs = hiscores && (hiscores[m.name] || hiscores[lower(m.name)] || Object.keys(hiscores).map((k) => (lower(k) === lower(m.name) ? hiscores[k] : null)).find(Boolean));
  return { name: m.name, online: !!m.online, lastOnlineAt: m.online ? now : ((seen && seen[h]) || 0), totalLevel: hs && hs.totalLevel, rank: hs && hs.rank };
}

module.exports = { buildRosterCard, planRoster, memberFacts, hashOf, hash8, lower, EDIT_GAP_MS, STATE_GAP_MS, CREATE_GAP_MS, RECREATE_GAP_MS, MAX_CARDS, CARD_ENABLED_STATES };
