let META = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned ${res.status} (non-JSON response): ${text.slice(0, 150)}`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

function opt(value, label) {
  const o = document.createElement('option');
  o.value = value; o.textContent = label;
  return o;
}

function fmt(n, digits = 0) {
  return typeof n === 'number' ? n.toFixed(digits) : n;
}

function populateSelect(el, items, valueKey, labelKey) {
  el.innerHTML = '';
  for (const it of items) el.appendChild(opt(it[valueKey], it[labelKey]));
}

// ---- Searchable combobox: wraps an existing <select>, keeps it as the
// source of truth (value + options + change events all still work exactly
// as before) but hides it and drives it from a type-to-filter text input.
function makeSearchable(selectId) {
  const select = document.getElementById(selectId);
  if (select._searchableWired) return;
  select._searchableWired = true;
  select.style.display = 'none';

  const wrapper = document.createElement('div');
  wrapper.className = 'searchable';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type to search...';
  input.autocomplete = 'off';
  const list = document.createElement('div');
  list.className = 'searchable-list';
  list.hidden = true;
  wrapper.appendChild(input);
  wrapper.appendChild(list);
  select.insertAdjacentElement('afterend', wrapper);

  function optionsFromSelect() {
    return [...select.options].map(o => ({ value: o.value, label: o.textContent }));
  }

  function render(filterText) {
    const items = optionsFromSelect();
    const filtered = filterText
      ? items.filter(it => it.label.toLowerCase().includes(filterText.toLowerCase()))
      : items;
    list.innerHTML = '';
    for (const it of filtered.slice(0, 100)) {
      const row = document.createElement('div');
      row.className = 'searchable-item';
      row.textContent = it.label;
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select.value = it.value;
        input.value = it.label;
        list.hidden = true;
        select.dispatchEvent(new Event('change'));
      });
      list.appendChild(row);
    }
    list.hidden = filtered.length === 0;
  }

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  select.addEventListener('change', () => {
    const match = optionsFromSelect().find(o => o.value === select.value);
    input.value = match ? match.label : '';
  });

  const initial = optionsFromSelect().find(o => o.value === select.value);
  if (initial) input.value = initial.label;
}

function itemIconUrl(itemId) { return `/assets/icons/items/${itemId}.png`; }
function skillIconUrl(skillId) { return `/assets/icons/skills/${skillId}.png`; }
function uiIconUrl(name) { return `/assets/icons/ui/${name}.png`; }

function nodeIconUrl(node) {
  if (node.type === 'combat') return uiIconUrl('combat');
  if (node.type === 'raid') return uiIconUrl('raid_dungeon');
  if (node.type === 'gauntlet') return uiIconUrl('raid_gauntlet');
  if (node.type === 'skill' && node.skill) return skillIconUrl(node.skill);
  return uiIconUrl('combat');
}

function wireIconPreview(selectId, iconId, urlFn) {
  const select = document.getElementById(selectId);
  const img = document.getElementById(iconId);
  const update = () => { img.src = urlFn(select.value); img.onerror = () => { img.style.visibility = 'hidden'; }; img.onload = () => { img.style.visibility = 'visible'; }; };
  select.addEventListener('change', update);
  update();
}

// ---- Sidebar navigation ----
function initNav() {
  const buttons = document.querySelectorAll('.nav-btn');
  function show(panelId) {
    document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== panelId);
    buttons.forEach(b => b.classList.toggle('active', b.dataset.panel === panelId));
    localStorage.setItem('sw-active-panel', panelId);
    if (panelId === 'mapBuilder') loadMapIfNeeded();
  }
  buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.panel)));
  show(localStorage.getItem('sw-active-panel') || 'profile');
}

async function loadMeta() {
  META = await api('/api/meta');

  // Encounters carry a "[level] Name" label so level-sorted search results
  // (e.g. typing "frost") show their requirement at a glance.
  const encounterOptions = META.encounters.map(e => ({ taskId: e.taskId, label: `[${e.slayRequired}] ${e.name}` }));

  populateSelect(document.getElementById('weaponId'), META.weapons, 'id', 'name');
  populateSelect(document.getElementById('weaponA'), META.weapons, 'id', 'name');
  populateSelect(document.getElementById('weaponB'), META.weapons, 'id', 'name');
  populateSelect(document.getElementById('combatMob'), encounterOptions, 'taskId', 'label');
  populateSelect(document.getElementById('rareDropMob'), encounterOptions, 'taskId', 'label');

  wireIconPreview('weaponId', 'weaponIcon', itemIconUrl);
  wireIconPreview('weaponA', 'weaponAIcon', itemIconUrl);
  wireIconPreview('weaponB', 'weaponBIcon', itemIconUrl);

  makeSearchable('weaponId');
  makeSearchable('weaponA');
  makeSearchable('weaponB');
  makeSearchable('combatMob');
  makeSearchable('rareDropMob');

  const bankSel = document.getElementById('currentBankId');
  for (const b of META.banks) bankSel.appendChild(opt(b.id, b.name));

  const skillSel = document.getElementById('skillingSkill');
  for (const s of Object.keys(META.activitiesBySkill)) skillSel.appendChild(opt(s, s));

  const grid = document.getElementById('skillGrid');
  grid.innerHTML = '';
  for (const s of META.skills) {
    const tile = document.createElement('div');
    tile.className = 'skill-tile';
    tile.title = s.name;
    tile.innerHTML = `<img src="${skillIconUrl(s.id)}" alt="${s.name}" onerror="this.style.visibility='hidden'">
      <input type="number" id="skill_${s.id}" value="1" min="1">`;
    grid.appendChild(tile);
  }

  document.getElementById('rareDropMob').addEventListener('change', populateRareDropItems);
  populateRareDropItems();

  document.getElementById('skillingSkill').addEventListener('change', renderSkillingOptionRows);
  renderSkillingOptionRows();
  renderSlayOptionRows();

  const questSel = document.getElementById('completedQuests');
  for (const q of META.quests) questSel.appendChild(opt(q.id, q.name));
}

function populateRareDropItems() {
  const mobId = document.getElementById('rareDropMob').value;
  const enc = META.encounters.find(e => e.taskId === mobId);
  const sel = document.getElementById('rareDropItem');
  sel.innerHTML = '';
  for (const rd of (enc?.rareDrops || [])) sel.appendChild(opt(JSON.stringify(rd), `${rd.name} (1 in ${rd.oneInChance})`));
}

function renderSkillingOptionRows() {
  const skill = document.getElementById('skillingSkill').value;
  const activities = META.activitiesBySkill[skill] || [];
  const container = document.getElementById('skillingOptions');
  container.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const activitySel = document.createElement('select');
    activitySel.id = `skillingActivity_${i}`;
    for (const a of activities) activitySel.appendChild(opt(a.activityId, a.name));
    const qty = document.createElement('input');
    qty.type = 'number'; qty.id = `skillingQty_${i}`; qty.value = 80;
    const dist = document.createElement('input');
    dist.type = 'number'; dist.id = `skillingDist_${i}`; dist.placeholder = 'auto';
    dist.title = 'Route distance shown in-game next to this task (optional) -- overrides the nearest-node estimate';
    row.appendChild(labelWrap('Option ' + (i + 1), activitySel));
    row.appendChild(labelWrap('Quantity', qty));
    row.appendChild(labelWrap('Route dist.', dist));
    container.appendChild(row);
  }
}

function renderSlayOptionRows() {
  const container = document.getElementById('slayOptions');
  container.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const mobSel = document.createElement('select');
    mobSel.id = `slayMob_${i}`;
    for (const e of META.encounters) mobSel.appendChild(opt(e.taskId, `[${e.slayRequired}] ${e.name}`));
    const qty = document.createElement('input');
    qty.type = 'number'; qty.id = `slayQty_${i}`; qty.value = 60;
    const dist = document.createElement('input');
    dist.type = 'number'; dist.id = `slayDist_${i}`; dist.placeholder = 'auto';
    dist.title = 'Route distance shown in-game next to this task (optional) -- overrides the computed estimate';
    row.appendChild(labelWrap('Option ' + (i + 1), mobSel));
    row.appendChild(labelWrap('Quantity', qty));
    row.appendChild(labelWrap('Route dist.', dist));
    container.appendChild(row);
    makeSearchable(`slayMob_${i}`);
  }
}

function labelWrap(text, el) {
  const label = document.createElement('label');
  label.appendChild(document.createTextNode(text));
  label.appendChild(el);
  return label;
}

function collectProfile() {
  const skills = {};
  for (const s of META.skills) skills[s.id] = Number(document.getElementById(`skill_${s.id}`).value) || 1;
  const tier = document.getElementById('crystalTier').value;
  return {
    skills,
    weaponId: document.getElementById('weaponId').value,
    style: document.getElementById('style').value,
    critSources: Number(document.getElementById('critSources').value) || 0,
    currentBankId: document.getElementById('currentBankId').value || null,
    creditStock: Number(document.getElementById('creditStock').value) || 0,
    slayCreditStock: Number(document.getElementById('slayCreditStock').value) || 0,
    crystal: tier ? { tier: Number(tier), charges: Number(document.getElementById('crystalCharges').value) || 0 } : null,
    skillingSources: 0, toolReduction: 0, flatReduction: 0, lucky: false
  };
}

async function loadProfileIntoForm() {
  const p = await api('/api/profile');
  document.getElementById('weaponId').value = p.weaponId;
  document.getElementById('style').value = p.style;
  document.getElementById('critSources').value = p.critSources;
  document.getElementById('currentBankId').value = p.currentBankId || '';
  document.getElementById('creditStock').value = p.creditStock;
  document.getElementById('slayCreditStock').value = p.slayCreditStock;
  if (p.crystal) {
    document.getElementById('crystalTier').value = p.crystal.tier;
    document.getElementById('crystalCharges').value = p.crystal.charges;
  }
  for (const [id, lvl] of Object.entries(p.skills || {})) {
    const el = document.getElementById(`skill_${id}`);
    if (el) el.value = lvl;
  }
  document.getElementById('weaponId').dispatchEvent(new Event('change'));
}

document.getElementById('saveProfile').addEventListener('click', async () => {
  await api('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectProfile()) });
  const status = document.getElementById('profileStatus');
  status.textContent = 'Saved.';
  setTimeout(() => status.textContent = '', 2000);
});

document.getElementById('runCombat').addEventListener('click', async () => {
  const out = document.getElementById('combatResult');
  out.textContent = 'Running...';
  try {
    const r = await api('/api/combat/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobTaskId: document.getElementById('combatMob').value }) });
    out.textContent = `${r.mobName}\nHit chance: ${fmt(r.hitChance * 100, 1)}%  |  DPS: ${fmt(r.dps, 2)}\nKill time: ${fmt(r.killSeconds, 2)}s (${fmt(r.killsPerHour)} kills/hr)\nTotal XP/hr: ${fmt(r.totalXpPerHour)}  |  Chosen-skill XP/hr: ${fmt(r.chosenSkillXpPerHour)}\nExpected damage taken per kill: ${fmt(r.damageTakenPerKill, 2)}`;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

document.getElementById('runCompare').addEventListener('click', async () => {
  const out = document.getElementById('compareResult');
  out.textContent = 'Running...';
  try {
    const r = await api('/api/combat/compare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobTaskId: document.getElementById('combatMob').value, weaponIdA: document.getElementById('weaponA').value, weaponIdB: document.getElementById('weaponB').value })
    });
    out.textContent = `${r.mobName}\nA: ${fmt(r.weaponIdA.dps, 2)} DPS, ${fmt(r.weaponIdA.killsPerHour)} kills/hr, ${fmt(r.weaponIdA.chosenSkillXpPerHour)} XP/hr\nB: ${fmt(r.weaponIdB.dps, 2)} DPS, ${fmt(r.weaponIdB.killsPerHour)} kills/hr, ${fmt(r.weaponIdB.chosenSkillXpPerHour)} XP/hr`;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

document.getElementById('runSkillingReroll').addEventListener('click', async () => {
  const out = document.getElementById('skillingRerollResult');
  out.textContent = 'Running...';
  try {
    const visibleOptions = [0, 1, 2].map(i => {
      const distVal = document.getElementById(`skillingDist_${i}`).value;
      return {
        activityId: document.getElementById(`skillingActivity_${i}`).value,
        quantity: Number(document.getElementById(`skillingQty_${i}`).value),
        travelDistanceOverride: distVal ? Number(distVal) : undefined
      };
    });
    const r = await api('/api/reroll/skilling', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillId: document.getElementById('skillingSkill').value, visibleOptions }) });
    out.innerHTML = renderRerollResult(r);
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

document.getElementById('runSlayReroll').addEventListener('click', async () => {
  const out = document.getElementById('slayRerollResult');
  out.textContent = 'Running...';
  try {
    const visibleOptions = [0, 1, 2].map(i => {
      const distVal = document.getElementById(`slayDist_${i}`).value;
      return {
        taskId: document.getElementById(`slayMob_${i}`).value,
        quantity: Number(document.getElementById(`slayQty_${i}`).value),
        travelDistanceOverride: distVal ? Number(distVal) : undefined
      };
    });
    const r = await api('/api/reroll/slay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibleOptions }) });
    out.innerHTML = renderRerollResult(r);
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

function renderRerollResult(r) {
  const lines = r.visibleValues.map(v => {
    const tp = v.teleportUsed ? ' [teleport]' : '';
    return `  ${v.option.activityId || v.option.taskId} x${v.option.quantity}: ${fmt(v.effectiveXpPerHour)} XP/hr effective (route ${fmt(v.travelDistance)}px${tp})`;
  });
  const recClass = r.recommendation === 'reroll' ? 'rec-reroll' : 'rec-keep';
  return `${lines.join('\n')}\n\nFresh-draw EV: ${fmt(r.freshDrawEV)} XP/hr  (reroll cost: ${r.rerollCost} credits, ~${fmt(r.creditCostXp)} XP-equiv)\n<span class="${recClass}">Recommendation: ${r.recommendation.toUpperCase()}</span> (margin: ${fmt(r.marginXpPerHour)} XP/hr)`;
}

// ---- Map task builder ----
let MAP_DATA = null;
let queueEntries = [];
let queueIdCounter = 0;
let dragSrcIndex = null;

async function loadMapIfNeeded() {
  if (MAP_DATA) { evaluateQueue(); return; } // refresh marker in case profile's bank changed
  MAP_DATA = await api('/api/map');
  renderMap();
  evaluateQueue(); // places the "you are here" marker even with an empty queue
}

function skillLabel(skillId) {
  const s = MAP_DATA.skills.find(s => s.id === skillId);
  return s ? s.name : skillId;
}

// Shows `menu` on hovering either `trigger` or `menu` itself, hides it
// after a short grace period once the pointer leaves both. Avoids the
// classic CSS-hover "dead zone" bug: pure :hover chains drop as soon as
// the pointer crosses the (unavoidable, position:absolute) gap between a
// trigger and its popup, before it reaches the popup.
function attachHoverBridge(trigger, menu) {
  let hideTimer = null;
  function show() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } menu.classList.add('visible'); }
  function scheduleHide() { hideTimer = setTimeout(() => menu.classList.remove('visible'), 300); }
  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', scheduleHide);
  menu.addEventListener('mouseenter', show);
  menu.addEventListener('mouseleave', scheduleHide);
}

function buildSubmenuForSkillNodes(bankId, skillId, nodes) {
  const submenu = document.createElement('div');
  submenu.className = 'submenu';
  for (const node of nodes) {
    if (node.tiers.length === 1) {
      submenu.appendChild(buildLeaf(`${node.name} — ${node.tiers[0].name}`, () => addQueueEntry({
        type: 'skilling', activityId: node.tiers[0].activityId, nodeId: node.nodeId,
        name: `${node.tiers[0].name} (${node.name})`, levelRequired: node.tiers[0].levelRequired
      })));
    } else {
      const nodeItem = document.createElement('div');
      nodeItem.className = 'menu-item has-submenu';
      nodeItem.textContent = node.name;
      const tierMenu = document.createElement('div');
      tierMenu.className = 'submenu';
      for (const tier of node.tiers) {
        tierMenu.appendChild(buildLeaf(`[${tier.levelRequired}] ${tier.name}`, () => addQueueEntry({
          type: 'skilling', activityId: tier.activityId, nodeId: node.nodeId,
          name: `${tier.name} (${node.name})`, levelRequired: tier.levelRequired
        })));
      }
      nodeItem.appendChild(tierMenu);
      attachHoverBridge(nodeItem, tierMenu);
      submenu.appendChild(nodeItem);
    }
  }
  return submenu;
}

function buildLeaf(label, onClick) {
  const leaf = document.createElement('div');
  leaf.className = 'menu-item';
  leaf.textContent = label;
  leaf.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return leaf;
}

function buildBankMenu(bankId) {
  const bucket = MAP_DATA.byBank[bankId];
  const menu = document.createElement('div');
  menu.className = 'bank-menu';

  for (const skillId of Object.keys(bucket.skills)) {
    const item = document.createElement('div');
    item.className = 'menu-item has-submenu';
    item.innerHTML = `<img src="${skillIconUrl(skillId)}" onerror="this.remove()"> ${skillLabel(skillId)}`;
    const skillSubmenu = buildSubmenuForSkillNodes(bankId, skillId, bucket.skills[skillId]);
    item.appendChild(skillSubmenu);
    attachHoverBridge(item, skillSubmenu);
    menu.appendChild(item);
  }

  if (bucket.combat.length) {
    const combatItem = document.createElement('div');
    combatItem.className = 'menu-item has-submenu';
    combatItem.textContent = '⚔️ Combat';
    const submenu = document.createElement('div');
    submenu.className = 'submenu';
    for (const enc of bucket.combat) {
      submenu.appendChild(buildLeaf(`[${enc.slayRequired}] ${enc.name}`, () => addQueueEntry({
        type: 'slay', taskId: enc.taskId, nodeId: enc.nodeId, name: enc.name, levelRequired: enc.slayRequired
      })));
    }
    combatItem.appendChild(submenu);
    attachHoverBridge(combatItem, submenu);
    menu.appendChild(combatItem);
  }

  return menu;
}

// Percent position (0-100, matches the SVG routes layer's viewBox exactly
// so dots/icons and lines always line up), with padding so edge nodes
// aren't clipped.
function coordPct(x, y) {
  const { minX, maxX, minY, maxY } = MAP_DATA.bounds;
  const pad = 4;
  return {
    x: pad + ((x - minX) / (maxX - minX)) * (100 - 2 * pad),
    y: pad + ((y - minY) / (maxY - minY)) * (100 - 2 * pad)
  };
}
function bankPct(bankId) {
  const bank = MAP_DATA.banks.find(b => b.id === bankId);
  return bank ? coordPct(bank.x, bank.y) : null;
}

const TIER_NAMES = ['', 'Feeble', 'Dire', 'Savage', 'Fell', 'Ancient', 'Chaos'];

function showNodeTooltip(n, event) {
  const tooltip = document.getElementById('nodeTooltip');
  const rect = document.getElementById('mapViewport').getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  let sub = '';
  if (n.type === 'skill') sub = skillLabel(n.skill);
  else if (n.type === 'combat') sub = `${TIER_NAMES[n.tier] || ''} &middot; Slay ${n.slayRequired}${n.slayCategory ? ' &middot; ' + n.slayCategory : ''}`;
  else if (n.type === 'raid') sub = 'Raid';
  else if (n.type === 'gauntlet') sub = 'Gauntlet';

  tooltip.innerHTML = `<div class="tt-title">${n.name}</div><div class="tt-sub">${sub}</div>`;
  tooltip.style.left = Math.min(x + 14, rect.width - 180) + 'px';
  tooltip.style.top = (y + 14) + 'px';
  tooltip.hidden = false;
}

function hideNodeTooltip() {
  document.getElementById('nodeTooltip').hidden = true;
}

function renderMap() {
  const canvas = document.getElementById('mapCanvas');
  canvas.innerHTML = '';

  // Satellite nodes first (underneath banks, z-order via DOM order).
  for (const n of MAP_DATA.nodes) {
    const { x: leftPct, y: topPct } = coordPct(n.x, n.y);
    const el = document.createElement('div');
    el.className = `sat-node sat-${n.type}`;
    if (n.type === 'combat' && n.tier) el.classList.add(`tier-${n.tier}`);
    el.style.left = leftPct + '%';
    el.style.top = topPct + '%';
    el.innerHTML = `<img src="${nodeIconUrl(n)}" onerror="this.style.visibility='hidden'">`;
    el.addEventListener('mouseenter', (e) => showNodeTooltip(n, e));
    el.addEventListener('mouseleave', hideNodeTooltip);
    if (n.type === 'combat' && n.taskId) {
      el.classList.add('clickable');
      el.addEventListener('click', () => addQueueEntry({ type: 'slay', taskId: n.taskId, nodeId: n.id, name: n.name, levelRequired: n.slayRequired }));
    }
    canvas.appendChild(el);
  }

  for (const bank of MAP_DATA.banks) {
    const { x: leftPct, y: topPct } = bankPct(bank.id);
    const node = document.createElement('div');
    node.className = 'map-node';
    node.style.left = leftPct + '%';
    node.style.top = topPct + '%';
    node.innerHTML = `<img class="map-dot" src="${uiIconUrl('chest')}" title="${bank.name}" onerror="this.outerHTML='<div class=map-dot></div>'"><div class="map-label">${bank.name}</div>`;
    const bankMenu = buildBankMenu(bank.id);
    node.appendChild(bankMenu);
    attachHoverBridge(node, bankMenu);
    canvas.appendChild(node);
  }
}

function addQueueEntry(entry) {
  entry.id = 'q' + (queueIdCounter++);
  entry.quantity = 60;
  queueEntries.push(entry);
  renderQueue();
  evaluateQueue();
}

function renderQueue() {
  const list = document.getElementById('queueList');
  list.innerHTML = '';
  queueEntries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'queue-row';
    row.draggable = true;
    row.dataset.index = i;

    const handle = document.createElement('span');
    handle.textContent = '⠿';
    handle.style.color = 'var(--muted)';

    const name = document.createElement('span');
    name.textContent = `${entry.type === 'slay' ? '⚔️' : '🔁'} ${entry.name}`;

    const qty = document.createElement('input');
    qty.type = 'number'; qty.className = 'qty-input'; qty.value = entry.quantity;
    qty.addEventListener('change', () => { entry.quantity = Number(qty.value) || 1; evaluateQueue(); });

    const rate = document.createElement('span');
    rate.className = 'xp-rate';
    rate.id = `queueRate_${entry.id}`;
    rate.textContent = '…';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => { queueEntries.splice(i, 1); renderQueue(); evaluateQueue(); });

    row.append(handle, name, qty, rate, removeBtn);

    row.addEventListener('dragstart', () => { dragSrcIndex = i; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === i) return;
      const [moved] = queueEntries.splice(dragSrcIndex, 1);
      queueEntries.splice(i, 0, moved);
      dragSrcIndex = null;
      renderQueue();
      evaluateQueue();
    });

    list.appendChild(row);
  });
}

// Green (short) -> red (long). 15000px matches the longest real
// bank-to-bank route in the game's own data, so the scale reaches true
// red only for genuinely extreme routes, not merely "a bit far."
function distanceColor(distance) {
  const t = Math.min(1, distance / 15000);
  return `hsl(${(1 - t) * 130}, 70%, 55%)`;
}

function renderPlayerMarker(bankId) {
  const svg = document.getElementById('mapRoutesSvg');
  svg.querySelectorAll('.player-marker, .player-marker-ring').forEach(el => el.remove());
  const pos = bankId && bankPct(bankId);
  if (!pos) return;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('cx', pos.x); ring.setAttribute('cy', pos.y); ring.setAttribute('r', 2.2);
  ring.setAttribute('class', 'player-marker-ring');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', pos.x); dot.setAttribute('cy', pos.y); dot.setAttribute('r', 1.6);
  dot.setAttribute('class', 'player-marker');
  svg.append(ring, dot);
}

function renderRoutes(results) {
  const svg = document.getElementById('mapRoutesSvg');
  svg.querySelectorAll('.route-line, .route-check').forEach(el => el.remove());
  for (const r of results) {
    if (!r.fromBankId || !r.toBankId || r.fromBankId === r.toBankId) continue;
    const from = bankPct(r.fromBankId), to = bankPct(r.toBankId);
    if (!from || !to) continue;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
    line.setAttribute('class', 'route-line' + (r.teleportUsed ? ' teleport' : ''));
    if (!r.teleportUsed) line.style.stroke = distanceColor(r.travelDistance);
    svg.appendChild(line);

    if (r.teleportUsed) {
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      check.setAttribute('x', (from.x + to.x) / 2);
      check.setAttribute('y', (from.y + to.y) / 2);
      check.setAttribute('class', 'route-check');
      check.textContent = '✓';
      svg.appendChild(check);
    }
  }
}

async function evaluateQueue() {
  const summary = document.getElementById('queueSummary');
  try {
    const entries = queueEntries.map(e => ({ id: e.id, type: e.type, activityId: e.activityId, taskId: e.taskId, nodeId: e.nodeId, quantity: e.quantity }));
    const r = await api('/api/queue/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });

    renderPlayerMarker(r.startBankId);
    renderRoutes(r.results);

    for (const res of r.results) {
      const el = document.getElementById(`queueRate_${res.id}`);
      if (el) {
        const tp = res.teleportUsed ? ' ✓🔮' : '';
        el.textContent = `${fmt(res.effectiveXpPerHour)} XP/hr (+${fmt(res.travelDistance)}px${tp})`;
      }
    }
    summary.textContent = entries.length
      ? `Total: ${fmt(r.totalXp)} XP over ${fmt(r.totalSeconds / 60, 1)} min  |  Route: ${fmt(r.totalTravelDistance)}px  |  Overall: ${fmt(r.totalXpPerHour)} XP/hr`
      : '';
  } catch (e) { summary.textContent = 'Error: ' + e.message; }
}

document.getElementById('runQuestRoute').addEventListener('click', async () => {
  const out = document.getElementById('questRouteResult');
  out.textContent = 'Running...';
  try {
    const completedQuestIds = [...document.getElementById('completedQuests').selectedOptions].map(o => o.value);
    const r = await api('/api/questroute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedQuestIds, maxQuests: Number(document.getElementById('maxQuests').value) || 15 })
    });
    const lines = r.route.map((q, i) => `  ${i + 1}. ${q.name} (+${fmt(q.travelDistance)}px)`);
    out.textContent = `${lines.join('\n')}\n\nTotal travel: ${fmt(r.totalTravel)}px`;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

document.getElementById('runRareDrop').addEventListener('click', async () => {
  const out = document.getElementById('rareDropResult');
  out.textContent = 'Running...';
  try {
    const drop = JSON.parse(document.getElementById('rareDropItem').value);
    const normal = document.getElementById('normalXpPerHour').value;
    const r = await api('/api/raredrop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mobTaskId: document.getElementById('rareDropMob').value,
        oneInChance: drop.oneInChance,
        normalActivityXpPerHour: normal ? Number(normal) : undefined,
        expectedRemainingHours: Number(document.getElementById('remainingHours').value) || null
      })
    });
    out.textContent = `${r.mobName} -> ${drop.name} (1 in ${drop.oneInChance})\nKill rate: ${fmt(r.killsPerHour)} /hr  |  Bonus from owning it: +${fmt(r.bonusXpPerHourGain, 1)} XP/hr\nExpected farm time: ${fmt(r.farmHours, 1)}h\nOpportunity cost: ${fmt(r.opportunityCostXp)} XP  |  Payback period: ${r.paybackHours === Infinity ? 'never' : fmt(r.paybackHours, 1) + 'h'}\nWorth it over your remaining playtime? ${r.worthIt === null ? 'unknown (set remaining hours)' : r.worthIt}`;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

// ---- Image import ----
let lastImportResult = null;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('runImport').addEventListener('click', async () => {
  const out = document.getElementById('importResult');
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files[0]) { out.textContent = 'Choose an image first.'; return; }
  out.textContent = 'Parsing...';
  document.getElementById('importApply').hidden = true;
  try {
    const base64 = await fileToBase64(fileInput.files[0]);
    const r = await api('/api/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType: fileInput.files[0].type, kind: document.getElementById('importKind').value })
    });
    lastImportResult = r;
    out.textContent = JSON.stringify(r, null, 2);
    if (r.skills) document.getElementById('importApply').hidden = false;
  } catch (e) { out.textContent = 'Error: ' + e.message; }
});

document.getElementById('applyImport').addEventListener('click', () => {
  if (!lastImportResult?.skills) return;
  for (const [id, lvl] of Object.entries(lastImportResult.skills)) {
    const el = document.getElementById(`skill_${id}`);
    if (el) el.value = lvl;
  }
  document.querySelector('[data-panel="profile"]').click();
});

(async function init() {
  initNav();
  await loadMeta();
  await loadProfileIntoForm();
})();
