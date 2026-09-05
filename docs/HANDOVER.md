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

2. **Stav všeho** — jeden příkaz místo ručního proklikávání:
   ```bash
   npm run status
   ```
   Ověří API, oba procesy na pozadí, platnost Riot klíče, velikost DB a jak stará jsou data.
   Procesy na pozadí už dvakrát umřely tiše (prázdný `data/*.err`), takže ticho v logu
   není důkaz, že běží.

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
| Pásma zápasů | `... cli.ts bands` (po každém větším crawlu) |
| Spárování logů s výsledky | `npm run resolve-logs` |
| Konektor herního klienta | `npm run lcu` (čte champ select, jen zobrazuje) |
| **Kontrola, že vše běží** | **`npm run status`** — API, oba procesy, Riot klíč, velikost DB, stáří dat |
| Uvolnění místa v DB | `... cli.ts prune [--keep-patches N]` (zkušebně) · `--yes` (opravdu smaže) |
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
2. **VYŘEŠENO 26. 8.: winner's curse** — korigováno EB shrinkage přes kandidáty (`ebShrink`
   ve `stats.ts`, napojení ve `scoreDraft`; šum = výběrový rozptyl odhadu `n·m(1−m)/(N₀+n)²`,
   NE šířka posterioru — viz PONAUCENI 26. 8., první verze s šířkou posterioru zkolabovala
   žebříček). Replay, rank-1 predikce vs realita: bez korekce +8,0 p.b. (default priory)
   resp. +3,0 (grid), s korekcí +1,8 resp. +1,4 p.b. — v mezích šumu (n=114/238). Kalibrace
   P(chosen): ECE 0,0017, logloss 0,69288 — poprvé pod const. Replay nově umí
   `--priors S,M,Y,H`. Pozor: korekce část žebříčku legitimně zplošťuje (chosen padá častěji
   do ranku 26+); lift třídy 1 je +0,8 až +1,5 p.b.
3. **Budoucí členy nejsou v MC intervalu** — jsou to zatím deterministická očekávání.
4. **VYŘEŠENO 26. 8.: synergický člen dominoval kvůli špatné baseline.** Podezření se potvrdilo:
   `sigmoid((logit sA + logit sB)/2)` byl poloviční součet, nekonzistentní se zbytkem modelu
   (síla `Σ logit s`, matchup `logit sA − logit sB`) — každá dvojice nasávala ~½ součtu sil,
   součet přes 10 dvojic znovu počítal ~2× sílu týmu. Ověřeno regresí na datech (směrnice
   1.11 ± 0.05, H0=0.5 vyloučena), opraveno na plný součet v `team.ts` + `score.ts` (2×).
   Holdout: logloss full s gridem 0.69547 → 0.69434, AUC 0.5204 → 0.5220, ztráta na const
   poloviční (0.0023 → 0.0012). Detail v PONAUCENI (26. 8.). **Full model zatím const
   nepřekonává** — optimum priorů stále na okraji gridu (S=M=1000); další krok je víc dat
   (test měl jen 1 469 her) a případně rozšířit rozsah gridu.
5. **Tierová pásma: rozhodnout, co použít v modelu.** Vyhledáním přes League-V4 má pásmo jen
   ~2 000 hráčů (5 % účastníků), takže pásmové modely stály skoro na ničem. Migrace 0008 přidala
   `match.tier_band` odvozené většinou ze známých účastníků — pokrytí vzrostlo na ~45 % zápasů
   (low 3 008, mid 4 764, high 2 014). Opora: kde byli známí aspoň dva hráči, pásma se shodla
   v 93 % (113 zápasů, 8 konfliktů). **Agregáty to zatím nepoužívají** — přepnutí `agg_*` z
   `participant.tier_band` na `match.tier_band` je modelové rozhodnutí → Fable 5. Bez toho
   nelze testovat H3.
6. Hosting — artefakty hotové (`Dockerfile`, `fly.toml`, [`docs/deploy.md`](deploy.md)); zbývá
   samotné nasazení, které potřebuje účet na Fly a production Riot key.
7. H5 (trojice) — netestováno.
8. LCU konektor je napsaný a otestovaný jednotkově, ale **nikdy neběžel proti živému klientu** —
   při prvním ostrém spuštění ověřit, že `assignedPosition`, `actions` a `bans` mají očekávaný tvar.

## 6. Pasti, které už stály čas

Detailně v [`PONAUCENI.md`](../PONAUCENI.md). Nejdůležitější:
- **Nikdy nepřesouvat `node_modules`** — `Move-Item` jde přes workspace odkazy `@da/*` a maže zdrojáky.
- **Repo nikdy do OneDrive.**
- PID soubory psát `[IO.File]::WriteAllText` (bez BOM).
- Stav dlouhoběžícího jobu číst z DB, ne z logu (buffering).
- V routeru konkrétní cesty před prefixové.
- Změny schématu jen migracemi v repu (vlastníkem objektů je `draft_ingest`).
- Delší úpravy souborů psát jako `.cjs` skript, ne inline `node -e` z Bashe.

## 5b. Stav 5. 9. 2026 (SPEC-07 a otevřené body)

Přečti nejdřív [`docs/specs/SPEC-07`](specs/SPEC-07-rozhodovaci-pravidlo-a-pilot.md) — je tam celý
rozbor otázky „proč je všechno kolem 50 %" i s čísly.

**Změněno (commit 8fb0e2e):**
- Model: `rankBy: "lower"` (řazení podle 10. percentilu posterioru), `selectionCorrection: false`
  (EB v2 jen jako přepínač pro replay), `pilotExpGames: 10` (síla ve stratu uživatele; migrace 0010,
  tabulka `mat_champ_pos_pilot`, pooled mezera +4,5 p.b. jako hierarchický prior).
- API `/api/score`: `top` až 200 (dřív strop 60 skrýval dno žebříčku), nově `fieldMean`, `rankedBy`,
  `personalised`; příspěvek síly nese `stratum`.
- UI: hlavní číslo = Δ vs. průměr pozice, varování u < 100 her, ★ u zkušeného pilota, hláška
  „bez Riot ID = jen populační průměr".
- Replay: přepínače `--rank lower|mean`, `--eb`, `--pilot N`, `--priors S,M,Y,H`.

**Změřeno (replay 500 her, patch 16.16):**
- Řazení podle spodní meze: rank 1 volí hráči v 3,6 % picků (dřív 0,6 %) — špička je relevantní.
- Kalibrace celkem dobrá (ECE 0,0096 s H = 100; rank 26+: predikce 48,1 = realita 48,1 %).
- **Otevřený bod D: rank 1 je nadhodnocený o ~6 p.b.** (predikce 56,9 %, realita ~50,5 %, n ≈ 180).
  Není to hráčský člen (H = 30 → 100 beze změny). Je to selekce maxima z ~100 kandidátů nad součtem
  ~13 situačních členů (matchupy + synergie) — každý sám kalibrovaný, jejich maximum ne. Návrh:
  **empirický „selekční diskont" po rank-bucketech z replay** zobrazený v UI jako informace
  („historicky rank 1 dodal X % při predikci Y %"), ne zásah do modelu. Čeká na potvrzení.
- Pilot (C) zatím jen v šumu (rank 1: 48,9 → 52,9 %, n 180/170; lift 0 → +1,6 p.b.), směr správný.

**Data:** patch **16.17** vyšel ~3. 9.; crawler už má 2 398 her z 16.17. API bere patch s nejvíc hrami
(zatím 16.16). **Blend priorů mezi patchi (plán §9.2 `patch_blend_days`) není implementován** — až
16.17 převáží, model bude několik dní pracovat s málo daty. DB 255 MB / 500 MB; `prune --yes` smaže
16.15 (1 815 her).

**Návrh SPEC-08 (atributové vztahy, čeká na potvrzení):** atributy melee/ranged (Data Dragon
`attackrange`), tagy, tankovitost (přijaté poškození) a AD/AP podíl (vlastní data); atributové
matchupy jako hierarchický prior šampionských (řeší hlad po datech u counterů) a pro očekávané budoucí
picky. Sonda 5. 9.: asasíni vs. počet tanků v nepřátelském týmu 51,8 → 48,2 % (n 9 000 → 7 750),
Talon 57,6 → 43,5 %, Vayne 47,8 → 51,6 %; proti 5 ranged 58,6 % (n 1 245). Heimerdinger vs. melee
se **nepotvrdil** (na lajně 49,9 vs. 50,0 %; proti melee-heavy týmu 39 %, n 112). Hypotéza H6.
