# ScapeLite plugin author guide

A ScapeLite plugin is a small folder: a **manifest** (`plugin.json`) and a **script** (`main.js`) that runs inside the game page. This guide gets you from nothing to a working plugin in about ten minutes. A complete, working example is in [`examples/plugins/session-clock`](../examples/plugins/session-clock).

## 1. The rules (read these first)

1. **Display / information only.** A plugin may show things and restyle the interface. It must **never click, select, submit, or act in the game** for the player.
2. **Add your own elements; never edit the game's.** The game rebuilds parts of its interface (the Tasks panel breaks if its children are moved). Create your own `<div>`/`<style>` and put them on the page. Restyling with CSS is fine.
3. **Send nothing off the player's PC** unless the player explicitly set it up (e.g. their own webhook).
4. **Clean up completely.** *Remove* in the marketplace calls your `teardown()`; leave no elements, styles, timers or listeners behind.

## 2. Folder layout

```
my-plugin/
  plugin.json      the manifest (what the marketplace shows)
  main.js          the script (what runs in the game)
```

Put the folder in ScapeLite's **plugins folder**:
- installed app: `%APPDATA%\ScapeLite\plugins`
- from source: `overlay/plugins`

Restart ScapeLite once so it notices the folder. After that, **Add / Remove** in the marketplace works instantly, no restart. Community plugins start **switched off**; the player opts in.

## 3. `plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "your name",
  "category": "Info",
  "tagline": "One line shown on the card.",
  "description": "A longer description for the detail view.",
  "features": ["Does this", "And that"],
  "tags": ["xp", "tooltips"],
  "main": "main.js",
  "ns": "__cc_my_plugin"
}
```

- `id`: lowercase letters, digits, dashes.
- `ns`: the single global your script defines (see below); used to check the plugin is running and to tear it down.
- `category`: User Interface, Planning and Routes, Notifications and Discord (Core is reserved for the ScapeLite team).
- Optional `guide`: `{ "title": "...", "steps": [{ "title": "...", "body": "<p>HTML</p>" }] }` adds a "How to set it up" popup to the marketplace page.

## 4. `main.js`: the skeleton

```js
(function () {
  'use strict';
  const NS = '__cc_my_plugin';
  try { window[NS] && window[NS].teardown(); } catch (e) {}   // safe to inject twice

  const style = document.createElement('style');
  style.textContent = '#cc-my-plugin{position:fixed;z-index:99970;...}';
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'cc-my-plugin';
  document.body.appendChild(el);

  const timer = setInterval(update, 1000);                    // keep timers light (see section 6)
  function update() { /* read data, update your own element */ }

  function teardown() {
    clearInterval(timer);
    el.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
  }
  window[NS] = { teardown };                                  // the one global you own
})();
```

Use a unique prefix (`cc-my-plugin`) for every id, class and CSS rule so nothing clashes with the game or other plugins. Keep your z-index below 99985 for ordinary UI.

## 5. Reading game and ScapeLite data

- **The page itself.** Read what the game already shows, e.g. the Skills panel tooltips (`.skill-cell[data-skill-id] .tooltip .tt-line.tt-xp`). Read-only.
- **XP rates:** `window.__ccXpTracker.rates` → `{ skill: xpPerHour }` (may be missing: always check).
- **Game data bridge:** `window.__ccBridge.project()` gives the queue with task times, XP and quest info; `.goalState()`-style helpers may appear in later versions. Check `window.__ccBridge && window.__ccBridge.ok()` first.
- **Lamp preview (pure read):** `window.__ccBridge.lampPreview(itemId, qty)` returns what an XP lamp, combat lamp or gem would do to every skill it can be used on: `{ id, name, kind:'lamp'|'combat', held, qty, per, allBonus, skills:[{id,name,level,cap,xp,gain,gainN,lvTo,pctFrom,pctTo,lvToN,pctToN}], others }`, or `null` for any other item. `qty` omitted = the stack held (bank plus inventory). Formulas: lamp = `xpMultiplier` x the skill's current level in XP to the chosen skill (a Massive lamp also gives `allSkillBonus` x level to every other skill); combat lamp or gem = a flat `Constants.combatXpFlat` to one of the six combat skills; N lamps = N x one. The Hover Info toggle `hoverLampPreview` draws it in the item tooltip.
- **Walking speed, one source for everyone:** `window.__ccBridge.speed()` returns the game's real current movement speed in steps per second, computed with the game's own formula (Vigor with its pet/cape/tool bonus, telescopes, compasses, swift beacons, fortress milestones, collector, shards, fleet foot, and the active movement potion). Never keep your own copy of this number (do not scrape the Unlocks panel, do not use a constant such as 18).
  ```js
  const s = window.__ccBridge && window.__ccBridge.speed();   // null until the game state is found
  // s = { sps, unbuffed, base, vigor:{level,effective}, mods:[{id,label,source,pct,steps}], potion:{id,name,pct,stepsLeft}|null, time(steps), at }
  const sec = s ? s.time(1500) : null;                         // seconds to walk 1500 steps; follows a potion that runs out part-way
  const off = window.__ccBridge.onChange('speed', (info, prevSps) => recompute());   // fires when the speed moves by more than 0.02 steps/s (potion starts or ends, level-up)
  // off() unsubscribes. A subscription survives a bridge re-attach, so subscribe once (the bridge may not exist yet: retry from your tick until it does).
  ```
  `sps` is the speed right now (potion included), `unbuffed` the speed without a potion, `mods` the breakdown for a tooltip (`pct` is the fraction added to the base multiplier, `steps` what it adds in steps/s). The result is cached for 500 ms, so calling it from many plugins and every tick is cheap. `node scripts/verify-bridge-speed.js` checks it against the game (see docs/ROUTE-ADVISOR-MODEL.md, "Walking speed").
- **Your own settings:** plugins can't add rows to the in-game Settings tab (yet). Store small settings with `localStorage` under your own key, e.g. `cc-plugin-my-plugin`.
- **Other plugins' globals** may not exist (the player may have them off). Wrap in `try/catch` and degrade quietly.

## 6. Performance (this matters)

The game's page has well over 100,000 elements, so a global `document.querySelector` costs about 1 ms. Do this instead:

- **Cache elements** you query repeatedly and re-check `el.isConnected`; query inside a small container rather than the whole document.
- Prefer one `setInterval` of **1 s or slower**; use `requestAnimationFrame` only while something is actually animating or being dragged.
- Never poll in a tight loop, and avoid layout thrash (don't read and write layout in alternation).
- ScapeLite's status light (bottom-left; hover it) shows the CPU time of every plugin by name, so you can see yours. Your script is named `cc-plugin-<id>.js` in profiles.

## 7. Look and feel

Match the game and ScapeLite: dark cards `rgba(14,14,20,.92)`, 1 px `rgba(255,255,255,.16)` borders, 9-10 px radius, gold `#ffd24a` for highlights, green `#5fe06d` for good numbers, system font 12-13 px. Respect `prefers-reduced-motion`. Let the player drag or hide anything that floats.

## 8. Test and debug

1. Copy your folder into the plugins folder and restart ScapeLite once.
2. Open the marketplace → your plugin appears under the category from your manifest (or **Community** if you give none), with a "by <author>" chip → **Add**.
3. Problems? The dashboard's **System** log shows load errors; the saved files in the `Logs` folder (`Logs/System`, `Logs/Watcher`, `Logs/Errors`) have the same lines. Your plugin can write its own lines with `window.__ccLog && window.__ccLog.channel('Plugins').info('text', { data })` (levels debug, info, warn, error); see docs/LOGGING.md. To use the browser DevTools on the game, set `"devMode": true` in `local-config.json` in ScapeLite's data folder and use the DevTools link.
4. Press **Remove**: everything you added must disappear.

## 9. Sharing and getting listed

For now, share the folder as a zip; players drop it into their plugins folder. A community listing in the marketplace is planned. Include a short README, the permissions your plugin needs (which globals it reads), and keep to the rules in section 1.

Players can install your plugin straight from its GitHub link (marketplace → **Add plugin** → **From GitHub**); put `plugin.json` and your script at the root of the repository (or a folder, then share the folder link). To be listed in the marketplace's *Community plugins* section, follow [Submit a plugin](SUBMIT-A-PLUGIN.md).
