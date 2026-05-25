import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedSeed {
  seed: string;
  issuedAt: number;
  sig: string;
}

export const SEED_TTL_MS = 6 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.SEED_SIGNING_SECRET;
  if (!value) throw new Error('SEED_SIGNING_SECRET is not set');
  return value;
}

export function signSeed(seed: string, issuedAt: number): string {
  return createHmac('sha256', secret()).update(`${seed}.${issuedAt}`).digest('hex');
}

export function verifySeed({ seed, issuedAt, sig }: SignedSeed, now = Date.now()): boolean {
  if (!seed || !Number.isFinite(issuedAt) || !sig) return false;
  if (now - issuedAt < 0 || now - issuedAt > SEED_TTL_MS) return false;
  const expected = signSeed(seed, issuedAt);
  const actualBuffer = Buffer.from(sig, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
