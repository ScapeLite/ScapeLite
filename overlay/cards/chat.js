// ScapeLite card: Chat. The model builder of the chat card (what the Info Bar draws as the hover card and as the pinned card).
// Source: Chat panel (.chat-panel) plus the bridge (filters).
// Registered with the shared card layer (card-sync.js); ui-bar.js calls create(ctx) once and build() for every redraw. How a card is defined, refreshed and tested: docs/ARCHITECTURE-CARDS.md.
// Display only: the card reads the game; a click on one of its controls is handed on as the user's own click (ctx.fwd tells the layer to follow the game for a few seconds).
(function () {
  'use strict';
  const CS = window.__ccCardSync; if (!CS || !CS.registerCard) return;
  CS.registerCard('chat', function create(c) {
    const { bridge, txt } = c;
    function chatRich() {
      const b = bridge(); let f = null; try { f = b && b.chat && b.chat() && b.chat().filters; } catch (e) { /* not ready */ }
      const lines = []; const root = document.querySelector('.chat-panel');
      if (root) [...root.querySelectorAll('.chat-message')].slice(-60).forEach((m) => {
        const ch = m.dataset.channel || ''; if (f && f[ch] === false) return;
        const ts = m.querySelector('.chat-timestamp'); const cl = m.cloneNode(true); cl.querySelectorAll('.chat-timestamp,.chat-world-tag,.chat-badge-slot,.tooltip').forEach((x) => x.remove()); let txt = cl.textContent.trim();
        const wt = m.querySelector(':scope > .chat-world-tag'), bd = [...m.querySelectorAll('.chat-badge-slot img')].map((i) => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '' })).filter((x) => /^\/assets\//.test(x.src));
        if (txt) lines.push({ ts: ts ? ts.textContent.replace(/[\[\]\s]/g, '') : '', ch, text: txt, world: wt ? wt.textContent.trim() : '', badges: bd, color: m.style.color || '' });
      });
      const shown = lines.slice(-14);
      return { title: 'Chat', note: f ? Object.keys(f).filter((k) => f[k]).join(' \u00B7 ') : '', blocks: shown.length ? [{ kind: 'chat', lines: shown }] : [{ kind: 'text', text: 'No messages yet.' }] };
    }
    return { source: 'chat', build: chatRich };
  });
})();
