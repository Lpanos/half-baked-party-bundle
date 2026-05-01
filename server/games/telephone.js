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

// Distribute N players into chains of length [3, 5]. Aim for 4-5; allow 3 only
// when no other split works. Single chain when N <= 5.
function chainLengths(N) {
  if (N <= 5) return [N];
  let chains = Math.ceil(N / 5);
  // tighten until min/max are within [3, 5]
  for (let safety = 0; safety < 8; safety++) {
    const minLen = Math.floor(N / chains);
    const maxLen = Math.ceil(N / chains);
    if (minLen >= 3 && maxLen <= 5) break;
    if (maxLen > 5) chains++;
    else if (minLen < 3) chains--;
    else break;
  }
  chains = Math.max(1, chains);
  const lengths = [];
  let remaining = N;
  for (let i = 0; i < chains; i++) {
    const remainingChains = chains - i;
    const len = Math.ceil(remaining / remainingChains);
    lengths.push(len);
    remaining -= len;
  }
  return lengths;
}

function clearChainTimer(chain) {
  if (chain._timer) { clearInterval(chain._timer); chain._timer = null; }
  if (chain._timeout) { clearTimeout(chain._timeout); chain._timeout = null; }
}

function startChainTimer(chain, room, io, seconds, onExpire) {
  clearChainTimer(chain);
  let remaining = seconds;
  const tick = () => {
    const activeLink = chain.links[chain.activeIdx];
    const activePid = activeLink?.playerId;
    if (activePid) io.to(activePid).emit('tel_link_timer', { secondsLeft: remaining });
    io.to(room.code + ':host').emit('tel_chain_tick', {
      chainId: chain.id,
      secondsLeft: remaining,
      activeLinkIndex: chain.activeIdx,
      totalLinks: chain.links.length
    });
    if (remaining <= 0) {
      clearChainTimer(chain);
      onExpire();
      return;
    }
    remaining--;
  };
  tick();
  chain._timer = setInterval(tick, 1000);
}

function init(room, io) {
  room.gameState = {
    phase: TEL.PHASES.ASSIGN,
    currentSet: 0,
    totalSets: TEL.SETS_PER_GAME,
    chains: [],
    chainsRevealed: 0,
    promptPool: createPromptPool(promptBank),
    chainVotes: {}, // voterId -> chainId for current set
    cleanup() {
      for (const c of room.gameState.chains || []) clearChainTimer(c);
      stopTimer(room);
    },
    onPlayerDisconnect(socketId) {
      // If the disconnected player was the active link in any chain, force-advance
      // that chain by submitting "[no response]".
      const gs = room.gameState;
      if (!gs || !gs.chains) return;
      for (const chain of gs.chains) {
        if (chain.completed) continue;
        const active = chain.links[chain.activeIdx];
        if (active && active.playerId === socketId && !active.submitted) {
          active.text = '[no response]';
          active.submitted = true;
          clearChainTimer(chain);
          advanceChain(chain, room, io);
        }
        // If they had a guess pending, fill that in too.
        if (chain.completed && chain.guess && chain.guess.playerId === socketId && !chain.guess.submitted) {
          chain.guess.text = '[no response]';
          chain.guess.submitted = true;
          chain._guessTimeout && clearTimeout(chain._guessTimeout);
          maybeBeginReveal(room, io);
        }
      }
    }
  };
  beginAssign(room, io);
}

function beginAssign(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.ASSIGN;
  gs.chains = [];
  gs.chainsRevealed = 0;
  gs.chainVotes = {};

  const ids = shuffle(room.players.map(p => p.id));
  const lengths = chainLengths(ids.length);
  const chains = [];
  let cursor = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    const playerIds = ids.slice(cursor, cursor + len);
    cursor += len;
    const promptObj = pickPrompts(gs.promptPool, 1)[0];
    const prompt = typeof promptObj === 'string' ? promptObj : (promptObj?.text || 'Describe a scene');
    const limits = TEL.WORD_LIMITS[len];
    const timers = TEL.WRITE_TIMERS[len];
    const links = playerIds.map((pid, idx) => ({
      playerId: pid,
      playerName: room.players.find(p => p.id === pid)?.name || 'Unknown',
      wordLimit: limits[idx],
      timerSec: timers[idx],
      text: '',
      submitted: false
    }));
    chains.push({
      id: `tel_c${gs.currentSet}_${i}`,
      prompt,
      links,
      activeIdx: 0,
      completed: false,
      guess: null,
      _timer: null,
      _timeout: null
    });
  }
  gs.chains = chains;

  const summary = {
    setNum: gs.currentSet + 1,
    totalSets: gs.totalSets,
    chains: chains.map(c => ({ id: c.id, length: c.links.length, players: c.links.map(l => ({ id: l.playerId, name: l.playerName })) }))
  };
  io.to(room.code + ':host').emit('tel_assign', summary);
  for (const p of room.players) {
    const chain = chains.find(c => c.links.some(l => l.playerId === p.id));
    const position = chain ? chain.links.findIndex(l => l.playerId === p.id) + 1 : 0;
    io.to(p.id).emit('tel_assign', {
      setNum: gs.currentSet + 1,
      totalSets: gs.totalSets,
      chainLength: chain ? chain.links.length : 0,
      yourPosition: position
    });
  }

  setTimeout(() => {
    if (room.activeGameId !== 'telephone' || gs.phase !== TEL.PHASES.ASSIGN) return;
    beginWrite(room, io);
  }, TEL.ASSIGN_PAUSE);
}

function beginWrite(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.WRITE;
  for (const chain of gs.chains) startChainLink(chain, room, io);
  emitChainProgress(room, io);
}

function emitChainProgress(room, io) {
  const gs = room.gameState;
  io.to(room.code + ':host').emit('tel_chain_progress', {
    chains: gs.chains.map(c => ({
      id: c.id,
      totalLinks: c.links.length,
      activeLinkIndex: c.completed ? c.links.length : c.activeIdx,
      completed: c.completed,
      hasGuess: !!c.guess && c.guess.submitted,
      guessPending: !!c.guess && !c.guess.submitted
    }))
  });
}

function startChainLink(chain, room, io) {
  const link = chain.links[chain.activeIdx];
  if (!link) { startGuessPhase(chain, room, io); return; }

  const previousText = chain.activeIdx === 0
    ? chain.prompt
    : chain.links[chain.activeIdx - 1].text;

  // Active player: full your-turn payload.
  io.to(link.playerId).emit('tel_your_turn', {
    chainId: chain.id,
    linkIndex: chain.activeIdx,
    totalLinks: chain.links.length,
    isFirstLink: chain.activeIdx === 0,
    previousText,
    wordLimit: link.wordLimit,
    timer: link.timerSec
  });

  // Other players in the chain: show waiting screen.
  for (const otherLink of chain.links) {
    if (otherLink.playerId === link.playerId) continue;
    const otherIdx = chain.links.findIndex(l => l.playerId === otherLink.playerId);
    const reason = otherLink.submitted ? 'submitted' : 'pending';
    io.to(otherLink.playerId).emit('tel_waiting', {
      chainId: chain.id,
      reason,
      yourPosition: otherIdx + 1,
      totalLinks: chain.links.length,
      activeLinkIndex: chain.activeIdx
    });
  }

  startChainTimer(chain, room, io, link.timerSec, () => {
    if (link.submitted) return;
    link.text = '[no response]';
    link.submitted = true;
    advanceChain(chain, room, io);
  });
}

function submitLink(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== TEL.PHASES.WRITE) return;
  const chain = gs.chains.find(c => c.links[c.activeIdx]?.playerId === socket.id);
  if (!chain) { socket.emit('error', { message: 'Not your turn' }); return; }
  const link = chain.links[chain.activeIdx];
  if (link.submitted) { socket.emit('error', { message: 'Already submitted' }); return; }

  const text = (payload && payload.text || '').trim();
  if (!text) { socket.emit('error', { message: 'Write something' }); return; }
  if (countWords(text) > link.wordLimit) { socket.emit('error', { message: 'Over word limit' }); return; }

  link.text = text;
  link.submitted = true;
  socket.emit('tel_link_accepted', {});
  clearChainTimer(chain);
  advanceChain(chain, room, io);
}

function advanceChain(chain, room, io) {
  // Move to next link OR start the guess phase.
  if (chain.activeIdx < chain.links.length - 1) {
    chain.activeIdx++;
    startChainLink(chain, room, io);
    emitChainProgress(room, io);
  } else {
    // Last link is done. Move to guess phase for THIS chain.
    startGuessPhase(chain, room, io);
  }
}

function startGuessPhase(chain, room, io) {
  // The last player in the chain guesses the original prompt.
  const lastLink = chain.links[chain.links.length - 1];
  chain.guess = {
    playerId: lastLink.playerId,
    playerName: lastLink.playerName,
    text: '',
    submitted: false
  };

  // Tell the guesser their new task.
  io.to(lastLink.playerId).emit('tel_guess_phase', {
    chainId: chain.id,
    finalText: lastLink.text,
    wordLimit: TEL.GUESS_WORD_LIMIT,
    timer: TEL.GUESS_TIMER
  });
  // Tell other chain members this chain is in guess phase.
  for (const l of chain.links) {
    if (l.playerId === lastLink.playerId) continue;
    io.to(l.playerId).emit('tel_waiting', {
      chainId: chain.id,
      reason: 'submitted',
      yourPosition: chain.links.findIndex(x => x.playerId === l.playerId) + 1,
      totalLinks: chain.links.length,
      activeLinkIndex: chain.links.length, // past the end
      guessPending: true
    });
  }

  emitChainProgress(room, io);

  // Per-chain guess timer (server-side timeout).
  let remaining = TEL.GUESS_TIMER;
  io.to(lastLink.playerId).emit('tel_link_timer', { secondsLeft: remaining });
  chain._timer = setInterval(() => {
    remaining--;
    io.to(lastLink.playerId).emit('tel_link_timer', { secondsLeft: remaining });
    io.to(room.code + ':host').emit('tel_chain_tick', {
      chainId: chain.id, secondsLeft: remaining,
      activeLinkIndex: chain.links.length,
      totalLinks: chain.links.length
    });
    if (remaining <= 0) {
      clearChainTimer(chain);
      if (!chain.guess.submitted) {
        chain.guess.text = '[no response]';
        chain.guess.submitted = true;
      }
      chain.completed = true;
      emitChainProgress(room, io);
      maybeBeginReveal(room, io);
    }
  }, 1000);
}

function submitGuess(room, socket, payload, io) {
  const gs = room.gameState;
  if (!gs) return;
  // Find a chain that's awaiting a guess from this socket.
  const chain = gs.chains.find(c => c.guess && c.guess.playerId === socket.id && !c.guess.submitted);
  if (!chain) return;

  const text = (payload && payload.text || '').trim();
  if (!text) { socket.emit('error', { message: 'Write a guess' }); return; }
  if (countWords(text) > TEL.GUESS_WORD_LIMIT) { socket.emit('error', { message: 'Over word limit' }); return; }

  chain.guess.text = text;
  chain.guess.submitted = true;
  chain.completed = true;
  socket.emit('tel_guess_accepted', {});
  clearChainTimer(chain);
  emitChainProgress(room, io);
  maybeBeginReveal(room, io);
}

function maybeBeginReveal(room, io) {
  const gs = room.gameState;
  if (gs.phase === TEL.PHASES.REVEAL || gs.phase === TEL.PHASES.VOTE) return;
  if (!gs.chains.every(c => c.completed)) return;
  beginReveal(room, io);
}

function beginReveal(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.REVEAL;
  gs.chainsRevealed = 0;

  // Tell everyone we are entering reveal mode (so phones can switch to a
  // "watching reveal" screen that mirrors the host).
  io.to(room.code + ':host').emit('tel_reveal_begin', { totalChains: gs.chains.length });
  for (const p of room.players) io.to(p.id).emit('tel_reveal_begin', { totalChains: gs.chains.length });

  scheduleNextChainReveal(room, io);
}

function scheduleNextChainReveal(room, io) {
  const gs = room.gameState;
  if (gs.chainsRevealed >= gs.chains.length) {
    setTimeout(() => beginVote(room, io), TEL.REVEAL_INTER_CHAIN_PAUSE);
    return;
  }
  const chain = gs.chains[gs.chainsRevealed];
  const payload = {
    chainIndex: gs.chainsRevealed,
    totalChains: gs.chains.length,
    chainId: chain.id,
    prompt: chain.prompt,
    links: chain.links.map(l => ({ playerName: l.playerName, text: l.text, wordLimit: l.wordLimit })),
    guess: chain.guess
      ? { playerName: chain.guess.playerName, text: chain.guess.text }
      : null
  };
  io.to(room.code + ':host').emit('tel_reveal_chain', payload);
  for (const p of room.players) io.to(p.id).emit('tel_reveal_chain', payload);

  // Estimate animation duration: prompt reveal + N link reveals + guess + post-pause.
  const linkCount = chain.links.length;
  const duration =
    TEL.REVEAL_LINK_PAUSE +              // prompt
    linkCount * TEL.REVEAL_LINK_PAUSE +  // links
    TEL.REVEAL_GUESS_PAUSE +             // guess hold
    TEL.REVEAL_INTER_CHAIN_PAUSE;        // pause between chains
  gs.chains[gs.chainsRevealed]._timeout = setTimeout(() => {
    gs.chainsRevealed++;
    scheduleNextChainReveal(room, io);
  }, duration);
}

function beginVote(room, io) {
  const gs = room.gameState;
  gs.phase = TEL.PHASES.VOTE;
  gs.chainVotes = {};

  const summaries = gs.chains.map(c => ({
    id: c.id,
    prompt: c.prompt,
    finalLinkText: c.links[c.links.length - 1]?.text || '',
    guess: c.guess?.text || ''
  }));
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

  // Early advance if everyone voted.
  if (Object.keys(gs.chainVotes).length >= room.players.length) {
    stopTimer(room);
    endVote(room, io);
  }
}

function endVote(room, io) {
  const gs = room.gameState;
  if (gs.phase !== TEL.PHASES.VOTE) return;
  stopTimer(room);

  // Tally.
  const counts = {};
  for (const cid of Object.values(gs.chainVotes)) counts[cid] = (counts[cid] || 0) + 1;
  for (const c of gs.chains) if (counts[c.id] === undefined) counts[c.id] = 0;

  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  let maxVotes = 0;
  for (const v of Object.values(counts)) if (v > maxVotes) maxVotes = v;

  const winners = gs.chains.filter(c => counts[c.id] === maxVotes && maxVotes > 0);
  // Shutout = single chain has 100% of cast votes (and at least one vote).
  const isShutout = winners.length === 1 && totalVotes > 0 && winners[0] && counts[winners[0].id] === totalVotes;

  // Award points.
  const awardedTo = new Set();
  for (const w of winners) {
    const points = isShutout ? TEL.SHUTOUT_POINTS : TEL.WIN_POINTS;
    for (const link of w.links) {
      addScore(room, link.playerId, points);
      awardedTo.add(link.playerId);
    }
  }

  const standings = getStandings(room);
  const payload = {
    chains: gs.chains.map(c => ({
      id: c.id,
      prompt: c.prompt,
      finalLinkText: c.links[c.links.length - 1]?.text || '',
      guess: c.guess?.text || '',
      votes: counts[c.id] || 0,
      isWinner: winners.some(w => w.id === c.id),
      isShutout: isShutout && winners[0]?.id === c.id,
      memberIds: c.links.map(l => l.playerId),
      memberNames: c.links.map(l => l.playerName)
    })),
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
    if (gs.currentSet < gs.totalSets) {
      beginAssign(room, io);
    } else {
      showFinalScores(room, io);
    }
  }, TEL.SET_END_PAUSE);
}

function showFinalScores(room, io) {
  // Cleanup any lingering timers.
  for (const c of room.gameState.chains || []) clearChainTimer(c);
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
    tel_submit_link: submitLink,
    tel_submit_guess: submitGuess,
    tel_submit_vote: submitVote
  }
};
