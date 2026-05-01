// Single source of truth for the bundle. Used by server (CommonJS require) and
// browser (script tag — sets window.HB).

const LOBBY_PHASES = {
  LOBBY: 'LOBBY',           // players joining
  GAME_SELECT: 'GAME_SELECT', // host picking a game
  IN_GAME: 'IN_GAME',         // a game module owns the room
  POST_GAME: 'POST_GAME'      // showing final scores; host can pick again
};

const ROOM_LIMITS = {
  MIN_PLAYERS: 2,        // bundle-level absolute floor
  MAX_PLAYERS: 16,
  CODE_LENGTH: 4,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',  // no I or O
  IDLE_TIMEOUT_MS: 30 * 60 * 1000   // destroy idle rooms after 30 min
};

// --- Word Budget ---
const WB = {
  PHASES: {
    PROMPT_WRITE:    'wb_PROMPT_WRITE',
    MATCHUP_VOTE:    'wb_MATCHUP_VOTE',
    MATCHUP_RESULTS: 'wb_MATCHUP_RESULTS',
    SET_SCORES:      'wb_SET_SCORES',
    FINAL_SCORES:    'wb_FINAL_SCORES'
  },
  WORD_LIMITS: [15, 7, 3, 1],
  ROUND_TIMERS: [30, 20, 15, 10],
  VOTE_TIMER: 10,
  ROUNDS_PER_SET: 4,
  SETS_PER_GAME: 3,
  RESULTS_PAUSE: 3000,
  SET_SCORES_PAUSE: 6000,
  MATCHUP_RESULTS_PAUSE: 4000,
  TRIPLE_THRESHOLD: 9,
  MIN_PLAYERS: 2
};

// --- Frankenstein ---
const FK = {
  PHASES: {
    WRITE:          'fk_WRITE',
    STITCH:         'fk_STITCH',
    MATCHUP_VOTE:   'fk_MATCHUP_VOTE',
    MATCHUP_RESULT: 'fk_MATCHUP_RESULT',
    ROUND_END:      'fk_ROUND_END'
  },
  ROUNDS_PER_GAME: 3,
  WORD_LIMIT_WRITE: 20,
  WRITE_TIME: 45,
  STITCH_TIME: 75,
  VOTE_TIMER: 10,
  FRAGMENT_MIN: 3,
  FRAGMENT_MAX: 5,
  POOL_SIZE: 15,
  MIN_PLAYERS: 3,
  TRIPLE_THRESHOLD: 9,
  RESULTS_PAUSE: 3000,
  MATCHUP_RESULTS_PAUSE: 4000
};

// --- Telephone ---
const TEL = {
  PHASES: {
    ASSIGN:   'tel_ASSIGN',
    WRITE:    'tel_WRITE',
    GUESS:    'tel_GUESS',
    REVEAL:   'tel_REVEAL',
    VOTE:     'tel_VOTE',
    SET_END:  'tel_SET_END'
  },
  // Word limits keyed by chain length. Each entry is the schedule for links
  // 1..N. The first link writes from the original prompt; subsequent links
  // see only the previous link's text.
  WORD_LIMITS: {
    3: [20, 10, 4],
    4: [20, 12, 6, 2],
    5: [20, 12, 7, 4, 2]
  },
  // Per-link write timer in seconds. Same indexing as WORD_LIMITS.
  WRITE_TIMERS: {
    3: [30, 25, 15],
    4: [30, 25, 20, 15],
    5: [30, 25, 20, 15, 10]
  },
  GUESS_TIMER: 30,
  GUESS_WORD_LIMIT: 20,
  VOTE_TIMER: 15,
  ASSIGN_PAUSE: 3000,
  REVEAL_LINK_PAUSE: 3000,    // ms between consecutive links in a chain
  REVEAL_GUESS_PAUSE: 5000,   // ms after the guess before next chain
  REVEAL_INTER_CHAIN_PAUSE: 2000,
  SET_END_PAUSE: 6000,
  SETS_PER_GAME: 3,
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 16,
  WIN_POINTS: 500,
  SHUTOUT_POINTS: 750
};

// --- Shutterbox (placeholder for Pass 2) ---
const SB = {
  PHASES: {
    ROUND_INTRO:       'sb_ROUND_INTRO',
    SUBMITTING:        'sb_SUBMITTING',
    REVEALING:         'sb_REVEALING',
    VOTING:            'sb_VOTING',
    RESULT:            'sb_RESULT',
    SCOREBOARD:        'sb_SCOREBOARD',
    FINAL_SUBMITTING:  'sb_FINAL_SUBMITTING',
    FINAL_VOTING:      'sb_FINAL_VOTING',
    FINAL_RESULTS:     'sb_FINAL_RESULTS'
  },
  ROUNDS: 3,
  SUBMIT_TIME: 90,
  VOTE_TIME: 15,
  FINAL_VOTE_TIME: 25,
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 16
};

// --- Scoring (shared across pair/triple games) ---
const SCORING = {
  PAIR_WIN: 500,
  PAIR_SHUTOUT: 750,
  PAIR_TIE: 250,
  TRIPLE_FIRST: 500,
  TRIPLE_SECOND: 200,
  TRIPLE_THIRD: 0,
  TRIPLE_SHUTOUT: 750
};

// --- Game registry metadata. The actual `init` is plugged in server-side. ---
const GAME_META = [
  { id: 'wordBudget',  name: 'WORD BUDGET',  blurb: 'Shrinking word limits',  minPlayers: WB.MIN_PLAYERS, available: true,  color: '#4ecca3' },
  { id: 'shutterbox',  name: 'SHUTTERBOX',   blurb: 'Photo party game',       minPlayers: SB.MIN_PLAYERS, available: true,  color: '#f0a500' },
  { id: 'frankenstein',name: 'FRANKENSTEIN', blurb: 'Remix fragments',        minPlayers: FK.MIN_PLAYERS, available: true,  color: '#e94560' },
  { id: 'telephone',   name: 'TELEPHONE',    blurb: 'Whispers down the chain',minPlayers: TEL.MIN_PLAYERS,available: true,  color: '#7e57c2' }
];

const ALL = {
  LOBBY_PHASES, ROOM_LIMITS, WB, FK, SB, TEL, SCORING, GAME_META
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ALL;
}
if (typeof window !== 'undefined') {
  window.HB = ALL;
}
