// Design Lab: stand-in for the plugin settings store (window.__ccPluginSettings). The real one lives in overlay/plugins-settings-ui.js and needs the game's
// Settings page. Unknown keys return undefined, so every plugin falls back to its own default, exactly as on a fresh install.
(function () {
  'use strict';
  const vals = (window.__labSettings = window.__labSettings || {});
  window.__ccPluginSettings = {
    get: (k) => (Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : undefined),
    set: (k, v) => { vals[k] = v; },
    getAll: () => Object.assign({}, vals),
    seed: () => {},
    teardown: () => {},
  };
})();
