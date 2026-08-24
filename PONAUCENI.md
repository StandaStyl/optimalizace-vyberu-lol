# PONAUCENI.md (draft-advisor) — projektová poučení

> Pravidlo Jana: každá chyba, ze které plyne poučení, se zapíše — co se stalo, proč,
> jak se řeší. Nejnovější nahoru, zápisy se nemažou. Obecná poučení (shell, Windows,
> OneDrive, Git) patří do `~/.claude/PONAUCENI.md`.

## 24. 8. 2026 — Rozdělené vlastnictví tabulek: migrace přes MCP vs. přes aplikaci

**Co se stalo:** tabulky z migrací 0001 a 0002 vznikly přes Supabase MCP (vlastník `postgres`),
tabulky z 0003+ přes `npm run db:migrate` (vlastník `draft_ingest`). Migrace 0008 chtěla
`alter table match add column ...` a spadla na „must be owner of table match". Oprava přes MCP
zase spadla na „must be able to SET ROLE draft_ingest" — role `postgres` nebyla členem
`draft_ingest`, a `ALTER ... OWNER TO` členství vyžaduje.

**Řešení:** jednorázově `grant draft_ingest to current_user;` a pak `alter table ... owner to
draft_ingest;` pro všechny tabulky, typy i sekvence; od té chvíle vlastní schéma jediná role.
Pravidlo do budoucna: **schéma měnit jen jednou cestou** — migrací v repu. MCP používat na čtení
a nanejvýš na bootstrap, než funguje lokální připojení; pokud se přes MCP přece jen něco vytvoří,
hned předat vlastnictví aplikační roli.


## 24. 8. 2026 — `Move-Item node_modules` prošel přes workspace odkazy a SMAZAL ZDROJÁKY

**Co se stalo:** při přesunu `node_modules` mimo OneDrive (kvůli synchronizaci)
`Move-Item` narazil na npm workspace odkazy `node_modules/@da/*` → `apps/*`,
následoval je a začal mazat obsah `apps/api/src`, `apps/ingest/src`,
`packages/core/src`. Zachránil to jen `git checkout -- .` (36 souborů z posledního
commitu). Necommitnutá práce by byla nenávratně pryč.

**Řešení:** `node_modules` v monorepu **nikdy nepřesouvat** — vždy `rm -rf node_modules`
a `npm install` na novém místě. Před jakoukoli operací nad `node_modules` mít vše
commitnuté. Symlinky/junctiony v monorepu jsou vždy podezřelé.

## 24. 8. 2026 — `npm ci` spuštěné bez zdrojáků nevytvoří workspace odkazy

**Co se stalo:** po předchozím incidentu jsem spustil `npm ci`, ale zdrojáky ještě
chyběly (obnovil jsem je až potom). npm workspaces nenašel balíčky `@da/*`,
odkazy nevytvořil a `tsc` hlásil „Cannot find module '@da/core'".

**Řešení:** po obnovení zdrojáků spustit `npm install` znovu; kontrola je
`ls node_modules/@da/` — musí obsahovat `api core ingest model`.

## 24. 8. 2026 — PID soubor z PowerShell `Out-File` má BOM → detekce procesu selhává

**Co se stalo:** `$p.Id | Out-File data\crawl.pid` zapsal UTF-8 BOM; z Bashe pak
`cat data/crawl.pid` vrátilo `﻿1240` a `tasklist /FI "PID eq ..."` hlásil „Prohledávací
filtr nelze rozpoznat". Monitor falešně hlásil „CRAWLER EXITED", i když crawler běžel.

**Řešení:** psát `[IO.File]::WriteAllText("$repo\data\crawl.pid", "$($p.Id)")` (bez BOM).
Kontrola procesu z Bashe: `tasklist //FO CSV | grep -c "\"node.exe\",\"$pid\""`
(dvojité lomítko kvůli MSYS převodu cest).

## 24. 8. 2026 — Odpojený proces + přesměrování logu = log zaostává za skutečností

**Co se stalo:** crawler spuštěný přes `Start-Process -RedirectStandardOutput` bufferoval
výstup; log ukazoval „stored 48", zatímco v DB už bylo o stovky zápasů víc.
Diagnóza „proces se zasekl" byla mylná.

**Řešení:** stav dlouhoběžícího jobu ověřovat **v DB** (`cli.ts stats`), ne v logu.
Monitor postavit na dotazu do DB, ne na `tail` logu.

## 24. 8. 2026 — Pořadí rout: `/api/player/delete` stíněné prefixem `/api/player/:puuid`

**Co se stalo:** endpoint pro mazání dat byl v `server.ts` až za obecnou routou
`url.pathname.startsWith("/api/player/")`, takže POST na `/api/player/delete`
skončil jako „profil hráče s puuid = delete".

**Řešení:** v ručně psaném routeru dávat **konkrétní cesty před prefixové**.
Při přidání endpointu pod existující prefix vždy ověřit `curl`em.

## 24. 8. 2026 — `gen_random_bytes` v Supabase není v `public` (pgcrypto)

**Co se stalo:** funkce `anonymise_player()` používala `gen_random_bytes(16)`;
Supabase má pgcrypto ve schématu `extensions`, takže volání skončilo
„function gen_random_bytes(integer) does not exist".

**Řešení:** použít vestavěné `gen_random_uuid()` (`replace(gen_random_uuid()::text,'-','')`),
nebo `extensions.gen_random_bytes(...)`. Obecně: v migracích nespoléhat na rozšíření
bez explicitního schématu.

## 24. 8. 2026 — Funkci vytvořenou rolí `draft_ingest` nelze změnit přes Supabase MCP

**Co se stalo:** `create or replace function anonymise_player` přes MCP selhalo na
„must be owner of function" — funkci vlastní `draft_ingest` (aplikační role), MCP jede
pod jinou rolí.

**Řešení:** všechny změny schématu dělat **jednou cestou** — migrací v repu
(`npm run db:migrate` pod `draft_ingest`). MCP používat jen pro čtení a pro první
bootstrap, než funguje lokální připojení.

## 24. 8. 2026 — Postgres: čísla parametrů musí být souvislá

**Co se stalo:** dotaz na historii hráčů dostal `[platforms, cutoff]`, ale v SQL byly
`$2` a `$3` (zkopírováno z jiného dotazu, kde `$1` byl patch). Postgres vrátil
„could not determine data type of parameter $1".

**Řešení:** při kopírování dotazů přečíslovat parametry od `$1`; chybová hláška
„could not determine data type of parameter $N" znamená, že `$N` v SQL chybí.

## 24. 8. 2026 — Heslo role `postgres` v Supabase přes pooler nefungovalo

**Co se stalo:** i po dvou resetech hesla vracel pooler
„password authentication failed for user postgres" (transakční 6543 i session 5432);
přímý host `db.<ref>.supabase.co` u nového projektu v DNS neexistuje.

**Řešení:** vytvořena servisní role `draft_ingest` s právy jen na `public`
(heslo v `.env` jako `DB_PASSWORD`, `config.ts` ho vloží URL-enkódované do
`DATABASE_URL`). Aplikace navíc nemá běžet pod superuserem — je to i bezpečnější.

## 24. 8. 2026 — TypeScript: `erasableSyntaxOnly` + project references

**Co se stalo:** dvě zaseknutí v řadě — (1) parameter properties
(`constructor(private x: T)`) nejsou povolené, když se běží přes
`node --experimental-strip-types`; (2) `tsc -b` hlásil TS6305
„Output file has not been built from source file", protože reference mezi projekty
potřebují `.d.ts`, ale s `noEmit` žádné nevznikaly.

**Řešení:** psát explicitní fieldy v konstruktoru; v `tsconfig.base.json` mít
`"emitDeclarationOnly": true` (JS se stejně negeneruje, běží se ze zdrojáků).
Po změně `tsconfig` smazat `dist/` a `*.tsbuildinfo` a přebuildovat.

## 24. 8. 2026 — Riot dev key: 24 h a sdílený rate limit

**Co se stalo:** klíč mezi sessions expiroval (401), a job `tiers` spuštěný souběžně
s crawlem si s ním konkuroval o limit 100 req/2 min.

**Řešení:** klíč regenerovat na začátku každého dne práce
(kontrola: `curl -H "X-Riot-Token: $KEY" .../lol/status/v4/platform-data` → 200).
Jobs, které sdílí klíč, spouštět **sériově**. Trvale to řeší production key
(žádost připravená v `docs/riot-production-key.md`).

## 24. 8. 2026 — Bash heredoc s apostrofy v českém textu

**Co se stalo:** patch skripty psané jako `node -e '...'` z Bashe opakovaně padaly na
„unexpected EOF while looking for matching `''", protože obsahovaly apostrof;
jednou se skript provedl jen zpola a nechal soubor v nekonzistentním stavu.

**Řešení:** delší úpravy souborů psát jako `.cjs` soubor přes Write a spustit
`node patch.cjs`, ne inline. Patch skript má mít funkci `rep(a, b)`, která **selže**,
když kotva není nalezena — jinak tiše neudělá nic.
