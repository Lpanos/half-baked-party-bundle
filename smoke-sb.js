// Focused smoke test: just Shutterbox. Driver mimics what the host browser
// does (advances on sb_host_next at host-paced screens). 4 players, 1x1
// transparent PNG as photo data.

const { io } = require('socket.io-client');
const URL = 'http://localhost:3030';
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });
}
const log = (...a) => console.log('[sb-smoke]', ...a);
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

(async () => {
  const errors = [];

  const host = await connect();
  let roomCode = '';
  host.on('room_created', ({ code }) => { roomCode = code; });
  host.on('error', ({ message }) => errors.push(['host', message]));

  // Host autoadvances on host-paced screens (matches what the browser would do).
  let advances = 0;
  host.on('sb_vote_result',    () => { advances++; setTimeout(() => host.emit('sb_host_next'), 800); });
  host.on('sb_scoreboard',     () => { advances++; setTimeout(() => host.emit('sb_host_next'), 800); });
  host.on('sb_final_results',  () => { advances++; setTimeout(() => host.emit('sb_host_next'), 800); });

  host.emit('create_room');
  await delay(200);
  if (!roomCode) throw new Error('Room not created');
  log('room', roomCode);

  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  const players = [];
  for (let i = 0; i < 4; i++) {
    const sock = await connect();
    const state = { sock, name: names[i], myId: '', gotEnd: false, finalScore: 0 };
    sock.on('joined', ({ yourId }) => { state.myId = yourId; });
    sock.on('error', ({ message }) => errors.push([state.name, message]));

    sock.on('sb_prompt_assigned', () => sock.emit('sb_submit_photo', { imageData: TINY_PNG }));
    sock.on('sb_final_round_start', () => sock.emit('sb_submit_photo', { imageData: TINY_PNG }));

    sock.on('sb_vote_phase', ({ player1, player2 }) => {
      if (state.myId === player1?.id || state.myId === player2?.id) return;
      sock.emit('sb_cast_vote', { votedForId: player1.id });
    });
    sock.on('sb_final_reveal', ({ photos }) => {
      const target = photos.find(ph => ph.playerId !== state.myId);
      if (target) sock.emit('sb_cast_vote', { votedForId: target.playerId });
    });

    sock.on('sb_game_end', ({ finalStandings }) => {
      state.gotEnd = true;
      const me = finalStandings.find(p => p.id === state.myId);
      state.finalScore = me ? me.score : 0;
    });

    sock.emit('join_room', { code: roomCode, name: state.name });
    players.push(state);
    await delay(50);
  }
  await delay(300);

  log('selecting Shutterbox...');
  const started = Date.now();
  host.emit('select_game', { gameId: 'shutterbox' });

  await new Promise((resolve) => {
    const tick = () => {
      if (players.every(p => p.gotEnd)) return resolve();
      setTimeout(tick, 300);
    };
    tick();
    setTimeout(resolve, 4 * 60 * 1000);
  });

  log(`SB completed in ${((Date.now() - started) / 1000).toFixed(1)}s with ${advances} host advances`);
  log('  final scores:', players.map(p => `${p.name}=${p.finalScore}`).join(', '));
  log('  errors:', errors.length, errors);
  log('  everyone finished?', players.every(p => p.gotEnd));

  for (const p of players) p.sock.disconnect();
  host.disconnect();
  await delay(200);
  process.exit(0);
})();
