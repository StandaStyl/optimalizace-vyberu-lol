-- 0011: atributy šampionů a agregát "šampion vs. atribut soupeře" (SPEC-08).
--
-- Atributy jsou rozdělení (partition) šampionů podle veřejně dohledatelných vlastností:
--   range (melee/ranged), mobility (dash/blink/none — z wiki stránek Dash a Blink), class
--   (Riot tag), subclass (wiki), toughness a mobility_rating (Riotova hodnocení 1–3),
--   dmgtype (adaptivní typ poškození). Plní je `ingest attrs` z LoL wiki (Module:ChampionData).
-- Nikde se neříká, co je proti čemu dobré — to se měří. Agregát dává pro každou buňku
-- (šampion A na pos_a, soupeř na pos_b s atributem dim=value) počet her, výhry A a součet
-- očekávání z nezávislosti sil (stejný baseline jako matchup člen v modelu), takže odchylka
-- "A proti melee soupeřům na top" je čitelná proti tomu, co by predikovaly samotné síly.
-- Model ji používá jako hierarchický prior konkrétní matchup buňky (score.ts, attrPrior).

create table if not exists champion_attr (
  champion_id  int  not null references champion(champion_id) on delete cascade,
  dim          text not null,
  value        text not null,
  source       text not null,
  updated_at   timestamptz not null default now(),
  primary key (champion_id, dim)
);

create or replace view agg_champ_vs_attr as
with s as (
  -- posterior mean of strength with the model's prior (N0 = 500, mean 0.5), per patch × platform
  select patch, platform, champion_id, position,
         (sum(wins) + 250.0) / (sum(games) + 500.0) as wr
  from mat_champ_pos
  where position is not null
  group by 1, 2, 3, 4
)
select m.patch, m.platform, a.tier_band,
       a.champion_id as champ_a, a.position as pos_a, b.position as pos_b, t.dim, t.value,
       count(*)::int                                         as games,
       sum(case when a.win then 1 else 0 end)::int           as wins_a,
       sum(sa.wr * (1 - sb.wr) / (sa.wr * (1 - sb.wr) + (1 - sa.wr) * sb.wr))::double precision as exp_wins_a
from participant a
join participant b on b.match_id = a.match_id and b.team_id <> a.team_id
join match m on m.match_id = a.match_id
join champion_attr t on t.champion_id = b.champion_id
join s sa on sa.patch = m.patch and sa.platform = m.platform and sa.champion_id = a.champion_id and sa.position = a.position
join s sb on sb.patch = m.patch and sb.platform = m.platform and sb.champion_id = b.champion_id and sb.position = b.position
where a.position is not null and b.position is not null
group by 1, 2, 3, 4, 5, 6, 7, 8;

create table if not exists mat_champ_vs_attr (like agg_champ_vs_attr including all);
create index if not exists mat_champ_vs_attr_idx
  on mat_champ_vs_attr (patch, platform, tier_band, champ_a, pos_a, pos_b, dim);

-- refresh_aggregates() plní i atributový agregát. mat_champ_pos musí být první (baseline sil).
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
