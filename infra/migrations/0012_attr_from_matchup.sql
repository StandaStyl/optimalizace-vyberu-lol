-- 0012: agg_champ_vs_attr počítat z mat_matchup místo z dvojic účastníků (SPEC-08).
--
-- Verze z 0011 (participant × participant × champion_attr, ~9 mil. řádků) spadla na
-- statement_timeout. Očekávání z nezávislosti je uvnitř (patch, platform, tier_band) konstantní
-- pro celou matchup buňku, takže součet očekávaných výher = games × p_exp(buňka) — agregát nad
-- mat_matchup (308 tis. řádků × atributy) dává přesně totéž za zlomek ceny. refresh_aggregates()
-- plní mat_matchup před mat_champ_vs_attr (pořadí v 0011 zůstává).

create or replace view agg_champ_vs_attr as
with s as (
  select patch, platform, champion_id, position,
         (sum(wins) + 250.0) / (sum(games) + 500.0) as wr
  from mat_champ_pos
  where position is not null
  group by 1, 2, 3, 4
)
select x.patch, x.platform, x.tier_band,
       x.champ_a, x.pos_a, x.pos_b, t.dim, t.value,
       sum(x.games)::int  as games,
       sum(x.wins_a)::int as wins_a,
       sum(x.games * (sa.wr * (1 - sb.wr) / (sa.wr * (1 - sb.wr) + (1 - sa.wr) * sb.wr)))::double precision as exp_wins_a
from mat_matchup x
join champion_attr t on t.champion_id = x.champ_b
join s sa on sa.patch = x.patch and sa.platform = x.platform and sa.champion_id = x.champ_a and sa.position = x.pos_a
join s sb on sb.patch = x.patch and sb.platform = x.platform and sb.champion_id = x.champ_b and sb.position = x.pos_b
where x.pos_a is not null and x.pos_b is not null
group by 1, 2, 3, 4, 5, 6, 7, 8;
