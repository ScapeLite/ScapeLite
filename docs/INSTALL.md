# Installing ScapeLite (Windows)

## The easy way (installer)

1. Download **ScapeLite Setup** and run it. It installs for your user only (no admin rights needed) and starts ScapeLite.
2. ScapeLite finds your Steam copy of Scapewatch by itself, reads the game data it needs, and shows a tray icon.
3. Press **Launch Scapewatch** in the ScapeLite window (or just start the game from Steam: ScapeLite notices and restarts it once with the connection it needs).
4. Take the welcome tour, then add plugins from the marketplace.

Your settings, logs and extracted game data live in `%APPDATA%\ScapeLite`, so updates and reinstalls never touch them. The sections below are for running ScapeLite from source.

---

About 10 minutes. You need the game installed through Steam.

## 1. Prerequisites

- **Scapewatch: Idle MMO** installed via Steam.
- **Node.js 22 or newer** — https://nodejs.org (ScapeLite uses Node's built-in WebSocket). Check with `node -v`.
- **Git** (optional, only to clone). Without it, download the repo as a ZIP and unzip it.

## 2. Get ScapeLite

```bash
git clone <your ScapeLite repo URL> scapelite
cd scapelite
npm install
```

## 3. Game data (automatic)

ScapeLite needs the game's reference data (items, quests, mobs, raids, constants, icons). It reads them straight from your own Scapewatch install the first time it starts, and again whenever the game updates. There is nothing to run. (`npm run extract-data` forces a refresh; the dashboard has a *Refresh game data* button too.)

## 4. Let ScapeLite talk to the game

In Steam: right-click **Scapewatch Idle MMO → Properties → General → Launch Options**, and paste:

```
--remote-debugging-port=9222 --remote-allow-origins=*
```

This opens Chromium's debugging port on **your own machine** (localhost only) so ScapeLite can attach. Don't forward port 9222 to the internet.

## 5. Start it

```bash
npm start
```

This starts the **supervisor** and the dashboard at http://scapelite.localhost/ (or http://localhost:7777 if port 80 is taken). Then launch the game from Steam. Within a few seconds the dashboard shows *Connected* and the plugins load into the game.

**Run at login (optional):** press `Win+R`, type `shell:startup`, and put a shortcut to `overlay\start-watcher-hidden.vbs` in that folder. It starts ScapeLite silently and waits for the game. (It expects Node at `C:\Program Files\nodejs\node.exe`; edit the `.vbs` if yours differs.)

## 6. Choose your plugins

Open the marketplace at **http://scapelite.localhost/marketplace**: search, read, press **Add** / **Remove**. Changes apply to the running game instantly.
Inside the game, **Settings → Plugins** has a switch and options for each feature, and the **Settings** header now has quick-jump menus when you hover a category.

## Optional: Discord relay

1. In Discord: *Channel settings → Integrations → Webhooks → New Webhook → Copy URL*.
2. Copy `overlay/chat-relay-config.example.json` to `overlay/chat-relay-config.json` and paste the webhook URL (and role IDs if you want pings).
3. Add the **Chat Relay** plugin in the marketplace. See `overlay/README.md` ("Chat → Discord relay") for every option. The config files are git-ignored: webhook URLs are secrets, never commit them.

## Troubleshooting

- **Dashboard says "Waiting for the game"** — the launch option is missing or the game was started before you saved it. Fully close and relaunch Scapewatch.
- **`WebSocket is not defined`** — Node is older than 22. Update Node.
- **Port 7777 / 80 in use** — port 80 is optional; 7777 is the one that matters. Close whatever uses 7777.
- **Plugins don't show up after a game reload** — they re-inject automatically; if not, press *Restart* on the dashboard.
- **Logs** — `overlay/watcher.log`, or the log panels on the dashboard.

## Updating ScapeLite

```bash
git pull
npm install
```

then press *Restart* on the dashboard (or restart `npm start`).
