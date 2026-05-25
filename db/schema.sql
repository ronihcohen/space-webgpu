create table if not exists leaderboard (
  id         bigint generated always as identity primary key,
  -- seed is the server-issued HMAC token used for dedup. NULL on rows created
  -- before this column was added; new rows always carry a seed.
  seed       text        unique,
  name       text        not null check (char_length(name) between 1 and 20),
  score      integer     not null check (score >= 0 and score <= 999999),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_score_desc
  on leaderboard (score desc, created_at asc);

-- Kept for historical data; no longer written to by api/submit.
create table if not exists submissions (
  seed       text primary key,
  created_at timestamptz not null default now()
);
