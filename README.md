<p align="center"><img src="branding/logo-lockup.svg" alt="ScapeLite" width="360"></p>

# ScapeLite

A plugin-based overlay and planner for **[Scapewatch: Idle MMO](https://store.steampowered.com/)** — think *RuneLite*, but for Scapewatch.
Pick the plugins you want from a built-in **plugin marketplace**; everything else stays out of your way.

> **Display-only, always.** ScapeLite changes how the game *looks* and *tells you things*. It never clicks, selects, submits or plays for you.

## What you get

| Plugin | What it does |
| --- | --- |
| **Panel Tools** | Resize/scale every panel from a corner grip, lock panels, right-click title menu, vertical bottom-right menu, inventory `(used/total)` counter |
| **Panel Fuse** | Snap side-by-side panels together; they move and resize as one |
| **Route Advisor** | Best order for your task queue **with and without teleports**; objectives (steps, XP/hr, tasks/hr, quests), map preview, colour-coded cards |
| **Hover Info** | XP, gold, slay-XP and quest details on tooltips |
| **XP/hr Tracker** | Live XP per hour and level-up ETA |
| **Walking Countdown** | Real ETA from your measured speed |
| **Map Route Lanes** | Readable overlapping routes on the World Map |
| **Side Menu Controls** | Show/hide/pin icons in the left side menu |
| **Settings Quick-Jump** | Hover a Settings category to jump to its sub-sections |
| **Chat Relay (Discord)** | Clan/global drops, unlocks and level-ups to your Discord, never lost across restarts |
| *…and more* | Browse them all in the marketplace |

## Quick start

```bash
git clone <this repo>
cd scapelite
npm install

npm start                # starts the supervisor + dashboard
```

Then add `--remote-debugging-port=9222 --remote-allow-origins=*` to Scapewatch's Steam launch options and start the game.
**Full, step-by-step guide: [docs/INSTALL.md](docs/INSTALL.md).**

## The plugin marketplace

Open **http://scapelite.localhost/marketplace** (or *Plugins ▸* on the dashboard; `http://localhost:7777` also works).
Browse by category, search features/tags, read the description and screenshots, and press **Add** — the plugin is injected into the running game immediately, no reload. **Remove** tears it down again. A fresh install only turns on the recommended set; the rest is opt-in.

Anyone can write a plugin: drop a folder with a `plugin.json` into `overlay/plugins/` and it shows up in the marketplace. See the **[plugin author guide](docs/PLUGIN-AUTHOR-GUIDE.md)** (and the reference in [docs/PLUGINS.md](docs/PLUGINS.md)).

## How it works (short version)

A small Node supervisor connects to the game over Chromium's local debugging port, injects the enabled plugin scripts into the game page, and serves a local dashboard (`localhost:7777`). Plugins read the game's own state and DOM and draw their own UI. Nothing leaves your machine except what *you* configure (e.g. a Discord webhook).

## Project layout

- `overlay/` — supervisor, watcher, dashboard, marketplace, and all plugin scripts (`catalog.json` describes them)
- `src/`, `public/` — the original offline planner and its web dashboard ([docs/PLANNER.md](docs/PLANNER.md))
- `overlay/gamedata.js` — reads the reference data out of your game install automatically
- `overlay/README.md` — the long, detailed engineering log of every plugin

## Status

Early and moving fast. Goal Planner (what to do next for the fastest progress) is in development.
Not affiliated with the Scapewatch developers; use at your own discretion and keep to the game's rules.

## Website draft
`website/` is a static landing page (hero, features, plugin list from `catalog.json`, download, install steps, FAQ). Run `npm run build-site` to refresh its copies of the logo, catalog and screenshots, then upload the folder to any static host. The download button is a placeholder until the first release exists.
