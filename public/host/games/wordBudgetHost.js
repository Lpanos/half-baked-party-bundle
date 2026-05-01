// Word Budget — host-side rendering. Reads wb_* events directly off the
// shared socket exposed by host.js (window.HBHost.socket). Exclusively owns
// screens prefixed `screen-wb-`.

(function () {
  function init() {
    const { socket, showFinal } = window.HBHost;
    const { showScreen, esc, formatTime, renderStandings } = window.HBC;

    socket.on('wb_round_start', ({ roundNum, setNum, wordLimit, timer }) => {
      document.getElementById('wb-write-round').textContent = `Set ${setNum} — Round ${roundNum} of 4`;
      document.getElementById('wb-word-limit').textContent = wordLimit;
      document.getElementById('wb-write-timer').textContent = formatTime(timer);
      document.getElementById('wb-write-status').textContent = 'Waiting for answers...';
      document.getElementById('wb-write-progress').style.width = '0%';
      showScreen('screen-wb-write');
    });

    socket.on('wb_submission_update', ({ submitted, total }) => {
      document.getElementById('wb-write-status').textContent = `${submitted}/${total} submitted`;
      document.getElementById('wb-write-progress').style.width = `${(submitted / total) * 100}%`;
    });

    socket.on('wb_matchup_show', ({ prompt, answers, timer, matchupIndex, totalMatchups }) => {
      document.getElementById('wb-matchup-counter').textContent = `Matchup ${matchupIndex + 1} of ${totalMatchups}`;
      document.getElementById('wb-vote-prompt').textContent = `"${prompt}"`;
      document.getElementById('wb-vote-timer').textContent = formatTime(timer);
      const labels = ['A', 'B', 'C'];
      document.getElementById('wb-answers').innerHTML = answers.map((a, i) =>
        `<div class="answer-card">
          <div class="answer-label">${labels[i]}</div>
          <div class="answer-text">${esc(a)}</div>
        </div>`
      ).join('');
      showScreen('screen-wb-vote');
    });

    socket.on('wb_matchup_result', ({ prompt, answers, playerNames, voteCounts, scores, isFinalRound }) => {
      document.getElementById('wb-result-prompt').textContent = `"${prompt}"`;
      const maxVotes = Math.max(...voteCounts);
      const winnerCount = voteCounts.filter(v => v === maxVotes).length;
      document.getElementById('wb-results').innerHTML = answers.map((a, i) => {
        const isWinner = voteCounts[i] === maxVotes && winnerCount === 1;
        const pts = scores[i] || 0;
        return `<div class="answer-card${isWinner ? ' winner-card' : ''}">
          <div class="answer-text">${esc(a)}</div>
          <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
          <div class="result-author">— ${esc(playerNames[i])} —</div>
          <div class="result-points">${pts > 0 ? '+' + pts : '0'} pts${isFinalRound ? ' (2x)' : ''}</div>
        </div>`;
      }).join('');
      showScreen('screen-wb-result');
    });

    socket.on('wb_round_end', ({ roundNum, standings }) => {
      document.getElementById('wb-round-end-title').textContent = `Round ${roundNum} Complete`;
      renderStandings(document.getElementById('wb-round-standings'), standings, { highlightTop3: true });
      showScreen('screen-wb-round-end');
    });

    socket.on('wb_set_end', ({ setNum, standings }) => {
      document.getElementById('wb-set-end-title').textContent = `Set ${setNum} Complete`;
      renderStandings(document.getElementById('wb-set-standings'), standings, { highlightTop3: true });
      showScreen('screen-wb-set-end');
    });

    socket.on('wb_game_end', ({ finalStandings }) => {
      showFinal(finalStandings);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
