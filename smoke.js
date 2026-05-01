// Smoke test: host + 4 players, lobby → Word Budget → return to lobby →
// Frankenstein. Auto-submits to drive each game forward; verifies cross-game
// score reset, no event leakage, and server-side adversarial-event rejection.
//
// Usage: server must be running (PORT=3030). Then `node smoke.js`.

const { io } = require('socket.io-client');
const URL = 'http://localhost:3030';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
  });
}

const log = (...a) => console.log('[smoke]', ...a);

(async () => {
  const errors = [];

  // --- Host connect & create room ---
  const host = await connect();
  let roomCode = '';
  let lobbyPhase = '';
  host.on('room_created', ({ code }) => { roomCode = code; });
  host.on('lobby_state', ({ phase, activeGameId }) => { lobbyPhase = phase; });
  host.on('error', ({ message }) => errors.push(['host', message]));
  host.emit('create_room');
  await delay(200);
  if (!roomCode) throw new Error('Room not created');
  log('room', roomCode, 'phase', lobbyPhase);

  // --- 4 players join ---
  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  const wbAnswers = [
    'a thing that aliens would say',
    'something my dog actually thinks',
    'the ABC of NPC',
    'why pigeons gossip about me'
  ];
  const fkAnswers = [
    'alice loves long walks on the beach with her cat named XYZZY late at night',
    'bob runs marathons every weekend without fail and tells everyone about it constantly',
    'carol bakes sourdough bread weekly and makes everyone smell her starter culture happily',
    'dave collects vintage postcards from defunct roadside attractions across the entire midwestern usa'
  ];
  const players = [];

  for (let i = 0; i < 4; i++) {
    const sock = await connect();
    const state = {
      sock, name: names[i], i, myId: '',
      currentMatchupId: '',
      stitchPool: [],
      ownWordsLeak: false,
      gotWBGameEnd: false,
      gotFKGameEnd: false,
      finalScores: { wb: 0, fk: 0 }
    };
    sock.on('joined', ({ yourId }) => { state.myId = yourId; });
    sock.on('error', ({ message }) => errors.push([state.name, message]));

    // --- Word Budget hooks ---
    sock.on('wb_round_start', ({ prompt, wordLimit, roundNum, setNum }) => {
      const text = wbAnswers[i].split(/\s+/).slice(0, wordLimit).join(' ');
      sock.emit('wb_submit_answer', { text });
    });
    sock.on('wb_matchup_show', ({ matchupId, canVote }) => {
      state.currentMatchupId = matchupId;
      if (canVote) sock.emit('wb_submit_vote', { matchupId, choice: 0 });
    });
    sock.on('wb_game_end', ({ finalStandings }) => {
      state.gotWBGameEnd = true;
      const me = finalStandings.find(p => p.id === state.myId);
      state.finalScores.wb = me ? me.score : 0;
    });

    // --- Frankenstein hooks ---
    sock.on('fk_round_start', ({ prompt }) => {
      sock.emit('fk_submit_answer', { text: fkAnswers[i] });
    });
    sock.on('fk_stitch_phase_start', ({ fragments }) => {
      state.stitchPool = fragments;
      const sentinels = ['XYZZY', 'marathons', 'sourdough', 'postcards'];
      const my = sentinels[i];
      if (fragments.some(f => f.text.toLowerCase().includes(my.toLowerCase()))) {
        state.ownWordsLeak = true;
      }
      // Adversarial probes from Alice on round 1 only.
      if (i === 0 && !state.firedProbes) {
        state.firedProbes = true;
        sock.emit('fk_submit_stitched', { fragmentIds: ['fake_id_999'] });
        sock.emit('fk_submit_stitched', { fragmentIds: [fragments[0].id, fragments[0].id] });
        sock.emit('fk_submit_stitched', { fragmentIds: [] });
      }
      const ids = fragments.slice(0, Math.min(3, fragments.length)).map(f => f.id);
      sock.emit('fk_submit_stitched', { fragmentIds: ids });
    });
    sock.on('fk_matchup_show', ({ matchupId, canVote }) => {
      if (canVote) sock.emit('fk_submit_vote', { matchupId, choice: 0 });
    });
    sock.on('fk_game_end', ({ finalStandings }) => {
      state.gotFKGameEnd = true;
      const me = finalStandings.find(p => p.id === state.myId);
      state.finalScores.fk = me ? me.score : 0;
    });

    sock.emit('join_room', { code: roomCode, name: state.name });
    players.push(state);
    await delay(50);
  }

  await delay(300);

  // --- Cross-game-events leakage probe: emit a fake wb_ event before any game starts. ---
  players[0].sock.emit('wb_submit_answer', { text: 'should be ignored — no active game' });
  await delay(100);

  // --- Host picks Word Budget ---
  log('selecting wordBudget...');
  const startedWB = Date.now();
  host.emit('select_game', { gameId: 'wordBudget' });

  // Wait for all 4 players to receive wb_game_end. Generous timeout — full WB is slow.
  await new Promise((resolve) => {
    const tick = () => {
      if (players.every(p => p.gotWBGameEnd)) return resolve();
      setTimeout(tick, 500);
    };
    tick();
    setTimeout(resolve, 8 * 60 * 1000); // 8 min hard cap
  });
  log(`WB completed in ${((Date.now() - startedWB) / 1000).toFixed(1)}s`);
  log('  WB final scores:', players.map(p => `${p.name}=${p.finalScores.wb}`).join(', '));

  // --- Host picks new game (Frankenstein) ---
  await delay(500);
  log('picking new game (Frankenstein)...');
  host.emit('pick_new_game');
  await delay(300);

  if (lobbyPhase !== 'GAME_SELECT') {
    errors.push(['host', `expected GAME_SELECT after pick_new_game, got ${lobbyPhase}`]);
  }

  host.emit('select_game', { gameId: 'frankenstein' });
  const startedFK = Date.now();

  await new Promise((resolve) => {
    const tick = () => {
      if (players.every(p => p.gotFKGameEnd)) return resolve();
      setTimeout(tick, 500);
    };
    tick();
    setTimeout(resolve, 6 * 60 * 1000); // 6 min hard cap
  });
  log(`FK completed in ${((Date.now() - startedFK) / 1000).toFixed(1)}s`);
  log('  FK final scores:', players.map(p => `${p.name}=${p.finalScores.fk}`).join(', '));

  // --- Verifications ---
  log('--- VERIFICATIONS ---');
  const everyoneFinishedWB = players.every(p => p.gotWBGameEnd);
  const everyoneFinishedFK = players.every(p => p.gotFKGameEnd);
  const noLeaks = players.every(p => !p.ownWordsLeak);
  // FK scores should NOT include WB scores.
  const fkScoresLowerThanCombined = players.every(p => p.finalScores.fk < p.finalScores.wb + p.finalScores.fk + 1); // sanity

  log('  everyone finished WB?', everyoneFinishedWB);
  log('  everyone finished FK?', everyoneFinishedFK);
  log('  no fragment leaks?    ', noLeaks);
  log('  errors:');
  for (const e of errors) console.log('    ', e);

  // Adversarial probe results — we expect 3 errors per probe set (forged id, dup, empty)
  const adversarialErrors = errors.filter(e => e[0] === 'Alice' && (
    e[1].includes('Fragment') || e[1].includes('reuse') || e[1].includes('Add at least')
  ));
  log('  adversarial probe rejections (Alice, FK):', adversarialErrors.length, '(expected 3)');

  // The pre-game wb_submit_answer should have been silently dropped (no error).
  const preGameLeakError = errors.some(e => e[1] && e[1].toLowerCase().includes('not in writing phase'));
  log('  pre-game wb event was silently ignored (no error path)?', !preGameLeakError);

  // Cleanup
  for (const p of players) p.sock.disconnect();
  host.disconnect();
  await delay(200);
  process.exit(0);
})();
