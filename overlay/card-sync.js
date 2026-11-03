// ScapeLite card sync (window.__ccCardSync). Core plugin, loaded before the plugins that draw cards (ui-bar.js, ui-queue.js).
//
// Why: every ScapeLite card (Equipment, Barter, Inventory, Skills, Quests, Friends, Diary, the Task queue ...) is a copy of a game panel or of bridge data.
// Each card used to find out that its source changed in its own way (a 1 s poll with a JSON signature, setTimeout re-renders after a forwarded click, "never
// redraw while the pointer is on the card", a special case for Barter ...), and every one of those was a place for a stale card. This file is the ONE
// mechanism: a card subscribes to a source, is told when the source changed, and asks one policy whether it may redraw now.
//
//     const off = __ccCardSync.watch('equipment', (info) => { ...redraw if the model changed...; return true; }, {})   // false = "not now, ask again"
//     __ccCardSync.forwarded('barter')          // call after you handed the user's real click to a game control (key = the card's source, omit if unknown): the cards follow the game for a few seconds
//     __ccCardSync.mayRedraw(hostEl, info)      // the redraw policy (below)
//     __ccCardSync.registerCard('quests', create)   // a card's model builder (overlay/cards/quests.js); the Info Bar draws what build() returns
//     __ccCardSync.define('mykey', { root: () => el, poll: { ms: 1000, sig: () => 'x' }, fresh: () => {} })
//
// Sources: a game panel (skills, inventory, equipment, diary, quests, friends, barter, chat) is watched by ONE MutationObserver on the panel's root element
// (childList, subtree, attributes, characterData), attached only while somebody watches the source and detached with the last watcher. Mutations are filtered
// (ScapeLite's own marks such as the lock button title are not changes of the panel) and coalesced: at most one notification per source every 250 ms
// (60 ms while following a forwarded click). A source without a DOM root (the task queue, which is drawn from bridge data) polls a signature function
// instead (poll.ms, only while watched; no signature = notify on every tick). Bridge subscriptions (window.__ccBridge.onChange) are used by the cards that
// need them, next to this layer; the bridge only offers 'speed' today.
//
// Redraw policy (mayRedraw): a card redraws when its source changed AND the redraw would not destroy a control the user is in the middle of using:
//   - never while a pointer button is held down inside the card (the click would be lost) or a text box inside it has the focus (typing);
//   - while the user only points at a control (button, chip, slider, a row with a hover card), a plain change waits (the hover card would vanish), and is
//     applied as soon as the pointer moves away (the layer asks again, see retry);
//   - a change that FOLLOWS A FORWARDED CLICK (forwarded() was called in the last 5 s) redraws at once even under the pointer, because the pointer always
//     rests on the button that was just pressed. The browser re-evaluates :hover on the new elements by itself after the next layout.
// Hidden panels: the game does not redraw every hidden panel. define({ fresh }) names the game's own redraw call for a source (read-only display refresh,
// like refreshQueuePanel); the layer calls it before it reads such a source. Display only: nothing here clicks or changes the game.
(function () {
  'use strict';
  const NS = '__ccCardSync';
  let carried = null;   // the registered card builders survive a re-inject of this file (they live in overlay/cards/*.js and are injected separately)
  try { carried = window[NS] && window[NS]._factories ? new Map(window[NS]._factories) : null; window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }

  const FOLLOW_MS = 5000, FOLLOW_TICK = 250, GAP = 250, GAP_FOLLOW = 60, RETRY_MS = 300;
  const NOISE = /(^|\s)cc-(lock-btn|ps-handle|hover-dist|qw)/;   // ScapeLite's own marks on the game's panels (they change every second and mean nothing to a card)
  // A render error is never shown to the player, but it must not vanish either: the first one per place is written to the log (channel Plugins), then at most one more
  // every SWALLOW_MS with a count of how many were dropped in between. This is how a card that never drew (the queue card once) stayed unseen.
  const SWALLOW_MS = 10 * 60 * 1000, swallowed = new Map();   // where -> { last, n }
  function swallow(where, err) {
    try {
      const k = String(where), now = Date.now(); let e = swallowed.get(k); if (!e) { e = { last: 0, n: 0 }; swallowed.set(k, e); }
      e.n++; if (e.last && now - e.last < SWALLOW_MS) return;
      const n = e.n; e.n = 0; e.last = now;
      const l = window.__ccLog && window.__ccLog.channel('Plugins', 'ui');
      if (l) l.warn('Render error in ' + k + (n > 1 ? ' (' + n + ' times since the last note)' : '') + ': ' + ((err && (err.stack || err.message)) || String(err)).slice(0, 600));
    } catch (x) { /* logging must never throw into the UI */ }
  }
  const sources = new Map();   // key -> source
  const factories = carried || new Map(); // card tab -> create(ctx) (the card model builders in overlay/cards/*.js register here)
  const stats = { mutations: 0, relevant: 0, notifies: 0, deferred: 0, polls: 0, follows: 0 };
  const followUntil = {};   // source key (or '*' = every source) -> until when a change counts as following a forwarded click
  let followTimer = 0, retryTimer = 0, rootTimer = 0;
  const pointer = { downIn: null };

  const panelRoot = (id) => () => { const D = window.__ccDom; const tb = D ? D.q('.panel-titlebar[data-panel-id="' + id + '"]') : document.querySelector('.panel-titlebar[data-panel-id="' + id + '"]'); return tb ? tb.parentElement : null; };
  const now = () => performance.now();
  const following = (key) => { const t = now(); return t < (followUntil['*'] || 0) || (key != null && t < (followUntil[key] || 0)); };
  const anyFollowing = () => { const t = now(); return Object.keys(followUntil).some((k) => t < followUntil[k]); };

  function define(key, def) {
    const old = sources.get(key); const subs = old ? old.subs : new Set();
    if (old) detach(old);
    const s = { key, def: def || {}, subs, mo: null, root: null, timer: 0, changed: false, lastRun: 0, pollT: 0, pollSig: null };
    sources.set(key, s);
    if (subs.size) attach(s);
    return s;
  }
  ['skills', 'inventory', 'equipment', 'diary', 'quests', 'friends', 'barter'].forEach((id) => define(id, { root: panelRoot(id) }));
  define('chat', { root: () => (window.__ccDom ? window.__ccDom.q('.chat-panel') : document.querySelector('.chat-panel')) });

  const relevant = (m) => {
    const t = m.target; if (!t) return false;
    const el = t.nodeType === 1 ? t : t.parentElement; if (!el) return true;
    const c = typeof el.className === 'string' ? el.className : '';
    if (c && NOISE.test(c)) return false;
    if (m.type === 'attributes' && (m.attributeName === 'title' && NOISE.test(c))) return false;
    return true;
  };

  function attach(s) {
    if (s.def.root) {
      const root = s.def.root(); s.root = root;
      if (root) attachObserver(s, root);
    }
    if (s.def.poll) {
      s.pollSig = null;
      s.pollT = setInterval(() => {
        if (window.__ccEcoOn) return;
        stats.polls++;
        if (s.def.poll.sig) { let g = ''; try { g = s.def.poll.sig(); } catch (e) { return; } if (g === s.pollSig) return; s.pollSig = g; }
        notify(s, { forwarded: following(s.key), why: 'poll' });
      }, s.def.poll.ms || 1000);
    }
    if (!rootTimer) rootTimer = setInterval(rootCheck, 1000);
  }
  function detach(s) {
    if (s.mo) { try { s.mo.disconnect(); } catch (e) { /* gone */ } s.mo = null; }
    clearTimeout(s.timer); s.timer = 0; s.changed = false; s.root = null;
    if (s.pollT) { clearInterval(s.pollT); s.pollT = 0; }
  }
  // the game redraws or replaces a panel's root now and then: re-attach to the new root (one cheap lookup per watched source a second)
  function rootCheck() {
    let any = false;
    sources.forEach((s) => {
      if (!s.subs.size) return; any = true;
      if (!s.def.root) return;
      let r = null; try { r = s.def.root(); } catch (e) { r = null; }
      if (r !== s.root) { const was = s.root; if (s.mo) { s.mo.disconnect(); s.mo = null; } s.root = r; if (r) { attachObserver(s, r); } if (was !== r) { s.changed = true; schedule(s); } }
    });
    if (!any) { clearInterval(rootTimer); rootTimer = 0; }
  }
  function attachObserver(s, root) {
    s.mo = new MutationObserver((recs) => { stats.mutations += recs.length; let any = false; for (let i = 0; i < recs.length; i++) if (relevant(recs[i])) { any = true; break; } if (!any) return; stats.relevant++; s.changed = true; schedule(s); });
    s.mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  }

  function schedule(s) {
    if (s.timer) return;
    const gap = following(s.key) ? GAP_FOLLOW : GAP, wait = Math.max(30, gap - (now() - s.lastRun));
    s.timer = setTimeout(() => { s.timer = 0; s.lastRun = now(); if (!s.changed) return; s.changed = false; notify(s, { forwarded: following(s.key), why: 'dom' }); }, wait);
  }

  function notify(s, info) {
    stats.notifies++;
    s.subs.forEach((sub) => {
      let ok = true; try { ok = sub.cb(Object.assign({ key: s.key }, info)) !== false; } catch (e) { ok = true; swallow('card ' + s.key + ' redraw', e); }
      if (!ok) { sub.dirty = true; stats.deferred++; } else sub.dirty = false;
    });
    armRetry();
  }
  // a redraw that had to wait (the pointer was on a control) is asked again shortly, until it went through
  function armRetry() {
    if (retryTimer) return;
    let dirty = false; sources.forEach((s) => s.subs.forEach((sub) => { if (sub.dirty) dirty = true; }));
    if (!dirty) return;
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      sources.forEach((s) => s.subs.forEach((sub) => { if (!sub.dirty) return; let ok = true; try { ok = sub.cb({ key: s.key, forwarded: following(s.key), why: 'retry' }) !== false; } catch (e) { ok = true; swallow('card ' + s.key + ' redraw', e); } sub.dirty = !ok; }));
      armRetry();
    }, RETRY_MS);
  }

  // ---- pointer tracking for the policy (installed only while somebody watches)
  const onDown = (e) => { pointer.downIn = e.target; };
  const onUp = () => { pointer.downIn = null; };
  let listening = false;
  function listen(on) {
    if (on === listening) return; listening = on;
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointerdown', onDown, true); document[f]('pointerup', onUp, true); document[f]('pointercancel', onUp, true); document[f]('dragend', onUp, true);
    if (!on) pointer.downIn = null;
  }
  const HOT = '.hv:hover,.tabtn:hover,.cc-chip:hover,input:hover,.clk:hover,.tcn:hover,.tload:hover,.tcell[style*="pointer"]:hover';
  function mayRedraw(host, info) {
    if (!host) return true;
    if (pointer.downIn && host.contains(pointer.downIn)) return false;
    const a = document.activeElement; if (a && host.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    if (info && info.forwarded) return true;
    try { if (host.querySelector(HOT)) return false; } catch (e) { /* odd selector support */ }
    return true;
  }

  function watch(key, cb, opts) {
    const s = sources.get(key); if (!s || typeof cb !== 'function') return () => {};
    const sub = { cb, dirty: false, opts: opts || {} };
    s.subs.add(sub);
    if (s.subs.size === 1) attach(s);
    listen(true);
    return function off() {
      if (!s.subs.delete(sub)) return;
      if (!s.subs.size) detach(s);
      let any = false; sources.forEach((x) => { if (x.subs.size) any = true; });
      if (!any) { listen(false); clearTimeout(retryTimer); retryTimer = 0; }
    };
  }

  // The user's real click was handed to a game control: every watched source is checked every 250 ms for FOLLOW_MS, and a change redraws even under the pointer.
  // forwarded('barter') = the click was on a Barter card, so only that source follows; forwarded() = unknown, every source follows.
  function forwarded(key) {
    followUntil[key || '*'] = now() + FOLLOW_MS; stats.follows++;
    const tick = () => { sources.forEach((s) => { if (s.subs.size && following(s.key)) notify(s, { forwarded: true, why: 'follow' }); }); };
    if (!followTimer) followTimer = setInterval(() => { if (!anyFollowing()) { clearInterval(followTimer); followTimer = 0; return; } tick(); }, FOLLOW_TICK);
    setTimeout(tick, 40);   // one check right away (a game control that answers synchronously)
  }
  // A card = a model builder. overlay/cards/<name>.js calls registerCard('<tab>', create); the Info Bar calls create(ctx) once and then instance.build() on every redraw.
  function registerCard(tab, create) { if (typeof create === 'function') factories.set(tab, create); }
  function cardFactory(tab) { return factories.get(tab) || null; }
  const has = (key) => sources.has(key);
  function kick(key) { const s = sources.get(key); if (s && s.subs.size) notify(s, { forwarded: following(s.key), why: 'kick' }); }
  function fresh(key) { const s = sources.get(key); if (s && s.def.fresh) { try { return s.def.fresh() !== false; } catch (e) { return false; } } return false; }

  function teardown() {
    sources.forEach((s) => { detach(s); s.subs.clear(); });
    clearInterval(followTimer); followTimer = 0; clearTimeout(retryTimer); retryTimer = 0; clearInterval(rootTimer); rootTimer = 0; listen(false);
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc card-sync torn down';
  }
  window[NS] = {
    version: 1, define, has, watch, forwarded, kick, fresh, mayRedraw, following, registerCard, cardFactory, swallow, _factories: factories, cards: () => Array.from(factories.keys()), teardown,
    // what is watched right now (for the test harness): sources with watchers, whether their observer is attached
    state() { const o = {}; sources.forEach((s, k) => { o[k] = { subs: s.subs.size, observing: !!s.mo, polling: !!s.pollT, root: !!s.root }; }); return { sources: o, stats: Object.assign({}, stats), following: anyFollowing(), pressed: !!pointer.downIn, listening }; },
  };
  return 'cc card-sync loaded';
})();
