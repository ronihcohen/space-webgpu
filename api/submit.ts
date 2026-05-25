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

  // The signed seed proves the submission carries a token this server issued
  // recently (HMAC + TTL), and the submissions table makes it single-use. That
  // is the whole anti-abuse story now: we trust the client's reported score
  // rather than re-deriving it from a replay. Re-deriving meant maintaining a
  // second, byte-identical copy of the game simulation on the server; any drift
  // between it and the live game saved a different score than the player saw.
  // Trusting the client is less cheat-proof but makes the saved score exactly
  // the score the player earned.
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

  const submitted = await sql`
    insert into submissions (seed)
    values (${body.seed})
    on conflict do nothing
    returning seed
  `;
  if (submitted.rowCount === 0) {
    const rankRows = await sql`
      select count(*)::int + 1 as rank
      from leaderboard
      where score > ${score}
    `;
    res.status(200).json({ status: 'already-submitted', rank: rankRows.rows[0]?.rank ?? 0 });
    return;
  }

  await sql`
    insert into leaderboard (name, score)
    values (${name}, ${score})
  `;
  const rankRows = await sql`
    select count(*)::int + 1 as rank
    from leaderboard
    where score > ${score}
  `;
  res.status(200).json({ rank: rankRows.rows[0]?.rank ?? 0 });
}
