-- Snowballed players are inserted with unknown tier; a lookup job fills it later.
alter table seed_player alter column tier drop not null;
alter table seed_player alter column division drop not null;
alter table seed_player alter column tier_band drop not null;
alter table seed_player add column tier_checked_at timestamptz;
create index seed_player_tier_unknown_idx on seed_player (platform) where tier_band is null;
