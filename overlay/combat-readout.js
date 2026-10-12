// ScapeLite Combat Readout: exact numbers for the combat screen. Display only.
// For you and your target: HP and Spirit as numbers on their bars, an attack timer counting down (3 decimals), the unrounded
// attack interval and attacks per second, and your expected DPS (the game's own formula: hit chance x average damage with crits / interval).
// Reads the combat scene through the Game Data Bridge; draws its own small card, drag it anywhere.
(function () {
  'use strict';
  const NS = '__ccCombatReadout';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const LS = 'cc-combat-readout-pos';
  const on = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('combatReadoutEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };

  const style = document.createElement('style');
  style.id = 'cc-combat-readout-style';
  style.textContent = `
#cc-combat-readout{position:fixed;z-index:2147483000;left:50%;top:64px;transform:translateX(-50%);display:none;gap:14px;padding:8px 12px;border-radius:10px;
  background:rgba(14,14,22,.88);border:1px solid rgba(255,255,255,.14);box-shadow:0 4px 16px rgba(0,0,0,.5);font:12px/1.3 system-ui,sans-serif;color:#dcdce8;cursor:grab;user-select:none}
#cc-combat-readout.drag{cursor:grabbing}
#cc-combat-readout .col{width:168px;display:flex;flex-direction:column;gap:4px}
#cc-combat-readout .nm{font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#9a9ab0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cc-combat-readout .bar{position:relative;height:15px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
#cc-combat-readout .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
#cc-combat-readout .bar b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 11px/1 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000,0 0 3px #000;font-variant-numeric:tabular-nums}
#cc-combat-readout .hp i{background:#c0392b}#cc-combat-readout .sp i{background:#7d3c98}#cc-combat-readout .at i{background:#b87a1e}
#cc-combat-readout .sub{display:flex;justify-content:space-between;color:#a8a8bc;font-size:11px;font-variant-numeric:tabular-nums}
#cc-combat-readout .sub strong{color:#f0d890;font-weight:700}
`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'cc-combat-readout';
  document.body.appendChild(el);
  try { const p = JSON.parse(localStorage.getItem(LS) || 'null'); if (p) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.transform = 'none'; } } catch (e) {}

  const f = (n, d) => (Number.isFinite(n) ? n.toFixed(d) : '-');
  const whole = (n) => (Number.isFinite(n) ? String(Math.round(n)) : '-');
  function bar(cls, frac, text) {
    const w = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)) * 100;
    return '<div class="bar ' + cls + '"><i style="width:' + w + '%"></i><b>' + text + '</b></div>';
  }
  function col(title, u, dps) {
    const iv = u.interval > 0 ? u.interval : 0;
    const left = Math.max(0, u.timer || 0);
    const rows = [
      '<div class="nm">' + title + '</div>',
      bar('hp', u.maxHp > 0 ? u.hp / u.maxHp : 0, whole(u.hp) + ' / ' + whole(u.maxHp)),
      u.maxSpirit > 0 ? bar('sp', u.spirit / u.maxSpirit, whole(u.spirit) + ' / ' + whole(u.maxSpirit)) : '',
      iv ? bar('at', 1 - left / iv, f(left, 2) + 's / ' + f(iv, 3) + 's') : '',
      iv ? '<div class="sub"><span>' + f(1 / iv, 3) + ' attacks/s</span>' + (dps != null ? '<span>DPS <strong>' + f(dps, 2) + '</strong></span>' : '') + '</div>' : '',
    ];
    return '<div class="col">' + rows.join('') + '</div>';
  }

  let lastHtml = '';
  function tick() {
    const b = window.__ccBridge;
    const enc = document.querySelector('.combat-encounter');
    const shown = !!(enc && enc.getClientRects().length && getComputedStyle(enc).display !== 'none');
    const d = on() && shown && b && b.combat ? b.combat() : null;
    if (!d) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    const alive = d.mobs.filter((m) => m.alive);
    const mob = d.selected >= 0 && d.mobs[d.selected] ? d.mobs[d.selected] : alive[0] || d.mobs[0];
    const html = col('You', d.player, d.dps) + (mob && !d.raid ? col(mob.name || 'Target', mob, null) : '');
    if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
    if (el.style.display !== 'flex') el.style.display = 'flex';
  }
  const timer = setInterval(tick, 100);

  // Drag the card anywhere; the spot is remembered.
  let drag = null;
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.classList.add('drag');
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!drag) return;
    el.style.transform = 'none';
    el.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - drag.dx)) + 'px';
    el.style.top = Math.max(0, Math.min(innerHeight - 30, e.clientY - drag.dy)) + 'px';
  };
  const onUp = () => {
    if (!drag) return;
    drag = null; el.classList.remove('drag');
    try { const r = el.getBoundingClientRect(); localStorage.setItem(LS, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) {}
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);

  function teardown() {
    clearInterval(timer);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    el.remove(); style.remove();
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc combat-readout torn down';
  }
  window[NS] = { version: 1, teardown };
  return 'cc combat-readout loaded';
})();
