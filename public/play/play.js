// Player shell. Owns join + lobby; per-game renderers register via
// window.HBPlay.register(gameId, hooks) and own their own socket events.

(function () {
  const { showScreen, esc, renderStandings } = window.HBC;
  const socket = io();
  const games = {};

  let myId = '';
  let lastLobbyState = null;

  window.HBPlay = {
    socket,
    getMyId() { return myId; },
    register(gameId, hooks) { games[gameId] = hooks; },
    showFinal({ finalStandings }) {
      const me = finalStandings.find(p => p.id === myId);
      document.getElementById('phone-final-score').textContent = me
        ? `Your score: ${me.score.toLocaleString()}`
        : '';
      renderStandings(document.getElementById('phone-final-standings'), finalStandings, { myId });
      showScreen('screen-final');
    },
    backToLobby() {
      showScreen('screen-lobby');
    }
  };

  // --- Join flow ---
  const btnJoin = document.getElementById('btn-join');
  const inputCode = document.getElementById('input-code');
  const inputName = document.getElementById('input-name');
  const joinError = document.getElementById('join-error');

  btnJoin.addEventListener('click', () => {
    const code = inputCode.value.trim().toUpperCase();
    const name = inputName.value.trim();
    joinError.textContent = '';
    if (!code || code.length !== 4) { joinError.textContent = 'Enter a 4-letter room code'; return; }
    if (!name) { joinError.textContent = 'Enter your name'; return; }
    btnJoin.disabled = true;
    socket.emit('join_room', { code, name });
  });

  socket.on('joined', ({ code, yourId, players }) => {
    myId = yourId;
    document.getElementById('lobby-code').textContent = code;
    renderLobbyPlayers(players);
    showScreen('screen-lobby');
  });

  socket.on('error', ({ message }) => {
    const active = document.querySelector('.screen.active');
    const localErr = active ? active.querySelector('.error') : null;
    if (localErr) localErr.textContent = message;
    else joinError.textContent = message;
    btnJoin.disabled = false;
  });

  function renderLobbyPlayers(players) {
    const list = document.getElementById('lobby-players');
    list.innerHTML = players.map(p =>
      `<span class="player-tag${p.id === myId ? ' you' : ''}">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>`
    ).join('');
  }

  socket.on('lobby_state', ({ phase, activeGameId, players }) => {
    lastLobbyState = { phase, activeGameId };
    renderLobbyPlayers(players);

    if (phase === 'LOBBY') {
      document.getElementById('lobby-headline').textContent = "You're in!";
      document.getElementById('lobby-sub').textContent = 'Waiting for host to start...';
      showScreen('screen-lobby');
    } else if (phase === 'GAME_SELECT') {
      document.getElementById('lobby-headline').textContent = 'Lobby';
      document.getElementById('lobby-sub').textContent = 'Waiting for host to pick a game...';
      showScreen('screen-lobby');
    }
    // IN_GAME / POST_GAME owned by per-game / final renderers.
  });

  // --- Timer sync ---
  socket.on('time_update', ({ secondsLeft }) => window.HBC.syncTimers(secondsLeft));

  socket.on('room_destroyed', () => {
    document.body.innerHTML = '<div style="padding:3rem;text-align:center;font-size:1.2rem;">Room closed. Refresh to start over.</div>';
  });
})();
