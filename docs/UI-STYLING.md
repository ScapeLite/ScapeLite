# Changing how ScapeLite looks: one place, with explicit exceptions

Every ScapeLite panel, hover card, info bar, menu, tooltip, toast and alert is drawn from one shared library in `overlay/ui-kit.js`.
Change a value or a component there and it applies everywhere. Nothing else needs touching.

## Where things live

| What | Where |
|---|---|
| Colours, spacing, type, radii, motion (`--cc-*` tokens) | the `:root` block at the top of the kit's style text |
| Components (`.cc-chip`, `.cc-row`, `.cc-cell`, `.cc-prog`, `.cc-menu`, `.cc-tip`, `.cc-toast`, `.cc-btn`, `.cc-alert`, `.cc-ibar` ...) | the `cc-ui-components` style in `ui-kit.js` (reference: `docs/COMPONENTS.md`) |
| Palette (ScapeLite / match game / colour-blind), accent, density, text size | `applyTheme()` in the kit, driven by Settings > Plugins > Panels |
| Menu, toast, panel shell, cogwheel, scale helpers | `window.__ccUI`: `menu()`, `toast()`, `panel({gear})`, `ccWatch()`, `ccPlace()`, `ccTip()` |
| Starting size of new panels, tooltips at the cursor, inventory rows | Settings > Plugins > Panels |

## Rules

1. **Tokens only.** Use `var(--cc-...)` for every colour, never a hex code. The palette switch, colour-blind mode and accent colour only reach what uses tokens.
2. **Meaning by tone.** Put `data-tone="good|warn|bad|info|magic|accent|kill|dim"` on a component; do not write a colour. Gold (accent) means the advisor or a selection.
3. **Use a component before writing CSS.** A list item is a `.cc-row`, a button is `.cc-btn`, a filter is `.cc-chip`, a menu is `UI.menu()`, a notice is `UI.toast()`.
4. **Never act in the game on your own.** Styling code only draws; a click or drag by the player is the only thing that may change the game.

## Making an exception

An exception is allowed, but it must be visible and scoped:

- Put the override in the plugin's own style, scoped to its own root (`#my-panel .cc-row{...}`), with a one-line comment saying why.
- Still use tokens inside it. A truly special colour (for example the luck scale or the walking-time scale) gets its own named token in the kit
  (`--cc-w1..w4`, `--cc-wt`, `--cc-q-kill`) so it can be found and changed in one place.
- Do not copy a component's CSS into a plugin. If a component is missing something, add a modifier class to the kit (like `.cc-row.nolf`) so everyone gets it.

## Adding a panel

```js
const P = window.__ccUI.panel({ id: 'my-panel', title: 'My panel', collapsible: true, closable: true, resizable: true, width: 360,
  gear: { tip: 'Settings', items: () => [ { head: 'My panel' }, { label: 'Option', checked: () => get(), onClick: () => flip(), keepOpen: true } ] } });
P.body.appendChild(/* rows built from .cc-sec / .cc-row / .cc-chip / .cc-prog */);
```

Panels you have not resized start at the "Starting Size Of New Panels" share (default 80%). The cogwheel is optional.

## The game's big windows

`overlay/modal-resize.js` makes Bank, Settings, Skills Customization ... movable and resizable. Model: a window is fullscreen (default, the game's own look) or a window with its own rect. A resize that ends at 80% or more of the fullscreen size in both width and height snaps to fullscreen (setting `modalSnapPct`); moving never changes the mode. While a window, it has a title bar (`#cc-modal-win`) and eight handles; the game behind stays usable while see-through is on (setting `modalFloatEnabled`, per-window override in the menu). State lives in `cc-modal-win` (`{ tab: { full, w, h, ax, dx, ay, dy, see } }`, size in px, position as distance to the nearest edges, like `anchor.js`; the title bar is not a `.cc-panel`, so `anchor.js`, card fuse and the panel scaler leave it alone).
The title bar reuses the panel menu: it registers with `window.__ccUIReg(id, { chrome: true, align, size: { presets, cur, set } })` (lock, align and the Size chips come from `ui-scale.js`, with the window's own align and size handlers) and adds its items through `window.__ccPanelMenu.add`. Anything built into the window (`UI.windowDrawer`) is a child of `.modal-container`, so it follows the window; the UI kit clips ScapeLite panels under the window rect.

## Fusing panels

Any open kit panel (`.cc-panel` with an id) can be fused to a touching neighbour with the link button on their seam (`overlay/card-fuse.js`, Settings > Panels > Fuse ScapeLite Panels). A plugin needs to do nothing: panels move through their own `left` / `top`, and the plugin carries the group. Code that moves panels itself (like `anchor.js`) should treat `window.__ccCardFuse.group(id)` as one unit.

## Layering (one z-order for panels and the game's windows)

One manager in `overlay/ui-kit.js` (`window.__ccUI.z`: `front(el)`, `frontWindow()`, `top()`, `win()`). Rule: **the most recently opened or clicked surface is on top**, for ScapeLite panels and the game's big windows alike.
The game (and its windows) sits in its own stacking context at the bottom of the page, so a window cannot get a real z-index above a panel. It gets a virtual z in the same counter instead: a panel below it is cut where the window covers it (clip-path hole, the rest stays usable), a panel above it is untouched. Opening a panel (`api.show`, or any managed panel becoming visible) or pressing on one raises it above the window; opening the window or pressing in it (or its title bar, handles) raises it above every panel. Setting `uiStackFront` off restores "windows always on top". Only z-index and clip-path of ScapeLite elements are changed, never the game's state.

| Layer | z-index | Notes |
|---|---|---|
| Game world and its windows | game stacking context (below everything of ours) | virtual z (`--cc-z-win`) in the panel band |
| ScapeLite panels, cards, queue, chat, Route Advisor trio, Tree Advisor trio | 1100-1880, newest highest | managed; renumbered when the band is full |
| Window title bar and handles (modal-resize) | `--cc-z-win` (= the window's virtual z) | follow the window, so a panel above the window covers them |
| Queue option tray | 1890-1895 | rides with the queue panel against the window |
| Alert bell, walking countdown, route alert, fuse links | own tokens | HUD widgets: always under a window (exception); fuse links follow their panels |
| Info Bars | `--cc-z-bar` 99900 | always above panels and windows |
| Status dot, window dock, notification dock | 99985-99990 | always above |
| Game tooltips | 99999 | game's own |
| Menus, tips, toasts, modal, drag ghosts | `--cc-z-menu/tip/toast/modal` (2147482600+) | always above everything |
| Bug report | 2147483100 | above windows by design |
