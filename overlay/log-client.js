// ScapeLite log client (core, page side). Gives every in-game plugin a way to write real log files:
//
//   const log = window.__ccLog && window.__ccLog.channel('Tasks', 'slayer');   // channel + optional stream
//   log && log.info('Slayer: Goblin finished in 312s', { rec: record });        // debug | info | warn | error
//
// The page cannot write files, so entries go into a small in-page ring buffer; the watcher drains it every few seconds
// through the same Chrome DevTools connection it already uses, and the logging core (overlay/logging/) redacts, formats and
// files them under Logs/<Channel>/. Nothing here ever throws into a plugin, and nothing leaves the computer.
// Bounded: at most CAP entries wait; beyond that the oldest are dropped and counted. Entries that were not drained before the
// page unloaded are kept in localStorage (cc-log-pending, a few hundred at most) and sent after the next load.
// Channel names are checked by the logging core against its registry (overlay/logging/channels.js); an unknown name lands in Plugins.
(function () {
  'use strict';
  const NS = '__ccLog';
  const LS = 'cc-log-pending', CAP = 1000, PENDING_KEEP = 300, MSG_MAX = 1500, DATA_MAX = 12000;
  const prev = window[NS];
  let buf = [], dropped = 0;
  try { if (prev) { buf = prev.__buf || []; dropped = prev.__dropped || 0; prev.teardown && prev.teardown(true); } } catch (e) { /* ignore */ }
  try {
    const old = JSON.parse(localStorage.getItem(LS) || '[]');
    if (Array.isArray(old) && old.length) { buf = old.concat(buf).slice(-CAP); localStorage.removeItem(LS); }
  } catch (e) { /* storage blocked */ }

  const LEVELS = { debug: 1, info: 1, warn: 1, error: 1 };
  function push(ch, st, lv, m, d) {
    try {
      const e = { t: Date.now(), ch: String(ch || 'Plugins').slice(0, 24), lv: LEVELS[lv] ? lv : 'info', m: String(m == null ? '' : m).slice(0, MSG_MAX) };
      if (st) e.st = String(st).slice(0, 24);
      if (d !== undefined) {
        let j = ''; try { j = JSON.stringify(d); } catch (x) { j = ''; }
        if (j && j.length <= DATA_MAX) e.d = JSON.parse(j); else if (j) e.d = { truncated: true, bytes: j.length };
      }
      buf.push(e);
      if (buf.length > CAP) { buf.splice(0, buf.length - CAP); dropped++; }
    } catch (e) { /* never throws into a plugin */ }
  }
  function channel(name, stream) {
    const h = { name, stream: stream || null, log: (lv, m, d) => push(name, stream, lv, m, d) };
    ['debug', 'info', 'warn', 'error'].forEach((lv) => { h[lv] = (m, d) => push(name, stream, lv, m, d); });
    return h;
  }
  // The watcher calls this. Returns what was waiting and empties the buffer.
  function drain(max) {
    const n = Math.max(1, Math.min(CAP, max || 400));
    const entries = buf.splice(0, n);
    const out = { entries, dropped, left: buf.length };
    dropped = 0;
    return out;
  }
  const onHide = () => {
    try { if (buf.length) localStorage.setItem(LS, JSON.stringify(buf.slice(-PENDING_KEEP))); } catch (e) { /* storage blocked */ }
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
  function teardown(keepBuf) {
    window.removeEventListener('pagehide', onHide); window.removeEventListener('beforeunload', onHide);
    if (!keepBuf) onHide();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc log-client torn down';
  }
  window[NS] = {
    version: 1, channel, drain, teardown,
    log: (ch, lv, m, d) => push(ch, null, lv, m, d),
    get pending() { return buf.length; },
    get __buf() { return buf; }, get __dropped() { return dropped; },
  };
  return 'cc log-client loaded';
})();
