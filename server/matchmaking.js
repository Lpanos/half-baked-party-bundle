// Pair / triple matchmaking. Same algorithm as standalone Word Budget /
// Frankenstein. Triples kick in at TRIPLE_THRESHOLD (passed in as arg —
// the bundle uses 9 for both games).

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createMatchups(playerIds, opponentHistory, tripleThreshold = 9) {
  const count = playerIds.length;
  if (count < 2) return [];

  const ordered = shuffle(playerIds); // Future: sort by fewest shared opponents in history.
  const groups = [];

  if (count >= tripleThreshold) {
    const remaining = [...ordered];
    const leftover = remaining.length % 3;
    if (leftover === 1) {
      groups.push(remaining.splice(0, 2));
      groups.push(remaining.splice(0, 2));
    } else if (leftover === 2) {
      groups.push(remaining.splice(0, 2));
    }
    while (remaining.length >= 3) groups.push(remaining.splice(0, 3));
  } else {
    const remaining = [...ordered];
    if (remaining.length % 2 === 1) {
      groups.push(remaining.splice(0, 3));
    }
    while (remaining.length >= 2) groups.push(remaining.splice(0, 2));
  }
  return groups;
}

function recordOpponents(groups, history) {
  for (const group of groups) {
    for (const pid of group) {
      if (!history[pid]) history[pid] = {};
      for (const other of group) {
        if (other !== pid) {
          history[pid][other] = (history[pid][other] || 0) + 1;
        }
      }
    }
  }
}

module.exports = { createMatchups, recordOpponents, shuffle };
