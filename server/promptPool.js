// Generic shuffle-without-replacement prompt pool. Supports both string-array
// prompts (Word Budget, Frankenstein) and object-array prompts (Shutterbox,
// where each prompt has metadata like `final_eligible`).

function createPromptPool(promptBank) {
  return {
    available: [...promptBank],
    used: []
  };
}

function pickPrompts(pool, count, predicate) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    let candidates = pool.available;
    if (predicate) candidates = pool.available.filter(predicate);

    if (candidates.length === 0) {
      // Refill from used (also filtered if a predicate was given).
      const refill = predicate ? pool.used.filter(predicate) : pool.used;
      pool.available.push(...refill);
      pool.used = predicate ? pool.used.filter(p => !predicate(p)) : [];
      candidates = predicate ? pool.available.filter(predicate) : pool.available;
      if (candidates.length === 0) return picked; // pool exhausted
    }

    const idx = Math.floor(Math.random() * candidates.length);
    const prompt = candidates[idx];
    const realIdx = pool.available.indexOf(prompt);
    pool.available.splice(realIdx, 1);
    pool.used.push(prompt);
    picked.push(prompt);
  }
  return picked;
}

module.exports = { createPromptPool, pickPrompts };
