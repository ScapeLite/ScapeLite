# Discord relay audit: events, inconsistencies, the typed event model, and duplicate-instance protection

Audit of the whole clan-chat-to-Discord path (live relay, activity digest, clan hiscores, raid summaries), 2026-10-27. Evidence is the real history in `Logs/Watcher`, `Logs/Discord` (1,961 distinct structured chat lines, 2026-10-20 to 2026-10-27, one player running ScapeLite plus four clan members seen through the clan chat), `overlay/digest-state.json` (structure only) and the game data in `data/raw/items.json`. Names below are pseudonyms: **Wulf** is the player running ScapeLite, **Member A to D** are clan members. Webhook URLs are written as `https://discord.com/api/webhooks/ID/TOKEN` and never appear in the repo.

Built and tested with it: `overlay/relay-events.js` (typed events), `overlay/relay-core.js` (outbox, gate, payload), `overlay/relay-lease.js` (duplicate-instance protection), `overlay/relay-legacy-cleanup.js` (removes the first lease version's leftovers), `scripts/test-relay.js` (`npm run test:relay`) with the corpus `scripts/fixtures/relay-corpus.json`.

## 1. Short answers

| Report | Cause | Fix |
|---|---|---|
| "Luck XP shows for my own stuff but not for everyone else" | The game appends `+N Luck XP` to **your own** `New Collection!` lines only; other members' collection lines carry no such suffix (0 of 367 collection lines from others had it, 123 of 123 of Wulf's did). The relay printed it (`logged X (source) · +N Luck XP`). | "Luck XP" is stripped from every line at the one entry point and exists in no output, setting or test. The **skill** called Luck is not Luck XP: `Level up! Luck level is now 63` is still relayed. |
| "Member A has a ton of Fortress loot under Unlocks, not under Drops; for me it is the opposite" | Bucketing followed the **wording of the line**. Other members get an extra `unlocked: X` line for every unlock item (144 times in the logs); **you never get one** (0 times), you only get `The Fortress dropped X!` / `SRC dropped X!`. The digest moves an item to Unlocks only when it sees an `unlocked:` line. All Fortress loot (beacons, satchels, hot sauce, spice, trader's notes, corruptor's idol, banner, ledger) is an unlock item in the game's own data. | The bucket is decided by the **item** (`data/raw/items.json`, `type: "unlock"`), the same for everybody: see section 5. Old buffered digest entries are re-filed on load. |
| "I still find inconsistencies" | 12 found, see section 4. | One normaliser (raw line to typed event); live text, digest and cross-instance key all come from the typed event. |
| "Duplicate ScapeLite instances on the same clan chat" | Every member sees the same clan chat; N instances post each line N times. Nothing prevented it. | A leader lease, webhooks only: section 7; moved off the relay channels onto an optional private lease webhook in v2: section 8. |

## 2. The pipeline

```
game page (DOM)                      watcher process (Node)                                   Discord
.chat-message  --collector-->  drain every 5 s  --typed()-->  digest buffer ----(every 6 h)--> digest post
 (channel, data-category,      raw {channel,kind,player,      (digest-state.json)
  sender, text)                  text,self,...}        \--> outbox (chat-relay-outbox.json) --gate--> sender --> live post
                                                                          ^
                                                          lease (one leader per webhook)
```

1. **Collector** (`overlay/chat-relay-collect.js`, page side, read-only). Observes new `.chat-message` nodes. Channels: `clan`, `game` (the personal feed, merged into `clan` and flagged `self: true` since collector version 12), `global`. The game itself tags system lines with `data-category`; plain banter has none. The collector maps the category to a coarse `kind` (`rareDrop`, `unlock`, `petDrop`, `shinyPetDrop`, `levelUp`, `collection`, `questComplete`, `chat`) and keeps the raw `text`.
2. **Typed events** (`overlay/relay-events.js`). `normalise(raw)` parses the text with the full set of wordings (section 3) and produces `{type, player, self, item, tier, variant, qty, source, sourceKind, skill, level, pet, shiny, ...}`. `createPipeline().process(batch)` then merges lines that describe the same thing.
3. **Digest** accumulates typed events (buckets: Drops, Pets, Unlocks, Levels, Quests), independent of the live relay's switches.
4. **Outbox and gate** (`overlay/relay-core.js`). Typed events are written to the on-disk outbox before anything is posted, and are posted only when the gate for that webhook says `send`.
5. **Sender** (`overlay/discord-sender.js`): rate limits, retries, size limits, no pings except configured roles.

## 3. Every chat line the relay sees (from the real logs)

Counts are distinct lines. **S** = on the personal "game" feed (what Wulf sees about Wulf); **O** = on the clan feed (what anybody sees about another member).

| Event | S wording (own) | O wording (others) | Seen S / O |
|---|---|---|---|
| Rare drop (monster) | `Dire Lich dropped [T1] Faulty Crystal!` | `received a rare drop: [T1] Faulty Crystal from Dire Lich!` | 67 / 200 |
| Rare drop (Fortress) | `The Fortress dropped [T1] Bounty Beacon!` | `received a rare raid drop: [T1] Bounty Beacon from Fortress!` | 9 / 58 |
| Rare drop (Chaos Dungeon) | `Chaos Dungeon reward: [T1] Steady Aim!` | (none: only the collection line) | 5 / 0 |
| Rare drop (skilling stall) | `Invoke Stall turned up [T1] Farmer's Almanac!`, `Pickpockets turned up ...` | (none) | 2 / 0 |
| Unlock, announced | (none) | `unlocked: [T3] Enchanted Trowel` | 0 / 144 |
| Unlock, Lucky / Shiny | `received the [Shiny Lucky] Enchanted Trowel!` | `received the Lucky Enchanted Lens!` (no brackets) | 7 / 33 |
| Pet | `Fortify pet is now following you!` | `received the Luck pet!`, `received the SHINY Farm pet!` | 1 / 6 |
| Quest | `Quest complete: Sandscale Valley Drill` | `completed the quest: Sandscale Valley Drill!` | 15 / 70 |
| Level-up | `Level up! Vigor level is now 52.` (trailing dot) | `Level up! Vigor level is now 52` | 185 / 674 |
| Collection, drop | `New Collection! Received [T2] X as a Dire Treant drop. +646 Luck XP` | `New Collection! Received [T2] X as a Dire Treant drop.` | 87 / 216 |
| Collection, skilling / task / chest | `... as a T3 Chest Drops drop. +665 Luck XP`, `... as a Plunder Drops drop.` | `... from a treasure chest.`, `... from plundering.`, `... from Craft.`, `... from a task completion.`, `Claimed 2x [T4] ... from the Alms Path.` | 28 / 140 |
| Collection, unlock / pet | `New Collection! Unlocked the [Lucky] Enchanted Grip. +722 Luck XP`, `Unlocked the Fortify Pet.` | (none: they get `unlocked:` / `received the`) | 8 / 0 |
| Collection, milestone | (none seen) | `... as a Fortress milestone.`, `... as a Dire Dungeon milestone.` | 0 / 11 |
| Fortress reward | `The Fortress reward: 15x [T1] Linen Thread!` (no category) | (not sent to others) | dropped by design |
| Plain chat | typed line | typed line | |

Not relayed on purpose (no relay category): deaths, quest steps, tasks, teleports, friend logins, PvP, tips, teammate rare drops, `★` system lines, any uncategorised line on the personal feed.

What only the player sees: the `+N Luck XP` suffix, `Chaos Dungeon reward:` and `turned up` drops, `Quest complete:`, `X pet is now following you!`, `New Collection! Unlocked the ...`, the `The Fortress reward:` lines, and (never the other way round) the `unlocked:` announcement. What only others get: `unlocked:`, `received a rare (raid) drop ... from ...`, `completed the quest:`.

How one drop reaches the chat (a Member C Savage Mushroom tool drop, three lines at once, three Discord posts before this change): `unlocked: [T3] Enchanted Trowel`, then `received a rare drop: [T3] Enchanted Trowel from Savage Mushroom!`, then `New Collection! Received [T3] Enchanted Trowel as a Savage Mushroom drop.` For Wulf the same drop is `New Collection! Received ... +726 Luck XP` then `Savage Mushroom dropped [T3] Enchanted Trowel!`.

## 4. Inconsistencies found (with evidence)

1. **Luck XP only on own lines** (above). 0 of 367 other-member collection lines, 123 of 123 own ones.
2. **Bucket by wording** (above): 29 own unlock-type drops in the logs were all digested as Drops, 144 other-member `unlocked:` lines as Unlocks. The same item (a T2 Enchanted Chisel) landed in different sections depending on who got it. Fortress loot is the most visible case because every Fortress drop is an unlock item.
3. **The digest decided "unlock" with a 10 second timer**, not with data: an `unlocked:` line moved a drop out of Drops only if the drop line had been seen within 10 s, so a restart or a delayed poll in between left the item in both lists or in the wrong one.
4. **Lucky / Shiny unlock variants did not pair up.** `unlocked: [Shiny Lucky] Culling Knife` and `received the Shiny Lucky Culling Knife!` (no brackets) are one item; the digest compared `culling knife` with `shiny lucky culling knife` and could list it twice.
5. **`received a rare raid drop:` was not recognised by the collector** (only `rare drop:`), so every Fortress drop of another member was posted as `received **received a rare raid drop: [T1] Bounty Beacon from Fortress!**` (58 lines).
6. **Other members' quest line posted twice over**: `completed quest **completed the quest: Caravan Defense!**` (the collector knew `Quest complete:` only). Own quests were fine (70 vs 15 lines).
7. **Pets**: others' `received **received the Luck pet!**`, own `received **Fortify pet is now following you!**`; the digest listed `Luck pet` versus `Fortify pet is now following you`.
8. **Own-only wordings went in raw**: `Chaos Dungeon reward: ...` and `turned up ...` were posted and digested as the whole sentence (`Drops: Chaos Dungeon reward: [T1] Steady Aim`), `Unlocked the [Lucky] Enchanted Grip. +722 Luck XP` as `logged **Unlocked the ...**`.
9. **Ultra Rare treatment differed by line kind**: the keyword check (`shiny`, `lucky`) ran for rare-drop and collection lines but not for `unlock` lines, so a Shiny Lucky tool announced with `received the [Shiny Lucky] ...` was never "ULTRA RARE" while the same item announced as a drop could be.
10. **Three posts per drop for others** (unlock, drop, collection), two for own: 2,123 structured live posts in the logs against 1,491 logical events (30 % fewer, none lost). Role pings fired up to twice for one item.
11. **Fortress and sources worded differently**: `The Fortress` versus `Fortress`, `T3 Chest Drops` versus `a treasure chest`, `Plunder Drops` versus `plundering`, `Barter Drops` versus `bartering`.
12. **Dead / wrong code paths**: the digest accepted a `friends` channel the collector never emits; `evt.channel` was `clan` for both feeds, so a message could not be traced back to "mine" or "someone else's" (now `self`).

Also found and not changed (ideas): level-ups are 58 % of all live posts (861 of 1,491); a skill leveling 1-99 floods the channel. The digest already folds them, the live relay does not.

## 5. The typed event model

`normalise(raw)` is the only place text is parsed. Output (the fields that matter):

```
type        drop | unlock | pet | collection | levelUp | quest | chat | other
player      display name, self  true when it came from the personal feed
item        '[T3] Enchanted Trowel' (canonical: brackets as printed, "received the Lucky X" becomes "[Lucky] X", no "!" and no Luck XP)
itemKey     lower case of item, the identity of an item for pairing and dedupe
qty         2 for "2x" / "Claimed 2x"
source, sourceKind   'Dire Lich' / monster, 'Fortress' / fortress, 'a Fortress milestone' / milestone, 'a treasure chest' / chest, 'plundering', 'bartering',
                     'a task completion' / task, 'the Alms Path' / alms, 'Craft' / skill (own and others' wordings give the same pair)
skill, level | pet, shiny | tier, variant (Lucky / Shiny Lucky)
rawKeys     the keys of every chat line merged into this event (restart / DOM-rebuild dedupe)
```

**Rules (deterministic, in this order):**

1. Strip `+N Luck XP`. Quest and level lines give `quest` and `levelUp`; pet lines (and `Unlocked the X Pet`) give `pet`.
2. A line about an item gives `drop` (rare-drop line), `unlock` (`unlocked:` / `received the`), or `collection` (`New Collection!`).
3. **The item decides**: if `items.json` says the item has `type: "unlock"` the event is an `unlock`, whatever line carried it. The two quest-reward types the game never announces as unlocks (`barter_charm`, `queue_row`, `queue_insert`) are excluded: in the logs every other unlock type (tool, almanac, beacon, satchel, hotsauce, spice, notes, corruption, banner, ledger, glyph, tablet, relic, feather, shard, medallion, blueprint, conduit, sweet, compass, coin_purse, looters_sack) had an `unlocked:` line for others, those two had none.
4. A collection line that is the only record of a drop (monster / dungeon / Fortress / milestone source, phrase `as a X drop|milestone`) is a `drop`; a collection from skilling, tasks, chests, plundering, bartering, the Alms Path or a quest stays a `collection`.
5. Lines of the same player and item in one batch are **one event**; the highest priority wins (unlock, pet, drop, collection) and the others add `newCollection: true` and the source. A later line of the same item within 20 s that adds nothing is suppressed (a trailing collection line in the next poll). In the logs only 6 monster-form collection lines had no drop partner, all of them own Chaos / chest / plunder lines.

**Buckets (digest and live text), same for everybody:**

| type | digest section | live post |
|---|---|---|
| drop | Drops (repeated drops fold into `X ×3`) | `💎 received **item** from source` |
| unlock | Unlocks | `🔓 unlocked **item** from source` (pings both the unlock and the rare-drop roles if a drop line came with it) |
| pet | Pets | `🐾 received the **Luck pet**` / `✨ ... SHINY ...` |
| quest | Quests | `📜 completed quest **X**` |
| levelUp | Levels (highest per skill) | skill emoji `Skill level is now **N**` |
| collection | not listed | `📖 logged **item** (source)` |

So Fortress loot is Unlocks for Wulf and for Member A alike. If the clan would rather see Fortress loot under Drops, it is one rule to change (the item decides, `NOT_ANNOUNCED_UNLOCK_TYPES` in `relay-events.js`); say so and it is a two-line change.

**Compatibility.** Dedupe keys are unchanged (`channel|time|player|text` per raw line), so a rebuilt chat history after the update is still recognised. `digest-state.json` is migrated on load (`migrateDigestBuffer`): entries are re-filed by item, wording leftovers (`Chaos Dungeon reward:`, `X pet is now following you`, Luck XP) are cleaned, duplicates collapsed. The old outbox of raw collector events is converted to typed events on load. If `data/raw/items.json` is missing the unlock lines still say what is an unlock; only own unlock-type drops would then fall back to Drops.

## 6. What was changed

- Luck XP removed everywhere in the relay and digest (collector regex, live text, digest cleaner, tests).
- `overlay/relay-events.js`: normaliser, pipeline, formatter, digest bucket and migration, event key.
- `overlay/relay-core.js`: outbox/gate/payload moved out of the watcher so five simulated instances can run the real code.
- `overlay/chat-relay-collect.js` version 12: `self` flag, no Luck XP field.
- `overlay/panel-resize-watcher.js`: uses the above; the digest takes typed events; digest, hiscores and raid summaries respect the lease.
- `overlay/discord-sender.js`: `GET` (message or webhook) and `raw` PATCH (webhook name), needed for the lease.
- Plugins tab: **Chat Relay, "Several ScapeLite Users On This Channel"** (`relayRole`: Automatic default, Always post, Never post).

## 7. Duplicate-instance protection

> **Superseded in part by section 8 (2026-10-28).** The protocol below (7.3) is still how the leader election works, but the lease message no longer lives in the relay channel and the webhook name is no longer renamed: it lives on an optional private lease webhook, and without one nothing is written to any channel. Where this section says "a small message appears in the channel", "auto-discovery" or "zero setup", read section 8.

### 7.1 Problem

N testers, one clan, one relay channel. Everyone's client receives the same clan lines, so N ScapeLite instances post each line N times. The same holds for the digest (N digests), the clan rank post (N) and a raid summary (every raid member's instance).

### 7.2 Options compared

| Option | Duplicates | Coverage | Setup | Failure | Verdict |
|---|---|---|---|---|---|
| A. One designated relay account (a "relay" switch each tester sets) | none if the clan keeps to it | everything, as long as that one PC is on | manual, every tester must read and obey it | the relay PC sleeps: silence | simplest, fragile; kept as the **"Never post"** setting for testers who want to stay quiet |
| B. Ownership: each instance posts only events about itself | none by construction | only players who run ScapeLite; **clanmates without it vanish**, which is the relay's main use today | none | an instance offline: only its own events are lost | too lossy as the only rule; also two different wordings of one event need the typed key |
| C. Event keys in the Discord message, "skip if the key is already in the channel" | race: two instances check at the same moment | everything | none | a webhook **cannot read a channel's messages**, so there is nothing to check against | not possible with webhooks only |
| D. **Leader lease in one shared webhook message** (chosen) | one poster per webhook at a time | everything the leader sees (the whole clan chat) | **none** (auto-discovery) | leader offline: another takes over after about 2 minutes | recommended |

**Recommendation: D, with A as a manual override and B's idea only as the data model.** In the lease design the leader sees every member's events through the clan chat (it sees its own through the personal feed), so no per-player ownership rule is needed, and nobody has to coordinate by hand. B is not combined in because a follower's own events would reach Discord twice (its own, wording S, and the leader's copy of it, wording O): only the typed event key tells them apart and a webhook cannot ask Discord which keys are there.

### 7.3 Protocol (`overlay/relay-lease.js`)

**One lease message per webhook.** It is created with `POST ...?wait=true`, read with `GET /webhooks/ID/TOKEN/messages/MSGID`, edited with `PATCH` (a webhook token may do all three on its own messages; verified on real Discord, 7.6).

```
-# ScapeLite relay lease · do not edit or delete · leader Wulf
||{"v":1,"id":"a1b2c3d4","n":"Wulf","e":3,"s":120,"t":1793...,"lk":["ab12cd34"],"dg":0,"cl":{"1f2e3d4c":"a1b2c3d4"}}||
```

`id` leader's random instance id (stored in `relay-instance.json`, survives restarts), `e` epoch (+1 per takeover), `s` heartbeat counter, `lk` keys of the last events the leader posted, `dg` time of the last digest post, `cl` once-only claims. The visible line is a human note; the JSON is in a spoiler.

**Setup string: not needed.** The message id is written into the **webhook's name** as a suffix ` [sl:1564613382999384146]` (a webhook token may rename its webhook, and `GET /webhooks/ID/TOKEN` returns the name). The first instance creates the message and sets the suffix; the others read the suffix. If two instances start at the same moment, each reads the name back after a short wait: the last name write wins, the other instance deletes its own message and adopts the winner's. Because one instance can read the name back before the other has written it, **every heartbeat and every poll looks at the name again**: an instance holding a message the name does not point to switches to the pointed one (and deletes its own if it made it), and a new leader starts posting only after its first heartbeat has re-checked the name. This was found by the first live run against real Discord (two leaders and two winners of one claim after 40 s) and is covered by the tests with 60 ms of network latency and by a test that starts an instance on the wrong message. If the lease message is deleted by hand the next instance that notices creates a new one and replaces the suffix. The name only shows in Discord's Integrations list; every ScapeLite message sets its own display name, so nobody sees it in the channel. Restoring the original name is just editing it in Discord.

**Roles per webhook:** `leader` (posts), `follower` (stands by), `unsure` (cannot read the lease: posts nothing).

- **Heartbeat.** The leader reads, checks it is still named, then writes `s+1` and the keys it posted since, every 15 s.
- **No clocks across PCs.** A follower only measures, on its own clock, how long `s` has not changed. After 90 s of no change the leader is considered gone. Clock skew and time zones cannot matter; the test runs three instances with clocks +5 h, 0 and -7 h.
- **Self-fencing.** A leader that has not confirmed the lease for 45 s stops posting, so a leader cut off from Discord is silent long before a follower takes over (90 s).
- **Takeover.** Random jitter, re-read (abort if somebody moved), write epoch+1 naming me, wait, read back: only if the lease still names me do I post. If two instances write at once the later write wins, and the loser sees it on the read-back or on its next heartbeat (which reads before it writes) and steps down.
- **Blind is not dead.** After a period in which this PC could not read the lease (Discord down, PC asleep) the "how long has the leader been silent" clock restarts at the first successful read. Without this rule a Discord outage made every instance take over at once (found by the test with four instances; fixed).
- **Failover replay.** Events are kept in the outbox for 150 s as a follower. If this PC becomes leader it posts the ones still queued, except those whose key the old leader listed in `lk` (its last posts). A leader that crashed less than one heartbeat after a post may be repeated once.
- **Graceful stop / game closed** releases the lease at once (`id: ""`), so a restart or a closed game does not wait 90 s. A watcher without a connected game never stays leader (it cannot see the chat).
- **Restart of the leader PC** resumes the lease without a new epoch.
- **Fail closed.** `unsure` holds events (15 minutes at most) and posts nothing; it never falls back to "post anyway", because the other PCs may be posting the same lines.

**What is gated:** live relay (clan and global channel), activity digest, clan hiscores rank post, and raid summaries.

- The digest gets a follower-side copy: the leader writes `dg` after a successful post; followers empty their buffer when they see it change (compared with a remembered value, never with a clock), so a later takeover does not repeat activity.
- Raid summaries are produced by each raid member's own PC, so they are not leader-gated: each PC **claims** the summary (`cl`, key = raid + 5 minute bucket, the neighbouring buckets count too) and posts it only if its claim stands after a short settle. Three simultaneous claimers: exactly one posts (tested). Claim collisions on the single message are possible but need two writers within the settle time; the residual risk is a duplicate summary, never a lost one.
- The clan status board is not gated: it is one card per member.

### 7.4 Setting (Plugins tab, Chat Relay)

**Several ScapeLite Users On This Channel**

| Value | Meaning |
|---|---|
| **Automatic (default)** | the lease decides; first run creates the lease message in each shared channel (relay, digest, hiscores, raid) and adds the ` [sl:...]` suffix to that webhook's name |
| Always post from this PC | you are the only ScapeLite user: no lease, no extra messages, as before this change |
| Never post shared messages from this PC | the PC stays a spectator (also useful for testers who only want the board) |

A solo user who wants no extra messages in the channel picks "Always post". The safe default is Automatic because the failure it prevents (N copies of everything) is the visible one.

### 7.5 Setup guide for a clan

1. The clan leader makes the relay webhook and gives the URL to the members, as before (docs/CLAN-STATUS-BOARD.md for the shared-webhook warning).
2. Every member pastes it and leaves the setting on Automatic. Nothing else.
3. Do not delete the "ScapeLite relay lease" message and do not rename the webhook's `[sl:...]` suffix away (if you do, the instances simply make a new one within a minute).
4. A member who must never post (a PC that is often off, a test install) sets "Never post".
5. Dashboard / log lines to look for in `Logs/Watcher`: `Relay lease: unsure -> follower (leader is Wulf)`, `follower -> leader (leader silent for 91 s)`.

### 7.6 Verified on real Discord (private test webhook, 2026-10-27)

In order: `GET webhook` (returns `name`), `POST ?wait=true` (lease message, 200 with id), `GET message` (200, content intact), `PATCH message` (200), `GET message` again (read-after-write consistent), `PATCH webhook` with a new `name` using only the token (200), `GET webhook` (name read back), restore the original name (200), `GET` of an unknown id (404 code 10008), `DELETE message` (204), `GET` of the deleted message (404 code 10008). One test message was created, edited and deleted; the webhook name was changed and restored. Rate-limit headers showed the usual 5 per 2 s bucket shared by all of these calls. A second live run used three simulated instances (real sender, real lease code, scaled-down timers) against the same test webhook: start of three at once converged to one leader in about 7 s, three simultaneous claims of one key gave one winner, a crashed leader was replaced after the TTL (about 13 s with a 9 s TTL), a graceful leave handed over in about 5 s; the lease message was deleted and the webhook name restored afterwards (all messages sent were lease messages labelled "ScapeLite relay lease", leader names "TEST A/B/C"). Not tested live: real PCs on different networks, whether renaming a webhook with a token is written to the server's audit log (it is not shown to channel members; a server admin might see "webhook updated").

### 7.7 What the tests cover (`npm run test:relay`, 30 tests)

Typed events and the corpus (13 tests, 113 real lines), then against a fake Discord with five instances running the real sender, lease and relay core: simultaneous start of 5, one post per shared event with own wording on the owner's PC, leader crash and takeover with no repeated or lost post, graceful stop and fast takeover, restart of the leader PC, GET failing (fenced, nothing posted, exactly one post afterwards), Discord down longer than the TTL (no blind takeover, no duplicates), lease message deleted, `always` and `never` modes, once-only claims by three PCs, the leader publishing the digest time, skewed clocks, and the old outbox migration.

### 7.8 Limits and untested

- Two leaders for up to one heartbeat (15 s) are possible when two instances take over within the same jitter window; the next heartbeat reads before it writes and resolves it. Events in that window can be posted twice.
- A PC asleep keeps its role in memory only until it wakes: it re-reads first, so it does not post stale events as leader (the fence), but a very long sleep followed by an old backlog is held, not posted.
- Whether Discord throttles `PATCH webhook` harder than message edits is untested (the lease writes only the name once).
- The lease message and the name suffix are visible to server admins. They are not visible to ordinary members in the channel list except the one message.
- The raid claim shares the lease message with the leader's heartbeat; a claim write that overwrites a simultaneous heartbeat only costs a missed beat.
- Real multi-PC behaviour (clock, network) has only been simulated.

## 8. Relay v2: no coordination message in the channel, an optional private lease webhook, version signalling (2026-10-28)

Why: the v1 lease (section 7) wrote a visible "ScapeLite relay lease" message into every shared channel and appended `[sl:ID]` to the webhook name. It looked bad, and when somebody deleted the message the leader wrote it again. This part re-evaluates the design with webhook-only access (no bot token), chooses a new one, and says what is still not possible.

### 8.1 What a webhook can and cannot do

| Can (with only the webhook URL) | Cannot |
|---|---|
| `POST` a message (`?wait=true` returns its id) | list, search or read the channel's messages |
| `GET` / `PATCH` / `DELETE` **its own** messages by id | read a message by id that another webhook (or a person) wrote |
| `GET` / `PATCH` the webhook object: name, avatar (verified live, 7.6) | make a message invisible: the only message flags a webhook may set suppress embeds or notifications, there is no ephemeral or hidden message |
| post into an existing thread (`thread_id`) | create a thread in a text channel; add reactions; get an idempotency key (the execute-webhook call has no nonce: posting the same content twice makes two messages) |

Message ids are snowflakes (time, worker, process, 12-bit sequence), so they cannot be guessed: finding another instance's message by trying ids is thousands of requests per message, against a 5 per 2 s limit. **Every instance of one clan holds the same webhook URL, so any two instances can read and write the same message, but only if they know its id, and the id can only travel through something all of them can read.** Verified live earlier: the webhook name. Nothing else in a webhook's reach is readable.

### 8.2 The idea "check whether the message was already posted, and if so assume another instance is watching" (evaluated)

The idea is right in a medium everybody can read. Over a webhook, the channel is not readable, so the check "has event K been posted?" has no way to be asked. Three variants, each ends at the same wall:

1. *Look at the channel before posting.* Impossible (8.1).
2. *Leave a trace that the others can see.* A trace they can read must be an own message whose id they know, or the webhook name/avatar. Own message in the channel = a visible message row (what the user dislikes). Name/avatar = every post would rewrite the webhook; a sequence of invisible characters in the name hides it in Integrations but is a hack that Discord can normalise away, is rate limited, and may write an audit-log entry per change (not verified). Rejected.
3. *Assume it, standing loop with a delay* (rank the instances by a stable id, a lower rank waits longer, post if the higher-ranked has not posted). The "has not posted" is again a read. Without it every instance either posts (duplicates) or waits for ever (loses). The second half of the idea, "somebody else will do it", needs to know that somebody else exists: ScapeLite may never put a signal into the game (display-only rule), the clan chat cannot be that medium.

The same idea **does** work as soon as one small shared place that every instance can read exists, and then it is the lease (a claim with a settle time: "write K, wait, read back, post only if it is still mine"); the event-granular version needs 2 reads and 1 write per batch of events and gives no benefit over a leader with a heartbeat, which also survives crashes. The lease from section 7 stays; what moves is where it lives.

### 8.3 Options compared (webhook only)

| Option | Duplicates | Lost events | Setup | In the channel | Verdict |
|---|---|---|---|---|---|
| Content-addressed key in the post, skip if present | n/a | n/a | none | nothing | impossible: no read (8.2) |
| Visible lease message in the relay channel (v1) | none | none | none | **a message + webhook name suffix** | rejected by the user |
| Name / avatar as the shared cell | none | none | none | name in Integrations, writes on every beat | hack, rejected |
| Deterministic election without talking | n/a | n/a | needs a roster | nothing | cannot know who runs ScapeLite or who is online |
| Ownership: every PC posts only events about itself | none | **clan mates without ScapeLite** | none | nothing | kept as the option **Own events only** |
| **Lease on an optional private lease webhook** | none | none | one extra webhook, pasted by everybody | nothing in the relay channels | **chosen for strict coordination** |
| No coordination at all (solo) | N for N users | none | none | nothing | the default when nothing is set: correct for one user |

### 8.4 The chosen design: three modes, nothing ever written to the relay channels

Setting *Several ScapeLite Users On This Channel* (Plugins > Chat Relay) plus the new field *Shared Lease Webhook URL (optional)*:

| Setting | What this PC does | Writes to Discord besides the posts themselves |
|---|---|---|
| **Automatic**, no lease webhook (default, one user) | posts everything it sees | **nothing** (a test asserts that the only requests are the post requests) |
| **Automatic** + lease webhook (clan with several users) | leader election and failover exactly as section 7.3; the leader posts, the others stand by | only the one lease message on the lease webhook |
| **Own events only** | posts only the events about its own player (the personal feed); digest, rank and raid summaries stay quiet | nothing |
| Always post / Never post | as before | nothing |

The lease webhook is a webhook in a **private** channel (for example leaders only) that the clan leader hands out together with the relay URL. It holds one message, the lease record (leader id and name, epoch, heartbeat, keys of the last posts, digest time, claims and the newest version `mv`). The pointer to that message sits in the lease webhook's name (`[sl:ID]`, now only on a webhook nobody reads). One lease serves every shared stream (relay, digest, clan rank, raid claims): the leader posts all of them that it has configured. A lease webhook that equals one of the posting webhooks is ignored (it would put the message back into a channel people read). If somebody deletes the lease message the instances create a new one within a minute and elect again (tested twice in a row); that now happens in a channel nobody looks at.

Trade-offs, honestly:

- Strict, no-duplicate relaying needs **one extra webhook once**. There is no zero-setup way to have it without a visible trace (8.1). A clan that wants zero setup can use *Own events only* (nothing to configure, nobody posts twice) at the price of not relaying clan mates who do not run ScapeLite, or stay with the default if only one member runs ScapeLite.
- Defaults to the case with the least risk of surprise: a solo user sees no change. A second user who forgets to set anything produces duplicates again (the log says so once at start: `Relay: no shared lease webhook is set ...`). ScapeLite cannot detect this, because it cannot read the channel.
- The lease webhook's URL is a secret of the same kind as the relay URL and is stored like it (`leaseWebhookUrl` in `chat-relay-config.json`, entered in the Plugins tab).
- Mixing: do not combine *Own events only* on some PCs with a leader on others: the leader relays the owners' events as well and the owners post them too.

### 8.5 Version signalling (the others are told they are behind)

The lease record has one extra field, `mv`: the highest ScapeLite version number any instance has written (`0.4.2` form only; anything else is ignored). Every instance writes its own version into it when it is higher than what is there (a follower does it with one edit of the message; the leader merges it in every heartbeat, so an old leader never lowers it) and reads it with every poll it makes anyway. An instance whose own version is lower than `mv` shows, in **Plugins > About**, "Another ScapeLite user on your relay runs vX and you are on vY: press Check For Updates", and logs it once per version. No names, no counts, no dates, no identifiers: nobody can tell who runs which version, only that a newer one exists. Tested: leader on the old version, leader on the newest, a follower with an invalid version string, one with no version, a leader that heartbeats on an old version for several beats (the record keeps the newest).

Limit: this needs the same shared place, so it works **only with a lease webhook**. Without one the instances share nothing readable (8.1), the posts carry no data the others can read. The smallest alternative that exists and needs nothing: the repo's own updater (Plugins > About > Check For Updates, `overlay/updater.js`, `checkOnLaunch` on by default), which compares with the upstream version. If a clan wants this signal without the lease, the clan leader announcing the update in the channel is the honest answer.

### 8.6 Clean-up of the first version

`overlay/relay-legacy-cleanup.js`, run by the watcher 20 s after start and hourly (a webhook is only looked at until it is clean):

1. `GET` the webhook; a name ending in ` [sl:<id>]` was written by the first version (it kept the lease message id only there and in memory, not in a state file).
2. `GET` that message; **only if its text starts with the ScapeLite lease header** it is deleted (`DELETE` on the webhook's own message). Anything else is left alone, the name too.
3. The name is restored (suffix removed).

Result is recorded per webhook (a short hash, never the URL) in `overlay/relay-legacy-cleanup.json` (including the deleted message ids). The new code has no code path that writes a lease message or a name suffix to a posting webhook (a test starts instances after a clean-up and checks it). Run on 2026-10-28 on the real configuration: 3 lease messages deleted (relay, relay global, raid summary) and the 3 webhook names restored; the digest and clan rank posts use the same webhook as the global relay, so no fourth one existed. Not recoverable: a lease message that a lost creation race had left behind and that was never referred to by a name (the first version deleted those itself; none were seen in the logs). A clan mate still running the first version would write a new one: update them, or delete theirs the same way.

### 8.7 Tests and live checks

`npm run test:relay` (39 tests), new or changed in v2: lease on a second fake webhook (the posting webhook is asserted to be untouched: no message, no rename, no request at all), simultaneous start of 5, crash and takeover, graceful stop, restart of the leader PC, deleted lease message (twice), failing GET, Discord down, creation race with latency, clock skew, once-only claims, the digest time; the default without lease webhook (only POSTs), *Own events only* (three PCs, a non-ScapeLite clan mate nobody posts), setting and clearing the lease webhook while running; version signalling (6 cases); the clean-up (deletes only a ScapeLite lease message, not a human message, not a foreign message, restores the name, is idempotent, retries after an outage, never stores the URL). Live on the private test webhook (2026-10-28): the clean-up on a labelled legacy test message and name suffix (message deleted, a second ordinary test message untouched, name restored), and three instances with the lease on the test webhook and versions 0.4.0 / 0.4.1 / 0.4.0 (one leader in under 20 s, both older instances reported the newer version); all test messages deleted and the name restored.

Untested: real PCs on different networks; whether a lease webhook in a channel with a different permission set behaves differently (it should not: a webhook only needs its own token); more than about 10 instances (every instance polls the one message every 15 s).

## 9. Ideas (not done; also in the roadmap under IDEAS, source "subagent: relay audit")

- Fold runs of level-ups in the live relay ("Mine 40 to 44") and a quiet-hours setting.
- A `Fortress loot under Drops` switch if the clan prefers it.
- Show the lease role (leader / follower / unsure) on the dashboard's Discord health card.
- A "who is the relay" line in the in-game Plugins section.
- Collect the missing wordings (global cape announcements) into the corpus once they appear in a log.
