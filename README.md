# Space Invaders — WebGPU

A browser-based Space Invaders clone rendered entirely with the WebGPU API.
No Canvas 2D. No WebGL.

**[Play the live demo](https://ronihcohen.github.io/space-webgpu/)**

---

## Controls

| Key | Action |
|-----|--------|
| Arrow Left / A | Move left |
| Arrow Right / D | Move right |
| Space | Fire |
| P | Pause / resume |

---

## Features

- Full game loop: IDLE → PLAYING → GAME OVER / WIN → IDLE
- 5×11 invader grid with arcade-accurate speed table (faster as invaders die)
- **Level system**: each screen clear increases the difficulty — invaders move faster and shoot more often. Dying resets the level.
- Per-pixel barrier erosion — bullets carve asymmetric notches (upward fan for player shots, downward for enemy shots)
- UFO mystery ship with random score values (50 / 100 / 150 / 300)
- 3 lives with explosion animation and brief invulnerability on respawn
- Starfield background rendered as a fullscreen fragment shader
- Sound effects synthesized with Web Audio (shoot, invader march, hits, UFO)
- HUD rendered through the sprite pipeline — score, hi-score, lives, level
- High score persisted to `localStorage`
- Integer-scale canvas (nearest-neighbor, no blur) with DPR-aware resize

---

## Quick start

```bash
npm install
npm run dev       # Vite dev server with HMR
npm run build     # Production build → dist/
npm run test      # Vitest unit tests (game logic, no browser required)
```

---

## Architecture notes

### One draw call for everything

All sprites share a single 256×256 atlas texture. Each frame the CPU writes an instance buffer (position + atlas UV per visible sprite) and issues one instanced draw call. Player, invaders, bullets, barrier pixels, HUD glyphs — all in the same call. A second pass renders the starfield as a fullscreen quad.

### Barrier collision

Barrier collision is CPU-side only against a `Uint8Array` mask (22×16 px per barrier). The GPU texture is a mirror updated via `writeTexture` after each splash. Swept collision prevents fast bullets from tunneling through narrow mask slivers.

### Level difficulty

Each screen clear increments the level. The level tightens the upper bound on frames-per-step (`max(48 − 4·(level−1), 8)`) and scales invader fire chance up 30% per level (capped at ~5× base). Dying resets both to level-1 values, keeping the game survivable after respawn.

### UFO scoring

v1 uses plain RNG over `[50, 100, 150, 300]`. The arcade original keys the value on the player's shot count — a deliberate simplification, not an oversight.

---

## Technical stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Bundler | Vite |
| GPU API | WebGPU (WGSL shaders) |
| Tests | Vitest (pure game logic) |
| CI | GitHub Actions → GitHub Pages |

---

## Out of scope (v1)

- Touch / on-screen controls
- WebGL fallback
- Multiplayer
- Mobile-portrait layout
