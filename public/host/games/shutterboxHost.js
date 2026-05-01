// Shutterbox — host-side rendering. Owns `screen-sb-*` screens.
// FLASH dialog is rendered as styled text only (no TTS in this version).

(function () {
  function init() {
    const { socket, showFinal } = window.HBHost;
    const { showScreen, esc, formatTime, renderStandings } = window.HBC;

    let lastResultPayload = null;

    function setDialog(id, line) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = line || '';
      el.style.display = line ? 'block' : 'none';
    }

    socket.on('sb_round_intro', ({ round, totalRounds, isFirst, hostLine }) => {
      document.getElementById('sb-intro-round').textContent = `Round ${round} of ${totalRounds}`;
      document.getElementById('sb-intro-title').textContent = isFirst ? 'SHUTTERBOX' : `Round ${round}`;
      document.getElementById('sb-intro-sub').textContent = isFirst ? 'a photo party game' : 'get your photos ready';
      setDialog('sb-intro-dialog', hostLine);
      showScreen('screen-sb-round-intro');
    });

    socket.on('sb_submission_phase', ({ round, timeLimit, playerCount, matchupCount }) => {
      document.getElementById('sb-submit-round').textContent = `Round ${round}`;
      document.getElementById('sb-submit-timer').textContent = formatTime(timeLimit);
      document.getElementById('sb-submit-status').textContent = `0/${matchupCount * 2} submitted`;
      document.getElementById('sb-submit-progress').style.width = '0%';
      showScreen('screen-sb-submit');
    });

    socket.on('sb_submission_update', ({ submitted, total }) => {
      const status = document.getElementById('sb-submit-status');
      const finalStatus = document.getElementById('sb-final-submit-status');
      const target = (document.querySelector('#screen-sb-final-submit')?.classList.contains('active')) ? finalStatus : status;
      if (target) target.textContent = `${submitted}/${total} submitted`;
      const progressEl = (document.querySelector('#screen-sb-final-submit')?.classList.contains('active'))
        ? null
        : document.getElementById('sb-submit-progress');
      if (progressEl) progressEl.style.width = `${(submitted / total) * 100}%`;
    });

    socket.on('sb_matchup_reveal', ({ prompt, player1, player2, matchupNumber, totalMatchups, hostLine }) => {
      document.getElementById('sb-matchup-counter').textContent = `Matchup ${matchupNumber} of ${totalMatchups}`;
      document.getElementById('sb-matchup-prompt').textContent = `"${prompt}"`;
      document.getElementById('sb-matchup-left').innerHTML = renderSide(player1);
      document.getElementById('sb-matchup-right').innerHTML = renderSide(player2);
      setDialog('sb-matchup-dialog', hostLine);
      showScreen('screen-sb-matchup');
    });

    socket.on('sb_vote_phase', ({ timeLimit }) => {
      document.getElementById('sb-vote-timer').textContent = formatTime(timeLimit);
    });

    socket.on('sb_vote_result', (payload) => {
      lastResultPayload = payload;
      const { prompt, player1, player2, isShutout, hostLine } = payload;
      document.getElementById('sb-result-prompt').textContent = `"${prompt}"`;

      const winner = player1.pct >= player2.pct ? 1 : 2;
      const loser  = winner === 1 ? 2 : 1;
      const leftCls  = winner === 1 ? 'winner' : (isShutout ? 'shutout-loser' : '');
      const rightCls = winner === 2 ? 'winner' : (isShutout ? 'shutout-loser' : '');

      const leftEl  = document.getElementById('sb-result-left');
      const rightEl = document.getElementById('sb-result-right');
      leftEl.innerHTML  = renderSide(player1, `+${player1.points} pts`);
      rightEl.innerHTML = renderSide(player2, `+${player2.points} pts`);
      leftEl.className  = 'sb-matchup-side ' + leftCls;
      rightEl.className = 'sb-matchup-side ' + rightCls;

      document.getElementById('sb-bar-left').style.width  = `${player1.pct}%`;
      document.getElementById('sb-bar-left').textContent  = `${player1.pct}%`;
      document.getElementById('sb-bar-right').style.width = `${player2.pct}%`;
      document.getElementById('sb-bar-right').textContent = `${player2.pct}%`;

      document.getElementById('sb-shutout-badge').classList.toggle('hidden', !isShutout);
      setDialog('sb-result-dialog', hostLine);
      showScreen('screen-sb-result');
    });

    socket.on('sb_scoreboard', ({ scores, round, totalRounds }) => {
      document.getElementById('sb-scoreboard-title').textContent =
        round < totalRounds ? `After Round ${round}` : `Final round next!`;
      renderStandings(document.getElementById('sb-scoreboard-list'), scores, { highlightTop3: true });
      showScreen('screen-sb-scoreboard');
    });

    socket.on('sb_final_round_start', ({ prompt, timeLimit, hostLine }) => {
      document.getElementById('sb-final-prompt').textContent = `"${prompt}"`;
      document.getElementById('sb-final-submit-timer').textContent = formatTime(timeLimit);
      document.getElementById('sb-final-submit-status').textContent = `0/0 submitted`;
      setDialog('sb-final-intro-dialog', hostLine);
      showScreen('screen-sb-final-submit');
    });

    socket.on('sb_final_reveal', ({ prompt, photos, timeLimit }) => {
      document.getElementById('sb-final-vote-prompt').textContent = `"${prompt}"`;
      document.getElementById('sb-final-vote-timer').textContent = formatTime(timeLimit);
      document.getElementById('sb-final-gallery').innerHTML = photos.map(ph =>
        `<div class="sb-gallery-item">
          ${ph.image ? `<img src="${ph.image}" alt="${esc(ph.playerName)}">` : '<div class="sb-no-photo">No photo</div>'}
          <div class="sb-author">${esc(ph.playerName)}</div>
        </div>`
      ).join('');
      showScreen('screen-sb-final-vote');
    });

    socket.on('sb_final_results', ({ rankings, hostLine }) => {
      document.getElementById('sb-final-rankings').innerHTML = rankings.map((r, i) => {
        const rankCls = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
        return `<div class="sb-gallery-item ${rankCls}">
          ${r.image ? `<img src="${r.image}" alt="${esc(r.name)}">` : '<div class="sb-no-photo">No photo</div>'}
          <div class="sb-rank">#${i + 1} — ${esc(r.name)}</div>
          <div class="sb-author">${r.votes} vote${r.votes !== 1 ? 's' : ''}</div>
          <div class="sb-points">+${r.points} pts</div>
        </div>`;
      }).join('');
      setDialog('sb-final-results-dialog', hostLine);
      showScreen('screen-sb-final-results');
    });

    socket.on('sb_game_end', ({ finalStandings }) => {
      showFinal(finalStandings);
    });

    function renderSide(player, ptsLabel) {
      const img = player.image
        ? `<img src="${player.image}" alt="${esc(player.name)}">`
        : '<div class="sb-no-photo">No photo</div>';
      const pts = ptsLabel ? `<div class="result-points">${esc(ptsLabel)}</div>` : '';
      return `${img}<div class="sb-player-name">${esc(player.name)}</div>${pts}`;
    }

    // Host-paced advance buttons.
    document.getElementById('sb-result-next').addEventListener('click', () => socket.emit('sb_host_next'));
    document.getElementById('sb-scoreboard-next').addEventListener('click', () => socket.emit('sb_host_next'));
    document.getElementById('sb-final-results-next').addEventListener('click', () => socket.emit('sb_host_next'));

    // SPACE / Enter on host = next.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== 'Enter') return;
      const active = document.querySelector('.screen.active');
      if (!active) return;
      if (active.id === 'screen-sb-result' || active.id === 'screen-sb-scoreboard' || active.id === 'screen-sb-final-results') {
        e.preventDefault();
        socket.emit('sb_host_next');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
