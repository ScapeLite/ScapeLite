# Task Option Log, and the measured correction for slay totals

Two small tools that came out of the roll model calibration (docs/ROLL-MODEL-CALIBRATION.md, roadmap adv-030 and adv-031). Both are display only.

## Task Option Log (`overlay/option-log.js`, `overlay/option-log-store.js`)

**Why.** The task history and the task log only contain what you picked, and you pick lucky and near tasks on purpose. To test the roll itself (skill shares, activity shares, the lucky chance) the options that were *offered* have to be written down.

**What is recorded.** Every queue slot offers 3 options (one slay task and two skilling tasks). The recorder watches the queue every 3 seconds (`__ccBridge.project()`), and when a set of options is gone (its slot finished or was rerolled away) it hands over one row:

| Field | Meaning |
|---|---|
| `g` | the set's signature (kind, skill, activity, node of each option) |
| `t`, `te` | first and last time it was seen (seconds) |
| `sel` | the option that was selected last |
| `init` | 1 when the set was already on screen when the page loaded |
| `sp` | the share of the roll of every skill in percent, at that moment |
| `o[]` | per option: `k` skill or slay, `s` skill, `a` activity or mob, `n` node, `q` quantity, `l` lucky, `ps` the skill's share, `pa` the activity's (or mob's) share, `pt` the whole table that share came from, `lv` lever, `lk` the skill's chance of a lucky task |

The odds are the game's own (`oddsSkills`, `oddsTiers`, `oddsSlay` of the bridge), so a row needs no lever history to be read later.

**Privacy.** No player name, no chat, no account data. It stays on this PC: the page keeps at most 600 unsent rows in memory; the watcher appends them to `State/option-log.json` (deduplicated, newest 2500 sets kept, written atomically through `safe-json.js`). Nothing is sent anywhere. `State/` is never packaged (`test:package` pins it).

**Switch and removal.** Settings > Plugins > Levers And Task Log > *Task Option Log*. To delete the data, delete `State/option-log.json` (or the *Delete my data* tool, log-004, when it exists). For the "what is stored" panel (log-005) and the data export (log-004): this is one more file in `State/`, about 2 to 4 MB when full, one row per queue slot.

**Reading it.** `node scripts/option-log-report.js` (or `--json`, or a path). Each test waits for 300 offered options of its kind and says how far along it is until then:

* skill mix: observed skills against the sum of the stored skill tables (chi-square),
* activity and mob: observed against the stored table each option came from (chi-square),
* lucky: skilling options against each skill's own chance, slay options against the game's 3% cap (z),
* independence of the two skilling options of a slot (same skill twice against the chance of that),
* what was picked (not a test of the roll).

A p below 0.01 or a |z| above 3 means the roll does not follow the game's own table. Node odds are not tested: the node levers are not readable through the bridge.

**Tests.** `npm run test:option-log` (page recorder against a fake bridge, the store, the report on logs made from known odds and on deliberately skewed ones).

## Measured correction for slay task totals (`overlay/task-log.js`: `slayK`)

**Why.** Since 2026-10-22 a slay task pays and takes about 1.5 times what the game's dashboard shows per task, while XP an hour is still right (calibration report, section 7).

**What it does.** The queue panel (row time and XP, the head's time left, the queue's total time, the option pop-up) and the option cards of the Info Bar multiply a **slay** task's total time and total XP by a factor learned from your newest 15 finished slay tasks: the median of acting seconds / predicted seconds, and of real XP (without Luck and Alms XP) / predicted XP, each clamped to 0.8 to 2.5. With fewer than 5 usable tasks it uses 1.5 and says *Estimated correction*; with enough it says *Measured correction*, shows both factors and the number of tasks, and says that XP an hour is not changed. The Task Log keeps the game's raw prediction, so the correction is always measured against the unadjusted number.

**What it never touches.** XP an hour, the Route Advisor, the Lever Advisor and every ranking. Switch: Settings > Plugins > Levers And Task Log > *Measured Correction For Slay Task Totals* (needs the Task Log).

**On the real log (2026-10-29):** time x1.35, XP x1.48 from the last 15 tasks; the log up to 22 October gives x1.02 and x1.10, so it follows the game when it changes back.

**Tests.** `npm run test:slay-correction`.

Not covered (left as the game shows them): the Luck block of the game's own slay tooltip (`hover-info.js`) and the ETA written to the clan board.
