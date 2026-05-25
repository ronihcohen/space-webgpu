/**
 * physics.test.ts — Unit tests for physics.ts (AABB, swept collision, splash).
 *
 * All tests run in Vitest without a browser or GPU — physics.ts is pure TS.
 */

import { describe, it, expect } from 'vitest';
import {
  aabbOverlap,
  sweptBulletBarrierHit,
  applySplash,
  type Rect,
} from './physics';
import type { Bullet, BarrierMask } from './entities';
import {
  BARRIER_W,
  BARRIER_H,
  makeBarrierMask,
  SPLASH_UP_OFFSETS,
  SPLASH_DOWN_OFFSETS,
} from './entities';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** Make a bullet moving upward (player bullet) between prevY and y. */
function makeBullet(
  x: number,
  y: number,
  prevY: number,
  owner: 'player' | 'enemy' = 'player',
): Bullet {
  const vy = owner === 'player' ? -180 : 90;
  return { x, y, prevY, vy, owner };
}

/**
 * Make a barrier with a fresh all-solid mask at the given world position.
 * Returns the BarrierMask interface expected by physics.ts.
 */
function makeSolidBarrier(x: number, y: number): BarrierMask {
  return { mask: makeBarrierMask(), x, y };
}

/** Make a barrier with a single solid pixel at (col, row). */
function makeSinglePixelBarrier(
  bx: number,
  by: number,
  col: number,
  row: number,
): BarrierMask {
  const mask = new Uint8Array(BARRIER_W * BARRIER_H); // all zeros
  mask[row * BARRIER_W + col] = 255;
  return { mask, x: bx, y: by };
}

// ─── AABB tests ───────────────────────────────────────────────────────────────

describe('aabbOverlap', () => {
  it('returns true for clearly overlapping rects', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(5, 5, 10, 10);
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns true for fully contained rect', () => {
    const outer = makeRect(0, 0, 20, 20);
    const inner = makeRect(5, 5, 5, 5);
    expect(aabbOverlap(outer, inner)).toBe(true);
    expect(aabbOverlap(inner, outer)).toBe(true);
  });

  it('returns false for clearly non-overlapping rects (right of)', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(20, 0, 10, 10);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for clearly non-overlapping rects (below)', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(0, 20, 10, 10);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for touching edges (left === right) — strictly inside convention', () => {
    // a.x + a.w = 10, b.x = 10: touching edge, NOT overlapping per spec
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(10, 0, 10, 10);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns false for touching edges (top === bottom)', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(0, 10, 10, 10);
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('returns true for 1px overlap', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(9, 0, 10, 10); // overlaps by 1px in x
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns false when rects overlap in x but not y', () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(5, 15, 10, 10); // x overlaps, y does not
    expect(aabbOverlap(a, b)).toBe(false);
  });
});

// ─── Swept bullet vs barrier ───────────────────────────────────────────────────

describe('sweptBulletBarrierHit', () => {
  it('detects hit when bullet path crosses a solid pixel within the mask', () => {
    // Barrier at (100, 100), solid pixel at col=5, row=3 → world (105, 103)
    const barrier = makeSinglePixelBarrier(100, 100, 5, 3);
    // Bullet at x=105, prevY=98 (above the pixel), y=106 (below — tunnel test)
    const bullet = makeBullet(105, 106, 98);
    const hit = sweptBulletBarrierHit(bullet, barrier);
    expect(hit).not.toBeNull();
    expect(hit!.maskCol).toBe(5);
    expect(hit!.maskRow).toBe(3);
  });

  it('catches tunneling — single-pixel sliver, bullet jumps over it in one tick', () => {
    // This is the key swept-vs-point-sample scenario from CLAUDE.md.
    // Barrier at y=50, only row=0 col=0 is solid.
    const barrier = makeSinglePixelBarrier(0, 50, 0, 0);
    // Bullet starts at y=45, moves to y=55 in one tick (10px jump, clear tunnel).
    const bullet = makeBullet(0, 55, 45);
    const hit = sweptBulletBarrierHit(bullet, barrier);
    expect(hit).not.toBeNull();
    expect(hit!.maskRow).toBe(0);
    expect(hit!.maskCol).toBe(0);
  });

  it('returns null when bullet path does not reach the mask', () => {
    // Barrier at (100, 100), bullet well above (prevY=50, y=60)
    const barrier = makeSolidBarrier(100, 100);
    const bullet = makeBullet(101, 60, 50);
    expect(sweptBulletBarrierHit(bullet, barrier)).toBeNull();
  });

  it('returns null when bullet x is outside the mask width', () => {
    const barrier = makeSolidBarrier(100, 100);
    // Bullet x=99 → maskCol = round(99) - round(100) = -1 — out of bounds
    const bullet = makeBullet(99, 105, 100);
    expect(sweptBulletBarrierHit(bullet, barrier)).toBeNull();
  });

  it('returns null when bullet x is beyond the right edge of the mask', () => {
    const barrier = makeSolidBarrier(100, 100);
    // maskCol = round(100 + BARRIER_W) - round(100) = BARRIER_W → out of bounds
    const bullet = makeBullet(100 + BARRIER_W, 105, 100);
    expect(sweptBulletBarrierHit(bullet, barrier)).toBeNull();
  });

  it('returns null when the mask pixel at bullet x is empty (0)', () => {
    // Fresh all-zeros mask (empty barrier)
    const barrier: BarrierMask = {
      mask: new Uint8Array(BARRIER_W * BARRIER_H), // all zeros
      x: 100,
      y: 100,
    };
    const bullet = makeBullet(105, 112, 95);
    expect(sweptBulletBarrierHit(bullet, barrier)).toBeNull();
  });

  it('returns the first hit pixel (closest to prevY in travel direction)', () => {
    // Column 0, rows 0 and 5 both solid — bullet sweeps upward from y=115 to y=98.
    const mask = new Uint8Array(BARRIER_W * BARRIER_H);
    mask[0 * BARRIER_W + 0] = 255; // row 0
    mask[5 * BARRIER_W + 0] = 255; // row 5
    const barrier: BarrierMask = { mask, x: 0, y: 100 };
    // Bullet moves upward: prevY=115, y=98
    const bullet = makeBullet(0, 98, 115, 'player');
    const hit = sweptBulletBarrierHit(bullet, barrier);
    // Traveling upward, should hit row 5 first (y=105 in world = first encountered)
    expect(hit).not.toBeNull();
    expect(hit!.maskRow).toBe(5);
  });

  it('handles enemy bullet moving downward', () => {
    // Single solid pixel at row=2, col=3 in barrier at (0, 100)
    const barrier = makeSinglePixelBarrier(0, 100, 3, 2);
    // Enemy bullet starts above (prevY=100), moves down through row 2 (y=103 world)
    const bullet = makeBullet(3, 106, 100, 'enemy');
    const hit = sweptBulletBarrierHit(bullet, barrier);
    expect(hit).not.toBeNull();
    expect(hit!.maskCol).toBe(3);
    expect(hit!.maskRow).toBe(2);
  });
});

// ─── Splash application ────────────────────────────────────────────────────────

describe('applySplash', () => {
  it('clears the impact pixel and surrounding area for player (upward) bullet', () => {
    const barrier = makeSolidBarrier(0, 0);
    const hit = { maskCol: 10, maskRow: 8 };
    applySplash(barrier, hit, 'player');

    // All SPLASH_UP_OFFSETS pixels should be cleared
    for (const [dc, dr] of SPLASH_UP_OFFSETS) {
      const col = 10 + dc;
      const row = 8 + dr;
      if (col >= 0 && col < BARRIER_W && row >= 0 && row < BARRIER_H) {
        expect(barrier.mask[row * BARRIER_W + col]).toBe(0);
      }
    }
  });

  it('clears the impact pixel and surrounding area for enemy (downward) bullet', () => {
    const barrier = makeSolidBarrier(0, 0);
    const hit = { maskCol: 10, maskRow: 8 };
    applySplash(barrier, hit, 'enemy');

    for (const [dc, dr] of SPLASH_DOWN_OFFSETS) {
      const col = 10 + dc;
      const row = 8 + dr;
      if (col >= 0 && col < BARRIER_W && row >= 0 && row < BARRIER_H) {
        expect(barrier.mask[row * BARRIER_W + col]).toBe(0);
      }
    }
  });

  it('does not write out-of-bounds when impact is near the top edge', () => {
    const barrier = makeSolidBarrier(0, 0);
    // Impact at row=0, col=10 — upward offsets go to row=-2, -1 (out of bounds)
    const hit = { maskCol: 10, maskRow: 0 };
    expect(() => applySplash(barrier, hit, 'player')).not.toThrow();
    // Verify that pixels at valid positions within the mask are cleared
    // (no out-of-bounds access — Uint8Array silently wraps, but we check correctness)
    expect(barrier.mask[0 * BARRIER_W + 10]).toBe(0); // impact pixel itself
  });

  it('does not write out-of-bounds when impact is near the left edge', () => {
    const barrier = makeSolidBarrier(0, 0);
    const hit = { maskCol: 0, maskRow: 8 };
    expect(() => applySplash(barrier, hit, 'player')).not.toThrow();
    // maskCol-2 would be -2 — should be skipped
    expect(barrier.mask[8 * BARRIER_W + 0]).toBe(0);
  });

  it('does not write out-of-bounds when impact is near the right edge', () => {
    const barrier = makeSolidBarrier(0, 0);
    const hit = { maskCol: BARRIER_W - 1, maskRow: 8 };
    expect(() => applySplash(barrier, hit, 'player')).not.toThrow();
    expect(barrier.mask[8 * BARRIER_W + (BARRIER_W - 1)]).toBe(0);
  });

  it('does not write out-of-bounds when impact is near the bottom edge (enemy bullet)', () => {
    const barrier = makeSolidBarrier(0, 0);
    const hit = { maskCol: 10, maskRow: BARRIER_H - 1 };
    expect(() => applySplash(barrier, hit, 'enemy')).not.toThrow();
    expect(barrier.mask[(BARRIER_H - 1) * BARRIER_W + 10]).toBe(0);
  });

  it('player splash fans upward — row -2 is narrower than row -1', () => {
    // SPLASH_UP_OFFSETS: row -2 has 3 pixels (cols -1,0,+1), row -1 has 5 pixels
    const row2Cols = SPLASH_UP_OFFSETS
      .filter(([, dr]) => dr === -2)
      .map(([dc]) => dc);
    const row1Cols = SPLASH_UP_OFFSETS
      .filter(([, dr]) => dr === -1)
      .map(([dc]) => dc);
    expect(row2Cols.length).toBeLessThan(row1Cols.length);
  });

  it('enemy splash fans downward — row +2 is narrower than row +1', () => {
    const row2Cols = SPLASH_DOWN_OFFSETS
      .filter(([, dr]) => dr === 2)
      .map(([dc]) => dc);
    const row1Cols = SPLASH_DOWN_OFFSETS
      .filter(([, dr]) => dr === 1)
      .map(([dc]) => dc);
    expect(row2Cols.length).toBeLessThan(row1Cols.length);
  });
});
