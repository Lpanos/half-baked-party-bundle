const path = require('path');
const fs = require('fs');
const { FK } = require('../../shared/constants');
const { createMatchups, recordOpponents } = require('../matchmaking');
const { createPromptPool, pickPrompts } = require('../promptPool');
const { scoreMatchup, getStandings, addScore } = require('../scoreManager');
const { startTimer, stopTimer } = require('../timerManager');
const { chopAnswer, buildPools, validateStitch, renderStitched } = require('../fragments');
const lobbyManager = require('../lobbyManager');

const promptBank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'frankenstein_prompts.json'), 'utf8'));

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function init(room, io) {
  room.gameState = {
    phase: FK.PHASES.WRITE,
    currentRound: 0,
    currentPrompt: null,
    writeAnswers: {},
    fragmentPools: {},
    stitched: {},
    matchups: [],
    currentMatchupIndex: 0,
    promptPool: createPromptPool(promptBank),
    opponentHistory: {},
    writeSubmitted: new Set(),
    stitchSubmitted: new Set(),
    cleanup() { stopTimer(room); },
    onPlayerDisconnect(socketId) {
      this.writeSubmitted.delete(socketId);
      this.stitchSubmitted.delete(socketId);
    }
  };
  startRound(room, io);
}

function startRound(room, io) {
  const gs = room.gameState;
  gs.phase = FK.PHASES.WRITE;
  const [prompt] = pickPrompts(gs.promptPool, 1);
  gs.currentPrompt = prompt;
  gs.writeAnswers = {};
  gs.fragmentPools = {};
  gs.stitched = {};
  gs.matchups = [];
  gs.writeSubmitted = new Set();
  gs.stitchSubmitted = new Set();

  const hostPayload = {
    roundNum: gs.currentRound + 1,
    totalRounds: FK.ROUNDS_PER_GAME,
    prompt,
    wordLimit: FK.WORD_LIMIT_WRITE,
    timer: FK.WRITE_TIME,
    totalPlayers: room.players.length
  };
  io.to(room.code + ':host').emit('fk_round_start', hostPayload);

  const playerPayload = {
    roundNum: gs.currentRound + 1,
    totalRounds: FK.ROUNDS_PER_GAME,
    prompt,
    wordLimit: FK.WORD_LIMIT_WRITE,
    timer: FK.WRITE_TIME
  };
  for (const p of room.players) io.to(p.id).emit('fk_round_start', playerPayload);

  startTimer(room, io, FK.WRITE_TIME, () => endWritePhase(room, io));
}

function submitAnswer(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== FK.PHASES.WRITE) return;
  const pid = socket.id;
  if (gs.writeSubmitted.has(pid)) { socket.emit('error', { message: 'Already submitted' }); return; }

  const text = (payload && payload.text || '').trim();
  if (!text) { socket.emit('error', { message: 'Answer cannot be blank' }); return; }
  if (countWords(text) > FK.WORD_LIMIT_WRITE) { socket.emit('error', { message: 'Over word limit' }); return; }

  gs.writeAnswers[pid] = text;
  gs.writeSubmitted.add(pid);
  socket.emit('fk_answer_accepted', {});

  io.to(room.code + ':host').emit('fk_submission_update', {
    submitted: gs.writeSubmitted.size,
    total: room.players.length
  });

  if (gs.writeSubmitted.size >= room.players.length) {
    stopTimer(room);
    endWritePhase(room, io);
  }
}

function endWritePhase(room, io) {
  stopTimer(room);
  startStitchPhase(room, io);
}

function startStitchPhase(room, io) {
  const gs = room.gameState;
  gs.phase = FK.PHASES.STITCH;

  const allChunks = [];
  for (const p of room.players) {
    const text = gs.writeAnswers[p.id];
    if (text) allChunks.push(...chopAnswer(text, p.id));
  }
  const playerIds = room.players.map(p => p.id);
  gs.fragmentPools = buildPools(allChunks, playerIds, FK.POOL_SIZE);
  gs.stitched = {};
  gs.stitchSubmitted = new Set();

  io.to(room.code + ':host').emit('fk_stitch_phase_start', {
    timer: FK.STITCH_TIME,
    totalPlayers: room.players.length
  });

  for (const p of room.players) {
    io.to(p.id).emit('fk_stitch_phase_start', {
      prompt: gs.currentPrompt,
      fragments: gs.fragmentPools[p.id] || [],
      timer: FK.STITCH_TIME
    });
  }

  startTimer(room, io, FK.STITCH_TIME, () => endStitchPhase(room, io));
}

function submitStitched(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== FK.PHASES.STITCH) return;
  const pid = socket.id;
  if (gs.stitchSubmitted.has(pid)) { socket.emit('error', { message: 'Already submitted' }); return; }

  const fragmentIds = payload && payload.fragmentIds;
  const pool = gs.fragmentPools[pid] || [];
  const v = validateStitch(fragmentIds, pool);
  if (!v.ok) { socket.emit('error', { message: v.reason }); return; }

  gs.stitched[pid] = { fragmentIds: [...fragmentIds], text: renderStitched(fragmentIds, pool) };
  gs.stitchSubmitted.add(pid);
  socket.emit('fk_stitched_accepted', {});

  io.to(room.code + ':host').emit('fk_stitch_update', {
    submitted: gs.stitchSubmitted.size,
    total: room.players.length
  });

  if (gs.stitchSubmitted.size >= room.players.length) {
    stopTimer(room);
    endStitchPhase(room, io);
  }
}

function endStitchPhase(room, io) {
  const gs = room.gameState;
  stopTimer(room);
  for (const p of room.players) {
    if (!gs.stitched[p.id]) {
      gs.stitched[p.id] = { fragmentIds: [], text: '(No answer submitted)' };
    }
  }
  beginVoting(room, io);
}

function beginVoting(room, io) {
  const gs = room.gameState;
  gs.phase = FK.PHASES.MATCHUP_VOTE;

  const activeIds = room.players.map(p => p.id);
  const groups = createMatchups(activeIds, gs.opponentHistory, FK.TRIPLE_THRESHOLD);
  recordOpponents(groups, gs.opponentHistory);

  gs.matchups = groups.map((playerIds, i) => ({
    id: `fk_m_${gs.currentRound}_${i}`,
    prompt: gs.currentPrompt,
    playerIds,
    answers: Object.fromEntries(playerIds.map(pid => [pid, gs.stitched[pid]?.text || '(No answer submitted)'])),
    votes: {}
  }));

  gs.currentMatchupIndex = 0;
  showNextMatchup(room, io);
}

function showNextMatchup(room, io) {
  const gs = room.gameState;
  if (gs.currentMatchupIndex >= gs.matchups.length) {
    showRoundResults(room, io);
    return;
  }
  const m = gs.matchups[gs.currentMatchupIndex];
  const answers = m.playerIds.map(pid => m.answers[pid]);

  io.to(room.code + ':host').emit('fk_matchup_show', {
    matchupId: m.id, prompt: m.prompt, answers,
    timer: FK.VOTE_TIMER,
    matchupIndex: gs.currentMatchupIndex,
    totalMatchups: gs.matchups.length
  });

  for (const p of room.players) {
    const inMatchup = m.playerIds.includes(p.id);
    io.to(p.id).emit('fk_matchup_show', {
      matchupId: m.id, prompt: m.prompt, answers,
      timer: FK.VOTE_TIMER,
      canVote: !inMatchup,
      matchupIndex: gs.currentMatchupIndex,
      totalMatchups: gs.matchups.length
    });
  }

  startTimer(room, io, FK.VOTE_TIMER, () => revealMatchupResult(room, io));
}

function submitVote(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== FK.PHASES.MATCHUP_VOTE) return;
  const m = gs.matchups.find(mm => mm.id === (payload && payload.matchupId));
  if (!m) return;
  if (m.playerIds.includes(socket.id)) return;
  const choice = payload && payload.choice;
  if (typeof choice !== 'number' || choice < 0 || choice >= m.playerIds.length) return;
  if (m.votes[socket.id] !== undefined) { socket.emit('error', { message: 'Already voted' }); return; }
  m.votes[socket.id] = choice;
  socket.emit('fk_vote_accepted', {});
}

function revealMatchupResult(room, io) {
  const gs = room.gameState;
  stopTimer(room);
  gs.phase = FK.PHASES.MATCHUP_RESULT;

  const m = gs.matchups[gs.currentMatchupIndex];
  const isFinalRound = gs.currentRound === FK.ROUNDS_PER_GAME - 1;
  const { scores, voteCounts, totalVotes } = scoreMatchup(m, 1);

  for (const [pid, pts] of Object.entries(scores)) addScore(room, pid, pts);

  const playerNames = m.playerIds.map(pid => {
    const p = room.players.find(pp => pp.id === pid);
    return p ? p.name : 'Unknown';
  });

  const payload = {
    matchupId: m.id,
    prompt: m.prompt,
    answers: m.playerIds.map(pid => m.answers[pid]),
    playerNames,
    voteCounts,
    totalVotes,
    scores: m.playerIds.map(pid => scores[pid] || 0),
    isFinalRound,
    standings: getStandings(room)
  };
  io.to(room.code + ':host').emit('fk_matchup_result', payload);
  for (const p of room.players) io.to(p.id).emit('fk_matchup_result', payload);

  setTimeout(() => {
    if (room.activeGameId !== 'frankenstein') return;
    gs.currentMatchupIndex++;
    gs.phase = FK.PHASES.MATCHUP_VOTE;
    showNextMatchup(room, io);
  }, FK.MATCHUP_RESULTS_PAUSE);
}

function showRoundResults(room, io) {
  const gs = room.gameState;
  gs.phase = FK.PHASES.ROUND_END;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('fk_round_end', {
    roundNum: gs.currentRound + 1,
    totalRounds: FK.ROUNDS_PER_GAME,
    standings
  });
  for (const p of room.players) {
    io.to(p.id).emit('fk_round_end', {
      roundNum: gs.currentRound + 1,
      totalRounds: FK.ROUNDS_PER_GAME,
      standings,
      yourScore: p.score
    });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'frankenstein') return;
    gs.currentRound++;
    if (gs.currentRound < FK.ROUNDS_PER_GAME) startRound(room, io);
    else showFinalScores(room, io);
  }, FK.RESULTS_PAUSE);
}

function showFinalScores(room, io) {
  stopTimer(room);
  const standings = getStandings(room);
  io.to(room.code + ':host').emit('fk_game_end', { finalStandings: standings });
  for (const p of room.players) {
    io.to(p.id).emit('fk_game_end', { finalStandings: standings, yourScore: p.score });
  }
  lobbyManager.onGameEnd(room, io);
}

module.exports = {
  id: 'frankenstein',
  name: 'FRANKENSTEIN',
  minPlayers: FK.MIN_PLAYERS,
  maxPlayers: 16,
  eventPrefix: 'fk_',
  init,
  handlers: {
    fk_submit_answer: submitAnswer,
    fk_submit_stitched: submitStitched,
    fk_submit_vote: submitVote
  }
};
