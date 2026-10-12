// Copies the shared assets (logo, plugin catalog, screenshots) into website/ so it can be hosted as a plain static site.
//   npm run build-site     then upload the website/ folder to any static host (Cloudflare Pages, Netlify, GitHub Pages...)
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const site = path.join(root, 'website');
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

copy(path.join(root, 'branding', 'logo.svg'), path.join(site, 'assets', 'logo.svg'));
copy(path.join(root, 'branding', 'logo-lockup.svg'), path.join(site, 'assets', 'logo-lockup.svg'));
copy(path.join(root, 'branding', 'png', 'logo-256.png'), path.join(site, 'assets', 'logo-256.png'));
// catalog: public fields only
const cat = JSON.parse(fs.readFileSync(path.join(root, 'overlay', 'catalog.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
cat.authors = Object.fromEntries(Object.entries(cat.authors || {}).map(([k, a]) => [k, { handle: a.handle }])); // never publish contact links from here
cat.version = pkg.version;
fs.writeFileSync(path.join(site, 'catalog.json'), JSON.stringify(cat, null, 1));
const imgDir = path.join(root, 'overlay', 'catalog-img');
if (fs.existsSync(imgDir)) fs.readdirSync(imgDir).forEach((f) => copy(path.join(imgDir, f), path.join(site, 'assets', 'shots', f)));
console.log('website/ updated (v' + pkg.version + ', ' + cat.plugins.length + ' plugins)');
