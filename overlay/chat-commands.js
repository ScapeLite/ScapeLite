// ScapeLite chat commands (ns __ccCmd). Type /sl help (or /scapelite help) in the ScapeLite chat box or in the game's own chat box.
// DISPLAY ONLY: a command reads ScapeLite's own state or changes ScapeLite's own settings. None of them acts in the game, posts to Discord or touches the game's chat.
//   * The line is ours when it starts with /sl or /scapelite. Every other line, every other /word, goes through exactly as before.
//   * A line that is ours is never sent. In the ScapeLite chat box the check sits in chat-plus.js; in the game's box a capture-phase listener below runs first.
//   * Replies are lines only you see (__ccChat.local), or a toast when the chat panel is not in use. They are never written into the game's message list.
//   * Commands that need the watcher (status, relay, digest, hiscores, plugin on/off) leave a record in window.__ccCmdBox; the watcher runs it from a fixed allowlist
//     (overlay/chat-commands-watcher.js) and calls window.__ccCmdReply. Chat text received from other players never reaches this registry.
// Design and the full command list: docs/CHAT-COMMANDS.md.
(function () {
  'use strict';
  const NS = '__ccCmd';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* nothing to replace */ }
  const life = window.__ccLife && window.__ccLife.scope && window.__ccLife.scope('chat-commands');
  if (!life) return 'cc chat commands need the lifecycle plugin';

  const PREFIX = /^\/(sl|scapelite)(\s|$)/i;
  const match = (line) => PREFIX.test(String(line || '').trim());

  // ------------------------------------------------------------------------------ watcher mailbox
  const pending = new Map();
  let seq = 0;
  function ask(name, args, o) {
    return new Promise((resolve) => {
      const box = window.__ccCmdBox = Array.isArray(window.__ccCmdBox) ? window.__ccCmdBox : [];
      if (box.length >= 20) { resolve({ ok: false, lines: [], error: 'Too many commands are waiting. Try again in a moment.' }); return; }
      const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (++seq);
      const t = setTimeout(() => { pending.delete(id); resolve({ ok: false, lines: [], error: 'The ScapeLite service did not answer. Check the status light.' }); }, (o && o.waitMs) || 12000);
      pending.set(id, { resolve, t });
      box.push({ id, name, args: args || [], at: Date.now() });
    });
  }
  window.__ccCmdReply = (rep) => {
    const p = rep && pending.get(rep.id); if (!p) return;
    pending.delete(rep.id); clearTimeout(p.t); p.resolve(rep);
  };

  // ------------------------------------------------------------------------------ showing a reply
  function toast(text) { try { if (window.__ccUI && window.__ccUI.toast) window.__ccUI.toast(text.length > 200 ? text.slice(0, 199) + '…' : text, { tone: 'info', ms: 6000 }); } catch (e) { /* no toast */ } }
  function show(lines, ctx, tone) {
    const list = (Array.isArray(lines) ? lines : [lines]).map((l) => String(l == null ? '' : l)).filter(Boolean);
    if (!list.length) return;
    const chat = window.__ccChat;
    if (chat && chat.local) {
      const here = ctx && ctx.source === 'chat-plus', open = !!(chat.isOpen && chat.isOpen());
      if (here || open || list.length > 1) { list.forEach((l, i) => chat.local(l, { kind: tone || 'info', open: i === 0 && !here && !open })); return; }
    }
    toast(list.join(' · '));
  }
  const fail = (ctx, text) => show(text, ctx, 'bad');

  // ------------------------------------------------------------------------------ the command table
  // kind: read = changes nothing, ctl = changes ScapeLite's own state only. A 'post' kind (anything that can write to Discord) is NOT allowed in this file:
  // it would need a --yes gate, a preview and the watcher's lease gates first (docs/CHAT-COMMANDS.md section 2.4), and scripts/test-chat-commands.js fails on it.
  const gameBuild = () => { const m = Array.from(document.scripts || []).map((s) => /game\.([0-9a-f]{6,})\.js/.exec(s.src || '')).find(Boolean); return m ? m[1] : 'unknown'; };
  const viaWatcher = (name, o) => async (ctx, args) => { const r = await ask(name, args, o); if (r.ok) return r.lines; fail(ctx, r.error || 'The command failed.'); return null; };
  const CMDS = [
    { path: ['help'], kind: 'read', usage: '/sl help [command]', summary: 'Lists the commands, or explains one.', run: (ctx, a) => help(a) },
    { path: ['version'], kind: 'read', usage: '/sl version', summary: 'ScapeLite version, how long it has run, the game build.', run: (ctx) => ask('version').then((r) => (r.ok ? r.lines : ['ScapeLite service: ' + (r.error || 'no answer')]).concat('Game build: ' + gameBuild())) },
    { path: ['status'], kind: 'read', usage: '/sl status', summary: 'One look at the link to the game, the relay, digest, clan rank and board.', run: viaWatcher('status') },
    { path: ['refresh'], alias: ['reload'], kind: 'ctl', usage: '/sl refresh', summary: 'Reloads ScapeLite (restarts the service and re-injects every plugin). The game page is not reloaded.',
      run: () => { window.__ccReloadRequest = Date.now(); return ['Reloading ScapeLite: the service restarts and re-injects every plugin, a few seconds. This reply is the last you will see; /sl version afterwards shows it is back.']; } },
    { path: ['plugins'], kind: 'read', usage: '/sl plugins', summary: 'Which plugins are on and off.', run: viaWatcher('plugins') },
    { path: ['plugin'], kind: 'ctl', usage: '/sl plugin <id> on|off', summary: 'Switches one plugin on or off right now (not the core ones).', run: viaWatcher('plugin') },
    { path: ['relay', 'status'], kind: 'read', usage: '/sl relay status', summary: 'Relay mode, shared lease, waiting events and per-webhook health. Never shows a webhook address.', run: viaWatcher('relay.status') },
    { path: ['digest', 'preview'], kind: 'read', usage: '/sl digest preview', summary: 'The activity digest as it would be posted now. Posts nothing.', run: viaWatcher('digest.preview') },
    { path: ['hiscores', 'check'], kind: 'read', usage: '/sl hiscores check', summary: 'Looks up the clan rank and members now. Posts nothing. Can take half a minute.',
      run: (ctx, a) => { show('Looking up the clan hiscores, this can take half a minute…', ctx); return viaWatcher('hiscores.check', { waitMs: 125000 })(ctx, a); } },
    { path: ['echo'], kind: 'read', hidden: true, usage: '/sl echo <text>', summary: 'Shows the text back to you. Exists to test the pipeline: nothing is sent.', run: (ctx, a) => [a.join(' ') || '(nothing)'] },
  ];
  const label = (c) => c.path.join(' ');
  const visible = () => CMDS.filter((c) => !c.hidden);

  function help(a) {
    const q = a.map((x) => x.toLowerCase());
    if (!q.length) {
      return ['ScapeLite commands (only you see these lines, nothing is sent to chat):'].concat(visible().map((c) => c.usage + '  -  ' + c.summary), ['Type /sl help <command> for one command. Commands can start with /sl or /scapelite.']);
    }
    const hit = visible().filter((c) => c.path[0] === q[0] && (q.length < 2 || c.path[1] === q[1]));
    if (!hit.length) return ['No command called "' + q.join(' ').slice(0, 40) + '". /sl help lists them.'];
    return hit.map((c) => c.usage + '  [' + c.kind + ']  ' + c.summary);
  }

  // ------------------------------------------------------------------------------ parsing and running
  function tokens(s) {
    const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
    while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  function lev(a, b) {
    const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; } for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const names = () => { const n = []; CMDS.forEach((c) => { if (!c.hidden) { n.push(c.path[0]); (c.alias || []).forEach((x) => n.push(x)); } }); return Array.from(new Set(n)); };
  function lookup(words) {
    const w0 = (words[0] || '').toLowerCase(), w1 = (words[1] || '').toLowerCase();
    const two = CMDS.find((c) => c.path.length === 2 && c.path[0] === w0 && c.path[1] === w1);
    if (two) return { cmd: two, args: words.slice(2) };
    const one = CMDS.find((c) => c.path.length === 1 && (c.path[0] === w0 || (c.alias || []).indexOf(w0) >= 0));
    if (one) return { cmd: one, args: words.slice(1) };
    const group = CMDS.filter((c) => c.path.length === 2 && c.path[0] === w0);
    return { group };
  }
  async function run(rest, ctx) {
    const words = tokens(rest);
    if (!words.length) { show(help([]), ctx); return; }
    const flags = words.filter((w) => /^--/.test(w)), plain = words.filter((w) => !/^--/.test(w));
    if (flags.length) { fail(ctx, 'Unknown option ' + flags[0].slice(0, 20) + '. No ScapeLite command takes options yet.'); return; }
    const r = lookup(plain);
    if (r.group && r.group.length) { fail(ctx, 'Try: ' + r.group.map((c) => c.usage).join('  or  ')); return; }
    if (!r.cmd) {
      const w = plain[0].toLowerCase(), near = names().map((n) => [n, lev(w, n)]).sort((x, y) => x[1] - y[1])[0];
      fail(ctx, 'Unknown command "' + w.slice(0, 30) + '".' + (near && near[1] <= 2 ? ' Did you mean ' + near[0] + '?' : '') + ' Try /sl help.'); return;
    }
    let out;
    try { out = await r.cmd.run(ctx, r.args); } catch (e) { fail(ctx, 'That command failed: ' + String(e && e.message || e).slice(0, 80)); return; }
    if (out) show(out, ctx);
  }
  // Never throws. Returns true when the line was ours (the caller must then not send it).
  function handle(line, ctx) {
    const m = PREFIX.exec(String(line || '').trim());
    if (!m) return false;
    try { run(String(line).trim().slice(m[0].length), ctx || {}).catch(() => {}); } catch (e) { /* ours either way */ }
    return true;
  }

  // ------------------------------------------------------------------------------ the game's own chat box
  // Runs before the game's handler on the input (capture phase on window). Only a line that starts with /sl or /scapelite is taken; everything else is left alone.
  // If ScapeLite is not injected this does not exist, and such a line goes out as ordinary chat (docs/CHAT-COMMANDS.md section 1.3).
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  life.on(window, 'keydown', (e) => {
    const t = e.target;
    if (e.key !== 'Enter' || e.isComposing || !t || !t.classList || !t.classList.contains('chat-input')) return;
    const line = String(t.value || '').trim();
    if (!match(line)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setVal.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true }));   // fwd-ok: clears the text the user typed in the game's box; no game control is pressed
    handle(line, { source: 'game-input' });
  }, true);

  function teardown() {
    pending.forEach((p) => { clearTimeout(p.t); p.resolve({ ok: false, lines: [], error: 'ScapeLite chat commands were switched off.' }); }); pending.clear();
    try { life.dispose(); } catch (e) { /* gone */ }
    if (window.__ccCmdReply) delete window.__ccCmdReply;
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc chat commands torn down';
  }
  window[NS] = { version: 1, teardown, match, handle, ask, commands: () => CMDS.map((c) => ({ path: c.path.slice(), kind: c.kind, hidden: !!c.hidden, usage: c.usage })), _lookup: lookup, _tokens: tokens };
  return 'cc chat commands loaded';
})();
