# Phase 7 — Global Leaderboard

A global high-score leaderboard hosted entirely on **Vercel** — static game +
serverless API + **Vercel Postgres (Neon)** — with **server-authoritative score
verification by deterministic replay**.

This document supersedes the "Leaderboard (Planned — Phase 7)" stub in
`CLAUDE.md`. It is self-contained: architecture, schema, verification model,
client library, UX flow, integration, determinism requirements, test plan,
deployment, and a phase checklist with gate criteria.

> **Status:** Planned. No leaderboard code exists yet (`src/leaderboard.ts`,
> `api/` are not present). Phases 0–6 are the shipped game; this is the first
> networked feature.

---

## 0. The core idea: never trust the score

> **⚠️ Implementation note (superseded).** The deterministic-replay model
> described in this section was shipped but **rolled back**. Re-deriving the
> score on the server required a second, byte-for-byte copy of the game
> simulation (`simulate.ts`) that had to stay in lockstep with the live game
> loop. They drifted, so the player saw score *X* while the server saved score
> *Y* — the leaderboard was inconsistent. The current implementation **trusts
> the client's reported score**: `/api/submit` verifies the signed seed (a
> single-use, recently-issued HMAC token) and dedups it, then saves the score
> the client sends, clamped to `[0, 999999]`. This is intentionally *less*
> cheat-proof (the score field can be forged by a determined attacker) in
> exchange for the score that's saved always matching the score the player
> earned. `simulate.ts`/`replay.ts` and the input-log plumbing were removed.
> The rest of this document is retained for historical context.

The previous draft of this plan tried to make a *client-reported score* hard to
forge — session tokens, server-owned `started_at`, elapsed-time plausibility,
rate limits. All of that is heuristics layered on a number the attacker picks.
It admitted itself (old §3.6) that a determined attacker could script a submit.
**It was complicated and not bulletproof.**

This rewrite makes it bulletproof against forged scores by removing the trusted
number entirely:

> The client **never sends a score.** It sends the *inputs* it played. The
> server re-runs the exact same deterministic simulation and **computes the
> score itself.** The only score that can land in the table is one the game's
> own rules produce from a valid input sequence.

This is possible because the game is already built for it (CLAUDE.md):

- Game logic is **pure TypeScript, decoupled from the GPU** (`physics.ts`,
  `spawner.ts`, `state.ts`) → the same module runs unchanged inside a Vercel
  serverless function.
- Simulation is a **fixed 60 Hz timestep** with a **seeded RNG**.
- There is already a determinism requirement: *"Same seed + same input log + N
  ticks produces the same final state."* That test **is** the verification
  engine — we just run it on the server with the player's submitted inputs.

### What this stops (bulletproof)
- **Forged / arbitrary scores** — there is no score field to forge; a tampered
  number is ignored because the server recomputes from inputs.
- **Replayed submissions** — single-use seed (dedup table); resubmitting the
  same run recomputes the same score and is rejected as already-submitted.
- **Mid-game submissions** — the server only accepts a run whose simulation
  reaches a terminal state (`GAME_OVER` or `WIN`).

### What this does NOT stop (the irreducible limit — documented, not solved)
- **Bots / TAS**: a script that feeds a *legitimate but superhuman* input log.
  That score is achievable under the rules, so it isn't forged — it's a perfect
  player. No replay system can tell a flawless TAS from a god-tier human; no
  game has solved this. Out of scope.
- **Seed-shopping** (minor): the server issues the RNG seed (§3.1), so a player
  could request many seeds, simulate each offline, and play the luckiest one.
  Still *legitimate play on a server-issued seed*, not a forged score. Mitigated
  by short seed TTL + issuance rate-limit; accepted as a minor residual.

---

## 1. Architecture overview

Everything is one Vercel project, one origin (so **no CORS**):

```
                          ┌─────────────────────────────────────────────┐
  browser (static, Vite)  │                 Vercel                       │
  ──────────────────────  │  ───────────────────────────────────────────│
  served from dist/  ◄─────┤  Static build (dist/)                        │
                          │                                              │
  src/leaderboard.ts      │  Serverless functions (api/)                 │
    startRun()  ──────────┼─► GET  /api/start                            │
                          │     • new random seed                        │
                          │     • HMAC-sign {seed, issuedAt}             │
                          │     • return SignedSeed (NO db write)         │
                          │                                              │
    submitRun() ──────────┼─► POST /api/submit                           │
                          │     • verify seed signature + TTL            │
                          │     • simulate(seed, inputLog)  ◄─ shared sim │
                          │       → server computes score + terminal     │
                          │     • reject if not GAME_OVER/WIN            │
                          │     • sanitise name                          │
                          │     • dedup seed (single-use)               │
                          │     • INSERT leaderboard (server score)      │
                          │     • return { rank }                        │
                          │                                              │
    fetchTop10()──────────┼─► GET  /api/top                              │
                          │     • SELECT top 10                          │
                          │                                              │
                          │  Vercel Postgres (Neon)  ◄── functions only  │
                          └─────────────────────────────────────────────┘
```

- **The database connection string lives only in serverless functions.** Unlike
  the Supabase publishable-key model, the browser has **no DB credentials and no
  direct DB access** — every read and write goes through `api/`. A leaked client
  bundle exposes nothing.
- The static site and the API are the **same origin**, so there is no CORS
  config and no cross-origin preflight to maintain.

### Files

| File | Responsibility |
|------|----------------|
| `src/game/simulate.ts` | **Headless deterministic run loop** — composes `state.ts`/`physics.ts`/`spawner.ts` into `simulate(seed, inputLog, maxTicks)` returning `{ score, ended, ticks }`. Imported by **both** the client game loop and the server. No GPU/DOM/`Date`/`Math.random`. (§9) |
| `src/game/rng.ts` | Seeded PRNG (e.g. mulberry32) + `seedFrom(string)`. Replaces any `Math.random` in the sim. |
| `src/leaderboard.ts` | Client API: `startRun()`, `submitRun()`, `fetchTop10()`, `sanitiseName()`, `LeaderboardError`. Pure async, no GPU imports. |
| `src/leaderboard-ui.ts` | Overlay show/hide, render top-10, name form, input-suspension wiring. Imported by `main.ts`. |
| `api/start.ts` | Issue a signed seed (`SignedSeed`). Stateless. |
| `api/submit.ts` | Verify seed, **re-simulate**, validate terminal, dedup, insert. |
| `api/top.ts` | `SELECT` top 10. |
| `api/_lib/sign.ts` | HMAC sign/verify of `{seed, issuedAt}` using `SEED_SIGNING_SECRET`. |
| `api/_lib/db.ts` | `@vercel/postgres` `sql` client (uses `POSTGRES_URL`). |
| `db/schema.sql` | Authoritative schema (§2). Applied via `psql`/dashboard. |
| `index.html` | `<div id="leaderboard-overlay">` markup (mirrors existing `#error-overlay`). |
| `vercel.json` | Build/output config (static `dist/` + `api/` functions). |

> **The server imports `src/game/`.** Vercel functions in `api/` import the
> shared sim from `src/game/simulate.ts`. This is the whole design — keep that
> module free of anything that doesn't run in Node (§9).

---

## 2. Database schema (authoritative)

`db/schema.sql` — applied with `psql "$POSTGRES_URL" -f db/schema.sql` or via the
Vercel Postgres dashboard SQL editor:

```sql
-- ─── leaderboard ─────────────────────────────────────────────────────────────
create table if not exists leaderboard (
  id         bigint generated always as identity primary key,
  name       text    not null check (char_length(name) between 1 and 20),
  score      integer not null check (score >= 0 and score <= 999999),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_score_desc
  on leaderboard (score desc, created_at asc);

-- ─── submissions (single-use seed dedup) ─────────────────────────────────────
-- One row per accepted run. NOT anti-cheat theater — it stops the *same* valid
-- replay from inserting twice (idempotent submit). The seed is the natural key.
create table if not exists submissions (
  seed       text primary key,
  created_at timestamptz not null default now()
);
```

**Design notes**

- **No RLS, no client-facing policies needed.** Neon/Vercel Postgres is reached
  only through serverless functions holding `POSTGRES_URL`. The browser can't
  connect, so there is nothing to lock down at the row level — a structurally
  simpler trust model than the publishable-key approach.
- The `score <= 999999` CHECK is defence-in-depth. The server computes the score
  by simulation, so it's already bounded by reachable play; the CHECK catches a
  bug in the function, not an attacker.
- **No `sessions` / `rate_limit` / `pg_cron` tables.** The session-token and
  elapsed-time machinery is gone — re-simulation replaces all of it. Seed
  freshness is enforced statelessly by the HMAC TTL (§3.1), not a DB table.
- Optional hardening for **seed-shopping**: rate-limit `/api/start` per IP. v1
  can skip it (seed-shopping is a minor, legitimate-play residual); if needed
  later, add a small counter in Vercel KV/Upstash rather than a Postgres table.

---

## 3. Verification model

### 3.1 Server-issued, signed seed

The RNG seed (which drives invader fire, UFO timing, etc.) is issued by the
server so the client can't fabricate one and can't trivially shop offline.
**Stateless** — no DB row at start time:

```
GET /api/start
  seed     = randomHex(16)
  issuedAt = Date.now()
  sig      = HMAC_SHA256(SEED_SIGNING_SECRET, `${seed}.${issuedAt}`)
  → { seed, issuedAt, sig }            // SignedSeed
```

On submit, the server recomputes `sig` and checks `Date.now() - issuedAt < TTL`
(generous, e.g. 6h, to survive long sessions and pauses). A forged or expired
seed is rejected before simulation even runs.

### 3.2 Tick-indexed input log

The client records **the inputs the simulation actually consumed**, indexed by
tick number — not raw OS keyboard events and **not** wall-clock time:

```ts
// key codes: 0 = left, 1 = right, 2 = fire
export interface InputEvent { tick: number; key: 0 | 1 | 2; down: boolean; }
```

Each fixed-timestep tick, the loop drains queued edges, appends them to the log
as `(tick, key, down)`, then runs `update(dt)`. The server reconstructs the
held-key state at any tick by replaying edges in tick order. Because the log is
**tick-indexed**, pauses and frame-rate differences are irrelevant — the server
advances exactly the ticks the inputs imply. This is why the elapsed-time
plausibility check from the old design is no longer needed: real time never
enters the verification.

Payload is tiny: even a long game is a few hundred to low-thousands of edges
(only key changes, not per-tick state) → a few KB of JSON.

### 3.3 Re-simulation (the bulletproof step)

```
POST /api/submit  { seed, issuedAt, sig, name, inputLog }   // NO score field

  1. verifySig(seed, issuedAt, sig)        else 400 'bad-seed'
  2. fresh = now - issuedAt < TTL          else 400 'expired-seed'
  3. { score, ended, ticks } = simulate(seedFrom(seed), inputLog, MAX_TICKS)
  4. ended ∈ {GAME_OVER, WIN}              else 400 'not-terminal'
  5. name = sanitiseName(name)             else 400 'bad-name'
  6. INSERT submissions(seed)              conflict → 200 'already-submitted'
  7. INSERT leaderboard(name, score)       // score is the SERVER's number
  8. rank = SELECT count(*) WHERE score > $score + 1
  → { rank }
```

The client's claimed score is never read — there is no score field. Step 3 is
the same `simulate()` the client ran (and the same one Vitest exercises in the
determinism test), so an honest client's run reproduces exactly; a tampered
input log just produces whatever score *that* log legitimately yields.

### 3.4 Single-use (dedup)

`submissions.seed` is a primary key. A second submit with the same seed hits the
conflict at step 6 and returns `already-submitted`, which the UI treats as
success (shows the existing rank). A double-click can't create two rows.

### 3.5 Name sanitisation

Strip control characters, trim, collapse whitespace, enforce 1–20 chars, reject
empty. Same constraints as the DB CHECK (defence in depth). Shared between
client (pre-validate) and server (authoritative):

```ts
export function sanitiseName(raw: string): string | null {
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned.length >= 1 ? cleaned : null;
}
```

---

## 4. Client library (`src/leaderboard.ts`)

```ts
const API = '/api'; // same-origin on Vercel

export interface SignedSeed { seed: string; issuedAt: number; sig: string; }
export interface InputEvent  { tick: number; key: 0 | 1 | 2; down: boolean; }
export interface LeaderboardRow { id: number; name: string; score: number; created_at: string; }

export class LeaderboardError extends Error {
  constructor(public kind: 'offline' | 'rejected' | 'server', message: string) { super(message); }
}

/** Prefetched during IDLE so PLAYING can start instantly with a server seed.
 *  Returns null if the backend is unreachable — the game still plays locally
 *  (with a local seed) and submission is disabled. */
export async function startRun(): Promise<SignedSeed | null> { /* GET /api/start */ }

/** Called on GAME_OVER/WIN when score > 0 and the run used a server seed.
 *  Sends inputs, NOT a score. Throws LeaderboardError. */
export async function submitRun(
  run: SignedSeed, name: string, inputLog: InputEvent[],
): Promise<{ rank: number }> { /* POST /api/submit */ }

export async function fetchTop10(): Promise<LeaderboardRow[]> { /* GET /api/top */ }

export function sanitiseName(raw: string): string | null { /* §3.5 */ }
```

- `startRun()` swallows network errors and returns `null` — a failed start must
  never block the player. A null run means the game seeds its RNG locally and
  the end-of-game overlay shows the top-10 read-only (no submit form).
- No `VITE_` secrets in the client at all. The leaderboard is "available" iff the
  API responds; there's nothing to misconfigure in the bundle.

```bash
npm install @vercel/postgres   # server-side driver, used only in api/
```

---

## 5. UX flow

```
GAME_OVER / WIN
  │
  ├─ score === 0
  │     └─► current behaviour: Space / any key → IDLE   (no overlay)
  │
  └─ score > 0
        └─► show #leaderboard-overlay
              ┌───────────────────────────────────────────┐
              │  GLOBAL HIGH SCORES                         │
              │  ─────────────────────────────────────────  │
              │   1.  AAA            12,340                  │
              │   …  (top 10, fetchTop10)                    │
              │  ─────────────────────────────────────────  │
              │  Your score: 4,250                           │
              │  Name: [____]  [ Submit ]   ← only if run    │
              │                               had a server   │
              │                               seed           │
              │  ─────────────────────────────────────────  │
              │            [ Play again ]                    │
              └───────────────────────────────────────────┘

   States within the overlay:
     loading    → spinner while fetchTop10() resolves
     ready      → table + name form (form hidden if no server seed)
     fetch-err  → "Couldn't load scores." + [Retry]; form still works
     submitting → Submit disabled, "Verifying…"  (server is re-simulating)
     submitted  → table refreshes, player's row highlighted, form → rank
     rejected   → inline error (e.g. "Run could not be verified."); Submit
                  re-enabled only if it's a retriable kind (offline); a
                  'rejected'/'not-terminal' is terminal — show message, no retry
     offline    → "You're offline — score not submitted." + [Play again] works

   Exit (any state): Space or [Play again] → hide overlay → returnToIdle()
```

Rules:
- Overlay appears only on game end with `score > 0`. The IDLE attract screen
  never shows a leaderboard.
- **Play again always works**, in every state, even mid-error.
- Submit is **idempotent-safe** (single-use seed → `already-submitted` is treated
  as success).
- If the run had **no server seed** (offline at start), the overlay still shows
  the top-10 read-only with a "scores aren't being recorded" note and no form.

---

## 6. Integration with `main.ts` and the state machine

### 6.1 Seed must be ready *before* the run starts

`startRun()` is async but the game must start instantly on keypress, and the run
must be seeded with the server's seed from tick 0. So **prefetch during IDLE**:

```ts
// on load and whenever we returnToIdle():
let pendingRun: SignedSeed | null = null;
startRun().then(r => { pendingRun = r; });   // ready by the time the player presses start

// IDLE → PLAYING (first keydown that starts the game)
const run = pendingRun;                       // may be null (offline) → local seed
const seed = run ? seedFrom(run.seed) : seedFrom(randomLocalSeed());
state = startGame(state, seed);               // startGame seeds the RNG, resets inputLog
context.resume();                             // existing AudioContext gate
state.run = run;                              // remember for submit (null ⇒ no submit)
pendingRun = null;                            // consumed; prefetch a fresh one next IDLE
```

### 6.2 Recording the input log

The fixed-timestep loop owns a `tick` counter and the input log:

```ts
while (acc >= dt) {
  const edges = drainInputEdges();            // from input.ts queue
  for (const e of edges) state.inputLog.push({ tick: state.tick, key: e.key, down: e.down });
  applyEdges(state, edges);                   // update held-key state
  update(state, dt);                          // pure sim
  state.tick++;
}
```

`startGame()` stays pure and synchronous (it's unit-tested): it takes a `seed`,
resets `tick = 0`, `inputLog = []`, and `run = null`. The async seed prefetch and
the `state.run` assignment live in `main.ts`.

### 6.3 Submitting on game end

```ts
// PLAYING → GAME_OVER | WIN
if (state.score > 0) {
  showLeaderboardOverlay({
    score: state.score,
    run: state.run,                 // null ⇒ read-only overlay, no form
    inputLog: state.inputLog,
  });
}
```

### 6.4 Keyboard-conflict fix (the name `<input>`)

`src/game/input.ts` calls `preventDefault()` on Space/arrows on `window`. While
the player types their name this would swallow the spacebar and leak game keys.
Fix (unchanged from the prior plan — still required):

- Export `setInputEnabled(enabled: boolean)` in `input.ts`. When disabled, the
  keydown handler returns early **without** `preventDefault` and **without**
  recording held/edge state.
- Name `<input>` focus → `setInputEnabled(false)`; blur / overlay close →
  `setInputEnabled(true)`.
- Belt-and-braces: the input's own `keydown` calls `e.stopPropagation()`.

This is a gate item — the single most likely "works in dev, broken on first real
play" bug.

---

## 7. Determinism (the load-bearing requirement)

Re-simulation is only bulletproof if client and server compute **bit-identical**
results from the same `(seed, inputLog)`. Rules for `src/game/simulate.ts` and
everything it imports:

- **One shared module, imported by both sides.** No forked copies.
- **No nondeterministic calls in the sim:** no `Math.random` (use `src/game/rng.ts`
  seeded PRNG), no `Date.now()` / `performance.now()`, no `Math.random`-seeded
  shuffles. The sim's only entropy is the seed.
- **No iteration-order hazards:** iterate arrays, not `Set`/`Map`, where order
  affects results (e.g. invader fire selection, collision resolution order).
- **Integer/float discipline:** JS doubles are IEEE-754 everywhere (Node +
  browsers), so identical operations give identical bits — *as long as the
  operations are identical*. Keep movement in the documented units-per-second
  math; don't branch on `devicePixelRatio` or anything environment-specific
  inside the sim.
- **Bounded:** `simulate()` takes `MAX_TICKS` and stops; a malicious huge
  inputLog can't spin the function forever.

The existing CLAUDE.md determinism test is promoted from "nice to have" to
**security-critical** and gains a cross-environment assertion (§8.1).

---

## 8. Test plan

### 8.1 Vitest — determinism & sim (the verification core)

- **Replay determinism**: a fixed `(seed, inputLog)` → an exact, hard-coded
  `score` and terminal state. This locks the contract both client and server
  depend on. (Promoted from the CLAUDE.md determinism test.)
- **Re-run stability**: calling `simulate()` twice with the same args yields
  identical results (no hidden global state).
- **Terminal detection**: a log that wins → `ended === 'WIN'`; one that dies →
  `'GAME_OVER'`; a truncated log → `'in-progress'` (must be rejected on submit).
- **Tampered input log** produces a *different* (and lower-or-equal-feel) score —
  i.e. you can't append fake kills.

### 8.2 Vitest — `src/leaderboard.test.ts` (mocked `fetch`)

- `startRun()` returns the `SignedSeed` on 200; returns `null` (not throw) on
  network failure — the "playing must never be blocked" contract.
- `submitRun()` sends **no score field** (assert the request body shape).
- `submitRun()` throws `LeaderboardError('rejected')` on 4xx (`bad-seed`,
  `not-terminal`, `bad-name`).
- `submitRun()` throws `LeaderboardError('offline')` on network failure.
- `submitRun()` treats `already-submitted` as success (returns the rank).
- `fetchTop10()` parses + orders by score desc, created_at asc.
- `sanitiseName()` strips control chars, collapses whitespace, caps at 20,
  rejects empty/whitespace-only.

### 8.3 Vitest — `api/_lib/sign.ts`

- sign → verify round-trips true.
- tampered `seed` or `issuedAt` → verify false.
- expired `issuedAt` (beyond TTL) → rejected.

### 8.4 Server handler tests (extracted pure functions)

Keep the request handlers thin; extract the logic so it tests without a live DB
(inject a fake `sql`):

- unknown/forged seed → 400 `bad-seed`.
- expired seed → 400 `expired-seed`.
- non-terminal run → 400 `not-terminal`.
- score written equals `simulate()` output, **not** any client-sent number
  (send a bogus `score` field; assert it's ignored).
- duplicate seed → `already-submitted`, exactly one leaderboard row.

### 8.5 Playwright (local, optional)

One integration test behind a flag (needs `vercel dev` + a local/remote Postgres):

- Game over with score > 0 → overlay → submit → server-verified row appears in
  the live top-10, highlighted → Play again → IDLE.

Don't port unit cases into Playwright (≈100× slower).

### 8.6 Manual QA additions (append to CLAUDE.md checklist)

- [ ] Overlay shows only on game end with score > 0; IDLE never shows it.
- [ ] Typing a name doesn't move the cannon or fire (input suspended).
- [ ] Double-clicking Submit creates exactly one row.
- [ ] Airplane-mode game-over: overlay shows "offline", Play again still works.
- [ ] Offline at *start* (no server seed): overlay shows read-only top-10, no
      form, game played fine.
- [ ] Tampering the request body's inputs in devtools → server rejects or
      records a different score, never the forged one.

### 8.7 Phase 7 gate

> Full loop with leaderboard: game over (score > 0) → overlay → submit (sends
> seed + inputLog, **no score**) → server re-simulates → a row with the
> **server-computed** score appears in the live top-10 and is highlighted → Play
> again → IDLE. Submitting the same seed twice does not duplicate. A forged
> score field is ignored. Backend unreachable degrades cleanly (game plays;
> overlay read-only or absent).

---

## 9. Deployment (all on Vercel)

### 9.1 Vercel project

- Import the repo into Vercel; framework preset **Vite**, output dir `dist/`.
- The `api/` directory at the repo root is auto-deployed as serverless
  functions (Node runtime). No separate deploy step — `git push` ships static +
  API together.

`vercel.json` (minimal — Vite preset handles most of it; add SPA/asset rules
only if needed):

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "functions": { "api/**/*.ts": { "runtime": "nodejs20.x" } }
}
```

### 9.2 Vercel Postgres (Neon)

- In the Vercel dashboard → Storage → create a **Postgres (Neon)** database; link
  it to the project. Vercel injects `POSTGRES_URL` (and friends) into the
  functions' environment automatically — **no secret in the repo or client.**
- Apply the schema once:

```bash
psql "$POSTGRES_URL" -f db/schema.sql      # or paste into the dashboard SQL editor
```

### 9.3 Secrets / env

| Var | Where | Purpose |
|-----|-------|---------|
| `POSTGRES_URL` | Vercel (auto-injected) | DB connection, **functions only** |
| `SEED_SIGNING_SECRET` | Vercel env (set manually) | HMAC key for seed signing (§3.1) |

No `VITE_` leaderboard vars exist — the client uses the same-origin `/api`. The
browser bundle contains zero credentials.

### 9.4 Local development

```bash
npm i -g vercel
vercel link                 # once
vercel env pull .env.local  # pulls POSTGRES_URL + SEED_SIGNING_SECRET locally
vercel dev                  # serves Vite + api/ together at localhost
```

Without a linked DB, `vercel dev` still serves the game; `/api/*` returns errors
and the client degrades to the offline path (read-only / no submit).

---

## 10. Implementation checklist

### 10.1 Shared sim (do this first — it's the foundation)
- [ ] `src/game/rng.ts` — seeded PRNG + `seedFrom(string)`; purge `Math.random`
      from the sim path.
- [ ] `src/game/simulate.ts` — headless `simulate(seed, inputLog, maxTicks)` →
      `{ score, ended, ticks }`, composed from existing pure modules (§1, §7).
- [ ] Refactor `main.ts` loop to drive the sim via the same input-log path so the
      client's authoritative run matches the server's replay (§6.2).
- [ ] Vitest: replay determinism, re-run stability, terminal detection (§8.1).

### 10.2 Backend (Vercel functions)
- [ ] `db/schema.sql` — `leaderboard` + `submissions` (§2).
- [ ] `api/_lib/db.ts` — `@vercel/postgres` client.
- [ ] `api/_lib/sign.ts` — HMAC sign/verify (+ tests, §8.3).
- [ ] `api/start.ts` — issue signed seed (§3.1).
- [ ] `api/submit.ts` — verify, re-simulate, validate terminal, dedup, insert
      (§3.3); handler logic extracted + tested (§8.4).
- [ ] `api/top.ts` — top-10 select.
- [ ] `vercel.json`.

### 10.3 Client
- [ ] `src/leaderboard.ts` — `startRun`, `submitRun`, `fetchTop10`, `sanitiseName`,
      `LeaderboardError` (§4).
- [ ] `src/leaderboard.test.ts` — mocked-fetch suite (§8.2).
- [ ] `GameState` gains `seed`, `tick`, `inputLog`, `run`; `startGame(state, seed)`
      resets them; `returnToIdle()` clears `run` (§6.1).
- [ ] `input.ts` — `setInputEnabled()` flag (§6.4).
- [ ] `index.html` — `#leaderboard-overlay` markup + styles (mirror `#error-overlay`).
- [ ] `src/leaderboard-ui.ts` — overlay states, top-10 render, name form,
      input-suspension wiring (§5, §6.4).
- [ ] `main.ts` — prefetch seed on IDLE, start with it, record input log, show
      overlay on end (§6.1–6.3).

### 10.4 Deploy & verify
- [ ] Vercel project + Postgres (Neon) linked; `db/schema.sql` applied (§9).
- [ ] `SEED_SIGNING_SECRET` set in Vercel env.
- [ ] Vitest green (`npm run test`).
- [ ] Manual QA additions (§8.6) pass.
- [ ] Phase 7 gate (§8.7) passes against the live backend.
- [ ] Forged score field ignored; backend-unreachable degrades cleanly.

---

## 11. Out of scope (deliberate)

- **Bot / TAS detection** — the only cheat re-simulation can't catch (§0). No
  game has solved it; not attempting it.
- **Seed-shopping prevention beyond TTL + optional issuance rate-limit** — it's
  legitimate play on a server seed, a minor residual.
- Per-user accounts, auth, or identity beyond a typed name.
- Pagination beyond top-10, search, or regional boards.
- Editing or deleting submitted scores.
