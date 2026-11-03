# ScapeLite roadmap and checklist

One place for what is done, what is in progress and what is only an idea, per area of the project. Local project management only: it never touches the game, and it is not shipped in the installer.

- **Page:** `http://localhost:7777/roadmap` (served by the dashboard; link in the dashboard header). Without the dashboard: `npm run roadmap-server`, then `http://localhost:7791/roadmap`.
- **Data:** `roadmap/roadmap.json` (committed, human readable, stable ids such as `feat-012`). The page, the CLI and the API all use the same store (`roadmap/store.js`).
- **Restart note:** the dashboard is served by the supervisor, so after pulling this tool restart the supervisor once to mount `/roadmap`.

## Concepts

| Thing | Meaning |
|---|---|
| Area (tab) | `feat` ScapeLite Features, `web` Website, `repo` Repo & Releases, `lab` Design Lab & Tools, `log` Logging & Data, `adv` Game knowledge & Advisors |
| Ideas (Inbox) | `status: idea`. Proposals from a subagent, an audit, a research note or the user. Not a commitment. Each has a `source` label such as `subagent: gap research`, `user`, `audit`, `release checklist`. |
| Confirmed work | `planned` (Planned), `doing` (Doing now), `done` (Done). Progress bars count these only. |
| Won't do | `wontdo` with a `reason`. Kept so the same idea is not proposed again. |
| Milestone | Optional version (`0.4.0`, `0.5.0`). Progress per milestone on the Overview tab. |
| Public flag | `public: true` puts a done/planned/doing item on the **Public roadmap** tab and in the export. Only title, `summary`, version, area and status are exported (never notes, links or tags). |

Item fields: `id, title, notes (markdown-lite), area, status, priority (P1-P3), effort (S/M/L), tags, source, created, updated, done, links (file paths, commits, urls), public, milestone, summary, reason`. The order of items in the file is the order inside each list (drag to reorder).

## Using the page

- Add: the quick-add box (`n` or `+`, Enter adds; tail words `#tag`, `!1`/`!2`/`!3` for priority, `@planned`, `@doing`, `@done` for the list), the `+` under each list, or the round button on a phone.
- Move: drag a card onto another list, between cards, or onto another area tab (hover a tab for a moment to switch to it; drop on **Public roadmap** to publish). Or use the buttons on the card: Plan, Start, Done, Ideas, Won't do (asks for a reason). Keyboard: focus a card, then `p` plan, `s` start, `d` done, `i` ideas, `w` won't do, `e` rename, `Enter` details, `x` select, arrows move, `Alt+Up/Down` reorder, `?` shows all keys.
- Bulk: tick cards (or `Select` on a list, or Ctrl-click) and use the bar at the bottom: move to a list, area, priority, milestone, public.
- Search `/`, filters (priority, tag, source, milestone), sort, undo/redo (`Ctrl+Z`), import/export JSON and saved versions in the `...` menu.
- **What changed** tab: done items grouped by version or date, copy as markdown for release notes.
- **Public roadmap** tab: what players would see. `Export` writes `roadmap/public/roadmap.json` and `roadmap/public/roadmap.html` (a static page with inline CSS, ready for the website).
- Changes save by themselves (the corner shows Saving / Saved). Another writer (the CLI, another tab) is picked up within 5 seconds; a stale save is rejected with "changed elsewhere" instead of overwriting.

## For Claude and subagents: update it as part of the work

Use the CLI from the repo root (no server needed, same atomic writes):

```
npm run roadmap -- help
npm run roadmap -- list adv                      # open items of an area (add --status done to see finished ones)
npm run roadmap -- add "Short clear title" --area feat --source "subagent: gap research" --tag chat --p P3 --e S --notes "why, evidence" --link docs/FEATURE-GAPS.md
npm run roadmap -- start feat-004                # moves to Doing now
npm run roadmap -- done feat-004 --milestone 0.4.0
npm run roadmap -- plan feat-009                 # idea -> Planned (only when the user approved)
npm run roadmap -- wontdo feat-010 --reason "needs a write to the game"
npm run roadmap -- set feat-004 priority=P1 tags=chat,ui public=true summary="One line for players"
npm run roadmap -- note feat-004 "tested live on 2026-10-22: ok"
npm run roadmap -- changelog --milestone 0.4.0   # markdown release notes from done items
npm run roadmap -- export                        # public roadmap files
```

Rules:

1. **Start work:** `start <id>` (or `add ... --status doing` for new work). **Finish:** `done <id>`. Discovered something while working: `add` it.
2. **A subagent's or audit's suggestion goes to IDEAS** (`add` without `--status`, with `--source "subagent: <topic>"`). Never put it in planned or doing; the user promotes it.
3. Ids can be the full id (`feat-004`), the number if unique, or a unique piece of the title. Prefer ids.
4. Titles short and clear (under about 70 characters); details go in `--notes`. No names, handles or Discord/real-person details anywhere in this file.
5. Do not edit `roadmap.json` by hand while the page is open unless you reload it afterwards; if you must, keep valid JSON and unique ids (a damaged file is never saved over: the store falls back to the newest history copy).

HTTP API (used by the page; same-site requests only, writes need the header `x-cc-control: 1`):

| Call | What |
|---|---|
| `GET /api/roadmap` | the whole document `{rev, areas, milestones, counters, items}` |
| `PUT /api/roadmap` | save the whole document; its `rev` must equal the file's, else `409 {error:"conflict"}`; response `{ok, rev}` |
| `GET /api/roadmap/history`, `POST /api/roadmap/restore {file}` | saved versions, restore one as a new version |
| `POST /api/roadmap/export` | write `roadmap/public/` |
| `GET /api/roadmap/changelog?milestone=&by=date` | release notes as markdown |

## Safety

Writes go to a temp file, are flushed and then renamed over `roadmap.json`; an empty or invalid document is refused. The previous version is copied to `roadmap/history/` (git-ignored) before a save, at most one copy per 2 minutes, newest 20 kept. A damaged `roadmap.json` is read from the newest history copy. Restore from the page menu (`Saved versions`).
