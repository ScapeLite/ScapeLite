// ScapeLite HP panel (window.__ccHpPanel). DISPLAY-ONLY: shows your hit points in a small panel of its own, as a bar or as an icon with numbers.
// It reads the numbers the game's own HP bar shows (nothing is asked of the game), so it keeps working while the game's bar is hidden.
// Options (Settings > HP Panel, and the panel's right-click menu): style (bar / numbers), width, numbers on the bar, icon, hide the game's own HP bar.
// It is a normal kit panel: drag it by its thin top strip, it keeps its place at the screen edges, fuses with other ScapeLite panels and scales with them.
(function () {
  'use strict';
  const NS = '__ccHpPanel';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }
  const life = window.__ccLife.scope('hp-panel');
  const UI = window.__ccUI;
  if (!UI) return 'cc hp-panel: UI kit not loaded';

  const KEYS = { enabled: 'hpPanelEnabled', style: 'hpPanelStyle', width: 'hpPanelWidth', text: 'hpPanelText', icon: 'hpPanelIcon', hideOrig: 'hpPanelHideOriginal' };
  const DEF = { enabled: false, style: 'bar', width: 200, text: true, icon: true, hideOrig: false };
  const get = (k) => { try { const v = window.__ccPluginSettings.get(KEYS[k]); return v === undefined ? DEF[k] : v; } catch (e) { return DEF[k]; } };
  const put = (k, v) => { try { window.__ccPluginSettings.set(KEYS[k], v); } catch (e) { /* not saved */ } };
  const widthPx = () => Math.max(80, Math.min(600, Math.round(Number(get('width')) || DEF.width)));

  const style = document.createElement('style'); style.id = 'cc-hp-style';
  style.textContent = `
#cc-hp{min-width:0;max-width:none;padding:0}
#cc-hp .hd{height:11px;min-height:0;padding:0;justify-content:center;cursor:grab;border-bottom:0}
#cc-hp .hd b,#cc-hp .hd .chiptxt,#cc-hp .hd button{display:none}
#cc-hp .hd::after{content:"";width:26px;height:3px;border-radius:2px;background:var(--cc-border-strong,#4a4a62);opacity:.7}
#cc-hp .bd{padding:3px 9px 8px;display:flex;flex-direction:row;align-items:center;gap:8px;overflow:visible}
#cc-hp .ic{flex:none;font-size:17px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
#cc-hp .bar{position:relative;flex:1;min-width:0;height:22px;border-radius:7px;background:var(--cc-bg-3,#1c1c28);border:1px solid var(--cc-border,#2e2e42);overflow:hidden}
#cc-hp .bar i{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--hpc,var(--cc-good,#5fe06d));transition:width .25s ease,background-color .25s}
#cc-hp .bar b{position:absolute;inset:0;display:grid;place-items:center;font:700 12.5px/1 var(--cc-font,system-ui);color:#fff;text-shadow:0 0 3px #000,0 0 2px #000;font-variant-numeric:tabular-nums}
#cc-hp .num{font:700 17px/1 var(--cc-font,system-ui);color:var(--hpc,var(--cc-good,#5fe06d));font-variant-numeric:tabular-nums;white-space:nowrap}
#cc-hp[data-st=numbers] .bd{justify-content:center}
#cc-hp[data-st=numbers] .bar{display:none}
#cc-hp[data-st=bar] .num{display:none}
body.cc-hp-orig-hidden :is(#ui-container,#hud-layer)>.hp-bar{display:none !important}
`;
  document.head.appendChild(style);

  const P = UI.panel({ id: 'cc-hp', title: 'Hit points', width: widthPx() });   // first open: the kit's next free spot
  const el = P.el;
  P.body.innerHTML = '<span class="ic" aria-hidden="true">❤️</span><div class="bar" role="progressbar" aria-label="Hit points"><i></i><b></b></div><span class="num"></span>';
  const ic = P.body.querySelector('.ic'), fill = P.body.querySelector('.bar i'), barTxt = P.body.querySelector('.bar b'), num = P.body.querySelector('.num'), bar = P.body.querySelector('.bar');

  // the numbers come from the game's own HP bar text ("88 / 88"), whether or not that bar is visible
  function read() {
    const t = document.querySelector(':is(#ui-container,#hud-layer)>.hp-bar .hp-bar-text, .hp-bar .hp-bar-text'), m = t && /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(t.textContent);
    return m ? { cur: Number(m[1].replace(/,/g, '')), max: Number(m[2].replace(/,/g, '')) } : null;
  }
  const setText = (n, v) => { if (n.textContent !== v) n.textContent = v; };
  let last = '';
  function paint(force) {
    const on = get('enabled') === true;
    document.body.classList.toggle('cc-hp-orig-hidden', on && !!get('hideOrig'));
    const hp = on ? read() : null;
    if (!!hp !== P.isShown()) P.show(!!hp);
    if (!hp) return;
    const w = widthPx(), st = get('style') === 'numbers' ? 'numbers' : 'bar', key = [hp.cur, hp.max, w, st, get('text'), get('icon')].join('|');
    if (!force && key === last) return; last = key;
    const f = hp.max > 0 ? Math.max(0, Math.min(1, hp.cur / hp.max)) : 1, col = f >= 0.5 ? 'var(--cc-good,#5fe06d)' : f >= 0.25 ? 'var(--cc-warn,#ffb21e)' : 'var(--cc-bad,#ff5c4d)';
    if (el.dataset.st !== st) el.dataset.st = st;
    el.style.setProperty('--hpc', col);
    if (st === 'bar') { const px = w + 'px'; if (el.style.width !== px) el.style.width = px; } else if (el.style.width) el.style.width = '';   // numbers: as wide as they are
    fill.style.width = (f * 100).toFixed(1) + '%';
    setText(barTxt, get('text') !== false ? hp.cur + ' / ' + hp.max : '');
    setText(num, hp.cur + ' / ' + hp.max);
    ic.style.display = get('icon') === false ? 'none' : '';
    bar.setAttribute('aria-valuenow', String(hp.cur)); bar.setAttribute('aria-valuemax', String(hp.max));
  }
  life.every(250, () => { try { paint(false); } catch (e) { /* never break the page */ } });
  paint(true);

  // the right-click menu of the panel (ui-scale asks every provider registered here)
  const menuItems = (id) => {
    if (id !== 'cc-hp') return [];
    const st = get('style') === 'numbers' ? 'numbers' : 'bar', again = () => paint(true);
    return [{ head: 'HP display' },
      { label: 'Bar', checked: st === 'bar', onClick: () => { put('style', 'bar'); again(); } },
      { label: 'Numbers with an icon', checked: st === 'numbers', onClick: () => { put('style', 'numbers'); again(); } },
      { label: 'Numbers on the bar', checked: get('text') !== false, keepOpen: true, onClick: () => { put('text', get('text') === false); again(); } },
      { label: 'Heart icon', checked: get('icon') !== false, keepOpen: true, onClick: () => { put('icon', get('icon') === false); again(); } },
      { head: 'Bar width' }, { chips: [120, 160, 200, 260, 340, 460].map((v) => ({ label: String(v), on: widthPx() === v, onClick: () => { put('width', v); again(); } })) },
      { label: 'Hide the game’s own HP bar', checked: !!get('hideOrig'), onClick: () => { put('hideOrig', !get('hideOrig')); again(); } }];
  };
  try { window.__ccUIReg && window.__ccUIReg('cc-hp', { title: 'HP panel', head: '.bd', anchored: true }); } catch (e) { /* ui-scale not there */ }   // right-click anywhere on the panel opens its menu
  const reg = window.__ccPanelMenu && window.__ccPanelMenu.add(menuItems); if (reg) life.add(reg);

  life.add(() => { document.body.classList.remove('cc-hp-orig-hidden'); try { P.destroy(); } catch (e) { /* gone */ } style.remove(); });
  function teardown() { try { life.dispose(); } catch (e) { /* nothing left to undo */ } if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc hp-panel torn down'; }
  window[NS] = { version: 1, teardown, refresh: () => paint(true), menuItems };
  return 'cc hp-panel loaded';
})();
