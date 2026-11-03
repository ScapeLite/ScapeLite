// ScapeLite roadmap: HTTP handler. Mounted by overlay/status-server.js (dev checkout only: roadmap/ is not shipped in the installer)
// and runnable alone:  node roadmap/server.js [port]   ->  http://localhost:7791/roadmap
//   GET  /roadmap                     the page (roadmap/index.html)
//   GET  /api/roadmap                 the document {rev, areas, milestones, items, ...}
//   PUT  /api/roadmap                 save the whole document (body = document; its `rev` must match the file, else 409)
//   GET  /api/roadmap/history         saved versions;  POST /api/roadmap/restore {file}  loads one back as a new version
//   POST /api/roadmap/export          writes roadmap/public/roadmap.json + roadmap.html (public items only)
//   GET  /api/roadmap/changelog?milestone=&by=date|milestone   markdown release notes from done items
// Writes need the header  x-cc-control: 1  and a same-site Origin (like the dashboard's other POST routes).
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const store = require('./store');

const LIMIT = 4 * 1024 * 1024;
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((resolve) => {
    let b = '', n = 0;
    req.on('data', (c) => { n += c.length; if (n > LIMIT) { req.destroy(); resolve(null); } else b += c; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function sameSite(req, hosts) {
  const o = req.headers.origin;
  if (req.headers['x-cc-control'] !== '1') return false;
  if (!o) return true;
  try { const u = new URL(o); return u.protocol === 'http:' && (!hosts || hosts.has(u.host.toLowerCase())); } catch (e) { return false; }
}

// returns true when it handled the request
async function handle(req, res, url, hosts) {
  url = (url || req.url || '/').split('?')[0];
  const m = req.method;
  if (url === '/roadmap' || url === '/roadmap/') {
    if (m !== 'GET' && m !== 'HEAD') return false;
    let html; try { html = fs.readFileSync(path.join(__dirname, 'index.html')); } catch (e) { res.writeHead(404); res.end('roadmap/index.html missing'); return true; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }); res.end(m === 'HEAD' ? undefined : html); return true;
  }
  if (!url.startsWith('/api/roadmap')) return false;
  try {
    if (m === 'GET' && url === '/api/roadmap') { json(res, 200, store.load()); return true; }
    if (m === 'GET' && url === '/api/roadmap/history') { json(res, 200, { versions: store.history() }); return true; }
    if (m === 'GET' && url === '/api/roadmap/changelog') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(store.changelogMd(store.load(), { milestone: q.get('milestone') || '', since: q.get('since') || '', by: q.get('by') || '' })); return true;
    }
    if (m === 'PUT' && url === '/api/roadmap') {
      if (!sameSite(req, hosts)) { json(res, 403, { ok: false, error: 'forbidden' }); return true; }
      const doc = await body(req);
      if (!doc) { json(res, 400, { ok: false, error: 'bad body' }); return true; }
      const rev = doc.rev;
      try { const saved = store.save(doc, typeof rev === 'number' ? rev : null); json(res, 200, { ok: true, rev: saved.rev, updated: saved.updated }); }
      catch (e) { if (e.code === 'conflict') json(res, 409, { ok: false, error: 'conflict', rev: e.rev }); else json(res, 400, { ok: false, error: String(e.message || e) }); }
      return true;
    }
    if (m === 'POST' && url === '/api/roadmap/export') {
      if (!sameSite(req, hosts)) { json(res, 403, { ok: false, error: 'forbidden' }); return true; }
      const r = store.exportPublic(store.load()); json(res, 200, Object.assign({ ok: true }, r)); return true;
    }
    if (m === 'POST' && url === '/api/roadmap/restore') {
      if (!sameSite(req, hosts)) { json(res, 403, { ok: false, error: 'forbidden' }); return true; }
      const b = await body(req);
      if (!b || typeof b.file !== 'string') { json(res, 400, { ok: false, error: 'bad body' }); return true; }
      const old = store.readHistory(b.file), saved = store.save(old, null); json(res, 200, { ok: true, rev: saved.rev }); return true;
    }
  } catch (e) { json(res, 500, { ok: false, error: String(e.message || e) }); return true; }
  json(res, 405, { ok: false, error: 'method not allowed' });
  return true;
}
module.exports = { handle };

if (require.main === module) {
  const port = Number(process.argv[2]) || 7791;
  const hosts = new Set(['localhost:' + port, '127.0.0.1:' + port]);
  http.createServer((req, res) => {
    if (!hosts.has(String(req.headers.host || '').toLowerCase())) { res.writeHead(403); res.end('Forbidden host'); return; }
    if (req.url === '/logo.svg') { try { const b = fs.readFileSync(path.join(__dirname, '..', 'branding', 'logo.svg')); res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(b); } catch (e) { res.writeHead(404); res.end(); } return; }
    if (req.url === '/') { res.writeHead(302, { location: '/roadmap' }); res.end(); return; }
    handle(req, res, req.url, hosts).then((ok) => { if (!ok) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); } });
  }).listen(port, '127.0.0.1', () => console.log('ScapeLite Roadmap: http://localhost:' + port + '/roadmap'));
}
