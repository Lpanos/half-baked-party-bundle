const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const roomManager = require('./roomManager');
const lobbyManager = require('./lobbyManager');
const { LOBBY_PHASES } = require('../shared/constants');

const app = express();
const server = http.createServer(app);

// 5MB Socket.io buffer for Shutterbox base64 photo uploads.
const io = new Server(server, { maxHttpBufferSize: 5 * 1024 * 1024 });

app.use(express.json({ limit: '1mb' }));

// --- Routes ---
app.get('/', (req, res) => res.redirect('/play'));
app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host', 'index.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'play', 'index.html')));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// --- Game registry. Register before sockets so dispatchGameEvent can route. ---
[
  './games/wordBudget',
  './games/frankenstein',
  './games/shutterbox',
  './games/telephone'
].forEach(modPath => {
  try {
    const mod = require(modPath);
    lobbyManager.registerGame(mod);
    console.log(`registered game: ${mod.id}`);
  } catch (e) {
    console.warn(`could not register ${modPath}:`, e.message);
  }
});

// --- Set of shared (non-game-prefixed) events the dispatcher must NOT forward. ---
const SHARED_EVENTS = new Set([
  'create_room', 'join_room', 'select_game', 'play_again', 'pick_new_game',
  'disconnect', 'disconnecting'
]);

io.on('connection', (socket) => {

  socket.on('create_room', () => {
    const room = roomManager.createRoom(socket.id);
    socket.join(room.code + ':host');
    socket.emit('room_created', { code: room.code });
    lobbyManager.broadcastLobby(room, io);
  });

  socket.on('join_room', ({ code, name }) => {
    const room = roomManager.getRoom(code);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    const result = roomManager.joinRoom(room, socket.id, name);
    if (!result.ok) { socket.emit('error', { message: result.reason }); return; }
    socket.join(room.code);
    socket.emit('joined', {
      code: room.code,
      yourId: socket.id,
      players: roomManager.listPlayers(room)
    });
    lobbyManager.broadcastLobby(room, io);
  });

  socket.on('select_game', ({ gameId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    if (!roomManager.isHost(room, socket.id)) {
      socket.emit('error', { message: 'Only the host can pick a game' });
      return;
    }
    const result = lobbyManager.selectGame(room, gameId, io);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  socket.on('play_again', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || !roomManager.isHost(room, socket.id)) return;
    const result = lobbyManager.playAgain(room, io);
    if (!result.ok) socket.emit('error', { message: result.reason });
  });

  socket.on('pick_new_game', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room || !roomManager.isHost(room, socket.id)) return;
    lobbyManager.pickNewGame(room, io);
  });

  // --- Catch-all dispatcher for game-namespaced events. ---
  socket.onAny((eventName, payload) => {
    if (SHARED_EVENTS.has(eventName)) return;
    if (!eventName.includes('_')) return; // game events are namespaced (wb_, fk_, sb_, tel_)
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;
    if (room.phase !== LOBBY_PHASES.IN_GAME) return; // ignore stale events outside a game
    roomManager.touch(room);
    lobbyManager.dispatchGameEvent(room, socket, eventName, payload || {}, io);
  });

  socket.on('disconnect', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (!room) return;

    if (roomManager.isHost(room, socket.id)) {
      // Host gone → tear down room.
      for (const p of room.players) {
        io.to(p.id).emit('error', { message: 'Host disconnected. Game over.' });
        io.to(p.id).emit('room_destroyed', {});
      }
      roomManager.destroyRoom(room.code);
      return;
    }

    // Player gone → notify game module (if any), then update lobby.
    if (room.gameState && typeof room.gameState.onPlayerDisconnect === 'function') {
      try { room.gameState.onPlayerDisconnect(socket.id); } catch {}
    }
    const removed = roomManager.removePlayer(room, socket.id);
    if (removed) lobbyManager.broadcastLobby(room, io);
  });
});

roomManager.startIdleCleanup();

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Half Baked Party Bundle running on port ${PORT}`);
  console.log(`  Host:  http://localhost:${PORT}/host`);
  console.log(`  Play:  http://localhost:${PORT}/play`);
});
