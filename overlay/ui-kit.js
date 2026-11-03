// ScapeLite UI kit (window.__ccUI). One place for what every ScapeLite panel needs: design tokens (colours, shape, type, density, accent), small DOM helpers
// and a `panel()` component with a header, drag (kept on screen), position / collapse / open memory, close and collapse buttons, and registration with
// ui-scale (scale, resize handle, bring-to-front, Escape, right-click size menu). A panel built with it needs no CSS or boilerplate of its own.
// Display only: nothing here talks to the game.
(function () {
  'use strict';
  const NS = '__ccUI';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) {}
  const life = window.__ccLife.scope('ui-kit');   // page listeners and timers go through it: a re-inject cannot leave a second copy
  const setting = (k, d) => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get(k); return v === undefined ? d : v; } catch (e) { return d; } };

  // ---------------------------------------------------------------- store: one JSON blob per panel
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('cc-ui:' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cc-ui:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: the panel still works */ } },
  };

  // ---------------------------------------------------------------- helpers (one copy for every plugin)
  const h = (tag, cls, text, attrs) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const fmt = {
    num: (n) => Math.round(n).toLocaleString('en-US'),
    short: (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString('en-US')),
    dur: (sec) => { const s = Math.round(sec); if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m < 60 ? m + 'm ' + String(s % 60).padStart(2, '0') + 's' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; },
    // The one clock setting (Settings > Panels > Clock Format, asked in the welcome setup): every ScapeLite clock reads it. The Info Bar clock module keeps its own options.
    h12: () => { try { return String(window.__ccPluginSettings.get('clockFormat')) === '12'; } catch (e) { return false; } },
    clock: (d, sec) => { const t = d instanceof Date ? d : new Date(d), p = (v) => String(v).padStart(2, '0'), h = t.getHours(), twelve = fmt.h12(); return (twelve ? String(h % 12 || 12) : p(h)) + ':' + p(t.getMinutes()) + (sec ? ':' + p(t.getSeconds()) : '') + (twelve ? (h >= 12 ? ' pm' : ' am') : ''); },
    pct: (p) => (p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p >= 0.0001 ? (p * 100).toFixed(2) : '<0.01') + '%',
  };

  // ---------------------------------------------------------------- tokens
  const style = document.createElement('style');
  style.id = 'cc-ui-tokens';
  style.textContent = `
:root{--cc-bg:#10101a;--cc-bg-2:#161620;--cc-bg-3:#1c1c28;--cc-bg-hover:#262636;--cc-border:#2e2e42;--cc-border-strong:#4a4a62;
--cc-text:#dcdce8;--cc-text-dim:#8f8fa4;--cc-text-faint:#707086;--cc-accent:#ffd24a;--cc-accent-bg:#2a2518;--cc-accent-ink:#241a00;
--cc-good:#5fe06d;--cc-warn:#ffb84a;--cc-bad:#ff8a5c;--cc-info:#4aa8ff;--cc-magic:#b07cff;
--cc-r:12px;--cc-r-sm:8px;--cc-r-xs:5px;--cc-shadow:0 14px 40px rgba(0,0,0,.7);
--cc-font:system-ui,-apple-system,'Segoe UI',sans-serif;--cc-fs:14px;--cc-fs-sm:12.5px;--cc-fs-xs:11.5px;--cc-fs-lg:16px;
--cc-gap:8px;--cc-pad:12px;--cc-row-pad:6px 10px;--cc-z-panel:1100;--cc-ease:.15s ease}
html[data-cc-density=compact]{--cc-gap:5px;--cc-pad:9px;--cc-row-pad:3px 8px;--cc-fs:13px;--cc-fs-sm:11.5px}
html[data-cc-density=roomy]{--cc-gap:11px;--cc-pad:15px;--cc-row-pad:8px 12px;--cc-fs:15px;--cc-fs-sm:13.5px}
@media (prefers-reduced-motion:reduce){:root{--cc-ease:0s}}
.cc-panel{position:fixed;z-index:var(--cc-z-panel);display:none;flex-direction:column;box-sizing:border-box;min-width:220px;max-width:min(94vw,640px);background:var(--cc-bg);border:1px solid var(--cc-border);border-radius:var(--cc-r);box-shadow:var(--cc-shadow);color:var(--cc-text);font:var(--cc-fs)/1.4 var(--cc-font);overflow:hidden}
.cc-panel.show{display:flex}
.cc-panel .hd{display:flex;align-items:center;gap:var(--cc-gap);padding:9px var(--cc-pad);background:linear-gradient(#1d1c28,#161620);border-bottom:1px solid #2a2a38;cursor:grab;user-select:none;flex:none}
.cc-panel .hd:active{cursor:grabbing}
.cc-panel .hd b{flex:1;color:var(--cc-accent);font-size:calc(var(--cc-fs) + 1.5px);letter-spacing:.02em}
.cc-panel .hd button{background:none;border:0;color:var(--cc-text-dim);font-size:19px;cursor:pointer;line-height:1;padding:0 3px}
.cc-panel .hd button:hover{color:#fff}
.cc-panel .bd{flex:1;min-height:0;overflow-y:auto;padding:var(--cc-gap) var(--cc-pad) var(--cc-pad);display:flex;flex-direction:column;gap:var(--cc-gap)}
.cc-panel.min>:not(.hd){display:none !important}
.cc-panel.min{height:auto !important;width:auto !important;min-width:0}
.cc-panel.min .hd{border-bottom:0;border-radius:var(--cc-r);padding:6px var(--cc-pad)}
.cc-panel .hd .chiptxt{display:none;color:var(--cc-text);font-size:var(--cc-fs-sm);white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.cc-panel.min .hd .chiptxt:not(:empty){display:inline}
.cc-panel.min .hd b{flex:none}
.cc-panel.chip-always .hd .chiptxt:not(:empty){display:inline;margin-left:auto}
.cc-panel.min .hd{cursor:pointer}
.cc-chip{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--cc-bg-3);border:1px solid var(--cc-border);font-size:var(--cc-fs-sm);color:var(--cc-text-dim)}
.cc-chip.on{background:var(--cc-accent-bg);border-color:#6b5a2a;color:var(--cc-accent)}
/* deprecated alias kept for third-party plugins: use .cc-row (docs/UI-STYLING.md) */
.cc-card{padding:var(--cc-row-pad);border-radius:var(--cc-r-sm);background:var(--cc-bg-2);border-left:3px solid var(--cc-border-strong)}
.cc-panel :focus-visible,.cc-chip:focus-visible{outline:2px solid var(--cc-accent);outline-offset:1px}
.cc-card[data-tone=good]{border-left-color:var(--cc-good)}.cc-card[data-tone=warn]{border-left-color:var(--cc-warn)}.cc-card[data-tone=bad]{border-left-color:var(--cc-bad)}.cc-card[data-tone=accent]{border-left-color:var(--cc-accent)}.cc-card[data-tone=info]{border-left-color:var(--cc-info)}
.cc-card b{color:#fff}
.cc-card .s{color:var(--cc-text-dim);font-size:var(--cc-fs-sm)}
/* ---- ScapeLite design system (docs/DESIGN-SYSTEM.md): meaning colours, and the small components every panel can share ---- */
:root{--cc-q-kill:#ee5a5a;--cc-q-kill-rgb:238,90,90;--cc-q-skill-rgb:95,224,109;--cc-w1:95,224,109;--cc-w2:226,216,74;--cc-w3:255,160,60;--cc-w4:255,90,80;--cc-wt:176,124,255;--cc-ease-out:cubic-bezier(.2,.8,.2,1)}
.cc-pill{--w:var(--cc-w1);--cc-pill-h:20px;position:relative;display:inline-flex;align-items:center;gap:3px;height:var(--cc-pill-h);padding:0 9px;border-radius:99px;white-space:nowrap;font-size:var(--cc-fs-xs);font-weight:600;line-height:1;
  color:rgb(var(--w));font-variant-numeric:tabular-nums;background:linear-gradient(rgba(var(--w),.15),rgba(var(--w),.15)),var(--cc-bg);border:1px solid rgba(var(--w),.6)}
.cc-pill small{font-size:inherit;font-weight:500;opacity:.8}.cc-pill small::before{content:"\\B7";margin-right:3px}
.cc-pill[data-tone=good]{--w:var(--cc-w1)}.cc-pill[data-tone=warn]{--w:var(--cc-w3)}.cc-pill[data-tone=bad]{--w:var(--cc-w4)}.cc-pill[data-tone=magic]{--w:var(--cc-wt)}.cc-pill[data-tone=accent]{--w:255,210,74}.cc-pill[data-tone=dim]{--w:143,143,164}
.cc-tile{--k:var(--cc-good);--kr:var(--cc-q-skill-rgb);--cc-tile:44px;position:relative;display:grid;place-items:center;width:var(--cc-tile);height:var(--cc-tile);border-radius:calc(var(--cc-tile) * .2);background:var(--cc-bg-2);
  border:1.5px solid rgba(var(--kr),.7);box-shadow:inset 0 0 0 1px rgba(0,0,0,.45);transition:transform .12s,border-color .12s,background-color .12s,box-shadow .15s}
.cc-tile[data-k=kill]{--k:var(--cc-q-kill);--kr:var(--cc-q-kill-rgb)}
.cc-tile .cc-ico{width:calc(var(--cc-tile) * .68);height:calc(var(--cc-tile) * .68);image-rendering:pixelated;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
.cc-tile .cc-tier{position:absolute;left:-1px;bottom:-1px;padding:0 4px;border-radius:4px 0 8px 8px;background:rgba(10,10,18,.94);font-size:11px;font-weight:700;line-height:1.35;color:var(--cc-text)}
.cc-tile[data-k=kill] .cc-tier{color:#ffb4b4}
.cc-tile[data-p]::after{position:absolute;top:-5px;right:-5px;width:15px;height:15px;border-radius:50%;display:grid;place-items:center;font-size:9px;font-weight:700;line-height:1;color:#10101a;border:1px solid var(--cc-bg)}
.cc-tile[data-p=xp]::after{content:"\\26A1";background:var(--cc-good)}.cc-tile[data-p=adv]::after{content:"\\2605";background:var(--cc-accent)}
.cc-prog{display:block;height:6px;border-radius:3px;background:#0a0a12;overflow:hidden}
.cc-prog>i{display:block;height:100%;width:var(--p,0%);border-radius:3px;background:linear-gradient(90deg,#3dbd4d,var(--cc-good));transition:width .9s linear}
.cc-spin{display:inline-block;width:11px;height:11px;border:2px solid var(--cc-border-strong);border-top-color:var(--cc-text-dim);border-radius:50%;animation:cc-spin .8s linear infinite;vertical-align:-2px}
.cc-skel{background-image:linear-gradient(90deg,var(--cc-bg-3) 25%,var(--cc-bg-hover) 50%,var(--cc-bg-3) 75%);background-size:300% 100%;animation:cc-skel 1.3s linear infinite}
.cc-empty{display:grid;place-items:center;gap:6px;padding:34px 20px;text-align:center;color:var(--cc-text-dim)}.cc-empty b{font-size:var(--cc-fs);color:var(--cc-text);font-weight:600}
.cc-scroll{scrollbar-width:thin;scrollbar-color:var(--cc-border-strong) transparent;overscroll-behavior:contain}
.cc-tabbadge{--c:var(--cc-good);--cr:95,224,109;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:24px;padding:0 12px;border:1px solid rgba(var(--cr),.55);border-bottom:0;border-radius:9px 9px 0 0;white-space:nowrap;
  background:linear-gradient(rgba(var(--cr),.13),rgba(var(--cr),.13)),var(--cc-bg-2);color:var(--c);font-size:var(--cc-fs-sm);font-weight:600;transition:background .15s,width .2s}
.cc-tabbadge[data-tone=accent]{--c:var(--cc-accent);--cr:255,210,74}.cc-tabbadge[data-tone=dim]{--c:var(--cc-text-dim);--cr:143,143,164}
@keyframes cc-spin{to{transform:rotate(360deg)}}@keyframes cc-skel{from{background-position:100% 0}to{background-position:-100% 0}}
@media (prefers-reduced-motion:reduce){.cc-spin,.cc-skel{animation-duration:2.4s}}
`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- components: the shared library (docs/DESIGN-SYSTEM.md). Change a look here and every panel, card, bar and menu follows.
  const compStyle = document.createElement('style');
  compStyle.id = 'cc-ui-components';
  compStyle.textContent = `
/* ScapeLite component library (COMPONENTS.css). Drop-in for overlay/ui-kit.js: it extends and, where noted, replaces the kit's own component rules.
   Rules: tokens only (no raw hex except the tokens below), every class is prefixed cc-, the queue's cc-q-* classes are untouched.
   Lengths written "Nu" in the source are expanded to calc(N * var(--u)); --u is 1px unless the element (or an ancestor) has class .cc-s and a --s scale.
   Needs Chromium >= 111 (color-mix). */

/* ============ 1. TOKENS (additions; the kit's existing --cc-* tokens are unchanged except --cc-text-faint, see DESIGN-SYSTEM.md 3.1) ============ */
:root{
  --u:1px;
  --cc-text-faint:#7c7c93;                                   /* was #707086 (3.9:1). 4.7:1 on --cc-bg */
  --cc-fs-2xs:10.5px;--cc-fs-lg:16px;--cc-fs-xl:20px;--cc-fs-hero:26px;
  --cc-sp-1:2px;--cc-sp-2:4px;--cc-sp-3:6px;--cc-sp-4:8px;--cc-sp-5:10px;--cc-sp-6:12px;--cc-sp-7:16px;--cc-sp-8:24px;
  --cc-sh-1:0 1px 2px rgba(0,0,0,.45);--cc-sh-pop:0 8px 24px rgba(0,0,0,.6);
  --cc-dur-1:.12s;--cc-dur-2:.18s;--cc-ease-out:cubic-bezier(.2,.8,.2,1);
  --cc-bar-h:34px;--cc-z-bar:99900;--cc-z-menu:2147482600;--cc-z-tip:2147482700;--cc-z-toast:2147482650;--cc-z-modal:2147482800;
  --cc-sunk:#0a0a12;                                          /* wells: progress tracks, graph frames, inputs */
  --cc-scrim:rgba(6,6,12,.62);
}
.cc-s{--u:calc(var(--s,1) * 1px)}
/* tone: sets --t (colour) and two mixes. Put data-tone on the component or any ancestor. */
[data-tone]{--t:var(--cc-text-dim);--t-a:color-mix(in srgb,var(--t) 14%,transparent);--t-b:color-mix(in srgb,var(--t) 42%,transparent)}
[data-tone=good]{--t:var(--cc-good)}[data-tone=warn]{--t:var(--cc-warn)}[data-tone=bad]{--t:var(--cc-bad)}[data-tone=info]{--t:var(--cc-info)}
[data-tone=magic]{--t:var(--cc-magic)}[data-tone=accent]{--t:var(--cc-accent)}[data-tone=kill]{--t:var(--cc-q-kill)}[data-tone=dim]{--t:var(--cc-text-dim)}
/* default tones at zero specificity, so data-tone always wins */
:where(.cc-callout,.cc-toast){--t:var(--cc-info)}:where(.cc-row){--t:var(--cc-border-strong)}:where(.cc-alert){--t:var(--cc-accent)}
/* components that set their own --t still get the mixes */
.cc-callout,.cc-toast,.cc-row,.cc-alert{--t-a:color-mix(in srgb,var(--t) 14%,transparent);--t-b:color-mix(in srgb,var(--t) 42%,transparent)}
.cc-s [hidden],.cc-hide{display:none!important}
/* width classes: the helper ccScale() sets data-bp = full | compact | micro on the .cc-s root */
[data-bp=compact] .cc-hide-c,[data-bp=micro] .cc-hide-c,[data-bp=micro] .cc-hide-m{display:none!important}
.cc-only-m{display:none}[data-bp=micro] .cc-only-m{display:revert}
.cc-num-t{font-variant-numeric:tabular-nums}
.cc-ell{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}

/* ============ 2. PANEL SHELL (replaces the kit's .cc-panel header look) ============ */
.cc-panel{border-radius:var(--cc-r);overflow:visible}  /* visible: the tab-docked badge sits outside the top edge; header, body and footer round their own corners */
.cc-panel>.hd{border-radius:var(--cc-r) var(--cc-r) 0 0}
.cc-panel>.bd:last-of-type,.cc-panel>.ft{border-radius:0 0 var(--cc-r) var(--cc-r)}
.cc-panel.min>.hd{border-radius:var(--cc-r)}
.cc-panel .bd>*{flex-shrink:0}                  /* fixed-height rows never shrink or overlap; the body scrolls instead */
.cc-panel.docked{border-radius:var(--cc-r) var(--cc-r) 0 0;border-bottom:0}
.cc-panel.docked>.bd:last-of-type,.cc-panel.docked>.ft{border-radius:0}
.cc-panel .hd{padding:calc(10 * var(--u)) calc(10 * var(--u)) calc(9 * var(--u)) calc(14 * var(--u));background:var(--cc-bg);gap:calc(6 * var(--u))}
.cc-panel .hd b{color:var(--cc-text);font-size:calc(16 * var(--u));font-weight:700;letter-spacing:.1px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-panel .hd .cc-hsub{font-size:calc(12 * var(--u));color:var(--cc-text-dim);font-weight:400;display:block}
.cc-panel .hd button,.cc-ib{width:calc(24 * var(--u));height:calc(24 * var(--u));display:inline-grid;place-items:center;padding:0;border:0;border-radius:calc(6 * var(--u));background:none;color:var(--cc-text-dim);font-size:calc(15 * var(--u));line-height:1;cursor:pointer;transition:background var(--cc-dur-1),color var(--cc-dur-1)}
.cc-panel .hd button:hover,.cc-ib:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-panel .hd button:active,.cc-ib:active{background:var(--cc-bg-3)}
.cc-ib[aria-pressed=true]{color:var(--cc-accent);background:var(--cc-accent-bg)}
.cc-panel .hd .cc-hval{color:var(--cc-text);font-weight:600;font-size:calc(14 * var(--u));white-space:nowrap}
.cc-panel .bd{padding:var(--cc-gap) var(--cc-pad) var(--cc-pad);gap:var(--cc-gap)}
.cc-panel .ft{flex:none;display:flex;align-items:center;justify-content:space-between;gap:calc(8 * var(--u));padding:calc(8 * var(--u)) var(--cc-pad);border-top:1px solid var(--cc-border);font-size:calc(12 * var(--u));color:var(--cc-text-dim)}
.cc-panel .ft .cc-hint{font-size:calc(11 * var(--u));color:var(--cc-text-faint)}
.cc-panel[data-mode=hover]{position:absolute}
.cc-panel[data-mode=hover] .cc-grip,.cc-panel[data-mode=hover] .hd .min,.cc-panel[data-mode=hover] .hd .x{display:none}
.cc-panel[data-mode=hover] .hd{cursor:default}
.cc-grip{position:absolute;right:3px;bottom:3px;width:14px;height:14px;cursor:nwse-resize;opacity:.7;background:linear-gradient(135deg,transparent 52%,var(--cc-border-strong) 52% 62%,transparent 62% 76%,var(--cc-border-strong) 76% 86%,transparent 86%)}
.cc-grip:hover{opacity:1}
.cc-panel.min .hd .cc-hsub{display:none}
[data-bp=micro] .cc-panel .hd .cc-hsub,[data-bp=micro].cc-panel .hd .cc-hsub{display:none}
[data-bp=compact] .cc-seg button,[data-bp=compact].cc-s .cc-seg button{padding:0 calc(8 * var(--u))}

/* ============ 3. SECTION HEADING, STAT, KEY-VALUE, TABLE, CALLOUT ============ */
.cc-sec{display:flex;align-items:center;gap:calc(8 * var(--u));margin:calc(8 * var(--u)) 0 calc(2 * var(--u));font-size:calc(11 * var(--u));font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cc-text-dim)}
.cc-sec::after{content:"";flex:1;height:1px;background:var(--cc-border)}
.cc-sec .n{order:2;font-weight:600;letter-spacing:0;text-transform:none;color:var(--cc-text-faint)}
.cc-sec .n+*{order:3}.cc-sec::after{order:1}
.cc-sec:first-child{margin-top:0}
.cc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(calc(88 * var(--u)),1fr));gap:calc(8 * var(--u))}
.cc-stat{display:flex;flex-direction:column;gap:calc(2 * var(--u));padding:calc(9 * var(--u)) calc(10 * var(--u));border-radius:calc(8 * var(--u));background:var(--cc-bg-2);border:1px solid var(--cc-border);min-width:0}
.cc-stat b{font-size:calc(20 * var(--u));font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--t,var(--cc-text))}
.cc-stat span{font-size:calc(11.5 * var(--u));color:var(--cc-text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-stat.hero b{font-size:calc(26 * var(--u))}
.cc-kv{display:grid;grid-template-columns:auto 1fr;gap:calc(4 * var(--u)) calc(14 * var(--u));margin:0;font-size:calc(12.5 * var(--u));font-variant-numeric:tabular-nums}
.cc-kv dt{color:var(--cc-text-faint)}.cc-kv dd{margin:0;text-align:right;color:var(--cc-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-kv dd[data-tone]{color:var(--t)}
.cc-table{width:100%;border-collapse:collapse;font-size:calc(12.5 * var(--u));font-variant-numeric:tabular-nums}
.cc-table th{position:sticky;top:0;background:var(--cc-bg);padding:calc(5 * var(--u)) calc(8 * var(--u));font-size:calc(11 * var(--u));font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cc-text-dim);text-align:left;border-bottom:1px solid var(--cc-border-strong)}
.cc-table td{padding:calc(5 * var(--u)) calc(8 * var(--u));border-bottom:1px solid var(--cc-border);height:calc(28 * var(--u))}
.cc-table .num{text-align:right}.cc-table th.num{text-align:right}
.cc-table tbody tr:hover td{background:var(--cc-bg-3)}
.cc-table td[data-tone]{color:var(--t)}
.cc-table td.pos::before{content:"+"}.cc-table td.neg::before{content:"\\2212"}
.cc-callout{display:grid;grid-template-columns:auto 1fr;gap:calc(4 * var(--u)) calc(10 * var(--u));align-items:start;padding:calc(9 * var(--u)) calc(12 * var(--u));border-radius:calc(8 * var(--u));background:var(--t-a);border:1px solid var(--t-b);color:var(--cc-text);font-size:calc(12.5 * var(--u))}
.cc-callout::before{content:"i";display:grid;place-items:center;width:calc(16 * var(--u));height:calc(16 * var(--u));border-radius:50%;background:var(--t);color:var(--cc-accent-ink,#10101a);font-size:calc(11 * var(--u));font-weight:800}
.cc-callout[data-tone=good]::before{content:"\\2713"}.cc-callout[data-tone=warn]::before{content:"!"}.cc-callout[data-tone=bad]::before{content:"\\00D7"}.cc-callout[data-tone=accent]::before{content:"\\2605"}.cc-callout[data-tone=magic]::before{content:"\\2726"}
.cc-callout b{color:var(--cc-text)}
.cc-callout.big{grid-template-columns:1fr;padding:calc(12 * var(--u)) calc(14 * var(--u))}.cc-callout.big::before{display:none}.cc-callout.big>b:first-child{font-size:calc(20 * var(--u));line-height:1.2}

/* ============ 4. CHIP, TAB, SEGMENTED, PILL, BADGE ============ */
.cc-chip{display:inline-flex;align-items:center;gap:calc(5 * var(--u));height:calc(26 * var(--u));padding:0 calc(11 * var(--u));border-radius:99px;background:var(--cc-bg-3);border:1px solid var(--cc-border);font:inherit;font-size:calc(12.5 * var(--u));color:var(--cc-text-dim);cursor:pointer;white-space:nowrap;transition:background var(--cc-dur-1),border-color var(--cc-dur-1),color var(--cc-dur-1)}
.cc-chip:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-chip:active{background:var(--cc-bg-2)}
.cc-chip.on,.cc-chip[aria-pressed=true]{background:var(--cc-accent-bg);border-color:color-mix(in srgb,var(--cc-accent) 45%,transparent);color:var(--cc-accent)}
.cc-chip[data-tone]{color:var(--t);border-color:var(--t-b)}
.cc-chip[data-tone].on{background:var(--t-a);border-color:var(--t)}
.cc-chip.off{border-style:dashed;color:var(--cc-text-faint);background:transparent}
.cc-chip .n{min-width:calc(16 * var(--u));height:calc(16 * var(--u));padding:0 calc(4 * var(--u));border-radius:99px;background:var(--cc-accent);color:var(--cc-accent-ink,#10101a);font-size:calc(10.5 * var(--u));font-weight:700;display:inline-grid;place-items:center}
.cc-chip:disabled{opacity:.45;pointer-events:none}
.cc-chips{display:flex;flex-wrap:wrap;gap:calc(6 * var(--u))}
.cc-tabs{display:flex;gap:calc(2 * var(--u));border-bottom:1px solid var(--cc-border)}
.cc-tab{position:relative;padding:calc(8 * var(--u)) calc(12 * var(--u));border:0;background:none;font:inherit;font-size:calc(13 * var(--u));font-weight:600;color:var(--cc-text-dim);cursor:pointer;white-space:nowrap;transition:color var(--cc-dur-1)}
.cc-tab:hover{color:var(--cc-text)}
.cc-tab[aria-selected=true]{color:var(--cc-accent)}
.cc-tab[aria-selected=true]::after{content:"";position:absolute;left:calc(8 * var(--u));right:calc(8 * var(--u));bottom:-1px;height:2px;border-radius:2px;background:var(--cc-accent)}
.cc-tab .n{margin-left:calc(5 * var(--u));font-size:calc(10.5 * var(--u));color:var(--cc-text-faint)}
.cc-seg{display:inline-flex;flex-wrap:wrap;max-width:100%;padding:calc(2 * var(--u));gap:calc(2 * var(--u));border-radius:calc(9 * var(--u));background:var(--cc-sunk);border:1px solid var(--cc-border)}
.cc-seg button{height:calc(24 * var(--u));padding:0 calc(11 * var(--u));border:0;border-radius:calc(7 * var(--u));background:none;font:inherit;font-size:calc(12.5 * var(--u));font-weight:600;color:var(--cc-text-dim);cursor:pointer;white-space:nowrap;transition:background var(--cc-dur-1),color var(--cc-dur-1)}
.cc-seg button:hover{color:var(--cc-text)}
.cc-seg button[aria-pressed=true]{background:var(--cc-accent-bg);color:var(--cc-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--cc-accent) 40%,transparent)}
.cc-seg button:disabled{opacity:.45;pointer-events:none}
/* .cc-pill: unchanged from the kit (rgb-triplet walk colours --cc-w1..w4, --cc-wt), plus: */
.cc-pill[data-tone=info]{--w:74,168,255}
.cc-pill.solid{background:rgb(var(--w));color:var(--cc-accent-ink,#10101a);border-color:transparent}
.cc-badge{display:inline-grid;place-items:center;min-width:calc(16 * var(--u));height:calc(16 * var(--u));padding:0 calc(4 * var(--u));border-radius:99px;background:var(--t,var(--cc-bad));color:var(--cc-accent-ink,#10101a);font-size:calc(10.5 * var(--u));font-weight:800;line-height:1;border:1.5px solid var(--cc-bg);font-variant-numeric:tabular-nums}
.cc-badge[data-tone=accent]{--t:var(--cc-accent)}
.cc-badge.dot{min-width:calc(8 * var(--u));width:calc(8 * var(--u));height:calc(8 * var(--u));padding:0;border-width:1.5px}
.cc-tierchip{display:inline-block;padding:0 calc(5 * var(--u));border-radius:calc(4 * var(--u));background:var(--cc-sunk);border:1px solid var(--cc-border);font-size:calc(10.5 * var(--u));font-weight:700;line-height:1.5;color:var(--cc-text)}
.cc-tierchip[data-tone=kill]{color:#ffb4b4}

/* ============ 5. TILE, CARD ROW, GRID CELL, PROGRESS ============ */
.cc-tile.sm{--cc-tile:32px}.cc-tile.lg{--cc-tile:56px}
.cc-tile[data-k=empty]{border-style:dashed;border-color:var(--cc-border);background:transparent;box-shadow:none}
.cc-tile .cc-ico{display:block;font-size:calc(var(--cc-tile) * .52);line-height:1}
.cc-tile[data-tone]{border-color:var(--t-b)}
.cc-prog{position:relative;--cc-prog-h:6px;height:var(--cc-prog-h);background:var(--cc-sunk)}
.cc-prog>i{background:linear-gradient(90deg,color-mix(in srgb,var(--t,var(--cc-good)) 72%,#000),var(--t,var(--cc-good)))}
.cc-prog>u{position:absolute;top:0;bottom:0;left:var(--p,0%);width:var(--q,0%);background:var(--cc-good);box-shadow:0 0 6px color-mix(in srgb,var(--cc-good) 70%,transparent);border-radius:0 3px 3px 0;text-decoration:none}
.cc-prog.thin{--cc-prog-h:3px}.cc-prog.thick{--cc-prog-h:8px}
.cc-prog[data-tone=bad]>i{background:var(--cc-bad)}
.cc-row{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:calc(10 * var(--u));min-height:var(--cc-row-h,calc(44 * var(--u)));padding:calc(6 * var(--u)) calc(10 * var(--u)) calc(6 * var(--u)) calc(13 * var(--u));background:var(--cc-bg-3);border:1px solid var(--cc-border);border-radius:calc(8 * var(--u));box-shadow:inset calc(3 * var(--u)) 0 0 var(--t);color:var(--cc-text);font-size:calc(12 * var(--u));text-align:left;transition:background-color var(--cc-dur-1),border-color var(--cc-dur-1),box-shadow var(--cc-dur-2)}
.cc-row.flat{box-shadow:none;padding-left:calc(10 * var(--u))}
.cc-row .ti{grid-column:2;font-size:calc(14 * var(--u));font-weight:600;line-height:1.25;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cc-row .ti i{font-style:normal;font-weight:600;color:var(--cc-text-dim);margin-left:calc(5 * var(--u))}
.cc-row .su{grid-column:2;font-size:calc(12 * var(--u));color:var(--cc-text-dim);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cc-row .lf{grid-column:1;grid-row:1 / span 3;align-self:center}
.cc-row .mt{grid-column:3;grid-row:1 / span 3;text-align:right;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;font-variant-numeric:tabular-nums;white-space:nowrap}
.cc-row .mt b{font-size:calc(14 * var(--u));font-weight:600}.cc-row .mt span{font-size:calc(12 * var(--u));color:var(--cc-text-dim)}
.cc-row .pr{grid-column:2 / -1;margin-top:calc(5 * var(--u))}
.cc-row[role=button],a.cc-row,button.cc-row{cursor:pointer;font-family:inherit}
.cc-row[role=button]:hover,a.cc-row:hover,button.cc-row:hover,.cc-row.hov:hover{background-color:var(--cc-bg-hover);border-color:var(--cc-border-strong)}
.cc-row[role=button]:active,button.cc-row:active{background-color:#20202d}
.cc-row.is-hl{box-shadow:inset calc(3 * var(--u)) 0 0 var(--t),0 0 0 2px var(--cc-accent),0 0 16px color-mix(in srgb,var(--cc-accent) 45%,transparent)}
.cc-row[aria-disabled=true]{opacity:.5;pointer-events:none}
.cc-row.locked{opacity:.55;border-style:dashed}
.cc-row[data-edge]{border-color:var(--t-b);background-image:linear-gradient(90deg,var(--t-a),transparent 65%)}
.cc-list{display:flex;flex-direction:column;gap:calc(6 * var(--u))}
.cc-grid{display:grid;grid-template-columns:repeat(var(--cols,5),minmax(0,1fr));gap:var(--cc-gap-grid,calc(6 * var(--u)))}
.cc-cell{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(3 * var(--u));height:var(--cc-cell-h,calc(54 * var(--u)));padding:calc(4 * var(--u)) calc(4 * var(--u)) calc(7 * var(--u));border-radius:calc(8 * var(--u));background:var(--cc-bg-3);border:1px solid var(--cc-border);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3);font-size:calc(12 * var(--u));font-weight:700;color:var(--cc-text);transition:background-color var(--cc-dur-1),border-color var(--cc-dur-1)}
.cc-cell:hover{background-color:var(--cc-bg-hover);border-color:var(--cc-border-strong)}
.cc-cell .cc-ico{width:calc(24 * var(--u));height:calc(24 * var(--u));font-size:calc(20 * var(--u));line-height:calc(24 * var(--u));text-align:center;image-rendering:pixelated}
.cc-cell .lv{font-variant-numeric:tabular-nums;line-height:1}
.cc-cell .q{position:absolute;top:calc(3 * var(--u));right:calc(5 * var(--u));font-size:calc(10.5 * var(--u));font-weight:700;color:var(--cc-text-dim);font-variant-numeric:tabular-nums}
.cc-cell .cc-tierchip{position:absolute;top:calc(3 * var(--u));left:calc(3 * var(--u));padding:0 calc(3 * var(--u));font-size:calc(10 * var(--u))}
.cc-cell .cc-prog{position:absolute;left:calc(5 * var(--u));right:calc(5 * var(--u));bottom:calc(4 * var(--u));--cc-prog-h:4px}
.cc-cell[data-up]::after{content:"\\25B2";position:absolute;top:calc(2 * var(--u));right:calc(4 * var(--u));font-size:calc(9 * var(--u));color:var(--cc-accent)}
.cc-cell.empty{border-style:dashed;background:transparent;box-shadow:none}
.cc-cell.empty:hover{background:var(--cc-bg-2)}
.cc-cell.sil .cc-ico{opacity:.22;filter:grayscale(1)}
.cc-cell.dim{opacity:.5}
.cc-cell[data-tone]{border-color:var(--t-b)}

/* ============ 6. MENU, POPOVER, TOOLTIP, TOAST, TRAY ============ */
/* no visible scroll bars in ScapeLite's own panels, menus and cards: content still scrolls with the wheel */
.cc-panel,.cc-panel *,.cc-menu,.cc-menu *,.ccx,.ccx *,#cc-bar-tip,#cc-bar-tip *,#cc-bar-tip2,#cc-bar-tip2 *,#cc-route-panel,#cc-route-panel *,#cc-xp-tracker,#cc-xp-tracker *,#cc-goals,#cc-goals *,#cc-lever-panel,#cc-lever-panel *,#cc-matshort,#cc-matshort *,#cc-droplog,#cc-droplog *,.cc-q-list,.cc-q-list *{scrollbar-width:none}
.cc-panel ::-webkit-scrollbar,.cc-menu ::-webkit-scrollbar,.ccx ::-webkit-scrollbar,#cc-bar-tip ::-webkit-scrollbar,#cc-bar-tip2 ::-webkit-scrollbar,#cc-route-panel ::-webkit-scrollbar,#cc-xp-tracker ::-webkit-scrollbar,#cc-goals ::-webkit-scrollbar,#cc-lever-panel ::-webkit-scrollbar,#cc-matshort ::-webkit-scrollbar,#cc-droplog ::-webkit-scrollbar,.cc-q-list::-webkit-scrollbar{display:none;width:0;height:0}
/* ---- window drawer: an advisor / helper that lives INSIDE one of the game's big windows (same stacking as the window, so it can never be hidden behind it), folded to a tab on its edge ---- */
.cc-wd{position:absolute;inset:0;overflow:hidden;z-index:60;pointer-events:none;font:var(--cc-fs,14px)/1.4 var(--cc-font,system-ui,sans-serif);color:var(--cc-text,#dcdce8)}
.cc-wd[hidden]{display:none}
.player-ctx-menu .cc-pop-x,.potions-filter-menu .cc-pop-x{position:absolute;top:4px;right:4px;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:rgba(255,255,255,.1);color:#cfcfda;font:13px/16px system-ui,sans-serif;text-align:center;cursor:pointer;z-index:5}
.player-ctx-menu .ctx-menu-header{padding-right:26px !important}
.player-ctx-menu .cc-pop-x:hover,.potions-filter-menu .cc-pop-x:hover{background:#3a3a4c;color:#fff}
.cc-wd-tab{position:absolute;right:0;top:18%;pointer-events:auto;writing-mode:vertical-rl;padding:14px 7px;border:1px solid var(--cc-border-strong);border-right:0;border-radius:10px 0 0 10px;background:var(--cc-bg-2);color:var(--cc-accent);font:700 13px/1 var(--cc-font,system-ui);letter-spacing:.04em;cursor:pointer;box-shadow:-4px 0 14px rgba(0,0,0,.45);transition:right var(--cc-dur-2,.2s) ease,background-color .12s}
.cc-wd-tab:hover{background:var(--cc-bg-hover)}
.cc-wd-tab i{font-style:normal;margin-top:8px;padding:2px 0;border-radius:99px;background:var(--cc-accent);color:var(--cc-accent-ink);font-size:11px;min-width:18px;text-align:center;writing-mode:horizontal-tb}
.cc-wd-box{position:absolute;right:0;top:8px;bottom:8px;width:var(--cc-wd-w,400px);max-width:calc(100% - 60px);pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-right:0;border-radius:12px 0 0 12px;box-shadow:-10px 0 28px rgba(0,0,0,.55);transform:translateX(105%);transition:transform var(--cc-dur-2,.2s) ease;visibility:hidden}
.cc-wd.open .cc-wd-box{transform:none;visibility:visible}
.cc-wd.open .cc-wd-tab{right:min(var(--cc-wd-w,400px),calc(100% - 60px))}
.cc-wd-hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--cc-border);flex:none}
.cc-wd-hd b{font-size:15px;color:var(--cc-text)}.cc-wd-hd .chip{margin-left:auto;color:var(--cc-text-dim);font-size:12.5px;white-space:nowrap}
.cc-wd-hd button{flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--cc-text-dim);cursor:pointer;font-size:14px}
.cc-wd-hd button:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-wd-bd{flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.cc-wd,.cc-wd *{scrollbar-width:none}.cc-wd ::-webkit-scrollbar{display:none}
.cc-menu{position:fixed;z-index:var(--cc-z-menu);min-width:calc(210 * var(--u));max-width:calc(320 * var(--u));padding:calc(4 * var(--u));background:var(--cc-bg-2);border:1px solid var(--cc-border-strong);border-radius:calc(10 * var(--u));box-shadow:var(--cc-sh-pop);color:var(--cc-text);font:var(--cc-fs-sm)/1.3 var(--cc-font);animation:cc-pop-in var(--cc-dur-2) var(--cc-ease-out)}
.cc-mi{position:relative;display:grid;grid-template-columns:calc(18 * var(--u)) minmax(0,1fr) auto calc(12 * var(--u));align-items:center;gap:calc(6 * var(--u));width:100%;min-height:calc(28 * var(--u));padding:0 calc(8 * var(--u)) 0 calc(6 * var(--u));border:0;border-radius:calc(6 * var(--u));background:none;font:inherit;color:var(--cc-text);text-align:left;cursor:pointer;white-space:nowrap}
.cc-mi:hover,.cc-mi:focus-visible,.cc-mi.open{background:var(--cc-bg-hover)}
.cc-mi:active{background:var(--cc-bg-3)}
.cc-mi .ck{width:calc(14 * var(--u));text-align:center;color:var(--cc-accent);font-weight:700}
.cc-mi[aria-checked=true] .ck::before{content:"\\2713"}.cc-mi[aria-checked=mixed] .ck::before{content:"\\2212"}
.cc-mi .hint{color:var(--cc-text-faint);font-size:calc(11.5 * var(--u))}
.cc-mi .cc-badge{border:0}
.cc-mi.sub::after{content:"\\203A";grid-column:4;color:var(--cc-text-dim);font-size:calc(15 * var(--u))}
.cc-mi[data-tone]{color:var(--t)}
.cc-mi[aria-disabled=true]{opacity:.45;pointer-events:none}
.cc-mi.danger{color:var(--cc-bad)}
.cc-mh{display:flex;align-items:center;justify-content:space-between;padding:calc(7 * var(--u)) calc(8 * var(--u)) calc(3 * var(--u));font-size:calc(10.5 * var(--u));font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--cc-text-faint)}
.cc-msep{height:1px;margin:calc(4 * var(--u)) calc(6 * var(--u));background:var(--cc-border)}
.cc-mslider{display:grid;grid-template-columns:1fr auto;gap:calc(2 * var(--u)) calc(10 * var(--u));padding:calc(6 * var(--u)) calc(8 * var(--u))}
.cc-mslider .cc-range{grid-column:1 / -1}.cc-mslider span{color:var(--cc-text-dim)}.cc-mslider b{font-weight:600;font-variant-numeric:tabular-nums}
.cc-menu .cc-menu{position:absolute;left:calc(100% - 4px);top:-5px}
.cc-menu .cc-menu.flip{left:auto;right:calc(100% - 4px)}
.cc-align{display:grid;grid-template-columns:repeat(3,calc(28 * var(--u)));gap:calc(3 * var(--u))}
.cc-align button{height:calc(28 * var(--u));border:1px solid var(--cc-border);border-radius:calc(6 * var(--u));background:var(--cc-bg-3);color:var(--cc-text-dim);cursor:pointer}
.cc-align button:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-align button[aria-pressed=true]{background:var(--cc-accent-bg);color:var(--cc-accent);border-color:var(--cc-accent)}
.cc-pop{position:fixed;z-index:var(--cc-z-menu);padding:calc(10 * var(--u)) calc(12 * var(--u));background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-radius:calc(10 * var(--u));box-shadow:var(--cc-sh-pop);font-size:calc(12.5 * var(--u));color:var(--cc-text);animation:cc-pop-in var(--cc-dur-2) var(--cc-ease-out)}
.cc-pop>b{display:block;font-size:calc(13 * var(--u));font-weight:700}.cc-pop>em{display:block;font-style:normal;color:var(--cc-text-dim);margin-top:calc(1 * var(--u))}
.cc-tip{position:fixed;z-index:var(--cc-z-tip);max-width:calc(280 * var(--u));padding:calc(8 * var(--u)) calc(10 * var(--u));background:#0c0c14;border:1px solid var(--cc-border-strong);border-radius:calc(8 * var(--u));box-shadow:var(--cc-sh-pop);color:var(--cc-text-dim);font-size:calc(12 * var(--u));line-height:1.35;pointer-events:none;opacity:0;transition:opacity var(--cc-dur-1)}
.cc-tip.on{opacity:1}
.cc-tip>b{display:block;margin-bottom:calc(2 * var(--u));font-size:calc(13 * var(--u));color:var(--cc-text)}
.cc-tip .cc-kv{margin-top:calc(5 * var(--u));font-size:calc(12 * var(--u))}
.cc-tip .cc-prog{margin-top:calc(6 * var(--u))}
.cc-toast{position:fixed;z-index:var(--cc-z-toast);display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:calc(10 * var(--u));max-width:calc(420 * var(--u));padding:calc(10 * var(--u)) calc(10 * var(--u)) calc(10 * var(--u)) calc(14 * var(--u));background:var(--cc-bg-2);border:1px solid var(--cc-border-strong);border-radius:calc(10 * var(--u));box-shadow:var(--cc-sh-pop),inset calc(3 * var(--u)) 0 0 var(--t);color:var(--cc-text);font-size:calc(12.5 * var(--u));animation:cc-toast-in var(--cc-dur-2) var(--cc-ease-out)}
.cc-toast::before{content:"i";display:grid;place-items:center;width:calc(18 * var(--u));height:calc(18 * var(--u));border-radius:50%;background:var(--t);color:var(--cc-accent-ink,#10101a);font-weight:800;font-size:calc(12 * var(--u))}
.cc-toast[data-tone=good]::before{content:"\\2713"}.cc-toast[data-tone=warn]::before{content:"!"}.cc-toast[data-tone=bad]::before{content:"\\00D7"}.cc-toast[data-tone=accent]::before{content:"\\2605"}
.cc-toast b{color:var(--cc-text)}
.cc-tray{position:absolute;display:flex;align-items:center;gap:calc(6 * var(--u));height:calc(56 * var(--u));padding:0 calc(6 * var(--u));background:var(--cc-bg-2);border:1px solid var(--cc-border-strong);border-radius:var(--cc-r);box-shadow:var(--cc-shadow);opacity:0;visibility:hidden;transition:opacity .14s,transform var(--cc-dur-2) var(--cc-ease-out),visibility 0s .18s}
.cc-tray.is-on{opacity:1;visibility:visible;transition-delay:0s}
.cc-tabbadge{cursor:pointer;font-family:inherit}.cc-tabbadge:hover{background:linear-gradient(rgba(var(--cr),.24),rgba(var(--cr),.24)),var(--cc-bg-2)}
@keyframes cc-pop-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
@keyframes cc-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ============ 7. INPUT CONTROLS ============ */
.cc-btn{display:inline-flex;align-items:center;justify-content:center;gap:calc(6 * var(--u));height:calc(28 * var(--u));padding:0 calc(13 * var(--u));border-radius:calc(7 * var(--u));border:1px solid var(--cc-border-strong);background:var(--cc-bg-3);color:var(--cc-text);font:inherit;font-size:calc(12.5 * var(--u));font-weight:600;cursor:pointer;white-space:nowrap;transition:background var(--cc-dur-1),border-color var(--cc-dur-1)}
.cc-btn:hover{background:var(--cc-bg-hover)}.cc-btn:active{background:var(--cc-bg-2);transform:translateY(1px)}
.cc-btn[data-v=primary]{background:var(--cc-accent);border-color:var(--cc-accent);color:var(--cc-accent-ink)}
.cc-btn[data-v=primary]:hover{background:color-mix(in srgb,var(--cc-accent) 86%,#fff)}
.cc-btn[data-v=quiet]{background:none;border-color:transparent;color:var(--cc-text-dim)}.cc-btn[data-v=quiet]:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-btn[data-v=danger]{background:color-mix(in srgb,var(--cc-bad) 14%,transparent);border-color:color-mix(in srgb,var(--cc-bad) 55%,transparent);color:var(--cc-bad)}
.cc-btn[data-v=danger]:hover{background:color-mix(in srgb,var(--cc-bad) 26%,transparent)}
.cc-btn.sm{height:calc(24 * var(--u));padding:0 calc(9 * var(--u));font-size:calc(12 * var(--u))}.cc-btn.go{height:calc(26 * var(--u));border-color:color-mix(in srgb,var(--cc-accent) 55%,transparent);color:var(--cc-accent);background:var(--cc-accent-bg)}
.cc-btn:disabled,.cc-btn[aria-disabled=true]{opacity:.45;pointer-events:none}
.cc-in,.cc-sel,.cc-num{height:calc(28 * var(--u));padding:0 calc(10 * var(--u));border-radius:calc(7 * var(--u));border:1px solid var(--cc-border-strong);background:var(--cc-sunk);color:var(--cc-text);font:inherit;font-size:calc(12.5 * var(--u));min-width:0;transition:border-color var(--cc-dur-1),box-shadow var(--cc-dur-1)}
.cc-in::placeholder{color:var(--cc-text-faint)}
.cc-in:focus,.cc-sel:focus,.cc-num:focus{outline:0;border-color:var(--cc-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--cc-accent) 28%,transparent)}
.cc-in[aria-invalid=true]{border-color:var(--cc-bad)}
.cc-in:disabled,.cc-sel:disabled,.cc-num:disabled{opacity:.45}
.cc-sel{appearance:none;padding-right:calc(26 * var(--u));background-image:linear-gradient(45deg,transparent 50%,var(--cc-text-dim) 50%),linear-gradient(135deg,var(--cc-text-dim) 50%,transparent 50%);background-position:calc(100% - 15px) 12px,calc(100% - 10px) 12px;background-size:5px 5px;background-repeat:no-repeat}
.cc-num{width:calc(72 * var(--u));text-align:right;font-variant-numeric:tabular-nums}
.cc-sw{appearance:none;position:relative;flex:none;width:calc(32 * var(--u));height:calc(18 * var(--u));margin:0;border-radius:99px;background:var(--cc-sunk);border:1px solid var(--cc-border-strong);cursor:pointer;transition:background var(--cc-dur-1),border-color var(--cc-dur-1)}
.cc-sw::after{content:"";position:absolute;top:2px;left:2px;width:calc(12 * var(--u));height:calc(12 * var(--u));border-radius:50%;background:var(--cc-text-dim);transition:transform var(--cc-dur-1) var(--cc-ease-out),background var(--cc-dur-1)}
.cc-sw:checked{background:var(--cc-accent-bg);border-color:var(--cc-accent)}
.cc-sw:checked::after{transform:translateX(calc(14 * var(--u)));background:var(--cc-accent)}
.cc-sw:disabled{opacity:.45}
.cc-range{appearance:none;width:100%;height:calc(16 * var(--u));margin:0;background:none;cursor:pointer}
.cc-range::-webkit-slider-runnable-track{height:calc(4 * var(--u));border-radius:2px;background:linear-gradient(90deg,var(--cc-accent) var(--fill,50%),var(--cc-border-strong) var(--fill,50%))}
.cc-range::-webkit-slider-thumb{appearance:none;width:calc(14 * var(--u));height:calc(14 * var(--u));margin-top:calc(-5 * var(--u));border-radius:50%;background:var(--cc-text);border:2px solid var(--cc-bg);box-shadow:0 0 0 1px var(--cc-border-strong)}
.cc-range:hover::-webkit-slider-thumb{background:var(--cc-accent)}
.cc-field{display:flex;flex-direction:column;gap:calc(4 * var(--u));font-size:calc(12 * var(--u));color:var(--cc-text-dim)}.cc-field .err{color:var(--cc-bad)}
/* settings rows and the settings sheet */
.cc-set{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:calc(2 * var(--u)) calc(14 * var(--u));min-height:calc(38 * var(--u));padding:calc(6 * var(--u)) calc(2 * var(--u));border-bottom:1px solid var(--cc-border)}
.cc-set:last-child{border-bottom:0}
.cc-set>b{font-size:calc(13 * var(--u));font-weight:600;color:var(--cc-text)}.cc-set>span{grid-column:1;font-size:calc(11.5 * var(--u));color:var(--cc-text-dim)}
.cc-set>.ctl{grid-column:2;grid-row:1 / span 2;display:flex;align-items:center;gap:calc(8 * var(--u));min-width:calc(120 * var(--u));justify-content:flex-end}
.cc-set>.ctl .cc-range{width:calc(130 * var(--u))}
.cc-set[data-wide]{grid-template-columns:1fr}.cc-set[data-wide]>.ctl{grid-column:1;grid-row:auto;justify-content:stretch}
.cc-set[data-wide] .cc-in{flex:1}
.cc-btnrow{display:flex;flex-wrap:wrap;gap:calc(8 * var(--u));padding-top:calc(8 * var(--u))}
.cc-sheet{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:var(--cc-bg);border-radius:inherit;animation:cc-sheet-in var(--cc-dur-2) var(--cc-ease-out)}
.cc-sheet>.hd{display:flex;align-items:center;gap:calc(8 * var(--u));padding:calc(10 * var(--u)) calc(12 * var(--u));border-bottom:1px solid var(--cc-border);font-weight:700;font-size:calc(15 * var(--u))}
.cc-sheet>.bd{flex:1;min-height:0;overflow-y:auto;padding:calc(4 * var(--u)) calc(14 * var(--u)) calc(14 * var(--u))}
.cc-sheet .cc-sec{margin-top:calc(14 * var(--u))}
@keyframes cc-sheet-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}

/* ============ 8. EMPTY, LOADING, SCROLLBAR, GRAPH, SPARK ============ */
.cc-empty .ic{font-size:calc(26 * var(--u));opacity:.6}
.cc-empty span{font-size:calc(12.5 * var(--u))}
.cc-skel{border-radius:calc(6 * var(--u));min-height:calc(12 * var(--u))}.cc-skel.row{height:calc(44 * var(--u));border-radius:calc(8 * var(--u))}
.cc-scroll::-webkit-scrollbar{width:8px;height:8px}.cc-scroll::-webkit-scrollbar-thumb{background:var(--cc-border-strong);border-radius:4px}.cc-scroll::-webkit-scrollbar-track{background:transparent}
.cc-panel .bd{scrollbar-width:thin;scrollbar-color:var(--cc-border-strong) transparent}
/* cards and the queue are fitted to their panel: a rounding overflow of a pixel must never show a scroll bar (wheel and touch still scroll) */
.cc-card-pin .bd,.cc-card-pin .bd *,.cc-qroot .cc-q-list,.cc-qroot .cc-q-ol{scrollbar-width:none!important}.cc-card-pin .bd::-webkit-scrollbar,.cc-qroot .cc-q-list::-webkit-scrollbar,.cc-qroot .cc-q-ol::-webkit-scrollbar{display:none}
.cc-graph{position:relative;padding:calc(8 * var(--u));border-radius:calc(8 * var(--u));background:var(--cc-sunk);border:1px solid var(--cc-border)}
.cc-graph svg{display:block;width:100%;height:auto}
.cc-graph .ax{fill:var(--cc-text-faint);font-size:10.5px}
.cc-graph .gl{stroke:var(--cc-border);stroke-width:1}
.cc-graph .ln{fill:none;stroke:var(--cc-good);stroke-width:1.6}.cc-graph .ar{fill:color-mix(in srgb,var(--cc-good) 62%,transparent)}
.cc-spark{display:inline-block;width:calc(64 * var(--u));height:calc(20 * var(--u));vertical-align:middle}.cc-spark path{fill:none;stroke:var(--cc-good);stroke-width:1.5}

/* ============ 9. INFO BAR AND MODULES ============ */
.cc-ibar{display:flex;align-items:center;gap:calc(6 * var(--u));height:var(--cc-bar-h);padding:0 calc(8 * var(--u));background:var(--cc-bg);border-bottom:1px solid var(--cc-border);color:var(--cc-text);font:var(--cc-fs-sm)/1 var(--cc-font);white-space:nowrap}
.cc-ibar.bottom{border-bottom:0;border-top:1px solid var(--cc-border)}
.cc-ibar[data-h=s]{--cc-bar-h:28px}.cc-ibar[data-h=l]{--cc-bar-h:42px}
.cc-z{display:flex;align-items:center;gap:calc(4 * var(--u));min-width:0}.cc-z.l{flex:1 1 0;justify-content:flex-start}.cc-z.m{flex:none;justify-content:center}.cc-z.r{flex:1 1 0;justify-content:flex-end}
.cc-mod{position:relative;display:inline-flex;align-items:center;gap:calc(6 * var(--u));height:calc(var(--cc-bar-h) - 8px);padding:0 calc(8 * var(--u));border:1px solid transparent;border-radius:calc(6 * var(--u));background:none;color:var(--t,var(--cc-text));font:inherit;font-size:calc(12.5 * var(--u));font-weight:500;cursor:default;white-space:nowrap;min-width:0;transition:background var(--cc-dur-1),border-color var(--cc-dur-1)}
.cc-mod .cc-ico{width:calc(16 * var(--u));height:calc(16 * var(--u));font-size:calc(14 * var(--u));line-height:calc(16 * var(--u));text-align:center;image-rendering:pixelated;flex:none}
.cc-mod .tx{min-width:0;overflow:hidden;text-overflow:ellipsis}.cc-mod .tx i{font-style:normal;color:var(--cc-text-dim);margin-right:calc(4 * var(--u))}
.cc-mod .ln{position:absolute;left:calc(8 * var(--u));right:calc(8 * var(--u));bottom:1px;height:2px;border-radius:1px;background:var(--cc-sunk);overflow:hidden}.cc-mod .ln>i{display:block;height:100%;width:var(--p,0%);background:var(--t,var(--cc-good))}
.cc-mod.btn{cursor:pointer;font-weight:600}
.cc-mod.btn:hover,.cc-mod.hov:hover{background:var(--cc-bg-hover)}
.cc-mod.btn:active{background:var(--cc-bg-3)}
.cc-mod.pillbtn{background:var(--cc-bg-3);border-color:var(--cc-border);border-radius:99px;padding:0 calc(11 * var(--u))}
.cc-mod.pillbtn:hover{border-color:var(--cc-border-strong)}
.cc-mod[aria-pressed=true],.cc-mod.active{background:var(--cc-accent-bg);border-color:color-mix(in srgb,var(--cc-accent) 40%,transparent);color:var(--cc-accent)}
.cc-mod.attn::after{content:"";position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--cc-accent);box-shadow:0 0 0 2px var(--cc-bg)}
.cc-mod.dim{color:var(--cc-text-faint)}
.cc-mod.hl{outline:2px solid var(--cc-accent);outline-offset:1px}
.cc-mod.drop{box-shadow:-2px 0 0 var(--cc-accent)}
.cc-mod.fixed{width:calc(200 * var(--u));justify-content:flex-start}
.cc-mod .cc-tabbadge{position:absolute;left:50%;top:-1px;transform:translate(-50%,-100%);height:calc(16 * var(--u));padding:0 calc(7 * var(--u));font-size:calc(10.5 * var(--u))}
.cc-vsep{width:1px;height:calc(14 * var(--u));background:var(--cc-border);margin:0 calc(3 * var(--u));flex:none}
.cc-spacer{flex:1}

/* ============ 10. ALERTS ============ */
.cc-bell{position:relative;display:inline-grid;place-items:center;width:calc(32 * var(--u));height:calc(32 * var(--u));border-radius:calc(9 * var(--u));background:var(--cc-bg-2);border:1px solid var(--cc-border-strong);color:var(--cc-accent);font-size:calc(16 * var(--u));cursor:pointer;transition:background var(--cc-dur-1)}
.cc-bell:hover{background:var(--cc-bg-hover)}
.cc-bell .cc-badge{position:absolute;top:calc(-6 * var(--u));right:calc(-6 * var(--u))}
.cc-bell.quiet{color:var(--cc-text-faint)}
.cc-alist{width:calc(340 * var(--u));padding:calc(4 * var(--u))}
.cc-alert{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:calc(2 * var(--u)) calc(10 * var(--u));align-items:center;padding:calc(8 * var(--u)) calc(8 * var(--u)) calc(8 * var(--u)) calc(12 * var(--u));border-radius:calc(8 * var(--u));background:var(--cc-bg-3);border:1px solid var(--cc-border);box-shadow:inset calc(3 * var(--u)) 0 0 var(--t);position:relative}
.cc-alert+.cc-alert{margin-top:calc(5 * var(--u))}
.cc-alert .ti{font-size:calc(13 * var(--u));font-weight:600}.cc-alert .su{grid-column:2;font-size:calc(12 * var(--u));color:var(--cc-text-dim)}
.cc-alert .go{grid-column:2;justify-self:start;margin-top:calc(4 * var(--u))}
.cc-alert .x{position:absolute;top:calc(4 * var(--u));right:calc(5 * var(--u));width:calc(18 * var(--u));height:calc(18 * var(--u));border:0;border-radius:calc(5 * var(--u));background:none;color:var(--cc-text-faint);cursor:pointer;opacity:0;transition:opacity var(--cc-dur-1)}
.cc-alert:hover .x{opacity:1}.cc-alert .x:hover{background:var(--cc-bg-hover);color:var(--cc-text)}
.cc-alert .cc-badge{position:absolute;top:calc(8 * var(--u));right:calc(26 * var(--u))}
.cc-ring{position:absolute;pointer-events:none;border-radius:calc(10 * var(--u));border:2px solid var(--cc-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--cc-accent) 25%,transparent),0 0 16px color-mix(in srgb,var(--cc-accent) 55%,transparent);animation:cc-ring 1.4s ease-in-out infinite}
.cc-ringtag{position:absolute;pointer-events:none;padding:calc(3 * var(--u)) calc(9 * var(--u));border-radius:99px;background:var(--cc-accent);color:var(--cc-accent-ink);font-size:calc(11.5 * var(--u));font-weight:700;white-space:nowrap;box-shadow:var(--cc-sh-pop)}
@keyframes cc-ring{0%,100%{opacity:1}50%{opacity:.55}}

/* ============ 11. CHAT ============ */
.cc-chan{--t:var(--cc-text)}
.cc-msgs{display:flex;flex-direction:column;gap:1px;padding:calc(4 * var(--u)) 0}
.cc-msg{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:calc(8 * var(--u));padding:calc(3 * var(--u)) calc(14 * var(--u));font-size:calc(13.5 * var(--u));line-height:1.4}
.cc-msg .t{color:var(--cc-text-faint);font-size:calc(11.5 * var(--u));font-variant-numeric:tabular-nums;padding-top:calc(2 * var(--u))}
.cc-msg .who{font-weight:700;color:var(--t,var(--cc-magic))}
.cc-msg .tag{font-size:calc(11 * var(--u));font-weight:700;color:var(--t,var(--cc-text-dim));margin-right:calc(4 * var(--u))}
.cc-msg .x3{display:inline-block;margin-left:calc(6 * var(--u));padding:0 calc(5 * var(--u));border-radius:99px;background:var(--cc-bg-hover);color:var(--cc-text-dim);font-size:calc(10.5 * var(--u));font-weight:700}
.cc-msg[data-hl]{background:var(--cc-accent-bg);box-shadow:inset calc(3 * var(--u)) 0 0 var(--cc-accent)}
.cc-msg:hover{background:var(--cc-bg-3)}
.cc-newjump{position:absolute;left:50%;bottom:calc(58 * var(--u));transform:translateX(-50%);z-index:2}
.cc-composer{display:flex;align-items:center;gap:calc(8 * var(--u));padding:calc(9 * var(--u)) calc(12 * var(--u));border-top:1px solid var(--cc-border)}
.cc-composer .cc-in{flex:1;height:calc(32 * var(--u));border-radius:99px;padding:0 calc(14 * var(--u))}
.cc-composer .cnt{font-size:calc(11.5 * var(--u));color:var(--cc-text-faint);font-variant-numeric:tabular-nums;min-width:calc(22 * var(--u));text-align:right}
.cc-composer .cnt.over{color:var(--cc-bad)}

/* ============ 12. MODAL, TOUR, LAYOUT CHROME ============ */
.cc-scrim{position:fixed;inset:0;z-index:calc(var(--cc-z-modal) - 1);background:var(--cc-scrim)}
.cc-modal{position:fixed;z-index:var(--cc-z-modal);left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);padding:calc(18 * var(--u)) calc(20 * var(--u));background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-radius:var(--cc-r);box-shadow:var(--cc-shadow);color:var(--cc-text);animation:cc-pop-in var(--cc-dur-2) var(--cc-ease-out)}
.cc-modal h3{margin:0 0 calc(6 * var(--u));font-size:calc(18 * var(--u))}.cc-modal p{margin:0 0 calc(12 * var(--u));color:var(--cc-text-dim);font-size:calc(13 * var(--u));line-height:1.5}
.cc-modal .ft{display:flex;align-items:center;gap:calc(8 * var(--u));margin-top:calc(14 * var(--u))}.cc-modal .ft .cc-btn:last-child{margin-left:auto}
.cc-dots{display:flex;gap:calc(5 * var(--u));margin-right:auto}.cc-dots i{width:calc(6 * var(--u));height:calc(6 * var(--u));border-radius:50%;background:var(--cc-border-strong)}.cc-dots i.on{background:var(--cc-accent)}
.cc-guide{position:fixed;z-index:var(--cc-z-modal);background:var(--cc-accent);box-shadow:0 0 6px color-mix(in srgb,var(--cc-accent) 70%,transparent);pointer-events:none}
.cc-guide.v{width:1px;top:0;bottom:0}.cc-guide.h{height:1px;left:0;right:0}
.cc-frame{position:absolute;border:1.5px dashed var(--cc-border-strong);border-radius:var(--cc-r);background:color-mix(in srgb,var(--cc-bg) 40%,transparent);pointer-events:none}
.cc-frame>b{position:absolute;left:calc(8 * var(--u));top:calc(6 * var(--u));padding:calc(1 * var(--u)) calc(7 * var(--u));border-radius:99px;background:var(--cc-bg-2);border:1px solid var(--cc-border);font-size:calc(11 * var(--u));color:var(--cc-text-dim)}
.cc-frame.sel{border-style:solid;border-color:var(--cc-accent)}.cc-frame.sel>b{color:var(--cc-accent);border-color:var(--cc-accent)}
.cc-lbar{white-space:nowrap;display:flex;align-items:center;gap:calc(8 * var(--u));padding:calc(7 * var(--u)) calc(10 * var(--u));background:var(--cc-bg);border:1px solid var(--cc-border-strong);border-radius:99px;box-shadow:var(--cc-sh-pop);font-size:calc(12.5 * var(--u))}
.cc-lbar .sp{flex:1}

/* ============ 13. DRAG GHOST AND INSERTION LINE (generic; the queue keeps its own cc-q-ghost / cc-q-ins) ============ */
.cc-ghost{position:fixed;z-index:var(--cc-z-modal);pointer-events:none;opacity:.96;transform:scale(1.015);box-shadow:var(--cc-sh-pop)}
.cc-dragging{opacity:.32}
.cc-ins{position:absolute;left:0;right:0;height:3px;margin-top:-1px;border-radius:2px;background:var(--cc-accent);box-shadow:0 0 8px color-mix(in srgb,var(--cc-accent) 75%,transparent);pointer-events:none}
.cc-ins::before,.cc-ins::after{content:"";position:absolute;top:-2px;width:7px;height:7px;border-radius:50%;background:var(--cc-accent)}.cc-ins::before{left:-3px}.cc-ins::after{right:-3px}

/* ============ 14. FOCUS AND MOTION ============ */
.cc-s :focus-visible,.cc-menu :focus-visible,.cc-chip:focus-visible,.cc-btn:focus-visible,.cc-tab:focus-visible,.cc-seg button:focus-visible,.cc-mod:focus-visible,.cc-bell:focus-visible,.cc-sw:focus-visible,.cc-row:focus-visible{outline:2px solid var(--cc-info);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.cc-menu,.cc-pop,.cc-toast,.cc-sheet,.cc-modal,.cc-ring{animation:none}.cc-tip,.cc-tray,.cc-sw::after,.cc-chip,.cc-row,.cc-cell,.cc-mod{transition:none}}
.cc-menu .cc-menu{display:none}.cc-mi.sub:hover>.cc-menu,.cc-mi.sub.open>.cc-menu{display:block}
/* text in any tooltip, card or popover wraps inside it instead of running out (one rule for every ScapeLite surface, including clones of the game's own tooltips, whose lines are no-wrap) */
.cc-tt-clone,.cc-tt-clone *,.cc-tip,.cc-tip *,.cc-pop,.cc-pop *,.cc-toast span,.cc-callout,.cc-set>span{white-space:normal;overflow-wrap:break-word}
.cc-tt-clone img,.cc-tip img{flex:none}
.cc-tt-clone,.cc-tip,.cc-pop{max-width:min(100%,92vw);box-sizing:border-box}
/* row without a left tile (.nolf) and an action slot (.ac: pin, remove) */
.cc-row.nolf{grid-template-columns:minmax(0,1fr) auto auto}.cc-row.nolf .ti,.cc-row.nolf .su{grid-column:1}.cc-row.nolf .mt{grid-column:2}.cc-row.nolf .pr{grid-column:1 / -1}
.cc-row .ac{grid-column:3;grid-row:1 / span 3;align-self:center;width:calc(22 * var(--u));height:calc(22 * var(--u));display:inline-grid;place-items:center;border:0;border-radius:calc(6 * var(--u));background:none;color:var(--cc-text-faint);font-size:calc(15 * var(--u));cursor:pointer}
.cc-row .ac:hover{background:var(--cc-bg-hover);color:var(--cc-accent)}
.cc-row .su{white-space:normal}
.cc-panel .bd>.cc-hint{font-size:calc(12 * var(--u));color:var(--cc-text-faint);padding-top:calc(4 * var(--u))}
`;
  document.head.appendChild(compStyle);


  // ---------------------------------------------------------------- helpers for the component library
  // Scale and width class for a .cc-s root: sets --s and data-bp (full | compact | micro). Bars pass data-th="1100,700".
  function ccScale(el) {
    const w = el.getBoundingClientRect().width, th = el.dataset.th && el.dataset.th.split(',').map(Number);
    let bp, s = 1;
    if (th) bp = w >= th[0] ? 'full' : w >= th[1] ? 'compact' : 'micro';
    else { bp = w >= 340 ? 'full' : w >= 180 ? 'compact' : 'micro'; s = bp === 'full' ? Math.min(1.5, Math.max(0.9, w / 450)) : bp === 'compact' ? Math.min(1.1, Math.max(0.9, w / 300)) : 1; }
    el.style.setProperty('--s', s.toFixed(3));
    if (el.dataset.bp !== bp) el.dataset.bp = bp;
  }
  const ccRO = new ResizeObserver((es) => es.forEach((e) => { try { ccScale(e.target); } catch (x) { /* element gone */ } }));
  function ccWatch(el) { el.classList.add('cc-s'); ccScale(el); ccRO.observe(el); }
  // Menu: append to the page, keep it on screen, flip submenus left near the right edge.
  function ccPlace(menu, x, y) {
    document.body.appendChild(menu);
    const w = menu.offsetWidth, hh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + 'px';
    menu.querySelectorAll('.cc-mi.sub').forEach((mi) => mi.addEventListener('mouseenter', () => {
      const sm = mi.querySelector(':scope>.cc-menu'); if (!sm) return;
      sm.classList.remove('flip'); sm.style.top = '';
      const r = sm.getBoundingClientRect();
      if (r.right > innerWidth - 4) sm.classList.add('flip');
      if (r.bottom > innerHeight - 4) sm.style.top = -(r.bottom - innerHeight + 8) + 'px';
    }));
  }
  // Tooltip that follows the pointer: one shared .cc-tip. content(el) returns a DOM node (never innerHTML with game text).
  function ccTip(root, content) {
    const tip = document.querySelector('.cc-tip') || document.body.appendChild(h('div', 'cc-tip'));
    root.addEventListener('mousemove', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.classList.remove('on'); tip.__for = null; return; }
      if (tip.__for !== t) { const c = content(t); if (!c) { tip.classList.remove('on'); return; } tip.replaceChildren(c); tip.__for = t; }
      const w = tip.offsetWidth, hh = tip.offsetHeight;
      if (tipAtCursor()) {
        tip.style.left = (e.clientX + 16 + w > innerWidth - 8 ? e.clientX - w - 16 : e.clientX + 16) + 'px';
        tip.style.top = (e.clientY + 16 + hh > innerHeight - 8 ? e.clientY - hh - 16 : e.clientY + 16) + 'px';
      } else {
        const r = t.getBoundingClientRect();
        tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
        tip.style.top = (r.bottom + 8 + hh > innerHeight - 8 ? Math.max(8, r.top - hh - 8) : r.bottom + 8) + 'px';
      }
      tip.classList.add('on');
    });
    root.addEventListener('mouseleave', () => { tip.classList.remove('on'); tip.__for = null; });
  }
  // Tooltips appear at the pointer (Settings > Plugins > Panels > Tooltips at the cursor); off = next to the thing you point at.
  // The running event (any holiday event, not only Halloween): the server's status through the bridge, plus your own progress read from the game's Info panel row
  // (that row exists in the page even while the Info panel is hidden). null when no event is on.
  function eventInfo() {
    try {
      const b = window.__ccBridge, st = b && b.holiday ? b.holiday() : null; if (!st || !st.active) return null;
      const row = window.__ccDom.q('.ingame-hud-holiday-row'), tx = (s) => { const e = row && row.querySelector(s); return e ? e.textContent.trim() : ''; };
      const tip = row && row.querySelector('.tooltip'), lines = tip ? Array.from(tip.children).map((c) => c.textContent.trim()).filter(Boolean) : [];
      const bang = row && row.querySelector('.holiday-hud-bang'), mine = tx('.holiday-hud-mine');
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(mine), found = m ? +m[1] : 0, need = m ? +m[2] : 0, claimed = mine === '\u2713';
      const state = claimed ? 'claimed' : m ? (found >= need ? 'ready' : 'hunting') : 'new';   // new = you have not started, ready = everything found, go back to claim
      const days = st.endsAt > 0 ? Math.max(0, Math.ceil((st.endsAt - Date.now()) / 864e5)) : null;
      return { key: st.key, id: st.id, name: lines[0] || String(st.key || 'Event').replace(/_/g, ' ').replace(/\b\w/g, (c2) => c2.toUpperCase()) + ' Event', boostPct: st.boostPct || 0, total: st.total || 0, totalText: tx('.holiday-hud-total'),
        state, found, need, attention: !!(bang && bang.style.display !== 'none') || state === 'new', endsAt: st.endsAt || 0, days, lines };
    } catch (e) { return null; }
  }
  const tipAtCursor = () => !!setting('uiTipAtCursor', true);
  // One toast at a time: a short notice above the bottom bar. o: {tone:'warn'|'info'|'good'|'bad'|'accent', ms, action:{label,onClick}}
  let toastEl = null, toastT = 0;
  function toast(msg, o) {
    o = o || {}; if (toastEl) { toastEl.remove(); toastEl = null; } clearTimeout(toastT);
    const t = h('div', 'cc-toast'); t.id = 'cc-ui-toast'; t.dataset.tone = o.tone || 'warn'; t.setAttribute('role', 'status');
    t.style.cssText = 'left:0;right:0;margin:0 auto;width:fit-content;bottom:' + (o.bottom || 64) + 'px';
    t.appendChild(h('span', null, msg));
    if (o.action) { const b = h('button', 'cc-btn sm', o.action.label, { type: 'button' }); b.addEventListener('click', () => { try { o.action.onClick(); } catch (e) { /* ignore */ } t.remove(); }); t.appendChild(b); }
    const x = h('button', 'cc-ib', '\u00D7', { type: 'button', title: 'Dismiss' }); x.addEventListener('click', () => t.remove()); t.appendChild(x);
    document.body.appendChild(t); toastEl = t; toastT = setTimeout(() => { if (t.isConnected) t.remove(); }, o.ms || 3500);
    return t;
  }
  function ccRange(r) { const f = () => r.style.setProperty('--fill', ((r.value - (r.min || 0)) / ((r.max || 100) - (r.min || 0)) * 100) + '%'); r.addEventListener('input', f); f(); }


  // ---------------------------------------------------------------- linkify: plain text in, text nodes and safe links out (never innerHTML). Only http(s) addresses become links; a click opens the user's own browser tab.
  function linkify(parent, text, addText) {
    const s = String(text == null ? '' : text), re = /\bhttps?:\/\/[^\s<>"']+/gi; let at = 0, m;
    const plain = (t) => { if (!t) return; if (addText) addText(parent, t); else parent.appendChild(document.createTextNode(t)); };
    while ((m = re.exec(s))) {
      let u = m[0]; const tail = /[.,;:!?)\]}]+$/.exec(u); if (tail) u = u.slice(0, u.length - tail[0].length);
      let ok = false; try { const p = new URL(u); ok = p.protocol === 'http:' || p.protocol === 'https:'; } catch (e) { ok = false; }
      if (!ok) continue;
      plain(s.slice(at, m.index));
      const a = document.createElement('a'); a.textContent = u; a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; a.className = 'cc-link'; a.style.cssText = 'color:var(--cc-accent,#ffd24a);text-decoration:underline;cursor:pointer;pointer-events:auto';
      a.addEventListener('click', (ev) => { ev.stopPropagation(); }); parent.appendChild(a);
      at = m.index + u.length; re.lastIndex = at;
    }
    plain(s.slice(at));
  }

  // ---------------------------------------------------------------- menu: one component for every ScapeLite menu (bar, bell, panel right-click, launcher)
  // items: {head:'Text'} | {sep:true} | {label, checked:true|false|'mixed', hint, badge, tone, danger, disabled, keepOpen, onClick, sub:[items]}
  //        | {chips:[{label, on, onClick}]} | {align:(h, v) => ...} | {slider:{label, min, max, step, value, fmt, onInput}}
  let openMenu = null;
  function closeMenu() { if (openMenu) { const m = openMenu; openMenu = null; m.remove(); if (m.__onClose) { try { m.__onClose(); } catch (e) { /* ignore */ } } } }
  // re-read every dynamic check mark (item.checked given as a function); called after a keep-open click, again once the setting has been saved
  function menuRefresh() { const go = () => { if (openMenu) openMenu.querySelectorAll('.cc-mi').forEach((e) => { if (e._upd) e._upd(); }); }; go(); setTimeout(go, 160); }
  function menuItems(m, items) {
    items.forEach((it) => {
      if (!it) return;
      if (it.head != null) { m.appendChild(h('div', 'cc-mh', it.head)); return; }
      if (it.sep) { m.appendChild(h('div', 'cc-msep')); return; }
      if (it.chips) {
        const row = h('div', 'cc-chips'); row.style.padding = '2px 6px 4px';
        it.chips.forEach((c) => { const b = h('button', 'cc-chip' + (c.on ? ' on' : ''), c.label, { type: 'button' }); if (c.on) b.setAttribute('aria-pressed', 'true'); b.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); c.onClick && c.onClick(); }); row.appendChild(b); });
        m.appendChild(row); return;
      }
      if (it.align) {
        const g = h('div', 'cc-align'); g.style.margin = '2px 6px 4px';
        [['t', 'l', '\u2196'], ['t', 'c', '\u2191'], ['t', 'r', '\u2197'], ['m', 'l', '\u2190'], ['m', 'c', '\u25CF'], ['m', 'r', '\u2192'], ['b', 'l', '\u2199'], ['b', 'c', '\u2193'], ['b', 'r', '\u2198']].forEach(([v, hh, gl]) => {
          const b = h('button', null, gl, { type: 'button' }); b.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); it.align(hh, v); }); g.appendChild(b);
        });
        m.appendChild(g); return;
      }
      if (it.slider) {
        const s = it.slider, box = h('div', 'cc-mslider'), lab = h('span', null, s.label || ''), val = h('b'), r = h('input', 'cc-range', null, { type: 'range', min: s.min, max: s.max, step: s.step || 1 });
        r.value = s.value; const f = () => { val.textContent = s.fmt ? s.fmt(+r.value) : r.value; ccRange(r); }; f();
        r.addEventListener('input', () => { f(); s.onInput && s.onInput(+r.value); }); ['mousedown', 'click'].forEach((t) => r.addEventListener(t, (ev) => ev.stopPropagation()));
        box.append(lab, val, r); m.appendChild(box); return;
      }
      const d = h('div', 'cc-mi' + (it.sub ? ' sub' : '') + (it.danger ? ' danger' : ''), null, { role: 'menuitem' });
      if (it.tone) d.dataset.tone = it.tone;
      if (it.color) d.style.color = it.color;   // a label in its own colour (chat channels)
      const setCk = () => { const v = typeof it.checked === 'function' ? it.checked() : it.checked; if (v === undefined || v === '' || v === null) d.removeAttribute('aria-checked'); else d.setAttribute('aria-checked', String(v)); };
      if (it.checked !== undefined) { setCk(); d._upd = setCk; }
      if (it.disabled) d.setAttribute('aria-disabled', 'true');
      d.appendChild(h('span', 'ck')); d.appendChild(h('span', null, it.label));
      const tail = h('span', it.badge != null ? 'cc-badge' : 'hint', it.badge != null ? String(it.badge) : it.hint || ''); if (it.badge != null) tail.dataset.tone = 'accent'; d.appendChild(tail);
      const act = (ev) => { ev.stopPropagation(); if (it.disabled) return; if (!it.keepOpen) closeMenu(); it.onClick && it.onClick(d); if (it.keepOpen) menuRefresh(); };
      if (it.sub) { const sm = h('div', 'cc-menu'); menuItems(sm, it.sub); d.appendChild(sm); if (it.onClick) { d.children[1].style.cursor = 'pointer'; d.children[1].addEventListener('click', act); } }
      else d.addEventListener('click', act);
      if (it.onHover) { d.addEventListener('mouseenter', () => it.onHover(true)); d.addEventListener('mouseleave', () => it.onHover(false)); }
      m.appendChild(d);
    });
  }
  function menu(items, x, y, opts) {
    closeMenu();
    const m = h('div', 'cc-menu'); m.setAttribute('role', 'menu'); if (opts && opts.cls) m.classList.add(opts.cls);
    ['contextmenu', 'mousedown'].forEach((t) => m.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); }));
    menuItems(m, items); ccPlace(m, x, y); if (opts && opts.up) m.style.top = Math.max(8, Math.min(y - m.offsetHeight, innerHeight - m.offsetHeight - 8)) + 'px'; openMenu = m; if (opts && opts.onClose) m.__onClose = opts.onClose;
    return m;
  }
  const menuDown = (e) => { if (openMenu && !(e.target.closest && e.target.closest('.cc-menu'))) closeMenu(); };
  const menuKey = (e) => { if (e.key === 'Escape' && openMenu) { closeMenu(); e.stopImmediatePropagation(); } };
  const menuBlur = () => closeMenu();
  // The game window is an Electron window with an auto-hiding menu bar: pressing Alt on its own (Alt+Tab ends with one) makes it slide down. The window only toggles it for key events the
  // page did not handle, so a bare Alt that the page handles (preventDefault) leaves it alone. Alt with another key is untouched.
  const altGuard = (e) => { if (e.key === 'Alt' && setting('altMenuBlock', true) !== false) e.preventDefault(); };
  life.on(window, 'keydown', altGuard, true); life.on(window, 'keyup', altGuard, true);
  life.on(document, 'mousedown', menuDown, true); life.on(document, 'keydown', menuKey, true); life.on(window, 'blur', menuBlur);

  // ---------------------------------------------------------------- one z-order for ScapeLite panels and the game's windows: the most recently opened or clicked surface is on top
  // The game (and so every big window: Bank, Settings, Crafting ...) lives in its own stacking context at the bottom of the page, so a ScapeLite panel (outside it) is always painted over it
  // and can never be given a z-index "between" two game windows. The window therefore gets a VIRTUAL z (winZ) in the same counter as the panels. A panel whose z is below winZ is drawn under the
  // window by cutting the part that lies under the window out of it (clip-path with a hole: the window shows, the rest of the panel stays visible and usable); a panel above winZ is left alone.
  // Opening or clicking a panel puts it above the window; a click in the window (or its title bar) puts the window above every panel. Layering table: docs/UI-STYLING.md.
  // Never changes the game's state: it only sets z-index on ScapeLite elements and a clip-path on them.
  const Z_LO = 1100, Z_HI = 1880;   // the managed band; the option tray (1890-1895), the bars, menus, tips, toasts and the status dot are outside it
  const PANELS = '[data-cc-panel],#cc-route-panel,#cc-route-map,#cc-route-maptab,#cc-xp-tracker,#cc-lever-panel,#cc-matshort,#cc-goals,#cc-droplog,#cc-treeadv,#cc-treeadv-drawer,#cc-treeadv-tab';
  const TRIOS = [['cc-route-panel', 'cc-route-map', 'cc-route-maptab'], ['cc-treeadv', 'cc-treeadv-drawer', 'cc-treeadv-tab']];   // pieces of one panel: they share one z
  const GUARD = PANELS + ',.cc-fuse-link,#cc-alertbell,#cc-route-alert,#cc-walk-countdown,.cc-q-trayhost,.cc-bar,#cc-route-handle';
  let zTop = Z_LO, winZ = 0, winOpen = false, guardRaf = 0, guardList = [], guardListAt = 0, guarded = new Set();
  const stackOn = () => setting('uiStackFront', true) !== false;
  const zOf = (e) => (e ? (parseInt(e.style.zIndex, 10) || parseInt(getComputedStyle(e).zIndex, 10) || 0) : 0);
  const setWinVar = () => { const r = document.documentElement; if (winOpen) { if (r.style.getPropertyValue('--cc-z-win') !== String(winZ)) r.style.setProperty('--cc-z-win', String(winZ)); } else if (r.style.getPropertyValue('--cc-z-win')) r.style.removeProperty('--cc-z-win'); };
  function zSync() { window.__ccDom.qa(PANELS).forEach((e) => { const z = parseInt(e.style.zIndex, 10); if (z > zTop && z <= Z_HI) zTop = z; }); }   // after a re-inject the panels keep their z: carry on above them
  function zRenorm() {   // the band is full: renumber every surface in its current order (the window keeps its place among them)
    const list = Array.from(window.__ccDom.qa(PANELS)).map((e) => ({ e, z: zOf(e) })); if (winOpen) list.push({ win: 1, z: winZ });
    list.sort((a, b) => a.z - b.z); let z = Z_LO, prev = null;
    list.forEach((x) => { if (x.z !== prev) z++; prev = x.z; if (x.win) winZ = z; else x.e.style.zIndex = String(z); });
    zTop = z; setWinVar();
  }
  function zFront(el) {   // put a panel (all pieces of it) on top of every panel and of the game window
    if (!el || (!el.id && !el.dataset.ccPanel)) return;
    const grp = TRIOS.find((g) => g.includes(el.id)), els = grp ? grp.map((i) => document.getElementById(i)).filter(Boolean) : [el];
    zSync(); if (zTop > Z_LO && zOf(el) === zTop && (!winOpen || winZ < zTop)) return;   // already the top surface
    if (zTop >= Z_HI) zRenorm();
    const z = ++zTop; els.forEach((e) => { e.style.zIndex = String(z); });
  }
  function zFrontWindow() { if (!winOpen) return; zSync(); if (winZ === zTop) return; if (zTop >= Z_HI) zRenorm(); winZ = ++zTop; setWinVar(); }
  let mcEl = null, mcAt = -1e9;   // the window's container: found once, looked up again only when it is gone (a lookup on every animation frame cost real time)
  const modalRect = () => { if (!mcEl || !mcEl.isConnected) { const t = performance.now(); if (t - mcAt < 300) return null; mcAt = t; mcEl = document.querySelector('.modal-overlay .modal-container'); } const c = mcEl; if (!c) return null; const o = c.closest('.modal-overlay'); if (!o || !o.checkVisibility || !o.checkVisibility()) return null; const r = c.getBoundingClientRect(); return r.width > 40 && r.height > 40 ? r : null; };
  const kick = () => { if (!guardRaf) guardRaf = requestAnimationFrame(guardFrame); };
  function guardClear() { guarded.forEach((e) => { if (e.style.clipPath) e.style.removeProperty('clip-path'); }); guarded.clear(); }
  // the z a guarded element stands at, against the window; null = always under the window (HUD widgets: bell, walking countdown, route alert)
  function guardZ(e) {
    if (e.classList.contains('cc-q-trayhost')) { const z = zOf(e); return z > 100000 ? z : zOf(document.getElementById('cc-queue')) || z; }   // the option tray rides with its queue panel (a bar tooltip's tray is above everything)
    if (e.classList.contains('cc-fuse-link') || e.matches(PANELS)) return zOf(e);
    return null;
  }
  // The game's own pop-up menus (the player menu of the friends and chat lists, the Active Potions filter menu ...) live inside the game's stacking context too, so a ScapeLite panel would
  // be drawn over them. While one is open it cuts a hole in every panel it overlaps: the menu shows, the rest of the panel stays as it is. These menus are always the newest surface.
  const POPUPS = '.player-ctx-menu,.potions-filter-menu';
  // looked up through the DOM scope (it skips the game's 134 000 hidden window elements: a plain document.querySelectorAll took two thirds of the CPU) and only a few times a second
  let popList = [], popAt = -1e9;
  function popupRects() {
    const t = performance.now(); if (t - popAt > 200) { popList = window.__ccDom ? window.__ccDom.qa(POPUPS) : []; popAt = t; }
    const out = []; popList.forEach((p) => { if (p.isConnected && p.getClientRects().length) { const r = p.getBoundingClientRect(); if (r.width > 4 && r.height > 4) { out.push(r); popupTend(p, r); } } }); return out;
  }
  // A game pop-up menu opened from ScapeLite (a right-click on a name in the chat or a friend row) must be easy to get rid of: it gets a small close button, closes when the pointer
  // has been away from it for a moment (the player menu only: the big filter menu is for settling in), and on Escape. Closing replays what the game itself listens for, a press outside the menu.
  // Event driven as well as per frame, so closing does not depend on the frame loop: every pointer move checks (through the DOM scope, cached) whether a player menu is open and the pointer has left it.
  let ctxEl = null, ctxAt = -1e9, ctxT = 0;
  const outsideCtx = () => { if (!ctxEl || !ctxEl.isConnected || !ctxEl.getClientRects().length) return false; const r = ctxEl.getBoundingClientRect(), m = 14; return !(mouse.x >= r.left - m && mouse.x <= r.right + m && mouse.y >= r.top - m && mouse.y <= r.bottom + m); };
  const mouse = { x: -1, y: -1 }, trackMouse = (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    const t = performance.now(); if (t - ctxAt > 150) { ctxAt = t; ctxEl = window.__ccDom ? window.__ccDom.q('.player-ctx-menu') : null; }
    if (!ctxEl || !ctxEl.isConnected || !ctxEl.getClientRects().length) { if (ctxT) { clearTimeout(ctxT); ctxT = 0; } return; }
    if (outsideCtx()) { if (!ctxT) ctxT = setTimeout(() => { ctxT = 0; if (outsideCtx()) popupClose(ctxEl); }, 300); }
    else if (ctxT) { clearTimeout(ctxT); ctxT = 0; }
  }; life.on(document, 'pointermove', trackMouse, true); life.on(document, 'mousemove', trackMouse, true);
  const awayAt = new WeakMap();
  function popupClose(p) {
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => { try { document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 2, clientY: 2 })); } catch (e) { /* ignore */ } });
    setTimeout(() => { try { if (p.isConnected && p.getClientRects().length) p.style.display = 'none'; } catch (e) { /* ignore */ } }, 120);
  }
  function popupTend(p, r) {
    if (!p.querySelector(':scope > .cc-pop-x')) {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'cc-pop-x'; x.textContent = '×'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close menu');
      x.addEventListener('click', (e) => { e.stopPropagation(); popupClose(p); }); x.addEventListener('mousedown', (e) => e.stopPropagation());
      p.appendChild(x);
    }
    if (!p.classList.contains('player-ctx-menu') || mouse.x < 0) return;
    const m = 14, inside = mouse.x >= r.left - m && mouse.x <= r.right + m && mouse.y >= r.top - m && mouse.y <= r.bottom + m, now = performance.now();
    if (inside) { awayAt.delete(p); return; }
    const t0 = awayAt.get(p); if (t0 == null) awayAt.set(p, now); else if (now - t0 > 300) { awayAt.delete(p); popupClose(p); }
  }
  life.on(document, 'keydown', (e) => { if (e.key === 'Escape') popupRects().length && document.querySelectorAll(POPUPS).forEach((p) => { if (p.getClientRects().length) popupClose(p); }); }, true);
  function guardFrame() {
    guardRaf = 0; const m = modalRect(), pops = popupRects();
    if (!m && !pops.length) { guardClear(); if (winOpen) { winOpen = false; winZ = 0; setWinVar(); } return; }
    if (m && !winOpen) { winOpen = true; winZ = 0; zSync(); if (zTop >= Z_HI) zRenorm(); winZ = ++zTop; setWinVar(); }   // a window that opens is the newest surface
    if (!m && winOpen) { winOpen = false; winZ = 0; setWinVar(); }
    const now = new Set(), on = stackOn();
    const t = performance.now(); if (t - guardListAt > 300) { guardList = window.__ccDom.qa(GUARD); guardListAt = t; }   // the panel list changes rarely: look it up a few times a second, read the rects every frame
    guardList.forEach((e) => {
      if (!e.isConnected) return;
      const gz = guardZ(e), holes = [];
      if (m && !(on && gz != null && gz > winZ)) holes.push(m);   // a panel above the window is not cut by it
      pops.forEach((p) => holes.push(p));
      if (!holes.length || !e.getClientRects().length) { if (e.style.clipPath) e.style.removeProperty('clip-path'); return; }
      const r = e.getBoundingClientRect(), ow = e.offsetWidth || r.width, oh = e.offsetHeight || r.height, sx = r.width / (ow || 1) || 1, sy = r.height / (oh || 1) || 1;
      let d = 'M-9999 -9999H9999V9999H-9999Z', any = false;
      holes.forEach((h) => {
        const x1 = Math.max(r.left, h.left), y1 = Math.max(r.top, h.top), x2 = Math.min(r.right, h.right), y2 = Math.min(r.bottom, h.bottom);
        if (x2 <= x1 || y2 <= y1) return; any = true;
        d += ' M' + ((h.left - r.left) / sx).toFixed(1) + ' ' + ((h.top - r.top) / sy).toFixed(1) + 'h' + (h.width / sx).toFixed(1) + 'v' + (h.height / sy).toFixed(1) + 'h-' + (h.width / sx).toFixed(1) + 'Z';
      });
      if (!any) { if (e.style.clipPath) e.style.removeProperty('clip-path'); return; }
      const v = "path(evenodd,'" + d + "')";
      if (e.style.clipPath !== v) e.style.clipPath = v; now.add(e);
    });
    guarded.forEach((e) => { if (!now.has(e) && e.style.clipPath) e.style.removeProperty('clip-path'); }); guarded = now;
    guardRaf = requestAnimationFrame(guardFrame);   // follows the window and the menus while they are open (they can be moved and resized)
  }
  // click-to-front: a press on a panel raises it; a press on the game window (or its ScapeLite title bar and handles) raises the window
  const zDown = (e) => {
    const t = e.target; if (!t || !t.closest || e.button > 0) return;
    const p = t.closest(PANELS); if (p) { zFront(p); return; }
    if (t.closest('.modal-overlay .modal-container,#cc-modal-win,.cc-mw-h')) { if (!winOpen) kick(); else zFrontWindow(); }
  };
  // a surface that has just appeared (opened by its own code) is the newest: it goes on top
  const zSeen = new WeakMap();
  function zScan() {
    window.__ccDom.qa(PANELS).forEach((e) => { const v = e.getClientRects().length > 0, was = zSeen.get(e); zSeen.set(e, v); if (v && was === false) zFront(e); });
    if (!guardRaf && (modalRect() || popupRects().length)) kick();
  }
  life.on(document, 'mousedown', zDown, true);
  life.on(document, 'click', () => setTimeout(kick, 0), true); life.on(document, 'keydown', () => setTimeout(kick, 0), true);   // a window opens on a click or a key: cut the panels under it at once, not up to a quarter second later
  life.on(document, 'contextmenu', () => { setTimeout(kick, 130); setTimeout(kick, 400); }, true);   // a game pop-up menu appears a moment after a right-click
  // ... and the moment the game adds or shows one, not on the next poll: until then it is drawn under every ScapeLite panel it overlaps (the lookup above is cached for 200 ms)
  { const uic = document.getElementById('ui-container');
    if (uic && window.MutationObserver) {
      const seen = new WeakSet(), poke = () => { popAt = -1e9; kick(); };
      const mo2 = new MutationObserver(poke);   // an existing menu is shown again by a style change on itself: watch those elements only, not the whole game UI
      const watch = (root) => { try { (root.matches && root.matches(POPUPS) ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll(POPUPS) : [])).forEach((n) => { if (!seen.has(n)) { seen.add(n); mo2.observe(n, { attributes: true, attributeFilter: ['style', 'class'] }); } }); } catch (e) { /* ignore */ } };
      const mo = new MutationObserver((recs) => { let hit = false; recs.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) { watch(n); if (n.matches(POPUPS)) hit = true; } })); if (hit) poke(); });
      mo.observe(uic, { childList: true }); watch(uic);   // the game appends its menus straight to the UI container (direct children only: the queue rebuilds thousands of nodes deeper down)
      life.add(() => { mo.disconnect(); mo2.disconnect(); });
    } }
  life.every(250, zScan); zScan();
  life.add(() => { cancelAnimationFrame(guardRaf); guardRaf = 0; guardClear(); winOpen = false; winZ = 0; setWinVar(); });

  // ---------------------------------------------------------------- theme: accent and density from Settings
  function applyTheme() {
    const root = document.documentElement;
    const dens = String(setting('uiDensity', 'cozy'));
    if (root.dataset.ccDensity !== dens) root.dataset.ccDensity = dens;
    // palette: ScapeLite default, follow the game's own theme, or colour-blind safe (Okabe-Ito)
    const pal = String(setting('uiPalette', 'default'));
    const PK = ['--cc-bg', '--cc-bg-2', '--cc-bg-3', '--cc-bg-hover', '--cc-border', '--cc-border-strong', '--cc-text', '--cc-text-dim', '--cc-text-faint', '--cc-good', '--cc-warn', '--cc-bad', '--cc-info', '--cc-magic'];
    let gAcc = '', gBg = '';
    if (pal === 'game') {
      const cs = getComputedStyle(root), g = (k) => (cs.getPropertyValue(k) || '').trim();
      const m = { '--cc-bg': g('--bg-dark'), '--cc-bg-2': g('--bg-panel'), '--cc-bg-3': g('--bg-cell'), '--cc-bg-hover': g('--bg-hover'), '--cc-border': g('--border-secondary') || g('--border-primary'), '--cc-border-strong': g('--border-primary'), '--cc-text': g('--text-light') || g('--text-bright'), '--cc-text-dim': g('--text-muted'), '--cc-text-faint': g('--text-dim') };
      // the game's own muted greys can be too dark on its dark background: lift them until they read (4.5:1), and keep dim at least as bright as faint
      const rgbOf = (c) => { c = String(c || '').trim(); let mm = /^#([0-9a-f]{6})$/i.exec(c); if (mm) { const n = parseInt(mm[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; } mm = /^#([0-9a-f]{3})$/i.exec(c); if (mm) return mm[1].split('').map((x) => parseInt(x + x, 16)); mm = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c); return mm ? [+mm[1], +mm[2], +mm[3]] : null; };
      const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
      const ratio = (a2, b2) => { const x = lum(a2), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const bgc2 = rgbOf(m['--cc-bg']), txc = rgbOf(m['--cc-text']);
      if (bgc2 && txc) ['--cc-text-dim', '--cc-text-faint'].forEach((k) => {
        let c = rgbOf(m[k]); if (!c) return;
        for (let i = 0; i < 12 && ratio(c, bgc2) < 4.5; i++) c = c.map((v, j) => Math.round(v + (txc[j] - v) * 0.2));
        m[k] = 'rgb(' + c.join(',') + ')';
      });
      if (rgbOf(m['--cc-text-dim']) && rgbOf(m['--cc-text-faint']) && lum(rgbOf(m['--cc-text-dim'])) < lum(rgbOf(m['--cc-text-faint']))) m['--cc-text-dim'] = m['--cc-text-faint'];
      PK.forEach((k) => { if (m[k] && /^#|^rgb/i.test(m[k])) root.style.setProperty(k, m[k]); else root.style.removeProperty(k); });
      gAcc = g('--text-accent'); gBg = g('--bg-dark');
    } else if (pal === 'colourblind') {
      const m = { '--cc-good': '#009e73', '--cc-warn': '#e69f00', '--cc-bad': '#d55e00', '--cc-info': '#56b4e9', '--cc-magic': '#cc79a7' };
      PK.forEach((k) => { if (m[k]) root.style.setProperty(k, m[k]); else root.style.removeProperty(k); });
    } else PK.forEach((k) => root.style.removeProperty(k));
    let acc = String(setting('uiAccent', '') || '');
    if (!/^#[0-9a-f]{6}$/i.test(acc) && /^#[0-9a-f]{6}$/i.test(gAcc)) acc = gAcc;
    if (/^#[0-9a-f]{6}$/i.test(acc)) {
      const n = parseInt(acc.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, bgc = [16, 16, 26];
      const bm = gBg.match(/^#([0-9a-f]{6})$/i); if (bm) { const v = parseInt(bm[1], 16); bgc[0] = v >> 16; bgc[1] = (v >> 8) & 255; bgc[2] = v & 255; }
      const mix = (c, i) => Math.round(bgc[i] * 0.88 + c * 0.12);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      root.style.setProperty('--cc-accent', acc);
      root.style.setProperty('--cc-accent-bg', 'rgb(' + mix(r, 0) + ',' + mix(g, 1) + ',' + mix(b, 2) + ')');
      root.style.setProperty('--cc-accent-ink', lum > 0.55 ? '#10101a' : '#ffffff');
    } else { ['--cc-accent', '--cc-accent-bg', '--cc-accent-ink'].forEach((k) => root.style.removeProperty(k)); }
    const fp = Number(setting('uiFontPx', 0));
    if (fp >= 11 && fp <= 18) { root.style.setProperty('--cc-fs', fp + 'px'); root.style.setProperty('--cc-fs-sm', (fp - 1.5) + 'px'); } else { root.style.removeProperty('--cc-fs'); root.style.removeProperty('--cc-fs-sm'); }
  }
  applyTheme();
  life.every(1500, applyTheme);

  // ---------------------------------------------------------------- stray text selection
  // A drag across a tooltip or a panel can leave text selected with no way to clear it (the thing it was in may be gone, and clicking blank space does not always clear it). Every half second:
  // a selection whose text is no longer on screen is cleared at once, and a selection nobody has touched for 20 s (and nobody is dragging) is cleared too. Text in inputs and editable fields is left alone.
  // Switch: Plugins > ScapeLite Core > Clear Stray Text Selections.
  { let selKey = '', selSince = 0, down = false;
    life.on(document, 'mousedown', () => { down = true; selSince = 0; }, true); life.on(document, 'mouseup', () => { down = false; selSince = performance.now(); }, true);
    life.every(500, () => {
      try {
        if (setting('uiAutoDeselect', true) === false || down) return;
        const sel = window.getSelection && window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { selKey = ''; return; }
        const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) || (ae && ae.isContentEditable)) return;
        const r = sel.getRangeAt(0), node = r.commonAncestorContainer, el = node.nodeType === 1 ? node : node.parentElement;
        if (el && el.closest && el.closest('input,textarea,[contenteditable="true"]')) return;
        const gone = !el || !el.isConnected || !el.getClientRects().length || !r.getClientRects().length;
        const key = String(sel).slice(0, 80) + '|' + (el ? el.tagName : '');
        if (key !== selKey) { selKey = key; selSince = performance.now(); }
        if (gone || performance.now() - selSince > 20000) { sel.removeAllRanges(); selKey = ''; }
      } catch (e) { /* never break the page */ }
    }); }

  // ---------------------------------------------------------------- panel
  const panels = {};
  const clampOnScreen = (el) => { try { window.__ccClamp && window.__ccClamp(); } catch (e) { /* ui-scale not there */ } };
  function panel(o) {
    const id = o.id, key = 'panel:' + id;
    const prev = document.getElementById(id); if (prev) prev.remove();
    const el = h('div', 'cc-panel'); el.id = id; el.dataset.ccPanel = '1'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || id); if (o.resizable) el.dataset.ccResizable = '1'; if (o.chipAlways) el.classList.add('chip-always');
    const head = h('div', 'hd'), titleEl = h('b', null, o.title || '');
    const chipEl = h('span', 'chiptxt'); head.append(titleEl, chipEl);
    const st = store.get(key, null) || {};
    let minBtn = null, xBtn = null;
    if (o.collapsible) { minBtn = h('button', 'min', '–', { type: 'button', title: 'Collapse', 'aria-label': 'Collapse ' + (o.title || 'panel') }); head.appendChild(minBtn); }
    if (o.closable) { xBtn = h('button', 'x', '×', { type: 'button', title: 'Close', 'aria-label': 'Close ' + (o.title || 'panel') }); head.appendChild(xBtn); }
    const body = h('div', 'bd');
    el.append(head, body);
    if (o.width) el.style.width = typeof o.width === 'number' ? o.width + 'px' : o.width;
    if (o.height) el.style.height = typeof o.height === 'number' ? o.height + 'px' : o.height;
    document.body.appendChild(el);

    // position: remembered (new key, else the plugin's old key), else a first-open spot
    let pos = st.x != null ? { x: st.x, y: st.y } : null;
    if (!pos && o.legacyPosKey) { try { const p0 = JSON.parse(localStorage.getItem(o.legacyPosKey) || 'null'); if (p0 && Number.isFinite(p0.x)) pos = p0; } catch (e) { /* no old spot */ } }
    if (!pos) pos = o.pos === 'topcenter' ? { x: Math.max(8, innerWidth / 2 - (parseFloat(o.width) || 300) / 2), y: 64 } : (typeof o.pos === 'object' && o.pos) || (window.__ccNextPos ? window.__ccNextPos() : { x: 160, y: 90 });
    el.style.left = Math.max(0, Math.min(innerWidth - 80, pos.x)) + 'px'; el.style.top = Math.max(0, Math.min(innerHeight - 40, pos.y)) + 'px';
    if (o.collapsible && st.min) el.classList.add('min');
    if (minBtn && el.classList.contains('min')) { minBtn.textContent = '+'; minBtn.title = 'Expand'; minBtn.setAttribute('aria-label', 'Expand ' + (o.title || 'panel')); }
    const save = () => store.set(key, Object.assign({}, store.get(key, {}), { x: parseFloat(el.style.left), y: parseFloat(el.style.top), min: el.classList.contains('min') }));

    // drag (kept on screen)
    let drag = null;
    let moved = false;
    head.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; const r = el.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; moved = false; e.preventDefault(); dragOn(); });
    // Folding into a chip (and back) keeps the panel's far edges where they are: a panel in the lower half stays on its bottom edge, one in the right half on its right edge.
    // the collapse button says what the next click does: a dash while the panel is open, a plus (expand) while it is folded into a chip
    const syncMinBtn = () => { if (!minBtn) return; const c = el.classList.contains('min'), lab = (c ? 'Expand ' : 'Collapse ') + (o.title || 'panel'); minBtn.textContent = c ? '+' : '–'; minBtn.title = c ? 'Expand' : 'Collapse'; minBtn.setAttribute('aria-label', lab); };
    const setMin = (v) => {
      const b = el.getBoundingClientRect(), right = b.left + b.width / 2 > innerWidth / 2, low = b.top + b.height / 2 > innerHeight / 2;
      el.classList.toggle('min', v); syncMinBtn();
      const a = el.getBoundingClientRect();
      if (right) el.style.left = Math.max(0, Math.round((parseFloat(el.style.left) || 0) + (b.right - a.right))) + 'px';
      if (low) el.style.top = Math.max(0, Math.round((parseFloat(el.style.top) || 0) + (b.bottom - a.bottom))) + 'px';
      clampOnScreen(el); save();
    };
    head.addEventListener('click', (e) => { if (!moved && !e.target.closest('button') && el.classList.contains('min')) setMin(false); });
    let minObs = null; if (minBtn) { try { minObs = new MutationObserver(syncMinBtn); minObs.observe(el, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* no observer: the label follows the button only */ } }   // other code adds / removes 'min' directly too
    const mv = (e) => { if (drag) { moved = true;
      const E = window.__ccEdge || { top: 0, bottom: 0 }, lo = E.top || 0, hi = innerHeight - (E.bottom || 0) - el.getBoundingClientRect().height;
      let nt = e.clientY - drag.dy; if (nt > hi) nt = hi; if (nt < lo) nt = lo; if (E.bottom && hi - nt <= 10) nt = Math.max(lo, hi); if (E.top && nt - lo <= 10) nt = lo;
      el.style.left = Math.max(0, e.clientX - drag.dx) + 'px'; el.style.top = nt + 'px'; } };
    const up = () => { dragOff(); if (drag) { drag = null; clampOnScreen(el); save(); } };
    const dragOn = () => { document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true); };
    const dragOff = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); };
    ['mousedown', 'click', 'contextmenu', 'wheel'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
    if (o.keyShield !== false) ['keydown', 'keyup', 'keypress'].forEach((t) => el.addEventListener(t, (e) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.stopPropagation(); }));

    const api = { el, body, head, titleEl, id };
    const listeners = [];
    api.setChip = (t) => { const v = t == null ? '' : String(t); if (chipEl.textContent !== v) chipEl.textContent = v; };
    api.setTitle = (t) => { titleEl.textContent = t; el.setAttribute('aria-label', t); };
    api.show = (v) => { const was = el.classList.contains('show'); el.classList.toggle('show', !!v); if (v && !was) zFront(el); };
    api.isShown = () => el.classList.contains('show');
    api.isOpen = () => !!store.get(key, {}).open;
    api.setOpen = (v) => { store.set(key, Object.assign({}, store.get(key, {}), { open: !!v })); api.show(!!v); listeners.forEach((f) => { try { f(!!v); } catch (e) { /* listener failed */ } }); };
    api.toggle = () => api.setOpen(!api.isOpen());
    api.onOpenChange = (f) => { listeners.push(f); };
    // a cogwheel in the header for a panel's own settings: g = { tip, items: () => menu items } (null removes it)
    api.setGear = (g) => {
      head.querySelectorAll('.cc-gear').forEach((e) => e.remove()); if (!g) return;
      const b = h('button', 'cc-ib cc-gear', '\u2699', { type: 'button', title: g.tip || 'Settings', 'aria-label': (o.title || 'Panel') + ' settings' });
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); menu(g.items(), r.left, r.bottom + 4); });
      head.insertBefore(b, minBtn || xBtn || null);
    };
    if (o.gear) api.setGear(o.gear);
    api.collapsed = () => el.classList.contains('min');
    api.setCollapsed = (v) => { if (el.classList.contains('min') !== !!v) setMin(!!v); };
    if (minBtn) minBtn.addEventListener('click', () => setMin(!el.classList.contains('min')));
    if (xBtn) xBtn.addEventListener('click', () => { if (o.onClose) o.onClose(); else api.setOpen(false); });
    api.destroy = () => { if (minObs) minObs.disconnect(); dragOff(); el.remove(); delete panels[id]; };
    panels[id] = api;
    try { window.__ccUIReg && window.__ccUIReg(id, { title: o.title, head: '.hd', resizable: !!o.resizable, anchored: true }); } catch (e) { /* ui-scale not loaded yet */ }
    return api;
  }

  // A drawer inside a game window. o = { id, title, width, host?: () => element (default: the open big window's container), open?: boolean (first-time state) }.
  // It is a child of the window's own container, so it shares the window's stacking and is shown and hidden with it; a tab on the right edge folds and unfolds it,
  // and the state is remembered. api: { el, body, setOpen, isOpen, show(v), setChip(t), setBadge(n), attach(), destroy() }.
  function windowDrawer(o) {
    const key = 'wd:' + o.id, hostOf = o.host || (() => document.querySelector('.modal-overlay .modal-container'));
    const root = h('div', 'cc-wd'); root.id = o.id; root.hidden = true; root.setAttribute('role', 'region'); root.setAttribute('aria-label', o.title); root.style.setProperty('--cc-wd-w', (o.width || 400) + 'px');
    const tab = h('button', 'cc-wd-tab', null, { type: 'button' }), tabTxt = document.createTextNode(o.title), badge = h('i'); badge.hidden = true; tab.append(tabTxt, badge);
    const box = h('div', 'cc-wd-box'), hd = h('div', 'cc-wd-hd'), chip = h('span', 'chip'), close = h('button', null, '\u203A', { type: 'button', title: 'Fold this drawer', 'aria-label': 'Fold ' + o.title });
    hd.append(h('b', null, o.title), chip, close); const body = h('div', 'cc-wd-bd'); box.append(hd, body); root.append(tab, box);
    const st = store.get(key, null); let open = st && st.open !== undefined ? !!st.open : !!o.open;
    // an open drawer makes room: while it is open and shown, the window's own content is narrowed by its width (the game lays it out again), so nothing is covered.
    // Pure CSS (:has), because the game rewrites its container's class and style on its own.
    // The window's content keeps the layout it was made for and is SCALED to the room that is left (zoom = room / full width), so every column stays whole instead of
    // being squeezed or cut off.
    const D = o.width || 400, pushCss = document.createElement('style'); document.head.appendChild(pushCss);
    let zNow = 0;
    const rule = (z) => '.modal-container:has(> #' + o.id + '.open:not([hidden])) .modal-main{box-sizing:border-box;padding-right:' + D + 'px} .modal-container:has(> #' + o.id + '.open:not([hidden])) .modal-body{zoom:' + z + '}';
    const fit = () => {
      const hst = root.parentElement, mm = hst && hst.querySelector('.modal-main');
      if (!mm || !root.classList.contains('open') || root.hidden) { if (zNow !== 1) { zNow = 1; pushCss.textContent = rule(1); } return; }
      const W = mm.clientWidth, z = W > D + 200 ? Math.max(0.5, Math.round((W - D) / W * 1000) / 1000) : 1;
      if (z !== zNow) { zNow = z; pushCss.textContent = rule(z); }
    };
    pushCss.textContent = rule(1);
    const fitTimer = setInterval(() => { if (!window.__ccEcoOn) fit(); }, 400); window.addEventListener('resize', fit);
    const apply = () => { root.classList.toggle('open', open); fit(); tab.setAttribute('aria-expanded', String(open)); tab.title = open ? 'Fold ' + o.title : 'Open ' + o.title; };
    const setOpen = (v) => { open = !!v; store.set(key, { open }); apply(); };
    tab.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); }); close.addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); });
    ['mousedown', 'click', 'contextmenu', 'wheel', 'keydown', 'keyup', 'keypress'].forEach((t) => root.addEventListener(t, (e) => e.stopPropagation()));   // the game's window must not react to what happens in the drawer
    const api = {
      el: root, body, isOpen: () => open, setOpen, show: (v) => { root.hidden = !v; fit(); }, setChip: (t) => { const v = t == null ? '' : String(t); if (chip.textContent !== v) chip.textContent = v; },
      setBadge: (n) => { badge.hidden = !n; badge.textContent = n ? String(n) : ''; },
      attach: () => { const hst = hostOf(); if (hst && root.parentElement !== hst) hst.appendChild(root); return !!hst; },
      destroy: () => { clearInterval(fitTimer); window.removeEventListener('resize', fit); root.remove(); pushCss.remove(); },
    };
    apply(); api.attach();
    return api;
  }

  function teardown() {
    Object.values(panels).forEach((p) => p.destroy());
    life.dispose();
    if (toastEl) toastEl.remove(); closeMenu();
    style.remove(); compStyle.remove(); try { ccRO.disconnect(); } catch (e) { /* none */ }
    const root = document.documentElement; delete root.dataset.ccDensity; ['--cc-accent', '--cc-accent-bg', '--cc-accent-ink', '--cc-fs', '--cc-fs-sm', '--cc-bg', '--cc-bg-2', '--cc-bg-3', '--cc-bg-hover', '--cc-border', '--cc-border-strong', '--cc-text', '--cc-text-dim', '--cc-text-faint', '--cc-good', '--cc-warn', '--cc-bad', '--cc-info', '--cc-magic'].forEach((k) => root.style.removeProperty(k));
    if (window[NS] && window[NS].teardown === teardown) delete window[NS];
    return 'cc ui-kit torn down';
  }
  window[NS] = { version: 2, teardown, store, h, fmt, linkify, panel, windowDrawer, panels, applyTheme, ccScale, ccWatch, ccPlace, ccTip, ccRange, eventInfo, tipAtCursor, toast, menu, closeMenu, menuRefresh, isMenuOpen: () => !!openMenu, z: { front: zFront, frontWindow: zFrontWindow, top: () => zTop, win: () => (winOpen ? winZ : 0), band: [Z_LO, Z_HI] } };
  return 'cc ui-kit loaded';
})();
