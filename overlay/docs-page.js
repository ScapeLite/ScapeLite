// Renders a few of the project's Markdown docs as styled pages for the dashboard (GET /docs/<name>). Tiny converter:
// headings, paragraphs, lists, fenced code, tables, bold/italic/inline code, links. Whitelisted files only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DOCS = { 'plugin-author-guide': 'PLUGIN-AUTHOR-GUIDE.md', 'submit-a-plugin': 'SUBMIT-A-PLUGIN.md', 'plugins': 'PLUGINS.md' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
    const d = u.match(/(?:^|\/)([A-Z-]+)\.md$/i);
    const key = d && Object.keys(DOCS).find((k) => DOCS[k].toLowerCase() === (d[1] + '.md').toLowerCase());
    return '<a href="' + (key ? '/docs/' + key : u) + '"' + (/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>';
  });
  return s;
}
function md(text) {
  const out = [], lines = text.replace(/\r/g, '').split('\n');
  let i = 0, list = null;
  const endList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { endList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { endList(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      endList(); const head = l.split('|').slice(1, -1); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].split('|').slice(1, -1));
      out.push('<table><tr>' + head.map((c) => '<th>' + inline(c.trim()) + '</th>').join('') + '</tr>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c.trim()) + '</td>').join('') + '</tr>').join('') + '</table>'); continue;
    }
    if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { if (list !== 'ul') { endList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); i++; continue; }
    if ((m = l.match(/^\s*\d+\.\s+(.*)$/))) { if (list !== 'ol') { endList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); i++; continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { endList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); i++; continue; }
    if (/^---+$/.test(l.trim())) { endList(); out.push('<hr>'); i++; continue; }
    if (!l.trim()) { endList(); i++; continue; }
    endList(); const buf = [l]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s|>|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  endList();
  return out.join('\n');
}
function page(name) {
  const file = DOCS[name];
  if (!file) return null;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, 'docs', file), 'utf8'); } catch (e) { return null; }
  const title = (text.match(/^#\s+(.*)$/m) || [0, 'Guide'])[1];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' - ScapeLite</title><link rel="icon" type="image/svg+xml" href="/logo.svg"><style>' +
    ':root{--bg:#0e0e13;--card:#16161e;--line:#2a2a38;--txt:#e4e4ec;--dim:#9a9aae;--gold:#ffd24a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.65 system-ui,Segoe UI,sans-serif}' +
    'header{display:flex;align-items:center;gap:14px;padding:12px 22px;border-bottom:1px solid var(--line);background:rgba(14,14,19,.94);position:sticky;top:0}header a{color:var(--dim);text-decoration:none;font-size:13px}header a:hover{color:var(--txt)}header img{height:30px}' +
    'main{max-width:820px;margin:0 auto;padding:28px 22px 80px}h1{font-size:30px;margin:.2em 0 .6em}h2{font-size:21px;margin:1.8em 0 .5em;padding-top:.4em;border-top:1px solid var(--line)}h3{font-size:17px;margin:1.4em 0 .4em}' +
    'p,li{color:#cfcfdb}a{color:#7fb4ff}code{background:#0b0b10;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font:13px ui-monospace,Consolas,monospace;color:#9ecbff}pre{background:#0b0b10;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto}pre code{border:0;padding:0;background:none}' +
    'blockquote{margin:1em 0;padding:8px 14px;border-left:3px solid var(--gold);background:rgba(255,210,74,.07);border-radius:0 8px 8px 0}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid var(--line);padding:6px 12px}th{background:var(--card)}hr{border:0;border-top:1px solid var(--line)}' +
    '</style></head><body><header><a href="/marketplace"><img src="/logo-lockup.svg" alt="ScapeLite"></a><a href="/marketplace">&larr; Plugins</a><a href="/docs/plugin-author-guide">Author guide</a><a href="/docs/submit-a-plugin">Submit a plugin</a></header><main>' + md(text) + '</main></body></html>';
}
module.exports = { page };
