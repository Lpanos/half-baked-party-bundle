// Telephone — player-side rendering. Owns `screen-tel-*`. Players are
// active every write round; no waiting screens during writing. After each
// submission they wait briefly for the round to advance.

(function () {
  function init() {
    const { socket, getMyId, showFinal } = window.HBPlay;
    const { showScreen, esc, formatTime, countWords, renderStandings } = window.HBC;

    let currentWordLimit = 12;

    socket.on('tel_assign', ({ setNum, totalSets, totalRounds }) => {
      // Phone payload is the small variant.
      if (totalRounds === undefined) return;
      document.getElementById('tel-assign-sub').textContent =
        `Set ${setNum} of ${totalSets} — ${totalRounds} rounds incoming...`;
      document.getElementById('tel-assign-position').textContent = '';
      showScreen('screen-tel-assign');
    });

    // ---- Active round (rewrite OR guess; same screen, different label) ----
    socket.on('tel_round_start', ({ roundNum, totalRounds, isGuess, isFirstRound, previousText, wordLimit, timer }) => {
      currentWordLimit = wordLimit;
      const screen = isGuess ? 'screen-tel-guess' : 'screen-tel-write';

      if (isGuess) {
        document.getElementById('tel-guess-final-text').textContent = previousText || '[no response]';
        document.getElementById('tel-guess-word-limit-label').textContent = `${wordLimit} WORDS`;
        document.getElementById('tel-guess-word-max').textContent = wordLimit;
        document.getElementById('tel-guess-word-count').textContent = '0';
        const gta = document.getElementById('tel-guess-answer');
        gta.value = '';
        gta.disabled = false;
        document.getElementById('tel-btn-guess-submit').disabled = false;
        document.getElementById('tel-guess-error').textContent = '';
        document.querySelector('#screen-tel-guess .word-count').classList.remove('over');
        document.getElementById('tel-guess-timer').textContent = formatTime(timer);
      } else {
        document.getElementById('tel-write-link-info').textContent = `Round ${roundNum} of ${totalRounds}`;
        document.getElementById('tel-write-word-limit-label').textContent = `${wordLimit} WORDS`;
        document.getElementById('tel-write-prompt-label').textContent =
          isFirstRound ? 'Original prompt — describe it:' : 'Previous link wrote:';
        document.getElementById('tel-prev-text').textContent = previousText;
        document.getElementById('tel-word-max').textContent = wordLimit;
        document.getElementById('tel-word-count').textContent = '0';
        const ta = document.getElementById('tel-input-answer');
        ta.value = '';
        ta.disabled = false;
        document.getElementById('tel-btn-submit').disabled = false;
        document.getElementById('tel-write-error').textContent = '';
        document.querySelector('#screen-tel-write .word-count').classList.remove('over');
        document.getElementById('tel-write-timer').textContent = formatTime(timer);
      }
      showScreen(screen);
    });

    const ta = document.getElementById('tel-input-answer');
    ta.addEventListener('input', () => {
      const count = countWords(ta.value);
      document.getElementById('tel-word-count').textContent = count;
      const over = count > currentWordLimit;
      document.querySelector('#screen-tel-write .word-count').classList.toggle('over', over);
      document.getElementById('tel-btn-submit').disabled = over || count === 0;
    });

    document.getElementById('tel-btn-submit').addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { document.getElementById('tel-write-error').textContent = 'Write something!'; return; }
      if (countWords(text) > currentWordLimit) return;
      document.getElementById('tel-btn-submit').disabled = true;
      ta.disabled = true;
      socket.emit('tel_submit_link', { text });
    });

    const gta = document.getElementById('tel-guess-answer');
    gta.addEventListener('input', () => {
      const count = countWords(gta.value);
      document.getElementById('tel-guess-word-count').textContent = count;
      const over = count > currentWordLimit;
      document.querySelector('#screen-tel-guess .word-count').classList.toggle('over', over);
      document.getElementById('tel-btn-guess-submit').disabled = over || count === 0;
    });

    document.getElementById('tel-btn-guess-submit').addEventListener('click', () => {
      const text = gta.value.trim();
      if (!text) { document.getElementById('tel-guess-error').textContent = 'Take a guess!'; return; }
      if (countWords(text) > currentWordLimit) return;
      document.getElementById('tel-btn-guess-submit').disabled = true;
      gta.disabled = true;
      // Reuse the same submit event — server treats the last round as a guess.
      socket.emit('tel_submit_link', { text });
    });

    socket.on('tel_link_accepted', () => {
      document.getElementById('tel-waiting-msg').textContent = 'Submitted! Waiting for the rest of the room...';
      document.getElementById('tel-waiting-position').textContent = '';
      showScreen('screen-tel-waiting');
    });

    // ---- Reveal: phones show "watch the host" ----
    socket.on('tel_reveal_begin', () => {
      document.getElementById('tel-watching-current').textContent = '';
      showScreen('screen-tel-watching');
    });
    socket.on('tel_reveal_chain', ({ chainIndex, totalChains }) => {
      document.getElementById('tel-watching-current').textContent =
        `Chain ${chainIndex + 1} of ${totalChains}`;
      showScreen('screen-tel-watching');
    });

    // ---- VOTE ----
    socket.on('tel_vote_phase', ({ chains, timer }) => {
      document.getElementById('tel-vote-timer').textContent = formatTime(timer);
      const container = document.getElementById('tel-vote-options');
      container.innerHTML = chains.map((c, i) =>
        `<button class="tel-vote-option" data-chain-id="${esc(c.id)}">
          <div class="tel-vote-original">"${esc(c.prompt)}"</div>
          <div class="tel-vote-arrow">↓ became ↓</div>
          <div class="tel-vote-final">${esc(c.finalLinkText || '[no response]')}</div>
        </button>`
      ).join('');
      container.querySelectorAll('.tel-vote-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.dataset.chainId;
          socket.emit('tel_submit_vote', { chainId: cid });
          showScreen('screen-tel-voted');
        });
      });
      showScreen('screen-tel-vote');
    });

    socket.on('tel_vote_accepted', () => {});

    socket.on('tel_set_end', ({ setNum, totalSets, standings, yourScore }) => {
      document.getElementById('tel-set-end-title').textContent =
        setNum < totalSets ? `Set ${setNum} of ${totalSets} Complete` : `Game Over!`;
      document.getElementById('tel-set-end-your-score').textContent =
        typeof yourScore === 'number' ? `Your score: ${yourScore.toLocaleString()}` : '';
      renderStandings(document.getElementById('tel-set-end-standings'), standings, { myId: getMyId() });
      showScreen('screen-tel-set-end');
    });

    socket.on('tel_game_end', (payload) => showFinal(payload));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
