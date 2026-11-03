// ScapeLite clan status board: the card builder. One pure function turns a compact snapshot of the player (plus a few remembered facts) into
// the Discord embed that is posted and edited. It runs in two places with the same code:
//   * in the watcher (Node: require('./clan-board-card')) to build what is sent to the board webhook;
//   * in the game page (the Clan Board plugin injects this file first) to draw the live preview in Settings > Plugins > Clan Status Board.
// Pure: no I/O, no clock of its own (`now` is passed in), nothing here can reach Discord or the game.
(function (root) {
  'use strict';

  // Fields the player can switch on or off (Plugins tab). Defaults: task, progress/ETA, recent level-ups, total level.
  const FIELD_KEYS = ['task', 'location', 'progress', 'levelUps', 'totalLevel', 'xpHr', 'hp', 'slayer', 'fortress', 'onlineSince', 'today'];
  const DEFAULT_FIELDS = { task: true, location: true, progress: true, levelUps: true, totalLevel: true, xpHr: false, hp: false, slayer: false, fortress: false, onlineSince: false, today: false };
  const COLORS = { online: 0x57F287, idle: 0xFEE75C, offline: 0x747F8D };
  const LEVELUP_WINDOW_MS = 24 * 3600 * 1000;
  const ICON_HOST = /^https:\/\/play\.scapewatch\.com\/assets\/icons\/skills\/[a-z_]{2,24}\.png$/;
  // skill ids that have a file in the game's assets/icons/skills folder (combat fights use the Slayer icon)
  const ICON_SKILLS = ['alms', 'bard', 'barter', 'brew', 'cook', 'craft', 'defend', 'delve', 'discover', 'dodge', 'draw', 'farm', 'fish', 'focus', 'forage', 'fortify', 'heft', 'imbue', 'invoke', 'life', 'luck', 'mine', 'plunder', 'sight', 'slay', 'smith', 'spirit', 'strike', 'surge', 'vigor'];
  const skillIconUrl = (origin, skill) => { const k = String(skill || '').toLowerCase() === 'combat' ? 'slay' : String(skill || '').toLowerCase(); return ICON_SKILLS.indexOf(k) >= 0 && /^https:\/\/play\.scapewatch\.com$/.test(origin || '') ? origin + '/assets/icons/skills/' + k + '.png' : null; };

  const SKILL_EMOJI = {
    life: '\u2764\uFE0F', spirit: '\uD83E\uDEBD', fish: '\uD83D\uDC1F', cook: '\uD83C\uDF73', strike: '\u2694\uFE0F', heft: '\uD83D\uDCAA', mine: '\u26CF\uFE0F', smith: '\uD83D\uDD28',
    sight: '\uD83C\uDFF9', draw: '\uD83C\uDFA8', forage: '\uD83C\uDF3F', craft: '\uD83E\uDDF5', focus: '\uD83C\uDFAF', surge: '\u26A1', invoke: '\uD83D\uDD2E', imbue: '\uD83E\uDE84',
    dodge: '\uD83D\uDCA8', defend: '\uD83D\uDEE1\uFE0F', farm: '\uD83C\uDF3E', brew: '\u2697\uFE0F', slay: '\uD83D\uDC80', vigor: '\uD83C\uDFC3', plunder: '\uD83D\uDCB0', barter: '\u2696\uFE0F',
    delve: '\uD83D\uDD73\uFE0F', fortify: '\uD83E\uDDF1', bard: '\uD83C\uDFB5', discover: '\uD83D\uDD0D', luck: '\uD83C\uDF40', alms: '\uD83D\uDE4F',
    woodcutting: '\uD83E\uDE93', wood: '\uD83E\uDE93', combat: '\u2694\uFE0F',
  };

  const cap = (s) => { s = String(s == null ? '' : s).replace(/[_-]+/g, ' ').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
  const num = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : String(n == null ? '' : n));
  const compact = (n) => { n = Number(n); if (!isFinite(n)) return '\u2013'; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)); };
  const unix = (ms) => Math.floor(ms / 1000);
  // Discord draws <t:SECONDS:R> as "3 minutes ago" / "in 12 minutes" and keeps it ticking by itself, so the card stays fresh with no edits.
  const rel = (ms) => '<t:' + unix(ms) + ':R>';
  // The names are the player's own game names; Discord markdown in them must not change how the card looks, and nothing may ping.
  const plain = (s) => String(s == null ? '' : s).replace(/[\\*_`~|>@#]/g, '\\$&').replace(/<(?=[@#:&!])/g, '\\<');
  const bar = (done, goal, n) => { n = n || 10; const f = Math.round(Math.max(0, Math.min(1, goal > 0 ? done / goal : 0)) * n); return '\u2593'.repeat(f) + '\u2591'.repeat(n - f); };
  const emojiOf = (skill) => SKILL_EMOJI[String(skill || '').toLowerCase()] || '\u2022';

  function fieldsOn(f) { return Object.assign({}, DEFAULT_FIELDS, f || {}); }

  // Folds a run of level-ups of the same skill (49->50, 50->51) into one line (49 -> 51) and drops everything older than 24 h.
  function recentLevelUps(list, now) {
    const out = [];
    (list || []).filter((x) => x && x.t && now - x.t <= LEVELUP_WINDOW_MS && now - x.t > -60000).sort((a, b) => a.t - b.t).forEach((x) => {
      const last = out[out.length - 1];
      const same = out.filter((o) => o.skill === x.skill).pop();
      if (same && same.to === x.from) { same.to = x.to; same.t = x.t; } else out.push({ skill: x.skill, from: x.from, to: x.to, t: x.t });
      void last;
    });
    return out.sort((a, b) => b.t - a.t);
  }

  // input: { name, snap, state ('online'|'idle'|'offline'), lastSeenAt, onlineSince, idleSince, levelUps, today:{xp,tasks}, fields, now }
  function build(input) {
    const i = input || {}, now = i.now || Date.now(), f = fieldsOn(i.fields), s = i.snap || {};
    const state = i.state === 'offline' ? 'offline' : i.state === 'idle' ? 'idle' : 'online';
    const lines = [], fields = [];
    const t = s.task || null;

    if (state === 'offline') {
      lines.push('\u26AB **Offline** \u00B7 last seen ' + (i.lastSeenAt ? rel(i.lastSeenAt) : 'a while ago'));
    } else if (state === 'idle') {
      lines.push('\uD83D\uDCA4 **Idle**' + (i.idleSince ? ' since ' + rel(i.idleSince) : ''));
    } else if (t && f.task) {
      const skillName = cap(t.skillName || t.skill);
      let l = emojiOf(t.skill) + ' **' + plain(skillName) + '**';
      if (t.text) l += ': ' + plain(t.text);
      if (f.location && t.place) l += ' at ' + plain(t.place);
      if (s.travelling) l = '\uD83D\uDEB6 Walking \u00B7 ' + l;
      lines.push(l);
    } else if (!f.task && state === 'online') {
      lines.push('\uD83D\uDFE2 **Online**');
    }
    if (state === 'online' && t && f.progress) {
      let l = '';
      if (t.goal > 0) l = bar(t.done, t.goal) + ' ' + num(t.done) + '/' + num(t.goal) + (t.kills ? ' kills' : '');
      else if (t.done > 0) l = num(t.done) + (t.kills ? ' kills' : ' done');
      if (t.etaAt && t.etaAt > now) l += (l ? ' \u00B7 ' : '') + 'done ' + rel(t.etaAt);
      if (l) lines.push(l);
    }
    if (f.onlineSince && state === 'online' && i.onlineSince) fields.push({ name: 'Online', value: 'since ' + rel(i.onlineSince), inline: true });
    if (f.totalLevel && s.totalLevel) fields.push({ name: 'Total level', value: num(s.totalLevel), inline: true });
    if (f.xpHr && state === 'online' && s.xpHr > 0) fields.push({ name: 'XP/h', value: compact(s.xpHr), inline: true });
    if (f.hp && s.hp && s.hp.max > 0) fields.push({ name: 'HP', value: num(s.hp.cur) + ' / ' + num(s.hp.max), inline: true });
    if (f.slayer && s.slay && s.slay.goal > 0) fields.push({ name: 'Slayer task', value: plain(cap(s.slay.name) || 'Task') + ' ' + num(s.slay.done) + '/' + num(s.slay.goal), inline: true });
    if (f.fortress && s.fortress) fields.push({ name: 'Fortress', value: plain(s.fortress.name || 'Run') + (s.fortress.wave ? ' \u00B7 wave ' + num(s.fortress.wave) : '') + (s.fortress.party > 1 ? ' \u00B7 ' + s.fortress.party + ' players' : ''), inline: true });
    if (f.today && i.today && (i.today.xp > 0 || i.today.tasks > 0)) fields.push({ name: 'Today', value: compact(i.today.xp || 0) + ' XP \u00B7 ' + num(i.today.tasks || 0) + ' tasks', inline: true });
    if (f.levelUps) {
      const ups = recentLevelUps(i.levelUps, now), shown = ups.slice(0, 6);
      const body = shown.map((u) => emojiOf(u.skill) + ' ' + plain(cap(u.skill)) + ' ' + u.from + ' \u2192 ' + u.to + ' (' + rel(u.t) + ')').join('\n') + (ups.length > shown.length ? '\n\u2026and ' + (ups.length - shown.length) + ' more' : '');
      fields.push({ name: 'Level-ups (last 24 h)', value: body || '_none yet_', inline: false });
    }

    const embed = {
      author: i.iconUrl ? { name: clip(i.name || 'Player', 80), icon_url: i.iconUrl } : { name: clip(i.name || 'Player', 80) },
      color: COLORS[state],
      description: lines.join('\n') || ' ',
      footer: { text: 'ScapeLite clan board' },
      timestamp: new Date(now).toISOString(),
    };
    if (fields.length) embed.fields = fields;
    // the current task's skill icon, from the game's own asset host only (online, with the task field on); idle and offline have none
    if (state === 'online' && f.task && t && typeof t.icon === 'string' && ICON_HOST.test(t.icon)) embed.thumbnail = { url: t.icon };
    const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
    // What decides whether an edit is worth sending: everything but the timestamp (the relative <t:..:R> tags tick on Discord's side).
    const sig = JSON.stringify({ e: Object.assign({}, embed, { timestamp: undefined }) });
    return { payload, sig, state };
  }

  const api = { build, recentLevelUps, skillIconUrl, ICON_SKILLS, FIELD_KEYS, DEFAULT_FIELDS, COLORS, LEVELUP_WINDOW_MS, SKILL_EMOJI, cap, num, compact, bar, rel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__ccBoardCard = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
