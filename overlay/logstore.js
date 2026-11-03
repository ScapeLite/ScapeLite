// ScapeLite logging, process singleton. The real work lives in overlay/logging/ (see docs/LOGGING.md); this module wires it to
// this install's folders (overlay/paths.js: Logs/ next to the code, or SCAPELITE_HOME/Logs in the installed app) and to
// overlay/log-config.json, and keeps the small API the supervisor and watcher have always used (write, config, saveConfig,
// prune, info).
//
//   Logs/<Channel>/<Prefix>_<YYYY-MM-DD_HH-MM-SS>.log   e.g. Logs/Tasks/Skilling_Tasks_2026-10-20_09-15-02.log
//
// The supervisor owns the files (every log line, including the watcher's and the in-game plugins', passes through it);
// a standalone watcher uses the same module. Nothing here reads or writes game state.
'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { createLogSystem, normalizeConfig } = require('./logging');
const { createReader } = require('./logging/reader');

let version = '';
try { version = JSON.parse(fs.readFileSync(path.join(P.ROOT, 'package.json'), 'utf8')).version || ''; } catch (e) { /* ignore */ }

const LOG_DIR = P.logs;
const CONFIG_PATH = P.state('log-config.json');
const system = createLogSystem({ dir: LOG_DIR, configPath: CONFIG_PATH, version });
const reader = createReader(system);

let started = false;
function start() {            // idempotent; the owning process calls it once (migrates old flat logs, writes Logs/README.txt)
  if (started) return null;
  started = true;
  const m = system.start();
  system.pruneAll(true);
  return m;
}
function write(entry) { if (!started) start(); system.write(entry); }
function ingest(entries, meta) { if (!started) start(); return system.ingest(entries, meta); }
function channel(name, stream) { if (!started) start(); return system.channel(name, stream); }

process.on('exit', () => { try { system.flushSync(); } catch (e) { /* never */ } });

module.exports = {
  write, ingest, channel, start,
  config: system.config, saveConfig: system.saveConfig, prune: () => system.pruneAll(true), info: system.info,
  flush: system.flush, flushSync: system.flushSync,
  channelEnabled: (name) => { const o = system.config().channels[name]; return !o || o.enabled !== false; },
  normalize: normalizeConfig,
  system, reader, LOG_DIR,
};
