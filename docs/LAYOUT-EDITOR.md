# Layout Editor

Arrange ScapeLite's panels (and the game's own floating windows) the way you like, and save the arrangement.

Open it with **Edit Layout** in the ScapeLite menu, the **Open Layout Editor** button in Settings > Plugins > Panels, or **Ctrl+Alt+L**. Leave with **Done**, **Esc** or the same shortcut.

## What you can do to a panel

Every open panel gets a dashed frame with a small toolbar.

| Control | Effect |
| --- | --- |
| Drag the frame | Move the panel. It snaps to screen edges, other panels and a grid. Hold **Shift** to move freely. |
| Click a frame, then arrow keys | Nudge by 1 px (Shift = 10 px). |
| Corner handle | Resize (ScapeLite panels). |
| lock | Panel cannot be dragged by accident. |
| opacity slider | Make the panel see-through. |
| ghost | Fade out unless the mouse is over it. |
| collapse | Shrink to its title bar (panels that can collapse). |
| - and + | Scale the panel down or up (ScapeLite panels). |
| group | Share one spot with other ScapeLite panels: a tab strip picks which one shows. |
| reset | Back to defaults for that panel. |

The game's own windows (Inventory, Skills, Chat, ...) can be moved, faded and locked too. This needs the game's "windowed panels" setting. Nothing is clicked in the game: only the window's position and look change. Windows joined by Panel Fuse move together as a group: they are drawn grey and left to the game's own dragging, so the fuse is never broken (they can still be faded and locked).

## Layouts

A layout is a named arrangement: positions, sizes, scale, opacity, locks, fades, tab groups and the panel look (colours, spacing, text size, accent).

- **Save as...** stores the current arrangement under a name.
- The drop-down switches layouts. **Delete** removes one.
- Set a layout to **Switch to it in raids** and it takes over while a raid is on, then hands back.
- **Export** shows the layout as text to copy; **Import** loads one from text.
- **Tidy up** arranges the open ScapeLite panels in neat rows; **Undo** brings the old spots back. **Reset all** restores defaults (also undoable).
- **Show all panels** opens every ScapeLite panel while you place them and closes them again afterwards.
- **ScapeLite default** lays out every panel for this window size (see [DEFAULT-LAYOUT.md](DEFAULT-LAYOUT.md)); **Back to my old layout** (shown afterwards) undoes it.

## Look

The bottom row sets the panel colours (ScapeLite, match the game's theme, or colour-blind safe), spacing, text size and accent colour. The same settings live in Settings > Plugins > Panels.

## Limits

- The Lever Advisor stays attached to the game's own window, and the Route Advisor cannot join a tab group (it has a map drawer).
- Everything is display only. The editor never acts in the game.
