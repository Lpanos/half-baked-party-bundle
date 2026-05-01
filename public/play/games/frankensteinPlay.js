// Frankenstein — player-side rendering and input. Owns `screen-fk-*`.
// Hybrid chip UX: tap pool → append; tap assembly chip → remove; long-press
// drag (SortableJS) inside assembly → reorder.

(function () {
  function init() {
    const { socket, getMyId, showFinal } = window.HBPlay;
    const { showScreen, esc, formatTime, countWords, renderStandings } = window.HBC;

    let currentMatchupId = '';
    let currentWordLimit = 20;
    let stitchPool = [];
    let stitchAssembly = [];
    let sortable = null;

    socket.on('fk_round_start', ({ roundNum, totalRounds, wordLimit, prompt }) => {
      currentWordLimit = wordLimit;
      document.getElementById('fk-round-info').textContent = `Round ${roundNum}/${totalRounds}`;
      document.getElementById('fk-word-limit-label').textContent = `${wordLimit} WORDS`;
      document.getElementById('fk-write-prompt').textContent = `"${prompt}"`;
      document.getElementById('fk-word-max').textContent = wordLimit;
      document.getElementById('fk-word-count').textContent = '0';
      const ta = document.getElementById('fk-input-answer');
      ta.value = '';
      ta.disabled = false;
      document.getElementById('fk-btn-submit').disabled = false;
      document.getElementById('fk-write-error').textContent = '';
      document.querySelector('#screen-fk-write .word-count').classList.remove('over');
      showScreen('screen-fk-write');
    });

    const ta = document.getElementById('fk-input-answer');
    ta.addEventListener('input', () => {
      const count = countWords(ta.value);
      document.getElementById('fk-word-count').textContent = count;
      const over = count > currentWordLimit;
      document.querySelector('#screen-fk-write .word-count').classList.toggle('over', over);
      document.getElementById('fk-btn-submit').disabled = over || count === 0;
    });

    document.getElementById('fk-btn-submit').addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { document.getElementById('fk-write-error').textContent = 'Write something!'; return; }
      if (countWords(text) > currentWordLimit) return;
      document.getElementById('fk-btn-submit').disabled = true;
      ta.disabled = true;
      socket.emit('fk_submit_answer', { text });
    });

    socket.on('fk_answer_accepted', () => showScreen('screen-fk-submitted'));

    // --- STITCH ---
    socket.on('fk_stitch_phase_start', ({ prompt, fragments }) => {
      stitchPool = fragments || [];
      stitchAssembly = [];
      document.getElementById('fk-stitch-prompt').textContent = `"${prompt}"`;
      document.getElementById('fk-stitch-error').textContent = '';
      document.getElementById('fk-btn-stitch-submit').disabled = true;
      renderStitching();
      initSortable();
      showScreen('screen-fk-stitch');
    });

    function renderStitching() {
      const usedIds = new Set(stitchAssembly);
      const poolEl = document.getElementById('fk-fragment-pool');
      poolEl.innerHTML = stitchPool.map(f =>
        `<button class="fragment-chip${usedIds.has(f.id) ? ' used' : ''}" data-fid="${esc(f.id)}">${esc(f.text)}</button>`
      ).join('');
      poolEl.querySelectorAll('.fragment-chip:not(.used)').forEach(btn => {
        btn.addEventListener('click', () => {
          stitchAssembly.push(btn.dataset.fid);
          renderStitching();
        });
      });

      const asmEl = document.getElementById('fk-assembly-row');
      if (stitchAssembly.length === 0) {
        asmEl.innerHTML = '<p class="assembly-placeholder">Tap chips below to stitch your answer</p>';
      } else {
        const map = new Map(stitchPool.map(f => [f.id, f.text]));
        asmEl.innerHTML = stitchAssembly.map(fid =>
          `<button class="fragment-chip in-assembly" data-fid="${esc(fid)}">${esc(map.get(fid) || '?')}</button>`
        ).join('');
        asmEl.querySelectorAll('.fragment-chip').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = stitchAssembly.indexOf(btn.dataset.fid);
            if (idx !== -1) {
              stitchAssembly.splice(idx, 1);
              renderStitching();
            }
          });
        });
      }

      const empty = stitchAssembly.length === 0;
      document.getElementById('fk-btn-stitch-submit').disabled = empty;
      document.getElementById('fk-btn-clear').disabled = empty;
      document.getElementById('fk-btn-undo').disabled = empty;
      document.getElementById('fk-stitch-fragment-count').textContent =
        empty ? '' : `${stitchAssembly.length} chip${stitchAssembly.length === 1 ? '' : 's'}`;
    }

    function initSortable() {
      if (sortable) { sortable.destroy(); sortable = null; }
      if (typeof Sortable === 'undefined') return;
      sortable = Sortable.create(document.getElementById('fk-assembly-row'), {
        animation: 150,
        delay: 150,
        delayOnTouchOnly: true,
        filter: '.assembly-placeholder',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex || evt.oldIndex == null || evt.newIndex == null) return;
          const [moved] = stitchAssembly.splice(evt.oldIndex, 1);
          stitchAssembly.splice(evt.newIndex, 0, moved);
          document.getElementById('fk-stitch-fragment-count').textContent =
            stitchAssembly.length === 0 ? '' : `${stitchAssembly.length} chip${stitchAssembly.length === 1 ? '' : 's'}`;
        }
      });
    }

    document.getElementById('fk-btn-clear').addEventListener('click', () => {
      if (stitchAssembly.length === 0) return;
      stitchAssembly = [];
      renderStitching();
    });
    document.getElementById('fk-btn-undo').addEventListener('click', () => {
      if (stitchAssembly.length === 0) return;
      stitchAssembly.pop();
      renderStitching();
    });
    document.getElementById('fk-btn-stitch-submit').addEventListener('click', () => {
      if (stitchAssembly.length === 0) return;
      document.getElementById('fk-btn-stitch-submit').disabled = true;
      document.getElementById('fk-stitch-error').textContent = '';
      socket.emit('fk_submit_stitched', { fragmentIds: [...stitchAssembly] });
    });

    socket.on('fk_stitched_accepted', () => showScreen('screen-fk-stitched'));

    // --- VOTING ---
    socket.on('fk_matchup_show', ({ matchupId, prompt, answers, canVote }) => {
      currentMatchupId = matchupId;
      if (!canVote) {
        showScreen('screen-fk-own-matchup');
        return;
      }
      document.getElementById('fk-vote-prompt').textContent = `"${prompt}"`;
      const labels = ['A', 'B', 'C'];
      const container = document.getElementById('fk-vote-options');
      container.innerHTML = answers.map((a, i) =>
        `<button class="vote-btn" data-choice="${i}">
          <div class="vote-label">${labels[i]}</div>
          ${esc(a)}
        </button>`
      ).join('');
      container.querySelectorAll('.vote-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const choice = parseInt(btn.dataset.choice, 10);
          socket.emit('fk_submit_vote', { matchupId: currentMatchupId, choice });
          showScreen('screen-fk-voted');
        });
      });
      showScreen('screen-fk-vote');
    });

    socket.on('fk_vote_accepted', () => {});

    socket.on('fk_matchup_result', ({ prompt, answers, playerNames, voteCounts, scores }) => {
      document.getElementById('fk-result-prompt').textContent = `"${prompt}"`;
      const maxVotes = Math.max(...voteCounts);
      const winnerCount = voteCounts.filter(v => v === maxVotes).length;
      document.getElementById('fk-result-cards').innerHTML = answers.map((a, i) => {
        const isWinner = voteCounts[i] === maxVotes && winnerCount === 1;
        const pts = scores[i] || 0;
        return `<div class="result-card${isWinner ? ' winner' : ''}">
          <div class="result-answer">${esc(a)}</div>
          <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
          <div class="result-author">— ${esc(playerNames[i])} —</div>
          <div class="result-points">${pts > 0 ? '+' + pts : '0'} pts</div>
        </div>`;
      }).join('');
      showScreen('screen-fk-result');
    });

    socket.on('fk_round_end', ({ roundNum, totalRounds, standings, yourScore }) => {
      document.getElementById('round-end-title').textContent = `Round ${roundNum}/${totalRounds} Complete`;
      document.getElementById('round-end-your-score').textContent =
        typeof yourScore === 'number' ? `Your score: ${yourScore.toLocaleString()}` : '';
      renderStandings(document.getElementById('round-end-standings'), standings, { myId: getMyId() });
      showScreen('screen-round-end');
    });

    socket.on('fk_game_end', (payload) => showFinal(payload));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
