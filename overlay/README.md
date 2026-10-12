# Scapewatch panel resize/scale mod

Display-only client modification. Per the developer's own stated policy
(Discord, relayed 2026-10-06): scripts that read or modify the client's
display without taking actions for the player are fine; this never clicks,
selects, or submits anything in the game. The resize grip swallows every
mouse/pointer event it receives, so a press on it can never reach a game
element underneath.

Files:

- `panel-resize.js` — the mod (v2). Inject into the live page.
- `panel-resize-teardown.js` — full undo, also cleans up any v1 leftovers.
  Safe to run at any time, even when nothing is loaded.

## What it does (v2)

Every **floating** panel (`.panel-floating` — Tasks, Skills, Current Task,
and any other panel you've dragged out by its titlebar) gets a small dark
grip tab straddling its bottom-right corner. Dragging it scales the whole
panel — content, tooltips and all — uniformly, from 50% up to 200% (capped
so the panel never grows past the right/bottom edge of the window). A
`NN%` readout shows while dragging. Double-click the grip to reset that
panel to 100%. Scales persist per panel in `localStorage`
(`cc-panel-scale-v2`, our own key) and are re-applied on the next injection.

Docked panels (Info and Chat in the current layout — they don't have the
`.panel-floating` class; the game only adds it once a panel has been
dragged by its titlebar) get no grip: they are CSS-anchored to screen
edges, so a top-left-anchored scale would pull them off their edge. Drag
one out by its titlebar (normal game feature) and it gets a grip. If a
floating panel is re-docked, its scale stops applying, and it comes back if
it's floated again (by design of the selector; not click-tested).

Console helpers: `__ccPanelScale.scales`, `__ccPanelScale.reset('tasks')`,
`__ccPanelScale.reset()` (all), `__ccPanelScale.teardown()`.

### How it works — the design rule

**v2 never touches the game's DOM.** It does not move, wrap, remove or edit
any node inside a panel, and does not set any attribute or inline style on
a panel either. It only adds:

1. One `<style id="cc-panel-scale-style">` in `<head>`. Scaling is a
   stylesheet rule keyed on the `data-panel-id` the game already puts on
   each panel's titlebar:

   ```css
   .panel-floating:has(> .panel-titlebar[data-panel-id="tasks"]) {
     scale: 0.716 !important; transform-origin: 0 0 !important;
   }
   ```

   - CSS `scale` property, not `transform`: it composes with any
     `transform` the game sets itself (the game's own CSS does use
     `transform` on some panels) instead of overriding it.
   - A selector instead of an element reference: if the game rebuilds,
     re-appends (`bringToFront` does `parentNode.appendChild(panel)`), or
     re-docks a panel, the rule just follows whatever currently matches.
   - The panel's layout box stays exactly what the game computes (the Tasks
     panel rewrites its own `width`/`height` on most queue updates); only
     the paint is scaled. So there is nothing to fight — no size enforcer,
     no MutationObserver — and content always fits the visual box exactly.
     If the game changes a panel's natural size, the visual size follows
     at the same scale.

2. Grip elements appended to `<body>` (`position: fixed`), never to a
   panel. A `requestAnimationFrame` loop *reads* each floating panel's
   `getBoundingClientRect()` (which includes the scale) and parks the grip
   on the panel's visual corner. Every 6 frames it also hit-tests just
   inside that corner (`elementsFromPoint`) and hides the grip if something
   else (another panel, a tooltip, a modal) is on top there. Grips are
   hidden for minimized/hidden panels.

### Edge-anchored scaling

The game's own drag-clamp (`_clampToView`) keeps a panel's *unscaled*
`offsetWidth/Height` box on-screen — it has no idea the panel is visually
scaled. With a fixed top-left `transform-origin` (the original v2 design),
shrinking a panel that's resting against the right/bottom edge pulled its
visible edges inward from that edge, leaving a gap of `(1 - scale) × size`,
because the origin was anchored to the wrong corner.

Fix: `updateOrigin(id, panel, scale)` recovers the panel's unscaled box from
its current visual `getBoundingClientRect()` (given whichever corner is
presently anchored) and checks which edge(s) it's within `EDGE_TOL` (10px)
of — right and/or bottom, vs. the default left/top. The per-panel CSS rule's
`transform-origin` is then set to that corner (`0 0` / `100% 0` / `0 100%` /
`100% 100%`), so scaling pulls inward from the edge the panel is actually
resting against. This is re-checked every `sync()` frame (so it tracks the
game's own titlebar drag live, not just our grip) and locked in at the start
of a grip drag (so a fresh resize doesn't anchor top-left for one frame
before snapping). The grip's max-growth cap (`sFit`) was also corner-aware:
it measures available room toward the *opposite* edge from whichever
corner(s) are anchored, instead of always assuming room is to the
right/below.

### Known tradeoffs (all cosmetic)

- **Aspect ratio is locked.** Scaling is uniform; the grip sets one scale
  factor (pointer delta projected onto the panel's diagonal). A
  free-aspect resize would require changing the panel's own layout box,
  which the game owns and rewrites constantly — that's the fight v1 had.
- **Game's drag clamp uses the unscaled size** (`_clampToView` reads
  `offsetWidth/offsetHeight`, which a CSS scale doesn't change) — fixed by
  dynamic transform-origin, see below; no longer a visible gap.
- **Stacking context.** A scaled element is its own stacking context, so a
  panel's in-panel tooltips (`.icon-tooltip` z-index 200,
  `.icon-container:hover` z-index 100000) could otherwise be drawn under a
  neighbouring panel with a higher z-index (Current Task is z 500). A
  `:has(:hover > .tooltip, :hover > .icon-tooltip)` rule raises the scaled
  panel to z-index 100000 only while one of its tooltips is showing. The
  game's body-level tooltips (`.global-tooltip`, used by Skills) are
  outside every panel and unaffected.
- **In-panel tooltips scale with the panel** (a 70% Tasks panel has 70%
  tooltips). Body-level tooltips (Skills) stay full size.
- The grip lives outside the game's UI zoom (`#ui-container` has
  `zoom: ~1.27`), so it is a constant 16 px regardless of panel scale.

## Usage

Nothing is written to any game file; re-inject after every reload/relaunch.

1. Launch Scapewatch (Steam) with launch options:
   `--remote-debugging-port=9222 --remote-allow-origins=*`
2. Inject (looks up the current page target itself — the id changes on
   every reload):

```bash
node -e "
const fs = require('fs');
const file = process.argv[1];
(async () => {
  const t = (await (await fetch('http://localhost:9222/json')).json()).find(t => t.type === 'page' && /scapewatch/i.test(t.url));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: fs.readFileSync(file, 'utf8'), returnByValue: true } })));
  ws.addEventListener('message', e => { console.log(JSON.parse(e.data).result?.result?.value ?? e.data); process.exit(0); });
})();
" overlay/panel-resize.js
```

Same command with `overlay/panel-resize-teardown.js` to remove everything
(it also clears the saved scales; set `window.__ccKeepScaleStorage = true`
first to keep them). Re-injecting `panel-resize.js` is safe: it tears down
the previous instance first (keeping saved scales).

## Chat -> Discord relay

Forwards chat to Discord webhooks so your guild can see what's happening
while away from the game: notable **Clan**-channel events (rare drops,
pets, unlocks, level-ups, new collections) as formatted embeds, ordinary
Clan chat banter as plain mirrored messages, and (optionally, off by
default) **Global**-channel events (cape/pet milestones -- the only things
the game itself ever broadcasts globally). Read-only, same policy as
everything else here: it only watches chat already rendered in the DOM and
never clicks, selects, or posts anything into the game.

Nothing else reads any other chat channel (Game/Proximity/Friends/All are
never inspected) -- only Clan and Global.

### Duplicate messages (fixed, 2026-10-06)

The game periodically rebuilds the chat panel's visible messages as brand
new DOM nodes from its own stored history -- confirmed live: switching
chat tabs away and back destroys every message's DOM element
(`isConnected` goes `false`) and recreates it, and the same thing also
happens on its own every ~75-90s with no user interaction. `MutationObserver`
has no way to tell a rebuilt node from a genuinely new message -- they're
both "a node just got added." Message *content* (including the in-game
`[HH:MM]` timestamp) survives the rebuild unchanged, so content is a valid
dedup key -- but the fix has to actually persist that key somewhere durable.

Two dedup layers, same key shape (`channel|timestamp|player|text`):
1. `chat-relay-collect.js`'s in-page `seen` Set -- cheap first filter,
   catches rebuilds within one script instance's lifetime, capped at 1000
   entries. Not durable: resets to empty on every re-injection.
2. `panel-resize-watcher.js`'s `relayedKeys` Set -- the authoritative
   layer, **persisted to `chat-relay-seen.json`** (gitignored, local
   runtime state) and reloaded on startup. This is the one that actually
   matters: an earlier in-memory-only version of this same Set looked
   correct in isolated testing but failed the first time it mattered,
   because restarting the watcher process (e.g. to deploy a fix) wipes an
   in-memory Set's memory of what a *previous* process already relayed --
   so the next rebuild (tab switch or the periodic one) looked like an
   entirely new batch of messages to the fresh process, and got relayed
   again in full. Lesson: a dedup cache that doesn't survive the process
   it's protecting isn't actually a fix for a bug that's triggered partly
   *by* that process restarting.

Verified live by reproducing the exact bug (switch to Game tab, back to
Clan) against the fixed watcher: 42 resurfaced messages all logged as
`skipped duplicate` and correctly never reached Discord, immediately
followed by a genuinely new message relaying normally.

### Files

- `chat-relay-collect.js` — page-side collector. Injected by the watcher
  alongside `panel-resize.js`. Watches `.chat-message-area` for new
  `.chat-message` nodes on the Clan/Global channels (the game keeps every
  channel's messages in the DOM at once and just filters the view per tab,
  so this works regardless of which chat tab you have open). Game-event
  lines (tagged by the game itself with a `data-category`) are parsed into
  a structured record; plain chat (no `data-category`) is queued as-is for
  an undecorated relay. Queued on `window.__ccChatRelay`. Only ever sees
  messages added *after* it loads -- never replays chat history.

  The category → event-kind mapping (`CATEGORY_KIND` in the file) is taken
  **verbatim from the game's own `CATEGORY_LABELS` object**, found by
  fetching and grepping the loaded bundle (`app/game.<hash>.js`) -- not
  guessed -- and cross-checked against real `data-category` attributes
  seen live. Clan and Global turned out to use two completely different,
  independent category vocabularies (the game's own `_clanFilters` /
  `_globalFilters` objects): Clan uses camelCase keys (`rareDrops`, `pets`,
  `shinyPets`, `allSkillsPet`, `shinyAllSkillsPet`, `unlocks`, `levels`,
  `collections`, plus several we deliberately don't relay — `deaths`,
  `questsCompleted`, `questSteps`, `tasks`, etc.); Global uses a much
  narrower, differently-cased set (`pet`, `shiny_pet`, `all_skills_pet`,
  `shiny_all_skills_pet`, `cape`, `trimmed_cape`, `max_cape`,
  `trimmed_max_cape`) -- the game only ever broadcasts cape/pet milestones
  globally, nothing else. Pets have their **own dedicated categories**,
  separate from generic rare drops, so pet detection is a reliable category
  match, not a text/keyword guess.
- `panel-resize-watcher.js` — polls the collector's queue every 5s
  (`Runtime.evaluate`) and posts each queued item to the matching Discord
  webhook. **No embeds** -- an embed's box/padding has a fixed minimum size
  in Discord no matter how little is in it, which made every message look
  oversized (this went through a few iterations based on live feedback: full
  embed with title/footer/timestamp → stripped-down embed → plain text).
  Instead, the player's name and icon ride on the webhook's own per-message
  identity override (`username`/`avatar_url`), and the message body is a
  single line of plain text prefixed with a category emoji (💎 rare drop,
  🐾 pet, ✨ shiny pet, 🔓 unlock; level-ups use a **skill-specific** emoji
  instead -- see `SKILL_EMOJI`, keyed by the game's own `data-skill-id`,
  read live from the real Skills panel rather than guessed).

  **Tier colors were tried and dropped.** A version wrapped tier-tagged
  item names (`[T1]`–`[T5]`, `[C6]`, `[D1]`, `[D2]`, `[L1]`, `[L2]`) in a
  one-line ` ```ansi ` code block with real ANSI color codes matching
  their in-game colors -- it worked (verified live), but once visible next
  to the plain single-line messages, the grey monospace code-box looked
  out of place and was reverted after seeing it live. Tier tags still show
  in the item name, just as plain `**bold**` text like everything else, no
  color. (If this gets revisited: Discord only renders ANSI code-block
  colors on desktop/web, never on mobile, and markdown bold doesn't work
  inside a code block -- both relevant if trying this again.)

  A secondary, text-based `ultraRareKeywords` check (currently just
  `"shiny"`) upgrades any *non-pet-category* drop whose item name matches
  to a "🌟 ULTRA RARE" treatment and the `shinyRareDrop` role ping -- a
  safety net for things like a Shiny Telescope/Lucky Tool, which the
  game's category system has no dedicated category for (confirmed: only
  pets get their own shiny category). Posts are spaced ~500ms apart to
  stay under Discord's rate limit.
- `chat-relay-config.json` (**you create this, gitignored, not included**)
  — your webhook URLs and role IDs. Treat it like a password file: never
  commit it, never paste its contents into chat or Discord. Re-read fresh
  every poll, so editing it (e.g. flipping `enabled`) takes effect live,
  no restart needed.

### Current setup (live)

Three webhooks, six roles, all wired into `chat-relay-config.json`
(gitignored, real values, not in this repo):

- `channels.clan.webhookUrl` — Clan Chat Discord channel.
- `channels.global.webhookUrl` — the "EN-W1" chat channel (`global` in
  code/game terms; currently `enabled: false`, flip it on when wanted).
- `roleSelectorWebhookUrl` — a separate channel, not part of the relay
  loop. Used once to post an instructional message pointing members at the
  server's native Channels & Roles self-assign screen (set up on the
  Discord side, not by me — no bot access). Not touched again unless asked.
- `roleMentions`: `rareDrop`, `pet`, `shinyPet`, `shinyRareDrop` (the
  keyword-fallback case — a non-pet "shiny" item, e.g. a Shiny Telescope,
  which has no dedicated game category), `unlock`, `levelUp` — six roles,
  matching the six-option onboarding question you set up in Discord
  one-for-one. The mention is appended at the end of the message wrapped
  in `||spoiler||` tags rather than leading the line -- Discord still
  fires the notification for a mention inside spoiler tags, only the
  visible text is hidden until clicked.
- `pingLevelUps: false`, `pingRareDrops: false`, `pingUnlocks: false` --
  all three silenced for now at your request, keeping only Pet, Shiny Pet,
  and the Shiny Rare Drop fallback actively pinging. Flip any back to
  `true` (or remove the key -- same default) to re-enable; takes effect on
  the watcher's next poll, no restart needed.
- `ultraRareKeywords: ["shiny", "lucky"]` (Shiny and Lucky tools/items count as ultra rare).

To add/change a role or webhook: Discord → Developer Mode on → right-click
→ Copy Role ID (or Copy Webhook URL), give it to me, I edit the config.
Nothing here needs code changes for a config-only tweak.

### Verification status (2026-10-06)

Classifier/payload logic verified first with throwaway test DOM nodes
injected into the live game (never real messages) plus Node-side unit
tests, across three design iterations (text-pattern matching →
category-based rewrite → current plain-text/ANSI format) -- confirmed
correct for every event kind, the Clan/Global category-vocabulary split, a
real bug catch (a player's hidden title-badge tooltip was leaking into
their name via naive `textContent` — fixed by reading `.chat-sender-name`
directly), and the tier-color/rainbow logic (`T1`–`T5`, `C6`, `D1`, `D2`,
`L1`, `L2`, plus correct no-color fallback for `T0` and non-tier brackets
like `[Lucky]`).

**Real Discord sends, done live** (with your explicit go-ahead each time,
to your actual Clan webhook, clearly marked as test data): one message per
event kind (rare drop, pet, shiny pet, shiny-rare-drop fallback, unlock,
level-up, plain chat) through all three design iterations as the format
was refined based on what you saw — full embed (too big) → stripped embed
(still too big) → plain text with webhook identity override (confirmed
good) → added tier-color ANSI blocks and skill emoji (latest). All sends
returned Discord's `204` success status.

**Still genuinely unverified:** the exact *text wording* the game uses for
a real pet/shiny/cape drop (the category detection is solid -- taken from
the game's own code -- but all pet/shiny/cape test messages so far used
synthetic text in the known rare-drop phrasing; if the real wording
differs, `TEXT_PATTERNS`' raw-text fallback means it still gets relayed,
just without parsed item/source fields). Will only be confirmed when one
actually happens — check `watcher.log` then.

### Your own events weren't relaying (fixed, 2026-10-06)

Your own rare drops/pets/unlocks/level-ups don't post to Clan chat at all
-- confirmed live by watching where they actually land: the game posts
them to **"game"** (`data-channel="game"`), the personal feed, which
previously wasn't watched at all. Fixed: `game` is now watched with the
same category mapping as `clan` (same `CATEGORY_LABELS` vocabulary), and
its output is relabeled to `clan` before queuing so your own events flow
into the exact same Discord channel, role pings and all, as everyone
else's. One wrinkle the game's own markup has: it never renders a sender
name on `game`-channel lines (there's nothing to render -- it's always
implicitly you), so there's no `.chat-sender-name` to read there;
`extractParts` falls back to the HUD's own name label
(`.ingame-hud-name`) for that channel specifically. Verified live with a
synthetic Game-channel rare-drop message carrying no sender span: resolved
to the correct player name and the correct `clan`-routed output channel.

### System/announcement lines were relaying as if you'd typed them (fixed, 2026-10-06)

Lines like `"★ The Fortress: your army survived 0 waves."` or `"★ The
host ended the raid."` have no `data-category` -- same as genuine player
banter -- but they're system announcements, not something anyone typed.
They were slipping through the "no category = plain chat" assumption and
getting relayed as if you'd said them yourself. First fix: any
uncategorized line starting with `★ ` (confirmed as the game's own
consistent marker for this -- also seen on `"★ Welcome to Scapewatch!"`,
`"★ Did you know? ..."`) is dropped instead of classified as `chat`.

That caught the star-prefixed ones, but then `"The Fortress reward: 15x
[T1] Linen Thread!"` showed up relayed the same way -- also no
`data-category`, no star either. Root issue, once seen clearly: **"game"
is the personal feed, entirely system-generated** (tips, quest steps,
task completions, drops, Fortress rewards, "army survived N waves", ...).
There's no such thing as player-typed banter on that channel at all, so
chasing individual untagged notification texts one at a time (star-prefix
today, something else next time) was never going to be the real fix.
Fixed properly: for `channel === 'game'` specifically, an uncategorized
line is *never* `chat` -- dropped categorically, regardless of wording.
The `★` check stays as a narrower safety net for Clan, where genuine
banter really does have no category and `chat` is still the right
classification. Verified live for both: a real Fortress-reward message
(no category) was dropped, while a genuine categorized game-channel
level-up (`data-category="levels"`) still relayed correctly.

## Status dashboard

A tiny local-only web page at **http://localhost:7777/** so "is everything
actually working" doesn't mean reading `watcher.log` by hand. Shows: CDP
connection state (and how long), chat relay config/last-event/counts,
clan-hiscores config/ws-hook-readiness/last-poll/current-rank/next-poll
countdown, raid-summary config/last-post/posted-count/solo-runs-skipped,
and a live-scrolling tail of recent activity -- auto-refreshing every 3s
via a `/status` JSON endpoint it also serves. The "Last updated" clock
has a 12h/24h toggle next to it (persisted in the dashboard's own
`localStorage`).

`status-server.js` -- plain Node `http` module, no new dependencies, bound
to `127.0.0.1` only (never reachable from outside this machine), read-only
(no endpoint changes any state). The watcher keeps a single in-memory
`STATUS` object updated at each relevant point (connect/disconnect, each
relayed/skipped chat event, each hiscores poll) and the server just
serializes whatever it currently holds on request -- no polling of its own,
no extra load.

Verified: isolated test of `status-server.js` alone (fake data, both
endpoints), then the full live watcher -- `/status` reflects real state
(connected, config-loaded, next-poll countdown) and the rendered page was
visually confirmed in-browser.

## Clan hiscores tracking

Posts to Discord when your clan's overall hiscores rank changes, OR when
any configured member's total level or individual hiscores rank moves even
if the clan's overall rank doesn't -- fixed 2026-10-07 after a real poll
logged "4 member stat change(s), no rank change" with nothing posted at
all: the original version only posted on an actual rank move, silently
dropping member-level changes whenever the rank happened to hold steady.

Posting is throttled ("scarce"), same day, later: by default routine
changes only get announced every 6 hours (`postIntervalMinutes`,
Settings -> Plugins -> Clan Hiscores), collapsed into a single summary of
everything that changed since the last post -- UNLESS the clan's rank
itself jumps by at least `majorRankChange` spots (default 3), which posts
immediately regardless of the timer. *Polling* (how often the game is
actually checked) is untouched and stays frequent, independent of posting
-- only how rarely the watcher is willing to actually say something
changed:

```
📈 **RAS** moved from clan rank **#14** to **#12** (major move)
Reason:
BoneBoiler total level 1,500 → 1,520
BoneBoiler hiscores rank #900 → #850
```
```
📊 **RAS** update -- rank unchanged at **#70**
Changes:
BoneBoiler total level 1,500 → 1,520
BoneBoiler hiscores rank #900 → #850
```

See "Posting scarcity" below for how changes are diffed against the last
POST rather than the last poll, so a throttled summary still shows
everything that happened in the gap, not just the latest poll's delta.

Shares a Discord webhook with Raid Summary -- both post to the same
"announcements"-style channel (originally `#en-w1`, since renamed "Chat
Announcements" by the user) rather than the main Clan chat-relay channel,
so rank/raid notices don't mix into ordinary chat. Reuses the webhook
already configured for Global chat relay in `chat-relay-config.json`
(that relay is disabled by default, so the webhook wasn't otherwise in
use) -- set via user choice, not guessed.

Read-only: every request sent is one the game's own Hiscores UI already
sends when you click through it yourself (Hiscores → Clan → "View Your
Rank", Hiscores → Players → "View Your Rank") -- reverse-engineered by
watching real network traffic while clicking those buttons. Nothing here
changes game state.

### How it works

The game multiplexes everything -- chat, live state sync, hiscores --
over **one persistent WebSocket**, as JSON frames shaped `{type, data}`.
There's no REST endpoint to poll. Confirmed real request/response pairs:

```
-> {"type":"clan_hiscores_my_rank","data":{}}
<- {"type":"clan_hiscores_my_rank","data":{"rank":75,"page":2}}

-> {"type":"hiscores_get_ranking","data":{"skillId":"overall","page":58}}
<- {"type":"hiscores_ranking","data":{"skillId":"overall","page":58,
     "rows":[{"rank":...,"playerId":...,"displayName":...,"clanTag":...,
              "totalLevel":...,"totalXP":...}, ...], "myPlayerId":...}}
```

Exactly 25 rows/page; no total-page-count field in the response (matters
for the search algorithm below). There's no direct "look up any player by
name" request -- only "my own rank" -- so tracking *other* clan members'
individual hiscores rank means locating them in the paginated list.

- `ws-hook.js` -- page-side. Patches `window.WebSocket` to capture a
  reference to the game's real connection, and exposes
  `window.__ccGameSocket.request(payload, matchType, timeoutMs)`, a
  promise that resolves with the next message of the given `type`. **Must
  run before the game's own script creates its WebSocket** (`Page.
  addScriptToEvaluateOnNewDocument`, same document-start mechanism as the
  other two scripts) -- injecting it into an already-loaded page is too
  late, the real connection already exists using the *native*
  constructor. Consequence: this only takes effect starting from the
  *next* game reload/relaunch after the watcher first registers it --
  confirmed live: `window.__ccGameSocket.isReady()` correctly reports
  `false` on the session it was installed into, and the poller logs that
  and skips rather than erroring (see `pollClanHiscores`'s first check).
- `panel-resize-watcher.js` -- drives the whole thing from Node via
  `Runtime.evaluate` with `awaitPromise:true` (the new `evalAwait` helper,
  alongside the existing chat-relay-drain machinery), on its own timer
  (`pollMinutes`, default 20 -- independent of the 5s chat-relay poll).
  Each cycle: fetch the clan's rank; for each configured member, locate
  their current `{rank, totalLevel}`; diff against persisted state
  (`clan-hiscores-state.json`); post to Discord only if the clan rank
  actually changed, listing whichever members' stats changed as the
  "Reason:".
- **Member search** (`findMemberInHiscores`): checking the last-known page
  (persisted) first means every poll after the first is typically a
  single request. Cold (or if that neighborhood no longer matches):
  exponential-probe + binary search by the member's last-known total
  level to find the page bracket, then a **contiguous walk from the lower
  bracket bound toward page 0** if not found right at the bracket. That
  direction isn't arbitrary: total level in this game only ever
  increases, so a member's current page can only be the same or *better*
  than wherever their stale level currently sits -- never worse. Walking
  the wrong way, or only checking isolated power-of-2-spaced probe points
  instead of a contiguous walk, both independently failed to find a
  member whose level had jumped a lot since the last check (simulating a
  long gap between polls, e.g. a watcher restart) -- caught by live unit
  tests against a synthetic dataset before shipping, not discovered after
  the fact. Bounded by a request budget (`HISCORES_WALK_BUDGET`) so one
  pathological case can't hang a poll cycle; gives up gracefully and
  retries next cycle if truly not found.
  **One retry per page request** (fixed 2026-10-07): a member with a big
  level jump since the last check needs ~10 sequential round-trips to
  relocate (confirmed live for a real case -- Rad jumped +20 total levels,
  moving from a cached page 79 to a real page 71), and a single one of
  those occasionally timing out as a pure flake was failing the *entire*
  lookup for that member, every time, until the next poll -- confirmed
  live by re-running the exact same request moments later (timeout, then
  35ms). That member would then silently drop out of the Discord summary
  for that poll with no visible error to the player, just a log line. One
  retry before actually giving up fixed it.

### Posting scarcity (2026-10-07)

Requested after the any-change fix above turned out to be too chatty for
routine 1-2 level stat drift. Changes are diffed against `state.lastPost`
(a snapshot taken at the time of the last ACTUAL Discord post), not
`state.members` (which still updates every single poll, unconditionally
-- that one only exists to hint `findMemberInHiscores`'s search for the
next poll, and is a completely separate concern from what gets
announced). This distinction matters: if posting is throttled for hours,
a member's `state.members` entry keeps moving every poll so the search
stays cheap, while `state.lastPost.members` stays frozen at whatever was
last actually announced -- so when a delayed post finally fires, it shows
the FULL accumulated change since the last post, not just whatever
happened to move in the most recent poll cycle.

`shouldPost = hasBaseline && hasChanges && (isMajor || dueForScheduledPost)`.
The very first poll ever (no `lastPost` baseline yet) always just
establishes the baseline silently, same as the original first-poll guard
-- now also seeding `lastPost`, not just `clanRank`.

Unit-tested (8 scenarios, against the real `shouldPost` formula extracted
from this file, not a reimplementation): first-poll, no-change,
minor-change-too-soon, minor-change-due, major-move-both-directions, and
member-only-change due/not-due -- all correct. Verified live: an existing
pre-fix state file (no `lastPost` field) migrated cleanly on restart,
logging `"first poll -- baseline established, rank 67"` with no crash and
no false post, confirming the migration path itself, not just the
decision formula in isolation.

### What you need to set up

Copy `clan-hiscores-config.example.json` to `clan-hiscores-config.json`:
`webhookUrl` (can reuse the same Clan Discord webhook from the chat
relay), `pollMinutes`, `postIntervalMinutes` (default 360 = 6h),
`majorRankChange` (default 3), `clanTag`, and `members` -- a plain list of
display names (there's no "fetch my clan's roster" request to discover
these automatically, and deliberately not worth opening any UI panel for
-- membership changes rarely, just update the list by hand when it does).

**Then reload or relaunch the game once** -- required for `ws-hook.js` to
actually intercept the connection; nothing happens before that (the
poller just logs and skips, harmlessly, every cycle until then).

### Verification status (2026-10-06)

Every request/response pair was reverse-engineered from real network
traffic (CDP `Network.enable` + clicking the actual Hiscores UI), not
guessed. The search algorithm was unit-tested against a synthetic
3000-player dataset covering: cold search, a repeat lookup with no change
(1 request), small drift (+3 levels), and -- after catching the
walk-direction bug via this same testing -- big (+150) and huge (+400)
level jumps, all resolving correctly within the request budget. Deployed
live: `ws-hook.js` installs cleanly, correctly reports `isReady() ===
false` on the already-open session it was injected into, and the poller
degrades gracefully (logs and retries next cycle) rather than erroring.
**Not yet verified: an actual rank-change notification end-to-end**,
since that needs a game reload (to activate the hook) followed by an
actual clan rank change -- next thing to confirm once both have happened.

## Raid summary

Posts a party-wide recap to Discord when a raid finishes -- top damage and
shared loot, not just your own personal "X reward" line (which the chat
relay already deliberately drops as noise, see "System/announcement lines"
below):

```
⚔️ **Chaos Dungeon** complete -- 3 members, 4:05
🏆 Rad (90,000), Wulf (50,000), Fly (30,000)
🎁 Mystic Shard 🌟, 12x Iron Ore
```

Gated by `minMembers` (default 2, configurable in Settings → Plugins →
Raid Summary, or `overlay/raid-summary-config.json`) -- skips solo runs so
the channel isn't spammed every time you run a dungeon alone. Clone
party-members (a loadout-preview mechanic, not real players) never count
toward this.

Shares a webhook with Clan Hiscores -- see that section for why (both are
"announcements," not ordinary chat, so they go to their own channel).

### How it works

Purely passive, same `ws-hook.js` connection used for clan hiscores --
reads two more real frame types the game already receives on its own,
never sends anything new:

- `raid_state` -- carries the raid lobby's member roster
  (`{playerId, playerName, isHost, isClone, ...}`) whenever it changes.
  Kept as the best-known roster (clones filtered out).
- `raid_run_complete` -- sent once when a run finishes, with
  `damageByPlayer: [{playerId, damageDealt}]` and
  `loot: [{itemId, quantity, isRare}]`. `playerId` is cross-referenced
  against the last-seen roster for names; `itemId` is resolved to a
  display name via `https://play.scapewatch.com/shared/data/items.json`
  (served live, same pattern as `nodes.json` for Walking Countdown).

Both confirmed by reading the game's own bundle (not guessed), 2026-10-07.

### Verification status (2026-10-07)

`buildRaidSummaryPayload`/`formatRaidDuration` unit-tested against solo,
3-member, and empty-loot/damage synthetic entries -- formatting and
pluralization all correct. The plugin-override merge (enable toggle +
`minMembers`) unit-tested the same way as the chat-relay/hiscores
equivalents. **Not yet verified end-to-end against a real raid
completion**, since `ws-hook.js` was bumped to v2 for this (new
`drainRaidSummaries()` method) and, same limitation as clan hiscores, a
version bump only takes effect after the *next game reload* -- confirmed
live immediately after deploying that the already-running page was still
on v1. Next real raid after a reload is the first live test.

## Hover info

Adds extra lines to tooltips the game already shows (or, for quests, a new
tooltip of our own) -- current/projected XP and an estimated gold profit
for a queued skilling task, HP/attack style for a queued combat task's
target, and XP/item rewards for an active quest -- plus a green-to-red
distance-based outline color on every queued task tile itself, not just
its tooltip. Purely cosmetic: no clicks, no mouse simulation needed to
build or verify any of it (the game's own `.tooltip`/`.icon-tooltip` nodes
already exist in the page at all times, just CSS-hidden until real hover),
nothing sent to the game's WebSocket.

Five independent toggles in Settings -> Plugins -> Hover Info --
`hoverTaskXpPreview`, `hoverTaskXpPercent`, `hoverMobStats`,
`hoverQuestRewards`, `taskDistanceColor` -- all default **on**. Unlike the
chat-relay/hiscores/raid-summary toggles, none of these need watcher-side
merging: `hover-info.js` reads `window.__ccPluginSettings.get(key)`
directly on its own poll tick, since nothing here touches
Discord/webhooks/Node.

### How it works

`#unified-queue-panel .uq-row` is one queue SLOT (7 live); the slot
currently running carries an extra `uq-current` class (confirmed live:
its `.icon-scroll-row`'s `data-skill`/`data-activity-id` matched the
floating Current Task widget's text exactly) and is skipped -- that widget
already shows its own live progress. Within every other slot,
`.icon-option.selected` is the one task actually queued there (a slot can
show other, non-selected `.icon-option`s too -- confirmed live these are
reroll/swap alternatives, not what's queued). Its sibling
`.icon-scroll-row` carries either `[data-skill][data-activity-id]`
(skilling -- Feature 1) or `[data-mob-id]` (combat -- Feature 2); either
way the tooltip extended is that option's own `.icon-tooltip.uq-tooltip`,
which the game already shows on hover via its own CSS
(`.icon-option:hover .icon-tooltip { display: block; }`, confirmed live)
-- no JS needed to show/hide anything there, just append a `.tt-line`
(marker-classed so it's updated in place each poll tick, never duplicated).

**Task XP preview (Feature 1):** current skill XP comes from
`.skill-cell[data-skill-id] .tooltip .tt-line.tt-xp` (confirmed live, e.g.
`"30,747 / 33,218 XP"` on the real Smith cell) -- re-read every poll tick,
so the shown numbers track real XP gains live, not a one-time snapshot.
Per-action XP isn't available from any live game endpoint (checked --
mobs.json/quests.json/items.json have none of it), only from this repo's
own `data/raw/activities/<skill>.json`; the watcher
(`panel-resize-watcher.js`) builds a flattened
`{ "<skill>:<activityId>": successXP }` table from every file in that
directory once at startup (confirmed live: "built activity-XP table (181
activities, 86 with known input/output)" in `watcher.log`) and bakes it
into the injected page as `window.__CC_ACTIVITY_XP`, assigned as a plain
property write prepended ahead of `hover-info.js`'s own source at
injection time -- a new pattern for this project, since every other script
here just reads its own file verbatim; this one script needed startup-time
Node-side data with no live endpoint to fetch it from itself. Total XP is
approximated as `successXP * qty`, deliberately ignoring the rare fail-XP
case. Bonus line (included since it was cheap): for activities where the
same per-skill file gives a direct single input/output item pair
(confirmed live true for barter/brew/cook/craft/discover/imbue/smith, NOT
true for bard/farm/fish/forage/invoke/mine/plunder/vigor, which are
loot-table based -- checked every file, not guessed), an estimated gold
profit line using `items.json`'s `value` field, fetched live -- but only
when BOTH items actually have a `value` (checked live: 15 of the 86
input/output activities have an unfinished/intermediate OUTPUT item with
no `value` field at all, e.g. "(Unf) Hawk Potion"; an earlier version
treated a missing value as 0 and showed a misleadingly large "loss" for
every one of those 15 -- caught live, see "A real bug caught during live
verification" below -- now suppressed entirely instead).

**Combat task mob stats (Feature 2):** `data-mob-id` is an exact key into
`mobTypes` from `https://play.scapewatch.com/shared/data/mobs.json`,
fetched live once (same `ensureX()` caching pattern as `nodes.json` in
`walking-countdown.js`) and confirmed live to be the exact same shape as
this repo's own `data/raw/mobs.json`. Static per mob, no player state, no
DPS/kill-time simulation (explicitly out of scope for this task --
`life`/`attackStyle` only, e.g. `"Feeble Mushroom — 27 HP"` / `"Attacks:
Range"`, both read back live from the real queue).

**Quest reward preview (Feature 3):** `.quests-panel .quest-slot`, its
`.quest-slot-name` text matched against `name` in
`https://play.scapewatch.com/shared/data/quests.json` (fetched live once,
confirmed same shape as `data/raw/quests.json`:
`rewards: {xp: {<skill>: amount}, items: [{itemId, quantity}]}`). Item
names resolved via `items.json` (also fetched live). **Deviation from the
original plan:** the plan expected `.tooltip`'s hover-show behavior might
be a generic CSS rule, reusable for free. Checked every stylesheet rule
live (`document.styleSheets`, matching every selector mentioning
`.tooltip` or `:hover`) -- there is no such generic rule. Even the game's
own `.skill-cell` tooltip, which visibly shows on hover, does so through
the game's own JS, not a CSS `:hover` rule this mod could piggyback on. So
this feature uses the plan's documented fallback instead: a real
`mouseenter`/`mouseleave` listener pair on each `.quest-slot`, toggling
`display` on our own absolutely-positioned div (styled with the game's own
`.tooltip`/`.tt-line` classes for visual consistency). Content is rebuilt
in place (existing `.tt-line` children reused, not replaced) each poll
tick so an open tooltip doesn't flicker shut mid-hover. Reward lines are
capped at the first 3 XP entries and first 3 items to avoid a wall of text
on quests with long reward lists.

**Task distance color coding (Feature 4):** requested after the user
noticed the World Map already tints task locations by trail color while
it's open, and wanted the same signal available with the map closed --
based on distance from the current position instead, green (near) to red
(far). Every `.icon-scroll-row` -- skilling or combat alike -- carries a
`data-node-id` attribute (confirmed live, 2026-10-07: e.g.
`data-node-id="reefrun_pool"` for a Fish task, `data-node-id=
"feeble_rat"` for a Kill task, matching that row's own `data-mob-id` --
the game evidently treats a mob spawn as a "node" too), resolving to a
real `{x,y}` in `https://play.scapewatch.com/shared/data/nodes.json`
(fetched live once, keyed by `id` this time rather than the lowercased
`name` key `walking-countdown.js` uses). "Current position" is read
straight from `window.__ccWalkingCountdown.lastKnownPos` instead of
duplicating that tracking here -- no position yet (brand new session, no
completed walk) means no coloring, same graceful-skip as every other
missing-data case in this file.

Colors use a **fixed absolute scale** (changed 2026-10-07 after the user
asked for it: originally normalized to the min/max of whatever happened
to be queued at that moment, which meant the same task could recolor
poll to poll just because the *other* alternatives offered alongside it
changed): 0 distance -> hue 120 (green), the TRUE farthest-possible
distance between any two real nodes -> hue 0 (red). That denominator is
computed once (`computeMaxNodeDistance`, O(n^2) over ~567 nodes, sub-10ms
live) rather than guessed at or approximated from the bounding box
diagonal (an upper bound, not necessarily achieved by any real pair).
Applied as a CSS `outline` rather than `border`, specifically so it can't
visually collide with the game's own `.icon-option.selected` border.

Also tints the location-name text itself, not just the tile outline (user
asked for this on top of the outline) -- for SKILLING tasks only: the
tooltip's second `.uq-tt-row` (first is the task name) holds a plain-text
span like `"Sandscale Wilds (7642)"`, confirmed live to be the real
location name (with what looks like a population/worker count in
parens). Combat tasks' second row is NOT a location -- confirmed live
it's combat-style info instead (e.g. `"Melee 1 (1357)"`) -- so this is
gated on the same `[data-skill][data-activity-id]` check Feature 1 uses
and simply doesn't apply to combat tasks, rather than mis-tinting
unrelated text. Verified live: every skilling task's location-span color
matched its own tile's outline color exactly (e.g. `Sandscale Wilds
(7642)` at `rgb(104,195,34)`, byte-identical to that tile's outline),
and every combat task correctly had no location span to tint at all.

**A second, structurally separate copy of the location text (fixed
2026-10-07):** the user sent a screenshot of the panel's own "Tasks"
list view (same `#unified-queue-panel`, its titlebar literally reads
"Tasks") -- icon + always-visible name + location per row, no hovering
needed -- and none of it was colored. The location-tinting above only
ever touched the HOVER-ONLY tooltip span inside `.icon-option`; this
list view turned out to be a completely different, always-rendered DOM
section living alongside it: `.uq-row > .task-details > .task-node >
.uq-name-text`, a sibling of `.icon-container` within the exact same
row (confirmed live by walking `.closest('.uq-row')` from a `.task-node`
and checking it landed on the row whose `.icon-option.selected` had the
matching `data-node-id` -- e.g. the row whose list-text read "Stillbark
Anvil (4700)" was the same row whose selected tile resolved to node id
`stillbark_anvil`). Only one `.task-node` per row (the row's committed
choice -- the 2 reroll alternatives have no equivalent always-visible
text), so this is applied once per row using the selected option's
already-computed color rather than once per option. Verified live across
a real 7-row queue: 6 of 6 non-current rows' list-text picked up the
correct color (e.g. `Stillbark Anvil (4700)` -> `rgb(88,195,34)`); the
7th (the active task's row) correctly stayed uncolored, same as
everywhere else Feature 4 deliberately skips the running task.

### Two real bugs caught during live verification

The first injected version used `const __CC_ACTIVITY_XP = {...}` as the
preamble, exactly as originally planned. It worked on the first injection
after a game reload, but **the second watcher restart (no page reload in
between) silently broke the entire script** -- confirmed live: CDP
`Runtime.evaluate` throws `SyntaxError: Identifier '__CC_ACTIVITY_XP' has
already been declared` when a top-level `const` is evaluated a second time
into an already-loaded page (each `Runtime.evaluate` call shares the same
page's global lexical environment; a syntax error aborts the *entire*
evaluated string, including hover-info.js's own IIFE concatenated after
it) -- and the watcher's generic result logger only prints
`result.result.value`, which an exception response doesn't have, so it
failed with **no log line at all**, not even an error. Caught by
re-reading the log after a second restart and noticing `cc hover-info
loaded` was simply missing. Fixed by switching the preamble to plain
`window.__CC_ACTIVITY_XP = {...}` property assignment (safe to repeat
indefinitely) instead of `const`, verified fixed by restarting the watcher
twice more in a row with no page reload and confirming `cc hover-info
loaded` logged cleanly both times and `window.__CC_ACTIVITY_XP` read back
all 181 entries from the live page afterward.

Second: the gold-profit bonus line's first live reading showed
`[T0] Brew 62 (Unf) Hawk Potion` -> `Est. profit: −186 gold`, which looked
plausible at a glance but turned out to be wrong for a specific reason --
`(Unf) Hawk Potion` has no `value` field in `items.json` at all (it's an
unfinished/intermediate good), and the code was treating a missing value
as `0`, so the "−186" was really just "−(3 gold Hawk Seed cost) × 62," not
a real profit/loss figure. Checked every one of the 86 input/output
activities: 15 have this same gap on their output item. Fixed by requiring
`typeof value === 'number'` on BOTH items before showing the line at all
(a few items, e.g. Bloodcoins, have a genuine value of `0`, so "falsy"
isn't the right check either) -- re-verified live afterward: both brew
potions above now correctly show no gold line, and a hand-computed example
that does have both values (Iron Ore value 10 -> Iron Bar value 15, live
`items.json`) matches the code's `(outputValue - inputValue) * qty`
formula exactly (+5/unit).

### Verification status (2026-10-07)

Everything below was read back from the actual running, logged-in session
via CDP `Runtime.evaluate` -- no mouse/hover simulation was needed to
produce any of it (confirmed real tooltip DOM already exists, just
CSS-hidden), except where noted.

- **Deployed live:** watcher restarted five times in a row across both
  fixes above (to catch the redeclaration bug and confirm it held, then
  again for the gold-profit fix); `watcher.log` shows all 6 scripts loading
  cleanly every time, in order, with `cc hover-info loaded` present on
  every restart after the first fix and the activity-table build line
  (`"built activity-XP table (181 activities, 86 with known
  input/output)"`) logged first each time.
- **Feature 1, real queued tasks, read back from the live DOM after both
  fixes:** `[T0] Brew 62 (Unf) Hawk Potion` -> `18,110 → 18,730 XP (+620)`,
  no gold line (correctly suppressed -- unfinished output item, no
  `value`); `[T0] Brew 121 (Unf) Skirmish Potion` -> `18,110 → 19,320 XP
  (+1,210)`, also correctly no gold line; `[T3] Fish 73 Raw Lobster` ->
  `54,045 → 55,870 XP (+1,825)`; `[T1] Forage 126 Linen` -> `35,426 →
  36,938 XP (+1,512)`; `[T2] Vigor 163 Sit-ups` -> `56,588 → 59,196 XP
  (+2,608)` -- each appended in place as a real `.tt-line.cc-hover-xp`
  inside the actual `.icon-tooltip.uq-tooltip` node, verified by reading
  `tooltip.outerHTML` directly off the live page. None of the tasks queued
  during this session happened to be a processing activity with BOTH items
  priced, so the gold-profit line's positive-case arithmetic was confirmed
  by hand instead (Iron Ore/Iron Bar, see above) rather than off a live
  tooltip -- noted honestly below.
- **Feature 2, real queued combat task:** `[T1] Kill 34 Feeble Mushroom`'s
  tooltip gained `.cc-hover-mob-name` = `"Feeble Mushroom — 27 HP"` and
  `.cc-hover-mob-atk` = `"Attacks: Range"`, matching the live-fetched
  `mobTypes.feeble_mushroom` entry's real `life`/`attackStyle` fields.
- **Feature 3, all 5 real active quest slots:** each gained a
  `.cc-hover-quest-tooltip` with correct, live-fetched reward text, e.g.
  Duneridge Silk Run -> `"+8,000 Craft XP, +8,000 Alms XP"` /
  `"30x Silk Thread, 400x Gold"`; The Strange Seam -> `"+7,300 Mine XP,
  +7,300 Smith XP, +7,300 Alms XP"` / `"40x Iron Ore, 20x Iron Bar, 800x
  Gold"`. Show/hide verified by dispatching a synthetic `mouseenter` /
  `mouseleave` pair at our own listener (exercises only this mod's own
  cosmetic code, not any game interaction): tooltip `display` went
  `none` -> `block` -> `none` as expected.
- **Settings UI:** the real in-game Settings -> Plugins -> Hover Info
  section renders all three toggles, native switch markup, all "on" by
  default (confirmed via `outerHTML`). Toggling "Combat Task Mob Stats"
  off through the real control removed `.cc-hover-mob-name` within one
  poll tick; toggling it back on restored it -- confirmed live, then left
  in its default all-on state.
- **Not yet seen on a live tooltip:** an actual positive gold-profit line
  (the suppression logic for missing values was verified live; the
  `(outputValue - inputValue) * qty` arithmetic itself was cross-checked
  by hand against real `items.json` values -- Iron Ore 10 -> Iron Bar 15,
  +5/unit -- but no currently-queued task during this session happened to
  be a priced processing activity, so the line has not yet been read back
  off a real tooltip showing an actual number). Next smith/craft/cook/
  barter/discover/imbue task queued during normal play is the first real
  look at it.

## Activity digest

Periodic Discord rollup of notable Clan+Global activity, grouped by
player -- rare drops, pet drops, unlocks, completed quests, and level
milestones -- posted every N hours (default 6, configurable in Settings
-> Plugins -> Activity Digest or `overlay/digest-config.json`), requested
2026-10-07 as "either 2 daily summaries or 4, so either every 12 or 6
hours":

```
📋 **Activity Digest** -- last 6h

**BoneBoiler**
🐾 Pets: Baby Dragon, ✨ Shiny Owl
🔓 Unlocks: Ancient Forge
📜 Quests: The Pickled Eels

**Wulf**
💎 Drops: Mystic Shard
⭐ Levels: Vigor → 34
```

Deliberately separate from, not a replacement for, the existing live
per-event relay -- a player can turn off every individual Discord ping and
still get this periodic rollup, since it accumulates independently (see
"How it works" below). Skips posting entirely if nothing notable happened
in the window (an empty digest is worse than no digest). Shares the same
Announcement webhook as Clan Hiscores and Raid Summary.

**Quest completions** needed adding to the chat relay's category
vocabulary first -- `questsCompleted` was a real category the game's own
`CATEGORY_LABELS` object already had (confirmed from the live bundle,
2026-10-07), just never mapped/relayed before (deliberately excluded
alongside `deaths`/`questSteps`/etc. when the chat relay was first built).
Message text format confirmed from the bundle, not guessed: the game
always sends exactly `"Quest complete: " + questName`, no variation
(`L.on("quest_complete", ... ie.gameMessage("Quest complete: "+X, ...,
"questsCompleted"))`). Added as its own `questComplete` kind, flowing
through the SAME live-relay path as every other category (its own 📜
emoji, its own `pingQuests` toggle, default off) -- not digest-only.

### How it works

Fed directly from every drained chat-relay event, inside the
`ws.addEventListener('message')` handler's `pendingDrains` branch --
*alongside* `relayEvents(events, cfg)`, not from inside it. That
placement is deliberate: `relayEvents` only processes events whose
channel is actually enabled (`if (!channelCfg.enabled) continue`), so if
digest accumulation lived inside that function it would silently stop
working the moment a player turned off live Clan relay, even though the
digest is supposed to be the thing that still works when live pings are
off. `accumulateForDigest` has no such gate.

Only structured events (`kind !== 'chat'`) count. Per player, per
category: rare drops/collections and unlocks are appended to a plain
list (capped at 8 + "+N more" per category, so one extremely active
member can't blow past Discord's ~2000-char content limit alone); pets
get a ✨ prefix for shiny ones; quests likewise; level-ups keep only the
**highest** level reached per skill in the window, not one line per
ding -- a single skill can level up dozens of times in 6h, which would
otherwise bury every other category under one skill's repetition.

Persisted to `digest-state.json` (buffer + a separate dedup key set, see
below) so hours of accumulated activity survive a watcher restart --
same "persisted state" lesson as every other feature in this file. On
restart, the next post is scheduled relative to when the buffer actually
started accumulating (`sinceAt`), not a fresh full interval every time --
5 of 6 hours already elapsed before a restart means the next post is
still ~1h away, not another 6h.

### A real duplicate-counting bug, caught before it could actually happen

`relayEvents`'s own live-relay dedup (`alreadyRelayed`/`relayedKeys`,
documented above) exists specifically because a watcher restart resets
the page-side collector's in-memory "seen" set, and a subsequent chat-DOM
rebuild (confirmed elsewhere in this file to happen periodically, ~75-90s
or on tab switch) can re-present already-seen chat history as "new" DOM
nodes -- re-draining messages the watcher already processed. The first
version of `accumulateForDigest` had NO equivalent protection at all.

Reusing `relayedKeys` directly for the digest too was considered and
rejected: `relayEvents` and `accumulateForDigest` both run on the exact
same drained batch, in the same tick, and `relayEvents` runs first. A
single shared check-and-mark Set means a BRAND NEW event, the first time
it's ever seen, would get marked "already relayed" by `relayEvents`
before `accumulateForDigest` even looks at it -- so the digest would
wrongly treat its own very first look at a new event as a duplicate and
silently drop it, not just across restarts but on ordinary, successful,
single-pass operation. Caught by reasoning through the call order before
shipping, not discovered live after the fact.

Fixed with a fully independent dedup -- same key shape
(`channel|timestamp|player|text`) and same cap (1000), but its own
`seenKeys` array living inside `digest-state.json` alongside the
accumulation buffer, with its own `digestSeenKeys` in-memory `Set` kept
in sync on load (`syncDigestSeenKeys()`, called both at startup after
`loadDigestBuffer()` and NOT after a routine post-flush, since the flush
intentionally preserves `seenKeys` across the reset -- wiping it on every
digest post would reopen the exact restart/rebuild duplicate window the
whole mechanism exists to close, just realigned to the posting schedule
instead of actual message history). Verified in isolation: a synthetic
event accumulates once, surviving a simulated reload+re-sync; re-draining
the IDENTICAL event afterward (simulating the restart+rebuild scenario)
correctly leaves the accumulated state unchanged; a genuinely new
subsequent event still accumulates normally right after. Deployed live
and confirmed the migration path too -- the pre-existing (pre-fix)
`digest-state.json` had no `seenKeys` field; restarting defaulted it to
an empty array/Set with no crash and no data loss to the existing
accumulated buffer, logged `"resumed buffer with 1 player(s) ...,
0 seen-message key(s)"`.

### Verification status (2026-10-07)

`accumulateForDigest`/`buildDigestPayload` unit-tested against a
synthetic batch covering: per-player grouping, shiny-pet prefixing,
level-up "keep the highest, never overwrite down" behavior, plain-chat
and no-player events correctly ignored, an empty buffer producing `null`
(no post), and `capList`'s 8-item truncation. Deployed live: watcher
restart picked up the new `questComplete` category cleanly (no errors in
`watcher.log`), all digest/hiscores plugin settings read back correctly
via `window.__ccPluginSettings.getAll()` against the real running page.
**Not yet verified: an actual digest post landing in Discord**, since
that requires either real structured chat activity accumulating across a
full configured interval, or the next scheduled post firing naturally --
first one to happen live is the real end-to-end check.

## History — what was tried, and why it broke

Read this before trying another approach.

1. **Native CSS `resize: both` + `overflow: auto` on the panel.** `resize`
   only renders its handle when `overflow` is non-`visible`, and that
   overflow clips the game's tooltips/pop-outs, which render outside the
   panel box (hovering a Tasks row icon pops an icon strip out to the
   left plus a tooltip above). Replaced by a custom grip.
2. **`zoom` on a wrapper around the panel's content.** Broke the game's
   tooltip positioning math. (Note the game itself already applies
   `zoom: ~1.27` to `#ui-container`, and some of its tooltip code mixes
   viewport-px measurements with CSS-px offsets; a second, nested zoom was
   probably what tipped it over — not re-investigated.) Switched to
   `transform: scale()`.
3. **v1: reparent the panel's children into a wrapper div
   (`while (panel.firstChild) wrapper.appendChild(panel.firstChild)`),
   scale the wrapper, and a MutationObserver to keep the user's
   width/height sticky.** Passed every short test (Tasks at 0.678,
   Skills at 0.774, tooltips fine, stable for 6 s), then broke during
   normal play: the Tasks panel's `.uq-rows` container (all queue rows)
   vanished from the DOM entirely — `document.querySelector('.uq-rows')`
   returned `null`.

   **Root cause (confirmed by reading the bundle, `game.<hash>.js`):** the
   Tasks panel's `_buildRowElements()` does

   ```js
   this.rowsWrapEl.parentNode.removeChild(this.rowsWrapEl);   // old .uq-rows gone
   this.rowsWrapEl = document.createElement("div"); // new .uq-rows
   this.element.insertBefore(this.rowsWrapEl, this.controlRowEl);
   ```

   `this.element` is the panel and `this.controlRowEl` is `.uq-controls`.
   After v1 moved `.uq-controls` into the wrapper, it was no longer a direct
   child of the panel, so `insertBefore` throws `NotFoundError` — *after*
   the old `.uq-rows` was already removed. Result: no `.uq-rows` at all,
   exactly the observed empty gap. `_buildRowElements` doesn't run on an
   ordinary task completion; it runs when the queue's slot count changes
   (`_syncRowCount`), on collapse/expand, layout/row-count changes and
   windowed-mode toggles — which is why the short tests never hit it.

   Lesson: **never move or wrap the game's own nodes.** v2 is built
   entirely around that rule, so the precondition that broke (`.uq-controls`
   being a direct child of the panel) can't be affected by the mod.

## Status / verification (2026-10-06, v2)

Tested against the live, logged-in session (Electron 33 / Chrome 130) via
CDP: simulated `Input.dispatchMouseEvent` drags on the grip and hovers on
panel content, verified with full-page `Page.captureScreenshot` images
that were actually looked at, plus DOM checks (`.uq-rows` present, 6
`.uq-row` items, current-task row and controls present, 30 Skills cells,
unchanged panel `childElementCount`, game inline styles untouched).

Testing note: `Page.captureScreenshot` **with a `clip`** resets the page's
hover state (it re-lays out under emulation), so hover screenshots must be
full-page captures, cropped afterwards. (Full-page captures keep `:hover`;
verified by querying `:hover` before and after the capture.)

What was verified, each with a screenshot that was looked at:

- **Grip placement/look** on Tasks, Skills and Current Task (the three
  floating panels in this layout); hidden for the invisible
  Fortress/gauntlet HUD.
- **Drags, varied:** Tasks shrunk diagonally to 72%, then 61%; shrunk with
  a vertical-only drag to 73%; an attempted enlarge clamped at 102% because
  Tasks sits on the right window edge (panel right = exactly 2560 px, grip
  clamped on-screen). Skills enlarged to 123%, shrunk diagonally to 61%,
  shrunk horizontally to 87%. Current Task shrunk to 78% (mostly horizontal),
  enlarged to 200% (MAX), then reset with a simulated double-click on its
  grip. Content fits the visual box exactly at every size (all 7 Tasks rows,
  all 30 Skills cells).
- **Tooltips at every size tested:** Tasks icon hover (pop-out icon strip +
  `.uq-tooltip`) at 100% (baseline), 72%, 73% (top row and bottom row) and
  61% — correctly placed relative to the icon, not clipped, panel lifted to
  z-index 100000 while showing. Skills `.global-tooltip` (body-level, fixed)
  at 123%, 61% and 87% — correctly placed below/above the hovered cell.
- **Occlusion:** with Current Task at 200% covering the Skills panel's
  corner, the Skills grip hid itself; it reappeared after the reset.
- **Across time and a real queue change:** a 5.5-minute monitor (DOM
  snapshot every 20 s, full screenshot every minute) at Tasks 72% / Skills
  61% / Current Task 78% spanned an actual task completion (Cook 97 Perch
  finished, queue advanced, a new row "Plunder 94 Muggers" appeared): `.uq-rows`
  present with 6 `.uq-row` items throughout, `.uq-controls` still a direct
  child of the panel, panel child order identical to baseline, scale held.
  A second 4-minute monitor at Tasks 61% / Skills 87% (after a full
  teardown + re-inject) was likewise clean. A Cook level-up also re-rendered
  the Skills panel while scaled — fine.
- **Teardown:** `panel-resize-teardown.js` returned the page to vanilla —
  no style element, no grips, no API object, no storage key, panel rects
  and the game's inline styles byte-identical to the pre-mod baseline,
  verified by screenshot. Re-injection afterwards worked, and re-injecting
  over a live instance leaves exactly one style element and one grip per
  panel, with saved scales restored.

Not tested (would require clicking game UI, which this work avoids):
dragging a scaled panel by its titlebar, minimize/restore, re-dock,
collapse/expand of the Tasks queue, and the `_buildRowElements` rebuild path
specifically (it can't be triggered without clicking, and the game's
objects aren't reachable from the console). Expected behaviour from the
code: drag/move math is unaffected (see tradeoffs); minimized panels hide
their grip; re-docked panels drop the scale via the `.panel-floating`
selector; `_buildRowElements` works because v2 never changes which nodes
are the panel's direct children. If a panel ever does misbehave:
run the teardown and reload the game.

**State left in the live session (2026-10-06 14:25):** v2 loaded, all
panels at 100% (scales reset), grips present on Tasks, Skills and Current
Task. DOM verified intact (6 queue rows, 30 skill cells, panel layout
identical to baseline).

## Status / verification — edge-anchoring fix (2026-10-06, later same day)

User-reported bug: shrunk panels couldn't reach the screen edges ("Windows
cannot go completely out to the edges when made smaller"). Root-caused and
fixed as described in "Edge-anchored scaling" above; verified live against
the actual running (real, logged-in) session via CDP, not just reasoned
about:

- **Pre-existing state:** the real Tasks panel was already sitting
  bottom-right at scale 0.72 (saved from earlier real play, under the old
  top-left-only origin code). Injecting the fix immediately snapped its
  visual right/bottom edges flush to the window edges — a `Page.captureScreenshot`
  clip of the corner at 2x scale showed zero gap, where the old code would
  have left roughly 133px.
- **Live drag tracking:** dragged the Quests panel by its own titlebar
  (simulated `Input.dispatchMouseEvent`, real pointer/mouse path, not the
  mod's own grip) from mid-screen to the bottom-right corner. The `sync()`
  loop picked up the new anchor corner with no re-injection needed, and the
  panel's visual rect ended up flush (`right`/`bottom` within 0.5px of the
  window size) — confirmed by screenshot.
- **Grip-driven shrink/grow at a non-default corner:** dragged the Skills
  panel to the right edge mid-height (top-right anchor, away from the
  bottom HUD bar). Shrank it via our own grip to the 50% floor — right edge
  stayed flush, confirming the origin follows the anchored corner during an
  active drag, not just on drag-start. Then grew it back out: reached scale
  1.429 (vs. being incorrectly locked at 0.5 under the old corner-blind
  `sFit` calculation, which measured room on the wrong side for a
  right-anchored panel) and stopped growing exactly when its *bottom* edge
  neared the window edge — the correct binding constraint.
- All test panels (Quests, Skills) were dragged back to their original
  positions and scales afterward; Tasks was never touched. Confirmed via a
  final full-page screenshot matching the pre-test layout.
- Noted, not a bug: the grip can be hidden by the game's own bottom HUD bar
  when a panel is scaled flush against the literal bottom edge — this is
  the pre-existing occlusion feature (grip hides under anything else on
  top) working as designed, not related to this fix.

## Status / verification — exit tolerance lowered (2026-10-07)

User-reported, after the hysteresis fix above had already shipped: "quite
a lot of panels" still felt snapped/stuck, annoying enough to not be able
to park a panel exactly where wanted. Asked the user directly whether to
disable edge-snapping outright or keep it but cut the stickiness down --
explicit answer: keep it, make it much less sticky. `EDGE_TOL_EXIT`
dropped from 50px to 16px (6px of hysteresis margin over the 10px
`EDGE_TOL_ENTER` -- just enough to still absorb the original sub-pixel
flicker bug, nowhere near enough to feel sticky during a real drag).

A live synthetic native-titlebar drag (same `Input.dispatchMouseEvent`
technique that verified the fix above) didn't reproduce cleanly this time
-- the panel jumped straight to the target position on the first move step
and a subsequent pull-back phase produced no further movement, likely an
artifact of how the game's own drag-tracking consumes synthetic move
events rather than anything about this change itself. Switched to
unit-testing `updateOrigin` directly, extracted from the real file (not
reimplemented) via the same "isolate and test the actual source" pattern
used for the hiscores search algorithm: built a fake panel whose
`getBoundingClientRect()` is driven by hand, drove it through
far-from-edge -> approach-and-snap-in -> 25px-pullback. Confirmed the
25px pullback now releases (`origin` reverts to `tl`) under the new 16px
threshold, and -- re-run with the OLD 50px value as a direct
before/after contrast, same test, same inputs -- confirmed it would NOT
have released under the old threshold (`origin` stayed `tr`). That
contrast is the actual evidence the change does what was asked, not just
that the code still runs.

## Route Advisor (2026-10-07) -- `route-advisor.js`

Display-only. Suggests the order of the queued tasks that minimises walking
time, with and without teleport crystals; never clicks/drags/reorders anything
(the player applies a suggestion by hand). Reverse-engineered from the game's
bundle (`game.*.js`: `getPathDistance`, `computeWaypoints`, `getTeleportPlan`,
`_chainTaskNodeTextRaw`) and validated live at **0.00% error on 18/18 queue
options**:

- The "(N)" on a queue option is the route distance from the **previous row's
  selected option's node** (row 1 measures from the current task's node) --
  not from the player, so no position inference is needed.
- `dist(a,b) = hubPathLen(a) + bankToBankLen(hub(a),hub(b)) + hubPathLen(b)`;
  `hub = nearestBankId`, `hubPathLen` = polyline length of the live
  `shared/data/nodes.json` `nearestBankPath` (the repo's local `data/raw`
  copy lacks these fields); same-hub legs still detour via the hub.
- Teleports: crystals drain in Active Potions tooltip order; a leg longer than
  the FIRST crystal's threshold (T1 15000 / T2 12000 / T3 10000) costs 0
  walking + 1 charge, then the next crystal takes over.
- Time = distance / total movement speed (Unlocks panel).

Optimizer: exact DP over row subsets (<=10 rows) for the no-teleport optimum +
teleport-aware hill climbing (swap / move / change-pick) on the exact
objective; the unit-testable core sits between `//#core-begin/end` and is
exported with `module.exports` when `require`d from node.
**Recommended** = best reorder that keeps the player's option picks;
"Best overall" (may change picks), "Best without teleports", "Saves crystal
charges", "Change picks only" are offered as alternatives with pros/cons.
A yellow warning triangle (with a dismiss x) appears above the queue when the
recommendation saves >= the threshold; clicking it opens the panel (also
auto-shown on the World Map). The panel has a mini-map (green = suggested
route, dashed yellow = teleport leg, grey = current route; polylines are
lazy-loaded from `paths.json`).
Plugins tab -> "Route Advisor": enable, show on World Map, warning triangle,
alert threshold. Only rows with known node ids are optimised; action time is
not included.

## Supervisor, dashboard controls and plugin switches (2026-10-07)

`start-watcher-hidden.vbs` now launches **`supervisor.js`**, which hosts the
dashboard (http://scapelite.localhost/ , also :7777; the older scapewatch-dashboard.localhost name still works) and forks
`panel-resize-watcher.js` as a child over IPC. That is why the dashboard can
**Stop / Start / Restart** the watcher (it can't live inside the process it
stops); unexpected crashes auto-restart (max 5 per 5 min). Plain
`node panel-resize-watcher.js` still works standalone (own dashboard, plugin
switches, no process buttons).

- **Logs** are categorised at the source (`categorize()` in the watcher):
  *Discord* (relay events, hiscores/raid/digest posts) vs *System* (plugin
  loading, connection, config, errors), with an *All* tab. The supervisor keeps
  the ring, so logs survive watcher restarts.
- **Plugins:** `PLUGIN_DEFS` in the watcher lists every page-side mod; the
  dashboard switches write `overlay/plugins-config.json` (`{"disabled":[...]}`)
  and apply live (inject now / call the mod's `teardown()` and drop its
  next-document registration). `ws-hook` and `plugins-settings-ui` are core.
- **Security:** control POSTs need `x-cc-control: 1`, an allowed `Origin`
  (the dashboard itself) and an allowed `Host` (DNS-rebinding guard); the game
  page cannot call them. `GET /status` keeps CORS only for play.scapewatch.com.

## Other 2026-10-07 additions
- `xp-tracker.js` (XP/hr chip, rolling window, level-up ETA), `notify-always.js`
  (makes the game's own OS notifications fire while focused: `document.hasFocus`
  is only used inside the game's `_osNotify`), route-advisor Pushover alert
  (once per suggestion, 30 min cooldown, threshold in Plugins tab).
- panel-resize.js: tick is now ~5 Hz + per-frame only while a mouse button is
  held (profiled: the old per-frame `querySelectorAll` was ~30% of main-thread
  time; idle went 43% -> 74%); Dashboard + Potions got resize handles;
  whole-pixel heights, px readout and W x H badges on all panels while resizing
  (optional snap to another panel's height).

## Route Advisor objectives, game bridge, map lanes (2026-10-07)

- **Game bridge** (`game-bridge.js`, attached by the watcher): the game's state
  `G` and Dashboard `D` are bundle-scoped, so the watcher finds them with CDP
  `Runtime.queryObjects` (one ~2.4 s pause at attach, re-attached when the page
  loses it) and installs `window.__ccBridge.project()`: the game's own
  `D._projectOpt` projection (seconds, XP, XP/hr) for the current task and
  EVERY queue option, validated at 0.000% on 19/19 options, plus quest-step
  flags (same rule as `_getActiveQuestStepsAtNode`) and active-quest reward XP.
  Read-only; toggle "Game Data Bridge" in the Plugins tab. Dashboard XP omits
  `getSkillXpBonus`, which the advisor multiplies back in for skill options.
- **Objectives** (route-advisor.js `buildObjectives`): Fewest steps / XP/hr /
  Tasks/hr / Quests, each with teleports on or off. Rate objectives are
  fractional programs solved by Dinkelbach iteration around the exact subset DP
  (option cost = lambda*actionTime - value) plus exact hill-climbing. Totals:
  T = head remaining + sum option time + walking; X = head XP + sum option XP.
  Quest value Q = reward XP / remaining steps for options that are a quest's
  CURRENT step. With picks fixed, reordering cannot change X or action time, so
  XP/hr, tasks/hr and Quests only differ from "fewest steps" when picks change.
  "Recommended" still keeps your picks and minimises walking.
- **Map route lanes** (`map-routes.js`): wraps the World Map canvas's 2D context
  INSTANCE, suppresses the dashed route-leg strokes (dash [12,8]) and redraws
  them on its own canvas below the game's, with overlapping legs in parallel
  lanes and ">" chevrons for direction. Tested on the real (hidden) canvas with
  synthetic strokes; needs the World Map open for a real-world check.
- Keep-on-screen: panel-resize.js shifts any panel whose visual box leaves the
  viewport back in (CSS `translate`, game position untouched; toggle in Plugins).

## Relay reliability: outbox, carry-over, graceful stop (2026-10-07)
Restarting the watcher used to lose chat events that hadn't been posted yet.
Fixed in three layers:
- **Collector carry-over** (`chat-relay-collect.js` v11): a re-injected collector
  adopts the previous instance's undrained queue and seen-set (`peek()`,
  `seenKeys()`, `lastSeq()`), so nothing queued in the page is dropped.
- **Outbox** (`chat-relay-outbox.json`): drained events are written to disk BEFORE
  posting; a key is marked relayed only AFTER Discord accepts the post; failed
  posts are retried each tick (6 tries) and leftovers are re-sent on next start.
- **Graceful Stop/Restart**: the supervisor sends `{type:'shutdown'}`; the
  watcher drains the page queue, posts everything pending (12 s cap), then exits
  0. The supervisor force-kills only after 18 s. (Killing node directly still
  bypasses this -- use the dashboard buttons.)
- `window.__ccChatRelay.rescan()` lists chat events currently in the DOM (read-only)
  to find ones missing from `chat-relay-seen.json`.

## Raid Lobby Alert (2026-10-07) -- `raid-alert.js`
Read-only: never joins/creates/readies a lobby. Polls `raid_list_open` (all
worlds, every 8-120 s, default 12) and, for the most-filled joinable
current-world lobbies (max 4 per cycle, 20 s cache), `raid_peek` for the member
list (levels, skills, equipBonuses, attackInterval, raidKc). Other-world lobbies
can't be peeked -> optional host check via `hiscores_get_player` (`totalRank`).
Your own stats + the game's join rules (avg loadout level >= min role level,
weapon tier >= floor(min/10), difficulty slay/delve level, Fortress role levels)
come from `__ccBridge.raidSelf()` and `window.__CC_RAID_DEFS` (baked from
`data/raw/raids.json` by the watcher), so lobbies you can't enter are never
reported. Party strength is RELATIVE TO YOU (1.0 = as strong): 0.40 combat level
+ 0.40 damage proxy ((2*lvl + attack + strength bonus)/attack interval) + 0.10
Slay + 0.10 Life, per member capped at 2x, host weighted 1.5. Alert (toast +
Windows notification -> Pushover) when strength >= the threshold (default 100%),
once per lobby (again only if +15%), global cooldown, silent while you are in a
lobby/raid. All options under Plugins > Raid Lobby Alerts. Manual dry run:
`__ccRaidAlert.scan()` (evaluates, never notifies).

## Panel fuse (`panel-fuse.js`)
When two floating panels sit edge to edge, a link button appears in their title bars. Click it to fuse: the panel snaps flush, the seam gets squared corners and a single border line, and dragging either panel carries the fused ones along (via a CSS `margin` offset on the partner; the game's own left/top are never written). Click again to separate; fuses also release if the panels stop touching. State in localStorage `cc-panel-fuse`. Toggle: Plugins > `panelFuseEnabled`. Display-only.

## Vertical menu edge radius
In vertical mode the tab buttons round the side facing away from the screen edge the bar is attached to (`cc-vm-r/l/t/b` body classes), all four corners when it is on no edge; active-tab glow is lifted above its neighbours so it is no longer clipped.

## 2026-10-08 additions (ScapeLite)
- **Status light + performance** (`status-indicator.js`, watcher `perfBurst`): pulsing dot with FPS under it; hover for frame stats, JS memory, page-element count and a CPU breakdown (game / browser / each plugin) measured with the CDP sampling profiler. Every plugin script carries `//# sourceURL=cc-plugin-<id>.js` so time is attributed by name. Note: the game itself keeps ~130k hidden DOM nodes, which makes page-wide `querySelector` slow; plugins use cached lookups (`qc()`).
- **Walking drawer**: the walking countdown slides out of the Current Task panel (toggle `walkDrawerMode`).
- **Route advisor**: remembered "I plan with teleports / on foot" preference; teleports are only pushed when they save >= `routeTpWorthMin` minutes per charge; alert docked to the Tasks title bar and scaled with it.
- **Smart Recenter-Camera button**, **Current Task title-bar seam fix**, **Activity digest fixed clock times** (`postTimes`, e.g. 08:00, 14:00, 20:00, alongside the interval), **Welcome tour** (`welcome-tour.js`).

## Saved logs (`logstore.js`)
Every run writes `Logs/<start date>_<start time>.log` (e.g. `Logs/2026-10-10_14-43-12.log`, local time) containing the same lines as the dashboard's log panes, one per line with `date time [category/sub]`. Settings in Settings > Plugins > ScapeLite Core: **Save Logs to Files** and **Keep Logs For (days)** (stored in `overlay/log-config.json`); older files are deleted automatically, and only files matching the timestamp name are ever touched. `Logs/` is git-ignored.
