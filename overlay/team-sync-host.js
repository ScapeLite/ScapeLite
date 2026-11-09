// Team settings sync, the part that runs in the watcher (Node). It joins overlay/team-sync.js (pure) to this PC: the Plugins settings of the page, the private config files
// and the lease webhook. Everything is passed in (o.*), so the tests drive it with fakes. Requests come from the Discord setup wizard (and one timer for the optional
// automatic sync); nothing here sends anything by itself except what the person asked for: Publish posts to the private lease channel, Gather reads from it.
//
//   o.lease()          the lease (relay-lease.js createLease) or null when there is no lease webhook
//   o.name()           the in-game name (shown as "published by")
//   o.getPlugin()      async: every Plugins setting of the page          o.applyPlugin(patch)   async: write settings into the page
//   o.readFiles()      { clanTag, clanMembers, ultraRareKeywords }        o.writeFiles(patch)    merge those fields into the private config files
//   o.readSecrets()    { relayClanWebhook: url, ... }                     o.writeSecrets(patch)  save webhook addresses (only when the person asked for them)
//   o.load() / o.save(state)   the small state file { lastVer, undo }     o.log(text)
'use strict';
const T = require('./team-sync');

function createTeamHost(o) {
  const log = o.log || (() => {});
  let st = Object.assign({ lastVer: 0, undo: null }, (o.load && o.load()) || {});
  let cache = null;          // the last gathered or imported bundle: { bundle, meta, source, urls, refused }
  let autoAt = 0;
  const save = () => { try { o.save && o.save(st); } catch (e) { /* the state file is a convenience */ } };

  async function local(includeUrls) {
    const plugin = await o.getPlugin().catch(() => ({}));
    return T.collect({ plugin, files: o.readFiles(), secrets: includeUrls ? o.readSecrets() : {} }, { by: o.name(), at: Date.now(), includeUrls: !!includeUrls });
  }
  const no = (error) => ({ ok: false, error });
  const leaseOrError = () => { const l = o.lease(); return l ? { l } : { error: 'No shared lease webhook is saved. Add one on the “Several PCs” page first: Team settings travel through it.' }; };
  const rowsOf = (bundle) => T.KEYS.filter((d) => bundle.k[d.key] !== undefined).map((d) => ({ key: d.key, group: d.group, label: d.label, value: T.show(d.key, bundle.k[d.key]) }));

  const ops = {
    async status() {
      const l = o.lease(), meta = l && l.teamMeta ? l.teamMeta() : null;
      return { ok: true, lease: !!l, meta: meta ? { ver: meta.ver, by: meta.by, at: meta.at, urls: !!meta.u } : null, lastVer: st.lastVer, hasUndo: !!st.undo, undoAt: st.undo ? st.undo.at : 0 };
    },
    // what Publish (or Export) would send: every setting with its value, and how many webhook addresses would go with it
    async preview(a) {
      const urls = !!(a && a.includeUrls), b = await local(urls), enc = T.encodeText(b);
      const l = o.lease(), meta = l && l.teamMeta ? l.teamMeta() : null;
      return { ok: true, rows: rowsOf(b), urls: urls ? Object.keys(b.s || {}).map((k) => T.SECRETS.find((s) => s.key === k).label) : [], size: enc.ok ? enc.size : 0, parts: enc.ok ? T.toParts(enc.text).length : 0, tooBig: !enc.ok, error: enc.ok ? '' : enc.error,
        nextVer: (meta ? meta.ver : st.lastVer) + 1, current: meta ? { ver: meta.ver, by: meta.by, at: meta.at } : null };
    },
    async publish(a) {
      const { l, error } = leaseOrError(); if (error) return no(error);
      const urls = !!(a && a.includeUrls);
      if (urls && !(a && a.confirmUrls)) return no('Including webhook addresses needs your confirmation.');
      const enc = T.encodeText(await local(urls)); if (!enc.ok) return no(enc.error);
      const r = await l.teamPublish(enc.text, { urls });
      if (!r.ok) return no(r.error);
      st.lastVer = r.meta.ver; save();
      return { ok: true, ver: r.meta.ver, parts: r.meta.ids.length, urls };
    },
    async export(a) {
      const urls = !!(a && a.includeUrls);
      if (urls && !(a && a.confirmUrls)) return no('Including webhook addresses needs your confirmation.');
      const enc = T.encodeText(await local(urls)); if (!enc.ok) return no(enc.error);
      return { ok: true, text: enc.text, urls };
    },
    async gather() {
      const { l, error } = leaseOrError(); if (error) return no(error);
      const g = await l.teamFetch(); if (!g.ok) return no(g.error);
      if (g.none) return { ok: true, none: true };
      const d = T.decodeText(g.text); if (!d.ok) return no('The published settings could not be read: ' + d.error);
      if (d.sum !== g.meta.sum) return no('The published settings changed while they were being read. Press Gather again.');
      cache = { bundle: d.bundle, meta: g.meta, source: 'team', urls: !!d.bundle.s, refused: d.refused };
      return { ok: true, ...(await describe()) };
    },
    async import(a) {
      const d = T.decodeText(a && a.text); if (!d.ok) return no(d.error);
      cache = { bundle: d.bundle, meta: null, source: 'import', urls: !!d.bundle.s, refused: d.refused };
      return { ok: true, ...(await describe()) };
    },
    // apply: the chosen keys of the last gathered / imported bundle. Webhook addresses only when urls:true AND they are in the bundle.
    async apply(a) {
      if (!cache) return no('Nothing to apply yet. Gather the team settings or import a text first.');
      const keys = Array.isArray(a && a.keys) ? a.keys.filter((k) => typeof k === 'string') : null;
      const p = T.plan(cache.bundle, keys, { urls: !!(a && a.urls) });
      if (!p.applied.length) return no('Nothing was chosen.');
      await snapshot(p);
      await applyPlan(p);
      if (cache.source === 'team' && cache.meta) st.lastVer = cache.meta.ver;
      save();
      log('Team settings applied (' + p.applied.length + ' setting' + (p.applied.length > 1 ? 's' : '') + ', from ' + (cache.source === 'team' ? 'the team, version ' + (cache.meta && cache.meta.ver) : 'an import') + ').');
      return { ok: true, applied: p.applied.length, hasUndo: true };
    },
    async undo() {
      const u = st.undo; if (!u) return no('There is nothing to undo.');
      await applyPlan({ plugin: u.plugin || {}, files: u.files || {}, secrets: u.secrets || {} });
      st.undo = null; save();
      log('Team settings: the last change was undone.');
      return { ok: true };
    },
  };

  // the diff against what this PC has now (webhook addresses are compared against the real ones but only ever described)
  async function describe() {
    const rows = T.diff(await local(true), cache.bundle);
    return { source: cache.source, by: cache.bundle.by || (cache.meta && cache.meta.by) || '', at: cache.bundle.at || (cache.meta && cache.meta.at) || 0, ver: cache.meta ? cache.meta.ver : 0, urls: cache.urls,
      refused: cache.refused.length, rows, changes: rows.filter((r) => !r.same).length };
  }
  async function snapshot(p) {
    const plugin = await o.getPlugin().catch(() => ({})), files = o.readFiles(), secrets = Object.keys(p.secrets).length ? o.readSecrets() : {};
    const u = { at: Date.now(), plugin: {}, files: {}, secrets: {} };
    Object.keys(p.plugin).forEach((k) => { if (plugin[k] !== undefined) u.plugin[k] = plugin[k]; });
    Object.keys(p.files).forEach((k) => { u.files[k] = files[k] === undefined ? (k === 'clanTag' ? '' : []) : files[k]; });
    Object.keys(p.secrets).forEach((k) => { u.secrets[k] = secrets[k] || ''; });
    st.undo = u;
  }
  async function applyPlan(p) {
    if (Object.keys(p.plugin).length) await o.applyPlugin(p.plugin);
    if (Object.keys(p.files).length) o.writeFiles(p.files);
    if (Object.keys(p.secrets).length) o.writeSecrets(p.secrets);
  }

  // Optional automatic sync (the setting "Keep in sync automatically", off by default): when the team published a newer version, apply its settings, never webhook addresses.
  async function tick(enabled) {
    if (!enabled || Date.now() - autoAt < 60000) return null;
    const l = o.lease(); const meta = l && l.teamMeta ? l.teamMeta() : null;
    if (!meta || meta.ver <= st.lastVer) return null;
    autoAt = Date.now();
    const g = await ops.gather(); if (!g.ok || g.none) return g;
    const r = await ops.apply({ keys: Object.keys(cache.bundle.k), urls: false });
    if (r.ok) log('Team settings: version ' + meta.ver + ' from ' + (meta.by || 'the team') + ' was applied automatically. Undo it in the wizard (Team settings).');
    return r;
  }

  async function handle(op, args) {
    const fn = ops[op];
    if (typeof fn !== 'function' || op === 'handle') return no('unknown request');
    try { return await fn(args || {}); } catch (e) { return no(String(e && e.message || e).replace(/https?:\/\/\S+/gi, '[link hidden]').slice(0, 200)); }
  }
  return { handle, tick, state: () => ({ lastVer: st.lastVer, hasUndo: !!st.undo }), _cache: () => cache };
}

module.exports = { createTeamHost };
