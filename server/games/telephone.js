// Telephone — simultaneous rotation model.
//
// At the start of a set, every player gets their own chain and a unique
// prompt. Each round, ALL players write simultaneously; chains rotate
// cyclically so the next round each player receives a different player's
// previous text. The last round is the guess phase: players see the most
// compressed fragment and try to guess the original prompt.
//
// Cyclic rotation: chain index for player position p in round r is
// `(p - r + N) % N`. Total rounds = (rewrite rounds) + 1 (guess).
// As long as total rounds <= N, no player ever receives their own chain.

const path = require('path');
const fs = require('fs');
const { TEL } = require('../../shared/constants');
const { createPromptPool, pickPrompts } = require('../promptPool');
const { startTimer, stopTimer } = require('../timerManager');
const { addScore, getStandings } = require('../scoreManager');
const { shuffle } = require('../matchmaking');
const lobbyManager = require('../lobbyManager');

const promptBank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'telephone_prompts.json'), 'utf8'));

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

// Round configuration based on player count. Cap rewrite rounds at 4 — for
// 6+ players some chains simply won't be touched by every player, which is
// fine and keeps game length bounded.
function roundConfig(N) {
  const wordLimits = TEL.REWRITE_WORD_LIMITS_BY_N[N] || TEL.REWRITE_WORD_LIMITS_BY_N[5];
  const timers = TEL.REWRITE_TIMERS_BY_N[N] || TEL.REWRITE_TIMERS_BY_N[5];
  return {
    rewriteWordLimits: wordLimits,
    rewriteTimers: timers,
    numRewriteRounds: wordLimits.length,
    totalRounds: wordLimits.length + 1 // + guess
  };
}

// chain index assigned to a player position in a given round.
function chainIndexFor(playerPos, round, N) {
  return ((playerPos - round) % N + N) % N;
}

function init(room, io) {
  room.gameState = {
    phase: TEL.PHASES.ASSIGN,
    currentSet: 0,
    totalSets: TEL.SETS_PER_GAME,
    currentRound: 0,
    config: null,             // computed per set when chains assemble
    playerOrder: [],          // [pos] -> playerId, fixed for the duration of a set
    chains: [],
    submittedThisRound: new Set(),
    chainVotes: {},
    promptPool: createPromptPool(promptBank),
    cleanup() { stopTimer(room); },
    onPlayerDisconnect(socketId) {
      // If we're mid-write, mark them as silently submitted so the round can
      // close. Their slot's text gets filled in with [no response] at round
      // end like any other no-show.
      const gs = room.gameState;
      if (!gs) return;
      if (gs.phase === TEL.PHASES.WRITE) {
        gs.submittedThisRound.add(socketId);
        maybeAdvanceRound(room, io);
      }
    }
  };
  beginAssign(room, io);
}

function beginAssign(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.ASSIGN;
  gs.currentRound = 0;
  gs.submittedThisRound = new Set();
  gs.chainVotes = {};

  // Shuffle player positions per set; fresh prompts; fresh chains.
  gs.playerOrder = shuffle(room.players.map(p => p.id));
  const N = gs.playerOrder.length;
  gs.config = roundConfig(N);

  const prompts = pickPrompts(gs.promptPool, N);
  gs.chains = gs.playerOrder.map((pid, i) => {
    const promptObj = prompts[i];
    const text = typeof promptObj === 'string' ? promptObj : (promptObj?.text || 'A vivid scenario');
    return {
      id: `tel_c${gs.currentSet}_${i}`,
      starterId: pid,
      starterName: room.players.find(pp => pp.id === pid)?.name || 'Unknown',
      prompt: text,
      links: [], // each entry: { round, playerId, playerName, wordLimit, text }
      contributorIds: new Set([pid]) // accumulated set; the starter doesn't write Round 1 here, so we'll add them as they touch the chain
    };
  });
  // Note: a chain's "starter" doesn't actually write in round 0 — they describe
  // their *own* prompt. We still want the starter counted as a chain member
  // for scoring. (They are.)

  io.to(room.code + ':host').emit('tel_assign', {
    setNum: gs.currentSet + 1,
    totalSets: gs.totalSets,
    totalRounds: gs.config.totalRounds,
    numRewriteRounds: gs.config.numRewriteRounds,
    chainCount: N,
    players: gs.playerOrder.map(pid => ({
      id: pid, name: room.players.find(p => p.id === pid)?.name || 'Unknown'
    }))
  });
  for (const p of room.players) {
    io.to(p.id).emit('tel_assign', {
      setNum: gs.currentSet + 1,
      totalSets: gs.totalSets,
      totalRounds: gs.config.totalRounds
    });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'telephone' || gs.phase !== TEL.PHASES.ASSIGN) return;
    startRound(room, io);
  }, TEL.ASSIGN_PAUSE);
}

function startRound(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.WRITE;
  gs.submittedThisRound = new Set();

  const N = gs.playerOrder.length;
  const r = gs.currentRound;
  const isGuess = r === gs.config.totalRounds - 1;
  const wordLimit = isGuess ? TEL.GUESS_WORD_LIMIT : gs.config.rewriteWordLimits[r];
  const timer = isGuess ? TEL.GUESS_TIMER : gs.config.rewriteTimers[r];

  // Send each player their per-round payload (which chain they got).
  for (let p = 0; p < N; p++) {
    const playerId = gs.playerOrder[p];
    const chainIdx = chainIndexFor(p, r, N);
    const chain = gs.chains[chainIdx];

    let previousText;
    if (r === 0) {
      previousText = chain.prompt;
    } else {
      previousText = chain.links[r - 1]?.text || '[no response]';
    }

    io.to(playerId).emit('tel_round_start', {
      roundNum: r + 1,
      totalRounds: gs.config.totalRounds,
      isGuess,
      isFirstRound: r === 0,
      previousText,
      wordLimit,
      timer
    });
  }

  io.to(room.code + ':host').emit('tel_round_start', {
    roundNum: r + 1,
    totalRounds: gs.config.totalRounds,
    isGuess,
    wordLimit,
    timer,
    totalPlayers: N
  });
  io.to(room.code + ':host').emit('tel_submission_update', { submitted: 0, total: N });

  startTimer(room, io, timer, () => endRound(room, io));
}

function submitLink(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== TEL.PHASES.WRITE) return;
  if (gs.submittedThisRound.has(socket.id)) {
    socket.emit('error', { message: 'Already submitted' });
    return;
  }
  // Find the player position.
  const p = gs.playerOrder.indexOf(socket.id);
  if (p < 0) return;

  const N = gs.playerOrder.length;
  const r = gs.currentRound;
  const isGuess = r === gs.config.totalRounds - 1;
  const wordLimit = isGuess ? TEL.GUESS_WORD_LIMIT : gs.config.rewriteWordLimits[r];

  const text = (payload && payload.text || '').trim();
  if (!text) { socket.emit('error', { message: 'Write something' }); return; }
  if (countWords(text) > wordLimit) { socket.emit('error', { message: 'Over word limit' }); return; }

  const chainIdx = chainIndexFor(p, r, N);
  const chain = gs.chains[chainIdx];
  const playerName = room.players.find(pp => pp.id === socket.id)?.name || 'Unknown';

  chain.links[r] = {
    round: r,
    playerId: socket.id,
    playerName,
    wordLimit,
    text,
    isGuess
  };
  chain.contributorIds.add(socket.id);
  gs.submittedThisRound.add(socket.id);
  socket.emit('tel_link_accepted', {});

  io.to(room.code + ':host').emit('tel_submission_update', {
    submitted: gs.submittedThisRound.size,
    total: N
  });

  maybeAdvanceRound(room, io);
}

function maybeAdvanceRound(room, io) {
  const gs = room.gameState;
  if (gs.phase !== TEL.PHASES.WRITE) return;
  if (gs.submittedThisRound.size >= gs.playerOrder.length) {
    stopTimer(room);
    endRound(room, io);
  }
}

function endRound(room, io) {
  const gs = room.gameState;
  if (gs.phase !== TEL.PHASES.WRITE) return;
  stopTimer(room);

  const N = gs.playerOrder.length;
  const r = gs.currentRound;
  const isGuess = r === gs.config.totalRounds - 1;
  const wordLimit = isGuess ? TEL.GUESS_WORD_LIMIT : gs.config.rewriteWordLimits[r];

  // Fill in any missing slots.
  for (let p = 0; p < N; p++) {
    const playerId = gs.playerOrder[p];
    if (gs.submittedThisRound.has(playerId)) continue;
    const chainIdx = chainIndexFor(p, r, N);
    const chain = gs.chains[chainIdx];
    const playerName = room.players.find(pp => pp.id === playerId)?.name || 'Unknown';
    chain.links[r] = {
      round: r,
      playerId,
      playerName,
      wordLimit,
      text: '[no response]',
      isGuess
    };
    chain.contributorIds.add(playerId);
  }

  if (gs.currentRound < gs.config.totalRounds - 1) {
    gs.currentRound++;
    startRound(room, io);
  } else {
    beginReveal(room, io);
  }
}

function beginReveal(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.REVEAL;
  gs.revealIdx = 0;

  io.to(room.code + ':host').emit('tel_reveal_begin', { totalChains: gs.chains.length });
  for (const p of room.players) io.to(p.id).emit('tel_reveal_begin', { totalChains: gs.chains.length });

  scheduleNextChainReveal(room, io);
}

function scheduleNextChainReveal(room, io) {
  const gs = room.gameState;
  if (gs.revealIdx >= gs.chains.length) {
    setTimeout(() => beginVote(room, io), TEL.REVEAL_INTER_CHAIN_PAUSE);
    return;
  }
  const chain = gs.chains[gs.revealIdx];
  // Split the chain's links into rewrite + guess (last link is the guess).
  const rewriteLinks = chain.links.slice(0, gs.config.numRewriteRounds);
  const guessLink = chain.links[gs.config.totalRounds - 1] || null;

  const payload = {
    chainIndex: gs.revealIdx,
    totalChains: gs.chains.length,
    chainId: chain.id,
    starterName: chain.starterName,
    prompt: chain.prompt,
    links: rewriteLinks.map(l => ({
      playerName: l.playerName,
      text: l.text,
      wordLimit: l.wordLimit
    })),
    guess: guessLink
      ? { playerName: guessLink.playerName, text: guessLink.text }
      : null
  };
  io.to(room.code + ':host').emit('tel_reveal_chain', payload);
  for (const p of room.players) io.to(p.id).emit('tel_reveal_chain', payload);

  // Server schedules the next chain after estimated client animation time.
  // Client staggers each card by REVEAL_LINK_PAUSE (2s); we add a guess pause + inter-chain pause.
  const cardCount = 1 + rewriteLinks.length + (guessLink ? 1 : 0); // prompt + rewrites + guess
  const duration = cardCount * TEL.REVEAL_LINK_PAUSE + TEL.REVEAL_INTER_CHAIN_PAUSE;
  gs._revealTimeout = setTimeout(() => {
    gs.revealIdx++;
    scheduleNextChainReveal(room, io);
  }, duration);
}

function beginVote(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.VOTE;
  gs.chainVotes = {};

  const summaries = gs.chains.map(c => {
    const lastRewrite = c.links[gs.config.numRewriteRounds - 1]?.text || '';
    const guess = c.links[gs.config.totalRounds - 1]?.text || '';
    return {
      id: c.id,
      prompt: c.prompt,
      finalLinkText: lastRewrite,
      guess
    };
  });
  const payload = { chains: summaries, timer: TEL.VOTE_TIMER };
  io.to(room.code + ':host').emit('tel_vote_phase', payload);
  for (const p of room.players) io.to(p.id).emit('tel_vote_phase', payload);

  startTimer(room, io, TEL.VOTE_TIMER, () => endVote(room, io));
}

function submitVote(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== TEL.PHASES.VOTE) return;
  const chainId = payload && payload.chainId;
  if (!gs.chains.some(c => c.id === chainId)) return;
  if (gs.chainVotes[socket.id]) { socket.emit('error', { message: 'Already voted' }); return; }
  gs.chainVotes[socket.id] = chainId;
  socket.emit('tel_vote_accepted', {});
  if (Object.keys(gs.chainVotes).length >= room.players.length) {
    stopTimer(room);
    endVote(room, io);
  }
}

function endVote(room, io) {
  const gs = room.gameState;
  if (gs.phase !== TEL.PHASES.VOTE) return;
  stopTimer(room);

  const counts = {};
  for (const cid of Object.values(gs.chainVotes)) counts[cid] = (counts[cid] || 0) + 1;
  for (const c of gs.chains) if (counts[c.id] === undefined) counts[c.id] = 0;

  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  let maxVotes = 0;
  for (const v of Object.values(counts)) if (v > maxVotes) maxVotes = v;

  const winners = gs.chains.filter(c => counts[c.id] === maxVotes && maxVotes > 0);
  const isShutout = winners.length === 1 && totalVotes > 0 && counts[winners[0].id] === totalVotes;

  for (const w of winners) {
    const points = isShutout ? TEL.SHUTOUT_POINTS : TEL.WIN_POINTS;
    for (const memberId of w.contributorIds) addScore(room, memberId, points);
  }

  const standings = getStandings(room);
  const payload = {
    chains: gs.chains.map(c => {
      const lastRewrite = c.links[gs.config.numRewriteRounds - 1]?.text || '';
      const guess = c.links[gs.config.totalRounds - 1]?.text || '';
      return {
        id: c.id,
        prompt: c.prompt,
        finalLinkText: lastRewrite,
        guess,
        votes: counts[c.id] || 0,
        isWinner: winners.some(w => w.id === c.id),
        isShutout: isShutout && winners[0]?.id === c.id,
        memberIds: [...c.contributorIds],
        memberNames: [...c.contributorIds].map(id =>
          room.players.find(p => p.id === id)?.name || 'Unknown'
        )
      };
    }),
    setNum: gs.currentSet + 1,
    totalSets: gs.totalSets,
    standings
  };
  io.to(room.code + ':host').emit('tel_set_end', payload);
  for (const p of room.players) {
    io.to(p.id).emit('tel_set_end', { ...payload, yourScore: p.score });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'telephone') return;
    gs.currentSet++;
    if (gs.currentSet < gs.totalSets) beginAssign(room, io);
    else showFinalScores(room, io);
  }, TEL.SET_END_PAUSE);
}

function showFinalScores(room, io) {
  stopTimer(room);
  const standings = getStandings(room);
  io.to(room.code + ':host').emit('tel_game_end', { finalStandings: standings });
  for (const p of room.players) {
    io.to(p.id).emit('tel_game_end', { finalStandings: standings, yourScore: p.score });
  }
  lobbyManager.onGameEnd(room, io);
}

module.exports = {
  id: 'telephone',
  name: 'TELEPHONE',
  minPlayers: TEL.MIN_PLAYERS,
  maxPlayers: TEL.MAX_PLAYERS,
  eventPrefix: 'tel_',
  init,
  handlers: {
    tel_submit_link: submitLink,   // also used for the guess round (last round)
    tel_submit_vote: submitVote
  }
};
