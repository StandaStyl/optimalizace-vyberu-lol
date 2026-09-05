-- 0010: síla šampiona rozdělená podle zkušenosti pilota (SPEC-07 C).
--
-- Změřeno 5. 9. 2026 na patchi 16.16: hráči, kteří mají v našich datech >= 10 her na šampionovi,
-- vyhrávají 54-58 %, ostatní ~49.9 % (mezera 4.5 p.b., stejná na všech pozicích, n = 44 tis. vs.
-- 1-1.5 tis. na pozici). Populační WR šampiona je tedy prakticky WR "nových" pilotů; zkušený
-- uživatel má nárok na vlastní stratum. Práh 10 her je zde i v ModelParams.pilotExpGames —
-- při změně upravit obojí.
--
-- Počet her pilota se počítá napříč patchi (zkušenost se nenuluje s patchem).

create or replace view agg_champ_pos_pilot as
with pg as (
  select puuid, champion_id, count(*) as n from participant group by 1, 2
)
select m.patch, m.platform, p.tier_band, p.champion_id, p.position,
       count(*) filter (where pg.n >= 10)::int                          as games_exp,
       sum(case when pg.n >= 10 and p.win then 1 else 0 end)::int      as wins_exp,
       count(*) filter (where pg.n < 10)::int                           as games_new,
       sum(case when pg.n < 10 and p.win then 1 else 0 end)::int       as wins_new
from participant p
join match m using (match_id)
join pg using (puuid, champion_id)
where p.position is not null
group by 1, 2, 3, 4, 5;

create table if not exists mat_champ_pos_pilot (like agg_champ_pos_pilot including all);
create index if not exists mat_champ_pos_pilot_idx
  on mat_champ_pos_pilot (patch, platform, tier_band, position, champion_id);

-- refresh_aggregates() nově plní i pilotní tabulku. search_path zůstává připnutý (0009).
create or replace function refresh_aggregates() returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  truncate mat_champ_pos;        insert into mat_champ_pos        select * from agg_champ_pos;
  truncate mat_position_prior;   insert into mat_position_prior   select * from agg_position_prior;
  truncate mat_matchup;          insert into mat_matchup          select * from agg_matchup;
  truncate mat_synergy;          insert into mat_synergy          select * from agg_synergy;
  truncate mat_champ_pos_pilot;  insert into mat_champ_pos_pilot  select * from agg_champ_pos_pilot;
  insert into mat_refresh(name, refreshed_at, rows) values
    ('mat_champ_pos',       now(), (select count(*) from mat_champ_pos)),
    ('mat_position_prior',  now(), (select count(*) from mat_position_prior)),
    ('mat_matchup',         now(), (select count(*) from mat_matchup)),
    ('mat_synergy',         now(), (select count(*) from mat_synergy)),
    ('mat_champ_pos_pilot', now(), (select count(*) from mat_champ_pos_pilot))
  on conflict (name) do update set refreshed_at = excluded.refreshed_at, rows = excluded.rows;
end $$;
