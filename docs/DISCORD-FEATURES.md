# Discord side of ScapeLite: live status feasibility, feature ideas, and a review of what exists

Research note, 2026-10-22. No product code changed. A throwaway prototype was run against a fake local HTTP receiver only (nothing was sent to Discord, no config file with a webhook was opened). Player name used below is the pseudonym Wulf; webhook URLs are written as `https://discord.com/api/webhooks/ID/TOKEN`.

**Status 2026-10-22:** the shared sender (section 2, fragilities 1 to 10) is built: `overlay/discord-sender.js`, `overlay/safe-json.js`, tests in `npm run test:discord`, Discord health card and Test send button on the dashboard. The raid lobby alert is not a Discord feature (Windows toast to Pushover), so it has nothing to move.

**Update 2026-10-27:** the relay was audited end to end (typed events, Luck XP removed, one bucket rule for everybody, duplicate-instance protection with a leader lease): `docs/DISCORD-RELAY-AUDIT.md`.

Confidence markers: **[sure]** = stable, long-documented Discord behaviour; **[verify]** = from memory of the docs, check the current Discord developer docs (or one live test against a private test channel the user owns) before relying on the exact number.

## 1. Verdict

**A live status message is feasible with webhooks only (no bot), at low cost and low risk.** One webhook message per player, created once with `POST ...?wait=true`, then kept live by `PATCH /webhooks/{id}/{token}/messages/{messageId}`. Edits are cheap, a state file holds the message id, a deleted message is recreated on the first 404. Done properly it sends well under 10 edits a minute per player, a tenth of what the limits allow.

Recommended architecture: **webhook only for v1 (status board + existing posts), a tiny optional bot later only if the clan wants slash commands / buttons.** A relay server is not worth it. Effort: **M** for the single-player live status message (builder, cadence, state, dashboard card, tests), **M** more for the multi-player board with opt-in, **L** for a bot.

Everything in it is read-only reporting of the player's own state, which the player decides to share. No game input, no automation, no user tokens.

## 2. What exists today (review of the watcher)

> Update (Discord setup wizard): the user-facing setup is now the in-game **Discord setup wizard** and `docs/DISCORD-RELAY-SETUP.md`. The page collector (`chat-relay-collect.js`) also reads the chat lines the game keeps but does not draw because of its own chat filters (`chatHidden()` in the bridge), so the relay no longer depends on what the player's chat window shows. The text below describes the watcher as it was reviewed.

Sources read: `overlay/panel-resize-watcher.js` (about 2200 lines), `overlay/chat-relay-collect.js`, `overlay/raid-alert.js`, `overlay/game-bridge.js`, `overlay/status-server.js`, `docs/LOGGING.md`, `docs/PLUGIN-AUTHOR-GUIDE.md`.

| Feature | How it posts | Config (secret, git-ignored) | State file |
|---|---|---|---|
| Chat relay (clan / global): chat, rare drops, pets, unlocks, level-ups, quests | live, one POST per event, plain text, per-message `username` / `avatar_url` override, role pings as spoiler-wrapped mentions, `DISCORD_POST_SPACING_MS = 500` between posts | `chat-relay-config.json` | `chat-relay-outbox.json`, relayed-keys file |
| Activity digest | one POST every N hours or at fixed times | `digest-config.json` | `digest-state.json` (buffer + dedup keys) |
| Clan hiscores roster | poll the game, POST when rank or member totals change | `clan-hiscores-config.json` | `clan-hiscores-state.json` |
| Raid / dungeon summary | POST when a run ends (rules decide: size, guild mates) | `raid-summary-config.json` | none (in-page memory `__ccEndedRuns`) |
| Raid lobby alert | **not Discord**: toast plus a Windows notification forwarded to Pushover | none | in page |

All posts go through one function, `postToDiscord(webhookUrl, payload)`: `fetch` POST, returns true/false, logs the status and body on error. Webhook URLs are redacted by the logger and can be edited in the in-game Plugins tab (checked against a `discord.com/api/webhooks/` regex). No embeds are used on purpose (the author found the embed box too large for one-liners).

### What is good

* The chat relay has a **persisted outbox with retries** (6 tries), ordering preserved, and marks "relayed" only after Discord accepted it. A graceful stop flushes the outbox, bounded.
* Dedup keys persisted so a watcher restart plus a game DOM rebuild does not re-relay history; the digest keeps its own separate key set (a lesson already written down in the code).
* One supervisor / one watcher via pid lock files after the double-digest incident (0.4.0).
* Secrets are never logged and are stripped by `overlay/logging/redact.js`.

### What is incomplete or fragile (ranked)

1. **No 429 handling at all.** `postToDiscord` treats a 429 like any other failure: it logs and returns false. It never reads `retry_after` / `Retry-After` or the `X-RateLimit-*` headers. The chat relay retries on the next tick, which is fine in practice, but a burst (a raid with loot, or a long offline gap flushed at once) can trip the limit repeatedly, and the other three features do not retry at all.
2. **Digest, hiscores and raid summary ignore the result of `postToDiscord`.** The digest then resets its buffer and bumps `totalPosted` even when Discord rejected the post, so a failed digest silently loses 6 hours of activity. The hiscores poll writes `lastPost` after the post even if it failed, so a missed rank change is never re-announced. Raid summaries drained from the page are dropped if the post fails. Fix: return the status, keep the data until accepted (same pattern as the chat outbox).
3. **No timeout on the Discord `fetch`.** A hung connection stalls `processOutbox` (guarded by `outboxBusy`, so every later tick is skipped) and the awaiting digest/raid timers. Other code in the repo already uses `AbortSignal.timeout(...)`; Discord calls do not.
4. **Non-atomic state writes.** `saveOutbox`, `saveRelayedKeys`, `saveDigestBuffer` use plain `writeFileSync` (the digest config write alone uses temp + rename). A crash or power loss mid-write leaves a truncated JSON; loaders swallow the parse error and start empty, which for the relayed keys means a repeat flood of history. Use temp + rename everywhere.
5. **Duplicate sends are guarded in-process only.** The lock files fix the double-process case. There is still no protection against **two ScapeLite installs sharing one webhook** (for example the same player on two PCs); for the status message this matters (two writers fight over one message), see section 5.
6. **No health surface for Discord itself.** The dashboard shows counts and last post time per feature, but no "last error", "last HTTP status", "rate limited until", "webhook invalid (404/401)" and no test-send button. A deleted webhook shows as endless "error 404" log lines.
7. **Retry classification.** A 404 (webhook deleted) or 401 is permanent and should disable the feature with a visible reason; a 5xx / network error should back off. Today everything is the same "false", retried up to 6 times then dropped.
8. **Message size limits are not enforced.** `content` max is 2000 characters. `buildDigestPayload` uses `capList` per category but a busy 6 hour clan window with many players can exceed 2000 characters in total, which Discord rejects with 400 and the digest is then lost (see point 2). Needs a splitter or an embed.
9. **Mentions.** Role pings are built from config; the payload does not set `allowed_mentions`, so player-controlled text (a chat line containing `@everyone`) relies on webhook default permissions. Setting `allowed_mentions: { parse: [] }` plus an explicit `roles` list for intended pings is a cheap hardening. [sure: webhooks can ping everyone if the webhook's channel permission allows it]
10. **Digest and hiscores timers** are `setTimeout` chains that reschedule even when the post throws; fine, but there is no jitter and several features can fire in the same second (the 500 ms spacing is per outbox only, not global across features). A single shared sender queue per webhook would fix points 1, 3, 7 and 10 at once.
11. Roadmap item `feat-006` (clan hiscores timeout noise) is the same family as point 3.

Recommendation: before building anything new, extract a **`discord-send.js` module** (one queue per webhook URL, timeout, 429 aware, classified result, optional message edit). The status message, the existing four features and the test-send button all use it.

## 3. Discord API rules relevant to a live status message

### 3.1 Webhook endpoints

* Create: `POST https://discord.com/api/webhooks/{id}/{token}?wait=true` returns the full message object (including `id`) when `wait=true`; without it you get 204 and no id. [sure]
* Edit: `PATCH .../webhooks/{id}/{token}/messages/{messageId}` with a JSON body of the same shape (`content`, `embeds`, `allowed_mentions`; `username` and `avatar_url` are NOT editable on an existing message, they stay as at creation). [sure that identity is fixed at creation; verify whether the current docs accept `username` and ignore it]
* Delete: `DELETE .../messages/{messageId}`. Get: `GET .../messages/{messageId}` (handy to check a message still exists). [sure]
* `?thread_id=` targets a thread of the webhook's channel. [sure] Forum-channel webhooks need `thread_name` on create. [verify]
* The webhook token is the only credential. Anyone holding the URL can post, edit and delete messages that webhook created. It must be treated as a secret. [sure]
* A webhook can only edit messages **it created**. [sure]
* A webhook message cannot be pinned by the webhook; pinning is done by a human with Manage Messages. [sure]
* Webhook messages can contain embeds and (via a link component) buttons only if the webhook is owned by an application; plain user-created webhooks cannot send interactive components. [verify] Treat buttons / select menus as bot-only.

### 3.2 Rate limits

* Per webhook route, the practical limit is **5 requests per 2 seconds** for execute, and the edit route has its own bucket of the same order. [verify exact numbers; the response headers tell you at runtime]
* Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Reset-After`, `X-RateLimit-Bucket`. A 429 has a JSON body `{ "message": "You are being rate limited.", "retry_after": <seconds, float>, "global": <bool> }` and a `Retry-After` header. [sure]
* Global limit (50 requests a second per bot) does not apply to plain webhooks, but a **Cloudflare ban** applies to an IP that causes too many 4xx (10 000 invalid requests in 10 minutes) [sure: documented]. Do not hammer a dead URL.
* Rules: obey `retry_after`; never retry sooner; do not fire in parallel on the same webhook; keep one writer per webhook. An edit storm is the thing to avoid, not the limit itself.
* Edits do not create a new "message" and do not notify anyone, but edited messages show an "(edited)" mark (also on webhook messages). [sure]

### 3.3 Message limits

* `content` 2000 characters. Up to 10 embeds per message; total of all embeds' text (title, description, field names and values, footer text, author name) **6000 characters**. [sure]
* Embed: title 256, description 4096, up to 25 fields, field name 256, field value 1024, footer text 2048, author name 256. [sure]
* `color` is an integer. `timestamp` is an ISO-8601 string and renders as a local-time stamp in the footer. [sure]
* Markdown and the dynamic timestamp tag `<t:UNIX:R>` ("3 minutes ago") work in `content`, in embed description and in field values (not in titles or footer text). The client re-renders `R` itself, so a "last seen" line stays fresh with no edits. [sure]
* Embed `thumbnail.url`, `image.url`, `author.icon_url`, `footer.icon_url` must be **public http(s) URLs that Discord's servers can fetch**. `http://localhost` and LAN addresses cannot be fetched (the image shows broken or missing). [sure]
* The attachment route (multipart upload with `attachment://file.png`) works with a webhook, so an image **generated by ScapeLite** (for example a progress chart PNG) can be sent with the message. Editing a message with a new attachment replaces its attachments; this makes each edit heavier, so use it for low-frequency posts (digest chart) rather than the live status. [sure that attachments work on create; verify edit semantics for attachments]

### 3.4 Icons: how to host them

Options, from best to worst:

1. **The game's own CDN.** The code already uses `https://play.scapewatch.com/assets/icons/ui/hiscores.png` as an avatar. If item, skill and mob icons live under the same host (the overlay fetches `https://play.scapewatch.com/shared/data/*.json` and the game has an `assets/icons/...` tree), embeds can point straight at them with no hosting. To verify: the real icon path for skills, items, nodes; and that the host allows hotlinking from Discord's image proxy (it normally does, Discord proxies through `images-ext-*.discordapp.net`). Risk: a path rename by the game developers breaks icons (a graceful fallback is no thumbnail).
2. **The public ScapeLite GitHub Pages site** (the project already has Pages live). Ship a few dozen skill glyphs there. Fully under the project's control, no dependency on the game's CDN. Costs a one-time asset pass.
3. **Unicode / Discord emoji only.** Zero hosting, works offline. The chat relay already maps skills to emoji (`SKILL_EMOJI`). Good enough for v1; a custom-emoji set would need server-side upload by the clan admin.
4. Not possible: `http://localhost`, `file://`, LAN IP (Discord cannot fetch them), and no `data:` URIs in embeds. [sure]

Do not upload icons through the webhook on every edit.

## 4. Recommended approach

### 4.1 Comparison

| | Webhook only | Real bot | Small relay server |
|---|---|---|---|
| Setup for a player | paste one URL (already how everything works) | clan admin creates an application, invites the bot; the bot must run somewhere 24/7 | someone hosts and secures a server; every player configures its address and a key |
| Live status message | yes (create + PATCH) | yes | yes |
| Slash commands, buttons, select menus, modals | no | yes | only through a bot |
| Per-user ephemeral replies, role-based access | no | yes | via bot |
| Threads / forum posts / scheduled events | threads by `thread_id` (existing thread); forum post on create; no scheduled events | yes, all | via bot |
| Receives data from Discord | no (send-only) | yes (gateway, interactions) | yes |
| Token security | the webhook URL, per channel, easily rotated; no read power | the bot token has read/write across the server; a leak is serious; it must never ship in the repo or installer | one shared secret plus server upkeep |
| Hosting and cost | none | a machine that stays up (or a free-tier host); one member's PC is fragile | a host, a domain, uptime duty |
| Where the data comes from | each player's PC | each player's PC would have to push to the bot (a relay anyway) | each PC pushes to it |
| Discord ToS | fine | fine (registered application) | fine |
| Fit with "everything runs on the player's own PC, nothing leaves unless they set it up" | perfect | needs a shared component | breaks the principle, and the maintainers carry operations |

Key point: **a bot only helps when something must read from Discord or react to a user in Discord** (slash commands, buttons). Everything the clan asked for so far is send-only. Status board, announcements and digests are all send-only.

### 4.2 Recommendation

1. **Phase 1 (webhook only):** harden the sender module (section 2), add the live status message for the player's own channel/webhook.
2. **Phase 2 (webhook only):** status board channel where each clan member's ScapeLite edits its own message through a per-clan webhook (see 6). Message ownership is per webhook, so all members share one webhook URL, which means every member can edit everyone's message. That is acceptable for a trusting clan, and the id mapping keeps accidents unlikely, but it is the argument for per-member webhooks (each player creates a webhook in the board channel; needs Manage Webhooks) or for a bot.
3. **Phase 3 (optional bot, only if the clan wants it):** a separate, optional, clan-run component, not part of the ScapeLite installer. It would read a status board from a small store or from the members' messages, and offer `/whois`, `/clan-now`, buttons for the digest. Decide after Phase 2 is in use.

Not recommended: a ScapeLite-hosted relay server. It adds operations, privacy liability and an attack surface for little that Phase 1 and 2 cannot do.

## 5. Live status message: design

### 5.1 Data model (the snapshot, built on the player's PC)

Everything comes from page-side reads the bridge already exposes (display-only):

| Field | Source today | Missing |
|---|---|---|
| Player display name | `bridge.whoami()` (name, display) | pseudonym setting (6.3) |
| Current task: skill, activity name, node / place | `bridge.live()` (`task`, `dest`, `state`), `bridge.current()` (`lv`: skill, level, pct, next level; combat flag, loadout, trained skill, kills) | nicely formatted activity text ("Foraging 120 Fur" needs the task's target quantity: in `task` / `project().head`) |
| Progress (34/120), ETA, XP per hour | `bridge.project().head` (success, `timeSec`, `totalXp`, `xpHr` validated 0.000% against the game's dashboard), `task` counters | a stable "done / goal" for open-ended tasks (skip the bar then) |
| Location | `live().dest`, node names (`nodeById`) | nothing |
| HP, food | `alertState()` (currentHP, maxHP, hp), `held()` (food counts) | a "food left" summary |
| Active potions | `alertState().potions`, `held()` pots with charges left | pretty names with remaining time |
| Slayer task and kills | `live().slay`, `current().kills` ({count, target}) | nothing |
| Fortress / raid | `lobby()`, `raidParty()`, `__ccLastRun`, raid-alert `raidSelf` | a "wave N, chance of loot" summary is only in the Fortress tracker page-side |
| Queue preview | `queued()`, `project().slots` | short text of the next 2 or 3 tasks |
| Today's totals and streak | Tasks log (`Logs/Tasks`), task history `taskHistory()` | a "today" aggregate (XP gained, tasks, drops) |
| Online / offline | the watcher's CDP connection state; `bridge.ok()` | a heartbeat timestamp (see 5.4) |

Proposed JSON snapshot (what the builder consumes; also what could later be exported to a bot or a board file):

```
{
  v: 1,
  player: "Wulf",                 // pseudonym, user-chosen, never the account id
  ts: 1760000000000,              // snapshot time
  state: "skilling" | "combat" | "raid" | "idle" | "offline",
  activity: { skill: "foraging", text: "Foraging 120 Fur", place: "Pinewrap", done: 34, goal: 120, etaSec: 720, xph: 2400000 },
  level: { skill: "foraging", level: 71, pct: 38 },
  combat: { mob: "Goblin", killsDone: 12, killsGoal: 40, hpPct: 0.82, food: 14, loadout: "melee_1" },
  slayer: { mob: "Goblin", done: 12, goal: 40 },
  raid: { kind: "fortress", wave: 7, party: 3 },
  potions: [{ name: "Swift", minLeft: 9 }],
  queue: ["Mining Iron", "Fight Cow"],
  today: { xp: 1850000, tasks: 31, drops: 2 }
}
```

### 5.2 The message (embed vs plain)

Recommended: **one embed**, because a status is a card (colour = state, fields = numbers, `timestamp` = "last update"), unlike the chat relay's one-liners where an embed's fixed padding hurt.

```
author:      { name: "Wulf" }                         // plus author.icon_url = skill icon (public URL)
color:       green skilling / red combat / purple raid / amber idle / grey offline
description: "Foraging 120 Fur at Pinewrap"           // one line, markdown
thumbnail:   skill or item icon (public URL) or none
fields (inline): Progress  "▓▓▓░░░░░░░ 34/120"
                 ETA       "12 min"      (or <t:UNIX:R> style absolute time)
                 XP/h      "2.4M"
                 Level     "Foraging 71 (38%)"
                 HP        "82%"   Food 14
                 Next      "Mining Iron, Fight Cow"
footer:      "ScapeLite live"
timestamp:   ISO time of the snapshot
```

Rules:
* Keep under 1500 characters total; the 6000 cap is irrelevant for a status card. Truncate field values and the player name defensively (256 / 1024).
* ETA as a plain "12 min" text goes stale between edits. For finish times use the absolute dynamic timestamp `<t:1760000720:R>`: the Discord client counts it down by itself with **zero edits**. This is the single best trick: progress edits can be rare and the clock still looks live.
* Plain `content` can be left empty or used as the accessible one-line fallback ("Wulf: Foraging 120 Fur at Pinewrap") for mobile notification previews and screen readers; an embed alone has no notification text.
* Set `allowed_mentions: { parse: [] }` so no field text can ping anyone.
* Never put an `@` role mention in the status message.

### 5.3 Cadence rules

Goal: always correct on task changes, calm on progress, never near the limits.

| Trigger | Rule |
|---|---|
| Task / state change (new activity, combat <-> skilling, idle <-> active, raid start/end) | send within 1.5 s of the change, with a floor of one edit per 1.5 s |
| Progress-only change (counts, % , XP/h) | coalesce; at most one edit per **N = 30 s**, only when the rendered text actually changed (compare the built embed, ignoring timestamp) |
| ETA | send as `<t:..:R>`; re-send only if the finish time moved more than 10% or 60 s (queue changed, speed changed) |
| Heartbeat | if nothing changed for **60 s**, send nothing; the "last seen" timestamp lives in the embed's `timestamp` and is refreshed on the next change or every 5 minutes at most |
| Idle | one edit ("Idle since <t:..:R>") then silence |
| Offline | when the watcher loses the game (CDP closed) or the snapshot has not updated for 90 s: one edit, grey, "Offline, last seen <t:..:R>" |
| 429 | stop sending until `retry_after + 250 ms`, keep only the newest snapshot (latest wins; do not queue old ones) |
| 5xx / network error | exponential backoff 2, 4, 8 ... 60 s, newest snapshot wins |
| 404 on PATCH | message was deleted: clear the stored id, create a new one with `?wait=true` on the next send (rate limited to once per 30 s to avoid fights) |
| 401 / 403 / 404 on the webhook itself | webhook invalid: disable and show it on the dashboard, no retries |
| App / watcher start | read the stored id, `GET` it once (or just PATCH); if missing, create |

Expected volume: during normal play a task change every 5 to 30 minutes plus progress edits every 30 s = at most 2 edits a minute per player, usually far fewer. With 30 clan members that is below one request a second across the whole board and about 2 per minute per webhook route.

### 5.4 Idle / offline detection and heartbeat

* Online = the watcher's CDP socket to the game is open and the bridge reports `ok()`.
* **Graceful stop** (the watcher already has `gracefulShutdown`): send one final "Offline" edit before exiting (bounded at a few seconds).
* **Crash / power loss**: no final edit is possible, so the message would claim "live" forever. Fix with the timestamp trick: the embed shows "Updated <t:UNIX:R>" and a **board-side staleness rule**: any viewer sees "updated 3 hours ago". For the single-player case, the next start rewrites it; and the supervisor can send the offline edit when it notices the watcher died. A bot or a second process could mark stale messages offline; webhooks alone cannot.
* The heartbeat is a local concept (the snapshot timestamp), not a periodic Discord call. Do not edit every minute "to prove it is alive": that is the storm to avoid.

### 5.5 Pinned status message pattern

1. First send: `POST ...?wait=true`, store `{ webhookKey, messageId, channelId, createdAt }` in a state file (`overlay/discord-status-state.json`, atomic write, git-ignored, never contains the token: key it by a short hash of the URL, not the URL).
2. Every later send: `PATCH`. A human with Manage Messages pins it once; a webhook cannot pin.
3. If the webhook URL changes (hash differs), forget the id and create a new message.
4. If the user deletes the message: 404 on the next PATCH; recreate (the new message goes to the bottom, not the pinned spot, so the board shows a note "recreated, please pin"). A less intrusive alternative is a dedicated channel where the status is the only message.
5. Do not recreate more than once per 30 s (a user hitting delete repeatedly must not make an infinite loop).
6. A "Reset status message" button in the dashboard clears the id.

### 5.6 What to show, what NOT to show

Show (all opt-in toggles, defaults conservative): task and place, progress bar, ETA, XP/h, level of the trained skill, HP percent and food count, active potion names, slayer task progress, Fortress wave and party size, next 2 queue entries, today's totals.

Never show or send: the webhook URL or its token; the player id (`G.playerId`) or any account identifier; the real account name unless the user chose it as the display name (a pseudonym field exists for this); machine paths; IP address; chat content from private channels; friend or DM data; item values and gold (bank wealth attracts abuse); exact location history; anything about other players that the other player has not agreed to share (raid party member names should be counts only, or names of guild mates only).

### 5.7 Cost and CPU

* The snapshot is a handful of page reads that the bridge already memoises (`project()` has a 1.2 s memo). Poll every 2 to 5 seconds while a status feature is on, and not at all when the feature is off or Eco mode says the game is not visible (status still needs task changes, so poll slower, 10 s, rather than stop).
* Building the embed is microseconds. The cost is the HTTP request: one every 30 s at most. Negligible.
* No images are generated per edit. Icons are static URLs.

### 5.8 Failure behaviour

* Never `await` Discord in the watcher's main loops or in any code that drives the game connection. The status sender runs on its own queue and drops stale snapshots; its failures only change the dashboard indicator.
* Timeouts on every request (8 s). A hung webhook cannot stall the outbox or the digest (separate queue, separate `busy` flag).
* If Discord is down, the loop backs off to 60 s between attempts, keeps only the latest snapshot, resumes automatically. No unbounded queue, no memory growth.
* The status feature must be removable at runtime by a toggle (no watcher restart), and a crash inside it is caught and logged without affecting the relay, digest or the game bridge.

### 5.9 Multi-player status board

* One shared channel, one message per player. Each ScapeLite stores its own message id (state file above) and edits only that message. Ownership is per webhook, not per message, so with one shared webhook any member could edit any message; for a trusting clan that is fine, otherwise give each member a webhook of their own (Manage Webhooks needed) or use a bot.
* **Id mapping**: keyed by a locally generated random `boardId` (UUID created on first run), not by account or Discord identity. The message's footer text can hold the same short token so a recreated message can be matched.
* **Name pseudonyms**: a setting "Show me as" (default: the in-game display name only if the user turns the board on; otherwise a pseudonym field is required). Never derive it from the Windows user name or the Discord name.
* **Privacy opt-in**: off by default; first enable shows what will be sent (a live preview of the exact embed), with per-field toggles; one switch to pause (shows "hidden") and one to erase (deletes the message via `DELETE`). Opt-in is local: nobody can turn on another player's status.
* **Spam control**: a board channel should be read-only for chat (members can read, only webhooks write), the board is the only thing in it. Edits do not ping.
* Staleness: show "updated <t:..:R>" on every card so a crashed client is visible.
* Optional "clan now" summary: a second message, edited by one chosen member (the board owner), listing "N online, top XP/h, most active skill". Needs data from all members, so it can only be derived by reading Discord (bot) or from a shared store. With webhooks only, each player's own card is the unit; any rollup would be built by whoever runs the optional bot.

## 6. Recommended architecture

```
game page ──(CDP, read only)──> watcher
                                  │  snapshot every 2 to 5 s (bridge.live/current/project/alertState/queued)
                                  v
                    status-builder (pure function: snapshot + settings -> embed)
                                  │
                                  v
                  discord-send queue (one per webhook URL)
                  timeout, 429/retry_after, backoff, latest-wins, classified result
                                  │
                                  v
                  Discord webhook: POST ?wait=true once, then PATCH message id
                                  │
                  state: overlay/discord-status-state.json (id, hash of URL, last sig)
                  dashboard card: last status, last HTTP code, next allowed send, test-send, reset
```

The same `discord-send` queue then carries the chat relay, digest, hiscores and raid summary, which fixes the fragilities of section 2 in one place. Privacy filters and the pseudonym are applied in the builder, before anything reaches the queue, and a unit test asserts that the serialized payload never contains the webhook URL, `playerId` or the real name.

## 7. Prototype (throwaway, not in the repo)

Location: scratch space `proto/proto.js` (not committed; run `node proto.js`). Nothing leaves the machine: it starts its own `http` server on a random 127.0.0.1 port that plays Discord.

* **Fake webhook** implements `POST ...?wait=true` (returns an id), `PATCH .../messages/{id}` (404 if deleted), a sliding 5 per 2 s bucket, and answers 429 with `retry_after` plus `X-RateLimit-*` headers. It runs on a shared virtual clock so 10 game minutes are simulated in a second.
* **Builder**: snapshot to embed (author, colour by state, progress bar from block characters, ETA, XP/h, footer, timestamp, `allowed_mentions` none).
* **Edit loop**: dirty detection by comparing the built embed with the last sent one (timestamp and volatile fields excluded), a minimum gap between progress edits, immediate send on task changes, 429 handling (wait `retry_after` plus margin, keep only the newest snapshot), exponential backoff on 5xx / network error, and recreate-on-404.

Observed results (10 simulated minutes, one value changing every second, a task change at 200 s and 400 s, the message deleted at 450 s):

| Run | Edits sent | 429 received | Messages created | Note |
|---|---|---|---|---|
| Cadence rules as in 5.3 (5 s floor, 1 s ticks) | 83 | 0 | 2 (1 recreate after the delete) | about 8 edits a minute even in this worst case, far below the limit |
| No floor at all (storm), tick every 200 ms, change every tick | 172 in 2 simulated minutes | 34 | 2 | every 429 was absorbed by the retry_after wait; no failure, no lost final state |

With the production 30 s progress floor the same scenario drops to roughly 2 edits a minute. The prototype proves the cadence logic, the 429 recovery and the recreate path; it does not prove the exact real limits (those need the verification below).

Plan to turn it into the real thing: (1) `overlay/discord-send.js` with unit tests using exactly this fake server; (2) `overlay/discord-status.js` builder with a golden-file test of the embed and a privacy test; (3) watcher wiring behind a setting; (4) dashboard card; (5) a manual one-time test against a private test channel the user owns.

### Things to verify with the real API before building

1. Exact current per-webhook edit and execute limits (read the `X-RateLimit-*` headers on a real private test webhook, send nothing sensitive).
2. That `PATCH` ignores or rejects `username` / `avatar_url`.
3. That an embed `thumbnail.url` pointing at `https://play.scapewatch.com/assets/icons/...` renders in Discord (hotlinking, correct paths).
4. `<t:UNIX:R>` inside an embed field value counts down live on desktop and mobile (it does in `content`; embeds should be the same).
5. Edit behaviour with attachments (only if charts are wanted).
6. Whether Discord shows the "(edited)" mark on a webhook status card (cosmetic).

## 8. Privacy rules (hard rules for every Discord feature)

1. Off by default; each channel needs its own opt-in and a visible "what is sent" preview.
2. The webhook URL is a secret: never logged, never in an error message, never in the dashboard JSON, never sent back to the page (the existing redaction plus the in-game Plugins tab editing already follow this; keep it).
3. Display name is chosen by the user; the account id and Windows user name are never sent.
4. No gold, bank or item values; no map position history; no other player's data without that player's consent (raid party: counts, guild mates by name only).
5. `allowed_mentions` always set; mentions only for roles the user configured.
6. Quiet hours and per-event routing apply to Discord the same way as to local alerts (the raid alert already has quiet hours 23:00 to 08:00).
7. Everything is the player's own state, read-only. No game input, no automation, no user tokens, no self-bot. Automated posting through a webhook is a supported Discord feature.

## 9. Ranked feature ideas (Discord side)

Value / effort: S small, M medium, L large. "Needs bot" is marked.

| # | Idea | Value | Effort | Data the bridge already has | Missing | Risk / privacy |
|---|---|---|---|---|---|---|
| 1 | **Shared sender module** (queue per webhook, timeout, 429, classified errors, atomic state writes, keep data until accepted) | High (fixes lost digests/hiscores/raid posts) | M | n/a | refactor of 4 call sites | None; pure hardening |
| 2 | **Live status message** (edited message, section 5) | High | M | live, current, project, alertState, queued, whoami | activity text, progress counters, offline edit, dashboard card | Low; privacy rules of section 8 |
| 3 | **Discord health card + test-send button + last error** in the dashboard | High | S | dashboard already has per-feature cards and the log filter | last HTTP code, rate-limited-until, "webhook invalid" state | None |
| 4 | **Clan status board** (one message per member, opt-in, pseudonyms, staleness) | High for clans | M | same as 2 | per-member webhook story, board id mapping | Medium; opt-in, per-field toggles, delete on opt-out |
| 5 | **Per-event routing + quiet hours + digest quiet mode** (different webhook per event type, quiet hours, role pings only when not quiet) | Medium-high | M | chat relay event kinds, raid-alert quiet hours code | routing table UI in Plugins tab | Low |
| 6 | **Level-up and rare-drop / pet announcements with item icons** (embed thumbnail from the game CDN or Pages) | Medium | S to M | chat relay already knows kind, item name, skill emoji | item to icon URL map; verify hotlinking | Low; keep the one-line style as an option |
| 7 | **Idle / queue-finished alert to a private channel or DM-webhook** (also Pushover-like) | Medium-high | S | `alertState().idle`, queue head | a Discord target for the existing alert bell events | Low (own state) |
| 8 | **Fortress / raid run summary with luck verdict** ("loot chance 3%, got 2 rares: lucky") | Medium | M | raid summary entries (loot, waves, damage), Fortress tracker page-side | drop chances per item, a simple luck score | Low |
| 9 | **Digest v2**: embed with sections, progress bars, rank changes, split over several messages when over the limit, optional chart PNG | Medium | M | digest buffer, hiscores state, taskHistory | chart rendering (canvas to PNG in Node without dependencies is the cost); message splitter | Low; chart is local |
| 10 | **Clan hiscores v2**: rank-change embeds with arrows, weekly XP leaderboard, small sparkline image | Medium | M | clan hiscores poll and state | weekly baseline storage | Low |
| 11 | **Goal completion pings** (a goal in the Goals plugin is done, a quest is ready to hand in, a target level reached) | Medium | S | `goals.js` xp table, alertState (questsReady, chests, lamps), level-up events | a goal-done event to the sender | Low |
| 12 | **Templates and formatting in the dashboard** (edit message text with placeholders like `{player}`, `{item}`, preview, reset) | Medium | M | all the event fields | template engine plus safe escaping | Low |
| 13 | **Discord-side ops log** (a private channel where ScapeLite posts "relay started", "webhook invalid", "supervisor restarted") | Low-medium | S | supervisor and watcher logs with category `discord` | a sender target | Low; never include secrets |
| 14 | **"What is the clan doing right now" summary** (rollup of the board) | Medium | M (webhook) / S (bot) | board data | a reader of Discord or a shared store | Needs the board; best with a bot |
| 15 | **Slash commands** (`/status Wulf`, `/queue`, `/clan-now`) | Medium | L | all of the above | a bot, a gateway or interactions endpoint, hosting | **Needs a bot**; token security, hosting; see 4 |
| 16 | **Buttons / select menus** on the digest or board ("hide me", "pause 1h") | Low-medium | L | n/a | **Needs a bot** (interactive components need an application, not a plain webhook) | Needs a bot |
| 17 | **Threads / forum posts** for raid runs and big drops | Low | S to M | raid summary | `thread_id` / `thread_name` support in the sender | Low |
| 18 | **Scheduled events** (clan raid at 20:00) | Low | L | n/a | **Needs a bot** | Needs a bot |
| 19 | **Streaks and daily totals card** (days played in a row, XP today vs yesterday) | Medium | M | Tasks log, taskHistory | daily aggregation | Low; opt-in |
| 20 | **Per-user ephemeral replies** | Low | L | n/a | **Needs a bot** | Needs a bot |

Top 5 by value for effort: **1, 3, 2, 7, 4**.

## 10. Roadmap

The top ideas (1 to 7 plus digest v2 and routing) are added to the roadmap as ideas, not planned: `node scripts/roadmap.js list feat --q discord`. Existing related items: `feat-006` (hiscores timeout noise), `repo-014` (friendlier relay setup), `adv-005` (raid graph in the summary), `feat-031` (custom notification rules).

## 11. Open questions for the user

1. Is the goal a **personal** status (your own channel, one message) or a **clan board** (everyone's)? This decides whether Phase 2 and per-member webhook handling are needed.
2. Will the clan admin create one **board webhook for everyone**, or should each member use their own? One shared webhook is simpler but lets anyone edit anyone's card.
3. Is a **bot acceptable** at all (someone has to host it and hold its token), or must everything stay "paste a URL and go"? If bots are out, buttons, slash commands and "clan now" rollups are out.
4. Which fields are you happy to show by default (task and ETA yes; HP, potions, queue, today's totals?) and should the display name be the in-game name or a pseudonym?
5. Icons: use the game's CDN paths (needs checking that hotlinking is acceptable to the game developers), a set hosted on the ScapeLite Pages site, or emoji only?
6. Should a status be allowed when the game is open but the player is away (idle), or should "away" be detected (no task for N minutes) and shown as such?
7. Do you want me to first do the shared sender fix (idea 1) as its own small piece of work? It removes the silent-loss bugs in section 2 regardless of whether the live status is built.
