const { LOBBY_PHASES, GAME_META } = require('../shared/constants');
const roomManager = require('./roomManager');
const { stopTimer } = require('./timerManager');

// Game registry. Each game module exports:
//   id, name, minPlayers, maxPlayers, eventPrefix, init(room, io),
//   handlers: { [eventName]: (room, socket, payload, io) => void },
//   cleanup(room) — optional, called when leaving the game (Pick New Game / play_again).
const games = new Map();

function registerGame(gameModule) {
  if (!gameModule || !gameModule.id) throw new Error('game module missing id');
  games.set(gameModule.id, gameModule);
}

function getGameInfo() {
  return GAME_META.map(meta => {
    const mod = games.get(meta.id);
    return {
      ...meta,
      // A game is selectable only if registered AND marked available in metadata.
      available: meta.available && !!mod
    };
  });
}

function broadcastLobby(room, io) {
  const payload = {
    code: room.code,
    phase: room.phase,
    activeGameId: room.activeGameId,
    players: roomManager.listPlayers(room),
    games: getGameInfo()
  };
  io.to(room.code + ':host').emit('lobby_state', payload);
  for (const p of room.players) io.to(p.id).emit('lobby_state', payload);
}

function showGameSelect(room, io) {
  // Hard-clean any prior game state before showing the picker.
  if (room.gameState && typeof room.gameState.cleanup === 'function') {
    try { room.gameState.cleanup(); } catch {}
  }
  stopTimer(room);
  room.activeGameId = null;
  room.gameState = null;
  room.phase = LOBBY_PHASES.GAME_SELECT;
  broadcastLobby(room, io);
}

function selectGame(room, gameId, io) {
  if (!roomManager.isHost(room, room.hostId)) return { ok: false, reason: 'Only the host can pick a game' };
  if (room.phase !== LOBBY_PHASES.LOBBY && room.phase !== LOBBY_PHASES.GAME_SELECT && room.phase !== LOBBY_PHASES.POST_GAME) {
    return { ok: false, reason: 'Cannot start a game right now' };
  }
  const mod = games.get(gameId);
  if (!mod) return { ok: false, reason: 'Game not available' };
  const meta = GAME_META.find(g => g.id === gameId);
  if (!meta || !meta.available) return { ok: false, reason: 'Game not available' };

  if (room.players.length < (mod.minPlayers || meta.minPlayers || 2)) {
    return { ok: false, reason: `Need at least ${mod.minPlayers || meta.minPlayers} players for ${meta.name}` };
  }
  if (mod.maxPlayers && room.players.length > mod.maxPlayers) {
    return { ok: false, reason: `Too many players for ${meta.name}` };
  }

  // Reset scores between games. Players persist.
  roomManager.resetScores(room);
  room.activeGameId = gameId;
  room.phase = LOBBY_PHASES.IN_GAME;
  try {
    mod.init(room, io);
  } catch (e) {
    console.error(`Game ${gameId} init failed:`, e);
    room.activeGameId = null;
    room.gameState = null;
    room.phase = LOBBY_PHASES.GAME_SELECT;
    broadcastLobby(room, io);
    return { ok: false, reason: 'Game failed to start' };
  }
  return { ok: true };
}

// Called by the game module when the game ends with final standings.
// Moves the lobby into POST_GAME (host can choose Play Again or Pick New Game).
function onGameEnd(room, io) {
  room.phase = LOBBY_PHASES.POST_GAME;
  // We do NOT broadcast lobby_state here — the game module already emits its
  // own `*_game_end` event with final standings. Lobby state is broadcast on
  // the host's next action (play_again or pick_new_game).
}

function playAgain(room, io) {
  if (!room.activeGameId) return { ok: false, reason: 'No active game' };
  const mod = games.get(room.activeGameId);
  if (!mod) return { ok: false, reason: 'Game not registered' };
  // Replay same game with same players. Reset scores; let the game module
  // also do its own internal reset via init().
  if (room.gameState && typeof room.gameState.cleanup === 'function') {
    try { room.gameState.cleanup(); } catch {}
  }
  stopTimer(room);
  roomManager.resetScores(room);
  room.gameState = null;
  room.phase = LOBBY_PHASES.IN_GAME;
  mod.init(room, io);
  return { ok: true };
}

function pickNewGame(room, io) {
  showGameSelect(room, io);
  return { ok: true };
}

function dispatchGameEvent(room, socket, eventName, payload, io) {
  if (!room.activeGameId) return;
  const mod = games.get(room.activeGameId);
  if (!mod || !mod.handlers) return;
  const handler = mod.handlers[eventName];
  if (typeof handler !== 'function') return;
  try {
    handler(room, socket, payload, io);
  } catch (e) {
    console.error(`Game ${room.activeGameId} handler ${eventName} failed:`, e);
  }
}

// All game-namespaced event names this lobby will route. Built from the
// registered modules' handler keys. Called once per game registration.
function getAllGameEvents() {
  const names = new Set();
  for (const mod of games.values()) {
    if (mod.handlers) {
      for (const k of Object.keys(mod.handlers)) names.add(k);
    }
  }
  return [...names];
}

module.exports = {
  registerGame,
  getGameInfo,
  broadcastLobby,
  showGameSelect,
  selectGame,
  onGameEnd,
  playAgain,
  pickNewGame,
  dispatchGameEvent,
  getAllGameEvents
};
