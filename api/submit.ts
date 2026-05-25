import { sql } from './_lib/db.js';
import { verifySeed } from './_lib/sign.js';
import { sanitiseName } from '../src/leaderboard.js';

interface SubmitBody {
  seed?: unknown;
  issuedAt?: unknown;
  sig?: unknown;
  name?: unknown;
  score?: unknown;
}

const MAX_SCORE = 999999;

function bad(res: { status(code: number): { json(value: unknown): void } }, error: string): void {
  res.status(400).json({ error });
}

function validScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const score = Math.floor(value);
  if (score < 0 || score > MAX_SCORE) return null;
  return score;
}

export default async function handler(req: { method?: string; body?: SubmitBody }, res: {
  status(code: number): { json(value: unknown): void };
}): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  const body = req.body ?? {};
  if (
    typeof body.seed !== 'string' ||
    typeof body.issuedAt !== 'number' ||
    typeof body.sig !== 'string'
  ) {
    bad(res, 'bad-seed');
    return;
  }

  // Verify the server-issued HMAC token: proves the seed was issued by this
  // server recently (TTL check) and hasn't been tampered with.
  if (!verifySeed({ seed: body.seed, issuedAt: body.issuedAt, sig: body.sig })) {
    bad(res, 'bad-seed');
    return;
  }

  const score = validScore(body.score);
  if (score === null) {
    bad(res, 'bad-score');
    return;
  }

  const name = typeof body.name === 'string' ? sanitiseName(body.name) : null;
  if (name === null) {
    bad(res, 'bad-name');
    return;
  }

  // Single atomic write: seed dedup + score save in one query.
  // ON CONFLICT (seed) DO NOTHING means a duplicate seed is silently ignored
  // and rowCount comes back 0. This replaces the old two-step design
  // (INSERT submissions, then INSERT leaderboard) which could be interrupted
  // between the two writes — consuming the seed token permanently while the
  // score was never saved.
  await sql`
    INSERT INTO leaderboard (seed, name, score)
    VALUES (${body.seed}, ${name}, ${score})
    ON CONFLICT (seed) DO NOTHING
  `;

  const rankRows = await sql`
    SELECT count(*)::int + 1 AS rank FROM leaderboard WHERE score > ${score}
  `;
  const rank = rankRows.rows[0]?.rank ?? 0;
  console.log('[submit] score:', score, 'rank:', rank, 'seed:', body.seed.slice(0, 8));
  res.status(200).json({ rank });
}
