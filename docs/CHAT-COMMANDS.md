# ScapeLite chat commands (research, 2026-10-28)

Question: can ScapeLite support Minecraft-style slash commands typed into the chat (`/sl refresh`, `/sl help`, `/sl board repost`, ...), and which commands would actually be useful?

Short answer: **yes, and it is cheap.** The game has no slash-command handling of its own, ScapeLite already owns a chat box, the game's own box can be guarded with one capture-phase listener, and a "page leaves a note, watcher picks it up on its 3 s loop" mailbox already exists twice in the watcher (`__ccReloadRequest`, `__ccUpdateReq`). No new port, no new auth surface. The research is below. **The MVP (section 4.1) is built, see "Implementation status" next.** Line numbers in sections 1 to 3 refer to commit `3e26f7c` and have moved since.

## Implementation status (2026-10-28)

Built: the 8 MVP commands. `/sl help`, `/sl version`, `/sl status`, `/sl refresh` (alias `reload`), `/sl plugins`, `/sl plugin <id> on|off`, `/sl relay status`, `/sl digest preview`, `/sl hiscores check`, plus the hidden `/sl echo <text>`. Prefix `/sl` or `/scapelite`, exact match only.

| Piece | File |
| --- | --- |
| Page registry, parser, reply drawing, game-input capture guard (plugin `chat-commands`, ns `__ccCmd`, can be switched off in the Plugins list) | `overlay/chat-commands.js` |
| `__ccChat.local(text)` reply lines, and the one gate before `send()` in the ScapeLite chat box | `overlay/chat-plus.js` |
| Watcher host (allowlist, argument validation, limits, scrubbing) and the command handlers | `overlay/chat-commands-watcher.js` |
| Mailbox read on the 3 s loop, `hiscoresCheckNow`, `pollClanHiscores(..., { dryRun })` | `overlay/panel-resize-watcher.js` (`handleCommandRequests`) |
| Tests (23, no game, no Discord): `npm run test:commands` | `scripts/test-chat-commands.js` |

How it behaves, as built:
* **Local replies.** Reply lines come from `__ccChat.local()`: an `SL` tag, the accent border, shown on every tab, never saved to `cc-chat-log:v1`, not muted by filters, not in `latest()`, not in the game's message list (so the relay and the digest never see them). If the chat panel is not open, a one-line answer is a toast and a longer one opens the panel. Without the chat-plus plugin it is always a toast.
* **Watcher commands** leave `{ id, name, args }` in `window.__ccCmdBox` (at most 20). The watcher allowlist is the object returned by `createHandlers`; a name outside it, an argument that is not a short string, number or boolean, more than four arguments, an id seen before, or a command that is still running or too soon (`gapMs` per name) gets an error reply. Replies are cut to 30 lines of 220 characters and anything that looks like a Discord address is replaced with `[link hidden]`. Latency is up to 3 s (the loop), a `hiscores check` up to two minutes.
* **`hiscores check`** is `pollClanHiscores` with `dryRun`: it looks up the clan rank and every member, keeps the lookup (`state.members`, `STATUS`, and the member list follows the clan roster as in every poll) and reports; it never posts and never moves `state.lastPost`. Only one lookup runs at a time, scheduled or manual, so a check during a scheduled poll answers "already running". One run per minute.
* **`refresh`** sets `__ccReloadRequest`, the same flag as the status tooltip's "Reload ScapeLite". The reply cannot come back after the restart.
* **No post commands.** `digest post`, `board repost`, `hiscores post`, `raid retry`, `discord test`, `settings set` and `service restart` are not built. The test fails if the page registry gets a command whose kind is not `read` or `ctl`, so a post command cannot slip in without its `--yes` gate. No command takes a secret and none prints one.

Not built (from sections 1.4 and 3.6): the near-miss hold, the autocomplete popup, the command palette, `--yes` handling. Known limit, as designed: if ScapeLite is not injected, or the plugin is off, a `/sl` line is sent as ordinary chat.

Verified live on 2026-10-28 (the user's game, read-only): local lines, `version`, `status`, `plugins`, `relay status`, `digest preview`, `plugin <id> off/on` on a harmless plugin (restored), the capture guard on a stand-in input. **Not seen live:** a successful `hiscores check` (the game did not answer `clan_hiscores_my_rank` at the time; the scheduled poll timed out the same way), `refresh` end to end, and typing in the game's real chat box.

---

## 1. Interception: catching `/command` before it becomes a chat message

### 1.1 What the game does with the text (fetched `https://play.scapewatch.com/app/game.74703fe3dc0c.js`, read-only)

* The game chat input is `.chat-panel .chat-input`. Its handlers (all on the input element itself, bubble/target phase):
  * `keydown`: `h.stopPropagation()`, then on `Enter`: `if (qn && !qn.gate()) return;` (the chat-rules gate), then `if (value.trim()) t._sendMessage()`, then blur (setting `chatBlurOnSend`). `Tab` cycles the channel, `Escape` clears and blurs.
  * `keyup` and `keypress` only `stopPropagation()`.
  * A separate `document` keydown focuses the input when you press Enter elsewhere.
* `_sendMessage()` does **no parsing at all**. It trims the text and goes straight to one of: `L.send("friend_dm", ...)` (DM target set), a local "Click a friend or use Message Player" line (friends channel), `L.send("clan_chat", ...)` (clan channel, or local "You are not in a clan"), else `L.send("chat_message", {channel, text})`.
* **The client has no slash commands.** Grepped the whole 2.4 MB bundle for `startsWith("/")`, `charAt(0)==="/"`, `[0]==="/"`, `"/help"`, `"/w "`, `"/r "`, `"/clan"`, `"/me"`: no chat hits (the only `charAt(0)==="/"` is an icon-path helper; "slash" hits are the combat style "slash"). The only "command" strings in the bundle are the `[TEST] ... debug command(s)` throttle message and a `vt` object of `debug_*` helpers reachable from the console; those never touch chat and ScapeLite must never touch them.
* **Unknown: the server.** A line starting with `/` is sent verbatim in `chat_message`. We cannot tell from the client whether the server interprets `/something` (a `/help` reply would be a server `game` message). Finding out means sending one, which the research rules forbid. Practical consequence: ScapeLite must not claim any `/word` except its own prefix, so it can never collide with a server-side command either (see 1.4).
* Input is `maxlength` 200 in both boxes.

### 1.2 Option (a): ScapeLite's own chat box, `overlay/chat-plus.js` (recommended primary)

We own the field: `inp` (line 219) and its `keydown` handler (line 446). Enter calls `send(t)` which writes the text into the game's `.chat-input` and fires synthetic Enter events (lines 424 to 445). The hook point is the single line

```js
if (e.key === 'Enter') { const t = inp.value.trim(); if (t) send(t); e.preventDefault(); }
```

Insert one gate before `send(t)`: `if (window.__ccCmd && window.__ccCmd.handle(t, { source: 'chat-plus' })) { inp.value = ''; remember in hist; return; }`. If the registry says "this is ours", the line is consumed and **`send()` is never reached**, so no synthetic key event ever touches the game input. Zero server traffic, zero leak, no dependency on the game's DOM. This is also the only place where a local reply line can be drawn naturally (see 1.5).

Side effects to know about:
* `chat-plus` mirrors the **game's** message list (`attach()` observes `.chat-message-area`) and `chat-relay-collect.js` also reads the game DOM (`.chat-sender-name`, ...). A local line pushed only into chat-plus's own `msgs` array is invisible to the relay and digest. Good: command replies can never be relayed to Discord.
* `chat-plus` persists `msgs` to `localStorage` (`cc-chat-log:v1`). Local lines must carry a flag (`local: true`) and be excluded from `saveLog` and from `keyOf` de-duplication.
* chat-plus is a plugin that can be switched off or hidden (`hideGame`, `input:false` read-only mode). Option (b) is therefore also needed for people who keep using the game's box.

### 1.3 Option (b): the game's own chat input (recommended second layer)

A listener registered with `capture: true` on `window` runs **before** the game's target-phase handler on the input, and `stopImmediatePropagation()` there means the game's handler never sees the Enter. Design:

```js
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || e.isComposing || !t || !t.classList || !t.classList.contains('chat-input')) return;
  const line = t.value.trim();
  const m = CMD.match(line);              // ^/(sl|scapelite)(\s|$), case-insensitive
  if (!m) return;                          // not ours: do nothing at all, the game sends it as it always did
  e.preventDefault(); e.stopImmediatePropagation();
  setNative(t, ''); t.dispatchEvent(new Event('input', { bubbles: true }));   // clear like chat-plus does (value setter + input event)
  CMD.run(line, { source: 'game-input' });
}, true);
```

Why this is reliable:
* The game registers its handler on the element, so a window capture listener always fires first (event path is window, document, ..., target).
* It also catches ScapeLite's own synthetic Enter from `chat-plus.send()` (they are ordinary dispatched events), which is a free safety net: even if a command somehow reached `send()`, the game would still not see it.
* It also runs before the chat-rules gate (`qn.gate()`), so commands work even if the player has not accepted the chat rules yet, and they never open the rules dialog.
* It must use `window.__ccLife.scope('chat-commands')` (see `overlay/lifecycle.js`) so a re-inject cannot stack a second copy (a double handler would run every command twice). The usual teardown pattern from `chat-plus.js` applies.

What can still leak (be honest in the help text):
1. **ScapeLite not injected.** The watcher died, the game was started without the CDP flag, or the plugin is off: `/sl refresh` goes out as a plain public line. The text is harmless but visible. Mitigation: the status indicator already shows the connection state; a one-time hint in the first-run tour: "if the dot is red, do not type /sl commands".
2. **The seconds between a game (re)load and the watcher's inject.** Same effect, short window.
3. **A mistyped prefix** (`/s1 help`, `/ls help`, `/scapelte help`). The prefix match is exact so these are not swallowed. See 1.4 for the "near miss" guard.

### 1.4 Safe design (one prefix, never claim anything else)

* **One prefix**: `/sl` (alias `/scapelite`). Match `^\/(sl|scapelite)(\s|$)` case-insensitively on the trimmed line. Nothing else is ever intercepted: `/help`, `/w bob`, `/r`, `/me` and every other `/word` pass through exactly as today. This is what guarantees no collision with game or server commands, known or unknown.
* **Unknown subcommand = local error, never sent.** `/sl reflesh` replies "Unknown command 'reflesh'. Did you mean refresh? Try /sl help." Once the prefix matched, nothing from that line is ever forwarded.
* **Near-miss guard (own prefix only).** If the first token is within edit distance 1 of `sl` (`s1`, `ls`, `sll`, `s`) or distance 2 of `scapelite` (`scapelte`, `scapelight`), hold the line instead of sending it and show "Did you mean /sl? Press Enter again to send it as chat." A second Enter within 5 s sends it normally. Only text that looks like a mistyped ScapeLite prefix is ever held. A normal chat line or any other `/word` is never touched. In ScapeLite's own box this costs nothing; in the game's box the hold is done by the same capture listener (clear nothing, just swallow the first Enter and arm a 5 s flag). Make it a setting (`chatCmdNearMiss`, default on).
* **Optional "any slash line" guard in the ScapeLite box only** (setting `chatSlashConfirm`, default off): a line that starts with `/` but is not ours asks for a second Enter. Off by default because it changes how the player's own chat feels; useful for people who fear typos.
* **Never inside the game for the player.** No command clicks, queues, rerolls, equips or sends anything in-game. Commands read ScapeLite state or control ScapeLite itself (display-only policy). The registry has no verb that can reach `__ccBridge` write methods (`queueInsert`, `queueCtl`, `setChatChannel`, ...). Add a unit test that greps the command table for forbidden bridge calls.
* **Replies are local, never chat.** See 1.5.
* **Never act on chat text from others.** Commands only run from the local keyboard handlers above. The registry must not be reachable from anything parsed out of received chat messages (a player typing "/sl board repost" in clan chat must do nothing). This is easy to guarantee because the registry is only called from two Enter handlers.

### 1.5 Showing the reply (local only)

* **Primary: a local system line in ScapeLite's chat** (`chat-plus.js`). Add `window.__ccChat.local(text, {kind})` which pushes `{ ch: 'game', cat: 'scapelite', name: '', text, t: Date.now(), live: true, local: true }` into `msgs` with a distinct style (accent left border, "SL" tag, dimmer). It is never saved (`saveLog` filter), never merged, and not muted by "Everything else". Multi-line output (help, status) is several local lines. When chat-plus is not shown, open it (`P.setOpen(true)`) only for commands the user typed, never for background results.
* **Fallback: a toast** via the UI kit (`.cc-toast` exists, `ui-kit.js` line 317; check the exported helper name before use). Used when chat-plus is off or the command was typed in the game's own box and the chat-plus panel is hidden. Toasts for short answers ("Board repost queued"), chat lines for lists.
* **Never** write into the game's real message list (`ChatPanel.addMessage`): that is game state, would be mirrored by chat-plus and read by the relay collector.
* Long-running commands reply twice: an immediate "queued" and a later result line when the watcher answers.

### 1.6 Option (c): the Info Bar

`overlay/ui-bar.js` has buttons, menus and two small inputs but no command line, and it uses single-key hotkeys (`uiBarHotkeys`, line 444) that must ignore typing. A command line there would be a new widget. **Not recommended for the MVP.** A later nicety is a **command palette**: a hotkey (for example Ctrl+Shift+K) opens a small popup with one input plus the same autocomplete list, backed by the same registry. It is the safest surface of all (never connected to the game input, so it cannot leak) and works when chat-plus is off, but it is a new UI component, so phase 3.

---

## 2. Architecture: getting a command from the page to the watcher

### 2.1 What already exists (all verified in code)

| Channel | Direction | How | Used for |
| --- | --- | --- | --- |
| **Page mailbox polled by the watcher** | page to watcher | page sets `window.__ccReloadRequest = Date.now()` / `window.__ccUpdateReq = 'check'`; the watcher's 3 s loop (`secretsTimer`, `panel-resize-watcher.js` line 2065) does `Runtime.evaluate` to read and clear it (`handleReloadRequest` line 1596, `handleUpdateRequest` line 1547) | status tooltip "Reload ScapeLite", About "Check for updates" |
| **Page queues drained by the watcher** | page to watcher | `window.__ccChatRelay.drain()` every 5 s; `__ccLog` drained every 3 s (`drainPageLogs`); `__ccPluginSettings.takeSecrets()` | relay events, log lines, webhook secrets |
| **Watcher evaluating in the page** | watcher to page | `evalAwait(expr)` over CDP | everything else (`__ccPluginSettings.getAll()`, `__ccClanBoard.snapshot()`, `__ccGameSocket.request(...)`) |
| **Watcher local HTTP API** | external to watcher | `status-server.js`, 127.0.0.1:7777 and :80 (hosted by the **supervisor** when supervised, which forwards `plugin` and `discord-test` to the watcher over IPC) | dashboard buttons; `POST /api/watcher/restart` etc. |
| **`Runtime.addBinding` / `bindingCalled`** | page to watcher | **not used anywhere** (grepped `overlay/`) | n/a |
| `ws-hook.js` (`__ccGameSocket`) | game socket to page | wraps the game websocket; `request()` for hiscores | clan hiscores, raid summaries. It is a **socket tap, not a command bus**: it must not be extended for this. |

Two facts that rule out the "obvious" HTTP path from the page:
* `status-server.js` POSTs require `Host` and `Origin` to be the dashboard's own localhost origin plus header `x-cc-control: 1`; `ALLOWED_ORIGIN = https://play.scapewatch.com` is allowed for `GET /status` CORS only, and the Discord test send is stricter still (`testSendAllowed`, same-origin only). The game page therefore **cannot** call the control endpoints, deliberately (CSRF and DNS-rebinding hardening). Do not loosen it for chat commands.
* In supervised mode the HTTP server lives in the supervisor, not the watcher, so a watcher-side endpoint would need another IPC hop.

### 2.2 Recommended path

**Two layers, one registry, one mailbox.**

1. **Page-side command registry** (new plugin `overlay/chat-commands.js`, namespace `__ccCmd`, optional so it can be switched off in the Plugins list). Responsibilities: parse (`/sl <group> <verb> [args]`, quoted args, `--yes` flag), look up a table `{ name, group, summary, usage, args, mode: 'local'|'watcher', danger: 'read'|'post'|'control', run }`, autocomplete, history, render replies. Page-side commands (`version`, `plugins`, `plugin on/off`, `look`, `panels`, `queue cache clear`, `chat clear`, ...) run entirely in the page and call existing page APIs (`__ccPluginSettings`, `__ccBridge` read methods, `__ccUI`).
2. **Watcher commands through a mailbox**, not HTTP. For `mode: 'watcher'` commands the registry pushes a record to a bounded queue on the page: `window.__ccCmdBox = [{ id, name, args, at }]`. Add `handleCommandRequests(evalAwait)` next to `handleReloadRequest` in the 3 s loop: read-and-clear the queue in one `Runtime.evaluate`, validate every record against a **static allowlist table in the watcher** (`COMMANDS = { 'status': fn, 'board.repost': fn, ... }`), run it, and write the result back with `evalAwait("window.__ccCmdReply && window.__ccCmdReply(" + JSON.stringify(reply) + ")")`. The page shows the reply by id. This is the same pattern as the two existing mailboxes, so it needs no new port, no new auth concept and works identically supervised or standalone (the watcher process owns relay, digest, hiscores and board state and runs the loop).
   * Latency is up to 3 s. For a debug command that is fine ("queued ... done"). If it feels sluggish, add a faster 500 ms poll that only runs while `window.__ccCmdBox.length` is non-zero (the same `Runtime.evaluate` can read a cheap counter first), or switch to `Runtime.addBinding('__ccCmdSend')` + `Runtime.bindingCalled` for instant delivery. The binding is a clean upgrade but is new CDP surface (must be re-added after each reconnect, like the bridge attach), so start with the mailbox.
   * Process-side commands that need the supervisor (service stop/restart) call into the existing handlers (`gracefulShutdown`, the same `fetch` to `/api/watcher/restart` that `handleReloadRequest` already does from inside the watcher). No new privilege.
3. **No arbitrary code, ever.** The page can only name a command and pass **plain string/number/boolean args**. The watcher side: allowlisted names only, argument schemas validated (enums for features and plugin ids, numbers clamped, no paths, no URLs, no shell, no `eval`/`Function`), max queue length 20, max one outstanding command per name, 8 s timeout. Unknown name or bad args returns an error record, never an exception. Webhook URLs and secrets are never accepted as args and never echoed in a reply (status output shows `configured: true/false` only, like `STATUS.discord`).
4. **Trust boundary, stated plainly.** Any script on the game page can write `window.__ccCmdBox`, exactly as it can already write `__ccReloadRequest` today. That is acceptable only because the allowlisted watcher commands are either read-only or *rate-gated by the existing anti-spam logic* (below) and never do anything the dashboard's own buttons do not already do. Commands that cause an outbound Discord post need an explicit `--yes` (or the page-side confirm prompt) **and** go through the existing gates. The page-side `--yes` is a UX guard against typos, not a security control; the security control is that the post paths cannot exceed what the watcher would post anyway.
5. **Localhost only** holds by construction: CDP is already bound to 127.0.0.1:9222, the dashboard to 127.0.0.1, and no new listener is added.

### 2.3 Watcher refactors the catalogue needs (small)

The watcher keeps most "do it now" logic inside closures in `connectAndWatch`. To expose them without duplicating, extract thin named functions at module level (or put them on a `commands` object assigned inside `connectAndWatch`, since they need `evalAwait`):
* `boardRepost()` : `clanBoard.forget()` already exists (line 186 of `clan-board-sync.js`) and a normal `boardTick()` recreates the card. The recreate gate (`RECREATE_GAP_MS`, `STATE_CHANGE_GAP_MS`) stays in force.
* `hiscoresPoll({ post })` : `pollClanHiscores(evalAwait, cfg)` currently decides posting itself (`shouldPost`, line ~1213). Add an options argument so `post:false` runs the search and updates STATUS but never posts (dry run) and `post:true` still honours `postIntervalMinutes`/`majorRankChange` unless `--force`.
* `digestPreview()` : `buildDigestBlocks(digestBuffer)` + `chunkBlocks(...)` are pure; returns the text that *would* be posted. `digestPostNow()` = the body of the `scheduleDigestPost` timer callback; extract it as `runDigestPost()` and have both the timer and the command call it (it already contains the lease gate and the "nothing notable" skip).
* `leaseStatus()` is `STATUS.relayLease` already.

### 2.4 Existing anti-spam gates every post command must keep

* `relayGate(url)` returns `send` / `standby` / `unsure`; only `send` posts. Commands never bypass it, so a follower instance cannot be forced to post.
* `sender` rate limiting and per-feature health (`DISCORD_POST_SPACING_MS` 500 ms, `discordTest` 10 s per feature).
* Clan board recreate/state-change gaps; hiscores `postIntervalMinutes`, `majorRankChange`; digest "nothing notable since last digest -- skipped"; relay outbox de-dup.
* A manual `post` command may ignore *schedule timing* (that is its point) but **not** the lease/standby gate, not "nothing to say", and each gets its own minimum gap (suggest 60 s per command name, 5 per hour overall, kept in watcher memory).

---

## 3. Command catalogue

Conventions: `read` = changes nothing; `ctl` = changes ScapeLite's own state/settings only; `POST` = can cause an outbound Discord post (needs `--yes`, shows a preview first, respects the gates in 2.4). Effort: S under half a day, M about a day, L multi-day. "Where" = module that implements the logic. Everything is `/sl <word>`; `/scapelite` is the long alias.

### 3.1 ScapeLite core (page side)

| Syntax | What it does | Where | Kind | Effort |
| --- | --- | --- | --- | --- |
| `/sl help [command or group]` | Lists groups and commands, or one command's usage and examples | `chat-commands.js` registry | read | S |
| `/sl version` | ScapeLite version (from watcher's `SL_VERSION`), game bundle hash (the `game.<hash>.js` script URL), watcher uptime, injected plugin count | page + watcher `status` | read | S |
| `/sl status` | One-glance health: CDP/bridge ok, watcher uptime, relay lease role, Discord problems count, last digest/board/hiscores times (everything is already in `STATUS`) | watcher `status` | read | S |
| `/sl refresh` (alias `/sl reload`) | Reload ScapeLite = what the status tooltip's "Reload ScapeLite" does: sets `__ccReloadRequest`, watcher restarts and re-injects every plugin. Does **not** reload the game page | `status-indicator.js` pattern | ctl | S |
| `/sl plugins` | Lists plugins with on/off and loaded state (`STATUS.plugins`: id, label, enabled, loaded) | watcher `status` | read | S |
| `/sl plugin <id> on|off` | Toggle one plugin live (`setPluginEnabled`, same as the dashboard switch). Refuses `core` plugins. Tab-completes ids | watcher (allowlist from `PLUGIN_DEFS`) | ctl | S |
| `/sl settings get <key>` / `set <key> <value>` / `list [filter]` | Read or change a Plugins-tab setting through `__ccPluginSettings`. `set` is restricted to a safe-key regex and to keys that exist in `SCHEMA`; secret keys (`relay*Webhook`, `relayLeaseWebhook`, `*Webhook`) are neither readable nor settable here | `plugins-settings-ui.js` | ctl | M |
| `/sl look vanilla|combination|scapelite` | Same as the first-run Look chooser (`showLooks`) | `plugins-settings-ui.js` / looks code | ctl | S |
| `/sl panels reset` / `/sl panels list` | List ScapeLite panels and their open state; reset positions of ScapeLite panels only (never the game's; see memory note about Panel Fuse state: needs a backup step first) | `ui-layout.js`, `card-fuse.js` | ctl | M |
| `/sl chat clear` | Clear ScapeLite's chat history (same as the settings button) | `chat-plus.js` | ctl | S |
| `/sl chat find <text>` | Pre-fills the chat search box | `chat-plus.js` | read | S |
| `/sl about` / `/sl credits` | Link/info text (what `aboutInfo` shows) | `plugins-settings-ui.js` | read | S |
| `/sl update check` | Same as About "Check now" (sets `__ccUpdateReq`). `/sl update apply` is **deliberately not included**: it changes installed code, leave it to the dashboard | `handleUpdateRequest` | ctl | S |

### 3.2 Discord relay, digest, board, hiscores (watcher side)

| Syntax | What it does | Where | Kind | Effort |
| --- | --- | --- | --- | --- |
| `/sl relay status` | Relay role (`always/auto/never/own`), lease role/leader/epoch/errors, outbox length, per-feature health (configured, last ok, last error, queue, broken). Never prints URLs | `STATUS.chatRelay`, `STATUS.relayLease`, `discordHealth()` | read | S |
| `/sl relay outbox` | How many events are waiting, oldest age, last 3 summaries (type only) | `relay-core.js` `relay.outbox()` | read | S |
| `/sl relay lease` | Verbose lease view (hasLease, ttl, heartbeat, `newerVersion`) | `relay-lease.js` `info()` | read | S |
| `/sl digest preview` | Shows the digest that would be posted now (blocks, players, chunks) without posting. Includes buffer age and next scheduled time | `buildDigestBlocks` + `chunkBlocks`, `STATUS.digest` | read | S |
| `/sl digest post --yes` | Post the digest now. Goes through `relayGate`, "nothing notable" skip and chunk delivery; empties the buffer only for accepted chunks (existing behaviour); 60 s minimum gap | extracted `runDigestPost()` | **POST** | M |
| `/sl hiscores status` | Last poll time, next poll, last clan rank, rosterSync, ws-hook ready, last post | `STATUS.clanHiscores` | read | S |
| `/sl hiscores check` | Poll the clan rank and members **now without posting** (updates `STATUS` and `state.members`, prints rank and the changes that a post would announce). This is the "fetch clan hiscores / guild rank now" the user asked for | `pollClanHiscores` with `post:false` | read (queries game socket only) | M |
| `/sl hiscores post --yes` | Run the poll and post if the normal rules say so; `--force` additionally ignores `postIntervalMinutes` but never the lease gate | `pollClanHiscores` | **POST** | M |
| `/sl board status` | Card state: last send, skipped count, offline/stale class, message id present (no id printed), recreate pause | `clanBoard.status()` | read | S |
| `/sl board preview` | The fields the card would carry now (`fieldsFrom(snap)`) | `clan-board-sync.js` | read | S |
| `/sl board repost --yes` | `clanBoard.forget()` then an immediate `boardTick()`: drops the stored message id and posts a fresh card; recreate gap still applies | `clan-board-sync.js` | **POST** | M |
| `/sl board refresh` | Force an edit of the existing card (skip the interval gap, keep unchanged-skip) | `clanBoard.tick` | **POST** (an edit) | S |
| `/sl raid status` | Raid summary pending list size, last decision (`STATUS.raidSummary.lastDecision`) | `STATUS.raidSummary` | read | S |
| `/sl raid retry --yes` | `flushRaidPending(cfg)` now for finished runs still waiting | `flushRaidPending` | **POST** | S |
| `/sl discord test <feature> --yes` | The dashboard "Test send" (one `ScapeLite test message`, 10 s per-feature limit). Feature ids are an enum from `DISCORD_FEATURES` | `discordTest` | **POST** | S |
| `/sl discord health` | `discordHealth()`: per-feature state, global rate-limit-until | watcher | read | S |

### 3.3 Queue and advisors (page side, read-only or ScapeLite-only)

| Syntax | What it does | Where | Kind | Effort |
| --- | --- | --- | --- | --- |
| `/sl queue cache clear` | Drops ScapeLite's own cached queue/route-preview data and re-renders the queue panel. Implementation note: use the page-side hook that already exists as `__ccBridge.refreshQueuePanel` only to *redraw ScapeLite's panel*; do **not** touch the game's queue. If the panel keeps no cache of its own, the command reduces to a redraw. Needs a small read of `ui-queue.js` first (caches are `dropCache` in `game-bridge.js` line ~123 and panel state) | `ui-queue.js`, `game-bridge.js` | ctl | M |
| `/sl advisor status` | Which advisors are enabled (tree, lever, route, goals) and their last compute time | each advisor's `window.__cc*` namespace | read | S |
| `/sl advisor recompute <tree|lever|route>` | Force an advisor to recompute its model from the current snapshot and redraw. Output only appears in ScapeLite panels | advisor modules | ctl | M |
| `/sl bridge` | `__ccBridge.ok()`, attach time and the `STATUS.bridge` ms/error; helps diagnose "advisor shows nothing" | `game-bridge.js`, `STATUS.bridge` | read | S |
| `/sl alerts list` / `/sl alerts reset` | Alert bell: list active alerts; reset (`alertsReset` setting button) | `alert-bell.js` | read / ctl | S |
| `/sl goals` | Print the goals ScapeLite tracks and progress (read-only view) | `goals.js` | read | S |

Explicitly **not** offered (display-only policy): queueing, inserting, rerolling, claiming, equipping, walking, choosing channels in-game (`setChatChannel`), accepting chat rules, or anything that calls `__ccBridge.queueInsert` / `queueCtl`.

### 3.4 Debug and logging

| Syntax | What it does | Where | Kind | Effort |
| --- | --- | --- | --- | --- |
| `/sl log tail [channel] [n]` | Last n log lines of a channel (`System`, `Discord`, `Watcher`, `Errors`, ...; from `logstore` reader, same as `/api/logs/tail`) shown as local lines (cap 20 lines, 200 chars each) | `logstore.js` via watcher | read | S |
| `/sl log level <off|error|info|debug>` | `logsLevel` setting | `plugins-settings-ui.js` | ctl | S |
| `/sl log open` | Opens the Logs folder (same as the settings button; the dashboard route is `/api/logs/open`) | watcher | ctl | S |
| `/sl errors` | Last 5 entries from `STATUS.recentLog` categorised `error` | `categorize()` | read | S |
| `/sl perf` | Latest `STATUS.perf` sample: top plugins by time | `perfBurst` / `STATUS.perf` | read | S |
| `/sl report` | Opens the in-game bug-report dialog (`bug-report.js`; it already redacts) | `bug-report.js` | ctl | S |
| `/sl chatdebug` | Reports chat-plus state: messages kept, game list attached, send channel, whether the game box capture guard is installed. For debugging this feature itself | `chat-commands.js` | read | S |
| `/sl echo <text>` | Replies with the text locally. Exists for testing the pipeline and for people to learn that replies never go out; hidden from help | registry | read | S |

### 3.5 Watchdog and service

| Syntax | What it does | Where | Kind | Effort |
| --- | --- | --- | --- | --- |
| `/sl watchdog` | Heartbeat age, `loopAt`, lock verdicts, last problem and retry streak as in `docs/WATCHDOG.md` (heartbeat file `watcher-heartbeat.local.json`) | `watchdog.js` | read | M |
| `/sl service status` | Supervisor state (managed or standalone, pid, uptime, restarts, last exit) | `STATUS.supervisor` / `supervisor.js` | read | S |
| `/sl watcher restart` | Restart the watcher (supervisor `restart`; the same call `handleReloadRequest` makes). Re-injects everything; the command reply is lost in the restart, so the registry prints "Restarting, reply will not come back" | `POST /api/watcher/restart` | ctl | S |
| `/sl service restart --yes` | The dashboard's "Restart ScapeLite service". Higher blast radius (dashboard and tray helper gone for several seconds), so it requires `--yes` | `/api/service/restart` | ctl | S |

`service stop` is **not** offered in chat: stopping the service from the chat box would silence the relay with no way to bring it back from the same chat. Use the dashboard or tray.

### 3.6 Autocomplete and help format (sketch)

Autocomplete, in the ScapeLite chat box only (the game's box has no UI we may draw into):
* Typing `/` shows nothing special (the game or server may own other `/` words). Typing `/sl ` (or `/sl` + Tab) opens a small popup above the box (reuse `UI.menu`, as `openChMenu` does) listing groups; each further word narrows it: `/sl bo` shows `board`, `/sl board ` shows `status | preview | repost | refresh`.
* Tab completes the common prefix or cycles candidates; Up/Down moves in the popup; Esc closes. **Careful:** in chat-plus, Tab currently cycles the send channel (line 451); completion only takes Tab while the line starts with `/sl `, otherwise the old behaviour is untouched.
* Arguments with finite values complete too: plugin ids (from `STATUS.plugins`), setting keys (from `SCHEMA`), Discord features, log channels, `on|off`.
* Up/Down history is shared with normal chat history but commands are remembered separately (`hist`).
* The game's box gets no popup; typing the full command works, and a typo gets the local "Unknown command ... Did you mean" reply.

`/sl help` output (local lines, accent colour, no wrap issues at 200 chars):

```
SL  ScapeLite 0.4.x commands   (only you see these lines; nothing is sent to chat)
SL  core      help  version  status  refresh  plugins  plugin  settings  look  update
SL  discord   relay  digest  hiscores  board  raid  discord
SL  queue     queue  advisor  bridge  alerts  goals
SL  debug     log  errors  perf  report
SL  service   watchdog  service  watcher
SL  Type /sl help <group or command> for details. Commands marked [post] ask for --yes.
```

```
/sl help board
SL  /sl board status            read    card state and last send
SL  /sl board preview           read    what the card would show now
SL  /sl board repost --yes      [post]  delete-and-recreate the card (60 s minimum gap, lease respected)
SL  /sl board refresh           [post]  force an edit of the existing card
```

A `[post]` command without `--yes` prints the preview plus `Type the same command with --yes to post.` rather than posting. Replies from the watcher say what was skipped and why (`standby: another ScapeLite posts this channel`).

---

## 4. Recommended MVP and order of work

### 4.1 MVP: 8 commands

| # | Command | Why it earns its place | Effort |
| --- | --- | --- | --- |
| 1 | `/sl help` | Needed for anything else; also the pipeline test | S |
| 2 | `/sl version` | First thing asked in any bug report; trivial | S |
| 3 | `/sl status` | One line answer to "is the relay alive": uses `STATUS` verbatim | S |
| 4 | `/sl refresh` | The user's headline example; reuses `__ccReloadRequest` | S |
| 5 | `/sl plugin <id> on|off` (+ `/sl plugins`) | Debugging by bisection; reuses `setPluginEnabled` | S |
| 6 | `/sl relay status` | Lease/outbox/health without opening the dashboard | S |
| 7 | `/sl digest preview` | Safe way to see the digest; needs only a pure function | S |
| 8 | `/sl hiscores check` | "Fetch the guild rank now" without posting; needs the small `post:false` option | M |

Deliberately **not** in the MVP: every `POST` command (`digest post`, `board repost`, `hiscores post`, `raid retry`, `discord test`), `settings set`, `service restart`. They are the valuable-but-risky half and wait until the mailbox and the confirm UX have been used for a while. `board repost` is the first one to add afterwards because it is what a developer actually wants during Discord work and `forget()` already exists.

### 4.2 Order of work

1. **Registry + chat-plus hook** (`chat-commands.js`, one `if` in chat-plus, `__ccChat.local(...)`, local-line style, never persisted). Ship `help`, `version`, `echo`. Verifies parsing, local replies and that nothing reaches the game. *Test:* a stub `gi` input whose `send` would increment a counter; assert it stays 0 for `/sl ...`, and increments for `/help`.
2. **Game-input capture guard** with `__ccLife` scope. *Test (live, read-only observation only):* attach to the page, dispatch a synthetic Enter on a **detached copy** of the input rather than the real one; never type in the live game. Prefer a unit test with jsdom-like harness around the matcher (`CMD.match`) since the listener is 10 lines.
3. **Watcher mailbox** `handleCommandRequests` + static allowlist + reply path. Ship `status`, `relay status`, `plugins`, `plugin`, `refresh`. *Test:* extend `scripts/test-relay.js` style harness: feed fake mailbox records (unknown name, bad args, 100 records, huge string) and assert only allowlisted names run and the rest are rejected with an error record.
4. **Refactors in 2.3** (`hiscores post:false`, `digestPreview`), then `digest preview`, `hiscores check`, `board status/preview`.
5. **Autocomplete popup** and near-miss guard.
6. **POST commands** (`board repost`, `digest post`, `hiscores post`, `raid retry`, `discord test`) with `--yes`, per-command gaps, watcher-side hourly cap, and log lines (`Logs/Discord`) saying "triggered manually from chat".
7. **Phase 3**: command palette (hotkey popup), `settings get/set`, `queue cache clear`, advisor recompute, `watchdog`.

---

## 5. Risks

1. **Public leak when ScapeLite is not running.** `/sl board repost` typed with no injection is a public chat line. Harmless text, but visible; and the whole point of safety is "no surprise". Mitigation: status dot, first-run note, `/sl` text is never anything secret; no command takes a secret as an argument.
2. **Near-miss typos** (`/s1 ...`). Covered by the near-miss hold (own prefix only), at the cost of one extra Enter on those rare lines. The exact-prefix rule is what keeps real game/server commands untouched.
3. **Unknown server behaviour for `/word`.** Cannot be tested without sending. Staying on a single private prefix is the mitigation; do not add aliases like `/help` or `/status`.
4. **Double handling after re-inject.** Two capture listeners would run every command twice (for `POST` commands: two posts). Must use `__ccLife.scope` (disposes on re-inject) plus an idempotency check on the command id in the watcher mailbox (ignore an id already handled).
5. **Accidental outbound spam from a debug command.** Handled by `--yes`, preview first, existing `relayGate`, per-command 60 s gap, 5/hour cap, and logging every manual trigger. A manual post must still lose to `standby`/`unsure`.
6. **Anyone on the page can write the mailbox** (same as today's reload/update flags). Keep the watcher list static and non-destructive; no secrets in or out; no file paths; args validated. Do not add a binding or HTTP route that makes it more reachable.
7. **Reply loss on restarts.** `refresh`, `watcher restart` and `service restart` kill the reply path. Say so in the immediate local line and add `/sl version` after as the "did it come back" check.
8. **Persisting local lines.** If a local line is stored in `cc-chat-log:v1` it comes back after reload as a fake game line. Flag and filter.
9. **Display-only creep.** The command table is a growth point for "just one little `/sl queue add`". Keep the unit test that rejects any bridge write method in the registry; roadmap items for such commands should be `wontdo`.
10. **chat-plus is optional.** People who hide it get commands only via the game-box capture guard (no autocomplete, replies as toasts). Fine for the MVP; the palette in phase 3 fixes it.

---

## 6. Open questions for the owner

* Prefix: `/sl` plus `/scapelite`, or only one? (Recommendation: both, `/sl` documented.)
* Should the near-miss hold (extra Enter) be default on? (Recommendation: yes, it only touches mistyped prefixes.)
* Should replies also be mirrored to the dashboard log (`Logs/System`) so a "what did I run" history exists? (Recommendation: yes for watcher-side commands, one log line each.)
* Is a 3 s command latency acceptable, or is `Runtime.addBinding` worth the new CDP surface for the first release?
