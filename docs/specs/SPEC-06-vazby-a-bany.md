# SPEC-06 Vazby napříč draftem, budoucí picky a bany

**Stav:** potvrzeno 2026-08-23

## Co model zahrnuje
1. **Dvojice napříč všemi pozicemi** (hotovo): matchup pro všech 25 kombinací pozic (např. Darius top vs Zed mid), synergie pro všech 10 dvojic v týmu. Skóre kandidáta sčítá členy vůči *každému* známému soupeři (pozice inferovaná) a *každému* známému spoluhráči.
2. **Očekávané budoucí picky soupeře a spoluhráčů** (nové): pro každou dosud neobsazenou pozici soupeře
   `E[C] = Σ_Y P(Y | pozice, meta, bany, již vybraní) · C(X vs Y)`; obdobně očekávaná synergie s dosud nevybranými spoluhráči. **Zabanovaní a již vybraní šampioni z součtu vypadávají** — ban counteru tedy zvyšuje hodnotu kandidáta. Váha budoucích členů se ladí validací. V rozpadu se zobrazuje jako „očekávané riziko / příležitost“.
3. **Doporučení banů** (odvozené z 2): ban Y = největší pokles očekávané hodnoty našich nejlepších kandidátů × P(soupeř Y vezme). Ověřitelné v prospektivním logu (přišla hrozba?).
4. **Interakce vyššího řádu = hypotéza H5**: trojice (např. Darius vs Malphite *zatímco* enemy mid Zed) jako odchylka od párové predikce se silným priorem; aktivní jen u kombinací s dostatkem her. Přínos se měří v holdoutu jako u H1–H4; pokud nepřidá, zůstává vypnuto. Obecnější naučený interakční model je fáze 6.

## Data
- Bany z Match-V5 (`info.teams[].bans`) se ukládají do `match_ban` od 2026-08-23; starší zápasy bany nemají.
- P(Y | pozice) = pick rate šampiona na pozici v patchi a tierovém pásmu (z `agg_position_prior` / `agg_champ_pos`).

## Historie
- 2026-08-23 vytvořeno z ověření zadání.
