// Design Lab specimens: info bars, alerts, menus, docks, handles, grips and fuse links (overlay/ui-bar.js, alert-bell.js, raid-alert.js, status-indicator.js,
// scapelite-menu.js, settings-nav.js, sidebar-tabs.js, window-dock.js, menu-dock.js, notif-dock.js, modal-resize.js, panel-resize.js, ui-scale.js, panel-fuse.js,
// card-fuse.js, queue-walk.js). Every specimen copies the real DOM and class names of the production builders and is filled with mock data; the CSS is the harvested
// production CSS. The only CSS in this file (#lab-spec-bars) is for stand-ins of the GAME's own elements (side buttons, title bars, windows) and for the few
// stylesheets that production code creates lazily and the harvest therefore cannot see (listed in the comments there). It never restyles a ScapeLite class.
(function () {
  'use strict';
  const Lab = window.Lab;
  if (!Lab || !Lab.add) return;
  const h = Lab.h, IB = Lab.iconBase;

  // ------------------------------------------------------------------ lab-only CSS
  const LAB_CSS = `
/* ---- production CSS that is created lazily (so the harvest cannot see it): copied declarations ---- */
/* raid-alert.js toast(): the <style> is only built when the first lobby alert fires */
#cc-raid-toast{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:99990;max-width:560px;padding:9px 16px;border-radius:9px;background:#17171f;border:1px solid #ffd24a;color:#fff;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);cursor:pointer}
#cc-raid-toast small{display:block;font-weight:400;color:#bdbdca;margin-top:2px}
/* panel-resize.js is not part of the harvest (its stylesheet is built at runtime): copied declarations of the handle, label, badges, lock button, title-bar menu and snap guides (HANDLE = 14 px) */
.cc-ps-handle{position:fixed;left:0;top:0;width:14px;height:14px;z-index:99990;box-sizing:border-box;cursor:nwse-resize;background:transparent;border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);border-radius:0 0 6px 0;touch-action:none;user-select:none}
.cc-ps-handle.cc-ps-bl{cursor:nesw-resize;border-right:0;border-left:2px solid rgba(255,255,255,.35);border-radius:0 0 0 6px}
.cc-ps-handle.cc-ps-bl:hover,.cc-ps-handle.cc-ps-bl.cc-ps-drag{border-left-color:rgba(255,255,255,.7)}
.cc-ps-handle.cc-ps-bl .cc-ps-label{right:auto;left:18px}
.cc-ps-handle:hover,.cc-ps-handle.cc-ps-drag{border-color:rgba(255,255,255,.7)}
.cc-ps-handle{opacity:0;transition:opacity .15s,border-color .15s}
.cc-ps-handle.cc-ps-show,.cc-ps-handle:hover,.cc-ps-handle.cc-ps-drag{opacity:1}
.cc-ps-label{position:absolute;right:18px;bottom:0;padding:1px 5px;border-radius:3px;font:12px/16px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.7);white-space:nowrap;pointer-events:none;display:none}
.cc-ps-handle.cc-ps-drag .cc-ps-label{display:block}
.cc-ps-badge{position:absolute;left:0;top:0;padding:1px 6px;border-radius:4px;background:rgba(10,10,14,.92);border:1px solid #555;color:#ddd;font:12px/16px system-ui,sans-serif;white-space:nowrap}
.cc-ps-badge.drag{border-color:#4ea3ff;color:#fff}.cc-ps-badge.eq{border-color:#4caf50;color:#7dff8a}.cc-ps-badge.near{border-color:#ffaa00;color:var(--cc-accent,#ffd24a)}
.cc-lock-btn{opacity:.45}.cc-lock-btn:hover{opacity:1}.cc-lock-btn.locked{opacity:1;color:var(--text-gold)}
.cc-pm{position:fixed;z-index:100001;min-width:210px;padding:5px;background:#17171f;border:1px solid rgba(255,255,255,.18);border-radius:8px;box-shadow:0 8px 26px rgba(0,0,0,.6);color:#ddd;font:13px/1.35 system-ui,sans-serif;user-select:none}
.cc-pm .pm-h{padding:4px 9px 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7f7f8e;font-weight:700}
.cc-pm .pm-i{padding:5px 9px;border-radius:5px;cursor:pointer;display:flex;gap:8px;align-items:center}
.cc-pm .pm-i:hover{background:rgba(255,255,255,.09)}.cc-pm .pm-i.dis{opacity:.4;pointer-events:none}
.cc-pm .pm-sep{height:1px;margin:4px 2px;background:rgba(255,255,255,.1)}
.cc-pm .pm-chips{display:flex;flex-wrap:wrap;gap:4px;padding:2px 6px 4px}
.cc-pm .pm-chip{padding:2px 8px;border-radius:5px;border:1px solid #3a3a48;background:#22222c;cursor:pointer}
.cc-pm .pm-chip:hover,.cc-pm .pm-chip.on{border-color:var(--cc-accent,#ffd24a);color:var(--cc-accent,#ffd24a)}
.cc-snap-guide{position:fixed;z-index:100000;pointer-events:none;background:var(--cc-accent,#ffd24a);box-shadow:0 0 8px rgba(255,210,74,.9);border-radius:1px}
.cc-snap-chip{position:fixed;z-index:100001;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;border:1px solid #ffd24a;background:rgba(20,20,26,.96);color:var(--cc-accent,#ffd24a);font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.6);transform:translate(-50%,-50%)}
.cc-snap-chip:hover{background:#2c2a18}
/* ---- stand-ins for the GAME's own elements (the game's CSS is not part of the lab) ---- */
.lab-game{--text-gold:#ffd24a;--text-muted:#9a9aa6;--text-light:#e6e6f0;--text-dim:#7f7f8e;--bg-cell:#1c1c26;--bg-hover:#2a2a38;--border-primary:#3a3a4a;--border-secondary:#6b5a2a;font:13px/1.3 system-ui,sans-serif;color:#ddd}
.lab-stage{background:linear-gradient(135deg,#27361f,#35472a 45%,#44562f)}
.lab-stage::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 30% 70%,rgba(255,255,255,.05),transparent 40%),repeating-linear-gradient(90deg,rgba(0,0,0,.05) 0 2px,transparent 2px 36px)}
.lab-gbtn{position:relative;display:flex;align-items:center;justify-content:center;flex:none;width:42px;height:42px;box-sizing:border-box;background:#141418;border:1.58px solid #2a2a38;border-radius:6px;color:#ddd}
.lab-gbtn img{width:28px;height:28px;image-rendering:pixelated}
.lab-gbtn.active{border-color:#5580c0;transform:scale(1.09);z-index:2}
.lab-gbtn kbd{position:absolute;left:4px;bottom:1px;font:700 13px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000}
.lab-gcol{display:flex;flex-direction:column;gap:0}
.lab-gwc{display:flex;gap:8px;padding:5px 6px;box-sizing:border-box;border:1px solid transparent;border-left:0;border-right:0}
.lab-gwc .lab-gbtn{width:44px;height:38px;border-radius:10px;background:#1a1a24;border:1px solid #3a3a4a;font-size:17px;color:#c8ccd8}
.lab-gwc.hot{background:rgba(8,8,14,.92);border-color:rgba(120,142,210,.5);box-shadow:0 10px 28px rgba(0,0,0,.55)}
.lab-gpanel{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;background:#14141c;border:1.58px solid #2a2a38;border-radius:6px;color:#ccc;font:12px/1.3 system-ui,sans-serif}
.lab-gpanel .lab-gbody{flex:1;padding:8px;color:#9a9aa6}
.lab-gtb{display:flex;align-items:center;gap:6px;flex:none;height:22px;padding:0 6px;background:#1c1c26;border-bottom:1px solid #2a2a38;border-radius:5px 5px 0 0;font:600 12px system-ui,sans-serif;color:#ddd}
.lab-gtb .panel-titlebar-label{flex:1;white-space:nowrap}
.lab-gtb .panel-titlebar-btns{display:flex;gap:2px;align-items:center}
.lab-gtb .panel-titlebar-btn{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 2px;border:0;border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;font:inherit}
.lab-gtb .panel-titlebar-btn:hover{background:var(--bg-hover);color:var(--text-light)}
.lab-gmodal{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;background:#101018;border:1px solid #2e2e42;border-radius:0 0 8px 8px;overflow:hidden;color:#cfd0dc;font:13px system-ui,sans-serif}
.lab-gmodal .lab-gmh{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;background:#14141e;border-bottom:1px solid #2a2a38;font:600 18px system-ui,sans-serif;color:#fff}
.lab-gmodal .lab-gmb{flex:1;padding:12px;color:#8f8fa4}
.lab-gnav{display:flex;flex-wrap:wrap;gap:4px}
.lab-gnav .settings-nav-btn{padding:3px 9px;border:1px solid #34343f;border-radius:3px;background:#17171f;color:#cfd0dc;font:12px system-ui,sans-serif}
.lab-game .settings-switch{position:relative;width:38px;height:20px;flex:none;border-radius:11px;background:#3a3a46;cursor:pointer}
.lab-game .settings-switch.on{background:#6b6a2a}
.lab-game .settings-switch .settings-switch-knob{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#cfd0dc;transition:left .15s}
.lab-game .settings-switch.on .settings-switch-knob{left:20px;background:#f2e6a0}
.lab-hkrow{display:flex;align-items:center;gap:10px;min-width:420px;padding:6px 10px;border-bottom:1px solid #23232f;color:#cfd0dc;font:13px system-ui,sans-serif}
.lab-hkrow .lab-hkk{margin-left:8px;padding:0 7px;border:1px solid #3a3a46;border-radius:4px;background:#1a1a24;color:#9a9aa6;font:11px system-ui,sans-serif}
.lab-guq{position:absolute;box-sizing:border-box;padding:30px 10px 10px;background:#12121a;border:1.58px solid #2a2a38;border-radius:6px;display:flex;flex-direction:column;gap:16px;font:12px system-ui,sans-serif;color:#ddd}
.lab-guq .uq-row{position:relative;display:flex;align-items:center;gap:8px;height:44px;box-sizing:border-box;padding:0 10px;background:#1b1b27;border:2px solid #3a3a4a;border-radius:8px}
.lab-guq .uq-row img{width:28px;height:28px;image-rendering:pixelated;flex:none}
.lab-guq .uq-row b{display:block;font-weight:600;color:#fff}.lab-guq .uq-row span{display:block;color:#9a9aa6;font-size:11px}
.lab-guq .lab-guqh{position:absolute;left:10px;top:6px;font:600 12px system-ui,sans-serif;color:#cfd0dc}
.lab-ginv{position:absolute;box-sizing:border-box;display:flex;gap:8px;align-items:center;padding:8px 10px;background:#17171f;border:1px solid #3a3a4a;border-radius:8px;color:#ddd;font:12px system-ui,sans-serif}
.lab-gpot{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:3px;padding:6px 8px;background:#14141c;border:1.58px solid #2a2a38;border-radius:6px;color:#ddd;font:12px system-ui,sans-serif}
.lab-gpot div{display:flex;align-items:center;gap:6px}.lab-gpot img{width:20px;height:20px;image-rendering:pixelated}
.lab-ghp{position:relative;width:24px;box-sizing:border-box;background:#141418;border:1.58px solid #2a2a38;display:flex;align-items:flex-end;overflow:hidden}
.lab-ghp i{display:block;width:100%;background:#2f9e44}
.lab-ghp b{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font:700 13px/1.05 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000}
.lab-cap{position:absolute;font:11px system-ui,sans-serif;color:#7f7f8e}
`;
  if (!document.getElementById('lab-spec-bars')) { const st = document.createElement('style'); st.id = 'lab-spec-bars'; st.textContent = LAB_CSS; document.head.appendChild(st); }

  // ------------------------------------------------------------------ small helpers
  const img = (g, n, cls) => h('img' + (cls ? '.' + cls : ''), { src: IB + '/' + g + '/' + n + '.png', alt: '', draggable: 'false', onerror() { this.style.visibility = 'hidden'; } });
  const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
  const num = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US'));
  const pretty = Lab.pretty;
  const px = (n) => n + 'px';
  const ABS = (o) => Object.assign({ position: 'absolute' }, o);
  const stage = (kids, st) => h('div.lab-game.lab-stage', { style: Object.assign({ position: 'absolute', left: '0', top: '0', right: '0', bottom: '0' }, st || {}) }, kids);
  const MODE_VERB = { idle: 'Farming', combat: 'Fighting', fortress: 'Defending', dungeon: 'Raiding' };
  const hpTone = (f) => (f < 0.25 ? 'bad' : f < 0.5 ? 'warn' : '');
  const HOVER_BG = { background: 'var(--cc-bg-3,#1c1c28)' };

  // the current task as the bar shows it, by scenario (null = nothing running: "No task")
  function taskOf(ctx) {
    const S = ctx.S, M = ctx.M;
    if (S.mode === 'idle' && !M.queue.length) return null;
    const p = { idle: [38, 92], combat: [51, 150], fortress: [14, 30], dungeon: [3, 8] }[S.mode] || [38, 92];
    return { name: S.mode === 'fortress' ? 'Fortress wave' : S.mode === 'dungeon' ? 'Raid room' : M.task, done: p[0], total: p[1], eta: S.mode === 'combat' ? '22 min' : '14 min' };
  }

  // ------------------------------------------------------------------ the static kit menu (same DOM as UI.menu(); no popup, no position)
  function fillMenu(m, items) {
    items.forEach((it) => {
      if (!it) return;
      if (it.head != null) { m.appendChild(h('div.cc-mh', it.head)); return; }
      if (it.sep) { m.appendChild(h('div.cc-msep')); return; }
      if (it.chips) { const row = h('div.cc-chips', { style: { padding: '2px 6px 4px' } }); it.chips.forEach((c) => row.appendChild(h('button.cc-chip' + (c.on ? '.on' : ''), { type: 'button', 'aria-pressed': c.on ? 'true' : null }, c.label))); m.appendChild(row); return; }
      if (it.slider) {
        const s = it.slider, r = h('input.cc-range', { type: 'range', min: s.min, max: s.max, step: s.step || 1, value: s.value });
        try { window.__ccUI.ccRange(r); } catch (e) { /* kit missing */ }
        m.appendChild(h('div.cc-mslider', h('span', s.label || ''), h('b', s.fmt ? s.fmt(s.value) : String(s.value)), r)); return;
      }
      const d = h('div.cc-mi' + (it.sub ? '.sub' : '') + (it.danger ? '.danger' : '') + (it.hl ? '.open' : ''), { role: 'menuitem', 'aria-checked': it.checked == null || it.checked === '' ? null : String(it.checked), 'aria-disabled': it.disabled ? 'true' : null, 'data-tone': it.tone || null, style: it.color ? { color: it.color } : null },
        h('span.ck'), h('span', it.label), it.badge != null ? h('span.cc-badge', { 'data-tone': 'accent' }, String(it.badge)) : h('span.hint', it.hint || ''));
      m.appendChild(d);
    });
    return m;
  }
  const menuEl = (items, o) => fillMenu(h('div.cc-menu', Object.assign({ role: 'menu' }, o || {})), items);
  const menus = (list) => h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' } }, list);

  // ------------------------------------------------------------------ Info Bar: modules (ui-bar.js ensureModules / refresh)
  const TH = { full: '0,0', compact: '99999,0', micro: '99999,99999' };   // data-th forced so the width class is the one named, whatever the lab column width
  // pc = the item row of the panel-button / potion modules (syncItems)
  function pcEl(items, o) {
    o = o || {};
    return h('span.pc' + (o.look ? '.look-' + o.look : '') + (o.pills ? '.pills' : ''), { style: { '--pg': (o.gap == null ? 8 : o.gap) + 'px' } },
      items.map((q) => {
        const btn = q.btn !== false;
        return h('span.pi' + (btn ? '.btn' : '') + (q.on ? '.on' : '') + (q.tone ? '.t-' + q.tone : '') + (q.drag ? '.drag' : ''), { role: btn ? 'button' : null, tabindex: btn ? '0' : null, 'data-key': q.key || null, title: q.title || null, style: q.style || null },
          q.img ? h('img', { src: q.img, alt: '' }) : h('img', { style: { display: 'none' } }), h('b', { style: { display: q.t ? '' : 'none' } }, q.t || ''), q.dot ? h('i.dot') : null);
      }));
  }
  // one module: <div class="m"><span class="i"> <span class="t"> <span class="pc"> <span class="f"><i>
  function mod(id, o) {
    o = o || {};
    const cls = 'div.m' + (o.clk ? '.clk' : '') + (o.hpbar ? '.hpbar' : '') + (o.fw ? '.fw' : '') + (o.tone ? '.' + o.tone : '') + (o.sp ? '.sp' : '') + (o.ln ? '.ln' : '') + (o.find ? '.find' : '') + (o.drag ? '.drag' : '');
    const style = Object.assign({}, o.style || {}); if (o.w) style.width = o.w + 'px';
    const items = !!o.pc;
    return h(cls, { 'data-id': id, 'data-s': o.s || 'l', role: o.clk ? 'button' : 'group', tabindex: o.clk ? '0' : null, 'aria-label': o.label || id, style },
      h('span.i', { style: { display: o.sp || items || o.noicon ? 'none' : '' } }, o.icon || ''),
      h('span.t' + (o.low === 'c' ? '.cc-hide-c' : o.low === 'm' ? '.cc-hide-m' : ''), { style: { display: o.sp || items ? 'none' : '' } }, o.t == null ? '' : o.t),
      o.pc || h('span.pc'),
      h('span.f', { style: { display: o.frac == null || o.sp ? 'none' : '' } }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, o.frac || 0)) * 100) + '%' } })));
  }
  // the bar: <div class="cc-bar cc-ibar [bottom]"> <div class="zl"> <div class="zc"> <div class="zr">
  function barEl(ctx, o) {
    const hpx = o.h || 34, pos = o.pos || 'top';
    const el = h('div.cc-bar.cc-ibar' + (pos === 'bottom' ? '.bottom' : ''), { role: 'toolbar', 'aria-label': pos === 'top' ? 'Top info bar' : 'Bottom info bar', 'data-th': TH[o.bp] || '1100,700', 'data-pos': pos,
      style: Object.assign({ position: 'absolute', left: '0', right: ctx.v && ctx.v.box ? 'auto' : '0', width: ctx.v && ctx.v.box ? ctx.v.box[0] + 'px' : null, height: hpx + 'px', '--cc-bar-h': hpx + 'px' }, pos === 'bottom' ? { bottom: '0' } : { top: o.top || '0' }, o.style || {}) },
      h('div.zl', o.l || []), h('div.zc', o.c || []), h('div.zr', o.r || []), o.extra || null);
    return ctx.watch(el);
  }
  const PB = { tasks: ['skills', 'exp'], skills: ['skills', 'levels'], equipment: ['skills', 'defend'], inventory: ['ui', 'bank'], diary: ['skills', 'discover'], quests: ['skills', 'draw'], friends: ['skills', 'bard'], barter: ['skills', 'barter'] };
  // the panel buttons with their live text (liveFor), by scenario
  function pbItems(ctx, tabs, look) {
    const M = ctx.M, t = taskOf(ctx), n = M.alerts.length, lvl = M.skills.reduce((a, s) => a + s.lvl, 0);
    const free = ctx.S.queue === 'overfull' ? 1 : ctx.S.queue === 'full' ? 3 : 14;
    return tabs.map((k) => {
      let tt = pretty(k), tone = '', dot = false;
      if (k === 'tasks') { if (!t) { tt = 'No task'; tone = 'warn'; } else tt = t.name + ' ' + t.done + '/' + t.total; }
      else if (k === 'skills') tt = 'Lv ' + lvl;
      else if (k === 'equipment') tt = 'Melee';
      else if (k === 'inventory') { tt = (28 - free) + '/28'; tone = free <= 1 ? 'bad' : free <= 3 ? 'warn' : ''; }
      else if (k === 'diary') tt = '64%';
      else if (k === 'quests') { if (n) { tt = 'Claim ' + n; tone = 'good'; dot = true; } else tt = '2 active'; }
      else if (k === 'friends') tt = '4 friends';
      else if (k === 'barter') tt = '2.10M left';
      return { key: k, img: IB + '/' + PB[k][0] + '/' + PB[k][1] + '.png', t: look === 'icon' ? '' : tt, tone: look === 'icon' ? '' : tone, on: k === 'tasks' && !!M.queue.length, dot, title: pretty(k) };
    });
  }
  function hpMod(ctx, o) {
    o = o || {}; const M = ctx.M, hp = o.hp != null ? o.hp : M.hp, f = hp / M.hpMax, tone = hpTone(f), txt = hp + (o.bar ? ' / ' : '/') + M.hpMax;
    if (o.bar) return mod('hp', { s: 'c', icon: '❤️', label: 'Hit points', hpbar: true, fw: true, w: o.w || 180, tone, t: o.text === false ? '' : txt, frac: f, noicon: o.icon === false, style: o.style });
    return mod('hp', { s: 'c', icon: '❤️', label: 'Hit points', t: txt, tone, frac: f, noicon: o.icon === false, style: o.style });
  }
  function potMod(o) {
    o = o || {};
    if (o.exp) return mod('potions', { s: 'c', label: 'Active potions', pc: pcEl([{ btn: false, img: IB + '/items/lobster.png', t: '18.2k' }, { btn: false, img: IB + '/items/calm_potion.png', t: '12' }, { btn: false, img: IB + '/items/haste_potion.png', t: '8' }, { btn: false, img: IB + '/items/stable_crystal.png', t: '3' }]), style: o.style });
    return mod('potions', { s: 'c', icon: '🧪', label: 'Active potions', t: '3 active', style: o.style });
  }
  // the usual bar, by scenario
  function stdBar(ctx, o) {
    o = o || {};
    const M = ctx.M, S = ctx.S, t = taskOf(ctx), n = M.alerts.length, free = S.queue === 'overfull' ? 1 : S.queue === 'full' ? 3 : 14;
    const L = [
      mod('alerts', { s: 'l', icon: '🔔', clk: true, label: 'Alerts', t: n ? n + ' alert' + (n > 1 ? 's' : '') : 'No alerts', tone: n ? 'bad' : '' }),
      mod('task', { s: 'l', icon: '🎯', clk: true, label: 'Current task', t: t ? t.name + ' ' + t.done + '/' + t.total + ' · ' + t.eta : 'No task', tone: t ? '' : 'warn', frac: t ? t.done / t.total : null }),
      mod('where', { s: 'l', icon: '📍', label: 'Location', t: MODE_VERB[S.mode] + ' · ' + M.location, low: 'c' }),
    ];
    const C = [hpMod(ctx, { bar: o.hpBar }), potMod({ exp: o.potExp }), mod('gold', { s: 'c', icon: '🪙', label: 'Gold', t: num(M.gold), low: 'm' })];
    const R = [
      free <= 3 ? mod('inv', { s: 'r', icon: '🎒', label: 'Inventory space', t: free + ' free', tone: free <= 1 ? 'bad' : 'warn', low: 'm' }) : null,
      mod('xp', { s: 'r', icon: '📈', clk: true, label: 'XP per hour', t: num(M.xpHr) + ' XP/hr', tone: 'good', low: 'm' }),
      mod('panelbtns', { s: 'r', icon: '📋', label: 'Panel buttons', pc: pcEl(pbItems(ctx, ['tasks', 'skills', 'inventory', 'quests'], 'icon'), { look: 'icon', gap: 4 }) }),
      mod('clock', { s: 'r', icon: '🕒', label: 'Clock', t: '19:42', low: 'c' }),
    ];
    return barEl(ctx, Object.assign({ l: L, c: C, r: R }, o));
  }
  const bottomBar = (ctx, o) => {
    const last = ctx.M.msgs[ctx.M.msgs.length - 1], n = ctx.M.alerts.length;
    return barEl(ctx, Object.assign({ pos: 'bottom',
      l: [mod('chat', { s: 'l', icon: '💬', clk: true, label: 'Chat', fw: true, w: 420, t: 'Chat · ' + last[2] + ': ' + last[3] + (n ? ' · ' + n + ' new' : '') })],
      r: [mod('panelbtns', { s: 'r', icon: '📋', label: 'Panel buttons', pc: pcEl(pbItems(ctx, ['tasks', 'skills', 'equipment', 'inventory', 'quests'], 'both'), { look: 'both', pills: true, gap: 4 }) })] }, o || {}));
  };

  // ------------------------------------------------------------------ hover card (#cc-bar-tip) and detail card (#cc-bar-tip2): ui-bar.js fillCard / showDetail
  const tipHead = (title, note, gear) => h('div.th', title, note ? h('span', note) : null, gear ? h('button.cc-ib.tgear', { type: 'button', title: 'Layout' }, '⚙') : null);
  function tipBlocks(host, blocks) {
    blocks.forEach((bk) => {
      if (bk.kind === 'grid') {
        const cs = bk.cell || 44, g = h('div.tg' + (bk.big ? '.big' : ''), { style: { gridTemplateColumns: 'repeat(' + bk.cols + ',' + cs + 'px)', '--cs': cs + 'px', '--cols': String(bk.cols) } });
        bk.cells.forEach((cl) => {
          const c = h('div.tcell' + (cl.ghost ? '.ghost' : '') + (cl.total ? '.total' : ''), { style: cl.span ? { gridColumn: 'span ' + cl.span } : null });
          if (cl.total) c.append(h('span.tl-l', cl.total.label), h('span.tl-v', String(cl.total.value)));
          if (cl.img) c.appendChild(h('img', { src: cl.img, alt: '' }));
          if (cl.txt) c.appendChild(h('b', cl.txt));
          if (cl.frac != null) { const u = h('u', h('s', { style: { width: Math.round(cl.frac * 100) + '%', background: cl.col || null } })); if (cl.q) u.appendChild(h('s.q', { style: { left: (cl.q[0] * 100).toFixed(1) + '%', width: (cl.q[1] * 100).toFixed(1) + '%' } })); c.appendChild(u); }
          if (cl.up) c.appendChild(h('em.tup', '▲'));
          g.appendChild(c);
        });
        host.appendChild(g);
      } else if (bk.kind === 'bars') {
        bk.rows.forEach((r) => host.appendChild(h('div.tq' + (r.tone ? '.' + r.tone : ''), h('div.tql', h('b', r.name), r.right ? h('span', r.right) : null), h('div.tqs', r.sub), h('div.tqb', h('i', { style: { width: Math.round(r.frac * 100) + '%' } })))));
      } else if (bk.kind === 'rows') {
        bk.rows.forEach((r) => host.appendChild(h('div.trw' + (r.tone ? '.' + r.tone : '') + (r.dim ? '.dim' : ''), r.img ? h('img', { src: r.img, alt: '' }) : null, h('div.tm', h('b', r.name), r.sub ? h('span', r.sub) : null), r.right ? h('em', r.right) : null)));
      } else if (bk.kind === 'chips') {
        host.appendChild(h('div.tch', bk.chips.map(([k, v]) => h('span', h('i', k), h('b', v)))));
      } else if (bk.kind === 'stats') {
        const w = h('div.tst'); bk.head.forEach((x) => w.appendChild(h('i', x)));
        bk.rows.forEach((r) => { w.appendChild(h('b', r.name)); r.vals.forEach((v) => w.appendChild(h('span', { class: /^\+0$/.test(v) || !v ? 'z' : /^-/.test(v) ? 'n' : 'p' }, v || '–'))); });
        host.appendChild(w);
      } else if (bk.kind === 'label') host.appendChild(h('div.tlb', bk.text));
      else if (bk.kind === 'text') host.appendChild(h('div.tl', bk.text));
    });
  }
  function tipSections(host, secs) {
    secs.forEach((sec) => {
      host.appendChild(h('div.ts', h('b', sec.h), sec.note ? h('span', sec.note) : null));
      sec.items.forEach((it) => host.appendChild(h('div.tr', h('img', { src: it.img, alt: '' }), h('span.tn', (it.tier ? it.tier + ' ' : '') + it.name), it.stat ? h('span.tx', it.stat) : null, h('span.tc', it.count))));
    });
  }
  // rich = { title, note, gear, blocks, sections }; null rich = the plain tooltip (text)
  function cardEl(rich, text, o) {
    o = o || {};
    const el = h('div#cc-bar-tip.ccx', { 'data-from': o.up ? 'up' : 'down', 'data-plain': rich ? null : '1', style: Object.assign({ position: 'relative', left: 'auto', top: 'auto', bottom: 'auto', animation: 'none', maxHeight: 'none' }, o.style || {}) });
    el.appendChild(tipHead((rich && rich.title) || o.label || '', rich && rich.note, rich && rich.gear));
    if (rich && rich.blocks) tipBlocks(el, rich.blocks);
    if (rich && rich.sections) tipSections(el, rich.sections);
    if (!rich) String(text).split('\n').forEach((ln) => el.appendChild(h('div.tl', ln)));
    return el;
  }
  // the option card at the side of the queue card
  function detailEl(d, o) {
    const el = h('div#cc-bar-tip2', { style: Object.assign({ position: 'relative', left: 'auto', top: 'auto' }, o || {}) });
    if (d.title) el.appendChild(h('div.th', d.title));
    if (d.html) el.appendChild(h('div.tooltip.cc-tt-clone', { html: null }, d.html));
    (d.blocks || []).forEach((bk) => {
      const box = h('div.tbx' + (bk.on ? '.on' : '') + (bk.tiles ? '.ob' : ''), { 'data-tone': bk.tone || null });
      const hd = h('div.ts' + (bk.on ? '.on' : ''));
      if (bk.img) hd.appendChild(h('img', { src: bk.img, alt: '' }));
      hd.appendChild(h('div.hw', h('b', bk.h), bk.sub ? h('span', bk.sub) : null));
      if ((bk.tags || []).length) hd.appendChild(h('div.tgs', bk.tags.map((t) => h('em' + (t === 'selected' ? '.sel' : t === 'fastest XP' ? '.bst' : ''), t))));
      box.appendChild(hd);
      if (bk.tiles) { box.appendChild(h('div.otl', bk.tiles.map(([k, v]) => h('div.ot', h('span', k), h('b', v))))); if (bk.note) box.appendChild(h('div.onote', bk.note)); }
      else (bk.lines || []).forEach(([k, v]) => box.appendChild(h('div.tkv', h('span', k), h('b', v))));
      el.appendChild(box);
    });
    return el;
  }

  // ================================================================== BARS
  Lab.add({ id: 'info-bar-top', cat: 'Bars', title: 'Info Bar', desc: 'The top bar: Alerts, Current task and Location on the left, Hit points, Potions and Gold in the middle, XP per hour and panel buttons on the right. Width classes full, compact and micro hide the low-priority text (cc-hide-c, cc-hide-m).', keywords: 'ui-bar cc-bar cc-ibar module zone zl zc zr top bar width class data-bp',
    variants: [{ label: 'Bar, top, full width (1280 px)', box: [1280, 42], bp: 'full' }, { label: 'Bar, top, compact (980 px)', box: [980, 42], bp: 'compact' }, { label: 'Bar, top, micro (760 px)', box: [760, 42], bp: 'micro' }],
    render: (ctx, v) => stdBar(ctx, { pos: 'top', bp: v.bp }) });

  Lab.add({ id: 'info-bar-bottom', cat: 'Bars', title: 'Info Bar, bottom', desc: 'The same bar on the bottom edge: a Chat module (elastic) and the panel buttons as separate pills with their live text. A card opens upwards from a bottom bar.', keywords: 'ui-bar bottom bar chat module panel buttons pills',
    variants: [{ label: 'Bar, bottom', box: [1280, 46] }, { label: 'Bar, bottom, with its card open (hover over Potions)', box: [1280, 330] }, { label: 'Both bars (top and bottom)', box: [1280, 190] }],
    render: (ctx, v, i) => {
      const n = ctx.v === v ? v : v, which = n.label.indexOf('card') >= 0 ? 1 : n.label.indexOf('Both') >= 0 ? 2 : 0;
      if (which === 0) return bottomBar(ctx, { bp: 'full' });
      if (which === 1) {
        const bar = barEl(ctx, { pos: 'bottom', bp: 'full', l: [mod('alerts', { s: 'l', icon: '🔔', clk: true, label: 'Alerts', t: ctx.M.alerts.length ? ctx.M.alerts.length + ' alerts' : 'No alerts', tone: ctx.M.alerts.length ? 'bad' : '' })], c: [hpMod(ctx), mod('potions', { s: 'c', icon: '🧪', label: 'Active potions', t: '3 active', style: HOVER_BG }), mod('gold', { s: 'c', icon: '🪙', label: 'Gold', t: num(ctx.M.gold) })], r: [mod('clock', { s: 'r', icon: '🕒', label: 'Clock', t: '19:42' })] });
        const card = cardEl(potionRich(), null, { up: true, label: 'Active potions', style: { position: 'absolute', left: '470px', bottom: '54px' } });
        return stage([bar, card], { background: '#1b2430' });
      }
      return stage([stdBar(ctx, { pos: 'top', bp: 'full' }), bottomBar(ctx, { bp: 'full' })], { background: '#1b2430' });
    } });

  Lab.add({ id: 'info-bar-heights', cat: 'Bars', title: 'Info Bar heights', desc: 'Right-click the bar, Height: Compact (28 px), Normal (34 px) or Roomy (42 px). The modules keep their padding; only the bar height and the module height change.', keywords: 'ui-bar height compact normal roomy uiBarHeight --cc-bar-h',
    variants: [{ label: 'Bar, compact (28 px)', box: [1280, 34], h: 28 }, { label: 'Bar, normal (34 px)', box: [1280, 40], h: 34 }, { label: 'Bar, roomy (42 px)', box: [1280, 48], h: 42 }],
    render: (ctx, v) => stdBar(ctx, { pos: 'top', bp: 'full', h: v.h }) });

  // single modules in a small bar
  function oneBar(ctx, l, o) { return barEl(ctx, Object.assign({ pos: 'top', bp: 'full', l: l, c: [], r: [] }, o || {})); }
  Lab.add({ id: 'info-bar-modules', cat: 'Bars', title: 'Info Bar modules and their states', desc: 'One module in a bar, in every state it can be in: rest, hover, attention (the find outline), dragging with the drop-target line, tones good / warn / bad, the spacer module, the elastic Chat module and the Game event module.', keywords: 'ui-bar module m hover attention find drag ins drop target tone good warn bad spacer chat event inventory',
    variants: [
      { label: 'Module, rest', box: [330, 40], k: 'rest' }, { label: 'Module, hover', box: [330, 40], k: 'hover' }, { label: 'Module, attention (find outline)', box: [330, 40], k: 'find' },
      { label: 'Module, dragging, with the drop-target line', box: [430, 40], k: 'drag' }, { label: 'Module tones: good, warn, bad', box: [430, 40], k: 'tones' },
      { label: 'Spacer module with divider, hover', box: [330, 40], k: 'space' }, { label: 'Module: Chat (elastic)', box: [460, 40], k: 'chat' }, { label: 'Module: Game event (attention)', box: [330, 40], k: 'event' }, { label: 'Module: Location and Clock', box: [430, 40], k: 'where' }],
    render: (ctx, v) => {
      const t = taskOf(ctx), task = (o) => mod('task', Object.assign({ s: 'l', icon: '🎯', clk: true, label: 'Current task', t: t ? t.name + ' ' + t.done + '/' + t.total + ' · ' + t.eta : 'No task', tone: t ? '' : 'warn', frac: t ? t.done / t.total : null }, o || {}));
      switch (v.k) {
        case 'hover': return oneBar(ctx, [task({ style: HOVER_BG })]);
        case 'find': return oneBar(ctx, [task({ find: true })]);
        case 'drag': return oneBar(ctx, [mod('alerts', { s: 'l', icon: '🔔', clk: true, label: 'Alerts', t: 'No alerts' }), task({ drag: true })], { extra: h('div.ins', { style: { left: '128px' } }) });
        case 'tones': return oneBar(ctx, [mod('xp', { s: 'l', icon: '📈', clk: true, label: 'XP', t: num(ctx.M.xpHr) + ' XP/hr', tone: 'good' }), mod('inv', { s: 'l', icon: '🎒', label: 'Inventory space', t: '3 free', tone: 'warn' }), mod('alerts', { s: 'l', icon: '🔔', clk: true, label: 'Alerts', t: '3 alerts', tone: 'bad' })]);
        case 'space': return oneBar(ctx, [task({}), mod('space', { s: 'l', sp: true, ln: true, w: 60, label: 'Empty space', style: { outline: '1px dashed var(--cc-border-strong,#4a4a62)', outlineOffset: '-2px' } }), mod('clock', { s: 'l', icon: '🕒', label: 'Clock', t: '19:42' })]);
        case 'chat': { const l = ctx.M.msgs[ctx.M.msgs.length - 1]; return oneBar(ctx, [mod('chat', { s: 'l', icon: '💬', clk: true, label: 'Chat', fw: true, w: 420, t: 'Chat · ' + l[2] + ': ' + l[3] })]); }
        case 'event': return oneBar(ctx, [mod('event', { s: 'l', icon: '🎉', clk: true, label: 'Game event', t: '+12.5% XP · start · 6d', tone: 'warn' })]);
        case 'where': return oneBar(ctx, [mod('where', { s: 'l', icon: '📍', label: 'Location', t: MODE_VERB[ctx.S.mode] + ' · ' + ctx.M.location }), mod('clock', { s: 'l', icon: '🕒', label: 'Clock', t: '19:42' })]);
        default: return oneBar(ctx, [task({})]);
      }
    } });

  Lab.add({ id: 'info-bar-panel-buttons', cat: 'Bars', title: 'Info Bar panel buttons', desc: 'The Panel buttons module: one button per game panel with live text. Looks: icon only, icon and text, text only; Plain or Separate pills. An active button (open panel) is underlined in the accent colour; a dot marks something to claim.', keywords: 'ui-bar panelbtns pbtn pc pi btn look icon text pills active dot drag ins-btn tasks queue',
    variants: [
      { label: 'Panel buttons, icon only', box: [340, 40], k: 'icon', look: 'icon' }, { label: 'Panel buttons, icon and text', box: [880, 40], k: 'both', look: 'both' }, { label: 'Panel buttons, text only', box: [700, 40], k: 'text', look: 'text' },
      { label: 'Panel buttons, separate pills', box: [880, 40], k: 'pills', look: 'both' }, { label: 'Panel button, active and hover', box: [460, 40], k: 'state', look: 'both' }, { label: 'Panel button, dragging, with the drop-target line', box: [460, 40], k: 'drag', look: 'both' }],
    render: (ctx, v) => {
      const ALL = ['tasks', 'skills', 'equipment', 'inventory', 'diary', 'quests', 'friends', 'barter'];
      let items = pbItems(ctx, v.look === 'icon' ? ALL : ALL, v.look), pc;
      if (v.k === 'state') { items = pbItems(ctx, ['tasks', 'skills', 'inventory'], 'both'); items[0].on = true; items[1].style = { background: 'var(--cc-bg-hover,#262636)', color: 'var(--cc-text,#fff)' }; items[2].on = false; }
      if (v.k === 'drag') { items = pbItems(ctx, ['tasks', 'skills', 'inventory'], 'both'); items[1].drag = true; }
      if (v.k === 'text') items = items.map((q) => Object.assign({}, q, { img: '' }));
      pc = pcEl(items, { look: v.look, pills: v.k === 'pills', gap: 4 });
      const extra = v.k === 'drag' ? h('div.ins-btn', { style: { position: 'absolute', left: '262px', top: '6px', height: '26px' } }) : null;
      return barEl(ctx, { pos: 'top', bp: 'full', l: [mod('panelbtns', { s: 'l', icon: '📋', label: 'Panel buttons', pc })], extra });
    } });

  Lab.add({ id: 'info-bar-hp', cat: 'Bars', title: 'Info Bar, Hit points module', desc: 'Numbers with a heart, or a real HP bar (width 60-600 px). Under 50% the numbers turn amber, under 25% red; the thin line under the numbers is the same fraction.', keywords: 'ui-bar hp hit points hpbar bar width heart icon tone low critical',
    variants: [{ label: 'Module: Hit points, numbers (current scenario)', box: [300, 40], k: 'num' }, { label: 'Module: Hit points, bar (current scenario)', box: [300, 40], k: 'bar' }, { label: 'Module: Hit points, bar, wide, no numbers', box: [420, 40], k: 'wide' },
      { label: 'Module: Hit points, low (warn)', box: [300, 40], k: 'low' }, { label: 'Module: Hit points, critical (bad)', box: [300, 40], k: 'crit' }, { label: 'Module: Hit points, numbers, no icon', box: [300, 40], k: 'noicon' }],
    render: (ctx, v) => {
      const M = ctx.M; let m;
      if (v.k === 'bar') m = hpMod(ctx, { bar: true, w: 180 });
      else if (v.k === 'wide') m = hpMod(ctx, { bar: true, w: 340, text: false });
      else if (v.k === 'low') m = hpMod(ctx, { bar: true, w: 180, hp: Math.round(M.hpMax * 0.4) });
      else if (v.k === 'crit') m = hpMod(ctx, { bar: true, w: 180, hp: Math.round(M.hpMax * 0.1) });
      else if (v.k === 'noicon') m = hpMod(ctx, { icon: false });
      else m = hpMod(ctx);
      return oneBar(ctx, [m]);
    } });

  // ================================================================== TOOLTIPS AND POPOVERS
  function potionRich() {
    const it = (g, n, tier, name, stat, count) => ({ img: IB + '/' + g + '/' + n + '.png', tier, name, stat, count });
    return { title: 'Active potions', sections: [
      { h: 'Food', note: 'Healing 18.2k · 412 left', items: [it('items', 'lobster', '', 'Lobster', '+120 HP', '312'), it('items', 'shrimp', '', 'Shrimp', '+30 HP', '100')] },
      { h: 'Potions', note: '', items: [it('items', 'battle_potion_t4', 'T4', 'Battle Potion', '+6 Strike', '12 doses'), it('items', 'calm_potion', 'T2', 'Calm Potion', '+4 Focus', '8 doses')] },
      { h: 'Movement', note: '', items: [it('items', 'haste_potion', '', 'Haste Potion', '+15% speed', '3 doses')] },
      { h: 'Teleports', note: '', items: [it('items', 'stable_crystal', '', 'Stable Crystal', '', '3 charges')] }] };
  }
  Lab.add({ id: 'info-bar-card', cat: 'Tooltips and popovers', title: 'Info Bar hover card', desc: 'Hover a module and its card opens under the bar (above a bottom bar): a header with a note and a cogwheel, then the sections, grids, quest bars, chips or stats of that module. A module with only a short text shows the plain tooltip.', keywords: 'ui-bar cc-bar-tip ccx card tooltip hover potions skills event quests stats th ts tr tg tcell tq tch tst tl',
    variants: [{ label: 'Card: Active potions (sections)', k: 'pot' }, { label: 'Card: Skills (grid, with the queue-gain bars)', k: 'skills' }, { label: 'Card: Quests (bars)', k: 'quests' }, { label: 'Card: Game event (chips)', k: 'event' }, { label: 'Card: Equipment (stats)', k: 'stats' }, { label: 'Tooltip: plain text (Gold)', k: 'plain' }],
    render: (ctx, v) => {
      const M = ctx.M;
      if (v.k === 'pot') return cardEl(potionRich(), null);
      if (v.k === 'skills') {
        const cells = M.skills.map((s, i) => ({ img: IB + '/skills/' + s.id + '.png', txt: String(s.lvl), frac: s.frac, col: s.frac >= 0.85 ? '#5fe06d' : s.frac >= 0.5 ? '#4aa8ff' : s.frac >= 0.25 ? '#ffb84a' : '#ff8a5c', q: i % 5 === 0 ? [s.frac, Math.min(0.2, 1 - s.frac)] : null, up: i % 7 === 0 }));
        const tot = M.skills.reduce((a, s) => a + s.lvl, 0); cells.push({ total: { label: 'Total Level', value: tot }, span: 6 - (M.skills.length % 6 || 6) || 6 });
        return cardEl({ title: 'Skills', note: 'Total level ' + tot + ' · green = what your queue adds', gear: true, blocks: [{ kind: 'grid', cols: 6, cell: 60, cells }] }, null, { style: { maxWidth: '420px' } });
      }
      if (v.k === 'quests') return cardEl({ title: 'Quests', note: '3 active · 1 to claim', blocks: [{ kind: 'bars', rows: [{ name: 'Ridgetop Mine', sub: 'All steps done: claim your reward', right: '5/5', frac: 1, tone: 'good' }, { name: 'The Lost Pickaxe', sub: 'Step 3 / 6: find the old camp', right: 'Quest hint', frac: 0.5 }, { name: 'Moss for the Healer', sub: 'Step 1 / 4', right: '', frac: 0.2 }] }] }, null);
      if (v.k === 'event') return cardEl({ title: 'Harvest Festival Event', note: '3,412 found by everyone', blocks: [{ kind: 'chips', chips: [['Boost', '+12.5% XP'], ['Found by all', '3,412'], ['You', '2 of 5'], ['Ends', '6 days']] }, { kind: 'text', text: 'Find the five hidden lanterns around the map.' }] }, null);
      if (v.k === 'stats') return cardEl({ title: 'Equipment', note: 'Melee · Weapon', blocks: [{ kind: 'stats', head: ['', 'Worn', 'Bank', 'Change'], rows: [{ name: 'Slash', vals: ['+48', '+52', '+4'] }, { name: 'Strength', vals: ['+41', '+41', '+0'] }, { name: 'Defence', vals: ['+30', '+22', '-8'] }] }] }, null);
      return cardEl(null, M.gold.toLocaleString('en-US') + ' gold', { label: 'Gold' });
    } });

  Lab.add({ id: 'info-bar-detail-card', cat: 'Tooltips and popovers', title: 'Info Bar detail card', desc: 'A second card beside the queue card: the options of the slot you point at (tiles for time, XP, XP per hour), or the game’s own item tooltip cloned into it.', keywords: 'ui-bar cc-bar-tip2 detail card option tbx ob ot onote tkv cc-tt-clone queue options tooltip',
    variants: [{ label: 'Detail card: slot options', k: 'opts' }, { label: 'Detail card: facts (label / value lines)', k: 'lines' }, { label: 'Detail card: the game’s item tooltip (cloned)', k: 'clone' }],
    render: (ctx, v) => {
      const Q = (ctx.M.queue.length > 1 ? ctx.M.queue : window.LabMock.QUEUE)[1], o = Q.opts;
      const blk = (op, i) => ({ h: pretty(op.name), on: i === 0, tone: op.quest ? 'quest' : op.lucky ? 'lucky' : op.boost ? 'boost' : '', tags: [i === 0 ? 'selected' : null, op.quest ? 'quest' : null, i === 1 ? 'fastest XP' : null].filter(Boolean), img: IB + '/skills/' + op.skill + '.png', sub: pretty(op.skill) + ' · ' + op.place,
        tiles: [['Time', Math.round(op.timeSec / 60) + ' min'], ['XP', Lab.num(op.xp)], ['XP / hour', num(op.xp / op.timeSec * 3600)], ['Success', '100%']], note: op.quest ? 'Quest: The Lost Pickaxe' : '' });
      if (v.k === 'lines') return detailEl({ title: 'Current task', blocks: [{ h: 'Battle Root ×92', on: true, img: IB + '/skills/farm.png', sub: 'Farm · Hillfarm Greenhouse', tags: ['selected'], lines: [['Skill', 'Farm'], ['Where', 'Hillfarm Greenhouse'], ['Amount', '92'], ['Time', '12 min'], ['XP', '5.17k']] }] });
      if (v.k === 'clone') {
        const tt = h('div', { style: { minWidth: '200px', font: '13px system-ui,sans-serif' } }, h('div', { style: { color: '#ffd86b', fontSize: '15px', fontWeight: '600' } }, 'Stable Crystal'), h('div', { style: { color: '#b4bace', margin: '2px 0 4px' } }, 'Teleports you to the last place you rested at.'), h('div', { style: { color: '#7fb4ff' } }, '3 charges left'));
        const d = detailEl({ title: 'Stable Crystal' }); d.appendChild(h('div.tooltip.cc-tt-clone', tt)); return d;
      }
      return detailEl({ blocks: o.slice(0, 3).map(blk) });
    } });

  // ================================================================== MENUS
  const BAR_ADD = [['🎯', 'Current task', 1], ['📍', 'Location', 1], ['📈', 'XP per hour', 1], ['🪙', 'Gold', 1], ['🩸', 'Blood coins', 0], ['🕒', 'Clock', 1], ['🎒', 'Inventory space', 1], ['🎉', 'Game event', 0], ['❤️', 'Hit points', 1], ['🔔', 'Alerts', 1], ['📋', 'Panel buttons', 1], ['🔘', 'Button: Tasks', 0], ['🔘', 'Button: Skills', 0], ['💬', 'Chat', 0], ['', 'Empty space (spacer)', 2], ['🧪', 'Active potions', 1]];
  Lab.add({ id: 'info-bar-menu', cat: 'Menus', title: 'Info Bar right-click menu', desc: 'Right-click a module for its own options (choices, sliders, switches), where it sits and Remove; below the line, the bar’s own options: Add a module, Height, Opacity, show or hide a bar. Built with the kit’s one menu component.', keywords: 'ui-bar context menu right click add a module height opacity hp options slider move to remove reset the bars cc-menu cc-mi cc-mh cc-msep',
    variants: [{ label: 'Menu: on the Hit points module', k: 'hp' }, { label: 'Menu: on empty bar space, with Add a module open', k: 'bar' }, { label: 'Menus: Height and Opacity submenus', k: 'sub' }],
    render: (ctx, v) => {
      const bar = [{ head: 'Bar' }, { label: 'Add a module', sub: [], hl: v.k === 'bar' }, { label: 'Height', sub: [] }, { label: 'Opacity', sub: [] }, { label: 'Show a hint when hovering empty space', checked: true }, { label: 'Game uses the space left', checked: true }, { sep: 1 }, { label: 'Show a bottom bar' }, { label: 'Hide this bar' }, { label: 'Reset the bars' }];
      if (v.k === 'hp') return menuEl([{ head: 'Hit points' }, { label: 'Display', sub: [] }, { slider: { label: 'Bar width', min: 60, max: 600, step: 10, value: 180, fmt: (x) => x + ' px' } }, { label: 'Numbers on the bar', checked: true }, { label: 'Heart icon', checked: true }, { label: 'Hide the game’s own HP bar' }, { sep: 1 }, { label: 'Move to', sub: [] }, { label: 'Move to the bottom bar' }, { label: 'Remove' }, { sep: 1 }].concat(bar));
      if (v.k === 'bar') return menus([menuEl(bar), menuEl(BAR_ADD.map(([ic, lab, n]) => ({ label: (ic ? ic + '  ' : '') + lab, checked: n > 0 ? true : undefined, badge: n > 1 ? '×' + n : undefined, disabled: n === 1 && !/Button|Empty/.test(lab) && false })))]);
      return menus([menuEl([{ head: 'Height' }, { label: 'Compact' }, { label: 'Normal', checked: true }, { label: 'Roomy' }]), menuEl([{ head: 'Opacity' }, { label: '100%', checked: true }, { label: '90%' }, { label: '75%' }, { label: '60%' }]), menuEl([{ head: 'Display' }, { label: 'Numbers with an icon', checked: true }, { label: 'Bar' }])]);
    } });

  Lab.add({ id: 'alert-bell-menu', cat: 'Menus', title: 'Alert Bell right-click menu', desc: 'Right-click the bell: Filter alerts (by category or one by one, with check marks and a mixed state), hide the bell button, lock it in place, put it back.', keywords: 'alert-bell context menu filter alerts categories individual gear slots lock hide cc-menu checked mixed',
    variants: [{ label: 'Menu: bell, with Filter alerts open', k: 'top' }, { label: 'Menu: Categories and Individual alerts', k: 'cats' }],
    render: (ctx, v) => {
      if (v.k === 'top') return menus([menuEl([{ label: 'Filter alerts', sub: [], hl: true }, { sep: 1 }, { label: 'Hide the bell button (hover the Alerts module to see the list)' }, { label: 'Lock the bell in place' }, { label: 'Put it back in its default spot' }]), menuEl([{ label: 'Categories', sub: [] }, { label: 'Individual alerts', sub: [] }, { sep: 1 }, { label: 'Show every alert' }, { label: 'Hide every alert' }])]);
      return menus([menuEl([{ label: 'Progress', checked: 'mixed', sub: [] }, { label: 'Events while you were away', checked: true, sub: [] }, { label: 'Status', checked: 'mixed', sub: [] }]),
        menuEl([['🎉', 'Game events', 1], ['🌳', 'Unspent tree points', 1], ['🎚️', 'Unspent lever credits', 1], ['🎁', 'Unopened chests and lamps', 1], ['📜', 'Quests ready to hand in', 1], ['⚔️', 'Gear upgrades in your bank', 'sub'], ['🔨', 'New collection entries you can craft', 1], ['💤', 'Nothing is running', 1], ['🎒', 'Inventory full', 0], ['🧪', 'A potion ran out', 0]].map(([ic, l, c]) => ({ label: ic + '  ' + l, checked: c === 1 ? true : undefined, sub: c === 'sub' ? [] : undefined, checkedDefault: 0 }))) ]);
    } });

  const LOGO = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22 width=%22128%22 height=%22128%22%3E%3Crect x=%223%22 y=%223%22 width=%22122%22 height=%22122%22 rx=%2228%22 fill=%22%2323232f%22/%3E%3Crect x=%2246%22 y=%2222%22 width=%2248%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2234%22 y=%2234%22 width=%2224%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2234%22 y=%2246%22 width=%2224%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2246%22 y=%2258%22 width=%2236%22 height=%2212%22 fill=%22%23ffd24a%22/%3E%3Crect x=%2270%22 y=%2270%22 width=%2224%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2270%22 y=%2282%22 width=%2224%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2234%22 y=%2294%22 width=%2248%22 height=%2212%22 fill=%22%23b8760f%22/%3E%3Crect x=%2282%22 y=%2222%22 width=%2212%22 height=%2212%22 fill=%22%23fff0b0%22/%3E%3C/svg%3E";
  Lab.add({ id: 'scapelite-menu', cat: 'Menus', title: 'ScapeLite logo menu', desc: 'The ScapeLite logo is the last button of the game’s left icon strip. Hover it and a menu lists ScapeLite’s own panels; a tick means the panel is open. Click an entry to show or hide that panel.', keywords: 'scapelite-menu cc-slmenu cc-menu-btn logo button left strip floating-tab-btn panels menu',
    variants: [{ label: 'Menu: ScapeLite logo, hover', k: 'hover' }, { label: 'Menu: no panels switched on', k: 'none' }],
    render: (ctx, v) => {
      const E = [['🧭 Route Advisor', 'Faster task order and teleports', 1], ['🎯 Goals', 'Skill targets and item hunts with ETAs', 0], ['📈 XP Tracker', 'XP per hour, graph and all skills', ctx.S.mode !== 'idle' ? 1 : 0], ['🍀 Drop Luck', 'How lucky your rare drops have been', 0], ['🌳 Tree Advisor', 'Best Delve and Fortress tree builds', 0], ['📊 Info Bars', 'Top and bottom bars: task, XP per hour, gold ... (right-click a bar to set it up)', 1], ['💬 Chat', 'A roomier chat window with tabs, search and settings', 0], ['🧩 Edit Layout', 'Move, snap, fade and lock panels; save layouts', 0]];
      const m = h('div#cc-slmenu.cc-menu.show', { role: 'menu', style: { marginLeft: '8px' } }, h('div.cc-mh', 'ScapeLite'));
      if (v.k === 'none') m.appendChild(h('div.cc-mh', 'No panels are switched on.'));
      else E.forEach(([l, hint, open]) => m.appendChild(h('div.cc-mi', { role: 'menuitem', 'aria-checked': open ? 'true' : null, title: hint }, h('span.ck'), h('span', l), h('span.hint', hint))));
      const strip = h('div.lab-gcol', ['bank', 'chest', 'combat'].map((n, i) => h('div.lab-gbtn.floating-tab-btn', { style: { borderRadius: '6px 0 0 6px' } }, img('ui', n), h('kbd', 'BCV'[i]))), h('div.lab-gbtn.floating-tab-btn.cc-menu-btn.active', { style: { borderRadius: '6px 0 0 6px', transform: 'none', borderColor: '#2a2a38' } }, h('img', { src: LOGO, alt: 'ScapeLite' })));
      return h('div.lab-game', { style: { display: 'flex', alignItems: 'flex-start' } }, strip, m);
    } });

  Lab.add({ id: 'settings-nav-menu', cat: 'Menus', title: 'Settings quick-jump menu', desc: 'Hover a category in the Settings header (Build, Display ... Plugins) and a dropdown lists its sub-headings or settings; the Plugins entry lists every plugin section, grouped, with a flyout. Click to scroll there.', keywords: 'settings-nav cc-sn-menu sn-h sn-i sn-grp sn-set sn-open flyout quick jump settings nav dropdown',
    variants: [{ label: 'Menu: Display (sub-headings)', k: 'sub' }, { label: 'Menu: Audio (settings of a category without sub-headings)', k: 'set' }, { label: 'Menu: Plugins, with the Interface flyout open', k: 'plug' }],
    render: (ctx, v) => {
      const mk = (cls, head, items) => h('div.cc-sn-menu' + (cls ? '.' + cls : ''), { style: { position: 'relative', left: 'auto', top: 'auto' } }, h('div.sn-h', head), items.map(([t, c, open]) => h('div.sn-i' + (c ? '.' + c : '') + (open ? '.sn-open' : ''), t)));
      const nav = (on) => h('div.lab-gnav', { style: { marginBottom: '6px' } }, ['Build', 'Account', 'Display', 'Audio', 'Players', 'Hotkeys', 'Plugins'].map((n) => h('span.settings-nav-btn', { style: n === on ? { borderColor: '#5580c0', color: '#fff' } : null }, n)));
      if (v.k === 'sub') return h('div.lab-game', null, nav('Display'), mk('', 'Display', [['Interface'], ['XP drops and loot'], ['Combat text'], ['Map and minimap'], ['Chat window'], ['Accessibility']]));
      if (v.k === 'set') return h('div.lab-game', null, nav('Audio'), mk('', 'Audio', [['Global volume', 'sn-set'], ['Music', 'sn-set'], ['Sounds', 'sn-set'], ['Mute when the game is in the background', 'sn-set'], ['Combat sounds', 'sn-set']]));
      return h('div.lab-game', null, nav('Plugins'), h('div', { style: { display: 'flex', gap: '4px', alignItems: 'flex-start' } },
        mk('', 'Plugins', [['Interface', 'sn-grp', true], ['Discord', 'sn-grp'], ['Panels', 'sn-grp'], ['Alerts'], ['About']]),
        mk('cc-sn-sub', 'Interface', [['Info Bars'], ['Alerts'], ['Panel buttons'], ['Menu dock'], ['Notification dock']])));
    } });

  const GRP = { Crafting: [['smith', 'Smithing', 'M'], ['craft', 'Crafting', ','], ['imbue', 'Imbuing', '.'], ['brew', 'Brewing', '/']], 'Raids and trees': [['combat', 'Raids', 'R'], ['delve', 'Delve tree', ''], ['fortify', 'Fortress tree', '']] };
  Lab.add({ id: 'sidebar-group-menu', cat: 'Menus', title: 'Side menu group menu', desc: 'Related icons of the left strip share one button (a small corner triangle). Click it to open the first menu as usual; hover it and a list of the others appears. The open entry is gold, the hotkey sits at the right.', keywords: 'sidebar-tabs cc-sbgmenu cc-sbg-lead cc-sbg-on group menu left strip floating-tab-btn crafting raids trees',
    variants: [{ label: 'Menu: Crafting group (Smithing open)', k: 'Crafting' }, { label: 'Menu: Raids and trees group', k: 'Raids and trees' }],
    render: (ctx, v) => {
      const list = GRP[v.k], m = h('div#cc-sbgmenu', { style: { position: 'relative', left: 'auto', top: 'auto', marginLeft: '8px' } }, h('div.h', v.k), list.map(([ic, nm, k], i) => h('div.i' + (i === 0 ? '.on' : ''), img('skills', ic), nm, k ? h('kbd', k) : null)));
      return h('div.lab-game', { style: { display: 'flex', alignItems: 'flex-start' } }, h('div.lab-gcol', h('div.lab-gbtn.floating-tab-btn', { style: { borderRadius: '6px 0 0 6px' } }, img('ui', 'bank')), h('div.lab-gbtn.floating-tab-btn.cc-sbg-lead.cc-sbg-on', { style: { borderRadius: '6px 0 0 6px', borderColor: '#2a2a38', transform: 'none' } }, img('skills', list[0][0])), h('div.lab-gbtn.floating-tab-btn', { style: { borderRadius: '6px 0 0 6px' } }, img('ui', 'combat'))), m);
    } });

  Lab.add({ id: 'sidebar-tab-menu', cat: 'Menus', title: 'Side menu icon right-click menu', desc: 'Right-click an icon in the left strip: pin it (it stays when the strip is minimised) or unpin it, and reset the icon order once you have rearranged them.', keywords: 'sidebar-tabs pin unpin sticky icon order reset context menu left strip cc-menu',
    variants: [{ label: 'Menu: icon not pinned', k: 'pin' }, { label: 'Menu: icon pinned, order changed', k: 'unpin' }],
    render: (ctx, v) => menuEl(v.k === 'pin' ? [{ head: 'Bank' }, { label: 'Pin (keep visible when the strip is minimised)' }] : [{ head: 'Bank' }, { label: 'Unpin (hide when the strip is minimised)' }, { label: 'Reset the icon order (ScapeLite logo back at the bottom)' }]) });

  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z"></path></svg>';
  Lab.add({ id: 'panel-title-menu', cat: 'Menus', title: 'Panel title bar right-click menu', desc: 'Right-click the title bar of any game panel: lock it, lock all, hide it, align it to one of nine places, reset its size, pick a size (50-150%) or match the height of another panel.', keywords: 'panel-resize cc-pm pm-h pm-i pm-chips pm-chip pm-sep title bar context menu lock align size match height hide panel',
    variants: [{ label: 'Menu: panel title bar (Skills)', k: 'panel' }, { label: 'Menu: Active potions', k: 'pot' }],
    render: (ctx, v) => {
      const c = (t, on) => h('div.pm-chip' + (on ? '.on' : ''), { style: { textAlign: 'center' } }, t);
      const pm = (kids) => h('div.cc-pm', { style: { position: 'relative', left: 'auto', top: 'auto' } }, kids);
      if (v.k === 'pot') return pm([h('div.pm-h', 'Active potions'), h('div.pm-i', '🙈 Hide the active potions (restore in Settings > Plugins > Panels)')]);
      return pm([h('div.pm-h', 'Skills'), h('div.pm-i', '🔒 Lock this panel (no move / resize)'), h('div.pm-i', '🔒 Lock all panels'), h('div.pm-sep'), h('div.pm-i', '🙈 Hide this panel (restore it in Settings > Plugins > Panels)'), h('div.pm-sep'),
        h('div.pm-h', 'Align'), h('div.pm-chips', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px' } }, ['↖', '↑', '↗', '←', '●', '→', '↙', '↓', '↘'].map((t) => c(t))), h('div.pm-i.dis', 'Reset alignment'), h('div.pm-sep'),
        h('div.pm-i.dis', 'Reset size (100%)'), h('div.pm-h', 'Size'), h('div.pm-chips', [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].map((x) => c(Math.round(x * 100) + '%', x === 1))), h('div.pm-h', 'Match height of'), h('div.pm-i', 'Goals  ·  312 px'), h('div.pm-i', 'Equipment  ·  288 px')]);
    } });

  const WC_MENU = 'min-width:210px;background:#16161e;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,.65);font:13px/1.3 system-ui,sans-serif;color:#ddd;';
  Lab.add({ id: 'dock-menu', cat: 'Menus', title: 'Dock right-click menus', desc: 'Right-click the window-controls strip or the potion handle (lock in place, reset position and size); right-click the menu dock strip (lock, hide, back to the game’s own menu, size presets, match height).', keywords: 'window-dock menu-dock cc-wc-strip cc-pot-handle cc-dock-grip cc-pm lock reset position size context menu',
    variants: [{ label: 'Menu: window buttons strip', k: 'wc' }, { label: 'Menu: menu dock strip (Menu + HP bar)', k: 'md' }],
    render: (ctx, v) => {
      if (v.k === 'wc') {
        const row = (t, dim) => h('div', { style: 'padding:6px 10px;border-radius:7px;cursor:pointer;' + (dim ? 'color:#8a8a9a;' : '') }, t);
        return h('div', { style: WC_MENU }, h('div', { style: 'padding:3px 10px 5px;color:#8a8a9a;font-size:11px;letter-spacing:.06em;text-transform:uppercase;' }, 'Window buttons'), row('🔒 Lock in place'), row('Reset position and size', true));
      }
      return h('div.cc-pm', { style: { position: 'relative', left: 'auto', top: 'auto' } }, h('div.pm-h', 'Menu + HP bar'), h('div.pm-i', '🔒 Lock (no move / resize)'), h('div.pm-sep'), h('div.pm-i', 'Hide this menu completely'), h('div.pm-i', 'Turn off this menu (back to the game’s own)'), h('div.pm-i.dis', 'Reset size and position'),
        h('div.pm-h', 'Size'), h('div.pm-chips', [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5].map((x) => h('div.pm-chip' + (x === 1 ? '.on' : ''), Math.round(x * 100) + '%'))), h('div.pm-h', 'Match height of'), h('div.pm-i', 'Skills  ·  384 px'));
    } });

  // ================================================================== TOASTS AND ALERTS
  const ALERT_ICON = { 'Quest ready': '📜', 'Lucky task reachable': '🍀', 'Materials short': '🧪' };
  function alistEl(ctx, list) {
    const al = list || ctx.M.alerts;
    const el = h('div.list.cc-alist', { style: { position: 'relative', left: 'auto', top: 'auto', display: 'flex', marginTop: '8px' } },
      h('div.cc-mh', 'Alerts', al.length > 1 ? h('button.cc-btn.sm', { type: 'button', 'data-v': 'quiet' }, 'Clear all') : null));
    if (!al.length) el.appendChild(h('div.none', 'Nothing needs your attention.'));
    al.forEach((a) => el.appendChild(h('div.cc-alert.it', h('span.cc-tile.sm', { style: { gridRow: '1 / span 3' } }, h('span.cc-ico', ALERT_ICON[a.title] || '❗')),
      h('span.ti', a.title), h('span.su', a.sub + ' · 2 min ago'), a.go ? h('button.cc-btn.go.sm.go', { type: 'button' }, '→ ' + a.go) : null, h('button.x', { type: 'button', title: 'Dismiss' }, '×'))));
    return el;
  }
  function bellEl(ctx, n, open) {
    return h('div#cc-alertbell' + (n > 0 ? '.has' : '') + (open ? '.open' : ''), { role: 'region', 'aria-label': 'Alerts', style: { position: 'relative', left: 'auto', top: 'auto', display: 'inline-block' } },
      h('div.bell.cc-bell', { role: 'button', tabindex: '0', 'aria-label': n ? n + ' alerts' : 'No alerts', title: n ? n + ' alerts' : 'No alerts' }, '🔔', h('span.n.cc-badge', n > 99 ? '99+' : String(n))),
      open ? alistEl(ctx) : null);
  }
  Lab.add({ id: 'alert-bell', cat: 'Toasts and alerts', title: 'Alert Bell', desc: 'The always-visible bell with a red number. It shakes once when a new alert arrives. Variant 1 follows the scenario (Alerts on the right); the others show a fixed count and the open list.', keywords: 'alert-bell cc-alertbell bell cc-bell badge alerts count none one firing',
    variants: [{ label: 'Bell, current scenario', k: 'cur' }, { label: 'Bell, three alerts waiting', k: 'three' }, { label: 'Bell, no alerts', k: 'none' }],
    render: (ctx, v) => bellEl(ctx, v.k === 'three' ? 3 : v.k === 'none' ? 0 : ctx.M.alerts.length, false) });

  Lab.add({ id: 'alert-list', cat: 'Toasts and alerts', title: 'Alert list', desc: 'The list that opens under the bell, or at the Alerts module of the Info Bar: one card per alert with an icon, what and why, a Go there button and a dismiss cross; Clear all appears from two alerts. Follows the Alerts scenario.', keywords: 'alert-bell cc-alist cc-alert list ti su go dismiss clear all peek empty',
    variants: [{ label: 'List, current scenario (opens under the bell)', k: 'cur' }, { label: 'List, three alerts', k: 'three' }, { label: 'List, empty', k: 'none' }],
    render: (ctx, v) => {
      const A = window.LabMock.ALERTS, al = v.k === 'three' ? A : v.k === 'none' ? [] : ctx.M.alerts;
      return h('div#cc-alertbell.open' + (al.length ? '.has' : ''), { style: { position: 'relative', left: 'auto', top: 'auto' } }, alistEl(ctx, al));
    } });

  Lab.add({ id: 'alert-ring', cat: 'Toasts and alerts', title: 'Alert ring and tag', desc: '"Go there" points, it never clicks: a pulsing ring around the game’s own button and a tag saying what to do there.', keywords: 'alert-bell cc-alert-ring cc-ring cc-alert-tag cc-ringtag pulse point show me',
    variants: [{ label: 'Ring and Tag, on a side menu button', box: [300, 190], k: 'btn' }, { label: 'Ring and Tag, on a bank slot', box: [300, 150], k: 'slot' }],
    render: (ctx, v) => {
      if (v.k === 'slot') return stage([h('div.lab-gbtn', { style: ABS({ left: '110px', top: '70px' }) }, img('items', 'stable_crystal')), h('div.cc-alert-ring.cc-ring', { style: ABS({ left: '105px', top: '65px', width: '52px', height: '52px' }) }), h('div.cc-alert-tag.cc-ringtag', { style: ABS({ left: '70px', top: '32px' }) }, 'Equip it from here')]);
      return stage([h('div.lab-gcol', { style: ABS({ left: '100px', top: '34px' }) }, ['bank', 'chest', 'combat'].map((n) => h('div.lab-gbtn', img('ui', n)))), h('div.cc-alert-ring.cc-ring', { style: ABS({ left: '95px', top: '71px', width: '52px', height: '52px' }) }), h('div.cc-alert-tag.cc-ringtag', { style: ABS({ left: '156px', top: '85px' }) }, 'Open it here')]);
    } });

  Lab.add({ id: 'raid-toast', cat: 'Toasts and alerts', title: 'Raid lobby toast', desc: 'A lobby with a free slot and a strong enough party: a toast at the top centre and a Windows notification. Open Raids only opens the game’s Raids browser; you press Join yourself. (Its stylesheet is created on first use; the declarations are copied in this lab.)', keywords: 'raid-alert cc-raid-toast raid lobby open toast notification open raids',
    variants: [{ label: 'Toast, dungeon lobby', box: [560, 100], k: 'd' }, { label: 'Toast, Fortress lobby', box: [560, 100], k: 'f' }],
    render: (ctx, v) => {
      const f = v.k === 'f' || ctx.S.mode === 'fortress' && v.k !== 'd', t = f ? 'Fortress · 2/4 · host Ashen · min Lv 60' : 'Battlefrost Smithy · 3/4 · host Ashen · min Lv 60';
      const ob = h('button', { type: 'button', style: 'margin-top:6px;padding:3px 12px;border-radius:7px;border:1px solid #6b5a2a;background:#2a2518;color:var(--cc-accent,#ffd24a);font:600 13px system-ui,sans-serif;cursor:pointer' }, 'Open Raids');
      return stage([h('div#cc-raid-toast', { style: { position: 'absolute', left: '50%', top: '12px', transform: 'translateX(-50%)', width: 'max-content' } }, '⚔ Raid lobby open', h('small', t), ob)]);
    } });

  // ================================================================== WIDGETS
  const SI_LOGO = '<svg style="vertical-align:-3px;margin-right:4px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16" height="16"><rect x="3" y="3" width="122" height="122" rx="28" fill="#23232f"/><rect x="46" y="22" width="48" height="12" fill="#ffd24a"/><rect x="34" y="34" width="24" height="12" fill="#ffd24a"/><rect x="34" y="46" width="24" height="12" fill="#ffd24a"/><rect x="46" y="58" width="36" height="12" fill="#ffd24a"/><rect x="70" y="70" width="24" height="12" fill="#b8760f"/><rect x="70" y="82" width="24" height="12" fill="#b8760f"/><rect x="34" y="94" width="48" height="12" fill="#b8760f"/><rect x="82" y="22" width="12" height="12" fill="#fff0b0"/></svg>';
  const SI_BUG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><ellipse cx="8" cy="9.5" rx="3.2" ry="4"/><path d="M8 5.5V13.5M4.8 8H2M11.2 8H14M5 11.5L2.8 13M11 11.5L13.2 13M5.5 4.8L4 3M10.5 4.8L12 3M6.5 5.2a1.6 1.6 0 0 1 3 0"/></svg>';
  const led = (k, v, s) => h('div.cc-si-row', h('span.k', h('span.cc-si-led.' + s), k), h('span.v', v));
  const sirow = (k, v, c) => h('div.cc-si-row', h('span.k', k), h('span.v' + (c ? '.' + c : ''), v));
  const sibar = (p, c) => h('div.cc-si-bar', h('i' + (c ? '.' + c : ''), { style: { width: p + '%' } }));
  function siEl(o) {
    const fps = o.fps || 60, cls = fps >= 50 ? 'good' : fps >= 30 ? 'mid' : 'low';
    const root = h('div#cc-status-indicator', { style: { position: 'relative', left: 'auto', bottom: 'auto' } }, h('div.cc-si-head', h('div.cc-si-dot.' + o.state), h('span.cc-si-fps.' + cls, fps + ' fps')));
    if (o.menu) {
      const bad = o.state === 'bad';
      root.insertBefore(h('div.cc-si-menu', { style: { display: 'block', maxHeight: 'none' } }, h('button.cc-si-bug', { type: 'button', title: 'Report a ScapeLite bug' }, html(SI_BUG)), h('div.cc-si-title', html(SI_LOGO), ' ScapeLite'), h('button.cc-si-reload', { type: 'button' }, '↻ Reload ScapeLite'),
        h('div.cc-si-rows', bad ? [led('Dashboard / watcher', 'Not reachable', 'bad')].concat(['Game connection', 'Chat relay', 'Clan hiscores', 'Raid summary', 'Activity digest', 'Plugins'].map((n) => led(n, '–', 'off'))) :
          [led('Watcher process', 'Running', 'ok'), led('Game connection', 'Connected', 'ok'), h('div.cc-si-sep'), led('Chat relay', 'last 4m ago', 'ok'), led('Clan hiscores', '#212 · 9m ago', 'ok'), led('Raid summary', '3 posted', 'ok'), led('Activity digest', 'next in 5h 12m', 'ok'), h('div.cc-si-sep'), led('Game bridge', 'Attached', 'ok'), led('Updates', 'v0.3.0 → 0.3.1 available', 'warn'), led('Plugins', '34/35 loaded', o.state === 'warn' ? 'warn' : 'ok')]),
        h('div.cc-si-perf', h('div.cc-si-ph', 'Performance'), sirow('Frame rate', fps + ' fps', 'ok'), sirow('Worst frame (last s)', '24 ms'), sirow('Slow frames (>50 ms), last min', '2'), sirow('JS memory', '412 MB'), sirow('Page elements', '31,204'),
          h('div.cc-si-ph', { style: { marginTop: '8px' } }, 'Where the main thread’s time goes'), sirow('Busy (not idle)', '38%'), sibar(38, 'g'), sirow('ScapeLite plugins', '4%', 'ok'), sibar(8, 'p'), sirow('Game scripts', '21%'), sibar(21), sirow('Browser / drawing', '13%'), sibar(13, 'b'),
          h('div.cc-si-note', 'Sampled 3s ago over 4.0 s. Percent of one CPU thread.')),
        h('button.cc-si-open-btn', { type: 'button' }, 'Open Dashboard ↗'), h('div.cc-si-url-row', h('span.cc-si-url', 'http://scapelite.localhost/'), h('button.cc-si-copy-btn', { type: 'button', title: 'Copy URL' }, '⧉')), h('div.cc-si-hint', o.state === 'warn' ? 'Connected, but nothing is configured yet.' : bad ? 'Is the supervisor / watcher process running? (start-watcher-hidden.vbs)' : '')), root.firstChild);
    }
    return root;
  }
  Lab.add({ id: 'status-indicator', cat: 'Widgets', title: 'Status indicator', desc: 'The corner badge: a breathing dot (green working, amber waiting, red broken) with the frame rate. Hover it and the menu opens above it: a light per feature, performance, the dashboard button.', keywords: 'status-indicator cc-status-indicator cc-si-dot cc-si-menu cc-si-led cc-si-row cc-si-fps corner badge watcher health fps',
    variants: [{ label: 'Badge, working (ok)', box: [110, 70], state: 'ok' }, { label: 'Badge, waiting (warn)', box: [110, 70], state: 'warn', fps: 38 }, { label: 'Badge, broken (bad)', box: [110, 70], state: 'bad', fps: 18 }, { label: 'Badge with its hover menu open', state: 'ok', menu: true }, { label: 'Hover menu, watcher not reachable', state: 'bad', menu: true, fps: 60 }],
    render: (ctx, v) => (v.box ? stage([h('div', { style: ABS({ left: '10px', bottom: '8px' }) }, siEl(v))], { background: '#1b2430' }) : siEl(v)) });

  // ================================================================== DOCKS AND HANDLES
  const GWC = [['🗺', 'map'], ['✎', 'edit'], ['☾', 'sleep'], ['✕', 'x']];
  const wcRow = (hot, st) => h('div.lab-gwc' + (hot ? '.hot' : ''), { style: st || null }, GWC.map(([g]) => h('div.lab-gbtn', g)));
  Lab.add({ id: 'window-controls-dock', cat: 'Docks and handles', title: 'Window controls dock', desc: 'The row of corner buttons becomes one dark pod while the pointer is over it: dots at the inner end to move, the corner to resize, an arrow at the wall end to tuck it away into a small tab; the tab can be dragged to another edge and a dashed preview shows where the row will land.', keywords: 'window-dock cc-wc-strip cc-wc-badge cc-wc-ghost mv sz ar window-controls handle grip dock tuck collapse flip lock',
    variants: [
      { label: 'Dock, resting (row only)', box: [320, 96], k: 'rest' }, { label: 'Dock, hover: Grip, Resize corner and Tuck arrow', box: [320, 96], k: 'hot' }, { label: 'Dock, on the left wall (flipped)', box: [320, 96], k: 'flip' },
      { label: 'Dock, tucked away: Badge on the edge', box: [320, 96], k: 'badge' }, { label: 'Dock, dragging the Badge: dashed preview', box: [320, 96], k: 'ghost' }],
    render: (ctx, v) => {
      const W = 220, Hh = 50;
      if (v.k === 'rest') return stage([h('div', { style: ABS({ right: '0', top: '20px' }) }, wcRow(false))]);
      if (v.k === 'hot') return stage([h('div', { style: ABS({ right: '15px', top: '20px' }) }, wcRow(true)), h('div#cc-wc-strip.show.hot', { style: ABS({ right: '0', top: '20px', width: (W + 33) + 'px', height: Hh + 'px', left: 'auto' }) }, h('span.mv'), h('span.sz'), h('span.ar', '›'))]);
      if (v.k === 'flip') return stage([h('div', { style: ABS({ left: '15px', top: '20px' }) }, wcRow(true)), h('div#cc-wc-strip.show.hot.flip', { style: ABS({ left: '0', top: '20px', width: (W + 33) + 'px', height: Hh + 'px' }) }, h('span.mv'), h('span.sz'), h('span.ar', '‹'))]);
      if (v.k === 'badge') return stage([h('div#cc-wc-badge.show', { style: ABS({ right: '0', top: '35px', width: '20px', height: '50px', borderRadius: '8px 0 0 8px' }) }, '‹')]);
      return stage([h('div#cc-wc-badge.show', { style: ABS({ right: '0', top: '35px', width: '20px', height: '50px', borderRadius: '8px 0 0 8px' }) }, '‹'), h('div#cc-wc-ghost', { style: 'position:absolute;left:60px;top:8px;width:220px;height:50px;box-sizing:border-box;pointer-events:none;border:2px dashed var(--cc-accent,#ffd24a);border-radius:10px;background:rgba(255,210,74,.10);box-shadow:0 0 16px rgba(255,210,74,.35)' })]);
    } });

  Lab.add({ id: 'potion-dock-handle', cat: 'Docks and handles', title: 'Potion dock handle', desc: 'A small grip on the left edge of the game’s Active Potions panel appears while the pointer is over it: drag to move, double-click to reset, right-click to lock.', keywords: 'window-dock cc-pot-handle potions dock handle grip active-potions-panel move lock',
    variants: [{ label: 'Handle, hover', box: [220, 110], k: 'hot' }, { label: 'Handle, pointer on the Handle (accent)', box: [220, 110], k: 'acc' }],
    render: (ctx, v) => stage([h('div.lab-gpot', { style: ABS({ left: '40px', top: '16px', width: '150px' }) }, [['lobster', '18.2k'], ['calm_potion', '12 doses'], ['haste_potion', '3 doses']].map(([n, t]) => h('div', img('items', n), t))),
      h('div#cc-pot-handle.show.hot', { style: ABS({ left: '24px', top: '22px', color: v.k === 'acc' ? 'var(--cc-accent,#ffd24a)' : null }) })]) });

  function menuDockEl(ctx, k) {
    const f = ctx.M.hp / ctx.M.hpMax, n = 6, hpH = n * 42;
    const btns = ['combat', 'chest', 'bank', 'raid_dungeon', 'raid_gauntlet', 'combat'].map((g, i) => h('div.lab-gbtn' + (i === 2 ? '.active' : ''), { style: { borderRadius: '6px 0 0 6px', borderTop: '1.58px solid #2a2a38' } }, img('ui', g), h('kbd', 'ZCVBNM'[i])));
    const grip = h('div#cc-dock-grip.cc-dock-grip' + (k === 'drag' ? '.drag' : ''), { 'data-panel-id': 'menudock', style: ABS({ left: '0', top: '0', width: '66px', opacity: k === 'drag' ? '1' : null }) },
      h('span.gb', k === 'lock' ? '🔒' : '⠇⠇'), h('span.panel-titlebar-btns', k === 'fuse' ? h('button.panel-titlebar-btn.cc-fuse-btn.fused', { type: 'button' }, html('<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 9.5l3-3M5.2 7.2L3.6 8.8a2.4 2.4 0 003.4 3.4l1.6-1.6M10.8 8.8l1.6-1.6A2.4 2.4 0 009 3.8L7.4 5.4"/></svg>'), h('span.cc-fa', '←')) : null));
    const sizer = h('div#cc-dock-size' + (k === 'size' ? '.drag' : ''), { style: ABS({ left: '-1px', top: '17px' }) });
    const body = h('div', { style: ABS({ left: '0', top: '18px' }) }, h('div', { style: { display: 'flex' } }, h('div.lab-ghp', { style: { height: hpH + 'px' } }, h('i', { style: { height: Math.round(f * 100) + '%', background: f < 0.25 ? '#e5533d' : f < 0.5 ? '#ffb21e' : '#2f9e44' } }), h('b', h('div', String(ctx.M.hp)), h('div', '/'), h('div', String(ctx.M.hpMax)))), h('div.lab-gcol', btns)));
    return stage([body, grip, sizer], { background: '#1b2430' });
  }
  Lab.add({ id: 'menu-dock', cat: 'Docks and handles', title: 'Menu dock (vertical menu and HP bar)', desc: 'The bottom-right vertical menu and the HP bar behave as one panel: a Grip strip above it moves it, a corner Resize grip scales it, link buttons for Panel Fuse appear in the strip. The HP strip follows the Hit points scenario.', keywords: 'menu-dock cc-dock-grip cc-dock-size cc-vmenu panel-tab-bar hp-bar grip handle size fuse lock vertical menu hp strip',
    variants: [{ label: 'Dock, resting', box: [96, 300], k: 'rest' }, { label: 'Dock, dragging the Grip', box: [96, 300], k: 'drag' }, { label: 'Dock, dragging the Resize grip', box: [96, 300], k: 'size' }, { label: 'Dock, locked', box: [96, 300], k: 'lock' }, { label: 'Dock, fused to a panel', box: [96, 300], k: 'fuse' }],
    render: (ctx, v) => menuDockEl(ctx, v.k) });

  Lab.add({ id: 'notif-dock', cat: 'Docks and handles', title: 'Notification dock', desc: 'The game’s pop-ups (invite tray, task-complete popups, toasts) are raised above everything and centred. A strip above the invite tray moves it; "Move notifications" shows a dashed frame for each of the three and a bar with Reset all and Done.', keywords: 'notif-dock cc-nd-grip cc-nd-frame cc-nd-bar invite tray celebration dash-toast move notifications edit',
    variants: [{ label: 'Grip, over the invite tray', box: [400, 120], k: 'grip' }, { label: 'Edit mode: Frames and Bar', box: [720, 280], k: 'edit' }],
    render: (ctx, v) => {
      if (v.k === 'grip') return stage([h('div.cc-nd-grip', { style: ABS({ left: '50px', top: '24px', width: '300px', opacity: '1' }) }, '⠇⠇ move'), h('div.lab-ginv', { style: ABS({ left: '50px', top: '40px', width: '300px', height: '56px' }) }, h('b', 'Ashen'), 'invites you to a raid', h('span', { style: { marginLeft: 'auto', color: '#5fe06d' } }, 'Accept'))]);
      return stage([h('div.cc-nd-frame', { style: ABS({ left: '110px', top: '10px', width: '300px', height: '70px' }) }, 'Invites'), h('div.cc-nd-frame.drag', { style: ABS({ left: '50px', top: '96px', width: '420px', height: '90px' }) }, 'Task popups'), h('div.cc-nd-frame', { style: ABS({ left: '180px', top: '190px', width: '300px', height: '40px' }) }, 'Toasts'),
        h('div.cc-nd-bar', { style: ABS({ left: '50%', bottom: '10px', transform: 'translateX(-50%)', width: 'max-content' }) }, h('span', 'Drag the frames to where you want each notification. Double-click a frame to reset it.'), h('button', 'Reset all'), h('button.primary', 'Done'))]);
    } });

  Lab.add({ id: 'modal-resize', cat: 'Docks and handles', title: 'Window title bar and resize grip', desc: 'A game window (Bank, Settings, Skills Customization ...) gets a title bar of its own above it when it is not fullscreen: drag to move, see-through, fullscreen and close buttons, plus a corner Resize grip and a size label while resizing; at 94% the label says "fullscreen" and releasing snaps. (This replaces the earlier Float button.)', keywords: 'modal-resize cc-modal-win cc-mw-h cc-mw-lbl window title bar grip resize see-through fullscreen snap float lock',
    variants: [{ label: 'Title bar and Resize grip', box: [420, 230], k: 'bar' }, { label: 'Title bar, locked', box: [420, 230], k: 'lock' }, { label: 'Resize label while dragging', box: [420, 230], k: 'lbl' }, { label: 'Resize label, snap to fullscreen', box: [420, 230], k: 'snap' }, { label: 'Title bar, see-through on', box: [420, 230], k: 'see' }],
    render: (ctx, v) => {
      const L = 30, T = 34, W = 360, Hh = 170, lock = v.k === 'lock';
      const bar = h('div#cc-modal-win' + (lock ? '' : ''), { role: 'toolbar', 'data-cc-locked': lock ? '' : null, style: ABS({ display: 'block', left: L + 'px', top: (T - 30) + 'px', width: W + 'px' }) }, h('div.hd', h('b', 'Skills Customization'), h('button.cc-ib', { type: 'button', 'aria-pressed': v.k === 'see' ? 'true' : 'false', title: 'See-through' }, '👁'), h('button.cc-ib', { type: 'button', title: 'Fullscreen' }, '▢'), h('button.cc-ib', { type: 'button', title: 'Close' }, '×')));
      const win = h('div.lab-gmodal', { style: ABS({ left: L + 'px', top: T + 'px', width: W + 'px', height: Hh + 'px' }) }, h('div.lab-gmb', 'Skill levers, slay weights and the rest of the game’s own window.'));
      const kids = [win, bar];
      if (!lock) kids.push(h('div.cc-mw-h', { 'data-d': 'se', title: 'Drag to resize this window', style: ABS({ display: 'block', left: (L + W - 16) + 'px', top: (T + Hh - 16) + 'px', width: '16px', height: '16px', opacity: v.k === 'lbl' || v.k === 'snap' ? '1' : null }) }));
      if (v.k === 'lbl' || v.k === 'snap') kids.push(h('div#cc-mw-lbl' + (v.k === 'snap' ? '.snap' : ''), { style: ABS({ display: 'block', left: (L + W - 40) + 'px', top: (T + Hh + 6) + 'px' }) }, v.k === 'snap' ? '95% × 94% → fullscreen' : '68% × 72%'));
      return stage(kids, { background: '#0b0b12' });
    } });

  const gtb = (title, btns) => h('div.lab-gtb', h('span.panel-titlebar-label', title), h('div.panel-titlebar-btns', btns || []));
  const gpanel = (title, btns, st, kids) => h('div.lab-gpanel', { style: ABS(st) }, gtb(title, btns), h('div.lab-gbody', kids || 'Panel contents'));
  const lockBtn = (on) => h('button.panel-titlebar-btn.cc-lock-btn' + (on ? '.locked' : ''), { type: 'button', title: on ? 'Locked – click to unlock this panel' : 'Lock this panel’s position and size' }, html(LOCK_SVG));
  Lab.add({ id: 'panel-resize-handles', cat: 'Docks and handles', title: 'Panel scale handle and size badges', desc: 'A corner Handle appears while the pointer is over a game panel: drag to scale it (a size label shows), double-click to reset. While one panel is being resized, every panel shows a size badge: blue = the one you drag, green "=" = same height, amber = within 3 px.', keywords: 'panel-resize cc-ps-handle cc-ps-bl cc-ps-label cc-ps-badge cc-ps-drag cc-ps-show scale handle corner badge resize game panel',
    variants: [{ label: 'Handle, bottom-right, hover', box: [260, 150], k: 'hover' }, { label: 'Handle, dragging, with its size label', box: [260, 150], k: 'drag' }, { label: 'Handle, bottom-left corner', box: [260, 150], k: 'bl' }, { label: 'Size badges while resizing (dragged, equal, near)', box: [420, 150], k: 'badges' }],
    render: (ctx, v) => {
      if (v.k === 'badges') {
        const b = (c, t) => h('div.cc-ps-badge' + (c ? '.' + c : ''), { style: ABS({ left: '6px', top: '28px' }) }, t);
        return stage([gpanel('Skills', [], { left: '10px', top: '14px', width: '120px', height: '110px' }), gpanel('Goals', [], { left: '140px', top: '14px', width: '120px', height: '110px' }), gpanel('Equipment', [], { left: '270px', top: '14px', width: '120px', height: '112px' }),
          b('drag', '120×110'), h('div', { style: ABS({ left: '130px', top: '0' }) }, b('eq', '120×110  =')), h('div', { style: ABS({ left: '260px', top: '0' }) }, b('near', '120×112  +2'))]);
      }
      const bl = v.k === 'bl', drag = v.k === 'drag';
      return stage([gpanel('Skills', [lockBtn(false)], { left: '40px', top: '14px', width: '170px', height: '112px' }),
        h('div.cc-ps-handle.cc-ps-show' + (bl ? '.cc-ps-bl' : '') + (drag ? '.cc-ps-drag' : ''), { style: ABS({ left: (bl ? 40 : 210 - 14) + 'px', top: (126 - 14) + 'px' }) }, h('span.cc-ps-label', '170×112 · 110%'))]);
    } });

  Lab.add({ id: 'panel-lock-button', cat: 'Docks and handles', title: 'Panel lock button', desc: 'A padlock in the title bar of every game panel: faint when free, bright gold when locked (no move, no resize). Also the inventory and task counters next to the title.', keywords: 'panel-resize cc-lock-btn locked titlebar lock cc-inv-count counter',
    variants: [{ label: 'Lock button, free', box: [220, 70], k: 0 }, { label: 'Lock button, locked', box: [220, 70], k: 1 }],
    render: (ctx, v) => stage([gpanel('Inventory', [lockBtn(!!v.k)], { left: '10px', top: '12px', width: '200px', height: '48px' })]) });

  Lab.add({ id: 'panel-snap-guides', cat: 'Docks and handles', title: 'Snap guides, Fuse chip and size match guides', desc: 'Moving a panel near another shows gold guide lines; when two panels end up touching a "Fuse" chip appears on their seam for a few seconds. Resizing a ScapeLite panel to another panel’s height shows a guide and a label.', keywords: 'panel-resize ui-scale cc-snap-guide cc-snap-chip cc-snapk cc-snapk-lbl fuse chip guide snap match height',
    variants: [{ label: 'Snap guides and the Fuse chip', box: [440, 170], k: 'fuse' }, { label: 'Size match guide and its label', box: [440, 170], k: 'match' }],
    render: (ctx, v) => {
      if (v.k === 'match') return stage([gpanel('Goals', [], { left: '20px', top: '20px', width: '170px', height: '120px' }), gpanel('Route Advisor', [], { left: '230px', top: '20px', width: '170px', height: '120px' }), h('div.cc-snapk', { style: ABS({ left: '20px', top: '140px', width: '380px', height: '2px' }) }), h('div.cc-snapk-lbl', { style: ABS({ left: '300px', top: '124px' }) }, '= Goals · 312 px')]);
      return stage([gpanel('Goals', [], { left: '20px', top: '20px', width: '170px', height: '120px' }), gpanel('Skills', [], { left: '190px', top: '20px', width: '170px', height: '120px' }), h('div.cc-snap-guide', { style: ABS({ left: '189px', top: '10px', width: '2px', height: '140px' }) }), h('div.cc-snap-guide', { style: ABS({ left: '10px', top: '19px', width: '360px', height: '2px' }) }),
        h('button.cc-snap-chip', { type: 'button', style: ABS({ left: '190px', top: '80px', animation: 'none' }) }, html('<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 9.5l3-3M5.2 7.2L3.6 8.8a2.4 2.4 0 003.4 3.4l1.6-1.6M10.8 8.8l1.6-1.6a2.4 2.4 0 00-3.4-3.4L7.4 5.4"/></svg>'), 'Fuse')]);
    } });

  Lab.add({ id: 'scale-grip', cat: 'Docks and handles', title: 'ScapeLite panel resize grip', desc: 'The corner grip of a ScapeLite panel (xp tracker, goals, route advisor, cards ...): faint L-shaped corner that brightens when the pointer is over the panel; locked panels have none.', keywords: 'ui-scale cc-rz grip resize corner panel cc-panel cc-grip',
    variants: [{ label: 'Resize grip, pointer over the Panel', k: 'hover' }, { label: 'Resize grip, dragging', k: 'drag' }],
    render: (ctx, v) => ctx.watch(h('div.cc-panel.show', { style: { width: '260px', height: '120px' } }, h('div.hd', h('b', 'Goals'), h('button.min', { type: 'button' }, '–'), h('button.x', { type: 'button' }, '×')), h('div.bd', 'Panel contents'), h('div.cc-rz' + (v.k === 'drag' ? '.drag' : ''), { style: { opacity: '1', borderColor: v.k === 'drag' ? 'rgba(255,255,255,.7)' : null } }))) });

  const FUSE_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 9.5l3-3M5.2 7.2L3.6 8.8a2.4 2.4 0 003.4 3.4l1.6-1.6M10.8 8.8l1.6-1.6A2.4 2.4 0 009 3.8L7.4 5.4"/></svg>';
  const fuseBtn = (arrow, fused, name) => h('button.panel-titlebar-btn.cc-fuse-btn' + (fused ? '.fused' : ''), { type: 'button', 'data-dir': 'r', title: fused ? 'Fused with ' + name + ' – click to separate' : 'Fuse with ' + name + ' (move together, cleaner seam)' }, html(FUSE_SVG), h('span.cc-fa', arrow));
  Lab.add({ id: 'panel-fuse-buttons', cat: 'Docks and handles', title: 'Panel fuse buttons (game panels)', desc: 'Two game panels that touch get a link button in the title bar. Click it to fuse them (they move together, the seam is cleaner); gold = fused. With several neighbours the buttons read left, up, down, right.', keywords: 'panel-fuse cc-fuse-btn cc-fa fused title bar link game panels fuse unfuse',
    variants: [{ label: 'Fuse button, touching (offered)', k: 0 }, { label: 'Fuse button, fused (gold)', k: 1 }, { label: 'Fuse buttons, two neighbours (left, down)', k: 2 }],
    render: (ctx, v) => h('div.lab-game', { style: { width: '230px', borderRadius: '6px', border: '1.58px solid #2a2a38' } },
      gtb('Skills', v.k === 2 ? [fuseBtn('←', false, 'Goals'), fuseBtn('↓', true, 'Equipment'), lockBtn(false)] : [fuseBtn('→', v.k === 1, 'Goals'), lockBtn(false)])) });

  Lab.add({ id: 'card-fuse-links', cat: 'Docks and handles', title: 'Panel fuse link (ScapeLite panels)', desc: 'Two ScapeLite panels edge to edge get a round link button on their seam (shown while the pointer is near, or for a few seconds after a move). Fused: corners squared, one border line, accent-filled button; they move and snap as one.', keywords: 'card-fuse cc-fuse-link data-cc-fuse seam fused panels cc-panel link button vis on',
    variants: [{ label: 'Link, touching panels (offered)', k: 'off' }, { label: 'Link, fused (seam closed)', k: 'fused' }, { label: 'Link, fused below', k: 'below' }],
    render: (ctx, v) => {
      const p = (t, side, st) => ctx.watch(h('div.cc-panel.show', { 'data-cc-fuse': side || null, style: st }, h('div.hd', h('b', t)), h('div.bd', 'Panel contents')));
      if (v.k === 'below') return h('div', { style: { position: 'relative', width: '220px' } }, p('Route Advisor', 'b', { width: '220px', height: '84px' }), p('Goals', 't', { width: '220px', height: '84px' }), h('button.cc-fuse-link.vis.on', { type: 'button', title: 'Unfuse these panels', style: ABS({ left: '110px', top: '84px' }) }, html('<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>')));
      const f = v.k === 'fused';
      return h('div', { style: { position: 'relative', display: 'flex', width: '400px', gap: f ? '0' : '2px' } }, p('Goals', f ? 'r' : null, { width: '200px', height: '120px' }), p('Skills', f ? 'l' : null, { width: '200px', height: '120px' }),
        h('button.cc-fuse-link.vis' + (f ? '.on' : ''), { type: 'button', title: f ? 'Unfuse these panels' : 'Fuse these panels so they move together', style: ABS({ left: '200px', top: '60px' }) }, html('<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>')));
    } });

  Lab.add({ id: 'sidebar-tab-controls', cat: 'Windows', title: 'Settings > Hotkeys: side menu tab controls', desc: 'Each left-strip row of Settings > Hotkeys gets a Pin (stays visible when the strip is minimised) and a switch (show or hide the icon). The note under the heading and the "Go to Hotkeys" button sit in the Plugins section. The game’s own switch and rows are drawn as stand-ins.', keywords: 'sidebar-tabs cc-sb-ctl cc-sb-pin cc-sb-note cc-sb-go settings-switch hotkeys left panels pin sticky switch',
    variants: [{ label: 'Rows: pinned and shown, shown, hidden', k: 'rows' }, { label: 'Note and Go button', k: 'note' }],
    render: (ctx, v) => {
      const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2v2h1v6l-3 3v2h4.5v5h1v-5H17v-2l-3-3V4h1V2z"></path></svg>';
      const row = (nm, key, pin, on) => h('div.lab-hkrow.settings-hotkey-row', nm, h('span.lab-hkk', key), h('span.cc-sb-ctl', h('div.cc-sb-pin' + (pin ? '.on' : ''), { title: 'Sticky: stays visible when the side menu is minimized' }, html(PIN)), h('div.settings-switch' + (on ? '.on' : ''), h('div.settings-switch-knob'))));
      if (v.k === 'note') return h('div.lab-game', { style: { width: '460px' } }, h('div.cc-sb-note', 'Side menu: use the switch to show / hide an icon, and the pin to keep it visible when the menu is minimized (arrow at the top).'), h('button.cc-sb-go', { type: 'button' }, 'Go to Hotkeys › Left Panels'));
      return h('div.lab-game', null, row('Bank', 'B', true, true), row('Skills', 'K', false, true), row('Quests', 'Q', false, false));
    } });

  Lab.add({ id: 'sidebar-tab-drag', cat: 'Docks and handles', title: 'Side menu icon drag', desc: 'Drag an icon of the left strip to a new place: the icon stays dimmed where it was, a ghost follows the pointer and a line with two dots shows where it lands.', keywords: 'sidebar-tabs cc-sb-ghost cc-sb-ins cc-sb-dragsrc reorder drag drop line left strip',
    variants: [{ label: 'Drag: Ghost and the drop-target line', box: [180, 270] }],
    render: () => stage([h('div.lab-gcol', { style: ABS({ left: '20px', top: '10px' }) }, ['bank', 'chest', 'combat', 'raid_dungeon', 'raid_gauntlet'].map((n, i) => h('div.lab-gbtn' + (i === 1 ? '.cc-sb-dragsrc' : ''), img('ui', n)))),
      h('div.cc-sb-ins', { 'data-ax': 'y', style: ABS({ left: '18px', top: '136px', width: '46px', height: '3px' }) }), h('div.lab-gbtn.cc-sb-ghost', { style: ABS({ left: '90px', top: '120px', transform: 'none' }) }, img('ui', 'chest'))]) });

  // ================================================================== OVERLAYS
  Lab.add({ id: 'queue-walk', cat: 'Overlays', title: 'Queue walking time', desc: 'On the game’s own queue: a thin bar along the top edge of every queued card (fading at both ends, thicker and redder the longer the walk) and a tag between it and the task above (green short, red long, purple = the game would teleport). Hover a tag to enlarge it and see the steps. A button in the queue header switches it on and off. Follows the queue scenario.', keywords: 'queue-walk cc-qw-bar cc-qw-tag cc-qw-btn uq-row walking time steps teleport relative walking bars queue',
    variants: [{ label: 'Bars and Tags, absolute (teleport threshold = full bar)', k: 'abs' }, { label: 'Bars and Tags, relative (longest walk = full bar)', k: 'rel' }, { label: 'Tag, hover (enlarged, with the steps)', k: 'hov' }],
    render: (ctx, v) => {
      const rows = ctx.M.queue.slice(1, 5), speed = 17.6, fmt = (s) => { s = Math.round(s); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
      const colorOf = (f) => (f < 0.2 ? '#5fe06d' : f < 0.45 ? '#ffd24a' : f < 0.75 ? '#ff9a3c' : '#ff5a4d');
      const maxD = Math.max(1, ...rows.map((r) => r.walk.steps)), full = v.k === 'rel' ? maxD : 12000;
      const head = h('div.lab-guqh', 'Task queue');
      const btn = h('div.cc-qw-btn.active', { title: 'Hide the walking time between queued tasks', style: ABS({ right: '34px', top: '6px' }) }, '🚶'), btn2 = h('div.cc-qw-btn', { style: ABS({ right: '10px', top: '6px' }) }, '🚶');
      const cards = rows.map((r, i) => {
        const o = r.opts[0], f = Math.max(0.02, Math.min(1, r.walk.steps / full)), tp = i === 2 && v.k !== 'rel', col = tp ? '#b57cff' : colorOf(f), hov = v.k === 'hov' && i === 0;
        const tag = h('div.cc-qw-tag', { style: { background: col, transform: hov ? 'translateX(-50%) scale(1.6)' : null, zIndex: hov ? '60' : null } }, tp ? '⚡ teleport' : '🚶 ' + fmt(r.walk.steps / speed), hov ? h('span.m', { style: { display: 'inline' } }, ' · ' + r.walk.steps.toLocaleString('en-US') + ' steps') : null);
        const bar = h('div.cc-qw-bar', { style: { height: (2 + 3 * f).toFixed(1) + 'px', background: 'linear-gradient(90deg, transparent 0%, ' + col + ' 22%, ' + col + ' 78%, transparent 100%)' } });
        return h('div.uq-row.cc-qw', { style: { position: 'relative' } }, img('skills', o.skill), h('div', h('b', o.name + ' ×' + o.qty), h('span', pretty(o.skill) + ' · ' + o.place)), bar, tag);
      });
      if (!rows.length) return h('div.lab-game', h('div.lab-gpanel', { style: { position: 'relative', padding: '14px' } }, 'The queue is empty: no walking tags. (Pick a bigger queue in the scenario.)'));
      return h('div.lab-game', { style: { position: 'relative', width: '380px' } }, h('div.lab-guq', { style: { position: 'relative' } }, head, btn, btn2, cards));
    } });

  // ================================================================== registry ids (design-lab/names.json) each specimen renders
  const IBM = ['info-bar.module', 'info-bar.module.icon', 'info-bar.module.text', 'info-bar.module.progress-line'];
  const COV = {
    'info-bar-top': ['info-bar', 'info-bar.top', 'info-bar.left-zone', 'info-bar.middle-zone', 'info-bar.right-zone', 'info-bar.task-module', 'info-bar.location-module', 'info-bar.hit-points-module', 'info-bar.active-potions-module', 'info-bar.gold-module', 'info-bar.xp-per-hour-module', 'info-bar.alerts-module', 'info-bar.panel-buttons-module', 'info-bar.clock-module', 'info-bar.inventory-space-module'].concat(IBM),
    'info-bar-bottom': ['info-bar', 'info-bar.bottom', 'info-bar.chat-module', 'info-bar.panel-buttons-module', 'info-bar.hover-card'],
    'info-bar-heights': ['info-bar', 'info-bar.height'],
    'info-bar-modules': ['info-bar.module', 'module.active', 'module.dragging', 'module.clickable', 'attention', 'insertion-marker', 'info-bar.spacer-module', 'info-bar.chat-module', 'info-bar.game-event-module', 'info-bar.inventory-space-module', 'info-bar.location-module', 'info-bar.clock-module', 'info-bar.task-module', 'info-bar.xp-per-hour-module', 'info-bar.alerts-module'].concat(IBM),
    'info-bar-panel-buttons': ['info-bar.panel-buttons-module', 'info-bar.panel-buttons-module.panel-button', 'info-bar.panel-buttons-module.panel-button.attention-dot', 'panel-buttons.look', 'panel-buttons.style', 'insertion-marker'],
    'info-bar-hp': ['info-bar.hit-points-module', 'info-bar.module.progress-line'],
    'info-bar-card': ['info-bar.hover-card', 'info-bar.hover-card.header', 'info-bar.hover-card.cell'],
    'info-bar-detail-card': ['task-options-hover-card', 'task-options-hover-card.option-block', 'task-options-hover-card.option-block.stat-tiles'],
    'info-bar-menu': ['info-bar-menu'], 'alert-bell-menu': ['alert-bell-menu'], 'scapelite-menu': ['logo-menu', 'logo-menu.item', 'logo-button', 'game-left-icon-strip'],
    'settings-nav-menu': ['settings-quick-jump-menu', 'settings-quick-jump-menu.item', 'settings-quick-jump-menu.heading', 'jump-flash'],
    'sidebar-group-menu': ['icon-group-flyout', 'game-left-icon-strip', 'game-left-icon-strip.button'], 'sidebar-tab-menu': ['game-left-icon-strip.button', 'sidebar-pin'],
    'panel-title-menu': ['panel-title-menu', 'game-panel-menu', 'game-floating-panel.titlebar'], 'dock-menu': ['window-controls-dock.strip', 'potions-dock-handle', 'menu-dock.handle', 'game-panel-menu'],
    'alert-bell': ['alert-bell', 'alert-bell.bell-button', 'alert-bell.bell-button.count-badge', 'alert-bell.has-alerts', 'alert-bell.bell-hidden'],
    'alert-list': ['alert-bell.alert-list', 'alert-bell.alert-list.heading', 'alert-bell.alert-list.empty-text', 'alert-item', 'alert-bell.open'],
    'alert-ring': ['alert-ring', 'alert-ring-tag'], 'raid-toast': ['raid-lobby-toast'],
    'status-indicator': ['status-indicator', 'status-indicator.head', 'status-indicator.head.dot', 'status-indicator.head.fps', 'status-indicator.dot-colour', 'status-indicator-popup', 'status-indicator-popup.reload-button', 'status-indicator-popup.bug-button', 'status-indicator-popup.rows', 'status-indicator-popup.performance', 'status-indicator-popup.open-buttons', 'status-indicator-popup.url-row'],
    'window-controls-dock': ['window-controls-dock', 'window-controls-dock.strip', 'window-controls-dock.strip.move-handle', 'window-controls-dock.strip.resize-grip', 'window-controls-dock.strip.collapse-arrow', 'window-controls-dock.badge', 'window-controls-dock.ghost', 'game-window-controls'],
    'potion-dock-handle': ['potions-dock-handle', 'game-active-potions-panel'],
    'menu-dock': ['menu-dock', 'menu-dock.handle', 'menu-dock.resize-grip', 'game-panel-tab-bar', 'game-hp-bar', 'fuse-button', 'mode.fused'],
    'notif-dock': ['notification-dock', 'notification-dock.handle', 'notification-dock.frame', 'notification-edit-bar', 'game-invite-tray', 'game-task-popup', 'game-dashboard-toast'],
    'modal-resize': ['window-title-bar', 'window-resize-grip', 'window-edge-handles', 'window-size-label', 'game-window', 'mode.floating-window'],
    'panel-resize-handles': ['game-panel-resize-grip', 'game-floating-panel'], 'panel-lock-button': ['game-panel-lock-button', 'game-floating-panel.titlebar'],
    'panel-snap-guides': ['game-panel-snap-guide', 'game-panel-snap-chip', 'snap-guide'], 'scale-grip': ['panel.grip'],
    'panel-fuse-buttons': ['fuse-button', 'game-floating-panel.titlebar', 'mode.fused'], 'card-fuse-links': ['fuse-link', 'fuse-link.visible', 'seam', 'mode.fused'],
    'sidebar-tab-controls': ['sidebar-pin'], 'sidebar-tab-drag': ['game-left-icon-strip', 'game-left-icon-strip.button', 'insertion-marker'],
    'queue-walk': ['walking-bar', 'walking-tag', 'game-tasks-panel.walking-toggle-button', 'game-tasks-panel.row'],
  };
  Lab.specs.forEach((s) => { if (COV[s.id]) s.covers = COV[s.id]; });
  // verify every id against the registry once it is loaded (console only)
  fetch('names.json').then((r) => r.json()).then((l) => { const have = new Set(l.map((x) => x.id)); const bad = []; Object.keys(COV).forEach((k) => COV[k].forEach((i) => { if (!have.has(i)) bad.push(k + ':' + i); })); if (bad.length) console.warn('[spec-bars] covers ids not in names.json', bad); }).catch(() => {});
})();
