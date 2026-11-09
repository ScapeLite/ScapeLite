# Info Bars on narrow windows

The Info Bars (top and bottom) never put text on top of other text. Whenever the window width or the content of a bar changes, the bar is **fitted**: the real modules are measured and, only as far as needed, made smaller in a fixed order. Each bar (top, bottom) is fitted on its own. The code is in `overlay/ui-bar.js` (search for `fitBar`); the test is `npm run test:barfit`.

## The order

1. **Free room first.** The three zones (left, middle, right) only pack their modules; nothing is stretched. Empty-space spacers you placed are the first thing to give: the widest one shrinks (down to 4 px) before any text changes.
2. **Drop labels and secondary parts.** The longest module that still has something to drop goes first. "12.3k XP/hr" becomes "12.3k", "Mining Mithril 1,234/4,800 · 5 min · Lv 81" loses its last parts one by one, "Gathering · Dustclaw Foundry" loses what you are doing before the place, "Chat · name: text · 3 new" loses the word Chat. The whole text stays in the hover card.
3. **Abbreviate numbers.** 1,234,567 becomes 1.2M, 12,345 becomes 12k (longest module first).
4. **Tight.** Gaps and padding of the whole bar shrink to a minimum.
5. **Ellipsis.** The flexible text modules (task, location, chat line, Next action, event, panel buttons ...) are cut with "…", the longest first and down towards the next longest, never below about 64 px. The hover card has the whole text. Short numeric modules (bell, clock, gold, XP per hour, blood coins, bag space, Hit points as a number) are never cut. A group of panel buttons narrows its labels step by step and finally shows only the icons.
6. **Hide (last resort).** The lowest-priority modules move into a **…** button at the right end of the bar; click it to see them (and click one to use it). Order, first hidden first: Clock, Blood coins, Players online, World, Offline hours, Game event, Inventory space, Gold, Location, XP per hour, Next action, Window buttons, Active potions, Current task, Chat. The **Alert bell, Hit points and the panel buttons are never hidden.**

A step is only used when the ones before it cannot make the bar fit. Widening the window undoes it again (the bar is fitted from scratch each time).

## Your say

Right-click a module, **When the bar is too narrow**:

- *Shorten it as needed, hide it when nothing else helps* (default)
- *Hide it first* (it moves into the … menu before anything else is shortened or hidden)
- *Never hide it* (it can still be shortened)

The choice is saved with the module in the bar layout. It does not change anything else about your bars.

## What it costs

The fit runs when the bar width changes (one resize observer per bar, coalesced into one frame), when the module set or the length of a text changes, or when something still sticks out. While nothing changes it does no work (a refresh every second only compares a small key). It waits while Eco mode is on or the page is hidden and fits as soon as it wakes. It reads and writes only the bar itself.

## Test

`npm run test:barfit` runs the real `ui-bar.js` in a private window on a fake game page and checks, at widths from 1024 to 3840 and for the default modules, for everything switched on (top and bottom bar), and for spacers: no overlap, nothing past the window, no clipped text without an ellipsis, the order above, the hidden order, the "Hide it first / Never hide it" options, the hover card keeping the whole text, and that it fits on resize, not while idle, and not in Eco mode.
