// ScapeLite lifecycle (window.__ccLife). Core plugin, loaded before every other plugin.
//
// Problem it solves: a plugin that registers page-level listeners, timers or frame loops must remove every one of them when it is torn down or
// re-injected, otherwise each re-injection leaves another live copy behind (a profile of a long session found 35 to 70 copies of single listeners).
//
// Contract: a plugin asks for a scope once, registers everything through it, and calls scope.dispose() in its teardown:
//
//     const life = window.__ccLife.scope('my-plugin');      // a second scope() with the same name first disposes the previous one
//     life.on(document, 'mousemove', onMove, true);          // addEventListener, removed on dispose
//     life.every(1000, refresh);                            // setInterval, cleared on dispose
//     life.after(300, fn);                                  // setTimeout, cleared on dispose (or earlier through the returned handle)
//     const loop = life.frame(onFrame, { hz: 10 });         // requestAnimationFrame loop at most hz times a second; loop.stop() / dispose stop it
//     life.observe(new MutationObserver(cb));               // disconnected on dispose
//     life.add(() => cleanup());                            // any other cleanup, run on dispose (in reverse order of registration)
//
// The same-name rule is the safety net: even a plugin whose teardown forgets something cannot leak across re-injections, because creating
// its new scope disposes the old one. Display only: nothing here talks to the game.
(function () {
  'use strict';
  const NS = '__ccLife';
  try { window[NS] && window[NS].teardown && window[NS].teardown(); } catch (e) { /* previous copy is gone */ }

  const scopes = new Map();

  // ---- Eco mode ------------------------------------------------------------------------------------------------------------------------------------
  // While the game cannot be seen (minimised, covered by another window, on a screen that is off) nobody looks at ScapeLite's panels, so their timers, frame
  // loops and animations rest. Detection: the page is hidden, or the browser has throttled animation frames to about one a second (what it does to a covered
  // window). Things that must keep running while you are away (the Task Log, XP samples, alerts, the Route Advisor's notifications) do not use the resting
  // timers: scope.every(ms, fn, { always: true }) opts out, and plain setInterval plugins check window.__ccEcoOn themselves.
  // Setting: Plugins > ScapeLite Core > Eco Mode (ecoModeEnabled, default on).
  const eco = { active: false, since: 0, _l: [], on(fn) { eco._l.push(fn); return () => { eco._l = eco._l.filter((x) => x !== fn); }; } };
  window.__ccEcoOn = false;
  const ecoWanted = () => { try { const v = window.__ccPluginSettings && window.__ccPluginSettings.get('ecoModeEnabled'); return v === undefined ? true : !!v; } catch (e) { return true; } };
  let lastRaf = performance.now(), slowRaf = 0, rafId = 0;
  const rafProbe = (t) => { const gap = t - lastRaf; lastRaf = t; if (gap > 700) slowRaf++; else if (gap < 250) slowRaf = 0; rafId = requestAnimationFrame(rafProbe); };
  rafId = requestAnimationFrame(rafProbe);
  function ecoCheck() {
    let hide = false;
    if (ecoWanted()) hide = document.hidden || slowRaf >= 2 || performance.now() - lastRaf > 2500;
    if (hide === eco.active) return;
    eco.active = hide; eco.since = Date.now(); window.__ccEcoOn = hide;
    try { document.documentElement.classList.toggle('cc-eco', hide); } catch (e) { /* no document element */ }
    eco._l.slice().forEach((fn) => { try { fn(hide); } catch (e) { /* a listener must not break the rest */ } });
    try { window.dispatchEvent(new CustomEvent('cc-eco', { detail: { active: hide } })); } catch (e) { /* ignore */ }
  }
  const ecoTimer = setInterval(ecoCheck, 1000);
  document.addEventListener('visibilitychange', ecoCheck);
  { const st = document.createElement('style'); st.id = 'cc-eco-style'; st.textContent = 'html.cc-eco [id^="cc-"],html.cc-eco [id^="cc-"] *,html.cc-eco [class*="cc-"],html.cc-eco [class*="cc-"] *{animation-play-state:paused!important}'; (document.head || document.documentElement).appendChild(st); }

  class Scope {
    constructor(name) { this.name = name; this._undo = []; this._off = false; }
    get disposed() { return this._off; }
    _push(fn) { if (this._off) { try { fn(); } catch (e) { /* nothing to undo */ } return; } this._undo.push(fn); }
    on(target, type, fn, opts) { if (this._off) return fn; target.addEventListener(type, fn, opts); this._undo.push(() => target.removeEventListener(type, fn, opts)); return fn; }
    every(ms, fn, opts) { if (this._off) return 0; const always = opts && opts.always, id = setInterval(always ? fn : () => { if (!eco.active) fn(); }, ms); this._undo.push(() => clearInterval(id)); return id; }
    after(ms, fn) { if (this._off) return 0; const id = setTimeout(fn, ms); this._undo.push(() => clearTimeout(id)); return id; }
    observe(obs) { this._push(() => obs.disconnect()); return obs; }
    add(fn) { this._push(fn); return fn; }
    // a frame loop that runs fn(timestamp) on animation frames, throttled to hz (default: every frame); returns { stop(), running }
    frame(fn, opts) {
      const gap = opts && opts.hz > 0 ? 1000 / opts.hz : 0; let id = 0, last = -1e9, on = !this._off;
      const step = (t) => { if (!on) return; id = requestAnimationFrame(step); if (eco.active || t - last < gap - 1) return; last = t; try { fn(t); } catch (e) { /* keep the loop alive */ } };
      const loop = { stop: () => { on = false; if (id) cancelAnimationFrame(id); id = 0; }, get running() { return on; } };
      if (on) { id = requestAnimationFrame(step); this._undo.push(loop.stop); }
      return loop;
    }
    dispose() {
      if (this._off) return; this._off = true;
      for (let i = this._undo.length - 1; i >= 0; i--) { try { this._undo[i](); } catch (e) { /* one failing cleanup must not block the rest */ } }
      this._undo.length = 0; if (scopes.get(this.name) === this) scopes.delete(this.name);
    }
  }

  function scope(name) { const old = scopes.get(name); if (old) old.dispose(); const s = new Scope(name); scopes.set(name, s); return s; }
  function teardown() { Array.from(scopes.values()).forEach((s) => s.dispose()); clearInterval(ecoTimer); cancelAnimationFrame(rafId); document.removeEventListener('visibilitychange', ecoCheck); try { document.documentElement.classList.remove('cc-eco'); document.getElementById('cc-eco-style').remove(); } catch (e) { /* gone */ } window.__ccEcoOn = false; if (window[NS] && window[NS].teardown === teardown) delete window[NS]; return 'cc lifecycle torn down'; }
  window[NS] = { version: 2, eco, scope, teardown, dispose: (name) => { const s = scopes.get(name); if (s) s.dispose(); }, names: () => Array.from(scopes.keys()) };
  return 'cc lifecycle loaded';
})();
