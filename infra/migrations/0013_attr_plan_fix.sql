-- 0013: agg_champ_vs_attr přes materializovanou baseline sil (SPEC-08, oprava plánu).
--
-- Verze z 0012 měla baseline sil jako CTE; plánovač ji odhadl na 495 řádků a spojil sa × sb
-- přes (patch, platform) do kartézského součinu (~25 mil. dvojic, odhad 6), pak index scan
-- mat_matchup pro každou — dotaz neskončil ani za 10 minut. Baseline je teď tabulka s primárním
-- klíčem a statistikami (mat_champ_wr), spojení jdou přes plný klíč a refresh po naplnění volá
-- ANALYZE, aby se mat_matchup po truncate/insert neplánoval podle starých statistik.

create table if not exists mat_champ_wr as
  select patch, platform, champion_id, position, 0.5::double precision as wr
  from mat_champ_pos where false;
alter table mat_champ_wr alter column patch set not null, alter column platform set not null,
  alter column champion_id set not null, alter column position set not null, alter column wr set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mat_champ_wr_pkey') then
    alter table mat_champ_wr add primary key (patch, platform, champion_id, position);
  end if;
end $$;

create or replace view agg_champ_vs_attr as
select x.patch, x.platform, x.tier_band,
       x.champ_a, x.pos_a, x.pos_b, t.dim, t.value,
       sum(x.games)::int  as games,
       sum(x.wins_a)::int as wins_a,
       sum(x.games * (sa.wr * (1 - sb.wr) / (sa.wr * (1 - sb.wr) + (1 - sa.wr) * sb.wr)))::double precision as exp_wins_a
from mat_matchup x
join champion_attr t on t.champion_id = x.champ_b
join mat_champ_wr sa on sa.patch = x.patch and sa.platform = x.platform and sa.champion_id = x.champ_a and sa.position = x.pos_a
join mat_champ_wr sb on sb.patch = x.patch and sb.platform = x.platform and sb.champion_id = x.champ_b and sb.position = x.pos_b
where x.pos_a is not null and x.pos_b is not null
group by 1, 2, 3, 4, 5, 6, 7, 8;

create or replace function refresh_aggregates() returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  truncate mat_champ_pos;        insert into mat_champ_pos        select * from agg_champ_pos;
  truncate mat_champ_wr;
  insert into mat_champ_wr
    select patch, platform, champion_id, position, (sum(wins) + 250.0) / (sum(games) + 500.0)
    from mat_champ_pos where position is not null group by 1, 2, 3, 4;
  truncate mat_position_prior;   insert into mat_position_prior   select * from agg_position_prior;
  truncate mat_matchup;          insert into mat_matchup          select * from agg_matchup;
  truncate mat_synergy;          insert into mat_synergy          select * from agg_synergy;
  truncate mat_champ_pos_pilot;  insert into mat_champ_pos_pilot  select * from agg_champ_pos_pilot;
  analyze mat_champ_wr; analyze mat_matchup; analyze champion_attr;
  truncate mat_champ_vs_attr;    insert into mat_champ_vs_attr    select * from agg_champ_vs_attr;
  insert into mat_refresh(name, refreshed_at, rows) values
    ('mat_champ_pos',       now(), (select count(*) from mat_champ_pos)),
    ('mat_position_prior',  now(), (select count(*) from mat_position_prior)),
    ('mat_matchup',         now(), (select count(*) from mat_matchup)),
    ('mat_synergy',         now(), (select count(*) from mat_synergy)),
    ('mat_champ_pos_pilot', now(), (select count(*) from mat_champ_pos_pilot)),
    ('mat_champ_vs_attr',   now(), (select count(*) from mat_champ_vs_attr))
  on conflict (name) do update set refreshed_at = excluded.refreshed_at, rows = excluded.rows;
end $$;
