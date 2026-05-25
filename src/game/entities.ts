/**
 * Entity interfaces and barrier mask data.
 *
 * All types are plain data — no GPU types, no class methods.
 * Game logic (physics.ts, spawner.ts) imports from here;
 * renderer.ts imports from here for sizes/positions but never mutates.
 */

// ─── Invader type ─────────────────────────────────────────────────────────────

/** Row assignment → point value and sprite type */
export type InvaderType = 'A' | 'B' | 'C';

// Row 0 (top)      → type C → 30 pts
// Rows 1-2 (mid)   → type B → 20 pts
// Rows 3-4 (bot)   → type A → 10 pts
export function invaderTypeForRow(row: number): InvaderType {
  if (row === 0) return 'C';
  if (row <= 2) return 'B';
  return 'A';
}

export function pointsForInvaderType(type: InvaderType): number {
  if (type === 'C') return 30;
  if (type === 'B') return 20;
  return 10;
}

// ─── Entity interfaces ────────────────────────────────────────────────────────

export interface Player {
  x: number;        // center x in playfield units
  y: number;        // center y
  lives: number;
  /** null = alive; non-null = frame index into explosion animation */
  explodeFrame: number | null;
  /** seconds remaining in invulnerability window after respawn */
  invulnTimer: number;
  /** seconds remaining in the explosion-freeze before respawn */
  explodeTimer: number;
}

export type InvaderAnimFrame = 0 | 1;

export interface Invader {
  col: number;       // 0..10 (column in the grid)
  row: number;       // 0..4  (row in the grid — 0 = top)
  type: InvaderType;
  alive: boolean;
  /** animation frame — toggled on each grid step */
  frame: InvaderAnimFrame;
}

// ─── UFO ──────────────────────────────────────────────────────────────────────

/**
 * UFO (mystery ship) that crosses the top of the screen.
 * Scores random points when shot (see UFO_SCORE_VALUES).
 *
 * NOTE: The arcade original awards points based on the player's shot count,
 * not RNG — this is a deliberate simplification documented here and in CLAUDE.md.
 */
export interface Ufo {
  /** Center x in playfield units (moves horizontally) */
  x: number;
  /** Movement direction: +1 = right-to-left entry is left-to-right, actually
   *  UFOs always enter from one side. We simplify: always enter from left (+1 dir). */
  dir: 1 | -1;
  /** Whether the UFO is actively on screen */
  active: boolean;
  /** Countdown to next UFO appearance (seconds). Reset after UFO exits or is shot. */
  spawnTimer: number;
}

export type BulletOwner = 'player' | 'enemy';

export interface Bullet {
  x: number;
  y: number;
  /** pixels per second, positive = moving down (enemy), negative = moving up (player) */
  vy: number;
  owner: BulletOwner;
  /** previous y position — used for swept barrier collision */
  prevY: number;
}

// ─── Barrier mask ─────────────────────────────────────────────────────────────

/**
 * Barrier dimensions.
 * 22 px wide × 16 px tall — matches the original arcade silhouette.
 * One byte per pixel: 255 = solid, 0 = transparent.
 * Row-major order: pixel[row * BARRIER_W + col]
 */
export const BARRIER_W = 22;
export const BARRIER_H = 16;

/**
 * Initial barrier mask — hand-drawn `Uint8Array` literal.
 * Shape: rounded top, solid body, notched arch at the bottom center.
 *
 * The arch is load-bearing — it is where the player crouches to fire.
 * The arch opening is 8 px wide × 4 px tall, centered horizontally
 * (columns 7..14 in a 22-wide mask), cut from the bottom four rows.
 *
 * Visualization (. = empty, # = solid, 22 cols × 16 rows):
 *   row  0:  ..################..   (2-px rounded corners)
 *   row  1:  .##################.
 *   row  2:  ######################
 *   rows 3–11: ######################  (full solid body)
 *   row 12:  #######........#######   (arch begins, 8-px gap cols 7–14)
 *   row 13:  #######........#######
 *   row 14:  #######........#######
 *   row 15:  #######........#######
 *
 * Arch gap: columns 7, 8, 9, 10, 11, 12, 13, 14 (8 columns)
 */
const S = 255; // solid
const E =   0; // empty

// fmt: off — keep as pixel art; do not auto-format this block
export const BARRIER_MASK_INITIAL = new Uint8Array([
  // row 0  (rounded top corners — cols 0-1 and 20-21 empty)
  E, E, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, E, E,
  // row 1  (single-pixel corner rounding)
  E, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, E,
  // row 2  (full width)
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 3
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 4
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 5
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 6
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 7
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 8
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 9
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 10
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 11
  S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S,
  // row 12  (arch begins — cols 7-14 empty)
  S, S, S, S, S, S, S, E, E, E, E, E, E, E, E, S, S, S, S, S, S, S,
  // row 13
  S, S, S, S, S, S, S, E, E, E, E, E, E, E, E, S, S, S, S, S, S, S,
  // row 14
  S, S, S, S, S, S, S, E, E, E, E, E, E, E, E, S, S, S, S, S, S, S,
  // row 15
  S, S, S, S, S, S, S, E, E, E, E, E, E, E, E, S, S, S, S, S, S, S,
]);
// fmt: on

// Verify the array length at type-check time (352 bytes = 22 × 16)
const _barrierLengthCheck: 352 = BARRIER_MASK_INITIAL.length as 352;
void _barrierLengthCheck;

/**
 * Return a fresh mutable copy of the initial barrier mask.
 * Call once per barrier per wave start — do NOT share the literal.
 */
export function makeBarrierMask(): Uint8Array {
  return new Uint8Array(BARRIER_MASK_INITIAL);
}

/**
 * BarrierMask holds runtime state for one barrier.
 * `mask` is the authoritative CPU-side pixel data; the GPU texture
 * mirrors it via `writeTexture` after every mutation.
 */
export interface BarrierMask {
  /** Pixel data — 1 byte per pixel, row-major, 0=empty 255=solid */
  mask: Uint8Array;
  /** Top-left position in the virtual 224×256 playfield */
  x: number;
  y: number;
}

/**
 * Splash mask for a PLAYER bullet (travelling upward).
 * Applied at the impact pixel (impactCol, impactRow).
 * Shape: 4-wide × 3-tall notch, biased upward, ragged corners.
 *
 * Offsets relative to impact point [dcol, drow]:
 *   row -2: center 2 px       (.##.)
 *   row -1: full 4 px         (####)
 *   row  0: full 4 px at hit  (####)  ← impact row
 *
 * Corner pixels in row -2 are removed for a ragged look.
 */
export const SPLASH_UP_OFFSETS: ReadonlyArray<[number, number]> = [
  // row -2 (topmost, narrow)
  [-1, -2], [0, -2], [1, -2],
  // row -1
  [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  // row 0 (impact row, wider)
  [-2,  0], [-1,  0], [0,  0], [1,  0], [2,  0],
];

/**
 * Splash mask for an ENEMY bullet (travelling downward).
 * Mirror of SPLASH_UP_OFFSETS — fans downward.
 *
 * Offsets relative to impact point [dcol, drow]:
 *   row  0: full 4 px at hit  (####)  ← impact row
 *   row +1: full 4 px         (####)
 *   row +2: center 2 px       (.##.)
 */
export const SPLASH_DOWN_OFFSETS: ReadonlyArray<[number, number]> = [
  // row 0 (impact row)
  [-2,  0], [-1,  0], [0,  0], [1,  0], [2,  0],
  // row +1
  [-2,  1], [-1,  1], [0,  1], [1,  1], [2,  1],
  // row +2 (bottommost, narrow)
  [-1,  2], [0,  2], [1,  2],
];

// ─── Playfield layout constants ───────────────────────────────────────────────

/** Virtual playfield (original arcade resolution) */
export const PLAYFIELD_W = 224;
export const PLAYFIELD_H = 256;

/** Player start position */
export const PLAYER_START_X = PLAYFIELD_W / 2;
export const PLAYER_START_Y = PLAYFIELD_H - 16;

/** Player movement speed (px/sec) */
export const PLAYER_SPEED = 80;

/** Player bullet speed (px/sec, negative = upward) */
export const BULLET_PLAYER_SPEED = -180;

/** Enemy bullet speed (px/sec, positive = downward) */
export const BULLET_ENEMY_SPEED = 130;

/** Invader grid starting position (top-left of the grid in playfield px) */
export const INVADER_GRID_START_X = 16;
export const INVADER_GRID_START_Y = 52;

/** Pixels between invader cell origins */
export const INVADER_CELL_W = 16;
export const INVADER_CELL_H = 16;

/** Barrier positions — 4 barriers, evenly spaced */
export const BARRIER_Y = 200;
export const BARRIER_POSITIONS: ReadonlyArray<number> = [
  24,   // x of left edge of barrier 0
  70,   // barrier 1
  116,  // barrier 2
  162,  // barrier 3
];

/** Player invulnerability duration after respawn (seconds) */
export const PLAYER_INVULN_DURATION = 1.5;

/** Duration of each explosion animation frame (seconds) */
export const EXPLOSION_FRAME_DURATION = 0.25;

/** Max enemy bullets on screen simultaneously */
export const MAX_ENEMY_BULLETS = 5;

/** Fire chance per eligible invader per 60Hz tick (~1/120) */
export const INVADER_FIRE_CHANCE = 1 / 70;

/** UFO scoring values (chosen by RNG — see README for deliberate simplification note) */
export const UFO_SCORE_VALUES: ReadonlyArray<number> = [50, 100, 150, 300];

/** UFO speed (px/sec) */
export const UFO_SPEED = 50;

/** UFO vertical position (center y) */
export const UFO_Y = 24;

/**
 * Minimum seconds between UFO appearances (after the UFO exits or is destroyed).
 * The arcade triggers a UFO every ~25 seconds on wave 1; we use a randomised
 * window: [UFO_SPAWN_MIN_S, UFO_SPAWN_MAX_S).
 */
export const UFO_SPAWN_MIN_S = 20;
export const UFO_SPAWN_MAX_S = 35;
