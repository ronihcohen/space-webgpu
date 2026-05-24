/**
 * physics.ts — Collision detection and barrier mask manipulation.
 *
 * Pure functions — no GPU types, no side effects beyond mutation of
 * BarrierMask.mask (which is expected: that's the CPU-authoritative pixel data).
 *
 * Swept collision is used for bullet-vs-barrier: walk every pixel between
 * last and current Y, stopping at the first hit. This prevents tunneling
 * when a bullet moves several pixels per tick.
 */

import type { Bullet, BarrierMask } from './entities';
import {
  BARRIER_W,
  BARRIER_H,
  SPLASH_UP_OFFSETS,
  SPLASH_DOWN_OFFSETS,
} from './entities';

// ─── AABB collision ───────────────────────────────────────────────────────────

export interface Rect {
  x: number; // left edge
  y: number; // top edge
  w: number; // width
  h: number; // height
}

/**
 * True if the two axis-aligned rectangles overlap.
 * Touching edges (e.g. left === right) are NOT considered overlapping —
 * this matches the "strictly inside" convention for AABB.
 */
export function aabbOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// ─── Bullet-vs-barrier swept collision ────────────────────────────────────────

export interface BarrierHit {
  /** Pixel column within the barrier mask (0..BARRIER_W-1) */
  maskCol: number;
  /** Pixel row within the barrier mask (0..BARRIER_H-1) */
  maskRow: number;
}

/**
 * Test a bullet's swept path against a barrier mask.
 *
 * The bullet moves from (bullet.x, bullet.prevY) to (bullet.x, bullet.y)
 * each tick. We walk each integer Y between prevY and y and test whether
 * the bullet's X falls on a solid mask pixel. Returns the first hit found
 * (the pixel closest to prevY in travel direction), or null if no hit.
 *
 * `barrier.x` / `barrier.y` are the top-left corner of the barrier in
 * playfield coordinates.
 *
 * Bullet width is treated as 1 px for simplicity (3-px bullet sprite, but
 * the center pixel is the authoritative hit point). The barrier mask is
 * sampled at the bullet's integer x position relative to the barrier.
 */
export function sweptBulletBarrierHit(
  bullet: Bullet,
  barrier: BarrierMask,
): BarrierHit | null {
  // Convert bullet x to mask column
  const maskCol = Math.round(bullet.x) - Math.round(barrier.x);
  if (maskCol < 0 || maskCol >= BARRIER_W) return null;

  // Determine y range to sweep
  const y0 = bullet.prevY;
  const y1 = bullet.y;
  const step = y1 >= y0 ? 1 : -1;

  const startY = Math.round(y0);
  const endY = Math.round(y1);

  // Walk from startY toward endY (inclusive)
  for (let py = startY; step > 0 ? py <= endY : py >= endY; py += step) {
    const maskRow = py - Math.round(barrier.y);
    if (maskRow < 0 || maskRow >= BARRIER_H) continue;

    const idx = maskRow * BARRIER_W + maskCol;
    if (barrier.mask[idx] !== 0) {
      return { maskCol, maskRow };
    }
  }

  return null;
}

/**
 * Apply a splash to a barrier mask at the given impact pixel.
 * Mutates `barrier.mask` in-place.
 *
 * `owner` determines the splash shape:
 *   'player' → upward-fanning notch (SPLASH_UP_OFFSETS)
 *   'enemy'  → downward-fanning notch (SPLASH_DOWN_OFFSETS)
 *
 * Pixels outside the mask bounds are silently skipped (no out-of-bounds write).
 */
export function applySplash(
  barrier: BarrierMask,
  hit: BarrierHit,
  owner: 'player' | 'enemy',
): void {
  const offsets = owner === 'player' ? SPLASH_UP_OFFSETS : SPLASH_DOWN_OFFSETS;

  for (const [dc, dr] of offsets) {
    const col = hit.maskCol + dc;
    const row = hit.maskRow + dr;

    // Bounds check — never write outside the mask
    if (col < 0 || col >= BARRIER_W || row < 0 || row >= BARRIER_H) continue;

    barrier.mask[row * BARRIER_W + col] = 0;
  }
}
