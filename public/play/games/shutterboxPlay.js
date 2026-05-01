// Shutterbox — player-side rendering and input. Owns `screen-sb-*`.

(function () {
  function init() {
    const { socket, getMyId, showFinal } = window.HBPlay;
    const { showScreen, esc, formatTime } = window.HBC;

    let currentMatchupId = '';
    let myCurrentVote = null;

    // ---- File pickers (submission + final) ----
    function attachUploader({ areaId, inputId, previewId, submitBtnId, errorId, eventName }) {
      const area = document.getElementById(areaId);
      const input = document.getElementById(inputId);
      const preview = document.getElementById(previewId);
      const btn = document.getElementById(submitBtnId);
      const errEl = document.getElementById(errorId);
      if (!area || !input) return;

      let chosenDataUrl = null;
      area.addEventListener('click', () => {
        if (errEl) errEl.textContent = '';
        input.click();
      });
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { errEl.textContent = 'Pick an image file'; return; }
        if (f.size > 4.5 * 1024 * 1024) { errEl.textContent = 'Photo too big (max 4.5 MB)'; return; }
        const reader = new FileReader();
        reader.onload = (e) => {
          chosenDataUrl = e.target.result;
          preview.src = chosenDataUrl;
          preview.classList.remove('hidden');
          area.classList.add('hidden');
          btn.classList.remove('hidden');
        };
        reader.readAsDataURL(f);
      });
      btn.addEventListener('click', () => {
        if (!chosenDataUrl) return;
        btn.disabled = true;
        socket.emit(eventName, { imageData: chosenDataUrl });
      });
    }

    attachUploader({
      areaId: 'sb-upload-area',
      inputId: 'sb-file-input',
      previewId: 'sb-photo-preview',
      submitBtnId: 'sb-submit-photo',
      errorId: 'sb-submit-error',
      eventName: 'sb_submit_photo'
    });
    attachUploader({
      areaId: 'sb-final-upload-area',
      inputId: 'sb-final-file-input',
      previewId: 'sb-final-photo-preview',
      submitBtnId: 'sb-final-submit-photo',
      errorId: 'sb-final-submit-error',
      eventName: 'sb_submit_photo'
    });

    // ---- Round flow ----
    socket.on('sb_round_intro', ({ round, totalRounds }) => {
      document.getElementById('sb-intro-sub').textContent = `Round ${round} of ${totalRounds} — get ready...`;
      showScreen('screen-sb-intro');
    });

    socket.on('sb_prompt_assigned', ({ prompt }) => {
      document.getElementById('sb-submit-prompt').textContent = `"${prompt}"`;
      // Reset the upload UI between rounds.
      document.getElementById('sb-upload-area').classList.remove('hidden');
      document.getElementById('sb-photo-preview').classList.add('hidden');
      document.getElementById('sb-photo-preview').src = '';
      document.getElementById('sb-file-input').value = '';
      document.getElementById('sb-submit-photo').classList.add('hidden');
      document.getElementById('sb-submit-photo').disabled = false;
      document.getElementById('sb-submit-error').textContent = '';
      showScreen('screen-sb-submit');
    });

    socket.on('sb_sitting_out', () => showScreen('screen-sb-sitting-out'));

    socket.on('sb_photo_accepted', () => {
      // If we're in the final phase, stay; otherwise show the standard waiting screen.
      const finalActive = document.querySelector('#screen-sb-final-submit.active');
      if (finalActive) {
        showScreen('screen-sb-submitted');
      } else {
        showScreen('screen-sb-submitted');
      }
    });

    // Voting (head-to-head)
    socket.on('sb_vote_phase', ({ matchupId, prompt, player1, player2, canVote }) => {
      currentMatchupId = matchupId;
      myCurrentVote = null;

      if (!canVote) {
        showScreen('screen-sb-own-matchup');
        return;
      }
      document.getElementById('sb-vote-prompt').textContent = `"${prompt || ''}"`;
      document.getElementById('sb-vote-cards').innerHTML = [player1, player2].map(p => `
        <button class="sb-vote-card" data-player-id="${esc(p.id)}">
          ${p.image ? `<img src="${p.image}" alt="${esc(p.name)}">` : '<div class="sb-no-photo">No photo</div>'}
          <div class="sb-card-name">${esc(p.name)}</div>
        </button>
      `).join('');
      document.querySelectorAll('#sb-vote-cards .sb-vote-card').forEach(btn => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.playerId;
          myCurrentVote = pid;
          socket.emit('sb_cast_vote', { votedForId: pid });
          showScreen('screen-sb-voted');
        });
      });
      showScreen('screen-sb-vote');
    });

    socket.on('sb_vote_accepted', () => {});

    socket.on('sb_vote_result', ({ prompt, player1, player2 }) => {
      document.getElementById('sb-result-prompt').textContent = `"${prompt}"`;
      const winner = player1.pct >= player2.pct ? player1 : player2;
      const card = (p, isWinner) => `
        <div class="result-card${isWinner ? ' winner' : ''}">
          ${p.image ? `<img src="${p.image}" alt="${esc(p.name)}" style="max-width:100%;max-height:160px;border-radius:6px;">` : ''}
          <div class="result-author">— ${esc(p.name)} —</div>
          <div class="result-votes">${p.votes} vote${p.votes !== 1 ? 's' : ''} (${p.pct}%)</div>
          <div class="result-points">+${p.points} pts</div>
        </div>`;
      document.getElementById('sb-result-cards').innerHTML =
        card(player1, winner === player1) + card(player2, winner === player2);
      showScreen('screen-sb-result');
    });

    socket.on('sb_scoreboard', ({ scores, round, totalRounds }) => {
      document.getElementById('sb-scoreboard-title').textContent =
        round < totalRounds ? `After Round ${round}` : 'Final round next!';
      const myId = getMyId();
      const c = document.getElementById('sb-scoreboard-list');
      c.innerHTML = scores.map((p, i) =>
        `<div class="standing-row${p.name === scores[0]?.name && i === 0 ? ' top-three' : ''}${p.id === myId ? ' you' : ''}">
          <span class="standing-rank">${i + 1}</span>
          <span class="standing-name">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>
          <span class="standing-score">${(p.score || 0).toLocaleString()}</span>
        </div>`
      ).join('');
      showScreen('screen-sb-scoreboard');
    });

    socket.on('sb_final_round_start', ({ prompt }) => {
      document.getElementById('sb-final-prompt').textContent = `"${prompt}"`;
      document.getElementById('sb-final-upload-area').classList.remove('hidden');
      document.getElementById('sb-final-photo-preview').classList.add('hidden');
      document.getElementById('sb-final-photo-preview').src = '';
      document.getElementById('sb-final-file-input').value = '';
      document.getElementById('sb-final-submit-photo').classList.add('hidden');
      document.getElementById('sb-final-submit-photo').disabled = false;
      document.getElementById('sb-final-submit-error').textContent = '';
      showScreen('screen-sb-final-submit');
    });

    socket.on('sb_final_reveal', ({ prompt, photos }) => {
      document.getElementById('sb-final-vote-prompt').textContent = `"${prompt}"`;
      const myId = getMyId();
      const cards = photos.map(ph => `
        <button class="sb-vote-card" data-player-id="${esc(ph.playerId)}" ${ph.playerId === myId ? 'disabled' : ''}>
          ${ph.image ? `<img src="${ph.image}" alt="${esc(ph.playerName)}">` : '<div class="sb-no-photo">No photo</div>'}
          <div class="sb-card-name">${esc(ph.playerName)}${ph.playerId === myId ? ' (you)' : ''}</div>
        </button>`).join('');
      document.getElementById('sb-final-gallery').innerHTML = cards;
      document.querySelectorAll('#sb-final-gallery .sb-vote-card').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const pid = btn.dataset.playerId;
          socket.emit('sb_cast_vote', { votedForId: pid });
          showScreen('screen-sb-final-voted');
        });
      });
      showScreen('screen-sb-final-vote');
    });

    socket.on('sb_final_results', ({ rankings }) => {
      const myId = getMyId();
      document.getElementById('sb-final-rankings').innerHTML = rankings.map((r, i) => {
        const cls = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
        return `<div class="sb-final-rank ${cls}">
          ${r.image ? `<img src="${r.image}" alt="${esc(r.name)}">` : '<div></div>'}
          <div class="sb-final-info">
            <div class="name">#${i + 1} ${esc(r.name)}${r.playerId === myId ? ' (you)' : ''}</div>
            <div class="pts">+${r.points} pts (${r.votes} vote${r.votes !== 1 ? 's' : ''})</div>
          </div>
        </div>`;
      }).join('');
      showScreen('screen-sb-final-results');
    });

    socket.on('sb_game_end', (payload) => showFinal(payload));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
