# Packaging: what ships, what never ships

Rule of the house: **the installer holds product files only. Everything a person sets, receives or generates (webhooks, member lists, filters, roles, state, logs, caches, backups, locks) lives in the per-user folder and is created at run time, from hollow templates.** "Wulf" stands for the owner; nothing in this file is a secret.

Three mechanisms enforce it, each of which works without the others:

1. **Allow-list**: `build.files` in `package.json` starts with `!**/*` and then names product files one by one. A new file in the working tree is NOT packed until someone adds it on purpose.
2. **Hollow templates**: every config that can hold user data ships only as `overlay/<name>.example.json` with empty values; the app creates the real file in the per-user folder on first run and never overwrites it.
3. **Guard**: `scripts/lib/package-guard.js`, run by the `afterPack` hook (a hit fails the build before an installer exists), by `npm run verify:package`, and by `scripts/publish-release.js` (a hit aborts the publish).

## Where things live

| | Source checkout (`npm start`) | Installed app |
| --- | --- | --- |
| Program (read only) | the repo | `<install dir>\resources\app` |
| Per-user folder = `paths.state()` | `overlay\` (next to the code, git-ignored) | `%APPDATA%\ScapeLite` (`SCAPELITE_HOME`) |
| Game data extracted from the Steam install | `data\raw`, `public\assets\icons` | `%APPDATA%\ScapeLite\data\raw`, `...\assets\icons` |
| Logs | `Logs\` | `%APPDATA%\ScapeLite\Logs` |

`overlay/paths.js` decides. When the code runs from `...\resources\app` (an installed copy) and `SCAPELITE_HOME` is missing, it defaults to `%APPDATA%\ScapeLite`; it never falls back to the program folder for user data. A source checkout never reads anything from a package.

## Inventory of files the program reads or writes

Legend: **kind** = P product / U user-specific / S secret / R runtime or generated. "In installer" is what the allow-list does today.

| Path (checkout / per-user folder) | Kind | Lives | In git | In installer | How it is created |
| --- | --- | --- | --- | --- | --- |
| `overlay/*.js`, `overlay/logging/*.js`, `app/main.js` | P code | program | yes | yes | source |
| `overlay/catalog.json`, `community.json`, `app-info.json` | P catalog | program | yes | yes | source |
| `overlay/catalog-img/*.png`, `overlay/scapewatch-icon*.png`, `branding/**` | P images | program | yes | yes | source |
| `website/**` (served locally at `/site`), `docs/PLUGINS.md`, `SUBMIT-A-PLUGIN.md`, `PLUGIN-AUTHOR-GUIDE.md` (served at `/docs/..`), `examples/plugins/**` | P | program | yes | yes | source |
| `overlay/chat-relay-config.example.json`, `digest-`, `clan-hiscores-`, `raid-summary-`, `clan-board-config.example.json` | P hollow templates | program | yes | yes | source; empty values, every feature off |
| `overlay/chat-relay-config.json` | S webhooks (clan, global, role selector), U ping roles, keywords | per-user | no | **never** | first run from the template; edited by Plugins tab |
| `overlay/clan-hiscores-config.json` | S webhook, U clan tag, member list | per-user | no | never | first run; Plugins tab; the member list also syncs from the game roster |
| `overlay/raid-summary-config.json`, `digest-config.json`, `clan-board-config.json` | S webhook, U thresholds/times | per-user | no | never | first run; Plugins tab |
| `overlay/plugins-config.json` | U which plugins are off, which community plugins were seen | per-user | no | never | first run (catalog defaults); every toggle |
| `overlay/log-config.json`, `launch-config.json`, `update-config.json`, `local-config.json`, `authors.local.json` | U preferences / dev switches / contact links | per-user | no | never | created when the user sets it (no file = defaults) |
| `overlay/discord-test-webhook.json` | S owner's private TEST webhook | checkout only | no | never | by hand, tests only |
| `release.local.json` | S SSH key path, scrub terms, publish identity | checkout only | no | never | by hand (`release.local.example.json`) |
| `State/chat-relay-seen.json`, `overlay/chat-relay-outbox.json` | R chat text of other players, event ids | per-user | no | never | written by the relay |
| `State/clan-hiscores-state.json`, `State/digest-state.json`, `clan-board-state.json`, `raid-summary-pending.json`, `clan-board-levels.json` (legacy) | R member names, ranks, message ids | per-user | no | never | written by the features |
| `overlay/player-icon-cache.json` | R avatars of named players | per-user | no | never | written by the relay |
| `*.bak`, `*.corrupt`, `*.tmp` next to any of the above | R safe-json backups and half-written files | per-user | no | never | `safe-json.js` |
| `overlay/supervisor.lock`, `watcher.lock` (`*.lock`) | R process locks | per-user | no | never | `single-instance.js` |
| `overlay/watcher.log`, `Logs/**` | R logs with player names | per-user | no | never | logger |
| `overlay/plugins/**` | U community plugins the user installed | per-user | no | never | marketplace install |
| `data/raw/**`, `public/assets/icons/**` | R extracted from the user's own game | per-user | no | never | `gamedata.js` on first run with the game installed |
| `data/profile.json` | U planner profile | checkout only | no | never | planner |
| `roadmap/**`, `notes/**`, `design-lab/**`, `graphify-out/**`, `scripts/**`, `src/**`, `public/**` (planner), `docs/*` except the three guides | dev | checkout only | mostly yes | never | n/a |
| `dist/**`, `node_modules/**`, `Logs/**`, `nul`, stray screenshots | R / junk | checkout only | no | never | n/a |
| Browser side (the game page's localStorage: `cc-*` keys, layouts, Task Log, chat history) | U | the game's own profile | n/a | n/a | the plugins |

## Per folder decisions (evidence = what the installed app needs at run time)

* `app/main.js`: the Electron entry (`package.json` `main`). It spawns `overlay/supervisor.js` and shows `branding/png/logo-256.png`. Ships.
* `overlay/*.js`: loaded by the supervisor, watcher and injected into the game page (`panel-resize-watcher.js` reads each plugin script from its own folder). Ships; **all** of them, because plugin scripts are read by path, not by `require`, so the guard cannot infer them. `overlay/logging/` is required by `logstore.js`. Ships.
* `overlay/catalog.json`, `community.json`, `app-info.json`, `catalog-img/`: the marketplace and the Plugins tab. Ships.
* `overlay/*.example.json`: the first-run templates. Ships, except `authors.local.example.json` and `local-config.example.json` (developer templates, not read by the app).
* `overlay/start-watcher-hidden.vbs`, `overlay/README.md`: checkout conveniences (the VBS hard-codes `C:\Program Files\nodejs\node.exe`); an installed app is started by the tray. Dropped.
* `branding/`: logos used by the tray, `clan-board-sync.js` (card icon) and the dashboard (`/logo-lockup.svg`). Ships (44 KB).
* `website/`: `status-server.js` serves it locally (`/site`). Ships (2.8 MB).
* `docs/`: only the three Markdown guides that `docs-page.js` whitelists. Everything else (research, risk register, roadmap) stays out.
* `examples/plugins/`: the sample plugin the marketplace "Build" tab points to. Ships. The loose `examples/*.js` are planner samples. Dropped.
* `node_modules/`: **nothing**. `app/` and `overlay/` only use Node built-ins and `electron`; `express` is used by the planner (`src/server.js`) alone. Dropping it removes the whole third-party tree from the installer, and the guard proves the claim: it fails when a `require()` in `app/` or `overlay/` cannot be resolved inside the package (the two dev servers `design-lab/serve` and `roadmap/server` are `try`-wrapped and exempt).
* `src/`, `public/`, `data/`, `scripts/`, `roadmap/`, `design-lab/`, `notes/`, `graphify-out/`: not needed at run time. Dropped. (`data/raw` and the icons are extracted per user.)

## Hollow templates and first run

`overlay/first-run.js` (`ensureUserConfigs`, called by `overlay/supervisor.js` before anything else):

* creates `<name>.json` in `paths.state()` from `<name>.example.json` for chat-relay, digest, clan-hiscores, raid-summary and clan-board, and a `plugins-config.json` equal to the catalog defaults (what the code assumed when the file was missing);
* uses an exclusive create (`wx`): an existing file is never touched, not even an empty or broken one;
* refuses a template that is not hollow (a webhook URL, a non-empty `members`/`pingRoles`/`clanTag`/`roleId`, a role mention), so a maintainer pasting a real value into an example cannot spread it;
* never throws; the supervisor logs what it created.

Template contents: `enabled: false`, `webhookUrl: ""`, `members: []`, `clanTag: ""`, `pingRoles: []`, `ultraRareKeywords: []`, every ping flag off. Comments about fields belong here and in `docs/DISCORD-FEATURES.md`, not in the JSON.

Behaviour from a hollow config (read in the code, no webhook was ever configured):

| Feature | Hollow state | Where the user sets it |
| --- | --- | --- |
| Chat relay | `configured` is false (needs a webhook on a channel); the post loop skips a channel without `enabled` and `webhookUrl`; the Plugins toggles show Off | Plugins tab: webhook fields, toggles, ping roles (these write into the file; `persistPingRoles` needs the file to exist, which first run guarantees) |
| Clan hiscores | `configured` false while `enabled` false; the poll needs `enabled && webhookUrl && members.length`; the member list fills itself from the game roster once the toggle and webhook are set | Plugins tab |
| Raid summary, Activity digest | skipped unless `enabled && webhookUrl`; a pending raid queue keeps data until a webhook exists | Plugins tab |
| Clan board | `configured` is `!!url`; the dashboard card says "No webhook set" | Plugins tab |
| Dashboard / status light | each feature reads "Off" or "Not configured", never an error | n/a |

## Build a tester package safely

1. Work from a clean tree: `git status` shows nothing you do not mean to ship (private files are git-ignored, but the allow-list protects you even when they are not).
2. `npm run test:package` (59 checks, no network, nothing real is read). `npm run pack` and `npm run dist` run it first.
3. `npm run pack` builds the unpacked app into `dist\win-unpacked` (no installer, nothing uploaded). The `afterPack` hook runs the guard on it; a hit fails the build and prints files and rule classes, never the secret.
4. `npm run verify:package` re-runs the guard on `dist\win-unpacked` (or `node scripts\verify-package.js <dir>`); `node scripts\verify-package.js --source` checks the committed tree the way the publish script does.
5. `npm run dist` builds the NSIS installer (same hook). It never publishes; publishing is `node scripts/publish-release.js` (which scans the files first) or the tag-triggered workflow.
6. Install it on a clean Windows account and open `%APPDATA%\ScapeLite`: it should hold the six hollow files, `Logs\`, `data\` and nothing with a webhook in it.

The personal-name deny-list is never in the repo. Provide it with `SCAPELITE_DENY_TERMS=a,b`, a file named by `SCAPELITE_DENY_FILE` or `%USERPROFILE%\.scapelite-deny.txt` (one term per line, `#` comments), or `scrubTerms` in the git-ignored `release.local.json`. The guard also derives the OS user name and the git `user.name` / `user.email` at run time. Terms shorter than four letters and generic words are ignored; a term matches as a whole word only.

## What the guard checks

| Class | Package mode (built app) | Source mode (publish) |
| --- | --- | --- |
| Allow-list: top-level entries, `docs/`, every other path must match a product pattern | yes | no |
| Forbidden names: `*-config.json`, `*-state.json`, relay `-seen/-outbox/-pending/-levels`, `*webhook*`, `*.local.json`, `player-icon-cache.json`, `.bak .tmp .lock .log .corrupt .orig .rej`, reserved Windows names (`nul`), `.env`, keys and certificates, `release.local.json` | yes | yes |
| Dev or runtime folders (`Logs`, `roadmap`, `notes`, `design-lab`, `graphify-out`, `dist`, `.git*`, `.claude`, `scripts`, `data/raw`, `public/assets`), stray `tray*.png` | yes | no |
| Discord webhook URL (inside `node_modules` too), bot-token-like string, long random value next to `token / webhook / secret / password / apiKey / authorization / bearer`, real-looking `C:\Users\<name>` (raw, escaped or `/`) | yes | yes |
| Bundled `*config*/*state*/*example*/*settings*.json` with a non-empty `members`, `pingRoles`, `clanTag`, `roleId`, anything with `webhook` in the key, role mention | yes | yes |
| Personal-name deny-list | yes | yes |
| Oversized file (over 1.5 MB), package over 30 MB outside `node_modules` | yes | no |
| `require()` target missing from the package (the allow-list is not tighter than the code) | yes | no |
| Inside an `app.asar` | extracted to a temp folder with `@electron/asar`, then the same checks | n/a |

Placeholders (`<you>`, `alice`, `XXXX` webhooks, `example.com`) are accepted on purpose. `scripts/test-package.js` plants every class (assembled at run time from obviously fake fragments: id of zeros, `TOKEN-PLACEHOLDER`) and checks that a clean tree passes, that the fragments are not echoed in the report, and that the shipped templates, first run and the installed-path rule behave.

## Checklist: adding a new config or state file

1. Pick the name `<feature>-config.json` (user settings) or `<feature>-state.json` (runtime state). The `.gitignore` patterns, the guard's name rules and the `build.files` denies already cover those suffixes. A different name needs a rule in all three places.
2. Resolve it with `require('./paths').state(name)`. Never `path.join(__dirname, ...)` for anything the user or the program writes.
3. Treat "missing file" as the normal case: defaults in code, the feature off. Write with `safe-json.js` (`writeJsonAtomic`).
4. If the file can hold a secret or a person's data, ship a hollow `<feature>-config.example.json` (empty strings, empty arrays, `enabled: false`) and add the name to `TEMPLATES` in `overlay/first-run.js`. Add the field to `SECRET_FIELDS` in the watcher if a webhook is typed in the Plugins tab.
5. Do not add the real file, the example's real values, or a log of its contents anywhere in git, docs or tests. Tests plant fakes assembled at run time.
6. Add the file to the inventory table above, run `npm run test:package`, then `npm run pack`.
7. A new product file (code, image, data) under an existing allow-listed folder needs nothing; a new folder needs an entry in `build.files`, in `ALLOW` / `TOP_ALLOWED` in `scripts/lib/package-guard.js`, and a line in the folder decisions above.
