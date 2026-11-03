# Logging and local data: what exists, where it lives, and where it should go

Audit date 2026-10-20. Everything below stays on the player's computer; nothing is uploaded (the only outbound
traffic is the Discord posts the player configured and the optional daily usage count).

## 1. What exists today

| Store | Where | Format | Written by | Retention | Contains |
| --- | --- | --- | --- | --- | --- |
| Run logs | `Logs/<Channel>/<Prefix>_<date_time>.log` (+ `.jsonl` for structured channels) | text lines, JSON lines | `overlay/logging/` (core logger), `overlay/logstore.js` (legacy writer), page side `overlay/log-client.js` | `keepDays` 14 for diagnostics, `historyDays` 90 for history channels (Tasks, Fortress, Drops), size caps `maxFileMB` 5 / `maxTotalMB` 100 (`overlay/log-config.json`) | watcher/supervisor/Discord/perf/alerts diagnostics and, since this change, one record per finished task (Tasks channel) |
| Task Log | browser localStorage `cc-task-log` | JSON array of records, schema v2 (see 3) | `overlay/task-log.js` | newest 2000 records (about 0.7 MB), no age limit | every task run: time split, XP, plan, drops, materials, potions, gold |
| Fortress tracker | localStorage `cc-fortress-v1` | `{v:1, runs, drops, active}` | `overlay/fortress-tracker.js` | last 300 runs, 1000 drops | Fortress runs and drops |
| Drop luck prefs | localStorage `cc-droplog-*` | small JSON / strings | `overlay/drop-luck.js` | until cleared | panel position, tab, mob preferences (the luck maths itself is recomputed, not stored) |
| Chat history | localStorage `cc-chat-log:v1`, config `cc-chat:v1` | JSON array, last 400 messages | `overlay/chat-plus.js` | 400 messages | clan / game chat the player saw (contains other players' names and text) |
| Clan hiscores state | `State/clan-hiscores-state.json` | JSON | watcher | overwritten | last posted rank / member snapshot, to avoid duplicate Discord posts |
| Chat relay | `State/chat-relay-seen.json`, `chat-relay-outbox.json` | JSON arrays | watcher | rolling dedup list (about 60 KB) | ids of relayed chat events, pending posts |
| Digest | `State/digest-state.json` (+ `digest-config.json`) | JSON | watcher | grows (about 65 KB now) | what the Discord digest already reported |
| Watcher log | `overlay/watcher.log` | text | watcher (`log()`) | rotated by size: at 1 MB it becomes `overlay/watcher.1.log` (one backup, both ignored by git; `overlay/log-rotate.js`) | the original watcher log; the same lines now also go to `Logs/Watcher/` |
| Settings | `overlay/plugins-config.json`, `log-config.json`, `local-config.json`, localStorage `cc-*` UI keys (panel positions, `cc-panel-fuse`, layouts) | JSON | settings UI / panels | until cleared | preferences, layouts |
| Secrets | `chat-relay-config.json`, `clan-hiscores-config.json`, `digest-config.json`, `raid-summary-config.json` | JSON | the player | forever | Discord webhook URLs (git-ignored; never logged, `overlay/logging/redact.js` strips them) |

The Tasks channel is new in the core logger: each finished task is also written as one JSON line to
`Logs/Tasks/Skilling_Tasks_*.jsonl` or `Slayer_Tasks_*.jsonl` (history retention, 90 days by default).

## 2. Privacy

* Local only. The page cannot write files, so it hands entries to the watcher over the DevTools connection it already uses.
* Task records hold no personal data: activity ids, node ids, counts, XP, item ids, gold change. No names, no chat.
* Chat history (`cc-chat-log:v1`) is the one store with other people's text; it stays in the browser profile and is never put in Logs/.
* The logger redacts webhook URLs and tokens before anything is written. Logs are readable at `http://localhost:7777/logs`.
* Bug reports and the exporter should be the only way data leaves, and only by the player's action (the Task Log download is a file the player saves).

## 3. Task Log schema (v2)

Records without `v` are version 1 and stay valid; every v2 field is optional so readers must tolerate its absence.

* v1: `ts` start (s), `kind` skill|slay, `skill`, `act` activity or mob id, `node`, `qty`, `done`, `lucky`, `completed`, `partial` (joined mid-task), `end` (next|closed), `secs{total,moving,acting,banking}`, `xp{skill:xp}`, `xpSum`, `pred{dash,dashXp,xp,bonus,adv}`.
* v2 adds: `v:2`, `te` end (s), `n` the game's own lifetime counter when the task was seen completing, `gain{itemId:qty}` and `use{itemId:qty}` (bank plus inventory deltas, biggest 20 each, gold excluded), `gp` net gold, `pot{style:[potionId, used, endedFlag]}` (attacks, yards or charges spent; endedFlag 1 = potion ended or was swapped, so `used` is a lower bound).
* Caveat: item deltas are measured over the task window, so anything else the player does meanwhile (selling, eating by hand, banking trips are neutral) shows up as noise.
* Export (`Settings > Plugins > Download Task Log`) writes `{app, schema, exported, tasks, summary}`.

## 4. Why the game's Slay History is empty

The Skills Customization window builds its history from `taskHistory`, a list the server sends (last 200 tasks, newest first). The total
view lists all of it; a per-skill view filters it by skill. Slay tasks are never in that list (the game keeps only a counter,
`slayTask.tasksCompleted`, which is what the "109 Slay tasks completed" header shows), so the Slay view always finds zero. It is a
different store, not a rendering bug. Likewise `1023 total tasks completed` is the sum of the per-skill counters and excludes slay.
The real lifetime number of history row `i` is therefore `total - i` (exact); slay numbers are exact only for records the recorder saw
complete (`n`) and otherwise estimated by counting back from the slay counter along Task Log order (shown with a `~`).

## 5. Recommended unified design

Goal: one place to look, one schema, bounded size, nothing lost on a browser-profile reset.

1. **Single write path.** Every plugin writes through `window.__ccLog.channel(name, stream)`; the core logger owns files, rotation, redaction and retention. No plugin writes its own files; legacy `logstore.js` becomes a shim over the core.
2. **Two classes of data.** Diagnostics (System, Watcher, Plugins, Perf, Errors, Discord): short retention (7 to 14 days). History (Tasks, Fortress, Drops, Alerts): long retention (90 days or more), `.jsonl` is the source of truth.
3. **Page storage is a cache, files are the archive.** localStorage keeps only what the UI needs quickly (Task Log newest 2000, Fortress 300 runs, chat 400). On startup a plugin can rebuild from `Logs/<Channel>/*.jsonl` through the watcher (reader API in `overlay/logging/reader.js`) if its cache is empty, so clearing the browser profile no longer loses history.
4. **One record envelope.** `{t, ch, st, lv, m, d}` already exists; keep domain payloads under `d.rec` with a `v` per payload kind and never change a field's meaning inside a version.
5. **Size budget.** localStorage total target under 2 MB for ScapeLite (browser limit about 5 MB shared with the game); files capped by `maxTotalMB`. Compact fields, caps per record (20 items), no free text.
6. **Export and privacy.** One "Export my data" action that zips the history channels plus the Task Log JSON; one "Delete my data" that clears Logs/ history and the caches. Chat stays out of files unless the player enables it.

Prioritised plan:

* P0 (done): Tasks channel receives every finished task record; Task Log schema v2; this document.
* P1 (done): the watcher rebuilds the Task Log cache from `Logs/Tasks/*.jsonl` when localStorage is empty (`__ccTaskLog.restore`).
* P1 (done): Fortress runs and drops go to the Fortress and Drops channels; the alerts bell writes the Alerts channel.
* DONE (log-003): `chat-relay-seen`, `digest-state` and `clan-hiscores-state` live in a `State/` folder next to the config files (`overlay/State/` in a checkout, `%APPDATA%/ScapeLite/State/` installed). The watcher moves them there once at start (`migrateRuntime` in `overlay/paths.js`: copy, check, then the old file is renamed `<name>.moved` as a safety copy; a file that cannot be moved stays where it is). Config writes (plugins, clan hiscores, digest, relay, board) use the shared atomic writer `overlay/safe-json.js` (temp file, rename; no `.bak` for configs that hold webhooks). The digest buffer is already capped (1000 dedup keys, buffer reset after each post). `State/`, `*.moved` and `*.bak` are git-ignored and excluded from the installer; `npm run test:state` covers the move.
* ~~P2: trim `overlay/watcher.log`~~ done 2026-10-28: rotated at 1 MB with one backup (`npm run test:logrotate`).
* P3: unified export / delete UI, and a "what is stored" panel listing sizes per store.

---

# Part 2: the core logging system (reference)

One core logging system owns every log file. Logs stay on this computer, secrets are redacted before anything is written, and nothing in it reads or writes game state.

### Layout

`Logs/` (next to the code in a checkout, `SCAPELITE_HOME/Logs` in the installed app) has one sub-folder per channel. File names start with what they log, then the time the file was started:

```
Logs/
  README.txt
  System/    System_2026-10-20_09-15-02.log                supervisor: start/stop/restart, dashboard, game launch
  Watcher/   Watcher_...                                    game connection, plugin injection, settings sync
  Discord/   Discord_...                                    chat relay, hiscores, raid summaries, digest
  Plugins/   Plugins_...                                    general messages from in-game plugins
  Tasks/     Skilling_Tasks_2026-10-20_09-15-02.log (+ .jsonl)
             Slayer_Tasks_2026-10-20_09-15-02.log   (+ .jsonl)
  Fortress/  Fortress_Runs_...  (+ .jsonl)
  Drops/     Drops_..., Fortress_Drops_...  (+ .jsonl)
  Alerts/    Alerts_...  (+ .jsonl)
  Perf/      Perf_...  (+ .jsonl)
  Errors/    Errors_...                                     every warning and error from every channel
```

A new file starts when ScapeLite starts, at local midnight and when a file passes the size limit (default 5 MB). Two files never share a name (a clash gets `-2`).

**Two formats.** `.log` is for people: `2026-10-20 09:15:02.123 INFO  [Tasks/slayer] message`. `.jsonl` is for tools, one JSON object per line: `{"t":epochMs,"lv":"info","ch":"Tasks","st":"slayer","m":"message","d":{...}}`. Only channels that carry data write `.jsonl` (Tasks, Fortress, Drops, Alerts, Perf); the human line of those channels is a summary sentence and the data lives in `d`. This keeps `.log` readable and makes `.jsonl` the lossless source (the Task Log is rebuilt from it).

**Viewing.** Dashboard: http://localhost:7777/logs (browse channels and files, live tail, filter by text and level, search everything, open the folder, download the Task Log rebuilt from the files). In game: Settings > Plugins > Logs > Open Logs Folder. The tray menu also opens the folder.

### Code

| Piece | File |
| --- | --- |
| Channel registry (add a channel = add one entry) | `overlay/logging/channels.js` |
| Core: levels, rotation, retention, buffered writes, migration, config | `overlay/logging/index.js` (`createLogSystem`) |
| Secret redaction | `overlay/logging/redact.js` |
| Read side: tail, search, structured records, Task Log rebuild | `overlay/logging/reader.js` |
| Process singleton + old API (`write`, `config`, `saveConfig`, `prune`) | `overlay/logstore.js` |
| In-game API | `overlay/log-client.js` (`window.__ccLog`) |
| Dashboard viewer | `overlay/logs-page.js`, routes in `overlay/status-server.js` |

One process owns the files: the supervisor in the installed app (the watcher forwards its lines and the in-game lines over IPC); a standalone watcher uses the module directly.

Guarantees: log calls never throw; memory is bounded (write queue capped at 6000 lines, flushed every 400 ms with async appends, synchronously only on exit; a message is capped at 4000 characters, data at 16000); only files matching our own naming (`<Prefix>_<date>_<time>[-n].log|jsonl`) are ever pruned; channel and stream names from the page are looked up in the registry, never used as paths.

### Levels

`debug < info < warn < error`. Anything `warn` or above is also copied to the Errors channel. Default minimum is `info`; Settings > Plugins > Logs > Log Detail changes it.

### In-game API

```js
const log = window.__ccLog && window.__ccLog.channel('Tasks', 'slayer');   // channel, optional stream
log && log.info('Slayer goblin done in 312s', { rec: record });            // debug | info | warn | error
```

Streams are declared per channel (`Tasks`: `skilling`, `slayer`; `Drops`: `fortress`); an unknown stream uses the channel's default prefix and an unknown channel lands in Plugins. The page cannot write files, so entries go to an in-page ring buffer (1000 entries, overflow dropped and counted). The watcher drains it every 3 s over the existing DevTools connection (and once more on shutdown) and the supervisor ingests the batch. Entries not drained before the page unloads are kept in `localStorage` (`cc-log-pending`, at most 300) and sent after the next load. Keep your own localStorage stores: files are an additional durable history.

Page code must never log secrets. The logger redacts webhook URLs, bearer tokens, `token=` / `password=` / `apiKey` style values, secret-looking data keys and the user name in Windows or unix home paths, but that is a safety net.

### Task Log recovery

Every finished task is logged as `{ rec }` to `Tasks/*` (the `.jsonl` keeps the full record). If the Task Log in the browser is empty (site data cleared) the watcher refills it from those files about 20 s after connecting (`__ccTaskLog.restore`). The dashboard's "Task Log from files" link (`/api/logs/export/tasks`) downloads the same records as JSON.

### Config: `overlay/log-config.json`

Edited in game (Settings > Plugins > Logs) or by hand; re-read every few seconds. Defaults:

```json
{
  "enabled": true, "level": "info",
  "keepDays": 14, "historyDays": 90,
  "maxFileMB": 5, "maxTotalMB": 100,
  "daily": true, "structured": true,
  "channels": { "Perf": { "enabled": false }, "Watcher": { "level": "debug", "keepDays": 3 } }
}
```

`keepDays` applies to diagnostic channels, `historyDays` to Tasks, Fortress and Drops; Alerts keep at most 30 days and Perf 7. `maxTotalMB` is per channel folder (oldest files go first). Per-channel overrides: `enabled`, `level`, `keepDays`, `maxFileMB`, `maxTotalMB`, `structured`. Unknown channel names and bad values are ignored.

### Migration

On start the supervisor moves old flat `Logs/<date>_<time>.log` run logs to `Logs/System/System_<date>_<time>.log` (rename only; it never deletes or overwrites, a clash gets a numeric suffix) and writes `Logs/README.txt`.

### Adding a channel

Add an entry in `overlay/logging/channels.js` (prefix, optional streams, `structured`, `history`), then log to it. Add a toggle in `overlay/plugins-settings-ui.js` and `LOG_CHANNEL_TOGGLES` in the watcher if users should be able to switch it.

### Tests

`npm run test:log` covers rotation, retention, migration, naming, redaction, config, the reader and the page API path.
