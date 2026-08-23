# SPEC-03 Model a výstup

**Stav:** potvrzeno 2026-08-23

## Rozhodnutí
- Výstup: **seřazený seznam** šampionů pro pozici s **P(výhra), 80% intervalem, třídami indiference** (překryv intervalů = AGREPREF pohled) a **rozpadem na členy** (síla, countery, synergie, osobní). Rozhodnutí uvnitř třídy dělá hráč.
- Jádro: logit-aditivní skóre, každý člen = Beta posterior se shrinkage (priory dle plánu §9.2, laděné validací). Žádné testy hypotéz jako filtr.
- **Osobní člen spojitý** (shrinkage k WR šampiona + recency + mastery), **nic nevyřazuje**.
- **Složení týmu čistě statisticky.** Žádná ruční pravidla (AP/AD, tank, frontline). Pokud data ukážou, že full-AD bez tanku vyhrává, model to doporučí. Vlastnosti kompozice vstoupí jen jako **z dat odhadnuté členy** (fáze 6). *Ruší „varování na chybějící role“ z DP.*
- Pravidlo „šampion se na pozici hraje“: **≥ 3 % jeho her na pozici nebo ≥ 20 her** — ponechat.
- Tierové pásmo: **automaticky podle ranku hráče**, ručně přepnutelné; pásma Iron–Gold / Platinum–Emerald / Diamond+.
- Pozice soupeřů: pravděpodobnostní inference (enumerace přiřazení, Laplace-smoothed priory), countery jako očekávání přes rozdělení.

## Historie
- 2026-08-23 vytvořeno.
