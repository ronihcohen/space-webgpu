---
name: project-phase-status
description: Current completion status of each Space Invaders WebGPU implementation phase
metadata:
  type: project
---

Space Invaders WebGPU phase completion status as of 2026-05-24.

**Why:** Track what's done so future agents don't re-implement completed work.
**How to apply:** Start from the lowest incomplete phase; verify existing code before assuming a phase is done.

## Phase 0 — Assets: COMPLETE (scaffolded)
- Atlas dimensions locked: 256×256 px (`ATLAS_W`, `ATLAS_H` in `atlas.ts`)
- UV strategy: option (a) — grid-based `uvFor(px, py, pw, ph)` helper + named constants
- All sprite UV constants defined in `atlas.ts`
- Barrier mask as `Uint8Array` literal in `entities.ts` (22×16 = 352 bytes)
- Splash masks (`SPLASH_UP_OFFSETS`, `SPLASH_DOWN_OFFSETS`) in `entities.ts`
- Color palette documented in `atlas.ts` header
- `sprites.png` exists but is a placeholder (478 bytes) — real art needed for Phase 2 gate
- Audio inventory listed in `atlas.ts` — actual audio sourcing replaced by Web Audio synthesis in Phase 5

## Phase 1 — GPU bootstrap: COMPLETE
- WebGPU feature detect with readable error overlay
- `device.lost` → overlay + halt (no auto re-acquire, intentional)
- Canvas configured with integer scaling + DPR
- RAF loop confirmed running

## Phase 2 — Sprite rendering: COMPLETE (pipeline built)
- Atlas loaded via `createImageBitmap` → `copyExternalImageToTexture`
- Instanced sprite shader (`sprite.wgsl`) with 8-float-per-instance layout
- Full render pipeline with nearest-neighbor sampler
- `writeInstance()` helper exported from `renderer.ts`
- Projection matrix: orthographic, top-left origin, column-major
- NOTE: `sprites.png` is a placeholder — visual verification requires real atlas art

## Phase 3 — Game state + input: COMPLETE
- Entity interfaces: `Player`, `Invader`, `Bullet`, `BarrierMask` in `entities.ts`
- State machine: `makeGameState`, `startGame`, `togglePause`, `autoPause`, `triggerGameOver`, `triggerWin`, `returnToIdle` in `state.ts`
- `spawner.ts`: `makeInvaderGrid` builds 5×11 grid, speed table, `framesPerStep`, `startFrames`
- `input.ts`: `isDown`, `wasPressed`, `isDownEither`, `attachInputListeners`
- `preventDefault` on Space + Arrows in `input.ts`
- Auto-pause wired in `main.ts` for `window.blur` AND `document.visibilitychange`

## Phase 3.5 — First playable: COMPLETE
- Fixed-timestep accumulator (DT=1/60, MAX_FRAME=0.25) in `main.ts`
- Player moves left/right (Arrows + WASD) at 80 px/sec
- Player fires one bullet (Space, one-bullet rule enforced)
- One row of 11 static invaders spawned
- AABB collision: bullet kills invader, removes bullet
- `window.__game` debug hook: state, score, lives, bullets, invaders, start(), reset(), advance(n)
- Debug hook tree-shaken from production (verified with `npm run build` grep)
- IDLE→PLAYING on Space or P; P toggles pause; blur/visibilitychange auto-pause

## Phase 4 — Simulation: COMPLETE (2026-05-24)
- Fixed-timestep accumulator: DT=1/60, MAX_FRAME=0.25, in main.ts game loop
- Player movement (Arrows+WASD), one-bullet rule via `bullets.some(b => b.owner==='player')`
- Full 5×11 grid with edge detection (leftmost/rightmost alive cols tracked), 2px step, 8px drop on wall
- Speed table via `framesPerStep(alive)` called each step (counts ticks to fps threshold)
- Invader fire: bottom-of-column policy, max-3-enemy-bullets cap, INVADER_FIRE_CHANCE=1/120 per tick
- AABB collision: bullet↔invader, bullet↔player; bullet↔bullet passthrough (by spec)
- Per-pixel barrier collision: sweptBulletBarrierHit + applySplash, barriers rendered as 1×1 quads
- Lives, respawn: 2-frame explosion animation, EXPLOSION_FRAME_DURATION=0.25s per frame
- Invuln: PLAYER_INVULN_DURATION=1.5s, flashing sprite every 10 ticks
- Game-over: invaders reaching player y, or player lives=0
- Win: all invaders cleared, transitions to WIN→advanceWave→IDLE
- Barrier rendering: BarrierTextures interface on Renderer; 1×1 pixel quads per solid mask pixel
- `window.__game` debug hook: state, score, lives, bullets, invaders, barrierMaskAt, start, reset, advance

## Phase 5 — Feel + polish: COMPLETE (2026-05-24)
- Invader 2-frame animation: animFrame toggles on each grid step (synced to movement, not a timer)
- UFO cameo: Ufo interface in entities.ts; spawn timer [UFO_SPAWN_MIN_S=20, UFO_SPAWN_MAX_S=35]s;
  enters from left at UFO_SPEED=50px/s; AABB collision with player bullet; RNG score from UFO_SCORE_VALUES
- Starfield background: fullscreen-quad fragment shader (starfield.wgsl) drawn in pass 1;
  sprite pass 2 uses loadOp:'load' to preserve starfield
- Sound effects: src/game/sound.ts — all sounds synthesized via Web Audio oscillators (no .wav files);
  AudioContext created lazily on resume(); resume() called on IDLE→PLAYING gesture;
  sounds: shoot (square wave), invaderHit (sawtooth), playerHit (2-layer), invaderStep (4-note loop),
  ufoStart/ufoStop (LFO-modulated sawtooth), ufoHit (descending sweep)
- HUD: score, hi-score (centered), lives (top-right) rendered as sprite-atlas bitmap font quads;
  phase overlays: IDLE title+prompt, PAUSED, GAME_OVER with score, WIN with score
- localStorage high score: persisted in state.ts via HIGH_SCORE_KEY, loaded on makeGameState()

## Phase 6 — Hardening: PARTIALLY COMPLETE (2026-05-25)

### Done:
- Vitest unit tests: 132 tests across 4 files, all passing
  - `physics.test.ts` (24 tests): AABB, swept collision, splash, out-of-bounds guards
  - `spawner.test.ts` (54 tests): grid spawn, framesPerStep table boundaries, startFrames, wave drop, fire eligibility, aliveCount
  - `state.test.ts` (38 tests): all legal/illegal transitions, high score, score, wave
  - `input.test.ts` (16 tests): isDown, wasPressed edge contract, isDownEither
- Resize handling: already implemented in renderer.ts — setTimeout(100ms) throttle (~10Hz), calls `configureCanvas` (no pipeline rebuild)
- Production build verified: 30.13 kB JS, `__game` not in dist

### Pending (manual verification only):
- Frame-rate independence sanity check (Chrome devtools → Rendering → Frame rendering stats)
- Background-tab return: switch tabs for 30s, return, confirm no freeze (tests MAX_FRAME clamp)
- Production build size + load time check (manual/subjective)
