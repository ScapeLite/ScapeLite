# ScapeLite default layout

A ready-made arrangement of every panel, worked out for the window you actually have. It is **opt-in**: nothing moves until you press it, your own layouts are never touched, and **Back to my old layout** puts everything back.

## Try it

- Layout Editor (Ctrl+Alt+L, or **Edit Layout** in the ScapeLite menu) > **ScapeLite default**.
- Or Settings > Plugins > Panels > **ScapeLite Default Layout** > Use it.
- To undo: **Back to my old layout** (same two places). It restores the panels' places, their sizes and scales, the game windows' scales, tab groups and your panel look.
- Pressing **ScapeLite default** again (for example after changing the window size) rebuilds it for the new size; the first "old layout" backup is kept.
- Tinker freely afterwards: the arrangement is the layout called `ScapeLite default`, so every move you make is saved in it. Use **Save as...** first if you want to keep your tinkering, because pressing the button again rebuilds the original.

A preview of three window sizes is in `docs/default-layout-preview.html`.

## The idea

One design, drawn once on a 1920 x 1012 area (a 1080p window minus the two 34 px Info Bars), then scaled by `f = min(width / 1920, usable height / 1012)`. Columns hug the **right** edge, helper tabs and chat hug the **left**, so a wider window adds empty space in the middle and a smaller one shrinks everything in step.

```
 top Info Bar
 Info (game)        keep clear: invites, task popups, toasts
 Helpers (tabs)                       Route Advisor | Inventory type | Task queue
 Goals, Drop Luck,                                  | Equipment, Barter  |
 Materials, Tree                                    +--------------------+
                                                    | Skills type        | XP tracker
 Chat                                               | Quests, Diary,     |
                                                    | Friends            |
 bottom Info Bar
```

| Spot | Holds | Why there |
| --- | --- | --- |
| Right column | Task queue on top, XP tracker below; the game's Tasks window shares the queue's spot | The thing you look at most sits at the edge, out of the middle of the game |
| Next column left | Slot A: Inventory, Equipment, Barter. Slot B: Skills, Quests, Diary, Friends | Windows and pinned cards of one family share one spot. Pinned cards also become a tab group, so opening two shows a tab strip instead of one on top of the other |
| Next column left | Route Advisor | Its map drawer opens into the free middle |
| Left, under the Info panel | Goals, Drop Luck, Materials, Tree Advisor as one tab group | Helpers you open now and then |
| Bottom left | Chat | Reads like the game's own chat; the left tab strip ends well above it |
| Top band (150 design px, right 70 %) | nothing | Invites, task popups and toasts appear there |

Not moved: the game's Info panel, Current Task, Raid DPS, Fortress, the left tab strip, the Info Bars, the HP panel and the alert bell. They sit where the game puts them and are treated as fixed.

## Sizes and scale

Scale uses the on-screen convention of the size menu: 100% is unscaled, ScapeLite panels get 80 to 90 % times `f`, the game windows about 80 % times `f`. The stored multiplier is that divided by the game zoom and the global panel size, so the layout looks the same whatever "Panel size" you picked in Settings. Sizes of resizable panels are stored as before-scaling pixels, the same at every window size; only the scale changes with the window.

The look (colours, spacing, text size, accent) is set to the ScapeLite defaults, so the layout reads like the Design Lab. **Back to my old layout** restores your own look.

## Per window size

Positions are real screen pixels, Info Bars on. Width and height are what the panel covers on screen.

| Window | Panel | x | y | width | height |
| --- | --- | --- | --- | --- | --- |
| 1920 x 1080 | Task queue | 1560 | 194 | 352 | 560 |
|  | XP tracker | 1544 | 778 | 368 | 240 |
|  | Route Advisor | 838 | 194 | 378 | 640 |
|  | Inventory type (slot A) | 1225 | 194 | 301 | 352 |
|  | Skills type (slot B) | 1225 | 554 | 301 | 352 |
|  | Helper tabs | 96 | 194 | 396 | 450 |
|  | Chat | 8 | 795 | 522 | 243 |
| 2560 x 1369 (zoom 1.27) | Task queue | 2097 | 240 | 453 | 720 |
|  | XP tracker | 2077 | 990 | 473 | 309 |
|  | Route Advisor | 1169 | 240 | 486 | 823 |
|  | Inventory type (slot A) | 1667 | 240 | 387 | 453 |
|  | Skills type (slot B) | 1667 | 702 | 387 | 453 |
|  | Helper tabs | 123 | 240 | 509 | 579 |
|  | Chat | 10 | 1012 | 671 | 312 |
| 1366 x 768 (zoom 0.71) | Task queue | 1117 | 145 | 243 | 387 |
|  | XP tracker | 1106 | 549 | 255 | 166 |
|  | Route Advisor | 618 | 145 | 261 | 443 |
|  | Inventory type (slot A) | 885 | 145 | 208 | 243 |
|  | Skills type (slot B) | 885 | 394 | 208 | 243 |
|  | Helper tabs | 66 | 145 | 274 | 311 |
|  | Chat | 6 | 560 | 361 | 168 |

(`npm run test:default-layout` prints the exact numbers it checks; `node scripts/test-default-layout.js --preview=file.html` redraws the preview.)

## What the test proves

`scripts/test-default-layout.js` has two parts and never touches the real game:

1. **Arithmetic**, at ten window sizes with and without Info Bars (1024 x 768 up to 3840 x 2160): every panel inside the usable area, panels of different spots never overlap, the notification band and the Info panel / tab strip stay clear, sizes respect the editors' minimums, every id is accepted by the layout import, tab-group members share one spot, a game window and the pinned card of its family line up.
2. **The real `ui-layout.js` and `default-layout.js`** on a fake game shell in a private hidden window: the panels really land where the arithmetic says (within 3 px, scaled game windows included) at four window sizes; tab strips appear; **Back to my old layout** restores positions, scales, sizes and stored layouts exactly; your own saved layout is untouched; a game window you move by hand afterwards stays where you put it.

## How it works (for plugin authors)

- `overlay/default-layout.js` is pure arithmetic (no DOM): `build({ w, h, top, bottom, zoom, g })` returns the layout store entries, tab groups, look, the scales for the game's windows and the on-screen rectangles the tests check. It is loaded in front of `ui-layout.js` by the watcher.
- `ui-layout.js` stores the result as the layout `ScapeLite default`. A game window entry carries `tx`/`ty`, the on-screen spot to land on; when the window opens, the editor nudges its left/top by what it measures (the window may be scaled), and forgets the target as soon as you move the window yourself.
- The game's own windows were not found by the editor since the game moved them into `#hud-layer`; the lookup now checks there first.
- `window.__ccPanelScale.setScales(map, replace)` (panel-resize.js) sets or restores the game windows' scales.
- Everything is display only: positions, sizes and scales; no clicks.
