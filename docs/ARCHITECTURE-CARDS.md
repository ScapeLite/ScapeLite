# ScapeLite cards: how they are defined, how they refresh, how to test them

A **card** is ScapeLite's own picture of a game panel (Skills, Inventory, Equipment, Diary, Quests, Friends, Barter, Chat) or of game data (the task queue). It is shown in two places, built from the same model: the **hover card** (opens over an Info Bar button) and the **pinned card** (a movable, resizable panel). Display only: a card reads the game; the only way it acts is by handing the user's own real click to the game's own control.

Why this document exists: every card used to find out that the game had changed in its own way (a 1 s poll with a JSON signature, `setTimeout` re-renders after a forwarded click, "never redraw while the pointer is on the card", a Barter special case). Every one of those was a place for a stale card (Equipment toggles that did not move, Barter Charm lag, the queue's "out of date" refusals). There is now one mechanism.

## The parts

| Part | File | Job |
| --- | --- | --- |
| Card layer | `overlay/card-sync.js` (`window.__ccCardSync`, core plugin `card-sync`) | Sources, change notifications, the follow window, the redraw policy, the registry of card builders |
| Card builders | `overlay/cards/<name>.js` (core plugin `cards`, ns `__ccCards`) | One file per card: reads the game, returns the model |
| Card hosting | `overlay/ui-bar.js` | The bars, the hover card, the pinned card panels, `fillCard` (draws a model), `renderCard` (redraws a pinned card) |
| Task queue | `overlay/ui-queue.js` | The queue panel and its hover card; uses the same layer for its source |
| Plugin order | `PLUGIN_DEFS` in `overlay/panel-resize-watcher.js` | `card-sync`, then `cards`, then `ui-bar` |

## Defining a card

A card file registers a **factory**; the bar calls it once with a small context and then asks the instance to `build()` on every redraw.

```js
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('quests', function create(c) {
    const { setting, bridge, panelEl, txt, ttHtml } = c;      // only what this card uses
    let mode = 'active';                                      // card state lives in the closure
    function questsRich() {
      const root = panelEl('quests');                         // the game's panel element (null if it is not there)
      // ...read the game, never change it...
      return { title: 'Quests', note: '2 active', blocks: [{ kind: 'bars', rows: [...] }] };
    }
    return { source: 'quests', build: questsRich };
  });
})();
```

The model is `{ title, note, blocks: [...], gear?, corner?, loadout?, auto?, min? }`. Block kinds (`grid`, `bars`, `rows`, `tabs`, `actions`, `chips`, `stats`, `label`, `chat`, `clone`, `text`) are drawn by `fillCard` in `ui-bar.js`; a row, cell or button can carry `detail` (the game's own tooltip markup, shown as a second card), `click` / `onClick` (hands the user's click to the game), `disabled`, `tone`. The context `c` has: `setting(key, default)`, `put(key, value)`, `bridge()`, `panelEl(id)`, `txt(el, sel)`, `ttHtml(el)`, `ownText(el)`, `hideTip()`, `pretty(id)`, `redraw(tab)` (redraw this card now: for the card's own UI state such as a tab switch) and `fwd(key)` (tell the layer a click was handed to the game).

To add a card: write `overlay/cards/<name>.js`, add the tab to `PANEL_TABS` / `CARD_TABS` in `ui-bar.js`, add a source for it in `card-sync.js` (one line in the `['skills', ...].forEach(define)` list when it copies a game panel), and add a test (below). The watcher loads every `overlay/cards/*.js` in file-name order; the installer packs `overlay/cards/*.js` (`package.json` `build.files`, `scripts/lib/package-guard.js`).

## How a card learns that its source changed

`__ccCardSync.watch(key, callback)` subscribes to a **source**; the callback gets `{ key, forwarded, why }` and returns `false` for "not now, ask again". The unsubscribe function is the return value.

* **A game panel** (`skills inventory equipment diary quests friends barter chat`): ONE `MutationObserver` on the panel's root element (childList, subtree, attributes, characterData). It is attached when the first card watches the source and detached with the last one, so a closed card costs nothing. ScapeLite's own marks on the game's panels (`cc-lock-btn`, `cc-hover-dist*`, `cc-qw*`) are filtered out (they change every second and mean nothing to a card). Notifications are coalesced: at most one per source every 250 ms (60 ms while following a forwarded click). The panel root is looked up again once a second while watched, in case the game replaced it.
* **Data without a panel** (the task queue is drawn from `__ccBridge.project()`): `define('queue', { poll: { ms: 1000, sig? }, fresh })`. It polls only while watched; with a `sig` function it notifies only when the signature changed, without one it notifies on every tick.
* **Bridge events**: the bridge offers `onChange('speed')` only; the queue subscribes to it next to the layer (a potion changes every walking time). More events go into `game-bridge.js` first, then into a card.
* **After the user's click was handed to the game** (`__ccCardSync.forwarded(key)`, called by `fillCard`/`actBtn` for every card control): the source of that card (or every source when no key is known) is checked every 250 ms for 5 s and its changes redraw immediately, even under the pointer. The game answers a Reroll, Buy, Charm or toggle 0.15 to 1.5 s later; nothing here guesses a delay.

A callback does the cheap thing first: build the model, compare its JSON signature with the last drawn one, return when equal. Only a real change reaches the redraw policy.

## When a card may redraw (`mayRedraw`, the one rule)

1. **Never** while a pointer button is held down inside the card (a redraw would replace the pressed button and lose the click) or while a text box inside it has the focus.
2. After a forwarded click: **yes**, at once, even under the pointer (the pointer always rests on the button that was just pressed). The browser re-evaluates `:hover` on the new elements by itself; a redraw also gives the keyboard focus back to the control at the same position.
3. Otherwise, while the pointer is on a control or on a row that has a hover card (`.hv`, `.tabtn`, `.cc-chip`, `input`, `.clk`): **wait**. The layer asks again every 300 ms, so the change lands as soon as the pointer moves away.
4. Anything else: yes.

The pinned card, the hover card and (through its own `refreshAll`) the queue all use this; there are no per-card exceptions. A pinned card that is collapsed or hidden ignores notifications and redraws when it is shown again.

## Hidden panels: does the game redraw them?

The game draws a panel only while it is shown, and ScapeLite hides the panels that have a card. What was measured (live game, `npm run test:cards`, 2026-10-28):

| Source | Redrawn by the game while hidden? | What the card does |
| --- | --- | --- |
| Task queue (`#unified-queue-panel`) | **No** (its rows go stale, which is why `rowsFresh()` refused actions) | Reads `__ccBridge.project()` (game data, always current). Before any action it calls the game's own redraw, `bridge.refreshQueuePanel()` (reseed + update, read only), through `__ccCardSync.fresh('queue')`. |
| Friends | Rows match `bridge.social()` | Reads the bridge |
| Inventory | Used slots match `bridge.alertState()` | Reads the panel |
| Equipment | The active loadout matches the game's current one | Reads the panel and the bridge |
| Barter, Quests, Diary, Skills | Matched the game in every live check, but there is no second source to prove they are redrawn while hidden (only a long observation could) | Read the panel. If one of them goes stale while hidden, add `fresh` to its `define()` (the game's own redraw call) |

The harness has a check for the first two rows (`hidden game panels are in step with the bridge data`). A new card must say in its header comment which of these it is.

## The bridge snapshot (`__ccBridge.snapshot()`)

Cards and plugins used to call several bridge readers (`held`, `speed`, `ledger`, `current` ...) separately, each walking the game state again. `snapshot()` is one cached, read-only object built from the same game state:

`{ at, rev, speed:{sps,unbuffed,potion}, held:{itemId:qty}, skills:{id:{level,xp}}, potions:{type:[...]}, task:{state,skill,activity,node,idle}, slay:{active,master}, combat:{active,raid,mobs,mobsAlive} }`

- It is rebuilt at most every 500 ms, and only when someone asks (`snapshot(true)` forces a rebuild). Ten callers in one frame share one build.
- `rev` goes up only when something a listener cares about changed: speed, held (item count or total quantity), a skill **level** (not every XP tick), potions, the task, the slay task, combat start/stop. XP and HP are always fresh in the next snapshot but never raise `rev`.
- `onChange('snapshot', fn(snap, changedKeys))` fires on those changes and returns the unsubscribe function. While somebody listens, the bridge checks once a second, on the same timer the `speed` subscription uses; with no listener nothing runs. A throwing subscriber does not stop the others.
- Additive: every older reader keeps working. First consumer: the Info Bar reads `held` from the snapshot instead of walking the bank each second.
- Tested without a game by `node scripts/test-bridge-snapshot.js` (stub game state).

## How to test

* `npm run test:cards`: the whole harness (about 25 s). Needs the game on CDP 9222 for the live suite (skipped with a note when it is not running) and `node_modules/electron` for the fixture suite.
  * **Live suite** (read-mostly): every card opened with real CDP mouse events (hover card on its Info Bar button, pinned card through `__ccBar.cards`), facts compared with the game's panel or bridge (counts, labels, on/off states); the Equipment display toggles (Potion boosts, Spirit modifier) pressed with a real click, checked on both sides, pressed again and restored in a `finally` block; afterwards `cc-panel-fuse` and `cc-plugin-settings` are compared with the start, `HTMLElement.prototype.click` and `dispatchEvent` must still be native, the cards must be open or closed as before and the layer must hold no observer, poll or listener that it did not hold at the start. **It never presses anything that spends or changes game state** (Barter Reroll/Buy/Sell/Charm, queue rerolls, swaps and drags, quest claims, equipment swaps).
  * **Fixture suite**: `scripts/fixtures/cards-fixture.html` is a fake game (markup of the Barter, Equipment, Quests and queue panels, handlers that change the DOM 0.15 to 1.2 s after a click, a queue panel that is only redrawn by `refreshQueuePanel()`) opened by `scripts/fixtures/electron-host.js` in a private hidden Electron window on port 9333 with the REAL overlay files injected in plugin order. Here Reroll, Buy, Charm, loadout picks and queue selects ARE pressed (with real mouse events), and the redraw rules are checked: follows a change nobody clicked, waits while pointing at a row and lands when the pointer leaves, a held button is not replaced mid-click, the hidden queue panel is refreshed before an action and the card follows.
  * Options: `--live-only`, `--fixture-only`, `--overlay-dir=<dir>` (test another copy of the overlay files, for example the previous commit's), `--port=`, `--fixture-port=`.
* `npm run lint:forwards`: every `.click()` and `.dispatchEvent(` call in `overlay/*.js` and `overlay/cards/*.js` must be marked `// fwd-ok` (an approved forward of the user's click) or counted in `scripts/forwards-baseline.json`. A new unmarked call in a file fails the check; the existing sites (82 at the time of writing) are reported with `--list`, not refactored. Lower the numbers with `--update-baseline` when you mark or remove sites.
* Add a card test by extending `CARD_FACTS` / `GAME_FACTS` in `scripts/test-cards.js` (what the card shows, what the game shows, how to compare them) and, if the card has a button that spends something, a click test in the fixture (`fixtureTests`) with the matching handler in `cards-fixture.html`.

## Performance

Measured on the live game with `Performance.getMetrics` over 12 s (the game itself uses about 480 ms of main-thread time per second; the cards are in the noise): no cards 483 and 499 ms/s before, 487 and 454 after; four pinned cards plus the queue open 539 and 506 before, 512 and 513 after (two runs each). Across 15 s with all seven cards pinned the panels produced 261 raw mutations, 10 of them relevant, and 10 notifications (the old polls built the model of each open card once a second: 105 builds). Observers exist only while a card is open; the layer's listeners (pointer down/up) only while at least one source is watched.

## Known limits

* A change that arrives while the pointer rests on a control waits for the pointer to leave (rule 3). That is deliberate (the hover card would vanish), but a card can look one change behind while you point at it.
* `forwarded()` follows a source for 5 s; a game answer that takes longer is still seen (the observer does not stop), but it then follows rule 3.
* The queue still uses its own 80 ms `watchSlot` poll after a reroll (it animates the row that is being rerolled until the new options land) and `renderHold` (1.6 s after a drag).
* The Info Bar's non-card modules (Potions, Alerts, ...) still refresh from the bar's own 1 s timer.
