-- 0009: zamknout PostgREST povrch (Supabase advisor 2026-08-23).
-- Devet tabulek z rane faze melo plne granty pro anon/authenticated (dedictvi
-- default privileges z SQL editoru), takze sly cist i prepisovat pres REST API
-- s verejnym anon klicem. Aplikace jde vyhradne pres prime pg pripojeni jako
-- draft_ingest (vlastnik objektu), takze anon/authenticated nepotrebuji nic.
-- Vse idempotentni; opakovane spusteni je bezpecne.

-- 1) Odebrat granty pro PostgREST role na vsech tabulkach a sekvencich.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 2) Funkce nesmi byt volatelne pres REST RPC (mely PUBLIC:EXECUTE;
--    anonymise_player sla zavolat anonymne). Vlastnik zustava v ACL explicitne.
revoke all on all functions in schema public from public, anon, authenticated;

-- 3) RLS na vsech tabulkach: vlastnik draft_ingest ji obchazi, nikdo jiny
--    policy nema -> PostgREST nevrati nic ani kdyby grant nekdy pribyl.
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 4) Advisor 0011: pripnout search_path funkci.
alter function public.anonymise_player(p_puuid text) set search_path = public, pg_temp;
alter function public.infer_match_bands() set search_path = public, pg_temp;
alter function public.refresh_aggregates() set search_path = public, pg_temp;

-- Pozn.: default privileges v Supabase nechavame beze zmeny — tabulky zakladane
-- migracemi pod draft_ingest zadne anon granty nedostavaji (overeno na 0003+).
