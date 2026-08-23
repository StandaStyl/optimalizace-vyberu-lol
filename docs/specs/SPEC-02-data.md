# SPEC-02 Data, Riot key, soukromí

**Stav:** potvrzeno 2026-08-23

## Rozhodnutí
- **Postupně.** Fáze A: **1 patch (16.16), EUNE + EUW, Ranked Solo/Duo (420), cíl ~50 000 her.** Rozšíření (více patchů, regionů) až po vyhodnocení fáze A.
- **Production key: žádost podat nyní** (paralelně s dev key). Podmínky: popis produktu, funkční UI, Riot Developer Policies (jen čtení, disclaimer, žádný prodej dat, mazání na žádost).
- **Profily hráčů veřejné podle Riot ID** (`jméno#tag` → puuid přes Account-V1). Důsledek: ukládáme Riot ID → povinná funkce **„smazat moje data“**, zásady ochrany, disclaimer „not endorsed by Riot Games“.
- Historie hráče v demu **z naší DB**; živé dotahování z Riot API až s production key (nesoupeří s crawlerem).
- Stará kopie repa na C: se smaže po expiraci dnešního dev klíče; kanonické repo je v OneDrive (D:).

## Uložená data
- Zápas: id, platforma, patch, fronta, čas, délka, vítěz.
- Účastník: puuid, tým, šampion, pozice, výhra, KDA, itemy, runy, dmg, tier_band.
- Seed hráč: puuid, platforma, tier/divize. Riot ID jen pro hráče, kteří se vyhledají v UI (samostatná tabulka, mazatelná).

## Historie
- 2026-08-23 vytvořeno.
