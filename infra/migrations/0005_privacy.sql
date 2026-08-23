-- SPEC-02: Riot IDs stored separately from match data; deletable on request.
create table player_identity (
  puuid       text primary key,
  game_name   text not null,
  tag_line    text not null,
  platform    text not null,
  looked_up_at timestamptz not null default now()
);
create unique index player_identity_riot_id_idx on player_identity (lower(game_name), lower(tag_line), platform);

-- Irreversibly anonymise a player: replace puuid everywhere with a random token, drop identity row.
create or replace function anonymise_player(p_puuid text) returns int language plpgsql as $$
declare tok text := 'deleted:' || encode(gen_random_bytes(16), 'hex'); n int := 0; r int;
begin
  update participant set puuid = tok where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  update seed_player set puuid = tok, tier = null, division = null, tier_band = null where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  update recommendation_log set puuid = tok where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  delete from player_identity where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  return n;
end $$;
