/**
 * Game state machine.
 *
 * States:
 *   IDLE       — title / attract screen, waiting for input
 *   PLAYING    — active game
 *   PAUSED     — game frozen (P key, blur, or visibilitychange)
 *   GAME_OVER  — player died with no lives remaining
 *   WIN        — all invaders cleared
 *
 * Transitions:
 *   IDLE → PLAYING         (start game)
 *   PLAYING → PAUSED       (P key, auto-pause on blur/tab-hide)
 *   PAUSED → PLAYING       (P key — explicit resume only, no auto-resume)
 *   PLAYING → GAME_OVER    (player lives exhausted)
 *   PLAYING → WIN          (all invaders cleared)
 *   GAME_OVER → IDLE       (any key or timeout)
 *   WIN → IDLE             (any key or timeout)
 *
 * Illegal transitions are no-ops — the state is returned unchanged.
 */

export type GamePhase = 'IDLE' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'WIN';

export interface GameState {
  phase: GamePhase;
  score: number;
  highScore: number;
  wave: number;
  /** Current difficulty level. Increments on each screen clear, resets to 1 on player death. */
  level: number;
  /** Server-issued run token, or null for local/offline runs. */
  run: import('../leaderboard').SignedSeed | null;
}

export function makeGameState(): GameState {
  return {
    phase: 'IDLE',
    score: 0,
    highScore: loadHighScore(),
    wave: 1,
    level: 1,
    run: null,
  };
}

// ─── Transitions ──────────────────────────────────────────────────────────────

/**
 * Start a new game from IDLE. No-op if not in IDLE.
 */
export function startGame(state: GameState): GameState {
  if (state.phase !== 'IDLE') return state;
  return {
    ...state,
    phase: 'PLAYING',
    score: 0,
    wave: 1,
    level: 1,
    run: null,
  };
}

/**
 * Toggle pause. Only valid in PLAYING or PAUSED.
 * In any other state this is a no-op (e.g. P during GAME_OVER does nothing).
 */
export function togglePause(state: GameState): GameState {
  if (state.phase === 'PLAYING') return { ...state, phase: 'PAUSED' };
  if (state.phase === 'PAUSED') return { ...state, phase: 'PLAYING' };
  return state;
}

/**
 * Force-pause the game. Used by blur/visibilitychange handlers.
 * Only transitions PLAYING → PAUSED; all other states are unchanged.
 */
export function autoPause(state: GameState): GameState {
  if (state.phase === 'PLAYING') return { ...state, phase: 'PAUSED' };
  return state;
}

/**
 * Trigger game over. Only valid from PLAYING.
 * Records high score before transitioning.
 */
export function triggerGameOver(state: GameState): GameState {
  if (state.phase !== 'PLAYING') return state;
  const highScore = Math.max(state.score, state.highScore);
  if (highScore > state.highScore) {
    saveHighScore(highScore);
  }
  return { ...state, phase: 'GAME_OVER', highScore, level: 1 };
}

/**
 * Trigger win. Only valid from PLAYING.
 * Records high score before transitioning.
 */
export function triggerWin(state: GameState): GameState {
  if (state.phase !== 'PLAYING') return state;
  const highScore = Math.max(state.score, state.highScore);
  if (highScore > state.highScore) {
    saveHighScore(highScore);
  }
  return { ...state, phase: 'WIN', highScore };
}

/**
 * Return to IDLE from GAME_OVER or WIN. No-op from any other state.
 */
export function returnToIdle(state: GameState): GameState {
  if (state.phase === 'GAME_OVER' || state.phase === 'WIN') {
    return { ...state, phase: 'IDLE', run: null };
  }
  return state;
}

/**
 * Add points to the score. Only applies during PLAYING.
 * Returns state unchanged in any other phase.
 */
export function addScore(state: GameState, points: number): GameState {
  if (state.phase !== 'PLAYING') return state;
  const score = state.score + points;
  const highScore = Math.max(score, state.highScore);
  return { ...state, score, highScore };
}

/**
 * Advance to the next wave (called when all invaders cleared).
 * Also increments the difficulty level.
 */
export function advanceWave(state: GameState): GameState {
  return { ...state, wave: state.wave + 1, level: state.level + 1 };
}

/**
 * Reset difficulty level to 1 after a player death (with lives remaining).
 * Only valid from PLAYING; no-op in any other state.
 */
export function resetLevel(state: GameState): GameState {
  if (state.phase !== 'PLAYING') return state;
  return { ...state, level: 1 };
}

// ─── High score persistence ────────────────────────────────────────────────────

const HIGH_SCORE_KEY = 'space-invaders-webgpu-high-score';

function loadHighScore(): number {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0; // localStorage unavailable (e.g. private browsing with strict settings)
  }
}

function saveHighScore(score: number): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    // Silently ignore — high score not persisted but game continues
  }
}
