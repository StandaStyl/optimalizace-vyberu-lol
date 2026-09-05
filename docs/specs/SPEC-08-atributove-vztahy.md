# SPEC-08 — Atributové vztahy šampionů (H6) a kontrola reality v UI (SPEC-07 D)

**Stav:** implementováno 5. 9. 2026; atributový prior **vypnut jako výchozí** po validaci (níže),
zůstává jako přepínač; atributy, agregát a sondy hypotéz jsou v provozu. Bod D hotov.

## Otázka
*„Heimerdinger by měl mít lepší WR proti melee a horší proti ranged; Poppy proti šampionům
s odskokem, Vayne proti tankům, tanky proti asasínům. Dají se tato data dohledat a využít?"*
Motivace v modelu: hlad po datech u counterů — z 125 652 matchup buněk má ≥ 300 her jen 26.
Buňka „Vayne proti odolným soupeřům" má her stokrát víc než „Vayne proti Ornnovi".

## Zdroj atributů (žádný kurátorský seznam)
Původní návrh počítal s ručně udržovaným seznamem mobility. Nahrazen veřejným strojově čitelným
zdrojem — **LoL wiki**, tři stránky, stahuje `ingest attrs` (`packages/core/src/wiki/client.ts`):

| dim | hodnoty | zdroj |
|---|---|---|
| `range` | melee / ranged | `Module:ChampionData/data` (`rangetype`; Gnar/Jayce ranged, Rakan/Nilah/Lillia melee) |
| `mobility` | **dash / blink / none** | stránky *Dash* (98 šampionů) a *Blink* (12) — seznam abilit podle mechaniky |
| `class` | assassin / fighter / mage / marksman / support / tank | Riot tag (`herotype`) |
| `toughness`, `mobility_rating` | 1 / 2 / 3 | Riotova hodnocení z výběru šampionů |
| `dmgtype` | physical / magic | `adaptivetype` |
| `subclass` | 13 tříd wiki (juggernaut, diver, burst, …) | `role` — uloženo, v modelu nepoužito |

Rozlišení dash/blink je podstatné: Poppy W zastaví jen dash (wiki: sekce *Dash cancels* uvádí
pouze Poppy; stránka *Blink* žádnou interakci nemá). Ezreal E, Kassadin R, Katarina E, Shaco Q,
Zed W, Twisted Fate R jsou blink — proti Poppy se chovají jako Flash. Model tuto interakci
**nezakóduje jako pravidlo**; jen měří Poppy proti skupině `dash` zvlášť.

Atributy jsou *definice vlastnosti*, ne úsudek o tom, co je proti čemu dobré (SPEC-04 „žádná
ruční pravidla" platí). Tabulka `champion_attr(champion_id, dim, value, source)` — migrace 0011;
173/173 šampionů (Nami a Sona chyběly kvůli formátu konce záznamu na wiki, parser dělí podle
začátků záznamů). Alias formy (Mega Gnar id 150.2, Kled & Skaarl 240.1) se skládají na základní id.

## Agregát
`mat_champ_vs_attr(patch, platform, tier_band, champ_a, pos_a, pos_b, dim, value, games, wins_a,
exp_wins_a)` — pro šampiona A na pozici a proti soupeřům na pozici b s atributem dim=value: hry,
výhry A a **součet očekávání z nezávislosti sil** (stejný baseline jako matchup člen), aby byla
odchylka čitelná proti tomu, co predikují samotné síly. Počítá se z `mat_matchup` (očekávání je
v buňce konstantní; migrace 0012), baseline sil je materializovaná tabulka `mat_champ_wr` s klíčem
(migrace 0013 — CTE dávalo kartézský součin a refresh padal na timeout). Refresh 77 s (dřív 32).

Pokrytí (patch 16.16, 5 modelových dimenzí): buňky s ≥ 100 / 300 / 1 000 her: **10 886 / 5 560 /
1 147** — proti matchup buňkám 1 132 / 26 / 0.

## Co říkají data (patch 16.16, dev = WR − očekávání ze sil, p.b.)
| hypotéza | výsledek |
|---|---|
| Heimerdinger vs. melee | +0,2 (n 2 012) vs. ranged +1,4 (n 1 878) — **nepodpořeno** |
| Poppy vs. dash | +0,3 (n 1 454); vs. none −1,9 (n 996); vs. blink +4,1 (n 180) — **nepodpořeno** |
| Vayne vs. odolnost 3 | −1,4 (n 1 542); vs. 1: −0,5 — **opačný směr** |
| Kha'Zix vs. odolnost 3 | **−4,4** (n 765); vs. 1: +1,0 — podpořeno |
| Talon / Zed vs. odolnost 3 | −1,9 (n 874) / −0,1 (n 2 038) — slabé |
| asasíni (třída) vs. odolnost 3 | **−1,5** (n 15 777); vs. 1: −0,4 (n 69 294) — malý, ale reálný |
| dostřel × dostřel na lajně | 0,0 až ±0,2 (n 34–85 tis.) — nic |
| ostatní třídy vs. odolnost | −0,6 … +0,5 — šum |

Závěr: atributové efekty existují jen na úrovni *třídy* a jsou malé (≈ 1–2 p.b.); jednotlivé
šampionské buňky (stovky her) jsou šum. Konkrétní lidové hypotézy se v datech neukázaly.

## Model (implementováno, přepínač `attrWeight`)
Hierarchický prior matchup buňky (`attrPrior`, `matchupTerm` v `score.ts`; `teamLogit`):
1. **třída A vs. atribut B** — kontrast třídy proti jejímu pooled záznamu přes všechny hodnoty
   dimenze (desítky tisíc her; prior `priorNAttrGroup` 2 000);
2. **šampion A vs. atribut B** — reziduum nad třídou, silně shrunk (`priorNAttr` 2 000);
3. **konkrétní buňka A vs. B** — dosavadní posterior s priorem 300, jehož střed je posunut o (1 + 2).
Symetricky (co ví A o druhu B, minus co ví B o druhu A, děleno 2). Dimenze se sčítají v logitu.
Příspěvek se ukazuje v UI v tooltipu členu („z toho atributy soupeře ±x").

Dvě chyby, které validace odhalila (obě zapsané v PONAUCENI):
- **necentrovaná** odchylka nese celkovou formu šampiona proti shrunk síle — stejnou pro každou
  dimenzi a pozici, sečtenou 5 × 25 krát: holdout log-loss 0,7576, ECE 0,139;
- **syrová forma** z pooled buňky se 2 hrami / 2 výhrami = logit(1) = +13,8 → jeden pár −9 logit:
  log-loss 0,798. Forma musí být shrunk stejným priorem.

## Validace (holdout, patch 16.16, 20 479 trénink / 2 654 test her, cutoff 3 dny)
| varianta | log-loss | AUC | ECE |
|---|---|---|---|
| jen síla | **0,69146** | 0,5364 | **0,0171** |
| plný model bez atributů (M 300, Y 150) | 0,70134 | 0,5354 | 0,0558 |
| atributy, váha 0,25 | 0,70250 | 0,5408 | 0,0604 |
| atributy, váha 0,5 | 0,70524 | 0,5443 | 0,0653 |
| atributy, váha 1 | 0,71527 | 0,5478 | 0,0846 |
| atributy 0,5, jen class + toughness | 0,70200 | 0,5405 | 0,0615 |

Atributy monotónně **zvyšují AUC** (0,535 → 0,548 — pořadí nese informaci) a monotónně
**zhoršují log-loss i ECE** (jako pravděpodobnost jsou přehnaně sebejisté). Korektnost výstupu
je první priorita (SPEC-01), proto **`attrWeight: 0`** jako výchozí; přepínač `--attr W` v replay.

**Vedlejší zjištění (větší než SPEC-08):** ani samotná párová vrstva na tomto objemu dat
neporazí sílu — grid M ∈ {300…30 000} × Y ∈ {150…15 000}: nejlepší M = 3 000, Y = 1 500 dává
0,69223 / AUC 0,5392 / ECE 0,028; hlavní škoda je slabý prior synergie Y = 150 (→ 1 500 zlepší
log-loss o 0,009). Priory M/Y byly nastaveny gridem na ~5 tis. hrách; s 20 tis. hrami shrinkage
slábne a šum 25 + 10 párů se sčítá. **Rozhodnutí o změně priorů čeká na potvrzení** (mění i
měření SPEC-07); replay s M = 3 000 / Y = 1 500 je v `data/replay-spec08.txt`.

## Návrh dalšího kroku (SPEC-09, k potvrzení)
Jedna **kalibrační vrstva** nad součtem logitů (globální teplota / Plattův posun fitovaný na
holdoutu, uložený v `model_run`): řeší přehnanou sebejistotu párové vrstvy i atributů naráz a
umožní atributy zapnout pro pořadí, aniž by rozbily pravděpodobnost. Alternativa: atributy použít
jen v pořadí (rankBy) a ne v p — to by ale rozešlo pořadí a zobrazené číslo, což SPEC-07 zakazuje.

## SPEC-07 D — kontrola reality v UI (hotovo)
`/api/score` vrací `reality` = tabulka realizovaná WR podle pořadí v našem žebříčku z posledního
uloženého replay běhu, **jehož parametry odpovídají běžícím výchozím** (rankBy, EB, pilot,
attrWeight, H); UI ji ukazuje nad tabulkou: „rank 1: predikce X % → realita Y % (n)". Selekce
maxima se nezakrývá, ukazuje se. Replay běh se ukládá `model:replay -- --games 500 --persist`.

## Co by bylo nepoctivé (a nedělá se)
- Zapnout atributy kvůli AUC, když log-loss a ECE říkají, že pravděpodobnost je horší.
- Vzít interakce z wiki („Poppy ruší dashe") jako pravidlo do skóre místo jako hypotézu k měření.
- Kurátorský seznam z hlavy, když existuje veřejný dohledatelný zdroj.
