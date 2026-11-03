# ScapeLite UI audit and shared UI kit proposal

Scope: read-only audit of `overlay/*.js` panels (2026-10-18). Line numbers are from the working tree at that date. One read-only live measurement of the game page (computed z-index, scale, style tags). "UI boilerplate" = CSS template literal plus the drag/position/close/collapse code that every panel re-implements.

## 1. Inventory: how each panel builds its chrome

| Panel (file, lines) | Header | Drag | Position memory | Collapse / close | Resize | z-index declared | Base font | Scrollbar |
|---|---|---|---|---|---|---|---|---|
| Route Advisor (`route-advisor.js`, 1591) | `.rt-head` css :911, rebuilt in render :1371 | `wireDrag` :1531+, clamps 80px visible, calls `placeExtras()` | `cc-route-panel-pos` :466/:1545 | close x; toggle via menu; no collapse | own `.rt-grip` :912/:1507, ignores scale, min 340x240, size `cc-route-panel-size` :1498 | 99984 :907, map 99983 :1032, tab 99985 :1028, alert 99983 :1046, vtip 2147482400 | 13px (theme: 14) | own thumb styling :934-939 |
| XP Tracker (`xp-tracker.js`, 464) | `.xp-bar` :165, whole panel rebuilt each render :312 | `wireDrag` :219-232, re-bound on every render | `cc-xp-tracker-pos` :18/:227 | collapse + close, both persisted (`LS_MIN`, `LS_CLOSED`) | ui-scale grip | 99980 :161 | 12px | none (ui-scale) |
| Lever Advisor (`lever-advisor.js`, 356) | `.hd` css :33, html :59 | :64-68, clamps right/bottom | `cc-lever-pos` :15/:67, not clamped on load :62 | collapse `–` only, NOT persisted :63; no close (hides with the game window) | ui-scale grip | 2147482000 :30 | 16px (theme: 14.5) | none |
| Goals (`goals.js`, 211) | `.hd` :25 | :60-64, only min 0 (can be lost off right/bottom) | `cc-goals-pos` :12/:63, clamped on load :58 | close x, open flag persisted :16/:66 | ui-scale grip | 2147481500 :23 | 14.5px | duplicated 5-line thumb CSS :29-33 |
| Drop Luck (`drop-luck.js`, 399) | `.hd` css :28 | :113-121 (copy of goals) | `cc-droplog-pos` :12 | close x, open persisted | ui-scale grip | 2147481500 :26 | 14.5px | duplicated :36-40 |
| Tree Advisor (`tree-advisor.js`, 472) | `.hd` :56 | :104-109 (copy) | `cc-treeadv-pos` via `LS` map :16 | close x | ui-scale grip + drawer + edge tab (z 1100, :85/:93) | 1100 :55 (only one that already matches), tip 1200 | 14px | thumb CSS in `.bd` :63 |
| Materials (`material-shortage.js`, 87) | `.hd` :22 | :34-48, first-run centred via `transform` | `cc-matshort-pos` :13 | collapse (class `min`, not persisted) :48; no close | ui-scale grip | 2147481000 :21 | 15px | none |
| ScapeLite menu (`scapelite-menu.js`, 102) | none (hover flyout) | no | no | hides on any mousemove outside :61-66 | no | 2147482500 :24 | 15px | n/a |
| Bug report (`bug-report.js`, 118) | `.hd` :24, no drag, centred modal | no | no | x, Escape :98 | ui-scale grip (listed in RESIZABLE) | 2147483100 :22 | 13px | none |
| Welcome tour (`welcome-tour.js`, 228) | `.w-head` :107 | no (modal) | n/a | Skip/Esc :200 | no | 100010 :104 | 14px | none |
| Settings UI (`plugins-settings-ui.js`, 794) | game's own window | n/a | n/a | n/a | n/a | author card 100003 :627 | 13px | :89 |
| Raid DPS extra (`raid-dps-extra.js`, 259) | injects into game panel | n/a | pref `cc-raiddps-graph` | n/a | n/a | tooltips z 5/6 inside game panel :39/:46 | game | n/a |
| Queue walk (`queue-walk.js`, 110) | injects into game panel | n/a | `cc-qwalk-hidden` | toggle button | n/a | 4/5/60/61 inside game panel | game | n/a |

### 1.1 Duplicated CSS and JS (counted)
- **Drag + position memory is copy-pasted 7 times** (route-advisor, xp-tracker, lever, goals, drop-luck, tree, matshort), each with different clamping: lever clamps both edges (lever :66), goals/drop/tree/matshort only `Math.max(0, ...)` (goals :62, tree :107), xp/route keep 80x30px visible. Restore clamping also differs (lever :62 and matshort :40 do not clamp, goals :58 / drop-luck / tree do). Result: a panel can be dragged or restored fully off screen on a smaller window.
- **Event shield** `['mousedown','click','contextmenu','wheel'].forEach(stopPropagation)` appears in route :1551, xp :232, goals :59, drop-luck :112, tree :105, scapelite-menu :40. Lever and bug-report shield keys instead (:69, :101). Goals, Drop Luck (search input) and Tree Advisor (input/textarea) do NOT stop `keydown`, so the game's hotkeys may fire while typing (verify in game; XP tracker does it only for its one input :353).
- **Thin scrollbar CSS** (`scrollbar-width:thin` + 4 `::-webkit-scrollbar*` rules) is in goals :29-33, drop-luck :36-40, route :934-939, tree :63, AND again globally in ui-scale :50-55. The ui-scale copy already covers all BOXES with `!important`, so the per-plugin copies (about 22 lines) are dead weight.
- **Header CSS** (flex, gap, padding 9px 12px, gradient, `cursor:grab`, `user-select:none`, accent title, x button) is duplicated in lever :33-35, goals :25-28, drop-luck :28-30, tree :56-58, matshort :22-24, xp :165, route :917-920. ui-scale then re-overrides background, border, title colour with `!important` (ui-scale :42-43) - i.e. every plugin's header CSS is partly written twice.
- **Tab bar** `.tabs button.on{background:#2a2518;color:#ffd24a;box-shadow:inset 0 -2px 0 #ffd24a}` in drop-luck :32-34, tree :59-60, ui-scale :60 (`.rt-seg.on`), xp `.xp-frames button.on` :172-ish (different look: `#2c2a18` border), raid-dps `.bar button.on`. Route uses a different underline tab style (`.rt-tab.on` :934+). Three tab looks.
- **Card** (`background:#161620;border-left:3px solid #44445a;border-radius:8px`) = goals `.g` :35, drop-luck `.row` :52, tree `.step` :67, route `.rt-plan` (ui-scale :61 re-skins to the same). Left-border colour semantics differ per panel (yellow=pinned, red/orange/yellow/green=luck tier, qst blue / tp purple).
- **Hero meter** drop-luck `.hero/.meter` :41-44; tree `.hero` :55; route `.rt-hero` :938+. Same recipe (gradient panel, big number), three implementations.
- **Table**: tree :64-67, lever `.whyb table` :49-52, raid-dps own. No shared class.
- **Tooltip**: tree `.cc-tadv-tip` (fixed, z 1200), route `.rt-vtip` (fixed, z 2147482400, 392px), raid-dps `.cc-rdps-tip`/`.cc-rdps-ptip` (absolute), xp `.xp-tip` :171-ish, settings-ui author card (inline cssText :627, z 100003), queue-walk `.cc-qw-tag`. Six tooltip systems, each with its own border alpha, background (`#17171f`, `#10101a`, `rgba(18,18,26,.96)`, `rgba(0,0,0,.85)`), shadow and font size. Positioning logic is separate each time (tree `moveTip`, route `vtOver`).
- **Context menu**: only ui-scale (`.cc-ctx` :78-86, :173-195). Route and others add nothing. Not reusable (no API).
- **Helpers copy-pasted**: `h(tag,cls,text)` in route :1071, xp :210, goals :68, drop-luck :141, tree :113, scapelite-menu (5 copies of a 1-line function); number formatter `fmtXp`/`num`/`fmt` with the identical `>=1e6 -> M, >=1e4 -> k` logic in route :1085, xp :153, goals :70, raid-dps :101; `on()`/`setting()` wrappers around `window.__ccPluginSettings.get` in 9 files (lever :16-17, goals :13, drop-luck :13, tree :13, matshort :14-15, raid-dps :11, queue-walk :12-14, menu :10, welcome :14, xp :21, route :468).
- **Duplicate style ids in the live page**: two `<style id="cc-panel-fuse-style">` (739 and 2365 chars) - one is stale or double-injected. 45 `<style id=cc-*>` tags total; `cc-theme-style` alone is 9572 chars.

### 1.2 Lines spent on UI boilerplate (approximate: CSS template + chrome JS)
| Plugin | CSS template lines | Chrome JS (header, drag, pos, close, min) | Total / file |
|---|---|---|---|
| route-advisor | ~165 (:904-1070) | ~70 (:1495-1550 + header render) | 235 / 1591 (15%) |
| drop-luck | ~85 (:25-107) | ~15 | 100 / 399 (25%) |
| tree-advisor | ~45 (:54-97) + drawer/tab | ~12 + ~35 drawer follow | 90 / 472 (19%) |
| xp-tracker | ~47 (:159-205) | ~22 + header 15 | 85 / 464 (18%) |
| lever-advisor | ~30 (:24-53) | ~12 | 42 / 356 (12%) |
| goals | ~31 (:22-52) | ~13 | 44 / 211 (21%) |
| material-shortage | ~14 | ~14 | 28 / 87 (32%) |
| scapelite-menu / bug-report / welcome | ~14 / ~22 / ~24 | few | n/a |
| ui-scale (shared) | 57 CSS lines (:33-89), 40% of its 220 lines is selector lists | | |
Total across the 7 draggable panels: roughly 600 lines, of which about 350 are structurally identical.

## 2. Design tokens: ui-scale.js vs what plugins hard-code

ui-scale defines only 10 tokens (`:root` :34): `--cc-bg #10101a`, `--cc-bg2 #161620`, `--cc-bg3 #1c1c28`, `--cc-border #2e2e42`, `--cc-hd` gradient, `--cc-text #dcdce8`, `--cc-dim #8f8fa4`, `--cc-accent #ffd24a`, `--cc-good #5fe06d`, `--cc-bad #ff8a5c`, `--cc-r 12px`, `--cc-shadow`, `--cc-font`. Missing: warn/info colours, border-strong, text-muted, spacing, font-size scale, z-index scale, motion, focus ring.

Who actually uses `var(--cc-...)`: only ui-scale itself. A grep of plugin CSS finds no `var(--cc-` in any panel. Hard-coded literal counts (hex / rgba): route 138/36, drop-luck 105/2, tree 77/11, settings-ui 74/7, welcome 47/5, xp 43/15, goals 33/1, raid-dps 29/13, lever 22/10, bug-report 21/4, queue-walk 14/2, matshort 8/5. About 610 hex literals total.

Same concept, different literals:
- Panel background: `#10101a` (goals, drop, tree, ui-scale), `#0f0f14` (route, bug), `rgba(14,14,22,.97)` (lever, matshort, menu), `linear-gradient(rgba(24,24,32,.96)...)` (xp), `#16161e` (welcome).
- Border: `rgba(255,255,255,.16)` route, `rgba(255,210,74,.5)` lever/menu (yellow), `rgba(255,140,0,.6)` matshort (orange), `#27402c` goals (green), `#3a3426` drop (brown), `#2e2e42` tree. Per-panel border tint is lost when theme is on because ui-scale forces `--cc-border` (:37), but remains when theme is off, so the "theme off" look is a different product.
- Accent yellow: `#ffd24a` appears hundreds of times; goals title uses green `#7fe88a` (:26), matshort orange `#ffa83a`; ui-scale forces yellow via !important (:43) except for matshort `.hd b` is in the list so orange is overridden.
- Header title colour: `#fff` (route/xp raw), `#ffd24a` (others).
- Radius: 6/7/8/9/10/12 px mixed; ui-scale forces 12px and 8px buttons via `!important`.
- Font size: base 12 (xp), 13 (route raw, bug, drawer), 14 (welcome, tree, route themed), 14.5 (lever, goals, drop, matshort, menu themed), 15 (matshort/menu raw), 16 (lever raw). Live measure: xp 12px, route 14px, others 14.5px / 14px. Section label size 11/11.5/12; sub text 12/12.5/13.
- Good / bad / warn: `#5fe06d`/`#6fe27a`/`#4ade80`/`#3fd98a` for green; `#ff8a5c`/`#ff8a7a`/`#ff5a4d`/`#ff4d4d` for red/orange; yellow `#ffd24a`/`#ffe27a`. 4 greens, 4 reds.
- Hover bg: `#262636`, `#1a1a26`, `#171720`, `rgba(255,255,255,.09)`, `.06`, `.1`.
- ui-scale overrides rely on `!important` in 12+ rules (:37-55, :57-72) to beat plugin CSS: the "theme" is a monkey patch over per-plugin styles, and each new panel must be added to `IDS` :16, `BOXES` :17, `RESIZABLE` :21, `HEAD` :27, `NAMES` :28 and to several `tsel([...])` lists of selectors :38-46. Adding a panel = edits in 6 places in a file that is not the panel's.
- Game tokens exist and are used by only one plugin: queue-walk reads `var(--bg-cell,#1c1c26)`, `--border-primary`, `--text-gold`, `--text-muted`, `--bg-hover` with fallbacks (:23-29). The kit should map `--cc-*` onto those where present so panels match whatever theme the game uses.

Z-index: declared values 99980..99985, 100003, 100010, 1100, 1200, 2147481000, 2147481500, 2147482000, 2147482400, 2147482500, 2147483100. Live check: all panels compute to `1100` (the `body.cc-themed #id{z-index:1100}` rule :35 wins), and `front()` :94-104 then assigns inline 1101..1890 on mousedown. So 8 panel z-index declarations are dead while theme is on, and only matter if theme is turned off. The menu gets 1950 (:36), but the live measure showed `#cc-slmenu` at inline 1106 because `front()` re-stacks it on any mousedown on it (:95 includes it), so the menu can fall below a later-clicked panel's z. Magic constants `1100/1890/2000` are only commented in :93.

Scale: live scales were 1.268 for most panels and 1.014 for Route Advisor (it has its own multiplier `cc-panel-mult` entry :162), so "one slider" produces inconsistent real sizes; fine by design but not discoverable.

## 3. Interaction inconsistencies

| Behaviour | Route | XP | Lever | Goals | Drop | Tree | Matshort | Bug | Menu |
|---|---|---|---|---|---|---|---|---|---|
| Draggable | yes | yes | yes | yes | yes | yes (+drawer follows) | yes | **no** | no |
| Resizable | own grip | grip | grip | grip | grip | grip | grip | grip | no |
| Resize grip visible | hover (theme :70) | hover | hover | hover | hover | hover | hover | hover | n/a |
| Right-click header menu (size presets) | yes | yes | yes | yes | yes | yes | yes | no | no |
| Position remembered | yes | yes | yes | yes | yes | yes | yes | n/a | n/a |
| Size remembered | yes (own key) | yes | yes | yes | yes | yes | yes | yes | n/a |
| Open state remembered | no (`userOpen`) | yes (`closed`) | follows game window | yes | yes | yes | auto | no | n/a |
| Collapse | no | yes, remembered | yes, **not** remembered | no | no | no | yes, **not** remembered | no | no |
| Close x | yes | yes | no | yes | yes | yes | no | yes | no |
| Escape closes | no | no | no | no | no | no | no | yes | no |
| Click brings to front | yes | yes | yes | yes | yes | yes | yes | n/a | yes (but see z issue) |
| Keyboard shield | no | one input | all keys | none | none | none | none | all keys | no |
| Tab remembered | n/a | frame/mode/metric (3 raw inline LS keys :342/:364/:369) | route per page | n/a | tab | mode/tree | n/a | n/a | n/a |

Other inconsistencies:
- Drag cursor `grab` set on header in 7 panels; no `grabbing` state except route :918.
- Close glyph `×` (goals, drop, tree, bug), `x`-class button with tiny padding (xp), `–` collapse in lever/matshort, `▾/▸` in xp. Tooltips ("Close", "Collapse") exist but wording differs (xp: "Close (open it again from the ScapeLite button in the left strip)").
- Panels double-click the grip to reset (ui-scale :127, route :1519) but nothing discloses this except the title attribute.
- Position keys use 12 different naming schemes (`cc-xp-tracker-pos`, `cc-droplog-pos`, `cc-treeadv-pos`, `cc-goals-pos`, `cc-lever-pos`, `cc-matshort-pos`, `cc-route-panel-pos`) and sizes `cc-size-<id>` (ui-scale) vs `cc-route-panel-size`. The Layout presets plugin (`layouts.js`) must know every key.
- Teardown: lever/goals/drop/tree remove their `mousemove/mouseup` listeners (tree :464) but xp/route rely on per-drag listeners (OK). ui-scale's contextmenu / keydown / blur listeners (:173-198) are NOT removed in `teardown()` :210-216 (leak on each re-inject; only `mousedown front` is removed).
- No ARIA roles/labels, no focus management, no tab order, no `Esc`; 5 files respect `prefers-reduced-motion` but not all animation (drop-luck shimmer yes, tab transitions no).
- Left-border colour on cards means different things per panel; no legend, and no colour-blind-safe alternative (red/green only, e.g. luck tiers red/orange/yellow/green).

## 4. Performance costs of the UI code

Timers running continuously (always, even with every panel closed unless noted):
| Timer | Interval | Does | Gated by hidden/open? |
|---|---|---|---|
| ui-scale tick | 400 ms (:208) | toggles body class, `ensureGrips()` (querySelector for 7 panels), reads game zoom with `getComputedStyle`, `apply()` on 13 ids, writes `window.__ccScale` | no |
| route-advisor loop | 800 ms (:1569) | `signature()` + `document.body.classList` checks; compute is debounced 350 ms | `document.hidden` only |
| lever-advisor | 600 ms (:346) | full `render()` incl. DOM reads of the lever window and optimise, early-outs when no `#tab-skillcustom` | hidden only |
| xp-tracker | 2000 ms (:445) | `sample()` + `render(true)`: rebuilds the entire panel (`el.textContent=''` :312, new canvases, event listeners, img elements) even when minimised/hidden; skips only when hovered or typing :294-295 | no (render before checking `closed`... it returns early at :293 only when closed) |
| xp-tracker save | 20 s (:55) | JSON persist of history to localStorage | no |
| raid-dps-extra | 1000 ms (:249) | `tick()` reads raid DOM | no open check visible |
| queue-walk | 1500 ms (:102) | `update()` | hidden only |
| scapelite-menu | 1500 ms setTimeout (:91) | `ensureButton()` | no |
| material-shortage | 3000 ms (:77) | `bridge().shortages()` + innerHTML rebuild | hidden only |
| tree-advisor | 4000 ms (:441), watcher 500 ms (:449), rAF follow loop (:444-445) | watcher does 3-6 `querySelector` + `getClientRects` every 500 ms always; **rAF loop runs every frame forever** (checks `if (open)` inside, but callback + `getBoundingClientRect` forced layout every frame while open) | watcher no; rAF no |
| goals | 6000 ms (:200) | render only if `open` | yes |
| drop-luck | 5000 ms (:388) | render only if `open` | yes |
| settings-ui | 5000 ms (:575) | `refreshAbout` | check |
| welcome-tour | 2 s retries, max 120 (:211) | stops | ok |
Sum: about 11 always-on timers (>= 30 timer wakeups per second at idle: 2.5 + 1.25 + 1.7 + 0.5 + 1 + 0.7 + 0.7 + 0.3 + 2 + 60 rAF while tree open).

Rebuild-everything render loops: xp-tracker every 2 s (:312), lever on state change keyed by `lastKey` (good, :281), goals 6 s `bd.textContent=''` :166, drop-luck 5 s :231, tree 4 s :245 (skips while hovering), matshort 3 s innerHTML (:69, no key check), route `render()` :1371 on every state change and drawer rebuild keyed by `sig` (good, :1428), scapelite-menu `fill()` on show. Live node counts show panels are small (<=21 nodes closed; tree 163), so the cost is modest per rebuild, but rebuilds destroy hover, focus, scroll position (goals/drop-luck do restore? not seen) and text selection, and re-attach listeners; xp-tracker re-binds `wireDrag` and 6 click handlers every 2 s.

Other costs: 45 `<style>` tags (about 85 KB CSS) re-parsed on any `body.cc-themed` toggle (a class on `body` makes every `body.cc-themed #...` selector restyle); the theme's `tsel(BOXES,' *')` universal descendant selectors (:50-54) apply to every descendant of 10 panels; `mousedown` capture handlers on `document` from ui-scale `front` (:104) plus panel-fuse etc. run on every click in the game.

## 5. Proposal: `window.__ccUI` (ScapeLite UI kit)

Goals: one injected core file (`overlay/ui-kit.js`, ~600-800 lines, zero dependencies), registered as a `core: true` plugin before ui-scale in `panel-resize-watcher.js` (:228 list style: `{ id:'ui-kit', core:true, ns:'__ccUI', build: () => readScript(UIKIT_PATH) }`). ui-scale shrinks to "scale + tick" and delegates theme/drag/resize to the kit. Plugins feature-detect: `const UI = window.__ccUI; if (!UI) return fallbackOldPath();` so the migration is incremental and third-party plugins (see `docs/PLUGIN-AUTHOR-GUIDE.md`) can use it too.

### 5.1 CSS token set (one `<style id="cc-ui-tokens">`, all `--cc-*`)
```css
:root{
 /* surfaces */ --cc-bg:#10101a; --cc-bg-2:#161620; --cc-bg-3:#1c1c28; --cc-bg-hover:#262636; --cc-scrim:rgba(0,0,0,.55);
 /* lines   */ --cc-border:#2e2e42; --cc-border-strong:#4a4a62;
 /* text    */ --cc-text:#dcdce8; --cc-text-dim:#8f8fa4; --cc-text-faint:#707086;
 /* intent  */ --cc-accent:#ffd24a; --cc-accent-ink:#241a00; --cc-accent-bg:#2a2518;
              --cc-good:#5fe06d; --cc-warn:#ffb84a; --cc-bad:#ff8a5c; --cc-info:#4aa8ff; --cc-magic:#b07cff;
 /* shape   */ --cc-r:12px; --cc-r-sm:8px; --cc-r-xs:5px; --cc-shadow:0 14px 40px rgba(0,0,0,.7);
 /* type    */ --cc-font:system-ui,-apple-system,'Segoe UI',sans-serif; --cc-fs:14px; --cc-fs-sm:12.5px; --cc-fs-xs:11.5px; --cc-fs-lg:16px; --cc-fs-hero:22px;
 /* space   */ --cc-gap:8px; --cc-pad:12px; --cc-row-pad:6px 10px; /* density scales these */
 /* layers  */ --cc-z-panel:1100; --cc-z-tip:1900; --cc-z-menu:1950; --cc-z-modal:2100;
 /* motion  */ --cc-ease:.15s ease; 
}
```
Mapping to game tokens: `--cc-bg: var(--bg-cell, #10101a)` etc. only when the user picks "match game" in settings.

### 5.2 Theming
- `html[data-cc-theme=dark|light|game]`, `data-cc-density=compact|cozy|roomy` (changes `--cc-gap/--cc-pad/--cc-row-pad` and `--cc-fs` +-1px), `data-cc-contrast=high`.
- Accent from a setting (`uiAccent` hex): kit derives `--cc-accent-bg` (mix 12% on bg) and `--cc-accent-ink` by luminance. Font size from a setting (`uiFontPx`, 11-18) sets `--cc-fs` and the derived steps.
- Colour-blind safe palette `data-cc-palette=cb`: good `#3fa7ff`-ish blue / bad `#ff9f1c` orange (Okabe-Ito: good `#009E73`/blue `#0072B2`, bad `#D55E00`, warn `#E69F00`, accent `#F0E442`), plus kit rule that meaning is never colour-only: `.cc-chip[data-tone]` renders a tone glyph (`▲ ▼ ● !`) and the hero meter shows a text verdict.
- `prefers-reduced-motion` handled once at kit level (`--cc-ease:0s`).
- Light theme optional: ~20 token overrides; panels need no per-plugin CSS because they only use tokens.

### 5.3 Components and API sketch
```js
// overlay/ui-kit.js  (sketch)
(() => {
  const NS = '__ccUI'; try { window[NS] && window[NS].teardown(); } catch (e) {}
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem('cc-ui:' + k)); return v ?? d; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem('cc-ui:' + k, JSON.stringify(v)); } catch (e) {} } };
  // one persisted blob per panel: { x, y, w, h, open, min, mult, tab }
  const h = (tag, cls, text, attrs) => { /* DOM builder, one copy */ };

  /** Panel: header (icon, title, actions), drag, resize, drawer, min, close, z-order, scale, position memory, Esc, key shield. */
  function panel(o) { // {id,title,icon,width,height,pos:'next'|{x,y},resizable,closable,collapsible,drawer:{side,width},accent,onOpen,onClose,keyShield}
    const el = h('div', 'cc-panel'); el.id = o.id;
    el.append(head(o), body = h('div', 'cc-bd'));
    const st = store.get('panel:' + o.id, {});          // pos/size/open/min/mult in ONE place
    restore(el, st, o); wireDrag(el, head, st); if (o.resizable) wireResize(el, st);
    layer.register(el);                                 // z-order, scale, right-click size menu - no per-plugin lists
    return { el, body, setOpen, toggle, setTitle, setBadge, addAction, drawer, destroy };
  }
  function tabs(items, { value, onChange, style = 'segment' | 'underline' }) {}
  function card({ tone, title, sub, right, bar, onClick }) {}      // tone -> left border
  function hero({ value, sub, meter: { pos, stops }, stats }) {}   // drop-luck hero/meter, tree hero, route hero
  function table({ cols, rows, sort, dense }) {}
  function tip(anchorOrPoint, content, { delay, interactive }) {}  // one fixed-position tooltip, auto-flip, scale-aware
  function chips(items, { multi, value, onChange }) {}             // segmented control / filter chips
  const form = { select, input, number, toggle, button, search };
  function toast(msg, { tone, ms }) {}
  function menu(items, { x, y }) {}                                // replaces ui-scale's .cc-ctx
  function mount(host, view) {}                                    // keyed reconciler, see below
  window[NS] = { version: 1, tokens, theme, panel, tabs, card, hero, table, tip, chips, form, toast, menu, mount, store, h, fmt, teardown };
})();
```
Consumer example (Goals reduced from ~44 boilerplate lines to ~6):
```js
const UI = window.__ccUI;
const p = UI.panel({ id: 'goals', title: 'Goals', width: 420, height: 'min(560px,74vh)', resizable: true, closable: true });
const { body } = p;
UI.mount(body, () => goals.map((g) => UI.card({ tone: g.pin ? 'accent' : null, title: g.name, sub: g.sub, right: g.eta, bar: g.pct })));
```
- `mount(host, viewFn, {key})`: calls `viewFn()` on each tick, diffs by key + text (or compares a cheap signature), patches changed nodes only, preserves scroll, focus, hover and open `<details>`. Replaces the 6 `textContent=''` full rebuilds.
- Layer manager: `panel()` registers; z-order via a single counter in the token band; `scale` applied by the kit (absorbs `apply()` from ui-scale :157-168); right-click header menu (size presets, reset, "snap to corner", "pin") generated from panel options, so no `HEAD`/`NAMES`/`RESIZABLE` tables.
- Persistence: one key `cc-ui:panel:<id>` (+ one global `cc-ui:prefs`), JSON `{x,y,w,h,open,min,mult,tab}`. Export/import hooks so `layouts.js` reads one namespace; migration shim reads the legacy keys once (`cc-goals-pos`, `cc-size-<id>`, `cc-panel-mult`, ...) and writes the new one.
- Clamp once: keep >= 80x30 px visible after drag and on restore and on `resize` event.
- Keyboard: `Esc` closes the topmost closable panel, focus ring from tokens, `role=dialog`/`aria-label`, tabs `role=tablist`, buttons real `<button>`; key shield on by default for panels containing inputs.
- Timers: kit exposes `UI.every(ms, fn, {whenOpen:p, whenVisible:true})` that gates on `document.hidden` and panel open state and uses ONE shared 250 ms scheduler.

### 5.4 Migration plan (value / risk, effort)
| # | Step | Value | Risk | Effort |
|---|---|---|---|---|
| 1 | Quick wins from section 6 (no kit needed) | high | very low | 0.5 day |
| 2 | Write `ui-kit.js` with tokens + `h`, `fmt`, `store`, `settings()`, `every()`; register as core before ui-scale; ui-scale keeps its CSS but reads tokens from the kit | med | low | 0.5 day |
| 3 | `UI.panel()` (drag, restore, clamp, z-order, close, collapse persisted, grip, scale) - port **Materials** (87 lines) and **Goals** as pilots; delete per-panel copies | high | low-med | 1.5 days |
| 4 | Port Lever, Drop Luck, Tree (drawer/tab into `panel({drawer})`) | high | med (tree drawer follow logic) | 1.5 days |
| 5 | `tabs/card/hero/table/chips` components; replace the 3 tab looks and 3 card looks; delete ui-scale `!important` overrides :37-72 as plugins adopt tokens | high | med (visual regression) | 2 days |
| 6 | `tip()` unify tree/route/xp/raid tooltips | med | med | 1 day |
| 7 | `mount()` keyed rendering; remove rebuild loops in xp-tracker, goals, drop-luck, matshort | med (perf, UX) | med | 1.5 days |
| 8 | Route Advisor: move header/tabs/grip/drawer to the kit, keep map drawer logic | med | high (1591 lines, drawer geometry, `placeExtras`) | 2-3 days |
| 9 | Theming UI: accent/density/font-size/colour-blind settings, optional light theme; settings page entries | med | low | 1 day |
| 10 | Docs for plugin authors (PLUGIN-AUTHOR-GUIDE), deprecate `__ccNextPos`, remove legacy key migration after 2 releases | low | low | 0.5 day |
Total about 12-14 days of focused work; steps 1-5 (about 6 days) remove roughly 350 duplicated lines and the cross-file registries in ui-scale.

Rules for the migration: one panel per commit; keep the legacy path behind `if (!window.__ccUI)`; screenshot each panel in all themes before/after via the debug port (read-only).

## 6. Quick wins (no rewrite)
1. Delete the dead per-plugin `z-index` values and the duplicate scrollbar CSS (goals :29-33, drop-luck :36-40, tree :63) - ui-scale already covers them; define a z-index scale in ui-scale instead of 14 magic numbers.
2. Fix duplicate `<style id="cc-panel-fuse-style">` (two tags live in the page).
3. Add `keydown/keyup/keypress` stopPropagation to goals, drop-luck, tree (typing in search/input leaks hotkeys to the game; lever and bug-report already do it, lever :69).
4. Clamp on restore and drag in lever (:62), matshort (:40), goals (:58, :62), drop-luck, tree (:107) to keep >= 80x30 px on screen; use one clamp fn exported from ui-scale (`window.__ccClamp`).
5. Persist collapse state for lever (:63) and matshort (:48); add Esc-to-close for all closable panels (single document listener in ui-scale).
6. Make Route Advisor grip divide by `window.__ccScale` like ui-scale does (route :1507-1508 vs ui-scale :136-137), otherwise the grip does not track the cursor at scale != 1.
7. ui-scale `teardown()` :210-216: also remove the `contextmenu`, `mousedown`(ctx), `keydown` and `blur` listeners and the capture `mousemove/mouseup` pair (:134-145) - they leak on each re-inject.
8. Perf: gate always-on timers: tree watcher 500 ms, rAF follow (:444) -> run only while `open`; xp-tracker: skip `render()` while minimised/closed/`document.hidden` and do not re-bind `wireDrag` each render; raid-dps and menu `ensureButton` back off when idle; merge ui-scale 400 ms tick with a `ResizeObserver` on `#ui-container` plus `visualchange`, or slow it to 1000 ms while nothing changed.
9. Add `if (key === lastKey) return;` signature checks to material-shortage render (:54) and goals/drop-luck (render only when `bridge().dropState` version changed).
10. Unify helpers into ui-scale as `window.__ccH`, `__ccFmt`, `__ccSetting` (one line each) and delete 5 `h()` and 4 number formatters.
11. Move the last literals to `var(--cc-...)` in the hottest places (accent `#ffd24a`, good/bad, card bg `#161620`) - sed-able, 0 behaviour change, makes theme/accent a one-file change.
12. Unify base font (14.5px) and title size (15.5px) in ui-scale for XP Tracker (12px) and Route (14px) or make it a setting; add `aria-label` on x/collapse buttons and `title` wording consistent ("Close", "Collapse", "Expand").
13. Make Bug Report draggable (it is the only closable panel that is not) or leave centred modal but add a scrim; add Escape to Welcome/Bug only if not already (bug has it).
14. Replace the three tab looks by the drop-luck/tree style (`.tabs button.on`) in xp-tracker frames and raid-dps bars.

## Evidence notes
- Live measure (read-only, port 9222): all panel z-index computed 1100; scale 1.268 (route 1.014); theme class present; 45 cc style tags; node counts: tree 163, menu 21, lever 12, drop 6, goals 5, matshort 5, xp 1.
- Not verified: whether goals/drop-luck keydown leakage actually triggers game hotkeys (needs in-game test; no clicks done).
