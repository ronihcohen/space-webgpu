/**
 * state.test.ts — Unit tests for the game state machine (state.ts).
 *
 * Tests: legal transitions succeed, illegal transitions are no-ops,
 * P during GAME_OVER does nothing, high score logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeGameState,
  startGame,
  togglePause,
  autoPause,
  triggerGameOver,
  triggerWin,
  returnToIdle,
  addScore,
  advanceWave,
  resetLevel,
  type GameState,
} from './state';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inPhase(phase: GameState['phase']): GameState {
  // Bootstrap to a specific phase by applying legal transitions.
  let s = makeGameState();
  if (phase === 'IDLE') return s;
  s = startGame(s); // IDLE → PLAYING
  if (phase === 'PLAYING') return s;
  if (phase === 'PAUSED') return togglePause(s); // PLAYING → PAUSED
  if (phase === 'GAME_OVER') return triggerGameOver(s); // PLAYING → GAME_OVER
  if (phase === 'WIN') return triggerWin(s); // PLAYING → WIN
  throw new Error(`Unexpected phase: ${String(phase)}`);
}

// ─── makeGameState ────────────────────────────────────────────────────────────

describe('makeGameState', () => {
  let s: GameState;
  beforeEach(() => { s = makeGameState(); });

  it('starts in IDLE phase', () => {
    expect(s.phase).toBe('IDLE');
  });

  it('starts with score 0', () => {
    expect(s.score).toBe(0);
  });

  it('starts at wave 1', () => {
    expect(s.wave).toBe(1);
  });

  it('highScore is a non-negative number', () => {
    expect(s.highScore).toBeGreaterThanOrEqual(0);
  });
});

// ─── Legal transitions ────────────────────────────────────────────────────────

describe('legal transitions', () => {
  it('IDLE → PLAYING via startGame', () => {
    const s = startGame(makeGameState());
    expect(s.phase).toBe('PLAYING');
  });

  it('PLAYING → PAUSED via togglePause', () => {
    const s = togglePause(inPhase('PLAYING'));
    expect(s.phase).toBe('PAUSED');
  });

  it('PAUSED → PLAYING via togglePause', () => {
    const s = togglePause(inPhase('PAUSED'));
    expect(s.phase).toBe('PLAYING');
  });

  it('PLAYING → GAME_OVER via triggerGameOver', () => {
    const s = triggerGameOver(inPhase('PLAYING'));
    expect(s.phase).toBe('GAME_OVER');
  });

  it('PLAYING → WIN via triggerWin', () => {
    const s = triggerWin(inPhase('PLAYING'));
    expect(s.phase).toBe('WIN');
  });

  it('GAME_OVER → IDLE via returnToIdle', () => {
    const s = returnToIdle(inPhase('GAME_OVER'));
    expect(s.phase).toBe('IDLE');
  });

  it('WIN → IDLE via returnToIdle', () => {
    const s = returnToIdle(inPhase('WIN'));
    expect(s.phase).toBe('IDLE');
  });

  it('PLAYING → PAUSED via autoPause', () => {
    const s = autoPause(inPhase('PLAYING'));
    expect(s.phase).toBe('PAUSED');
  });
});

// ─── Illegal transitions are no-ops ──────────────────────────────────────────

describe('illegal transitions are no-ops', () => {
  it('startGame from PLAYING is a no-op', () => {
    const s = inPhase('PLAYING');
    expect(startGame(s).phase).toBe('PLAYING');
  });

  it('startGame from PAUSED is a no-op', () => {
    const s = inPhase('PAUSED');
    expect(startGame(s).phase).toBe('PAUSED');
  });

  it('startGame from GAME_OVER is a no-op', () => {
    const s = inPhase('GAME_OVER');
    expect(startGame(s).phase).toBe('GAME_OVER');
  });

  it('togglePause from IDLE is a no-op', () => {
    const s = makeGameState(); // IDLE
    expect(togglePause(s).phase).toBe('IDLE');
  });

  it('togglePause (P) from GAME_OVER is a no-op — P does nothing in terminal states', () => {
    const s = inPhase('GAME_OVER');
    // This is explicitly spec'd: "P during GAME_OVER does nothing"
    expect(togglePause(s).phase).toBe('GAME_OVER');
  });

  it('togglePause from WIN is a no-op', () => {
    const s = inPhase('WIN');
    expect(togglePause(s).phase).toBe('WIN');
  });

  it('triggerGameOver from PAUSED is a no-op', () => {
    const s = inPhase('PAUSED');
    expect(triggerGameOver(s).phase).toBe('PAUSED');
  });

  it('triggerGameOver from GAME_OVER is a no-op', () => {
    const s = inPhase('GAME_OVER');
    expect(triggerGameOver(s).phase).toBe('GAME_OVER');
  });

  it('triggerWin from PAUSED is a no-op', () => {
    const s = inPhase('PAUSED');
    expect(triggerWin(s).phase).toBe('PAUSED');
  });

  it('returnToIdle from PLAYING is a no-op', () => {
    const s = inPhase('PLAYING');
    expect(returnToIdle(s).phase).toBe('PLAYING');
  });

  it('returnToIdle from PAUSED is a no-op', () => {
    const s = inPhase('PAUSED');
    expect(returnToIdle(s).phase).toBe('PAUSED');
  });

  it('autoPause from IDLE is a no-op', () => {
    const s = makeGameState();
    expect(autoPause(s).phase).toBe('IDLE');
  });

  it('autoPause from PAUSED is a no-op (already paused)', () => {
    const s = inPhase('PAUSED');
    expect(autoPause(s).phase).toBe('PAUSED');
  });

  it('autoPause from GAME_OVER is a no-op', () => {
    const s = inPhase('GAME_OVER');
    expect(autoPause(s).phase).toBe('GAME_OVER');
  });
});

// ─── startGame resets score and wave ─────────────────────────────────────────

describe('startGame resets game fields', () => {
  it('resets score to 0 on new game', () => {
    let s = makeGameState();
    s = startGame(s);
    s = addScore(s, 500);
    s = triggerGameOver(s);
    s = returnToIdle(s);
    s = startGame(s);
    expect(s.score).toBe(0);
  });

  it('resets wave to 1 on new game', () => {
    let s = makeGameState();
    s = startGame(s);
    s = advanceWave(s);
    s = advanceWave(s);
    s = triggerWin(s);
    s = returnToIdle(s);
    s = startGame(s);
    expect(s.wave).toBe(1);
  });

  it('does NOT reset highScore on new game', () => {
    let s = makeGameState();
    s = startGame(s);
    s = addScore(s, 9999);
    s = triggerGameOver(s); // saves high score
    const savedHigh = s.highScore;
    s = returnToIdle(s);
    s = startGame(s);
    expect(s.highScore).toBe(savedHigh);
  });
});

// ─── addScore ─────────────────────────────────────────────────────────────────

describe('addScore', () => {
  it('adds points during PLAYING', () => {
    const s = addScore(inPhase('PLAYING'), 10);
    expect(s.score).toBe(10);
  });

  it('is a no-op when PAUSED', () => {
    const s = addScore(inPhase('PAUSED'), 100);
    expect(s.score).toBe(0);
  });

  it('is a no-op when IDLE', () => {
    const s = addScore(makeGameState(), 100);
    expect(s.score).toBe(0);
  });

  it('updates highScore in-memory when score exceeds it', () => {
    const s = addScore(inPhase('PLAYING'), 9999);
    expect(s.highScore).toBe(9999);
  });

  it('does not lower highScore if score is below existing high', () => {
    let s = inPhase('PLAYING');
    s = addScore(s, 9999);
    s = { ...s, score: 0 }; // manually reset score (simulate scenario)
    s = addScore(s, 10);
    expect(s.highScore).toBe(9999);
  });
});

// ─── High score preservation on game over / win ───────────────────────────────

describe('high score on terminal transitions', () => {
  it('triggerGameOver preserves highScore if score is higher', () => {
    let s = inPhase('PLAYING');
    s = addScore(s, 500);
    s = triggerGameOver(s);
    expect(s.highScore).toBe(500);
  });

  it('triggerWin preserves highScore if score is higher', () => {
    let s = inPhase('PLAYING');
    s = addScore(s, 300);
    s = triggerWin(s);
    expect(s.highScore).toBe(300);
  });
});

// ─── advanceWave ──────────────────────────────────────────────────────────────

describe('advanceWave', () => {
  it('increments wave by 1', () => {
    const s = advanceWave(inPhase('PLAYING'));
    expect(s.wave).toBe(2);
  });

  it('can advance multiple times', () => {
    let s = inPhase('PLAYING');
    s = advanceWave(s);
    s = advanceWave(s);
    expect(s.wave).toBe(3);
  });

  it('increments level by 1', () => {
    const s = advanceWave(inPhase('PLAYING'));
    expect(s.level).toBe(2);
  });

  it('keeps phase PLAYING — wave clear must not leave PLAYING state', () => {
    // Regression: old code called triggerWin() before advanceWave(), which set
    // phase to WIN. When the user then pressed Space, startGame() reset level to 1.
    const s = advanceWave(inPhase('PLAYING'));
    expect(s.phase).toBe('PLAYING');
  });

  it('level persists across two consecutive wave clears', () => {
    let s = inPhase('PLAYING');
    s = advanceWave(s); // level → 2
    s = advanceWave(s); // level → 3
    expect(s.level).toBe(3);
  });
});

// ─── resetLevel ───────────────────────────────────────────────────────────────

describe('resetLevel', () => {
  it('resets level to 1 from PLAYING', () => {
    let s = inPhase('PLAYING');
    s = advanceWave(s); // level → 2
    s = resetLevel(s);
    expect(s.level).toBe(1);
  });

  it('keeps phase PLAYING after reset', () => {
    const s = resetLevel(advanceWave(inPhase('PLAYING')));
    expect(s.phase).toBe('PLAYING');
  });

  it('is a no-op from PAUSED', () => {
    const s = inPhase('PAUSED');
    expect(resetLevel(s).level).toBe(s.level);
  });

  it('is a no-op from GAME_OVER', () => {
    const s = inPhase('GAME_OVER');
    expect(resetLevel(s).level).toBe(s.level);
  });
});
