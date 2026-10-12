// Author credits for the marketplace and the Plugins tab. Public info lives in
// catalog.json ("authors"); contact links (Discord, GitHub, issue trackers, ...)
// are deliberately NOT committed: put them in overlay/authors.local.json
// (git-ignored, see authors.local.example.json) and they are merged in at runtime.
'use strict';
const fs = require('fs');
const path = require('path');

function loadAuthors() {
  let authors = {};
  try { authors = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).authors || {}; } catch (e) { authors = {}; }
  try {
    const local = JSON.parse(fs.readFileSync(require('./paths').state('authors.local.json'), 'utf8')).authors || {};
    for (const [k, v] of Object.entries(local)) authors[k] = Object.assign({}, authors[k], v);
  } catch (e) { /* no local overrides */ }
  return authors;
}
module.exports = { loadAuthors };
