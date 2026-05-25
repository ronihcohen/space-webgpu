# Phase 7 — Global Leaderboard

A global high-score leaderboard backed by Supabase Postgres + Edge Functions.

This document supersedes the "Leaderboard (Planned — Phase 7)" stub in `CLAUDE.md`.
It is self-contained: schema, anti-cheat design, client architecture, UX flow,
deployment, and a phase checklist with gate criteria.

> **Status:** Planned. No leaderboard code exists yet (`src/leaderboard.ts`,
> `supabase/` are not present). Phases 0–6 are the shipped game; this is the
> first networked feature.

---

## 0. Why this rewrite exists

The original Phase 7 stub had real design holes. This plan closes them:

| Gap in the stub | Fix here |
|-----------------|----------|
| Session token was **client-minted** (`crypto.randomUUID()`) and `sessionStart` was **client-supplied**, so the "impossible time" anti-cheat check was trivially bypassed by lying about the start time | Sessions are **registered server-side** at game start via a `start-session` Edge Function. The server owns `started_at`; the client never supplies a timestamp. (§3) |
| Two contradictory `leaderboard` insert policies (open `with check (true)` in the schema section, "no insert policy" in the anti-cheat section) | One **authoritative schema** with no client-facing insert policy. (§2) |
| `sessions` and `rate_limit` tables referenced but never defined; no TTL cleanup mechanism | Full DDL for all three tables + `pg_cron` cleanup job. (§2) |
| No test plan for `leaderboard.ts` or the Edge Functions | Vitest suite with mocked `fetch` + Edge Function validation tests. (§7) |
| UX flow had no error/offline branch | Explicit failure states: submit failed, offline, retry, always returns to IDLE. (§5, §6) |
| Name `<input>` collides with the game's `preventDefault` on Space/arrows | Game input is **suspended while the overlay field is focused**. (§6) |
| Edge Function deployment, CORS, and secrets unspecified; CI only injected build env | `supabase` CLI deploy steps, CORS headers, secret storage, and a deploy note. (§8) |

---

## 1. Architecture overview

```
                         ┌──────────────────────────────────────┐
  browser (static)       │           Supabase project           │
  ─────────────────      │  ──────────────────────────────────  │
  src/leaderboard.ts     │                                      │
    startSession() ──────┼──► Edge Fn: start-session            │
                         │      • rate-limit by IP              │
                         │      • insert sessions row (server   │
                         │        owns started_at)              │
                         │      • return { token }              │
                         │                                      │
    submitScore() ───────┼──► Edge Fn: submit-score             │
                         │      • rate-limit by IP              │
                         │      • look up session by token      │
                         │      • elapsed-time plausibility     │
                         │      • score cap + name sanitise     │
                         │      • mark session submitted        │
                         │      • service-role INSERT           │
                         │                                      │
    fetchTop10() ────────┼──► PostgREST (publishable key)       │
                         │      • SELECT via "read all" RLS     │
                         └──────────────────────────────────────┘
```

- **Reads** (`fetchTop10`) go directly to PostgREST with the publishable key — RLS
  allows `select`, nothing else.
- **Writes** never touch the DB directly. Both write paths are Edge Functions
  running with the service-role key (which bypasses RLS). There is **no
  client-facing insert policy**, so a leaked publishable key cannot insert.

### Files

| File | Responsibility |
|------|----------------|
| `src/leaderboard.ts` | Supabase client + `startSession()`, `submitScore()`, `fetchTop10()`. Pure async, no GPU/game-state imports. Throws typed errors on failure. |
| `src/leaderboard-ui.ts` | Overlay show/hide, render top-10 table, name form, input-suspension wiring. Imported by `main.ts`. |
| `supabase/functions/start-session/index.ts` | Registers a session, returns a token. |
| `supabase/functions/submit-score/index.ts` | Validates + inserts a score. |
| `supabase/functions/_shared/cors.ts` | Shared CORS headers + preflight helper. |
| `supabase/migrations/0001_leaderboard.sql` | Authoritative schema (§2). |
| `index.html` | `<div id="leaderboard-overlay">` markup (mirrors existing `#error-overlay`). |

---

## 2. Database schema (authoritative)

`supabase/migrations/0001_leaderboard.sql`:

```sql
-- ─── leaderboard ─────────────────────────────────────────────────────────────
create table leaderboard (
  id         bigint generated always as identity primary key,
  name       text    not null check (char_length(name) between 1 and 20),
  score      integer not null check (score >= 0 and score <= 999999),
  created_at timestamptz not null default now()
);

create index leaderboard_score_desc on leaderboard (score desc, created_at asc);

alter table leaderboard enable row level security;

-- Anyone may read. NO insert/update/delete policy exists:
-- the service role (used only by the submit-score Edge Function) bypasses RLS,
-- and the anon/publishable key therefore cannot write.
create policy "read all" on leaderboard for select using (true);

-- ─── sessions ────────────────────────────────────────────────────────────────
-- One row per started game. Server owns started_at; the client never supplies a
-- timestamp. status flips open → submitted exactly once (single-use token).
create table sessions (
  token       uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  status      text not null default 'open' check (status in ('open','submitted')),
  ip          text,
  created_at  timestamptz not null default now()
);

create index sessions_created_at on sessions (created_at);

alter table sessions enable row level security;
-- No policies → only the service role (Edge Functions) can touch this table.

-- ─── rate_limit ──────────────────────────────────────────────────────────────
-- Sliding-window counter keyed on (ip, endpoint). One row per request; counts
-- are queried over a time window by the Edge Function.
create table rate_limit (
  id        bigint generated always as identity primary key,
  ip        text not null,
  endpoint  text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_lookup on rate_limit (ip, endpoint, created_at);

alter table rate_limit enable row level security;
-- No policies → service role only.

-- ─── cleanup (pg_cron) ───────────────────────────────────────────────────────
-- Sessions older than 2h and rate-limit rows older than 1h are disposable.
-- Enable pg_cron once (Supabase dashboard → Database → Extensions), then:
select cron.schedule(
  'leaderboard-cleanup', '*/15 * * * *',
  $$
    delete from sessions   where created_at < now() - interval '2 hours';
    delete from rate_limit where created_at < now() - interval '1 hour';
  $$
);
```

**Design notes**

- The `score <= 999999` CHECK is defence-in-depth — the Edge Function rejects
  over-cap scores first, but the DB enforces it even if the function has a bug.
- `sessions` has no `select` policy: the client can't enumerate tokens.
- TTL is handled by `pg_cron`, not application code. If `pg_cron` is unavailable
  on the plan tier, fall back to a `created_at` filter in the Edge Function's
  session lookup (`status = 'open' and created_at > now() - interval '2 hours'`)
  and accept unbounded table growth (rows are tiny; vacuum later).

---

## 3. Anti-cheat design

The threat model: the publishable key and the score value are both visible in
the browser. We can't make cheating impossible without server-side simulation
(out of scope), so the goal is to **raise the bar enough that the leaderboard
stays clean without a ban system.**

### 3.1 Server-anchored sessions (the core fix)

```
startGame()                       ┌─ start-session ─┐
  POST /start-session  ──────────►│ rate-limit IP   │
                                  │ INSERT sessions  │  started_at = now()  (server clock)
  { token } ◄─────────────────────│ RETURN token     │
                                  └──────────────────┘
  store token in GameState.sessionToken

… player plays …

GAME_OVER / WIN (score > 0)       ┌─ submit-score ──┐
  POST /submit-score              │ rate-limit IP    │
    { token, name, score } ──────►│ SELECT session   │  must be status='open'
                                  │ elapsed check    │  now() - started_at vs score
                                  │ score cap        │  score <= 999999
                                  │ name sanitise    │
                                  │ UPDATE status →   │  'submitted' (single-use)
                                  │   'submitted'     │
                                  │ INSERT leaderboard│  service role
  { rank, id } ◄───────────────────│ RETURN row       │
                                  └──────────────────┘
```

Why this is stronger than the original stub: **the client never supplies a
timestamp.** `started_at` is written by the database on the `start-session`
call. To submit a 50,000-point game an attacker must have called
`start-session` at least `50000 / MAX_POINTS_PER_SECOND` seconds earlier — they
can't backdate it. The token is single-use (`status` flips to `submitted`), so
replaying the same `{token, score}` fails.

### 3.2 Elapsed-time plausibility

```ts
const MAX_POINTS_PER_SECOND = 50; // generous; tune against real playtests
const elapsedSec = (Date.now() - session.started_at) / 1000;
if (score > elapsedSec * MAX_POINTS_PER_SECOND) reject('implausible-rate');
```

Pick `MAX_POINTS_PER_SECOND` from real games: the fastest legit scoring is a
fully-cleared wave (~2,300 pts) in the time it takes to shoot 55 invaders +
UFO. 50 pts/s is comfortably above any human rate while still rejecting
"100k points in 10 seconds" bots. **Tune after Phase 5 playtest data exists.**

### 3.3 Score cap

Max ~2,300 pts/wave (55 invaders × 30 + UFO). A long legit run is bounded;
reject anything over **999,999** as an obvious cheat. Enforced in the Edge
Function and as a DB CHECK.

### 3.4 Rate limiting

Both endpoints: **max 5 requests per IP per hour**, counted from the
`rate_limit` table over a 1-hour window. IP comes from `X-Forwarded-For` (first
hop). Note `X-Forwarded-For` is spoofable; this is a speed-bump, not a wall.

### 3.5 Name sanitisation

Strip control characters, trim, collapse whitespace, enforce 1–20 chars after
trimming, reject empty. Same constraints as the DB CHECK (defence in depth).

```ts
function sanitiseName(raw: string): string | null {
  const cleaned = raw.replace(/[ -]/g, '').trim().slice(0, 20);
  return cleaned.length >= 1 ? cleaned : null;
}
```

### 3.6 What this does NOT prevent (deliberate)

A determined attacker can script: call `start-session`, sleep a plausible
interval, submit a capped score. Full prevention needs server-side game
simulation, which is out of scope for an arcade clone. Documented as an accepted
tradeoff — the bar is high enough to keep casual tampering out.

---

## 4. Client library (`src/leaderboard.ts`)

```ts
import { createClient } from '@supabase/supabase-js';

const URL  = import.meta.env.VITE_SUPABASE_URL;
const KEY  = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FN   = `${URL}/functions/v1`;

// Reads only — publishable key, RLS allows select.
const supabase = createClient(URL, KEY);

export class LeaderboardError extends Error {
  constructor(public kind: 'offline' | 'rejected' | 'server', message: string) {
    super(message);
  }
}

export interface LeaderboardRow { id: number; name: string; score: number; created_at: string; }

/** Called on startGame. Returns a server-issued session token, or null if the
 *  leaderboard backend is unreachable (game still plays; submission disabled). */
export async function startSession(): Promise<string | null> { /* POST /start-session */ }

/** Called on GAME_OVER/WIN when score > 0 and a token exists. */
export async function submitScore(
  token: string, name: string, score: number,
): Promise<{ rank: number }> { /* POST /submit-score; throws LeaderboardError */ }

/** Direct PostgREST read. */
export async function fetchTop10(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from('leaderboard').select('*')
    .order('score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) throw new LeaderboardError('server', error.message);
  return data ?? [];
}

/** True only if both env vars are present — lets the game disable leaderboard
 *  UI cleanly when built without Supabase config. */
export function leaderboardConfigured(): boolean { return Boolean(URL && KEY); }
```

- If `leaderboardConfigured()` is false, the game runs exactly as it does today
  (no overlay, no network). This keeps the feature optional and the build green
  without secrets.
- `startSession()` swallows network errors and returns `null` — a failed
  session start must never block the player from playing.

```bash
npm install @supabase/supabase-js
```

---

## 5. UX flow

```
GAME_OVER / WIN
  │
  ├─ score === 0  OR  !leaderboardConfigured()
  │     └─► current behaviour: Space / any key → IDLE   (no overlay)
  │
  └─ score > 0 AND leaderboardConfigured()
        └─► show #leaderboard-overlay
              ┌───────────────────────────────────────────┐
              │  GLOBAL HIGH SCORES                         │
              │  ─────────────────────────────────────────  │
              │   1.  AAA            12,340                  │
              │   …  (top 10, fetchTop10)                    │
              │  ─────────────────────────────────────────  │
              │  Your score: 4,250                           │
              │  Name: [____]  [ Submit ]                    │
              │  ─────────────────────────────────────────  │
              │            [ Play again ]                    │
              └───────────────────────────────────────────┘

   States within the overlay:
     loading   → spinner while fetchTop10() resolves
     ready     → table + name form enabled
     fetch-err → "Couldn't load scores." + [Retry] + table hidden; form still works
     submitting→ Submit disabled, "Submitting…"
     submitted → table refreshes, player's new row highlighted, form replaced by rank
     submit-err→ inline error + [Retry]; Submit re-enabled (token NOT consumed if
                 the server rejected before marking submitted — safe to retry)
     offline   → "You're offline — score not submitted." + [Play again] still works

   Exit (any state): Space or [Play again] → hide overlay → returnToIdle()
```

Rules:
- Overlay appears **only** on game end with `score > 0` and config present. The
  IDLE attract screen never shows a leaderboard.
- **Play again always works**, in every overlay state, even mid-error. A network
  problem must never trap the player.
- Submit is **idempotent-safe**: the token is single-use server-side, so a
  double-click can't create two rows (second call hits `status='submitted'` →
  `already-submitted`, which the UI treats as success and shows the rank).

---

## 6. Integration with `main.ts` and the state machine

### 6.1 GameState gains a session token

`src/game/state.ts`:

```ts
export interface GameState {
  phase: GamePhase;
  score: number;
  highScore: number;
  wave: number;
  level: number;
  sessionToken: string | null;   // ← new; null until startGame resolves a session
}
```

- `makeGameState()` → `sessionToken: null`.
- `startGame()` stays **pure** (it's unit-tested and synchronous). The async
  `startSession()` call lives in `main.ts`, which writes the resolved token back
  onto the state object after the transition. `startGame` just clears it to
  `null` at the start of a run.
- `returnToIdle()` clears `sessionToken` back to `null`.

### 6.2 main.ts wiring

```ts
// IDLE → PLAYING (first keydown that starts the game)
state = startGame(state);
context.resume();                       // existing AudioContext gate
if (leaderboardConfigured()) {
  startSession().then(t => { state.sessionToken = t; });  // fire-and-forget
}

// PLAYING → GAME_OVER | WIN  (after triggerGameOver / triggerWin)
if (leaderboardConfigured() && state.score > 0) {
  showLeaderboardOverlay(state.score, state.sessionToken);
}
```

### 6.3 Keyboard-conflict fix (the name `<input>`)

`src/game/input.ts` calls `preventDefault()` on Space/arrows and listens on
`window`. While the player types their name this would swallow the spacebar and
let game keys leak. Fix:

- Add an exported `setInputEnabled(enabled: boolean)` flag in `input.ts`. When
  disabled, the keydown handler returns early **without** `preventDefault` and
  **without** recording held/edge state.
- When the name `<input>` receives focus → `setInputEnabled(false)`.
  On blur / overlay close → `setInputEnabled(true)`.
- Belt-and-braces: the input's own `keydown` handler calls
  `e.stopPropagation()` so keystrokes never reach the window listener even if a
  toggle is missed.

This is listed as a gate item — it's the single most likely "works in dev, broken
on first real play" bug in the feature.

---

## 7. Test plan

### 7.1 Vitest — `src/leaderboard.test.ts` (mocked `fetch`)

Keep `leaderboard.ts` free of GPU/game-state imports so it tests in isolation.
Mock `fetch` / the Supabase client:

- `fetchTop10()` parses rows and orders by score desc, created_at asc.
- `fetchTop10()` throws `LeaderboardError('server')` on a PostgREST error.
- `startSession()` returns the token on 200.
- `startSession()` returns `null` (not throw) on network failure — the
  "playing must never be blocked" contract.
- `submitScore()` throws `LeaderboardError('rejected')` on a 4xx (cap/rate/time).
- `submitScore()` throws `LeaderboardError('offline')` on network failure.
- `submitScore()` treats `already-submitted` as success (returns the rank).
- `leaderboardConfigured()` is false when either env var is missing.
- `sanitiseName()` (export for test): strips control chars, trims, caps at 20,
  rejects empty/whitespace-only.

### 7.2 Edge Function validation tests

Run with `deno test` against the function handlers (pure functions extracted
from the request handler so they don't need a live DB):

- elapsed-time check rejects when `score > elapsed * MAX_POINTS_PER_SECOND`.
- elapsed-time check passes for a plausible rate.
- score cap rejects `> 999999`.
- name sanitiser matches the client's (shared logic, copy or shared module).
- single-use: a session already `submitted` is rejected as `already-submitted`.
- rate limiter rejects the 6th request in a window, allows the 5th.

### 7.3 Playwright (local, optional)

Add **one** integration test behind a flag (needs live Supabase or a local
`supabase start` stack — don't wire into CI):

- Game over with score > 0 → overlay appears, top-10 renders, submit succeeds,
  player row highlighted, Play again returns to IDLE.

Don't port the unit cases into Playwright — they run ~100× slower.

### 7.4 Manual QA additions

Append to the existing checklist in `CLAUDE.md`:

- [ ] Overlay shows only on game end with score > 0; IDLE never shows it.
- [ ] Typing a name doesn't move the cannon or fire (input suspended).
- [ ] Double-clicking Submit creates exactly one row.
- [ ] Airplane-mode game-over: overlay shows "offline", Play again still works.
- [ ] Build with no Supabase env vars → game plays normally, no overlay, no
      console errors.

### 7.5 Phase 7 gate

> Full loop with leaderboard: game over (score > 0) → overlay → submit → row
> appears in the live top-10 and is highlighted → Play again → IDLE. Submitting
> the same session twice does not duplicate. A build without env vars degrades
> cleanly to the current no-leaderboard behaviour.

---

## 8. Deployment

### 8.1 Local credentials (`.env`, gitignored)

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The DB password from the Postgres connection string is **server-side only** —
never in browser code. The service-role key lives only in Supabase function
secrets (below), never in the repo or the client bundle.

### 8.2 Edge Function CORS

GitHub Pages is a different origin from `*.supabase.co`, so the functions must
send CORS headers and answer preflight. `supabase/functions/_shared/cors.ts`:

```ts
export const cors = {
  'Access-Control-Allow-Origin': '*', // or pin to the Pages origin
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export function preflight(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  return null;
}
```

Every function returns `cors` headers on all responses.

### 8.3 Deploy steps (manual, one-time + on change)

```bash
# Install + link (once)
brew install supabase/tap/supabase     # or npm i -g supabase
supabase link --project-ref <project-ref>

# Apply schema (once / on migration change)
supabase db push                        # runs supabase/migrations/*.sql

# Set the service-role key as a function secret (once)
supabase secrets set SERVICE_ROLE_KEY=<service-role-key>

# Deploy functions (on change)
supabase functions deploy start-session
supabase functions deploy submit-score
```

Edge Functions are **not** built or deployed by the GitHub Pages workflow — that
job only ships the static `dist/`. Function deploys are a separate manual step
(or a separate workflow later). Document this so a function change isn't silently
missing in production.

### 8.4 GitHub Pages build env

The existing `.github/workflows/*.yml` injects build-time env into `npm run
build`. Add the two `VITE_` vars (repo secrets):

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
```

If the secrets are absent, the build still succeeds and the game ships without
the leaderboard (`leaderboardConfigured()` → false). That keeps the deploy
unblocked while credentials are being set up.

---

## 9. Implementation checklist

### 9.1 Backend
- [ ] Create Supabase project; note URL + publishable key + service-role key.
- [ ] `supabase/migrations/0001_leaderboard.sql` — three tables, RLS, indexes (§2).
- [ ] Enable `pg_cron`; schedule the cleanup job.
- [ ] `_shared/cors.ts` + preflight helper.
- [ ] `start-session` Edge Function: rate-limit, insert session, return token.
- [ ] `submit-score` Edge Function: rate-limit, session lookup, elapsed check,
      score cap, name sanitise, mark submitted, service-role insert.
- [ ] `supabase secrets set SERVICE_ROLE_KEY=…`; deploy both functions.
- [ ] Deno tests for the extracted validation functions (§7.2).

### 9.2 Client
- [ ] `npm install @supabase/supabase-js`.
- [ ] `src/leaderboard.ts` — `startSession`, `submitScore`, `fetchTop10`,
      `leaderboardConfigured`, `LeaderboardError`, `sanitiseName` (§4).
- [ ] `src/leaderboard.test.ts` — mocked-fetch suite (§7.1).
- [ ] `GameState.sessionToken` field; clear in `startGame`/`returnToIdle` (§6.1).
- [ ] `input.ts` — `setInputEnabled()` flag (§6.3).
- [ ] `index.html` — `#leaderboard-overlay` markup + styles (mirror `#error-overlay`).
- [ ] `src/leaderboard-ui.ts` — overlay states, top-10 render, name form,
      input-suspension wiring (§5, §6.3).
- [ ] `main.ts` — fire `startSession` on start; show overlay on end (§6.2).
- [ ] `.env` locally; repo secrets + workflow env injection (§8).

### 9.3 Verify
- [ ] Vitest green (`npm run test`).
- [ ] Manual QA additions (§7.4) pass.
- [ ] Phase 7 gate (§7.5) passes against the live backend.
- [ ] Build with secrets absent → clean no-leaderboard fallback.

---

## 10. Out of scope (deliberate)

- Server-side game simulation / replay verification (the only true anti-cheat).
- Per-user accounts, auth, or persistent identity beyond a typed name.
- Pagination beyond top-10, search, or regional boards.
- Editing or deleting submitted scores (no update/delete policy by design).
