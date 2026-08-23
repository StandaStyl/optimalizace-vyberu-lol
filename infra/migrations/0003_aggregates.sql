-- Phase 2: aggregate views feeding the model.
-- All views are keyed by (patch, platform, tier_band) so the model can be estimated per band.
-- tier_band null = unknown rank; the model uses 'all' (union) plus per-band estimates.

-- Champion strength on a position.
create or replace view agg_champ_pos as
select m.patch, m.platform, p.tier_band, p.champion_id, p.position,
       count(*)::int as games, sum(case when p.win then 1 else 0 end)::int as wins
from participant p join match m using (match_id)
group by 1,2,3,4,5;

-- Position prior: how often a champion appears on each position (for enemy-position inference).
create or replace view agg_position_prior as
select m.patch, m.platform, p.champion_id, p.position, count(*)::int as games
from participant p join match m using (match_id)
group by 1,2,3,4;

-- Matchup: champion A on pos_a vs enemy champion B on pos_b (all 25 position pairs).
-- wins_a counts games A's team won. Stored one-directional; the reverse is derivable.
create or replace view agg_matchup as
select m.patch, m.platform, a.tier_band,
       a.champion_id as champ_a, a.position as pos_a,
       b.champion_id as champ_b, b.position as pos_b,
       count(*)::int as games, sum(case when a.win then 1 else 0 end)::int as wins_a
from participant a
join participant b on b.match_id = a.match_id and b.team_id <> a.team_id
join match m on m.match_id = a.match_id
group by 1,2,3,4,5,6,7;

-- Synergy: champion A on pos_a with ally champion B on pos_b (10 unordered position pairs, stored ordered both ways).
create or replace view agg_synergy as
select m.patch, m.platform, a.tier_band,
       a.champion_id as champ_a, a.position as pos_a,
       b.champion_id as champ_b, b.position as pos_b,
       count(*)::int as games, sum(case when a.win then 1 else 0 end)::int as wins
from participant a
join participant b on b.match_id = a.match_id and b.team_id = a.team_id and b.puuid <> a.puuid
join match m on m.match_id = a.match_id
group by 1,2,3,4,5,6,7;

-- Player × champion (any position), with recency info for the H term.
create or replace view agg_player_champ as
select p.puuid, p.champion_id, p.position,
       count(*)::int as games, sum(case when p.win then 1 else 0 end)::int as wins,
       max(m.game_start) as last_played
from participant p join match m using (match_id)
group by 1,2,3;

-- Materialised snapshots refreshed by the model job (views above are expensive on large tables).
create table if not exists mat_champ_pos      (like agg_champ_pos including all);
create table if not exists mat_position_prior (like agg_position_prior including all);
create table if not exists mat_matchup        (like agg_matchup including all);
create table if not exists mat_synergy        (like agg_synergy including all);
create table if not exists mat_refresh (name text primary key, refreshed_at timestamptz not null, rows int not null);

create index if not exists mat_champ_pos_idx on mat_champ_pos (patch, platform, tier_band, position, champion_id);
create index if not exists mat_matchup_idx on mat_matchup (patch, platform, tier_band, champ_a, pos_a, pos_b);
create index if not exists mat_synergy_idx on mat_synergy (patch, platform, tier_band, champ_a, pos_a, pos_b);
create index if not exists mat_position_prior_idx on mat_position_prior (patch, platform, champion_id);

create or replace function refresh_aggregates() returns void language plpgsql as $$
begin
  truncate mat_champ_pos;      insert into mat_champ_pos      select * from agg_champ_pos;
  truncate mat_position_prior; insert into mat_position_prior select * from agg_position_prior;
  truncate mat_matchup;        insert into mat_matchup        select * from agg_matchup;
  truncate mat_synergy;        insert into mat_synergy        select * from agg_synergy;
  insert into mat_refresh(name, refreshed_at, rows) values
    ('mat_champ_pos', now(), (select count(*) from mat_champ_pos)),
    ('mat_position_prior', now(), (select count(*) from mat_position_prior)),
    ('mat_matchup', now(), (select count(*) from mat_matchup)),
    ('mat_synergy', now(), (select count(*) from mat_synergy))
  on conflict (name) do update set refreshed_at = excluded.refreshed_at, rows = excluded.rows;
end $$;
