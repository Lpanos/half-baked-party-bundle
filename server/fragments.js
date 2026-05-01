// Frankenstein chopper / pool builder / stitch validator.
// Identical mechanic to the standalone Frankenstein game.

const { FK } = require('../shared/constants');
const { shuffle } = require('./matchmaking');

function randInt(min, maxInclusive) {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

function chopAnswer(text, authorId) {
  if (!text || typeof text !== 'string') return [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const remaining = words.length - i;
    let take;

    if (remaining <= FK.FRAGMENT_MAX) {
      take = remaining;
    } else {
      take = randInt(FK.FRAGMENT_MIN, FK.FRAGMENT_MAX);
      const tailAfter = remaining - take;
      if (tailAfter > 0 && tailAfter < FK.FRAGMENT_MIN) {
        const adjusted = remaining - FK.FRAGMENT_MIN;
        if (adjusted >= FK.FRAGMENT_MIN && adjusted <= FK.FRAGMENT_MAX) {
          take = adjusted;
        } else {
          take = remaining;
        }
      }
    }

    chunks.push({
      id: `${authorId}_${chunks.length}`,
      text: words.slice(i, i + take).join(' '),
      authorId
    });
    i += take;
  }
  return chunks;
}

function buildPools(allChunks, playerIds, poolSize) {
  const pools = {};
  for (const pid of playerIds) {
    const eligible = allChunks.filter(c => c.authorId !== pid);
    const sample = shuffle(eligible).slice(0, Math.min(poolSize, eligible.length));
    pools[pid] = sample.map(c => ({ id: c.id, text: c.text }));
  }
  return pools;
}

function validateStitch(fragmentIds, pool) {
  if (!Array.isArray(fragmentIds)) return { ok: false, reason: 'Invalid submission' };
  if (fragmentIds.length === 0) return { ok: false, reason: 'Add at least one fragment' };
  const poolIds = new Set(pool.map(c => c.id));
  const seen = new Set();
  for (const fid of fragmentIds) {
    if (typeof fid !== 'string') return { ok: false, reason: 'Invalid fragment id' };
    if (!poolIds.has(fid)) return { ok: false, reason: 'Fragment not in your pool' };
    if (seen.has(fid)) return { ok: false, reason: 'Cannot reuse fragment' };
    seen.add(fid);
  }
  return { ok: true };
}

function renderStitched(fragmentIds, pool) {
  const map = new Map(pool.map(c => [c.id, c.text]));
  return fragmentIds.map(id => map.get(id) || '').join(' ').trim();
}

module.exports = { chopAnswer, buildPools, validateStitch, renderStitched };
