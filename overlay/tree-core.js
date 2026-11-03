// ScapeLite tree core: pure planning code for the Delve and Fortify trees (no DOM, no game access). Works in the page
// (window.__ccTreeCore) and in Node (module.exports) so it can be tested offline.
//
// The trees are strict trees: every node has exactly one parent (the free root excluded), costs 1 point, and its effect is a fixed
// additive value. A legal build is therefore a set of nodes that contains the parent of every member (or the root) and has at most
// `points` members. Choosing the best build is a tree knapsack: f[v][k] = best total weight of a connected subtree hanging from v that
// contains v and k nodes, merged child by child. For a non-linear score (DPS depends on crit chance times crit damage ...) the weights
// are the marginal values at the current build; the knapsack is solved again and the weights refreshed until the build stops changing.
(function (root) {
  'use strict';

  function buildTree(json, key) {
    const t = json && json[key];
    if (!t) return null;
    const rootId = (t.starter && t.starter.id) || (key + '_n0');
    const nodes = {};
    (t.nodes || []).forEach((n) => {
      nodes[n.id] = { id: n.id, parent: (n.requires && n.requires[0]) || rootId, children: [], effect: n.effect, value: n.value, skill: n.skill || null,
        tier: n.tier, cluster: n.cluster, requiresLevel: n.requiresLevel || 0, head: n.head || '', slot: n.slot };
    });
    Object.values(nodes).forEach((n) => { const p = nodes[n.parent]; if (p) p.children.push(n.id); });
    const roots = Object.values(nodes).filter((n) => n.parent === rootId).map((n) => n.id);
    const depth = {};
    const walk = (id, d) => { depth[id] = d; nodes[id].children.forEach((c) => walk(c, d + 1)); };
    roots.forEach((r) => walk(r, 1));
    return { key, rootId, nodes, roots, depth, clusters: t.clusters || [], name: t.name || key, base: t.basePurchasable || 99, ext: t.layoutExtensions };
  }

  // Sum of the effects of a set of node ids: { effect: total, effLevel: { skill: levels } }.
  function sumEffects(tree, ids) {
    const acc = { effLevel: {} };
    ids.forEach((id) => {
      const n = tree.nodes[id]; if (!n) return;
      if (n.effect === 'effLevel') acc.effLevel[n.skill] = (acc.effLevel[n.skill] || 0) + n.value;
      else acc[n.effect] = (acc[n.effect] || 0) + n.value;
    });
    return acc;
  }

  // Is this set a legal allocation at this level? Returns { ok, reason }.
  function validate(tree, ids, level) {
    if (ids.length > Math.max(0, level)) return { ok: false, reason: 'more nodes than points' };
    const set = new Set(ids);
    for (const id of ids) {
      const n = tree.nodes[id]; if (!n) return { ok: false, reason: 'unknown node ' + id };
      if (n.requiresLevel && level < n.requiresLevel) return { ok: false, reason: id + ' needs level ' + n.requiresLevel };
      if (n.parent !== tree.rootId && !set.has(n.parent)) return { ok: false, reason: id + ' needs ' + n.parent };
    }
    return { ok: true };
  }

  // Tree knapsack. weightOf(node) -> number (may be negative: such nodes are only taken as stepping stones). `must` = ids that have to be in
  // the build (their parents come with them). Returns { ids, total } with at most `budget` nodes.
  function knapsack(tree, budget, level, weightOf, must) {
    const mustSet = new Set();
    (must || []).forEach((id) => { let c = id; while (c && c !== tree.rootId && tree.nodes[c] && !mustSet.has(c)) { mustSet.add(c); c = tree.nodes[c].parent; } });
    const NEG = -1e18;
    const memo = {};
    // best[v] = array over k (0 = v not taken -> only valid for a node that is not forced) of {w, take:[child -> k]}
    function solve(id) {
      if (memo[id]) return memo[id];
      const n = tree.nodes[id];
      const usable = !(n.requiresLevel && level < n.requiresLevel);
      // forest over the children: g[k] = best weight using k nodes in the children's subtrees
      let g = [{ w: 0, pick: [] }];
      if (usable) {
        for (const c of n.children) {
          const sc = solve(c), ng = [];
          const kmax = Math.min(budget, g.length - 1 + sc.length - 1);
          for (let k = 0; k <= kmax; k++) ng.push({ w: NEG, pick: null });
          for (let a = 0; a < g.length; a++) {
            if (g[a].w <= NEG / 2) continue;
            for (let b = 0; b < sc.length && a + b <= budget; b++) {
              if (sc[b].w <= NEG / 2) continue;
              const w = g[a].w + sc[b].w;
              if (w > ng[a + b].w) ng[a + b] = { w, pick: g[a].pick.concat(b ? [[c, b]] : []) };
            }
          }
          g = ng;
        }
      }
      // result array: res[0] = v not taken, res[k>=1] = v taken plus k-1 nodes below
      const res = [{ w: mustSet.has(id) ? NEG : 0, pick: [] }];
      for (let k = 1; k <= Math.min(budget, g.length); k++) {
        const gi = g[k - 1];
        res.push(!usable || !gi || gi.w <= NEG / 2 ? { w: NEG, pick: null } : { w: weightOf(n) + gi.w, pick: gi.pick });
      }
      memo[id] = res; return res;
    }
    // virtual root: forest over the root's children
    let g = [{ w: 0, pick: [] }];
    for (const c of tree.roots) {
      const sc = solve(c), ng = [];
      const kmax = Math.min(budget, g.length - 1 + sc.length - 1);
      for (let k = 0; k <= kmax; k++) ng.push({ w: NEG, pick: null });
      for (let a = 0; a < g.length; a++) {
        if (g[a].w <= NEG / 2) continue;
        for (let b = 0; b < sc.length && a + b <= budget; b++) {
          if (sc[b].w <= NEG / 2) continue;
          const w = g[a].w + sc[b].w;
          if (w > ng[a + b].w) ng[a + b] = { w, pick: g[a].pick.concat(b ? [[c, b]] : []) };
        }
      }
      g = ng;
    }
    let bestK = 0, bestW = -Infinity;
    for (let k = 0; k < g.length && k <= budget; k++) if (g[k].w > -1e17 && g[k].w > bestW) { bestW = g[k].w; bestK = k; }
    const ids = [];
    const collect = (id, k) => { ids.push(id); const e = memo[id][k]; const pick = e.pick || []; pick.forEach(([c, kc]) => collect(c, kc)); };
    (g[bestK].pick || []).forEach(([c, kc]) => collect(c, kc));
    return { ids, total: bestW };
  }

  // Non-linear score. scoreOf(sumEffects) -> number. Marginal weight of one unit of each effect at the current build, then knapsack again.
  function optimise(tree, opts) {
    const { budget, level, scoreOf, start, must } = opts;
    const iters = opts.iters || 10;
    let cur = start && start.length ? start.slice() : [];
    // start from a build that is at least legal
    let best = null;
    const effectKeys = Array.from(new Set(Object.values(tree.nodes).map((n) => (n.effect === 'effLevel' ? 'effLevel:' + n.skill : n.effect))));
    const seen = new Set();
    for (let it = 0; it < iters; it++) {
      const base = sumEffects(tree, cur), s0 = scoreOf(base);
      const w = {};
      effectKeys.forEach((k) => {
        // step size of one typical node of that effect, so tiny numbers do not vanish in rounding
        const sample = Object.values(tree.nodes).find((n) => (n.effect === 'effLevel' ? 'effLevel:' + n.skill : n.effect) === k);
        const step = Math.max(1e-6, Math.abs(sample.value));
        const probe = JSON.parse(JSON.stringify(base));
        if (k.startsWith('effLevel:')) { const sk = k.slice(9); probe.effLevel[sk] = (probe.effLevel[sk] || 0) + step; } else probe[k] = (probe[k] || 0) + step;
        w[k] = (scoreOf(probe) - s0) / step;
      });
      const weightOf = (n) => n.value * (w[n.effect === 'effLevel' ? 'effLevel:' + n.skill : n.effect] || 0);
      const r = knapsack(tree, budget, level, weightOf, must);
      const sig = r.ids.slice().sort().join(',');
      const sc = scoreOf(sumEffects(tree, r.ids));
      if (!best || sc > best.score) best = { ids: r.ids, score: sc };
      if (seen.has(sig)) break;                      // converged, or cycling between builds already seen
      seen.add(sig);
      cur = r.ids;
    }
    return best;
  }

  // A valid order to take the nodes in: parents first, and at each step the node with the best weight that is available.
  function buildOrder(tree, ids, weightOf) {
    const set = new Set(ids), done = new Set(), order = [];
    const avail = () => ids.filter((id) => !done.has(id) && (tree.nodes[id].parent === tree.rootId || done.has(tree.nodes[id].parent)));
    // value of taking a node including the not-yet-taken nodes below it that make it worthwhile (best "average per node" chain)
    const chainValue = (id) => {
      let best = weightOf(tree.nodes[id]);
      const rec = (n, sum, len) => { const avg = sum / len; if (avg > best) best = avg; tree.nodes[n].children.forEach((c) => { if (set.has(c) && !done.has(c)) rec(c, sum + weightOf(tree.nodes[c]), len + 1); }); };
      tree.nodes[id].children.forEach((c) => { if (set.has(c)) rec(c, weightOf(tree.nodes[id]) + weightOf(tree.nodes[c]), 2); });
      return best;
    };
    while (done.size < ids.length) {
      const a = avail(); if (!a.length) break;
      a.sort((x, y) => chainValue(y) - chainValue(x));
      done.add(a[0]); order.push(a[0]);
    }
    return order;
  }

  // Nodes to remove / add to get from the current allocation to a target (removals are leaves first: only a node without taken children can be refunded).
  function diff(tree, current, target) {
    const cur = new Set(current), tg = new Set(target);
    const add = target.filter((id) => !cur.has(id)), remove = current.filter((id) => !tg.has(id));
    const order = []; const left = new Set(remove);
    while (left.size) {
      const leaves = [...left].filter((id) => !tree.nodes[id].children.some((c) => left.has(c) || (cur.has(c) && !tg.has(c) && left.has(c))));
      const leaf = [...left].filter((id) => !tree.nodes[id].children.some((c) => cur.has(c) && left.has(c)));
      const use = leaf.length ? leaf : [...left];
      use.forEach((id) => { order.push(id); left.delete(id); });
    }
    return { add, remove: order, refundCredits: remove.length * 3 };
  }

  const api = { buildTree, sumEffects, validate, knapsack, optimise, buildOrder, diff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__ccTreeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
