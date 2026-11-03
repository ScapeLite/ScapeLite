// ScapeLite watchdog helpers: decide whether the supervisor and the watcher are really running, and when a restart may be tried.
// The decision functions are pure (no clock, no process, no files) so scripts/test-watchdog.js can simulate dead pids, stale locks and
// reused pids. The small I/O helpers at the bottom (heartbeat file, command-line lookup) are only used by the real service.
// Display-only tooling: nothing here touches the game, Discord or anything outside this folder / the per-user state folder.
'use strict';

const fs = require('fs');

const HEARTBEAT_FILE = 'watcher-heartbeat.local.json';
const HEARTBEAT_EVERY_MS = 30 * 1000;       // the watcher touches the file this often
const HEARTBEAT_MAX_AGE_MS = 5 * 60 * 1000; // older than this = the process lives but its loops stopped
const CHECK_EVERY_MS = 60 * 1000;           // how often the tray looks
const STABLE_MS = 3 * 60 * 1000;            // healthy for this long = the failure streak is over

// Restart policy: the 1st failure of a streak is retried at once, the 2nd about 5 minutes later, every later one every 10 minutes.
// `failures` = how many restart attempts this streak already made (0 = none yet).
const RETRY_DELAYS_MS = [0, 5 * 60 * 1000];
const SLOW_RETRY_MS = 10 * 60 * 1000;
function retryDelay(failures) { return failures < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[failures] : SLOW_RETRY_MS; }

// What the policy says now. state = { failures, nextAt } (nextAt: epoch ms of the earliest next attempt, 0 = now).
function retryDecision(state, now) {
  const s = state || { failures: 0, nextAt: 0 };
  if (now >= (s.nextAt || 0)) return { go: true, attempt: s.failures + 1, waitMs: 0 };
  return { go: false, attempt: s.failures + 1, waitMs: s.nextAt - now };
}
function afterAttempt(state, now) {
  const failures = ((state && state.failures) || 0) + 1;
  return { failures, nextAt: now + retryDelay(failures) };
}
// A streak ends once the thing has been healthy for STABLE_MS (the caller passes the time it was first seen healthy, or null).
function maybeReset(state, healthySince, now) {
  if (state && state.failures && healthySince != null && now - healthySince >= STABLE_MS) return { failures: 0, nextAt: 0, reset: true };
  return state || { failures: 0, nextAt: 0 };
}

// Is the process behind a lock file really ours? Inputs only: no lookups here.
//   lock: { exists, pid }  alive: bool  cmdline: string | null (null = could not be read)  name: 'supervisor' | 'watcher'
// -> { ok, verdict, why }   verdict: running | missing | dead | reused | unverified (alive, command line unreadable: counted as running)
const MARKERS = { supervisor: 'supervisor.js', watcher: 'panel-resize-watcher.js' };
function judgeProcess(lock, alive, cmdline, name) {
  if (!lock || !lock.exists) return { ok: false, verdict: 'missing', why: name + ' lock file is missing' };
  if (!(lock.pid > 0)) return { ok: false, verdict: 'missing', why: name + ' lock file holds no pid' };
  if (!alive) return { ok: false, verdict: 'dead', why: name + ' lock names pid ' + lock.pid + ' which is not running (stale lock)' };
  if (cmdline == null || cmdline === '') return { ok: true, verdict: 'unverified', why: 'pid ' + lock.pid + ' is alive (command line unreadable)' };
  if (String(cmdline).toLowerCase().indexOf(MARKERS[name]) < 0) return { ok: false, verdict: 'reused', why: name + ' lock names pid ' + lock.pid + ' which now belongs to another program (pid reused)' };
  return { ok: true, verdict: 'running', why: 'pid ' + lock.pid };
}

// Heartbeat: hb = { mtimeMs, cdp, loopAt } or null (no file); lockMtimeMs = when the watcher lock was written (a start is given grace).
function judgeHeartbeat(hb, lockMtimeMs, now, maxAgeMs) {
  const max = maxAgeMs || HEARTBEAT_MAX_AGE_MS;
  const ref = Math.max((hb && hb.mtimeMs) || 0, lockMtimeMs || 0);
  if (!ref) return { ok: true, verdict: 'unknown', why: 'no heartbeat and no lock time to compare' };
  const age = now - ref;
  if (age > max) return { ok: false, verdict: 'stalled', why: 'no heartbeat for ' + Math.round(age / 1000) + 's (limit ' + Math.round(max / 1000) + 's): the process is alive but its loops stopped' };
  if (hb && hb.cdp && hb.loopAt && now - hb.loopAt > max) return { ok: false, verdict: 'loop-stalled', why: 'connected to the game but the main loop has not run for ' + Math.round((now - hb.loopAt) / 1000) + 's' };
  return { ok: true, verdict: 'fresh', why: 'heartbeat ' + Math.round(age / 1000) + 's old' };
}

// The supervisor reports its own state; a manual Stop on the dashboard, or a retry the supervisor has already scheduled, is not a failure.
function supervisorOwnsRecovery(sup, now) {
  if (!sup) return false;
  if (sup.manualStop) return true;
  if (sup.state === 'starting' || sup.state === 'stopping') return true;
  return !!(sup.retryAt && sup.retryAt > now);
}

// ---- real-service helpers (not used by the tests) ----
function alivePid(pid) { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function readLock(file) {
  try { const st = fs.statSync(file); return { exists: true, pid: parseInt(fs.readFileSync(file, 'utf8'), 10) || 0, mtimeMs: st.mtimeMs }; } catch (e) { return { exists: false, pid: 0, mtimeMs: 0 }; }
}
function commandLine(pid, cb) { // async, windowsHide, 8 s cap; cb(null) when it cannot be read
  let done = false; const fin = (v) => { if (!done) { done = true; cb(v); } };
  try {
    const cp = require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_Process -Filter 'ProcessId=" + (pid | 0) + "').CommandLine"], { windowsHide: true, timeout: 8000 }, (err, out) => fin(err ? null : String(out || '').trim() || null));
    cp.on('error', () => fin(null));
  } catch (e) { fin(null); }
}
function beat(file, extra) { try { fs.writeFileSync(file, JSON.stringify(Object.assign({ t: Date.now(), pid: process.pid }, extra || {}))); } catch (e) { /* read-only folder: the watchdog then sees no heartbeat and grace-covers it */ } }
function readBeat(file) {
  try { const st = fs.statSync(file); const j = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; return { mtimeMs: st.mtimeMs, cdp: !!j.cdp, loopAt: j.loopAt || 0, pid: j.pid || 0 }; } catch (e) { return null; }
}

module.exports = { HEARTBEAT_FILE, HEARTBEAT_EVERY_MS, HEARTBEAT_MAX_AGE_MS, CHECK_EVERY_MS, STABLE_MS, SLOW_RETRY_MS, retryDelay, retryDecision, afterAttempt, maybeReset, judgeProcess, judgeHeartbeat, supervisorOwnsRecovery, alivePid, readLock, commandLine, beat, readBeat };
