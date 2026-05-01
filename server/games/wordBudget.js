const path = require('path');
const fs = require('fs');
const { WB } = require('../../shared/constants');
const { createMatchups, recordOpponents } = require('../matchmaking');
const { createPromptPool, pickPrompts } = require('../promptPool');
const { scoreMatchup, getStandings, addScore } = require('../scoreManager');
const { startTimer, stopTimer } = require('../timerManager');
const lobbyManager = require('../lobbyManager');

const promptBank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'wordbudget_prompts.json'), 'utf8'));

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function init(room, io) {
  room.gameState = {
    phase: WB.PHASES.PROMPT_WRITE,
    currentSet: 0,
    currentRound: 0,
    matchups: [],
    currentMatchupIndex: 0,
    promptPool: createPromptPool(promptBank),
    opponentHistory: {},
    submittedSet: new Set(),
    cleanup() { stopTimer(room); },
    onPlayerDisconnect(socketId) {
      // No reconnection support — just absorb the loss.
      this.submittedSet.delete(socketId);
    }
  };
  startRound(room, io);
}

function startRound(room, io) {
  const gs = room.gameState;
  gs.phase = WB.PHASES.PROMPT_WRITE;
  const roundIdx = gs.currentRound;
  const wordLimit = WB.WORD_LIMITS[roundIdx];
  const timer = WB.ROUND_TIMERS[roundIdx];

  gs.submittedSet = new Set();

  const activeIds = room.players.map(p => p.id);
  const groups = createMatchups(activeIds, gs.opponentHistory, WB.TRIPLE_THRESHOLD);
  recordOpponents(groups, gs.opponentHistory);

  const prompts = pickPrompts(gs.promptPool, groups.length);
  gs.matchups = groups.map((playerIds, i) => ({
    id: `wb_m_${gs.currentSet}_${gs.currentRound}_${i}`,
    prompt: prompts[i],
    playerIds,
    answers: {},
    votes: {}
  }));

  io.to(room.code + ':host').emit('wb_round_start', {
    roundNum: roundIdx + 1,
    setNum: gs.currentSet + 1,
    roundsPerSet: WB.ROUNDS_PER_SET,
    setsPerGame: WB.SETS_PER_GAME,
    wordLimit, timer,
    totalPlayers: room.players.length
  });

  for (const m of gs.matchups) {
    for (const pid of m.playerIds) {
      io.to(pid).emit('wb_round_start', {
        roundNum: roundIdx + 1,
        setNum: gs.currentSet + 1,
        wordLimit, timer,
        prompt: m.prompt
      });
    }
  }

  startTimer(room, io, timer, () => {
    // Fill in missing answers as placeholders so voting still works.
    for (const m of gs.matchups) {
      for (const pid of m.playerIds) {
        if (!m.answers[pid]) m.answers[pid] = '(No answer submitted)';
      }
    }
    beginVoting(room, io);
  });
}

function submitAnswer(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== WB.PHASES.PROMPT_WRITE) return;
  const pid = socket.id;
  if (gs.submittedSet.has(pid)) { socket.emit('error', { message: 'Already submitted' }); return; }

  const matchup = gs.matchups.find(m => m.playerIds.includes(pid));
  if (!matchup) return;

  const text = (payload && payload.text || '').trim();
  if (!text) { socket.emit('error', { message: 'Answer cannot be blank' }); return; }
  const limit = WB.WORD_LIMITS[gs.currentRound];
  if (countWords(text) > limit) { socket.emit('error', { message: 'Over word limit' }); return; }

  matchup.answers[pid] = text;
  gs.submittedSet.add(pid);
  socket.emit('wb_answer_accepted', {});

  io.to(room.code + ':host').emit('wb_submission_update', {
    submitted: gs.submittedSet.size,
    total: room.players.length
  });

  // Early advance if all players in all matchups have answers.
  const allIn = gs.matchups.every(m => m.playerIds.every(id => m.answers[id]));
  if (allIn) {
    stopTimer(room);
    beginVoting(room, io);
  }
}

function beginVoting(room, io) {
  const gs = room.gameState;
  gs.phase = WB.PHASES.MATCHUP_VOTE;
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
  const answers = m.playerIds.map(pid => m.answers[pid] || '(No answer submitted)');

  io.to(room.code + ':host').emit('wb_matchup_show', {
    matchupId: m.id, prompt: m.prompt, answers,
    timer: WB.VOTE_TIMER,
    matchupIndex: gs.currentMatchupIndex,
    totalMatchups: gs.matchups.length
  });

  for (const p of room.players) {
    const inMatchup = m.playerIds.includes(p.id);
    io.to(p.id).emit('wb_matchup_show', {
      matchupId: m.id, prompt: m.prompt, answers,
      timer: WB.VOTE_TIMER,
      canVote: !inMatchup,
      matchupIndex: gs.currentMatchupIndex,
      totalMatchups: gs.matchups.length
    });
  }

  startTimer(room, io, WB.VOTE_TIMER, () => revealMatchupResult(room, io));
}

function submitVote(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== WB.PHASES.MATCHUP_VOTE) return;
  const m = gs.matchups.find(mm => mm.id === (payload && payload.matchupId));
  if (!m) return;
  if (m.playerIds.includes(socket.id)) return;
  const choice = payload && payload.choice;
  if (typeof choice !== 'number' || choice < 0 || choice >= m.playerIds.length) return;
  if (m.votes[socket.id] !== undefined) { socket.emit('error', { message: 'Already voted' }); return; }
  m.votes[socket.id] = choice;
  socket.emit('wb_vote_accepted', {});
}

function revealMatchupResult(room, io) {
  const gs = room.gameState;
  stopTimer(room);
  gs.phase = WB.PHASES.MATCHUP_RESULTS;

  const m = gs.matchups[gs.currentMatchupIndex];
  const isFinalRound = gs.currentRound === WB.ROUNDS_PER_SET - 1;
  const multiplier = isFinalRound ? 2 : 1;
  const { scores, voteCounts, totalVotes } = scoreMatchup(m, multiplier);

  for (const [pid, pts] of Object.entries(scores)) addScore(room, pid, pts);

  const playerNames = m.playerIds.map(pid => {
    const p = room.players.find(pp => pp.id === pid);
    return p ? p.name : 'Unknown';
  });

  const payload = {
    matchupId: m.id,
    prompt: m.prompt,
    answers: m.playerIds.map(pid => m.answers[pid] || '(No answer submitted)'),
    playerNames,
    voteCounts,
    totalVotes,
    scores: m.playerIds.map(pid => scores[pid] || 0),
    isFinalRound,
    standings: getStandings(room)
  };
  io.to(room.code + ':host').emit('wb_matchup_result', payload);
  for (const p of room.players) io.to(p.id).emit('wb_matchup_result', payload);

  setTimeout(() => {
    if (room.activeGameId !== 'wordBudget') return; // safety: game switched while paused
    gs.currentMatchupIndex++;
    gs.phase = WB.PHASES.MATCHUP_VOTE;
    showNextMatchup(room, io);
  }, WB.MATCHUP_RESULTS_PAUSE);
}

function showRoundResults(room, io) {
  const gs = room.gameState;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('wb_round_end', {
    roundNum: gs.currentRound + 1,
    setNum: gs.currentSet + 1,
    standings
  });
  for (const p of room.players) {
    io.to(p.id).emit('wb_round_end', {
      roundNum: gs.currentRound + 1,
      setNum: gs.currentSet + 1,
      standings,
      yourScore: p.score
    });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'wordBudget') return;
    gs.currentRound++;
    if (gs.currentRound < WB.ROUNDS_PER_SET) {
      startRound(room, io);
    } else {
      showSetScores(room, io);
    }
  }, WB.RESULTS_PAUSE);
}

function showSetScores(room, io) {
  const gs = room.gameState;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('wb_set_end', {
    setNum: gs.currentSet + 1,
    standings
  });
  for (const p of room.players) {
    io.to(p.id).emit('wb_set_end', {
      setNum: gs.currentSet + 1,
      standings,
      yourScore: p.score
    });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'wordBudget') return;
    gs.currentSet++;
    if (gs.currentSet < WB.SETS_PER_GAME) {
      gs.currentRound = 0;
      gs.opponentHistory = {};
      startRound(room, io);
    } else {
      showFinalScores(room, io);
    }
  }, WB.SET_SCORES_PAUSE);
}

function showFinalScores(room, io) {
  stopTimer(room);
  const standings = getStandings(room);
  io.to(room.code + ':host').emit('wb_game_end', { finalStandings: standings });
  for (const p of room.players) {
    io.to(p.id).emit('wb_game_end', { finalStandings: standings, yourScore: p.score });
  }
  lobbyManager.onGameEnd(room, io);
}

module.exports = {
  id: 'wordBudget',
  name: 'WORD BUDGET',
  minPlayers: WB.MIN_PLAYERS,
  maxPlayers: 16,
  eventPrefix: 'wb_',
  init,
  handlers: {
    wb_submit_answer: submitAnswer,
    wb_submit_vote: submitVote
  }
};
