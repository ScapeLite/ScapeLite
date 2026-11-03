# Lucky slay tasks: tooltips and predictions checked against the game

Checked on 2026-10-29 for roadmap item adv-023. Two lucky slay tasks were in the queue (110 Savage Gnoll, 100 Savage Goblin), and the task log (`cc-task-log`) holds nine completed lucky slay tasks and 76 normal ones for comparison, plus 30 lucky skilling tasks.

## The rule, from the game and from the log

The game's own text on a lucky slay task: "2x slay XP, 2x combat XP for your training focus, +Luck XP equal to both". Lucky skilling: "2x xp, 2x rewards, no failed actions".

| Check | Result |
|---|---|
| Lucky skilling XP per item, against base x (1 + bonus) | 2.00 times a normal task (30 lucky, 147 normal) |
| Lucky skilling Luck XP | 0.99 of the skill XP, so Luck XP = the doubled skill XP |
| Lucky slay: chosen skill XP per Slay XP | 2.05 (normal task 2.02): chosen is doubled together with Slay |
| Lucky slay: Life, Spirit, second skill per Slay XP | 0.42, 0.42, 0.42 (normal task 0.80, 0.83, 0.80): **half, so these are not doubled** |
| Lucky slay: Luck XP per Slay XP | 3.13 (= 1 + 2.05, rounding aside): Luck XP = Slay XP + chosen skill XP, as the Luck block assumed |

Eight of the nine lucky slay tasks have Luck XP within 6% of Slay + chosen. One (106 Dire Orc, 2026-10-23) has Luck XP equal to the chosen skill only, 33% short; nothing else in that entry is unusual and the cause is not known.

## What was right

- The Luck block on the slay tooltip (gain = Slay XP + chosen XP, time, XP an hour, Luck level progress): Savage Gnoll 22.1k + 45.5k = 67,573 Luck XP, 75.3k an hour over 53m 51s. The numbers follow the bridge's data exactly.
- The skilling tooltip: doubled XP, no failed actions, Luck block equal to the skill XP.
- The game's own `_projectSlay` doubles Slay XP for lucky tasks, so the Slay part was right.
- Route Advisor: it takes the bridge's per-skill XP, adds the Luck XP (Slay + chosen), and applies the user's own "Lucky Task Boost" (default 2x, documented as "on top of its doubled XP"). That extra weight is a choice, not a double count.
- Lever Advisor: lucky is a roll chance, not a lever of a mob, so it values mobs without it. Nothing to fix.

## What was wrong (fixed)

1. **The bridge doubled Life, Spirit and the second combat skill for lucky slay tasks** (`combatInfo` in `overlay/game-bridge.js`). The tooltip total, the chips, the XP an hour, the queue and the Route Advisor all read that number, so a lucky slay task was worth about 22% too much (100 Savage Goblin: 86.6k xp, now 67.2k). Only Slay and the chosen skill are doubled now. After the fix the live numbers match the log: Life / Slay 0.419 (log 0.421), chosen / Slay 2.08 (2.05), Spirit / Slay 0.41 (0.42). The Luck block did not change, because it only uses Slay and chosen.
2. **The option card in the queue said "Lucky tool chance: yes"** for any lucky task (`overlay/ui-bar.js`). A lucky task is not a lucky tool (that is a separate drop per XP in a skill). It now says "Lucky task: 2x XP and rewards", with a note for slay that the doubling covers Slay and the training skill.

## Not lucky-specific, but seen while checking

Since about 2026-10-22 every slay channel (Slay, Spirit, chosen, Life, second skill) has paid about 1.5 times the model's XP per counted kill, for normal and lucky tasks alike (before that: 1.0). Lucky tasks sit on the same drift, so the lucky doubling itself is right. Skilling is exact (1.00). Something that scales all kill XP changed on or around 2026-10-22 and the model does not know it (or the kill counter undercounts). This is the roll-model calibration work (adv-003); a roadmap idea was added.

## How this was verified

- `cc-task-log` on the live page, per channel, lucky against normal, normalised by the model's base values (`__ccBridge.mobXp`, `actXp`).
- The game's tooltip strings in the bundle.
- The live queue tooltips (`#unified-queue-panel`), read before and after the fix; `npm run test:bridge` (6 passed) and `npm run lint:forwards`.
