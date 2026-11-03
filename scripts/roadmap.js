#!/usr/bin/env node
// ScapeLite roadmap CLI: add and move items from the terminal without opening the page.  npm run roadmap -- help
// Reads and writes roadmap/roadmap.json through roadmap/store.js (atomic write, history, same rules as the page).
'use strict';
const store = require('../roadmap/store');

const HELP = `ScapeLite roadmap CLI   (npm run roadmap -- <command> ...   or   node scripts/roadmap.js <command> ...)

  areas                                   list area ids
  list [area] [--status s] [--q text] [--tag t] [--milestone v]     list items (default: not done)
  show <id>                               print one item
  add "Title" --area feat [--status idea|planned|doing|done] [--p P1|P2|P3] [--e S|M|L]
              [--tag a,b] [--source "subagent: x"] [--notes "text"] [--milestone 0.5.0]
              [--link path] [--public] [--summary "one line for players"]
  idea|plan|start|done|wontdo <id...> [--reason "why"] [--milestone v]   move items (id, number or unique title part)
  set <id> field=value ...                fields: title notes area priority effort tags source milestone summary public links
  note <id> "text"                        append a line to the notes
  rm <id> --yes                           delete an item (prefer wontdo)
  changelog [--milestone v] [--since YYYY-MM-DD] [--by date]    release notes from done items (markdown)
  export                                  write roadmap/public/roadmap.json and roadmap.html (public items only)

Sources for subagent findings go to IDEAS: use  add "..." --area adv --source "subagent: <what>"  (status defaults to idea).
Never put a subagent's proposal straight into planned or doing; the user promotes it.`;

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['public', 'yes', 'json'].includes(k)) opt[k] = true;
      else { opt[k] = opt[k] !== undefined ? [].concat(opt[k], argv[++i]) : argv[++i]; }
    } else pos.push(a);
  }
  return { pos, opt };
}
const list = (v) => v === undefined ? [] : [].concat(v);
const csv = (v) => list(v).join(',').split(',').map((s) => s.trim()).filter(Boolean);
function line(i, doc) {
  const a = doc.areas.find((x) => x.id === i.area);
  return i.id.padEnd(9) + ' ' + i.status.padEnd(7) + ' ' + i.priority + '/' + i.effort + ' ' + (i.milestone || '').padEnd(6) + ' ' + i.title + (i.tags.length ? '  [' + i.tags.join(', ') + ']' : '') + (a ? '' : '');
}
function die(m) { console.error(m); process.exit(1); }

const { pos, opt } = parse(process.argv.slice(2));
const cmd = (pos.shift() || 'help').toLowerCase();
if (cmd === 'help' || cmd === '-h' || opt.help) { console.log(HELP); process.exit(0); }

let doc;
try { doc = store.load(); } catch (e) { die(String(e.message)); }
function commit(msg) { try { store.save(doc, doc.rev); } catch (e) { die(e.code === 'conflict' ? 'Roadmap changed while editing, run the command again.' : String(e.message)); } if (msg) console.log(msg); }
function need(ref) { const it = store.findItem(doc, ref); if (!it) die('No single item matches "' + ref + '" (use the id, e.g. feat-004).'); return it; }

if (cmd === 'areas') {
  doc.areas.forEach((a) => console.log(a.id.padEnd(6) + a.name + '  (' + doc.items.filter((i) => i.area === a.id).length + ' items)'));
} else if (cmd === 'list' || cmd === 'ls') {
  let items = doc.items;
  if (pos[0]) { const a = store.areaOf(doc, pos[0]); if (!a) die('Unknown area ' + pos[0]); items = items.filter((i) => i.area === a.id); }
  if (opt.status) items = items.filter((i) => csv(opt.status).includes(i.status)); else items = items.filter((i) => i.status !== 'done' && i.status !== 'wontdo');
  if (opt.q) items = items.filter((i) => (i.title + ' ' + i.notes).toLowerCase().includes(String(opt.q).toLowerCase()));
  if (opt.tag) items = items.filter((i) => i.tags.includes(opt.tag));
  if (opt.milestone) items = items.filter((i) => i.milestone === opt.milestone);
  const order = { doing: 0, planned: 1, idea: 2, done: 3, wontdo: 4 };
  items.slice().sort((a, b) => order[a.status] - order[b.status]).forEach((i) => console.log(line(i, doc)));
  console.log(items.length + ' items');
} else if (cmd === 'show') {
  console.log(JSON.stringify(need(pos[0]), null, 2));
} else if (cmd === 'add') {
  const title = pos.join(' ').trim();
  if (!title) die('Usage: add "Title" --area feat');
  if (!opt.area) die('--area is required (' + doc.areas.map((a) => a.id).join(', ') + ')');
  const dup = doc.items.find((i) => i.title.toLowerCase() === title.toLowerCase() && i.area === (store.areaOf(doc, opt.area) || {}).id);
  if (dup) die('Already exists: ' + dup.id + ' ' + dup.title);
  const it = store.makeItem(doc, { title, area: opt.area, status: opt.status || 'idea', priority: opt.p, effort: opt.e, tags: csv(opt.tag), source: opt.source,
    notes: opt.notes, milestone: opt.milestone, links: list(opt.link), public: !!opt.public, summary: opt.summary });
  if (!store.STATUSES.includes(it.status)) die('Bad status ' + it.status);
  doc.items.push(it);
  commit('Added ' + it.id + ' (' + it.status + '): ' + it.title);
} else if (['idea', 'plan', 'planned', 'start', 'doing', 'done', 'wontdo'].includes(cmd)) {
  const st = { idea: 'idea', plan: 'planned', planned: 'planned', start: 'doing', doing: 'doing', done: 'done', wontdo: 'wontdo' }[cmd];
  if (!pos.length) die('Usage: ' + cmd + ' <id...>');
  if (st === 'wontdo' && !opt.reason) die('wontdo needs --reason "why"');
  const out = [];
  pos.forEach((ref) => { const it = need(ref); store.setStatus(it, st, { reason: opt.reason }); if (opt.milestone) it.milestone = opt.milestone; out.push(it.id + ' -> ' + st + ': ' + it.title); });
  commit(out.join('\n'));
} else if (cmd === 'set') {
  const it = need(pos.shift());
  if (!pos.length) die('Usage: set <id> field=value ...');
  pos.forEach((kv) => {
    const j = kv.indexOf('='); if (j < 1) die('Bad ' + kv);
    const k = kv.slice(0, j), v = kv.slice(j + 1);
    if (['title', 'notes', 'source', 'milestone', 'summary', 'reason'].includes(k)) it[k] = v;
    else if (k === 'priority') it.priority = v.toUpperCase();
    else if (k === 'effort') it.effort = v.toUpperCase();
    else if (k === 'tags' || k === 'links') it[k] = v.split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === 'public') it.public = /^(1|true|yes|y)$/i.test(v);
    else if (k === 'area') { const a = store.areaOf(doc, v); if (!a) die('Unknown area ' + v); it.area = a.id; }
    else die('Unknown field ' + k);
  });
  it.updated = store.today();
  commit('Updated ' + it.id);
} else if (cmd === 'note') {
  const it = need(pos.shift());
  it.notes = (it.notes ? it.notes + '\n' : '') + pos.join(' ');
  it.updated = store.today();
  commit('Note added to ' + it.id);
} else if (cmd === 'rm' || cmd === 'delete') {
  const it = need(pos[0]);
  if (!opt.yes) die('Add --yes to delete ' + it.id + ' (' + it.title + '). Consider wontdo instead.');
  doc.items.splice(doc.items.indexOf(it), 1);
  commit('Deleted ' + it.id);
} else if (cmd === 'changelog') {
  console.log(store.changelogMd(doc, { milestone: opt.milestone, since: opt.since, by: opt.by }));
} else if (cmd === 'export') {
  const r = store.exportPublic(doc);
  console.log('Wrote ' + r.files.join(', ') + ' to ' + r.dir + ' (' + r.counts.now + ' now, ' + r.counts.next + ' next, ' + r.counts.shipped + ' shipped)');
} else die('Unknown command "' + cmd + '". Try: help');
