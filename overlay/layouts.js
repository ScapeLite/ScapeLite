// ScapeLite layout presets. DISPLAY-ONLY: saves and restores where your panels, docks, windows and trackers sit
// (positions, sizes, fuses, locks) as named presets, e.g. "Questing", "Raid", "Clean". Loading a preset writes the
// saved values back and reloads the game page, because the game reads its own panel positions when it starts.
// Presets live in this browser profile (localStorage cc-layouts); nothing is sent anywhere.
(function () {
  'use strict';
  const NS = '__ccLayouts';
  const LS = 'cc-layouts';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}

  // Layout keys only -- never progress, chat or cached data.
  const KEYS = ['scapewatch_panel_windows', 'scapewatch_dashboard_pos', 'cc-panel-scale-v2', 'cc-panel-origins', 'cc-panel-locks', 'cc-panel-fuse', 'cc-menu-dock', 'cc-wc-dock',
    'cc-notif-pos', 'cc-xp-tracker-pos', 'cc-route-panel-pos', 'cc-route-panel-size', 'cc-route-map-open', 'cc-modal-scale', 'cc-modal-float', 'cc-walk-panel-layout', 'cc-ct-collapsed', 'cc-uq-insert-hidden'];
  const read = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
  const write = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} };
  function snapshot() { const d = {}; KEYS.forEach((k) => { try { const v = localStorage.getItem(k); if (v != null) d[k] = v; } catch (e) {} }); return d; }
  function apply(data) {
    KEYS.forEach((k) => { try { if (data && data[k] != null) localStorage.setItem(k, data[k]); else localStorage.removeItem(k); } catch (e) {} });
    setTimeout(() => location.reload(), 150);
  }

  const style = document.createElement('style');
  style.id = 'cc-layouts-style';
  style.textContent = `
#cc-layouts{position:fixed;left:50%;top:14%;transform:translateX(-50%);width:400px;max-height:70vh;z-index:100010;display:none;flex-direction:column;background:#0f0f14;border:1px solid rgba(255,255,255,.18);
  border-radius:10px;color:#ddd;font:13px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.65);overflow:hidden}
#cc-layouts.show{display:flex}
#cc-layouts .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#17171f;border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none}
#cc-layouts .hd b{font-weight:600;color:#fff;font-size:14px}
#cc-layouts .hd .sp{flex:1}
#cc-layouts button{font:inherit;color:#ddd;background:#22222c;border:1px solid #3a3a48;border-radius:6px;padding:2px 10px;cursor:pointer}
#cc-layouts button:hover{border-color:#80808f}
#cc-layouts button.pri{border-color:#b8962f;color:#ffd24a}
#cc-layouts button.dng:hover{border-color:#e0675a;color:#ff8a7a}
#cc-layouts .bd{padding:10px 12px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
#cc-layouts .row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #2a2a38;border-radius:8px;background:#15151c}
#cc-layouts .row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#cc-layouts .row small{color:#8a8a96}
#cc-layouts .add{display:flex;gap:6px}
#cc-layouts input{flex:1;font:inherit;color:#fff;background:#1b1b24;border:1px solid #3a3a48;border-radius:6px;padding:4px 8px}
#cc-layouts .note{color:#8a8a96;font-size:11.5px}`;
  const root = document.createElement('div');
  root.id = 'cc-layouts';

  function render() {
    const presets = read();
    root.textContent = '';
    const hd = document.createElement('div'); hd.className = 'hd';
    hd.innerHTML = '<b>Layouts</b><span class="sp"></span>';
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'Close'; x.addEventListener('click', () => root.classList.remove('show')); hd.appendChild(x);
    root.appendChild(hd);
    const bd = document.createElement('div'); bd.className = 'bd';
    const add = document.createElement('div'); add.className = 'add';
    const inp = document.createElement('input'); inp.placeholder = 'Name this layout (e.g. Questing)'; inp.maxLength = 30;
    const sv = document.createElement('button'); sv.className = 'pri'; sv.textContent = 'Save current';
    const doSave = () => { const n = inp.value.trim(); if (!n) { inp.focus(); return; } const p = read(); p[n] = { at: Date.now(), data: snapshot() }; write(p); render(); };
    sv.addEventListener('click', doSave); inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') doSave(); });
    ['keyup', 'keypress'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
    add.append(inp, sv); bd.appendChild(add);
    const names = Object.keys(presets).sort((a, b) => presets[b].at - presets[a].at);
    if (!names.length) { const n = document.createElement('div'); n.className = 'note'; n.textContent = 'No saved layouts yet. Arrange your panels, windows and docks the way you like, then save them here.'; bd.appendChild(n); }
    names.forEach((n) => {
      const row = document.createElement('div'); row.className = 'row';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n;
      const dt = document.createElement('small'); dt.textContent = new Date(presets[n].at).toLocaleDateString();
      const ld = document.createElement('button'); ld.textContent = 'Load'; ld.title = 'Apply this layout (reloads the game page)';
      ld.addEventListener('click', () => { ld.textContent = 'Reloading…'; apply(presets[n].data); });
      const ow = document.createElement('button'); ow.textContent = 'Update'; ow.title = 'Replace this layout with how things are now';
      ow.addEventListener('click', () => { const p = read(); p[n] = { at: Date.now(), data: snapshot() }; write(p); render(); });
      const del = document.createElement('button'); del.className = 'dng'; del.textContent = '×'; del.title = 'Delete this layout';
      del.addEventListener('click', () => { const p = read(); delete p[n]; write(p); render(); });
      row.append(nm, dt, ld, ow, del); bd.appendChild(row);
    });
    const rs = document.createElement('div'); rs.className = 'row';
    const rn = document.createElement('span'); rn.className = 'nm'; rn.innerHTML = 'Game default <small>(reset all positions and sizes)</small>';
    const rb = document.createElement('button'); rb.className = 'dng'; rb.textContent = 'Reset'; rb.addEventListener('click', () => { if (confirm('Reset every panel position and size to the game default and reload?')) { rb.textContent = 'Reloading…'; apply(null); } });
    rs.append(rn, rb); bd.appendChild(rs);
    const note = document.createElement('div'); note.className = 'note'; note.textContent = 'A layout covers panel positions, sizes, fuses, locks, the docks, notification positions, trackers and window sizes. Loading one reloads the game page. Layouts are stored in this browser profile only.';
    bd.appendChild(note);
    root.appendChild(bd);
    // drag by the header
    hd.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return; e.preventDefault();
      const r = root.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      root.style.transform = 'none'; root.style.left = r.left + 'px'; root.style.top = r.top + 'px';
      const mv = (ev) => { root.style.left = Math.max(40 - r.width, Math.min(innerWidth - 40, r.left + ev.clientX - sx)) + 'px'; root.style.top = Math.max(0, Math.min(innerHeight - 30, r.top + ev.clientY - sy)) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }
  ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));
  function open() { if (!document.head) return; if (!style.isConnected) document.head.appendChild(style); if (!root.isConnected) document.body.appendChild(root); render(); root.classList.add('show'); }
  function teardown() { root.remove(); style.remove(); if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc layouts torn down'; }
  window[NS] = { version: 1, teardown, open, snapshot, get presets() { return read(); } };
  console.log('[cc] layouts loaded');
  return 'cc layouts loaded';
})();
