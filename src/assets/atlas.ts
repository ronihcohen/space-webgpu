/**
 * Atlas layout — 256×256 px, nearest-neighbor sampler (no mip-maps).
 *
 * UV-derivation strategy: option (a) from CLAUDE.md — grid-based helper.
 * The atlas is divided into two zones:
 *
 *   SPRITE ZONE  y =  0 .. 47   hand-placed sprites on a pixel grid
 *   FONT ZONE    y = 48 .. 71   8×8 glyph cells, 32 columns × 3 rows
 *                               ASCII 0x20 (space) .. 0x7E (~) = 95 glyphs
 *
 * Coordinates exposed here are UV fractions (0..1).  All sprites are
 * authored in the atlas at the pixel positions documented below.
 *
 * Color palette (full-color v1 — deliberate stylistic choice, not a
 * limitation; see README for rationale):
 *   Player cannon     white   #FFFFFF
 *   Invader type A    white   #FFFFFF  (bottom 2 rows, 10 pts each)
 *   Invader type B    yellow  #FFE000  (middle 2 rows, 20 pts each)
 *   Invader type C    green   #00FF70  (top row, 30 pts each)
 *   UFO               red     #FF2020
 *   Barriers          green   #00FF00
 *   Score / HUD text  green   #00FF00
 *   Explosions        orange  #FF8000
 *   Player bullet     white   #FFFFFF
 *   Enemy bullets     orange  #FF8000
 *
 * Audio inventory (sourced in Phase 5 — listed here so licensing is
 * considered alongside atlas art):
 *   shoot.wav          — player fires
 *   invader_hit.wav    — invader destroyed
 *   player_hit.wav     — player hit
 *   invader_step_0.wav — 4-note descending loop, note 0 (lowest pitch)
 *   invader_step_1.wav — note 1
 *   invader_step_2.wav — note 2
 *   invader_step_3.wav — note 3 (highest pitch)
 *   ufo_loop.wav       — continuous loop during UFO pass
 *   ufo_hit.wav        — UFO destroyed
 *
 * Audio mixing model:
 *   One-shot sounds: decode once → AudioBuffer; create fresh
 *   AudioBufferSourceNode per trigger (self-disposing).
 *   UFO loop: single long-lived source, start/stop for the pass duration.
 *
 * Third-party art / audio: see README "Assets" section for license notes.
 * Any CC0-licensed sprite packs or Web Audio synthesized sounds must be
 * documented there before Phase 5 ships.
 */

// ─── Atlas dimensions ────────────────────────────────────────────────────────

export const ATLAS_W = 256;
export const ATLAS_H = 256;

// ─── UV helper ───────────────────────────────────────────────────────────────

/**
 * Convert pixel coordinates in the atlas to UV fractions.
 * Returns [u, v, uWidth, vHeight] suitable for the instance buffer.
 *
 * px, py  — top-left pixel position in the atlas
 * pw, ph  — width and height in pixels
 */
export function uvFor(
  px: number,
  py: number,
  pw: number,
  ph: number,
): [number, number, number, number] {
  return [px / ATLAS_W, py / ATLAS_H, pw / ATLAS_W, ph / ATLAS_H];
}

// ─── Sprite pixel positions (locked — do not change after atlas is drawn) ────
//
// SPRITE ZONE layout (y = 0..47):
//
//  y=0..15  — row 0: misc sprites on 16-px vertical slots
//             x=  0  player cannon     16×8
//             x= 16  UFO               24×8
//             x= 40  invader explosion 16×8  (1 frame)
//             x= 56  player explosion  16×8  frame 0
//             x= 72  player explosion  16×8  frame 1
//
//  y=16..31 — row 1: invader sprites (all ≤12×8)
//             x=  0  invader A frame 0  12×8
//             x= 12  invader A frame 1  12×8
//             x= 24  invader B frame 0  12×8
//             x= 36  invader B frame 1  12×8
//             x= 48  invader C frame 0  12×8
//             x= 60  invader C frame 1  12×8
//
//  y=32..39 — row 2: bullet sprites (all 3×8 wide, 8 px tall)
//             x=  0  player bullet      3×8
//             x=  4  enemy bullet straight 3×8
//             x=  8  enemy bullet zigzag  3×8  (reserved, v1 unused)
//             x= 12  enemy bullet fast    3×8  (reserved, v1 unused)
//
// FONT ZONE layout (y = 48..71):
//   32 columns of 8-px wide cells, 3 rows of 8-px tall cells.
//   Glyph index = ASCII codepoint − 0x20 (space=0, '!'=1, … '~'=94).
//   col = index % 32,  row = Math.floor(index / 32)
//   Pixel origin: x = col*8, y = 48 + row*8

// ─── Named sprite UV constants ────────────────────────────────────────────────

/** Player cannon (white, 16×8) */
export const UV_PLAYER = uvFor(0, 0, 16, 8);

/** UFO / mystery ship (red, 24×8) */
export const UV_UFO = uvFor(16, 0, 24, 8);

/** Invader explosion — shared for all invader types (orange, 16×8) */
export const UV_INVADER_EXPLOSION = uvFor(40, 0, 16, 8);

/** Player explosion frame 0 (orange, 16×8) */
export const UV_PLAYER_EXPLOSION_0 = uvFor(56, 0, 16, 8);

/** Player explosion frame 1 (orange, 16×8) */
export const UV_PLAYER_EXPLOSION_1 = uvFor(72, 0, 16, 8);

// Invader type A — bottom 2 rows — 10 pts — white
export const UV_INVADER_A_0 = uvFor(0, 16, 12, 8);
export const UV_INVADER_A_1 = uvFor(12, 16, 12, 8);

// Invader type B — middle 2 rows — 20 pts — yellow
export const UV_INVADER_B_0 = uvFor(24, 16, 12, 8);
export const UV_INVADER_B_1 = uvFor(36, 16, 12, 8);

// Invader type C — top row — 30 pts — green
export const UV_INVADER_C_0 = uvFor(48, 16, 12, 8);
export const UV_INVADER_C_1 = uvFor(60, 16, 12, 8);

/** Player bullet (white, 3×8) */
export const UV_BULLET_PLAYER = uvFor(0, 32, 3, 8);

/** Enemy bullet — straight type (orange, 3×8) */
export const UV_BULLET_ENEMY_STRAIGHT = uvFor(4, 32, 3, 8);

/** Enemy bullet — zigzag type (reserved, not used in v1) */
export const UV_BULLET_ENEMY_ZIGZAG = uvFor(8, 32, 3, 8);

/** Enemy bullet — fast type (reserved, not used in v1) */
export const UV_BULLET_ENEMY_FAST = uvFor(12, 32, 3, 8);

// ─── Font UV helper ──────────────────────────────────────────────────────────

/** Font zone constants */
export const FONT_CELL_W = 8;
export const FONT_CELL_H = 8;
export const FONT_COLS = 32;
export const FONT_ORIGIN_Y = 48; // pixel y where the font zone starts
export const FONT_ASCII_OFFSET = 0x20; // ' ' (space) is glyph 0

/**
 * Return UV fractions for an ASCII character code point (0x20..0x7E).
 * Characters outside that range fall back to the space glyph (blank).
 *
 * Usage: `uvForGlyph('A'.charCodeAt(0))` → [u, v, uW, vH]
 */
export function uvForGlyph(
  codePoint: number,
): [number, number, number, number] {
  const index = Math.max(
    0,
    Math.min(94, codePoint - FONT_ASCII_OFFSET),
  );
  const col = index % FONT_COLS;
  const row = Math.floor(index / FONT_COLS);
  return uvFor(
    col * FONT_CELL_W,
    FONT_ORIGIN_Y + row * FONT_CELL_H,
    FONT_CELL_W,
    FONT_CELL_H,
  );
}

/**
 * Convenience: return UV for each character in a string.
 * Caller is responsible for laying out quads left-to-right.
 */
export function uvForString(
  str: string,
): Array<[number, number, number, number]> {
  const result: Array<[number, number, number, number]> = [];
  for (let i = 0; i < str.length; i++) {
    result.push(uvForGlyph(str.charCodeAt(i)));
  }
  return result;
}

// ─── Sprite size constants (game units, matches atlas pixel sizes 1:1) ────────

export const SPRITE_SIZES = {
  player:          { w: 16, h: 8 },
  ufo:             { w: 24, h: 8 },
  invaderA:        { w: 12, h: 8 },
  invaderB:        { w: 12, h: 8 },
  invaderC:        { w: 12, h: 8 },
  invaderExplosion:{ w: 16, h: 8 },
  playerExplosion: { w: 16, h: 8 },
  bulletPlayer:    { w:  3, h: 8 },
  bulletEnemy:     { w:  3, h: 8 },
} as const;
