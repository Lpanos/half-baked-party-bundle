const { ROOM_LIMITS, LOBBY_PHASES } = require('../shared/constants');

const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_LIMITS.CODE_LENGTH; i++) {
      code += ROOM_LIMITS.CODE_ALPHABET[Math.floor(Math.random() * ROOM_LIMITS.CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocketId) {
  const code = generateCode();
  const room = {
    code,
    hostId: hostSocketId,
    players: [],                 // [{ id, name, score, connected, hasInput }]
    phase: LOBBY_PHASES.LOBBY,
    activeGameId: null,          // 'wordBudget' | 'frankenstein' | null
    gameState: null,             // owned by the active game module
    lastActivity: Date.now(),
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  if (!code) return null;
  return rooms.get(code.toUpperCase()) || null;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.hostId === socketId) return room;
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function isHost(room, socketId) {
  return room && room.hostId === socketId;
}

function getPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId) || null;
}

function joinRoom(room, socketId, rawName) {
  if (!room) return { ok: false, reason: 'Room not found' };
  if (room.phase !== LOBBY_PHASES.LOBBY && room.phase !== LOBBY_PHASES.GAME_SELECT && room.phase !== LOBBY_PHASES.POST_GAME) {
    return { ok: false, reason: 'Game in progress, cannot join' };
  }
  const name = (rawName || '').trim().substring(0, 16);
  if (!name) return { ok: false, reason: 'Name cannot be blank' };
  if (room.players.length >= ROOM_LIMITS.MAX_PLAYERS) {
    return { ok: false, reason: 'Room is full' };
  }
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: 'Name already taken' };
  }
  room.players.push({
    id: socketId,
    name,
    score: 0,
    connected: true,
    hasInput: false  // generic flag games can use to track per-phase submission
  });
  room.lastActivity = Date.now();
  return { ok: true };
}

function removePlayer(room, socketId) {
  if (!room) return false;
  const before = room.players.length;
  room.players = room.players.filter(p => p.id !== socketId);
  room.lastActivity = Date.now();
  return room.players.length !== before;
}

function destroyRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  // Game modules attach their own cleanup via room.gameState.cleanup if needed.
  if (room.gameState && typeof room.gameState.cleanup === 'function') {
    try { room.gameState.cleanup(); } catch {}
  }
  rooms.delete(code);
}

function listPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score }));
}

function resetScores(room) {
  for (const p of room.players) p.score = 0;
}

function touch(room) {
  if (room) room.lastActivity = Date.now();
}

function startIdleCleanup(intervalMs = 60_000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.lastActivity > ROOM_LIMITS.IDLE_TIMEOUT_MS) {
        destroyRoom(code);
      }
    }
  }, intervalMs);
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  getRoomBySocket,
  isHost,
  getPlayer,
  joinRoom,
  removePlayer,
  destroyRoom,
  listPlayers,
  resetScores,
  touch,
  startIdleCleanup
};
