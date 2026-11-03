# Watchdog: ScapeLite notices when a part is not running and restarts it

Why: on 2026-10-27 the watcher died around 22:33, the supervisor and the tray were already gone (supervisor log ended 13:47), so the
Discord relay posted nothing all night and nobody noticed. Now every part is checked, every problem is logged to `Logs/System/`, and
a missing part is restarted by ScapeLite itself.

## Parts and who watches whom

| Part | Watched by | How it is checked |
| --- | --- | --- |
| Watcher (`overlay/panel-resize-watcher.js`) | the supervisor (its parent) and the tray | exit event; `overlay/watcher.lock`; heartbeat file |
| Supervisor (`overlay/supervisor.js`) | the tray | `overlay/supervisor.lock` |
| Tray (`app/main.js`) | nobody (see proposals) | - |

## Restart policy (identical everywhere)

1. Problem seen: restart **at once** (retry 1).
2. Still failing: restart **about 5 minutes later** (retry 2).
3. After that: one try **every 10 minutes**, for as long as it takes. No tight loops, one log line per attempt.
4. The streak starts over when the part has been healthy for 3 minutes (the supervisor: the watcher stayed up 3 minutes), so a crash a
   day later is retried at once again. A start from the dashboard or tray menu also starts a fresh streak.

Not a failure, left alone: a watcher stopped with the dashboard's Stop button (`supervisor.manualStop`), a supervisor that is starting or
stopping, and a retry the supervisor has already scheduled (`supervisor.retryAt`). The supervisor retries its own watcher; the tray only
steps in if the supervisor is gone or has gone quiet.

## The tray check (every 60 s, first one 45 s after start)

* Reads `supervisor.lock` / `watcher.lock`. Verdicts: `missing` (no file), `dead` (pid not running: stale lock), `reused` (pid alive but
  its command line does not contain `supervisor.js` / `panel-resize-watcher.js`: Windows reuses pids), `running`, `unverified` (alive,
  command line unreadable: counted as running). The command line comes from one hidden PowerShell `Get-CimInstance` per check.
* Before the first restart of a streak it waits 12 s and looks again (a "Restart ScapeLite service" from the dashboard has the lock gone
  for a moment).
* Supervisor bad: starts it exactly as the tray does at startup (`electron.exe` as node, `overlay/supervisor.js`, hidden). If the lock is
  missing but the dashboard port still answers, it logs that and does not start a rival.
* Supervisor fine, watcher lock bad: `POST /api/watcher/start`.
* Supervisor and watcher alive, **heartbeat stale** (over 5 min): `POST /api/watcher/restart`. The watcher touches
  `overlay/watcher-heartbeat.local.json` every 30 s (`{t, pid, cdp, loopAt}`); `loopAt` is the last tick of the 3 s page loop, so a
  process that is alive while connected to the game but whose loop stopped is also caught. A start gets grace (the lock's age counts).
* Tray menu: a disabled line `Last problem: ... (time)` (shown after right-click).

## Logs written (Logs/System, text starts with the tag)

* `[supervisor] watcher started (pid N)`
* `[supervisor] watcher exited (code C | signal S) after Ns -- UNEXPECTED` or `-- stopped on request, not restarting`
* `[supervisor] PROBLEM: <reason> -- retry 1: restarting at once` / `retry 2: restarting in 5 min (at HH:MM)` / `slow retry K: restarting in 10 min`
* `[supervisor] restart attempt N: starting the watcher`, `watcher had been stable for N min -- failure streak reset`
* `[tray] watchdog started ...`
* `[tray] PROBLEM: <why> -- restart attempt N (at once | +5 min | slow retry); if it is still down the next try is in X`
* `[tray] supervisor is back (dashboard answers)`, `... did not answer within 20 s`, `<part> has been healthy again for 3 min -- failure streak reset`
* `[tray] PROBLEM: supervisor pid is alive but its dashboard does not answer` (logged once, nothing is killed)

## Limits

* The tray is the top of the chain. If the tray is closed ("Quit ScapeLite" keeps the service but ends the check), nothing restarts a dead supervisor.
* If the whole PC is asleep or off, nothing runs (and the relay lease hands over to another PC, see `docs/DISCORD-RELAY-AUDIT.md`).
* Supervisor alive but dashboard silent is only logged. Killing a live process is not done automatically.
* A changed `supervisor.js` / `panel-resize-watcher.js` / `watchdog.js` loads only after a restart of the service; `app/main.js` after restarting the tray app.

## Tests

`npm run test:watchdog` (`scripts/test-watchdog.js`): pure simulation of dead pid, stale lock, reused pid, unreadable command line, stale and
young heartbeat, the 0 / +5 / +10 min schedule over two simulated hours (13 attempts, no loop), streak reset and the "supervisor owns
recovery" rules. It never reads a real lock or touches the running service. Not covered by tests: the real restart paths (spawning the
supervisor from the tray, the supervisor timer), checked by code reading only.

## Proposals (not done, need a decision)

* **Windows Scheduled Task** (at log-on and every 5 minutes: start the tray app if it is not running). Closes the "tray is gone" gap. It is
  persistence outside the repo, so it was not created.
* **Push alert** (for example Pushover) when a part stays down for 15 min or the relay has posted nothing for hours. Outbound notification,
  not added.
* Relay "silence" detector: warn when the game is running but the relay has posted nothing for N hours.
