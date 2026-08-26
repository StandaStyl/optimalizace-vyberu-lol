# PONAUCENI.md (draft-advisor) — projektová poučení

> Pravidlo Jana: každá chyba, ze které plyne poučení, se zapíše — co se stalo, proč,
> jak se řeší. Nejnovější nahoru, zápisy se nemažou. Obecná poučení (shell, Windows,
> OneDrive, Git) patří do `~/.claude/PONAUCENI.md`.

## 26. 8. 2026 — EB korekce winner's curse: šum je výběrový rozptyl odhadu, ne šířka posterioru

**Co se stalo:** první verze korekce (shrinkage kandidátů k průměru pole) použila jako šumový
rozptyl šířku posterioru z MC vzorků. To je epistemická nejistota — u odhadů už jednou sražených
priory je mnohem větší než skutečná výběrová chyba, takže metoda momentů vyhodnotila veškerý
rozptyl mezi kandidáty jako šum (τ²→0) a žebříček zkolaboval: všichni kandidáti ~50,0 %, jedna
obří třída indiference, rank-1 jen 69 z 14 690 picků. Kalibrace přitom vypadala skvěle — bez
replay matice (priory × korekce) by chyba prošla jako úspěch.

**Řešení:** šum pro EB vrstvu je výběrový rozptyl bodového odhadu: na term
`n·m(1−m)/(N₀+n)²`, delta metodou do logit prostoru (`/(m(1−m))²`), přes termy váhy².
U kandidáta bez dat nula (odhad je deterministicky prior), u silného prioru malý — dvojité
shrinkage tím zmizí. Intervaly se korekcí jen posouvají, nezužují (selekce nesnižuje
epistemickou nejistotu). Výsledek: rank-1 nadhodnocení z +8,0 p.b. na +1,4 až +1,8 p.b.
(v šumu), ECE 0,0017, logloss P(chosen) poprvé pod const. Poučení: **u empirical-Bayes
korekce vždy rozlišit šířku posterioru od výběrové chyby odhadu — a každou „úspěšnou"
kalibraci konfrontovat s tím, co udělala s rozlišovací schopností.**

## 26. 8. 2026 — Synergická baseline s polovičním součtem: člen tiše nasával sílu šampionů

**Co se stalo:** očekávaná winrate dvojice byla `sigmoid((logit sA + logit sB)/2)`, zatímco
zbytek modelu sčítá příspěvky v logit prostoru naplno (síla týmu `Σ logit s`, matchup
`logit sA − logit sB`). Poloviční součet znamenal, že odchylka každé dvojice obsahovala
~½ součtu sil obou šampionů; přes 10 dvojic (každý šampion ve 4) synergický součet znovu
započetl ~2× sílu týmu. Symptomy vypadaly jako rozumná čísla: synergie −10,1 p.b. na
testovacím draftu, ECE 0.079, grid tlačil priory na okraj mřížky (S=M=1000) — grid-search
strukturální zkreslení nespraví, jen ho shrinkage „vypíná". Přesně případ z pravidla §0:
chyba, která vypadá jako rozumné číslo.

**Řešení:** ověřeno na vlastních datech vážené regresí `logit(wr dvojice)` na
`logit sA + logit sB` (s korekcí atenuace — binomický šum v x je známý): směrnice
1.11 ± 0.05 (1 732 párů, champ ≥ 800 her, pár ≥ 40), na přísných prazích 0.86 ± 0.18 —
konzistentní s plným součtem, vyloučeno 0.5. Baseline opravena na
`sigmoid(logit sA + logit sB)` na třech místech (`team.ts`, `score.ts` 2×). Efekt na
holdoutu: logloss full 0.71134 → 0.70645 (default priory), s gridem 0.69547 → 0.69434,
AUC 0.5204 → 0.5220, ECE 0.036 → 0.031; ztráta na const baseline klesla na polovinu
(0.0023 → 0.0012). Poučení: **baseline každého členu musí být konzistentní se strukturou
zbytku modelu — a optimum priorů na okraji gridu je červená vlajka, ne výsledek.**

## 24. 8. 2026 — Odpojené procesy umřely tiše; měření latence ukázalo odmítnuté spojení jako „latenci"

**Co se stalo:** crawler i API spuštěné přes `Start-Process` skončily bez jediného řádku
v chybovém logu. Následné měření `curl -s -o /dev/null -w "%{time_total}s"` vrátilo u všech
endpointů shodných ~2,25 s a já to přečetl jako latenci aplikace — přitom to byl čas, než
curl vzdal spojení s mrtvým serverem. Po restartu vyšla skutečná čísla: health 1–4 ms,
`/api/score` 81–105 ms.

**Řešení:** přidán `npm run status` (`cli.ts status`), který naráz ověří API přes `/api/health`,
existenci obou PID, platnost Riot klíče, velikost DB a stáří posledního zápasu; při jakékoli
chybě končí exit code 1. Pravidlo k měření: **do `curl -w` vždy přidat `%{http_code}`** —
bez něj se selhání tváří jako pomalá odpověď. A po každém delším bloku práce zkontrolovat,
že procesy na pozadí opravdu žijí; ticho v logu není důkaz, že běží.

## 24. 8. 2026 — Expirovaný Riot klíč: crawler tiše skončil s klamnou hláškou

**Co se stalo:** dev klíč expiroval uprostřed běhu. Každý požadavek začal vracet 401, ale
crawler 401 nepovažoval za trvalou chybu — položky se po třech pokusech přesunuly do `failed`,
`enqueueFromSeeds` také jen logoval a vracel 0, až fronta došla a smyčka skončila hláškou
„queue empty and no uncrawled seeds left". V logu tedy nebylo poznat, že šlo o klíč, a chybový
soubor zůstal prázdný. Zjistilo se to až podle toho, že počet zápasů v DB přestal růst.

**Řešení:** `crawl()` a `enqueueFromSeeds()` počítají po sobě jdoucí 401/403 a po pěti vyhodí
`ExpiredKeyError` s návodem („vlož nový klíč do .env"). `worker` na ni skončí s exit code 1,
aby ji hosting nahlásil. Obecné pravidlo: **chyba autentizace není chyba jedné položky** —
selhává jí všechno, takže musí zastavit celý job, ne se schovat do statistiky selhání.

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
