// The chat relay's delivery engine, separated from the watcher so it can be tested (scripts/test-relay.js runs five of these against a fake Discord):
//
//   typed events (overlay/relay-events.js) -> outbox (kept on disk until Discord accepted them) -> gate -> shared sender -> Discord
//
// The gate is what keeps N ScapeLite instances from posting the same clan chat N times (docs/DISCORD-RELAY-AUDIT.md, part 3):
//   'send'    this instance may post (it holds the lease on the clan's lease webhook, or there is no lease webhook / the user chose "always relay": then it is on its own)
//   'standby' another instance holds the lease: events wait a short while (so a failover can still send them) and are then dropped
//   'unsure'  the lease cannot be read right now (Discord down, first start): events wait, nothing is posted, nothing is posted twice
// "Own events only" (o.ownOnly): this PC posts only the events about its own player (the personal feed, `self`) and skips the rest: no lease, no shared state, no duplicates.
// Nothing in here touches the game or the page.
'use strict';
const E = require('./relay-events');

const DEFAULTS = {
  spacingMs: 500,                 // pause between posts (stay well under the webhook rate limit)
  outboxMax: 500,                 // oldest events are dropped beyond this
  maxTries: 6,                    // failed posts per event
  holdMaxMs: 24 * 3600 * 1000,    // an event held back by a dead webhook is dropped after a day
  standbyMs: 150 * 1000,          // as a follower: how long events are kept for a failover before they are dropped
  unsureHoldMs: 15 * 60 * 1000,   // lease unreadable: how long events wait for it to come back
  relayedCap: 1000,
};

// ---- Discord payload from a typed event ----------------------------------------------------------------------------------------
function buildPayload(evt, cfg, avatarFor) {
  const c = cfg || {};
  const identity = { username: evt.player || undefined, avatar_url: avatarFor ? avatarFor(evt) : (evt.badgeIconUrl || evt.iconUrl || undefined) };
  if (evt.type === 'chat') return Object.assign({ content: evt.text }, identity);
  const f = E.formatEvent(evt, { ultraRareKeywords: c.ultraRareKeywords });
  // Ping roles (Plugins > Chat Relay Pings): any number of roles, each with any number of categories; a role is mentioned when it lists one of the event's categories.
  // Without pingRoles the old per-category roleMentions + toggles apply.
  let mention = '';
  if (Array.isArray(c.pingRoles)) {
    mention = f.roleKeys.length ? c.pingRoles.filter((r) => r && /^\d{6,}$/.test(String(r.roleId || '')) && Array.isArray(r.categories) && r.categories.some((k) => f.roleKeys.indexOf(k) !== -1)).map((r) => `<@&${r.roleId}>`).join(' ') : '';
  } else {
    let roleKey = f.roleKeys[0] || null;
    if (roleKey === 'levelUp' && !c.pingLevelUps) roleKey = null;
    if (roleKey === 'rareDrop' && c.pingRareDrops === false) roleKey = null;
    if (roleKey === 'unlock' && c.pingUnlocks === false) roleKey = null;
    if ((roleKey === 'pet' || roleKey === 'shinyPet') && c.pingPets === false) roleKey = null;
    if (roleKey === 'quest' && c.pingQuests === false) roleKey = null;
    mention = roleKey && (c.roleMentions || {})[roleKey] ? c.roleMentions[roleKey] : '';
  }
  // the role mention goes last, in a spoiler: Discord still pings, only the visible text is tidy
  const content = `${f.emoji} ${f.text}${mention ? ` ||${mention}||` : ''}`;
  const roles = (mention.match(/<@&(\d{6,})>/g) || []).map((m) => m.replace(/\D/g, ''));
  return Object.assign({ content, allowed_mentions: { parse: [], roles } }, identity);
}

function shouldRelay(evt, channelCfg) {
  if (evt.type === 'chat') return !!channelCfg.relayPlainChat;
  return true;
}

// ---- the relay -------------------------------------------------------------------------------------------------------------------
// o: { send(feature, url, payload) -> Promise<{ok,...}>, isBroken(url), gate(url) -> 'send'|'standby'|'unsure', ownOnly() -> bool, noteRelayed(url, key), alreadyRelayedByOthers(url, key),
//      store: { loadKeys, saveKeys, loadOutbox, saveOutbox }, avatarFor(evt), log, now, sleep, status, options }
function createRelay(o) {
  const opt = Object.assign({}, DEFAULTS, o.options || {});
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const status = o.status || { lastEventAt: null, totalRelayed: 0, totalSkipped: 0, totalStandby: 0 };
  const store = o.store || {};
  const pipeline = E.createPipeline({ now });
  let relayedKeys = new Set();
  let outbox = [];
  let busy = false;

  function load() {
    try { const a = store.loadKeys && store.loadKeys(); if (Array.isArray(a)) relayedKeys = new Set(a.slice(-opt.relayedCap)); } catch (e) { /* fresh start */ }
    try {
      const a = store.loadOutbox && store.loadOutbox();
      if (Array.isArray(a)) {
        // an outbox written by an older version holds raw collector events: turn them into typed ones (keeping their retry bookkeeping)
        outbox = a.map((x) => { if (x && x.v === 1) return x; const t = E.normalise(x); if (t) { t.ek = E.eventKey(t); if (x._q) t._q = x._q; if (x._tries) t._tries = x._tries; } return t; }).filter(Boolean);
      }
    } catch (e) { /* none yet */ }
  }
  const saveKeys = () => { try { store.saveKeys && store.saveKeys(Array.from(relayedKeys)); } catch (e) { /* best effort */ } };
  const saveOutbox = () => { try { store.saveOutbox && store.saveOutbox(outbox); } catch (e) { /* best effort */ } };

  const isRelayed = (evt) => (evt.rawKeys || []).length > 0 && evt.rawKeys.every((k) => relayedKeys.has(k));
  function markRelayed(evt) {
    (evt.rawKeys || []).forEach((k) => relayedKeys.add(k));
    while (relayedKeys.size > opt.relayedCap) relayedKeys.delete(relayedKeys.values().next().value);
    saveKeys();
  }

  // raw collector events -> typed events (grouped, Luck XP gone), each with its cross-instance key
  function typed(rawEvents) {
    const list = pipeline.process(rawEvents);
    list.forEach((e) => { e.ek = E.eventKey(e); });
    return list;
  }

  function enqueue(events) {
    outbox.push(...events);                       // persisted BEFORE posting
    if (outbox.length > opt.outboxMax) { log('Chat relay: outbox is over ' + opt.outboxMax + ' events (a webhook is not accepting them): dropping the oldest ' + (outbox.length - opt.outboxMax) + '.'); outbox.splice(0, outbox.length - opt.outboxMax); }
    saveOutbox();
  }

  async function process(cfg) {
    if (busy || !cfg) return;
    busy = true;
    try {
      let idx = 0, droppedStandby = 0;
      while (idx < outbox.length) {
        const evt = outbox[idx];
        if (!evt._q) evt._q = now();
        const age = now() - evt._q;
        const channelCfg = cfg.channels && cfg.channels[evt.channel];
        let done = true, hold = false;
        if (!channelCfg || !channelCfg.enabled || !channelCfg.webhookUrl || !shouldRelay(evt, channelCfg)) {
          /* this channel is off / filtered: nothing to send */
        } else if (isRelayed(evt)) {
          log('  -> skipped duplicate:', evt.channel, evt.type, '--', evt.raw);
          status.totalSkipped += 1;
        } else if (o.ownOnly && o.ownOnly() && !evt.self) {
          /* "own events only": somebody else's event (their own ScapeLite, or the relay PC, posts it) */
        } else {
          const gate = o.ownOnly && o.ownOnly() ? 'send' : o.gate ? o.gate(channelCfg.webhookUrl) : 'send';
          if (gate === 'standby') {
            evt._held = true;
            if (age > opt.standbyMs) { droppedStandby++; status.totalStandby = (status.totalStandby || 0) + 1; }
            else hold = true;
          } else if (gate === 'unsure') {
            evt._held = true;
            if (age > opt.unsureHoldMs) log('  -> dropping a relay event: the shared relay lease could not be read for', Math.round(opt.unsureHoldMs / 60000), 'minutes:', evt.raw);
            else hold = true;
          } else if (evt._held && o.alreadyRelayedByOthers && o.alreadyRelayedByOthers(channelCfg.webhookUrl, evt.ek)) {
            log('  -> skipped (the previous relay instance already posted it):', evt.raw);   // failover: the old leader's last posts are listed in the lease
            status.totalSkipped += 1;
          } else if (o.isBroken && o.isBroken(channelCfg.webhookUrl)) {
            hold = true;      // a dead webhook keeps its own events (not tried) but must not block the other channel
          } else {
            log('  ->', evt.channel, evt.type, '--', evt.raw);
            const res = await o.send('relay-' + evt.channel, channelCfg.webhookUrl, buildPayload(evt, cfg, o.avatarFor));
            if (res.ok) {
              markRelayed(evt);
              status.lastEventAt = now();
              status.totalRelayed += 1;
              if (o.noteRelayed) o.noteRelayed(channelCfg.webhookUrl, evt.ek);
            } else if (res.broken || res.deferred) {
              hold = true;    // dead webhook / rate limited / Discord cooling down: no try used, the event stays and goes out later in order
            } else if (res.rejected) {
              log('  -> Discord rejected a relay event, dropping it:', evt.raw, '--', res.error);
            } else {
              evt._tries = (evt._tries || 0) + 1;
              if (evt._tries >= opt.maxTries) log('  -> giving up on a relay event after', String(opt.maxTries), 'failed posts:', evt.raw);
              else done = false;
            }
          }
        }
        if (hold) {
          if (now() - evt._q > opt.holdMaxMs) { log('  -> dropping a relay event that could not be sent for a day:', evt.raw); outbox.splice(idx, 1); saveOutbox(); }
          else idx += 1;
          continue;
        }
        if (!done) { saveOutbox(); break; }   // retry on the next tick, keep order
        outbox.splice(idx, 1);
        saveOutbox();
        if (opt.spacingMs) await sleep(opt.spacingMs);
      }
      if (droppedStandby) log('Chat relay: ' + droppedStandby + ' event(s) not posted from this PC: another ScapeLite instance holds the relay for this channel.');
    } finally {
      busy = false;
    }
  }

  return {
    load, typed, enqueue, process, isRelayed, markRelayed, status,
    outbox: () => outbox, relayedCount: () => relayedKeys.size, relayedKeys: () => relayedKeys,
    flushState: () => { saveKeys(); saveOutbox(); },
  };
}

// The gate the watcher and the tests share. mode: 'auto' (the lease decides if the clan set up a lease webhook, else this PC is on its own), 'always' (this PC is the only
// ScapeLite user: no lease), 'never' (this PC never posts the shared stream), 'own' (only this player's own events leave this PC: handled per event by o.ownOnly; the shared
// streams (digest, rank, raid) stay quiet like 'never').
function leaseGate(manager, mode) {
  return (url) => {
    const m = typeof mode === 'function' ? mode() : mode;
    if (m === 'always') return 'send';
    if (m === 'never' || m === 'own') return 'standby';
    const l = manager.forWebhook(url);
    if (!l) return 'send';      // no lease webhook configured: nothing to agree on, this PC posts what it sees (documented: set a lease webhook, or "Own events only", when several members run ScapeLite)
    if (l.canRelay()) return 'send';
    return l.role() === 'follower' ? 'standby' : 'unsure';
  };
}

module.exports = { createRelay, buildPayload, shouldRelay, leaseGate, DEFAULTS };
