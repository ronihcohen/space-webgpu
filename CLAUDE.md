# Space Invaders — WebGPU

A browser-based Space Invaders clone rendered entirely with the WebGPU API (no Canvas 2D, no WebGL).

---

## Project Goals

- Render all game graphics — including the HUD — through WebGPU render pipelines
- Keep the game logic in plain TypeScript, fully decoupled from the GPU layer
- Frame-rate independent simulation (fixed timestep) so the game feels the same on 60Hz and 144Hz
- Single static-page deploy: `npm run build` → drop `dist/` on any host

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Bundler | Vite (HMR + `?raw` shader imports) |
| GPU API | WebGPU (`navigator.gpu`) |
| Shaders | WGSL |
| Tests | Vitest (game logic only) |

TS is the load-bearing choice here: WebGPU descriptors are deeply nested and easy to mis-shape; the editor catching `GPUTextureView` vs `GPUTexture` at save-time is worth more than HMR.

---

## Architecture

```
src/
  main.ts            # entry: feature-detect → bootstrap → game loop
  gpu/
    renderer.ts      # device, pipeline, buffers, texture, draw — all in one file until it grows
  game/
    state.ts         # pure game state, state machine (IDLE | PLAYING | PAUSED | GAME_OVER | WIN)
    entities.ts      # Player, Invader, Bullet, BarrierMask — plain data
    physics.ts       # fixed-timestep update, AABB collision
    input.ts         # keyboard map, exposes isDown(key) + edge events
    spawner.ts       # invader grid, wave progression, invader fire policy
  shaders/
    sprite.wgsl      # instanced textured-quad vertex + fragment
    starfield.wgsl   # fullscreen-quad fragment shader, time uniform
  assets/
    sprites.png      # sprite atlas + bitmap font glyphs
index.html
```

Start with one `renderer.ts`. Split only when a file actually gets unwieldy — five GPU helper files for ~300 lines of code is YAGNI.

---

## Rendering Strategy

### One draw call for everything

All sprites share a single atlas texture. Each frame the CPU writes an instance buffer (one entry per visible sprite: `x, y, w, h, atlasU, atlasV, atlasW, atlasH`) and issues **one instanced draw call**. Player, ~55 invaders, bullets, ~80 barrier pixels, HUD glyphs — all in the same call. This is the natural fit for ~200 quads; don't frame instancing as a future upgrade.

A second pass renders the starfield background as a fullscreen quad with a fragment shader and a `time` uniform. No compute shader needed.

### Pipeline layout

```
starfield pass:  fullscreen quad → starfield.wgsl → color attachment
sprite pass:     instance buffer → sprite.wgsl   → color attachment (load, not clear)
```

Bind group 0 (per-frame uniforms): projection matrix + time
Bind group 1 (static): atlas texture + sampler

### Sampler

`magFilter: 'nearest'`, `minFilter: 'nearest'`. Linear filtering blurs pixel-art sprites.

### Coordinate system

Orthographic projection mapping a virtual 224×256 playfield (original arcade resolution) to clip space. WebGPU clip space is `x/y ∈ [-1, 1]`, `z ∈ [0, 1]` — different from WebGL. For 2D it only matters when setting depth defaults.

### Canvas / DPR

Render at an **integer multiple** of the playfield: pick the largest `N` where `224·N ≤ viewport width` and `256·N ≤ viewport height`, configure the backing store at `224N × 256N`, and let CSS handle the remaining sub-integer stretch with `image-rendering: pixelated`. Doing the integer scale ourselves guarantees nearest-neighbor on every browser/GPU combo — `image-rendering: pixelated` alone is honored inconsistently (notably Safari historically), and on a 4K display asking the compositor to 10× a 224px buffer is a lot to trust. DPR feeds into the same calculation (use `window.devicePixelRatio` when sizing). The GPU sampler stays `nearest` purely for atlas sampling within a sprite.

The projection matrix is fixed (always maps to the virtual 224×256 playfield). On resize, recompute `N`, call `context.configure` with the new size, and update CSS — no shader/pipeline changes. Throttle the resize handler so dragging the window doesn't reconfigure every frame.

---

## Game Logic

### State machine

```
IDLE → PLAYING ⇄ PAUSED
PLAYING → (GAME_OVER | WIN) → IDLE
```

`P` toggles pause. Pause freezes simulation but keeps rendering. (Avoid `Esc` — it conflicts with browser fullscreen exit.)

### Fixed timestep

Game logic updates at a fixed 60 Hz tick via an accumulator:

```
let acc = 0; const dt = 1/60; const MAX_FRAME = 0.25;
function frame(now) {
  acc = Math.min(acc + (now - last) / 1000, MAX_FRAME);
  while (acc >= dt) { update(dt); acc -= dt; }
  render();
}
```

The `MAX_FRAME` clamp matters: `requestAnimationFrame` throttles to ~1Hz in a background tab, so without it returning to the tab after 30s would run 1800 update ticks in a single frame and freeze the browser. Clamping caps catch-up at 15 ticks per render — small enough that nothing visible changes, large enough to absorb a brief stall.

Rendering draws the latest tick state — no interpolation in v1. Space Invaders motion is grid-stepped (invaders snap; player moves at modest speed), so 60Hz logic on a 144Hz display looks fine without lerping. Movement values are still specified in units-per-second, never per-frame, so adding interpolation later is purely a render-side change. Revisit only if 144Hz playtesting reveals visible stutter.

### Player

- Moves left/right (Arrow keys / A-D), fires with Space
- One player bullet on screen at a time (classic rule)
- 3 lives
- On hit: the freeze duration *is* the player-explosion animation (2 frames at ~0.25s each = ~0.5s of visible explosion), then respawn at start position with brief invulnerability (~1.5s, flashing sprite). Don't pause without playing the animation — a silent 1s freeze reads as the game hanging. Tune the per-frame hold once the explosion sprites are in.

### Invader grid

- 5 rows × 11 columns (55 invaders) at start
- Grid moves as a unit, one step per tick interval
- Tick interval shrinks as invaders die. The original uses a lookup table keyed on invaders-alive, **not** a linear ramp — implement it that way so the acceleration feels right. Frames are 60Hz logic ticks:

  | Alive | Frames/step |
  |-------|-------------|
  | 55    | 48 |
  | 54–43 | 43 |
  | 42–31 | 37 |
  | 30–22 | 30 |
  | 21–16 | 22 |
  | 15–11 | 16 |
  | 10–8  | 11 |
  | 7–5   | 8 |
  | 4     | 5 |
  | 3     | 3 |
  | 2     | 2 |
  | 1     | 1 |

  (Values approximate the arcade ROM; tune to taste but keep the shape.)
- **Between waves**: each new wave starts faster than the last. Subtract 5 frames from the 55-alive starting tempo per wave cleared, floored at 16: `start_frames(wave N) = max(48 − 5·(N−1), 16)`. The full table still applies as invaders die — wave start just chooses where on the curve you begin. Tune the constants once Phase 5 is playable.
- **Wave start position drops with progression**: the original arcade starts each new wave one row lower than the last (capped after a few waves so the grid never spawns on top of the barriers). v1: drop the start row by 8 px per cleared wave, capped at 3 wave-drops total (i.e. waves 4+ all start at the same low position). **Sanity-check the cap once positions are pinned down**: barriers sit around y≈200 in the 224×256 playfield; with 5 rows × 8px of grid height plus the wave-4 24px drop, the grid bottom must still clear the barrier top with margin. If the numbers don't work, lower the per-wave drop, not the cap. Enemy fire rate does **not** scale per-wave — speed-up alone is enough difficulty curve; revisit if playtesting says otherwise.
- Direction flips and grid drops one row when an edge invader touches the wall
- Game ends if invaders reach the player's row

### Invader bullets

- Only the **bottom-most live invader of each column** is eligible to fire
- Max **3 enemy bullets** on screen at once
- Firing chance per eligible invader per tick is small (tuned ~1/120)
- Three bullet types in the original (straight, zig-zag, fast); start with one straight type, add variety in polish

### Barriers

- 4 barriers, each defined as a **bitmap mask** (22×16 pixels per barrier) matching the original silhouette — rounded top, notched bottom arch. The *shape* is load-bearing (the arch is where the player crouches to fire); don't approximate it with a rectangle.
- **Commit the initial mask as a hand-drawn `Uint8Array` literal in `entities.ts`**, not as a sprite to be sampled from the atlas. The damage logic needs CPU-side truth anyway (per-pixel collision + splash), so deriving the initial state from a separate atlas region just creates two sources of truth that can drift. The literal is 352 bytes per barrier — trivial.
- Mask lives on the CPU as a `Uint8Array` (one byte per pixel, 0 or 255). The GPU texture is a mirror — every splash mutates the CPU array, then `writeTexture` uploads the affected region. Never read back from the GPU texture.
- Bullet–barrier collision is per-pixel against the CPU mask, not the texture and not AABB
- **Swept collision, not point-sample.** At 60Hz a bullet moves several pixels per tick, fast enough to tunnel through a 1-pixel barrier sliver if you only test the current position. Walk every pixel between last and current position each tick and stop at the first hit. Equivalently, cap bullet speed so `speed·dt < 1 px` — but swept is easier to reason about and costs ~3 mask reads per bullet per tick.
- On bullet hit, clear a splash of mask pixels around the impact point. Direction matters — the splash is asymmetrical:
  - **Player bullet (travelling up)**: erase a small upward-fanning notch — roughly 4 px wide × 3 px tall centered on the impact, biased upward, with corner pixels removed so the hole looks ragged rather than rectangular.
  - **Enemy bullet (travelling down)**: same shape mirrored — fans downward.
  - Implement as two small hardcoded splash masks (one per direction), OR'd into the barrier mask at the impact pixel. Don't randomize — the original is deterministic and the wear pattern is part of the feel.

### Scoring

| Target | Points |
|--------|--------|
| Bottom 2 rows of invaders | 10 |
| Middle 2 rows | 20 |
| Top row | 30 |
| UFO (random pass) | 50 / 100 / 150 / 300 |

High score persisted to `localStorage`.

**UFO scoring note**: the arcade original is *not* random — the awarded value is keyed on the player's shot count (a quirk speedrunners exploit). v1 uses plain RNG over `[50, 100, 150, 300]` because the shot-counter trick is a deep cut and reproducing it accurately means tracking player-shots-fired across the whole game. Document this as a deliberate simplification, not an oversight.

### HUD

Rendered through the sprite pipeline using a bitmap font baked into the atlas. Score, high score, and remaining lives all become quads in the same instance buffer. No Canvas 2D overlay.

### Input

Keyboard only for v1. On-screen touch controls are out of scope — call it out explicitly rather than half-implement it.

---

## Implementation Phases

### Phase 0 — Assets
- [ ] **Decide atlas dimensions before drawing.** Inventory:
  - player (16×8)
  - 3 invader types × 2 frames (≤12×8 each)
  - player bullet, 3 enemy bullet variants (only the straight type is used in v1; reserve UVs for the others)
  - UFO (~24×8)
  - **invader explosion (1 frame, ~13×8)** and **player explosion (2 frames, 16×8 each)** — brief flash on death, ~0.25s
  - bitmap font (~50 glyphs at 8×8 = 3200 px²)

  (Barrier-splash masks are **not** atlas entries — they're hardcoded `Uint8Array` literals next to the barrier mask in `entities.ts`, since per-pixel barrier collision is CPU-side.)

  A 128×128 atlas is plenty; 256×256 leaves room for polish. Pick now, lock the UV constants, don't resize later.
- [ ] **Decide the color palette before sourcing art.** v1 is **full color** — score green, UFO red, barriers green, invaders white — drawn as colored pixels in the atlas (not monochrome + cellophane overlays). Worth one paragraph in the README so reviewers know it's a stylistic call, not "we couldn't do monochrome."
- [ ] If you're not an artist, source the atlas first (the original arcade art is widely available; mind licensing) — drawing it yourself can swallow a weekend.
- [ ] **Pick the UV-derivation strategy before drawing the atlas** — it shapes the layout. **Don't hand-type 50 glyph UVs** — that's how a typo'd `V` coordinate eats an hour. Two options:
  - (a) Lay the atlas out on a strict grid (e.g. 8×8 font cells on an 8-px grid from a known origin) and have `assets/atlas.ts` export a `uvFor(row, col, w, h)` helper plus a small set of named constants for the non-grid sprites (player, UFO, invaders).
  - (b) Export a JSON sidecar from the art tool and generate `assets/atlas.ts` from it at build time.
  Either way, `atlas.ts` ends up exporting typed constants — but how those constants are produced differs, and (a) constrains the layout while (b) doesn't. Decide now.
- [ ] **Audio inventory** (for Phase 5; collect alongside the atlas while you're licensing things): `shoot.wav`, `invader_hit.wav`, `player_hit.wav`, 4 pitched invader-step samples (the classic descending 4-note loop), `ufo_loop.wav`, `ufo_hit.wav`. Source from a CC0 retro pack or synthesize with Web Audio oscillators — same licensing care as the sprites.
- [ ] **Audio mixing model**: decode each `.wav` once into an `AudioBuffer` at startup, then play each shot by creating a fresh `AudioBufferSourceNode` per trigger (sources are one-shot and self-disposing — no pooling needed). Invader-step at fastest tempo fires ~20Hz, well within budget. The UFO loop is the one exception: keep a single long-lived source you start/stop for the duration of a pass.
- [ ] License note in README if using third-party art or audio

### Phase 1 — GPU bootstrap + feature detection
- [x] Vite + TypeScript scaffold (`npm create vite@latest`)
- [x] **First thing in `main.ts`**: check `navigator.gpu` exists and `requestAdapter()` returns non-null. Show a clear "WebGPU not supported in this browser" message otherwise.
- [x] Wrap shader compilation and pipeline creation in `pushErrorScope('validation')` from day one — without it WebGPU errors are nearly unreadable
- [x] Wire `device.lost.then(...)` immediately after `requestDevice`. v1 recovery is **show a "GPU device lost — please reload" overlay and halt the loop** — no automatic re-acquire. Re-init would require rebuilding pipelines, re-uploading the atlas, and reconstructing the barrier mask textures from the CPU state; that's a chunk of work that buys little for a single-player arcade clone. Document the decision in the code comment so the next pass knows it's intentional, not forgotten.
- [x] Configure canvas context, clear to black each frame, confirm `requestAnimationFrame` loop runs

### Phase 2 — Sprite rendering
- [x] Load atlas via `createImageBitmap` → `copyExternalImageToTexture`
- [x] `sprite.wgsl`: instanced quad shader reading per-instance position + atlas UV
- [x] Build pipeline, draw a single test sprite, then a grid of 55 at static positions
- [x] Verify nearest-neighbor sampling (no blur)

### Phase 3 — Game state + input
- [x] Entity structs (plain interfaces, no GPU types)
- [x] State machine + reset
- [x] `spawner.ts` builds the 5×11 grid
- [x] `input.ts` with both held (`isDown`) and edge (`wasPressed`) events for fire/pause
- [x] **Call `event.preventDefault()` on Space and Arrow keydowns** in the input handler — otherwise Space scrolls the page and arrows scroll too, and you'll discover this on first playtest. Only preventDefault on keys the game actually uses; don't blanket-suppress everything.
- [x] Auto-pause on `window.blur` **and** `document.visibilitychange` (when `document.hidden`) — `blur` alone misses some tab-switch cases on certain browsers. Resume requires explicit `P`, no auto-resume on focus, so alt-tabbing doesn't get the player killed off-screen.

### Phase 3.5 — First playable

The shortest path to "is this fun to control" before sinking time into the speed-table, barrier mask, and lives systems. Skip everything that isn't on this list.

- [x] Player moves left/right, fires one bullet
- [x] One row of invaders, static (no grid step, no fire)
- [x] Bullet ↔ invader AABB collision removes the invader
- [x] No win, no lose, no score, no barriers, no respawn

Playtest for 5 minutes. If the cannon feels sluggish or fire feels laggy, fix it here — the diagnosis is cheap when there's nothing else moving. Only then move to Phase 4.

### Phase 4 — Simulation
- [x] Fixed-timestep accumulator in `main.ts`
- [x] Player movement, firing (one-bullet rule)
- [x] **Intermediate step**: full 5×11 grid moves as a unit, flips direction and drops at the wall — **constant tempo, no fire yet**. Catches edge-detection and grid-wrap bugs in isolation before the speed table and fire RNG are stacked on top.
- [x] Invader grid step + edge detection + speed scaling (layer the per-alive-count tempo table on top of the constant-tempo grid)
- [x] Invader fire policy (bottom-of-column, max-3-on-screen, RNG)
- [x] AABB collision: bullet ↔ invader, bullet ↔ player. **Bullet ↔ bullet is a deliberate feel choice**: the original arcade lets enemy bullets pass through the player bullet (collisions are rare with only 1 player + 3 enemy bullets, and passthrough makes the game harder). Default to passthrough; only add bullet↔bullet if playtesting shows it feels wrong.
- [x] Per-pixel collision: bullet ↔ barrier mask, mask update via `writeTexture`
- [x] Lives, respawn freeze + invuln, game-over, win

### Phase 5 — Feel + polish
- [x] Invader 2-frame animation toggled on each grid step (not on a timer — synced to movement is the classic look)
- [x] UFO cameo on a long random timer, scrolls across top
- [x] Starfield background via fullscreen-quad fragment shader
- [x] Sound effects via Web Audio API (shoot, hit, invader step, UFO). The `AudioContext` starts in `suspended` state and only resumes after a user gesture — call `context.resume()` from the same keydown handler that transitions IDLE → PLAYING. Don't try to play anything on the IDLE screen; it'll be silent on first load with no error.
- [x] HUD: score, high score, lives — all via sprite-atlas bitmap font
- [x] `localStorage` high score

### Phase 6 — Hardening
- [ ] Vitest unit tests for `physics.ts`, `spawner.ts`, `state.ts`, and the barrier-mask helpers in `entities.ts` — specific cases listed in the [Test Plan](#test-plan) section below
- [ ] Resize handling: recompute integer scale `N`, reconfigure context backing store, update CSS (see Canvas / DPR). Throttle to ~10Hz so drag-resize doesn't reconfigure every frame.
- [ ] Frame-rate independence sanity check (run with Chrome devtools "Rendering → Frame rendering stats")
- [ ] Background-tab return: switch tabs for 30s, return, confirm no freeze (validates accumulator clamp)
- [ ] Production build size + load time check

---

## Test Plan

Three buckets — automate what you can, structure what you can't, accept what's irreducibly subjective.

### Vitest (automated, game logic only)

GPU code is covered by Playwright (next section); Vitest stays scoped to pure logic for speed and to keep `npm run test` runnable without a browser. Keep `physics.ts`, `spawner.ts`, `state.ts`, and the barrier-mask helpers in `entities.ts` pure so they can be tested in isolation from anything that touches a `GPUDevice`.

**`physics.ts`**
- AABB: overlapping, touching-edge (pick a convention, stick to it), non-overlapping, fully contained
- Swept barrier collision: a bullet whose path crosses a 1-px mask sliver in one tick registers a hit (the tunneling case the swept-vs-point-sample decision exists for)
- Swept barrier collision: a bullet whose swept path doesn't reach the mask returns no hit
- Splash application near mask edges doesn't write out-of-bounds; corner pixels removed as specified
- Upward and downward splash masks produce the expected pixel pattern at the impact point

**`spawner.ts`**
- 5×11 grid spawns at expected positions
- `framesPerStep(alive)` returns the right value at every table boundary (55, 54, 43, 42, …) — table-driven, one assertion per row
- `startFrames(waveN)` matches `max(48 − 5·(N−1), 16)` for N = 1..6
- Wave-N start-row drop caps at 3 drops × 8 px (waves 4, 5, 6 all start at the same row)
- Bottom-of-column fire eligibility: when an invader dies, the one above it becomes eligible
- Max-3-enemy-bullets cap: a 4th fire attempt while 3 are live returns no bullet

**`state.ts`**
- Legal transitions succeed; illegal transitions are no-ops (e.g. PAUSED → GAME_OVER without going through PLAYING)
- `P` during GAME_OVER does nothing (don't toggle pause in non-PLAYING states)

**Input edge events**
- `wasPressed(key)` returns true exactly once after a keydown, then false until the next keydown — verifies the "consumed on the next tick" contract from the DoD

**Determinism**
- Seed the RNG. Same seed + same input log + N ticks produces the same final state (positions, lives, score, RNG state). One test that catches a lot of subtle sim bugs at once — if it passes, replay debugging works.

### Playwright (browser integration, local only)

The layer between unit tests and manual QA: drive a real Chromium, send real keystrokes, observe game state via a JS bridge. Catches integration bugs Vitest can't reach — atlas didn't load, bind group misconfigured, input not wired, accumulator runaway, game-over transition not firing — without the pixel-diff brittleness of screenshot tests.

**Setup needs three pieces**:

1. **A debug hook on the game.** In dev/test builds only, expose `window.__game` with:
   - `start()`, `reset()` — state machine entry points
   - `advance(ticks: number)` — run N logic ticks synchronously, bypassing `requestAnimationFrame`. This is the load-bearing piece: tests assert on tick-deterministic outcomes without waiting real-time.
   - Read-only views: `state`, `score`, `lives`, `bullets`, `invaders`, `barrierMaskAt(x, y)`
   - Gate with `if (import.meta.env.DEV || import.meta.env.MODE === 'test')` so the hook is tree-shaken out of production. Verify by grepping `dist/` for `__game` after `npm run build`.

2. **Playwright with a real Chromium.** `npm i -D @playwright/test`, then `npx playwright install chromium`. Run against `npm run dev` (or `npm run preview` for the prod build) via Playwright's `webServer` config.

3. **A way to run it.** `npm run test:e2e`, local only. Don't wire into CI without a GPU runner — see below.

**What to test** (start with these five; add only when a bug escapes to manual QA):

- **Boot smoke**: page loads, `window.__game` exists, no console errors during init. Catches atlas-load, pipeline-creation, and bind-group failures in one test.
- **One-bullet rule**: tap Space twice with one tick between, assert exactly one bullet exists. Catches edge-event wiring regressions.
- **Invader kill → score**: fire, advance until impact, assert the invader is gone and `score === 10`. Catches AABB + scoring + entity-removal together.
- **Edge bounce + row drop**: advance until the grid hits the wall, assert direction flipped and grid y dropped by 8 px. Catches the most common grid-state bug.
- **Game over on row reached**: programmatically place the grid at the player row, advance one tick, assert `state === 'GAME_OVER'`. The lose-condition transition is easy to forget and hard to trigger by hand.

Resist porting every Vitest case into Playwright — these run ~100× slower per assertion. Reserve Playwright for tests that need the full integration; keep pure-logic tests in Vitest.

**CI integration** (skip for v1): GitHub Actions Linux runners have no GPU, so headless WebGPU fails. Three workarounds if you eventually want it:
- SwiftShader software backend via `--use-vulkan=swiftshader` — slow, finicky, real WebGPU semantics
- Self-hosted runner with a GPU — more infra, fastest tests
- Pre-push hook instead of CI — zero infra, less enforcement

For v1, "run locally before pushing `dist/`" is fine. Revisit if the project grows past arcade-clone scope.

### Per-phase gate

Each phase has one thing to verify before advancing.

- **Phase 1**: canvas renders a non-black clear color; in a no-WebGPU runtime the "not supported" message renders; intentionally throwing inside pipeline creation surfaces a readable validation error (proves `pushErrorScope` is wired)
- **Phase 2**: 55 sprites visible in a grid; no blur at 1× and at 3× integer scale; eyeball one sprite per type to confirm atlas UVs
- **Phase 3.5**: 5-minute playtest. Move-feel sluggish? Fire laggy? Fix here, not later — diagnosis is cheap when nothing else is moving.
- **Phase 4**: full wave playable end-to-end (no win condition yet, but losing works); barrier erodes per-pixel under repeated fire
- **Phase 5**: full loop with sound, HUD, UFO, starfield; pause works on blur and visibilitychange; high score persists across reload
- **Phase 6**: see Definition of Done

### Manual QA checklist (run before each `dist/` push)

Should take under five minutes once the phases are green.

- [ ] Full loop: IDLE → PLAYING → win → IDLE; IDLE → PLAYING → game over → IDLE
- [ ] `P` toggles pause from PLAYING; blur and tab-hide auto-pause; returning to the tab does **not** auto-resume
- [ ] Background-tab return: switch tabs for 30s, return, no freeze (validates `MAX_FRAME` clamp)
- [ ] Resize during PLAYING: game keeps running, no console errors, integer scale recomputes, no shader/pipeline rebuild
- [ ] High score survives a page reload
- [ ] Sound plays after first keydown (not before — `AudioContext` resume gate); IDLE screen is silent
- [ ] Space and Arrow keys don't scroll the page during PLAYING
- [ ] Fire latency: tap space — bullet appears within one tick (~16ms). Lingering past that means the edge-event wiring regressed.
- [ ] Player death plays the explosion animation before the freeze ends (no silent pause)
- [ ] `device.lost` overlay: trigger via Chrome devtools "Stop GPU process" or by leaving the tab open for a long sleep, confirm overlay renders and loop halts

### Cross-browser smoke

Before publishing, run the QA checklist on:
- Latest Chrome (the dev target)
- Latest Safari (different WebGPU implementation; catches Chromium-only failures)
- One no-WebGPU runtime (Chromium with `chrome://flags/#enable-unsafe-webgpu` off, or older Safari) — just verifying the "not supported" message renders

Firefox is optional; its WebGPU is moving fast and a v1 clone doesn't need to chase it. If it works, great; if not, file it as a known issue, not a blocker.

### What we deliberately don't test

- **Headless WebGPU in CI**: see the Playwright section — local-only is the right tradeoff for v1
- **Snapshot/golden-image rendering**: pixel diffs fail on every GPU driver update for non-real reasons. One eyeball check per phase catches what matters without the maintenance tax.
- **Performance benchmarks in CI**: the DoD's "no frame drops" is a human eyeball test in devtools. With a single draw call there's no realistic silent-regression path; if it ever does regress, something is structurally wrong and a benchmark threshold won't be what tells you.
- **Audio output verification**: there's no good automated way to confirm a sound played; the manual checklist covers it.

---

## Definition of Done (v1)

Ship gate — all must be true:

- [ ] Full loop playable: IDLE → PLAYING → (GAME_OVER | WIN) → IDLE
- [ ] All 6 mechanics work: player movement + fire, invader grid + acceleration, invader fire, barriers eroding per-pixel, lives + respawn, score + high score
- [ ] No frame drops in Chrome devtools "Rendering → Frame rendering stats" on the dev machine during a full wave (player + 55 invaders + max bullets + active barrier erosion). Single draw call should make this trivial; if it doesn't, something is wrong.
- [ ] **Input latency**: edge events queued between ticks are consumed on the next tick — never dropped, never deferred a second tick. (Worst-case latency is one tick ≈ 16ms, which is fine; the failure mode is *losing* a keydown because the queue was already drained, or holding it for two ticks because the consumer only runs every other update.) Easy to regress when wiring edge events on top of `isDown` — verify by ear/eye after Phase 5 polish is in.
- [ ] High score survives a page reload
- [ ] "WebGPU not supported" message renders on a browser/runtime without WebGPU. Firefox shipped WebGPU on macOS in 2025, so it no longer works as a fallback target — instead test by disabling the flag in Chromium (`chrome://flags/#enable-unsafe-webgpu` off) or running in an older Safari. Re-check `caniuse.com/webgpu` before publishing in case the current targets have moved.
- [ ] `npm run build` produces a `dist/` that runs when served as static files (no dev-server-only behavior)

---

## Key WebGPU Concepts Used

- `navigator.gpu.requestAdapter()` → `adapter.requestDevice()` with null-checks
- `device.pushErrorScope('validation')` around pipeline + shader creation
- `GPUBuffer` with `VERTEX | COPY_DST` for the per-frame instance buffer
- `GPUTexture` + `copyExternalImageToTexture` for the atlas
- `GPUTexture` + `writeTexture` for barrier-mask updates
- Two `GPURenderPipeline`s (starfield, sprites) sharing one render pass via `loadOp: 'load'`
- `GPUBindGroup` for atlas + sampler (static) and per-frame uniforms (dynamic)
- `device.queue.writeBuffer` once per frame to update the instance buffer
- `device.lost` promise → show overlay + halt loop (no automatic re-init in v1)

---

## Commands

```bash
npm install          # install deps
npm run dev          # Vite dev server with HMR
npm run build        # production build → dist/
npm run preview      # serve the production build locally
npm run test         # Vitest (pure game logic, no browser)
npm run test:e2e     # Playwright (browser integration, local only — needs a real GPU)
```

---

## Browser Requirements

WebGPU support varies by browser, platform, and version, and the picture changes month to month. Rather than maintain a table that'll go stale, **check caniuse.com/webgpu before publishing**.

As a rough floor: recent Chrome / Edge work everywhere; Safari and Firefox lag and vary by OS. Older browsers see the "WebGPU not supported" message from Phase 1.

---

## Out of Scope (deliberately)

- Touch / on-screen controls
- WebGL fallback
- Multiplayer
- Mobile-portrait layout
- Asset hot-reload (Vite handles JS/TS HMR; shaders and PNG require a manual refresh)
