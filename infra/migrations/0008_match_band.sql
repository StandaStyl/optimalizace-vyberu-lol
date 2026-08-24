-- Ranked Solo/Duo matches players of similar MMR, so the band of one known participant
-- is strong evidence for the whole match. Measured on 2026-08-24: of the matches where two
-- or more participants had a looked-up band, 93 % agreed (113 matches, 8 conflicts).
--
-- This only STORES the inferred band; aggregates still group by participant.tier_band.
-- Switching the model over to match-level bands is a modelling decision (see docs/HANDOVER.md).
alter table match add column tier_band tier_band_t;
alter table match add column tier_band_source text check (tier_band_source in ('participant_majority'));

create index match_band_idx on match (patch, tier_band);

-- Fills match.tier_band from the most common looked-up band among its participants.
create or replace function infer_match_bands() returns int language plpgsql as $$
declare n int;
begin
  with per_match as (
    select p.match_id, mode() within group (order by p.tier_band) as band
    from participant p
    where p.tier_band is not null
    group by p.match_id
  )
  update match m
     set tier_band = pm.band, tier_band_source = 'participant_majority'
    from per_match pm
   where m.match_id = pm.match_id
     and (m.tier_band is distinct from pm.band);
  get diagnostics n = row_count;
  return n;
end $$;
