// Pure simulation of the watchdog decisions (overlay/watchdog.js). Touches no real lock, process or service.  npm run test:watchdog
'use strict';
const w = require('../overlay/watchdog');
let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name); } };
const MIN = 60000;

// --- judgeProcess: dead pid, stale lock, reused pid ---
const L = (pid) => ({ exists: true, pid });
t('no lock file -> missing', w.judgeProcess({ exists: false, pid: 0 }, false, null, 'watcher').verdict === 'missing');
t('lock without pid -> missing', w.judgeProcess(L(0), false, null, 'watcher').verdict === 'missing');
t('dead pid -> dead (stale lock)', w.judgeProcess(L(4242), false, null, 'supervisor').verdict === 'dead');
t('alive and right program -> running', w.judgeProcess(L(10), true, 'C:/x/node.exe C:/r/overlay/panel-resize-watcher.js', 'watcher').ok === true);
t('alive, command line has the marker case-insensitive', w.judgeProcess(L(10), true, 'NODE C:/R/OVERLAY/SUPERVISOR.JS', 'supervisor').verdict === 'running');
t('alive but other program -> reused', w.judgeProcess(L(10), true, 'C:/Windows/chrome.exe --foo', 'watcher').verdict === 'reused');
t('reused is not ok', w.judgeProcess(L(10), true, 'notepad.exe', 'supervisor').ok === false);
t('watcher pid holding the supervisor lock -> reused', w.judgeProcess(L(10), true, 'node panel-resize-watcher.js', 'supervisor').verdict === 'reused');
t('alive, command line unreadable -> unverified but ok', (() => { const r = w.judgeProcess(L(10), true, null, 'watcher'); return r.ok && r.verdict === 'unverified'; })());
t('why text names the pid', /4242/.test(w.judgeProcess(L(4242), false, null, 'watcher').why));

// --- judgeHeartbeat ---
const now = 1e12;
t('fresh heartbeat', w.judgeHeartbeat({ mtimeMs: now - 20000 }, now - 3600000, now).ok);
t('old heartbeat -> stalled', w.judgeHeartbeat({ mtimeMs: now - 6 * MIN }, now - 3600000, now).verdict === 'stalled');
t('no heartbeat file but just started (lock young) -> ok', w.judgeHeartbeat(null, now - 30000, now).ok);
t('no heartbeat file, lock old -> stalled', w.judgeHeartbeat(null, now - 10 * MIN, now).verdict === 'stalled');
t('heartbeat older than the lock (previous run) does not count', w.judgeHeartbeat({ mtimeMs: now - 3600000 }, now - 20000, now).ok);
t('cdp connected, loop stopped -> loop-stalled', w.judgeHeartbeat({ mtimeMs: now - 10000, cdp: true, loopAt: now - 7 * MIN }, now - 3600000, now).verdict === 'loop-stalled');
t('cdp not connected: old loopAt is fine (no game)', w.judgeHeartbeat({ mtimeMs: now - 10000, cdp: false, loopAt: now - 7 * MIN }, now - 3600000, now).ok);
t('nothing to compare -> unknown, ok', w.judgeHeartbeat(null, 0, now).verdict === 'unknown');

// --- retry policy: now, +5 min, then every 10 min ---
t('delays 0, 5 min, 10 min, 10 min', w.retryDelay(0) === 0 && w.retryDelay(1) === 5 * MIN && w.retryDelay(2) === 10 * MIN && w.retryDelay(9) === 10 * MIN);
(() => {
  let s = { failures: 0, nextAt: 0 }, tm = 5e11, attempts = [];
  // simulate 2 hours of checks every 60 s with the thing never coming back
  for (let i = 0; i < 120; i++, tm += MIN) { const d = w.retryDecision(s, tm); if (d.go) { attempts.push(i); s = w.afterAttempt(s, tm); } }
  t('attempt 1 at minute 0', attempts[0] === 0);
  t('attempt 2 at minute 5', attempts[1] === 5);
  t('attempt 3 at minute 15, then every 10', attempts[2] === 15 && attempts[3] === 25 && attempts[4] === 35);
  t('no crash loop: 2 h -> 2 + 11 attempts', attempts.length === 2 + Math.floor((119 - 5) / 10));
})();
t('retryDecision says how long to wait', (() => { const d = w.retryDecision({ failures: 1, nextAt: 1000 + 5 * MIN }, 1000); return !d.go && d.waitMs === 5 * MIN && d.attempt === 2; })());
t('fresh state goes at once', w.retryDecision(null, 5).go === true);

// --- streak reset after stable run ---
t('stable for STABLE_MS -> reset', w.maybeReset({ failures: 3, nextAt: 99 }, 0, w.STABLE_MS).reset === true);
t('not yet stable -> kept', (() => { const s = { failures: 3, nextAt: 99 }; return w.maybeReset(s, 0, w.STABLE_MS - 1) === s; })());
t('no failures -> nothing to reset', !w.maybeReset({ failures: 0, nextAt: 0 }, 0, 1e9).reset);
t('never healthy -> kept', w.maybeReset({ failures: 2, nextAt: 5 }, null, 1e9).failures === 2);

// --- supervisorOwnsRecovery ---
t('manual stop is not a failure', w.supervisorOwnsRecovery({ manualStop: true, state: 'stopped' }, now));
t('retry already scheduled by the supervisor', w.supervisorOwnsRecovery({ state: 'stopped', retryAt: now + MIN }, now));
t('stopped, nothing scheduled -> tray acts', !w.supervisorOwnsRecovery({ state: 'stopped', retryAt: null }, now));
t('retry time passed and still stopped -> tray acts', !w.supervisorOwnsRecovery({ state: 'stopped', retryAt: now - 1 }, now));
t('starting/stopping -> leave alone', w.supervisorOwnsRecovery({ state: 'starting' }, now) && w.supervisorOwnsRecovery({ state: 'stopping' }, now));
t('running -> tray acts only on lock/heartbeat', !w.supervisorOwnsRecovery({ state: 'running' }, now));

// --- scenario: last night (supervisor + tray gone, watcher died) ---
(() => {
  const sup = w.judgeProcess({ exists: true, pid: 555 }, false, null, 'supervisor');
  t('scenario: supervisor lock stale -> not ok and would be restarted at once', !sup.ok && w.retryDecision({ failures: 0, nextAt: 0 }, now).go);
})();

console.log(fail ? fail + ' FAILED, ' + pass + ' passed' : 'all ' + pass + ' passed');
process.exit(fail ? 1 : 0);
