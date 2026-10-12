// ScapeLite anonymous usage count. Once per day (at most) one tiny request tells a privacy-friendly counter that "a ScapeLite is running",
// so the author can see roughly how many people use it. Sent: the page path /active and the ScapeLite version, plus what every web request carries
// (IP address and browser/OS name; GoatCounter does not store the IP). Never sent: name, character, account, progress, settings, plugin list, webhooks, any id. Off with Settings > Plugins > ScapeLite Core > Share Anonymous Usage Data, or in the first-launch setup.
// Nothing is sent until the first-launch setup has been answered, and nothing at all while SITE below is empty.
(function () {
  'use strict';
  const NS = '__ccUsagePing';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const SITE = 'scapelite'; // GoatCounter site code, e.g. 'scapelite' -> https://scapelite.goatcounter.com. Empty = disabled.
  const LS_DAY = 'cc-usage-day';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('usageStatsEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const setupAnswered = () => { try { return !!localStorage.getItem('cc-setup'); } catch (e) { return false; } };
  const loggedIn = () => { const lf = document.querySelector('#login-form, .login-box, .login-hero'); return !(lf && lf.getClientRects().length); };
  let sent = false;

  async function ping() {
    if (sent || !SITE || !on() || !setupAnswered() || !loggedIn()) return;
    const day = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(LS_DAY) === day) { sent = true; return; } } catch (e) {}
    let ver = '?';
    try { const d = await (await fetch('http://localhost:7777/status')).json(); ver = (d.update && d.update.version) || '?'; } catch (e) {}
    sent = true;
    try { localStorage.setItem(LS_DAY, day); } catch (e) {}
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = 'https://' + SITE + '.goatcounter.com/count?p=' + encodeURIComponent('/active/v' + ver) + '&t=' + encodeURIComponent('ScapeLite active') + '&r=&rnd=' + Date.now();
  }
  const timer = setInterval(ping, 60000);
  setTimeout(ping, 20000);
  function teardown() { clearInterval(timer); if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc usage-ping torn down'; }
  window[NS] = { version: 1, teardown, ping };
  return 'cc usage-ping loaded';
})();
