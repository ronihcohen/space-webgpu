/**
 * input.test.ts — Unit tests for input.ts edge event logic.
 *
 * Tests the key contract: wasPressed() returns true exactly once per keydown
 * (consumed on first read), then false until the next keydown.
 *
 * Note: These tests exercise the InputState data model directly — they do NOT
 * attach real DOM event listeners (which require a browser). Instead they
 * manipulate _held and _pressed directly to simulate what attachInputListeners
 * would do, which is valid because the logic is pure state mutation.
 */

import { describe, it, expect } from 'vitest';
import {
  makeInputState,
  isDown,
  wasPressed,
  isDownEither,
  type InputState,
} from './input';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate a keydown on a fresh-edge key (not already held). */
function simulateKeyDown(state: InputState, key: string): void {
  if (!state._held.has(key)) {
    state._pressed.add(key);
  }
  state._held.add(key);
}

/** Simulate a key-repeat (already held — should NOT add to _pressed). */
function simulateKeyRepeat(state: InputState, key: string): void {
  // Key is already in _held; do NOT add to _pressed (matches attachInputListeners logic)
  state._held.add(key); // no-op since it's already there
}

/** Simulate a keyup. */
function simulateKeyUp(state: InputState, key: string): void {
  state._held.delete(key);
}

// ─── isDown ────────────────────────────────────────────────────────────────────

describe('isDown', () => {
  it('returns false before any key is pressed', () => {
    const state = makeInputState();
    expect(isDown(state, 'Space')).toBe(false);
  });

  it('returns true while key is held', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    expect(isDown(state, 'Space')).toBe(true);
  });

  it('returns false after key is released', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    simulateKeyUp(state, 'Space');
    expect(isDown(state, 'Space')).toBe(false);
  });

  it('tracks multiple keys independently', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'ArrowLeft');
    simulateKeyDown(state, 'Space');
    expect(isDown(state, 'ArrowLeft')).toBe(true);
    expect(isDown(state, 'Space')).toBe(true);
    simulateKeyUp(state, 'ArrowLeft');
    expect(isDown(state, 'ArrowLeft')).toBe(false);
    expect(isDown(state, 'Space')).toBe(true);
  });
});

// ─── wasPressed — edge event, consumed on first read ─────────────────────────

describe('wasPressed', () => {
  it('returns false before any keydown', () => {
    const state = makeInputState();
    expect(wasPressed(state, 'Space')).toBe(false);
  });

  it('returns true exactly once after a keydown', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    expect(wasPressed(state, 'Space')).toBe(true);
  });

  it('returns false on the second call — auto-consumed on first read', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    wasPressed(state, 'Space'); // first read — consumes
    expect(wasPressed(state, 'Space')).toBe(false); // second read — false
  });

  it('returns false even if the key is still held after being consumed', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    wasPressed(state, 'Space'); // consumed
    // Key is still held — but wasPressed should still return false
    expect(isDown(state, 'Space')).toBe(true); // held, yes
    expect(wasPressed(state, 'Space')).toBe(false); // but not a new edge
  });

  it('returns true again after key-up + key-down (new leading edge)', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    wasPressed(state, 'Space'); // consumed
    simulateKeyUp(state, 'Space');
    simulateKeyDown(state, 'Space'); // new keydown
    expect(wasPressed(state, 'Space')).toBe(true);
  });

  it('key-repeat (already held) does NOT produce a new wasPressed event', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space'); // initial press
    wasPressed(state, 'Space'); // consumed
    // Browser fires keydown again (repeat) while key is held
    simulateKeyRepeat(state, 'Space');
    expect(wasPressed(state, 'Space')).toBe(false); // no new edge
  });

  it('tracks wasPressed independently per key', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'KeyP');
    simulateKeyDown(state, 'Space');
    expect(wasPressed(state, 'KeyP')).toBe(true);
    expect(wasPressed(state, 'Space')).toBe(true);
    // Both consumed now
    expect(wasPressed(state, 'KeyP')).toBe(false);
    expect(wasPressed(state, 'Space')).toBe(false);
  });

  it('consuming one key does not affect another', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'Space');
    simulateKeyDown(state, 'KeyP');
    wasPressed(state, 'Space'); // consume Space only
    expect(wasPressed(state, 'KeyP')).toBe(true); // P unaffected
    expect(wasPressed(state, 'Space')).toBe(false); // Space consumed
  });
});

// ─── isDownEither ─────────────────────────────────────────────────────────────

describe('isDownEither', () => {
  it('returns false if neither key is held', () => {
    const state = makeInputState();
    expect(isDownEither(state, 'ArrowLeft', 'KeyA')).toBe(false);
  });

  it('returns true if the first key is held', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'ArrowLeft');
    expect(isDownEither(state, 'ArrowLeft', 'KeyA')).toBe(true);
  });

  it('returns true if the second key is held', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'KeyA');
    expect(isDownEither(state, 'ArrowLeft', 'KeyA')).toBe(true);
  });

  it('returns true if both keys are held', () => {
    const state = makeInputState();
    simulateKeyDown(state, 'ArrowLeft');
    simulateKeyDown(state, 'KeyA');
    expect(isDownEither(state, 'ArrowLeft', 'KeyA')).toBe(true);
  });
});
