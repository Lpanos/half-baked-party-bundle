const { SCORING } = require('../shared/constants');

function addScore(room, playerId, points) {
  const p = room.players.find(pp => pp.id === playerId);
  if (p) p.score += points;
}

function resetScores(room) {
  for (const p of room.players) p.score = 0;
}

function getStandings(room) {
  return room.players
    .map(p => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function getPodium(room) {
  return getStandings(room).slice(0, 3);
}

// --- Generic pair / triple matchup scoring (used by Word Budget + Frankenstein).
// Input: matchup with `playerIds` array and `votes` object (voterId -> choice index).
// Output: { scores: { playerId: points }, voteCounts: number[], totalVotes }
function scoreMatchup(matchup, multiplier = 1) {
  const players = matchup.playerIds;
  const voteCounts = new Array(players.length).fill(0);

  for (const choice of Object.values(matchup.votes || {})) {
    if (choice >= 0 && choice < players.length) {
      voteCounts[choice]++;
    }
  }

  const totalVotes = voteCounts.reduce((a, b) => a + b, 0);
  const results = {};
  for (const pid of players) results[pid] = 0;

  if (totalVotes === 0) {
    const tiePoints = (players.length === 2
      ? SCORING.PAIR_TIE
      : Math.round((SCORING.TRIPLE_FIRST + SCORING.TRIPLE_SECOND + SCORING.TRIPLE_THIRD) / 3)
    ) * multiplier;
    for (const pid of players) results[pid] = tiePoints;
    return { scores: results, voteCounts, totalVotes };
  }

  if (players.length === 2) scorePair(players, voteCounts, results, multiplier);
  else                       scoreTriple(players, voteCounts, results, multiplier);

  return { scores: results, voteCounts, totalVotes };
}

function scorePair(players, voteCounts, results, multiplier) {
  if (voteCounts[0] === voteCounts[1]) {
    results[players[0]] = SCORING.PAIR_TIE * multiplier;
    results[players[1]] = SCORING.PAIR_TIE * multiplier;
  } else {
    const winIdx = voteCounts[0] > voteCounts[1] ? 0 : 1;
    const loseIdx = 1 - winIdx;
    const isShutout = voteCounts[loseIdx] === 0;
    results[players[winIdx]] = (isShutout ? SCORING.PAIR_SHUTOUT : SCORING.PAIR_WIN) * multiplier;
    results[players[loseIdx]] = 0;
  }
}

function scoreTriple(players, voteCounts, results, multiplier) {
  const indexed = players.map((pid, i) => ({ pid, votes: voteCounts[i] }));
  indexed.sort((a, b) => b.votes - a.votes);

  const pools = [SCORING.TRIPLE_FIRST, SCORING.TRIPLE_SECOND, SCORING.TRIPLE_THIRD];

  if (indexed[0].votes === indexed[1].votes && indexed[1].votes === indexed[2].votes) {
    const share = Math.round((pools[0] + pools[1] + pools[2]) / 3) * multiplier;
    for (const p of indexed) results[p.pid] = share;
  } else if (indexed[0].votes === indexed[1].votes) {
    const share = Math.round((pools[0] + pools[1]) / 2) * multiplier;
    results[indexed[0].pid] = share;
    results[indexed[1].pid] = share;
    results[indexed[2].pid] = pools[2] * multiplier;
  } else if (indexed[1].votes === indexed[2].votes) {
    const isShutout = indexed[1].votes === 0;
    results[indexed[0].pid] = (isShutout ? SCORING.TRIPLE_SHUTOUT : pools[0]) * multiplier;
    const share = Math.round((pools[1] + pools[2]) / 2) * multiplier;
    results[indexed[1].pid] = share;
    results[indexed[2].pid] = share;
  } else {
    const isShutout = indexed[1].votes === 0 && indexed[2].votes === 0;
    results[indexed[0].pid] = (isShutout ? SCORING.TRIPLE_SHUTOUT : pools[0]) * multiplier;
    results[indexed[1].pid] = pools[1] * multiplier;
    results[indexed[2].pid] = pools[2] * multiplier;
  }
}

module.exports = { addScore, resetScores, getStandings, getPodium, scoreMatchup };
