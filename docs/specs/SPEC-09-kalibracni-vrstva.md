# SPEC-09 — Kalibrační vrstva nad odchylkovými členy

**Stav:** potvrzeno a implementováno 5. 9. 2026 (spolu se zvednutím priorů M 300 → 3 000,
Y 150 → 1 500 — rozhodnutí Jana po gridu ze SPEC-08). První kalibrace uložena (id 1).

## Proč
Holdout ze SPEC-08 ukázal, že součet 25 matchup + 10 synergických členů je i se silnějšími priory
přehnaně sebejistý: plný model 0,69175 vs. jen síla 0,69040 (log-loss), ECE 0,031 vs. 0,020.
Každý člen je sám o sobě shrunk správně; jejich *součet* ne — 35 slabých, částečně korelovaných
odhadů se sčítá a jejich šum s nimi. Atributový prior (SPEC-08) měl stejný problém v horší podobě.
Řešení není další ladění priorů (to řeší jednotlivé buňky), ale jedna vrstva nad součtem.

## Model
```
logit P(blue vyhraje) = sideLogit + S + termScale · D
```
- **S** = baseline sil (Σ logit s_blue − Σ logit s_red) — vlastní kalibrace dobrá, nesahá se na ni;
- **D** = součet všech odchylkových členů: countery (přes 25 kombinací pozic), synergie, forma
  hráče, očekávané budoucí picky, atributový prior;
- **termScale** (τ) a **sideLogit** (výhoda modré strany) — dva skaláry fitované maximální
  věrohodností (Newton) na holdout hrách, `apps/model/src/calibrate.ts`.

V `scoreDraft` se τ aplikuje na každý ne‑silový člen: bodový odhad, MC vzorky (přes váhu) i
zobrazené příspěvky, takže UI ukazuje to, co model použil. `sideLogit` jen tam, kde je strana
známá (týmový winprob; v draftu pozice hráče stranu neurčuje).

## Protokol fitu (`model:calibrate`)
1. Trénink = hry před cutoffem (3 dny), test = hry po něm, **v časovém pořadí**.
2. Fit na celém testu → hodnoty k uložení. **Křížová kontrola:** fit na první časové polovině,
   skóre na druhé a naopak — citované číslo je tohle, ne in‑sample.
3. `--persist` uloží do `model_calibration` (patch, τ, sideLogit, attrWeight, priory, n, log-loss
   síla / syrový / CV, ECE CV, params). API a CLI berou poslední řádek pro patch, **jen pokud
   sedí priory** (jinak běží s τ = 1 — kalibrace patří ke konkrétnímu modelu).
4. Replay se pak spouští s uloženou kalibrací (`--tau` přepíše) a jeho persist nese `termScale`,
   takže kontrola reality v UI (SPEC-07 D) odpovídá servírovanému modelu.

## Měření (patch 16.16, trénink 20 506 / test 3 067 her, cutoff 3 dny, 5. 9. 2026)
| varianta | log-loss | AUC | ECE |
|---|---|---|---|
| jen síla | 0,69040 | 0,5423 | 0,0202 |
| plný model, syrový (τ = 1), M 3 000 / Y 1 500 | 0,69175 | 0,5429 | 0,0311 |
| **plný model, kalibrovaný (CV)** | **0,68988** | 0,5429 | **0,0104** |
| s atributy (váha 1), syrový | 0,70221 | 0,5526 | 0,0562 |
| s atributy (váha 1), kalibrovaný (CV) | 0,69012 | 0,5466 | 0,0095 |

Fit: **τ = 0,176** (poloviny 0,157 / 0,206), sideLogit 0,072 (modrá strana ≈ 51,8 %).
S atributy τ = 0,164, ale poloviny 0,060 / 0,280 — nestabilní; CV log-loss o 0,0002 horší než bez
nich při vyšší AUC. **Uloženo bez atributů** (`attrWeight 0`); atributy zůstávají otevřené —
při větším objemu dat (nebo per‑člen τ) se k nim vrátit.

Čtení: poprvé plný model **poráží samotnou sílu na holdoutu** (0,68988 < 0,69040) a ECE klesá na
polovinu. τ ≈ 0,18 říká, že z párového signálu je při dnešním objemu dat důvěryhodná jen asi
pětina — zbytek je šum. To není selhání modelu, to je poctivá odpověď na 26 matchup buněk s ≥ 300
hrami. Jak data porostou, τ poroste; proto se kalibrace přepočítává (denně s evaluací), ne ladí.

### Replay (500 her / 5 000 picků, patch 16.16, priory M 3 000 / Y 1 500)
| varianta | rank 1: n / realita / predikce | rank 2–3 | rank 26+ | ECE | log-loss | třídy |
|---|---|---|---|---|---|---|
| **τ z DB + EB (servírováno, run 5)** | 271 / 55,7 % / 50,8 % | 435 / 48,0 / 50,5 | 1 754 / 48,9 / 49,7 | **0,0003** | 0,69309 | 1 |
| τ = 1 + EB | 182 / 53,3 % / 50,8 % | 312 / 47,1 / 50,5 | 2 547 / 49,7 / 49,8 | 0,0018 | **0,69298** | 1 |
| τ z DB, bez EB | 235 / 52,3 % / 53,3 % | 334 / 45,8 / 51,8 | 2 330 / 49,6 / 49,0 | 0,0089 | 0,69327 | 2 |

Čtení:
- EB v2 zůstává zapnutá — bez ní je kalibrace P(chosen) 30× horší. τ a EB nejsou totéž: τ krotí
  součet odchylkových členů (týmový model), EB selekci maxima přes kandidáty (draft).
- **Cena poctivosti:** při τ ≈ 0,16 spadnou pro anonymního uživatele (bez Riot ID) prakticky všichni
  kandidáti do jedné třídy indiference (rozpětí p 49,5–50,5 %). To není chyba UI — data dnes
  neumí populačně rozlišit kandidáty na pozici; rozlišuje až vlastní historie hráče (H) a
  budoucí větší objem dat (τ poroste).
- **Otevřený bod (SPEC-10):** rank 1 je napříč čtyřmi dnešními běhy realizovaný 50,4 / 56,1 /
  53,3 / 55,7 % při predikci ~51 % (n 130–270) — EB nejspíš špičku *pod*hodnocuje o ~3 p.b.
  Kandidát: nahradit EB v2 empirickou per‑rank kalibrací fitovanou z replay (stejný princip jako
  τ, jen pro selekci). Nedělat bez dalších ~2 000 replay her, jinak se fituje šum.
- Replay je s kalibrací asi 2× pomalejší (širší třídy → víc kandidátů v MC); soubory
  `data/replay-spec09.txt`, `data/replay-spec09-noeb.txt`.

## Co by bylo nepoctivé (a nedělá se)
- Fitovat τ na týchž hrách, na kterých se hlásí výsledek (proto CV na časových polovinách).
- Použít kalibraci fitovanou pro jiné priory (proto kontrola `prior_n_matchup` / `prior_n_synergy`).
- Nechat τ per člen bez dostatku dat — dva skaláry na 3 000 her jsou stabilní, deset by nebylo.
