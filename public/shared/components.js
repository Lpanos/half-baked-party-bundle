// Shared client utilities. Loads first; sets window.HBC ("HB Components").

(function () {
  function esc(str) {
    if (str == null) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
    else console.warn('showScreen: missing screen', id);
  }

  function formatTime(s) {
    const sec = Math.max(0, s | 0);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function countWords(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  // Render a list of player tags (lobby).
  // container: HTMLElement; players: [{ id, name }]; myId: string for "you" highlight
  function renderPlayerTags(container, players, myId) {
    container.innerHTML = players.map(p =>
      `<div class="player-tag${p.id === myId ? ' you' : ''}">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</div>`
    ).join('');
  }

  // Render a leaderboard. opts: { highlightTop3:bool, myId:string }
  function renderStandings(container, standings, opts) {
    opts = opts || {};
    container.innerHTML = standings.map((p, i) => {
      const isYou = opts.myId && p.id === opts.myId;
      const isTop = opts.highlightTop3 && i < 3;
      const cls = ['standing-row'];
      if (isYou) cls.push('you');
      if (isTop && !isYou) cls.push('top-three');
      return `<div class="${cls.join(' ')}">
        <span class="standing-rank">${i + 1}</span>
        <span class="standing-name">${esc(p.name)}${isYou ? ' (you)' : ''}</span>
        <span class="standing-score">${(p.score || 0).toLocaleString()}</span>
      </div>`;
    }).join('');
  }

  // Render top-3 podium. expects [1st, 2nd, 3rd] in standings order.
  function renderPodium(container, top3) {
    const places = [
      { cls: 'second', idx: 1 },
      { cls: 'first',  idx: 0 },
      { cls: 'third',  idx: 2 }
    ];
    container.innerHTML = places.map(({ cls, idx }) => {
      const p = top3[idx];
      if (!p) return '';
      return `<div class="podium-place ${cls}">
        <div class="podium-name">${esc(p.name)}</div>
        <div class="podium-bar">
          <div class="podium-rank">${idx + 1}</div>
          <div class="podium-score">${(p.score || 0).toLocaleString()}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Render game-select cards. games: [{ id, name, blurb, minPlayers, available, color }]
  // onSelect: (gameId) => void
  // playerCount: number (used to disable cards when player count < minPlayers)
  function renderGameCards(container, games, onSelect, playerCount) {
    container.innerHTML = games.map(g => {
      const enough = playerCount >= g.minPlayers;
      const enabled = g.available && enough;
      const cls = ['game-card'];
      if (!enabled) cls.push('disabled');
      const soonLabel = !g.available ? 'COMING SOON' : (!enough ? `NEED ${g.minPlayers}+` : '');
      const style = g.color ? `style="border-color:${g.color}"` : '';
      return `<button class="${cls.join(' ')}" data-game-id="${esc(g.id)}" ${enabled ? '' : 'disabled'} ${style}>
        ${soonLabel ? `<span class="game-card-soon">${esc(soonLabel)}</span>` : ''}
        <span class="game-card-min">min ${g.minPlayers}</span>
        <div class="game-card-name">${esc(g.name)}</div>
        <div class="game-card-blurb">${esc(g.blurb)}</div>
      </button>`;
    }).join('');
    container.querySelectorAll('.game-card').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        onSelect(btn.dataset.gameId);
      });
    });
  }

  // Updates all .timer elements within the currently-active .screen.
  function syncTimers(secondsLeft) {
    const text = formatTime(secondsLeft);
    document.querySelectorAll('.timer').forEach(el => {
      if (el.closest('.screen.active')) {
        el.textContent = text;
        el.classList.toggle('urgent', secondsLeft <= 5);
      }
    });
  }

  window.HBC = {
    esc, showScreen, formatTime, countWords,
    renderPlayerTags, renderStandings, renderPodium,
    renderGameCards, syncTimers
  };
})();
