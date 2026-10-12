# ScapeLite first-release checklist

Decisions and chores to finish before the first public release. Items marked **(owner)** need a decision or an account from the project owner.

## Decisions / accounts (owner)
- [ ] **Where downloads are hosted.** Needs a public URL that does not trace back to a personal account. Recommended: a new anonymous GitHub org/account (separate email) using GitHub Releases, plus the static website on Cloudflare Pages / GitHub Pages.
- [ ] **Update feed for installed copies.** A small version file at a public URL (`{"version","notes","downloadUrl"}`); then set it as the default `manifestUrl` in `overlay/updater.js` / ship it in the installer, and point the website download button at the installer.
- [ ] **Code signing.** Installer is currently unsigned (Windows SmartScreen will say "unknown publisher"). Decide: release unsigned first for feedback, or buy a certificate.
- [ ] **Public identity.** Final project name/domain (e.g. scapelite.gg), a feedback channel (issues page or Discord server) and the links to put in `overlay/authors.local.json`.
- [ ] **Licence.** Pick one (e.g. MIT) and add `LICENSE`; keep Electron/Chromium notices (they ship in the installer).

## Privacy / repo hygiene
- [ ] Before the repo (or any release) goes public: git history still contains the commit author name/email. Publish from a **fresh repo** (or rewrite history) with a noreply identity.
- [ ] Scrub anything personal from docs/website/catalog (grep for the GitHub username, real name, Discord).
- [ ] Confirm no webhook URLs / tokens / config files are in the repo or the installer (the build excludes per-user files; re-check the installer contents).

## Security
- [ ] **Drop `--remote-allow-origins=*`** from the launch flags (the watcher connects from Node, which sends no Origin header, so it is probably unnecessary). With `*`, any web page in the user's browser could open a WebSocket to the game's debugging port. Test with the flag removed in `overlay/launcher.js` (`FLAGS`) and the README/INSTALL text.
- [ ] Consider a random free debugging port instead of fixed 9222 (also avoids clashes with other Chromium apps).

## Product / testing
- [ ] **Run the installer on a clean machine / Windows account**: install, first run, tray, launch game, game guard (start game from Steam without flags), update flow, "Start with Windows", uninstall (should remove autostart; keep or offer to delete `%APPDATA%\ScapeLite`).
- [ ] Installed-app **updater**: manifest mode default + verify "Check for updates" and the download link.
- [ ] First-run onboarding when Steam/Scapewatch is not found (non-Steam install, library on another drive) - clear message + manual path option.
- [ ] Friendlier Discord relay setup (currently needs a config file for channels/roles/member list; webhook URLs can already be entered in-game).
- [ ] "Open logs folder" button in the app menu; mention the `Logs` folder in support instructions.
- [ ] CHANGELOG.md + release notes for 0.3.0.
- [ ] Marketplace screenshots for the plugins that have none (XP tracker, notification dock, fuse, etc.).
- [ ] **Active-users counter** (status-light tooltip + website): needs a tiny hosted counter endpoint first (e.g. a free serverless function: `POST /ping` with a random install id, `GET /count` = distinct ids in the last ~5 min). Design: strictly **opt-in** (asked once in the welcome tour, toggle in Settings > Plugins; the FAQ and tour currently promise nothing leaves the PC), random id only, no IP/name/game data stored, no ping when off. Client side is small once the endpoint URL exists (`app-info.json` `statsUrl`). Show "N players online" only when the count is >= ~5 so a tiny number does not look sad.
- [ ] Website: real download button, install page matching the installer, FAQ checked.

## Known gaps (fine for a first release, label as such)
- Goal Planner is written but not wired up (not shipped in the catalog yet).
- Custom "X happens -> do Y" notification rules not built.
- Windows only.
- Group-resize does not include the menu dock; no update source for community plugins.
