// ScapeLite card: Friends. The model builder of the friends card (what the Info Bar draws as the hover card and as the pinned card).
// Source: bridge.social() (friends, clan, muted); the game panel only for the add box and the row click.
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('friends', function create(c) {
    const { setting, bridge, panelEl, txt, redraw } = c;
    // Friends / Clan / Muted. The lists come from the game's data (bridge.social); the tab you pick is kept here, so it never depends on the game's own panel.
    // Adding a friend passes the name you typed to the game's own add box.
    let friendsMode = 'friends'; try { const m = localStorage.getItem('cc-friends-mode'); if (m === 'clan' || m === 'muted') friendsMode = m; } catch (e) { /* default */ }
    const setFriendsMode = (m) => { friendsMode = m; try { localStorage.setItem('cc-friends-mode', m); } catch (e) { /* not saved */ } try { redraw('friends'); } catch (e) { /* card gone */ } };
    function friendsRich() {
      const root = panelEl('friends'); let soc = null;
      try { soc = window.__ccBridge && window.__ccBridge.ok() && window.__ccBridge.social ? window.__ccBridge.social() : null; } catch (e) { soc = null; }
      const tabs = [['friends', 'Friends'], ['clan', 'Clan'], ['muted', 'Muted']].map(([k, label]) => ({ label, on: friendsMode === k, onClick: () => setFriendsMode(k) }));
      let list = [], empty = 'Nobody to show on this tab.';
      if (soc) {
        const src = friendsMode === 'clan' ? soc.clan.members : friendsMode === 'muted' ? soc.muted : soc.friends;
        list = src.map((p) => ({ img: p.skill ? '/assets/icons/skills/' + p.skill + '.png' : '', name: p.name, sub: p.text, ctx: friendsMode, click: friendsMode === 'friends' && p.online && setting('uiFriendRowClick', true) !== false ? () => { const pe = panelEl('friends'), rw = pe && Array.from(pe.querySelectorAll('.friend-row')).find((x) => txt(x, '.friend-row-name') === p.name); if (rw) rw.click(); } : null, col: friendsMode === 'muted' ? '#f44336' : p.online ? '#4caf50' : (friendsMode === 'clan' ? '#f44336' : '#9a9aa8') }));
        empty = friendsMode === 'friends' ? 'No friends added' : friendsMode === 'muted' ? 'No muted players' : soc.clan.state === 'none' ? 'Not in a clan' : soc.clan.state === 'loading' ? 'Loading clan...' : 'No clan members';
      } else if (root && friendsMode === 'friends') {   // no bridge: read the game panel's friends list
        root.querySelectorAll('.friend-row').forEach((r) => {
          const ic = r.querySelector('.friend-activity-icon'), act = r.querySelector('.friend-row-activity span:not(.friend-activity-icon)');
          list.push({ img: ic ? ic.src : '', name: txt(r, '.friend-row-name'), ctx: 'friends', sub: act ? act.textContent.trim() : '' });
        });
      }
      const add = (name) => {
        const ab = root && root.querySelector('.friends-add-btn'), inp = root && root.querySelector('.friends-add-input'); if (!ab || !inp) return;
        if (inp.style.display === 'none') ab.click();
        inp.value = name; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      };
      const word = friendsMode === 'clan' ? 'member' : friendsMode === 'muted' ? 'muted player' : 'friend';
      return { title: 'Friends', note: list.length ? list.length + ' ' + word + (list.length === 1 ? '' : 's') : '',
        blocks: [{ kind: 'tabs', tabs, add, addTip: 'Add a friend', addHint: 'Enter player name...' }].concat(list.length ? [{ kind: 'rows', rows: list }] : [{ kind: 'text', text: empty }]) };
    }
    return { source: 'friends', build: friendsRich };
  });
})();
