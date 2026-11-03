// Design Lab: Design tokens / CSS constants sheet. Scans every stylesheet on the page (the real kit + the harvested plugin CSS), lists every custom property
// with its live value, and lets you edit one: the edit is an override rule, so every specimen updates instantly. Nothing is written to overlay/*.js.
(function () {
  'use strict';
  const { h } = window.Lab;
  const GROUPS = [
    ['Colour roles', (t) => t.kind === 'colour'],
    ['Colour triplets (r,g,b)', (t) => t.kind === 'rgb'],
    ['Spacing and size', (t) => /^--(cc-sp|cc-gap|cc-pad|cc-row|cc-cell|cc-bar|cc-pill|cc-tile|cc-prog|cc-wd|u\b|s\b)/.test(t.name) || /^--q-(?!c|bg)/.test(t.name) && t.kind === 'length'],
    ['Type', (t) => /(^--cc-fs|font)/.test(t.name)],
    ['Radii and shadows', (t) => /(^--cc-r\b|^--cc-r-|shadow|^--cc-sh)/.test(t.name)],
    ['Motion', (t) => /(dur|ease)/.test(t.name)],
    ['Z-index layers', (t) => /(^--cc-z|z-)/.test(t.name)],
  ];
  const isColour = (v) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color-mix\(|var\(--[\w-]*(bg|text|border|good|warn|bad|info|magic|accent|kill|sunk|scrim|c|col)[\w-]*\))/i.test(v.trim());
  const isTriplet = (v) => /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(v);
  const isLen = (v) => /^-?[\d.]+(px|em|rem|%|vh|vw)?$/.test(v.trim());

  function walk(rules, src, ctx, out) {
    for (const r of rules) {
      if (r.type === 1 && r.style) {
        for (let i = 0; i < r.style.length; i++) {
          const p = r.style[i];
          if (p.startsWith('--')) out.vars.push({ name: p, value: r.style.getPropertyValue(p).trim(), selector: r.selectorText, src, media: ctx });
        }
        const z = r.style.getPropertyValue('z-index'); if (z) out.z.push({ selector: r.selectorText, value: z.trim(), src });
        ['transition-duration', 'animation-duration'].forEach((k) => { const v = r.style.getPropertyValue(k); if (v) out.dur.push({ selector: r.selectorText, value: v.trim(), src }); });
        const fs = r.style.getPropertyValue('font-size'); if (fs) out.fs.push({ selector: r.selectorText, value: fs.trim(), src });
        const br = r.style.getPropertyValue('border-radius'); if (br) out.br.push({ selector: r.selectorText, value: br.trim(), src });
      } else if (r.cssRules && (r.type === 4 || r.type === 12)) walk(r.cssRules, src, r.conditionText || (r.media && r.media.mediaText) || '', out);
    }
  }
  function scan() {
    const out = { vars: [], z: [], dur: [], fs: [], br: [] };
    Array.from(document.styleSheets).forEach((ss) => {
      const o = ss.ownerNode; if (!o || o.id === 'lab-overrides' || !(o.dataset && o.dataset.labSrc)) return;
      try { walk(ss.cssRules, o.dataset.labSrc, '', out); } catch (e) { /* cross-origin sheet */ }
    });
    out.vars.forEach((t) => { t.kind = isTriplet(t.value) ? 'rgb' : isColour(t.value) ? 'colour' : isLen(t.value) ? 'length' : 'other'; });
    return out;
  }

  // ---- overrides: one <style> with `selector{--x:val !important}`
  const ov = new Map();   // key selector||name -> {selector,name,value}
  const ovKey = (t) => t.selector + '||' + t.name;
  function applyOverrides() {
    let st = document.getElementById('lab-overrides'); if (!st) { st = h('style#lab-overrides'); st.dataset.labSrc = 'lab (edits)'; document.head.appendChild(st); }
    st.textContent = [...ov.values()].map((o) => o.selector + '{' + o.name + ':' + o.value + ' !important}').join('\n');
  }
  function liveValue(t) {
    const sel = t.selector.split(',')[0].trim(); let el = null;
    if (/^(:root|html)/.test(sel)) el = document.documentElement; else { try { el = document.querySelector(sel); } catch (e) { el = null; } }
    return el ? getComputedStyle(el).getPropertyValue(t.name).trim() : '';
  }
  function swatch(t, live) {
    const v = t.kind === 'rgb' ? 'rgb(' + (live || t.value) + ')' : (live || t.value);
    return h('span.lab-sw', null, h('i', { style: { background: v } }));
  }
  function table(rows, onEdit) {
    const t = h('table.lab-tok', null, h('thead', null, h('tr', null, ['', 'Property', 'Value (edit)', 'Live', 'Where', 'File'].map((x) => h('th', null, x)))));
    const tb = h('tbody'); t.appendChild(tb);
    rows.forEach((r) => {
      const key = ovKey(r), cur = ov.get(key), inp = h('input.v', { value: cur ? cur.value : r.value, spellcheck: 'false' }), live = h('code'), sw = h('td'), tr = h('tr', { class: cur ? 'mod' : '' });
      const refresh = () => { const l = liveValue(r); live.textContent = l; sw.replaceChildren(r.kind === 'colour' || r.kind === 'rgb' ? swatch(r, l) : ''); };
      const set = (v) => { if (v === r.value || v === '') ov.delete(key); else ov.set(key, { selector: r.selector, name: r.name, value: v }); tr.classList.toggle('mod', ov.has(key)); applyOverrides(); refresh(); onEdit && onEdit(); };
      inp.addEventListener('input', () => set(inp.value.trim()));
      const rs = h('span.rs', { title: 'Reset', onclick() { inp.value = r.value; set(r.value); } }, 'reset');
      tr.append(sw, h('td', null, h('code', null, r.name)), h('td', null, inp, rs), h('td', null, live), h('td', null, h('code', { title: r.selector }, r.selector.length > 38 ? r.selector.slice(0, 36) + '..' : r.selector + (r.media ? ' @' + r.media : ''))), h('td', null, h('code', null, r.src)));
      refresh(); tb.appendChild(tr);
    });
    return t;
  }
  function simpleList(title, rows, hint) {
    const box = h('div');
    box.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, title), h('span', null, rows.length + (hint ? ' ' + hint : ''))));
    const t = h('table.lab-tok', null, h('thead', null, h('tr', null, ['Value', 'Selector', 'File'].map((x) => h('th', null, x)))));
    const tb = h('tbody'); t.appendChild(tb);
    rows.forEach((r) => tb.appendChild(h('tr', null, h('td', null, h('code', null, r.value)), h('td', null, h('code', null, r.selector.length > 90 ? r.selector.slice(0, 88) + '..' : r.selector)), h('td', null, h('code', null, r.src)))));
    box.appendChild(t); return box;
  }
  const uniqCount = (rows) => { const m = new Map(); rows.forEach((r) => { const e = m.get(r.value) || { value: r.value, n: 0, selector: r.selector, src: r.src }; e.n++; m.set(r.value, e); }); return [...m.values()].sort((a, b) => b.n - a.n).map((e) => ({ value: e.value + '  (x' + e.n + ')', selector: e.selector, src: e.src })); };

  window.Lab.tokenIndex = function () { const s = scan(); return s.vars; };
  window.Lab.views['Design tokens'] = (c) => {
    const data = scan(), q = document.getElementById('lab-q').value.trim().toLowerCase();
    const filt = (r) => !q || (r.name + ' ' + r.value + ' ' + r.selector + ' ' + r.src).toLowerCase().includes(q);
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Design tokens and CSS constants'), h('span', null, data.vars.length + ' custom properties, scanned live from the real stylesheets')));
    c.appendChild(h('p.lab-lead', null, 'Edit any value and every specimen updates at once (an override rule, never written to the source). Rows with a green tint are edited. Use the search box to filter. To make an edit permanent, change it in the file named in the last column.'));
    const bar = h('div', { style: { display: 'flex', gap: '8px', margin: '0 0 14px', flexWrap: 'wrap' } });
    const count = h('span', { style: { color: 'var(--lab-dim)', alignSelf: 'center' } });
    const upd = () => { count.textContent = ov.size ? ov.size + ' edited' : 'no edits'; };
    bar.append(
      h('button.lab-btn', { onclick() { ov.clear(); applyOverrides(); window.Lab.go('Design tokens'); } }, 'Reset all edits'),
      h('button.lab-btn', { onclick() { window.Lab.copy([...ov.values()].map((o) => o.selector + ' { ' + o.name + ': ' + o.value + '; }').join('\n') || '/* no edits */'); } }, 'Copy edits as CSS'), count);
    upd(); c.appendChild(bar);
    const rows = data.vars.filter(filt), used = new Set(), seenKey = new Set();
    const uniq = rows.filter((r) => { const k = ovKey(r); if (seenKey.has(k)) return false; seenKey.add(k); return true; });
    GROUPS.forEach(([title, test]) => {
      const list = uniq.filter((t) => !used.has(t) && test(t)); list.forEach((t) => used.add(t));
      if (!list.length) return;
      c.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, title), h('span', null, list.length)));
      c.appendChild(table(list, upd));
    });
    const rest = uniq.filter((t) => !used.has(t));
    const byFile = {}; rest.forEach((t) => (byFile[t.src] = byFile[t.src] || []).push(t));
    Object.keys(byFile).sort().forEach((f) => { c.appendChild(h('div.lab-cat', null, h('h2', { style: { fontSize: '15px' } }, 'Component-scoped: ' + f), h('span', null, byFile[f].length))); c.appendChild(table(byFile[f], upd)); });
    c.appendChild(h('div.lab-cat', null, h('h2', null, 'Constants that are not custom properties'), h('span', null, 'read from the same stylesheets')));
    const zs = data.z.filter(filt).map((r) => ({ r, n: parseInt(r.value, 10) })).sort((a, b) => b.n - a.n).map((x) => x.r);
    c.appendChild(simpleList('z-index layers (highest first)', zs, 'declarations'));
    c.appendChild(simpleList('Font sizes in use', uniqCount(data.fs.filter(filt)).slice(0, 60), 'distinct'));
    c.appendChild(simpleList('Border radii in use', uniqCount(data.br.filter(filt)).slice(0, 40), 'distinct'));
    c.appendChild(simpleList('Transition and animation durations', uniqCount(data.dur.filter(filt)), 'distinct'));
    c.appendChild(h('p.lab-note-inline', null, 'Panel scale and width classes are code, not CSS: --s comes from the panel width (full >= 340 px: clamp(.9, w/450, 1.5); compact 180-339 px; micro < 180 px), see ccScale() in overlay/ui-kit.js. The Scenario panel’s UI scale is the user’s Panel Size setting.'));
  };
})();
