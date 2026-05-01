// Telephone smoke (simultaneous-rotation model). Every player auto-submits
// each round (rewrites and the guess use the same `tel_submit_link` event).
// Drives 3 sets and verifies game-end. Argv: --players=N (default 5).

const { io } = require('socket.io-client');
const URL = 'http://localhost:3030';
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });
}

const log = (...a) => console.log('[tel-smoke]', ...a);
const N = (() => {
  const arg = process.argv.find(a => a.startsWith('--players='));
  return arg ? parseInt(arg.split('=')[1], 10) : 5;
})();

(async () => {
  const errors = [];

  const host = await connect();
  let roomCode = '';
  host.on('room_created', ({ code }) => { roomCode = code; });
  host.on('error', ({ message }) => errors.push(['host', message]));
  host.emit('create_room');
  await delay(200);

  log('room', roomCode, 'with', N, 'players');

  const phrases = [
    'a marvelous and intricate scenario involving cats',
    'three retired pirates argue about brunch each Sunday',
    'a polite robot tries running a small bakery',
    'octopuses unionize against the local aquarium gift shop',
    'a soup convention attended only by sad spoons',
    'a parade led by an extremely small horse',
    'a doctor whose only patients are houseplants and ferns',
    'an alien tries to understand traffic court rules',
    'a town where everyone whispers everything always',
    'a confused chef hosts a gardening podcast'
  ];

  const players = [];
  for (let i = 0; i < N; i++) {
    const sock = await connect();
    const state = {
      sock, name: `P${i + 1}`, myId: '',
      writes: 0, guesses: 0, gotEnd: false, finalScore: 0
    };
    sock.on('joined', ({ yourId }) => { state.myId = yourId; });
    sock.on('error', ({ message }) => errors.push([state.name, message]));

    sock.on('tel_round_start', ({ wordLimit, isGuess }) => {
      const phrase = phrases[(i + state.writes + state.guesses) % phrases.length];
      const text = phrase.split(/\s+/).slice(0, wordLimit).join(' ');
      if (isGuess) state.guesses++; else state.writes++;
      sock.emit('tel_submit_link', { text });
    });
    sock.on('tel_vote_phase', ({ chains }) => {
      sock.emit('tel_submit_vote', { chainId: chains[0].id });
    });
    sock.on('tel_game_end', ({ finalStandings }) => {
      state.gotEnd = true;
      const me = finalStandings.find(p => p.id === state.myId);
      state.finalScore = me ? me.score : 0;
    });

    sock.emit('join_room', { code: roomCode, name: state.name });
    players.push(state);
    await delay(40);
  }
  await delay(300);

  log('selecting Telephone...');
  const started = Date.now();
  host.emit('select_game', { gameId: 'telephone' });

  await new Promise((resolve) => {
    const tick = () => {
      if (players.every(p => p.gotEnd)) return resolve();
      setTimeout(tick, 300);
    };
    tick();
    setTimeout(resolve, 8 * 60 * 1000);
  });

  log(`completed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  log('  writes per player:', players.map(p => `${p.name}=${p.writes}`).join(', '));
  log('  guesses per player:', players.map(p => `${p.name}=${p.guesses}`).join(', '));
  log('  final scores:', players.map(p => `${p.name}=${p.finalScore}`).join(', '));
  log('  errors:', errors.length, errors);
  log('  everyone finished?', players.every(p => p.gotEnd));

  for (const p of players) p.sock.disconnect();
  host.disconnect();
  await delay(200);
  process.exit(0);
})();
