import { randomBytes } from 'node:crypto';
import { signSeed } from './_lib/sign.js';

export default function handler(_req: unknown, res: {
  status(code: number): { json(value: unknown): void };
}): void {
  const seed = randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  res.status(200).json({ seed, issuedAt, sig: signSeed(seed, issuedAt) });
}
