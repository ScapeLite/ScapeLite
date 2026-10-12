# Writing a ScapeLite plugin

> The friendly, step-by-step version is the **[Plugin author guide](PLUGIN-AUTHOR-GUIDE.md)** (with a working example in `examples/plugins/session-clock`). This page is the short reference.

A plugin is a **page script** (runs inside the game page) plus a **manifest** that makes it show up in the marketplace.

## Drop-in layout

```
overlay/plugins/my-plugin/
  plugin.json
  main.js
  screenshot.png      (optional)
```

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "category": "Info",
  "tagline": "One line shown on the card.",
  "description": "A longer description shown in the detail view.",
  "features": ["Does this", "And that"],
  "tags": ["xp", "tooltips"],
  "main": "main.js"
}
```

- `id`: lowercase letters, digits and dashes.
- `main`: path to the script, **inside the plugin folder**.
- Restart ScapeLite (dashboard → *Restart*) once so the folder is picked up; after that **Add / Remove** in the marketplace works live.
- Community plugins start **disabled**; users opt in from the marketplace.

## The script

Wrap everything in an IIFE, clean up the previous instance, and expose a `teardown`:

```js
(function () {
  const NS = '__cc_my_plugin';                 // unique global
  try { window[NS] && window[NS].teardown(); } catch (e) {}

  const style = document.createElement('style');
  style.textContent = '.my-thing{color:gold}';
  document.head.appendChild(style);

  const timer = setInterval(() => { /* read the page, update your own UI */ }, 1000);

  window[NS] = {
    teardown() { clearInterval(timer); style.remove(); delete window[NS]; },
  };
  return 'my-plugin loaded';
})();
```

Useful globals provided by other plugins (optional, check they exist): `window.__ccPluginSettings.get(key)` (Plugins-tab switches), `window.__ccXpTracker.rates` (XP/hr per skill), `window.__ccBridge` (read-only game state helpers: `project()`, `goalState()`…).

## Rules

1. **Display / information only.** Never click, select, submit or otherwise act in the game for the player.
2. Don't touch other users' data or send anything off-machine without an explicit, user-configured setting.
3. Clean up completely in `teardown()` so *Remove* leaves no trace.
4. Don't mutate game nodes the game rebuilds (the Tasks panel breaks if its children are moved); add your own elements beside them, or restyle with CSS.

## Bundled plugins

The bundled plugins are described in `overlay/catalog.json` (same fields as above plus `category`, `default`, `core`, `requires`, `screenshots` — images live in `overlay/catalog-img/`) and registered in `overlay/panel-resize-watcher.js` (`PLUGIN_DEFS`). To add a bundled one: script file, a `PLUGIN_DEFS` entry, a `catalog.json` entry, and (optionally) a switch row in `overlay/plugins-settings-ui.js`.

## Author credits and contact links

`catalog.json` has an `authors` map (`"author": "Wulf"` on a plugin points into it) that supplies the `@handle` shown in the Plugins tab and the marketplace. Contact links (Discord, issue tracker, ...) are **not** committed: copy `overlay/authors.local.example.json` to `overlay/authors.local.json` (git-ignored) and fill in what you want to share. Bundled plugins show a **ScapeLite** tag in the marketplace and Plugins tab (to make clear they are not from the Scapewatch developers); drop-in plugins show their author instead.
