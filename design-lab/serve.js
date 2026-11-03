// ScapeLite Design Lab static server. Dev tool, read-only, no dependencies.
//   node design-lab/serve.js [port]        (npm run design-lab)  ->  http://localhost:7790/design-lab/
// The lab page loads the REAL overlay code (overlay/*.js) and the game icons (public/assets/icons), so this serves just those from the repo.
// The dashboard (overlay/status-server.js, port 7777) mounts the same handler under /design-lab/ when this folder exists (dev checkout only).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
// what the lab may read: its own folder, the overlay scripts and screenshots, the game icons, the docs. Nothing else (no config, state or logs).
function resolve(url) {
  let p; try { p = decodeURIComponent(url.split('?')[0]); } catch (e) { return null; }
  if (p === '/' || p === '/design-lab') p = '/design-lab/';
  if (p.endsWith('/')) p += 'index.html';
  if (p.includes('..') || p.includes('\0')) return null;
  const ok = /^\/(design-lab\/[^/].*|overlay\/[a-z0-9-]+\.js|overlay\/catalog-img\/[a-z0-9-]+\.png|assets\/icons\/.+\.png|docs\/[A-Za-z0-9-]+\.md)$/i.test(p);
  if (!ok) return null;
  const file = path.join(ROOT, p === '' ? '' : p.replace(/^\/assets\//, '/public/assets/'));
  return file.startsWith(ROOT) ? file : null;
}
// directory listing of the game icons, so the gallery needs no hand-kept index
function iconIndex() {
  const base = path.join(ROOT, 'public', 'assets', 'icons'), out = {};
  try { fs.readdirSync(base, { withFileTypes: true }).forEach((d) => { if (d.isDirectory()) out[d.name] = fs.readdirSync(path.join(base, d.name)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)); }); } catch (e) { /* no icons */ }
  return out;
}
function handle(req, res, url) {
  if ((url || req.url).split('?')[0] === '/design-lab/api/icons') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(iconIndex())); return true; }
  const file = resolve(url || req.url);
  if (!file) return false;
  const ext = path.extname(file).toLowerCase();
  let buf; try { buf = fs.readFileSync(file); } catch (e) { return false; }
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}
module.exports = { handle, resolve };

if (require.main === module) {
  const port = Number(process.argv[2]) || 7790;
  http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (req.url === '/') { res.writeHead(302, { location: '/design-lab/' }); res.end(); return; }
    if (!handle(req, res)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); }
  }).listen(port, '127.0.0.1', () => console.log('ScapeLite Design Lab: http://localhost:' + port + '/design-lab/'));
}
