// Host shell. Owns lobby, game-select, and post-game screens. Per-game host
// renderers register themselves via window.HBHost.register(gameId, hooks)
// and are responsible for their own socket event handlers.

(function () {
  const { showScreen, renderPlayerTags, renderStandings, renderPodium, renderGameCards } = window.HBC;
  const socket = io();
  const games = {}; // gameId -> { onSelect, onGameEnd }

  let roomCode = '';
  let currentGameId = null;
  let lastFinalStandings = [];

  window.HBHost = {
    socket,
    register(gameId, hooks) { games[gameId] = hooks; },
    showFinal(standings) {
      lastFinalStandings = standings;
      renderPodium(document.getElementById('podium'), standings.slice(0, 3));
      renderStandings(document.getElementById('final-standings'), standings.slice(3), { highlightTop3: false });
      showScreen('screen-final');
    }
  };

  // --- Boot: create room ---
  socket.emit('create_room');

  socket.on('room_created', ({ code }) => {
    roomCode = code;
    const loc = window.location;
    const joinUrl = `${loc.hostname}${loc.port ? ':' + loc.port : ''}/play`;
    document.getElementById('lobby-code').textContent = code;
    document.getElementById('lobby-room-badge').textContent = code;
    document.getElementById('join-url').textContent = joinUrl;
    document.querySelectorAll('.room-badge-small.game-badge, #select-room-code').forEach(el => el.textContent = code);
    showScreen('screen-lobby');
  });

  // --- Lobby state (single source of truth from server) ---
  socket.on('lobby_state', ({ phase, activeGameId, players, games: gameInfo }) => {
    currentGameId = activeGameId;

    const playerListEl = document.getElementById('player-list');
    const gameCardsEl = document.getElementById('game-cards');
    const playerCountEl = document.getElementById('select-player-count');

    renderPlayerTags(playerListEl, players);
    if (playerCountEl) {
      playerCountEl.textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
    }

    if (phase === 'LOBBY') {
      const minOverall = Math.min(...gameInfo.filter(g => g.available).map(g => g.minPlayers));
      const hint = document.getElementById('lobby-hint');
      if (players.length >= minOverall) {
        hint.textContent = `${players.length} ready — picking game...`;
        // Auto-advance to game select once we have enough for at least one game.
        setTimeout(() => {
          if (currentGameId) return; // game already started
          showScreen('screen-game-select');
          renderGameCards(gameCardsEl, gameInfo, onGameClick, players.length);
        }, 0);
      } else {
        hint.textContent = `Need at least ${minOverall} players (${players.length}/${minOverall})`;
        showScreen('screen-lobby');
      }
    } else if (phase === 'GAME_SELECT') {
      renderGameCards(gameCardsEl, gameInfo, onGameClick, players.length);
      showScreen('screen-game-select');
    }
    // IN_GAME / POST_GAME are owned by the active game module; we don't switch
    // screens here.
  });

  function onGameClick(gameId) {
    socket.emit('select_game', { gameId });
  }

  // --- Post-game actions ---
  document.getElementById('btn-play-again').addEventListener('click', () => {
    socket.emit('play_again');
  });
  document.getElementById('btn-pick-new-game').addEventListener('click', () => {
    socket.emit('pick_new_game');
  });

  // --- Timer sync (shared event) ---
  socket.on('time_update', ({ secondsLeft }) => window.HBC.syncTimers(secondsLeft));

  // --- Errors ---
  socket.on('error', ({ message }) => {
    console.warn('[server error]', message);
  });

  socket.on('room_destroyed', () => {
    document.body.innerHTML = '<div style="padding:3rem;text-align:center;font-size:1.5rem;">Room closed. Refresh to start a new one.</div>';
  });
})();
