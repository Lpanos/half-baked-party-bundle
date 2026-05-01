// Word Budget — player-side rendering and input. Owns `screen-wb-*`.

(function () {
  function init() {
    const { socket, getMyId, showFinal } = window.HBPlay;
    const { showScreen, esc, formatTime, countWords, renderStandings } = window.HBC;

    let currentMatchupId = '';
    let currentWordLimit = 15;

    socket.on('wb_round_start', ({ roundNum, setNum, wordLimit, prompt, timer }) => {
      currentWordLimit = wordLimit;
      document.getElementById('wb-round-info').textContent = `Set ${setNum} — Round ${roundNum}/4`;
      document.getElementById('wb-word-limit-label').textContent = `${wordLimit} WORDS`;
      document.getElementById('wb-write-prompt').textContent = `"${prompt}"`;
      document.getElementById('wb-word-max').textContent = wordLimit;
      document.getElementById('wb-word-count').textContent = '0';
      const ta = document.getElementById('wb-input-answer');
      ta.value = '';
      ta.disabled = false;
      document.getElementById('wb-btn-submit').disabled = false;
      document.getElementById('wb-write-error').textContent = '';
      document.querySelector('#screen-wb-write .word-count').classList.remove('over');
      showScreen('screen-wb-write');
    });

    const ta = document.getElementById('wb-input-answer');
    ta.addEventListener('input', () => {
      const count = countWords(ta.value);
      document.getElementById('wb-word-count').textContent = count;
      const over = count > currentWordLimit;
      document.querySelector('#screen-wb-write .word-count').classList.toggle('over', over);
      document.getElementById('wb-btn-submit').disabled = over || count === 0;
    });

    document.getElementById('wb-btn-submit').addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { document.getElementById('wb-write-error').textContent = 'Write something!'; return; }
      if (countWords(text) > currentWordLimit) return;
      document.getElementById('wb-btn-submit').disabled = true;
      ta.disabled = true;
      socket.emit('wb_submit_answer', { text });
    });

    socket.on('wb_answer_accepted', () => showScreen('screen-wb-submitted'));

    socket.on('wb_matchup_show', ({ matchupId, prompt, answers, canVote }) => {
      currentMatchupId = matchupId;
      if (!canVote) {
        showScreen('screen-wb-own-matchup');
        return;
      }
      document.getElementById('wb-vote-prompt').textContent = `"${prompt}"`;
      const labels = ['A', 'B', 'C'];
      const container = document.getElementById('wb-vote-options');
      container.innerHTML = answers.map((a, i) =>
        `<button class="vote-btn" data-choice="${i}">
          <div class="vote-label">${labels[i]}</div>
          ${esc(a)}
        </button>`
      ).join('');
      container.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const choice = parseInt(btn.dataset.choice, 10);
          socket.emit('wb_submit_vote', { matchupId: currentMatchupId, choice });
          showScreen('screen-wb-voted');
        });
      });
      showScreen('screen-wb-vote');
    });

    socket.on('wb_vote_accepted', () => {});

    socket.on('wb_matchup_result', ({ prompt, answers, playerNames, voteCounts, scores, isFinalRound }) => {
      document.getElementById('wb-result-prompt').textContent = `"${prompt}"`;
      const maxVotes = Math.max(...voteCounts);
      const winnerCount = voteCounts.filter(v => v === maxVotes).length;
      document.getElementById('wb-result-cards').innerHTML = answers.map((a, i) => {
        const isWinner = voteCounts[i] === maxVotes && winnerCount === 1;
        const pts = scores[i] || 0;
        return `<div class="result-card${isWinner ? ' winner' : ''}">
          <div class="result-answer">${esc(a)}</div>
          <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
          <div class="result-author">— ${esc(playerNames[i])} —</div>
          <div class="result-points">${pts > 0 ? '+' + pts : '0'} pts${isFinalRound ? ' (2x)' : ''}</div>
        </div>`;
      }).join('');
      showScreen('screen-wb-result');
    });

    socket.on('wb_round_end', ({ roundNum, setNum, standings, yourScore }) => {
      document.getElementById('round-end-title').textContent = `Set ${setNum} — Round ${roundNum} Complete`;
      document.getElementById('round-end-your-score').textContent =
        typeof yourScore === 'number' ? `Your score: ${yourScore.toLocaleString()}` : '';
      renderStandings(document.getElementById('round-end-standings'), standings, { myId: getMyId() });
      showScreen('screen-round-end');
    });

    socket.on('wb_set_end', ({ setNum, standings, yourScore }) => {
      document.getElementById('round-end-title').textContent = `Set ${setNum} Complete`;
      document.getElementById('round-end-your-score').textContent =
        typeof yourScore === 'number' ? `Your score: ${yourScore.toLocaleString()}` : '';
      renderStandings(document.getElementById('round-end-standings'), standings, { myId: getMyId() });
      showScreen('screen-round-end');
    });

    socket.on('wb_game_end', (payload) => showFinal(payload));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
