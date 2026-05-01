// Telephone — host-side rendering. Owns `screen-tel-*` and animates the chain
// reveal client-side so the server doesn't have to manage per-link timing.

(function () {
  function init() {
    const { socket, showFinal } = window.HBHost;
    const { showScreen, esc, formatTime, renderStandings } = window.HBC;

    // Map chainId -> latest tick info, used to render progress bars while
    // links are in flight. Server only refreshes this on transitions plus
    // a per-second tick — we don't store the active timer here.
    const chainTicks = {};

    socket.on('tel_assign', (payload) => {
      // Host gets the full chain summary.
      if (!payload.chains) return; // player payload — ignored on host
      document.getElementById('tel-assign-set').textContent =
        `Set ${payload.setNum} of ${payload.totalSets}`;
      const summary = document.getElementById('tel-assign-summary');
      summary.innerHTML = payload.chains.map((c, i) =>
        `<div class="tel-assign-chain">
          <strong>Chain ${i + 1} (${c.length} players)</strong>
          ${c.players.map(p => esc(p.name)).join(' → ')}
        </div>`
      ).join('');
      showScreen('screen-tel-assign');
    });

    socket.on('tel_chain_progress', ({ chains }) => {
      const container = document.getElementById('tel-chain-bars');
      container.innerHTML = chains.map((c, i) => {
        const segs = [];
        for (let s = 0; s < c.totalLinks; s++) {
          let cls = '';
          if (s < c.activeLinkIndex) cls = 'done';
          else if (s === c.activeLinkIndex && !c.completed) cls = 'active';
          segs.push(`<div class="tel-segment ${cls}"></div>`);
        }
        // Add an extra "guess" segment after links.
        let guessCls = '';
        if (c.hasGuess) guessCls = 'guess-done';
        else if (c.guessPending) guessCls = 'guess-pending';
        segs.push(`<div class="tel-segment ${guessCls}"></div>`);

        let state;
        if (c.completed && c.hasGuess) state = 'Done';
        else if (c.guessPending) state = 'Guessing...';
        else state = `Link ${Math.min(c.activeLinkIndex + 1, c.totalLinks)} of ${c.totalLinks}`;

        return `<div class="tel-chain-bar">
          <span class="tel-chain-label">Chain ${i + 1}</span>
          <div class="tel-segments">${segs.join('')}</div>
          <span class="tel-chain-state">${state}</span>
        </div>`;
      }).join('');
      showScreen('screen-tel-progress');
    });

    socket.on('tel_chain_tick', ({ chainId, secondsLeft }) => {
      chainTicks[chainId] = secondsLeft;
    });

    // ---- Reveal animation ----
    socket.on('tel_reveal_begin', ({ totalChains }) => {
      document.getElementById('tel-reveal-counter').textContent = `Chain 1 of ${totalChains}`;
      document.getElementById('tel-reveal-stack').innerHTML = '';
      showScreen('screen-tel-reveal');
    });

    let revealTimers = [];
    function clearRevealTimers() {
      for (const t of revealTimers) clearTimeout(t);
      revealTimers = [];
    }

    socket.on('tel_reveal_chain', ({ chainIndex, totalChains, prompt, links, guess }) => {
      clearRevealTimers();
      document.getElementById('tel-reveal-counter').textContent =
        `Chain ${chainIndex + 1} of ${totalChains}`;
      const stack = document.getElementById('tel-reveal-stack');

      // Build all cards hidden. Then schedule them to "show" sequentially.
      const cards = [];
      cards.push(buildCard({ kind: 'original', author: 'Original prompt', text: prompt }));
      links.forEach((l, i) => {
        cards.push(buildArrow());
        cards.push(buildCard({
          kind: 'link',
          author: `${l.playerName} (${l.wordLimit} words)`,
          text: l.text || '[no response]'
        }));
      });
      if (guess) {
        cards.push(buildArrow());
        cards.push(buildCard({
          kind: 'guess',
          author: `${guess.playerName} guessed`,
          text: guess.text || '[no response]'
        }));
      }
      stack.innerHTML = cards.join('');

      const items = stack.children;
      for (let i = 0; i < items.length; i++) {
        const t = setTimeout(() => {
          items[i].classList.add('shown');
          // Auto-scroll the stack so newer items stay in view (purely visual).
          if (items[i].scrollIntoView) {
            try { items[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
          }
        }, i * 1500); // visual stagger; the server's per-chain budget is separate
        revealTimers.push(t);
      }
    });

    function buildCard({ kind, author, text }) {
      const cls = kind === 'original' ? 'original' : (kind === 'guess' ? 'guess' : '');
      return `<div class="tel-reveal-card ${cls}">
        <div class="tel-reveal-author">${esc(author)}</div>
        <div class="tel-reveal-text">${esc(text)}</div>
      </div>`;
    }
    function buildArrow() { return `<div class="tel-reveal-arrow shown">↓</div>`; }

    // ---- Voting ----
    socket.on('tel_vote_phase', ({ chains, timer }) => {
      document.getElementById('tel-vote-timer').textContent = formatTime(timer);
      document.getElementById('tel-vote-summary').innerHTML = chains.map((c, i) =>
        `<div class="tel-vote-chain-card">
          <div class="tel-vote-label">Chain ${i + 1}</div>
          <div class="tel-vote-original">"${esc(c.prompt)}"</div>
          <div class="tel-vote-arrow">↓</div>
          <div class="tel-vote-final">${esc(c.finalLinkText || '[no response]')}</div>
          ${c.guess ? `<div class="tel-vote-guess">Guess: "${esc(c.guess)}"</div>` : ''}
        </div>`
      ).join('');
      showScreen('screen-tel-vote');
    });

    // ---- Set end ----
    socket.on('tel_set_end', ({ setNum, totalSets, chains, standings }) => {
      document.getElementById('tel-set-end-title').textContent =
        setNum < totalSets ? `Set ${setNum} of ${totalSets} Complete` : `Game Over`;
      document.getElementById('tel-set-results').innerHTML = chains.map((c, i) => {
        const cls = ['tel-set-result-card'];
        if (c.isShutout) cls.push('shutout');
        else if (c.isWinner) cls.push('winner');
        const ptsLabel = c.isWinner ? `+${c.isShutout ? 750 : 500} per member` : '0 pts';
        return `<div class="${cls.join(' ')}">
          <div class="tel-set-original">"${esc(c.prompt)}"</div>
          <div class="tel-set-final">${esc(c.finalLinkText || '[no response]')}</div>
          <div class="tel-set-meta">${c.votes} vote${c.votes !== 1 ? 's' : ''} · <span class="tel-set-pts">${ptsLabel}</span></div>
          <div class="tel-set-meta">${c.memberNames.map(n => esc(n)).join(', ')}</div>
        </div>`;
      }).join('');
      renderStandings(document.getElementById('tel-set-standings'), standings, { highlightTop3: true });
      showScreen('screen-tel-set-end');
    });

    socket.on('tel_game_end', ({ finalStandings }) => showFinal(finalStandings));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
