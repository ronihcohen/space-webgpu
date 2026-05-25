import { sql } from './_lib/db.js';

export default async function handler(_req: unknown, res: {
  status(code: number): { json(value: unknown): void };
}): Promise<void> {
  const result = await sql`
    select id, name, score, created_at
    from leaderboard
    order by score desc, created_at asc
    limit 10
  `;
  res.status(200).json({ rows: result.rows });
}
