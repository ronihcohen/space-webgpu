---
name: project-architecture-decisions
description: Key architectural decisions and constants locked during implementation
metadata:
  type: project
---

Architecture decisions locked during Phase 0–3.5 implementation.

**Why:** These are locked constants and patterns that must not drift across phases.
**How to apply:** When adding features, match existing patterns and respect locked dimensions.

## Atlas
- Dimensions: 256×256 px (locked)
- UV strategy: `uvFor(px, py, pw, ph)` in `atlas.ts` → `[u, v, uw, vh]` tuples
- Sprite zone: y=0..47; Font zone: y=48..71 (8×8 glyphs, ASCII 0x20..0x7E)
- Nearest-neighbor sampler: `magFilter:'nearest'`, `minFilter:'nearest'`

## Playfield
- Virtual size: 224×256 px (original arcade resolution)
- Orthographic projection: top-left origin, column-major, Y-flipped
- Integer DPR scaling: largest N where 224N ≤ viewportW and 256N ≤ viewportH

## Instance buffer
- Layout: 8 × f32 per sprite = 32 bytes
  - [0,1] = x,y (top-left in playfield px)
  - [2,3] = w,h (playfield px)
  - [4,5] = atlasU, atlasV (UV top-left)
  - [6,7] = atlasW, atlasH (UV extent)
- MAX_INSTANCES = 512

## Fixed timestep
- DT = 1/60 sec
- MAX_FRAME = 0.25 sec (clamps catch-up to 15 ticks max)

## Entity positions
- Player start: (112, 240) = (PLAYFIELD_W/2, PLAYFIELD_H-16)
- Player speed: 80 px/sec
- Player bullet speed: -180 px/sec (upward)
- Enemy bullet speed: +90 px/sec (downward)
- Invader grid start: (16, 52)
- Invader cell size: 16×16 px
- Barrier Y: 200 px; 4 barriers at x = 24, 70, 116, 162

## Sprite sizes (from atlas layout)
- Player: 16×8
- Invaders (A/B/C): 12×8
- UFO: 24×8
- Bullets (player/enemy): 3×8
- Explosions: 16×8
- Font glyphs: 8×8

## Speed table (framesPerStep)
55→48, 43+→43, 31+→37, 22+→30, 16+→22, 11+→16, 8+→11, 5+→8, 4→5, 3→3, 2→2, 1→1
Wave N start: max(48-5*(N-1), 16)
Wave drop: 8px per wave, capped at 3 drops

## Bind group layout
- Group 0: uniform buffer (proj matrix + time), vertex+fragment visibility
- Group 1: atlas texture (float) + nearest sampler, fragment visibility only

## Debug hook
- `window.__game` exposed only in DEV and MODE==='test'
- Properties: state, score, lives, bullets, invaders
- Methods: start(), reset(), advance(ticks), barrierMaskAt(x, y)
- Verified tree-shaken from prod build (grep dist/ for __game returns nothing)

## Barrier rendering approach (Phase 4)
- Barriers rendered as per-pixel 1×1 quads in the instance buffer (one quad per solid mask pixel)
- Uses atlas pixel at (0/256, 47/256) — solid green pixel in sprite zone bottom row
- CPU mask is authoritative; `renderer.barriers.upload(i, mask)` copies to renderer's local arrays
- `renderer.barriers.instances(positions, y)` materializes SpriteInstances for the draw call
- Worst case: 4 barriers × 352 pixels + 55 invaders + player + bullets + explosions ≈ 1480 instances
- MAX_INSTANCES bumped to 2048 to handle full-health barriers safely

## Grid step implementation
- `gridStepAccum` counts 60Hz ticks; steps when accumulator >= framesPerStep(alive)
- Step size: 2px horizontal per step
- Edge detection: tracks minCol and maxCol of alive invaders; tests leftEdge<0 or rightEdge>PLAYFIELD_W
- On wall hit: revert x move, flip direction, drop 8px
- Animation frame toggled on each step (synced to movement per spec)
