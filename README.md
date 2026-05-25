# Space Invaders — WebGPU

A browser-based Space Invaders clone rendered entirely with the WebGPU API.
No Canvas 2D. No WebGL.

**[Play the live demo](https://ronihcohen.github.io/space-webgpu/)**

See [CLAUDE.md](./CLAUDE.md) for full architecture, game logic, and implementation phases.

---

## Quick start

```bash
npm install
npm run dev       # Vite dev server with HMR
npm run build     # Production build → dist/
npm run test      # Vitest (game logic only, no browser)
npm run test:e2e  # Playwright (requires local GPU)
```

---

## Phase 0 — Asset & Decision Log

All decisions below are locked before any art is drawn or Phase 2 begins.
Changing atlas dimensions after Phase 2 ships means regenerating all UV constants.

### Atlas dimensions

**Chosen: 256×256 px.**

Rationale: the bitmap font alone occupies ~3200 px² (50+ glyphs × 8×8).
Add sprite rows and 128×128 is tight; 256×256 leaves headroom for polish
(additional explosion frames, score multiplier glyphs, etc.) without
meaningfully increasing download size or GPU memory.

### Color palette

**v1 is full color.** This is a deliberate stylistic choice, not a
limitation of the WebGPU rendering path:

| Element | Color | Hex |
|---------|-------|-----|
| Player cannon | White | `#FFFFFF` |
| Invader type A (bottom 2 rows, 10 pts) | White | `#FFFFFF` |
| Invader type B (middle 2 rows, 20 pts) | Yellow | `#FFE000` |
| Invader type C (top row, 30 pts) | Green | `#00FF70` |
| UFO / mystery ship | Red | `#FF2020` |
| Barriers | Green | `#00FF00` |
| Score / HUD text | Green | `#00FF00` |
| Explosions (player + invader) | Orange | `#FF8000` |
| Player bullet | White | `#FFFFFF` |
| Enemy bullets | Orange | `#FF8000` |

The arcade original used a black-and-white CRT with cellophane color
overlays.  Reproducing that requires either a monochrome atlas with a
per-region tint uniform (extra shader complexity) or compositing
cellophane quads over the sprite pass (extra draw calls).  Neither adds
gameplay value.  Full color in the atlas is the simpler, correct path
for a WebGPU clone — one atlas, one draw call, done.

### UV-derivation strategy

**Chosen: option (a) — grid-based helper + named constants.**

`src/assets/atlas.ts` exports:
- `uvFor(px, py, pw, ph)` — converts pixel coordinates to UV fractions
- `uvForGlyph(codePoint)` — maps ASCII 0x20..0x7E to font zone UVs
- `uvForString(str)` — convenience wrapper for HUD text
- Named constants (`UV_PLAYER`, `UV_INVADER_A_0`, etc.) for every sprite

The atlas is divided into two zones:

```
SPRITE ZONE  y =  0..47   hand-placed named sprites
FONT ZONE    y = 48..71   8×8 glyph cells, ASCII 0x20-0x7E
                          32 cols × 3 rows
```

Sprite layout (pixel origin locked):

| Sprite | x | y | w | h |
|--------|---|---|---|---|
| Player cannon | 0 | 0 | 16 | 8 |
| UFO | 16 | 0 | 24 | 8 |
| Invader explosion | 40 | 0 | 16 | 8 |
| Player explosion frame 0 | 56 | 0 | 16 | 8 |
| Player explosion frame 1 | 72 | 0 | 16 | 8 |
| Invader A frame 0 | 0 | 16 | 12 | 8 |
| Invader A frame 1 | 12 | 16 | 12 | 8 |
| Invader B frame 0 | 24 | 16 | 12 | 8 |
| Invader B frame 1 | 36 | 16 | 12 | 8 |
| Invader C frame 0 | 48 | 16 | 12 | 8 |
| Invader C frame 1 | 60 | 16 | 12 | 8 |
| Player bullet | 0 | 32 | 3 | 8 |
| Enemy bullet (straight) | 4 | 32 | 3 | 8 |
| Enemy bullet (zigzag, reserved) | 8 | 32 | 3 | 8 |
| Enemy bullet (fast, reserved) | 12 | 32 | 3 | 8 |

Font zone: glyph index = `codePoint − 0x20`. Column = `index % 32`,
row = `Math.floor(index / 32)`. Pixel origin: `x = col*8`, `y = 48 + row*8`.

### Barrier masks

Barrier collision is **CPU-side only** — the mask lives as a `Uint8Array`
in `src/game/entities.ts`, not in the atlas.  The GPU texture is a
mirror updated via `writeTexture` after each splash.  This avoids two
sources of truth and means the barrier shape never depends on atlas art.

The initial 22×16 mask is committed as a literal in `entities.ts`
(352 bytes per barrier).  Splash patterns (player bullet travelling up,
enemy bullet travelling down) are also hardcoded offset arrays.

### Audio inventory

Planned for Phase 5.  Source from a CC0 retro sound pack or synthesize
with Web Audio oscillators.  Files needed:

| File | Description |
|------|-------------|
| `shoot.wav` | Player fires |
| `invader_hit.wav` | Invader destroyed |
| `player_hit.wav` | Player hit |
| `invader_step_0.wav` | 4-note invader march, note 0 (lowest) |
| `invader_step_1.wav` | Note 1 |
| `invader_step_2.wav` | Note 2 |
| `invader_step_3.wav` | Note 3 (highest) |
| `ufo_loop.wav` | UFO pass continuous loop |
| `ufo_hit.wav` | UFO destroyed |

Mixing model: one-shot sounds use a fresh `AudioBufferSourceNode` per
trigger (self-disposing, no pooling needed).  The UFO loop is the
exception: a single long-lived source node, started and stopped for
each UFO pass.  `AudioContext` starts suspended; `context.resume()` is
called from the keydown handler that transitions `IDLE → PLAYING`.

### Assets source and license

All sprites and audio assets were created from scratch — original work,
no third-party licensing concerns.

---

## UFO scoring note

The arcade original awards UFO points based on the player's total shot
count — a quirk speedrunners exploit.  v1 uses plain RNG over
`[50, 100, 150, 300]`.  This is a deliberate simplification;
reproducing the shot-counter trick requires tracking shots-fired across
the whole game and is out of scope for v1.

---

## Input note

Keyboard only for v1.  On-screen touch controls are deliberately out of
scope.

---

## Out of scope (v1)

- Touch / on-screen controls
- WebGL fallback
- Multiplayer
- Mobile-portrait layout
- Asset hot-reload
