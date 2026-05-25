-- Migration: add seed column to leaderboard for atomic dedup
--
-- Why: the old design used a separate `submissions` table written in a separate
-- query. If the Vercel function was killed between the two writes (deployment
-- rollout, timeout), the seed was consumed but the score was never saved.
-- Retrying was silently ignored via the already-submitted path.
--
-- New design: one INSERT with ON CONFLICT (seed) DO NOTHING. Atomic by
-- construction — either both the seed record and the score land, or neither do.
-- Existing rows keep seed = NULL (NULLs are distinct, so no conflicts).

ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS seed text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leaderboard_seed_unique'
  ) THEN
    ALTER TABLE leaderboard ADD CONSTRAINT leaderboard_seed_unique UNIQUE (seed);
  END IF;
END $$;
