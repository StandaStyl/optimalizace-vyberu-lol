# SPEC-07 Rozhodovací pravidlo, zkušenost pilota a prezentace

**Stav:** potvrzeno 5. 9. 2026 (kroky A, B, C); měření doplňována průběžně

## Proč vznikla

Otázka Jana 5. 9.: *„Doporučení se moc nemění od 50 %. Jako by říkalo, že je jedno, koho vybereme.
Je to chyba, nebo pravda?"* Rozbor na 25 tisících her (patch 16.16) dal čtyři odpovědi:

1. **Většina plochosti je pravda.** Syrová WR šampion×pozice s ≥ 300 hrami: 80 % šampionů leží
   mezi 46,5 a 52,6 %. Riot na to hru vyvažuje. Rozdíl 6 p.b. mezi dvěma kandidáty *je* velké
   doporučení (celý optimální draft kupuje ~8–10 p.b.), jen jako absolutní číslo působí „obojí padesát".
2. **Countery a synergie umírají na hlad po datech.** Z 125 652 matchup buněk má ≥ 100 her jen 1 024,
   ≥ 300 her 22. Diplomka pracovala s 2 000–20 000 hrami na dvojici. S priorem 300 si buňka o 30 hrách
   zachová 9 % odchylky. Není to chyba; je to 1 % potřebného objemu. Řeší SPEC-08 (atributy) a data.
3. **UI skrývalo dno.** API vracelo nejvýš 60 z ~100 kandidátů; Sylas (45,8 %), Locke (45,3 %), Azir
   (44,6 %) nebyly vidět. Odstraněno (A).
4. **Skutečný defekt: winner's curse u malých vzorků.** Tryndamere mid, 71 her, 76 % syrově, rank 1
   nad Luxem s 1 109 hrami. EB korekce v2 (26. 8.) používá rozptyl *zregularizovaného* odhadu, který je
   u šampiona s málo hrami nejmenší — Luxe srazila víc než Tryndamera. Míří na špatný rozptyl přesně
   u případu, kvůli němuž existuje.

## Rozhodnutí

### A. Prezentace
- Hlavní číslo v tabulce = **rozdíl proti průměru pozice v p.b.** (`fieldMean` z API); absolutní P(výhra) vedle.
- Žádný strop na počet vrácených kandidátů (max 200; UI žádá vše) — spodek žebříčku je informace „koho ne".
- Počet her viditelně; < 100 her varovnou barvou. Stratum síly (★ = zkušený pilot) v titulku.
- Hlavička výsledků říká, podle čeho je řazeno, a bez Riot ID varuje: *„jen populační průměr — vaše
  vlastní historie je největší rozdíl"*.

### B. Rozhodovací pravidlo: řadit podle spodní meze intervalu
- `rankBy: "lower"` — pořadí podle 10. percentilu posterioru P(výhra), nikoli podle středu. Bodový odhad
  se zobrazuje dál; mění se jen pořadí. Kandidát se širokým intervalem musí mít o to vyšší střed, aby vedl.
- Je to *rozhodovací pravidlo* (lower confidence bound), ne úprava odhadů — drží pravdu.
- EB korekce v2 zůstává jako přepínač `selectionCorrection`. Původně vypnuta; **po doměření (níže) znovu
  zapnuta jako výchozí** — ne proto, že by správně mířila na rozptyl outliera (to řeší B), ale protože jako
  kalibrační vrstva nad *celým* žebříčkem dává nejlepší měřenou kalibraci. Replay: `--eb` / `--no-eb`.
- Třídy indiference beze změny (překryv intervalů s lídrem).

### C. Zkušenost pilota jako stratum síly
- Změřeno 5. 9. 2026: hráči s ≥ 10 hrami na šampionovi v našich datech vyhrávají **54–58 %**, ostatní
  **49,9 %**; mezera **+4,5 p.b.** (vážený průměr přes buňky, medián 4,7), na všech pozicích
  (jungle 7,9). n = 44 tis. vs. 1–1,5 tis. na pozici.
- **Co se neměřilo:** korelace „podíl specialistů × WR šampiona" = 0,025 ≈ 0. Náš vzorek má ~20 her na
  hráče, takže „zkušených" jsou 3 % řádků u *každého* šampiona; hypotézu „niche pick má nafouknutou WR
  kvůli mains" z našich dat potvrdit nelze a korekce se na ní nestaví.
- Implementace (hierarchická): síla kandidáta se odhaduje **ve stratu uživatele**. Anonymní / nezkušený
  uživatel → posterior „new" buňky (≈ populace). Zkušený uživatel → posterior řídké „exp" buňky s priorem
  centrovaným na `logit(new) + pooled gap` (silou `priorNStrength`) — obecná mezera mluví dřív než
  šampionova vlastní zkušená data. Člen H (vlastní WR) se pak odchyluje od tohoto základu, ne od populace.
- Práh 10 her je v `ModelParams.pilotExpGames` **i** v pohledu `agg_champ_pos_pilot` (migrace 0010).
- Agregát: `mat_champ_pos_pilot(games_exp, wins_exp, games_new, wins_new)`; počet her pilota napříč
  patchi. V evaluaci leak-free (jen hry před cutoffem).

## Měření (replay, 500 her / 5 000 picků, patch 16.16, cutoff 2 dny)

| varianta | rank 1: n / real. WR / predik. | lift třída 1 | ECE | logloss |
|---|---|---|---|---|
| původní (mean + EB v2) | 31 / 41,9 % / 52,9 % | +1,9 p.b. | 0,0132 | 0,69275 |
| B (lower, bez EB) | **180** / 48,9 % / 56,8 % | 0,0 | 0,0117 | 0,69305 |
| B + C (lower, pilot 10) | **170** / 52,9 % / 56,8 % | +1,6 p.b. | 0,0110 | 0,69307 |
| B + C, H = 100 | 182 / 50,5 % / 56,9 % | +1,8 p.b. | 0,0096 | 0,69304 |
| B + C, H = 300 | 190 / 53,7 % / 56,5 % | +3,6 p.b. | 0,0178 | 0,69359 |
| **B + C + EB v2, H = 30** | 157 / 56,1 % / 51,3 % | +3,1 p.b. | **0,0002** | **0,69253** |

Čtení: B zšestinásobilo *relevanci* špičky (hráči skutečně volí model-rank-1 v 3,6 % picků místo 0,6 %) —
špička už není 71herní outlier. Celková kalibrace mírně lepší, log-loss v šumu (rozdíly 0,0003). **Ale
bodový odhad u ranku 1 je nadhodnocený o ~4–8 p.b.** (56,8 % predikováno vs. 49–53 % realita) — EB vrstva
tuhle práci dělala, byť špatným nástrojem.

**Doměřeno 5. 9. (řádky H = 100 / 300 / EB):**
- Hráčský člen **není** příčina nadhodnocení: H = 30 → 100 nechá rank 1 na 56,9 % predikce vs. ~50,5 %
  realita; H = 300 zhorší všechno (ECE 0,0178, log-loss nad konstantním modelem 0,69315).
- Příčina je **selekce maxima**: ~100 kandidátů, každý se součtem ~13 situačních členů (matchupy přes
  25 kombinací pozic + synergie), každý člen sám kalibrovaný, jejich maximum ne. To je přesně to, co
  EB korekce přes kandidáty modeluje — proto **B + C + EB** vychází nejlépe: ECE 0,0002, log-loss
  0,69253 (jediná varianta pod const 0,69315), rank 26+ 49,6 vs. 49,5 %. Rank 1 tam skončí
  *podhodnocený* (realita 56,1 vs. predikce 51,3 %, n = 157 → ±8 p.b., tj. v šumu) — konzervativní
  směr, který je pro doporučení bezpečnější než nadhodnocení.
- **Rozhodnutí:** `selectionCorrection: true` výchozí; `rankBy: "lower"` zůstává (řeší 71herní outlier,
  EB ho neřešila); `pilotExpGames: 10`; priory beze změny (S 500, M 300, Y 150, H 30). Bod D (empirický
  selekční diskont v UI) tím ztrácí naléhavost — rank 1 už není nadhodnocený.

## Co by bylo nepoctivé (a nedělá se)
- Zeslabit priory, aby se čísla rozestoupila (hierarchický odhad implikuje prior ≈ 400–500 her — je správně).
- Ukazovat syrové WR (Tryndamere 76 % by vedl s ještě větší jistotou).
- Ručně penalizovat „niche" šampiony bez naměřeného efektu.

## Historie
- 5. 9. 2026 vytvořeno z rozboru „proč je všechno kolem 50 %"; A + B + C implementovány (commit 8fb0e2e).
