# Clan Status Board

One live card per clan member in a Discord channel: what they are doing right now, level-ups from the last 24 hours, total level and more. It uses a plain Discord **webhook** only (no bot): every member's ScapeLite creates one message under their in-game name and then edits that same message. It is display only: ScapeLite reads your own state and never acts in the game.

```
Wulf
🌿 Forage: Fur at Pinewrap
▓▓▓▓░░░░░░ 34/120 · done in 12 minutes
Total level            Level-ups (last 24 h)
1,234                  🐟 Fish 49 → 51 (2 hours ago)
```

Every card has the ScapeLite logo in its header, the player's in-game name as the card's author, and the icon of the current task's skill as a small picture on the right (from the game's own icon files; none while idle or offline). The message itself is posted under the name **ScapeLite**.

The card is green while you play, amber when you are idle ("Idle since 5 minutes ago"), grey when the game is closed ("Offline, last seen 20 minutes ago"). The times on the card are Discord's own relative timestamps, so they keep counting between edits.

## What it is not

* Not a bot: it cannot answer commands or show buttons (a bot is parked as an idea, roadmap `feat-085`).
* Not a chat relay or digest: those are separate Discord features with their own webhooks.
* Nothing is sent until you switch it on, and only the fields you tick are sent.

## Several members, several webhooks

The board needs nothing special for many members: every member's card is its own message, edited only by its owner, so five ScapeLite instances never duplicate each other here. The **chat relay, activity digest, clan rank post and raid summaries** are different: they post the same clan-wide content from every member's PC, so with several ScapeLite users they use a leader lease to post once per channel. The lease lives on an optional private *Shared Lease Webhook* (a webhook in a leaders-only channel that every user pastes in Plugins > Chat Relay) and writes nothing to the relay channels; with none set a PC just posts what it sees, and *Own events only* is the no-setup alternative (setting *Several ScapeLite Users On This Channel*). See `docs/DISCORD-RELAY-AUDIT.md` section 8.

## Several members: who makes whose card

**Your own card is always made by your own ScapeLite**, with everything you ticked (task, progress, level-ups ...). That is all that happens unless you switch on the next setting.

Clanmates who do **not** run ScapeLite can still be on the board. Switch on *Settings > Plugins > Clan Status Board > Also Show Clanmates Without ScapeLite*. Then **one PC, the host,** keeps a simple card for each of them:

* **What the card says:** online or offline, when the host last saw them online, and (if the clan hiscores feature is on) total level and hiscores rank. Nothing else: no task, no progress, no level-ups, because the host cannot see those. The footer says *Seen by <host> - no ScapeLite card*.
* **Who the host is:** the PC that leads the shared lease (the optional *Shared Lease Webhook*, see `docs/DISCORD-RELAY-SETUP.md`). It changes by itself when the host goes offline; the new host edits the same cards (their message ids are kept on the lease), it does not make a second set. Without a lease webhook, the PC that has the switch on is the host, so switch it on on **one** PC only.
* **Who is covered automatically:** every ScapeLite that keeps its own card writes one small marker on the lease ("this player has a card"). The host makes no card for them and removes the one it made earlier, so the moment a clanmate starts using ScapeLite, their own live card takes over. Because of this, **everyone who uses the board should also paste the lease webhook** (the leader hands it out with the board webhook). Without it the host cannot see that they have a card and would make a second one.
* **Per clanmate:** *Clanmates On The Board* lists every clanmate with a tick, a search box and *All* / *None*. Untick someone and their card goes away. New clanmates start ticked. Clanmates you switched off who left the clan are remembered, so they stay off if they come back; *Forget* removes them.
* **Nothing by surprise:** the switch is off by default, nothing is posted until you switch it on, and switching it off deletes the cards this PC made. A host also waits two minutes after starting before it makes cards, so the others have time to announce themselves.
* **How often:** cards are made one at a time, a card changes at most every 5 minutes (a minute after someone goes online or offline), and an unchanged card is never edited. A clan has room for five members today.
* **Secrets:** the board webhook is stored only on the PCs that have it. The lease holds hashes of names and message ids, no webhook URL.

Example with three ScapeLite users (A, B, C) and two clanmates without it (D, E): A, B and C each keep their own live card. If A is the host, A also keeps simple cards for D and E. When A closes the game and the lease moves to B, B edits the same D and E cards.
## Setup for the clan leader (once)

1. Make a channel for the board, for example `#clan-board`. Let members **read** it but not write in it, so the cards are the only messages.
2. Open the channel: **Edit Channel → Integrations → Webhooks → New Webhook**. Name it, then **Copy Webhook URL**. (It looks like `https://discord.com/api/webhooks/ID/TOKEN`.)
3. Set the webhook's picture once: in the same webhook settings click the avatar and upload `branding/png/logo-256.png` (it is in the ScapeLite folder). Discord uses that picture next to the message name **ScapeLite**; ScapeLite sets the name itself, but only you can set the avatar.
4. Give that URL to the members you want on the board (a private message, not a public channel). Five or fifty members work the same way: every member's card is its own message in the channel.
5. Nothing to pin: each card is its own message. If a card is deleted (by anyone), its owner's ScapeLite posts a new one at the bottom of the channel within about a minute.

### The shared webhook: read this

Discord ties a message to the **webhook that created it**, not to the person. All members post through the same URL, so **everyone who holds the URL could, in principle, edit or delete any card made through it**, and could post other messages in the channel. ScapeLite itself behaves: it stores the id of **its own** message on your PC and only ever edits that one. But the URL is a shared key.

So: the clan leader decides who gets the URL. Hand it only to members you trust. If it leaks, delete the webhook in Discord (all cards stop working) and make a new one; members paste the new URL and their cards are created again. If you need members who cannot touch each other's cards at all, that needs one webhook per member (each made by a leader with Manage Webhooks) or a bot.

## Setup for each member

1. In the game open **Settings → Plugins → Clan Status Board** (or the marketplace entry *Clan Status Board (Discord)*, which has a **Setup Guide** button).
2. Paste the URL your leader gave you into **Board Webhook URL**. It is stored only on your PC, in `overlay/clan-board-config.json` (never in the browser, never in logs or the dashboard).
3. Tick the fields you are happy to show. The **Preview** below them is the card as it would be posted right now (level-ups, "Online since" and "Today" show sample values in the preview).
4. Switch on **Show My Card On The Clan Board**. Within about a minute the card appears.
5. **Refresh Every (minutes)**: 1 to 5, default 2.

The display name on the card is your **in-game name** (as the game shows it to other players). The webhook's message name is set when the card is created and cannot be changed afterwards by Discord; if you rename your character, delete the old card in Discord and ScapeLite makes a new one. The name on the card itself (inside it) updates.

To leave the board: switch the card off in Settings and delete your card in Discord (right-click the message; a moderator can do it too). ScapeLite itself only creates and edits. A leader can clear the whole board by deleting the messages in the channel.

## Fields

| Field (Plugins tab) | Shown as | Default |
|---|---|---|
| What I am doing | skill, task or fight | on |
| Where I am | "at Pinewrap" after the task | on |
| Progress and time left | bar, done/total, "done in 12 minutes" | on |
| Level-ups (24 hours) | "Fish 49 → 50 (2 hours ago)", runs of the same skill folded | on |
| Total level | sum of your skill levels | on |
| XP per hour | on the current task | off |
| Hit points | current / maximum | off |
| Slayer task | mob and kills | off |
| Fortress run | wave and party size while in a run | off |
| Online since | since when you have been online | off |
| Today | XP and tasks since midnight (from when ScapeLite first saw you that day) | off |

Never sent: your login or account id, gold, bank or item values, chat, other players, file paths, the webhook URL.

## How it behaves

* **Create once, then edit.** The first time, ScapeLite posts the card (`POST ...?wait=true`) and keeps the message id in `overlay/clan-board-state.json` next to a short hash of the URL (not the URL). Every later change is a `PATCH` of that message.
* **Calm.** An edit is sent only when the card's content really changed and the refresh interval has passed (default 2 minutes). A change of state (online, idle, offline) may go out after 30 seconds. A task finishing is not edited instantly: a minute-scale refresh is the design. An hour of constantly changing progress is about 30 edits at the default.
* **No flapping.** The finish time moves only when the estimate changes by more than a minute or 10 %.
* **Level-ups** are found by comparing your skill levels between snapshots and against the levels remembered from the last run, and are kept for 24 hours in the state file, so they survive a restart. A level-up that happened while ScapeLite was not running shows up (timed when it was noticed).
* **Offline.** When the game closes, after about 90 seconds the card turns grey with "last seen". When ScapeLite is stopped from the dashboard it makes one last "offline" edit first. If the PC crashes or loses power there is no last edit: the card keeps looking online, but the footer time shows when it was last updated.
* **A deleted card** is recreated, at most once every 30 seconds. **A dead webhook** (deleted in Discord, wrong URL: 401/403/404) is marked broken: ScapeLite stops sending, shows the reason on the dashboard, and tries again only every 15 minutes or when you press **Test send**.
* **Logo and icons.** The logo is attached to the card every time it is created or edited (verified live: one copy, the header icon keeps working however many edits follow). The task icon is `https://play.scapewatch.com/assets/icons/skills/<skill>.png`, the game's own file for the skill (fights show the Slayer icon); if the game ever moves them the picture is simply missing.
* **Many members at once.** Each member's ScapeLite has its own queue and obeys Discord's rate limit headers; if several edit in the same second Discord may answer "wait" and the shared sender waits that long and retries. In a live test with five simulated cards on one webhook (all five due in the same second) every edit went through in order with no rate-limit answer.
* **Never blocks.** Talking to Discord happens in its own queue (the shared sender, `overlay/discord-sender.js`: rate limits, timeouts, retries). The game and the rest of ScapeLite never wait for it.
* **No mentions.** The card cannot ping anyone (`allowed_mentions` none, and names are escaped).

## Troubleshooting

* **Dashboard → "Clan status board" card and "Discord health" card** show the state, the last error and a **Test send** button (sends one harmless "ScapeLite test message" to the board channel, only when you press it). The dashboard needs one supervisor restart after an update to show them.
* *Nothing appears:* is the switch on, is the URL pasted (Settings shows it only under the eye button), is the game connected (dashboard "Connection")? The Preview should show your live task; if it says "sample", the game bridge is not attached yet (wait a minute after login).
* *"BROKEN: the webhook does not exist any more (404)":* the webhook was deleted or the URL has a typo. Ask the leader for a fresh URL.
* *"403":* the webhook may not post in that channel (permissions changed).
* *The card shows the wrong name:* see the rename note above.
* *Two cards for me:* the old one was left behind after a URL change or a deleted message; delete it in Discord.
* *Card turned grey for a minute after I used Reload ScapeLite:* the watcher restarts, which is a graceful stop (one offline edit) followed by a start.
* Log lines start with `Clan board:` (Logs → Discord channel and the dashboard's Discord log, tag *Board*).

## For developers

* `overlay/clan-board-card.js`: the pure card builder, shared by the watcher and the settings preview.
* `overlay/clan-board-collect.js`: the page plugin `clan-board`, builds the snapshot (`window.__ccClanBoard.snapshot()`); idle unless the board is switched on.
* `overlay/clan-board-sync.js`: the watcher side (cadence, level-up log, create/edit/recreate, offline). Settings keys `clanBoard*` come from the Plugins tab; the webhook from `clan-board-config.json` (`overlay/clan-board-config.example.json`).
* Tests: `npm run test:board` (card builder, collector with a stub bridge, cadence against a fake local webhook server) and `npm run test:discord` (the sender). Neither can reach real Discord.

Checked live on a private test channel (2026-10-22): create with `?wait=true` and edit with PATCH work; `<t:..:R>` counts down by itself; the "(edited)" mark shows (cosmetic); the skill icon from the game's asset host renders as the thumbnail; the logo sent as `attachment://logo.png` in the first multipart request shows in the header. For edits the logo is sent again as multipart with `attachments: [{"id": 0}]`: a plain JSON edit also kept the icon, but re-sending is independent of how long Discord keeps an old upload, and a multipart edit without the `attachments` list would pile up copies. Five simulated cards on one webhook were created, edited four times each (all five due in the same second), one was deleted by hand and recreated: no rate-limit answers, requests left one at a time in order (about half a second each with the logo), the logo and thumbnails rendered. The sender reads the edit limits from the response headers at runtime.
