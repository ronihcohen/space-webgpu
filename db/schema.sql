create table if not exists leaderboard (
  id         bigint generated always as identity primary key,
  name       text    not null check (char_length(name) between 1 and 20),
  score      integer not null check (score >= 0 and score <= 999999),
  created_at timestamptz not null default now()
);

create index if not exists leaderboard_score_desc
  on leaderboard (score desc, created_at asc);

create table if not exists submissions (
  seed       text primary key,
  created_at timestamptz not null default now()
);
