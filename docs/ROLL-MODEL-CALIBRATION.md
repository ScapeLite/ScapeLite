# Roll model calibration (roadmap adv-003)

Checked on 2026-10-29 against the live game. This document says what the roll model gets right, where it is off, and by how much. The numbers can be reproduced at any time with `node scripts/roll-calibration.js` (read only; the game must be running with the debugging port open).

## Short answer

| Part of the model | Verdict | Evidence |
|---|---|---|
| Which activity inside a skill (tier weights, levels) | **Right** | 200 tasks, chi-square p = 0.54; none of the 200 tasks was on an activity the player did not have the level for |
| Which node, given the activity (weight 10 x 1.25^lever, among nodes that offer the activity) | **Right in structure**; the effect of the levers is too small to measure | Activity-first beats node-first by 15 log-likelihood units; the player's levers are almost all -1 |
| How many items a task asks for (uniform between half and one and a half times the base) | **Right** | 200 tasks, KS D = 0.086 against a 5% limit of 0.096 |
| XP of a skilling task | **Exact** | 201 completed tasks: realised XP / predicted XP = 0.99 at the 10th, 25th, 50th, 75th and 90th percentile (1.00 at the 90th) |
| Time of a skilling task (acting time) | **Exact** | median ratio 1.00, middle half 1.00 to 1.04 |
| Which skill (weight 1.25^lever) | **Right on average, noisy per skill** | chi-square 26.1, p = 0.025 (a flat model is far worse: 38.2, p = 0.0005). Best-fit lever base 1.17, 95% interval 1.08 to 1.26, so 1.25 is still inside |
| Walking time | **Too low by about a minute per task** | median walked leg takes 1.32 x (distance / speed); the extra is about 55 s per leg whatever the length (two independent datasets agree) |
| Slay XP per kill and time per task | **Rates are right, per-task numbers have been 1.5 x too low since 2026-10-22** | see "Slay since 22 October" |
| Chance of a lucky task | **Cannot be measured from completed tasks** | the player picks lucky tasks on purpose (6.3% of completed tasks, 3.4% expected from the roll) |

Nothing in the model needed to change for the rate (XP an hour) of a skilling or slay plan. One addition is recommended (a fixed overhead per task, section 7) and is left for a decision; no model code was changed.

## 1. What the data is, and what it is not

* **Task history** (`taskHistory` in the Skills Customization state, `__ccBridge.taskHistory()`): the newest 200 completed **non-slay** tasks, with skill, activity, node, quantity and the finish time. Here it covers 2026-10-24 11:26 to 2026-10-29 07:18 UTC (115.9 h). It does not contain the XP, a lucky flag or the options that were *not* picked. Slay tasks are never in it.
* **ScapeLite task log** (`cc-task-log`, 945 entries since 2026-10-16, 462 completed skilling and 72 completed slay tasks): realised XP per skill, seconds spent moving and acting, the prediction made when the task started, and a lucky flag. This is the source for XP and time checks.
* **The queue** offers 3 options per slot, and in this account that is one slay task and two skilling tasks. The player chooses; some relics choose for them. **Everything in the history is therefore a choice among rolled options, not the roll itself.** The model predicts the roll. A comparison is only clean for things the player cannot see or does not care about when choosing (the activity tier, the quantity), and only approximate for things they can (skill, node distance, lucky).
* **Lever positions** are only known as they are today. If a lever was changed during the 4.8 days, the expected counts below are somewhat off for the older tasks. The recent 100 tasks fit worse (p = 0.04) than the older 100 (p = 0.66), which is a hint that the player picked differently lately or changed levers, not a proof.
* The game's own formulas were used for everything (`_calcSkillPercentages`, `_activityLeverMult`, `adjustedBaseQuantity`, `quantityRange`, `effectiveWeight`), read from the live game object. Where the roll itself happens (the server) is not visible, so these are the formulas the game shows the player, tested against what then happened.

## 2. Which skill

Model: the 15 rollable skills, weight 1.25^(skill lever). Quests are a separate share of 5.8% in the game's display; the history shows no sign of separate quest entries, so the 15 skills were renormalised.

| Skill | Done | Expected | z |
|---|---:|---:|---:|
| Fish | 19 | 15.3 | 0.99 |
| Cook | 19 | 19.1 | -0.03 |
| Mine | 17 | 15.3 | 0.46 |
| Smith | 26 | 19.1 | 1.66 |
| Forage | 14 | 9.8 | 1.38 |
| Craft | 8 | 9.8 | -0.58 |
| Invoke | 5 | 9.8 | -1.57 |
| Imbue | 14 | 9.8 | 1.38 |
| Farm | 7 | 15.3 | **-2.20** |
| Brew | 12 | 9.8 | 0.73 |
| Plunder | 15 | 9.8 | 1.71 |
| Barter | 6 | 9.8 | -1.24 |
| Bard | 12 | 7.8 | 1.52 |
| Discover | 7 | 9.8 | -0.91 |
| Vigor | 19 | 29.9 | **-2.15** |

* Chi-square 26.1 on 14 degrees of freedom (p = 0.025). With no levers at all (every skill equal) it is 38.2 (p = 0.0005), so the levers clearly do something.
* Fitting the lever base itself (the 1.25) gives **1.17**, 95% interval **1.08 to 1.26**. The log-likelihood at 1.25 is only 1.45 below the best fit, so the data do not reject 1.25. If the real base were lower the +4 Vigor lever would be worth less than the model says, which fits Vigor coming up short (19 against 29.9).
* Vigor and Farm are the two skills clearly below expectation, and both stay low over the longer task log (Farm 18 against 35, 3.0 sigma over 462 tasks). It is not explained by what the player seems to pick for XP: the correlation between a skill's XP an hour and its deviation is -0.14. With 15 skills a couple of 2-sigma deviations are expected by chance, but Farm persisting in a second, larger sample is worth watching.
* Neighbouring tasks are slightly more often the same skill than chance (20 pairs against 15.7 expected); not significant.

**Confidence.** At 200 tasks a skill with a 5% share has an expected count of 10 and a standard deviation of 3, so only deviations of about 6 tasks or more mean anything. The mix as a whole agrees with the model; any single skill does not.

## 3. Which activity inside the skill

Weight of an activity = its base quantity x 1.25^(activity lever x almanac multiplier), only for activities whose level the player has. This is the same formula `__ccBridge.oddsTiers` uses for the Lever Advisor.

* Pooled chi-square over all 15 skills: 6.98, 8 degrees of freedom, **p = 0.54**.
* Compared with "any open activity equally likely", the model gains 0.09 nats per task (18 in total over 200), so the activity levers are real.
* **0 of 200 tasks** were on an activity above the player's level. The level gate is correct.
* Per skill the samples are 5 to 26 tasks, so only the pooled test means anything; the largest single-skill deviations (Forage p = 0.07, Imbue p = 0.06) are what chance gives from 15 tests.

## 4. Which node

The game's own lever page computes a node share as `effectiveWeight(lever) / sum over the nodes that offer the selected activity`. So the order is skill, then activity, then node. The data agree: the log-likelihood of the 200 (activity, node) pairs is -942.3 for activity-first and -957.1 for node-first.

* Node levers: 65 of 416 are non-zero, nearly all of them -1. So few tasks are affected: 28 tasks landed on a -1 node against 22.8 expected (not significant), 1 on a positive node against 1.8.
* **Distance to the nearest bank.** The chosen nodes were on average 496 steps from their bank. The model says 640 (z = -4.1), and with the levers removed it is 642. So the player's tasks sit closer to banks than the roll would put them. The 15 options currently offered in the queue average 726 (model 674), so the roll is not the cause; the player's choice among the offered options (or a relic) is. This matters for the Route Advisor only in that "tasks you will be given" are further away on average than "tasks you pick".

## 5. How many items

Base quantity per activity is already in `activitiesData` (144 for gathering-type skills, 124 for processing-type, at total level 1466; the game adds 6 per 100 total levels). A task's quantity is uniform between 0.5 and 1.5 times `max(10, base + 10 x quantity lever)`.

* Mean position inside that range: 0.458 (0.5 expected); standard deviation 0.275 (0.289 expected); quintile counts 46, 39, 48, 41, 26 (40 expected each).
* Kolmogorov-Smirnov D = 0.086, below the 5% limit of 0.096. Two tasks fell just outside the range (a lever or the total level was a little different when they were rolled).
* The slight lean to smaller tasks (last quintile 26 against 40) is a small hint that the player skips the largest tasks, not a model error.
* **Note on the word "gathering".** The game labels Bard, Plunder and Vigor as gathering-type for the quantity base. The Route Advisor's and Lever Advisor's "Gathering vs Processing" ratio uses its own list (Mine, Fish, Forage, Farm, Invoke) as the player-facing split between material makers and material users. That is a choice, not an error, but the two lists differ.

## 6. XP and time of a task (predicted against realised)

From the task log, completed version-2 entries.

**Skilling (201 tasks, lucky ones left out of the XP check):**

| | p10 | p25 | p50 | p75 | p90 |
|---|---:|---:|---:|---:|---:|
| Realised XP of the task's skill / predicted XP | 0.99 | 0.99 | 0.99 | 0.99 | 1.00 |
| Acting seconds / predicted seconds | 0.97 | 1.00 | 1.00 | 1.04 | 1.10 |

The projection the Route Advisor, the queue and the Lever Advisor all use (`D._projectTask`) is accurate to about 1% for XP and 0 to 4% for time. Entries whose prediction was made part way through the task (the remaining time only) were left out.

**Walking** (426 legs between consecutive skilling tasks; distance from `__ccBridge.dist`, speed 24.1 steps a second with the Swift Potion):

| Predicted walking (distance / speed) | Legs | Median predicted | Median actual |
|---|---:|---:|---:|
| 0 s (same node) | 90 | 0 s | 18 s |
| 1 to 60 s | 20 | 35 s | 105 s |
| 60 to 150 s | 45 | 112 s | 158 s |
| 150 to 250 s | 87 | 202 s | 265 s |
| 250 to 340 s | 67 | 282 s | 360 s |

* Median actual / predicted on walked legs: **1.32** (middle half 1.10 to 1.85).
* The extra is closer to a **constant of 45 to 80 s per leg** than to a percentage. The same node still costs 18 s.
* A second, independent check uses only the history: the time between two completions minus the predicted task time is on average 67 s + 1.29 x the predicted walking (correlation 0.59; this includes slay tasks done in between, so it is an upper bound).
* In wall-clock terms the 200 history tasks account for 115.9 h, of which 51 h are 14 gaps longer than an hour (away from the game, or slay and raid time), and the predicted task time is 45 h of the other 65 h. The remaining 30% is walking, banking and anything done between tasks.
* The Route Advisor's walking is the distance the game itself prints, to 0.00% (docs/ROUTE-ADVISOR-MODEL.md section 2), so the extra seconds are not a distance error. A bank or hub stop at each task is the likely cause; the log does not say.

## 7. Slay since 22 October (roadmap adv-025)

Report from the lucky-slay check (docs/LUCKY-SLAY-TOOLTIPS.md): every slay channel pays about 1.5 times the model's XP per counted kill since 22 October, lucky and normal alike. What the log shows:

* Normalised by `__ccBridge.mobXp` (base XP x current bonus), completed non-partial tasks, lucky tasks divided by 2:

| Period | Slay tasks | Median XP per counted kill / model |
|---|---:|---:|
| 16 to 22 October 10:32 UTC | 29 | **0.97** |
| 22 October 11:32 UTC to 29 October | 52 | **1.51** |

  The change happened between the last task before 11:00 and the first one after it on 22 October (0.97 to 1.63), which looks like a game update rather than a slow drift.
* The ratio is not constant after the change: 1.03 to 2.04 for normal tasks (one Dire Lich task at 3.24), even for the same mob (Dire Ent: 1.03 to 1.80). It follows the **time** a task took: for the tasks with a usable prediction the time was 1.41 x the predicted time (median) and the correlation between the two ratios is 0.76. Per counted kill the player gets about 1.5 x the XP **and** spends about 1.4 x the time.
* So the **XP an hour is still right**: realised XP an hour / model XP an hour has median **1.07** (middle half 0.95 to 1.15) over the 28 tasks that have a usable time prediction. Everything that only uses a rate (Route Advisor ranking of slay against skilling, mob XP an hour, the Lever Advisor) is unaffected.
* What is **wrong** is anything per task: XP a slay task pays, and how long it takes, are each about 1.5 x higher than shown (a slay task of 70 kills shows 25 minutes and takes about 35). Whatever changed, one counted kill now stands for about 1.5 kills' worth of XP and of time. I could not tell from the data whether the kill counter counts only some kills, several mobs spawn per encounter, or kills take longer and pay by time; they cannot be told apart from totals.
* Not a bonus: the Halloween event adds a community boost of 7.9% to the XP bonus, which is already in the 1+bonus that was used, and skilling is exact over the same days.

**Open question for adv-026** (one lucky Dire Orc task paying Luck XP equal to the training skill only): that entry (2026-10-23 19:36) is odd in other ways too. It took 93 minutes (predicted 34), it paid 222 Slay XP a kill against about 160 for the other lucky tasks, and it is the only slay task with Alms XP in it. All of that points to the task log joining two things (a pause, or a lucky and a normal part) rather than to a rule of the game, but this is a guess and the entry stays unexplained. The other eight lucky slay tasks give Luck XP = Slay + chosen skill within 6%.

## 8. Lucky tasks

* Completed skilling tasks: 29 lucky of 462 (6.3%). At today's per-skill chances (Luck lever +5: 3.0% to 4.0%) the model expects 15.6, and it would expect fewer at the lower lever settings of earlier days. Slay: 9 lucky of 72 (12.5%) against a cap of 3%.
* That is **not** evidence that the roll chance is wrong. Lucky tasks are labelled and pay double, so a player who prefers them picks them far more often than they are offered. Of the 21 options in the queue right now, 2 are lucky (both slay) and none of the 14 skilling options is. The sample is far too small to say more.
* The lucky chance formula (`0.005 + 0.002 x lever + 0.0005 x unlocks + level terms`, capped at 5% skilling and 3% slay) could not be tested. To test it, the options that were *offered* have to be recorded (section 9).

## 9. Recommendations

**Status, later on 2026-10-29 (on the owner's decision):** recommendation 1 is done (`TASK_OVERHEAD_S = 60`, none for the very same task twice in a row; docs/ROUTE-ADVISOR-MODEL.md section 2), recommendation 2 is done in a learned form (the measured correction for slay task totals and ETAs, not for rates), and recommendation 4 is done (the Task Option Log). All three are described in docs/OPTION-LOG.md. Recommendations 3 and 5 stand as written. The text below is the original recommendation.

1. **Add a fixed overhead per task to the Route Advisor's time model, about 60 s** (range 45 to 80 s; both datasets agree). Every plan over the same queue has the same number of stops, so the ranking of plans would hardly move, but the XP-an-hour numbers shown for plans would drop by a few percent and match what the player experiences. This changes displayed numbers for everyone, so it is a decision, not a fix. The constant could be a setting with 60 s as the default, or learned from the task log (median of moving seconds minus predicted walking).
2. **Slay per-task numbers**: if the 1.5 factor stays, learn it (median of XP per counted kill / model over the last 20 completed slay tasks) and apply it to *task totals and ETAs only*, not to rates. Until the cause is known, showing "about 1.5 x" in the tooltip of a slay task would be the cheap honest version. A day with no 1.5 factor would show whether it is tied to an update.
3. **Keep 1.25 as the lever base.** The data lean slightly lower (1.17) but include 1.25; revisit at 400 or more tasks. If it is revisited, Vigor's +4 lever is where the difference shows most.
4. **Record what is offered, not only what is chosen.** A small passive recorder (display only) that writes the 3 options of each queue slot (skill, activity, node, lucky, quest, slay mob) once when they first appear would, after about 500 options, test the roll chance directly: skill shares, node shares, the lucky rate and whether the options are independent. Without it the roll can only ever be checked through the player's choices.
5. **Do not suggest credit-costing lever changes from node distance alone.** The player's own picks already favour near nodes (section 4), so the benefit of a node lever is smaller than the roll model alone says.

## 10. What is solid and what is noise

* **Solid** (large effect, consistent across checks): skilling XP and time are exact; the activity levels and tier weights; node/activity ordering; quantity range; the extra of about a minute per task outside the model; the slay change on 22 October and that it leaves XP an hour alone.
* **Moderate**: lever base near 1.25 (but possibly 1.1 to 1.2); Vigor and Farm below expectation; player picks nearer nodes than the roll offers.
* **Noise at n = 200**: any single skill's share, any single-skill activity table, the node-lever effect (65 non-zero levers, almost all -1), the lucky chance.

## 11. How to repeat this

```
node scripts/roll-calibration.js          # full report
node scripts/roll-calibration.js --json   # the numbers only
npm run test:calibration                  # the chi-square helper against textbook values
```

It reads the Skills Customization object through the same `Runtime.queryObjects` lookup the watcher uses for the bridge, plus `__ccBridge` getters and the `cc-task-log` store. It writes nothing to the game or to disk. After one or two more weeks of play the history has completely turned over and the same script gives an independent second sample.
