import { sql } from './_lib/db.js';
import { verifySeed } from './_lib/sign.js';
import { sanitiseName, type InputEvent } from '../src/leaderboard.js';
import { seedFrom } from '../src/game/rng.js';
import { simulate } from '../src/game/simulate.js';

interface SubmitBody {
  seed?: unknown;
  issuedAt?: unknown;
  sig?: unknown;
  name?: unknown;
  inputLog?: unknown;
}

function bad(res: { status(code: number): { json(value: unknown): void } }, error: string): void {
  res.status(400).json({ error });
}

function validInputLog(value: unknown): InputEvent[] | null {
  if (!Array.isArray(value) || value.length > 20000) return null;
  const events: InputEvent[] = [];
  let prevTick = -1;
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const event = raw as Record<string, unknown>;
    if (
      typeof event.tick !== 'number' ||
      !Number.isInteger(event.tick) ||
      event.tick < 0 ||
      event.tick < prevTick ||
      (event.key !== 0 && event.key !== 1 && event.key !== 2) ||
      typeof event.down !== 'boolean'
    ) {
      return null;
    }
    prevTick = event.tick;
    events.push({ tick: event.tick, key: event.key, down: event.down });
  }
  return events;
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

  if (!verifySeed({ seed: body.seed, issuedAt: body.issuedAt, sig: body.sig })) {
    bad(res, 'bad-seed');
    return;
  }

  const inputLog = validInputLog(body.inputLog);
  if (inputLog === null) {
    bad(res, 'bad-input-log');
    return;
  }

  const name = typeof body.name === 'string' ? sanitiseName(body.name) : null;
  if (name === null) {
    bad(res, 'bad-name');
    return;
  }

  const replay = simulate(seedFrom(body.seed), inputLog);
  if (replay.ended !== 'GAME_OVER' && replay.ended !== 'WIN') {
    bad(res, 'not-terminal');
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
      where score > ${replay.score}
    `;
    res.status(200).json({ status: 'already-submitted', rank: rankRows.rows[0]?.rank ?? 0 });
    return;
  }

  await sql`
    insert into leaderboard (name, score)
    values (${name}, ${replay.score})
  `;
  const rankRows = await sql`
    select count(*)::int + 1 as rank
    from leaderboard
    where score > ${replay.score}
  `;
  res.status(200).json({ rank: rankRows.rows[0]?.rank ?? 0 });
}
