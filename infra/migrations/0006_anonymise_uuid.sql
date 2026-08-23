-- gen_random_bytes lives in the pgcrypto extension (schema "extensions" on Supabase); use the built-in uuid instead.
create or replace function anonymise_player(p_puuid text) returns int language plpgsql as $$
declare tok text := 'deleted:' || replace(gen_random_uuid()::text, '-', ''); n int := 0; r int;
begin
  update participant set puuid = tok where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  update seed_player set puuid = tok, tier = null, division = null, tier_band = null where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  update recommendation_log set puuid = tok where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  delete from player_identity where puuid = p_puuid; get diagnostics r = row_count; n := n + r;
  return n;
end $$;
