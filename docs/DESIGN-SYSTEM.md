# ScapeLite design system

Files: `COMPONENTS.css` (the library), `COMPONENTS.md` (exact DOM + JS helpers), `gallery.html` (every component and one mock per surface, `gal_*.png` are screenshots of it), `SURFACES.md`, `MIGRATION.md`.
The Task queue (`notes/queue-panel-design`, built in `overlay/ui-queue.js`) is the reference. Everything here extends it; its `cc-q-*` classes stay as they are.

## 1. Principles

1. **Fixed rows, overlays on top.** A row, cell or module has a fixed height. Trays, popovers, tooltips, menus and sheets are separate surfaces that never push content.
2. **Colour carries meaning, once.** Gold = advisor, selection, the accent. Green = good, skilling, done. Red = combat, bad, far. Blue = quest, info. Purple = boost, teleport, magic. Orange/yellow = caution, medium. Nothing is coloured for decoration. Where colour is the only signal there is a second cue (glyph, sign, text): callouts and toasts carry a glyph, table deltas carry a +/- sign, specials carry a mark after the title, walking pills carry the minutes.
3. **Scale with width, never zoom.** `--s` -> `--u`. Three width classes (full / compact / micro) change the layout. Text never goes under 10.5 px.
4. **One component, several uses.** Kept panel, hover card, collapsed chip, docked panel are the same DOM; `data-mode`, `.min`, `.docked` change only chrome.
5. **Square when docked, 12 px when floating.** The shell comes from the kit.
6. **Calm motion.** Under 250 ms, `cubic-bezier(.2,.8,.2,1)`. Close = opacity only. No flicker on the 1 s refresh: patch text and `--p`, never rebuild under the pointer. Reduced motion respected.
7. **Mouse only, but every interactive thing has hover, pressed, focus-visible and a disabled look.**
8. **ScapeLite never acts in the game by itself.** Display is free; only a click or drag of the player changes the game.
9. **Vanilla.** Plain CSS, no build, no external fonts or images. Game icons 30x30 / 16x16, `image-rendering: pixelated`.

Short version for reviewers: *fixed rows, one meaning per colour, tokens only, three width classes, overlays float.*

## 2. What changed against the kit today (the 10 visible decisions)

| # | Today | New |
|---|---|---|
| 1 | Panel title in gold, header gradient | Title in `--cc-text` 16/700, flat header, one hairline. Gold stays for selection/advisor so it keeps its meaning. |
| 2 | Every list item is a different thing (`.cc-card`, ad hoc divs) | One **row** (`.cc-row`): lane, optional tile, title/sub, meta, optional bar. Same rhythm in Diary, Quests, Friends, Barter, Goals, Materials, Alerts. |
| 3 | Tabs, chips and segmented buttons all look like pills | `chip` = filter/toggle, `tab` = underline for views, `seg` = one-of-N control. Three shapes, three jobs. |
| 4 | Menus differ per plugin | One `menu` (checks, partial dash, submenu, slider, heading, count, danger) used by bar, bell, panel, launcher. |
| 5 | Progress bars are all green or yellow | `prog` takes a tone; skills use value tones (red < 25 %, orange < 50 %, blue < 85 %, green), diary and quests keep their own tone. A bright green segment shows queued XP. |
| 6 | Numbers only coloured | Every delta carries a sign; colour is the second cue. |
| 7 | No shared "settings" look | `cc-set` rows + `cc-sheet` for panel-internal settings. |
| 8 | Tooltips differ | One `cc-tip` that follows the pointer (as the queue). |
| 9 | Bar modules are flat text | Module has idle, hover, pressed, active, attention dot, tone, drop target, highlight; panel buttons are pills. |
| 10 | `--cc-text-faint` 3.9:1 | `#7c7c93`, 4.7:1 on `--cc-bg`. |

## 3. Tokens

All tokens are CSS variables on `:root`. Components use tokens only. Palette (default / game / colour-blind), accent and density are applied by the kit by overwriting these variables, so components follow automatically.

### 3.1 Colour roles
| Role | Token | Default | Use |
|---|---|---|---|
| Surface 0 | `--cc-bg` | `#10101a` | panel, bar, page |
| Surface 1 | `--cc-bg-2` | `#161620` | menu, tray, tooltip-ish overlays, stat tiles |
| Surface 2 | `--cc-bg-3` | `#1c1c28` | rows, cells, chips |
| Hover | `--cc-bg-hover` | `#262636` | hover on any of the above |
| Sunk | `--cc-sunk` (new) | `#0a0a12` | wells: progress track, graph frame, inputs, segmented |
| Hairline / strong | `--cc-border` / `--cc-border-strong` | `#2e2e42` / `#4a4a62` | dividers / edges of overlays |
| Text | `--cc-text` / `-dim` / `-faint` | `#dcdce8` / `#8f8fa4` / `#7c7c93` | primary / secondary / tertiary (faint: non-essential only) |
| Accent | `--cc-accent`, `-bg`, `-ink` | `#ffd24a`, `#2a2518`, `#241a00` | advisor, selection, primary button; `-ink` = text on accent |
| Tones | `--cc-good --cc-warn --cc-bad --cc-info --cc-magic` | `#5fe06d #ffb84a #ff8a5c #4aa8ff #b07cff` | see principle 2 |
| Combat | `--cc-q-kill` | `#ee5a5a` | combat lane, combat tier text |
| Walk | `--cc-w1..w4`, `--cc-wt` (rgb triplets) | green, yellow, orange, red, purple | queue pills, `.cc-pill` |
| Scrim | `--cc-scrim` | `rgba(6,6,12,.62)` | behind modals |

**Tone mechanism.** `data-tone="good|warn|bad|info|magic|accent|kill|dim"` on a component (or any ancestor) sets `--t` (the colour) plus `--t-a` (14 % mix, for fills) and `--t-b` (42 % mix, for borders) via `color-mix`. Components read `--t`, so a tone is one attribute and it follows the palette. Requires Chromium 111+ (the game client is Electron; MIGRATION step 0 checks `CSS.supports('color','color-mix(in srgb,red 10%,transparent)')`).

**Role to meaning (do not break):** a quest is always blue, a lucky/advisor/selected thing always gold, a combat thing always red, a teleport always purple. A panel may use `data-tone` only for these meanings or for good/warn/bad outcomes.

### 3.2 Type scale (px at 100%; all multiplied by `--u` in panels)
| Step | Size / weight | Use |
|---|---|---|
| hero | 26 / 700 | the one big number of a surface (XP/hr, gain %) |
| xl | 20 / 700 | stat value, callout title |
| lg | 16 / 700 | panel title |
| base | 14 / 600 | row title, button-panel text |
| sm | 12.5 / 400-600 | body, controls, menu |
| xs | 11.5-12 / 400-500 | sub lines, hints |
| 2xs | 10.5-11 / 700 | tier chips, section headings (uppercase, +.08em), badges. **Floor: 10.5** |

Numbers use `font-variant-numeric: tabular-nums` everywhere they can change. Density (compact / cozy / roomy) shifts base/sm by -1 / 0 / +1 through the kit's `--cc-fs`, `--cc-gap`, `--cc-pad`.

### 3.3 Spacing, radii, elevation, motion
- Spacing scale: 2 4 6 8 10 12 16 24 (`--cc-sp-1..8`). Panel body padding `--cc-pad`, gaps `--cc-gap` (density aware). Row inner padding 6 / 10.
- Radii: `--cc-r-xs` 5 (tier chips), `--cc-r-sm` 8 (rows, cells, inputs 7), `--cc-r` 12 (panels, trays, modal), pill 99 (chips, pills, badges). Menus and popovers use 10.
- Elevation: 1 = `--cc-sh-1` (rows), 2 = `--cc-sh-pop` (menu, popover, tooltip, toast), 3 = `--cc-shadow` (panel, tray, modal). Only overlays have shadows; rows use borders.
- Motion: `--cc-dur-1` 120 ms (hover, press), `--cc-dur-2` 180 ms (enter), exit 140 ms opacity only, progress 900 ms linear, highlight pulse 1.5 s, spinner 800 ms. Easing `--cc-ease-out`. Reduced motion: all to about 0 (spinner and skeleton slow to 2.4 s).

## 4. Scale and width classes

- A **scaled root** has class `cc-s` and a `--s` number (set by `ccScale()` from the element's own width with a `ResizeObserver`; see COMPONENTS.md). `--u = calc(var(--s) * 1px)`; every scaled length is `calc(N * var(--u))`. Outside a `cc-s` root `--u` is 1px, so the same components work in the bar, menus and settings page.
- **Panels** (width in px): full >= 340, `--s = clamp(.9, w/450, 1.5)`; compact 180-339, `--s = clamp(.9, w/300, 1.1)`; micro 90-179, `--s = 1`. The helper writes `data-bp="full|compact|micro"`.
- **Bars** use the screen width: full >= 1100, compact 700-1099, micro < 700 (`data-th="1100,700"`).
- Utility classes inside a `cc-s` root: `.cc-hide-c` (hidden in compact and micro), `.cc-hide-m` (hidden in micro), `.cc-only-m` (shown in micro only).
- **What each class does to the shared components**
  - Header: full = title + sub line + value + buttons; compact = title + value (sub hidden by default); micro = title only (or count chip) + close.
  - Row: full = lane, tile, title, sub, meta; compact = sub line drops or merges into meta; micro = tile + number only (as the queue).
  - Cell grids: `--cols` stays, cells shrink (`--cc-cell-h` 54 -> 34), level numbers stay, the progress bar is dropped in micro.
  - Seg / chips wrap; table columns marked `.cc-hide-c` drop; stat rows `auto-fit`.
  - Chat: channel chips show two-letter codes in compact and micro; the tag and seconds hide.
- Content inside hover cards uses the same rules; a hover card has a fixed width (full).

## 5. State rules (all components)

| State | Rule |
|---|---|
| Default | surface, hairline border |
| Hover | background `--cc-bg-hover` (and `--cc-border-strong` on rows); 120 ms |
| Pressed | background one step darker (`--cc-bg-2` / `#20202d`), buttons move 1 px down |
| Selected | accent ring or fill: `--cc-accent-bg` + accent border/text. Check mark where a shape is needed |
| Focus-visible | 2 px `--cc-info` outline, offset 2. Never removed |
| Disabled | `opacity .45` (rows .5), no pointer events, `aria-disabled` |
| Highlight (advisor) | `.is-hl`: 2 px gold ring + 16 px glow, 1.5 s pulse; only the advisor highlights |
| Attention | gold dot on a module/button (7 px, ringed in `--cc-bg`) |
| Loading | `cc-skel` blocks at the real heights, `cc-spin` + text for computation |
| Empty | `cc-empty`: glyph, title, one line saying what to do |
| Error | `cc-callout[data-tone=bad]` in the body, or a toast; never a coloured panel |
| Locked | dashed border + .55 opacity + reason in the sub line ("Lv 40 needed") |

## 6. Accessibility

- **Contrast** (on `--cc-bg`): text 13.3:1, text-dim 6.0:1, text-faint 4.7:1, accent 13:1, good 11:1, info 7.6:1, warn 11:1, bad 8:1, magic 6.6:1. Dark ink on tone fills (`--cc-accent-ink`). Faint text is for hints only.
- **Colour-blind palette** (kit option, Okabe-Ito): good `#009e73`, warn `#e69f00`, bad `#d55e00`, info `#56b4e9`, magic `#cc79a7`. Additions needed in the kit's colour-blind branch: also set `--cc-q-kill` and `--cc-q-kill-rgb` to `#d55e00` (same as bad; combat is always paired with the "L40" tier text), `--cc-q-skill-rgb` to `0,158,115`, and the walk scale as rgb triplets: w1 `0,158,115`, w2 `240,228,66`, w3 `230,159,0`, w4 `213,94,0`, wt `204,121,167`. Warn (orange) and bad (vermilion) are close in this palette, so the +/-, glyph and text cues are mandatory, not optional. Because the second cue is always there (sign, glyph, text, shape), colour is never the only carrier: good/bad deltas have +/-; callouts, toasts, alerts have an icon glyph; lanes are paired with the tier text ("L40" for combat); the selected option has a check.
- **Reduced motion**: handled in the library (`prefers-reduced-motion`), and `--cc-ease` is 0 in the kit.
- **Keyboard**: not required, but all controls are real `button`/`input`/`select`, so Tab works for free; menus use `role=menu/menuitem` + `aria-checked`; tabs `role=tab` + `aria-selected`; segmented `aria-pressed`.
- **Targets**: minimum 24 px high for any clickable control at 100 % (bars: module height = bar height - 8).

## 7. Component catalogue

Each entry: purpose, anatomy, variants, states, sizes, usage rule. Exact DOM and class names: `COMPONENTS.md`. Live: `gallery.html`.

| Component | Class | Purpose | Variants | Usage rule |
|---|---|---|---|---|
| **Panel shell** | `.cc-panel` (+ `.hd .bd .ft`, `.cc-grip`) | the frame of every kept panel, hover card, chip | `data-mode=hover`, `.min` chip, `.docked`, width classes | one per panel; created by `UI.panel()`; `overflow: visible` so a tab-docked badge can sit on the top edge |
| **Header** | `.hd` (`b`, `.cc-hsub`, `.cc-hval`, `.cc-ib`) | title, one-line summary, one value, icon buttons | with/without sub, with value, hover mode (no buttons) | title never gold; at most one value; buttons 24 px |
| **Chip** | `.cc-chip` | filter / toggle / channel | `.on`, `data-tone`, `.off` (dashed: filter off), `.n` count, disabled | toggles a state; if the choice is exclusive use `seg` |
| **Tab** | `.cc-tabs .cc-tab` | switch the view of a panel | `aria-selected`, `.n` | max one tab row per panel, underline in accent |
| **Segmented control** | `.cc-seg button` | one-of-N setting | `aria-pressed` | 2 to 6 options; wraps in compact |
| **Pill** | `.cc-pill` | short status or value with tone | tones, `small` (secondary), `.solid` | one value per pill; walking pills belong to queue gaps |
| **Badge** | `.cc-badge`, `.cc-tierchip` | count or tier | `.dot`, tones | count badges are red by default (alerts), gold for "new" |
| **Tile** | `.cc-tile` | game icon + tier + marker | `data-k=skill|kill|empty`, `data-p=xp|adv`, `.sm .lg` | exactly the queue's tile |
| **Card row** | `.cc-row` | one fixed-height item: lane + `.lf` + `.ti/.su` + `.mt` + `.pr` | `data-tone` lane, `data-edge`, `.flat` (no lane), `.hov`, `.is-hl`, `.locked`, button | the only list item. Never grows. |
| **Grid cell** | `.cc-grid > .cc-cell` | skills, inventory, equipment | `.empty`, `.sil`, `data-up`, `.dim`, with `.q`, tier chip, prog | `--cols` and `--cc-cell-h` decide the grid |
| **Progress** | `.cc-prog` | any ratio | `.thin .thick`, `data-tone`, queued segment `<u>` | track `--cc-sunk`; one bar per row |
| **Stat row** | `.cc-stats > .cc-stat` | 2 to 4 headline numbers | `.hero`, tone | value 20/26 px, label 11.5 px |
| **Key-value list** | `.cc-kv` | label: value pairs | tone on `dd` | right-aligned values |
| **Table** | `.cc-table` | comparisons | `.num`, `.pos/.neg` signs, sticky header | numbers right, signed deltas |
| **Section heading** | `.cc-sec` | group inside a body | `.n` count/aside | uppercase 11 px with a hairline |
| **Callout** | `.cc-callout` | message in a body | tones, `.big` (headline) | one glyph per tone |
| **Menu** | `.cc-menu`, `.cc-mi`, `.cc-mh`, `.cc-msep`, `.cc-mslider`, `.cc-align` | every menu | checks, `mixed`, submenu, slider, heading, badge, danger, disabled | right-click and button menus; position with `ccPlace` |
| **Popover** | `.cc-pop` | detail of a thing (option, row) | tags as pills | small, 214 px |
| **Tooltip** | `.cc-tip` | hover detail, follows pointer | title, kv, bar | never blocks; max 280 px |
| **Toast** | `.cc-toast` | event notification | tones, action, close | bottom, one at a time per tone |
| **Tray** | `.cc-tray` | generic out-of-panel option tiles | `.is-on` | the queue keeps `cc-q-tray` |
| **Tab-docked badge** | `.cc-tabbadge` | status tab on the top edge of a panel/button | tones, spinner | centred, 50 % wide, min = text |
| **Input controls** | `.cc-btn`, `.cc-in`, `.cc-sel`, `.cc-num`, `.cc-sw`, `.cc-range`, `.cc-field` | all settings | primary/default/quiet/danger/go, invalid | label above or in a `cc-set` row |
| **Settings row / sheet** | `.cc-set`, `.cc-sheet` | options lists | `data-wide` for text fields | sheet slides over a panel body |
| **Empty / skeleton / spinner** | `.cc-empty`, `.cc-skel`, `.cc-spin` | states | | heights match real content |
| **Scrollbar** | `.cc-scroll` | thin scrollbars | | all scrolling bodies |
| **Snap guide** | `.cc-guide .v/.h` | layout editor snapping | | the only 1 px accent line |
| **Drag ghost + insertion** | `.cc-ghost`, `.cc-dragging`, `.cc-ins` | drag and drop | | queue keeps `cc-q-ghost/ins` |
| **Bar + module** | `.cc-ibar`, `.cc-z`, `.cc-mod` | info bars | heights s/m/l, pill buttons, states | see SURFACES 3.1 |
| **Bell + alert** | `.cc-bell`, `.cc-alist`, `.cc-alert`, `.cc-ring`, `.cc-ringtag` | alerts | | see SURFACES 3.5 |
| **Chat parts** | `.cc-msgs .cc-msg`, `.cc-composer`, `.cc-newjump` | chat | `data-hl`, `.x3` | see SURFACES 3.3 |
| **Modal / tour** | `.cc-scrim`, `.cc-modal`, `.cc-dots` | welcome tour, confirm | | one at a time |
| **Layout chrome** | `.cc-frame`, `.cc-lbar` | layout editor | `.sel` | see SURFACES 3.6 |
| **Graph frame** | `.cc-graph`, `.cc-spark` | charts | | svg inside, tokens for strokes |

## 8. Where this is implemented

The CSS and helpers are in `overlay/ui-kit.js`; see `docs/UI-STYLING.md` for how to change a look in one place and how to add a scoped exception, and `docs/COMPONENTS.md` for the DOM of every component. `.cc-card` (the old left-border card) is kept only as a deprecated alias for third-party plugins; use `.cc-row`.
