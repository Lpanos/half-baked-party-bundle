// Frankenstein — host-side rendering. Owns `screen-fk-*`.

(function () {
  function init() {
    const { socket, showFinal } = window.HBHost;
    const { showScreen, esc, formatTime, renderStandings } = window.HBC;

    socket.on('fk_round_start', ({ roundNum, totalRounds, prompt, wordLimit, timer }) => {
      document.getElementById('fk-write-round').textContent = `Round ${roundNum} of ${totalRounds}`;
      document.getElementById('fk-write-prompt').textContent = `"${prompt}"`;
      document.getElementById('fk-write-word-limit').textContent = wordLimit;
      document.getElementById('fk-write-timer').textContent = formatTime(timer);
      document.getElementById('fk-write-status').textContent = 'Waiting for answers...';
      document.getElementById('fk-write-progress').style.width = '0%';
      showScreen('screen-fk-write');
    });

    socket.on('fk_submission_update', ({ submitted, total }) => {
      document.getElementById('fk-write-status').textContent = `${submitted}/${total} submitted`;
      document.getElementById('fk-write-progress').style.width = `${(submitted / total) * 100}%`;
    });

    socket.on('fk_stitch_phase_start', ({ timer, totalPlayers }) => {
      document.getElementById('fk-stitch-round').textContent =
        document.getElementById('fk-write-round').textContent;
      document.getElementById('fk-stitch-timer').textContent = formatTime(timer);
      document.getElementById('fk-stitch-status').textContent = `0/${totalPlayers} stitched`;
      document.getElementById('fk-stitch-progress').style.width = '0%';
      showScreen('screen-fk-stitch');
    });

    socket.on('fk_stitch_update', ({ submitted, total }) => {
      document.getElementById('fk-stitch-status').textContent = `${submitted}/${total} stitched`;
      document.getElementById('fk-stitch-progress').style.width = `${(submitted / total) * 100}%`;
    });

    socket.on('fk_matchup_show', ({ prompt, answers, timer, matchupIndex, totalMatchups }) => {
      document.getElementById('fk-matchup-counter').textContent = `Matchup ${matchupIndex + 1} of ${totalMatchups}`;
      document.getElementById('fk-vote-prompt').textContent = `"${prompt}"`;
      document.getElementById('fk-vote-timer').textContent = formatTime(timer);
      const labels = ['A', 'B', 'C'];
      document.getElementById('fk-answers').innerHTML = answers.map((a, i) =>
        `<div class="answer-card">
          <div class="answer-label">${labels[i]}</div>
          <div class="answer-text">${esc(a)}</div>
        </div>`
      ).join('');
      showScreen('screen-fk-vote');
    });

    socket.on('fk_matchup_result', ({ prompt, answers, playerNames, voteCounts, scores }) => {
      document.getElementById('fk-result-prompt').textContent = `"${prompt}"`;
      const maxVotes = Math.max(...voteCounts);
      const winnerCount = voteCounts.filter(v => v === maxVotes).length;
      document.getElementById('fk-results').innerHTML = answers.map((a, i) => {
        const isWinner = voteCounts[i] === maxVotes && winnerCount === 1;
        const pts = scores[i] || 0;
        return `<div class="answer-card${isWinner ? ' winner-card' : ''}">
          <div class="answer-text">${esc(a)}</div>
          <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
          <div class="result-author">— ${esc(playerNames[i])} —</div>
          <div class="result-points">${pts > 0 ? '+' + pts : '0'} pts</div>
        </div>`;
      }).join('');
      showScreen('screen-fk-result');
    });

    socket.on('fk_round_end', ({ roundNum, totalRounds, standings }) => {
      document.getElementById('fk-round-end-title').textContent = `Round ${roundNum} of ${totalRounds} Complete`;
      renderStandings(document.getElementById('fk-round-standings'), standings, { highlightTop3: true });
      showScreen('screen-fk-round-end');
    });

    socket.on('fk_game_end', ({ finalStandings }) => {
      showFinal(finalStandings);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
