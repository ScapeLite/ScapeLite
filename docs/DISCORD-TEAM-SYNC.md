# Team settings: set up once, everyone gathers it

When several clanmates run ScapeLite, each of them would have to type the same ping roles, hiscores rules, digest times and raid rules. **Team settings** lets one person set it up and everyone else take it over with one click.

It travels through the **shared lease webhook** you already use to stop duplicate posts (see [DISCORD-RELAY-SETUP.md](DISCORD-RELAY-SETUP.md), page 5). Nothing new is needed on Discord: a few extra messages sit next to the lease message in the same private channel.

Where: **Settings, Plugins, Chat Relay, Team Settings, Open**, or the Discord setup wizard, page **6. Team settings**.

## What travels, and what never does

| Travels | Never travels |
| --- | --- |
| Ping roles (name, role ID, which events) and ultra rare keywords | Webhook addresses (unless you choose it, see below) |
| Which relay features are on (clan, global, plain chat) | The shared lease webhook itself |
| Clan hiscores: on/off, poll interval, post interval, major rank change, clan tag, member list | "Several ScapeLite users" mode (Automatic / Own events only / ...) |
| Activity digest: on/off, interval, extra post times | Your looks, hotkeys, panel layouts, anything about your own character |
| Raid summaries: on/off and every rule (party size, guild members, wave, dungeons, raids) | Anything that is yours alone (the clan status board "I post a card" switch stays your choice) |
| Clan status board: update interval and which fields the card shows | |

The list is fixed in `overlay/team-sync.js` (`KEYS`). A published block that names anything else is refused when it is read.

## Publish (the person who set it up)

1. Open page 6. **Publish my settings to the team** has a **Preview** button: it lists every setting that would go, with its value, the version number and how many messages it needs.
2. Press **Publish version N**. ScapeLite writes the settings into a few messages on the lease webhook (compressed, with a checksum) and points the lease at them.
3. Publishing again edits the same messages and raises the version. Parts that are no longer needed are deleted.

Anyone who holds the lease webhook can publish. There is no owner: the last publish wins, and "Published by ... at ..." shows who it was.

## Gather (everyone else)

1. Page 6, **Gather**. It shows *Published by Member A, version 4* and a table: your value, the team's value, and which differ.
2. Tick what you want. **Apply selected** or **Apply all that differ**.
3. Something wrong? **Undo last change** puts the old values back.
4. Optional: **Keep in sync automatically** (off by default). When the team publishes a newer version, ScapeLite applies it for you within about a minute and writes a line to the log (*Team settings: version 5 from Member A was applied automatically*). Automatic sync never takes webhook addresses and can always be undone.

Nothing is applied without a click, except in the automatic mode you switched on yourself.

## Export and import (no lease webhook needed)

For someone who is not on your lease webhook, or to keep a copy: **Export** makes one block of text starting with `SLT1.`. **Import** reads one. You can also save it as a file and load it again. An import shows the same table and applies only what you tick. Importing does not change the team version number.

## Webhook addresses (secrets)

By default **no webhook address is ever included**, in Publish, Export or the automatic sync. They are secrets: whoever has one can post into that channel.

If you tick **Include webhook addresses** (Publish or Export) you must also tick *I understand*:

- **Publish with addresses:** the addresses are stored in the private lease channel. **Everyone who has the lease webhook can read them.** If the lease webhook leaks, so do all of those channels. Do this only if you trust everyone who has the lease webhook.
- **Export with addresses:** the text contains the addresses. Send it only in a private message.
- **Gather / Import:** a block with addresses shows only *set / not set*, never the address. They are taken only if you tick *Also take the webhook addresses* and apply them yourself. The lease webhook is never part of a block.

Applied addresses are saved the same way as ones you paste in the wizard. They never show again afterwards, and they never appear in the log.

## How it is stored (for the curious)

- The lease message gets one extra field, `ts`: `{ver, ids, sum, by, at, u}`. Copies of ScapeLite that do not know about team settings keep unknown fields when they rewrite the lease, so they do not break it.
- Each part is a message `-# ScapeLite team settings · part 1/2 · v4 · do not edit or delete` followed by a chunk of text in `||spoiler||` bars, under 1,900 characters. At most 8 parts. Every part is checked against a checksum; a damaged or half-written block is reported and nothing is applied.
- The text is JSON, compressed (deflate), base64. Reading refuses anything larger than 64 KB uncompressed.
- Names are cleaned: `@everyone`, `@here`, mentions, markup and control characters are removed. Role IDs must be 17 to 20 digits. Numbers are clamped to sensible ranges.
- The copy kept for **Undo** and the last version number live in `State/team-sync-state.json`, which is never packaged and never shared.

## Troubleshooting

- **"No shared lease webhook is saved yet."** Page 5 first. Export and Import still work.
- **"The lease message could not be read right now."** Discord did not answer, or the lease webhook is wrong. Try again in a minute.
- **"A part of the team settings was deleted from the channel."** Someone deleted a message in the private channel. Ask the publisher to publish again.
- **"The lease was rewritten at the same moment."** A heartbeat overwrote the pointer. Press Publish again.
- **Gather shows nothing different but you expected changes.** Rows the team does not mention are not compared. The table lists only what the published block contains.
- **Two people published.** The newest version wins. Look at *Published by* before you apply.
