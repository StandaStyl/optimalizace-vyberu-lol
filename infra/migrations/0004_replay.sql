-- Retrospective draft replay results (SPEC-05 §1) and prospective recommendation log (SPEC-05 §2).
create table model_replay (
  run_id      bigint primary key references model_run(run_id) on delete cascade,
  games       int not null,
  picks       int not null,
  report      jsonb not null
);

create table recommendation_log (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  source        text not null,              -- 'web' | 'lcu'
  patch         text not null,
  tier_band     tier_band_t,
  puuid         text,                       -- requester, if known
  my_pos        position_t not null,
  state         jsonb not null,             -- allies/enemies/bans as sent
  recommended   jsonb not null,             -- top-N with p/lo/hi/class
  chosen        int,                        -- champion actually locked (filled later)
  match_id      text,                       -- resolved after the game
  win           boolean
);
create index recommendation_log_open_idx on recommendation_log (puuid) where match_id is null;
