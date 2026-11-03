<!-- DRAFT for the 0.4.0 GitHub Release. Not published: the release is on hold until the developers' answer. Remove this line when it goes out. -->
ScapeLite v0.4.0: optional plugins for Scapewatch (Steam, Windows). Big additions since 0.3.0: Info Bars and looks, a redesigned task queue, pinned cards, a Lever Advisor, Discord tools for clans, chat commands, and a self-healing background service.

**Install:** download `ScapeLite Setup 0.4.0.exe` below and run it. Windows may show an "unknown publisher" warning because the installer is not code-signed yet: choose **More info**, then **Run anyway**. The installer packs only product files; your settings, webhooks and member lists are created on your PC on first run and never come from the installer.

### What ScapeLite does and does not do
- It never plays for you: no timer or background job picks tasks, rolls, equips, trades, claims or sends anything in the game on its own.
- Some controls in ScapeLite's own windows pass **your** click on to the game's own button, one click for one click: opening a window, picking a task option or a loadout, reroll, roll settings, sending a chat line, friend add, bank placeholders. Nothing happens unless you click.
- One automatic action: fused panels open and close together, which only changes which panels are visible.
- ScapeLite is community made and is not affiliated with or endorsed by the Scapewatch developers. Every click pass-through in the code is listed by `npm run lint:forwards`.

### Looks and first run
- Three looks: **Full Vanilla** (the game as it is), **Combination** (the Info Bar next to the game's panels) and **ScapeLite only**. The welcome tour starts by offering them and adapts to your choice; changeable later, with Undo.
- The status light is never hidden and the game's side bar always stays.
- The release ships hollow config templates: no webhook, no member list, no filters, every Discord feature off.

### Info Bars, cards and panels
- Info Bars (top and bottom) with modules: current task (with the slayer fight), XP per hour, gold, a real HP bar, Offline hours, World, Players online, Window buttons, and an Alerts bell with new alerts for free quest slots, unspent barter charges and "Thanks for playing" rewards.
- Pinned cards for Skills, Inventory, Equipment, Friends, Diary, Quests and Barter, with the game's own buttons on them (Barter has Reroll, Buy, Sell and Charm). Item tiers show on Barter, Inventory and Equipment. All cards now refresh through one shared layer, so a button on a card updates it at once.
- Panel hotkeys reach ScapeLite's panels; one stacking order for panels and the game's windows; game pop-up menus open above ScapeLite panels and can be closed; right-click a panel button to open the game's original panel beside ScapeLite's card.
- Panel size chips now show the real on-screen scale (100% = the game's base size). Walking bar can be folded, Align puts panels flush, stray text selections clear themselves.
- Layout Editor, shared themes and palettes, Eco mode, a status light that counts the real frame rate, and a single-instance guard.

### Task queue and routes
- Redesigned Task Queue panel: walking-time pills, drag to reorder, roll controls, queued dividers, Roll odds, right-click menus on fights, game icons on every slay card and a fight progress bar.
- Hover a queue card or alternative to preview its route on the World Map.
- Route Advisor is a side drawer with a slim tab and no longer opens over the World Map by itself.
- Lever Advisor: pick your slayer master, an "Easy kills for combat levels" route, focus on one or two mobs, and a "Worth of the advice" table showing the gain of each suggestion.
- Lucky tasks show their Luck XP progress in the tooltip, for skilling and slay tasks; lamps and gems show an XP preview per skill.

### Chat
- Clickable web links (http and https only), the game's world tag, Tab cycles the send channel, the rules dialog, 19 message-type filters, a language picker, and right-click on a name opens the game's player menu.
- An **SL** button next to Global, Nearby, Raid, Friends, Clan and Game shows or hides ScapeLite's own lines.
- **Chat commands:** type `/sl help`. Commands for version, status, refresh, plugin on/off, relay status, digest preview and a clan rank check. Replies are only visible to you; nothing is posted to Discord.

### Discord (all opt-in)
- One shared sender for every feature: rate limits obeyed, nothing lost when Discord says no, and a health card on the dashboard with a Test send button.
- A **Clan Status Board**: one live card per member in a channel you choose, with only the fields you switch on.
- The relay turns every chat line into one typed event, so a drop the game announces in up to three lines is one post. Luck XP is gone from relay lines.
- Several ScapeLite users on one channel agree on who posts the shared messages without writing anything into your channels (optional private lease webhook, "Own events only" mode, and a notice when another user has a newer version).
- The member list follows the clan roster, and someone who left no longer appears in the digest.

### Reliability and packaging
- A watchdog notices a dead background service, logs it and restarts it (now, again after about 5 minutes, then every 10 minutes); the tray shows the last problem.
- The installer packs an allow-list of product files and checks itself for leaks of private files.
- Test commands for developers: `npm run test:cards`, `test:relay`, `test:watchdog`, `test:commands`, `test:onboarding`, `test:package`, `lint:forwards`.

Full list: CHANGELOG.md.
