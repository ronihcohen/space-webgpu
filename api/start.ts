import { randomBytes } from 'node:crypto';
import { signSeed } from './_lib/sign.js';
import { setCorsHeaders, type CorsResponse } from './_lib/cors.js';

export default function handler(_req: unknown, res: CorsResponse & {
  status(code: number): { json(value: unknown): void };
}): void {
  setCorsHeaders(res);
  const seed = randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  res.status(200).json({ seed, issuedAt, sig: signSeed(seed, issuedAt) });
}
