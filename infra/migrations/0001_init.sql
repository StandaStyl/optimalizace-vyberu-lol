-- Draft Advisor: core schema (phase 0)
-- Raw match data (no PII beyond puuid), static reference data, model bookkeeping.

create type position_t as enum ('TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY');
create type tier_band_t as enum ('low','mid','high');
create type tier_t as enum ('IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER');

create table patch (
  patch        text primary key,          -- '16.16'
  ddragon_ver  text not null,             -- '16.16.1'
  first_seen   timestamptz not null default now()
);

create table champion (
  champion_id  int primary key,
  key          text not null,             -- 'Aatrox'
  name         text not null,
  tags         text[] not null,           -- Data Dragon tags (Fighter, Tank, ...)
  updated_at   timestamptz not null default now()
);

create table seed_player (
  puuid        text primary key,
  platform     text not null,
  tier         tier_t not null,
  division     text not null,
  tier_band    tier_band_t not null,
  last_crawled timestamptz,
  created_at   timestamptz not null default now()
);
create index seed_player_crawl_idx on seed_player (platform, last_crawled nulls first);

create table match_queue (
  match_id     text primary key,
  platform     text not null,
  state        text not null default 'pending',   -- pending | done | failed
  attempts     int not null default 0,
  enqueued_at  timestamptz not null default now(),
  done_at      timestamptz
);
create index match_queue_state_idx on match_queue (state, enqueued_at);

create table match (
  match_id     text primary key,
  platform     text not null,
  patch        text not null references patch(patch),
  game_version text not null,
  queue_id     int not null,
  game_start   timestamptz not null,
  duration_sec int not null,
  winner_team  smallint not null check (winner_team in (100,200)),
  ingested_at  timestamptz not null default now()
);
create index match_patch_idx on match (patch, platform, game_start);

create table participant (
  match_id       text not null references match(match_id) on delete cascade,
  puuid          text not null,
  team_id        smallint not null check (team_id in (100,200)),
  champion_id    int not null,
  position       position_t,             -- null when Riot did not assign a position
  win            boolean not null,
  tier_band      tier_band_t,            -- band of this player at ingest time (from seed/league lookup), may be null
  kills          smallint not null, deaths smallint not null, assists smallint not null,
  items          int[] not null,
  primary_style  int, sub_style int, keystone int,
  champ_level    smallint,
  physical_dmg   int, magic_dmg int, true_dmg int, dmg_taken int,
  primary key (match_id, puuid)
);
create index participant_champ_idx on participant (champion_id, position);
create index participant_puuid_idx on participant (puuid);

-- Model bookkeeping: every recomputation is a run with its parameters and evaluation.
create table model_run (
  run_id       bigserial primary key,
  patch        text not null references patch(patch),
  tier_band    tier_band_t,
  params       jsonb not null,           -- prior strengths, tau, blend, ...
  created_at   timestamptz not null default now()
);

create table model_eval (
  run_id       bigint not null references model_run(run_id) on delete cascade,
  split        text not null,            -- 'holdout_same_patch' | 'next_patch_first_days'
  n_games      int not null,
  logloss      double precision not null,
  brier        double precision not null,
  auc          double precision not null,
  ece          double precision not null,
  calibration  jsonb not null,           -- bins: [{lo,hi,n,pred,obs}]
  baseline     text not null,            -- 'const' | 'strength' | 'pairwise' | 'full'
  primary key (run_id, split, baseline)
);
