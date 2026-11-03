// ScapeLite Material Shortage Warning. Display only: warns when the running task or a queued one will probably run out of
// materials, before the game falls back to scrap (a big loss of time and XP).
// Your chance to save materials is counted at HALF: with 10% saves, 100 bars are expected to need 95 ores, not 90, so bad luck
// does not leave you short. Earlier tasks in the queue use up materials first, so two tasks that need the same ore are not both
// counted against the same stock.
//   red    = you hold less than the cautious estimate: expect to run out (the missing amount is shown)
//   yellow = you hold enough only if your saves come in: it needs some luck
// The panel only appears when there is something to warn about. Nothing is moved, crafted or changed.
(function () {
  'use strict';
  const NS = '__ccMaterialShortage';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS_POS = 'cc-matshort-pos';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('materialShortageEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const bridge = () => { const b = window.__ccBridge; return b && b.shortages ? b : null; };

  // The chrome (header, drag, position and collapse memory, scale, layering) comes from the UI kit.
  const UI = window.__ccUI;
  if (!UI) return 'cc material-shortage: UI kit not loaded';
  const P = UI.panel({ id: 'cc-matshort', title: 'Materials', width: 300, collapsible: true, pos: 'topcenter', legacyPosKey: LS_POS });
  const el = P.el;

  const esc = (s) => String(s).replace(/[<>&]/g, '');
  const nice = (id) => esc(String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  let lastOut = [], lastHtml = '';
  function render() {
    const b = bridge();
    if (!on() || !b) { P.show(false); return; }
    const credit = Math.max(0, Math.min(1, setting('materialShortageSaveCredit', 50) / 100)); // share of the save chance that is counted
    const list = b.shortages(credit) || [];
    const rows = [];
    list.forEach((r) => {
      const expected = r.need * (1 - r.save * credit);      // cautious estimate of what the task really uses
      if (r.have >= r.need) return;                         // enough even with no saves
      const red = r.have < expected;
      rows.push({ r, red, expected, missing: Math.ceil(expected - r.have) });
    });
    lastOut = rows;
    if (!rows.length) { P.show(false); return; }
    P.show(true);
    P.setChip(rows.filter((e) => e.red).length + ' short' + (rows.some((e) => !e.red) ? ', ' + rows.filter((e) => !e.red).length + ' risky' : ''));
    const html = rows.map((e) => {
      const r = e.r, where = r.where === 'now' ? 'Current task' : 'Queue slot ' + r.where;
      return '<div class="cc-row nolf" data-tone="' + (e.red ? 'bad' : 'warn') + '"><div class="ti">' + where + ': ' + nice(r.act) + '<i>(' + r.remaining + ')</i></div>' +
        '<div class="su">' + (e.red ? 'Short by about <b>' + e.missing + '</b> ' + esc(r.inputName) : 'Needs some luck on saves: ' + esc(r.inputName)) + '</div>' +
        '<div class="su">Have ' + Math.floor(r.have) + ' · needs ' + r.need + ' without saves, ~' + Math.ceil(e.expected) + ' counting ' + Math.round(r.save * credit * 100) + '% saved' +
        (e.red && r.scrap ? ' · ' + nice(r.scrap) + ' would be used' : '') + '</div></div>';
    }).join('');
    if (html !== lastHtml) { lastHtml = html; P.body.innerHTML = html; }   // only touch the page when something changed
  }
  const timer = setInterval(() => { try { if (!(document.hidden || window.__ccEcoOn)) render(); } catch (e) { /* keep ticking */ } }, 3000);
  function teardown() {
    clearInterval(timer);
    P.destroy();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc material-shortage torn down';
  }
  window[NS] = { version: 1, teardown, render, get last() { return lastOut; } };
  return 'cc material-shortage loaded';
})();
