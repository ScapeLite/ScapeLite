# ScapeLite UI naming standard

One name for every element, so "the thing at the bottom of the queue" becomes `Queue Panel > Footer`. This is a map only: no code was renamed.
Machine copy of every table below: `design-lab/names.json` (generated from the same list, 619 rows).

## 1. How to name something

**Formula:** `Surface > Region > Component [State]`

- **Surface** = feature name + kind word: `Queue Panel`, `Info Bar`, `Lever Advisor Drawer`, `Alert Bell`, `Welcome Tour`.
- **Region** = a named part of that surface: Header, Body, Footer, Tab Strip, Controls Bar, List, Grip.
- **Component** = the reusable part: Button, Chip, Tile, Row, Progress Bar, Pill, Toggle Switch.
- **State / variant** goes in square brackets after the thing it applies to: `Queue Panel > Card [Current]`, `Button [Primary]`, `Info Bar [Compact]`.
- Stop at the smallest thing that has its own row in section 3. If you need more, give the nearest listed name and say the rest in words.
- **Id** (stable, unique) = every segment in kebab-case, dots between levels: `queue-panel.card.tile`.
- **Path** is what you type or say: segments joined with ` > `.

**Game versus ScapeLite.** Anything the game draws starts with `Game` (`Game Tasks Panel`, `Game Window`, `Game Chat Panel`). No prefix means ScapeLite drew it. For a ScapeLite part inside a game window, start with the game window: `Settings Window > Plugins Page > Section > Info Bars`; the `Skills Customization Window` hosts the `Lever Advisor Drawer`.

**Worked examples**

| You see | Say | Id |
|---|---|---|
| The small icon with a coloured outline on a queued task | `Queue Panel > Card > Tile` | `queue-panel.card.tile` |
| The "Skilling / Slay" switch under the queue title | `Queue Panel > Controls Bar > Lane Switch` | `queue-panel.controls-bar.lane-switch` |
| The gold pill saying "Best: +4% lv/hr" | `Route Advisor Panel > Header > Best Pill` | `route-advisor-panel.header.best-pill` |
| The pop-out with the alternatives next to a task | `Queue Options Tray > Option Tile` | `queue-options-tray.option-tile` |
| The running task card | `Queue Panel > Card [Current]` | `queue-panel.card` + state `states-and-variants: card.current` |
| The cogwheel of any panel | `Panel > Header > Gear Button` | `panel.header.gear-button` |

**Rules**
1. One name = one element. If two things share a name in the code, the tables give them different names.
2. Say the **Title Case name**, never the code class. The alias column lists code names only so you can search them.
3. A generic row (`Panel > Header`) applies to every panel; name the specific one (`Goals Panel > Section Heading`) when it matters.
4. Never-call-it words: "window" for a ScapeLite Panel, "popup" for any of Menu / Tooltip / Popover / Toast, "tab" for a filter Chip, "menu" for a Tray, "card" for a Pinned Card when you mean the list Card, "grip" for a move strip, "bar" for a Progress Bar when you mean the Info Bar, "queue" alone (say Queue Panel or Game Tasks Panel).

## 2. Glossary of kinds (the first rule that fits decides the kind)

| # | Kind | Rule that decides it | One line |
|---|---|---|---|
| 1 | **Game ...** | Drawn by the game (no cc- class) | Prefix `Game`. A full-screen modal page is a **Window**; a draggable game box is a Game Floating Panel. |
| 2 | **Modal** | Dims the game and waits for an answer | Welcome Tour, confirm. Game modals are Windows, not Modals. |
| 3 | **Bar** | Owns a screen edge for good | Info Bar (top/bottom). |
| 4 | **Drawer** | Slides out of an edge of another surface and stays attached | Lever, Tree and Route map drawers, Walking Countdown Drawer. |
| 5 | **Menu** | A list of actions or choices | Context menu, dropdown, Logo Menu, Settings Quick-Jump Menu. |
| 6 | **Tooltip** | Text near the pointer; the pointer never enters | One shared Tooltip; extras appended to Game Tooltips. |
| 6b | **Popover** | Anchored detail box for one thing | Queue Option Popover. |
| 6c | **Hover Card** | Opens on hover, but the pointer may enter and use it | Info Bar Hover Card, Queue Hover Card. |
| 7 | **Tray** | Short strip of option tiles popping out beside something | Queue Options Tray. |
| 8 | **Toast / Alert** | Appears by itself to tell you something | Toast, Raid Lobby Toast, Alert Bell + list, Alert Ring + Tag, Route Advisor Badge. |
| 9 | **Dock / Handle / Grip** | A control whose only job is to move, resize or tuck away something else | Handle moves, Grip resizes (corner), Seam is where two panels touch. |
| 10 | **Overlay** | Drawn on the game's own pictures with no box of its own | Combat Readout, outlines, craft potential bar, bank separators. |
| 11 | **Widget** | One small floating thing, one job, no body | Status Indicator, Walking Countdown, XP Chip, Logo Button. |
| 12 | **Panel** | Titled, draggable box with a body | Queue Panel, Goals Panel. Collapsed it is a Chip. |
| 13 | **Card / Row** | An item inside a list | **Card** = framed main object (task card, plan card, pet card). **Row** = plain fixed-height line (`.cc-row`). A **Pinned Card** is a kept Panel born from a Hover Card. |

Regions: **Header, Body, Footer, Tab Strip, Sub-tab, Section Heading, Handle** (moves), **Grip** (resizes, corner), **Seam** (touching edge of two panels), **Gutter** (gap between items), **Edge** (screen edge reserved by a Bar).
Components: Button, Icon Button, Chip, Tab, Segmented Control, Pill, Badge, Tile, Row, Cell, Progress Bar, Stat, Key-Value List, Table, Callout, Toggle Switch, Slider, Input, Select, Menu Item, Sparkline, Skeleton, Spinner, Empty State.
States: hover, pressed, selected, focus, disabled, locked, highlighted, attention, tone (good / warn / bad / info / magic / accent / kill / dim), size (sm / lg), width class (full / compact / micro), mode (hover / docked / collapsed chip).

## 3. Tables

Columns: Name | Path (say this) | Id | What it is | DOM selector | Source file | Code alias / clash (**CLASH** = the code name misleads). "Library" = in the kit CSS but no plugin builds it yet. Source files are in `overlay/`.


### Panels (103)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Panel | Panel | `panel` | Generic ScapeLite floating panel shell built by UI.panel(): header, body, optional footer, resize corner. Every named panel below is one. | `.cc-panel` | ui-kit.js | window; dialog; card (ui-bar pinned); chip (when .min) / **CLASH:** Code comments say "window" and the root has role=dialog, but a Window in our scheme is a big game modal. |
| Header | Panel > Header | `panel.header` | Top strip: title, optional summary and value, icon buttons. Drag handle of the panel. | `.cc-panel > .hd` | ui-kit.js | hd; titlebar; rt-head (Route Advisor) / **CLASH:** The game's own floating panels have a .panel-titlebar; that is the game's header, not this. |
| Title | Panel > Header > Title | `panel.header.title` | Panel name, one line. | `.cc-panel .hd b` | ui-kit.js | titleEl; cc-q-title0 (queue); rt-ttl (Route Advisor); xp-ttl |
| Subtitle | Panel > Header > Subtitle | `panel.header.subtitle` | One-line summary under or beside the title. Library only: no plugin uses it yet. | `.cc-hsub` | ui-kit.js | cc-q-sum (queue's own) |
| Value | Panel > Header > Value | `panel.header.value` | The one headline number of a panel, right side of the header. Library only. | `.cc-hval` | ui-kit.js | xp-total (XP Tracker's own) |
| Chip Text | Panel > Header > Chip Text | `panel.header.chip-text` | Short status text shown in the header only while the panel is collapsed (set with setChip). | `.cc-panel .hd .chiptxt` | ui-kit.js | chiptxt; setChip |
| Gear Button | Panel > Header > Gear Button | `panel.header.gear-button` | Cogwheel icon button that opens the panel's own settings menu. | `.cc-gear` | ui-kit.js | cogwheel; setGear; gb (Chat's own) |
| Collapse Button | Panel > Header > Collapse Button | `panel.header.collapse-button` | Dash/plus button that folds the panel into a Panel Chip and back. | `.cc-panel .hd .min` | ui-kit.js | min; fold |
| Close Button | Panel > Header > Close Button | `panel.header.close-button` | Cross button that closes the panel. | `.cc-panel .hd .x` | ui-kit.js | x; rt-x (Route Advisor) |
| Body | Panel > Body | `panel.body` | Scrolling content area under the header. | `.cc-panel > .bd` | ui-kit.js | bd; rt-body (Route Advisor); cc-wd-bd (drawer) |
| Footer | Panel > Footer | `panel.footer` | Optional bottom strip. Library only; the queue builds its own (Queue Panel > Footer). | `.cc-panel > .ft` | ui-kit.js | ft; cc-q-foot |
| Grip | Panel > Grip | `panel.grip` | Resize corner in the bottom-right of a panel. Grip always means the resize corner, never a move strip. | `.cc-rz` | ui-scale.js | cc-rz (real); cc-grip (kit CSS, nothing creates it); rt-grip (Route Advisor) / **CLASH:** Five different classes draw the same corner; "grip" is also used for move strips (#cc-dock-grip, .cc-nd-grip). See Docks and handles. |
| Queue Panel | Queue Panel | `queue-panel` | ScapeLite task queue: current task plus every queued task as Cards, with walking gaps, roll controls and an options Tray. | `#cc-queue` | ui-queue.js | Task queue; kept panel; cc-queue; cc-qroot (inner root) / **CLASH:** The game's own queue is #unified-queue-panel = Game Tasks Panel. Never say "the queue" without Queue Panel or Game Tasks Panel. |
| Header | Queue Panel > Header | `queue-panel.header` | Kit header with a two-line title (name + summary) and gear, collapse, close. | `#cc-queue .hd` | ui-queue.js | hd |
| Title | Queue Panel > Header > Title | `queue-panel.header.title` | "Task queue" title line. | `#cc-queue .hd b.cc-q-title0` | ui-queue.js | cc-q-title0 |
| Summary | Queue Panel > Header > Summary | `queue-panel.header.summary` | Second header line: total time, XP, task count. | `#cc-queue .hd .cc-q-sum` | ui-queue.js | cc-q-sum |
| Controls Bar | Queue Panel > Controls Bar | `queue-panel.controls-bar` | Row under the header with lane switch, slayer masters, credits and Auto chip; can be folded. | `.cc-q-ctl` | ui-queue.js | cc-q-ctl; task roll controls / **CLASH:** Not a Bar in our scheme (Bar = Info Bar, HP bar, menu strip). |
| Fold Button | Queue Panel > Controls Bar > Fold Button | `queue-panel.controls-bar.fold-button` | Small arrow that folds the Controls Bar to one summary line. | `.cc-q-ctlt` | ui-queue.js | cc-q-ctlt |
| Fold Summary | Queue Panel > Controls Bar > Fold Summary | `queue-panel.controls-bar.fold-summary` | One-line text shown while the Controls Bar is folded. | `.cc-q-fsum` | ui-queue.js | cc-q-fsum |
| Lane Switch | Queue Panel > Controls Bar > Lane Switch | `queue-panel.controls-bar.lane-switch` | Segmented control Skilling \| Slay that mirrors the game's own roll lane. | `.cc-q-lane` | ui-queue.js | cc-q-lane; cc-seg |
| Master Buttons | Queue Panel > Controls Bar > Master Buttons | `queue-panel.controls-bar.master-buttons` | Row of slayer master icon buttons (T1..T5), one selected, locked ones dimmed. | `.cc-q-masters` | ui-queue.js | cc-q-masters; cc-q-mt |
| Credits | Queue Panel > Controls Bar > Credits | `queue-panel.controls-bar.credits` | Reroll credits readout with how many rerolls it buys; hover for the rules. | `.cc-q-cr` | ui-queue.js | cc-q-cr |
| Auto Chip | Queue Panel > Controls Bar > Auto Chip | `queue-panel.controls-bar.auto-chip` | Chip mirroring the game's Auto Loadout toggle. | `.cc-q-au` | ui-queue.js | cc-q-au |
| List | Queue Panel > List | `queue-panel.list` | Scrolling stack of Cards separated by Walking Gaps. | `.cc-q-list` | ui-queue.js | cc-q-list; uq-rows (the game's) |
| Footer | Queue Panel > Footer | `queue-panel.footer` | Bottom strip with the hint line and the "Nothing queued" note. | `.cc-q-foot` | ui-queue.js | cc-q-foot |
| Hint | Queue Panel > Footer > Hint | `queue-panel.footer.hint` | Small faint tip text. | `.cc-q-hint` | ui-queue.js | cc-q-hint |
| Route Advisor Panel | Route Advisor Panel | `route-advisor-panel` | Computes the best order and teleport use for the queue and shows three Plan Cards. Display only. Own CSS, not a kit panel. | `#cc-route-panel` | route-advisor.js | Route Advisor; cc-route-panel; rt- prefix / **CLASH:** Looks like a Panel but is not built by UI.panel(): header is .rt-head (not .hd), close is .rt-x, resize is .rt-grip. ui-scale and ui-layout reuse ".rt-head" as its drag handle. The word "route" also names the Map Drawer and the Badge. |
| Header | Route Advisor Panel > Header | `route-advisor-panel.header` | Draggable top strip: title, Best pill, close. | `#cc-route-panel .rt-head` | route-advisor.js | rt-head / **CLASH:** Shared name: ui-scale.js (HEAD map) and ui-layout.js use .rt-head as the drag handle of this panel only. |
| Title | Route Advisor Panel > Header > Title | `route-advisor-panel.header.title` | "Route Advisor". | `#cc-route-panel .rt-ttl` | route-advisor.js | rt-ttl |
| Best Pill | Route Advisor Panel > Header > Best Pill | `route-advisor-panel.header.best-pill` | Pill saying "Best: +x% lv/hr" or "Optimal"; turns green when the gain is 2% or more. | `#cc-route-panel .rt-pill` | route-advisor.js | rt-pill; rt-pill good |
| Close Button | Route Advisor Panel > Header > Close Button | `route-advisor-panel.header.close-button` | Closes the panel (and the Map Drawer). | `#cc-route-panel .rt-x` | route-advisor.js | rt-x |
| Calc Strip | Route Advisor Panel > Calc Strip | `route-advisor-panel.calc-strip` | Strip under the header while it calculates: spinner, text, percent, thin progress bar. | `#cc-route-panel .rt-calc` | route-advisor.js | rt-calc; rt-calc-top; rt-calc-bar; rt-spin |
| Body | Route Advisor Panel > Body | `route-advisor-panel.body` | Scrolling area under the header. | `#cc-route-panel .rt-body` | route-advisor.js | rt-body |
| Change Line | Route Advisor Panel > Body > Change Line | `route-advisor-panel.body.change-line` | Dim line saying why the suggestion was updated. | `#cc-route-panel .rt-chg` | route-advisor.js | rt-chg; changeLine |
| Teleport Mode Row | Route Advisor Panel > Body > Teleport Mode Row | `route-advisor-panel.body.teleport-mode-row` | Row "Teleports: On foot \| Efficient \| Max" plus the crystal count. | `#cc-route-panel .rt-prefrow` | route-advisor.js | rt-prefrow; tpPref |
| Picks Row | Route Advisor Panel > Body > Picks Row | `route-advisor-panel.body.picks-row` | Row "Picks: Optimise \| Keep mine". | `#cc-route-panel .rt-prefrow` | route-advisor.js | rt-prefrow; keepPicks |
| Teleport Upsell | Route Advisor Panel > Body > Teleport Upsell | `route-advisor-panel.body.teleport-upsell` | Purple callout offering to switch teleports on, with a Use teleports button. | `#cc-route-panel .rt-upsell` | route-advisor.js | rt-upsell / **CLASH:** A Callout in our scheme, not a Toast. |
| What You Could Gain | Route Advisor Panel > Body > What You Could Gain | `route-advisor-panel.body.what-you-could-gain` | Block with a comparison table (keep picks / optimise x foot / teleports); hover cells for the Variant Tooltip. | `#cc-route-panel .rt-wi` | route-advisor.js | rt-wi; rt-vt; variantTable |
| Note | Route Advisor Panel > Body > Note | `route-advisor-panel.body.note` | Faint footer text: display-only reminder and search statistics. | `#cc-route-panel .rt-note` | route-advisor.js | rt-note |
| Why Box | Route Advisor Panel > Body > Why Box | `route-advisor-panel.body.why-box` | Orange-edged box explaining why a plan swapped picks. | `#cc-route-panel .rt-why` | route-advisor.js | rt-why; rt-why-h; rt-why-l |
| Tree Advisor Panel | Tree Advisor Panel | `tree-advisor-panel` | Plans the best Delve and Fortress tree builds; shows steps and saved builds. Display only. Kit panel with a tab strip. | `#cc-treeadv` | tree-advisor.js | Tree Advisor; cc-treeadv; Raid tree |
| Tab Strip | Tree Advisor Panel > Tab Strip | `tree-advisor-panel.tab-strip` | Three big tabs between header and body: Delve, Fortress, My builds. | `#cc-treeadv .tabs` | tree-advisor.js | tabsRow; .tabs / **CLASH:** Tabs here are plain buttons with .on, not .cc-tabs/.cc-tab. |
| Tab | Tree Advisor Panel > Tab Strip > Tab | `tree-advisor-panel.tab-strip.tab` | One tab button; .on = selected. | `#cc-treeadv .tabs button` | tree-advisor.js | tabs button.on |
| Body | Tree Advisor Panel > Body | `tree-advisor-panel.body` | Scrolling area: hero, steps, save/share, saved builds, import. | `#cc-treeadv .bd` | tree-advisor.js | bd |
| Hero | Tree Advisor Panel > Body > Hero | `tree-advisor-panel.body.hero` | Gradient summary block with the one big number (gain). | `#cc-treeadv .hero` | tree-advisor.js | hero; hero .v |
| Section Heading | Tree Advisor Panel > Body > Section Heading | `tree-advisor-panel.body.section-heading` | Small uppercase heading ("Steps to get there", "Save, share", "Saved builds", "Import a build"). | `#cc-treeadv h5` | tree-advisor.js | h5 / **CLASH:** Not .cc-sec; same job, own CSS. |
| Step Row | Tree Advisor Panel > Body > Step Row | `tree-advisor-panel.body.step-row` | One node to add or remove; accent edge = add, red edge = remove. Click to highlight on the Tree Map. | `#cc-treeadv .step` | tree-advisor.js | step; step.add; step.rem |
| Tree Preview | Tree Advisor Panel > Body > Tree Preview | `tree-advisor-panel.body.tree-preview` | Canvas picture of the tree inside the panel. | `#cc-treeadv canvas` | tree-advisor.js | canvas |
| Legend | Tree Advisor Panel > Body > Legend | `tree-advisor-panel.body.legend` | Row of coloured dots naming what the colours on the tree mean. | `#cc-treeadv .leg` | tree-advisor.js | leg |
| XP Tracker Panel | XP Tracker Panel | `xp-tracker-panel` | XP per hour per skill with time frames, graph and per-skill rows. Collapses to a chip showing the total (chipAlways). | `#cc-xp-tracker` | xp-tracker.js | XP Tracker; cc-xp-tracker; xp chip |
| Icon | XP Tracker Panel > Header > Icon | `xp-tracker-panel.header.icon` | Small skill icon at the left of the title. | `#cc-xp-tracker .xp-ico` | xp-tracker.js | xp-ico |
| Total | XP Tracker Panel > Header > Total | `xp-tracker-panel.header.total` | Right-aligned total XP/hr in green. | `#cc-xp-tracker .xp-total` | xp-tracker.js | xp-total / **CLASH:** Plays the role of Panel > Header > Value but is not .cc-hval. |
| Sparkline | XP Tracker Panel > Header > Sparkline | `xp-tracker-panel.header.sparkline` | 54 px trend line in the header. | `#cc-xp-tracker canvas.spark` | xp-tracker.js | spark; drawSpark |
| Time Frame Chips | XP Tracker Panel > Time Frame Chips | `xp-tracker-panel.time-frame-chips` | Row of chips choosing the time window (and Custom). | `#cc-xp-tracker .xp-frames` | xp-tracker.js | xp-frames / **CLASH:** Two rows share .xp-frames: the time-frame row and the Total / All skills view row. |
| Custom Frame Editor | XP Tracker Panel > Custom Frame Editor | `xp-tracker-panel.custom-frame-editor` | Inline "Show the last [n] hours [Set]" row. | `#cc-xp-tracker .xp-custom` | xp-tracker.js | xp-custom |
| View Chips | XP Tracker Panel > View Chips | `xp-tracker-panel.view-chips` | Row of chips: Total \| All skills, and XP/hr \| XP gained. | `#cc-xp-tracker .xp-frames` | xp-tracker.js | xp-frames |
| Graph | XP Tracker Panel > Graph | `xp-tracker-panel.graph` | Line or stacked-area canvas of XP/hr over the chosen window. | `#cc-xp-tracker .xp-graphwrap` | xp-tracker.js | xp-graphwrap; canvas.graph |
| Hover Tip | XP Tracker Panel > Graph > Hover Tip | `xp-tracker-panel.graph.hover-tip` | Small box following the pointer on the graph. | `#cc-xp-tracker .xp-tip` | xp-tracker.js | xp-tip / **CLASH:** A hover tip drawn inside the panel; not the shared Tooltip (.cc-tip). |
| Focus Line | XP Tracker Panel > Focus Line | `xp-tracker-panel.focus-line` | One line naming the skill or time under the pointer. | `#cc-xp-tracker .xp-focus` | xp-tracker.js | xp-focus |
| Skill List | XP Tracker Panel > Skill List | `xp-tracker-panel.skill-list` | Container of Skill Rows. | `#cc-xp-tracker .xp-rows` | xp-tracker.js | xp-rows |
| Footer | XP Tracker Panel > Footer | `xp-tracker-panel.footer` | Reset and hint line. | `#cc-xp-tracker .xp-foot` | xp-tracker.js | xp-foot |
| Goals Panel | Goals Panel | `goals-panel` | Time-to-goal estimates from your real XP/hr: skill goals, pet chances, item hunts, pins. Kit panel. | `#cc-goals` | goals.js | Goals; cc-goals; Goal Planner (the game's own strip button is hidden by ScapeLite Menu) / **CLASH:** The game has its own "Goal Planner" strip button; ScapeLite Goals is a different thing. |
| Advisor Panel | Advisor Panel | `advisor-panel` | One panel that says what to do next, how and where: a hero Action Card on top, tabs Now, Levers and diary, Hunts, Build, Why. Reads the other advisors. Kit panel. | `#cc-advisor` | advisor.js | Advisor; cc-advisor / **CLASH:** the Route, Lever and Tree Advisors are separate panels and drawers; this one only reads them. |
| Locations And Free Pips Panel | Locations And Free Pips Panel | `diary-credits-panel` | Rates every location by walking distance to its bank, how often it is rolled and used, where to put the free diary pips; diary progress and credit pools as reference. Kit panel; phase 1 of the Universal Advisor. | `#cc-diary-credits` | diary-credits.js | Locations and Free Pips; Diary and Credits; cc-diary-credits / **CLASH:** The game has its own Diary panel and ScapeLite has a Diary card (`cc-card-diary`); this is the planning panel. |
| Section Heading | Goals Panel > Section Heading | `goals-panel.section-heading` | Uppercase heading with count: Pinned, Skills you are training, Pets (expected time), Item hunts worth a look, Add a skill goal. | `#cc-goals .cc-sec` | goals.js | cc-sec |
| Add Form | Goals Panel > Add Form | `goals-panel.add-form` | Select + inputs + button row to pin a new skill goal. | `#cc-goals .add` | goals.js | add |
| Drop Luck Panel | Drop Luck Panel | `drop-luck-panel` | How lucky your drops are: two main tabs (Overview, Detailed); Detailed has five sub-tabs (Pets & Tools, Unlocks, Mobs, Delve, Fortress) that can be dragged into another order. Kit panel. | `#cc-droplog` | drop-luck.js | Drop Luck Tracker; Drop Log; cc-droplog / **CLASH:** Id says "droplog", title says "Drop Luck Tracker". The "Fortress Tracker" is only its sixth tab, not a separate panel. |
| Tab Strip | Drop Luck Panel > Tab Strip | `drop-luck-panel.tab-strip` | Underline tab strip between header and body. | `#cc-droplog .tabs` | drop-luck.js | tabs; cc-tabs |
| Tab | Drop Luck Panel > Tab Strip > Tab | `drop-luck-panel.tab-strip.tab` | One main tab (Overview or Detailed). | `#cc-droplog .cc-tab` | drop-luck.js | cc-tab |
| Sub-tab Strip | Drop Luck Panel > Sub-tab Strip | `drop-luck-panel.sub-tab-strip` | Second tab row, shown only on Detailed: Pets & Tools, Unlocks, Mobs, Delve, Fortress. Drag a tab to reorder (marker shows where it lands), Shift+Left / Shift+Right moves the focused tab, right-click resets the order. | `#cc-droplog .subtabs` | drop-luck.js | subtabs; tabmark |
| Luck Line | Drop Luck Panel > Luck Line | `drop-luck-panel.luck-line` | One small line at the top of every sub-tab in the verdict's colour: `Luck: Lucky · 83rd percentile · 4 obtained / 2.5 expected`. The big Hero stays on the Overview only. | `#cc-droplog .luckline` | drop-luck.js | luckline |
| Segmented Switch | Drop Luck Panel > Pets & Tools > Segmented Switch | `drop-luck-panel.pets-tools.segmented-switch` | Pets, Tools, All: which part of Pets & Tools is shown (remembered). | `#cc-droplog .catrow` | drop-luck.js | catrow; catchip |
| Hero | Drop Luck Panel > Overview Tab > Hero | `drop-luck-panel.overview-tab.hero` | Big luck percentile number with a Luck Meter and sub line. | `#cc-droplog .hero` | drop-luck.js | hero; hero .v; hero .p |
| Luck Meter | Drop Luck Panel > Overview Tab > Luck Meter | `drop-luck-panel.overview-tab.luck-meter` | Red-to-green gradient bar with a white marker at your percentile. | `#cc-droplog .meter` | drop-luck.js | meter; meter.sm; ends / **CLASH:** A meter, not a .cc-prog Progress Bar. |
| Stat Row | Drop Luck Panel > Overview Tab > Stat Row | `drop-luck-panel.overview-tab.stat-row` | Row of small centred number boxes. | `#cc-droplog .stats` | drop-luck.js | stats / **CLASH:** Own CSS, not .cc-stats. |
| Section Heading | Drop Luck Panel > Section Heading | `drop-luck-panel.section-heading` | Small uppercase heading inside the body. | `#cc-droplog h5` | drop-luck.js | h5 |
| Search | Drop Luck Panel > Search | `drop-luck-panel.search` | Search input at the top of a tab. | `#cc-droplog .search` | drop-luck.js | search |
| Mob Picker | Drop Luck Panel > Mob Picker | `drop-luck-panel.mob-picker` | Dropdown pair choosing a mob, on the Mobs tab. | `#cc-droplog .mobbar` | drop-luck.js | mobbar; mobsel; sel |
| More Button | Drop Luck Panel > More Button | `drop-luck-panel.more-button` | Centred pill button "Show more". | `#cc-droplog .more` | drop-luck.js | more |
| Graph Button | Drop Luck Panel > Graph Button | `drop-luck-panel.graph-button` | Small kit icon button (chart glyph, aria-pressed = accent) at the end of a drop line. Hover shows the chance-by-kills graph as a hover card; a click pins it inline under the drop. | `#cc-droplog .gbtn` | drop-luck.js | gbtn; cc-ib; gbox |
| Drop Graph | Drop Luck Panel > Drop Graph | `drop-luck-panel.drop-graph` | Inline SVG chart under a drop: chance of having it by kill count, your kills marked, 50/90/99% marks, values on hover. | `#cc-droplog .dgraph` | drop-luck.js | dgraph; gbox; gcap |
| Category Chips | Drop Luck Panel > Unlocks Tab > Category Chips | `drop-luck-panel.unlocks-tab.category-chips` | Row of pill buttons on the Unlocks tab: All, Tools, Conduits, Shards, Dungeon extras with counts. | `#cc-droplog .catrow` | drop-luck.js | catrow; catchip |
| Tier Pill | Drop Luck Panel > Tier Pill | `drop-luck-panel.tier-pill` | Small pill for one wave band of a special drop (T1 · wave 1); green when you have it. Used in the Chaos Dungeon card and the Fortress loot list. | `#cc-droplog .tp` | drop-luck.js | tp; fam |
| Fortress Tab | Drop Luck Panel > Fortress Tab | `drop-luck-panel.fortress-tab` | The Fortress Tracker: live run card, tier table, run history and log, inside the Drop Luck Panel. | `#cc-droplog .ft-live` | fortress-tracker.js | Fortress Tracker; ft-*; gauntlet / **CLASH:** "Gauntlet" is the game's internal name of the Fortress (.gauntlet-hud). Fortress Tracker draws into #cc-droplog. |
| Live Run Card | Drop Luck Panel > Fortress Tab > Live Run Card | `drop-luck-panel.fortress-tab.live-run-card` | Box with run title, status Badge, Pills and the tier table. | `#cc-droplog .ft-live` | fortress-tracker.js | ft-live; hd2 |
| Status Badge | Drop Luck Panel > Fortress Tab > Status Badge | `drop-luck-panel.fortress-tab.status-badge` | Round-edged ok/no badge on the live run card. | `#cc-droplog .ft-badge` | fortress-tracker.js | ft-badge / **CLASH:** Not .cc-badge. |
| Pills | Drop Luck Panel > Fortress Tab > Pills | `drop-luck-panel.fortress-tab.pills` | Wrapping row of small boxed facts (waves, rares). | `#cc-droplog .ft-pills` | fortress-tracker.js | ft-pills; ft-pill / **CLASH:** Not .cc-pill. |
| Tier Table | Drop Luck Panel > Fortress Tab > Tier Table | `drop-luck-panel.fortress-tab.tier-table` | 4-column grid: Tier, Expected, Got, Chance of 1+. | `#cc-droplog .ft-tbl` | fortress-tracker.js | ft-tbl / **CLASH:** A CSS grid, not .cc-table. |
| Run Details | Drop Luck Panel > Fortress Tab > Run Details | `drop-luck-panel.fortress-tab.run-details` | Collapsible history entry for one past run. | `#cc-droplog .ft-det` | fortress-tracker.js | ft-det; ft-run |
| Run Log | Drop Luck Panel > Fortress Tab > Run Log | `drop-luck-panel.fortress-tab.run-log` | List of timed drop lines. | `#cc-droplog .ft-log` | fortress-tracker.js | ft-log; li |
| Chat Panel | Chat Panel | `chat-panel` | ScapeLite chat with channel chips, search, composer and an in-panel settings sheet. Kit panel. | `#cc-chat` | chat-plus.js | Chat; Chat Plus; cc-chat / **CLASH:** The game's own chat is the Game Chat Panel (panel id "chat"). Say "Chat Panel" for ours. |
| Channel Strip | Chat Panel > Channel Strip | `chat-panel.channel-strip` | Wrapping row of channel chips (Global, Nearby, Raid, Friends, Clan, Game) plus search button. | `#cc-chat .tabs` | chat-plus.js | tabs; tabsEl / **CLASH:** Called "tabs" in code but they are filter Chips (several can be on). |
| Channel Chip | Chat Panel > Channel Strip > Channel Chip | `chat-panel.channel-strip.channel-chip` | One channel filter. .on = shown, .off = dashed (hidden in game). Unread count in <i>. | `#cc-chat .tab` | chat-plus.js | tab; tab.on; tab.off / **CLASH:** Not a Tab: it toggles a filter. |
| Search Button | Chat Panel > Channel Strip > Search Button | `chat-panel.channel-strip.search-button` | Magnifier icon button that toggles the Find Bar. | `#cc-chat .ib` | chat-plus.js | ib |
| Find Bar | Chat Panel > Find Bar | `chat-panel.find-bar` | Search input under the strip. | `#cc-chat .find` | chat-plus.js | find; findWrap |
| Message List | Chat Panel > Message List | `chat-panel.message-list` | Scrolling list of Messages. | `#cc-chat .list` | chat-plus.js | list; listEl |
| Jump Button | Chat Panel > Jump Button | `chat-panel.jump-button` | "New messages" pill at the bottom right of the list. | `#cc-chat .jump` | chat-plus.js | jump; cc-newjump (kit) |
| Composer | Chat Panel > Composer | `chat-panel.composer` | Bottom row: channel button, text input, character counter. | `#cc-chat .cmp` | chat-plus.js | cmp; cc-composer (kit) |
| Channel Button | Chat Panel > Composer > Channel Button | `chat-panel.composer.channel-button` | Shows the channel your message goes to; click to change. | `#cc-chat .cmp .cl` | chat-plus.js | cl; chBtn |
| Settings Sheet | Chat Panel > Settings Sheet | `chat-panel.settings-sheet` | Full-panel overlay with chat options; opened by the gear. | `#cc-chat .set` | chat-plus.js | set; setEl; cc-sheet (kit) / **CLASH:** Built with own classes, not .cc-sheet/.cc-set. |
| Sheet Header | Chat Panel > Settings Sheet > Sheet Header | `chat-panel.settings-sheet.sheet-header` | Title row with Done button. | `#cc-chat .set .sh` | chat-plus.js | sh |
| Setting Row | Chat Panel > Settings Sheet > Setting Row | `chat-panel.settings-sheet.setting-row` | Label plus toggle, slider, select or text field. | `#cc-chat .set .r` | chat-plus.js | r / **CLASH:** Not .cc-set. |
| HP Panel | HP Panel | `hp-panel` | Small movable panel with ScapeLite's HP bar or number. Header is only a thin handle. | `#cc-hp` | hp-panel.js | Hit points; cc-hp / **CLASH:** Not the Info Bar's HP module and not the game's .hp-bar. See Disambiguation: three HP things. |
| Handle | HP Panel > Handle | `hp-panel.handle` | The 11 px header strip with a centred grabber; drag it to move. | `#cc-hp .hd` | hp-panel.js | hd |
| Heart | HP Panel > Heart | `hp-panel.heart` | Heart icon. | `#cc-hp .ic` | hp-panel.js | ic |
| Bar | HP Panel > Bar | `hp-panel.bar` | Filled HP bar with centred "57 / 80" label. | `#cc-hp .bar` | hp-panel.js | bar; bar i; bar b / **CLASH:** A progress bar named .bar; not the Info Bar. |
| Number | HP Panel > Number | `hp-panel.number` | Big coloured HP number (numbers style). | `#cc-hp .num` | hp-panel.js | num |
| Materials Panel | Materials Panel | `materials-panel` | Appears only when a queued task will run short of materials; one Row per shortage. Kit panel. | `#cc-matshort` | material-shortage.js | Materials; Material Shortage; cc-matshort |
| Shortage Row | Materials Panel > Shortage Row | `materials-panel.shortage-row` | Red (short) or orange (needs luck) Row: slot, missing amount, have/need. | `#cc-matshort .cc-row` | material-shortage.js | cc-row nolf |
| Bug Report Panel | Bug Report Panel | `bug-report-panel` | Form to report a ScapeLite bug: plugin, description, diagnostics, Copy / Open on GitHub. Kit panel. | `#cc-bugreport` | bug-report.js | Report a ScapeLite bug; cc-bugreport / **CLASH:** It is a Panel, not a Modal: it is draggable and does not dim the game. |
| Scope Note | Bug Report Panel > Scope Note | `bug-report-panel.scope-note` | Gold-edged note on what gets fixed. | `#cc-bugreport .scope` | bug-report.js | scope |
| Diagnostics | Bug Report Panel > Diagnostics | `bug-report-panel.diagnostics` | Monospace box of versions and enabled plugins. | `#cc-bugreport .diag` | bug-report.js | diag; pre |

### Windows (94)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Game Window | Game Window | `game-window` | The game's full-screen modal container that holds Settings, Bank, Crafting and the rest, one tab at a time. | `.modal-overlay .modal-container` | modal-resize.js | modal; modal-container; modal-overlay / **CLASH:** The game says "modal"; we say Window for these and Modal only for ScapeLite dialogs that dim the game (Welcome Tour). |
| Header | Game Window > Header | `game-window.header` | Window title bar; ScapeLite uses it as the drag area when a window is floated. | `.modal-overlay .modal-header` | modal-resize.js | modal-header |
| Tab Bar | Game Window > Tab Bar | `game-window.tab-bar` | Row of tab buttons to switch between windows. | `.modal-tabs .tab-btn` | raid-alert.js | modal-tabs; tab-btn |
| Body | Game Window > Body | `game-window.body` | Holds one Window Page per tab. | `.modal-body` | dom-scope.js | modal-body; tab-content |
| Settings Window | Settings Window | `settings-window` | The game's Settings page; ScapeLite adds a Plugins nav button and many sections to it. | `#tab-settings` | plugins-settings-ui.js | tab-settings; Settings |
| Header Nav | Settings Window > Header Nav | `settings-window.header-nav` | Row of category buttons (Build, Display ... Plugins) at the top of Settings. | `.settings-header-nav` | plugins-settings-ui.js | settings-header-nav; settings-nav-btn |
| Plugins Button | Settings Window > Header Nav > Plugins Button | `settings-window.header-nav.plugins-button` | ScapeLite's "Plugins" nav button. | `#cc-plugins-nav-btn` | plugins-settings-ui.js | cc-plugins-nav-btn |
| Search Box | Settings Window > Search Box | `settings-window.search-box` | The game's settings search; ScapeLite sections follow it. | `.settings-search-input` | plugins-settings-ui.js | settings-search-input |
| Section | Settings Window > Section | `settings-window.section` | One boxed settings group (game's or ScapeLite's). | `.settings-section` | plugins-settings-ui.js | settings-section |
| Header | Settings Window > Section > Header | `settings-window.section.header` | Section title (ScapeLite adds the author tag). | `.settings-section-header` | plugins-settings-ui.js | settings-section-header |
| Toggle Row | Settings Window > Section > Toggle Row | `settings-window.section.toggle-row` | Label, description and a switch; the row type used for most ScapeLite options. | `.settings-toggle-row` | plugins-settings-ui.js | settings-toggle-row; settings-switch / **CLASH:** Every ScapeLite row type (select, number, text) reuses the class name "toggle-row". |
| Subheading | Settings Window > Section > Subheading | `settings-window.section.subheading` | Small divider heading inside a section. | `.settings-subheading` | plugins-settings-ui.js | settings-subheading |
| Bank Window | Bank Window | `bank-window` | The game's Bank page; Bank Tools add separators, a size slider, a Settings menu and NEW sparkles. | `#tab-bank` | bank-tools.js | tab-bank; Bank |
| Toolbar | Bank Window > Toolbar | `bank-window.toolbar` | Filter and mode buttons row. | `#tab-bank .bank-toolbar` | bank-tools.js | bank-toolbar |
| Grid | Bank Window > Grid | `bank-window.grid` | Grid of Bank Slots. | `#tab-bank .bank-grid` | bank-tools.js | bank-grid |
| Slot | Bank Window > Grid > Slot | `bank-window.grid.slot` | One item cell. | `.bank-slot` | bank-tools.js | bank-slot / **CLASH:** A game cell; not .cc-cell. |
| Smithing Window | Smithing Window | `smithing-window` | The game's Smith page (also Crafting, Imbuing, Brewing windows share the layout). Craft Potential draws on its XP bar. | `#tab-smith` | craft-potential.js | tab-smith; Smith |
| Crafting Window | Crafting Window | `crafting-window` | The game's Craft page. | `#tab-craft` | craft-potential.js | tab-craft; Craft |
| Imbuing Window | Imbuing Window | `imbuing-window` | The game's Imbue page. | `#tab-imbue` | craft-potential.js | tab-imbue; Imbue |
| Brewing Window | Brewing Window | `brewing-window` | The game's Brew page. | `#tab-brew` | craft-potential.js | tab-brew; Brew |
| XP Bar | Crafting Windows > XP Bar | `crafting-windows.xp-bar` | The level progress bar at the top of the four crafting-style windows; Craft Potential adds stripes and a label. | `.header-xp-bar` | craft-potential.js | header-xp-bar / **CLASH:** A game bar; not an Info Bar and not .cc-prog. |
| Skills Customization Window | Skills Customization Window | `skills-customization-window` | The game's lever window for skill weights and quantities; hosts the Lever Advisor Drawer. Also holds the Slay lever page. | `#tab-skillcustom` | lever-advisor.js | tab-skillcustom; Skill custom; Slay Customization / **CLASH:** Mechanics Explainer and alert-bell call it "Skills / Slay Customization windows"; the code has one tab id. |
| Lever Tooltip | Skills Customization Window > Lever Tooltip | `skills-customization-window.lever-tooltip` | The game's single shared lever tooltip; Mechanics Explainer appends a blue explanation block. | `.ctrl-global-tooltip` | mechanics-explainer.js | ctrl-global-tooltip; cc-mech |
| Lever Button | Skills Customization Window > Lever Button | `skills-customization-window.lever-button` | The plus/minus buttons that change a weight or quantity. | `.ctrl-btn` | lever-advisor.js | ctrl-btn |
| Layouts Window | Layouts Window | `layouts-window` | ScapeLite dialog to save, load and delete named layout presets. Loading reloads the game. | `#cc-layouts` | layouts.js | Layouts; layout presets; cc-layouts / **CLASH:** Not the Layout Editor (edit mode of panels, ui-layout.js) and not a kit Panel. |
| Header | Layouts Window > Header | `layouts-window.header` | Draggable title row with close. | `#cc-layouts .hd` | layouts.js | hd |
| Preset Row | Layouts Window > Preset Row | `layouts-window.preset-row` | One saved preset: name, date, Load and Delete. | `#cc-layouts .row` | layouts.js | row / **CLASH:** Not .cc-row. |
| Add Row | Layouts Window > Add Row | `layouts-window.add-row` | Name input and Save current button. | `#cc-layouts .add` | layouts.js | add |
| Game Tasks Panel | Game Tasks Panel | `game-tasks-panel` | The game's own task queue panel. | `#unified-queue-panel` | ui-queue.js | Unified queue panel; uq-row; panel id "tasks" / **CLASH:** ScapeLite's version is the Queue Panel (#cc-queue). Queue Walk draws bars and tags inside this one. |
| Row | Game Tasks Panel > Row | `game-tasks-panel.row` | One queue slot of the game's panel. | `#unified-queue-panel .uq-row` | queue-walk.js | uq-row; uq-current / **CLASH:** Not a Row (.cc-row) and not our Card. |
| Walking Toggle Button | Game Tasks Panel > Walking Toggle Button | `game-tasks-panel.walking-toggle-button` | Small button ScapeLite adds to this panel's header to switch walking bars on and off. | `.cc-qw-btn` | queue-walk.js | cc-qw-btn |
| Game Current Task Panel | Game Current Task Panel | `game-current-task-panel` | The game's floating current-task panel (panel id taskhud). ScapeLite adds a collapse button; the Walking Countdown can dock under it. | `#task-display` | walking-countdown.js | task-display; floating-current-task; taskhud; Current Task |
| Collapse Button | Game Current Task Panel > Collapse Button | `game-current-task-panel.collapse-button` | ScapeLite button in the panel's titlebar that folds it to a slim bar. | `.cc-ct-btn` | walking-countdown.js | cc-ct-btn; cc-ct-min |
| Game Skills Panel | Game Skills Panel | `game-skills-panel` | The game's skills panel (panel id skills): grid of skill cells with total level. | `.skill-cell` | ui-bar.js | skills; skill-cell |
| Game Inventory Panel | Game Inventory Panel | `game-inventory-panel` | The game's inventory panel (panel id inventory). | `.panel-floating` | panel-resize.js | inventory; data-panel-id=inventory |
| Game Equipment Panel | Game Equipment Panel | `game-equipment-panel` | The game's equipment panel (panel id equipment). | `.panel-floating` | panel-resize.js | equipment; data-panel-id=equipment |
| Game Chat Panel | Game Chat Panel | `game-chat-panel` | The game's own chat panel (panel id chat). | `.panel-floating` | panel-resize.js | chat; data-panel-id=chat / **CLASH:** ScapeLite's is the Chat Panel (#cc-chat). |
| Game Floating Panel | Game Floating Panel | `game-floating-panel` | Any of the game's draggable panels: tasks, slay, skills, quests, inventory, diary, equipment, friends, barter, chat, taskhud, population (Info), raiddps, gauntlet (Fortress). | `.panel-floating` | panel-resize.js | panel-floating; data-panel-id; titlebar / **CLASH:** The game's word is "panel"; we prefix Game to tell it from ScapeLite's Panel. |
| Titlebar | Game Floating Panel > Titlebar | `game-floating-panel.titlebar` | The game's panel header with its button group. | `.panel-titlebar` | panel-resize.js | panel-titlebar; panel-titlebar-btns; panel-titlebar-btn / **CLASH:** The game's header; ScapeLite panels use .hd. |
| Game Raid DPS Panel | Game Raid DPS Panel | `game-raid-dps-panel` | The game's raid damage panel (panel id raiddps) with tabs DPS Current / DPS Total / Recap; Raid DPS Extras add a Party line and a Graph tab. | `.raid-contrib-hud` | raid-dps-extra.js | raid-contrib-hud; raiddps |
| Tab | Game Raid DPS Panel > Tab | `game-raid-dps-panel.tab` | One of the panel's tab buttons; ScapeLite adds a fourth, Graph. | `.raid-contrib-tab` | raid-dps-extra.js | raid-contrib-tab; cc-rdps-tab |
| Party Line | Game Raid DPS Panel > Party Line | `game-raid-dps-panel.party-line` | ScapeLite line under the player rows: whole party's damage and DPS. | `.cc-rdps-total` | raid-dps-extra.js | cc-rdps-total |
| Graph View | Game Raid DPS Panel > Graph View | `game-raid-dps-panel.graph-view` | ScapeLite graph of every player's DPS over time with range buttons and legend. | `.cc-rdps-graph` | raid-dps-extra.js | cc-rdps-graph; bar; leg |
| Game Fortress HUD | Game Fortress HUD | `game-fortress-hud` | The game's in-run Fortress panel (panel id gauntlet); Fortress Tracker reads it. | `.gauntlet-hud` | fortress-tracker.js | gauntlet-hud; gauntlet; Fortress / **CLASH:** The game calls the Fortress "Gauntlet" in class names. |
| Game Left Icon Strip | Game Left Icon Strip | `game-left-icon-strip` | The vertical strip of window buttons on the left (Bank, Raids, ...); ScapeLite adds its logo button and can hide or pin icons. | `.floating-tab-strip` | sidebar-tabs.js | floating-tab-strip; floating-tab-btn; side tabs |
| Button | Game Left Icon Strip > Button | `game-left-icon-strip.button` | One icon button. | `.floating-tab-btn` | sidebar-tabs.js | floating-tab-btn; data-tab |
| Game Panel Tab Bar | Game Panel Tab Bar | `game-panel-tab-bar` | The vertical menu in the bottom-right corner with panel buttons; Menu Dock moves and scales it with the Game HP Bar. | `#ui-container>.panel-tab-bar` | menu-dock.js | panel-tab-bar; vertical menu; right-bottom menu; cc-vmenu / **CLASH:** Not the Info Bar and not "tab bar" of a Window. |
| Game HP Bar | Game HP Bar | `game-hp-bar` | The game's own hit point bar under the Panel Tab Bar. | `#ui-container>.hp-bar` | menu-dock.js | hp-bar / **CLASH:** Three HP things: Game HP Bar, HP Panel (ours), Hit Points module of the Info Bar. |
| Game Active Potions Panel | Game Active Potions Panel | `game-active-potions-panel` | The game's active potions pill and list; Potions Dock can move it. | `.active-potions-panel` | window-dock.js | active-potions-panel; active-potions-pill |
| Game Window Controls | Game Window Controls | `game-window-controls` | Top-right row of round buttons (language, Ko-fi, Discord, World Map, Patch Notes, Sleep, Logout). | `#ui-container .window-controls` | window-dock.js | window-controls; window-control-btn; top-right dock / **CLASH:** Window Controls Dock (ScapeLite) wraps this; not a Window. |
| Game Invite Tray | Game Invite Tray | `game-invite-tray` | The game's pop-up tray for raid, party and friend invites (notification area). | `.invite-tray` | notif-dock.js | invite-tray; notification tray |
| Game Task Popup | Game Task Popup | `game-task-popup` | The game's task-complete celebration popup. | `.celebration-container` | notif-dock.js | celebration-container; task popups |
| Game Dashboard Toast | Game Dashboard Toast | `game-dashboard-toast` | The game's small dashboard toast. | `.dash-toast` | notif-dock.js | dash-toast / **CLASH:** Game toasts are not ScapeLite Toasts. |
| Plugins Page | Settings Window > Plugins Page | `settings-window.plugins-page` | Everything ScapeLite adds to the Settings window: group headings and sections below the game's own. | `#cc-plugins-nav-btn` | plugins-settings-ui.js | Plugins tab; Settings > Plugins |
| Group Heading | Settings Window > Plugins Page > Group Heading | `settings-window.plugins-page.group-heading` | Wide uppercase heading with a line, one per group (Core, User Interface, Trackers and Queue ...). | `.cc-group-head` | plugins-settings-ui.js | cc-group-head; settings-sec-cc-group-* |
| Author Tag | Settings Window > Plugins Page > Author Tag | `settings-window.plugins-page.author-tag` | Small "@name" tag on a section header; hover shows the Author Card. | `.cc-author` | plugins-settings-ui.js | cc-author |
| Row Types | Settings Window > Plugins Page > Row Types | `settings-window.plugins-page.row-types` | toggle, button, number, select, secret (hidden value), info, text, roles, priority, task weights, hidden-panels. All reuse .settings-toggle-row. | `.settings-toggle-row` | plugins-settings-ui.js | buildToggleRow; buildButtonRow; buildNumberRow; buildSelectRow; buildSecretRow; buildInfoRow; buildTextRow; buildRolesRow; buildPrioRow; buildTaskWRow; buildHiddenRow |
| Core | Settings Window > Plugins Page > Group > Core | `settings-window.plugins-page.group.core` | Group heading "Core" with 2 sections. | `#settings-sec-cc-group-core` | plugins-settings-ui.js | GROUPS |
| ScapeLite Core | Settings Window > Plugins Page > Section > ScapeLite Core | `settings-window.plugins-page.section.scapelite-core` | Settings section "ScapeLite Core" in group Core. | `#settings-sec-cc-scapelite-core` | plugins-settings-ui.js | settings-sec-cc-*; section "ScapeLite Core" |
| Logs | Settings Window > Plugins Page > Section > Logs | `settings-window.plugins-page.section.logs` | Settings section "Logs" in group Core. | `#settings-sec-cc-logs` | plugins-settings-ui.js | settings-sec-cc-*; section "Logs" |
| About | Settings Window > Plugins Page > Group > About | `settings-window.plugins-page.group.about` | Group heading "About" (a single centred section). | `#settings-sec-cc-group-about` | plugins-settings-ui.js | GROUPS |
| User Interface | Settings Window > Plugins Page > Group > User Interface | `settings-window.plugins-page.group.user-interface` | Group heading "User Interface" with 14 sections. | `#settings-sec-cc-group-user-interface` | plugins-settings-ui.js | GROUPS |
| Info Bars | Settings Window > Plugins Page > Section > Info Bars | `settings-window.plugins-page.section.info-bars` | Settings section "Info Bars" in group User Interface. | `#settings-sec-cc-info-bars` | plugins-settings-ui.js | settings-sec-cc-*; section "Info Bars" |
| Alerts | Settings Window > Plugins Page > Section > Alerts | `settings-window.plugins-page.section.alerts` | Settings section "Alerts" in group User Interface. | `#settings-sec-cc-alerts` | plugins-settings-ui.js | settings-sec-cc-*; section "Alerts" |
| Panels | Settings Window > Plugins Page > Section > Panels | `settings-window.plugins-page.section.panels` | Settings section "Panels" in group User Interface. | `#settings-sec-cc-panels` | plugins-settings-ui.js | settings-sec-cc-*; section "Panels" |
| Panel Dragging And Fusing | Settings Window > Plugins Page > Section > Panel Dragging And Fusing | `settings-window.plugins-page.section.panel-dragging-and-fusing` | Settings section "Panel Dragging And Fusing" in group User Interface. | `#settings-sec-cc-panel-dragging-and-fusing` | plugins-settings-ui.js | settings-sec-cc-*; section "Panel Dragging And Fusing" |
| Panel Mod | Settings Window > Plugins Page > Section > Panel Mod | `settings-window.plugins-page.section.panel-mod` | Settings section "Panel Mod" in group User Interface. | `#settings-sec-cc-panel-mod` | plugins-settings-ui.js | settings-sec-cc-*; section "Panel Mod" |
| HP Panel | Settings Window > Plugins Page > Section > HP Panel | `settings-window.plugins-page.section.hp-panel` | Settings section "HP Panel" in group User Interface. | `#settings-sec-cc-hp-panel` | plugins-settings-ui.js | settings-sec-cc-*; section "HP Panel" |
| Quality Of Life | Settings Window > Plugins Page > Section > Quality Of Life | `settings-window.plugins-page.section.quality-of-life` | Settings section "Quality Of Life" in group User Interface. | `#settings-sec-cc-quality-of-life` | plugins-settings-ui.js | settings-sec-cc-*; section "Quality Of Life" |
| Hover Info | Settings Window > Plugins Page > Section > Hover Info | `settings-window.plugins-page.section.hover-info` | Settings section "Hover Info" in group User Interface. | `#settings-sec-cc-hover-info` | plugins-settings-ui.js | settings-sec-cc-*; section "Hover Info" |
| Bank | Settings Window > Plugins Page > Section > Bank | `settings-window.plugins-page.section.bank` | Settings section "Bank" in group User Interface. | `#settings-sec-cc-bank` | plugins-settings-ui.js | settings-sec-cc-*; section "Bank" |
| Sidebar | Settings Window > Plugins Page > Section > Sidebar | `settings-window.plugins-page.section.sidebar` | Settings section "Sidebar" in group User Interface. | `#settings-sec-cc-sidebar` | plugins-settings-ui.js | settings-sec-cc-*; section "Sidebar" |
| Combat Readout | Settings Window > Plugins Page > Section > Combat Readout | `settings-window.plugins-page.section.combat-readout` | Settings section "Combat Readout" in group User Interface. | `#settings-sec-cc-combat-readout` | plugins-settings-ui.js | settings-sec-cc-*; section "Combat Readout" |
| Combat: Player | Settings Window > Plugins Page > Section > Combat: Player | `settings-window.plugins-page.section.combat-player` | Settings section "Combat: Player" in group User Interface. | `#settings-sec-cc-combat:-player` | plugins-settings-ui.js | settings-sec-cc-*; section "Combat: Player" |
| Combat: Enemies | Settings Window > Plugins Page > Section > Combat: Enemies | `settings-window.plugins-page.section.combat-enemies` | Settings section "Combat: Enemies" in group User Interface. | `#settings-sec-cc-combat:-enemies` | plugins-settings-ui.js | settings-sec-cc-*; section "Combat: Enemies" |
| Combat: Allies | Settings Window > Plugins Page > Section > Combat: Allies | `settings-window.plugins-page.section.combat-allies` | Settings section "Combat: Allies" in group User Interface. | `#settings-sec-cc-combat:-allies` | plugins-settings-ui.js | settings-sec-cc-*; section "Combat: Allies" |
| Trackers and Queue | Settings Window > Plugins Page > Group > Trackers and Queue | `settings-window.plugins-page.group.trackers-and-queue` | Group heading "Trackers and Queue" with 2 sections. | `#settings-sec-cc-group-trackers-and-queue` | plugins-settings-ui.js | GROUPS |
| Trackers | Settings Window > Plugins Page > Section > Trackers | `settings-window.plugins-page.section.trackers` | Settings section "Trackers" in group Trackers and Queue. | `#settings-sec-cc-trackers` | plugins-settings-ui.js | settings-sec-cc-*; section "Trackers" |
| Queue and Tasks | Settings Window > Plugins Page > Section > Queue and Tasks | `settings-window.plugins-page.section.queue-and-tasks` | Settings section "Queue and Tasks" in group Trackers and Queue. | `#settings-sec-cc-queue-and-tasks` | plugins-settings-ui.js | settings-sec-cc-*; section "Queue and Tasks" |
| Planning and Routes | Settings Window > Plugins Page > Group > Planning and Routes | `settings-window.plugins-page.group.planning-and-routes` | Group heading "Planning and Routes" with 4 sections. | `#settings-sec-cc-group-planning-and-routes` | plugins-settings-ui.js | GROUPS |
| Route Advisor | Settings Window > Plugins Page > Section > Route Advisor | `settings-window.plugins-page.section.route-advisor` | Settings section "Route Advisor" in group Planning and Routes. | `#settings-sec-cc-route-advisor` | plugins-settings-ui.js | settings-sec-cc-*; section "Route Advisor" |
| Route Advisor: What It Optimises | Settings Window > Plugins Page > Section > Route Advisor: What It Optimises | `settings-window.plugins-page.section.route-advisor-what-it-optimises` | Settings section "Route Advisor: What It Optimises" in group Planning and Routes. | `#settings-sec-cc-route-advisor:-what-it-optimises` | plugins-settings-ui.js | settings-sec-cc-*; section "Route Advisor: What It Optimises" |
| Levers And Task Log | Settings Window > Plugins Page > Section > Levers And Task Log | `settings-window.plugins-page.section.levers-and-task-log` | Settings section "Levers And Task Log" in group Planning and Routes. | `#settings-sec-cc-levers-and-task-log` | plugins-settings-ui.js | settings-sec-cc-*; section "Levers And Task Log" |
| Walking Countdown | Settings Window > Plugins Page > Section > Walking Countdown | `settings-window.plugins-page.section.walking-countdown` | Settings section "Walking Countdown" in group Planning and Routes. | `#settings-sec-cc-walking-countdown` | plugins-settings-ui.js | settings-sec-cc-*; section "Walking Countdown" |
| Raids | Settings Window > Plugins Page > Group > Raids | `settings-window.plugins-page.group.raids` | Group heading "Raids" with 3 sections. | `#settings-sec-cc-group-raids` | plugins-settings-ui.js | GROUPS |
| Raid DPS | Settings Window > Plugins Page > Section > Raid DPS | `settings-window.plugins-page.section.raid-dps` | Settings section "Raid DPS" in group Raids. | `#settings-sec-cc-raid-dps` | plugins-settings-ui.js | settings-sec-cc-*; section "Raid DPS" |
| Raid Lobby Alerts | Settings Window > Plugins Page > Section > Raid Lobby Alerts | `settings-window.plugins-page.section.raid-lobby-alerts` | Settings section "Raid Lobby Alerts" in group Raids. | `#settings-sec-cc-raid-lobby-alerts` | plugins-settings-ui.js | settings-sec-cc-*; section "Raid Lobby Alerts" |
| Raid Summary | Settings Window > Plugins Page > Section > Raid Summary | `settings-window.plugins-page.section.raid-summary` | Settings section "Raid Summary" in group Raids. | `#settings-sec-cc-raid-summary` | plugins-settings-ui.js | settings-sec-cc-*; section "Raid Summary" |
| Notifications and Discord | Settings Window > Plugins Page > Group > Notifications and Discord | `settings-window.plugins-page.group.notifications-and-discord` | Group heading "Notifications and Discord" with 5 sections. | `#settings-sec-cc-group-notifications-and-discord` | plugins-settings-ui.js | GROUPS |
| Notifications | Settings Window > Plugins Page > Section > Notifications | `settings-window.plugins-page.section.notifications` | Settings section "Notifications" in group Notifications and Discord. | `#settings-sec-cc-notifications` | plugins-settings-ui.js | settings-sec-cc-*; section "Notifications" |
| Chat Relay | Settings Window > Plugins Page > Section > Chat Relay | `settings-window.plugins-page.section.chat-relay` | Settings section "Chat Relay" in group Notifications and Discord. | `#settings-sec-cc-chat-relay` | plugins-settings-ui.js | settings-sec-cc-*; section "Chat Relay" |
| Chat Relay Pings | Settings Window > Plugins Page > Section > Chat Relay Pings | `settings-window.plugins-page.section.chat-relay-pings` | Settings section "Chat Relay Pings" in group Notifications and Discord. | `#settings-sec-cc-chat-relay-pings` | plugins-settings-ui.js | settings-sec-cc-*; section "Chat Relay Pings" |
| Clan Hiscores | Settings Window > Plugins Page > Section > Clan Hiscores | `settings-window.plugins-page.section.clan-hiscores` | Settings section "Clan Hiscores" in group Notifications and Discord. | `#settings-sec-cc-clan-hiscores` | plugins-settings-ui.js | settings-sec-cc-*; section "Clan Hiscores" |
| Activity Digest | Settings Window > Plugins Page > Section > Activity Digest | `settings-window.plugins-page.section.activity-digest` | Settings section "Activity Digest" in group Notifications and Discord. | `#settings-sec-cc-activity-digest` | plugins-settings-ui.js | settings-sec-cc-*; section "Activity Digest" |

### Drawers (20)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Lever Advisor Drawer | Lever Advisor Drawer | `lever-advisor-drawer` | Slides out of the right edge of the Skills Customization Window: route select, pick list, why-table. Display only. | `#cc-lever-drawer` | lever-advisor.js | Lever Advisor; cc-lever-drawer; cc-lever-panel (old id kept in ui-scale, ui-layout, kit GUARD); windowDrawer / **CLASH:** Old id cc-lever-panel and the word "panel" survive in several lists; it is a Drawer, not a Panel, and has no resize or fuse. |
| Tab | Lever Advisor Drawer > Tab | `lever-advisor-drawer.tab` | Vertical gold tab on the window edge; click folds or opens; badge shows the pick count. | `#cc-lever-drawer .cc-wd-tab` | ui-kit.js | cc-wd-tab |
| Badge | Lever Advisor Drawer > Tab > Badge | `lever-advisor-drawer.tab.badge` | Count bubble inside the tab. | `.cc-wd-tab i` | ui-kit.js | setBadge |
| Box | Lever Advisor Drawer > Box | `lever-advisor-drawer.box` | The sliding sheet. | `.cc-wd-box` | ui-kit.js | cc-wd-box |
| Header | Lever Advisor Drawer > Header | `lever-advisor-drawer.header` | Title, chip text and a fold button. | `.cc-wd-hd` | ui-kit.js | cc-wd-hd; setChip |
| Body | Lever Advisor Drawer > Body | `lever-advisor-drawer.body` | Scrolling content. | `.cc-wd-bd` | ui-kit.js | cc-wd-bd |
| Route Select | Lever Advisor Drawer > Route Select | `lever-advisor-drawer.route-select` | Dropdown choosing the route or plan to follow. | `#cc-lever-drawer select` | lever-advisor.js | select.route |
| Summary | Lever Advisor Drawer > Summary | `lever-advisor-drawer.summary` | One big line: total pulls and releases. | `#cc-lever-drawer .sum` | lever-advisor.js | sum |
| Pick List | Lever Advisor Drawer > Pick List | `lever-advisor-drawer.pick-list` | Stack of Pick Items. | `#cc-lever-drawer .list` | lever-advisor.js | list |
| Item | Lever Advisor Drawer > Pick List > Item | `lever-advisor-drawer.pick-list.item` | One lever to pull (gold) or release (red); click to scroll to it. | `#cc-lever-drawer .it` | lever-advisor.js | it; it.pull; it.rel |
| Why Details | Lever Advisor Drawer > Why Details | `lever-advisor-drawer.why-details` | Collapsible "Why these picks?" table. | `#cc-lever-drawer details.why` | lever-advisor.js | why; whyb |
| Tree Map Drawer | Tree Map Drawer | `tree-map-drawer` | Canvas map of the tree build that slides out beside the Tree Advisor Panel. | `#cc-treeadv-drawer` | tree-advisor.js | Tree Advisor drawer; cc-treeadv-drawer |
| Tab | Tree Map Drawer > Tab | `tree-map-drawer.tab` | Vertical tab on the panel edge that shows or hides the drawer. | `#cc-treeadv-tab` | tree-advisor.js | cc-treeadv-tab |
| Header | Tree Map Drawer > Header | `tree-map-drawer.header` | Gold heading line. | `#cc-treeadv-drawer .dh` | tree-advisor.js | dh |
| Legend | Tree Map Drawer > Legend | `tree-map-drawer.legend` | Dot legend under the canvas. | `#cc-treeadv-drawer .leg` | tree-advisor.js | leg |
| Route Map Drawer | Route Map Drawer | `route-map-drawer` | Map of the planned route that slides out of the Route Advisor Panel's outer edge. | `#cc-route-map` | route-advisor.js | Route map; cc-route-map; Map Drawer / **CLASH:** Own CSS and ids, not .cc-wd. |
| Tab | Route Map Drawer > Tab | `route-map-drawer.tab` | Vertical blue tab "Map" on the edge. | `#cc-route-maptab` | route-advisor.js | cc-route-maptab |
| Header | Route Map Drawer > Header | `route-map-drawer.header` | Title and close button. | `#cc-route-map .rt-head` | route-advisor.js | rt-head; rt-ttl; rt-x |
| Legend | Route Map Drawer > Legend | `route-map-drawer.legend` | Row of line-style explanations under the map. | `#cc-route-map .rt-maplegend` | route-advisor.js | rt-maplegend |
| Walking Countdown Drawer | Walking Countdown Drawer | `walking-countdown-drawer` | The Walking Countdown docked flush under the Game Current Task Panel, sliding down out of its bottom edge. | `#cc-walk-countdown.cc-walk-drawer` | walking-countdown.js | cc-walk-drawer; cc-open / **CLASH:** The same element is the free-floating Walking Countdown widget when undocked. |

### Bars (28)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Info Bar | Info Bar | `info-bar` | Customisable bar along the top and/or bottom of the screen holding Modules. The game and panels are laid out in the space left. | `.cc-bar` | ui-bar.js | Titan Panel; cc-bar; cc-ibar; top bar; bottom bar / **CLASH:** Not a progress bar, not the Game Panel Tab Bar, not the Controls Bar of the queue. |
| Top | Info Bar > Top | `info-bar.top` | The info bar attached to the top edge. | `.cc-bar[data-pos=top]` | ui-bar.js | data-pos=top |
| Bottom | Info Bar > Bottom | `info-bar.bottom` | The info bar attached to the bottom edge. | `.cc-bar[data-pos=bottom]` | ui-bar.js | data-pos=bottom; .bottom |
| Left Zone | Info Bar > Left Zone | `info-bar.left-zone` | Left third: modules grow rightwards. | `.cc-bar .zl` | ui-bar.js | zl; cc-z.l (kit) / **CLASH:** Kit defines .cc-z but only .zl .zc .zr are used. |
| Middle Zone | Info Bar > Middle Zone | `info-bar.middle-zone` | Centre third. | `.cc-bar .zc` | ui-bar.js | zc; cc-z.m (kit) |
| Right Zone | Info Bar > Right Zone | `info-bar.right-zone` | Right third: modules grow leftwards. | `.cc-bar .zr` | ui-bar.js | zr; cc-z.r (kit) |
| Module | Info Bar > Module | `info-bar.module` | One cell of the bar: icon, text, optional progress line. Idle, hover, active, attention dot. | `.cc-bar .m` | ui-bar.js | m; module; cc-mod (kit, unused) / **CLASH:** Kit .cc-mod is the designed class; the live bar uses .m. |
| Icon | Info Bar > Module > Icon | `info-bar.module.icon` | Emoji or icon at the left. | `.cc-bar .m .i` | ui-bar.js | i |
| Text | Info Bar > Module > Text | `info-bar.module.text` | The value text. | `.cc-bar .m .t` | ui-bar.js | t; tx |
| Progress Line | Info Bar > Module > Progress Line | `info-bar.module.progress-line` | Thin 2 px accent line along the bottom of a module. | `.cc-bar .m .f` | ui-bar.js | f; ln (kit) |
| Task Module | Info Bar > Task Module | `info-bar.task-module` | Current task with progress and time left; hover shows the Queue Hover Card. | `.cc-bar .m` | ui-bar.js | task; Current task |
| Location Module | Info Bar > Location Module | `info-bar.location-module` | Where you are and what you are doing. | `.cc-bar .m` | ui-bar.js | where; Location |
| XP Per Hour Module | Info Bar > XP Per Hour Module | `info-bar.xp-per-hour-module` | XP/hr; click opens the XP Tracker Panel. | `.cc-bar .m` | ui-bar.js | xp; XP per hour |
| Gold Module | Info Bar > Gold Module | `info-bar.gold-module` | Coins held. | `.cc-bar .m` | ui-bar.js | gold |
| Blood Coins Module | Info Bar > Blood Coins Module | `info-bar.blood-coins-module` | Blood coins held. | `.cc-bar .m` | ui-bar.js | blood |
| Clock Module | Info Bar > Clock Module | `info-bar.clock-module` | Local time. | `.cc-bar .m` | ui-bar.js | clock |
| Inventory Space Module | Info Bar > Inventory Space Module | `info-bar.inventory-space-module` | Free inventory slots. | `.cc-bar .m` | ui-bar.js | inv |
| Game Event Module | Info Bar > Game Event Module | `info-bar.game-event-module` | Current game event and days left. | `.cc-bar .m` | ui-bar.js | event |
| Hit Points Module | Info Bar > Hit Points Module | `info-bar.hit-points-module` | HP as numbers or a bar; can hide the Game HP Bar. | `.cc-bar .m` | ui-bar.js | hp; Hit points / **CLASH:** Not the HP Panel and not the Game HP Bar. |
| Alerts Module | Info Bar > Alerts Module | `info-bar.alerts-module` | Bell count; hover opens the Alert List, click toggles it. | `.cc-bar .m` | ui-bar.js | alerts |
| Chat Module | Info Bar > Chat Module | `info-bar.chat-module` | Latest chat line as a stretchy button. | `.cc-bar .m.fw` | ui-bar.js | chat; fw |
| Active Potions Module | Info Bar > Active Potions Module | `info-bar.active-potions-module` | Potions and food as numbers or icons with charges. | `.cc-bar .m` | ui-bar.js | potions |
| Spacer Module | Info Bar > Spacer Module | `info-bar.spacer-module` | Empty space of set width, optional divider line. | `.cc-bar .m.sp` | ui-bar.js | space; sp; ln; cc-spacer (kit) |
| Panel Buttons Module | Info Bar > Panel Buttons Module | `info-bar.panel-buttons-module` | Group of Panel Buttons (Tasks, Skills, Equipment, Inventory, Diary, Quests, Friends, Barter) that open or pin Cards. | `.cc-bar .m .pc` | ui-bar.js | panelbtns; pc |
| Panel Button | Info Bar > Panel Buttons Module > Panel Button | `info-bar.panel-buttons-module.panel-button` | One icon/text button; .on = its card is open; dot = attention. | `.cc-bar .m .pi.btn` | ui-bar.js | pi; pbtn; pi.btn / **CLASH:** Single "pbtn" module = the same button as its own Module. |
| Attention Dot | Info Bar > Panel Buttons Module > Panel Button > Attention Dot | `info-bar.panel-buttons-module.panel-button.attention-dot` | Small gold dot on a button. | `.cc-bar .m .pi .dot` | ui-bar.js | dot |
| Layout Editor Bar | Layout Editor Bar | `layout-editor-bar` | Toolbar at the top of the screen in layout edit mode: profile, snap, grid, Tidy, export/import, Done. | `#cc-ed-bar` | ui-layout.js | cc-ed-bar; cc-lbar (kit design) / **CLASH:** Kit defines .cc-lbar for this job; the live one is #cc-ed-bar. |
| Notification Edit Bar | Notification Edit Bar | `notification-edit-bar` | Floating bar shown while moving notification frames (Done / Reset). | `.cc-nd-bar` | notif-dock.js | cc-nd-bar |

### Cards and rows (55)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Card | Card | `card` | A self-framed, fixed-height list item that is the main object of its panel (task card, plan card, pet card). A plain list line is a Row. | `.cc-q-row` | ui-queue.js | cc-q-row; uq-row (game); cc-card (legacy) / **CLASH:** Code "card" means three different things; see Pinned Card and Legacy Card. |
| Card | Queue Panel > Card | `queue-panel.card` | One queued task: number, Tile, title, subtitle, time/XP, dots. Same DOM in the Queue Panel and the Queue Hover Card. | `.cc-q-row` | ui-queue.js | cc-q-row; Task card; Task row / **CLASH:** Class says "row", our name is Card. |
| Number | Queue Panel > Card > Number | `queue-panel.card.number` | Slot number (">" on the current one); an accent mark flags a repeat. | `.cc-q-num` | ui-queue.js | cc-q-num |
| Tile | Queue Panel > Card > Tile | `queue-panel.card.tile` | Skill or mob picture with a 3 px lane outline (green skilling, red combat) and corner markers. | `.cc-q-tile` | ui-queue.js | cc-q-tile; cc-tile; cc-mobico (mob picture) |
| Category Markers | Queue Panel > Card > Tile > Category Markers | `queue-panel.card.tile.category-markers` | At most two game icons at the lower right: lucky clover, quest book, diary book, boost square, teleport crystal. | `.cc-q-mk` | ui-queue.js | cc-q-mk; cc-q-mkb |
| Shortage Mark | Queue Panel > Card > Tile > Shortage Mark | `queue-panel.card.tile.shortage-mark` | Warning triangle or round i at the upper right of the tile. | `.cc-q-tile[data-m]` | ui-queue.js | data-m=bad\|warn\|save |
| Title | Queue Panel > Card > Title | `queue-panel.card.title` | Task name with amount and tier tag. | `.cc-q-tt` | ui-queue.js | cc-q-tt |
| Tier Tag | Queue Panel > Card > Title > Tier Tag | `queue-panel.card.title.tier-tag` | Small boxed "L40" style tag after the title. | `.cc-q-tier` | ui-queue.js | cc-q-tier; cc-tierchip (kit) |
| Material Note | Queue Panel > Card > Title > Material Note | `queue-panel.card.title.material-note` | Tiny boxed text about a material shortage. | `.cc-q-matnote` | ui-queue.js | cc-q-matnote |
| Subtitle | Queue Panel > Card > Subtitle | `queue-panel.card.subtitle` | Skill and location line. | `.cc-q-sub` | ui-queue.js | cc-q-sub; su (kit row) |
| Meta | Queue Panel > Card > Meta | `queue-panel.card.meta` | Right column: time, XP and XP/hr. | `.cc-q-meta` | ui-queue.js | cc-q-meta; mt (kit row) |
| Time | Queue Panel > Card > Meta > Time | `queue-panel.card.meta.time` | Duration, bold. | `.cc-q-time` | ui-queue.js | cc-q-time |
| XP | Queue Panel > Card > Meta > XP | `queue-panel.card.meta.xp` | XP gained / goal. | `.cc-q-xp` | ui-queue.js | cc-q-xp; cc-q-dn; cc-q-nx |
| Dots | Queue Panel > Card > Dots | `queue-panel.card.dots` | Column of dots, one per alternative option; the picked one is gold. | `.cc-q-dots` | ui-queue.js | cc-q-dots |
| Progress Bar | Queue Panel > Card > Progress Bar | `queue-panel.card.progress-bar` | Thin bar under the current card's text. | `.cc-q-bar` | ui-queue.js | cc-q-bar; cc-prog |
| Walking Gap | Queue Panel > Walking Gap | `queue-panel.walking-gap` | Slim connector between two Cards carrying the Walking Pill; colour = walk length. | `.cc-q-hop` | ui-queue.js | cc-q-hop; hop; walk / **CLASH:** Called "hop" in code. |
| Walking Pill | Queue Panel > Walking Gap > Walking Pill | `queue-panel.walking-gap.walking-pill` | Pill with walking minutes and steps; purple for a teleport. | `.cc-q-hop .cc-pill` | ui-queue.js | cc-pill; --w |
| Queue Hover Card | Queue Hover Card | `queue-hover-card` | The Queue Panel's content in hover mode inside the Info Bar hover card, with its own header and shell. | `.cc-qroot[data-mode=hover]` | ui-queue.js | hover card; data-mode=hover; cc-q-panel; cc-q-head |
| Header | Queue Hover Card > Header | `queue-hover-card.header` | Two-line header: "Task queue" and the summary. | `.cc-qroot[data-mode=hover] .cc-q-head` | ui-queue.js | cc-q-head; cc-q-h |
| Hover Card | Hover Card | `hover-card` | Generic: a Panel in data-mode=hover (no buttons, no grip) shown while the pointer is over a trigger. Library design; the live version is the Info Bar Hover Card. | `.cc-panel[data-mode=hover]` | ui-kit.js | data-mode=hover / **CLASH:** Live code does not use this attribute on the info bar's hover cards; they are #cc-bar-tip. |
| Hover Card | Info Bar > Hover Card | `info-bar.hover-card` | Rich floating card under a Module or Panel Button: skills grid, inventory, quests, friends, equipment... Pointer can enter it. | `#cc-bar-tip` | ui-bar.js | cc-bar-tip; tip; tipEl; ccx (content scope) / **CLASH:** Named "tip" in code; it is a Card, because the pointer moves into it. A Tooltip never takes the pointer. |
| Header | Info Bar > Hover Card > Header | `info-bar.hover-card.header` | Heading line of the card. | `#cc-bar-tip .th` | ui-bar.js | th |
| Cell | Info Bar > Hover Card > Cell | `info-bar.hover-card.cell` | Item or skill cell with level badge and progress, in a grid. | `.ccx .tcell` | ui-bar.js | tcell; tg (grid) / **CLASH:** Not .cc-cell. |
| Tab Row | Info Bar > Hover Card > Tab Row | `info-bar.hover-card.tab-row` | Chips row (loadouts or filters) at the top of a card. | `.ccx .ttabs` | ui-bar.js | ttabs; tadd; tplus; tload |
| Task Options Hover Card | Task Options Hover Card | `task-options-hover-card` | Second card beside the Info Bar Hover Card showing one task's alternatives as Option Blocks with stats. | `#cc-bar-tip2` | ui-bar.js | cc-bar-tip2; tip2 |
| Option Block | Task Options Hover Card > Option Block | `task-options-hover-card.option-block` | One alternative: skill picture, name, tags, four stat tiles. | `#cc-bar-tip2 .tbx` | ui-bar.js | tbx; tbx.ob; tbx.on |
| Stat Tiles | Task Options Hover Card > Option Block > Stat Tiles | `task-options-hover-card.option-block.stat-tiles` | Grid of Time, XP, XP/hour, Success, XP bonus. | `#cc-bar-tip2 .otl` | ui-bar.js | otl; ot |
| Pinned Card | Pinned Card | `pinned-card` | A kept Panel showing one Info Bar button's content (same content as its Hover Card). Id is cc-card-<tab>. | `.cc-card-pin` | ui-bar.js | cc-card-<tab>; card (ui-bar); pinned card / **CLASH:** The code calls it "card" but it is a Panel; the user-facing name is Pinned Card because it is born from a Hover Card. |
| Skills Pinned Card | Skills Pinned Card | `skills-pinned-card` | Pinned Card for Skills. | `[id="cc-card-skills"]` | ui-bar.js (hosting); cards/skills.js (content) | cc-card-skills |
| Inventory Pinned Card | Inventory Pinned Card | `inventory-pinned-card` | Pinned Card for Inventory. | `[id="cc-card-inventory"]` | ui-bar.js (hosting); cards/inventory.js (content) | cc-card-inventory |
| Equipment Pinned Card | Equipment Pinned Card | `equipment-pinned-card` | Pinned Card for Equipment. | `[id="cc-card-equipment"]` | ui-bar.js (hosting); cards/equipment.js (content) | cc-card-equipment |
| Diary Pinned Card | Diary Pinned Card | `diary-pinned-card` | Pinned Card for Diary. | `[id="cc-card-diary"]` | ui-bar.js (hosting); cards/diary.js (content) | cc-card-diary |
| Quests Pinned Card | Quests Pinned Card | `quests-pinned-card` | Pinned Card for Quests. | `[id="cc-card-quests"]` | ui-bar.js (hosting); cards/quests.js (content) | cc-card-quests |
| Friends Pinned Card | Friends Pinned Card | `friends-pinned-card` | Pinned Card for Friends. | `[id="cc-card-friends"]` | ui-bar.js (hosting); cards/friends.js (content) | cc-card-friends |
| Barter Pinned Card | Barter Pinned Card | `barter-pinned-card` | Pinned Card for Barter. | `[id="cc-card-barter"]` | ui-bar.js (hosting); cards/barter.js (content) | cc-card-barter |
| Legacy Card | Legacy Card | `legacy-card` | Old left-border list item; kept as an alias for third-party plugins. Use Row. | `.cc-card` | ui-kit.js | cc-card / **CLASH:** Clashes with Card, Pinned Card and the cc-card-<tab> panel ids. |
| Route Plan Card | Route Plan Card | `route-plan-card` | One path in the Route Advisor Panel: title, gain, bar, stats, steps. Gold edge = selected, blue = quest, purple = teleports. | `#cc-route-panel .rt-plan` | route-advisor.js | rt-plan; path card; pathCard / **CLASH:** Called "plan"; it is a Card. |
| Title | Route Plan Card > Title | `route-plan-card.title` | Path name (Skilling XP, Combat XP, Quests and scrolls) plus Best badge and big value. | `#cc-route-panel .rt-plan h4` | route-advisor.js | rt-ptitle; rt-badge; rt-big |
| Bar | Route Plan Card > Bar | `route-plan-card.bar` | Share-of-best bar in the path colour. | `#cc-route-panel .rt-pbar` | route-advisor.js | rt-pbar |
| Stats | Route Plan Card > Stats | `route-plan-card.stats` | Wrapping line: Total, Walk, XP/hr, vs now, teleports, swaps. | `#cc-route-panel .rt-pstats` | route-advisor.js | rt-pstats |
| Steps Button | Route Plan Card > Steps Button | `route-plan-card.steps-button` | Show / Hide steps button. | `#cc-route-panel .rt-steps-btn` | route-advisor.js | rt-steps-btn |
| Stops List | Route Plan Card > Stops List | `route-plan-card.stops-list` | Numbered list of stops. | `#cc-route-panel ol.rt-stops` | route-advisor.js | rt-stops |
| Route Current Queue Card | Route Current Queue Card | `route-current-queue-card` | Selectable card for "your queue as it is now" in the Route Advisor Panel. | `#cc-route-panel .rt-curnow` | route-advisor.js | rt-curnow |
| Goal Skill Row | Goal Skill Row | `goal-skill-row` | Row: skill, level range, XP left, time to goal, thin bar, pin button. | `#cc-goals .cc-row` | goals.js | skillRow; cc-row nolf |
| Goal Pet Row | Goal Pet Row | `goal-pet-row` | Row: pet name, odds, expected time. | `#cc-goals .cc-row` | goals.js | cc-row nolf |
| Goal Hunt Row | Goal Hunt Row | `goal-hunt-row` | Row: item hunt with kills and expected time; star pins it. | `#cc-goals .cc-row` | goals.js | huntRow; cc-row nolf |
| XP Skill Row | XP Skill Row | `xp-skill-row` | Row in the XP Tracker Panel: icon, name, rate, share bar, extra. | `#cc-xp-tracker .xp-row` | xp-tracker.js | xp-row; xp-row.sel / **CLASH:** Not .cc-row. |
| Drop Luck Row | Drop Luck Row | `drop-luck-row` | Left-coloured row in the Drop Luck Panel (red/orange/yellow/green by luck). | `#cc-droplog .row` | drop-luck.js | row; row.r .o .y .g; mini / **CLASH:** Not .cc-row. |
| Pet Card | Pet Card | `pet-card` | Pet picture, name, status; own = green, shiny = animated gold. | `#cc-droplog .pcard` | drop-luck.js | pcard; pgrid; pic; pt; pn; ps |
| Drop Luck Chip Card | Drop Luck Chip Card | `drop-luck-chip-card` | Small boxed fact with a coloured left edge. | `#cc-droplog .chip` | drop-luck.js | chip / **CLASH:** Named .chip but is a card; not .cc-chip. |
| Shiny Bar Card | Shiny Bar Card | `shiny-bar-card` | Gradient strip announcing shiny pets. | `#cc-droplog .shinybar` | drop-luck.js | shinybar |
| Saved Build Row | Saved Build Row | `saved-build-row` | Row in Tree Advisor's My builds: name, tree, node count, buttons. | `#cc-treeadv .row` | tree-advisor.js | row |
| Chat Message | Chat Message | `chat-message` | One chat line: timestamp, channel tag, badges, name, text, repeat count; gold edge = mention. | `#cc-chat .cm` | chat-plus.js | cm; cm.hl; ts; tg; bg; nm; ct; cc-msg (kit) |
| Alert Item | Alert Item | `alert-item` | One alert in the Alert List: Tile, title, sub, go button, dismiss. | `#cc-alertbell .cc-alert` | alert-bell.js | cc-alert it; ti; su |
| Fortress Log Item | Fortress Log Item | `fortress-log-item` | One timed drop line in the Fortress tab. | `#cc-droplog .ft-log .li` | fortress-tracker.js | li; li.mate .rare .milestone |

### Menus (24)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Menu | Menu | `menu` | The kit menu: floating list of Menu Items opened by UI.menu() at the pointer or under a button; closes on outside click or Escape. | `.cc-menu` | ui-kit.js | context menu; dropdown; cc-menu; role=menu / **CLASH:** Class cc-menu is ALSO the ScapeLite Logo Menu (#cc-slmenu) and a submenu inside a Menu Item. Say Logo Menu for that one. |
| Heading | Menu > Heading | `menu.heading` | Small uppercase line that names a group (also holds "Clear all" in the Alert List). | `.cc-menu .cc-mh` | ui-kit.js | cc-mh; head: |
| Item | Menu > Item | `menu.item` | One row: check column, label, hint or count badge. aria-checked true / false / mixed. | `.cc-menu .cc-mi` | ui-kit.js | cc-mi; role=menuitem |
| Check | Menu > Item > Check | `menu.item.check` | Left column showing a tick or dash. | `.cc-mi .ck` | ui-kit.js | ck; mark |
| Hint | Menu > Item > Hint | `menu.item.hint` | Right-aligned faint text (shortcut or explanation). | `.cc-mi .hint` | ui-kit.js | hint |
| Submenu | Menu > Submenu | `menu.submenu` | Nested Menu that opens to the side when its parent item is hovered; flips left near the screen edge. | `.cc-mi.sub > .cc-menu` | ui-kit.js | cc-mi sub; flip |
| Separator | Menu > Separator | `menu.separator` | Thin line between groups. | `.cc-msep` | ui-kit.js | cc-msep; sep |
| Slider Row | Menu > Slider Row | `menu.slider-row` | Label, value and a range input inside a menu. | `.cc-mslider` | ui-kit.js | cc-mslider; slider |
| Align Grid | Menu > Align Grid | `menu.align-grid` | 3x3 grid of arrow buttons to align a panel. | `.cc-align` | ui-kit.js | cc-align |
| Panel Gear Menu | Panel Gear Menu | `panel-gear-menu` | Menu opened by a Panel's Gear Button; items come from the plugin. | `.cc-menu` | ui-kit.js | setGear; gear.items |
| Panel Title Menu | Panel Title Menu | `panel-title-menu` | Right-click a ScapeLite panel's title: size presets 50-150%, lock, fuse, extras added by plugins. | `.cc-menu` | ui-scale.js | __ccPanelMenu; size menu |
| Queue Panel Gear Menu | Queue Panel Gear Menu | `queue-panel-gear-menu` | Queue Panel settings: tray side, hide chosen task, walking display ... | `.cc-menu` | ui-queue.js | Task queue settings |
| Info Bar Menu | Info Bar Menu | `info-bar-menu` | Right-click a bar or module: add or remove a module, move to left/middle/right/other bar, height, opacity, module options. | `.cc-menu` | ui-bar.js | bar context menu |
| Alert Bell Menu | Alert Bell Menu | `alert-bell-menu` | Right-click the bell: Filter alerts (categories and individual), hide the bell, lock, reset position. | `.cc-menu` | alert-bell.js | bell menu |
| Logo Menu | Logo Menu | `logo-menu` | Menu that opens beside the ScapeLite Logo Button on hover: lists the ScapeLite panels with check marks and hints. | `#cc-slmenu` | scapelite-menu.js | ScapeLite menu; cc-slmenu; cc-menu / **CLASH:** Uses class cc-menu like every Menu, but is positioned and hover-driven by itself and is not built by UI.menu(). |
| Item | Logo Menu > Item | `logo-menu.item` | One ScapeLite panel with check = open, plus a hint line. | `#cc-slmenu .cc-mi` | scapelite-menu.js | cc-mi |
| Settings Quick-Jump Menu | Settings Quick-Jump Menu | `settings-quick-jump-menu` | Dropdown under a Settings Header Nav button listing that category's sections; click scrolls there. | `.cc-sn-menu` | settings-nav.js | Settings quick-jump; settings nav menu; cc-sn-menu / **CLASH:** Own implementation, not .cc-menu. |
| Item | Settings Quick-Jump Menu > Item | `settings-quick-jump-menu.item` | One entry; .sn-grp has a submenu arrow, .sn-set is a single setting. | `.cc-sn-menu .sn-i` | settings-nav.js | sn-i; sn-grp; sn-set |
| Heading | Settings Quick-Jump Menu > Heading | `settings-quick-jump-menu.heading` | Small uppercase group name. | `.cc-sn-menu .sn-h` | settings-nav.js | sn-h |
| Icon Group Flyout | Icon Group Flyout | `icon-group-flyout` | Menu beside a grouped button of the Game Left Icon Strip, listing the grouped windows with icons and hotkeys. | `#cc-sbgmenu` | sidebar-tabs.js | sbgmenu; sidebar group menu / **CLASH:** Own implementation, not .cc-menu. |
| Game Panel Menu | Game Panel Menu | `game-panel-menu` | Right-click a game panel's titlebar: lock, lock all, hide, scale presets, anchor corner. | `.cc-pm` | panel-resize.js | cc-pm; pm-h; pm-i; pm-sep; panel menu / **CLASH:** Own implementation, not .cc-menu. |
| Bank Filter Dropdown | Bank Filter Dropdown | `bank-filter-dropdown` | List of sub-categories (with counts) opened by hovering Raw, Processed, Equipment or Potions in the Bank filters. | `.cc-bank-dd` | bank-tools.js | cc-bank-dd; it; hd / **CLASH:** Own implementation, not .cc-menu. |
| Bank Settings Menu | Bank Settings Menu | `bank-settings-menu` | Menu behind the renamed "Settings" button: Sort, Swap, Insert and options with switch pills. | `.cc-bank-set` | bank-tools.js | cc-bank-set; it; pill / **CLASH:** Its ".pill" is a switch, not a Pill component. |
| Layout Editor Group Menu | Layout Editor Group Menu | `layout-editor-group-menu` | Small menu on a layout frame for joining panels into tab groups. | `#cc-ed-root .gm` | ui-layout.js | gm; gh |

### Tooltips and popovers (19)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Tooltip | Tooltip | `tooltip` | The kit tooltip: one shared box that follows the pointer, never takes it, holds a title and key-value lines. | `.cc-tip` | ui-kit.js | cc-tip; ccTip; hover tip / **CLASH:** The Info Bar's #cc-bar-tip is NOT this: it is a Hover Card. |
| Popover | Popover | `popover` | Anchored detail box for a thing (option, row). Library only. | `.cc-pop` | ui-kit.js | cc-pop / **CLASH:** The queue draws its own (Queue Option Popover). |
| Queue Option Popover | Queue Option Popover | `queue-option-popover` | Box under or above an Option Tile: name, sub line, key-value list and tag lines. | `.cc-q-pop` | ui-queue.js | cc-q-pop |
| Queue Task Tooltip | Queue Task Tooltip | `queue-task-tooltip` | The game's own task tooltip cloned into a gold-framed box beside a Card, with extra lines from ScapeLite. | `#cc-q-tip3` | ui-queue.js | cc-q-tip3; cc-tt-clone; cc-q-xtra |
| Game Tooltip | Game Tooltip | `game-tooltip` | The game's own tooltip (.tooltip / .tt-name / .tt-line). ScapeLite appends blocks to it; never replaces it. | `.tooltip` | hover-info.js | tooltip; tt-line; tt-name; ctrl-global-tooltip |
| Task XP Preview | Game Tooltip > Task XP Preview | `game-tooltip.task-xp-preview` | Added lines: XP bar showing what the task gives, level-up note, time and XP/hr. | `.cc-xb` | hover-info.js | cc-xb; cc-xb-head; cc-xb-lv; cc-xb-cur; cc-xb-gain; cc-xb-dim |
| Slay XP Block | Game Tooltip > Slay XP Block | `game-tooltip.slay-xp-block` | Added header and chips for kill-task XP and rate. | `.cc-sx-head` | hover-info.js | cc-sx-head; cc-sx-chips; cc-sx-chip; cc-sx-dim; cc-sx-note |
| Quest Lines | Game Tooltip > Quest Lines | `game-tooltip.quest-lines` | Added quest rows in the task tooltip. | `.cc-qr` | hover-info.js | cc-qr; cc-qr-row; cc-qr-up |
| Skill Queue Badge | Game Tooltip > Skill Queue Badge | `game-tooltip.skill-queue-badge` | Added "Queued tasks: +XP" block with progress and level-up note on a skill tooltip. | `.cc-skq-fill` | hover-info.js | cc-skq; cc-skq-h; cc-skq-up; cc-skq-badge; cc-skq-fill |
| Lever Explanation | Game Tooltip > Lever Explanation | `game-tooltip.lever-explanation` | Blue block appended to the lever tooltip explaining what weight or quantity really does. | `.cc-mech` | mechanics-explainer.js | cc-mech |
| Bank Categories | Game Tooltip > Bank Categories | `game-tooltip.bank-categories` | Chips listing the bank categories of the hovered item. | `.cc-bank-chips` | bank-tools.js | cc-bank-chips |
| Window Control Tooltip | Window Control Tooltip | `window-control-tooltip` | The game's tooltip over a Window Controls button, restyled bigger and gold-titled by the Window Controls Dock. | `.tooltip.global-tooltip.window-control-style` | window-dock.js | window-control-style |
| Route Variant Tooltip | Route Variant Tooltip | `route-variant-tooltip` | Table of what-if gains (keep picks / optimise x on foot / teleports) with a detail line; opens on hovering the What You Could Gain table. | `.rt-vtip` | route-advisor.js | rt-vtip; cc-route-vtip; rt-vt; rt-vdet; rt-vleg |
| Tree Tooltip | Tree Tooltip | `tree-tooltip` | Box over a node on the Tree Map or preview with its name and effect. | `.cc-tadv-tip` | tree-advisor.js | cc-tadv-tip |
| Craft Potential Tooltip | Craft Potential Tooltip | `craft-potential-tooltip` | Large list of the recipes behind the Craft Potential estimate, shown over the XP bar. | `.cc-pot-tip` | craft-potential.js | cc-pot-tip; th; tb; tf |
| Raid DPS Graph Tooltip | Raid DPS Graph Tooltip | `raid-dps-graph-tooltip` | Per-player values at the pointer on the Raid DPS graph. | `.cc-rdps-ptip` | raid-dps-extra.js | cc-rdps-ptip |
| Raid DPS Info Tip | Raid DPS Info Tip | `raid-dps-info-tip` | Small explanation box on the Party line or tabs. | `.cc-rdps-tip` | raid-dps-extra.js | cc-rdps-tip |
| Author Card | Author Card | `author-card` | Popover with the author's links when hovering the author tag of a Plugins section. | `.cc-author` | plugins-settings-ui.js | cc-author; author tag; authorCard / **CLASH:** Created with inline styles, no class on the card itself. |
| Status Indicator Popup | Status Indicator Popup | `status-indicator-popup` | Panel that opens above the Status Indicator on hover: reload, rows with LEDs, performance, dashboard links. | `.cc-si-menu` | status-indicator.js | cc-si-menu / **CLASH:** Called "menu" in code; it is a hover popover, not a Menu. |

### Trays (5)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Tray | Tray | `tray` | A short strip of option tiles that pops out of a surface edge, outside any panel body, never pushing content. Library version. | `.cc-tray` | ui-kit.js | cc-tray; is-on |
| Queue Options Tray | Queue Options Tray | `queue-options-tray` | The strip of alternatives (and reroll) beside a Card: Option Tiles with outlines for chosen, advisor pick and fastest. | `.cc-q-tray` | ui-queue.js | cc-q-tray; option tray; alternatives tray; cc-q-trayhost (fixed host) / **CLASH:** Called "options tray" in notes and "alternatives" in commits: use Queue Options Tray. |
| Option Tile | Queue Options Tray > Option Tile | `queue-options-tray.option-tile` | One alternative task as a Tile; click picks it. | `.cc-q-opt` | ui-queue.js | cc-q-opt; cc-tile |
| Reroll Tile | Queue Options Tray > Reroll Tile | `queue-options-tray.reroll-tile` | Tile with a circular arrow that rerolls the task; dimmed when you cannot afford it. | `.cc-q-reroll` | ui-queue.js | cc-q-reroll; cc-q-glyph |
| Host | Queue Options Tray > Host | `queue-options-tray.host` | Fixed full-screen layer that holds the tray above neighbouring panels. | `.cc-q-trayhost` | ui-queue.js | cc-q-trayhost |

### Modals (9)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Modal | Modal | `modal` | Centred dialog over a dim scrim that blocks the game until closed. Library version: scrim, card, dots, buttons. | `.cc-modal` | ui-kit.js | cc-modal; cc-scrim; confirm / **CLASH:** The game calls its big windows "modal"; here Modal means a ScapeLite dialog that dims the game. |
| Welcome Tour | Welcome Tour | `welcome-tour` | First-run and guide dialog with step title, body, optional link row, dots and Back / Next / Skip. | `#cc-welcome` | welcome-tour.js | Setup tour; guide; cc-welcome |
| Dialog | Welcome Tour > Dialog | `welcome-tour.dialog` | The centred white-framed box. | `#cc-welcome .w-card` | welcome-tour.js | w-card / **CLASH:** "card" in code; it is the Modal's dialog, not a Card. |
| Header | Welcome Tour > Dialog > Header | `welcome-tour.dialog.header` | Logo, step title and "n / N". | `#cc-welcome .w-head` | welcome-tour.js | w-head; w-logo; w-step |
| Body | Welcome Tour > Dialog > Body | `welcome-tour.dialog.body` | Step text, lists and key caps. | `#cc-welcome .w-body` | welcome-tour.js | w-body; kbd |
| Link Row | Welcome Tour > Dialog > Link Row | `welcome-tour.dialog.link-row` | Address box plus an Open button. | `#cc-welcome .w-link` | welcome-tour.js | w-link; w-url; w-fb |
| Footer | Welcome Tour > Dialog > Footer | `welcome-tour.dialog.footer` | Step dots and the navigation buttons. | `#cc-welcome .w-foot` | welcome-tour.js | w-foot; w-dots |
| Marketplace Add Modal | Marketplace Add Modal | `marketplace-add-modal` | "Add a plugin" dialog on the Marketplace web page (From GitHub / From a folder / Build your own / Get listed). Not in the game. | `#amodal` | marketplace-page.js | amodal |
| Marketplace Guide Modal | Marketplace Guide Modal | `marketplace-guide-modal` | Step-by-step guide dialog on the Marketplace web page. Not in the game. | `#gmodal` | marketplace-page.js | gmodal |

### Toasts and alerts (14)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Toast | Toast | `toast` | One short notice above the bottom bar, auto-closing, with optional action and close. One at a time. | `.cc-toast` | ui-kit.js | cc-toast; #cc-ui-toast; UI.toast / **CLASH:** Game notifications (dash-toast, invite tray) are Game Toasts, not this. |
| Raid Lobby Toast | Raid Lobby Toast | `raid-lobby-toast` | Centred top gold-edged notice "Raid lobby open" with an Open Raids button (never joins for you). | `#cc-raid-toast` | raid-alert.js | cc-raid-toast; raid toast / **CLASH:** Own CSS, not .cc-toast. |
| Alert Bell | Alert Bell | `alert-bell` | Movable bell with a count badge; hover opens the Alert List. Right-click for filters. | `#cc-alertbell` | alert-bell.js | Alerts; bell; cc-alertbell / **CLASH:** The Info Bar has an Alerts Module that opens the same list. |
| Bell Button | Alert Bell > Bell Button | `alert-bell.bell-button` | The round bell icon. | `#cc-alertbell .bell` | alert-bell.js | bell; cc-bell |
| Count Badge | Alert Bell > Bell Button > Count Badge | `alert-bell.bell-button.count-badge` | Number bubble on the bell; hidden at zero. | `#cc-alertbell .n` | alert-bell.js | n; cc-badge |
| Alert List | Alert Bell > Alert List | `alert-bell.alert-list` | Dropdown of Alert Items under the bell (or under the Alerts Module when peeking). | `#cc-alertbell .list` | alert-bell.js | list; cc-alist; peek / **CLASH:** Looks like a Menu and uses menu heading classes, but is not UI.menu(). |
| Heading | Alert Bell > Alert List > Heading | `alert-bell.alert-list.heading` | "Alerts" with a Clear all button. | `#cc-alertbell .list .cc-mh` | alert-bell.js | cc-mh |
| Empty Text | Alert Bell > Alert List > Empty Text | `alert-bell.alert-list.empty-text` | "Nothing needs your attention." | `#cc-alertbell .none` | alert-bell.js | none |
| Alert Ring | Alert Ring | `alert-ring` | Glowing outline drawn around a game element that an alert points at. | `.cc-alert-ring` | alert-bell.js | cc-alert-ring; cc-ring (kit) |
| Alert Ring Tag | Alert Ring Tag | `alert-ring-tag` | Small label next to the ring ("Quest ready -> Ridgetop Mine"). | `.cc-alert-tag` | alert-bell.js | cc-alert-tag; cc-ringtag (kit) |
| Route Advisor Badge | Route Advisor Badge | `route-advisor-badge` | Gold tab-docked badge on the Tasks button, queue card or Info Bar saying a better route exists (or Optimal / calculating). Click opens the Route Advisor Panel. | `#cc-route-alert` | route-advisor.js | Route badge; route alert; cc-route-alert; tri; bardock; docked; in-card / **CLASH:** Id says "alert" and the code "badge"; it is a Widget-sized Alert, not a Toast. |
| Button | Route Advisor Badge > Button | `route-advisor-badge.button` | The clickable triangle or check part. | `#cc-route-alert .tri` | route-advisor.js | tri; tri.ok; tri.calc |
| Dismiss | Route Advisor Badge > Dismiss | `route-advisor-badge.dismiss` | Small cross. | `#cc-route-alert .x` | route-advisor.js | x |
| Callout | Callout | `callout` | Message block inside a body, tinted by tone with an edge and glyph. Library only. | `.cc-callout` | ui-kit.js | cc-callout; note; rt-upsell (Route Advisor) / **CLASH:** Not a Toast (floating) and not an Alert (system event). |

### Docks and handles (33)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Window Controls Dock | Window Controls Dock | `window-controls-dock` | ScapeLite wrapper that makes the Game Window Controls movable, resizable and collapsible, via a Strip. | `#cc-wc-strip` | window-dock.js | window-controls dock; top-right dock; cc-wc-dock |
| Strip | Window Controls Dock > Strip | `window-controls-dock.strip` | Thin strip under the controls shown on hover. | `#cc-wc-strip` | window-dock.js | cc-wc-strip |
| Move Handle | Window Controls Dock > Strip > Move Handle | `window-controls-dock.strip.move-handle` | Dotted area; drag to move, double-click resets. | `#cc-wc-strip .mv` | window-dock.js | mv |
| Resize Grip | Window Controls Dock > Strip > Resize Grip | `window-controls-dock.strip.resize-grip` | Corner; drag to scale. | `#cc-wc-strip .sz` | window-dock.js | sz |
| Collapse Arrow | Window Controls Dock > Strip > Collapse Arrow | `window-controls-dock.strip.collapse-arrow` | Arrow pointing at the nearest edge; tucks the buttons away. | `#cc-wc-strip .ar` | window-dock.js | ar |
| Badge | Window Controls Dock > Badge | `window-controls-dock.badge` | Small tab on a screen edge that reopens the tucked buttons. | `#cc-wc-badge` | window-dock.js | cc-wc-badge |
| Ghost | Window Controls Dock > Ghost | `window-controls-dock.ghost` | Dashed preview of where the buttons will land when dragging the badge. | `#cc-wc-ghost` | window-dock.js | cc-wc-ghost |
| Menu Dock | Menu Dock | `menu-dock` | Handle strip and resize corner that make the Game Panel Tab Bar and Game HP Bar one movable, scalable unit. | `#cc-dock-grip` | menu-dock.js | menu dock; cc-dock-grip; cc-menu-dock |
| Handle | Menu Dock > Handle | `menu-dock.handle` | The 18 px strip above the menu; drag to move; holds fuse buttons. | `#cc-dock-grip` | menu-dock.js | cc-dock-grip / **CLASH:** Named "grip" in code but it is a Handle (moves). A Grip resizes. |
| Resize Grip | Menu Dock > Resize Grip | `menu-dock.resize-grip` | Corner that resizes the menu with CSS zoom. | `#cc-dock-size` | menu-dock.js | cc-dock-size |
| Notification Dock | Notification Dock | `notification-dock` | Moves the game's invite tray, task popups and toasts and raises them above everything. | `.cc-nd-grip` | notif-dock.js | notif dock; cc-notif |
| Handle | Notification Dock > Handle | `notification-dock.handle` | Small strip above the invite tray to drag it. | `.cc-nd-grip` | notif-dock.js | cc-nd-grip / **CLASH:** Named "grip" in code; it moves, so it is a Handle. |
| Frame | Notification Dock > Frame | `notification-dock.frame` | Dashed gold frame per notification type shown in move mode. | `.cc-nd-frame` | notif-dock.js | cc-nd-frame |
| Potions Dock Handle | Potions Dock Handle | `potions-dock-handle` | Handle to the left of the Game Active Potions Panel; drag to move, right-click to lock. | `#cc-pot-handle` | window-dock.js | cc-pot-handle; potions dock |
| Window Title Bar | Window Title Bar | `window-title-bar` | ScapeLite title bar drawn over a Game Window once it is a movable window (drag to move, right-click for the panel menu). | `#cc-modal-win` | modal-resize.js | cc-modal-win; window form / **CLASH:** Registers with ui-scale like a Panel header, but it belongs to a Game Window. |
| Window Resize Grip | Window Resize Grip | `window-resize-grip` | Bottom-right corner handle of a Game Window (the se handle); drag to resize, snaps to fullscreen at 80%. | `.cc-mw-h` | modal-resize.js | cc-mw-h[data-d=se]; modal grip (old) / **CLASH:** Eight edge/corner handles share .cc-mw-h; only se is drawn as a grip. |
| Window Edge Handles | Window Edge Handles | `window-edge-handles` | Invisible edge and corner handles (n, s, e, w, nw, ne, sw) for resizing a Game Window. | `.cc-mw-h` | modal-resize.js | cc-mw-h[data-d] |
| Window Size Label | Window Size Label | `window-size-label` | Pill that follows a resize saying the size or that it will snap to fullscreen. | `#cc-mw-lbl` | modal-resize.js | cc-mw-lbl |
| Game Panel Resize Grip | Game Panel Resize Grip | `game-panel-resize-grip` | Corner handle ScapeLite adds to a Game Floating Panel to scale it. | `.cc-ps-handle` | panel-resize.js | cc-ps-handle; cc-ps-label; cc-ps-bl |
| Game Panel Lock Button | Game Panel Lock Button | `game-panel-lock-button` | Padlock button ScapeLite adds to a game panel's titlebar. | `.cc-lock-btn` | panel-resize.js | cc-lock-btn |
| Fuse Button | Fuse Button | `fuse-button` | Link button in a game panel's titlebar that fuses it to a touching game panel. | `.cc-fuse-btn` | panel-fuse.js | cc-fuse-btn; panel fuse / **CLASH:** Fuse Link is the same idea for ScapeLite panels. |
| Fuse Link | Fuse Link | `fuse-link` | Round link button that appears on the Seam between two touching ScapeLite panels; click fuses them into one moving group. | `.cc-fuse-link` | card-fuse.js | cc-fuse-link; card fuse; core-fuse / **CLASH:** File is called card-fuse but it fuses Panels (all kit panels), not only Pinned Cards. |
| Seam | Seam | `seam` | The shared edge where two panels touch. No element of its own: the Fuse Link sits on it. |  | card-fuse.js | seam; touching edge |
| Edge | Edge | `edge` | A reserved strip of the screen: the Info Bars take the top and/or bottom edge and panels lay out in the rest. Not an element (window.__ccEdge). |  | ui-bar.js | __ccEdge; edge |
| Group Tab Strip | Group Tab Strip | `group-tab-strip` | Tab strip above a stack of fused or grouped panels so one shows at a time. | `#cc-grp-root .strip` | ui-layout.js | cc-grp-root; group tabs; data-cc-gh |
| Snap Guide | Snap Guide | `snap-guide` | Thin gold line drawn where a dragged ScapeLite panel catches on an edge. | `.cc-snapk` | ui-scale.js | cc-snapk; cc-snapk-lbl (label); cc-guide (kit); cc-snap-guide (game panels); #cc-ed-root .gd (layout editor) / **CLASH:** Four implementations for the same thing: cc-snapk (ScapeLite panels), cc-snap-guide + cc-snap-chip (game panels), .cc-guide (kit, unused), .gd (layout editor). |
| Game Panel Snap Guide | Game Panel Snap Guide | `game-panel-snap-guide` | Gold guide line while dragging a Game Floating Panel. | `.cc-snap-guide` | panel-resize.js | cc-snap-guide |
| Game Panel Snap Chip | Game Panel Snap Chip | `game-panel-snap-chip` | Chip offering to fuse/attach when two game panels touch. | `.cc-snap-chip` | panel-resize.js | cc-snap-chip |
| Sidebar Pin | Sidebar Pin | `sidebar-pin` | Pin and switch added to each row of Settings > Hotkeys: show/hide an icon and keep it when the Game Left Icon Strip is minimised. | `.cc-sb-ctl` | sidebar-tabs.js | cc-sb-ctl; cc-sb-pin |
| Grip | Route Advisor Panel > Grip | `route-advisor-panel.grip` | Route Advisor's own resize corner. | `#cc-route-panel .rt-grip` | route-advisor.js | rt-grip / **CLASH:** Same job as Panel > Grip (.cc-rz). |
| Titlebar | Walking Countdown > Titlebar | `walking-countdown.titlebar` | Draggable strip of the floating Walking Countdown. | `.cc-walk-titlebar` | walking-countdown.js | cc-walk-titlebar / **CLASH:** Imitates the game's .panel-titlebar. |
| Resize Handle | Walking Countdown > Resize Handle | `walking-countdown.resize-handle` | Corner of the floating Walking Countdown. | `.cc-walk-resize-handle` | walking-countdown.js | cc-walk-resize-handle / **CLASH:** A Grip in our scheme; code says "handle". |
| Insertion Marker | Insertion Marker | `insertion-marker` | Thin gold bar showing where a dragged item will land (info bar buttons, queue cards). | `.ins-btn` | ui-bar.js | ins-btn; .ins (bar modules); cc-q-ins (queue); cc-ins (kit) |

### Overlays (22)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Combat Readout | Combat Readout | `combat-readout` | Numbers drawn on the combat scene's own bars: HP, Spirit, attack timer, plus a DPS line under your bars. | `#cc-bar-labels` | game-bridge.js | bar labels; cc-bar-labels; barLabels / **CLASH:** Drawn on a canvas over #game-canvas by the Game Data Bridge; Combat Readout (combat-readout.js) only switches parts on. |
| Bar Label | Combat Readout > Bar Label | `combat-readout.bar-label` | The "57 / 80" text on a bar of you, an enemy or an ally. | `#cc-bar-labels` | combat-readout.js | meHp; meSpirit; meTimer; enemyHp; allyHp ... |
| DPS Line | Combat Readout > DPS Line | `combat-readout.dps-line` | Attack interval, attacks per second and expected DPS under your bars. | `#cc-bar-labels` | combat-readout.js | meDps |
| Lever Pull Outline | Lever Pull Outline | `lever-pull-outline` | Gold pulsing outline with a number badge on a game lever row you should raise. | `.cc-lv-pull` | lever-advisor.js | cc-lv-pull; data-cc-n |
| Lever Release Outline | Lever Release Outline | `lever-release-outline` | Red outline with number badge on a lever row you should lower. | `.cc-lv-release` | lever-advisor.js | cc-lv-release |
| Route Highlight | Route Highlight | `route-highlight` | Gold inner outline on a game queue row the Route Advisor is pointing at. | `.uq-row.cc-route-hl` | route-advisor.js | cc-route-hl |
| Walking Bar | Walking Bar | `walking-bar` | Thin curved bar along the top edge of each Game Tasks Panel row; thicker and redder the longer the walk. | `.cc-qw-bar` | queue-walk.js | cc-qw-bar; walk bar |
| Walking Tag | Walking Tag | `walking-tag` | Small pill "2m 31s" between two game queue rows; enlarges on hover. | `.cc-qw-tag` | queue-walk.js | cc-qw-tag / **CLASH:** The Queue Panel's equivalent is the Walking Pill on a Walking Gap. |
| Craft Potential Fill | Craft Potential Fill | `craft-potential-fill` | Gold striped extension of the game's XP bar showing XP reachable with your bank. | `.cc-pot-fill` | craft-potential.js | cc-pot-fill |
| Craft Potential Label | Craft Potential Label | `craft-potential-label` | Text on the XP bar ("+3 levels and 40%"). | `.cc-pot-lbl` | craft-potential.js | cc-pot-lbl |
| Craft Potential Row | Craft Potential Row | `craft-potential-row` | Row of Level Chips under the bar. | `.cc-pot-row` | craft-potential.js | cc-pot-row; cc-pot-more; cc-pot-sum |
| Level Chip | Craft Potential Row > Level Chip | `craft-potential-row.level-chip` | One gold chip per level you would gain; the last may be partly filled. | `.cc-pot-chip` | craft-potential.js | cc-pot-chip; part |
| Bank Category Separator | Bank Category Separator | `bank-category-separator` | Full-width labelled line between category groups in the bank grid; click folds the group. | `.cc-bank-sep` | bank-tools.js | cc-bank-sep; folded; nolabel |
| Bank Size Slider | Bank Size Slider | `bank-size-slider` | Slider in the bank toolbar that scales the item slots. | `.cc-bank-size` | bank-tools.js | cc-bank-size |
| Bank New Sparkle | Bank New Sparkle | `bank-new-sparkle` | Gold glow, star and NEW tag on an item you never held before. | `.bank-slot.cc-new` | bank-tools.js | cc-new |
| Bank New Clear Button | Bank New Clear Button | `bank-new-clear-button` | Pill button in the toolbar that clears the NEW marks. | `.cc-bank-new-clear` | bank-tools.js | cc-bank-new-clear |
| Bank Strip Sparkle | Bank Strip Sparkle | `bank-strip-sparkle` | Twinkle on the Bank icon in the Game Left Icon Strip while there are new items. | `.cc-bank-spark` | bank-tools.js | cc-bank-spark |
| Food Total | Food Total | `food-total` | Added line on the game's food row showing total healing. | `.cc-food-total` | hover-info.js | cc-food-total; cc-food-sum |
| Layout Editor Frame | Layout Editor Frame | `layout-editor-frame` | Dashed gold frame over each movable panel in layout edit mode; solid = selected, grey = frozen, blue = locked. | `#cc-ed-root .fr` | ui-layout.js | cc-ed-root; fr; sel; fz; lk; drag; cc-frame (kit) / **CLASH:** Kit .cc-frame is the designed class; live code uses #cc-ed-root .fr. |
| Toolbar | Layout Editor Frame > Toolbar | `layout-editor-frame.toolbar` | Small toolbar on a frame: name, fade, scale, lock. | `#cc-ed-root .tb` | ui-layout.js | tb |
| Resize Corner | Layout Editor Frame > Resize Corner | `layout-editor-frame.resize-corner` | Corner triangle for resizing in edit mode. | `#cc-ed-root .rz` | ui-layout.js | rz / **CLASH:** A Grip. |
| Jump Flash | Jump Flash | `jump-flash` | Brief gold outline on a setting row after a jump from the Settings Quick-Jump Menu or Sidebar button. | `.cc-sn-flash` | settings-nav.js | cc-sn-flash; cc-sb-flash |

### Widgets (17)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Status Indicator | Status Indicator | `status-indicator` | Small dot-and-FPS widget bottom-left showing whether ScapeLite is connected; hover for the Status Indicator Popup. | `#cc-status-indicator` | status-indicator.js | Status light; cc-status-indicator; core-status-light |
| Head | Status Indicator > Head | `status-indicator.head` | Rounded dark pill holding the dot and FPS. | `.cc-si-head` | status-indicator.js | cc-si-head |
| Dot | Status Indicator > Head > Dot | `status-indicator.head.dot` | Breathing ring dot: green ok, orange warn, red bad. | `.cc-si-dot` | status-indicator.js | cc-si-dot; ok; warn; bad |
| FPS | Status Indicator > Head > FPS | `status-indicator.head.fps` | Tiny FPS number under the dot. | `.cc-si-fps` | status-indicator.js | cc-si-fps |
| Reload Button | Status Indicator Popup > Reload Button | `status-indicator-popup.reload-button` | "Reload ScapeLite" button restarting the plugins. | `.cc-si-reload` | status-indicator.js | cc-si-reload |
| Bug Button | Status Indicator Popup > Bug Button | `status-indicator-popup.bug-button` | Bug icon that opens the Bug Report Panel. | `.cc-si-bug` | status-indicator.js | cc-si-bug |
| Rows | Status Indicator Popup > Rows | `status-indicator-popup.rows` | Key / value lines with LED lights (connection, bridge, ...). | `.cc-si-rows` | status-indicator.js | cc-si-rows; cc-si-row; cc-si-led |
| Performance | Status Indicator Popup > Performance | `status-indicator-popup.performance` | Per-plugin cost bars. | `.cc-si-perf` | status-indicator.js | cc-si-perf; cc-si-bar; cc-si-ph; cc-si-note |
| Open Buttons | Status Indicator Popup > Open Buttons | `status-indicator-popup.open-buttons` | Open Dashboard / Open DevTools buttons. | `.cc-si-open-btn` | status-indicator.js | cc-si-open-btn; cc-si-devtools-btn |
| URL Row | Status Indicator Popup > URL Row | `status-indicator-popup.url-row` | Dashboard address with a copy button. | `.cc-si-url-row` | status-indicator.js | cc-si-url; cc-si-copy-btn |
| Walking Countdown | Walking Countdown | `walking-countdown` | Floating mini-panel (copy of the game's current-task look) counting down the walk to the next task and showing Vigor progress. | `#cc-walk-countdown` | walking-countdown.js | Walking panel; cc-walk-countdown; walk chip / **CLASH:** Not a chip; it is a small panel that can also dock as the Walking Countdown Drawer. |
| Destination | Walking Countdown > Destination | `walking-countdown.destination` | Where you are walking to. | `.cc-walk-dest` | walking-countdown.js | cc-walk-dest |
| Time Bar | Walking Countdown > Time Bar | `walking-countdown.time-bar` | Elapsed / ETA / total walking bar. | `.cc-walk-time-fill` | walking-countdown.js | cc-walk-time-fill; cc-walk-elapsed; cc-walk-eta; cc-walk-total |
| Vigor Bar | Walking Countdown > Vigor Bar | `walking-countdown.vigor-bar` | Vigor level progress bar. | `.cc-walk-vigor-fill` | walking-countdown.js | cc-walk-vigor-fill; cc-walk-vigor-lvl; cc-walk-vigor-pct |
| XP Chip | XP Chip | `xp-chip` | The XP Tracker Panel collapsed to a chip showing the total XP/hr (always available). | `#cc-xp-tracker.min` | xp-tracker.js | chipAlways; chip / **CLASH:** Same element as the XP Tracker Panel; Panel Chip is the generic state. |
| Logo Button | Logo Button | `logo-button` | The ScapeLite logo button at the end of the Game Left Icon Strip; hover or click opens the Logo Menu. | `.floating-tab-btn.cc-menu-btn` | scapelite-menu.js | cc-menu-btn; ScapeLite button / **CLASH:** Class cc-menu-btn is a button, not a menu. |
| Tab-Docked Badge | Tab-Docked Badge | `tab-docked-badge` | Small status button sitting on the top edge of a Panel or Module, centred (e.g. "+1.8% possible"). Library design; the Route Advisor Badge is the live one. | `.cc-tabbadge` | ui-kit.js | cc-tabbadge |

### Components (52)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Button | Button | `button` | Text button. Variants: default, primary, quiet, danger, go. Sizes: normal, sm. | `.cc-btn` | ui-kit.js | cc-btn; data-v; b (Route Advisor, Bug Report own buttons); bt (Chat) / **CLASH:** Several plugins draw their own buttons (rt-seg, .b, .bt, .tri); the kit one is .cc-btn. |
| Icon Button | Icon Button | `icon-button` | 24 px square button holding a glyph; aria-pressed = accent. | `.cc-ib` | ui-kit.js | cc-ib; ib (Chat); rt-x |
| Button Row | Button Row | `button-row` | Right-aligned row of buttons at the end of a form. | `.cc-btnrow` | ui-kit.js | cc-btnrow (library: no plugin uses it yet) |
| Chip | Chip | `chip` | Pill-shaped toggle or filter; .on = selected, .off = dashed. Not exclusive: use a Segmented Control for one-of-N. | `.cc-chip` | ui-kit.js | cc-chip; .chip (Drop Luck card); .tab (Chat channel chip) / **CLASH:** ".chip" in Drop Luck is a card; ".tab" in Chat is a chip. |
| Chip Group | Chip Group | `chip-group` | Wrapping row of Chips. | `.cc-chips` | ui-kit.js | cc-chips; xp-frames |
| Tab | Tab | `tab` | Underlined view switcher inside a panel; aria-selected = selected. | `.cc-tab` | ui-kit.js | cc-tab; tabs button (Tree Advisor); rt-tab (unused CSS) |
| Tab Strip | Tab Strip | `tab-strip` | Row of Tabs. | `.cc-tabs` | ui-kit.js | cc-tabs; tabs; rt-tabs; ttabs |
| Segmented Control | Segmented Control | `segmented-control` | Connected buttons where exactly one is pressed (aria-pressed). | `.cc-seg` | ui-kit.js | cc-seg; rt-seg (Route Advisor) |
| Pill | Pill | `pill` | Short rounded status or value with tone; walking scale via --w. | `.cc-pill` | ui-kit.js | cc-pill; rt-pill; ft-pill; bank .pill (switch) / **CLASH:** Other "pill" classes are a header chip, a fact box and a switch. |
| Badge | Badge | `badge` | Small count bubble (red by default, gold for new). Dot variant has no text. | `.cc-badge` | ui-kit.js | cc-badge; .n; rt-badge; ft-badge |
| Tier Chip | Tier Chip | `tier-chip` | Tiny boxed tier label like L40 or T5. | `.cc-tierchip` | ui-kit.js | cc-tierchip; cc-tier; cc-q-tier |
| Tile | Tile | `tile` | Square game picture with tier and markers; kinds skill / kill / empty. | `.cc-tile` | ui-kit.js | cc-tile; cc-q-tile; cc-ico (the picture) / **CLASH:** A Tile is one square thing with an icon; a Cell is a grid slot that also shows level and progress. |
| Icon | Icon | `icon` | 30 px (16 px small) pixelated game icon or an emoji in a span. | `.cc-ico` | ui-kit.js | cc-ico; img |
| Row | Row | `row` | Fixed 44 px list line: lane colour, optional lead, title, sub, meta, optional bar. Never grows. | `.cc-row` | ui-kit.js | cc-row; card row; cc-card (legacy) / **CLASH:** Our Card is the heavier outlined item (queue); the kit calls the plain one Row. |
| Lead | Row > Lead | `row.lead` | Left slot: tile or number. | `.cc-row .lf` | ui-kit.js | lf |
| Title | Row > Title | `row.title` | First text line. | `.cc-row .ti` | ui-kit.js | ti |
| Subtitle | Row > Subtitle | `row.subtitle` | Second, dim text line. | `.cc-row .su` | ui-kit.js | su |
| Meta | Row > Meta | `row.meta` | Right column: time and value. | `.cc-row .mt` | ui-kit.js | mt |
| Bar | Row > Bar | `row.bar` | Optional thin progress bar under the text. | `.cc-row .pr` | ui-kit.js | pr |
| Action Button | Row > Action Button | `row.action-button` | Pin/unpin star or cross at the end of a Row. | `.cc-row .ac` | goals.js | ac |
| List | List | `list` | Vertical stack of Rows with gap 6. | `.cc-list` | ui-kit.js | cc-list (library: no plugin uses it yet) |
| Grid | Grid | `grid` | Fixed-column grid of Cells. | `.cc-grid` | ui-kit.js | cc-grid; --cols (library: no plugin uses it yet) |
| Cell | Cell | `cell` | Grid slot with icon, level, quantity or bar. | `.cc-cell` | ui-kit.js | cc-cell; tcell (Info Bar hover cards); skill-cell (game); bank-slot (game) (library: no plugin uses it yet) / **CLASH:** Different from Tile; see Tile. |
| Progress Bar | Progress Bar | `progress-bar` | Ratio bar with a tone; --p sets the fill; an inner u shows queued XP. | `.cc-prog` | ui-kit.js | cc-prog; rt-pbar; rt-calc-bar; meter (Drop Luck); bar (HP Panel); xp-bar / **CLASH:** A bar here is always a Progress Bar; the Info Bar is not a progress bar. |
| Stat | Stat | `stat` | Big number with a label under it; hero variant is larger. | `.cc-stat` | ui-kit.js | cc-stat; stats (Drop Luck own) (library: no plugin uses it yet) |
| Stat Row | Stat Row | `stat-row` | Row of 2 to 4 Stats. | `.cc-stats` | ui-kit.js | cc-stats (library: no plugin uses it yet) |
| Key-Value List | Key-Value List | `key-value-list` | Label / value pairs, values right-aligned. | `.cc-kv` | ui-kit.js | cc-kv; tkv; dl (library: no plugin uses it yet) |
| Table | Table | `table` | Comparison table with numeric columns and signed deltas. | `.cc-table` | ui-kit.js | cc-table; rt-vt; whyb table (library: no plugin uses it yet) |
| Section Heading | Section Heading | `section-heading` | Uppercase heading inside a body, optional count. | `.cc-sec` | ui-kit.js | cc-sec; h5 (Tree Advisor, Drop Luck); rt-h; h6 (Chat); settings-subheading |
| Graph Frame | Graph Frame | `graph-frame` | Framed box that holds an SVG chart. | `.cc-graph` | ui-kit.js | cc-graph (library: no plugin uses it yet) |
| Sparkline | Sparkline | `sparkline` | Tiny trend line. | `.cc-spark` | ui-kit.js | cc-spark; canvas.spark (XP Tracker) |
| Toggle Switch | Toggle Switch | `toggle-switch` | On/off switch. | `.cc-sw` | ui-kit.js | cc-sw; settings-switch (game's, used on the Plugins page); pill (bank settings) |
| Slider | Slider | `slider` | Range input with a fill (--fill). | `.cc-range` | ui-kit.js | cc-range |
| Input | Input | `input` | Single-line text field; aria-invalid = red. | `.cc-in` | ui-kit.js | cc-in |
| Number Input | Number Input | `number-input` | 72 px right-aligned number field. | `.cc-num` | ui-kit.js | cc-num / **CLASH:** Also cc-num-t (tabular figures) and the queue's .cc-q-num (slot number); different things. |
| Select | Select | `select` | Dropdown field. | `.cc-sel` | ui-kit.js | cc-sel; sel (Drop Luck) |
| Field | Field | `field` | Label above an input with an error line. | `.cc-field` | ui-kit.js | cc-field (library: no plugin uses it yet) |
| Settings Row | Settings Row | `settings-row` | Bold label, hint text and a control at the right (or below with data-wide). | `.cc-set` | ui-kit.js | cc-set; settings-toggle-row (game's, used on the Plugins page) (library: no plugin uses it yet) |
| Settings Sheet | Settings Sheet | `settings-sheet` | Panel-internal settings page that slides over a Panel body. | `.cc-sheet` | ui-kit.js | cc-sheet (library: no plugin uses it yet) |
| Empty State | Empty State | `empty-state` | Glyph, title and one line when there is nothing to show. | `.cc-empty` | ui-kit.js | cc-empty; empty (Chat); xp-empty |
| Skeleton | Skeleton | `skeleton` | Grey shimmering block at the real height while loading. | `.cc-skel` | ui-kit.js | cc-skel; data-state=loading (queue) |
| Spinner | Spinner | `spinner` | Small rotating ring. | `.cc-spin` | ui-kit.js | cc-spin; rt-spin |
| Scroll Area | Scroll Area | `scroll-area` | Thin-scrollbar container. | `.cc-scroll` | ui-kit.js | cc-scroll |
| Hint | Hint | `hint` | Small faint helper text. | `.cc-hint` | ui-kit.js | cc-hint; cc-q-hint |
| Divider | Divider | `divider` | Vertical separator in a bar. | `.cc-vsep` | ui-kit.js | cc-vsep (library: no plugin uses it yet) |
| Dots | Dots | `dots` | Row of step dots (tour). | `.cc-dots` | ui-kit.js | cc-dots; w-dots |
| Drag Ghost | Drag Ghost | `drag-ghost` | Semi-transparent clone following the pointer while dragging a Row or Card. | `.cc-q-ghost` | ui-queue.js | cc-q-ghost; cc-ghost (kit) |
| Message List | Message List | `message-list` | Kit design for chat lines: Messages in a list. | `.cc-msgs` | ui-kit.js | cc-msgs; cc-msg (library: no plugin uses it yet) / **CLASH:** Chat Panel builds its own (.list > .cm). |
| Composer | Composer | `composer` | Kit design for a chat input row. | `.cc-composer` | ui-kit.js | cc-composer; cc-newjump (library: no plugin uses it yet) |
| Channel Colour | Channel Colour | `channel-colour` | Sets --t to the text colour for a chat channel. | `.cc-chan` | ui-kit.js | cc-chan (library: no plugin uses it yet) |
| Scrim | Scrim | `scrim` | Dim full-screen layer behind a Modal. | `.cc-scrim` | ui-kit.js | cc-scrim; --cc-scrim |
| Gutter | Gutter | `gutter` | The gap between items in a list or grid (--cc-gap, density aware). Not an element. |  | ui-kit.js | gap; --cc-gap; --cc-gap-grid |

### States and variants (65)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Hover | Hover | `hover` | Pointer is over it: background --cc-bg-hover, border strong, 120 ms. | `:hover` | ui-kit.js | hover |
| Pressed | Pressed | `pressed` | Mouse down: one step darker, buttons move 1 px; toggles use aria-pressed. | `:active, [aria-pressed=true]` | ui-kit.js | pressed; active; on |
| Selected | Selected | `selected` | Chosen item: accent fill and edge. Written .on, [aria-selected] or [aria-pressed] depending on the plugin. | `.on, [aria-selected=true]` | ui-kit.js | on; sel; is-sel; active / **CLASH:** Five spellings: .on, .sel, .is-sel, .active, aria-*. |
| Focus | Focus | `focus` | Keyboard focus: 2 px blue outline. | `:focus-visible` | ui-kit.js | focus-visible |
| Disabled | Disabled | `disabled` | Dimmed, no pointer events. | `[aria-disabled=true], :disabled` | ui-kit.js | disabled; is-off |
| Locked | Locked | `locked` | Not available yet: dashed, dim, with the reason in the sub line (rows) or a padlock (panels). | `.locked, .is-locked, [data-cc-locked]` | ui-kit.js | locked; is-locked; data-cc-locked / **CLASH:** Three meanings: Row locked (not yet available), Master button locked (not unlocked), Panel locked (cannot be moved). |
| Highlighted | Highlighted | `highlighted` | Advisor spotlight: gold ring with glow and pulse. | `.is-hl` | ui-kit.js | is-hl; cc-route-hl; cc-lv-pull |
| Advisor Pick | Advisor Pick | `advisor-pick` | Dashed gold outline: the Route Advisor's choice. Only the advisor uses a dashed line. | `.is-adv` | ui-queue.js | is-adv |
| Attention | Attention | `attention` | Gold 7 px dot on a button or module. | `.dot` | ui-bar.js | attention dot; dot; cc-badge.dot |
| Loading | Loading | `loading` | Skeleton blocks or a spinner plus text. | `[data-state=loading], .calculating` | ui-queue.js | loading; calculating (Route Advisor) |
| Empty | Empty | `empty` | Nothing to show: Empty State. | `.cc-empty` | ui-kit.js | empty |
| Error | Error | `error` | Red callout or toast; never a coloured panel. | `[data-tone=bad]` | ui-kit.js | bad; aria-invalid |
| Good | Tone > Good | `tone.good` | Green: done, good, skilling. | `[data-tone=good]` | ui-kit.js | good; ok |
| Warn | Tone > Warn | `tone.warn` | Orange: caution, medium. | `[data-tone=warn]` | ui-kit.js | warn; mid; o |
| Bad | Tone > Bad | `tone.bad` | Red-orange: bad, far. | `[data-tone=bad]` | ui-kit.js | bad; no |
| Info | Tone > Info | `tone.info` | Blue: info, quest. | `[data-tone=info]` | ui-kit.js | info; qst |
| Magic | Tone > Magic | `tone.magic` | Purple: boost, teleport. | `[data-tone=magic]` | ui-kit.js | magic; tp |
| Accent | Tone > Accent | `tone.accent` | Gold: advisor, selection, the accent colour. | `[data-tone=accent]` | ui-kit.js | accent; gold |
| Kill | Tone > Kill | `tone.kill` | Combat red (--cc-q-kill). | `[data-tone=kill]` | ui-kit.js | kill; data-k=kill |
| Dim | Tone > Dim | `tone.dim` | Muted grey. | `[data-tone=dim]` | ui-kit.js | dim |
| Small | Size > Small | `size.small` | Compact variant: .sm on Button, Tile; data-h=s on the Info Bar. | `.sm, .cc-ibar[data-h=s]` | ui-kit.js | sm; compact |
| Large | Size > Large | `size.large` | Larger variant: .lg on Tile; data-h=l (42 px) on the Info Bar. | `.lg, .cc-ibar[data-h=l]` | ui-kit.js | lg; roomy / **CLASH:** Info Bar heights are called compact / normal / roomy in settings but data-h s / m / l in CSS. |
| Full | Width Class > Full | `width-class.full` | Panel 340 px or wider (bars: screen 1100 px or wider). Everything shown. | `[data-bp=full]` | ui-kit.js | full; data-bp |
| Compact | Width Class > Compact | `width-class.compact` | Panel 180-339 px (bars 700-1099): sub lines fold into meta. | `[data-bp=compact]` | ui-kit.js | compact; cc-hide-c |
| Micro | Width Class > Micro | `width-class.micro` | Panel 90-179 px (bars under 700): icons and numbers only. | `[data-bp=micro]` | ui-kit.js | micro; cc-hide-m; cc-only-m |
| Hover | Mode > Hover | `mode.hover` | Panel shown as a Hover Card: no buttons, no grip. | `[data-mode=hover]` | ui-queue.js | data-mode=hover |
| Collapsed Chip | Mode > Collapsed Chip | `mode.collapsed-chip` | Panel folded into its header (a chip). | `.cc-panel.min` | ui-kit.js | min; chip; chip-always |
| Docked | Mode > Docked | `mode.docked` | Panel flush against an Info Bar: square corners on that side. | `.cc-panel.docked, .cc-dock-t, .cc-dock-b` | ui-scale.js | docked; cc-dock-b; cc-dock-t |
| Fused | Mode > Fused | `mode.fused` | Panels joined into one group that moves together. | `.cc-fuse-link.on` | card-fuse.js | fused; group |
| Grouped Hidden | Mode > Grouped Hidden | `mode.grouped-hidden` | A panel behind another in a tab group is hidden. | `[data-cc-gh]` | ui-layout.js | data-cc-gh; ghost |
| Faded | Mode > Faded | `mode.faded` | Panel fades to 30% until hovered. | `[data-cc-fade]` | ui-layout.js | data-cc-fade |
| Sized | Mode > Sized | `mode.sized` | Panel the player has resized (stops auto height). | `.cc-sized` | ui-bar.js | cc-sized |
| Floating Window | Mode > Floating Window | `mode.floating-window` | Game Window in window form (not fullscreen): movable, resizable; see-through lets the game behind stay clickable. | `body.cc-mw, body.cc-mw-see` | modal-resize.js | cc-mw; cc-mw-see; cc-modal-float (old) |
| Drawer Open | Mode > Drawer Open | `mode.drawer-open` | Drawer unfolded. | `.cc-wd.open, #cc-route-map[data-open="1"], .cc-walk-open` | ui-kit.js | open; data-open; cc-open |
| Current | Card > Current | `card.current` | The running task: taller, lane-coloured frame, number shows ">". | `.cc-q-row.is-now` | ui-queue.js | is-now; uq-current (game) |
| Open | Card > Open | `card.open` | Card whose option tray is open. | `.cc-q-row.is-open` | ui-queue.js | is-open |
| Dragging | Card > Dragging | `card.dragging` | Source card while a drag is in progress (dimmed). | `.cc-q-row.is-dragging` | ui-queue.js | is-dragging; cc-dragging (kit) |
| Dropped | Card > Dropped | `card.dropped` | Brief flash after a drop. | `.cc-q-row.is-dropped` | ui-queue.js | is-dropped |
| Rolling | Card > Rolling | `card.rolling` | Card waiting for a reroll. | `.cc-q-row.is-rolling` | ui-queue.js | is-rolling |
| Frame Colour | Card > Frame Colour | `card.frame-colour` | data-e: gold lucky, blue quest step, purple XP-boost drop; grey = normal. | `.cc-q-row[data-e]` | ui-queue.js | data-e=lucky\|quest\|boost |
| Lane | Card > Lane | `card.lane` | data-k: skill (green outline) or kill (red outline). | `.cc-q-row[data-k]` | ui-queue.js | data-k=skill\|kill |
| Material Shortage | Card > Material Shortage | `card.material-shortage` | data-m: bad red triangle, warn orange, save blue i. | `.cc-q-row[data-m]` | ui-queue.js | data-m=bad\|warn\|save |
| Chosen | Tray Option > Chosen | `tray-option.chosen` | Solid gold outline and a check: the task now in this slot. | `.cc-q-opt.is-sel` | ui-queue.js | is-sel |
| Advisor Pick | Tray Option > Advisor Pick | `tray-option.advisor-pick` | Dashed gold outline and a star. | `.cc-q-opt.is-adv` | ui-queue.js | is-adv |
| Fastest XP | Tray Option > Fastest XP | `tray-option.fastest-xp` | Bolt badge on the option with the best XP/hr. | `.cc-q-tray .cc-tile[data-p=xp]` | ui-queue.js | data-p=xp; data-p=adv |
| Waiting | Tray Option > Waiting | `tray-option.waiting` | All other options dimmed after a pick, until the game confirms. | `.cc-q-tray.is-wait` | ui-queue.js | is-wait |
| Short To Long | Walk Length > Short To Long | `walk-length.short-to-long` | Walking Gap / Walking Bar colour: green, yellow, orange, red; purple means the game would teleport. | `.cc-q-hop[data-h]` | ui-queue.js | data-h=1..4\|t; --cc-w1..w4; --cc-wt |
| Active | Module > Active | `module.active` | Info Bar Module or Panel Button whose panel is open. | `.cc-bar .m .pi.btn.on` | ui-bar.js | pi.on; active |
| Dragging | Module > Dragging | `module.dragging` | Panel Button being reordered (dimmed). | `.cc-bar .m .pi.btn.drag` | ui-bar.js | drag |
| Clickable | Module > Clickable | `module.clickable` | Module with a click action (pointer cursor). | `.cc-bar .m.clk` | ui-bar.js | clk |
| Look | Panel Buttons > Look | `panel-buttons.look` | Icon only, icon and text, or text only. | `.pc.look-icon` | ui-bar.js | look-icon; look-both; look-text |
| Style | Panel Buttons > Style | `panel-buttons.style` | Plain (flat) or separate pills. | `.pc.pills` | ui-bar.js | pills; flat |
| Selected | Route Plan Card > Selected | `route-plan-card.selected` | Gold edge: the path shown in the map and steps. | `#cc-route-panel .rt-plan.sel` | route-advisor.js | rt-plan sel |
| Best | Route Plan Card > Best | `route-plan-card.best` | Path with the best score (gold edge and Best badge). | `#cc-route-panel .rt-plan.best` | route-advisor.js | rt-plan best |
| Unavailable | Route Plan Card > Unavailable | `route-plan-card.unavailable` | Dim card saying why a path has no option now. | `#cc-route-panel .rt-plan.rt-off` | route-advisor.js | rt-off |
| Mode | Route Advisor Badge > Mode | `route-advisor-badge.mode` | Where the badge sits: in-card (in the game's Tasks panel), docked (tab on the card) or bardock (tab on the Info Bar's Tasks button). | `#cc-route-alert.in-card, #cc-route-alert.docked, #cc-route-alert.bardock` | route-advisor.js | in-card; docked; bardock; data-kind |
| Optimal | Route Advisor Badge > Optimal | `route-advisor-badge.optimal` | Green version: the queue is already best. | `#cc-route-alert.ok` | route-advisor.js | ok |
| Dot Colour | Status Indicator > Dot Colour | `status-indicator.dot-colour` | Green connected, orange warning, red bad; faster pulse when bad. | `.cc-si-dot.ok, .cc-si-dot.warn, .cc-si-dot.bad` | status-indicator.js | ok; warn; bad |
| Has Alerts | Alert Bell > Has Alerts | `alert-bell.has-alerts` | Bell rings once and the count shows. | `#cc-alertbell.has` | alert-bell.js | has |
| Open | Alert Bell > Open | `alert-bell.open` | List is showing. | `#cc-alertbell.open` | alert-bell.js | open; peek |
| Bell Hidden | Alert Bell > Bell Hidden | `alert-bell.bell-hidden` | Bell button hidden; list still opens from the Info Bar module. | `#cc-alertbell.nobell` | alert-bell.js | nobell |
| Visible | Fuse Link > Visible | `fuse-link.visible` | The link appears while a panel is dragged near another. | `.cc-fuse-link.vis` | card-fuse.js | vis |
| State | Layout Editor Frame > State | `layout-editor-frame.state` | sel selected, fz frozen, lk locked, drag being dragged. | `#cc-ed-root .fr.sel, #cc-ed-root .fr.fz, #cc-ed-root .fr.lk` | ui-layout.js | sel; fz; lk; drag |
| State | Pet Card > State | `pet-card.state` | Own = green edge, shiny = animated gold. | `#cc-droplog .pcard.own, #cc-droplog .pcard.shiny` | drop-luck.js | own; shiny |
| Height | Info Bar > Height | `info-bar.height` | Info Bar height: compact 28, normal 34, roomy 42 px. | `.cc-ibar[data-h]` | ui-bar.js | data-h=s\|m\|l; uiBarHeight |

### Design tokens (59)

| Name | Path | Id | What it is | DOM selector | Source file | Code alias / clash |
|---|---|---|---|---|---|---|
| Surface 0 | Colour > Surface 0 | `colour.surface-0` | Panel, bar and page background #10101a. | `--cc-bg` | ui-kit.js | bg |
| Surface 1 | Colour > Surface 1 | `colour.surface-1` | Menu, tray, overlay background #161620. | `--cc-bg-2` | ui-kit.js | bg-2 |
| Surface 2 | Colour > Surface 2 | `colour.surface-2` | Rows, cells, chips #1c1c28. | `--cc-bg-3` | ui-kit.js | bg-3 |
| Hover | Colour > Hover | `colour.hover` | Hover background #262636. | `--cc-bg-hover` | ui-kit.js | bg-hover |
| Sunk | Colour > Sunk | `colour.sunk` | Wells: progress track, graph frame, inputs #0a0a12. | `--cc-sunk` | ui-kit.js | sunk |
| Hairline | Colour > Hairline | `colour.hairline` | Dividers and normal borders #2e2e42. | `--cc-border` | ui-kit.js | border |
| Border Strong | Colour > Border Strong | `colour.border-strong` | Edges of overlays #4a4a62. | `--cc-border-strong` | ui-kit.js | border-strong |
| Text | Colour > Text | `colour.text` | Primary text #dcdce8. | `--cc-text` | ui-kit.js | text |
| Text Dim | Colour > Text Dim | `colour.text-dim` | Secondary text #8f8fa4. | `--cc-text-dim` | ui-kit.js | text-dim |
| Text Faint | Colour > Text Faint | `colour.text-faint` | Hints only #7c7c93 (tokens block says #707086, components block overrides). | `--cc-text-faint` | ui-kit.js | text-faint / **CLASH:** Defined twice with different values; the later one wins. |
| Accent | Colour > Accent | `colour.accent` | Gold #ffd24a: advisor, selection, primary button. | `--cc-accent` | ui-kit.js | accent |
| Accent Fill | Colour > Accent Fill | `colour.accent-fill` | Tinted background for selected things #2a2518. | `--cc-accent-bg` | ui-kit.js | accent-bg |
| Accent Ink | Colour > Accent Ink | `colour.accent-ink` | Text colour on accent #241a00. | `--cc-accent-ink` | ui-kit.js | accent-ink |
| Good | Colour > Good | `colour.good` | Green #5fe06d. | `--cc-good` | ui-kit.js | good |
| Warn | Colour > Warn | `colour.warn` | Orange #ffb84a. | `--cc-warn` | ui-kit.js | warn |
| Bad | Colour > Bad | `colour.bad` | Red-orange #ff8a5c. | `--cc-bad` | ui-kit.js | bad |
| Info | Colour > Info | `colour.info` | Blue #4aa8ff. | `--cc-info` | ui-kit.js | info |
| Magic | Colour > Magic | `colour.magic` | Purple #b07cff. | `--cc-magic` | ui-kit.js | magic |
| Combat | Colour > Combat | `colour.combat` | Combat red #ee5a5a (and --cc-q-kill-rgb). | `--cc-q-kill` | ui-kit.js | q-kill; kill / **CLASH:** "q-" prefix means queue but it is global. |
| Skilling | Colour > Skilling | `colour.skilling` | Skilling green as rgb triplet 95,224,109. | `--cc-q-skill-rgb` | ui-kit.js | q-skill-rgb |
| Walk Scale | Colour > Walk Scale | `colour.walk-scale` | Walk colours as rgb triplets: w1 green, w2 yellow, w3 orange, w4 red, wt purple (teleport). | `--cc-w1` | ui-kit.js | w1..w4; wt |
| Scrim | Colour > Scrim | `colour.scrim` | Dim layer behind a Modal. | `--cc-scrim` | ui-kit.js | scrim |
| Tone | Colour > Tone | `colour.tone` | Set by data-tone on a component: --t (colour), --t-a (14% mix), --t-b (42% mix). | `--t` | ui-kit.js | t; t-a; t-b |
| Scale | Spacing > Scale | `spacing.scale` | 2 4 6 8 10 12 16 24 px as --cc-sp-1 .. --cc-sp-8. | `--cc-sp-1` | ui-kit.js | sp-1..sp-8 |
| Gap | Spacing > Gap | `spacing.gap` | Density-aware gap between items (5 / 8 / 11 px). | `--cc-gap` | ui-kit.js | gap; gutter |
| Panel Padding | Spacing > Panel Padding | `spacing.panel-padding` | Density-aware body padding (9 / 12 / 15 px). | `--cc-pad` | ui-kit.js | pad |
| Row Padding | Spacing > Row Padding | `spacing.row-padding` | Density-aware row padding. | `--cc-row-pad` | ui-kit.js | row-pad |
| Font | Type > Font | `type.font` | System UI font stack. | `--cc-font` | ui-kit.js | font |
| Base | Type > Base | `type.base` | 14 px (13 compact, 15 roomy): row title, body. | `--cc-fs` | ui-kit.js | fs; base |
| Small | Type > Small | `type.small` | 12.5 px: controls, menu. | `--cc-fs-sm` | ui-kit.js | fs-sm; sm |
| Extra Small | Type > Extra Small | `type.extra-small` | 11.5 px: sub lines, hints. | `--cc-fs-xs` | ui-kit.js | fs-xs; xs |
| 2XS | Type > 2XS | `type.2xs` | 10.5 px floor: tier chips, headings. | `--cc-fs-2xs` | ui-kit.js | fs-2xs |
| Large | Type > Large | `type.large` | 16 px: panel title. | `--cc-fs-lg` | ui-kit.js | fs-lg; lg |
| XL | Type > XL | `type.xl` | 20 px: stat value. | `--cc-fs-xl` | ui-kit.js | fs-xl |
| Hero | Type > Hero | `type.hero` | 26 px: the one big number. | `--cc-fs-hero` | ui-kit.js | fs-hero; hero |
| Radius | Shape > Radius | `shape.radius` | 12 px panels, trays, modals. | `--cc-r` | ui-kit.js | r |
| Radius Small | Shape > Radius Small | `shape.radius-small` | 8 px rows, cells. | `--cc-r-sm` | ui-kit.js | r-sm |
| Radius Extra Small | Shape > Radius Extra Small | `shape.radius-extra-small` | 5 px tier chips. | `--cc-r-xs` | ui-kit.js | r-xs |
| Low | Elevation > Low | `elevation.low` | Row shadow. | `--cc-sh-1` | ui-kit.js | sh-1 |
| Popover | Elevation > Popover | `elevation.popover` | Menu, popover, tooltip, toast shadow. | `--cc-sh-pop` | ui-kit.js | sh-pop |
| Panel | Elevation > Panel | `elevation.panel` | Panel, tray, modal shadow. | `--cc-shadow` | ui-kit.js | shadow |
| Fast | Motion > Fast | `motion.fast` | 120 ms hover and press. | `--cc-dur-1` | ui-kit.js | dur-1 |
| Normal | Motion > Normal | `motion.normal` | 180 ms enter. | `--cc-dur-2` | ui-kit.js | dur-2 |
| Easing | Motion > Easing | `motion.easing` | Calm ease-out curve. | `--cc-ease-out` | ui-kit.js | ease-out; ease |
| Unit | Scale > Unit | `scale.unit` | --u = --s x 1 px; set on a .cc-s root by ccScale() from its width. | `--u` | ui-kit.js | u; s; --s |
| Info Bar Height | Size > Info Bar Height | `size.info-bar-height` | 34 px default (28 / 42). | `--cc-bar-h` | ui-kit.js | bar-h |
| Row Height | Size > Row Height | `size.row-height` | Row height 44 px (queue card 50 px, current 70 px). | `--cc-row-h` | ui-kit.js | row-h; --q-rowh / **CLASH:** Read with a fallback; not declared on :root. |
| Cell Height | Size > Cell Height | `size.cell-height` | Grid cell height 54 px. | `--cc-cell-h` | ui-kit.js | cell-h / **CLASH:** Read with a fallback; not declared on :root. |
| Tile | Size > Tile | `size.tile` | Tile size 44 px (queue sets it per card). | `--cc-tile` | ui-kit.js | tile; --q-tile |
| Pill Height | Size > Pill Height | `size.pill-height` | Pill height 20 px. | `--cc-pill-h` | ui-kit.js | pill-h |
| Progress Height | Size > Progress Height | `size.progress-height` | Progress bar thickness 6 px. | `--cc-prog-h` | ui-kit.js | prog-h |
| Panel | Layer > Panel | `layer.panel` | Kit panels start at 1100; ui-scale brings the clicked one to the front within the band 1100-1890. | `--cc-z-panel` | ui-kit.js | z-panel; zTop |
| Queue Tray Host | Layer > Queue Tray Host | `layer.queue-tray-host` | 1895: above every ScapeLite panel so alternatives are never hidden. | `.cc-q-trayhost` | ui-kit.js | z 1895 |
| Game Windows | Layer > Game Windows | `layer.game-windows` | The game's Settings, Bank, Crafting etc. sit at 2000 in the game's own stacking context; ScapeLite panels under them are clipped away (GUARD list). | `.modal-overlay` | ui-kit.js | z 2000; GUARD |
| Menu | Layer > Menu | `layer.menu` | Menus and popovers. | `--cc-z-menu` | ui-kit.js | z-menu |
| Toast | Layer > Toast | `layer.toast` | Toasts. | `--cc-z-toast` | ui-kit.js | z-toast |
| Tooltip | Layer > Tooltip | `layer.tooltip` | Tooltips. | `--cc-z-tip` | ui-kit.js | z-tip |
| Modal | Layer > Modal | `layer.modal` | Modals and Welcome Tour. | `--cc-z-modal` | ui-kit.js | z-modal |
| Notifications | Layer > Notifications | `layer.notifications` | Notification Dock raises game notifications to 6000 (above windows 2000 and task popup 3000, below confirm dialogs 6500). | `.invite-tray` | ui-kit.js | Z in notif-dock.js |

## 4. Quick disambiguation

| Often confused | How to tell them apart |
|---|---|
| **Panel** vs **Card** vs **Window** | Panel: ScapeLite titled draggable box. Card: an item inside a list (or a Pinned / Hover Card shown from a bar button). Window: one of the game's big full-screen pages (Settings, Bank ...). |
| **Chip** vs **Pill** vs **Badge** vs **Tab** | Chip: clickable filter or toggle. Pill: read-only value or status. Badge: tiny count or dot. Tab: switches the view of a panel (underlined, one at a time). Chat's "tabs" are Chips. |
| **Tile** vs **Cell** vs **Icon** | Icon: the picture. Tile: a square holding an icon (plus tier, markers). Cell: a grid slot that also shows level, quantity or a bar. |
| **Menu** vs **Tray** vs **Popover** vs **Tooltip** | Menu: list of actions. Tray: strip of option tiles. Popover: details of one thing, anchored. Tooltip: text at the pointer, never entered. Hover Card: rich, can be entered. |
| **Info Bar** vs **Progress Bar** vs **HP Bar** vs **menu bar** | Info Bar: the screen-edge strip of modules. Progress Bar: any ratio bar. HP: Game HP Bar (game), HP Panel (ours), Hit Points Module (Info Bar). Menu bar: the Game Panel Tab Bar (bottom-right vertical menu). The queue's Controls Bar is a region, not a Bar. |
| **Handle** vs **Grip** vs **Seam** | Handle: drag to move. Grip: corner, drag to resize. Seam: the shared edge of two panels, where the Fuse Link sits. |
| **Toast** vs **Callout** vs **Alert** | Toast: floating notice that disappears. Callout: message block inside a body. Alert: an event listed in the Alert Bell (Alert Item), pointed at with Ring + Tag. |
| **Queue Panel** vs **Game Tasks Panel** | Ours (#cc-queue) vs the game's (#unified-queue-panel). |
| **Drawer** vs **Panel** | A Drawer is attached to an edge of another surface and has no position of its own; a Panel floats freely. |
| **Fuse Link** vs **Fuse Button** | Link: round button on the Seam of two ScapeLite panels. Button: in a game panel's titlebar. |

## 5. Real naming problems found in the code (not renamed)

1. **"card"** means four things: `.cc-card` (legacy list item), `cc-card-<tab>` (Pinned Card, really a Panel), `.w-card` (Welcome Tour dialog) and our Card (`.cc-q-row`). File `card-fuse.js` fuses all kit panels, not only cards.
2. **The resize corner has nine names**: `.cc-rz` (the one that is created), `.cc-grip` (kit CSS, nothing creates it), `.rt-grip`, `.cc-ps-handle`, `.cc-mw-h[data-d=se]`, `#cc-dock-size`, `.cc-walk-resize-handle`, `.sz` (window dock), `.rz` (layout editor). "grip" also names move strips (`#cc-dock-grip`, `.cc-nd-grip`).
3. **Snap guides have four implementations**: `.cc-snapk`, `.cc-snap-guide` + `.cc-snap-chip`, kit `.cc-guide` (unused), layout editor `.gd`.
4. **Six menu implementations**: kit `.cc-menu`, `.cc-pm`, `.cc-sn-menu`, `#cc-sbgmenu`, `.cc-bank-dd` / `.cc-bank-set`, `.cc-alist`. Class `cc-menu` is also on the Logo Menu; `cc-menu-btn` is a button.
5. **Route Advisor is not a kit panel**: `.rt-head` / `.rt-x` / `.rt-grip`; ui-scale.js and ui-layout.js reuse `.rt-head` as its drag handle. Its CSS still holds unused `rt-tabs, rt-tab, rt-subtabs, rt-hero, rt-chips, rt-chip, rt-obj, rt-objbar, rt-showing, rt-pick` (nothing creates them).
6. **Info Bar**: the kit documents `.cc-ibar / .cc-z / .cc-mod`; the live bar uses `.cc-bar` with `.zl .zc .zr` and `.m`. Height is compact / normal / roomy in settings but `data-h` s / m / l in CSS.
7. **Lever Advisor** is a Drawer, but the old id `cc-lever-panel` survives in ui-scale.js, ui-layout.js and the kit's GUARD list.
8. **Fortress Tracker** has no panel: it draws into `#cc-droplog` (`.ft-*`). The Drop Luck Panel id says "droplog", its title "Drop Luck Tracker".
9. **Same word, different thing**: Chat `.tab` = filter chip; Drop Luck `.chip` = card and `.row` = card line; Bank `.pill` = switch; Layouts `.row`; Fortress `.ft-badge` / `.ft-pill`; per-plugin `.hero`, `h5`, `.stats` copy kit patterns instead of using them.
10. **Selected** is spelled `.on`, `.sel`, `.is-sel`, `.active`, `aria-selected`, `aria-pressed`. **Locked** has three meanings (row, master button, panel).
11. Tokens: `--cc-text-faint` is defined twice (#707086 / #7c7c93); `--cc-row-h` and `--cc-cell-h` are read but never declared; `--cc-q-kill` and `--cc-q-skill-rgb` are global despite the `q-` prefix.
12. Docs drift: `docs/COMPONENTS.md` shows the Alert List as `cc-menu cc-alist` (code: `list cc-alist`) and the layout editor as `.cc-frame / .cc-lbar` (code: `#cc-ed-root .fr`, `#cc-ed-bar`). Every Plugins-page row type reuses `settings-toggle-row`.
