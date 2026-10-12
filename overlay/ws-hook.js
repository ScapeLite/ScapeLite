// Scapewatch game-socket hook.
// Display-only / read-only in spirit: this never sends anything the real
// client wouldn't send on its own (the exact same request messages the
// game's own UI sends when you open Hiscores -> Clan -> View Your Rank,
// or Hiscores -> Players -> View Your Rank -- reverse-engineered by
// watching real network traffic while clicking those buttons, 2026-10-06).
// It only lets the watcher send those same read-only lookup requests
// itself, on a timer, without ever opening that UI. It never sends
// anything that changes game state (no task selection, no item use, no
// clan actions) -- only the two "give me ranking info" request types.
//
// MUST run before the game's own bundle creates its WebSocket, so this is
// injected via Page.addScriptToEvaluateOnNewDocument (document-start,
// same as panel-resize.js / chat-relay-collect.js) -- *not* just
// Runtime.evaluate on an already-loaded page, which would be too late
// (the real connection already exists, created with the native
// WebSocket constructor before our patched one could intercept it).
// Consequence: this only takes effect starting from the *next* game
// reload/relaunch after it's first injected -- it can't retroactively
// hook a connection that's already open.
//
// The game multiplexes everything (chat, state sync, hiscores) over one
// WebSocket as JSON frames shaped {type, data}. Confirmed real pairs:
//   -> {"type":"clan_hiscores_my_rank","data":{}}
//   <- {"type":"clan_hiscores_my_rank","data":{"rank":75,"page":2}}
//   -> {"type":"hiscores_get_my_rank","data":{"skillId":"overall"}}
//   <- {"type":"hiscores_my_rank","data":{"skillId":"overall","rank":1459,"page":58}}
//   -> {"type":"hiscores_get_ranking","data":{"skillId":"overall","page":58}}
//   <- {"type":"hiscores_ranking","data":{"skillId":"overall","page":58,
//        "rows":[{"rank":...,"playerId":...,"displayName":...,"clanTag":...,
//                 "totalLevel":...,"totalXP":...,"totalXpAt":...,"totalLevelAt":...}, ...],
//        "myPlayerId":...}}
// Exactly 25 rows/page, no total-page-count field in the response.
//
// Also passively watches (never sends anything for this -- purely reads
// frames the game already receives on its own) two more real pairs, used
// for the Raid Summary feature. Confirmed live by reading the game's own
// bundle, 2026-10-07:
//   <- {"type":"raid_state","data":{"lobby":{"members":[
//        {"playerId":...,"playerName":...,"isHost":...,"isClone":...,"online":...}, ...
//      ], ...}}}  -- sent whenever the raid lobby's roster changes; kept
//      as the best-known member list (filtered to real players, isClone
//      excluded -- those are a loadout-preview mechanic, not people).
//   <- {"type":"raid_run_complete","data":{"raidName":...,"runMs":...,
//        "damageByPlayer":[{"playerId":...,"damageDealt":...}, ...],
//        "loot":[{"itemId":...,"quantity":...,"isRare":...}, ...]}}
//      -- sent once when a raid run finishes successfully. playerId is
//      cross-referenced against the last-seen lobby roster to get names
//      (the payload itself only has ids), and itemId is resolved to a
//      display name via https://play.scapewatch.com/shared/data/items.json
//      (served live, same file used elsewhere -- see walking-countdown.js).

(function () {
  'use strict';
  const NS = '__ccGameSocket';

  // Unlike panel-resize.js/chat-relay-collect.js, this does NOT tear down
  // and recreate on re-injection. Confirmed as a real regression live,
  // 2026-10-06: it used to call window[NS].teardown() (deleting the
  // public API) and *then* check "constructor already patched, skip" --
  // which returned early without ever recreating window[NS], since the
  // guard that skips re-patching the constructor was never meant to also
  // skip rebuilding the API object. Net effect: a watcher restart into an
  // already-hooked page (no game reload involved at all) silently wiped a
  // *working* hook down to nothing, with no way to get it back short of
  // reloading the game again. The constructor can only be patched once
  // per page load anyway (there's only ever one real WebSocket to
  // capture), and the existing `sockets` array/API stay perfectly valid
  // for the rest of that page's life -- so if already installed, the only
  // correct move is to leave it alone entirely.
  if (window[NS + 'Installed']) return 'cc ws-hook: already installed, leaving existing instance alone';

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return 'cc ws-hook: no native WebSocket to patch';
  window[NS + 'Installed'] = true;

  const sockets = [];

  // --- Raid Summary: passive tracking, no outbound requests -------------
  let latestRaidMembers = null; // [{playerId, playerName}] -- real players only, isClone filtered out
  const RAID_SUMMARY_CAP = 20;
  const raidSummaryQueue = [];

  let itemsById = null;
  let itemsLoadPromise = null;
  function ensureItems() {
    if (itemsById) return Promise.resolve(itemsById);
    if (itemsLoadPromise) return itemsLoadPromise;
    itemsLoadPromise = fetch('https://play.scapewatch.com/shared/data/items.json')
      .then((res) => res.json())
      .then((data) => { itemsById = (data && data.items) || {}; return itemsById; })
      .catch(() => { itemsById = {}; return itemsById; });
    return itemsLoadPromise;
  }
  ensureItems();

  function itemName(itemId) {
    return (itemsById && itemsById[itemId] && itemsById[itemId].name) || itemId;
  }

  async function queueRaidSummary(data) {
    if (!data) return;
    await ensureItems();
    const memberMap = {};
    (latestRaidMembers || []).forEach((m) => { memberMap[m.playerId] = m.playerName; });
    const perPlayerDamage = (Array.isArray(data.damageByPlayer) ? data.damageByPlayer : [])
      .map((d) => ({
        playerId: d.playerId,
        playerName: memberMap[d.playerId] || d.playerName || 'Unknown',
        damageDealt: d.damageDealt || 0,
      }))
      .sort((a, b) => b.damageDealt - a.damageDealt);
    const loot = (Array.isArray(data.loot) ? data.loot : []).map((l) => ({
      itemId: l.itemId,
      name: itemName(l.itemId),
      quantity: l.quantity || 1,
      isRare: !!l.isRare,
    }));
    raidSummaryQueue.push({
      raidName: data.raidName || 'Raid',
      runMs: data.runMs || 0,
      memberCount: (latestRaidMembers || []).length,
      members: (latestRaidMembers || []).map((m) => m.playerName),
      perPlayerDamage,
      loot,
      ts: Date.now(),
    });
    if (raidSummaryQueue.length > RAID_SUMMARY_CAP) raidSummaryQueue.shift();
  }

  function onRaidFrame(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || !msg.type) return;
    if (msg.type === 'raid_state') {
      const lobby = msg.data && msg.data.lobby;
      latestRaidMembers = (lobby && Array.isArray(lobby.members))
        ? lobby.members.filter((m) => m && !m.isClone).map((m) => ({ playerId: m.playerId, playerName: m.playerName }))
        : null; // lobby is null/gone -- left or raid ended, nothing to track
    } else if (msg.type === 'raid_run_complete') {
      queueRaidSummary(msg.data);
    }
  }

  function PatchedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    sockets.push(ws);
    ws.addEventListener('message', onRaidFrame);
    ws.addEventListener('close', () => {
      const i = sockets.indexOf(ws);
      if (i !== -1) sockets.splice(i, 1);
    });
    return ws;
  }
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
  PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
  try { window.WebSocket = PatchedWebSocket; } catch (e) { /* ignore if non-configurable */ }

  function currentSocket() {
    return sockets.find(s => s.readyState === NativeWebSocket.OPEN) || null;
  }

  // Sends `payload` and resolves with the `data` field of the next
  // message whose `type` equals `matchType`. Only safe for sequential,
  // read-only request/response pairs (our actual usage) -- doesn't try to
  // correlate concurrent same-type requests.
  function request(payload, matchType, timeoutMs) {
    return new Promise((resolve, reject) => {
      const sock = currentSocket();
      if (!sock) { reject(new Error('no open game socket')); return; }
      let settled = false;
      const onMessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && msg.type === matchType) {
          settled = true;
          sock.removeEventListener('message', onMessage);
          clearTimeout(timer);
          resolve(msg.data);
        }
      };
      const timer = setTimeout(() => {
        if (settled) return;
        sock.removeEventListener('message', onMessage);
        reject(new Error('timeout waiting for ' + matchType));
      }, timeoutMs || 8000);
      sock.addEventListener('message', onMessage);
      try {
        sock.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timer);
        sock.removeEventListener('message', onMessage);
        reject(e);
      }
    });
  }

  function teardown() {
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc ws-hook teardown (note: WebSocket constructor stays patched -- a page can only be patched once per load)';
  }

  window[NS] = {
    version: 2,
    isReady() { return !!currentSocket(); },
    request,
    teardown,
    drainRaidSummaries() { return raidSummaryQueue.splice(0, raidSummaryQueue.length); },
  };

  console.log('[cc] ws-hook installed');
  return 'cc ws-hook installed';
})();
