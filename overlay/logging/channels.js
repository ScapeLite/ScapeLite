// ScapeLite logging: the channel registry. A channel is a named stream of log lines with its own folder under Logs/,
// its own file-name prefix and its own defaults. Adding a channel = adding one entry here; nothing else changes.
//
//   dir        sub-folder of Logs/ (default: the channel name)
//   prefix     file-name prefix: <prefix>_<YYYY-MM-DD_HH-MM-SS>.log
//   streams    optional sub-streams with their own prefix, e.g. Tasks -> Skilling_Tasks_..., Slayer_Tasks_...
//   structured also write a machine-readable .jsonl next to the .log (one JSON object per line)
//   humanData  append the structured data to the human line as compact JSON (off where the message already says it)
//   history    long-lived record of what the player did (kept for historyDays, default 90) rather than diagnostics
//   keepDays   fixed retention for this channel (otherwise the global keepDays / historyDays)
//   level      default minimum level
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAMES = ['debug', 'info', 'warn', 'error'];

const CHANNELS = {
  System:   { prefix: 'System',        desc: 'Supervisor: start, stop, restarts, dashboard, game launch and data extraction.' },
  Watcher:  { prefix: 'Watcher',       desc: 'The watcher: game connection, plugin injection, settings sync, bridge health.' },
  Discord:  { prefix: 'Discord',       desc: 'Everything relayed or posted to Discord: chat relay, hiscores, raid summaries, digest.' },
  Plugins:  { prefix: 'Plugins',       desc: 'General messages from the in-game plugins (anything that is not a more specific channel).' },
  Tasks:    { prefix: 'Tasks', streams: { skilling: 'Skilling_Tasks', slayer: 'Slayer_Tasks' }, structured: true, humanData: false, history: true,
              desc: 'Every task you run, one record per finished task: time split, XP, prediction. The Task Log can be rebuilt from these.' },
  Fortress: { prefix: 'Fortress_Runs', structured: true, humanData: false, history: true, desc: 'Fortress runs: waves, rates, result.' },
  Drops:    { prefix: 'Drops', streams: { fortress: 'Fortress_Drops' }, structured: true, humanData: false, history: true, desc: 'Notable drops the trackers saw.' },
  Alerts:   { prefix: 'Alerts',        structured: true, humanData: false, keepDays: 30, desc: 'What the alerts bell raised (unspent points, finished quests, chests...).' },
  Perf:     { prefix: 'Perf',          structured: true, humanData: false, keepDays: 7,  desc: 'Per-minute performance samples of the page and each plugin.' },
  Errors:   { prefix: 'Errors',        desc: 'Every warning and error from every channel, in one place.' },
};
for (const k of Object.keys(CHANNELS)) { CHANNELS[k].name = k; CHANNELS[k].dir = CHANNELS[k].dir || k; }

// Which channel a legacy { cat, sub, text } entry (from the watcher's log() and the supervisor's sysLog()) belongs to.
function legacyChannel(entry) {
  if (entry.ch && CHANNELS[entry.ch]) return entry.ch;
  if (entry.cat === 'discord') return 'Discord';
  if (entry.sub === 'supervisor') return 'System';
  return 'Watcher';
}
function legacyLevel(entry) {
  if (entry.level && LEVELS[entry.level]) return entry.level;
  const t = String(entry.text || '');
  if (/\bERROR\b|\bfailed\b|exception/i.test(t)) return 'error';
  if (/\bWARNING\b/i.test(t)) return 'warn';
  return 'info';
}

module.exports = { CHANNELS, LEVELS, LEVEL_NAMES, legacyChannel, legacyLevel };
