# Route Advisor: model, search and stability rules

This is the specification of `overlay/route-advisor.js` (the block between `//#core-begin` and `//#core-end`, which also runs in a Web Worker and under node). The tests in `scripts/test-route-advisor.js` (`npm run test:route`) check every claim marked **[tested]**.

The Route Advisor is display only. It reads the queue, never touches it, and suggests an order (and which of the three options of a row to pick) for the tasks that are already queued.

## 1. What goes in

All of it is read from the game by the page layer and handed to the core as one plain object:

| Input | Meaning |
|---|---|
| `head` | the node of the task that is running now. The walk to the first queued task starts here (the game measures every "(N)" from the previous row's selected option, row 1 from the current task). |
| `hm` | the running task: remaining time `t` (seconds), the XP it still pays per skill `sk`, its value `v` (see 3), quest steps it completes. This is the only place where progress enters. |
| `rows` | up to `MAX_ROWS = 10` queued rows, three options each: node, whether it is the player's pick, and metrics `m`: `t` task seconds, `sk` XP per skill (XP bonus and per-item gathering already included, by the game data bridge), `k` skilling or slay, quest steps. Rows after the tenth keep their place. |
| `crystals`, `speed` | teleport crystals in the order the game spends them, and movement in steps per second. |
| `skills`, `table`, `questInfo` | levels and XP, the XP table, active quests (steps, current step, reward XP). |
| weights | objective (XP, levels or balanced), skill priorities, task weight rules, lucky and drop boosts, combat weight, teleport price. |
| `stab` | the stability margins (section 5). |
| `inc`, `fp` | the previous suggestion and a fingerprint of what the queue, the player and the settings looked like when it was made (section 5). |

**Walking speed.** `input.speed` is the bridge's `speed().sps` (docs/PLUGIN-AUTHOR-GUIDE.md, section 5): the game's formula `Y.totalMovementSpeed({ vigorLevel: effective Vigor, telescope, compass, gauntlet, beacon, collector, ancient, talent, potionMult })` = `movementSpeed(vigor) * (1 + the sum of the bonuses)`, `movementSpeed(v) = 10 + (v + 1) * (0.1 + 0.0005 v)`, the same inputs as the game's Unlocks panel plus the movement potion that is active (Swift +15%, Fleet +30%, Haste +50%). Validated: the number equals the game's `path.speed` (the speed the game walks the player at) to 15 digits while a Swift Potion was active, and the Unlocks panel's total and potion rows to 0.1 steps/s. The speed is part of the change fingerprint (`speed`, rounded to 0.1) and the bridge's `onChange('speed')` forces a plan at once, so advice follows a potion starting or ending. The planner assumes one speed for the whole queue (a potion that runs out part-way is not modelled here; the queue's walking times use `speed().time(steps)`, which is). Without the bridge the model uses 15 steps/s.

Before anything is computed, times and XP are rounded to whole seconds and whole XP and the speed to 0.01 steps/s, so a number that wobbles in a late decimal cannot move a decision.

## 2. Time model (seconds)

The effective time of a plan `p` (the rows in the order walked, with the option picked in each) is

    T(p) = head.t + sum of task times t(row, option) + walking(p) + OVERHEAD * stops(p) + lam * charges(p) + FOOT_PEN * forced(p)

* **Overhead per task (`TASK_OVERHEAD_S = 60`, added 2026-10-29).** Every queued task costs 60 s on top of its task time and the walk to it: banking and setting off. Measured on 462 completed skilling tasks and on the gaps in the 200-task history (docs/ROLL-MODEL-CALIBRATION.md section 6): walked legs take a median of 55 s longer than distance / speed, a leg between two tasks at the same node still takes 18 s, and the history gaps give 67 s per task. The constant is the middle of 45 to 80 s. **It is not charged when a task is the very same one as the one before it** (same activity or mob at the same node, in the queue or against the running task); an option that does not name its activity always pays it. `stops(p)` counts the tasks that pay it. The walking-only search ("walking order is the true minimum") does not use it, and the time the game shows for a task and the XP an hour of a task are not changed; only the plan total `T(p)` and the rates divided by it (levels an hour, the score) are. With the same number of stops in every plan the ranking of plans hardly moves; shown rates drop by a few percent (a 7-task queue gains 7 x 60 s = 7 minutes).
* **Walking.** A leg from node `a` to node `b` is `hubPath(a) + bankToBank(hub(a), hub(b)) + hubPath(b)` steps (0 when `a = b`; a bank has no hub path). This reproduces the game's own "(N)" at 0.00% error (validated 2026-10-07). A leg takes `distance / speed` seconds.
* **Teleports.** The game decides by itself: a leg longer than the threshold of the crystal currently being drained (Faulty 15000, Stable 12000, Perfect 10000 steps) costs no walking and one charge, and a crystal that runs empty hands over to the next in list order. So which threshold applies to a leg depends only on how many charges were used before it. The search tracks exactly that number. A teleport leg takes no time, but each charge is charged `lam` seconds in `T`: `lam = tpSteps / speed` (a charge must save about that many steps, default 6000), or the "teleport worth it" minutes when `tpSteps` is 0, and 0 in Max mode. Without crystals, or on foot, `lam = 0` and no leg teleports.
* **On foot with crystals in the bag.** The game would still teleport on a leg over the threshold. A plan that is meant to be on foot is charged `FOOT_PEN = 21600` s per such leg, so it only wins when every plan has one.
* The running task counts with its remaining time. Nothing in `T` depends on the clock.
* **Stay put (added 2026-11-10).** Staying in one place is built in, not a mode. In the SEARCH objective only (never in a displayed time, never in `T`) every leg to another place (distance above 0, a teleported leg too) costs `MOVE_PEN_S = 240` s extra, and a change of task at the very same place `ACT_PEN_S = 80` s, so tasks that share a place are stacked unless moving is clearly worth it. It is only a preference between plans of about the same worth, so it is guarded by the XP floor (section 4). `input.stay = { floor }` switches it on (the page sends it unless the setting "Stay Put XP Floor" is 100%); without `input.stay` the search is the pure optimum.

## 3. Value model (levels)

* The value of an option is `v = actW * sum over skills of wOf(skill) * xp(skill) / span(skill)`. `wOf` is the skill priority, the combat weight for combat skills and the "even progress" bonus. `span` is the XP the skill's next level costs (objective "levels"), a typical level cost `REF` (objective "xp"), or their geometric mean ("balanced"). `actW` is the task weight rule, the lucky boost, or the drop boost.
* The running task contributes its remaining `hm.v`.
* **Quest credit.** A quest advances one step per stop, and only when the stop's node is exactly the quest's next required step. Each step credited once pays `reward levels / steps left`. The step the running task already completes is not credited again. The credit therefore depends on order, and is part of the search state (section 4).

## 4. Objective and search

There are three paths, each a different goal:

* **Skilling**: value = skilling options only.
* **Combat**: value = slay options only.
* **Quests**: value = quest credit plus 0.05 of ordinary value.

Each path maximises its **rate** `R_kind(p) = V_kind(p) / T(p)`: its own kind of value per effective second. A path only uses options of its own kind where the row has one (a short task of the wrong kind must not win just because it lowers the average). With "keep my picks" the picks are fixed and only the order is searched.

All three plans are then judged by the same **score** (what the user sees): weighted levels gained per effective hour,

    score(p) = 3600 * levels(p) / T(p)

where `levels` counts every skill's XP and the quest credit. The best path is the one with the highest score.

**Exact search.** For a fixed `lambda`, the cost of a plan `lambda * T - V` is a sum over its stops, and a stop's cost depends only on (rows already done, the option taken last, charges used so far, quest progress). A dynamic programme over exactly that state finds the cheapest plan among all `n! * 3^n` of them: at most 1024 row subsets times 30 options times 11 charge counts times the quest states, a few million states (about 20 to 100 ms for ten rows). The best ratio `V/T` is found by Dinkelbach's iteration: start at the ratio of the current queue, solve for the cheapest plan, set `lambda` to that plan's ratio, repeat until the ratio stops improving (typically 2 to 4 rounds). The result is the true optimum, not a heuristic one **[tested: 120 random queues of 3 to 5 rows per run are compared with trying every plan]**. When the state space would exceed 5 million (ten rows, many quests and many charges) the quest chain, then the charge count, is dropped from the state and the plan is scored exactly afterwards; the result is then marked `exact: false`.

**Stay put and the XP floor.** After the pure optimum is found (best ratio `R*`, real score `S*`), the exact search is run once more at `A = R*` with the move penalty added to the cost. Its plan is taken when its real score (levels per real hour) is at least `floor x S*` (setting "Stay Put XP Floor", default 85%); otherwise the penalty steps down a fixed ladder (1, 1/2, 1/4 of `MOVE_PEN_S`) and finally the pure optimum is used. So a move that is clearly much better still wins. For a fixed `A` and ladder step the penalised plan is the exact minimiser of the penalised cost **[tested: every plan tried on 3 to 5 rows]**; the shown plan always keeps the floor **[tested]**; floor 100% gives the pure optimum and floor 0 the full penalty **[tested]**. The result carries `info[kind].stay` (the ladder step used, 0 = none), `pureScore` and `optMoves`; `measure()` reports `moves` (place changes) and `actMoves`.

**The NEW TASKS bar.** `input.free` is the number of rows from the top that may be reordered: the rows above the game's gold bar (`bridge.queueInsert().at`). The rows at or below it are LOCKED: exactly like the rows past `MAX_ROWS` they are not in the search, keep their place and picks, and are not measured. With "Reorder past the NEW TASKS bar" on (or no movable bar) every row is free. The result reports `locked` (rows not searched) and, when rows are locked, `past`: the gain per path of the same search with every row free (`past[kind]`, against the whole queue as it stands) so the panel can say "Past the bar: +X%". The lock boundary is part of the change fingerprint **[tested: only the top rows are searched and moved, `locked` is reported, `past` is reported only when rows are locked]**.

**Which path is shown (the tabs).** The three paths are tabs. The automatic pick `paths.auto` is Quests while any queued option (any row, any of its three options) completes a quest step, else Skilling. Combat is never picked for you. It depends on the SET of options only, so reordering the queue cannot change it **[tested]**. A tab you click is pinned (`localStorage cc-route-sel`) until you go back to auto. There is no longer a "best path by score" badge (the old `paths.best` is still computed, for the stability memory and the log).

**Walking-only plans** (the order that walks least, with and without teleports, the version that may also change picks) use the same search with `V = 0`; the first is checked against trying all `n!` orders **[tested]**.

**Tie-breaking.** Among plans whose cost differs by less than `1e-9` of the cost scale, the one that moves the fewest rows and swaps the fewest picks relative to the queue as it stands wins (a tiny extra cost per moved row and per swapped pick); remaining ties go to the first found in a fixed iteration order. There is no random number, no clock and no search budget anywhere in the core, so the same input always gives the same plan **[tested]**, the same rows in a different order give the same optimum **[tested]**, and a plan that is already optimal is never replaced by an equal one.

## 5. Stability: when is a change worth suggesting

The inputs are known to a few percent: the game's task times match real acting time to 1 to 3%, XP to about 1%, walking to 1 to 8% (docs/ADVISOR-NOTES.md), and the head task's progress moves every rate by about 0.5% a minute. A suggestion that beats the queue by less than that is noise, and acting on it just makes the next recalculation disagree.

The rule, for a candidate plan `y` against a plan `x` (the queue, or the previous suggestion):

    y clears x  when  score(y) >= score(x) * (1 + (rel + perSwap * swaps) * m)
                 and  T(x) * (1 - score(x)/score(y)) >= abs * m

* `rel = 2%` (setting "Minimum Improvement To Suggest A Change"). Plans compared share the same tasks, so their time errors cancel; what is left is the walking error (5% of the 15 to 25% of a route that is walking, about 1%) and rate drift, so 2% is about two standard deviations.
* `perSwap = 3%` per option pick the plan changes (the existing "Pick Swap Cost"). Swapped picks do not share errors: two task times at 2% each give about 3%.
* `abs = 60` s: the same progress reached at least a minute sooner. The game shows times in whole seconds and a queue has idle pauses of tens of seconds, so less than that cannot be felt.
* `m` is the multiplier. It is 1 when something real changed since the previous suggestion (see below) and `drift = 2` when nothing did but the clock: with nothing new in the world a re-ranking needs to be twice as clear. A plan that is already on show only needs `m = 0.5` to stay on show (a Schmitt trigger: it appears at 1 and disappears below 0.5, so a gain hovering at the margin cannot flicker the badge).

**Incumbent.** The page remembers the plan it last suggested for each of the four modes (keep or optimise picks, on foot or teleports) and a fingerprint: the set of task rows, the queue order and picks, the running task, the skill levels, the settings, the crystals and the speed. On the next calculation the optimum `C` is found from scratch, and the previous suggestion is mapped onto today's queue (rows that finished drop out, rows it has never seen are inserted where they score best). It is only replaced by `C` when `C` clears it by the rule above. So:

1. A plan the player is following is not re-argued when the first stops are done: the rest stays unless something is clearly better.
2. A suggestion shown for the same queue does not change on its own: with only the clock moving (progress, rates), `C` must be twice as far ahead.
3. Every change carries its reasons (which fingerprint parts changed) which the panel shows ("Suggestion updated because your current task changed"). A re-ranking with no reason and no clear gain is suppressed.
4. The suggestion is then shown only if it clears the queue as it stands. Following it leaves nothing to suggest, so there is no suggestion left after the player has done what was asked **[tested]**.
5. The tab shown is not decided by score any more (see section 4: pinned tab, else the automatic pick from the set of queued options). The fingerprint also holds the Stay Put XP Floor and the lock boundary (the NEW TASKS bar), so moving the bar or changing those settings counts as a real change. The teleport gate (teleports must save a total number of steps) has 15% hysteresis around its bar.

**Why the old rule flipped.** The old optimiser charged a "pick swap cost" inside the objective, relative to the queue as it stood. After the player followed a suggestion the queue was the new reference, the cost of the next swap was lower, and the next recalculation let one more swap through: a ratchet. Measured on 60 random queues of 5 to 9 rows, 83 to 87% of exact follow-throughs produced a new suggestion (13% with the cost off); with the exact search and the incumbent rule it is 0% **[tested]**.

## 6. Self-check

`__ccRouteAdvisor.selfCheck()` runs, on the last real input: determinism (twice), idempotence (apply each suggestion, nothing more is suggested), order invariance (the queue reversed gives the same optimum), and for small queues the comparison of every path and the walking order with trying every possible plan. `__ccRouteAdvisor.log` lists the recent suggestions with the reasons they changed and the gains; `__ccRouteAdvisor.lastInput` is the last optimiser input (for recording fixtures).

## 7. Lever Advisor, Slay page: master picker and "Easy kills" route

The mob weights of the Slay Customization page are one list for all slayer masters; a master only decides which mobs it can roll (its Slay band, or every mob for the Chaos master, whose levers count double: weight `1.25^(2p)`). The advisor therefore computes its advice for the master picked in the drawer (`bridge.slayMasters()`: id, name, band, unlocked = Slay level reaches the band, open mobs, the pool) and not only the game's selected one (`G.queueMaster`). The pick is kept in `localStorage cc-lever-master`; the setting "Lever Advisor: Slay Master Picker" turns the picker off (back to the game's master). When the pick is not the game's master the drawer says so and **nothing is outlined** (display only, nothing is clicked); the odds and the plan are still listed.

**Risk model** (`bridge.mobRisk()`). The mob attacks with the game's own `CombatMath.computeAttack` (the function that rolls its attacks): its style, its levels (`strike/heft`, `sight/draw`, `focus/surge` by style), its attack and strength bonuses, its vigor and attack speed, against your Dodge and Defend (levels, potions, cape bonuses) and the Defence bonus of the loadout the fight window uses for that style. A hit is uniform between the minimum floor and the maximum hit; the mob crits with `mobCritChance(slayLevel)` at `mobCritDamageMult`; the damage reduction and the 1 HP minimum are applied per hit:

    avg  = hit * ((1 - c) * mean(final(h)) + c * mean(final(crit(h))))      HP lost per attack
    dps  = avg / attackInterval            dmgKill = dps * killSeconds     killsHr = 3600 / (killSeconds + respawn)
    hpHr = dmgKill * killsHr               foodHr  = hpHr / heal of the best food in the bank (else 12 HP)
    risk = worst hit (crit at maximum) / max HP

Checked against 200 000 rolls of the game's `resolveAttack` (live, melee loadout): Dire Goblin 1.235 vs 1.232 HP per attack, Dire Golem 6.188 vs 6.201, Feeble Spark Slime 0.255 vs 0.257, Dire Lich 9.120 vs 9.122. Not modelled: HP that comes back by itself, food heal bonuses, specials. The kill time is the game's `D._killSeconds`, the respawn `D._respawnSec()`.

**Route "Easy kills for combat levels".** Value of a task = the combat XP of its kills only (`hp * (chosen + life + secondary multipliers)`, no Slay XP) times a tier factor; time = kills * (kill seconds + respawn). Tiers, worst of food and risk: A (at most 2 foods an hour and no hit above 15% of max HP) 1, B (10 foods, 30%) 1/50, C (40 foods, 50%) 1/2500, D (the rest) 1/100000. A tier is worth more than the whole spread of XP per hour inside the one below, so mobs rank by tier first. Inside a tier the payoff is XP per hour **including the respawn wait**, which favours the mob with the most HP: it gives more XP per kill while the respawn is a fixed time, so fewer, longer kills lose less to waiting (the "why" table shows kill seconds, the respawn share of the cycle and XP per kill). Example (level 43-44 account, Valthor): Feeble Spark Slime 59 XP per kill, 2.6 s kill + 8 s respawn (76% wait) 16.6k XP/h, Tier A; Feeble Acid Slime 22 XP, 90% wait, 7.3k/h; Feeble Imp 26.9k XP/h but Tier D (56 foods an hour).

## 8. Lever Advisor: Focus on one or two mobs, and the worth of the advice

**Focus** (Slay page, routes "Hunt XP-boost drops", "Hunt unfinished collections", and "Balanced" when switched on; default 2 for the hunt routes, Spread for Balanced; `localStorage cc-lever-focus-<route>`; setting "Lever Advisor: Focus On One Or Two Mobs"). Mobs sit in different places, so spreading credits over many mobs means running between them. `bridge.huntInfo()` gives, per mob, its map node and the drops it can still give: XP-boost unlocks not logged yet, and missing collection entries, each with its "1 in n". The chance that a kill gives at least one is `p = 1 - prod(1 - 1/n)`. The 6 mobs with the most drops per hour of killing (`p / (kill seconds + respawn)`) are the candidates. Every set of k of them (k = 1 or 2) is run through the normal optimiser with a payoff of "drops per task" (`kills * p`) for the targets and 0 for all other mobs, so the plan raises the targets' levers and lowers the others' (refunds included); a set is scored by drops per second **with walking**:

    R(S) = sum(q_i x_i) / ( sum(q_i t_i) + sum over pairs 2 q_i q_j steps(i,j) / 18 )      q = roll odds after the plan

(`steps` from the game's path distance, 18 steps a second typical; a far-apart pair loses to a close one; without position data the walking term is 0). The best set is the focus; the drawer lists it as "Focus: X and Y", the why table shows drop %, kills, hours and steps to the focus mob. Queue tip shown on the page: when a target is rolled, move it to the front of the queue; when the other one is rolled, leave it queued. Balanced: the targets are mobs with a missing boost drop and count 3x their normal value; the other mobs keep theirs.

**Worth of the advice** (the first block of "Why these picks?", every page). For a lever setting, `R = sum(w_i x_i) / sum(w_i t_i)`, `w = 1.25^position` (squared position on the Chaos master), in XP an hour (skill pages and Slay; combat XP an hour on Easy kills; drops an hour on a focus), or route value on the all-skills page. The gain of a change is `R(after) - R(before)` with the other levers unmoved, so the others' normalising is counted. Per row: steps, gain, gain in %, a magnitude bar (green better, orange worse, grey under 0.3%), credits (+ = refund), and the first step's gain with its gain per credit. The total row moves all picks together (the rows do not add up to it). Quantity levers are not counted. Example (Fish, live): Raw Octopus +1 gives +679 XP/h (+4.5%) for 40 credits (17 XP/h per credit); following all four picks gives +297 XP/h (+2.0%) because three of them lower a worse entry to win refund credits.
