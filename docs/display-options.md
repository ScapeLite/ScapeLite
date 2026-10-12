# Display options for scapewatch-planner

**Recommendation: build a local web server + browser-tab dashboard (manual-entry, zero-risk). Skip overlays and client injection entirely for now — not as a "later" item, but as something actively not worth building until/unless the devs say live data is fine.**

## Why the RendApp comparison doesn't map cleanly

Rend's value in The Tower comes from reading a *continuous, active* run and surfacing stats while you're staring at the screen making real-time decisions. Scapewatch is a queue-and-walk-away idle game — the natural play loop is "set a task, check back in minutes/hours, requeue." You're not watching the screen continuously, so an always-visible overlay is solving a problem this game mostly doesn't have. The dashboard pattern (open a tab, glance at it when you check in, close it) already matches how people actually play Scapewatch. That changes the comparison a lot: it's not "overlay vs. dashboard" on equal footing, it's "the thing that fits the play pattern vs. the thing that fits a different game's play pattern."

## The options, briefly

| Option | Effort | Glanceable? | Platform fit | Risk |
|---|---|---|---|---|
| **Local server + browser tab** | Low — thin HTTP/JSON wrapper around existing `src/` modules + a plain HTML form/results page | Good enough for check-in cadence; bookmarkable, second-monitor friendly | Works identically for Steam, browser, Android (just a URL) | **Zero** — never touches the game |
| **Desktop overlay (always-on-top)** | High — OS-specific always-on-top behavior, click-through regions, fights with Steam's own overlay and fullscreen/exclusive modes | High glanceability, but for a game you're not watching continuously, not much better than a tab | Steam client mainly; doesn't help browser/Android at all | Zero *if* manual-entry only (no gain over the tab to justify the build cost) |
| **Browser extension / userscript** | Medium | Good, but only for the browser client | **Misses the primary platform** (Steam) entirely unless you inject into the Electron wrapper too | **Higher** — reads the live page/DOM, a different risk category even if read-only (see below) |
| **Discord bot / CLI / spreadsheet export** | Low–medium each | CLI: none (today's actual pain point). Discord bot: fine for sharing with a clan, not for solo glancing. Spreadsheet: good for one-off deep comparisons, not a running companion | N/A | Zero, but doesn't solve the stated problem as directly |

## Why the dashboard wins right now

- The calculation library already does the hard part (`src/combat.js`, `src/skilling.js`, `src/reroll.js`, `src/travel.js` are all plain Node/CommonJS with no external deps, per `Constants.js`). The gap is purely presentation — a thin `http`/Express layer plus a static results page, or even a single self-contained HTML file that requires the existing modules client-side via a bundle, is a small addition, not a new project.
- It directly replaces the actual pain point described: "the only way to see output is `node examples/*.js` and reading console text." A page with input fields and formatted tables/recommendations solves that with the least new surface area.
- It's the one option that's equally good on all three platforms (Steam, browser, Android) *because it never touches any of them* — it's just a URL you open beside the game, on any device, including a phone next to an Android session.
- It carries zero detection/ToS risk, because it's architecturally identical to what's already built: static files + numbers you type in.

## Why overlay and extension/injection are out of scope now

Checked `scapewatch.com/terms-of-service`: the acceptable-use section explicitly prohibits players who "cheat, bot, automate, exploit bugs, or use unauthorized third-party tools to gain an advantage," plus a separate prohibition on reverse-engineering the client. That clause doesn't distinguish "read-only" from "active" tooling — an overlay or extension that reads the live page/WebSocket/DOM is reading the *live client*, which is a different, higher-risk category than parsing static `app.asar` data or typing numbers in by hand, independent of how passive it feels. Combined with Cloudflare bot-management sitting on the domain, anything that scripts or automates interaction with the live page (even just reading it) is the kind of thing that risk category is designed to flag.

On the Electron angle specifically: this project's `data/raw` only contains the extracted `shared/data/*.json` and `Constants.js` — the Steam build's `electron/main.js` and `electron/preload.js` were never pulled, so there's nothing here to inspect for `contextIsolation`/`sandbox` settings, and that's not worth extracting just to answer a question we're not acting on yet. Generically, current Electron defaults (`contextIsolation: true`, `sandbox: true`) make naive preload-based injection hard by design — but the real point is that even confirming it's *possible* doesn't make it a good idea before the devs weigh in. Don't spend effort here until that conversation happens.

## Build order

1. **Now:** local server (or a single bundled HTML file) + browser tab, manual entry, reusing `src/` as-is. This is the actual fix for "I have to read console text."
2. **Next natural step, still zero-risk:** make it a simple installable PWA and persist last-entered stats in local storage, so re-checking is "open the tab" instead of "retype my levels." Also a reasonable stepping stone to an Electron-packaged version of *your own* tool, if a taskbar app is ever preferred over a browser tab.
3. **Conditional, gated on the Discord conversation with the devs:** if and only if they sign off on some form of live-data access, revisit an overlay or extension — at that point the main weakness of the dashboard (manual entry) disappears, and glanceability starts mattering more, particularly during the game's active-combat windows rather than the idle/queue windows. Until that sign-off exists, treat overlay/injection work as explicitly deferred, not merely deprioritized.

Sources checked: [Scapewatch Terms of Service](https://scapewatch.com/terms-of-service/) (acceptable-use clause on bots/automation/unauthorized tools, quoted above).
