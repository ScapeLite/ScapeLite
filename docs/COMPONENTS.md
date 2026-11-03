# COMPONENTS: DOM, classes and the JS helpers (the CSS itself now lives in overlay/ui-kit.js)

`COMPONENTS.css` in this folder is the library. It **extends** the kit's own style block in `overlay/ui-kit.js` (same class names `.cc-panel .cc-chip .cc-card .cc-pill .cc-tile .cc-prog .cc-spin .cc-skel .cc-empty .cc-scroll .cc-tabbadge`, redefines the ones that change) and adds new ones. To use it: put the file's text into the kit's `<style>` string **after** the existing rules (or load it as a second `<style id="cc-ui-components">` in `ui-kit.js`). Nothing in it uses `cc-q-*`. Before landing, grep `overlay/*.js` for each new class name; known neighbours that exist today and were avoided: `cc-bar*`, `cc-menu-btn`, `cc-alertbell`, `cc-alert-ring`, `cc-alert-tag`, `cc-layout`, `cc-ed-*`, `cc-lock-btn`, `cc-gh`, `cc-ps-handle`.

Conventions: tone = `data-tone` attribute; selected/pressed = `aria-pressed` / `aria-selected` / `aria-checked`; helper classes `.on` and `.is-*` only for chips and highlights; icons are `<img class="cc-ico" ...>` (30 px game icon, pixelated) or an emoji in `<span class="cc-ico">` while no icon exists.

The CSS source uses `Nu` shorthand internally; the delivered file has it expanded to `calc(N * var(--u))`, so it is plain CSS.

## 1. Tokens and utilities
- New tokens: `--u`, `--cc-sunk`, `--cc-scrim`, `--cc-sp-1..8`, `--cc-sh-1`, `--cc-sh-pop`, `--cc-dur-1/2`, `--cc-ease-out`, `--cc-bar-h`, `--cc-z-*`, `--cc-fs-2xs/lg/xl/hero`. Changed: `--cc-text-faint` -> `#7c7c93`.
- `[data-tone]` sets `--t`, `--t-a`, `--t-b` (tones: good warn bad info magic accent kill dim).
- `.cc-s` = scaled root (needs `--s`). `[data-bp]` on it: `full|compact|micro`. Utilities: `.cc-hide-c`, `.cc-hide-m`, `.cc-only-m`, `.cc-hide`, `.cc-num-t` (tabular), `.cc-ell` (ellipsis).

## 2. Shell (the kit's `UI.panel()` already makes this DOM)
```html
<div class="cc-panel show cc-s" data-bp="full" style="--s:1">          <!-- add data-mode="hover" for a hover card; .min = chip; .docked = square bottom -->
  <div class="hd"><b>Title<span class="cc-hsub">one line summary</span></b><span class="cc-hval">value</span>
     <button class="cc-ib" title="Settings">⚙</button><button class="min">–</button><button class="x">×</button></div>
  <div class="bd cc-scroll"> ... body ... </div>
  <div class="ft"><span>left</span><span class="cc-hint">hint</span></div>   <!-- optional -->
  <i class="cc-grip"></i>                                                      <!-- omit in hover mode -->
  <!-- optional tab-docked badge sitting on the top edge: -->
  <button class="cc-tabbadge" data-tone="accent" style="position:absolute;left:50%;top:0;transform:translate(-50%,-100%)">⚡ +1.8% possible</button>
</div>
```
Changes against the kit: title colour, flat header, `overflow: visible` (header/body/footer round their own corners), `.bd>*{flex-shrink:0}` so fixed rows never overlap, `.docked`, `data-mode=hover`, `.cc-hsub`, `.cc-hval`, `.cc-ib` (24 px icon button, `aria-pressed` = accent), `.ft`.

## 3. Controls
```html
<button class="cc-chip">Global</button>  <button class="cc-chip on" aria-pressed="true">Nearby</button>
<button class="cc-chip" data-tone="good">Friends<span class="n">3</span></button>  <button class="cc-chip off">Game</button>  <!-- off = dashed -->
<div class="cc-chips"> ...chips... </div>                                   <!-- wrapping row, gap 6 -->

<div class="cc-tabs" role="tablist"><button class="cc-tab" role="tab" aria-selected="true">Overview</button><button class="cc-tab" role="tab">Luck<span class="n">12</span></button></div>

<div class="cc-seg"><button aria-pressed="true">On foot</button><button>Efficient</button></div>

<span class="cc-pill" style="--w:95,224,109">🚶 2 min<small>2,393 steps</small></span>      <!-- walk scale via --w (rgb) -->
<span class="cc-pill" data-tone="accent|good|warn|bad|magic|info|dim">Best +1.8%</span>   <span class="cc-pill solid" data-tone="good">Done</span>
<span class="cc-badge">3</span>  <span class="cc-badge dot"></span>  <span class="cc-tierchip" data-tone="kill">L40</span>
<button class="cc-tabbadge" data-tone="accent|dim">…</button>                           <!-- default green = optimal; spinner: <i class="cc-spin"></i> -->
```

## 4. Tile, row, cell, progress
```html
<span class="cc-tile [sm|lg]" data-k="skill|kill|empty" data-p="xp|adv"><span class="cc-ico">⛏</span><b class="cc-tier">T5</b></span>

<!-- card row: fixed 44 px (min-height var(--cc-row-h)); data-tone = lane colour; data-edge = special border; .flat = no lane; .hov = hover look on a non-button -->
<div class="cc-row" data-tone="good" [data-edge] [role="button"] [aria-disabled="true"]>
  <span class="lf"><!-- optional tile or number --></span>
  <span class="ti">Mithril Bar<i>×176</i></span>
  <span class="su">Smithing · Dustclaw Foundry</span>
  <span class="mt"><b>27 min</b><span>5,705 XP</span></span>
  <span class="pr"><span class="cc-prog thin" style="--p:40%"><i></i></span></span>       <!-- optional bar, full width under the text -->
</div>
<div class="cc-list"> rows </div>                                           <!-- vertical, gap 6 -->
<!-- states: .is-hl (advisor), .locked (dashed, dim) -->

<div class="cc-grid" style="--cols:5;--cc-cell-h:54px">
  <div class="cc-cell [empty|sil|dim]" [data-up] [data-tone]>
    <span class="cc-tierchip">T2</span><span class="q">48</span>            <!-- optional corner items -->
    <span class="cc-ico">⛏</span><span class="lv">51</span>
    <span class="cc-prog" data-tone="info" style="--p:40%;--q:12%"><i></i><u></u></span>   <!-- <u> = queued XP segment, starts at --p, width --q -->
  </div>
</div>

<span class="cc-prog [thin|thick]" data-tone="good|warn|bad|info|accent" style="--p:62%"><i></i></span>
```
Skill cell bar tone by progress: `>= .85 good, >= .5 info, >= .25 warn, else bad`. Update progress by setting `--p` only.

### Task queue: NEW TASKS bar and roll odds (`overlay/ui-queue.js`)
`.cc-q-insert` is the gold bar between two cards (a 4 px accent line with a `NEW TASKS` pill; rows below it get `.is-held`, dimmed). Its position is the game's `queueInsertAt` (bridge `queueInsert()`: `{movable, at, min}`); the queue only moves it by replaying your drag on the game's own `.uq-insert` bar (`moveInsert`), so the game applies its rules and sends the change. Switch: `uiQueueInsertBar`.
`.cc-q-odds` (footer) opens the `.cc-q-oc` cards in `#cc-q-odds`: card 1 lists skills (or the slayer master's mobs on the Slay lane), card 2 the tiers of the hovered skill / detail of the hovered mob. Rows are `.cc-q-or` (icon or tier badge, name, `.bar`, `.p`); percentages go through `pctRound` so they total exactly 100, estimates are prefixed `~`. Data: bridge `oddsSkills()`, `oddsTiers(skill)`, `oddsSlay()`. Switch: `uiQueueOdds`.

### Task queue: outline language and category markers (queue-only, `overlay/ui-queue.js`)
One outline language, so the state of a card reads before its text does: every card has a 2 px frame and every tile a 3 px lane outline (`--k`: green skilling, red combat).
Frame colour: grey = normal (white on hover), lane colour = the current task, gold = lucky, blue = quest step, purple = XP-boost drop (`data-e`, via `--ec`); a DASHED gold outline is the Route Advisor's pick (`.is-adv`) and nothing else uses a dashed line. In the options tray the same states are outlines around the tile: white hover, solid gold + a check = chosen, dashed gold + a star = advisor pick, a bolt badge = fastest XP.
```html
<span class="cc-tile cc-q-tile" data-k="skill" data-e="lucky" data-m="bad">      <!-- data-m = material shortage bad|warn|save: a triangle (or round "i") on the upper right -->
  <img class="cc-ico" src="/assets/icons/skills/mine.png" alt="">
  <span class="cc-q-mk"><img src="/assets/icons/ui/quest.png"><img src="/assets/icons/skills/luck.png"></span>   <!-- category icons, lower right, at most two, strongest last (on top) -->
</span>
```
Category markers use the game's own pictures so they are recognised from the game's queue: clover (`skills/luck.png`) lucky, parchment (`ui/quest.png`) quest step, blue book (`ui/diary.png`) diary step, a purple rounded square with a triangle (`.cc-q-mkb`) XP-boost drop, and the teleport crystal (`items/stable_crystal.png`, option tiles only: the walking pill already says "Teleport" between cards). Order of strength: lucky, quest, diary, boost, teleport. Diary and teleport are read from the game's own queue rows (`.icon-scroll-indicator`), the rest from the game data bridge. Secondary text uses `--q-dim` (text-dim lifted toward text), which keeps 4.5:1 on tinted cards in every palette.

## 5. Body patterns
```html
<div class="cc-sec">Closest to the next step<span class="n">6</span></div>
<div class="cc-stats"><div class="cc-stat [hero]" data-tone="good"><b>+24.8k</b><span>xp / hr</span></div> ... </div>
<dl class="cc-kv"><dt>Speed</dt><dd>2.1s</dd><dt>Max hit</dt><dd data-tone="good">46</dd></dl>
<table class="cc-table"><thead><tr><th>Effect</th><th class="num">Change</th></tr></thead>
  <tbody><tr><td>Crit</td><td class="num pos" data-tone="good">4</td></tr></tbody></table>   <!-- .pos/.neg prepend + or − (value without sign) -->
<div class="cc-callout" data-tone="good|warn|bad|accent|magic"><span><b>Optimal.</b> text</span></div>   <!-- default tone info; .big = headline callout: <b> title + <span> sub -->
<div class="cc-graph"><svg viewBox="0 0 320 120">…use classes gl, ax, ln, ar…</svg></div>   <svg class="cc-spark"><path d="…"/></svg>
```

## 6. Overlays
```html
<div class="cc-menu" role="menu" style="left:Xpx;top:Ypx">                      <!-- position:fixed; place with ccPlace() -->
  <div class="cc-mh">Heading</div>
  <div class="cc-mi" role="menuitem" aria-checked="true|false|mixed"><span class="ck"></span><span>Label</span><span class="hint">Ctrl L</span></div>
  <div class="cc-mi" role="menuitem"><span class="ck"></span><span>Alerts</span><span class="cc-badge" data-tone="accent">3</span></div>
  <div class="cc-mi sub" role="menuitem"><span class="ck"></span><span>Filter</span><span></span>
     <div class="cc-menu"> ...submenu (hover opens it; .flip puts it left)... </div></div>
  <div class="cc-mi danger" role="menuitem">…</div>   <div class="cc-mi" aria-disabled="true">…</div>
  <div class="cc-msep"></div>
  <div class="cc-mslider"><span>Opacity</span><b>85%</b><input class="cc-range" type="range"></div>
  <div class="cc-align"><button aria-pressed="true">·</button> ×9 </div>         <!-- 3x3 align grid -->
</div>
<div class="cc-pop" style="left:..;top:.."><b>Title</b><em>sub</em><dl class="cc-kv">…</dl></div>
<div class="cc-tip" id="cc-tip"><b>Title</b>text<dl class="cc-kv">…</dl></div>   <!-- one shared element, position:fixed, .on shows it -->
<div class="cc-toast" data-tone="info|good|warn|bad|accent" style="right:16px;bottom:48px"><span><b>Bold</b> text</span><button class="cc-btn sm">Action</button><button class="cc-ib">×</button></div>
<div class="cc-tray is-on" style="left:..;top:..">tiles…</div>
```
Menu items are `div role=menuitem` (a submenu cannot live in a `button`). Clicking an item with `aria-checked` toggles it in your handler (set the attribute).

## 7. Inputs and settings
```html
<button class="cc-btn" [data-v="primary|quiet|danger"] [class="sm|go"]>Label</button>
<input class="cc-in" placeholder="…"> <input class="cc-in" aria-invalid="true"> <select class="cc-sel">…</select> <input class="cc-num" type="number">
<input class="cc-sw" type="checkbox"> <input class="cc-range" type="range" style="--fill:60%">   <!-- set --fill = (value-min)/(max-min)*100% on input -->
<label class="cc-field">Label<input class="cc-in"><span class="err">Message</span></label>

<div class="cc-sec">Chat</div>
<div class="cc-set"><b>Show seconds</b><span>Hint text.</span><div class="ctl"><input class="cc-sw" type="checkbox"></div></div>
<div class="cc-set" data-wide><b>Highlight words</b><span>hint</span><div class="ctl"><input class="cc-in"></div></div>      <!-- wide: control below -->
<div class="cc-btnrow"><button class="cc-btn" data-v="primary">Apply</button><button class="cc-btn" data-v="quiet">Reset</button></div>

<!-- settings sheet inside a panel (panel needs position:relative; the kit panel is) -->
<div class="cc-sheet"><div class="hd"><button class="cc-ib">‹</button>Chat settings</div><div class="bd cc-scroll"> …cc-sec + cc-set rows… </div></div>
```

## 8. Info bar, alerts, chat, chrome
```html
<div class="cc-s cc-ibar [bottom]" data-h="s|m|l" data-th="1100,700">                  <!-- data-h = 28 / 34 / 42 px -->
  <div class="cc-z l">…modules…</div><div class="cc-z m">…</div><div class="cc-z r">…</div>   <!-- left / middle / right; l and r share space equally -->
  <span class="cc-mod [btn|pillbtn|hov|active|attn|dim|hl|drop|fixed]" [data-tone]>
     <span class="cc-ico">…</span><span class="tx [cc-hide-c]"><i>Raid</i>Battlefrost Smithy</span>
     <span class="ln"><i style="--p:54%"></i></span>                                      <!-- thin progress line -->
     <button class="cc-tabbadge" …>⚡ ~15m</button>                                     <!-- tab docked on top of a panel button -->
  </span>
  <span class="cc-vsep"></span>  <span class="cc-spacer"></span>
</div>

<span class="cc-bell [quiet]">🔔<span class="cc-badge">3</span></span>
<div class="cc-menu cc-alist"><div class="cc-mh">Alerts<button class="cc-btn sm" data-v="quiet">Clear all</button></div>
  <div class="cc-alert" data-tone="good|accent|warn"><span class="cc-tile sm">…</span><span class="ti">Title</span><span class="cc-badge" data-tone="accent">×3</span>
     <span class="su">Sub text</span><button class="cc-btn go sm">Ridgetop Mine ›</button><button class="x" title="Dismiss">×</button></div></div>
<div class="cc-ring" style="left:..;top:..;width:..;height:.."></div><div class="cc-ringtag" style="left:..;top:..">Quest ready → Ridgetop Mine</div>

<div class="cc-msgs"><div class="cc-msg" [data-hl]><span class="t">19:41</span>
   <span><span class="tag" data-tone="magic">[Clan]</span><span class="who">Wulf</span>: text<span class="x3">×3</span></span></div></div>
<button class="cc-btn go cc-newjump sm">3 new ↓</button>
<div class="cc-composer"><button class="cc-chip" data-tone="magic">[Clan]</button><input class="cc-in"><span class="cnt [over]">34</span></div>

<div class="cc-scrim"></div><div class="cc-modal"><h3>Title</h3><p>text</p><div class="ft"><span class="cc-dots"><i class="on"></i><i></i></span><button class="cc-btn" data-v="quiet">Skip</button><button class="cc-btn" data-v="primary">Next</button></div></div>
<div class="cc-guide v" style="left:225px"></div>  <div class="cc-guide h" style="top:120px"></div>
<div class="cc-frame [sel]" style="left:..;top:..;width:..;height:.."><b>Task queue</b></div>
<div class="cc-lbar"><select class="cc-sel">…</select><button class="cc-btn sm">Tidy</button><span class="sp"></span><button class="cc-btn sm" data-v="primary">Done</button></div>
<div class="cc-ghost cc-row">…clone…</div>   .cc-dragging (source row)   <div class="cc-ins" style="top:..;left:..;width:.."></div>
```

## 9. JS helpers (about 60 lines; put them on `window.__ccUI`)

```js
// 1. Scale and width class. Call for every .cc-s root; one shared ResizeObserver is enough.
function ccScale(el) {
  const w = el.getBoundingClientRect().width, th = el.dataset.th && el.dataset.th.split(',').map(Number); // bars: data-th="1100,700"
  let bp, s = 1;
  if (th) bp = w >= th[0] ? 'full' : w >= th[1] ? 'compact' : 'micro';
  else { bp = w >= 340 ? 'full' : w >= 180 ? 'compact' : 'micro';
         s = bp === 'full' ? Math.min(1.5, Math.max(0.9, w / 450)) : bp === 'compact' ? Math.min(1.1, Math.max(0.9, w / 300)) : 1; }
  el.style.setProperty('--s', s.toFixed(3));
  if (el.dataset.bp !== bp) el.dataset.bp = bp;
}
const ccRO = new ResizeObserver((es) => es.forEach((e) => ccScale(e.target)));
function ccWatch(el) { el.classList.add('cc-s'); ccRO.observe(el); }

// 2. Menu positioning: fixed menu at the pointer or under/over an anchor, kept on screen; submenus flip left when they would leave the screen.
function ccPlace(menu, x, y) {
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  menu.querySelectorAll('.cc-mi.sub').forEach((mi) => mi.addEventListener('mouseenter', () => {
    const sm = mi.querySelector(':scope>.cc-menu'); if (!sm) return;
    sm.classList.remove('flip'); const r = sm.getBoundingClientRect();
    if (r.right > innerWidth - 4) sm.classList.add('flip');
    if (r.bottom > innerHeight - 4) sm.style.top = -(r.bottom - innerHeight + 8) + 'px';
  }));
}
// close on outside mousedown / Escape / game click, one menu at a time: remove the element.

// 3. Tooltip that follows the pointer (one shared .cc-tip, as the queue's). Content comes from the hovered element's data-tip or a callback.
function ccTip(root, content) {            // content(el) -> DOM node or null
  const tip = document.querySelector('.cc-tip') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'cc-tip' }));
  root.addEventListener('mousemove', (e) => {
    const t = e.target.closest('[data-tip]'); if (!t) return tip.classList.remove('on');
    if (tip.__for !== t) { tip.replaceChildren(content(t)); tip.__for = t; }   // never innerHTML with game text
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = (e.clientX + 16 + w > innerWidth - 8 ? e.clientX - w - 16 : e.clientX + 16) + 'px';
    tip.style.top = (e.clientY + 16 + h > innerHeight - 8 ? e.clientY - h - 16 : e.clientY + 16) + 'px';
    tip.classList.add('on');
  });
  root.addEventListener('mouseleave', () => { tip.classList.remove('on'); tip.__for = null; });
}

// 4. Range fill: <input class="cc-range"> needs --fill
function ccRange(r) { const f = () => r.style.setProperty('--fill', ((r.value - r.min) / ((r.max || 100) - (r.min || 0)) * 100) + '%'); r.addEventListener('input', f); f(); }
```

### Rules for the 1 s refresh
- Build a surface once; keep references to the nodes that change (`time`, `--p`, counts). Update with `if (node.textContent !== v) node.textContent = v;` and `style.setProperty('--p', ...)`.
- Rebuild a row only when its data key changes (id + selected option + position). Replace the single row node, not the list.
- Never touch a tray, popover, menu or tooltip while it is open, and never replace the element under the pointer.
- Collections that change length (alerts, friends, messages) are patched by key: append, remove, reorder the nodes.

## 10. Size and density knobs
- Row height: `--cc-row-h` (default 44px). Cell height: `--cc-cell-h` (54px). Grid columns: `--cols`. Grid gap: `--cc-gap-grid`.
- Bar height: `data-h` s/m/l or `--cc-bar-h`.
- Density: the kit's `html[data-cc-density]` changes `--cc-gap`, `--cc-pad`, `--cc-fs`; components that use gaps read them.
