# Design Lab

A standalone page that shows every ScapeLite panel, card, bar, menu, tooltip, icon and component with realistic mock data, using the **real production CSS**. No game needed, no build step.
Names on every item come from [UI-NAMING.md](UI-NAMING.md) (the same list, `design-lab/names.json`).

## Open it

```
npm run design-lab            # then open  http://localhost:7790/design-lab/
```

Or, when the dashboard is running from a development checkout (restart it once after pulling): `http://localhost:7777/design-lab/`.
The lab is read-only and dev-only: `design-lab/` is not part of the installer, and the server serves only the lab, `overlay/*.js`, the docs and the game icons.
It needs the server (not `file://`) for the icon gallery and `names.json`.

## What is on the page

| Area | What it is |
|---|---|
| Left nav | One page per category from the naming scheme (Scenes, Panels, Windows, Drawers, Bars, Cards and rows, Menus, Tooltips and popovers, Trays, Modals, Toasts and alerts, Docks and handles, Overlays, Widgets, Components, States and variants), then Design tokens, Icon gallery, Naming registry, Coverage |
| Search (`/`) | Matches specimen titles, standard names and paths, ids, CSS selectors, file names, aliases, and design tokens. Try `cc-row`, `ui-queue.js`, `tray`, `--cc-good` |
| Specimen card | Header = standard name, path (`Queue Panel > Card > Tile`) and id. Footer = every registered name the specimen shows; click one to copy its path |
| Scenario (right) | Activity (idle, combat, Fortress run, dungeon party), queue (empty, 3, 8, 14 tasks), hit points, alerts, game window size (for Scenes), palette (ScapeLite, match game, colour-blind), density, UI scale, text size, accent, stage background, freeze animations. Quick scenarios set several at once |
| Inspect | Turn it on, click any element in a specimen: the bar at the bottom shows its standard name (and the names it sits inside) and copies the path |
| Design tokens | Every `--*` custom property in the real stylesheets, grouped (colours, spacing, type, radii and shadows, motion, z-index, component-scoped such as `--q-*`), with swatch, live value and the file. Edit a value and every specimen updates (an override rule, never written to a file). Also lists z-index layers, font sizes, radii and durations actually used |
| Icon gallery | All game icons in `public/assets/icons` (search by name), the marker icons and the glyphs ScapeLite draws as text |

## How the real code is used

- `overlay/ui-kit.js` runs for real in the page (`window.__ccUI`): menus and toasts in the lab are built by `UI.menu()` / `UI.toast()`.
- `overlay/ui-queue.js` runs for real against a stub of the game data bridge (`design-lab/stub-bridge.js`), so the Task queue is the real DOM and the real tray: hover a tile.
- At boot, `harvest-frame.js` runs every UI-creating `overlay/*.js` in a hidden frame and copies the `<style>` elements they create into the page. **CSS is never duplicated**: change a style in `overlay/*.js`, reload the lab, and it is there. Cross-origin requests and WebSockets are blocked in that frame, so the lab never talks to the game or the web.
- The remaining surfaces are specimens (`design-lab/spec-*.js`): small functions that build the plugin's real DOM structure and class names from mock data (`design-lab/mock.js`).
- Backdrop only: the game's own windows and world are drawn as plain mock shapes.

## Add a component or surface

1. Add the element to `design-lab/names.json` **and** the table in `docs/UI-NAMING.md` (same id, path, selector, file).
2. Add a specimen to the fitting `design-lab/spec-*.js`:

```js
Lab.add({
  id: 'xp-tracker', cat: 'Panels',                 // cat must be one of the category names above
  title: 'XP Tracker', desc: 'one line', keywords: 'extra search words',
  covers: ['xp-tracker', 'xp-tracker.header'],     // registry ids shown on the specimen; the first gives the title and path
  variants: [{ label: 'Expanded', w: 318 }, { label: 'Collapsed chip' }, { label: 'Bar', box: [600, 34] }],
  render(ctx, v) {                                  // pure: build fresh DOM from the scenario each time
    const { h, M, S } = ctx;                        // h('div.cc-row', {'data-tone':'good'}, ...kids); M = mock data; S = scenario state
    return h('div.cc-panel.show', null, h('div.hd', null, h('b', null, 'XP Tracker')), h('div.bd', null, ...));
  },
});
```

- `v.w` fixes the width in px; `v.box:[w,h]` gives a clipped containing block so `position: fixed` or absolute things (bars, handles, rings) stay inside the card.
- `ctx.watch(el)` makes the kit set `--s` and `data-bp` (full / compact / micro) from the element’s width.
- Copy the DOM and class names from the plugin’s own builder code. Do not write new CSS in the lab; if a style is wrong, fix it in the plugin and reload.
- Make `render` react to `ctx.S` and `ctx.M` so the Scenario panel stays meaningful.
- `Lab.build('id')` renders another specimen (used by the Scenes).
- The **Coverage** page lists registered names that have no specimen yet, and specimens that point at an id missing from `names.json`.
- `design-lab/spec-more.js` holds the specimens added to close Coverage gaps (all Settings > Plugins groups and sections, Layouts window, small tooltips, Legacy Card, Drop Luck chip, food total, divider, channel colour, drag ghost) and a table `ALSO` that adds names to the `covers` of specimens that already draw them (for example the Queue Panel's card parts). Add a name to `ALSO` only after checking that the specimen's DOM really contains its selector.
- On Coverage, a token counts as shown when the **Design tokens** page lists its custom property (`--cc-...`); a token whose selector is not a custom property (for example the layer rows) still needs a specimen.

## Limits

- Specimens copy the structure of live DOM; if a plugin’s builder changes shape, update the specimen (Coverage and a quick look catch most drift, the CSS never drifts).
- "Match game" palette uses approximate stand-in values for the game’s theme variables; the real values need the live game.
- Some `ui/*.png` icons (quest, diary) are not in `public/assets/icons`; their images hide themselves.
- Hover tooltips that clone the game’s own tooltip use mock text.
