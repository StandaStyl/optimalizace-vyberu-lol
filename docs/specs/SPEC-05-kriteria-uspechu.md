# SPEC-05 Kritéria úspěchu, kontrola reality, rizika

**Stav:** potvrzeno 2026-08-23

## Kontrola reality (klíčový požadavek)
1. **Retrospektivní** (z dat, součást validace): pro každou reálnou hru přehrát draft pick po picku, spočítat doporučení v okamžiku výběru hráče a měřit
   - WR her, kde hráč zvolil šampiona z 1. třídy, vs. ostatní (lift; pozorovací, ne kauzální),
   - kalibraci P(výhra) predikované pro skutečně zvoleného šampiona.
2. **Prospektivní** (web + LCU): každé vydané doporučení uložit (stav draftu, seznam, volba hráče) do `recommendation_log`; po hře dohledat výsledek; panel „reality check“ na stránce modelu.

## Kritéria „osvědčilo se“ → rozšiřovat
- Plný model < párový baseline v log-loss, ECE < 0,01, AUC ≥ 0,56 na holdoutu (H2 + kalibrace).
- Alespoň jedna hypotéza H1–H4 s jasným, metodicky čistým výsledkem (i negativním).
- Reální uživatelé dema se vracejí.
- Vlastní WR autora se zlepší (osobní lift).

## Čas
- Bez pevného termínu.

## Rizika a pojistky
- **Riot neschválí production key** → zůstat na dev klíči; veřejné profily jen z DB; crawl pomalejší.
- **Málo dat pro jasné závěry** → reportovat intervaly, nezastírat; rozšířit na další patch/region.
- **Právní / soukromí (Riot ID, GDPR)** → minimalizace, mazací funkce, zásady, disclaimer; Riot ID ukládat odděleně.

## Historie
- 2026-08-23 vytvořeno.
