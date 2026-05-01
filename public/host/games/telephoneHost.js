// Telephone — host-side rendering. Simultaneous-rotation model: one big
// progress bar / submission counter for the whole room (everyone is active
// at once). Reveal animates one chain at a time with a 2-second per-card
// stagger; server schedules the next chain.

(function () {
  function init() {
    const { socket, showFinal } = window.HBHost;
    const { showScreen, esc, formatTime, renderStandings } = window.HBC;

    // ---- ASSIGN ----
    socket.on('tel_assign', (payload) => {
      // Host gets `players` and `chainCount`; phones get a smaller payload.
      if (!payload.players) return;
      document.getElementById('tel-assign-set').textContent =
        `Set ${payload.setNum} of ${payload.totalSets}`;
      const summary = document.getElementById('tel-assign-summary');
      summary.innerHTML =
        `<div class="tel-assign-chain">
          <strong>${payload.chainCount} chains, ${payload.totalRounds} rounds</strong>
          ${payload.players.map(p => esc(p.name)).join(' · ')}
        </div>`;
      showScreen('screen-tel-assign');
    });

    // ---- WRITE round ----
    socket.on('tel_round_start', ({ roundNum, totalRounds, isGuess, wordLimit, timer, totalPlayers }) => {
      // Reuse the chain-progress screen as a single big "round in progress" view.
      const container = document.getElementById('tel-chain-bars');
      const label = isGuess
        ? `Round ${roundNum} of ${totalRounds} — GUESS`
        : `Round ${roundNum} of ${totalRounds} — REWRITE in ${wordLimit} words`;
      container.innerHTML = `
        <div class="tel-round-card">
          <div class="tel-round-label">${esc(label)}</div>
          <div class="timer" id="tel-round-timer">${esc(formatTime(timer))}</div>
          <div class="tel-submission-line">
            <span id="tel-submission-status">0 / ${totalPlayers} submitted</span>
            <div class="progress-bar"><div class="progress-fill" id="tel-submission-progress" style="width:0%"></div></div>
          </div>
        </div>
      `;
      showScreen('screen-tel-progress');
    });

    socket.on('tel_submission_update', ({ submitted, total }) => {
      const status = document.getElementById('tel-submission-status');
      const fill = document.getElementById('tel-submission-progress');
      if (status) status.textContent = `${submitted} / ${total} submitted`;
      if (fill) fill.style.width = `${total > 0 ? (submitted / total) * 100 : 0}%`;
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

    socket.on('tel_reveal_chain', ({ chainIndex, totalChains, metaPrompt, originalResponse, links, guess }) => {
      clearRevealTimers();
      document.getElementById('tel-reveal-counter').textContent =
        `Chain ${chainIndex + 1} of ${totalChains}`;
      const stack = document.getElementById('tel-reveal-stack');

      // The meta-prompt is small context, not a chain link. Render it as a
      // header strip above the chain. Then the chain starts with the
      // originator's 12-word response (links[0]).
      const cards = [];
      cards.push(buildMetaHeader(metaPrompt));
      links.forEach((l, i) => {
        if (i > 0) cards.push(buildArrow());
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
        // Comparison: show the originator's response again next to the guess.
        cards.push(buildCard({
          kind: 'original-was',
          author: 'Original was',
          text: originalResponse || (links[0] && links[0].text) || '[no response]'
        }));
      }
      stack.innerHTML = cards.join('');

      // Stagger each card by 1500ms (visual). Server's next-chain timeout is
      // independent and uses the constant in shared/constants.js.
      const items = stack.children;
      for (let i = 0; i < items.length; i++) {
        const t = setTimeout(() => {
          items[i].classList.add('shown');
          if (items[i].scrollIntoView) {
            try { items[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
          }
        }, i * 1500);
        revealTimers.push(t);
      }
    });

    function buildCard({ kind, author, text }) {
      let cls = '';
      if (kind === 'guess') cls = 'guess';
      else if (kind === 'original-was') cls = 'original';
      return `<div class="tel-reveal-card ${cls}">
        <div class="tel-reveal-author">${esc(author)}</div>
        <div class="tel-reveal-text">${esc(text)}</div>
      </div>`;
    }
    function buildArrow() { return `<div class="tel-reveal-arrow shown">↓</div>`; }
    function buildMetaHeader(text) {
      return `<div class="tel-reveal-meta">Prompt: <em>"${esc(text)}"</em></div>`;
    }

    // ---- Voting ----
    socket.on('tel_vote_phase', ({ chains, timer }) => {
      document.getElementById('tel-vote-timer').textContent = formatTime(timer);
      document.getElementById('tel-vote-summary').innerHTML = chains.map((c, i) =>
        `<div class="tel-vote-chain-card">
          <div class="tel-vote-label">Chain ${i + 1}</div>
          <div class="tel-vote-meta">Prompt: <em>"${esc(c.metaPrompt)}"</em></div>
          <div class="tel-vote-original">"${esc(c.originalResponse || '[no response]')}"</div>
          <div class="tel-vote-arrow">↓ became ↓</div>
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
          <div class="tel-set-meta-prompt">Prompt: <em>"${esc(c.metaPrompt)}"</em></div>
          <div class="tel-set-original">"${esc(c.originalResponse || '[no response]')}"</div>
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
