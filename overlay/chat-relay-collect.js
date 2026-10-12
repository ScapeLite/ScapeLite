// Scapewatch chat -> Discord relay, page-side collector.
// Display-only / read-only: this never clicks, selects, or submits
// anything in the game. It only watches chat messages already rendered in
// the DOM and queues the notable ones (drops, pets, unlocks, level-ups)
// for the watcher process to forward to Discord webhooks. Ordinary chat
// banter is queued too (as kind 'chat'), separately, so the watcher can
// decide per-channel whether to mirror it plainly.
//
// Companion to panel-resize.js; injected the same way, by
// panel-resize-watcher.js. Safe to re-inject: replaces any previous
// instance and only observes messages added AFTER injection (never
// re-queues chat history already in the DOM).
//
// DOM shape this relies on (verified live, 2026-10-06), per message:
//   <div class="chat-message chat-msg-clan" data-channel="clan"
//        data-category="rareDrops" style="color:...">
//     <span class="chat-timestamp">[17:47] </span>
//     <span class="chat-badge-slot"><span class="chat-staff-crown-wrap">
//       <img class="chat-staff-crown" alt="[T2] Slash Amulet">
//       <div class="tooltip"><div class="tt-name">[T2] Slash Amulet</div></div>
//     </span></span>
//     <span class="chat-sender-name">Fly</span><span>: </span>
//     <img class="chat-game-icon" src="...">
//     <span>received a rare drop: [T0] Copper Platebody from Feeble Goblin!</span>
//   </div>
// Plain chat (no game event) has data-channel but NO data-category -- that
// absence is exactly what's used below to tag it 'chat'. The badge-slot's
// hidden tooltip text (a player's equipped title, e.g. "[T2] Slash Amulet")
// sits in the DOM even though it's only shown on hover, so it must be
// stripped explicitly -- using raw node.textContent would silently
// prepend that title to the player's name.
//
// Category keys below are taken verbatim from the game's own
// CATEGORY_LABELS object (found in app/game.<hash>.js) and cross-checked
// against real data-category attributes seen live -- not guessed. Clan and
// Global use different, independent category vocabularies in that object
// (_clanFilters vs _globalFilters): Global's is much narrower -- the game
// itself only ever broadcasts cape/pet milestones there, nothing else.
//
// Your OWN drops/unlocks/level-ups do NOT appear in Clan chat -- confirmed
// live, 2026-10-06: the game posts them to "game" (data-channel="game"),
// the personal feed, instead. "game" uses the same category vocabulary as
// "clan" and is watched the same way, with its output merged into the
// Clan relay stream (see "game" -> "clan" in onMessageAdded) so your own
// events show up alongside everyone else's in the same place. One
// wrinkle: the game never renders a sender name on "game" lines (always
// implicitly you), so there's no .chat-sender-name to read there --
// extractParts falls back to the HUD's own name label for that channel.

(function () {
  'use strict';
  const NS = '__ccChatRelay';

  // Re-injection (watcher restart / plugin toggle) replaces this instance. Events
  // already queued but not yet drained, and the "seen" set, must survive the
  // handover -- otherwise every message that arrived since the last drain is
  // silently lost (confirmed 2026-10-07: level-ups missed across a restart).
  let carriedQueue = [], carriedSeen = [], carriedSeq = 0;
  try {
    const prev = window[NS];
    if (prev) {
      if (prev.peek) carriedQueue = prev.peek();
      if (prev.seenKeys) carriedSeen = prev.seenKeys();
      if (prev.lastSeq) carriedSeq = prev.lastSeq();
    }
  } catch (e) {}
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  // channel -> { data-category value -> semantic "kind" for Discord formatting }
  // Pets and Shiny Pets are separate kinds (not just a flag) because they
  // ping separate Discord roles -- "All Skills Pet" variants count as the
  // base tier they're a variant of.
  //
  // "game" is the personal feed (only ever about you -- your own drops,
  // unlocks, level-ups; confirmed live, 2026-10-06, by watching where
  // your own events actually land vs. a clanmate's). It uses the same
  // camelCase category vocabulary as "clan" (both come from the game's
  // one CATEGORY_LABELS object), so it reuses that same mapping below
  // rather than duplicating it.
  const CLAN_STYLE_CATEGORIES = {
    rareDrops: 'rareDrop',
    pets: 'petDrop',
    allSkillsPet: 'petDrop',
    shinyPets: 'shinyPetDrop',
    shinyAllSkillsPet: 'shinyPetDrop',
    unlocks: 'unlock',
    levels: 'levelUp',
    collections: 'collection',
    // questsCompleted added 2026-10-07 -- needed for the Activity Digest
    // feature ("notable drops, levels gained and quests completed"); text
    // format confirmed from the game's own bundle (not guessed): the game
    // always sends exactly `"Quest complete: " + questName` for this
    // category (see TEXT_PATTERNS below).
    questsCompleted: 'questComplete',
    // Deliberately not relayed: deaths, questSteps, tasks, corruptedMobs,
    // scrollSteps/Completions, teleports, friendLogins, pvp, tips,
    // teammateRareDrops. Add here if wanted.
  };
  const CATEGORY_KIND = {
    clan: CLAN_STYLE_CATEGORIES,
    game: CLAN_STYLE_CATEGORIES,
    global: {
      pet: 'petDrop',
      all_skills_pet: 'petDrop',
      shiny_pet: 'shinyPetDrop',
      shiny_all_skills_pet: 'shinyPetDrop',
      cape: 'unlock',
      trimmed_cape: 'unlock',
      max_cape: 'unlock',
      trimmed_max_cape: 'unlock',
    },
  };

  // Text is only parsed to pull out the specific item/skill/level -- the
  // category (above) is what decides whether/how a message is relayed.
  // Tried in order; first match wins. Unrecognized text still gets
  // relayed, just as a raw fallback -- never silently dropped once a
  // category has already told us it's worth relaying.
  const TEXT_PATTERNS = [
    { re: /^unlocked:\s*(.+)$/i, extract: m => ({ item: m[1].trim() }) },
    { re: /^received a rare drop:\s*(.+?)\s+from\s+(.+?)!*$/i, extract: m => ({ item: m[1].trim(), source: m[2].trim() }) },
    { re: /^Level up!\s*(.+?)\s+level is now\s+(\d+)/i, extract: m => ({ skill: m[1].trim(), level: m[2] }) },
    // "New Collection! Received [T2] Wayfarer's Wrap as a T2 Chest Drops drop. +363 Luck XP" / "... from Brew. +401 Luck XP":
    // pull out the clean item name, where it came from and the Luck XP so the Discord line (and ultra-rare keyword matching) are tidy.
    { re: /^New Collection!\s*Received\s+(.+?)\s+(?:from|as an?)\s+(.+?)(?:\s+drop)?\.?(?:\s*\+([\d,]+)\s*Luck XP\.?)?$/i, extract: m => ({ item: m[1].trim(), source: m[2].trim(), luck: m[3] ? m[3].replace(/,/g, '') : '' }) },
    { re: /^New Collection!\s*(.+)$/i, extract: m => ({ item: m[1].trim() }) },
    // Confirmed live from the game's own bundle, 2026-10-07: always exactly
    // `"Quest complete: " + questName`, no variation.
    { re: /^Quest complete:\s*(.+)$/i, extract: m => ({ item: m[1].trim() }) },
  ];

  function parseText(text) {
    for (const p of TEXT_PATTERNS) {
      const m = text.match(p.re);
      if (m) return p.extract(m);
    }
    return { item: text }; // category already told us this is worth relaying; don't drop just because wording is unrecognized
  }

  // "rgb(218, 165, 32)" -> 0xDAA520, for a Discord embed's integer color field.
  function rgbToInt(rgb) {
    const m = rgb && rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m) return null;
    return (parseInt(m[1], 10) << 16) + (parseInt(m[2], 10) << 8) + parseInt(m[3], 10);
  }

  // The game never renders a sender name on "game" channel (personal
  // feed) lines -- it's always implicitly you -- so there's no
  // .chat-sender-name to read there. Falls back to the HUD's own name
  // label (confirmed live: <span class="ingame-hud-name">Wulf</span>),
  // which is always present and always reflects whoever's logged in.
  function ownDisplayName() {
    const el = document.querySelector('.ingame-hud-name');
    return el ? el.textContent.trim() : null;
  }

  function extractParts(node, channel) {
    const senderEl = node.querySelector('.chat-sender-name');
    const iconEl = node.querySelector('.chat-game-icon');
    const badgeEl = node.querySelector('.chat-staff-crown'); // player's equipped title/cosmetic icon
    const timestampEl = node.querySelector('.chat-timestamp');
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.chat-timestamp, .chat-badge-slot, .chat-sender-name, .chat-game-icon').forEach(n => n.remove());
    const text = (clone.textContent || '').replace(/^:\s*/, '').trim();
    const player = senderEl ? senderEl.textContent.trim() : (channel === 'game' ? ownDisplayName() : null);
    return {
      player,
      text,
      timestamp: timestampEl ? timestampEl.textContent.trim() : '',
      iconUrl: iconEl ? iconEl.src : null,
      badgeIconUrl: badgeEl ? badgeEl.src : null,
      color: rgbToInt(node.style.color),
    };
  }

  // The game periodically re-renders its recent-message window from its
  // own message history -- confirmed live (2026-10-06): the exact same
  // batch of messages reappeared as brand-new DOM nodes every ~75-90s,
  // which MutationObserver has no way to tell apart from genuinely new
  // messages (they *are* new nodes, just with old content). Content alone
  // isn't a safe dedup key either -- the same item can legitimately drop
  // twice in a row (e.g. two separate "Leather Buckler" drops minutes
  // apart) -- so the key includes the message's own in-game "[HH:MM]"
  // timestamp, which stays stable across a re-render since it comes from
  // stored message data, not render time. Capped so a long session doesn't
  // grow this unboundedly.
  const SEEN_CAP = 1000;
  const seen = new Set();
  function alreadySeen(channel, parts) {
    const key = `${channel}|${parts.timestamp}|${parts.player}|${parts.text}`;
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > SEEN_CAP) seen.delete(seen.values().next().value);
    return false;
  }

  // A "★ " prefix marks a system/announcement line (confirmed live, seen
  // on several: "★ Welcome to Scapewatch!", "★ Did you know? ...", "★ The
  // host ended the raid.", "★ The Fortress: your army survived 0 waves.")
  // -- these have no data-category, same as genuine player banter, but
  // they're not something anyone typed. Kept as a safety net for Clan (see
  // below for "game", which has a stronger, more general rule).
  const SYSTEM_MESSAGE_RE = /^★/;

  function classify(channel, category, text) {
    if (!category) {
      // "game" is the personal feed -- it's entirely system-generated
      // (tips, quest steps, task completions, drops, Fortress rewards,
      // "army survived N waves", ...). There's no such thing as player-
      // typed banter on this channel at all, so an uncategorized line
      // here is never 'chat' -- it's just some other notification type
      // the game didn't bother tagging a category on. Confirmed live: "The
      // Fortress reward: 15x [T1] Linen Thread!" has no data-category and
      // was getting relayed as if typed, same as the "★" lines were.
      // Rather than chasing each new untagged notification text one at a
      // time, drop all of them for this channel categorically.
      if (channel === 'game') return null;
      if (SYSTEM_MESSAGE_RE.test(text.trim())) return null;
      return { kind: 'chat' };
    }
    const kind = (CATEGORY_KIND[channel] || {})[category];
    if (!kind) return null; // category this channel doesn't map (or we chose not to relay) -- skip
    // Your own quest completion also produces a personal-feed line "New
    // Collection! Completed the quest: X. +N Luck XP" (a collection-log
    // entry). Clanmates' quest completions never produce one, and the quest
    // itself is already relayed via "Quest complete: X" -- so this is just a
    // private extra that would only ever appear for you. Not relayed.
    if (kind === 'collection' && /completed the quest/i.test(text)) return null;
    return Object.assign({ kind }, parseText(text));
  }

  let queue = carriedQueue;
  let seq = carriedSeq;
  carriedSeen.forEach(k => seen.add(k));

  function onMessageAdded(node) {
    if (!(node instanceof Element) || !node.classList || !node.classList.contains('chat-message')) return;
    const channel = node.dataset.channel;
    if (!CATEGORY_KIND[channel]) return; // only Clan/Game/Global are watched
    const parts = extractParts(node, channel);
    if (!parts.player) return;
    if (alreadySeen(channel, parts)) return;
    const classified = classify(channel, node.dataset.category, parts.text);
    if (!classified) return;
    seq += 1;
    // "game" (personal feed -- your own drops/unlocks/levels) merges into
    // the Clan relay output: same destination webhook, same role pings,
    // same everything downstream. It's channel-tagged "game" only for the
    // dedup key above; nothing past this point needs to know it wasn't
    // actually posted to Clan chat.
    const outChannel = channel === 'game' ? 'clan' : channel;
    queue.push(Object.assign(
      {
        id: seq, queuedAt: Date.now(), channel: outChannel, player: parts.player, text: parts.text,
        timestamp: parts.timestamp, iconUrl: parts.iconUrl, badgeIconUrl: parts.badgeIconUrl, color: parts.color,
        raw: `${parts.player}: ${parts.text}`,
      },
      classified
    ));
  }

  // Page.addScriptToEvaluateOnNewDocument runs at document-start -- which
  // can be before .chat-message-area (or even <body>) exists yet. A
  // one-shot querySelector miss used to mean silently staying inactive
  // forever: the null-check kept it from throwing (unlike panel-resize.js,
  // which *did* throw here before being fixed the same day -- confirmed
  // live, 2026-10-06, via window.__ccPanelScale never getting set after a
  // fresh page load), but it never retried either. Closing that gap: if
  // not found immediately, watch for it to appear instead of giving up.
  let observer = null;
  let waiter = null;

  function attach(container) {
    observer = new MutationObserver((mutations) => {
      for (const mut of mutations) for (const node of mut.addedNodes) onMessageAdded(node);
    });
    observer.observe(container, { childList: true });
  }

  function startWhenReady() {
    const container = document.querySelector('.chat-message-area');
    if (container) { attach(container); return; }
    const root = document.documentElement || document.body;
    if (!root) {
      // Earlier than even <html> exists -- vanishingly rare, but fall back
      // to DOMContentLoaded, which guarantees the full DOM tree exists.
      document.addEventListener('DOMContentLoaded', startWhenReady, { once: true });
      return;
    }
    waiter = new MutationObserver(() => {
      const el = document.querySelector('.chat-message-area');
      if (el) { waiter.disconnect(); waiter = null; attach(el); }
    });
    waiter.observe(root, { childList: true, subtree: true });
  }

  startWhenReady();

  function teardown() {
    if (observer) observer.disconnect();
    if (waiter) waiter.disconnect();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc chat-relay collector torn down';
  }

  window[NS] = {
    version: 11,
    teardown,
    // Called by the watcher process: returns and clears all queued events.
    drain() {
      const out = queue;
      queue = [];
      return out;
    },
    peek() { return queue.slice(); },
    seenKeys() { return Array.from(seen); },
    // Read-only recovery aid: classify every chat message CURRENTLY in the DOM
    // (ignoring the seen set, queueing nothing) so the watcher side can compare
    // against what was actually relayed.
    rescan() {
      const out = [];
      const cont = document.querySelector('.chat-message-area');
      if (!cont) return out;
      for (const node of cont.children) {
        if (!node.classList || !node.classList.contains('chat-message')) continue;
        const channel = node.dataset.channel;
        if (!CATEGORY_KIND[channel]) continue;
        const parts = extractParts(node, channel);
        if (!parts.player) continue;
        const classified = classify(channel, node.dataset.category, parts.text);
        if (!classified) continue;
        out.push(Object.assign({ channel: channel === 'game' ? 'clan' : channel, player: parts.player, text: parts.text, timestamp: parts.timestamp,
          iconUrl: parts.iconUrl, badgeIconUrl: parts.badgeIconUrl, color: parts.color, raw: parts.player + ': ' + parts.text }, classified));
      }
      return out;
    },
    lastSeq() { return seq; },
  };

  const loadedMsg = 'cc chat-relay collector loaded' + (observer ? '' : ' (chat panel not found yet -- watching for it)');
  console.log('[cc]', loadedMsg);
  return loadedMsg;
})();
