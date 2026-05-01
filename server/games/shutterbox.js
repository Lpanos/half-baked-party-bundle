const path = require('path');
const fs = require('fs');
const { SB } = require('../../shared/constants');
const { createPromptPool, pickPrompts } = require('../promptPool');
const { startTimer, stopTimer } = require('../timerManager');
const { getStandings, addScore } = require('../scoreManager');
const { shuffle } = require('../matchmaking');
const lines = require('../data/shutterboxHostLines');
const lobbyManager = require('../lobbyManager');

const promptData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'shutterbox_prompts.json'), 'utf8'));
// Shutterbox prompts are wrapped: { prompts: [{ id, text, final_eligible }, ...] }.
const promptBank = Array.isArray(promptData) ? promptData : (promptData.prompts || []);

const ROUND_INTRO_PAUSE = 4500; // ms — host shows the FLASH line then auto-advances to submission

function init(room, io) {
  room.gameState = {
    phase: SB.PHASES.ROUND_INTRO,
    round: 1,
    totalRounds: SB.ROUNDS,
    matchups: [],
    currentMatchupIndex: 0,
    submissions: new Map(),       // matchupId -> Map(playerId -> imageData)
    votes: new Map(),              // matchupId -> Map(voterId -> votedForId)
    sittingOut: null,
    promptPool: createPromptPool(promptBank),
    finalPrompt: null,
    finalSubmissions: new Map(),  // playerId -> imageData
    finalVotes: new Map(),         // voterId -> votedForId
    settings: { submitTime: SB.SUBMIT_TIME, voteTime: SB.VOTE_TIME, finalVoteTime: SB.FINAL_VOTE_TIME },
    cleanup() { stopTimer(room); },
    onPlayerDisconnect(socketId) {
      // No reconnection support; submissions/votes from this player simply vanish.
    }
  };
  beginRoundIntro(room, io);
}

function beginRoundIntro(room, io) {
  const gs = room.gameState;
  gs.phase = SB.PHASES.ROUND_INTRO;
  const isFirst = gs.round === 1;
  const hostLine = isFirst ? lines.getGameStartLine() : lines.getRoundIntroLine(gs.round);
  const payload = {
    round: gs.round,
    totalRounds: gs.totalRounds,
    isFirst,
    hostLine
  };
  io.to(room.code + ':host').emit('sb_round_intro', payload);
  for (const p of room.players) io.to(p.id).emit('sb_round_intro', payload);

  setTimeout(() => {
    if (room.activeGameId !== 'shutterbox' || gs.phase !== SB.PHASES.ROUND_INTRO) return;
    startSubmissionPhase(room, io);
  }, ROUND_INTRO_PAUSE);
}

function startSubmissionPhase(room, io) {
  const gs = room.gameState;
  if (gs.round <= 2) {
    // Head-to-head pair matchups; one player sits out on odd headcount.
    const ids = shuffle(room.players.map(p => p.id));
    gs.sittingOut = null;
    if (ids.length % 2 !== 0) gs.sittingOut = ids.pop();

    const pairCount = Math.floor(ids.length / 2);
    const prompts = pickPrompts(gs.promptPool, pairCount);

    gs.matchups = [];
    gs.submissions = new Map();
    gs.votes = new Map();
    for (let i = 0; i < pairCount; i++) {
      const m = {
        id: `sb_r${gs.round}_m${i}`,
        prompt: typeof prompts[i] === 'string' ? prompts[i] : prompts[i]?.text || 'Show us your best photo!',
        player1: ids[i * 2],
        player2: ids[i * 2 + 1]
      };
      gs.matchups.push(m);
      gs.submissions.set(m.id, new Map());
      gs.votes.set(m.id, new Map());
    }

    gs.phase = SB.PHASES.SUBMITTING;
    gs.currentMatchupIndex = 0;

    // Send each player their prompt.
    for (const m of gs.matchups) {
      io.to(m.player1).emit('sb_prompt_assigned', { matchupId: m.id, prompt: m.prompt, timeLimit: gs.settings.submitTime });
      io.to(m.player2).emit('sb_prompt_assigned', { matchupId: m.id, prompt: m.prompt, timeLimit: gs.settings.submitTime });
    }
    if (gs.sittingOut) {
      io.to(gs.sittingOut).emit('sb_sitting_out', { timeLimit: gs.settings.submitTime });
    }

    io.to(room.code + ':host').emit('sb_submission_phase', {
      round: gs.round,
      timeLimit: gs.settings.submitTime,
      playerCount: room.players.length,
      matchupCount: gs.matchups.length,
      sittingOutId: gs.sittingOut
    });

    emitSubmissionUpdate(room, io);
    startTimer(room, io, gs.settings.submitTime, () => endSubmissionPhase(room, io));
  } else {
    setupFinalRound(room, io);
  }
}

function emitSubmissionUpdate(room, io) {
  const gs = room.gameState;
  let submitted = 0;
  const total = gs.matchups.length * 2;
  for (const subs of gs.submissions.values()) submitted += subs.size;
  io.to(room.code + ':host').emit('sb_submission_update', { submitted, total });
}

function emitFinalSubmissionUpdate(room, io) {
  const gs = room.gameState;
  io.to(room.code + ':host').emit('sb_submission_update', {
    submitted: gs.finalSubmissions.size,
    total: room.players.length
  });
}

function submitPhoto(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs) return;
  const imageData = payload && payload.imageData;
  if (typeof imageData !== 'string' || !imageData.startsWith('data:image')) {
    socket.emit('error', { message: 'Invalid photo data' });
    return;
  }

  if (gs.phase === SB.PHASES.SUBMITTING) {
    const m = gs.matchups.find(mm => mm.player1 === socket.id || mm.player2 === socket.id);
    if (!m) return;
    const subs = gs.submissions.get(m.id);
    subs.set(socket.id, imageData);
    socket.emit('sb_photo_accepted', {});
    emitSubmissionUpdate(room, io);
    // Early advance if all photos in.
    let total = 0;
    for (const ss of gs.submissions.values()) total += ss.size;
    if (total >= gs.matchups.length * 2) {
      stopTimer(room);
      endSubmissionPhase(room, io);
    }
  } else if (gs.phase === SB.PHASES.FINAL_SUBMITTING) {
    if (!room.players.some(p => p.id === socket.id)) return;
    gs.finalSubmissions.set(socket.id, imageData);
    socket.emit('sb_photo_accepted', {});
    emitFinalSubmissionUpdate(room, io);
    if (gs.finalSubmissions.size >= room.players.length) {
      stopTimer(room);
      endFinalSubmissionPhase(room, io);
    }
  }
}

function endSubmissionPhase(room, io) {
  const gs = room.gameState;
  if (gs.phase !== SB.PHASES.SUBMITTING) return;
  stopTimer(room);
  gs.phase = SB.PHASES.REVEALING;
  gs.currentMatchupIndex = 0;
  revealMatchup(room, io);
}

function revealMatchup(room, io) {
  const gs = room.gameState;
  const m = gs.matchups[gs.currentMatchupIndex];
  if (!m) return;
  const subs = gs.submissions.get(m.id);
  const p1 = room.players.find(pp => pp.id === m.player1);
  const p2 = room.players.find(pp => pp.id === m.player2);

  io.to(room.code + ':host').emit('sb_matchup_reveal', {
    matchupId: m.id,
    prompt: m.prompt,
    player1: { id: m.player1, name: p1?.name || 'Unknown', image: subs?.get(m.player1) || null },
    player2: { id: m.player2, name: p2?.name || 'Unknown', image: subs?.get(m.player2) || null },
    matchupNumber: gs.currentMatchupIndex + 1,
    totalMatchups: gs.matchups.length,
    hostLine: lines.getMatchupTeaseLine()
  });

  setTimeout(() => {
    if (room.activeGameId !== 'shutterbox' || gs.phase !== SB.PHASES.REVEALING) return;
    gs.phase = SB.PHASES.VOTING;

    io.to(room.code + ':host').emit('sb_vote_phase', {
      matchupId: m.id,
      timeLimit: gs.settings.voteTime,
      player1Id: m.player1,
      player2Id: m.player2
    });
    // Players get the same plus their own role.
    for (const p of room.players) {
      const isParticipant = p.id === m.player1 || p.id === m.player2;
      io.to(p.id).emit('sb_vote_phase', {
        matchupId: m.id,
        prompt: m.prompt,
        timeLimit: gs.settings.voteTime,
        player1: { id: m.player1, name: room.players.find(pp => pp.id === m.player1)?.name, image: subs?.get(m.player1) || null },
        player2: { id: m.player2, name: room.players.find(pp => pp.id === m.player2)?.name, image: subs?.get(m.player2) || null },
        canVote: !isParticipant
      });
    }
    startTimer(room, io, gs.settings.voteTime, () => endVotePhase(room, io));
  }, 3000);
}

function castVote(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs) return;
  if (gs.phase === SB.PHASES.VOTING) {
    const m = gs.matchups[gs.currentMatchupIndex];
    if (!m) return;
    if (socket.id === m.player1 || socket.id === m.player2) return; // can't vote own
    const votedFor = payload && payload.votedForId;
    if (votedFor !== m.player1 && votedFor !== m.player2) return;
    const votes = gs.votes.get(m.id);
    if (votes.has(socket.id)) { socket.emit('error', { message: 'Already voted' }); return; }
    votes.set(socket.id, votedFor);
    socket.emit('sb_vote_accepted', {});
  } else if (gs.phase === SB.PHASES.FINAL_VOTING) {
    const votedFor = payload && payload.votedForId;
    if (socket.id === votedFor) return; // no self-vote
    if (!room.players.some(p => p.id === votedFor)) return;
    if (gs.finalVotes.has(socket.id)) { socket.emit('error', { message: 'Already voted' }); return; }
    gs.finalVotes.set(socket.id, votedFor);
    socket.emit('sb_vote_accepted', {});
  }
}

function endVotePhase(room, io) {
  const gs = room.gameState;
  if (gs.phase !== SB.PHASES.VOTING) return;
  stopTimer(room);
  gs.phase = SB.PHASES.RESULT;

  const m = gs.matchups[gs.currentMatchupIndex];
  const votes = gs.votes.get(m.id);
  const subs = gs.submissions.get(m.id);
  const p1 = room.players.find(pp => pp.id === m.player1);
  const p2 = room.players.find(pp => pp.id === m.player2);
  const p1Image = subs?.get(m.player1);
  const p2Image = subs?.get(m.player2);

  let p1Votes = 0, p2Votes = 0;
  if (!p1Image && p2Image) {
    p2Votes = Math.max(votes.size, 1);
  } else if (p1Image && !p2Image) {
    p1Votes = Math.max(votes.size, 1);
  } else {
    for (const target of votes.values()) {
      if (target === m.player1) p1Votes++;
      else if (target === m.player2) p2Votes++;
    }
  }
  const totalVotes = p1Votes + p2Votes;
  const p1Pct = totalVotes > 0 ? Math.round((p1Votes / totalVotes) * 100) : 50;
  const p2Pct = totalVotes > 0 ? 100 - p1Pct : 50;

  let p1Points = p1Votes * 100;
  let p2Points = p2Votes * 100;
  const isShutout = totalVotes > 0 && (p1Votes === 0 || p2Votes === 0);
  if (isShutout) {
    if (p1Votes > 0) p1Points += 500;
    else p2Points += 500;
  }
  addScore(room, m.player1, p1Points);
  addScore(room, m.player2, p2Points);

  const winnerName = p1Pct >= p2Pct ? (p1?.name || 'P1') : (p2?.name || 'P2');
  const loserName  = p1Pct >= p2Pct ? (p2?.name || 'P2') : (p1?.name || 'P1');
  const winnerPct  = Math.max(p1Pct, p2Pct);
  const hostLine = lines.getVoteResultLine({ winnerName, loserName, winnerPct, isShutout });

  const result = {
    matchupId: m.id,
    prompt: m.prompt,
    player1: { id: m.player1, name: p1?.name || 'P1', image: p1Image, votes: p1Votes, pct: p1Pct, points: p1Points },
    player2: { id: m.player2, name: p2?.name || 'P2', image: p2Image, votes: p2Votes, pct: p2Pct, points: p2Points },
    isShutout,
    hostLine
  };
  io.to(room.code + ':host').emit('sb_vote_result', result);
  for (const p of room.players) io.to(p.id).emit('sb_vote_result', result);
}

// Host-paced advance (clicked SPACE / NEXT on host).
function hostNext(room, socket, payload, io) {
  if (!room.hostId || room.hostId !== socket.id) return;
  const gs = room.gameState;
  if (!gs) return;
  if (gs.phase === SB.PHASES.RESULT) {
    gs.currentMatchupIndex++;
    if (gs.currentMatchupIndex < gs.matchups.length) {
      gs.phase = SB.PHASES.REVEALING;
      revealMatchup(room, io);
    } else {
      showScoreboard(room, io);
    }
  } else if (gs.phase === SB.PHASES.SCOREBOARD) {
    gs.round++;
    beginRoundIntro(room, io);
  } else if (gs.phase === SB.PHASES.FINAL_RESULTS) {
    showGameOver(room, io);
  }
}

function showScoreboard(room, io) {
  const gs = room.gameState;
  gs.phase = SB.PHASES.SCOREBOARD;
  const scores = getStandings(room);
  const payload = {
    scores,
    round: gs.round,
    totalRounds: gs.totalRounds
  };
  io.to(room.code + ':host').emit('sb_scoreboard', payload);
  for (const p of room.players) io.to(p.id).emit('sb_scoreboard', payload);
}

function setupFinalRound(room, io) {
  const gs = room.gameState;
  // Try to pick a final-eligible prompt; fall back if none.
  const finalPrompts = pickPrompts(gs.promptPool, 1, p =>
    typeof p === 'object' && p && p.final_eligible === true
  );
  const chosen = finalPrompts[0];
  gs.finalPrompt = typeof chosen === 'string' ? chosen : (chosen?.text || 'Show us your absolute best photo!');
  gs.finalSubmissions = new Map();
  gs.finalVotes = new Map();
  gs.phase = SB.PHASES.FINAL_SUBMITTING;

  const payload = {
    prompt: gs.finalPrompt,
    timeLimit: gs.settings.submitTime,
    hostLine: lines.getFinalIntroLine()
  };
  io.to(room.code + ':host').emit('sb_final_round_start', payload);
  for (const p of room.players) io.to(p.id).emit('sb_final_round_start', payload);

  emitFinalSubmissionUpdate(room, io);
  startTimer(room, io, gs.settings.submitTime, () => endFinalSubmissionPhase(room, io));
}

function endFinalSubmissionPhase(room, io) {
  const gs = room.gameState;
  if (gs.phase !== SB.PHASES.FINAL_SUBMITTING) return;
  stopTimer(room);
  gs.phase = SB.PHASES.FINAL_VOTING;

  const photos = [];
  for (const [pid, image] of gs.finalSubmissions) {
    const p = room.players.find(pp => pp.id === pid);
    photos.push({ playerId: pid, playerName: p?.name || 'Unknown', image });
  }

  const payload = {
    prompt: gs.finalPrompt,
    photos,
    timeLimit: gs.settings.finalVoteTime
  };
  io.to(room.code + ':host').emit('sb_final_reveal', payload);
  for (const p of room.players) io.to(p.id).emit('sb_final_reveal', payload);

  startTimer(room, io, gs.settings.finalVoteTime, () => endFinalVotePhase(room, io));
}

function endFinalVotePhase(room, io) {
  const gs = room.gameState;
  if (gs.phase !== SB.PHASES.FINAL_VOTING) return;
  stopTimer(room);
  gs.phase = SB.PHASES.FINAL_RESULTS;

  const voteCounts = new Map();
  for (const pid of room.players.map(p => p.id)) voteCounts.set(pid, 0);
  for (const target of gs.finalVotes.values()) {
    voteCounts.set(target, (voteCounts.get(target) || 0) + 1);
  }

  const rankings = room.players.map(p => ({
    playerId: p.id,
    name: p.name,
    votes: voteCounts.get(p.id) || 0,
    image: gs.finalSubmissions.get(p.id) || null
  })).sort((a, b) => b.votes - a.votes);

  const tiers = [2000, 1000, 500];
  rankings.forEach((r, i) => {
    const pts = i < 3 ? tiers[i] : 100;
    r.points = pts;
    addScore(room, r.playerId, pts);
  });

  const payload = {
    rankings,
    hostLine: lines.getFinalResultLine()
  };
  io.to(room.code + ':host').emit('sb_final_results', payload);
  for (const p of room.players) io.to(p.id).emit('sb_final_results', payload);
}

function showGameOver(room, io) {
  const gs = room.gameState;
  stopTimer(room);
  const scores = getStandings(room);
  const winner = scores[0] || { name: 'Nobody', score: 0 };
  const payload = {
    finalStandings: scores,
    winner,
    hostLine: lines.getGameOverLine({ winnerName: winner.name, score: winner.score })
  };
  io.to(room.code + ':host').emit('sb_game_end', payload);
  for (const p of room.players) {
    io.to(p.id).emit('sb_game_end', { ...payload, yourScore: p.score });
  }
  lobbyManager.onGameEnd(room, io);
}

module.exports = {
  id: 'shutterbox',
  name: 'SHUTTERBOX',
  minPlayers: SB.MIN_PLAYERS,
  maxPlayers: SB.MAX_PLAYERS,
  eventPrefix: 'sb_',
  init,
  handlers: {
    sb_submit_photo: submitPhoto,
    sb_cast_vote: castVote,
    sb_host_next: hostNext
  }
};
