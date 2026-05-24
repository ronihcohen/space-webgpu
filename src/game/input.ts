/**
 * input.ts — Keyboard input handler.
 *
 * Exposes two query modes:
 *   isDown(key)    — true while the key is held
 *   wasPressed(key) — true exactly once per keydown; consumed on first read
 *
 * Keys the game cares about:
 *   ArrowLeft / ArrowRight / KeyA / KeyD  — player movement
 *   Space                                 — fire
 *   KeyP                                  — pause toggle
 *
 * Spec requirements implemented here:
 *   - event.preventDefault() on Space and Arrow keys (stops page scroll)
 *   - Only those specific keys are suppressed — no blanket prevention
 */

/** Keys the game actively uses. */
const GAME_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'KeyA',
  'KeyD',
  'Space',
  'KeyP',
]);

/** Keys for which we call preventDefault (only scroll-causing ones). */
const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
]);

export interface InputState {
  /** Keys currently held down. */
  _held: Set<string>;
  /** Keys pressed since the last consumePressed() call. */
  _pressed: Set<string>;
}

export function makeInputState(): InputState {
  return {
    _held: new Set(),
    _pressed: new Set(),
  };
}

/**
 * Register the window-level keydown/keyup listeners.
 * Call once at startup. Returns a cleanup function.
 */
export function attachInputListeners(state: InputState): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    // Prevent page scroll for game-used keys
    if (PREVENT_DEFAULT_KEYS.has(e.code)) {
      e.preventDefault();
    }

    if (!GAME_KEYS.has(e.code)) return;

    // Edge event: only record wasPressed on the leading edge (ignore key-repeat)
    if (!state._held.has(e.code)) {
      state._pressed.add(e.code);
    }
    state._held.add(e.code);
  }

  function onKeyUp(e: KeyboardEvent): void {
    state._held.delete(e.code);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return (): void => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}

/**
 * True while the key is held down.
 * `key` is a KeyboardEvent.code string (e.g. 'ArrowLeft', 'Space').
 */
export function isDown(state: InputState, key: string): boolean {
  return state._held.has(key);
}

/**
 * True if the key was pressed since the last time wasPressed was called
 * for that key (edge-triggered, auto-consumed on read).
 *
 * Guarantees: returns true at most once per physical keydown.
 * Worst-case latency: one tick (~16ms) from keydown to consumption.
 */
export function wasPressed(state: InputState, key: string): boolean {
  if (state._pressed.has(key)) {
    state._pressed.delete(key);
    return true;
  }
  return false;
}

/**
 * Convenience: check isDown for either of two keys (e.g. left arrow OR A).
 */
export function isDownEither(
  state: InputState,
  keyA: string,
  keyB: string,
): boolean {
  return state._held.has(keyA) || state._held.has(keyB);
}
