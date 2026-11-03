// Size-based rotation for the plain-text watcher log: when the file passes `maxBytes` it becomes `<name>.1.log` (replacing the previous
// backup) and a fresh file starts, so the log never grows past about twice the limit. Best effort: a failure leaves the log as it is.
'use strict';

const fs = require('fs');

function backupName(file) { return file.replace(/\.log$/, '') + '.1.log'; }

// Returns true when it rotated. Cheap enough to call every few hundred writes (one stat).
function rotateIfBig(file, maxBytes) {
  try {
    if (fs.statSync(file).size <= maxBytes) return false;
    const old = backupName(file);
    try { fs.unlinkSync(old); } catch (e) { /* no backup yet */ }
    fs.renameSync(file, old);
    return true;
  } catch (e) { return false; }
}

module.exports = { rotateIfBig, backupName };
