// One copy of the supervisor and one copy of the watcher, ever. A second copy would double every Discord post (activity digest, hiscores, raid
// summaries), fight the first over the same state files and the same game connection. The lock is a small file holding the owner's pid, kept in the
// per-user state folder (overlay/ in a checkout, SCAPELITE_HOME when installed). A lock whose pid is no longer alive is stale and is taken over.
'use strict';

const fs = require('fs');
const P = require('./paths');

const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* no sleep: the retry loop just spins faster */ } };
const alive = (pid) => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readPid = (file) => { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch (e) { return 0; } };

// acquire(name, { waitMs }) -> { ok, owner, release }. waitMs: how long an owner that is shutting down may take to let go (a watcher restart).
function acquire(name, opts) {
  const file = P.state(name + '.lock'), waitMs = (opts && opts.waitMs) || 0, until = Date.now() + waitMs;
  let owner = 0;
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });            // atomic: fails when the file exists
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: true, owner: 0, release() {} };   // cannot lock (read-only folder ...): never block the program for that
      owner = readPid(file);
      if (owner === process.pid) break;
      if (!alive(owner)) { try { fs.unlinkSync(file); } catch (er) { /* someone else took it over: loop again */ } continue; }
      if (Date.now() >= until) return { ok: false, owner, release() {} };
      sleep(250);
    }
  }
  let released = false;
  const release = () => { if (released) return; released = true; try { if (readPid(file) === process.pid) fs.unlinkSync(file); } catch (e) { /* already gone */ } };
  process.on('exit', release);
  return { ok: true, owner: 0, release };
}

module.exports = { acquire };
