// ScapeLite Discord setup (ns __ccDiscordSetup). A step-by-step guide that explains the Discord features, takes the webhook of each channel, checks it and lets you press
// Test on it. Display only to the game; it posts nothing by itself: the only message it ever causes is ONE clearly labelled test message into one channel,
// when you press that channel's Test button (the watcher sends it, at most one every 10 seconds per channel).
//
// Secrets: a webhook address is typed into a masked field and handed to the Plugins settings (the watcher saves it in your private ScapeLite folder). After it is saved
// the field is empty again and only says "Saved": the address is never shown again, only replaced or cleared. Nothing here is written to the page's storage.
// Status comes from the watcher (window.__ccDiscordSetup.setState): which channels have a webhook and when each last worked or failed. Test requests go out through
// window.__ccDiscordSetup.take(), results come back through result(). Page 6 (Team settings) asks the watcher the same way (take().team, teamResult()): see docs/DISCORD-TEAM-SYNC.md.
// The long version of this guide: docs/DISCORD-RELAY-SETUP.md.
(function () {
  'use strict';
  const NS = '__ccDiscordSetup';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* nothing to replace */ }
  const UI = window.__ccUI;
  if (!UI) return 'cc discord-setup: UI kit not loaded';
  const PS = () => window.__ccPluginSettings || null;
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---- what each Discord feature is (one row each; ids match the watcher's DISCORD_FEATURES)
  const FEATURES = [
    { id: 'relay-clan', secret: 'relayClanWebhook', toggle: 'clanRelayEnabled', name: 'Clan feed', channel: '#clan-feed', need: 'Start here', group: 'main',
      posts: 'Rare drops, pets, unlocks, level-ups and quest completions of you and your clanmates (from clan chat and from your own personal feed).',
      extra: { toggle: 'relayPlainChat', label: 'Also post what people type in clan chat' } },
    { id: 'relay-global', secret: 'relayGlobalWebhook', toggle: 'globalRelayEnabled', name: 'Global milestones', channel: '#global-milestones', need: 'Optional', group: 'opt',
      posts: 'The cape and pet announcements that Global chat shows. Needs no clan.' },
    { id: 'digest', secret: 'digestWebhook', toggle: 'digestEnabled', name: 'Activity digest', channel: '#clan-digest', need: 'Optional', group: 'opt',
      posts: 'A short summary every few hours: notable drops, levels gained, quests finished.' },
    { id: 'hiscores', secret: 'hiscoresWebhook', toggle: 'hiscoresEnabled', name: 'Clan hiscores', channel: '#clan-rank', need: 'Optional', group: 'opt',
      posts: 'Your clan’s overall hiscores rank, when it changes.' },
    { id: 'raid', secret: 'raidSummaryWebhook', toggle: 'raidSummaryEnabled', name: 'Raid summaries', channel: '#raid-summaries', need: 'Optional', group: 'opt',
      posts: 'One summary after a raid, when enough clanmates took part.' },
    { id: 'board', secret: 'boardWebhook', toggle: 'clanBoardEnabled', name: 'Clan status board', channel: 'the board channel your clan leader gives you', need: 'Optional', group: 'opt',
      posts: 'One live card for you on the clan’s status board. It is edited in place, not reposted.' },
  ];
  const LEASE = { id: 'lease', secret: 'relayLeaseWebhook', name: 'Shared lease channel', channel: '#scapelite-private (staff only)' };
  const HOOK_RE = /^https:\/\/(discord(app)?\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{20,}(\?[\w=&.%-]*)?$/;
  const hookProblem = (v) => {
    if (!v) return '';
    if (!/^https:\/\//.test(v)) return 'A webhook address starts with https://';
    if (!/\/api\/webhooks\//.test(v)) return 'This is a link, but not a webhook: it should contain /api/webhooks/';
    if (!HOOK_RE.test(v)) return 'Part of the address is missing (it should end with a long code). Copy the whole webhook URL.';
    return '';
  };

  const P = UI.panel({ id: 'cc-discord-setup', title: 'Discord setup', width: 640, height: 'min(720px,86vh)', closable: true, collapsible: true, resizable: true, onClose: () => setOpen(false) });
  const el = P.el;
  let open = false, state = { features: [], at: 0 }, step = 'channels', stateSig = '';
  const drafts = {}, saved = {}, tests = {}, queue = [];   // drafts: text typed but not yet saved · saved: webhooks put in during this session · tests: per feature { at, ok, error, wait }
  { const sv0 = UI.store.get('panel:cc-discord-setup', null); if (sv0 && sv0.open !== undefined) open = !!sv0.open; else P.setOpen(false); }
  function setOpen(v) { open = !!v; P.setOpen(open); render(true); }

  const stOf = (id) => (state.features || []).find((f) => f.id === id) || null;
  const toggled = (f) => { try { return !!(PS() && PS().get(f.toggle)); } catch (e) { return false; } };
  const clock = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  // The one place that works out how a channel is doing, from what the watcher reports and what was just done here.
  function statusOf(f) {
    const s = stOf(f.id), t = tests[f.id];
    const configured = !!(s && s.configured) || !!saved[f.id];
    if (!configured) return { tone: 'dim', label: 'Not set up', configured: false };
    if (t && t.wait) return { tone: 'info', label: 'Sending the test…', configured };
    if (t && t.ok === false && (!s || !s.lastOkAt || t.at > s.lastOkAt)) return { tone: 'bad', label: 'Test failed: ' + t.error, configured };
    if (t && t.ok && (!s || !s.lastErrorAt || t.at > s.lastErrorAt)) return { tone: 'good', label: 'Works: test message arrived at ' + clock(t.at), configured };   // a test newer than the last refusal settles it
    if (s && s.lastErrorAt && (!s.lastOkAt || s.lastErrorAt > s.lastOkAt)) return { tone: 'bad', label: 'Discord refused the last post: ' + (s.lastError || 'unknown error'), configured };
    if (s && s.lastOkAt) return { tone: 'good', label: 'Works: last post at ' + clock(s.lastOkAt), configured };
    return { tone: 'accent', label: 'Saved. Press Test to check it.', configured };
  }

  // ---- watcher bridge
  function take() { const q = queue.splice(0, 5); return { tests: q, want: open, team: open && step === 'team' ? teamQueue.splice(0, 3) : [] }; }
  function setState(o) {
    if (!o || !Array.isArray(o.features)) return false;
    const sig = JSON.stringify(o.features.map((f) => [f.id, f.configured, f.lastOkAt, f.lastErrorAt, f.lastError, f.sent, f.failed]));
    state = { features: o.features, at: Date.now() };
    for (const f of o.features) if (f.configured) delete saved[f.id];
    if (sig !== stateSig) { stateSig = sig; render(false); }
    return true;
  }
  function result(id, r) {
    const f = FEATURES.find((x) => x.id === id); if (!f) return false;
    tests[id] = { at: Date.now(), ok: !!(r && r.ok), error: String((r && r.error) || '').slice(0, 160) || 'unknown error', wait: false };
    render(false);
    return true;
  }

  // ---- actions (these only hand things to the Plugins settings and the watcher)
  function saveHook(f, value) {
    const v = String(value || '').trim();
    if (!v || hookProblem(v) || !PS() || !PS().discordPut) return false;
    PS().discordPut(f.secret, v);
    saved[f.id] = true; delete drafts[f.id]; delete tests[f.id];
    render(true);
    return true;
  }
  function clearHook(f) {
    if (PS() && PS().discordPut) PS().discordPut(f.secret, '');
    delete saved[f.id]; delete drafts[f.id]; delete tests[f.id];
    const s = stOf(f.id); if (s) s.configured = false;
    render(true);
  }
  function askTest(f) {
    const t = tests[f.id];
    if (t && t.wait) return;
    tests[f.id] = { wait: true, at: Date.now() };
    queue.push({ id: f.id });
    render(true);
    setTimeout(() => { if (tests[f.id] && tests[f.id].wait) { tests[f.id] = { at: Date.now(), ok: false, error: 'No answer from ScapeLite’s background program. Is the game connected?', wait: false }; render(false); } }, 20000);
  }
  function flip(key) { if (PS() && PS().discordToggle) { PS().discordToggle(key); render(true); } }

  // ---- views
  const sw = (on, label, onClick) => {
    const r = h('label', 'cc-dsw'); const b = h('button', 'cc-sw' + (on ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.addEventListener('click', onClick); r.append(b, h('span', null, label)); return r;
  };
  function channelCard(f) {
    const st = statusOf(f), card = h('div', 'cc-row cc-dcard'); card.dataset.tone = st.tone;
    const top = h('div', 'ti'); top.appendChild(h('b', null, f.name)); top.appendChild(h('i', null, f.need)); card.appendChild(top);
    card.appendChild(h('div', 'su', f.posts));
    card.appendChild(h('div', 'su dim', 'Suggested channel: ' + f.channel));
    const line = h('div', 'cc-dline');
    if (!st.configured) {
      const inp = h('input', 'cc-dinp'); inp.type = 'password'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = 'Paste the webhook address here'; inp.value = drafts[f.id] || '';
      inp.setAttribute('aria-label', f.name + ' webhook address');
      ['keydown', 'keyup', 'keypress'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));   // keep game hotkeys out of the field
      const msg = h('div', 'cc-dmsg'); const btn = h('button', 'cc-btn sm', 'Save'); btn.type = 'button'; btn.dataset.v = 'primary'; btn.disabled = true;
      const eye = h('button', 'cc-btn sm', 'Show'); eye.type = 'button'; eye.dataset.v = 'quiet';
      eye.addEventListener('click', () => { const shown = inp.type === 'text'; inp.type = shown ? 'password' : 'text'; eye.textContent = shown ? 'Show' : 'Hide'; });
      const check = () => { const v = inp.value.trim(); drafts[f.id] = inp.value; const p = hookProblem(v); btn.disabled = !v || !!p; msg.textContent = v ? (p || 'Looks right.') : ''; msg.dataset.tone = v ? (p ? 'bad' : 'good') : ''; };
      inp.addEventListener('input', check); inp.addEventListener('paste', () => setTimeout(check, 0));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) saveHook(f, inp.value); });
      btn.addEventListener('click', () => saveHook(f, inp.value));
      line.append(inp, eye, btn); card.appendChild(line); card.appendChild(msg); check();
    } else {
      line.appendChild(h('span', 'cc-dsaved', '🔒 Webhook saved (hidden)'));
      const t = h('button', 'cc-btn sm', st.tone === 'info' ? 'Sending…' : 'Test this channel'); t.type = 'button'; t.dataset.v = 'primary'; t.disabled = st.tone === 'info';
      t.title = 'Sends ONE clearly labelled test message into this channel, only now, only because you pressed this.'; t.addEventListener('click', () => askTest(f));
      const c = h('button', 'cc-btn sm', 'Replace or remove'); c.type = 'button'; c.dataset.v = 'quiet'; c.title = 'Forget the saved webhook so you can paste another one'; c.addEventListener('click', () => clearHook(f));
      line.append(t, c); card.appendChild(line);
    }
    const stl = h('div', 'cc-dst'); stl.dataset.tone = st.tone; stl.textContent = (st.tone === 'good' ? '✓ ' : st.tone === 'bad' ? '✗ ' : st.tone === 'accent' ? '• ' : '') + st.label; card.appendChild(stl);
    if (st.configured) {
      const sws = h('div', 'cc-dsws');
      sws.appendChild(sw(toggled(f), f.id === 'relay-clan' ? 'Post the clan feed' : 'Post this', () => flip(f.toggle)));
      if (f.extra) sws.appendChild(sw(!!(PS() && PS().get(f.extra.toggle)), f.extra.label, () => flip(f.extra.toggle)));
      card.appendChild(sws);
    }
    return card;
  }

  const SECTIONS = [
    ['start', '1. Before you start'],
    ['channels', '2. Channels and webhooks'],
    ['roles', '3. Roles and pings'],
    ['game', '4. In the game'],
    ['more', '5. Several PCs'],
    ['team', '6. Team settings'],
  ];
  function viewStart(bd) {
    bd.appendChild(h('div', 'cc-sec', 'What this does'));
    bd.appendChild(h('div', 'cc-hint', 'ScapeLite can post to your Discord server: what happens in your clan (drops, pets, level-ups), summaries and a clan rank. Each kind of post goes to a channel of your choice through a webhook. A webhook is a private address that lets one program post into one channel; whoever has the address can post there, so treat it like a password.'));
    bd.appendChild(h('div', 'cc-sec', 'What you need'));
    const ul = h('ul', 'cc-dul');
    ['A Discord server where you may create webhooks (you need the “Manage Webhooks” permission, or ask an admin to make one and send it to you privately).',
     'One text channel per kind of post you want. Only the clan feed is needed to start; the rest are optional. Suggested names are on the next page.',
     'About five minutes.'].forEach((t) => ul.appendChild(h('li', null, t)));
    bd.appendChild(ul);
    bd.appendChild(h('div', 'cc-sec', 'Make a webhook (once per channel)'));
    const ol = h('ol', 'cc-dul');
    ['In Discord, open the channel’s settings (the cog next to the channel name).', 'Integrations → Webhooks → New Webhook.', 'Give it a name (the name is what Discord shows as the poster) and pick the channel.', 'Press “Copy Webhook URL”. That is the address you paste on the next page.'].forEach((t) => ol.appendChild(h('li', null, t)));
    bd.appendChild(ol);
    bd.appendChild(h('div', 'cc-hint', 'Never post a webhook address in a public place. If one leaks, delete that webhook in Discord and make a new one.'));
    const go = h('button', 'cc-btn', 'Next: channels and webhooks'); go.type = 'button'; go.dataset.v = 'primary'; go.addEventListener('click', () => { step = 'channels'; render(true); }); bd.appendChild(go);
  }
  function viewChannels(bd) {
    bd.appendChild(h('div', 'cc-hint', 'Paste one webhook per feature, press Save, then Test this channel. The test sends one message that says it is a test; nothing else is posted when you press it. You can skip every feature you do not want.'));
    bd.appendChild(h('div', 'cc-sec', 'Start here'));
    FEATURES.filter((f) => f.group === 'main').forEach((f) => bd.appendChild(channelCard(f)));
    bd.appendChild(h('div', 'cc-sec', 'Optional channels'));
    FEATURES.filter((f) => f.group === 'opt').forEach((f) => bd.appendChild(channelCard(f)));
  }
  function viewRoles(bd) {
    bd.appendChild(h('div', 'cc-hint', 'Pings are optional. A ping makes Discord notify the members of a role when something rare happens. The clan feed can ping different roles for different events (rare drops, ultra rares, pets, shiny pets, unlocks, level-ups, quests).'));
    bd.appendChild(h('div', 'cc-sec', 'Set up a ping role'));
    const ol = h('ol', 'cc-dul');
    ['In Discord: User Settings → Advanced → turn on Developer Mode (this lets you copy IDs).',
     'Server Settings → Roles → create or open the role → Display → tick “Allow anyone to @mention this role”. Without it Discord may refuse the ping.',
     'Right-click the role (in Server Settings → Roles) → Copy Role ID.',
     'In the game: Settings → Plugins → Notifications and Discord → Chat Relay Pings → Ping Roles. Paste the ID and tick the events that role should be pinged for. You can add several roles.'].forEach((t) => ol.appendChild(h('li', null, t)));
    bd.appendChild(ol);
    bd.appendChild(h('div', 'cc-sec', 'Who needs what'));
    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr'); ['Role', 'Needed?', 'Used for'].forEach((t) => hr.appendChild(h('th', null, t))); hd.appendChild(hr); tb.appendChild(hd);
    const body = h('tbody');
    [['Any role you want pinged', 'No', 'Ping roles: members opt in by having the role.'], ['A staff role', 'No', 'Can see the private “shared lease” channel (page 5).'], ['@everyone', 'No', 'ScapeLite never pings @everyone or @here.']].forEach((r) => { const tr = h('tr'); r.forEach((c) => tr.appendChild(h('td', null, c))); body.appendChild(tr); });
    tb.appendChild(body); bd.appendChild(tb);
  }
  function viewGame(bd) {
    bd.appendChild(h('div', 'cc-sec', 'Nothing to change in the game'));
    bd.appendChild(h('div', 'cc-hint', 'ScapeLite reads the game’s chat in the background. It also sees the lines your own chat window hides: a channel you greyed out (for example Global) or a type of message you filtered away does not stop the relay.'));
    bd.appendChild(h('div', 'cc-sec', 'Good to know'));
    const ul = h('ul', 'cc-dul');
    ['Clan events only arrive while you are in a clan. Global milestones need no clan.', 'Only new events are posted. Lines that were already in the chat when ScapeLite started are history and are not posted.', 'ScapeLite has to be running with the game open for anything to be posted.', 'Your own drops, unlocks and level-ups come from your personal feed and are posted in the clan feed next to everyone else’s.'].forEach((t) => ul.appendChild(h('li', null, t)));
    bd.appendChild(ul);
  }
  function viewMore(bd) {
    bd.appendChild(h('div', 'cc-hint', 'If you play on two PCs, or several clanmates run ScapeLite and use the same channel, every copy would post the same events. ScapeLite avoids that by letting one copy at a time post.'));
    bd.appendChild(h('div', 'cc-sec', 'How it decides'));
    const ul = h('ul', 'cc-dul');
    ['Settings → Plugins → Chat Relay → “Several ScapeLite Users”: Automatic (default) lets one copy post; Own events only posts just what happens to your own character; Always post is for the only user; Never post keeps this PC silent.', 'Clan with several ScapeLite users: ONE person (the leader) makes a webhook in a private channel only ScapeLite users can see and hands it out together with the relay webhook. Everyone pastes it below. The copies keep one small marker message there to agree who posts; if that PC goes offline another takes over within about two minutes.', 'Two PCs of your own: set the second one to Never post (or Own events only).', 'Nobody has the same posting webhook as a lease webhook: they are two different webhooks.'].forEach((t) => ul.appendChild(h('li', null, t)));
    bd.appendChild(ul);
    const f = LEASE, saveOk = !!(PS() && PS().discordHas && PS().discordHas(f.secret)) || !!saved[f.id];
    const card = h('div', 'cc-row cc-dcard'); card.dataset.tone = saveOk ? 'good' : 'dim';
    const top = h('div', 'ti'); top.appendChild(h('b', null, f.name)); top.appendChild(h('i', null, 'Optional')); card.appendChild(top);
    card.appendChild(h('div', 'su dim', 'Suggested channel: ' + f.channel));
    const line = h('div', 'cc-dline');
    if (!saveOk) {
      const inp = h('input', 'cc-dinp'); inp.type = 'password'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = 'Paste the webhook address here (optional)'; inp.value = drafts[f.id] || '';
      ['keydown', 'keyup', 'keypress'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
      const msg = h('div', 'cc-dmsg'); const btn = h('button', 'cc-btn sm', 'Save'); btn.type = 'button'; btn.dataset.v = 'primary'; btn.disabled = true;
      const check = () => { const v = inp.value.trim(); drafts[f.id] = inp.value; const p = hookProblem(v); btn.disabled = !v || !!p; msg.textContent = v ? (p || 'Looks right.') : ''; msg.dataset.tone = v ? (p ? 'bad' : 'good') : ''; };
      inp.addEventListener('input', check); btn.addEventListener('click', () => { if (!hookProblem(inp.value.trim()) && PS() && PS().discordPut) { PS().discordPut(f.secret, inp.value.trim()); saved[f.id] = true; delete drafts[f.id]; render(true); } });
      line.append(inp, btn); card.appendChild(line); card.appendChild(msg); check();
    } else {
      line.appendChild(h('span', 'cc-dsaved', '🔒 Webhook saved (hidden)'));
      const c = h('button', 'cc-btn sm', 'Replace or remove'); c.type = 'button'; c.dataset.v = 'quiet'; c.addEventListener('click', () => { if (PS() && PS().discordPut) PS().discordPut(f.secret, ''); delete saved[f.id]; render(true); });
      line.appendChild(c); card.appendChild(line);
    }
    bd.appendChild(card);
  }
  // ---- Team settings (page 6): publish my settings, gather the team's, export / import. The work is done by the watcher (overlay/team-sync-host.js); this page only asks and shows.
  // Webhook addresses are never shown here: previews and differences say "set / not set". They travel only when "Include webhook addresses" is ticked AND confirmed.
  const teamQueue = [], teamWait = {};
  let teamSeq = 0;
  const T = { status: null, statusAt: 0, preview: null, gathered: null, busy: '', msg: '', msgTone: '', includeUrls: false, confirmUrls: false, takeUrls: false, picked: {}, text: '', exported: false };
  function askTeam(op, args) {
    return new Promise((resolve) => {
      const id = 't' + (++teamSeq);
      teamWait[id] = resolve; teamQueue.push({ id, op, args: args || {} });
      setTimeout(() => { if (teamWait[id]) { delete teamWait[id]; resolve({ ok: false, error: 'No answer from ScapeLite’s background program. Is the game connected?' }); } }, 25000);
    });
  }
  function teamResult(id, r) { const f = teamWait[id]; if (!f) return false; delete teamWait[id]; f(r && typeof r === 'object' ? r : { ok: false, error: 'unknown answer' }); return true; }
  const when = (t) => { try { return t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } };
  async function teamDo(label, op, args, then) {
    if (T.busy) return;
    T.busy = label; T.msg = ''; render(true);
    const r = await askTeam(op, args);
    T.busy = '';
    if (!r.ok) { T.msg = r.error || 'Something went wrong.'; T.msgTone = 'bad'; } else if (then) then(r);
    askTeam('status').then((s) => { if (s.ok) { T.status = s; T.statusAt = Date.now(); } render(true); });
    render(true);
  }
  function teamPreview() { teamDo('Looking at your settings…', 'preview', { includeUrls: T.includeUrls }, (r) => { T.preview = r; T.gathered = null; }); }
  function teamPublish() {
    if (T.includeUrls && !T.confirmUrls) return;
    teamDo('Publishing…', 'publish', { includeUrls: T.includeUrls, confirmUrls: T.confirmUrls }, (r) => { T.msg = 'Published version ' + r.ver + (r.urls ? ' (with webhook addresses)' : '') + ' in ' + r.parts + ' message' + (r.parts > 1 ? 's' : '') + '.'; T.msgTone = 'good'; T.preview = null; });
  }
  function teamGather() { teamDo('Gathering…', 'gather', {}, (r) => { if (r.none) { T.msg = 'Nobody has published team settings yet.'; T.msgTone = 'dim'; T.gathered = null; } else { T.gathered = r; T.picked = {}; r.rows.forEach((x) => { if (!x.same && !x.secret) T.picked[x.key] = true; }); T.takeUrls = false; T.preview = null; } }); }
  function teamImport() { teamDo('Reading the text…', 'import', { text: T.text }, (r) => { T.gathered = r; T.picked = {}; r.rows.forEach((x) => { if (!x.same && !x.secret) T.picked[x.key] = true; }); T.takeUrls = false; T.preview = null; }); }
  function teamApply(all) {
    const g = T.gathered; if (!g) return;
    const keys = g.rows.filter((x) => (all ? (!x.secret || T.takeUrls) : T.picked[x.key]) && (!x.secret || T.takeUrls)).map((x) => x.key);
    teamDo('Applying…', 'apply', { keys, urls: T.takeUrls }, (r) => { T.msg = 'Applied ' + r.applied + ' setting' + (r.applied > 1 ? 's' : '') + '. “Undo last change” puts the old values back.'; T.msgTone = 'good'; T.gathered = null; });
  }
  function teamExport() { if (T.includeUrls && !T.confirmUrls) return; teamDo('Making the text…', 'export', { includeUrls: T.includeUrls, confirmUrls: T.confirmUrls }, (r) => { T.text = r.text; T.exported = true; T.msg = 'Copy the text below and send it to your clanmate' + (r.urls ? ' in a PRIVATE message: it contains webhook addresses.' : '.'); T.msgTone = r.urls ? 'bad' : 'good'; }); }
  function teamUndo() { teamDo('Undoing…', 'undo', {}, () => { T.msg = 'The last change was undone.'; T.msgTone = 'good'; T.gathered = null; }); }
  function copyText(text) { try { navigator.clipboard.writeText(text); T.msg = 'Copied.'; T.msgTone = 'good'; } catch (e) { T.msg = 'Select the text and copy it by hand (Ctrl+C).'; T.msgTone = 'dim'; } render(true); }
  function saveFile(text) { try { const a = h('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'scapelite-team-settings.txt'; document.body.appendChild(a); a.click(); a.remove();   // fwd-ok: my own download link, no game control
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); } catch (e) { T.msg = 'Could not save a file here: copy the text instead.'; T.msgTone = 'bad'; render(true); } }
  function loadFile() { const i = h('input'); i.type = 'file'; i.accept = '.txt,text/plain'; i.addEventListener('change', () => { const f = i.files && i.files[0]; if (!f || f.size > 100000) return; const r = new FileReader(); r.onload = () => { T.text = String(r.result || '').trim(); render(true); }; r.readAsText(f); }); i.click(); }   // fwd-ok: my own file picker, no game control

  const btn = (text, v, onClick, title) => { const b = h('button', 'cc-btn sm', text); b.type = 'button'; if (v) b.dataset.v = v; if (title) b.title = title; b.addEventListener('click', onClick); return b; };
  const chk = (on, label, onChange) => { const l = h('label', 'cc-dsw'); const i = h('input'); i.type = 'checkbox'; i.checked = !!on; i.addEventListener('change', () => onChange(i.checked)); l.append(i, h('span', null, label)); return l; };
  function urlsOption(bd, verb) {
    bd.appendChild(chk(T.includeUrls, 'Include webhook addresses', (v) => { T.includeUrls = v; if (!v) T.confirmUrls = false; T.preview = null; T.exported = false; render(true); }));
    if (!T.includeUrls) return;
    const w = h('div', 'cc-dmsg'); w.dataset.tone = 'bad';
    w.textContent = verb === 'publish'
      ? 'Warning: the addresses would be stored in the private lease channel, and everyone who has the lease webhook can read them. If the lease webhook leaks, so do they. Only do this if you trust everyone who has it.'
      : 'Warning: the text will contain your webhook addresses. Anyone who gets the text can post into your channels. Send it only in a private message.';
    bd.appendChild(w);
    bd.appendChild(chk(T.confirmUrls, 'I understand, include them', (v) => { T.confirmUrls = v; render(true); }));
  }
  function diffTable(bd, g) {
    const head = h('div', 'cc-hint');
    head.textContent = g.source === 'team' ? 'Published by ' + (g.by || 'someone') + (g.at ? ' · ' + when(g.at) : '') + ' · version ' + g.ver + '.' : 'From the text you pasted' + (g.by ? ' (made by ' + g.by + (g.at ? ', ' + when(g.at) : '') + ')' : '') + '.';
    bd.appendChild(head);
    if (g.refused) bd.appendChild(h('div', 'cc-dmsg', g.refused + ' entr' + (g.refused > 1 ? 'ies were' : 'y was') + ' left out because ScapeLite does not accept them.'));
    bd.appendChild(h('div', 'cc-hint', g.changes ? g.changes + ' setting' + (g.changes > 1 ? 's differ' : ' differs') + ' from yours. Tick what you want to take over.' : 'Everything already matches the team.'));
    const tb = h('table', 'cc-table'), hd = h('thead'), hr = h('tr'); ['', 'Setting', 'Yours', 'Team'].forEach((t) => hr.appendChild(h('th', null, t))); hd.appendChild(hr); tb.appendChild(hd);
    const body = h('tbody'); let grp = '';
    g.rows.forEach((x) => {
      if (x.group !== grp) { grp = x.group; const gr = h('tr'); const gc = h('td', 'cc-gh', grp); gc.colSpan = 4; gr.appendChild(gc); body.appendChild(gr); }
      const tr = h('tr'); if (x.same) tr.className = 'cc-same';
      const c0 = h('td'); const i = h('input'); i.type = 'checkbox'; i.disabled = x.same || (x.secret && !T.takeUrls); i.checked = !!(x.secret ? (T.takeUrls && T.picked[x.key] !== false && !x.same) : T.picked[x.key]); i.addEventListener('change', () => { T.picked[x.key] = i.checked; }); c0.appendChild(i);
      tr.append(c0, h('td', null, x.label), h('td', 'cc-v', x.local), h('td', 'cc-v', x.remote)); body.appendChild(tr);
    });
    tb.appendChild(body); bd.appendChild(tb);
    if (g.urls) bd.appendChild(chk(T.takeUrls, 'Also take the webhook addresses (these are secrets)', (v) => { T.takeUrls = v; render(true); }));
    const line = h('div', 'cc-dline');
    line.append(btn('Apply selected', 'primary', () => teamApply(false)), btn('Apply all that differ', null, () => teamApply(true)), btn('Cancel', 'quiet', () => { T.gathered = null; render(true); }));
    bd.appendChild(line);
  }
  function viewTeam(bd) {
    if (!T.statusAt && !T.busy) { T.statusAt = Date.now(); askTeam('status').then((s) => { if (s.ok) { T.status = s; } render(true); }); }
    const s = T.status;
    bd.appendChild(h('div', 'cc-hint', 'One person sets everything up (ping roles, hiscores, digest, raid rules). Everyone who uses the same shared lease webhook can then gather those settings with one click, instead of typing them again. Your own looks, hotkeys and the “Several ScapeLite users” mode are never shared. Webhook addresses are shared only if you choose to.'));
    if (s && !s.lease) { const c = h('div', 'cc-row cc-dcard'); c.dataset.tone = 'bad'; c.appendChild(h('div', 'su', 'No shared lease webhook is saved yet. Team settings travel through it: add one on page 5, “Several PCs”. Export and Import below work without it.')); const go = btn('Go to page 5', 'primary', () => { step = 'more'; render(true); }); c.appendChild(go); bd.appendChild(c); }
    const stat = h('div', 'cc-dst'); stat.dataset.tone = s && s.meta ? 'good' : 'dim';
    stat.textContent = !s ? 'Looking for team settings…' : s.meta ? 'Latest published: version ' + s.meta.ver + (s.meta.by ? ' by ' + s.meta.by : '') + (s.meta.at ? ' · ' + when(s.meta.at) : '') + (s.meta.urls ? ' · includes webhook addresses' : '') + (s.lastVer ? ' · you have applied or published version ' + s.lastVer : '') : (s.lease ? 'Nobody has published team settings yet.' : '');
    bd.appendChild(stat);
    if (T.busy) { const b = h('div', 'cc-dst', T.busy); b.dataset.tone = 'info'; bd.appendChild(b); }
    if (T.msg) { const m = h('div', 'cc-dst', T.msg); m.dataset.tone = T.msgTone || ''; bd.appendChild(m); }
    const lease = !s || s.lease;

    const A = h('div', 'cc-row cc-dcard'); A.appendChild(h('div', 'ti', '')); A.firstChild.appendChild(h('b', null, 'Publish my settings to the team'));
    A.appendChild(h('div', 'su', 'Shows exactly what would be published, then you press Publish. Anyone who holds the lease webhook can publish, so they can replace each other’s version.'));
    urlsOption(A, 'publish');
    const al = h('div', 'cc-dline'); al.appendChild(btn('Preview', 'primary', teamPreview)); A.appendChild(al);
    if (T.preview) {
      const p = T.preview;
      if (p.tooBig) A.appendChild(h('div', 'cc-dmsg', p.error)); else {
        A.appendChild(h('div', 'su dim', 'Would be published as version ' + p.nextVer + ' · ' + p.rows.length + ' settings' + (p.urls.length ? ' + ' + p.urls.length + ' webhook address' + (p.urls.length > 1 ? 'es' : '') + ' (' + p.urls.join(', ') + ')' : '') + ' · ' + p.parts + ' message' + (p.parts > 1 ? 's' : '') + (p.current ? ' · replaces version ' + p.current.ver + (p.current.by ? ' by ' + p.current.by : '') : '')));
        const tb = h('table', 'cc-table'), body = h('tbody'); let grp = '';
        p.rows.forEach((x) => { if (x.group !== grp) { grp = x.group; const gr = h('tr'); const gc = h('td', 'cc-gh', grp); gc.colSpan = 2; gr.appendChild(gc); body.appendChild(gr); } const tr = h('tr'); tr.append(h('td', null, x.label), h('td', 'cc-v', x.value)); body.appendChild(tr); });
        tb.appendChild(body); A.appendChild(tb);
        const pl = h('div', 'cc-dline'); const pb = btn('Publish version ' + p.nextVer, 'primary', teamPublish); pb.disabled = !lease || (T.includeUrls && !T.confirmUrls) || !!T.busy; pl.appendChild(pb); A.appendChild(pl);
        if (!lease) A.appendChild(h('div', 'cc-dmsg', 'Needs the shared lease webhook (page 5).'));
      }
    }
    bd.appendChild(A);

    const B = h('div', 'cc-row cc-dcard'); B.appendChild(h('div', 'ti', '')); B.firstChild.appendChild(h('b', null, 'Gather the team’s settings'));
    B.appendChild(h('div', 'su', 'Reads what the team published and shows what differs from yours. Nothing changes until you press Apply.'));
    const bl = h('div', 'cc-dline'); const gb = btn('Gather', 'primary', teamGather); gb.disabled = !lease || !!T.busy; bl.appendChild(gb);
    if (s && s.hasUndo) bl.appendChild(btn('Undo last change', null, teamUndo, 'Put the values back that were replaced the last time you applied settings'));
    B.appendChild(bl);
    B.appendChild(sw(toggled({ toggle: 'teamAutoSync' }), 'Keep in sync automatically (never webhook addresses)', () => flip('teamAutoSync')));
    if (T.gathered && T.gathered.source === 'team') diffTable(B, T.gathered);
    bd.appendChild(B);

    const C = h('div', 'cc-row cc-dcard'); C.appendChild(h('div', 'ti', '')); C.firstChild.appendChild(h('b', null, 'Export and import as text'));
    C.appendChild(h('div', 'su', 'For people who are not on the same lease webhook, or to keep a copy. Export makes one block of text; Import reads one.'));
    urlsOption(C, 'export');
    const ta = h('textarea', 'cc-dinp'); ta.rows = 4; ta.spellcheck = false; ta.placeholder = 'Export fills this box. To import, paste a text that starts with SLT1. here.'; ta.value = T.text;
    ['keydown', 'keyup', 'keypress'].forEach((t) => ta.addEventListener(t, (e) => e.stopPropagation()));
    ta.addEventListener('input', () => { T.text = ta.value; T.exported = false; });
    C.appendChild(ta);
    const cl = h('div', 'cc-dline');
    const eb = btn('Export', 'primary', teamExport); eb.disabled = !!T.busy || (T.includeUrls && !T.confirmUrls);
    const ib = btn('Import this text', null, teamImport); ib.disabled = !!T.busy;
    cl.append(eb, ib, btn('Copy', 'quiet', () => copyText(T.text)), btn('Save as file', 'quiet', () => saveFile(T.text)), btn('Load file', 'quiet', loadFile)); C.appendChild(cl);
    if (T.gathered && T.gathered.source === 'import') diffTable(C, T.gathered);
    bd.appendChild(C);
  }
  const VIEWS = { start: viewStart, channels: viewChannels, roles: viewRoles, game: viewGame, more: viewMore, team: viewTeam };

  function summaryLine(bd) {
    const total = FEATURES.length, on = FEATURES.filter((f) => statusOf(f).configured).length;
    const bad = FEATURES.filter((f) => statusOf(f).tone === 'bad').length;
    const stats = h('div', 'cc-stats');
    const stat = (v, l, tone) => { const s = h('div', 'cc-stat'); if (tone) s.dataset.tone = tone; s.appendChild(h('b', null, v)); s.appendChild(h('span', null, l)); stats.appendChild(s); };
    stat(on + ' / ' + total, 'channels set up', on ? 'good' : null);
    stat(String(bad), 'with a problem', bad ? 'bad' : null);
    const st = statusOf(FEATURES[0]);
    stat(st.configured ? (st.tone === 'good' ? 'Working' : st.tone === 'bad' ? 'Needs a look' : 'Saved') : 'Not set up', 'clan feed', st.tone === 'good' ? 'good' : st.tone === 'bad' ? 'bad' : null);
    bd.appendChild(stats);
    P.setChip(on + ' of ' + total + ' set up' + (bad ? ' · ' + bad + ' problem' + (bad > 1 ? 's' : '') : ''));
  }

  function render(force) {
    const typing = document.activeElement && el.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (!open) { el.classList.remove('show'); return; }
    if (typing && !force) return;   // never rebuild the page under a field that is being typed in
    el.classList.add('show');
    const body = el.querySelector('.bd'), top = body.scrollTop;
    body.textContent = '';
    summaryLine(body);
    const tabs = h('div', 'cc-tabs'); tabs.setAttribute('role', 'tablist');
    SECTIONS.forEach(([k, label]) => { const t = h('button', 'cc-tab', label); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', k === step ? 'true' : 'false'); t.addEventListener('click', () => { step = k; render(true); }); tabs.appendChild(t); });
    body.appendChild(tabs);
    VIEWS[step](body);
    const foot = h('div', 'cc-hint', 'The full guide with a troubleshooting list: ');
    const a = h('a', null, 'docs/DISCORD-RELAY-SETUP.md'); a.href = 'http://localhost:7777/docs/discord-relay-setup'; a.target = '_blank'; a.rel = 'noopener'; foot.appendChild(a); body.appendChild(foot);
    body.scrollTop = top;
  }

  const style = document.createElement('style'); style.id = 'cc-discord-setup-style';
  style.textContent = `
#cc-discord-setup .cc-dcard{display:block;margin:0 0 8px;padding:9px 11px}
#cc-discord-setup .cc-dcard .ti{display:flex;gap:8px;align-items:baseline}
#cc-discord-setup .cc-dcard .ti i{font-style:normal;color:var(--cc-text-faint);font-size:11.5px;margin-left:auto}
#cc-discord-setup .cc-dcard .su{margin:3px 0;color:var(--cc-text-dim)}
#cc-discord-setup .cc-dcard .su.dim{color:var(--cc-text-faint);font-size:12px}
#cc-discord-setup .cc-dline{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
#cc-discord-setup .cc-dinp{flex:1 1 220px;min-width:0;background:var(--cc-sunk);color:var(--cc-text);border:1px solid var(--cc-border-strong);border-radius:6px;padding:5px 8px;font:inherit}
#cc-discord-setup .cc-dinp:focus{outline:2px solid var(--cc-info);outline-offset:1px}
#cc-discord-setup .cc-dmsg{min-height:16px;margin-top:3px;font-size:12px;color:var(--cc-text-faint)}
#cc-discord-setup .cc-dmsg[data-tone=bad]{color:var(--cc-bad)}#cc-discord-setup .cc-dmsg[data-tone=good]{color:var(--cc-good)}
#cc-discord-setup .cc-dsaved{color:var(--cc-text-dim)}
#cc-discord-setup .cc-dst{margin-top:6px;font-size:12.5px;color:var(--cc-text-dim)}
#cc-discord-setup .cc-dst[data-tone=good]{color:var(--cc-good)}#cc-discord-setup .cc-dst[data-tone=bad]{color:var(--cc-bad)}#cc-discord-setup .cc-dst[data-tone=accent]{color:var(--cc-accent)}
#cc-discord-setup .cc-dsws{display:flex;gap:16px;flex-wrap:wrap;margin-top:7px}
#cc-discord-setup .cc-dsw{display:flex;gap:7px;align-items:center;cursor:pointer;color:var(--cc-text)}
#cc-discord-setup .cc-dul{margin:4px 0 10px 18px;padding:0;color:var(--cc-text-dim);line-height:1.5}
#cc-discord-setup .cc-dul li{margin:3px 0}
#cc-discord-setup textarea.cc-dinp{display:block;width:100%;box-sizing:border-box;resize:vertical;font:11.5px/1.35 ui-monospace,Consolas,monospace}
#cc-discord-setup .cc-gh{padding-top:7px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cc-text-faint)}
#cc-discord-setup .cc-v{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cc-text-dim)}
#cc-discord-setup tr.cc-same td{opacity:.55}
`;
  document.head.appendChild(style);

  const timer = setInterval(() => { try { if (open && !(document.hidden || window.__ccEcoOn)) render(false); } catch (e) { /* keep ticking */ } }, 5000);
  function teardown() {
    clearInterval(timer); style.remove(); P.destroy();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc discord-setup torn down';
  }
  window[NS] = {
    version: 2, teardown, render, take, setState, result, teamResult,
    get isOpen() { return open; }, toggle() { setOpen(!open); }, open(k) { if (k && VIEWS[k]) step = k; setOpen(true); },
    get step() { return step; },
  };
  render(true);
  return 'cc discord-setup loaded';
})();
