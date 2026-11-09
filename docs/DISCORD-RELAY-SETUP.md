# Discord setup: channels, webhooks, roles

This is the long version of the **Discord setup wizard** (Settings, Plugins, Chat Relay, **Open wizard**; or the ScapeLite menu entry). Everything in it is optional. You can start with one channel and add the others later.

## What you get

ScapeLite can post to your Discord server what happens in your clan, in a few separate channels:

| Feature | What it posts | Needed? | Suggested channel |
| --- | --- | --- | --- |
| Clan feed | Rare drops, pets, unlocks, level-ups and quest completions of you and your clanmates. Optionally also what people type in clan chat. | **Start here** | `#clan-feed` |
| Global milestones | The cape and pet announcements that Global chat shows. Needs no clan. | Optional | `#global-milestones` |
| Activity digest | A short summary every few hours: notable drops, levels gained, quests finished. | Optional | `#clan-digest` |
| Clan hiscores | Your clan's overall hiscores rank, when it changes. | Optional | `#clan-rank` |
| Raid summaries | One summary after a raid, when enough clanmates took part. | Optional | `#raid-summaries` |
| Clan status board | One live card for you on the clan's status board (edited in place, not reposted). | Optional | the board channel your clan leader gives you |
| Shared lease channel | A private marker channel that lets several ScapeLite copies agree who posts. | Only for several PCs or users | `#scapelite-private` (staff only) |

Each feature posts to its **own webhook**, so each can go to its own channel. Two features can share a channel if you paste the same webhook in both, but separate channels are easier to mute and to read.

```
  the game's chat ──► ScapeLite (on your PC) ──► one webhook per feature ──► one Discord channel each
                                      │
                                      └── nothing leaves your PC except what you set up here
```

## Before you start

You need a Discord server where you may create webhooks (the **Manage Webhooks** permission, or an admin who makes the webhook and sends it to you privately). A webhook is a private web address: **whoever has it can post into that channel**. Treat it like a password.

ScapeLite stores a webhook only in its private folder on your PC (`%APPDATA%\ScapeLite`), never in the installer, and after you save it the wizard never shows it again: you can only replace or remove it.

## Step by step

### 1. Make a channel and a webhook (once per feature)

1. In Discord, create a text channel, for example `#clan-feed`.
2. Open the channel's settings (the cog next to its name).
3. **Integrations**, then **Webhooks**, then **New Webhook**.
4. Give it a name (Discord shows this name as the poster) and make sure the right channel is selected.
5. Press **Copy Webhook URL**.

### 2. Paste it into ScapeLite and test it

1. In the game open Settings, Plugins, **Chat Relay**, and press **Open wizard**.
2. Go to **2. Channels and webhooks**.
3. Paste the address into the field of that feature. The wizard tells you at once if it does not look like a webhook (for example if a part is missing). Press **Save**.
4. Press **Test this channel**. ScapeLite sends **one** message that says it is a test; check that it arrived in the right channel. The button never sends anything else, and it can be used once every 10 seconds per channel.
5. Switch the feature on or off with the switch under it. For the clan feed you can also choose whether ordinary clan chat is posted too.

Each channel shows one of these states:

| State | Meaning |
| --- | --- |
| Not set up | No webhook saved. |
| Saved. Press Test to check it. | The address is saved but nothing has been posted yet. |
| Works | A test message or a real post reached Discord. |
| Test failed / Discord refused the last post | Discord answered with an error. The wizard shows the reason (see Troubleshooting). |

### 3. Roles and pings (optional)

A ping makes Discord notify the members of a role when something rare happens. The clan feed can ping a different role per kind of event (rare drops, ultra rares, pets, shiny pets, unlocks, level-ups, quests).

1. In Discord, turn on **Developer Mode**: User Settings, Advanced.
2. Server Settings, **Roles**, open the role (or create one), then Display: tick **Allow anyone to @mention this role**. Without it Discord can refuse the ping.
3. Right-click the role and choose **Copy Role ID**.
4. In the game: Settings, Plugins, Notifications and Discord, **Chat Relay Pings**, **Ping Roles**. Paste the ID and tick the events that role should be pinged for. You can add several roles.

| Role | Needed? | Used for |
| --- | --- | --- |
| Any role you want pinged | No | Ping roles: members opt in by having the role. |
| A staff role | No | Can see the private shared lease channel. |
| `@everyone` / `@here` | Never | ScapeLite never pings these. |

### 4. In the game

There is nothing to change in the game's chat. ScapeLite reads the chat in the background, **including the lines your own chat window hides**: a channel you greyed out (for example Global) or a type of message you filtered away does not stop the relay.

Good to know:

- Clan events only arrive while you are in a clan. Global milestones need no clan.
- Only **new** events are posted. Lines that were already in the chat when ScapeLite started are history.
- ScapeLite has to be running with the game open.
- Your own drops, unlocks and level-ups come from your personal feed and are posted in the clan feed next to everyone else's.

### 5. Several PCs or several clanmates on one channel

If you play on two PCs, or several clanmates run ScapeLite and use the same channel, every copy would post the same events. ScapeLite lets one copy at a time post:

- Settings, Plugins, Chat Relay, **Several ScapeLite Users**: **Automatic** (default) lets one copy post, **Own events only** posts just what happens to your own character (nothing to set up, but clanmates without ScapeLite are not covered), **Always post** is for the only user, **Never post** keeps this PC silent.
- Auto works best with a **shared lease channel**: a private channel that only the people who run ScapeLite can see. The copies leave a small marker there to agree who posts. Create a webhook for it and paste it on page 5 of the wizard.
- The lease message shows who leads and when it was last written, in your own time zone. The log (Logs/Watcher, or watcher.log) gets a line each time the leader changes, for example "the leader changed from Wulf to Sandis". If the name looks wrong, it is the in-game name as the game shows it; it is re-read every 30 seconds.
- Two PCs of your own: use Auto, or set the second one to Never.
- Everyone in the clan needs the same ping roles, hiscores rules and digest times? Set them up once and share them: [DISCORD-TEAM-SYNC.md](DISCORD-TEAM-SYNC.md) (wizard page 6, Team settings).

Never put the same *posting* webhook in two copies set to **Always**: each event would appear twice.

## Troubleshooting

**Nothing posts at all.**
Check in this order: (1) the game is running and ScapeLite shows as connected (the status light at the bottom left); (2) the feature has a webhook and its switch is on (wizard page 2); (3) press **Test this channel**: if the test arrives, the webhook is fine and the cause is the event itself (for example you are not in a clan, or nothing has happened yet); (4) with several PCs, another copy may be the one that posts (see page 5).

**The test fails with 404 or "Unknown Webhook".**
The webhook was deleted in Discord. Make a new one and use **Replace or remove**.

**The test fails with 401 or 403.**
The address is incomplete or the token part was changed. Copy the whole Webhook URL again.

**The test arrives but real events do not.**
Only new events are posted, and each feature has its own switch. Clan events need a clan. Ordinary clan chat is only posted when "Also post what people type in clan chat" is on. If you hid a channel in the game's chat, events are still collected (in version 0.4.0 and earlier a hidden channel or message type was not seen).

**It posts twice.**
Two copies of ScapeLite post to the same webhook (two PCs, or a clanmate). Set one to **Auto** with a shared lease channel, or to **Never**.

**It posts to the wrong channel.**
A webhook belongs to one channel. Open the channel you expected, check its Integrations, Webhooks list, and replace the address in the wizard.

**A ping does not ping.**
The role must allow "@mention this role" (step 3), and the ID must be the *role* ID, not the server or channel ID.

**I leaked a webhook.**
Delete that webhook in Discord (Integrations, Webhooks) and make a new one. The old address stops working at once.

## What is stored where

| What | Where | Leaves your PC? |
| --- | --- | --- |
| Webhook addresses | `%APPDATA%\ScapeLite` (your private folder, not in the installer) | Only as the address Discord receives the post at |
| Which features are on | Plugins settings | No |
| What was already posted (to avoid duplicates) | `State` folder | No |
| The test message | Nothing is stored | One message, only when you press Test |
