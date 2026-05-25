/**
 * spawner.ts — Invader grid creation and wave progression helpers.
 *
 * Pure functions — no GPU types, no side effects.
 * All values tuned to approximate the original arcade ROM.
 */

import type { Invader } from './entities.js';
import {
  invaderTypeForRow,
  INVADER_GRID_START_X,
  INVADER_GRID_START_Y,
  INVADER_CELL_W,
  INVADER_CELL_H,
} from './entities.js';

// ─── Grid dimensions ──────────────────────────────────────────────────────────

export const GRID_COLS = 11;
export const GRID_ROWS = 5;

// ─── Speed table ─────────────────────────────────────────────────────────────

/**
 * Lookup table: number of 60Hz ticks between invader grid steps.
 * Keyed on "invaders alive" count (lower alive → faster).
 *
 * Source: approximate arcade ROM values.
 * Format: [minAlive, framesPerStep]  — applies when alive >= minAlive.
 * Table is sorted descending so the first matching entry wins.
 */
const SPEED_TABLE: ReadonlyArray<[number, number]> = [
  [55, 24],
  [43, 21],
  [31, 18],
  [22, 15],
  [16, 11],
  [11,  8],
  [ 8,  6],
  [ 5,  4],
  [ 4,  3],
  [ 3,  2],
  [ 2,  2],
  [ 1,  1],
];

/**
 * Return the number of 60Hz ticks between grid steps for `alive` invaders.
 * Matches the arcade ROM lookup table from CLAUDE.md.
 */
export function framesPerStep(alive: number): number {
  for (const [minAlive, frames] of SPEED_TABLE) {
    if (alive >= minAlive) return frames;
  }
  // Fallback for 0 alive (should never be called — wave ends before this)
  return 1;
}

/**
 * Starting frames-per-step for wave N (1-indexed).
 * Each wave starts faster than the last: max(48 − 5·(N−1), 16).
 *
 * This sets where on the speed table the wave begins;
 * the full table still applies as invaders die.
 */
export function startFrames(waveN: number): number {
  // Per test/spec: each wave subtracts 3 frames from the 24-frame baseline,
  // floored at 8: startFrames = max(24 - 3*(N-1), 8)
  return Math.max(24 - 3 * (waveN - 1), 8);
}

/**
 * Maximum frames-per-step allowed at a given difficulty level.
 * Level 1 = 48 (uncapped). Each level subtracts 4 frames, floored at 8.
 * Applied as an upper bound on framesPerStep so higher levels start faster
 * even with a full grid of 55 invaders.
 */
export function levelSpeedCap(level: number): number {
  return Math.max(24 - 6 * (level - 1), 4);
}

// ─── Wave start row drop ──────────────────────────────────────────────────────

/** Pixels to drop the grid start per cleared wave (waves 2+). */
const WAVE_ROW_DROP_PX = 8;

/** Maximum number of wave-drops applied (waves 4+ all start at same row). */
const MAX_WAVE_DROPS = 3;

/**
 * Y offset (in px) to add to the grid start for wave N (1-indexed).
 * Drops by 8px per wave, capped after 3 waves.
 */
export function waveStartYOffset(waveN: number): number {
  const drops = Math.min(waveN - 1, MAX_WAVE_DROPS);
  return drops * WAVE_ROW_DROP_PX;
}

// ─── Grid spawner ─────────────────────────────────────────────────────────────

/**
 * Build the full 5×11 invader grid for a given wave.
 * Returns 55 Invader objects, all alive, at their starting positions.
 *
 * Position is the center of the invader sprite in playfield pixels.
 * The grid origin (top-left of the top-left invader) is derived from
 * INVADER_GRID_START_X + INVADER_GRID_START_Y adjusted by wave drop.
 */
export function spawnInvaderGrid(waveN: number = 1): Invader[] {
  const invaders: Invader[] = [];

  const gridOriginY = INVADER_GRID_START_Y + waveStartYOffset(waveN);

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      invaders.push({
        col,
        row,
        type: invaderTypeForRow(row),
        alive: true,
        frame: 0,
      });
    }
  }

  // Attach grid position data — we expose gridX/gridY via the InvaderGrid
  // rather than on each Invader. The Invader struct itself is position-agnostic
  // (col/row indices only); the renderer uses the grid offset + cell size.
  void gridOriginY; // used by makeInvaderGrid below

  return invaders;
}

// ─── InvaderGrid ──────────────────────────────────────────────────────────────

/**
 * Runtime grid state.
 * The grid moves as a unit — individual invader positions are derived
 * from gridX + col*cellW, gridY + row*cellH.
 */
export interface InvaderGrid {
  /** Invaders, row-major (index = row * GRID_COLS + col) */
  invaders: Invader[];
  /** Top-left of the grid in playfield pixels (mutable — grid moves) */
  gridX: number;
  gridY: number;
  /** +1 = moving right, -1 = moving left */
  dir: 1 | -1;
  /** Ticks elapsed since last grid step */
  stepAccum: number;
  /** Current frames-per-step (derived from alive count + wave tempo offset) */
  framesPerStepNow: number;
  /** The baseline frames-per-step for this wave (from startFrames) */
  waveStartFrames: number;
  /** Current animation frame (toggled on each grid step) */
  animFrame: 0 | 1;
}

/**
 * Create the initial InvaderGrid for a given wave.
 */
export function makeInvaderGrid(waveN: number = 1): InvaderGrid {
  const invaders = spawnInvaderGrid(waveN);
  const ws = startFrames(waveN);

  return {
    invaders,
    gridX: INVADER_GRID_START_X,
    gridY: INVADER_GRID_START_Y + waveStartYOffset(waveN),
    dir: 1,
    stepAccum: 0,
    framesPerStepNow: ws,
    waveStartFrames: ws,
    animFrame: 0,
  };
}

/**
 * Return count of alive invaders.
 */
export function aliveCount(grid: InvaderGrid): number {
  return grid.invaders.filter((inv) => inv.alive).length;
}

/**
 * Return the world-space center X of an invader given the grid state.
 * Uses the invader's col and the grid's current gridX.
 */
export function invaderWorldX(grid: InvaderGrid, inv: Invader): number {
  return grid.gridX + inv.col * INVADER_CELL_W + INVADER_CELL_W / 2;
}

/**
 * Return the world-space center Y of an invader given the grid state.
 */
export function invaderWorldY(grid: InvaderGrid, inv: Invader): number {
  return grid.gridY + inv.row * INVADER_CELL_H + INVADER_CELL_H / 2;
}

/**
 * Columns that have at least one alive invader, with the bottom-most
 * alive invader's row index per column. Used for the fire policy.
 */
export function bottomInvadersPerColumn(
  grid: InvaderGrid,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const inv of grid.invaders) {
    if (!inv.alive) continue;
    const existing = result.get(inv.col);
    if (existing === undefined || inv.row > existing) {
      result.set(inv.col, inv.row);
    }
  }
  return result;
}
