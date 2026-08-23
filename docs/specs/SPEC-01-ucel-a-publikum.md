# SPEC-01 Účel a publikum

**Stav:** potvrzeno 2026-08-23 (Jan Musil)

## Rozhodnutí
- Primární cíl: **navazující výzkum** na diplomovou práci (Musil, 2017). Forma výstupu (článek / práce vyššího stupně / technická zpráva) je zatím otevřená → vše musí být **reprodukovatelné** a metriky **exportovatelné**.
- Aplikace je demonstrátor, ale **hostovaný** (veřejná URL, malý provoz).
- Priorita při konfliktu: **korektnost modelu > běžní ranked hráči (Iron–Diamond, UX) > autor jako uživatel > týmy/coachové**.
- Týmový/coach režim (full draft, bany, flex) až po validaci modelu.

## Hypotézy k testování
- **H1** Kalibrovaná nejistota (intervaly, třídy indiference) zlepší rozhodování oproti bodovému řazení.
- **H2** Personalizace (hráčský člen) přidá predikční sílu: plný model < párový v log-loss.
- **H3** Synergie závisí na tieru (rozptyl synergických členů roste s tierem).
- **H4** Inference pozic soupeřů z částečného draftu je přesná.
- **H5** Interakce vyššího řádu (trojice) mají měřitelný přínos nad aditivní párový model (viz SPEC-06).

## Důsledky
- Každý model run má uložené parametry a metriky (`model_run`, `model_eval`).
- Stránka modelu je veřejná a ukazuje živé metriky.

## Historie
- 2026-08-23 vytvořeno z rozhovoru.
