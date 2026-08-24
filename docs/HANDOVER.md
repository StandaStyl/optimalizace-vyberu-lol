# HANDOVER — jak projekt spustit a kde jsme

Pro kohokoli (člověka i model), kdo na projektu pokračuje. Čti v tomto pořadí:
1. tento soubor, 2. [`PONAUCENI.md`](../PONAUCENI.md) v kořeni repa a `~/.claude/PONAUCENI.md`,
3. [`docs/specs/`](specs/README.md) — SPEC-01 až SPEC-06 jsou závazná rozhodnutí.

---

## 0. Pravidlo pro jazykový model

**Session může běžet na Fable 5 nebo na Opus 5** (přepíná se `/model`). Opus 5 je slabší tier;
mechanickou práci (UI, endpointy, migrace, spouštění jobů, commity) zvládá bez rozdílu.

**Když běžíš na Opus 5 a máš pochybnost o správnosti výstupu, úlohu nedělej.**
Napiš, o co jde, proč si nejsi jistý, a nech ji na Fable 5. Týká se to hlavně:
- interpretace výsledků evaluace (log-loss, kalibrace, lift — snadno se přečtou obráceně),
- návrhu statistických úprav modelu (korekce winner's curse, priory, H5),
- hledání příčiny, proč varianta modelu prohrává s baseline,
- čehokoli, kde by chyba vypadala jako rozumné číslo.

Lepší je úloha odložená než tiše špatný výsledek — celý projekt stojí na tom,
že publikovaná čísla platí.

---

## 1. Co to je

Doporučovač šampionů pro champion select v League of Legends, postavený na Riot API.
Navazuje na diplomovou práci (Musil, UP Olomouc 2017) a přestavuje ji na pravděpodobnostní
základ: kalibrovaná nejistota, personalizace na hráče, pravděpodobnostní odhad pozic soupeřů,
odhad po tierových pásmech, veřejná evaluace.

Rozsah fáze A: **patch 16.16, EUNE + EUW, Ranked Solo/Duo (queue 420)**.

## 2. Kde co je

```
C:\Users\zaluz\Projekty\draft-advisor      JEDINÁ kopie repa (nikdy ne v OneDrive!)
  packages/core     typy, Riot klient (rate limit), Data Dragon, DB pool, migrátor
  apps/ingest       crawler, seed z ladderu, tiers, Data Dragon sync, CLI
  apps/model        posteriory, skóre, inference pozic, evaluace, replay, stránka šampiona
  apps/api          HTTP API (node:http) + servíruje apps/web/public
  apps/web/public   statické UI (draft, hráč, šampion, model) — bez build kroku
  infra/migrations  SQL, aplikuje `npm run db:migrate` v lexikálním pořadí
  docs/specs        závazná rozhodnutí SPEC-01..06
  data/             logy a PID běžících procesů (v .gitignore)
```

GitHub: <https://github.com/StandaStyl/optimalizace-vyberu-lol> (větev `main`)
Supabase: projekt `draft-advisor`, id `bxxmnpbbqpboiblcqiyk`, eu-central-1, free tier.
DB role: **`draft_ingest`** (ne `postgres` — to heslo přes pooler nefunguje),
heslo v `.env` jako `DB_PASSWORD`, `config.ts` ho vloží URL-enkódované.

## 3. Denní start

```bash
cd C:\Users\zaluz\Projekty\draft-advisor
```

1. **Riot klíč** — dev key expiruje po 24 h. Nový na <https://developer.riotgames.com>,
   vložit do `.env` jako `RIOT_API_KEY`. Ověření:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "X-Riot-Token: $(grep '^RIOT_API_KEY=' .env | cut -d= -f2-)" https://eun1.api.riotgames.com/lol/status/v4/platform-data
   ```
   Musí vrátit `200`. (Trvale to řeší production key — žádost je připravená
   v [`riot-production-key.md`](riot-production-key.md), odeslat až bude demo na veřejné URL.)

2. **Stav dat**
   ```bash
   node --experimental-strip-types apps/ingest/src/cli.ts stats
   ```

3. **Crawler a API na pozadí** (PowerShell, PID bez BOM):
   ```powershell
   $r = "C:\Users\zaluz\Projekty\draft-advisor"
   $c = Start-Process node -ArgumentList "--experimental-strip-types","apps/ingest/src/cli.ts","crawl" -WorkingDirectory $r -WindowStyle Hidden -RedirectStandardOutput "$r\data\crawl.log" -RedirectStandardError "$r\data\crawl.err" -PassThru
   [IO.File]::WriteAllText("$r\data\crawl.pid", "$($c.Id)")
   $a = Start-Process node -ArgumentList "--experimental-strip-types","apps/api/src/index.ts" -WorkingDirectory $r -WindowStyle Hidden -RedirectStandardOutput "$r\data\api.log" -RedirectStandardError "$r\data\api.err" -PassThru
   [IO.File]::WriteAllText("$r\data\api.pid", "$($a.Id)")
   ```
   Zastavení: `Stop-Process -Id (Get-Content data\crawl.pid) -Force`
   Kontrola z Bashe: `tasklist //FO CSV | grep -c "\"node.exe\",\"$(cat data/crawl.pid)\""`

   Web běží na <http://localhost:8787>.

## 4. Příkazy

| Co | Příkaz |
|---|---|
| Migrace DB | `npm run db:migrate` |
| Šampioni z Data Dragon | `npm run ddragon:sync` |
| Seed hráčů z ladderu | `node --experimental-strip-types apps/ingest/src/cli.ts seed --pages 1` |
| Crawl (popředí) | `node --experimental-strip-types apps/ingest/src/cli.ts crawl [--max N]` |
| Dohledání tierů | `... cli.ts tiers --limit 200` — **nikdy souběžně s crawlem** (sdílený rate limit) |
| Stav DB | `... cli.ts stats` |
| Přepočet agregátů | `npm run model:refresh` (denně; API je čte z `mat_*`) |
| Doporučení z CLI | `npm run model:score -- --pos BOTTOM --enemies 51,412 --allies 40:UTILITY` |
| Holdout evaluace | `npm run model:eval -- --cutoff-days 3 [--grid] [--persist]` |
| Kontrola reality | `npm run model:replay -- --cutoff-days 2 [--games N] [--persist]` |
| Testy / typy / lint | `npx vitest run` · `npx tsc -b` · `npx eslint .` |

API: `GET /api/champions`, `GET /api/champion/:id?band=`, `GET /api/profile?riotId=Jméno%23TAG`,
`POST /api/score`, `POST /api/winprob`, `GET /api/player/:puuid`, `POST /api/player/delete`,
`GET /api/model/eval`, `GET /api/model/replay`, `GET /api/health`.

## 5. Stav (24. 8. 2026)

Hotovo: fáze 0–4 + SPEC-06.
- Crawl běží, patch 16.16, řádově 18 k+ zápasů (aktuální číslo dá `stats`), bany se ukládají od 23. 8.
- Model: síla × pozice, matchupy pro všech 25 kombinací pozic, synergie, hráčský člen,
  očekávané budoucí picky (s vyloučením banů), hrozby, doporučení banů, intervaly, třídy indiference.
- Web: draft simulátor, profil hráče podle Riot ID, stránka šampiona, stránka modelu, privacy + mazání dat.
- Evaluace: holdout s baselinami (const / strength / pairwise / full), grid-search priorů,
  retrospektivní replay draftů. **Zatím jen na malých datech — čísla nejsou průkazná.**

Známé mezery / co dál:
1. **Ostrá validace** — spustit `model:eval --grid --persist` a `model:replay --persist`,
   až bude ≥ 20 k her na patchi. Do té doby nevykládat lift ani AUC.
2. **Winner's curse** — replay ukázal, že u top-1 doporučení model predikuje ~55 %, realita ~52 %.
   Potřebuje korekci (návrh: shrinkage přes kandidáty). Statistická úloha → **jen na Fable 5**.
3. **Budoucí členy nejsou v MC intervalu** — jsou to zatím deterministická očekávání.
4. Winprob celého draftu v UI, hosting (VPS/Fly), Node LCU konektor — v tomto pořadí (SPEC-04).
5. H5 (trojice) — netestováno.

## 6. Pasti, které už stály čas

Detailně v [`PONAUCENI.md`](../PONAUCENI.md). Nejdůležitější:
- **Nikdy nepřesouvat `node_modules`** — `Move-Item` jde přes workspace odkazy `@da/*` a maže zdrojáky.
- **Repo nikdy do OneDrive.**
- PID soubory psát `[IO.File]::WriteAllText` (bez BOM).
- Stav dlouhoběžícího jobu číst z DB, ne z logu (buffering).
- V routeru konkrétní cesty před prefixové.
- Změny schématu jen migracemi v repu (vlastníkem objektů je `draft_ingest`).
- Delší úpravy souborů psát jako `.cjs` skript, ne inline `node -e` z Bashe.
