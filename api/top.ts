import { sql } from './_lib/db.js';
import { setCorsHeaders, type CorsResponse } from './_lib/cors.js';

export default async function handler(_req: unknown, res: CorsResponse & {
  status(code: number): { json(value: unknown): void };
}): Promise<void> {
  setCorsHeaders(res);
  const result = await sql`
    select id, name, score, created_at
    from leaderboard
    order by score desc, created_at asc
    limit 10
  `;
  res.status(200).json({ rows: result.rows });
}
